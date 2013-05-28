---
layout: post
title: 詳解repair (1)
published: true
tags: cassandra
---

[@oranie](https://twitter.com/oranie)さんがrepairのポイントについて[まとめて](http://d.hatena.ne.jp/oranie/20130515/1368597421)くださってたので、便乗して、repairのちょっと踏み込んだ解説をしてみます。ようやく公開。

長くなったので何回かに分けてアップしていきます。
また、記事中のCassandaはバージョンv1.2.xを想定しています。

### repairコマンドの実行

`repair` はレプリカ間の差異を文字通り修復するために実行します。実行コマンド `nodetool repair` にはいくつかオプションがあります。nodetool を何も指定しないで実行すると(実装の都合上非常に見にくい)ヘルプが表示されます。その中からrepairコマンドに関係のあるオプションを抜き出したのが以下です。

    $ nodetool
    usage: java org.apache.cassandra.tools.NodeCmd --host <arg> <command>

     ...

     -et,--end-token <arg>       token at which repair range ends

     ...

     -pr,--partitioner-range     only repair the first range returned by the
                                 partitioner for the node
     ...
     -snapshot,--with-snapshot   repair one node at a time using snapshots
     -st,--start-token <arg>     token at which repair range starts

     ...

    Available commands
      ...
      repair [keyspace] [cfnames] - Repair one or more column families (use -pr to repair only the first range returned by the partitioner)
      ...

分かりにくいので、整理すると以下のようになります。 (\[\]はオプションです。\[\]内の\|はその前後どちらかを指定します。)

    $ nodetool repair [[keyspace] [cf...]] [-snapshot] [-pr|-st <start token> -et <end token>]

`[keyspace] [cf...]` の部分はrepairを行うキースペースやカラムファミリを指定します。何も指定しない場合はすべてのキースペース内のカラムファミリを、キースペースを指定した場合はそのキースペース内のカラムファミリを順次repairしていきます。

`-snapshot` を指定すると、repairの実行前にまずSSTableのスナップショットを作成するようレプリカに指示します。そして、通常はすべてのレプリカに対して同時にハッシュツリーの計算を指示しますが、このオプションを付けると**1つのレプリカ毎に**ハッシュツリーの計算を指示していきます。ハッシュツリーは取得したスナップショットに対して計算されます。つまり、比較的重いハッシュツリーの計算を1ノードごと行うことで、クラスタ全体のパフォーマンスに与える影響を最小限にできます。ただし、その分完了まで時間がかかります(そのためのスナップショットですね)。

`-pr` は、oranieさんの[記事](http://d.hatena.ne.jp/oranie/20130515/1368597421)にある通りです。レプリカを含まない、ノードが持つトークン範囲のみ`repair`します。

`-st, -et` は最近追加されたオプションで、任意のトークン範囲をrepairできます。v1.1.11とv1.2.3から使えます。`-st` に範囲の開始トークン、`-et` に範囲の終端トークンを渡します。指定する範囲は、そのノードが持つトークン範囲内に入っていなければなりません。あるノードが持つトークン範囲を一気に行うのではなく、複数回に分けて行うことが可能になります。

### repairの全体像

では、repairを実行した際に何が起こっているのでしょうか。`repair`の主な処理は[AntiEntropyService](https://github.com/apache/cassandra/blob/cassandra-1.2.5/src/java/org/apache/cassandra/service/AntiEntropyService.java)で行われています。

`repair` コマンドを受け取ったノード(コーディネータ)は、`repair`を行うキースペースとトークン範囲ごとに`repair`セッション([RepairSession](https://github.com/apache/cassandra/blob/cassandra-1.2.5/src/java/org/apache/cassandra/service/AntiEntropyService.java#L583))を作成します(コーディネータが持つトークン範囲もしくは`-st`、`-et`で指定したトークン範囲)。そして、`repair`セッションは`repair`するカラムファミリごとに`repair`ジョブ([RepairJob](https://github.com/apache/cassandra/blob/cassandra-1.2.5/src/java/org/apache/cassandra/service/AntiEntropyService.java#L810))を順次起動します。
後述するMerkleツリーの構築が比較的重い処理のため、`repair`ジョブは順次起動されるようになっています。
`repair`ジョブ は主に以下の2つの処理から成り立っています。

<ol>
  <li>Merkleハッシュツリーの取得・検証</li>
  <li>ハッシュ値が違う部分のデータの送受信</li>
</ol>

#### Merkleハッシュツリーの取得・検証

'repair'ジョブは、まずコーディネータ自身とそのレプリカに`repair`する範囲の**Merkleハッシュツリー**([MerkleTree](https://github.com/apache/cassandra/blob/cassandra-1.2.5/src/java/org/apache/cassandra/utils/MerkleTree.java))を要求します。Cassandraは葉の部分に細分化されたトークン範囲を持つハッシュツリーを構築します。要求を受け取ったノードは範囲内のRowのハッシュ値からツリーを構築し、コーディネータに返します([Validator](https://github.com/apache/cassandra/blob/cassandra-1.2.5/src/java/org/apache/cassandra/service/AntiEntropyService.java#L262))。すべてのハッシュツリーを受け取ったらそれらを総当たりで比較し([Differencer](https://github.com/apache/cassandra/blob/cassandra-1.2.5/src/java/org/apache/cassandra/service/AntiEntropyService.java#L956))、差異があるトークン範囲を特定します。A、B、Cの3つのノードを`repair`している場合、AとB、AとC、BとCの組み合わせで比較します。

#### ハッシュ値が違う部分のデータの送受信

比較した結果、差異があったトークン範囲のデータのみを送受信します([StreamRepairTask](https://github.com/apache/cassandra/blob/cassandra-1.2.5/src/java/org/apache/cassandra/streaming/StreamingRepairTask.java))。ハッシュツリーの葉の部分にあたるトークン範囲を最小単位として差分比較するため、データ送受信もその単位で行われます。

次回はMerkleハッシュツリーについて詳しく見ていきます。

