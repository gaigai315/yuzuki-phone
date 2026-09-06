import assert from 'node:assert/strict';
import test from 'node:test';

import { WechatData } from '../apps/wechat/wechat-data.js';

class MemoryStorage {
    constructor(seed = {}) {
        this.values = new Map(Object.entries(seed));
    }

    get(key, fallback = null) {
        return this.values.has(key) ? this.values.get(key) : fallback;
    }

    set(key, value) {
        if (value === null || value === undefined) {
            this.values.delete(key);
        } else {
            this.values.set(key, value);
        }
    }
}

const createStorage = () => new MemoryStorage({
    wechat_data: JSON.stringify({
        userInfo: {
            name: '测试用户',
            globalChatBackground: null,
            chatListBackground: null
        },
        chats: [
            { id: 'chat-a', name: '会话 A', background: '/backgrounds/a.png' },
            { id: 'chat-b', name: '会话 B', background: '/backgrounds/b.png' }
        ],
        contacts: [],
        moments: []
    })
});

test('syncing all chat backgrounds replaces existing overrides', () => {
    const data = new WechatData(createStorage());
    const result = data.setAllChatBackgrounds('/backgrounds/shared.png');

    assert.deepEqual(result, {
        background: '/backgrounds/shared.png',
        chatCount: 2
    });
    assert.equal(data.getChat('chat-a').background, null);
    assert.equal(data.getChat('chat-b').background, null);
    assert.equal(data.getChatBackground('chat-a', '/backgrounds/default.png'), '/backgrounds/shared.png');
    assert.equal(data.getChatBackground('chat-b', '/backgrounds/default.png'), '/backgrounds/shared.png');
});

test('a chat created after syncing inherits the saved all-chat background', () => {
    const storage = createStorage();
    const data = new WechatData(storage);
    data.setAllChatBackgrounds('/backgrounds/shared.png');

    const reloadedData = new WechatData(storage);
    const newChat = reloadedData.createChat({ id: 'chat-new', name: '新会话' });

    assert.equal(reloadedData.getChatBackground(newChat.id, '/backgrounds/default.png'), '/backgrounds/shared.png');
});

test('clearing all chat backgrounds restores the supplied system fallback', () => {
    const data = new WechatData(createStorage());
    data.setAllChatBackgrounds('/backgrounds/shared.png');
    data.setAllChatBackgrounds(null);

    assert.equal(data.getChatBackground('chat-a', '/backgrounds/default.png'), '/backgrounds/default.png');
    assert.equal(data.getChatBackground('chat-b', '/backgrounds/default.png'), '/backgrounds/default.png');
    assert.equal(data.data.userInfo.globalChatBackground, null);
});
