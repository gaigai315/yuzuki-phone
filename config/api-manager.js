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

export class ApiManager {
    constructor(storage) {
        this.storage = storage;
        this.cachedCsrfToken = null;
        this.csrfTokenCacheTime = 0;
        this.proxyRouteHints = new Map();
        this._activeRequestCount = 0;
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

    _resolvePhoneApiConfig(rawConfig) {
        if (!rawConfig || typeof rawConfig !== 'object') return rawConfig;

        const config = { ...rawConfig };
        const profiles = Array.isArray(config.profiles) ? config.profiles : [];
        const activeName = String(config.activeProfileName || '').trim();
        const activeProfile = activeName
            ? profiles.find((p) => p && String(p.name || '').trim() === activeName)
            : null;

        if (!activeProfile) return config;

        return {
            ...config,
            useIndependentAPI: activeProfile.useIndependentAPI === true,
            provider: activeProfile.provider || config.provider || 'openai',
            apiUrl: activeProfile.apiUrl || activeProfile.url || config.apiUrl || '',
            apiKey: activeProfile.apiKey || activeProfile.key || config.apiKey || '',
            model: activeProfile.model || config.model || '',
            maxTokens: parseInt(activeProfile.maxTokens, 10) || parseInt(config.maxTokens, 10) || 4096,
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
            maxTokens: parseInt(config.maxTokens, 10) || 4096,
            useStream: config.useStream !== false
        };
    }

    _updateGaigaiLastRequestData(messages, meta = {}) {
        try {
            if (!window || !window.Gaigai || !Array.isArray(messages)) return;

            const debugChat = messages
                .map((m) => {
                    const role = (m?.role === 'system' || m?.role === 'assistant') ? m.role : 'user';
                    const content = String(m?.content || '').trim();
                    if (!content) return null;

                    const item = { role, content };
                    if (m?.name) item.name = m.name;
                    if (m?.isPhoneMessage) item.isPhoneMessage = true;
                    if (m?.gaigaiPhoneSignal) item.gaigaiPhoneSignal = m.gaigaiPhoneSignal;
                    return item;
                })
                .filter(Boolean);

            window.Gaigai.lastRequestData = {
                chat: debugChat,
                timestamp: Date.now(),
                model: meta.model || 'Unknown',
                source: `virtual-phone:${meta.appId || 'phone_online'}`
            };
        } catch (e) {
            console.warn('⚠️ [ApiManager] 同步 lastRequestData 失败:', e);
        }
    }

    // ========================================
    // 🌐 核心暴露接口
    // ========================================
    /**
     * @param {Array} messages - 构建好的对话数组
     * @param {Object} options - 额外参数 (如 signal, max_tokens)
     * @returns {Promise<Object>} { success: boolean, summary: string, error: string }
     */
    async callAI(messages, options = {}) {
        this._activeRequestCount += 1;
        try {
        // 获取当前调用 AI 的 App 标识，默认 phone_online
        const appId = options.appId || 'phone_online';

        // 从存储中读取该 App 的记忆插件权限配置
        const rawPerms = this.storage.get('phone_memory_permissions');
        const allPerms = rawPerms ? JSON.parse(rawPerms) : {};

        // 默认权限（仅初始化默认，用户仍可在设置中修改）
        const basePerms = { allowSummary: false, allowTable: false, allowVector: false, allowPrompt: false };
        const defaultPermsByApp = {
            wechat: { allowSummary: true, allowVector: true },
            weibo: { allowSummary: true, allowVector: true },
            diary: { allowSummary: true, allowVector: true },
            honey: { allowSummary: false, allowTable: false, allowVector: false, allowPrompt: false },
            phone_online: { allowSummary: false, allowTable: false, allowVector: false, allowPrompt: false }
        };
        const defaultPerms = { ...basePerms, ...(defaultPermsByApp[appId] || {}) };
        const currentPerms = { ...defaultPerms, ...(allPerms[appId] || {}) };

        // 给最后一条消息打上通行证标记
        if (Array.isArray(messages) && messages.length > 0) {
            messages[messages.length - 1].gaigaiPhoneSignal = {
                appName: appId,
                allowSummary: currentPerms.allowSummary,
                allowTable: currentPerms.allowTable,
                allowVector: currentPerms.allowVector,
                allowPrompt: currentPerms.allowPrompt
            };
            messages[messages.length - 1].isPhoneMessage = true;
            messages[messages.length - 1].isVirtualPhoneApiCall = true; // 🔥 绝杀：专门贴上手机API专用标签
        }

        // 1. 获取 API 配置 (优先读取 options 中传入的临时配置，用于测试按钮)
        let apiConfig = this._normalizeRuntimeApiConfig(options.overrideApiConfig || null);

        if (!apiConfig) {
            try {
                const phoneConfigRaw = this.storage.get('phone_api_config');
                if (phoneConfigRaw) {
                    const parsed = typeof phoneConfigRaw === 'string' ? JSON.parse(phoneConfigRaw) : phoneConfigRaw;
                    apiConfig = this._normalizeRuntimeApiConfig(this._resolvePhoneApiConfig(parsed));
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
            console.log('🚀 [ApiManager] 智能路由 -> 走向独立 API (流式解析模式)');
            return await this._callIndependentAPI(messages, options, apiConfig);
        } else {
            console.log('🔄 [ApiManager] 智能路由 -> 走向酒馆原生 API (generateRaw)');
            return await this._callTavernAPI(messages, options);
        }
        } finally {
            this._activeRequestCount = Math.max(0, this._activeRequestCount - 1);

            if (window.VirtualPhone) window.VirtualPhone._isInternalRequest = false;
        }
    }

    // ========================================
    // ️ 通道 A: 酒馆原生 API (兜底)
    // ========================================
    async _callTavernAPI(messages, options = {}) {
        try {
            const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
            if (!context || typeof context.generateRaw !== 'function') {
                throw new Error('当前酒馆版本不支持 generateRaw API');
            }

            const responseLength = this._resolveResponseLength(context, options);
            const sourceMessages = Array.isArray(messages) ? messages : [];

            // 核心清洗：默认只保留 role/content，避免 OpenAI Schema 报错；
            // 但保留手机权限信号字段，防止记忆插件权限失效导致全提示词注入。
            const cleanMessages = sourceMessages
                .map((m, idx) => {
                    const role = m?.role === 'system' || m?.role === 'assistant' ? m.role : 'user';
                    const content = String(m?.content || '').trim();
                    if (!content) return null;
                    const normalized = { role, content };

                    const isLast = idx === sourceMessages.length - 1;
                    if (isLast && m?.gaigaiPhoneSignal) {
                        normalized.gaigaiPhoneSignal = m.gaigaiPhoneSignal;
                    }
                    if (m?.isPhoneMessage) {
                        normalized.isPhoneMessage = true;
                    }
                    if (m?.isVirtualPhoneApiCall) {
                        normalized.isVirtualPhoneApiCall = true; // 🔥 确保标签在原生请求中不丢失
                    }
                    return normalized;
                })
                .filter(Boolean);

            if (cleanMessages.length === 0) {
                throw new Error('消息数组为空');
            }

            const isAbortLike = (err) => {
                const msg = String(err?.message || err || '').toLowerCase();
                return err?.name === 'AbortError'
                    || err?.statusText === 'abort'
                    || msg.includes('abort')
                    || msg.includes('api changed')
                    || msg.includes('canceled because main api changed')
                    || msg.includes('cancelled because main api changed');
            };

            const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            const maxRetries = 3;
            let attempt = 0;
            let lastError = null;

            while (attempt < maxRetries) {
                attempt += 1;
                try {
                    // 极简参数：不传 stop:[] 等高风险字段
                    const generateParams = {
                        prompt: cleanMessages,
                        max_tokens: responseLength,
                        quiet: true,
                        skip_save: true,
                        signal: options.signal
                    };

                    const result = await context.generateRaw(generateParams);
                    if (result && typeof result === 'object' && result.error) {
                        throw new Error(result.error?.message || result.error || '调用返回错误');
                    }

                    let text = '';
                    if (typeof result === 'string') {
                        text = result;
                    } else {
                        const maybeArrayContent = result?.choices?.[0]?.message?.content;
                        const normalizedArrayContent = Array.isArray(maybeArrayContent)
                            ? maybeArrayContent.map(part => String(part?.text || part?.content || '')).join('')
                            : '';

                        text =
                            result?.choices?.[0]?.message?.content ||
                            result?.choices?.[0]?.text ||
                            result?.data?.choices?.[0]?.message?.content ||
                            result?.data?.choices?.[0]?.text ||
                            result?.results?.[0]?.text ||
                            result?.text ||
                            result?.content ||
                            (typeof result?.message === 'string' ? result.message : '') ||
                            result?.message?.content ||
                            result?.output_text ||
                            result?.response ||
                            normalizedArrayContent ||
                            '';
                    }

                    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();

                    const explicitNullContent = result?.choices?.[0]?.message?.content === null;
                    if (!text || explicitNullContent) {
                        throw new Error('No message generated');
                    }

                    return { success: true, summary: text };
                } catch (err) {
                    lastError = err;

                    if (options?.signal?.aborted) {
                        return { success: false, error: '已中断发送', aborted: true };
                    }

                    const shouldRetry = isAbortLike(err) || /No message generated/i.test(String(err?.message || ''));
                    if (shouldRetry && attempt < maxRetries) {
                        await delay(1500);
                        continue;
                    }

                    if (isAbortLike(err)) {
                        return { success: false, error: '请求被其他插件中断' };
                    }

                    return { success: false, error: `原生 API 失败: ${err?.message || err}` };
                }
            }

            if (isAbortLike(lastError)) {
                return { success: false, error: '请求被其他插件中断' };
            }
            return { success: false, error: `原生 API 失败: ${lastError?.message || '未知错误'}` };
        } catch (e) {
            if (e.name === 'AbortError' || e.statusText === 'abort') {
                return { success: false, error: '请求被其他插件中断' };
            }
            return { success: false, error: `原生 API 失败: ${e.message}` };
        }
    }
    async _callIndependentAPI(messages, options = {}, apiConfig = {}) {
        const model = apiConfig.model || 'gpt-3.5-turbo';
        const provider = apiConfig.provider || 'openai';
        const modelLower = String(model || '').toLowerCase();
        let apiUrl = this._processApiUrl(apiConfig.apiUrl || '', provider);
        const apiKey = String(apiConfig.apiKey || '').trim();
        const optionMaxTokens = Number.parseInt(options?.max_tokens, 10);
        const configMaxTokens = Number.parseInt(apiConfig?.maxTokens, 10);
        const hasOptionMaxTokens = Number.isFinite(optionMaxTokens) && optionMaxTokens > 0;
        const hasConfigMaxTokens = Number.isFinite(configMaxTokens) && configMaxTokens > 0;
        // 独立 API 默认优先使用手机独立配置中的 maxTokens；
        // 仅在临时覆盖配置（如设置页测试按钮）时，优先使用调用参数传入值。
        const preferOptionMaxTokens = !!options?.overrideApiConfig;
        const maxTokens = preferOptionMaxTokens
            ? (hasOptionMaxTokens ? optionMaxTokens : (hasConfigMaxTokens ? configMaxTokens : 8192))
            : (hasConfigMaxTokens ? configMaxTokens : (hasOptionMaxTokens ? optionMaxTokens : 8192));
        const temperature = apiConfig.temperature || 0.7;
        const enableStream = apiConfig.useStream !== false;

        const sourceMessages = Array.isArray(messages)
            ? messages
            : [{ role: 'user', content: String(messages || '') }];
        const preserveSystem = ['openai', 'deepseek', 'claude', 'gemini', 'siliconflow', 'proxy_only', 'compatible'].includes(provider);
        const cleanMessages = sourceMessages.map((m) => ({
            role: preserveSystem ? (m?.role === 'system' ? 'system' : (m?.role === 'assistant' ? 'assistant' : 'user')) : (m?.role === 'system' ? 'user' : (m?.role || 'user')),
            content: preserveSystem
                ? String(m?.content || '')
                : (m?.role === 'system' ? `[System]: ${String(m?.content || '')}` : String(m?.content || ''))
        }));

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
                throw new Error(`${label} 失败 ${response.status}${tip}: ${errText.substring(0, 1000)}`);
            }
            if (requestStream && response.body) {
                return await this._readUniversalStream(response.body, `[${label}]`);
            }
            const text = await response.text();
            return this._parseApiResponse(text);
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
                let targetSource = 'openai';
                if (provider === 'claude') targetSource = 'claude';
                if (provider === 'proxy_only' || provider === 'local') targetSource = 'custom';
                if (provider === 'proxy_only' || provider === 'compatible') {
                    const hinted = this._getProxyRouteHint(provider, apiUrl);
                    if (hinted === 'custom' || hinted === 'openai') {
                        targetSource = hinted;
                    }
                }

                let cleanBaseUrl = apiUrl;
                if (targetSource === 'openai' && cleanBaseUrl.endsWith('/chat/completions')) {
                    cleanBaseUrl = cleanBaseUrl.replace(/\/chat\/completions\/?$/, '');
                }

                const proxyPayload = {
                    chat_completion_source: targetSource,
                    reverse_proxy: cleanBaseUrl,
                    custom_url: apiUrl,
                    proxy_password: apiKey,
                    custom_include_headers: { 'Content-Type': 'application/json' },
                    model,
                    messages: cleanMessages,
                    temperature,
                    max_tokens: maxTokens,
                    stream: enableStream,
                    mode: 'chat',
                    instruction_mode: 'chat'
                };

                // 动态鉴权头处理
                // Custom模式下，酒馆后端不读取 proxy_password，只从 custom_include_headers 合并
                // 所以我们必须手动把 Key 塞进 Header 里
                // 但如果是 openai/compatible 模式，酒馆会自动处理，绝对不能手动注入防止双重 Header 报错 400
                if (targetSource === 'custom' && authHeader) {
                    proxyPayload.custom_include_headers["Authorization"] = authHeader;
                }
                if (modelLower.includes('gemini')) {
                    const safetyConfig = buildSafetyConfig();
                    proxyPayload.gemini_safety_settings = safetyConfig;
                    proxyPayload.safety_settings = safetyConfig;
                    proxyPayload.safetySettings = safetyConfig;
                }

                const csrfToken = await this._getCsrfToken();
                const proxyResponse = await fetch('/api/backends/chat-completions/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                    body: JSON.stringify(proxyPayload),
                    credentials: 'include',
                    signal: options.signal
                });
                const proxyResult = await parseProxyResponse(proxyResponse, proxyPayload.stream && enableStream, '后端代理');
                if (provider === 'proxy_only' || provider === 'compatible') {
                    this._setProxyRouteHint(provider, apiUrl, targetSource);
                }
                return proxyResult;
            } catch (err) {
                proxyError = err;
                if (options.signal?.aborted) return { success: false, error: '已中断发送', aborted: true };
            }

            // 针对 proxy_only/compatible 做 OpenAI 协议降级重试（兼容 OP/Build 端口）
            if (provider === 'proxy_only' || provider === 'compatible') {
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

                    const csrfToken = await this._getCsrfToken();
                    const retryResponse = await fetch('/api/backends/chat-completions/generate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                        body: JSON.stringify(retryPayload),
                        credentials: 'include',
                        signal: options.signal
                    });
                    const retryResult = await parseProxyResponse(retryResponse, retryPayload.stream && enableStream, '后端代理-降级OpenAI');
                    this._setProxyRouteHint(provider, apiUrl, 'openai');
                    return retryResult;
                } catch (retryErr) {
                    proxyError = retryErr;
                    if (options.signal?.aborted) return { success: false, error: '已中断发送', aborted: true };
                }
            }
        }

        const allowDirectFallback = ['compatible', 'openai', 'gemini', 'deepseek', 'siliconflow'].includes(provider) || !useProxy;
        if (!allowDirectFallback && proxyError) {
            return { success: false, error: `后端代理失败: ${proxyError.message}` };
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
                    contents: cleanMessages.map((m) => ({
                        role: m.role === 'user' ? 'user' : 'model',
                        parts: [{ text: m.content }]
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

            const contentType = directResponse.headers.get('content-type') || '';
            if (contentType.includes('text/event-stream') && directResponse.body) {
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
        if (chunk.error) {
            const errMsg = chunk.error.message || JSON.stringify(chunk.error);
            return { content: '', reasoning: '', finishReason: 'error', error: errMsg };
        }

        const finishReason = chunk.choices?.[0]?.finish_reason || chunk.candidates?.[0]?.finishReason || '';
        if (finishReason === 'SAFETY' || finishReason === 'RECITATION' || finishReason === 'safety') {
            return { content: '', reasoning: '', finishReason, error: `内容被安全策略拦截 (${finishReason})` };
        }

        const reasoning = chunk.choices?.[0]?.delta?.reasoning_content || '';
        let content = '';
        if (chunk.choices?.[0]?.delta?.content) content = chunk.choices[0].delta.content;
        else if (chunk.choices?.[0]?.text) content = chunk.choices[0].text;
        else if (chunk.candidates?.[0]?.content?.parts?.[0]?.text) content = chunk.candidates[0].content.parts[0].text;
        else if (chunk.delta?.text) content = chunk.delta.text;
        else if (chunk.content_block?.text) content = chunk.content_block.text;

        return { content, reasoning, finishReason, error: null };
    }

    async _getCsrfToken() {
        // 尝试从全局变量获取（兼容部分酒馆版本）
        if (typeof window !== 'undefined' && typeof window.getRequestHeaders === 'function') {
            const headers = window.getRequestHeaders();
            if (headers['X-CSRF-Token']) return headers['X-CSRF-Token'];
        }

        const now = Date.now();
        if (this.cachedCsrfToken && (now - this.csrfTokenCacheTime < 60000)) return this.cachedCsrfToken;
        try {
            const response = await fetch('/csrf-token', { credentials: 'include' });
            const data = await response.json();
            this.cachedCsrfToken = data.token;
            this.csrfTokenCacheTime = now;
            return data.token;
        } catch (error) { return ''; }
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

    _resolveResponseLength(context, options = {}) {
        const candidates = [
            options?.max_length,
            options?.max_tokens,
            context?.max_response_length,
            context?.max_length,
            context?.maxLength,
            context?.amount_gen
        ];
        for (const value of candidates) {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
        return 8192;
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

    async _readUniversalStream(body, logPrefix = '') {
        const reader = body.getReader();
        const decoder = new TextDecoder('utf-8');
        let fullText = '';
        let fullReasoning = '';
        let isTruncated = false;
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (value) {
                    buffer += decoder.decode(value, { stream: !done });
                } else if (done) {
                    buffer += decoder.decode();
                }

                const lines = buffer.split('\n');
                if (!done) buffer = lines.pop() || '';
                else buffer = '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith(':')) continue;
                    if (trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]') continue;

                    const sseMatch = trimmed.match(/^data:\s*/);
                    const jsonStr = sseMatch
                        ? trimmed.substring(sseMatch[0].length)
                        : (trimmed.startsWith('{') ? trimmed : null);
                    if (!jsonStr || jsonStr === '[DONE]') continue;

                    try {
                        const chunk = JSON.parse(jsonStr);
                        const { content, reasoning, finishReason, error } = this._extractStreamContent(chunk);
                        if (error) throw new Error(`${logPrefix} ${error}`.trim());
                        if (finishReason === 'length') isTruncated = true;
                        if (reasoning) fullReasoning += reasoning;
                        if (content) fullText += content;
                    } catch (e) {
                        const msg = String(e?.message || '');
                        if (msg.includes('安全策略拦截') || msg.includes('内容被')) {
                            throw e;
                        }
                        // 解析失败容错，忽略单个坏 chunk
                    }
                }
                if (done) break;
            }

            let summary = String(fullText || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
            if (!summary && fullReasoning && String(fullReasoning).trim()) {
                summary = String(fullReasoning).trim();
            }
            if (isTruncated && summary) {
                summary += '\n\n[⚠️ 内容已因达到最大Token限制而截断]';
            }
            if (!summary) throw new Error('流式传输返回为空');
            return { success: true, summary };
        } finally {
            reader.releaseLock();
        }
    }
}





