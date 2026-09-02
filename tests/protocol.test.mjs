/* ============================================================
   SV PROTOKOLL – automated layout & behaviour tests
   ------------------------------------------------------------
   Run with:  node tests/protocol.test.mjs
   Needs a static server on BASE_URL (see tests/run.sh).
   ============================================================ */

/* Playwright may be installed locally or globally – resolve both. */
const { chromium } = await (async () => {
    for (const spec of ['playwright', process.env.PLAYWRIGHT_MODULE, '/opt/node22/lib/node_modules/playwright/index.mjs']) {
        if (!spec) continue;
        try { return await import(spec); } catch (err) { /* try the next candidate */ }
    }
    throw new Error('Playwright not found – run "npm install -D playwright" or set PLAYWRIGHT_MODULE.');
})();

const BASE_URL = process.env.BASE_URL || 'http://localhost:8123';

/* ── tiny test harness ───────────────────────────────────── */

let passed = 0;
const failures = [];
let currentTest = '';

function check(label, condition, detail) {
    if (condition) {
        passed++;
        return true;
    }
    failures.push(`${currentTest} › ${label}${detail ? `\n      ${detail}` : ''}`);
    return false;
}

async function test(name, fn) {
    currentTest = name;
    const before = failures.length;
    try {
        await fn();
    } catch (err) {
        failures.push(`${name} › threw: ${err && err.stack ? err.stack : err}`);
    }
    const bad = failures.length - before;
    console.log(`${bad ? '✗' : '✓'} ${name}`);
}

/* ── fixtures ────────────────────────────────────────────── */

const LOREM = 'Wir haben den Organisationsstand der geplanten Podiumsdiskussion zur Kommunalwahl im März geprüft. Die meisten Einladungen wurden bereits per Mail versendet. Da die CDU derzeit im Urlaub ist und von der SPD noch keine Rückmeldung vorliegt, werden mit Ihnen und anderen Parteien noch weitere Absprachen getroffen.';

const SHORT = 'Kurze Notiz zu diesem Punkt.';

function makeSections(n, text) {
    return Array.from({ length: n }, (_, i) => ({
        id: 's' + i,
        title: 'Punkt ' + (i + 1),
        text: typeof text === 'function' ? text(i) : text,
        votes: null
    }));
}

/* ── browser plumbing ────────────────────────────────────── */

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();

const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message)));
page.on('console', m => {
    if (m.type() === 'error' && !/favicon|fonts\.googleapis|fonts\.gstatic|net::ERR/.test(m.text())) {
        pageErrors.push('console.error: ' + m.text());
    }
});

await page.goto(BASE_URL + '/index.html');
await page.waitForFunction(() => window.SV && document.querySelector('.protocol-page'));

/* Load a document and re-render, returning the measured layout. */
async function layoutFor(data) {
    return page.evaluate(d => {
        window.SV.applyData(d);
        window.SV.syncFieldInputs();
        window.SV.syncAttendanceInputs();
        window.SV.renderEditorSections();
        window.SV.updatePreview();

        const pages = [...document.querySelectorAll('#pdf-preview-container .protocol-page')];
        return pages.map((pg, i) => {
            const content = pg.querySelector('.page-content');
            const flow = pg.querySelector('.protocol-flow');
            const footer = pg.querySelector('.page-footer');
            const cs = getComputedStyle(content);
            const inner = content.clientHeight
                - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
            const capacity = inner - footer.offsetHeight;

            /* Real spill: how far the last flowed element reaches
               past the bottom of the usable content box. */
            const frameRect = pg.querySelector('.page-frame').getBoundingClientRect();
            const footRect = footer.getBoundingClientRect();
            const flowRect = flow.getBoundingClientRect();

            return {
                index: i + 1,
                used: flow.offsetHeight,
                capacity,
                fillRatio: flow.offsetHeight / capacity,
                overflow: Math.round(flow.offsetHeight - capacity),
                flowOverlapsFooter: Math.round(flowRect.bottom - footRect.top),
                flowInsideFrame: Math.round(frameRect.bottom - flowRect.bottom),
                entries: pg.querySelectorAll('.entry-item').length,
                titles: [...pg.querySelectorAll('.entry-title')].map(e => e.textContent.trim()),
                continuations: pg.querySelectorAll('.entry-continued').length,
                tables: pg.querySelectorAll('.vote-table').length,
                tableRows: pg.querySelectorAll('.vote-table tbody tr').length,
                hasAttendance: !!pg.querySelector('.attendance-block'),
                hasTopics: !!pg.querySelector('.topics-block'),
                protokollHeaders: [...pg.querySelectorAll('.section-header')]
                    .filter(e => e.textContent.trim() === 'Protokoll:').length,
                footerText: footer.textContent.replace(/\s+/g, ' ').trim(),
                pageText: pg.innerText
            };
        });
    }, data);
}

