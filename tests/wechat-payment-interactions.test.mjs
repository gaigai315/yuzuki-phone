import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { ChatView } from '../apps/wechat/chat-view.js';

const appSource = fs.readFileSync(new URL('../apps/wechat/wechat-app.js', import.meta.url), 'utf8');
const chatViewSource = fs.readFileSync(new URL('../apps/wechat/chat-view.js', import.meta.url), 'utf8');

function createTransferHarness(status = 'sent') {
    const message = {
        id: 'transfer_incoming_1',
        type: 'transfer',
        from: '好友甲',
        amount: '25.50',
        desc: '测试转账',
        status,
        date: '2026年11月14日',
        time: '05:23',
        fromMainChatTag: true,
        tavernMessageIndex: 18,
        batchId: 'batch_18'
    };
    const messages = [message];
    const walletUpdates = [];
    const addedMessages = [];
    const data = {
        getUserInfo: () => ({ name: '用户' }),
        getMessages: () => messages,
        updateMessageById: (_chatId, messageId, patch) => {
            const target = messages.find(item => item.id === messageId);
            if (!target) return null;
            Object.assign(target, patch);
            return target;
        },
        updateWalletBalance: (...args) => walletUpdates.push(args),
        addMessage: (_chatId, added) => {
            addedMessages.push(added);
            messages.push(added);
            return true;
        }
    };
    const notifications = [];
    const view = Object.create(ChatView.prototype);
    view.app = {
        currentChat: { id: 'chat_friend', name: '好友甲' },
        wechatData: data,
        phoneShell: {
            setContent: () => {},
            showNotification: (...args) => notifications.push(args)
        },
        render: () => {}
    };
    view._getTransferDetailPhoneTime = () => ({
        date: '2026年11月14日',
        time: '05:24',
        weekday: '星期六',
        timestamp: 1794633840000
    });
    view._escapeHtml = value => String(value ?? '');
    return { view, message, walletUpdates, addedMessages, notifications };
}

test('opening a pending incoming transfer only renders choices and does not receive it', () => {
    const originalDocument = globalThis.document;
    const root = { querySelector: () => null };
    globalThis.document = { querySelector: () => root };
    const harness = createTransferHarness();

    try {
        harness.view.openTransferDetail(harness.message.id);
        assert.equal(harness.message.status, 'sent');
        assert.equal(harness.walletUpdates.length, 0);
        assert.equal(harness.addedMessages.length, 0);
    } finally {
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
    }
});

test('accepting an incoming transfer records receipt and credits wallet exactly once', () => {
    const { view, message, walletUpdates, addedMessages } = createTransferHarness();

    const result = view._acceptIncomingTransfer('chat_friend', message);
    assert.equal(result?.amount, 25.5);
    assert.equal(message.status, 'received');
    assert.equal(walletUpdates.length, 1);
    assert.equal(walletUpdates[0][0], 25.5);
    assert.equal(walletUpdates[0][2].referenceId, 'wechat:transfer:receive:transfer_incoming_1');
    assert.equal(addedMessages.length, 1);
    assert.equal(addedMessages[0].content, '你已收款');
    assert.equal(addedMessages[0].paymentTargetId, message.id);
    assert.equal(addedMessages[0].paymentAction, 'accept');

    assert.equal(view._acceptIncomingTransfer('chat_friend', message), null);
    assert.equal(walletUpdates.length, 1);
});

test('refunding an incoming transfer records refund for AI without crediting wallet', () => {
    const { view, message, walletUpdates, addedMessages } = createTransferHarness();

    const result = view._refundIncomingTransfer('chat_friend', message);
    assert.ok(result);
    assert.equal(message.status, 'refunded');
    assert.equal(walletUpdates.length, 0);
    assert.equal(addedMessages.length, 1);
    assert.equal(addedMessages[0].content, '你已退回该笔转账');
    assert.equal(addedMessages[0].paymentTargetId, message.id);
    assert.equal(addedMessages[0].paymentAction, 'refund');

    assert.equal(view._refundIncomingTransfer('chat_friend', message), null);
    assert.equal(addedMessages.length, 1);
});

