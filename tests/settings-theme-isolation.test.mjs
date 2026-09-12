import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const settingsSource = fs.readFileSync(new URL('../apps/settings/settings-app.js', import.meta.url), 'utf8');
const phoneCssSource = fs.readFileSync(new URL('../phone.css', import.meta.url), 'utf8');
const calendarCssSource = fs.readFileSync(new URL('../apps/calendar/calendar.css', import.meta.url), 'utf8');
const honeyCssSource = fs.readFileSync(new URL('../apps/honey/honey.css', import.meta.url), 'utf8');
const wangxiangCssSource = fs.readFileSync(new URL('../apps/wangxiang/wangxiang.css', import.meta.url), 'utf8');
const wechatSource = fs.readFileSync(new URL('../apps/wechat/wechat-app.js', import.meta.url), 'utf8');
const phoneShellSource = fs.readFileSync(new URL('../phone/phone-shell.js', import.meta.url), 'utf8');

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

test('settings info buttons render as transparent icon-only controls', () => {
    assert.match(
        settingsSource,
        /#phone-panel-content \.phone-screen #yzp-settings-app\.settings-app button\.phone-version-info-btn\s*\{[\s\S]*?background:\s*transparent\s*!important;[\s\S]*?box-shadow:\s*none\s*!important;/
    );
    assert.match(settingsSource, /button\.phone-version-info-btn > i::before\s*\{[\s\S]*?background:\s*transparent\s*!important;/);
    assert.match(settingsSource, /id="phone-version-info-btn"/);
    assert.match(settingsSource, /id="phone-time-format-info-btn"/);
    assert.match(settingsSource, /button:not\(\.settings-tab-btn\):not\(\.phone-version-info-btn\)/);
    assert.match(settingsSource, /\.settings-has-wallpaper \.phone-version-info-btn\s*\{\s*background-color:\s*transparent\s*!important;/);
});

test('time format help lists every official format and supports mobile scrolling', () => {
    const formats = [
        'YYYY年MM月DD日HH:MM星期*',
        'YYYY年 MM月 DD日 HH:MM 星期*',
        'YYYY年|MM月|DD日|HH:MM|星期*',
        'YYYY年-MM月-DD日-HH:MM-星期*',
        'YYYY年/MM月/DD日/HH:MM/星期*',
        'YYYY-MM-DD HH:MM 星期*',
        'YYYY/MM/DD/HH:MM/星期*',
        '2021年01月01日·🌸·星期二·14:30·晴天·8°C·{元旦}',
        '2021年01月02日·🌸·星期二·14:30·小雨·2°C',
        '大明永乐十二年九月初八日·🍂·辰时(07:30)·晴天·22°C'
    ];

    for (const format of formats) {
        assert.equal(settingsSource.includes(format), true, `missing time format help entry: ${format}`);
    }
    assert.match(settingsSource, /_showTimeFormatInfo\(/);
    assert.match(settingsSource, /&lt;horae&gt;时间内容&lt;\/horae&gt;/);
    assert.match(settingsSource, /730 \/ 0730 \/ 2128/);
    assert.match(
        settingsSource,
        /\.phone-time-format-info-body\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?touch-action:\s*pan-y;[\s\S]*?overscroll-behavior:\s*contain;/
    );
    assert.match(phoneShellSource, /'\.phone-time-format-info-body'/);
});
