import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatView } from '../apps/wechat/chat-view.js';
import { parseWechatOnlineGroupInvitation } from '../apps/wechat/group-invitation.js';
import { PromptManager } from '../config/prompt-manager.js';

function fixture() {
    const contact = { id: 'friend', name: '阿年', realName: '林予安' };
    const chat = { id: 'private', name: '阿年', type: 'single', contactId: contact.id };
    const card = { id: 'invite', from: '阿年', ...parseWechatOnlineGroupInvitation('[群聊邀请]（周末群｜阿年、陌生群友）') };
    const data = {
        data: { contacts: [contact], chats: [chat], messages: { private: [card] } },
        getContacts: () => data.data.contacts,
        getChatList: () => data.data.chats,
        getChat: id => data.data.chats.find(item => item.id === id),
        getMessages: id => data.data.messages[id] ||= [],
        getContact: id => data.data.contacts.find(item => item.id === id),
        getUserInfo: () => ({ name: '小月' }),
        createChat(info) { const group = { ...info }; data.data.chats.push(group); return group; },
        addMessage(id, message) { data.getMessages(id).push({ id: `msg-${data.getMessages(id).length}`, ...message }); return true; },
        updateMessageById(id, messageId, patch) { const message = data.getMessages(id).find(item => item.id === messageId); if (message) Object.assign(message, patch); return message; },
        saveData() {},
        addContact: () => assert.fail('group-only members must not become friends')
    };
    const view = Object.create(ChatView.prototype);
    const notices = [];
    view.app = { wechatData: data, currentChat: chat, phoneShell: { showNotification: (...args) => notices.push(args) } };
    view._refreshVisibleChatMessages = () => {};
    view._getCurrentTavernChatId = () => 'conversation';
    view.isOnlineMode = () => true;
    view._escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    view.pendingChatIds = new Set();
    return { view, data, card, chat, notices };
}

test('default online prompt contains the requested invitation rule and the compact format parses', () => {
    const manager = Object.create(PromptManager.prototype);
    const prompt = manager.getDefaultPrompts().wechat.online.content;
    assert.ok(prompt.includes('💡 **拉群邀请**：当 {{chatName}} 在私聊中邀请 {{user}} 进新群时，单独占一行输出：{{chatName}}: [群聊邀请]（群聊名称｜群成员1、群成员2）'));
    assert.equal(parseWechatOnlineGroupInvitation('[群聊邀请]（缺少成员）'), null);
    assert.equal(parseWechatOnlineGroupInvitation('[群聊邀请]（群名｜）'), null);
    const { view, data } = fixture();
    const split = view.splitMixedSpecialMessage({ sender: '阿年', content: '一起玩吧[群聊邀请]（周末群｜阿年、陌生群友）等你' });
    assert.deepEqual(split.map(item => item.specialMessage?.type || item.content), ['一起玩吧', 'group_invitation', '等你']);
    assert.equal(data.getChatList().length, 1, 'receiving an invitation does not join the group');
});

test('acceptance keeps the join notice in the group only, preserves nonfriends and requests exactly one welcome', async () => {
    const { view, data, card } = fixture();
    const calls = [];
    let release;
    view.sendToAI = async (message, groupId, options) => {
        calls.push({ message, groupId, options });
        assert.equal(data.getChat(groupId).groupInvitation.onlineWelcomeState, 'started');
        assert.equal(data.getMessages(groupId)[0].content, '小月 已加入群聊');
        return new Promise(resolve => { release = resolve; });
    };
    const accepted = await view._handleOnlineGroupInvitation('private', 'invite', 'accept');
    assert.equal(accepted.status, 'joined');
    assert.equal(card.groupInvitationStatus, 'accepted');
    assert.equal(data.getChatList().length, 2);
    assert.deepEqual(accepted.chat.members, ['阿年', '陌生群友']);
    assert.equal(data.getContacts().length, 1);
    assert.equal(data.getMessages('private').length, 1, 'the invitation card already shows acceptance; do not add a second private notice');
    assert.equal(data.getMessages(accepted.chat.id)[0].fromMainChatTag, undefined, 'online acceptance is independent from story-floor rollback');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].groupId, accepted.chat.id);
    assert.deepEqual(calls[0].options.groupJoinWelcome, { userName: '小月', inviterName: '阿年' });
    assert.equal(calls[0].options.sourceTavernChatId, 'conversation');
    assert.equal(await view._handleOnlineGroupInvitation('private', 'invite', 'accept'), false);
    view._scheduleGroupWelcomeFlush();
    await Promise.resolve();
    assert.equal(calls.length, 1, 'repeat clicks and redraws cannot duplicate the request');
    release(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(accepted.chat.groupInvitation.onlineWelcomeState, 'completed');
    await view._flushPendingGroupWelcomes();
    assert.equal(calls.length, 1);
    const instruction = view._buildGroupJoinWelcomeInstruction(accepted.chat, calls[0].options.groupJoinWelcome);
    assert.match(instruction, /用户尚未发送消息/);
    assert.match(instruction, /不得替 小月 发言/);
});

