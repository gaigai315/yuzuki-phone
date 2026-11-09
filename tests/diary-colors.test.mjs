import assert from 'node:assert/strict';
import test from 'node:test';
import { DiaryData } from '../apps/diary/diary-data.js';
import { PhoneStorage } from '../config/storage.js';
import { DIARY_TEXT_COLOR_KEY, DIARY_PAPER_COLOR_KEY } from '../apps/diary/diary-theme.js';
import { parsePhoneHexColor, phoneHexToRgb, phoneRgbToHsv, phoneHsvToRgb, phoneRgbToHex } from '../config/phone-colors.js';
import fs from 'node:fs';

test('diary colors ignore phone text and old background images, and restore saved appearance', () => {
    const saved = new Map([
        ['phone-global-text', '#866e88'],
        ['global_diary_bg_global', '/backgrounds/old.png']
    ]);
    const storage = { get: key => saved.get(key) };
    const data = new DiaryData(storage);
    assert.deepEqual(data.getAppearance(), { textColor: '#000000', paperColor: '#FDF9F0' });
    saved.set(DIARY_TEXT_COLOR_KEY, '#fed');
    saved.set(DIARY_PAPER_COLOR_KEY, '#123456');
    assert.deepEqual(new DiaryData(storage).getAppearance(), { textColor: '#FFEEDD', paperColor: '#123456' });
    saved.set(DIARY_TEXT_COLOR_KEY, 'red; background: url(evil)');
    assert.equal(data.getAppearance().textColor, '#000000');
});

test('diary appearance is shared across chats without changing the phone text preference', () => {
    const storage = new PhoneStorage();
    assert.equal(storage._isChatData(DIARY_TEXT_COLOR_KEY), false);
    assert.equal(storage._isChatData(DIARY_PAPER_COLOR_KEY), false);
});

test('shared picker color conversions preserve black, white, gray and hue boundaries', () => {
    for (const color of ['#000000', '#FFFFFF', '#888888', '#FF0000', '#00FF00', '#0000FF', '#866E88', '#FDF9F0']) {
        assert.equal(phoneRgbToHex(phoneHsvToRgb(phoneRgbToHsv(phoneHexToRgb(color)))) , color);
    }
    assert.equal(parsePhoneHexColor('abc'), '#AABBCC');
    assert.equal(parsePhoneHexColor('invalid'), null);
});

test('diary prompt folds and photo backs use the selected paper and ink variables', () => {
    const css = fs.readFileSync(new URL('../apps/diary/diary.css', import.meta.url), 'utf8');
    const view = fs.readFileSync(new URL('../apps/diary/diary-view.js', import.meta.url), 'utf8');
    assert.match(css, /\.diary-photo-back\s*\{[\s\S]*?background:\s*var\(--diary-paper-color\)/);
    assert.match(css, /\.diary-app \.phone-prompt-fold,[\s\S]*?background:\s*var\(--diary-paper-color\) !important/);
    assert.match(css, /\.phone-worldbook-search,[\s\S]*?\.phone-prompt-preset-select[\s\S]*?background:\s*var\(--diary-paper-color\) !important/);
    assert.match(css, /\.phone-prompt-preset-new, \.phone-prompt-preset-delete[\s\S]*?background:\s*color-mix\(in srgb, var\(--diary-paper-color\) 88%, #000000\) !important/);
    assert.match(css, /\.phone-prompt-preset-new, \.phone-prompt-preset-delete[\s\S]*?color:\s*var\(--diary-text-primary\) !important/);
    assert.match(view, /phone-prompt-fold-title">📔 日记提示词<\/div>/);
    assert.doesNotMatch(view, /日记生成提示词/);
});

test('diary import and compose views follow the selected paper and ink colors', () => {
    const css = fs.readFileSync(new URL('../apps/diary/diary.css', import.meta.url), 'utf8');
    assert.match(css, /\.diary-app \.diary-edit-view\s*\{[\s\S]*?background:\s*var\(--diary-paper-color\) !important/);
    assert.match(css, /\.diary-app \.diary-edit-save-btn\s*\{[\s\S]*?var\(--diary-paper-color\)[\s\S]*?var\(--diary-text-primary\)/);
    assert.match(css, /\.diary-app \.diary-edit-textarea::placeholder\s*\{[\s\S]*?var\(--diary-text-secondary\)/);
});

test('diary keeps cover and table-of-contents uploads while omitting page background uploads', async () => {
    const saved = new Map();
    const storage = {
        get: key => saved.get(key),
        set: async (key, value) => saved.set(key, value),
        remove: async key => saved.delete(key)
    };
    const previousWindow = globalThis.window;
    const previousLocalStorage = globalThis.localStorage;
    globalThis.window = {};
    globalThis.localStorage = { getItem: () => null, removeItem() {} };
    try {
        const data = new DiaryData(storage);
        await data.setCoverBg('/backgrounds/phone_diary_cover_test.png');
        await data.setTocBg('/backgrounds/phone_diary_toc_test.png');
        assert.equal(data.getCoverBg(), '/backgrounds/phone_diary_cover_test.png');
        assert.equal(data.getTocBg(), '/backgrounds/phone_diary_toc_test.png');
        await data.resetDefaultBackgrounds();
        assert.equal(data.getCoverBg(), null);
        assert.equal(data.getTocBg(), null);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
        if (previousLocalStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = previousLocalStorage;
    }

    const view = fs.readFileSync(new URL('../apps/diary/diary-view.js', import.meta.url), 'utf8');
    assert.match(view, /id="diary-bg-cover"/);
    assert.match(view, /id="diary-bg-toc"/);
    assert.doesNotMatch(view, /id="diary-bg-global"/);
    assert.match(view, /(?:const|let) coverBg = data\.getCoverBg\(\)/);
    assert.match(view, /const tocBg = data\.getTocBg\(\)/);
});

test('diary developing photos use themed placeholders and status colors', () => {
    const css = fs.readFileSync(new URL('../apps/diary/diary.css', import.meta.url), 'utf8');
    const view = fs.readFileSync(new URL('../apps/diary/diary-view.js', import.meta.url), 'utf8');
    assert.match(view, /status === 'loading' \|\| status === 'failed'[\s\S]*?diary-photo-placeholder diary-photo-developing/);
    assert.match(css, /\.diary-photo-placeholder\s*\{[\s\S]*?background:\s*var\(--diary-paper-color\)/);
    assert.match(css, /\.diary-photo-status\s*\{[\s\S]*?background:\s*color-mix\(in srgb, var\(--diary-paper-color\) 88%, var\(--diary-text-primary\)\)/);
    assert.doesNotMatch(css, /\.diary-photo-status\s*\{[\s\S]*?background:\s*rgba\(255, 253, 248/);
});
