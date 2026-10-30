import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { ImageUploadManager } from '../apps/settings/image-upload.js';

const source = fs.readFileSync(new URL('../apps/settings/settings-app.js', import.meta.url), 'utf8');
const methodStart = source.indexOf('    _getIconSets() {');
const methodEnd = source.indexOf('    // 渲染APP图标上传', methodStart);
const handlerStart = source.indexOf("        document.getElementById('app-icon-set-selector')?.addEventListener");
const handlerEnd = source.indexOf("        document.getElementById('rename-app-icon-set')?.addEventListener", handlerStart);
assert.ok(methodStart >= 0 && methodEnd > methodStart && handlerStart >= 0 && handlerEnd > handlerStart);

const original = [
    {id: 'one', name: '第一套', icons: {wechat: '/backgrounds/phone_one.png'}},
    {id: 'two', name: '第二套', icons: {wechat: '/backgrounds/phone_two.png'}}
];

function setup(sets = original, active = 'two', draft = sets.find(set => set.id === active)?.icons || {}) {
    const values = new Map([['phone-app-icon-sets', JSON.stringify(sets)], ['phone-active-icon-set', active]]);
    const elements = new Map();
    const updates = [];
    const alerts = [];
    let promptResult = '第三套';
    let renders = 0;
    let writes = 0;
    const storage = {
        get: key => values.get(key),
        async set(key, value) { writes++; values.set(key, value); }
    };
    const imageManager = {cache: {wallpaper: '/backgrounds/wall.png', appIcons: {...draft}, avatars: {}},
        async saveImages() {}};
    const sandbox = {
        storage, imageManager, alert: message => alerts.push(message), prompt: () => promptResult,
        Date: class extends Date { static now() { return 123; } },
        window: {dispatchEvent: event => updates.push(event)},
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
        document: {getElementById(id) {
            if (!elements.has(id)) elements.set(id, {listeners: new Map(),
                addEventListener(event, handler) { this.listeners.set(event, handler); }});
            return elements.get(id);
        }},
        render: () => { renders++; }
    };
    vm.runInNewContext(`
        class IconSettings { ${source.slice(methodStart, methodEnd)} }
        var app = new IconSettings();
        Object.assign(app, {storage, imageManager, render});
        (function () { ${source.slice(handlerStart, handlerEnd)} }).call(app);
    `, sandbox);
    return {
        app: sandbox.app, storage, imageManager, alerts, updates,
        sets: () => JSON.parse(values.get('phone-app-icon-sets')),
        prompt: value => { promptResult = value; },
        renders: () => renders, writes: () => writes,
        async click(id) { await elements.get(id).listeners.get('click')(); }
    };
}

test('new creates a separate scheme from the current icons and subsequent saves leave older schemes intact', async () => {
    const ui = setup(original, 'two', {wechat: '/backgrounds/just-uploaded.png'});
    await ui.click('new-app-icon-set');
    const newId = ui.storage.get('phone-active-icon-set');
    assert.notEqual(newId, 'two');
    assert.equal(ui.sets().length, 3);
    assert.deepEqual(ui.sets().slice(0, 2), original);
    assert.deepEqual(ui.sets()[2].icons, {wechat: '/backgrounds/just-uploaded.png'});
    ui.imageManager.cache.appIcons.wechat = '/backgrounds/third.png';
    assert.equal(ui.sets()[2].icons.wechat, '/backgrounds/just-uploaded.png');
    await ui.click('save-app-icon-set');
    assert.deepEqual(ui.sets().slice(0, 2), original);
    assert.equal(ui.sets()[2].icons.wechat, '/backgrounds/third.png');
    await ui.app._applyIconSet('two');
    assert.equal(ui.imageManager.cache.appIcons.wechat, original[1].icons.wechat);
    await ui.app._applyIconSet(newId);
    assert.equal(ui.imageManager.cache.appIcons.wechat, '/backgrounds/third.png');
    assert.equal(ui.imageManager.cache.wallpaper, '/backgrounds/wall.png');
    assert.ok(ui.updates.every(event => event.type === 'phone:updateAppIcon'));
});

test('cancelling new or giving an empty name leaves the selected scheme and icons unchanged', async () => {
    for (const answer of [null, '', '   ']) {
        const ui = setup();
        ui.prompt(answer);
        await ui.click('new-app-icon-set');
        assert.deepEqual(ui.sets(), original);
        assert.equal(ui.storage.get('phone-active-icon-set'), 'two');
        assert.equal(ui.writes(), 0);
        assert.equal(ui.renders(), 0);
    }
});

test('new works from default, uses unique IDs, and saving default still creates a scheme', async () => {
    const ui = setup([], 'default');
    await ui.click('new-app-icon-set');
    const firstId = ui.storage.get('phone-active-icon-set');
    ui.prompt('另一套');
    await ui.click('new-app-icon-set');
    assert.notEqual(ui.storage.get('phone-active-icon-set'), firstId);
    assert.equal(ui.sets().length, 2);
    assert.deepEqual(ui.sets()[0].icons, {});
    const legacy = setup([], 'default', {music: '/backgrounds/music.png'});
    await legacy.click('save-app-icon-set');
    assert.equal(legacy.sets().length, 1);
    assert.equal(legacy.sets()[0].icons.music, '/backgrounds/music.png');
});

function imageManager(raw = JSON.stringify(original)) {
    const manager = Object.create(ImageUploadManager.prototype);
    manager.storage = {get: key => key === 'phone-app-icon-sets' ? raw : undefined};
    manager.cache = {appIcons: {wechat: '/backgrounds/phone_two.png'}, wallpaper: null, avatars: {}};
    manager.deleted = [];
    manager._deleteBackgroundFile = async filename => { manager.deleted.push(filename); return true; };
    manager._saveCache = async () => {};
    return manager;
}

test('replacing an icon keeps the original file needed by saved schemes', async () => {
    const manager = imageManager();
    manager.processImage = async (_, callback) => callback('cropped image');
    manager._uploadToServer = async () => '/backgrounds/new.png';
    await manager.uploadAppIcon('wechat', {});
    assert.deepEqual(manager.deleted, []);
    assert.equal(manager.cache.appIcons.wechat, '/backgrounds/new.png');
    const result = await manager.deleteManagedBackgroundByPath('https://example.test/backgrounds/phone_two.png?v=2');
    assert.equal(result.skipped, 'saved-icon-set');
    assert.deepEqual(manager.deleted, []);
});

test('reset clears current icons while keeping saved scheme images available for switching back', async () => {
    const manager = imageManager(original);
    manager.cache.appIcons.music = '/backgrounds/phone_not-saved.png';
    const result = await manager.resetAppIconsAndCleanupUploads();
    assert.deepEqual(manager.cache.appIcons, {});
    assert.deepEqual(manager.deleted, ['phone_not-saved.png']);
    assert.equal(result.resetCount, 2);
    assert.equal(result.fileDeleteAttempted, 1);
    assert.equal(manager._isSavedAppIconPath('/backgrounds/phone_two.png'), true);
});

test('unreadable saved scheme data preserves images instead of deleting them', async () => {
    const manager = imageManager('{invalid');
    const result = await manager.deleteManagedBackgroundByPath('/backgrounds/phone_two.png');
    assert.equal(result.attempted, false);
    assert.deepEqual(manager.deleted, []);
});
