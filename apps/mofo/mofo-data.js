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
// 魔坊APP数据层
// ========================================

export class MofoData {
    constructor(storage) {
        this.storage = storage;
        this._cache = null;
        this._sessionStateCache = null;
        this._sessionCacheToken = '';
        this.STORAGE_KEY = 'mofo_generators';
        this.SESSION_STATE_KEY = 'chat_mofo_runtime_states';
        this.DELETED_IDS_KEY = 'mofo_deleted_item_ids';
        this.MAX_DELETED_IDS = 2000;
    }

    getBootstrapState() {
        return {
            initializedAt: Date.now(),
            items: this.getItems()
        };
    }

    _clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    _escapeRegex(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    _normalizeTagName(value, fallbackName = 'mofo') {
        const raw = String(value || '').trim();
        const fromName = String(fallbackName || '').trim();
        const cleaned = (raw || fromName)
            .replace(/[<>]/g, '')
            .replace(/[\r\n\t]/g, '')
            .replace(/\s+/g, '');
        return cleaned || 'mofo';
    }

    _decodeText(raw) {
        return String(raw || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .trim();
    }

    _normalizePayloadText(raw) {
        const normalized = this._decodeText(raw);
        const fenceMatch = normalized.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
        return fenceMatch ? String(fenceMatch[1] || '').trim() : normalized;
    }

    _extractBalancedJsonBlock(text, openChar = '{', closeChar = '}') {
        const source = String(text || '');
        const start = source.indexOf(openChar);
        if (start < 0) return '';
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = start; i < source.length; i += 1) {
            const ch = source[i];
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (ch === '\\') {
                    escaped = true;
                } else if (ch === '"') {
                    inString = false;
                }
                continue;
            }
            if (ch === '"') {
                inString = true;
                continue;
            }
            if (ch === openChar) depth += 1;
            if (ch === closeChar) {
                depth -= 1;
                if (depth === 0) {
                    return source.slice(start, i + 1).trim();
                }
            }
        }
        return '';
    }

    _parseJsonFromLooseText(raw) {
        const text = String(raw || '').trim();
        if (!text) return null;

        const tryParse = (candidate) => {
            const c = String(candidate || '').trim();
            if (!c) return null;
            try {
                return JSON.parse(c);
            } catch (e) {
                return null;
            }
        };

        // 1) 整段就是 JSON
        let parsed = tryParse(text);
        if (parsed !== null) return parsed;

        // 2) 文本中包含 ```json ... ```
        const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (fence) {
            parsed = tryParse(fence[1]);
            if (parsed !== null) return parsed;
        }

        // 3) 文本中包含 JSON 对象或数组片段
        const objBlock = this._extractBalancedJsonBlock(text, '{', '}');
        if (objBlock) {
            parsed = tryParse(objBlock);
            if (parsed !== null) return parsed;
        }
        const arrBlock = this._extractBalancedJsonBlock(text, '[', ']');
        if (arrBlock) {
            parsed = tryParse(arrBlock);
            if (parsed !== null) return parsed;
        }

        return null;
    }

    _convertPrimitive(value) {
        const text = String(value || '').trim();
        if (!text) return '';
        if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
        if (/^(true|false)$/i.test(text)) return /^true$/i.test(text);
        if (/^null$/i.test(text)) return null;
        return text;
    }

