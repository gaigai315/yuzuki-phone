import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatView } from '../apps/wechat/chat-view.js';

for (const answer of [null, '新描述']) {
    test(`closing emoji edit with ${answer === null ? 'cancel' : 'confirm'} ignores duplicate events`, async () => {
        const previousWindow = globalThis.window;
        const originalNow = Date.now;
        let now = 10000;
        let prompts = 0;
        let updates = 0;
        let renders = 0;
        const view = Object.create(ChatView.prototype);
        view.app = {
            wechatData: {
                getCustomEmoji: () => ({ name: '表情', description: '旧描述' }),
                updateCustomEmoji: () => { updates++; }
            },
            phoneShell: { showNotification() {} },
            render: () => { renders++; }
        };
        Date.now = () => now;
        globalThis.window = { prompt: () => {
            prompts++;
            // A reentrant event while the native prompt is open is ignored.
            void view.manageCustomEmoji('emoji');
            return answer;
        } };
        try {
            await view.manageCustomEmoji('emoji');
            await view.manageCustomEmoji('emoji');
            assert.equal(prompts, 1);
            assert.equal(updates, answer === null ? 0 : 1);
            assert.equal(renders, answer === null ? 0 : 1);
            assert.equal(view._customEmojiManageBusy, false);
            now += 601;
            await view.manageCustomEmoji('emoji');
            assert.equal(prompts, 2, 'a later intentional edit remains available');
        } finally {
            Date.now = originalNow;
            globalThis.window = previousWindow;
        }
    });
}

test('renaming from the label saves the name and updates only that sticker', async () => {
    const previousWindow = globalThis.window;
    const image = { alt: '旧名字' };
    const item = { title: '旧名字', querySelector: () => image };
    const attributes = {};
    const button = {
        textContent: '旧名字',
        setAttribute: (key, value) => { attributes[key] = value; },
        closest: () => item
    };
    let savedPatch;
    const view = Object.create(ChatView.prototype);
    view.app = {
        wechatData: {
            getCustomEmoji: () => ({ name: '旧名字', description: '旧描述' }),
            updateCustomEmoji: (id, patch) => { assert.equal(id, 'emoji'); savedPatch = patch; }
        },
        phoneShell: { showNotification() {} },
        render: () => assert.fail('renaming must preserve the chat input and panel scroll position')
    };
    globalThis.window = { prompt: () => '  新名字  ' };
    try {
        await view.manageCustomEmoji('emoji', { nameButton: button });
        assert.deepEqual(savedPatch, { name: '新名字', description: '新名字' });
        assert.equal(button.textContent, '新名字');
        assert.equal(attributes['aria-label'], '修改表情名字：新名字');
        assert.equal(item.title, '新名字');
        assert.equal(image.alt, '新名字');
    } finally {
        globalThis.window = previousWindow;
    }
});
