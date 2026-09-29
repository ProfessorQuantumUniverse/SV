/* ============================================================
   SV PROTOKOLL – Tests für Claude-Plugin, MCP-Server & Skript
   ------------------------------------------------------------
   node tests/tools.test.mjs
   Mit BASE_URL (siehe tests/run.sh) wird zusätzlich ein echtes
   PDF über Chrome/Edge gerendert.
   ============================================================ */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    validate, makeLink, decodeLink, normalise, encodePayload, preview, diff
} from '../plugin/mcp/lib/protokoll.mjs';
import { findBrowser } from '../plugin/mcp/lib/pdf.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.BASE_URL;
const TMP = mkdtempSync(join(tmpdir(), 'sv-tools-test-'));

let passed = 0;
const failures = [];
let currentTest = '';

function check(label, condition, detail) {
    if (condition) { passed++; return true; }
    failures.push(`${currentTest} › ${label}${detail ? `\n      ${detail}` : ''}`);
    return false;
}

async function test(name, fn) {
    currentTest = name;
    const before = failures.length;
    try { await fn(); } catch (err) {
        failures.push(`${name} › threw: ${err && err.stack ? err.stack : err}`);
    }
    console.log(`${failures.length > before ? '✗' : '✓'} ${name}`);
}

const example = JSON.parse(readFileSync(join(ROOT, 'shared', 'beispiel.json'), 'utf8'));
const clone = x => JSON.parse(JSON.stringify(x));

/* Fälle, die JS und Python identisch bewerten müssen. */
const CASES = {
    beispiel: example,
    minimal: { meetingDate: '2026-02-03', sections: [] },
    'falsches Datum': { ...clone(example), meetingDate: '27.1.2026', timeFrom: '9:5' },
    'unbekannte Felder': { ...clone(example), foo: 1, attendance: { '9C': 'Max', '9B': 'Anna und Ben' } },
    'kaputte Abstimmung': {
        ...clone(example),
        sections: [{ title: 'Wahl:', text: '**Wichtig** "zitiert" [?]', votes: { rows: [{ label: '', yes: -1, no: '3x', abstain: 1.5 }, { label: 'B' }] } }]
    },
    'falsche Typen': { meetingDate: 20260101, sections: {}, attendance: [] },
    'Punkt ohne Pflichtfelder': { meetingDate: '2026-02-03', sections: [{ text: 5 }, 'x', { title: '', text: '' }] },
    'Zeiten & Daten': { ...clone(example), printDate: '2026-01-01', timeFrom: '15:00', timeTo: '14:00' },
    'doppelte Titel': { ...clone(example), sections: [{ title: 'SV-Raum', text: 'a' }, { title: 'sv-raum', text: 'b' }, { title: 'x'.repeat(45), text: '' }] },
    'leere Tabelle': { ...clone(example), sections: [{ title: 'A', text: 'b', votes: { caption: '', rows: [] } }] },
    'doppelte IDs': { ...clone(example), sections: [{ id: 'a', title: 'X', text: 'x' }, { id: 'a', title: 'Y', text: 'y' }] },
    'kein Objekt': ['nope']
};

/* ── Kernlogik ───────────────────────────────────────────── */

await test('das Beispielprotokoll ist gültig und ohne Hinweise', () => {
    const r = validate(example);
    check('gültig', r.valid, JSON.stringify(r.errors));
    check('keine Hinweise', r.warnings.length === 0, JSON.stringify(r.warnings));
    check('Themen erkannt', r.stats.topics.join(', ') === 'Verbindungslehrer, Schulplenum, Podiumsdiskussion, Schulwebsite, SV-Aktion');
    check('Anwesende gezählt', r.stats.attendees === 14 && r.stats.classes === 6, JSON.stringify(r.stats));
});

