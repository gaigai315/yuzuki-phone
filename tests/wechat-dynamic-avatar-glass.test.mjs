import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chatViewSource = fs.readFileSync(new URL('../apps/wechat/chat-view.js', import.meta.url), 'utf8');
const wechatAppSource = fs.readFileSync(new URL('../apps/wechat/wechat-app.js', import.meta.url), 'utf8');

test('the WeChat input keeps one glass layer instead of nested backdrop filters', () => {
    assert.match(chatViewSource, /class="chat-input"[\s\S]*?backdrop-filter: none !important;/);
    assert.match(wechatAppSource, /\.wechat-app \.chat-input-area \{[\s\S]*?contain: paint;/);
    assert.match(wechatAppSource, /\.wechat-app \.chat-input \{[\s\S]*?backdrop-filter: none;/);
});

test('animated avatar decorations are isolated in their own paint layer', () => {
    assert.match(wechatAppSource, /\.wechat-app \.message-avatar::after \{[\s\S]*?contain: paint;/);
    assert.match(wechatAppSource, /\.wechat-app \.message-avatar::after \{[\s\S]*?translateZ\(0\)/);
    assert.match(wechatAppSource, /\.wechat-app \.message-avatar::after \{[\s\S]*?backface-visibility: hidden;/);
});