const baseDoc = {
    meetingDate: '2026-01-27',
    printDate: '2026-02-01',
    author: 'Lorenzo Bay-Müller',
    attendance: { '9B': 'Lorenzo, Annika', '7B': 'Tina, Isabella, Samara, Clara' },
    sections: []
};

const doc = extra => ({ ...baseDoc, ...extra });

/* Shared assertion: nothing may ever leave the printable area. */
function assertNoOverflow(pages, label) {
    pages.forEach(p => {
        check(`${label}: page ${p.index} does not overflow`,
            p.overflow <= 0,
            `overflow=${p.overflow}px used=${p.used} capacity=${p.capacity}`);
        check(`${label}: page ${p.index} does not collide with the footer`,
            p.flowOverlapsFooter <= 0,
            `overlap=${p.flowOverlapsFooter}px`);
        check(`${label}: page ${p.index} stays inside the frame`,
            p.flowInsideFrame >= 0,
            `distance to frame bottom=${p.flowInsideFrame}px`);
    });
}

/* ── the tests ───────────────────────────────────────────── */

await test('single short entry renders exactly one page', async () => {
    const pages = await layoutFor(doc({ sections: makeSections(1, SHORT) }));
    check('one page', pages.length === 1, `got ${pages.length}`);
    check('attendance on page 1', pages[0].hasAttendance);
    check('topics on page 1', pages[0].hasTopics);
    check('footer names the author', /Erstellt von Lorenzo Bay-Müller, 1\.2\.2026/.test(pages[0].footerText),
        pages[0].footerText);
    check('footer numbers the page', /Seite 1 von 1/.test(pages[0].footerText), pages[0].footerText);
    assertNoOverflow(pages, 'single');
});

await test('many short entries pack pages densely', async () => {
    const pages = await layoutFor(doc({ sections: makeSections(40, SHORT) }));
    assertNoOverflow(pages, 'dense');
    check('more than one page', pages.length > 1, `got ${pages.length}`);
    check('no page holds a single entry', pages.every(p => p.entries > 1),
        JSON.stringify(pages.map(p => p.entries)));
    /* Every page but the last must be well filled. */
    pages.slice(0, -1).forEach(p => {
        check(`page ${p.index} is at least 88 % full`, p.fillRatio >= 0.88,
            `fill=${(p.fillRatio * 100).toFixed(1)}%`);
    });
    const total = pages.reduce((s, p) => s + p.entries, 0);
    check('all 40 entries are present', total === 40, `got ${total}`);
});

await test('long entries pack densely and are never cut', async () => {
    const pages = await layoutFor(doc({ sections: makeSections(14, LOREM) }));
    assertNoOverflow(pages, 'long');
    pages.slice(0, -1).forEach(p => {
        check(`page ${p.index} is at least 80 % full`, p.fillRatio >= 0.80,
            `fill=${(p.fillRatio * 100).toFixed(1)}%`);
    });
    const text = pages.map(p => p.pageText).join('\n');
    check('every entry title appears', Array.from({ length: 14 }, (_, i) => `Punkt ${i + 1}`)
        .every(t => text.includes(t)));
});