    _parseBoolean(value, fallback = true) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        const text = String(value ?? '').trim().toLowerCase();
        if (!text) return !!fallback;
        if (['true', '1', 'yes', 'on', 'checked', 'enable', 'enabled'].includes(text)) return true;
        if (['false', '0', 'no', 'off', 'unchecked', 'disable', 'disabled'].includes(text)) return false;
        return !!fallback;
    }

    _resolveTemplatePathValue(state = {}, expr = '') {
        const path = String(expr || '').trim();
        if (!path) return '';

        const normalizedPath = path
            .replace(/\[(\d+)\]/g, '.$1')
            .replace(/^\.+|\.+$/g, '');
        if (!normalizedPath) return '';

        const segments = normalizedPath.split('.').map(s => String(s || '').trim()).filter(Boolean);
        if (segments.length === 0) return '';

        let current = state;
        for (const seg of segments) {
            if (current === null || current === undefined) return '';
            if (Array.isArray(current)) {
                const idx = Number(seg);
                if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) return '';
                current = current[idx];
                continue;
            }
            if (typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, seg)) {
                current = current[seg];
                continue;
            }
            return '';
        }
        return current;
    }

    _templateValueToString(value) {
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch (e) {
                return '';
            }
        }
        return String(value);
    }

    renderTemplate(template, state = {}) {
        const source = String(template || '');
        if (!source) return '';
        const safeState = (state && typeof state === 'object') ? state : {};
        return source.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, expr) => {
            const rawValue = this._resolveTemplatePathValue(safeState, expr);
            return this._templateValueToString(rawValue);
        });
    }

    _normalizeUpdateMode(value, fallback = 'append') {
        const text = String(value ?? '').trim().toLowerCase();
        if (['append', 'accumulate', 'list', 'persist', 'persistent', '累计', '累积', '追加'].includes(text)) {
            return 'append';
        }
        if (['replace', 'overwrite', 'single', 'instant', '替换', '覆盖'].includes(text)) {
            return 'replace';
        }
        return fallback === 'replace' ? 'replace' : 'append';
    }

    _pickPrimaryId(value) {
        if (!value || typeof value !== 'object') return '';
        const candidates = [value.id, value.mailId, value.msgId, value.uid, value.key, value.ID, value.编号];
        for (const c of candidates) {
            const text = String(c ?? '').trim();
            if (text) return text;
        }
        return '';
    }

    _stableStringify(value) {
        const seen = new WeakSet();
        const walk = (input) => {
            if (input === null || typeof input !== 'object') return input;
            if (seen.has(input)) return '[Circular]';
            seen.add(input);
            if (Array.isArray(input)) {
                return input.map(item => walk(item));
            }
            const sorted = {};
            Object.keys(input).sort().forEach((key) => {
                sorted[key] = walk(input[key]);
            });
            return sorted;
        };
        try {
            return JSON.stringify(walk(value));
        } catch (e) {
            return '';
        }
    }

    _hashText(raw) {
        const text = String(raw || '');
        let hash = 2166136261;
        for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        const unsigned = hash >>> 0;
        return unsigned.toString(36);
    }

    _pickMailField(entry, fieldNames = []) {
        if (!entry || typeof entry !== 'object') return '';
        for (const name of fieldNames) {
            const value = entry[name];
            const text = String(value ?? '').trim();
            if (text) return text;
        }
        return '';
    }

    _generateStableMailId(entry, index = 0) {
        const explicitId = this._pickMailField(entry, [
            'id', 'mailId', 'msgId', 'uid', 'key', 'ID', '编号'
        ]);
        if (explicitId) return explicitId;

        const title = this._pickMailField(entry, ['subject', 'title', 'theme', 'topic', '标题', '主题']);
        const from = this._pickMailField(entry, ['from', 'sender', 'author', 'src', '发件人']);
        const to = this._pickMailField(entry, ['to', 'receiver', 'recipient', 'dst', '收件人']);
        const date = this._pickMailField(entry, ['date', 'time', 'datetime', 'sentAt', '日期', '时间']);
        const preview = this._pickMailField(entry, ['preview', 'snippet', 'summary', '摘要', '预览']);
        const body = this._pickMailField(entry, ['body', 'content', 'text', '正文', '内容']);

        let seed = [title, from, to, date].filter(Boolean).join('|');
        if (!seed) seed = [title, from, preview, body].filter(Boolean).join('|');
        if (!seed) seed = this._stableStringify(entry);
        if (!seed) seed = `fallback_${index}`;

        return `mail_${this._hashText(seed)}`;
    }

    _appendUniqueObjects(baseList = [], incomingList = []) {
        const result = Array.isArray(baseList) ? this._clone(baseList) : [];
        const seenIds = new Set(
            result
                .map(item => this._pickPrimaryId(item))
                .filter(Boolean)
                .map(v => String(v))
        );

        (Array.isArray(incomingList) ? incomingList : []).forEach(item => {
            const normalized = (item && typeof item === 'object') ? this._clone(item) : item;
            const pid = this._pickPrimaryId(normalized);
            if (pid && seenIds.has(String(pid))) {
                return;
            }
            if (pid) seenIds.add(String(pid));
            result.push(normalized);
        });
        return result;
    }

    _guessAppendArrayKey(patch = {}, currentState = {}, item = {}) {
        const preferredFromItem = String(item.appendListField || '').trim();
        if (preferredFromItem && Array.isArray(patch[preferredFromItem])) return preferredFromItem;

        const preferred = ['mails', 'emails', 'inbox', 'messages', 'mailList', 'items'];
        for (const key of preferred) {
            if (Array.isArray(patch[key])) return key;
        }
        for (const [key, value] of Object.entries(patch || {})) {
            if (Array.isArray(value) && Array.isArray(currentState?.[key])) {
                return key;
            }
        }
        return '';
    }

    _isMailListKey(key = '') {
        const text = String(key || '').trim().toLowerCase();
        return ['mails', 'emails', 'inbox', 'mailbox', 'mail_list', 'maillist'].includes(text);
    }

    _resolvePhoneDateTimeText() {
        try {
            const storyTime = window?.VirtualPhone?.timeManager?.getCurrentStoryTime?.();
            if (storyTime?.date && storyTime?.time) {
                return `${String(storyTime.date).trim()} ${String(storyTime.time).trim()}`.trim();
            }
        } catch (e) {}

        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }

    _normalizeIncomingMailList(rawList = []) {
        const list = Array.isArray(rawList) ? rawList : [];
        const fallbackDate = this._resolvePhoneDateTimeText();
        return list.map((entry, index) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
            const next = this._clone(entry);
            next.id = this._generateStableMailId(next, index);

            const dateText = this._pickMailField(next, [
                'date', 'time', 'datetime', 'sentAt', '日期', '时间'
            ]);
            if (!dateText) {
                next.date = fallbackDate;
            }
            if (!String(next.preview ?? '').trim()) {
                const summaryText = this._pickMailField(next, ['摘要', '预览', 'summary', 'snippet']);
                if (summaryText) {
                    next.preview = summaryText;
                }
            }
            if (!String(next.preview ?? '').trim()) {
                const bodyText = this._pickMailField(next, ['body', 'content', 'text', '正文', '内容'])
                    .replace(/\s+/g, ' ')
                    .trim();
                if (bodyText) next.preview = bodyText.slice(0, 48);
            }
            return next;
        });
    }

    _parseStatePayload(raw, baseState = {}) {
        const nextBase = (baseState && typeof baseState === 'object' && !Array.isArray(baseState))
            ? this._clone(baseState)
            : {};

        // 直接支持对象输入，避免被 String(obj) 变成 "[object Object]"
        if (raw && typeof raw === 'object') {
            if (Array.isArray(raw)) {
                return { ...nextBase, items: this._clone(raw) };
            }
            return { ...nextBase, ...this._clone(raw) };
        }

        const text = this._normalizePayloadText(raw);
        if (!text) return nextBase;
        if (text === '[object Object]') return nextBase;

        const looseParsed = this._parseJsonFromLooseText(text);
        if (looseParsed !== null) {
            if (looseParsed && typeof looseParsed === 'object' && !Array.isArray(looseParsed)) {
                return { ...nextBase, ...this._clone(looseParsed) };
            }
            if (Array.isArray(looseParsed)) {
                return { ...nextBase, items: this._clone(looseParsed) };
            }
        } else {
            // 如果文本明显是 JSON 但格式损坏，直接忽略，避免污染为 "\"id\"" 这类脏键
            const looksLikeJson = /^[\[{]/.test(text) || /"[^"]+"\s*:\s*/.test(text) || /```(?:json)?/i.test(text);
            if (looksLikeJson) {
                return nextBase;
            }
            // 非 JSON 场景再走 key:value 行解析
        }

        const lineMap = {};
        const lines = text.split(/\r?\n|[；;]+/g).map(line => line.trim()).filter(Boolean);
        lines.forEach(line => {
            const match = line.match(/^([^:：=]+)\s*[:：=]\s*(.+)$/);
            if (!match) return;
            const key = String(match[1] || '').trim();
            const val = this._convertPrimitive(match[2]);
            if (!key) return;
            lineMap[key] = val;
        });

        if (Object.keys(lineMap).length > 0) {
            return { ...nextBase, ...lineMap };
        }

        // 不强行注入固定键（如 content），仅保留可解析的结构化数据，
        // 这样状态字段完全由用户自定义。
        return nextBase;
    }

    _normalizeItem(rawItem = {}) {
        const id = String(rawItem.id || `mofo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
        const name = String(rawItem.name || rawItem.title || '未命名魔坊').trim() || '未命名魔坊';
        const tagName = this._normalizeTagName(rawItem.tagName || rawItem.tag || name, name);
        const cssText = String(rawItem.cssText || rawItem.css || '').trim();
        const htmlTemplate = String(rawItem['html模板'] ?? rawItem.htmlTemplate ?? rawItem.templateHtml ?? '').trim();
        const promptTemplate = String(rawItem.promptTemplate || rawItem.prompt || '').trim();
        const offlinePromptEnabled = this._parseBoolean(
            rawItem.offlinePromptEnabled ?? rawItem.enableOfflinePrompt ?? rawItem.promptEnabled,
            true
        );
        const updateMode = this._normalizeUpdateMode(
            rawItem.updateMode ?? rawItem.updateStrategy ?? rawItem.persistMode,
            'append'
        );
        const hasInitialStateRaw = Object.prototype.hasOwnProperty.call(rawItem, 'initialStateRaw');
        const initialStateSource = hasInitialStateRaw
            ? rawItem.initialStateRaw
            : (rawItem.initialState ?? rawItem.initial ?? rawItem.initialStateRaw ?? '');
        const initialState = this._parseStatePayload(initialStateSource, {});
        if (initialState && typeof initialState === 'object' && initialState.content === '[object Object]') {
            delete initialState.content;
        }
        const createdAt = Number(rawItem.createdAt || Date.now());
        const updatedAt = Number(rawItem.updatedAt || createdAt);

        return {
            id,
            name,
            tagName,
            cssText,
            htmlTemplate,
            'html模板': htmlTemplate,
            promptTemplate,
            offlinePromptEnabled,
            updateMode,
            initialState,
            createdAt,
            updatedAt
        };
    }

    _normalizeRuntimeRecord(rawRuntime = {}, initialState = {}, fallbackUpdatedAt = null) {
        const source = (rawRuntime && typeof rawRuntime === 'object' && !Array.isArray(rawRuntime))
            ? rawRuntime
            : {};
        const hasState = Object.prototype.hasOwnProperty.call(source, 'state');
        const stateSource = hasState ? source.state : '';
        const state = this._parseStatePayload(stateSource, initialState);
        if (state && typeof state === 'object' && state.content === '[object Object]') {
            delete state.content;
        }

        const updatedRaw = Number(source.updatedAt || 0);
        const fallbackRaw = Number(fallbackUpdatedAt || 0);
        const updatedAt = (Number.isFinite(updatedRaw) && updatedRaw > 0)
            ? updatedRaw
            : ((Number.isFinite(fallbackRaw) && fallbackRaw > 0) ? fallbackRaw : null);

        return {
            state,
            lastPayload: String(source.lastPayload || '').trim(),
            lastUpdatedBy: String(source.lastUpdatedBy || '').trim(),
            lastMessageIndex: Number.isInteger(source.lastMessageIndex) ? source.lastMessageIndex : null,
            updatedAt
        };
    }

    _getSessionCacheToken() {
        try {
            if (this.storage && typeof this.storage.getStorageKey === 'function') {
                return String(this.storage.getStorageKey('mofo_runtime_token') || '');
            }
        } catch (e) {}
        return '__default__';
    }

    _ensureSessionStateCache() {
        const token = this._getSessionCacheToken();
        if (this._sessionStateCache && this._sessionCacheToken === token) {
            return this._sessionStateCache;
        }

        let raw = this.storage.get(this.SESSION_STATE_KEY, {});
        if (typeof raw === 'string') {
            try {
                raw = JSON.parse(raw);
            } catch (e) {
                raw = {};
            }
        }

        const map = {};
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            Object.entries(raw).forEach(([key, value]) => {
                const id = String(key || '').trim();
                if (!id) return;
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    map[id] = this._clone(value);
                }
            });
        }

        // 全局删除条目后，所有会话在下次加载时都要清掉对应 runtime
        const deletedIdSet = new Set(this._getDeletedItemIds());
        let shouldPersistPrune = false;
        if (deletedIdSet.size > 0) {
            Object.keys(map).forEach((id) => {
                if (!deletedIdSet.has(id)) return;
                delete map[id];
                shouldPersistPrune = true;
            });
        }

        this._sessionStateCache = map;
        this._sessionCacheToken = token;

        if (shouldPersistPrune) {
            this.storage.set(this.SESSION_STATE_KEY, this._clone(map));
        }

        return this._sessionStateCache;
    }

    _commitSessionState() {
        const payload = this._clone(this._ensureSessionStateCache());
        this.storage.set(this.SESSION_STATE_KEY, payload);
    }

    _getDeletedItemIds() {
        let raw = this.storage.get(this.DELETED_IDS_KEY, []);
        if (typeof raw === 'string') {
            try {
                raw = JSON.parse(raw);
            } catch (e) {
                raw = [];
            }
        }
        if (!Array.isArray(raw)) return [];

        const seen = new Set();
        const normalized = [];
        raw.forEach((entry) => {
            const id = String(entry || '').trim();
            if (!id || seen.has(id)) return;
            seen.add(id);
            normalized.push(id);
        });
        return normalized.slice(-this.MAX_DELETED_IDS);
    }

    _setDeletedItemIds(ids = []) {
        const list = Array.isArray(ids) ? ids : [];
        const seen = new Set();
        const normalized = [];
        list.forEach((entry) => {
            const id = String(entry || '').trim();
            if (!id || seen.has(id)) return;
            seen.add(id);
            normalized.push(id);
        });
        this.storage.set(this.DELETED_IDS_KEY, normalized.slice(-this.MAX_DELETED_IDS));
    }

    _markDeletedItemId(itemId) {
        const id = String(itemId || '').trim();
        if (!id) return false;
        const list = this._getDeletedItemIds();
        if (list.includes(id)) return false;
        list.push(id);
        this._setDeletedItemIds(list);
        return true;
    }

    _unmarkDeletedItemId(itemId) {
        const id = String(itemId || '').trim();
        if (!id) return false;
        const list = this._getDeletedItemIds();
        if (!list.includes(id)) return false;
        this._setDeletedItemIds(list.filter(v => v !== id));
        return true;
    }

    _buildMergedItem(definition, runtimeSource = null) {
        const base = this._clone(definition || {});
        const runtime = this._normalizeRuntimeRecord(
            runtimeSource || {},
            base.initialState || {},
            base.updatedAt || base.createdAt || null
        );
        const fallbackUpdatedAt = Number(base.updatedAt || base.createdAt || Date.now());
        const mergedUpdatedAt = Number(runtime.updatedAt || 0) > 0 ? Number(runtime.updatedAt) : fallbackUpdatedAt;

        base.definitionUpdatedAt = fallbackUpdatedAt;
        base.state = this._clone(runtime.state || {});
        base.lastPayload = runtime.lastPayload;
        base.lastUpdatedBy = runtime.lastUpdatedBy;
        base.lastMessageIndex = runtime.lastMessageIndex;
        base.updatedAt = mergedUpdatedAt;
        return base;
    }

    _upsertSessionRuntime(itemId, patch = {}, initialState = {}, options = {}) {
        const id = String(itemId || '').trim();
        if (!id) return this._normalizeRuntimeRecord({}, initialState, null);

        const map = this._ensureSessionStateCache();
        const currentRaw = (map[id] && typeof map[id] === 'object' && !Array.isArray(map[id]))
            ? map[id]
            : {};
        const nextRaw = options.replace === true
            ? { ...patch }
            : { ...currentRaw, ...patch };

        if (!Object.prototype.hasOwnProperty.call(nextRaw, 'updatedAt') && options.touchUpdatedAt !== false) {
            nextRaw.updatedAt = Date.now();
        }

        const normalized = this._normalizeRuntimeRecord(nextRaw, initialState, null);
        map[id] = this._clone(normalized);

        if (options.commit !== false) {
            this._commitSessionState();
        }
        return normalized;
    }

    _removeSessionRuntime(itemId, options = {}) {
        const id = String(itemId || '').trim();
        if (!id) return false;
        const map = this._ensureSessionStateCache();
        if (!Object.prototype.hasOwnProperty.call(map, id)) return false;
        delete map[id];
        if (options.commit !== false) {
            this._commitSessionState();
        }
        return true;
    }

    _ensureCache() {
        if (Array.isArray(this._cache)) return this._cache;

        let raw = this.storage.get(this.STORAGE_KEY, []);
        if (typeof raw === 'string') {
            try {
                raw = JSON.parse(raw);
            } catch (e) {
                raw = [];
            }
        }
        const sourceList = Array.isArray(raw) ? raw : [];
        const list = sourceList.map(item => this._normalizeItem(item));

        // 旧版把 runtime 状态直接放在全局条目里，这里迁移到当前会话存储。
        const legacyRuntimePatch = {};
        sourceList.forEach((sourceItem, index) => {
            const isObj = sourceItem && typeof sourceItem === 'object' && !Array.isArray(sourceItem);
            if (!isObj) return;

            const hasLegacyRuntime =
                Object.prototype.hasOwnProperty.call(sourceItem, 'state') ||
                Object.prototype.hasOwnProperty.call(sourceItem, 'lastPayload') ||
                Object.prototype.hasOwnProperty.call(sourceItem, 'lastUpdatedBy') ||
                Object.prototype.hasOwnProperty.call(sourceItem, 'lastMessageIndex');
            if (!hasLegacyRuntime) return;

            const def = list[index];
            if (!def?.id) return;
            legacyRuntimePatch[def.id] = this._normalizeRuntimeRecord(
                sourceItem,
                def.initialState || {},
                sourceItem.updatedAt ?? def.updatedAt
            );
        });

        this._cache = list;

        const legacyIds = Object.keys(legacyRuntimePatch);
        if (legacyIds.length > 0) {
            const sessionMap = this._ensureSessionStateCache();
            let sessionChanged = false;

            legacyIds.forEach((id) => {
                if (Object.prototype.hasOwnProperty.call(sessionMap, id)) return;
                sessionMap[id] = this._clone(legacyRuntimePatch[id]);
                sessionChanged = true;
            });

            if (sessionChanged) {
                this._commitSessionState();
            }
            // 写回全局定义，去掉 runtime 字段，避免再次跨会话串数据
            this._commit();
        }

        return this._cache;
    }

    _commit() {
        const payload = this._clone(this._ensureCache());
        this.storage.set(this.STORAGE_KEY, payload);
    }

    getItems() {
        const definitions = this._ensureCache();
        const sessionMap = this._ensureSessionStateCache();
        const merged = definitions.map(def => this._buildMergedItem(def, sessionMap[def.id]));
        return this._clone(merged);
    }

    getOfflinePromptItems() {
        return this.getItems().filter(item =>
            item &&
            item.offlinePromptEnabled !== false &&
            String(item.promptTemplate || '').trim()
        );
    }

    getItemById(id) {
        const target = this._ensureCache().find(item => String(item.id) === String(id));
        if (!target) return null;
        const sessionMap = this._ensureSessionStateCache();
        return this._clone(this._buildMergedItem(target, sessionMap[target.id]));
    }

    _toExportDefinition(item = {}) {
        const normalized = this._normalizeItem(item);
        return {
            id: normalized.id,
            name: normalized.name,
            tagName: normalized.tagName,
            cssText: normalized.cssText,
            htmlTemplate: normalized.htmlTemplate,
            'html模板': normalized.htmlTemplate,
            promptTemplate: normalized.promptTemplate,
            offlinePromptEnabled: normalized.offlinePromptEnabled,
            updateMode: normalized.updateMode,
            initialState: this._clone(normalized.initialState || {}),
            createdAt: Number(normalized.createdAt || Date.now()),
            updatedAt: Number(normalized.updatedAt || normalized.createdAt || Date.now())
        };
    }

    buildExportPayload(itemIds = []) {
        const list = this._ensureCache();
        const selectedIds = new Set(
            (Array.isArray(itemIds) ? itemIds : [])
                .map(id => String(id || '').trim())
                .filter(Boolean)
        );
        const selected = selectedIds.size > 0
            ? list.filter(item => selectedIds.has(String(item?.id || '').trim()))
            : list.slice();
        const items = selected.map(item => this._toExportDefinition(item));
        return {
            type: 'virtual_phone_mofo_templates',
            version: 1,
            exportedAt: new Date().toISOString(),
            count: items.length,
            items: this._clone(items)
        };
    }

    parseImportPayloadText(rawText = '') {
        const text = String(rawText || '').trim();
        if (!text) {
            throw new Error('导入文件为空');
        }
        const parsed = this._parseJsonFromLooseText(text);
        if (parsed === null) {
            throw new Error('导入文件不是有效的 JSON');
        }
        return parsed;
    }

    _extractImportItems(payload = null) {
        if (Array.isArray(payload)) return payload;
        if (!payload || typeof payload !== 'object') return [];

        if (Array.isArray(payload.items)) {
            return payload.items;
        }

        const likelySingleTemplate =
            Object.prototype.hasOwnProperty.call(payload, 'name')
            || Object.prototype.hasOwnProperty.call(payload, 'title')
            || Object.prototype.hasOwnProperty.call(payload, 'tagName')
            || Object.prototype.hasOwnProperty.call(payload, 'tag')
            || Object.prototype.hasOwnProperty.call(payload, 'htmlTemplate')
            || Object.prototype.hasOwnProperty.call(payload, 'html模板')
            || Object.prototype.hasOwnProperty.call(payload, 'promptTemplate')
            || Object.prototype.hasOwnProperty.call(payload, 'prompt');

        return likelySingleTemplate ? [payload] : [];
    }

    _buildItemFingerprint(item = {}) {
        return this._stableStringify({
            name: String(item.name || '').trim(),
            tagName: String(item.tagName || '').trim(),
            cssText: String(item.cssText || '').trim(),
            htmlTemplate: String(item.htmlTemplate || item['html模板'] || '').trim(),
            promptTemplate: String(item.promptTemplate || '').trim(),
            offlinePromptEnabled: this._parseBoolean(item.offlinePromptEnabled, true),
            updateMode: this._normalizeUpdateMode(item.updateMode, 'append'),
            initialState: this._clone(item.initialState || {})
        });
    }

    _buildUniqueImportedId(existingIds = new Set(), preferredId = '', fallbackName = 'mofo') {
        const preferred = String(preferredId || '').trim();
        if (preferred && !existingIds.has(preferred)) return preferred;

        const safeName = String(fallbackName || '')
            .trim()
            .replace(/\s+/g, '_')
            .replace(/[^\w-]/g, '')
            .slice(0, 28);
        const base = safeName ? `mofo_${safeName}` : 'mofo_template';
        if (!existingIds.has(base)) return base;

        for (let i = 1; i <= 9999; i += 1) {
            const candidate = `${base}_${i}`;
            if (!existingIds.has(candidate)) return candidate;
        }

        let randomId = '';
        do {
            randomId = `mofo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        } while (existingIds.has(randomId));
        return randomId;
    }

    importItemsFromPayload(payload = null, options = {}) {
        const skipDuplicates = options.skipDuplicates !== false;
        const sourceItems = this._extractImportItems(payload);
        const summary = {
            totalCount: sourceItems.length,
            importedCount: 0,
            skippedCount: 0,
            renamedCount: 0
        };
        if (sourceItems.length === 0) return summary;

        const list = this._ensureCache();
        const existingIdSet = new Set(
            list
                .map(item => String(item?.id || '').trim())
                .filter(Boolean)
        );
        const existingFingerprintSet = new Set();
        if (skipDuplicates) {
            list.forEach(item => {
                existingFingerprintSet.add(this._buildItemFingerprint(item));
            });
        }

        sourceItems.forEach((rawItem) => {
            if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
                summary.skippedCount += 1;
                return;
            }

            const normalized = this._normalizeItem(rawItem);
            const fingerprint = this._buildItemFingerprint(normalized);
            if (skipDuplicates && existingFingerprintSet.has(fingerprint)) {
                summary.skippedCount += 1;
                return;
            }

            const preferredId = String(rawItem?.id || '').trim();
            const nextId = this._buildUniqueImportedId(existingIdSet, preferredId, normalized.name);
            if (preferredId && nextId !== preferredId) {
                summary.renamedCount += 1;
            }

            const nextItem = this._normalizeItem({
                ...normalized,
                id: nextId,
                createdAt: Number(normalized.createdAt || Date.now()),
                updatedAt: Number(normalized.updatedAt || normalized.createdAt || Date.now())
            });

            list.push(nextItem);
            existingIdSet.add(nextItem.id);
            if (skipDuplicates) {
                existingFingerprintSet.add(this._buildItemFingerprint(nextItem));
            }
            this._unmarkDeletedItemId(nextItem.id);
            summary.importedCount += 1;
        });

        if (summary.importedCount > 0) {
            this._commit();
        }
        return summary;
    }

    createItem(input = {}) {
        const now = Date.now();
        const name = String(input.name || '').trim();
        if (!name) {
            throw new Error('魔坊名称不能为空');
        }
        const item = this._normalizeItem({
            ...input,
            id: input.id || `mofo_${now}_${Math.random().toString(36).slice(2, 8)}`,
            createdAt: now,
            updatedAt: now
        });
        this._ensureCache().push(item);
        this._commit();

        const runtimePatch = {
            state: Object.prototype.hasOwnProperty.call(input, 'state') ? input.state : item.initialState,
            lastPayload: Object.prototype.hasOwnProperty.call(input, 'lastPayload') ? input.lastPayload : '',
            lastUpdatedBy: Object.prototype.hasOwnProperty.call(input, 'lastUpdatedBy') ? input.lastUpdatedBy : '',
            lastMessageIndex: Object.prototype.hasOwnProperty.call(input, 'lastMessageIndex') ? input.lastMessageIndex : null,
            updatedAt: now
        };
        this._upsertSessionRuntime(item.id, runtimePatch, item.initialState || {}, {
            replace: true,
            touchUpdatedAt: false
        });
        this._unmarkDeletedItemId(item.id);
        return this.getItemById(item.id);
    }

    updateItem(id, patch = {}) {
        const list = this._ensureCache();
        const idx = list.findIndex(item => String(item.id) === String(id));
        if (idx < 0) return null;

        const current = list[idx];
        const hasInitialStateRawPatch =
            Object.prototype.hasOwnProperty.call(patch, 'initialStateRaw')
            || Object.prototype.hasOwnProperty.call(patch, 'initialState')
            || Object.prototype.hasOwnProperty.call(patch, 'initial');
        const hasStatePatch = Object.prototype.hasOwnProperty.call(patch, 'state');
        const hasRuntimePatch =
            hasStatePatch
            || Object.prototype.hasOwnProperty.call(patch, 'lastPayload')
            || Object.prototype.hasOwnProperty.call(patch, 'lastUpdatedBy')
            || Object.prototype.hasOwnProperty.call(patch, 'lastMessageIndex')
            || Object.prototype.hasOwnProperty.call(patch, 'updatedAt');
        const hasDefinitionPatch =
            Object.prototype.hasOwnProperty.call(patch, 'name')
            || Object.prototype.hasOwnProperty.call(patch, 'title')
            || Object.prototype.hasOwnProperty.call(patch, 'tagName')
            || Object.prototype.hasOwnProperty.call(patch, 'tag')
            || Object.prototype.hasOwnProperty.call(patch, 'cssText')
            || Object.prototype.hasOwnProperty.call(patch, 'css')
            || Object.prototype.hasOwnProperty.call(patch, 'htmlTemplate')
            || Object.prototype.hasOwnProperty.call(patch, 'templateHtml')
            || Object.prototype.hasOwnProperty.call(patch, 'html模板')
            || Object.prototype.hasOwnProperty.call(patch, 'promptTemplate')
            || Object.prototype.hasOwnProperty.call(patch, 'prompt')
            || Object.prototype.hasOwnProperty.call(patch, 'offlinePromptEnabled')
            || Object.prototype.hasOwnProperty.call(patch, 'enableOfflinePrompt')
            || Object.prototype.hasOwnProperty.call(patch, 'promptEnabled')
            || Object.prototype.hasOwnProperty.call(patch, 'updateMode')
            || Object.prototype.hasOwnProperty.call(patch, 'updateStrategy')
            || Object.prototype.hasOwnProperty.call(patch, 'persistMode')
            || hasInitialStateRawPatch;

        let nextDefinition = current;
        if (hasDefinitionPatch) {
            nextDefinition = this._normalizeItem({
                ...current,
                ...patch,
                id: current.id,
                createdAt: current.createdAt,
                updatedAt: Date.now()
            });
            list[idx] = nextDefinition;
            this._commit();
        }

        if (hasRuntimePatch || (hasInitialStateRawPatch && !hasStatePatch)) {
            const runtimePatch = {};

            if (hasStatePatch) runtimePatch.state = patch.state;
            if (Object.prototype.hasOwnProperty.call(patch, 'lastPayload')) runtimePatch.lastPayload = patch.lastPayload;
            if (Object.prototype.hasOwnProperty.call(patch, 'lastUpdatedBy')) runtimePatch.lastUpdatedBy = patch.lastUpdatedBy;
            if (Object.prototype.hasOwnProperty.call(patch, 'lastMessageIndex')) runtimePatch.lastMessageIndex = patch.lastMessageIndex;

            runtimePatch.updatedAt = Object.prototype.hasOwnProperty.call(patch, 'updatedAt')
                ? patch.updatedAt
                : Date.now();

            // 当用户在编辑器里改了“初始值”但没有显式传 state 时，
            // 默认把当前会话状态重置为最新初始值，避免仍显示旧状态。
            if (hasInitialStateRawPatch && !hasStatePatch) {
                runtimePatch.state = '';
                runtimePatch.lastPayload = '';
                runtimePatch.lastUpdatedBy = '';
                runtimePatch.lastMessageIndex = null;
            }

            this._upsertSessionRuntime(
                current.id,
                runtimePatch,
                nextDefinition.initialState || {},
                { touchUpdatedAt: false }
            );
        }

        return this.getItemById(current.id);
    }

    removeItem(id) {
        const list = this._ensureCache();
        const idx = list.findIndex(item => String(item.id) === String(id));
        if (idx < 0) return false;
        list.splice(idx, 1);
        this._commit();
        this._removeSessionRuntime(id);
        this._markDeletedItemId(id);
        return true;
    }

    clearItemSessionData(id) {
        const list = this._ensureCache();
        const exists = list.some(item => String(item.id) === String(id));
        if (!exists) return false;

        // 仅清理当前会话 runtime，保留全局条目定义。
        this._removeSessionRuntime(id);
        return true;
    }

    moveItem(id, direction = 'up') {
        const list = this._ensureCache();
        const idx = list.findIndex(item => String(item.id) === String(id));
        if (idx < 0) return false;

        const step = String(direction || '').toLowerCase() === 'down' ? 1 : -1;
        const targetIdx = idx + step;
        if (targetIdx < 0 || targetIdx >= list.length) return false;

        const [moved] = list.splice(idx, 1);
        list.splice(targetIdx, 0, moved);
        this._commit();
        return true;
    }

    applyTagUpdatesFromText(rawText, meta = {}) {
        const sourceText = String(rawText || '');
        if (!sourceText) return [];

        const list = this._ensureCache();
        if (list.length === 0) return [];
        const sessionMap = this._ensureSessionStateCache();

        const updates = [];
        let changed = false;

        list.forEach(item => {
            const safeTag = this._normalizeTagName(item.tagName || item.name, item.name);
            if (!safeTag) return;

            const regex = new RegExp(
                `(?:<|&lt;)\\s*${this._escapeRegex(safeTag)}\\s*(?:>|&gt;)([\\s\\S]*?)(?:<|&lt;)\\s*\\/\\s*${this._escapeRegex(safeTag)}\\s*(?:>|&gt;)`,
                'gi'
            );

            let match = null;
            let matched = false;
            let latestPayload = '';
            const currentRuntime = this._normalizeRuntimeRecord(
                sessionMap[item.id] || {},
                item.initialState || {},
                item.updatedAt || item.createdAt || null
            );
            let nextState = this._clone(currentRuntime.state || {});

            while ((match = regex.exec(sourceText)) !== null) {
                matched = true;
                latestPayload = String(match[1] || '');
                const parsedPatch = this._parseStatePayload(latestPayload, {});
                const removeIdsRaw = parsedPatch.__removeIds || parsedPatch.removeIds || parsedPatch.deletedIds || [];
                const removeIds = Array.isArray(removeIdsRaw)
                    ? removeIdsRaw.map(v => String(v ?? '').trim()).filter(Boolean)
                    : [];
                const replaceAll = this._parseBoolean(
                    parsedPatch.__replace ?? parsedPatch.__replaceAll ?? parsedPatch.replaceAll,
                    false
                );
                const mode = this._normalizeUpdateMode(item.updateMode, 'append');

                delete parsedPatch.__replace;
                delete parsedPatch.__replaceAll;
                delete parsedPatch.replaceAll;
                delete parsedPatch.__removeIds;
                delete parsedPatch.removeIds;
                delete parsedPatch.deletedIds;

                if (replaceAll || mode === 'replace') {
                    nextState = this._clone(parsedPatch);
                    continue;
                }

                const appendKey = this._guessAppendArrayKey(parsedPatch, nextState, item);
                if (appendKey && Array.isArray(parsedPatch[appendKey])) {
                    const incomingList = this._isMailListKey(appendKey)
                        ? this._normalizeIncomingMailList(parsedPatch[appendKey])
                        : this._clone(parsedPatch[appendKey]);
                    let mergedList = this._appendUniqueObjects(nextState[appendKey], incomingList);
                    if (removeIds.length > 0) {
                        mergedList = mergedList.filter(entry => {
                            const pid = String(this._pickPrimaryId(entry) || '').trim();
                            return !pid || !removeIds.includes(pid);
                        });
                    }
                    nextState = {
                        ...nextState,
                        ...this._clone(parsedPatch),
                        [appendKey]: mergedList
                    };
                } else {
                    nextState = {
                        ...nextState,
                        ...this._clone(parsedPatch)
                    };
                }
            }

            if (!matched) return;

            const currentStateText = JSON.stringify(currentRuntime.state || {});
            const nextStateText = JSON.stringify(nextState || {});
            const nextRuntime = this._normalizeRuntimeRecord({
                state: nextState,
                lastPayload: this._normalizePayloadText(latestPayload),
                lastUpdatedBy: String(meta.source || 'assistant'),
                lastMessageIndex: Number.isInteger(meta.messageIndex) ? meta.messageIndex : null,
                updatedAt: Date.now()
            }, item.initialState || {}, Date.now());
            sessionMap[item.id] = this._clone(nextRuntime);

            changed = true;
            updates.push({
                id: item.id,
                name: item.name,
                tagName: safeTag,
                changed: currentStateText !== nextStateText,
                state: this._clone(nextRuntime.state)
            });
        });

        if (changed) {
            this._commitSessionState();
        }

        return updates;
    }

    clearCache() {
        this._cache = null;
        this._sessionStateCache = null;
        this._sessionCacheToken = '';
    }
}
