/* ==[ tools/repro-file-paste.mjs ]==========================================================================
                     REGRESSION HARNESS: ATTACH A FILE TO THE POSTFORM ON A REAL BOARD
   Injects the built userscript into a live imageboard and does what a user does — Ctrl+V paste or
   drag&drop into the reply form — then reports the form state and every diagnostic the page produced.

   Why a real board and not a unit test: the outcome is decided by the site (its CSP, its HTML) together
   with the board flags in BoardDetector.js, and neither is visible from the source alone.

   Usage:
     npx gulp make                                # the harness loads the generated bundle
     node tools/repro-file-paste.mjs              # paste into https://endchan.org/b/
     ACTION=drop node tools/repro-file-paste.mjs  # same via drag&drop
     BOARD_URL=https://other.imageboard/b/ node tools/repro-file-paste.mjs

   Environment: BOARD_URL, ACTION=paste|drop, FILE_NAME, IMG_SIZE, BUNDLE, HEADLESS, TIMEOUT
   Exit code: 0 when the form accepted the file, 1 otherwise (so it doubles as a check), 2 on a bad setup.
=========================================================================================================== */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getChromium, launchOptions } from './lib/browser.mjs';

// Overriding BUNDLE lets you A/B two builds, e.g. a bundle saved from an earlier commit.
const BUNDLE = process.env.BUNDLE ?
    path.resolve(process.env.BUNDLE) :
    fileURLToPath(new URL('../src/Dollchan_Extension_Tools.es6.user.js', import.meta.url));
const BOARD_URL = process.env.BOARD_URL ?? 'https://endchan.org/b/';
const ACTION = process.env.ACTION ?? 'paste';
const FILE_NAME = process.env.FILE_NAME ?? 'image.png';
const [IMG_W, IMG_H] = (process.env.IMG_SIZE ?? '400x300').split('x').map(Number);
const TIMEOUT = +(process.env.TIMEOUT ?? 60000);

if(!existsSync(BUNDLE)) {
    console.error(`Missing ${ BUNDLE }\nRun \`npx gulp make\` first.`);
    process.exit(2);
}

// Makes the test file in the page, using the browser's own PNG encoder: a hand-written base64 blob is easy
// to get subtly wrong and then the run silently tests nothing. Two squares, so the preview is not flat.
// A paste event carries its payload in clipboardData, a drop event in dataTransfer, and `element.click()`
// cannot reproduce either — the handler reads the event.
async function dispatchAction({ mode, name, width, height }) {
    const txta = document.querySelector('.de-textarea');
    if(!txta) {
        throw new Error('no .de-textarea — Dollchan did not run on this page');
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#c33';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#3c3';
    ctx.fillRect(0, 0, width / 2, height / 2);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], name, { type: 'image/png' }));
    const target = mode === 'drop' ? document.querySelector('.de-file-txt-input') ?? txta : txta;
    target.dispatchEvent(mode === 'drop' ?
        new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }) :
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}

async function probe() {
    const chromium = await getChromium();
    const browser = await chromium.launch(launchOptions());
    // ru-RU makes Dollchan pick lang=0 (readCfg maps navigator.language); assertions below stay
    // language-independent anyway.
    const ctx = await browser.newContext({ locale: 'ru-RU' });
    const page = await ctx.newPage();

    const pageErrors = [];
    const requestFailures = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    // The document CSP decides whether a blob:/data: preview can render at all, so record it in both
    // shapes it can arrive in: a response header, or a <meta http-equiv> read from the DOM.
    const csp = { header: null, meta: null };
    page.on('response', async r => {
        if(r.request().isNavigationRequest() && r.frame() === page.mainFrame()) {
            csp.header = (await r.allHeaders())['content-security-policy'] ?? null;
        }
    });
    // A CSP-blocked request never yields a usable response object, so it is only observable here:
    // the URL shows up as `requestfailed <url> :: csp`, next to a console.error naming the directive.
    // Live sites also fail requests for unrelated reasons, so read this list, do not just count it.
    page.on('requestfailed', r =>
        requestFailures.push(`${ r.url().slice(0, 90) } :: ${ r.failure()?.errorText }`));

    await page.addInitScript({ path: BUNDLE });
    await page.goto(BOARD_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(6000); // Dollchan parses the delform asynchronously

    const readState = () => page.evaluate(() => {
        // Did the preview actually render? A blocked src leaves the element in place but empty, so the
        // slot being present is not evidence; the reported size also proves the downscaling.
        const media = document.querySelector('.de-file:not(.de-file-off) .de-file-img[src]');
        const size = media && (media.naturalWidth || media.videoWidth);
        return {
            dollchanRunned: !!document.querySelector('#de-main-container, .de-parea'),
            textarea      : !!document.querySelector('.de-textarea'),
            fileNameShown : document.querySelector('.de-file-txt-input')?.value ?? null,
            thumbSlot     : !!document.querySelector('.de-file:not(.de-file-off)'),
            thumbMedia    : media ? `${ media.tagName.toLowerCase() } ${ media.src.slice(0, 22) }` : null,
            thumbRendered : size ? `${ size }x${ media.naturalHeight || media.videoHeight }` : false,
            popups        : [...document.querySelectorAll('[id^="de-popup-"]')]
                .map(el => `${ el.id } => ${ el.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) }`)
        };
    });

    // The meta tag is only in the DOM, the header only on the response
    csp.meta = await page.evaluate(() =>
        document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? null);
    const before = await readState();
    if(!before.textarea) {
        await browser.close();
        console.error(`Dollchan found no reply form on ${ BOARD_URL } — point BOARD_URL at a board page.`);
        process.exit(2);
    }
    await page.evaluate(dispatchAction, { mode: ACTION, name: FILE_NAME, width: IMG_W, height: IMG_H });
    await page.waitForTimeout(4000);
    const after = await readState();

    await browser.close();
    const accepted = after.fileNameShown === FILE_NAME;
    return {
        action: ACTION,
        board : BOARD_URL,
        file  : `${ FILE_NAME } (${ IMG_W }x${ IMG_H })`,
        accepted,
        csp,
        before,
        after,
        pageErrors,
        requestFailures
    };
}

const report = await probe();
console.log(JSON.stringify(report, null, 1));
console.log(report.accepted ?
    `\nOK: the form accepted ${ report.action } of ${ report.file }` :
    `\nFAIL: the form did not accept ${ report.action } — see popups and requestFailures above`);
process.exitCode = report.accepted ? 0 : 1;
