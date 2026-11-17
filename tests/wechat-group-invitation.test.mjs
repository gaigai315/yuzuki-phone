import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { WechatData } from '../apps/wechat/wechat-data.js';
import {
    acceptWechatGroupInvitation, findWechatInvitationFriend, findWechatInvitedGroup,
    isWechatGroupInvitationCurrent, parseWechatGroupInvitations
} from '../apps/wechat/group-invitation.js';

const tag = (group = '周末群') => `<群聊邀请>
群聊名称：${group}
邀请人：林予安
群成员：阿年、群友甲、群友乙、群友甲
邀请理由：一起讨论周末安排
</群聊邀请>`;

function fixture() {
    const contacts = [{ id: 'friend', name: '阿年', nickname: '阿年', realName: '林予安', remark: '熟人' }];
    const chats = [];
    const messages = {};
    const data = {
        data: { contacts, chats, messages },
        getContacts: () => contacts,
        getChatList: () => data.data.chats,
        getUserInfo: () => ({ name: '小月' }),
        addContact: () => assert.fail('a group invitation must not add contacts'),
        globalSocialStore: { upsertContact: () => assert.fail('group members must not become cross-app contacts') },
        createChat(info) { const chat = { ...info, unread: 0 }; data.data.chats.push(chat); return chat; },
        addMessage(id, message) { (messages[id] ||= []).push(message); return true; },
        saveData() {}
    };
    return data;
}

test('complete group invitations parse fields and member lists, with empty reasons and multiple invitations', () => {
    const parsed = parseWechatGroupInvitations(tag() + '\n' + tag('同事群').replace('一起讨论周末安排', ''));
    assert.equal(parsed.length, 2);
    assert.deepEqual(parsed[0].members, ['阿年', '群友甲', '群友乙']);
    assert.equal(parsed[1].reason, '');
    assert.equal(parseWechatGroupInvitations(tag().replace('</群聊邀请>', '')).length, 0);
    assert.equal(parseWechatGroupInvitations(tag().replace('邀请人：林予安', '邀请人：')).length, 0);
    assert.equal(parseWechatGroupInvitations(tag().replace('阿年、群友甲、群友乙、群友甲', '')).length, 0);
});

test('accepting a group invite reuses known friends and keeps unknown members outside the address book', () => {
    const data = fixture();
    const contacts = structuredClone(data.data.contacts);
    const request = parseWechatGroupInvitations(tag())[0];
    request.members.push('林予安', '小月', '用户');
    const result = acceptWechatGroupInvitation(data, request, { tavernMessageIndex: 4, batchId: 'batch' });
    assert.equal(result.status, 'joined');
    assert.deepEqual(result.chat.members, ['阿年', '群友甲', '群友乙', '小月']);
    assert.deepEqual(data.data.contacts, contacts);
    assert.equal(data.data.chats.length, 1);
    assert.equal(data.data.chats[0].type, 'group');
    assert.equal(findWechatInvitationFriend(data, '群友甲'), null);
    assert.equal(findWechatInvitationFriend(data, '林予安').id, 'friend');
    assert.equal(findWechatInvitationFriend(data, '熟人').id, 'friend');
    assert.equal(findWechatInvitationFriend(data, '予安'), null, 'partial names must not impersonate friends');
    const message = data.data.messages[result.chat.id][0];
    assert.match(message.content, /阿年 邀请你加入了群聊/);
    assert.equal(message.from, 'system');
    assert.equal(message.fromMainChatTag, true);
    assert.equal(message.tavernMessageIndex, 4);
    assert.equal(message.batchId, 'batch');
    assert.equal(result.chat.groupInvitation.tavernMessageIndex, 4);
});

test('an existing group is reused without rewriting its members or creating another notice', () => {
    const data = fixture();
    const request = parseWechatGroupInvitations(tag())[0];
    const first = acceptWechatGroupInvitation(data, request);
    first.chat.members.push('原有群友');
    request.members = ['完全不同的成员'];
    const second = acceptWechatGroupInvitation(data, request);
    assert.equal(second.status, 'exists');
    assert.equal(second.chat, first.chat);
    assert.ok(second.chat.members.includes('原有群友'));
    assert.ok(!second.chat.members.includes('完全不同的成员'));
    assert.equal(data.data.chats.length, 1);
    assert.equal(data.data.messages[first.chat.id].length, 1);
    data.data.chats.push({ id: 'single', name: '只有单聊', type: 'single' });
    assert.equal(findWechatInvitedGroup(data, '只有单聊'), null);
});

