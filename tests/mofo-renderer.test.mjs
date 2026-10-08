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
    assert.equal(inlineItem.inlineRenderEnabled, true);
    assert.deepEqual(
        source.findTagMatchesFromText(
            '<气泡模板>气泡内容</气泡模板><正文模板>正文内容</正文模板>',
            { bubbleOnly: true }
        ).map(item => item.id),
        ['bubble-template']
    );

    const payload = source.buildExportPayload(['bubble-template', 'inline-template']);
    assert.deepEqual(payload.items.map(item => item.inlineRenderEnabled), [false, true]);

    const restored = new MofoData(createStorage());
    restored.importItemsFromPayload(payload);
    assert.equal(restored.getItemById('bubble-template').inlineRenderEnabled, false);
    assert.equal(restored.getItemById('inline-template').inlineRenderEnabled, true);
});

test('forum import template hides duplicate comment totals and visible floor labels', () => {
    const payload = JSON.parse(fs.readFileSync(new URL('../forum-mofo-v2.json', import.meta.url), 'utf8'));
    const template = payload.items[0];

    assert.match(template.htmlTemplate, /<div class="forum-mofo-comments-title">全部评论<\/div>/);
    assert.doesNotMatch(template.htmlTemplate, /forum-mofo-floor|\{\{floorLabel\}\}/);
    assert.doesNotMatch(template.cssText, /forum-mofo-floor|forum-mofo-comment-head/);
});

test('CSS scoping keeps media rules and confines selectors to one render surface', () => {
    const css = scopeMofoCss('.forum-card{color:red}@media(max-width:430px){.forum-card,.forum-title{font-size:14px}}', '.scope-one');
    assert.match(css, /\.scope-one \.forum-card\{color:red\}/);
    assert.match(css, /@media\(max-width:430px\)\{\.scope-one \.forum-card, \.scope-one \.forum-title\{font-size:14px\}\}/);
});