await test('Fehler werden mit Pfad und verständlicher Meldung gemeldet', () => {
    const r = validate(CASES['kaputte Abstimmung']);
    const paths = r.errors.map(e => e.path);
    check('ungültig', !r.valid);
    check('negative Stimmen', paths.includes('sections[0].votes.rows[0].yes'), paths.join(', '));
    check('Text statt Zahl', paths.includes('sections[0].votes.rows[0].no'));
    check('Kommazahl', paths.includes('sections[0].votes.rows[0].abstain'));
    const codes = r.warnings.map(w => w.code);
    ['title-colon', 'markdown', 'straight-quotes', 'placeholder', 'vote-no-label', 'vote-no-counts']
        .forEach(c => check(`Hinweis ${c}`, codes.includes(c), codes.join(', ')));

    const d = validate(CASES['falsches Datum']);
    check('Datumsformat erklärt', d.errors.some(e => e.path === 'meetingDate' && /YYYY-MM-DD/.test(e.message)), JSON.stringify(d.errors));
    const u = validate(CASES['unbekannte Felder']);
    check('unbekanntes Feld', u.errors.some(e => e.path === 'foo'));
    check('unbekannte Klasse', u.errors.some(e => e.path === 'attendance.9C'), JSON.stringify(u.errors));
    check('„und“ in Anwesenheit', u.warnings.some(w => w.code === 'attendance-separator'));
});

await test('normalise bringt Protokolle in Export-Form', () => {
    const n = normalise({ meetingDate: '2026-02-03', attendance: { '9B': ' Anna ', '7A': '' }, sections: [{ title: 'A', text: 'b', votes: { rows: [{ label: 'x', yes: 3 }] } }] });
    check('Kennung', n.format === 'sv-protokoll' && n.version === 1);
    check('leere Klassen entfernt', JSON.stringify(n.attendance) === '{"9B":"Anna"}', JSON.stringify(n.attendance));
    check('Stimmen als Text', n.sections[0].votes.rows[0].yes === '3' && n.sections[0].votes.rows[0].no === '');
    check('Ergebnis ist gültig', validate(n).valid);
});

await test('Links: Kodierung ist verlustfrei und kompakt', () => {
    const link = makeLink(example, 'https://example.org/SV/');
    check('Form', /^https:\/\/example\.org\/SV\/#import=[A-Za-z0-9_-]+$/.test(link), link.slice(0, 60));
    check('Rundreise', JSON.stringify(decodeLink(link)) === JSON.stringify(normalise(example)));
    check('nur Payload geht auch', JSON.stringify(decodeLink(link.split('=')[1])) === JSON.stringify(normalise(example)));
    check('komprimiert', link.length < JSON.stringify(example).length, `${link.length} Zeichen`);
    let threw = false;
    try { decodeLink('https://example.org/'); } catch { threw = true; }
    check('Link ohne Daten wird abgelehnt', threw);
});

await test('plugin/ ist mit shared/ und schema/ synchron', () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build-plugin.mjs'), '--check'], { encoding: 'utf8' });
    check('build --check', r.status === 0, r.stderr || r.stdout);
});

/* ── Python-Skript (Fallback ohne MCP) ───────────────────── */

const PY = ['python3', 'python', 'py'].find(cmd => spawnSync(cmd, ['--version']).status === 0);
const PY_SCRIPT = join(ROOT, 'plugin', 'skills', 'protokoll-erstellen', 'scripts', 'sv_protokoll.py');

