import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { MofoData } from '../apps/mofo/mofo-data.js';
import {
    combineMofoBeautifyTemplate,
    parseForumPayload,
    parseStructuredPayload,
    renderMofoTemplate,
    scopeMofoCss,
    splitMofoBeautifyTemplate
} from '../apps/mofo/mofo-renderer.js';

const forumPayload = `<主题>
标题：新人请教积分怎么花
发布人：宋清秋
日期：刚刚 · 来自 移动终端
内容：第一段正文。
第二段正文包含 <script>alert(1)</script>。
点赞：14
转发：3
</主题>
<评论区>
1L:[工区老张：普通工人一个月也就攒三四百点。|5分钟前|赞 38]
回复[工区老张]:[湖畔文员：确实不少。|3分钟前|赞 4]
2L:[工区老张：同名用户的第二条主评论。|2分钟前|赞 9]
回复2L[工区老张]:[纠察老李：这条应归到二楼。|刚刚|赞 2]
</评论区>`;

function createStorage(items = []) {
    const values = new Map([
        ['mofo_generators', items],
        ['chat_mofo_runtime_states', {}],
        ['mofo_deleted_item_ids', []]
    ]);
    return {
        get(key, fallback) {
            return values.has(key) ? structuredClone(values.get(key)) : fallback;
        },
        set(key, value) {
            values.set(key, structuredClone(value));
        },
        getStorageKey() {
            return 'mofo-renderer-test';
        }
    };
}

test('forum parser reads multiline topics and attaches nested replies to the correct floor', () => {
    const parsed = parseForumPayload(forumPayload);

    assert.equal(parsed.topic.title, '新人请教积分怎么花');
    assert.equal(parsed.topic.author, '宋清秋');
    assert.equal(parsed.topic.authorInitial, '宋');
    assert.match(parsed.topic.content, /第一段正文。\n第二段正文/);
    assert.equal(parsed.topic.likes, 14);
    assert.equal(parsed.topic.reposts, 3);
    assert.equal(parsed.commentCount, 2);
    assert.equal(parsed.comments[0].replies[0].author, '湖畔文员');
    assert.equal(parsed.comments[0].replies[0].targetFloor, 1);
    assert.equal(parsed.comments[1].replies[0].author, '纠察老李');
    assert.equal(parsed.comments[1].replies[0].targetFloor, 2);
});

test('template renderer escapes normal variables and supports nested each/if blocks', () => {
    const state = parseForumPayload(forumPayload);
    const template = `<h1>{{topic.title}}</h1>
<div>{{topic.content}}</div>
{{#if comments}}{{#each comments}}<article>{{floorLabel}} {{author}}{{#each replies}}<p>{{author}} 回复 {{replyTo}}：{{content}}</p>{{/each}}</article>{{/each}}{{else}}空{{/if}}`;
    const html = renderMofoTemplate(template, state);

    assert.match(html, /<h1>新人请教积分怎么花<\/h1>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /1L 工区老张/);
    assert.match(html, /湖畔文员 回复 工区老张：确实不少。/);
    assert.doesNotMatch(html, /<script>/);
});

test('registered custom templates render their own payload instead of latest runtime state', () => {
    const data = new MofoData(createStorage([{
        id: 'forum-v2',
        name: '论坛',
        tagName: '论坛',
        parserMode: 'forum',
        inlineRenderEnabled: true,
        updateMode: 'replace',
        htmlTemplate: '<h1>{{topic.title}}</h1>{{#each comments}}<p>{{floorLabel}} {{content}}</p>{{/each}}',
        cssText: '.forum-card{color:red}',
        initialState: {}
    }]));
    const blocks = data.findTagBlocksFromText(`剧情正文\n<论坛>${forumPayload}</论坛>`, { inlineOnly: true });
    const rendered = data.renderTagBlock(blocks[0]);

    assert.equal(blocks.length, 1);
    assert.equal(rendered.state.topic.title, '新人请教积分怎么花');
    assert.match(rendered.html, /<h1>新人请教积分怎么花<\/h1>/);
    assert.match(rendered.html, /2L 同名用户的第二条主评论。/);
});

