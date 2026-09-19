import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { ChatView } from '../apps/wechat/chat-view.js';
import {
    parseWechatInnerThoughtContent,
    parseWechatTranslationContent,
    parseWechatVoiceContent,
    stripWechatTranslationContent,
    stripWechatTtsNonSpeechContent
} from '../apps/wechat/voice-text.js';

const wechatAppSource = fs.readFileSync(new URL('../apps/wechat/wechat-app.js', import.meta.url), 'utf8');
const view = Object.create(ChatView.prototype);
view._escapeHtml = value => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
view.escapeInlineStickerAttr = view._escapeHtml;
view.parseEmoji = value => view._escapeHtml(value);

test('wechat translation marker stays visible but is removed from speech text', () => {
    const parsed = parseWechatTranslationContent('Are you there?[翻译：在么？]');

    assert.equal(parsed.displayText, 'Are you there?[翻译：在么？]');
    assert.equal(parsed.speechText, 'Are you there?');
    assert.equal(parsed.translationText, '在么？');
});

test('translation parsing accepts fullwidth brackets and colon', () => {
    assert.equal(
        stripWechatTranslationContent('まだ起きてる？【翻译：还醒着吗？】'),
        'まだ起きてる？'
    );
});

test('voice content keeps the translation for display but exposes original-only TTS text', () => {
    const parsed = parseWechatVoiceContent('（こんにちは、まだ起きてる？[翻译：你好，还醒着吗？]）');

    assert.equal(parsed.voiceText, 'こんにちは、まだ起きてる？[翻译：你好，还醒着吗？]');
    assert.equal(parsed.ttsText, 'こんにちは、まだ起きてる？');
    assert.equal(parsed.translationText, '你好，还醒着吗？');
});

test('multiple translation markers are excluded from TTS without changing ordinary text', () => {
    assert.equal(stripWechatTranslationContent('Hello[翻译：你好] world[翻译：世界]'), 'Hello world');
    assert.equal(stripWechatTranslationContent('普通中文和 English 都保留'), '普通中文和 English 都保留');
});

test('inner thought stays available for rendering but is excluded from TTS', () => {
    const source = 'I miss you.[翻译: 我想你。][内心]（明明才分开不到十分钟。）';
    const parsed = parseWechatInnerThoughtContent(source);

    assert.equal(parsed.visibleContent, 'I miss you.[翻译: 我想你。]');
    assert.equal(parsed.innerThought, '明明才分开不到十分钟。');
    assert.equal(stripWechatTtsNonSpeechContent(source), 'I miss you.');
});

test('call TTS excludes translation, inner thought, and offline status tags together', () => {
    assert.equal(
        stripWechatTtsNonSpeechContent("I'm downstairs.[翻译: 我到楼下了。][内心]（想见她。）[转线下]"),
        "I'm downstairs."
    );
});

test('translated chat text renders original above the translated text without a fold by default', () => {
    const html = view.renderTextMessageBubble(
        "Whatever you want to test, I'm always right here with you.[翻译: 无论你想测什么，我都一直在这里陪着你。]"
    );

    assert.match(html, /wechat-translation-card/);
    assert.match(html, /wechat-translation-source/);
    assert.match(html, /wechat-translation-heart/);
    assert.match(html, /wechat-translation-target/);
    assert.equal(html.includes('[翻译:'), false);
    assert.equal(html.includes('wechat-inner-os-fold'), false);
    assert.ok(html.indexOf('Whatever you want') < html.indexOf('无论你想测什么'));
});

test('translated chat text shows the fold and inner-thought popup only when inner thought exists', () => {
    const html = view.renderTextMessageBubble(
        'まだ起きてる？[翻译: 还醒着吗？][内心]（其实只是想再听你说一句话。）'
    );

    assert.match(html, /wechat-inner-os-fold/);
    assert.match(html, /wechat-inner-os-popup/);
    assert.match(html, /其实只是想再听你说一句话。/);
    assert.equal(html.includes('[内心]'), false);
});

