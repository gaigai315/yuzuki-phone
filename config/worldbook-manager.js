/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  世界书选择与注入辅助
 * ======================================================== */

const WORLD_INFO_GET_ENDPOINT = '/api/worldinfo/get';
let cachedCsrfToken = '';
let cachedCsrfTokenAt = 0;

function safeString(value) {
    return String(value || '').trim();
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

function normalizeEntries(entries) {
    return getRawEntries(entries)
        .filter(isWorldEntryEnabled)
        .map((entry) => (typeof entry === 'string' ? { content: entry } : (entry || {})))
        .map((entry, index) => ({
            uid: safeString(entry.uid ?? entry.id ?? index),
            comment: safeString(entry.comment || entry.name || entry.title || ''),
            content: safeString(entry.content || entry.text || entry.value || '')
        }))
        .filter((entry) => entry.content);
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
            const entries = normalizeEntries(data?.entries);
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
                totalEntries,
                disabledEntries
            };
        } catch (error) {
            console.warn(`[WorldbookManager] 读取世界书失败: ${name}`, error);
            return { ...book, entries: [] };
        }
    }

    async listAvailableWorldbooks(options = {}) {
        const force = options.force === true;
        const includeEntries = options.includeEntries === true;
        const now = Date.now();
        if (!force && this._cache && now - this._cacheAt < 5000 && (!includeEntries || this._cache.every(book => Array.isArray(book.entries) && book.entries.length > 0))) {
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

    getEnabled(appKey) {
        const fallback = appKey === 'honey' ? false : true;
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
        const keys = uniqueStrings([
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
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            return {
                initialized: raw.initialized === true,
                ids: Array.isArray(raw.ids) ? raw.ids.map(String) : []
            };
        }
        if (Array.isArray(raw)) return { initialized: true, ids: raw.map(String) };
        if (typeof raw === 'string') {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return {
                        initialized: parsed.initialized === true,
                        ids: Array.isArray(parsed.ids) ? parsed.ids.map(String) : []
                    };
                }
                return {
                    initialized: Array.isArray(parsed),
                    ids: Array.isArray(parsed) ? parsed.map(String) : []
                };
            } catch {
                return { initialized: !!raw, ids: raw ? [raw] : [] };
            }
        }
        return { initialized: false, ids: [] };
    }

    async setSelection(appKey, ids = []) {
        const unique = uniqueStrings(ids);
        const selection = {
            initialized: true,
            ids: unique
        };
        const keys = uniqueStrings([
            this.getSelectionKey(appKey),
            this.getPreviousChatScopedSelectionKey(appKey),
            this.getGlobalSelectionKey(appKey),
            this.getAppSelectionKey(appKey)
        ]);
        for (const key of keys) {
            await this.storage?.set?.(key, selection);
        }
        return unique;
    }

    async buildWorldbookMessage(appKey, options = {}) {
        if (!this.getEnabled(appKey)) return null;

        const sources = await this.listAvailableWorldbooks(options);
        if (sources.length === 0) return null;

        const selection = this.getSelectionState(appKey);
        const selectedSources = selection.initialized
            ? sources.filter((source) => this.matchesSelection(source, selection.ids))
            : [];
        if (selectedSources.length === 0) return null;

        const loadedSources = await Promise.all(selectedSources.map((source) => this._loadWorldContent(source)));
        const blocks = loadedSources
            .map((source) => {
                const parts = normalizeEntries(source.entries)
                    .map((entry) => entry.content)
                    .filter(Boolean);
                if (parts.length === 0) return '';
                return `【${source.name}】\n${parts.join('\n---\n')}`;
            })
            .filter(Boolean);
        if (blocks.length === 0) return null;

        return {
            role: 'system',
            content: `【世界书/角色书信息】\n${blocks.join('\n\n')}`,
            name: 'SYSTEM (世界书)',
            isPhoneMessage: true
        };
    }
}
