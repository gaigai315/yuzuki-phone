import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
    buildWechatCharacterCardInfo,
    formatWechatTavernContextContent
} from '../apps/wechat/chat-view.js';

const chatViewSource = fs.readFileSync(new URL('../apps/wechat/chat-view.js', import.meta.url), 'utf8');

test('a character card with only a name does not create a role-card information message', () => {
    assert.equal(buildWechatCharacterCardInfo({ name: '苏冉' }), '');
});

test('character card information excludes the card name and keeps actual profile fields', () => {
    const result = buildWechatCharacterCardInfo({
        name: '苏冉',
        description: '主角的完整人物描述',
        personality: '冷静，敏锐',
        scenario: '现代都市背景',
        data: {
            system_prompt: '始终保持人物关系连续。'
        }
    });

    assert.equal(result, [
        '【角色卡信息】',
        '主角的完整人物描述',
        '性格: 冷静，敏锐',
        '场景/背景: 现代都市背景',
        '',
        '始终保持人物关系连续。'
    ].join('\n'));
    assert.equal(result.includes('角色名:'), false);
    assert.equal(result.includes('描述:'), false);
    assert.equal(result.includes('苏冉'), false);
});

test('a character card system prompt can be injected without other profile fields', () => {
    assert.equal(
        buildWechatCharacterCardInfo({ name: '苏冉', data: { system_prompt: '只保留有效角色卡内容。' } }),
        '【角色卡信息】\n只保留有效角色卡内容。'
    );
});

test('blank character card fields are treated as empty content', () => {
    assert.equal(buildWechatCharacterCardInfo({
        name: '苏冉',
        description: '   ',
        personality: '\n',
        scenario: '',
        data: { system_prompt: '\t' }
    }), '');
});

test('WeChat prompt orders role card, user profile, worldbook, then history boundary', () => {
    const roleCardIndex = chatViewSource.indexOf("name: 'SYSTEM (角色卡)'");
    const userProfileIndex = chatViewSource.indexOf("name: 'SYSTEM (用户Persona)'");
    const worldbookIndex = chatViewSource.indexOf("appendWorldbookMessages?.(messages, 'wechat')");
    const historyBoundaryIndex = chatViewSource.indexOf("content: '[Start a new chat]'");

    assert.ok(roleCardIndex >= 0);
    assert.ok(userProfileIndex > roleCardIndex);
    assert.ok(worldbookIndex > userProfileIndex);
    assert.ok(historyBoundaryIndex > worldbookIndex);
});

test('assistant messages from the tavern context keep their original body without a character-name prefix', () => {
    assert.equal(
        formatWechatTavernContextContent('<globalTime>正文内容</globalTime>', {
            isUser: false,
            userName: 'yuzuki'
        }),
        '<globalTime>正文内容</globalTime>'
    );
});

test('user messages from the tavern context keep the existing user-name prefix', () => {
    assert.equal(
        formatWechatTavernContextContent('继续测试', {
            isUser: true,
            userName: 'yuzuki'
        }),
        'yuzuki: 继续测试'
    );
});