test('group chat translation also shows a fold whenever inner thought exists', () => {
    const html = view.renderTextMessageBubble(
        'See you later.[翻译: 回头见。][内心]（希望他会留下。）',
        { isGroupChat: true }
    );

    assert.match(html, /wechat-inner-os-fold/);
    assert.match(html, /希望他会留下。/);
});

test('live call bubbles use the compact call translation layout and keep inner thought off the speech face', () => {
    const plainSpeech = view._renderWechatCallAiBubbleMarkup({
        text: '今晚早点休息。',
        bubbleId: 'call-plain',
        callType: 'voice'
    });
    const withoutThought = view._renderWechatCallAiBubbleMarkup({
        text: 'Are you there?[翻译: 在么？]',
        bubbleId: 'call-a',
        callType: 'voice'
    });
    const withThought = view._renderWechatCallAiBubbleMarkup({
        text: 'おやすみ。[翻译: 晚安。][内心]（不想挂断。）',
        bubbleId: 'call-b',
        callType: 'video'
    });

    assert.match(withoutThought, /wechat-call-translation-card/);
    assert.match(withoutThought, /wechat-call-translation-source/);
    assert.match(withoutThought, /<div class="wechat-call-translation-source">Are you there\?<span class="wechat-call-speech-wave"/);
    assert.match(withoutThought, /wechat-call-translation-target/);
    assert.match(withoutThought, /wechat-call-translation-label">翻译：/);
    assert.match(withoutThought, /wechat-call-speech-wave/);
    assert.match(plainSpeech, /wechat-call-spoken-bubble/);
    assert.match(plainSpeech, /wechat-call-speech-wave/);
    assert.equal(withoutThought.includes('wechat-translation-heart'), false);
    assert.equal(withoutThought.includes('wechat-translation-badge'), false);
    assert.equal(withoutThought.includes('wechat-inner-os-fold'), false);
    assert.match(withThought, /wechat-inner-os-fold/);
    assert.match(withThought, /wechat-inner-os-popup/);
    assert.ok(withThought.indexOf('おやすみ。') < withThought.indexOf('晚安。'));
    assert.equal(withThought.includes('[内心]（不想挂断。）</div>'), false);
});

test('plain Chinese text retains the original WeChat bubble appearance', () => {
    const html = view.renderTextMessageBubble('今天天气真好');

    assert.match(html, /class="message-text"/);
    assert.equal(html.includes('wechat-translation-card'), false);
    assert.equal(html.includes('wechat-inner-os-fold'), false);
});

test('translation card styling uses frosted glass, a dashed divider, and a lower-right heart', () => {
    assert.match(wechatAppSource, /\.wechat-translation-card \{[\s\S]*?backdrop-filter: blur\(14px\)/);
    assert.match(wechatAppSource, /\.wechat-translation-target \{[\s\S]*?border-top: 1px dashed/);
    assert.match(wechatAppSource, /\.wechat-translation-target \{[\s\S]*?grid-template-columns: 16px minmax\(0, 1fr\)/);
    assert.match(wechatAppSource, /\.wechat-translation-badge \{[\s\S]*?width: 14px;[\s\S]*?height: 13px;/);
    assert.match(wechatAppSource, /\.wechat-translation-heart \{[\s\S]*?right: 14px;[\s\S]*?bottom: 8px;/);
});

test('call translation styling uses a compact lower translation strip without chat decorations', () => {
    assert.match(wechatAppSource, /\.wechat-call-translation-card \{[\s\S]*?background: rgba\(255, 255, 255, 0\.84\)/);
    assert.match(wechatAppSource, /\.wechat-call-translation-target \{[\s\S]*?background: rgba\(234, 231, 228, 0\.82\)/);
    assert.match(wechatAppSource, /\.wechat-call-translation-card\.wechat-inner-os-bubble \.wechat-call-translation-target \{[\s\S]*?padding-right: 22px;/);
    assert.match(wechatAppSource, /\.wechat-call-speech-wave \{[\s\S]*?width: 18px;[\s\S]*?height: 14px;/);
    assert.match(wechatAppSource, /\.wechat-call-speech-wave i:nth-child\(3\) \{[\s\S]*?height: 14px;/);
});
