import assert from 'node:assert/strict';
import test from 'node:test';

import { ChatView } from '../apps/wechat/chat-view.js';

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
