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
    assert.match(helperSource, /'pre code'/);
    assert.match(helperSource, /root\?\.querySelector\?\.\(PHONE_STATEFUL_MESSAGE_SELECTOR\)/);
});

test('raw protocol detection requires a real tag boundary instead of frontend identifier text', () => {
    const regexMatch = helperSource.match(/const PHONE_RAW_PROTOCOL_BOUNDARY_REGEX = (\/[^\n]+\/i);/);
    assert.ok(regexMatch);
    const protocolRegex = Function(`return ${regexMatch[1]}`)();

    assert.match('<phone>payload</phone>', protocolRegex);
    assert.match('&lt;wechat&gt;payload&lt;/wechat&gt;', protocolRegex);
    assert.match('＜线上支付＞payload＜/线上支付＞', protocolRegex);
    assert.match('[手机来电通话] 呼叫方：测试', protocolRegex);
    assert.match('PHONE_CHAT_MODE', protocolRegex);
    assert.doesNotMatch('.phone-entry { display: block; }', protocolRegex);
    assert.doesNotMatch('const phoneEntry = document.querySelector(".phone-entry");', protocolRegex);
    assert.doesNotMatch('openPhoneModal()', protocolRegex);
});

test('phone startup does not replay Tavern frontend update events', () => {
    assert.doesNotMatch(indexSource, /scheduleMissedTavernFrontendRenderRepair|repairMissedTavernFrontendRenders/);
});

test('interactive message cleanup deletes only the protocol suffix through a DOM range', () => {
    assert.match(helperSource, /document\.createTreeWalker\(root, NodeFilter\.SHOW_TEXT\)/);
    assert.match(helperSource, /parent\?\.closest\?\.\(PHONE_PROTOCOL_TEXT_SKIP_SELECTOR\)/);
    assert.match(helperSource, /range\.setStart\(textNode, match\.index\)/);
    assert.match(helperSource, /range\.setEnd\(root, root\.childNodes\.length\)/);
    assert.match(helperSource, /range\.deleteContents\(\)/);
    assert.doesNotMatch(helperSource, /root\.innerHTML\s*=/);
});

test('complete payment receipts are replaced in place without rebuilding unrelated frontend DOM', () => {
    assert.match(helperSource, /function replaceCompletePaymentReceiptsInPlace\(root, rawPayments = \[\], renderOptions = \{\}\)/);
    assert.match(helperSource, /payments\.length === 0/);
    assert.match(helperSource, /querySelectorAll\?\.\('\[data-st-phone-payment-boundary\]'\)/);
    assert.match(helperSource, /hasUnpairedMarkerBoundary/);
    assert.match(helperSource, /hasUnpairedTextBoundary/);
    assert.match(helperSource, /paymentCount !== payments\.length/);
    assert.match(helperSource, /getElementsByTagName\?\.\('线上支付'\)/);
    assert.match(helperSource, /paymentElement\.querySelector\?\.\(PHONE_PAYMENT_FOREIGN_CONTENT_SELECTOR\)/);
    assert.match(helperSource, /paymentElement\.replaceWith\(receipt\)/);
    assert.match(helperSource, /NodeFilter\.SHOW_TEXT \| NodeFilter\.SHOW_COMMENT/);
    assert.match(helperSource, /if \(!boundary\.closing\) \{[\s\S]*?opener = boundary;/);
    assert.match(helperSource, /range\.deleteContents\(\)/);
    assert.match(helperSource, /range\.insertNode\(receipt\)/);
    assert.match(helperSource, /range\.setStartBefore\(start\)/);
    assert.match(helperSource, /range\.setEndAfter\(end\)/);
    assert.doesNotMatch(helperSource, /root\.innerHTML\s*=/);
});

test('phone tag hiding preserves a frontend DOM before the legacy innerHTML fallback', () => {
    const rawPaymentIndex = hideSource.indexOf('const rawMessageText = getPhoneMessageRawText(root)');
    const rawProtocolGateIndex = hideSource.indexOf('if (!PHONE_RAW_PROTOCOL_BOUNDARY_REGEX.test(rawMessageText)) return;');
    const paymentIndex = hideSource.indexOf('replaceCompletePaymentReceiptsInPlace(root, rawPayments, receiptRenderOptions)');
    const paymentReturnIndex = hideSource.indexOf('if (rawHasPaymentBoundary || paymentRenderResult.found) return;', paymentIndex);
    const preserveIndex = hideSource.indexOf('if (preserveMessageDom)');
    const rangeCleanupIndex = hideSource.indexOf('removePhoneProtocolSuffixPreservingDom(root)', preserveIndex);
    const returnIndex = hideSource.indexOf('return;', rangeCleanupIndex);
    const legacyRewriteIndex = hideSource.indexOf('root.innerHTML = html');

    assert.ok(rawPaymentIndex >= 0);
    assert.ok(rawProtocolGateIndex > rawPaymentIndex);
    assert.ok(paymentIndex > rawProtocolGateIndex);
    assert.ok(paymentReturnIndex > paymentIndex);
    assert.ok(paymentReturnIndex < preserveIndex);
    assert.ok(preserveIndex >= 0);
    assert.ok(rangeCleanupIndex > preserveIndex);
    assert.ok(returnIndex > rangeCleanupIndex);
    assert.ok(legacyRewriteIndex > returnIndex);
});

test('phone cleanup does not inspect rendered frontend HTML for bare protocol words', () => {
    assert.match(hideSource, /const rawMessageText = getPhoneMessageRawText\(root\)/);
    assert.match(hideSource, /PHONE_RAW_PROTOCOL_BOUNDARY_REGEX\.test\(rawMessageText\)/);
    assert.doesNotMatch(hideSource, /\/phone\|wechat\|music\|weibo\|短信\|任务进度\|线上支付/);

    const rawReadIndex = hideSource.indexOf('const rawMessageText = getPhoneMessageRawText(root)');
    const htmlReadIndex = hideSource.indexOf('let html = root.innerHTML');
    assert.ok(rawReadIndex >= 0);
    assert.ok(htmlReadIndex > rawReadIndex);
});

test('payment rendering is gated by the raw Tavern message and never globally hides payment descendants', () => {
    assert.match(helperSource, /function getPhoneMessageRawText\(root\)/);
    assert.match(helperSource, /context\.chat\[messageId\]/);
    assert.match(hideSource, /parseOfflineWechatPayments\(rawMessageText\)/);
    assert.doesNotMatch(hideSource, /任务进度, 线上支付 \{ display: none/);
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