test('importing a new template replaces an older definition with the same tag', () => {
    const data = new MofoData(createStorage([{
        id: 'forum-old',
        name: '旧论坛',
        tagName: '论坛',
        parserMode: 'auto',
        inlineRenderEnabled: true,
        htmlTemplate: '<div>旧模板</div>',
        initialState: {},
        createdAt: 1,
        updatedAt: 1
    }]));
    const result = data.importItemsFromPayload({
        type: 'virtual_phone_mofo_templates',
        version: 2,
        items: [{
            id: 'forum-new',
            name: '论坛',
            tagName: '论坛',
            parserMode: 'forum',
            inlineRenderEnabled: true,
            htmlTemplate: '<h1>{{topic.title}}</h1>',
            initialState: {},
            createdAt: 2,
            updatedAt: 2
        }]
    });

    assert.equal(result.replacedCount, 1);
    assert.equal(result.importedCount, 1);
    assert.deepEqual(data.getItems().map(item => item.id), ['forum-new']);
    assert.equal(data.findTagBlocksFromText(`<论坛>${forumPayload}</论坛>`).length, 1);
});

test('generic structured parser supports custom child sections, fields, and numbered lists', () => {
    const parsed = parseStructuredPayload(`<档案>\n姓名：林秋\n身份：调查员\n</档案>\n<记录>\n1项:[抵达基地|清晨]\n2项:[领取装备|上午]\n</记录>`);

    assert.equal(parsed.档案.姓名, '林秋');
    assert.equal(parsed.档案.身份, '调查员');
    assert.equal(parsed.记录.items[0].label, '1项');
    assert.deepEqual(parsed.记录.items[1].parts, ['领取装备', '上午']);
    assert.match(
        renderMofoTemplate('{{档案.姓名}}{{#each 记录.items}}<p>{{label}} {{parts.0}}</p>{{/each}}', parsed),
        /林秋<p>1项 抵达基地<\/p><p>2项 领取装备<\/p>/
    );
});

test('auto parser recognizes forum, structured, key-value, and single-content payloads', () => {
    const data = new MofoData(createStorage());
    const item = {
        id: 'auto-template',
        name: '自动模板',
        tagName: '自动模板',
        parserMode: 'auto',
        initialState: {}
    };

    const forum = data.parsePayloadForItem(item, forumPayload, {});
    assert.equal(forum.topic.title, '新人请教积分怎么花');
    assert.equal(forum.comments[0].replies[0].author, '湖畔文员');

    const structured = data.parsePayloadForItem(item, '<档案>\n姓名：林秋\n身份：调查员\n</档案>', {});
    assert.equal(structured.档案.姓名, '林秋');

    const fields = data.parsePayloadForItem(item, '标题：测试标题\n作者：测试作者', {});
    assert.equal(fields.标题, '测试标题');
    assert.equal(fields.作者, '测试作者');

    const content = data.parsePayloadForItem(item, '这是一整段不带字段的内容。', {});
    assert.equal(content.content, '这是一整段不带字段的内容。');
});

test('combined beautify editor round-trips CSS and HTML without losing template variables', () => {
    const combined = combineMofoBeautifyTemplate('<article>{{topic.title}}</article>', '.forum{color:red}');
    assert.match(combined, /^<style>[\s\S]*\.forum\{color:red\}[\s\S]*<\/style>/);

    const split = splitMofoBeautifyTemplate(combined);
    assert.equal(split.cssText, '.forum{color:red}');
    assert.equal(split.htmlTemplate, '<article>{{topic.title}}</article>');
});

test('initial state stays optional for pure templates and remains supported when imported', () => {
    const data = new MofoData(createStorage());
    const pure = data.createItem({
        id: 'pure-template',
        name: '纯美化',
        tagName: '纯美化',
        htmlTemplate: '<div>{{content}}</div>'
    });
    const stateful = data.createItem({
        id: 'stateful-template',
        name: '状态模板',
        tagName: '状态模板',
        initialState: { title: '默认标题' },
        htmlTemplate: '<div>{{title}}</div>'
    });

    assert.deepEqual(pure.initialState, {});
    assert.equal(pure.inlineRenderEnabled, false);
    assert.deepEqual(stateful.initialState, { title: '默认标题' });
});

