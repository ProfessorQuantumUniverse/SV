/* ============================================================
   SV PROTOKOLL – Script
   ------------------------------------------------------------
   Editor state, vote tables and a measurement-based paginator
   that fills every A4 page as densely as possible without ever
   cutting content off the page.
   ============================================================ */

'use strict';

/* ── CONFIG ──────────────────────────────────────────────── */

const CLASS_LIST_A = ['7A', '8A', '9A', '10A', '11A', '12A', '13A'];
const CLASS_LIST_B = ['7B', '8B', '9B', '10B', '11B', '12B', '13B'];
const ALL_CLASSES = CLASS_LIST_A.flatMap((a, i) => [a, CLASS_LIST_B[i]]).filter(Boolean);

const STORAGE_KEY = 'sv-proto-v5';
const LEGACY_KEYS = ['sv-proto-v4', 'sv-proto-v3'];

/* Never leave fewer than this many words of an entry behind on a
   page when a split is unavoidable – avoids ugly orphan lines. */
const MIN_SPLIT_WORDS = 8;

/* Hard stop for the pagination loop – protects against any
   pathological layout that would otherwise never terminate. */
const MAX_PAGES = 200;

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

/* ── STATE ───────────────────────────────────────────────── */

const state = {
    meetingDate: '',
    printDate: '',
    author: '',
    location: '',
    timeFrom: '',
    timeTo: '',
    attendance: {},
    sections: []
};

let zoomMode = 'fit';   // 'fit' | number
let renderQueued = false;
let lastPageCount = 0;

/* ── SMALL HELPERS ───────────────────────────────────────── */

