import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareWechatBackground } from '../phone/background-ready.js';
import { PhoneShell } from '../phone/phone-shell.js';

function mockImages(t) {
    const images = [];
    const original = globalThis.Image;
    globalThis.Image = class {
        constructor() { images.push(this); }
        decode() { return Promise.resolve(); }
    };
    t.after(() => { globalThis.Image = original; });
    return images;
}

function view(id, image = '') {
    const attributes = { 'data-view-id': id, 'data-raw-html': 'page' };
    return {
        id, className: '', style: {}, removed: false,
        getAttribute(key) { return attributes[key]; },
        setAttribute(key, value) { attributes[key] = value; if (key === 'data-view-id') this.id = value; },
        querySelector(selector) {
            return selector === '.wechat-app' && image ? { style: { backgroundImage: `url("${image}")` } } : null;
        },
        remove() { this.removed = true; }
    };
}

function shellFixture(t, src) {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    globalThis.window = {};
    globalThis.document = { createElement: () => view('') };
    t.after(() => { globalThis.window = previousWindow; globalThis.document = previousDocument; });
    const home = view('home');
    home.className = 'phone-view-layer phone-view-current';
    const wechat = view('wechat-main', src);
    const settings = view('settings');
    const views = [home, wechat, settings];
    const stack = {
        appendChild: node => views.push(node),
        querySelector: selector => views.find(v => !v.removed && selector === `[data-view-id="${v.id}"]`),
        querySelectorAll: () => views.filter(v => !v.removed)
    };
    const shell = Object.create(PhoneShell.prototype);
    Object.assign(shell, {
        viewHistory: [{ id: 'home' }],
        syncHomeLayoutChromeClass() {}, _syncChromeThemeForView() {}, _scopePhoneFormControls() {},
        screen: { querySelector: selector => selector === '.view-stack-container'
            ? stack : views.find(v => !v.removed && v.className.includes('phone-view-current')) }
    });
    return { shell, home, wechat, settings };
}

test('background preparation waits for decoding and reuses the decoded image', async t => {
    const images = mockImages(t);
    const page = view('wechat', '/backgrounds/ready-test.png');
    const ready = prepareWechatBackground(page);
    assert.equal(prepareWechatBackground(page), ready);
    let finishDecode;
    images[0].decode = () => new Promise(resolve => { finishDecode = resolve; });
    const loading = images[0].onload();
    assert.equal(prepareWechatBackground(page), ready);
    finishDecode();
    await loading;
    await ready;
    assert.equal(prepareWechatBackground(page), null);
    assert.equal(images.length, 1);
});

test('failed backgrounds release the page and can be retried; solid colors need no loading', async t => {
    const images = mockImages(t);
    const page = view('wechat', '/backgrounds/failure-test.png');
    const ready = prepareWechatBackground(page);
    images[0].onerror();
    await ready;
    const retry = prepareWechatBackground(page);
    assert.equal(images.length, 2);
    images[1].onerror();
    await retry;
    assert.equal(prepareWechatBackground(view('plain')), null);
});

test('opening wechat keeps the old page painted, including while the pending page refreshes', async t => {
    const images = mockImages(t);
    const { shell, home, wechat } = shellFixture(t, '/backgrounds/open-test.png');
    shell.setContent('page', 'wechat-main');
    assert.equal(wechat.style.opacity, '0');
    assert.equal(home.style.opacity, '1');
    assert.equal(home.style.display, 'block');
    shell.setContent('page', 'wechat-main');
    assert.equal(wechat.style.opacity, '0');
    assert.equal(images.length, 1);
    await images[0].onload();
    await Promise.resolve();
    assert.equal(wechat.style.opacity, '1');
    assert.equal(wechat.style.pointerEvents, '');
});

test('late background completion cannot replace another page', async t => {
    const images = mockImages(t);
    const { shell, wechat } = shellFixture(t, '/backgrounds/navigation-test.png');
    shell.setContent('page', 'wechat-main');
    shell.setContent('page', 'settings');
    const settings = shell.screen.querySelector('.phone-view-current');
    await images[0].onload();
    await Promise.resolve();
    assert.equal(settings.style.opacity, '1');
    assert.ok(settings.className.includes('phone-view-current'));
    assert.equal(wechat.style.opacity, '1'); // Now only the previous layer.
    assert.equal(shell.restoreView('home'), true);
    assert.equal(shell._backgroundPendingTarget, null);
});

test('going home during loading cancels the reveal and discards the pending page', async t => {
    const images = mockImages(t);
    const { shell, home, wechat } = shellFixture(t, '/backgrounds/home-cancel-test.png');
    shell.setContent('page', 'wechat-main');
    assert.equal(shell.restoreView('home'), true);
    assert.equal(wechat.removed, true);
    await images[0].onload();
    await Promise.resolve();
    assert.equal(home.style.opacity, '1');
    assert.equal(home.style.pointerEvents, '');
    assert.ok(home.className.includes('phone-view-current'));
    assert.equal(wechat.style.opacity, '0');
});
