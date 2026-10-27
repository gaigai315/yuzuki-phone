import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
    acceptWechatFriendRequest,
    findWechatContactByExactRealName,
    parseWechatFriendRequests
} from '../apps/wechat/friend-request.js';

const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const promptSource = fs.readFileSync(new URL('../config/prompt-manager.js', import.meta.url), 'utf8');
const cssSource = fs.readFileSync(new URL('../phone.css', import.meta.url), 'utf8');
const phoneShellSource = fs.readFileSync(new URL('../phone/phone-shell.js', import.meta.url), 'utf8');

function createWechatData({ contacts = [], hiddenIds = [] } = {}) {
    const state = {
        contacts: contacts.map(contact => ({ ...contact })),
        hiddenIds: [...hiddenIds],
        chats: [],
        messages: [],
        genders: [],
        globalContacts: []
    };
    return {
        state,
        getContacts: () => state.contacts,
        getUserInfo: () => ({ offlinePromptHiddenContactIds: state.hiddenIds }),
        getOfflinePromptHiddenContactIds: () => [...state.hiddenIds],
        setOfflinePromptHiddenContactIds: ids => { state.hiddenIds = [...ids]; },
        getFirstLetter: () => 'L',
        addContact(contact) {
            state.contacts.push(contact);
            return contact;
        },
        setContactGender(id, gender) {
            state.genders.push({ id, gender });
        },
        createChat(chat) {
            state.chats.push(chat);
            return chat;
        },
        addMessage(chatId, message) {
            state.messages.push({ chatId, ...message });
            return true;
        },
        globalSocialStore: {
            upsertContact(contact) {
                state.globalContacts.push(contact);
            }
        }
    };
}

test('friend request parser supports the required same-name boundary and validates gender', () => {
    const parsed = parseWechatFriendRequests(`正文
<好友申请>
好友昵称：阿年
真实姓名：陆泽年
性别：男
申请理由：想认识你
<好友申请>
<好友申请>
好友昵称：错误项
真实姓名：无效角色
性别：未知
申请理由：
<好友申请>`);

    assert.deepEqual(parsed, [{
        nickname: '阿年',
        realName: '陆泽年',
        gender: '男',
        reason: '想认识你'
    }]);
});

test('existing contacts are matched only by exact real name and hidden contacts are restored', () => {
    const data = createWechatData({
        contacts: [{ id: 'contact-old', name: '阿年', nickname: '阿年', remark: '红毛', realName: '陆泽年' }],
        hiddenIds: ['contact-old', 'contact-other']
    });

    assert.equal(findWechatContactByExactRealName(data, '阿年'), null);
    assert.equal(findWechatContactByExactRealName(data, '红毛'), null);
    assert.equal(findWechatContactByExactRealName(data, '陆泽年')?.id, 'contact-old');

    const result = acceptWechatFriendRequest(data, {
        nickname: '新昵称不会覆盖旧资料',
        realName: '陆泽年',
        gender: '男',
        reason: ''
    });
    assert.equal(result.status, 'restored');
    assert.deepEqual(data.state.hiddenIds, ['contact-other']);
    assert.equal(data.state.contacts.length, 1);
    assert.equal(data.state.chats.length, 0);
    assert.equal(data.state.messages.length, 0);
});

test('accepting a new request creates a contact, direct chat, and gray system message', () => {
    const data = createWechatData();
    const result = acceptWechatFriendRequest(data, {
        nickname: '阿年',
        realName: '陆泽年',
        gender: '男',
        reason: '我是陆泽年'
    });

    assert.equal(result.status, 'created');
    assert.equal(data.state.contacts[0].nickname, '阿年');
    assert.equal(data.state.contacts[0].realName, '陆泽年');
    assert.equal(data.state.contacts[0].gender, 'male');
    assert.equal(data.state.contacts[0].friendRequestReason, '我是陆泽年');
    assert.equal(data.state.chats[0].contactId, data.state.contacts[0].id);
    assert.equal(data.state.messages[0].type, 'system');
    assert.equal(data.state.messages[0].from, 'system');
    assert.equal(data.state.messages[0].content, '您已通过阿年的好友申请，你们已经是好友了，可以聊天了。');
    assert.equal(data.state.globalContacts.length, 1);
});

test('both default offline prompts expose the unique request format without hiding the tag', () => {
    assert.equal((promptSource.match(/微信好友列表下显示的为当前\{\{user\}\}微信好友/g) || []).length, 2);
    assert.equal((promptSource.match(/性别只可填写男\/女/g) || []).length, 2);
    assert.equal((promptSource.match(/<好友申请>/g) || []).length, 4);
    assert.doesNotMatch(indexSource, /replace\([^\n]*好友申请/);
    assert.doesNotMatch(indexSource, /scrubTagsFromChatHistory\(\[[\s\S]*?好友申请/);
});

test('rendered assistant messages queue a scoped WeChat accept-or-reject popup', () => {
    assert.match(indexSource, /processWechatFriendRequestTags\(text, \{/);
    assert.match(indexSource, /st-phone-wechat-friend-request-title[^>]*>好友申请</);
    assert.match(indexSource, /data-action="reject"[\s\S]*?>拒绝</);
    assert.match(indexSource, /data-action="accept"[\s\S]*?>接受</);
    assert.match(indexSource, /acceptWechatFriendRequest\(wechatData, request\)/);
    assert.match(indexSource, /document\.documentElement \|\| document\.body\)\.appendChild\(overlay\)/);
    assert.match(phoneShellSource, /#st-phone-wechat-friend-request-modal/);
    assert.match(cssSource, /#st-phone-wechat-friend-request-modal\.st-phone-wechat-friend-request-modal/);
    assert.match(cssSource, /st-phone-wechat-friend-request-reason[\s\S]*?text-align: center/);
});

