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

export class ImageGenerationManager {
    constructor(storage) {
        this.storage = storage;
        this._queueUserId = null;
        this._lastQueueNotice = '';
        this._sdModelsCache = null;
        this._sdModelsCacheUrl = '';
        this._sdModelsCacheTime = 0;
        this._sdModelsCacheTtl = 5 * 60 * 1000;
        this._comfyUIResourcesCache = null;
        this._comfyUIResourcesCacheUrl = '';
        this._comfyUIResourcesCacheTime = 0;
        this._comfyUIResourcesCacheTtl = 5 * 60 * 1000;
        this._csrfToken = null;
        this._csrfTokenPromise = null;
    }

    _get(key, fallback = '') {
        const value = this.storage?.get?.(key);
        if (value === null || value === undefined || value === '') return fallback;
        return value;
    }

    _getBool(key, fallback = false) {
        const value = this.storage?.get?.(key);
        if (value === null || value === undefined || value === '') return fallback;
        return value === true || value === 'true';
    }

    _getBoolDefaultTrue(key) {
        const value = this.storage?.get?.(key);
        return value !== false && value !== 'false';
    }

    _getNumber(key, fallback, min = null, max = null) {
        const raw = this.storage?.get?.(key);
        if (raw === null || raw === undefined || raw === '') return fallback;
        const value = Number(raw);
        let result = Number.isFinite(value) ? value : fallback;
        if (min !== null) result = Math.max(min, result);
        if (max !== null) result = Math.min(max, result);
        return result;
    }

    _normalizeSdBaseUrl(value) {
        let baseUrl = String(value || '').trim().replace(/\/+$/, '');
        if (!baseUrl) return '';
        if (!/^https?:\/\/.+/i.test(baseUrl)) {
            baseUrl = `http://${baseUrl.replace(/^\/+/, '')}`;
        }
        return baseUrl;
    }

    _normalizeComfyUIBaseUrl(value) {
        let baseUrl = String(value || '').trim().replace(/\/+$/, '');
        if (!baseUrl) return '';
        if (!/^https?:\/\/.+/i.test(baseUrl)) {
            baseUrl = `http://${baseUrl.replace(/^\/+/, '')}`;
        }
        return baseUrl;
    }

    _normalizeComfyUIMode(value) {
        return String(value || '').trim().toLowerCase() === 'remote' ? 'remote' : 'local';
    }

    _getComfyUIEndpointUrl(overrides = {}) {
        const mode = this._normalizeComfyUIMode(overrides.comfyuiMode || this._get('phone-image-comfyui-mode', 'local'));
        const localUrl = this._normalizeComfyUIBaseUrl(overrides.comfyuiUrl || this._get('phone-image-comfyui-url', 'http://127.0.0.1:8188'));
        const remoteUrl = this._normalizeComfyUIBaseUrl(overrides.comfyuiRemoteUrl || this._get('phone-image-comfyui-remote-url', ''));
        return mode === 'remote' ? remoteUrl : localUrl;
    }

    _normalizeApiBaseUrl(value, fallback = '') {
        let baseUrl = String(value || fallback || '').trim().replace(/\/+$/, '');
        if (!baseUrl) return '';
        if (!/^https?:\/\/.+/i.test(baseUrl)) {
            baseUrl = `https://${baseUrl.replace(/^\/+/, '')}`;
        }
        return baseUrl;
    }

    _normalizeSdAuth(value) {
        const auth = String(value || '').trim();
        if (!auth) return '';
        if (/^basic\s+/i.test(auth)) return auth;
        if (!auth.includes(':')) return auth;
        try {
            return `Basic ${btoa(unescape(encodeURIComponent(auth)))}`;
        } catch (e) {
            return `Basic ${btoa(auth)}`;
        }
    }

    _buildSdHeaders(extra = {}, config = null) {
        const headers = { ...extra };
        const auth = this._normalizeSdAuth(config?.sdAuth || this._get('phone-image-sd-auth', ''));
        if (auth) headers.Authorization = auth;
        return headers;
    }

    _isSillyTavern() {
        try {
            const inBrowser = typeof window !== 'undefined';
            return Boolean(
                (inBrowser && window.location && window.location.port === '8000') ||
                (typeof globalThis !== 'undefined' && globalThis.SillyTavern)
            );
        } catch (e) {
            return false;
        }
    }

    async _getCsrfToken() {
        if (this._csrfToken) return this._csrfToken;
        if (this._csrfTokenPromise) return this._csrfTokenPromise;
        this._csrfTokenPromise = (async () => {
            try {
                const response = await fetch('/csrf-token');
                if (!response.ok) return null;
                const data = await response.json().catch(() => null);
                this._csrfToken = String(data?.token || '').trim() || null;
                return this._csrfToken;
            } catch (e) {
                this._csrfTokenPromise = null;
                return null;
            }
        })();
        return this._csrfTokenPromise;
    }

    async _sdProxyRequest(endpoint, body = {}, method = 'POST') {
        const token = await this._getCsrfToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['X-CSRF-Token'] = token;
        return fetch(`/api/sd/${endpoint}`, {
            method,
            headers,
            body: method === 'GET' ? undefined : JSON.stringify(body || {})
        });
    }

