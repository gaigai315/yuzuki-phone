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
// ========================================
// 统一 API 管理器 (ApiManager)
// 负责接管手机插件内所有的 AI 请求
// 支持：独立API / 代理直连 / 流式解析 / 原生兜底
// ========================================

import { getMemoryTagFilterInfo } from './tag-filter.js';

export class ApiManager {
    constructor(storage) {
        this.storage = storage;
        this.cachedCsrfToken = null;
        this.csrfTokenCacheTime = 0;
        this.proxyRouteHints = new Map();
        this._activeRequestCount = 0;
        this._tavernSettingsCache = null;
        this._tavernSettingsCacheAt = 0;
        this._tavernSettingsCacheTTL = 30000;
    }

    getActiveRequestCount() {
        return Math.max(0, parseInt(this._activeRequestCount, 10) || 0);
    }

    isBusy() {
        return this.getActiveRequestCount() > 0;
    }

    _getProxyHintKey(provider, apiUrl) {
        const normalized = String(apiUrl || '').trim().replace(/\/+$/, '');
        return `${provider}::${normalized}`;
    }

    _getProxyRouteHint(provider, apiUrl) {
        return this.proxyRouteHints.get(this._getProxyHintKey(provider, apiUrl)) || '';
    }

    _setProxyRouteHint(provider, apiUrl, source) {
        if (!provider || !apiUrl || !source) return;
        this.proxyRouteHints.set(this._getProxyHintKey(provider, apiUrl), source);
    }

    _formatError(error, fallback = '未知错误') {
        if (error === undefined || error === null) return fallback;
        if (typeof error === 'string') return error || fallback;
        if (typeof error === 'number' || typeof error === 'boolean') return String(error);

        const parts = [];
        const name = String(error?.name || '').trim();
        const message = String(error?.message || '').trim();
        const status = error?.status || error?.statusCode || error?.code || '';
        const statusText = String(error?.statusText || '').trim();

        if (name) parts.push(name);
        if (message) parts.push(message);
        if (status || statusText) parts.push(`status=${status || '?'}${statusText ? ` ${statusText}` : ''}`);

        try {
            const json = JSON.stringify(error);
            if (json && json !== '{}' && !parts.includes(json)) parts.push(json);
        } catch (_e) {
            // ignore
        }

        const causeText = error?.cause ? this._formatError(error.cause, '') : '';
        if (causeText) parts.push(`cause=${causeText}`);

        return parts.filter(Boolean).join(' | ') || fallback;
    }

    _formatHttpFailureBody(status, rawBody = '') {
        const body = String(rawBody || '').trim();
        const statusMessages = {
            500: '上游服务内部错误',
            502: '上游网关返回无效响应',
            503: '上游服务暂时不可用',
            504: '上游网关响应超时',
            520: '上游源站异常（Cloudflare 520）',
            521: '上游源站拒绝连接（Cloudflare 521）',
            522: '连接上游源站超时（Cloudflare 522）',
            523: '上游源站不可达（Cloudflare 523）',
            524: '上游生成或响应超时（Cloudflare 524）',
            525: '上游 SSL 握手失败（Cloudflare 525）',
            526: '上游 SSL 证书无效（Cloudflare 526）'
        };
        const isHtml = /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]/i.test(body);
        if (isHtml) return statusMessages[status] || '上游返回了 HTML 错误页';

