/* ==[ tools/probe-reply-refresh.mjs ]=======================================================================
        DOES A REPLY APPEAR BY ITSELF ON A BOARD THAT RENDERS THE THREAD WITH A LAG?
   Drives a real reply submit and then controls both responses: the POST is answered locally (nothing is sent
   to the board) and the thread page is served first WITHOUT the new post and later WITH it, which is what a
   board like endchan does when it renders the thread from a snapshot taken before the reply was stored.
   The probe then reports whether the post showed up on its own, and how many attempts it took.

   Usage:
     npx gulp make
     node tools/probe-reply-refresh.mjs                        # check the current build
     BUNDLE=/tmp/before.js node tools/probe-reply-refresh.mjs  # the same run against an older build
     STALE_FETCHES=3 node tools/probe-reply-refresh.mjs        # the post appears only on the last retry

   Environment: BOARD_URL, BUNDLE, STALE_MS (1500), ADD_POST_FORM, HEADLESS, TIMEOUT
   Exit code: 0 when the reply appeared without a manual refresh, 1 otherwise.
=========================================================================================================== */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getChromium, launchOptions, seedCfg } from './lib/browser.mjs';

// The test board requires a captcha, so even a request that escapes cannot create a post there
const BOARD_URL = process.env.BOARD_URL ?? 'https://endchan.org/test/res/6520.html';
// How long the board "lags": thread responses requested within this window are served without the new post
const STALE_MS = +(process.env.STALE_MS ?? 1500);
// Dollchan's Cfg.addPostForm: 0 = form at the top, 1 = at the bottom, 2 = hidden (default). The bottom mode
// is the one where the reply area ends up nested in the board's own form, so it is worth testing separately.
const ADD_POST_FORM = process.env.ADD_POST_FORM ?? null;
// The alternative reply form layout (Cfg.altLayout) is worth testing here too: it moves the whole form
const ALT_LAYOUT = !!process.env.ALT_LAYOUT;
const TIMEOUT = +(process.env.TIMEOUT ?? 60000);
const BUNDLE = process.env.BUNDLE ?
    path.resolve(process.env.BUNDLE) :
    fileURLToPath(new URL('../src/Dollchan_Extension_Tools.es6.user.js', import.meta.url));

if(!existsSync(BUNDLE)) {
    console.error(`Missing ${ BUNDLE }\nRun \`npx gulp make\` first.`);
    process.exit(2);
}

const chromium = await getChromium();
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({ locale: 'ru-RU' });
const page = await ctx.newPage();
const startedAt = Date.now();
const at = () => `${ Date.now() - startedAt }ms`;
const REPLY_TEXT = 'harness message, the POST is answered locally';
const fetches = [];
const pageErrors = [];
let posted = null;
page.on('pageerror', e => pageErrors.push(e.message.slice(0, 140)));