await test('an entry that fits on a fresh page is moved, not split', async () => {
    /* Three quarters of a page each: entry 2 cannot follow entry 1,
       but it fits alone – so it must move whole. */
    const chunk = Array(5).fill(LOREM).join('\n\n');
    const pages = await layoutFor(doc({ sections: makeSections(4, chunk) }));
    assertNoOverflow(pages, 'move-whole');
    check('no continuation markers', pages.every(p => p.continuations === 0),
        JSON.stringify(pages.map(p => p.continuations)));
});

await test('an entry taller than a page is split, not cut', async () => {
    const huge = Array(14).fill(LOREM).join('\n\n');
    const pages = await layoutFor(doc({ sections: [{ id: 'x', title: 'Riesenpunkt', text: huge }] }));
    assertNoOverflow(pages, 'split');
    check('spans several pages', pages.length >= 2, `got ${pages.length}`);
    check('later pages are marked as continuations',
        pages.slice(1).every(p => p.continuations === 1),
        JSON.stringify(pages.map(p => p.continuations)));
    check('continuation pages repeat the Protokoll header',
        pages.slice(1).every(p => p.protokollHeaders === 1),
        JSON.stringify(pages.map(p => p.protokollHeaders)));

    /* Not a single word may be lost in the split. */
    const printed = pages.map(p => p.pageText).join(' ').replace(/\s+/g, ' ');
    const sourceWords = huge.split(/\s+/).filter(Boolean);
    const missing = sourceWords.filter(w => !printed.includes(w));
    check('no words are dropped', missing.length === 0, `missing: ${missing.slice(0, 5).join(', ')}`);
});

await test('a split never leaves a stub of an entry behind', async () => {
    /* Walk the split boundary word by word: every extra word of
       filler moves the break of the following huge entry, so this
       hits every possible break position – including the nasty ones
       where only a sliver of a line is left at the page bottom. */
    const huge = Array(12).fill(LOREM).join('\n\n');
    const pool = Array(30).fill(LOREM).join(' ').split(/\s+/);

    const overflows = [];
    const stubs = [];
    let splitsSeen = 0;
    let smallestHead = Infinity;

    for (let padWords = 110; padWords <= 210; padWords++) {
        const pages = await layoutFor(doc({
            sections: [
                { id: 'pad', title: 'Vorspann', text: pool.slice(0, padWords).join(' ') },
                { id: 'big', title: 'Langer Punkt', text: huge }
            ]
        }));

        pages.forEach(pg => {
            if (pg.overflow > 0 || pg.flowOverlapsFooter > 0) {
                overflows.push(`pad=${padWords} page=${pg.index} overflow=${pg.overflow}`);
            }
        });

        const found = await page.evaluate(() => {
            const out = [];
            const sheets = [...document.querySelectorAll('#pdf-preview-container .protocol-page')];
            sheets.forEach((sheet, i) => {
                const next = sheets[i + 1];
                if (!next) return;
                const firstNext = next.querySelector('.entry-item');
                if (!firstNext || !firstNext.querySelector('.entry-continued')) return;  // clean break
                const entries = [...sheet.querySelectorAll('.entry-item')];
                if (entries.length < 2) return;   // the head had the page to itself
                const head = entries[entries.length - 1];
                const body = [...head.querySelectorAll('.entry-text')].map(e => e.textContent).join(' ');
                out.push({
                    page: i + 1,
                    words: (body.match(/\S+/g) || []).length,
                    rows: head.querySelectorAll('.vote-table tbody tr').length
                });
            });
            return out;
        });

        found.forEach(st => {
            splitsSeen++;
            smallestHead = Math.min(smallestHead, st.words);
            if (st.words < 8 && st.rows < 2) {
                stubs.push(`pad=${padWords} page=${st.page} → only ${st.words} words`);
            }
        });
    }

    /* Second shape: an entry that opens with very short paragraphs.
       Here a break can land right after a two-word line, which is
       exactly the stub the orphan rule has to refuse. */
    const stubby = ['Ja.', 'Nein.', 'Vielleicht auch nicht.', 'Offen.']
        .concat(Array(10).fill(LOREM)).join('\n\n');
    let stubbySplits = 0;

    for (let padWords = 110; padWords <= 210; padWords++) {
        const pages = await layoutFor(doc({
            sections: [
                { id: 'pad', title: 'Vorspann', text: pool.slice(0, padWords).join(' ') },
                { id: 'big', title: 'Kurze Absätze', text: stubby }
            ]
        }));

        pages.forEach(pg => {
            if (pg.overflow > 0 || pg.flowOverlapsFooter > 0) {
                overflows.push(`stubby pad=${padWords} page=${pg.index} overflow=${pg.overflow}`);
            }
        });

        const found = await page.evaluate(() => {
            const out = [];
            const sheets = [...document.querySelectorAll('#pdf-preview-container .protocol-page')];
            sheets.forEach((sheet, i) => {
                const next = sheets[i + 1];
                if (!next) return;
                const firstNext = next.querySelector('.entry-item');
                if (!firstNext || !firstNext.querySelector('.entry-continued')) return;
                const entries = [...sheet.querySelectorAll('.entry-item')];
                if (entries.length < 2) return;
                const head = entries[entries.length - 1];
                const body = [...head.querySelectorAll('.entry-text')].map(e => e.textContent).join(' ');
                out.push({ page: i + 1, words: (body.match(/\S+/g) || []).length,
                           rows: head.querySelectorAll('.vote-table tbody tr').length });
            });
            return out;
        });

        found.forEach(st => {
            stubbySplits++;
            splitsSeen++;
            smallestHead = Math.min(smallestHead, st.words);
            if (st.words < 8 && st.rows < 2) {
                stubs.push(`short-paragraph entry, pad=${padWords} page=${st.page} → only ${st.words} words`);
            }
        });
    }

    check('the short-paragraph shape also produced splits', stubbySplits > 10,
        `${stubbySplits} splits observed`);
    check('the sweep produced split boundaries', splitsSeen > 20, `${splitsSeen} splits observed`);
    check('no page overflows anywhere in the sweep', overflows.length === 0,
        overflows.slice(0, 4).join('; '));
    check('no split leaves a stub behind', stubs.length === 0,
        `${stubs.length} stub(s), e.g. ${stubs.slice(0, 4).join('; ')}`);
    console.log(`    (${splitsSeen} split boundaries checked, smallest head: ${
        smallestHead === Infinity ? 'n/a' : smallestHead} words)`);
});

