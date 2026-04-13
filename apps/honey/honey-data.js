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
import { applyPhoneTagFilter } from '../../config/tag-filter.js';

export class HoneyData {
    constructor(storage) {
        this.storage = storage;
        this.customLiveVideosGlobalKey = 'global_honey_custom_live_videos';
        this.customLiveVideosLegacyKey = 'honey_custom_live_videos';
        this._recommendCache = null;
        this._topicScenesCache = null;
        this._selectedTopicCache = null;
        this._lastSceneCache = null;
        this._flushTimer = null;
    }

    _getContext() {
        return (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
    }

    _sanitizeInlineText(value, maxLen = 260) {
        return String(value || '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, maxLen);
    }

    _normalizeHostNameKey(name) {
        return String(name || '')
            .replace(/\s+/g, '')
            .trim()
            .toLowerCase();
    }

    _stripFollowStateSuffix(name = '') {
        return String(name || '')
            .replace(/\s*[（(]\s*(?:已关注|未关注)\s*[)）]\s*$/g, '')
            .trim();
    }

    _clampFavorability(value, fallback = 0) {
        const num = Number.parseFloat(value);
        if (!Number.isFinite(num)) return fallback;
        const clamped = Math.max(0, Math.min(100, num));
        return Math.round(clamped * 10) / 10;
    }

    _normalizeContinuePromptTurns(turns, maxTurns = 200) {
        const safeMax = Math.max(1, Number(maxTurns) || 200);
        return (Array.isArray(turns) ? turns : [])
            .map((turn) => {
                const assistantContext = String(turn?.assistantContext || turn?.assistant || '')
                    .replace(/\r/g, '')
                    .trim();
                const rawUserMessage = this._sanitizeInlineText(turn?.userMessage || turn?.user || '', 220);
                const userMessage = this._formatLiveUserMessageForPrompt(rawUserMessage);
                if (!assistantContext || !userMessage) return null;
                return { assistantContext, userMessage };
            })
            .filter(Boolean)
            .slice(-safeMax);
    }

    _formatLiveUserMessageForPrompt(message, nickname = '') {
        const safeMessage = this._sanitizeInlineText(message || '', 220);
        if (!safeMessage) return '';
        if (/^【系统强制提示[:：]/.test(safeMessage)) return safeMessage;
        if (/^[^：:\n]{1,24}\s*[：:]\s*\S/.test(safeMessage)) return safeMessage;

        const safeNickname = this._sanitizeInlineText(nickname || this.getHoneyUserNickname() || '你', 24) || '你';
        return `${safeNickname}：${safeMessage}`;
    }

    _buildLiveRuntimeContext(options = {}) {
        const currentScene = (options?.currentScene && typeof options.currentScene === 'object') ? options.currentScene : null;
        const externalComments = Array.isArray(options?.currentComments) ? options.currentComments : null;
        const externalUserChats = Array.isArray(options?.currentUserChats) ? options.currentUserChats : null;
        const previousDescription = String(options?.previousDescription || '').trim();

        if (!currentScene && !externalComments?.length && !externalUserChats?.length && !previousDescription) return '';

        const host = this._sanitizeInlineText(this._stripFollowStateSuffix(currentScene?.host || ''), 40);
        const title = this._sanitizeInlineText(currentScene?.title || '', 60);
        const viewers = this._sanitizeInlineText(currentScene?.viewers || '', 20);
        const fans = this._sanitizeInlineText(currentScene?.fans || '', 20);
        const collab = this._sanitizeInlineText(currentScene?.collab || '', 24);
        const intro = this._sanitizeInlineText(currentScene?.intro || '', 240);
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
        const descLines = this._isMeaningfulDescription(runtimeDescription)
            ? runtimeDescription
                .replace(/\r/g, '')
                .split('\n')
                .map(line => this._sanitizeInlineText(line, 220))
                .filter(Boolean)
                .slice(-8)
            : [];

        const commentsSource = externalComments || currentScene?.comments || [];
        const comments = (Array.isArray(commentsSource) ? commentsSource : [])
            .map(line => this._sanitizeInlineText(line, 160))
            .filter(Boolean)
            .slice(-12);
        const userChatsSource = externalUserChats || currentScene?.userChats || [];
        const userChats = (Array.isArray(userChatsSource) ? userChatsSource : [])
            .map(line => this._sanitizeInlineText(line, 160))
            .filter(Boolean)
            .slice(-200);

        const gifts = (Array.isArray(currentScene?.gifts) ? currentScene.gifts : [])
            .map(line => this._sanitizeInlineText(line, 100))
            .filter(Boolean)
            .slice(-6);

        const lines = [];
        lines.push('【当前直播间状态（请在此基础上续写）】');
        if (host) lines.push(`主播：${host}${hostFollowState ? `（${hostFollowState}）` : ''}`);
        if (title) lines.push(`标题：${title}`);
        if (viewers || fans) lines.push(`状态：在线人数:${viewers || '0'} 粉丝:${fans || '0'}`);
        if (collab) lines.push(`联播：${collab}`);
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
            descLines.forEach((line, idx) => lines.push(`${idx + 1}. ${line}`));
        }

        if (comments.length > 0) {
            lines.push('当前评论区（最近）：');
            comments.forEach((line, idx) => lines.push(`${idx + 1}. ${line}`));
        }

        if (userChats.length > 0) {
            lines.push('用户互动聊天记录（按时间）：');
            userChats.forEach((line, idx) => lines.push(`${idx + 1}. ${line}`));
        }

        if (gifts.length > 0) {
            lines.push('当前打赏动态（最近）：');
            gifts.forEach((line, idx) => lines.push(`${idx + 1}. ${line}`));
        }

        return lines.join('\n');
    }

    _readJSON(key, fallback) {
        const saved = this.storage?.get?.(key);
        if (saved === null || saved === undefined || saved === '') return fallback;
        try {
            return typeof saved === 'string' ? JSON.parse(saved) : saved;
        } catch (e) {
            return fallback;
        }
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
        if (text === '暂无剧情描写。') return false;
        if (text === '暂无剧情描写，点击刷新后自动生成。') return false;
        if (text === '正在连线中...') return false;
        if (text === 'AI 正在根据你的弹幕继续推进直播剧情...') return false;
        return true;
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
        this.storage?.set?.('honey_recommend_topics', JSON.stringify(safeTopics));
        this._scheduleFlushChatPersistence();
    }

    getRecommendBgVideo() {
        const saved = this.storage?.get?.('global_honey_bg_video');
        const safe = typeof saved === 'string' ? saved.trim() : '';
        return safe || null;
    }

    saveRecommendBgVideo(url) {
        const safe = String(url || '').trim();
        if (safe) {
            this.storage?.set?.('global_honey_bg_video', safe);
        } else {
            this.storage?.remove?.('global_honey_bg_video');
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
        const safe = scenes && typeof scenes === 'object' ? scenes : {};
        this._topicScenesCache = safe;
        this.storage?.set?.('honey_topic_scenes', JSON.stringify(safe));
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
        scenes[key] = {
            ...scene,
            _topicTitle: safeTitle,
            _topicKey: safeTopicKey
        };
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
                this.storage?.remove?.('honey_last_scene');
                this._scheduleFlushChatPersistence();
            }
        }
    }

