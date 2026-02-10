/* ============================================================
   SV PROTOKOLL – Script
   Multi-page preview + per-page PDF generation
   ============================================================ */

// ── CONFIG ─────────────────────────────────────────────────────
const CLASS_LIST_A = ['7A', '8A', '9A', '10A', '11A', '12A', '13A'];
const CLASS_LIST_B = ['7B', '8B', '9B', '10B', '11B', '12B', '13B'];
const STORAGE_KEY = 'sv-proto-v4';

let sections = [];

// ── INIT ───────────────────────────────────────────────────────
window.addEventListener('load', async () => {
    initAttendanceInputs();

    // Try loading saved data (with backward compatibility for v3)
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('sv-proto-v3');
    if (saved) {
        restoreData(JSON.parse(saved));
        // Migrate to new key if loaded from old version
        if (!localStorage.getItem(STORAGE_KEY)) {
            localStorage.setItem(STORAGE_KEY, saved);
        }
    } else {
        document.getElementById('in-meeting-date').valueAsDate = new Date();
        document.getElementById('in-print-date').valueAsDate = new Date();
        addSection('Verbindungslehrer', 'Wir haben uns über den aktuellen Stand ausgetauscht...');
    }

    // Wait for fonts before first render so measurements are accurate
    await document.fonts.ready;
    updatePreview();
});

// ── ATTENDANCE INPUTS ──────────────────────────────────────────
function initAttendanceInputs() {
    const container = document.getElementById('att-input-container');

    for (let i = 0; i < CLASS_LIST_A.length; i++) {
        container.appendChild(createAttField(CLASS_LIST_A[i]));
        if (CLASS_LIST_B[i]) {
            container.appendChild(createAttField(CLASS_LIST_B[i]));
        }
    }
}

function createAttField(cls) {
    const div = document.createElement('div');
    div.className = 'att-field';
    div.innerHTML = `
        <span class="att-field-label">${cls}</span>
        <input type="text" data-cls="${cls}" class="att-in" oninput="updatePreview()">
    `;
    return div;
}

function clearAtt() {
    if (confirm('Namen löschen?')) {
        document.querySelectorAll('.att-in').forEach(i => i.value = '');
        updatePreview();
    }
}

// ── SECTIONS (PROTOCOL ENTRIES) ────────────────────────────────
function addSection(title = '', text = '') {
    sections.push({ id: Date.now(), title, text });
    renderEditorSections();
    updatePreview();
}

function removeSection(id) {
    sections = sections.filter(s => s.id !== id);
    renderEditorSections();
    updatePreview();
}

function updateSec(id, key, value) {
    const s = sections.find(x => x.id === id);
    if (s) {
        s[key] = value;
        updatePreview();
    }
}

function renderEditorSections() {
    const list = document.getElementById('sections-list');
    list.innerHTML = '';
    sections.forEach(s => {
        const el = document.createElement('div');
        el.className = 'section-editor';
        el.innerHTML = `
            <button class="btn-remove" onclick="removeSection(${s.id})">✕</button>
            <input class="sec-title-input" value="${escapeAttr(s.title)}" placeholder="Überschrift"
                   oninput="updateSec(${s.id}, 'title', this.value)">
            <textarea class="sec-text-input" placeholder="Inhalt..."
                      oninput="updateSec(${s.id}, 'text', this.value)">${escapeHTML(s.text)}</textarea>
        `;
        list.appendChild(el);
    });
}