await test('page numbering is correct and complete', async () => {
    const pages = await layoutFor(doc({ sections: makeSections(30, LOREM) }));
    const n = pages.length;
    check('several pages', n >= 3, `got ${n}`);
    pages.forEach(p => {
        check(`page ${p.index} numbered correctly`,
            p.footerText.includes(`Seite ${p.index} von ${n}`), p.footerText);
    });
    check('only the last page carries the author line',
        pages.filter(p => p.footerText.includes('Erstellt von')).length === 1,
        JSON.stringify(pages.map(p => p.footerText)));
    check('author line is on the last page', pages[n - 1].footerText.includes('Erstellt von'));
});

await test('vote tables render with computed results', async () => {
    const pages = await layoutFor(doc({
        sections: [{
            id: 'v', title: 'SV-Aktion', text: 'Wir haben über das Ziel abgestimmt.',
            votes: {
                caption: 'Abstimmung über das Ausflugsziel',
                rows: [
                    { label: 'Escape Room', yes: '9', no: '3', abstain: '1' },
                    { label: 'Lasertag', yes: '2', no: '8', abstain: '3' },
                    { label: 'Bowling', yes: '5', no: '5', abstain: '3' },
                    { label: 'Trampolinhalle', yes: '', no: '', abstain: '' }
                ]
            }
        }]
    }));
    assertNoOverflow(pages, 'votes');
    check('one table', pages[0].tables === 1, `got ${pages[0].tables}`);
    check('four rows', pages[0].tableRows === 4, `got ${pages[0].tableRows}`);
    const t = pages[0].pageText;
    check('caption printed', t.includes('Abstimmung über das Ausflugsziel'));
    check('majority yes → Angenommen', t.includes('Angenommen'));
    check('majority no → Abgelehnt', t.includes('Abgelehnt'));
    check('tie → Unentschieden', t.includes('Unentschieden'));
    check('column headers printed', /Ja/.test(t) && /Nein/.test(t) && /Enth\./.test(t) && /Ergebnis/.test(t));

    const results = await page.evaluate(() => [
        window.SV.voteResult({ yes: '9', no: '3', abstain: '1' }).text,
        window.SV.voteResult({ yes: '2', no: '8', abstain: '0' }).text,
        window.SV.voteResult({ yes: '4', no: '4', abstain: '2' }).text,
        window.SV.voteResult({ yes: '', no: '', abstain: '' }).text
    ]);
    check('result logic', JSON.stringify(results) ===
        JSON.stringify(['Angenommen', 'Abgelehnt', 'Unentschieden', '–']), JSON.stringify(results));
});