function esc(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function nl2br(html) {
    return html.replace(/\n/g, '<br>');
}

function words(text) {
    const m = String(text || '').match(/\S+/g);
    return m ? m.length : 0;
}

function toNum(value) {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatDate(dateStr) {
    if (!dateStr) return '…';
    const [y, m, d] = String(dateStr).split('-');
    if (!y || !m || !d) return '…';
    return `${parseInt(d, 10)}.${parseInt(m, 10)}.${y}`;
}

function formatTime(value) {
    if (!value) return '';
    return String(value).replace(':', '.') + ' Uhr';
}

function countNames(str) {
    return String(str || '').split(',').map(s => s.trim()).filter(Boolean).length;
}

/* A section only reaches the document if it carries something. */
function sectionHasContent(sec) {
    return Boolean(
        (sec.title || '').trim() ||
        (sec.text || '').trim() ||
        (sec.votes && sec.votes.rows && sec.votes.rows.length)
    );
}

function emptyVoteRow() {
    return { label: '', yes: '', no: '', abstain: '' };
}

/* ── DOCUMENT HTML BUILDERS ──────────────────────────────────
   Every builder returns a string. The paginator and the visible
   preview use exactly the same builders, so what gets measured
   is byte-for-byte what gets rendered.
   ─────────────────────────────────────────────────────────── */

function buildHeaderHTML() {
    return `
        <div class="page-header">
            <div class="logo-area"><img class="logo-img" src="logo.png" alt="SV FWS FFM"></div>
            <div class="header-line"><div class="header-line-inner"></div></div>
        </div>`;
}

function buildSubtitle() {
    const bits = [];
    if (state.location.trim()) bits.push(state.location.trim());
    const from = formatTime(state.timeFrom);
    const to = formatTime(state.timeTo);
    if (from && to) bits.push(`${String(state.timeFrom).replace(':', '.')} – ${to}`);
    else if (from) bits.push(`ab ${from}`);
    else if (to) bits.push(`bis ${to}`);
    return bits.join('  ·  ');
}

function buildTitleHTML() {
    const sub = buildSubtitle();
    const title = `<div class="page-title${sub ? '' : ' no-subtitle'}">` +
        `SV-Protokoll&nbsp;–&nbsp;<span class="title-date">${formatDate(state.meetingDate)}</span></div>`;
    return sub ? title + `<div class="page-subtitle">${esc(sub)}</div>` : title;
}

function buildAttendanceHTML() {
    /* One grid for both columns: a wrapped name in 7B keeps 7A on
       the same baseline, exactly like the printed reference. */
    const cell = cls => {
        const names = (state.attendance[cls] || '').trim();
        return `<span class="att-class">${cls}:</span>` + (names
            ? `<span class="att-names">${esc(names)}</span>`
            : `<span class="att-names att-empty">–</span>`);
    };

    const rows = CLASS_LIST_A
        .map((cls, i) => cell(cls) + (CLASS_LIST_B[i] ? cell(CLASS_LIST_B[i]) : '<span></span><span></span>'))
        .join('');

    const people = ALL_CLASSES.reduce((sum, cls) => sum + countNames(state.attendance[cls]), 0);
    const classesPresent = ALL_CLASSES.filter(cls => countNames(state.attendance[cls]) > 0).length;
    const summary = people
        ? `<div class="attendance-summary">${people} ${people === 1 ? 'Person' : 'Personen'} aus ${classesPresent} ${classesPresent === 1 ? 'Klasse' : 'Klassen'}</div>`
        : '';

    return `
        <div class="attendance-block">
            <div class="section-header">Anwesend:</div>
            <div class="attendance-panel">
                <div class="attendance-grid">${rows}</div>
            </div>
            ${summary}
        </div>`;
}

function buildTopicsHTML(topics) {
    if (!topics.length) return '';
    return `
        <div class="topics-block">
            <div class="section-header">Themen:</div>
            <ul class="topics-list"><li>${esc(topics.join(', '))}</li></ul>
        </div>`;
}

function buildProtokollHeaderHTML(isFirst) {
    return `<div class="section-header${isFirst ? ' with-underline' : ''}">Protokoll:</div>`;
}

function voteResult(row) {
    const y = toNum(row.yes);
    const n = toNum(row.no);
    const a = toNum(row.abstain);
    if (y === null && n === null && a === null) return { text: '–', cls: 'none' };
    const yes = y || 0;
    const no = n || 0;
    if (yes > no) return { text: 'Angenommen', cls: 'pos' };
    if (yes < no) return { text: 'Abgelehnt', cls: 'neg' };
    return { text: 'Unentschieden', cls: 'neu' };
}

function cell(value) {
    const n = toNum(value);
    return n === null ? '–' : String(n);
}

function buildVoteTableHTML(votes, rowIndices, showCaption) {
    const caption = (votes.caption || '').trim();
    let html = '<div class="vote-block">';

    if (showCaption) {
        if (caption) html += `<div class="vote-caption">${esc(caption)}</div>`;
    } else {
        html += `<div class="vote-caption">${caption ? esc(caption) + ' ' : ''}` +
            `<span class="vote-continued">(Fortsetzung)</span></div>`;
    }

    html += '<table class="vote-table"><thead><tr>' +
        '<th class="col-label">Abstimmung</th>' +
        '<th class="col-num">Ja</th><th class="col-num">Nein</th><th class="col-num">Enth.</th>' +
        '<th class="col-result">Ergebnis</th>' +
        '</tr></thead><tbody>';

    rowIndices.forEach(i => {
        const row = votes.rows[i];
        if (!row) return;
        const res = voteResult(row);
        html += '<tr>' +
            `<td class="col-label">${esc((row.label || '').trim() || 'Abstimmung')}</td>` +
            `<td class="col-num">${cell(row.yes)}</td>` +
            `<td class="col-num">${cell(row.no)}</td>` +
            `<td class="col-num">${cell(row.abstain)}</td>` +
            `<td class="col-result"><span class="vote-result ${res.cls}">${res.text}</span></td>` +
            '</tr>';
    });

    return html + '</tbody></table></div>';
}

/* ── ENTRY ATOMS ─────────────────────────────────────────────
   An entry is broken down into the smallest pieces that may be
   distributed over pages: paragraphs and single table rows.
   ─────────────────────────────────────────────────────────── */

function entryAtoms(sec) {
    const atoms = [];

    String(sec.text || '')
        .split(/\n{2,}/)
        .map(p => p.replace(/\s+$/, ''))
        .filter(p => p.trim().length > 0)
        .forEach(text => atoms.push({ kind: 'para', text }));

    if (sec.votes && Array.isArray(sec.votes.rows) && sec.votes.rows.length) {
        atoms.push({ kind: 'vote-caption' });
        sec.votes.rows.forEach((_, i) => atoms.push({ kind: 'vote-row', index: i }));
    }

    return atoms;
}

function renderEntryPart(sec, atoms, continuation) {
    let html = '<div class="entry-item">';

    const title = (sec.title || '').trim();
    const suffix = continuation ? ' <span class="entry-continued">(Fortsetzung)</span>' : '';
    if (title) {
        html += `<div class="entry-title">${esc(title)}${suffix}</div>`;
    } else if (continuation) {
        html += `<div class="entry-title"><span class="entry-continued">(Fortsetzung)</span></div>`;
    }

    atoms.filter(a => a.kind === 'para').forEach(a => {
        html += `<p class="entry-text">${nl2br(esc(a.text))}</p>`;
    });

    const rowIndices = atoms.filter(a => a.kind === 'vote-row').map(a => a.index);
    if (rowIndices.length) {
        const showCaption = atoms.some(a => a.kind === 'vote-caption');
        html += buildVoteTableHTML(sec.votes, rowIndices, showCaption);
    }

    return html + '</div>';
}

/* Split a paragraph after `n` words, preserving the original
   whitespace (including the single newlines inside it). */
function splitParagraph(text, n) {
    const tokens = String(text).split(/(\s+)/);
    let count = 0;
    let cut = tokens.length;
    for (let i = 0; i < tokens.length; i++) {
        if (i % 2 === 0 && tokens[i] !== '') {
            count++;
            if (count === n) { cut = i + 1; break; }
        }
    }
    return [
        tokens.slice(0, cut).join('').replace(/\s+$/, ''),
        tokens.slice(cut).join('').replace(/^\s+/, '')
    ];
}

function atomWords(atoms) {
    return atoms.reduce((sum, a) => sum + (a.kind === 'para' ? words(a.text) : 0), 0);
}

function buildFooterHTML(pageNo, totalPages, isLast) {
    const left = isLast
        ? `Erstellt von ${esc((state.author || '').trim() || '…')}, ${formatDate(state.printDate)}`
        : 'SV FWS FFM';
    return `<div class="page-footer">` +
        `<span class="footer-meta">${left}</span>` +
        `<span class="footer-page">Seite ${pageNo} von ${totalPages}</span>` +
        `</div>`;
}

/* ── PAGE SHELL ──────────────────────────────────────────── */

function buildPageElement(flowHTML, footerHTML) {
    const page = document.createElement('div');
    page.className = 'protocol-page';
    page.innerHTML =
        `<div class="page-frame">` +
        buildHeaderHTML() +
        `<div class="page-content">` +
        `<div class="protocol-flow">${flowHTML}</div>` +
        footerHTML +
        `</div></div>`;
    return page;
}

/* ── MEASUREMENT PROBES ──────────────────────────────────────
   Two off-screen A4 pages with the exact geometry of a real
   page. `main` accumulates the page being built, `scratch` is
   used for standalone "would this fit on an empty page?" checks.
   ─────────────────────────────────────────────────────────── */

const probes = { main: null, scratch: null };

function getProbe(name) {
    if (probes[name] && probes[name].page.isConnected) return probes[name];

    const host = document.getElementById('measure-host');
    const page = buildPageElement('', buildFooterHTML(1, 1, true));
    page.dataset.probe = name;
    host.appendChild(page);

    probes[name] = {
        page,
        flow: page.querySelector('.protocol-flow'),
        content: page.querySelector('.page-content'),
        footer: page.querySelector('.page-footer')
    };
    return probes[name];
}

/* Usable height for the flowing content of one page. */
function flowCapacity(probe) {
    const cs = getComputedStyle(probe.content);
    const inner = probe.content.clientHeight
        - parseFloat(cs.paddingTop || 0)
        - parseFloat(cs.paddingBottom || 0);
    /* 1px of slack absorbs sub-pixel rounding between the probe
       and the printed page. */
    return inner - probe.footer.offsetHeight - 1;
}

/* ── PAGINATION ──────────────────────────────────────────── */

function buildQueue() {
    const visible = state.sections.filter(sectionHasContent);
    const topics = visible.map(s => (s.title || '').trim()).filter(Boolean);

    const queue = [{ kind: 'block', html: buildAttendanceHTML() }];

    const topicsHTML = buildTopicsHTML(topics);
    if (topicsHTML) queue.push({ kind: 'block', html: topicsHTML });

    queue.push({ kind: 'block', html: buildProtokollHeaderHTML(true), marker: 'protokoll' });

    visible.forEach(sec => {
        queue.push({ kind: 'entry', sec, atoms: entryAtoms(sec), continuation: false });
    });

    return queue;
}

function paginate() {
    const main = getProbe('main');
    const scratch = getProbe('scratch');
    const capacity = flowCapacity(main);

    /* Capacity of a fresh continuation page (title + repeated
       "Protokoll:" header already subtracted). */
    scratch.flow.innerHTML = buildTitleHTML() + buildProtokollHeaderHTML(false);
    const freshUsed = scratch.flow.offsetHeight;
    const freshCapacity = capacity - freshUsed;

    const queue = buildQueue();
    const pages = [];
    let entriesStarted = false;

    /* Trial-insert `html`, read the height, then restore the probe
       exactly – including any whitespace text nodes the insert added. */
    const fitsWith = html => {
        const before = main.flow.childNodes.length;
        main.flow.insertAdjacentHTML('beforeend', html);
        const ok = main.flow.offsetHeight <= capacity;
        while (main.flow.childNodes.length > before) {
            main.flow.removeChild(main.flow.lastChild);
        }
        return ok;
    };

    const commit = html => main.flow.insertAdjacentHTML('beforeend', html);

    /* Would this entry part fit onto an otherwise empty page? */
    const fitsOnFreshPage = html => {
        scratch.flow.innerHTML = html;
        const ok = scratch.flow.offsetHeight <= freshCapacity;
        scratch.flow.innerHTML = '';
        return ok;
    };

    while (queue.length && pages.length < MAX_PAGES) {
        main.flow.innerHTML = buildTitleHTML() +
            (entriesStarted ? buildProtokollHeaderHTML(false) : '');

        let placed = 0;

        while (queue.length) {
            const item = queue[0];

            if (item.kind === 'block') {
                if (fitsWith(item.html)) {
                    commit(item.html);
                    queue.shift();
                    placed++;
                    if (item.marker === 'protokoll') entriesStarted = true;
                    continue;
                }
                if (placed === 0) {
                    /* Cannot happen with sane content, but never
                       spin: force the block onto this page. */
                    commit(item.html);
                    queue.shift();
                    placed++;
                    if (item.marker === 'protokoll') entriesStarted = true;
                }
                break;
            }

            /* kind === 'entry' */
            const fullHTML = renderEntryPart(item.sec, item.atoms, item.continuation);

            if (fitsWith(fullHTML)) {
                commit(fullHTML);
                queue.shift();
                placed++;
                continue;
            }

            /* Prefer moving a whole entry over splitting it, but
               only when it actually fits on a page of its own. */
            if (placed > 0 && fitsOnFreshPage(fullHTML)) break;

            const split = splitEntry(item, fitsWith, placed > 0);
            if (!split.head) break;               // retry on the next page

            commit(split.head);
            placed++;
            queue.shift();
            if (split.tail) queue.unshift(split.tail);
            break;                                 // page is full by definition
        }

        if (placed === 0 && queue.length) {
            /* Absolute last resort: emit the item as-is so the loop
               always makes progress. */
            const item = queue.shift();
            commit(item.kind === 'entry'
                ? renderEntryPart(item.sec, item.atoms, item.continuation)
                : item.html);
            if (item.marker === 'protokoll') entriesStarted = true;
        }

        pages.push(main.flow.innerHTML);
    }

    main.flow.innerHTML = '';
    scratch.flow.innerHTML = '';
    return pages;
}

/* Fit as much of `item` as possible into the space left on the
   current page. Returns { head, tail } where `head` is HTML and
   `tail` is a queue item for the remainder. */
function splitEntry(item, fitsWith, pageHasContent) {
    const { sec, atoms, continuation } = item;
    const render = subset => renderEntryPart(sec, subset, continuation);

    /* Largest atom prefix that still fits (heights grow
       monotonically with the prefix length). */
    let lo = 0;
    let hi = atoms.length - 1;
    let best = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (fitsWith(render(atoms.slice(0, mid)))) { best = mid; lo = mid + 1; }
        else hi = mid - 1;
    }

    if (best < 0) {
        /* Not even the bare title fits. On an empty page we must
           still place something, otherwise pagination stalls. */
        return pageHasContent
            ? { head: null, tail: item }
            : { head: render(atoms.slice(0, 1)), tail: tailItem(item, atoms.slice(1)) };
    }

    let headAtoms = atoms.slice(0, best);
    let tailAtoms = atoms.slice(best);

    /* Try to squeeze a part of the first atom that did not fit. */
    const next = atoms[best];
    if (next && next.kind === 'para') {
        const total = words(next.text);
        let lo2 = 1;
        let hi2 = total - 1;
        let bestWords = 0;
        while (lo2 <= hi2) {
            const mid = (lo2 + hi2) >> 1;
            const [head] = splitParagraph(next.text, mid);
            if (fitsWith(render(headAtoms.concat([{ kind: 'para', text: head }])))) {
                bestWords = mid; lo2 = mid + 1;
            } else {
                hi2 = mid - 1;
            }
        }
        if (bestWords > 0) {
            const [head, tail] = splitParagraph(next.text, bestWords);
            headAtoms = headAtoms.concat([{ kind: 'para', text: head }]);
            tailAtoms = (tail ? [{ kind: 'para', text: tail }] : []).concat(atoms.slice(best + 1));
        }
    }

    /* A lone title or a couple of stray words is worse than a
       clean page break – unless the page is empty anyway. */
    const headRows = headAtoms.filter(a => a.kind === 'vote-row').length;
    const tooThin = atomWords(headAtoms) < MIN_SPLIT_WORDS && headRows < 2;
    if (tooThin && pageHasContent) return { head: null, tail: item };
    if (!headAtoms.length) {
        return pageHasContent
            ? { head: null, tail: item }
            : { head: render(atoms.slice(0, 1)), tail: tailItem(item, atoms.slice(1)) };
    }

    return { head: render(headAtoms), tail: tailItem(item, tailAtoms) };
}

function tailItem(item, atoms) {
    if (!atoms.length) return null;
    return { kind: 'entry', sec: item.sec, atoms, continuation: true };
}

/* ── RENDER ──────────────────────────────────────────────── */

function renderPages(pages) {
    const container = document.getElementById('pdf-preview-container');
    const total = pages.length;
    const frag = document.createDocumentFragment();

    pages.forEach((flowHTML, i) => {
        const page = buildPageElement(flowHTML, buildFooterHTML(i + 1, total, i === total - 1));
        page.dataset.pageIndex = String(i + 1);
        frag.appendChild(page);
    });

    container.replaceChildren(frag);
    lastPageCount = total;

    const status = document.getElementById('preview-status');
    if (status) status.textContent = total === 1 ? '1 Seite' : `${total} Seiten`;
}

function updatePreview() {
    renderPages(paginate());
    applyZoom();
    save();
}

function scheduleUpdate() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
        renderQueued = false;
        updatePreview();
    });
}

