import assert from 'node:assert/strict';
import test from 'node:test';

import { ChatView } from '../apps/wechat/chat-view.js';
import { WechatData } from '../apps/wechat/wechat-data.js';

function createWechatData(messages, walletTransactions = []) {
    const data = Object.create(WechatData.prototype);
    data.walletDefaultKey = '__default__';
    data.data = {
        chats: [{ id: 'chat_friend', unread: 2, lastMessage: '你已收款' }],
        messages: { chat_friend: messages },
        moments: [],
        walletByChat: { __default__: 125 },
        walletTransactions
    };
    data._messagesDirty = {};
    data._messagesLoaded = {};
    data.getMessages = chatId => data.data.messages[chatId] || [];
    data.getChat = chatId => data.data.chats.find(chat => chat.id === chatId);
    data.getMessagePreview = message => message?.content || '';
    data._cleanupManagedImagesForDeletedMessages = () => {};
    data._saveMessages = () => {};
    data.saveData = () => {};
    data._notifyUnreadChanged = () => {};
    return data;
}

function createWalletTransaction(messageId, tavernMessageIndex) {
    return {
        id: `wallet_${messageId}`,
        delta: 25,
        amount: 25,
        type: 'transfer',
        messageId,
        walletKey: '__default__',
        affectsBalance: true,
        fromMainChatTag: true,
        tavernMessageIndex
    };
}

test('payment status messages inherit their source floor and target ID', () => {
    const view = Object.create(ChatView.prototype);
    const status = view._buildPaymentStatusMessage({
        id: 'transfer_floor_8',
        type: 'transfer',
        fromMainChatTag: true,
        tavernMessageIndex: 8,
        batchId: 'batch_8'
    }, '你已收款');

    assert.deepEqual(status, {
        from: 'system',
        type: 'system',
        content: '你已收款',
        paymentTargetId: 'transfer_floor_8',
        paymentTargetType: 'transfer',
        paymentAction: 'accept',
        fromMainChatTag: true,
        tavernMessageIndex: 8,
        batchId: 'batch_8'
    });
});

test('same-floor receipt statuses for different transfers are not deduplicated', () => {
    const data = createWechatData([]);
    data._getStoryTimeFallback = () => ({
        date: '2026年10月9日',
        time: '12:00',
        weekday: '星期五',
        timestamp: 1
    });
    const baseStatus = {
        from: 'system',
        type: 'system',
        content: '你已收款',
        paymentTargetType: 'transfer',
        paymentAction: 'accept',
        fromMainChatTag: true,
        tavernMessageIndex: 8,
        batchId: 'batch_8'
    };

    assert.equal(data.addMessage('chat_friend', { ...baseStatus, paymentTargetId: 'transfer_a' }), true);
    assert.equal(data.addMessage('chat_friend', { ...baseStatus, paymentTargetId: 'transfer_b' }), true);
    assert.deepEqual(
        data.data.messages.chat_friend.map(message => message.paymentTargetId),
        ['transfer_a', 'transfer_b']
    );
});

test('exact floor removal deletes a linked receipt status and reverses its wallet transaction', () => {
    const originalWindow = globalThis.window;
    globalThis.window = { VirtualPhone: {} };
    const data = createWechatData([
        {
            id: 'transfer_floor_8',
            type: 'transfer',
            content: '[转账] ¥25.00',
            fromMainChatTag: true,
            tavernMessageIndex: 8
        },
        {
            id: 'receipt_status',
            type: 'system',
            content: '你已收款',
            paymentTargetId: 'transfer_floor_8'
        },
        { id: 'local_message', type: 'text', content: '保留的手机消息' }
    ], [createWalletTransaction('transfer_floor_8', 8)]);

    try {
        assert.equal(data.removeMainChatTagMessagesAtFloor(8), true);
        assert.deepEqual(data.data.messages.chat_friend.map(message => message.id), ['local_message']);
        assert.equal(data.data.walletByChat.__default__, 100);
        assert.equal(data.data.walletTransactions.length, 0);
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    }
});

test('range rollback removes linked payment statuses but preserves unrelated local system messages', () => {
    const originalWindow = globalThis.window;
    globalThis.window = { VirtualPhone: {} };
    const data = createWechatData([
        {
            id: 'older_floor_message',
            type: 'text',
            content: '旧楼层',
            fromMainChatTag: true,
            tavernMessageIndex: 7
        },
        {
            id: 'transfer_floor_9',
            type: 'transfer',
            content: '[转账] ¥25.00',
            fromMainChatTag: true,
            tavernMessageIndex: 9
        },
        {
            id: 'receipt_status',
            type: 'system',
            content: '你已收款',
            paymentTargetId: 'transfer_floor_9'
        },
        { id: 'local_system', type: 'system', content: '独立手机状态' }
    ], [createWalletTransaction('transfer_floor_9', 9)]);

    try {
        assert.equal(data.rollbackToFloor(9), true);
        assert.deepEqual(
            data.data.messages.chat_friend.map(message => message.id),
            ['older_floor_message', 'local_system']
        );
        assert.equal(data.data.walletByChat.__default__, 100);
        assert.equal(data.data.walletTransactions.length, 0);
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    }
});
