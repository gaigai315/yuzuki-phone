import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { ChatView } from '../apps/wechat/chat-view.js';

const chatViewSource = fs.readFileSync(new URL('../apps/wechat/chat-view.js', import.meta.url), 'utf8');

function normalizeName(value = '') {
    return String(value || '')
        .trim()
        .replace(/\s+/g, '')
        .replace(/[（(][^（）()]*[）)]/g, '')
        .toLowerCase();
}

function createView({ moments = [], canView = () => true } = {}) {
    const contact = {
        id: 'contact-a',
        name: '好友A',
        remark: '小A'
    };
    const chat = {
        id: 'chat-a',
        contactId: contact.id,
        name: contact.remark,
        type: 'single'
    };
    const userInfo = { name: '用户' };
    const contacts = [contact, { id: 'contact-b', name: '好友B' }];
    const findContactByNameLoose = (name) => {
        const key = normalizeName(name);
        return contacts.find(item => [item.name, item.remark, item.nickname]
            .some(alias => normalizeName(alias) === key)) || null;
    };

    const view = Object.create(ChatView.prototype);
    view.app = {
        currentChat: chat,
        wechatData: {
            getContact: id => contacts.find(item => item.id === id) || null,
            findContactByNameLoose,
            getUserInfo: () => userInfo,
            getMoments: () => moments,
            canContactViewMoment: canView
        }
    };
    view._safeGetContext = () => ({ name1: userInfo.name });
    view._readNonNegativeLimit = () => 30;
    return { view, chat, contact };
}

function createGroupView({ moments = [] } = {}) {
    const contacts = [
        { id: 'contact-a', name: '好友A', remark: '小A' },
        { id: 'contact-b', name: '好友B' },
        { id: 'contact-c', name: '好友C' },
        { id: 'contact-d', name: '群外好友' }
    ];
    const groupChat = {
        id: 'group-chat',
        name: '会所微信群',
        type: 'group',
        members: ['小A', '好友B', '好友C']
    };
    const chats = [
        groupChat,
        { id: 'chat-a', contactId: 'contact-a', name: '小A', type: 'single' },
        { id: 'chat-b', contactId: 'contact-b', name: '好友B', type: 'single' },
        { id: 'chat-d', contactId: 'contact-d', name: '群外好友', type: 'single' }
    ];
    const findContactByNameLoose = (name) => {
        const key = normalizeName(name);
        return contacts.find(item => [item.id, item.name, item.remark, item.nickname]
            .some(alias => normalizeName(alias) === key)) || null;
    };

    const view = Object.create(ChatView.prototype);
    view.app = {
        currentChat: groupChat,
        wechatData: {
            getContact: id => contacts.find(item => item.id === id) || null,
            findContactByNameLoose,
            getMessages: () => [],
            getChatList: () => chats,
            getMoments: () => moments,
            getUserInfo: () => ({ name: '用户' })
        }
    };
    view._safeGetContext = () => ({ name1: '用户' });
    view._readNonNegativeLimit = () => 30;
    return { view, groupChat };
}

test('single-chat AI context includes existing moments from the current friend', () => {
    const { view, chat } = createView({
        moments: [{
            id: 'moment-a',
            name: '好友A',
            text: '已经发布过的朋友圈内容',
            date: '2026-09-30',
            time: '10:05',
            likeList: ['用户'],
            commentList: [{ name: '用户', text: '看到了' }]
        }]
    });

    const context = view._buildSingleChatMomentsContext(chat, '用户');

    assert.match(context, /【当前单聊双方朋友圈】/);
    assert.match(context, /发布者：好友A/);
    assert.match(context, /正文：已经发布过的朋友圈内容/);
    assert.match(context, /点赞：用户/);
    assert.match(context, /- 用户：看到了/);
    assert.match(context, /严禁再次生成内容相同或高度相似的朋友圈/);
    assert.match(context, /必须省略 moments JSON/);
});

