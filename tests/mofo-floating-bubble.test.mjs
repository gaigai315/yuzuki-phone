import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { MofoData } from '../apps/mofo/mofo-data.js';

function createStorage(items) {
    const values = new Map([
        ['mofo_generators', items],
        ['chat_mofo_runtime_states', {}],
        ['mofo_deleted_item_ids', []]
    ]);
    return {
        get(key, fallback) {
            return values.has(key) ? values.get(key) : fallback;
        },
        set(key, value) {
            values.set(key, value);
        },
        getStorageKey() {
            return 'mofo-floating-bubble-test';
        }
    };
}

test('Mofo tag detection finds registered tags without changing runtime state', () => {
    const storage = createStorage([
        { id: 'forum', name: '论坛', tagName: '论坛', updateMode: 'replace', initialState: {} },
        { id: 'mail', name: '信件+', tagName: '信件+', updateMode: 'replace', initialState: {} }
    ]);
    const data = new MofoData(storage);

    assert.deepEqual(
        data.findTagMatchesFromText('正文\n<论坛>{"title":"新帖"}</论坛>'),
        [{ id: 'forum', name: '论坛', tagName: '论坛', changed: false }]
    );
    assert.deepEqual(
        data.findTagMatchesFromText('正文\n&lt;信件+&gt;内容&lt;/信件+&gt;'),
        [{ id: 'mail', name: '信件+', tagName: '信件+', changed: false }]
    );
    assert.deepEqual(data.findTagMatchesFromText('只有正文，没有魔坊标签。'), []);
    assert.deepEqual(storage.get('chat_mofo_runtime_states', {}), {});
});

test('Mofo parsing follows the configured tag name exactly', () => {
    const storage = createStorage([
        { id: 'profile', name: '人物资料', tagName: '档案', updateMode: 'replace', initialState: {} }
    ]);
    const data = new MofoData(storage);

    assert.deepEqual(data.findTagMatchesFromText('<人物资料>姓名：错误</人物资料>'), []);
    assert.deepEqual(
        data.findTagMatchesFromText('<档案>姓名：林秋</档案>'),
        [{ id: 'profile', name: '人物资料', tagName: '档案', changed: false }]
    );

    const updates = data.applyTagUpdatesFromText('<档案>姓名：林秋</档案>');
    assert.equal(updates.length, 1);
    assert.equal(data.getItemById('profile').state.姓名, '林秋');
});

test('Mofo bubble history skips floors without the matching tag', () => {
    const storage = createStorage([
        {
            id: 'forum',
            name: '论坛',
            tagName: '论坛',
            parserMode: 'forum',
            updateMode: 'replace',
            inlineRenderEnabled: false,
            initialState: {}
        }
    ]);
    const data = new MofoData(storage);
    const forumPayload = (title) => `<论坛>
<主题>
标题：${title}
发布人：测试员
日期：刚刚
内容：正文
点赞：1
转发：0
</主题>
<评论区></评论区>
</论坛>`;

    const history = data.buildItemHistoryFromTextBlocks('forum', [
        { messageIndex: 2, text: forumPayload('第二楼帖子') },
        { messageIndex: 3, text: '这一楼没有论坛标签。' },
        { messageIndex: 4, text: '这一楼也没有。' },
        { messageIndex: 5, text: '继续剧情。' },
        { messageIndex: 6, text: forumPayload('第六楼帖子') }
    ]);

    assert.deepEqual(history.map(entry => entry.messageIndex), [2, 6]);
    assert.equal(history[0].state.topic.title, '第二楼帖子');
    assert.equal(history[1].state.topic.title, '第六楼帖子');
    assert.deepEqual(storage.get('chat_mofo_runtime_states', {}), {});
});

test('Mofo bubble history restores accumulated custom template state for each tagged floor', () => {
    const storage = createStorage([
        {
            id: 'custom-list',
            name: '自定义列表',
            tagName: '自定义列表',
            updateMode: 'append',
            inlineRenderEnabled: false,
            initialState: { items: [] }
        }
    ]);
    const data = new MofoData(storage);
    const history = data.buildItemHistoryFromTextBlocks('custom-list', [
        { messageIndex: 2, text: '<自定义列表>{"items":[{"id":"a","text":"旧内容"}]}</自定义列表>' },
        { messageIndex: 6, text: '<自定义列表>{"items":[{"id":"b","text":"新内容"}]}</自定义列表>' }
    ]);

    assert.deepEqual(history[0].state.items.map(item => item.id), ['a']);
    assert.deepEqual(history[1].state.items.map(item => item.id), ['a', 'b']);
    assert.deepEqual(storage.get('chat_mofo_runtime_states', {}), {});
});

test('Mofo editor uses the list enable toggle without a duplicate prompt checkbox', () => {
    const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

    assert.match(source, /class="mofo-offline-toggle"[\s\S]*?<span>启用<\/span>/);
    assert.doesNotMatch(source, /id="mofo-editor-parser"/);
    assert.doesNotMatch(source, /parserInput/);
    assert.match(source, /id="mofo-editor-beautify-template"/);
    assert.doesNotMatch(source, /id="mofo-editor-html-template"|id="mofo-editor-css"/);
    assert.match(source, /class="mofo-editor-default-data"[\s\S]*?默认数据（可选）[\s\S]*?id="mofo-editor-initial"/);
    assert.match(source, /class="mofo-editor-default-data" \$\{oldInitial \? 'open' : ''\}/);
    assert.match(source, /const oldInlineRenderEnabled = current\?\.inlineRenderEnabled === true;/);
    assert.match(source, /在酒馆正文中显示（勾选后不显示悬浮气泡）/);
    assert.doesNotMatch(source, /id="mofo-editor-offline-enabled"/);
    assert.doesNotMatch(source, /offlineEnabledInput/);
});