function escapeHTML(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── DATE FORMATTING ────────────────────────────────────────────
function formatDate(dateStr) {
    if (!dateStr) return '...';
    const [y, m, d] = dateStr.split('-');
    return `${parseInt(d)}.${parseInt(m)}.${y}`;
}

// ── HTML BUILDERS ──────────────────────────────────────────────

function buildLogoHTML() {
    return `<img class="logo-img" src="logo.png" alt="SV FWS FFM">`;
}

function buildHeaderHTML() {
    return `
        <div class="page-header">
            <div class="logo-area">
                ${buildLogoHTML()}
            </div>
            <div class="header-line">
                <div class="header-line-inner"></div>
            </div>
        </div>
    `;
}

function buildTitleHTML(dateStr) {
    return `<div class="page-title">SV-Protokoll &nbsp;-&nbsp; ${formatDate(dateStr)}</div>`;
}

function buildAttendanceHTML(attMap) {
    const renderCol = (classes) => classes.map(cls =>
        `<div class="att-row"><span class="att-class">${cls}:</span><span>${escapeHTML(attMap[cls] || '')}</span></div>`
    ).join('');

    return `
        <div class="attendance-section">
            <div class="section-header">Anwesend:</div>
            <div class="attendance-grid">
                <div>${renderCol(CLASS_LIST_A)}</div>
                <div>${renderCol(CLASS_LIST_B)}</div>
            </div>
        </div>
    `;
}

function buildTopicsHTML(topics) {
    if (topics.length === 0) return '';
    const topicStr = topics.join(', ');
    return `
        <div class="topics-section">
            <div class="section-header">Themen:</div>
            <div class="topics-block">
                <ul><li>${escapeHTML(topicStr)}</li></ul>
            </div>
        </div>
    `;
}

function buildProtokollHeaderHTML(isFirstPage) {
    const cls = isFirstPage ? 'section-header with-underline' : 'section-header';
    return `<div class="${cls}">Protokoll:</div>`;
}

function buildEntryHTML(section) {
    const titlePart = section.title.trim()
        ? `<div class="entry-title">${escapeHTML(section.title)}:</div>`
        : '';
    return `
        <div class="entry-item">
            ${titlePart}
            <div class="entry-text">${escapeHTML(section.text).replace(/\n/g, '<br>')}</div>
        </div>
    `;
}

function buildFooterHTML(author, printDate) {
    return `<div class="page-footer">Erstellt von ${escapeHTML(author || '...')}, ${formatDate(printDate)}</div>`;
}

// ── MEASUREMENT ────────────────────────────────────────────────

function measureHTML(html) {
    const measurer = document.getElementById('measurer');
    measurer.innerHTML = html;
    const h = measurer.offsetHeight;
    measurer.innerHTML = '';
    return h;
}

// ── PAGINATION ─────────────────────────────────────────────────

function paginateContent() {
    // Gather data
    const mDate = document.getElementById('in-meeting-date').value;
    const pDate = document.getElementById('in-print-date').value;
    const author = document.getElementById('in-author').value;

    const attMap = {};
    document.querySelectorAll('.att-in').forEach(i => attMap[i.dataset.cls] = i.value);

    const topics = sections
        .map(s => s.title.trim())
        .filter(t => t.length > 0);

    // Build HTML fragments
    const headerHTML = buildHeaderHTML();
    const titleHTML = buildTitleHTML(mDate);
    const attendanceHTML = buildAttendanceHTML(attMap);
    const topicsHTML = buildTopicsHTML(topics);
    const footerHTML = buildFooterHTML(author, pDate);

    // Measure a sample page frame to get available content height
    // Create a temp page and measure its content area
    const tempPage = document.createElement('div');
    tempPage.className = 'protocol-page';
    tempPage.style.position = 'absolute';
    tempPage.style.left = '-9999px';
    tempPage.style.top = '0';
    tempPage.innerHTML = `
        <div class="page-frame">
            ${headerHTML}
            <div class="page-content" id="temp-content-area">
                ${titleHTML}
            </div>
        </div>
    `;
    document.body.appendChild(tempPage);
    const frameEl = tempPage.querySelector('.page-frame');
    const headerEl = tempPage.querySelector('.page-header');
    const contentEl = tempPage.querySelector('#temp-content-area');

    // Available height = frame height - header height
    const frameHeight = frameEl.clientHeight;
    const headerHeight = headerEl.offsetHeight;
    const contentPadding = parseFloat(getComputedStyle(contentEl).paddingBottom) || 0;
    const availableTotal = frameHeight - headerHeight - contentPadding;
    document.body.removeChild(tempPage);

    // Measure fixed section heights
    const titleH = measureHTML(titleHTML);
    const attendanceH = measureHTML(attendanceHTML);
    const topicsH = measureHTML(topicsHTML);
    const protokollHeaderH = measureHTML(buildProtokollHeaderHTML(true));
    const footerH = measureHTML(footerHTML);

    // Measure each entry
    const entryHeights = sections.map(s => measureHTML(buildEntryHTML(s)));

    // Paginate
    const pages = [];
    let entryIdx = 0;
    let isFirstPage = true;

    // Handle case with no entries
    if (sections.length === 0) {
        pages.push({
            isFirst: true,
            isLast: true,
            entries: [],
            attMap,
            topics,
            mDate,
            pDate,
            author
        });
        return pages;
    }

    while (entryIdx < sections.length) {
        let available = availableTotal;

        // Title is always shown
        available -= titleH;

        // First page has attendance + topics
        if (isFirstPage) {
            available -= attendanceH;
            available -= topicsH;
        }

        // Protokoll header
        available -= protokollHeaderH;

        // Reserve footer space (on last page check later, but always reserve as conservative)
        const isLikelyLast = true; // We'll reserve footer on all pages for safety
        available -= footerH;

        // Add margins/spacing buffer
        available -= 10;

        // Collect entries for this page
        const pageEntries = [];

        // Always add at least one entry per page to prevent infinite loops
        if (entryIdx < sections.length) {
            pageEntries.push(sections[entryIdx]);
            available -= entryHeights[entryIdx];
            entryIdx++;
        }

        // Try to fit more entries if space allows
        while (entryIdx < sections.length && available > 0) {
            const eh = entryHeights[entryIdx];
            if (eh <= available) {
                pageEntries.push(sections[entryIdx]);
                available -= eh;
                entryIdx++;
            } else {
                break;
            }
        }

        const isLast = entryIdx >= sections.length;
        pages.push({
            isFirst: isFirstPage,
            isLast,
            entries: pageEntries,
            attMap,
            topics,
            mDate,
            pDate,
            author
        });

        isFirstPage = false;
    }

    // Mark last page
    if (pages.length > 0) {
        pages.forEach(p => p.isLast = false);
        pages[pages.length - 1].isLast = true;
    }

    return pages;
}

// ── RENDER PREVIEW ─────────────────────────────────────────────

function renderPreview(pages) {
    const container = document.getElementById('pdf-preview-container');
    container.innerHTML = '';

    pages.forEach((page, idx) => {
        const pageDiv = document.createElement('div');
        pageDiv.className = 'protocol-page';
        pageDiv.dataset.pageIndex = idx;

        let contentHTML = '';

        // Title (every page)
        contentHTML += buildTitleHTML(page.mDate);

        // Page 1: attendance + topics
        if (page.isFirst) {
            contentHTML += buildAttendanceHTML(page.attMap);
            contentHTML += buildTopicsHTML(page.topics);
        }

        // Protokoll header + entries
        contentHTML += buildProtokollHeaderHTML(page.isFirst);
        contentHTML += '<div class="protocol-entries">';
        page.entries.forEach(entry => {
            contentHTML += buildEntryHTML(entry);
        });
        contentHTML += '</div>';

        // Footer (last page only)
        if (page.isLast) {
            contentHTML += buildFooterHTML(page.author, page.pDate);
        }

        pageDiv.innerHTML = `
            <div class="page-frame">
                ${buildHeaderHTML()}
                <div class="page-content">
                    ${contentHTML}
                </div>
            </div>
        `;

        container.appendChild(pageDiv);
    });
}

// ── UPDATE PREVIEW (Main entry point) ──────────────────────────

function updatePreview() {
    const pages = paginateContent();
    renderPreview(pages);
    save();
}

// ── SAVE / RESTORE ─────────────────────────────────────────────

function save() {
    const attMap = {};
    document.querySelectorAll('.att-in').forEach(i => attMap[i.dataset.cls] = i.value);

    const data = {
        mDate: document.getElementById('in-meeting-date').value,
        pDate: document.getElementById('in-print-date').value,
        author: document.getElementById('in-author').value,
        att: attMap,
        sections
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function restoreData(data) {
    if (data.mDate) document.getElementById('in-meeting-date').value = data.mDate;
    if (data.pDate) document.getElementById('in-print-date').value = data.pDate;
    if (data.author) document.getElementById('in-author').value = data.author;

    if (data.sections) {
        sections = data.sections;
        renderEditorSections();
    }

    if (data.att) {
        setTimeout(() => {
            document.querySelectorAll('.att-in').forEach(i => {
                if (data.att[i.dataset.cls]) i.value = data.att[i.dataset.cls];
            });
        }, 10);
    }
}

// ── PDF GENERATION ─────────────────────────────────────────────

function generatePDF() {
    // Use the browser's native print → uses the exact same rendering as the preview
    window.print();
}