/* ── ZOOM ────────────────────────────────────────────────── */

function currentZoom() {
    if (zoomMode !== 'fit') return zoomMode;
    const scroll = document.getElementById('preview-scroll');
    if (!scroll) return 1;
    /* Measured on the probe page: it is never zoomed, so the result
       cannot feed back into itself across renders. */
    const pageWidth = getProbe('main').page.offsetWidth || 794;
    const cs = getComputedStyle(scroll);
    const available = scroll.clientWidth
        - parseFloat(cs.paddingLeft || 0)
        - parseFloat(cs.paddingRight || 0);
    return Math.min(1, Math.max(ZOOM_MIN, available / pageWidth));
}

function applyZoom() {
    const z = currentZoom();
    const container = document.getElementById('pdf-preview-container');
    if (container) container.style.zoom = String(z);
    const label = document.getElementById('btn-zoom-fit');
    if (label) label.textContent = `${Math.round(z * 100)} %`;
}

function nudgeZoom(delta) {
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((currentZoom() + delta) * 100) / 100));
    zoomMode = z;
    applyZoom();
}

/* ── EDITOR: ATTENDANCE ──────────────────────────────────── */

function initAttendanceInputs() {
    const container = document.getElementById('att-input-container');
    const frag = document.createDocumentFragment();

    ALL_CLASSES.forEach(cls => {
        const div = document.createElement('div');
        div.className = 'att-field';
        div.innerHTML =
            `<span class="att-field-label">${cls}</span>` +
            `<input type="text" data-cls="${cls}" class="att-in" aria-label="Anwesend ${cls}">`;
        frag.appendChild(div);
    });

    container.replaceChildren(frag);

    container.addEventListener('input', e => {
        const input = e.target.closest('.att-in');
        if (!input) return;
        state.attendance[input.dataset.cls] = input.value;
        updateAttendanceCount();
        scheduleUpdate();
    });
}

