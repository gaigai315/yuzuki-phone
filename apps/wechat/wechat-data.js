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
// 微信数据管理
import { GlobalSocialStore } from '../../config/global-social-store.js';

const LOBBY_LINK_CHARACTER_IDS_KEY = 'phone-lobby-link-character-ids';
const LOBBY_LINK_GROUP_IDS_KEY = 'phone-lobby-link-group-ids';
const GLOBAL_WECHAT_CHATLIST_BACKGROUND_KEY = 'global_wechat_chatlist_background';
const GLOBAL_WECHAT_CHATLIST_BACKGROUND_NONE = '__none__';

export class WechatData {
    constructor(storage) {
        this.storage = storage;
        this.storageKey = 'wechat_data';
        this.lobbyGlobalStorageKey = 'phone_wechat_data_lobby_global';
        this.customEmojiGlobalKey = 'phone_custom_emojis_global';
        this.messageKeyPrefix = 'wechat_msg';  // 🔥 消息单独存储的键前缀
        this.lobbyGlobalMessageKeyPrefix = 'phone_wechat_msg_lobby'; // 🔥 大厅模式消息全局存储键前缀
        this.walletDefaultKey = '__default__'; // 会话钱包默认键（用于未指定chatId时）
        this.globalSocialStore = new GlobalSocialStore(storage);
        this._lobbyPersonaProfileCache = new Map();
        this._lobbyPersonaCacheTTL = 10 * 60 * 1000;
        this._lobbyPersonaEmptyCacheTTL = 45 * 1000;
        this._lobbyPersonaCacheMax = 128;

        // 🔥 懒加载机制：分离轻量数据和消息内容
        this._messagesLoaded = {};  // 记录哪些聊天的消息已加载
        this._messagesDirty = {};   // 记录哪些聊天的消息需要保存

        this.data = this.loadData();
    }

    _normalizeContactNameKey(name) {
        return String(name || '')
            .trim()
            .replace(/\s+/g, '')
            .toLowerCase();
    }

    _getHoneyDeletedWechatContactKey(name = '') {
        const key = this._normalizeContactNameKey(name || '');
        return key ? `honey_deleted_wechat_contact_${key}` : '';
    }

    _readHoneyDeletedWechatContact(name = '') {
        const key = this._getHoneyDeletedWechatContactKey(name);
        if (!key) return null;
        try {
            const raw = this.storage?.get?.(key);
            if (!raw) return null;
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return (parsed && typeof parsed === 'object') ? parsed : null;
        } catch (e) {
            return null;
        }
    }

    _markHoneyDeletedWechatContact(contact = {}) {
        const safeName = String(contact?.name || '').trim();
        const key = this._getHoneyDeletedWechatContactKey(safeName);
        if (!key) return false;
        this.storage?.set?.(key, JSON.stringify({
            name: safeName,
            contactId: String(contact?.id || '').trim(),
            sourceApp: String(contact?.sourceApp || contact?.extra?.sourceApp || '').trim(),
            sourceLabel: String(contact?.sourceLabel || contact?.extra?.sourceLabel || '').trim(),
            deletedAt: Date.now()
        }));
        return true;
    }

    _isHoneySyncedContact(contactLike = {}) {
        const relation = String(contactLike?.relation || '').trim();
        const sourceApp = String(contactLike?.sourceApp || contactLike?.extra?.sourceApp || '').trim().toLowerCase();
        const sourceLabel = String(contactLike?.sourceLabel || contactLike?.extra?.sourceLabel || '').trim();
        return sourceApp === 'honey'
            || sourceLabel.includes('蜜语')
            || sourceLabel.includes('主播')
            || relation.includes('蜜语')
            || relation.includes('主播');
    }

    _normalizeBooleanValue(value, fallback = false) {
        if (value === true || value === 'true' || value === 1 || value === '1') return true;
        if (value === false || value === 'false' || value === 0 || value === '0') return false;
        return !!fallback;
    }

    _normalizeChatList(chats = []) {
        if (!Array.isArray(chats)) return [];
        const seen = new Set();
        return chats
            .filter(chat => chat && typeof chat === 'object')
            .map((chat, index) => {
                const safeId = String(chat.id || chat.contactId || `chat_recovered_${index}`).trim();
                const safeName = String(chat.name || chat.remark || chat.nickname || '未命名聊天').trim();
                if (!safeId || !safeName || seen.has(safeId)) return null;
                seen.add(safeId);
                Object.assign(chat, {
                    id: safeId,
                    name: safeName,
                    type: String(chat.type || '').trim() === 'group' ? 'group' : 'single',
                    members: Array.isArray(chat.members) ? chat.members.filter(Boolean) : [],
                    unread: Math.max(0, Number.parseInt(chat.unread || 0, 10) || 0),
                    timestamp: Number(chat.timestamp || 0) || 0,
                    pinnedAt: Math.max(0, Number(chat.pinnedAt || 0) || 0),
                    lastMessage: String(chat.lastMessage || ''),
                    time: String(chat.time || '')
                });
                return chat;
            })
            .filter(Boolean);
    }

    isHoneyHistoryInjectionEnabledForChat(chatId) {
        const chat = this.getChat(chatId);
        if (!chat || chat.type === 'group') return false;
        const contact = chat.contactId ? this.getContact(chat.contactId) : this.getContactByName(chat.name);
        if (this._isHoneySyncedContact(contact) || this._isHoneySyncedContact(chat)) return true;
        return this._normalizeBooleanValue(chat.injectHoneyHistoryEnabled, false)
            || this._normalizeBooleanValue(contact?.injectHoneyHistoryEnabled, false);
    }

    setHoneyHistoryInjectionForChat(chatId, enabled) {
        const chat = this.getChat(chatId);
        if (!chat || chat.type === 'group') return false;
        const nextEnabled = !!enabled;
        chat.injectHoneyHistoryEnabled = nextEnabled;
        if (chat.contactId) {
            const contact = this.getContact(chat.contactId);
            if (contact) contact.injectHoneyHistoryEnabled = nextEnabled;
        }
        this.saveData();
        return true;
    }

    isProfileContextInjectionEnabledForChat(chatId) {
        const chat = this.getChat(chatId);
        if (!chat || chat.type === 'group') return true;
        return chat.injectProfileContextEnabled !== false;
    }

    setProfileContextInjectionForChat(chatId, enabled) {
        const chat = this.getChat(chatId);
        if (!chat || chat.type === 'group') return false;
        chat.injectProfileContextEnabled = !!enabled;
        this.saveData();
        return true;
    }

    getHoneyHistoryInjectionChats() {
        const chats = Array.isArray(this.data?.chats) ? this.data.chats : [];
        return chats.filter(chat => this.isHoneyHistoryInjectionEnabledForChat(chat?.id));
    }

    recordHoneyInviteDecision(contactName, decision, details = {}) {
        const safeName = String(contactName || '').trim();
        if (!safeName) return null;
        const decisionText = String(decision || '').trim() || 'pending';
        const contact = this.getContactByName(safeName);
        const chat = contact?.id ? this.getChatByContactId(contact.id) : this.getChatList().find(item => item.type !== 'group' && this._isSameLookupName(item.name, safeName));
        const nowText = String(details?.time || '').trim() || new Date().toISOString();
        const record = {
            decision: decisionText,
            at: nowText,
            message: String(details?.message || '').trim(),
            source: 'wechat_honey_invite'
        };
        if (chat) {
            chat.honeyInviteState = record;
            if (decisionText === 'accepted') chat.injectHoneyHistoryEnabled = true;
        }
        if (contact?.id) {
            contact.honeyInviteState = record;
            if (decisionText === 'accepted') contact.injectHoneyHistoryEnabled = true;
        }
        this.saveData();
        return record;
    }

    /**
     * 🔥 懒加载：初始化时只加载轻量数据（聊天列表、联系人、用户信息）
     * 消息内容在进入聊天时才从单独的存储键加载
     */
    loadData() {
        try {
            const key = this.getStorageKey();
            let saved = this.storage.get(key, false);
            const isLobby = this._isLobbyMode();
            if ((!saved || String(saved).trim() === '') && isLobby) {
                const legacyKey = this.getStorageKey(null, { legacy: true });
                const legacySaved = this.storage.get(legacyKey, false);
                if (legacySaved && String(legacySaved).trim() !== '') {
                    saved = legacySaved;
                    this.storage.set(key, legacySaved, false);
                }
            }

            if (saved && saved.trim() !== '') {
                try {
                    const data = JSON.parse(saved);
                    const normalizedUserInfo = this._normalizeUserInfo(data.userInfo);

                    // 🔥 先构建 chats 数组（迁移需要用到）
                    const chats = this._normalizeChatList(data.chats || []);
                    const contacts = Array.isArray(data.contacts) ? data.contacts.filter(Boolean) : [];
                    chats.forEach((chat) => {
                        if (!chat || !chat.contactId) return;
                        const contact = contacts.find(item => item?.id === chat.contactId);
                        if (contact?.injectHoneyHistoryEnabled !== undefined) {
                            chat.injectHoneyHistoryEnabled = this._normalizeBooleanValue(contact.injectHoneyHistoryEnabled, false);
                        }
                    });
                    const legacyCustomEmojis = this._normalizeCustomEmojiList(data.customEmojis || []);
                    const globalCustomEmojis = this._loadGlobalCustomEmojis();
                    const mergedCustomEmojis = this._mergeCustomEmojiLists(globalCustomEmojis, legacyCustomEmojis);

                    // 🔥 迁移：把旧的会话级 customEmojis 合并到全局存储
                    if (!this._isSameCustomEmojiList(globalCustomEmojis, mergedCustomEmojis)) {
                        this._saveGlobalCustomEmojis(mergedCustomEmojis);
                    }

                    // 🔥 数据迁移：检查是否有旧格式的 messages 数据
                    if (data.messages && Object.keys(data.messages).length > 0) {
                        console.log('🔄 [数据迁移] 检测到旧格式数据，开始迁移消息到独立存储...');
                        this._migrateOldMessages(data.messages, chats);

                        // 🔥 迁移完成后，保存更新的基础数据（不含 messages，防止重复迁移）
                        const migratedData = {
                            userInfo: normalizedUserInfo,
                            chats: chats,  // 已更新 timestamp
                            contacts: contacts,
                            moments: data.moments || [],
                            contactGenderMap: data.contactGenderMap || {},
                            contactAvatarGroupMap: data.contactAvatarGroupMap || {},
                            contactAutoAvatarMap: data.contactAutoAvatarMap || {},
                            walletByChat: data.walletByChat || {},
                            honeyInviteLog: data.honeyInviteLog || []
                            // 🔥 不再包含 messages 字段
                        };
                        this.storage.set(key, JSON.stringify(migratedData), false);
                        console.log('✅ [数据迁移] 基础数据已更新保存');
                    }

                    // 兼容旧版：若还没有会话钱包映射，则把历史全局余额迁移为默认钱包
                    const walletByChat = data.walletByChat || {};
                    if (Object.keys(walletByChat).length === 0) {
                        const legacyBalance = data.userInfo?.walletBalance;
                        if (legacyBalance !== null && legacyBalance !== undefined && !isNaN(legacyBalance)) {
                            walletByChat[this.walletDefaultKey] = parseFloat(legacyBalance);
                        }
                    }

                    // 🔥 懒加载：不加载 messages，初始为空
                    return {
                        userInfo: normalizedUserInfo,
                        chats: chats,
                        contacts: contacts,
                        messages: {},  // 🔥 初始为空，按需从单独存储加载
                        moments: data.moments || [],
                        customEmojis: mergedCustomEmojis,
                        contactGenderMap: data.contactGenderMap || {},
                        contactAvatarGroupMap: data.contactAvatarGroupMap || {},
                        contactAutoAvatarMap: data.contactAutoAvatarMap || {},
                        walletByChat: walletByChat,
                        musicListening: data.musicListening || {},
                        honeyInviteLog: data.honeyInviteLog || []
                    };
                } catch (parseError) {
                    console.error('❌ JSON解析失败:', parseError.message);
                    this.storage.set(key, null, false);
                    console.warn('⚠️ 已清空损坏的数据，将创建新数据');
                }
            }
        } catch (e) {
            console.error('❌ 加载微信数据失败:', e);
        }

        return {
            userInfo: this._normalizeUserInfo(null),
            chats: [],
            contacts: [],
            messages: {},
            moments: [],
            customEmojis: this._loadGlobalCustomEmojis(),
            contactGenderMap: {},
            contactAvatarGroupMap: {},
            contactAutoAvatarMap: {},
            walletByChat: {},
            musicListening: {}
        };
    }

    /**
     * 🔥 数据迁移：将旧格式的 messages 迁移到独立存储
     * @param {Object} oldMessages - 旧格式的消息数据
     * @param {Array} chats - 聊天列表（用于更新 timestamp）
     */
    _migrateOldMessages(oldMessages, chats) {
        let migratedCount = 0;

        for (const chatId in oldMessages) {
            const messages = oldMessages[chatId];
            if (messages && messages.length > 0) {
                try {
                    const msgKey = this._getMessageKey(chatId);
                    this.storage.set(msgKey, JSON.stringify(messages), false);
                    migratedCount++;

                    // 🔥 修复 chat.timestamp：从最后一条消息获取
                    const chat = chats.find(c => c.id === chatId);
                    if (chat && !chat.timestamp) {
                        const lastMsg = messages[messages.length - 1];
                        chat.timestamp = lastMsg.timestamp || Date.now();
                    }
                } catch (e) {
                    console.error(`❌ 迁移聊天 ${chatId} 消息失败:`, e);
                }
            }
        }

        console.log(`✅ [数据迁移] 已迁移 ${migratedCount} 个聊天的消息到独立存储`);
    }

    /**
     * 🔥 获取消息存储键（每个聊天单独存储）
     */
    _getMessageKey(chatId, context = null, { legacy = false } = {}) {
        const safeChatId = String(chatId || '').trim();
        if (!safeChatId) return `${this.messageKeyPrefix}_unknown`;
        if (legacy) return `${this.messageKeyPrefix}_${safeChatId}`;
        if (this._isLobbyMode(context)) {
            return `${this.lobbyGlobalMessageKeyPrefix}_${safeChatId}`;
        }
        return `${this.messageKeyPrefix}_${safeChatId}`;
    }

    /**
     * 🔥 获取运行时用户名字（优先取 SillyTavern 的 name1）
     */
    _getRuntimeUserName() {
        try {
            const context = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
                ? SillyTavern.getContext()
                : null;
            const name = String(context?.name1 || '').trim();
            if (name) return name;
        } catch (e) {
            // ignore
        }
        return '我';
    }

