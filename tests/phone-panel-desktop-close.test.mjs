import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const listenerStart = indexSource.indexOf("document.body.addEventListener('click', (e) => {");
const listenerEnd = indexSource.indexOf('function releasePhoneInactiveResources', listenerStart);
const clickListenerSource = indexSource.slice(listenerStart, listenerEnd);

test('desktop phone panel closes on the first outside click before triple-tap handling', () => {
    const desktopCloseIndex = clickListenerSource.indexOf("drawerPanel?.classList.contains('phone-panel-open')");
    const tripleTapSettingIndex = clickListenerSource.indexOf('if (!isPhoneTripleTapEnabled())');
    const tripleTapOpenIndex = clickListenerSource.indexOf('if (phoneTapCount === 3)');

    assert.ok(listenerStart >= 0);
    assert.ok(listenerEnd > listenerStart);
    assert.ok(desktopCloseIndex >= 0);
    assert.ok(clickListenerSource.includes('&& isDesktopPhonePanelDragEnabled()'));
    assert.ok(clickListenerSource.includes('&& !isInsidePhone'));
    assert.ok(clickListenerSource.includes('isSwipeTrailingClick'));
    assert.ok(clickListenerSource.includes('phoneShell?._swipeClickGuardUntil'));
    assert.ok(clickListenerSource.includes('toggleDrawer(drawerIcon, drawerPanel);'));
    assert.ok(tripleTapSettingIndex > desktopCloseIndex);
    assert.ok(tripleTapOpenIndex > tripleTapSettingIndex);
});

test('desktop outside-click close excludes the phone body and phone entry controls', () => {
    assert.match(clickListenerSource, /phoneDrawerIcon/);
    assert.match(clickListenerSource, /phoneDrawerToolEntry/);
    assert.match(clickListenerSource, /phoneDrawerToolRow/);
    assert.match(clickListenerSource, /phone-in-panel/);
});
