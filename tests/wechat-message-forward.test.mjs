import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatView } from '../apps/wechat/chat-view.js';

function fixture() {
    const view = Object.create(ChatView.prototype);
    view._escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const source = { id: 'source', name: '原群', type: 'group' };
    const destination = { id: 'destination', name: '目标群', type: 'group' };
    const messages = [
        { id: '1', from: 'me', type: 'text', content: '用户的话', tavernMessageIndex: 1 },
        { id: '2', from: 'friend', type: 'text', content: '好友的话', innerThought: '隐藏心声' },
        { id: '3', from: 'friend', type: 'text', content: '未勾选' },
        { id: '4', from: 'system', type: 'time_marker', isTimeMarker: true }
    ];
    const stored = [];
    view.messageSelectionMode = true;
    view.messageSelectionChatId = source.id;
    view.selectedMessageIds = new Set(['2', '1', '4', 'deleted']);
    view.app = { currentChat: source, wechatData: {
        getChat: id => [source, destination].find(c => c.id === id),
        getMessages: () => messages,
        getUserInfo: () => ({ name: '小明', avatar: '/avatar.png' }),
        getContact: id => id === 'friend' ? { id, name: '小红' } : null,
        getContacts: () => [{ id: 'friend', name: '小红' }, { id: 'blocked', name: '黑名单', blocked: true }],
        getContactDisplayName: c => c.name,
        getChatList: () => [source, destination],
        createChat: target => ({ id: 'new-friend-chat', ...target }),
        addMessage: (chatId, message) => { stored.push({ chatId, message }); return true; }
    } };
    view._shouldUseRealTimeForOnlineChat = () => false;
    view.scheduleInlineStickerHydration = () => {};
    return { view, stored, messages };
}

test('forward keeps selected user and character messages in original order without hidden thoughts', () => {
    const { view } = fixture();
    assert.equal(view._buildSelectedForwardContent(), '【转发聊天记录：原群】\n小明：用户的话\n\n小红：好友的话');
    view.app.currentChat = { id: 'different' };
    assert.equal(view._buildSelectedForwardContent(), '');
});

test('forward picker includes friends and other groups, excluding blocked contacts', () => {
    const { view } = fixture();
    assert.deepEqual(view._getMessageForwardTargets().map(t => t.key), ['friend:friend', 'group:destination']);
});

test('forward persists a fresh visible user message in either recipient history', () => {
    const { view, stored, messages } = fixture();
    const content = view._buildSelectedForwardContent();
    for (const target of view._getMessageForwardTargets()) view._sendForwardedMessages(target, content);
    assert.deepEqual(stored.map(item => item.chatId), ['new-friend-chat', 'destination']);
    for (const { message } of stored) {
        assert.equal(message.content, content);
        assert.equal(message.from, 'me');
        assert.equal(message.type, 'forward_card');
        assert.match(message.batchId, /^forward_/);
        assert.equal(message.tavernMessageIndex, undefined); // addMessage assigns the current floor.
        assert.equal(message.hiddenFromPrompt, undefined);
    }
    assert.equal(messages[0].tavernMessageIndex, 1);
});

test('new and previously sent forward records both render as compact cards', () => {
    const { view } = fixture();
    const content = view._buildSelectedForwardContent();
    for (const type of ['text', 'forward_card']) {
        const msg = { id: 'forward', type, content };
        assert.deepEqual(view._getForwardedRecord(msg), {
            title: '原群的聊天记录', content: '小明：用户的话\n\n小红：好友的话'
        });
        assert.match(view._renderForwardedRecordCard(msg), /wechat-forward-record-card/);
        assert.match(view._renderForwardedRecordCard(msg), /查看详情/);
        assert.equal(view._formatMessageContentForPrompt(msg), content);
    }
    assert.equal(view._getForwardedRecord({ type: 'text', content: '普通消息' }), null);
});

test('forward card preview is limited while full record stays available and HTML is escaped', () => {
    const { view } = fixture();
    const msg = { id: 'safe', type: 'forward_card', content: '【转发聊天记录：<群>】\n甲：<script>\n乙：第二条\n丙：第三条\n丁：第四条' };
    const card = view._renderForwardedRecordCard(msg);
    assert.ok(!card.includes('<script>'));
    assert.match(card, /&lt;script&gt;/);
    assert.ok(!card.includes('第四条'));
    assert.ok(view._getForwardedRecord(msg).content.includes('第四条'));
});

