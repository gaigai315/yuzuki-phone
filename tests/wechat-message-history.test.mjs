import assert from 'node:assert/strict';
import test from 'node:test';

import { ChatView, WECHAT_MESSAGE_PAGE_SIZE } from '../apps/wechat/chat-view.js';

function createView(chatId = 'chat_test') {
    const view = Object.create(ChatView.prototype);
    view.app = { currentChat: { id: chatId } };
    view._visibleMessageCounts = new Map();
    view.scheduleInlineStickerHydration = () => {};
    view._escapeHtml = value => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    view.renderMessage = (message, _userInfo, index) => (
        `<div class="chat-message" data-message-id="${message.id}" data-message-index="${index}">${message.content}</div>`
    );
    return view;
}

function createMessages(count) {
    return Array.from({ length: count }, (_value, index) => ({
        id: `message_${index}`,
        content: `消息 ${index}`,
        timestamp: 0
    }));
}

test('wechat chat renders only the latest 50 messages before expanding', () => {
    const view = createView();
    const html = view._renderMessageHistoryWindow(createMessages(51), {}, 'chat_test');

    assert.equal(WECHAT_MESSAGE_PAGE_SIZE, 50);
    assert.match(html, /wechat-message-history-button/);
    assert.match(html, /剩余 1 条/);
    assert.doesNotMatch(html, /data-message-id="message_0"/);
    assert.match(html, /data-message-id="message_1" data-message-index="1"/);
    assert.match(html, /data-message-id="message_50" data-message-index="50"/);
});

test('wechat chat omits the history button at 50 messages or fewer', () => {
    const view = createView();
    const html = view._renderMessageHistoryWindow(createMessages(50), {}, 'chat_test');

    assert.doesNotMatch(html, /wechat-message-history-button/);
    assert.equal((html.match(/class="chat-message"/g) || []).length, 50);
});

test('each expansion reveals another 50 messages and keeps full-list indices', () => {
    const view = createView();
    const messages = createMessages(121);

    assert.equal(view._expandMessageHistoryWindow('chat_test', messages.length), 100);
    let html = view._renderMessageHistoryWindow(messages, {}, 'chat_test');
    assert.match(html, /剩余 21 条/);
    assert.match(html, /data-message-id="message_21" data-message-index="21"/);
    assert.equal((html.match(/class="chat-message"/g) || []).length, 100);

    assert.equal(view._expandMessageHistoryWindow('chat_test', messages.length), 121);
    html = view._renderMessageHistoryWindow(messages, {}, 'chat_test');
    assert.doesNotMatch(html, /wechat-message-history-button/);
    assert.match(html, /data-message-id="message_0" data-message-index="0"/);
});

test('message history windows stay independent between chats and can reset', () => {
    const view = createView('chat_a');
    view._expandMessageHistoryWindow('chat_a', 120);

    assert.equal(view._getMessageHistoryWindow(createMessages(120), 'chat_a').visibleCount, 100);
    assert.equal(view._getMessageHistoryWindow(createMessages(120), 'chat_b').visibleCount, 50);

    view.resetMessageHistoryWindow('chat_a');
    assert.equal(view._getMessageHistoryWindow(createMessages(120), 'chat_a').visibleCount, 50);
});

test('restoring expanded history keeps the previous first message in place', () => {
    const view = createView();
    const oldAnchor = { dataset: { messageIndex: '71' }, offsetTop: 20 };
    const newAnchor = { dataset: { messageIndex: '71' }, offsetTop: 1420 };
    const container = {
        scrollTop: 10,
        scrollHeight: 900,
        querySelectorAll: () => [oldAnchor]
    };
    const snapshot = view._captureMessageHistoryScroll(container);

    container.scrollHeight = 2300;
    container.querySelectorAll = () => [
        { dataset: { messageIndex: '21' }, offsetTop: 20 },
        newAnchor
    ];
    view._restoreMessageHistoryScroll(container, snapshot);

    assert.equal(container.scrollTop, 1410);
    assert.equal(newAnchor.offsetTop - container.scrollTop, 10);
});
