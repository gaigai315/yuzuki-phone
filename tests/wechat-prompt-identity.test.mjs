import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { resolveWechatPromptIdentity } from '../apps/wechat/chat-view.js';

const chatViewSource = fs.readFileSync(new URL('../apps/wechat/chat-view.js', import.meta.url), 'utf8');

test('single-chat prompt identity uses the current WeChat window name instead of the character card name', () => {
    const identity = resolveWechatPromptIdentity(
        { id: 'contact-1', name: '方彤彤', type: 'single' },
        {
            characterId: 0,
            name2: '锁情咒',
            characters: [{ name: '锁情咒' }]
        }
    );

    assert.deepEqual(identity, {
        chatName: '方彤彤',
        cardName: '锁情咒',
        characterName: '方彤彤'
    });
});

test('group-chat prompt keeps the character-card identity separate from the group window name', () => {
    const identity = resolveWechatPromptIdentity(
        { id: 'group-1', name: '周末聚会群', type: 'group' },
        {
            characterId: 0,
            name2: '锁情咒',
            characters: [{ name: '锁情咒' }]
        }
    );

    assert.deepEqual(identity, {
        chatName: '周末聚会群',
        cardName: '锁情咒',
        characterName: '锁情咒'
    });
});

test('group-chat prompt falls back to the group window name when no character card is active', () => {
    const identity = resolveWechatPromptIdentity(
        { id: 'group-1', name: '周末聚会群', type: 'group' },
        { name2: 'SillyTavern System' }
    );

    assert.deepEqual(identity, {
        chatName: '周末聚会群',
        cardName: '周末聚会群',
        characterName: '周末聚会群'
    });
});

test('role information and sender fallbacks are wired to the resolved WeChat identity', () => {
    assert.match(chatViewSource, /角色名: \$\{charName\}/);
    assert.doesNotMatch(chatViewSource, /角色名: \$\{char\.name \|\| charName\}/);
    assert.match(chatViewSource, /const fallbackSender = savedChatName \|\| context\.name2;/);
    assert.doesNotMatch(chatViewSource, /const fallbackSender = context\.name2 \|\| savedChatName;/);
});
