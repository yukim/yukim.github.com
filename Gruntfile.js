'use strict';
var path = require('path');
var lrSnippet = require('grunt-contrib-livereload/lib/utils').livereloadSnippet;

var folderMount = function folderMount(connect, point) {
  return connect.static(path.resolve(point));
};

module.exports = function (grunt) {

  grunt.initConfig({
    jekyll: {
      dist: {}
    },
    livereload: {
      port: 35729
    },
    connect: {
      options: {
        base: '_site/',
        port: 9000,
        hostname: 'localhost'
      },
      livereload: {
        options: {
          middleware: function(connect, options) {
            return [lrSnippet, folderMount(connect, options.base)]
          }
        }
      }
    },
    regarde: {
      assets: {
        files: ['_posts/*',
                '{.,_layouts,_includes}/*.html',
                's/{,*/}*.{html,css,js,svg}',
                'assets/styles/{,*/}*.css',
                'assets/scripts/{,*/}*.js',
                'assets/images/{,*/}*.{png,jpg,jpeg,gif,webp,svg}'],
        tasks: ['jekyll', 'livereload']
      }
    },
    open: {
      server: {
        path: 'http://localhost:<%= connect.options.port %>'
      }
    },
  });

  grunt.loadNpmTasks('grunt-contrib-connect');
  grunt.loadNpmTasks('grunt-contrib-livereload');
  grunt.loadNpmTasks('grunt-open');
  grunt.loadNpmTasks('grunt-regarde');
  grunt.loadNpmTasks('grunt-jekyll');

  grunt.registerTask('serve', [
    'livereload-start',
    'connect',
    'open',
    'regarde',
  ]);

  grunt.registerTask('default', [
    'jekyll',
    'livereload-start',
    'connect',
    'open',
    'regarde',
  ]);
};
