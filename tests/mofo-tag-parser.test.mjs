import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

import { MofoData } from '../apps/mofo/mofo-data.js';
import { findMofoTagBlocks } from '../apps/mofo/mofo-tag-parser.js';

function createData(inlineRenderEnabled = false) {
    const values = new Map([['mofo_generators', [{
        id: 'custom', name: '测试状态', tagName: '测试状态',
        inlineRenderEnabled, htmlTemplate: '<p>{{value}}</p>',
        updateMode: 'replace', initialState: {}
    }]]]);
    return new MofoData({
        get: (key, fallback) => structuredClone(values.get(key) ?? fallback),
        set: (key, value) => values.set(key, structuredClone(value)),
        getStorageKey: () => 'mofo-tag-parser-test'
    });
}

const actualBlock = '<测试状态>{"value":"实际更新"}</测试状态>';
const prose = '<globalTime>09:30</globalTime>\n<details><summary>平行剧情</summary>第一段剧情</details>\n---\n<details>第二段剧情</details>';
const reasoning = '<draft_notes>正文末尾输出一个 `<测试状态>` 标签。<测试状态>{"value":"思维示例"}</测试状态></draft_notes>';
const source = `${reasoning}${prose}\n${actualBlock}`;

test('reasoning mentions cannot consume prose and block offsets refer to the original message', () => {
    const blocks = findMofoTagBlocks(source, '测试状态');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].index, source.lastIndexOf(actualBlock));
    assert.equal(blocks[0].fullMatch, actualBlock);
    assert.equal(blocks[0].payload, '{"value":"实际更新"}');
    assert.equal(source.slice(blocks[0].index, blocks[0].index + blocks[0].length), actualBlock);
});

test('all supported reasoning boundaries protect raw and escaped examples', () => {
    for (const tag of ['draft_notes', 'think', 'thinking', 'tink', 'thking']) {
        for (const escaped of [false, true]) {
            const encode = text => escaped ? text.replaceAll('<', '&lt;').replaceAll('>', '&gt;') : text;
            const notes = encode(`<${tag.toUpperCase()}>${actualBlock}<测试状态></${tag.toUpperCase()}>`);
            assert.deepEqual(findMofoTagBlocks(notes, '测试状态'), []);
            const blocks = findMofoTagBlocks(notes + prose + actualBlock, '测试状态');
            assert.equal(blocks.length, 1);
            assert.equal(blocks[0].fullMatch, actualBlock);
        }
    }
});

test('nested and unfinished reasoning does not update state during streaming', () => {
    const nested = `<think><draft_notes>${actualBlock}</draft_notes>${actualBlock}</think>`;
    assert.deepEqual(findMofoTagBlocks(nested, '测试状态'), []);
    assert.equal(findMofoTagBlocks(nested + actualBlock, '测试状态').length, 1);
    assert.deepEqual(findMofoTagBlocks(`<think>${actualBlock}`, '测试状态'), []);
    assert.deepEqual(findMofoTagBlocks(`${actualBlock}</think>`, '测试状态'), []);
    assert.equal(findMofoTagBlocks(`${actualBlock}</think>${actualBlock}`, '测试状态').length, 1);
    assert.deepEqual(findMofoTagBlocks(`<测试状态>${prose}<think>示例</think></测试状态>`, '测试状态'), []);
});

test('a newer opening prevents a stray tag from swallowing intervening prose', () => {
    const blocks = findMofoTagBlocks(`提到 <测试状态>。${prose}${actualBlock}`, '测试状态');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].fullMatch, actualBlock);
    const escaped = '&lt;信件+&gt;新内容&lt;/信件+&gt;';
    const repeated = findMofoTagBlocks(escaped + escaped, '信件+');
    assert.deepEqual(repeated.map(block => block.payload), ['新内容', '新内容']);
    assert.deepEqual(repeated.map(block => block.index), [0, escaped.length]);
});

test('detection, runtime updates, and history all ignore reasoning examples', () => {
    const data = createData();
    assert.deepEqual(data.findTagMatchesFromText(reasoning, { bubbleOnly: true }), []);
    assert.deepEqual(data.applyTagUpdatesFromText(reasoning), []);
    assert.deepEqual(data.buildItemHistoryFromTextBlocks('custom', [reasoning]), []);
    assert.equal(data.findTagBlocksFromText(source)[0].fullMatch, actualBlock);
    assert.equal(data.findTagMatchesFromText(source, { bubbleOnly: true }).length, 1);
    const updates = data.applyTagUpdatesFromText(source, { messageIndex: 3 });
    assert.equal(updates.length, 1);
    assert.equal(updates[0].state.value, '实际更新');
    const history = data.buildItemHistoryFromTextBlocks('custom', [
        { messageIndex: 2, text: reasoning }, { messageIndex: 3, text: source }
    ]);
    assert.deepEqual(history.map(entry => entry.messageIndex), [3]);
    assert.equal(history[0].payload, '{"value":"实际更新"}');
    assert.equal(history[0].state.value, '实际更新');
});

test('actual message formatting preserves both scenes in bubble and inline modes', () => {
    const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const start = indexSource.indexOf('    function prepareMofoInlineMessage(');
    const end = indexSource.indexOf('\n    function restoreMofoInlineMessage(', start);
    const data = createData();
    const context = vm.createContext({
        window: { VirtualPhone: { cachedMofoData: data } },
        getMofoInlineSnapshotState: () => null,
        getMofoRuntimeTemplateState: state => state,
        getMofoInlineScopeClass: () => 'test-scope',
        scopeMofoCss: css => css,
        escapeMofoHtml: text => text,
        createMofoInlineToken: () => 'RENDERED_CUSTOM_BLOCK'
    });
    const format = vm.runInContext(`(${indexSource.slice(start, end).trim()})`, context);
    assert.equal(format(source), `${reasoning}${prose}\n\n\n`);
    context.window.VirtualPhone.cachedMofoData = createData(true);
    const inline = format(source);
    assert.ok(inline.includes(reasoning + prose));
    assert.ok(inline.includes('RENDERED_CUSTOM_BLOCK'));
    assert.ok(!inline.includes(actualBlock));
});

test('opening a preview skips a later floor containing only reasoning examples', async () => {
    const data = createData();
    const code = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const start = code.indexOf('    async function syncMofoItemFromCurrentChat(');
    const end = code.indexOf('\n    async function ', start + 1);
    assert.ok(end > start);
    const sync = vm.runInNewContext(`(${code.slice(start, end).trim()})`, {
        getOrCreateMofoData: async () => data,
        getContext: () => ({ chat: [{ mes: actualBlock }, { mes: reasoning }] }),
        console
    });
    const item = await sync('custom');
    assert.equal(item.state.value, '实际更新');
});