const seed = {};
if(ADD_POST_FORM !== null) {
    seed.addPostForm = +ADD_POST_FORM;
}
if(ALT_LAYOUT) {
    seed.altLayout = 1;
}
if(Object.keys(seed).length) {
    await seedCfg(page, 'endchan.org', seed);
}
await page.addInitScript({ path: BUNDLE });
await page.goto(BOARD_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
// The reply form stays hidden until the user opens it, so wait for a parsed post instead
await page.waitForSelector('.innerPost .de-post-btns', { timeout: TIMEOUT });
await page.waitForTimeout(2000);

// The post the board "creates": a clone of the last one with a free number. It exists only in the response
// this harness serves, so nothing has to be posted anywhere.
const { staleHtml, freshHtml, fakeNum, maxNum } = await page.evaluate(async url => {
    const html = await (await fetch(url)).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // LynxChan takes the post number from the deletion checkbox name ("board-thread-post"), and the post
    // element Dollchan wraps is the .postCell that contains it
    const cells = [...doc.querySelectorAll('.postCell[id]')];
    const maxNum = Math.max(...cells.map(el => +el.id));
    const fakeNum = maxNum + 100000; // far above anything the board can have assigned meanwhile
    const clone = cells[cells.length - 1].cloneNode(true);
    clone.id = String(fakeNum);
    const box = clone.querySelector('.deletionCheckBox');
    box.setAttribute('name', box.getAttribute('name').replace(/[^-]+$/, fakeNum));
    clone.querySelector('.divMessage').textContent = 'synthetic reply, served only by the harness';
    // Keep the clone inert but structurally intact: dropping links would remove the .linkQuote element
    // that Post's constructor insists on, and the app would throw while importing the post
    clone.querySelectorAll('figure, img, video').forEach(el => el.remove());
    cells[cells.length - 1].after(clone);
    return { staleHtml: html, freshHtml: doc.documentElement.outerHTML, fakeNum, maxNum };
}, BOARD_URL);
console.error(`[setup] real max post ${ maxNum }, fake post ${ fakeNum }; the board catches up after ${
    STALE_MS }ms`);

// Nothing leaves as a write request: the reply POST is answered locally, with the payload a LynxChan board
// returns on success (the app takes the post number from it)
await ctx.route('**/*', async route => {
    const req = route.request();
    const url = req.url();
    if(req.method() !== 'GET') {
        // The reply form can end up nested in a board's own form when the reply area is moved up to the
        // posts, so check what the POST actually carries: our message, and nothing of that other form
        const body = req.postData() ?? '';
        posted = {
            url,
            hasMessage          : body.includes(encodeURIComponent(REPLY_TEXT)) || body.includes(REPLY_TEXT),
            // The board's reply fields (message, threadId, boardUri, password…) belong in the body; what must
            // never appear is anything from its actions form, where delete and report live, because our reply
            // form is nested inside it when the reply area is moved up to the posts
            hasActionsFormFields: /contentActions|deletionCheckBox|deleteFormButton/.test(body),
            length              : body.length
        };
        console.error(`[${ at() }] POST ${ url.slice(0, 60) } answered locally; body ${
            posted.length } bytes, message=${ posted.hasMessage }, ${
            posted.hasActionsFormFields ? 'ACTIONS FORM FIELDS LEAKED' : 'no foreign fields' }`);
        await route.fulfill({
            status     : 200,
            contentType: 'application/json',
            body       : JSON.stringify({ status: 'ok', data: String(fakeNum) })
        });
        return;
    }
    // The updater asks for the thread with ?nocache= now and then, so match the path, not the exact URL
    if(new URL(url).pathname === new URL(BOARD_URL).pathname) {
        const sinceSubmit = submitAt ? Date.now() - submitAt : null;
        fetches.push(Date.now() - startedAt);
        const isStale = sinceSubmit === null || sinceSubmit < STALE_MS;
        const served = isStale ? 'WITHOUT' : 'WITH';
        console.error(`[${ at() }] thread fetch #${ fetches.length } (${
            sinceSubmit === null ? 'before submit' : `+${ sinceSubmit }ms` }) -> ${ served } the post`);
        await route.fulfill({
            status     : 200,
            contentType: 'text/html; charset=utf-8',
            body       : isStale ? staleHtml : freshHtml
        });
        return;
    }
    await route.continue();
});

let submitAt = null;
await page.evaluate(text => {
    document.querySelector('.de-textarea').value = text;
}, REPLY_TEXT);
submitAt = Date.now();
await page.evaluate(() => document.querySelector('#formButton, #de-postform-submit').click());

// The reply must show up on its own: no manual refresh anywhere in this script. Poll while waiting, so the
// log shows what the app did and when.
const timeline = [];
let appeared = false;
for(let i = 0; i < 12 && !appeared; ++i) {
    await page.waitForTimeout(1000);
    const state = await page.evaluate(num => ({
        uploadPopup: document.querySelector('#de-popup-upload')?.textContent.replace(/\s+/g, ' ').slice(0, 60) ?? null,
        post       : !!document.querySelector(`.deletionCheckBox[name$="-${ num }"]`),
        nums       : [...document.querySelectorAll('.deletionCheckBox')].length
    }), fakeNum);
    appeared = state.post;
    timeline.push(`${ i + 1 }s fetches=${ fetches.length } post=${ state.post } posts=${ state.nums }` +
        ` popup=${ state.uploadPopup ?? '-' }`);
}
try {
    const postSel = `.deletionCheckBox[name$="-${ fakeNum }"]`;
    await page.waitForSelector(postSel, { state: 'attached', timeout: 12000 });
} catch(err) {
    appeared = false;
}
// Where the reply area ended up, and whether nesting it in the board's own form left that form intact
const placement = await page.evaluate(() => {
    const areas = [...document.querySelectorAll('.de-parea')];
    const bottom = areas[areas.length - 1];
    const rel = (a, b) => {
        if(!a || !b) {
            return null;
        }
        return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? 'before' : 'after';
    };
    const cells = [...document.querySelectorAll('.postCell')];
    const box = document.querySelector('.deletionCheckBox');
    const boardForm = document.querySelector('form[action$="contentActions.js"]');
    const ourForm = document.querySelector('#de-pform form');
    return {
        // the reply area must sit after the posts and above the board's bottom block: navigation links,
        // layout/colour selects and the delete/report buttons
        afterLastPost     : rel(bottom, cells[cells.length - 1]),
        beforeBottomNav   : rel(bottom, document.querySelector('p.bottomNav')),
        beforeDeleteReport: rel(bottom, document.querySelector('.contentAction')),
        boardFormIntact   : !!box && box.form === boardForm,
        // In the "form at the bottom" mode our form lives inside the board's form (nested <form> elements,
        // which the spec forbids), so record what the board's own scripts could see: they collect post
        // checkboxes with getElementsByClassName('deletionCheckBox'), so nothing of ours may match that
        ourFormNested     : !!ourForm && boardForm.contains(ourForm),
        ourInputs         : ourForm ? ourForm.elements.length : 0,
        oursLookLikePosts : ourForm ? ourForm.querySelectorAll('.deletionCheckBox, .postCell').length : 0
    };
});

const post = await page.evaluate(num => {
    const cell = document.querySelector(`.deletionCheckBox[name$="-${ num }"]`)?.closest('.postCell');
    return {
        found  : !!cell,
        visible: !!cell?.offsetParent,
        text   : cell?.querySelector('.divMessage')?.textContent.trim() ?? null
    };
}, fakeNum);

const popups = await page.evaluate(() => [...document.querySelectorAll('[id^="de-popup-"]')]
    .map(el => `${ el.id }: ${ el.textContent.replace(/\s+/g, ' ').trim().slice(0, 300) }`));

console.log(JSON.stringify({
    board        : BOARD_URL,
    bundle       : BUNDLE,
    postNum      : fakeNum,
    threadFetches: fetches.length,
    fetchTimes   : fetches,
    gaps         : fetches.slice(1).map((t, i) => t - fetches[i]),
    appeared,
    posted,
    placement,
    timeline,
    post,
    popups,
    pageErrors
}, null, 1));
await browser.close();

const postOk = posted?.hasMessage && !posted.hasActionsFormFields;
const placeOk = placement.afterLastPost === 'after' && placement.beforeBottomNav === 'before' &&
    placement.beforeDeleteReport === 'before' && placement.boardFormIntact &&
    // nesting our form in the board's form is only acceptable while nothing of ours looks like a post
    placement.oursLookLikePosts === 0;
console.log(appeared && postOk && placeOk ?
    '\nOK: the reply was posted with its own fields and appeared without a manual refresh' :
    `\nFAIL: appeared=${ appeared }, POST body ok=${ postOk }, placement ok=${ placeOk }`);
process.exitCode = appeared && postOk && placeOk ? 0 : 1;
