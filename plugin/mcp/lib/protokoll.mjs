/* ============================================================
   SV PROTOKOLL – Kernlogik (ohne Abhängigkeiten)
   ------------------------------------------------------------
   Validierung gegen schema.json, Stil-Hinweise und die
   Kodierung der Import-Links. Das Python-Gegenstück
   shared/sv_protokoll.py verhält sich identisch –
   tests/tools.test.mjs prüft das.
   ============================================================ */

import { readFileSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'content');
export const DEFAULT_APP_URL = 'https://professorquantumuniverse.github.io/SV/';
export const LINK_PARAM = 'import';

export function readContent(name) {
    return readFileSync(join(CONTENT_DIR, name), 'utf8');
}

let cachedSchema = null;
export function schema() {
    if (!cachedSchema) cachedSchema = JSON.parse(readContent('schema.json'));
    return cachedSchema;
}

/* ── SCHEMA-VALIDIERUNG ──────────────────────────────────────
   Ein bewusst kleiner Validator für genau die Schlüsselwörter,
   die schema.json benutzt. So bleibt das Schema die einzige
   Quelle der Wahrheit, ohne eine Bibliothek mitzuschleppen.
   ─────────────────────────────────────────────────────────── */

const TYPE_NAMES = {
    null: 'null', boolean: 'Wahrheitswert', integer: 'ganze Zahl', number: 'Zahl',
    string: 'Text', array: 'Liste', object: 'Objekt'
};

function typeOf(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
    return typeof value;
}

function typeMatches(expected, actual) {
    return expected === actual || (expected === 'number' && actual === 'integer');
}

function joinPath(path, key) {
    return typeof key === 'number' ? `${path}[${key}]` : (path ? `${path}.${key}` : key);
}

