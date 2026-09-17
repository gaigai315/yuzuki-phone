import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { WeiboData } from '../apps/weibo/weibo-data.js';

const viewSource = fs.readFileSync(new URL('../apps/weibo/weibo-view.js', import.meta.url), 'utf8');
const cssSource = fs.readFileSync(new URL('../apps/weibo/weibo.css', import.meta.url), 'utf8');
const phoneShellSource = fs.readFileSync(new URL('../phone/phone-shell.js', import.meta.url), 'utf8');

test('Weibo parse failures preserve raw and filtered AI responses', () => {
    const data = Object.create(WeiboData.prototype);
    data._lastAIResponse = {
        rawText: '<Weibo>原始微博正文</Weibo>',
        cleanedText: '过滤后只剩普通正文'
    };

    const error = data._createParseFailureError({
        kind: '推荐微博',
        parsedText: '过滤后只剩普通正文',
        expectedFormat: '<Weibo>...</Weibo>',
        expectedPattern: /<\s*Weibo\s*>[\s\S]*?<\s*\/\s*Weibo\s*>/i
    });

    assert.equal(error.weiboParseFailure.kind, '推荐微博');
    assert.equal(error.weiboParseFailure.rawText, '<Weibo>原始微博正文</Weibo>');
    assert.equal(error.weiboParseFailure.cleanedText, '过滤后只剩普通正文');
    assert.equal(error.weiboParseFailure.rawHasExpected, true);
    assert.equal(error.weiboParseFailure.cleanedHasExpected, false);
});

test('Weibo parse failures still report malformed content without a saved raw response', () => {
    const data = Object.create(WeiboData.prototype);
    data._lastAIResponse = null;

    const error = data._createParseFailureError({
        parsedText: '{"comments": [}',
        expectedFormat: 'JSON（comments）',
        expectedPattern: /\{[\s\S]*\}/
    });

    assert.equal(error.weiboParseFailure.rawText, '{"comments": [}');
    assert.equal(error.weiboParseFailure.cleanedText, '{"comments": [}');
    assert.equal(error.weiboParseFailure.rawHasExpected, true);
    assert.equal(error.weiboParseFailure.cleanedHasExpected, true);
});

test('Weibo parse diagnostics expose the response in a scoped scrollable modal', () => {
    assert.match(viewSource, /_showAIParseFailure\(error\)/);
    assert.match(viewSource, /模型原始回复/);
    assert.match(viewSource, /标签过滤后内容/);
    assert.match(viewSource, /class="weibo-ai-parse-error-response"/);

    assert.match(
        cssSource,
        /#phone-panel-content \.phone-screen \.weibo-ai-parse-error-body\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?touch-action:\s*pan-y;[\s\S]*?overscroll-behavior:\s*contain;/
    );
    assert.match(
        cssSource,
        /#phone-panel-content \.phone-screen \.weibo-ai-parse-error-response\s*\{[\s\S]*?overflow:\s*auto;[\s\S]*?touch-action:\s*pan-y;[\s\S]*?overscroll-behavior:\s*contain;/
    );
    assert.match(phoneShellSource, /'\.weibo-ai-parse-error-body'/);
    assert.match(phoneShellSource, /'\.weibo-ai-parse-error-response'/);
});
