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
        this._csrfToken = null;
        this._csrfTokenPromise = null;
        this._purgeNimoCloneLocalAudioResidue();
    }

    _getProviderDefaults(provider) {
        const defaults = {
            minimax_cn: {
                url: 'https://api.minimaxi.com/v1/t2a_v2',
                model: 'speech-02-hd',
                voice: 'female-shaonv'
            },
            minimax_intl: {
                url: 'https://api.minimax.io/v1/t2a_v2',
                model: 'speech-2.8-hd',
                voice: 'Chinese (Mandarin)_Warm_Girl'
            },
            openai: {
                url: 'https://api.openai.com/v1/audio/speech',
                model: 'tts-1',
                voice: 'alloy'
            },
            indextts: {
                url: 'http://127.0.0.1:7880/v1/audio/speech',
                model: 'index-tts2',
                voice: 'default.wav'
            },
            nimo: {
                url: 'https://api.xiaomimimo.com/v1',
                model: 'mimo-v2.5-tts',
                voice: 'mimo_default'
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
        if (legacyKey && provider !== 'volcengine' && provider === globalProvider) {
            return String(this.storage?.get?.(legacyKey) || '').trim();
        }
        return '';
    }

    _inferProviderFromUrl(apiUrl = '', fallback = 'minimax_cn') {
        const url = String(apiUrl || '').trim().toLowerCase();
        if (url.includes('minimaxi.com')) return 'minimax_cn';
        if (url.includes('minimax.chat') || url.includes('minimax.io')) return 'minimax_intl';
        if (url.includes('127.0.0.1:7880') || url.includes('localhost:7880') || url.includes('index-tts')) return 'indextts';
        if (url.includes('xiaomimimo.com') || /\/(?:v1\/)?chat\/completions\b/.test(url)) return 'nimo';
        if (url.includes('openspeech.bytedance.com')) return 'volcengine';
        if (url.includes('api.openai.com') || /\/audio\/speech\b/.test(url)) return 'openai';
        return String(fallback || '').trim() || 'minimax_cn';
    }

    _resolveConfig(options = {}) {
        let provider = String(options.provider || this.storage?.get?.('phone-tts-provider') || 'minimax_cn').trim() || 'minimax_cn';
        const rawLegacyUrl = String(this.storage?.get?.('phone-tts-url') || '').trim();
        if (!options.provider && rawLegacyUrl) {
            provider = this._inferProviderFromUrl(rawLegacyUrl, provider);
        }

        const defaults = this._getProviderDefaults(provider);
        const apiKey = this._getStoredProviderValue(provider, 'key', 'phone-tts-key');
        const scopedUrl = this._getStoredProviderValue(provider, 'url');
        const legacyUrl = this._getStoredProviderValue(provider, 'url', 'phone-tts-url');
        let apiUrl = scopedUrl || (provider === 'volcengine' ? defaults.url : legacyUrl) || defaults.url || '';
        if (provider === 'minimax_intl' && /api\.minimax\.chat/i.test(apiUrl)) {
            apiUrl = defaults.url;
        }
        if (!apiUrl && rawLegacyUrl) {
            apiUrl = rawLegacyUrl;
        }
        const scopedModel = this._getStoredProviderValue(provider, 'model');
        const legacyModel = this._getStoredProviderValue(provider, 'model', 'phone-tts-model');
        const model = scopedModel || (provider === 'volcengine' ? defaults.model : legacyModel) || defaults.model || '';
        const globalVoice = this._getStoredProviderValue(provider, 'voice', 'phone-tts-voice') || defaults.voice || '';
        const voice = String(options.voice || globalVoice || '').trim();
        const appId = this._getStoredProviderValue(provider, 'app-id', 'phone-tts-volc-app-id');
        const resourceId = this._getStoredProviderValue(provider, 'resource-id', 'phone-tts-volc-resource-id') || 'seed-tts-2.0';
        const relayUrl = String(options.relayUrl || this._getStoredProviderValue(provider, 'relay-url') || '').trim();
        return {
            provider,
            apiKey,
            apiUrl,
            model,
            voice,
            appId,
            resourceId,
            relayUrl
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

    _readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('音频文件读取失败'));
            reader.readAsDataURL(file);
        });
    }

    _inferAudioMime(file) {
        const type = String(file?.type || '').trim();
        if (type) return type;
        const name = String(file?.name || '').toLowerCase();
        if (name.endsWith('.wav')) return 'audio/wav';
        if (name.endsWith('.flac')) return 'audio/flac';
        if (name.endsWith('.m4a')) return 'audio/mp4';
        if (name.endsWith('.ogg')) return 'audio/ogg';
        return 'audio/mpeg';
    }

    _getNimoCloneVoiceStorageKey() {
        return 'phone-tts-nimo-clone-voices';
    }

    _readNimoCloneVoicesRaw() {
        try {
            const raw = this.storage?.get?.(this._getNimoCloneVoiceStorageKey());
            const parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
            return Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object') : [];
        } catch (_e) {
            return [];
        }
    }

    _sanitizeNimoCloneVoices(list = []) {
        return (Array.isArray(list) ? list : [])
            .filter(item => item && typeof item === 'object')
            .map(item => ({
                id: String(item.id || '').trim(),
                nick: String(item.nick || '').trim(),
                name: String(item.name || '').trim(),
                mime: String(item.mime || '').trim(),
                size: Number(item.size || 0),
                serverPath: String(item.serverPath || item.serverUrl || item.path || '').trim(),
                storage: String(item.storage || (item.serverPath || item.serverUrl || item.path ? 'sillytavern' : '')).trim(),
                createdAt: Number(item.createdAt || 0) || Date.now()
            }))
            .filter(item => item.id);
    }

    async _purgeNimoCloneLocalAudioResidue() {
        try {
            const raw = this._readNimoCloneVoicesRaw();
            const clean = this._sanitizeNimoCloneVoices(raw);
            if (JSON.stringify(raw) !== JSON.stringify(clean)) {
                await this._saveNimoCloneVoices(clean);
            }
        } catch (_e) { }
    }

    _readNimoCloneVoices() {
        return this._sanitizeNimoCloneVoices(this._readNimoCloneVoicesRaw());
    }

    async _saveNimoCloneVoices(list = []) {
        await this.storage?.set?.(this._getNimoCloneVoiceStorageKey(), JSON.stringify(this._sanitizeNimoCloneVoices(list)));
    }

    _getNimoCloneVoice(voiceId = '') {
        const safeId = String(voiceId || '').trim();
        if (!safeId) return null;
        return this._readNimoCloneVoices().find(item => String(item?.id || '') === safeId) || null;
    }

    async saveNimoCloneVoice(options = {}) {
        const audioFile = options.audioFile;
        const nick = String(options.nick || '').trim();
        if (!audioFile) throw new Error('请选择用于 MiMo 复刻的参考音频');
        if (Number(audioFile.size || 0) > 10 * 1024 * 1024) throw new Error('音频文件不能超过 10MB');
        const mime = this._inferAudioMime(audioFile);
        if (!['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav'].includes(mime)) {
            throw new Error('MiMo 复刻参考音频目前仅支持 MP3 或 WAV');
        }

        const serverPath = await this._uploadNimoCloneAudioToServer(audioFile, mime);
        const id = `nimo_clone_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const voice = {
            id,
            nick: nick || audioFile.name || 'MiMo复刻音色',
            name: audioFile.name || '',
            mime,
            size: Number(audioFile.size || 0),
            serverPath,
            storage: 'sillytavern',
            createdAt: Date.now()
        };
        const voices = this._readNimoCloneVoices().filter(item => String(item?.id || '') !== id);
        voices.push(voice);
        await this._saveNimoCloneVoices(voices);
        return voice;
    }

    async _resolveNimoVoicePayload(voice = '', model = 'mimo-v2.5-tts') {
        const safeVoice = String(voice || '').trim();
        if (String(model || '').trim() === 'mimo-v2.5-tts-voiceclone') {
            if (/^data:audio\//i.test(safeVoice)) return safeVoice;
            const cloneVoice = this._getNimoCloneVoice(safeVoice);
            const serverPath = String(cloneVoice?.serverPath || '').trim();
            if (serverPath) return this._readNimoServerAudioAsDataUrl(serverPath, cloneVoice?.mime);
            if (/^(?:https?:\/\/|\/?files\/)/i.test(safeVoice)) {
                return this._readNimoServerAudioAsDataUrl(safeVoice, cloneVoice?.mime);
            }
            if (cloneVoice) throw new Error('MiMo 复刻音频缺少酒馆服务端路径，请重新上传参考音频');
        }
        return safeVoice;
    }

    _getRawFetch() {
        if (typeof window !== 'undefined' && window.VirtualPhoneRawFetch) return window.VirtualPhoneRawFetch;
        if (typeof window !== 'undefined' && typeof window.fetch === 'function') return window.fetch.bind(window);
        return fetch;
    }

    async _getCsrfToken() {
        if (this._csrfToken) return this._csrfToken;
        if (this._csrfTokenPromise) return this._csrfTokenPromise;
        this._csrfTokenPromise = (async () => {
            try {
                const headers = typeof window !== 'undefined' && typeof window.getRequestHeaders === 'function'
                    ? window.getRequestHeaders() || {}
                    : {};
                const existing = headers['X-CSRF-Token'] || headers['x-csrf-token'];
                if (existing) {
                    this._csrfToken = String(existing);
                    return this._csrfToken;
                }
                const rawFetch = this._getRawFetch();
                const response = await rawFetch('/csrf-token', {
                    credentials: 'include',
                    cache: 'no-store',
                    stPhoneInternalApi: true,
                    headers: { 'X-ST-Phone-Internal-API': '1' }
                });
                if (!response.ok) return null;
                const data = await response.json().catch(() => null);
                this._csrfToken = String(data?.token || '').trim() || null;
                return this._csrfToken;
            } catch (_e) {
                this._csrfTokenPromise = null;
                return null;
            }
        })();
        return this._csrfTokenPromise;
    }

    async _buildStJsonHeaders() {
        const headers = {};
        try {
            if (typeof window !== 'undefined' && typeof window.getRequestHeaders === 'function') {
                Object.assign(headers, window.getRequestHeaders() || {});
            }
        } catch (_e) { }
        delete headers['content-type'];
        delete headers['Content-Type'];
        headers['Content-Type'] = 'application/json';
        headers['X-ST-Phone-Internal-API'] = '1';
        if (!headers['X-CSRF-Token'] && !headers['x-csrf-token']) {
            const token = await this._getCsrfToken();
            if (token) headers['X-CSRF-Token'] = token;
        }
        return headers;
    }

    _getAudioExtension(mime = '', filename = '') {
        const name = String(filename || '').toLowerCase();
        if (name.endsWith('.wav')) return 'wav';
        if (name.endsWith('.mp3')) return 'mp3';
        const safeMime = String(mime || '').toLowerCase();
        if (safeMime.includes('wav')) return 'wav';
        return 'mp3';
    }

    _normalizeServerFileUrl(value = '') {
        let url = String(value || '').trim().replace(/\\/g, '/');
        if (!url) return '';
        if (/^(?:data:|https?:\/\/)/i.test(url)) return url;
        url = url.replace(/^public\//i, '');
        if (!url.startsWith('/')) url = `/${url}`;
        return url;
    }

    _extractServerUploadPath(data, fallbackName = '') {
        if (typeof data === 'string') return data;
        if (!data || typeof data !== 'object') return fallbackName ? `/files/${fallbackName}` : '';
        if (data.path || data.url || data.filename || data.name) {
            return data.path || data.url || data.filename || data.name;
        }
        if (typeof data.file === 'string') return data.file;
        if (data.file && typeof data.file === 'object') {
            return data.file.path || data.file.url || data.file.filename || data.file.name || (fallbackName ? `/files/${fallbackName}` : '');
        }
        return fallbackName ? `/files/${fallbackName}` : '';
    }

    async _uploadNimoCloneAudioToServer(file, mime = '') {
        const ext = this._getAudioExtension(mime, file?.name);
        const random = Math.random().toString(36).slice(2, 8);
        const filename = `yuzuki-phone-mimo-clone-${Date.now()}-${random}.${ext}`;
        const data = await this._readFileAsBase64(file);
        const headers = await this._buildStJsonHeaders();
        const rawFetch = this._getRawFetch();
        const response = await rawFetch('/api/files/upload', {
            method: 'POST',
            headers,
            credentials: 'include',
            stPhoneInternalApi: true,
            body: JSON.stringify({ name: filename, data })
        });
        const text = await response.text().catch(() => '');
        if (!response.ok) {
            throw new Error(text ? `上传到酒馆服务端失败（HTTP ${response.status}）：${text}` : `上传到酒馆服务端失败（HTTP ${response.status}）`);
        }
        let parsed = null;
        try {
            parsed = JSON.parse(text || '{}');
        } catch (_e) {
            parsed = text;
        }
        return this._normalizeServerFileUrl(this._extractServerUploadPath(parsed, filename));
    }

    async _readNimoServerAudioAsDataUrl(serverPath = '', fallbackMime = '') {
        const url = this._normalizeServerFileUrl(serverPath);
        if (!url) return '';
        const rawFetch = this._getRawFetch();
        const headers = typeof window !== 'undefined' && typeof window.getRequestHeaders === 'function'
            ? window.getRequestHeaders() || {}
            : {};
        headers['X-ST-Phone-Internal-API'] = '1';
        const response = await rawFetch(url, {
            credentials: 'include',
            stPhoneInternalApi: true,
            headers
        });
        if (!response.ok) throw new Error(`读取 MiMo 复刻参考音频失败（HTTP ${response.status}）`);
        const blob = await response.blob();
        const mime = String(blob.type || fallbackMime || '').trim() || 'audio/mpeg';
        const audioBlob = blob.type ? blob : new Blob([blob], { type: mime });
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('MiMo 复刻参考音频读取失败'));
            reader.readAsDataURL(audioBlob);
        });
    }

    _base64ToBytes(base64 = '') {
        const binary = atob(String(base64 || ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    _pcm16ToWavBlob(bytes, sampleRate = 24000) {
        const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
        const buffer = new ArrayBuffer(44 + data.length);
        const view = new DataView(buffer);
        const writeString = (offset, value) => {
            for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
        };
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + data.length, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, data.length, true);
        new Uint8Array(buffer, 44).set(data);
        return new Blob([buffer], { type: 'audio/wav' });
    }

    _normalizeNimoBaseUrl(apiUrl = '') {
        const rawInput = String(apiUrl || 'https://api.xiaomimimo.com/v1').trim();
        const withProtocol = /^https?:\/\//i.test(rawInput) ? rawInput : `https://${rawInput}`;
        const raw = withProtocol.replace(/\/+$/, '');
        return raw
            .replace(/\/(?:v1\/)?chat\/completions$/i, '')
            .replace(/\/chat$/i, '')
            .replace(/\/(?:v1\/)?audio\/speech$/i, '')
            .replace(/\/audio$/i, '');
    }

    _resolveNimoChatCompletionsEndpoint(apiUrl = '') {
        const baseUrl = this._normalizeNimoBaseUrl(apiUrl);
        if (/\/v1$/i.test(baseUrl)) return `${baseUrl}/chat/completions`;
        return `${baseUrl}/v1/chat/completions`;
    }

    _resolveNimoOpenAISpeechEndpoint(apiUrl = '') {
        const rawInput = String(apiUrl || '').trim();
        const withProtocol = /^https?:\/\//i.test(rawInput) ? rawInput : `https://${rawInput.replace(/^\/+/, '')}`;
        const raw = withProtocol.replace(/\/+$/, '');
        if (/\/(?:v1\/)?audio\/speech$/i.test(raw)) return raw;
        if (/\/audio$/i.test(raw)) return `${raw}/speech`;
        const baseUrl = this._normalizeNimoBaseUrl(apiUrl);
        if (/\/v1$/i.test(baseUrl)) return `${baseUrl}/audio/speech`;
        return `${baseUrl}/v1/audio/speech`;
    }

    _resolveNimoModelsEndpoint(apiUrl = '') {
        const rawInput = String(apiUrl || '').trim();
        const withProtocol = /^https?:\/\//i.test(rawInput) ? rawInput : `https://${rawInput.replace(/^\/+/, '')}`;
        const raw = withProtocol.replace(/\/+$/, '');
        if (/\/(?:v1\/)?models$/i.test(raw)) return raw;
        const baseUrl = this._normalizeNimoBaseUrl(apiUrl);
        if (/\/v1$/i.test(baseUrl)) return `${baseUrl}/models`;
        return `${baseUrl}/v1/models`;
    }

    _shouldUseNimoOpenAISpeech(apiUrl = '', model = '') {
        if (String(model || '').trim() === 'mimo-v2.5-tts-voiceclone') return false;
        const rawInput = String(apiUrl || '').trim().toLowerCase();
        if (!rawInput) return false;
        if (rawInput.includes('xiaomimimo.com')) return false;
        if (/\/(?:v1\/)?chat\/completions\/?$/i.test(rawInput) || /\/chat\/?$/i.test(rawInput)) return false;
        return true;
    }

    _normalizeRelayUrl(relayUrl = '') {
        return String(relayUrl || '').trim().replace(/\/+$/, '');
    }

    _formatNimoNetworkError(error) {
        const message = String(error?.message || error || '').trim();
        if (/failed to fetch|networkerror|load failed|err_failed/i.test(message)) {
            return 'MiMo 公益站请求网络失败。MiMo 复刻会请求 /v1/chat/completions 并携带 base64 参考音频；若控制台提示 CORS 或 ERR_HTTP2_PROTOCOL_ERROR，通常需要公益站允许浏览器直连并支持较大的请求体，或临时使用 MiMo Worker 中转。';
        }
        if (/aborted|aborterror/i.test(message)) {
            return 'MiMo TTS 请求已超时或被取消';
        }
        return message || 'MiMo TTS 请求失败';
    }

    _normalizeModelListPayload(payload) {
        const list = Array.isArray(payload)
            ? payload
            : (Array.isArray(payload?.data)
                ? payload.data
                : (Array.isArray(payload?.models) ? payload.models : []));
        return [...new Set(list
            .map((item) => {
                if (typeof item === 'string') return item;
                return item?.id || item?.model || item?.name || item?.value || '';
            })
            .map(value => String(value || '').trim())
            .filter(Boolean))];
    }

    async fetchNimoModels(apiUrl = '', apiKey = '', options = {}) {
        const endpoint = new URL(this._resolveNimoModelsEndpoint(apiUrl || this._getProviderDefaults('nimo').url));
        const rawFetch = this._getRawFetch();
        const safeKey = String(apiKey || this._getStoredProviderValue('nimo', 'key', 'phone-tts-key') || '').trim();
        const relayUrl = this._normalizeRelayUrl(options.relayUrl || this._getStoredProviderValue('nimo', 'relay-url'));
        const headers = {};
        if (safeKey) {
            headers.Authorization = `Bearer ${safeKey}`;
            headers['api-key'] = safeKey;
        }
        let response;
        try {
            response = relayUrl
                ? await rawFetch(`${relayUrl}/api/models`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiUrl: String(apiUrl || this._getProviderDefaults('nimo').url).trim(), apiKey: safeKey }),
                    signal: options.signal
                })
                : await rawFetch(endpoint, {
                    method: 'GET',
                    headers,
                    signal: options.signal
                });
        } catch (error) {
            throw new Error(this._formatNimoNetworkError(error));
        }
        const text = await response.text().catch(() => '');
        let payload = null;
        try {
            payload = JSON.parse(text || '{}');
        } catch (_e) {
            payload = null;
        }
        if (!response.ok || payload?.success === false) {
            const message = payload?.error?.message || payload?.error || payload?.message || text;
            throw new Error(`MiMo 模型列表 HTTP ${response.status}${message ? `：${String(message).slice(0, 300)}` : ''}`);
        }
        const models = this._normalizeModelListPayload(payload);
        if (!models.length) throw new Error('MiMo 模型列表为空');
        return models;
    }

    _resolveIndexTtsModelsEndpoint(apiUrl = '') {
        const raw = String(apiUrl || this._getProviderDefaults('indextts').url || '').trim().replace(/\/+$/, '');
        if (!raw) return 'http://127.0.0.1:7880/v1/models';
        if (/\/(?:v1\/)?models$/i.test(raw)) return raw;
        if (/\/(?:v1\/)?audio\/speech$/i.test(raw)) return raw.replace(/\/audio\/speech$/i, '/models');
        if (/\/v1$/i.test(raw)) return `${raw}/models`;
        return `${raw}/v1/models`;
    }

    async fetchIndexTtsVoices(apiUrl = '', apiKey = '', options = {}) {
        const endpoint = new URL(this._resolveIndexTtsModelsEndpoint(apiUrl));
        const headers = {};
        const safeKey = String(apiKey || this._getStoredProviderValue('indextts', 'key', 'phone-tts-key') || '').trim();
        if (safeKey) headers.Authorization = `Bearer ${safeKey}`;

        let response;
        try {
            response = await this._getRawFetch()(endpoint, {
                method: 'GET',
                headers,
                signal: options.signal
            });
        } catch (error) {
            const message = String(error?.message || error || '').trim();
            throw new Error(message || 'IndexTTS 本地服务连接失败，请确认启动api服务.bat已运行');
        }

        const text = await response.text().catch(() => '');
        let payload = null;
        try {
            payload = JSON.parse(text || '{}');
        } catch (_e) {
            payload = null;
        }
        if (!response.ok) {
            const message = payload?.detail || payload?.error?.message || payload?.message || text;
            throw new Error(`IndexTTS 音色列表 HTTP ${response.status}${message ? `：${String(message).slice(0, 300)}` : ''}`);
        }

        const modelItems = Array.isArray(payload?.data) ? payload.data : [];
        const voices = [...new Set(modelItems.flatMap(item => Array.isArray(item?.voices) ? item.voices : []))]
            .map(value => String(value || '').trim())
            .filter(Boolean);
        if (!voices.length) throw new Error('IndexTTS 未返回音色列表，请确认 api/ckyp 目录已有参考音频');
        return {
            models: this._normalizeModelListPayload(payload),
            voices
        };
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
        const { provider, apiKey, apiUrl, model, voice, appId, resourceId, relayUrl } = config;
        const signal = options.signal;
        if ((!apiKey && provider !== 'indextts') || !apiUrl) {
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
                signal,
                body: JSON.stringify({
                    model: model || (provider === 'minimax_intl' ? 'speech-2.8-hd' : 'speech-02-hd'),
                    text: inputText,
                    stream: false,
                    language_boost: 'auto',
                    output_format: 'hex',
                    voice_setting: { voice_id: voice || 'female-shaonv', speed: 1.0, vol: 1.0, pitch: 0 },
                    audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 }
                })
            });
            const responseText = await response.text().catch(() => '');
            let resData = null;
            try {
                resData = JSON.parse(responseText || '{}');
            } catch (_e) {
                resData = null;
            }
            const minimaxError = resData?.base_resp?.status_msg
                || resData?.error?.message
                || resData?.message
                || responseText;
            if (!response.ok) {
                throw new Error(`MiniMax HTTP ${response.status}${minimaxError ? `：${String(minimaxError).slice(0, 300)}` : ''}`);
            }
            if (resData?.base_resp?.status_code !== 0) {
                throw new Error(minimaxError || 'MiniMax请求失败');
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

        if (provider === 'nimo') {
            const safeModel = model || 'mimo-v2.5-tts';
            const rawFetch = this._getRawFetch();
            if (this._shouldUseNimoOpenAISpeech(apiUrl, safeModel)) {
                const endpoint = new URL(this._resolveNimoOpenAISpeechEndpoint(apiUrl));
                const publicVoicePayload = await this._resolveNimoVoicePayload(voice, safeModel);
                const speechPayload = {
                    model: safeModel,
                    input: inputText,
                    voice: publicVoicePayload || voice,
                    response_format: 'wav'
                };
                const nimoRelayUrl = this._normalizeRelayUrl(relayUrl);
                let response;
                try {
                    response = nimoRelayUrl
                        ? await rawFetch(`${nimoRelayUrl}/api/speech`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                apiUrl: String(apiUrl || '').trim(),
                                apiKey,
                                payload: speechPayload
                            }),
                            signal
                        })
                        : await rawFetch(endpoint, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiKey}`
                            },
                            body: JSON.stringify(speechPayload),
                            signal
                        });
                } catch (error) {
                    throw new Error(this._formatNimoNetworkError(error));
                }
                if (!response.ok) {
                    const errorText = await response.text().catch(() => '');
                    let errorMessage = errorText;
                    try {
                        const parsedError = JSON.parse(errorText || '{}');
                        errorMessage = parsedError?.error?.message || parsedError?.error || parsedError?.message || errorText;
                    } catch (_e) {}
                    throw new Error(`MiMo 公益站 HTTP ${response.status}${errorMessage ? `：${String(errorMessage).slice(0, 300)}` : ''}`);
                }
                const blob = await response.blob();
                if (!blob || Number(blob.size || 0) <= 0) throw new Error('MiMo 公益站未返回音频数据');
                return URL.createObjectURL(blob);
            }

            const audio = { format: 'wav' };
            const voicePayload = await this._resolveNimoVoicePayload(voice, safeModel);
            if (safeModel !== 'mimo-v2.5-tts-voicedesign') {
                if (!voicePayload) throw new Error('缺少 MiMo 音色或复刻音频');
                audio.voice = voicePayload;
            }

            const messages = [];
            if (safeModel === 'mimo-v2.5-tts-voicedesign') {
                messages.push({ role: 'user', content: voice || '自然、清晰、适合中文对话的声音' });
            } else {
                messages.push({ role: 'user', content: '' });
            }
            messages.push({ role: 'assistant', content: inputText });
            const requestBody = {
                model: safeModel,
                messages,
                audio
            };

            const endpoint = new URL(this._resolveNimoChatCompletionsEndpoint(apiUrl));
            const nimoRelayUrl = this._normalizeRelayUrl(relayUrl);
            let response;
            try {
                response = nimoRelayUrl
                    ? await rawFetch(`${nimoRelayUrl}/api/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        signal,
                        body: JSON.stringify({
                            apiUrl: String(apiUrl || '').trim(),
                            apiKey,
                            payload: requestBody
                        })
                    })
                    : await rawFetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'api-key': apiKey,
                            'Authorization': `Bearer ${apiKey}`
                        },
                        signal,
                        body: JSON.stringify(requestBody)
                    });
            } catch (error) {
                throw new Error(this._formatNimoNetworkError(error));
            }
            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                let errorMessage = errorText;
                try {
                    const parsedError = JSON.parse(errorText || '{}');
                    errorMessage = parsedError?.error?.message || parsedError?.message || errorText;
                } catch (_e) {}
                try {
                    console.error('[YuzukiPhone][MiMo TTS] request failed', {
                        status: response.status,
                        message: errorMessage,
                        body: errorText,
                        request: requestBody
                    });
                } catch (_e) {}
                throw new Error(`MiMo HTTP ${response.status}${errorMessage ? `：${errorMessage}` : ''}`);
            }

            const resData = await response.json();
            const audioData = String(resData?.choices?.[0]?.message?.audio?.data || '').trim();
            if (!audioData) throw new Error('MiMo 未返回音频数据');

            const bytes = this._base64ToBytes(audioData);
            const blob = audio.format === 'pcm16'
                ? this._pcm16ToWavBlob(bytes, 24000)
                : new Blob([bytes], { type: audio.format === 'wav' ? 'audio/wav' : 'audio/mpeg' });
            return URL.createObjectURL(blob);
        }

        if (provider === 'indextts') {
            const endpoint = new URL(apiUrl || this._getProviderDefaults('indextts').url);
            const response = await this._getRawFetch()(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey || 'local'}`
                },
                signal,
                body: JSON.stringify({
                    model: model || 'index-tts2',
                    input: inputText,
                    voice,
                    response_format: 'wav'
                })
            });
            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                let message = errorText;
                try {
                    const parsed = JSON.parse(errorText || '{}');
                    message = parsed?.detail || parsed?.error?.message || parsed?.message || errorText;
                } catch (_e) {}
                throw new Error(`IndexTTS HTTP ${response.status}${message ? `：${String(message).slice(0, 300)}` : ''}`);
            }
            const blob = await response.blob();
            if (!blob || Number(blob.size || 0) <= 0) throw new Error('IndexTTS 未返回音频数据');
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
                signal,
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
            signal,
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
