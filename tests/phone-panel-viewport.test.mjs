import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const updateStart = indexSource.indexOf('function updatePhonePanelViewportHeight(options = {})');
const scheduleStart = indexSource.indexOf('function schedulePhonePanelViewportUpdate(options = {})', updateStart);
const updateSource = indexSource.slice(updateStart, scheduleStart);
const propertyHelperStart = indexSource.indexOf('function setPhoneViewportProperty(style, name, value)');
const propertyHelperSource = indexSource.slice(propertyHelperStart, updateStart);
const watchdogStart = indexSource.indexOf('function startPhonePanelViewportWatchdog(duration = 1800)');
const desktopStart = indexSource.indexOf('function isDesktopPhonePanelDragEnabled()', watchdogStart);
const watchdogSource = indexSource.slice(watchdogStart, desktopStart);
const guardsStart = indexSource.indexOf('function bindPhonePanelViewportGuards()');
const guardsEnd = indexSource.indexOf('async function bindTauriTavernPhoneLayout(panel)', guardsStart);
const guardsSource = indexSource.slice(guardsStart, guardsEnd);
const openStart = indexSource.indexOf('function openPhonePanelWithOutsideClose(panel, icon)');
const openEnd = indexSource.indexOf('// 🔥 处理面板点击事件', openStart);
const openSource = indexSource.slice(openStart, openEnd);

test('phone viewport variables are scoped to the phone panel', () => {
    assert.ok(updateStart >= 0);
    assert.ok(scheduleStart > updateStart);
    assert.match(updateSource, /const viewportStyle = panel\.style/);
    assert.match(updateSource, /setPhoneViewportProperty\(viewportStyle, '--phone-panel-vh'/);
    assert.match(updateSource, /setPhoneViewportProperty\(viewportStyle, '--phone-keyboard-vh'/);
    assert.doesNotMatch(updateSource, /root\.style\.setProperty\('--phone-/);
});

test('phone viewport writes skip unchanged values', () => {
    assert.ok(propertyHelperStart >= 0);
    assert.match(propertyHelperSource, /style\.getPropertyValue\(name\) === value/);
    assert.match(propertyHelperSource, /style\.setProperty\(name, value\)/);
});

test('keyboard watchdog polls while open and stops after the viewport settles', () => {
    assert.ok(watchdogStart >= 0);
    assert.ok(desktopStart > watchdogStart);
    assert.match(watchdogSource, /updatePhonePanelViewportHeight\(\{ source: 'watchdog' \}\)/);
    assert.match(watchdogSource, /panel\.classList\.contains\('phone-keyboard-open'\)/);
    assert.match(watchdogSource, /Date\.now\(\) < _phoneViewportWatchdogUntil \? 360 : 900/);
    assert.match(watchdogSource, /stopPhonePanelViewportWatchdog\(\)/);
});

test('viewport guards keep sampling across mobile IME lifecycle signals', () => {
    assert.ok(guardsStart >= 0);
    assert.ok(guardsEnd > guardsStart);
    assert.match(guardsSource, /startPhonePanelViewportWatchdog\(2200\)/);
    assert.match(guardsSource, /document\.addEventListener\('input', onInput, true\)/);
    assert.match(guardsSource, /!panel\.classList\.contains\('phone-keyboard-open'\)/);
    assert.match(guardsSource, /document\.addEventListener\('visibilitychange', onVisibilityChange\)/);
    assert.match(guardsSource, /window\.addEventListener\('pageshow', onPageShow/);
    assert.match(guardsSource, /window\.addEventListener\('orientationchange', onOrientationChange/);
});

test('panel viewport variables are restored after hidden inline styles are cleared', () => {
    const clearInlineStyleIndex = openSource.indexOf("panel.style.cssText = ''");
    const updateViewportIndex = openSource.indexOf('updatePhonePanelViewportHeight({ force: true });');

    assert.ok(openStart >= 0);
    assert.ok(openEnd > openStart);
    assert.ok(clearInlineStyleIndex >= 0);
    assert.ok(updateViewportIndex > clearInlineStyleIndex);
});