test('display mode defaults to bubble and survives template export and import', () => {
    const source = new MofoData(createStorage());
    const bubbleItem = source.createItem({
        id: 'bubble-template',
        name: '气泡模板',
        tagName: '气泡模板',
        htmlTemplate: '<div>{{content}}</div>'
    });
    const inlineItem = source.createItem({
        id: 'inline-template',
        name: '正文模板',
        tagName: '正文模板',
        inlineRenderEnabled: true,
        htmlTemplate: '<div>{{content}}</div>'
    });

    assert.equal(bubbleItem.inlineRenderEnabled, false);
    assert.equal(bubbleItem.bubbleRenderEnabled, true);
    assert.equal(inlineItem.inlineRenderEnabled, true);
    assert.equal(inlineItem.bubbleRenderEnabled, false);
    assert.deepEqual(
        source.findTagMatchesFromText(
            '<气泡模板>气泡内容</气泡模板><正文模板>正文内容</正文模板>',
            { bubbleOnly: true }
        ).map(item => item.id),
        ['bubble-template']
    );

    const payload = source.buildExportPayload(['bubble-template', 'inline-template']);
    assert.deepEqual(payload.items.map(item => item.inlineRenderEnabled), [false, true]);
    assert.deepEqual(payload.items.map(item => item.bubbleRenderEnabled), [true, false]);

    const restored = new MofoData(createStorage());
    restored.importItemsFromPayload(payload);
    assert.equal(restored.getItemById('bubble-template').inlineRenderEnabled, false);
    assert.equal(restored.getItemById('inline-template').inlineRenderEnabled, true);
});

test('inline and bubble rendering are mutually exclusive even for legacy dual-mode data', () => {
    const combinations = [
        { id: 'bubble-only', inlineRenderEnabled: false, bubbleRenderEnabled: true },
        { id: 'both', inlineRenderEnabled: true, bubbleRenderEnabled: true },
        { id: 'inline-only', inlineRenderEnabled: true, bubbleRenderEnabled: false },
        { id: 'hidden', inlineRenderEnabled: false, bubbleRenderEnabled: false }
    ];
    const data = new MofoData(createStorage(combinations.map((item) => ({
        ...item,
        name: item.id,
        tagName: item.id,
        htmlTemplate: '<div>{{value}}</div>',
        initialState: { value: item.id }
    }))));

    combinations.forEach((expected) => {
        const item = data.getItemById(expected.id);
        assert.equal(item.inlineRenderEnabled, expected.inlineRenderEnabled);
        assert.equal(item.bubbleRenderEnabled, !expected.inlineRenderEnabled);
        const source = `<${expected.id}>value：updated</${expected.id}>`;
        const block = data.findTagBlocksFromText(source)[0];
        assert.equal(!!data.renderTagBlock(block), expected.inlineRenderEnabled);
        assert.equal(
            data.findTagMatchesFromText(source, { bubbleOnly: true }).length > 0,
            !expected.inlineRenderEnabled
        );
    });
});

test('fund processor accumulates signed transactions with stable floor ids and exact cents', () => {
    const data = new MofoData(createStorage([{
        id: 'funds',
        name: '资金管理系统',
        tagName: '资金管理系统',
        processorMode: 'funds',
        parserMode: 'auto',
        updateMode: 'append',
        inlineRenderEnabled: true,
        bubbleRenderEnabled: true,
        bubbleHistoryEnabled: false,
        initialState: {
            角色姓名: '陆沉',
            货币名称: '魔晶',
            初始资金: 1000,
            收支记录: []
        }
    }]));

    data.applyTagUpdatesFromText(`<资金管理系统>
日期：2077-10-26
时间：18:03
本次收支：+500.10
收支事由：出售附魔匕首
</资金管理系统>`, { messageIndex: 4 });

    let state = data.getItemById('funds').state;
    assert.equal(state.当前资金, 1500.1);
    assert.equal(state.当前资金显示, '1,500.10');
    assert.equal(state.累计收入, 500.1);
    assert.equal(state.累计支出, 0);
    assert.equal(state.收支记录.length, 1);
    assert.equal(state.收支记录[0].id, 'fund_4_0');
    assert.equal(state.收支记录[0].收入显示, '+500.10');
    assert.equal(state.收支记录[0].支出显示, '--');

    data.applyTagUpdatesFromText(`<资金管理系统>
日期：2077-10-26
时间：18:03
本次收支：+450.05
收支事由：重新生成后的出售收益
</资金管理系统>`, { messageIndex: 4 });

    state = data.getItemById('funds').state;
    assert.equal(state.当前资金, 1450.05);
    assert.equal(state.收支记录.length, 1);
    assert.equal(state.收支记录[0].事由, '重新生成后的出售收益');

    data.applyTagUpdatesFromText(`<资金管理系统>
日期：2077-10-27
时间：09:15
本次收支：-120.15
收支事由：委托手续费
</资金管理系统>`, { messageIndex: 6 });

    state = data.getItemById('funds').state;
    assert.equal(state.当前资金, 1329.9);
    assert.equal(state.累计收入, 450.05);
    assert.equal(state.累计支出, 120.15);
    assert.equal(state.日期分组.length, 2);
    assert.equal(state.日期分组[0].日期, '2077-10-27');
    assert.equal(state.日期分组[1].日期, '2077-10-26');
    assert.equal(state.日期分组[0].记录[0].结余, 1329.9);
    assert.equal(state.日期分组[0].记录[0].收入显示, '--');
    assert.equal(state.日期分组[0].记录[0].支出显示, '-120.15');
});

