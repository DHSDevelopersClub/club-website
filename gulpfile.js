/*
Copyright (c) 2015 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
Code distributed by Google as part of the polymer project is also
subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
*/

'use strict';

// Include Gulp & tools we'll use
var gulp = require('gulp');
var $ = require('gulp-load-plugins')();
var del = require('del');
var runSequence = require('run-sequence');
var browserSync = require('browser-sync');
var reload = browserSync.reload;
var merge = require('merge-stream');
var path = require('path');
var fs = require('fs');
var glob = require('glob');
var historyApiFallback = require('connect-history-api-fallback');
var packageJson = require('./package.json');
var crypto = require('crypto');
var polybuild = require('polybuild');
var stringifyObject = require('stringify-object');
var stream = require('stream');
var os = require('os');

var WINDOWS = /^win/.test(os.platform());
var MAC = /^darwin$/.test(os.platform());

var AUTOPREFIXER_BROWSERS = [
  'ie >= 10',
  'ie_mob >= 10',
  'ff >= 30',
  'chrome >= 34',
  'safari >= 7',
  'opera >= 23',
  'ios >= 7',
  'android >= 4.4',
  'bb >= 10'
];

var TESTING_BROWSERS = [
  'firefox',
  'google chrome'
];
if (WINDOWS) {
  TESTING_BROWSERS.push('iexplore');
} else if (MAC) {
  TESTING_BROWSERS.push('safari');
}

var styleTask = function (stylesPath, srcs) {
  return gulp.src(srcs.map(function(src) {
      return path.join('app', stylesPath, src);
    }))
    .pipe($.changed(stylesPath, {extension: '.css'}))
    .pipe($.autoprefixer(AUTOPREFIXER_BROWSERS))
    .pipe(gulp.dest('.tmp/' + stylesPath))
    .pipe($.cssmin())
    .pipe(gulp.dest('dist/' + stylesPath))
    .pipe($.size({title: stylesPath}));
};

var jshintTask = function (src) {
  return gulp.src(src)
    .pipe($.jshint.extract()) // Extract JS from .html files
    .pipe($.jshint())
    .pipe($.jshint.reporter('jshint-stylish'))
    .pipe($.if(!browserSync.active, $.jshint.reporter('fail')));
};

var imageOptimizeTask = function (src, dest) {
  return gulp.src(src)
    .pipe($.cache($.imagemin({
      progressive: true,
      interlaced: true,
      multipass: true
    })))
    .pipe(gulp.dest(dest))
    .pipe($.size({title: 'images'}));
};

var optimizeHtmlTask = function (src, dest) {
  var assets = $.useref.assets({searchPath: ['.tmp', 'app', 'dist']});

  return gulp.src(src)
    // Replace path for vulcanized assets
    .pipe($.if('app/index.html', $.replace('elements/elements.html', 'elements/elements.vulcanized.html')))
    .pipe(assets)
    // Concatenate and minify JavaScript
    .pipe($.if('*.js', $.uglify({preserveComments: 'some'})))
    // Concatenate and minify styles
    // In case you are still using useref build blocks
    .pipe($.if('*.css', $.cssmin()))
    .pipe(assets.restore())
    .pipe($.useref())
    // Minify any HTML
    .pipe($.if('*.html', $.minifyHtml({
      quotes: true,
      empty: true,
      spare: true
    })))
    // Output files
    .pipe(gulp.dest(dest))
    .pipe($.size({title: 'html'}));
};

// Compile and automatically prefix stylesheets
gulp.task('app-styles', function () {
  return styleTask('styles', ['**/*.css']);
});

gulp.task('element-styles', function () {
  return styleTask('elements', ['**/*.css']);
});

gulp.task('roster-styles', function () {
  return styleTask('roster', ['**/*.css']);
});