test('declining or accepting another card for an existing group never requests a welcome', async () => {
    const { view, data, card } = fixture();
    view.sendToAI = () => assert.fail('no new group join occurred');
    await view._handleOnlineGroupInvitation('private', 'invite', 'decline');
    assert.equal(card.groupInvitationStatus, 'declined');
    assert.equal(data.getChatList().length, 1);
    card.groupInvitationStatus = 'pending';
    data.data.chats.push({ id: 'existing', type: 'group', name: '周末群', members: ['原有群友'] });
    const result = await view._handleOnlineGroupInvitation('private', 'invite', 'accept');
    assert.equal(result.status, 'exists');
    assert.equal(card.groupInvitationChatId, 'existing');
    assert.deepEqual(result.chat.members, ['原有群友']);
    await Promise.resolve();
    assert.equal(data.getMessages('private').length, 1);
});

test('welcome waits for the current reply and pending send queue, and failed attempts are not retried automatically', async () => {
    const { view, data } = fixture();
    let calls = 0;
    view.sendToAI = async () => { calls++; return false; };
    view.isSending = true;
    const { chat } = await view._handleOnlineGroupInvitation('private', 'invite', 'accept');
    assert.equal(calls, 0);
    assert.equal(chat.groupInvitation.onlineWelcomeState, 'pending');
    view.isSending = false;
    view._isFlushingPending = true;
    await view._flushPendingGroupWelcomes();
    assert.equal(calls, 0);
    view._isFlushingPending = false;
    await view._flushPendingGroupWelcomes();
    assert.equal(calls, 1);
    assert.equal(chat.groupInvitation.onlineWelcomeState, 'failed');
    view._scheduleGroupWelcomeFlush();
    await Promise.resolve();
    assert.equal(calls, 1);
    assert.equal(data.getChatList().length, 2, 'welcome failure must not undo group membership');
});

test('pending welcomes do not run after switching the story conversation', async () => {
    const { view } = fixture();
    view.isSending = true;
    const { chat } = await view._handleOnlineGroupInvitation('private', 'invite', 'accept');
    view.isSending = false;
    view._getCurrentTavernChatId = () => 'different-conversation';
    view.sendToAI = () => assert.fail('do not send a stale group event in another story conversation');
    await view._flushPendingGroupWelcomes();
    assert.equal(chat.groupInvitation.onlineWelcomeState, 'pending');
});

test('invitation card escapes user-generated names and switches to an enter-group button after acceptance', async () => {
    const { view, data, card } = fixture();
    card.groupInvitationName = '<img src=x>';
    card.groupInvitationMembers = ['<script>bad</script>'];
    let html = view._renderGroupInvitationCard(card);
    assert.ok(html.includes('&lt;img src=x&gt;'));
    assert.ok(!html.includes('<script>'));
    assert.match(html, /同意入群/);
    assert.match(html, /data-message-id="invite"/);
    view.isSending = true;
    const result = await view._handleOnlineGroupInvitation('private', 'invite', 'accept');
    html = view._renderGroupInvitationCard(card);
    assert.match(html, /小月 已加入群聊/);
    assert.match(html, /进入群聊/);
    assert.doesNotMatch(html, /同意入群/);
    assert.equal(data.getMessages(result.chat.id)[0].from, 'system');
});

test('one automatic welcome cannot start another model request through avatar lookup', async () => {
    const { view } = fixture();
    let requests = 0;
    view.sendToAIHidden = async () => { requests++; return '阿年: 欢迎小月\n阿年: [查看头像分组]'; };
    const responses = [];
    for await (const response of view._sendWechatReplyWithAvatarLookup('', {}, null, 'group', { groupJoinWelcome: { userName: '小月' } })) responses.push(response);
    assert.equal(requests, 1);
    assert.equal(responses.length, 1);
    assert.ok(responses[0].includes('欢迎小月'));
    assert.ok(!responses[0].includes('查看头像分组'));
});

test('old duplicate private notices disappear without leaving a timestamp, while the group join notice remains', () => {
    const { view } = fixture();
    const oldNotice = { id: 'old-notice', from: 'system', type: 'system', content: '小月 已加入群聊“周末群”',
        joinedGroupChatId: 'group', groupInvitationMessageId: 'invite', timestamp: 1700000000000 };
    view.scheduleInlineStickerHydration = () => {};
    assert.equal(view.renderMessage(oldNotice, {}), '');
    assert.equal(view.renderMessagesWithDateDividers([oldNotice], {}), '');
    view.app.currentChat = { id: 'group', type: 'group' };
    view._resolveMessageAvatarIdentity = () => ({ isMe: false, senderName: '系统', senderAvatar: '' });
    view._isMessageSelectionActiveForCurrentChat = () => false;
    view.selectedMessageIds = new Set();
    const groupNotice = { id: 'join', from: 'system', type: 'system', groupInvitationAccepted: true, content: '小月 已加入群聊' };
    assert.match(view.renderMessage(groupNotice, {}), /小月 已加入群聊/);
});
