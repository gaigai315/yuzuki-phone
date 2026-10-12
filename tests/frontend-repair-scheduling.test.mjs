import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('    function refreshMofoInlineMessages()'), source.indexOf('    function insertTextToSendTextarea'));

function fixture() {
    const calls = [];
    const context = {
        chat: [{ mes: 'foreign frontend' }, { mes: '<mofo>visible</mofo>' }, { mes: '<mofo>unloaded</mofo>' }],
        updateMessageBlock() { assert.fail('must not rebuild media or adjust chat scroll'); },
        messageFormatting(text, name, system, user, id) { calls.push(id); return '<div>updated mofo</div>'; }
    };
    const nodes = [];
    const sandbox = {
        getContext: () => context, console,
        window: { VirtualPhone: { cachedMofoData: { findTagBlocksFromText: text => text.includes('<mofo>') ? [{}] : [] } } },
        _mofoInlineRenderCache: new Map(), pruneDisabledMofoInlineRenders() {},
        document: { querySelectorAll: () => nodes }
    };
    vm.createContext(sandbox);
    vm.runInContext(helper + '\nglobalThis.refresh = refreshMofoInlineMessages;', sandbox);
    function add(id, foreign = false) {
        const root = { innerHTML: 'original', contains: () => false, querySelectorAll: () => foreign ? [{ closest: () => null }] : [] };
        nodes.push({ getAttribute: () => id === null ? null : String(id), querySelector: () => root });
        return root;
    }
    return { context, calls, sandbox, add };
}

test('refresh only formats loaded Mofo floors and preserves unrelated frontend DOM', () => {
    const f = fixture();
    const foreign = f.add(0);
    const mofo = f.add(1);
    f.sandbox.refresh();
    assert.deepEqual(f.calls, [1]);
    assert.equal(foreign.innerHTML, 'original');
    assert.equal(mofo.innerHTML, '<div>updated mofo</div>');
});

test('mixed Mofo and foreign frontend floors are not overwritten', () => {
    const f = fixture();
    const mixed = f.add(1, true);
    f.sandbox.refresh();
    assert.deepEqual(f.calls, []);
    assert.equal(mixed.innerHTML, 'original');
});

test('without Mofo data no floor is formatted', () => {
    const f = fixture();
    f.add(1);
    f.sandbox.window.VirtualPhone.cachedMofoData = null;
    assert.equal(f.sandbox.refresh(), false);
    assert.deepEqual(f.calls, []);
});

test('a 300-floor chat with only the last 20 mounted never reads unloaded floors', () => {
    const f = fixture();
    f.context.chat = Array.from({ length: 300 }, (_, id) => {
        if (id >= 280) return { mes: '<mofo>loaded</mofo>' };
        return { get mes() { assert.fail('unloaded history must not be formatted'); } };
    });
    for (let id = 280; id < 300; id++) f.add(id);
    f.sandbox.refresh();
    assert.deepEqual(f.calls, Array.from({ length: 20 }, (_, i) => 280 + i));
});

test('missing floor IDs and focused inline controls are left untouched', () => {
    const f = fixture();
    f.context.chat[0].mes = '<mofo>zero</mofo>';
    f.add(null);
    f.add('');
    const focused = f.add(1);
    focused.contains = () => true;
    f.sandbox.refresh();
    assert.deepEqual(f.calls, []);
    assert.equal(focused.innerHTML, 'original');
});
