const browserify = require('browserify');
const { spawn } = require('child_process');
const fs = require('fs');
const gulp = require('gulp');
const newfile = require('gulp-file');
const headerfooter = require('gulp-headerfooter');
const replace = require('gulp-replace');
const streamify = require('gulp-streamify');
const strip = require('gulp-strip-comments');
const tap = require('gulp-tap');
const source = require('vinyl-source-stream');

const watchedPaths = [
    'src/modules/*',
    'src/es5-polyfills.js',
    'Dollchan_Extension_Tools.meta.js'
];

// Every source file that carries the version. Userscript managers only offer an update when @version
// grows, so this is bumped on every commit. The built artifacts are not listed here: `make` bakes the
// version into them from meta.js (userscript header) and from menu.html. package.json/package-lock.json
// are not listed either — npm rejects 4-part versions, so they keep the 3-part form.
const versionFiles = [
    'src/modules/Wrap.js',
    'Dollchan_Extension_Tools.meta.js',
    'extension/v2/manifest.json',
    'extension/v3/manifest.json',
    'extension/v2/menu/menu.html',
    'extension/v3/menu/menu.html'
];

// Bumps the last part of the version (24.9.16.0 -> 24.9.16.1). Run it before `make`, never after.
gulp.task('bump', cb => {
    const wrapFile = 'src/modules/Wrap.js';
    const oldVersion = fs.readFileSync(wrapFile, 'utf8').match(/const version = '(\d+(?:\.\d+)*)';/)?.[1];
    if(!oldVersion) {
        throw new Error(`No version found in ${ wrapFile }`);
    }
    const parts = oldVersion.split('.');
    parts[parts.length - 1] = +parts[parts.length - 1] + 1;
    const newVersion = parts.join('.');
    for(const file of versionFiles) {
        const str = fs.readFileSync(file, 'utf8');
        const count = str.split(oldVersion).length - 1;
        if(!count) {
            throw new Error(`Version ${ oldVersion } not found in ${ file }`);
        }
        fs.writeFileSync(file, str.split(oldVersion).join(newVersion));
        console.log(`${ file }: ${ count } occurrence(s)`);
    }
    console.log(`Version ${ oldVersion } -> ${ newVersion }`);
    cb();
});

// Updates commit version in Wrap.js module
gulp.task('updatecommit', cb => {
    let stdout, stderr;
    const git = spawn('git', ['rev-parse', 'HEAD']);
    git.stdout.on('data', data => (stdout = String(data)));
    git.stderr.on('data', data => (stderr = String(data)));
    git.on('close', code => {
        if(code !== 0) {
            throw new Error(`Git error:\n${ stdout ? `${ stdout }\n` : '' }${ stderr }`);
        }
        gulp.src('src/modules/Wrap.js')
            .pipe(replace(/^const commit = '[^']*';$/m, `const commit = '${ stdout.trim().substr(0, 7) }';`))
            .pipe(gulp.dest('src/modules'))
            .on('end', cb);
    });
});

// Makes es6-script from module files
gulp.task('make:es6', gulp.series('updatecommit', () =>
    gulp.src('src/modules/Wrap.js').pipe(tap(wrapFile => {
        let count = 0;
        let str = wrapFile.contents.toString();
        const arr = str.match(/\/\* ==\[ .*? \]== \*\//g);
        for(let i = 0, len = arr.length - 1; i < len; ++i) {
            gulp.src(`src/modules/${ arr[i].replace(/\/\* ==\[ | \]== \*\//g, '') }`)
                .pipe(tap(moduleFile => {
                    str = str.replace(arr[i], moduleFile.contents.toString());
                    if(++count === len) {
                        newfile('src/Dollchan_Extension_Tools.es6.user.js', `\n${ str }`)
                            .pipe(streamify(headerfooter.header('Dollchan_Extension_Tools.meta.js')))
                            // One line ending only: the bundle goes from GitHub straight into a browser, and a CRLF
                            // from a Windows checkout is what makes the installed file look broken there.
                            .pipe(tap(file => {
                                file.contents = Buffer.from(file.contents.toString().replace(/\r\n/g, '\n'));
                            }))
                            .pipe(gulp.dest('.'));
                    }
                }));
        }
    }))
));

// Copy es6 script from src/ to extension/ folder
gulp.task('copyext', () => gulp.src('src/Dollchan_Extension_Tools.es6.user.js')
    .pipe(replace(/\s+\/\/ <EXCLUDED_FROM_EXTENSION>[\s\S]*?<\/EXCLUDED_FROM_EXTENSION>/g, ''))
    .pipe(gulp.dest('extension/v2')).pipe(gulp.dest('extension/v3')));

// Makes es5-script from es6-script
gulp.task('make:es5', gulp.series(
    'make:es6',
    () => browserify(['src/es5-polyfills.js', 'src/Dollchan_Extension_Tools.es6.user.js'])
        .transform('babelify', { presets: ['@babel/preset-env'] })
        .bundle()
        .pipe(source('Dollchan_Extension_Tools.user.js'))
        .pipe(streamify(strip()))
        .pipe(streamify(headerfooter(
            '/* eslint-disable */\n(function deMainFuncOuter(localData) {\n',
            '})(null);')))
        .pipe(streamify(headerfooter.header('Dollchan_Extension_Tools.meta.js')))
        .pipe(gulp.dest('.')),
    'copyext'
));

gulp.task('make', gulp.series('make:es5'));

// Split es6-script into separate module files
gulp.task('make:modules', () => gulp.src('src/Dollchan_Extension_Tools.es6.user.js').pipe(tap(file => {
    // A CRLF bundle is normalized rather than assumed: splitting on \r\n alone found no marker in an LF
    // bundle, and the next line threw on undefined.
    const bundle = file.contents.toString().replace(/\r\n/g, '\n');
    const arr = bundle.split('// ==/UserScript==\n\n')[1].split('/* ==[ ');
    let wrapStr = `${ arr[0].slice(0, -1) }\n`;
    for(let i = 1, len = arr.length; i < len; ++i) {
        let str = arr[i];
        if(i !== len - 1) {
            str = str.slice(0, -1); // Remove last \n
            wrapStr += `/* ==[ ${ str.split(' ]==')[0] } ]== */\n`;
        } else {
            wrapStr += `/* ==[ ${ str }`;
            break;
        }
        const fileName = str.slice(0, str.indexOf(' ]'));
        newfile(`src/modules/${ fileName }`, `/* ==[ ${ str }`).pipe(gulp.dest('.'));
    }
    newfile('src/modules/Wrap.js', wrapStr).pipe(gulp.dest('.'));
})));

// Waits for changes in watchedPaths files, then makes es5 and es6-scripts
gulp.task('watch', () => gulp.watch(watchedPaths, gulp.series('make')));
gulp.task('default', gulp.parallel('make', 'watch'));
