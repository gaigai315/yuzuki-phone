import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
    ChatView,
    WECHAT_AI_IMAGE_MAX_CHAR_BUDGET,
    WECHAT_AI_IMAGE_TOTAL_CHAR_BUDGET,
    getWechatAiImageCharLimit,
} from '../apps/wechat/chat-view.js';

const chatViewSource = fs.readFileSync(new URL('../apps/wechat/chat-view.js', import.meta.url), 'utf8');

test('wechat AI image budgets leave room below common one-megabyte relay limits', () => {
    assert.equal(getWechatAiImageCharLimit(1), WECHAT_AI_IMAGE_MAX_CHAR_BUDGET);
    assert.equal(getWechatAiImageCharLimit(4), Math.floor(WECHAT_AI_IMAGE_TOTAL_CHAR_BUDGET / 4));
    assert.ok(getWechatAiImageCharLimit(4) * 4 <= WECHAT_AI_IMAGE_TOTAL_CHAR_BUDGET);
    assert.ok(getWechatAiImageCharLimit(8) * 8 <= WECHAT_AI_IMAGE_TOTAL_CHAR_BUDGET);
});

test('oversized WeChat vision images are converted to bounded JPEG copies', async () => {
    const originalImage = globalThis.Image;
    const originalDocument = globalThis.document;
    const canvases = [];

    class MockImage {
        constructor() {
            this.naturalWidth = 2000;
            this.naturalHeight = 1500;
        }

        set src(_value) {
            queueMicrotask(() => this.onload?.());
        }
    }

    globalThis.Image = MockImage;
    globalThis.document = {
        createElement(tag) {
            assert.equal(tag, 'canvas');
            const canvas = {
                width: 0,
                height: 0,
                filled: false,
                drawn: false,
                getContext() {
                    return {
                        set fillStyle(_value) {},
                        fillRect: () => { canvas.filled = true; },
                        drawImage: () => { canvas.drawn = true; },
                    };
                },
                toDataURL(type, quality) {
                    assert.equal(type, 'image/jpeg');
                    const payloadLength = Math.ceil(canvas.width * canvas.height * quality * 0.7);
                    return `data:image/jpeg;base64,${'A'.repeat(payloadLength)}`;
                },
            };
            canvases.push(canvas);
            return canvas;
        },
    };

    try {
        const view = Object.create(ChatView.prototype);
        const result = await view._compressWechatVisionDataUrl(
            `data:image/png;base64,${'A'.repeat(900_000)}`,
            180_000
        );

        assert.match(result, /^data:image\/jpeg;base64,/);
        assert.ok(result.length <= 180_000);
        assert.ok(canvases.length >= 2);
        assert.ok(canvases.every(canvas => canvas.filled && canvas.drawn));
    } finally {
        if (originalImage === undefined) delete globalThis.Image;
        else globalThis.Image = originalImage;
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
    }
});

test('wechat vision requests keep every image and pass the per-image budget into compression', () => {
    assert.doesNotMatch(chatViewSource, /aiImageTokenIds\.length < WECHAT_AI_IMAGE_MAX_COUNT/);
    assert.doesNotMatch(chatViewSource, /已降级为文字图片标记/);
    assert.match(chatViewSource, /_resolveWechatImageForAi\(msg\.content, aiImageDataCache, \{ maxChars: aiImageCharLimit \}\)/);
    assert.match(chatViewSource, /本次图片未发送给 AI/);
    assert.match(chatViewSource, /throw new Error\(`图片压缩后仍超过中转限制/);
    assert.match(chatViewSource, /showNotification\('发送失败', errorText, '❌'\)/);
});

test('wechat vision compression fails loudly instead of silently replacing the image with text', async () => {
    const originalImage = globalThis.Image;
    const originalDocument = globalThis.document;

    class MockImage {
        constructor() {
            this.naturalWidth = 2000;
            this.naturalHeight = 1500;
        }

        set src(_value) {
            queueMicrotask(() => this.onload?.());
        }
    }

    globalThis.Image = MockImage;
    globalThis.document = {
        createElement() {
            return {
                width: 0,
                height: 0,
                getContext: () => ({ fillRect() {}, drawImage() {}, set fillStyle(_value) {} }),
                toDataURL: () => `data:image/jpeg;base64,${'A'.repeat(200_000)}`,
            };
        },
    };

    try {
        const view = Object.create(ChatView.prototype);
        await assert.rejects(
            view._compressWechatVisionDataUrl(`data:image/png;base64,${'A'.repeat(900_000)}`, 80_000),
            /图片压缩后仍超过中转限制.*本次图片未发送给 AI/
        );
    } finally {
        if (originalImage === undefined) delete globalThis.Image;
        else globalThis.Image = originalImage;
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
    }
});