function updateAttendanceCount() {
    const total = ALL_CLASSES.reduce((sum, cls) => sum + countNames(state.attendance[cls]), 0);
    const el = document.getElementById('att-count');
    if (el) el.textContent = `${total} anwesend`;
}

function syncAttendanceInputs() {
    document.querySelectorAll('.att-in').forEach(input => {
        input.value = state.attendance[input.dataset.cls] || '';
    });
    updateAttendanceCount();
}

function clearAttendance() {
    if (!confirm('Alle Namen der Anwesenheitsliste löschen?')) return;
    state.attendance = {};
    syncAttendanceInputs();
    scheduleUpdate();
}

/* ── EDITOR: SECTIONS ────────────────────────────────────── */

function addSection(title = '', text = '') {
    state.sections.push({ id: uid(), title, text, votes: null });
    renderEditorSections();
    updatePreview();
    const last = document.querySelector('#sections-list .section-editor:last-child .sec-title-input');
    if (last) last.focus();
}

function findSection(id) {
    return state.sections.find(s => s.id === id);
}

function moveSection(id, delta) {
    const i = state.sections.findIndex(s => s.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= state.sections.length) return;
    [state.sections[i], state.sections[j]] = [state.sections[j], state.sections[i]];
    renderEditorSections();
    updatePreview();
}

