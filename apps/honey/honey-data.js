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
import { WechatData } from '../wechat/wechat-data.js';
import { GlobalSocialStore } from '../../config/global-social-store.js';
import { applyPhoneTagFilter } from '../../config/tag-filter.js';

export class HoneyData {
    constructor(storage) {
        this.storage = storage;
        this.customLiveVideosGlobalKey = 'global_honey_custom_live_videos';
        this.customLiveVideosLegacyKey = 'honey_custom_live_videos';
        this.explicitGlobalHoneyKeys = new Set([
            'global_honey_bg_video',
            'global_honey_custom_live_videos'
        ]);
        this.maxStoredTopicScenes = 36;
        this.maxStoredHostHistoryDays = 14;
        this.maxStoredPromptTurns = 100;
        this.maxStoredComments = 30;
        this.maxStoredGifts = 24;
        this._recommendCache = null;
        this._topicScenesCache = null;
        this._selectedTopicCache = null;
        this._lastSceneCache = null;
        this._flushTimer = null;
        this.globalSocialStore = new GlobalSocialStore(storage);
        this._scheduleLegacyGlobalHoneyMigration();
        this._clearLegacyGlobalFollowedHostLinks();
        this._bootstrapHoneyGlobalSocialData();
    }

    _getContext() {
        return (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
    }

    async _buildWorldInfoMessage() {
        return await window.VirtualPhone?.worldbookManager?.buildWorldbookMessage?.('honey');
    }

    _isWechatLinkedHoneyHost(hostName = '') {
        const safeHostName = this._stripFollowStateSuffix(hostName);
        const hostKey = this._normalizeHostNameKey(safeHostName);
        if (!hostKey) return false;

        const followedHost = this.getFollowedHostByName(safeHostName);
        if (String(followedHost?.sourceApp || '').trim().toLowerCase() === 'wechat') return true;
        if (followedHost?.wechatContactId || followedHost?.wechatChatId) return true;

        const wechatData = this._getWechatDataBridge();
        const contact = wechatData.getContactByName?.(safeHostName)
            || (wechatData.getContacts?.() || []).find(item => this._normalizeHostNameKey(item?.name || '') === hostKey);
        if (!contact) return false;
        const chat = contact?.id ? wechatData.getChatByContactId?.(contact.id) : null;
        if (chat?.honeyInviteState?.decision === 'accepted') return true;
        if (typeof wechatData.isHoneyHistoryInjectionEnabledForChat === 'function' && chat?.id) {
            return wechatData.isHoneyHistoryInjectionEnabledForChat(chat.id);
        }
        return false;
    }

    _buildWechatLinkedCharacterContext(hostName = '') {
        if (!this._isWechatLinkedHoneyHost(hostName)) return '';
        const context = this._getContext();
        if (!context) return '';

        const safeHostName = this._sanitizeInlineText(hostName || '', 40) || '微信好友';
        const userName = this._sanitizeInlineText(context.name1 || '用户', 24) || '用户';
        const char = (context.characterId !== undefined && context.characters?.[context.characterId])
            ? context.characters[context.characterId]
            : null;
        const charName = this._sanitizeInlineText(char?.name || context.name2 || safeHostName, 40) || safeHostName;
        const sections = [
            `【微信好友蜜语角色上下文：${safeHostName}】`,
            '该蜜语主播也是用户的微信好友。以下设定只用于这个微信好友对应的直播间，普通蜜语主播不得套用。'
        ];
        const charLines = [`角色卡主体：${charName}`, `当前蜜语主播：${safeHostName}`];
        if (char?.description) charLines.push(`描述：${String(char.description).trim().slice(0, 1200)}`);
        if (char?.personality) charLines.push(`性格：${String(char.personality).trim().slice(0, 800)}`);
        if (char?.scenario || context.scenario) charLines.push(`场景/背景：${String(char?.scenario || context.scenario).trim().slice(0, 800)}`);
        if (char?.data?.system_prompt) charLines.push(`角色系统提示词：${String(char.data.system_prompt).trim().slice(0, 1000)}`);
        sections.push(charLines.join('\n'));

        const personaText = String(document.getElementById('persona_description')?.value || '').trim();
        sections.push(`【用户信息】\n姓名：${userName}${personaText ? `\n${personaText.slice(0, 1200)}` : '\n暂无用户信息'}`);

        const entries = Array.isArray(char?.data?.character_book?.entries) ? char.data.character_book.entries : [];
        const characterBookLines = entries
            .filter(entry => entry?.content && entry.enabled !== false)
            .slice(0, 30)
            .map((entry, idx) => {
                const title = this._sanitizeInlineText(entry.comment || (Array.isArray(entry.keys) ? entry.keys.join('、') : entry.keys) || `条目${idx + 1}`, 80);
                return `【${title}】\n${String(entry.content || '').trim().slice(0, 1200)}`;
            })
            .filter(Boolean);
        if (characterBookLines.length > 0) {
            sections.push(`【角色卡内置世界书/角色书】\n${characterBookLines.join('\n---\n')}`);
        }

        return sections.join('\n\n');
    }

    _getHoneyOverridePrompt(promptManager) {
        let text = '';
        try {
            text = promptManager?.getPromptForFeature?.('honey', 'override') || '';
        } catch (e) {
            console.warn('[Honey] 获取蜜语破限词失败:', e);
        }
        return String(text || '').trim();
    }

    _formatPersonalImageTagRows(rows = []) {
        const normalized = (Array.isArray(rows) ? rows : [])
            .map((item) => {
                const name = this._sanitizeInlineText(item?.name || '', 40);
                const tags = String(item?.tags || '')
                    .split(/[,，\n]+/)
                    .map(tag => tag.trim())
                    .filter(Boolean)
                    .join(', ');
                return name && tags ? `${name}：${tags}` : '';
            })
            .filter(Boolean);
        return normalized.length > 0 ? normalized.join('\n') : '暂无';
    }

    _resolveWechatContactForHoneyHost(hostName = '') {
        const safeHostName = this._stripFollowStateSuffix(hostName || '');
        if (!safeHostName) return null;
        try {
            const wechatData = this._getWechatDataBridge?.();
            const contacts = wechatData?.getContacts?.() || [];
            if (!Array.isArray(contacts) || contacts.length === 0) return null;
            return wechatData.getContactByName?.(safeHostName)
                || contacts.find(item => this._normalizeHostNameKey(item?.name || '') === this._normalizeHostNameKey(safeHostName))
                || contacts.find(item => this._normalizeHostNameKey(this._resolveHoneyHostNameFromWechatContact(item)) === this._normalizeHostNameKey(safeHostName))
                || null;
        } catch (e) {
            return null;
        }
    }

    _buildHoneyPersonalImageTagInfo(hostName = '') {
        const rows = [];
        const safeHostName = this._stripFollowStateSuffix(hostName || '');
        const contact = this._resolveWechatContactForHoneyHost(safeHostName);
        if (contact) {
            rows.push({
                name: contact.name || safeHostName,
                tags: contact.naiPromptTags || contact.imageTags
            });
        }
        const followedHost = this.getFollowedHostByName?.(safeHostName);
        if (followedHost) {
            rows.push({
                name: followedHost.name || safeHostName,
                tags: followedHost.naiPromptTags || followedHost.imageTags || followedHost.naiTags
            });
        }
        return this._formatPersonalImageTagRows(rows);
    }

    _sanitizeInlineText(value, maxLen = 260) {
        return String(value || '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, maxLen);
    }

    _sanitizePromptLine(value = '') {
        return String(value || '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    _sanitizePromptBlockLine(value = '') {
        return String(value || '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\r/g, '')
            .trim();
    }

    _buildPreviousRecommendAvoidanceContext(previousTopics) {
        if (!Array.isArray(previousTopics) || previousTopics.length === 0) return '';
        const lines = previousTopics
            .filter(item => item && typeof item === 'object')
            .slice(0, 12)
            .map((item, idx) => {
                const title = this._sanitizeInlineText(item.title || '', 60);
                const host = this._sanitizeInlineText(item.host || item.name || '', 40);
                const category = this._sanitizeInlineText(item.category || item.recommendCategory || '', 40);
                const introSource = item.intro || item.description || '';
                const intro = this._isMeaningfulDescription(introSource)
                    ? this._sanitizeInlineText(introSource, 120)
                    : '';
                const parts = [];
                if (title) parts.push(`标题：${title}`);
                if (host) parts.push(`主播：${host}`);
                if (category) parts.push(`分类：${category}`);
                if (intro) parts.push(`简介：${intro}`);
                return parts.length ? `${idx + 1}. ${parts.join('；')}` : '';
            })
            .filter(Boolean);
        if (lines.length === 0) return '';

        return [
            '【上一轮推荐页内容，必须避开重复】',
            ...lines,
            '请生成全新一轮推荐页：不要复用以上主播昵称、直播标题、核心题材、场景卖点或相近同义包装；今日推荐和其他推荐都要明显换一批。'
        ].join('\n');
    }

    _extractNaiPrompt(source) {
        const text = String(source || '').replace(/\r/g, '').trim();
        if (!text) return '';

        const candidates = [];
        const push = (value) => {
            let cleaned = String(value || '')
                .replace(/^\s*[\[【（(]+/, '')
                .replace(/[\]】）)]+\s*$/, '')
                .replace(/^\s*(?:NAI|NovelAI)\s*(?:英文\s*)?(?:tag\s*)?(?:提示词|prompt)?\s*[:：]?\s*/i, '')
                .replace(/^\s*[\[【]?\s*画面\s*[\]】]?\s*[:：]\s*/i, '')
                .trim();
            cleaned = cleaned
                .replace(/\s*(?:供前端调用|其他推荐内容|好友申请|联播|榜单|打赏记录|直播剧情描写|评论区)[\s\S]*$/i, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (!cleaned || /^(?:无|暂无|等待|生成中|N\/A|null|undefined)$/i.test(cleaned)) return;
            candidates.push(cleaned.slice(0, 1200));
        };

        const screenPromptPattern = /(?:^|\n)\s*[\[【]?\s*画面\s*[\]】]?\s*[:：]\s*/i;
        const screenPromptMatch = text.match(screenPromptPattern);
        if (screenPromptMatch && typeof screenPromptMatch.index === 'number') {
            const rest = text.slice(screenPromptMatch.index + screenPromptMatch[0].length);
            const endPattern = /(?:^|\n)\s*(?:\[\s*评论区\s*\]|评论区|好友申请|互动记录|榜单|打赏记录|直播剧情描写|剧情面板|直播实况|---\s*热门推荐\s*---|---\s*当前\s*激情直播\s*---)\s*[：:]?/i;
            const endMatch = rest.match(endPattern);
            const section = rest.slice(0, endMatch && typeof endMatch.index === 'number' ? endMatch.index : rest.length);
            push(section);
        }

        [
            /(?:^|\n)\s*[\[【]?\s*画面\s*[\]】]?\s*[:：]\s*[\[【]\s*(?:NAI|NovelAI)\s*(?:英文\s*)?(?:tag\s*)?(?:提示词|prompt)?\s*[\]】]\s*([^\n]+)/ig,
            /\[\s*(?:NAI|NovelAI)\s*(?:英文\s*)?(?:tag\s*)?(?:提示词|prompt)\s*[:：]\s*([^\]\n]+)/ig,
            /(?:NAI|NovelAI)\s*(?:英文\s*)?(?:tag\s*)?(?:提示词|prompt)\s*[:：]\s*([^\]\n]+)/ig,
            /(?:^|\n)\s*[\[【]?\s*画面\s*[\]】]?\s*[:：]\s*\[\s*(?:NAI|NovelAI)\s*(?:英文\s*)?(?:tag\s*)?(?:提示词|prompt)?\s*[:：]?\s*([^\]\n]+)/ig,
            /(?:^|\n)\s*[\[【]?\s*画面\s*[\]】]?\s*[:：]\s*([^\n]+)/ig
        ].forEach((pattern) => {
            for (const match of text.matchAll(pattern)) {
                push(match?.[1] || '');
            }
        });

        return candidates[0] || '';
    }

    _normalizeHostNameKey(name) {
        return String(name || '')
            .replace(/\s+/g, '')
            .trim()
            .toLowerCase();
    }

    _normalizeWechatContactNameKey(name) {
        return String(name || '')
            .trim()
            .replace(/\s+/g, '')
            .toLowerCase();
    }

    _isExplicitGlobalHoneyKey(key) {
        return this.explicitGlobalHoneyKeys.has(String(key || '').trim());
    }

    _resolveHoneyStorageKey(key) {
        const safeKey = String(key || '').trim();
        if (!safeKey) return '';
        if (this._isExplicitGlobalHoneyKey(safeKey)) return safeKey;
        if (/^global_honey_/i.test(safeKey)) return safeKey.replace(/^global_/i, '');
        return safeKey;
    }

    _resolveLegacyHoneyStorageKey(key, primaryKey = '') {
        const safeKey = String(key || '').trim();
        const primary = String(primaryKey || '').trim();
        if (!safeKey || this._isExplicitGlobalHoneyKey(safeKey)) return '';
        if (/^global_honey_/i.test(safeKey) && primary && primary !== safeKey) return safeKey;
        if (/^honey_/i.test(primary)) return `global_${primary}`;
        if (/^honey_/i.test(safeKey)) return `global_${safeKey}`;
        return '';
    }

    _getStored(key, fallback = null) {
        const safeKey = String(key || '').trim();
        if (!safeKey) return fallback;
        const primaryKey = this._resolveHoneyStorageKey(safeKey);
        const legacyKey = this._resolveLegacyHoneyStorageKey(safeKey, primaryKey);

        let value = this.storage?.get?.(primaryKey);
        if ((value === null || value === undefined || value === '') && legacyKey && legacyKey !== primaryKey) {
            value = this.storage?.get?.(legacyKey);
            if (value !== null && value !== undefined && value !== '') {
                value = this._compactSerializedHoneyValue(primaryKey, value);
                this.storage?.set?.(primaryKey, value);
                this.storage?.remove?.(legacyKey);
                this._scheduleFlushChatPersistence(1200);
            }
        }
        if (value === null || value === undefined || value === '') return fallback;
        return value;
    }

    _setStored(key, value) {
        const safeKey = String(key || '').trim();
        if (!safeKey) return;
        const primaryKey = this._resolveHoneyStorageKey(safeKey);
        this.storage?.set?.(primaryKey, value);
        const legacyKey = this._resolveLegacyHoneyStorageKey(safeKey, primaryKey);
        if (legacyKey && legacyKey !== primaryKey) {
            this.storage?.remove?.(legacyKey);
        }
    }

    _getStoredRaw(key, fallback = null) {
        const safeKey = String(key || '').trim();
        if (!safeKey) return fallback;
        const value = this.storage?.get?.(safeKey);
        if (value === null || value === undefined || value === '') return fallback;
        return value;
    }

    _removeStoredRaw(key) {
        const safeKey = String(key || '').trim();
        if (!safeKey) return;
        this.storage?.remove?.(safeKey);
    }

    _removeStored(key, alsoLegacy = true) {
        const safeKey = String(key || '').trim();
        if (!safeKey) return;
        const primaryKey = this._resolveHoneyStorageKey(safeKey);
        this.storage?.remove?.(primaryKey);
        const legacyKey = this._resolveLegacyHoneyStorageKey(safeKey, primaryKey);
        if (alsoLegacy && legacyKey && legacyKey !== primaryKey) {
            this.storage?.remove?.(legacyKey);
        }
    }

    _scheduleLegacyGlobalHoneyMigration() {
        if (!this.storage || typeof this.storage.getExtensionSettings !== 'function') return;
        setTimeout(() => this._migrateLegacyGlobalHoneyDataToChatStore(), 800);
    }

    _migrateLegacyGlobalHoneyDataToChatStore() {
        try {
            const extStore = this.storage?.getExtensionSettings?.();
            if (!extStore || typeof extStore !== 'object') return;
            const keys = Object.keys(extStore)
                .filter(key => /^global_honey_/i.test(key))
                .filter(key => !this._isExplicitGlobalHoneyKey(key));
            if (!keys.length) return;

            keys.forEach((legacyKey) => {
                const primaryKey = this._resolveHoneyStorageKey(legacyKey);
                if (!primaryKey || primaryKey === legacyKey) return;
                this.storage?.set?.(primaryKey, this._compactSerializedHoneyValue(primaryKey, extStore[legacyKey]));
                this.storage?.remove?.(legacyKey);
            });
            this._scheduleFlushChatPersistence(1200);
            console.log(`[HoneyData] 已迁移 ${keys.length} 个旧版 global_honey 数据到聊天存储，避免 settings.json 膨胀`);
        } catch (e) {
            console.warn('[HoneyData] 迁移旧版蜜语全局数据失败:', e);
        }
    }

    _compactSerializedHoneyValue(key, value) {
        const safeKey = String(key || '').trim();
        if (!safeKey || value === null || value === undefined || value === '') return value;
        try {
            const parsed = typeof value === 'string' ? JSON.parse(value) : value;
            if (/^honey_topic_scenes$/i.test(safeKey)) {
                return JSON.stringify(this._compactTopicScenes(parsed));
            }
            if (/^honey_last_scene$/i.test(safeKey)) {
                return JSON.stringify(this._compactStoredScene(parsed, { full: true }));
            }
            if (/^honey_history_/i.test(safeKey)) {
                return JSON.stringify(this._compactHostHistory(parsed));
            }
            if (/^honey_recommend_topics$/i.test(safeKey) && Array.isArray(parsed)) {
                return JSON.stringify(parsed.slice(-24).map(item => this._compactStoredScene(item, { full: false })));
            }
        } catch (e) {
            return value;
        }
        return value;
    }

    _getHoneyGlobalContactId(personLike) {
        const key = this._normalizeHostNameKey(personLike?.name || personLike?.nickname || '');
        if (!key) return '';
        return `honey_friend_${key}`;
    }

    _getHoneyDeletedWechatContactKey(name = '') {
        const key = this._normalizeHostNameKey(name || '');
        return key ? `honey_deleted_wechat_contact_${key}` : '';
    }

    _getHoneyDeletedWechatContact(name = '') {
        const key = this._getHoneyDeletedWechatContactKey(name);
        if (!key) return null;
        const parsed = this._readJSON(key, null);
        return (parsed && typeof parsed === 'object') ? parsed : null;
    }

    _markHoneyDeletedWechatContact(name = '', meta = {}) {
        const safeName = this._sanitizeInlineText(name || '', 40);
        const key = this._getHoneyDeletedWechatContactKey(safeName);
        if (!key) return false;
        this._setStored(key, JSON.stringify({
            name: safeName,
            contactId: String(meta?.contactId || '').trim(),
            sourceApp: String(meta?.sourceApp || '').trim(),
            sourceLabel: String(meta?.sourceLabel || '').trim(),
            deletedAt: Date.now()
        }));
        return true;
    }

    _clearHoneyDeletedWechatContact(name = '') {
        const key = this._getHoneyDeletedWechatContactKey(name);
        if (!key) return false;
        this._removeStored(key);
        return true;
    }

    _isHoneyWechatContactDeleted(name = '') {
        return !!this._getHoneyDeletedWechatContact(name);
    }

    _inferHoneyHostSocialPerson(item = {}, fallbackSource = '') {
        const requestType = String(item?.requestType || item?.sourceType || item?.type || '').trim();
        const sourceLabel = String(item?.sourceLabel || item?.label || '').trim();
        const source = String(item?.source || '').trim();
        const relation = String(item?.relation || '').trim();
        const hidden = String(
            item?.hiddenBackground
            || item?.honeyHiddenBackground
            || item?.extra?.honeyHiddenBackground
            || ''
        ).trim();
        const scope = String(item?.honeyScope || item?.extra?.honeyScope || '').trim();
        return /host|broadcaster|anchor|streamer|主播|其他直播间|微信邀约/i.test(
            `${requestType} ${sourceLabel} ${source} ${relation} ${hidden} ${scope} ${fallbackSource || ''}`
        );
    }

    _resolveHoneyHostNameFromWechatContact(contact = {}, fallbackName = '') {
        const direct = this._sanitizeInlineText(contact?.honeyHostName || contact?.extra?.honeyHostName || '', 40);
        if (direct) return direct;
        const source = this._sanitizeInlineText(contact?.honeySource || contact?.extra?.honeySource || '', 40);
        if (source && !/^(?:关注主播|直播间|好友|蜜语|主播)$/i.test(source)) return source;
        return this._sanitizeInlineText(fallbackName || contact?.name || '', 40);
    }

    _resolveFollowedHostNameFromScene(scene = {}, fallbackHostName = '') {
        const candidates = [
            fallbackHostName,
            scene?.host,
            scene?.hostName,
            scene?.nickname,
            scene?.anchorName,
            scene?.name
        ];
        for (const candidate of candidates) {
            const value = this._sanitizeInlineText(this._stripFollowStateSuffix(candidate || ''), 40);
            if (value && !/^(?:直播间|当前直播|蜜语|主播|神秘主播)$/i.test(value)) return value;
        }
        return this._sanitizeInlineText(this._stripFollowStateSuffix(fallbackHostName || scene?.host || scene?.name || ''), 40);
    }

    _bootstrapHoneyGlobalSocialData() {
        try {
            const localFriends = this._readJSON('honey_my_friends', []);
            const localRequests = this._readJSON('honey_my_friend_requests', []);
            if (Array.isArray(localFriends) && localFriends.length > 0) {
                this._syncHoneyPeopleToGlobalStore(localFriends, 'friend');
            }
            if (Array.isArray(localRequests) && localRequests.length > 0) {
                this._syncHoneyPeopleToGlobalStore(localRequests, 'request');
            }
        } catch (e) {
            console.warn('⚠️ [蜜语] 本地好友迁移到全局主库失败:', e);
        }
    }

    _clearLegacyGlobalFollowedHostLinks() {
        try {
            let removed = 0;
            removed += this.globalSocialStore?.removeAppContactsByPredicate?.('honey', (entry) => {
                const scope = String(entry?.extra?.honeyScope || '').trim().toLowerCase();
                return scope === 'followed_host';
            }) || 0;
            removed += this.globalSocialStore?.removeAppContactsByPredicate?.('wechat', (entry) => {
                return this._inferHoneyHostSocialPerson(entry, 'wechat');
            }) || 0;
            if (removed > 0) {
                console.log(`[HoneyData] 已清理 ${removed} 条旧版蜜语关注主播全局联动记录，改为按会话存储`);
            }
        } catch (e) {
            console.warn('⚠️ [蜜语] 清理旧版全局关注主播联动失败:', e);
        }
    }

    _syncHoneyPeopleToGlobalStore(list = [], scope = 'friend') {
        const safeList = Array.isArray(list) ? list : [];
        const targetScope = scope === 'friend' ? 'friend' : 'request';
        const keepIds = new Set();

        safeList.forEach((item) => {
            const person = this._normalizeHoneySocialPerson(item, scope === 'friend' ? '好友' : '直播间');
            if (!person?.name) return;
            const appContactId = this._getHoneyGlobalContactId(person);
            if (!appContactId) return;
            const isHostPerson = this._inferHoneyHostSocialPerson(person, scope === 'friend' ? '好友' : '直播间');
            const relation = scope === 'friend'
                ? (isHostPerson ? '蜜语主播' : '蜜语好友')
                : (isHostPerson ? '蜜语主播候选' : '蜜语候选好友');
            const sourceLabel = isHostPerson
                ? '主播'
                : (person.sourceLabel || '蜜语');
            keepIds.add(appContactId);
            this.globalSocialStore?.upsertContact?.({
                app: 'honey',
                appContactId,
                name: person.name,
                avatar: person.avatarUrl || '',
                relation,
                extra: {
                    sourceApp: person.sourceApp || 'honey',
                    sourceLabel,
                    honeySource: person.source || '',
                    honeyVisibleIntro: person.message || '',
                    honeyHiddenBackground: person.hiddenBackground || '',
                    acceptedAtPhoneTime: person.acceptedAtPhoneTime || '',
                    requestType: person.requestType || (isHostPerson ? 'host' : 'viewer'),
                    hostType: person.hostType || '',
                    honeyScope: scope
                }
            });
        });

        const globalList = this.globalSocialStore?.getContactsByApp?.('honey') || [];
        globalList.forEach((entry) => {
            const relationText = String(entry?.relation || '').trim();
            const inferredScope = relationText.includes('候选') ? 'request' : 'friend';
            const scopeTag = String(entry?.extra?.honeyScope || inferredScope).trim().toLowerCase();
            if (scopeTag !== targetScope) return;
            const appContactId = String(entry?.appContactId || '').trim();
            if (appContactId && !keepIds.has(appContactId)) {
                this.globalSocialStore?.removeAppContact?.('honey', appContactId);
            }
        });
    }

    _mergeHoneyPeopleFromGlobalStore(localList = [], scope = 'friend') {
        const locals = (Array.isArray(localList) ? localList : [])
            .map(item => this._normalizeHoneySocialPerson(item, scope === 'friend' ? '好友' : '直播间'))
            .filter(Boolean);

        const merged = new Map();
        locals.forEach((item) => {
            const key = this._normalizeHostNameKey(item?.name || '');
            if (!key) return;
            merged.set(key, item);
        });

        const globalList = this.globalSocialStore?.getContactsByApp?.('honey') || [];
        globalList.forEach((entry) => {
            const relationText = String(entry?.relation || '').trim();
            const inferredScope = relationText.includes('候选') ? 'request' : 'friend';
            const scopeTag = String(entry?.extra?.honeyScope || inferredScope).trim().toLowerCase();
            const targetScope = scope === 'friend' ? 'friend' : 'request';
            if (scopeTag && scopeTag !== targetScope) return;
            if (targetScope === 'friend' && this._isHoneyWechatContactDeleted(entry?.name || '')) return;
            const inferredHost = this._inferHoneyHostSocialPerson({
                relation: relationText,
                sourceLabel: entry?.extra?.sourceLabel || '',
                source: entry?.extra?.honeySource || '',
                requestType: entry?.extra?.requestType || '',
                hostType: entry?.extra?.hostType || '',
                hiddenBackground: entry?.extra?.honeyHiddenBackground || '',
                honeyScope: scopeTag
            }, scope === 'friend' ? '好友' : '直播间');

            const person = this._normalizeHoneySocialPerson({
                name: entry?.name,
                avatarUrl: entry?.avatar,
                message: entry?.extra?.honeyVisibleIntro || '',
                source: entry?.extra?.honeySource || entry?.extra?.sourceLabel || (scope === 'friend' ? '好友' : '直播间'),
                sourceApp: entry?.extra?.sourceApp || 'honey',
                sourceLabel: inferredHost ? '主播' : (entry?.extra?.sourceLabel || ''),
                requestType: entry?.extra?.requestType || (inferredHost ? 'host' : ''),
                hostType: entry?.extra?.hostType || '',
                acceptedAtPhoneTime: entry?.extra?.acceptedAtPhoneTime || '',
                hiddenBackground: entry?.extra?.honeyHiddenBackground || ''
            }, scope === 'friend' ? '好友' : '直播间');
            if (!person) return;

            const key = this._normalizeHostNameKey(person.name || '');
            if (!key) return;
            if (!merged.has(key)) {
                merged.set(key, person);
                return;
            }

            const current = merged.get(key);
            merged.set(key, this._normalizeHoneySocialPerson({
                ...current,
                avatarUrl: current.avatarUrl || person.avatarUrl,
                message: current.message || person.message,
                source: current.source || person.source,
                sourceApp: current.sourceApp || person.sourceApp,
                sourceLabel: current.sourceLabel || person.sourceLabel,
                requestType: current.requestType || person.requestType,
                hostType: current.hostType || person.hostType,
                acceptedAtPhoneTime: current.acceptedAtPhoneTime || person.acceptedAtPhoneTime,
                hiddenBackground: current.hiddenBackground || person.hiddenBackground
            }, scope === 'friend' ? '好友' : '直播间'));
        });

        return Array.from(merged.values()).filter(Boolean);
    }

    _stripFollowStateSuffix(name = '') {
        return String(name || '')
            .replace(/\s*[（(]\s*(?:已关注|未关注)\s*[)）]\s*$/g, '')
            .trim();
    }

    _isFollowedHostScene(scene = {}) {
        const hostName = this._stripFollowStateSuffix(scene?.host || scene?.name || '');
        const hostKey = this._normalizeHostNameKey(hostName);
        if (!hostKey) return false;
        return this.getFollowedHosts()
            .some(item => this._normalizeHostNameKey(this._stripFollowStateSuffix(item?.name || '')) === hostKey);
    }

    _clampFavorability(value, fallback = 0) {
        const num = Number.parseFloat(value);
        if (!Number.isFinite(num)) return fallback;
        const clamped = Math.max(0, Math.min(100, num));
        return Math.round(clamped * 10) / 10;
    }

    _clampReferenceValue(value, fallback = 0.7, min = 0, max = 1) {
        const num = Number.parseFloat(value);
        if (!Number.isFinite(num)) return fallback;
        const clamped = Math.max(min, Math.min(max, num));
        return Math.round(clamped * 100) / 100;
    }

    _normalizeNaiReferenceImage(value) {
        const raw = String(value || '').trim();
        if (!raw || raw === '[object Object]' || raw === 'undefined' || raw === 'null') return '';
        if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(raw)) return '';
        if (/^(?:https?:\/\/|\/backgrounds\/)/i.test(raw)) return raw;
        return '';
    }

    _normalizeHostNaiReference(item = {}) {
        const image = this._normalizeNaiReferenceImage(
            item.naiReferenceImage || item.referenceImage || item.characterReferenceImage
        );
        return {
            naiReferenceImage: image,
            naiReferenceEnabled: image
                ? (item.naiReferenceEnabled === undefined ? true : item.naiReferenceEnabled !== false && item.naiReferenceEnabled !== 'false')
                : false,
            naiReferenceStrength: this._clampReferenceValue(
                item.naiReferenceStrength ?? item.referenceStrength,
                0.7,
                0,
                1
            ),
            naiReferenceInformationExtracted: this._clampReferenceValue(
                item.naiReferenceInformationExtracted ?? item.referenceInformationExtracted,
                1,
                0,
                1
            )
        };
    }

    _normalizeContinuePromptTurns(turns, maxTurns = 100, options = {}) {
        const safeMax = Math.max(1, Number(maxTurns) || 100);
        const preserveLength = options?.preserveLength === true;
        return (Array.isArray(turns) ? turns : [])
            .map((turn) => {
                let assistantContext = this._normalizeLiveAssistantContextLabel(
                    String(turn?.assistantContext || turn?.assistant || ''),
                    { asHistory: true }
                )
                    .replace(/\r/g, '')
                    .trim();
                const responseContext = String(turn?.responseContext || turn?.aiResponseContext || turn?.resultContext || '')
                    .replace(/\r/g, '')
                    .trim();
                const rawUserMessage = preserveLength
                    ? String(turn?.userMessage || turn?.user || '')
                        .replace(/\r/g, '')
                        .split('\n')
                        .map(line => this._sanitizePromptLine(line))
                        .filter(Boolean)
                        .join('\n')
                    : this._sanitizeInlineText(turn?.userMessage || turn?.user || '', 220);
                const userMessage = this._formatLiveUserMessageForPrompt(rawUserMessage);
                if (!assistantContext && responseContext) {
                    assistantContext = this._normalizeLiveAssistantContextLabel(responseContext, { asHistory: true });
                }
                if (!assistantContext || (!userMessage && !responseContext)) return null;
                return responseContext ? { assistantContext, responseContext, userMessage } : { assistantContext, userMessage };
            })
            .filter(Boolean)
            .slice(-safeMax);
    }

    _normalizeLiveAssistantContextLabel(text = '', options = {}) {
        const source = String(text || '');
        if (!source) return '';
        const header = options?.asHistory === true
            ? '【直播历史】'
            : '【当前直播间状态（请在此基础上续写）】';

        return source.replace(
            /^【(?:当前直播间状态（请在此基础上续写）|直播历史)】/u,
            header
        );
    }

    _formatLiveUserMessageForPrompt(message, nickname = '') {
        const safeLines = String(message || '')
            .replace(/\r/g, '')
            .split('\n')
            .map(line => this._sanitizePromptLine(line))
            .filter(Boolean);
        if (safeLines.length <= 0) return '';

        const safeNickname = this._sanitizeInlineText(nickname || this.getHoneyUserNickname() || '你', 24) || '你';
        return safeLines.map((safeMessage) => {
            if (/^【系统强制提示[:：]/.test(safeMessage)) return safeMessage;
            if (/^[^：:\n]{1,24}\s*[：:]\s*\S/.test(safeMessage)) return safeMessage;
            return `${safeNickname}：${safeMessage}`;
        }).join('\n');
    }

    _normalizeHoneyCommentIdentityKey(value = '') {
        return this._normalizeHostNameKey(
            String(value || '')
                .replace(/^[#@＠]+/, '')
                .trim()
        );
    }

    _buildHoneyUserCommentAliasKeys(options = {}) {
        const aliases = new Set();
        const pushAlias = (value) => {
            const key = this._normalizeHoneyCommentIdentityKey(value);
            if (key) aliases.add(key);
        };

        const context = this._getContext();
        pushAlias(this.getHoneyUserNickname());
        pushAlias(context?.name1 || '');
        pushAlias('你');
        pushAlias('用户');
        pushAlias('user');
        pushAlias('{{user}}');

        if (options?.includeProfileNickname) {
            pushAlias(this.getHoneyUserProfile?.()?.nickname || '');
        }

        const extraNames = Array.isArray(options?.extraNames) ? options.extraNames : [];
        extraNames.forEach(pushAlias);
        return aliases;
    }

    _extractHoneyCommentSpeakerKey(line = '') {
        const normalizedLine = this._normalizeCommentLine(line);
        if (!normalizedLine) return '';
        const match = normalizedLine.match(/^(?:\[[^\]]+\])?\s*([^:：\s]{1,24})\s*[:：]\s*(.+)$/);
        if (!match?.[1]) return '';
        return this._normalizeHoneyCommentIdentityKey(match[1]);
    }

    _filterOutUserSpokenHoneyComments(list = [], options = {}) {
        const aliasKeys = this._buildHoneyUserCommentAliasKeys(options);
        const dropped = [];
        const kept = [];

        (Array.isArray(list) ? list : []).forEach((item) => {
            const normalizedLine = this._normalizeCommentLine(item);
            if (!normalizedLine) return;

            if (this._isHoneyCommentStatusLine(normalizedLine)) {
                dropped.push(normalizedLine);
                return;
            }

            const speakerKey = this._extractHoneyCommentSpeakerKey(normalizedLine);
            if (speakerKey && aliasKeys.has(speakerKey)) {
                dropped.push(normalizedLine);
                return;
            }

            kept.push(normalizedLine);
        });

        if (dropped.length > 0) {
            console.warn('⚠️ [蜜语] 已清理评论区中代替用户发言的内容:', dropped);
        }

        return kept;
    }

    _isHoneyCommentStatusLine(line = '') {
        const text = String(line || '').trim();
        if (!text) return true;
        if (/^(?:当前)?好感(?:度|值)\s*[:：]/.test(text)) return true;
        if (/^(?:热评|置顶|房管|官方|榜[一二三四五六七八九十0-9]+)?\s*(?:当前)?好感(?:度|值)\s*[:：]/.test(text)) return true;
        if (/^(?:系统公告|系统消息)\s*[:：]\s*(?:当前)?好感(?:度|值)/.test(text)) return true;
        return false;
    }

    _buildLiveRuntimeContext(options = {}) {
        const currentScene = (options?.currentScene && typeof options.currentScene === 'object') ? options.currentScene : null;
        const externalComments = Array.isArray(options?.currentComments) ? options.currentComments : null;
        const previousDescription = String(options?.previousDescription || '').trim();
        const isPrivateLive = String(options?.visibility || currentScene?.visibility || '').trim() === 'private'
            || options?.isPrivateLive === true
            || currentScene?.isPrivateLive === true;

        if (!currentScene && !externalComments?.length && !previousDescription) return '';

        const host = this._sanitizeInlineText(this._stripFollowStateSuffix(currentScene?.host || ''), 40);
        const title = this._sanitizeInlineText(currentScene?.title || '', 60);
        const viewers = this._sanitizeInlineText(currentScene?.viewers || '', 20);
        const fans = this._sanitizeInlineText(currentScene?.fans || '', 20);
        const collab = this._sanitizeInlineText(currentScene?.collab || '', 24);
        const intro = this._sanitizeInlineText(currentScene?.intro || '', 240);
        const liveTag = this._sanitizeInlineText(
            currentScene?.tag || currentScene?.category || currentScene?.recommendCategory || currentScene?.heat || '',
            40
        );
        const favorability = this._clampFavorability(currentScene?.favorability, null);
        const leaderboard = (Array.isArray(currentScene?.leaderboard) ? currentScene.leaderboard : [])
            .map((item, idx) => {
                const rank = Number(item?.rank) || (idx + 1);
                const name = this._sanitizeInlineText(item?.name || '', 24);
                const coins = this._sanitizeInlineText(item?.coins || '', 20);
                if (!name) return null;
                return { rank, name, coins };
            })
            .filter(Boolean)
            .sort((a, b) => a.rank - b.rank)
            .slice(0, 3);
        const userGiftRank = (currentScene?.userGiftRank && typeof currentScene.userGiftRank === 'object')
            ? {
                rank: Math.max(1, Number.parseInt(String(currentScene.userGiftRank.rank || 0), 10) || 1),
                name: this._sanitizeInlineText(currentScene.userGiftRank.name || this.getHoneyUserNickname() || '你', 24),
                coins: this._sanitizeInlineText(currentScene.userGiftRank.coins || '', 20)
            }
            : null;
        const followedHostKeys = new Set(
            this.getFollowedHosts()
                .map(item => this._normalizeHostNameKey(this._stripFollowStateSuffix(item?.name || '')))
                .filter(Boolean)
        );
        const hostFollowState = host
            ? (followedHostKeys.has(this._normalizeHostNameKey(host)) ? '已关注' : '未关注')
            : '';

        const rawDescription = String(currentScene?.description || '').trim();
        const runtimeDescription = this._isMeaningfulDescription(rawDescription)
            ? rawDescription
            : previousDescription;
        const preserveRuntimeContextLength = options?.preserveRuntimeContextLength === true || this._isFollowedHostScene(currentScene);
        const descLines = this._isMeaningfulDescription(runtimeDescription)
            ? runtimeDescription
                .replace(/\r/g, '')
                .split('\n')
                .map(line => this._sanitizePromptLine(this._normalizeHoneyStoryLine(line)))
                .filter(Boolean)
            : [];
        if (!preserveRuntimeContextLength) descLines.splice(0, Math.max(0, descLines.length - 8));

        const commentsSource = externalComments || currentScene?.comments || [];
        const comments = (Array.isArray(commentsSource) ? commentsSource : [])
            .map(line => this._sanitizeInlineText(line, 160))
            .filter(Boolean)
            .slice(-(preserveRuntimeContextLength ? 120 : 12));

        const gifts = (Array.isArray(currentScene?.gifts) ? currentScene.gifts : [])
            .map(line => this._sanitizeInlineText(line, 100))
            .filter(Boolean)
            .slice(-(preserveRuntimeContextLength ? 60 : 6));
        const collabInfo = this._normalizeHoneyCollabRequest(currentScene?.collabRequestInfo || null);
        const collabRequests = this._extractHoneyCollabRequests('', currentScene?.collabRequests || []);

        const lines = [];
        lines.push('【当前直播间状态（请在此基础上续写）】');
        if (isPrivateLive) {
            lines.push('【私密直播模式】当前直播间为私密中。无需生成回复评论区及好友申请等内容；最终 <Honey> 需要省略评论区，或输出空评论区。请聚焦主播画面、私密直播状态的信息。');
        }
        if (host) lines.push(`主播：${host}${hostFollowState ? `（${hostFollowState}）` : ''}`);
        if (title) lines.push(`标题：${title}`);
        if (liveTag) lines.push(`标签：${liveTag}`);
        if (viewers || fans) lines.push(`状态：在线人数:${viewers || '0'} 粉丝:${fans || '0'}`);
        if (collab) lines.push(`联播：${collab}`);
        if (collabInfo?.name) {
            lines.push(`联播对象信息：${collabInfo.name}${collabInfo.hostType ? `｜类型:${collabInfo.hostType}` : ''}${collabInfo.rankHint ? `｜榜单:${collabInfo.rankHint}` : ''}`);
        }
        if (intro) lines.push(`简介：${intro}`);
        if (favorability !== null) lines.push(`当前好感度：${favorability}%`);
        if (leaderboard.length > 0) {
            lines.push('当前打榜榜单（Top3）：');
            leaderboard.forEach((item) => {
                lines.push(`#${item.rank} ${item.name} - ${item.coins || '--'}`);
            });
        }
        if (userGiftRank?.name && userGiftRank?.coins) {
            lines.push(`用户打赏记录：#${userGiftRank.rank} ${userGiftRank.name} - ${userGiftRank.coins}`);
        }

        if (descLines.length > 0) {
            lines.push('当前聊天正文（最近片段）：');
            lines.push(...descLines);
        }

        if (comments.length > 0) {
            lines.push('当前评论区（最近）：');
            comments.forEach((line, idx) => lines.push(`${idx + 1}. ${line}`));
        }

        if (gifts.length > 0) {
            lines.push('当前打赏动态（最近）：');
            gifts.forEach((line, idx) => lines.push(`${idx + 1}. ${line}`));
        }
        if (collabRequests.length > 0) {
            lines.push('待处理联播申请：');
            collabRequests.forEach((item, idx) => {
                lines.push(`${idx + 1}. ${item.name}${item.requestType === 'host' ? `｜其他直播间` : '｜直播间网友'}${item.hostType ? `｜类型:${item.hostType}` : ''}${item.rankHint ? `｜榜单:${item.rankHint}` : ''}`);
            });
        }

        return lines.join('\n');
    }

    _readJSON(key, fallback) {
        const saved = this._getStored(key, null);
        if (saved === null || saved === undefined || saved === '') return fallback;
        try {
            return typeof saved === 'string' ? JSON.parse(saved) : saved;
        } catch (e) {
            return fallback;
        }
    }

    _buildHoneyInteractionHistoryContext(scene = {}) {
        if (!scene || typeof scene !== 'object') return '';
        const lines = [];
        const description = String(scene.description || '').trim();
        if (description && this._isMeaningfulDescription(description)) {
            const cleanedDescription = description
                .replace(/\r/g, '')
                .split('\n')
                .map(line => this._normalizeHoneyStoryLine(line))
                .join('\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            lines.push('【直播正文】');
            lines.push(cleanedDescription || description);
        }
        const gifts = (Array.isArray(scene.gifts) ? scene.gifts : [])
            .map(item => String(item || '').trim())
            .filter(Boolean);
        if (gifts.length > 0) {
            if (lines.length) lines.push('');
            lines.push('【打赏记录】');
            lines.push(...gifts);
        }
        const comments = (Array.isArray(scene.comments) ? scene.comments : [])
            .map(item => String(item || '').trim())
            .filter(Boolean);
        if (comments.length > 0) {
            if (lines.length) lines.push('');
            lines.push('【评论区】');
            lines.push(...comments);
        }
        return lines.join('\n').trim();
    }

    _getCurrentPhoneStoryTimeInfo() {
        const storyTime = window.VirtualPhone?.timeManager?.getCurrentStoryTime?.() || null;
        const safe = storyTime && typeof storyTime === 'object' ? storyTime : {};
        return {
            time: String(safe.time || '').trim(),
            date: String(safe.date || '').trim(),
            weekday: String(safe.weekday || '').trim(),
            timestamp: Number(safe.timestamp || 0) || Date.now()
        };
    }

    _scheduleFlushChatPersistence(delayMs = 420) {
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
        }
        this._flushTimer = setTimeout(async () => {
            this._flushTimer = null;
            const context = this._getContext();
            if (!context) return;
            try {
                if (typeof context.saveChat === 'function') {
                    await context.saveChat();
                    return;
                }
                if (typeof window.saveChatDebounced === 'function') {
                    window.saveChatDebounced();
                    return;
                }
                if (typeof context.saveChatDebounced === 'function') {
                    context.saveChatDebounced();
                }
            } catch (e) {
                console.warn('[HoneyData] 强制保存会话失败:', e);
            }
        }, Math.max(0, delayMs));
    }

    _isMeaningfulDescription(desc) {
        const text = String(desc || '').trim();
        if (!text) return false;
        if (text === '点击刷新后由 AI 生成实时剧情。') return false;
        if (text === '点击左侧刷新按钮生成剧情。') return false;
        if (text === '回推荐页下拉刷新生成剧情。') return false;
        if (text === '输入开场白后回车开播。未点击结束直播前，这场直播会一直保留。') return false;
        if (text === '暂无剧情描写。') return false;
        if (text === '暂无剧情描写，点击刷新后自动生成。') return false;
        if (text === '正在根据主题生成直播内容...') return false;
        if (text === '正在连线中...') return false;
        if (text === 'AI 正在根据你的弹幕继续推进直播剧情...') return false;
        return true;
    }

    _normalizeHoneyStoryLine(line) {
        return String(line || '')
            .replace(/\s+$/g, '')
            .replace(/^\s*(?:[-*•]+\s+|\d{1,2}\s*(?:[、\)）]|[.](?!\d))\s*)/, '')
            .trimEnd();
    }

    _simpleHash(str) {
        let hash = 0;
        const input = String(str || '');
        for (let i = 0; i < input.length; i++) {
            hash = ((hash << 5) - hash) + input.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }

    _topicStorageKey(topicRef, fallbackTitle = '') {
        const ref = String(topicRef || '').trim();
        if (ref) {
            if (/^topic_[a-z0-9]+$/i.test(ref)) {
                return `k_${ref.toLowerCase()}`;
            }
            return `t_${this._simpleHash(ref.toLowerCase())}`;
        }

        const fallback = String(fallbackTitle || '').trim().toLowerCase() || 'ai_live_default';
        return `t_${this._simpleHash(fallback)}`;
    }

    _resolveTopicStorageKeys(topicRef, fallbackTitle = '') {
        const keys = [];
        const pushKey = (value) => {
            const key = String(value || '').trim();
            if (key && !keys.includes(key)) keys.push(key);
        };

        const ref = String(topicRef || '').trim();
        const isTopicKeyRef = /^topic_[a-z0-9]+$/i.test(ref);
        const primary = this._topicStorageKey(ref, fallbackTitle);
        pushKey(primary);
        if (ref && !isTopicKeyRef) {
            // 兼容历史版本：标题直接 hash 作为 key（无前缀）
            pushKey(this._simpleHash(ref.toLowerCase()));
        }

        const fallback = String(fallbackTitle || '').trim();
        if (fallback) {
            const fallbackKey = this._topicStorageKey(fallback);
            pushKey(fallbackKey);
            // 兼容历史版本：标题直接 hash 作为 key（无前缀）
            pushKey(this._simpleHash(fallback.toLowerCase()));
        }

        return keys;
    }

    getRecommendTopics() {
        if (Array.isArray(this._recommendCache)) return this._recommendCache;
        const parsed = this._readJSON('honey_recommend_topics', []);
        this._recommendCache = Array.isArray(parsed) ? parsed : [];
        return this._recommendCache;
    }

    saveRecommendTopics(topics) {
        const safeTopics = Array.isArray(topics) ? topics : [];
        this._recommendCache = safeTopics;
        this._setStored('honey_recommend_topics', JSON.stringify(safeTopics));
        this._scheduleFlushChatPersistence();
    }

    getRecommendBgVideo() {
        const saved = this._getStored('global_honey_bg_video', '');
        const safe = typeof saved === 'string' ? saved.trim() : '';
        return safe || null;
    }

    saveRecommendBgVideo(url) {
        const safe = String(url || '').trim();
        if (safe) {
            this._setStored('global_honey_bg_video', safe);
        } else {
            this._removeStored('global_honey_bg_video', false);
        }
        this._scheduleFlushChatPersistence();
    }

    getTopicScenes() {
        if (this._topicScenesCache && typeof this._topicScenesCache === 'object') return this._topicScenesCache;
        const parsed = this._readJSON('honey_topic_scenes', {});
        this._topicScenesCache = parsed && typeof parsed === 'object' ? parsed : {};
        return this._topicScenesCache;
    }

    saveTopicScenes(scenes) {
        const safe = this._compactTopicScenes(scenes);
        this._topicScenesCache = safe;
        this._setStored('honey_topic_scenes', JSON.stringify(safe));
        this._scheduleFlushChatPersistence();
    }

    getTopicScene(topicRef, fallbackTitle = '') {
        const keys = this._resolveTopicStorageKeys(topicRef, fallbackTitle);
        if (!keys.length) return null;
        const scenes = this.getTopicScenes();
        for (const key of keys) {
            const scene = scenes[key];
            if (scene && typeof scene === 'object') return scene;
        }
        return null;
    }

    saveTopicScene(topicRef, scene, fallbackTitle = '') {
        if (!scene || typeof scene !== 'object') return;
        const keys = this._resolveTopicStorageKeys(topicRef, fallbackTitle);
        if (!keys.length) return;
        const key = keys[0];
        const scenes = this.getTopicScenes();
        const safeTitle = String(fallbackTitle || scene._topicTitle || scene.title || '直播间').trim();
        const refKey = String(topicRef || '').trim();
        const safeTopicKey = /^topic_[a-z0-9]+$/i.test(refKey)
            ? refKey.toLowerCase()
            : String(scene._topicKey || `topic_${this._simpleHash(`${safeTitle}__0`)}`).trim();
        const sceneForStorage = {
            ...scene,
            _topicTitle: safeTitle,
            _topicKey: safeTopicKey,
            updatedAt: Date.now()
        };
        scenes[key] = this._compactStoredScene(sceneForStorage, {
            full: true,
            preservePromptTurnLength: this._isFollowedHostScene(sceneForStorage)
        });
        this.saveTopicScenes(scenes);
    }

    clearTopicScene(topicRef, options = {}) {
        const safeRef = String(topicRef || options?.topicKey || '').trim();
        const safeTitle = String(options?.fallbackTitle || '').trim();
        const keys = this._resolveTopicStorageKeys(safeRef, safeTitle);
        if (!keys.length) return;

        const scenes = this.getTopicScenes();
        let changed = false;
        for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(scenes, key)) {
                delete scenes[key];
                changed = true;
            }
        }
        if (changed) {
            this.saveTopicScenes(scenes);
        }

        const clearLast = options?.clearLastSceneIfMatch !== false;
        if (clearLast) {
            const last = this.getLastSceneData();
            const lastKey = String(last?._topicKey || '').trim().toLowerCase();
            const lastTitle = String(last?._topicTitle || last?.title || '').trim();
            const targetKey = /^topic_[a-z0-9]+$/i.test(safeRef) ? safeRef.toLowerCase() : '';
            const titleMatch = !!safeTitle && lastTitle === safeTitle;
            const keyMatch = !!targetKey && lastKey === targetKey;
            if (last && (titleMatch || keyMatch)) {
                this._lastSceneCache = null;
                this._removeStored('honey_last_scene');
                this._scheduleFlushChatPersistence();
            }
        }
    }

    getSelectedTopicTitle() {
        if (typeof this._selectedTopicCache === 'string') return this._selectedTopicCache;
        const saved = this._getStored('honey_selected_topic', '');
        this._selectedTopicCache = typeof saved === 'string' ? saved : '';
        return this._selectedTopicCache;
    }

    saveSelectedTopicTitle(topicTitle) {
        const safe = String(topicTitle || '').trim();
        this._selectedTopicCache = safe;
        this._setStored('honey_selected_topic', safe);
        this._scheduleFlushChatPersistence();
    }

    getSelectedTopicKey() {
        const saved = this._getStored('honey_selected_topic_key', '');
        return typeof saved === 'string' ? saved.trim() : '';
    }

    saveSelectedTopicKey(topicKey) {
        const safe = String(topicKey || '').trim();
        this._setStored('honey_selected_topic_key', safe);
        this._scheduleFlushChatPersistence();
    }

    _normalizeCustomVideoList(rawValue) {
        let parsed = rawValue;
        if (typeof parsed === 'string') {
            const trimmed = parsed.trim();
            if (!trimmed) return [];
            try {
                parsed = JSON.parse(trimmed);
            } catch (e) {
                return [];
            }
        }

        if (!Array.isArray(parsed)) return [];

        const seen = new Set();
        const list = [];
        parsed.forEach((item) => {
            const safe = String(item || '').trim();
            if (!safe || seen.has(safe)) return;
            seen.add(safe);
            list.push(safe);
        });
        return list;
    }

    getCustomLiveVideos() {
        const globalRaw = this._getStored(this.customLiveVideosGlobalKey, null);
        const globalList = this._normalizeCustomVideoList(globalRaw);

        // 兼容旧版：从聊天专属 key 读取并迁移到全局 key
        const legacyRaw = this._getStoredRaw(this.customLiveVideosLegacyKey, null);
        const legacyList = this._normalizeCustomVideoList(legacyRaw);

        const merged = [];
        const seen = new Set();
        [...globalList, ...legacyList].forEach((url) => {
            if (!url || seen.has(url)) return;
            seen.add(url);
            merged.push(url);
        });

        if (merged.length > 0) {
            const mergedJson = JSON.stringify(merged);
            const globalJson = JSON.stringify(globalList);
            if (mergedJson !== globalJson) {
                this._setStored(this.customLiveVideosGlobalKey, mergedJson);
                this._scheduleFlushChatPersistence();
            }
        }

        // 完成迁移后清空 legacy，避免删除时被旧 key 再次“回灌”到列表末尾
        if (legacyList.length > 0) {
            this._removeStoredRaw(this.customLiveVideosLegacyKey);
        }

        return merged;
    }

    addCustomLiveVideo(url) {
        const safeUrl = String(url || '').trim();
        if (!safeUrl) return;
        const videos = this.getCustomLiveVideos();
        if (!videos.includes(safeUrl)) {
            videos.push(safeUrl);
            this._setStored(this.customLiveVideosGlobalKey, JSON.stringify(videos));
            this._scheduleFlushChatPersistence();
        }
    }

    removeCustomLiveVideo(url) {
        const safeUrl = String(url || '').trim();
        if (!safeUrl) return;
        const videos = this.getCustomLiveVideos().filter(v => v !== safeUrl);
        this._setStored(this.customLiveVideosGlobalKey, JSON.stringify(videos));
        // 迁移后不再保留 legacy
        this._removeStoredRaw(this.customLiveVideosLegacyKey);

        this._scheduleFlushChatPersistence();
    }

    getHoneyUserNickname() {
        const saved = String(this._getStored('honey_user_nickname', '') || '').trim();
        if (saved) return saved;
        const context = this._getContext();
        const fallback = String(context?.name1 || '').trim();
        return fallback || '你';
    }

    saveHoneyUserNickname(nickname) {
        const safe = String(nickname || '')
            .replace(/[\r\n\t]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 20);
        this._setStored('honey_user_nickname', safe);
        this._scheduleFlushChatPersistence();
        return safe;
    }

    _parseHoneyFollowerNumber(raw) {
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

    _updateHoneyUserProfileFollowers(rawValue) {
        const parsedFollowers = this._parseHoneyFollowerNumber(rawValue);
        if (parsedFollowers === null) return null;

        const profile = this.getHoneyUserProfile();
        const currentFollowers = Math.max(0, Number.parseInt(String(profile.followers || 0), 10) || 0);
        if (currentFollowers !== parsedFollowers) {
            this.saveHoneyUserProfile({ followers: parsedFollowers });
        }
        return parsedFollowers;
    }

    getHoneyUserProfile() {
        const parsed = this._readJSON('honey_user_profile', {}) || {};
        const fallbackNickname = this._sanitizeInlineText(parsed.nickname || '主播', 20) || '主播';
        const followers = Math.max(0, Number.parseInt(String(parsed.followers || 0), 10) || 0);
        const rawGender = String(parsed.gender || '').trim().toLowerCase();
        const gender = rawGender === 'male' || rawGender === 'female' ? rawGender : 'female';
        return {
            nickname: fallbackNickname,
            liveTitle: this._sanitizeInlineText(parsed.liveTitle || `${fallbackNickname}的直播间`, 40) || `${fallbackNickname}的直播间`,
            avatarUrl: String(parsed.avatarUrl || '').trim(),
            intro: this._sanitizeInlineText(parsed.intro || '今晚来我直播间聊天。', 120) || '今晚来我直播间聊天。',
            followers,
            accountId: this._buildHoneyUserAccountId(parsed.accountId || fallbackNickname),
            gender
        };
    }

    saveHoneyUserProfile(patch = {}) {
        const current = this.getHoneyUserProfile();
        const nextNickname = this._sanitizeInlineText(patch.nickname ?? current.nickname ?? '', 20) || current.nickname || '你';
        const nextFollowers = Math.max(0, Number.parseInt(String(patch.followers ?? current.followers ?? 0), 10) || 0);
        const rawGender = String(patch.gender ?? current.gender ?? 'female').trim().toLowerCase();
        const nextGender = rawGender === 'male' || rawGender === 'female' ? rawGender : 'female';
        const nextProfile = {
            nickname: nextNickname,
            liveTitle: this._sanitizeInlineText(patch.liveTitle ?? current.liveTitle ?? `${nextNickname}的直播间`, 40) || `${nextNickname}的直播间`,
            avatarUrl: String(patch.avatarUrl ?? current.avatarUrl ?? '').trim(),
            intro: this._sanitizeInlineText(patch.intro ?? current.intro ?? '', 120) || '今晚来我直播间聊天。',
            followers: nextFollowers,
            accountId: this._buildHoneyUserAccountId(patch.accountId || current.accountId || nextNickname),
            gender: nextGender
        };
        this._setStored('honey_user_profile', JSON.stringify(nextProfile));
        this._syncUserLiveTopicCaches(nextProfile);
        this._scheduleFlushChatPersistence();
        return nextProfile;
    }

    _syncUserLiveTopicCaches(profile = null) {
        const safeProfile = (profile && typeof profile === 'object')
            ? profile
            : this.getHoneyUserProfile();
        const nickname = this._sanitizeInlineText(safeProfile?.nickname || '主播', 20) || '主播';
        const title = this._sanitizeInlineText(safeProfile?.liveTitle || `${nickname}的直播间`, 40) || `${nickname}的直播间`;
        const intro = this._sanitizeInlineText(safeProfile?.intro || '', 120);
        const followers = Math.max(0, Number.parseInt(String(safeProfile?.followers || 0), 10) || 0);
        const fans = String(followers);
        const userLiveTopicKey = 'topic_user_live';

        const cachedScene = this.getTopicScene(userLiveTopicKey, title) || {};
        const nextScene = {
            ...cachedScene,
            host: nickname,
            title,
            _topicTitle: title,
            _topicKey: userLiveTopicKey,
            intro: intro || String(cachedScene?.intro || '').trim(),
            fans,
            playCount: String(cachedScene?.playCount || cachedScene?.viewers || '0'),
            viewers: String(cachedScene?.viewers || '0'),
            collab: String(cachedScene?.collab || '无').trim() || '无',
            isUserLive: true
        };
        this.saveTopicScene(userLiveTopicKey, nextScene, title);

        const lastScene = this.getLastSceneData();
        const lastTopicKey = String(lastScene?._topicKey || '').trim();
        if (lastScene && (lastTopicKey === userLiveTopicKey || lastScene?.isUserLive === true)) {
            this.saveLastSceneData({
                ...lastScene,
                host: nickname,
                title,
                _topicTitle: title,
                _topicKey: userLiveTopicKey,
                intro: intro || String(lastScene?.intro || '').trim(),
                fans,
                isUserLive: true
            });
        }

        const selectedTopicKey = this.getSelectedTopicKey();
        if (selectedTopicKey === userLiveTopicKey) {
            this.saveSelectedTopicTitle(title);
            this.saveSelectedTopicKey(userLiveTopicKey);
        }

        const recommendTopics = this.getRecommendTopics();
        if (Array.isArray(recommendTopics) && recommendTopics.length > 0) {
            const idx = recommendTopics.findIndex(item => {
                const key = String(item?._topicKey || '').trim();
                return key === userLiveTopicKey || item?.isUserLive === true;
            });
            if (idx >= 0) {
                recommendTopics[idx] = {
                    ...recommendTopics[idx],
                    _topicKey: userLiveTopicKey,
                    host: nickname,
                    title,
                    intro: intro || String(recommendTopics[idx]?.intro || '').trim(),
                    fans,
                    isUserLive: true
                };
                this.saveRecommendTopics(recommendTopics);
            }
        }
    }

    _syncHoneyUserProfileFromUserLiveScene(scene = null) {
        if (!scene || typeof scene !== 'object') return this.getHoneyUserProfile();
        const nextPatch = {};
        const safeTitle = this._sanitizeInlineText(scene.title || '', 40);
        const safeIntro = this._sanitizeInlineText(scene.intro || '', 120);
        const parsedFollowers = this._parseHoneyFollowerNumber(scene.fans);
        if (safeTitle) nextPatch.liveTitle = safeTitle;
        if (safeIntro) nextPatch.intro = safeIntro;
        if (parsedFollowers !== null) nextPatch.followers = parsedFollowers;
        if (Object.keys(nextPatch).length <= 0) return this.getHoneyUserProfile();
        return this.saveHoneyUserProfile(nextPatch);
    }

    _buildHoneyUserAccountId(seed = '') {
        const base = String(seed || this.getHoneyUserNickname() || 'user')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_\u4e00-\u9fa5]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 24);
        return `@${base || 'user_live'}`;
    }

    _sanitizeHoneySecret(value, maxLen = 220) {
        return String(value || '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, maxLen);
    }

    _buildHoneyFriendSecretFallback(item = {}) {
        const anchorName = this._sanitizeInlineText(this.getHoneyUserProfile?.()?.nickname || this.getHoneyUserNickname?.() || '用户', 24) || '用户';
        const source = this._sanitizeInlineText(item.source || '直播间', 24) || '直播间';
        const visibleMessage = this._sanitizeInlineText(item.message || '', 80);
        const sourceText = source.includes('直播') ? source : `${source}直播间`;
        const tail = visibleMessage ? `当前试探方式是“${visibleMessage}”。` : '目前想先从微信上继续接近对方。';
        return this._sanitizeHoneySecret(`该网友是在观看用户${anchorName}的${sourceText}时进入并产生兴趣，已对用户形成初步印象，正在观察用户是否值得继续靠近。${tail}`, 220);
    }

    _parseHoneyFriendRequestLine(line, fallbackSource = '直播间') {
        const cleaned = String(line || '').replace(/^\s*(?:[-*•]+|\d{1,2}\s*[\.、])\s*/, '').trim();
        if (!cleaned) return null;

        let raw = cleaned;
        let hiddenBackground = '';
        const splitOutsideBracketColon = (value = '') => {
            const text = String(value || '');
            let depth = 0;
            for (let i = 0; i < text.length; i++) {
                const ch = text[i];
                if (ch === '（' || ch === '(' || ch === '【' || ch === '[') depth += 1;
                if (ch === '）' || ch === ')' || ch === '】' || ch === ']') depth = Math.max(0, depth - 1);
                if ((ch === '：' || ch === ':') && depth === 0) {
                    return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
                }
            }
            return [text.trim(), ''];
        };

        const hiddenPatterns = [
            /(?:[｜|])\s*隐藏(?:背景|设定|信息|印象)?\s*[：:]\s*(.+)$/i,
            /[【\[]\s*隐藏(?:背景|设定|信息|印象)?\s*[：:]\s*([^\]】]+)\s*[】\]]\s*$/i,
            /[（(]\s*隐藏(?:背景|设定|信息|印象)?\s*[：:]\s*([^)）]+)\s*[)）]\s*$/i
        ];

        hiddenPatterns.some((pattern) => {
            const match = raw.match(pattern);
            if (!match) return false;
            hiddenBackground = this._sanitizeHoneySecret(match[1], 220);
            raw = raw.replace(match[0], '').trim();
            return true;
        });

        const [namePart, messagePart] = splitOutsideBracketColon(raw);
        let rawName = this._sanitizeInlineText(namePart || raw, 48);
        let accountName = '';
        const roleAccountMatch = rawName.match(/^(.{1,24}?)[（(]\s*(?:主播账号|账号|频道)\s*[：:]\s*([^）)]{1,32})\s*[）)]$/);
        const accountRoleMatch = rawName.match(/^(.{1,32}?)[（(]\s*([^（）()]{1,24})\s*[）)]$/);
        if (roleAccountMatch) {
            rawName = this._sanitizeInlineText(roleAccountMatch[1], 24);
            accountName = this._sanitizeInlineText(roleAccountMatch[2], 32);
        } else if (accountRoleMatch) {
            const possibleAccount = this._sanitizeInlineText(accountRoleMatch[1], 32);
            const possibleRole = this._sanitizeInlineText(accountRoleMatch[2], 24);
            const fallbackKey = this._normalizeHostNameKey(fallbackSource || '');
            const accountKey = this._normalizeHostNameKey(possibleAccount || '');
            if ((fallbackKey && accountKey === fallbackKey) || /(?:账号|频道|组合|工作室|男团|女团|双子|直播间)/.test(possibleAccount)) {
                rawName = possibleRole;
                accountName = possibleAccount;
            }
        }

