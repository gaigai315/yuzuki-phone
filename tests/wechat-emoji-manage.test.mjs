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
