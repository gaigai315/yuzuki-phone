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

function createView({ contacts = [], chats = [], messages = {}, userName = '用户' } = {}) {
    const view = Object.create(ChatView.prototype);
    const findContact = (value) => {
        const key = normalizeName(value);
        return contacts.find(contact => [contact.id, contact.name, contact.remark, contact.nickname]
            .some(alias => normalizeName(alias) === key)) || null;
    };

    view.app = {
        currentChat: chats[0] || null,
        wechatData: {
            getContact: id => contacts.find(contact => String(contact.id || '') === String(id || '')) || null,
            findContactByNameLoose: findContact,
            getContactByName: findContact,
            getContacts: () => contacts,
            getUserInfo: () => ({ name: userName }),
            getMessages: chatId => messages[chatId] || []
        }
    };
    view._safeGetContext = () => ({ name1: userName });
    view._readNonNegativeLimit = () => 200;
    return view;
}

test('group chat context injects another group only for actual shared friends', () => {
    const contacts = [
        { id: 'contact-a', name: '好友A' },
        { id: 'contact-b', name: '好友B' },
        { id: 'contact-c', name: '好友C' }
    ];
    const groupB = { id: 'group-b', name: '群B', type: 'group', members: ['contact-a', 'contact-b', '用户'] };
    const groupA = { id: 'group-a', name: '群A', type: 'group', members: ['好友A', 'contact-c', '用户'] };
    const groupC = { id: 'group-c', name: '群C', type: 'group', members: ['contact-c'] };
    const view = createView({
        contacts,
        chats: [groupB, groupA, groupC],
        messages: {
            'group-a': [
                { from: '好友C', type: 'text', content: '群A里的已知消息', date: '2026-10-01', time: '20:10' },
                { from: '好友A', type: 'text', content: '不应注入的隐藏消息', hiddenFromPrompt: true }
            ],
            'group-c': [{ from: '好友C', type: 'text', content: '完全无共同好友的群消息' }]
        }
    });

    const result = view._buildCrossGroupSharedHistoryContext(groupB, [groupB, groupA, groupC], { name1: '用户' }, '用户', 50);

    assert.match(result, /--- 来源群：群A ---/);
    assert.match(result, /当前群中同时属于该群的知情成员：好友A/);
    assert.match(result, /当前群中未加入该群、绝不知情的成员：好友B/);
    assert.match(result, /群A里的已知消息/);
    assert.equal(result.includes('不应注入的隐藏消息'), false);
    assert.equal(result.includes('来源群：群C'), false);
    assert.equal(result.includes('完全无共同好友的群消息'), false);
    assert.equal(result.includes('知情成员：用户'), false);
});

test('the phone user alone never makes two groups share member knowledge', () => {
    const currentGroup = { id: 'current', name: '当前群', type: 'group', members: ['好友B', '用户'] };
    const otherGroup = { id: 'other', name: '其他群', type: 'group', members: ['好友C', '用户'] };
    const view = createView({
        chats: [currentGroup, otherGroup],
        messages: { other: [{ from: '好友C', type: 'text', content: '只有用户共同在群内' }] }
    });

    assert.equal(
        view._buildCrossGroupSharedHistoryContext(currentGroup, [currentGroup, otherGroup], { name1: '用户' }, '用户', 50),
        ''
    );
});

test('cross-group permissions list every shared and unshared current-group member', () => {
    const contacts = [
        { id: 'a', name: '好友A' },
        { id: 'b', name: '好友B' },
        { id: 'c', name: '好友C' }
    ];
    const currentGroup = { id: 'current', name: '当前群', type: 'group', members: ['a', 'b', 'c'] };
    const otherGroup = { id: 'other', name: '旧群', type: 'group', members: ['好友A', '好友C'] };
    const view = createView({
        contacts,
        chats: [currentGroup, otherGroup],
        messages: {
            other: [
                { from: '好友A', type: 'text', content: '第一条' },
                { from: '好友C', type: 'text', content: '第二条' },
                { from: '好友A', type: 'text', content: '第三条' }
            ]
        }
    });

    const result = view._buildCrossGroupSharedHistoryContext(currentGroup, [currentGroup, otherGroup], null, '用户', 2);

    assert.match(result, /知情成员：好友A、好友C/);
    assert.match(result, /绝不知情的成员：好友B/);
    assert.equal(result.includes('第一条'), false);
    assert.match(result, /第二条/);
    assert.match(result, /第三条/);
});

test('cross-group history is emitted as its own system message before window isolation rules', () => {
    const relatedContextIndex = chatViewSource.indexOf("name: 'SYSTEM (跨聊天记忆)'");
    const crossGroupIndex = chatViewSource.indexOf("name: 'SYSTEM (其他共同群聊记录与知情权限)'");
    const isolationIndex = chatViewSource.indexOf("name: 'SYSTEM (窗口隔离)'");

    assert.ok(relatedContextIndex >= 0);
    assert.ok(crossGroupIndex > relatedContextIndex);
    assert.ok(isolationIndex > crossGroupIndex);
});
