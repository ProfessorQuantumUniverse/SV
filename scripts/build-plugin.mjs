/* ============================================================
   SV PROTOKOLL – Plugin aus shared/ und schema/ zusammenbauen
   ------------------------------------------------------------
   Quelle der Wahrheit sind schema/ und shared/. Dieses Skript
   verteilt sie auf den MCP-Server und die drei Skills.

     node scripts/build-plugin.mjs          # plugin/ aktualisieren
     node scripts/build-plugin.mjs --check  # nur prüfen (Tests/CI)
     node scripts/build-plugin.mjs --dist   # + dist/ (Skill-ZIPs, .mcpb)
   ============================================================ */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = join(ROOT, 'shared');
const PLUGIN = join(ROOT, 'plugin');
const DIST = join(ROOT, 'dist');
const CHECK = process.argv.includes('--check');
const BUILD_DIST = process.argv.includes('--dist');

const read = p => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const MODES = readdirSync(join(SHARED, 'modi')).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).sort();

/* ── Soll-Zustand berechnen ──────────────────────────────── */

function splitFrontmatter(src) {
    const m = src.match(/^---\n([\s\S]*?)\n---\n+([\s\S]*)$/);
    if (!m) throw new Error('Frontmatter fehlt');
    const fields = {};
    m[1].split('\n').forEach(line => {
        const i = line.indexOf(':');
        if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    return { fields, body: m[2] };
}

/* keys: welche Frontmatter-Felder der Skill bekommt. claude.ai
   akzeptiert beim ZIP-Upload nur name/description. */
function skillMarkdown(mode, keys) {
    const { fields, body } = splitFrontmatter(read(`shared/modi/${mode}.md`));
    const front = keys.filter(k => fields[k]).map(k => `${k}: ${fields[k]}`).join('\n');
    return `---\n${front}\n---\n<!-- Generiert aus shared/modi/${mode}.md und shared/ausgabe.md – dort bearbeiten, dann \`npm run build\`. -->\n\n` +
        `${body.trim()}\n\n${read('shared/ausgabe.md').trim()}\n`;
}

const REFERENCES = {
    'format.md': 'shared/format.md',
    'stil.md': 'shared/stil.md',
    'beispiel.json': 'shared/beispiel.json',
    'schema.json': 'schema/protokoll.schema.json'
};

function skillFiles(mode, keys) {
    const files = { 'SKILL.md': skillMarkdown(mode, keys), 'scripts/sv_protokoll.py': read('shared/sv_protokoll.py') };
    Object.entries(REFERENCES).forEach(([name, src]) => { files[`references/${name}`] = read(src); });
    return files;
}

function wanted() {
    const out = {};
    const content = { ...REFERENCES, 'ausgabe.md': 'shared/ausgabe.md' };
    Object.entries(content).forEach(([name, src]) => { out[`mcp/content/${name}`] = read(src); });
    MODES.forEach(mode => {
        out[`mcp/content/modi/${mode}.md`] = read(`shared/modi/${mode}.md`);
        Object.entries(skillFiles(mode, ['name', 'description', 'argument-hint']))
            .forEach(([name, text]) => { out[`skills/${mode}/${name}`] = text; });
    });
    return out;
}

/* ── Abgleich ────────────────────────────────────────────── */

function listFiles(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap(name => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? listFiles(p) : [p];
    });
}

const target = wanted();
const managed = [...listFiles(join(PLUGIN, 'mcp', 'content')), ...listFiles(join(PLUGIN, 'skills'))]
    .map(p => relative(PLUGIN, p).split('\\').join('/'));

const stale = Object.entries(target)
    .filter(([p, text]) => !existsSync(join(PLUGIN, p)) ||
        readFileSync(join(PLUGIN, p), 'utf8').replace(/\r\n/g, '\n') !== text)
    .map(([p]) => p);
const orphans = managed.filter(p => !(p in target));

if (CHECK) {
    if (stale.length || orphans.length) {
        console.error('plugin/ ist nicht aktuell – bitte `npm run build` ausführen:');
        [...stale, ...orphans].forEach(p => console.error(`  plugin/${p}`));
        process.exit(1);
    }
    console.log('✓ plugin/ ist aktuell');
    process.exit(0);
}

stale.forEach(p => {
    mkdirSync(dirname(join(PLUGIN, p)), { recursive: true });
    writeFileSync(join(PLUGIN, p), target[p]);
});
orphans.forEach(p => rmSync(join(PLUGIN, p)));
console.log(`plugin/: ${stale.length} aktualisiert, ${orphans.length} entfernt`);

/* ── dist/: ZIPs für claude.ai und Claude Desktop ────────── */

function zip(entries) {
    /* Minimaler ZIP-Writer (Deflate), reicht für ein paar Textdateien. */
    const local = [];
    const central = [];
    let offset = 0;
    Object.entries(entries).forEach(([name, text]) => {
        const data = Buffer.from(text, 'utf8');
        const packed = deflateRawSync(data, { level: 9 });
        const nameBuf = Buffer.from(name, 'utf8');
        const crc = crc32(data);
        const head = Buffer.alloc(30);
        head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6);
        head.writeUInt16LE(8, 8); head.writeUInt32LE(0x00210000, 10); head.writeUInt32LE(crc, 14);
        head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22);
        head.writeUInt16LE(nameBuf.length, 26);
        const dir = Buffer.alloc(46);
        dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6);
        dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(8, 10); dir.writeUInt32LE(0x00210000, 12);
        dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(data.length, 24);
        dir.writeUInt16LE(nameBuf.length, 28); dir.writeUInt32LE(offset, 42);
        local.push(head, nameBuf, packed);
        central.push(dir, nameBuf);
        offset += head.length + nameBuf.length + packed.length;
    });
    const centralBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    const count = Object.keys(entries).length;
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
    end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, centralBuf, end]);
}

