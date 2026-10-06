import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const helperStart = indexSource.indexOf('function blurExternalEditableBeforePhoneOpen(panel = null)');
const helperEnd = indexSource.indexOf('// 切换抽屉', helperStart);
const helperSource = indexSource.slice(helperStart, helperEnd);
const toggleStart = indexSource.indexOf('async function toggleDrawer(icon, panel)');
const toggleEnd = indexSource.indexOf('function openPhonePanelWithOutsideClose', toggleStart);
const toggleSource = indexSource.slice(toggleStart, toggleEnd);
const openStart = toggleEnd;
const openEnd = indexSource.indexOf('// 🔥 处理面板点击事件', openStart);
const openSource = indexSource.slice(openStart, openEnd);

test('phone opening blurs an editable element outside the phone panel', () => {
    assert.ok(helperStart >= 0);
    assert.ok(helperEnd > helperStart);
    assert.match(helperSource, /document\.activeElement/);
    assert.match(helperSource, /panel\?\.contains\?\.\(activeElement\)/);
    assert.match(helperSource, /input, textarea, select/);
    assert.match(helperSource, /activeElement\.isContentEditable/);
    assert.match(helperSource, /activeElement\.blur\?\.\(\)/);
});

test('all phone panel opening paths apply the external focus guard', () => {
    const openBranchIndex = toggleSource.indexOf('} else {');
    const blurIndex = toggleSource.indexOf('blurExternalEditableBeforePhoneOpen(panel);', openBranchIndex);
    const asyncLoadIndex = toggleSource.indexOf('await ensureGlobalPhoneCSS();', openBranchIndex);

    assert.ok(toggleStart >= 0);
    assert.ok(toggleEnd > toggleStart);
    assert.ok(openBranchIndex >= 0);
    assert.ok(blurIndex > openBranchIndex);
    assert.ok(asyncLoadIndex > blurIndex);
    assert.match(openSource, /blurExternalEditableBeforePhoneOpen\(panel\);[\s\S]*updatePhonePanelViewportHeight/);
});
