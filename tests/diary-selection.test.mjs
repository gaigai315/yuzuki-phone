import assert from 'node:assert/strict';
import test from 'node:test';
import { DiaryView } from '../apps/diary/diary-view.js';

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