// Scale images for multiple screen resolutions
gulp.task('resize-profiles', function () {
  var merged = merge();
  for (var i = 1; i <= 3; i++) {
    merged.add(gulp.src(['app/roster/*/profile.jpg'])
      .pipe($.imageResize({
        width: 100 * i,
        height: 100 * i,
        crop: true,
        upscale: false,
        imageMagick: true
      }))
      .pipe($.rename({ suffix: '-' + i + 'x' }))
      .pipe(gulp.dest('dist/roster/')));
  }
  return merged.pipe($.size({title: 'profile-images'}));
});

// Optimize images
gulp.task('app-images', function () {
  return imageOptimizeTask('app/images/**/*', 'dist/images');
});

gulp.task('roster-images', function () {
  return imageOptimizeTask('app/roster/**/*.{png,jpg,jpeg}', 'dist/roster');
});

// Lint JavaScript
gulp.task('jshint', function () {
  return jshintTask([
      'app/scripts/**/*.js',
      'app/elements/**/*.js',
      'app/elements/**/*.html',
      'app/roster/**/*.js',
      'app/roster/**/*.html',
      'gulpfile.js'
    ]);
});

// Copy all files at the root level (app)
gulp.task('copy', function () {
  var app = gulp.src([
    'app/*',
    '!app/test',
    '!app/cache-config.json'
  ], {
    dot: true
  }).pipe(gulp.dest('dist'));

  var bower = gulp.src(['bower_components/**/*'])
    .pipe(gulp.dest('dist/bower_components'));

  var roster = gulp.src(['app/roster/**/*'])
    .pipe(gulp.dest('dist/roster'));

  var elements = gulp.src(['app/elements/**/*.html'])
    .pipe(gulp.dest('dist/elements'));

  var swBootstrap = gulp.src(['bower_components/platinum-sw/bootstrap/*.js'])
    .pipe(gulp.dest('dist/elements/bootstrap'));

  var swToolbox = gulp.src(['bower_components/sw-toolbox/*.js'])
    .pipe(gulp.dest('dist/sw-toolbox'));

  var vulcanized = gulp.src(['app/elements/elements.html'])
    .pipe($.rename('elements.vulcanized.html'))
    .pipe(gulp.dest('dist/elements'));

  return merge(app, bower, roster, elements, vulcanized, swBootstrap, swToolbox)
    .pipe($.size({title: 'copy'}));
});

// Copy web fonts to dist
gulp.task('fonts', function () {
  return gulp.src(['app/fonts/**'])
    .pipe(gulp.dest('dist/fonts'))
    .pipe($.size({title: 'fonts'}));
});

// Scan your HTML for assets & optimize them
gulp.task('html', function () {
  return optimizeHtmlTask(
    ['app/**/*.html', '!app/{elements,test}/**/*.html'],
    'dist');
});

// Polybuild will take care of inlining HTML imports,
// scripts and CSS for you.
gulp.task('vulcanize', function () {
  return gulp.src('dist/index.html')
    .pipe(polybuild({maximumCrush: true}))
    .pipe(gulp.dest('dist/'));
});

// If you require more granular configuration of Vulcanize
// than polybuild provides, follow instructions from readme at:
// https://github.com/PolymerElements/polymer-starter-kit/#if-you-require-more-granular-configuration-of-vulcanize-than-polybuild-provides-you-an-option-by

// Rename Polybuild's index.build.html to index.html
gulp.task('rename-index', function () {
  return gulp.src('dist/index.build.html')
    .pipe($.rename('index.html'))
    .pipe(gulp.dest('dist/'));
});

gulp.task('remove-old-build-index', function () {
  return del('dist/index.build.html');
});

// Generate config data for the <sw-precache-cache> element.
// This include a list of files that should be precached, as well as a (hopefully unique) cache
// id that ensure that multiple PSK projects don't share the same Cache Storage.
// This task does not run by default, but if you are interested in using service worker caching
// in your project, please enable it within the 'default' task.
// See https://github.com/PolymerElements/polymer-starter-kit#enable-service-worker-support
// for more context.
gulp.task('cache-config', function (callback) {
  var dir = 'dist';
  var config = {
    cacheId: packageJson.name || path.basename(__dirname),
    disabled: false
  };

  glob('{elements,scripts,styles}/**/*.*', {cwd: dir}, function(error, files) {
    if (error) {
      callback(error);
    } else {
      files.push('index.html', './', 'bower_components/webcomponentsjs/webcomponents-lite.min.js');
      config.precache = files;

      var md5 = crypto.createHash('md5');
      md5.update(JSON.stringify(config.precache));
      config.precacheFingerprint = md5.digest('hex');

      var configPath = path.join(dir, 'cache-config.json');
      fs.writeFile(configPath, JSON.stringify(config), callback);
    }
  });
});

