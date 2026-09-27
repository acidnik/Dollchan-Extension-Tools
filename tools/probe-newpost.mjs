/* ==[ tools/probe-newpost.mjs ]=============================================================================
            SIMULATE A POST ARRIVING THROUGH THE UPDATER AND REPORT HOW DOLLCHAN TREATED IT
   The updater's own response is intercepted and one extra post is appended to it, so the app runs its real
   "new post" path (Thread._addPost -> Post.hideBySimilarText) while nothing is posted on the board.

   Usage:
     npx gulp make
     node tools/probe-newpost.mjs                        # check the current build
     BUNDLE=/tmp/before.js node tools/probe-newpost.mjs  # the same run against an older build

   MENU_CLICKS=2 expects the reverse: the second click drops the rule, so the arriving post stays visible.
   Environment: BUNDLE, BOARD (b), THREAD (auto-picked), MENU_ITEM (hide-text), MENU_CLICKS (1),
                EXPECT (hidden|visible), HEADLESS, TIMEOUT
   Exit code: 0 when the arriving post ends up as EXPECT says, 1 otherwise.
=========================================================================================================== */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getChromium, launchOptions } from './lib/browser.mjs';

const HOST = 'https://2ch.hk';
const BOARD = process.env.BOARD ?? 'b';
const MENU_ITEM = process.env.MENU_ITEM ?? 'hide-text';
const MENU_CLICKS = +(process.env.MENU_CLICKS ?? 1);
const EXPECT = process.env.EXPECT ?? 'hidden';
const TIMEOUT = +(process.env.TIMEOUT ?? 60000);
const BUNDLE = process.env.BUNDLE ?
	path.resolve(process.env.BUNDLE) :
	fileURLToPath(new URL('../src/Dollchan_Extension_Tools.es6.user.js', import.meta.url));

if(!existsSync(BUNDLE)) {
	console.error(`Missing ${ BUNDLE }\nRun \`npx gulp make\` first.`);
	process.exit(2);
}

// The reference post only needs text, and the synthetic post copies that text, so the similarity check is
// bound to match. Prefer a thread that has been idle, because a real post can otherwise take the number of
// the synthetic one while the probe runs — but on a busy board every fresh thread is bumped nonstop, so
// idleness is a preference, not a requirement.
const stripTags = html => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
const idleMinutes = post => (Date.now() / 1e3 - +(post.lasthit ?? post.timestamp ?? 0)) / 60;
async function pickThread() {
	if(process.env.THREAD) {
		return +process.env.THREAD;
	}
	const index = await (await fetch(`${ HOST }/${ BOARD }/index.json`)).json();
	const candidates = index.threads
		.filter(({ posts_count: count }) => +count >= 4)
		.sort((a, b) => +b.posts_count - +a.posts_count)
		.slice(0, 10);
	const usable = [];
	for(const { thread_num: num } of candidates) {
		const data = await (await fetch(`${ HOST }/${ BOARD }/res/${ num }.json`)).json();
		const { posts } = data.threads[0];
		const words = Math.max(...posts.slice(1)
			.map(post => stripTags(post.comment ?? '').trim().split(/\s+/).filter(Boolean).length));
		if(words >= 8) {
			usable.push({ num: +num, words, idle: Math.max(...posts.map(idleMinutes)) });
		}
	}
	if(!usable.length) {
		throw new Error(`no thread with a long enough reply on ${ BOARD }; pass THREAD=<num> explicitly`);
	}
	const best = usable.sort((a, b) => b.idle - a.idle)[0];
	console.error(`[pick] thread ${ best.num }: longest reply ~${ best.words } words, ` +
		`idle for ${ Math.round(best.idle) }m (of ${ usable.length } candidates)`);
	return best.num;
}

const THREAD = await pickThread();
const THREAD_URL = `${ HOST }/${ BOARD }/res/${ THREAD }.html`;

const chromium = await getChromium();
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({ locale: 'ru-RU' });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message.slice(0, 140)));
page.on('console', m => {
	if(m.type() === 'error' && !/Content Security Policy|favicon|devtools/.test(m.text())) {
		pageErrors.push(m.text().replace(/\s+/g, ' ').slice(0, 140));
	}
});

// The updater asks for <board>/res/<thread>.json; while `inject` holds a post, that response grows one.
let inject = null;
let jsonRequests = 0;
let injectedResponses = 0;
page.on('response', r => {
	// Only the board is interesting here: a thread with YouTube links also makes Dollchan fetch video
	// titles from googleapis.com with its built-in key, and Google answers those with 403
	if(r.status() >= 400 && r.url().includes(`/${ BOARD }/`)) {
		console.error(`[http] ${ r.status() } ${ r.url().slice(0, 90) }`);
	}
});
// Routing must be context-level and the HTTP cache must be off: a response served from the cache never
// reaches a route handler, so the injection would be skipped without any sign of it.
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
await ctx.route(`**/${ BOARD }/res/${ THREAD }.json*`, async route => {
	jsonRequests++;
	if(!inject) {
		await route.continue();
		return;
	}
	const res = await route.fetch();
	if(!res.ok()) {
		console.error(`[route] cannot rewrite, upstream said ${ res.status() }`);
		await route.fulfill({ response: res });
		return;
	}
	const json = await res.json();
	const { posts } = json.threads[0];
	posts.push({ ...posts[posts.length - 1], ...inject, files: null, op: false });
	// The builder derives its length from posts_count, so without this the added post stays invisible
	json.posts_count += 1;
	injectedResponses++;
	// The payload stays armed on purpose: AjaxCache drops the first response and repeats the request with
	// ?nocache= when the answer has no Cache-Control, and the app uses only that second one
	await route.fulfill({ json });
});