function resolve(node, root) {
    while (node && node.$ref) {
        const parts = node.$ref.replace(/^#\//, '').split('/');
        node = parts.reduce((n, p) => n[p], root);
    }
    return node;
}

function checkNode(node, value, path, root, errors) {
    const s = resolve(node, root);
    const at = path || '(Protokoll)';

    if ('const' in s && JSON.stringify(value) !== JSON.stringify(s.const)) {
        errors.push({ path: at, message: `muss ${JSON.stringify(s.const)} sein` });
        return;
    }
    if (s.enum && !s.enum.includes(value)) {
        errors.push({ path: at, message: `erlaubt sind: ${s.enum.join(', ')}` });
        return;
    }
    if (s.anyOf) {
        /* Passt genau eine Alternative vom Typ her, deren Fehler melden –
           das ist präziser als „passt zu keiner Alternative“. */
        const byType = s.anyOf.filter(alt => {
            const t = resolve(alt, root).type;
            return !t || [].concat(t).some(x => typeMatches(x, typeOf(value)));
        });
        if (byType.length === 1) {
            checkNode(byType[0], value, path, root, errors);
            return;
        }
        const ok = s.anyOf.some(alt => {
            const trial = [];
            checkNode(alt, value, path, root, trial);
            return trial.length === 0;
        });
        if (!ok) errors.push({ path: at, message: `ungültiger Wert ${JSON.stringify(value)}` + (s.description ? ` – ${s.description}` : '') });
        return;
    }
    if (s.type) {
        const actual = typeOf(value);
        const types = Array.isArray(s.type) ? s.type : [s.type];
        if (!types.some(t => typeMatches(t, actual))) {
            errors.push({ path: at, message: `erwartet ${types.map(t => TYPE_NAMES[t]).join(' oder ')}, gefunden ${TYPE_NAMES[actual]}` });
            return;
        }
    }

    switch (typeOf(value)) {
        case 'string':
            if (s.maxLength != null && [...value].length > s.maxLength) {
                errors.push({ path: at, message: `zu lang (${[...value].length} Zeichen, max. ${s.maxLength})` });
            }
            if (s.pattern && !new RegExp(s.pattern, 'u').test(value)) {
                errors.push({ path: at, message: `Format ungültig: ${JSON.stringify(value)}` + (s.description ? ` – ${s.description}` : '') });
            }
            break;
        case 'integer':
        case 'number':
            if (s.minimum != null && value < s.minimum) {
                errors.push({ path: at, message: `muss ≥ ${s.minimum} sein` });
            }
            break;
        case 'array':
            if (s.minItems != null && value.length < s.minItems) {
                errors.push({ path: at, message: `mindestens ${s.minItems} Einträge nötig` });
            }
            if (s.maxItems != null && value.length > s.maxItems) {
                errors.push({ path: at, message: `höchstens ${s.maxItems} Einträge erlaubt` });
            }
            if (s.items) value.forEach((v, i) => checkNode(s.items, v, joinPath(path, i), root, errors));
            break;
        case 'object': {
            const props = s.properties || {};
            (s.required || []).forEach(key => {
                if (!(key in value)) errors.push({ path: joinPath(path, key), message: 'Pflichtfeld fehlt' });
            });
            Object.keys(value).forEach(key => {
                const sub = joinPath(path, key);
                if (s.propertyNames) {
                    const trial = [];
                    checkNode(s.propertyNames, key, sub, root, trial);
                    if (trial.length) {
                        errors.push({ path: sub, message: `unbekannter Schlüssel – ${trial[0].message}` });
                        return;
                    }
                }
                if (key in props) checkNode(props[key], value[key], sub, root, errors);
                else if (s.additionalProperties === false) errors.push({ path: sub, message: 'unbekanntes Feld' });
                else if (s.additionalProperties && typeof s.additionalProperties === 'object') {
                    checkNode(s.additionalProperties, value[key], sub, root, errors);
                }
            });
            break;
        }
    }
}

export function schemaErrors(data) {
    const errors = [];
    const root = schema();
    checkNode(root, data, '', root, errors);
    return errors;
}

/* ── STIL-HINWEISE ───────────────────────────────────────────
   Dinge, die gültig sind, aber im fertigen Protokoll stören.
   ─────────────────────────────────────────────────────────── */

const MARKDOWN = /\*\*|__|^#{1,6}\s|\[[^\]]+\]\([^)]+\)/m;
const STRAIGHT_QUOTE = /"/;
const isBlank = v => v == null || String(v).trim() === '';

export function lint(data) {
    const w = [];
    const add = (code, path, message) => w.push({ code, path, message });

    if (isBlank(data.author)) add('no-author', 'author', 'Protokollant*in fehlt – die Fußzeile bleibt leer.');
    if (isBlank(data.printDate)) add('no-print-date', 'printDate', 'Erstellungsdatum fehlt.');
    if (data.meetingDate && data.printDate && data.printDate < data.meetingDate) {
        add('print-before-meeting', 'printDate', 'Erstellungsdatum liegt vor dem Sitzungsdatum.');
    }
    if (data.timeFrom && data.timeTo && data.timeTo <= data.timeFrom) {
        add('time-order', 'timeTo', 'Ende liegt nicht nach dem Beginn.');
    }

    const att = data.attendance && typeof data.attendance === 'object' ? data.attendance : {};
    if (!Object.values(att).some(v => !isBlank(v))) add('no-attendance', 'attendance', 'Keine Anwesenden eingetragen.');
    Object.entries(att).forEach(([cls, names]) => {
        if (typeof names === 'string' && /;|\/|\s(und|&)\s/.test(names)) {
            add('attendance-separator', `attendance.${cls}`, 'Namen nur durch Komma trennen (kein „und“, „;“ oder „/“).');
        }
    });

    const sections = Array.isArray(data.sections) ? data.sections : [];
    if (!sections.length) add('no-sections', 'sections', 'Das Protokoll hat keine Punkte.');
    const seen = new Map();
    const ids = new Map();
    sections.forEach((sec, i) => {
        if (!sec || typeof sec !== 'object') return;
        const p = `sections[${i}]`;
        if (typeof sec.id === 'string' && sec.id) {
            if (ids.has(sec.id)) add('duplicate-id', `${p}.id`, `ID doppelt (wie sections[${ids.get(sec.id)}]) – beim Zusammenlegen nur eine behalten.`);
            else ids.set(sec.id, i);
        }
        const title = typeof sec.title === 'string' ? sec.title.trim() : '';
        const text = typeof sec.text === 'string' ? sec.text : '';
        const rows = sec.votes && Array.isArray(sec.votes.rows) ? sec.votes.rows : [];

        if (!title && isBlank(text) && !rows.length) add('empty-section', p, 'Leerer Punkt – erscheint nicht im Protokoll.');
        else if (!title) add('no-title', `${p}.title`, 'Punkt ohne Titel – fehlt in der Themenliste.');
        if (title.endsWith(':')) add('title-colon', `${p}.title`, 'Titel ohne abschließenden Doppelpunkt schreiben.');
        if ([...title].length > 40) add('long-title', `${p}.title`, 'Titel ist sehr lang – besser 1–3 Wörter.');
        if (title) {
            const key = title.toLowerCase();
            if (seen.has(key)) add('duplicate-title', `${p}.title`, `Titel doppelt (wie sections[${seen.get(key)}]).`);
            else seen.set(key, i);
        }
        if (MARKDOWN.test(title) || MARKDOWN.test(text)) add('markdown', p, 'Markdown wird nicht dargestellt (z. B. **fett**) – als reinen Text schreiben.');
        if (STRAIGHT_QUOTE.test(title) || STRAIGHT_QUOTE.test(text)) add('straight-quotes', p, 'Gerade Anführungszeichen – besser „…“.');
        if (text.includes('[?]')) add('placeholder', `${p}.text`, 'Enthält offene Stellen [?].');

        rows.forEach((r, j) => {
            if (!r || typeof r !== 'object') return;
            const rp = `${p}.votes.rows[${j}]`;
            if (isBlank(r.label)) add('vote-no-label', `${rp}.label`, 'Abstimmungszeile ohne Bezeichnung.');
            if (['yes', 'no', 'abstain'].every(k => isBlank(r[k]))) add('vote-no-counts', rp, 'Abstimmungszeile ohne Stimmen.');
        });
    });
    return w;
}

/* ── ZUSAMMENFASSUNG ─────────────────────────────────────── */

function countNames(str) {
    return String(str || '').split(',').map(s => s.trim()).filter(Boolean).length;
}

const wordCount = str => (String(str || '').match(/\S+/g) || []).length;
const sectionWords = sec => wordCount(`${sec.title || ''} ${sec.text || ''}`);
const sectionList = data => (Array.isArray(data.sections) ? data.sections.filter(s => s && typeof s === 'object') : []);

export function stats(data) {
    const sections = sectionList(data);
    const att = data.attendance && typeof data.attendance === 'object' ? data.attendance : {};
    const text = sections.map(s => `${s.title || ''} ${s.text || ''}`).join(' ');
    return {
        meetingDate: data.meetingDate || '',
        topics: sections.map(s => String(s.title || '').trim()).filter(Boolean),
        sections: sections.length,
        voteTables: sections.filter(s => s.votes && Array.isArray(s.votes.rows) && s.votes.rows.length).length,
        attendees: Object.values(att).reduce((n, v) => n + countNames(v), 0),
        classes: Object.values(att).filter(v => countNames(v) > 0).length,
        words: wordCount(text),
        wordsPerSection: sections.map(s => ({ title: String(s.title || '').trim(), words: sectionWords(s) })),
        openQuestions: (text.match(/\[\?\]/g) || []).length
    };
}

/* ── KLARTEXT-VORSCHAU & DIFF ────────────────────────────────
   Beide Ausgaben sind reiner Text und in shared/sv_protokoll.py
   zeichengenau gleich implementiert (Test: tools.test.mjs).
   ─────────────────────────────────────────────────────────── */

const ALL_CLASSES = ['7A', '7B', '8A', '8B', '9A', '9B', '10A', '10B', '11A', '11B', '12A', '12B', '13A', '13B'];
const str = v => (v == null ? '' : String(v));

function formatDate(value) {
    const m = str(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    return m ? `${Number(m[3])}.${Number(m[2])}.${m[1]}` : '…';
}

/* Wie buildSubtitle() in script.js. */
function subtitle(data) {
    const bits = [];
    if (str(data.location).trim()) bits.push(str(data.location).trim());
    const from = str(data.timeFrom).replace(':', '.');
    const to = str(data.timeTo).replace(':', '.');
    if (from && to) bits.push(`${from} – ${to} Uhr`);
    else if (from) bits.push(`ab ${from} Uhr`);
    else if (to) bits.push(`bis ${to} Uhr`);
    return bits.join(' · ');
}

function toNum(value) {
    if (value === '' || value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/* Wie voteResult() in script.js. */
function voteResult(row) {
    const [y, n, a] = [row.yes, row.no, row.abstain].map(toNum);
    if (y === null && n === null && a === null) return '–';
    if ((y || 0) > (n || 0)) return 'Angenommen';
    if ((y || 0) < (n || 0)) return 'Abgelehnt';
    return 'Unentschieden';
}

const voteRows = sec => (sec.votes && Array.isArray(sec.votes.rows) ? sec.votes.rows.filter(r => r && typeof r === 'object') : []);
const hasContent = sec => Boolean(str(sec.title).trim() || str(sec.text).trim() || voteRows(sec).length);

export function preview(data) {
    const out = [`SV-Protokoll – ${formatDate(data.meetingDate)}`];
    const sub = subtitle(data);
    if (sub) out.push(sub);

    const att = data.attendance && typeof data.attendance === 'object' ? data.attendance : {};
    const present = ALL_CLASSES.filter(cls => countNames(att[cls]) > 0);
    const people = present.reduce((n, cls) => n + countNames(att[cls]), 0);
    out.push('', people ? `Anwesend: ${people} ${people === 1 ? 'Person' : 'Personen'} aus ${present.length} ${present.length === 1 ? 'Klasse' : 'Klassen'}` : 'Anwesend: –');
    present.forEach(cls => out.push(`  ${cls}: ${str(att[cls]).trim()}`));

    const sections = sectionList(data).filter(hasContent);
    const topics = sections.map(s => str(s.title).trim()).filter(Boolean);
    if (topics.length) out.push('', `Themen: ${topics.join(', ')}`);

    out.push('', 'Protokoll:');
    sections.forEach(sec => {
        out.push('', `▌ ${str(sec.title).trim() || '(ohne Titel)'}`);
        str(sec.text).split(/\n{2,}/).map(p => p.replace(/\s+$/, '')).filter(p => p.trim())
            .forEach((p, i) => { if (i) out.push(''); out.push(p); });
        const rows = voteRows(sec);
        if (rows.length) {
            const caption = str(sec.votes.caption).trim();
            out.push(`  Abstimmung${caption ? `: ${caption}` : ''}`);
            rows.forEach(r => {
                const cell = v => (toNum(v) === null ? '–' : String(toNum(v)));
                out.push(`  – ${str(r.label).trim() || '–'}: Ja ${cell(r.yes)} · Nein ${cell(r.no)} · Enth. ${cell(r.abstain)} → ${voteResult(r)}`);
            });
        }
    });
    out.push('', `Erstellt von ${str(data.author).trim() || '…'}, ${formatDate(data.printDate)}`);
    return out.join('\n');
}

const EC_FIELDS = [
    ['meetingDate', 'Sitzungsdatum'], ['printDate', 'Erstellt am'], ['author', 'Protokollant*in'],
    ['location', 'Ort'], ['timeFrom', 'Beginn'], ['timeTo', 'Ende']
];

function voteKey(sec) {
    const rows = voteRows(sec);
    return rows.length ? JSON.stringify([str(sec.votes.caption), rows.map(r => [str(r.label), str(r.yes), str(r.no), str(r.abstain)])]) : '';
}

const quote = v => (str(v).trim() ? `„${str(v).trim()}“` : '–');

export function diff(before, after) {
    const out = [];
    const changes = EC_FIELDS.filter(([k]) => str(before[k]).trim() !== str(after[k]).trim())
        .map(([k, label]) => `  ${label}: ${quote(before[k])} → ${quote(after[k])}`);
    if (changes.length) out.push('Eckdaten:', ...changes);

    const attA = before.attendance || {};
    const attB = after.attendance || {};
    const attChanges = ALL_CLASSES.filter(cls => str(attA[cls]).trim() !== str(attB[cls]).trim())
        .map(cls => `  ${cls}: ${quote(attA[cls])} → ${quote(attB[cls])}`);
    if (attChanges.length) out.push('Anwesenheit:', ...attChanges);

    const olds = sectionList(before);
    const used = new Set();
    const title = sec => str(sec.title).trim() || '(ohne Titel)';
    const findOld = sec => {
        let i = sec.id != null && sec.id !== '' ? olds.findIndex((o, k) => !used.has(k) && o.id != null && str(o.id) === str(sec.id)) : -1;
        if (i < 0 && str(sec.title).trim()) {
            i = olds.findIndex((o, k) => !used.has(k) && str(o.title).trim().toLowerCase() === str(sec.title).trim().toLowerCase());
        }
        return i;
    };

    out.push('Punkte:');
    sectionList(after).forEach(sec => {
        const i = findOld(sec);
        if (i < 0) {
            out.push(`  + ${title(sec)} (neu, ${sectionWords(sec)} Wörter)`);
            return;
        }
        used.add(i);
        const old = olds[i];
        const notes = [];
        if (str(old.title).trim() !== str(sec.title).trim()) notes.push(`Titel: ${quote(old.title)} → ${quote(sec.title)}`);
        if (voteKey(old) !== voteKey(sec)) notes.push('Abstimmung geändert');
        const same = !notes.length && str(old.text) === str(sec.text);
        out.push(same
            ? `  = ${title(sec)} (unverändert, ${sectionWords(sec)} Wörter)`
            : `  ~ ${title(sec)} (${sectionWords(old)} → ${sectionWords(sec)} Wörter)${notes.length ? ` [${notes.join('; ')}]` : ''}`);
    });
    olds.forEach((old, k) => {
        if (!used.has(k)) out.push(`  − ${title(old)} (entfernt, ${sectionWords(old)} Wörter)`);
    });

    const a = olds.reduce((n, s) => n + sectionWords(s), 0);
    const b = sectionList(after).reduce((n, s) => n + sectionWords(s), 0);
    const pct = a ? Math.floor(((b - a) / a) * 100 + 0.5) : 0;
    out.push(`Gesamt: ${a} → ${b} Wörter` + (a ? ` (${pct > 0 ? '+' : ''}${pct} %)` : ''));
    return out.join('\n');
}

export function validate(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { valid: false, errors: [{ path: '(Protokoll)', message: 'erwartet ein JSON-Objekt' }], warnings: [], stats: null };
    }
    const errors = schemaErrors(data);
    return { valid: errors.length === 0, errors, warnings: lint(data), stats: stats(data) };
}

/* ── NORMALISIEREN ───────────────────────────────────────────
   Bringt ein gültiges Protokoll in die Form, die der Generator
   selbst exportiert: alle Felder vorhanden, Kennung gesetzt.
   ─────────────────────────────────────────────────────────── */

export function normalise(data) {
    const str = v => (v == null ? '' : String(v));
    const count = v => (v == null ? '' : String(v));
    return {
        format: 'sv-protokoll',
        version: 1,
        meetingDate: str(data.meetingDate),
        printDate: str(data.printDate),
        author: str(data.author),
        location: str(data.location),
        timeFrom: str(data.timeFrom),
        timeTo: str(data.timeTo),
        attendance: Object.fromEntries(Object.entries(data.attendance || {})
            .filter(([, v]) => !isBlank(v))
            .map(([k, v]) => [k, String(v).trim()])),
        sections: (data.sections || []).map(sec => {
            const out = {};
            if (sec.id != null) out.id = String(sec.id);
            out.title = str(sec.title);
            out.text = str(sec.text);
            out.votes = sec.votes && Array.isArray(sec.votes.rows) && sec.votes.rows.length ? {
                caption: str(sec.votes.caption),
                rows: sec.votes.rows.map(r => ({
                    label: str(r.label), yes: count(r.yes), no: count(r.no), abstain: count(r.abstain)
                }))
            } : null;
            return out;
        })
    };
}

/* ── IMPORT-LINKS ────────────────────────────────────────────
   #import=<base64url(deflate-raw(UTF-8-JSON))> – dieselbe
   Kodierung wie in script.js (CompressionStream 'deflate-raw').
   ─────────────────────────────────────────────────────────── */

export function encodePayload(data) {
    return deflateRawSync(Buffer.from(JSON.stringify(data), 'utf8'), { level: 9 }).toString('base64url');
}

export function decodePayload(payload) {
    return JSON.parse(inflateRawSync(Buffer.from(payload, 'base64url')).toString('utf8'));
}

export function makeLink(data, appUrl = DEFAULT_APP_URL) {
    return `${appUrl.replace(/#.*$/, '')}#${LINK_PARAM}=${encodePayload(normalise(data))}`;
}

export function extractPayload(link) {
    const m = String(link).trim().match(new RegExp(`(?:^|[#&])${LINK_PARAM}=([A-Za-z0-9_-]+)`));
    if (m) return m[1];
    if (/^[A-Za-z0-9_-]+$/.test(String(link).trim())) return String(link).trim();
    throw new Error(`Kein „#${LINK_PARAM}=…“ im Link gefunden.`);
}

export function decodeLink(link) {
    return decodePayload(extractPayload(link));
}
