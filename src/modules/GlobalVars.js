/* ==[ GlobalVars.js ]== */

const doc = deWindow.document;
// Wiki links stay on the upstream repository: this fork has no wiki of its own, and the pages document the
// same features. gitRaw must point at this fork — checkForUpdates() compares the remote version and commit
// with the local ones, and the news of a new upstream release is irrelevant here.
const gitWiki = 'https://github.com/SthephanShinkufag/Dollchan-Extension-Tools/wiki/';
const gitRaw = 'https://raw.githubusercontent.com/acidnik/Dollchan-Extension-Tools/master/';

let aib, Cfg, dTime, isExpImg, isPreImg, lang, locStorage, nav, needScroll, pByEl, pByNum, postform,
    sesStorage, updater;
let topWinZ = 10;

/* global chrome, GM, GM_deleteValue, GM_getValue, GM_info, GM_openInTab, GM_setValue, GM_xmlhttpRequest,
    unsafeWindow */
