import assert from 'node:assert/strict';
import test from 'node:test';

import { WechatData } from '../apps/wechat/wechat-data.js';

class MemoryStorage {
    constructor(seed = {}, globalValues = new Map()) {
        this.values = new Map(Object.entries(seed));
        this.globalValues = globalValues;
    }

    _getStore(key) {
        return String(key || '').startsWith('global_') ? this.globalValues : this.values;
    }

    get(key, fallback = null) {
        const store = this._getStore(key);
        return store.has(key) ? store.get(key) : fallback;
    }

    set(key, value) {
        const store = this._getStore(key);
        if (value === null || value === undefined) {
            store.delete(key);
        } else {
            store.set(key, value);
        }
    }
}

const createStorage = (globalValues = new Map()) => new MemoryStorage({
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
}, globalValues);

test('syncing all chat backgrounds replaces existing overrides', () => {
    const data = new WechatData(createStorage());
    const result = data.setAllChatBackgrounds('/backgrounds/shared.png');

    assert.deepEqual(result, {
        background: '/backgrounds/shared.png',
        chatCount: 2
    });
    assert.equal(data.getChat('chat-a').background, '/backgrounds/shared.png');
    assert.equal(data.getChat('chat-b').background, '/backgrounds/shared.png');
    assert.equal(data.getChatBackground('chat-a', '/backgrounds/default.png'), '/backgrounds/shared.png');
    assert.equal(data.getChatBackground('chat-b', '/backgrounds/default.png'), '/backgrounds/shared.png');
});

test('a chat created after syncing inherits the saved all-chat background', () => {
    const storage = createStorage();
    const data = new WechatData(storage);
    data.setAllChatBackgrounds('/backgrounds/shared.png');

    const reloadedData = new WechatData(storage);
    const newChat = reloadedData.createChat({ id: 'chat-new', name: '新会话' });

    assert.equal(reloadedData.getChat('chat-a').background, '/backgrounds/shared.png');
    assert.equal(newChat.background, '/backgrounds/shared.png');
    assert.equal(reloadedData.getChatBackground(newChat.id, '/backgrounds/default.png'), '/backgrounds/shared.png');
});

test('clearing all chat backgrounds restores the supplied system fallback', () => {
    const data = new WechatData(createStorage());
    data.setAllChatBackgrounds('/backgrounds/shared.png');
    data.setAllChatBackgrounds(null);

    assert.equal(data.getChat('chat-a').background, null);
    assert.equal(data.getChat('chat-b').background, null);
    assert.equal(data.getChatBackground('chat-a', '/backgrounds/default.png'), '/backgrounds/default.png');
    assert.equal(data.getChatBackground('chat-b', '/backgrounds/default.png'), '/backgrounds/default.png');
    assert.equal(data.data.userInfo.globalChatBackground, null);
});

test('an older tavern conversation receives the latest all-chat background when opened', () => {
    const globalValues = new Map();
    const currentConversation = new WechatData(createStorage(globalValues));
    currentConversation.setAllChatBackgrounds('/backgrounds/shared.png');

    const olderConversation = new WechatData(createStorage(globalValues));

    assert.equal(olderConversation.getChat('chat-a').background, '/backgrounds/shared.png');
    assert.equal(olderConversation.getChat('chat-b').background, '/backgrounds/shared.png');
    assert.ok(olderConversation.getChat('chat-a').globalChatBackgroundSyncRevision > 0);
});

test('a per-chat override survives reload until a newer all-chat sync is issued', () => {
    const globalValues = new Map();
    const sourceStorage = createStorage(globalValues);
    const olderStorage = createStorage(globalValues);
    const sourceConversation = new WechatData(sourceStorage);
    sourceConversation.setAllChatBackgrounds('/backgrounds/shared.png');

    const olderConversation = new WechatData(olderStorage);
    olderConversation.setChatBackground('chat-a', '/backgrounds/custom.png');

    const reloadedOlderConversation = new WechatData(olderStorage);
    assert.equal(reloadedOlderConversation.getChat('chat-a').background, '/backgrounds/custom.png');

    sourceConversation.setAllChatBackgrounds('/backgrounds/new-shared.png');
    const resyncedOlderConversation = new WechatData(olderStorage);
    assert.equal(resyncedOlderConversation.getChat('chat-a').background, '/backgrounds/new-shared.png');
    assert.equal(resyncedOlderConversation.getChat('chat-b').background, '/backgrounds/new-shared.png');
});
