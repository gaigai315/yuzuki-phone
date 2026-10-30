import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../apps/settings/settings-app.js', import.meta.url), 'utf8');
const start = source.indexOf("        const homeCssPresetSelect = document.getElementById('phone-home-css-preset-select');");
const end = source.indexOf('        const phoneShellScaleSlider =', start);
assert.ok(start >= 0 && end > start);
const handlers = source.slice(start, end);
const PRESETS = 'phone-home-css-presets';
const ACTIVE = 'phone-home-css-active';

function setup(presets = []) {
    const values = new Map([[PRESETS, JSON.stringify(presets)], [ACTIVE, presets[0]?.id || '']]);
    const elements = new Map();
    const notifications = [];
    const updates = [];
    const storage = {
        get: key => values.get(key),
        async set(key, value) { values.set(key, value); },
        async remove(key) { values.delete(key); }
    };
    function element(id) {
        if (!elements.has(id)) elements.set(id, {
            value: '', listeners: new Map(),
            addEventListener(type, listener) { this.listeners.set(type, listener); }
        });
        return elements.get(id);
    }
    const app = {
        storage,
        _getHomeCssPresets: () => JSON.parse(storage.get(PRESETS)),
        phoneShell: { showNotification: (...args) => notifications.push(args) },
        render() {
            const current = app._getHomeCssPresets().find(item => item.id === storage.get(ACTIVE));
            element('phone-home-css-preset-select').value = current?.id || '';
            element('phone-home-custom-css').value = current?.css || '';
        }
    };
    class FrozenDate extends Date { static now() { return 123; } }
    vm.runInNewContext(`(function () { ${handlers} }).call(app)`, {
        app, document: {getElementById: element},
        window: {dispatchEvent: event => updates.push(event.type)},
        CustomEvent: class { constructor(type) { this.type = type; } },
        HOME_CSS_PRESETS_KEY: PRESETS, HOME_CSS_ACTIVE_KEY: ACTIVE, Date: FrozenDate
    });
    app.render();
    return {
        app, storage, element, notifications, updates,
        presets: app._getHomeCssPresets,
        async importText(text) {
            const input = element('import-home-css-presets-file');
            input.value = 'selected.json';
            input.files = [{text: async () => text}];
            await input.listeners.get('change')({target: input});
            assert.equal(input.value, '');
        },
        async import(payload) { await this.importText(JSON.stringify(payload)); },
        async select(id) {
            const select = element('phone-home-css-preset-select');
            select.value = id;
            await select.listeners.get('change')({target: select});
        }
    };
}

const original = [
    {id: 'old-a', name: '海岸', css: '.home-screen { color: blue; }'},
    {id: 'old-b', name: '星光', css: '.home-screen { color: white; }'}
];

test('import appends a scheme, preserves old schemes, and allows switching and saving independently', async () => {
    const ui = setup(original);
    await ui.import({type: 'yuzuki-phone-home-css-preset', version: 1, activeId: 'old-a',
        preset: {name: '花园', css: '.home-screen { color: pink; }'}});
    const all = ui.presets();
    assert.equal(all.length, 3);
    assert.deepEqual(all.slice(0, 2), original);
    assert.equal(ui.storage.get(ACTIVE), all[2].id);
    assert.equal(ui.element('phone-home-custom-css').value, all[2].css);
    await ui.select('old-a');
    assert.equal(ui.element('phone-home-custom-css').value, original[0].css);
    ui.element('phone-home-custom-css').value = 'updated old scheme';
    await ui.element('save-home-css').listeners.get('click')();
    assert.equal(ui.presets()[0].css, 'updated old scheme');
    assert.deepEqual(ui.presets()[2], all[2]);
    await ui.select(all[2].id);
    assert.equal(ui.element('phone-home-custom-css').value, all[2].css);
    assert.ok(ui.updates.includes('phone:updateHomeCss'));
});

test('imports support single schemes, old bundles and arrays without replacing existing schemes', async () => {
    const incoming = [{name: '一', css: 'a {}'}, {name: '二', css: 'b {}'}];
    for (const payload of [incoming[0], incoming, {presets: incoming}, {preset: incoming[0]}]) {
        const ui = setup(original);
        await ui.import(payload);
        const expected = Array.isArray(payload) || payload.presets ? incoming : [incoming[0]];
        assert.deepEqual(ui.presets().slice(0, 2), original);
        assert.deepEqual(ui.presets().slice(2).map(({name, css}) => ({name, css})), expected);
    }
});

test('duplicate names and IDs remain distinct even for repeated imports in the same millisecond', async () => {
    const before = [{id: 'home_css_123_0', name: '海岸', css: 'original'},
        {id: 'second', name: '海岸 (2)', css: 'second'}];
    const ui = setup(before);
    await ui.import({name: '海岸', css: 'new-a'});
    await ui.import({name: '海岸', css: 'new-b'});
    assert.deepEqual(ui.presets().slice(0, 2), before);
    assert.deepEqual(ui.presets().map(item => item.name), ['海岸', '海岸 (2)', '海岸 (3)', '海岸 (4)']);
    assert.equal(new Set(ui.presets().map(item => item.id)).size, 4);
    for (const preset of ui.presets()) {
        await ui.select(preset.id);
        assert.equal(ui.element('phone-home-custom-css').value, preset.css);
    }
});

test('empty and invalid imports leave all existing schemes and their selection intact', async () => {
    for (const text of ['{invalid', 'null', '{}', '[]', '{"presets":[]}']) {
        const ui = setup(original);
        await ui.importText(text);
        assert.deepEqual(ui.presets(), original);
        assert.equal(ui.storage.get(ACTIVE), 'old-a');
        assert.equal(ui.notifications.at(-1)[0], '导入失败');
        assert.deepEqual(ui.updates, []);
    }
});

test('the first import into an empty collection creates an active scheme', async () => {
    const ui = setup();
    await ui.import({preset: {name: '首个方案', css: ''}});
    assert.equal(ui.presets().length, 1);
    assert.equal(ui.storage.get(ACTIVE), ui.presets()[0].id);
    assert.equal(ui.notifications.at(-1)[0], '导入成功');
});
