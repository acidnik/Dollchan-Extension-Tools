# tools/ — browser debug scripts

Runnable examples for investigating Dollchan bugs against a **real** board. They exist because the
outcome of most board bugs is decided at runtime — by the board's engine flags (`BoardDetector.js`), the
site's CSP and its live HTML — none of which is visible from reading the source alone.

```
tools/
  lib/browser.mjs          # locates playwright + a cached Chromium (no hardcoded paths or revisions)
  repro-file-paste.mjs     # attach a file to the postform on a real board (Ctrl+V / drag&drop)
  probe-blob-csp.mjs       # minimal probe: fetch/XHR of a blob: URL, with and without a CSP
  probe-ext/               # 15-line MV3 extension used by the probe (content script = isolated world)
```

## Prerequisites

- Node.js 18+ (uses ESM top-level `await`).
- Playwright importable somewhere — `npm i -D playwright`, or point `PLAYWRIGHT_PATH` at any
  `node_modules/playwright/index.js`. `tools/lib/browser.mjs` also finds a playwright installed by pi.
- A Chromium build matching the playwright revision, e.g. in `~/.cache/ms-playwright`. The scripts pick
  the newest cached revision automatically; override with `CHROME_PATH`. Prefer the full `chromium-*`
  build — `chrome-headless-shell` cannot load extensions, which the probe needs.
- `npx gulp make` before running anything: the harness loads the generated
  `src/Dollchan_Extension_Tools.es6.user.js`, not `src/modules/*`.

## repro-file-paste.mjs

Injects the built userscript into a live board, dispatches the same event a user does, and reports whether
the form accepted the file. Exits `0` on success and `1` otherwise, so it doubles as a check.

```sh
npx gulp make
node tools/repro-file-paste.mjs                                # Ctrl+V into https://endchan.org/b/
ACTION=drop   node tools/repro-file-paste.mjs                  # same via drag&drop
BOARD_URL=https://other.board/b/ node tools/repro-file-paste.mjs
HEADLESS=0 node tools/repro-file-paste.mjs                     # watch it happen
```

| Env | Default | Meaning |
| --- | --- | --- |
| `BOARD_URL` | `https://endchan.org/b/` | Board to open |
| `ACTION` | `paste` | `paste` (Ctrl+V) or `drop` (drag&drop) |
| `FILE_NAME` | `image.png` | Name of the synthetic 1×1 PNG |
| `BUNDLE` | `src/Dollchan_Extension_Tools.es6.user.js` | Bundle to inject — point it at an older build to A/B |
| `HEADLESS`, `TIMEOUT` | `1`, `60000` | Browser mode, navigation timeout |

The report contains the DOM state before/after (file name in `.de-file-txt-input`, thumbnail slot, every
`[id^="de-popup-"]` with its text), plus `pageErrors` and `requestFailures`. **CSP blocks are only visible
there** — a blocked request never produces a usable response object, it just fails with status 0.

Useful habit: run `ACTION=drop` right after a failed `ACTION=paste`. If both fail identically, the problem
is not in the paste handler.

A passing run may still list a `blob:… :: csp` failure: that is the *preview thumbnail* (`img.src`), which
endchan also blocks via `img-src`, not the attached file. The verdict comes from the form state
(`fileNameShown`), so read `requestFailures` rather than counting it.

Recorded runs against `https://endchan.org/b/` (Chromium from playwright revision 1234, 2026), which show
the harness can actually fail:

| bundle | `ACTION=paste` | `ACTION=drop` |
| --- | --- | --- |
| before the Ctrl+V fix | exit 1 — `fileNameShown: ""`, popup `Не могу загрузить URL: blob:…` | exit 0 |
| after the fix | exit 0 — `fileNameShown: "image.png"` | exit 0 |

That contrast is the whole point: only the paste path was broken, so a naive "it fails on this board"
report would have pointed at the board rather than at the handler.

## probe-blob-csp.mjs

Serves a local page (http server inside the script, no external process) in two flavours — with and without
a `default-src` CSP that disallows `blob:` — and tries to read a `blob:` URL back with both `fetch` and
`XMLHttpRequest` from two worlds: the page's main world (a grant-less userscript) and an extension content
script (isolated world).

```sh
node tools/probe-blob-csp.mjs
```

Recorded result (Chromium from playwright revision 1234, 2026):

| path | world | fetch | xhr |
| --- | --- | --- | --- |
| no CSP | main world | ok | ok |
| no CSP | content script | ok | ok |
| blob-blocking CSP | main world | **FAIL** | **FAIL** |
| blob-blocking CSP | content script | ok | ok |

Two conclusions worth remembering:

- A transport that works without a CSP but fails with one is a **CSP-blocked request**, not a broken
  transport and not a CORS problem. That is what broke Ctrl+V on endchan.org (`connect-src` falls back to
  `default-src`, which does not list `blob:`).
- A content script is **exempt from the page's CSP**, so this class of bug hits the userscript build while
  the browser extension keeps working. Always check which build the user is running before assuming.

## Adapting these to another bug

1. Rebuild first (`npx gulp make`); the scripts load the generated bundle.
2. Inject it before navigation so it runs in the main world:
   `await page.addInitScript({ path: '<repo>/src/Dollchan_Extension_Tools.es6.user.js' })`.
   Without `GM_*`/`chrome.storage` Dollchan falls back to `localStorage` and `scriptHandler: 'In-page'`
   (`Browser.js`) — fine for UI/form/post bugs, but it never exercises privileged paths such as
   `GM_xmlhttpRequest`.
3. Reproduce the user's action with the event that carries the payload (`ClipboardEvent('paste', …)`,
   `DragEvent('drop', …)`) — `element.click()` will not do, the handler reads the event object.
4. Assert a **language-independent** postcondition (a class, an input value, a popup id). Dollchan picks
   its language from `navigator.language` in `readCfg()`, so text assertions break with the locale.
5. Always subscribe to `console`, `pageerror` and `requestfailed` — that is where CSP violations and
   uncaught errors show up.
6. Expect noise from the site itself: live boards ship their own scripts, ads and CSP-blocked beacons, so
   separate their errors from the ones you caused.

See the "Finding your way around (debugging)" and "Reproducing a board bug in a real browser" sections of
the repository `AGENTS.md` for where to look in the source once you have a repro.
