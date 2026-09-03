import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chatViewSource = fs.readFileSync(new URL('../apps/wechat/chat-view.js', import.meta.url), 'utf8');
const phoneShellSource = fs.readFileSync(new URL('../phone/phone-shell.js', import.meta.url), 'utf8');

test('wechat emoji tabs expose interactive semantics for mobile webviews', () => {
    assert.match(chatViewSource, /class="emoji-tabs" role="tablist"/);
    assert.match(chatViewSource, /data-tab="default" role="tab" tabindex="0"/);
    assert.match(chatViewSource, /data-tab="custom" role="tab" tabindex="0"/);
});

test('custom emoji manager switches away from the default tab before opening', () => {
    assert.match(
        chatViewSource,
        /if \(this\.emojiTab !== 'custom'\) \{\s*this\.emojiTab = 'custom';\s*this\.customEmojiManageMenuOpen = true;\s*this\.app\.render\(\);\s*return;/
    );
    assert.match(chatViewSource, /aria-expanded="\$\{this\.customEmojiManageMenuOpen \? 'true' : 'false'\}"/);
    assert.match(chatViewSource, /this\.customEmojiManageMenuOpen = isOpen;/);
});

test('global touch handling exempts interactive controls and the emoji panel', () => {
    assert.match(phoneShellSource, /\[role="tab"\]/);
    assert.match(phoneShellSource, /resolveGestureControlHost\(target\) \|\| resolveInteractiveHost\(target\)/);
    assert.match(phoneShellSource, /'\.emoji-panel', '\.emoji-scroll'/);
});

test('an empty custom emoji collection renders a visible empty state', () => {
    assert.match(chatViewSource, /customEmojis\.length === 0/);
    assert.match(chatViewSource, /还没有添加表情/);
});
