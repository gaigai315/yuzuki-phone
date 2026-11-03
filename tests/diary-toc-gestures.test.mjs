import assert from 'node:assert/strict';
import test from 'node:test';
import { DiaryView } from '../apps/diary/diary-view.js';

test('diary scrolling cancels long press while stationary holding still enters management', () => {
    const original = { document: globalThis.document, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
    const timers = new Map();
    let nextTimer = 0;
    const handlers = {};
    const actions = { style: {} };
    const list = {};
    const item = {
        dataset: { id: 'entry-1' }, isConnected: true,
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
        assert.equal(renders, 1);
        item.onclick(event());
        assert.ok(view.tocSelectedIds.has('entry-1'));
    } finally {
        Object.assign(globalThis, original);
    }
});
