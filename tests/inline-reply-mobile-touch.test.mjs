import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const inlineReplyStart = indexSource.indexOf('function createInlineReplyButton()');
const inlineReplyEnd = indexSource.indexOf('// 创建顶部面板按钮', inlineReplyStart);
const inlineReplySource = indexSource.slice(inlineReplyStart, inlineReplyEnd);

test('inline reply button activates before focused-input QR collapse can swallow the first tap', () => {
    assert.ok(inlineReplyStart >= 0);
    assert.ok(inlineReplyEnd > inlineReplyStart);
    assert.match(inlineReplySource, /btn\.addEventListener\('touchstart',[\s\S]*?e\.preventDefault\(\);[\s\S]*?e\.stopPropagation\(\);[\s\S]*?\}, \{ passive: false \}\);/);
    assert.match(inlineReplySource, /btn\.addEventListener\('touchend',[\s\S]*?handleAction\(e\);[\s\S]*?\}, \{ passive: false \}\);/);
    assert.match(inlineReplySource, /btn\.addEventListener\('touchcancel',[\s\S]*?inlineReplyTouchStarted = false;/);
    assert.match(inlineReplySource, /btn\.addEventListener\('click', handleAction\);/);
    assert.match(inlineReplySource, /existingBtn\.dataset\.stPhoneMobileTouchBound !== 'true'[\s\S]*?existingBtn\.remove\(\);/);
    assert.match(inlineReplySource, /btn\.dataset\.stPhoneMobileTouchBound = 'true';/);
});
