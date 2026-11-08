import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { SettingsApp } from '../apps/settings/settings-app.js';
import { TtsManager } from '../config/tts-manager.js';

const settingsSource = fs.readFileSync(new URL('../apps/settings/settings-app.js', import.meta.url), 'utf8');
const contactsSource = fs.readFileSync(new URL('../apps/wechat/contacts-view.js', import.meta.url), 'utf8');

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

test('Fish TTS uses the official browser-compatible endpoint for supported models', async () => {
    const storage = createStorage({
        'phone-tts-provider': 'fish',
        'phone-tts-fish-key': 'sk-fish-test',
        'phone-tts-fish-url': 'https://api.fish.audio/v1/tts',
        'phone-tts-fish-model': 's2.1-pro-free',
        'phone-tts-fish-voice': 'voice-model-id'
    });
    const manager = new TtsManager(storage);
    const originalFetch = globalThis.fetch;
    let request = null;

    globalThis.fetch = async (url, init = {}) => {
        request = { url: String(url), init };
        return new Response(new Uint8Array([
            0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
        ]), {
            status: 200,
            headers: { 'Content-Type': 'audio/mpeg' }
        });
    };

    try {
        const blobUrl = await manager.requestTTS('你好，Fish Audio。');
        assert.equal(request.url, 'https://api.fish.audio/compat/v1/audio/speech');
        assert.equal(request.init.headers.Authorization, 'Bearer sk-fish-test');
        assert.equal(request.init.headers.model, undefined);
        assert.deepEqual(JSON.parse(request.init.body), {
            model: 'fish-audio/s2.1-pro-free',
            input: '你好，Fish Audio。',
            voice: 'voice-model-id',
            response_format: 'mp3',
            provider: {
                options: {
                    'fish-audio': { latency: 'normal' }
                }
            }
        });
        URL.revokeObjectURL(blobUrl);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('Fish TTS normalizes official endpoints and rejects unknown official models', async () => {
    const manager = new TtsManager(createStorage({
        'phone-tts-provider': 'fish',
        'phone-tts-fish-key': 'sk-fish-test',
        'phone-tts-fish-url': 'https://api.fish.audio',
        'phone-tts-fish-model': 'typo-free-model',
        'phone-tts-fish-voice': 'voice-model-id'
    }));

    assert.deepEqual(manager._resolveFishTransport('https://api.fish.audio/v1/tts', 's2.1-pro-free'), {
        url: 'https://api.fish.audio/compat/v1/audio/speech',
        compatible: true,
        official: true
    });
    assert.deepEqual(manager._resolveFishTransport('https://api.fish.audio/compat/v1/audio/speech', 'drama-3'), {
        url: '/proxy/https://api.fish.audio/v1/tts',
        compatible: false,
        official: true
    });
    await assert.rejects(
        manager.requestTTS('不会发出请求'),
        /Fish Audio 官方模型无效：typo-free-model/
    );
});

test('Fish native-only models keep the SillyTavern proxy request format', async () => {
    const manager = new TtsManager(createStorage({
        'phone-tts-provider': 'fish',
        'phone-tts-fish-key': 'sk-fish-test',
        'phone-tts-fish-url': 'https://api.fish.audio/compat/v1/audio/speech',
        'phone-tts-fish-model': 'drama-3',
        'phone-tts-fish-voice': 'voice-model-id'
    }));
    const originalFetch = globalThis.fetch;
    let request = null;

    globalThis.fetch = async (url, init = {}) => {
        request = { url: String(url), init };
        return new Response(new Uint8Array([
            0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
        ]), {
            status: 200,
            headers: { 'Content-Type': 'audio/mpeg' }
        });
    };

    try {
        const blobUrl = await manager.requestTTS('Drama 测试。');
        assert.equal(request.url, '/proxy/https://api.fish.audio/v1/tts');
        assert.equal(request.init.headers.model, 'drama-3');
        assert.deepEqual(JSON.parse(request.init.body), {
            text: 'Drama 测试。',
            reference_id: 'voice-model-id',
            format: 'mp3',
            latency: 'normal'
        });
        URL.revokeObjectURL(blobUrl);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('Fish provider is exposed in global and per-contact TTS settings', () => {
    assert.match(settingsSource, /\{ id: 'fish', label: 'Fish Audio' \}/);
    assert.match(settingsSource, /s2\.1-pro-free（免费）/);
    assert.match(settingsSource, /Fish 音色 ID \(reference_id\)/);
    assert.match(contactsSource, /\{ id: 'fish', label: 'Fish Audio'/);
});

test('TTS URL presets only include endpoints for the selected provider', () => {
    const app = Object.create(SettingsApp.prototype);

    assert.deepEqual(app._getTtsUrlPresetOptions('fish'), [
        { value: 'https://api.fish.audio/compat/v1/audio/speech', label: 'Fish Audio 官方（兼容 TT）' }
    ]);
    assert.deepEqual(app._getTtsUrlPresetOptions('indextts').map(item => item.value), [
        'http://127.0.0.1:7880/v1/audio/speech',
        'http://127.0.0.1:9001/api/clone'
    ]);
    assert.deepEqual(app._getTtsUrlPresetOptions('nimo').map(item => item.value), [
        'https://api.xiaomimimo.com/v1',
        '__nimo_public__'
    ]);
    const fishOptions = app._renderTtsUrlPresetOptions('fish');
    assert.doesNotMatch(fishOptions, /快速选择/);
    assert.match(fishOptions, /Fish Audio 官方/);

    const indexOptions = app._renderTtsUrlPresetOptions('indextts');
    assert.match(indexOptions, /快速选择/);
    assert.match(indexOptions, /IndexTTS OpenAI 兼容版/);
    assert.match(indexOptions, /IndexTTS 雨落原生 API/);

    assert.match(settingsSource, /currentTtsUrlPresets\.length <= 1 \? 'disabled'/);
    assert.match(settingsSource, /ttsUrlPreset\.disabled = urlPresets\.length <= 1/);
    assert.match(settingsSource, /_getTtsUrlPresetOptions\(provider\)/);
});
