import assert from 'node:assert/strict';
import test from 'node:test';
import { DiaryView } from '../apps/diary/diary-view.js';
import { DiaryData } from '../apps/diary/diary-data.js';

function setup(t) {
    const original = { document: globalThis.document, confirm: globalThis.confirm };
    t.after(() => {
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    });
    const button = () => {
        const handlers = [];
        return {
            addEventListener: (type, handler) => { if (type === 'click') handlers.push(handler); },
            click() { this.onclick?.(); for (const handler of handlers) handler(); }
        };
    };
    const controls = Object.fromEntries([
        'diary-toc-select-all', 'diary-delete-selected', 'diary-toc-hide-selected',
        'diary-toc-show-selected', 'diary-toc-manage-done'
    ].map(id => [id, button()]));
    const count = { remove() { this.textContent = ''; } };
    controls['diary-delete-selected'].querySelector = () => count;
    const entries = Array.from({ length: 8 }, (_, i) => ({ id: `diary-${i}` }));
    const items = entries.map((entry, i) => {
        const input = { dataset: { id: entry.id }, checked: false };
        return {
            dataset: { id: entry.id }, input,
            // More entries than the five visible orbit slots.
            style: { visibility: i < 5 ? 'visible' : 'hidden' },
            classList: { toggle() {} }, addEventListener() {},
            querySelector: selector => selector === '.diary-toc-select' ? input : null
        };
    });
    globalThis.document = {
        getElementById: id => controls[id] || null,
        querySelector: () => null,
        querySelectorAll: () => items
    };
    const deleted = [];
    const hidden = [];
    const confirmations = [];
    globalThis.confirm = text => { confirmations.push(text); return true; };
    const view = new DiaryView({ diaryData: {
        getEntries: () => entries,
        getEntrySortTimestamp: () => 0,
        clearAllEntries: () => deleted.push('all'),
        deleteEntries: ids => deleted.push(ids),
        setEntriesOfflineHidden: (ids, value) => hidden.push({ ids, value })
    } });
    view.tocManageMode = true;
    view.render = () => {};
    return { view, controls, items, entries, count, deleted, hidden, confirmations };
}

test('select all still selects every diary after events are rebound on a reused directory', t => {
    const { view, controls, items, count, deleted, confirmations } = setup(t);
    view._bindTOCEvents();
    view._bindTOCEvents();
    controls['diary-toc-select-all'].click();
    assert.equal(view.tocSelectedIds.size, 8);
    assert.ok(items.every(item => item.input.checked));
    assert.equal(count.textContent, '8');
    controls['diary-delete-selected'].click();
    assert.deepEqual(deleted, ['all']);
    assert.match(confirmations[0], /全部 8 篇/);
});

test('select all toggles off and respects a manually deselected diary when deleting', t => {
    const { view, controls, items, entries, deleted } = setup(t);
    view._bindTOCEvents();
    view._bindTOCEvents();
    controls['diary-toc-select-all'].click();
    controls['diary-toc-select-all'].click();
    assert.equal(view.tocSelectedIds.size, 0);
    assert.ok(items.every(item => !item.input.checked));
    controls['diary-toc-select-all'].click();
    items[0].input.checked = false;
    items[0].input.onchange({ stopPropagation() {} });
    controls['diary-delete-selected'].click();
    assert.equal(deleted.length, 1);
    assert.deepEqual(new Set(deleted[0]), new Set(entries.slice(1).map(entry => entry.id)));
});

test('bulk hide is invoked once after repeated binding', t => {
    const { view, controls, hidden } = setup(t);
    view._bindTOCEvents();
    controls['diary-toc-select-all'].click();
    view._bindTOCEvents();
    controls['diary-toc-hide-selected'].click();
    assert.equal(hidden.length, 1);
    assert.equal(hidden[0].ids.length, 8);
    assert.equal(hidden[0].value, true);
});

test('hide and show buttons persist diary injection exclusion across reloads', t => {
    const { view, controls } = setup(t);
    const saved = new Map();
    const storage = { get: key => saved.get(key), set: (key, value) => saved.set(key, value) };
    const data = new DiaryData(storage);
    data._entries = [
        { id: 'diary-0', content: '隐藏验证专属正文', title: '隐藏验证标题', date: '2026-11-14' },
        { id: 'diary-1', content: '正常注入专属正文', title: '正常标题', date: '2026-11-13' }
    ];
    data.saveEntries();
    view.app.diaryData = data;
    view._bindTOCEvents();
    assert.match(data.buildOfflineInjectionContent(), /隐藏验证专属正文/);

    view.tocSelectedIds.add('diary-0');
    controls['diary-toc-hide-selected'].click();
    assert.equal(data.getEntry('diary-0').offlineHidden, true);
    for (const source of [data, new DiaryData(storage)]) {
        const prompt = source.buildOfflineInjectionContent();
        assert.doesNotMatch(prompt, /隐藏验证专属正文|隐藏验证标题/);
        assert.match(prompt, /正常注入专属正文/);
    }

    view.app.diaryData = new DiaryData(storage);
    view.tocSelectedIds.add('diary-0');
    controls['diary-toc-show-selected'].click();
    assert.equal(view.app.diaryData.getEntry('diary-0').offlineHidden, false);
    assert.match(new DiaryData(storage).buildOfflineInjectionContent(), /隐藏验证专属正文/);

    controls['diary-toc-select-all'].click();
    controls['diary-toc-hide-selected'].click();
    assert.equal(new DiaryData(storage).buildOfflineInjectionContent(), '');
});

test('hidden diary stays dim through orbit layout and scrolling, and show restores opacity', () => {
    let hidden = true;
    const item = {
        style: { setProperty() {} },
        classList: { contains: name => name === 'diary-offline-hidden' && hidden }
    };
    const list = {
        clientWidth: 360, clientHeight: 420, scrollTop: 0,
        querySelectorAll: () => [item], querySelector: () => null
    };
    const view = new DiaryView({});
    view._layoutTOCOrbitItems(list);
    assert.equal(Number(item.style.opacity), 0.58);
    list.scrollTop = 32;
    view._layoutTOCOrbitItems(list);
    assert.ok(Math.abs(Number(item.style.opacity) - 0.29) < 1e-10);
    list.scrollTop = 0;
    view._layoutTOCOrbitItems(list);
    assert.equal(Number(item.style.opacity), 0.58);
    hidden = false;
    view._layoutTOCOrbitItems(list);
    assert.equal(Number(item.style.opacity), 1);
});
