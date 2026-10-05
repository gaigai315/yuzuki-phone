import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const listenerStart = indexSource.indexOf("document.body.addEventListener('click', (e) => {");
const listenerEnd = indexSource.indexOf('function releasePhoneInactiveResources', listenerStart);
const clickListenerSource = indexSource.slice(listenerStart, listenerEnd);
const desktopDragStart = indexSource.indexOf('function bindPhonePanelDesktopDockDrag(panel)');
const desktopDragEnd = indexSource.indexOf('function bindPhonePanelViewportGuards()', desktopDragStart);
const desktopDragSource = indexSource.slice(desktopDragStart, desktopDragEnd);

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

test('desktop drag release suppresses only its matching trailing click', () => {
    assert.ok(desktopDragStart >= 0);
    assert.ok(desktopDragEnd > desktopDragStart);
    assert.match(desktopDragSource, /armNextClickSuppressor = \(pointerEvent = null\)/);
    assert.match(desktopDragSource, /const releaseX = Number\(pointerEvent\?\.clientX\)/);
    assert.match(desktopDragSource, /Math\.abs\(clickX - releaseX\) <= 8/);
    assert.match(desktopDragSource, /Math\.abs\(clickY - releaseY\) <= 8/);
    assert.match(desktopDragSource, /dragDoc\.addEventListener\('pointerdown', releaseForNewPress, true\)/);
    assert.match(desktopDragSource, /dragDoc\.removeEventListener\('pointerdown', releaseForNewPress, true\)/);
    assert.match(desktopDragSource, /armNextClickSuppressor\(event\)/);
});