// Clean output directory
gulp.task('clean', function (cb) {
  del(['.tmp', 'dist'], cb);
});

// Watch files for changes & reload
gulp.task('serve', [
  'app-styles', 'element-styles', 'roster-styles',
  'app-images', 'roster-images',
  'resize-profiles', 'generate-roster'
], function () {
  browserSync({
    port: 5000,
    notify: false,
    logPrefix: 'DHS',
    snippetOptions: {
      rule: {
        match: '<span id="browser-sync-binding"></span>',
        fn: function (snippet) {
          return snippet;
        }
      }
    },
    // Run as an https by uncommenting 'https: true'
    // Note: this uses an unsigned certificate which on first access
    //       will present a certificate warning in the browser.
    // https: true,
    browser: TESTING_BROWSERS,
    server: {
      baseDir: ['.tmp', 'app'],
      middleware: [ historyApiFallback() ],
      routes: {
        '/bower_components': 'bower_components'
      }
    }
  });

  gulp.watch(['app/**/*.html'], reload);
  gulp.watch(['app/styles/**/*.css'], ['app-styles', reload]);
  gulp.watch(['app/elements/**/*.css'], ['element-styles', reload]);
  gulp.watch(['app/roster/**/*.css'], ['roster-styles', reload]);
  gulp.watch(['app/{scripts,elements}/**/{*.js,*.html}'], ['jshint']);
  gulp.watch(['app/images/**/*'], reload);
  gulp.watch(['app/roster/**'], ['generate-roster', reload]);
});

// Build and serve the output from the dist build
gulp.task('serve:dist', ['default'], function () {
  browserSync({
    port: 5001,
    notify: false,
    logPrefix: 'DHS',
    snippetOptions: {
      rule: {
        match: '<span id="browser-sync-binding"></span>',
        fn: function (snippet) {
          return snippet;
        }
      }
    },
    // Run as an https by uncommenting 'https: true'
    // Note: this uses an unsigned certificate which on first access
    //       will present a certificate warning in the browser.
    // https: true,
    server: 'dist',
    browser: TESTING_BROWSERS,
    middleware: [ historyApiFallback() ]
  });
});

/**
 * Push build to gh-pages
 */
gulp.task('deploy', ['default'], function () {
  return gulp.src("./dist/**/*")
    .pipe($.ghPages({branch: 'master'}));
});

function string_src(filename, string) {
  var src = stream.Readable({ objectMode: true })
  src._read = function () {
    this.push(new $.util.File({ cwd: "", base: "", path: filename, contents: new Buffer(string) }))
    this.push(null)
  };
  return src
}

gulp.task('generate-roster', function () {
  var members = [];
  glob.sync("app/roster/*")
  .forEach(function(file) {
    var member = path.basename(file, path.extname(file))
    members.push(member);
  });
  var string = stringifyObject(members, {
      indent: '  ',
      singleQuotes: false
  });
  return string_src("roster.json", string)
    .pipe(gulp.dest('.tmp/roster/'))
    .pipe(gulp.dest('dist/roster/'));
});

// Build production files, the default task
gulp.task('default', ['clean'], function (cb) {
  // Uncomment 'cache-config' after 'rename-index' if you are going to use service workers.
  runSequence(
    ['copy', 'app-styles'],
    ['element-styles', 'roster-styles'],
    ['app-images', 'roster-images', 'fonts', 'html', 'generate-roster'],
    'resize-profiles',
    'vulcanize', 'rename-index', 'remove-old-build-index', // 'cache-config',
    cb);
});
