import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { WorldbookManager } from '../config/worldbook-manager.js';

const worldbookSource = fs.readFileSync(new URL('../config/worldbook-manager.js', import.meta.url), 'utf8');
const phoneCssSource = fs.readFileSync(new URL('../phone.css', import.meta.url), 'utf8');

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

test('shared worldbook entry dialog searches titles and full content', () => {
    assert.match(worldbookSource, /placeholder="搜索条目名称或内容"/);
    assert.match(worldbookSource, /normalizeSearchText\(\[entry\.comment \|\| `条目 \$\{index \+ 1\}`, entry\.content\]\.join\('\\n'\)\)/);
    assert.match(worldbookSource, /row\.hidden = !matches/);
    assert.match(worldbookSource, /找到 \$\{visibleCount\} 条条目/);
    assert.match(worldbookSource, /getVisibleChoices\(\)\.forEach/);
    assert.match(worldbookSource, /全选筛选结果/);
    assert.match(phoneCssSource, /\.phone-worldbook-entry-row\[hidden\]/);
    assert.match(phoneCssSource, /\.phone-worldbook-entry-search-wrap/);
});

test('worldbook selectors reuse cached reads without flooding successful book logs', () => {
    assert.match(worldbookSource, /force:\s*options\.force === true/);
    assert.match(worldbookSource, /this\._listPromises\.has\(requestKey\)/);
    assert.doesNotMatch(worldbookSource, /世界书读取结果/);
});
