/* ============================================================
   SV PROTOKOLL – PDF über einen lokalen Chrome/Edge
   ------------------------------------------------------------
   Startet den Browser headless, lädt die echte Generator-Seite,
   übergibt das Protokoll und druckt über das DevTools-Protokoll.
   So ist das PDF identisch mit dem Druck aus dem Browser –
   ohne Playwright oder andere Abhängigkeiten.
   ============================================================ */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = {
    win32: [
        join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
        join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
        join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
        join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
        join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
    ],
    darwin: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ],
    linux: [
        '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
        '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium'
    ]
};

export function findBrowser() {
    if (process.env.SV_BROWSER) {
        if (existsSync(process.env.SV_BROWSER)) return process.env.SV_BROWSER;
        throw new Error(`SV_BROWSER zeigt auf eine nicht vorhandene Datei: ${process.env.SV_BROWSER}`);
    }
    const found = (CANDIDATES[process.platform] || CANDIDATES.linux).find(p => p && existsSync(p));
    if (!found) throw new Error('Kein Chrome/Edge gefunden. Pfad über die Umgebungsvariable SV_BROWSER angeben.');
    return found;
}

/* Minimaler DevTools-Client über das eingebaute WebSocket (Node ≥ 22). */
function connect(wsUrl) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let seq = 0;
        const pending = new Map();
        ws.addEventListener('message', ev => {
            const msg = JSON.parse(String(ev.data));
            const p = msg.id != null && pending.get(msg.id);
            if (!p) return;
            pending.delete(msg.id);
            if (msg.error) p.reject(new Error(`${msg.error.message} (${p.method})`));
            else p.resolve(msg.result);
        });
        ws.addEventListener('open', () => resolve({
            send(method, params = {}) {
                const id = ++seq;
                ws.send(JSON.stringify({ id, method, params }));
                return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej, method }));
            },
            close() { ws.close(); }
        }));
        ws.addEventListener('error', () => reject(new Error('Verbindung zum Browser fehlgeschlagen.')));
    });
}

function launch(browserPath, profileDir) {
    return new Promise((resolve, reject) => {
        const proc = spawn(browserPath, [
            '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`,
            '--no-first-run', '--no-default-browser-check', '--disable-extensions',
            '--hide-scrollbars', '--mute-audio', 'about:blank'
        ], { stdio: ['ignore', 'ignore', 'pipe'] });

        let buf = '';
        const timer = setTimeout(() => reject(new Error('Browser startet nicht (Timeout).')), 20000);
        proc.stderr.on('data', chunk => {
            buf += chunk;
            const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
            if (m) {
                clearTimeout(timer);
                resolve({ proc, browserWs: m[1] });
            }
        });
        proc.on('error', err => { clearTimeout(timer); reject(err); });
        proc.on('exit', code => { clearTimeout(timer); reject(new Error(`Browser beendet (Code ${code}).`)); });
    });
}

async function evaluate(cdp, expression) {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
}

/**
 * Rendert ein (validiertes) Protokoll als PDF.
 * @returns {Promise<{path: string, pages: number}>}
 */
export async function renderPdf(data, outPath, { appUrl, timeoutMs = 45000 } = {}) {
    if (typeof WebSocket === 'undefined') {
        throw new Error(`PDF braucht Node ≥ 22 (gefunden: ${process.version}). Link und JSON funktionieren trotzdem.`);
    }
    const browserPath = findBrowser();
    const profileDir = mkdtempSync(join(tmpdir(), 'sv-protokoll-'));
    let proc;
    let cdp;
    const deadline = setTimeout(() => proc && proc.kill(), timeoutMs);

    try {
        const launched = await launch(browserPath, profileDir);
        proc = launched.proc;
        const port = new URL(launched.browserWs).port;
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = targets.find(t => t.type === 'page');
        if (!page) throw new Error('Kein Browser-Tab gefunden.');

        cdp = await connect(page.webSocketDebuggerUrl);
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        await cdp.send('Page.navigate', { url: appUrl.replace(/#.*$/, '') });

        /* Warten, bis die Seite ihre Test-Schnittstelle bereitstellt. */
        const started = Date.now();
        while (!(await evaluate(cdp, `!!(window.SV && document.querySelector('.protocol-page'))`).catch(() => false))) {
            if (Date.now() - started > 20000) throw new Error(`Generator unter ${appUrl} nicht erreichbar.`);
            await new Promise(r => setTimeout(r, 200));
        }

        const pages = await evaluate(cdp, `(async () => {
            const d = ${JSON.stringify(data)};
            SV.applyData(d);
            SV.syncFieldInputs();
            SV.syncAttendanceInputs();
            SV.renderEditorSections();
            if (document.fonts && document.fonts.ready) await document.fonts.ready;
            await Promise.all([...document.images].map(img => img.complete ? null :
                new Promise(r => { img.onload = img.onerror = r; })));
            SV.updatePreview();
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            return document.querySelectorAll('#pdf-preview-container .protocol-page').length;
        })()`);

        const pdf = await cdp.send('Page.printToPDF', {
            printBackground: true,
            preferCSSPageSize: true,
            displayHeaderFooter: false,
            marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0
        });
        writeFileSync(outPath, Buffer.from(pdf.data, 'base64'));
        return { path: outPath, pages };
    } finally {
        clearTimeout(deadline);
        if (cdp) cdp.close();
        if (proc) {
            proc.kill();
            await new Promise(r => (proc.exitCode != null ? r() : proc.once('exit', r)));
        }
        try { rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Profil wird vom OS aufgeräumt */ }
    }
}