    _safeGetContext() {
        try {
            return (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
                ? SillyTavern.getContext()
                : null;
        } catch (e) {
            return null;
        }
    }

    _isLobbyMode(context = null) {
        const ctx = context || this._safeGetContext();
        const charName = String(ctx?.name2 || '').trim();
        if (/^SillyTavern System$/i.test(charName)) return true;
        const chatId = String(ctx?.chatMetadata?.file_name || ctx?.chatId || '').trim();
        if (chatId) return false;
        if (charName) return false;
        return true;
    }

    getOnlineModeStorageKey(context = null) {
        return this._isLobbyMode(context) ? 'phone_lobby_wechat_online_mode' : 'wechat_online_mode';
    }

    getOnlineOnlyModeStorageKey(context = null) {
        return this._isLobbyMode(context) ? 'phone_lobby_wechat_online_only_mode' : 'wechat_online_only_mode';
    }

    _parseIdList(raw) {
        if (!raw) return { hasStored: false, list: [] };
        try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!Array.isArray(parsed)) return { hasStored: true, list: [] };
            return {
                hasStored: true,
                list: parsed.map(item => String(item || '').trim()).filter(Boolean)
            };
        } catch (e) {
            return { hasStored: true, list: [] };
        }
    }

    _normalizeLobbyId(prefix, value, fallbackIndex = 0) {
        const raw = String(value || '').trim();
        if (raw) return `${prefix}:${raw}`;
        return `${prefix}:idx_${fallbackIndex}`;
    }

    _collectLobbyEntries(candidates = []) {
        const result = [];
        const push = (value) => {
            if (value === null || value === undefined) return;
            if (Array.isArray(value)) {
                value.forEach(item => push(item));
                return;
            }
            result.push(value);
        };

        candidates.forEach((candidate) => {
            if (!candidate) return;
            if (Array.isArray(candidate)) {
                push(candidate);
                return;
            }
            if (typeof candidate !== 'object') return;

            ['groups', 'groupList', 'list', 'items', 'data', 'character_groups', 'characterGroups', 'charGroups', 'characters'].forEach((key) => {
                if (candidate[key] !== undefined) push(candidate[key]);
            });

            Object.values(candidate).forEach((value) => {
                if (Array.isArray(value)) push(value);
            });
        });

        return result;
    }

    _normalizeLookupName(value = '') {
        return String(value || '')
            .trim()
            .replace(/\s+/g, '')
            .replace(/[（(][^（）()]*[）)]/g, '')
            .toLowerCase();
    }

    _normalizeExactContactName(value = '') {
        return String(value || '')
            .trim()
            .replace(/\s+/g, '')
            .toLowerCase();
    }

    _setLobbyPersonaCache(name = '', description = '') {
        const key = this._normalizeLookupName(name);
        if (!key || !this._lobbyPersonaProfileCache) return;
        this._lobbyPersonaProfileCache.set(key, {
            description: String(description || '').trim(),
            ts: Date.now()
        });
        if (this._lobbyPersonaProfileCache.size > this._lobbyPersonaCacheMax) {
            const oldestKey = this._lobbyPersonaProfileCache.keys().next().value;
            if (oldestKey) this._lobbyPersonaProfileCache.delete(oldestKey);
        }
    }

    _getLobbyPersonaCache(name = '') {
        const key = this._normalizeLookupName(name);
        if (!key || !this._lobbyPersonaProfileCache) return { hit: false, description: '' };
        const entry = this._lobbyPersonaProfileCache.get(key);
        if (!entry) return { hit: false, description: '' };
        const description = String(entry.description || '').trim();
        const ttl = description ? this._lobbyPersonaCacheTTL : this._lobbyPersonaEmptyCacheTTL;
        if ((Date.now() - Number(entry.ts || 0)) > ttl) {
            this._lobbyPersonaProfileCache.delete(key);
            return { hit: false, description: '' };
        }
        return { hit: true, description };
    }

    _extractPersonaUsers(context = null) {
        const ctx = context || this._safeGetContext();
        const users = [];
        const seen = new Set();
        const isLikelyValidPersonaName = (value) => {
            const text = String(value || '').trim();
            if (!text) return false;
            const lower = text.toLowerCase();
            if (text === '无') return false;
            if (lower === 'user avatar' || lower === 'avatar' || lower === 'default') return false;
            if (/\.png$|\.jpe?g$|\.webp$|\.gif$/i.test(text)) return false;
            if (/^\d{10,}[-_a-z0-9.]*$/i.test(text)) return false;
            if (text.length > 40) return false;
            if (/当前聊天|当前角色|绑定|映射|设定描述|persona|avatar/i.test(text)) return false;
            return true;
        };
        const append = (nameRaw, idRaw = '') => {
            const name = String(nameRaw || '').trim();
            if (!isLikelyValidPersonaName(name)) return;
            const key = String(idRaw || name).trim().toLowerCase();
            if (!key || seen.has(key)) return;
            seen.add(key);
            users.push({ id: key, name });
        };

        const candidates = [
            window?.power_user?.personas,
            ctx?.power_user?.personas
        ];

        candidates.forEach((personaStore) => {
            if (!personaStore) return;
            if (Array.isArray(personaStore)) {
                personaStore.forEach((item, index) => {
                    if (typeof item === 'string') {
                        append(item, `arr_${index}_${item}`);
                        return;
                    }
                    append(item?.name || item?.personaName || item?.user || item?.displayName, item?.avatar || item?.id || index);
                });
                return;
            }
            if (typeof personaStore === 'object') {
                Object.entries(personaStore).forEach(([avatar, value]) => {
                    if (typeof value === 'string') {
                        append(value, avatar);
                        return;
                    }
                    append(value?.name || value?.personaName || value?.displayName || value?.user, avatar);
                });
            }
        });

        const avatarContainers = document.querySelectorAll('#user_avatar_block .avatar-container, #user_avatar_block .avatar-container.interactable');
        avatarContainers.forEach((node, index) => {
            const text = String(
                node.querySelector?.('.ch_name')?.textContent
                || node.querySelector?.('.avatar_name')?.textContent
                || node.querySelector?.('.name')?.textContent
                || node.querySelector?.('.avatar_label')?.textContent
                || ''
            ).trim();
            const avatarId = String(node.getAttribute?.('data-avatar-id') || '').trim();
            append(text, avatarId || `dom_${index}_${text}`);
        });

        return users;
    }

    _extractLobbyCharacters(context = null) {
        const ctx = context || this._safeGetContext();
        const source = this._collectLobbyEntries([
            window?.characters,
            ctx?.characters,
            window?.character_list,
            ctx?.character_list
        ]);
        if (!Array.isArray(source) || source.length === 0) return [];
        const list = [];
        const seen = new Set();
        source.forEach((char, index) => {
            if (!char) return;
            const name = String(char.name || char.data?.name || '').trim();
            if (!name) return;
            const id = this._normalizeLobbyId(
                'char',
                char.avatar || char.id || char.character_id || char.data?.name || name,
                index
            );
            if (seen.has(id)) return;
            seen.add(id);
            const data = (char && typeof char.data === 'object') ? char.data : {};
            list.push({
                id,
                name,
                personality: String(char.personality || data.personality || '').trim(),
                description: String(char.description || data.description || data.context || '').trim(),
                scenario: String(char.scenario || data.scenario || '').trim(),
                systemPrompt: String(char.system_prompt || data.system_prompt || '').trim()
            });
        });
        return list;
    }

    _extractLobbyGroups(context = null) {
        const ctx = context || this._safeGetContext();
        const source = this._collectLobbyEntries([
            window?.groups,
            window?.character_groups,
            window?.charGroups,
            window?.characterGroups,
            ctx?.groups,
            ctx?.character_groups,
            ctx?.characterGroups,
            window?.groupCandidates,
            ctx?.groupCandidates
        ]);
        const list = [];
        const seen = new Set();
        if (Array.isArray(source) && source.length > 0) {
            source.forEach((group, index) => {
                const isString = typeof group === 'string';
                const name = String(isString ? group : (group?.name || group?.title || group?.id || '')).trim();
                if (!name) return;
                const rawMembers = Array.isArray(group?.members)
                    ? group.members
                    : (Array.isArray(group?.characters) ? group.characters : []);
                const memberNames = rawMembers
                    .map(member => String(member?.name || member?.avatar || member || '').trim())
                    .filter(Boolean);
                const id = this._normalizeLobbyId('group', group?.id || group?.name || name, index);
                if (seen.has(id)) return;
                seen.add(id);
                list.push({ id, name, members: memberNames });
            });
        }

        const personaUsers = this._extractPersonaUsers(ctx);
        personaUsers.forEach((user, index) => {
            const id = this._normalizeLobbyId('group_persona', user.id || user.name, index);
            if (seen.has(id)) return;
            seen.add(id);
            list.push({ id, name: user.name, members: [user.name] });
        });
        return list;
    }

    _buildLobbyLinkSelection(context = null) {
        const ctx = context || this._safeGetContext();
        const isLobby = this._isLobbyMode(ctx);
        if (!isLobby) return { isLobby: false, characters: [], groups: [] };

        const allCharacters = this._extractLobbyCharacters(ctx);
        const allGroups = this._extractLobbyGroups(ctx);
        const characterIds = this._parseIdList(this.storage.get(LOBBY_LINK_CHARACTER_IDS_KEY));
        const groupIds = this._parseIdList(this.storage.get(LOBBY_LINK_GROUP_IDS_KEY));

        const characterSet = new Set(
            characterIds.hasStored ? characterIds.list : allCharacters.map(item => item.id)
        );
        const groupSet = new Set(
            groupIds.hasStored ? groupIds.list : allGroups.map(item => item.id)
        );
        const selectedGroups = allGroups.filter(item => groupSet.has(item.id));

        const byId = new Map(allCharacters.map(item => [String(item.id), item]));
        const byName = new Map(allCharacters.map(item => [this._normalizeLookupName(item.name), item]));
        const selectedCharacterMap = new Map();
        allCharacters.forEach((item) => {
            if (characterSet.has(item.id)) selectedCharacterMap.set(item.id, item);
        });

        selectedGroups.forEach((group) => {
            const members = Array.isArray(group.members) ? group.members : [];
            members.forEach((member) => {
                const raw = String(member || '').trim();
                if (!raw) return;
                const memberIdKey = raw.startsWith('char:') ? raw : `char:${raw}`;
                const matchedById = byId.get(memberIdKey);
                if (matchedById) {
                    selectedCharacterMap.set(matchedById.id, matchedById);
                    return;
                }
                const matchedByName = byName.get(this._normalizeLookupName(raw));
                if (matchedByName) {
                    selectedCharacterMap.set(matchedByName.id, matchedByName);
                }
            });
        });

        return {
            isLobby: true,
            characters: Array.from(selectedCharacterMap.values()),
            groups: selectedGroups
        };
    }

    _resolveLobbySelectedUsers(lobbySelection = null) {
        const selection = lobbySelection || this._buildLobbyLinkSelection(this._safeGetContext());
        if (!selection?.isLobby) return [];
        return (selection.groups || [])
            .filter(item => String(item?.id || '').startsWith('group_persona:'))
            .map(item => {
                const members = Array.isArray(item?.members) ? item.members : [];
                return String(members[0] || item?.name || '').trim();
            })
            .filter(Boolean);
    }

    _extractPersonaProfiles(context = null) {
        const ctx = context || this._safeGetContext();
        const profiles = [];
        const seen = new Set();
        const normalizeKey = (value = '') => this._normalizeLookupName(String(value || ''));
        const pushProfile = (nameRaw, idRaw = '', descriptionRaw = '') => {
            const name = String(nameRaw || '').trim();
            if (!name) return;
            const key = normalizeKey(name);
            if (!key) return;
            const description = String(descriptionRaw || '').trim();
            if (seen.has(key)) {
                if (!description) return;
                const existed = profiles.find(item => item.key === key);
                if (existed && !existed.description) existed.description = description;
                return;
            }
            seen.add(key);
            profiles.push({
                key,
                id: String(idRaw || name).trim().toLowerCase(),
                name,
                description
            });
        };

        const avatarNameMap = new Map();
        document.querySelectorAll('#user_avatar_block .avatar-container, #user_avatar_block .avatar-container.interactable').forEach((node, index) => {
            const name = String(
                node.querySelector?.('.ch_name')?.textContent
                || node.querySelector?.('.avatar_name')?.textContent
                || node.querySelector?.('.name')?.textContent
                || node.querySelector?.('.avatar_label')?.textContent
                || ''
            ).trim();
            if (!name) return;
            const avatarId = String(node.getAttribute?.('data-avatar-id') || '').trim() || `dom_${index}_${name}`;
            avatarNameMap.set(avatarId, name);
            pushProfile(name, avatarId, '');
        });

        const candidates = [window?.power_user?.personas, ctx?.power_user?.personas];
        candidates.forEach((personaStore) => {
            if (!personaStore) return;
            if (Array.isArray(personaStore)) {
                personaStore.forEach((item, index) => {
                    if (typeof item === 'string') {
                        return;
                    }
                    const avatarId = String(item?.avatar || item?.id || '').trim();
                    const name = String(item?.name || item?.personaName || item?.user || item?.displayName || avatarNameMap.get(avatarId) || '').trim();
                    const description = String(
                        item?.description
                        || item?.desc
                        || item?.persona
                        || item?.content
                        || item?.text
                        || item?.prompt
                        || item?.bio
                        || item?.details
                        || ''
                    ).trim();
                    pushProfile(name, avatarId || index, description);
                });
                return;
            }
            if (typeof personaStore === 'object') {
                Object.entries(personaStore).forEach(([avatarId, value]) => {
                    const safeAvatarId = String(avatarId || '').trim();
                    if (typeof value === 'string') {
                        const mappedName = String(avatarNameMap.get(safeAvatarId) || '').trim();
                        // In many ST builds, object value is persona text and key is avatar-id.
                        if (mappedName) {
                            pushProfile(mappedName, safeAvatarId, value);
                        } else {
                            const isLikelyDescription = /[\r\n]|[:：]/.test(value) || value.length > 30;
                            if (!isLikelyDescription) {
                                pushProfile(value, safeAvatarId, '');
                            }
                        }
                        return;
                    }
                    const name = String(
                        value?.name
                        || value?.personaName
                        || value?.displayName
                        || value?.user
                        || avatarNameMap.get(safeAvatarId)
                        || ''
                    ).trim();
                    const description = String(
                        value?.description
                        || value?.desc
                        || value?.persona
                        || value?.content
                        || value?.text
                        || value?.prompt
                        || value?.bio
                        || value?.details
                        || ''
                    ).trim();
                    pushProfile(name, safeAvatarId, description);
                });
            }
        });

        const selectedName = String(
            document.querySelector('#user_avatar_block .avatar-container.selected .ch_name')?.textContent
            || document.querySelector('#user_avatar_block .avatar-container.selected .avatar_name')?.textContent
            || document.querySelector('#user_avatar_block .avatar-container.selected .name')?.textContent
            || ''
        ).trim();
        const selectedDescription = String(document.getElementById('persona_description')?.value || '').trim();
        if (selectedName) {
            pushProfile(selectedName, selectedName, selectedDescription);
        }

        return profiles;
    }

    async _collectPersonaProfilesByUserSelection(selectedUsers = []) {
        const names = Array.isArray(selectedUsers)
            ? selectedUsers.map(item => String(item || '').trim()).filter(Boolean)
            : [];
        if (names.length === 0) return [];

        const containers = Array.from(document.querySelectorAll('#user_avatar_block .avatar-container, #user_avatar_block .avatar-container.interactable'));
        if (containers.length === 0) return names.map(name => ({ name, description: '' }));

        const normalizeKey = (value = '') => this._normalizeLookupName(String(value || ''));
        const getNameFromNode = (node) => String(
            node?.querySelector?.('.ch_name')?.textContent
            || node?.querySelector?.('.avatar_name')?.textContent
            || node?.querySelector?.('.name')?.textContent
            || node?.querySelector?.('.avatar_label')?.textContent
            || ''
        ).trim();
        const byName = new Map();
        containers.forEach((node) => {
            const name = getNameFromNode(node);
            const key = normalizeKey(name);
            if (!key || byName.has(key)) return;
            byName.set(key, node);
        });

        const sleep = (ms = 120) => new Promise(resolve => setTimeout(resolve, ms));
        const readPersonaDescription = () => String(document.getElementById('persona_description')?.value || '').trim();
        const dispatchSelect = (node) => {
            if (!node) return;
            const target = node.querySelector?.('.avatar, .avatar_img, .avatar-image, img, .ch_name, .avatar_name, .name') || node;
            const mouseTypes = ['mousedown', 'mouseup', 'click'];
            const pointerTypes = ['pointerdown', 'pointerup'];

            pointerTypes.forEach((type) => {
                try {
                    if (typeof window.PointerEvent === 'function') {
                        target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true }));
                    }
                } catch (_) {}
            });

            mouseTypes.forEach((type) => {
                try {
                    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
                } catch (_) {}
            });

            try { node.click?.(); } catch (_) {}
            try { target.click?.(); } catch (_) {}
        };
        const waitNodeSelected = async (node, timeoutMs = 900) => {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                if (node?.classList?.contains('selected')) return true;
                await sleep(60);
            }
            return !!node?.classList?.contains('selected');
        };
        const waitPersonaUpdate = async (beforeText = '', { expectChange = true, timeoutMs = 1400 } = {}) => {
            const base = String(beforeText || '').trim();
            if (!expectChange && base) return base;
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                const current = readPersonaDescription();
                if (current && (!expectChange || current !== base)) return current;
                await sleep(60);
            }
            return readPersonaDescription();
        };
        const selectedBefore = document.querySelector('#user_avatar_block .avatar-container.selected');
        const results = [];

        for (const userName of names) {
            const key = normalizeKey(userName);
            const targetNode = byName.get(key);
            if (!targetNode) {
                results.push({ name: userName, description: '' });
                continue;
            }

            let description = '';
            for (let attempt = 0; attempt < 3; attempt++) {
                const wasSelected = targetNode.classList.contains('selected');
                const beforeText = readPersonaDescription();
                if (!wasSelected || !beforeText) {
                    dispatchSelect(targetNode);
                    await waitNodeSelected(targetNode, 900);
                }
                description = await waitPersonaUpdate(beforeText, {
                    expectChange: !wasSelected,
                    timeoutMs: wasSelected ? 700 : 1500
                });
                if (description) break;
                await sleep(140);
            }

            results.push({ name: userName, description });
        }

        if (selectedBefore && document.body.contains(selectedBefore) && !selectedBefore.classList.contains('selected')) {
            dispatchSelect(selectedBefore);
            await waitNodeSelected(selectedBefore, 900);
            await sleep(100);
        }

        return results;
    }

    async _resolveLobbySelectedUserProfiles(lobbySelection = null, context = null) {
        const selectedUsers = this._resolveLobbySelectedUsers(lobbySelection);
        if (selectedUsers.length === 0) return [];
        const profileMap = new Map(
            this._extractPersonaProfiles(context).map(item => [this._normalizeLookupName(item.name), item])
        );
        const mergedProfiles = selectedUsers.map((name) => {
            const matched = profileMap.get(this._normalizeLookupName(name));
            return {
                name: String(name || '').trim(),
                description: String(matched?.description || '').trim()
            };
        }).filter(item => item.name);

        mergedProfiles.forEach((item) => {
            if (item.description) this._setLobbyPersonaCache(item.name, item.description);
        });

        const missingNames = [];
        mergedProfiles.forEach((item) => {
            if (item.description) return;
            const cached = this._getLobbyPersonaCache(item.name);
            if (cached.hit) {
                item.description = cached.description;
                return;
            }
            missingNames.push(item.name);
        });

        if (missingNames.length > 0) {
            const dynamicProfiles = await this._collectPersonaProfilesByUserSelection(missingNames);
            const dynamicMap = new Map(dynamicProfiles.map(item => [this._normalizeLookupName(item.name), String(item.description || '').trim()]));
            mergedProfiles.forEach((item) => {
                if (item.description) return;
                item.description = dynamicMap.get(this._normalizeLookupName(item.name)) || '';
            });
        }

        mergedProfiles.forEach((item) => {
            this._setLobbyPersonaCache(item.name, item.description || '');
        });

        return mergedProfiles;
    }

    _formatLobbyCharacterDetail(item = {}) {
        const name = String(item?.name || '').trim() || '未命名角色';
        const lines = [`- ${name}`];
        const description = String(item?.description || '').trim();
        const personality = String(item?.personality || '').trim();
        const scenario = String(item?.scenario || '').trim();
        const systemPrompt = String(item?.systemPrompt || '').trim();

        if (description) lines.push(`  描述：${description}`);
        if (personality) lines.push(`  性格：${personality}`);
        if (scenario) lines.push(`  场景：${scenario}`);
        if (systemPrompt) lines.push(`  系统提示词：${systemPrompt}`);
        if (lines.length === 1) lines.push('  （暂无可用详情）');
        return lines.join('\n');
    }

    async _buildWechatWorldbookText() {
        try {
            const manager = window.VirtualPhone?.worldbookManager;
            if (!manager) return '';
            const message = await manager.buildWorldbookMessage('wechat');
            return String(message?.content || '').trim();
        } catch (error) {
            console.warn('[Wechat] 读取世界书注入内容失败:', error);
            return '';
        }
    }

    /**
     * 🔥 归一化用户信息：
     * - 首次默认昵称取 user 名
     * - 历史默认值“我”自动升级为当前 user 名
     * - 用户手动改过的昵称保持不变
     */
    _normalizeUserInfo(userInfo) {
        const normalized = {
            ...this._getDefaultUserInfo(),
            ...(userInfo || {})
        };

        const currentName = String(normalized.name || '').trim();
        if (!currentName || currentName === '我') {
            normalized.name = this._getRuntimeUserName();
        }

        return normalized;
    }

    /**
     * 🔥 获取默认用户信息
     */
    _getDefaultUserInfo() {
        return {
            name: this._getRuntimeUserName(),
            wxid: 'wxid_' + Math.random().toString(36).substr(2, 9),
            avatar: '',
            signature: '',
            naiPromptTags: '',
            chatCustomCss: '',
            coverImage: null,
            momentsBackground: null,
            walletBalance: null,
            globalChatBackground: null, // 🔥新增：存储全局聊天背景
            chatListBackground: null // 🔥新增：微信聊天列表背景
        };
    }
    
    getStorageKey(context = null, { legacy = false } = {}) {
        if (legacy) return this.storageKey;
        return this._isLobbyMode(context) ? this.lobbyGlobalStorageKey : this.storageKey;
    }

    _getCustomEmojiGlobalKey() {
        return this.customEmojiGlobalKey;
    }

    _buildLegacyEmojiId(emoji = {}) {
        const seed = `${String(emoji?.name || '').trim()}|${String(emoji?.image || '').trim()}`;
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
            hash = ((hash * 31) + seed.charCodeAt(i)) >>> 0;
        }
        return `emoji_legacy_${hash.toString(36)}`;
    }

    _normalizeCustomEmojiList(list = []) {
        if (!Array.isArray(list)) return [];

        return list.map((emoji, index) => {
            const safeImage = String(emoji?.image || '').trim();
            if (!safeImage) return null;

            const safeName = String(emoji?.name || '').trim() || `表情${index + 1}`;
            const safeDescription = String(emoji?.description || emoji?.name || '').trim() || safeName;
            const safeId = String(emoji?.id || '').trim() || this._buildLegacyEmojiId({ name: safeName, image: safeImage });
            const safeCreatedAt = String(emoji?.createdAt || '').trim() || '1970-01-01T00:00:00.000Z';

            return {
                ...emoji,
                id: safeId,
                name: safeName,
                description: safeDescription,
                image: safeImage,
                createdAt: safeCreatedAt
            };
        }).filter(Boolean);
    }

    _mergeCustomEmojiLists(primaryList = [], secondaryList = []) {
        const merged = [];
        const seenIds = new Set();
        const seenImages = new Set();

        const append = (emoji) => {
            const safeId = String(emoji?.id || '').trim();
            const safeImage = String(emoji?.image || '').trim();
            if (!safeImage) return;
            if (safeId && seenIds.has(safeId)) return;
            if (seenImages.has(safeImage)) return;

            if (safeId) seenIds.add(safeId);
            seenImages.add(safeImage);
            merged.push(emoji);
        };

        this._normalizeCustomEmojiList(primaryList).forEach(append);
        this._normalizeCustomEmojiList(secondaryList).forEach(append);
        return merged;
    }

    _isSameCustomEmojiList(a = [], b = []) {
        return JSON.stringify(a || []) === JSON.stringify(b || []);
    }

    _loadGlobalCustomEmojis() {
        const raw = this.storage.get(this._getCustomEmojiGlobalKey(), '[]');
        if (Array.isArray(raw)) {
            return this._normalizeCustomEmojiList(raw);
        }
        if (typeof raw !== 'string' || raw.trim() === '') {
            return [];
        }

        try {
            const parsed = JSON.parse(raw);
            return this._normalizeCustomEmojiList(parsed);
        } catch (e) {
            console.warn('⚠️ [微信] 读取全局自定义表情失败:', e);
            return [];
        }
    }

    _saveGlobalCustomEmojis(list = []) {
        const normalized = this._normalizeCustomEmojiList(list);
        this.storage.set(this._getCustomEmojiGlobalKey(), JSON.stringify(normalized), false);
        return normalized;
    }

    _normalizeManagedBackgroundPath(pathLike) {
        const raw = String(pathLike || '').trim();
        if (!raw) return '';
        try {
            if (/^https?:\/\//i.test(raw)) {
                return new URL(raw).pathname.split('?')[0].split('#')[0];
            }
        } catch (e) { }
        return raw.split('?')[0].split('#')[0];
    }

    _collectManagedImagePathsFromValue(value, paths = new Set(), seen = new Set()) {
        if (value === null || value === undefined) return paths;

        if (typeof value === 'string') {
            const raw = value.trim();
            if (!raw) return paths;
            const direct = this._normalizeManagedBackgroundPath(raw);
            if (/^\/backgrounds\/phone_[^?#\s)）"'<>]+/i.test(direct)) {
                paths.add(direct);
            }
            const matches = raw.match(/\/backgrounds\/phone_[^?#\s)）"'<>]+/gi) || [];
            matches.forEach(match => {
                const normalized = this._normalizeManagedBackgroundPath(match);
                if (normalized) paths.add(normalized);
            });
            return paths;
        }

        if (typeof value !== 'object' || seen.has(value)) return paths;
        seen.add(value);

        if (Array.isArray(value)) {
            value.forEach(item => this._collectManagedImagePathsFromValue(item, paths, seen));
            return paths;
        }

        Object.values(value).forEach(item => this._collectManagedImagePathsFromValue(item, paths, seen));
        return paths;
    }

    _collectManagedImagePathsFromMessage(message, paths = new Set()) {
        if (!message || typeof message !== 'object') return paths;

        const mediaFields = [
            message.generatedImageUrl,
            message.imageUrl,
            message.imageData,
            message.mediaUrl,
            message.fileUrl,
            message.url,
            message.src
        ];

        if (String(message.type || '').trim() === 'image') {
            mediaFields.push(message.content, message.image);
        }

        mediaFields.forEach(value => this._collectManagedImagePathsFromValue(value, paths));
        return paths;
    }

    _collectManagedImagePathsFromMessages(messages = []) {
        const list = Array.isArray(messages) ? messages : [messages];
        const paths = new Set();
        list.forEach(message => this._collectManagedImagePathsFromMessage(message, paths));
        return Array.from(paths);
    }

    _cleanupManagedImagesForDeletedMessages(messages = []) {
        const paths = this._collectManagedImagePathsFromMessages(messages);
        if (paths.length === 0) return;

        const imageManager = window.VirtualPhone?.imageManager;
        if (!imageManager?.deleteManagedBackgroundByPath) return;

        const runCleanup = () => {
            paths.forEach(path => {
                imageManager.deleteManagedBackgroundByPath(path, {
                    quiet: true,
                    skipIfReferenced: true
                }).catch((e) => {
                    console.warn('⚠️ [微信数据] 清理消息图片文件失败:', path, e);
                });
            });
        };

        if (typeof queueMicrotask === 'function') {
            queueMicrotask(runCleanup);
        } else {
            Promise.resolve().then(runCleanup);
        }
    }

    _loadMessagesForChatIds(chatIds = []) {
        if (!Array.isArray(chatIds) || chatIds.length === 0) return;
        chatIds.forEach(chatId => {
            if (chatId) this.getMessages(chatId);
        });
    }
    
    async saveData() {
        try {
            // 🔥 验证数据有效性
            if (!this.data) {
                console.error('❌ 无效的数据，无法保存');
                return;
            }

            // 🔥 1. 保存基础数据（不含消息内容）
            const baseData = {
                userInfo: this.data.userInfo,
                chats: this.data.chats,
                contacts: this.data.contacts,
                moments: this.data.moments,
                contactGenderMap: this.data.contactGenderMap || {},
                contactAvatarGroupMap: this.data.contactAvatarGroupMap || {},
                contactAutoAvatarMap: this.data.contactAutoAvatarMap || {},
                walletByChat: this.data.walletByChat || {},
                musicListening: this.data.musicListening || {},
                honeyInviteLog: this.data.honeyInviteLog || []
                // 🔥 messages 不再保存到主数据中
            };

            const key = this.getStorageKey();
            const jsonStr = JSON.stringify(baseData);

            if (!jsonStr || jsonStr === 'null' || jsonStr === 'undefined') {
                console.error('❌ JSON序列化失败:', jsonStr);
                return;
            }

            await this.storage.set(key, jsonStr, false);

            // 🔥 2. 保存已修改的消息（每个聊天单独存储）
            for (const chatId in this._messagesDirty) {
                if (this._messagesDirty[chatId]) {
                    this._saveMessages(chatId);
                    this._messagesDirty[chatId] = false;
                }
            }
        } catch (e) {
            console.error('❌ 保存微信数据失败:', e);
        }
    }

    /**
     * 🗑️ 彻底重置微信数据（清空当前角色的所有微信内容）
     * 会删除独立存储的 wechat_msg_xxx 消息键，防止幽灵数据残留
     */
    resetAllData() {
        // 1. 删除每个聊天的独立消息存储键
        const chatIds = Array.isArray(this.data.chats) ? this.data.chats.map(c => c.id) : [];
        this._loadMessagesForChatIds(chatIds);
        const deletedMessages = Object.values(this.data.messages || {}).flatMap(messages => Array.isArray(messages) ? messages : []);
        this._removeMessageStoresByChatIds(chatIds);
        this.globalSocialStore?.removeAllAppContacts?.('wechat');
        this._clearLinkedHoneyFriendsForWechatReset();

        // 2. 清空内存中的懒加载标记
        this._messagesLoaded = {};
        this._messagesDirty = {};

        // 3. 重置内存数据为出厂状态
        this.data = {
            userInfo: this._getDefaultUserInfo(),
            chats: [],
            contacts: [],
            messages: {},
            moments: [],
            customEmojis: [],
            contactGenderMap: {},
            contactAvatarGroupMap: {},
            contactAutoAvatarMap: {},
            walletByChat: {},
            musicListening: {}
        };

        this._saveGlobalCustomEmojis([]);
        this._cleanupManagedImagesForDeletedMessages(deletedMessages);

        // 4. 保存重置后的空数据
        this.saveData();

        // 5. 触发 chatMetadata 立即持久化
        this._flushChatMetadata();
    }

    // 🧹 清理全部聊天数据（保留联系人/朋友圈）
    clearAllChatData() {
        const chatIds = Array.isArray(this.data.chats) ? this.data.chats.map(c => c.id) : [];
        this._loadMessagesForChatIds(chatIds);
        const deletedMessages = Object.values(this.data.messages || {}).flatMap(messages => Array.isArray(messages) ? messages : []);
        this._removeMessageStoresByChatIds(chatIds);

        this.data.chats = [];
        this.data.messages = {};
        this.data.walletByChat = {};
        this._messagesLoaded = {};
        this._messagesDirty = {};

        window.VirtualPhone?.timeManager?.resetTime();
        this._cleanupManagedImagesForDeletedMessages(deletedMessages);
        this.saveData();
        this._flushChatMetadata();
    }

    clearContactsAndGroupsForSmartLoad() {
        const chatIds = Array.isArray(this.data.chats) ? this.data.chats.map(c => c.id) : [];
        this._loadMessagesForChatIds(chatIds);
        const deletedMessages = Object.values(this.data.messages || {}).flatMap(messages => Array.isArray(messages) ? messages : []);
        this._removeMessageStoresByChatIds(chatIds);
        this.globalSocialStore?.removeAllAppContacts?.('wechat');
        this._clearLinkedHoneyFriendsForWechatReset();

        this.data.contacts = [];
        this.data.chats = [];
        this.data.messages = {};
        this.data.contactGenderMap = {};
        this.data.contactAvatarGroupMap = {};
        this.data.contactAutoAvatarMap = {};
        this.data.walletByChat = {};
        this.data.musicListening = {};
        this.data.honeyInviteLog = [];
        this._messagesLoaded = {};
        this._messagesDirty = {};

        this._cleanupManagedImagesForDeletedMessages(deletedMessages);
        this.saveData();
        this._flushChatMetadata();
        return true;
    }

    // 🧹 清理朋友圈数据（仅朋友圈内容）
    clearMomentsData() {
        this.data.moments = [];
        this.saveData();
    }

    _removeMessageStoresByChatIds(chatIds = []) {
        if (!Array.isArray(chatIds) || chatIds.length === 0) return;

        const chatStore = this.storage._getChatMetadataStore?.();
        chatIds.forEach(chatId => {
            if (!chatId) return;
            const msgKey = this._getMessageKey(chatId);

            if (chatStore && chatStore[msgKey] !== undefined) {
                delete chatStore[msgKey];
            }

            try {
                this.storage.set(msgKey, null, false);
            } catch (e) {
                // ignore
            }

            try {
                const legacyKey = `${this.storage.storageKey}_${this.storage.getStorageKey(msgKey)}`;
                localStorage.removeItem(legacyKey);
            } catch (e) {
                // ignore
            }

            delete this._messagesLoaded[chatId];
            delete this._messagesDirty[chatId];
        });
    }

    _flushChatMetadata() {
        if (this.storage._saveChatTimer) {
            clearTimeout(this.storage._saveChatTimer);
        }
        const context = this.storage.getContext();
        if (context && typeof context.saveChat === 'function') {
            context.saveChat();
        }
    }

    _getSillyTavernPersonaAvatar() {
        try {
            // 根据酒馆的 DOM 结构，精准抓取当前选中的 Persona 头像
            const selectedAvatarEl = document.querySelector('#user_avatar_block .avatar-container.selected img');
            if (selectedAvatarEl && selectedAvatarEl.src) {
                return selectedAvatarEl.src;
            }
            // 兜底抓取：部分酒馆主题的顶部快捷栏头像
            const topBarAvatar = document.querySelector('#rm_button_panel_persona img');
            if (topBarAvatar && topBarAvatar.src) {
                return topBarAvatar.src;
            }
        } catch (e) {
            console.warn('[微信数据] 获取默认Persona头像失败:', e);
        }
        return '';
    }

    getUserInfo() {
        const info = this.data.userInfo;
        const globalChatListBackground = this.getChatListBackground();
        const withGlobalBg = globalChatListBackground === (info.chatListBackground || '')
            ? info
            : { ...info, chatListBackground: globalChatListBackground };
        // 如果用户没有手动上传过自定义头像，则动态抓取酒馆默认的 Persona 头像
        if (!withGlobalBg.avatar || withGlobalBg.avatar.trim() === '') {
            const stAvatar = this._getSillyTavernPersonaAvatar();
            if (stAvatar) {
                // 返回一个包含了默认头像的拷贝，绝不污染原始数据库
                return { ...withGlobalBg, avatar: stAvatar };
            }
        }
        return withGlobalBg;
    }

    getWalletBalance(chatId = null) {
        if (!this.data.walletByChat) this.data.walletByChat = {};
        const key = chatId || this.walletDefaultKey;
        let balance = this.data.walletByChat[key];

        // chatId 没有独立钱包时，回落到默认钱包（仅读取，不写入）
        if (balance === undefined && chatId) {
            balance = this.data.walletByChat[this.walletDefaultKey];
        }
        return balance === undefined ? null : balance;
    }

    // 设置钱包金额（初始化用）
    setWalletBalance(amount, chatId = null) {
        if (!this.data.walletByChat) this.data.walletByChat = {};
        const key = chatId || this.walletDefaultKey;
        this.data.walletByChat[key] = parseFloat(amount);
        this.saveData();
    }

    // 变更钱包金额（收发红包/转账用，传入正数加钱，负数扣钱）
    updateWalletBalance(delta, chatId = null) {
        if (!this.data.walletByChat) this.data.walletByChat = {};
        const key = chatId || this.walletDefaultKey;
        let current = this.data.walletByChat[key];

        // chatId 首次使用时，若存在默认钱包则继承默认值
        if ((current === null || current === undefined) && chatId) {
            const inherited = this.data.walletByChat[this.walletDefaultKey];
            if (inherited !== null && inherited !== undefined && !isNaN(inherited)) {
                current = parseFloat(inherited);
            }
        }

        if (current === null || current === undefined || isNaN(current)) {
            current = 0; // 如果没初始化就强行收发，默认从0开始算
        }

        this.data.walletByChat[key] = Math.max(0, current + parseFloat(delta));
        this.saveData();
    }
    
    updateUserInfo(info) {
        Object.assign(this.data.userInfo, info);
        this.saveData();
    }

    // 🔥 新增：设置全局聊天背景
    setGlobalChatBackground(background) {
        this.data.userInfo.globalChatBackground = background;
        this.saveData();
    }

    // 🔥 新增：设置微信聊天列表背景
    setChatListBackground(background) {
        const next = String(background || '').trim() || null;
        this.data.userInfo.chatListBackground = next;
        if (next) {
            this.storage?.set?.(GLOBAL_WECHAT_CHATLIST_BACKGROUND_KEY, next);
        } else {
            this.storage?.set?.(GLOBAL_WECHAT_CHATLIST_BACKGROUND_KEY, GLOBAL_WECHAT_CHATLIST_BACKGROUND_NONE);
        }
        this.saveData();
    }

    getChatListBackground() {
        const rawGlobalBg = this.storage?.get?.(GLOBAL_WECHAT_CHATLIST_BACKGROUND_KEY, undefined);
        if (rawGlobalBg !== undefined && rawGlobalBg !== null) {
            const globalBg = String(rawGlobalBg || '').trim();
            if (globalBg === GLOBAL_WECHAT_CHATLIST_BACKGROUND_NONE) return '';
            return globalBg;
        }
        return String(this.data.userInfo?.chatListBackground || '').trim();
    }

    getMusicListening(chatId) {
        const safeChatId = String(chatId || '').trim();
        if (!safeChatId) return null;
        const sessions = this.data.musicListening || {};
        const session = sessions[safeChatId];
        return session && session.active !== false ? session : null;
    }

    startMusicListening(chatId, contact = {}, snapshot = {}) {
        const safeChatId = String(chatId || '').trim();
        if (!safeChatId) return null;
        if (!this.data.musicListening || typeof this.data.musicListening !== 'object') {
            this.data.musicListening = {};
        }

        const userInfo = this.getUserInfo();
        const userAvatar = String(userInfo?.avatar || '').trim();
        let contactAvatar = String(contact?.avatar || '').trim();
        if (contactAvatar && userAvatar && contactAvatar === userAvatar) {
            contactAvatar = String(
                this.getContactAutoAvatar?.(contact?.id)
                || this.getContactAutoAvatar?.(contact?.name)
                || ''
            ).trim();
        }
        const session = {
            active: true,
            chatId: safeChatId,
            contactId: String(contact?.id || '').trim(),
            contactName: String(contact?.name || '').trim(),
            contactAvatar,
            userName: String(userInfo?.name || '我').trim(),
            userAvatar,
            startedAt: Date.now(),
            sourceMessageId: String(snapshot?.sourceMessageId || '').trim(),
            songName: String(snapshot?.songName || '').trim(),
            artist: String(snapshot?.artist || '').trim(),
            cover: String(snapshot?.cover || '').trim()
        };

        this.data.musicListening[safeChatId] = session;
        this.saveData();
        return session;
    }

    stopMusicListening(chatId) {
        const safeChatId = String(chatId || '').trim();
        if (!safeChatId || !this.data.musicListening) return false;
        if (!this.data.musicListening[safeChatId]) return false;
        this.data.musicListening[safeChatId].active = false;
        this.saveData();
        return true;
    }

    endMusicListening(chatId, options = {}) {
        const safeChatId = String(chatId || '').trim();
        if (!safeChatId) return false;

        const stopped = this.stopMusicListening(safeChatId);
        const messages = this.getMessages(safeChatId);
        if (!Array.isArray(messages) || messages.length === 0) return stopped;

        let changed = false;
        let latestChangedIndex = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg?.type !== 'music_listen' && !(msg?.type === 'music_invite' && ['accepted', 'ended', 'cancelled'].includes(String(msg?.musicInviteStatus || '').trim()))) continue;
            const isInvite = msg?.type === 'music_invite';
            messages[i] = {
                ...msg,
                ...(isInvite ? { musicInviteStatus: 'ended' } : { musicListenStatus: 'ended' }),
                musicListenEndedAt: Date.now(),
                musicListenEndReason: String(options.reason || '').trim(),
                content: String(options.content || '已结束一起听歌').trim() || '已结束一起听歌'
            };
            changed = true;
            if (latestChangedIndex < 0) latestChangedIndex = i;
        }

        if (changed) {
            const chat = this.getChat(safeChatId);
            if (chat && latestChangedIndex === messages.length - 1) {
                chat.lastMessage = this.getMessagePreview(messages[latestChangedIndex]);
                chat.time = messages[latestChangedIndex].time || chat.time || '';
                chat.timestamp = messages[latestChangedIndex].timestamp || chat.timestamp || Date.now();
            }

            this._messagesLoaded[safeChatId] = true;
            this._messagesDirty[safeChatId] = true;
            this._saveMessages(safeChatId);
            this.saveData();
            return true;
        }

        return stopped;
    }
    
    getChatList() {
        // 🔥 按时间排序：最新消息的聊天在最前面
        // 使用 chat.timestamp，不读取消息（保持懒加载）
        const chats = this._normalizeChatList(this.data?.chats || []);
        if (chats.length !== (Array.isArray(this.data?.chats) ? this.data.chats.length : 0)) {
            this.data.chats = chats;
            this.saveData();
        }
        return [...chats].sort((a, b) => {
            const pinA = Number(a.pinnedAt || 0) || 0;
            const pinB = Number(b.pinnedAt || 0) || 0;
            if (pinA > 0 || pinB > 0) {
                if (pinA > 0 && pinB > 0) return pinA - pinB;
                return pinA > 0 ? -1 : 1;
            }
            const timeA = a.timestamp || 0;
            const timeB = b.timestamp || 0;
            return timeB - timeA; // 降序排列（时间戳越大的越靠前）
        });
    }

    setChatPinned(chatId, pinned = true) {
        const chat = this.getChat(chatId);
        if (!chat) return false;
        const isPinned = !!pinned;
        if (isPinned && !(Number(chat.pinnedAt || 0) > 0)) {
            chat.pinnedAt = Date.now();
        } else if (!isPinned) {
            chat.pinnedAt = 0;
        }
        this.saveData();
        return true;
    }
    
    getChat(chatId) {
        const safeChatId = String(chatId || '').trim();
        if (!safeChatId) return null;
        return this._normalizeChatList(this.data?.chats || []).find(c => String(c.id || '') === safeChatId) || null;
    }

    _isSameLookupName(a, b) {
        const left = this._normalizeLookupName(a);
        const right = this._normalizeLookupName(b);
        return !!left && !!right && left === right;
    }
    
    createChat(chatInfo) {
        const chatType = chatInfo.type || 'single';
        const safeName = String(chatInfo.name || '').trim();
        if (chatType !== 'group') {
            const contactById = chatInfo.contactId
                ? this.data.contacts.find(c => c.id === chatInfo.contactId)
                : null;
            const contactByName = contactById || this.data.contacts.find(c => this._isSameLookupName(c.name, safeName));
            const existingSingleChat = this.data.chats.find(c =>
                c.type !== 'group'
                && (
                    (chatInfo.contactId && c.contactId === chatInfo.contactId)
                    || (contactByName?.id && c.contactId === contactByName.id)
                    || this._isSameLookupName(c.name, safeName)
                    || (contactByName?.name && this._isSameLookupName(c.name, contactByName.name))
                )
            );
            if (existingSingleChat) {
                if (!existingSingleChat.contactId && contactByName?.id) existingSingleChat.contactId = contactByName.id;
                if ((!existingSingleChat.avatar || existingSingleChat.avatar === '👤') && (contactByName?.avatar || chatInfo.avatar)) {
                    existingSingleChat.avatar = contactByName?.avatar || chatInfo.avatar;
                }
                this.saveData();
                return existingSingleChat;
            }
        } else {
            const existingGroupChat = this.data.chats.find(c =>
                c.type === 'group'
                && String(c.name || '').trim() === safeName
            );
            if (existingGroupChat) return existingGroupChat;
        }

        const chat = {
            id: chatInfo.id || Date.now().toString(),
            contactId: chatInfo.contactId,
            name: chatInfo.name,
            type: chatType,
            avatar: chatInfo.avatar,
            lastMessage: '',
            time: '刚刚',
            unread: 0,
            timestamp: Date.now(),
            members: chatInfo.members || []
        };

        this.data.chats.push(chat);
        this.saveData();
        return chat;
    }
    
    getChatByContactId(contactId) {
        const contact = this.data.contacts.find(c => c.id === contactId);
        return this.data.chats.find(c =>
            c.type !== 'group'
            && (
                c.contactId === contactId
                || (contact?.name && this._isSameLookupName(c.name, contact.name))
            )
        );
    }
    
    /**
     * 🔥 懒加载：只在需要时才从单独存储加载该聊天的消息
     */
    getMessages(chatId) {
        // 🔥 如果内存中还没有这个数组，先初始化
        if (!this.data.messages[chatId]) {
            this.data.messages[chatId] = [];
        }

        // 🔥 如果该聊天的消息还没加载，且内存中当前也没有新消息，才从单独存储加载
        if (!this._messagesLoaded[chatId]) {
            try {
                const msgKey = this._getMessageKey(chatId);
                let saved = this.storage.get(msgKey, false);
                if ((!saved || String(saved).trim() === '') && this._isLobbyMode()) {
                    const legacyMsgKey = this._getMessageKey(chatId, null, { legacy: true });
                    const legacySaved = this.storage.get(legacyMsgKey, false);
                    if (legacySaved && String(legacySaved).trim() !== '') {
                        saved = legacySaved;
                        this.storage.set(msgKey, legacySaved, false);
                    }
                }

                if (saved && saved.trim() !== '') {
                    const parsedData = JSON.parse(saved);
                    // 🛡️ 防覆盖结界：只有当本地解析出来的数据比内存多，或者内存完全为空时，才合并进去
                    if (Array.isArray(parsedData) && parsedData.length > 0) {
                        if (this.data.messages[chatId].length === 0) {
                            this.data.messages[chatId] = parsedData;
                        }
                    }
                }
            } catch (e) {
                console.warn(`⚠️ 加载聊天 ${chatId} 消息失败:`, e);
            }
            this._messagesLoaded[chatId] = true;
        }

        // 🔥 给没有id的旧消息补上id
        let patched = false;
        this.data.messages[chatId].forEach((m, i) => {
            if (!m.id) {
                m.id = `msg_legacy_${chatId}_${i}`;
                patched = true;
            }
        });
        if (patched) this._messagesDirty[chatId] = true;
        return this.data.messages[chatId];
    }

    /**
     * 🔥 保存单个聊天的消息（独立存储），完全同步化，拒绝异步抢占
     */
    _saveMessages(chatId) {
        if (!this.data.messages[chatId]) return;

        try {
            const msgKey = this._getMessageKey(chatId);
            // 强行同步序列化，确保存储的绝对是最新切片
            const safeData = JSON.stringify(this.data.messages[chatId]);
            this.storage.set(msgKey, safeData, false);
        } catch (e) {
            console.error(`❌ 保存聊天 ${chatId} 消息失败:`, e);
        }
    }

    releaseLoadedMessages({ keepChatIds = [] } = {}) {
        const keep = new Set((Array.isArray(keepChatIds) ? keepChatIds : [])
            .map(id => String(id || '').trim())
            .filter(Boolean));
        Object.keys(this.data.messages || {}).forEach((chatId) => {
            if (keep.has(chatId)) return;
            if (this._messagesDirty[chatId]) {
                this._saveMessages(chatId);
                this._messagesDirty[chatId] = false;
            }
            delete this.data.messages[chatId];
            delete this._messagesLoaded[chatId];
        });
    }

    getContactByName(name) {
        // 优先从联系人列表找
        let contact = this.data.contacts.find(c => c.name === name)
            || this.data.contacts.find(c => this._isSameLookupName(c.name, name));
        if (contact) return contact;

        // 如果找不到，再从聊天列表里找（比如群聊或者临时会话）
        contact = this.data.chats.find(c => c.name === name)
            || this.data.chats.find(c => c.type !== 'group' && this._isSameLookupName(c.name, name))
            || this.data.chats.find(c => c.type === 'group' && String(c.name || '').trim() === String(name || '').trim());
        if (contact) return contact;

        // 如果还是找不到，检查是不是自己
        if (name === this.data.userInfo.name || name === 'me') {
            return this.data.userInfo;
        }
        
        return null;
    }

    _normalizeLookupName(name) {
        return String(name || '')
            .trim()
            .replace(/\s+/g, '')
            .replace(/[（(][^（）()]*[）)]/g, '')
            .toLowerCase();
    }

    findContactByNameLoose(name, { includeChats = true } = {}) {
        const rawName = String(name || '').trim();
        const normalizedName = this._normalizeLookupName(rawName);
        if (!rawName && !normalizedName) return null;

        const pickFromList = (list = [], { allowLooseIncludes = true } = {}) => {
            if (!Array.isArray(list) || list.length === 0) return null;

            let exact = list.find(item => String(item?.name || '').trim() === rawName);
            if (exact) return exact;

            exact = list.find(item => this._normalizeLookupName(item?.name) === normalizedName);
            if (exact) return exact;

            if (!normalizedName || !allowLooseIncludes) return null;

            return list.find(item => {
                const itemName = this._normalizeLookupName(item?.name);
                return itemName && (itemName.includes(normalizedName) || normalizedName.includes(itemName));
            }) || null;
        };

        const contact = pickFromList(this.data.contacts);
        if (contact) return contact;

        if (includeChats) {
            const singleChats = (this.data.chats || []).filter(chat => chat?.type !== 'group');
            const groupChats = (this.data.chats || []).filter(chat => chat?.type === 'group');
            const chat = pickFromList(singleChats) || pickFromList(groupChats, { allowLooseIncludes: false });
            if (chat) return chat;
        }

        const userInfo = this.data.userInfo || {};
        const userName = String(userInfo.name || '').trim();
        if (rawName === 'me' || rawName === userName || this._normalizeLookupName(userName) === normalizedName) {
            return userInfo;
        }

        return null;
    }

    resolveTtsVoiceByName(name, { includeChats = true } = {}) {
        const contact = this.findContactByNameLoose(name, { includeChats });
        const globalProvider = String(this.storage?.get?.('phone-tts-provider') || 'minimax_cn').trim() || 'minimax_cn';
        const boundProvider = String(contact?.ttsProvider || '').trim();
        const providerVoices = (contact?.ttsVoices && typeof contact.ttsVoices === 'object')
            ? contact.ttsVoices
            : {};
        const globalProviderVoice = String(providerVoices?.[globalProvider] || '').trim();
        const provider = globalProviderVoice ? globalProvider : (boundProvider || globalProvider);
        const providerVoice = String(providerVoices?.[provider] || '').trim();
        const hasProviderVoiceConfig = Object.values(providerVoices).some(value => String(value || '').trim());
        const voice = providerVoice || (hasProviderVoiceConfig ? '' : String(contact?.ttsVoice || '').trim());
        return {
            contact,
            voice,
            provider
        };
    }

    _getStoryTimeFallback() {
        try {
            const timeManager = window.VirtualPhone?.timeManager;
            if (timeManager?.getCurrentStoryTime) {
                const storyTime = timeManager.getCurrentStoryTime();
                if (storyTime?.time && storyTime?.date) {
                    const parsedTimestamp = Number.isFinite(Number(storyTime.timestamp))
                        ? Number(storyTime.timestamp)
                        : (typeof timeManager.parseTimeToTimestamp === 'function'
                            ? timeManager.parseTimeToTimestamp(storyTime)
                            : Date.now());
                    return {
                        time: storyTime.time,
                        date: storyTime.date,
                        weekday: storyTime.weekday || '星期一',
                        timestamp: parsedTimestamp
                    };
                }
            }
        } catch (e) {
            console.warn('⚠️ 获取剧情时间兜底失败:', e);
        }

        const now = new Date();
        const pad = (value) => String(value).padStart(2, '0');
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        return {
            time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
            date: `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日`,
            weekday: weekdays[now.getDay()],
            timestamp: now.getTime()
        };
    }
    
       addMessage(chatId, message) {
        // 🔥 关键修复：先触发懒加载，避免在“未打开聊天”的情况下把历史消息数组覆盖成空
        const loadedMessages = this.getMessages(chatId);
        if (!Array.isArray(loadedMessages)) {
            this.data.messages[chatId] = [];
        }

        // 🔥 记录消息在酒馆对话中的位置 (只在外部未传入时才兜底计算，极为重要)
        if (message.tavernMessageIndex === undefined) {
            try {
                const context = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
                if (context && context.chat && Array.isArray(context.chat)) {
                    message.tavernMessageIndex = Math.max(0, context.chat.length - 1);
                } else {
                    message.tavernMessageIndex = 0;
                }
            } catch (e) {
                console.error('❌ 记录索引失败:', e);
                message.tavernMessageIndex = 0;
            }
        }

        // 🔥🔥🔥 核心防御：亡灵拦截结界 🔥🔥🔥
        let chat = this.getChat(chatId);
        const shouldApplyClearFloorGuard = !!message.fromMainChatTag;
        if (shouldApplyClearFloorGuard && chat && chat.clearedAt_tavernIndex !== undefined && message.tavernMessageIndex !== undefined) {
            // 如果这条消息的楼层小于用户点击清空时的楼层，直接拒收
            if (message.tavernMessageIndex < chat.clearedAt_tavernIndex) {
                return false; 
            }
        }

        // 🔥🔥🔥 核心清洗：同楼层流式碎片与废案清洗机制 🔥🔥🔥
        let replayInsertAnchorIndex = -1;
        if (message.tavernMessageIndex !== undefined && message.batchId && message.fromMainChatTag) {
            const originalLen = this.data.messages[chatId].length;
            this.data.messages[chatId] = this.data.messages[chatId].filter((m, index) => {
                // 如果是同一层楼，且来自于正文解析，但是批次号不同，说明是 AI 重新生成的废案或者旧的流式碎片，直接抛弃！
                if (m.tavernMessageIndex === message.tavernMessageIndex && m.fromMainChatTag && m.batchId !== message.batchId) {
                    if (replayInsertAnchorIndex < 0) replayInsertAnchorIndex = index;
                    return false; 
                }
                return true;
            });
            if (this.data.messages[chatId].length !== originalLen) {
                this._messagesDirty[chatId] = true;
            }
        }

        // 🔥 动态拦截表情包与语音（线上模式）
        if ((message.type === 'text' || !message.type) && message.content) {
            const contentStr = message.content.trim();
            const imageMatch = /^\[(用户照片|个人图片|图片|视频)\]\s*([\s\S]+?)\s*$/.exec(contentStr);
            if (imageMatch) {
                const parsedImagePrompt = this._parseImagePromptText(imageMatch[2]);
                message.type = 'image_prompt';
                message.mediaType = imageMatch[1]; // 记录是图片还是视频
                message.usePersonalReference = imageMatch[1] === '个人图片';
                message.useUserReference = imageMatch[1] === '用户照片';
                message.imageDescription = parsedImagePrompt.description;
                message.imagePrompt = parsedImagePrompt.prompt;
                message.content = message.imagePrompt;
            }
            const locationMatch = /^\[定位\]\s*[（(]\s*([^)）]+?)\s*[)）]\s*$/.exec(contentStr);
            if (locationMatch) {
                message.type = 'location';
                message.locationText = locationMatch[1].trim();
                message.content = message.locationText;
            }
            const stickerMatch = /^\[表情包\]\s*[（(]\s*([^)）]+?)\s*[)）]\s*$/.exec(contentStr);
            if (stickerMatch) {
                message.type = 'sticker';
                message.keyword = stickerMatch[1].trim();
            }
            const newVoiceMatch = /^(?:\[\s*(?:语音条|语音)\s*\]|【\s*(?:语音条|语音)\s*】)\s*[:：]?\s*(.+)$/i.exec(contentStr);
            if (newVoiceMatch) {
                let parsedVoiceText = String(newVoiceMatch[1] || '').trim();
                const wrappedVoiceMatch = parsedVoiceText.match(/^[（(]\s*([\s\S]*?)\s*[)）]$/);
                if (wrappedVoiceMatch) {
                    parsedVoiceText = String(wrappedVoiceMatch[1] || '').trim();
                }
                parsedVoiceText = parsedVoiceText
                    .replace(/^(?:语音条?\s*)?(?:转文字|转文本|转写|转录|转化出的文字|转化文字|转换文字|文字内容|内容)\s*[：:]\s*/i, '')
                    .replace(/^语音条转文字内容\s*[：:]\s*/i, '')
                    .trim();
                message.type = 'voice';
                message.voiceText = parsedVoiceText;
                let seconds = Math.ceil((message.voiceText || '语音').length / 3);
                seconds = Math.max(2, Math.min(seconds, 60));
                message.duration = seconds + '"';
            }
        }
        if (message.type === 'sticker' && !message.keyword && message.content) {
            const stickerMatch = /^\[表情包\]\s*[（(]\s*([^)）]+?)\s*[)）]\s*$/.exec(String(message.content || '').trim());
            if (stickerMatch) {
                message.keyword = stickerMatch[1].trim();
            }
        }

        // 🔥 防重复检测：仅用于正文标签同步，避免 AI 流式/重算导致消息重影
        // 注意：手动发送（from=me）也可能出现同内容连发，不能被这里吞掉。
        if (message.fromMainChatTag) {
            const recentMessages = this.data.messages[chatId].slice(-30);
            const msgType = String(message.type || 'text');
            const msgFrom = String(message.from || '');
            const msgContent = String(message.content || '');

            const isDuplicate = recentMessages.some(m => {
                if (String(m.from || '') !== msgFrom) return false;
                if (String(m.content || '') !== msgContent) return false;
                if (String(m.type || 'text') !== msgType) return false;

                // 只要同楼层且内容完全一致，必定是重复触发
                if (message.tavernMessageIndex !== undefined && m.tavernMessageIndex !== undefined) {
                    return Number(m.tavernMessageIndex) === Number(message.tavernMessageIndex);
                }
                return false;
            });
            if (isDuplicate) return false; // 拦截重复
        }

        // 🔥 时间戳保底机制
        const storyTimeFallback = this._getStoryTimeFallback();
        if (!message.time) {
            message.time = storyTimeFallback.time;
        }
        if (!message.date) {
            message.date = storyTimeFallback.date;
        }
        if (!message.weekday) {
            message.weekday = storyTimeFallback.weekday;
        }
        if (!message.timestamp) {
            // 🔥 优先根据 date + time 计算剧情时间戳（修复线下转线上跨天时间不更新）
            if (message.date && message.time) {
                try {
                    const dateParts = message.date.match(/(\d{1,6})[-\/年]\s*(\d{1,2})[-\/月]\s*(\d{1,2})\s*日?/);
                    const timeParts = message.time.match(/(\d{1,2})[:：](\d{2})/);
                    if (dateParts && timeParts) {
                        const dateObj = new Date(parseInt(dateParts[1]), parseInt(dateParts[2]) - 1, parseInt(dateParts[3]), parseInt(timeParts[1]), parseInt(timeParts[2]));
                        message.timestamp = dateObj.getTime();
                    } else {
                        message.timestamp = storyTimeFallback.timestamp || Date.now();
                    }
                } catch (e) {
                    message.timestamp = storyTimeFallback.timestamp || Date.now();
                }
            } else {
                message.timestamp = storyTimeFallback.timestamp || Date.now();
            }
        }
        if (!message.realTimestamp) {
            message.realTimestamp = Date.now();
        }
        if (!message.id) {
            message.id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        }

        // 🔥 将消息真正塞入内存
        const shouldOrderedInsert = message.fromMainChatTag
            && message.tavernMessageIndex !== undefined
            && message.batchId
            && Number.isFinite(Number(message.mainChatOrder));
        if (shouldOrderedInsert) {
            const nextOrder = Number(message.mainChatOrder);
            let insertIndex = replayInsertAnchorIndex >= 0
                ? Math.min(replayInsertAnchorIndex, this.data.messages[chatId].length)
                : this.data.messages[chatId].length;
            let foundSameMainChatBatch = false;
            for (let i = 0; i < this.data.messages[chatId].length; i += 1) {
                const existing = this.data.messages[chatId][i];
                if (!existing?.fromMainChatTag) continue;
                if (Number(existing.tavernMessageIndex) !== Number(message.tavernMessageIndex)) continue;
                if (String(existing.batchId || '') !== String(message.batchId || '')) continue;
                foundSameMainChatBatch = true;
                const existingOrder = Number(existing.mainChatOrder);
                if (Number.isFinite(existingOrder) && existingOrder > nextOrder) {
                    insertIndex = i;
                    break;
                }
                if (Number.isFinite(existingOrder) && existingOrder <= nextOrder) {
                    insertIndex = i + 1;
                }
            }
            if (!foundSameMainChatBatch && replayInsertAnchorIndex < 0) {
                const nextFloor = Number(message.tavernMessageIndex);
                for (let i = 0; i < this.data.messages[chatId].length; i += 1) {
                    const existing = this.data.messages[chatId][i];
                    if (!existing?.fromMainChatTag) continue;
                    const existingFloor = Number(existing.tavernMessageIndex);
                    if (Number.isFinite(existingFloor) && Number.isFinite(nextFloor) && existingFloor > nextFloor) {
                        insertIndex = i;
                        break;
                    }
                }
            }
            this.data.messages[chatId].splice(insertIndex, 0, message);
        } else {
            this.data.messages[chatId].push(message);
        }

        // 🔥 同步更新聊天列表的预览
        chat = this.getChat(chatId);
        if (chat) {
            const latestPreviewMsg = [...(this.data.messages[chatId] || [])]
                .reverse()
                .find(m => m?.hiddenFromPreview !== true && m?.isTimeMarker !== true && m?.type !== 'time_marker');
            if (latestPreviewMsg) {
                chat.lastMessage = this.getMessagePreview(latestPreviewMsg);
                chat.time = latestPreviewMsg.time || chat.time || '';
                chat.timestamp = latestPreviewMsg.timestamp || chat.timestamp || Date.now();
            }
        }

        // 🔥 标记需要持久化
        this._messagesLoaded[chatId] = true;
        this._messagesDirty[chatId] = true;

        // 🔥🔥🔥 核心修复：立即同步保存消息到独立存储，不依赖 async saveData() 的延迟调度！
        // 这确保了 render() 中 loadData() 重新加载时，存储里已经有最新消息。
        this._saveMessages(chatId);

        this.saveData();
        return true;
    }

    updateMessageById(chatId, messageId, patch = {}) {
        const safeChatId = String(chatId || '').trim();
        const safeMessageId = String(messageId || '').trim();
        if (!safeChatId || !safeMessageId || !patch || typeof patch !== 'object') return null;

        const messages = this.getMessages(safeChatId);
        if (!Array.isArray(messages) || messages.length === 0) return null;

        const targetIndex = messages.findIndex(msg => String(msg?.id || '').trim() === safeMessageId);
        if (targetIndex < 0) return null;

        messages[targetIndex] = {
            ...messages[targetIndex],
            ...patch
        };

        const chat = this.getChat(safeChatId);
        if (chat && targetIndex === messages.length - 1) {
            chat.lastMessage = this.getMessagePreview(messages[targetIndex]);
            chat.time = messages[targetIndex].time || chat.time || '';
            chat.timestamp = messages[targetIndex].timestamp || chat.timestamp || Date.now();
        }

        this._messagesLoaded[safeChatId] = true;
        this._messagesDirty[safeChatId] = true;
        this._saveMessages(safeChatId);
        this.saveData();
        return messages[targetIndex];
    }

