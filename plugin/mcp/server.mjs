#!/usr/bin/env node
/* ============================================================
   SV PROTOKOLL – MCP-Server (stdio, ohne Abhängigkeiten)
   ------------------------------------------------------------
   Gibt Claude das Datenformat, prüft Protokolle, erzeugt
   Import-Links, speichert JSON und rendert PDFs.
   Start: node server.mjs      (Node ≥ 22)
   Umgebungsvariablen (alle optional):
     SV_APP_URL     Adresse des Generators (Standard: GitHub Pages)
     SV_OUTPUT_DIR  Zielordner für Dateien (Standard: ~/Downloads)
     SV_BROWSER     Pfad zu Chrome/Edge für PDFs
   ============================================================ */

import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import {
    DEFAULT_APP_URL, readContent, validate, normalise, makeLink, decodeLink
} from './lib/protokoll.mjs';
import { renderPdf } from './lib/pdf.mjs';

/* Version aus dem Plugin-Manifest bzw. – im .mcpb-Paket – aus manifest.json. */
const PKG = ['../.claude-plugin/plugin.json', '../manifest.json']
    .map(p => new URL(p, import.meta.url))
    .filter(u => existsSync(u))
    .map(u => JSON.parse(readFileSync(u, 'utf8')))[0] || { version: '0.0.0' };
const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const APP_URL = process.env.SV_APP_URL || DEFAULT_APP_URL;

const INSTRUCTIONS = `Werkzeuge für Sitzungsprotokolle der SV FWS Frankfurt im Format des SV-Protokoll-Generators (${APP_URL}).
- Ergebnis ist IMMER ein Link: das fertige Protokoll an protokoll_link geben (prüft selbst) und den gelieferten Markdown-Link in die Antwort übernehmen. Kein JSON im Chat, außer es wird ausdrücklich verlangt.
- Schickt jemand einen Link (…#import=…): mit protokoll_decode_link lesen, bearbeiten, als neuen Link zurückgeben.
- Vor dem Schreiben oder Umformulieren einmal protokoll_format aufrufen (Datenformat + Stilleitfaden).
- protokoll_save_json / protokoll_render_pdf nur auf Wunsch. Niemals Namen, Zahlen oder Beschlüsse erfinden.`;

/* ── HILFSFUNKTIONEN ─────────────────────────────────────── */

class UserError extends Error {}

