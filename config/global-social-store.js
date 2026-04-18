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

export class GlobalSocialStore {
    constructor(storage) {
        this.storage = storage;
        this.storeKey = 'global_social_store_v1';
        this.maxMessagesPerThread = 320;
        this._cache = null;
    }

    _defaultStore() {
        return {
            version: 1,
            updatedAt: Date.now(),
            contacts: {},          // contactId -> contact
            aliases: {},           // normalizedName -> contactId
            appContactMap: {},     // app:contactId -> contactId
            conversations: {},     // conversationId -> conversation
            appConversationMap: {} // app:conversationId -> conversationId
        };
    }

    _clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    _normalizeNameKey(value) {
        return String(value || '')
            .trim()
            .replace(/\s+/g, '')
            .toLowerCase();
    }

    _normalizeAppKey(app, id) {
        const safeApp = String(app || '').trim().toLowerCase();
        const safeId = String(id || '').trim();
        if (!safeApp || !safeId) return '';
        return `${safeApp}:${safeId}`;
    }

    _toNumber(value, fallback = Date.now()) {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    }

    _safeParse(raw) {
        if (!raw) return null;
        try {
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (e) {
            return null;
        }
    }

    _ensureLoaded() {
        if (this._cache && typeof this._cache === 'object') return this._cache;

        const parsed = this._safeParse(this.storage?.get?.(this.storeKey, null));
        const base = this._defaultStore();
        const merged = (parsed && typeof parsed === 'object')
            ? { ...base, ...parsed }
            : base;

        if (!merged.contacts || typeof merged.contacts !== 'object') merged.contacts = {};
        if (!merged.aliases || typeof merged.aliases !== 'object') merged.aliases = {};
        if (!merged.appContactMap || typeof merged.appContactMap !== 'object') merged.appContactMap = {};
        if (!merged.conversations || typeof merged.conversations !== 'object') merged.conversations = {};
        if (!merged.appConversationMap || typeof merged.appConversationMap !== 'object') merged.appConversationMap = {};

        this._cache = merged;
        return this._cache;
    }

    _commit() {
        const store = this._ensureLoaded();
        store.updatedAt = Date.now();
        this.storage?.set?.(this.storeKey, JSON.stringify(store));
    }

    getSnapshot() {
        return this._clone(this._ensureLoaded());
    }

    _createContactSkeleton({ name = '', avatar = '', relation = '' } = {}) {
        const now = Date.now();
        return {
            id: `gcontact_${now}_${Math.random().toString(36).slice(2, 8)}`,
            name: String(name || '').trim(),
            avatar: String(avatar || '').trim(),
            relation: String(relation || '').trim(),
            appRefs: {}, // app -> { appContactId, syncedAt, extra }
            createdAt: now,
            updatedAt: now
        };
    }

    upsertContact({ app = '', appContactId = '', name = '', avatar = '', relation = '', extra = {} } = {}) {
        const safeName = String(name || '').trim();
        if (!safeName) return null;

        const store = this._ensureLoaded();
        const appKey = this._normalizeAppKey(app, appContactId);
        const nameKey = this._normalizeNameKey(safeName);

        let globalId = appKey ? store.appContactMap[appKey] : '';
        if (!globalId && nameKey) {
            globalId = store.aliases[nameKey] || '';
        }

        let contact = (globalId && store.contacts[globalId]) ? store.contacts[globalId] : null;
        if (!contact) {
            contact = this._createContactSkeleton({ name: safeName, avatar, relation });
            store.contacts[contact.id] = contact;
            globalId = contact.id;
        }

        if (!contact.name && safeName) contact.name = safeName;
        if (!contact.avatar && avatar) contact.avatar = String(avatar || '').trim();
        if (!contact.relation && relation) contact.relation = String(relation || '').trim();

        if (safeName) {
            contact.name = safeName;
            if (nameKey) store.aliases[nameKey] = contact.id;
        }
        if (avatar) contact.avatar = String(avatar || '').trim();
        if (relation) contact.relation = String(relation || '').trim();

        const safeApp = String(app || '').trim().toLowerCase();
        const safeContactId = String(appContactId || '').trim();
        if (safeApp && safeContactId) {
            if (!contact.appRefs || typeof contact.appRefs !== 'object') contact.appRefs = {};
            contact.appRefs[safeApp] = {
                appContactId: safeContactId,
                syncedAt: Date.now(),
                extra: (extra && typeof extra === 'object') ? this._clone(extra) : {}
            };
            store.appContactMap[this._normalizeAppKey(safeApp, safeContactId)] = contact.id;
        }

        contact.updatedAt = Date.now();
        this._commit();
        return this._clone(contact);
    }

    getContactsByApp(app = '') {
        const safeApp = String(app || '').trim().toLowerCase();
        if (!safeApp) return [];
        const store = this._ensureLoaded();
        return Object.values(store.contacts || {})
            .filter(contact => contact?.appRefs?.[safeApp]?.appContactId)
            .map(contact => {
                const ref = contact.appRefs[safeApp];
                return {
                    globalId: contact.id,
                    app,
                    appContactId: String(ref.appContactId || ''),
                    name: String(contact.name || '').trim(),
                    avatar: String(contact.avatar || '').trim(),
                    relation: String(contact.relation || '').trim(),
                    extra: (ref.extra && typeof ref.extra === 'object') ? this._clone(ref.extra) : {},
                    updatedAt: this._toNumber(contact.updatedAt)
                };
            })
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }

    removeAppContact(app = '', appContactId = '') {
        const safeKey = this._normalizeAppKey(app, appContactId);
        if (!safeKey) return false;

        const store = this._ensureLoaded();
        const globalId = store.appContactMap[safeKey];
        if (!globalId || !store.contacts[globalId]) {
            delete store.appContactMap[safeKey];
            this._commit();
            return false;
        }

        delete store.appContactMap[safeKey];
        const safeApp = String(app || '').trim().toLowerCase();
        if (store.contacts[globalId].appRefs?.[safeApp]) {
            delete store.contacts[globalId].appRefs[safeApp];
            store.contacts[globalId].updatedAt = Date.now();
        }
        this._commit();
        return true;
    }

    _createConversationSkeleton({ app = '', appConversationId = '', name = '', type = 'single', participantContactIds = [] } = {}) {
        const now = Date.now();
        return {
            id: `gconv_${now}_${Math.random().toString(36).slice(2, 8)}`,
            appRefs: {}, // app -> appConversationId
            name: String(name || '').trim(),
            type: String(type || 'single').trim() || 'single',
            participantContactIds: Array.isArray(participantContactIds) ? [...participantContactIds] : [],
            lastMessage: '',
            lastTime: '',
            timestamp: now,
            messages: [],
            createdAt: now,
            updatedAt: now
        };
    }

    upsertConversation({ app = '', appConversationId = '', name = '', type = 'single', participantContactIds = [] } = {}) {
        const store = this._ensureLoaded();
        const appKey = this._normalizeAppKey(app, appConversationId);
        let conversationId = appKey ? store.appConversationMap[appKey] : '';
        let conversation = (conversationId && store.conversations[conversationId]) ? store.conversations[conversationId] : null;

        if (!conversation) {
            conversation = this._createConversationSkeleton({ app, appConversationId, name, type, participantContactIds });
            store.conversations[conversation.id] = conversation;
            conversationId = conversation.id;
        }

        const safeApp = String(app || '').trim().toLowerCase();
        const safeConversationId = String(appConversationId || '').trim();
        if (safeApp && safeConversationId) {
            conversation.appRefs[safeApp] = {
                appConversationId: safeConversationId,
                syncedAt: Date.now()
            };
            store.appConversationMap[this._normalizeAppKey(safeApp, safeConversationId)] = conversation.id;
        }

        if (name) conversation.name = String(name || '').trim();
        if (type) conversation.type = String(type || 'single').trim();
        if (Array.isArray(participantContactIds) && participantContactIds.length > 0) {
            const merged = new Set([...(conversation.participantContactIds || []), ...participantContactIds]);
            conversation.participantContactIds = Array.from(merged).filter(Boolean);
        }

        conversation.updatedAt = Date.now();
        this._commit();
        return this._clone(conversation);
    }

    appendMessage({ app = '', appConversationId = '', conversationName = '', conversationType = 'single', message = {} } = {}) {
        const safeConversationId = String(appConversationId || '').trim();
        if (!safeConversationId) return false;

        const conv = this.upsertConversation({
            app,
            appConversationId: safeConversationId,
            name: conversationName,
            type: conversationType
        });
        if (!conv?.id) return false;

        const store = this._ensureLoaded();
        const target = store.conversations[conv.id];
        if (!target) return false;

        const safeMessageId = String(message?.id || '').trim();
        const safeContent = String(message?.content || message?.text || '').trim();
        if (!safeMessageId && !safeContent) return false;

        const dedupeKey = safeMessageId || `${String(message?.from || '').trim()}::${safeContent}::${String(message?.time || '').trim()}`;
        const exists = (target.messages || []).some(item => {
            const key = String(item?.id || `${item?.from || ''}::${item?.content || ''}::${item?.time || ''}`);
            return key === dedupeKey;
        });
        if (exists) return false;

        const now = Date.now();
        const nextMessage = {
            id: safeMessageId || `gmsg_${now}_${Math.random().toString(36).slice(2, 8)}`,
            from: String(message?.from || '').trim(),
            fromAppContactId: String(message?.fromAppContactId || '').trim(),
            type: String(message?.type || 'text').trim() || 'text',
            content: safeContent,
            time: String(message?.time || '').trim(),
            timestamp: this._toNumber(message?.timestamp, now),
            sourceChatId: String(message?.sourceChatId || '').trim(),
            sourceMessageIndex: Number.isInteger(message?.sourceMessageIndex) ? message.sourceMessageIndex : null,
            createdAt: now
        };

        if (!Array.isArray(target.messages)) target.messages = [];
        target.messages.push(nextMessage);
        if (target.messages.length > this.maxMessagesPerThread) {
            target.messages = target.messages.slice(-this.maxMessagesPerThread);
        }

        target.lastMessage = nextMessage.content || target.lastMessage || '';
        target.lastTime = nextMessage.time || target.lastTime || '';
        target.timestamp = this._toNumber(nextMessage.timestamp, now);
        target.updatedAt = now;

        this._commit();
        return true;
    }

    getConversationMessages(app = '', appConversationId = '') {
        const safeKey = this._normalizeAppKey(app, appConversationId);
        if (!safeKey) return [];

        const store = this._ensureLoaded();
        const conversationId = store.appConversationMap[safeKey];
        if (!conversationId) return [];

        const target = store.conversations[conversationId];
        if (!target || !Array.isArray(target.messages)) return [];
        return this._clone(target.messages);
    }

    removeConversation(app = '', appConversationId = '') {
        const safeKey = this._normalizeAppKey(app, appConversationId);
        if (!safeKey) return false;

        const store = this._ensureLoaded();
        const conversationId = store.appConversationMap[safeKey];
        if (!conversationId) {
            delete store.appConversationMap[safeKey];
            this._commit();
            return false;
        }

        delete store.appConversationMap[safeKey];
        if (store.conversations[conversationId]) {
            const refs = store.conversations[conversationId].appRefs || {};
            const hasOtherRef = Object.entries(refs).some(([refApp, refInfo]) => {
                const refKey = this._normalizeAppKey(refApp, refInfo?.appConversationId);
                return refKey && refKey !== safeKey;
            });
            if (!hasOtherRef) {
                delete store.conversations[conversationId];
            } else {
                const safeApp = String(app || '').trim().toLowerCase();
                delete store.conversations[conversationId].appRefs[safeApp];
                store.conversations[conversationId].updatedAt = Date.now();
            }
        }

        this._commit();
        return true;
    }
}
