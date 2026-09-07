import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs
    .readFileSync(new URL('../apps/games/catbox/catbox-data.js', import.meta.url), 'utf8')
    .replace("import { WechatData } from '../../wechat/wechat-data.js';", 'class WechatData {}');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { CatboxData } = await import(moduleUrl);

class FakeStorage {
    constructor() {
        this.currentChatId = 'chat-a';
        this.global = new Map();
        this.chats = new Map();
    }

    _storeFor(key) {
        if (!key.startsWith('chat_games_')) return this.global;
        if (!this.chats.has(this.currentChatId)) this.chats.set(this.currentChatId, new Map());
        return this.chats.get(this.currentChatId);
    }

    get(key, fallback = null) {
        const store = this._storeFor(key);
        return store.has(key) ? store.get(key) : fallback;
    }

    set(key, value) {
        this._storeFor(key).set(key, structuredClone(value));
    }

    remove(key) {
        this._storeFor(key).delete(key);
    }
}

test('catbox migrates the legacy global pet only into the active chat', () => {
    const storage = new FakeStorage();
    storage.global.set('games_catbox_state', {
        adopted: true,
        catId: 'A1',
        draftCatId: 'A1',
        catName: '像素',
        catGender: 'female'
    });

    const catbox = new CatboxData(storage);

    assert.equal(catbox.getState().catName, '像素');
    assert.equal(storage.global.has('games_catbox_state'), false);
    assert.equal(storage.chats.get('chat-a').has('chat_games_catbox_state'), true);

    storage.currentChatId = 'chat-b';
    catbox.reloadForCurrentChat();
    assert.equal(catbox.getState().adopted, false);
});

test('catbox keeps separate pets for separate chats', () => {
    const storage = new FakeStorage();
    const catbox = new CatboxData(storage);

    catbox.randomCat();
    catbox.adoptCat('会话甲', 'female');

    storage.currentChatId = 'chat-b';
    catbox.reloadForCurrentChat();
    catbox.randomCat();
    catbox.adoptCat('会话乙', 'male');

    storage.currentChatId = 'chat-a';
    catbox.reloadForCurrentChat();
    assert.equal(catbox.getState().catName, '会话甲');

    storage.currentChatId = 'chat-b';
    catbox.reloadForCurrentChat();
    assert.equal(catbox.getState().catName, '会话乙');
});
