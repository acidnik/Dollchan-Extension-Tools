# AGENTS.md — Dollchan Extension Tools

Userscript + browser extension that adds features to imageboards (4chan, 2ch.hk, and engines like
Wakaba/Kusaba/Tinyboard/Vichan/TinyIB/LynxChan/FoolFuuka).

- **ESNext userscript:** `src/Dollchan_Extension_Tools.es6.user.js`
- **ES5 userscript:** `Dollchan_Extension_Tools.user.js`
- **Extensions:** `extension/v2` (MV2), `extension/v3` (MV3)
- **Source of truth:** `src/modules/*.js` — every file listed above is **generated**.

## Golden rule: never hand-edit generated files

`.gitattributes` marks them `linguist-generated=true`, so diffs are hidden and reviewers see nothing.

| Generated file | Produced by |
| --- | --- |
| `src/Dollchan_Extension_Tools.es6.user.js` | `gulp make:es6` (concat of `src/modules/*` + header from `.meta.js`) |
| `Dollchan_Extension_Tools.user.js` | `gulp make:es5` (browserify + babelify, comments stripped) |
| `extension/v2/Dollchan_Extension_Tools.es6.user.js` | `gulp copyext` (`<EXCLUDED_FROM_EXTENSION>` blocks removed) |
| `extension/v3/Dollchan_Extension_Tools.es6.user.js` | same as above |

Always edit `src/modules/*.js` (or `src/es5-polyfills.js`, `Dollchan_Extension_Tools.meta.js`) and rebuild.