await test('a long vote table splits across pages and repeats its header', async () => {
    const rows = Array.from({ length: 45 }, (_, i) => ({
        label: 'Antrag Nummer ' + (i + 1), yes: String(i % 12), no: String((i * 3) % 11), abstain: '1'
    }));
    const pages = await layoutFor(doc({
        sections: [{ id: 'v', title: 'Sehr viele Abstimmungen', text: 'Ergebnisse:', votes: { caption: 'Anträge', rows } }]
    }));
    assertNoOverflow(pages, 'table-split');
    check('spans several pages', pages.length >= 2, `got ${pages.length}`);
    const totalRows = pages.reduce((s, p) => s + p.tableRows, 0);
    check('all 45 rows are printed', totalRows === 45, `got ${totalRows}`);
    check('each table part has a header',
        pages.every(p => p.tables === 0 || /Ergebnis/.test(p.pageText)));
    check('continuation is marked', pages.slice(1).some(p => /Fortsetzung/.test(p.pageText)));
});

await test('an empty document still renders a valid page', async () => {
    const pages = await layoutFor(doc({ sections: [], attendance: {} }));
    check('one page', pages.length === 1, `got ${pages.length}`);
    check('attendance grid present', pages[0].hasAttendance);
    check('no topics block', !pages[0].hasTopics);
    check('Protokoll header present', pages[0].protokollHeaders === 1);
    assertNoOverflow(pages, 'empty');
});

await test('sections without any content are skipped', async () => {
    const pages = await layoutFor(doc({
        sections: [
            { id: 'a', title: 'Echt', text: 'Inhalt' },
            { id: 'b', title: '', text: '' },
            { id: 'c', title: '   ', text: '  \n ' }
        ]
    }));
    check('exactly one entry', pages[0].entries === 1, `got ${pages[0].entries}`);
    assertNoOverflow(pages, 'skip-empty');
});

await test('one gigantic paragraph without breaks is split by words', async () => {
    const oneParagraph = Array(30).fill(LOREM).join(' ');
    const pages = await layoutFor(doc({ sections: [{ id: 'p', title: 'Fließtext', text: oneParagraph }] }));
    assertNoOverflow(pages, 'word-split');
    check('spans several pages', pages.length >= 2, `got ${pages.length}`);
    const printed = pages.map(p => p.pageText).join(' ').replace(/\s+/g, ' ');
    const src = oneParagraph.split(/\s+/).filter(Boolean);
    check('word count preserved',
        src.every(w => printed.includes(w)), 'some words were lost during the word-level split');
});

await test('legacy v3/v4 saved data still loads', async () => {
    const pages = await layoutFor({
        mDate: '2025-11-04', pDate: '2025-11-05', author: 'Alt',
        att: { '10A': 'Jemand' },
        sections: [{ id: 1, title: 'Altes Format', text: 'Migrierter Text' }]
    });
    check('renders', pages.length === 1);
    check('date migrated', pages[0].pageText.includes('4.11.2025'), pages[0].pageText.slice(0, 120));
    check('entry migrated', pages[0].pageText.includes('Altes Format'));
    check('attendance migrated', pages[0].pageText.includes('Jemand'));
});