test('single-chat moments remain linked after the friend display name changes', () => {
    const { view, chat } = createView({
        moments: [{
            id: 'moment-old-name',
            name: '旧显示名',
            text: '改备注前发布的内容',
            sourceChatId: 'chat-a',
            time: '09:30'
        }]
    });

    const context = view._buildSingleChatMomentsContext(chat, '用户');

    assert.match(context, /发布者：旧显示名/);
    assert.match(context, /正文：改备注前发布的内容/);
});

test('single-chat moments exclude unrelated friends and private user posts', () => {
    const hiddenUserMoment = {
        id: 'moment-user-private',
        name: '用户',
        text: '不给当前好友看的内容'
    };
    const { view, chat } = createView({
        moments: [
            { id: 'moment-b', name: '好友B', text: '其他好友的动态' },
            hiddenUserMoment,
            { id: 'moment-a', name: '好友A', text: '当前好友的动态' }
        ],
        canView: moment => moment !== hiddenUserMoment
    });

    const context = view._buildSingleChatMomentsContext(chat, '用户');

    assert.match(context, /正文：当前好友的动态/);
    assert.equal(context.includes('其他好友的动态'), false);
    assert.equal(context.includes('不给当前好友看的内容'), false);
});

test('group-chat moments combine only current group friends into one context block', () => {
    const { view, groupChat } = createGroupView({
        moments: [
            { id: 'moment-a', name: '好友A', text: '好友A的动态', sourceChatId: 'chat-a' },
            { id: 'moment-b', name: '好友B', text: '好友B的动态', sourceChatId: 'chat-b' },
            { id: 'moment-user', name: '用户', text: '用户自己的动态' },
            { id: 'moment-outside', name: '群外好友', text: '群外好友的动态', sourceChatId: 'chat-d' }
        ]
    });

    const context = view._buildGroupChatMomentsContext(groupChat, { name1: '用户' });

    assert.match(context, /【当前微信群成员朋友圈】/);
    assert.match(context, /会所微信群/);
    assert.match(context, /命中的群好友：好友A、好友B/);
    assert.match(context, /正文：好友A的动态/);
    assert.match(context, /正文：好友B的动态/);
    assert.equal(context.includes('用户自己的动态'), false);
    assert.equal(context.includes('群外好友的动态'), false);
    assert.equal((context.match(/【当前微信群成员朋友圈】/g) || []).length, 1);
    assert.match(context, /群内其余成员不得自动知道/);
});

test('group-chat moments remain linked through the member single-chat source after a rename', () => {
    const { view, groupChat } = createGroupView({
        moments: [{
            id: 'moment-old-name',
            name: '好友A旧名',
            text: '改名之前发布的群友动态',
            sourceChatId: 'chat-a'
        }]
    });

    const context = view._buildGroupChatMomentsContext(groupChat, { name1: '用户' });

    assert.match(context, /群成员朋友圈 1（好友A）/);
    assert.match(context, /发布者：好友A旧名/);
    assert.match(context, /正文：改名之前发布的群友动态/);
});

test('group moments are emitted as one dedicated system block before WeChat history', () => {
    const contextBuildCount = (chatViewSource.match(/const groupChatMomentsContext = isGroupChat/g) || []).length;
    const systemMessageIndexes = [...chatViewSource.matchAll(/name: 'SYSTEM \(群成员朋友圈记录\)'/g)]
        .map(match => match.index);
    const wechatHistoryIndexes = [...chatViewSource.matchAll(/name: 'SYSTEM \(微信记录\)'/g)]
        .map(match => match.index);

    assert.equal(contextBuildCount, 1);
    assert.equal(systemMessageIndexes.length, 2);
    assert.equal(wechatHistoryIndexes.length, 2);
    systemMessageIndexes.forEach((messageIndex, index) => {
        assert.ok(messageIndex < wechatHistoryIndexes[index]);
    });
});
