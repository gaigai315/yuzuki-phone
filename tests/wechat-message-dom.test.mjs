import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatView } from '../apps/wechat/chat-view.js';

class Node {
    constructor(id, version = '', avatar = '', avatarVersion = '', text = '') {
        this.dataset = { messageId: id, messageIndex: '0', wechatRenderVersion: version };
        this.tagName = 'DIV';
        this.classList = { contains: () => false };
        this.text = text;
        this.bubble = { text, media: { playing: true } };
        this.avatar = { dataset: { wechatAvatarVersion: avatarVersion }, writes: 0, markup: avatar,
            get innerHTML() { return this.markup; },
            set innerHTML(value) { this.writes++; this.markup = value; }
        };
    }
    get nextElementSibling() {
        return this.parent?.children[this.parent.children.indexOf(this) + 1] || null;
    }
    querySelectorAll(selector) { return selector === '.message-avatar' && this.avatar.markup ? [this.avatar] : []; }
    isEqualNode(other) { return this.text === other.text && JSON.stringify(this.dataset) === JSON.stringify(other.dataset); }
    remove() {
        if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
        this.parent = null;
    }
    replaceWith(next) {
        const parent = this.parent;
        const index = parent.children.indexOf(this);
        next.remove();
        parent.children[index] = next;
        next.parent = parent;
        this.parent = null;
    }
}

class Container {
    constructor(children) {
        this.children = children;
        children.forEach(node => { node.parent = this; });
        this.insertions = 0;
    }
    get firstElementChild() { return this.children[0] || null; }
    insertBefore(node, cursor) {
        node.remove();
        const index = cursor ? this.children.indexOf(cursor) : this.children.length;
        assert.ok(index >= 0, 'insertion cursor must remain attached');
        this.children.splice(index, 0, node);
        node.parent = this;
        this.insertions++;
    }
}

function reconcile(view, container, next) {
    const template = new Container(next);
    return view._reconcileChatMessageNodes(container, [...template.children]);
}

test('avatar changes preserve message rows, bubbles, media and the user avatar while appending a notice', () => {
    const view = Object.create(ChatView.prototype);
    const friend = new Node('friend-message', 'body-1', 'old-avatar', 'avatar-1');
    const user = new Node('user-message', 'body-2', 'user-avatar', 'avatar-2');
    const container = new Container([friend, user]);
    const bubble = friend.bubble;
    const media = bubble.media;
    const notice = new Node('notice', '', '', '', '周倩 已更换头像');
    const changed = reconcile(view, container, [
        new Node('friend-message', 'body-1', 'new-avatar', 'avatar-3'),
        new Node('user-message', 'body-2', 'user-avatar', 'avatar-2'), notice
    ]);
    assert.equal(container.children[0], friend);
    assert.equal(friend.bubble, bubble);
    assert.equal(friend.bubble.media, media);
    assert.equal(media.playing, true);
    assert.equal(friend.avatar.innerHTML, 'new-avatar');
    assert.equal(friend.avatar.writes, 1);
    assert.equal(container.children[1], user);
    assert.equal(user.avatar.writes, 0);
    assert.deepEqual(changed, [notice], 'only new content needs event bindings');
    assert.equal(container.insertions, 1, 'existing message rows must not move');
    const unchanged = reconcile(view, container, [
        new Node('friend-message', 'body-1', 'new-avatar', 'avatar-3'),
        new Node('user-message', 'body-2', 'user-avatar', 'avatar-2'),
        new Node('notice', '', '', '', '周倩 已更换头像')
    ]);
    assert.deepEqual(unchanged, []);
    assert.equal(friend.avatar.writes, 1, 'final refresh must not reload the avatar');
});

test('edited content replaces only its own row, while deletion and append keep other rows attached', () => {
    const view = Object.create(ChatView.prototype);
    const oldest = new Node('old', 'old');
    const kept = new Node('kept', 'same');
    const edited = new Node('edited', 'before');
    const container = new Container([oldest, kept, edited]);
    const replacement = new Node('edited', 'after');
    const appended = new Node('new', 'new');
    const desiredKept = new Node('kept', 'same');
    desiredKept.dataset.messageIndex = '7';
    const changed = reconcile(view, container, [desiredKept, replacement, appended]);
    assert.deepEqual(container.children, [kept, replacement, appended]);
    assert.equal(kept.dataset.messageIndex, '7');
    assert.equal(oldest.parent, null);
    assert.equal(edited.parent, null);
    assert.deepEqual(changed, [replacement, appended]);
    assert.equal(container.insertions, 1, 'removing an older row must not move all remaining rows');
});

