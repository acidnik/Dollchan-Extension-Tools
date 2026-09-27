#!/usr/bin/env node
/*
 * Merge upstream (SthephanShinkufag/Dollchan-Extension-Tools) into this fork without fighting whitespace.
 * Upstream indents with tabs, this fork with 4 spaces, so a plain merge conflicts on every line either side
 * touched. The script first lands upstream's tree in the fork's convention on a throwaway branch, then merges
 * that branch with -X ignore-space-change, so what is left to resolve is real code and not indentation.
 *
 *   node tools/sync-upstream.mjs [--url <git-url>] [--branch <upstream-branch>] [--dry-run]
 *
 * The merge is left uncommitted on purpose: the script never commits to your branch. Exit code 0 means the
 * merge is staged with nothing to resolve, 3 means conflicts need you, 1 is an error.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const UPSTREAM_URL = 'https://github.com/SthephanShinkufag/Dollchan-Extension-Tools.git';
const UPSTREAM_REMOTE = 'upstream';
const CONVERT_BRANCH = 'de-upstream-merge';
const INDENT = 4;
// npm writes this one itself, in its own format, so it is never rewritten here
const SKIP_FILES = new Set(['package-lock.json']);
// Generated from src/modules, so a merge of them means nothing: the fork's own version is kept and the build
// recreates the files from the merged sources afterwards
const ARTIFACTS = [
    'Dollchan_Extension_Tools.user.js',
    'src/Dollchan_Extension_Tools.es6.user.js',
    'extension/v2/Dollchan_Extension_Tools.es6.user.js',
    'extension/v3/Dollchan_Extension_Tools.es6.user.js'
];

function git(args, { quiet = true, allowFail = false } = {}) {
    const res = spawnSync('git', args, { encoding: 'utf8' });
    if(res.status !== 0 && !allowFail) {
        fatal(`git ${ args.join(' ') } failed:\n${ res.stderr || res.stdout }`);
    }
    if(!quiet && res.stdout) {
        process.stdout.write(res.stdout);
    }
    return { status: res.status, out: res.stdout || '' };
}

function fatal(msg) {
    process.stderr.write(`sync-upstream: ${ msg }\n`);
    process.exit(1);
}

function parseArgs(argv) {
    const args = { url: UPSTREAM_URL, branch: 'master', dryRun: false };
    for(let i = 0; i < argv.length; ++i) {
        switch(argv[i]) {
        case '--url': args.url = argv[++i]; break;
        case '--branch': args.branch = argv[++i]; break;
        case '--dry-run': args.dryRun = true; break;
        case '--help': case '-h':
            process.stdout.write('usage: node tools/sync-upstream.mjs [--url <git-url>] ' +
                '[--branch <name>] [--dry-run]\n');
            process.exit(0);
            break;
        default: fatal(`unknown argument: ${ argv[i] }`);
        }
    }
    return args;
}

// Upstream uses tabs for indentation only — a tab inside a line lives in a string — so the leading run is
// what carries the indentation: each tab becomes 4 spaces and the rest of the line stays byte for byte.
function convert(file) {
    const text = readFileSync(file, 'utf8');
    if(text.includes('\0')) {
        return false;
    }
    const converted = text.replace(/^\t+/gm, m => ' '.repeat(INDENT * m.length));
    if(converted === text) {
        return false;
    }
    writeFileSync(file, converted);
    return true;
}

function convertTracked() {
    const changed = [];
    for(const file of git(['ls-files', '-z']).out.split('\0')) {
        if(!file || SKIP_FILES.has(file)) {
            continue;
        }
        try {
            if(convert(file)) {
                changed.push(file);
            }
        } catch(err) {
            if(err.code !== 'EISDIR') {
                throw err;
            }
        }
    }
    return changed;
}

function list(files, limit = 8) {
    for(const file of files.slice(0, limit)) {
        console.log(`  ${ file }`);
    }
    if(files.length > limit) {
        console.log(`  … and ${ files.length - limit } more`);
    }
}

const args = parseArgs(process.argv.slice(2));
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
if(branch === 'HEAD') {
    fatal('detached HEAD — check out a branch first');
}
if(git(['status', '--porcelain']).out.trim()) {
    fatal('working tree is not clean — commit or stash first (the script reuses the worktree)');
}
if(!git(['remote']).out.split('\n').includes(UPSTREAM_REMOTE)) {
    console.log(`adding remote ${ UPSTREAM_REMOTE } → ${ args.url }`);
    git(['remote', 'add', UPSTREAM_REMOTE, args.url]);
}
const upstreamRef = `${ UPSTREAM_REMOTE }/${ args.branch }`;
console.log(`fetching ${ upstreamRef } …`);
git(['fetch', UPSTREAM_REMOTE, args.branch, '--no-tags'], { quiet: false });
const ahead = git(['rev-list', '--count', `${ branch }..${ upstreamRef }`]).out.trim();
if(ahead === '0') {
    console.log(`upstream has nothing new — ${ branch } already contains ${ upstreamRef }`);
    process.exit(0);
}
console.log(`upstream is ${ ahead } commit(s) ahead of ${ branch }`);

console.log(`\n=== landing upstream in this fork's convention on ${ CONVERT_BRANCH }`);
git(['checkout', '-B', CONVERT_BRANCH, upstreamRef]);
const converted = convertTracked();
if(converted.length) {
    git(['add', '-A']);
    git(['commit', '-q', '-m', `Convert upstream to ${ INDENT } spaces for the merge`]);
    console.log(`converted ${ converted.length } file(s), for example:`);
    list(converted);
} else {
    console.log('nothing to convert — upstream already matches this fork');
}
git(['checkout', '-q', branch]);

if(args.dryRun) {
    console.log('\n--dry-run: stopping before the merge. Inspect it with:');
    console.log(`  git diff ${ branch }...${ CONVERT_BRANCH }`);
    process.exit(0);
}

console.log(`\n=== merging ${ CONVERT_BRANCH } into ${ branch }`);
// ignore-space-change is what keeps the merge workable: our side converted the same lines the same way, and
// git would otherwise call every one of them a conflict
git(['merge', '--no-commit', '-X', 'ignore-space-change', CONVERT_BRANCH], { quiet: false, allowFail: true });
const conflicts = git(['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean);
// generated files are restored to ours whether they conflicted or merged cleanly: the file the build writes
// is the only meaningful one, and it is regenerated from the merged modules
const artifacts = git(['diff', '--name-only', 'HEAD']).out.split('\n')
    .filter(file => ARTIFACTS.includes(file));
for(const file of artifacts) {
    git(['checkout', 'HEAD', '--', file]);
}
// anything that came over from upstream is already converted; this pass covers the leftovers and never adds a
// file that still carries conflict markers, so git keeps it marked unresolved
const conflictSet = new Set(conflicts);
const leftovers = convertTracked().filter(file => !conflictSet.has(file));
for(const file of leftovers) {
    git(['add', '--', file]);
}

console.log('\n=== result');
if(conflicts.length) {
    console.log(`conflicts to resolve (real code, not whitespace): ${ conflicts.length }`);
    list(conflicts, 20);
} else {
    console.log('no conflicts');
}
if(artifacts.length) {
    console.log(`kept the fork's copy of ${ artifacts.length } generated file(s) — the build rewrites them`);
}
if(leftovers.length) {
    console.log(`converted leftovers from upstream in ${ leftovers.length } file(s)`);
}
console.log('\nnext:');
console.log(conflicts.length ? '  1. resolve the files above — the indentation is already ours\n' +
    '  2. npx gulp bump && npx gulp make\n  3. test, then commit the merge'
    : '  1. npx gulp bump && npx gulp make\n  2. test, then commit the merge');
process.exit(conflicts.length ? 3 : 0);