        if (body) {
            try {
                const parsed = JSON.parse(body);
                const message = parsed?.error?.message || parsed?.message || parsed?.detail || parsed?.error;
                if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 1000);
            } catch (_e) {
                // 不是 JSON 时保留纯文本错误。
            }
            return body.replace(/\s+/g, ' ').slice(0, 1000);
        }
        return statusMessages[status] || '响应体为空';
    }

    _isRouteFallbackFailure(status, rawBody = '') {
        // 只在请求根本未进入生成、且很可能是协议或路由不匹配时换路由。
        // Cloudflare 52x 和普通服务端 5xx 都可能已经进入生成，重发会造成重复调用。
        if ([400, 404, 405, 415, 422].includes(Number(status))) return true;
        return Number(status) === 502
            && !/<!doctype\s+html|<html[\s>]/i.test(String(rawBody || ''))
            && /invalid\s+url|err_invalid_url|failed\s+to\s+parse\s+(?:the\s+)?url|cannot\s+parse\s+url/i.test(String(rawBody || ''));
    }

    _resolvePhoneApiConfig(rawConfig, appId = '') {
        if (!rawConfig || typeof rawConfig !== 'object') return rawConfig;

        const config = { ...rawConfig };
        const profiles = Array.isArray(config.profiles) ? config.profiles : [];
        const routes = (config.appProfileRoutes && typeof config.appProfileRoutes === 'object')
            ? config.appProfileRoutes
            : {};
        const routedName = String(routes[String(appId || '').trim()] || '').trim();
        const activeName = routedName || String(config.activeProfileName || '').trim();
        const activeProfile = activeName
            ? profiles.find((p) => p && String(p.name || '').trim() === activeName)
            : null;

        if (!activeProfile) return config;
        // 全局开关是总闸门：关闭后即使预设里为 true，也必须走酒馆原生 API。
        const globalEnabled = config.useIndependentAPI === true;
        const profileEnabled = activeProfile.useIndependentAPI !== false;

        return {
            ...config,
            useIndependentAPI: globalEnabled && profileEnabled,
            provider: activeProfile.provider || config.provider || 'openai',
            apiUrl: activeProfile.apiUrl || activeProfile.url || config.apiUrl || '',
            apiKey: activeProfile.apiKey || activeProfile.key || config.apiKey || '',
            model: activeProfile.model || config.model || '',
            maxTokens: parseInt(activeProfile.maxTokens, 10) || parseInt(config.maxTokens, 10) || 8192,
            temperature: Number.isFinite(Number.parseFloat(activeProfile.temperature))
                ? Number.parseFloat(activeProfile.temperature)
                : (Number.isFinite(Number.parseFloat(config.temperature)) ? Number.parseFloat(config.temperature) : undefined),
            useStream: activeProfile.useStream !== false
        };
    }

    _normalizeRuntimeApiConfig(config) {
        if (!config || typeof config !== 'object') return config;
        return {
            ...config,
            provider: config.provider || 'openai',
            apiUrl: String(config.apiUrl || config.url || '').trim(),
            apiKey: String(config.apiKey || config.key || '').trim(),
            model: String(config.model || ''),
            maxTokens: parseInt(config.maxTokens, 10) || 8192,
            temperature: Number.isFinite(Number.parseFloat(config.temperature)) ? Number.parseFloat(config.temperature) : undefined,
            useStream: config.useStream !== false
        };
    }

    _normalizeMessageContentForText(content) {
        if (Array.isArray(content)) {
            return content
                .map((part) => {
                    if (typeof part === 'string') return part;
                    if (part?.type === 'text') return String(part.text || '');
                    if (part?.type === 'image_url') return '[图片]';
                    return '';
                })
                .join('');
        }
        return String(content || '');
    }

    _replacePhoneImageTokens(content, options = {}) {
        const consume = options.consume !== false;
        const pendingImages = (typeof window !== 'undefined' && window.VirtualPhone?._pendingImages)
            ? window.VirtualPhone._pendingImages
            : null;

        if (Array.isArray(content)) return content;
        const text = String(content || '');
        if (!text.includes('__ST_PHONE_IMAGE_')) return text;

        const parts = text.split(/(__ST_PHONE_IMAGE_\d+_[a-z0-9]+__)/g);
        const nextContent = [];
        let replaced = false;

        parts.forEach((part) => {
            if (!part) return;
            if (part.startsWith('__ST_PHONE_IMAGE_') && pendingImages?.[part]) {
                const pendingImage = pendingImages[part];
                const imageUrl = typeof pendingImage === 'string'
                    ? pendingImage
                    : String(pendingImage?.url || pendingImage?.imageUrl || '');
                const imageLabel = typeof pendingImage === 'string'
                    ? ''
                    : String(pendingImage?.label || pendingImage?.name || pendingImage?.description || '').trim();
                if (imageUrl) {
                    const imagePart = { type: 'image_url', image_url: { url: imageUrl } };
                    if (imageLabel) imagePart.phoneImageLabel = imageLabel;
                    nextContent.push(imagePart);
                } else if (imageLabel) {
                    nextContent.push({ type: 'text', text: imageLabel });
                }
                if (consume) delete pendingImages[part];
                replaced = true;
                return;
            }
            if (part.trim()) {
                nextContent.push({ type: 'text', text: part });
            }
        });

        return replaced ? nextContent : text;
    }

    _getImagePartMimeType(part) {
        const url = String(part?.image_url?.url || part?.image_url || '').trim();
        const match = /^data:([^;,]+)[;,]/i.exec(url);
        return match ? match[1].toLowerCase() : '';
    }

    _sanitizeContentForModel(content, options = {}) {
        if (!Array.isArray(content)) return content;

        const unsupportedImageTypes = new Set(['image/gif']);

        return content.flatMap((part) => {
            if (!part || typeof part !== 'object' || part.type !== 'image_url') return [part];

            const mimeType = this._getImagePartMimeType(part);
            if (unsupportedImageTypes.has(mimeType)) {
                const label = String(part.phoneImageLabel || part.imageLabel || part.name || part.description || '').trim();
                return [{ type: 'text', text: label || '[动图/GIF表情]' }];
            }
            return [part];
        });
    }

    _contentToGeminiParts(content) {
        if (!Array.isArray(content)) {
            return [{ text: String(content || '') }];
        }

        const parts = [];
        content.forEach((part) => {
            if (typeof part === 'string') {
                if (part) parts.push({ text: part });
                return;
            }
            if (part?.type === 'text') {
                const text = String(part.text || '');
                if (text) parts.push({ text });
                return;
            }
            if (part?.type === 'image_url') {
                const url = String(part.image_url?.url || '');
                const match = /^data:([^;,]+);base64,(.+)$/i.exec(url);
                const mimeType = String(match?.[1] || '').toLowerCase();
                if (match && mimeType !== 'image/gif') {
                    parts.push({
                        inline_data: {
                            mime_type: match[1],
                            data: match[2]
                        }
                    });
                } else if (match && mimeType === 'image/gif') {
                    const label = String(part.phoneImageLabel || part.imageLabel || part.name || part.description || '').trim();
                    parts.push({ text: label || '[动图/GIF表情]' });
                }
            }
        });

        return parts.length > 0 ? parts : [{ text: '' }];
    }

    _updateGaigaiLastRequestData(messages, meta = {}) {
        try {
            if (!Array.isArray(messages)) return;

            const gaigaiTargets = [];
            if (typeof window !== 'undefined') {
                if (window.Gaigai) gaigaiTargets.push(window.Gaigai);
                try {
                    if (window.top && window.top !== window && window.top.Gaigai) {
                        gaigaiTargets.push(window.top.Gaigai);
                    }
                } catch (e) {
                    // 跨域或不可访问时忽略
                }
            }
            if (gaigaiTargets.length === 0) return;

            const debugChat = messages
                .map((m) => {
                    const role = (m?.role === 'system' || m?.role === 'assistant') ? m.role : 'user';
                    const hasSignal = !!m?.gaigaiPhoneSignal;
                    const content = this._normalizeMessageContentForText(m?.content).trim();

                    // 某些预设会在发送阶段合并/清空内容，必须保留带权限信号的壳消息给记忆插件兜底识别。
                    if (!content && !hasSignal) return null;

                    const item = { role, content: content || '[PHONE_SIGNAL]' };
                    if (m?.name) item.name = m.name;
                    if (m?.isPhoneMessage) item.isPhoneMessage = true;
                    if (hasSignal) item.gaigaiPhoneSignal = m.gaigaiPhoneSignal;
                    return item;
                })
                .filter(Boolean);

            const payload = {
                chat: debugChat,
                timestamp: Date.now(),
                model: meta.model || 'Unknown',
                source: `virtual-phone:${meta.appId || 'phone_online'}`
            };
            gaigaiTargets.forEach((gaigai) => {
                gaigai.lastRequestData = payload;
            });
        } catch (e) {
            console.warn('⚠️ [ApiManager] 同步 lastRequestData 失败:', e);
        }
    }

    _clearGaigaiPhoneSignalFromProbe() {
        try {
            const gaigaiTargets = [];
            if (typeof window !== 'undefined') {
                if (window.Gaigai) gaigaiTargets.push(window.Gaigai);
                try {
                    if (window.top && window.top !== window && window.top.Gaigai) {
                        gaigaiTargets.push(window.top.Gaigai);
                    }
                } catch (e) {
                    // ignore
                }
            }
            if (gaigaiTargets.length === 0) return;

            gaigaiTargets.forEach((gaigai) => {
                const probe = gaigai?.lastRequestData;
                if (!probe || !Array.isArray(probe.chat)) return;
                probe.chat.forEach((msg) => {
                    if (!msg || typeof msg !== 'object') return;
                    if (Object.prototype.hasOwnProperty.call(msg, 'gaigaiPhoneSignal')) {
                        delete msg.gaigaiPhoneSignal;
                    }
                });
            });
        } catch (e) {
            console.warn('⚠️ [ApiManager] 清理手机权限信号失败:', e);
        }
    }

    _hasMemorySignalBridge() {
        try {
            const memoryInfo = getMemoryTagFilterInfo();
            const requestProbe = (typeof window !== 'undefined')
                ? window.YuzukiMemory?.RequestProbe
                : null;
            const hasYuzukiMemoryBridge = memoryInfo.hasYuzukiMemory
                && requestProbe?.installed === true
                && typeof requestProbe.processFetchArgs === 'function'
                && typeof requestProbe.stripTransportMessageMetadata === 'function';

            // 旧版记忆插件通过 Gaigai 全局对象接收同一套手机权限信号。
            return hasYuzukiMemoryBridge || memoryInfo.hasGaigai;
        } catch (e) {
            console.warn('⚠️ [ApiManager] 检测记忆插件失败，本次不发送手机权限信号:', e);
            return false;
        }
    }

    _createPhoneRequestSignal(appId = 'phone_online') {
        try {
            const rawPerms = this.storage.get('phone_memory_permissions');
            const allPerms = rawPerms ? (typeof rawPerms === 'string' ? JSON.parse(rawPerms) : rawPerms) : {};

            const basePerms = { allowSummary: false, allowTable: false, allowVector: false };
            const defaultPermsByApp = {
                wechat: { allowSummary: true, allowVector: true },
                weibo: { allowSummary: true, allowVector: true },
                diary: { allowSummary: true, allowVector: true },
                wangxiang: { allowSummary: true, allowTable: true, allowVector: true },
                games: { allowSummary: false, allowTable: false, allowVector: false },
                honey: { allowSummary: false, allowTable: false, allowVector: false },
                phone_online: { allowSummary: false, allowTable: false, allowVector: false }
            };
            const defaultPerms = { ...basePerms, ...(defaultPermsByApp[appId] || {}) };
            const currentPerms = { ...defaultPerms, ...(allPerms?.[appId] || {}) };

            return {
                appName: appId,
                allowSummary: currentPerms.allowSummary === true,
                allowTable: currentPerms.allowTable === true,
                allowVector: currentPerms.allowVector === true,
                allowPrompt: false
            };
        } catch (e) {
            console.warn('⚠️ [ApiManager] 读取记忆插件权限失败，已回退默认禁用:', e);
            return {
                appName: appId,
                allowSummary: false,
                allowTable: false,
                allowVector: false,
                allowPrompt: false
            };
        }
    }

    _attachPhoneSignalToPayload(payload, phoneSignal = null) {
        if (!payload || typeof payload !== 'object' || !phoneSignal) return payload;
        payload.gaigaiPhoneSignal = phoneSignal;
        payload.isPhoneMessage = true;
        payload.isVirtualPhoneApiCall = true;
        return payload;
    }

    // ========================================
    // 🌐 核心暴露接口
    // ========================================
    /**
     * @param {Array} messages - 构建好的对话数组
     * @param {Object} options - 额外参数（如 signal、temperature）
     * @returns {Promise<Object>} { success: boolean, summary: string, error: string }
     */
    async callAI(messages, options = {}) {
        this._activeRequestCount += 1;
        try {
        // 获取当前调用 AI 的 App 标识，默认 phone_online
        const appId = options.appId || 'phone_online';
        const phoneSignal = this._hasMemorySignalBridge()
            ? this._createPhoneRequestSignal(appId)
            : null;

        // 给最后一条消息打上通行证标记
        if (Array.isArray(messages) && messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            if (phoneSignal) {
                lastMessage.gaigaiPhoneSignal = phoneSignal;
                lastMessage.isPhoneMessage = true;
                lastMessage.isVirtualPhoneApiCall = true; // 🔥 绝杀：专门贴上手机API专用标签
            } else {
                // 防止调用方复用曾经打过标记的消息对象，把内部元数据带到模型上游。
                delete lastMessage.gaigaiPhoneSignal;
                delete lastMessage.isPhoneMessage;
                delete lastMessage.isVirtualPhoneApiCall;
            }
        }

        // 1. 获取 API 配置 (优先读取 options 中传入的临时配置，用于测试按钮)
        let apiConfig = this._normalizeRuntimeApiConfig(options.overrideApiConfig || null);

        if (!apiConfig) {
            try {
                const phoneConfigRaw = this.storage.get('phone_api_config');
                if (phoneConfigRaw) {
                    const parsed = typeof phoneConfigRaw === 'string' ? JSON.parse(phoneConfigRaw) : phoneConfigRaw;
                    apiConfig = this._normalizeRuntimeApiConfig(this._resolvePhoneApiConfig(parsed, appId));
                } else {
                    const rawConfig = localStorage.getItem('gg_api');
                    if (rawConfig) apiConfig = this._normalizeRuntimeApiConfig(JSON.parse(rawConfig));
                }
            } catch (e) {
                console.warn('⚠️ [ApiManager] 获取API配置失败', e);
            }
        }

        // 📡 同步到记忆插件探针：确保“最后发送内容”可见手机内部请求（微博/微信/日记等）
        this._updateGaigaiLastRequestData(messages, {
            appId,
            model: apiConfig?.model || 'Unknown'
        });

        // 2. 判断是否启用独立 API
        const useIndependentAPI = apiConfig && apiConfig.useIndependentAPI === true;
        if (useIndependentAPI) {
            console.log(`🚀 [ApiManager] 智能路由 -> 走向独立 API (流式: ${apiConfig.useStream !== false ? '开' : '关'})`);
            return await this._callIndependentAPI(messages, options, apiConfig, phoneSignal);
        } else {
            console.log(`🔄 [ApiManager] 智能路由 -> 走向酒馆原生 API (流式: ${apiConfig?.useStream !== false ? '开' : '关'})`);
            return await this._callTavernAPI(messages, options, phoneSignal, apiConfig);
        }
        } catch (error) {
            console.error('[ApiManager] callAI 异常详情:', {
                name: error?.name,
                message: error?.message,
                status: error?.status || error?.statusCode || error?.code,
                stack: error?.stack,
                raw: error
            });
            return { success: false, error: this._formatError(error, 'API 调用异常') };
        } finally {
            this._activeRequestCount = Math.max(0, this._activeRequestCount - 1);
            // 仅在所有手机请求都结束后，清理探针里的 gaigaiPhoneSignal，
            // 避免后续酒馆正文请求被记忆插件误判为“手机请求”。
            if (this._activeRequestCount === 0) {
                this._clearGaigaiPhoneSignalFromProbe();
            }

            if (window.VirtualPhone) window.VirtualPhone._isInternalRequest = false;
        }
    }

    async _getCachedTavernSettings() {
        const now = Date.now();
        if (this._tavernSettingsCache && now - this._tavernSettingsCacheAt < this._tavernSettingsCacheTTL) {
            return this._tavernSettingsCache;
        }

        const settingsRes = await fetch('/api/settings/get', {
            method: 'POST',
            headers: await this._getJsonRequestHeaders(),
            credentials: 'include',
            body: JSON.stringify({})
        });

        if (!settingsRes.ok) {
            const errText = await settingsRes.text().catch(() => '');
            throw new Error(`无法读取酒馆配置: ${settingsRes.status} ${errText}`.trim());
        }

        const serverData = await settingsRes.json();
        const parsedSettings = typeof serverData?.settings === 'string'
            ? JSON.parse(serverData.settings || '{}')
            : (serverData?.settings || serverData || {});
        this._tavernSettingsCache = parsedSettings;
        this._tavernSettingsCacheAt = now;
        return parsedSettings;
    }

    // ========================================
    // 🛡️ 通道 A: 酒馆原生 API (终极流式兜底，完美防502/504/400)
    // ========================================
    async _callTavernAPI(messages, options = {}, phoneSignal = null, apiConfig = null) {
        const enableStream = apiConfig?.useStream !== false;
        const isAbortLike = (err = null) => {
            const msg = String(err?.message || err || '').toLowerCase();
            return err?.name === 'AbortError' || err?.statusText === 'abort' || msg.includes('abort');
        };

        try {
            const sourceMessages = Array.isArray(messages) ? messages : [];
            const cleanMessages = sourceMessages
                .map((m, idx) => {
                    const role = m?.role === 'system' || m?.role === 'assistant' ? m.role : 'user';
                    const content = this._replacePhoneImageTokens(m?.content, { consume: true });
                    const textContent = this._normalizeMessageContentForText(content).trim();
                    if (!textContent && (!Array.isArray(content) || content.length === 0)) return null;
                    const normalized = { role, content };
                    if (idx === sourceMessages.length - 1 && m?.gaigaiPhoneSignal) normalized.gaigaiPhoneSignal = m.gaigaiPhoneSignal;
                    if (m?.isPhoneMessage) normalized.isPhoneMessage = true;
                    if (m?.isVirtualPhoneApiCall) normalized.isVirtualPhoneApiCall = true;
                    return normalized;
                })
                .filter(Boolean);

            if (cleanMessages.length === 0) throw new Error('消息数组为空');

            // 🌟 1. 核心修复：向后端请求配置，并正确进行 JSON.parse()
            let parsedSettings = {};
            try {
                parsedSettings = await this._getCachedTavernSettings();
            } catch (settingsError) {
                console.warn('[ApiManager] 读取酒馆配置失败，回退 generateRaw:', this._formatError(settingsError, 'settings/get 失败'));
                return await this._callTavernGenerateRawFallback(
                    cleanMessages,
                    this._resolveResponseLength(null),
                    options,
                    phoneSignal,
                    enableStream
                );
            }
            
            // 兼容不同版本的酒馆设置结构
            const oai = parsedSettings.oai_settings || parsedSettings;

            // 🌟 2. 提取最真实的 Secret ID 和 URL（无视 DOM 掩码）
            const chatSource = document.getElementById('chat_completion_source')?.value || oai.chat_completion_source || 'custom';

            let model = '';
            let reverseProxy = '';
            let apiKey = ''; // 这将装载真实的 Secret ID

            if (chatSource === 'custom') {
                model = oai.custom_model || document.getElementById('custom_model')?.value;
                reverseProxy = oai.custom_url || document.getElementById('custom_url')?.value;
                apiKey = oai.custom_key; 
            } else if (chatSource === 'openrouter') {
                model = oai.openrouter_model || document.getElementById('model_openrouter')?.value;
                reverseProxy = 'https://openrouter.ai/api/v1';
                apiKey = oai.openrouter_key;
            } else if (chatSource === 'claude') {
                model = oai.claude_model || document.getElementById('model_claude')?.value;
                reverseProxy = oai.claude_reverse_proxy || document.getElementById('claude_reverse_proxy')?.value;
                apiKey = oai.claude_key;
            } else {
                model = oai.openai_model || document.getElementById('model_openai')?.value;
                reverseProxy = oai.reverse_proxy || document.getElementById('openai_reverse_proxy')?.value;
                apiKey = oai.openai_key;
            }

            // 跟随酒馆时只使用酒馆当前响应长度，不接受业务调用覆盖。
            const maxTokens = this._resolveResponseLength(parsedSettings);
            // 🌟 修复：精准读取 OpenAI/Custom 专属的高级参数滑块和后台数据
            const tempCandidates = [document.getElementById('temp_openai')?.value, oai.temp_openai, document.getElementById('temp')?.value, parsedSettings.temp];
            const temperature = tempCandidates.map(v => Number.parseFloat(v)).find(v => Number.isFinite(v)) ?? 1.0;

            const freqPenCandidates = [document.getElementById('freq_pen_openai')?.value, oai.freq_pen_openai];
            const frequency_penalty = freqPenCandidates.map(v => Number.parseFloat(v)).find(v => Number.isFinite(v));

            const presPenCandidates = [document.getElementById('pres_pen_openai')?.value, oai.pres_pen_openai];
            const presence_penalty = presPenCandidates.map(v => Number.parseFloat(v)).find(v => Number.isFinite(v));

            const topPCandidates = [document.getElementById('top_p_openai')?.value, oai.top_p_openai];
            const top_p = topPCandidates.map(v => Number.parseFloat(v)).find(v => Number.isFinite(v));

            // 🌟 3. 组装给后端的 Payload
            const payload = {
                chat_completion_source: chatSource,
                messages: cleanMessages,
                temperature: temperature,
                max_tokens: maxTokens,
                stream: enableStream
            };
            this._attachPhoneSignalToPayload(payload, phoneSignal);

            // 将读取到的高级参数加入 Payload
            if (frequency_penalty !== undefined) payload.frequency_penalty = frequency_penalty;
            if (presence_penalty !== undefined) payload.presence_penalty = presence_penalty;
            if (top_p !== undefined) payload.top_p = top_p;

            if (model) payload.model = model;
            
            if (reverseProxy) {
                payload.reverse_proxy = reverseProxy;
                payload.custom_url = reverseProxy; // 兼容旧版字段
            }
            
            // 注入真实的 Secret ID (如: 87a6c5a1-ba67...)
            if (apiKey) {
                payload.proxy_password = apiKey;
            }

            const requestMessages = cleanMessages.map((message) => ({
                ...message,
                content: this._sanitizeContentForModel(message.content, { provider: chatSource, model })
            }));
            payload.messages = requestMessages;

            console.log(`🚀 [ApiManager] 触发原生 API (模式: ${chatSource}, 模型: ${model || '未指定'}, 代理: ${reverseProxy || '默认'}, 流式: ${enableStream ? '开' : '关'})`);

            // 🌟 4. 发送到正确的官方路由
            const endpoint = '/api/backends/chat-completions/generate';
            
            const sendGenerateRequest = async (forceRefresh = false) => fetch(endpoint, {
                method: 'POST',
                headers: await this._getJsonRequestHeaders({ forceRefresh }),
                credentials: 'include',
                body: JSON.stringify(payload),
                signal: options.signal
            });

            let response = await sendGenerateRequest(false);

            if (!response.ok) {
                let errText = await response.text();
                if (this._isUnauthorizedResponse(response.status, errText)) {
                    console.warn('⚠️ [ApiManager] 原生 API 鉴权失败，刷新 CSRF 后重试一次');
                    response = await sendGenerateRequest(true);
                    if (response.ok) {
                        if (enableStream && response.body) {
                            return await this._readUniversalStream(response.body, '[酒馆原生流式]');
                        }
                        return this._parseApiResponse(await response.text());
                    }
                    errText = await response.text();
                }
                console.error('[ApiManager] 后端返回错误:', response.status, errText);
                if (
                    response.status === 502 &&
                    /invalid url|err_invalid_url|\/chat\/completions/i.test(String(errText || ''))
                ) {
                    console.warn('⚠️ [ApiManager] 检测到后端 URL 解析失败，自动回退到 generateRaw 兜底');
                    return await this._callTavernGenerateRawFallback(cleanMessages, maxTokens, options, phoneSignal, enableStream);
                }
                if (this._isUnauthorizedResponse(response.status, errText)) {
                    console.warn('⚠️ [ApiManager] 原生 API 鉴权仍失败，回退 generateRaw');
                    return await this._callTavernGenerateRawFallback(cleanMessages, maxTokens, options, phoneSignal, enableStream);
                }
                return { success: false, error: `原生 API 失败: ${response.status} ${errText || ''}`.trim() };
            }

            if (enableStream && response.body) {
                return await this._readUniversalStream(response.body, '[酒馆原生流式]');
            }

            const responseText = await response.text();
            if (!responseText) return { success: false, error: '原生 API 失败: 响应体为空' };
            return this._parseApiResponse(responseText);

        } catch (e) {
            if (options?.signal?.aborted) return { success: false, error: '已中断发送', aborted: true };
            if (isAbortLike(e)) return { success: false, error: '请求被其他插件中断' };
            console.error('[ApiManager] 请求异常:', {
                message: this._formatError(e, '请求异常'),
                stack: e?.stack,
                raw: e
            });
            return { success: false, error: `原生 API 失败: ${this._formatError(e, '请求异常')}` };
        }
    }

    async _callTavernGenerateRawFallback(cleanMessages, maxTokens, options = {}, phoneSignal = null, useStream = true) {
        try {
            const resolvedMaxTokens = Number.parseInt(maxTokens, 10);
            if (!Number.isFinite(resolvedMaxTokens) || resolvedMaxTokens <= 0) {
                return { success: false, error: '原生 API 失败: 无法读取酒馆最大回复长度设置' };
            }
            const context = (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function')
                ? SillyTavern.getContext()
                : null;
            if (!context || typeof context.generateRaw !== 'function') {
                return { success: false, error: '原生 API 失败: 无可用 generateRaw 兜底' };
            }

            const safeMessages = Array.isArray(cleanMessages)
                ? cleanMessages.map((message) => ({
                    ...message,
                    content: this._sanitizeContentForModel(message.content, { forceGifText: true })
                }))
                : [];

            const generateParams = {
                prompt: safeMessages,
                images: [],
                quiet: true,
                dryRun: false,
                skip_save: true,
                stream: useStream !== false,
                include_world_info: false,
                include_jailbreak: false,
                include_character_card: false,
                include_names: false,
                max_tokens: resolvedMaxTokens,
                length: resolvedMaxTokens,
                stop: [],
                stop_sequence: []
            };
            this._attachPhoneSignalToPayload(generateParams, phoneSignal);

            const result = await context.generateRaw(generateParams);
            let summary = '';
            if (typeof result === 'string') {
                summary = result;
            } else if (result && typeof result === 'object') {
                if (result.error) {
                    const errorMsg = typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
                    return { success: false, error: `原生 API 失败: ${errorMsg}` };
                }
                summary =
                    result?.choices?.[0]?.message?.content ||
                    result?.results?.[0]?.text ||
                    result?.text ||
                    result?.content ||
                    result?.body?.text ||
                    result?.message ||
                    '';
            }

            summary = String(summary || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
            if (!summary) {
                return { success: false, error: '原生 API 失败: generateRaw 返回为空' };
            }
            return { success: true, summary };
        } catch (e) {
            if (options?.signal?.aborted) return { success: false, error: '已中断发送', aborted: true };
            return { success: false, error: `原生 API 失败: ${this._formatError(e, 'generateRaw 异常')}` };
        }
    }

    async _callIndependentAPI(messages, options = {}, apiConfig = {}, phoneSignal = null) {
        const model = apiConfig.model || 'gpt-3.5-turbo';
        const provider = apiConfig.provider || 'openai';
        const modelLower = String(model || '').toLowerCase();
        let apiUrl = this._processApiUrl(apiConfig.apiUrl || '', provider);
        const apiKey = String(apiConfig.apiKey || '').trim();
        const configMaxTokens = Number.parseInt(apiConfig?.maxTokens, 10);
        // 独立 API 只使用小手机独立预设中的长度，不接受业务调用覆盖。
        const maxTokens = Number.isFinite(configMaxTokens) && configMaxTokens > 0
            ? configMaxTokens
            : 8192;
        const optionTemperature = Number.parseFloat(options?.temperature);
        const configTemperature = Number.parseFloat(apiConfig?.temperature);
        const temperature = Number.isFinite(optionTemperature)
            ? optionTemperature
            : (Number.isFinite(configTemperature) ? configTemperature : 1.0);
        const enableStream = apiConfig.useStream !== false;

        const sourceMessages = Array.isArray(messages)
            ? messages
            : [{ role: 'user', content: String(messages || '') }];
        const preserveSystem = ['openai', 'deepseek', 'claude', 'gemini', 'siliconflow', 'proxy_only', 'compatible'].includes(provider);
        const cleanMessages = sourceMessages.map((m, idx) => {
            const rawContent = this._replacePhoneImageTokens(m?.content, { consume: true });
            const sanitizedRawContent = this._sanitizeContentForModel(rawContent, { provider, model });
            const content = preserveSystem
                ? sanitizedRawContent
                : (m?.role === 'system' ? `[System]: ${this._normalizeMessageContentForText(sanitizedRawContent)}` : sanitizedRawContent);
            const normalized = {
                role: preserveSystem ? (m?.role === 'system' ? 'system' : (m?.role === 'assistant' ? 'assistant' : 'user')) : (m?.role === 'system' ? 'user' : (m?.role || 'user')),
                content
            };

            // 独立 API 路径也必须透传手机权限信号，避免记忆插件误判为“无信号请求”后回退到全注入。
            const isLast = idx === sourceMessages.length - 1;
            if (isLast && m?.gaigaiPhoneSignal) {
                normalized.gaigaiPhoneSignal = m.gaigaiPhoneSignal;
            }
            if (m?.isPhoneMessage) {
                normalized.isPhoneMessage = true;
            }
            if (m?.isVirtualPhoneApiCall) {
                normalized.isVirtualPhoneApiCall = true;
            }
            return normalized;
        });

        let authHeader;
        if (apiKey) {
            authHeader = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
        }
        if (provider === 'gemini' && apiUrl.includes('googleapis.com') && !apiUrl.toLowerCase().includes('/v1')) {
            authHeader = undefined;
            if (apiKey && !apiUrl.includes('key=')) {
                apiUrl += (apiUrl.includes('?') ? '&' : '?') + `key=${apiKey}`;
            }
        }

        const parseProxyResponse = async (response, requestStream, label) => {
            if (!response.ok) {
                const errText = await response.text();
                const tip = response.status === 401
                    ? ' (鉴权失败，请检查 API Key / Bearer 前缀)'
                    : response.status === 404
                        ? ' (后端路由不存在)'
                        : response.status === 500
                            ? ' (后端内部错误)'
                            : '';
                const detail = this._formatHttpFailureBody(response.status, errText);
                const error = new Error(`${label} 失败 ${response.status}${tip}: ${detail}`);
                error.status = response.status;
                error.phoneRetryableRoute = this._isRouteFallbackFailure(response.status, errText);
                throw error;
            }
            // 酒馆的 forwardFetchResponse 只转发响应体和状态码，部分版本不会保留
            // 上游的 text/event-stream 响应头。请求既然明确启用了 stream，就应直接
            // 按流读取，否则 response.text() 会一直等待上游物理断开连接。
            try {
                if (requestStream && response.body) {
                    return await this._readUniversalStream(response.body, `[${label}]`);
                }
                const text = await response.text();
                const chunkedResult = this._parseChunkedApiText(text);
                if (chunkedResult) return chunkedResult;
                return this._parseApiResponse(text);
            } catch (error) {
                // HTTP 200 说明上游已经接受并可能完成了生成。此时禁止换路由重发，
                // 否则一次手机操作会产生多次模型请求。
                error.phoneResponseAccepted = true;
                throw error;
            }
        };

        const fetchProxyWithAuthRetry = async (payload, label) => {
            const endpoint = '/api/backends/chat-completions/generate';
            const send = async (forceRefresh = false) => {
                const startedAt = Date.now();
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: await this._getJsonRequestHeaders({ forceRefresh }),
                    body: JSON.stringify(payload),
                    credentials: 'include',
                    signal: options.signal
                });
                console.log(`⏱️ [ApiManager][${label}] 收到响应头: ${response.status}，等待 ${Date.now() - startedAt}ms`);
                return response;
            };

            let response = await send(false);
            if (!response.ok) {
                const clone = response.clone();
                const errText = await clone.text().catch(() => '');
                if (this._isUnauthorizedResponse(response.status, errText)) {
                    console.warn(`⚠️ [ApiManager][${label}] 后端代理鉴权失败，刷新 CSRF 后重试一次`);
                    response = await send(true);
                }
            }
            return response;
        };

        const buildSafetyConfig = () => ([
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
        ]);

        let proxyError = null;
        const useProxy = ['local', 'openai', 'claude', 'proxy_only', 'deepseek', 'siliconflow', 'compatible', 'gemini'].includes(provider);
        if (useProxy) {
            try {
                const apiUrlLower = apiUrl.toLowerCase();
                const useProxyGeminiCompat = provider === 'proxy_only'
                    && modelLower.includes('gemini')
                    && !apiUrlLower.includes('127.0.0.1')
                    && !apiUrlLower.includes('localhost')
                    && !apiUrlLower.includes('/v1');
                let targetSource = 'openai';
                if (provider === 'claude') targetSource = 'claude';
                if (provider === 'gemini') targetSource = 'makersuite';
                if (provider === 'proxy_only' || provider === 'local') targetSource = 'custom';
                if (useProxyGeminiCompat) targetSource = 'makersuite';
                if (provider === 'proxy_only' || provider === 'compatible') {
                    const hinted = this._getProxyRouteHint(provider, apiUrl);
                    if (!useProxyGeminiCompat && (hinted === 'custom' || hinted === 'openai')) {
                        targetSource = hinted;
                    }
                }

                let cleanBaseUrl = apiUrl;
                if (targetSource === 'openai' && cleanBaseUrl.endsWith('/chat/completions')) {
                    cleanBaseUrl = cleanBaseUrl.replace(/\/chat\/completions\/?$/, '');
                }
                if (targetSource === 'makersuite') {
                    cleanBaseUrl = cleanBaseUrl.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');
                }

                const proxyPayload = {
                    chat_completion_source: targetSource,
                    reverse_proxy: cleanBaseUrl,
                    custom_url: apiUrl,
                    proxy_password: apiKey,
                    model,
                    messages: cleanMessages,
                    temperature,
                    max_tokens: maxTokens,
                    stream: enableStream,
                    mode: 'chat',
                    instruction_mode: 'chat'
                };
                if (targetSource === 'makersuite') {
                    proxyPayload.maxOutputTokens = maxTokens;
                    proxyPayload.custom_prompt_post_processing = 'strict';
                    proxyPayload.use_makersuite_sysprompt = true;
                }
                this._attachPhoneSignalToPayload(proxyPayload, phoneSignal);

                // 酒馆的 OpenAI 兼容路由会根据 proxy_password 生成鉴权头；
                // custom_include_headers 只属于 custom 路由，并且酒馆后端要求它是 YAML 字符串。
                // JSON 是合法 YAML；直接传对象会被 yaml.parse 静默忽略，导致 Authorization 丢失。
                if (targetSource === 'custom') {
                    proxyPayload.custom_include_headers = JSON.stringify({
                        'Content-Type': 'application/json',
                        ...(authHeader ? { Authorization: authHeader } : {})
                    });
                }
                if (modelLower.includes('gemini')) {
                    const safetyConfig = buildSafetyConfig();
                    proxyPayload.gemini_safety_settings = safetyConfig;
                    proxyPayload.safety_settings = safetyConfig;
                    proxyPayload.safetySettings = safetyConfig;
                }

                console.log(`🌐 [ApiManager][后端代理] 目标: ${apiUrl} | 模式: ${targetSource} | 模型: ${model || '未指定'} | 流式: ${enableStream ? '开' : '关'}`);
                const proxyResponse = await fetchProxyWithAuthRetry(proxyPayload, '后端代理');
                const proxyResult = await parseProxyResponse(proxyResponse, proxyPayload.stream && enableStream, '后端代理');
                if (provider === 'proxy_only' || provider === 'compatible') {
                    this._setProxyRouteHint(provider, apiUrl, targetSource);
                }
                return proxyResult;
            } catch (err) {
                proxyError = err;
                if (options.signal?.aborted) return { success: false, error: '已中断发送', aborted: true };
            }

            if (proxyError?.phoneResponseAccepted || proxyError?.phoneRetryableRoute === false) {
                return {
                    success: false,
                    error: proxyError?.phoneResponseAccepted
                        ? `独立 API 响应解析失败: ${proxyError.message || '未知错误'}`
                        : `独立 API 请求失败: ${proxyError.message || '未知错误'}`
                };
            }

            // 针对 proxy_only/compatible 做 OpenAI 协议降级重试（兼容 OP/Build 端口）
            if (provider === 'proxy_only' || provider === 'compatible') {
                if (provider === 'compatible') {
                    try {
                        const customPayload = {
                            chat_completion_source: 'custom',
                            reverse_proxy: apiUrl,
                            custom_url: apiUrl,
                            proxy_password: apiKey,
                            custom_include_headers: JSON.stringify({
                                'Content-Type': 'application/json',
                                ...(authHeader ? { Authorization: authHeader } : {})
                            }),
                            model,
                            messages: cleanMessages,
                            temperature,
                            max_tokens: maxTokens,
                            stream: enableStream,
                            mode: 'chat',
                            instruction_mode: 'chat'
                        };
                        this._attachPhoneSignalToPayload(customPayload, phoneSignal);
                        if (modelLower.includes('gemini')) {
                            const safetyConfig = buildSafetyConfig();
                            customPayload.gemini_safety_settings = safetyConfig;
                            customPayload.safety_settings = safetyConfig;
                            customPayload.safetySettings = safetyConfig;
                        }

                        console.log(`🌐 [ApiManager][后端代理-降级Custom] 目标: ${apiUrl} | 模型: ${model || '未指定'} | 流式: ${enableStream ? '开' : '关'}`);
                        const customResponse = await fetchProxyWithAuthRetry(customPayload, '后端代理-降级Custom');
                        const customResult = await parseProxyResponse(customResponse, customPayload.stream && enableStream, '后端代理-降级Custom');
                        this._setProxyRouteHint(provider, apiUrl, 'custom');
                        return customResult;
                    } catch (customErr) {
                        proxyError = customErr;
                        if (options.signal?.aborted) return { success: false, error: '已中断发送', aborted: true };
                    }
                }

                try {
                    // 1. 修正 URL，确保有 /v1
                    let v1Url = apiUrl;
                    if (!v1Url.includes('/v1') && !v1Url.includes('/chat')) {
                        v1Url = `${v1Url.replace(/\/+$/, '')}/v1`;
                    }

                    // 2. 构建标准 OpenAI Payload (移除所有 custom_include_headers 和 authHeader 的手动注入)
                    // 因为 chat_completion_source 为 'openai' 时，酒馆后端会自动处理 proxy_password 生成正确的 Header
                    const retryPayload = {
                        chat_completion_source: 'openai',
                        reverse_proxy: v1Url,
                        proxy_password: apiKey,
                        model: model,
                        messages: cleanMessages,
                        temperature: temperature,
                        max_tokens: maxTokens,
                        stream: enableStream
                    };
                    this._attachPhoneSignalToPayload(retryPayload, phoneSignal);

                    console.log(`🌐 [ApiManager][后端代理-降级OpenAI] 目标: ${v1Url} | 模型: ${model || '未指定'} | 流式: ${enableStream ? '开' : '关'}`);
                    const retryResponse = await fetchProxyWithAuthRetry(retryPayload, '后端代理-降级OpenAI');
                    const retryResult = await parseProxyResponse(retryResponse, retryPayload.stream && enableStream, '后端代理-降级OpenAI');
                    this._setProxyRouteHint(provider, apiUrl, 'openai');
                    return retryResult;
                } catch (retryErr) {
                    proxyError = retryErr;
                    if (options.signal?.aborted) return { success: false, error: '已中断发送', aborted: true };
                }
            }
        }

        if (useProxy) {
            return {
                success: false,
                error: `酒馆后端代理失败: ${proxyError?.message || '未返回可用响应'}`
            };
        }

        const attemptDirectRequest = async (streamEnabled) => {
            let directUrl = apiUrl;
            const isGeminiOfficial = provider === 'gemini' && !apiUrl.toLowerCase().includes('/v1');

            if (isGeminiOfficial) {
                if (!directUrl.includes(':generateContent')) {
                    if (directUrl.includes('/models/')) directUrl += ':generateContent';
                    else directUrl += `/models/${model}:generateContent`;
                }
            } else if (!directUrl.includes('/chat/completions')) {
                directUrl += '/chat/completions';
            }

            const headers = { 'Content-Type': 'application/json' };
            if (authHeader) headers.Authorization = authHeader;

            let requestBody;
            if (isGeminiOfficial) {
                requestBody = {
                    contents: cleanMessages.map((m, idx) => ({
                        role: m.role === 'user' ? 'user' : 'model',
                        parts: this._contentToGeminiParts(m.content),
                        ...(idx === cleanMessages.length - 1 && phoneSignal ? { gaigaiPhoneSignal: phoneSignal } : {})
                    })),
                    generationConfig: {
                        temperature,
                        maxOutputTokens: maxTokens
                    },
                    safetySettings: buildSafetyConfig()
                };
            } else {
                requestBody = {
                    model,
                    messages: cleanMessages,
                    temperature,
                    max_tokens: maxTokens,
                    stream: streamEnabled,
                    stop: []
                };
                if (modelLower.includes('gemini')) {
                    requestBody.safety_settings = buildSafetyConfig();
                    requestBody.safetySettings = buildSafetyConfig();
                }
            }
            this._attachPhoneSignalToPayload(requestBody, phoneSignal);

            if (isGeminiOfficial && !authHeader && apiKey && !directUrl.includes('key=')) {
                directUrl += (directUrl.includes('?') ? '&' : '?') + `key=${apiKey}`;
            }

            const directResponse = await fetch(directUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
                signal: options.signal
            });

            if (!directResponse.ok) {
                const errText = await directResponse.text();
                let statusTip = '';
                if (directResponse.status === 401) statusTip = ' (API密钥无效)';
                else if (directResponse.status === 404) statusTip = ' (接口地址错误)';
                else if (directResponse.status === 429) statusTip = ' (请求被限流)';
                else if (directResponse.status === 502) statusTip = ' (上游网关错误)';
                else if (directResponse.status === 504) statusTip = ' (请求超时)';
                throw new Error(`直连请求失败 ${directResponse.status}${statusTip}: ${errText.substring(0, 1000)}`);
            }

            if (streamEnabled && directResponse.body) {
                return await this._readUniversalStream(directResponse.body, '[浏览器直连]');
            }

            const text = await directResponse.text();
            return this._parseApiResponse(text);
        };

        try {
            if (!enableStream) {
                return await attemptDirectRequest(false);
            }
            try {
                return await attemptDirectRequest(true);
            } catch (streamErr) {
                const shouldRetryAsNonStream =
                    String(streamErr.message || '').includes('流式') ||
                    String(streamErr.message || '').includes('SSE') ||
                    String(streamErr.message || '').includes('Stream');
                if (!shouldRetryAsNonStream) throw streamErr;
                return await attemptDirectRequest(false);
            }
        } catch (directErr) {
            if (options.signal?.aborted) return { success: false, error: '已中断发送', aborted: true };
            const detail = proxyError ? `后端代理: ${proxyError.message}\n直连: ${directErr.message}` : directErr.message;
            return { success: false, error: detail };
        }
    }

    // ========================================
    // 🔧 工具函数库
    // ========================================
    _processApiUrl(url, provider, forModelFetch = false) {
        if (!url) return '';

        if (provider === 'proxy_only') {
            const cleaned = String(url).trim().replace(/\/+$/, '');
            const isLocalUrl = cleaned.includes('127.0.0.1') || cleaned.includes('localhost') || cleaned.includes('0.0.0.0');
            if (isLocalUrl || forModelFetch) {
                return cleaned.replace(/0\.0\.0\.0/g, '127.0.0.1');
            }
            return cleaned.replace(/0\.0\.0\.0/g, '127.0.0.1');
        }

        let normalized = String(url).trim().replace(/\/+$/, '');
        normalized = normalized.replace(/0\.0\.0\.0/g, '127.0.0.1');
        if (provider !== 'gemini' && provider !== 'claude' && provider !== 'local') {
            const urlParts = normalized.split('/');
            const isRootDomain = urlParts.length <= 3;
            if (!normalized.includes('/v1') && !normalized.includes('/chat') && !normalized.includes('/models') && isRootDomain) {
                normalized += '/v1';
            }
        }
        return normalized;
    }

    _extractStreamContent(chunk) {
        if (!chunk) return { content: '', reasoning: '', finishReason: '', error: null };
        const payload = chunk?.data && typeof chunk.data === 'object'
            && (chunk.data.choices || chunk.data.candidates || chunk.data.error)
            ? chunk.data
            : chunk;
        if (payload.error) {
            const errMsg = payload.error.message || JSON.stringify(payload.error);
            return { content: '', reasoning: '', finishReason: 'error', error: errMsg };
        }

        const choice = payload.choices?.[0];
        const candidate = payload.candidates?.[0];
        const finishReason = choice?.finish_reason || candidate?.finishReason || '';
        if (['safety', 'recitation', 'content_filter'].includes(String(finishReason).toLowerCase())) {
            return { content: '', reasoning: '', finishReason, error: `内容被安全策略拦截 (${finishReason})` };
        }

        const normalizeContent = (value) => {
            if (typeof value === 'string') return value;
            if (!Array.isArray(value)) return '';
            return value.map(part => (
                typeof part === 'string'
                    ? part
                    : String(part?.text || part?.content || '')
            )).join('');
        };
        const candidateParts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
        const reasoning =
            choice?.delta?.reasoning_content
            || choice?.delta?.reasoning
            || choice?.message?.reasoning_content
            || choice?.message?.reasoning
            || candidateParts.filter(part => part?.thought).map(part => String(part?.text || '')).join('')
            || payload.delta?.thinking
            || '';
        const content =
            normalizeContent(choice?.delta?.content)
            || normalizeContent(choice?.delta?.text)
            || normalizeContent(choice?.message?.content)
            || normalizeContent(choice?.text)
            || candidateParts.filter(part => !part?.thought).map(part => String(part?.text || '')).join('')
            || normalizeContent(payload.delta?.message?.content?.text)
            || normalizeContent(payload.delta?.text)
            || normalizeContent(payload.content_block?.text)
            || (payload.object !== 'chat.completion.chunk' ? normalizeContent(payload.content) : '')
            || '';

        return { content, reasoning, finishReason, error: null };
    }

    async _getCsrfToken(forceRefresh = false) {
        // 尝试从全局变量获取（兼容部分酒馆版本）
        if (!forceRefresh && typeof window !== 'undefined' && typeof window.getRequestHeaders === 'function') {
            const headers = window.getRequestHeaders();
            if (headers['X-CSRF-Token']) return headers['X-CSRF-Token'];
            if (headers['x-csrf-token']) return headers['x-csrf-token'];
        }

        const now = Date.now();
        if (!forceRefresh && this.cachedCsrfToken && (now - this.csrfTokenCacheTime < 60000)) return this.cachedCsrfToken;
        try {
            const response = await fetch(`/csrf-token?_=${now}`, { credentials: 'include', cache: 'no-store' });
            const data = await response.json();
            this.cachedCsrfToken = data.token;
            this.csrfTokenCacheTime = now;
            return data.token;
        } catch (error) { return ''; }
    }

    async _getJsonRequestHeaders(options = {}) {
        const forceRefresh = options?.forceRefresh === true;
        const headers = {};

        try {
            if (!forceRefresh && typeof window !== 'undefined' && typeof window.getRequestHeaders === 'function') {
                Object.assign(headers, window.getRequestHeaders() || {});
            }
        } catch (_e) {
            // ignore
        }

        headers['Content-Type'] = headers['Content-Type'] || headers['content-type'] || 'application/json';
        if (!headers['X-CSRF-Token'] && !headers['x-csrf-token']) {
            const csrfToken = await this._getCsrfToken(forceRefresh);
            if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
        }

        return headers;
    }

    _isUnauthorizedResponse(status, body = '') {
        const text = String(body || '').toLowerCase();
        return status === 401 || (status === 400 && /unauthori[sz]ed|csrf|forbidden|invalid token/.test(text));
    }

    _resolveContextLength(context, options = {}) {
        const candidates = [
            options?.max_context_length,
            options?.max_context,
            context?.max_context_length,
            context?.max_context,
            context?.maxContextLength,
            context?.maxContext
        ];
        for (const value of candidates) {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
        const responseFallback = Number.parseInt(context?.max_response_length, 10);
        if (Number.isFinite(responseFallback) && responseFallback > 0) return Math.max(2048, responseFallback);
        return 8192;
    }

    _resolveResponseLength(context) {
        const root = context && typeof context === 'object' ? context : {};
        const oai = root.oai_settings && typeof root.oai_settings === 'object'
            ? root.oai_settings
            : root;
        const getDomValue = (id) => (
            typeof document !== 'undefined' ? document.getElementById(id)?.value : undefined
        );
        const configuredCandidates = [
            getDomValue('openai_max_tokens'),
            oai.openai_max_tokens,
            getDomValue('amount_gen'),
            root.amount_gen,
            oai.amount_gen,
            root.max_response_length,
            oai.max_response_length,
            root.max_length,
            root.maxLength
        ];
        for (const value of configuredCandidates) {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
        throw new Error('无法读取酒馆最大回复长度设置');
    }

    _parseOpenAIModelsResponse(data) {
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch { return []; }
        }
        if (!data) return [];

        const candidates = [];
        const queue = [{ node: data, depth: 0 }];
        while (queue.length > 0) {
            const { node, depth } = queue.shift();
            if (depth > 3) continue;
            if (Array.isArray(node)) {
                candidates.push(node);
                continue;
            }
            if (!node || typeof node !== 'object') continue;
            for (const key of Object.keys(node)) {
                if (key === 'error' || key === 'usage' || key === 'created') continue;
                queue.push({ node: node[key], depth: depth + 1 });
            }
        }

        let bestArray = [];
        let maxScore = -1;
        for (const arr of candidates) {
            if (!Array.isArray(arr) || arr.length === 0) continue;
            const sampleSize = Math.min(arr.length, 5);
            let valid = 0;
            for (let i = 0; i < sampleSize; i++) {
                const item = arr[i];
                if (typeof item === 'string') valid++;
                else if (item && typeof item === 'object' && ('id' in item || 'model' in item || 'name' in item || 'displayName' in item || 'slug' in item)) valid++;
            }
            if (!valid) continue;
            const score = (valid / sampleSize) * 1000 + arr.length;
            if (score > maxScore) {
                maxScore = score;
                bestArray = arr;
            }
        }

        try {
            bestArray = bestArray.filter((m) => {
                const methods = m && typeof m === 'object' ? m.supportedGenerationMethods : undefined;
                return Array.isArray(methods) ? methods.includes('generateContent') : true;
            });
        } catch { }

        const mapped = bestArray
            .filter((m) => m && (typeof m === 'string' || typeof m === 'object'))
            .map((m) => {
                if (typeof m === 'string') return { id: m, name: m };
                let id = m.id || m.name || m.model || m.slug || '';
                if (typeof id === 'string' && id.startsWith('models/')) id = id.replace(/^models\//, '');
                const name = m.displayName || m.name || m.id || id || undefined;
                return id ? { id, name } : null;
            })
            .filter(Boolean);

        const seen = new Set();
        const deduped = mapped.filter((m) => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
        });
        deduped.sort((a, b) => a.id.localeCompare(b.id));
        return deduped;
    }

    _parseApiResponse(rawData) {
        let data = rawData;
        if (typeof data === 'string') {
            const chunkedResult = this._parseChunkedApiText(data);
            if (chunkedResult) return chunkedResult;
            try {
                data = JSON.parse(data);
            } catch {
                const plain = String(data || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
                if (!plain) throw new Error('API 返回内容为空');
                return { success: true, summary: plain };
            }
        }

        if (!data || typeof data !== 'object') {
            throw new Error('API 返回格式异常');
        }
        if (data.error) {
            throw new Error(data.error.message || JSON.stringify(data.error));
        }
        if (this._looksLikeStreamChunk(data)) {
            const { content, reasoning, finishReason, error } = this._extractStreamContent(data);
            if (error) throw new Error(error);
            const summary = String(content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
            if (summary) {
                return {
                    success: true,
                    summary: finishReason === 'length'
                        ? `${summary}\n\n[⚠️ 内容已因达到最大Token限制而截断]`
                        : summary
                };
            }
            if (reasoning && String(reasoning).trim()) {
                const suffix = finishReason === 'length'
                    ? '，可能是 max_tokens 太小，模型把输出额度用在思考过程里'
                    : '';
                throw new Error(`API 只返回了 reasoning_content，未返回正文内容${suffix}`);
            }
            throw new Error('API 返回流式分片但正文为空');
        }

        const maybeArrayContent = data?.choices?.[0]?.message?.content;
        const normalizedArrayContent = Array.isArray(maybeArrayContent)
            ? maybeArrayContent.map((part) => String(part?.text || part?.content || '')).join('')
            : '';

        let content =
            data?.choices?.[0]?.message?.content ||
            data?.choices?.[0]?.text ||
            data?.data?.choices?.[0]?.message?.content ||
            data?.data?.choices?.[0]?.text ||
            data?.candidates?.[0]?.content?.parts?.[0]?.text ||
            data?.content?.[0]?.text ||
            data?.results?.[0]?.text ||
            data?.text ||
            data?.output_text ||
            data?.response ||
            normalizedArrayContent ||
            '';

        content = String(content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
        if (!content) {
            const finishReason = data?.choices?.[0]?.finish_reason || data?.data?.choices?.[0]?.finish_reason || data?.candidates?.[0]?.finishReason;
            if (finishReason === 'safety' || finishReason === 'content_filter' || finishReason === 'SAFETY') {
                throw new Error('内容被安全策略拦截');
            }
            throw new Error('API 返回内容为空');
        }
        return { success: true, summary: content };
    }

    _looksLikeStreamChunk(data) {
        if (!data || typeof data !== 'object') return false;
        if (String(data.object || '').includes('chat.completion.chunk')) return true;
        return !!(data.choices?.[0]?.delta || data.data?.choices?.[0]?.delta);
    }

    _parseChunkedApiText(rawText) {
        const source = String(rawText || '').trim();
        if (!source) return null;

        const chunks = [];
        const pushParsed = (text) => {
            const trimmed = String(text || '').trim();
            if (!trimmed || trimmed === '[DONE]') return;
            try {
                chunks.push(JSON.parse(trimmed));
            } catch {
                // 忽略非 JSON 行。
            }
        };

        pushParsed(source);
        source.split(/\r?\n/).forEach((line) => {
            let trimmed = String(line || '').trim();
            if (!trimmed || trimmed.startsWith(':')) return;
            if (trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]') return;
            if (trimmed.startsWith('data:')) trimmed = trimmed.replace(/^data:\s*/, '');
            pushParsed(trimmed);
        });

        let sawChunk = false;
        let fullText = '';
        let fullReasoning = '';
        let isTruncated = false;
        for (const chunk of chunks) {
            if (!this._looksLikeStreamChunk(chunk)) continue;
            sawChunk = true;
            const { content, reasoning, finishReason, error } = this._extractStreamContent(chunk);
            if (error) throw new Error(error);
            if (finishReason === 'length') isTruncated = true;
            if (content) fullText += content;
            if (reasoning) fullReasoning += reasoning;
        }
        if (!sawChunk) return null;

        let summary = String(fullText || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
        if (summary) {
            if (isTruncated) summary += '\n\n[⚠️ 内容已因达到最大Token限制而截断]';
            return { success: true, summary };
        }
        if (fullReasoning && String(fullReasoning).trim()) {
            const suffix = isTruncated
                ? '，可能是 max_tokens 太小，模型把输出额度用在思考过程里'
                : '';
            throw new Error(`API 只返回了 reasoning_content，未返回正文内容${suffix}`);
        }
        throw new Error('API 返回流式分片但正文为空');
    }

    async _readUniversalStream(body, logPrefix = '') {
        const reader = body.getReader();
        const decoder = new TextDecoder('utf-8');
        const streamReadStartedAt = Date.now();
        let fullText = '';
        let fullReasoning = '';
        let isTruncated = false;
        let buffer = '';
        let rawResponse = '';
        let sawFirstChunk = false;
        let reachedProtocolEnd = false;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (value?.byteLength && !sawFirstChunk) {
                    sawFirstChunk = true;
                    console.log(`⏱️ [ApiManager]${logPrefix} 收到首个流分片: ${Date.now() - streamReadStartedAt}ms`);
                }
                const decoded = value
                    ? decoder.decode(value, { stream: !done })
                    : (done ? decoder.decode() : '');
                buffer += decoded;
                rawResponse += decoded;

                const lines = buffer.split(/\r\n|\r|\n/g);
                buffer = done ? '' : (lines.pop() || '');
                for (const line of lines) {
                    const trimmed = String(line || '').trim();
                    if (!trimmed || trimmed.startsWith(':')) continue;
                    if (trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]' || trimmed === '[DONE]') {
                        reachedProtocolEnd = true;
                        break;
                    }
                    const rawData = trimmed.startsWith('data:')
                        ? trimmed.replace(/^data:\s*/, '')
                        : (trimmed.startsWith('{') ? trimmed : '');
                    if (!rawData) continue;
                    if (rawData === '[DONE]') {
                        reachedProtocolEnd = true;
                        break;
                    }

                    try {
                        const chunk = JSON.parse(rawData);
                        const { content, reasoning, finishReason, error } = this._extractStreamContent(chunk);
                        if (error) throw new Error(`${logPrefix} ${error}`.trim());
                        if (finishReason === 'length') isTruncated = true;
                        if (reasoning) fullReasoning += reasoning;
                        if (content) fullText += content;
                    } catch (error) {
                        if (/安全策略|内容被|unauthori|csrf|forbidden/i.test(String(error?.message || ''))) throw error;
                        // 坏分片留给原始响应兜底；不因单个兼容分片触发整次请求重试。
                    }
                }
                if (!reachedProtocolEnd && !done) {
                    const bufferedMarker = String(buffer || '').trim();
                    if (bufferedMarker === 'data: [DONE]' || bufferedMarker === 'data:[DONE]' || bufferedMarker === '[DONE]') {
                        buffer = '';
                        reachedProtocolEnd = true;
                    }
                }
                if (done || reachedProtocolEnd) break;
            }

            if (reachedProtocolEnd) {
                console.log(`⏱️ [ApiManager]${logPrefix} 收到 [DONE]: ${Date.now() - streamReadStartedAt}ms`);
            }

            let summary = String(fullText || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
            if (!summary && !fullReasoning && rawResponse.trim() && !/(^|\r?\n)\s*data:/.test(rawResponse)) {
                return {
                    ...this._parseApiResponse(rawResponse),
                    streamCompletedAt: Date.now()
                };
            }
            if (!summary && fullReasoning && String(fullReasoning).trim()) {
                throw new Error(`API 只返回了 reasoning_content，未返回正文内容${isTruncated ? '，可能是 max_tokens 太小，模型把输出额度用在思考过程里' : ''}`);
            }
            if (isTruncated && summary) {
                summary += '\n\n[⚠️ 内容已因达到最大Token限制而截断]';
            }
            if (!summary) throw new Error('流式传输返回为空');
            return {
                success: true,
                summary,
                streamCompletedAt: Date.now()
            };
        } finally {
            if (reachedProtocolEnd) {
                try {
                    // [DONE] 已确认协议层完成。取消仍未物理结束的响应体，通知酒馆后端
                    // 释放对应的上游流，避免连续请求耗尽浏览器连接池。
                    await reader.cancel();
                    console.log(`⏱️ [ApiManager]${logPrefix} 已释放完成的流连接`);
                } catch (_e) {
                    // 响应体可能已在 [DONE] 后自行结束，忽略重复关闭错误。
                }
            }
            reader.releaseLock();
        }
    }
}
