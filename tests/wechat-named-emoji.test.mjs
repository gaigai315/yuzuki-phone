import assert from 'node:assert/strict';
import test from 'node:test';

import { ChatView } from '../apps/wechat/chat-view.js';

const view = Object.create(ChatView.prototype);
view.app = {
    wechatData: {
        getCustomEmojis: () => []
    }
};
view._escapeHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

test('WeChat text bubbles map bracket tokens to native assets and Twemoji', () => {
    const html = view.renderTextMessageBubble('嘿嘿，有你真好[转圈] 妈妈也是[爱心] 待会儿见[飞吻][比心][委屈]');

    assert.match(html, /alt="转圈"/);
    assert.match(html, /zhuanquan\.png/);
    assert.match(html, /alt="❤️"/);
    assert.match(html, /alt="😘"/);
    assert.match(html, /alt="🫰"/);
    assert.match(html, /alt="🥺"/);
    assert.doesNotMatch(html, /\[(?:转圈|爱心|飞吻|比心|委屈)\]/);
});

test('WeChat named emoji rendering preserves unknown tokens and escapes HTML', () => {
    const html = view.renderTextMessageBubble('普通文字[未知]<script>');

    assert.match(html, /普通文字\[未知\]&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
});