test('time dividers are matched to the following message and retained when new messages arrive', () => {
    const view = Object.create(ChatView.prototype);
    const divider = new Node('', '', '', '', '09:03');
    divider.classList = { contains: name => name === 'message-time-divider' };
    const row = new Node('message', 'same');
    const container = new Container([divider, row]);
    const nextDivider = new Node('', '', '', '', '09:03');
    nextDivider.classList = divider.classList;
    reconcile(view, container, [nextDivider, new Node('message', 'same'), new Node('new', 'new')]);
    assert.equal(container.children[0], divider);
    assert.equal(container.children[1], row);
});

test('rendered body and avatar revisions vary independently and cache growth is bounded', () => {
    const view = Object.create(ChatView.prototype);
    view.app = { currentChat: { id: 'chat' } };
    const body = view._getMessageRenderVersion('message', 'same body');
    const avatar = view._getMessageRenderVersion('avatar:message', 'old avatar');
    assert.equal(view._getMessageRenderVersion('message', 'same body'), body);
    assert.notEqual(view._getMessageRenderVersion('avatar:message', 'new avatar'), avatar);
    assert.equal(view._getMessageRenderVersion('message', 'same body'), body);
    assert.notEqual(view._getMessageRenderVersion('message', 'edited body'), body);
    for (let index = 0; index < 1100; index++) view._getMessageRenderVersion(`message-${index}`, 'body');
    assert.equal(view._messageRenderVersions.size, 1000);
});

test('renderMessage keeps its body revision across avatar changes and changes it for edits', () => {
    const view = Object.create(ChatView.prototype);
    let avatar = 'old.png';
    view.app = { currentChat: { id: 'chat', type: 'single' }, renderAvatar: src => `<img src="${src}">` };
    view._escapeHtml = value => String(value ?? '');
    view.selectedMessageIds = new Set();
    view._isMessageSelectionActiveForCurrentChat = () => false;
    view._resolveMessageAvatarIdentity = () => ({ isMe: false, senderName: '周倩', senderAvatar: avatar });
    view._getForwardedRecord = () => null;
    view.renderTextMessageBubble = text => `<span>${text}</span>`;
    const render = content => {
        const html = view.renderMessage({ id: 'message', type: 'text', content }, { name: '用户' });
        return {
            body: html.match(/data-wechat-render-version="([^"]+)"/)[1],
            avatar: html.match(/data-wechat-avatar-version="([^"]+)"/)[1]
        };
    };
    const before = render('你好');
    avatar = 'new.png';
    const after = render('你好');
    assert.equal(after.body, before.body);
    assert.notEqual(after.avatar, before.avatar);
    assert.notEqual(render('改过的消息').body, after.body);
});

test('smart refresh keeps scroll and input state and binds actions only on newly inserted content', () => {
    const previousDocument = globalThis.document;
    const view = Object.create(ChatView.prototype);
    const existing = new Node('message', 'body', 'old-avatar', 'avatar-1');
    const container = new Container([existing]);
    container.scrollTop = 120;
    container.scrollHeight = 1000;
    container.clientHeight = 300;
    const input = { value: '还没发出的文字', selectionStart: 3 };
    view.app = { currentChat: { id: 'chat' }, render: () => assert.fail('must preserve the surrounding chat') };
    view._getVisibleChatMessagesContainer = () => container;
    view._renderMessageHistoryWindow = () => 'new markup';
    view.bindMessageLongPressEvents = view.bindManualTimeMarkerEvents = view.bindInnerThoughtEvents =
        view.bindMessageSelectionEvents = view.bindMessageHistoryEvents = () => {};
    const bound = [];
    view.bindSpecialMessageEvents = root => bound.push(root);
    const notice = new Node('notice', '', '', '', '周倩 已更换头像');
    let next = [new Node('message', 'body', 'new-avatar', 'avatar-2'), notice];
    globalThis.document = {
        activeElement: input,
        createElement: tag => {
            assert.equal(tag, 'template');
            return { content: new Container(next) };
        }
    };
    try {
        view.smartUpdateMessages([], {}, { chatId: 'chat' });
        next = [new Node('message', 'body', 'new-avatar', 'avatar-2'), new Node('notice', '', '', '', '周倩 已更换头像')];
        view.smartUpdateMessages([], {}, { chatId: 'chat' });
        assert.equal(container.children[0], existing);
        assert.equal(existing.avatar.writes, 1);
        assert.equal(container.scrollTop, 120);
        assert.deepEqual(bound, [notice]);
        assert.equal(document.activeElement, input);
        assert.equal(input.value, '还没发出的文字');
        assert.equal(input.selectionStart, 3);
    } finally { globalThis.document = previousDocument; }
});
