import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DiaryView } from '../apps/diary/diary-view.js';

test('diary selection boxes stay hidden until management mode overrides host input styles', () => {
    const css = fs.readFileSync(new URL('../apps/diary/diary.css', import.meta.url), 'utf8');
    assert.match(css, /\.diary-toc \.diary-toc-select\s*\{[^}]*display:\s*none\s*!important/s);
    assert.match(css, /\.diary-toc\.diary-toc-managing \.diary-toc-select\s*\{[^}]*display:\s*block\s*!important/s);
});

test('diary table-of-contents uses the heading for settings and a bottom quill for writing', () => {
    const source = fs.readFileSync(new URL('../apps/diary/diary-view.js', import.meta.url), 'utf8');
    assert.match(source, /class="diary-toc-quill diary-toc-entry-control" id="diary-add-entry"/);
    assert.match(source, /class="diary-toc-compose-dock">\$\{entryTools\}/);
    assert.match(source, /<button[^>]*class="diary-toc-heading" id="diary-manual-write"/);
    assert.doesNotMatch(source, /id="diary-import-entry"/);
});

test('diary batch import entry lives below the prompt editor in settings', () => {
    const source = fs.readFileSync(new URL('../apps/diary/diary-view.js', import.meta.url), 'utf8');
    const promptIndex = source.indexOf('id="diary-s-prompt"');
    const importIndex = source.indexOf('id="diary-open-import"');
    assert.ok(promptIndex >= 0 && importIndex > promptIndex);
    assert.match(source, /id="diary-open-import"[\s\S]*?fa-solid fa-file-import[\s\S]*?批量导入日记/);
    assert.match(source, /openImportBtn\.onclick = \(\) => \{[\s\S]*?currentView = 'import'/);
});

test('diary heading opens settings and quill opens a new entry', () => {
    const originalDocument = globalThis.document;
    const heading = {};
    const quill = {};
    globalThis.document = {
        getElementById: id => ({ 'diary-manual-write': heading, 'diary-add-entry': quill })[id] || null,
        querySelector: () => null,
        querySelectorAll: () => []
    };
    try {
        const view = new DiaryView({});
        view.currentView = 'toc';
        let renders = 0;
        view.render = () => { renders++; };
        view._bindTOCEvents();
        heading.onclick();
        assert.equal(view.currentView, 'settings');
        assert.equal(view._previousView, 'toc');
        view.currentView = 'toc';
        quill.onclick();
        assert.equal(view.currentView, 'new');
        assert.equal(view._previousView, 'toc');
        assert.equal(renders, 2);
    } finally {
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
    }
});

test('diary table-of-contents uses the themed chapter and lunar-orbit layout', () => {
    const source = fs.readFileSync(new URL('../apps/diary/diary-view.js', import.meta.url), 'utf8');
    const css = fs.readFileSync(new URL('../apps/diary/diary.css', import.meta.url), 'utf8');
    assert.match(source, /diary-toc-heading-cn">目录<\/span>/);
    assert.match(source, /diary-toc-heading-en">Whispers of Time<\/span>/);
    assert.match(css, /diary-toc-heading-en[\s\S]*Snell Roundhand[\s\S]*Segoe Script/);
    assert.match(source, /class="diary-toc-orbit"/);
    assert.match(source, /diary-toc-orbit-ticks-minor/);
    assert.match(source, /diary-toc-orbit-ticks-major/);
    assert.match(source, /diary-toc-item-chevron/);
    assert.match(source, /class="diary-toc-item-preview"/);
    assert.match(css, /--diary-toc-line:\s*color-mix\(in srgb, var\(--diary-text-primary\)/);
    assert.match(css, /--diary-toc-card:\s*color-mix\(in srgb, var\(--diary-paper-color\)/);
    assert.match(css, /\.diary-toc-moon\s*\{[\s\S]*?var\(--diary-text-primary\)[\s\S]*?var\(--diary-paper-color\)/);
    assert.match(css, /\.diary-toc-moon\s*\{[\s\S]*?overflow:\s*hidden/);
    assert.match(css, /\.diary-toc-moon::after\s*\{[\s\S]*?translateX\(var\(--diary-moon-shadow-x\)\)/);
    assert.match(css, /repeating-conic-gradient\([\s\S]*?var\(--diary-toc-line\)/);
    assert.match(css, /min-height:\s*calc\(64px \* var\(--diary-toc-card-scale\)\)/);
    assert.match(css, /\.diary-toc-item-date\s*\{[\s\S]*?flex:\s*0 0 calc\(54px \* var\(--diary-toc-card-scale\)\)/);
    assert.match(source, /class="diary-toc-scroll-space"/);
    assert.match(css, /\.diary-toc-heading-rule\s*\{[^}]*width:\s*110px/s);
});

test('diary orbit scrolling keeps five slots visible and hides entries beyond the window', () => {
    const makeStyle = () => ({ setProperty(name, value) { this[name] = value; } });
    const items = Array.from({ length: 8 }, () => ({ style: makeStyle() }));
    const spacer = { style: {} };
    const list = {
        clientHeight: 420,
        scrollTop: 0,
        querySelectorAll: () => items,
        querySelector: selector => selector === '.diary-toc-scroll-space' ? spacer : null
    };
    const view = new DiaryView({});

    view._layoutTOCOrbitItems(list);
    assert.equal(spacer.style.height, '660px');
    assert.equal(items[0].style.visibility, 'visible');
    assert.equal(items[4].style.visibility, 'visible');
    assert.equal(items[5].style.visibility, 'hidden');

    list.scrollTop = 240;
    view._layoutTOCOrbitItems(list);
    assert.equal(items[0].style.visibility, 'hidden');
    assert.equal(items[3].style.visibility, 'visible');
    assert.equal(items[7].style.visibility, 'visible');
});

test('diary orbit adapts to the list width and height with matching card spacing', () => {
    const orbit = { style: {} };
    const items = Array.from({ length: 8 }, () => ({
        style: { setProperty(name, value) { this[name] = value; } }
    }));
    const spacer = { style: {} };
    const list = {
        clientWidth: 270, clientHeight: 364, offsetTop: 164, scrollTop: 0,
        parentElement: { querySelector: () => orbit },
        querySelectorAll: () => items,
        querySelector: () => spacer
    };
    const view = new DiaryView({});
    view._layoutTOCOrbitItems(list);
    assert.equal(orbit.style.transform, 'scale(0.75)');
    assert.equal(items[0].style['--diary-toc-card-scale'], '0.75');
    assert.equal(orbit.style.left, '-245.25px');
    assert.equal(orbit.style.top, '184.75px');
    assert.equal(items[4].style.top, '278px');
    assert.equal(items[0].style['--diary-toc-connector'], '33px');
    assert.equal(spacer.style.height, '544px');
    list.scrollTop = 180;
    view._layoutTOCOrbitItems(list);
    assert.equal(items[2].style.visibility, 'hidden');
    assert.equal(items[7].style.visibility, 'visible');
    list.clientWidth = 360;
    list.clientHeight = 600;
    view._layoutTOCOrbitItems(list);
    assert.equal(orbit.style.transform, 'scale(1)');
    assert.equal(items[0].style['--diary-toc-card-scale'], '1');
    assert.equal(items[4].style.top, '428px');
});

test('diary connectors meet the orbit throughout scrolling and responsive resizing', () => {
    const view = new DiaryView({});
    for (const [width, height] of [[270, 364], [360, 600], [320, 280]]) {
        const scale = Math.min(1, width / 360, height / 420);
        const offsetY = (height - 420 * scale) / 2;
        for (const scroll of [0, 0.5, 2, 3]) {
            const items = Array.from({ length: 8 }, () => ({
                style: { setProperty(name, value) { this[name] = value; } }
            }));
            const list = {
                clientWidth: width, clientHeight: height, scrollTop: scroll * 80 * scale,
                querySelectorAll: () => items, querySelector: () => null
            };
            view._layoutTOCOrbitItems(list);
            if (scroll === 0) {
                const topGap = parseFloat(items[0].style.top);
                const bottomGap = height - parseFloat(items[4].style.top) - 64 * scale;
                assert.ok(Math.abs(topGap - bottomGap) < 1e-7);
            }
            items.forEach(item => {
                const y = (parseFloat(item.style.top) - list.scrollTop - offsetY) / scale + 32;
                if (y < 50 || y > 370) return;
                const left = parseFloat(item.style.left);
                const nodeX = (left - parseFloat(item.style['--diary-toc-connector'])) / scale;
                assert.ok(Math.abs(Math.hypot(nodeX + 112, y - 210) - 215) < 1e-7);
                assert.ok(left + parseFloat(item.style.width) <= width);
                assert.ok(offsetY + (y + 32) * scale <= height);
                assert.equal(item.style.width, `${188 * scale}px`);
            });
        }
    }
});

test('diary scrolling cancels long press while stationary holding still enters management', () => {
    const original = { document: globalThis.document, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
    const timers = new Map();
    let nextTimer = 0;
    const handlers = {};
    const actions = { style: {} };
    const list = {
        classList: { toggle() {} },
        querySelector: () => null,
        querySelectorAll: () => [],
        clientHeight: 400,
        scrollTop: 0
    };
    const item = {
        dataset: { id: 'entry-1' }, isConnected: true,
        classList: { toggle() {} },
        querySelector: selector => selector === '.diary-toc-item-actions' ? actions : null,
        addEventListener: (name, fn) => { handlers[name] = fn; }
    };
    globalThis.document = {
        getElementById: () => null,
        querySelector: () => list,
        querySelectorAll: () => [item]
    };
    globalThis.setTimeout = fn => { timers.set(++nextTimer, fn); return nextTimer; };
    globalThis.clearTimeout = id => timers.delete(id);
    const view = new DiaryView({});
    let renders = 0;
    view.render = () => { renders++; };
    const event = extra => ({
        isPrimary: true, button: 0, pointerId: 1, pointerType: 'touch',
        clientX: 20, clientY: 20, target: { closest: () => null },
        preventDefault() {}, ...extra
    });
    const flush = () => { for (const fn of [...timers.values()]) fn(); };
    try {
        view._bindTOCEvents();
        handlers.pointerdown(event());
        handlers.pointermove(event({ clientY: 35 }));
        flush();
        handlers.contextmenu(event());
        item.onclick(event());
        assert.equal(view.tocManageMode, false);
        assert.equal(renders, 0);

        handlers.pointerdown(event());
        list.onscroll();
        flush();
        assert.equal(view.tocManageMode, false);

        handlers.pointerdown(event());
        handlers.pointercancel(event());
        flush();
        assert.equal(view.tocManageMode, false);

        handlers.pointerdown(event());
        handlers.pointerup(event());
        flush();
        assert.equal(view.tocManageMode, false);

        handlers.pointerdown(event());
        handlers.pointermove(event({ clientY: 22 }));
        flush();
        assert.equal(view.tocManageMode, true);
        assert.ok(view.tocSelectedIds.has('entry-1'));
        assert.equal(renders, 0);
        item.onclick(event());
        assert.ok(view.tocSelectedIds.has('entry-1'));

        list.onclick(event());
        assert.equal(view.tocManageMode, false);
        assert.equal(view.tocSelectedIds.size, 0);

        view.tocManageMode = true;
        view.tocSelectedIds.add('entry-1');
        view.currentView = 'settings';
        view.loadCSS = () => {};
        view.renderSettings = () => {};
        view.app.diaryData = { _entries: null };
        view.render = DiaryView.prototype.render.bind(view);
        view.render();
        assert.equal(view.tocManageMode, false);
        assert.equal(view.tocSelectedIds.size, 0);
    } finally {
        Object.assign(globalThis, original);
    }
});
