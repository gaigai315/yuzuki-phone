import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { TtsManager } from '../config/tts-manager.js';
import { ChatView } from '../apps/wechat/chat-view.js';

const contactsViewSource = fs.readFileSync(new URL('../apps/wechat/contacts-view.js', import.meta.url), 'utf8');

function createStorage(values = {}) {
    return {
        get(key) {
            return values[key];
        },
        async set(key, value) {
            values[key] = value;
        }
    };
}

test('MiniMax maps Cantonese aliases to Chinese,Yue', () => {
    const manager = new TtsManager(createStorage());

    assert.equal(manager._resolveMiniMaxLanguageBoost('yue'), 'Chinese,Yue');
    assert.equal(manager._resolveMiniMaxLanguageBoost('Cantonese'), 'Chinese,Yue');
    assert.equal(manager._resolveMiniMaxLanguageBoost('Chinese'), 'Chinese');
    assert.equal(manager._resolveMiniMaxLanguageBoost(''), 'auto');
});

test('MiniMax request sends the selected contact language boost', async () => {
    const storage = createStorage({
        'phone-tts-provider': 'minimax_cn',
        'phone-tts-minimax_cn-key': 'test-key',
        'phone-tts-minimax_cn-url': 'https://example.test/v1/t2a_v2',
        'phone-tts-minimax_cn-model': 'speech-2.8-hd',
        'phone-tts-minimax_cn-voice': 'YY_260505'
    });
    const manager = new TtsManager(storage);
    const originalFetch = globalThis.fetch;
    let sentBody = null;

    globalThis.fetch = async (_url, init = {}) => {
        sentBody = JSON.parse(String(init.body || '{}'));
        return new Response(JSON.stringify({
            base_resp: { status_code: 0 },
            data: { audio: '00' }
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    try {
        const blobUrl = await manager.requestTTS('今晚得唔得闲？', {
            provider: 'minimax_cn',
            voice: 'YY_260505',
            languageBoost: 'Chinese,Yue'
        });
        assert.equal(sentBody.language_boost, 'Chinese,Yue');
        URL.revokeObjectURL(blobUrl);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('contact editor exposes per-contact Mandarin and Cantonese choices', () => {
    assert.match(contactsViewSource, /id="edit-contact-tts-language-select"/);
    assert.match(contactsViewSource, /<option value="Chinese"[^>]*>普通话<\/option>/);
    assert.match(contactsViewSource, /<option value="Chinese,Yue"[^>]*>粤语<\/option>/);
    assert.match(contactsViewSource, /ttsLanguageBoost,/);
});

test('WeChat voice resolution and cache keys keep the contact language', () => {
    const view = Object.create(ChatView.prototype);
    view.app = {
        wechatData: {
            resolveTtsVoiceByName() {
                return {
                    voice: 'YY_260505',
                    provider: 'minimax_cn',
                    languageBoost: 'Chinese,Yue',
                    contact: { id: 'contact-cantonese' }
                };
            }
        }
    };

    const resolved = view._resolveWechatBoundVoiceByName('阿明');
    assert.equal(resolved.languageBoost, 'Chinese,Yue');

    const mandarinKey = view._buildWechatTtsCacheKey({
        messageId: 'msg-1',
        provider: 'minimax_cn',
        voice: 'YY_260505',
        languageBoost: 'Chinese',
        text: '今晚得唔得闲？'
    });
    const cantoneseKey = view._buildWechatTtsCacheKey({
        messageId: 'msg-1',
        provider: 'minimax_cn',
        voice: 'YY_260505',
        languageBoost: 'Chinese,Yue',
        text: '今晚得唔得闲？'
    });

    assert.notEqual(mandarinKey, cantoneseKey);
});