    async _stProxyRequest(endpoint, body = {}, options = {}) {
        const token = await this._getCsrfToken(options.forceRefresh === true);
        const headers = {
            'Content-Type': 'application/json',
            'X-ST-Phone-Internal-API': '1'
        };
        if (token) headers['X-CSRF-Token'] = token;
        return fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body || {}),
            credentials: 'include',
            signal: options.signal
        });
    }

    _normalizeSdListPayload(payload) {
        return Array.isArray(payload)
            ? payload
            : (Array.isArray(payload?.items)
                ? payload.items
                : (Array.isArray(payload?.data)
                    ? payload.data
                    : (Array.isArray(payload?.result) ? payload.result : [])));
    }

    _mapSdListItems(payload, mapper = item => item) {
        return this._normalizeSdListPayload(payload)
            .map(mapper)
            .map(item => String(item || '').trim())
            .filter(Boolean);
    }

    _sdDirectRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(options.method || 'GET', url, true);
            if (options.headers) {
                Object.entries(options.headers).forEach(([key, value]) => {
                    xhr.setRequestHeader(key, value);
                });
            }
            xhr.responseType = 'text';
            xhr.timeout = Number(options.timeout || 120000);
            xhr.onload = () => {
                resolve({
                    ok: xhr.status >= 200 && xhr.status < 300,
                    status: xhr.status,
                    statusText: xhr.statusText,
                    text: () => Promise.resolve(xhr.responseText || ''),
                    json: () => {
                        try {
                            return Promise.resolve(JSON.parse(xhr.responseText || 'null'));
                        } catch (err) {
                            return Promise.reject(err);
                        }
                    }
                });
            };
            xhr.onerror = () => reject(new Error(`请求失败: ${url}`));
            xhr.ontimeout = () => reject(new Error(`请求超时: ${url}`));
            xhr.send(options.body || null);
        });
    }

    _normalizeNovelAISampler(value) {
        const sampler = String(value || '').trim();
        const allowed = new Set([
            'k_euler',
            'ddim_v3',
            'k_dpmpp_2s_ancestral',
            'k_dpmpp_2m',
            'k_euler_ancestral',
            'k_dpmpp_2m_sde',
            'k_dpmpp_sde'
        ]);
        return allowed.has(sampler) ? sampler : 'k_euler';
    }

    _normalizeNovelAISchedule(value) {
        const schedule = String(value || '').trim();
        const allowed = new Set(['native', 'exponential', 'polyexponential', 'karras']);
        return allowed.has(schedule) ? schedule : 'native';
    }

    _isNovelAIV4Model(model) {
        return /^nai-diffusion-4(?:-|$)/i.test(String(model || '').trim());
    }

    _isNovelAIV45Model(model) {
        return /^nai-diffusion-4-5(?:-|$)/i.test(String(model || '').trim());
    }

    _clampReferenceValue(value, fallback = 0.7, min = 0, max = 1) {
        const num = Number.parseFloat(value);
        if (!Number.isFinite(num)) return fallback;
        const clamped = Math.max(min, Math.min(max, num));
        return Math.round(clamped * 100) / 100;
    }

    _normalizeNovelAIReferenceImage(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const dataUrlMatch = raw.match(/^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i);
        if (dataUrlMatch) return dataUrlMatch[1].replace(/\s+/g, '');
        if (/^[A-Za-z0-9+/=\s]+$/.test(raw.slice(0, 120))) return raw.replace(/\s+/g, '');
        return '';
    }

    _buildNovelAIReferenceCacheKey(imageBase64 = '') {
        const text = String(imageBase64 || '');
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return `phone-ref-${(hash >>> 0).toString(16)}-${text.length}`;
    }

    _normalizeNovelAIReferences(options = {}) {
        const rawList = Array.isArray(options.novelAIReferences)
            ? options.novelAIReferences
            : (Array.isArray(options.referenceImages) ? options.referenceImages : []);
        return rawList
            .map((item) => {
                const image = typeof item === 'string'
                    ? this._normalizeNovelAIReferenceImage(item)
                    : this._normalizeNovelAIReferenceImage(item?.image || item?.imageData || item?.dataUrl || item?.base64);
                if (!image) return null;
                return {
                    image,
                    cacheSecretKey: String(item?.cacheSecretKey || item?.cache_secret_key || '').trim()
                        || this._buildNovelAIReferenceCacheKey(image),
                    strength: this._clampReferenceValue(item?.strength ?? item?.referenceStrength, 0.7, 0, 1),
                    informationExtracted: this._clampReferenceValue(
                        item?.informationExtracted ?? item?.referenceInformationExtracted,
                        1,
                        0,
                        1
                    )
                };
            })
            .filter(Boolean)
            .slice(0, 4);
    }

    _normalizeNovelAIVibeItems(items = []) {
        return (Array.isArray(items) ? items : [])
            .map((item) => {
                const image = typeof item === 'string'
                    ? this._normalizeNovelAIReferenceImage(item)
                    : this._normalizeNovelAIReferenceImage(item?.image || item?.imageData || item?.dataUrl || item?.base64);
                if (!image) return null;
                return {
                    image,
                    cacheSecretKey: String(item?.cacheSecretKey || item?.cache_secret_key || '').trim()
                        || this._buildNovelAIReferenceCacheKey(image),
                    strength: this._clampReferenceValue(item?.strength ?? item?.referenceStrength, 0.6, 0, 1),
                    informationExtracted: this._clampReferenceValue(
                        item?.informationExtracted ?? item?.referenceInformationExtracted,
                        1,
                        0,
                        1
                    )
                };
            })
            .filter(Boolean);
    }

    _normalizeNovelAIVibeGroups(groups = []) {
        const seen = new Set();
        return (Array.isArray(groups) ? groups : [])
            .map((group) => {
                const id = String(group?.id || '').trim();
                const name = String(group?.name || '').trim();
                if (!id || !name || seen.has(id)) return null;
                seen.add(id);
                const items = (Array.isArray(group?.items) ? group.items : (Array.isArray(group?.vibes) ? group.vibes : group?.references))
                    ?.map?.((item) => {
                        const image = typeof item === 'string'
                            ? String(item || '').trim()
                            : String(item?.image || item?.imageData || item?.dataUrl || item?.base64 || item?.imageUrl || item?.url || '').trim();
                        if (!image) return null;
                        return {
                            image,
                            cacheSecretKey: String(item?.cacheSecretKey || item?.cache_secret_key || '').trim(),
                            strength: this._clampReferenceValue(item?.strength ?? item?.referenceStrength, 0.6, 0, 1),
                            informationExtracted: this._clampReferenceValue(
                                item?.informationExtracted ?? item?.referenceInformationExtracted,
                                1,
                                0,
                                1
                            )
                        };
                    })
                    .filter(Boolean)
                    || [];
                if (!items.length) return null;
                return {
                    id,
                    name,
                    items,
                    updatedAt: Number(group?.updatedAt || 0) || Date.now()
                };
            })
            .filter(Boolean);
    }

    _getNovelAIVibeGroups() {
        const raw = this._get('phone-image-novelai-vibe-groups', '[]');
        let groups = [];
        try {
            groups = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
        } catch (e) {
            groups = [];
        }
        return this._normalizeNovelAIVibeGroups(groups);
    }

    async _imageUrlToNovelAIReferenceDataUrl(url) {
        const safeUrl = String(url || '').trim();
        if (!safeUrl) return '';
        if (safeUrl.startsWith('data:image/')) return safeUrl;
        const response = await fetch(safeUrl, {
            credentials: 'include',
            cache: 'no-store'
        });
        if (!response.ok) {
            throw new Error(`Vibe 参考图读取失败 (${response.status})`);
        }
        const blob = await response.blob();
        const dataUrl = await this._blobToDataUrl(blob);
        return dataUrl.startsWith('data:image/') ? dataUrl : '';
    }

    async _encodeNovelAIVibeImage(image, informationExtracted, config, signal) {
        const endpoint = `${this._resolveNovelAIEndpoint(config)}/ai/encode-vibe`;
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
                Accept: 'application/octet-stream, application/json'
            },
            body: JSON.stringify({
                image,
                information_extracted: informationExtracted,
                model: config.model
            }),
            signal
        });
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!response.ok) {
            const parsed = this._tryParseJsonBytes(bytes);
            const message = parsed?.message || parsed?.error || this._getBytesPreview(bytes);
            throw new Error(`Vibe 编码失败 (${response.status})${message ? `: ${String(message).slice(0, 160)}` : ''}`);
        }
        if (!bytes.length) throw new Error('Vibe 编码失败：NovelAI 返回空数据');
        return this._uint8ArrayToBase64(bytes);
    }

    _looksLikeNovelAIVibeEncoding(value) {
        const text = String(value || '').replace(/\s+/g, '');
        return text.length > 2000 && !/^iVBORw0KGgo|^\/9j\/|^UklGR/i.test(text);
    }

    async _encodeNovelAIVibeItems(items, config, signal) {
        if (!config || !this._isNovelAIV4Model(config.model)) return items;
        const encodedItems = [];
        for (const item of items) {
            encodedItems.push({
                ...item,
                image: this._looksLikeNovelAIVibeEncoding(item.image)
                    ? item.image
                    : await this._encodeNovelAIVibeImage(
                        item.image,
                        item.informationExtracted,
                        config,
                        signal
                    )
            });
        }
        return encodedItems;
    }

    _uint8ArrayToBase64(bytes) {
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.slice(i, i + chunkSize));
        }
        return btoa(binary);
    }

    async _resolveNovelAIVibeReferences(options = {}, config = null) {
        const explicit = this._normalizeNovelAIVibeItems(options.novelAIVibes || options.vibeReferences || []);
        if (explicit.length) return this._encodeNovelAIVibeItems(explicit, config, options.signal);
        const enabled = this._getBool('phone-image-novelai-vibe-enabled', false);
        if (!enabled) return [];
        const activeId = String(this._get('phone-image-novelai-active-vibe-group', '') || '').trim();
        if (!activeId) return [];
        const group = this._getNovelAIVibeGroups().find(item => item.id === activeId);
        if (!group?.items?.length) return [];

        const resolved = [];
        for (const item of group.items) {
            const source = String(item.image || '').trim();
            let image = this._normalizeNovelAIReferenceImage(source);
            if (!image && source) {
                try {
                    image = this._normalizeNovelAIReferenceImage(await this._imageUrlToNovelAIReferenceDataUrl(source));
                } catch (err) {
                    console.warn('[NovelAI] Vibe 参考图读取失败，已跳过:', err);
                }
            }
            if (!image) continue;
            resolved.push({
                image,
                cacheSecretKey: item.cacheSecretKey || this._buildNovelAIReferenceCacheKey(image),
                strength: item.strength,
                informationExtracted: item.informationExtracted
            });
        }
        let finalItems = resolved;

        if (this._getBool('phone-image-novelai-vibe-normalize-strength', false)) {
            const total = resolved.reduce((sum, item) => sum + Math.max(0, Number(item.strength) || 0), 0);
            if (total > 0) {
                finalItems = resolved.map(item => ({
                    ...item,
                    strength: this._clampReferenceValue((Number(item.strength) || 0) / total, item.strength, 0, 1)
                }));
            }
        }

        return this._encodeNovelAIVibeItems(finalItems, config, options.signal);
    }

    _normalizeSdReferenceImages(options = {}) {
        const rawList = Array.isArray(options.novelAIReferences)
            ? options.novelAIReferences
            : (Array.isArray(options.referenceImages) ? options.referenceImages : []);
        return rawList
            .map((item) => {
                const image = typeof item === 'string'
                    ? this._normalizeNovelAIReferenceImage(item)
                    : this._normalizeNovelAIReferenceImage(item?.image || item?.imageData || item?.dataUrl || item?.base64);
                return image || '';
            })
            .filter(Boolean)
            .slice(0, 1);
    }

    _normalizeComfyUIReferenceImages(options = {}) {
        return this._normalizeSdReferenceImages(options);
    }

    _containsCjk(text) {
        return /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/.test(String(text || ''));
    }

    _cleanNovelAITagText(text) {
        return String(text || '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*|```/gi, ''))
            .replace(/^\s*(?:prompt|positive prompt|tags?|nai tags?|english tags?|提示词|正面提示词)\s*[:：]/i, '')
            .replace(/[\r\n;；]+/g, ', ')
            .replace(/[，、]/g, ', ')
            .replace(/[。！？]/g, '')
            .replace(/\s*,\s*/g, ', ')
            .replace(/\s{2,}/g, ' ')
            .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
            .trim();
    }

    async _translatePromptForNovelAI(rawPrompt, appKey = '') {
        const source = String(rawPrompt || '').trim();
        if (!source || !this._containsCjk(source)) return source;

        const apiManager = (typeof window !== 'undefined') ? window.VirtualPhone?.apiManager : null;
        if (!apiManager || typeof apiManager.callAI !== 'function') {
            return source;
        }

        const appName = ['wechat', 'weibo'].includes(appKey) ? appKey : 'phone_online';
        const messages = [
            {
                role: 'system',
                content: [
                    'You convert Chinese image descriptions into NovelAI positive prompt tags.',
                    'Output only English comma-separated tags.',
                    'Do not add explanations, Markdown, Chinese, or full sentences.',
                    'Preserve visible subject, gender, count, pose, expression, clothing, setting, camera distance, angle, atmosphere, and anime illustration style.',
                    'If the source implies people or humanoids, include clear tags such as 1girl, 1boy, adult character, male focus, or female focus when appropriate.',
                    'Do not add unrelated quality tags unless they are clearly requested by the source.'
                ].join('\n')
            },
            {
                role: 'user',
                content: `Chinese source description:\n${source}\n\nEnglish NovelAI tags only:`
            }
        ];

        try {
            const result = await apiManager.callAI(messages, {
                appId: appName,
                max_tokens: 360,
                stream: false
            });
            const translated = this._cleanNovelAITagText(result?.summary || result?.content || result?.text || '');
            if (translated && !this._containsCjk(translated)) {
                return translated;
            }
        } catch (e) {
            console.warn('[NovelAI] 中文提示词自动转英文失败，已回退原描述:', e);
        }
        return source;
    }

    async _prepareNovelAIOptions(options = {}) {
        const appKey = String(options?.app || '').trim().toLowerCase();
        if (!['wechat', 'weibo'].includes(appKey)) return options;

        const rawPrompt = String(options.prompt || '').trim();
        if (!this._containsCjk(rawPrompt)) return options;

        const translatedPrompt = await this._translatePromptForNovelAI(rawPrompt, appKey);
        if (!translatedPrompt || translatedPrompt === rawPrompt) return options;

        return {
            ...options,
            rawPrompt,
            prompt: translatedPrompt,
            translatedPrompt
        };
    }

    _getAppDefaultSize(app) {
        switch (String(app || '').trim().toLowerCase()) {
            case 'honey':
                return { width: 832, height: 1216 };
            case 'wechat':
                return { width: 512, height: 512 };
            case 'weibo':
                return { width: 1024, height: 1024 };
            case 'diary':
                return { width: 512, height: 512 };
            default:
                return { width: 832, height: 1216 };
        }
    }

    _getProviderAppBindings() {
        const raw = this.storage?.get?.('phone-image-provider-app-bindings');
        let parsed = {};
        try {
            parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
        } catch (e) {
            parsed = {};
        }

        const allowedApps = new Set(['honey', 'wechat', 'weibo', 'diary']);
        const allowedProviders = new Set(['novelai', 'openai', 'siliconflow', 'sd', 'comfyui']);
        const bindings = {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            Object.entries(parsed).forEach(([app, provider]) => {
                const appKey = String(app || '').trim().toLowerCase();
                const providerKey = String(provider || '').trim().toLowerCase();
                if (allowedApps.has(appKey) && allowedProviders.has(providerKey)) {
                    bindings[appKey] = providerKey;
                }
            });
        }
        return bindings;
    }

    getBoundProviderForApp(app = '') {
        const appKey = String(app || '').trim().toLowerCase();
        if (!appKey) return '';
        return this._getProviderAppBindings()[appKey] || '';
    }

    _normalizeImagePresetScope(app = '') {
        const appKey = String(app || '').trim().toLowerCase();
        if (appKey === 'diary') return 'wechat';
        if (['honey', 'wechat', 'weibo'].includes(appKey)) return appKey;
        return '';
    }

    _getComfyUIWorkflowForApp(app = '') {
        const scope = this._normalizeImagePresetScope(app);
        if (!scope) return null;
        const activeId = String(this._get(`phone-image-${scope}-comfyui-active-workflow`, '') || this._get('phone-image-comfyui-active-workflow', '') || '').trim();
        if (!activeId) return null;
        let workflows = [];
        try {
            const raw = this._get('phone-image-comfyui-workflows', '[]');
            workflows = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
        } catch (e) {
            workflows = [];
        }
        if (!Array.isArray(workflows)) return null;
        return workflows.find(workflow => String(workflow?.id || '').trim() === activeId) || null;
    }

    resolveProvider(overrides = {}) {
        const explicitProvider = String(overrides.provider || '').trim().toLowerCase();
        if (explicitProvider) return explicitProvider;
        const appKey = String(overrides.app || '').trim().toLowerCase();
        return this.getBoundProviderForApp(appKey) || String(this._get('phone-image-provider', 'novelai')).trim() || 'novelai';
    }

    getSizeForApp(app = '') {
        const appKey = String(app || '').trim().toLowerCase();
        const defaults = this._getAppDefaultSize(appKey);
        const normalizeSize = (width, height) => {
            if (Number(width) <= 64 && Number(height) <= 64) {
                return { width: defaults.width, height: defaults.height };
            }
            return { width, height };
        };
        if (!appKey) {
            return normalizeSize(
                this._getNumber('phone-image-width', defaults.width, 64, 2048),
                this._getNumber('phone-image-height', defaults.height, 64, 2048)
            );
        }

        return normalizeSize(
            this._getNumber(`phone-image-${appKey}-width`, defaults.width, 64, 2048),
            this._getNumber(`phone-image-${appKey}-height`, defaults.height, 64, 2048)
        );
    }

    getConfig(overrides = {}) {
        const provider = this.resolveProvider(overrides);
        const appKey = String(overrides.app || '').trim().toLowerCase();
        const legacySiliconflowKey = String(this._get('siliconflow_api_key', '') || '').trim();
        const legacySiliconflowModel = String(this._get('image_generation_model', '') || '').trim();
        const rawSize = this.getSizeForApp(appKey);
        const size = { ...rawSize };
        const rawSteps = this._getNumber('phone-image-steps', 28, 1, 50);
        const promptAppKey = this._normalizeImagePresetScope(appKey);
        const comfyuiAppWorkflow = this._getComfyUIWorkflowForApp(appKey);

        const site = String(overrides.site || this._get('phone-image-novelai-site', 'official')).trim() || 'official';
        const openaiSite = String(overrides.openaiSite || this._get('phone-image-openai-site', 'official')).trim() || 'official';
        let apiKey = String(overrides.apiKey || this._get(`phone-image-${provider}-key`, '') || (provider === 'siliconflow' ? legacySiliconflowKey : '')).trim();
        if (provider === 'novelai' && site === 'public') {
            apiKey = String(overrides.apiKey || this._get('phone-image-novelai-public-key', '') || '').trim();
        } else if (provider === 'openai' && openaiSite === 'public') {
            apiKey = String(overrides.apiKey || this._get('phone-image-openai-public-key', '') || '').trim();
        }

        return {
            enabled: overrides.enabled ?? this._getBool('phone-image-enabled', false),
            provider,
            apiKey,
            site,
            openaiSite,
            openaiCustomUrl: String(overrides.openaiCustomUrl || this._get('phone-image-openai-url', '')).trim(),
            openaiPublicUrl: String(overrides.openaiPublicUrl || this._get('phone-image-openai-public-url', '')).trim(),
            openaiPublicRelayUrl: String(overrides.openaiPublicRelayUrl || this._get('phone-image-openai-public-relay-url', '')).trim(),
            openaiMode: 'images',
            openaiQuality: String(overrides.openaiQuality || this._get('phone-image-openai-quality', 'auto')).trim() || 'auto',
            comfyuiMode: this._normalizeComfyUIMode(overrides.comfyuiMode || this._get('phone-image-comfyui-mode', 'local')),
            comfyuiUrl: this._getComfyUIEndpointUrl(overrides),
            comfyuiLocalUrl: this._normalizeComfyUIBaseUrl(overrides.comfyuiUrl || this._get('phone-image-comfyui-url', 'http://127.0.0.1:8188')),
            comfyuiRemoteUrl: this._normalizeComfyUIBaseUrl(overrides.comfyuiRemoteUrl || this._get('phone-image-comfyui-remote-url', '')),
            comfyuiWorkflow: String(overrides.comfyuiWorkflow ?? comfyuiAppWorkflow?.workflow ?? this._get('phone-image-comfyui-workflow', '')).trim(),
            comfyuiNodeMapping: String(overrides.comfyuiNodeMapping ?? comfyuiAppWorkflow?.nodeMapping ?? this._get('phone-image-comfyui-node-mapping', '')).trim(),
            comfyuiModel: String(overrides.comfyuiModel || comfyuiAppWorkflow?.comfyuiModel || comfyuiAppWorkflow?.model || this._get('phone-image-comfyui-model', '')).trim(),
            comfyuiVae: String(overrides.comfyuiVae || comfyuiAppWorkflow?.comfyuiVae || comfyuiAppWorkflow?.vae || this._get('phone-image-comfyui-vae', '')).trim(),
            comfyuiClip: String(overrides.comfyuiClip || comfyuiAppWorkflow?.comfyuiClip || comfyuiAppWorkflow?.clip || this._get('phone-image-comfyui-clip', '')).trim(),
            comfyuiSampler: String(overrides.comfyuiSampler || comfyuiAppWorkflow?.comfyuiSampler || comfyuiAppWorkflow?.sampler || this._get('phone-image-comfyui-sampler', 'euler')).trim() || 'euler',
            comfyuiScheduler: String(overrides.comfyuiScheduler || comfyuiAppWorkflow?.comfyuiScheduler || comfyuiAppWorkflow?.scheduler || this._get('phone-image-comfyui-scheduler', 'normal')).trim() || 'normal',
            sdUrl: this._normalizeSdBaseUrl(overrides.sdUrl || this._get('phone-image-sd-url', 'http://127.0.0.1:7860')),
            sdAuth: String(overrides.sdAuth || this._get('phone-image-sd-auth', '')).trim(),
            sdVae: String(overrides.sdVae || this._get('phone-image-sd-vae', '')).trim(),
            sdScheduler: String(overrides.sdScheduler || this._get('phone-image-sd-scheduler', '')).trim(),
            sdClipSkip: this._getNumber('phone-image-sd-clip-skip', 0, 0, 12),
            sdLora: String(overrides.sdLora || this._get('phone-image-sd-lora', '')).trim(),
            sdHiresFix: this._getBool('phone-image-sd-hires-fix', false),
            sdHiresSteps: this._getNumber('phone-image-sd-hires-steps', 0, 0, 80),
            sdUpscaler: String(overrides.sdUpscaler || this._get('phone-image-sd-upscaler', '')).trim(),
            sdUpscaleFactor: this._getNumber('phone-image-sd-upscale-factor', 1.5, 1, 4),
            sdDenoisingStrength: this._getNumber('phone-image-sd-denoising-strength', 0.45, 0, 1),
            sdRestoreFaces: this._getBool('phone-image-sd-restore-faces', false),
            sdADetailer: this._getBool('phone-image-sd-adetailer', false),
            customUrl: String(overrides.customUrl || this._get('phone-image-novelai-url', '')).trim(),
            publicKey: String(overrides.publicKey || this._get('phone-image-novelai-public-key', '')).trim(),
            publicUrl: String(overrides.publicUrl || this._get('phone-image-novelai-public-url', '')).trim(),
            queueUrl: site === 'public' ? '' : String(overrides.queueUrl || this._get('phone-image-novelai-queue-url', '')).trim(),
            model: String(overrides.model || this._get(`phone-image-${provider}-model`, '') || (provider === 'novelai' ? 'nai-diffusion-4-5-full' : (provider === 'siliconflow' ? legacySiliconflowModel || 'Kwai-Kolors/Kolors' : (provider === 'openai' ? 'gpt-image-2' : '')))).trim(),
            sampler: provider === 'sd'
                ? String(overrides.sampler || this._get('phone-image-sd-sampler', 'Euler a')).trim() || 'Euler a'
                : this._normalizeNovelAISampler(overrides.sampler || this._get('phone-image-novelai-sampler', 'k_euler')),
            schedule: this._normalizeNovelAISchedule(overrides.schedule || this._get('phone-image-novelai-schedule', 'native')),
            width: size.width,
            height: size.height,
            steps: rawSteps,
            scale: this._getNumber('phone-image-scale', 6, 0, 50),
            cfgRescale: this._getNumber('phone-image-cfg-rescale', 0.2, 0, 1),
            seed: this._getNumber('phone-image-seed', -1, -1, 4294967295),
            fixedPrompt: String(overrides.fixedPrompt ?? (promptAppKey ? this._get(`phone-image-${promptAppKey}-fixed-prompt`, '') : '')).trim(),
            fixedPromptEnd: String(overrides.fixedPromptEnd ?? (promptAppKey ? this._get(`phone-image-${promptAppKey}-fixed-prompt-end`, '') : '')).trim(),
            negativePrompt: String(overrides.negativePrompt ?? (promptAppKey ? this._get(`phone-image-${promptAppKey}-negative-prompt`, '') : '')).trim(),
            debugPayload: this._getBool('phone-image-debug-payload', false),
            novelAISkipCfgCompat: this._getBoolDefaultTrue('phone-image-novelai-skip-cfg-compat'),
            saveToBackgrounds: this._getBool('phone-image-save-backgrounds', false)
        };
    }

    async generate(options = {}) {
        const config = this.getConfig(options);
        if (!config.enabled && options.ignoreEnabled !== true) throw new Error('生图功能未启用');
        if (!['sd', 'comfyui'].includes(config.provider) && !config.apiKey) throw new Error('缺少生图 API Key');

        if (config.provider === 'siliconflow') {
            return this._generateSiliconflow(options, config);
        }
        if (config.provider === 'sd') {
            return this._generateStableDiffusion(options, config);
        }
        if (config.provider === 'comfyui') {
            return this._generateComfyUI(options, config);
        }
        if (config.provider === 'openai') {
            return this._generateOpenAIImage(options, config);
        }
        if (config.provider === 'novelai') {
            const novelAIOptions = await this._prepareNovelAIOptions(options);
            return this._generateNovelAI(novelAIOptions, config);
        }
        throw new Error(`暂不支持的生图服务商：${config.provider}`);
    }

    _joinPrompt(parts = [], separator = ', ') {
        return parts
            .map(item => String(item || '').trim())
            .filter(Boolean)
            .join(separator);
    }

    _debugNovelAIRequest({ endpoint, payload, config, options }) {
        if (!config?.debugPayload) return;
        const originalPrompt = String(options?.rawPrompt || options?.prompt || '').trim();
        const translatedPrompt = String(options?.translatedPrompt || '').trim();
        const debugPayload = this._redactNovelAIDebugPayload(payload);
        const debugInfo = {
            endpoint,
            provider: 'novelai',
            app: String(options?.app || '').trim(),
            model: config.model,
            sampler: config.sampler,
            schedule: config.schedule,
            width: payload?.parameters?.width,
            height: payload?.parameters?.height,
            steps: payload?.parameters?.steps,
            scale: payload?.parameters?.scale,
            cfgRescale: payload?.parameters?.cfg_rescale,
            skipCfgAboveSigma: payload?.parameters?.skip_cfg_above_sigma,
            novelAISkipCfgCompat: config.novelAISkipCfgCompat !== false,
            seed: payload?.parameters?.seed,
            originalPrompt,
            translatedPrompt,
            positivePrompt: payload?.input || '',
            negativePrompt: payload?.parameters?.negative_prompt || '',
            referenceCount: Array.isArray(payload?.parameters?.director_reference_images_cached)
                ? payload.parameters.director_reference_images_cached.length
                : (Array.isArray(payload?.parameters?.director_reference_images)
                    ? payload.parameters.director_reference_images.length
                    : 0),
            vibeCount: Array.isArray(payload?.parameters?.reference_image_multiple)
                ? payload.parameters.reference_image_multiple.length
                : 0,
            payload: debugPayload
        };
        try {
            if (typeof window !== 'undefined') {
                window.__lastNovelAIRequest = debugInfo;
            }
        } catch (e) {}
        try {
            const plainText = [
                '[NovelAI Debug] 本次生图参数',
                `App: ${debugInfo.app || '-'}`,
                `模型: ${debugInfo.model}`,
                `尺寸: ${debugInfo.width}x${debugInfo.height}`,
                `Steps: ${debugInfo.steps}`,
                `Sampler: ${debugInfo.sampler}`,
                `Schedule: ${debugInfo.schedule}`,
                `Scale: ${debugInfo.scale}`,
                `CFG Rescale: ${debugInfo.cfgRescale}`,
                `Skip CFG Above Sigma: ${debugInfo.skipCfgAboveSigma ?? '(未发送)'}`,
                `自动兼容参数: ${debugInfo.novelAISkipCfgCompat ? '开启' : '关闭'}`,
                `Seed: ${debugInfo.seed}`,
                `参考图: ${debugInfo.referenceCount} 张`,
                `Vibe: ${debugInfo.vibeCount} 个`,
                '',
                'AI 画面 tag（原样）:',
                debugInfo.originalPrompt || '(空)',
                ...(debugInfo.translatedPrompt ? [
                    '',
                    '自动转英文后的 NAI tag:',
                    debugInfo.translatedPrompt
                ] : []),
                '',
                '最终发送给 NAI 的正面提示词:',
                debugInfo.positivePrompt || '(空)',
                '',
                '最终发送给 NAI 的负面提示词:',
                debugInfo.negativePrompt || '(空)',
                '',
                '调试 payload 已保存到 window.__lastNovelAIRequest（参考图 base64 已脱敏）',
                '复制完整调试信息: copy(JSON.stringify(window.__lastNovelAIRequest, null, 2))'
            ].join('\n');
            console.log(plainText);
            console.groupCollapsed('[NovelAI Debug] generate-image payload');
            console.info('summary', {
                endpoint: debugInfo.endpoint,
                app: debugInfo.app,
                model: debugInfo.model,
                size: `${debugInfo.width}x${debugInfo.height}`,
                steps: debugInfo.steps,
                sampler: debugInfo.sampler,
                schedule: debugInfo.schedule,
                scale: debugInfo.scale,
                cfgRescale: debugInfo.cfgRescale,
                skipCfgAboveSigma: debugInfo.skipCfgAboveSigma,
                novelAISkipCfgCompat: debugInfo.novelAISkipCfgCompat,
                seed: debugInfo.seed,
                referenceCount: debugInfo.referenceCount,
                vibeCount: debugInfo.vibeCount
            });
            console.info('AI 画面 tag（原样）', debugInfo.originalPrompt);
            if (debugInfo.translatedPrompt) console.info('自动转英文后的 NAI tag', debugInfo.translatedPrompt);
            console.info('positive prompt', debugInfo.positivePrompt);
            console.info('negative prompt', debugInfo.negativePrompt);
            console.info('full payload', debugInfo.payload);
            console.info('copy helper', 'copy(JSON.stringify(window.__lastNovelAIRequest, null, 2))');
            console.groupEnd();
        } catch (e) {}
    }

    _redactNovelAIDebugPayload(payload) {
        try {
            const clone = JSON.parse(JSON.stringify(payload || {}));
            const refs = clone?.parameters?.reference_image_multiple;
            if (Array.isArray(refs)) {
                clone.parameters.reference_image_multiple = refs.map((item, index) => {
                    const length = String(item || '').length;
                    return `[BASE64_REFERENCE_IMAGE_${index + 1}:${length}]`;
                });
            }
            const cachedRefs = clone?.parameters?.reference_image_multiple_cached;
            if (Array.isArray(cachedRefs)) {
                clone.parameters.reference_image_multiple_cached = cachedRefs.map((item, index) => ({
                    cache_secret_key: String(item?.cache_secret_key || ''),
                    data: `[BASE64_REFERENCE_IMAGE_CACHED_${index + 1}:${String(item?.data || '').length}]`
                }));
            }
            const directorRefs = clone?.parameters?.director_reference_images;
            if (Array.isArray(directorRefs)) {
                clone.parameters.director_reference_images = directorRefs.map((item, index) => {
                    const length = String(item || '').length;
                    return `[BASE64_DIRECTOR_REFERENCE_IMAGE_${index + 1}:${length}]`;
                });
            }
            const cachedDirectorRefs = clone?.parameters?.director_reference_images_cached;
            if (Array.isArray(cachedDirectorRefs)) {
                clone.parameters.director_reference_images_cached = cachedDirectorRefs.map((item, index) => ({
                    cache_secret_key: String(item?.cache_secret_key || ''),
                    data: `[BASE64_DIRECTOR_REFERENCE_IMAGE_CACHED_${index + 1}:${String(item?.data || '').length}]`
                }));
            }
            return clone;
        } catch (e) {
            return payload;
        }
    }

    _resolveNovelAIEndpoint(config) {
        if (config.site === 'public') {
            if (!config.publicUrl) throw new Error('缺少公益站 Base URL');
            return config.publicUrl.replace(/\/+$/, '');
        }
        if (config.site === 'custom' && config.customUrl) {
            return config.customUrl.replace(/\/+$/, '');
        }
        return 'https://image.novelai.net';
    }

    _resolveNovelAIQueueUrl(config) {
        return String(config?.queueUrl || '').trim().replace(/\/+$/, '');
    }

    _createQueueTaskId() {
        return `phone-nai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    _getQueueUserId() {
        if (this._queueUserId) return this._queueUserId;
        const storageKey = 'phone_nai_queue_user_id';
        try {
            const stored = window.localStorage?.getItem(storageKey);
            if (stored) {
                this._queueUserId = stored;
                return stored;
            }
            const cryptoApi = globalThis.crypto;
            const randomPart = typeof cryptoApi?.randomUUID === 'function'
                ? cryptoApi.randomUUID()
                : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
            const userId = `phone-${randomPart}`;
            window.localStorage?.setItem(storageKey, userId);
            this._queueUserId = userId;
            return userId;
        } catch (e) {
            this._queueUserId = `phone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
            return this._queueUserId;
        }
    }

    async _hashQueueKey(apiKey) {
        const text = String(apiKey || '');
        if (!text) throw new Error('缺少 NAI API Key，无法进入共享队列');
        try {
            const cryptoApi = globalThis.crypto;
            if (typeof cryptoApi?.subtle?.digest === 'function' && typeof TextEncoder === 'function') {
                const buffer = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(text));
                return Array.from(new Uint8Array(buffer)).map(byte => byte.toString(16).padStart(2, '0')).join('');
            }
        } catch (e) {}

        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
        }
        return `fallback-${Math.abs(hash).toString(16)}`;
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    _getQueueToken(payload) {
        return String(payload?.token || payload?.queue_token || payload?.queueToken || '').trim();
    }

    _getQueuePosition(payload) {
        const raw = payload?.position ?? payload?.queue_position ?? payload?.rank;
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
    }

    _getQueueSize(payload) {
        const raw = payload?.queue_size ?? payload?.queueSize ?? payload?.size;
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
    }

    _formatQueueStatus(payload) {
        const position = this._getQueuePosition(payload);
        const size = this._getQueueSize(payload);
        if (position === null) return '';
        const displayPosition = Math.max(1, position + 1);
        if (size !== null && size > 0) return `NAI 队列排队中：第 ${displayPosition}/${size} 位`;
        return `NAI 队列排队中：第 ${displayPosition} 位`;
    }

    _noticeQueueStatus(payload, force = false) {
        const text = this._formatQueueStatus(payload);
        if (!text || (!force && text === this._lastQueueNotice)) return;
        this._lastQueueNotice = text;
        console.log(`[NovelAI Queue] ${text}`);
        try {
            window.VirtualPhone?.phoneShell?.showNotification?.('NAI 共享队列', text, '🎨');
        } catch (e) {}
    }

    async _queueRequest(baseUrl, path, { method = 'GET', body = null, query = null } = {}) {
        const url = new URL(`${baseUrl}${path}`);
        if (query && typeof query === 'object') {
            Object.entries(query).forEach(([key, value]) => {
                if (value !== null && value !== undefined && value !== '') {
                    url.searchParams.set(key, String(value));
                }
            });
        }

        const response = await fetch(url.toString(), {
            method,
            headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
            body: method === 'POST' ? JSON.stringify(body || {}) : undefined
        });
        const text = await response.text().catch(() => '');
        let payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = null; }
        if (!response.ok) {
            const message = payload?.message || payload?.error || text || '';
            throw new Error(`NAI 队列服务请求失败 (${response.status})${message ? `: ${String(message).slice(0, 180)}` : ''}`);
        }
        return payload || {};
    }

    async _waitForNovelAIQueueTurn(config, options = {}) {
        const baseUrl = this._resolveNovelAIQueueUrl(config);
        if (!baseUrl) return null;

        const keyHash = await this._hashQueueKey(config.apiKey);
        const userId = this._getQueueUserId();
        const taskId = String(options.queueTaskId || this._createQueueTaskId()).trim();
        const queuePayload = { key_hash: keyHash, user_id: userId, task_id: taskId };
        let token = '';
        let joined = false;
        let leftQueue = false;

        const leave = async () => {
            if (!joined || leftQueue) return;
            leftQueue = true;
            await this._queueRequest(baseUrl, '/leave-queue', {
                method: 'POST',
                body: { ...queuePayload, token }
            }).catch((err) => console.warn('[NovelAI Queue] 离开队列失败:', err));
        };

        try {
            const joinedInfo = await this._queueRequest(baseUrl, '/queue', {
                method: 'POST',
                body: queuePayload
            });
            joined = true;
            token = this._getQueueToken(joinedInfo);
            this._noticeQueueStatus(joinedInfo, true);
            if (joinedInfo?.can_run && token) {
                return { baseUrl, keyHash, userId, taskId, token };
            }

            for (let retry = 0; retry < 120; retry++) {
                if (options?.signal?.aborted) {
                    await leave();
                    throw new Error('已取消 NAI 生图队列等待');
                }
                await this._sleep(3000);
                const turnInfo = await this._queueRequest(baseUrl, '/my-turn', {
                    query: queuePayload
                });
                token = this._getQueueToken(turnInfo) || token;
                this._noticeQueueStatus(turnInfo);
                if (turnInfo?.can_run && token) {
                    return { baseUrl, keyHash, userId, taskId, token };
                }
            }

            await leave();
            throw new Error('等待 NAI 共享队列超时，请稍后重试');
        } catch (err) {
            if (!String(err?.message || '').includes('已取消 NAI 生图队列等待')) {
                await leave();
            }
            throw err;
        }
    }

    async _finishNovelAIQueue(queueInfo) {
        if (!queueInfo?.baseUrl || !queueInfo?.token) return;
        await this._queueRequest(queueInfo.baseUrl, '/complete', {
            method: 'POST',
            body: {
                key_hash: queueInfo.keyHash,
                user_id: queueInfo.userId,
                task_id: queueInfo.taskId,
                token: queueInfo.token
            }
        }).catch((err) => console.warn('[NovelAI Queue] 完成队列任务失败:', err));
    }

    _normalizeImageResultString(value, { allowUrl = true } = {}) {
        const text = String(value || '').trim();
        if (!text) return '';
        if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(text)) return text;
        if (allowUrl && /^(?:https?:|blob:|\/backgrounds\/)/i.test(text)) return text;
        const compact = text.replace(/\s+/g, '');
        if (compact.length >= 80 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
            return `data:image/png;base64,${compact}`;
        }
        return '';
    }

    _extractImageResult(payload, options = {}) {
        if (!payload) return '';
        if (typeof payload === 'string') {
            const direct = this._normalizeImageResultString(payload, options);
            if (direct) return direct;
            const trimmed = payload.trim();
            if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                try {
                    const nestedJson = JSON.parse(trimmed);
                    const nestedImage = this._extractImageResult(nestedJson, options);
                    if (nestedImage) return nestedImage;
                } catch {
                    // 不是完整 JSON 时继续按文本提取图片。
                }
            }
            const markdownMatch = payload.match(/!\[[^\]]*]\(([^)\s]+)\)/);
            if (markdownMatch) {
                const markdownImage = this._normalizeImageResultString(markdownMatch[1], options);
                if (markdownImage) return markdownImage;
            }
            const looseMatch = payload.match(/((?:https?:\/\/|\/)[^\s)"']+\.(?:png|jpe?g|webp|gif|bmp|svg)(?:\?[^\s)"']*)?)/i);
            if (looseMatch) {
                const looseImage = this._normalizeImageResultString(looseMatch[1], options);
                if (looseImage) return looseImage;
            }
            return '';
        }
        if (Array.isArray(payload)) {
            for (const item of payload) {
                const nested = this._extractImageResult(item, options);
                if (nested) return nested;
            }
            return '';
        }
        if (typeof payload !== 'object') return '';

        const directCandidates = [
            payload.b64_json,
            payload.b64,
            payload.base64,
            payload.image_base64,
            payload.imageBase64,
            payload.dataUrl,
            payload.data_url,
            payload.image_url,
            payload.imageUrl,
            payload.url,
            payload.image,
            payload.imageData
        ];
        for (const item of directCandidates) {
            const normalized = this._extractImageResult(item, options);
            if (normalized) return normalized;
        }

        const nestedCandidates = [
            payload.data,
            payload.images,
            payload.media,
            payload.files,
            payload.attachments,
            payload.artifacts,
            payload.output,
            payload.outputs,
            payload.choices,
            payload.message,
            payload.content,
            payload.result,
            payload.results,
            payload.response
        ];
        for (const item of nestedCandidates) {
            const nested = this._extractImageResult(item, options);
            if (nested) return nested;
        }
        return '';
    }

    _extractBase64Image(payload) {
        return this._extractImageResult(payload, { allowUrl: true });
    }

    _detectImageMime(bytes, fallback = '') {
        if (!bytes || bytes.length < 4) return fallback || '';
        if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
        if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
        if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
        if (
            bytes.length >= 12 &&
            bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
            bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
        ) {
            return 'image/webp';
        }
        return fallback || '';
    }

    _tryParseJsonBytes(bytes) {
        try {
            const text = new TextDecoder('utf-8').decode(bytes || new Uint8Array());
            return text ? JSON.parse(text) : null;
        } catch (e) {
            return null;
        }
    }

    _getBytesPreview(bytes, limit = 180) {
        try {
            return new TextDecoder('utf-8').decode((bytes || new Uint8Array()).slice(0, limit)).trim();
        } catch (e) {
            return '';
        }
    }

    async _readNovelAIImageResponse(response) {
        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        const arrayBuffer = await response.arrayBuffer();
        if (!arrayBuffer || arrayBuffer.byteLength <= 0) throw new Error('NovelAI 返回空图片数据');
        const bytes = new Uint8Array(arrayBuffer);

        const parsedJson = contentType.includes('application/json') || contentType.includes('+json')
            ? this._tryParseJsonBytes(bytes)
            : null;
        if (parsedJson) {
            return this._extractBase64Image(parsedJson);
        }

        const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
        if (isZip) {
            return await this._readZipImageBytes(bytes, arrayBuffer);
        }

        const mime = this._detectImageMime(bytes, contentType.startsWith('image/') ? contentType.split(';')[0] : '');
        if (mime) {
            return await this._blobToDataUrl(new Blob([bytes], { type: mime }));
        }

        const fallbackJson = this._tryParseJsonBytes(bytes);
        if (fallbackJson) {
            const imageData = this._extractBase64Image(fallbackJson);
            if (imageData) return imageData;
        }

        const preview = this._getBytesPreview(bytes);
        throw new Error(`NovelAI 返回的不是图片数据${preview ? `: ${preview.slice(0, 120)}` : ''}`);
    }

    async _readZipImage(response) {
        const blob = await response.blob();
        if (!blob || blob.size <= 0) throw new Error('NovelAI 返回空图片数据');
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
        if (!isZip) {
            const mime = this._detectImageMime(bytes, blob.type && blob.type.startsWith('image/') ? blob.type : '');
            if (!mime) throw new Error('NovelAI 返回的不是图片数据');
            return await this._blobToDataUrl(new Blob([bytes], { type: mime }));
        }
        return this._readZipImageBytes(bytes, arrayBuffer);
    }

    async _readZipImageBytes(bytes, arrayBuffer) {
        if (window.JSZip) {
            const zip = await window.JSZip.loadAsync(arrayBuffer);
            const imageFile = Object.values(zip.files)
                .filter(file => !file.dir && /\.(png|jpg|jpeg|webp)$/i.test(file.name))
                .sort((a, b) => {
                    const sizeA = Number(a?._data?.uncompressedSize || a?._data?.compressedSize || 0);
                    const sizeB = Number(b?._data?.uncompressedSize || b?._data?.compressedSize || 0);
                    return sizeB - sizeA;
                })[0];
            if (!imageFile) throw new Error('NovelAI ZIP 中未找到图片文件');
            const imageBlob = await imageFile.async('blob');
            return await this._blobToDataUrl(imageBlob);
        }

        const imageBlob = await this._readZipImageNative(bytes, arrayBuffer);
        return await this._blobToDataUrl(imageBlob);
    }

    _blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
            reader.readAsDataURL(blob);
        });
    }

    _dataUrlToBlob(dataUrl, fallbackMime = 'image/png') {
        const raw = String(dataUrl || '').trim();
        if (!raw) return null;
        const match = raw.match(/^data:([^;,]+)?;base64,([\s\S]+)$/i);
        const mime = String(match?.[1] || fallbackMime || 'image/png').trim() || 'image/png';
        const base64 = match ? match[2] : raw;
        try {
            const binary = atob(base64.replace(/\s+/g, ''));
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return new Blob([bytes], { type: mime });
        } catch (err) {
            console.warn('[ComfyUI] 参考图 base64 解析失败:', err);
            return null;
        }
    }

    _waitForImageDecode(src, timeoutMs = 12000) {
        return new Promise((resolve, reject) => {
            if (!src) {
                reject(new Error('图片数据为空'));
                return;
            }
            const image = new Image();
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(new Error('图片解码超时'));
            }, timeoutMs);
            const finish = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 });
            };
            image.onload = finish;
            image.onerror = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(new Error('图片解码失败'));
            };
            image.src = src;
            if (typeof image.decode === 'function') {
                image.decode().then(finish).catch(() => {
                    if (image.complete && image.naturalWidth > 0) finish();
                });
            }
        });
    }

    async _readZipImageNative(bytes, arrayBuffer) {
        const entry = this._findZipImageEntry(bytes, arrayBuffer);
        if (!entry) throw new Error('NovelAI ZIP 中未找到图片文件');

        const compressed = bytes.slice(entry.dataStart, entry.dataStart + entry.compressedSize);
        let fileBytes = compressed;
        if (entry.method === 8) {
            fileBytes = await this._inflateRawDeflate(compressed);
        } else if (entry.method !== 0) {
            throw new Error(`当前环境不支持 ZIP 压缩方式：${entry.method}`);
        }

        const lowerName = String(entry.name || '').toLowerCase();
        const mime = lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')
            ? 'image/jpeg'
            : (lowerName.endsWith('.webp') ? 'image/webp' : 'image/png');
        return new Blob([fileBytes], { type: mime });
    }

    _findZipImageEntry(bytes, arrayBuffer) {
        const view = new DataView(arrayBuffer);
        const decoder = new TextDecoder('utf-8');
        const imageExtPattern = /\.(png|jpg|jpeg|webp)$/i;
        let bestEntry = null;

        for (let offset = 0; offset <= bytes.length - 46; offset++) {
            if (view.getUint32(offset, true) !== 0x02014b50) continue;
            const method = view.getUint16(offset + 10, true);
            const compressedSize = view.getUint32(offset + 20, true);
            const fileNameLength = view.getUint16(offset + 28, true);
            const extraLength = view.getUint16(offset + 30, true);
            const commentLength = view.getUint16(offset + 32, true);
            const localHeaderOffset = view.getUint32(offset + 42, true);
            const nameStart = offset + 46;
            const nameEnd = nameStart + fileNameLength;
            if (nameEnd > bytes.length) break;

            const name = decoder.decode(bytes.slice(nameStart, nameEnd));
            const nextOffset = nameEnd + extraLength + commentLength;
            if (!imageExtPattern.test(name) || compressedSize <= 0) {
                offset = Math.max(offset, nextOffset - 1);
                continue;
            }

            if (localHeaderOffset < 0 || localHeaderOffset + 30 > bytes.length) continue;
            if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) continue;
            const localNameLength = view.getUint16(localHeaderOffset + 26, true);
            const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
            const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
            if (dataStart + compressedSize > bytes.length) continue;

            const entry = { name, method, compressedSize, dataStart };
            if (!bestEntry || compressedSize > bestEntry.compressedSize) {
                bestEntry = entry;
            }
        }

        return bestEntry || null;
    }

    async _inflateRawDeflate(bytes) {
        if (typeof DecompressionStream !== 'function') {
            throw new Error('NovelAI 返回 ZIP，但当前浏览器缺少原生解压能力');
        }

        const tryInflate = async (format) => {
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
            const buffer = await new Response(stream).arrayBuffer();
            return new Uint8Array(buffer);
        };

        try {
            return await tryInflate('deflate-raw');
        } catch (err) {
            try {
                return await tryInflate('deflate');
            } catch (fallbackErr) {
                throw err;
            }
        }
    }

    _getNovelAISkipCfgAboveSigma(config) {
        const sampler = String(config?.sampler || '').trim();
        const schedule = String(config?.schedule || '').trim();
        if (sampler !== 'k_euler_ancestral') return null;
        if (schedule !== 'karras' && schedule !== 'exponential') return null;
        return this._isNovelAIV45Model(config?.model) ? 19 : 58;
    }

    _cleanNovelAIPromptSegment(text) {
        return String(text || '')
            .replace(/[，、]/g, ', ')
            .replace(/\s*,\s*/g, ', ')
            .replace(/(?:^|,\s*)(?:,+\s*)+/g, ', ')
            .replace(/,\s*,+/g, ', ')
            .replace(/^["'“”‘’\s,]+|["'“”‘’\s,]+$/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    _stripNovelAICharacterNameTags(text) {
        const roleWords = new Set([
            '1boy', '1girl', '1other', 'mature male', 'adult male', 'adult woman', 'adult female',
            'young man', 'young woman', 'handsome', 'beautiful', 'male focus', 'female focus'
        ]);
        const visualWords = /^(?:long|short|messy|black|white|blonde|brown|silver|red|blue|green|golden|dark|light|open|half|bound|blindfold|shirt|robe|cassock|suit|pants|dress|lingerie|hair|eyes?|smile|gaze|flushed|sweating|panting|looking|holding|grabbing|pinned|kneeling|sitting|standing|leaning|lying|source#|target#|mutual#)/i;
        return this._cleanNovelAIPromptSegment(text)
            .split(/\s*,\s*/)
            .map(item => item.trim())
            .filter(Boolean)
            .filter((item, index) => {
                const lower = item.toLowerCase();
                if (this._isNovelAIManagedBoilerplateTag(lower)) return false;
                if (roleWords.has(lower) || visualWords.test(item)) return true;
                if (/^(?:dragon|tiger|wolf|fox|lion|snake|rabbit|bunny|cat|dog)$/i.test(item)) return false;
                if (index <= 2 && /^[A-Z][a-z]{2,18}$/.test(item)) return false;
                return true;
            })
            .join(', ');
    }

    _isNovelAIManagedBoilerplateTag(tag = '') {
        const lower = String(tag || '').trim().toLowerCase();
        if (!lower) return false;
        const managed = new Set([
            'amazing quality',
            'very aesthetic',
            'absurdres',
            'highres',
            'best quality',
            'masterpiece',
            'anime illustration',
            'digital illustration',
            'highly finished',
            'character study',
            'photo (medium)'
        ]);
        return managed.has(lower);
    }

    _stripNovelAIManagedBoilerplateTags(text) {
        return this._cleanNovelAIPromptSegment(text)
            .split(/\s*,\s*/)
            .map(item => item.trim())
            .filter(Boolean)
            .filter(item => !this._isNovelAIManagedBoilerplateTag(item))
            .join(', ');
    }

    _resolveNovelAICharacterPosition(value = '') {
        const raw = String(value || '').trim().replace(/\s+/g, '');
        if (!raw) return null;

        const gridMatch = raw.match(/^([a-e])([1-5])$/i);
        if (gridMatch) {
            const axis = { a: 0.1, b: 0.3, c: 0.5, d: 0.7, e: 0.9 };
            return {
                x: axis[gridMatch[1].toLowerCase()] || 0.5,
                y: axis[gridMatch[2]] || 0.5
            };
        }

        const aliases = new Map([
            ['中', [0.5, 0.5]],
            ['中心', [0.5, 0.5]],
            ['中央', [0.5, 0.5]],
            ['左', [0.3, 0.5]],
            ['右', [0.7, 0.5]],
            ['上', [0.5, 0.3]],
            ['下', [0.5, 0.7]],
            ['左上', [0.3, 0.3]],
            ['上左', [0.3, 0.3]],
            ['右上', [0.7, 0.3]],
            ['上右', [0.7, 0.3]],
            ['左下', [0.3, 0.7]],
            ['下左', [0.3, 0.7]],
            ['右下', [0.7, 0.7]],
            ['下右', [0.7, 0.7]],
            ['左左', [0.1, 0.5]],
            ['右右', [0.9, 0.5]],
            ['上上', [0.5, 0.1]],
            ['下下', [0.5, 0.9]],
            ['左左上上', [0.1, 0.1]],
            ['上上左左', [0.1, 0.1]],
            ['右右上上', [0.9, 0.1]],
            ['上上右右', [0.9, 0.1]],
            ['左左下下', [0.1, 0.9]],
            ['下下左左', [0.1, 0.9]],
            ['右右下下', [0.9, 0.9]],
            ['下下右右', [0.9, 0.9]]
        ]);
        if (aliases.has(raw)) {
            const [x, y] = aliases.get(raw);
            return { x, y };
        }

        if (/^[左右上下]+$/.test(raw)) {
            const clamp = (num) => Math.max(0.1, Math.min(0.9, Math.round(num * 10) / 10));
            const left = (raw.match(/左/g) || []).length;
            const right = (raw.match(/右/g) || []).length;
            const up = (raw.match(/上/g) || []).length;
            const down = (raw.match(/下/g) || []).length;
            return {
                x: clamp(0.5 + (right - left) * 0.2),
                y: clamp(0.5 + (down - up) * 0.2)
            };
        }

        const lower = raw.toLowerCase();
        const englishAliases = new Map([
            ['center', [0.5, 0.5]],
            ['middle', [0.5, 0.5]],
            ['left', [0.3, 0.5]],
            ['right', [0.7, 0.5]],
            ['top', [0.5, 0.3]],
            ['upper', [0.5, 0.3]],
            ['bottom', [0.5, 0.7]],
            ['lower', [0.5, 0.7]],
            ['upperleft', [0.3, 0.3]],
            ['topleft', [0.3, 0.3]],
            ['upperright', [0.7, 0.3]],
            ['topright', [0.7, 0.3]],
            ['lowerleft', [0.3, 0.7]],
            ['bottomleft', [0.3, 0.7]],
            ['lowerright', [0.7, 0.7]],
            ['bottomright', [0.7, 0.7]]
        ]);
        const englishKey = lower.replace(/[-_\s]+/g, '');
        if (englishAliases.has(englishKey)) {
            const [x, y] = englishAliases.get(englishKey);
            return { x, y };
        }

        return null;
    }

    _extractNovelAICharacterPosition(text = '') {
        let position = null;
        const content = String(text || '').replace(/\{\s*(?:位置|position)\s*[:：]?\s*([^{}]+?)\s*\}/gi, (match, value) => {
            if (!position) position = this._resolveNovelAICharacterPosition(value);
            return '';
        });
        return { content, position };
    }

    _parseNovelAICharacterPromptSyntax(prompt = '', negativePrompt = '') {
        const source = String(prompt || '');
        const characters = [];
        const blockPattern = /\{\s*人物\s*([\s\S]*?)\s*人物\s*\}/g;
        let match;

        while ((match = blockPattern.exec(source)) && characters.length < 6) {
            const rawBlock = String(match[1] || '');
            const positionResult = this._extractNovelAICharacterPosition(rawBlock);
            let charText = positionResult.content;
            let charNegative = '';
            const negativeMatch = charText.match(/(?:^|[,，]\s*)ntags\s*=\s*([\s\S]*)$/i);
            if (negativeMatch) {
                charNegative = negativeMatch[1] || '';
                charText = charText.slice(0, negativeMatch.index);
            }

            const charCaption = this._stripNovelAICharacterNameTags(charText);
            const negativeCaption = this._cleanNovelAIPromptSegment(charNegative);
            if (!charCaption && !negativeCaption) continue;
            characters.push({
                charCaption,
                negativeCaption,
                center: positionResult.position
            });
        }

        if (characters.length === 0) {
            return {
                baseCaption: this._cleanNovelAIPromptSegment(source),
                negativeBaseCaption: this._cleanNovelAIPromptSegment(negativePrompt),
                characters: [],
                useCoords: false
            };
        }

        const baseCaption = this._stripNovelAIManagedBoilerplateTags(source.replace(blockPattern, ''));
        return {
            baseCaption,
            negativeBaseCaption: this._cleanNovelAIPromptSegment(negativePrompt),
            characters,
            useCoords: characters.some(item => item.center)
        };
    }

    _buildNovelAICharCaptions(characters = [], key = 'charCaption') {
        return (Array.isArray(characters) ? characters : [])
            .map((item) => {
                const entry = {
                    char_caption: this._cleanNovelAIPromptSegment(item?.[key] || '')
                };
                if (item?.center) entry.centers = [item.center];
                return entry;
            });
    }

    async _buildNovelAIPayload(options, config) {
        const appKey = String(options.app || '').trim().toLowerCase();
        const rawPrompt = this._joinPrompt([
            config.fixedPrompt,
            options.prompt,
            config.fixedPromptEnd
        ]);
        const rawNegativePrompt = this._joinPrompt([
            config.negativePrompt,
            options.negativePrompt
        ]);
        const parsedV4Prompt = this._isNovelAIV4Model(config.model)
            ? this._parseNovelAICharacterPromptSyntax(rawPrompt, rawNegativePrompt)
            : null;
        const prompt = parsedV4Prompt?.baseCaption || rawPrompt;
        const negativePrompt = parsedV4Prompt?.negativeBaseCaption || rawNegativePrompt;
        const seed = Number(options.seed ?? config.seed);
        let width = Number(options.width || config.width);
        let height = Number(options.height || config.height);
        let scale = Number(options.scale ?? config.scale);
        let steps = Number(options.steps || config.steps);
        const cfgRescale = Number(options.cfgRescale ?? config.cfgRescale);
        const novelAIReferences = this._normalizeNovelAIReferences(options);
        const novelAIVibes = await this._resolveNovelAIVibeReferences(options, config);
        const resolvedSeed = Number.isFinite(seed) && seed >= 0
            ? Math.floor(seed)
            : Math.floor(Math.random() * 4294967295);

        const parameters = {
            width,
            height,
            scale,
            sampler: config.sampler,
            steps,
            n_samples: 1,
            ucPreset: 0,
            qualityToggle: false,
            sm: false,
            sm_dyn: false,
            cfg_rescale: cfgRescale,
            noise_schedule: config.schedule,
            seed: resolvedSeed,
            negative_prompt: negativePrompt
        };

        if (this._isNovelAIV4Model(config.model)) {
            Object.assign(parameters, {
                params_version: 3,
                dynamic_thresholding: false,
                controlnet_strength: 1,
                legacy: false,
                add_original_image: false,
                legacy_v3_extend: false,
                deliberate_euler_ancestral_bug: false,
                v4_prompt: {
                    caption: {
                        base_caption: prompt,
                        char_captions: this._buildNovelAICharCaptions(parsedV4Prompt?.characters, 'charCaption')
                    },
                    use_coords: parsedV4Prompt?.useCoords === true,
                    use_order: true,
                    legacy_uc: false
                },
                v4_negative_prompt: {
                    caption: {
                        base_caption: negativePrompt,
                        char_captions: this._buildNovelAICharCaptions(parsedV4Prompt?.characters, 'negativeCaption')
                    },
                    use_coords: parsedV4Prompt?.useCoords === true,
                    use_order: true,
                    legacy_uc: false
                }
            });
            if (config.novelAISkipCfgCompat !== false) {
                const skipCfgAboveSigma = this._getNovelAISkipCfgAboveSigma(config);
                if (Number.isFinite(skipCfgAboveSigma)) {
                    parameters.skip_cfg_above_sigma = skipCfgAboveSigma;
                }
            }

            if (novelAIReferences.length > 0) {
                Object.assign(parameters, {
                    director_reference_images: novelAIReferences.map(item => item.image),
                    director_reference_descriptions: novelAIReferences.map(() => ({
                        caption: {
                            base_caption: 'character&style',
                            char_captions: []
                        },
                        legacy_uc: false
                    })),
                    director_reference_information_extracted: novelAIReferences.map(item => item.informationExtracted),
                    director_reference_strength_values: novelAIReferences.map(item => item.strength),
                    director_reference_secondary_strength_values: novelAIReferences.map(() => 0)
                });
            }

            if (novelAIVibes.length > 0) {
                Object.assign(parameters, {
                    reference_image_multiple: novelAIVibes.map(item => item.image),
                    reference_information_extracted_multiple: novelAIVibes.map(item => item.informationExtracted),
                    reference_strength_multiple: novelAIVibes.map(item => item.strength),
                    normalize_reference_strength_multiple: this._getBool('phone-image-novelai-vibe-normalize-strength', false)
                });
            }
        }

        return {
            input: prompt,
            model: config.model,
            action: 'generate',
            parameters
        };
    }

    previewFinalPrompt(options = {}) {
        const config = this.getConfig(options);
        const prompt = String(options.prompt || '').trim();
        return {
            provider: config.provider,
            app: String(options.app || '').trim().toLowerCase(),
            model: config.model,
            fixedPrompt: config.fixedPrompt,
            aiPrompt: prompt,
            fixedPromptEnd: config.fixedPromptEnd,
            positivePrompt: config.provider === 'siliconflow'
                ? this._joinPrompt([config.fixedPrompt, prompt, config.fixedPromptEnd], '，')
                : this._joinPrompt([config.fixedPrompt, prompt, config.fixedPromptEnd]),
            negativePrompt: this._joinPrompt([config.negativePrompt, options.negativePrompt]),
            seed: Number(options.seed ?? config.seed)
        };
    }

    async fetchSdModels(baseUrl) {
        const normalizedUrl = this._normalizeSdBaseUrl(baseUrl || this._get('phone-image-sd-url', 'http://127.0.0.1:7860'));
        if (!normalizedUrl) throw new Error('未配置 Stable Diffusion 服务地址');

        const now = Date.now();
        if (
            this._sdModelsCache &&
            this._sdModelsCacheUrl === normalizedUrl &&
            now - this._sdModelsCacheTime < this._sdModelsCacheTtl
        ) {
            return this._sdModelsCache;
        }

        if (this._isSillyTavern()) {
            try {
                const response = await this._sdProxyRequest('models', { url: normalizedUrl });
                if (response.ok) {
                    const data = await response.json().catch(() => null);
                    let models = Array.isArray(data) ? data : [];
                    if (models.length > 0 && models[0]?.value !== undefined && models[0]?.text !== undefined) {
                        models = models.map(item => ({
                            title: String(item.value || item.text || ''),
                            model_name: String(item.text || item.value || '').replace(/\.[^.]+$/, ''),
                            hash: String(item.value || ''),
                            config: null
                        }));
                    }
                    if (models.length > 0) {
                        this._sdModelsCache = models;
                        this._sdModelsCacheUrl = normalizedUrl;
                        this._sdModelsCacheTime = now;
                        return models;
                    }
                }
            } catch (err) {
                console.warn('[SD] 代理获取模型列表失败，尝试直连:', err);
            }
        }

        const endpoints = ['/sdapi/v1/sd-models', '/api/sd-models'];
        let lastError = '';
        for (const endpoint of endpoints) {
            try {
                const response = await this._sdDirectRequest(`${normalizedUrl}${endpoint}`, {
                    method: 'GET',
                    headers: this._buildSdHeaders({ Accept: 'application/json' })
                });
                if (!response.ok) {
                    lastError = `HTTP ${response.status}: ${endpoint}`;
                    continue;
                }
                const models = await response.json();
                if (Array.isArray(models)) {
                    this._sdModelsCache = models;
                    this._sdModelsCacheUrl = normalizedUrl;
                    this._sdModelsCacheTime = now;
                    return models;
                }
                lastError = `${endpoint} 返回格式不是数组`;
            } catch (err) {
                lastError = `${endpoint}: ${err?.message || err}`;
            }
        }

        throw new Error(`SD 模型列表获取失败${lastError ? `: ${lastError}` : ''}。请确认 SD WebUI 已启动并开启 --api。`);
    }

    async _fetchSdProxyList(baseUrl, proxyEndpoint, mapper = item => item) {
        if (!this._isSillyTavern() || !proxyEndpoint) return [];
        const normalizedUrl = this._normalizeSdBaseUrl(baseUrl || this._get('phone-image-sd-url', 'http://127.0.0.1:7860'));
        if (!normalizedUrl) return [];
        try {
            const response = await this._sdProxyRequest(proxyEndpoint, {
                url: normalizedUrl,
                auth: this._get('phone-image-sd-auth', '')
            });
            if (!response.ok) return [];
            const payload = await response.json().catch(() => null);
            return this._mapSdListItems(payload, mapper);
        } catch (err) {
            console.warn(`[SD] 代理获取列表失败 ${proxyEndpoint}:`, err);
            return [];
        }
    }

    async _fetchSdList(baseUrl, endpoints, mapper = item => item, proxyEndpoint = '') {
        const normalizedUrl = this._normalizeSdBaseUrl(baseUrl || this._get('phone-image-sd-url', 'http://127.0.0.1:7860'));
        if (!normalizedUrl) return [];
        const endpointList = Array.isArray(endpoints) ? endpoints : [endpoints];
        for (const endpoint of endpointList) {
            try {
                const response = await this._sdDirectRequest(`${normalizedUrl}${endpoint}`, {
                    method: 'GET',
                    headers: this._buildSdHeaders({ Accept: 'application/json' })
                });
                if (!response.ok) continue;
                const payload = await response.json();
                const directItems = this._mapSdListItems(payload, mapper);
                if (directItems.length) return directItems;
            } catch (err) {
                console.warn(`[SD] 获取列表失败 ${endpoint}:`, err);
            }
        }
        const proxyItems = await this._fetchSdProxyList(normalizedUrl, proxyEndpoint, mapper);
        if (proxyItems.length) return proxyItems;
        return [];
    }

    async _refreshSdLoraIndex(baseUrl) {
        const normalizedUrl = this._normalizeSdBaseUrl(baseUrl || this._get('phone-image-sd-url', 'http://127.0.0.1:7860'));
        if (!normalizedUrl) return;
        const endpoints = ['/sdapi/v1/refresh-loras', '/api/refresh-loras'];
        for (const endpoint of endpoints) {
            try {
                const response = await this._sdDirectRequest(`${normalizedUrl}${endpoint}`, {
                    method: 'POST',
                    headers: this._buildSdHeaders({ Accept: 'application/json' })
                });
                if (response.ok) return;
            } catch (err) {
                console.warn(`[SD] 刷新 LoRA 索引失败 ${endpoint}:`, err);
            }
        }
    }

    async fetchSdSamplers(baseUrl) {
        return this._fetchSdList(baseUrl, ['/sdapi/v1/samplers', '/api/samplers'], item => item?.name || item?.label || item?.value || item?.text, 'samplers');
    }

    async fetchSdSchedulers(baseUrl) {
        return this._fetchSdList(baseUrl, ['/sdapi/v1/schedulers', '/api/schedulers'], item => item?.name || item?.label || item?.value || item?.text, 'schedulers');
    }

    async fetchSdVae(baseUrl) {
        return this._fetchSdList(baseUrl, ['/sdapi/v1/sd-vae', '/api/sd-vae'], item => item?.model_name || item?.name || item?.filename || item?.value || item?.text, 'vaes');
    }

    async fetchSdUpscalers(baseUrl) {
        return this._fetchSdList(baseUrl, ['/sdapi/v1/upscalers', '/api/upscalers'], item => item?.name || item?.label || item?.value || item?.text, 'upscalers');
    }

    async fetchSdLoras(baseUrl) {
        await this._refreshSdLoraIndex(baseUrl).catch(() => {});
        return this._fetchSdList(baseUrl, ['/sdapi/v1/loras', '/api/loras'], item => {
            const name = item?.name || item?.alias || item?.metadata?.ss_output_name || item?.value || item?.text;
            return name || String(item?.path || item?.filename || '').replace(/\\/g, '/').split('/').pop()?.replace(/\.(safetensors|ckpt|pt)$/i, '');
        }, 'loras');
    }

    async fetchSdResources(baseUrl) {
        const [models, samplers, schedulers, vae, upscalers, loras] = await Promise.all([
            this.fetchSdModels(baseUrl).catch(() => []),
            this.fetchSdSamplers(baseUrl).catch(() => []),
            this.fetchSdSchedulers(baseUrl).catch(() => []),
            this.fetchSdVae(baseUrl).catch(() => []),
            this.fetchSdUpscalers(baseUrl).catch(() => []),
            this.fetchSdLoras(baseUrl).catch(() => [])
        ]);
        return { models, samplers, schedulers, vae, upscalers, loras };
    }

    _getComfyUIInputOptions(objectInfo, classType, inputName) {
        const input = objectInfo?.[classType]?.input?.required?.[inputName]
            || objectInfo?.[classType]?.input?.optional?.[inputName]
            || null;
        const first = Array.isArray(input) ? input[0] : input;
        if (!Array.isArray(first)) return [];
        return first.map(item => String(item || '').trim()).filter(Boolean);
    }

    _uniqueComfyUIItems(...groups) {
        const seen = new Set();
        const values = [];
        groups.flat().forEach((item) => {
            const value = String(item || '').trim();
            if (!value || seen.has(value)) return;
            seen.add(value);
            values.push(value);
        });
        return values;
    }

    async fetchComfyUIResources(baseUrl = null, options = {}) {
        const normalizedUrl = baseUrl
            ? this._normalizeComfyUIBaseUrl(baseUrl)
            : this._getComfyUIEndpointUrl(options);
        if (!normalizedUrl) throw new Error('未配置 ComfyUI 服务地址');

        const now = Date.now();
        if (
            this._comfyUIResourcesCache &&
            this._comfyUIResourcesCacheUrl === normalizedUrl &&
            now - this._comfyUIResourcesCacheTime < this._comfyUIResourcesCacheTtl
        ) {
            return this._comfyUIResourcesCache;
        }

        const response = await fetch(`${normalizedUrl}/object_info`, {
            method: 'GET',
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`ComfyUI object_info 读取失败：HTTP ${response.status}${text ? ` ${text.slice(0, 120)}` : ''}`);
        }
        const objectInfo = await response.json();
        const resources = {
            models: this._uniqueComfyUIItems(
                this._getComfyUIInputOptions(objectInfo, 'CheckpointLoaderSimple', 'ckpt_name'),
                this._getComfyUIInputOptions(objectInfo, 'CheckpointLoader', 'ckpt_name'),
                this._getComfyUIInputOptions(objectInfo, 'UNETLoader', 'unet_name')
            ),
            samplers: this._uniqueComfyUIItems(
                this._getComfyUIInputOptions(objectInfo, 'KSampler', 'sampler_name'),
                this._getComfyUIInputOptions(objectInfo, 'KSamplerAdvanced', 'sampler_name')
            ),
            schedulers: this._uniqueComfyUIItems(
                this._getComfyUIInputOptions(objectInfo, 'KSampler', 'scheduler'),
                this._getComfyUIInputOptions(objectInfo, 'KSamplerAdvanced', 'scheduler')
            ),
            vae: this._uniqueComfyUIItems(
                this._getComfyUIInputOptions(objectInfo, 'VAELoader', 'vae_name')
            ),
            clips: this._uniqueComfyUIItems(
                this._getComfyUIInputOptions(objectInfo, 'CLIPLoader', 'clip_name'),
                this._getComfyUIInputOptions(objectInfo, 'DualCLIPLoader', 'clip_name1'),
                this._getComfyUIInputOptions(objectInfo, 'DualCLIPLoader', 'clip_name2')
            ),
            loras: this._uniqueComfyUIItems(
                this._getComfyUIInputOptions(objectInfo, 'LoraLoader', 'lora_name')
            )
        };
        this._comfyUIResourcesCache = resources;
        this._comfyUIResourcesCacheUrl = normalizedUrl;
        this._comfyUIResourcesCacheTime = now;
        return resources;
    }

    _getDefaultComfyUIWorkflow() {
        return {
            "3": {
                inputs: {
                    seed: "%seed%",
                    steps: "%steps%",
                    cfg: "%cfg_scale%",
                    sampler_name: "%sampler_name%",
                    scheduler: "%scheduler%",
                    denoise: 1,
                    model: ["4", 0],
                    positive: ["6", 0],
                    negative: ["7", 0],
                    latent_image: ["5", 0]
                },
                class_type: "KSampler"
            },
            "4": {
                inputs: {
                    ckpt_name: "%MODEL_NAME%"
                },
                class_type: "CheckpointLoaderSimple"
            },
            "5": {
                inputs: {
                    width: "%width%",
                    height: "%height%",
                    batch_size: 1
                },
                class_type: "EmptyLatentImage"
            },
            "6": {
                inputs: {
                    text: "%prompt%",
                    clip: ["4", 1]
                },
                class_type: "CLIPTextEncode"
            },
            "7": {
                inputs: {
                    text: "%negative_prompt%",
                    clip: ["4", 1]
                },
                class_type: "CLIPTextEncode"
            },
            "8": {
                inputs: {
                    samples: ["3", 0],
                    vae: ["4", 2]
                },
                class_type: "VAEDecode"
            },
            "9": {
                inputs: {
                    filename_prefix: "YuzukiPhone",
                    images: ["8", 0]
                },
                class_type: "SaveImage"
            }
        };
    }

    _parseComfyUIWorkflow(workflowText) {
        const raw = String(workflowText || '').trim();
        if (!raw) return this._getDefaultComfyUIWorkflow();
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            throw new Error(`ComfyUI 工作流 JSON 解析失败：${err?.message || err}`);
        }
        if (Array.isArray(parsed?.workflows) && parsed.workflows.length > 0) {
            const first = parsed.workflows[0];
            parsed = typeof first?.workflow === 'string'
                ? JSON.parse(first.workflow)
                : (first?.workflow ?? first?.prompt ?? first);
        } else if (parsed?.workflow && typeof parsed.workflow === 'object') {
            parsed = parsed.workflow;
        } else if (typeof parsed?.workflow === 'string') {
            parsed = JSON.parse(parsed.workflow);
        }
        if (parsed?.nodes && Array.isArray(parsed.nodes)) {
            return this._convertComfyUIWorkflowToApiPrompt(parsed);
        }
        const prompt = parsed?.prompt && typeof parsed.prompt === 'object' ? parsed.prompt : parsed;
        if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) {
            throw new Error('ComfyUI 工作流必须是 API 格式 JSON 对象');
        }
        return prompt;
    }

    _convertComfyUIWorkflowToApiPrompt(workflow) {
        const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
        const links = Array.isArray(workflow?.links) ? workflow.links : [];
        if (!nodes.length) throw new Error('ComfyUI UI 工作流缺少 nodes');

        const nodeById = new Map(nodes.map(node => [String(node?.id || ''), node]).filter(([id]) => id));
        const originByLinkId = new Map();
        const bypassNodes = new Set();
        nodes.forEach((node) => {
            if (Number(node?.mode ?? 0) === 4) bypassNodes.add(String(node?.id || ''));
        });

        const linkMap = new Map();
        links.forEach((link) => {
            if (!Array.isArray(link) || link.length < 5) return;
            const linkId = String(link[0]);
            const originId = String(link[1]);
            const originSlot = Number(link[2]) || 0;
            linkMap.set(linkId, [originId, originSlot]);
            originByLinkId.set(linkId, { originId, originSlot });
        });

        const findBypassSource = (bypassNode, originSlot, seen = new Set()) => {
            const bypassId = String(bypassNode?.id || '');
            if (!bypassId || seen.has(bypassId)) return null;
            seen.add(bypassId);
            const inputs = Array.isArray(bypassNode?.inputs) ? bypassNode.inputs : [];
            const preferred = inputs[originSlot] || inputs.find(input => input?.link !== null && input?.link !== undefined);
            const linkId = preferred?.link !== null && preferred?.link !== undefined ? String(preferred.link) : '';
            const source = linkId ? originByLinkId.get(linkId) : null;
            if (!source) return null;
            if (!bypassNodes.has(source.originId)) return [source.originId, source.originSlot];
            return findBypassSource(nodeById.get(source.originId), source.originSlot, seen);
        };

        const resolveLink = (linkId) => {
            const source = linkMap.get(String(linkId));
            if (!source) return null;
            const [originId, originSlot] = source;
            if (!bypassNodes.has(originId)) return source;
            return findBypassSource(nodeById.get(originId), originSlot) || source;
        };

        const shouldSkipNode = (node) => {
            const mode = Number(node?.mode ?? 0);
            const classType = String(node?.type || '').trim();
            // LiteGraph mode 2 = never, 4 = bypass. Bypass nodes are rewired through resolveLink().
            return mode === 2
                || mode === 4
                || /^(note|markdownnote|label(?:\s*\(rgthree\))?)$/i.test(classType);
        };
        const widgetInputs = (node) => (Array.isArray(node?.inputs) ? node.inputs : [])
            .filter(input => input?.widget && input?.name);
        const seedInputNames = new Set(['seed', 'noise_seed']);
        const controlAfterGenerateValues = new Set(['fixed', 'randomize', 'increment', 'decrement']);
        const prompt = {};

        nodes.forEach((node) => {
            if (!node || shouldSkipNode(node)) return;
            const id = String(node.id || '').trim();
            const classType = String(node.type || '').trim();
            if (!id || !classType) return;

            const inputs = {};
            const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : [];
            let widgetIndex = 0;

            (Array.isArray(node.inputs) ? node.inputs : []).forEach((input) => {
                const name = String(input?.name || '').trim();
                if (!name) return;

                const hasWidget = !!input?.widget;
                const linked = input?.link !== null && input?.link !== undefined && linkMap.has(String(input.link));
                if (linked) {
                    const resolved = resolveLink(input.link);
                    if (resolved) inputs[name] = resolved;
                } else if (hasWidget && widgetIndex < widgets.length) {
                    inputs[name] = widgets[widgetIndex];
                }

                if (hasWidget) {
                    widgetIndex += 1;
                    if (
                        seedInputNames.has(name) &&
                        widgetIndex < widgets.length &&
                        controlAfterGenerateValues.has(String(widgets[widgetIndex] || '').toLowerCase())
                    ) {
                        widgetIndex += 1;
                    }
                }
            });

            // Some primitive/custom nodes expose widget values without declaring widget inputs.
            if (Object.keys(inputs).length === 0 && widgetInputs(node).length === 0 && widgets.length > 0) {
                const classKey = classType.toLowerCase();
                if (/primitive|string|text/.test(classKey)) {
                    inputs.value = widgets[0];
                } else if (/seed/.test(classKey)) {
                    inputs.seed = widgets[0];
                }
            }

            prompt[id] = {
                inputs,
                class_type: classType
            };
            const title = String(node.title || node.properties?.['Node name for S&R'] || '').trim();
            if (title) prompt[id]._meta = { title };
        });

        Object.entries(prompt).forEach(([nodeId, node]) => {
            Object.entries(node.inputs || {}).forEach(([inputName, value]) => {
                if (!Array.isArray(value) || value.length < 1) return;
                if (!prompt[String(value[0])]) {
                    delete node.inputs[inputName];
                }
            });
            if (!node.inputs || typeof node.inputs !== 'object') node.inputs = {};
            if (!node.class_type) delete prompt[nodeId];
        });

        if (Object.keys(prompt).length === 0) {
            throw new Error('ComfyUI UI 工作流转换失败：没有可提交的节点');
        }
        return this._optimizeConvertedComfyUIPrompt(prompt);
    }

    _optimizeConvertedComfyUIPrompt(prompt) {
        const graph = prompt && typeof prompt === 'object' && !Array.isArray(prompt) ? prompt : {};
        const getNode = (id) => graph[String(id)] || null;
        const getInput = (id, name) => getNode(id)?.inputs?.[name];
        const resolveLink = (value) => {
            if (!Array.isArray(value) || value.length < 1) return value;
            const node = getNode(value[0]);
            if (!node) return value;
            const type = String(node.class_type || '');
            if (/^(PrimitiveBoolean|BooleanConstant)$/i.test(type) && Object.prototype.hasOwnProperty.call(node.inputs || {}, 'value')) {
                return Boolean(node.inputs.value);
            }
            if (/^(PrimitiveInt|IntConstant|PrimitiveFloat|FloatConstant)$/i.test(type) && Object.prototype.hasOwnProperty.call(node.inputs || {}, 'value')) {
                return node.inputs.value;
            }
            return value;
        };

        Object.values(graph).forEach((node) => {
            Object.entries(node.inputs || {}).forEach(([inputName, value]) => {
                const resolved = resolveLink(value);
                if (resolved !== value) node.inputs[inputName] = resolved;
            });
        });

        Object.entries(graph).forEach(([nodeId, node]) => {
            const type = String(node?.class_type || '');
            if (!/input switch$/i.test(type)) return;
            const booleanValue = resolveLink(node.inputs?.boolean);
            if (typeof booleanValue !== 'boolean') return;
            const selected = booleanValue
                ? (node.inputs?.conditioning_a ?? node.inputs?.image_a ?? node.inputs?.input_a)
                : (node.inputs?.conditioning_b ?? node.inputs?.image_b ?? node.inputs?.input_b);
            if (selected === undefined) return;
            Object.values(graph).forEach((targetNode) => {
                Object.entries(targetNode.inputs || {}).forEach(([inputName, value]) => {
                    if (Array.isArray(value) && String(value[0]) === nodeId) {
                        targetNode.inputs[inputName] = selected;
                    }
                });
            });
            delete graph[nodeId];
        });

        let changed = true;
        while (changed) {
            changed = false;
            const referenced = new Set();
            Object.values(graph).forEach((node) => {
                Object.values(node.inputs || {}).forEach((value) => {
                    if (Array.isArray(value) && value.length > 0) referenced.add(String(value[0]));
                });
            });
            Object.entries(graph).forEach(([nodeId, node]) => {
                const type = String(node?.class_type || '');
                const isUnreferencedHelper = !referenced.has(nodeId)
                    && /^(Fast Bypasser \(rgthree\)|PrimitiveBoolean|BooleanConstant|PrimitiveInt|IntConstant|PrimitiveFloat|FloatConstant)$/i.test(type);
                if (isUnreferencedHelper) {
                    delete graph[nodeId];
                    changed = true;
                }
            });
        }

        return graph;
    }

    _replaceComfyUIPlaceholders(value, replacements) {
        if (Array.isArray(value)) {
            return value.map(item => this._replaceComfyUIPlaceholders(item, replacements));
        }
        if (value && typeof value === 'object') {
            const next = {};
            Object.entries(value).forEach(([key, item]) => {
                next[key] = this._replaceComfyUIPlaceholders(item, replacements);
            });
            return next;
        }
        if (typeof value !== 'string') return value;
        if (Object.prototype.hasOwnProperty.call(replacements, value)) {
            return replacements[value];
        }
        return value.replace(/%[A-Za-z0-9_]+%/g, token => {
            if (!Object.prototype.hasOwnProperty.call(replacements, token)) return token;
            const replacement = replacements[token];
            return replacement === null || replacement === undefined ? '' : String(replacement);
        });
    }

    _parseComfyUINodeMapping(mappingText) {
        const raw = typeof mappingText === 'string' ? mappingText.trim() : mappingText;
        if (!raw) return {};
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
        try {
            const parsed = JSON.parse(String(raw));
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('映射配置必须是 JSON 对象');
            }
            return parsed;
        } catch (err) {
            throw new Error(`ComfyUI 节点映射 JSON 解析失败：${err?.message || err}`);
        }
    }

    _normalizeComfyUINodeBinding(binding, fallbackInput = '') {
        if (!binding) return null;
        if (typeof binding === 'string') {
            const text = binding.trim();
            if (!text) return null;
            const match = /^([^.\s]+)(?:\.(.+))?$/.exec(text);
            return {
                nodeId: match ? match[1] : text,
                input: match && match[2] ? match[2] : fallbackInput,
                mode: 'replace',
                skipEmpty: true
            };
        }
        if (typeof binding !== 'object' || Array.isArray(binding)) return null;
        const nodeId = String(binding.nodeId ?? binding.node ?? binding.id ?? '').trim();
        const inputValue = binding.input ?? binding.field ?? binding.name ?? fallbackInput ?? '';
        const input = String(inputValue).trim();
        if (!nodeId || !input) return null;
        return {
            nodeId,
            input,
            mode: String(binding.mode || 'replace').trim().toLowerCase() || 'replace',
            optional: binding.optional !== false,
            skipEmpty: binding.skipEmpty !== false
        };
    }

    _setComfyUINodeInput(workflow, binding, value) {
        const normalized = this._normalizeComfyUINodeBinding(binding);
        if (!normalized) return false;
        const node = workflow?.[normalized.nodeId];
        if (!node || typeof node !== 'object') {
            if (normalized.optional === false) throw new Error(`ComfyUI 节点映射找不到节点：${normalized.nodeId}`);
            return false;
        }
        if (!node.inputs || typeof node.inputs !== 'object') node.inputs = {};
        if ((value === null || value === undefined || value === '') && normalized.skipEmpty !== false) {
            return false;
        }
        if (this._isUnsafeComfyUITextBinding(node, normalized.input, value)) {
            console.warn('[ComfyUI] 已跳过错误的文本映射，不能把提示词写入采样器 conditioning 输入:', {
                nodeId: normalized.nodeId,
                classType: node.class_type,
                input: normalized.input
            });
            return false;
        }
        const current = node.inputs[normalized.input];
        const mode = normalized.mode;
        if ((mode === 'append' || mode === 'prepend') && typeof current === 'string') {
            const nextValue = value === null || value === undefined ? '' : String(value);
            node.inputs[normalized.input] = mode === 'append'
                ? [current, nextValue].filter(Boolean).join(current && nextValue ? ', ' : '')
                : [nextValue, current].filter(Boolean).join(nextValue && current ? ', ' : '');
        } else {
            node.inputs[normalized.input] = value;
        }
        return true;
    }

    _isUnsafeComfyUITextBinding(node, inputName, value) {
        if (typeof value !== 'string') return false;
        const classType = String(node?.class_type || '');
        const input = String(inputName || '').trim().toLowerCase();
        return /ksampler|samplercustom|basicguider|cfgguider/i.test(classType)
            && /^(positive|negative|conditioning|positive_cond|negative_cond)$/.test(input);
    }

    _applyComfyUINodeMappings(workflow, mappingText, values) {
        const explicitMapping = this._parseComfyUINodeMapping(mappingText);
        const guessedMapping = this._guessComfyUINodeMapping(workflow);
        const mapping = explicitMapping && Object.keys(explicitMapping).length > 0
            ? { ...guessedMapping, ...explicitMapping }
            : guessedMapping;
        if (!mapping || Object.keys(mapping).length === 0) return workflow;

        const mappedValues = { ...values };
        const hasFixedPromptBinding = Object.prototype.hasOwnProperty.call(mapping, 'fixedPrompt')
            || Object.prototype.hasOwnProperty.call(mapping, 'fixed_prompt');
        if (hasFixedPromptBinding && Object.prototype.hasOwnProperty.call(mapping, 'prompt')) {
            mappedValues.positivePrompt = this._joinPrompt([values.promptText, values.fixedPromptEnd]);
        }

        const aliases = {
            prompt: 'positivePrompt',
            positive: 'positivePrompt',
            positive_prompt: 'positivePrompt',
            prompt_text: 'positivePrompt',
            text: 'positivePrompt',
            clip_l: 'positivePrompt',
            text_l: 'positivePrompt',
            text_g: 'positivePrompt',
            t5xxl: 'positivePrompt',
            fixed_prompt: 'fixedPrompt',
            fixed_prompt_end: 'fixedPromptEnd',
            negative: 'negativePrompt',
            negative_prompt: 'negativePrompt',
            cfg: 'scale',
            cfg_scale: 'scale',
            cfg_rescale: 'cfgRescale',
            rescale_cfg: 'cfgRescale',
            guidance_rescale: 'cfgRescale',
            sampler_name: 'sampler',
            width: 'width',
            height: 'height',
            steps: 'steps',
            seed: 'seed',
            scheduler: 'scheduler',
            model: 'model',
            modelName: 'model',
            vae: 'vae',
            clip: 'clip',
            reference_image: 'referenceImage',
            reference_image_filename: 'referenceImage'
        };
        const fallbackInputs = {
            positivePrompt: 'text',
            fixedPrompt: 'value',
            fixedPromptEnd: 'value',
            negativePrompt: 'text',
            width: 'width',
            height: 'height',
            steps: 'steps',
            scale: 'cfg',
            cfgRescale: 'cfg_rescale',
            seed: 'seed',
            sampler: 'sampler_name',
            scheduler: 'scheduler',
            model: 'ckpt_name',
            vae: 'vae_name',
            clip: 'clip_name',
            referenceImage: 'image'
        };

        Object.entries(mapping).forEach(([rawKey, rawBinding]) => {
            const valueKey = aliases[rawKey] || rawKey;
            if (!Object.prototype.hasOwnProperty.call(mappedValues, valueKey)) return;
            const value = mappedValues[valueKey];
            const bindings = Array.isArray(rawBinding) ? rawBinding : [rawBinding];
            bindings.forEach(binding => {
                const normalized = this._normalizeComfyUINodeBinding(binding, fallbackInputs[valueKey] || '');
                if (normalized) this._setComfyUINodeInput(workflow, normalized, value);
            });
        });

        return workflow;
    }

    _guessComfyUINodeMapping(workflow = {}) {
        const entries = Object.entries(workflow || {});
        const hasInput = (node, input) => node?.inputs && Object.prototype.hasOwnProperty.call(node.inputs, input);
        const promptInputNames = ['text', 'value', 'clip_l', 'text_l', 'text_g', 't5xxl', 'prompt', 'positive'];
        const isPromptTextNode = (node) => {
            const classType = String(node?.class_type || '');
            return !/ksampler|samplercustom|basicguider|cfgguider/i.test(classType);
        };
        const getPromptInputs = (node) => promptInputNames.filter(input => hasInput(node, input));
        const titleOf = (node) => String(node?._meta?.title || '').trim();
        const textOf = ([id, node]) => `${node?.class_type || ''} ${titleOf(node)} ${JSON.stringify(node?.inputs || {})}`.toLowerCase();
        const mapping = {};

        const stringCandidates = entries
            .filter(([, node]) => /string|text|primitive/i.test(String(node?.class_type || '')) && hasInput(node, 'value'))
            .map(([id, node]) => ({ id, node, text: textOf([id, node]) }));
        const encoderCandidates = entries
            .filter(([, node]) => isPromptTextNode(node) && getPromptInputs(node).length > 0)
            .map(([id, node]) => ({ id, node, text: textOf([id, node]), inputs: getPromptInputs(node) }));
        const scorePromptCandidate = (item) => {
            let score = 0;
            if (/prompt|提示词/.test(item.text)) score += 20;
            if (/clip text encode|cliptextencode|conditioning|encode/i.test(item.text)) score += 18;
            if (item.inputs?.some(input => /^(clip_l|text_l|text_g|t5xxl)$/.test(input))) score += 16;
            if (/main|primary|主提示词/.test(item.text)) score += 8;
            if (/custom|upscale|sd upscale|prefix|额外|additional|negative|负面/.test(item.text)) score -= 30;
            return score;
        };
        const promptCandidate = [...stringCandidates]
            .sort((a, b) => scorePromptCandidate(b) - scorePromptCandidate(a))
            .find(item => scorePromptCandidate(item) > 0);
        if (promptCandidate?.id) {
            mapping.prompt = `${promptCandidate.id}.value`;
        } else {
            const encoderPrompt = [...encoderCandidates]
                .sort((a, b) => scorePromptCandidate(b) - scorePromptCandidate(a))
                .find(item => scorePromptCandidate(item) > 0)
                || encoderCandidates.find(item => /cliptextencode|encode/i.test(String(item.node?.class_type || '')));
            if (encoderPrompt?.id) {
                const bindings = encoderPrompt.inputs
                    .filter(input => !/negative|负面/i.test(`${input} ${encoderPrompt.text}`))
                    .map(input => `${encoderPrompt.id}.${input}`);
                if (bindings.length > 0) mapping.prompt = bindings.length === 1 ? bindings[0] : bindings;
            }
        }

        const fixedCandidate = stringCandidates.find(item => /prefix|额外|additional/.test(item.text));
        if (fixedCandidate?.id) mapping.fixedPrompt = `${fixedCandidate.id}.value`;

        const negativeCandidate = entries.find(entry => isPromptTextNode(entry[1]) && /negative|负面/.test(textOf(entry)) && getPromptInputs(entry[1]).length > 0);
        if (negativeCandidate) {
            const inputs = getPromptInputs(negativeCandidate[1]);
            const bindings = inputs.map(input => `${negativeCandidate[0]}.${input}`);
            mapping.negative_prompt = bindings.length === 1 ? bindings[0] : bindings;
        }

        const latentCandidate = entries.find(([, node]) => /emptylatentimage/i.test(String(node?.class_type || '')) && hasInput(node, 'width') && hasInput(node, 'height'));
        if (latentCandidate) {
            mapping.width = `${latentCandidate[0]}.width`;
            mapping.height = `${latentCandidate[0]}.height`;
        }

        const seedCandidate = entries.find(([id, node]) => /seed/i.test(`${node?.class_type || ''} ${titleOf(node)}`) && hasInput(node, 'seed') && !/ksampler/i.test(String(node?.class_type || '')))
            || entries.find(([id, node]) => /(seed|ksampler)/i.test(`${node?.class_type || ''} ${titleOf(node)}`) && (hasInput(node, 'seed') || hasInput(node, 'noise_seed')));
        if (seedCandidate) mapping.seed = `${seedCandidate[0]}.${hasInput(seedCandidate[1], 'seed') ? 'seed' : 'noise_seed'}`;

        const cfgRescaleCandidate = entries.find(([, node]) => ['cfg_rescale', 'rescale_cfg', 'guidance_rescale'].some(input => hasInput(node, input)));
        if (cfgRescaleCandidate) {
            const inputName = ['cfg_rescale', 'rescale_cfg', 'guidance_rescale'].find(input => hasInput(cfgRescaleCandidate[1], input));
            if (inputName) mapping.cfg_rescale = `${cfgRescaleCandidate[0]}.${inputName}`;
        }

        return mapping;
    }

    _buildComfyUIWorkflow(options, config, referenceImage = null) {
        const prompt = String(options.prompt || '').trim();
        if (!prompt) throw new Error('缺少生图提示词');

        const appKey = String(options.app || '').trim().toLowerCase();
        const appDefaults = this._getAppDefaultSize(appKey);
        let width = Number(options.width || config.width);
        let height = Number(options.height || config.height);
        let steps = Number(options.steps || config.steps);
        let scale = Number(options.scale ?? config.scale);
        let cfgRescale = Number(options.cfgRescale ?? config.cfgRescale);
        let seed = Number(options.seed ?? config.seed);

        if (appKey === 'honey') {
            if (!Number.isFinite(width) || !Number.isFinite(height) || width < 512 || height < 768) {
                width = appDefaults.width;
                height = appDefaults.height;
            }
            if (!Number.isFinite(steps) || steps < 20) steps = 28;
            if (!Number.isFinite(scale) || scale < 1) scale = 7;
        }
        width = Math.max(64, Math.min(2048, Math.round(width || appDefaults.width)));
        height = Math.max(64, Math.min(2048, Math.round(height || appDefaults.height)));
        steps = Math.max(1, Math.min(150, Math.round(steps || 28)));
        scale = Number.isFinite(scale) ? Math.max(0, Math.min(50, scale)) : 7;
        cfgRescale = Number.isFinite(cfgRescale) ? Math.max(0, Math.min(1, cfgRescale)) : 0;
        if (!Number.isFinite(seed) || seed < 0) {
            seed = Math.floor(Math.random() * 4294967295);
        } else {
            seed = Math.floor(seed);
        }

        const positivePrompt = this._joinPrompt([config.fixedPrompt, prompt, config.fixedPromptEnd]);
        const negativePrompt = this._joinPrompt([config.negativePrompt, options.negativePrompt]);
        const replacements = {
            '%prompt%': positivePrompt,
            '%positive_prompt%': positivePrompt,
            '%negative_prompt%': negativePrompt,
            '%width%': width,
            '%height%': height,
            '%steps%': steps,
            '%cfg_scale%': scale,
            '%cfg%': scale,
            '%cfg_rescale%': cfgRescale,
            '%rescale_cfg%': cfgRescale,
            '%guidance_rescale%': cfgRescale,
            '%seed%': seed,
            '%sampler_name%': config.comfyuiSampler,
            '%scheduler%': config.comfyuiScheduler,
            '%MODEL_NAME%': config.comfyuiModel,
            '%model%': config.comfyuiModel,
            '%VAE%': config.comfyuiVae,
            '%vae%': config.comfyuiVae,
            '%CLIP_NAME%': config.comfyuiClip,
            '%clip_name%': config.comfyuiClip,
            '%clip%': config.comfyuiClip,
            '%ipa%': '',
            '%c_quanzhong%': scale,
            '%c_idquanzhong%': scale,
            '%c_xijie%': scale,
            '%c_fenwei%': scale,
            '%reference_image%': referenceImage?.filename || '',
            '%reference_image_filename%': referenceImage?.filename || '',
            '%reference_image_subfolder%': referenceImage?.subfolder || '',
            '%reference_image_type%': referenceImage?.type || 'input',
            '%comfyui_reference_image%': referenceImage?.filename || '',
            '%comfyuicankaoImage%': referenceImage?.filename || '',
            '%comfyuicankaotupian%': referenceImage?.filename || ''
        };
        const workflowTemplate = this._parseComfyUIWorkflow(config.comfyuiWorkflow);
        const requiresModel = !String(config.comfyuiWorkflow || '').trim()
            || JSON.stringify(workflowTemplate).includes('%MODEL_NAME%')
            || JSON.stringify(workflowTemplate).includes('%model%');
        const requiresReferenceImage = JSON.stringify(workflowTemplate).includes('%reference_image%')
            || JSON.stringify(workflowTemplate).includes('%reference_image_filename%')
            || JSON.stringify(workflowTemplate).includes('%comfyui_reference_image%')
            || JSON.stringify(workflowTemplate).includes('%comfyuicankaoImage%')
            || JSON.stringify(workflowTemplate).includes('%comfyuicankaotupian%');
        const workflow = this._replaceComfyUIPlaceholders(workflowTemplate, replacements);
        this._applyComfyUINodeMappings(workflow, config.comfyuiNodeMapping, {
            promptText: prompt,
            positivePrompt,
            fixedPrompt: String(config.fixedPrompt || '').trim(),
            fixedPromptEnd: String(config.fixedPromptEnd || '').trim(),
            negativePrompt,
            width,
            height,
            steps,
            scale,
            cfgRescale,
            seed,
            sampler: config.comfyuiSampler,
            scheduler: config.comfyuiScheduler,
            model: config.comfyuiModel,
            vae: config.comfyuiVae,
            clip: config.comfyuiClip,
            referenceImage: referenceImage?.filename || ''
        });
        return { workflow, positivePrompt, negativePrompt, width, height, steps, scale, cfgRescale, seed, requiresModel, requiresReferenceImage };
    }

    _extractComfyUIImage(historyPayload, promptId) {
        const root = promptId && historyPayload?.[promptId] ? historyPayload[promptId] : historyPayload;
        const outputs = root?.outputs || historyPayload?.outputs || {};
        for (const output of Object.values(outputs || {})) {
            const images = Array.isArray(output?.images) ? output.images : [];
            if (images.length > 0) {
                const image = images[0] || {};
                return {
                    filename: String(image.filename || '').trim(),
                    subfolder: String(image.subfolder || '').trim(),
                    type: String(image.type || 'output').trim() || 'output',
                    mediaType: 'image'
                };
            }
            const videos = Array.isArray(output?.videos) ? output.videos : [];
            if (videos.length > 0) {
                const video = videos[0] || {};
                return {
                    filename: String(video.filename || '').trim(),
                    subfolder: String(video.subfolder || '').trim(),
                    type: String(video.type || 'output').trim() || 'output',
                    mediaType: 'video'
                };
            }
            const gifs = Array.isArray(output?.gifs) ? output.gifs : [];
            if (gifs.length > 0) {
                const gif = gifs[0] || {};
                return {
                    filename: String(gif.filename || '').trim(),
                    subfolder: String(gif.subfolder || '').trim(),
                    type: String(gif.type || 'output').trim() || 'output',
                    mediaType: 'image'
                };
            }
        }
        return null;
    }

    async _waitForComfyUIHistory(baseUrl, promptId, signal = null) {
        const startedAt = Date.now();
        const timeoutMs = 180000;
        while (Date.now() - startedAt < timeoutMs) {
            if (signal?.aborted) throw new Error('ComfyUI 请求已取消');
            const response = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`, {
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal
            });
            if (response.ok) {
                const payload = await response.json().catch(() => null);
                const image = this._extractComfyUIImage(payload, promptId);
                if (image?.filename) return image;
                const status = payload?.[promptId]?.status || payload?.status || {};
                const messages = Array.isArray(status?.messages) ? status.messages : [];
                const errorMessage = messages
                    .map(item => Array.isArray(item) ? item.join(' ') : String(item || ''))
                    .find(text => /error|exception/i.test(text));
                if (errorMessage) throw new Error(`ComfyUI 执行失败：${errorMessage.slice(0, 240)}`);
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new Error('ComfyUI 生成超时，请检查工作流或本地队列');
    }

    async _readComfyUIOutput(baseUrl, output, signal = null) {
        const params = new URLSearchParams({
            filename: output.filename,
            subfolder: output.subfolder || '',
            type: output.type || 'output'
        });
        const response = await fetch(`${baseUrl}/view?${params.toString()}`, {
            method: 'GET',
            signal
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`ComfyUI 输出读取失败：HTTP ${response.status}${text ? ` ${text.slice(0, 120)}` : ''}`);
        }
        const blob = await response.blob();
        if (!blob || blob.size <= 0) throw new Error('ComfyUI 返回空输出');
        return await this._blobToDataUrl(blob);
    }

    async _readComfyUIImage(baseUrl, image, signal = null) {
        return this._readComfyUIOutput(baseUrl, image, signal);
    }

    async _uploadComfyUIReferenceImage(baseUrl, imageData, signal = null) {
        const blob = this._dataUrlToBlob(imageData);
        if (!blob) return null;
        const ext = /jpe?g/i.test(blob.type) ? 'jpg' : (/webp/i.test(blob.type) ? 'webp' : 'png');
        const filename = `yuzuki_ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const formData = new FormData();
        formData.append('image', blob, filename);
        formData.append('type', 'input');
        formData.append('overwrite', 'true');

        const response = await fetch(`${baseUrl}/upload/image`, {
            method: 'POST',
            body: formData,
            signal
        });
        const text = await response.text();
        let payload = null;
        try {
            payload = text ? JSON.parse(text) : null;
        } catch (err) {
            payload = null;
        }
        if (!response.ok) {
            const message = payload?.error || payload?.message || text;
            throw new Error(`ComfyUI 参考图上传失败：HTTP ${response.status}${message ? ` ${String(message).slice(0, 160)}` : ''}`);
        }
        return {
            filename: String(payload?.name || payload?.filename || filename).trim() || filename,
            subfolder: String(payload?.subfolder || '').trim(),
            type: String(payload?.type || 'input').trim() || 'input'
        };
    }

    buildSdModelHashMap(models) {
        const map = new Map();
        (Array.isArray(models) ? models : []).forEach((model) => {
            const names = [
                model?.model_name,
                model?.name,
                model?.title,
                model?.value,
                model?.text
            ].map(item => String(item || '').trim()).filter(Boolean);
            const hash = String(model?.hash || model?.sha256 || '').trim();
            if (!hash) return;
            names.forEach((name) => {
                map.set(name, hash);
                map.set(name.toLowerCase(), hash);
                map.set(name.replace(/\.[^.]+$/, ''), hash);
                map.set(name.replace(/\.[^.]+$/, '').toLowerCase(), hash);
            });
        });
        return map;
    }

    async getSdModelHash(baseUrl, modelName) {
        const name = String(modelName || '').trim();
        if (!name) return null;
        const models = await this.fetchSdModels(baseUrl);
        const map = this.buildSdModelHashMap(models);
        return map.get(name) || map.get(name.toLowerCase()) || null;
    }

    _extractSdImage(payload) {
        return this._extractImageResult(payload, { allowUrl: true });
    }

    _extractOpenAIImage(payload) {
        return this._extractImageResult(payload, { allowUrl: true });
    }

    _resolveOpenAIEndpoint(config) {
        const site = String(config.openaiSite || 'official').trim() || 'official';
        const baseUrl = site === 'public'
            ? this._normalizeApiBaseUrl(config.openaiPublicUrl)
            : (site === 'custom'
                ? this._normalizeApiBaseUrl(config.openaiCustomUrl)
                : 'https://api.openai.com');
        if (!baseUrl) throw new Error(site === 'public' ? '请先填写 GPT 公益站点 Base URL' : '请先填写 GPT 自定义 Base URL');
        if (/\/(?:v1\/)?images\/generations$/i.test(baseUrl)) return baseUrl;
        if (/\/images$/i.test(baseUrl)) return `${baseUrl}/generations`;
        if (/\/v1$/i.test(baseUrl)) return `${baseUrl}/images/generations`;
        return `${baseUrl}/v1/images/generations`;
    }

    _resolveOpenAIModelsEndpoint(config) {
        const generationEndpoint = this._resolveOpenAIEndpoint(config);
        return generationEndpoint.replace(/\/(?:images\/generations|images\/edits|images\/variations)$/i, '/models');
    }

    _resolveOpenAIChatEndpoint(config) {
        const site = String(config.openaiSite || 'official').trim() || 'official';
        const baseUrl = site === 'public'
            ? this._normalizeApiBaseUrl(config.openaiPublicUrl)
            : (site === 'custom'
                ? this._normalizeApiBaseUrl(config.openaiCustomUrl)
                : 'https://api.openai.com');
        if (!baseUrl) throw new Error(site === 'public' ? '请先填写 GPT 公益站点 Base URL' : '请先填写 GPT 自定义 Base URL');
        if (/\/(?:v1\/)?chat\/completions$/i.test(baseUrl)) return baseUrl;
        if (/\/chat$/i.test(baseUrl)) return `${baseUrl}/completions`;
        if (/\/v1$/i.test(baseUrl)) return `${baseUrl}/chat/completions`;
        return `${baseUrl}/v1/chat/completions`;
    }

    _resolveOpenAIRelayEndpoint(config, endpoint) {
        if (String(config.openaiSite || '').trim() !== 'public') return endpoint;
        const relayBaseUrl = this._normalizeApiBaseUrl(config.openaiPublicRelayUrl);
        if (!relayBaseUrl) return endpoint;
        const relayPath = /\/models$/i.test(endpoint) ? '/v1/models' : '/v1/images/generations';
        if (/\/v1\/models$/i.test(relayBaseUrl) || /\/v1\/images\/generations$/i.test(relayBaseUrl)) return relayBaseUrl;
        if (/\/v1$/i.test(relayBaseUrl)) return `${relayBaseUrl}${relayPath.replace(/^\/v1/i, '')}`;
        return `${relayBaseUrl}${relayPath}`;
    }

    _getOpenAIProxyBaseUrl(endpoint) {
        return String(endpoint || '').trim().replace(/\/(?:chat\/completions|images\/generations|images\/edits|images\/variations|models)\/?$/i, '').replace(/\/+$/, '');
    }

    _getOpenAIAuthHeader(config) {
        const apiKey = String(config.apiKey || '').trim();
        return apiKey ? (apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`) : '';
    }

    _buildOpenAIProxyPayload(config, endpoint, extra = {}) {
        const authHeader = this._getOpenAIAuthHeader(config);
        const baseUrl = this._getOpenAIProxyBaseUrl(endpoint);
        const customHeaders = { 'Content-Type': 'application/json' };
        if (authHeader) customHeaders.Authorization = authHeader;
        return {
            chat_completion_source: 'openai',
            reverse_proxy: baseUrl || endpoint,
            custom_url: endpoint,
            proxy_password: String(config.apiKey || '').trim(),
            custom_include_headers: customHeaders,
            ...extra
        };
    }

    async _fetchOpenAIViaSillyTavernProxy(config, endpoint, payload, options = {}) {
        const proxyPayload = this._buildOpenAIProxyPayload(config, endpoint, payload);
        let response = await this._stProxyRequest('/api/backends/chat-completions/generate', proxyPayload, {
            signal: options.signal
        });
        if (!response.ok) {
            const errText = await response.clone().text().catch(() => '');
            if (/csrf|forbidden|unauthori[sz]ed|invalid token/i.test(`${response.status} ${errText}`)) {
                response = await this._stProxyRequest('/api/backends/chat-completions/generate', proxyPayload, {
                    forceRefresh: true,
                    signal: options.signal
                });
            }
        }
        const text = await response.text();
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
        if (!response.ok) {
            const msg = parsed?.error?.message || parsed?.message || parsed?.error || text || '';
            throw new Error(`酒馆后端代理请求失败 (${response.status})${msg ? `: ${String(msg).slice(0, 240)}` : ''}`);
        }
        return parsed || text;
    }

    async _fetchOpenAIModelsViaSillyTavernProxy(config, targetEndpoint, signal) {
        const proxyPayload = this._buildOpenAIProxyPayload(config, targetEndpoint);
        let response = await this._stProxyRequest('/api/backends/chat-completions/status', proxyPayload, { signal });
        if (!response.ok) {
            const errText = await response.clone().text().catch(() => '');
            if (/csrf|forbidden|unauthori[sz]ed|invalid token/i.test(`${response.status} ${errText}`)) {
                response = await this._stProxyRequest('/api/backends/chat-completions/status', proxyPayload, {
                    forceRefresh: true,
                    signal
                });
            }
        }
        const text = await response.text();
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
        if (!response.ok) {
            const msg = parsed?.error?.message || parsed?.message || parsed?.error || text || '';
            throw new Error(`酒馆后端代理模型拉取失败 (${response.status})${msg ? `: ${String(msg).slice(0, 240)}` : ''}`);
        }
        return parsed;
    }

    _buildOpenAIHeaders(config, extra = {}) {
        const headers = {
            ...extra,
            Authorization: `Bearer ${config.apiKey}`
        };
        if (String(config.openaiSite || '').trim() === 'public' && String(config.openaiPublicRelayUrl || '').trim()) {
            headers['X-OpenAI-Image-Relay-Target'] = this._normalizeApiBaseUrl(config.openaiPublicUrl);
        }
        return headers;
    }

    _normalizeOpenAIModelItems(payload) {
        const source = Array.isArray(payload)
            ? payload
            : (Array.isArray(payload?.data)
                ? payload.data
                : (Array.isArray(payload?.models)
                    ? payload.models
                    : (Array.isArray(payload?.result) ? payload.result : [])));
        const seen = new Set();
        return source
            .map((item) => {
                const id = typeof item === 'string'
                    ? item
                    : String(item?.id || item?.model || item?.name || '').trim();
                if (!id || seen.has(id)) return null;
                seen.add(id);
                const name = typeof item === 'string'
                    ? item
                    : String(item?.display_name || item?.displayName || item?.name || item?.id || id).trim();
                return { id, name: name || id };
            })
            .filter(Boolean);
    }

    _rankOpenAIImageModel(model) {
        const id = String(model?.id || '').toLowerCase();
        if (!id) return 999;
        if (id === 'gpt-image-2') return 0;
        if (/^gpt-image-2(?:-|$)/.test(id)) return 1;
        if (id === 'gpt-image-1.5') return 2;
        if (/^gpt-image-1\.5(?:-|$)/.test(id)) return 3;
        if (id === 'gpt-image-1') return 4;
        if (id === 'gpt-image-1-mini') return 5;
        if (/image|dall-e|flux|kolors|stable|sdxl|midjourney|mj/i.test(id)) return 20;
        return 100;
    }

    async fetchOpenAIModels(overrides = {}) {
        const config = {
            ...this.getConfig({ ...overrides, provider: 'openai' }),
            ...overrides,
            provider: 'openai'
        };
        if (!String(config.apiKey || '').trim()) throw new Error('请先填写 GPT 生图 API Key');
        const targetEndpoint = this._resolveOpenAIModelsEndpoint(config);
        const endpoint = this._resolveOpenAIRelayEndpoint(config, targetEndpoint);
        let payload = null;
        let proxyError = null;
        if (this._isSillyTavern() && !String(config.openaiPublicRelayUrl || '').trim()) {
            try {
                payload = await this._fetchOpenAIModelsViaSillyTavernProxy(config, targetEndpoint, overrides.signal);
            } catch (err) {
                proxyError = err;
            }
        }
        if (!payload) {
            const response = await fetch(endpoint, {
                method: 'GET',
                headers: this._buildOpenAIHeaders(config, {
                    Accept: 'application/json'
                }),
                signal: overrides.signal
            });
            const text = await response.text();
            try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = null; }
            if (!response.ok) {
                const msg = payload?.error?.message || payload?.message || payload?.error || text || '';
                const proxyMsg = proxyError ? `后端代理失败: ${proxyError.message}\n` : '';
                throw new Error(`${proxyMsg}GPT 模型列表拉取失败 (${response.status})${msg ? `: ${String(msg).slice(0, 180)}` : ''}`);
            }
        }
        const allModels = this._normalizeOpenAIModelItems(payload);
        const imageModels = allModels
            .filter((item) => this._rankOpenAIImageModel(item) < 100)
            .sort((a, b) => this._rankOpenAIImageModel(a) - this._rankOpenAIImageModel(b) || a.id.localeCompare(b.id));
        return {
            endpoint: targetEndpoint,
            relayEndpoint: endpoint !== targetEndpoint ? endpoint : '',
            models: imageModels.length ? imageModels : allModels,
            allModels,
            filtered: imageModels.length > 0
        };
    }

    _getOpenAIImageSize(model, width, height) {
        const modelName = String(model || '').trim().toLowerCase();
        const w = Number(width) || 1024;
        const h = Number(height) || 1024;
        const ratio = w / Math.max(1, h);
        if (/^dall-e-3$/i.test(modelName)) {
            if (ratio > 1.2) return '1792x1024';
            if (ratio < 0.8) return '1024x1792';
            return '1024x1024';
        }
        if (/^dall-e-2$/i.test(modelName)) {
            return '1024x1024';
        }
        if (ratio > 1.2) return '1536x1024';
        if (ratio < 0.8) return '1024x1536';
        return '1024x1024';
    }

    _normalizeOpenAIImageQuality(model, quality) {
        const modelName = String(model || '').trim().toLowerCase();
        const value = String(quality || 'auto').trim().toLowerCase();
        if (!value || value === 'auto') return '';
        if (modelName === 'dall-e-3') {
            return value === 'high' ? 'hd' : 'standard';
        }
        if (modelName === 'dall-e-2') return '';
        return ['low', 'medium', 'high'].includes(value) ? value : '';
    }

    _shouldPreferOpenAIBase64(config) {
        const site = String(config?.openaiSite || '').trim().toLowerCase();
        return site === 'public' || site === 'custom';
    }

    _withOpenAIBase64OutputHints(payload) {
        return {
            ...payload,
            response_format: 'b64_json',
            return_base64: true,
            extra_body: {
                ...(payload?.extra_body || {}),
                response_format: 'b64_json'
            }
        };
    }

    _isOpenAIBase64HintRejected(status, payload, text = '') {
        const detail = [
            payload?.error?.message,
            payload?.message,
            payload?.error,
            text
        ].map(item => String(item || '')).join('\n');
        return Number(status) >= 400 && Number(status) < 500
            && /response_format|return_base64|extra_body|unknown parameter|unsupported parameter|unrecognized|invalid/i.test(detail);
    }

    _extractOpenAIChatImage(payload) {
        const direct = this._extractOpenAIImage(payload);
        if (direct) return direct;
        const content = payload?.summary
            || payload?.choices?.[0]?.message?.content
            || payload?.choices?.[0]?.text
            || payload?.data?.choices?.[0]?.message?.content
            || payload?.response
            || payload?.text
            || '';
        return this._extractOpenAIImage(content);
    }

    _summarizeOpenAIImagePayload(payload) {
        try {
            if (payload === null || payload === undefined) return '空响应';
            if (typeof payload === 'string') return payload.replace(/\s+/g, ' ').slice(0, 300);
            const content = payload?.summary
                || payload?.choices?.[0]?.message?.content
                || payload?.choices?.[0]?.text
                || payload?.data?.choices?.[0]?.message?.content
                || payload?.message
                || payload?.error?.message
                || payload?.message?.content
                || payload?.response
                || payload?.text
                || '';
            if (content) return String(content).replace(/\s+/g, ' ').slice(0, 300);
            return JSON.stringify(payload).replace(/\s+/g, ' ').slice(0, 300);
        } catch {
            return '无法解析响应摘要';
        }
    }

    async _generateOpenAIChatImage(options, config) {
        const prompt = String(options.prompt || '').trim();
        if (!prompt) throw new Error('缺少生图提示词');
        if (!String(config.apiKey || '').trim()) throw new Error('请先填写 GPT 生图 API Key');
        if (!this._isSillyTavern()) throw new Error('GPT 聊天接口生图需要在 SillyTavern 内通过酒馆后端代理请求');

        const width = Number(options.width || config.width);
        const height = Number(options.height || config.height);
        const model = String(config.model || 'gpt-image-2').trim() || 'gpt-image-2';
        const requestedSize = this._getOpenAIImageSize(model, width, height);
        const endpoint = this._resolveOpenAIChatEndpoint(config);
        const fullPrompt = this._joinPrompt([config.fixedPrompt, prompt, config.fixedPromptEnd], '\n');
        const negativePrompt = this._joinPrompt([config.negativePrompt, options.negativePrompt]);
        const userPrompt = [
            '请根据以下提示词生成一张图片，并且只返回最终图片。',
            `尺寸：${requestedSize}`,
            negativePrompt ? `避免：${negativePrompt}` : '',
            '',
            fullPrompt
        ].filter(Boolean).join('\n');
        const payload = {
            model,
            messages: [{ role: 'user', content: userPrompt }],
            stream: false,
            temperature: 0.7,
            max_tokens: 4096,
            mode: 'chat',
            instruction_mode: 'chat'
        };
        const result = await this._fetchOpenAIViaSillyTavernProxy(config, endpoint, payload, {
            signal: options.signal
        });
        const imageData = this._extractOpenAIChatImage(result);
        if (!imageData) {
            throw new Error(`GPT 聊天接口未返回可用图片。返回摘要：${this._summarizeOpenAIImagePayload(result)}`);
        }
        const imageInfo = imageData.startsWith('data:image/')
            ? await this._waitForImageDecode(imageData).catch(() => ({ width: 0, height: 0 }))
            : { width: 0, height: 0 };
        const [requestedWidth, requestedHeight] = requestedSize.split('x').map(Number);
        return {
            provider: 'openai',
            model,
            prompt,
            width: imageInfo.width || requestedWidth || width,
            height: imageInfo.height || requestedHeight || height,
            requestedWidth: requestedWidth || width,
            requestedHeight: requestedHeight || height,
            quality: 'chat',
            imageData,
            imageUrl: imageData
        };
    }

    _buildOpenAIErrorMessage(status, result, text) {
        const rawText = String(text || '').trim();
        const parsedMessage = String(result?.error?.message || result?.message || result?.error || '').trim();
        const safetyMessage = this._buildOpenAISafetyErrorMessage(result, rawText);
        if (safetyMessage) return safetyMessage;
        const isHtmlError = /<html[\s>]|<!doctype\s+html/i.test(rawText);
        if (status === 524) {
            return 'GPT 生图上游超时 (524)，通常是公益站或其代理等待官方生图太久。可以稍后重试，或换模型/质量/站点。';
        }
        if (status === 502 || status === 503 || status === 504) {
            return `GPT 生图上游服务暂不可用 (${status})，请稍后重试或检查公益站/中转。`;
        }
        if (parsedMessage) return parsedMessage;
        if (isHtmlError) return `GPT 生图接口返回了 HTML 错误页 (${status})，请检查站点或中转服务。`;
        return rawText.slice(0, 180);
    }

    _buildOpenAISafetyErrorMessage(result, rawText = '') {
        const parts = [];
        const push = (value) => {
            const text = String(value || '').trim();
            if (text) parts.push(text);
        };
        push(result?.error?.message);
        push(result?.error?.code);
        push(result?.error?.type);
        push(result?.error?.param);
        push(result?.message);
        push(result?.detail);
        push(result?.code);
        push(result?.type);
        push(rawText);
        const joined = parts.join(' ').replace(/\s+/g, ' ').trim();
        if (!this._looksLikeOpenAISafetyRefusal(joined)) return '';
        const detail = String(result?.error?.message || result?.message || '').replace(/\s+/g, ' ').trim();
        return detail
            ? `GPT 生图被安全策略拒绝：${detail.slice(0, 180)}`
            : 'GPT 生图被安全策略拒绝：提示词包含模型不允许生成的内容，请调整后重试。';
    }

    _looksLikeOpenAISafetyRefusal(text = '') {
        return /content[_\s-]?policy|content[_\s-]?filter|safety|moderation|policy[_\s-]?violation|unsafe|disallowed|not allowed|blocked|rejected|refus|violate|sexual|explicit|nsfw|安全|策略|政策|审核|违规|拒绝|拦截|敏感|露骨|色情|成人内容/i.test(String(text || ''));
    }

    _normalizeSdLoraPrompt(value) {
        return String(value || '')
            .split(/[\n,，]+/)
            .map(item => item.trim())
            .filter(Boolean)
            .map((item) => {
                if (/^<lora:[^>]+>$/i.test(item)) return item;
                const match = item.match(/^(.+?)(?:[:：]\s*([0-9.]+))?$/);
                const name = String(match?.[1] || item).trim();
                const weight = Number.parseFloat(match?.[2]);
                const safeWeight = Number.isFinite(weight) ? Math.max(0, Math.min(2, weight)) : 1;
                return name ? `<lora:${name}:${safeWeight}>` : '';
            })
            .filter(Boolean)
            .join(', ');
    }

    async _generateStableDiffusion(options, config) {
        const prompt = String(options.prompt || '').trim();
        if (!prompt) throw new Error('缺少生图提示词');

        const baseUrl = this._normalizeSdBaseUrl(config.sdUrl);
        if (!baseUrl) throw new Error('未配置 Stable Diffusion 服务地址');

        const appKey = String(options.app || '').trim().toLowerCase();
        const appDefaults = this._getAppDefaultSize(appKey);
        let width = Number(options.width || config.width);
        let height = Number(options.height || config.height);
        let steps = Number(options.steps || config.steps);
        let scale = Number(options.scale ?? config.scale);
        const seed = Number(options.seed ?? config.seed);
        const cfgRescale = Number(options.cfgRescale ?? config.cfgRescale);

        if (appKey === 'honey') {
            if (!Number.isFinite(width) || !Number.isFinite(height) || width < 512 || height < 768) {
                width = appDefaults.width;
                height = appDefaults.height;
            }
            if (!Number.isFinite(steps) || steps < 20) steps = 28;
            if (!Number.isFinite(scale) || scale < 1) scale = 7;
        }

        const modelName = String(config.model || '').trim();
        const modelHash = await this.getSdModelHash(baseUrl, modelName).catch(() => null);
        const loraPrompt = this._normalizeSdLoraPrompt(config.sdLora);
        const positivePrompt = this._joinPrompt([config.fixedPrompt, loraPrompt, prompt, config.fixedPromptEnd]);
        const negativePrompt = this._joinPrompt([config.negativePrompt, options.negativePrompt]);
        const sdReferenceImages = this._normalizeSdReferenceImages(options);
        const useImg2Img = sdReferenceImages.length > 0;
        const payload = {
            prompt: positivePrompt,
            negative_prompt: negativePrompt,
            width,
            height,
            steps,
            cfg_scale: scale,
            seed: Number.isFinite(seed) && seed >= 0 ? Math.floor(seed) : -1,
            sampler_name: String(config.sampler || 'Euler a').trim() || 'Euler a',
            batch_size: 1,
            n_iter: 1,
            restore_faces: Boolean(config.sdRestoreFaces)
        };
        if (useImg2Img) {
            payload.init_images = sdReferenceImages;
            payload.denoising_strength = this._clampReferenceValue(
                options.denoisingStrength ?? options.sdDenoisingStrength ?? config.sdDenoisingStrength,
                0.45,
                0,
                1
            );
        }

        const overrideSettings = {};
        if (modelName) {
            overrideSettings.sd_model_checkpoint = modelName;
        }
        if (config.sdVae) {
            overrideSettings.sd_vae = config.sdVae;
        }
        if (Number(config.sdClipSkip) > 0) {
            overrideSettings.CLIP_stop_at_last_layers = Math.round(Number(config.sdClipSkip));
        }
        if (Object.keys(overrideSettings).length > 0) {
            payload.override_settings = overrideSettings;
        }
        if (cfgRescale > 0) {
            payload.cfg_rescale = cfgRescale;
        }
        if (config.sdScheduler) {
            payload.scheduler = config.sdScheduler;
        }
        if (config.sdHiresFix && !useImg2Img) {
            payload.enable_hr = true;
            payload.hr_scale = Number(config.sdUpscaleFactor) || 1.5;
            payload.hr_second_pass_steps = Math.max(0, Math.round(Number(config.sdHiresSteps) || 0));
            payload.denoising_strength = Number(config.sdDenoisingStrength) || 0.45;
            if (config.sdUpscaler) payload.hr_upscaler = config.sdUpscaler;
        }
        if (config.sdADetailer) {
            payload.alwayson_scripts = {
                ...(payload.alwayson_scripts || {}),
                ADetailer: {
                    args: [
                        true,
                        false,
                        {
                            ad_model: 'face_yolov8n.pt'
                        }
                    ]
                }
            };
        }

        let result = null;
        if (this._isSillyTavern() && !useImg2Img) {
            try {
                const response = await this._sdProxyRequest('generate', { ...payload, url: baseUrl });
                if (response.ok) {
                    const proxyResult = await response.json().catch(() => null);
                    if (proxyResult && (proxyResult.images || proxyResult.image || proxyResult.result)) {
                        result = proxyResult;
                    }
                } else {
                    const text = await response.text().catch(() => '');
                    console.warn('[SD] 代理生图失败，尝试直连:', response.status, text);
                }
            } catch (err) {
                console.warn('[SD] 代理生图异常，尝试直连:', err);
            }
        }

        if (!result) {
            const endpoints = useImg2Img
                ? ['/sdapi/v1/img2img', '/api/img2img']
                : ['/sdapi/v1/txt2img', '/api/txt2img'];
            let lastError = '';
            for (const endpoint of endpoints) {
                try {
                    const response = await this._sdDirectRequest(`${baseUrl}${endpoint}`, {
                        method: 'POST',
                        headers: this._buildSdHeaders({
                            'Content-Type': 'application/json',
                            Accept: 'application/json'
                        }, config),
                        body: JSON.stringify(payload)
                    });
                    const text = await response.text();
                    const parsed = text ? JSON.parse(text) : null;
                    if (response.ok && parsed && (parsed.images || parsed.image || parsed.result)) {
                        result = parsed;
                        break;
                    }
                    lastError = `HTTP ${response.status}: ${endpoint}`;
                    if (parsed?.error || parsed?.message) {
                        lastError += ` ${String(parsed.error?.message || parsed.message || parsed.error).slice(0, 180)}`;
                    }
                } catch (err) {
                    lastError = `${endpoint}: ${err?.message || err}`;
                }
            }
            if (!result) {
                throw new Error(`Stable Diffusion 请求失败${lastError ? `: ${lastError}` : ''}`);
            }
        }

        const imageData = this._extractSdImage(result);
        if (!imageData) throw new Error('Stable Diffusion 未返回可用图片');
        const imageInfo = await this._waitForImageDecode(imageData).catch((err) => {
            throw new Error(`SD 返回图片不可用: ${err?.message || err}`);
        });

        return {
            provider: 'sd',
            model: modelName,
            modelHash,
            prompt,
            width: imageInfo.width,
            height: imageInfo.height,
            requestedWidth: width,
            requestedHeight: height,
            steps,
            sampler: payload.sampler_name,
            scale,
            seed: payload.seed,
            imageData,
            imageUrl: imageData
        };
    }

    async _generateComfyUI(options, config) {
        const prompt = String(options.prompt || '').trim();
        if (!prompt) throw new Error('缺少生图提示词');

        const baseUrl = this._normalizeComfyUIBaseUrl(config.comfyuiUrl);
        if (!baseUrl) throw new Error('未配置 ComfyUI 服务地址');

        const referenceImages = this._normalizeComfyUIReferenceImages(options);
        const workflowTemplate = this._parseComfyUIWorkflow(config.comfyuiWorkflow);
        const workflowTemplateText = JSON.stringify(workflowTemplate);
        const needsReferenceUpload = workflowTemplateText.includes('%reference_image%')
            || workflowTemplateText.includes('%reference_image_filename%')
            || workflowTemplateText.includes('%comfyui_reference_image%')
            || workflowTemplateText.includes('%comfyuicankaoImage%')
            || workflowTemplateText.includes('%comfyuicankaotupian%');
        let uploadedReferenceImage = null;
        if (needsReferenceUpload && referenceImages.length > 0) {
            uploadedReferenceImage = await this._uploadComfyUIReferenceImage(baseUrl, referenceImages[0], options.signal);
        }

        const built = this._buildComfyUIWorkflow(options, {
            ...config,
            comfyuiWorkflow: JSON.stringify(workflowTemplate)
        }, uploadedReferenceImage);
        if (built.requiresModel && !config.comfyuiModel) {
            throw new Error('请先选择 ComfyUI 模型，或在工作流中去掉 %MODEL_NAME% 占位符');
        }
        if (built.requiresReferenceImage && !uploadedReferenceImage) {
            throw new Error('当前 ComfyUI 工作流需要参考图，但本次没有可用的微信联系人参考图');
        }

        const response = await fetch(`${baseUrl}/prompt`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({
                prompt: built.workflow,
                client_id: `yuzuki-phone-${Date.now()}-${Math.random().toString(16).slice(2)}`
            }),
            signal: options.signal
        });
        const text = await response.text();
        let payload = null;
        try {
            payload = text ? JSON.parse(text) : null;
        } catch (err) {
            payload = null;
        }
        if (!response.ok) {
            const message = payload?.error?.message || payload?.error || payload?.message || text;
            throw new Error(`ComfyUI 提交失败：HTTP ${response.status}${message ? ` ${String(message).slice(0, 180)}` : ''}`);
        }
        const promptId = String(payload?.prompt_id || '').trim();
        if (!promptId) throw new Error('ComfyUI 未返回 prompt_id');

        const imageRef = await this._waitForComfyUIHistory(baseUrl, promptId, options.signal);
        const imageData = await this._readComfyUIImage(baseUrl, imageRef, options.signal);
        const imageInfo = await this._waitForImageDecode(imageData).catch((err) => {
            throw new Error(`ComfyUI 返回图片不可用: ${err?.message || err}`);
        });

        return {
            provider: 'comfyui',
            model: config.comfyuiModel,
            prompt,
            width: imageInfo.width || built.width,
            height: imageInfo.height || built.height,
            requestedWidth: built.width,
            requestedHeight: built.height,
            steps: built.steps,
            sampler: config.comfyuiSampler,
            scheduler: config.comfyuiScheduler,
            scale: built.scale,
            seed: built.seed,
            promptId,
            imageData,
            imageUrl: imageData
        };
    }

    async _generateNovelAI(options, config) {
        const prompt = String(options.prompt || '').trim();
        if (!prompt) throw new Error('缺少生图提示词');

        const endpoint = `${this._resolveNovelAIEndpoint(config)}/ai/generate-image`;
        const queueInfo = await this._waitForNovelAIQueueTurn(config, options);
        try {
            const payload = await this._buildNovelAIPayload(options, config);
            this._debugNovelAIRequest({ endpoint, payload, config, options });
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/x-zip-compressed, image/png, application/json'
                },
                body: JSON.stringify(payload),
                signal: options.signal
            });

            if (!response.ok) {
                const text = await response.text().catch(() => '');
                const hint = response.status >= 500
                    ? `；当前参数 model=${config.model}, sampler=${config.sampler}, schedule=${config.schedule}，可先用 native + k_euler 测试`
                    : '';
                throw new Error(`NovelAI 请求失败 (${response.status})${hint}${text ? `: ${text.slice(0, 180)}` : ''}`);
            }

            const imageData = await this._readNovelAIImageResponse(response);
            if (!imageData) throw new Error('NovelAI 未返回可用图片');
            const imageInfo = await this._waitForImageDecode(imageData).catch((err) => {
                throw new Error(`NovelAI 返回图片不可用: ${err?.message || err}`);
            });
            return {
                provider: 'novelai',
                model: config.model,
                prompt,
                width: imageInfo.width,
                height: imageInfo.height,
                requestedWidth: Number(payload?.parameters?.width || config.width),
                requestedHeight: Number(payload?.parameters?.height || config.height),
                steps: Number(payload?.parameters?.steps || config.steps),
                sampler: config.sampler,
                schedule: config.schedule,
                scale: Number(payload?.parameters?.scale ?? config.scale),
                seed: Number(payload?.parameters?.seed ?? -1),
                imageData,
                imageUrl: imageData
            };
        } finally {
            await this._finishNovelAIQueue(queueInfo);
        }
    }

    async _generateSiliconflow(options, config) {
        const prompt = String(options.prompt || '').trim();
        if (!prompt) throw new Error('缺少生图提示词');

        const response = await fetch('https://api.siliconflow.cn/v1/images/generations', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: config.model,
                prompt: this._joinPrompt([config.fixedPrompt, prompt, config.fixedPromptEnd], '，'),
                negative_prompt: this._joinPrompt([config.negativePrompt, options.negativePrompt]),
                image_size: `${Number(options.width || config.width)}x${Number(options.height || config.height)}`,
                batch_size: 1,
                num_inference_steps: Number(options.steps || config.steps),
                guidance_scale: Number(options.scale ?? config.scale)
            })
        });
        const text = await response.text();
        let payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = null; }
        if (!response.ok) {
            const msg = payload?.message || payload?.error?.message || payload?.error || text || '';
            throw new Error(`SiliconFlow 请求失败 (${response.status})${msg ? `: ${String(msg).slice(0, 180)}` : ''}`);
        }
        const imageUrl = String(payload?.images?.[0]?.url || '').trim();
        if (!imageUrl) throw new Error('SiliconFlow 未返回图片 URL');
        return {
            provider: 'siliconflow',
            model: config.model,
            prompt,
            width: Number(options.width || config.width),
            height: Number(options.height || config.height),
            requestedWidth: Number(options.width || config.width),
            requestedHeight: Number(options.height || config.height),
            steps: Number(options.steps || config.steps),
            scale: Number(options.scale ?? config.scale),
            imageData: imageUrl,
            imageUrl
        };
    }

    async _generateOpenAIImage(options, config) {
        const prompt = String(options.prompt || '').trim();
        if (!prompt) throw new Error('缺少生图提示词');
        if (!String(config.apiKey || '').trim()) throw new Error('请先填写 GPT 生图 API Key');

        const width = Number(options.width || config.width);
        const height = Number(options.height || config.height);
        const model = String(config.model || 'gpt-image-2').trim() || 'gpt-image-2';
        const requestedSize = this._getOpenAIImageSize(model, width, height);
        const targetEndpoint = this._resolveOpenAIEndpoint(config);
        const endpoint = this._resolveOpenAIRelayEndpoint(config, targetEndpoint);
        const payload = {
            model,
            prompt: this._joinPrompt([config.fixedPrompt, prompt, config.fixedPromptEnd], '\n'),
            size: requestedSize,
            n: 1
        };
        const normalizedQuality = this._normalizeOpenAIImageQuality(model, config.openaiQuality);
        if (normalizedQuality) {
            payload.quality = normalizedQuality;
        }
        const negativePrompt = this._joinPrompt([config.negativePrompt, options.negativePrompt]);
        if (negativePrompt) {
            payload.prompt = `${payload.prompt}\n\nAvoid: ${negativePrompt}`;
        }

        let result = null;
        const requestPayloads = this._shouldPreferOpenAIBase64(config)
            ? [this._withOpenAIBase64OutputHints(payload), payload]
            : [payload];
        for (let i = 0; i < requestPayloads.length; i++) {
            const requestPayload = requestPayloads[i];
            let response = null;
            try {
                response = await fetch(endpoint, {
                    method: 'POST',
                    headers: this._buildOpenAIHeaders(config, {
                        'Content-Type': 'application/json'
                    }),
                    body: JSON.stringify(requestPayload),
                    signal: options.signal
                });
            } catch (err) {
                const message = String(err?.message || err || '').trim();
                if (/failed to fetch|networkerror|load failed/i.test(message)) {
                    const siteLabel = config.openaiSite === 'public'
                        ? 'GPT 公益站'
                        : (config.openaiSite === 'custom' ? 'GPT 自定义站点' : 'OpenAI 官方站点');
                    const relayHint = config.openaiSite === 'public'
                        ? '请运行本地 imgrelay，并把 GPT 生图的本地中转 URL 填为 http://127.0.0.1:8787。'
                        : '请让站点开启 CORS，或换支持浏览器跨域的中转站。';
                    throw new Error(`${siteLabel} 请求被浏览器拦截或网络失败。若控制台提示 CORS，说明该站点没有给当前页面返回 Access-Control-Allow-Origin。${relayHint}`);
                }
                throw err;
            }
            const text = await response.text();
            try { result = text ? JSON.parse(text) : null; } catch (e) { result = null; }
            if (response.ok) {
                break;
            }
            if (i === 0 && requestPayloads.length > 1 && this._isOpenAIBase64HintRejected(response.status, result, text)) {
                console.warn('[GPT Image] 当前站点不接受 Base64 返回参数，已降级为标准 URL 请求。');
                result = null;
                continue;
            }
            const msg = this._buildOpenAIErrorMessage(response.status, result, text);
            throw new Error(`GPT 生图请求失败 (${response.status})${msg ? `: ${String(msg).slice(0, 180)}` : ''}`);
        }
        let imageData = this._extractOpenAIImage(result);
        if (!imageData) {
            throw new Error(`GPT 生图未返回可用图片。返回摘要：${this._summarizeOpenAIImagePayload(result)}`);
        }
        const imageInfo = imageData.startsWith('data:image/')
            ? await this._waitForImageDecode(imageData).catch(() => ({ width: 0, height: 0 }))
            : { width: 0, height: 0 };
        const [requestedWidth, requestedHeight] = requestedSize.split('x').map(Number);
        return {
            provider: 'openai',
            model,
            prompt,
            width: imageInfo.width || requestedWidth || width,
            height: imageInfo.height || requestedHeight || height,
            requestedWidth: requestedWidth || width,
            requestedHeight: requestedHeight || height,
            quality: normalizedQuality || config.openaiQuality || 'auto',
            imageData,
            imageUrl: imageData
        };
    }
}
