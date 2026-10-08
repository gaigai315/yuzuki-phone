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
const panelOpenStart = indexSource.indexOf('function openPhonePanelWithOutsideClose(panel, icon)');
const panelOpenEnd = indexSource.indexOf('// 🔥 处理面板点击事件', panelOpenStart);
const panelOpenSource = indexSource.slice(panelOpenStart, panelOpenEnd);
const phoneCss = fs.readFileSync(new URL('../phone.css', import.meta.url), 'utf8');

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

test('desktop position is measured only after the hidden panel becomes visible', () => {
    const openClassIndex = panelOpenSource.indexOf("panel.classList.add('phone-panel-open')");
    const hiddenClassIndex = panelOpenSource.indexOf("panel.classList.remove('phone-panel-hidden')");
    const clearInlineStyleIndex = panelOpenSource.indexOf("panel.style.cssText = ''");
    const applyPositionIndex = panelOpenSource.indexOf('applyPhonePanelDesktopPosition();');

    assert.ok(panelOpenStart >= 0);
    assert.ok(panelOpenEnd > panelOpenStart);
    assert.ok(openClassIndex >= 0);
    assert.ok(hiddenClassIndex > openClassIndex);
    assert.ok(clearInlineStyleIndex > hiddenClassIndex);
    assert.ok(applyPositionIndex > clearInlineStyleIndex);
});

test('desktop phone body skips the scale-in animation that distorts position measurements', () => {
    assert.match(
        phoneCss,
        /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?#phone-panel\.drawer-content #phone-panel-content \.phone-body-panel\s*\{\s*animation: none !important;/
    );
});
