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
        const scopedUrl = this._getStoredProviderValue(provider, 'url');
        const legacyUrl = this._getStoredProviderValue(provider, 'url', 'phone-tts-url');
        const apiUrl = scopedUrl || (provider === 'volcengine' ? defaults.url : legacyUrl) || defaults.url || '';
        const scopedModel = this._getStoredProviderValue(provider, 'model');
        const legacyModel = this._getStoredProviderValue(provider, 'model', 'phone-tts-model');
        const model = scopedModel || (provider === 'volcengine' ? defaults.model : legacyModel) || defaults.model || '';
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

    _isVolcClonedVoiceId(voice = '') {
        return /^S_[A-Za-z0-9_-]+$/.test(String(voice || '').trim());
    }

    _resolveVolcResourceId(resourceId = '', voice = '') {
        const safeResourceId = String(resourceId || '').trim() || 'seed-tts-2.0';
        if (this._isVolcClonedVoiceId(voice) && /^seed-tts-/i.test(safeResourceId)) {
            return 'seed-icl-2.0';
        }
        return safeResourceId;
    }

    _resolveVolcCloneResourceId(modelType = '4') {
        return String(modelType || '4') === '4' ? 'seed-icl-2.0' : 'seed-icl-1.0';
    }

    _readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const raw = String(reader.result || '');
                resolve(raw.includes(',') ? raw.split(',').pop() : raw);
            };
            reader.onerror = () => reject(reader.error || new Error('音频文件读取失败'));
            reader.readAsDataURL(file);
        });
    }

    _formatVolcCloneError(data = {}) {
        const base = data?.BaseResp || {};
        const code = base.StatusCode ?? data?.code ?? 'N/A';
        let message = base.StatusMessage || data?.message || '未知错误';
        const codeHints = {
            1106: 'Speaker ID 重复',
            1107: 'Speaker ID 未找到',
            1111: '音频无人声',
            1122: '未检测到人声',
            1123: '已达上传限制'
        };
        if (codeHints[code]) message += `（${codeHints[code]}）`;
        return `豆包音色复刻失败：${message}，code=${code}`;
    }

    _normalizeVolcAccessToken(accessToken = '') {
        return String(accessToken || '').trim().replace(/^Bearer\s*;?\s*/i, '');
    }

    async cloneVolcVoice(options = {}) {
        const accessToken = this._normalizeVolcAccessToken(options.accessToken || options.apiKey || '');
        const appId = String(options.appId || '').trim();
        const speakerId = String(options.speakerId || '').trim();
        const workerUrl = String(options.workerUrl || '').trim().replace(/\/+$/, '');
        const audioFile = options.audioFile;
        const modelType = String(options.modelType || '4');
        const language = String(options.language || '0');

        if (!accessToken) throw new Error('缺少豆包 Access Token');
        if (!appId) throw new Error('缺少火山 APP ID');
        if (!speakerId) throw new Error('缺少 Speaker ID');
        if (!audioFile) throw new Error('请选择用于复刻的音频文件');
        if (Number(audioFile.size || 0) > 10 * 1024 * 1024) throw new Error('音频文件不能超过 10MB');

        const audioBase64 = await this._readFileAsBase64(audioFile);
        const audioFormat = String(options.audioFormat || audioFile.name?.split('.').pop() || 'mp3').trim().toLowerCase();
        const resourceId = this._resolveVolcCloneResourceId(modelType);

        if (workerUrl) {
            const response = await fetch(`${workerUrl}/api/clone`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    accessToken,
                    appId,
                    speakerId,
                    audioBase64,
                    audioFormat,
                    modelType,
                    language
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data?.success === false) {
                throw new Error(data?.error || `豆包复刻 Worker HTTP ${response.status}`);
            }
            return {
                speakerId: data.speaker_id || data.speakerId || speakerId,
                resourceId: data.resourceId || resourceId,
                raw: data
            };
        }

        const response = await fetch('https://openspeech.bytedance.com/api/v1/mega_tts/audio/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer; ${accessToken}`,
                'Resource-Id': resourceId,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                appid: appId,
                speaker_id: speakerId,
                audios: [{ audio_bytes: audioBase64, audio_format: audioFormat }],
                source: 2,
                model_type: Number.parseInt(modelType, 10) || 4,
                language: Number.parseInt(language, 10) || 0
            })
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`豆包音色复刻接口 HTTP ${response.status}${errorText ? `：${errorText}` : ''}`);
        }

        const data = await response.json();
        if (data?.BaseResp?.StatusCode === 0) {
            return {
                speakerId: data.speaker_id || speakerId,
                resourceId,
                raw: data
            };
        }

        throw new Error(this._formatVolcCloneError(data));
    }

    async getVolcVoiceCloneStatus(options = {}) {
        const accessToken = this._normalizeVolcAccessToken(options.accessToken || options.apiKey || '');
        const appId = String(options.appId || '').trim();
        const speakerId = String(options.speakerId || '').trim();
        const workerUrl = String(options.workerUrl || '').trim().replace(/\/+$/, '');
        const resourceId = String(options.resourceId || 'seed-icl-2.0').trim() || 'seed-icl-2.0';

        if (!accessToken) throw new Error('缺少豆包 Access Token');
        if (!appId) throw new Error('缺少火山 APP ID');
        if (!speakerId) throw new Error('缺少 Speaker ID');

        if (workerUrl) {
            const response = await fetch(`${workerUrl}/api/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    accessToken,
                    appId,
                    speakerId,
                    resourceId
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data?.success === false) {
                throw new Error(data?.error || `豆包复刻状态 Worker HTTP ${response.status}`);
            }
            return {
                status: data.status,
                statusText: data.statusText || '未知',
                version: data.version,
                resourceId,
                raw: data
            };
        }

        const response = await fetch('https://openspeech.bytedance.com/api/v1/mega_tts/status', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer; ${accessToken}`,
                'Resource-Id': resourceId,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                appid: appId,
                speaker_id: speakerId
            })
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`豆包音色状态接口 HTTP ${response.status}${errorText ? `：${errorText}` : ''}`);
        }

        const data = await response.json();
        if (data?.BaseResp?.StatusCode !== 0) {
            throw new Error(this._formatVolcCloneError(data));
        }

        const statusMap = {
            0: '未找到',
            1: '训练中',
            2: '训练成功',
            3: '训练失败',
            4: '已激活'
        };
        return {
            status: data.status,
            statusText: statusMap[data.status] || '未知',
            version: data.version,
            resourceId,
            raw: data
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
            const effectiveResourceId = this._resolveVolcResourceId(resourceId, voice);

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
                    'X-Api-Resource-Id': effectiveResourceId
                },
                body: JSON.stringify(requestPayload)
            });
            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                if (response.status === 401) {
                    throw new Error(`HTTP 401 鉴权失败，请核对 APP ID / API Key / Resource ID（当前 APP ID=${appId}, Resource ID=${effectiveResourceId}）${errorText ? `：${errorText}` : ''}`);
                }
                if (this._isVolcClonedVoiceId(voice) && !/^seed-icl-/i.test(effectiveResourceId)) {
                    throw new Error(`HTTP ${response.status}：复刻音色 ${voice} 需要使用 seed-icl-2.0 类 Resource ID${errorText ? `；原始错误：${errorText}` : ''}`);
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
