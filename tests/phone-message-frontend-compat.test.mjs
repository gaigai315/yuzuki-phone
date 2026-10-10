import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const helperStart = indexSource.indexOf('const PHONE_STATEFUL_MESSAGE_SELECTOR = [');
const hideStart = indexSource.indexOf('function hidePhoneTags()', helperStart);
const processReplyStart = indexSource.indexOf('function processUserReplyTags(', hideStart);
const helperSource = indexSource.slice(helperStart, hideStart);
const hideSource = indexSource.slice(hideStart, processReplyStart);

test('stateful Tavern frontends are detected before phone tags are cleaned', () => {
    assert.ok(helperStart >= 0);
    assert.ok(hideStart > helperStart);
    assert.match(helperSource, /'iframe'/);
    assert.match(helperSource, /'script'/);
    assert.match(helperSource, /'style'/);
    assert.match(helperSource, /'form'/);
    assert.match(helperSource, /'input'/);
    assert.match(helperSource, /'button'/);
    assert.match(helperSource, /root\?\.querySelector\?\.\(PHONE_STATEFUL_MESSAGE_SELECTOR\)/);
});

test('interactive message cleanup deletes only the protocol suffix through a DOM range', () => {
    assert.match(helperSource, /document\.createTreeWalker\(root, NodeFilter\.SHOW_TEXT\)/);
    assert.match(helperSource, /parent\?\.closest\?\.\(PHONE_PROTOCOL_TEXT_SKIP_SELECTOR\)/);
    assert.match(helperSource, /range\.setStart\(textNode, match\.index\)/);
    assert.match(helperSource, /range\.setEnd\(root, root\.childNodes\.length\)/);
    assert.match(helperSource, /range\.deleteContents\(\)/);
    assert.doesNotMatch(helperSource, /root\.innerHTML\s*=/);
});

test('phone tag hiding preserves a frontend DOM before the legacy innerHTML fallback', () => {
    const preserveIndex = hideSource.indexOf('if (preserveMessageDom)');
    const rangeCleanupIndex = hideSource.indexOf('removePhoneProtocolSuffixPreservingDom(root)', preserveIndex);
    const receiptRestoreIndex = hideSource.indexOf('preservedPaymentReceipts.forEach(receipt => root.appendChild(receipt))', rangeCleanupIndex);
    const returnIndex = hideSource.indexOf('return;', rangeCleanupIndex);
    const legacyRewriteIndex = hideSource.indexOf('root.innerHTML = html');

    assert.ok(preserveIndex >= 0);
    assert.ok(rangeCleanupIndex > preserveIndex);
    assert.ok(receiptRestoreIndex > rangeCleanupIndex);
    assert.ok(returnIndex > receiptRestoreIndex);
    assert.ok(legacyRewriteIndex > returnIndex);
});

test('frontend-safe cleanup recognizes current phone protocol suffixes', () => {
    const regexMatch = helperSource.match(/const PHONE_PROTOCOL_SUFFIX_TEXT_REGEX = (\/[^\n]+\/i);/);
    assert.ok(regexMatch);
    const protocolRegex = Function(`return ${regexMatch[1]}`)();

    assert.match('<wechat>payload</wechat>', protocolRegex);
    assert.match('＜任务进度＞payload', protocolRegex);
    assert.match('[手机来电通话] 呼叫方：测试', protocolRegex);
    assert.match('PHONE_CHAT_MODE', protocolRegex);
    assert.doesNotMatch('普通正文里提到 phone，但没有协议标签。', protocolRegex);
});