test('fund history keeps per-floor balance snapshots and rebuild removes deleted future records', () => {
    const data = new MofoData(createStorage([{
        id: 'funds',
        name: '资金管理系统',
        tagName: '资金管理系统',
        processorMode: 'funds',
        updateMode: 'append',
        inlineRenderEnabled: true,
        bubbleRenderEnabled: true,
        bubbleHistoryEnabled: false,
        initialState: { 货币名称: '黑币', 初始资金: 1000, 收支记录: [] }
    }]));
    const first = '<资金管理系统>日期：2077-10-26\n时间：10:00\n本次收支：+500\n收支事由：收款</资金管理系统>';
    const second = '<资金管理系统>日期：2077-10-27\n时间：11:00\n本次收支：-120\n收支事由：手续费</资金管理系统>';

    const history = data.buildItemHistoryFromTextBlocks('funds', [
        { messageIndex: 2, text: first },
        { messageIndex: 5, text: second }
    ]);
    assert.deepEqual(history.map(entry => entry.state.当前资金), [1500, 1380]);
    assert.deepEqual(history.map(entry => entry.state.流水数量), [1, 2]);

    data.rebuildSessionStateFromTextBlocks([
        { messageIndex: 2, text: first }
    ]);
    const rebuilt = data.getItemById('funds').state;
    assert.equal(rebuilt.当前资金, 1500);
    assert.equal(rebuilt.流水数量, 1);
    assert.equal(rebuilt.收支记录[0].id, 'fund_2_0');
});

test('fund processor replaces every transaction from a regenerated floor', () => {
    const data = new MofoData(createStorage([{
        id: 'funds',
        name: '资金管理系统',
        tagName: '资金管理系统',
        processorMode: 'funds',
        initialState: { 初始资金: 100, 收支记录: [] }
    }]));
    data.applyTagUpdatesFromText(
        '<资金管理系统>本次收支：+10\n收支事由：第一笔</资金管理系统>'
        + '<资金管理系统>本次收支：+20\n收支事由：第二笔</资金管理系统>',
        { messageIndex: 8, messageDateTime: '2077-10-26 10:00' }
    );
    assert.deepEqual(data.getItemById('funds').state.收支记录.map(item => item.id), ['fund_8_0', 'fund_8_1']);

    data.applyTagUpdatesFromText(
        '<资金管理系统>本次收支：-5\n收支事由：重新生成后仅一笔</资金管理系统>',
        { messageIndex: 8, messageDateTime: '2077-10-26 10:01' }
    );
    const state = data.getItemById('funds').state;
    assert.equal(state.流水数量, 1);
    assert.equal(state.当前资金, 95);
    assert.equal(state.收支记录[0].id, 'fund_8_0');
    assert.equal(state.收支记录[0].事由, '重新生成后仅一笔');
});