function parseProtokoll(value) {
    /* Bequemlichkeit: ein Link (…#import=…) wird direkt entpackt. */
    if (typeof value === 'string' && /[#&]import=/.test(value)) {
        try { return decodeLink(value); } catch (err) {
            throw new UserError(`Link konnte nicht gelesen werden: ${err.message}`);
        }
    }
    if (typeof value === 'string') {
        try { return JSON.parse(value); } catch (err) {
            throw new UserError(`„protokoll“ ist kein gültiges JSON: ${err.message}`);
        }
    }
    if (!value || typeof value !== 'object') throw new UserError('„protokoll“ fehlt.');
    return value;
}

function requireValid(data) {
    const result = validate(data);
    if (!result.valid) {
        throw new UserError('Das Protokoll ist ungültig – bitte zuerst korrigieren:\n' +
            result.errors.map(e => `- ${e.path}: ${e.message}`).join('\n'));
    }
    return result;
}

function outputDir() {
    if (process.env.SV_OUTPUT_DIR) return process.env.SV_OUTPUT_DIR;
    const downloads = join(homedir(), 'Downloads');
    return existsSync(downloads) ? downloads : homedir();
}

/* Nie still überschreiben: bei Kollision -2, -3 … anhängen. */
function targetPath(requested, fallbackName, ext) {
    let p = requested ? String(requested) : fallbackName;
    if (!p.toLowerCase().endsWith(ext)) p += ext;
    p = isAbsolute(p) ? p : resolve(outputDir(), p);
    const { dir, name } = parse(p);
    for (let i = 2; existsSync(p); i++) p = join(dir, `${name}-${i}${ext}`);
    mkdirSync(dirname(p), { recursive: true });
    return p;
}

function baseName(data) {
    return `sv-protokoll-${data.meetingDate || new Date().toISOString().slice(0, 10)}`;
}

function formatIssues(result) {
    const lines = [];
    if (result.errors.length) {
        lines.push(`Fehler (${result.errors.length}):`, ...result.errors.map(e => `- ${e.path}: ${e.message}`));
    }
    if (result.warnings.length) {
        lines.push(`Hinweise (${result.warnings.length}):`, ...result.warnings.map(w => `- [${w.code}] ${w.path}: ${w.message}`));
    }
    return lines.join('\n');
}

function linkLabel(data) {
    const [y, m, d] = String(data.meetingDate || '').split('-');
    return y && m && d ? `SV-Protokoll vom ${Number(d)}.${Number(m)}.${y} öffnen` : 'SV-Protokoll öffnen';
}

function summary(s) {
    return `${s.sections} Punkte (${s.topics.join(', ') || '–'}), ${s.attendees} Anwesende aus ${s.classes} Klassen, ` +
        `${s.voteTables} Abstimmungstabelle(n), ${s.words} Wörter` + (s.openQuestions ? `, ${s.openQuestions}× [?]` : '');
}

/* ── TOOLS ───────────────────────────────────────────────── */

const PROTOKOLL_ARG = {
    description: 'Das Protokoll als JSON-Objekt im Format von protokoll_format – oder ein bestehender Link (…#import=…).'
};

const TOOLS = [
    {
        name: 'protokoll_format',
        title: 'Format & Stilleitfaden',
        description: 'Liefert Datenformat, Darstellungsregeln, Stilleitfaden, JSON-Schema und ein vollständiges Beispiel für SV-Protokolle. Vor dem Erstellen oder Bearbeiten eines Protokolls einmal aufrufen.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true, openWorldHint: false },
        run() {
            return [
                readContent('format.md'),
                readContent('stil.md'),
                '# JSON-Schema\n```json\n' + readContent('schema.json').trim() + '\n```',
                '# Beispiel\n```json\n' + readContent('beispiel.json').trim() + '\n```'
            ].join('\n\n---\n\n');
        }
    },
    {
        name: 'protokoll_validate',
        title: 'Protokoll prüfen',
        description: 'Prüft ein Protokoll gegen das Schema (Fehler) und auf typische Stil-/Formprobleme (Hinweise) und fasst den Inhalt zusammen.',
        inputSchema: { type: 'object', properties: { protokoll: PROTOKOLL_ARG }, required: ['protokoll'] },
        annotations: { readOnlyHint: true, openWorldHint: false },
        run({ protokoll }) {
            const result = validate(parseProtokoll(protokoll));
            const head = result.valid ? '✓ Gültig.' : '✗ Ungültig.';
            return {
                text: [head, result.stats ? summary(result.stats) : '', formatIssues(result)].filter(Boolean).join('\n'),
                structured: result
            };
        }
    },
    {
        name: 'protokoll_link',
        title: 'Import-Link erzeugen',
        description: 'Standard-Ausgabe für jedes fertige Protokoll: prüft es und liefert einen Markdown-Link, der es direkt im SV-Protokoll-Generator öffnet. Den Link unverändert in die Antwort übernehmen. Bei Fehlern kommt statt des Links die Fehlerliste – korrigieren und erneut aufrufen.',
        inputSchema: { type: 'object', properties: { protokoll: PROTOKOLL_ARG }, required: ['protokoll'] },
        annotations: { readOnlyHint: true, openWorldHint: false },
        run({ protokoll }) {
            const data = parseProtokoll(protokoll);
            const result = requireValid(data);
            const link = makeLink(data, APP_URL);
            const markdown = `[${linkLabel(data)}](${link})`;
            const lines = [
                markdown,
                '',
                'Diesen Markdown-Link unverändert in die Antwort übernehmen (kein JSON zeigen).',
                summary(result.stats)
            ];
            if (result.warnings.length) lines.push(formatIssues({ errors: [], warnings: result.warnings }));
            if (link.length > 16000) lines.push('Der Link ist sehr lang – zusätzlich protokoll_save_json anbieten.');
            return {
                text: lines.join('\n'),
                structured: { link, markdown, length: link.length, warnings: result.warnings, stats: result.stats }
            };
        }
    },
    {
        name: 'protokoll_decode_link',
        title: 'Link lesen',
        description: 'Liest einen Link aus „Link kopieren“ bzw. protokoll_link (…#import=…) und gibt das enthaltene Protokoll als JSON zurück.',
        inputSchema: {
            type: 'object',
            properties: { link: { type: 'string', description: 'Der vollständige Link oder nur der Teil nach #import=' } },
            required: ['link']
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
        run({ link }) {
            let data;
            try { data = decodeLink(link); } catch (err) {
                throw new UserError(`Link konnte nicht gelesen werden: ${err.message}`);
            }
            return {
                text: JSON.stringify(data, null, 2) +
                    '\n\nNach der Bearbeitung mit protokoll_link wieder als Link zurückgeben.',
                structured: { protokoll: data }
            };
        }
    },
    {
        name: 'protokoll_save_json',
        title: 'Als JSON speichern',
        description: 'Speichert das Protokoll als .json-Datei, die im Generator über „Import“ geladen werden kann. Standardordner: Downloads. Vorhandene Dateien werden nie überschrieben.',
        inputSchema: {
            type: 'object',
            properties: {
                protokoll: PROTOKOLL_ARG,
                pfad: { type: 'string', description: 'Optional: Dateiname oder Pfad. Standard: sv-protokoll-<Sitzungsdatum>.json im Downloads-Ordner.' }
            },
            required: ['protokoll']
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        run({ protokoll, pfad }) {
            const data = parseProtokoll(protokoll);
            requireValid(data);
            const file = targetPath(pfad, baseName(data), '.json');
            writeFileSync(file, JSON.stringify(normalise(data), null, 2) + '\n', 'utf8');
            return { text: `Gespeichert: ${file}`, structured: { path: file } };
        }
    },
    {
        name: 'protokoll_render_pdf',
        title: 'PDF erzeugen',
        description: 'Rendert das Protokoll mit der echten Generator-Seite in einem lokalen Chrome/Edge (headless) zu einem PDF – identisch mit dem Druck aus dem Browser. Braucht Internet (bzw. SV_APP_URL). Standardordner: Downloads.',
        inputSchema: {
            type: 'object',
            properties: {
                protokoll: PROTOKOLL_ARG,
                pfad: { type: 'string', description: 'Optional: Dateiname oder Pfad. Standard: sv-protokoll-<Sitzungsdatum>.pdf im Downloads-Ordner.' }
            },
            required: ['protokoll']
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
        async run({ protokoll, pfad }) {
            const data = parseProtokoll(protokoll);
            requireValid(data);
            const file = targetPath(pfad, baseName(data), '.pdf');
            const { pages } = await renderPdf(normalise(data), file, { appUrl: APP_URL });
            return { text: `PDF gespeichert: ${file} (${pages} ${pages === 1 ? 'Seite' : 'Seiten'})`, structured: { path: file, pages } };
        }
    }
];

/* ── PROMPTS (in Claude als Slash-Befehle) ───────────────── */

function modeBody(name) {
    return readContent(`modi/${name}.md`).replace(/^---[\s\S]*?---\s*/, '');
}

function modeTitle(name) {
    const m = readContent(`modi/${name}.md`).match(/^title:\s*(.+)$/m);
    return m ? m[1].trim() : name;
}

const PROMPTS = [
    {
        name: 'erstellen',
        mode: 'protokoll-erstellen',
        description: 'Neues SV-Protokoll aus Notizen oder einem Transkript erstellen',
        arguments: [{ name: 'material', description: 'Notizen, Transkript oder Dateipfad', required: false }],
        input: a => a.material ? `Material:\n\n${a.material}` : 'Das Material folgt in meiner nächsten Nachricht bzw. ist angehängt.'
    },
    {
        name: 'korrigieren',
        mode: 'protokoll-korrigieren',
        description: 'Bestehendes SV-Protokoll behutsam korrigieren (nur Fehler)',
        arguments: [{ name: 'protokoll', description: 'Protokoll-JSON, Link oder Dateipfad', required: false }],
        input: a => a.protokoll ? `Protokoll:\n\n${a.protokoll}` : 'Das Protokoll folgt in meiner nächsten Nachricht bzw. ist angehängt.'
    },
    {
        name: 'ueberarbeiten',
        mode: 'protokoll-ueberarbeiten',
        description: 'Bestehendes SV-Protokoll gründlich überarbeiten und professionalisieren',
        arguments: [
            { name: 'protokoll', description: 'Protokoll-JSON, Link oder Dateipfad', required: false },
            { name: 'wuensche', description: 'Besondere Wünsche, z. B. „kürzer“', required: false }
        ],
        input: a => [
            a.protokoll ? `Protokoll:\n\n${a.protokoll}` : 'Das Protokoll folgt in meiner nächsten Nachricht bzw. ist angehängt.',
            a.wuensche ? `Wünsche: ${a.wuensche}` : ''
        ].filter(Boolean).join('\n\n')
    }
];

function promptText(p, args) {
    return [
        modeBody(p.mode),
        readContent('ausgabe.md').replaceAll('{{SCRIPT}}', 'sv_protokoll.py'),
        'Lade zuerst mit dem Tool protokoll_format das Datenformat und den Stilleitfaden.',
        '---',
        p.input(args || {})
    ].join('\n\n');
}

/* ── RESSOURCEN ──────────────────────────────────────────── */

const RESOURCES = [
    { uri: 'sv-protokoll://schema', name: 'schema', title: 'JSON-Schema', file: 'schema.json', mimeType: 'application/schema+json' },
    { uri: 'sv-protokoll://format', name: 'format', title: 'Datenformat & Darstellung', file: 'format.md', mimeType: 'text/markdown' },
    { uri: 'sv-protokoll://stil', name: 'stil', title: 'Stilleitfaden', file: 'stil.md', mimeType: 'text/markdown' },
    { uri: 'sv-protokoll://beispiel', name: 'beispiel', title: 'Beispielprotokoll', file: 'beispiel.json', mimeType: 'application/json' }
];

/* ── JSON-RPC ────────────────────────────────────────────── */

class RpcError extends Error {
    constructor(code, message) { super(message); this.code = code; }
}

const handlers = {
    initialize(params) {
        const requested = params && params.protocolVersion;
        return {
            protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
            capabilities: { tools: {}, prompts: {}, resources: {} },
            serverInfo: { name: 'sv-protokoll', title: 'SV-Protokoll', version: PKG.version },
            instructions: INSTRUCTIONS
        };
    },
    ping: () => ({}),
    'tools/list': () => ({
        tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) =>
            ({ name, title, description, inputSchema, annotations }))
    }),
    async 'tools/call'(params) {
        const tool = TOOLS.find(t => t.name === params.name);
        if (!tool) throw new RpcError(-32602, `Unbekanntes Tool: ${params.name}`);
        try {
            const out = await tool.run(params.arguments || {});
            const result = { content: [{ type: 'text', text: typeof out === 'string' ? out : out.text }] };
            if (out && out.structured) result.structuredContent = out.structured;
            return result;
        } catch (err) {
            if (!(err instanceof UserError)) process.stderr.write(`[sv-protokoll] ${err.stack || err}\n`);
            return { content: [{ type: 'text', text: err.message }], isError: true };
        }
    },
    'prompts/list': () => ({
        prompts: PROMPTS.map(p => ({ name: p.name, title: modeTitle(p.mode), description: p.description, arguments: p.arguments }))
    }),
    'prompts/get'(params) {
        const p = PROMPTS.find(x => x.name === params.name);
        if (!p) throw new RpcError(-32602, `Unbekannter Prompt: ${params.name}`);
        return {
            description: p.description,
            messages: [{ role: 'user', content: { type: 'text', text: promptText(p, params.arguments) } }]
        };
    },
    'resources/list': () => ({
        resources: RESOURCES.map(({ uri, name, title, mimeType }) => ({ uri, name, title, mimeType }))
    }),
    'resources/read'(params) {
        const r = RESOURCES.find(x => x.uri === params.uri);
        if (!r) throw new RpcError(-32002, `Unbekannte Ressource: ${params.uri}`);
        return { contents: [{ uri: r.uri, mimeType: r.mimeType, text: readContent(r.file) }] };
    }
};

function send(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(msg) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
        if (msg && msg.id != null && !('result' in msg) && !('error' in msg)) {
            send({ jsonrpc: '2.0', id: msg.id, error: { code: -32600, message: 'Invalid Request' } });
        }
        return;
    }
    const isRequest = msg.id !== undefined && msg.id !== null;
    const handler = handlers[msg.method];
    if (!isRequest) return; /* Benachrichtigungen (initialized, cancelled …) brauchen keine Antwort. */
    if (!handler) {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
        return;
    }
    try {
        send({ jsonrpc: '2.0', id: msg.id, result: await handler(msg.params || {}) });
    } catch (err) {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: err.code || -32603, message: err.message } });
    }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
    }
    if (Array.isArray(msg)) msg.forEach(handle);
    else handle(msg);
});
rl.on('close', () => process.exit(0));