function py(args, input) {
    return spawnSync(PY, [PY_SCRIPT, ...args], { encoding: 'utf8', input, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
}

if (!PY) {
    console.log('– Python nicht gefunden, Paritätstests übersprungen');
} else {
    await test('Python-Skript bewertet alles genau wie der MCP-Server', () => {
        Object.entries(CASES).forEach(([name, data]) => {
            const file = join(TMP, 'case.json');
            writeFileSync(file, JSON.stringify(data));
            const r = py(['validate', file, '--json']);
            let out;
            try { out = JSON.parse(r.stdout); } catch {
                check(`${name}: Ausgabe lesbar`, false, r.stderr || r.stdout);
                return;
            }
            const js = validate(data);
            check(`${name}: gleiche Fehler`, JSON.stringify(out.errors) === JSON.stringify(js.errors),
                `py ${JSON.stringify(out.errors)}\n      js ${JSON.stringify(js.errors)}`);
            check(`${name}: gleiche Hinweise`, JSON.stringify(out.warnings) === JSON.stringify(js.warnings),
                `py ${JSON.stringify(out.warnings.map(w => w.code))}\n      js ${JSON.stringify(js.warnings.map(w => w.code))}`);
            check(`${name}: Exit-Code`, r.status === (js.valid ? 0 : 1), `status ${r.status}`);
        });
    });

    await test('preview und diff sind in Python und JS zeichengleich', () => {
        const withVotes = {
            ...clone(example), location: '', timeFrom: '', timeTo: '14:00', author: '',
            attendance: { '10B': 'Lisa' },
            sections: [
                { id: 'a', title: 'Wahl', text: 'Absatz eins.  \nZeile.\n\n\n  \n\nAbsatz zwei.', votes: { caption: 'Wahl der Delegierten', rows: [{ label: 'Anna', yes: '7', no: 2, abstain: '' }, { label: '', yes: '', no: '', abstain: '' }, { label: 'Ben', yes: 3, no: 3, abstain: 1 }] } },
                { title: '', text: 'Ohne Titel.' },
                { title: '   ', text: '  ', votes: null }
            ]
        };
        const docs = { beispiel: example, abstimmung: withVotes, minimal: CASES.minimal, 'falsches Datum': CASES['falsches Datum'] };
        Object.entries(docs).forEach(([name, data]) => {
            const file = join(TMP, 'p.json');
            writeFileSync(file, JSON.stringify(data));
            const r = py(['preview', file]);
            check(`preview ${name}`, r.stdout.replace(/\r\n/g, '\n').trimEnd() === preview(data),
                `py:\n${r.stdout}\n      js:\n${preview(data)}\n${r.stderr}`);
        });
        check('Vorschau zeigt Abstimmungsergebnis', /Anna: Ja 7 · Nein 2 · Enth\. – → Angenommen/.test(preview(withVotes)), preview(withVotes));
        check('Vorschau überspringt leere Punkte', !/▌ \(ohne Titel\)\n$/.test(preview(withVotes)) && (preview(withVotes).match(/▌/g) || []).length === 2);

        const alt = { ...clone(example), sections: example.sections.map((x, i) => ({ id: `s${i}`, ...x })) };
        const neu = clone(alt);
        neu.author = 'Anna';
        neu.attendance['7A'] = 'Max';
        neu.sections[0].text = 'Frau Löwe hat zugesagt.';
        neu.sections[3].title = 'Website';
        neu.sections[4].votes = { caption: '', rows: [{ label: 'Bowling', yes: 5, no: 1, abstain: 0 }] };
        neu.sections.splice(1, 1);
        neu.sections.push({ title: 'Sonstiges', text: 'Nichts.' });
        const pairs = { 'alles geändert': [alt, neu], 'nichts geändert': [alt, alt], 'leer → voll': [CASES.minimal, example] };
        Object.entries(pairs).forEach(([name, [a, b]]) => {
            const fa = join(TMP, 'a.json');
            const fb = join(TMP, 'b.json');
            writeFileSync(fa, JSON.stringify(a));
            writeFileSync(fb, JSON.stringify(b));
            const r = py(['diff', fa, fb]);
            check(`diff ${name}`, r.stdout.replace(/\r\n/g, '\n').trimEnd() === diff(a, b),
                `py:\n${r.stdout}\n      js:\n${diff(a, b)}\n${r.stderr}`);
        });
        const d = diff(alt, neu);
        ['Protokollant*in: „Lorenzo Bay-Müller“ → „Anna“', '7A: – → „Max“', '~ Verbindungslehrer (44 → 5 Wörter)',
            '[Titel: „Schulwebsite“ → „Website“]', 'SV-Aktion (30 → 30 Wörter) [Abstimmung geändert]',
            '+ Sonstiges (neu, 2 Wörter)', '− Schulplenum (entfernt, 22 Wörter)', 'Gesamt: 177 → 118 Wörter (-33 %)']
            .forEach(line => check(`diff enthält „${line}“`, d.includes(line), d));
        check('diff ohne Änderung', /^Punkte:/.test(diff(alt, alt)) && /\(\+?0 %\)$/.test(diff(alt, alt)), diff(alt, alt));

        const stats = py(['stats', makeLink(example)]);
        check('stats liest Links und summiert', /Summe\s+177/.test(stats.stdout), stats.stdout + stats.stderr);
    });

    await test('Python-Links und JS-Links sind austauschbar', () => {
        const file = join(TMP, 'beispiel.json');
        writeFileSync(file, JSON.stringify(example));
        const link = py(['link', file]).stdout.trim();
        check('Python gibt Markdown-Link aus', link.startsWith('[SV-Protokoll vom 27.1.2026 öffnen](https://') && link.endsWith(')'), link.slice(0, 60));
        const raw = py(['link', file, '--raw']).stdout.trim();
        check('--raw gibt nur die URL', /^https:\/\/\S+#import=[A-Za-z0-9_-]+$/.test(raw), raw.slice(0, 60));
        check('Python-Link == JS-Payload-Inhalt', JSON.stringify(decodeLink(link)) === JSON.stringify(normalise(example)), link.slice(0, 80));
        const back = py(['decode', makeLink(example)]);
        check('Python liest JS-Link', JSON.stringify(JSON.parse(back.stdout)) === JSON.stringify(normalise(example)), back.stderr);
        const invalid = py(['link', '-'], JSON.stringify({ meetingDate: 'x', sections: [] }));
        check('ungültiges Protokoll → kein Link', invalid.status === 1 && !invalid.stdout.trim(), invalid.stdout);
    });
}

/* ── MCP-Server über stdio ───────────────────────────────── */

function startServer(env = {}) {
    const proc = spawn(process.execPath, [join(ROOT, 'plugin', 'mcp', 'server.mjs')], {
        env: { ...process.env, SV_OUTPUT_DIR: TMP, ...env },
        stdio: ['pipe', 'pipe', 'pipe']
    });
    let buf = '';
    let seq = 0;
    const pending = new Map();
    const stray = [];
    proc.stdout.on('data', chunk => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            let msg;
            try { msg = JSON.parse(line); } catch { stray.push(line); continue; }
            const p = pending.get(msg.id);
            if (p) { pending.delete(msg.id); p(msg); } else stray.push(line);
        }
    });
    return {
        stray,
        request(method, params, timeout = 60000) {
            const id = ++seq;
            proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
            return new Promise((resolve, reject) => {
                const t = setTimeout(() => reject(new Error(`Timeout: ${method}`)), timeout);
                pending.set(id, msg => { clearTimeout(t); resolve(msg); });
            });
        },
        notify(method, params) {
            proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
        },
        stop() { proc.stdin.end(); return new Promise(r => proc.once('exit', r)); }
    };
}

const text = res => res.result.content.map(c => c.text).join('\n');

await test('MCP: Handshake, Tools, Prompts, Ressourcen', async () => {
    const s = startServer();
    const init = await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    check('Protokollversion übernommen', init.result.protocolVersion === '2025-06-18', JSON.stringify(init));
    check('Fähigkeiten', ['tools', 'prompts', 'resources'].every(k => k in init.result.capabilities));
    check('Instruktionen', /protokoll_format/.test(init.result.instructions));
    const unknownVersion = await s.request('initialize', { protocolVersion: '1999-01-01' });
    check('unbekannte Version → neueste', unknownVersion.result.protocolVersion === '2025-11-25');
    s.notify('notifications/initialized');

    const tools = (await s.request('tools/list')).result.tools.map(t => t.name);
    check('acht Tools', tools.length === 8 && ['protokoll_render_pdf', 'protokoll_diff', 'protokoll_preview'].every(t => tools.includes(t)), tools.join(', '));

    const fmt = text(await s.request('tools/call', { name: 'protokoll_format', arguments: {} }));
    check('Format enthält Stilleitfaden und Schema', /Stilleitfaden/.test(fmt) && /"\$defs"/.test(fmt));

    const prompts = (await s.request('prompts/list')).result.prompts;
    check('drei Prompts', prompts.map(p => p.name).join() === 'erstellen,korrigieren,ueberarbeiten');
    check('Prompt-Titel aus Frontmatter', prompts[1].title === 'SV-Protokoll korrigieren', prompts[1].title);
    const pr = await s.request('prompts/get', { name: 'korrigieren', arguments: { protokoll: '{"x":1}' } });
    const body = pr.result.messages[0].content.text;
    check('Prompt enthält Modus, Link-Regel und Eingabe', /Minimal-invasive/.test(body) && /Ergebnis immer als Link/.test(body) && !body.includes('{{SCRIPT}}') && body.endsWith('{"x":1}'));
    check('kein Frontmatter im Prompt', !/^---/.test(body));

    const res = (await s.request('resources/list')).result.resources.map(r => r.uri);
    check('Ressourcen', res.includes('sv-protokoll://schema'));
    const schemaRes = await s.request('resources/read', { uri: 'sv-protokoll://schema' });
    check('Schema lesbar', JSON.parse(schemaRes.result.contents[0].text).title === 'SV-Protokoll');

    const missing = await s.request('does/not/exist');
    check('unbekannte Methode', missing.error && missing.error.code === -32601);
    check('stdout enthält nur JSON-RPC', s.stray.length === 0, s.stray.join('\n'));
    await s.stop();
});

await test('MCP: prüfen, Link, lesen, speichern', async () => {
    const s = startServer({ SV_APP_URL: 'https://example.org/SV/' });
    await s.request('initialize', { protocolVersion: '2025-06-18' });

    const ok = await s.request('tools/call', { name: 'protokoll_validate', arguments: { protokoll: example } });
    check('gültig', /✓ Gültig/.test(text(ok)) && ok.result.structuredContent.valid === true, text(ok));

    const bad = await s.request('tools/call', { name: 'protokoll_validate', arguments: { protokoll: CASES['falsches Datum'] } });
    check('ungültig mit Pfad', /✗ Ungültig/.test(text(bad)) && /meetingDate/.test(text(bad)), text(bad));

    const asString = await s.request('tools/call', { name: 'protokoll_validate', arguments: { protokoll: JSON.stringify(example) } });
    check('JSON-Text wird auch akzeptiert', asString.result.structuredContent.valid === true);

    const link = await s.request('tools/call', { name: 'protokoll_link', arguments: { protokoll: example } });
    const url = link.result.structuredContent.link;
    check('Link mit SV_APP_URL', url.startsWith('https://example.org/SV/#import='), url.slice(0, 60));

    const refused = await s.request('tools/call', { name: 'protokoll_link', arguments: { protokoll: CASES['falsches Datum'] } });
    check('kein Link für ungültige Protokolle', refused.result.isError === true && /ungültig/.test(text(refused)));

    const decoded = await s.request('tools/call', { name: 'protokoll_decode_link', arguments: { link: url } });
    check('Link gelesen', decoded.result.structuredContent.protokoll.sections.length === example.sections.length);
    const junk = await s.request('tools/call', { name: 'protokoll_decode_link', arguments: { link: 'https://x/#import=@@' } });
    check('kaputter Link → Toolfehler', junk.result.isError === true);

    const saved1 = await s.request('tools/call', { name: 'protokoll_save_json', arguments: { protokoll: example } });
    const saved2 = await s.request('tools/call', { name: 'protokoll_save_json', arguments: { protokoll: example } });
    const p1 = saved1.result.structuredContent.path;
    const p2 = saved2.result.structuredContent.path;
    check('Standardname', p1 === join(TMP, 'sv-protokoll-2026-01-27.json'), p1);
    check('nie überschreiben', p2 === join(TMP, 'sv-protokoll-2026-01-27-2.json'), p2);
    check('Datei ist importierbar', JSON.parse(readFileSync(p1, 'utf8')).format === 'sv-protokoll');

    const unknown = await s.request('tools/call', { name: 'gibtsnicht', arguments: {} });
    check('unbekanntes Tool', unknown.error && unknown.error.code === -32602);
    await s.stop();
});

await test('Komfort: Link rein → Markdown-Link raus', async () => {
    const s = startServer({ SV_APP_URL: 'https://example.org/SV/' });
    await s.request('initialize', { protocolVersion: '2025-06-18' });

    const res = await s.request('tools/call', { name: 'protokoll_link', arguments: { protokoll: example } });
    const out = res.result.structuredContent;
    check('Markdown-Link mit Datum', out.markdown === `[SV-Protokoll vom 27.1.2026 öffnen](${out.link})`, out.markdown.slice(0, 60));
    check('Antworttext beginnt mit dem Markdown-Link', text(res).startsWith(out.markdown));
    check('Hinweis: kein JSON zeigen', /kein JSON/.test(text(res)));

    /* Ein Link darf direkt als „protokoll“ übergeben werden. */
    const again = await s.request('tools/call', { name: 'protokoll_link', arguments: { protokoll: out.link } });
    check('Link als Eingabe akzeptiert', again.result.structuredContent && again.result.structuredContent.link === out.link, text(again));
    const val = await s.request('tools/call', { name: 'protokoll_validate', arguments: { protokoll: out.link } });
    check('auch beim Prüfen', val.result.structuredContent.valid === true);

    const withWarn = await s.request('tools/call', { name: 'protokoll_link', arguments: { protokoll: { ...clone(example), author: '' } } });
    check('Hinweise stehen beim Link', /no-author/.test(text(withWarn)), text(withWarn));

    const dec = await s.request('tools/call', { name: 'protokoll_decode_link', arguments: { link: out.link } });
    check('Lesen erinnert an Link-Rückgabe', /protokoll_link/.test(text(dec)));

    const init = await s.request('initialize', { protocolVersion: '2025-06-18' });
    check('Instruktionen: immer Link', /IMMER ein Link/.test(init.result.instructions));
    await s.stop();
});

await test('Zielordner: Platzhalter werden aufgelöst, nie im Arbeitsordner', async () => {
    /* So kam der Bug zustande: "${HOME}/Downloads" unaufgelöst, Arbeitsordner system32. */
    const s = startServer({ SV_TEST_OUT: TMP, SV_OUTPUT_DIR: '${SV_TEST_OUT}/ziel' });
    await s.request('initialize', { protocolVersion: '2025-06-18' });
    const saved = await s.request('tools/call', { name: 'protokoll_save_json', arguments: { protokoll: example } });
    check('${VAR} im Zielordner aufgelöst', saved.result.structuredContent?.path === join(TMP, 'ziel', 'sv-protokoll-2026-01-27.json'), text(saved));
    const rel = await s.request('tools/call', { name: 'protokoll_save_json', arguments: { protokoll: example, pfad: 'unter/datei' } });
    check('relativer Name landet im Zielordner', rel.result.structuredContent?.path === join(TMP, 'ziel', 'unter', 'datei.json'), text(rel));
    const bad = await s.request('tools/call', { name: 'protokoll_save_json', arguments: { protokoll: example, pfad: '${GIBTS_NICHT}/x.json' } });
    check('unbekannter Platzhalter → klarer Fehler', bad.result.isError && /Platzhalter/.test(text(bad)), text(bad));
    await s.stop();

    /* Unaufgelöster Platzhalter im Zielordner → Standard statt kaputtem Pfad. */
    const s2 = startServer({ SV_OUTPUT_DIR: '${user_config.output_dir}' });
    await s2.request('initialize', { protocolVersion: '2025-06-18' });
    const abs = await s2.request('tools/call', { name: 'protokoll_save_json', arguments: { protokoll: example, pfad: join(TMP, 'abs.json') } });
    check('absoluter Pfad trotz kaputter Konfiguration', abs.result.structuredContent?.path === join(TMP, 'abs.json'), text(abs));

    const pdf = await s2.request('tools/call', { name: 'protokoll_render_pdf', arguments: { protokoll: example, pfad: join(TMP, 'x.pdf') } });
    check('PDF-Fehler liefert den Link als Ausweg',
        pdf.result.isError !== true || /PDF herunterladen/.test(text(pdf)) && /#import=/.test(text(pdf)), text(pdf));
    await s2.stop();

    const s3 = startServer({ SV_BROWSER: join(TMP, 'kein-browser.exe') });
    await s3.request('initialize', { protocolVersion: '2025-06-18' });
    const fail = await s3.request('tools/call', { name: 'protokoll_render_pdf', arguments: { protokoll: example, pfad: join(TMP, 'y.pdf') } });
    check('ohne Browser: Fehler + Link', fail.result.isError === true && /PDF herunterladen/.test(text(fail)) && /\[SV-Protokoll vom 27\.1\.2026 öffnen\]\(/.test(text(fail)), text(fail));
    await s3.stop();
});

await test('Skills: Ausgabe-Regeln und Skriptpfad je Ziel', () => {
    const skill = readFileSync(join(ROOT, 'plugin', 'skills', 'protokoll-ueberarbeiten', 'SKILL.md'), 'utf8');
    check('Link-Regel enthalten', /Ergebnis immer als Link/.test(skill) && /Kein JSON-Codeblock/.test(skill));
    check('Plugin: Skriptpfad über CLAUDE_SKILL_DIR', skill.includes('python ${CLAUDE_SKILL_DIR}/scripts/sv_protokoll.py link'));
    check('Plugin: Link-Tools ohne Rückfrage', /^allowed-tools: .*protokoll_link/m.test(skill));
    check('kein Platzhalter übrig', !skill.includes('{{SCRIPT}}'));
    check('Link-Trigger in der Beschreibung', /^description: .*#import=/m.test(skill));
    check('Beschreibung ≤ 1024 Zeichen', skill.match(/^description: (.*)$/m)[1].length <= 1024);
});

/* ── PDF (nur mit laufendem Generator, siehe run.sh) ─────── */

let browserFound = false;
try { findBrowser(); browserFound = true; } catch { /* kein Browser */ }

if (!BASE_URL || !browserFound) {
    console.log(`– PDF-Test übersprungen (${!BASE_URL ? 'BASE_URL fehlt' : 'kein Chrome/Edge'})`);
} else {
    await test('MCP: PDF über Chrome/Edge rendern', async () => {
        const s = startServer({ SV_APP_URL: BASE_URL + '/index.html' });
        await s.request('initialize', { protocolVersion: '2025-06-18' });
        const many = { ...clone(example), sections: Array.from({ length: 12 }, (_, i) => ({ title: `Punkt ${i + 1}`, text: 'Wir haben ausführlich beraten. '.repeat(30) })) };
        const res = await s.request('tools/call', { name: 'protokoll_render_pdf', arguments: { protokoll: many, pfad: 'test.pdf' } }, 90000);
        check('kein Fehler', !res.result.isError, text(res));
        const out = res.result.structuredContent || {};
        check('Datei existiert', out.path && existsSync(out.path), JSON.stringify(out));
        if (out.path && existsSync(out.path)) {
            const pdf = readFileSync(out.path);
            check('echtes PDF', pdf.subarray(0, 5).toString() === '%PDF-');
            const pageObjs = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
            check('Seitenzahl wie im Generator', pageObjs === out.pages && out.pages > 1, `pdf ${pageObjs}, generator ${out.pages}`);
            const box = pdf.toString('latin1').match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/);
            check('A4', box && Math.round(box[1]) === 595 && Math.round(box[2]) === 842, box && box[0]);
        }
        await s.stop();
    });
}

/* ── Bericht ─────────────────────────────────────────────── */

rmSync(TMP, { recursive: true, force: true });
console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
    console.log('\nFailures:');
    failures.forEach(f => console.log('  • ' + f));
    process.exit(1);
}