if (BUILD_DIST) {
    rmSync(DIST, { recursive: true, force: true });
    mkdirSync(join(DIST, 'skills'), { recursive: true });

    MODES.forEach(mode => {
        const files = skillFiles(mode, ['name', 'description']);
        const entries = Object.fromEntries(Object.entries(files).map(([p, t]) => [`${mode}/${p}`, t]));
        writeFileSync(join(DIST, 'skills', `${mode}.zip`), zip(entries));
    });

    const plugin = JSON.parse(read('plugin/.claude-plugin/plugin.json'));
    const manifest = {
        manifest_version: '0.3',
        name: 'sv-protokoll',
        display_name: 'SV-Protokoll',
        version: plugin.version,
        description: plugin.description,
        author: plugin.author,
        repository: { type: 'git', url: plugin.repository },
        homepage: plugin.homepage,
        license: plugin.license,
        server: {
            type: 'node',
            entry_point: 'server/server.mjs',
            mcp_config: {
                command: 'node',
                args: ['${__dirname}/server/server.mjs'],
                env: { SV_OUTPUT_DIR: '${user_config.output_dir}' }
            }
        },
        user_config: {
            output_dir: {
                type: 'directory',
                title: 'Zielordner',
                description: 'Wohin JSON- und PDF-Dateien gespeichert werden.',
                default: '${HOME}/Downloads',
                required: false
            }
        },
        tools: [
            { name: 'protokoll_format', description: 'Datenformat, Stilleitfaden, Schema und Beispiel' },
            { name: 'protokoll_validate', description: 'Protokoll prüfen' },
            { name: 'protokoll_link', description: 'Link erzeugen, der das Protokoll im Generator öffnet' },
            { name: 'protokoll_decode_link', description: 'Link aus „Link kopieren“ lesen' },
            { name: 'protokoll_save_json', description: 'Als JSON-Datei speichern' },
            { name: 'protokoll_render_pdf', description: 'PDF mit lokalem Chrome/Edge erzeugen' }
        ],
        compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=22.0.0' } }
    };
    const serverFiles = listFiles(join(PLUGIN, 'mcp'))
        .map(p => relative(join(PLUGIN, 'mcp'), p).split('\\').join('/'));
    const entries = { 'manifest.json': JSON.stringify(manifest, null, 2) + '\n' };
    serverFiles.forEach(p => { entries[`server/${p}`] = readFileSync(join(PLUGIN, 'mcp', p), 'utf8'); });
    writeFileSync(join(DIST, 'sv-protokoll.mcpb'), zip(entries));

    console.log(`dist/: ${MODES.length} Skill-ZIPs, sv-protokoll.mcpb`);
}