test('fund-only rebuild clears a transaction when regeneration removes the tag', () => {
    const data = new MofoData(createStorage([{
        id: 'funds',
        name: '资金管理系统',
        tagName: '资金管理系统',
        processorMode: 'funds',
        initialState: { 初始资金: 100, 收支记录: [] }
    }]));
    const tagged = '<资金管理系统>本次收支：+25\n收支事由：临时收入</资金管理系统>';
    data.rebuildProcessorSessionStateFromTextBlocks('funds', [
        { messageIndex: 3, text: tagged, messageDateTime: '2077-10-26 10:00' }
    ]);
    assert.equal(data.getItemById('funds').state.当前资金, 125);

    data.rebuildProcessorSessionStateFromTextBlocks('funds', [
        { messageIndex: 3, text: '重新生成后的正文不再包含资金标签。' }
    ]);
    const state = data.getItemById('funds').state;
    assert.equal(state.当前资金, 100);
    assert.equal(state.流水数量, 0);
});

test('fund import template defaults to forum-style bubble mode and keeps an optional inline view', () => {
    const payload = JSON.parse(fs.readFileSync(new URL('../资金管理系统-魔坊模板.json', import.meta.url), 'utf8'));
    const template = payload.items[0];

    assert.equal(template.processorMode, 'funds');
    assert.equal(template.inlineRenderEnabled, false);
    assert.equal(template.bubbleRenderEnabled, true);
    assert.equal(template.bubbleHistoryEnabled, false);
    assert.match(template.htmlTemplate, /CURRENT BALANCE \/ 当前资金/);
    assert.match(template.bubbleHtmlTemplate, /CHARACTER FINANCE PROFILE/);
    assert.match(template.bubbleHtmlTemplate, /TRANSACTION RECORDS/);
    assert.match(template.bubbleHtmlTemplate, /fund-mofo-table-header/);
    assert.match(template.bubbleHtmlTemplate, /\{\{#if 用户头像\}\}<img src="\{\{用户头像\}\}"/);
    assert.match(template.bubbleHtmlTemplate, /\{\{收入显示\}\}/);
    assert.match(template.bubbleHtmlTemplate, /\{\{支出显示\}\}/);
    assert.match(template.bubbleHtmlTemplate, /\{\{#each 日期分组\}\}/);
    assert.match(template.promptTemplate, /禁止自行计算或输出当前资金/);
    assert.doesNotMatch(template.promptTemplate, /角色头像/);
    assert.equal(Object.prototype.hasOwnProperty.call(template.initialState, '角色头像'), false);
});

test('forum import template hides duplicate comment totals and visible floor labels', () => {
    const payload = JSON.parse(fs.readFileSync(new URL('../forum-mofo-v2.json', import.meta.url), 'utf8'));
    const template = payload.items[0];

    assert.match(template.htmlTemplate, /<div class="forum-mofo-comments-title">全部评论<\/div>/);
    assert.doesNotMatch(template.htmlTemplate, /forum-mofo-floor|\{\{floorLabel\}\}/);
    assert.doesNotMatch(template.cssText, /forum-mofo-floor|forum-mofo-comment-head/);
});

test('CSS scoping keeps media rules and confines selectors to one render surface', () => {
    const css = scopeMofoCss('.forum-card{color:red}\n@media(max-width:430px){.forum-card,.forum-title{font-size:14px}}', '.scope-one');
    assert.match(css, /\.scope-one \.forum-card\{color:red\}/);
    assert.match(css, /@media\(max-width:430px\)\{\.scope-one \.forum-card, \.scope-one \.forum-title\{font-size:14px\}\}/);
    assert.doesNotMatch(css, /\.scope-one\s+@media/);
});

test('fund import template remains valid after inline CSS scoping', () => {
    const payload = JSON.parse(fs.readFileSync(new URL('../资金管理系统-魔坊模板.json', import.meta.url), 'utf8'));
    const template = payload.items[0];
    const css = scopeMofoCss(template.cssText, '.fund-inline-scope');

    assert.match(css, /@media\(max-width:760px\)\{\.fund-inline-scope \.fund-mofo-ledger/);
    assert.match(css, /@media\(max-width:480px\)\{\.fund-inline-scope \.fund-mofo-ledger/);
    assert.match(css, /@media\(max-width:340px\)\{\.fund-inline-scope \.fund-mofo-profile/);
    assert.doesNotMatch(css, /\.fund-inline-scope\s+@(?:media|supports|container|keyframes)/);
    assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length);
});
