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
// 微博数据引擎 - 存储、AI调用、解析、队列
// ========================================
import { applyPhoneTagFilter } from '../../config/tag-filter.js';

export class WeiboData {
    constructor(storage) {
        this.storage = storage;
        this._profileKey = 'weibo_profile';
        this._globalBeautifyKey = 'global_weibo_beautify';
        this._beautifyFields = ['avatar', 'banner', 'avatarFrameCss'];

        // API调用队列（防并发）
        this._apiQueue = Promise.resolve();
        this._apiRunning = false;

        // 缓存
        this._recommendCache = null;
        this._hotSearchCache = null;

        // 批量生成控制
        this.stopBatch = false;
    }

    // ========================================
    // 🔧 上下文获取
    // ========================================

    _getContext() {
        return (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
            ? SillyTavern.getContext()
            : null;
    }

    // ========================================
    // 🖼️ 辅助：将图片URL转为Base64供AI视觉使用
    // ========================================
    async _urlToBase64(url) {
        try {
            if (!url) return null;
            if (url.startsWith('data:image')) return url; // 已经是base64
            
            const resp = await fetch(url, { cache: 'no-cache' });
            if (!resp.ok) return null;
            const blob = await resp.blob();
            
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (e) {
            console.warn('[Weibo] 图片转Base64供AI识别失败:', e);
            return null;
        }
    }

    // ========================================
    // 📦 存储操作
    // ========================================

    _readJSON(key, fallback = null) {
        const saved = this.storage.get(key);
        if (!saved) return fallback;
        try {
            return typeof saved === 'string' ? JSON.parse(saved) : saved;
        } catch (e) {
            return fallback;
        }
    }

    // 获取用户资料（头像、背景图、头像框等美化项）
    getProfile() {
        const defaultProfile = {
            avatar: null,
            banner: null,
            avatarFrameCss: '',
            nickname: '',
            bio: '',
            following: 25,
            followers: 0,
            posts: 0,
            ipLocation: 'IP属地：未知',
            verifyText: '微博个人认证'
        };

        const localProfile = this._readJSON(this._profileKey, {}) || {};
        let globalBeautify = this._readJSON(this._globalBeautifyKey, null);

        // 兼容迁移：历史版本把美化项存进会话级 weibo_profile，这里自动抬升到全局键
        if (!globalBeautify) {
            const legacyBeautify = {};
            this._beautifyFields.forEach((field) => {
                if (Object.prototype.hasOwnProperty.call(localProfile, field)) {
                    legacyBeautify[field] = localProfile[field];
                }
            });
            if (Object.keys(legacyBeautify).length > 0) {
                globalBeautify = legacyBeautify;
                this.storage.set(this._globalBeautifyKey, JSON.stringify(legacyBeautify));
            }
        }

        return {
            ...defaultProfile,
            ...localProfile,
            ...(globalBeautify || {})
        };
    }

    saveProfile(profile) {
        const safeProfile = (profile && typeof profile === 'object') ? profile : {};
        const beautifyProfile = {};
        this._beautifyFields.forEach((field) => {
            if (Object.prototype.hasOwnProperty.call(safeProfile, field)) {
                beautifyProfile[field] = safeProfile[field];
            }
        });

        const localProfile = { ...safeProfile };
        this._beautifyFields.forEach((field) => {
            delete localProfile[field];
        });

        this.storage.set(this._globalBeautifyKey, JSON.stringify(beautifyProfile));
        this.storage.set(this._profileKey, JSON.stringify(localProfile));
    }

    // 获取推荐内容缓存
    getRecommendPosts() {
        if (this._recommendCache) return this._recommendCache;
        const saved = this.storage.get('weibo_recommend_posts');
        if (saved) {
            try {
                this._recommendCache = typeof saved === 'string' ? JSON.parse(saved) : saved;
                return this._recommendCache;
            } catch (e) { }
        }
        return [];
    }

    saveRecommendPosts(posts) {
        this._recommendCache = posts;
        this.storage.set('weibo_recommend_posts', JSON.stringify(posts));
    }

    // 获取热搜列表缓存
    getHotSearches() {
        if (this._hotSearchCache) return this._hotSearchCache;
        const saved = this.storage.get('weibo_hot_searches');
        if (saved) {
            try {
                this._hotSearchCache = typeof saved === 'string' ? JSON.parse(saved) : saved;
                return this._hotSearchCache;
            } catch (e) { }
        }
        return [];
    }

    saveHotSearches(searches) {
        this._hotSearchCache = searches;
        this.storage.set('weibo_hot_searches', JSON.stringify(searches));
    }

    // 获取热搜详情缓存
    _getHotDetailKey(title) {
        const hash = this._simpleHash(title);
        return `weibo_hot_detail_${hash}`;
    }

    getHotSearchDetail(title) {
        const key = this._getHotDetailKey(title);
        const saved = this.storage.get(key);
        if (saved) {
            try {
                return typeof saved === 'string' ? JSON.parse(saved) : saved;
            } catch (e) { }
        }
        return null;
    }

    saveHotSearchDetail(title, data) {
        const key = this._getHotDetailKey(title);
        this.storage.set(key, JSON.stringify(data));
    }

    clearHotSearchDetail(title) {
        const key = this._getHotDetailKey(title);
        this.storage.remove(key);
    }

    // 简单hash
    _simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }

    // ========================================
    // 🏢 楼层系统
    // ========================================

    getFloorSettings() {
        const saved = this.storage.get('weibo_floor_settings');
        if (saved) {
            try {
                return typeof saved === 'string' ? JSON.parse(saved) : saved;
            } catch (e) { }
        }
        return {
            totalFloors: 0,
            currentFloor: 0,
            autoInterval: 20,
            autoEnabled: false // 🔥 修改：初始化时默认关闭自动生成
        };
    }

    saveFloorSettings(settings) {
        this.storage.set('weibo_floor_settings', JSON.stringify(settings));
    }

    // 获取某个热搜的楼层数据
    getHotFloorData(title) {
        const key = `weibo_hot_floor_${this._simpleHash(title)}`;
        const saved = this.storage.get(key);
        if (saved) {
            try {
                return typeof saved === 'string' ? JSON.parse(saved) : saved;
            } catch (e) { }
        }
        return { currentFloor: 0, floors: [] };
    }

    saveHotFloorData(title, data) {
        const key = `weibo_hot_floor_${this._simpleHash(title)}`;
        this.storage.set(key, JSON.stringify(data));
    }

    // 修正某楼层内容
    correctFloor(title, floorNum, newContent) {
        const floorData = this.getHotFloorData(title);
        if (floorData.floors[floorNum]) {
            floorData.floors[floorNum] = newContent;
            this.saveHotFloorData(title, floorData);
        }
        // 同时更新详情缓存
        const detail = this.getHotSearchDetail(title);
        if (detail && detail.posts && detail.posts[floorNum]) {
            detail.posts[floorNum] = newContent;
            this.saveHotSearchDetail(title, detail);
        }
    }

    // ========================================
    // 🤖 API队列（防并发）
    // ========================================

    async queueApiCall(fn) {
        return new Promise((resolve, reject) => {
            this._apiQueue = this._apiQueue.then(async () => {
                this._apiRunning = true;
                try {
                    const result = await fn();
                    resolve(result);
                } catch (e) {
                    reject(e);
                } finally {
                    this._apiRunning = false;
                }
            }).catch(err => {
                this._apiRunning = false;
                reject(err);
            });
        });
    }

    isApiRunning() {
        return this._apiRunning;
    }

    // ========================================
    // 🌐 收集上下文（复用moments-view模式）
    // ========================================

    _collectContextMessages(options = {}) {
        const context = this._getContext();
        if (!context) return [];

        const storage = window.VirtualPhone?.storage;
        const contextLimit = storage ? (parseInt(storage.get('phone-context-limit')) || 20) : 20;
        const forceChatLimitRaw = parseInt(options.forceChatLimit, 10);
        const rangeStartRaw = parseInt(options.chatStartIndex, 10);
        const rangeEndRaw = parseInt(options.chatEndIndex, 10);

        const contextMessages = [];

        // 角色卡信息
        let char = null;
        if (context.characterId !== undefined && context.characters?.[context.characterId]) {
            char = context.characters[context.characterId];
            let charInfo = `【角色卡信息】\n角色名：${char.name || '未知'}`;
            if (char.description) charInfo += `\n描述：${char.description.substring(0, 800)}`;
            if (char.personality) charInfo += `\n性格：${char.personality}`;
            if (char.scenario) charInfo += `\n场景/背景：${char.scenario}`;
            if (char.data?.system_prompt) charInfo += `\n角色系统提示词：${char.data.system_prompt.substring(0, 500)}`;
            contextMessages.push(charInfo);
        }

        // 世界书背景（可选）
        try {
            const entriesRaw = char?.data?.character_book?.entries;
            const entries = Array.isArray(entriesRaw)
                ? entriesRaw
                : (entriesRaw && typeof entriesRaw === 'object' ? Object.values(entriesRaw) : []);

            if (entries.length > 0) {
                const chunks = [];
                for (const entry of entries) {
                    if (!entry || entry.enabled === false) continue;
                    const content = String(entry.content || '').trim();
                    if (!content) continue;
                    const title = String(entry.comment || entry.keys || '').trim() || '条目';
                    chunks.push(`【${title.substring(0, 24)}】\n${content.substring(0, 260)}`);
                    if (chunks.length >= 12) break;
                }
                if (chunks.length > 0) {
                    contextMessages.push(`【世界书背景】\n${chunks.join('\n\n')}`);
                }
            }
        } catch (e) {
            console.warn('[Weibo] 读取世界书失败:', e);
        }

        // 用户信息
        const userName = context.name1 || '用户';
        const personaTextarea = document.getElementById('persona_description');
        if (personaTextarea?.value?.trim()) {
            contextMessages.push(`【用户信息】\n用户名：${userName}\n用户设定：${personaTextarea.value.trim().substring(0, 500)}`);
        } else {
            contextMessages.push(`【用户信息】\n用户名：${userName}`);
        }

        // 最近聊天记录
        if (context.chat?.length > 0) {
            const total = context.chat.length;
            const defaultStart = Math.max(0, total - contextLimit);
            const boundedStart = Number.isFinite(rangeStartRaw) ? Math.max(0, Math.min(rangeStartRaw, total)) : defaultStart;
            const boundedEnd = Number.isFinite(rangeEndRaw) ? Math.max(boundedStart, Math.min(rangeEndRaw, total)) : total;
            const scopedChat = context.chat.slice(boundedStart, boundedEnd);

            const effectiveLimit = Number.isFinite(forceChatLimitRaw) && forceChatLimitRaw > 0
                ? forceChatLimitRaw
                : contextLimit;
            const recentChat = scopedChat.slice(-effectiveLimit);
            const chatLines = [];
            recentChat.forEach(msg => {
                if (msg.mes?.trim()) {
                    const rawContent = msg.mes || '';

                    // 私密通道过滤：微信/手机标签与私聊指令不作为微博公共舆论素材
                    if (/<\s*\/?\s*(wechat|phone|music|weibo|回复[^>]*)\s*>/i.test(rawContent)) return;
                    if (/\[转线下\]/.test(rawContent)) return;

                    let content = rawContent;
                    content = applyPhoneTagFilter(content, { storage: this.storage });
                    content = content.replace(/<[^>]*>/g, '').replace(/\*.*?\*/g, '').trim().substring(0, 200);
                    if (content.trim()) {
                        const speaker = msg.is_user ? userName : (context.name2 || '角色');
                        chatLines.push(`${speaker}: ${content}`);
                    }
                }
            });
            if (chatLines.length > 0) {
                contextMessages.push(`【最近剧情对话】（最近${chatLines.length}条）\n${chatLines.join('\n')}`);
            }
        }

        // 微博隐私硬规则
        contextMessages.push(
            `【微博生成隐私规则】\n` +
            `1. 严禁把私密聊天、微信私聊、手机通话、短信等内容直接写成公开微博。\n` +
            `2. 若剧情仅出现私密对话，微博应生成与公共可见事件相关的话题，不得泄露私聊原句与细节。\n` +
            `3. 禁止让路人网友精准复述主角私聊内容。`
        );

        // 当前账号状态（用于让 AI 在回复时感知并更新粉丝数）
        const currentFollowers = this._getCurrentFollowersCount();
        contextMessages.push(`【微博账号状态】\n当前粉丝数量为：${currentFollowers}`);

        return contextMessages;
    }

    _getCurrentFollowersCount() {
        const profile = this.getProfile();
        return Math.max(0, parseInt(profile.followers, 10) || 0);
    }

    _getCurrentWeiboNickname() {
        const context = this._getContext();
        const userName = context?.name1 || '我';
        const profile = this.getProfile();
        return (profile?.nickname || userName || '我').trim();
    }

    _normalizeAtName(name, fallback = '网友') {
        const raw = String(name || '').trim();
        const finalName = raw || fallback;
        return finalName.startsWith('@') ? finalName : `@${finalName}`;
    }

    // 将当前粉丝数注入提示词；若模板未提供占位，也自动补充一行硬约束
    _injectCurrentFollowersToPrompt(promptText) {
        const followers = this._getCurrentFollowersCount();
        let prompt = (typeof promptText === 'string') ? promptText : '';

        prompt = prompt
            .replace(/\{\{currentFollowers\}\}/g, String(followers))
            .replace(/\{\{CURRENT_FOLLOWERS\}\}/g, String(followers));

        if (/当前粉丝数量为[：:]/.test(prompt)) {
            prompt = prompt.replace(/当前粉丝数量为[：:][^\n\r]*/g, `当前粉丝数量为：${followers}`);
        } else {
            prompt += `\n\n当前粉丝数量为：${followers}`;
        }

        return prompt;
    }

    _parseFollowerNumber(raw) {
        if (raw === null || raw === undefined) return null;
        let text = String(raw).trim();
        if (!text) return null;

        text = text
            .replace(/[,\s，]/g, '')
            .replace(/(人|位|名|个)$/u, '');

        const match = text.match(/^(\d+(?:\.\d+)?)(万|[wW])?$/);
        if (!match) return null;

        let value = Number(match[1]);
        if (!Number.isFinite(value)) return null;
        if (match[2]) value *= 10000;

        return Math.max(0, Math.round(value));
    }

    _extractFollowersCount(rawText) {
        if (!rawText || typeof rawText !== 'string') return null;

        const candidates = [];
        const patterns = [
            /当前粉丝(?:数量|数)?(?:为)?[：:]\s*([0-9][0-9,，]*(?:\.\d+)?(?:万|[wW])?(?:人|位|名|个)?)/gi,
            /粉丝(?:数量|数)[：:]\s*([0-9][0-9,，]*(?:\.\d+)?(?:万|[wW])?(?:人|位|名|个)?)/gi,
            /"followers"\s*:\s*"?([0-9][0-9,，]*(?:\.\d+)?(?:万|[wW])?)"?/gi
        ];

        patterns.forEach((regex) => {
            let m;
            while ((m = regex.exec(rawText)) !== null) {
                const parsed = this._parseFollowerNumber(m[1]);
                if (parsed !== null) candidates.push(parsed);
            }
        });

        if (candidates.length === 0) return null;
        return candidates[candidates.length - 1];
    }

    // 统一解析评论行（支持楼中楼：A 回复 B：内容）
    _parseCommentLine(rawLine) {
        if (!rawLine || typeof rawLine !== 'string') return null;

        let line = rawLine.trim();
        if (!line) return null;

        line = line
            .replace(/^\d+[.、．]\s*/, '')
            .replace(/^[\-•]\s*/, '')
            .replace(/^\[([^\]]+)\]/, '$1')
            .trim();

        // 用“最后一个冒号”切分，避免把“IP属地：北京”里的冒号当成正文分隔符
        const splitMatch = line.match(/^(.+)[：:]\s*([\s\S]+)$/);
        if (!splitMatch) return null;

        let head = (splitMatch[1] || '').trim();
        const text = (splitMatch[2] || '').trim();
        if (!head || !text) return null;

        const cleanNameToken = (token) => String(token || '')
            .trim()
            .replace(/^@/, '')
            .replace(/^【/, '')
            .replace(/】$/, '')
            .replace(/^\[/, '')
            .replace(/\]$/, '')
            .trim();

        let location = '';
        // 兼容多种属地写法：()、[]、【】、来自/IP属地 前缀
        const locPatterns = [
            /[（(]\s*(?:来自|IP属地|ip)?[：:\s]*\[?([^\]）)]+)\]?\s*[）)]$/i,
            /[（(]\s*\[?([^\]）)]+)\]?\s*[）)]$/i,
            /(?:\[|【)\s*(?:来自|IP属地|ip)?[：:\s]*\[?([^\]】]+)\]?\s*(?:\]|】)$/i,
            /(?:\[|【)\s*\[?([^\]】]+)\]?\s*(?:\]|】)$/i
        ];
        for (const reg of locPatterns) {
            const locMatch = head.match(reg);
            if (locMatch) {
                location = String(locMatch[1] || '')
                    .replace(/^\s*(?:来自|IP属地|ip)\s*[：:\s]*/i, '')
                    .replace(/^\[/, '')
                    .replace(/\]$/, '')
                    .trim();
                head = head.replace(reg, '').trim();
                break;
            }
        }

        let nameHead = head;
        let replyTo = null;
        const replyMatch = head.match(/^(.+?)\s*回复\s*(.+)$/);
        if (replyMatch) {
            nameHead = cleanNameToken(replyMatch[1]);
            const target = cleanNameToken(replyMatch[2]);
            if (target) replyTo = `@${target}`;
        }

        const nameClean = cleanNameToken(nameHead);
        if (!nameClean || nameClean.length > 30) return null;

        return {
            name: `@${nameClean}`,
            location,
            text,
            replyTo
        };
    }

    _updateFollowersFromText(rawText) {
        const parsedFollowers = this._extractFollowersCount(rawText);
        if (parsedFollowers === null) return null;

        const profile = this.getProfile();
        const current = Math.max(0, parseInt(profile.followers, 10) || 0);
        if (current !== parsedFollowers) {
            profile.followers = parsedFollowers;
            this.saveProfile(profile);
        }
        return parsedFollowers;
    }

    // ========================================
    // 🤖 AI调用
    // ========================================

    async _callAI(prompt, contextMessages = []) {
        const context = this._getContext();
        if (!context) throw new Error('无法访问SillyTavern');
        const userPrompt = (typeof prompt === 'string' && prompt.trim())
            ? prompt
            : '请根据以上系统信息执行当前微博任务，并严格按要求格式输出。';

        const messages = [
            { role: 'system', content: '你是一个资深的微博生态数据生成引擎，请严格根据要求分析上下文并返回正确格式的数据，不要包含任何多余的解释说明。', isPhoneMessage: true },
            ...(Array.isArray(contextMessages)
                ? contextMessages
                    .filter(text => typeof text === 'string' && text.trim())
                    .map(text => ({ role: 'system', content: text, isPhoneMessage: true }))
                : []),
            { role: 'user', content: userPrompt, isPhoneMessage: true }
        ];

        // 🚀 核心：移交 ApiManager 处理
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager) throw new Error('API Manager 未初始化');

        const result = await apiManager.callAI(messages, { max_tokens: context.max_response_length, appId: 'weibo' });

        if (!result.success) {
            throw new Error(result.error || 'AI 返回为空');
        }

        const rawSummary = String(result.summary || result.content || result.text || '');
        const filteredSummary = applyPhoneTagFilter(rawSummary, { storage: this.storage });
        return filteredSummary || rawSummary;
    }

    // 生成推荐内容
    async generateRecommend(onProgress, options = {}) {
        return this.queueApiCall(async () => {
            if (onProgress) onProgress('正在生成推荐内容...');

            const contextMessages = this._collectContextMessages(options);
            const promptManager = window.VirtualPhone?.promptManager;
            promptManager?.ensureLoaded();
            let recommendPrompt = promptManager?.getPromptForFeature('weibo', 'recommend') || '';
            let recommendPromptWithFollowers = this._injectCurrentFollowersToPrompt(recommendPrompt);

            const rawResponse = await this._callAI(recommendPromptWithFollowers, contextMessages);
            const parsed = this.parseWeiboContent(rawResponse);

            // 刷新推荐时保留用户自己发布的微博（“我的”页数据），只替换系统推荐内容
            const existingPosts = this.getRecommendPosts();
            const userPosts = (existingPosts || []).filter(p => p && p.isUserPost);

            // 为每条微博添加ID
            parsed.posts.forEach((post, idx) => {
                post.id = Date.now().toString(36) + idx.toString(36) + Math.random().toString(36).substr(2, 4);
                if (!post.likeList) post.likeList = [];
                if (!post.commentList) post.commentList = [];
            });

            // 覆盖推荐流（保留用户微博），并同步清理旧热搜详情缓存，避免堆积
            this.saveRecommendPosts([...userPosts, ...parsed.posts]);
            const newHotSearches = Array.isArray(parsed.hotSearches) ? parsed.hotSearches : [];
            if (newHotSearches.length > 0) {
                this.cleanupOldHotSearchDetails(newHotSearches);
                this.saveHotSearches(newHotSearches);
            } else {
                // 解析失败保护：不要把已有热搜清空
                console.warn('⚠️ [Weibo] 推荐刷新未解析到热搜，保留现有热搜列表');
            }

            if (onProgress) onProgress('生成完成');
            return parsed;
        });
    }

    // 生成热搜详情
    async generateHotSearchDetail(title, onProgress) {
        return this.queueApiCall(async () => {
            if (onProgress) onProgress('正在生成热搜内容...');

            const contextMessages = this._collectContextMessages();
            const promptManager = window.VirtualPhone?.promptManager;
            promptManager?.ensureLoaded();
            let hotSearchPrompt = promptManager?.getPromptForFeature('weibo', 'hotSearch') || '';

            // 替换热搜标题占位符
            hotSearchPrompt = hotSearchPrompt.replace(/\{\{hotSearchTitle\}\}/g, title);
            hotSearchPrompt = this._injectCurrentFollowersToPrompt(hotSearchPrompt);

            const rawResponse = await this._callAI(hotSearchPrompt, contextMessages);
            const parsed = this.parseWeiboContent(rawResponse);

            // 为每条微博添加ID
            parsed.posts.forEach((post, idx) => {
                post.id = Date.now().toString(36) + idx.toString(36) + Math.random().toString(36).substr(2, 4);
                if (!post.likeList) post.likeList = [];
                if (!post.commentList) post.commentList = [];
            });

            // 缓存到对应热搜
            const detailData = {
                title: title,
                posts: parsed.posts,
                generatedAt: Date.now()
            };
            this.saveHotSearchDetail(title, detailData);

            // 更新楼层数据
            const floorData = this.getHotFloorData(title);
            floorData.currentFloor += parsed.posts.length;
            floorData.floors.push(...parsed.posts);
            this.saveHotFloorData(title, floorData);

            if (onProgress) onProgress('生成完成');
            return detailData;
        });
    }

    // 追加生成热搜内容（楼层追加）
    async appendHotSearchContent(title, onProgress) {
        return this.queueApiCall(async () => {
            if (onProgress) onProgress('正在追加生成...');

            const existing = this.getHotSearchDetail(title);
            const contextMessages = this._collectContextMessages();
            const promptManager = window.VirtualPhone?.promptManager;
            promptManager?.ensureLoaded();
            let hotSearchPrompt = promptManager?.getPromptForFeature('weibo', 'hotSearch') || '';
            hotSearchPrompt = hotSearchPrompt.replace(/\{\{hotSearchTitle\}\}/g, title);
            hotSearchPrompt = this._injectCurrentFollowersToPrompt(hotSearchPrompt);

            // 加入已有内容作为上下文
            let existingContext = '';
            if (existing?.posts?.length > 0) {
                const lastPosts = existing.posts.slice(-3);
                existingContext = '\n\n【已有的微博讨论（请在此基础上继续生成新的不同角度的讨论）】\n';
                lastPosts.forEach(p => {
                    existingContext += `博主：${p.blogger}\n正文：${p.content?.substring(0, 100)}...\n---\n`;
                });
            }

            if (existingContext.trim()) {
                contextMessages.push(existingContext.trim());
            }

            const rawResponse = await this._callAI(hotSearchPrompt, contextMessages);
            const parsed = this.parseWeiboContent(rawResponse);

            parsed.posts.forEach((post, idx) => {
                post.id = Date.now().toString(36) + idx.toString(36) + Math.random().toString(36).substr(2, 4);
                if (!post.likeList) post.likeList = [];
                if (!post.commentList) post.commentList = [];
            });

            // 追加到已有数据
            if (existing) {
                existing.posts.push(...parsed.posts);
                existing.generatedAt = Date.now();
                this.saveHotSearchDetail(title, existing);
            } else {
                const detailData = {
                    title: title,
                    posts: parsed.posts,
                    generatedAt: Date.now()
                };
                this.saveHotSearchDetail(title, detailData);
            }

            // 更新楼层
            const floorData = this.getHotFloorData(title);
            floorData.currentFloor += parsed.posts.length;
            floorData.floors.push(...parsed.posts);
            this.saveHotFloorData(title, floorData);

            if (onProgress) onProgress('追加完成');
            return this.getHotSearchDetail(title);
        });
    }

    // ========================================
    // 📝 <Weibo> 标签解析器
    // ========================================

    parseWeiboContent(rawText) {
        const result = { hotSearches: [], posts: [], followers: null };

        if (!rawText) return result;

        // 支持从 AI 返回中解析粉丝数；如果没识别到则保持旧值不覆盖
        result.followers = this._updateFollowersFromText(rawText);

        // 去除 <think>...</think> 块
        rawText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '');

        // 策略1：提取所有 <Weibo>...</Weibo> 标签内容（支持多个标签）
        const weiboBlocks = [];
        const weiboRegex = /<Weibo>([\s\S]*?)<\/Weibo>/gi;
        let weiboMatch;
        while ((weiboMatch = weiboRegex.exec(rawText)) !== null) {
            weiboBlocks.push(weiboMatch[1].trim());
        }

        // 策略2：如果没有标签，尝试从原文中直接提取（AI可能忘了加标签）
        if (weiboBlocks.length === 0) {
            // 清除明显的AI思考/解释文字（开头的非结构化段落）
            let cleaned = rawText;
            // 去掉开头到第一个"微博热搜"或"博主"之前的废话
            const firstStructure = cleaned.search(/(?:微博热搜[：:]|博主[：:])/);
            if (firstStructure > 0) {
                cleaned = cleaned.substring(firstStructure);
            }
            if (cleaned.includes('博主：') || cleaned.includes('博主:') || cleaned.includes('微博热搜')) {
                weiboBlocks.push(cleaned);
            }
        }

        if (weiboBlocks.length === 0) return result;

        // 合并所有块一起解析
        const allContent = weiboBlocks.join('\n---\n');

        // 先做一次“全局热搜块”提取，避免因为前置行（如“用户粉丝数”）导致 startsWith 失效
        const hotSearchBlockMatch = allContent.match(/微博热搜[：:][\s\S]*?(?=\n(?:-{2,}|—{2,}|={2,})\n|\n博主[：:]|$)/i);
        if (hotSearchBlockMatch) {
            const parsedHotSearches = this._parseHotSearchList(hotSearchBlockMatch[0]);
            if (parsedHotSearches.length > 0) {
                result.hotSearches = parsedHotSearches;
            }
        }

        // 用多种分隔符切割：---、——— 或连续横线
        const sections = allContent.split(/\n-{2,}\n|\n—{2,}\n|\n={2,}\n/);

        for (const section of sections) {
            const trimmed = section.trim();
            if (!trimmed) continue;

            // 检查是否为热搜列表
            if (trimmed.startsWith('微博热搜：') || trimmed.startsWith('微博热搜:') || trimmed.startsWith('微博热搜：')) {
                const parsed = this._parseHotSearchList(trimmed);
                if (parsed.length > 0) {
                    result.hotSearches = parsed;
                }
                continue;
            }

            // 尝试解析为微博帖子
            const post = this._parseWeiboPost(trimmed);
            if (post) {
                result.posts.push(post);
            }
        }

        // 策略3：如果分隔符切割后没有帖子，尝试按"博主："关键词切割
        if (result.posts.length === 0 && allContent.includes('博主')) {
            const bloggerSections = allContent.split(/(?=博主[：:])/);
            for (const section of bloggerSections) {
                const trimmed = section.trim();
                if (!trimmed) continue;
                const post = this._parseWeiboPost(trimmed);
                if (post) {
                    result.posts.push(post);
                }
            }
        }

        return result;
    }

    // 解析热搜列表
    _parseHotSearchList(text) {
        const searches = [];
        const lines = text.split('\n');

        // 跳过标题行，找到编号列表
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('微博热搜')) continue;

            // 匹配多种格式：1.[标题]（标签）、1.标题（标签）、1、标题（标签）
            const match = trimmed.match(/^\d+[.、．]\s*\[?([^\]（()]+?)\]?\s*(?:[（(](爆|热|新|荐)[）)])?$/);
            if (match) {
                searches.push({
                    rank: searches.length + 1,
                    title: match[1].trim(),
                    tag: match[2] || null
                });
                continue;
            }

            // 更宽松：只要以数字开头
            const looseMatch = trimmed.match(/^\d+[.、．\s]\s*(.+?)(?:\s*[（(](爆|热|新|荐)[）)])?$/);
            if (looseMatch && looseMatch[1].length > 2) {
                searches.push({
                    rank: searches.length + 1,
                    title: looseMatch[1].trim().replace(/^\[|\]$/g, ''),
                    tag: looseMatch[2] || null
                });
            }
        }

        return searches;
    }

    // 解析单条微博帖子
    _parseWeiboPost(text) {
        if (!text.includes('博主：') && !text.includes('博主:')) return null;

        const post = {
            blogger: '',
            bloggerType: '',
            time: '',
            device: '',
            content: '',
            images: [],
            forward: 0,
            comments: 0,
            likes: 0,
            commentList: [],
            likeList: []
        };

        const lines = text.split('\n');
        let inComments = false;
        let inContent = false;
        let contentLines = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // 博主行
            if (trimmed.startsWith('博主：') || trimmed.startsWith('博主:')) {
                // 如果正在收集正文，先结束
                if (inContent && contentLines.length > 0) {
                    post.content = contentLines.join('\n');
                    contentLines = [];
                    inContent = false;
                }
                const bloggerMatch = trimmed.match(/博主[：:]\s*(.+?)\s*[（(](.+?)[）)]/);
                if (bloggerMatch) {
                    post.blogger = bloggerMatch[1].trim();
                    post.bloggerType = bloggerMatch[2].trim();
                } else {
                    post.blogger = trimmed.replace(/^博主[：:]/, '').trim();
                }
                inComments = false;
                continue;
            }

            // 时间行
            if (trimmed.startsWith('时间：') || trimmed.startsWith('时间:')) {
                if (inContent) { post.content = contentLines.join('\n'); contentLines = []; inContent = false; }
                post.time = trimmed.replace(/^时间[：:]/, '').trim();
                continue;
            }

            // 来自行
            if (trimmed.startsWith('来自：') || trimmed.startsWith('来自:')) {
                if (inContent) { post.content = contentLines.join('\n'); contentLines = []; inContent = false; }
                post.device = trimmed.replace(/^来自[：:]/, '').trim();
                continue;
            }

            // 正文行（开始收集多行正文）
            if (trimmed.startsWith('正文：') || trimmed.startsWith('正文:')) {
                inContent = true;
                inComments = false;
                const firstLine = trimmed.replace(/^正文[：:]/, '').trim();
                if (firstLine) contentLines.push(firstLine);
                continue;
            }

            // 配图行（结束正文收集）
            if (trimmed.startsWith('配图：') || trimmed.startsWith('配图:')) {
                if (inContent) { post.content = contentLines.join('\n'); contentLines = []; inContent = false; }
                const imgText = trimmed.replace(/^配图[：:]/, '').trim();
                // 支持格式：[图片]（文字描述）、[图片](文字描述)、[xxx]
                const pairMatches = [...imgText.matchAll(/\[图片\][（(]([^）)]+)[）)]/g)];
                if (pairMatches.length > 0) {
                    post.images = pairMatches.map(m => m[1]);
                } else {
                    const imgMatches = imgText.match(/\[[^\]]+\]/g);
                    post.images = imgMatches || (imgText ? [imgText] : []);
                }
                continue;
            }

            // 数据行
            if (trimmed.startsWith('数据：') || trimmed.startsWith('数据:')) {
                if (inContent) { post.content = contentLines.join('\n'); contentLines = []; inContent = false; }
                const statsMatch = trimmed.match(/转发\s*[\[【]?(\d+)[\]】]?\s*\|?\s*评论\s*[\[【]?(\d+)[\]】]?\s*\|?\s*点赞\s*[\[【]?(\d+)[\]】]?/);
                if (statsMatch) {
                    post.forward = parseInt(statsMatch[1]) || 0;
                    post.comments = parseInt(statsMatch[2]) || 0;
                    post.likes = parseInt(statsMatch[3]) || 0;
                }
                continue;
            }

            // 评论区标记
            if (trimmed.startsWith('评论区') || trimmed.match(/^评论.*[（(].*IP/)) {
                if (inContent) { post.content = contentLines.join('\n'); contentLines = []; inContent = false; }
                inComments = true;
                continue;
            }

            // 评论内容
            if (inComments) {
                const parsedComment = this._parseCommentLine(trimmed);
                if (parsedComment) {
                    post.commentList.push(parsedComment);
                }
                continue;
            }

            // 如果正在收集多行正文
            if (inContent) {
                contentLines.push(trimmed);
                continue;
            }
        }

        // 收尾：如果正文还在收集中
        if (inContent && contentLines.length > 0) {
            post.content = contentLines.join('\n');
        }

        return post.blogger ? post : null;
    }

    // ========================================
    // 👍 点赞/评论系统
    // ========================================

    toggleLike(postId, source = 'recommend') {
        const posts = source === 'recommend' ? this.getRecommendPosts() : null;
        if (!posts) return;

        const post = posts.find(p => p.id === postId);
        if (!post) return;

        const context = this._getContext();
        const userName = context?.name1 || '我';

        if (!post.likeList) post.likeList = [];

        const index = post.likeList.indexOf(userName);
        if (index === -1) {
            post.likeList.push(userName);
            post.likes = (post.likes || 0) + 1;
        } else {
            post.likeList.splice(index, 1);
            post.likes = Math.max(0, (post.likes || 0) - 1);
        }

        this.saveRecommendPosts(posts);
        return post;
    }

    toggleLikeHotSearch(postId, title) {
        const detail = this.getHotSearchDetail(title);
        if (!detail?.posts) return;

        const post = detail.posts.find(p => p.id === postId);
        if (!post) return;

        const context = this._getContext();
        const userName = context?.name1 || '我';

        if (!post.likeList) post.likeList = [];

        const index = post.likeList.indexOf(userName);
        if (index === -1) {
            post.likeList.push(userName);
            post.likes = (post.likes || 0) + 1;
        } else {
            post.likeList.splice(index, 1);
            post.likes = Math.max(0, (post.likes || 0) - 1);
        }

        this.saveHotSearchDetail(title, detail);
        return post;
    }

    // 评论点赞（支持推荐流与热搜详情）
    toggleCommentLike(postId, commentIndex, source = 'recommend', hotSearchTitle = null) {
        let post = null;
        let posts = null;
        let detail = null;

        if (source === 'recommend') {
            posts = this.getRecommendPosts();
            post = posts?.find(p => p.id === postId);
        } else {
            detail = this.getHotSearchDetail(hotSearchTitle);
            posts = detail?.posts;
            post = posts?.find(p => p.id === postId);
        }
        if (!post || !Array.isArray(post.commentList)) return null;

        const idx = Number.parseInt(commentIndex, 10);
        if (!Number.isInteger(idx) || idx < 0 || idx >= post.commentList.length) return null;

        const comment = post.commentList[idx];
        if (!comment) return null;

        const liker = String(this._getCurrentWeiboNickname() || '我').replace(/^@/, '').trim() || '我';
        if (!Array.isArray(comment.likeUsers)) comment.likeUsers = [];

        // 统一把昵称存为无 @ 版本，防止重复键
        const likeUsersNormalized = comment.likeUsers
            .map(n => String(n || '').replace(/^@/, '').trim())
            .filter(Boolean);
        comment.likeUsers = Array.from(new Set(likeUsersNormalized));

        let likeCount = Number.parseInt(comment.likeCount, 10);
        if (!Number.isFinite(likeCount) || likeCount < 0) {
            const seedName = String(comment.name || '');
            const seed = Math.floor(Math.abs(Math.sin((seedName.charCodeAt(0) || 0) + idx)) * 150) + 2;
            likeCount = seed;
        }

        const existedIdx = comment.likeUsers.indexOf(liker);
        let liked = false;
        if (existedIdx === -1) {
            comment.likeUsers.push(liker);
            likeCount += 1;
            liked = true;
        } else {
            comment.likeUsers.splice(existedIdx, 1);
            likeCount = Math.max(0, likeCount - 1);
            liked = false;
        }
        comment.likeCount = likeCount;

        if (source === 'recommend') {
            this.saveRecommendPosts(posts);
        } else {
            this.saveHotSearchDetail(hotSearchTitle, detail);
        }

        return { liked, likeCount, commentIndex: idx, postId };
    }

    addComment(postId, text, replyTo = null, source = 'recommend', commenterName = null, location = '本地') {
        const posts = source === 'recommend' ? this.getRecommendPosts() : null;
        if (!posts) return;

        const post = posts.find(p => p.id === postId);
        if (!post) return;

        const defaultName = this._getCurrentWeiboNickname();
        const finalName = this._normalizeAtName(commenterName || defaultName, defaultName || '我');
        const finalLocation = String(location || '本地');

        if (!post.commentList) post.commentList = [];
        post.commentList.push({
            name: finalName,
            location: finalLocation,
            text: text,
            replyTo: replyTo
        });
        post.comments = post.commentList.length;

        this.saveRecommendPosts(posts);
        return post;
    }

    addCommentHotSearch(postId, text, replyTo = null, title, commenterName = null, location = '本地') {
        const detail = this.getHotSearchDetail(title);
        if (!detail?.posts) return;

        const post = detail.posts.find(p => p.id === postId);
        if (!post) return;

        const defaultName = this._getCurrentWeiboNickname();
        const finalName = this._normalizeAtName(commenterName || defaultName, defaultName || '我');
        const finalLocation = String(location || '本地');

        if (!post.commentList) post.commentList = [];
        post.commentList.push({
            name: finalName,
            location: finalLocation,
            text: text,
            replyTo: replyTo
        });
        post.comments = post.commentList.length;

        this.saveHotSearchDetail(title, detail);
        return post;
    }

    // ========================================
    // 📝 用户发微博
    // ========================================

    publishUserPost(text, images = []) {
        const context = this._getContext();
        const userName = context?.name1 || '微博用户';
        const profile = this.getProfile();
        const nickname = profile.nickname || userName;

        const newPost = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
            blogger: nickname,
            bloggerType: '博主',
            time: '刚刚',
            device: 'iPhone 15 Pro',
            content: text,
            // 🔥 核心修复：认出真实服务器图片路径，不再将它们转为纯文本 [文字描述]
            images: images.map(img => (img.startsWith('data:') || img.startsWith('/') || img.startsWith('http')) ? img : `[${img}]`),
            forward: 0,
            comments: 0,
            likes: 0,
            likeList: [],
            commentList: [],
            isUserPost: true
        };

        // 插入到推荐列表最前面
        const posts = this.getRecommendPosts();
        posts.unshift(newPost);
        this.saveRecommendPosts(posts);

        // 更新profile的动态数
        profile.posts = (profile.posts || 0) + 1;
        this.saveProfile(profile);

        return newPost;
    }

    // 删除用户自己发布的微博（用于“我的”页卡片右上角删除）
    deleteUserPost(postId) {
        if (!postId) return { success: false };

        let posts = this.getRecommendPosts();
        let idx = posts.findIndex(p => p.id === postId && p.isUserPost);

        // 兜底：某些时机缓存可能与持久化暂时不同步，回退到存储层再尝试一次
        if (idx === -1) {
            const saved = this.storage.get('weibo_recommend_posts');
            if (saved) {
                try {
                    const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
                    if (Array.isArray(parsed)) {
                        posts = parsed;
                        idx = posts.findIndex(p => p.id === postId && p.isUserPost);
                    }
                } catch (e) {
                    // ignore parse error and keep original result
                }
            }
        }

        if (idx === -1) return { success: false };

        // 🔥 提取要删除的微博中的图片列表，返回给前端去清理服务器文件
        const deletedPost = posts[idx];
        const imagesToDelete = Array.isArray(deletedPost.images) ? [...deletedPost.images] : [];

        posts.splice(idx, 1);
        this.saveRecommendPosts(posts);

        // 同步修正“动态数”，避免显示不一致
        const profile = this.getProfile();
        profile.posts = Math.max(0, (parseInt(profile.posts, 10) || 0) - 1);
        this.saveProfile(profile);

        // 返回成功状态以及需要清理的图片数组
        return { success: true, images: imagesToDelete };
    }

    // 微信收到/点击的微博卡片，同步写入微博推荐页顶部（复用微博正文页渲染）
    upsertFromWechatWeiboCard(weiboData = {}, options = {}) {
        const blogger = String(weiboData?.blogger || options?.fallbackBlogger || '微博').trim();
        const content = String(weiboData?.content || '').trim();
        if (!blogger && !content) return null;

        const time = String(weiboData?.time || '刚刚').trim();
        const device = String(weiboData?.device || '微博网页版').trim();
        const bloggerType = String(weiboData?.bloggerType || '普通网友').trim();

        const normalizeComments = (list) => (Array.isArray(list) ? list : []).map((c) => ({
            name: String(c?.name || '网友').trim() || '网友',
            location: String(c?.location || '').trim(),
            text: String(c?.text || '').trim(),
            replyTo: String(c?.replyTo || '').trim()
        })).filter(c => c.text);

        const normalizeImages = (images) => (Array.isArray(images) ? images : [])
            .map(img => String(img || '').trim())
            .filter(Boolean)
            .slice(0, 9);

        const commentList = normalizeComments(weiboData?.commentList);
        const images = normalizeImages(weiboData?.images);
        const forward = Math.max(0, parseInt(weiboData?.forward, 10) || 0);
        const likes = Math.max(0, parseInt(weiboData?.likes, 10) || 0);
        const comments = Math.max(0, parseInt(weiboData?.comments, 10) || commentList.length);
        const likeList = Array.isArray(weiboData?.likeList) ? [...weiboData.likeList] : [];

        const fingerprint = `${blogger}|${content}|${time}|${device}`;
        const posts = this.getRecommendPosts();
        const existed = posts.find(p => p && p.fromWechatCard && p.fingerprint === fingerprint);
        if (existed) return existed;

        const newPost = {
            id: `wxwb_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            blogger,
            bloggerType,
            time,
            device,
            content,
            images,
            forward,
            comments,
            likes,
            likeList,
            commentList,
            fromWechatCard: true,
            fingerprint
        };

        posts.unshift(newPost);
        this.saveRecommendPosts(posts);
        return newPost;
    }

    // ========================================
    // 🤖 AI互动：陌生网友对用户微博的反应
    // ========================================

    async generateReactionForPost(post) {
        return this.queueApiCall(async () => {
            const context = this._getContext();
            const userName = context?.name1 || '用户';
            const contextMessages = this._collectContextMessages();
            const currentFollowers = this._getCurrentFollowersCount();

            // 🔥🔥🔥 核心修复：处理微博图片，生成多模态代币 🔥🔥🔥
            let imageTokensStr = '';
            if (post.images && post.images.length > 0) {
                if (!window.VirtualPhone) window.VirtualPhone = {};
                if (!window.VirtualPhone._pendingImages) window.VirtualPhone._pendingImages = {};

                for (let i = 0; i < post.images.length; i++) {
                    const imgUrl = post.images[i];
                    // 只处理真实的图片URL，忽略类似 "[图片]" 这种纯文本占位符
                    if (imgUrl.startsWith('data:image') || imgUrl.startsWith('/') || imgUrl.startsWith('http')) {
                        const b64 = await this._urlToBase64(imgUrl);
                        if (b64) {
                            const tokenId = `__ST_PHONE_IMAGE_${Date.now()}_${Math.random().toString(36).substr(2, 5)}__`;
                            window.VirtualPhone._pendingImages[tokenId] = b64;
                            imageTokensStr += `\n${tokenId}`; // 把代币加到提示词里
                        }
                    }
                }
            }

            // 组装最终展示给 AI 的微博内容
            let postContentDisplay = post.content || '';
            if (imageTokensStr) {
                postContentDisplay += `\n[用户附带了以下真实图片，请务必结合图片画面细节进行评价互动]${imageTokensStr}`;
            } else if (!post.content && post.images && post.images.length > 0) {
                postContentDisplay = '[分享了图片]';
            }

            const prompt = `【微博互动任务】

用户"${userName}"刚在微博上发了一条动态，请模拟真实微博环境，生成陌生网友、营销号或官方号对这条微博的互动反应。
当前粉丝数量为：${currentFollowers}

用户发布的微博内容：
"${postContentDisplay}"

要求：
1. 生成2-5个互动反应（点赞或评论）
2. 互动者必须是【陌生网友】【营销号】【官方号】等微博上的陌生人，不要使用好友名字
3. 网友名字要真实有微博风格（如：@爱吃糖的小猫咪、@吃瓜群众本群、@今天也要加油鸭、@路人甲没有感情）
4. 评论内容要符合微博网感（用emoji、网络用语等）
5. 需要体现地域IP属性
6. 如果你判断互动会导致粉丝增长或下降，可额外返回 followers 字段（整数）；若无变化可省略
7. 评论可选 replyTo 字段用于楼中楼（如回复某个已存在评论者）
8. 当 comments >= 3 时，至少包含1条楼中楼回复（带 replyTo），避免全是平铺评论

输出格式（只返回JSON）：
\`\`\`json
{
  "comments": [
    {"name": "@网友昵称", "text": "评论内容", "location": "省份", "replyTo": "@被回复者昵称"}
  ],
  "likes": ["@点赞者昵称1", "@点赞者昵称2"],
  "followers": 1234
}
\`\`\`

请生成互动：`;

            const response = await this._callAI(prompt, contextMessages);
            this._updateFollowersFromText(response);

            // 解析JSON
            let jsonStr = null;
            const codeBlockMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
            if (codeBlockMatch) {
                jsonStr = codeBlockMatch[1].trim();
            }
            if (!jsonStr) {
                const directMatch = response.match(/\{[\s\S]*"comments"[\s\S]*\}/);
                if (directMatch) jsonStr = directMatch[0];
            }
            if (!jsonStr) {
                const anyMatch = response.match(/\{[\s\S]*\}/);
                if (anyMatch) jsonStr = anyMatch[0];
            }

            if (jsonStr) {
                try {
                    // 🔥 自动修复 AI 常见的格式错误
                    jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');
                    return JSON.parse(jsonStr);
                } catch (err) {
                    console.error('🔥 AI返回数据解析失败，已拦截卡死:', err);
                    return { comments: [], likes: [] };
                }
            }

            return { comments: [], likes: [] };
        });
    }

    // ========================================
    // 🤖 AI互动：AI回复用户针对某条微博的评论
    // ========================================
    async generateReplyForUserComment(post, userComment, replyTo) {
        return this.queueApiCall(async () => {
            const context = this._getContext();
            const userName = context?.name1 || '用户';
            const contextMessages = this._collectContextMessages();
            const currentFollowers = this._getCurrentFollowersCount();

            // 🔥🔥🔥 核心修复：处理微博图片，生成多模态代币 🔥🔥🔥
            let imageTokensStr = '';
            if (post.images && post.images.length > 0) {
                if (!window.VirtualPhone) window.VirtualPhone = {};
                if (!window.VirtualPhone._pendingImages) window.VirtualPhone._pendingImages = {};

                for (let i = 0; i < post.images.length; i++) {
                    const imgUrl = post.images[i];
                    if (imgUrl.startsWith('data:image') || imgUrl.startsWith('/') || imgUrl.startsWith('http')) {
                        const b64 = await this._urlToBase64(imgUrl);
                        if (b64) {
                            const tokenId = `__ST_PHONE_IMAGE_${Date.now()}_${Math.random().toString(36).substr(2, 5)}__`;
                            window.VirtualPhone._pendingImages[tokenId] = b64;
                            imageTokensStr += `\n${tokenId}`;
                        }
                    }
                }
            }

            let postContentDisplay = post.content || '';
            if (imageTokensStr) {
                postContentDisplay += `\n[此微博附带了以下真实图片，请务必结合图片画面细节进行评价互动]${imageTokensStr}`;
            } else if (!post.content && post.images && post.images.length > 0) {
                postContentDisplay = '[分享了图片]';
            }

            const prompt = `【微博评论互动任务】

用户"${userName}"在一条微博下发表了评论，请模拟真实微博环境，生成博主或吃瓜网友对该用户的回复。
当前粉丝数量为：${currentFollowers}

微博正文：
"${postContentDisplay}"

用户"${userName}"的评论：
${replyTo ? `回复了 ${replyTo}：` : ''}"${userComment}"

要求：
1. 生成1-2条针对用户该条评论的回复。
2. 回复者可以是博主本人（${post.blogger}），也可以是其他吃瓜网友或粉丝。
3. 语气必须符合微博网感（如：吃瓜、护主、阴阳怪气、赞同等）。
4. 必须带上地域IP属性。
5. 如果你判断粉丝会变化，可额外返回 followers 字段（整数）；若无变化可省略。
6. 如果是楼中楼回复，请在评论对象中提供 replyTo 字段（如 "@张三"）。
7. 当你输出2条评论时，优先让其中1条为楼中楼（replyTo 指向评论区已出现昵称）。

输出格式（只返回JSON）：
\`\`\`json
{
  "comments": [
    {"name": "回复者昵称", "text": "回复内容", "location": "省份", "replyTo": "@被回复者昵称"}
  ],
  "followers": 1234
}
\`\`\`

请生成回复：`;

            const response = await this._callAI(prompt, contextMessages);
            this._updateFollowersFromText(response);

            // 解析JSON
            let jsonStr = null;
            const codeBlockMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
            if (codeBlockMatch) {
                jsonStr = codeBlockMatch[1].trim();
            }
            if (!jsonStr) {
                const directMatch = response.match(/\{[\s\S]*"comments"[\s\S]*\}/);
                if (directMatch) jsonStr = directMatch[0];
            }
            if (!jsonStr) {
                const anyMatch = response.match(/\{[\s\S]*\}/);
                if (anyMatch) jsonStr = anyMatch[0];
            }

            if (jsonStr) {
                try {
                    jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');
                    return JSON.parse(jsonStr);
                } catch (err) {
                    console.error('🔥 AI回复解析失败，已拦截卡死:', err);
                    return { comments: [] };
                }
            }

            return { comments: [] };
        });
    }

    // ========================================
    // 💬 AI生成更多评论
    // ========================================

    async generateMoreComments(postId, source = 'recommend', hotSearchTitle = null) {
        return this.queueApiCall(async () => {
            // 找到帖子
            let posts, post;
            if (source === 'recommend') {
                posts = this.getRecommendPosts();
                post = posts?.find(p => p.id === postId);
            } else {
                const detail = this.getHotSearchDetail(hotSearchTitle);
                posts = detail?.posts;
                post = posts?.find(p => p.id === postId);
            }
            if (!post) throw new Error('找不到该微博');

            const contextMessages = this._collectContextMessages();
            const promptManager = window.VirtualPhone?.promptManager;
            promptManager?.ensureLoaded();
            let commentPrompt = promptManager?.getPromptForFeature('weibo', 'moreComments') || '';
            commentPrompt = commentPrompt.replace(/\{\{weiboContent\}\}/g, post.content || '');

            const rawResponse = await this._callAI(commentPrompt, contextMessages);
            this._updateFollowersFromText(rawResponse);

            // 解析评论
            const newComments = this._parseCommentsFromResponse(rawResponse);

            if (newComments.length > 0) {
                if (!post.commentList) post.commentList = [];
                post.commentList.push(...newComments);
                post.comments = post.commentList.length;

                // 保存
                if (source === 'recommend') {
                    this.saveRecommendPosts(posts);
                } else {
                    const detail = this.getHotSearchDetail(hotSearchTitle);
                    this.saveHotSearchDetail(hotSearchTitle, detail);
                }
            }

            return newComments;
        });
    }

    // 从AI返回中解析评论列表
    _parseCommentsFromResponse(rawText) {
        const comments = [];
        if (!rawText) return comments;

        // 提取 <Weibo> 标签内容
        const weiboMatch = rawText.match(/<Weibo>([\s\S]*?)<\/Weibo>/i);
        const content = weiboMatch ? weiboMatch[1] : rawText;

        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const parsed = this._parseCommentLine(trimmed);
            if (parsed) comments.push(parsed);
        }

        return comments;
    }

    // ========================================
    // 📤 转发到微信 (支持跨应用后台静默唤醒)
    // ========================================

    async forwardToWechat(post, friendName, options = {}) {
        // 🔥 核心修复：如果微信还没打开过，静默加载微信数据引擎
        let wechatData = window.VirtualPhone?.wechatApp?.wechatData || window.VirtualPhone?.cachedWechatData;
        if (!wechatData) {
            try {
                const module = await import('../wechat/wechat-data.js');
                wechatData = new module.WechatData(this.storage);
                if (window.VirtualPhone) window.VirtualPhone.cachedWechatData = wechatData;
            } catch (e) {
                throw new Error('微信数据库加载失败');
            }
        }

        const forwardText = String(options?.forwardText || '').trim();
        const userInfo = wechatData.getUserInfo();

        // 查找或创建聊天会话
        let chatId = null;

        // 1. 先从聊天列表查找已有会话
        const chatList = wechatData.getChatList();
        const existingChat = chatList.find(c => c.name === friendName);
        if (existingChat) {
            chatId = existingChat.id;
        }

        // 2. 没有聊天会话，从通讯录查找联系人并自动创建新聊天！
        if (!chatId) {
            const contacts = wechatData.getContacts();
            const contact = contacts.find(c => c.name === friendName);
            if (contact) {
                const newChat = wechatData.createChat({
                    id: 'chat_' + (contact.id || Date.now().toString()),
                    contactId: contact.id,
                    name: contact.name,
                    type: 'single',
                    avatar: contact.avatar
                });
                chatId = newChat.id;
            }
        }

        // 3. 连联系人都没有，创建一个临时会话
        if (!chatId) {
            const newChat = wechatData.createChat({
                name: friendName,
                type: 'single',
                avatar: '👤'
            });
            chatId = newChat.id;
        }

        // 附言（可选）：作为独立文本先发送
        if (forwardText) {
            wechatData.addMessage(chatId, {
                from: 'me',
                content: forwardText,
                type: 'text',
                avatar: userInfo.avatar || ''
            });
        }

        // 构建微博卡片消息并发送
        const originalWeiboTime = post.time || '';
        const addResult = wechatData.addMessage(chatId, {
            from: 'me',
            type: 'weibo_card',
            content: this._buildWeiboFullText(post),
            weiboData: {
                blogger: post.blogger,
                bloggerType: post.bloggerType || '',
                content: post.content || '',
                images: [],
                forward: post.forward || 0,
                comments: post.commentList?.length || post.comments || 0,
                likes: post.likes || 0,
                commentList: post.commentList || [],
                likeList: post.likeList || [],
                time: post.time || '',
                device: post.device || ''
            }
        });

        // 🔥 时间统一：卡片内部时间与微信消息时间保持一致，避免“双时间”错位
        if (addResult) {
            const chatMessages = wechatData.getMessages(chatId) || [];
            const latest = chatMessages[chatMessages.length - 1];
            if (latest && latest.type === 'weibo_card' && latest.weiboData) {
                latest.weiboData.originalTime = originalWeiboTime;
                latest.weiboData.time = latest.time || latest.weiboData.time || '';
            }
        }

        // 🔥 更新未读数并同步桌面红点
        const chat = wechatData.getChat(chatId);
        if (chat) {
            chat.unread = (chat.unread || 0) + 1;
            
            // 实时点亮桌面上微信的红点（即使微信没开）
            if (window.VirtualPhone?.home?.apps) {
                const apps = window.VirtualPhone.home.apps;
                const wechatAppIcon = apps.find(a => a.id === 'wechat');
                if (wechatAppIcon) {
                    wechatAppIcon.badge = wechatData.getChatList().reduce((sum, c) => sum + c.unread, 0);
                    window.dispatchEvent(new CustomEvent('phone:updateGlobalBadge'));
                    this.storage.saveApps(apps);
                }
            }
        }

        wechatData.saveData();
        return {
            success: true,
            chatId,
            chatName: friendName,
            hasForwardText: !!forwardText
        };
    }

    // 构建微博完整文本（用于微信消息的 content 字段）
    _buildWeiboFullText(post) {
        let text = `[微博分享] ${post.blogger || ''}`;
        if (post.bloggerType) text += `（${post.bloggerType}）`;
        text += `\n${post.content || ''}`;

        const comments = post.commentList || [];
        if (comments.length > 0) {
            text += `\n---评论---`;
            comments.forEach(c => {
                let line = `\n${c.name || ''}`;
                if (c.replyTo) line += `回复${c.replyTo}`;
                line += `：${c.text || ''}`;
                text += line;
            });
        }
        return text;
    }

    // 获取微信好友列表（异步静默加载）
    async getWechatContactsAsync() {
        let wechatData = window.VirtualPhone?.wechatApp?.wechatData || window.VirtualPhone?.cachedWechatData;
        if (!wechatData) {
            try {
                const module = await import('../wechat/wechat-data.js');
                wechatData = new module.WechatData(this.storage);
                if (window.VirtualPhone) window.VirtualPhone.cachedWechatData = wechatData;
            } catch (e) {
                console.error('加载微信数据库失败:', e);
                return [];
            }
        }
        return wechatData.getContacts() || [];
    }

    // ========================================
    // 🔄 热搜变化检测
    // ========================================

    checkHotSearchChanged(newSearches) {
        const oldSearches = this.getHotSearches();
        if (oldSearches.length === 0) return true;

        // 比较标题列表
        const oldTitles = oldSearches.map(s => s.title).sort().join('|');
        const newTitles = newSearches.map(s => s.title).sort().join('|');

        return oldTitles !== newTitles;
    }

    // 清理过期的热搜详情缓存
    cleanupOldHotSearchDetails(currentSearches) {
        const currentTitles = new Set(currentSearches.map(s => s.title));
        const oldSearches = this.getHotSearches();

        oldSearches.forEach(s => {
            if (!currentTitles.has(s.title)) {
                this.clearHotSearchDetail(s.title);
            }
        });
    }

    // ========================================
    // 🗑️ 缓存管理
    // ========================================

    clearCache() {
        this._recommendCache = null;
        this._hotSearchCache = null;
        this.stopBatch = false;
    }

    clearAllData() {
        this.clearCache();
        // 仅清理会话数据；美化项(头像/背景/头像框)保留为全局配置
        this.storage.remove(this._profileKey);
        this.storage.remove('weibo_recommend_posts');
        this.storage.remove('weibo_hot_searches');
        this.storage.remove('weibo_floor_settings');
        this.storage.remove('weibo_auto_last_floor');
    }

    // ========================================
    // 🧹 清理聊天记录中的微博标签 (防止文件臃肿)
    // ========================================
    async clearWeiboChatHistory() {
        const context = this._getContext();
        if (!context || !context.chat) return;

        let modified = false;
        // 匹配完整的 <Weibo>...</Weibo> 标签块
        const regex = /<Weibo>[\s\S]*?<\/Weibo>/gi;

        context.chat.forEach(msg => {
            if (msg.is_user) return; // 微博通常是AI发的，跳过用户消息
            
            // 清理当前显示的消息
            if (msg.mes && regex.test(msg.mes)) {
                msg.mes = msg.mes.replace(regex, '').trim();
                modified = true;
            }
            
            // 清理隐藏的滑动分支 (swipes)
            if (msg.swipes) {
                msg.swipes.forEach((swipe, idx) => {
                    if (swipe && regex.test(swipe)) {
                        msg.swipes[idx] = swipe.replace(regex, '').trim();
                        modified = true;
                    }
                });
            }
        });

        // 如果发生了修改，强制保存酒馆聊天记录
        if (modified) {
            if (typeof context.saveChatDebounced === 'function') {
                context.saveChatDebounced();
            } else if (typeof context.saveChat === 'function') {
                await context.saveChat();
            }
            console.log('[WeiboData] 已从酒馆源文件中擦除所有微博标签，文件已瘦身！');
        }
    }

    // ========================================
    // 🏗️ 自动楼层追踪器（类似日记）
    // ========================================

    getAutoLastFloor() {
        const saved = this.storage.get('weibo_auto_last_floor', 0);
        return parseInt(saved) || 0;
    }

    setAutoLastFloor(floorIndex) {
        this.storage.set('weibo_auto_last_floor', floorIndex);
    }

    // ========================================
    // 🔄 分批生成微博（类似日记的 batchGenerateDiary）
    // ========================================

    async batchGenerateWeibo(startIndex, endIndex, batchSize = 50, onProgress = null, isAuto = false) {
        const totalFloors = endIndex - startIndex;
        const batchCount = Math.ceil(totalFloors / batchSize);
        this.stopBatch = false;

        // 全局状态
        if (window.VirtualPhone) {
            window.VirtualPhone.isWeiboBatchRunning = true;
            window.VirtualPhone.weiboBatchProgress = { current: 0, total: batchCount };
        }

        try {
            if (totalFloors <= batchSize) {
                // 单批次
                if (onProgress) onProgress(0, 1, '生成中...');
                await this.generateRecommend();
                if (isAuto) this.setAutoLastFloor(endIndex);
                if (window.VirtualPhone?.weiboBatchProgress) window.VirtualPhone.weiboBatchProgress.current = 1;
                if (onProgress) onProgress(1, 1, '完成');
            } else {
                // 多批次，带冷却
                for (let i = 0; i < batchCount; i++) {
                    if (this.stopBatch) {
                        if (onProgress) onProgress(i, batchCount, '已停止');
                        break;
                    }

                    // 批次间冷却 5 秒（防 429）
                    if (i > 0) {
                        for (let d = 5; d > 0; d--) {
                            if (this.stopBatch) break;
                            if (onProgress) onProgress(i, batchCount, `冷却 ${d}s...`);
                            await new Promise(r => setTimeout(r, 1000));
                        }
                        if (this.stopBatch) break;
                    }

                    const bEnd = Math.min(startIndex + (i + 1) * batchSize, endIndex);

                    if (onProgress) onProgress(i, batchCount, `生成 ${i + 1}/${batchCount}...`);

                    try {
                        await this.generateRecommend();
                        if (isAuto) this.setAutoLastFloor(bEnd);
                    } catch (err) {
                        console.error(`[WeiboData] 批次 ${i + 1} 失败:`, err);
                        if (onProgress) onProgress(i, batchCount, `批次 ${i + 1} 失败: ${err.message}`);
                    }

                    if (window.VirtualPhone?.weiboBatchProgress) {
                        window.VirtualPhone.weiboBatchProgress.current = i + 1;
                    }
                }
                if (!this.stopBatch && onProgress) onProgress(batchCount, batchCount, '全部完成');
            }
        } finally {
            if (window.VirtualPhone) {
                window.VirtualPhone.isWeiboBatchRunning = false;
                delete window.VirtualPhone.weiboBatchProgress;
            }
        }
    }

    // ========================================
    // 🤖 自动生成微博（由 onMessageReceived 触发）
    // ========================================

    async autoGenerateWeibo() {
        const context = this._getContext();
        if (!context || !context.chat) {
            return { skipped: true, reason: 'no_context' };
        }

        const chatLength = Array.isArray(context.chat) ? context.chat.length : 0;
        if (chatLength <= 0) {
            return { skipped: true, reason: 'empty_chat' };
        }

        const floorSettings = this.getFloorSettings();
        const minTriggerDelta = Math.max(1, parseInt(floorSettings.autoInterval, 10) || 20);

        const latestFloor = Math.max(0, chatLength - 1);
        const rawLastIndex = parseInt(this.getAutoLastFloor(), 10);
        let safeLastIndex = Number.isFinite(rawLastIndex) ? rawLastIndex : 0;
        safeLastIndex = Math.max(0, Math.min(safeLastIndex, latestFloor));

        // 兜底修正：历史脏值会导致永远无法触发
        if (safeLastIndex !== rawLastIndex) {
            this.setAutoLastFloor(safeLastIndex);
        }

        if ((latestFloor - safeLastIndex) < minTriggerDelta) {
            return { skipped: true, reason: 'not_due' };
        }

        const endIndex = chatLength;
        // 自动模式只取最近一段窗口，避免把历史 0-N 全量塞给 AI
        const startIndex = Math.max(safeLastIndex + 1, endIndex - minTriggerDelta);

        try {
            const parsed = await this.generateRecommend(null, {
                chatStartIndex: startIndex,
                chatEndIndex: endIndex,
                forceChatLimit: minTriggerDelta
            });
            this.setAutoLastFloor(endIndex);

            const newPostCount = Array.isArray(parsed?.posts) ? parsed.posts.length : 0;
            if (newPostCount > 0) {
                try {
                    const apps = window.VirtualPhone?.home?.apps;
                    if (Array.isArray(apps)) {
                        const weiboAppIcon = apps.find(a => a.id === 'weibo');
                        if (weiboAppIcon) {
                            weiboAppIcon.badge = (weiboAppIcon.badge || 0) + newPostCount;
                            if (typeof this.storage?.saveApps === 'function') {
                                this.storage.saveApps(apps);
                            }
                            window.dispatchEvent(new CustomEvent('phone:updateGlobalBadge'));
                        }
                    }
                } catch (e) {
                    console.warn('[WeiboData] 同步微博红点失败:', e);
                }
            }

            // 触发全局弹窗通知（自动更新可见提示）
            if (window.VirtualPhone && window.VirtualPhone.notify) {
                const posts = this.getRecommendPosts();
                const roughCount = Math.min(5, Array.isArray(posts) ? posts.length : 0);
                const notifyCount = newPostCount > 0 ? newPostCount : roughCount;
                if (notifyCount > 0) {
                    window.VirtualPhone.notify('微博', `自动刷新了 ${notifyCount} 条新动态`, '', {
                        avatarText: '微',
                        avatarBg: '#ff8200',
                        avatarColor: '#fff',
                        name: '微博',
                        content: `自动刷新了 ${notifyCount} 条新动态`,
                        timeText: '刚刚',
                        senderKey: `weibo:auto:${Date.now()}`
                    });
                }
            }

            console.log(`[WeiboData] 自动微博生成完成 (${startIndex}-${endIndex})`);
            return { success: true, startIndex, endIndex, minTriggerDelta };
        } catch (e) {
            console.error('[WeiboData] 自动生成微博失败:', e);
            throw e;
        }
    }
}

