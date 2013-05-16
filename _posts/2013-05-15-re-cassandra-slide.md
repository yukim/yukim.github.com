---
layout: post
title: 鬼の哭くシステムを分析してみる
published: true
tags: cassandra
---

["鬼の哭くシステム"](http://www.slideshare.net/TakehiroTorigaki/cassandra-21191674)コミッターの森下です。話題のApache Cassandraスライドについて、気になった点まとめてみました。

<iframe src="http://www.slideshare.net/slideshow/embed_code/21191674" width="427" height="356" frameborder="0" marginwidth="0" marginheight="0" scrolling="no" style="border:1px solid #CCC;border-width:1px 1px 0;margin-bottom:5px">  </iframe>
<div style="margin-bottom:5px"> <strong> <a href="http://www.slideshare.net/TakehiroTorigaki/cassandra-21191674" title="これがCassandra" target="_blank">これがCassandra</a> </strong> from <strong><a href="http://www.slideshare.net/TakehiroTorigaki" target="_blank">Takehiro Torigaki</a></strong> </div>

### repairかけているNodeとその前後Nodeのデータが肥大しまくる

"その前後Node"がレプリカを保持しているノードだと思います。repairがレプリカ間で差異を検知するとのその部分のデータを相互に交換します。(repairについては内部動作について今後このブログで書いていきます。)

まず、Cassandraは、削除を行ってから gc_grace_seconds で設定された秒数を経過しないとがデータを物理削除しません。これは、分散システムにおいてレプリカ間の整合がとれていない場合において削除したはずのデータが復活するのを防ぐためです。デフォルトでは10日間に設定されていて、この間にrepairを実行してレプリカの整合をとっておきます。また、物理削除はCompactionの際に行われます。つまり、gc_grace_seconds 秒をすぎていてもCompactionされなければ物理削除されません。

で、削除されたカラムのrepairはちょっとくせ者で、1.1系だとレプリカ間の差異(ハッシュ値の差異)が出やすいのです([CASSANDRA-4905](https://issues.apache.org/jira/browse/CASSANDRA-4905))。1.1系までは、あるレプリカではすでに物理削除されていて、他のレプリカではCompaction待ちの場合、削除データが再度送信されてしまいます。1.2系にアップグレードすることでデータの送受信は改善しそうです。

### メジャーCompaction

メジャーCompactionはすべてのSSTableを一気にCompactionして一つにまとめるCompactionで、CompactionStrategyにSizeTieredCompactionStrategy(デフォルト設定)の場合利用でき機能です。最近のバージョンではこれを実行することは推奨されていません。

SizeTieredCompactionStrategyは、ファイルサイズが同じようなSSTableを集めてCompactionを行います。メジャーCompactionを行うと、1つの巨大なファイルが出来上がりますが、その後は同じサイズのファイルが存在しなくなるため通常のCompactionサイクルに引っかからなくなります。メジャーCompactionで物理削除されなかったカラムは、また再度メジャーCompactionを行うまでずっとディスク上に残ってしまいます(まさにメジャーCompaction地獄)。1.2からはそのような状況に陥った場合でも物理削除されるような仕組みが導入されています([CASSANDRA-3442](https://issues.apache.org/jira/browse/CASSANDRA-3442))。

repair後自動的にCompactionが走るため、ディスク容量が減るまで待った方が無難です。Compaction時のディスクIOはデフォルトで制限(16MB/s)がかかっているため、IOに余裕がある場合は一時的に以下のコマンドで制限を解除することができます。

    $ nodetool setcompactionthroughput 0

### 結論

1\.2系にアップグレードしよう。特にもうすぐリリースされる1.2.5は結構安定しているはず。
あと、今年後半にリリース予定のバージョン2.0は、1.2.5以降からのアップグレードしかサポートしないことが確定しました。なのでなおさら1.2.5以上にアップグレードしといた方がいいでしょう。

