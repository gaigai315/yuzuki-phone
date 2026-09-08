import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { ChatView } from '../apps/wechat/chat-view.js';

const phoneCssSource = fs.readFileSync(new URL('../phone.css', import.meta.url), 'utf8');
const phoneShellSource = fs.readFileSync(new URL('../phone/phone-shell.js', import.meta.url), 'utf8');
const view = Object.create(ChatView.prototype);
view._escapeHtml = value => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
view.escapeInlineStickerAttr = view._escapeHtml;

test('image prompt edits persist the user supplied generation prompt verbatim', () => {
    const patch = view._buildImagePromptEditPatch(
        { generatedImageUrl: '' },
        '角色换成蓝色连衣裙',
        '1girl, blue dress, standing, soft daylight'
    );

    assert.deepEqual(patch, {
        imageDescription: '角色换成蓝色连衣裙',
        imagePrompt: '1girl, blue dress, standing, soft daylight',
        content: '1girl, blue dress, standing, soft daylight',
        imageGenStatus: 'idle',
        imageGenerationRuntimeId: '',
        imageGenError: ''
    });
});

test('an edited English image prompt bypasses translation and remains unchanged', async () => {
    const editedPrompt = '1girl, short black hair, red coat, city street, night';
    assert.equal(await view._resolveWechatImageGenerationPrompt(editedPrompt), editedPrompt);
});

test('image prompt cards expose an edit action for both descriptions', () => {
    const html = view.renderImagePromptCard({
        id: 'image-message-1',
        type: 'image_prompt',
        mediaType: '图片',
        imageDescription: '夜晚街头的人像',
        imagePrompt: '1girl, city street, night'
    });

    assert.match(html, /message-image-prompt-edit/);
    assert.match(html, /中文描述/);
    assert.match(html, /英文Tag/);
});

test('image prompt editor is isolated from host styles and mobile swipe handling', () => {
    assert.match(phoneCssSource, /#phone-panel-content \.phone-screen \.wechat-image-prompt-editor-overlay/);
    assert.match(phoneCssSource, /textarea\.wechat-image-prompt-editor-textarea/);
    assert.match(phoneShellSource, /'\.wechat-image-prompt-editor-overlay'/);
    assert.match(phoneShellSource, /'\.wechat-image-prompt-editor-textarea'/);
});