test('Mofo preview click keeps the floating bubble and refreshes preview data', () => {
    const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const clickStart = source.indexOf('            bubble.onclick = () => {');
    const clickEnd = source.indexOf('\n            };', clickStart);
    const clickSource = source.slice(clickStart, clickEnd);

    assert.ok(clickStart >= 0 && clickEnd > clickStart);
    assert.match(clickSource, /getItemById\?\.\(mofoId\)/);
    assert.doesNotMatch(clickSource, /hideBubble|burstBubble|bubble\.remove\(\)/);
    assert.match(source, /findTagMatchesFromText\(snapshot\.text, \{ bubbleOnly: true \}\)/);
    assert.match(source, /item\?\.inlineRenderEnabled === false/);
    assert.match(source, /const blocks = mofoData\.findTagBlocksFromText\(source\);/);
    assert.match(source, /block\?\.item\?\.inlineRenderEnabled !== true[\s\S]*?output = `\$\{output\.slice\(0, block\.index\)\}\\n\\n\$\{output\.slice\(block\.index \+ block\.length\)\}`/);
    assert.match(source, /syncMofoBubbleFromLatestMessage/);
    assert.match(source, /rebuildMofoStateAndSyncBubble/);
});

test('Mofo bubble preview pages through tagged floors and reopens on the latest one', () => {
    const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

    assert.match(source, /function getMofoBubbleHistory\(mofoData, mofoId\)/);
    assert.match(source, /buildItemHistoryFromTextBlocks\(mofoId, textBlocks\)/);
    assert.match(source, /let activeHistoryIndex = history\.length - 1;/);
    assert.match(source, /class="mofo-history-button mofo-history-prev"[\s\S]*?上一楼/);
    assert.match(source, /class="mofo-history-button mofo-history-next"[\s\S]*?下一楼/);
    assert.match(source, /activeHistoryIndex -= 1;[\s\S]*?renderActiveHistory\(\)/);
    assert.match(source, /activeHistoryIndex \+= 1;[\s\S]*?renderActiveHistory\(\)/);
    assert.match(source, /historyNav\.hidden = history\.length <= 1;/);
    assert.match(source, /historyContent\.innerHTML = renderPreviewState\(entry\?\.state \|\| \{\}\)/);
    assert.match(source, /pop\.appendChild\(historyContent\);\s*pop\.appendChild\(historyNav\);/);
    assert.match(source, /historyCount\.textContent = Number\.isInteger\(entry\?\.messageIndex\)[\s\S]*?`第\$\{entry\.messageIndex\}楼`/);
    assert.doesNotMatch(source, /\$\{activeHistoryIndex \+ 1\}\/\$\{history\.length\}/);
});

test('Mofo forum preview has readable but bounded mobile sizing', () => {
    const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

    assert.match(source, /#mofo-global-preview-pop \.forum-mofo \{[\s\S]*?width: min\(340px, calc\(100vw - 28px\)\) !important;/);
    assert.match(source, /#mofo-global-preview-pop \.forum-mofo-title \{[\s\S]*?font-size: 15px !important;/);
    assert.match(source, /#mofo-global-preview-pop \.forum-mofo-content,[\s\S]*?font-size: 11\.5px !important;/);
    assert.match(source, /#mofo-global-preview-pop \.mofo-history-content \{[\s\S]*?scrollbar-width: none;[\s\S]*?-ms-overflow-style: none;/);
    assert.match(source, /#mofo-global-preview-pop \.mofo-history-content::\-webkit-scrollbar \{[\s\S]*?display: none;/);
});

test('Mofo quick panel keeps its headers fixed while only Mofo content scrolls', () => {
    const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const phoneShellSource = fs.readFileSync(new URL('../phone/phone-shell.js', import.meta.url), 'utf8');

    assert.match(source, /#phone-inline-reply-menu-pop \.inline-reply-page\[data-tab-page="mofo"\] \{\s*overflow: hidden;/);
    assert.match(source, /#phone-inline-reply-menu-pop \.mofo-page-layout \{[\s\S]*?display: flex;[\s\S]*?flex-direction: column;[\s\S]*?height: 100%;/);
    assert.match(source, /#phone-inline-reply-menu-pop \.mofo-page-fixed-head \{[\s\S]*?flex: 0 0 auto;/);
    assert.match(source, /#phone-inline-reply-menu-pop \.mofo-page-scroll-body \{[\s\S]*?flex: 1 1 auto;[\s\S]*?overflow-y: auto;/);
    assert.match(source, /<div class="mofo-page-layout">[\s\S]*?<div class="inline-reply-section-title mofo-page-fixed-head">[^<]+<\/div>[\s\S]*?<div class="mofo-page-scroll-body">/);
    assert.match(source, /class="inline-reply-section-title mofo-page-fixed-head"[\s\S]*?id="mofo-detail-back-btn"/);
    assert.match(source, /class="inline-reply-section-title mofo-page-fixed-head"[\s\S]*?class="mofo-editor-back-btn"/);

    assert.match(source, /<div class="inline-reply-page is-active" data-tab-page="wechat">\$\{buildWechatListHtml\(\)\}<\/div>/);
    assert.match(source, /<div class="inline-reply-page" data-tab-page="sms">\$\{buildSmsListHtml\(\)\}<\/div>/);
    assert.doesNotMatch(source, /data-tab-page="(?:wechat|sms)"[^>]*mofo-page-/);
    assert.match(phoneShellSource, /'\.inline-reply-page', '\.mofo-page-scroll-body'/);
});
