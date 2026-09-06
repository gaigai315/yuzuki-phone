import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getPhoneInlineEmoji,
    renderPhoneInlineEmoji,
    replacePhoneInlineEmojiTokens
} from '../config/phone-emoji.js';

test('dog head token resolves to the bundled WebP asset', () => {
    const emoji = getPhoneInlineEmoji('[狗头]');

    assert.equal(emoji?.name, '狗头');
    assert.match(emoji?.image || '', /assets\/emoji\/goutou\.webp$/);
});

test('dog head token renders as a small inline image', () => {
    const html = replacePhoneInlineEmojiTokens('真的很合理[狗头]', {
        size: 16,
        className: 'weibo-inline-emoji'
    });

    assert.match(html, /^真的很合理<img /);
    assert.match(html, /alt="狗头"/);
    assert.match(html, /width:16px;height:16px/);
    assert.match(html, /weibo-inline-emoji/);
});

test('unknown tokens and plain text are preserved', () => {
    assert.equal(replacePhoneInlineEmojiTokens('普通文字[未知]'), '普通文字[未知]');
    assert.equal(renderPhoneInlineEmoji('[未知]'), '');
});