/**
 * 🔥 获取消息预览文本（用于聊天列表显示）
 */
getMessagePreview(message) {
    if (message?.hiddenFromPreview === true || message?.isTimeMarker === true || message?.type === 'time_marker') {
        return '';
    }

    const stripSpeechPrefix = (text) => String(text || '')
        .replace(/^\s*(?:\[\s*(?:语音|视频|语音通话|视频通话|通话)\s*\]|【\s*(?:语音|视频|语音通话|视频通话|通话)\s*】)\s*/i, '')
        .replace(/^\s*(?:语音|视频)(?:通话)?\s*[：:]\s*/i, '')
        .trim();

    switch (message.type) {
        case 'image':
            if (message.customEmojiId || message.customEmojiName || message.customEmojiDescription) {
                return '[表情包]';
            }
            return '[图片]';
       case 'image_prompt':
            return `[${message.useUserReference ? '用户照片' : (message.usePersonalReference ? '个人图片' : (message.mediaType || '图片'))}]`;
        case 'location':
            return `[定位] ${stripSpeechPrefix(message.content || message.locationText || '')}`.trim();
        case 'voice':
            return '[语音]';
        case 'video':
            return '[视频]';
        case 'sticker':
            return '[表情包]';
        case 'transfer':
            return `[转账] ¥${message.amount || ''}`;
        case 'redpacket':
            return '[红包]';
        case 'call_record':
            return message.callType === 'video' ? '[视频通话]' : '[语音通话]';
        case 'call_text':
            const icon = message.callType === 'video' ? '📹' : '📞';
            return `${icon} ${stripSpeechPrefix(message.content || '')}`;
        case 'weibo_card':
            return '[微博分享]';
        case 'poker_card':
            return '[德州扑克分享]';
        case 'werewolf_card':
            return '[狼人杀复盘分享]';
        case 'catbox_coadopt_invite':
            return message.catboxInviteStatus === 'accepted'
                ? '[猫盒共养邀请：已接收]'
                : (message.catboxInviteStatus === 'rejected' ? '[猫盒共养邀请：已拒绝]' : '[猫盒共养邀请]');
        case 'catbox_care_card':
            return '[猫盒照顾]';
        case 'music_listen':
            return '[一起听歌]';
        case 'music_invite':
            return '[音乐邀请]';
        default:
            return stripSpeechPrefix(message.content || '');
    }
}