function removeSection(id) {
    state.sections = state.sections.filter(s => s.id !== id);
    renderEditorSections();
    updatePreview();
}

function voteEditorHTML(sec) {
    if (!sec.votes) {
        return `<button type="button" class="btn-vote-add" data-act="add-vote">+ Abstimmungstabelle</button>`;
    }

    const rows = sec.votes.rows.map((row, i) => `
        <div class="vote-grid vote-row-edit" data-row="${i}">
            <input type="text" data-vfield="label" value="${esc(row.label)}" placeholder="Antrag / Frage">
            <input type="number" min="0" data-vfield="yes" value="${esc(row.yes)}" aria-label="Ja">
            <input type="number" min="0" data-vfield="no" value="${esc(row.no)}" aria-label="Nein">
            <input type="number" min="0" data-vfield="abstain" value="${esc(row.abstain)}" aria-label="Enthaltungen">
            <button type="button" class="icon-btn danger" data-act="remove-row" title="Zeile entfernen">✕</button>
        </div>`).join('');

    return `
        <div class="vote-editor">
            <div class="vote-editor-head">
                <input type="text" class="vote-caption-input" data-vcaption value="${esc(sec.votes.caption)}"
                       placeholder="Titel der Abstimmung (optional)">
            </div>
            <div class="vote-rows">
                <div class="vote-grid vote-grid-head">
                    <span>Abstimmung</span><span>Ja</span><span>Nein</span><span>Enth.</span><span></span>
                </div>
                ${rows}
            </div>
            <div class="vote-editor-actions">
                <button type="button" class="btn-mini" data-act="add-row">+ Zeile</button>
                <button type="button" class="btn-mini danger" data-act="remove-vote">Tabelle entfernen</button>
            </div>
        </div>`;
}

