import assert from 'node:assert/strict';
import test from 'node:test';
import { HomeScreen } from '../phone/home-screen.js';

test('badge bounds ignore transparent upload padding and cache only small measurements', () => {
    const previous = globalThis.document;
    let reads = 0;
    globalThis.document = { createElement() {
        return { getContext() { return {
            drawImage() {},
            getImageData() {
                reads++;
                const data = new Uint8ClampedArray(200 * 200 * 4);
                for (let y = 42; y < 158; y++) for (let x = 42; x < 158; x++) {
                    data[(y * 200 + x) * 4 + 3] = 255;
                }
                data[3] = 8; // 极淡的透明边缘不应把角标推回画布外缘。
                return { data };
            }
        }; } };
    } };
    try {
        const home = Object.create(HomeScreen.prototype);
        const image = { naturalWidth: 200, naturalHeight: 200, src: '/backgrounds/shrunk.png' };
        assert.deepEqual(home._getAppIconVisibleBounds(image), {left: .21, top: .21, right: .79, bottom: .79});
        home._getAppIconVisibleBounds(image);
        assert.equal(reads, 1);
        for (let i = 0; i < 80; i++) home._getAppIconVisibleBounds({...image, src: `/backgrounds/${i}.png`});
        assert.equal(home._appIconBoundsCache.size, 64);
    } finally {
        globalThis.document = previous;
    }
});

test('unloaded and unreadable icons fall back to the full image box', () => {
    const previous = globalThis.document;
    globalThis.document = {createElement() {throw new Error('cross-origin image');}};
    try {
        const home = Object.create(HomeScreen.prototype);
        const full = {left: 0, top: 0, right: 1, bottom: 1};
        assert.deepEqual(home._getAppIconVisibleBounds({naturalWidth: 0}), full);
        assert.deepEqual(home._getAppIconVisibleBounds({naturalWidth: 200, naturalHeight: 200, src: 'remote'}), full);
    } finally {
        globalThis.document = previous;
    }
});

test('badge follows visible artwork through contain fit and phone scaling', () => {
    const previousStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({objectFit: 'contain', objectPosition: '50% 50%'});
    try {
        for (const scale of [1, .75, 1.25]) {
            const rect = (left, top, width, height) => ({left: left * scale, top: top * scale,
                right: (left + width) * scale, bottom: (top + height) * scale, width: width * scale, height: height * scale});
            const properties = new Map();
            const badge = {classList: {add() {}}, style: {setProperty: (name, value) => properties.set(name, parseFloat(value))},
                getBoundingClientRect: () => ({width: 9 * scale})};
            const image = {naturalWidth: 200, naturalHeight: 100, getBoundingClientRect: () => rect(20, 10, 60, 60)};
            const icon = {getBoundingClientRect: () => rect(20, 10, 60, 60), querySelector: () => image};
            const element = {offsetWidth: 100, offsetHeight: 100, getBoundingClientRect: () => rect(0, 0, 100, 100),
                querySelector: selector => selector.includes('app-badge') ? badge : icon};
            const home = Object.create(HomeScreen.prototype);
            home.phoneShell = {screen: {querySelector: () => ({querySelectorAll: () => [element]})}};
            home._getAppIconVisibleBounds = () => ({left: .2, top: .2, right: .8, bottom: .8});
            home._syncAppBadgeLayout();
            const size = properties.get('--yzp-home-badge-size');
            assert.equal(size, 9);
            assert.ok(Math.abs(properties.get('--yzp-home-badge-left') - (68 - size * .1)) < .01);
            assert.ok(Math.abs(properties.get('--yzp-home-badge-top') - (31 + size * .1)) < .01);
        }
    } finally {
        globalThis.getComputedStyle = previousStyle;
    }
});
