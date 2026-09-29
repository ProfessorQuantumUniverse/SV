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
    sections.forEach((sec, i) => {
        if (!sec || typeof sec !== 'object') return;
        const p = `sections[${i}]`;
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

export function stats(data) {
    const sections = Array.isArray(data.sections) ? data.sections.filter(s => s && typeof s === 'object') : [];
    const att = data.attendance && typeof data.attendance === 'object' ? data.attendance : {};
    const text = sections.map(s => `${s.title || ''} ${s.text || ''}`).join(' ');
    return {
        meetingDate: data.meetingDate || '',
        topics: sections.map(s => String(s.title || '').trim()).filter(Boolean),
        sections: sections.length,
        voteTables: sections.filter(s => s.votes && Array.isArray(s.votes.rows) && s.votes.rows.length).length,
        attendees: Object.values(att).reduce((n, v) => n + countNames(v), 0),
        classes: Object.values(att).filter(v => countNames(v) > 0).length,
        words: (text.match(/\S+/g) || []).length,
        openQuestions: (text.match(/\[\?\]/g) || []).length
    };
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
