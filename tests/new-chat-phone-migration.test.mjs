import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const start = source.indexOf('    let _pendingNewChatPhoneDataMigration = null;');
const end = source.indexOf('    async function checkCalendarScheduleReminders(', start);
assert.ok(start >= 0 && end > start);

function createHarness() {
    const original = {
        wechat_data: JSON.stringify({ contacts: [{ id: 'friend', name: '好友' }] }),
        wechat_messages_friend: JSON.stringify([{ id: 'msg', content: '旧聊天中的消息' }]),
    };
    let saves = 0;
    let context = makeContext('old', '角色.png', { ...original });
    const listeners = new Map();
    const runtime = vm.createContext({
        console: { log() {}, warn() {} },
        structuredClone,
        getContext: () => context,
        storage: { NAMESPACE: 'st_virtual_phone' },
        window: {},
        document: {
            addEventListener(type, callback, capture) {
                assert.equal(capture, true);
                listeners.set(type, callback);
            },
        },
    });
    function makeContext(chatId, avatar, store) {
        return {
            chatId,
            characterId: 0,
            characters: [{ avatar }],
            chatMetadata: { st_virtual_phone: store },
            saveChat() { saves += 1; },
        };
    }
    vm.runInContext(source.slice(start, end), runtime);
    vm.runInContext('bindNewChatPhoneDataMigration()', runtime);
    return {
        original,
        get store() { return context.chatMetadata.st_virtual_phone; },
        get saves() { return saves; },
        click(selector, popup) {
            const control = { closest: () => popup };
            listeners.get('click')({ target: {
                closest: selectors => selectors.split(', ').includes(selector) ? control : null,
            } });
        },
        cancel(popup) { listeners.get('cancel')({ target: popup }); },
        switchChat(chatId = 'new', avatar = '角色.png') {
            context = makeContext(chatId, avatar, {});
        },
        apply() { return vm.runInContext('applyPendingPhoneDataMigrationToCurrentChat()', runtime); },
        expire() {
            vm.runInContext('_pendingNewChatPhoneDataMigration.capturedAt = Date.now() - 120001', runtime);
        },
    };
}

function popup(textContent, marker = false) {
    const element = { textContent, querySelector: () => marker ? {} : null };
    element.closest = () => element;
    return element;
}

for (const title of ['开始新聊天？', '开始新的聊天？', 'Start new chat?']) {
    test(`confirmed new chat inherits all phone keys with title: ${title}`, () => {
        const h = createHarness();
        const sourceStore = h.store;
        h.click('#option_start_new_chat');
        h.click('.popup-button-ok', popup(title));
        h.switchChat();
        assert.equal(h.apply(), true);
        assert.deepEqual(h.store, h.original);
        assert.deepEqual(sourceStore, h.original);
        assert.notEqual(h.store, sourceStore);
        assert.equal(h.saves, 1);
        assert.equal(h.apply(), false, 'a snapshot must only be applied once');
    });
}

test('stable new-chat popup markers support other languages and legacy controls', () => {
    const h = createHarness();
    h.click('#option_start_new_chat');
    h.click('#dialogue_popup_ok', popup('新しいチャットを開始しますか？', true));
    h.switchChat();
    assert.equal(h.apply(), true);
    assert.deepEqual(h.store, h.original);
});

for (const cancelControl of ['.popup-button-cancel', '.popup-button-close', '#dialogue_popup_cancel', 'cancel-event']) {
    test(`cancelling a TT new-chat popup discards its snapshot: ${cancelControl}`, () => {
        const h = createHarness();
        h.click('#option_start_new_chat');
        const dialog = popup('开始新的聊天？', true);
        if (cancelControl === 'cancel-event') h.cancel(dialog);
        else h.click(cancelControl, dialog);
        h.click('.popup-button-ok', dialog);
        h.switchChat();
        assert.equal(h.apply(), false);
        assert.deepEqual(h.store, {});
        assert.equal(h.saves, 0);
    });
}

test('confirming an unrelated popup does not authorize phone migration', () => {
    const h = createHarness();
    h.click('#option_start_new_chat');
    h.click('.popup-button-ok', popup('删除消息？'));
    h.switchChat();
    assert.equal(h.apply(), false);
    assert.deepEqual(h.store, {});
});

for (const scenario of ['same-chat', 'different-character', 'expired']) {
    test(`phone migration remains isolated: ${scenario}`, () => {
        const h = createHarness();
        h.click('#option_start_new_chat');
        h.click('.popup-button-ok', popup('开始新的聊天？', true));
        if (scenario === 'expired') h.expire();
        h.switchChat(scenario === 'same-chat' ? 'old' : 'new',
            scenario === 'different-character' ? '另一角色.png' : '角色.png');
        assert.equal(h.apply(), false);
        assert.deepEqual(h.store, {});
        assert.equal(h.saves, 0);
    });
}