        const name = this._sanitizeInlineText(rawName, 24);
        const message = this._sanitizeInlineText(messagePart || '想加你为好友', 80) || '想加你为好友';
        if (!name) return null;
        const source = accountName || fallbackSource;
        if (accountName) {
            const accountLine = `来自蜜语主播账号“${accountName}”。`;
            hiddenBackground = hiddenBackground
                ? this._sanitizeHoneySecret(`${accountLine}${hiddenBackground}`, 220)
                : accountLine;
        }

        return this._normalizeHoneySocialPerson({
            name,
            message,
            source,
            sourceLabel: accountName ? '主播' : '',
            requestType: accountName ? 'host' : '',
            hiddenBackground
        }, fallbackSource);
    }

    _normalizeHoneySocialPerson(item, fallbackSource = '') {
        if (!item || typeof item !== 'object') return null;
        let rawName = this._sanitizeInlineText(item.name || item.nickname || item.user || item.hostName || '', 48);
        let repairedSource = this._sanitizeInlineText(item.source || fallbackSource || '直播间', 24) || '直播间';
        let repairedSourceLabel = this._sanitizeInlineText(item.sourceLabel || item.label || '', 24);
        let repairedRequestType = item.requestType || item.sourceType || item.type || '';
        const brokenRoleAccountMatch = rawName.match(/^(.{1,24}?)[（(]\s*(?:主播账号|账号|频道)\s*$/);
        if (brokenRoleAccountMatch) {
            rawName = this._sanitizeInlineText(brokenRoleAccountMatch[1], 24);
            if (/主播|其他直播间|直播间/i.test(String(fallbackSource || ''))) {
                repairedSource = this._sanitizeInlineText(fallbackSource, 24) || repairedSource;
                repairedSourceLabel = repairedSourceLabel || '主播';
                repairedRequestType = repairedRequestType || 'host';
            }
        }
        const name = this._sanitizeInlineText(rawName, 24);
        if (!name) return null;
        return {
            name,
            avatarUrl: String(item.avatarUrl || item.avatar || '').trim(),
            message: this._sanitizeInlineText(item.message || item.text || item.reason || '', 80),
            source: repairedSource,
            sourceApp: this._sanitizeInlineText(item.sourceApp || item.app || 'honey', 16) || 'honey',
            sourceLabel: repairedSourceLabel,
            requestType: /host|broadcaster|anchor|streamer|主播|其他直播间/i.test(String(repairedRequestType || repairedSourceLabel || repairedSource || fallbackSource || ''))
                ? 'host'
                : 'viewer',
            hostType: this._sanitizeInlineText(item.hostType || item.figure || item.category || item.role || '', 24),
            acceptedAtPhoneTime: this._sanitizeInlineText(
                item.acceptedAtPhoneTime
                || item.acceptTime
                || item.addedAtPhoneTime
                || item.friendAddedAt
                || '',
                40
            ),
            hiddenBackground: this._sanitizeHoneySecret(
                item.hiddenBackground
                || item.hiddenSetting
                || item.hidden
                || item.secret
                || item.secretNote
                || item.backstory
                || item.impression
                || '',
                220
            )
        };
    }

    _parseHoneyInteractionRecordLine(line) {
        const cleaned = String(line || '').replace(/^\s*(?:[-*•]+|\d{1,2}\s*[\.、])\s*/, '').trim();
        if (!cleaned) return null;

        const match = cleaned.match(/^\s*(?:\[|\【)?\s*([^\]】：:\n]{1,24})\s*(?:\]|\】)?\s*[：:]\s*(.+)$/);
        const name = this._sanitizeInlineText(match?.[1] || '', 24);
        const summary = this._sanitizeHoneySecret(match?.[2] || '', 180);
        if (!name || !summary) return null;

        return { name, summary };
    }

    _mergeHoneyInteractionSummaryIntoHiddenBackground(hiddenBackground = '', summary = '') {
        const safeSummary = this._sanitizeHoneySecret(summary || '', 180);
        const base = this._sanitizeHoneySecret(hiddenBackground || '', 220);
        if (!safeSummary) return base;

        const normalizedSummary = /[。；;!！?？]$/.test(safeSummary) ? safeSummary : `${safeSummary}。`;
        const prefix = '直播互动简要：';
        const existingMatch = base.match(/直播互动简要：([^]*?)$/);
        const existingSummary = this._sanitizeHoneySecret(existingMatch?.[1] || '', 160);
        if (existingSummary === safeSummary || existingSummary === normalizedSummary.replace(/[。；;!！?？]+$/g, '')) {
            return base;
        }

        let cleanedBase = String(base || '')
            .replace(/直播互动简要：[^]*$/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
        if (cleanedBase && !/[。；;!！?？]$/.test(cleanedBase)) {
            cleanedBase = `${cleanedBase}。`;
        }
        return this._sanitizeHoneySecret(`${cleanedBase}${prefix}${normalizedSummary}`, 220);
    }

    applyHoneyInteractionRecords(records = []) {
        const normalizedRecords = (Array.isArray(records) ? records : [])
            .map(item => this._parseHoneyInteractionRecordLine(
                typeof item === 'string'
                    ? item
                    : `${this._sanitizeInlineText(item?.name || item?.nickname || '', 24)}：${this._sanitizeHoneySecret(item?.summary || item?.content || item?.text || '', 180)}`
            ))
            .filter(Boolean);
        if (normalizedRecords.length === 0) {
            return { updatedFriends: 0, updatedRequests: 0, updatedContacts: 0 };
        }

        const pendingRequests = this.getHoneyFriendRequests();
        const friends = this.getHoneyFriends();
        let updatedRequests = 0;
        let updatedFriends = 0;
        let updatedContacts = 0;

        normalizedRecords.forEach((record) => {
            const targetKey = this._normalizeHostNameKey(record.name || '');
            if (!targetKey) return;

            const requestIdx = pendingRequests.findIndex(item => this._normalizeHostNameKey(item?.name || '') === targetKey);
            if (requestIdx >= 0) {
                const nextHiddenBackground = this._mergeHoneyInteractionSummaryIntoHiddenBackground(
                    pendingRequests[requestIdx].hiddenBackground || this._buildHoneyFriendSecretFallback(pendingRequests[requestIdx]),
                    record.summary
                );
                if (nextHiddenBackground !== pendingRequests[requestIdx].hiddenBackground) {
                    pendingRequests[requestIdx] = {
                        ...pendingRequests[requestIdx],
                        hiddenBackground: nextHiddenBackground
                    };
                    updatedRequests += 1;
                }
            }

            const friendIdx = friends.findIndex(item => this._normalizeHostNameKey(item?.name || '') === targetKey);
            if (friendIdx >= 0) {
                const nextHiddenBackground = this._mergeHoneyInteractionSummaryIntoHiddenBackground(
                    friends[friendIdx].hiddenBackground || this._buildHoneyFriendSecretFallback(friends[friendIdx]),
                    record.summary
                );
                if (nextHiddenBackground !== friends[friendIdx].hiddenBackground) {
                    friends[friendIdx] = {
                        ...friends[friendIdx],
                        hiddenBackground: nextHiddenBackground
                    };
                    updatedFriends += 1;
                }
            }
        });

        if (updatedRequests > 0) this.saveHoneyFriendRequests(pendingRequests);
        if (updatedFriends > 0) this.saveHoneyFriends(friends);

        if (updatedFriends > 0) {
            const wechatData = this._getWechatDataBridge();
            const contacts = wechatData.getContacts?.() || [];
            friends.forEach((friend) => {
                const targetKey = this._normalizeHostNameKey(friend?.name || '');
                if (!targetKey || !friend?.hiddenBackground) return;
                const linkedContact = contacts.find(item => this._normalizeHostNameKey(item?.name || '') === targetKey);
                if (!linkedContact?.id) return;
                wechatData.updateContact(linkedContact.id, {
                    honeyHiddenBackground: friend.hiddenBackground
                });
                updatedContacts += 1;
            });
        }

        return { updatedFriends, updatedRequests, updatedContacts };
    }

    _normalizeHoneyCollabRequest(item, fallbackType = 'viewer') {
        if (!item) return null;
        if (typeof item === 'string') {
            return this._parseHoneyCollabRequestTag(item, fallbackType);
        }
        if (typeof item !== 'object') return null;

        const name = this._sanitizeInlineText(item.name || item.nickname || item.user || item.hostName || '', 24);
        if (!name) return null;

        const rawType = String(item.requestType || item.sourceType || item.type || item.source || fallbackType || 'viewer').trim().toLowerCase();
        const requestType = /host|broadcaster|anchor|streamer|主播|其他直播间/.test(rawType) ? 'host' : 'viewer';
        const hostType = this._sanitizeInlineText(item.hostType || item.figure || item.category || item.role || '', 24);
        const rankHint = this._sanitizeInlineText(item.rankHint || item.rankLabel || item.rank || item.leaderboard || '', 24);

        return {
            name,
            requestType,
            hostType,
            rankHint
        };
    }

    _parseHoneyCollabRequestTag(line, fallbackType = 'viewer') {
        const raw = String(line || '').trim();
        if (!raw) return null;

        const match = raw.match(/\[\s*(联播请求|其他直播间请求联播)\s*[：:]\s*([^\]\n]+)\]/i);
        if (!match) return null;

        const tagType = String(match[1] || '').trim();
        const body = String(match[2] || '').trim();
        const requestType = /其他直播间/.test(tagType) ? 'host' : (String(fallbackType || '').trim().toLowerCase() === 'host' ? 'host' : 'viewer');
        const tokens = body
            .split(/[｜|/／]/)
            .map(item => this._sanitizeInlineText(item, 40))
            .filter(Boolean);

        let name = this._sanitizeInlineText(tokens[0] || '', 24);
        if (!name) {
            const fallbackName = body.match(/^(.+?)(?:(?:是否)?在榜|是否上榜|榜单|未上榜|上榜|$)/);
            name = this._sanitizeInlineText(fallbackName?.[1] || '', 24);
        }
        name = String(name || '')
            .replace(/(?:是否在榜单上排名|是否上榜|在榜单上排名|榜单排名|榜单|上榜|未上榜)$/g, '')
            .trim();
        name = this._sanitizeInlineText(name, 24);
        if (!name) return null;

        const detailTokens = tokens.slice(1);
        const rankHint = requestType === 'viewer'
            ? this._sanitizeInlineText(
                detailTokens.find(item => /(?:榜|上榜|未上榜|第\s*[0-9一二三四五六七八九十两]+|top)/i.test(item))
                || '',
                24
            )
            : '';
        const hostType = requestType === 'host'
            ? this._sanitizeInlineText(
                detailTokens.find(item => !/(?:榜|上榜|未上榜|第\s*[0-9一二三四五六七八九十两]+|top)/i.test(item))
                || '',
                24
            )
            : '';

        return {
            name,
            requestType,
            hostType,
            rankHint
        };
    }

    _extractHoneyCollabRequests(text = '', list = []) {
        const fromList = (Array.isArray(list) ? list : [])
            .map(item => this._normalizeHoneyCollabRequest(item))
            .filter(Boolean);
        const fromText = Array.from(String(text || '').matchAll(/\[\s*(?:联播请求|其他直播间请求联播)\s*[：:]\s*[^\]\n]+\]/ig))
            .map(match => this._parseHoneyCollabRequestTag(match[0]))
            .filter(Boolean);

        const merged = [];
        const seen = new Set();
        [...fromList, ...fromText].forEach((item) => {
            const key = `${String(item?.requestType || 'viewer').trim().toLowerCase()}::${String(item?.name || '').trim().toLowerCase()}`;
            if (!item?.name || seen.has(key)) return;
            seen.add(key);
            merged.push(item);
        });
        return merged.slice(0, 6);
    }

    getHoneyFriends() {
        const parsed = this._readJSON('honey_my_friends', []);
        if (!Array.isArray(parsed)) return [];
        const localList = parsed
            .map(item => this._normalizeHoneySocialPerson(item, '好友'))
            .filter(Boolean);
        const merged = this._mergeHoneyPeopleFromGlobalStore(localList, 'friend');
        return this._mergeWechatLinkedFollowedHostsIntoHoneyFriends(merged);
    }

    saveHoneyFriends(list) {
        const safeList = Array.isArray(list)
            ? list.map(item => this._normalizeHoneySocialPerson(item, '好友')).filter(Boolean)
            : [];
        this._syncHoneyPeopleToGlobalStore(safeList, 'friend');
        this._removeStored('honey_my_friends');
        // 全局主库模式：不再持续写入会话键，避免污染聊天会话。
        return safeList;
    }

    _mergeWechatLinkedFollowedHostsIntoHoneyFriends(friendList = []) {
        const merged = Array.isArray(friendList) ? [...friendList] : [];
        const friendKeys = new Set(merged.map(item => this._normalizeHostNameKey(item?.name || '')).filter(Boolean));
        const followedHosts = this.getFollowedHosts();
        if (!Array.isArray(followedHosts) || followedHosts.length === 0) return merged;

        let changedWechatContacts = false;
        const wechatData = this._getWechatDataBridge();
        const contacts = wechatData?.getContacts?.() || [];
        const chats = wechatData?.getChatList?.() || [];

        followedHosts.forEach((host) => {
            const hostName = this._sanitizeInlineText(host?.name || host?.hostName || '', 40);
            const hostKey = this._normalizeHostNameKey(hostName);
            if (!hostName || !hostKey || friendKeys.has(hostKey)) return;
            if (this._isHoneyWechatContactDeleted(hostName)) return;

            const linkedContactId = String(host?.wechatContactId || '').trim();
            const linkedChatId = String(host?.wechatChatId || '').trim();
            const linkedContactName = String(host?.wechatContactName || '').trim();
            const linkedContactNameKey = this._normalizeWechatContactNameKey(linkedContactName);
            const contact = (linkedContactId ? contacts.find(item => String(item?.id || '') === linkedContactId) : null)
                || (linkedContactNameKey ? contacts.find(item => this._normalizeWechatContactNameKey(item?.name || '') === linkedContactNameKey) : null)
                || contacts.find(item => this._normalizeHostNameKey(this._resolveHoneyHostNameFromWechatContact(item)) === hostKey)
                || contacts.find(item => this._normalizeHostNameKey(item?.name || '') === hostKey)
                || (linkedChatId ? (() => {
                    const linkedChat = chats.find(item => String(item?.id || '') === linkedChatId);
                    return linkedChat?.contactId ? contacts.find(item => String(item?.id || '') === String(linkedChat.contactId || '')) : null;
                })() : null);
            const chat = contact?.id ? wechatData.getChatByContactId?.(contact.id) : (linkedChatId ? chats.find(item => String(item?.id || '') === linkedChatId) : null);
            if (!contact && !chat) return;

            if (contact?.id && String(contact.honeyHostName || '').trim() !== hostName) {
                wechatData.updateContact?.(contact.id, {
                    sourceApp: 'honey',
                    sourceLabel: '主播',
                    honeyHostName: hostName,
                    honeySource: contact.honeySource || '关注主播',
                    honeyVisibleIntro: contact.honeyVisibleIntro || host.intro || '',
                    honeyHiddenBackground: contact.honeyHiddenBackground || this._buildFollowedHostWechatBackground(host, {
                        title: host.liveTitle || `${hostName} 的直播间`
                    })
                });
                changedWechatContacts = true;
            }

            const displayName = contact?.name || host.wechatContactName || hostName;
            const displayKey = this._normalizeHostNameKey(displayName);
            if (displayKey && friendKeys.has(displayKey)) {
                const idx = merged.findIndex(item => this._normalizeHostNameKey(item?.name || '') === displayKey);
                if (idx >= 0) {
                    merged[idx] = this._normalizeHoneySocialPerson({
                        ...merged[idx],
                        avatarUrl: merged[idx].avatarUrl || host.avatarUrl || contact?.avatar || chat?.avatar || '',
                        source: hostName,
                        sourceApp: 'honey',
                        sourceLabel: '主播',
                        requestType: 'host',
                        hostType: host.figure || merged[idx].hostType || '主播',
                        hiddenBackground: merged[idx].hiddenBackground || contact?.honeyHiddenBackground || this._buildFollowedHostWechatBackground(host, {
                            title: host.liveTitle || `${hostName} 的直播间`
                        })
                    }, '好友');
                }
                return;
            }

            const visibleIntro = this._sanitizeInlineText(
                contact?.honeyVisibleIntro
                || host.intro
                || `${hostName} 已成为你的微信好友。`,
                80
            );
            const hiddenBackground = this._sanitizeHoneySecret(
                contact?.honeyHiddenBackground
                || this._buildFollowedHostWechatBackground(host, {
                    title: host.liveTitle || `${hostName} 的直播间`
                }),
                220
            );
            const recovered = this._normalizeHoneySocialPerson({
                name: displayName,
                avatarUrl: host.avatarUrl || contact?.avatar || chat?.avatar || '',
                message: visibleIntro,
                source: hostName,
                sourceApp: 'honey',
                sourceLabel: '主播',
                requestType: 'host',
                hostType: host.figure || '主播',
                hiddenBackground
            }, '好友');
            if (!recovered) return;
            merged.push(recovered);
            friendKeys.add(displayKey || hostKey);
        });

        if (changedWechatContacts && typeof wechatData?.saveData === 'function') {
            wechatData.saveData();
        }
        return merged;
    }

    getHoneyFriendRequests() {
        const parsed = this._readJSON('honey_my_friend_requests', []);
        if (!Array.isArray(parsed)) return [];
        const localList = parsed
            .map(item => this._normalizeHoneySocialPerson(item, '直播间'))
            .filter(Boolean);
        return this._mergeHoneyPeopleFromGlobalStore(localList, 'request');
    }

    saveHoneyFriendRequests(list) {
        const safeList = Array.isArray(list)
            ? list.map(item => this._normalizeHoneySocialPerson(item, '直播间')).filter(Boolean)
            : [];
        this._syncHoneyPeopleToGlobalStore(safeList, 'request');
        this._removeStored('honey_my_friend_requests');
        // 全局主库模式：不再持续写入会话键，避免污染聊天会话。
        return safeList;
    }

    mergeHoneyFriendRequests(list) {
        const incoming = Array.isArray(list)
            ? list.map(item => this._normalizeHoneySocialPerson(item, '直播间')).filter(Boolean)
            : [];
        if (incoming.length === 0) {
            return { added: 0, list: this.getHoneyFriendRequests() };
        }

        const friends = this.getHoneyFriends();
        const friendKeys = new Set(friends.map(item => this._normalizeHostNameKey(item?.name || '')).filter(Boolean));
        const current = this.getHoneyFriendRequests();
        const currentKeys = new Set(current.map(item => this._normalizeHostNameKey(item?.name || '')).filter(Boolean));
        let added = 0;

        incoming.forEach((item) => {
            const key = this._normalizeHostNameKey(item?.name || '');
            if (!key || friendKeys.has(key)) return;
            if (currentKeys.has(key)) {
                const currentIndex = current.findIndex(entry => this._normalizeHostNameKey(entry?.name || '') === key);
                if (currentIndex >= 0) {
                    current[currentIndex] = {
                        ...current[currentIndex],
                        avatarUrl: String(item.avatarUrl || current[currentIndex].avatarUrl || '').trim(),
                        message: item.message || current[currentIndex].message || '',
                        source: item.source || current[currentIndex].source || '直播间',
                        sourceApp: item.sourceApp || current[currentIndex].sourceApp || 'honey',
                        sourceLabel: item.sourceLabel || current[currentIndex].sourceLabel || '',
                        requestType: item.requestType || current[currentIndex].requestType || 'viewer',
                        hostType: item.hostType || current[currentIndex].hostType || '',
                        hiddenBackground: item.hiddenBackground || current[currentIndex].hiddenBackground || ''
                    };
                }
                return;
            }
            current.push(item);
            currentKeys.add(key);
            added += 1;
        });

        this.saveHoneyFriendRequests(current);
        return { added, list: current };
    }

    _getCurrentPhoneDateTimeOrSystem() {
        const currentTime = window.VirtualPhone?.timeManager?.getCurrentStoryTime?.() || {};
        const rawDate = String(currentTime?.date || '').trim();
        const rawTime = String(currentTime?.time || '').trim();

        const dateChunks = rawDate.match(/\d+/g) || [];
        const safeDate = dateChunks.length >= 3
            ? `${dateChunks[0].padStart(4, '0').slice(-4)}-${dateChunks[1].padStart(2, '0').slice(-2)}-${dateChunks[2].padStart(2, '0').slice(-2)}`
            : '';
        const timeMatch = rawTime.match(/(\d{1,2})[:：](\d{2})/);
        const safeTime = timeMatch
            ? `${String(timeMatch[1]).padStart(2, '0')}:${timeMatch[2]}`
            : '';
        if (safeDate && safeTime) return `${safeDate} ${safeTime}`;
        if (safeDate) return safeDate;

        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }

    _injectHoneyFriendAcceptedTime(hiddenBackground = '', acceptedAtPhoneTime = '') {
        const acceptedTime = this._sanitizeInlineText(acceptedAtPhoneTime, 40);
        const base = this._sanitizeHoneySecret(hiddenBackground || '', 220);
        if (!acceptedTime) return base;

        const acceptedLine = `已于手机时间${acceptedTime}通过了用户的好友申请。`;
        const cleanedBase = String(base || '')
            .replace(/已于手机时间[^。；;!！?？\n]{1,48}通过了用户的好友申请。?/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();

        if (!cleanedBase) return acceptedLine;
        const normalizedBase = /[。；;!！?？]$/.test(cleanedBase)
            ? cleanedBase
            : `${cleanedBase}。`;
        return this._sanitizeHoneySecret(`${normalizedBase}${acceptedLine}`, 220);
    }

    acceptHoneyFriendRequest(name) {
        const safeName = this._sanitizeInlineText(name || '', 24);
        if (!safeName) return null;
        const requests = this.getHoneyFriendRequests();
        const request = requests.find(item => this._normalizeHostNameKey(item?.name || '') === this._normalizeHostNameKey(safeName));
        if (!request) return null;
        this._clearHoneyDeletedWechatContact(request.name || safeName);
        const acceptedAtPhoneTime = this._getCurrentPhoneDateTimeOrSystem();
        const acceptedHiddenBackground = this._injectHoneyFriendAcceptedTime(
            request.hiddenBackground || this._buildHoneyFriendSecretFallback(request),
            acceptedAtPhoneTime
        );

        const nextRequests = requests.filter(item => this._normalizeHostNameKey(item?.name || '') !== this._normalizeHostNameKey(safeName));
        this.saveHoneyFriendRequests(nextRequests);

        const friends = this.getHoneyFriends();
        const existingIndex = friends.findIndex(item => this._normalizeHostNameKey(item?.name || '') === this._normalizeHostNameKey(safeName));
        if (existingIndex >= 0) {
            friends[existingIndex] = {
                ...friends[existingIndex],
                avatarUrl: request.avatarUrl || friends[existingIndex].avatarUrl || '',
                message: request.message || friends[existingIndex].message || '',
                source: request.source || friends[existingIndex].source || '好友',
                sourceApp: request.sourceApp || friends[existingIndex].sourceApp || 'honey',
                sourceLabel: request.sourceLabel || friends[existingIndex].sourceLabel || '',
                requestType: request.requestType || friends[existingIndex].requestType || 'viewer',
                hostType: request.hostType || friends[existingIndex].hostType || '',
                acceptedAtPhoneTime,
                hiddenBackground: acceptedHiddenBackground
            };
            this.saveHoneyFriends(friends);
        } else {
            friends.push({
                name: request.name,
                avatarUrl: request.avatarUrl,
                message: request.message,
                source: request.source || '好友',
                sourceApp: request.sourceApp || 'honey',
                sourceLabel: request.sourceLabel || '',
                requestType: request.requestType || 'viewer',
                hostType: request.hostType || '',
                acceptedAtPhoneTime,
                hiddenBackground: acceptedHiddenBackground
            });
            this.saveHoneyFriends(friends);
        }

        return {
            ...request,
            acceptedAtPhoneTime,
            hiddenBackground: acceptedHiddenBackground
        };
    }

    _isHoneyHostFriendLike(item = {}) {
        const requestType = String(item?.requestType || '').trim().toLowerCase();
        const sourceLabel = String(item?.sourceLabel || '').trim();
        const source = String(item?.source || '').trim();
        if (requestType === 'host') return true;
        if (/主播|其他直播间|微信邀约/.test(`${sourceLabel} ${source}`)) return true;
        const nameKey = this._normalizeHostNameKey(item?.name || '');
        return !!nameKey && this.getFollowedHosts().some(host => this._normalizeHostNameKey(host?.name || '') === nameKey);
    }

    rejectHoneyFriendRequest(name) {
        const safeName = this._sanitizeInlineText(name || '', 24);
        if (!safeName) return [];
        const nextRequests = this.getHoneyFriendRequests()
            .filter(item => this._normalizeHostNameKey(item?.name || '') !== this._normalizeHostNameKey(safeName));
        this.saveHoneyFriendRequests(nextRequests);
        return nextRequests;
    }

    removeHoneyFriend(name, options = {}) {
        const safeName = this._sanitizeInlineText(name || '', 24);
        if (!safeName) return null;

        const currentFriends = this.getHoneyFriends();
        const targetKey = this._normalizeHostNameKey(safeName);
        const removedFriend = currentFriends.find(item => this._normalizeHostNameKey(item?.name || '') === targetKey) || null;
        if (!removedFriend) return null;
        this._markHoneyDeletedWechatContact(removedFriend.name || safeName, {
            sourceApp: removedFriend.sourceApp || 'honey',
            sourceLabel: removedFriend.sourceLabel || ''
        });

        const nextFriends = currentFriends.filter(item => this._normalizeHostNameKey(item?.name || '') !== targetKey);
        this.saveHoneyFriends(nextFriends);
        this.globalSocialStore?.removeAppContact?.('honey', this._getHoneyGlobalContactId(removedFriend));

        if (options?.skipWechatDelete !== true) {
            const wechatData = this._getWechatDataBridge();
            const linkedContact = wechatData.getContacts()
                .find(item => this._normalizeHostNameKey(item?.name || '') === targetKey);
            if (linkedContact?.id) {
                this._markHoneyDeletedWechatContact(removedFriend.name || safeName, {
                    contactId: linkedContact.id,
                    sourceApp: linkedContact.sourceApp || removedFriend.sourceApp || 'honey',
                    sourceLabel: linkedContact.sourceLabel || removedFriend.sourceLabel || ''
                });
                wechatData.deleteContactAndChat(linkedContact.id);
            }
        }

        return removedFriend;
    }

    _getWechatDataBridge() {
        if (window.VirtualPhone?.cachedWechatData instanceof WechatData) {
            if (window.VirtualPhone?.wechatApp && window.VirtualPhone.wechatApp.wechatData !== window.VirtualPhone.cachedWechatData) {
                window.VirtualPhone.wechatApp.wechatData = window.VirtualPhone.cachedWechatData;
            }
            return window.VirtualPhone.cachedWechatData;
        }

        if (window.VirtualPhone?.wechatApp?.wechatData instanceof WechatData) {
            window.VirtualPhone.cachedWechatData = window.VirtualPhone.wechatApp.wechatData;
            return window.VirtualPhone.wechatApp.wechatData;
        }

        const wechatData = new WechatData(this.storage);
        if (!window.VirtualPhone) window.VirtualPhone = {};
        window.VirtualPhone.cachedWechatData = wechatData;
        if (window.VirtualPhone.wechatApp) {
            window.VirtualPhone.wechatApp.wechatData = wechatData;
        }
        return wechatData;
    }

    ensureHoneyFriendWechatChat(nameOrFriend) {
        const targetName = this._sanitizeInlineText(
            typeof nameOrFriend === 'string' ? nameOrFriend : (nameOrFriend?.name || ''),
            24
        );
        const friend = (typeof nameOrFriend === 'object' && nameOrFriend)
            ? this._normalizeHoneySocialPerson(nameOrFriend, '好友')
            : this.getHoneyFriends().find(item => this._normalizeHostNameKey(item?.name || '') === this._normalizeHostNameKey(targetName));
        if (!friend) return null;
        if (this._isHoneyWechatContactDeleted(friend.name || targetName)) return null;

        const wechatData = this._getWechatDataBridge();
        const normalizedKey = this._normalizeWechatContactNameKey(friend.name || '');
        const contacts = wechatData.getContacts();
        let contact = contacts.find(item => this._normalizeWechatContactNameKey(item?.name || '') === normalizedKey) || null;
        const hiddenBackground = friend.hiddenBackground || this._buildHoneyFriendSecretFallback(friend);
        const isHostFriend = this._isHoneyHostFriendLike(friend);
        const relation = isHostFriend ? '蜜语主播' : '蜜语好友';
        const sourceLabel = isHostFriend ? '主播' : '蜜语';
        const honeyHostName = isHostFriend
            ? (this._sanitizeInlineText(friend.honeyHostName || friend.source || '', 40) || friend.name)
            : '';

        if (!contact) {
            const contactId = `contact_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
            contact = {
                id: contactId,
                name: friend.name,
                avatar: friend.avatarUrl || '👤',
                remark: '',
                letter: wechatData.getFirstLetter(friend.name),
                relation,
                sourceApp: 'honey',
                sourceLabel,
                honeyHostName,
                honeySource: friend.source || '直播间',
                honeyVisibleIntro: friend.message || '',
                honeyHiddenBackground: hiddenBackground
            };
            wechatData.addContact(contact);
            contact = wechatData.getContact(contactId) || contact;
        } else {
            const relationMarker = isHostFriend ? '主播' : '蜜语';
            const nextRelation = String(contact.relation || '').includes(relationMarker)
                ? contact.relation
                : (contact.relation ? `${contact.relation} / ${relation}` : relation);
            wechatData.updateContact(contact.id, {
                avatar: friend.avatarUrl || contact.avatar || '👤',
                relation: nextRelation,
                sourceApp: 'honey',
                sourceLabel,
                honeyHostName: honeyHostName || contact.honeyHostName || '',
                honeySource: friend.source || contact.honeySource || '直播间',
                honeyVisibleIntro: friend.message || contact.honeyVisibleIntro || '',
                honeyHiddenBackground: hiddenBackground || contact.honeyHiddenBackground || ''
            });
            contact = wechatData.getContact(contact.id) || {
                ...contact,
                avatar: friend.avatarUrl || contact.avatar || '👤',
                relation: nextRelation,
                sourceApp: 'honey',
                sourceLabel,
                honeyHostName: honeyHostName || contact.honeyHostName || '',
                honeySource: friend.source || contact.honeySource || '直播间',
                honeyVisibleIntro: friend.message || contact.honeyVisibleIntro || '',
                honeyHiddenBackground: hiddenBackground || contact.honeyHiddenBackground || ''
            };
        }

        let chat = wechatData.getChatByContactId(contact.id);
        if (!chat) {
            chat = wechatData.createChat({
                id: `chat_${contact.id}`,
                contactId: contact.id,
                name: contact.name,
                type: 'single',
                avatar: contact.avatar || '👤'
            });
        } else {
            chat.name = contact.name;
            chat.avatar = contact.avatar || chat.avatar || '👤';
            wechatData.saveData();
        }

        if (window.VirtualPhone?.wechatApp) {
            window.VirtualPhone.wechatApp.wechatData = wechatData;
            if (window.VirtualPhone.wechatApp.currentView === 'contacts' || window.VirtualPhone.wechatApp.currentChat?.contactId === contact.id) {
                window.VirtualPhone.wechatApp.render();
            }
        }

        this.globalSocialStore?.upsertContact?.({
            app: 'honey',
            appContactId: this._getHoneyGlobalContactId(friend),
            name: friend.name,
            avatar: friend.avatarUrl || '',
            relation,
            extra: {
                sourceApp: friend.sourceApp || 'honey',
                sourceLabel,
                honeyHostName,
                honeySource: friend.source || '',
                honeyVisibleIntro: friend.message || '',
                honeyHiddenBackground: hiddenBackground || '',
                acceptedAtPhoneTime: friend.acceptedAtPhoneTime || '',
                requestType: isHostFriend ? 'host' : (friend.requestType || 'viewer'),
                hostType: friend.hostType || '',
                honeyScope: 'friend'
            }
        });
        this.globalSocialStore?.upsertContact?.({
            app: 'wechat',
            appContactId: String(contact.id || ''),
            name: contact.name || friend.name,
            avatar: contact.avatar || friend.avatarUrl || '',
            relation: contact.relation || relation,
            extra: {
                sourceApp: 'honey',
                sourceLabel,
                honeyHostName,
                honeySource: friend.source || '',
                honeyVisibleIntro: friend.message || '',
                honeyHiddenBackground: hiddenBackground || ''
            }
        });

        return { friend, contact, chat, wechatData };
    }

    ensureHoneyAcceptedRequestWechatChat(nameOrFriend) {
        const accepted = (typeof nameOrFriend === 'object' && nameOrFriend)
            ? this._normalizeHoneySocialPerson(nameOrFriend, '好友')
            : this.getHoneyFriends().find(item => this._normalizeHostNameKey(item?.name || '') === this._normalizeHostNameKey(nameOrFriend));
        if (!accepted) return null;

        if (this._isHoneyHostFriendLike(accepted)) {
            if (this._isHoneyWechatContactDeleted(accepted.name || nameOrFriend) && typeof nameOrFriend !== 'object') return null;
            return this.ensureHoneyFriendWechatChat(accepted);
        }

        if (this._isHoneyWechatContactDeleted(accepted.name || nameOrFriend) && typeof nameOrFriend !== 'object') return null;
        return this.ensureHoneyFriendWechatChat(accepted);
    }

    _buildFollowedHostWechatBackground(host = {}, options = {}) {
        const hostName = this._sanitizeInlineText(host?.name || options?.hostName || '', 40) || '主播';
        const intro = this._sanitizeInlineText(host?.intro || options?.intro || '', 160);
        const title = this._sanitizeInlineText(host?.liveTitle || options?.title || `${hostName} 的直播间`, 60);
        const figure = this._sanitizeInlineText(host?.figure || '主播', 24);
        const favorability = this._clampFavorability(host?.favorability ?? host?.affection, null);
        const decisionMessage = this._sanitizeInlineText(options?.decisionMessage || options?.message || '', 180);
        const parts = [
            `${hostName} 是用户在蜜语关注的主播，已同意添加微信。`,
            `来源直播间：${title}`,
            `身份：${figure}`
        ];
        if (intro) parts.push(`请求加微信的申请留言：${intro}`);
        if (favorability !== null) parts.push(`当前好感度：${favorability}%`);
        return this._sanitizeHoneySecret(parts.join(' '), 260);
    }

    ensureFollowedHostWechatChat(hostNameOrHost, options = {}) {
        const inputHostName = typeof hostNameOrHost === 'string'
            ? hostNameOrHost
            : (hostNameOrHost?.name || hostNameOrHost?.hostName || '');
        const safeHostName = this._sanitizeInlineText(this._stripFollowStateSuffix(inputHostName || ''), 40);
        if (!safeHostName) return null;
        const safeContactName = this._sanitizeInlineText(options?.contactName || options?.wechatContactName || safeHostName, 40) || safeHostName;
        if (options?.forceRecreateWechat === true) {
            this._clearHoneyDeletedWechatContact(safeHostName);
            if (safeContactName !== safeHostName) this._clearHoneyDeletedWechatContact(safeContactName);
        } else if (this._isHoneyWechatContactDeleted(safeHostName) || this._isHoneyWechatContactDeleted(safeContactName)) {
            return null;
        }

        const list = this.getFollowedHosts();
        const hostKey = this._normalizeHostNameKey(safeHostName);
        const existingIndex = list.findIndex(item => this._normalizeHostNameKey(item?.name || '') === hostKey);
        const host = existingIndex >= 0
            ? { ...list[existingIndex] }
            : {
                ...(typeof hostNameOrHost === 'object' && hostNameOrHost ? hostNameOrHost : {}),
                name: safeHostName
            };
        const wechatData = this._getWechatDataBridge();
        const contacts = wechatData.getContacts();
        const contactNameKey = this._normalizeWechatContactNameKey(safeContactName);
        let contact = contacts.find(item => this._normalizeWechatContactNameKey(item?.name || '') === contactNameKey)
            || contacts.find(item => this._normalizeHostNameKey(this._resolveHoneyHostNameFromWechatContact(item)) === this._normalizeHostNameKey(safeHostName))
            || null;
        const avatar = String(options?.avatarUrl || host.avatarUrl || '').trim() || '👤';
        const hiddenBackground = this._buildFollowedHostWechatBackground(host, options);
        const visibleIntro = this._sanitizeInlineText(options?.message || options?.decisionMessage || `${safeHostName} 已同意添加微信。`, 120);
        const relation = '蜜语主播';

        if (!contact) {
            const contactId = `contact_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
            contact = {
                id: contactId,
                name: safeContactName,
                avatar,
                remark: '',
                letter: wechatData.getFirstLetter(safeContactName),
                relation,
                sourceApp: 'honey',
                sourceLabel: '主播',
                honeyHostName: safeHostName,
                honeySource: '关注主播',
                honeyVisibleIntro: visibleIntro,
                honeyHiddenBackground: hiddenBackground
            };
            wechatData.addContact(contact);
            contact = wechatData.getContact(contactId) || contact;
        } else {
            const nextRelation = String(contact.relation || '').includes('主播')
                ? contact.relation
                : (contact.relation ? `${contact.relation} / ${relation}` : relation);
            wechatData.updateContact(contact.id, {
                avatar: avatar || contact.avatar || '👤',
                relation: nextRelation,
                sourceApp: 'honey',
                sourceLabel: '主播',
                honeyHostName: contact.honeyHostName || safeHostName,
                honeySource: contact.honeySource || '关注主播',
                honeyVisibleIntro: visibleIntro || contact.honeyVisibleIntro || '',
                honeyHiddenBackground: hiddenBackground || contact.honeyHiddenBackground || ''
            });
            contact = wechatData.getContact(contact.id) || {
                ...contact,
                avatar: avatar || contact.avatar || '👤',
                relation: nextRelation,
                sourceApp: 'honey',
                sourceLabel: '主播',
                honeyHostName: contact.honeyHostName || safeHostName,
                honeySource: contact.honeySource || '关注主播',
                honeyVisibleIntro: visibleIntro || contact.honeyVisibleIntro || '',
                honeyHiddenBackground: hiddenBackground || contact.honeyHiddenBackground || ''
            };
        }

        let chat = wechatData.getChatByContactId(contact.id);
        if (!chat) {
            chat = wechatData.createChat({
                id: `chat_${contact.id}`,
                contactId: contact.id,
                name: contact.name,
                type: 'single',
                avatar: contact.avatar || '👤'
            });
        } else {
            chat.name = contact.name;
            chat.avatar = contact.avatar || chat.avatar || '👤';
            wechatData.saveData();
        }

        if (chat?.id && typeof wechatData.setHoneyHistoryInjectionForChat === 'function') {
            wechatData.setHoneyHistoryInjectionForChat(chat.id, true);
        }

        const hostPatch = {
            ...host,
            name: host.name || safeHostName,
            avatarUrl: avatar !== '👤' ? avatar : (host.avatarUrl || ''),
            figure: host.figure || '主播',
            sourceApp: 'honey',
            sourceLabel: '主播',
            wechatContactName: safeContactName,
            wechatContactId: String(contact.id || ''),
            wechatChatId: String(chat?.id || '')
        };
        if (existingIndex >= 0) {
            list[existingIndex] = { ...list[existingIndex], ...hostPatch };
        } else {
            list.push({
                ...hostPatch,
                ...this._normalizeHostNaiReference(hostPatch)
            });
        }
        this.saveFollowedHosts(list);

        if (window.VirtualPhone?.wechatApp) {
            window.VirtualPhone.wechatApp.wechatData = wechatData;
            if (window.VirtualPhone.wechatApp.currentView === 'contacts' || window.VirtualPhone.wechatApp.currentChat?.contactId === contact.id) {
                window.VirtualPhone.wechatApp.render();
            }
        }

        return { host: list.find(item => this._normalizeHostNameKey(item?.name || '') === hostKey) || hostPatch, contact, chat, wechatData };
    }

    _formatFollowedHostWechatFriendRequestContext(hostName, options = {}) {
        const safeHostName = this._sanitizeInlineText(this._stripFollowStateSuffix(hostName || ''), 40);
        if (!safeHostName) return '';
        const host = this.getFollowedHostByName(safeHostName) || {};
        const rawCurrentScene = (options?.currentScene && typeof options.currentScene === 'object') ? options.currentScene : null;
        const currentSceneHostKey = this._normalizeHostNameKey(this._stripFollowStateSuffix(rawCurrentScene?.host || ''));
        const currentScene = currentSceneHostKey && currentSceneHostKey === this._normalizeHostNameKey(safeHostName)
            ? rawCurrentScene
            : null;
        const historyMap = this.getHostHistory(safeHostName) || {};
        const historyScenes = Object.keys(historyMap)
            .filter(Boolean)
            .sort((a, b) => String(b).localeCompare(String(a)))
            .slice(0, 3)
            .map(date => ({ date, scene: historyMap[date] || {} }));
        const userName = this._sanitizeInlineText(this.getHoneyUserNickname?.() || '用户', 24) || '用户';
        const lines = [
            `【蜜语主播加微信判定】`,
            `主播：${safeHostName}`,
            `申请人：${userName}`,
            `用户正在申请把该主播添加到微信好友。请根据主播人设、关系进度、打赏记录和聊天历史判断是否同意。`
        ];
        if (host.figure) lines.push(`主播身份：${this._sanitizeInlineText(host.figure, 24)}`);
        if (host.liveTitle) lines.push(`直播间标题：${this._sanitizeInlineText(host.liveTitle, 60)}`);
        if (host.intro) lines.push(`主播简介：${this._sanitizeInlineText(host.intro, 180)}`);
        const favorability = this._clampFavorability(host.favorability ?? host.affection, null);
        if (favorability !== null) lines.push(`当前好感度：${favorability}%`);
        if (host.fans) lines.push(`粉丝量：${this._sanitizeInlineText(host.fans, 24)}`);

        const sceneContexts = currentScene
            ? [{ date: '当前直播', scene: currentScene }]
            : historyScenes;
        sceneContexts.slice(0, 4).forEach(({ date, scene }, idx) => {
            const title = this._sanitizeInlineText(scene?.title || '', 60);
            const desc = String(scene?.description || '')
                .replace(/\r/g, '')
                .split('\n')
                .map(line => String(line || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
                .filter(Boolean);
            const comments = (Array.isArray(scene?.comments) ? scene.comments : []).map(line => this._sanitizeInlineText(line, 120)).filter(Boolean).slice(-4);
            const gifts = (Array.isArray(scene?.gifts) ? scene.gifts : []).map(line => this._sanitizeInlineText(line, 100)).filter(Boolean).slice(-4);
            const userGiftRank = (scene?.userGiftRank && typeof scene.userGiftRank === 'object')
                ? `#${scene.userGiftRank.rank || '?'} ${this._sanitizeInlineText(scene.userGiftRank.name || userName, 24)} - ${this._sanitizeInlineText(scene.userGiftRank.coins || '', 20)}`
                : '';
            lines.push(`【互动片段${idx + 1}：${this._sanitizeInlineText(date, 20)}】`);
            if (title) lines.push(`标题：${title}`);
            if (userGiftRank) lines.push(`用户打赏记录：${userGiftRank}`);
            if (gifts.length > 0) lines.push(`打赏动态：${gifts.join(' / ')}`);
            if (comments.length > 0) lines.push(`评论互动：${comments.join(' / ')}`);
            if (desc.length > 0) lines.push(`直播正文：${desc.join(' / ')}`);
        });

        lines.push('输出格式只能二选一：');
        lines.push('[加微信]（接受）');
        lines.push('回复：用主播口吻给用户一句自然微信通过话术');
        lines.push('如果当前直播间/账号包含多个具体主播，接受时必须精确写明将进入微信通讯录的具体联系人名，以及所属主播账号/直播间名：');
        lines.push('[加微信]（接受｜联系人：具体角色名｜主播账号：当前直播间名或账号名）');
        lines.push('多人账号禁止只把账号名当联系人；联系人必须是具体角色名，主播账号必须保留当前直播间/账号名，用于后续映射直播历史。');
        lines.push('或');
        lines.push('[加微信]（拒绝）');
        lines.push('回复：用主播口吻给用户一句自然拒绝理由');
        return lines.join('\n');
    }

    _parseFollowedHostWechatDecisionMeta(status = '', fallbackHostName = '') {
        const safeFallbackHost = this._sanitizeInlineText(this._stripFollowStateSuffix(fallbackHostName || ''), 40);
        const raw = String(status || '').trim();
        const normalized = raw.replace(/[｜]/g, '|');
        const parts = normalized.split('|').map(item => item.trim()).filter(Boolean);
        let decisionText = parts.shift() || raw;
        let contactName = '';
        let hostName = '';

        parts.forEach((part) => {
            const match = part.match(/^(?:联系人|微信联系人|角色名|具体角色名|好友名|姓名|名字|contact|contactName|wechatContact|name)\s*[：:]\s*(.+)$/i);
            if (match) {
                contactName = this._sanitizeInlineText(match[1], 40);
                return;
            }
            const hostMatch = part.match(/^(?:主播账号|账号|直播间|直播间名|所属账号|host|hostName|source|account)\s*[：:]\s*(.+)$/i);
            if (hostMatch) {
                hostName = this._sanitizeInlineText(hostMatch[1], 40);
            }
        });

        const roleAccountMatch = decisionText.match(/^(接受|同意|通过|可以|yes|ok|accept)\s*[，,\s]*([^（(｜|]{1,40}?)[（(]\s*(?:主播账号|账号|直播间|频道)\s*[：:]\s*([^）)]{1,40})\s*[）)]$/i);
        if (roleAccountMatch) {
            decisionText = roleAccountMatch[1];
            contactName = contactName || this._sanitizeInlineText(roleAccountMatch[2], 40);
            hostName = hostName || this._sanitizeInlineText(roleAccountMatch[3], 40);
        }

        return {
            statusText: this._sanitizeInlineText(decisionText || raw, 40),
            contactName: contactName || safeFallbackHost,
            hostName: hostName || safeFallbackHost
        };
    }

    async requestFollowedHostWechatFriendDecision(hostName, options = {}) {
        const safeHostName = this._sanitizeInlineText(this._stripFollowStateSuffix(hostName || ''), 40);
        if (!safeHostName) throw new Error('主播名称为空');
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager) throw new Error('API Manager 未初始化');
        const contextText = this._formatFollowedHostWechatFriendRequestContext(safeHostName, options);
        const messages = [
            {
                role: 'system',
                content: '你是蜜语 APP 的主播好友申请判定器。你必须扮演当前主播本人，只能根据上下文判断是否同意加微信，并严格按指定标签输出。',
                isPhoneMessage: true
            },
            {
                role: 'user',
                content: contextText,
                isPhoneMessage: true
            }
        ];
        const context = this._getContext();
        const result = await apiManager.callAI(messages, {
            max_tokens: Math.min(
                Number.parseInt(context?.max_response_length, 10)
                    || Number.parseInt(context?.max_length, 10)
                    || Number.parseInt(context?.maxContextLength, 10)
                    || 1024,
                1600
            ),
            preserve_roles: false,
            appId: 'honey'
        });
        if (!result?.success) throw new Error(result?.error || 'AI 返回为空');
        const rawText = result.summary || result.content || result.text || '';
        const filteredText = applyPhoneTagFilter(rawText, { storage: this.storage }) || rawText;
        const statusMatch = String(filteredText || '').match(/[［\[]\s*加微信\s*[］\]]\s*[（(]\s*([^）)]*)\s*[）)]/i);
        const status = String(statusMatch?.[1] || '').trim();
        const meta = this._parseFollowedHostWechatDecisionMeta(status, safeHostName);
        const accepted = /接受|同意|通过|可以|yes|ok|accept/i.test(meta.statusText || status);
        const rejected = /拒绝|不接受|不同意|不通过|no|reject/i.test(meta.statusText || status);
        const replyMatch = String(filteredText || '').match(/回复\s*[：:]\s*([\s\S]*)/);
        const message = this._sanitizeInlineText(
            (replyMatch?.[1] || String(filteredText || '').replace(statusMatch?.[0] || '', '')).trim(),
            180
        );
        return {
            accepted: accepted && !rejected,
            rejected: rejected || (!accepted && !rejected),
            message: message || (accepted && !rejected ? '可以，加吧。' : '先不用加微信了。'),
            contactName: meta.contactName,
            hostName: meta.hostName,
            raw: filteredText,
            status: meta.statusText || status
        };
    }

    getHoneyCoinBalance() {
        const raw = this._getStored('honey_coin_balance', 0);
        const num = Number.parseFloat(raw);
        if (!Number.isFinite(num) || num < 0) return 0;
        return Math.floor(num);
    }

    setHoneyCoinBalance(amount) {
        const num = Number.parseFloat(amount);
        const safe = Number.isFinite(num) ? Math.max(0, Math.floor(num)) : 0;
        this._setStored('honey_coin_balance', safe);
        this._scheduleFlushChatPersistence();
        return safe;
    }

    updateHoneyCoinBalance(delta) {
        const current = this.getHoneyCoinBalance();
        const parsed = Number.parseFloat(delta);
        const next = Number.isFinite(parsed)
            ? Math.max(0, Math.floor(current + parsed))
            : current;
        this._setStored('honey_coin_balance', next);
        this._scheduleFlushChatPersistence();
        return next;
    }

    consumeHoneyCoins(amount) {
        const cost = Math.max(0, Math.floor(Number.parseFloat(amount) || 0));
        const balance = this.getHoneyCoinBalance();
        if (cost <= 0) {
            return { success: true, cost: 0, balanceBefore: balance, balanceAfter: balance };
        }
        if (balance < cost) {
            return { success: false, cost, balanceBefore: balance, balanceAfter: balance };
        }
        const next = this.setHoneyCoinBalance(balance - cost);
        return { success: true, cost, balanceBefore: balance, balanceAfter: next };
    }

    _getWechatDataForRecharge() {
        let wechatData = window.VirtualPhone?.wechatApp?.wechatData || window.VirtualPhone?.cachedWechatData;
        if (!wechatData) {
            try {
                wechatData = new WechatData(this.storage);
                if (window.VirtualPhone) window.VirtualPhone.cachedWechatData = wechatData;
            } catch (e) {
                console.error('[HoneyData] 微信数据库静默加载失败:', e);
                return null;
            }
        }
        return wechatData;
    }

    getWechatWalletBalanceForRecharge() {
        const wechatData = this._getWechatDataForRecharge();
        if (!wechatData || typeof wechatData.getWalletBalance !== 'function') {
            return { available: false, initialized: false, balance: 0 };
        }
        const raw = wechatData.getWalletBalance();
        if (raw === null || raw === undefined) {
            return { available: true, initialized: false, balance: 0 };
        }
        const num = Number.parseFloat(raw);
        if (!Number.isFinite(num) || num < 0) {
            return { available: true, initialized: false, balance: 0 };
        }
        return { available: true, initialized: true, balance: num };
    }

    rechargeHoneyCoinsFromWechat(yuanAmount) {
        const amountYuan = Number.parseFloat(yuanAmount);
        if (!Number.isFinite(amountYuan) || amountYuan <= 0) {
            return { success: false, reason: 'invalid_amount' };
        }

        const walletInfo = this.getWechatWalletBalanceForRecharge();
        if (!walletInfo.available) {
            return { success: false, reason: 'wechat_unavailable' };
        }
        if (!walletInfo.initialized) {
            return { success: false, reason: 'wallet_not_initialized' };
        }

        const safeAmountYuan = Math.round(amountYuan * 100) / 100;
        if (walletInfo.balance + 1e-9 < safeAmountYuan) {
            return {
                success: false,
                reason: 'wallet_insufficient',
                walletBalance: walletInfo.balance,
                amountYuan: safeAmountYuan
            };
        }

        const wechatData = this._getWechatDataForRecharge();
        wechatData?.updateWalletBalance?.(-safeAmountYuan);

        const coinGain = Math.max(1, Math.round(safeAmountYuan * 10));
        const balanceBefore = this.getHoneyCoinBalance();
        const balanceAfter = this.updateHoneyCoinBalance(coinGain);

        return {
            success: true,
            amountYuan: safeAmountYuan,
            coinGain,
            balanceBefore,
            balanceAfter
        };
    }

    withdrawHoneyCoinsToWechat(coinAmount) {
        const coins = Math.max(0, Math.floor(Number.parseFloat(coinAmount) || 0));
        if (coins <= 0) {
            return { success: false, reason: 'invalid_amount' };
        }

        const balanceBefore = this.getHoneyCoinBalance();
        if (balanceBefore < coins) {
            return {
                success: false,
                reason: 'coin_insufficient',
                balanceBefore,
                coinAmount: coins
            };
        }

        const walletInfo = this.getWechatWalletBalanceForRecharge();
        if (!walletInfo.available) {
            return { success: false, reason: 'wechat_unavailable' };
        }
        if (!walletInfo.initialized) {
            return { success: false, reason: 'wallet_not_initialized' };
        }

        const wechatData = this._getWechatDataForRecharge();
        if (!wechatData || typeof wechatData.updateWalletBalance !== 'function') {
            return { success: false, reason: 'wechat_unavailable' };
        }
        const amountYuan = Math.round((coins / 10) * 100) / 100;
        const balanceAfter = this.setHoneyCoinBalance(balanceBefore - coins);
        wechatData.updateWalletBalance(amountYuan);
        const walletAfterRaw = wechatData.getWalletBalance?.();
        const walletAfter = Number.isFinite(Number(walletAfterRaw)) ? Number(walletAfterRaw) : amountYuan;

        return {
            success: true,
            coinAmount: coins,
            amountYuan,
            balanceBefore,
            balanceAfter,
            walletAfter
        };
    }

    getFollowedHosts() {
        const parsed = this._readJSON('honey_followed_hosts', []);
        const sourceList = Array.isArray(parsed) ? parsed : [];
        let needsCleanup = false;
        const list = sourceList
            .map((item) => {
                if (!item || typeof item !== 'object') return null;
                const name = String(item.name || item.hostName || '').trim();
                if (!name) return null;
                if (this._isHoneyWechatContactDeleted(name)) return null;
                if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(String(item.naiReferenceImage || item.referenceImage || item.characterReferenceImage || '').trim())) {
                    needsCleanup = true;
                }
                return {
                    name,
                    avatarUrl: String(item.avatarUrl || '').trim(),
                    figure: String(item.figure || item.figureLabel || '魅魔').trim() || '魅魔',
                    boundVideoUrl: String(item.boundVideoUrl || '').trim(),
                    lastActiveAt: Number(item.lastActiveAt) || 0,
                    favorability: this._clampFavorability(item.favorability ?? item.affection, 0),
                    liveTitle: this._sanitizeInlineText(item.liveTitle || item.title || '', 40),
                    intro: this._sanitizeInlineText(item.intro || '', 120),
                    fans: this._sanitizeInlineText(item.fans || item.followers || '', 24),
                    sourceApp: String(item.sourceApp || '').trim(),
                    sourceLabel: String(item.sourceLabel || '').trim(),
                    wechatContactName: String(item.wechatContactName || '').trim(),
                    wechatContactId: String(item.wechatContactId || '').trim(),
                    wechatChatId: String(item.wechatChatId || '').trim(),
                    ...this._normalizeHostNaiReference(item)
                };
            })
            .filter(Boolean);
        if (needsCleanup) {
            try {
                this._setStored('honey_followed_hosts', JSON.stringify(list));
                this._scheduleFlushChatPersistence();
                console.warn('[HoneyData] 已清理关注主播里的旧版 base64 角色参考图，请重新上传参考图以使用固定角色功能');
            } catch (e) {}
        }
        return list;
    }

    saveFollowedHosts(list) {
        const safeList = Array.isArray(list)
            ? list
                .map((item) => {
                    if (!item || typeof item !== 'object') return null;
                    const name = String(item.name || item.hostName || '').trim();
                    if (!name) return null;
                    return {
                        name,
                        avatarUrl: String(item.avatarUrl || '').trim(),
                        figure: String(item.figure || item.figureLabel || '魅魔').trim() || '魅魔',
                        boundVideoUrl: String(item.boundVideoUrl || '').trim(),
                        lastActiveAt: Number(item.lastActiveAt) || 0,
                        favorability: this._clampFavorability(item.favorability ?? item.affection, 0),
                        liveTitle: this._sanitizeInlineText(item.liveTitle || item.title || '', 40),
                        intro: this._sanitizeInlineText(item.intro || '', 120),
                        fans: this._sanitizeInlineText(item.fans || item.followers || '', 24),
                        sourceApp: String(item.sourceApp || '').trim(),
                        sourceLabel: String(item.sourceLabel || '').trim(),
                        wechatContactName: String(item.wechatContactName || '').trim(),
                        wechatContactId: String(item.wechatContactId || '').trim(),
                        wechatChatId: String(item.wechatChatId || '').trim(),
                        ...this._normalizeHostNaiReference(item)
                    };
                })
                .filter(Boolean)
            : [];
        this._setStored('honey_followed_hosts', JSON.stringify(safeList));
        this._scheduleFlushChatPersistence();
    }

    toggleFollowHost(hostName, avatarUrl = '', options = {}) {
        const safeHostName = this._resolveFollowedHostNameFromScene(options?.scene || {}, hostName);
        if (!safeHostName) {
            return {
                followed: false,
                list: this.getFollowedHosts()
            };
        }

        const safeAvatarUrl = String(avatarUrl || '').trim();
        const list = this.getFollowedHosts();
        const hostKey = this._normalizeHostNameKey(safeHostName);
        const index = list.findIndex(item => this._normalizeHostNameKey(item?.name || item?.hostName || '') === hostKey);

        if (index >= 0) {
            const removedHost = list[index];
            list.splice(index, 1);
            this.saveFollowedHosts(list);
            this.clearHostRecords(removedHost?.name || safeHostName);
            return { followed: false, list };
        }

        this._clearHoneyDeletedWechatContact(safeHostName);
        list.push({
            name: safeHostName,
            avatarUrl: safeAvatarUrl,
            figure: '魅魔',
            boundVideoUrl: '',
            lastActiveAt: 0,
            favorability: 0,
            liveTitle: this._sanitizeInlineText(options?.liveTitle || options?.scene?._topicTitle || options?.scene?.title || `${safeHostName} 的直播间`, 40),
            intro: this._sanitizeInlineText(options?.intro || options?.scene?.intro || '', 120),
            fans: this._sanitizeInlineText(options?.fans || options?.scene?.fans || '', 24),
            ...this._normalizeHostNaiReference({})
        });
        this.saveFollowedHosts(list);
        return { followed: true, list };
    }

    ensureFollowedHostFromWechat(contactName, options = {}) {
        const safeContactName = this._sanitizeInlineText(contactName || '', 40);
        if (!safeContactName) return null;
        const wechatData = this._getWechatDataBridge();
        const contact = wechatData.getContactByName(safeContactName)
            || (wechatData.getContacts?.() || []).find(item => this._normalizeHostNameKey(this._resolveHoneyHostNameFromWechatContact(item)) === this._normalizeHostNameKey(safeContactName));
        const safeHostName = this._resolveHoneyHostNameFromWechatContact(contact || {}, options?.hostName || safeContactName);
        if (!safeHostName) return null;
        const chat = contact?.id ? wechatData.getChatByContactId(contact.id) : null;
        const avatarUrl = String(options?.avatarUrl || contact?.avatar || chat?.avatar || '').trim();
        const title = this._sanitizeInlineText(options?.title || `${safeHostName} 的直播间`, 40);
        const intro = this._sanitizeInlineText(options?.intro || '微信好友发来的蜜语直播邀约。', 120);
        const list = this.getFollowedHosts();
        const key = this._normalizeHostNameKey(safeHostName);
        const existingIndex = list.findIndex(item => this._normalizeHostNameKey(item?.name || '') === key);
        const existingHost = existingIndex >= 0 ? list[existingIndex] : null;
        const existingAvatarUrl = String(existingHost?.avatarUrl || '').trim();
        const nextAvatarUrl = existingAvatarUrl || avatarUrl;
        const patch = {
            name: existingIndex >= 0 ? list[existingIndex].name : safeHostName,
            avatarUrl: nextAvatarUrl,
            figure: existingIndex >= 0 ? list[existingIndex].figure : '微信好友',
            boundVideoUrl: existingIndex >= 0 ? list[existingIndex].boundVideoUrl : '',
            lastActiveAt: Date.now(),
            favorability: existingIndex >= 0 ? list[existingIndex].favorability : 0,
            liveTitle: title || (existingIndex >= 0 ? list[existingIndex].liveTitle : `${safeHostName} 的直播间`),
            intro: intro || (existingIndex >= 0 ? list[existingIndex].intro : ''),
            fans: existingIndex >= 0 ? list[existingIndex].fans : '',
            sourceApp: 'wechat',
            sourceLabel: '微信邀约',
            wechatContactName: safeContactName,
            wechatContactId: String(contact?.id || ''),
            wechatChatId: String(chat?.id || '')
        };

        if (existingIndex >= 0) {
            list[existingIndex] = { ...list[existingIndex], ...patch };
        } else {
            list.push({
                ...patch,
                ...this._normalizeHostNaiReference({})
            });
        }
        this.saveFollowedHosts(list);
        if (chat?.id && typeof wechatData.setHoneyHistoryInjectionForChat === 'function') {
            wechatData.setHoneyHistoryInjectionForChat(chat.id, true);
        }
        return list.find(item => this._normalizeHostNameKey(item?.name || '') === key) || patch;
    }

    buildWechatHistoryContextForHoneyHost(hostName, limit = 20) {
        const safeHostName = this._sanitizeInlineText(hostName || '', 40);
        if (!safeHostName) return '';
        const wechatData = this._getWechatDataBridge();
        const contact = wechatData.getContactByName(safeHostName)
            || (wechatData.getContacts?.() || []).find(item => this._normalizeHostNameKey(this._resolveHoneyHostNameFromWechatContact(item)) === this._normalizeHostNameKey(safeHostName));
        const chat = contact?.id
            ? wechatData.getChatByContactId(contact.id)
            : wechatData.getChatList().find(item => item.type !== 'group' && this._normalizeHostNameKey(item.name || '') === this._normalizeHostNameKey(safeHostName));
        if (!chat?.id) return '';
        const enabled = typeof wechatData.isHoneyHistoryInjectionEnabledForChat === 'function'
            ? wechatData.isHoneyHistoryInjectionEnabledForChat(chat.id)
            : false;
        if (!enabled) return '';
        const userInfo = wechatData.getUserInfo?.() || {};
        const userName = this._sanitizeInlineText(userInfo.name || '用户', 24) || '用户';
        const messages = (wechatData.getMessages(chat.id) || [])
            .filter(msg => msg && String(msg.content || msg.voiceText || msg.imagePrompt || '').trim())
            .slice(-Math.max(1, Math.min(80, Number.parseInt(String(limit || 20), 10) || 20)));
        if (messages.length === 0) return '';
        const lines = messages.map((msg) => {
            const speaker = msg.from === 'me' ? userName : (this._sanitizeInlineText(msg.from || chat.name || safeHostName, 24) || safeHostName);
            let content = String(msg.content || '').trim();
            if (msg.type === 'voice') content = `[语音]${String(msg.voiceText || content).trim()}`;
            else if (msg.type === 'image_prompt') content = `[图片]${String(msg.imagePrompt || content).trim()}`;
            else if (msg.type === 'sticker') content = `[表情包]${String(msg.keyword || content).trim()}`;
            else if (msg.type && msg.type !== 'text') content = `[${msg.type}]${content}`;
            return `[${msg.date || ''} ${msg.time || ''}] ${speaker}: ${content}`.replace(/\s+\]/, ']');
        });
        return [
            `【微信聊天记录注入：${safeHostName}】`,
            '该主播也是用户微信好友。以下微信记录会影响本轮蜜语直播互动，但不要逐字复述。',
            ...lines
        ].join('\n');
    }

    removeFollowedHost(hostName) {
        const safeHostName = String(hostName || '').trim();
        const currentList = this.getFollowedHosts();
        if (!safeHostName) {
            return {
                removedHost: null,
                list: currentList
            };
        }
        const hostKey = this._normalizeHostNameKey(safeHostName);
        const removedHost = currentList.find(item => this._normalizeHostNameKey(item?.name || item?.hostName || '') === hostKey) || null;
        const list = currentList.filter(item => this._normalizeHostNameKey(item?.name || item?.hostName || '') !== hostKey);
        this.saveFollowedHosts(list);
        this.clearHostRecords(removedHost?.name || safeHostName);
        return {
            removedHost,
            list
        };
    }

    updateFollowedHost(hostName, patch = {}) {
        const safeHostName = String(hostName || '').trim();
        if (!safeHostName || !patch || typeof patch !== 'object') return null;

        const list = this.getFollowedHosts();
        const hostKey = this._normalizeHostNameKey(safeHostName);
        const idx = list.findIndex(item => this._normalizeHostNameKey(item?.name || item?.hostName || '') === hostKey);
        if (idx < 0) return null;

        list[idx] = {
            ...list[idx],
            ...patch,
            name: safeHostName,
            avatarUrl: String((patch.avatarUrl ?? list[idx].avatarUrl) || '').trim(),
            figure: String((patch.figure ?? list[idx].figure) || '魅魔').trim() || '魅魔',
            boundVideoUrl: String((patch.boundVideoUrl ?? list[idx].boundVideoUrl) || '').trim(),
            lastActiveAt: Number(patch.lastActiveAt ?? list[idx].lastActiveAt) || 0,
            favorability: this._clampFavorability(patch.favorability ?? patch.affection ?? list[idx].favorability, 0),
            liveTitle: this._sanitizeInlineText(patch.liveTitle ?? patch.title ?? list[idx].liveTitle, 40),
            intro: this._sanitizeInlineText(patch.intro ?? list[idx].intro, 120),
            fans: this._sanitizeInlineText(patch.fans ?? patch.followers ?? list[idx].fans, 24),
            sourceApp: String((patch.sourceApp ?? list[idx].sourceApp) || '').trim(),
            sourceLabel: String((patch.sourceLabel ?? list[idx].sourceLabel) || '').trim(),
            wechatContactId: String((patch.wechatContactId ?? list[idx].wechatContactId) || '').trim(),
            wechatChatId: String((patch.wechatChatId ?? list[idx].wechatChatId) || '').trim(),
            ...this._normalizeHostNaiReference({
                ...list[idx],
                ...patch
            })
        };
        this.saveFollowedHosts(list);
        return list[idx];
    }

    getFollowedHostByName(hostName) {
        const safeHostName = String(hostName || '').trim();
        if (!safeHostName) return null;
        const normalize = (name) => this._stripFollowStateSuffix(name).replace(/\s+/g, '').trim().toLowerCase();
        const safeKey = normalize(safeHostName);
        if (!safeKey) return null;
        return this.getFollowedHosts().find(item => normalize(item?.name) === safeKey) || null;
    }

    getHostNaiReference(hostName) {
        const host = this.getFollowedHostByName(hostName);
        if (!host?.naiReferenceImage || !host.naiReferenceEnabled) return null;
        const normalized = this._normalizeHostNaiReference(host);
        if (!normalized.naiReferenceImage || !normalized.naiReferenceEnabled) return null;
        return {
            image: normalized.naiReferenceImage,
            strength: normalized.naiReferenceStrength,
            informationExtracted: normalized.naiReferenceInformationExtracted
        };
    }

    updateFollowedHostNaiReference(hostName, patch = {}) {
        const current = this.getFollowedHostByName(hostName);
        if (!current) return null;
        const normalized = this._normalizeHostNaiReference({
            ...current,
            ...patch
        });
        return this.updateFollowedHost(current.name, normalized);
    }

    bindHostVideo(hostName, videoUrl = '') {
        return this.updateFollowedHost(hostName, {
            boundVideoUrl: String(videoUrl || '').trim()
        });
    }

    markHostActive(hostName, timestamp = Date.now()) {
        return this.updateFollowedHost(hostName, {
            lastActiveAt: Number(timestamp) || Date.now()
        });
    }

    _hostHistoryStorageKey(hostName) {
        const safeHostName = String(hostName || '').trim().toLowerCase();
        if (!safeHostName) return '';
        return `honey_history_${this._simpleHash(safeHostName)}`;
    }

    _normalizeHostNameForMatch(hostName = '') {
        return this._stripFollowStateSuffix(hostName)
            .replace(/\s+/g, '')
            .trim()
            .toLowerCase();
    }

    _clearHostRelatedSceneCache(hostName) {
        const hostKey = this._normalizeHostNameForMatch(hostName);
        if (!hostKey) return;

        const scenes = this.getTopicScenes();
        let scenesChanged = false;
        Object.keys(scenes || {}).forEach((sceneKey) => {
            const scene = scenes?.[sceneKey];
            if (!scene || typeof scene !== 'object') return;
            const sceneHostKey = this._normalizeHostNameForMatch(scene.host || '');
            if (!sceneHostKey || sceneHostKey !== hostKey) return;
            delete scenes[sceneKey];
            scenesChanged = true;
        });
        if (scenesChanged) {
            this.saveTopicScenes(scenes);
        }

        const lastScene = this.getLastSceneData();
        const lastHostKey = this._normalizeHostNameForMatch(lastScene?.host || '');
        if (lastScene && lastHostKey && lastHostKey === hostKey) {
            this._lastSceneCache = null;
            this._removeStored('honey_last_scene');
            this._scheduleFlushChatPersistence();
        }
    }

    clearHostRecords(hostName) {
        const safeHostName = String(hostName || '').trim();
        if (!safeHostName) return;

        const historyKey = this._hostHistoryStorageKey(safeHostName);
        if (historyKey) {
            this._removeStored(historyKey);
        }
        this._clearHostRelatedSceneCache(safeHostName);
        this._clearFollowedHostGlobalRecord(safeHostName);
    }

    _clearFollowedHostGlobalRecord(hostName = '') {
        const safeHostName = String(hostName || '').trim();
        const hostKey = this._normalizeHostNameKey(safeHostName);
        if (!hostKey) return 0;
        const appContactId = this._getHoneyGlobalContactId({ name: safeHostName });

        return this.globalSocialStore?.removeAppContactsByPredicate?.('honey', (entry) => {
            const entryNameKey = this._normalizeHostNameKey(entry?.name || '');
            const entryHostKey = this._normalizeHostNameKey(entry?.extra?.honeyHostName || '');
            const entryAppContactId = String(entry?.appContactId || '').trim();
            const scope = String(entry?.extra?.honeyScope || '').trim().toLowerCase();
            return scope === 'followed_host' && (
                entryNameKey === hostKey
                || entryHostKey === hostKey
                || (!!appContactId && entryAppContactId === appContactId)
            );
        }) || 0;
    }

    _normalizeSceneDate(dateStr = '') {
        const raw = String(dateStr || '').trim();
        const fallback = new Date();
        const fallbackKey = `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}-${String(fallback.getDate()).padStart(2, '0')}`;
        if (!raw) return fallbackKey;

        const digits = raw.match(/\d+/g) || [];
        if (digits.length >= 3) {
            const y = digits[0].padStart(4, '0').slice(-4);
            const m = digits[1].padStart(2, '0').slice(-2);
            const d = digits[2].padStart(2, '0').slice(-2);
            return `${y}-${m}-${d}`;
        }
        return fallbackKey;
    }

    _deepCloneSceneData(sceneData) {
        try {
            return JSON.parse(JSON.stringify(sceneData || {}));
        } catch (e) {
            return { ...(sceneData || {}) };
        }
    }

    _stripInlineGeneratedImagesFromScene(scene = {}) {
        if (!scene || typeof scene !== 'object') return scene;
        const next = { ...scene };
        ['naiImageUrl', 'generatedImageUrl', 'imageUrl'].forEach((key) => {
            if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(String(next[key] || '').trim())) {
                next[key] = '';
            }
        });
        return next;
    }

    _trimText(value, maxLen = 500) {
        return String(value || '').trim().slice(0, Math.max(0, Number(maxLen) || 0));
    }

    _compactStoredScene(scene = {}, options = {}) {
        if (!scene || typeof scene !== 'object') return {};
        const full = options.full === true;
        const preservePromptTurnLength = options.preservePromptTurnLength === true;
        const next = this._stripInlineGeneratedImagesFromScene(this._deepCloneSceneData(scene));
        const keepArray = (value, max, itemMax = 180, options = {}) => (Array.isArray(value) ? value : [])
            .map(item => {
                if (typeof item === 'string') return options.preserveLength ? String(item || '').trim() : this._trimText(item, itemMax);
                if (item && typeof item === 'object') {
                    const compact = {};
                    Object.entries(item).forEach(([key, val]) => {
                        if (typeof val === 'string') compact[key] = options.preserveLength ? String(val || '').trim() : this._trimText(val, itemMax);
                        else if (typeof val === 'number' || typeof val === 'boolean') compact[key] = val;
                    });
                    return compact;
                }
                return '';
            })
            .filter(item => typeof item === 'string' ? !!item : Object.keys(item || {}).length > 0)
            .slice(options.preserveLength ? 0 : -Math.max(0, Number(max) || 0));

        next.title = this._trimText(next.title, 80);
        next.host = this._trimText(next.host, 50);
        next.intro = this._trimText(next.intro, full ? 220 : 140);
        next.description = preservePromptTurnLength ? String(next.description || '').trim() : this._trimText(next.description, full ? 1200 : 520);
        next.naiPrompt = this._trimText(next.naiPrompt, 900);
        next.imageGenerationPrompt = this._trimText(next.imageGenerationPrompt, 900);
        next.comments = keepArray(next.comments, full ? this.maxStoredComments : 12, 180, { preserveLength: preservePromptTurnLength });
        next.gifts = keepArray(next.gifts, full ? this.maxStoredGifts : 10, 160, { preserveLength: preservePromptTurnLength });
        next.userChats = keepArray(next.userChats, full ? 60 : 16, 180);
        next.promptTurns = this._normalizeContinuePromptTurns(next.promptTurns, this.maxStoredPromptTurns, { preserveLength: preservePromptTurnLength })
            .slice(-(full || preservePromptTurnLength ? this.maxStoredPromptTurns : 12))
            .map(turn => ({
                userMessage: preservePromptTurnLength ? String(turn.userMessage || '').trim() : this._trimText(turn.userMessage, 220),
                assistantContext: preservePromptTurnLength ? String(turn.assistantContext || '').trim() : this._trimText(turn.assistantContext, full ? 900 : 420),
                responseContext: preservePromptTurnLength ? String(turn.responseContext || '').trim() : this._trimText(turn.responseContext, full ? 1600 : 520)
            }))
            .filter(turn => turn.userMessage || turn.assistantContext || turn.responseContext);
        next.naiTagHistory = keepArray(next.naiTagHistory, 8, 500);
        next.friendRequests = keepArray(next.friendRequests, 8, 160);
        next.collabRequests = keepArray(next.collabRequests, 8, 160);
        next.interactionRecords = keepArray(next.interactionRecords, 12, 180);

        if (next.audienceGiftTotals && typeof next.audienceGiftTotals === 'object') {
            next.audienceGiftTotals = Object.fromEntries(
                Object.entries(next.audienceGiftTotals)
                    .slice(-30)
                    .map(([key, val]) => [this._trimText(key, 32), Math.max(0, Number(val) || 0)])
                    .filter(([key]) => !!key)
            );
        }

        return next;
    }

    _compactTopicScenes(scenes = {}) {
        const source = scenes && typeof scenes === 'object' ? scenes : {};
        const entries = Object.entries(source)
            .filter(([, scene]) => scene && typeof scene === 'object')
            .map(([key, scene], index) => {
                const timestamp = Number(scene.updatedAt || scene.imageGenerationStartedAt || scene.lastActiveAt || scene.createdAt || 0) || index;
                return [key, this._compactStoredScene(scene, {
                    full: true,
                    preservePromptTurnLength: this._isFollowedHostScene(scene)
                }), timestamp];
            })
            .sort((a, b) => b[2] - a[2])
            .slice(0, this.maxStoredTopicScenes);
        return Object.fromEntries(entries.map(([key, scene]) => [key, scene]));
    }

    _compactHostHistory(history = {}) {
        const source = history && typeof history === 'object' ? history : {};
        const summary = source._summary && typeof source._summary === 'object'
            ? {
                text: String(source._summary.text || '').trim(),
                coveredTurnHashes: Array.isArray(source._summary.coveredTurnHashes)
                    ? source._summary.coveredTurnHashes.map(item => String(item || '').trim()).filter(Boolean).slice(-240)
                    : [],
                updatedAt: Number(source._summary.updatedAt || 0) || 0,
                storyTime: source._summary.storyTime && typeof source._summary.storyTime === 'object'
                    ? {
                        time: String(source._summary.storyTime.time || '').trim(),
                        date: String(source._summary.storyTime.date || '').trim(),
                        weekday: String(source._summary.storyTime.weekday || '').trim(),
                        timestamp: Number(source._summary.storyTime.timestamp || 0) || 0
                    }
                    : null
            }
            : null;
        const dayEntries = Object.keys(source)
            .filter(key => key && !String(key).startsWith('_'))
            .sort((a, b) => String(b).localeCompare(String(a)))
            .slice(0, this.maxStoredHostHistoryDays)
            .map(dateKey => [dateKey, this._compactStoredScene(source[dateKey], { full: true, preservePromptTurnLength: true })]);
        const next = Object.fromEntries(dayEntries);
        if (summary && (summary.text || summary.coveredTurnHashes.length)) next._summary = summary;
        return next;
    }

    getHostHistory(hostName) {
        const key = this._hostHistoryStorageKey(hostName);
        if (!key) return {};
        const parsed = this._readJSON(key, {});
        return parsed && typeof parsed === 'object' ? parsed : {};
    }

    getHostHistorySummary(hostName) {
        const history = this.getHostHistory(hostName);
        const summary = history?._summary && typeof history._summary === 'object' ? history._summary : {};
        return {
            text: String(summary.text || '').trim(),
            coveredTurnHashes: Array.isArray(summary.coveredTurnHashes) ? summary.coveredTurnHashes.map(item => String(item || '')).filter(Boolean) : [],
            updatedAt: Number(summary.updatedAt || 0) || 0,
            storyTime: summary.storyTime && typeof summary.storyTime === 'object'
                ? {
                    time: String(summary.storyTime.time || '').trim(),
                    date: String(summary.storyTime.date || '').trim(),
                    weekday: String(summary.storyTime.weekday || '').trim(),
                    timestamp: Number(summary.storyTime.timestamp || 0) || 0
                }
                : null
        };
    }

    formatHostHistorySummaryForContext(summary = {}) {
        const text = String(summary?.text || '').trim();
        if (!text) return '';
        const storyTime = summary?.storyTime && typeof summary.storyTime === 'object' ? summary.storyTime : null;
        const date = String(storyTime?.date || '').trim();
        const weekday = String(storyTime?.weekday || '').trim();
        const time = String(storyTime?.time || '').trim();
        const timeText = [date, weekday, time].filter(Boolean).join(' ');
        return timeText ? `【总结时间】${timeText}\n${text}` : text;
    }

    clearHostHistorySummary(hostName) {
        const safeHostName = this._sanitizeInlineText(hostName || '', 40);
        const key = this._hostHistoryStorageKey(safeHostName);
        if (!key) return false;
        const history = this.getHostHistory(safeHostName);
        if (!history?._summary) return false;
        delete history._summary;
        this._setStored(key, JSON.stringify(this._compactHostHistory(history)));
        this._scheduleFlushChatPersistence();
        return true;
    }

    clearSummarizedHostHistoryTurns(hostName) {
        const safeHostName = this._sanitizeInlineText(hostName || '', 40);
        const key = this._hostHistoryStorageKey(safeHostName);
        if (!key) return { removed: 0 };
        const history = this.getHostHistory(safeHostName);
        const summary = this.getHostHistorySummary(safeHostName);
        const covered = new Set(summary.coveredTurnHashes);
        if (!covered.size) return { removed: 0 };

        let removed = 0;
        Object.keys(history)
            .filter(dateKey => dateKey && !String(dateKey).startsWith('_'))
            .forEach(dateKey => {
                const dayScene = history[dateKey];
                const turns = this._normalizeContinuePromptTurns(dayScene?.promptTurns, this.maxStoredPromptTurns, { preserveLength: true });
                if (!turns.length) return;
                const keptTurns = turns.filter(turn => {
                    const hash = this._simpleHash(String(dateKey) + String(turn.assistantContext || '') + String(turn.userMessage || ''));
                    const shouldRemove = covered.has(hash);
                    if (shouldRemove) removed += 1;
                    return !shouldRemove;
                });
                if (keptTurns.length) {
                    history[dateKey] = {
                        ...dayScene,
                        promptTurns: keptTurns
                    };
                } else {
                    delete history[dateKey];
                }
            });

        if (removed > 0) {
            this._setStored(key, JSON.stringify(this._compactHostHistory(history)));
            this._scheduleFlushChatPersistence();
        }
        return { removed };
    }

    _collectUnsummarizedHostHistoryTurns(hostName) {
        const history = this.getHostHistory(hostName);
        const summary = this.getHostHistorySummary(hostName);
        const covered = new Set(summary.coveredTurnHashes);
        const turns = [];
        Object.keys(history)
            .filter(key => key && !String(key).startsWith('_'))
            .sort((a, b) => String(a).localeCompare(String(b)))
            .forEach(dateKey => {
                const dayScene = history[dateKey];
                const dayTurns = this._normalizeContinuePromptTurns(dayScene?.promptTurns, this.maxStoredPromptTurns, { preserveLength: true });
                dayTurns.forEach(turn => {
                    const hash = this._simpleHash(String(dateKey) + String(turn.assistantContext || '') + String(turn.userMessage || ''));
                    if (!hash || covered.has(hash)) return;
                    turns.push({
                        hash,
                        date: dateKey,
                        userMessage: String(turn.userMessage || '').trim(),
                        assistantContext: String(turn.responseContext || turn.assistantContext || '').trim()
                    });
                });
            });
        return { history, summary, turns };
    }

    async summarizeHostHistory(hostName) {
        const safeHostName = this._sanitizeInlineText(hostName || '', 40);
        if (!safeHostName) throw new Error('主播名称为空');
        const { history, summary, turns } = this._collectUnsummarizedHostHistoryTurns(safeHostName);
        if (!turns.length) return { changed: false, summary };

        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager) throw new Error('API Manager 未初始化');
        const selectedTurns = turns.slice(0, 60);
        const messages = [
            {
                role: 'system',
                content: [
                    '【角色设定与任务目标】',
                    '你是一个绝对客观的“虚拟直播间 RP（角色扮演）历史档案记录员”。你的唯一任务是：基于提供的直播间上下文，从头到尾、事无巨细地梳理并总结历史剧情与互动细节。你必须严格遵守以下最高级禁令与基础原则，任何违反将导致生成内容被直接废弃。',
                    '【最高级禁令：严禁主观臆断与抽象描述】',
                    '绝对禁止心理分析：严禁使用"宣示主权"、"宣示占有欲"、"占有欲爆发"、"作为猎手/猎物的计划"、"试图控制"等涉及心理动机、潜意识或社会学定义的词汇。',
                    '绝对禁止抽象定性：严禁使用"暧昧的气氛"、"微妙的张力"、"权力的博弈"等文学性修饰。',
                    '必须只记录客观行为：',
                    '错误示例："A向B宣示主权"',
                    '正确示例："A搂住B的腰，并对C说B是他的女友"',
                    '错误示例："A像猎手一样盯着猎物"',
                    '正确示例："A长时间注视B，没有眨眼，并在B移动时紧随其后"',
                    '拒绝“言语”概括，必须记录内容：',
                    '严禁使用“言语挑衅”、“出言不逊”、“言语安抚”、“进行诱导”等行为标签来代替对话。必须概括说话的核心信息或具体意图。',
                    '错误示例：“A用言语挑衅B”',
                    '正确示例：“A嘲讽B实际上是私生子”或“A威胁要公开B是私生子的秘密”',
                    '错误示例：“A出言安抚B”',
                    '正确示例：“A承诺会解决债务问题”',
                    '【基础原则与信息筛选】',
                    '绝对客观：严禁使用主观、情绪化或心理描写的词汇，仅记录事实、行为及过程与结果。',
                    '过去式表达：所有记录必须使用过去式（如"达成了"、"接管了"、"导致了"、"答应了"）。',
                    '全程覆盖，不得遗漏：必须按照时间顺序，从头到尾梳理上下文，不得跳跃或省略关键的时间节点。',
                    '有效信息筛选与强制保留：',
                    '忽略无剧情推动作用的流水账（如单纯的菜单描述、普通起居、无意义的口水话弹幕）。',
                    '强制保留约定：若在主播与NPC、主播与观众（弹幕/打赏）的交互中达成了【口头承诺】、【交易约定】或设定了【具体条件】（即使发生在闲聊场景），必须完整记录约定的具体内容（如"A答应了观众完成XX挑战以换取XX"）。',
                    '强制保留冲突：详细记录关键冲突、重要决策或剧烈的情感波动的客观表现（如"A摔碎了杯子"、"B拒绝了A的提案"）。',
                    '杜绝重复：同一事件只记录一次。若同一个剧情同时涉及主播、NPC、观众弹幕或打赏，应整合进同一段连续叙述中。',
                    '【直播间特殊互动记录规则】',
                    '弹幕与观众互动：将“弹幕/观众”视为一个客观存在的群体或个体。若弹幕的发言或打赏直接触发了剧情、改变了角色决定或达成了交易，必须记录其客观内容。',
                    '错误示例：“观众起哄让A惩罚B”',
                    '正确示例：“多条弹幕要求A打B一巴掌，A随后执行了该动作”',
                    '【输出格式要求（最高优先级约束）】',
                    '纯文本格式：严禁使用任何 Markdown 列表符（如 -、*、#、1. 2. 3. 等），严禁使用加粗（**）。',
                    '输出必须是一份连贯的剧情总结，按时间顺序把直播正文、打赏、评论触发的互动整合为连续剧情。',
                    '段落分隔：可按剧情阶段自然分段，每段之间仅用一个换行符分隔。',
                    '请基于以上所有规则，对以下直播间历史上下文进行全面总结：',
                    '必须只返回 <蜜语记录总结> 标签包裹内容。',
                    `【主播】${safeHostName}`,
                    summary.text ? `【已有摘要】\n${summary.text}` : '【已有摘要】暂无'
                ].join('\n'),
                isPhoneMessage: true
            }
        ];
        let lastHistoryMessage = null;
        selectedTurns.forEach((turn) => {
            const assistantContext = String(turn.assistantContext || '').trim();
            const userMessage = String(turn.userMessage || '').trim();
            if (userMessage) {
                lastHistoryMessage = {
                    role: 'user',
                    content: [`【日期】${turn.date}`, userMessage].filter(Boolean).join('\n'),
                    isPhoneMessage: true
                };
                messages.push(lastHistoryMessage);
            }
            if (assistantContext) {
                lastHistoryMessage = {
                    role: 'assistant',
                    content: assistantContext,
                    isPhoneMessage: true
                };
                messages.push(lastHistoryMessage);
            }
        });

        const summaryInstruction = [
            '结束历史剧情，开始按照总结提示词总结以上直播间历史上下文。',
            '仅输出 <蜜语记录总结> 标签包裹的总结内容。'
        ].join('\n');
        if (lastHistoryMessage?.role === 'user') {
            lastHistoryMessage.content = `${lastHistoryMessage.content}\n\n${summaryInstruction}`;
        } else {
            messages.push({
                role: 'user',
                content: summaryInstruction,
                isPhoneMessage: true
            });
        }

        const timeoutMs = 90000;
        let timeoutId = null;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('蜜语记录总结超时，请重试')), timeoutMs);
        });
        const context = this._getContext();
        const result = await Promise.race([
            apiManager.callAI(messages, {
                max_tokens: Number.parseInt(context?.max_response_length, 10)
                    || Number.parseInt(context?.max_length, 10)
                    || Number.parseInt(context?.maxContextLength, 10)
                    || 8192,
                preserve_roles: true,
                appId: 'honey'
            }),
            timeoutPromise
        ]).finally(() => {
            if (timeoutId) clearTimeout(timeoutId);
        });
        if (!result?.success) throw new Error(result?.error || 'AI 返回为空');

        const rawText = String(result.summary || result.content || result.text || '').trim();
        const tagged = rawText.match(/<蜜语记录总结>([\s\S]*?)<\/蜜语记录总结>/)?.[1] || rawText;
        const nextText = String(tagged || '').replace(/<[^>]*>/g, ' ').trim();
        if (!nextText) throw new Error('AI 未返回有效总结');

        const phoneStoryTime = this._getCurrentPhoneStoryTimeInfo();
        const nextSummary = {
            text: nextText,
            coveredTurnHashes: [...new Set([...summary.coveredTurnHashes, ...selectedTurns.map(turn => turn.hash)])],
            updatedAt: phoneStoryTime.timestamp || Date.now(),
            storyTime: phoneStoryTime
        };
        history._summary = nextSummary;
        const key = this._hostHistoryStorageKey(safeHostName);
        this._setStored(key, JSON.stringify(this._compactHostHistory(history)));
        this._scheduleFlushChatPersistence();
        return { changed: true, summary: nextSummary, added: selectedTurns.length, remaining: Math.max(0, turns.length - selectedTurns.length) };
    }

    saveHostHistory(hostName, dateStr, sceneData) {
        const key = this._hostHistoryStorageKey(hostName);
        if (!key || !sceneData || typeof sceneData !== 'object') return;
        const dateKey = this._normalizeSceneDate(dateStr);
        const history = this.getHostHistory(hostName);
        history[dateKey] = this._compactStoredScene({
            ...sceneData,
            updatedAt: Date.now()
        }, { full: true, preservePromptTurnLength: true });
        this._setStored(key, JSON.stringify(this._compactHostHistory(history)));
        this._scheduleFlushChatPersistence();
    }

    getLastSceneData() {
        if (this._lastSceneCache && typeof this._lastSceneCache === 'object') return this._lastSceneCache;
        const parsed = this._readJSON('honey_last_scene', null);
        this._lastSceneCache = parsed && typeof parsed === 'object' ? parsed : null;
        return this._lastSceneCache;
    }

    saveLastSceneData(scene) {
        if (!scene || typeof scene !== 'object') return;
        const safeScene = this._compactStoredScene({
            ...scene,
            updatedAt: Date.now()
        }, {
            full: true,
            preservePromptTurnLength: this._isFollowedHostScene(scene)
        });
        this._lastSceneCache = safeScene;
        this._setStored('honey_last_scene', JSON.stringify(safeScene));
        this._scheduleFlushChatPersistence();
    }

    _collectHoneyGeneratedImageUrlsFromValue(value, out = new Set(), depth = 0) {
        if (value === null || value === undefined || depth > 8) return out;

        if (typeof value === 'string') {
            const safe = value.trim();
            if (/^\/backgrounds\/(?:phone_)?honey_nai_/i.test(safe)) out.add(safe);
            return out;
        }

        if (Array.isArray(value)) {
            value.forEach(item => this._collectHoneyGeneratedImageUrlsFromValue(item, out, depth + 1));
            return out;
        }

        if (typeof value !== 'object') return out;

        ['naiImageUrl', 'generatedImageUrl', 'imageUrl'].forEach((key) => {
            const safe = String(value?.[key] || '').trim();
            if (/^\/backgrounds\/(?:phone_)?honey_nai_/i.test(safe)) out.add(safe);
        });

        Object.values(value).forEach(item => this._collectHoneyGeneratedImageUrlsFromValue(item, out, depth + 1));
        return out;
    }

    collectGeneratedImageUrlsForCleanup(extraSources = []) {
        const urls = new Set();
        const push = (value) => this._collectHoneyGeneratedImageUrlsFromValue(value, urls);

        push(this.getRecommendTopics());
        push(this.getTopicScenes());
        push(this.getLastSceneData());
        (Array.isArray(extraSources) ? extraSources : []).forEach(push);

        const followedHosts = this.getFollowedHosts();
        followedHosts.forEach((item) => {
            const hostName = String(item?.name || '').trim();
            if (!hostName) return;
            push(this.getHostHistory(hostName));
        });

        const chatStore = this.storage?._getChatMetadataStore?.();
        if (chatStore && typeof chatStore === 'object') {
            Object.keys(chatStore)
                .filter(key => /^(?:honey_history_|global_honey_history_)/i.test(String(key || '')))
                .forEach((key) => push(chatStore[key]));
        }

        return Array.from(urls);
    }

    async cleanupGeneratedImageFiles(extraSources = []) {
        const urls = this.collectGeneratedImageUrlsForCleanup(extraSources);
        const imageManager = window.VirtualPhone?.imageManager;
        if (!imageManager?.deleteManagedBackgroundByPath) {
            return {
                attempted: urls.length,
                success: 0,
                failed: urls.length,
                skipped: urls.length
            };
        }

        let success = 0;
        let failed = 0;
        for (const url of urls) {
            try {
                await imageManager.deleteManagedBackgroundByPath(url, {
                    quiet: true,
                    skipIfReferenced: true
                });
                success += 1;
            } catch (e) {
                failed += 1;
                console.warn('[HoneyData] 清理蜜语生成图片失败:', url, e);
            }
        }

        return {
            attempted: urls.length,
            success,
            failed,
            skipped: 0
        };
    }

    _mergeSceneDataForRestore(currentSceneData, topicScene) {
        const current = (currentSceneData && typeof currentSceneData === 'object') ? currentSceneData : {};
        const topic = (topicScene && typeof topicScene === 'object') ? topicScene : {};
        const merged = { ...topic, ...current };

        const currentDesc = current.description;
        const topicDesc = topic.description;
        merged.description = this._isMeaningfulDescription(currentDesc)
            ? currentDesc
            : (this._isMeaningfulDescription(topicDesc) ? topicDesc : (currentDesc || topicDesc || ''));

        [
            'comments',
            'gifts',
            'userChats',
            'promptTurns',
            'naiTagHistory',
            'leaderboard',
            'collabRequests',
            'friendRequests',
            'interactionRecords'
        ].forEach((key) => {
            if ((!Array.isArray(current[key]) || current[key].length === 0)
                && Array.isArray(topic[key]) && topic[key].length > 0) {
                merged[key] = topic[key];
            }
        });

        [
            'audienceGiftTotals',
            'userGiftRank',
            'collabRequestInfo'
        ].forEach((key) => {
            const currentObj = current[key] && typeof current[key] === 'object' ? current[key] : null;
            const topicObj = topic[key] && typeof topic[key] === 'object' ? topic[key] : null;
            const currentHasValue = currentObj && Object.keys(currentObj).length > 0;
            if (!currentHasValue && topicObj && Object.keys(topicObj).length > 0) {
                merged[key] = topicObj;
            }
        });

        [
            'lastUserComment',
            'naiPrompt',
            'imageGenerationPrompt',
            'naiImageUrl',
            'generatedImageUrl',
            'imageUrl',
            'imageGenerationStatus',
            'imageGenerationProvider',
            'imageGenerationModel',
            'imageGenerationWidth',
            'imageGenerationHeight',
            'imageGenerationSteps',
            'imageGenerationSeed',
            'imageGenerationSampler',
            'imageGenerationSchedule',
            'imageGenerationScale',
            'imageGenerationError',
            'imageGenerationStartedAt'
        ].forEach((key) => {
            const currentValue = current[key];
            const topicValue = topic[key];
            if ((currentValue === null || currentValue === undefined || currentValue === '')
                && topicValue !== null && topicValue !== undefined && topicValue !== '') {
                merged[key] = topicValue;
            }
        });

        return merged;
    }

    loadSessionState() {
        const recommendTopics = this.getRecommendTopics();
        const selectedTopicKey = this.getSelectedTopicKey();
        const selectedTopicTitle = this.getSelectedTopicTitle();
        let currentSceneData = this.getLastSceneData();
        if (selectedTopicKey || selectedTopicTitle) {
            const topicScene = this.getTopicScene(selectedTopicKey || selectedTopicTitle, selectedTopicTitle);
            if (!currentSceneData && topicScene) {
                currentSceneData = topicScene;
            } else if (currentSceneData && topicScene) {
                currentSceneData = this._mergeSceneDataForRestore(currentSceneData, topicScene);
            }
        }
        return {
            recommendTopics: Array.isArray(recommendTopics) ? recommendTopics : [],
            selectedTopicKey: selectedTopicKey || '',
            selectedTopicTitle: selectedTopicTitle || '',
            currentSceneData: currentSceneData && typeof currentSceneData === 'object' ? currentSceneData : null
        };
    }

    clearGeneratedSessionData(options = {}) {
        const preserveFollowedHosts = options?.preserveFollowedHosts === true;
        if (!preserveFollowedHosts) {
            const followedHosts = this.getFollowedHosts();
            followedHosts.forEach((item) => {
                const hostName = String(item?.name || '').trim();
                if (!hostName) return;
                const historyKey = this._hostHistoryStorageKey(hostName);
                if (!historyKey) return;
                this._removeStored(historyKey);
            });
            this._removeStored('honey_followed_hosts');

            // 兜底：清理异常残留的 honey_history_* 键（例如已丢失关注列表但历史还在）
            const chatStore = this.storage?._getChatMetadataStore?.();
            if (chatStore && typeof chatStore === 'object') {
                Object.keys(chatStore)
                    .filter(key => /^(?:honey_history_|global_honey_history_)/i.test(String(key || '')))
                    .forEach((key) => this._removeStored(key));
            }
            const extStore = this.storage?.getExtensionSettings?.();
            if (extStore && typeof extStore === 'object') {
                const removedExtKeys = Object.keys(extStore)
                    .filter(key => /^(?:honey_history_|global_honey_history_)/i.test(String(key || '')))
                    .filter((key) => {
                        delete extStore[key];
                        return true;
                    });
                if (removedExtKeys.length > 0) {
                    this.storage?.saveExtensionSettings?.();
                }
            }
        }

        this._topicScenesCache = {};
        this._selectedTopicCache = '';
        this._lastSceneCache = null;
        this.saveHoneyFriendRequests([]);
        this._removeStored('honey_topic_scenes');
        this._removeStored('honey_selected_topic');
        this._removeStored('honey_selected_topic_key');
        this._removeStored('honey_last_scene');
        this._scheduleFlushChatPersistence();
    }

    clearCache() {
        this._recommendCache = null;
        this._topicScenesCache = null;
        this._selectedTopicCache = null;
        this._lastSceneCache = null;
    }

    async clearHoneyChatHistory() {
        const context = this._getContext();
        if (!context || !context.chat) return;

        let modified = false;
        const regex = /<Honey>[\s\S]*?<\/Honey>/gi;

        context.chat.forEach(msg => {
            if (msg.is_user) return;

            regex.lastIndex = 0;
            if (msg.mes && regex.test(msg.mes)) {
                regex.lastIndex = 0;
                msg.mes = msg.mes.replace(regex, '').trim();
                modified = true;
            }

            if (msg.swipes) {
                msg.swipes.forEach((swipe, idx) => {
                    regex.lastIndex = 0;
                    if (swipe && regex.test(swipe)) {
                        regex.lastIndex = 0;
                        msg.swipes[idx] = swipe.replace(regex, '').trim();
                        modified = true;
                    }
                });
            }
        });

        if (modified) {
            if (typeof context.saveChatDebounced === 'function') {
                context.saveChatDebounced();
            } else if (typeof context.saveChat === 'function') {
                await context.saveChat();
            }
        }
    }

    _extractJsonPayload(rawText = '') {
        const raw = String(rawText || '').trim();
        if (!raw) return null;

        const honeyMatch = raw.match(/<Honey>([\s\S]*?)<\/Honey>/i);
        const source = String(honeyMatch?.[1] || raw).trim();
        if (!source) return null;

        const codeBlockMatch = source.match(/```json\s*([\s\S]*?)\s*```/i);
        const codeJson = String(codeBlockMatch?.[1] || '').trim();
        if (codeJson) {
            try {
                return JSON.parse(codeJson.replace(/,\s*([\]}])/g, '$1'));
            } catch (e) {
                // ignore and fallback
            }
        }

        const directMatch = source.match(/\{[\s\S]*\}/);
        const directJson = String(directMatch?.[0] || '').trim();
        if (!directJson) return null;

        try {
            return JSON.parse(directJson.replace(/,\s*([\]}])/g, '$1'));
        } catch (e) {
            return null;
        }
    }

    _normalizeHoneyCommentObjects(list = []) {
        return (Array.isArray(list) ? list : [])
            .map((item) => {
                if (typeof item === 'string') return this._normalizeCommentLine(item);
                if (!item || typeof item !== 'object') return '';
                const rankRaw = this._sanitizeInlineText(item.rank || item.type || '', 12);
                const rank = rankRaw ? `[${rankRaw}]` : '';
                const name = this._sanitizeInlineText(item.name || item.nickname || item.user || '匿名', 24) || '匿名';
                const text = this._sanitizePromptBlockLine(item.text || item.content || item.message || '');
                if (!text) return '';
                return `${rank}${name}: ${text}`.trim();
            })
            .map(line => this._normalizeCommentLine(line))
            .filter(Boolean)
            .filter(line => !this._isHoneyCommentStatusLine(line));
    }

    parseHoneyUserLiveContent(rawText) {
        const raw = String(rawText || '');
        const honeyMatch = raw.match(/<Honey>([\s\S]*?)<\/Honey>/i);
        const text = (honeyMatch ? honeyMatch[1] : raw).replace(/\r/g, '').trim();
        const profile = this.getHoneyUserProfile();
        const payload = this._extractJsonPayload(rawText);

        // 兼容旧版 JSON，但优先按当前 <Honey> 行结构解析
        if ((!text || !/(?:在线人数|粉丝数|榜单|打赏记录|好友申请|互动记录|直播剧情描写|评论区)[：:]/.test(text)) && payload) {
            const live = (payload?.live && typeof payload.live === 'object') ? payload.live : (payload || {});
            const comments = this._filterOutUserSpokenHoneyComments(
                this._normalizeHoneyCommentObjects(live?.comments),
                {
                    includeProfileNickname: true,
                    extraNames: [profile.nickname]
                }
            );
            const gifts = (Array.isArray(live?.gifts) ? live.gifts : [])
                .map(item => this._sanitizePromptBlockLine(item))
                .filter(line => this._isHoneyGiftRecordLine(line));
            const leaderboard = (Array.isArray(live?.leaderboard) ? live.leaderboard : [])
                .map((item, idx) => {
                    if (!item || typeof item !== 'object') return null;
                    const name = this._sanitizeInlineText(item.name || item.nickname || '', 24);
                    const coins = this._sanitizeInlineText(item.coins || item.score || item.gift || '', 20);
                    if (!name) return null;
                    return {
                        rank: Math.max(1, Number.parseInt(String(item.rank || idx + 1), 10) || (idx + 1)),
                        name,
                        coins
                    };
                })
                .filter(Boolean)
                .slice(0, 3);
            const friendRequests = (Array.isArray(live?.friendRequests) ? live.friendRequests : [])
                .map(item => this._normalizeHoneySocialPerson(item, '直播间'))
                .filter(Boolean)
                .slice(0, 6);
            const interactionRecords = (Array.isArray(live?.interactionRecords) ? live.interactionRecords : [])
                .map(item => this._parseHoneyInteractionRecordLine(
                    typeof item === 'string'
                        ? item
                        : `${this._sanitizeInlineText(item?.name || item?.nickname || '', 24)}：${this._sanitizeHoneySecret(item?.summary || item?.content || item?.text || '', 180)}`
                ))
                .filter(Boolean)
                .slice(0, 8);
            const collabRequests = this._extractHoneyCollabRequests(rawText, live?.collabRequests || payload?.collabRequests || []);
            const collabRequestInfo = this._normalizeHoneyCollabRequest(live?.collabRequestInfo || payload?.collabRequestInfo || null);

            return {
                host: profile.nickname,
                title: this._sanitizeInlineText(live?.title || profile.liveTitle || `${profile.nickname}的直播间`, 40) || profile.liveTitle || `${profile.nickname}的直播间`,
                viewers: this._sanitizeInlineText(live?.viewers || live?.online || '0', 24) || '0',
                playCount: this._sanitizeInlineText(live?.viewers || live?.online || '0', 24) || '0',
                fans: this._sanitizeInlineText(live?.fans || live?.followers || payload?.followers || String(profile.followers || 0), 24) || String(profile.followers || 0),
                collab: this._normalizeCollabValue(live?.collab || live?.collabUser || live?.collabName || '无'),
                collabCost: Math.max(0, Number.parseInt(String(live?.collabCost || 0), 10) || 0),
                leaderboard: [],
                intro: this._sanitizeInlineText(live?.intro || profile.intro || '', 120) || profile.intro || '',
                naiPrompt: this._extractNaiPrompt(live?.naiPrompt || live?.imageGenerationPrompt || live?.imagePrompt || payload?.naiPrompt || payload?.imageGenerationPrompt || ''),
                description: String(live?.description || live?.scene || live?.story || '')
                    .split('\n')
                    .map(line => this._normalizeHoneyStoryLine(line))
                    .join('\n')
                    .replace(/\n{3,}/g, '\n\n')
                    .trim()
                    || (this._normalizeCollabValue(live?.collab || live?.collabUser || live?.collabName || '无') !== '无'
                        ? '联播已接通，互动正在持续推进。'
                        : '当前暂无联播剧情，直播主要通过弹幕滚动推进。'),
                comments: comments.length > 0 ? comments : [],
                gifts,
                audienceGiftTotals: {},
                userGiftRank: null,
                recommendTopics: [],
                friendRequests,
                interactionRecords,
                collabRequests,
                collabRequestInfo,
                isUserLive: true
            };
        }

        const titleMatch = text.match(/(?:^|\n)\s*(?:直播标题|标题)\s*[：:]\s*([^\n]+)\s*(?:\n|$)/i);
        const viewersMatch = text.match(/(?:^|\n)\s*(?:在线人数|在线)\s*[：:]\s*([^\n]+)\s*(?:\n|$)/i);
        const fansMatch = text.match(/(?:^|\n)\s*粉丝(?:数)?\s*[：:]\s*([^\n]+)\s*(?:\n|$)/i);
        const introMatch = text.match(/(?:^|\n)\s*简介\s*[：:]\s*([^\n]+)\s*(?:\n|$)/i);
        let collab = '无';
        let collabCost = 0;

        const sectionEndPattern = /(?:^|\n)\s*(?:在线人数|在线|粉丝数|粉丝|[\[【]?\s*画面\s*[\]】]?|榜单|打赏记录(?:（[^）]*）|\([^\)]*\))?|评论区|直播剧情描写|剧情面板|直播实况|好友申请|互动记录)\s*[：:]/i;
        const explicitCollabValues = Array.from(text.matchAll(/联播\s*(?:[（(]\s*金币\s*[：:]\s*(\d+)\s*[)）])?\s*[：:]\s*([^\]】\n]+)/ig))
            .map(match => ({
                name: String(match?.[2] || '').trim(),
                cost: Number.parseInt(String(match?.[1] || '').trim(), 10)
            }))
            .filter(item => item.name);
        if (explicitCollabValues.length > 0) {
            const collabItem = explicitCollabValues.find(item => this._normalizeCollabValue(item.name) !== '无') || explicitCollabValues[0];
            collab = this._normalizeCollabValue(collabItem?.name || '无');
            if (Number.isFinite(collabItem?.cost) && collabItem.cost >= 0) {
                collabCost = collabItem.cost;
            }
        }
        const leaderboardSection = this._extractSectionByPatternPairs(text, [
            { start: /(?:^|\n)\s*榜单\s*[：:]\s*/i, end: /(?:^|\n)\s*(?:[\[【]?\s*画面\s*[\]】]?|打赏记录(?:（[^）]*）|\([^\)]*\))?|评论区|直播剧情描写|剧情面板|直播实况|好友申请)\s*[：:]/i }
        ]);
        const giftsSection = this._extractSectionByPatternPairs(text, [
            { start: /(?:^|\n)\s*(?:\[\s*打赏记录\s*\]|打赏记录)(?:（[^）]*）|\([^\)]*\))?\s*[：:]?\s*(?:\n|$)?/i, end: /(?:^|\n)\s*(?:[\[【]?\s*画面\s*[\]】]?|\[\s*评论区\s*\]|评论区|\[\s*直播剧情描写\s*\]|直播剧情描写|剧情面板|直播实况|好友申请)\s*[：:]?/i }
        ]);
        const commentsSection = this._extractSectionByPatternPairs(text, [
            { start: /(?:^|\n)\s*(?:\[\s*评论区\s*\]|评论区)\s*[：:]?\s*(?:\n|$)?/i, end: /(?:^|\n)\s*(?:\[\s*直播剧情描写\s*\]|直播剧情描写|剧情面板|直播实况|好友申请)\s*[：:]?/i }
        ]);
        const storySection = this._extractSectionByPatternPairs(text, [
            { start: /(?:^|\n)\s*(?:\[\s*直播剧情描写\s*\]|直播剧情描写|剧情面板|直播实况)\s*[：:]?\s*(?:\n|$)?/i, end: /(?:^|\n)\s*(?:[\[【]?\s*画面\s*[\]】]?|好友申请|互动记录)\s*[：:]?/i },
            { start: /(?:^|\n)\s*(?:\[\s*直播剧情描写\s*\]|直播剧情描写|剧情面板|直播实况)\s*(?:\n|$)/i, end: /(?:^|\n)\s*(?:[\[【]?\s*画面\s*[\]】]?|好友申请|互动记录)\s*[：:]?/i }
        ]);
        const friendRequestSection = this._extractSectionByPatternPairs(text, [
            { start: /(?:^|\n)\s*好友申请\s*[：:]\s*/i, end: /(?:^|\n)\s*互动记录\s*[：:]/i },
            { start: /(?:^|\n)\s*好友申请\s*[：:]\s*/i, end: null }
        ]);
        const interactionRecordSection = this._extractSectionByPatternPairs(text, [
            { start: /(?:^|\n)\s*互动记录\s*[：:]\s*/i, end: null }
        ]);

        const leaderboard = this._parseLeaderboardSection(leaderboardSection, 3);
        const gifts = String(giftsSection || '')
            .split('\n')
            .map(line => line.replace(/^\s*(?:[-*•]+|\d{1,2}\s*[\.、])\s*/, '').trim())
            .map(line => this._sanitizePromptBlockLine(line))
            .filter(line => this._isHoneyGiftRecordLine(line));
        const comments = this._filterOutUserSpokenHoneyComments(
            String(commentsSection || '')
                .split('\n')
                .map(line => this._normalizeCommentLine(line))
                .filter(Boolean),
            {
                includeProfileNickname: true,
                extraNames: [profile.nickname]
            }
        );
        const friendRequests = String(friendRequestSection || '')
            .split('\n')
            .map(line => this._parseHoneyFriendRequestLine(line, '直播间'))
            .filter(Boolean)
            .slice(0, 6);
        const interactionRecords = String(interactionRecordSection || '')
            .split('\n')
            .map(line => this._parseHoneyInteractionRecordLine(line))
            .filter(Boolean)
            .slice(0, 8);
        const collabRequests = this._extractHoneyCollabRequests(text);
        const cleanedStory = String(storySection || '')
            .split('\n')
            .map(line => this._normalizeHoneyStoryLine(line))
            .filter(line => !/禁止代替用户|禁止替用户|不要代替user|请为用户的直播间/.test(line))
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        return {
            host: profile.nickname,
            title: this._sanitizeInlineText(titleMatch?.[1] || profile.liveTitle || `${profile.nickname}的直播间`, 40) || profile.liveTitle || `${profile.nickname}的直播间`,
            viewers: this._sanitizeInlineText(viewersMatch?.[1] || '0', 24) || '0',
            playCount: this._sanitizeInlineText(viewersMatch?.[1] || '0', 24) || '0',
            fans: this._sanitizeInlineText(fansMatch?.[1] || String(profile.followers || 0), 24) || String(profile.followers || 0),
            collab,
            collabCost,
            leaderboard: [],
            intro: this._sanitizeInlineText(introMatch?.[1] || profile.intro || '', 120) || profile.intro || '',
            naiPrompt: this._extractNaiPrompt(text),
            description: cleanedStory
                || (collab !== '无'
                    ? '联播已接通，互动正在持续推进。'
                    : '当前暂无联播剧情，直播主要通过弹幕滚动推进。'),
            comments: comments.length > 0 ? comments : [],
            gifts,
            audienceGiftTotals: {},
            userGiftRank: null,
            recommendTopics: [],
            friendRequests,
            interactionRecords,
            collabRequests,
            collabRequestInfo: null,
            isUserLive: true
        };
    }

    async generateUserLiveScene(onProgress, options = {}) {
        if (onProgress) onProgress('正在搭建你的直播间...');

        const promptManager = window.VirtualPhone?.promptManager;
        promptManager?.ensureLoaded();
        const prompt = promptManager?.getPromptForFeature('honey', 'userLive') || '';
        const overridePrompt = this._getHoneyOverridePrompt(promptManager);
        const profile = this.getHoneyUserProfile();
        const personalImageTagInfo = this._buildHoneyPersonalImageTagInfo(profile.nickname);
        const runtimeContext = this._buildLiveRuntimeContext(options);
        const friends = this.getHoneyFriends();
        const pendingRequests = this.getHoneyFriendRequests();
        const safeUserMessage = String(options?.userMessage || '')
            .replace(/\r/g, '')
            .split('\n')
            .map(line => this._sanitizePromptLine(line))
            .filter(Boolean)
            .join('\n');
        const safeUserMessageWithNick = this._formatLiveUserMessageForPrompt(safeUserMessage, profile.nickname);
        const historyTurns = this._normalizeContinuePromptTurns(options?.promptTurns, this.maxStoredPromptTurns, { preserveLength: true });
        const mode = String(options?.requestMode || '').trim();
        const isPrivateLive = String(options?.visibility || options?.currentScene?.visibility || '').trim() === 'private'
            || options?.isPrivateLive === true
            || options?.currentScene?.isPrivateLive === true;
        const currentFollowers = Math.max(0, Number.parseInt(String(profile.followers || 0), 10) || 0);

        const messages = [];
        const wechatLinkedCharacterContext = this._buildWechatLinkedCharacterContext(profile.nickname);
        if (overridePrompt) {
            messages.push({
                role: 'system',
                content: overridePrompt,
                isPhoneMessage: true
            });
        }
        messages.push(
            {
                role: 'system',
                content: (String(prompt || '').trim() || '你是蜜语用户开播引擎，只返回 <Honey> 结构。')
                    .replace(/\{\{personalImageTagInfo\}\}/g, personalImageTagInfo),
                isPhoneMessage: true
            },
            {
                role: 'system',
                content: [
                    `【开播者昵称】${profile.nickname}`,
                    `【开播者账号】${profile.accountId}`,
                    `【今日直播主题】${profile.liveTitle || `${profile.nickname}的直播间`}`,
                    `【开播者简介】${profile.intro || '暂无简介'}`,
                    `【当前粉丝数量】${currentFollowers}`,
                    '【已有好友列表】',
                    ...(friends.length > 0 ? friends.slice(0, 50).map((item, idx) => `${idx + 1}. ${item.name}`) : ['暂无']),
                    '【待处理好友申请】',
                    ...(pendingRequests.length > 0
                        ? pendingRequests.slice(0, 50).map((item, idx) => `${idx + 1}. ${item.name}${item.message ? `：${item.message}` : ''}${item.hiddenBackground ? `｜隐藏背景：${item.hiddenBackground}` : ''}`)
                        : ['暂无']),
                    '以上好友与申请仅用于内部参考，禁止重复生成同名好友申请。',
                    '好友申请输出格式强制为：网友昵称：表层申请话术｜隐藏背景：该网友是在什么场景下认识用户、对用户的第一印象、目前的试探想法。隐藏背景会进入后续微信聊天设定。'
                ].join('\n'),
                isPhoneMessage: true
            }
        );
        if (wechatLinkedCharacterContext) {
            messages.push({
                role: 'system',
                content: wechatLinkedCharacterContext,
                isPhoneMessage: true
            });
        }
        const worldInfoMessage = await this._buildWorldInfoMessage();
        if (worldInfoMessage) messages.push(worldInfoMessage);

        if (mode === 'continue') {
            messages.push({
                role: 'system',
                content: [
                    '这是同一场用户自己的直播，必须在已有直播状态上续写，不得重置世界线。',
                    '本轮必须根据最新直播画面重新输出一行：画面：[NAI英文tag提示词: ...]，用于支持当前剧情生成新图片。'
                ].join('\n'),
                isPhoneMessage: true
            });
            historyTurns.forEach((turn) => {
                const assistantContext = String(turn.responseContext || turn.assistantContext || '').trim();
                const userMessage = String(turn.userMessage || '').trim();
                if (assistantContext) messages.push({ role: 'assistant', content: assistantContext, isPhoneMessage: true });
                if (userMessage) messages.push({ role: 'user', content: userMessage, isPhoneMessage: true });
            });
            if (runtimeContext) {
                messages.push({ role: 'assistant', content: runtimeContext, isPhoneMessage: true });
            }
            if (safeUserMessageWithNick) {
                messages.push({ role: 'user', content: safeUserMessageWithNick, isPhoneMessage: true });
            }
        } else if (mode === 'start_with_user_message') {
            messages.push({
                role: 'system',
                content: '这是用户这场直播的开场阶段。请把用户刚发出的这句内容视为开场白或开播动作，据此正式生成本场直播的第一轮实时数据。',
                isPhoneMessage: true
            });
            if (safeUserMessageWithNick) {
                messages.push({ role: 'user', content: safeUserMessageWithNick, isPhoneMessage: true });
            }
        } else if (mode === 'idle') {
            return {
                host: profile.nickname,
                title: profile.liveTitle || `${profile.nickname}的直播间`,
                viewers: '0',
                playCount: '0',
                fans: String(currentFollowers),
                collab: '无',
                collabCost: 0,
                leaderboard: [],
                intro: profile.intro || '',
                naiPrompt: '',
                description: '输入开场白后回车开播。未点击结束直播前，这场直播会一直保留。',
                comments: [],
                gifts: [],
                audienceGiftTotals: {},
                userGiftRank: null,
                recommendTopics: [],
                friendRequests: [],
                isUserLive: true,
                promptTurns: historyTurns
            };
        } else {
            messages.push({
                role: 'user',
                content: '请生成一场“用户自己开播”的初始直播状态，只返回符合要求的 <Honey> 结构。',
                isPhoneMessage: true
            });
        }

        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager) throw new Error('API Manager 未初始化');

        const context = this._getContext();
        const timeoutMs = 90000;
        let timeoutId = null;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('蜜语AI请求超时，请重试')), timeoutMs);
        });

        const result = await Promise.race([
            apiManager.callAI(messages, {
                max_tokens: Number.parseInt(context?.max_response_length, 10)
                    || Number.parseInt(context?.max_length, 10)
                    || Number.parseInt(context?.maxContextLength, 10)
                    || 8192,
                preserve_roles: false,
                appId: 'honey'
            }),
            timeoutPromise
        ]).finally(() => {
            if (timeoutId) clearTimeout(timeoutId);
        });
        if (!result?.success) throw new Error(result?.error || 'AI 返回为空');

        const rawText = result.summary || result.content || result.text || '';
        const filteredText = applyPhoneTagFilter(rawText, { storage: this.storage });
        const responseText = String(filteredText || rawText || '').trim();
        if (!responseText) throw new Error('AI 返回为空');
        if (!/<Honey>[\s\S]*?<\/Honey>/i.test(responseText)
            && !/(?:在线人数|粉丝数|榜单|打赏记录|好友申请|互动记录|直播剧情描写|评论区)[：:]/.test(responseText)) {
            throw new Error('AI 未返回有效 Honey 内容');
        }
        const parsed = this.parseHoneyUserLiveContent(responseText);
        this._syncHoneyUserProfileFromUserLiveScene(parsed);
        const responseContext = this._buildHoneyInteractionHistoryContext(parsed);
        if (mode === 'continue') {
            const nextPromptTurns = [...historyTurns];
            if (runtimeContext && safeUserMessageWithNick) {
                nextPromptTurns.push({
                    assistantContext: this._normalizeLiveAssistantContextLabel(runtimeContext, { asHistory: true }),
                    responseContext,
                    userMessage: safeUserMessageWithNick
                });
            }
            parsed.promptTurns = nextPromptTurns;
        } else if (responseContext) {
            parsed.promptTurns = [{
                assistantContext: this._normalizeLiveAssistantContextLabel(responseContext, { asHistory: true }),
                responseContext,
                userMessage: ''
            }];
        }
        return parsed;
    }

    async generateLiveScene(onProgress, options = {}) {
        if (onProgress) onProgress('正在连线直播间...');

        const promptManager = window.VirtualPhone?.promptManager;
        promptManager?.ensureLoaded();
        const honeyPrompt = promptManager?.getPromptForFeature('honey', 'live') || '';
        const overridePrompt = this._getHoneyOverridePrompt(promptManager);
        const runtimeContext = this._buildLiveRuntimeContext(options);
        const honeyNickname = this._sanitizeInlineText(this.getHoneyUserNickname(), 24) || '你';
        const safeUserMessage = String(options?.userMessage || '')
            .replace(/\r/g, '')
            .split('\n')
            .map(line => this._sanitizePromptLine(line))
            .filter(Boolean)
            .join('\n');
        const safeUserMessageWithNick = this._formatLiveUserMessageForPrompt(safeUserMessage, honeyNickname);
        const historyTurns = this._normalizeContinuePromptTurns(options?.promptTurns, this.maxStoredPromptTurns, { preserveLength: true });
        const previousRecommendContext = this._buildPreviousRecommendAvoidanceContext(options?.previousRecommendTopics);
        const recommendSearchKeyword = this._sanitizeInlineText(options?.recommendSearchKeyword || options?.searchKeyword || '', 80);
        const isPrivateLive = String(options?.visibility || options?.currentScene?.visibility || '').trim() === 'private'
            || options?.isPrivateLive === true
            || options?.currentScene?.isPrivateLive === true;
        const fallbackSystemPrompt = [
            '你是蜜语APP后台引擎。',
            '请严格输出<Honey>标签格式的数据。'
        ].join('\n');
        let systemPrompt = String(honeyPrompt || '').trim() || fallbackSystemPrompt;
        const misplacedFromScratchInstruction = /请根据蜜语APP提示词，从零开始生成一套全新的蜜语内容，严格输出\s*<Honey>\s*结构。?/g;
        if (misplacedFromScratchInstruction.test(systemPrompt)) {
            systemPrompt = systemPrompt
                .replace(misplacedFromScratchInstruction, '')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            if (!systemPrompt) systemPrompt = fallbackSystemPrompt;
            // 直接修正错误配置：把误放在 system 的任务指令清掉并持久化
            promptManager?.updatePrompt?.('honey', 'live', systemPrompt);
        }

        const mode = String(options?.requestMode || '').trim(); // recommend | from_scratch | continue
        const safeTopic = String(options?.topic || '').trim();
        const safeHost = this._sanitizeInlineText(this._stripFollowStateSuffix(options?.currentScene?.host || ''), 40);
        const personalImageTagInfo = this._buildHoneyPersonalImageTagInfo(safeHost);
        systemPrompt = systemPrompt.replace(/\{\{personalImageTagInfo\}\}/g, personalImageTagInfo);
        const isWechatLinkedHost = this._isWechatLinkedHoneyHost(safeHost);
        const wechatLinkedCharacterContext = isWechatLinkedHost
            ? this._buildWechatLinkedCharacterContext(safeHost)
            : '';
        const wechatHistoryContext = isWechatLinkedHost
            ? this.buildWechatHistoryContextForHoneyHost(safeHost, 24)
            : '';
        let instructionUserPrompt = '请根据蜜语APP提示词生成剧情。';
        let instructionSystemPrompt = '';
        const extraMessages = [];

        const followedHosts = this.getFollowedHosts();
        if (followedHosts.length > 0) {
            const followedLines = followedHosts
                .slice(0, 30)
                .map((item, idx) => {
                    const hostName = this._sanitizeInlineText(this._stripFollowStateSuffix(item?.name || ''), 30);
                    if (!hostName) return '';
                    const favorability = this._clampFavorability(item?.favorability ?? item?.affection, 0);
                    return `${idx + 1}. ${hostName}（已关注，好感度${favorability}%）`;
                })
                .filter(Boolean);
            const followContextLines = ['【关注状态提示】'];
            if (followedLines.length > 0) {
                followContextLines.push('用户已关注主播列表：');
                followContextLines.push(...followedLines);
            }
            followContextLines.push('以上状态仅用于内部参考，不得在最终输出的主播昵称中附带“已关注/未关注”字样。');
            extraMessages.push({
                role: 'system',
                content: followContextLines.join('\n')
            });
        }

        if (mode === 'recommend') {
            instructionUserPrompt = '请根据蜜语APP提示词，围绕你收到的直播标题生成内容，严格输出 <Honey> 结构。';
            const recommendHints = [];
            if (safeTopic) recommendHints.push(`【当前点进的直播标题】${safeTopic}`);
            if (safeHost) recommendHints.push(`【当前点进的主播昵称】${safeHost}`);
            if (recommendHints.length > 0) {
                instructionUserPrompt = `${instructionUserPrompt}\n${recommendHints.join('\n')}`;
            }
            if (runtimeContext) {
                extraMessages.push({ role: 'assistant', content: runtimeContext });
            }
        } else if (mode === 'from_scratch') {
            // 从零生成只发一条 user 指令，不拼接“当前直播间状态”
            instructionUserPrompt = '请根据蜜语APP提示词，从零开始生成一套全新的蜜语内容，严格输出 <Honey> 结构。';
            if (previousRecommendContext) {
                instructionUserPrompt = `${previousRecommendContext}\n\n${instructionUserPrompt}`;
            }
            if (recommendSearchKeyword) {
                instructionUserPrompt = [
                    instructionUserPrompt,
                    '',
                    `【用户搜索关键词】${recommendSearchKeyword}`,
                    '请把这次推荐页刷新理解为用户主动搜索。生成的“热门推荐/推荐列表”中，大约一半直播间必须明显围绕该关键词或其合理联想展开；另一半保持蜜语随机题材与多样性，不要全部同质化。',
                    '“当前激情直播”也优先生成一个与该关键词相关、可直接点进观看的直播间。',
                    '仍然严格遵守蜜语APP原提示词和 <Honey> 输出结构。'
                ].join('\n');
            }
        } else if (mode === 'continue') {
            instructionUserPrompt = '';
            instructionSystemPrompt = [
                '这是同一场直播的持续观看，不要重置世界线。请在已有内容上推进剧情并更新评论区。',
                '本轮必须根据最新直播剧情重新输出一行：画面：[NAI英文tag提示词: ...]，用于支持当前剧情生成新图片。',
                '【好感度规则】请在“--- 当前激情直播 ---”区块中显式输出一行：好感度：N%。',
                'N 必须是 0-100 的数字（可保留 1 位小数）。',
                '若本轮没有用户送礼（包括仅普通聊天或无互动），好感度必须保持不变，不得上涨。',
                '若本轮发生送礼，按礼物金额小幅提升好感度；单次回复最多上升 2%。',
                '所有主播均为难攻略设定，严禁出现单轮大幅增长。'
            ].join('\n');

            let injectedHistory = false;
            if (safeHost) {
                const followedHosts = this.getFollowedHosts();
                const safeHostKey = this._normalizeHostNameKey(safeHost);
                const isFollowed = followedHosts.some(item => this._normalizeHostNameKey(item?.name || '') === safeHostKey);

                if (isFollowed) {
                    const historyMap = this.getHostHistory(safeHost);
                    const summary = this.getHostHistorySummary(safeHost);
                    const covered = new Set(summary.coveredTurnHashes);
                    const dateKeys = Object.keys(historyMap)
                        .filter(key => key && !String(key).startsWith('_'))
                        .sort((a, b) => String(a).localeCompare(String(b)));

                    const allTurns = [];
                    const seenTurns = new Set();
                    const summaryContext = this.formatHostHistorySummaryForContext(summary);
                    if (summaryContext) {
                        allTurns.push({
                            role: 'system',
                            content: `【蜜语记录总结：${safeHost}】\n${summaryContext}\n以上是该主播已总结的长期互动背景。`
                        });
                    }

                    dateKeys.forEach(dateKey => {
                        const dayScene = historyMap[dateKey];
                        const dayTurns = this._normalizeContinuePromptTurns(dayScene?.promptTurns, this.maxStoredPromptTurns, { preserveLength: true });

                        let addedForDate = false;
                        dayTurns.forEach(turn => {
                            const hash = this._simpleHash(String(dateKey) + String(turn.assistantContext || '') + String(turn.userMessage || ''));
                            if (covered.has(hash)) return;
                            // 使用 hash 去重，防止跨日结算时的数据重复追加
                            if (seenTurns.has(hash)) return;
                            if (!addedForDate) {
                                allTurns.push({ role: 'system', content: `\n――― 日期：${dateKey} ―――\n` });
                                addedForDate = true;
                            }
                            seenTurns.add(hash);
                            const assistantContext = String(turn.responseContext || turn.assistantContext || '').trim();
                            const userMessage = String(turn.userMessage || '').trim();
                            if (assistantContext) allTurns.push({ role: 'assistant', content: assistantContext });
                            if (userMessage) allTurns.push({ role: 'user', content: userMessage });
                        });
                    });

                    if (allTurns.length > 0) {
                        extraMessages.push(...allTurns);
                        injectedHistory = true;
                    }
                }
            }

            // 如果不是关注的主播，退回使用单次会话的历史
            if (!injectedHistory) {
                historyTurns.forEach((turn) => {
                    const assistantContext = String(turn.responseContext || turn.assistantContext || '').trim();
                    const userMessage = String(turn.userMessage || '').trim();
                    if (assistantContext) extraMessages.push({ role: 'assistant', content: assistantContext });
                    if (userMessage) extraMessages.push({ role: 'user', content: userMessage });
                });
            }

            if (runtimeContext) {
                extraMessages.push({ role: 'assistant', content: runtimeContext });
            }
            if (safeUserMessageWithNick) {
                extraMessages.push({ role: 'user', content: safeUserMessageWithNick });
            }
        } else if (safeTopic) {
            extraMessages.push({ role: 'user', content: `【当前目标推荐主题】${safeTopic}` });
        }

        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager) throw new Error('API Manager 未初始化');

        const context = this._getContext();
        const messages = [];
        if (overridePrompt) {
            messages.push({ role: 'system', content: overridePrompt, isPhoneMessage: true });
        }
        messages.push({ role: 'system', content: systemPrompt, isPhoneMessage: true });
        if (wechatLinkedCharacterContext) {
            messages.push({ role: 'system', content: wechatLinkedCharacterContext, isPhoneMessage: true });
        }
        const worldInfoMessage = await this._buildWorldInfoMessage();
        if (worldInfoMessage) messages.push(worldInfoMessage);
        if (wechatHistoryContext) {
            messages.push({
                role: 'system',
                content: wechatHistoryContext,
                isPhoneMessage: true
            });
        }
        if (instructionSystemPrompt) {
            messages.push({ role: 'system', content: instructionSystemPrompt, isPhoneMessage: true });
        }
        if (instructionUserPrompt) {
            messages.push({ role: 'user', content: instructionUserPrompt, isPhoneMessage: true });
        }
        extraMessages
            .map((item) => ({
                role: String(item?.role || '').trim(),
                content: String(item?.content || '').trim()
            }))
            .filter((item) => item.role && item.content)
            .filter(Boolean)
            .forEach(({ role, content }) => {
                messages.push({ role, content, isPhoneMessage: true });
            });
        // 预填充 assistant 起手，增强模型按标签直接输出的稳定性
        messages.push({
            role: 'assistant',
            content: '好的我严格按照要求生成，且直接开始输出标签的内容。',
            isPhoneMessage: true
        });
        const timeoutMs = 90000;
        let timeoutId = null;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('蜜语AI请求超时，请重试')), timeoutMs);
        });

        const result = await Promise.race([
            apiManager.callAI(messages, {
                // 兼容所有版本的 ST 获取最大回复长度
                max_tokens: Number.parseInt(context?.max_response_length, 10)
                    || Number.parseInt(context?.max_length, 10)
                    || Number.parseInt(context?.maxContextLength, 10)
                    || 8192,
                // 取消强制要求，允许 API 管理器在 GPT 环境下安全降级
                preserve_roles: false,
                appId: 'honey'
            }),
            timeoutPromise
        ]).finally(() => {
            if (timeoutId) clearTimeout(timeoutId);
        });

        if (!result.success) throw new Error(result.error || 'AI 返回为空');

        const rawText = result.summary || result.content || result.text || '';
        const filteredText = applyPhoneTagFilter(rawText, { storage: this.storage });
        const responseText = String(filteredText || rawText || '').trim();
        if (!responseText) throw new Error('AI 返回为空');
        if (!/<Honey>[\s\S]*?<\/Honey>/i.test(responseText)
            && !/---\s*(?:热门推荐|当前\s*激情直播|激情直播)\s*---/i.test(responseText)) {
            throw new Error('AI 未返回有效 Honey 内容');
        }
        const parsed = this.parseHoneyContent(responseText);
        const responseContext = this._buildHoneyInteractionHistoryContext(parsed);
        if (mode === 'continue') {
            const nextPromptTurns = [...historyTurns];
            if (runtimeContext && safeUserMessageWithNick) {
                nextPromptTurns.push({
                    assistantContext: this._normalizeLiveAssistantContextLabel(runtimeContext, { asHistory: true }),
                    responseContext,
                    userMessage: safeUserMessageWithNick
                });
            }
            parsed.promptTurns = nextPromptTurns;
        } else if (responseContext) {
            parsed.promptTurns = [{
                assistantContext: this._normalizeLiveAssistantContextLabel(responseContext, { asHistory: true }),
                responseContext,
                userMessage: ''
            }];
        }
        return parsed;
    }

    parseHoneyContent(rawText) {
        const raw = String(rawText || '');
        const honeyMatch = raw.match(/<Honey>([\s\S]*?)<\/Honey>/i);
        const text = (honeyMatch ? honeyMatch[1] : raw).replace(/\r/g, '').trim();

        let data = {
            host: '神秘主播',
            title: '激情直播中...',
            viewers: '0',
            playCount: '0',
            fans: '0',
            collab: '无',
            collabCost: 0,
            leaderboard: [],
            intro: '',
            naiPrompt: '',
            description: '回推荐页下拉刷新生成剧情。',
            comments: [],
            gifts: [],
            audienceGiftTotals: {},
            userGiftRank: null,
            recommendTopics: [],
            friendRequests: []
        };

        const recommendSection = this._extractSectionByPatternPairs(text, [
            { start: /(?:^|\n)\s*---\s*热门推荐\s*---\s*(?:\n|$)/i, end: /(?:^|\n)\s*---\s*当前\s*激情直播\s*---\s*(?:\n|$)/i }
        ]);
        const liveSection = this._extractSectionByPatternPairs(text, [
            { start: /(?:^|\n)\s*---\s*当前\s*激情直播\s*---\s*(?:\n|$)/i, end: null }
        ]) || text;

        const hostMatch = liveSection.match(/(?:^|\n)\s*主播\s*[：:]\s*([^\n]+)\s*(?:\n|$)/i);
        if (hostMatch) data.host = this._stripFollowStateSuffix(hostMatch[1].trim());

        const titleMatch = liveSection.match(/(?:^|\n)\s*(?:今日直播标题|直播标题|标题)\s*[：:]\s*([^\n]+)\s*(?:\n|$)/i);
        if (titleMatch) data.title = titleMatch[1].trim();

        const viewersMatch = liveSection.match(/(?:^|\n)\s*(?:在线人数|在线)\s*[：:]\s*([^\n]+)\s*(?:\n|$)/i);
        if (viewersMatch) data.viewers = viewersMatch[1].trim();

        const fansMatch = liveSection.match(/(?:^|\n)\s*粉丝(?:数)?\s*[：:]\s*([^\n]+)\s*(?:\n|$)/i);
        if (fansMatch) data.fans = fansMatch[1].trim();

        const favorabilityMatch = liveSection.match(/(?:^|\n)\s*(?:当前)?好感(?:度|值)\s*[：:]\s*([0-9]{1,3}(?:\.[0-9]+)?)(?:\s*[%％])?/i);
        if (favorabilityMatch) {
            const parsedFavorability = this._clampFavorability(favorabilityMatch[1], null);
            if (parsedFavorability !== null) {
                data.favorability = parsedFavorability;
            }
        }

        const commentHeader = liveSection.match(/(?:^|\n)\s*\[\s*评论区\s*\][^\n]*/i)?.[0] || '';
        const explicitCollabValues = Array.from(liveSection.matchAll(/联播\s*(?:[（(]\s*金币\s*[：:]\s*(\d+)\s*[)）])?\s*[：:]\s*([^\]】\n]+)/ig))
            .map(match => ({
                name: String(match?.[2] || '').trim(),
                cost: Number.parseInt(String(match?.[1] || '').trim(), 10)
            }))
            .filter(item => item.name);
        const collabCandidates = [
            ...explicitCollabValues.map(item => ({ raw: item.name, cost: item.cost })),
            { raw: liveSection.match(/(?:^|\n)\s*(?:互动区|互动)\s*[：:]\s*([^\n]+)\s*(?:\n|$)/i)?.[1] || '', cost: Number.NaN },
            { raw: commentHeader, cost: Number.NaN }
        ].filter(item => item.raw);
        if (collabCandidates.length > 0) {
            let fallbackCollab = '无';
            for (const collabItem of collabCandidates) {
                const normalizedCollab = this._normalizeCollabValue(collabItem.raw);
                if (!normalizedCollab) continue;
                if (Number.isFinite(collabItem.cost) && collabItem.cost >= 0) {
                    data.collabCost = collabItem.cost;
                }
                if (normalizedCollab !== '无') {
                    data.collab = normalizedCollab;
                    fallbackCollab = normalizedCollab;
                    break;
                }
                fallbackCollab = normalizedCollab;
            }
            if (data.collab === '无') data.collab = fallbackCollab;
        }

        const leaderboardSection = this._extractSectionByPatternPairs(liveSection, [
            {
                start: /(?:^|\n)\s*(?:榜单|打榜榜单)\s*[：:]\s*/i,
                end: /(?:^|\n)\s*(?:[\[【]?\s*画面\s*[\]】]?|\[\s*打赏记录\s*\]|打赏记录|\[\s*直播剧情描写\s*\]|直播剧情描写|\[\s*评论区\s*\]|评论区)\s*(?:[：:]|\]|\n|$)/i
            }
        ]);
        if (leaderboardSection) {
            data.leaderboard = this._parseLeaderboardSection(leaderboardSection, 3);
        }

        const naiPrompt = this._extractNaiPrompt(liveSection);
        if (naiPrompt) data.naiPrompt = naiPrompt;

        const introMatch = liveSection.match(/(?:^|\n)\s*简介\s*[：:]\s*([^\n]+)\s*(?:\n|$)/i);
        if (introMatch) data.intro = introMatch[1].trim();

        const giftsSection = this._extractSectionByPatternPairs(liveSection, [
            {
                start: /(?:^|\n)\s*\[\s*打赏记录\s*\]\s*[：:]?\s*(?:\n|$)?/i,
                end: /(?:^|\n)\s*(?:[\[【]?\s*画面\s*[\]】]?\s*[：:]?|\[\s*(?:直播剧情描写|评论区)\s*\]\s*[：:]?|直播剧情描写\s*[：:]|评论区\s*[：:]|\[\s*评论区\s*\]\s*[：:]?)\s*/i
            },
            {
                start: /(?:^|\n)\s*打赏记录\s*[：:]\s*/i,
                end: /(?:^|\n)\s*(?:[\[【]?\s*画面\s*[\]】]?\s*[：:]?|\[\s*(?:直播剧情描写|评论区)\s*\]\s*[：:]?|直播剧情描写\s*[：:]|评论区\s*[：:]|\[\s*评论区\s*\]\s*[：:]?)\s*/i
            }
        ]);
        if (giftsSection) {
            data.gifts = giftsSection
                .split('\n')
                .map(line => line.replace(/^\s*(?:[-*•]+|\d{1,2}\s*[\.、])\s*/, '').trim())
                .map(line => this._sanitizePromptBlockLine(line))
                .filter(line => this._isHoneyGiftRecordLine(line));
        }

        const commentHeaderPattern = /(?:^|\n)\s*(?:\[\s*评论区\s*\]\s*[：:]?[^\n]*|评论区\s*[：:][^\n]*)(?:\n|$)/i;

        const storySection = this._extractSectionByPatternPairs(liveSection, [
            { start: /(?:^|\n)\s*\[\s*直播剧情描写\s*\]\s*[：:]?\s*(?:\n|$)?/i, end: /(?:^|\n)\s*(?:[\[【]?\s*画面\s*[\]】]?\s*[：:]?|\[\s*评论区\s*\]|评论区\s*[：:])/i },
            { start: /(?:^|\n)\s*直播剧情描写\s*[：:]\s*/i, end: /(?:^|\n)\s*(?:[\[【]?\s*画面\s*[\]】]?\s*[：:]?|\[\s*评论区\s*\]|评论区\s*[：:])/i }
        ]);
        if (storySection) {
            const cleanedStory = storySection
                .split('\n')
                .map(line => this._normalizeHoneyStoryLine(line))
                .filter(line => !/UI内嵌叙事深化协议|不少于三个自然段|强制执行下方/.test(line))
                .filter(line => !/^\s*(?:\(|（).*(?:\)|）)\s*$/.test(line))
                .join('\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            if (cleanedStory) data.description = cleanedStory;
        }

        if (!data.description || data.description === '暂无剧情描写，点击刷新后自动生成。' || data.description === '回推荐页下拉刷新生成剧情。') {
            if (data.intro) data.description = data.intro;
        }

        const commentsSection = this._extractSectionByPatternPairs(liveSection, [
            { start: commentHeaderPattern, end: /(?:^|\n)\s*好友申请\s*[：:]/i },
            { start: commentHeaderPattern, end: null }
        ]);
        if (commentsSection) {
            const comments = this._filterOutUserSpokenHoneyComments(
                commentsSection
                    .split('\n')
                    .map(line => this._normalizeCommentLine(line))
                    .filter(Boolean)
            );
            if (comments.length > 0) {
                data.comments = comments;
            }
        }
        const friendRequestSection = this._extractSectionByPatternPairs(liveSection, [
            { start: /(?:^|\n)\s*好友申请\s*[：:]\s*/i, end: null }
        ]);
        if (friendRequestSection) {
            const currentHostKey = this._normalizeHostNameKey(data.host || '');
            data.friendRequests = String(friendRequestSection || '')
                .split('\n')
                .map(line => this._parseHoneyFriendRequestLine(line, data.host || '直播间'))
                .filter(Boolean)
                .map(item => {
                    const requestNameKey = this._normalizeHostNameKey(item?.name || '');
                    const isCurrentHost = !!currentHostKey && requestNameKey === currentHostKey;
                    const isHostSource = /主播|其他直播间/.test(String(item?.source || item?.sourceLabel || ''));
                    if (!isCurrentHost && !isHostSource) return item;
                    return {
                        ...item,
                        requestType: 'host',
                        sourceLabel: '主播',
                        hostType: item.hostType || '主播',
                        source: item.source || data.host || '主播'
                    };
                })
                .slice(0, 4);
        }

        if (!Array.isArray(data.leaderboard) || data.leaderboard.length === 0) {
            const leaderboardFallbackLines = liveSection
                .split('\n')
                .map(line => line.trim())
                .filter(Boolean)
                .filter(line => /(?:第\s*[一二三四五六七八九十0-9]+\s*名|榜[一二三四五六七八九十0-9]|^\d{1,2}\s*[\.、:：])/.test(line))
                .filter(line => /(?:打赏|送出|赠送|贡献|金币|金豆|币)/.test(line));
            if (leaderboardFallbackLines.length > 0) {
                data.leaderboard = this._parseLeaderboardSection(leaderboardFallbackLines.join('\n'), 3);
            }
        }

        const parsedRecommendTopics = this._parseRecommendTopics(recommendSection);
        if (parsedRecommendTopics.length > 0) data.recommendTopics = parsedRecommendTopics;

        return data;
    }

    _extractSectionByPatternPairs(text, pairs = []) {
        const source = String(text || '');
        if (!source || !Array.isArray(pairs) || pairs.length === 0) return '';

        for (const pair of pairs) {
            const startPattern = pair?.start;
            const endPattern = pair?.end || null;
            if (!(startPattern instanceof RegExp)) continue;

            const startMatch = source.match(startPattern);
            if (!startMatch || typeof startMatch.index !== 'number') continue;

            const contentStart = startMatch.index + startMatch[0].length;
            const rest = source.slice(contentStart);

            if (!(endPattern instanceof RegExp)) {
                const whole = rest.trim();
                if (whole) return whole;
                continue;
            }

            const endMatch = rest.match(endPattern);
            const contentEnd = endMatch && typeof endMatch.index === 'number'
                ? endMatch.index
                : rest.length;
            const section = rest.slice(0, contentEnd).trim();
            if (section) return section;
        }
        return '';
    }

    _normalizeCommentLine(line) {
        let text = String(line || '').replace(/\r/g, '').trim();
        if (!text) return '';

        if (/^\s*(?:\(|（).*(?:\)|）)\s*$/.test(text)) return '';
        if (/^(?:---+|===+)$/.test(text)) return '';
        if (/^(?:互动区|打赏记录|直播剧情描写|[\[【]?\s*画面\s*[\]】]?|简介|主播|标题|在线人数|粉丝)[：:]/.test(text)) return '';
        if (/^\[\s*评论区\s*\]/i.test(text)) return '';
        if (/^\[\s*(?:联播请求|其他直播间请求联播)\s*[：:]/i.test(text)) return '';
        if (/^(?:生成|不少于|至少)\d*条/.test(text)) return '';

        text = text
            .replace(/^\d{1,2}\s*[\.、]\s*/, '')
            .replace(/^[-*•]\s*/, '')
            .trim();
        if (!text) return '';

        const rankPrefixMatch = text.match(/^(【[^】]{1,16}】|\[[^\]]{1,16}\])\s*/);
        let rankPrefix = '';
        if (rankPrefixMatch) {
            const rawRank = String(rankPrefixMatch[1] || '').replace(/[【】\[\]\s]/g, '').trim();
            const normalizedRank = rawRank === '粉丝' ? '热评' : rawRank;
            rankPrefix = normalizedRank ? `[${normalizedRank}]` : '';
            text = text.slice(rankPrefixMatch[0].length).trim();
        }

        const fallbackUserSplit = text.match(/^([^:：\s]{1,24})\s*[：:]\s*(.+)$/);
        if (fallbackUserSplit) {
            const user = this._sanitizeInlineText(fallbackUserSplit[1], 24);
            const content = this._sanitizePromptBlockLine(fallbackUserSplit[2]);
            if (!user || !content) return '';
            return `${rankPrefix}${user}: ${content}`.trim();
        }

        const fallback = this._sanitizePromptBlockLine(text);
        if (!fallback) return '';
        return `${rankPrefix}匿名: ${fallback}`.trim();
    }

    _isHoneyGiftRecordLine(line) {
        const text = String(line || '').trim();
        if (!text) return false;
        return /(?:送出|赠送|贡献|金币|金豆|[🌹🍆🍑💋🔗⛓️📿🪢🏎️🚀💎👑🍾])/u.test(text)
            || /打赏[^\n]{0,20}\d/u.test(text);
    }

    _normalizeCollabValue(rawValue = '') {
        let stripped = String(rawValue || '')
            .replace(/[【】\[\]]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!stripped) return '无';

        const explicitMatch = stripped.match(/联播\s*(?:[（(]\s*金币\s*[：:]\s*\d+\s*[)）])?\s*[：:]\s*([^\n]+)/i);
        if (explicitMatch?.[1]) {
            stripped = String(explicitMatch[1]).trim();
        }
        stripped = stripped
            .replace(/^(?:评论区|互动区|互动)\s*[：:]?/i, '')
            .trim();

        const parts = stripped
            .split(/[\/|、,，]/)
            .map((item) => String(item || '')
                .replace(/^(?:联播\s*(?:[（(]\s*金币\s*[：:]\s*\d+\s*[)）])?|评论区|互动区|互动)\s*[：:]?/i, '')
                .trim())
            .map(item => this._sanitizeInlineText(item, 24))
            .filter(Boolean);
        const picked = parts.find(item => !/^(?:无|none|null|暂无|未联播)$/i.test(item));
        if (picked) return picked;

        const fallback = parts[0] || this._sanitizeInlineText(stripped, 24);
        if (!fallback) return '无';
        return /^(?:无|none|null|暂无|未联播)$/i.test(fallback) ? '无' : fallback;
    }

    _parseRankNumber(rawValue = '') {
        const raw = String(rawValue || '').replace(/[第名位榜\s]/g, '').trim();
        if (!raw) return 0;
        if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10) || 0;

        const map = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
        if (raw === '十') return 10;
        if (!raw.includes('十')) return map[raw] || 0;

        const [leftRaw, rightRaw] = raw.split('十');
        const left = leftRaw ? (map[leftRaw] || 0) : 1;
        const right = rightRaw ? (map[rightRaw] || 0) : 0;
        return left * 10 + right;
    }

    _parseLeaderboardSection(sectionText = '', maxItems = 3) {
        const safeMax = Math.max(1, Number(maxItems) || 3);
        const lines = String(sectionText || '')
            .replace(/\r/g, '')
            .replace(/[;；]+/g, '\n')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);
        if (lines.length === 0) return [];

        const list = [];
        for (const lineRaw of lines) {
            let line = String(lineRaw || '')
                .replace(/^\s*(?:[-*•]+)\s*/, '')
                .trim();
            if (!line) continue;
            if (/^榜单\s*[：:]?$/i.test(line)) continue;
            if (/^(?:无|暂无|none|null)$/i.test(line)) continue;

            let rank = 0;
            const rankPrefix = line.match(/^(?:([0-9]{1,2})\s*[\.、:：]|第?\s*([0-9一二三四五六七八九十两]{1,3})\s*(?:名|位)?|榜\s*([0-9一二三四五六七八九十两]{1,3}))\s*/i);
            if (rankPrefix) {
                const rankRaw = rankPrefix[1] || rankPrefix[2] || rankPrefix[3] || '';
                rank = this._parseRankNumber(rankRaw);
                line = line.slice(rankPrefix[0].length).trim();
                line = line.replace(/^[\s:：\-—]+/, '').trim();
            }

            const coinsWithCurrencyMatch = line.match(/([0-9]+(?:\.[0-9]+)?(?:\s*[kKwW万])?)\s*(?:金币|金豆|币)/i);
            const coinsWithGSuffixMatch = line.match(/([0-9]+(?:\.[0-9]+)?(?:\s*[kKwW万])?\s*[gG])\b/);
            const coinsRaw = coinsWithCurrencyMatch?.[1] || coinsWithGSuffixMatch?.[1] || '';
            const coins = coinsRaw ? String(coinsRaw).replace(/\s+/g, '').toUpperCase() : '';

            let name = line
                .replace(/(?:累计|共计|共|已)?\s*(?:打赏|送出|赠送|贡献)\s*[了]?\s*([0-9]+(?:\.[0-9]+)?(?:\s*[kKwW万])?\s*[gG])\b/ig, '')
                .replace(/(?:累计|共计|共|已)?\s*(?:打赏|送出|赠送|贡献)\s*[了]?\s*([0-9]+(?:\.[0-9]+)?(?:\s*[kKwW万])?)\s*(?:金币|金豆|币)\b/ig, '')
                .replace(/([0-9]+(?:\.[0-9]+)?(?:\s*[kKwW万])?\s*[gG])\b/ig, '')
                .replace(/([0-9]+(?:\.[0-9]+)?(?:\s*[kKwW万])?)\s*(?:金币|金豆|币)\b/ig, '')
                .replace(/\s*[-—:：]\s*$/g, '')
                .trim();
            if (!name) {
                const nameFallback = line.match(/^(.+?)\s*(?:打赏|送出|赠送|贡献)/);
                if (nameFallback) {
                    name = String(nameFallback[1] || '').trim();
                }
            }
            name = this._sanitizeInlineText(name, 20);
            if (!name) continue;

            list.push({
                rank: rank || (list.length + 1),
                name,
                coins
            });
            if (list.length >= safeMax) break;
        }

        return list
            .filter(item => item && item.name)
            .sort((a, b) => (Number(a.rank) || 99) - (Number(b.rank) || 99))
            .slice(0, safeMax);
    }

    _parseRecommendTopics(sectionText) {
        if (!sectionText) return [];

        const lines = String(sectionText)
            .replace(/\r/g, '')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);

        const today = { title: '', host: '', intro: '', viewers: '', tag: '' };
        const topics = [];
        let currentSection = '';
        const normalizeSection = (value) => String(value || '').replace(/[【】\[\]\s]/g, '').trim();
        const cleanValue = (value, maxLen = 140) => this._sanitizeInlineText(value, maxLen);
        const extractLeadingTag = (value) => {
            const src = String(value || '').trim();
            const m = src.match(/^【([^】]{1,18})】\s*(.+)$/);
            if (!m) return { tag: '', title: cleanValue(src, 100) };
            const possibleTag = cleanValue(m[1], 24);
            const title = cleanValue(m[2], 100);
            if (!possibleTag || /^(标题内容|主播昵称|在线人数|tag|标签)$/i.test(possibleTag)) {
                return { tag: '', title: cleanValue(src, 100) };
            }
            return { tag: possibleTag, title };
        };
        const parseTopicLine = (rawLine, category = '') => {
            const body = String(rawLine || '').trim();
            if (!body) return null;

            const segments = [...body.matchAll(/【([^】]+)】/g)]
                .map(m => cleanValue(m[1] || '', 180))
                .filter(Boolean);

            const mapped = { title: '', host: '', viewers: '', tag: '', naiPrompt: '' };
            const unnamed = [];
            segments.forEach(seg => {
                const kv = seg.match(/^([^：:]{1,20})[：:]\s*(.+)$/);
                if (!kv) {
                    unnamed.push(seg);
                    return;
                }
                const field = String(kv[1] || '').trim();
                const val = cleanValue(kv[2] || '', 140);
                if (!val) return;
                if (/^(标题内容|标题)$/i.test(field)) mapped.title = val;
                else if (/^(主播昵称|主播)$/i.test(field)) mapped.host = val;
                else if (/^(在线人数|在线)$/i.test(field)) mapped.viewers = val;
                else if (/^(tag|标签)$/i.test(field)) mapped.tag = val;
                else if (/^(?:[\[【]?\s*画面\s*[\]】]?|NAI英文tag提示词|NAI提示词|NovelAI提示词|imagePrompt)$/i.test(field)) mapped.naiPrompt = this._extractNaiPrompt(val);
            });

            const hostFromDash = body.match(/(?:主播昵称|主播)\s*[：:]?\s*([^－—\-|]+)\s*(?:(?:[-－—|])|$)/i);
            if (hostFromDash?.[1] && !mapped.host) mapped.host = cleanValue(hostFromDash[1], 60);
            const viewersFromDash = body.match(/在线人数\s*[：:]?\s*([^－—\-|]+)\s*(?:(?:[-－—|])|$)/i);
            if (viewersFromDash?.[1] && !mapped.viewers) mapped.viewers = cleanValue(viewersFromDash[1], 24);
            const tagFromDash = body.match(/(?:^|[\s\-－—|])(?:tag|标签)\s*[：:]\s*([^－—\-|]+)/i);
            if (tagFromDash?.[1] && !mapped.tag) mapped.tag = cleanValue(tagFromDash[1], 30);

            let title = mapped.title || unnamed[0] || '';
            if (!title) {
                let titleBody = body
                    .replace(/(?:^|\s*[-－—]\s*)(?:主播昵称|主播)\s*[：:]?\s*[^－—\-|\n]+/gi, ' ')
                    .replace(/(?:^|\s*[-－—]\s*)在线人数\s*[：:]?\s*[^－—\-|\n]+/gi, ' ')
                    .replace(/(?:^|\s*[-－—]\s*)(?:tag|标签)\s*[：:]\s*[^－—\-|\n]+/gi, ' ')
                    .replace(/【(?:标题内容|标题|主播昵称|主播|在线人数|在线|tag|标签)\s*[：:][^】]+】/gi, ' ')
                    .replace(/\s*[-－—|]+\s*/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                const lead = extractLeadingTag(titleBody);
                if (lead.tag && !mapped.tag) mapped.tag = lead.tag;
                title = lead.title;
            } else {
                const lead = extractLeadingTag(title);
                if (lead.tag && !mapped.tag) mapped.tag = lead.tag;
                title = lead.title || title;
            }

            title = cleanValue(title, 100);
            if (!title) return null;

            return {
                title,
                category: cleanValue(category, 24),
                heat: cleanValue(category, 24),
                tag: cleanValue(mapped.tag, 32),
                host: this._stripFollowStateSuffix(cleanValue(mapped.host, 40)),
                viewers: cleanValue(mapped.viewers, 24),
                intro: '',
                naiPrompt: mapped.naiPrompt || this._extractNaiPrompt(body)
            };
        };

        for (const line of lines) {
            const sectionMatch = line.match(/^\[([^\]\n]{1,30})\]$/);
            if (sectionMatch) {
                currentSection = normalizeSection(sectionMatch[1]);
                continue;
            }

            if (currentSection === '今日推荐') {
                const fieldMatch = line.match(/^(标题内容|标题|主播昵称|主播|内容简介|简介|在线人数|在线)\s*[：:]\s*(.+)$/i);
                if (!fieldMatch) continue;
                const field = String(fieldMatch[1] || '').trim();
                const val = cleanValue(fieldMatch[2] || '', 160);
                if (!val) continue;
                if (/^(标题内容|标题)$/i.test(field)) today.title = val;
                if (/^(主播昵称|主播)$/i.test(field)) today.host = val;
                if (/^(内容简介|简介)$/i.test(field)) today.intro = val;
                if (/^(在线人数|在线)$/i.test(field)) today.viewers = val;
                if (/^(tag|标签)$/i.test(field)) today.tag = val;
                continue;
            }

            if (!currentSection || /^(热门推荐|当前激情直播|激情直播)$/i.test(currentSection)) continue;

            const numbered = line.match(/^\d{1,2}\s*[\.、]?\s*(.+)$/);
            const candidate = numbered?.[1]
                || (((/(?:主播昵称|主播)\s*[：:]?/i.test(line)) && /在线人数\s*[：:]?/i.test(line)) ? line : '');
            if (!candidate) continue;
            const parsedTopic = parseTopicLine(candidate, currentSection);
            if (parsedTopic) topics.push(parsedTopic);
        }

        const merged = [];
        if (today.title || today.host || today.intro || today.viewers) {
            const todayLead = extractLeadingTag(today.title);
            merged.push({
                title: todayLead.title || today.title || '今日推荐直播',
                host: this._stripFollowStateSuffix(today.host || '神秘主播'),
                intro: today.intro || '',
                viewers: today.viewers || '0',
                category: '今日推荐',
                heat: '今日推荐',
                tag: today.tag || todayLead.tag || '',
                isTodayRecommend: true
            });
        }

        topics.forEach((item) => merged.push(item));

        const deduped = [];
        const seen = new Set();
        for (const item of merged) {
            const title = cleanValue(item?.title || '', 80);
            if (!title) continue;
            const key = title.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push({
                title,
                _topicKey: `topic_${this._simpleHash(`${title}__${deduped.length}`)}`,
                heat: item.heat || '',
                tag: item.tag || '',
                host: item.host || '神秘主播',
                viewers: item.viewers || '0',
                fans: '0',
                collab: '无',
                collabCost: 0,
                intro: item.intro || '',
                comments: [],
                description: '回推荐页下拉刷新生成剧情。',
                isTodayRecommend: !!item.isTodayRecommend,
                recommendCategory: item.category || ''
            });
        }
        return deduped.slice(0, 24);
    }
}
