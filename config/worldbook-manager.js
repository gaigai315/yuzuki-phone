/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  世界书选择与注入辅助
 * ======================================================== */

const WORLD_INFO_GET_ENDPOINT = '/api/worldinfo/get';
let cachedCsrfToken = '';
let cachedCsrfTokenAt = 0;

function safeString(value) {
    return String(value ?? '').trim();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function uniqueStrings(values = []) {
    const seen = new Set();
    const result = [];
    values.forEach((value) => {
        const text = safeString(value);
        if (!text || seen.has(text)) return;
        seen.add(text);
        result.push(text);
    });
    return result;
}

function normalizeSearchText(value) {
    return safeString(value)
        .normalize('NFKC')
        .toLocaleLowerCase('zh-CN')
        .replace(/\s+/g, ' ');
}

function getWorldbookSearchText(source) {
    const entries = Array.isArray(source?.allEntries) ? source.allEntries : [];
    return normalizeSearchText([
        source?.name,
        source?.sourceLabel,
        ...entries.flatMap((entry) => [entry?.comment, entry?.content])
    ].join('\n'));
}

function parseBooleanSetting(value, fallback = false) {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return fallback;
}

function isTruthyFlag(value) {
    if (value === true || value === 1) return true;
    if (typeof value === 'string') {
        return ['true', '1', 'yes', 'on', 'enabled', 'checked'].includes(value.trim().toLowerCase());
    }
    return false;
}

function isFalsyFlag(value) {
    if (value === false || value === 0) return true;
    if (typeof value === 'string') {
        return ['false', '0', 'no', 'off', 'disabled', 'unchecked'].includes(value.trim().toLowerCase());
    }
    return false;
}

function isWorldEntryEnabled(entry) {
    if (typeof entry === 'string') return true;
    if (!entry || typeof entry !== 'object') return false;

    // SillyTavern world info entries use `disable: true` for the kill switch.
    // Keep aliases for imported/older schemas so closed entries never leak into phone prompts.
    if (isTruthyFlag(entry.disable) || isTruthyFlag(entry.disabled)) return false;
    if (Object.prototype.hasOwnProperty.call(entry, 'enabled') && isFalsyFlag(entry.enabled)) return false;
    if (Object.prototype.hasOwnProperty.call(entry, 'active') && isFalsyFlag(entry.active)) return false;
    return true;
}

function getRawEntries(entries) {
    if (Array.isArray(entries)) return entries;
    if (entries && typeof entries === 'object') return Object.values(entries);
    return [];
}

function hasWorldEntries(entries) {
    return getRawEntries(entries).length > 0;
}

function safeStorageSegment(value) {
    return safeString(value)
        .replace(/[^\w\u4e00-\u9fa5.-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
}

function normalizeEntries(entries, options = {}) {
    const includeDisabled = options.includeDisabled === true;
    return getRawEntries(entries)
        .map((rawEntry, index) => {
            const enabled = isWorldEntryEnabled(rawEntry);
            const entry = typeof rawEntry === 'string' ? { content: rawEntry } : (rawEntry || {});
            return {
                uid: safeString(entry.uid ?? entry.id ?? index) || String(index),
                comment: safeString(entry.comment || entry.name || entry.title || ''),
                content: safeString(entry.content || entry.text || entry.value || ''),
                enabled
            };
        })
        .filter((entry) => entry.content && (includeDisabled || entry.enabled));
}

function normalizeEntrySelectionMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
        .map(([sourceId, entryIds]) => [safeString(sourceId), uniqueStrings(Array.isArray(entryIds) ? entryIds : [])])
        .filter(([sourceId]) => sourceId));
}

function normalizeWorldInfoData(data) {
    if (!data) return null;
    if (Array.isArray(data)) return { entries: data };
    if (data.entries) return data;
    if (data.data?.entries) return data.data;
    if (data.worldInfo?.entries) return data.worldInfo;
    if (data.worldInfoData?.entries) return data.worldInfoData;
    if (data.world_info?.entries) return data.world_info;
    if (typeof data === 'object') return { entries: data };
    return null;
}

function createWorldBook(name, index = 0, extra = {}) {
    const cleanName = safeString(name);
    return {
        id: `world:${cleanName}`,
        name: cleanName,
        source: 'world',
        sourceLabel: '酒馆世界书',
        entries: [],
        legacyIds: [`fallback_${index}`],
        ...extra
    };
}

async function getCsrfToken(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedCsrfToken && now - cachedCsrfTokenAt < 60000) {
        return cachedCsrfToken;
    }

    try {
        const response = await fetch(`/csrf-token?_=${now}`, {
            credentials: 'include',
            cache: 'no-store'
        });
        if (!response.ok) return '';
        const data = await response.json().catch(() => null);
        cachedCsrfToken = safeString(data?.token);
        cachedCsrfTokenAt = now;
        return cachedCsrfToken;
    } catch (_error) {
        return '';
    }
}