await page.addInitScript({ path: BUNDLE });
await page.goto(THREAD_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
// The reply form stays hidden until the user opens it, so wait for a parsed post instead: the presence of
// Dollchan's own buttons proves the delform was processed
await page.waitForSelector('[data-num] .de-post-btns', { timeout: TIMEOUT });
await page.waitForTimeout(2000);

const countHidden = () => page.evaluate(() =>
	document.querySelectorAll('[data-num] .de-btn-unhide, [data-num] .de-btn-unhide-user').length);

// The reference post: the reply with the longest message, so its word list is long enough for the
// similarity threshold (findSameText ignores short words once there are more than six of them).
const ref = await page.evaluate(() => {
	let best = null;
	for(const el of document.querySelectorAll('.post_type_reply[data-num]')) {
		const msg = el.querySelector('.post__message');
		const text = msg?.innerText.trim() ?? '';
		if(!best || text.length > best.text.length) {
			best = { num: +el.dataset.num, text, comment: msg.innerHTML };
		}
	}
	return best;
});

const hiddenBefore = await countHidden();
const postEl = page.locator(`.post_type_reply[data-num="${ ref.num }"]`);
// On desktop the hide menu opens on hover; clicking the button would just toggle the post instead. The
// clicked post hides itself too, so a second click asks for the reverse and must drop the rule again.
for(let i = 0; i < MENU_CLICKS; ++i) {
	await postEl.locator('.de-btn-hide, .de-btn-hide-user, .de-btn-unhide, .de-btn-unhide-user').hover();
	const menuItem = page.locator(`.de-menu-item[info="${ MENU_ITEM }"]`);
	await menuItem.waitFor({ state: 'visible', timeout: 10000 });
	await menuItem.click();
	await page.waitForTimeout(1000);
}
const hiddenAfter = await countHidden();

// The synthetic post: same text as the reference, with a number that leaves room above the last post of
// the thread. A busy board can post into the thread while the probe runs, and a real post taking the
// synthetic number would make the outcome meaningless; the app indexes posts by position, not by number.
await page.evaluate(() => window.scrollTo(0, 0));
const lastNum = await page.evaluate(() =>
	Math.max(...[...document.querySelectorAll('[data-num]')].map(el => +el.dataset.num)));
const newNum = lastNum + 1000;
inject = { num: newNum, comment: ref.comment, subject: '', subject_sage: false };
const domBefore = await page.evaluate(() => document.querySelectorAll('[data-num]').length);

// 'U' is the default "Update thread" hotkey. It is ignored while focus sits in a text field
// (Hotkeys.js adds 0x8000 to the key code for inputs and textareas), so drop the focus first.
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('u');
const newSelector = `.post_type_reply[data-num="${ newNum }"]`;
let arrived = true;
try {
	// 'attached', not the default 'visible': a post hidden by the app is still in the DOM
	await page.waitForSelector(newSelector, { state: 'attached', timeout: 30000 });
} catch(err) {
	arrived = false;
}

inject = null; // stop adding the synthetic post to further responses
const result = {
	thread              : THREAD_URL,
	bundle              : BUNDLE,
	jsonRequests,
	injectedResponses,
	reference           : { num: ref.num, words: ref.text.split(/\s+/).length },
	similarHiddenByClick: hiddenAfter - hiddenBefore,
	errors              : pageErrors,
	newPost             : null
};
if(arrived) {
	result.newPost = await page.evaluate(sel => {
		const el = document.querySelector(sel);
		const btn = el.querySelector('.de-btn-hide, .de-btn-unhide, .de-btn-hide-user, .de-btn-unhide-user');
		// className is SVGAnimatedString on an <svg> and a plain string elsewhere
		const { baseVal } = btn.className;
		return {
			num    : +el.dataset.num,
			btn    : baseVal ?? btn.className,
			hidden : /de-btn-unhide/.test(baseVal ?? btn.className),
			note   : el.querySelector('.de-note, .de-post-note')?.textContent.trim() ?? null,
			visible: el.offsetParent !== null
		};
	}, newSelector);
}

result.dom = {
	before: domBefore,
	after : await page.evaluate(() => ({
		count   : document.querySelectorAll('[data-num]').length,
		lastNums: [...document.querySelectorAll('[data-num]')].slice(-3).map(el => +el.dataset.num)
	}))
};
console.log(JSON.stringify(result, null, 1));
await browser.close();

if(!arrived) {
	console.error('\nFAIL: the synthetic post never showed up — its response was not used by the updater');
	process.exit(2);
}
const { hidden } = result.newPost;
const pass = hidden === (EXPECT === 'hidden');
console.log(pass ? `\nOK: the arriving post is ${ EXPECT } as expected` :
	`\nFAIL: the arriving post is ${ hidden ? 'hidden' : 'visible' }, expected ${ EXPECT }`);
process.exitCode = pass ? 0 : 1;