function renderEditorSections() {
    const list = document.getElementById('sections-list');
    const empty = document.getElementById('sections-empty');
    const frag = document.createDocumentFragment();

    state.sections.forEach((sec, i) => {
        const el = document.createElement('div');
        el.className = 'section-editor';
        el.dataset.id = sec.id;
        el.innerHTML = `
            <div class="sec-toolbar">
                <span class="sec-index">${i + 1}</span>
                <div class="sec-actions">
                    <button type="button" class="icon-btn" data-act="up" title="Nach oben"
                            ${i === 0 ? 'disabled' : ''}>↑</button>
                    <button type="button" class="icon-btn" data-act="down" title="Nach unten"
                            ${i === state.sections.length - 1 ? 'disabled' : ''}>↓</button>
                    <button type="button" class="icon-btn danger" data-act="remove" title="Punkt löschen">✕</button>
                </div>
            </div>
            <input type="text" class="sec-title-input" data-field="title" value="${esc(sec.title)}"
                   placeholder="Überschrift">
            <textarea class="sec-text-input" data-field="text" placeholder="Inhalt…">${esc(sec.text)}</textarea>
            ${voteEditorHTML(sec)}`;
        frag.appendChild(el);
    });

    list.replaceChildren(frag);
    if (empty) empty.hidden = state.sections.length > 0;
}

/* Re-render only one section's vote editor so typing elsewhere
   never loses focus. */
function refreshVoteEditor(sec) {
    const host = document.querySelector(`.section-editor[data-id="${sec.id}"]`);
    if (!host) return;
    const old = host.querySelector('.vote-editor') || host.querySelector('.btn-vote-add');
    if (!old) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = voteEditorHTML(sec);
    old.replaceWith(tmp.firstElementChild);
}

function initSectionEvents() {
    const list = document.getElementById('sections-list');

    list.addEventListener('input', e => {
        const host = e.target.closest('.section-editor');
        if (!host) return;
        const sec = findSection(host.dataset.id);
        if (!sec) return;

        const field = e.target.dataset.field;
        if (field) {
            sec[field] = e.target.value;
            scheduleUpdate();
            return;
        }

        if (e.target.hasAttribute('data-vcaption') && sec.votes) {
            sec.votes.caption = e.target.value;
            scheduleUpdate();
            return;
        }

        const vfield = e.target.dataset.vfield;
        if (vfield && sec.votes) {
            const rowEl = e.target.closest('[data-row]');
            const row = sec.votes.rows[Number(rowEl.dataset.row)];
            if (row) {
                row[vfield] = e.target.value;
                scheduleUpdate();
            }
        }
    });

    list.addEventListener('click', e => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const host = btn.closest('.section-editor');
        const sec = findSection(host.dataset.id);
        if (!sec) return;

        switch (btn.dataset.act) {
            case 'up':
                moveSection(sec.id, -1);
                break;
            case 'down':
                moveSection(sec.id, 1);
                break;
            case 'remove':
                if (!sectionHasContent(sec) || confirm(`Punkt „${(sec.title || '').trim() || 'ohne Titel'}“ löschen?`)) {
                    removeSection(sec.id);
                }
                break;
            case 'add-vote':
                sec.votes = { caption: '', rows: [emptyVoteRow()] };
                refreshVoteEditor(sec);
                updatePreview();
                break;
            case 'remove-vote':
                sec.votes = null;
                refreshVoteEditor(sec);
                updatePreview();
                break;
            case 'add-row':
                sec.votes.rows.push(emptyVoteRow());
                refreshVoteEditor(sec);
                updatePreview();
                break;
            case 'remove-row': {
                const idx = Number(btn.closest('[data-row]').dataset.row);
                sec.votes.rows.splice(idx, 1);
                if (!sec.votes.rows.length) sec.votes = null;
                refreshVoteEditor(sec);
                updatePreview();
                break;
            }
        }
    });
}

/* ── PERSISTENCE ─────────────────────────────────────────── */

function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
        /* Private mode or a full quota – the preview still works. */
    }
}

function normaliseSection(raw) {
    const sec = {
        id: raw && raw.id != null ? String(raw.id) : uid(),
        title: raw && typeof raw.title === 'string' ? raw.title : '',
        text: raw && typeof raw.text === 'string' ? raw.text : '',
        votes: null
    };
    const v = raw && raw.votes;
    if (v && Array.isArray(v.rows) && v.rows.length) {
        sec.votes = {
            caption: typeof v.caption === 'string' ? v.caption : '',
            rows: v.rows.map(r => ({
                label: r && typeof r.label === 'string' ? r.label : '',
                yes: r && r.yes != null ? String(r.yes) : '',
                no: r && r.no != null ? String(r.no) : '',
                abstain: r && r.abstain != null ? String(r.abstain) : ''
            }))
        };
    }
    return sec;
}