test('empty selection cannot send a blank forward', () => {
    const { view, stored } = fixture();
    view.selectedMessageIds.clear();
    assert.equal(view._buildSelectedForwardContent(), '');
    assert.throws(() => view._sendForwardedMessages(view._getMessageForwardTargets()[0], ''), /没有可转发/);
    assert.equal(stored.length, 0);
});

test('card click opens details once, while selection mode keeps the click for selection', () => {
    const { view } = fixture();
    const handlers = {};
    const card = { dataset: { msgId: 'forward' }, addEventListener: (name, fn) => { handlers[name] = fn; } };
    view.getCurrentWechatView = () => ({ querySelectorAll: selector => selector === '.wechat-forward-record-card:not(.wechat-file-card)' ? [card] : [] });
    let opened = 0;
    view.openForwardedRecord = id => { assert.equal(id, 'forward'); opened++; };
    view.bindSpecialMessageEvents();
    const firstHandler = handlers.click;
    view.bindSpecialMessageEvents();
    assert.equal(handlers.click, firstHandler);
    const event = { preventDefault() {}, stopPropagation() {} };
    handlers.click(event);
    assert.equal(opened, 0);
    view.messageSelectionMode = false;
    handlers.click(event);
    assert.equal(opened, 1);
    handlers.keydown({ ...event, key: 'Enter' });
    assert.equal(opened, 2);
});

test('opening details shows the complete escaped record and can close the overlay', () => {
    const { view, messages } = fixture();
    messages.push({ id: 'forward', type: 'forward_card', content: '【转发聊天记录：原群】\n甲：第一条\n乙：第二条\n丙：第三条\n丁：<最后一条>' });
    let appended;
    let click;
    let removed = false;
    view.getCurrentWechatView = () => ({ querySelector: () => null, appendChild: el => { appended = el; } });
    const oldDocument = globalThis.document;
    globalThis.document = { createElement: () => ({ addEventListener: (_name, fn) => { click = fn; }, remove: () => { removed = true; } }) };
    try {
        view.openForwardedRecord('forward');
        assert.match(appended.innerHTML, /丁：&lt;最后一条&gt;/);
        assert.match(appended.innerHTML, /wechat-forward-record-body/);
        click({ target: appended, stopPropagation() {} });
        assert.equal(removed, true);
    } finally {
        if (oldDocument === undefined) delete globalThis.document;
        else globalThis.document = oldDocument;
    }
});

test('forward snapshots each original date and time and exposes them to recipient AI and details', () => {
    const { view, messages, stored } = fixture();
    Object.assign(messages[0], { date: '2103年06月02日', time: '13:15', avatar: '/user.png' });
    Object.assign(messages[1], { date: '2103年06月03日', time: '00:01', avatar: '/friend.png' });
    const entries = view._buildSelectedForwardEntries();
    const content = view._buildSelectedForwardContent(entries);
    view._sendForwardedMessages(view._getMessageForwardTargets()[0], content, entries);
    const forwarded = stored[0].message;
    assert.match(view._formatMessageContentForPrompt(forwarded), /小明（2103年06月02日 13:15）/);
    assert.match(forwarded.content, /小红（2103年06月03日 00:01）/);
    messages[0].time = '22:00';
    entries[0].date = '已修改';
    assert.equal(forwarded.forwardEntries[0].date, '2103年06月02日');
    assert.equal(forwarded.forwardEntries[0].time, '13:15');
    view.app.renderAvatar = (_avatar, _fallback, name) => `<span>${name}</span>`;
    const html = view._renderForwardedRecordDetails(forwarded);
    assert.match(html, /wechat-forward-record-entry-header/);
    assert.match(html, /2103年06月02日 13:15/);
    assert.match(html, /2103年06月03日 00:01/);
    assert.match(html, /用户的话/);
    assert.match(html, /好友的话/);
});

test('time display prefers original story fields and does not invent missing historical dates', () => {
    const { view } = fixture();
    const timestamp = new Date(2026, 10, 3, 17, 35).getTime();
    assert.equal(view._formatForwardEntryTime({ timestamp }), '2026年11月03日 17:35');
    assert.equal(view._formatForwardEntryTime({ date: '2103-06-02', time: '13:15', timestamp }), '2103年06月02日 13:15');
    assert.equal(view._formatForwardEntryTime({}), '');
    assert.equal(view._formatForwardEntryTime({ time: '13:15' }), '13:15');
});
