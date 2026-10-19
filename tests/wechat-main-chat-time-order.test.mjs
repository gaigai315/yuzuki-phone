import assert from 'node:assert/strict';
import test from 'node:test';

import { WechatData } from '../apps/wechat/wechat-data.js';

function createWechatData() {
    const data = Object.create(WechatData.prototype);
    data.data = {
        chats: [{ id: 'chat_friend', name: '曜', type: 'single', unread: 0 }],
        messages: { chat_friend: [] }
    };
    data._messagesDirty = {};
    data._messagesLoaded = { chat_friend: true };
    data.getMessages = chatId => data.data.messages[chatId] || [];
    data.getChat = chatId => data.data.chats.find(chat => chat.id === chatId);
    data.getMessagePreview = message => message?.content || '';
    data._getStoryTimeFallback = () => ({
        date: '2025年09月10日',
        time: '16:53',
        weekday: '星期三',
        timestamp: new Date(2025, 8, 10, 16, 53).getTime()
    });
    data._saveMessages = () => {};
    data.saveData = () => {};
    return data;
}

function addMainChatMessage(data, {
    content,
    time,
    from,
    mainChatOrder,
    date = '2025年09月10日',
    floor = 12,
    batchId = 'batch_12'
}) {
    return data.addMessage('chat_friend', {
        from,
        content,
        time,
        date,
        type: 'text',
        fromMainChatTag: true,
        tavernMessageIndex: floor,
        batchId,
        mainChatOrder
    });
}

test('AI-authored user messages merge into the contact timeline by message time', () => {
    const data = createWechatData();
    const messages = [
        ['对方-1', '16:53', '曜', 0],
        ['对方-2', '16:53', '曜', 1],
        ['对方-3', '16:54', '曜', 2],
        ['对方-4', '16:56', '曜', 3],
        ['对方-5', '16:57', '曜', 4],
        ['对方-6', '16:59', '曜', 5],
        ['对方-7', '16:59', '曜', 6],
        ['对方-8', '16:59', '曜', 7],
        ['我-1', '16:55', 'me', 8],
        ['我-2', '16:58', 'me', 9],
        ['我-3', '16:58', 'me', 10],
        ['我-4', '17:00', 'me', 11]
    ];

    messages.forEach(([content, time, from, mainChatOrder]) => {
        assert.equal(addMainChatMessage(data, { content, time, from, mainChatOrder }), true);
    });

    assert.deepEqual(
        data.data.messages.chat_friend.map(message => message.content),
        [
            '对方-1', '对方-2', '对方-3', '我-1', '对方-4', '对方-5',
            '我-2', '我-3', '对方-6', '对方-7', '对方-8', '我-4'
        ]
    );
    assert.equal(data.data.chats[0].lastMessage, '我-4');
    assert.equal(data.data.chats[0].time, '17:00');
});

test('same-minute messages keep source order even when they arrive out of order', () => {
    const data = createWechatData();

    addMainChatMessage(data, { content: '第三条', time: '16:59', from: 'me', mainChatOrder: 3 });
    addMainChatMessage(data, { content: '第一条', time: '16:59', from: '曜', mainChatOrder: 1 });
    addMainChatMessage(data, { content: '第二条', time: '16:59', from: '曜', mainChatOrder: 2 });

    assert.deepEqual(
        data.data.messages.chat_friend.map(message => message.content),
        ['第一条', '第二条', '第三条']
    );
});

test('same-batch messages sort across midnight and before the Unix epoch', () => {
    const data = createWechatData();

    addMainChatMessage(data, {
        content: '次日凌晨',
        time: '00:01',
        from: 'me',
        mainChatOrder: 2,
        date: '1960年01月02日'
    });
    addMainChatMessage(data, {
        content: '前一晚',
        time: '23:59',
        from: '曜',
        mainChatOrder: 1,
        date: '1960年01月01日'
    });

    assert.deepEqual(
        data.data.messages.chat_friend.map(message => message.content),
        ['前一晚', '次日凌晨']
    );
    assert.ok(data.data.messages.chat_friend.every(message => message.timestamp < 0));
});

test('timeline ordering stays scoped to one floor and batch', () => {
    const data = createWechatData();

    addMainChatMessage(data, {
        content: '上一楼层的晚间消息',
        time: '23:59',
        from: '曜',
        mainChatOrder: 0,
        floor: 11,
        batchId: 'batch_11'
    });
    addMainChatMessage(data, {
        content: '下一楼层的清晨消息',
        time: '08:00',
        from: 'me',
        mainChatOrder: 0,
        date: '2025年09月11日'
    });

    assert.deepEqual(
        data.data.messages.chat_friend.map(message => message.content),
        ['上一楼层的晚间消息', '下一楼层的清晨消息']
    );
});