await test('optional Ort/Uhrzeit appear as a subtitle', async () => {
    const withMeta = await layoutFor(doc({
        location: 'SV-Raum', timeFrom: '13:30', timeTo: '14:15',
        sections: makeSections(1, SHORT)
    }));
    check('subtitle printed', /SV-RAUM/i.test(withMeta[0].pageText), withMeta[0].pageText.slice(0, 200));
    check('times printed', withMeta[0].pageText.includes('13.30'), withMeta[0].pageText.slice(0, 200));

    const without = await layoutFor(doc({ sections: makeSections(1, SHORT) }));
    check('no subtitle element when empty',
        await page.evaluate(() => !document.querySelector('.page-subtitle')));
    check('still renders', without.length === 1);
});

await test('HTML in user input is escaped, not executed', async () => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    await layoutFor(doc({
        author: evil,
        attendance: { '7A': evil },
        sections: [{ id: 'x', title: evil, text: evil, votes: { caption: evil, rows: [{ label: evil, yes: '1', no: '0', abstain: '' }] } }]
    }));
    const pwned = await page.evaluate(() => window.__pwned === 1 ||
        document.querySelectorAll('#pdf-preview-container img[src="x"]').length > 0);
    check('no injected element or script ran', pwned === false);
    const shown = await page.evaluate(() => document.querySelector('.entry-title').textContent);
    check('markup shown literally', shown.includes('<img'), shown);
});

await test('reordering and deleting sections works', async () => {
    await layoutFor(doc({ sections: makeSections(3, SHORT) }));
    await page.click('#sections-list .section-editor:nth-child(3) [data-act="up"]');
    let order = await page.evaluate(() => window.SV.state.sections.map(s => s.title));
    check('moved up', JSON.stringify(order) === JSON.stringify(['Punkt 1', 'Punkt 3', 'Punkt 2']),
        JSON.stringify(order));

    await page.click('#sections-list .section-editor:nth-child(1) [data-act="down"]');
    order = await page.evaluate(() => window.SV.state.sections.map(s => s.title));
    check('moved down', JSON.stringify(order) === JSON.stringify(['Punkt 3', 'Punkt 1', 'Punkt 2']),
        JSON.stringify(order));

    check('first "up" is disabled',
        await page.isDisabled('#sections-list .section-editor:nth-child(1) [data-act="up"]'));
    check('last "down" is disabled',
        await page.isDisabled('#sections-list .section-editor:nth-child(3) [data-act="down"]'));

    page.once('dialog', d => d.accept());
    await page.click('#sections-list .section-editor:nth-child(2) [data-act="remove"]');
    order = await page.evaluate(() => window.SV.state.sections.map(s => s.title));
    check('deleted', JSON.stringify(order) === JSON.stringify(['Punkt 3', 'Punkt 2']), JSON.stringify(order));
});

await test('vote table editor adds and removes rows', async () => {
    await layoutFor(doc({ sections: makeSections(1, SHORT) }));
    await page.click('#sections-list .section-editor [data-act="add-vote"]');
    check('table created with one row',
        await page.locator('#sections-list .vote-row-edit').count() === 1);

    await page.click('#sections-list [data-act="add-row"]');
    await page.click('#sections-list [data-act="add-row"]');
    check('three rows', await page.locator('#sections-list .vote-row-edit').count() === 3);

    const firstRow = page.locator('#sections-list .vote-row-edit').first();
    await firstRow.locator('[data-vfield="label"]').fill('Antrag A');
    await firstRow.locator('[data-vfield="yes"]').fill('7');
    await firstRow.locator('[data-vfield="no"]').fill('2');
    await page.waitForTimeout(120);
    const printed = await page.evaluate(() => document.querySelector('.vote-table').innerText);
    check('typed values reach the document', /Antrag A/.test(printed) && /Angenommen/.test(printed), printed);

    await page.locator('#sections-list .vote-row-edit').last().locator('[data-act="remove-row"]').click();
    check('row removed', await page.locator('#sections-list .vote-row-edit').count() === 2);

    await page.click('#sections-list [data-act="remove-vote"]');
    check('table removed', await page.locator('#sections-list .vote-editor').count() === 0);
    check('document no longer shows a table',
        await page.locator('#pdf-preview-container .vote-table').count() === 0);
});

