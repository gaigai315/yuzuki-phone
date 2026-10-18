import test from 'node:test';
import assert from 'node:assert/strict';

import { buildInlineReplyWechatList } from '../apps/wechat/inline-reply-order.js';

test('inline reply follows chat order before appending remaining contacts', () => {
    const contacts = [
        { id: 'a', name: '通讯录甲', avatar: '/a.png' },
        { id: 'b', name: '常聊乙', avatar: '/b.png' },
        { id: 'c', name: '置顶丙', avatar: '/c.png' },
        { id: 'd', name: '通讯录丁', avatar: '/d.png' }
    ];
    const chats = [
        { id: 'chat-b', contactId: 'b', name: '旧备注乙', type: 'single', timestamp: 300 },
        { id: 'group-1', name: '常用群', type: 'group', timestamp: 250 },
        { id: 'chat-c', contactId: 'c', name: '置顶丙', type: 'single', timestamp: 100, pinnedAt: 10 }
    ];

    const result = buildInlineReplyWechatList(contacts, chats, (id, avatar) => avatar || `/auto/${id}.png`);

    assert.deepEqual(result.map(item => item.name), ['置顶丙', '常聊乙', '常用群', '通讯录甲', '通讯录丁']);
    assert.deepEqual(result.map(item => item.chatType), ['single', 'single', 'group', 'single', 'single']);
    assert.equal(result[1].avatar, '/b.png');
});

test('inline reply matches legacy single chats by id or contact name without duplicates', () => {
    const contacts = [
        { id: 'same-id', name: '按ID匹配' },
        { id: 'name-id', name: '按名字匹配' }
    ];
    const chats = [
        { id: 'same-id', name: '旧名字', type: 'single', timestamp: 20 },
        { id: 'legacy-chat', name: '按名字匹配', type: 'single', timestamp: 10 },
        { id: 'duplicate', contactId: 'same-id', name: '按ID匹配', type: 'single', timestamp: 5 }
    ];

    const result = buildInlineReplyWechatList(contacts, chats);
    assert.deepEqual(result.map(item => item.name), ['按ID匹配', '按名字匹配']);
});
