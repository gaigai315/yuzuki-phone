import assert from 'node:assert/strict';
import test from 'node:test';

import { WorldbookManager } from '../config/worldbook-manager.js';

function createManager(entries, substituteParams) {
    const manager = new WorldbookManager();
    manager._getContext = () => ({ substituteParams });
    manager._loadSelectedWorldbookSources = async () => [{ entries }];
    manager.getSelectionState = () => ({ initialized: true });
    manager._resolveSourceEntrySelection = (_selection, source) => ({
        selectedEntries: source.entries,
    });
    return manager;
}

test('worldbook messages use the SillyTavern macro substitution interface', async () => {
    const calls = [];
    const manager = createManager([
        { content: '{{user}}正在联系{{char}}，状态是{{getvar::mood}}。' },
        { content: '扩展变量：{{customMacro}}' },
    ], (content) => {
        calls.push(content);
        return content
            .replaceAll('{{user}}', '测试用户')
            .replaceAll('{{char}}', '测试角色')
            .replaceAll('{{getvar::mood}}', '开心')
            .replaceAll('{{customMacro}}', '已注册');
    });

    const messages = await manager.buildWorldbookMessages('wechat');

    assert.deepEqual(messages.map((message) => message.content), [
        '测试用户正在联系测试角色，状态是开心。',
        '扩展变量：已注册',
    ]);
    assert.equal(calls.length, 2);
});

test('combined worldbook message substitutes every selected entry before joining', async () => {
    const manager = createManager([
        { content: '用户={{user}}' },
        { content: '角色={{char}}' },
    ], (content) => content
        .replaceAll('{{user}}', '用户甲')
        .replaceAll('{{char}}', '角色乙'));

    const message = await manager.buildWorldbookMessage('calendar');

    assert.equal(message.content, '用户=用户甲\n\n角色=角色乙');
});

test('worldbook macro substitution failures preserve the original entry', async () => {
    const previousWarn = console.warn;
    console.warn = () => {};
    try {
        const manager = createManager([
            { content: '保留{{brokenMacro}}原文' },
        ], () => {
            throw new Error('macro failure');
        });

        const messages = await manager.buildWorldbookMessages('games');

        assert.equal(messages[0].content, '保留{{brokenMacro}}原文');
    } finally {
        console.warn = previousWarn;
    }
});