async function getJsonHeaders(forceRefresh = false) {
    const headers = {};

    if (!forceRefresh) {
        try {
            if (typeof window.getRequestHeaders === 'function') {
                Object.assign(headers, window.getRequestHeaders() || {});
            }
        } catch (_error) {
            // Fall back to /csrf-token below.
        }
    }

    headers['Content-Type'] = headers['Content-Type'] || headers['content-type'] || 'application/json';
    if (!headers['X-CSRF-Token'] && !headers['x-csrf-token']) {
        const token = await getCsrfToken(forceRefresh);
        if (token) headers['X-CSRF-Token'] = token;
    }
    return headers;
}

function isCsrfError(status, text = '') {
    return [400, 401, 403].includes(Number(status))
        && /csrf|forbidden|invalid token/i.test(String(text || ''));
}

async function fetchJson(url, body = {}, options = {}) {
    const forceRefresh = options.forceRefresh === true;
    const headers = await getJsonHeaders(forceRefresh);

    const response = await fetch(url, {
        method: 'POST',
        headers,
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        if (!forceRefresh && isCsrfError(response.status, text)) {
            cachedCsrfToken = '';
            cachedCsrfTokenAt = 0;
            return fetchJson(url, body, { forceRefresh: true });
        }
        throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
    }
    return response.json();
}

async function fetchWorldInfoByName(name) {
    const payloads = [
        { name },
        { world: name },
        { file: name },
        { filename: name }
    ];

    for (const body of payloads) {
        try {
            const data = normalizeWorldInfoData(await fetchJson(WORLD_INFO_GET_ENDPOINT, body));
            if (hasWorldEntries(data?.entries)) {
                return { ...data, _phoneReadSource: `${WORLD_INFO_GET_ENDPOINT} ${Object.keys(body)[0]}` };
            }
        } catch (error) {
            console.debug('[WorldbookManager] 世界书接口参数尝试失败:', { name, body, error });
        }
    }

    return null;
}

export class WorldbookManager {
    constructor(storage = null) {
        this.storage = storage;
        this._cache = null;
        this._cacheAt = 0;
        this._worldInfoModulePromise = null;
        this._stContextModulePromise = null;
    }

    _getWorldNamesFromWindow() {
        if (Array.isArray(window.world_names)) return window.world_names;
        if (Array.isArray(window.worldNames)) return window.worldNames;
        return [];
    }

    async _getWorldNamesFromFrontendModule() {
        const worldModule = await this._loadWorldInfoModule();
        if (Array.isArray(worldModule?.world_names)) return worldModule.world_names;
        if (Array.isArray(worldModule?.worldInfo?.world_names)) return worldModule.worldInfo.world_names;
        return [];
    }

    _appendWorldBook(list, uniqueNames, name, index = 0, extra = {}) {
        const cleanName = safeString(name);
        if (!cleanName) return;
        if (uniqueNames.has(cleanName)) {
            const existing = list.find((book) => book.name === cleanName);
            if (existing && Array.isArray(extra.legacyIds)) {
                existing.legacyIds = uniqueStrings([...(existing.legacyIds || []), ...extra.legacyIds]);
            }
            return;
        }
        list.push(createWorldBook(cleanName, index, extra));
        uniqueNames.add(cleanName);
    }

    matchesSelection(source, selectedIds = []) {
        const selected = new Set((selectedIds || []).map(String));
        return selected.has(source?.id)
            || selected.has(source?.name)
            || (source?.legacyIds || []).some((id) => selected.has(id));
    }

    /**
     * 获取酒馆系统中存在的全部世界书列表，不判断是否激活。
     * 首选酒馆真实 world_names，DOM 下拉框只用于补充遗漏。
     */
    async fetchAllAvailableWorldBooks() {
        const allBooks = [];
        const uniqueNames = new Set();

        const worldNames = uniqueStrings([
            ...(await this._getWorldNamesFromFrontendModule()),
            ...this._getWorldNamesFromWindow()
        ]);
        worldNames.forEach((name, index) => {
            this._appendWorldBook(allBooks, uniqueNames, name, index);
        });

        try {
            const selectors = ['#world_info option', '#world_editor_select option'];
            const options = selectors.flatMap((selector) => {
                const found = Array.from(document.querySelectorAll(selector));
                if (found.length > 0) return found;
                return typeof window.$ === 'function' ? window.$(selector).toArray() : [];
            });

            options.forEach((option) => {
                const id = safeString(option?.getAttribute?.('value') ?? option?.value);
                const name = safeString(option?.textContent || option?.innerText || '');
                const isHidden = option?.style?.display === 'none' || option?.hidden === true;
                const isPlaceholder = !id || /^-+$/.test(id) || /pick to edit|选择以编辑/i.test(name);
                if (!name || isHidden || isPlaceholder) return;
                this._appendWorldBook(allBooks, uniqueNames, name, allBooks.length, {
                    legacyIds: [id, `fallback_${allBooks.length}`].filter(Boolean)
                });
            });
        } catch (error) {
            console.warn('[WorldbookManager] 从 DOM 提取全部世界书失败，尝试备用方案...', error);
        }

        return allBooks;
    }

    _getContext() {
        if (typeof window.SillyTavern?.getContext === 'function') {
            return window.SillyTavern.getContext();
        }
        if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
            return SillyTavern.getContext();
        }
        return null;
    }

    _isLobbyMode(context = null) {
        const ctx = context || this._getContext();
        const charName = safeString(ctx?.name2);
        if (/^SillyTavern System$/i.test(charName)) return true;

        const chatId = safeString(ctx?.chatMetadata?.file_name || ctx?.chatId);
        if (chatId) return false;
        if (charName) return false;
        return true;
    }

    _getCharacterScopeKey() {
        const context = this._getContext();
        if (this._isLobbyMode(context)) {
            return 'lobby';
        }
        const characterId = context?.characterId;
        const characterName = safeString(context?.characters?.[characterId]?.name || context?.name2 || '');
        const idText = characterId !== undefined && characterId !== null ? safeString(characterId) : '';
        const rawKey = idText
            ? `${idText}_${characterName || 'character'}`
            : characterName;
        return safeStorageSegment(rawKey || 'default_character');
    }

    async _getContextWithWorldInfo() {
        const candidates = [];
        const stContextModule = await this._loadStContextModule();
        const moduleContext = stContextModule?.getContext?.();
        if (moduleContext) candidates.push(moduleContext);

        const windowContext = this._getContext();
        if (windowContext) candidates.push(windowContext);

        return candidates.find((context) => typeof context?.getWorldInfo === 'function')
            || candidates.find(Boolean)
            || null;
    }

    async _loadStContextModule() {
        try {
            if (!this._stContextModulePromise) {
                this._stContextModulePromise = import('../../../../st-context.js');
            }
            return await this._stContextModulePromise;
        } catch (error) {
            console.warn('[WorldbookManager] 导入 st-context 失败:', error);
            return null;
        }
    }

    async _loadWorldInfoModule() {
        try {
            if (!this._worldInfoModulePromise) {
                this._worldInfoModulePromise = import('/scripts/world-info.js')
                    .catch(() => import('../../../../world-info.js'));
            }
            return await this._worldInfoModulePromise;
        } catch (error) {
            console.warn('[WorldbookManager] 导入 world-info 失败:', error);
            return null;
        }
    }

    _extractWorldInfoModuleData(worldModule) {
        const worldInfo = worldModule?.world_info || window.world_info;
        return normalizeWorldInfoData(
            worldModule?.worldInfoData
            || worldModule?.world_info_data
            || worldInfo?.worldInfoData
            || worldInfo?.world_info
            || worldInfo
        );
    }

    async _refreshWorldInfoCache(name) {
        const worldModule = await this._loadWorldInfoModule();
        if (typeof worldModule?.loadWorldInfo === 'function') {
            await worldModule.loadWorldInfo(name);
            return true;
        }
        const worldInfo = worldModule?.world_info || window.world_info;
        if (typeof worldInfo?.loadWorldInfoData === 'function') {
            await worldInfo.loadWorldInfoData(name);
            return true;
        }

        const context = await this._getContextWithWorldInfo();
        if (typeof context?.loadWorldInfo === 'function') {
            await context.loadWorldInfo(name);
            return true;
        }

        return false;
    }

    async _loadWorldInfoViaFrontendModule(name) {
        try {
            const worldModule = await this._loadWorldInfoModule();
            if (typeof worldModule?.loadWorldInfo === 'function') {
                const loaded = normalizeWorldInfoData(await worldModule.loadWorldInfo(name));
                if (hasWorldEntries(loaded?.entries)) {
                    return { ...loaded, _phoneReadSource: '/scripts/world-info.js loadWorldInfo' };
                }

                const cached = this._extractWorldInfoModuleData(worldModule);
                if (hasWorldEntries(cached?.entries)) {
                    return { ...cached, _phoneReadSource: '/scripts/world-info.js cache after loadWorldInfo' };
                }
            }

            const context = await this._getContextWithWorldInfo();
            if (typeof context?.getWorldInfo === 'function') {
                const direct = normalizeWorldInfoData(await context.getWorldInfo(name));
                if (hasWorldEntries(direct?.entries)) {
                    return { ...direct, _phoneReadSource: 'context.getWorldInfo' };
                }
            }

            await this._refreshWorldInfoCache(name);

            const refreshedContext = await this._getContextWithWorldInfo();
            if (typeof refreshedContext?.getWorldInfo === 'function') {
                const after = normalizeWorldInfoData(await refreshedContext.getWorldInfo(name));
                if (hasWorldEntries(after?.entries)) {
                    return { ...after, _phoneReadSource: 'context.getWorldInfo.afterRefresh' };
                }
            }

            const moduleData = this._extractWorldInfoModuleData(worldModule);
            return hasWorldEntries(moduleData?.entries)
                ? { ...moduleData, _phoneReadSource: 'world-info module cache' }
                : null;
        } catch (error) {
            console.warn('[WorldbookManager] 调用酒馆前端世界书读取失败，尝试接口兜底:', error);
            return null;
        }
    }

    async _loadWorldContent(book) {
        const name = safeString(book?.name);
        if (!name) return { ...book, entries: [] };

        try {
            let data = normalizeWorldInfoData(await this._loadWorldInfoViaFrontendModule(name));
            if (!data) {
                data = await fetchWorldInfoByName(name);
            }
            const allEntries = normalizeEntries(data?.entries, { includeDisabled: true });
            const entries = allEntries.filter((entry) => entry.enabled);
            const rawEntries = getRawEntries(data?.entries);
            const totalEntries = rawEntries.length;
            const disabledEntries = rawEntries.filter((entry) => !isWorldEntryEnabled(entry)).length;
            console.info('[WorldbookManager] 世界书读取结果:', {
                name,
                source: data?._phoneReadSource || 'unknown',
                entries: entries.length,
                totalEntries,
                disabledEntries,
                rawEntriesType: Array.isArray(data?.entries) ? 'array' : typeof data?.entries
            });
            return {
                ...book,
                entries,
                allEntries,
                totalEntries,
                disabledEntries
            };
        } catch (error) {
            console.warn(`[WorldbookManager] 读取世界书失败: ${name}`, error);
            return { ...book, entries: [], allEntries: [], totalEntries: 0, disabledEntries: 0 };
        }
    }

    async listAvailableWorldbooks(options = {}) {
        const force = options.force === true;
        const includeEntries = options.includeEntries === true;
        const now = Date.now();
        if (!force && this._cache && now - this._cacheAt < 5000 && (!includeEntries || this._cache.every(book => Array.isArray(book.allEntries)))) {
            return this._cache;
        }

        const books = await this.fetchAllAvailableWorldBooks();
        this._cache = includeEntries
            ? await Promise.all(books.map((book) => this._loadWorldContent(book)))
            : books;
        this._cacheAt = now;
        return this._cache;
    }

    getSelectionKey(appKey) {
        return `phone_worldbook_selection_${appKey}_char_${this._getCharacterScopeKey()}`;
    }

    getAppSelectionKey(appKey) {
        return `phone_worldbook_selection_${appKey}`;
    }

    getGlobalSelectionKey(appKey) {
        return `chat_worldbook_selection_${appKey}`;
    }

    getPreviousChatScopedSelectionKey(appKey) {
        return `chat_worldbook_selection_${appKey}_char_${this._getCharacterScopeKey()}`;
    }

    getLegacySelectionKey(appKey) {
        return `phone-worldbook-selection-${appKey}`;
    }

    getEnabledKey(appKey) {
        return `phone_worldbook_enabled_${appKey}_char_${this._getCharacterScopeKey()}`;
    }

    getAppEnabledKey(appKey) {
        return `phone_worldbook_enabled_${appKey}`;
    }

    getGlobalEnabledKey(appKey) {
        return `chat_worldbook_enabled_${appKey}`;
    }

    getPreviousChatScopedEnabledKey(appKey) {
        return `chat_worldbook_enabled_${appKey}_char_${this._getCharacterScopeKey()}`;
    }

    getLegacyEnabledKey(appKey) {
        if (appKey === 'honey') return 'phone-honey-use-worldbook';
        if (appKey === 'wechat') return 'wechat-use-worldbook';
        if (appKey === 'games') return 'games-use-worldbook';
        return '';
    }

    isSessionIsolatedApp(appKey) {
        return appKey === 'wangxiang' || appKey === 'wangxiang-marketplace';
    }

    getEnabled(appKey) {
        const fallback = appKey === 'honey' ? false : true;
        if (this.isSessionIsolatedApp(appKey)) {
            const sessionRaw = this.storage?.get?.(this.getGlobalEnabledKey(appKey), undefined);
            if (sessionRaw !== undefined && sessionRaw !== null) {
                return parseBooleanSetting(sessionRaw, fallback);
            }
            const previousSessionRaw = this.storage?.get?.(this.getPreviousChatScopedEnabledKey(appKey), undefined);
            return previousSessionRaw !== undefined && previousSessionRaw !== null
                ? parseBooleanSetting(previousSessionRaw, fallback)
                : fallback;
        }
        const scopedRaw = this.storage?.get?.(this.getEnabledKey(appKey), undefined);
        if (scopedRaw !== undefined && scopedRaw !== null) {
            return parseBooleanSetting(scopedRaw, fallback);
        }

        const previousScopedRaw = this.storage?.get?.(this.getPreviousChatScopedEnabledKey(appKey), undefined);
        if (previousScopedRaw !== undefined && previousScopedRaw !== null) {
            return parseBooleanSetting(previousScopedRaw, fallback);
        }

        const globalRaw = this.storage?.get?.(this.getGlobalEnabledKey(appKey), undefined);
        if (globalRaw !== undefined && globalRaw !== null) {
            return parseBooleanSetting(globalRaw, fallback);
        }

        const appRaw = this.storage?.get?.(this.getAppEnabledKey(appKey), undefined);
        if (appRaw !== undefined && appRaw !== null) {
            return parseBooleanSetting(appRaw, fallback);
        }

        const legacyKey = this.getLegacyEnabledKey(appKey);
        if (legacyKey) {
            const legacyRaw = this.storage?.get?.(legacyKey, undefined);
            return parseBooleanSetting(legacyRaw, fallback);
        }
        return fallback;
    }

    async setEnabled(appKey, enabled) {
        const keys = this.isSessionIsolatedApp(appKey)
            ? uniqueStrings([
                this.getGlobalEnabledKey(appKey),
                this.getPreviousChatScopedEnabledKey(appKey)
            ])
            : uniqueStrings([
                this.getEnabledKey(appKey),
                this.getPreviousChatScopedEnabledKey(appKey),
                this.getGlobalEnabledKey(appKey),
                this.getAppEnabledKey(appKey)
            ]);
        for (const key of keys) {
            await this.storage?.set?.(key, !!enabled);
        }
        return !!enabled;
    }

    getSelection(appKey) {
        return this.getSelectionState(appKey).ids;
    }

    getSelectionState(appKey) {
        if (this.isSessionIsolatedApp(appKey)) {
            let sessionRaw = this.storage?.get?.(this.getGlobalSelectionKey(appKey), undefined);
            if (sessionRaw === undefined || sessionRaw === null) {
                sessionRaw = this.storage?.get?.(this.getPreviousChatScopedSelectionKey(appKey), undefined);
            }
            return this._parseSelectionState(sessionRaw);
        }
        let raw = this.storage?.get?.(this.getSelectionKey(appKey), undefined);
        if (raw === undefined || raw === null) {
            raw = this.storage?.get?.(this.getPreviousChatScopedSelectionKey(appKey), undefined);
        }
        if (raw === undefined || raw === null) {
            raw = this.storage?.get?.(this.getGlobalSelectionKey(appKey), undefined);
        }
        if (raw === undefined || raw === null) {
            raw = this.storage?.get?.(this.getAppSelectionKey(appKey), undefined);
        }
        if (raw === undefined || raw === null) {
            raw = this.storage?.get?.(this.getLegacySelectionKey(appKey), null);
        }
        return this._parseSelectionState(raw);
    }

    _parseSelectionState(raw) {
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            return {
                initialized: raw.initialized === true,
                ids: Array.isArray(raw.ids) ? raw.ids.map(String) : [],
                entryIdsBySource: normalizeEntrySelectionMap(raw.entryIdsBySource || raw.entrySelections)
            };
        }
        if (Array.isArray(raw)) return { initialized: true, ids: raw.map(String), entryIdsBySource: {} };
        if (typeof raw === 'string') {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return {
                        initialized: parsed.initialized === true,
                        ids: Array.isArray(parsed.ids) ? parsed.ids.map(String) : [],
                        entryIdsBySource: normalizeEntrySelectionMap(parsed.entryIdsBySource || parsed.entrySelections)
                    };
                }
                return {
                    initialized: Array.isArray(parsed),
                    ids: Array.isArray(parsed) ? parsed.map(String) : [],
                    entryIdsBySource: {}
                };
            } catch {
                return { initialized: !!raw, ids: raw ? [raw] : [], entryIdsBySource: {} };
            }
        }
        return { initialized: false, ids: [], entryIdsBySource: {} };
    }

    _getSelectionStorageKeys(appKey) {
        return this.isSessionIsolatedApp(appKey)
            ? uniqueStrings([
                this.getGlobalSelectionKey(appKey),
                this.getPreviousChatScopedSelectionKey(appKey)
            ])
            : uniqueStrings([
                this.getSelectionKey(appKey),
                this.getPreviousChatScopedSelectionKey(appKey),
                this.getGlobalSelectionKey(appKey),
                this.getAppSelectionKey(appKey)
            ]);
    }

    async _writeSelectionState(appKey, selection) {
        const normalized = {
            initialized: true,
            ids: uniqueStrings(selection?.ids || []),
            entryIdsBySource: normalizeEntrySelectionMap(selection?.entryIdsBySource)
        };
        for (const key of this._getSelectionStorageKeys(appKey)) {
            await this.storage?.set?.(key, normalized);
        }
        return normalized;
    }

    _getSourceSelectionAliases(source) {
        return uniqueStrings([source?.id, source?.name, ...(source?.legacyIds || [])]);
    }

    _findExplicitEntrySelection(selection, source) {
        const map = selection?.entryIdsBySource || {};
        for (const key of this._getSourceSelectionAliases(source)) {
            if (Object.prototype.hasOwnProperty.call(map, key)) {
                return { initialized: true, ids: uniqueStrings(map[key]) };
            }
        }
        return { initialized: false, ids: [] };
    }

    _resolveSourceEntrySelection(selection, source) {
        const allEntries = normalizeEntries(source?.allEntries ?? source?.entries, { includeDisabled: true });
        const availableIds = new Set(allEntries.map((entry) => entry.uid));
        const explicit = this._findExplicitEntrySelection(selection, source);
        const configuredIds = (explicit.initialized ? explicit.ids : [])
            .filter((entryId) => availableIds.has(entryId));
        const configuredSet = new Set(configuredIds);
        const sourceSelected = selection?.initialized === true && this.matchesSelection(source, selection.ids);
        return {
            sourceSelected,
            explicit: explicit.initialized,
            configuredIds,
            selectedIds: sourceSelected ? configuredIds : [],
            selectedEntries: sourceSelected ? allEntries.filter((entry) => configuredSet.has(entry.uid)) : [],
            allEntries
        };
    }

    getSourceEntrySelectionState(appKey, source) {
        return this._resolveSourceEntrySelection(this.getSelectionState(appKey), source);
    }

    async setSelection(appKey, ids = []) {
        const previous = this.getSelectionState(appKey);
        const selection = await this._writeSelectionState(appKey, {
            ids,
            entryIdsBySource: previous.entryIdsBySource
        });
        return selection.ids;
    }

    async setSourceSelected(appKey, source, selected) {
        const previous = this.getSelectionState(appKey);
        const aliases = new Set(this._getSourceSelectionAliases(source));
        const ids = previous.ids.filter((id) => !aliases.has(String(id)));
        const sourceId = safeString(source?.id || source?.name);
        if (selected && sourceId) ids.push(sourceId);
        return this._writeSelectionState(appKey, {
            ids,
            entryIdsBySource: previous.entryIdsBySource
        });
    }

    async setSourceEntrySelection(appKey, source, entryIds = []) {
        const previous = this.getSelectionState(appKey);
        const aliases = this._getSourceSelectionAliases(source);
        const aliasSet = new Set(aliases);
        const sourceId = safeString(source?.id || source?.name);
        const selectedEntryIds = uniqueStrings(entryIds);
        const ids = previous.ids.filter((id) => !aliasSet.has(String(id)));
        if (sourceId && selectedEntryIds.length > 0) ids.push(sourceId);

        const entryIdsBySource = { ...previous.entryIdsBySource };
        aliases.forEach((alias) => { delete entryIdsBySource[alias]; });
        if (sourceId) entryIdsBySource[sourceId] = selectedEntryIds;

        return this._writeSelectionState(appKey, { ids, entryIdsBySource });
    }

    async setEntrySelection(appKey, sourceId, entryIds = []) {
        const source = { id: safeString(sourceId), name: safeString(sourceId) };
        const selection = await this.setSourceEntrySelection(appKey, source, entryIds);
        return selection.ids;
    }

    async renderWorldbookSelector(container, appKey, options = {}) {
        if (!container) return;
        if (!this.getEnabled(appKey)) {
            container.innerHTML = '<div class="phone-worldbook-status">世界书注入已关闭。</div>';
            return;
        }

        try {
            const sources = await this.listAvailableWorldbooks({
                includeEntries: true,
                force: options.force !== false
            });
            if (sources.length === 0) {
                container.innerHTML = '<div class="phone-worldbook-status">未读取到酒馆世界书列表。</div>';
                return;
            }

            const displaySources = [...sources].sort((a, b) => {
                const aSelected = this.getSourceEntrySelectionState(appKey, a).sourceSelected ? 1 : 0;
                const bSelected = this.getSourceEntrySelectionState(appKey, b).sourceSelected ? 1 : 0;
                return (bSelected - aSelected) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
            });
            const savedQuery = safeString(container.dataset.phoneWorldbookSearchQuery);
            const sourceRows = displaySources.map((source) => {
                const entryState = this.getSourceEntrySelectionState(appKey, source);
                const totalCount = entryState.allEntries.length;
                const selectedCount = entryState.selectedIds.length;
                const checked = entryState.sourceSelected && selectedCount > 0;
                const unavailable = totalCount === 0;
                const sourceId = escapeHtml(source.id);
                const status = unavailable ? '读取失败或没有条目' : `${selectedCount}/${totalCount} 条已选`;
                return `
                    <div class="phone-worldbook-source-row${checked ? ' is-selected' : ''}" data-source-id="${sourceId}">
                        <input class="phone-worldbook-source-toggle" type="checkbox" value="${sourceId}" ${checked ? 'checked' : ''} ${unavailable ? 'disabled' : ''} aria-label="选择 ${escapeHtml(source.name)}">
                        <div class="phone-worldbook-source-copy">
                            <div class="phone-worldbook-source-name">${escapeHtml(source.name)}</div>
                            <div class="phone-worldbook-source-meta">${escapeHtml(source.sourceLabel || '世界书')} · ${escapeHtml(status)}</div>
                        </div>
                        <button class="phone-worldbook-entry-trigger" type="button" data-source-id="${sourceId}" title="选择条目" aria-label="选择 ${escapeHtml(source.name)} 的条目" ${unavailable ? 'disabled' : ''}>
                            <i class="fa-solid fa-list-check" aria-hidden="true"></i>
                        </button>
                    </div>
                `;
            }).join('');
            container.innerHTML = `
                <div class="phone-worldbook-search" role="search">
                    <i class="fa-solid fa-magnifying-glass phone-worldbook-search-icon" aria-hidden="true"></i>
                    <input class="phone-worldbook-search-input" type="search" value="${escapeHtml(savedQuery)}" placeholder="搜索世界书名称或内容" aria-label="搜索世界书名称或内容" autocomplete="off" spellcheck="false">
                    <button class="phone-worldbook-search-clear" type="button" title="清除搜索" aria-label="清除搜索" ${savedQuery ? '' : 'hidden'}>
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="phone-worldbook-search-result" aria-live="polite" ${savedQuery ? '' : 'hidden'}></div>
                <div class="phone-worldbook-source-list">${sourceRows}</div>
            `;

            const sourceById = new Map(displaySources.map((source) => [String(source.id), source]));
            const searchTextBySourceId = new Map(displaySources.map((source) => [
                String(source.id),
                getWorldbookSearchText(source)
            ]));
            const searchInput = container.querySelector('.phone-worldbook-search-input');
            const searchClear = container.querySelector('.phone-worldbook-search-clear');
            const searchResult = container.querySelector('.phone-worldbook-search-result');
            const sourceRowsElements = Array.from(container.querySelectorAll('.phone-worldbook-source-row'));
            const applySearch = () => {
                const query = safeString(searchInput?.value);
                const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
                let visibleCount = 0;

                sourceRowsElements.forEach((row) => {
                    const searchText = searchTextBySourceId.get(String(row.dataset.sourceId || '')) || '';
                    const matches = tokens.every((token) => searchText.includes(token));
                    row.hidden = !matches;
                    if (matches) visibleCount += 1;
                });

                container.dataset.phoneWorldbookSearchQuery = query;
                if (searchClear) searchClear.hidden = !query;
                if (searchResult) {
                    searchResult.hidden = !query;
                    searchResult.textContent = visibleCount > 0
                        ? `找到 ${visibleCount} 本世界书`
                        : '没有找到匹配的世界书';
                }
            };
            searchInput?.addEventListener('input', applySearch);
            searchInput?.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape' || !searchInput.value) return;
                event.stopPropagation();
                searchInput.value = '';
                applySearch();
            });
            searchClear?.addEventListener('click', () => {
                if (!searchInput) return;
                searchInput.value = '';
                applySearch();
                searchInput.focus();
            });
            applySearch();

            container.querySelectorAll('.phone-worldbook-source-toggle').forEach((input) => {
                input.addEventListener('change', async () => {
                    const source = sourceById.get(String(input.value));
                    if (!source) return;
                    if (input.checked) {
                        await this.openEntrySelectionDialog(appKey, source);
                    } else {
                        await this.setSourceSelected(appKey, source, false);
                    }
                    await this.renderWorldbookSelector(container, appKey, options);
                });
            });
            container.querySelectorAll('.phone-worldbook-entry-trigger').forEach((button) => {
                button.addEventListener('click', async () => {
                    const source = sourceById.get(String(button.dataset.sourceId || ''));
                    if (!source) return;
                    await this.openEntrySelectionDialog(appKey, source);
                    await this.renderWorldbookSelector(container, appKey, options);
                });
            });
        } catch (error) {
            console.warn(`[WorldbookManager] ${appKey} 世界书列表渲染失败:`, error);
            container.innerHTML = '<div class="phone-worldbook-status is-error">世界书读取失败，请稍后重试。</div>';
        }
    }

    async openEntrySelectionDialog(appKey, source) {
        const existing = document.querySelector('.phone-worldbook-entry-modal');
        if (typeof existing?._phoneWorldbookClose === 'function') {
            existing._phoneWorldbookClose({ saved: false, entryIds: [] });
        } else {
            existing?.remove?.();
        }

        const loadedSource = Array.isArray(source?.allEntries)
            ? source
            : await this._loadWorldContent(source);
        const entryState = this.getSourceEntrySelectionState(appKey, loadedSource);
        const entries = entryState.allEntries;
        const configuredIds = new Set(entryState.configuredIds);
        const modal = document.createElement('div');
        modal.className = 'phone-worldbook-entry-modal';
        modal.innerHTML = `
            <button class="phone-worldbook-entry-backdrop" type="button" data-action="cancel" aria-label="关闭条目选择"></button>
            <section class="phone-worldbook-entry-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(loadedSource.name)} 条目选择">
                <header class="phone-worldbook-entry-head">
                    <div class="phone-worldbook-entry-heading">
                        <h3>${escapeHtml(loadedSource.name)}</h3>
                        <span class="phone-worldbook-entry-count"></span>
                    </div>
                    <button class="phone-worldbook-entry-close" type="button" data-action="cancel" title="关闭" aria-label="关闭">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </header>
                <label class="phone-worldbook-entry-select-all">
                    <input type="checkbox" class="phone-worldbook-entry-select-all-input">
                    <span>全选</span>
                </label>
                <div class="phone-worldbook-entry-list">
                    ${entries.length > 0 ? entries.map((entry, index) => {
                        const title = entry.comment || `条目 ${index + 1}`;
                        const preview = entry.content.replace(/\s+/g, ' ').slice(0, 180);
                        return `
                            <label class="phone-worldbook-entry-row">
                                <input class="phone-worldbook-entry-choice" type="checkbox" value="${escapeHtml(entry.uid)}" ${configuredIds.has(entry.uid) ? 'checked' : ''}>
                                <span class="phone-worldbook-entry-copy">
                                    <span class="phone-worldbook-entry-title">${escapeHtml(title)}</span>
                                    <span class="phone-worldbook-entry-origin ${entry.enabled ? 'is-enabled' : 'is-disabled'}">${entry.enabled ? '酒馆开启' : '酒馆关闭'}</span>
                                    <span class="phone-worldbook-entry-preview">${escapeHtml(preview)}</span>
                                </span>
                            </label>
                        `;
                    }).join('') : '<div class="phone-worldbook-status">这个世界书没有可读取的条目。</div>'}
                </div>
                <footer class="phone-worldbook-entry-actions">
                    <button type="button" class="phone-worldbook-entry-cancel" data-action="cancel">取消</button>
                    <button type="button" class="phone-worldbook-entry-confirm" data-action="confirm" ${entries.length === 0 ? 'disabled' : ''}>确定</button>
                </footer>
            </section>
        `;

        const host = document.querySelector('#phone-panel-content .phone-screen');
        if (!host) {
            throw new Error('未找到小手机屏幕容器，无法打开世界书条目选择');
        }
        host.appendChild(modal);

        return new Promise((resolve) => {
            let settled = false;
            const choices = Array.from(modal.querySelectorAll('.phone-worldbook-entry-choice'));
            const selectAll = modal.querySelector('.phone-worldbook-entry-select-all-input');
            const count = modal.querySelector('.phone-worldbook-entry-count');
            const updateSelectionMeta = () => {
                const selectedCount = choices.filter((input) => input.checked).length;
                if (count) count.textContent = `${selectedCount}/${choices.length} 条已选`;
                if (selectAll) {
                    selectAll.checked = choices.length > 0 && selectedCount === choices.length;
                    selectAll.indeterminate = selectedCount > 0 && selectedCount < choices.length;
                    selectAll.disabled = choices.length === 0;
                }
            };
            const close = (result) => {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', onKeyDown);
                modal.remove();
                resolve(result);
            };
            const onKeyDown = (event) => {
                if (event.key === 'Escape') close({ saved: false, entryIds: [] });
            };
            modal._phoneWorldbookClose = close;
            choices.forEach((input) => input.addEventListener('change', updateSelectionMeta));
            selectAll?.addEventListener('change', () => {
                choices.forEach((input) => { input.checked = selectAll.checked; });
                updateSelectionMeta();
            });
            modal.querySelectorAll('[data-action="cancel"]').forEach((button) => {
                button.addEventListener('click', () => close({ saved: false, entryIds: [] }));
            });
            modal.querySelector('[data-action="confirm"]')?.addEventListener('click', async () => {
                const entryIds = choices.filter((input) => input.checked).map((input) => input.value);
                await this.setSourceEntrySelection(appKey, loadedSource, entryIds);
                close({ saved: true, entryIds });
            });
            document.addEventListener('keydown', onKeyDown);
            updateSelectionMeta();
            modal.querySelector('.phone-worldbook-entry-close')?.focus?.();
        });
    }

    async _loadSelectedWorldbookSources(appKey, options = {}) {
        if (!this.getEnabled(appKey)) return [];

        const sources = await this.listAvailableWorldbooks(options);
        if (sources.length === 0) return [];

        const selection = this.getSelectionState(appKey);
        const selectedSources = selection.initialized
            ? sources.filter((source) => this.matchesSelection(source, selection.ids))
            : [];
        if (selectedSources.length === 0) return [];

        return Promise.all(selectedSources.map((source) => this._loadWorldContent(source)));
    }

    async buildWorldbookMessages(appKey, options = {}) {
        const loadedSources = await this._loadSelectedWorldbookSources(appKey, options);
        const selection = this.getSelectionState(appKey);
        return loadedSources.flatMap((source) => this._resolveSourceEntrySelection(selection, source)
            .selectedEntries
            .map((entry) => ({
                role: 'system',
                content: entry.content,
                name: 'SYSTEM (世界书)',
                isPhoneMessage: true
            })));
    }

    async appendWorldbookMessages(messages, appKey, options = {}) {
        if (!Array.isArray(messages)) {
            throw new TypeError('世界书注入目标必须是消息数组');
        }
        const worldbookMessages = await this.buildWorldbookMessages(appKey, options);
        if (worldbookMessages.length > 0) messages.push(...worldbookMessages);
        return worldbookMessages;
    }

    async buildWorldbookMessage(appKey, options = {}) {
        const loadedSources = await this._loadSelectedWorldbookSources(appKey, options);
        const selection = this.getSelectionState(appKey);

        const parts = loadedSources
            .flatMap((source) => this._resolveSourceEntrySelection(selection, source)
                .selectedEntries
                .map((entry) => entry.content))
            .filter(Boolean);
        if (parts.length === 0) return null;

        return {
            role: 'system',
            content: parts.join('\n\n'),
            name: 'SYSTEM (世界书)',
            isPhoneMessage: true
        };
    }
}
