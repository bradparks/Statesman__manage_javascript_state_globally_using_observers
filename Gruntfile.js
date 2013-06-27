/*global module:false*/
module.exports = function(grunt) {

	// Project configuration.
	grunt.initConfig({
		pkg: grunt.file.readJSON( 'package.json' ),
		
		meta: {
			banner: '/*! Statesman - v<%= pkg.version %> - <%= grunt.template.today("yyyy-mm-dd") %>\n' +
				'* <%= pkg.description %>\n\n' +
				'* <%= pkg.homepage %>\n' +
				'* Copyright (c) <%= grunt.template.today("yyyy") %> <%= pkg.author.name %>;' +
				' MIT Licensed */\n' +
				'/*jslint eqeq: true, plusplus: true */\n' +
				'\n\n'
		},

		watch: {
			js: {
				files: [ 'src/**/*.js' ],
				tasks: 'concat',
				interrupt: true
			}
		},

		jshint: {
			options: {
				jshintrc: '.jshintrc'
			},
			files: [ 'Gruntfile.js', 'build/Statesman.js' ]
		},
		qunit: {
			all: [ 'test/index.html' ]
		},
		concat: {
			options: {
				banner: '<%= meta.banner %>'
			},
			build: {
				src: [ 'wrapper/begin.js', 'src/**/*.js', 'wrapper/end.js' ],
				dest: 'build/Statesman.js'
			},
			legacy: {
				src: [ 'wrapper/begin.js', 'legacy.js', 'src/**/*.js', 'wrapper/end.js' ],
				dest: 'build/Statesman-legacy.js'
			}
		},
		uglify: {
			build: {
				src: [ 'build/Statesman.js' ],
				dest: 'build/Statesman.min.js'
			},
			legacy: {
				src: [ 'build/Statesman-legacy.js' ],
				dest: 'build/Statesman-legacy.min.js'
			}
		},
		copy: {
			release: {
				files: {
					'release/<%= pkg.version %>/Statesman.js': '<%= concat.build.dest %>',
					'release/<%= pkg.version %>/Statesman.min.js': '<%= uglify.build.dest %>'
				}
			},
			shortcut: {
				files: {
					'Statesman.js': '<%= concat.build.dest %>',
					'Statesman.min.js': '<%= uglify.build.dest %>'
				}
			}
		}
	});


	grunt.loadNpmTasks( 'grunt-contrib-watch' );
	grunt.loadNpmTasks( 'grunt-contrib-jshint' );
	grunt.loadNpmTasks( 'grunt-contrib-qunit' );
	grunt.loadNpmTasks( 'grunt-contrib-concat' );
	grunt.loadNpmTasks( 'grunt-contrib-uglify' );
	grunt.loadNpmTasks( 'grunt-contrib-copy' );

	// default task
	grunt.registerTask( 'default', [ 'concat', 'uglify', 'qunit' ] );
	grunt.registerTask( 'release', [ 'default', 'copy' ] );

};