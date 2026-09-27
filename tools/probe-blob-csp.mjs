/* ==[ tools/probe-blob-csp.mjs ]============================================================================
              MINIMAL PROBE: CAN fetch()/XHR READ A blob: URL, AND DOES THE PAGE CSP MATTER?
   The pattern: when a request inside the app fails, do not reason about it from the app's source —
   isolate the mechanism in a few lines, in every world the project runs in, with and without a
   restrictive CSP. This probe identified why Ctrl+V paste broke on endchan.org: the transports were
   fine, the site's CSP was not (a CSP-blocked request reports status 0, which the app reads as an error).

   Worlds: the page's main world (a grant-less userscript) and an extension content script (isolated
   world). The page is served by an http server started inside this script, because content scripts only
   inject into real http(s) origins — nothing external to clean up.

   Usage: node tools/probe-blob-csp.mjs
   Environment: HEADLESS=0 to watch it, CHROME_PATH / PLAYWRIGHT_PATH to override discovery.
=========================================================================================================== */

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { getChromium, launchOptions } from './lib/browser.mjs';

const EXT_DIR = fileURLToPath(new URL('./probe-ext', import.meta.url));
const HTML = '<!DOCTYPE html><html><body><h1>blob transport probe</h1></body></html>';

// Same shape as the CSP that broke the paste on endchan.org: no connect-src, so connect-src falls back
// to default-src, which does not allow blob:.
const CSP_HEADER = 'default-src \'self\' \'unsafe-inline\'; img-src \'self\' data:';

const server = createServer(({ url }, res) => {
	const headers = { 'content-type': 'text/html; charset=utf-8' };
	if(url === '/csp') {
		headers['content-security-policy'] = CSP_HEADER;
	}
	res.writeHead(200, headers);
	res.end(HTML);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const ORIGIN = `http://127.0.0.1:${ server.address().port }`;

// Runs in the page's main world. Both transports, each reported as [name, status, detail].
const pageProbe = async () => {
	const log = [];
	const check = async (name, fn) => {
		try {
			log.push([name, 'ok', await fn()]);
		} catch(err) {
			log.push([name, 'FAIL', String(err).slice(0, 60)]);
		}
	};
	const bytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4]);
	const url = URL.createObjectURL(new File([bytes], 'image.png', { type: 'image/png' }));
	log.push(['world', 'page (main world)'], ['blobUrl', new URL(url).origin]);
	await check('fetch', async () => {
		const res = await fetch(url);
		return (await res.arrayBuffer()).byteLength;
	});
	await check('xhr', () => new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.onreadystatechange = () => {
			if(xhr.readyState === 4) {
				if(xhr.status === 200) {
					resolve(xhr.response?.byteLength);
				} else {
					reject(new Error(`status ${ xhr.status }`));
				}
			}
		};
		xhr.onerror = () => reject(new Error('onerror'));
		xhr.open('GET', url, true);
		xhr.responseType = 'arraybuffer';
		xhr.send(null);
	}));
	URL.revokeObjectURL(url);
	return log;
};

const chromium = await getChromium();
// A persistent context is required for --load-extension; an empty userDataDir means a temporary profile.
const args = [`--disable-extensions-except=${ EXT_DIR }`, `--load-extension=${ EXT_DIR }`];
const ctx = await chromium.launchPersistentContext('', launchOptions({ args }));

const logs = [];
for(const path of ['/nocsp', '/csp']) {
	const page = await ctx.newPage();
	page.on('console', m => {
		if(m.text().startsWith('DEPROBE ')) {
			logs.push([path, JSON.parse(m.text().slice('DEPROBE '.length)).log]);
		}
	});
	await page.goto(ORIGIN + path, { waitUntil: 'load' });
	await page.waitForTimeout(2500); // the content script reports asynchronously
	logs.push([path, await page.evaluate(pageProbe)]);
	await page.close();
}
await ctx.close();
await new Promise(resolve => server.close(resolve));

const rows = [];
for(const [path, log] of logs) {
	const [world] = log.find(entry => entry[0] === 'world')?.slice(1) ?? ['unknown'];
	const origin = log.find(entry => entry[0] === 'blobUrl')?.[1];
	for(const [name, status, detail] of log.filter(entry => entry[0] !== 'world' && entry[0] !== 'blobUrl')) {
		rows.push({ path, world, origin, name, status, detail });
	}
}
const label = path => path === '/csp' ? '/csp (blob-blocking CSP)' : '/nocsp (no CSP)';
console.log(`server: ${ ORIGIN }`);
console.log('\npath                    | world             | transport | result');
for(const row of rows) {
	console.log(`${ label(row.path).padEnd(25) } | ${ row.world.padEnd(17) } | ${ row.name.padEnd(9) } | ${
		row.status === 'ok' ? `ok (${ row.detail } bytes)` : row.status }`);
}
console.log('\nRead it as: a transport that works without a CSP but fails with one was blocked by that CSP,');
console.log('not broken and not a CORS problem — a blocked request surfaces as status 0.');
