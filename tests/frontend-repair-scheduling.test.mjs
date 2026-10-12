import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('    const frontendRepairState ='), source.indexOf('    function shouldPreservePhoneMessageDom('));

function fixture() {
    let context = { chatId: 'first', chat: [{}], event_types: { MESSAGE_UPDATED: 'updated' }, eventSource: {} };
    const blocks = [];
    const events = [];
    const timers = new Map();
    let timerId = 0;
    const sandbox = {
        getContext: () => context, console,
        PHONE_TAVERN_FRONTEND_CODE_REGEX: /<html>/i,
        window: { TavernHelper: {}, innerHeight: 800 },
        document: { getElementById: () => ({}), querySelectorAll: () => blocks },
        setTimeout(callback, delay) {
            if (delay === 80) { callback(); return 0; }
            timers.set(++timerId, callback);
            return timerId;
        },
        clearTimeout: id => timers.delete(id)
    };
    context.eventSource.emit = async (_, id) => { events.push(id); };
    vm.createContext(sandbox);
    vm.runInContext(helper + '\n globalThis.repair = repairMissedTavernFrontendRenders; globalThis.schedule = scheduleMissedTavernFrontendRenderRepair;', sandbox);
    sandbox.schedule();
    return { sandbox, blocks, events, timers, context, switchChat() { context = { ...context, chatId: 'second' }; sandbox.schedule(); } };
}

function block(id, { hidden = false, offscreen = false, rendered = false } = {}) {
    return {
        isConnected: true, dataset: {},
        get textContent() {
            assert.equal(hidden || offscreen || rendered, false, 'skip inactive frontend before reading its source');
            return '<html>frontend</html>';
        },
        getBoundingClientRect: () => ({ width: hidden ? 0 : 300, height: 200, top: offscreen ? 1000 : 100, bottom: offscreen ? 1200 : 300 }),
        closest: selector => selector === '.TH-render'
            ? { querySelector: () => rendered ? {} : null }
            : { getAttribute: () => String(id) }
    };
}

test('only visible missed frontends are repaired; replacing DOM does not replay a floor', async () => {
    const f = fixture();
    f.blocks.push(block(0, { hidden: true }), block(1, { offscreen: true }), block(2, { rendered: true }), block(0));
    assert.equal(await f.sandbox.repair(), 1);
    assert.deepEqual(f.events, [0]);
    f.blocks.splice(0, f.blocks.length, block(0));
    assert.equal(await f.sandbox.repair(), 0);
    assert.deepEqual(f.events, [0]);
});

test('chat changes cancel pending scans and stop the old batch after an awaited event', async () => {
    const f = fixture();
    f.blocks.push(block(0), block(1));
    f.context.eventSource.emit = async (_, id) => { f.events.push(id); f.switchChat(); };
    await f.sandbox.repair();
    assert.deepEqual(f.events, [0]);
    assert.equal(f.timers.size, 2, 'only new chat timers survive');
});

test('overlapping repair passes do not emit duplicate events', async () => {
    const f = fixture();
    f.blocks.push(block(0));
    let release;
    f.context.eventSource.emit = async (_, id) => { f.events.push(id); await new Promise(resolve => { release = resolve; }); };
    const first = f.sandbox.repair();
    assert.equal(await f.sandbox.repair(), 0);
    release();
    await first;
    assert.deepEqual(f.events, [0]);
});

test('existing conversations neither schedule fallback timers nor scan message DOM', async () => {
    const f = fixture();
    f.context.chat.push({});
    f.sandbox.document.querySelectorAll = () => { assert.fail('history must use normal Tavern Helper rendering'); };
    f.sandbox.schedule();
    assert.equal(f.timers.size, 0);
    assert.equal(await f.sandbox.repair(), 0);
    assert.deepEqual(f.events, []);
});

test('disabled and streaming render modes do not trigger the fallback', async () => {
    for (const render of [{ enabled: false }, { enabled: true, allow_streaming: true }]) {
        const f = fixture();
        f.context.extensionSettings = { tavern_helper: { render } };
        f.sandbox.document.querySelectorAll = () => { assert.fail('respect renderer settings before scanning DOM'); };
        assert.equal(await f.sandbox.repair(), 0);
        assert.deepEqual(f.events, []);
    }
});