/**
 * 🔧 辅助方法：获取星期几
 */
getWeekday(date) {
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return weekdays[date.getDay()];
}
    
    getContacts() {
        return this.data.contacts;
    }

    getContact(contactId) {
        return this.data.contacts.find(c => c.id === contactId);
    }

    _normalizeGenderValue(gender) {
        const raw = String(gender || '').trim().toLowerCase();
        if (raw === 'male' || raw === 'm' || raw === '男') return 'male';
        if (raw === 'female' || raw === 'f' || raw === '女') return 'female';
        return 'unknown';
    }

    _getContactGenderMapKey(contactIdOrName) {
        const raw = String(contactIdOrName || '').trim();
        if (!raw) return '';
        const byId = this.data.contacts.find(c => c.id === raw);
        if (byId?.id) return byId.id;
        const byName = this.data.contacts.find(c => c.name === raw)
            || this.data.contacts.find(c => this._isSameLookupName(c.name, raw));
        if (byName?.id) return byName.id;
        return raw;
    }

    getContactGenderMap() {
        if (!this.data.contactGenderMap || typeof this.data.contactGenderMap !== 'object') {
            this.data.contactGenderMap = {};
        }
        return this.data.contactGenderMap;
    }

    getContactGender(contactIdOrName) {
        const key = this._getContactGenderMapKey(contactIdOrName);
        if (!key) return 'unknown';
        const map = this.getContactGenderMap();
        const mappedGender = this._normalizeGenderValue(map[key]);
        if (mappedGender !== 'unknown') return mappedGender;

        const raw = String(contactIdOrName || '').trim();
        const contact = this.data.contacts.find(c => c.id === key)
            || this.data.contacts.find(c => c.id === raw)
            || this.data.contacts.find(c => c.name === raw)
            || this.data.contacts.find(c => this._isSameLookupName(c.name, raw));
        return this._normalizeGenderValue(contact?.gender);
    }

    setContactGender(contactIdOrName, gender) {
        const key = this._getContactGenderMapKey(contactIdOrName);
        if (!key) return false;
        const safeGender = this._normalizeGenderValue(gender);
        const map = this.getContactGenderMap();
        map[key] = safeGender;
        this.saveData();
        return true;
    }

    _normalizeAvatarGroupValue(group) {
        const raw = String(group || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
        if (raw === 'male' || raw === 'female' || raw === 'male_elder' || raw === 'female_elder') return raw;
        return '';
    }

    getContactAvatarGroupMap() {
        if (!this.data.contactAvatarGroupMap || typeof this.data.contactAvatarGroupMap !== 'object') {
            this.data.contactAvatarGroupMap = {};
        }
        return this.data.contactAvatarGroupMap;
    }

    getContactAvatarGroup(contactIdOrName) {
        const key = this._getContactGenderMapKey(contactIdOrName);
        if (!key) return '';
        const map = this.getContactAvatarGroupMap();
        return this._normalizeAvatarGroupValue(map[key]);
    }

    setContactAvatarGroup(contactIdOrName, group) {
        const key = this._getContactGenderMapKey(contactIdOrName);
        if (!key) return false;
        const safeGroup = this._normalizeAvatarGroupValue(group);
        const map = this.getContactAvatarGroupMap();
        if (safeGroup) {
            map[key] = safeGroup;
        } else {
            delete map[key];
        }
        this.saveData();
        return true;
    }

    getContactAutoAvatarMap() {
        if (!this.data.contactAutoAvatarMap || typeof this.data.contactAutoAvatarMap !== 'object') {
            this.data.contactAutoAvatarMap = {};
        }
        return this.data.contactAutoAvatarMap;
    }

    getContactAutoAvatar(contactIdOrName) {
        const key = this._getContactGenderMapKey(contactIdOrName);
        if (!key) return '';
        const map = this.getContactAutoAvatarMap();
        return String(map[key] || '').trim();
    }

    setContactAutoAvatar(contactIdOrName, avatarUrl) {
        const key = this._getContactGenderMapKey(contactIdOrName);
        if (!key) return false;
        const map = this.getContactAutoAvatarMap();
        const safeUrl = String(avatarUrl || '').trim();
        if (!safeUrl) {
            delete map[key];
        } else {
            map[key] = safeUrl;
        }
        this.saveData();
        return true;
    }

    addContact(contact) {
        const safeName = String(contact?.name || '').trim();
        const safeNameKey = this._normalizeExactContactName(safeName);
        const existed = this.data.contacts.find(c => this._normalizeExactContactName(c.name) === safeNameKey);
        if (existed) {
            if (!existed.avatar && contact?.avatar) existed.avatar = contact.avatar;
            if (!existed.remark && contact?.remark) existed.remark = contact.remark;
            if (!existed.relation && contact?.relation) existed.relation = contact.relation;
            if (contact?.sourceApp) existed.sourceApp = contact.sourceApp;
            if (contact?.sourceLabel) existed.sourceLabel = contact.sourceLabel;
            if (contact?.honeyHostName) existed.honeyHostName = contact.honeyHostName;
            if (contact?.honeySource) existed.honeySource = contact.honeySource;
            if (contact?.honeyVisibleIntro) existed.honeyVisibleIntro = contact.honeyVisibleIntro;
            if (contact?.honeyHiddenBackground) existed.honeyHiddenBackground = contact.honeyHiddenBackground;
            if (!existed.letter && safeName) existed.letter = this.getFirstLetter(existed.name || safeName);
            this.saveData();
            return existed;
        }
        this.data.contacts.push(contact);
        this.saveData();
        return contact;
    }

    // 🔥 更新联系人信息（包括头像和名字双向同步）
    updateContact(contactId, updates) {
        const safeContactId = String(contactId || '').trim();
        let contact = this.data.contacts.find(c => c.id === safeContactId);
        if (!contact && safeContactId) {
            contact = this.data.contacts.find(c => c.name === safeContactId)
                || this.data.contacts.find(c => this._isSameLookupName(c.name, safeContactId));
        }
        if (contact) {
            const oldName = contact.name; // 记录旧名字
            Object.assign(contact, updates);

            // 🔥 新增：如果修改了名字，同步更新关联的聊天窗口名字
            if (updates.name && updates.name !== oldName) {
                const chat = this.getChatByContactId(contact.id || safeContactId);
                if (chat) {
                    chat.name = updates.name;
                } else {
                    // 兜底：兼容没有 contactId 的旧数据，通过旧名字匹配单聊
                    const chatByName = this.data.chats.find(c => c.type !== 'group' && this._isSameLookupName(c.name, oldName));
                    if (chatByName) {
                        chatByName.name = updates.name;
                    }
                }
            }

            this.saveData();
            return true;
        }
        return false;
    }

    // 🔥 同步头像到所有相关位置（聊天、联系人）
    syncContactAvatar(contactIdOrName, avatar) {
        const lookup = String(contactIdOrName || '').trim();
        const safeAvatar = String(avatar || '').trim();
        if (!lookup || !safeAvatar) return false;

        let foundContact = false;
        let foundChat = false;

        // 1. 尝试通过 contactId 查找联系人
        let contact = this.data.contacts.find(c => c.id === lookup);

        // 2. 如果找不到，尝试通过名字查找
        if (!contact) {
            contact = this.data.contacts.find(c => c.name === lookup)
                || this.data.contacts.find(c => this._isSameLookupName(c.name, lookup));
        }

        if (contact) {
            contact.avatar = safeAvatar;
            foundContact = true;
        }

        // 3. 更新相关聊天（通过 contactId 或名字）
        this.data.chats.forEach(chat => {
            if (String(chat.contactId || '').trim() === lookup || String(chat.name || '').trim() === lookup ||
                (contact && chat.contactId === contact.id)
                || (contact && this._isSameLookupName(chat.name, contact.name))
                || (chat.type !== 'group' && this._isSameLookupName(chat.name, lookup))) {
                chat.avatar = safeAvatar;
                foundChat = true;
            }
        });

        if (foundContact || foundChat) {
            this.saveData();
        }
        return foundContact || foundChat;
    }

    _parseImagePromptText(rawValue = '') {
        const raw = String(rawValue || '').trim()
            .replace(/^\[(?:用户照片|个人图片|图片|视频)\]\s*/i, '')
            .trim();
        const parts = [];
        let scanIndex = 0;
        while (scanIndex < raw.length && /\s/.test(raw[scanIndex])) scanIndex += 1;
        if (raw[scanIndex] !== '（' && raw[scanIndex] !== '(') {
            return {
                description: raw,
                prompt: raw
            };
        }

        while (scanIndex < raw.length) {
            while (scanIndex < raw.length && /\s/.test(raw[scanIndex])) scanIndex += 1;
            if (raw[scanIndex] !== '（' && raw[scanIndex] !== '(') break;
            const group = this._readBracketGroupAt(raw, scanIndex);
            if (!group) {
                scanIndex += 1;
                continue;
            }
            const text = String(group.text || '').trim();
            if (text) parts.push(text);
            scanIndex = group.endIndex;
        }

        const trailingText = raw.slice(scanIndex).trim();
        if (trailingText) {
            return {
                description: raw,
                prompt: raw
            };
        }

        if (parts.length >= 2) {
            return {
                description: parts[0],
                prompt: parts.slice(1).join(', ')
            };
        }

        const single = parts[0] || raw.replace(/^[（(]\s*|\s*[)）]$/g, '').trim();
        return {
            description: single,
            prompt: single
        };
    }

    _readBracketGroupAt(value = '', startIndex = 0) {
        const text = String(value || '');
        const opener = text[startIndex];
        if (opener !== '（' && opener !== '(') return null;

        const primaryCloser = opener === '（' ? '）' : ')';
        const alternateCloser = opener === '（' ? ')' : '）';
        let depth = 1;
        for (let index = startIndex + 1; index < text.length; index += 1) {
            const char = text[index];
            if (opener === '(' && char === '(') {
                depth += 1;
                continue;
            }
            if (char !== primaryCloser && char !== alternateCloser) continue;
            depth -= 1;
            if (depth === 0) {
                return {
                    text: text.slice(startIndex + 1, index),
                    endIndex: index + 1
                };
            }
        }
        return null;
    }

    // 🔥 通过聊天对象同步头像（更可靠）
    syncAvatarByChat(chat, avatar) {
        const safeAvatar = String(avatar || '').trim();
        if (!chat || !safeAvatar) return false;
        let foundContact = false;

        // 1. 更新聊天本身
        chat.avatar = safeAvatar;

        // 2. 通过 contactId 更新联系人
        if (chat.contactId) {
            const contact = this.data.contacts.find(c => c.id === chat.contactId);
            if (contact) {
                contact.avatar = safeAvatar;
                foundContact = true;
            }
        }

        // 3. 通过名字更新联系人
        const contactByName = this.data.contacts.find(c => c.name === chat.name)
            || this.data.contacts.find(c => this._isSameLookupName(c.name, chat.name));
        if (contactByName) {
            contactByName.avatar = safeAvatar;
            foundContact = true;
        }

        this.saveData();
        return true;
    }
    
    getMoments() {
        return this.data.moments;
    }
    
    getMoment(momentId) {
        return this.data.moments.find(m => m.id === momentId);
    }
    
    addMoment(moment) {
        this.data.moments.unshift(moment);
        this.saveData();
    }

    deleteMoment(momentId) {
        const safeId = String(momentId || '').trim();
        if (!safeId || !Array.isArray(this.data.moments)) return false;
        const index = this.data.moments.findIndex(m => String(m?.id || '').trim() === safeId);
        if (index < 0) return false;
        this.data.moments.splice(index, 1);
        this.saveData();
        return true;
    }
    
 // ✅ 智能加载联系人（调用AI）
async loadContactsFromCharacter() {
    try {
        // 🔑 定义 context
        const context = typeof SillyTavern !== 'undefined' && SillyTavern.getContext 
            ? SillyTavern.getContext() 
            : null;
        
        if (!context) {
            return { success: false, message: '❌ 无法获取SillyTavern上下文' };
        }
        
        
        // ✅ 构建AI消息
        const messages = await this.buildContactPrompt(context);
        
        
        // ✅ 调用AI
        const aiResponse = await this.sendToAI(messages);
        
        if (!aiResponse) {
            throw new Error('AI未返回数据');
        }
        
        
        // ✅ 解析AI返回
        const generatedData = this.parseAIResponse(aiResponse);
        
        if (!generatedData || !generatedData.contacts) {
            throw new Error('AI返回的数据格式错误');
        }
        
        // 🔒 幂等保护：已存在的好友/群绝不覆盖，仅新增不存在的
        const normalizeName = (raw) => {
            return String(raw || '')
                .trim()
                .replace(/\s+/g, '')
                .replace(/[（(][^（）()]*[）)]/g, '') // 忽略尾部关系备注
                .toLowerCase();
        };

        // ✅ 添加联系人（仅补全缺失，不覆盖已有）
        let addedCount = 0;
        let addedGroupCount = 0;
        const selfNameKey = normalizeName(context?.name1 || '用户');
        const existingContactKeys = new Set(this.data.contacts.map(c => normalizeName(c.name)));

        const ensureContact = (rawName, options = {}) => {
            const displayName = String(rawName || '').trim();
            const key = normalizeName(displayName);
            if (!displayName || !key || key === selfNameKey) return null;

            const existed = this.data.contacts.find(c => normalizeName(c.name) === key);
            if (existed) return { contact: existed, created: false };

            const relation = options.relation || '';
            const avatar = options.avatar || '';
            const newContact = {
                id: `contact_${Date.now()}_${Math.random()}`,
                name: displayName,
                avatar,
                remark: options.remark || '',
                letter: this.getFirstLetter(displayName),
                relation,
                gender: this._normalizeGenderValue(options.gender)
            };
            this.data.contacts.push(newContact);
            existingContactKeys.add(key);
            return { contact: newContact, created: true };
        };

        generatedData.contacts.forEach(contact => {
            const result = ensureContact(contact?.name, {
                avatar: contact?.avatar || '',
                relation: contact?.relation || '',
                remark: contact?.remark || '',
                gender: contact?.gender || ''
            });
            if (result?.created) addedCount++;
            const parsedGender = this._normalizeGenderValue(contact?.gender);
            if (result?.contact && parsedGender !== 'unknown') {
                const currentGender = this.getContactGender(result.contact.id || result.contact.name);
                if (result.created || currentGender === 'unknown') {
                    this.setContactGender(result.contact.id || result.contact.name, parsedGender);
                }
            }
        });
        
        // ✅ 添加群聊（仅补全缺失，不覆盖已有）
        if (generatedData.groups && generatedData.groups.length > 0) {
            const existingChatKeys = new Set(this.data.chats.map(c => normalizeName(c.name)));
            const batchGroupKeys = new Set();

            generatedData.groups.forEach(group => {
                const groupName = String(group?.name || '').trim();
                const key = normalizeName(groupName);
                if (!groupName || !key) return;

                // 先规范化群成员：
                // - 允许不是好友的人出现在群里
                // - 但绝不因为群成员而自动新增通讯录联系人
                const groupMemberNames = [];
                const groupMemberKeys = new Set();
                const sourceMembers = Array.isArray(group?.members) ? group.members : [];

                sourceMembers.forEach(memberRaw => {
                    const raw = String(memberRaw || '').trim();
                    if (!raw) return;
                    const cleaned = raw.replace(/\s*[（(][^()（）]+[）)]\s*$/g, '').trim();
                    const memberKey = normalizeName(cleaned);
                    if (!cleaned || !memberKey || memberKey === selfNameKey || groupMemberKeys.has(memberKey)) return;

                    // 若该成员本身在通讯录里，优先使用通讯录中的规范名称
                    const existedContact = this.data.contacts.find(c => normalizeName(c.name) === memberKey);
                    const finalName = existedContact?.name || cleaned;
                    const finalKey = normalizeName(finalName);
                    if (!finalKey || finalKey === selfNameKey || groupMemberKeys.has(finalKey)) return;

                    groupMemberKeys.add(finalKey);
                    groupMemberNames.push(finalName);
                });

                // 已有群：仅补充 AI 明确给出的成员（不覆盖、不清空、不自动新增好友）
                const existedGroup = this.data.chats.find(c => c.type === 'group' && normalizeName(c.name) === key);
                if (existedGroup) {
                    const existedMembers = Array.isArray(existedGroup.members) ? existedGroup.members : [];
                    const existedMemberKeys = new Set(existedMembers.map(m => normalizeName(m)).filter(Boolean));
                    const mergedMembers = [...existedMembers];

                    groupMemberNames.forEach(memberName => {
                        const mk = normalizeName(memberName);
                        if (!mk || mk === selfNameKey || existedMemberKeys.has(mk)) return;
                        existedMemberKeys.add(mk);
                        mergedMembers.push(memberName);
                    });

                    existedGroup.members = mergedMembers;
                    return;
                }

                // 本批次重复群名 -> 跳过
                if (batchGroupKeys.has(key)) return;

                const chatId = `group_${Date.now()}_${Math.random()}`;
                this.data.chats.push({
                    id: chatId,
                    name: groupName,
                    type: 'group',
                    avatar: group.avatar || '',
                    lastMessage: '',
                    time: '刚刚',
                    unread: 0,
                    members: groupMemberNames
                });
                addedGroupCount++;
                existingChatKeys.add(key);
                batchGroupKeys.add(key);
                
                if (group.lastMessage) {
                    this.addMessage(chatId, {
                        from: groupMemberNames[0] || '群成员',
                        content: group.lastMessage,
                        time: '刚刚',
                        type: 'text',
                        avatar: '👤'
                    });
                }
            });
        }

        // 🔥 保存初始时间（如果有）
        if (generatedData.initialTime) {
            this.storage.set('story-initial-time', JSON.stringify(generatedData.initialTime), true);
        }

        await this.saveData();
        
        return {
            success: true,
            count: addedCount,
            time: generatedData.initialTime || null,
            message: `✅ 新增${addedCount}个联系人，新增${addedGroupCount}个群聊（已有项已跳过）`
        };
        
    } catch (error) {
        console.error('❌ AI生成失败:', error);
        return {
            success: false,
            message: `生成失败: ${error.message}`
        };
    }
}
    
// 🔧 构建联系人生成提示词（重构版）
async buildContactPrompt(context) {
    const charName = context?.name2 || context?.name || '角色';
    const lobbySelection = this._buildLobbyLinkSelection(context);
    const lobbyUsers = this._resolveLobbySelectedUsers(lobbySelection);
    const lobbyUserProfiles = await this._resolveLobbySelectedUserProfiles(lobbySelection, context);
    const primaryLobbyUser = lobbyUsers.length > 0 ? lobbyUsers[0] : '';
    const userName = (lobbySelection.isLobby && primaryLobbyUser) ? primaryLobbyUser : (context?.name1 || '用户');
    const char = (context?.characters && context.characterId !== undefined)
        ? context.characters[context.characterId]
        : null;

    const description = String(char?.description || '').trim();
    const personality = String(char?.personality || char?.description || '').trim();
    const scenario = (context?.scenario || char?.scenario || '').trim();
    const systemPrompt = String(char?.data?.system_prompt || char?.system_prompt || '').trim();
    const mesExample = String(char?.mes_example || char?.data?.mes_example || '').trim();
    const firstMes = String(char?.first_mes || char?.data?.first_mes || '').trim();

    let persona = '';
    const personaTextarea = document.getElementById('persona_description');
    if (!lobbySelection.isLobby && personaTextarea && personaTextarea.value) {
        persona = personaTextarea.value.trim();
    } else if (lobbySelection.isLobby) {
        if (lobbyUserProfiles.length === 1) {
            persona = lobbyUserProfiles[0].description || '暂无该用户人设';
        } else if (lobbyUserProfiles.length > 1) {
            const lines = lobbyUserProfiles.map(item => {
                const desc = item.description || '暂无该用户人设';
                return `【${item.name}】\n${desc}`;
            });
            persona = `大厅勾选用户人设如下：\n${lines.join('\n\n')}`;
        }
    }

    let charWorldBook = '';
    if (char?.data?.character_book?.entries) {
        const entries = char.data.character_book.entries;
        const chunks = [];
        entries.forEach((entry, idx) => {
            if (!entry?.content) return;
            const title = entry.comment || entry.keys || `条目${idx + 1}`;
            chunks.push(`【${title}】\n${entry.content}`);
        });
        charWorldBook = chunks.join('\n\n');
    }

    let chatHistory = '';
    if (Array.isArray(context?.chat) && context.chat.length > 0) {
        const isLobbySystemNoise = (msg, cleanText) => {
            if (!lobbySelection.isLobby) return false;
            if (msg?.is_user) return false;
            const text = String(cleanText || '').trim();
            if (!text) return true;
            if (text.includes('API 连接') && text.includes('角色管理') && text.includes('扩展程序')) return true;
            if (/如果您已连接到一个\s*API/.test(text)) return true;
            if (/将角色设为欢迎页面的助手/.test(text)) return true;
            return false;
        };

        const lines = [];
        context.chat.forEach((msg) => {
            const rawText = msg?.mes || msg?.content || '';
            const cleanText = String(rawText).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
            if (isLobbySystemNoise(msg, cleanText)) return;
            const speaker = msg?.is_user ? userName : charName;
            lines.push(`${speaker}: ${cleanText.substring(0, 300)}`);
        });
        chatHistory = lines.slice(-20).join('\n');
    }

    const promptManager = window.VirtualPhone?.promptManager;
    if (!promptManager) {
        throw new Error('PromptManager 未初始化');
    }
    if (!promptManager._loaded && typeof promptManager.ensureLoaded === 'function') {
        promptManager.ensureLoaded();
    }

    const loadContactsPrompt = promptManager.getPromptForFeature('wechat', 'loadContacts');
    if (!loadContactsPrompt) {
        throw new Error('未找到智能加载联系人提示词');
    }

    const messages = [];

    const selectedWorldbookText = await this._buildWechatWorldbookText();
    if (selectedWorldbookText) {
        messages.push({
            role: 'system',
            content: `【酒馆世界书勾选注入】\n${selectedWorldbookText}`
        });
    }

    const charCardParts = [
        `【当前主角角色卡】`,
        `姓名：${charName}`,
        description ? `描述：${description}` : '',
        personality ? `性格：${personality}` : '',
        scenario ? `场景/背景：${scenario}` : '',
        systemPrompt ? `系统提示词：${systemPrompt}` : '',
        firstMes ? `开场白：${firstMes}` : '',
        mesExample ? `对话示例：${mesExample}` : '',
        charWorldBook ? `角色卡世界书：\n${charWorldBook}` : ''
    ].filter(Boolean);
    messages.push({
        role: 'system',
        content: charCardParts.join('\n')
    });

    messages.push({
        role: 'system',
        content: `【最近聊天记录】\n${chatHistory || '暂无聊天记录'}`
    });

    messages.push({
        role: 'system',
        content: '以上是故事的参考背景。现在你是一个数据分析助手，不是角色扮演AI。请根据以下用户信息、最近聊天记录和上方故事背景，生成专属于用户的微信联系人列表、群聊和手机初始时间。'
    });

    const userInfoParts = [
        `【用户信息】`,
        `姓名：${userName}`,
        persona || '暂无用户信息'
    ];
    messages.push({
        role: 'system',
        content: userInfoParts.join('\n')
    });

    if (lobbySelection.isLobby) {
        const selectedCharacterText = lobbySelection.characters.length > 0
            ? lobbySelection.characters.map(item => this._formatLobbyCharacterDetail(item)).join('\n')
            : '未勾选角色卡';
        const selectedGroupText = lobbySelection.groups.length > 0
            ? lobbySelection.groups.map(item => {
                const members = Array.isArray(item.members) && item.members.length > 0 ? `：${item.members.join('、')}` : '';
                return `${item.name}${members}`;
            }).join('；')
            : '未勾选用户组';
        const selectedUserHint = lobbyUsers.length > 0
            ? `\n大厅用户：${lobbyUsers.join('、')}\n主用户（优先视角）：${primaryLobbyUser}`
            : '\n大厅用户：未勾选';
        messages.push({
            role: 'system',
            content: `【大厅联动白名单】\n仅允许使用下列对象构建联系人与群聊。\n角色卡详情：\n${selectedCharacterText}\n用户组：${selectedGroupText}${selectedUserHint}`
        });
    }

    const lobbyHardRule = lobbySelection.isLobby
        ? '\n\n【大厅模式硬规则】\n当前是大厅模式。请将上面所有char信息创建联系人，不得遗漏。不需要为user创建其他联系人。'
        : '';
    messages.push({
        role: 'user',
        content: `${loadContactsPrompt}${lobbyHardRule}`
    });
    return messages;
}

// 🔧 辅助方法：判断是否可能是人名
isPossibleName(str) {
    if (!str || typeof str !== 'string') return false;
    
    const s = str.trim();
    
    // 长度检查
    if (s.length < 2 || s.length > 10) return false;
    
    // 排除系统字段
    if (this.isSystemField(s)) return false;
    
    // 排除纯数字
    if (/^\d+$/.test(s)) return false;
    
    // 排除包含特殊符号的
    if (/[【】\{\}\[\]<>\/\\]/.test(s)) return false;
    
    // 中文名字规则（2-4个汉字）
    if (/^[\u4e00-\u9fa5]{2,4}$/.test(s)) return true;
    
    // 称呼类
    if (['妈妈', '爸爸', '爷爷', '奶奶', '老师', '同学', '朋友', '同事', '老板'].includes(s)) return true;
    
    // 带姓氏的可能性更大
    const commonSurnames = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡'];
    if (commonSurnames.some(surname => s.startsWith(surname))) return true;
    
    return false;
}

// 🔧 辅助方法：判断是否是系统字段
isSystemField(str) {
    if (!str) return true;
    
    const systemKeywords = [
        '时代', '天气', '地点', '年龄', '全局时间', '待办', '区域', '方位', 
        '生理', '物品', '静态', '动态', '状态', '数值', '日期', '时间',
        '服装', '服饰', '佩戴', '位置', '当前', '主角', '用户', 'NPC'
    ];
    
    return systemKeywords.some(keyword => str.includes(keyword));
}
    
async sendToAI(prompt) {
        try {
            const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
            if (!context) throw new Error('无法获取 SillyTavern 上下文');

            const messages = Array.isArray(prompt)
                ? prompt
                : [
                    { role: 'system', content: '你是一个数据分析助手，不要进行角色扮演。严格遵循用户消息中的输出格式要求。' },
                    { role: 'user', content: prompt }
                ];

            // 🚀 核心：移交 ApiManager 处理
            const apiManager = window.VirtualPhone?.apiManager;
            if (!apiManager) throw new Error('API Manager 未初始化');

            const resolvedMaxTokens = Math.max(
                8192,
                Number.parseInt(context?.max_response_length, 10) || 0,
                Number.parseInt(context?.max_length, 10) || 0,
                Number.parseInt(context?.amount_gen, 10) || 0
            );
            const callAiOptions = { appId: 'wechat', min_max_tokens: 8192 };
            if (Number.isFinite(resolvedMaxTokens) && resolvedMaxTokens > 0) {
                callAiOptions.max_tokens = resolvedMaxTokens;
            }
            const result = await apiManager.callAI(messages, callAiOptions);

            if (!result.success) {
                throw new Error(result.error);
            }

            return result.summary; // 直接返回字符串，后续逻辑会自动解析 JSON

        } catch (error) {
            console.error('❌ [AI调用] 失败:', error);
            throw error;
        }
    }
    
// 📥 解析AI返回（正则版）
parseAIResponse(text) {
    if (!text || typeof text !== 'string') {
        throw new Error('AI 返回为空');
    }

    const initMatch = text.match(/<初始化设定>([\s\S]*?)<\/初始化设定>/);
    if (!initMatch) {
        throw new Error('未找到 <初始化设定> 标签');
    }
    const initText = initMatch[1];

    const normalizeParsedGender = (value = '') => {
        const raw = String(value || '').trim().toLowerCase();
        if (/^(男|男性|男生|男孩|male|m|boy)$/.test(raw)) return 'male';
        if (/^(女|女性|女生|女孩|female|f|girl)$/.test(raw)) return 'female';
        return 'unknown';
    };
    const stripInlineGender = (value = '') => {
        let textValue = String(value || '').trim();
        textValue = textValue.replace(/\s*(?:-|—|–|：|:|=|＝)\s*(?:性别\s*[:：]?\s*)?(男|男性|男生|男孩|女|女性|女生|女孩|male|female|m|f|boy|girl)\s*$/i, '').trim();
        textValue = textValue.replace(/\s*(?:性别\s*[:：]\s*)(男|男性|男生|男孩|女|女性|女生|女孩|male|female|m|f|boy|girl)\s*$/i, '').trim();
        textValue = textValue.replace(/\s*性别\s*$/i, '').trim();
        return textValue;
    };
    const parseContactLine = (line = '') => {
        let rawLine = String(line || '').trim();
        if (!rawLine) return null;

        let gender = 'unknown';
        const genderMatch = rawLine.match(/\s*(?:-|—|–|：|:|=|＝)\s*(?:性别\s*[:：]?\s*)?(男|男性|男生|男孩|女|女性|女生|女孩|male|female|m|f|boy|girl)\s*$/i)
            || rawLine.match(/\s*(?:性别\s*[:：]\s*)(男|男性|男生|男孩|女|女性|女生|女孩|male|female|m|f|boy|girl)\s*$/i);
        if (genderMatch) {
            gender = normalizeParsedGender(genderMatch[1]);
            rawLine = stripInlineGender(rawLine);
        }

        let name = rawLine;
        let relation = '';
        const relationMatch = rawLine.match(/^(.+?)\s*[（(]\s*([^()（）]+)\s*[）)]\s*$/);
        if (relationMatch) {
            name = relationMatch[1].trim();
            relation = relationMatch[2].trim();
        }
        name = stripInlineGender(name);
        relation = stripInlineGender(relation);
        if (!name) return null;
        return {
            name,
            avatar: '',
            relation,
            remark: '',
            gender
        };
    };

    const groupBlockMatch = initText.match(/---【微信群】---([\s\S]*?)(?=---【微信好友】---)/);
    if (!groupBlockMatch) {
        throw new Error('未找到微信群段落');
    }
    const parseMemberList = (raw) => {
        return String(raw || '')
            .split(/[、,，/|；;]+/)
            .map(s => s.trim())
            .map(s => stripInlineGender(s))
            .map(s => s.replace(/\s*[（(][^()（）]+[）)]\s*$/g, '').trim())
            .filter(Boolean);
    };
    const groups = groupBlockMatch[1]
        .split('\n')
        .map(line => line.replace(/^\s*\d+\.\s*/, '').replace(/^[\-•]\s*/, '').trim())
        .filter(Boolean)
        .map(rawLine => {
            let name = rawLine;
            let members = [];

            // 格式1：群名（成员1、成员2）/ 群名（成员1）
            const withParenMatch = rawLine.match(/^(.+?)\s*[（(]\s*([\s\S]+)\s*[）)]\s*$/);
            if (withParenMatch) {
                name = withParenMatch[1].trim();
                members = parseMemberList(withParenMatch[2]);
            } else {
                // 格式2：群名: 成员1、成员2 / 群名-成员: 成员1、成员2 / 群名: 成员1
                const withColonMatch = rawLine.match(/^(.+?)(?:[：:\-]\s*成员)?[：:]\s*(.+)$/);
                if (withColonMatch) {
                    name = withColonMatch[1].trim();
                    members = parseMemberList(withColonMatch[2]);
                }
            }

            return {
                name,
                avatar: '',
                members: Array.from(new Set(members))
            };
        })
        .filter(g => g.name);

    const contactBlockMatch = initText.match(/---【微信好友】---([\s\S]*?)(?=---【初始时间】---)/);
    if (!contactBlockMatch) {
        throw new Error('未找到微信好友段落');
    }
    const contacts = contactBlockMatch[1]
        .split('\n')
        .map(line => line.replace(/^\s*\d+\.\s*/, '').replace(/^[\-•]\s*/, '').trim())
        .filter(Boolean)
        .map(rawLine => parseContactLine(rawLine))
        .filter(Boolean);

    const timeBlockMatch = initText.match(/---【初始时间】---([\s\S]*)/);
    if (!timeBlockMatch) {
        throw new Error('未找到初始时间段落');
    }
    const timeBlock = timeBlockMatch[1];

    // 🔥 核心修复：年份改为 \d{1,8}，支持 1年 到 99999999年 的修仙/科幻/古代背景
    // 允许年月日和时间之间有任意空格，支持中文冒号
    let datetimeLineMatch = timeBlock.match(/年月日[：:]\s*(\d{1,8}年[0-9]{1,2}月[0-9]{1,2}日)\s*([0-9]{1,2}[:：][0-9]{2})/);
    const weekdayLineMatch = timeBlock.match(/星期[：:]\s*(?:星期|周)?([一二三四五六日天])/);
    
    if (!datetimeLineMatch) {
        // 兜底方案：如果找不到带"年月日："前缀的，直接在段落里找时间格式
        const fallbackMatch = timeBlock.match(/(\d{1,8}年[0-9]{1,2}月[0-9]{1,2}日)\s*([0-9]{1,2}[:：][0-9]{2})/);
        if (!fallbackMatch) {
            throw new Error('初始时间格式不完整：AI未按格式返回 年月日 HH:mm');
        }
        datetimeLineMatch = [fallbackMatch[0], fallbackMatch[1], fallbackMatch[2]];
    }

    let weekdayStr = '星期一'; // 兜底默认值
    if (weekdayLineMatch) {
        weekdayStr = '星期' + weekdayLineMatch[1];
    } else {
        // 二次兜底：如果没抓到"星期："前缀，直接全文匹配
        const fallbackWeekday = timeBlock.match(/(星期|周)([一二三四五六日天])/);
        if (fallbackWeekday) {
            weekdayStr = '星期' + fallbackWeekday[2];
        }
    }

    const initialTime = {
        date: datetimeLineMatch[1],
        time: datetimeLineMatch[2].replace('：', ':'), // 兼容中文冒号
        weekday: weekdayStr
    };

    if (contacts.length === 0 && groups.length === 0) {
        throw new Error('未解析到任何联系人或群聊');
    }

    return { contacts, groups, initialTime };
}
    
    // 🎨 根据名字和关系猜测头像
    guessAvatar(name, relation) {
        const relationMap = {
            '妈妈': '👩', '母亲': '👩', 
            '爸爸': '👨', '父亲': '👨',
            '哥哥': '👨', '弟弟': '👨', '姐姐': '👩', '妹妹': '👩',
            '老师': '👨‍🏫', '教授': '👨‍🏫',
            '同事': '👔', '上司': '💼', '老板': '💼',
            '朋友': '👤', '同学': '🎓',
            '医生': '👨‍⚕️', '护士': '👩‍⚕️'
        };
        
        for (const [key, emoji] of Object.entries(relationMap)) {
            if (relation.includes(key)) {
                return emoji;
            }
        }
        
        // 根据性别猜测
        if (name.includes('女') || name.includes('小红') || name.includes('小芳')) {
            return '👩';
        }
        if (name.includes('男') || name.includes('小明') || name.includes('小刚')) {
            return '👨';
        }
        
        return '👤';
    }

    getFirstLetter(name) {
        if (!name || name.length === 0) return '#';

        const firstChar = name[0];

        // 英文字母直接返回大写
        if (/[a-zA-Z]/.test(firstChar)) {
            return firstChar.toUpperCase();
        }

        // 数字归到#
        if (/\d/.test(firstChar)) {
            return '#';
        }

        // 🔥 使用汉字 Unicode 码点范围判断拼音首字母
        // 这个方法基于 GB2312 汉字按拼音排序的特点
        const code = firstChar.charCodeAt(0);

        // 常用汉字区域 (0x4E00 - 0x9FA5)
        if (code >= 0x4E00 && code <= 0x9FA5) {
            // 基于拼音排序的区间划分
            const pinyinMap = [
                [0x9FA5, 'Z'], // 默认最大值
                [0x9F44, 'Z'], [0x9E99, 'Z'], [0x9DFA, 'Y'], [0x9D70, 'Y'],
                [0x9CE1, 'Y'], [0x9C10, 'X'], [0x9B92, 'X'], [0x9AFC, 'W'],
                [0x9A65, 'W'], [0x9963, 'T'], [0x98DC, 'T'], [0x984B, 'S'],
                [0x9798, 'S'], [0x96E8, 'R'], [0x9645, 'R'], [0x95B0, 'Q'],
                [0x9510, 'Q'], [0x9479, 'P'], [0x93D2, 'P'], [0x9338, 'O'],
                [0x928D, 'N'], [0x91E2, 'N'], [0x9149, 'M'], [0x90A8, 'M'],
                [0x8FFD, 'L'], [0x8F44, 'L'], [0x8E8A, 'K'], [0x8DDF, 'K'],
                [0x8D29, 'J'], [0x8C6A, 'J'], [0x8BB0, 'H'], [0x8AEE, 'H'],
                [0x8A3E, 'G'], [0x8984, 'G'], [0x88C4, 'F'], [0x8803, 'F'],
                [0x8757, 'E'], [0x86A9, 'D'], [0x85E9, 'D'], [0x8537, 'C'],
                [0x8468, 'C'], [0x83B8, 'B'], [0x82EB, 'B'], [0x8230, 'A']
            ];

            // 简化的拼音首字母查找（基于常用字的大致分布）
            // 这个方法不是100%准确，但覆盖率很高
            return this.getChinesePinyinInitial(firstChar) || '#';
        }

        return '#';
    }

    // 🔥 获取汉字拼音首字母（基于常用字映射 + Unicode区间估算）
    getChinesePinyinInitial(char) {
        // 优先使用精确映射
        const exactMap = {
            // 常见姓氏和名字用字
            '艾': 'A', '安': 'A', '敖': 'A', '奥': 'A', '阿': 'A', '爱': 'A', '昂': 'A',
            '白': 'B', '柏': 'B', '班': 'B', '包': 'B', '鲍': 'B', '贝': 'B', '毕': 'B', '卞': 'B', '边': 'B', '冰': 'B', '波': 'B', '博': 'B',
            '蔡': 'C', '曹': 'C', '岑': 'C', '柴': 'C', '昌': 'C', '常': 'C', '车': 'C', '陈': 'C', '成': 'C', '程': 'C', '池': 'C', '储': 'C', '楚': 'C', '褚': 'C', '崔': 'C', '春': 'C', '辰': 'C',
            '戴': 'D', '邓': 'D', '狄': 'D', '刁': 'D', '丁': 'D', '董': 'D', '窦': 'D', '杜': 'D', '段': 'D', '大': 'D', '德': 'D', '冬': 'D',
            '鄂': 'E', '恩': 'E', '尔': 'E',
            '樊': 'F', '范': 'F', '方': 'F', '房': 'F', '费': 'F', '冯': 'F', '封': 'F', '凤': 'F', '伏': 'F', '扶': 'F', '符': 'F', '傅': 'F', '付': 'F', '富': 'F', '芳': 'F', '飞': 'F', '风': 'F',
            '盖': 'G', '甘': 'G', '高': 'G', '戈': 'G', '葛': 'G', '耿': 'G', '弓': 'G', '龚': 'G', '宫': 'G', '巩': 'G', '贡': 'G', '勾': 'G', '古': 'G', '谷': 'G', '顾': 'G', '关': 'G', '管': 'G', '郭': 'G', '桂': 'G', '光': 'G', '国': 'G',
            '韩': 'H', '杭': 'H', '郝': 'H', '何': 'H', '贺': 'H', '赫': 'H', '衡': 'H', '洪': 'H', '侯': 'H', '胡': 'H', '花': 'H', '华': 'H', '滑': 'H', '怀': 'H', '黄': 'H', '惠': 'H', '霍': 'H', '海': 'H', '红': 'H', '虎': 'H', '辉': 'H',
            '姬': 'J', '嵇': 'J', '吉': 'J', '汲': 'J', '籍': 'J', '纪': 'J', '季': 'J', '贾': 'J', '简': 'J', '江': 'J', '姜': 'J', '蒋': 'J', '焦': 'J', '金': 'J', '靳': 'J', '荆': 'J', '景': 'J', '居': 'J', '鞠': 'J', '嘉': 'J', '佳': 'J', '杰': 'J', '静': 'J', '俊': 'J', '军': 'J', '君': 'J', '见': 'J',
            '康': 'K', '柯': 'K', '孔': 'K', '寇': 'K', '匡': 'K', '况': 'K', '邝': 'K', '凯': 'K', '可': 'K',
            '赖': 'L', '蓝': 'L', '郎': 'L', '劳': 'L', '雷': 'L', '冷': 'L', '黎': 'L', '李': 'L', '厉': 'L', '利': 'L', '连': 'L', '廉': 'L', '梁': 'L', '林': 'L', '凌': 'L', '令': 'L', '刘': 'L', '柳': 'L', '龙': 'L', '娄': 'L', '卢': 'L', '鲁': 'L', '陆': 'L', '路': 'L', '吕': 'L', '栾': 'L', '伦': 'L', '罗': 'L', '骆': 'L', '兰': 'L', '乐': 'L', '丽': 'L', '亮': 'L', '琳': 'L', '玲': 'L', '露': 'L', '璐': 'L', '老': 'L', '里': 'L',
            '麻': 'M', '马': 'M', '满': 'M', '毛': 'M', '茅': 'M', '梅': 'M', '孟': 'M', '糜': 'M', '米': 'M', '宓': 'M', '苗': 'M', '闵': 'M', '明': 'M', '缪': 'M', '莫': 'M', '牟': 'M', '母': 'M', '木': 'M', '穆': 'M', '慕': 'M', '美': 'M', '敏': 'M', '梦': 'M', '妙': 'M',
            '那': 'N', '南': 'N', '倪': 'N', '聂': 'N', '宁': 'N', '牛': 'N', '钮': 'N', '农': 'N', '娜': 'N', '妮': 'N', '念': 'N',
            '欧': 'O', '区': 'O',
            '潘': 'P', '庞': 'P', '裴': 'P', '彭': 'P', '皮': 'P', '平': 'P', '蒲': 'P', '濮': 'P', '朴': 'P', '鹏': 'P', '佩': 'P',
            '戚': 'Q', '齐': 'Q', '祁': 'Q', '钱': 'Q', '强': 'Q', '乔': 'Q', '秦': 'Q', '丘': 'Q', '邱': 'Q', '裘': 'Q', '屈': 'Q', '瞿': 'Q', '全': 'Q', '权': 'Q', '琪': 'Q', '琴': 'Q', '青': 'Q', '清': 'Q', '晴': 'Q', '庆': 'Q',
            '冉': 'R', '饶': 'R', '任': 'R', '荣': 'R', '容': 'R', '茹': 'R', '阮': 'R', '芮': 'R', '瑞': 'R', '蕊': 'R', '若': 'R', '然': 'R', '日': 'R',
            '桑': 'S', '沙': 'S', '山': 'S', '单': 'S', '尚': 'S', '邵': 'S', '佘': 'S', '申': 'S', '沈': 'S', '盛': 'S', '施': 'S', '石': 'S', '史': 'S', '舒': 'S', '束': 'S', '司': 'S', '宋': 'S', '苏': 'S', '孙': 'S', '索': 'S', '思': 'S', '诗': 'S', '淑': 'S', '书': 'S', '帅': 'S', '双': 'S', '爽': 'S', '水': 'S', '顺': 'S', '松': 'S', '素': 'S', '小': 'X',
            '谈': 'T', '谭': 'T', '汤': 'T', '唐': 'T', '陶': 'T', '滕': 'T', '田': 'T', '童': 'T', '佟': 'T', '涂': 'T', '屠': 'T', '天': 'T', '甜': 'T', '婷': 'T', '亭': 'T', '庭': 'T', '桐': 'T',
            '万': 'W', '汪': 'W', '王': 'W', '危': 'W', '韦': 'W', '卫': 'W', '魏': 'W', '温': 'W', '文': 'W', '翁': 'W', '邬': 'W', '巫': 'W', '吴': 'W', '伍': 'W', '武': 'W', '薇': 'W', '微': 'W', '伟': 'W', '炜': 'W', '维': 'W', '威': 'W', '婉': 'W', '皖': 'W', '晚': 'W',
            '奚': 'X', '席': 'X', '习': 'X', '夏': 'X', '项': 'X', '萧': 'X', '肖': 'X', '谢': 'X', '辛': 'X', '邢': 'X', '熊': 'X', '徐': 'X', '许': 'X', '宣': 'X', '薛': 'X', '荀': 'X', '小': 'X', '晓': 'X', '笑': 'X', '心': 'X', '欣': 'X', '新': 'X', '星': 'X', '馨': 'X', '秀': 'X', '雪': 'X', '旭': 'X', '轩': 'X', '萱': 'X', '璇': 'X', '雅': 'Y',
            '严': 'Y', '颜': 'Y', '言': 'Y', '阎': 'Y', '晏': 'Y', '燕': 'Y', '杨': 'Y', '羊': 'Y', '仰': 'Y', '姚': 'Y', '叶': 'Y', '伊': 'Y', '易': 'Y', '殷': 'Y', '尹': 'Y', '应': 'Y', '英': 'Y', '游': 'Y', '尤': 'Y', '于': 'Y', '余': 'Y', '俞': 'Y', '虞': 'Y', '元': 'Y', '袁': 'Y', '岳': 'Y', '云': 'Y', '月': 'Y', '悦': 'Y', '越': 'Y', '瑶': 'Y', '怡': 'Y', '依': 'Y', '宜': 'Y', '艺': 'Y', '忆': 'Y', '义': 'Y', '亦': 'Y', '奕': 'Y', '逸': 'Y', '毅': 'Y', '莹': 'Y', '盈': 'Y', '颖': 'Y', '映': 'Y', '永': 'Y', '咏': 'Y', '勇': 'Y', '友': 'Y', '有': 'Y', '又': 'Y', '右': 'Y', '幼': 'Y', '羽': 'Y', '雨': 'Y', '语': 'Y', '玉': 'Y', '育': 'Y', '郁': 'Y', '煜': 'Y', '裕': 'Y', '豫': 'Y', '渊': 'Y', '媛': 'Y', '缘': 'Y', '远': 'Y', '苑': 'Y', '愿': 'Y', '韵': 'Y',
            '臧': 'Z', '曾': 'Z', '翟': 'Z', '詹': 'Z', '湛': 'Z', '张': 'Z', '章': 'Z', '赵': 'Z', '甄': 'Z', '郑': 'Z', '钟': 'Z', '仲': 'Z', '周': 'Z', '朱': 'Z', '祝': 'Z', '竺': 'Z', '诸': 'Z', '庄': 'Z', '卓': 'Z', '邹': 'Z', '祖': 'Z', '左': 'Z', '子': 'Z', '梓': 'Z', '紫': 'Z', '自': 'Z', '字': 'Z', '宗': 'Z', '姿': 'Z', '智': 'Z', '志': 'Z', '芝': 'Z', '之': 'Z', '知': 'Z', '直': 'Z', '芷': 'Z', '止': 'Z', '至': 'Z', '致': 'Z', '稚': 'Z', '珍': 'Z', '真': 'Z', '振': 'Z', '镇': 'Z', '争': 'Z', '正': 'Z', '政': 'Z', '哲': 'Z', '喆': 'Z', '辙': 'Z', '者': 'Z', '这': 'Z', '浙': 'Z', '兆': 'Z', '照': 'Z', '召': 'Z', '朝': 'Z', '长': 'Z', '忠': 'Z', '中': 'Z', '众': 'Z', '舟': 'Z', '州': 'Z', '洲': 'Z', '重': 'Z', '竹': 'Z', '珠': 'Z', '株': 'Z', '主': 'Z', '柱': 'Z', '助': 'Z', '住': 'Z', '注': 'Z', '著': 'Z', '筑': 'Z', '铸': 'Z', '祝': 'Z', '驻': 'Z', '专': 'Z', '转': 'Z', '撰': 'Z', '赚': 'Z', '桩': 'Z', '装': 'Z', '壮': 'Z', '追': 'Z', '准': 'Z', '卓': 'Z', '拙': 'Z', '茁': 'Z', '着': 'Z', '灼': 'Z'
        };

        if (exactMap[char]) {
            return exactMap[char];
        }

        // 🔥 使用 Unicode 码点区间估算（基于汉字按拼音排序的规律）
        const code = char.charCodeAt(0);

        // CJK统一汉字区间的拼音首字母估算
        // 这些区间是根据GB2312等编码标准中汉字按拼音排序的特点估算的
        if (code >= 0x4E00 && code <= 0x9FFF) {
            // 简化的拼音分布区间（不100%精确，但覆盖大部分情况）
            if (code >= 0x9EA0) return 'Z';
            if (code >= 0x9D00) return 'Y';
            if (code >= 0x9B00) return 'X';
            if (code >= 0x9900) return 'W';
            if (code >= 0x9700) return 'T';
            if (code >= 0x9400) return 'S';
            if (code >= 0x9100) return 'R';
            if (code >= 0x8E00) return 'Q';
            if (code >= 0x8B00) return 'P';
            if (code >= 0x8900) return 'O';
            if (code >= 0x8700) return 'N';
            if (code >= 0x8400) return 'M';
            if (code >= 0x8000) return 'L';
            if (code >= 0x7D00) return 'K';
            if (code >= 0x7A00) return 'J';
            if (code >= 0x7700) return 'H';
            if (code >= 0x7400) return 'G';
            if (code >= 0x7100) return 'F';
            if (code >= 0x6E00) return 'E';
            if (code >= 0x6800) return 'D';
            if (code >= 0x6200) return 'C';
            if (code >= 0x5C00) return 'B';
            if (code >= 0x4E00) return 'A';
        }

        return '#';
    }

    // 🗑️ 删除消息
    deleteMessage(chatId, messageIndex) {
        if (this.data.messages[chatId] && this.data.messages[chatId][messageIndex]) {
            const deletedMsg = this.data.messages[chatId][messageIndex];
            const deletedMessages = [deletedMsg];

            // 🔥 如果删除的是通话记录(call_record)，同时删除相关的通话文字(call_text)
            if (deletedMsg.type === 'call_record') {
                const callType = deletedMsg.callType;
                const callTime = deletedMsg.time;

                // 找到这个通话记录之前连续的 call_text 消息并删除
                // 从当前位置往前找，删除同一通话的 call_text
                let i = messageIndex - 1;
                while (i >= 0) {
                    const msg = this.data.messages[chatId][i];
                    if (msg.type === 'call_text' && msg.callType === callType) {
                        // 同一类型的通话文字，删除
                        deletedMessages.push(msg);
                        this.data.messages[chatId].splice(i, 1);
                        messageIndex--; // 调整索引
                        i--;
                    } else if (msg.type === 'call_text') {
                        // 不同类型的通话文字，停止
                        break;
                    } else {
                        // 遇到其他类型消息，停止
                        break;
                    }
                }
            }

            // 删除目标消息
            this.data.messages[chatId].splice(messageIndex, 1);
            this._cleanupManagedImagesForDeletedMessages(deletedMessages);

            // 🔥 更新聊天列表的 lastMessage
            const chat = this.getChat(chatId);
            if (chat) {
                const messages = this.data.messages[chatId];
                if (messages && messages.length > 0) {
                    // 获取新的最后一条消息
                    const lastMsg = messages[messages.length - 1];
                    chat.lastMessage = this.getMessagePreview(lastMsg);
                    chat.time = lastMsg.time;
                } else {
                    // 没有消息了
                    chat.lastMessage = '';
                    chat.time = '';
                }
            }

            // 🔥 标记消息已修改
            this._messagesDirty[chatId] = true;

            // 🔥 完全重置 TimeManager，让它重新从消息中计算最新时间
            window.VirtualPhone?.timeManager?.resetTime();

            this.saveData();
        }
    }

    // 🗑️ 按消息 ID 批量删除，供聊天多选模式使用
    deleteMessagesByIds(chatId, messageIds = []) {
        const safeChatId = String(chatId || '').trim();
        const ids = Array.from(new Set(
            (Array.isArray(messageIds) ? messageIds : [])
                .map(id => String(id || '').trim())
                .filter(Boolean)
        ));
        if (!safeChatId || ids.length === 0) return 0;

        this.getMessages(safeChatId);
        let deletedCount = 0;

        ids.forEach((id) => {
            const messages = this.data.messages[safeChatId] || [];
            const index = messages.findIndex(msg => String(msg?.id || '').trim() === id);
            if (index === -1) return;
            this.deleteMessage(safeChatId, index);
            deletedCount++;
        });

        return deletedCount;
    }

    // 🗑️ 从指定消息开始，一直删除到当前聊天末尾
    deleteMessagesFromId(chatId, messageId) {
        const safeChatId = String(chatId || '').trim();
        const safeMessageId = String(messageId || '').trim();
        if (!safeChatId || !safeMessageId) return 0;

        this.getMessages(safeChatId);
        const messages = this.data.messages[safeChatId] || [];
        const startIndex = messages.findIndex(msg => String(msg?.id || '').trim() === safeMessageId);
        if (startIndex === -1) return 0;

        let deletedCount = 0;
        while ((this.data.messages[safeChatId] || []).length > startIndex) {
            this.deleteMessage(safeChatId, startIndex);
            deletedCount++;
        }

        return deletedCount;
    }

    // 🗑️ 清空聊天的所有消息
    clearMessages(chatId) {
        if (this.data.messages[chatId]) {
            const deletedMessages = Array.isArray(this.data.messages[chatId]) ? [...this.data.messages[chatId]] : [];
            // 清空消息数组
            this.data.messages[chatId] =[];
            this._cleanupManagedImagesForDeletedMessages(deletedMessages);

            // 更新聊天列表信息
            const chat = this.getChat(chatId);
            if (chat) {
                chat.lastMessage = '';
                chat.time = '';
                chat.unread = 0;
                
                // 🔥 核心防御：记录清空发生时的酒馆正文层数，防止旧楼层标签亡灵复活
                try {
                    const context = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
                    if (context && context.chat) {
                        chat.clearedAt_tavernIndex = context.chat.length - 1;
                    }
                } catch(e) {}
            }

            // 标记消息已修改
            this._messagesDirty[chatId] = true;

            // 🔥 完全重置 TimeManager，让它重新从消息中计算最新时间
            window.VirtualPhone?.timeManager?.resetTime();

            this.saveData();
        }
    }
     
    // 精确替换某一酒馆楼层产出的微信正文消息，用于用户手动编辑正文 <wechat> 后重放该楼层。
    removeMainChatTagMessagesAtFloor(targetTavernIndex) {
        const targetIndex = Number.parseInt(targetTavernIndex, 10);
        if (!Number.isFinite(targetIndex) || targetIndex < 0) return false;

        const allChats = this.data.chats || [];
        allChats.forEach(chat => {
            if (chat && chat.id) {
                this.getMessages(chat.id);
            }
        });

        let isDirty = false;
        const deletedMessages = [];

        for (const chatId in this.data.messages) {
            const messages = Array.isArray(this.data.messages[chatId]) ? this.data.messages[chatId] : [];
            const originalLen = messages.length;
            this.data.messages[chatId] = messages.filter(m => {
                if (!m?.fromMainChatTag) return true;
                const shouldDelete = Number(m.tavernMessageIndex) === targetIndex;
                if (shouldDelete) deletedMessages.push(m);
                return !shouldDelete;
            });

            if (this.data.messages[chatId].length !== originalLen) {
                this._messagesDirty[chatId] = true;
                isDirty = true;

                const chat = this.getChat(chatId);
                if (chat) {
                    const remaining = this.data.messages[chatId];
                    const latestPreviewMsg = [...remaining].reverse().find(msg =>
                        msg && msg.hiddenFromPreview !== true && msg.isTimeMarker !== true && msg.type !== 'time_marker'
                    );
                    chat.unread = 0;
                    if (latestPreviewMsg) {
                        chat.lastMessage = this.getMessagePreview(latestPreviewMsg);
                        chat.time = latestPreviewMsg.time || '';
                        chat.timestamp = latestPreviewMsg.timestamp || Date.now();
                    } else {
                        chat.lastMessage = '';
                        chat.time = '';
                    }
                }
            }
        }

        if (isDirty) {
            this._cleanupManagedImagesForDeletedMessages(deletedMessages);
            for (const chatId in this._messagesDirty) {
                if (this._messagesDirty[chatId]) {
                    this._saveMessages(chatId);
                }
            }
            this.saveData();
            window.VirtualPhone?.timeManager?.resetTime?.();
        }

        return isDirty;
    }

    // 🔥🔥🔥 强力时光机：物理截断指定楼层及之后的所有微信消息 (完美对齐记忆插件的回档逻辑) 🔥🔥🔥
    rollbackToFloor(targetTavernIndex) {
        if (targetTavernIndex === undefined || targetTavernIndex === null) return;

        // 🔥🔥🔥 核心修复：由于懒加载机制，data.messages 可能是空的！
        // 必须先遍历所有聊天，强制触发 getMessages() 从独立存储加载消息到内存，
        // 否则回滚时遍历空对象，什么都删不掉！
        const allChats = this.data.chats || [];
        allChats.forEach(chat => {
            if (chat && chat.id) {
                this.getMessages(chat.id); // 强制加载到内存
            }
        });

        let isDirty = false;
        const deletedMessages = [];

        for (const chatId in this.data.messages) {
            const originalLen = this.data.messages[chatId].length;

            this.data.messages[chatId] = this.data.messages[chatId].filter(m => {
                // 首楼空会话的特殊保护：
                // 用户先在小手机里发消息时，tavernMessageIndex 会兜底成 0。
                // 首条 AI 正文生成/转线下也会触发 rollbackToFloor(0)，不能把这些本地手机消息误删。
                if (!m.fromMainChatTag) {
                    return true;
                }
                // 只有正文 <wechat>/<回复> 标签同步出来的消息，才跟随酒馆楼层回滚。
                // 小手机线上聊天是独立会话流，不能被正文生成/重抽/滑动清掉。
                if (m.tavernMessageIndex !== undefined && m.tavernMessageIndex >= targetTavernIndex) {
                    deletedMessages.push(m);
                    return false;
                }
                return true;
            });

           // 如果该聊天有被截断的废案，更新状态
            if (this.data.messages[chatId].length !== originalLen) {
                this._messagesDirty[chatId] = true;
                isDirty = true;

                // 更新聊天列表的最后一条消息预览
                const chat = this.getChat(chatId);
                if (chat) {
                    chat.unread = 0; // 🔥 核心修复：发生回档时，必须把未读红点强制清零，消灭幽灵红点！

                    const msgs = this.data.messages[chatId];
                    if (msgs.length > 0) {
                        const lastMsg = msgs[msgs.length - 1];
                        chat.lastMessage = this.getMessagePreview(lastMsg);
                        chat.time = lastMsg.time;
                        chat.timestamp = lastMsg.timestamp || Date.now();
                    } else {
                        chat.lastMessage = '';
                        chat.time = '';
                    }
                }
            }
        }

        // 如果真的发生了回滚，保存并重置时间锚点
        if (isDirty) {
            this._cleanupManagedImagesForDeletedMessages(deletedMessages);
            // 🔥 核心修复：必须同步保存每个被修改的聊天消息，确保存储立即更新
            for (const chatId in this._messagesDirty) {
                if (this._messagesDirty[chatId]) {
                    this._saveMessages(chatId);
                }
            }
            this.saveData();
            if (window.VirtualPhone?.timeManager) {
                window.VirtualPhone.timeManager.resetTime();
            }
            console.log(`⏪ [微信数据] 时光倒流成功：已抹除第 ${targetTavernIndex} 楼及之后的所有未来数据！`);
            return true; // 🔥 新增：返回 true 表示确实发生了数据回滚
        }
        return false; // 🔥 新增：没删数据则返回 false
    }

    // ✏️ 编辑消息
    editMessage(chatId, messageIndex, newContent) {
        if (this.data.messages[chatId] && this.data.messages[chatId][messageIndex]) {
            const targetMessage = this.data.messages[chatId][messageIndex];
            targetMessage.content = newContent;
            if (targetMessage.type === 'location') {
                targetMessage.locationText = newContent;
            }
            // 🔥 标记消息已修改
            this._messagesDirty[chatId] = true;
            this.saveData();
        }
    }

    // 🎨 设置聊天背景
    setChatBackground(chatId, background) {
        const chat = this.getChat(chatId);
        if (chat) {
            chat.background = background;
            this.saveData();
        }
    }

    // 🗑️ 删除聊天
    deleteChat(chatId) {
        this.getMessages(chatId);
        const deletedMessages = Array.isArray(this.data.messages[chatId]) ? [...this.data.messages[chatId]] : [];
        this.data.chats = this.data.chats.filter(c => c.id !== chatId);
        delete this.data.messages[chatId];
        this._cleanupManagedImagesForDeletedMessages(deletedMessages);

        // 🔥 同时删除独立存储的消息
        try {
            const msgKey = this._getMessageKey(chatId);
            this.storage.set(msgKey, null, false);
        } catch (e) {
            console.warn(`⚠️ 删除聊天 ${chatId} 的消息存储失败:`, e);
        }

        // 清除加载和脏标记
        delete this._messagesLoaded[chatId];
        delete this._messagesDirty[chatId];

        this.saveData();
    }
    
    // 🚫 拉黑联系人
    blockContact(contactId) {
        const contact = this.getContact(contactId);
        if (contact) {
            contact.blocked = true;
            this.saveData();
        }
    }

    // ✅ 移除黑名单
    unblockContact(contactId) {
        const contact = this.getContact(contactId);
        if (contact) {
            contact.blocked = false;
            this.saveData();
            return true;
        }
        return false;
    }

    // 🗑️ 删除联系人及对应的单聊会话
    deleteContactAndChat(contactId) {
        // 1. 找到对应的单聊会话并删除
        const chat = this.getChatByContactId(contactId);
        if (chat && chat.type !== 'group') {
            this.deleteChat(chat.id);
        }

        // 2. 删除联系人
        const removedContact = this.data.contacts.find(c => c.id === contactId) || null;
        this.data.contacts = this.data.contacts.filter(c => c.id !== contactId);
        if (this._isHoneySyncedContact(removedContact)) {
            this._markHoneyDeletedWechatContact(removedContact);
            this.globalSocialStore?.removeAppContact?.('wechat', String(contactId || '').trim());
            this._removeLinkedHoneyFriend(removedContact);
        }
        if (this.data.contactGenderMap && typeof this.data.contactGenderMap === 'object') {
            delete this.data.contactGenderMap[contactId];
        }
        if (this.data.contactAvatarGroupMap && typeof this.data.contactAvatarGroupMap === 'object') {
            delete this.data.contactAvatarGroupMap[contactId];
        }
        if (this.data.contactAutoAvatarMap && typeof this.data.contactAutoAvatarMap === 'object') {
            delete this.data.contactAutoAvatarMap[contactId];
        }

        // 3. 保存数据
        this.saveData();
    }

    _removeLinkedHoneyFriend(contact) {
        const safeName = String(contact?.name || '').trim();
        if (!safeName) return;
        const safeHostName = String(contact?.honeyHostName || contact?.extra?.honeyHostName || contact?.honeySource || '').trim();
        try {
            const honeyData = window.VirtualPhone?.honeyApp?.honeyData || null;
            if (honeyData && typeof honeyData.removeHoneyFriend === 'function') {
                honeyData.removeHoneyFriend(safeName, { skipWechatDelete: true });
                if (typeof honeyData.removeFollowedHost === 'function') {
                    honeyData.removeFollowedHost(safeName);
                    if (safeHostName && safeHostName !== safeName) {
                        honeyData.removeFollowedHost(safeHostName);
                    }
                }
                return;
            }

            const globalHoneyContacts = this.globalSocialStore?.getContactsByApp?.('honey') || [];
            globalHoneyContacts
                .filter(item => {
                    const entryNameKey = this._normalizeContactNameKey(item?.name || '');
                    const hostNameKey = this._normalizeContactNameKey(item?.extra?.honeyHostName || item?.extra?.honeySource || '');
                    const safeNameKey = this._normalizeContactNameKey(safeName);
                    const safeHostNameKey = this._normalizeContactNameKey(safeHostName);
                    return entryNameKey === safeNameKey
                        || (safeHostNameKey && entryNameKey === safeHostNameKey)
                        || (safeHostNameKey && hostNameKey === safeHostNameKey);
                })
                .forEach((match) => {
                    if (match?.appContactId) {
                        this.globalSocialStore?.removeAppContact?.('honey', match.appContactId);
                    }
                });
            this._removeLegacyHoneyFriendByName(safeName);
        } catch (e) {
            console.warn('⚠️ 删除微信蜜语联系人时同步清理蜜语好友失败:', e);
        }
    }

    _clearLinkedHoneyFriendsForWechatReset() {
        try {
            const honeyContacts = this.globalSocialStore?.getContactsByApp?.('honey') || [];
            honeyContacts
                .filter(item => this._isHoneySyncedContact(item))
                .forEach(item => {
                    if (item?.appContactId) {
                        this.globalSocialStore?.removeAppContact?.('honey', item.appContactId);
                    }
                });

            const honeyData = window.VirtualPhone?.honeyApp?.honeyData || null;
            if (honeyData && typeof honeyData.saveHoneyFriends === 'function') {
                honeyData.saveHoneyFriends([]);
            }
            this._removeLegacyHoneyFriendByName('');
        } catch (e) {
            console.warn('⚠️ 微信全清时同步清理蜜语好友失败:', e);
        }
    }

    _removeLegacyHoneyFriendByName(name = '') {
        const targetKey = this._normalizeContactNameKey(name);
        const keys = ['global_honey_my_friends', 'honey_my_friends'];
        keys.forEach((key) => {
            try {
                const raw = this.storage?.get?.(key);
                if (!raw) return;
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (!Array.isArray(parsed)) {
                    this.storage?.remove?.(key);
                    return;
                }
                const next = targetKey
                    ? parsed.filter(item => this._normalizeContactNameKey(item?.name || item?.nickname || '') !== targetKey)
                    : [];
                if (next.length > 0) {
                    this.storage?.set?.(key, JSON.stringify(next));
                } else {
                    this.storage?.remove?.(key);
                }
            } catch (e) {
                // 旧格式无法解析时直接移除，避免继续回灌幽灵蜜语好友
                this.storage?.remove?.(key);
            }
        });
    }

    // ========================================
    // 🆕 群聊管理（新增）
    // ========================================
    
    // 创建群聊
    createGroupChat(groupInfo) {
        const chatId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const groupChat = {
            id: chatId,
            name: groupInfo.name || '群聊',
            type: 'group',
            avatar: groupInfo.avatar || '',
            lastMessage: '',
            time: '刚刚',
            unread: 0,
            timestamp: Date.now(),
            members: groupInfo.members || [],
            createdAt: new Date().toISOString()
        };

        this.data.chats.push(groupChat);
        
        const storyTime = window.VirtualPhone?.timeManager?.getCurrentStoryTime?.() || null;

        // 🔥 添加系统消息：谁创建了群聊
        this.addMessage(chatId, {
            from: 'system',
            content: `你创建了群聊"${groupInfo.name}"`,
            time: storyTime?.time || new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
            date: storyTime?.date || '',
            weekday: storyTime?.weekday || '',
            type: 'system',
            avatar: '📢'
        });
        
        this.saveData();
        return groupChat;
    }
    
    // 添加群成员
    addGroupMember(chatId, memberId) {
        const chat = this.getChat(chatId);
        if (chat && chat.type === 'group') {
            if (!chat.members.includes(memberId)) {
                chat.members.push(memberId);
                this.saveData();
            }
        }
    }
    
    // 移除群成员
    removeGroupMember(chatId, memberId) {
        const chat = this.getChat(chatId);
        if (chat && chat.type === 'group') {
            chat.members = chat.members.filter(id => id !== memberId);
            this.saveData();
        }
    }    
    
// ========================================
// 🎨 自定义表情管理
// ========================================

// 获取所有自定义表情
getCustomEmojis() {
    if (!Array.isArray(this.data.customEmojis)) {
        this.data.customEmojis = this._loadGlobalCustomEmojis();
    }
    return this.data.customEmojis;
}

// 获取单个自定义表情
getCustomEmoji(emojiId) {
    return this.data.customEmojis?.find(e => e.id === emojiId);
}

// 更新自定义表情
updateCustomEmoji(emojiId, patch = {}) {
    if (!this.data.customEmojis || !patch || typeof patch !== 'object') return null;

    const targetIndex = this.data.customEmojis.findIndex(e => e.id === emojiId);
    if (targetIndex < 0) return null;

    const current = this.data.customEmojis[targetIndex] || {};
    const nextName = String(patch.name ?? current.name ?? '').trim() || current.name || `表情${targetIndex + 1}`;
    const nextDescription = String(patch.description ?? patch.name ?? current.description ?? current.name ?? '').trim() || nextName;

    this.data.customEmojis[targetIndex] = {
        ...current,
        ...patch,
        name: nextName,
        description: nextDescription
    };

    this.data.customEmojis = this._normalizeCustomEmojiList(this.data.customEmojis);
    this._saveGlobalCustomEmojis(this.data.customEmojis);
    this.saveData();
    return this.data.customEmojis[targetIndex];
}

// 添加自定义表情
addCustomEmoji(emojiData) {
    if (!Array.isArray(this.data.customEmojis)) {
        this.data.customEmojis = this._loadGlobalCustomEmojis();
    }
    
    const emoji = {
        id: `emoji_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: String(emojiData?.name || '').trim() || `表情${(this.data.customEmojis?.length || 0) + 1}`,
        description: String(emojiData?.description || emojiData?.name || '').trim() || `表情${(this.data.customEmojis?.length || 0) + 1}`,
        image: emojiData.image,
        createdAt: new Date().toISOString()
    };
    
    this.data.customEmojis.push(emoji);
    this.data.customEmojis = this._normalizeCustomEmojiList(this.data.customEmojis);
    this._saveGlobalCustomEmojis(this.data.customEmojis);
    this.saveData();
    
    return emoji;
}

// 删除自定义表情
deleteCustomEmoji(emojiId) {
    if (!Array.isArray(this.data.customEmojis)) {
        this.data.customEmojis = this._loadGlobalCustomEmojis();
    }
    
    this.data.customEmojis = this.data.customEmojis.filter(e => e.id !== emojiId);
    this._saveGlobalCustomEmojis(this.data.customEmojis);
    this.saveData();
    
   }
}