test('pending red packet opens the interaction layer before any wallet mutation', () => {
    const message = {
        id: 'redpacket_incoming_1',
        type: 'redpacket',
        from: '好友甲',
        amount: '8.88',
        status: 'sent'
    };
    let prompted = null;
    let walletUpdateCount = 0;
    const view = Object.create(ChatView.prototype);
    view.app = {
        currentChat: { id: 'chat_friend', name: '好友甲' },
        wechatData: {
            getMessages: () => [message],
            getUserInfo: () => ({ name: '用户' }),
            updateWalletBalance: () => { walletUpdateCount += 1; }
        }
    };
    view._showIncomingRedPacketOpenPrompt = (chatId, target) => {
        prompted = { chatId, target };
    };

    view.openRedPacket(message.id);
    assert.equal(prompted?.chatId, 'chat_friend');
    assert.equal(prompted?.target, message);
    assert.equal(message.status, 'sent');
    assert.equal(walletUpdateCount, 0);
});

test('red packet credits wallet only after opening and repeat click only shows details', () => {
    const originalDocument = globalThis.document;
    globalThis.document = { getElementById: () => null };
    const message = {
        id: 'redpacket_incoming_2',
        type: 'redpacket',
        from: '好友甲',
        amount: '8.88',
        wish: '恭喜发财',
        status: 'sent'
    };
    const walletUpdates = [];
    const view = Object.create(ChatView.prototype);
    view.app = {
        currentChat: { id: 'chat_friend', name: '好友甲' },
        wechatData: {
            getMessages: () => [message],
            getUserInfo: () => ({ name: '用户', avatar: '' }),
            getContactByName: () => ({ avatar: '' }),
            updateMessageById: (_chatId, _messageId, patch) => Object.assign(message, patch),
            updateWalletBalance: (...args) => walletUpdates.push(args)
        },
        phoneShell: {
            setContent: () => {},
            showNotification: () => {}
        },
        renderAvatar: () => '<span>甲</span>',
        render: () => {}
    };
    view._escapeHtml = value => String(value ?? '');

    try {
        view.openRedPacket(message.id, { autoOpen: true });
        assert.equal(message.status, 'opened');
        assert.equal(walletUpdates.length, 1);
        assert.equal(walletUpdates[0][0], 8.88);
        assert.equal(walletUpdates[0][2].referenceId, 'wechat:redpacket:receive:redpacket_incoming_2');

        view.openRedPacket(message.id);
        assert.equal(walletUpdates.length, 1);
    } finally {
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
    }
});

test('red packet and transfer surfaces ignore the global WeChat text color', () => {
    assert.match(chatViewSource, /wechat-payment-fixed-page wechat-redpacket-detail-page/);
    assert.match(chatViewSource, /wechat-payment-fixed-page wechat-transfer-detail-page/);
    assert.match(chatViewSource, /wechat-payment-compose-page wechat-redpacket-compose-page/);
    assert.match(chatViewSource, /wechat-payment-compose-page wechat-transfer-compose-page/);
    assert.match(appSource, /:not\(\.wechat-payment-fixed-page\):not\(\.wechat-payment-compose-page\)/);
    assert.match(appSource, /\.message-redpacket,[\s\S]*?\.message-transfer,[\s\S]*?\.wechat-redpacket-open-overlay/);
    assert.match(appSource, /\.wechat-app\.wechat-payment-fixed-page \*:not\(i\):not\(svg\):not\(path\) \{[\s\S]*?color: #000000 !important;/);
    assert.match(appSource, /\.wechat-transfer-receive-button \{[\s\S]*?color: #ffffff !important;/);
});

test('processed payment status is retained for repeat-click detail display', () => {
    const source = ChatView.prototype.openRedPacket.toString();
    assert.match(source, /initialStatus !== 'refunded'/);
    assert.match(source, /initialStatus !== 'opened'/);
    assert.match(source, /if \(canOpenIncomingPacket && !autoOpen\)/);

    const transferSource = ChatView.prototype.openTransferDetail.toString();
    assert.match(transferSource, /isPendingIncomingTransfer/);
    assert.match(transferSource, /isTransferReceived \? '你已收款，资金已存入零钱' : '待你收款'/);
    assert.match(transferSource, /isTransferRefunded[\s\S]*'你已退回该笔转账'/);
});
