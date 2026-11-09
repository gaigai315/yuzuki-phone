import assert from 'node:assert/strict';
import test from 'node:test';
import { WechatApp } from '../apps/wechat/wechat-app.js';
import { getWechatReadablePalette } from '../apps/wechat/readable-colors.js';
import fs from 'node:fs';

const wechatSource = fs.readFileSync(new URL('../apps/wechat/wechat-app.js', import.meta.url), 'utf8');
const chatSource = fs.readFileSync(new URL('../apps/wechat/chat-view.js', import.meta.url), 'utf8');
const contactsSource = fs.readFileSync(new URL('../apps/wechat/contacts-view.js', import.meta.url), 'utf8');
const momentsSource = fs.readFileSync(new URL('../apps/wechat/moments-view.js', import.meta.url), 'utf8');

// Independently measure the resulting text/background pair in linear sRGB.
function luminance(hex) {
    return [0.2126, 0.7152, 0.0722].reduce((total, weight, index) => {
        const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
        return total + weight * (value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
    }, 0);
}

function compositeSurface(palette) {
    const worstBackdrop = palette.surfaceBase === '#000000' ? '#FFFFFF' : '#000000';
    const baseChannels = [1, 3, 5].map(index => parseInt(palette.surfaceBase.slice(index, index + 2), 16));
    const backdropChannels = [1, 3, 5].map(index => parseInt(worstBackdrop.slice(index, index + 2), 16));
    return '#' + baseChannels.map((channel, index) => {
        const value = Math.round(channel * palette.surfaceAlpha + backdropChannels[index] * (1 - palette.surfaceAlpha));
        return value.toString(16).padStart(2, '0');
    }).join('');
}
function assertReadable(color) {
    const palette = getWechatReadablePalette(color);
    const composite = compositeSurface(palette);
    const values = [luminance(palette.text), luminance(composite)].sort((a, b) => a - b);
    assert.ok((values[1] + 0.05) / (values[0] + 0.05) >= 4.5, `${color} on ${palette.surface} over worst-case ${composite}`);
    return palette;
}

test('white and black text get translucent opposite glass; invalid colors use default black', () => {
    const whitePalette = assertReadable('#FFFFFF');
    const blackPalette = assertReadable('#000000');
    assert.equal(whitePalette.surfaceBase, '#000000');
    assert.equal(blackPalette.surfaceBase, '#FFFFFF');
    assert.match(whitePalette.surface, /^rgba\(10, 12, 16, 0\./);
    assert.match(blackPalette.surface, /^rgba\(255, 255, 255, 0\./);
    assert.ok(whitePalette.surfaceAlpha < 0.8);
    assert.ok(blackPalette.surfaceAlpha < 0.8);
    assert.equal(getWechatReadablePalette('invalid').text, '#000000');
    assert.equal(getWechatReadablePalette('#abc').text, '#AABBCC');
});

test('all gray levels and a full RGB grid retain at least 4.5:1 contrast without changing chosen text', () => {
    for (let value = 0; value < 256; value++) {
        assertReadable('#' + value.toString(16).padStart(2, '0').repeat(3));
    }
    for (let r = 0; r < 256; r += 17) {
        for (let g = 0; g < 256; g += 17) {
            for (let b = 0; b < 256; b += 17) {
                const color = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
                assert.equal(assertReadable(color).text, color);
            }
        }
    }
});

test('preview and cancel update surface variables without replacing the page or changing saved color', () => {
    const previousDocument = globalThis.document;
    const properties = new Map();
    const styles = new Map();
    let inserted = 0;
    globalThis.document = {
        documentElement: { style: { setProperty: (key, value) => properties.set(key, value) } },
        getElementById: id => styles.get(id),
        createElement: () => ({ setAttribute() {} }),
        head: { appendChild: style => { inserted++; styles.set(style.id, style); } }
    };
    try {
        const app = Object.create(WechatApp.prototype);
        app.storage = { get: () => '#FFFFFF' };
        app._applyWechatTextColor();
        assert.match(properties.get('--wechat-readable-surface'), /^rgba\(10, 12, 16, 0\./);
        app._applyWechatTextColor('#000000');
        assert.match(properties.get('--wechat-readable-surface'), /^rgba\(255, 255, 255, 0\./);
        app._applyWechatTextColor();
        assert.equal(properties.get('--wechat-text-color'), '#FFFFFF');
        assert.match(properties.get('--wechat-readable-surface'), /^rgba\(10, 12, 16, 0\./);
        assert.equal(inserted, 1);
    } finally {
        globalThis.document = previousDocument;
    }
});

test('wechat setup and editor pages share one readable theme marker', () => {
    assert.match(wechatSource, /_getReadableWechatShellClass\(baseClass = 'wechat-app'\)/);
    const promptEditor = wechatSource.slice(wechatSource.indexOf('showPromptEditor('), wechatSource.indexOf('// 🔥 新增：批量添加联系人'));
    const chatSettings = chatSource.slice(chatSource.indexOf('showChatMenu()'), chatSource.indexOf('showBackgroundPicker()'));
    const backgroundPicker = chatSource.slice(chatSource.indexOf('showBackgroundPicker()'), chatSource.indexOf('// 🔥 预设背景点击'));
    assert.match(promptEditor, /_getReadableWechatShellClass\(shellBg\.appClass\)/);
    assert.match(chatSettings, /_getReadableWechatShellClass\(shellBg\.appClass\)/);
    assert.match(backgroundPicker, /_getReadableWechatShellClass\(shellBg\.appClass\)/);
    assert.ok((contactsSource.match(/wechat-app wechat-readable-settings/g) || []).length >= 4);
    assert.match(momentsSource, /wechat-app wechat-readable-settings/);
});

test('readable glass leaves the wechat back button transparent', () => {
    assert.match(wechatSource, /button:not\(\.yzp-frame-color-control\):not\(\.wechat-back-btn\)/);
    assert.match(
        wechatSource,
        /button\.wechat-back-btn\s*\{[\s\S]*?background:\s*transparent\s*!important;[\s\S]*?box-shadow:\s*none\s*!important;/
    );
});

test('voice transcript uses the same readable glass palette as wechat text', () => {
    assert.match(chatSource, /\['wechat-voice-transcript',[\s\S]*?voiceDisplay\.hasTranslation/);
    assert.match(
        wechatSource,
        /\.wechat-voice-transcript\s*\{[\s\S]*?background:\s*var\(--wechat-readable-surface\)\s*!important;[\s\S]*?color:\s*var\(--wechat-text-color,[^)]+\)\s*!important;/
    );
});