test('strangers cannot invite the user, and parsing or rejection creates no group', () => {
    const data = fixture();
    const invitation = parseWechatGroupInvitations(tag())[0];
    assert.equal(data.data.chats.length, 0, 'parsing an invitation must not accept it');
    assert.throws(() => acceptWechatGroupInvitation(data, { ...invitation, inviter: '群友甲' }), /不是现有微信好友/);
    assert.equal(data.data.chats.length, 0);
    assert.equal(data.data.contacts.length, 1);
});

test('inviter is always included and only one copy of the current user is inserted', () => {
    const data = fixture();
    const request = { groupName: '聚会', inviter: '熟人', members: ['新群友', '我', '小月'], reason: '' };
    const { chat } = acceptWechatGroupInvitation(data, request);
    assert.deepEqual(chat.members, ['新群友', '小月', '阿年']);
});

test('a queued invitation becomes invalid after conversation switches, deletion, editing, swiping or a new batch', () => {
    const request = parseWechatGroupInvitations(tag())[0];
    const source = { conversationId: 'one', tavernMessageIndex: 0, swipeId: 0, batchId: 'b1' };
    const item = { request, source };
    const message = { mes: tag(), swipe_id: 0, _phone_stable_batch_id: 'b1' };
    const context = { chat: [message] };
    assert.equal(isWechatGroupInvitationCurrent(item, context, 'one'), true);
    assert.equal(isWechatGroupInvitationCurrent(item, context, 'two'), false);
    assert.equal(isWechatGroupInvitationCurrent(item, { chat: [] }, 'one'), false);
    for (const patch of [{ mes: '已移除邀请' }, { swipe_id: 1 }, { _phone_stable_batch_id: 'b2' }, { is_user: true }]) {
        assert.equal(isWechatGroupInvitationCurrent(item, { chat: [{ ...message, ...patch }] }, 'one'), false);
    }
});

for (const exact of [false, true]) {
    test(`invitation-created groups follow ${exact ? 'exact-floor replay' : 'timeline rollback'} without deleting existing groups or contacts`, () => {
        const previousWindow = globalThis.window;
        globalThis.window = { VirtualPhone: {} };
        const data = Object.create(WechatData.prototype);
        const invitation = floor => ({ fromMainChatTag: true, timelineLinked: true, tavernMessageIndex: floor, batchId: 'b' });
        data.data = {
            contacts: [{ id: 'friend', name: '阿年' }], messages: {},
            chats: [{ id: 'manual', type: 'group', unread: 3 },
                { id: 'before', type: 'group', groupInvitation: invitation(2), unread: 1 },
                { id: 'target', type: 'group', groupInvitation: invitation(4), unread: 5 },
                { id: 'after', type: 'group', groupInvitation: invitation(6), unread: 5 }]
        };
        data._messagesDirty = {};
        data.getMessages = id => data.data.messages[id] ||= [];
        data._collectRollbackPaymentTargetIds = () => new Set();
        data._rollbackWalletTransactions = () => false;
        data._cleanupManagedImagesForDeletedMessages = () => {};
        data._notifyUnreadChanged = data.saveData = data._saveMessages = () => {};
        const deleted = [];
        data.deleteChat = id => {
            const chat = data.data.chats.find(item => item.id === id);
            assert.equal(chat.unread, 0);
            deleted.push(id);
            data.data.chats = data.data.chats.filter(item => item.id !== id);
            delete data.data.messages[id];
        };
        try {
            const changed = exact ? data.removeMainChatTagMessagesAtFloor(4) : data.rollbackToFloor(4);
            assert.equal(changed, true);
            assert.deepEqual(deleted, exact ? ['target'] : ['target', 'after']);
            assert.ok(data.data.chats.some(chat => chat.id === 'manual'));
            assert.ok(data.data.chats.some(chat => chat.id === 'before'));
            assert.equal(data.data.contacts.length, 1);
        } finally { globalThis.window = previousWindow; }
    });
}

test('rendered assistant messages trigger the shared request queue and invitation markup is escaped', () => {
    const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /processWechatGroupInvitationTags\(text, \{/);
    assert.match(source, /isGroupInvitation \? '群聊邀请' : '好友申请'/);
    assert.match(source, /escapePhoneHtml\(isGroupInvitation \? request\.groupName/);
    assert.match(source, /escapePhoneHtml\(\(request\.members \|\| \[\]\)\.join\('、'\)\)/);
    assert.match(source, /acceptWechatGroupInvitation\(wechatData, request, item\.source\)/);
    assert.match(source, /acceptedWechatGroupInvitationIds\.clear\(\)/);
});