The artifacts are committed exactly as the local build writes them, and their line endings follow the
checkout: upstream builds from a CRLF checkout, while on Linux the modules are LF, so a bundle ends up
mostly LF with a CRLF first line (the gulpfile's `make:es6` writes a leading `\r\n`). Their diffs are
binary-marked in `.gitattributes`, so this churn is invisible in review — **do not hand-normalize them**,
the next `make` undoes it. Compare them with `diff <(git show HEAD:<file> | tr -d '\r') <(tr -d '\r' < <file>)`
to see the real change.

## Build

`node_modules` is not committed. First run `npm install`, then use the local gulp CLI
(`npx gulp <task>` if there is no global `gulp`).

| Task | Effect |
| --- | --- |
| `gulp make` | full build: `make:es5` (which itself chains `make:es6`) |
| `gulp make:es6` | ESNext bundle only — does **not** refresh `extension/` |
| `gulp make:es5` | `make:es6` + ES5 bundle (`browserify`/`babelify`) + `copyext` |
| `gulp copyext` | copies the ESNext bundle into `extension/v2`, `extension/v3` (strips `<EXCLUDED_FROM_EXTENSION>` blocks) |
| `gulp make:modules` | **Destructive**: splits the built ESNext file back into `src/modules/*` |
| `gulp default` | `make` + watch on `src/modules/*`, `src/es5-polyfills.js`, `*.meta.js` |
| `gulp updatecommit` | Rewrites `const commit = '…'` in `Wrap.js` from `git rev-parse HEAD` |
| `gulp bump` | Increments the version in every file that carries it — run **before** `make` |

`updatecommit` is the first step of `make:es6` (and thus of `make:es5` and `make`), so **a build always
leaves `src/modules/Wrap.js` modified**. That is expected — do not revert it silently.

### Version bumps

**Bump the version on every commit.** Userscript managers only offer an update when `@version` grows, so a
commit that ships without a bump is a fix nobody receives. The scheme is a counter in the fourth part:
`24.9.16.0` → `24.9.16.1` → `24.9.16.2` (the first three parts stay as the upstream release this fork is
based on).

```sh
npx gulp bump     # 24.9.16.N -> 24.9.16.N+1, in every file that carries it
npx gulp make     # then rebuild: the artifacts bake in the version from meta.js and menu.html
```

`gulp bump` rewrites the six files that carry the full 4-part version — `src/modules/Wrap.js`,
`Dollchan_Extension_Tools.meta.js`, both `extension/v*/manifest.json`, both `extension/v*/menu/menu.html` —
and fails loudly if one of them does not contain the current version. Order matters: bump first, build
second, never the other way round.

`package.json` and `package-lock.json` are deliberately **not** bumped: npm rejects 4-part versions, so they
keep the 3-part `24.9.16` form and only change if the first three parts ever do. Both Chrome and Firefox
accept 4-part extension versions (verified by loading `extension/v3`).

### The update path must point at this fork

`@updateURL` in `Dollchan_Extension_Tools.meta.js` and `gitRaw` in `GlobalVars.js` are what make updates
work, and both must name this fork (`acidnik/Dollchan-Extension-Tools`) — inherited upstream values make
managers check the upstream script and silently offer *its* build. `gitRaw` is also what
`Misc.js checkForUpdates()` scrapes for the remote `const version`/`const commit`, so it has to be this
repository or the in-app check answers about the wrong project.

Never change `@namespace`, `@name` or `@description`: managers match an installed script by namespace and
name, so changing either makes it a different script and the existing installs stop updating. `gitWiki`
intentionally stays on the upstream wiki — this fork has no wiki of its own, and those pages document the
same features.

## Module system (important)

`src/modules/Wrap.js` is the template: it opens the single IIFE and holds `/* ==[ Name.js ]== */`
placeholders. `gulp make:es6` replaces each placeholder with that file's contents, in the order the
placeholders appear; the last marker (`/* ==[ Tail ]== */`) closes the IIFE and stays inline in `Wrap.js`.

Consequences when writing code:

- All ~38 modules are concatenated into **one lexical scope**. There is no module isolation.
- Do not redeclare a top-level name that already exists in another module — use distinct names or reuse.
- Order in `Wrap.js` is execution order. Top-level `const`/`let` are subject to TDZ; `function`
  declarations are hoisted, which is why most cross-module calls (e.g. `runMain` → `DelForm`) look unordered.
- Shared mutable globals (`aib, Cfg, doc, lang, nav, pByEl, …`) are declared in `GlobalVars.js` by design.
- A new module file is ignored by the build until you add its `/* ==[ Name.js ]== */` placeholder to
  `Wrap.js` in the right position.

## Code style

Style is defined by `eslint.config.mjs` (flat config; ESLint 10). There is no CI lint job and no test suite.

- **Tabs** for indentation; `max-len` 110; no trailing whitespace; `semi` always; single quotes.
- **No space after** `if`, `for`, `while`, `switch`, `catch` → `if(x) {`, `for(let i = 0; …)`, `catch(err) {`.
- **Never a space before** the parenthesis of named/anonymous functions (`function foo(a) {`), but always
  for async arrows: `async (a) => {}`.
- `comma-dangle: never`, `object-curly-spacing: always`, `array-bracket-spacing: never`.
- Object literals: `as-needed` key quoting, and **colons aligned** in multi-line literals
  (`someKey  : value`). `object-shorthand: always`.
- `one-var`: consecutive *uninitialized* declarations are grouped (`let a, b, c;`); initialized ones never are.
- `prefer-destructuring` (objects), `prefer-const`, `no-extra-parens`, empty `catch {}` allowed.
- Naming and prefixes are load-bearing: `$`-prefixed DOM helpers (`$q`, `$id`, `$bEnd`, `$popup`),
  `de-`-prefixed CSS/classes/attributes (`de-post`, `de-cfg-tab`, `[de-form]`), `Cfg` for user settings,
  `nav` for browser capabilities (from `initBrowser()` in `Browser.js`).
- `.eslintrc.json` inside `src/modules/` disables `no-undef`/`no-unused-vars` for the concatenated scope.
  Be aware flat config does **not** read eslintrc files, so `npx eslint` on this repo reports many
  pre-existing errors (including `linebreak-style`): treat lint as a style reference, not a clean gate,
  and match the surrounding code.

## Localization

All user-facing strings live in `Lng` in `src/modules/Localization.js` as `[ru, en, ua]` triples,
selected by `lang` (`0 = ru`, `1 = en`, `2 = ua` from `Cfg.language`).

- Settings labels go under `Lng.cfg.<settingId>` (a triple of strings, or `{ sel: [...], txt: [...] }`
  for dropdowns).
- Every new string needs all three languages; never leave `''` unless the upstream does (see `language`).
- Comments in `Localization.js` mark which settings tab each block belongs to.

## Adding a setting

1. `src/modules/DefaultCfg.js` — add the default value to `defaultCfg` (with an inline comment).
2. `src/modules/Localization.js` — add the label under `Lng.cfg` (string triple, or `{ sel, txt }` for dropdowns).
3. `src/modules/WindowSettings.js` — render the control inside the matching `_getCfg*()` tab builder:
   `_getBox(id, needReload)` for checkboxes, `_getInp(id, addText, size)` for text/number fields, `_getSel(id)`
   for dropdowns. Controls re-read `Cfg` by their `info` attribute, so it must exactly match the `defaultCfg` key.
4. Register the option in `_updateDependant()` if it gates other controls, and mark reload-required ones with
   `de-cfg-needreload` / the `needReload` argument.
5. `CfgWindow.handleEvent` — add a `switch(info)` case if the option must take effect immediately
   (re-render CSS, re-init a subsystem, update posts); otherwise it applies on the next page load.
6. Read it as `Cfg.<id>`; persist with `CfgSaver.save('<id>', value)`, or `toggleCfg(id)` for checkboxes
   (per-domain storage in `Storage.js`, loaded by `readCfg()`).

## Module map

| Area | Files |
| --- | --- |
| Entry / globals | `Wrap.js`, `Main.js`, `GlobalVars.js`, `Misc.js`, `Browser.js` |
| Config & i18n | `DefaultCfg.js`, `Localization.js`, `Storage.js` |
| Board support | `BoardDetector.js` (`getImageBoard`), `BoardDefaults.js` |
| UI shells | `Panel.js`, `WindowUtils.js`, `WindowSettings.js`, `WindowFavorites.js`, `WindowVidHid.js`, `MenuPopups.js`, `Hotkeys.js` |
| Posting & form | `Form.js`, `FormSubmit.js`, `FormFile.js`, `FormCaptcha.js` |
| Posts & media | `Posts.js`, `PostBuilders.js`, `PostPreviews.js`, `PostImages.js`, `RefMap.js`, `Players.js`, `ContentLoad.js` |
| Threads & page | `Threads.js`, `ThreadUpdater.js`, `DelForm.js`, `Pages.js`, `TimeCorrection.js`, `Ajax.js` |
| Filtering & styling | `Spells.js`, `Css.js`, `SvgIcons.js`, `Utils.js` |

## Finding your way around (debugging)

Locate behaviour before reading whole modules — the codebase is ~40k lines with no tests.

- **From an error message to its source.** User-visible text lives in `Lng` (`Localization.js`) and is often
  concatenated at the call site (`Lng.cantLoad[lang] + ' URL: ' + url`), so grepping the sentence you see
  finds nothing. Grep a short fragment, or better the key name (`cantLoad`), then inspect its callers.
  Popups are `[id^="de-popup-"]` (`$popup(id, msg)`), so a popup id is also a grep target.
- **All network goes through one function.** `$ajax(url, params, isCORS)` in `Ajax.js` is the only primitive;
  most callers reach it via `ContentLoader.loadFileData()` or `ajaxLoad()`/`AjaxCache`. The third argument is
  not "is cross-origin" in practice — callers pass `!url.startsWith('blob')` to keep blob URLs off the CORS
  paths. Branch selection: `fetch` when `nav.canUseFetch && ((isCORS ? !nav.hasGMXHR : !nav.canUseNativeXHR)
  || aib.hasRefererErr)`, otherwise `GM_xmlhttpRequest` when `(isCORS || !nav.canUseNativeXHR) && nav.hasGMXHR`,
  otherwise native `XMLHttpRequest`. Careful: one failed `xhr.open()` permanently sets
  `nav.canUseNativeXHR = false`, after which everything silently switches to `fetch`.
- **"Why does it differ on board X?" means one of two flag sets.**
  *Per board* — `aib.*` from `BoardDetector.js`: find `ibDomains['domain'] = Class`, then walk
  `class X extends Engine` up to `BaseBoard` (`BoardDefaults.js`), which holds the defaults and getters;
  engines set their discriminating flags in constructors (`hasRefererErr`, `multiFile`, `jsonSubmit`,
  `noMarkupBtns`, `qForm`, `qPostImg`, …). Board quirks are almost always these flags plus the site's own
  HTML and CSP.
  *Per environment* — `nav.*` from `initNavFuncs()` in `Browser.js`: `scriptHandler`
  (`Tampermonkey`/`Violentmonkey`/`WebExtension`/`In-page`), `isFirefox`/`isWebkit`/`isMobile`,
  `canUseFetch`, `hasGMXHR`, `hasWorker`. Userscript-manager and extension differences live here, so a bug
  that reproduces in only one manager is a `nav` branch.
- **Runtime objects** (declared in `GlobalVars.js`, assigned in `Main.js`): `aib` = board descriptor,
  `nav` = environment, `Cfg` = per-domain user settings, `lang` = 0/1/2, `postform` = the single `PostForm`,
  `DelForm.first` / `Thread.first` / `pByNum` / `pByEl` = parsed page. Event handlers are `handleEvent(e)`
  objects registered on elements, so grep the event type (`'paste'`, `'drop'`) to find them.

## Reproducing a board bug in a real browser

Do not reason a board bug out of the source: engine flags, the site's CSP and its live HTML decide the
outcome. Drive the real page headlessly instead — minutes instead of an hour of grep. The scripts live in
`tools/` (`tools/README.md` documents them and the env vars):

- `node tools/repro-file-paste.mjs` — injects the built userscript into a live board, dispatches Ctrl+V or
  drag&drop into the reply form, and reports the form state plus `pageErrors` and `requestFailures`. Exits
  non-zero when the form rejects the file, so it doubles as a check. `ACTION=drop` is the baseline to compare
  against: when both paths fail identically, the bug is not in the path you just changed.
- `node tools/probe-blob-csp.mjs` — the minimal-probe pattern: isolate one mechanism (transport × CSP ×
  execution world) in a few lines instead of reasoning about it. Use this shape whenever a request fails
  oddly, before changing app code.
- Both resolve playwright and a cached Chromium themselves, and both need `npx gulp make` first because they
  load the generated bundle, not `src/modules/*`.
- The injected bundle runs in the main world without `GM_*`/`chrome.storage`, so Dollchan falls back to
  `localStorage` and `scriptHandler: 'In-page'` (`Browser.js`). That covers UI/form/post bugs but never
  privileged paths (`GM_xmlhttpRequest`, `chrome.runtime`).
- With a board CSP, which build is affected depends on the kind of request. `fetch`/`XMLHttpRequest`
  **initiated by a content script** are not subject to the page's CSP — that is why the Ctrl+V blob bug hit
  the userscript only. A **subresource of an element living in the page document** (`<img>`/`<video>` with a
  `blob:` src) is checked against the document's CSP and is blocked in the extension too: endchan.org blocks
  video previews in both builds that way. Do not assume "extension = CSP-safe".
- Assert a **language-independent** postcondition (a class, an input value, a popup id): `readCfg()` picks
  the language from `navigator.language`, so text assertions depend on the context locale.
- Always collect `console` + `pageerror` + `requestfailed`: **CSP violations exist only there**, as
  `requestfailed <url> :: csp` plus a `console.error` naming the violated directive. That is how the Ctrl+V
  blob bug was identified.

## Testing (manual)

There is no automated test suite; verification is manual in a real browser.

- After editing modules, run `gulp make` **before** testing — `extension/` and the root userscript are stale otherwise.
- Chrome: `chrome://extensions/` → Developer mode → *Load unpacked* → `extension/v3`.
- Firefox: `about:debugging#addons` → *Load Temporary Add-on…* → `extension/v3/manifest.json`.
- Firefox for Android: `npm run start:firefox` (= `web-ext run --source-dir ./extension/v2`) with a device attached.
- Verify against a real imageboard; note that `aib` is per-engine (`BoardDetector.js`) and most code paths
  are engine-dependent, so a fix for one board may need parallel handling elsewhere.

## Pitfalls learned from bugs

- **Never re-read a `File`/`Blob` you already hold through `URL.createObjectURL` + `$ajax`/`loadFileData`.**
  Boards can send a CSP whose `default-src` (i.e. the `connect-src` fallback) does not allow `blob:`,
  which makes that request fail with status 0 — e.g. endchan.org breaks Ctrl+V image paste this way.
  Use `readFile()` / `FileInput._readDroppedFile()` instead; clipboard, drag&drop and file-picker files
  should all follow the same direct-read path. Note that a board's `img-src` may equally reject `blob:`,
  in which case preview thumbnails stay blank even though the file is attached correctly.

## Git

Do not stage, commit, or push unless the current user message explicitly asks for it ("commit", "push",
"deploy"/"деплой"). `gulp make` dirtying `Wrap.js` and regenerating the artifacts is not permission to commit.
