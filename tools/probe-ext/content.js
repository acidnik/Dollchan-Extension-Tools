/* Content script of the example probe extension.
   Runs in an isolated world (a browser extension content script), creates a blob: URL and reports
   whether fetch() and XMLHttpRequest can read it back. The result is printed as a single DEPROBE line,
   which tools/probe-blob-csp.mjs collects from `page.on('console')`. */

(async () => {
    const log = [];
    const check = async (name, fn) => {
        try {
            log.push([name, 'ok', await fn()]);
        } catch(err) {
            log.push([name, 'FAIL', String(err).slice(0, 80)]);
        }
    };
    const bytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4]);
    const url = URL.createObjectURL(new File([bytes], 'image.png', { type: 'image/png' }));
    log.push(['world', 'content-script'], ['blobUrl', new URL(url).origin]);

    await check('fetch', async () => {
        const res = await fetch(url);
        return (await res.arrayBuffer()).byteLength;
    });
    await check('xhr', () => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = () => {
            if(xhr.readyState === 4) {
                xhr.status === 200 ? resolve(xhr.response?.byteLength) :
                    reject(new Error(`status ${ xhr.status }`));
            }
        };
        xhr.onerror = () => reject(new Error('onerror'));
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.send(null);
    }));

    URL.revokeObjectURL(url);
    console.log('DEPROBE ' + JSON.stringify({ path: location.pathname, log }));
})();