await test('state survives a reload', async () => {
    await layoutFor(doc({
        author: 'Persistenz Test',
        location: 'Bibliothek',
        attendance: { '11B': 'Mia' },
        sections: [{ id: 'p1', title: 'Gespeichert', text: 'Bleibt erhalten', votes: { caption: 'Wahl', rows: [{ label: 'A', yes: '3', no: '1', abstain: '0' }] } }]
    }));
    await page.reload();
    await page.waitForFunction(() => window.SV && document.querySelector('.protocol-page'));
    const after = await page.evaluate(() => ({
        author: window.SV.state.author,
        location: window.SV.state.location,
        att: window.SV.state.attendance['11B'],
        title: window.SV.state.sections[0].title,
        rows: window.SV.state.sections[0].votes.rows.length,
        text: document.querySelector('#pdf-preview-container').innerText
    }));
    check('author restored', after.author === 'Persistenz Test', after.author);
    check('location restored', after.location === 'Bibliothek', after.location);
    check('attendance restored', after.att === 'Mia', after.att);
    check('section restored', after.title === 'Gespeichert', after.title);
    check('vote rows restored', after.rows === 1, String(after.rows));
    check('document re-rendered', after.text.includes('Bleibt erhalten'));
    check('input fields repopulated',
        await page.inputValue('#in-author') === 'Persistenz Test');
});

await test('print stylesheet keeps exactly one A4 sheet per page', async () => {
    await layoutFor(doc({ sections: makeSections(14, LOREM) }));
    await page.emulateMedia({ media: 'print' });
    const info = await page.evaluate(() => {
        const pages = [...document.querySelectorAll('#pdf-preview-container .protocol-page')];
        const probes = [...document.querySelectorAll('#measure-host .protocol-page')];
        const mm = 96 / 25.4;
        return {
            count: pages.length,
            sidebarHidden: getComputedStyle(document.querySelector('.editor-sidebar')).display === 'none',
            toolbarHidden: getComputedStyle(document.querySelector('.preview-toolbar')).display === 'none',
            probeHidden: getComputedStyle(document.getElementById('measure-host')).display === 'none',
            probesInvisible: probes.every(p => p.getBoundingClientRect().height === 0),
            sizes: pages.map(p => ({
                w: Math.round(p.getBoundingClientRect().width / mm),
                h: Math.round(p.getBoundingClientRect().height / mm)
            })),
            gaps: pages.slice(1).map((p, i) => Math.round(
                p.getBoundingClientRect().top - pages[i].getBoundingClientRect().bottom))
        };
    });
    check('sidebar hidden in print', info.sidebarHidden);
    check('toolbar hidden in print', info.toolbarHidden);
    check('measure host hidden in print', info.probeHidden);
    check('probe pages produce no printed sheets', info.probesInvisible);
    check('every sheet is A4', info.sizes.every(s => s.w === 210 && s.h === 297), JSON.stringify(info.sizes));
    check('sheets are flush (no gaps)', info.gaps.every(g => g === 0), JSON.stringify(info.gaps));
    await page.emulateMedia({ media: 'screen' });
});

await test('screen zoom never reaches the printed page', async () => {
    await layoutFor(doc({ sections: makeSections(6, LOREM) }));
    await page.click('#btn-zoom-out');
    await page.click('#btn-zoom-out');
    const screenZoom = await page.evaluate(() =>
        getComputedStyle(document.getElementById('pdf-preview-container')).zoom);
    check('preview really is zoomed out', Number(screenZoom) < 1, String(screenZoom));

    await page.emulateMedia({ media: 'print' });
    const printed = await page.evaluate(() => {
        const mm = 96 / 25.4;
        const r = document.querySelector('#pdf-preview-container .protocol-page').getBoundingClientRect();
        return { zoom: getComputedStyle(document.getElementById('pdf-preview-container')).zoom,
                 w: Math.round(r.width / mm), h: Math.round(r.height / mm) };
    });
    check('print resets the zoom', Number(printed.zoom) === 1, String(printed.zoom));
    check('sheet is still A4 when printing while zoomed',
        printed.w === 210 && printed.h === 297, JSON.stringify(printed));
    await page.emulateMedia({ media: 'screen' });
    await page.click('#btn-zoom-fit');
});

