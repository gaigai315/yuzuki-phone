import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { PhoneStorage } from '../config/storage.js';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const start = source.indexOf('    function initColors() {');
const end = source.indexOf('    async function ensureGlobalPhoneCSS()', start);
assert.ok(start >= 0 && end > start);

function initializeColors(saved = {}) {
    const properties = new Map();
    const context = {
        storage: { get: key => saved[key] },
        document: { documentElement: { style: { setProperty: (key, value) => properties.set(key, value) } } },
        applyGlobalTextColor: value => properties.set('--phone-global-text', value),
        applyPhoneShellScale() {},
        applyGlobalFontScale() {},
        PHONE_FONT_SCALE_DEFAULT: 100
    };
    vm.runInNewContext(`${source.slice(start, end)}\ninitColors();`, context);
    return properties;
}

test('receipt background restores the saved color during startup independently of phone colors', () => {
    const colors = initializeColors({
        'phone-receipt-background': '#242424',
        'phone-frame-color': '#b3baaa',
        'phone-global-text': '#6c765c'
    });
    assert.equal(colors.get('--phone-receipt-background'), '#242424');
    assert.equal(colors.get('--phone-frame-color'), '#b3baaa');
    assert.equal(colors.get('--phone-global-text'), '#6c765c');
});

test('missing or invalid receipt colors keep the existing light paper default', () => {
    for (const value of [undefined, null, '', 'invalid', '#123456; color: red']) {
        assert.equal(initializeColors({ 'phone-receipt-background': value }).get('--phone-receipt-background'), '#fbfcff');
    }
});

test('receipt background is a global preference shared across chats', () => {
    const storage = new PhoneStorage();
    assert.equal(storage._isChatData('phone-receipt-background'), false);
});
