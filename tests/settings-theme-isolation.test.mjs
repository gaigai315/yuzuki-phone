import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const settingsSource = fs.readFileSync(new URL('../apps/settings/settings-app.js', import.meta.url), 'utf8');
const phoneCssSource = fs.readFileSync(new URL('../phone.css', import.meta.url), 'utf8');
const calendarCssSource = fs.readFileSync(new URL('../apps/calendar/calendar.css', import.meta.url), 'utf8');
const honeyCssSource = fs.readFileSync(new URL('../apps/honey/honey.css', import.meta.url), 'utf8');
const wangxiangCssSource = fs.readFileSync(new URL('../apps/wangxiang/wangxiang.css', import.meta.url), 'utf8');
const wechatSource = fs.readFileSync(new URL('../apps/wechat/wechat-app.js', import.meta.url), 'utf8');

test('ComfyUI storage textareas remain hidden from broad host theme rules', () => {
    assert.match(
        settingsSource,
        /id="phone-image-comfyui-workflow" class="phone-image-comfyui-hidden-storage"[^>]*hidden/
    );
    assert.match(
        settingsSource,
        /id="phone-image-comfyui-node-mapping" class="phone-image-comfyui-hidden-storage"[^>]*hidden/
    );
    assert.match(
        phoneCssSource,
        /#phone-panel-content \.phone-screen \.settings-app #phone-image-comfyui-workflow,[\s\S]*#phone-image-comfyui-node-mapping,[\s\S]*textarea\.phone-image-comfyui-hidden-storage\s*\{\s*display:\s*none\s*!important;/
    );
});

test('API model controls resist host themes that force every select to display', () => {
    assert.match(
        settingsSource,
        /id="phone-api-model-select" hidden/
    );
    assert.match(
        settingsSource,
        /#yzp-settings-app\.yzp-settings-safe-render #phone-api-model\[hidden\],[\s\S]*#phone-api-model-select\[hidden\]\s*\{\s*display:\s*none\s*!important;/
    );
    assert.match(
        settingsSource,
        /const setModelControlMode = \(showSelect\) => \{[\s\S]*modelInput\.hidden = showSelect;[\s\S]*modelSelect\.hidden = !showSelect;/
    );
});

test('phone toggle active colors inherit the SillyTavern theme accent', () => {
    assert.match(
        phoneCssSource,
        /--phone-toggle-active-color:\s*var\(--SmartThemeQuoteColor,\s*#30c46b\);/
    );
    assert.match(
        phoneCssSource,
        /\.phone-screen \.toggle-switch input:checked \+ \.toggle-slider\s*\{[\s\S]*?background:\s*var\(--phone-toggle-active-color\)\s*!important;/
    );
    assert.match(
        settingsSource,
        /\.settings-app \.toggle-switch input:checked \+ \.toggle-slider\s*\{[\s\S]*?background:\s*var\(--phone-toggle-active-color\)\s*!important;/
    );
    assert.match(
        honeyCssSource,
        /\.honey-toggle-switch input:checked \+ \.honey-toggle-slider\s*\{[\s\S]*?background:\s*var\(--phone-toggle-active-color\);/
    );
    assert.match(
        calendarCssSource,
        /\.yzp-calendar-switch input:checked \+ span\s*\{[\s\S]*?background:\s*var\(--phone-toggle-active-color\)\s*!important;/
    );
    assert.match(
        wangxiangCssSource,
        /\.wangxiang-settings-toggle input:checked \+ span\s*\{[\s\S]*?background:\s*var\(--phone-toggle-active-color\);/
    );
    assert.match(
        wechatSource,
        /\.toggle-switch input:checked \+ \.toggle-slider\s*\{[\s\S]*?background-color:\s*var\(--phone-toggle-active-color\);/
    );
});
