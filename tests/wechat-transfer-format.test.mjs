import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { ChatView } from '../apps/wechat/chat-view.js';

const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const view = Object.create(ChatView.prototype);

test('transfer history summary format renders as a transfer card', () => {
    assert.deepEqual(view.parseSpecialMessage('[转账 ¥100000.00]（状态：未收款）'), {
        type: 'transfer',
        amount: '100000.00',
        desc: '转账给你',
        status: 'sent',
        content: '[转账] ¥100000.00'
    });
    assert.equal(view.parseSpecialMessage('[转账 ￥1,234.50](状态: 已收款)')?.status, 'received');
    assert.equal(view.parseSpecialMessage('[转账 ¥88]（状态：已退回）')?.status, 'refunded');
});

test('transfer history summary is split out of surrounding text', () => {
    const messages = view.splitMixedSpecialMessage({
        sender: '角色A',
        content: '先拿去用。[转账 ¥100000.00]（状态：未收款）记得收款。'
    });

    assert.equal(messages.length, 3);
    assert.equal(messages[0].content, '先拿去用。');
    assert.equal(messages[1].specialMessage?.type, 'transfer');
    assert.equal(messages[1].specialMessage?.amount, '100000.00');
    assert.equal(messages[2].content, '记得收款。');
});

test('offline wechat tag parser recognizes transfer history summaries', () => {
    assert.match(indexSource, /transferSummaryMatch/);
    assert.match(indexSource, /msgObj\.status = statusText === '已收款'/);
    assert.match(indexSource, /msgObj\.content = `\[转账\] ¥\$\{amount\.toFixed\(2\)\}`/);
});