    getSelectedTopicTitle() {
        if (typeof this._selectedTopicCache === 'string') return this._selectedTopicCache;
        const saved = this.storage?.get?.('honey_selected_topic');
        this._selectedTopicCache = typeof saved === 'string' ? saved : '';
        return this._selectedTopicCache;
    }

    saveSelectedTopicTitle(topicTitle) {
        const safe = String(topicTitle || '').trim();
        this._selectedTopicCache = safe;
        this.storage?.set?.('honey_selected_topic', safe);
        this._scheduleFlushChatPersistence();
    }

    getSelectedTopicKey() {
        const saved = this.storage?.get?.('honey_selected_topic_key');
        return typeof saved === 'string' ? saved.trim() : '';
    }

    saveSelectedTopicKey(topicKey) {
        const safe = String(topicKey || '').trim();
        this.storage?.set?.('honey_selected_topic_key', safe);
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
        const globalRaw = this.storage?.get?.(this.customLiveVideosGlobalKey, null);
        const globalList = this._normalizeCustomVideoList(globalRaw);

        // 兼容旧版：从聊天专属 key 读取并迁移到全局 key
        const legacyRaw = this.storage?.get?.(this.customLiveVideosLegacyKey, null);
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
                this.storage?.set?.(this.customLiveVideosGlobalKey, mergedJson);
                this._scheduleFlushChatPersistence();
            }
        }

        // 完成迁移后清空 legacy，避免删除时被旧 key 再次“回灌”到列表末尾
        if (legacyList.length > 0) {
            this.storage?.remove?.(this.customLiveVideosLegacyKey);
        }

        return merged;
    }

    addCustomLiveVideo(url) {
        const safeUrl = String(url || '').trim();
        if (!safeUrl) return;
        const videos = this.getCustomLiveVideos();
        if (!videos.includes(safeUrl)) {
            videos.push(safeUrl);
            this.storage?.set?.(this.customLiveVideosGlobalKey, JSON.stringify(videos));
            this._scheduleFlushChatPersistence();
        }
    }

    removeCustomLiveVideo(url) {
        const safeUrl = String(url || '').trim();
        if (!safeUrl) return;
        const videos = this.getCustomLiveVideos().filter(v => v !== safeUrl);
        this.storage?.set?.(this.customLiveVideosGlobalKey, JSON.stringify(videos));

        // 同步清理 legacy key（历史数据），防止被 getCustomLiveVideos 再合并回来
        const legacyRaw = this.storage?.get?.(this.customLiveVideosLegacyKey, null);
        const legacyVideos = this._normalizeCustomVideoList(legacyRaw).filter(v => v !== safeUrl);
        if (legacyVideos.length > 0) {
            this.storage?.set?.(this.customLiveVideosLegacyKey, JSON.stringify(legacyVideos));
        } else {
            this.storage?.remove?.(this.customLiveVideosLegacyKey);
        }

        this._scheduleFlushChatPersistence();
    }

    getHoneyUserNickname() {
        const saved = String(this.storage?.get?.('honey_user_nickname') || '').trim();
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
        this.storage?.set?.('honey_user_nickname', safe);
        this._scheduleFlushChatPersistence();
        return safe;
    }

    getHoneyCoinBalance() {
        const raw = this.storage?.get?.('honey_coin_balance');
        const num = Number.parseFloat(raw);
        if (!Number.isFinite(num) || num < 0) return 0;
        return Math.floor(num);
    }

    setHoneyCoinBalance(amount) {
        const num = Number.parseFloat(amount);
        const safe = Number.isFinite(num) ? Math.max(0, Math.floor(num)) : 0;
        this.storage?.set?.('honey_coin_balance', safe);
        this._scheduleFlushChatPersistence();
        return safe;
    }

    updateHoneyCoinBalance(delta) {
        const current = this.getHoneyCoinBalance();
        const parsed = Number.parseFloat(delta);
        const next = Number.isFinite(parsed)
            ? Math.max(0, Math.floor(current + parsed))
            : current;
        this.storage?.set?.('honey_coin_balance', next);
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

    getFollowedHosts() {
        const parsed = this._readJSON('honey_followed_hosts', []);
        if (!Array.isArray(parsed)) return [];
        return parsed
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
                    favorability: this._clampFavorability(item.favorability ?? item.affection, 0)
                };
            })
            .filter(Boolean);
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
                        favorability: this._clampFavorability(item.favorability ?? item.affection, 0)
                    };
                })
                .filter(Boolean)
            : [];
        this.storage?.set?.('honey_followed_hosts', JSON.stringify(safeList));
        this._scheduleFlushChatPersistence();
    }

    toggleFollowHost(hostName, avatarUrl = '') {
        const safeHostName = String(hostName || '').trim();
        if (!safeHostName) {
            return {
                followed: false,
                list: this.getFollowedHosts()
            };
        }

        const safeAvatarUrl = String(avatarUrl || '').trim();
        const list = this.getFollowedHosts();
        const index = list.findIndex(item => String(item?.name || '').trim() === safeHostName);

        if (index >= 0) {
            list.splice(index, 1);
            this.saveFollowedHosts(list);
            this.clearHostRecords(safeHostName);
            return { followed: false, list };
        }

        list.push({
            name: safeHostName,
            avatarUrl: safeAvatarUrl,
            figure: '魅魔',
            boundVideoUrl: '',
            lastActiveAt: 0,
            favorability: 0
        });
        this.saveFollowedHosts(list);
        return { followed: true, list };
    }

    removeFollowedHost(hostName) {
        const safeHostName = String(hostName || '').trim();
        if (!safeHostName) return this.getFollowedHosts();
        const list = this.getFollowedHosts().filter(item => String(item?.name || '').trim() !== safeHostName);
        this.saveFollowedHosts(list);
        this.clearHostRecords(safeHostName);
        return list;
    }

    updateFollowedHost(hostName, patch = {}) {
        const safeHostName = String(hostName || '').trim();
        if (!safeHostName || !patch || typeof patch !== 'object') return null;

        const list = this.getFollowedHosts();
        const idx = list.findIndex(item => String(item?.name || '').trim() === safeHostName);
        if (idx < 0) return null;

        list[idx] = {
            ...list[idx],
            ...patch,
            name: safeHostName,
            avatarUrl: String((patch.avatarUrl ?? list[idx].avatarUrl) || '').trim(),
            figure: String((patch.figure ?? list[idx].figure) || '魅魔').trim() || '魅魔',
            boundVideoUrl: String((patch.boundVideoUrl ?? list[idx].boundVideoUrl) || '').trim(),
            lastActiveAt: Number(patch.lastActiveAt ?? list[idx].lastActiveAt) || 0,
            favorability: this._clampFavorability(patch.favorability ?? patch.affection ?? list[idx].favorability, 0)
        };
        this.saveFollowedHosts(list);
        return list[idx];
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
            this.storage?.remove?.('honey_last_scene');
            this._scheduleFlushChatPersistence();
        }
    }

    clearHostRecords(hostName) {
        const safeHostName = String(hostName || '').trim();
        if (!safeHostName) return;

        const historyKey = this._hostHistoryStorageKey(safeHostName);
        if (historyKey) {
            this.storage?.remove?.(historyKey);
        }
        this._clearHostRelatedSceneCache(safeHostName);
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

    getHostHistory(hostName) {
        const key = this._hostHistoryStorageKey(hostName);
        if (!key) return {};
        const parsed = this._readJSON(key, {});
        return parsed && typeof parsed === 'object' ? parsed : {};
    }

    saveHostHistory(hostName, dateStr, sceneData) {
        const key = this._hostHistoryStorageKey(hostName);
        if (!key || !sceneData || typeof sceneData !== 'object') return;
        const dateKey = this._normalizeSceneDate(dateStr);
        const history = this.getHostHistory(hostName);
        history[dateKey] = this._deepCloneSceneData(sceneData);
        this.storage?.set?.(key, JSON.stringify(history));
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
        this._lastSceneCache = scene;
        this.storage?.set?.('honey_last_scene', JSON.stringify(scene));
        this._scheduleFlushChatPersistence();
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
                const merged = { ...topicScene, ...currentSceneData };
                const currentDesc = currentSceneData.description;
                const topicDesc = topicScene.description;
                merged.description = this._isMeaningfulDescription(currentDesc)
                    ? currentDesc
                    : (this._isMeaningfulDescription(topicDesc) ? topicDesc : (currentDesc || topicDesc || ''));

                if ((!Array.isArray(currentSceneData.comments) || currentSceneData.comments.length === 0)
                    && Array.isArray(topicScene.comments) && topicScene.comments.length > 0) {
                    merged.comments = topicScene.comments;
                }
                if ((!Array.isArray(currentSceneData.gifts) || currentSceneData.gifts.length === 0)
                    && Array.isArray(topicScene.gifts) && topicScene.gifts.length > 0) {
                    merged.gifts = topicScene.gifts;
                }

                currentSceneData = merged;
            }
        }
        return {
            recommendTopics: Array.isArray(recommendTopics) ? recommendTopics : [],
            selectedTopicKey: selectedTopicKey || '',
            selectedTopicTitle: selectedTopicTitle || '',
            currentSceneData: currentSceneData && typeof currentSceneData === 'object' ? currentSceneData : null
        };
    }

    clearGeneratedSessionData() {
        // 先清理关注列表及其历史备份（honey_history_*）
        const followedHosts = this.getFollowedHosts();
        followedHosts.forEach((item) => {
            const hostName = String(item?.name || '').trim();
            if (!hostName) return;
            const historyKey = this._hostHistoryStorageKey(hostName);
            if (!historyKey) return;
            this.storage?.remove?.(historyKey);
        });
        this.storage?.remove?.('honey_followed_hosts');

        // 兜底：清理异常残留的 honey_history_* 键（例如已丢失关注列表但历史还在）
        const chatStore = this.storage?._getChatMetadataStore?.();
        if (chatStore && typeof chatStore === 'object') {
            Object.keys(chatStore)
                .filter(key => /^honey_history_/i.test(String(key || '')))
                .forEach((key) => this.storage?.remove?.(key));
        }

        this._topicScenesCache = {};
        this._selectedTopicCache = '';
        this._lastSceneCache = null;
        this.storage?.remove?.('honey_topic_scenes');
        this.storage?.remove?.('honey_selected_topic');
        this.storage?.remove?.('honey_selected_topic_key');
        this.storage?.remove?.('honey_last_scene');
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

    async generateLiveScene(onProgress, options = {}) {
        if (onProgress) onProgress('正在连线直播间...');

        const promptManager = window.VirtualPhone?.promptManager;
        promptManager?.ensureLoaded();
        const honeyPrompt = promptManager?.getPromptForFeature('honey', 'live') || '';
        const runtimeContext = this._buildLiveRuntimeContext(options);
        const honeyNickname = this._sanitizeInlineText(this.getHoneyUserNickname(), 24) || '你';
        const safeUserMessage = this._sanitizeInlineText(options?.userMessage || '', 220);
        const safeUserMessageWithNick = this._formatLiveUserMessageForPrompt(safeUserMessage, honeyNickname);
        const historyTurns = this._normalizeContinuePromptTurns(options?.promptTurns);
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
        } else if (mode === 'continue') {
            instructionUserPrompt = '';
            instructionSystemPrompt = [
                '这是同一场直播的持续观看，不要重置世界线。请在已有内容上推进剧情并更新评论区。',
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
                    const dateKeys = Object.keys(historyMap).sort((a, b) => String(a).localeCompare(String(b)));

                    const allTurns = [];
                    const seenTurns = new Set();

                    dateKeys.forEach(dateKey => {
                        const dayScene = historyMap[dateKey];
                        const dayTurns = this._normalizeContinuePromptTurns(dayScene?.promptTurns);

                        let addedForDate = false;
                        dayTurns.forEach(turn => {
                            const hash = this._simpleHash(String(turn.assistantContext || '') + String(turn.userMessage || ''));
                            // 使用 hash 去重，防止跨日结算时的数据重复追加
                            if (seenTurns.has(hash)) return;
                            if (!addedForDate) {
                                allTurns.push({ role: 'system', content: `\n――― 日期：${dateKey} ―――\n` });
                                addedForDate = true;
                            }
                            seenTurns.add(hash);
                            allTurns.push({ role: 'assistant', content: turn.assistantContext });
                            allTurns.push({ role: 'user', content: turn.userMessage });
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
                    extraMessages.push({ role: 'assistant', content: turn.assistantContext });
                    extraMessages.push({ role: 'user', content: turn.userMessage });
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
        const messages = [{ role: 'system', content: systemPrompt, isPhoneMessage: true }];
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
        const parsed = this.parseHoneyContent(filteredText || rawText);
        if (mode === 'continue') {
            const nextPromptTurns = [...historyTurns];
            if (runtimeContext && safeUserMessageWithNick) {
                nextPromptTurns.push({
                    assistantContext: runtimeContext,
                    userMessage: safeUserMessageWithNick
                });
            }
            parsed.promptTurns = nextPromptTurns;
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
            recommendTopics: []
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
                end: /(?:^|\n)\s*(?:\[\s*打赏记录\s*\]|打赏记录|\[\s*直播剧情描写\s*\]|直播剧情描写|\[\s*评论区\s*\]|评论区)\s*(?:[：:]|\]|\n|$)/i
            }
        ]);
        if (leaderboardSection) {
            data.leaderboard = this._parseLeaderboardSection(leaderboardSection, 3);
        }

        const naiMatch = liveSection.match(/NAI提示词\s*[：:]\s*([^\]\n]+)/i);
        if (naiMatch) data.naiPrompt = naiMatch[1].trim();

        const introMatch = liveSection.match(/(?:^|\n)\s*简介\s*[：:]\s*([^\n]+)\s*(?:\n|$)/i);
        if (introMatch) data.intro = introMatch[1].trim();

        const giftsSection = this._extractSectionByPatternPairs(liveSection, [
            {
                start: /(?:^|\n)\s*\[\s*打赏记录\s*\]\s*(?:\n|$)/i,
                end: /(?:^|\n)\s*(?:\[\s*(?:直播剧情描写|评论区)\s*\]|直播剧情描写\s*[：:]|评论区\s*[：:]|\[\s*评论区\s*\])\s*/i
            },
            {
                start: /(?:^|\n)\s*打赏记录\s*[：:]\s*/i,
                end: /(?:^|\n)\s*(?:\[\s*(?:直播剧情描写|评论区)\s*\]|直播剧情描写\s*[：:]|评论区\s*[：:]|\[\s*评论区\s*\])\s*/i
            }
        ]);
        if (giftsSection) {
            data.gifts = giftsSection
                .split('\n')
                .map(line => line.replace(/^\s*(?:[-*•]+|\d{1,2}\s*[\.、])\s*/, '').trim())
                .filter(line => line && /(?:打赏|送出|赠送|贡献|金币|金豆|[🌹🍆🍑💋🔗⛓️📿🪢🏎️🚀💎👑🍾])/u.test(line));
        }

        const commentHeaderPattern = /(?:^|\n)\s*(?:\[\s*评论区\s*\][^\n]*|评论区\s*[：:][^\n]*)(?:\n|$)/i;

        const storySection = this._extractSectionByPatternPairs(liveSection, [
            { start: /(?:^|\n)\s*\[\s*直播剧情描写\s*\]\s*(?:\n|$)/i, end: commentHeaderPattern },
            { start: /(?:^|\n)\s*直播剧情描写\s*[：:]\s*/i, end: commentHeaderPattern }
        ]);
        if (storySection) {
            const cleanedStory = storySection
                .split('\n')
                .map(line => line.replace(/\s+$/g, ''))
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
            { start: commentHeaderPattern, end: null }
        ]);
        if (commentsSection) {
            const comments = commentsSection
                .split('\n')
                .map(line => this._normalizeCommentLine(line))
                .filter(Boolean)
                .slice(-24);
            if (comments.length > 0) {
                data.comments = comments;
            }
        }
        if (!data.comments.length) {
            data.comments = ['系统公告: 连线成功，剧情已刷新。'];
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
        if (/^(?:互动区|打赏记录|直播剧情描写|画面|简介|主播|标题|在线人数|粉丝)[：:]/.test(text)) return '';
        if (/^\[\s*评论区\s*\]/i.test(text)) return '';
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
            const content = this._sanitizeInlineText(fallbackUserSplit[2], 180);
            if (!user || !content) return '';
            return `${rankPrefix}${user}: ${content}`.trim();
        }

        const fallback = this._sanitizeInlineText(text, 180);
        if (!fallback) return '';
        return `${rankPrefix}匿名: ${fallback}`.trim();
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

            const mapped = { title: '', host: '', viewers: '', tag: '' };
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
                intro: ''
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