function applyData(data) {
    if (!data || typeof data !== 'object') return false;

    state.meetingDate = data.meetingDate || data.mDate || '';
    state.printDate = data.printDate || data.pDate || '';
    state.author = data.author || '';
    state.location = data.location || '';
    state.timeFrom = data.timeFrom || '';
    state.timeTo = data.timeTo || '';

    const att = data.attendance || data.att || {};
    state.attendance = {};
    ALL_CLASSES.forEach(cls => {
        if (typeof att[cls] === 'string') state.attendance[cls] = att[cls];
    });

    state.sections = Array.isArray(data.sections) ? data.sections.map(normaliseSection) : [];
    return true;
}

function syncFieldInputs() {
    const map = {
        'in-meeting-date': 'meetingDate',
        'in-print-date': 'printDate',
        'in-author': 'author',
        'in-location': 'location',
        'in-time-from': 'timeFrom',
        'in-time-to': 'timeTo'
    };
    Object.entries(map).forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (el) el.value = state[key] || '';
    });
}

function loadSaved() {
    for (const key of [STORAGE_KEY, ...LEGACY_KEYS]) {
        let raw;
        try {
            raw = localStorage.getItem(key);
        } catch (err) {
            return false;
        }
        if (!raw) continue;
        try {
            if (applyData(JSON.parse(raw))) return true;
        } catch (err) {
            /* Corrupt entry – fall through to the next key. */
        }
    }
    return false;
}

function todayISO() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function loadDefaults() {
    state.meetingDate = todayISO();
    state.printDate = todayISO();
    state.sections = [normaliseSection({
        title: 'Verbindungslehrer',
        text: 'Wir haben uns über den aktuellen Stand ausgetauscht…'
    })];
}

function resetAll() {
    if (!confirm('Das gesamte Protokoll zurücksetzen? Alle Eingaben gehen verloren.')) return;
    state.attendance = {};
    state.sections = [];
    state.author = '';
    state.location = '';
    state.timeFrom = '';
    state.timeTo = '';
    loadDefaults();
    syncFieldInputs();
    syncAttendanceInputs();
    renderEditorSections();
    updatePreview();
}

/* ── IMPORT / EXPORT ─────────────────────────────────────── */

/* The exported file carries a format marker so tools (and Claude)
   can recognise it; applyData() ignores unknown keys on import. */
function exportData() {
    return { format: 'sv-protokoll', version: 1, ...state };
}

