import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { WechatData } from '../apps/wechat/wechat-data.js';

class TestCustomEvent {
    constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
    }
}

test('wechat rollback publishes the recalculated unread total', () => {
    const originalWindow = globalThis.window;
    const events = [];
    globalThis.window = {
        CustomEvent: TestCustomEvent,
        VirtualPhone: {},
        dispatchEvent(event) {
            events.push(event);
        }
    };

    try {
        const data = Object.create(WechatData.prototype);
        data.data = {
            chats: [{ id: 'chat_friend', unread: 3, lastMessage: '旧消息' }],
            messages: {
                chat_friend: [{
                    id: 'old_floor_message',
                    content: '旧分支消息',
                    fromMainChatTag: true,
                    tavernMessageIndex: 5
                }]
            },
            moments: [],
            walletTransactions: []
        };
        data._messagesDirty = {};
        data.getMessages = chatId => data.data.messages[chatId] || [];
        data.getChat = chatId => data.data.chats.find(chat => chat.id === chatId);
        data.getMessagePreview = message => message?.content || '';
        data._rollbackWalletTransactions = () => false;
        data._cleanupManagedImagesForDeletedMessages = () => {};
        data._saveMessages = () => {};
        data.saveData = () => {};

        assert.equal(data.removeMainChatTagMessagesAtFloor(5), true);
        assert.equal(data.data.chats[0].unread, 0);
        assert.equal(events.at(-1)?.type, 'phone:wechatUnreadChanged');
        assert.equal(events.at(-1)?.detail?.count, 0);
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    }
});

test('offline wechat import derives badges from chat unread state instead of incrementing stale badges', () => {
    const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const blockStart = source.indexOf('// 🔥🔥🔥 关键修复：只有真正添加了新消息时');
    const blockEnd = source.indexOf('// 2️⃣ 如果微信APP正好打开', blockStart);
    const unreadBlock = source.slice(blockStart, blockEnd);

    assert.ok(blockStart >= 0);
    assert.ok(blockEnd > blockStart);
    assert.match(unreadBlock, /chat\.unread = \(chat\.unread \|\| 0\) \+ newMessagesAdded/);
    assert.match(unreadBlock, /syncWechatHomeBadge\(\)/);
    assert.doesNotMatch(unreadBlock, /updateAppBadge\('wechat', newMessagesAdded\)/);
    assert.doesNotMatch(unreadBlock, /totalNotifications += newMessagesAdded/);
});
