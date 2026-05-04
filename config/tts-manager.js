/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * ⚠️ 版权声明 (Copyright Notice):
 * 1. 禁止商业化：本项目仅供交流学习，严禁任何形式的倒卖、盈利等商业行为。
 * 2. 禁止二改发布：严禁未经授权修改代码后作为独立项目二次发布或分发。
 * 3. 禁止抄袭：严禁盗用本项目的核心逻辑、UI设计与相关原代码。
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */
export class TtsManager {
    constructor(storage) {
        this.storage = storage;
    }

    _getProviderDefaults(provider) {
        const defaults = {
            minimax_cn: {
                url: 'https://api.minimaxi.com/v1/t2a_v2',
                model: 'speech-02-hd',
                voice: 'female-shaonv'
            },
            minimax_intl: {
                url: 'https://api.minimax.chat/v1/t2a_v2',
                model: 'speech-02-hd',
                voice: 'female-shaonv'
            },
            openai: {
                url: 'https://api.openai.com/v1/audio/speech',
                model: 'tts-1',
                voice: 'alloy'
            },
            volcengine: {
                url: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
                model: 'seed-tts-2.0',
                voice: 'BV700_streaming'
            }
        };
        return defaults[provider] || defaults.minimax_cn;
    }

    _getProviderConfigKey(provider, field) {
        return `phone-tts-${provider}-${field}`;
    }

    _getStoredProviderValue(provider, field, legacyKey = '') {
        const scoped = String(this.storage?.get?.(this._getProviderConfigKey(provider, field)) || '').trim();
        if (scoped) return scoped;
        const globalProvider = String(this.storage?.get?.('phone-tts-provider') || 'minimax_cn').trim() || 'minimax_cn';
        if (legacyKey && provider === globalProvider) {
            return String(this.storage?.get?.(legacyKey) || '').trim();
        }
        return '';
    }

    _resolveConfig(options = {}) {
        const provider = String(options.provider || this.storage?.get?.('phone-tts-provider') || 'minimax_cn').trim() || 'minimax_cn';
        const defaults = this._getProviderDefaults(provider);
        const apiKey = this._getStoredProviderValue(provider, 'key', 'phone-tts-key');
        const apiUrl = this._getStoredProviderValue(provider, 'url', 'phone-tts-url') || defaults.url || '';
        const model = this._getStoredProviderValue(provider, 'model', 'phone-tts-model') || defaults.model || '';
        const globalVoice = this._getStoredProviderValue(provider, 'voice', 'phone-tts-voice') || defaults.voice || '';
        const voice = String(options.voice || globalVoice || '').trim();
        const appId = this._getStoredProviderValue(provider, 'app-id', 'phone-tts-volc-app-id');
        const resourceId = this._getStoredProviderValue(provider, 'resource-id', 'phone-tts-volc-resource-id') || 'seed-tts-2.0';
        return {
            provider,
            apiKey,
            apiUrl,
            model,
            voice,
            appId,
            resourceId
        };
    }

    async requestTTS(text, options = {}) {
        const inputText = String(text || '').trim();
        if (!inputText) throw new Error('TTS 文本为空');

        const config = this._resolveConfig(options);
        const { provider, apiKey, apiUrl, model, voice, appId, resourceId } = config;
        if (!apiKey || !apiUrl) {
            throw new Error('请先配置 TTS 的 API URL 和 API Key / Access Token');
        }
        if (!voice) {
            throw new Error('缺少音色参数 voice');
        }

        if (provider.startsWith('minimax')) {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model || 'speech-02-hd',
                    text: inputText,
                    stream: false,
                    voice_setting: { voice_id: voice || 'female-shaonv', speed: 1.0, vol: 1.0, pitch: 0 },
                    audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3' }
                })
            });
            if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

            const resData = await response.json();
            if (resData?.base_resp?.status_code !== 0) {
                throw new Error(resData?.base_resp?.status_msg || 'MiniMax请求失败');
            }
            const hexAudio = String(resData?.data?.audio || '').trim();
            if (!hexAudio) throw new Error('TTS 未返回音频数据');

            const bytes = new Uint8Array(Math.ceil(hexAudio.length / 2));
            for (let i = 0; i < bytes.length; i++) {
                bytes[i] = Number.parseInt(hexAudio.substr(i * 2, 2), 16);
            }
            const blob = new Blob([bytes], { type: 'audio/mp3' });
            return URL.createObjectURL(blob);
        }

        if (provider === 'volcengine') {
            if (!appId) throw new Error('请先配置火山引擎 APP ID');
            if (!resourceId) throw new Error('请先配置火山引擎 Resource ID');

            const requestedUrl = String(apiUrl || '').trim();
            const requestPayload = {
                user: {
                    uid: 'virtual_phone_user'
                },
                req_params: {
                    text: inputText,
                    speaker: voice || 'BV700_streaming',
                    audio_params: {
                        format: 'mp3',
                        sample_rate: 24000
                    },
                    additions: JSON.stringify({
                        context_texts: []
                    })
                }
            };

            let response = await fetch(requestedUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Api-App-Key': appId,
                    'X-Api-Access-Key': apiKey,
                    'X-Api-Resource-Id': resourceId
                },
                body: JSON.stringify(requestPayload)
            });
            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                if (response.status === 401) {
                    throw new Error(`HTTP 401 鉴权失败，请核对 APP ID / API Key / Resource ID（当前 APP ID=${appId}, Resource ID=${resourceId}）${errorText ? `：${errorText}` : ''}`);
                }
                throw new Error(`HTTP ${response.status}${errorText ? `：${errorText}` : ''}`);
            }
            if (!response.body) throw new Error('火山引擎返回为空');

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            const chunks = [];
            let totalLen = 0;
            let done = false;
            let buffer = '';

            while (!done) {
                const read = await reader.read();
                done = !!read.done;
                if (read.value) {
                    buffer += decoder.decode(read.value, { stream: !done });
                } else if (done) {
                    buffer += decoder.decode();
                }

                const lines = buffer.split('\n');
                if (!done) buffer = lines.pop() || '';
                else buffer = '';

                for (const rawLine of lines) {
                    const line = String(rawLine || '').trim();
                    if (!line) continue;
                    let data = null;
                    try {
                        data = JSON.parse(line);
                    } catch (_e) {
                        continue;
                    }

                    const code = Number(data?.code || 0);
                    if (code === 0 && data?.data) {
                        const bytes = Uint8Array.from(atob(String(data.data)), c => c.charCodeAt(0));
                        chunks.push(bytes);
                        totalLen += bytes.length;
                    } else if (code === 20000000) {
                        done = true;
                        break;
                    } else if (code > 0) {
                        throw new Error(data?.message || `火山引擎返回异常 code=${code}`);
                    }
                }
            }

            if (totalLen <= 0) throw new Error('火山引擎未返回音频数据');

            const merged = new Uint8Array(totalLen);
            let offset = 0;
            for (const chunk of chunks) {
                merged.set(chunk, offset);
                offset += chunk.length;
            }
            const blob = new Blob([merged.buffer], { type: 'audio/mp3' });
            return URL.createObjectURL(blob);
        }

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model || 'tts-1',
                input: inputText,
                voice: voice || 'alloy'
            })
        });
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    }
}