function exportJSON() {
    const blob = new Blob([JSON.stringify(exportData(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sv-protokoll-${state.meetingDate || todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function refreshAll() {
    syncFieldInputs();
    syncAttendanceInputs();
    renderEditorSections();
    updatePreview();
}

function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            applyData(JSON.parse(String(reader.result)));
            refreshAll();
        } catch (err) {
            alert('Die Datei konnte nicht gelesen werden – ist es ein Export dieses Generators?');
        }
    };
    reader.readAsText(file);
}

/* ── SHARE LINKS ─────────────────────────────────────────────
   #import=<base64url(deflate-raw(JSON))>. The fragment never
   leaves the browser, so a link carries a whole protocol without
   any server. The Claude plugin (plugin/mcp) and the skill script
   (shared/sv_protokoll.py) produce exactly the same encoding.
   ─────────────────────────────────────────────────────────── */

const LINK_PARAM = 'import';

function bytesToBase64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function pipeBytes(bytes, transform) {
    const stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function encodeShare(data) {
    const raw = new TextEncoder().encode(JSON.stringify(data));
    return bytesToBase64Url(await pipeBytes(raw, new CompressionStream('deflate-raw')));
}

async function decodeShare(payload) {
    const raw = await pipeBytes(base64UrlToBytes(payload), new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(raw));
}

function sharePayloadFromHash() {
    const m = location.hash.match(new RegExp(`[#&]${LINK_PARAM}=([A-Za-z0-9_-]+)`));
    return m ? m[1] : null;
}

async function shareLink() {
    const base = location.href.replace(/#.*$/, '');
    return `${base}#${LINK_PARAM}=${await encodeShare(exportData())}`;
}

/* Comparable form of a document – ignores ids and format markers. */
function contentKey(data) {
    const d = data || {};
    const att = d.attendance || {};
    return JSON.stringify([
        d.meetingDate || '', d.printDate || '', d.author || '', d.location || '',
        d.timeFrom || '', d.timeTo || '',
        ALL_CLASSES.map(cls => String(att[cls] || '').trim()),
        (d.sections || []).map(sec => normaliseSection(sec)).map(sec => [sec.title, sec.text, sec.votes])
    ]);
}

function hasOwnContent() {
    return state.sections.some(sectionHasContent) ||
        ALL_CLASSES.some(cls => (state.attendance[cls] || '').trim());
}

/* Loads a protocol from the URL fragment. Returns true when the
   state changed. An existing draft is only replaced after asking. */
async function importFromHash({ askFirst }) {
    const payload = sharePayloadFromHash();
    if (!payload) return false;
    history.replaceState(null, '', location.href.replace(/#.*$/, ''));

    let data;
    try {
        data = await decodeShare(payload);
        if (!data || typeof data !== 'object' || !Array.isArray(data.sections)) throw new Error('no protocol');
    } catch (err) {
        alert('Der Link ist beschädigt oder unvollständig – das Protokoll konnte nicht geladen werden.');
        return false;
    }

    if (contentKey(data) === contentKey(state)) return false;
    if (askFirst && hasOwnContent() &&
        !confirm('Protokoll aus dem Link laden?\n\nDer aktuelle Entwurf wird dabei ersetzt. ' +
            'Tipp: Vorher mit „Export (.json)“ sichern.')) {
        return false;
    }
    applyData(data);
    save();
    showToast('Protokoll aus dem Link geladen');
    return true;
}

async function copyText(text, button, doneLabel) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (err) {
        /* No clipboard permission (e.g. file://) – let the user copy by hand. */
        prompt('Zum Kopieren markieren und Strg+C drücken:', text);
        return;
    }
    const label = button.textContent;
    button.textContent = doneLabel;
    button.disabled = true;
    setTimeout(() => {
        button.textContent = label;
        button.disabled = false;
    }, 1500);
}

let toastTimer = null;
function showToast(message) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

/* ── PDF ─────────────────────────────────────────────────── */

function generatePDF() {
    /* Native print keeps the preview and the PDF pixel-identical. */
    window.print();
}

/* ── INIT ────────────────────────────────────────────────── */

function initFieldEvents() {
    const map = {
        'in-meeting-date': 'meetingDate',
        'in-print-date': 'printDate',
        'in-author': 'author',
        'in-location': 'location',
        'in-time-from': 'timeFrom',
        'in-time-to': 'timeTo'
    };
    Object.entries(map).forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            state[key] = el.value;
            scheduleUpdate();
        });
    });

    document.getElementById('btn-add-section').addEventListener('click', () => addSection());
    document.getElementById('btn-clear-att').addEventListener('click', clearAttendance);
    document.getElementById('btn-pdf').addEventListener('click', generatePDF);
    document.getElementById('btn-reset-all').addEventListener('click', resetAll);
    document.getElementById('btn-export').addEventListener('click', exportJSON);
    document.getElementById('btn-copy-link').addEventListener('click', async e => {
        const btn = e.currentTarget;
        copyText(await shareLink(), btn, 'Link kopiert ✓');
    });
    document.getElementById('btn-copy-json').addEventListener('click', e => {
        copyText(JSON.stringify(exportData(), null, 2), e.currentTarget, 'JSON kopiert ✓');
    });

    const fileInput = document.getElementById('import-file');
    document.getElementById('btn-import').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files[0]) importJSON(fileInput.files[0]);
        fileInput.value = '';
    });

    document.getElementById('btn-zoom-in').addEventListener('click', () => nudgeZoom(ZOOM_STEP));
    document.getElementById('btn-zoom-out').addEventListener('click', () => nudgeZoom(-ZOOM_STEP));
    document.getElementById('btn-zoom-fit').addEventListener('click', () => {
        zoomMode = 'fit';
        applyZoom();
    });

    window.addEventListener('resize', () => {
        if (zoomMode === 'fit') applyZoom();
    });
}

window.addEventListener('load', async () => {
    initAttendanceInputs();
    initSectionEvents();
    initFieldEvents();

    const hadSaved = loadSaved();
    if (!hadSaved) loadDefaults();
    await importFromHash({ askFirst: hadSaved });

    syncFieldInputs();
    syncAttendanceInputs();
    renderEditorSections();

    /* Measurements are only trustworthy once the webfonts and the
       logo have settled – otherwise the first pagination is based
       on fallback metrics. */
    if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch (err) { /* ignore */ }
    }
    updatePreview();

    const logo = document.querySelector('#pdf-preview-container .logo-img');
    if (logo && !logo.complete) logo.addEventListener('load', updatePreview, { once: true });
});

/* A link opened while the page is already open only changes the hash. */
window.addEventListener('hashchange', async () => {
    if (await importFromHash({ askFirst: true })) refreshAll();
});

/* Re-paginate when a late-arriving webfont changes the metrics. */
if (document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener('loadingdone', () => {
        if (lastPageCount) scheduleUpdate();
    });
}

/* Test hook – lets the automated suite drive the app directly. */
window.SV = {
    state,
    paginate,
    updatePreview,
    renderEditorSections,
    syncFieldInputs,
    syncAttendanceInputs,
    applyData,
    exportData,
    encodeShare,
    decodeShare,
    shareLink,
    normaliseSection,
    splitParagraph,
    voteResult,
    entryAtoms,
    addSection
};