await test('pagination is stable and fast', async () => {
    const sections = makeSections(60, i => (i % 3 === 0 ? LOREM : SHORT));
    const first = await layoutFor(doc({ sections }));
    const t0 = Date.now();
    const second = await layoutFor(doc({ sections }));
    const elapsed = Date.now() - t0;
    check('identical result on re-run',
        JSON.stringify(first.map(p => p.entries)) === JSON.stringify(second.map(p => p.entries)),
        `${JSON.stringify(first.map(p => p.entries))} vs ${JSON.stringify(second.map(p => p.entries))}`);
    check('60 sections paginate in under 2 s', elapsed < 2000, `${elapsed} ms`);
    assertNoOverflow(second, 'stability');
});

await test('export produces a file that imports back identically', async () => {
    const original = doc({
        author: 'Export Test', location: 'Aula', timeFrom: '09:00', timeTo: '10:30',
        attendance: { '8A': 'Nina', '12B': 'Jonas, Mara' },
        sections: [
            { id: 'e1', title: 'Punkt A', text: 'Absatz eins.\n\nAbsatz zwei.' },
            { id: 'e2', title: 'Punkt B', text: 'Mit Tabelle',
              votes: { caption: 'Wahl', rows: [{ label: 'Ja/Nein', yes: '4', no: '1', abstain: '2' }] } }
        ]
    });
    const before = await layoutFor(original);

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.click('#btn-export')
    ]);
    const stream = await download.createReadStream();
    let raw = '';
    for await (const chunk of stream) raw += chunk;
    const exported = JSON.parse(raw);

    check('filename carries the meeting date',
        download.suggestedFilename() === 'sv-protokoll-2026-01-27.json',
        download.suggestedFilename());

    /* Wipe everything, then feed the export back in. */
    await layoutFor({ sections: [] });
    const after = await layoutFor(exported);

    check('same number of pages', after.length === before.length,
        `${before.length} → ${after.length}`);
    check('same rendered text',
        after.map(p => p.pageText).join('\n') === before.map(p => p.pageText).join('\n'));
    check('vote row survived the round trip',
        await page.evaluate(() => window.SV.state.sections[1].votes.rows[0].yes) === '4');
});

await test('narrow viewports stay usable and keep A4 geometry', async () => {
    await page.setViewportSize({ width: 700, height: 900 });
    await layoutFor(doc({ sections: makeSections(8, LOREM) }));
    const info = await page.evaluate(() => {
        const mm = 96 / 25.4;
        const container = document.getElementById('pdf-preview-container');
        const first = document.querySelector('#pdf-preview-container .protocol-page');
        return {
            zoom: Number(getComputedStyle(container).zoom),
            /* offsetWidth is the unzoomed layout width */
            w: Math.round(first.offsetWidth / mm),
            h: Math.round(first.offsetHeight / mm),
            bodyScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
        };
    });
    check('preview scales down to fit', info.zoom < 1 && info.zoom > 0.2, String(info.zoom));
    check('page keeps A4 geometry', info.w === 210 && info.h === 297, JSON.stringify(info));
    check('no horizontal page scrollbar', !info.bodyScrollsSideways);
    await page.setViewportSize({ width: 1600, height: 1000 });
});

await test('no uncaught page errors during the whole run', async () => {
    check('clean console', pageErrors.length === 0, pageErrors.join('\n      '));
});

/* ── report ──────────────────────────────────────────────── */

await browser.close();

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
    console.log('\nFailures:');
    failures.forEach(f => console.log('  • ' + f));
    process.exit(1);
}
