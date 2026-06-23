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
// 设置APP
import { ImageUploadManager } from './image-upload.js';
import { ImageCropper } from './image-cropper.js';
import {
    hasGaigaiTagFilter,
    readPhoneTagFilterConfig,
    savePhoneTagFilterConfig,
    PHONE_TAG_FILTER_AI_DIAGNOSTIC_PROMPT,
    parsePhoneTagFilterDiagnosticJson
} from '../../config/tag-filter.js';
import {
    PHONE_CONTEXT_LIMIT_KEY,
    PHONE_CONTEXT_LIMIT_INITIAL_VALUE,
    ensurePhoneContextLimitSetting,
    normalizePhoneContextLimit
} from '../../config/context-settings.js';

const DEFAULT_DOUBAO_CLONE_WORKER_URL = '';
const DEFAULT_MIMO_TTS_RELAY_URL = '';
const SETTINGS_FOLD_ARROW_HTML = '<span class="settings-fold-arrow" aria-hidden="true"><i class="fa-solid fa-chevron-right"></i></span>';
const PHONE_SHELL_SCALE_MIN = 80;
const PHONE_SHELL_SCALE_MAX = 120;
const PHONE_SHELL_SCALE_DEFAULT = 100;
const LOBBY_LINK_CHARACTER_IDS_KEY = 'phone-lobby-link-character-ids';
const LOBBY_LINK_GROUP_IDS_KEY = 'phone-lobby-link-group-ids';
const CARD_LAYOUT_CUSTOM_CSS_KEY = 'phone-card-layout-custom-css';
const SETTINGS_IMAGE_MAX_FILE_SIZE = 20 * 1024 * 1024;

const WECHAT_OFFLINE_INJECTION_TOGGLE_KEYS = [
    'offline-wechat-prompt-enabled',
    'offline-single-chat-enabled',
    'offline-group-chat-enabled'
];
const WECHAT_ONLINE_PROACTIVE_ENABLED_KEY = 'wechat_online_proactive_enabled';
const WECHAT_ONLINE_PROACTIVE_INTERVAL_KEY = 'wechat_online_proactive_interval_minutes';
const LOBBY_WECHAT_ONLINE_PROACTIVE_ENABLED_KEY = 'phone_lobby_wechat_online_proactive_enabled';
const LOBBY_WECHAT_ONLINE_PROACTIVE_INTERVAL_KEY = 'phone_lobby_wechat_online_proactive_interval_minutes';
const WECHAT_MESSAGE_SOUND_ENABLED_KEY = 'wechat_message_sound_enabled';

function normalizePhoneShellScalePercent(value) {
    const raw = Number.parseFloat(value);
    if (!Number.isFinite(raw)) return PHONE_SHELL_SCALE_DEFAULT;
    return Math.max(PHONE_SHELL_SCALE_MIN, Math.min(PHONE_SHELL_SCALE_MAX, Math.round(raw)));
}

function readNonNegativeStorageNumber(storage, key, defaultValue = 0, maxValue = 9999) {
    const raw = storage?.get?.(key);
    if (raw === undefined || raw === null || raw === '') return defaultValue;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return defaultValue;
    return Math.max(0, Math.min(maxValue, parsed));
}

function applyPhoneShellScale(value) {
    if (typeof window.VirtualPhone?.applyPhoneShellScale === 'function') {
        return window.VirtualPhone.applyPhoneShellScale(value);
    }
    const percent = normalizePhoneShellScalePercent(value);
    const widthScale = percent / 100;
    const heightScale = widthScale * 0.95;
    document.documentElement.style.setProperty('--phone-shell-width-scale', widthScale.toFixed(4));
    document.documentElement.style.setProperty('--phone-shell-height-scale', heightScale.toFixed(4));
    return percent;
}

export class SettingsApp {
    constructor(phoneShell, storage, settings) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.settings = settings;
        this.imageManager = new ImageUploadManager(storage);
        this.currentTab = 'general'; // 可选值: 'general', 'memory', 'llm', 'tts', 'image', 'lobby'
        void ensurePhoneContextLimitSetting(this.storage);

        // 🔥 监听滑动返回事件 (防止实例重建导致重复绑定)
        if (!window._settingsSwipeBackBound) {
            window._settingsSwipeBackBound = true;
            window.addEventListener('phone:swipeBack', () => {
                if (window.VirtualPhone && window.VirtualPhone.settingsApp) {
                    window.VirtualPhone.settingsApp.handleSwipeBack();
                }
            });
        }
    }

    _safeGetContext() {
        try {
            return (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function')
                ? SillyTavern.getContext()
                : null;
        } catch (e) {
            return null;
        }
    }

    _getDefaultAppsForCustomization() {
        return [
            { id: 'wechat', name: '微信', icon: '💬', color: '#07c160' },
            { id: 'weibo', name: '微博', icon: '👁️‍🗨️', color: '#ff8200' },
            { id: 'honey', name: '蜜语', icon: '💕', color: '#ff6b9d' },
            { id: 'games', name: '游戏', icon: '🎮', color: '#722ed1' },
            { id: 'mofo', name: '魔坊', icon: '🪄', color: '#1677ff' },
            { id: 'phone', name: '通话', icon: '📞', color: '#52c41a' },
            { id: 'diary', name: '日记', icon: '📔', color: '#faad14' },
            { id: 'calendar', name: '日历', icon: '📅', color: '#5d83a8' },
            { id: 'music', name: '音乐', icon: '🎵', color: '#eb2f96' },
            { id: 'album', name: '相册', icon: '🖼️', color: '#4096ff' },
            { id: 'settings', name: '设置', icon: '⚙️', color: '#8c8c8c' }
        ];
    }

    _getCustomAppNames() {
        try {
            const raw = this.storage.get('phone-app-custom-names');
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    _getCardLayoutCssTemplate() {
        return [
            '/* 只会作用于卡片式首页，可按需隐藏原卡片、加贴纸或换背景 */',
            '#phone-panel-content .phone-screen .home-layout-cards .home-time-card {',
            '    background-image: url("你的时间卡贴图地址");',
            '    background-size: cover;',
            '    background-position: center;',
            '}',
            '',
            '#phone-panel-content .phone-screen .home-layout-cards .home-app-cluster {',
            '    background-image: url("你的常用应用卡片贴图地址");',
            '    background-size: 100% 100%;',
            '}',
            '',
            '#phone-panel-content .phone-screen .home-layout-cards .home-social-card {',
            '    background-image: url("你的社交平台卡片贴图地址");',
            '    background-size: 100% 100%;',
            '}',
            '',
            '/* 隐藏某块：取消下一行注释即可 */',
            '/* #phone-panel-content .phone-screen .home-layout-cards .home-music-card { display: none !important; } */'
        ].join('\n');
    }

    _getAppDisplayName(app, customNames = null) {
        const names = customNames || this._getCustomAppNames();
        const customName = String(names?.[app?.id] || '').trim();
        return customName || String(app?.name || '');
    }

    _getActiveSettingsRoot() {
        return globalThis.document?.querySelector?.('.phone-view-current .settings-app')
            || globalThis.document?.querySelector?.('.settings-app')
            || null;
    }

    _escapeCssIdentifier(value) {
        const raw = String(value || '');
        if (globalThis.CSS?.escape) return globalThis.CSS.escape(raw);
        return raw.replace(/["\\#.;:[\]()>+~,*='`\s]/g, '\\$&');
    }

    _createSettingsScopedDocument(root = this._getActiveSettingsRoot()) {
        const globalDocument = globalThis.document;
        if (!root || !globalDocument) return globalDocument;
        const normalizeSelector = (selector) => String(selector || '').replace(/^\.settings-app\s+/, '');
        const queryInRoot = (selector) => root.querySelector(normalizeSelector(selector));
        const queryAllInRoot = (selector) => root.querySelectorAll(normalizeSelector(selector));

        return {
            get body() {
                return globalDocument.body;
            },
            createElement: (...args) => globalDocument.createElement(...args),
            getElementById: (id) => {
                const escapedId = this._escapeCssIdentifier(id);
                return root.querySelector(`#${escapedId}`) || globalDocument.getElementById(id);
            },
            querySelector: (selector) => queryInRoot(selector) || globalDocument.querySelector(selector),
            querySelectorAll: (selector) => {
                const scoped = queryAllInRoot(selector);
                return scoped.length ? scoped : globalDocument.querySelectorAll(selector);
            }
        };
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

    _getWechatInteropModeStorageKey(context = null) {
        return this._isLobbyMode(context) ? 'phone_lobby_wechat_online_mode' : 'wechat_online_mode';
    }

    _getWechatOnlineOnlyModeStorageKey(context = null) {
        return this._isLobbyMode(context) ? 'phone_lobby_wechat_online_only_mode' : 'wechat_online_only_mode';
    }

    _getWechatOnlineProactiveEnabledStorageKey(context = null) {
        return this._isLobbyMode(context) ? LOBBY_WECHAT_ONLINE_PROACTIVE_ENABLED_KEY : WECHAT_ONLINE_PROACTIVE_ENABLED_KEY;
    }

    _getWechatOnlineProactiveIntervalStorageKey(context = null) {
        return this._isLobbyMode(context) ? LOBBY_WECHAT_ONLINE_PROACTIVE_INTERVAL_KEY : WECHAT_ONLINE_PROACTIVE_INTERVAL_KEY;
    }

    _isStorageTruthy(key) {
        const raw = this.storage?.get?.(key);
        return raw === true || raw === 'true' || raw === 1;
    }

    async _disableWechatOfflineInjectionToggles() {
        for (const key of WECHAT_OFFLINE_INJECTION_TOGGLE_KEYS) {
            await this.storage.set(key, false);
        }
    }

    _isWechatOnlineOnlyModeEnabled(context = null) {
        return this._isStorageTruthy(this._getWechatOnlineOnlyModeStorageKey(context || this.storage.getContext?.()));
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
            const personality = String(char.personality || '').trim();
            const description = String(char.description || '').trim();
            list.push({
                id,
                name,
                avatar: String(char.avatar || '').trim(),
                personality,
                description: description ? description.substring(0, 150) : ''
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
                const memberList = rawMembers
                    .map(member => String(member?.name || member?.avatar || member || '').trim())
                    .filter(Boolean);
                const id = this._normalizeLobbyId('group', group?.id || group?.name || name, index);
                if (seen.has(id)) return;
                seen.add(id);
                list.push({
                    id,
                    name,
                    memberCount: memberList.length,
                    memberPreview: memberList.slice(0, 5).join('、')
                });
            });
        }

        const personaUsers = this._extractPersonaUsers(ctx);
        personaUsers.forEach((user, index) => {
            const id = this._normalizeLobbyId('group_persona', user.id || user.name, index);
            if (seen.has(id)) return;
            seen.add(id);
            list.push({
                id,
                name: user.name,
                memberCount: 1,
                memberPreview: user.name
            });
        });

        return list;
    }

    renderLobbyLinkSection(context = null) {
        const ctx = context || this._safeGetContext();
        const characters = this._extractLobbyCharacters(ctx);
        const groups = this._extractLobbyGroups(ctx);
        const storedCharacterIds = this._parseIdList(this.storage.get(LOBBY_LINK_CHARACTER_IDS_KEY));
        const storedGroupIds = this._parseIdList(this.storage.get(LOBBY_LINK_GROUP_IDS_KEY));

        const selectedCharacterSet = new Set(
            storedCharacterIds.hasStored ? storedCharacterIds.list : characters.map(item => item.id)
        );
        const selectedGroupSet = new Set(
            storedGroupIds.hasStored ? storedGroupIds.list : groups.map(item => item.id)
        );

        const selectedCharacterCount = characters.filter(item => selectedCharacterSet.has(item.id)).length;
        const selectedGroupCount = groups.filter(item => selectedGroupSet.has(item.id)).length;

        const renderGroupRows = groups.length > 0
            ? groups.map(group => `
                <label class="phone-lobby-item-row" style="display:flex; align-items:flex-start; gap:8px; padding:8px 4px; border-bottom:1px solid #f1f1f1;">
                    <input type="checkbox" class="phone-lobby-group-check" data-group-id="${this._escapeHtml(group.id)}" ${selectedGroupSet.has(group.id) ? 'checked' : ''}>
                    <div style="min-width:0;">
                        <div style="font-size:13px; color:#111; font-weight:600; line-height:1.35;">${this._escapeHtml(group.name)}</div>
                    </div>
                </label>
            `).join('')
            : '<div style="font-size:12px; color:#888; padding:10px 4px;">未读取到用户组（当前环境可能未提供分组数据）。</div>';

        const renderCharacterRows = characters.length > 0
            ? characters.map(character => {
                return `
                    <label class="phone-lobby-item-row" style="display:flex; align-items:flex-start; gap:8px; padding:8px 4px; border-bottom:1px solid #f1f1f1;">
                        <input type="checkbox" class="phone-lobby-character-check" data-character-id="${this._escapeHtml(character.id)}" ${selectedCharacterSet.has(character.id) ? 'checked' : ''}>
                        <div style="min-width:0;">
                            <div style="font-size:13px; color:#111; font-weight:600; line-height:1.35;">${this._escapeHtml(character.name)}</div>
                        </div>
                    </label>
                `;
            }).join('')
            : '<div style="font-size:12px; color:#888; padding:10px 4px;">未读取到角色卡列表。</div>';

        return `
            <div class="setting-section">
                <div class="setting-section-title">🏛️ 大厅现实联动</div>
                <div class="setting-info">
                    当前模式：大厅（仅主界面生效）<br>
                    说明：仅按下方勾选名单联动微信，不改写会话内用户设定/人设。
                </div>
                <div class="setting-item" style="display:flex; align-items:center; justify-content:space-between;">
                    <div>
                        <div class="setting-label">用户组白名单</div>
                        <div class="setting-desc">已勾选 <span id="phone-lobby-groups-count">${selectedGroupCount}</span> / <span id="phone-lobby-groups-total">${groups.length}</span></div>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button class="setting-btn" id="phone-lobby-groups-select-all" style="height:30px; padding:0 10px; border:1px solid #d8d8d8; background:#fff; color:#333;">全选</button>
                        <button class="setting-btn" id="phone-lobby-groups-clear" style="height:30px; padding:0 10px; border:1px solid #f1c7c3; background:#fff; color:#d93025;">清空</button>
                    </div>
                </div>
                <div class="setting-item" style="padding-top:0;">
                    <div class="phone-lobby-groups-list">${renderGroupRows}</div>
                </div>
                <div class="setting-item" style="display:flex; align-items:center; justify-content:space-between;">
                    <div>
                        <div class="setting-label">角色卡白名单</div>
                        <div class="setting-desc">已勾选 <span id="phone-lobby-characters-count">${selectedCharacterCount}</span> / <span id="phone-lobby-characters-total">${characters.length}</span></div>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button class="setting-btn" id="phone-lobby-characters-select-all" style="height:30px; padding:0 10px; border:1px solid #d8d8d8; background:#fff; color:#333;">全选</button>
                        <button class="setting-btn" id="phone-lobby-characters-clear" style="height:30px; padding:0 10px; border:1px solid #f1c7c3; background:#fff; color:#d93025;">清空</button>
                    </div>
                </div>
                <div class="setting-item" style="padding-top:0;">
                    <div class="phone-lobby-characters-list">${renderCharacterRows}</div>
                </div>
                <div class="setting-item setting-button">
                    <button class="setting-btn" id="phone-lobby-refresh" style="width:100%; height:34px; border:1px solid #d8d8d8; background:#f8f8f8; color:#333;">
                        重新读取大厅列表
                    </button>
                </div>
            </div>
        `;
    }

    async _saveLobbySelectionFromDom() {
        const document = this._createSettingsScopedDocument();
        const characterIds = Array.from(document.querySelectorAll('.phone-lobby-character-check:checked'))
            .map(input => String(input.getAttribute('data-character-id') || '').trim())
            .filter(Boolean);
        const groupIds = Array.from(document.querySelectorAll('.phone-lobby-group-check:checked'))
            .map(input => String(input.getAttribute('data-group-id') || '').trim())
            .filter(Boolean);
        await this.storage.set(LOBBY_LINK_CHARACTER_IDS_KEY, JSON.stringify(characterIds));
        await this.storage.set(LOBBY_LINK_GROUP_IDS_KEY, JSON.stringify(groupIds));
    }

    _refreshLobbySelectionCountInDom() {
        const document = this._createSettingsScopedDocument();
        const selectedGroupCount = document.querySelectorAll('.phone-lobby-group-check:checked').length;
        const selectedCharacterCount = document.querySelectorAll('.phone-lobby-character-check:checked').length;
        const groupCountEl = document.getElementById('phone-lobby-groups-count');
        const characterCountEl = document.getElementById('phone-lobby-characters-count');
        if (groupCountEl) groupCountEl.textContent = String(selectedGroupCount);
        if (characterCountEl) characterCountEl.textContent = String(selectedCharacterCount);
    }

    async _setAllLobbyCheckboxes(selector, checked) {
        const document = this._createSettingsScopedDocument();
        document.querySelectorAll(selector).forEach(input => {
            input.checked = !!checked;
        });
        this._refreshLobbySelectionCountInDom();
        await this._saveLobbySelectionFromDom();
    }

    _getTtsProviderDefaults(provider) {
        const defaults = {
            minimax_cn: { url: 'https://api.minimaxi.com/v1/t2a_v2', model: 'speech-02-hd', voice: 'female-shaonv' },
            minimax_intl: { url: 'https://api.minimax.io/v1/t2a_v2', model: 'speech-2.8-hd', voice: 'Chinese (Mandarin)_Warm_Girl' },
            openai: { url: 'https://api.openai.com/v1/audio/speech', model: 'tts-1', voice: 'alloy' },
            indextts: { url: 'http://127.0.0.1:7880/v1/audio/speech', model: 'index-tts2', voice: 'default.wav' },
            nimo: { url: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-tts', voice: 'mimo_default' },
            volcengine: { url: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional', model: 'seed-tts-2.0', voice: 'BV700_streaming', resourceId: 'seed-tts-2.0' }
        };
        return defaults[provider] || defaults.minimax_cn;
    }

    _getTtsProviderConfigKey(provider, field) {
        return `phone-tts-${provider}-${field}`;
    }

    _getTtsProviderValue(provider, field, legacyKey = '') {
        const scoped = String(this.storage.get(this._getTtsProviderConfigKey(provider, field)) || '').trim();
        if (scoped) return scoped;
        if (legacyKey && provider !== 'volcengine' && provider === this._getCurrentTtsProvider()) {
            return String(this.storage.get(legacyKey) || '').trim();
        }
        return '';
    }

    _getCurrentTtsProvider() {
        return String(this.storage.get('phone-tts-provider') || 'minimax_cn').trim() || 'minimax_cn';
    }

    _getCurrentMainTtsProvider() {
        const scoped = String(this.storage.get('phone-tts-main-provider') || '').trim();
        if (['minimax_cn', 'minimax_intl', 'openai', 'indextts', 'nimo'].includes(scoped)) return scoped;

        const current = this._getCurrentTtsProvider();
        if (['minimax_cn', 'minimax_intl', 'openai', 'indextts', 'nimo'].includes(current)) return current;

        const legacyUrl = String(this.storage.get('phone-tts-url') || '').trim().toLowerCase();
        if (legacyUrl.includes('minimaxi.com')) return 'minimax_cn';
        if (legacyUrl.includes('minimax.chat') || legacyUrl.includes('minimax.io')) return 'minimax_intl';
        if (legacyUrl.includes('127.0.0.1:7880') || legacyUrl.includes('localhost:7880') || legacyUrl.includes('index-tts')) return 'indextts';
        if (legacyUrl.includes('xiaomimimo.com') || /\/(?:v1\/)?chat\/completions\b/.test(legacyUrl)) return 'nimo';
        if (legacyUrl.includes('api.openai.com') || /\/audio\/speech\b/.test(legacyUrl)) return 'openai';
        return 'minimax_cn';
    }

    // 🔥 处理滑动返回
    handleSwipeBack() {
        // 仅当前前台图层是设置页时才响应，避免历史隐藏层误触发
        const currentView = document.querySelector('.phone-view-current');
        if (!currentView?.querySelector('.settings-app')) return;

        // 设置页面没有子页面，直接返回主屏幕
        window.dispatchEvent(new CustomEvent('phone:goHome'));
    }

    render() {
        const context = this.storage.getContext();
        const isLobbyMode = this._isLobbyMode(context);
        if (!isLobbyMode && this.currentTab === 'lobby') {
            this.currentTab = 'general';
        }
        const charName = (() => {
            const name2 = String(context?.name2 || '').trim();
            if (name2) return name2;

            const characterId = Number.parseInt(context?.characterId, 10);
            if (Number.isInteger(characterId) && Array.isArray(context?.characters) && context.characters[characterId]?.name) {
                const byIdName = String(context.characters[characterId].name || '').trim();
                if (byIdName) return byIdName;
            }

            const characterIdRaw = String(context?.characterId || '').trim();
            if (characterIdRaw) return characterIdRaw;

            if (isLobbyMode) return 'SillyTavern System（大厅）';
            return '未识别角色';
        })();
        const charBlockLabel = isLobbyMode ? '当前环境' : '角色名称';
        const wechatInteropModeKey = this._getWechatInteropModeStorageKey(context);
        const wechatOnlineOnlyModeKey = this._getWechatOnlineOnlyModeStorageKey(context);
        const wechatOnlineProactiveEnabledKey = this._getWechatOnlineProactiveEnabledStorageKey(context);
        const wechatOnlineProactiveIntervalKey = this._getWechatOnlineProactiveIntervalStorageKey(context);
        const isWechatInteropMode = this._isStorageTruthy(wechatInteropModeKey);
        const isWechatOnlineOnlyMode = this._isStorageTruthy(wechatOnlineOnlyModeKey) && !isWechatInteropMode;
        const isWechatOnlineProactiveEnabled = this._isStorageTruthy(wechatOnlineProactiveEnabledKey);
        const wechatOnlineProactiveInterval = readNonNegativeStorageNumber(this.storage, wechatOnlineProactiveIntervalKey, 10, 9999) || 10;
        const currentTtsProvider = this._getCurrentMainTtsProvider();
        const currentTtsDefaults = this._getTtsProviderDefaults(currentTtsProvider);
        const currentTtsUrl = this._getTtsProviderValue(currentTtsProvider, 'url', 'phone-tts-url') || currentTtsDefaults.url || '';
        const currentTtsKey = this._getTtsProviderValue(currentTtsProvider, 'key', 'phone-tts-key');
        const currentTtsModel = this._getTtsProviderValue(currentTtsProvider, 'model', 'phone-tts-model') || currentTtsDefaults.model || '';
        const currentTtsVoice = this._getTtsProviderValue(currentTtsProvider, 'voice', 'phone-tts-voice');
        const currentTtsNimoRelayUrl = this._getTtsProviderValue('nimo', 'relay-url') || DEFAULT_MIMO_TTS_RELAY_URL;
        const volcTtsKey = this._getTtsProviderValue('volcengine', 'key', 'phone-tts-key');
        const volcTtsVoice = this._getTtsProviderValue('volcengine', 'voice');
        const ttsVoiceHistory = (() => {
            try { return JSON.parse(this.storage.get('phone-tts-voice-history') || '[]'); } catch(e) { return []; }
        })();
        const volcTtsVoiceHistory = (() => {
            try { return JSON.parse(this.storage.get('phone-tts-volc-voice-history') || '[]'); } catch(e) { return []; }
        })();
        const currentTtsVolcAppId = this._getTtsProviderValue('volcengine', 'app-id', 'phone-tts-volc-app-id');
        const currentTtsVolcResourceId = this._getTtsProviderValue('volcengine', 'resource-id', 'phone-tts-volc-resource-id') || 'seed-tts-2.0';
        const currentTtsVolcCloneWorkerUrl = this._getTtsProviderValue('volcengine', 'clone-worker-url', 'phone-tts-volc-clone-worker-url') || DEFAULT_DOUBAO_CLONE_WORKER_URL;
        const currentTtsVolcCloneAccessToken = this._getTtsProviderValue('volcengine', 'clone-access-token', 'phone-tts-volc-clone-access-token');
        const currentTtsVolcCloneAppId = this._getTtsProviderValue('volcengine', 'clone-app-id', 'phone-tts-volc-clone-app-id');
        const isTtsMiniMaxSectionOpen = this.storage.get('phone-tts-minimax-section-open') === true;
        const isTtsVolcSectionOpen = this.storage.get('phone-tts-volc-section-open') === true;
        const isTtsFallbackSectionOpen = this.storage.get('phone-tts-fallback-section-open') === true;
        const isTtsWechatSectionOpen = this.storage.get('phone-tts-wechat-section-open') === true;
        const isTtsHoneySectionOpen = this.storage.get('phone-tts-honey-section-open') === true;
        const ttsProviderOptions = [
            { id: 'minimax_cn', label: 'MiniMax 国内' },
            { id: 'minimax_intl', label: 'MiniMax 国际' },
            { id: 'openai', label: 'OpenAI' },
            { id: 'indextts', label: 'IndexTTS 本地' },
            { id: 'nimo', label: 'MiMo-V2.5-TTS' },
            { id: 'volcengine', label: '豆包 / 火山引擎' }
        ];
        const currentGlobalTtsProvider = this._getCurrentTtsProvider();
        const fallbackMaleProvider = String(this.storage.get('phone-tts-fallback-male-provider') || currentGlobalTtsProvider || 'minimax_cn').trim() || 'minimax_cn';
        const fallbackFemaleProvider = String(this.storage.get('phone-tts-fallback-female-provider') || currentGlobalTtsProvider || 'minimax_cn').trim() || 'minimax_cn';
        const fallbackMaleVoice = String(this.storage.get('phone-tts-fallback-male-voice') || '').trim();
        const fallbackFemaleVoice = String(this.storage.get('phone-tts-fallback-female-voice') || '').trim();
        const renderTtsProviderOptions = (selectedProvider = '') => ttsProviderOptions
            .map(option => `<option value="${option.id}" ${selectedProvider === option.id ? 'selected' : ''}>${option.label}</option>`)
            .join('');
        const isGeneralInteractionOpen = this.storage.get('phone-settings-general-interaction-open') === true;
        const readStoredBool = (key, fallback = false) => {
            const value = this.storage.get(key, undefined);
            if (value === undefined || value === null) return fallback;
            return value === true || value === 'true';
        };
        const hasStoredValue = (key) => {
            const value = this.storage.get(key, undefined);
            return value !== undefined && value !== null;
        };
        const isGeneralLimitsOpen = readStoredBool('phone-settings-general-limits-open');
        const isGeneralOnlineInjectionOpen = hasStoredValue('phone-settings-general-online-injection-open')
            ? readStoredBool('phone-settings-general-online-injection-open')
            : isGeneralLimitsOpen;
        const isGeneralOfflineInjectionOpen = hasStoredValue('phone-settings-general-offline-injection-open')
            ? readStoredBool('phone-settings-general-offline-injection-open')
            : isGeneralLimitsOpen;
        const isGeneralPersonalizationOpen = this.storage.get('phone-settings-general-personalization-open') === true;
        const isGeneralTextColorOpen = this.storage.get('phone-settings-general-text-color-open') === true;
        const isGeneralTimeOpen = this.storage.get('phone-settings-general-time-open') === true;
        const isGeneralDataOpen = this.storage.get('phone-settings-general-data-open') === true;
        const isWechatMessageSoundEnabled = this._isStorageTruthy(WECHAT_MESSAGE_SOUND_ENABLED_KEY);
        const homeLayoutRaw = String(this.storage.get('phone-home-layout') || 'icons');
        const homeLayout = homeLayoutRaw === 'cards' ? 'cards' : 'icons';
        const cardLayoutCustomCss = String(this.storage.get(CARD_LAYOUT_CUSTOM_CSS_KEY) || '');
        // 加载壁纸和颜色设置
        const wallpaper = this.imageManager.getWallpaper();
        const hasWallpaper = !!String(wallpaper || '').trim();
        const wallpaperStyle = hasWallpaper
            ? `background-image: url('${String(wallpaper).replace(/'/g, "\\'")}'); background-size: cover; background-position: center;`
            : '';
        const cardTimeImage = this.storage.get('phone-card-time-image') || null;
        const globalTextColor = this.storage.get('phone-global-text') || '#000000';
        const phoneFrameColor = this.storage.get('phone-frame-color') || '#1a1a1a';
        const phoneShellScale = normalizePhoneShellScalePercent(this.storage.get('phone-shell-scale') || PHONE_SHELL_SCALE_DEFAULT);
        const html = `
            <div class="settings-app ${hasWallpaper ? 'settings-has-wallpaper' : ''}" style="${wallpaperStyle}">
                <style>
                    .settings-app {
                        box-sizing: border-box !important;
                        width: 100% !important;
                        height: 100% !important;
                        min-width: 0 !important;
                        min-height: 0 !important;
                        display: flex !important;
                        flex-direction: column !important;
                        overflow: hidden !important;
                        --settings-text-color: var(--phone-global-text, #000000);
                        color: var(--settings-text-color) !important;
                    }
                    .settings-app .app-body {
                        min-width: 0 !important;
                        min-height: 0 !important;
                        flex: 1 1 auto !important;
                        overflow-y: auto !important;
                        overflow-x: hidden !important;
                        touch-action: pan-y !important;
                        overscroll-behavior: contain !important;
                        -webkit-overflow-scrolling: touch !important;
                        scrollbar-width: none !important;
                        -ms-overflow-style: none !important;
                    }
                    .settings-app .app-body::-webkit-scrollbar {
                        width: 0 !important;
                        height: 0 !important;
                        display: none !important;
                    }
                    .settings-app,
                    .settings-app *,
                    .settings-app *::before,
                    .settings-app *::after {
                        writing-mode: horizontal-tb !important;
                        text-orientation: mixed !important;
                    }
                    .settings-app .phone-settings-tab-content,
                    .settings-app .setting-item,
                    .settings-app .setting-label,
                    .settings-app .setting-desc,
                    .settings-app .setting-value,
                    .settings-app button,
                    .settings-app input,
                    .settings-app select,
                    .settings-app textarea,
                    .settings-app label,
                    .settings-app span,
                    .settings-app div {
                        max-width: 100% !important;
                        word-break: break-word !important;
                        overflow-wrap: anywhere !important;
                    }
                    .settings-app input[type="checkbox"] {
                        -webkit-appearance: checkbox !important;
                        appearance: auto !important;
                        opacity: 1 !important;
                        accent-color: #30c46b !important;
                    }
                    .settings-app .phone-memory-perm {
                        -webkit-appearance: checkbox !important;
                        appearance: auto !important;
                        opacity: 1 !important;
                        width: 16px !important;
                        height: 16px !important;
                        min-width: 16px !important;
                        min-height: 16px !important;
                        margin: 0 !important;
                        accent-color: #30c46b !important;
                        cursor: pointer !important;
                        filter: none !important;
                        transform: none !important;
                    }
                    .settings-app details > summary::-webkit-details-marker { display: none; }
                    .settings-app details > summary::marker { content: ''; }
                    .settings-app .settings-app-header,
                    .settings-app .settings-app-header h2,
                    .settings-app .settings-tab-btn,
                    .settings-app .setting-section-title,
                    .settings-app .setting-label,
                    .settings-app .setting-desc,
                    .settings-app .setting-value,
                    .settings-app .settings-subsection-title,
                    .settings-app .phone-shell-scale-value,
                    .settings-app .app-name-custom-label,
                    .settings-app details[data-settings-fold-key] > summary,
                    .settings-app details[data-settings-fold-key] > summary > span,
                    .settings-app details[data-tts-fold-key] > summary,
                    .settings-app details[data-tts-fold-key] > summary > span,
                    .settings-app label:not(.toggle-switch),
                    .settings-app :where(div, span, summary, label, p, small)[style*="color: #000"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color:#000"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color: #111"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color:#111"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color: #222"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color:#222"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color: #333"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color:#333"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color: #666"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color:#666"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color: #777"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color:#777"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color: #888"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color:#888"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color: #999"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color:#999"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color: #1d1d1f"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color:#1d1d1f"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color: #374151"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color:#374151"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color: #6b7280"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color:#6b7280"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color: #111827"],
                    .settings-app :where(div, span, summary, label, p, small)[style*="color:#111827"] {
                        color: var(--settings-text-color) !important;
                    }
                    .settings-app input:not([type="checkbox"]):not([type="range"]):not([type="color"]),
                    .settings-app select,
                    .settings-app textarea {
                        color: #111 !important;
                    }
                    .settings-fold-arrow {
                        width: 26px;
                        height: 26px;
                        flex: 0 0 26px;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        color: #8a8a8a;
                        border-radius: 999px;
                        background: rgba(0,0,0,0.04);
                        transition: transform 0.18s ease, background 0.18s ease, color 0.18s ease;
                    }
                    .settings-fold-arrow i {
                        font-size: 11px;
                        line-height: 1;
                    }
                    .settings-app details[open] > summary .settings-fold-arrow {
                        transform: rotate(90deg);
                        color: #222;
                        background: rgba(0,0,0,0.07);
                    }
                    #tab-general {
                        box-sizing: border-box;
                        width: 100%;
                        max-width: 760px;
                        margin: 0 auto;
                    }
                    .settings-app .phone-settings-tab-content {
                        box-sizing: border-box !important;
                        width: 100% !important;
                        visibility: visible !important;
                        opacity: 1 !important;
                    }
                    .settings-app .phone-settings-tab-content.is-active {
                        display: block !important;
                    }
                    .settings-app .phone-settings-tab-content.is-hidden {
                        display: none !important;
                    }
                    #tab-lobby {
                        box-sizing: border-box;
                        width: 100%;
                        max-width: 760px;
                        margin: 0 auto;
                    }
                    .phone-lobby-groups-list,
                    .phone-lobby-characters-list {
                        max-height: 240px;
                        overflow-y: auto;
                        touch-action: pan-y;
                        overscroll-behavior: contain;
                        border: 1px solid rgba(18, 24, 38, 0.08);
                        border-radius: 10px;
                        padding: 0 8px;
                        background: #fff;
                    }
                    .settings-app .phone-lobby-item-row input[type="checkbox"] {
                        -webkit-appearance: checkbox !important;
                        appearance: auto !important;
                        opacity: 1 !important;
                        width: 16px !important;
                        height: 16px !important;
                        min-width: 16px !important;
                        min-height: 16px !important;
                        margin-top: 2px !important;
                        accent-color: #30c46b !important;
                        cursor: pointer;
                    }
                    #tab-general > details[data-settings-fold-key] {
                        margin: 10px 0 !important;
                        border: 1px solid rgba(18, 24, 38, 0.08) !important;
                        border-radius: 14px !important;
                        background: #ffffff !important;
                        box-shadow: 0 8px 24px rgba(18, 24, 38, 0.06), 0 1px 2px rgba(18, 24, 38, 0.04) !important;
                        overflow: hidden !important;
                    }
                    #tab-general > details[data-settings-fold-key] > summary {
                        min-height: 46px !important;
                        height: auto !important;
                        padding: 0 12px 0 14px !important;
                        display: flex !important;
                        align-items: center !important;
                        justify-content: space-between !important;
                        gap: 10px !important;
                        background: linear-gradient(180deg, #ffffff 0%, #f7f8fa 100%) !important;
                        border-bottom: 1px solid transparent !important;
                        font-size: 13px !important;
                        font-weight: 700 !important;
                        color: var(--settings-text-color) !important;
                    }
                    #tab-general > details[data-settings-fold-key][open] > summary {
                        border-bottom-color: rgba(18, 24, 38, 0.07) !important;
                    }
                    #tab-general > details[data-settings-fold-key] > summary > span:first-child {
                        display: inline-flex !important;
                        min-width: 0 !important;
                        align-items: center !important;
                        gap: 7px !important;
                        overflow: hidden !important;
                        text-overflow: ellipsis !important;
                        white-space: nowrap !important;
                    }
                    #tab-general > details[data-settings-fold-key] > div {
                        padding: 6px 10px 10px !important;
                        background: #fff !important;
                    }
                    #tab-general > details[data-settings-fold-key] .setting-item {
                        min-height: 44px;
                        padding: 11px 2px !important;
                        border-bottom: 1px solid rgba(18, 24, 38, 0.07) !important;
                        background: transparent !important;
                    }
                    #tab-general > details[data-settings-fold-key] .setting-item:last-child {
                        border-bottom: none !important;
                    }
                    #tab-general > details[data-settings-fold-key] .setting-item:has(+ .settings-subsection-title),
                    #tab-general > details[data-settings-fold-key] .setting-info:has(+ .settings-subsection-title) {
                        border-bottom-color: transparent !important;
                    }
                    #tab-general .settings-subsection-title {
                        margin: 0 !important;
                        padding: 12px 0 8px !important;
                        border-top: 1px solid rgba(18, 24, 38, 0.08) !important;
                        color: var(--settings-text-color) !important;
                        font-size: 12px !important;
                        font-weight: 700 !important;
                        line-height: 1.35 !important;
                    }
                    #tab-general > details[data-settings-fold-key] .setting-toggle {
                        display: flex !important;
                        align-items: center !important;
                        justify-content: space-between !important;
                        gap: 14px !important;
                    }
                    #tab-general > details[data-settings-fold-key] .setting-toggle > div:first-child,
                    #tab-general > details[data-settings-fold-key] .setting-item > div:first-child {
                        min-width: 0;
                    }
                    #tab-general > details[data-settings-fold-key] .setting-label {
                        font-size: 13px !important;
                        font-weight: 650 !important;
                        color: var(--settings-text-color) !important;
                        line-height: 1.3 !important;
                    }
                    #tab-general > details[data-settings-fold-key] .setting-desc {
                        margin-top: 4px !important;
                        color: color-mix(in srgb, var(--settings-text-color) 68%, transparent) !important;
                        font-size: 11px !important;
                        line-height: 1.45 !important;
                    }
                    #tab-general > details[data-settings-fold-key] .setting-info {
                        margin: 8px 0 0 !important;
                        padding: 9px 10px !important;
                        border: 1px solid rgba(18, 24, 38, 0.06) !important;
                        border-radius: 10px !important;
                        background: #f7f8fa !important;
                        color: color-mix(in srgb, var(--settings-text-color) 68%, transparent) !important;
                        font-size: 11px !important;
                        line-height: 1.55 !important;
                    }
                    #tab-general > details[data-settings-fold-key] input[type="number"] {
                        width: 68px !important;
                        height: 32px !important;
                        border-radius: 9px !important;
                        border: 1px solid rgba(18, 24, 38, 0.12) !important;
                        background: #f8fafc !important;
                        color: #111827 !important;
                        font-size: 13px !important;
                    }
                    #tab-general > details[data-settings-fold-key] .setting-btn {
                        min-height: 34px !important;
                        border-radius: 10px !important;
                        font-size: 12px !important;
                        font-weight: 650 !important;
                    }
                    #tab-general .phone-shell-scale-control {
                        margin-top: 10px;
                        display: flex;
                        align-items: center;
                        gap: 10px;
                    }
                    #tab-general .phone-shell-scale-control input[type="range"] {
                        flex: 1 1 auto;
                        min-width: 0;
                        accent-color: #111827;
                        touch-action: pan-y;
                    }
                    #tab-general .phone-shell-scale-value {
                        min-width: 42px;
                        color: var(--settings-text-color);
                        font-size: 12px;
                        font-weight: 700;
                        text-align: right;
                    }
                    #tab-general .app-icon-grid,
                    #tab-general .dock-config-grid {
                        grid-template-columns: repeat(auto-fit, minmax(52px, 1fr)) !important;
                        gap: 10px !important;
                    }
                    #tab-general .app-name-custom-list {
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                        margin-top: 10px;
                        max-height: 210px;
                        overflow-y: auto;
                        scrollbar-width: none;
                        -ms-overflow-style: none;
                        touch-action: pan-y;
                        overscroll-behavior: contain;
                        -webkit-overflow-scrolling: touch;
                    }
                    #tab-general .app-name-custom-list::-webkit-scrollbar {
                        display: none;
                    }
                    #tab-general .app-name-custom-row {
                        display: grid;
                        grid-template-columns: 76px 1fr;
                        align-items: center;
                        gap: 8px;
                    }
                    #tab-general .app-name-custom-label {
                        min-width: 0;
                        color: #333;
                        font-size: 12px;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    }
                    #tab-general .app-name-custom-input {
                        width: 100%;
                        height: 30px;
                        box-sizing: border-box;
                        border: 1px solid rgba(18, 24, 38, 0.12);
                        border-radius: 9px;
                        padding: 0 8px;
                        background: #f8fafc;
                        color: #111827;
                        font-size: 12px;
                        outline: none;
                    }
                    #tab-general .app-name-custom-fold {
                        display: block;
                    }
                    #tab-general .app-name-custom-fold > summary {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 10px;
                        cursor: pointer;
                        list-style: none;
                    }
                    #tab-general .app-name-custom-fold > summary::-webkit-details-marker {
                        display: none;
                    }
                    #tab-general .app-name-custom-fold > summary > span:first-child {
                        display: flex;
                        flex-direction: column;
                        min-width: 0;
                    }
                    #tab-general .app-name-custom-fold[open] > summary {
                        margin-bottom: 8px;
                    }
                    #tab-general .app-name-custom-fold[open] > summary .settings-fold-arrow {
                        transform: rotate(90deg);
                    }
                    @media (max-width: 380px) {
                        #tab-general > details[data-settings-fold-key] > summary {
                            min-height: 44px !important;
                            padding-left: 12px !important;
                        }
                        #tab-general > details[data-settings-fold-key] > div {
                            padding-left: 9px !important;
                            padding-right: 9px !important;
                        }
                        #tab-general > details[data-settings-fold-key] .setting-toggle {
                            gap: 10px !important;
                        }
                    }
                    @media (min-width: 700px) {
                        #tab-general {
                            padding-left: 8px;
                            padding-right: 8px;
                        }
                        #tab-general > details[data-settings-fold-key] > summary {
                            min-height: 50px !important;
                        }
                        #tab-general > details[data-settings-fold-key] > div {
                            padding: 8px 14px 14px !important;
                        }
                    }
                    .settings-app .toggle-switch {
                        position: relative !important;
                        display: inline-block !important;
                        width: 42px !important;
                        min-width: 42px !important;
                        height: 26px !important;
                        flex: 0 0 42px !important;
                        border-radius: 999px !important;
                    }
                    .settings-app .toggle-switch input {
                        opacity: 0 !important;
                        width: 0 !important;
                        height: 0 !important;
                    }
                    .settings-app .toggle-slider {
                        position: absolute !important;
                        inset: 0 !important;
                        cursor: pointer !important;
                        border-radius: 999px !important;
                        background: #dfe3ea !important;
                        box-shadow: inset 0 1px 2px rgba(0,0,0,0.14) !important;
                        transition: background .2s ease, box-shadow .2s ease !important;
                    }
                    .settings-app .toggle-slider::before {
                        content: "" !important;
                        position: absolute !important;
                        width: 22px !important;
                        height: 22px !important;
                        left: 2px !important;
                        top: 2px !important;
                        bottom: auto !important;
                        border-radius: 50% !important;
                        background: #fff !important;
                        box-shadow: 0 2px 5px rgba(0,0,0,0.22) !important;
                        transition: transform .2s ease !important;
                    }
                    .settings-app .toggle-switch input:checked + .toggle-slider {
                        background: #30c46b !important;
                        box-shadow: inset 0 1px 2px rgba(0,0,0,0.12), 0 0 0 1px rgba(48,196,107,0.16) !important;
                    }
                    .settings-app .toggle-switch input:checked + .toggle-slider::before {
                        transform: translateX(16px) !important;
                    }
                    .settings-app .phone-version-value {
                        display: inline-flex;
                        align-items: center;
                        justify-content: flex-end;
                        gap: 6px;
                    }
                    .settings-app .phone-version-info-btn {
                        width: 20px;
                        height: 20px;
                        padding: 0;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        border: none;
                        border-radius: 999px;
                        background: rgba(0, 122, 255, 0.12);
                        color: #007aff;
                        font-size: 12px;
                        line-height: 1;
                        cursor: pointer;
                        -webkit-tap-highlight-color: transparent;
                    }
                    .settings-app .phone-version-info-btn:active {
                        transform: scale(0.94);
                        background: rgba(0, 122, 255, 0.2);
                    }
                    .settings-app .setting-section:has(#phone-api-enabled:checked) #phone-api-details {
                        display: block !important;
                    }
                    .settings-app.settings-has-wallpaper #phone-api-details {
                        background: rgba(255,255,255,0.16) !important;
                        border-top-color: rgba(255,255,255,0.28) !important;
                    }
                    .settings-app.settings-has-wallpaper #phone-api-details > div[style*="background: #fff"],
                    .settings-app.settings-has-wallpaper #phone-api-details > div[style*="background:#fff"],
                    .settings-app.settings-has-wallpaper #phone-api-details div[style*="background: #fff"],
                    .settings-app.settings-has-wallpaper #phone-api-details div[style*="background:#fff"] {
                        background: rgba(255,255,255,0.24) !important;
                        border-color: rgba(255,255,255,0.34) !important;
                        backdrop-filter: blur(10px) saturate(135%) !important;
                        -webkit-backdrop-filter: blur(10px) saturate(135%) !important;
                    }
                    .settings-app.settings-has-wallpaper {
                        --settings-glass-bg: rgba(255,255,255,0.34);
                        --settings-glass-bg-strong: rgba(255,255,255,0.44);
                        --settings-glass-border: rgba(255,255,255,0.36);
                        background-color: #f7f7f7;
                    }
                    .settings-app.settings-has-wallpaper .settings-app-header,
                    .settings-app.settings-has-wallpaper .settings-tabs {
                        background: rgba(255,255,255,0.24) !important;
                        border-color: var(--settings-glass-border) !important;
                        backdrop-filter: blur(18px) saturate(140%) !important;
                        -webkit-backdrop-filter: blur(18px) saturate(140%) !important;
                    }
                    .settings-app.settings-has-wallpaper .settings-tabs > div {
                        background: rgba(255,255,255,0.2) !important;
                    }
                    .settings-app.settings-has-wallpaper .settings-tab-btn.active {
                        background: rgba(255,255,255,0.78) !important;
                    }
                    .settings-app.settings-has-wallpaper .app-body {
                        background: transparent !important;
                    }
                    .settings-app.settings-has-wallpaper .setting-section,
                    .settings-app.settings-has-wallpaper details[data-settings-fold-key],
                    .settings-app.settings-has-wallpaper details[data-tts-fold-key],
                    .settings-app.settings-has-wallpaper .phone-lobby-groups-list,
                    .settings-app.settings-has-wallpaper .phone-lobby-characters-list {
                        background: var(--settings-glass-bg) !important;
                        border-color: var(--settings-glass-border) !important;
                        backdrop-filter: blur(12px) saturate(135%) !important;
                        -webkit-backdrop-filter: blur(12px) saturate(135%) !important;
                        box-shadow: 0 8px 22px rgba(0,0,0,0.08) !important;
                    }
                    .settings-app.settings-has-wallpaper details[data-settings-fold-key] > summary,
                    .settings-app.settings-has-wallpaper details[data-tts-fold-key] > summary,
                    .settings-app.settings-has-wallpaper #tab-general > details[data-settings-fold-key] > summary,
                    .settings-app.settings-has-wallpaper #tab-general > details[data-settings-fold-key] > div,
                    .settings-app.settings-has-wallpaper .setting-info {
                        background: rgba(255,255,255,0.26) !important;
                    }
                    .settings-app.settings-has-wallpaper details[data-settings-fold-key] > div,
                    .settings-app.settings-has-wallpaper details[data-tts-fold-key] > div {
                        background: rgba(255,255,255,0.16) !important;
                    }
                    .settings-app.settings-has-wallpaper #tab-general > details[data-settings-fold-key],
                    .settings-app.settings-has-wallpaper #tab-general > .setting-section {
                        background: var(--settings-glass-bg) !important;
                        border-color: var(--settings-glass-border) !important;
                        backdrop-filter: blur(12px) saturate(135%) !important;
                        -webkit-backdrop-filter: blur(12px) saturate(135%) !important;
                    }
                    .settings-app.settings-has-wallpaper #tab-general > details[data-settings-fold-key] > summary {
                        background: rgba(255,255,255,0.24) !important;
                    }
                    .settings-app.settings-has-wallpaper #tab-general > details[data-settings-fold-key] > div {
                        background: rgba(255,255,255,0.16) !important;
                    }
                    .settings-app.settings-has-wallpaper .setting-item {
                        background: transparent !important;
                        border-bottom-color: rgba(255,255,255,0.28) !important;
                    }
                    .settings-app.settings-has-wallpaper #tab-tts .tts-section-list,
                    .settings-app.settings-has-wallpaper #tab-tts [data-tts-fold-key],
                    .settings-app.settings-has-wallpaper #tab-tts [data-tts-fold-key] > div,
                    .settings-app.settings-has-wallpaper #tab-tts .setting-item,
                    .settings-app.settings-has-wallpaper #tab-tts div[style*="background: #fff"],
                    .settings-app.settings-has-wallpaper #tab-tts div[style*="background:#fff"],
                    .settings-app.settings-has-wallpaper #tab-tts div[style*="background: #fafafa"],
                    .settings-app.settings-has-wallpaper #tab-tts div[style*="background:#fafafa"] {
                        background-color: rgba(255,255,255,0.18) !important;
                        background-image: none !important;
                    }
                    .settings-app.settings-has-wallpaper #tab-tts [data-tts-fold-key] > summary {
                        background: rgba(255,255,255,0.24) !important;
                    }
                    .settings-app.settings-has-wallpaper #tab-tts [data-tts-fold-key] {
                        border-color: var(--settings-glass-border) !important;
                        backdrop-filter: blur(12px) saturate(135%) !important;
                        -webkit-backdrop-filter: blur(12px) saturate(135%) !important;
                        box-shadow: 0 8px 22px rgba(0,0,0,0.08) !important;
                    }
                    .settings-app.settings-has-wallpaper #tab-tts input:not([type="checkbox"]):not([type="range"]),
                    .settings-app.settings-has-wallpaper #tab-tts select,
                    .settings-app.settings-has-wallpaper #tab-tts textarea {
                        background: rgba(255,255,255,0.72) !important;
                        border-color: rgba(255,255,255,0.54) !important;
                    }
                    .settings-app.settings-has-wallpaper input:not([type="checkbox"]):not([type="range"]),
                    .settings-app.settings-has-wallpaper select,
                    .settings-app.settings-has-wallpaper textarea {
                        background: rgba(255,255,255,0.84) !important;
                        border-color: rgba(255,255,255,0.56) !important;
                        color: #111 !important;
                    }
                    .settings-app.settings-has-wallpaper button:not(.settings-tab-btn),
                    .settings-app.settings-has-wallpaper .setting-btn {
                        background-color: rgba(255,255,255,0.72) !important;
                        border-color: rgba(255,255,255,0.48) !important;
                    }
                    .settings-app.settings-has-wallpaper .toggle-switch,
                    .settings-app.settings-has-wallpaper .toggle-switch *,
                    .settings-app.settings-has-wallpaper .phone-version-info-btn {
                        background-color: initial;
                    }
                    .settings-app {
                        --settings-muted-text-color: var(--settings-text-color);
                    }
                    .settings-app .settings-app-header,
                    .settings-app .settings-app-header h2,
                    .settings-app .settings-tabs .settings-tab-btn,
                    .settings-app details[data-settings-fold-key] > summary,
                    .settings-app details[data-settings-fold-key] > summary > span,
                    .settings-app details[data-tts-fold-key] > summary,
                    .settings-app details[data-tts-fold-key] > summary > span,
                    .settings-app .setting-label,
                    .settings-app .setting-value,
                    .settings-app .settings-subsection-title,
                    .settings-app .phone-shell-scale-value,
                    .settings-app .app-name-custom-label,
                    .settings-app label:not(.toggle-switch),
                    .settings-app :is(div, span, summary, label, p, small)[style*="color: #000"],
                    .settings-app :is(div, span, summary, label, p, small)[style*="color:#000"],
                    .settings-app :is(div, span, summary, label, p, small)[style*="color: #111"],
                    .settings-app :is(div, span, summary, label, p, small)[style*="color:#111"],
                    .settings-app :is(div, span, summary, label, p, small)[style*="color: #333"],
                    .settings-app :is(div, span, summary, label, p, small)[style*="color:#333"],
                    .settings-app :is(div, span, summary, label, p, small)[style*="color: #666"],
                    .settings-app :is(div, span, summary, label, p, small)[style*="color:#666"],
                    .settings-app :is(div, span, summary, label, p, small)[style*="color: #1d1d1f"],
                    .settings-app :is(div, span, summary, label, p, small)[style*="color:#1d1d1f"],
                    .settings-app :is(div, span, summary, label, p, small)[style*="color: #6b7280"],
                    .settings-app :is(div, span, summary, label, p, small)[style*="color:#6b7280"],
                    .settings-app :is(div, span, summary, label, p, small)[style*="color: #111827"],
                    .settings-app :is(div, span, summary, label, p, small)[style*="color:#111827"] {
                        color: var(--settings-text-color) !important;
                    }
                    .settings-app .setting-desc,
                    .settings-app .setting-info,
                    .settings-app :is(div, span, p, small)[class*="desc"] {
                        color: var(--settings-muted-text-color) !important;
                    }
                    .settings-app .setting-btn[style*="color: #ff"],
                    .settings-app .setting-btn[style*="color:#ff"],
                    .settings-app .setting-btn[style*="color: #d9"],
                    .settings-app .setting-btn[style*="color:#d9"],
                    .settings-app .phone-version-info-btn {
                        color: revert !important;
                    }
                </style>
                <div class="settings-app-header" style="background: #f7f7f7; color: #000; border-bottom: 0.5px solid #d8d8d8; display: flex; align-items: center; justify-content: center; position: sticky; top: 0; z-index: 100; height: 78px; min-height: 78px; padding: 34px 14px 0; box-sizing: border-box; flex-shrink: 0;">
                    <h2 style="color: #000; font-size: 17px; font-weight: 500; margin: 0;">设置</h2>
                </div>

                <div class="settings-tabs" style="position: sticky; top: 78px; z-index: 99; background: rgba(247,247,247,0.96); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-bottom: 0.5px solid #d8d8d8; min-height: 48px; padding: 7px 10px 8px; box-sizing: border-box; flex-shrink: 0;">
                    <div style="display: grid; grid-template-columns: repeat(${isLobbyMode ? 6 : 5}, minmax(0, 1fr)); gap: 6px; position: relative; height: 33px; padding: 3px; border-radius: 13px; background: rgba(0,0,0,0.045); box-sizing: border-box;">
                        <button class="settings-tab-btn ${this.currentTab === 'general' ? 'active' : ''}" data-tab="general" style="min-width: 0; border: none; background: ${this.currentTab === 'general' ? '#fff' : 'transparent'}; height: 27px; padding: 0; line-height: 27px; font-size: 12px; font-weight: ${this.currentTab === 'general' ? '700' : '500'}; color: ${this.currentTab === 'general' ? '#111' : '#666'}; border-radius: 10px; box-shadow: ${this.currentTab === 'general' ? '0 1px 4px rgba(0,0,0,0.12)' : 'none'}; transition: all .18s ease; white-space: nowrap;">常规</button>
                        <button class="settings-tab-btn ${this.currentTab === 'memory' ? 'active' : ''}" data-tab="memory" style="min-width: 0; border: none; background: ${this.currentTab === 'memory' ? '#fff' : 'transparent'}; height: 27px; padding: 0; line-height: 27px; font-size: 12px; font-weight: ${this.currentTab === 'memory' ? '700' : '500'}; color: ${this.currentTab === 'memory' ? '#111' : '#666'}; border-radius: 10px; box-shadow: ${this.currentTab === 'memory' ? '0 1px 4px rgba(0,0,0,0.12)' : 'none'}; transition: all .18s ease; white-space: nowrap;">联动</button>
                        <button class="settings-tab-btn ${this.currentTab === 'llm' ? 'active' : ''}" data-tab="llm" style="min-width: 0; border: none; background: ${this.currentTab === 'llm' ? '#fff' : 'transparent'}; height: 27px; padding: 0; line-height: 27px; font-size: 12px; font-weight: ${this.currentTab === 'llm' ? '700' : '500'}; color: ${this.currentTab === 'llm' ? '#111' : '#666'}; border-radius: 10px; box-shadow: ${this.currentTab === 'llm' ? '0 1px 4px rgba(0,0,0,0.12)' : 'none'}; transition: all .18s ease; white-space: nowrap;">API</button>
                        <button class="settings-tab-btn ${this.currentTab === 'tts' ? 'active' : ''}" data-tab="tts" style="min-width: 0; border: none; background: ${this.currentTab === 'tts' ? '#fff' : 'transparent'}; height: 27px; padding: 0; line-height: 27px; font-size: 12px; font-weight: ${this.currentTab === 'tts' ? '700' : '500'}; color: ${this.currentTab === 'tts' ? '#111' : '#666'}; border-radius: 10px; box-shadow: ${this.currentTab === 'tts' ? '0 1px 4px rgba(0,0,0,0.12)' : 'none'}; transition: all .18s ease; white-space: nowrap;">TTS</button>
                        <button class="settings-tab-btn ${this.currentTab === 'image' ? 'active' : ''}" data-tab="image" style="min-width: 0; border: none; background: ${this.currentTab === 'image' ? '#fff' : 'transparent'}; height: 27px; padding: 0; line-height: 27px; font-size: 12px; font-weight: ${this.currentTab === 'image' ? '700' : '500'}; color: ${this.currentTab === 'image' ? '#111' : '#666'}; border-radius: 10px; box-shadow: ${this.currentTab === 'image' ? '0 1px 4px rgba(0,0,0,0.12)' : 'none'}; transition: all .18s ease; white-space: nowrap;">生图</button>
                        ${isLobbyMode
                            ? `<button class="settings-tab-btn ${this.currentTab === 'lobby' ? 'active' : ''}" data-tab="lobby" style="min-width: 0; border: none; background: ${this.currentTab === 'lobby' ? '#fff' : 'transparent'}; height: 27px; padding: 0; line-height: 27px; font-size: 12px; font-weight: ${this.currentTab === 'lobby' ? '700' : '500'}; color: ${this.currentTab === 'lobby' ? '#111' : '#666'}; border-radius: 10px; box-shadow: ${this.currentTab === 'lobby' ? '0 1px 4px rgba(0,0,0,0.12)' : 'none'}; transition: all .18s ease; white-space: nowrap;">大厅</button>`
                            : ''}
                    </div>
                </div>

                <div class="app-body">
                    <div class="phone-settings-tab-content ${this.currentTab === 'general' ? 'is-active' : 'is-hidden'}" id="tab-general">
                        <!-- 当前角色信息 -->
                        <div class="setting-section">
                            <div class="setting-section-title">📱 当前角色</div>
                            <div class="setting-item">
                                <div class="setting-label">${charBlockLabel}</div>
                                <div class="setting-value">${charName}</div>
                            </div>
                        </div>

                        <div class="setting-section" style="padding: 10px 12px;">
                            <button id="setting-reset-all-prompts" class="setting-btn" style="width: 100%; padding: 9px 12px; font-size: 12px; background: rgba(255,255,255,0.9); backdrop-filter: blur(10px); border: 1px solid rgba(7,193,96,0.25); color: #0b8f52; border-radius: 10px; font-weight: 700;">
                                <i class="fa-solid fa-rotate"></i> 一键更新所有提示词（恢复默认）
                            </button>
                        </div>

                        <details data-settings-fold-key="phone-settings-general-interaction-open" ${isGeneralInteractionOpen ? 'open' : ''} style="margin: 12px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                            <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                                <span>📡 互动模式</span>
                                ${SETTINGS_FOLD_ARROW_HTML}
                            </summary>
                            <div style="padding: 10px 10px 4px;">

                            <div class="setting-item setting-toggle">
                                <div>
                                    <div class="setting-label">互通模式</div>
                                    <div class="setting-desc">手机主动互动与酒馆正文微信线下注入互通（按会话独立设置）</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="setting-wechat-interop-mode" ${isWechatInteropMode ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <div class="setting-item setting-toggle" style="margin-top: 10px;">
                                <div>
                                    <div class="setting-label">线上模式</div>
                                    <div class="setting-desc">启用手机内线上聊天；可选定时主动触发，开启后会关闭微信线下注入相关开关</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="setting-wechat-online-only-mode" ${isWechatOnlineOnlyMode ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <div class="setting-item setting-toggle" style="margin-top: 10px;">
                                <div>
                                    <div class="setting-label">线上主动触发</div>
                                    <div class="setting-desc">线上模式开启后，按现实时间自动请求微信好友或群聊主动发消息</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="setting-wechat-online-proactive-enabled" ${isWechatOnlineProactiveEnabled ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <div class="setting-item setting-toggle" style="margin-top: 10px;">
                                <div>
                                    <div class="setting-label">微信消息提示音</div>
                                    <div class="setting-desc">线下转线上或线上收到微信消息时播放 iPhone 消息提示音</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="setting-wechat-message-sound-enabled" ${isWechatMessageSoundEnabled ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between; margin-top: 10px;">
                                <div>
                                    <div class="setting-label">主动触发间隔（分钟）</div>
                                    <div class="setting-desc">API 忙时会顺延，空闲后再触发</div>
                                </div>
                                <input type="number" id="setting-wechat-online-proactive-interval" min="1" max="9999"
                                       value="${wechatOnlineProactiveInterval}"
                                       style="width: 68px; height: 32px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>

                            <div class="setting-item setting-button" style="margin-top: 10px;">
                                <button id="setting-wechat-online-proactive-test" class="setting-btn" style="width: 100%; padding: 8px 12px; font-size: 12px; background: rgba(255,255,255,0.9); backdrop-filter: blur(10px); border: 1px solid rgba(7,193,96,0.25); color: #0b8f52; border-radius: 8px;">
                                    <i class="fa-solid fa-paper-plane"></i> 立即测试线上主动触发
                                </button>
                            </div>

                             <div class="setting-item setting-toggle" style="margin-top: 10px;">
                                <div>
                                    <div class="setting-label">内嵌快捷回复按钮</div>
                                    <div class="setting-desc">在底部快捷栏注入 &lt;回复xx&gt; 标签快捷按钮</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="setting-inline-reply-btn" ${this.storage.get('phone_inline_reply_btn') !== false ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <div class="setting-info">
                                <strong>使用说明：</strong><br>
                                1. 开启"互通模式"或"线上模式"<br>
                                2. 在对应APP设置中配置各功能提示词<br>
                                3. 在手机APP中发送消息，AI会自动回复
                            </div>
                            </div>
                        </details>

                        <details data-settings-fold-key="phone-settings-general-online-injection-open" ${isGeneralOnlineInjectionOpen ? 'open' : ''} style="margin: 8px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                            <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                                <span>📨 线上注入设置</span>
                                ${SETTINGS_FOLD_ARROW_HTML}
                            </summary>
                            <div style="padding: 10px 10px 4px;">

                            <div class="settings-subsection-title">📱 手机内微信线上聊天</div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 14px; color: #000;">正文上下文楼层</span>
                                <input type="number" id="phone-context-limit" min="0" max="9999"
                                       value="${readNonNegativeStorageNumber(this.storage, PHONE_CONTEXT_LIMIT_KEY, PHONE_CONTEXT_LIMIT_INITIAL_VALUE)}"
                                       style="width: 55px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 14px; color: #000;">单聊上下文条数</span>
                                <input type="number" id="wechat-single-chat-limit" min="0" max="9999"
                                       value="${readNonNegativeStorageNumber(this.storage, 'wechat-single-chat-limit', 200)}"
                                       style="width: 55px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 14px; color: #000;">群聊上下文条数</span>
                                <input type="number" id="wechat-group-chat-limit" min="0" max="9999"
                                       value="${readNonNegativeStorageNumber(this.storage, 'wechat-group-chat-limit', 200)}"
                                       style="width: 55px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 14px; color: #000;">单人通话内记录条数</span>
                                <input type="number" id="wechat-single-call-history-limit" min="0" max="9999"
                                       value="${readNonNegativeStorageNumber(this.storage, 'wechat-single-call-history-limit', 30)}"
                                       style="width: 55px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 14px; color: #000;">群通话内记录条数</span>
                                <input type="number" id="wechat-group-call-history-limit" min="0" max="9999"
                                       value="${readNonNegativeStorageNumber(this.storage, 'wechat-group-call-history-limit', 50)}"
                                       style="width: 55px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>
                            </div>
                        </details>

                        <details data-settings-fold-key="phone-settings-general-offline-injection-open" ${isGeneralOfflineInjectionOpen ? 'open' : ''} style="margin: 8px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                            <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                                <span>📴 线下注入设置</span>
                                ${SETTINGS_FOLD_ARROW_HTML}
                            </summary>
                            <div style="padding: 10px 10px 4px;">

                            <div class="settings-subsection-title">微信线下记录</div>

                            <div class="setting-item setting-toggle">
                                <div>
                                    <div class="setting-label">微信线下提示词注入</div>
                                    <div class="setting-desc">关闭后，只是不再把微信线下规则提示词注入酒馆正文；聊天记录注入仍按下方开关控制</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="offline-wechat-prompt-enabled" ${(!isWechatOnlineOnlyMode && this.storage.get('offline-wechat-prompt-enabled') !== false && this.storage.get('offline-wechat-prompt-enabled') !== 'false') ? 'checked' : ''} ${isWechatOnlineOnlyMode ? 'disabled' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <div class="setting-item setting-toggle">
                                <div>
                                    <div class="setting-label">微信单聊记录注入</div>
                                    <div class="setting-desc">关闭后，所有微信单聊记录都不会注入酒馆正文</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="offline-single-chat-enabled" ${(!isWechatOnlineOnlyMode && this.storage.get('offline-single-chat-enabled') !== false && this.storage.get('offline-single-chat-enabled') !== 'false') ? 'checked' : ''} ${isWechatOnlineOnlyMode ? 'disabled' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <div>
                                    <div class="setting-label">微信单聊注入条数</div>
                                    <div class="setting-desc">控制微信线上单聊记录注入酒馆正文的最近条数，不是蜜语专属</div>
                                </div>
                                <input type="number" id="offline-single-chat-limit" min="1" max="9999"
                                       value="${this.storage.get('offline-single-chat-limit') || 30}"
                                       style="width: 55px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>

                            <div class="setting-item setting-toggle">
                                <div>
                                    <div class="setting-label">微信群聊记录注入</div>
                                    <div class="setting-desc">关闭后，所有微信群聊记录都不会注入酒馆正文</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="offline-group-chat-enabled" ${(!isWechatOnlineOnlyMode && this.storage.get('offline-group-chat-enabled') !== false && this.storage.get('offline-group-chat-enabled') !== 'false') ? 'checked' : ''} ${isWechatOnlineOnlyMode ? 'disabled' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <div>
                                    <div class="setting-label">微信群聊注入条数</div>
                                    <div class="setting-desc">控制微信群聊记录注入酒馆正文的最近条数，不是蜜语专属</div>
                                </div>
                                <input type="number" id="offline-group-chat-limit" min="1" max="9999"
                                       value="${this.storage.get('offline-group-chat-limit') || 10}"
                                       style="width: 55px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>

                            <div class="setting-item setting-toggle">
                                <div>
                                    <div class="setting-label">蜜语来源微信会话参与注入</div>
                                    <div class="setting-desc">关闭后，标记为蜜语来源的微信会话不会注入酒馆正文；普通微信会话不受影响</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="offline-honey-chat-enabled" ${(this.storage.get('offline-honey-chat-enabled') === true || this.storage.get('offline-honey-chat-enabled') === 'true') ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <div class="settings-subsection-title">📓 其他线下记录</div>

                            <div class="setting-item setting-toggle">
                                <div>
                                    <div class="setting-label">电话通话记录注入线下</div>
                                    <div class="setting-desc">关闭后，电话通话记录不会注入酒馆正文</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="offline-phone-call-history-enabled" ${(this.storage.get('offline-phone-call-history-enabled') === true || this.storage.get('offline-phone-call-history-enabled') === 'true') ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <div>
                                    <div class="setting-label">电话通话记录条数</div>
                                    <div class="setting-desc">控制已接通电话的通话记录注入酒馆正文的最近条数</div>
                                </div>
                                <input type="number" id="phone-call-limit" min="1" max="9999"
                                       value="${this.storage.get('phone-call-limit') || 10}"
                                       style="width: 55px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>

                            <div class="setting-item setting-toggle">
                                <div>
                                    <div class="setting-label">微博记录注入线下</div>
                                    <div class="setting-desc">将用户最近发布的微博及对应评论注入到线下提示词</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="offline-weibo-history-enabled" ${this.storage.get('offline-weibo-history-enabled') ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <div>
                                    <div class="setting-label">最近微博条数</div>
                                    <div class="setting-desc">同时附带微博最新热搜条目，不注入热搜正文详情</div>
                                </div>
                                <input type="number" id="offline-weibo-history-limit" min="1" max="50"
                                       value="${this.storage.get('offline-weibo-history-limit') || 5}"
                                       style="width: 55px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>

                            <div class="setting-item setting-toggle">
                                <div>
                                    <div class="setting-label">日记记录注入线下</div>
                                    <div class="setting-desc">关闭后，{{DIARY_HISTORY}} 不会替换为日记内容；隐藏日记在最近篇数内也不会注入</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="offline-diary-history-enabled" ${(this.storage.get('offline-diary-history-enabled') === true || this.storage.get('offline-diary-history-enabled') === 'true') ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 14px; color: #000;">最近日记篇数</span>
                                <input type="number" id="offline-diary-history-limit" min="1" max="9999"
                                       value="${this.storage.get('offline-diary-history-limit') || 10}"
                                       style="width: 55px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>
                            </div>
                        </details>

                        <details data-settings-fold-key="phone-settings-general-personalization-open" ${isGeneralPersonalizationOpen ? 'open' : ''} style="margin: 8px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                            <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                                <span>🎨 个性化</span>
                                ${SETTINGS_FOLD_ARROW_HTML}
                            </summary>
                            <div style="padding: 10px 10px 4px;">

                            <div class="setting-item">
                                <div class="setting-toggle">
                                    <div>
                                        <div class="setting-label">桌面布局</div>
                                        <div class="setting-desc">图标布局为默认桌面；卡片布局显示桌面组件</div>
                                    </div>
                                    <select id="phone-home-layout" style="width: 112px; height: 34px; padding: 0 8px; border: 1px solid rgba(18, 24, 38, 0.12); border-radius: 10px; background: #f8fafc; color: #111827; font-size: 12px;">
                                        <option value="icons" ${homeLayout === 'icons' ? 'selected' : ''}>图标布局</option>
                                        <option value="cards" ${homeLayout === 'cards' ? 'selected' : ''}>卡片布局</option>
                                    </select>
                                </div>
                            </div>

                            <div class="setting-item">
                                <div class="setting-label">小手机整体大小</div>
                                <div class="setting-desc">调整整个小手机外壳和内容区域尺寸，电脑端和移动端都会生效</div>
                                <div class="phone-shell-scale-control">
                                    <input type="range"
                                           class="phone-gesture-control"
                                           id="phone-shell-scale-slider"
                                           min="${PHONE_SHELL_SCALE_MIN}"
                                           max="${PHONE_SHELL_SCALE_MAX}"
                                           step="1"
                                           value="${phoneShellScale}">
                                    <span id="phone-shell-scale-value" class="phone-shell-scale-value">${phoneShellScale}%</span>
                                    <button type="button" id="phone-shell-scale-reset" class="setting-btn" style="padding: 4px 10px; min-height: 30px; background: #f8fafc; border: 1px solid rgba(18,24,38,0.12); color: #374151; border-radius: 9px;">默认</button>
                                </div>
                            </div>

                            <div class="setting-item">
                                <div class="setting-toggle">
                                    <div>
                                        <div class="setting-label">手机边框颜色</div>
                                        <div class="setting-desc">调整小手机外壳边框颜色，默认黑色</div>
                                    </div>
                                    <input type="color"
                                           id="phone-frame-color-picker"
                                           value="${phoneFrameColor}"
                                           class="color-picker-input">
                                </div>
                            </div>

                            <!-- 壁纸设置 -->
                            <div class="setting-item">
                                <div class="setting-label">手机壁纸</div>
                                <div class="setting-desc">支持 jpg/png/webp，最大20MB；HEIC请先转为JPG/PNG</div>
                                <div style="margin-top: 10px; display: flex; gap: 8px;">
                                    <button type="button" id="choose-wallpaper-btn" class="setting-btn" style="padding: 6px 12px; font-size: 12px; background: rgba(255,255,255,0.6); backdrop-filter: blur(10px); border: 1px solid rgba(0,0,0,0.1); cursor: pointer; color: #333; border-radius: 6px;">
                                        <i class="fa-solid fa-upload"></i> 选择壁纸
                                    </button>
                                    <input type="file" id="upload-wallpaper" accept="image/png, image/jpeg, image/gif, image/webp, image/*" style="position: fixed; left: -9999px; top: -9999px; width: 1px; height: 1px; opacity: 0;">
                                    <button id="delete-wallpaper" class="setting-btn" style="padding: 6px 12px; font-size: 12px; background: rgba(255,255,255,0.6); backdrop-filter: blur(10px); border: 1px solid rgba(0,0,0,0.1); color: #999; border-radius: 6px;">
                                        <i class="fa-solid fa-trash"></i> 删除
                                    </button>
                                </div>
                                <div id="wallpaper-preview" style="margin-top: 10px; max-height: 100px; overflow: hidden; border-radius: 8px; ${wallpaper ? '' : 'display: none;'}">
                                    <img src="${wallpaper || ''}" style="width: 100%; height: auto; display: ${wallpaper ? 'block' : 'none'};">
                                </div>
                            </div>

                            <div class="setting-item">
                                <div class="setting-label">卡片布局时间图片</div>
                                <div class="setting-desc">用于卡片布局顶部时间区域；最大20MB，HEIC请先转为JPG/PNG</div>
                                <div style="margin-top: 10px; display: flex; gap: 8px;">
                                    <button type="button" id="choose-card-time-image-btn" class="setting-btn" style="padding: 6px 12px; font-size: 12px; background: rgba(255,255,255,0.6); backdrop-filter: blur(10px); border: 1px solid rgba(0,0,0,0.1); cursor: pointer; color: #333; border-radius: 6px;">
                                        <i class="fa-solid fa-upload"></i> 选择图片
                                    </button>
                                    <input type="file" id="upload-card-time-image" accept="image/png, image/jpeg, image/gif, image/webp, image/*" style="position: fixed; left: -9999px; top: -9999px; width: 1px; height: 1px; opacity: 0;">
                                    <button id="delete-card-time-image" class="setting-btn" style="padding: 6px 12px; font-size: 12px; background: rgba(255,255,255,0.6); backdrop-filter: blur(10px); border: 1px solid rgba(0,0,0,0.1); color: #999; border-radius: 6px;">
                                        <i class="fa-solid fa-trash"></i> 删除
                                    </button>
                                </div>
                                <div id="card-time-image-preview" style="margin-top: 10px; max-height: 100px; overflow: hidden; border-radius: 8px; ${cardTimeImage ? '' : 'display: none;'}">
                                    <img src="${cardTimeImage || ''}" style="width: 100%; height: auto; display: ${cardTimeImage ? 'block' : 'none'};">
                                </div>
                            </div>

                            <details class="setting-item app-name-custom-fold">
                                <summary>
                                    <span>
                                        <span class="setting-label">卡片式首页 CSS</span>
                                        <span class="setting-desc">给卡片布局写自定义 CSS，可隐藏原卡片或套贴纸样式</span>
                                    </span>
                                    ${SETTINGS_FOLD_ARROW_HTML}
                                </summary>
                                <textarea id="phone-card-layout-custom-css"
                                          spellcheck="false"
                                          placeholder="在这里写卡片式首页 CSS"
                                          style="width: 100%; min-height: 150px; max-height: 42vh; resize: vertical; box-sizing: border-box; margin-top: 10px; padding: 9px 10px; border: 1px solid #e0e0e0; border-radius: 9px; background: #fbfbfb; color: #111; font-size: 11px; line-height: 1.45; font-family: Consolas, Monaco, monospace;">${this._escapeHtml(cardLayoutCustomCss)}</textarea>
                                <div style="margin-top: 8px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
                                    <button type="button" id="save-card-layout-css" class="setting-btn" style="padding: 6px 8px; font-size: 12px; background: #07c160; border: none; color: #fff; border-radius: 6px;">
                                        保存
                                    </button>
                                    <button type="button" id="insert-card-layout-css-template" class="setting-btn" style="padding: 6px 8px; font-size: 12px; background: #f8fafc; border: 1px solid rgba(0,0,0,0.12); color: #374151; border-radius: 6px;">
                                        示例
                                    </button>
                                    <button type="button" id="clear-card-layout-css" class="setting-btn" style="padding: 6px 8px; font-size: 12px; background: rgba(255,255,255,0.88); border: 1px solid rgba(255,59,48,0.22); color: #d9342b; border-radius: 6px;">
                                        清空
                                    </button>
                                </div>
                            </details>

                            <!-- APP图标设置 -->
                            <div class="setting-item">
                                <div class="setting-label">自定义APP图标</div>
                                <div class="setting-desc">点击APP选择图片替换图标</div>
                                <div class="app-icon-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 10px;">
                                    ${this.renderAppIconUpload()}
                                </div>
                                <div style="margin-top: 10px;">
                                    <button id="reset-app-icons-and-cleanup" class="setting-btn" style="padding: 6px 12px; font-size: 12px; background: rgba(255,255,255,0.88); backdrop-filter: blur(10px); border: 1px solid rgba(255,59,48,0.22); color: #d9342b; border-radius: 6px;">
                                        <i class="fa-solid fa-rotate-left"></i> 恢复默认图标并清理上传
                                    </button>
                                    <div class="setting-desc" style="margin-top: 6px;">仅重置 APP 图标，尝试删除对应 /backgrounds 上传文件</div>
                                </div>
                            </div>

                            <details class="setting-item app-name-custom-fold">
                                <summary>
                                    <span>
                                        <span class="setting-label">自定义APP名称</span>
                                        <span class="setting-desc">仅修改桌面和设置里的显示名称，不影响功能和数据</span>
                                    </span>
                                    ${SETTINGS_FOLD_ARROW_HTML}
                                </summary>
                                <div class="app-name-custom-list">
                                    ${this.renderAppNameCustomization()}
                                </div>
                                <div style="margin-top: 10px; display: flex; gap: 8px;">
                                    <button id="save-app-custom-names" class="setting-btn" style="padding: 6px 12px; font-size: 12px; background: #07c160; border: none; color: #fff; border-radius: 6px;">
                                        <i class="fa-solid fa-check"></i> 保存名称
                                    </button>
                                    <button id="reset-app-custom-names" class="setting-btn" style="padding: 6px 12px; font-size: 12px; background: rgba(255,255,255,0.88); border: 1px solid rgba(0,0,0,0.12); color: #666; border-radius: 6px;">
                                        <i class="fa-solid fa-rotate-left"></i> 恢复默认
                                    </button>
                                </div>
                            </details>

                            <!-- 🔥 快捷栏设置 -->
                            <div class="setting-item">
                                <div class="setting-label">底部快捷栏</div>
                                <div class="setting-desc">选择4个应用显示在底部快捷栏</div>
                                <div class="dock-config-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 10px;">
                                    ${this.renderDockConfig()}
                                </div>
                            </div>
                            </div>
                        </details>

                        <details data-settings-fold-key="phone-settings-general-text-color-open" ${isGeneralTextColorOpen ? 'open' : ''} style="margin: 8px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                            <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                                <span>🎨 文字颜色</span>
                                ${SETTINGS_FOLD_ARROW_HTML}
                            </summary>
                            <div style="padding: 10px 10px 4px;">

                            <div class="setting-item">
                                <div class="setting-toggle">
                                    <div>
                                        <div class="setting-label">全局文字颜色</div>
                                        <div class="setting-desc">统一控制手机内所有文字的颜色</div>
                                    </div>
                                    <input type="color"
                                           id="global-text-color-picker"
                                           value="${globalTextColor}"
                                           class="color-picker-input">
                                </div>
                            </div>
                            </div>
                        </details>

                        <details data-settings-fold-key="phone-settings-general-time-open" ${isGeneralTimeOpen ? 'open' : ''} style="margin: 8px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                            <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                                <span>⏰ 时间管理</span>
                                ${SETTINGS_FOLD_ARROW_HTML}
                            </summary>
                            <div style="padding: 10px 10px 4px;">

                            <div class="setting-item">
                                <div>
                                    <div class="setting-label">当前剧情时间</div>
                                    <div class="setting-desc" id="current-phone-time">加载中...</div>
                                </div>
                            </div>

                            <div class="setting-item setting-button">
                                <button class="setting-btn" id="sync-time-btn" style="padding: 4px 10px; font-size: 11px; background: rgba(255,255,255,0.9); backdrop-filter: blur(8px); border: none; border-radius: 4px; color: #333; box-shadow: 0 1px 4px rgba(0,0,0,0.12);">
                                    从正文同步时间
                                </button>
                            </div>

                            <div class="setting-info">
                                💡 从酒馆正文最后一条消息抓取时间，同步到手机
                            </div>
                            </div>
                        </details>

                        <details data-settings-fold-key="phone-settings-general-data-open" ${isGeneralDataOpen ? 'open' : ''} style="margin: 8px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                            <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                                <span>💾 数据管理</span>
                                ${SETTINGS_FOLD_ARROW_HTML}
                            </summary>
                            <div style="padding: 10px 10px 4px;">

                            <div class="setting-item setting-button">
                                <button class="setting-btn" id="clear-current-data" style="padding: 4px 10px; font-size: 11px; background: rgba(255,255,255,0.9); backdrop-filter: blur(8px); border: none; border-radius: 4px; color: #ff9500; box-shadow: 0 1px 4px rgba(0,0,0,0.12);">
                                    清空当前角色数据
                                </button>
                            </div>

                            <div class="setting-item setting-button">
                                <button class="setting-btn" id="clear-all-data" style="padding: 4px 10px; font-size: 11px; background: rgba(255,255,255,0.9); backdrop-filter: blur(8px); border: none; border-radius: 4px; color: #ff3b30; box-shadow: 0 1px 4px rgba(0,0,0,0.12);">
                                    清空所有角色数据
                                </button>
                            </div>
                            </div>
                        </details>

                        <div class="setting-section" style="padding: 12px 14px; border-radius: 14px;">
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                                <div class="setting-label">版本</div>
                                <div class="setting-value phone-version-value">
                                    <span>v${window.VirtualPhone?.version || '未知'}</span>
                                    <button type="button" class="phone-version-info-btn" id="phone-version-info-btn" aria-label="查看当前版本更新内容" title="查看更新内容">
                                        <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
                                    </button>
                                </div>
                            </div>
                            <div class="setting-desc" style="margin-top: 8px;">
                                每个聊天会话窗口独立存储<br>
                                蜜语数据全局共享
                            </div>
                        </div>
                    </div>

                    <div class="phone-settings-tab-content ${this.currentTab === 'memory' ? 'is-active' : 'is-hidden'}" id="tab-memory">
                        ${this.renderMemoryPermissionSection()}
                        ${this.renderTagFilterSection()}
                    </div>

                    <div class="phone-settings-tab-content ${this.currentTab === 'llm' ? 'is-active' : 'is-hidden'}" id="tab-llm">
                        <!-- 🤖 大模型 API 配置 (独立聊天) -->
                        <div class="setting-section">
                            <div class="setting-section-title">🤖 大模型 API 配置</div>

                            <div class="setting-item setting-toggle">
                                <div>
                                    <div class="setting-label">启用手机独立 API</div>
                                    <div class="setting-desc">开启后手机回复不走酒馆，极大提升速度并防止串味</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="phone-api-enabled">
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <div id="phone-api-details" style="display: none; padding: 10px; background: #f9f9f9; border-top: 1px solid #f0f0f0;">
                                <div style="margin-bottom: 12px;">
                                    <div style="font-size: 12px; color: #666; margin-bottom: 4px;">API 预设</div>
                                    <select id="phone-api-profile-select" style="width: 100%; padding: 8px; border: 1px solid #e0e0e0; border-radius: 6px; font-size: 13px; background: #fff; box-sizing: border-box;">
                                        <option value="">-- 选择预设 --</option>
                                    </select>
                                    <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 8px;">
                                        <button id="phone-api-profile-save-current" style="padding: 8px 4px; background: #fff; color: #333; border: 1px solid #dcdfe6; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;">保存当前</button>
                                        <button id="phone-api-profile-save" style="padding: 8px 4px; background: #fff; color: #333; border: 1px solid #dcdfe6; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;">新建预设</button>
                                        <button id="phone-api-profile-delete" style="padding: 8px 4px; background: #fff; color: #d93025; border: 1px solid #f1c7c3; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;">删除预设</button>
                                    </div>
                                </div>

                                <div style="margin-bottom: 12px; padding: 10px; background: #fff; border: 1px solid #ececec; border-radius: 8px;">
                                    <div style="font-size: 12px; color: #333; font-weight: 700; margin-bottom: 4px;">App API 路由</div>
                                    <div style="font-size: 11px; color: #888; line-height: 1.5; margin-bottom: 8px;">可让蜜语、微信分别使用不同 API 预设；不选则使用上方当前预设。</div>
                                    <div style="display: grid; grid-template-columns: 54px 1fr; gap: 8px; align-items: center; margin-bottom: 8px;">
                                        <div style="font-size: 12px; color: #666;">微信</div>
                                        <select id="phone-api-route-wechat" data-api-route-app="wechat" style="width: 100%; padding: 7px; border: 1px solid #e0e0e0; border-radius: 6px; font-size: 12px; background: #fff; box-sizing: border-box;">
                                            <option value="">跟随当前预设</option>
                                        </select>
                                    </div>
                                    <div style="display: grid; grid-template-columns: 54px 1fr; gap: 8px; align-items: center;">
                                        <div style="font-size: 12px; color: #666;">蜜语</div>
                                        <select id="phone-api-route-honey" data-api-route-app="honey" style="width: 100%; padding: 7px; border: 1px solid #e0e0e0; border-radius: 6px; font-size: 12px; background: #fff; box-sizing: border-box;">
                                            <option value="">跟随当前预设</option>
                                        </select>
                                    </div>
                                </div>

                                <div style="margin-bottom: 12px;">
                                    <div style="font-size: 12px; color: #666; margin-bottom: 4px;">API 提供商</div>
                                    <select id="phone-api-provider" style="width: 100%; padding: 8px; border: 1px solid #e0e0e0; border-radius: 6px; font-size: 13px; background: #fff;">
                                        <option value="openai">OpenAI 官方</option>
                                        <option value="proxy_only">OpenAI 兼容反代 / Build 本地</option>
                                        <option value="compatible">OP兼容端点 / 中转站（推荐）</option>
                                        <option value="deepseek">DeepSeek 官方</option>
                                        <option value="claude">Claude 官方</option>
                                        <option value="gemini">Google Gemini 官方</option>
                                        <option value="siliconflow">硅基流动</option>
                                        <option value="local">本地/内网</option>
                                    </select>
                                </div>

                                <div style="margin-bottom: 12px;">
                                    <div style="font-size: 12px; color: #666; margin-bottom: 4px;">API 地址 (Base URL)</div>
                                    <input type="text" id="phone-api-url" placeholder="例如: https://api.openai.com/v1" style="width: 100%; padding: 8px; border: 1px solid #e0e0e0; border-radius: 6px; font-size: 13px; background: #fff; box-sizing: border-box;">
                                </div>

                                <div style="margin-bottom: 12px;">
                                    <div style="font-size: 12px; color: #666; margin-bottom: 4px;">API 密钥 (Key)</div>
                                    <div style="display: flex; align-items: center; width: 100%; border: 1px solid #e0e0e0; border-radius: 6px; background: #fff; box-sizing: border-box; overflow: hidden;">
                                        <input type="password" id="phone-api-key" placeholder="sk-..." style="flex: 1; min-width: 0; padding: 8px 4px 8px 8px; border: none; outline: none; font-size: 13px; background: transparent; box-sizing: border-box;">
                                        <button type="button" class="phone-password-toggle" data-toggle-password-target="phone-api-key" aria-label="显示或隐藏 API Key" style="width: 32px; align-self: stretch; border: none; background: transparent; color: #777; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; flex-shrink: 0;">
                                            <i class="fa-solid fa-eye"></i>
                                        </button>
                                    </div>
                                </div>

                                <div style="margin-bottom: 12px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                        <div style="font-size: 12px; color: #666;">模型名称 (Model)</div>
                                        <button id="phone-api-fetch-models" style="background: none; border: 1px solid #07c160; color: #07c160; border-radius: 4px; padding: 2px 8px; font-size: 11px; cursor: pointer;">🔄 拉取列表</button>
                                    </div>
                                    <input type="text" id="phone-api-model" placeholder="例如: gpt-4o" style="width: 100%; padding: 8px; border: 1px solid #e0e0e0; border-radius: 6px; font-size: 13px; background: #fff; box-sizing: border-box;">
                                    <select id="phone-api-model-select" style="display:none; width: 100%; padding: 8px; border: 1px solid #e0e0e0; border-radius: 6px; font-size: 13px; background: #fff; box-sizing: border-box; margin-top: 5px;"></select>
                                </div>

                                <div style="display: flex; gap: 10px; margin-bottom: 12px;">
                                    <div style="flex: 1;">
                                        <div style="font-size: 12px; color: #666; margin-bottom: 4px;">最大输出 (Tokens)</div>
                                        <input type="number" id="phone-api-tokens" value="8192" style="width: 100%; padding: 8px; border: 1px solid #e0e0e0; border-radius: 6px; font-size: 13px; background: #fff; box-sizing: border-box;">
                                    </div>
                                    <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; padding-top: 14px;">
                                        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #333;">
                                            <input type="checkbox" id="phone-api-stream" checked style="width: 16px; height: 16px;"> 开启流式传输
                                        </label>
                                    </div>
                                </div>

                                <div style="display: flex; gap: 10px; margin-top: 15px;">
                                    <button id="phone-api-test" style="flex: 1; padding: 10px; background: #e3f2fd; color: #1976d2; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;">🧪 测试连接</button>
                                    <button id="phone-api-save" style="flex: 1; padding: 10px; background: #07c160; color: #fff; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;">💾 保存配置</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="phone-settings-tab-content ${this.currentTab === 'tts' ? 'is-active' : 'is-hidden'}" id="tab-tts">
                        <!-- 🔊 语音功能 (TTS) -->
                        <div class="tts-section-list">
                            <details data-tts-fold-key="phone-tts-minimax-section-open" ${isTtsMiniMaxSectionOpen ? 'open' : ''} style="margin: 12px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                                <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                                    <span>通用 TTS / MiMo</span>
                                    ${SETTINGS_FOLD_ARROW_HTML}
                                </summary>
                                <div style="padding: 10px 10px 4px;">
                                    <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                        <span style="font-size: 14px; color: #000;">TTS 服务商</span>
                                        <select id="phone-tts-provider" style="width: 140px; height: 30px; padding: 0 4px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 11px; background: #fafafa;">
                                            ${renderTtsProviderOptions(currentTtsProvider)}
                                        </select>
                                    </div>

                                    <div class="setting-item">
                                        <div style="display: flex; align-items: center; justify-content: space-between;">
                                            <span style="font-size: 14px; color: #000;">API 接口地址</span>
                                            <select id="phone-tts-url-preset" style="width: 140px; height: 30px; padding: 0 4px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 11px; background: #fafafa;">
                                                <option value="">-- 快速选择 --</option>
                                                <option value="https://api.minimaxi.com/v1/t2a_v2">MiniMax 国内版</option>
                                                <option value="https://api.minimax.io/v1/t2a_v2">MiniMax 国际版</option>
                                                <option value="https://api.openai.com/v1/audio/speech">OpenAI 官方</option>
                                                <option value="http://127.0.0.1:7880/v1/audio/speech">IndexTTS 本地</option>
                                                <option value="https://api.xiaomimimo.com/v1">MiMo 官方</option>
                                                <option value="__nimo_public__">MiMo 公益站 / New API</option>
                                                <option value="https://openspeech.bytedance.com/api/v3/tts/unidirectional">火山引擎/豆包</option>
                                            </select>
                                        </div>
                                        <input type="text" id="phone-tts-url"
                                               value="${currentTtsUrl}"
                                               placeholder="本地 IndexTTS 例如 http://127.0.0.1:7880/v1/audio/speech"
                                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; margin-top: 6px; box-sizing: border-box;">
                                        <div class="setting-desc" style="margin-top: 6px;">IndexTTS 本地请先启动「启动api服务.bat」，接口为 http://127.0.0.1:7880/v1/audio/speech；音色文件放在整合包 api/ckyp 目录。</div>
                                    </div>

                                    <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                        <span style="font-size: 14px; color: #000;">API Key</span>
                                        <input type="password" id="phone-tts-key"
                                               value="${currentTtsKey}"
                                               placeholder="MiniMax/OpenAI/MiMo API Key"
                                               style="width: 140px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                                    </div>

                                    <div class="setting-item">
                                        <div style="display: flex; align-items: center; justify-content: space-between;">
                                            <span style="font-size: 14px; color: #000;">语音模型</span>
                                            <div style="display: flex; align-items: center; gap: 6px;">
                                                <button id="phone-tts-fetch-models" type="button" style="height: 30px; padding: 0 8px; border: 1px solid #1677ff; border-radius: 8px; background: #fff; color: #1677ff; font-size: 11px; cursor: pointer; white-space: nowrap;">拉取模型</button>
                                                <select id="phone-tts-model-preset" style="width: 110px; height: 30px; padding: 0 4px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 11px; background: #fafafa;">
                                                    <option value="">-- 快速选择 --</option>
                                                </select>
                                            </div>
                                        </div>
                                        <input type="text" id="phone-tts-model"
                                               value="${currentTtsModel}"
                                               placeholder="选择预设或手动输入模型名"
                                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; margin-top: 6px; box-sizing: border-box;">
                                        <div id="phone-tts-models-result" class="setting-desc" style="margin-top: 6px;">MiMo 公益站可从当前站点 /v1/models 拉取可用模型。</div>
                                    </div>

                                    <div class="setting-item">
                                        <div style="display: flex; align-items: center; justify-content: space-between;">
                                            <span style="font-size: 14px; color: #000;">MiMo Worker 中转</span>
                                        </div>
                                        <input type="text" id="phone-tts-nimo-relay-url"
                                               value="${currentTtsNimoRelayUrl}"
                                               placeholder="例如 https://xxx.workers.dev"
                                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; margin-top: 6px; box-sizing: border-box;">
                                        <div class="setting-desc" style="margin-top: 6px;">公益站若未开放 CORS，浏览器无法直连试听。部署 workers/mimo-tts-relay-worker.js 后把地址填在这里，模型拉取、普通 TTS 和 MiMo 复刻都会经 Worker 转发。</div>
                                    </div>

                                    <div class="setting-item">
                                        <div style="display: flex; align-items: center; justify-content: space-between;">
                                            <span style="font-size: 14px; color: #000;">音色 ID (Voice)</span>
                                            <select id="phone-tts-voice-preset" style="width: 140px; height: 30px; padding: 0 4px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 11px; background: #fafafa;">
                                                <option value="">-- 历史音色 --</option>
                                            </select>
                                        </div>
                                        <input type="text" id="phone-tts-voice"
                                               value="${currentTtsVoice}"
                                               placeholder="IndexTTS 填 api/ckyp 下的文件名，例如 default.wav"
                                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; margin-top: 6px; box-sizing: border-box;">
                                        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
                                            <button id="phone-tts-preview" style="padding: 2px 8px; border: none; background: none; color: #1677ff; font-size: 10px; cursor: pointer;">试听当前音色</button>
                                            <button id="phone-tts-voice-delete" style="padding: 2px 8px; border: none; background: none; color: #ff3b30; font-size: 10px; cursor: pointer;">删除当前音色</button>
                                        </div>
                                    </div>

                                    <div style="height: 1px; background: #ececec; margin: 10px 0;"></div>

                                    <div class="setting-item">
                                        <div style="font-size: 13px; font-weight: 700; color: #333; margin-bottom: 8px;">MiMo 服务端复刻</div>
                                        <div class="setting-desc" style="margin-bottom: 8px;">上传参考音频后会保存到酒馆，再用 mimo-v2.5-tts-voiceclone 通过 /v1/chat/completions 发送 data:audio;base64 复刻。公益站必须兼容 MiMo 官方 chat 协议。</div>

                                        <input type="text" id="phone-tts-nimo-clone-nick"
                                               placeholder="复刻音色备注，例如：角色A参考音"
                                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-bottom: 8px;">

                                        <input type="file" id="phone-tts-nimo-clone-audio" accept=".wav,.mp3,audio/wav,audio/mpeg" style="display: none;">
                                        <div style="display: grid; grid-template-columns: 120px 1fr; gap: 8px; align-items: center; margin-bottom: 8px;">
                                            <button id="phone-tts-nimo-clone-audio-pick" style="height: 30px; border: 1px solid #d8d8d8; border-radius: 8px; background: #fafafa; color: #222; font-size: 12px; cursor: pointer;">选择参考音频</button>
                                            <div id="phone-tts-nimo-clone-audio-name" style="min-width: 0; color: #999; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">未选择文件</div>
                                        </div>
                                        <button id="phone-tts-nimo-clone-save" style="width: 100%; height: 30px; border: 1px solid #d8d8d8; border-radius: 8px; background: #fafafa; color: #222; font-size: 12px; cursor: pointer;">上传并设为 MiMo 复刻音色</button>
                                        <div id="phone-tts-nimo-clone-result" class="setting-desc" style="margin-top: 8px; min-height: 16px;"></div>
                                    </div>
                                </div>
                            </details>

                            <details data-tts-fold-key="phone-tts-volc-section-open" ${isTtsVolcSectionOpen ? 'open' : ''} style="margin: 8px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                                <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                                    <span>火山引擎（豆包）</span>
                                    ${SETTINGS_FOLD_ARROW_HTML}
                                </summary>
                                <div style="padding: 10px 10px 4px;">
                                    <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                        <span style="font-size: 14px; color: #000;">Access Token</span>
                                        <input type="password" id="phone-tts-volc-key"
                                               value="${volcTtsKey}"
                                               placeholder="豆包 Access Token"
                                               style="width: 140px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                                    </div>

                                    <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                        <span style="font-size: 14px; color: #000;">火山 APP ID</span>
                                        <input type="text" id="phone-tts-volc-app-id"
                                               value="${currentTtsVolcAppId}"
                                               placeholder="仅豆包需要"
                                               style="width: 140px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                                    </div>

                                    <div class="setting-item">
                                        <div style="display: flex; align-items: center; justify-content: space-between;">
                                            <span style="font-size: 14px; color: #000;">Resource ID</span>
                                            <input type="text" id="phone-tts-volc-resource-id"
                                                   value="${currentTtsVolcResourceId}"
                                                   placeholder="豆包模型资源ID"
                                                   style="width: 140px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                                        </div>
                                        <div class="setting-desc" style="margin-top: 6px;">豆包的 Access Token 填上方密钥栏；官方预置音色通常用 seed-tts-2.0，复刻音色（一般为 S_ 开头）需用 seed-icl-2.0。检测到 S_ 复刻音色且仍填 seed-tts-* 时，播放会自动改用 seed-icl-2.0。</div>
                                    </div>

                                    <div class="setting-item">
                                        <div style="display: flex; align-items: center; justify-content: space-between;">
                                            <span style="font-size: 14px; color: #000;">音色 ID (Voice)</span>
                                            <select id="phone-tts-volc-voice-preset" style="width: 140px; height: 30px; padding: 0 4px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 11px; background: #fafafa;">
                                                <option value="">-- 历史音色 --</option>
                                                ${volcTtsVoiceHistory.map(v => `<option value="${v}">${v}</option>`).join('')}
                                            </select>
                                        </div>
                                        <div style="display: flex; gap: 6px; margin-top: 6px;">
                                            <input type="text" id="phone-tts-volc-voice"
                                                   value="${volcTtsVoice}"
                                                   placeholder="输入默认音色或 S_ 复刻音色"
                                                   style="flex: 1; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box;">
                                        </div>
                                        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
                                            <span style="font-size: 10px; color: #999;">填写后自动记入历史列表</span>
                                            <button id="phone-tts-volc-voice-delete" style="padding: 2px 8px; border: none; background: none; color: #ff3b30; font-size: 10px; cursor: pointer;">删除当前音色</button>
                                        </div>
                                        <button id="phone-tts-volc-preview" style="width: 100%; height: 30px; margin-top: 8px; border: 1px solid #d8d8d8; border-radius: 8px; background: #fafafa; color: #222; font-size: 12px; cursor: pointer;">试听当前豆包音色</button>
                                    </div>

                                    <div style="height: 1px; background: #ececec; margin: 10px 0;"></div>

                                    <div class="setting-item">
                                        <div style="font-size: 13px; font-weight: 700; color: #333; margin-bottom: 8px;">豆包音色复刻</div>
                                        <div class="setting-desc" style="margin-bottom: 8px;">复刻会把音频上传到火山/豆包云端，并消耗复刻音色额度；训练成功后可直接设为当前音色调用。</div>

                                        <input type="text" id="phone-tts-volc-clone-worker-url"
                                               value="${currentTtsVolcCloneWorkerUrl}"
                                               placeholder="Worker 地址，例：https://xxx.workers.dev"
                                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-bottom: 8px;">
                                        <div class="setting-desc" style="margin-bottom: 8px;">建议填写自己搭建的 Worker 地址。</div>

                                        <input type="password" id="phone-tts-volc-clone-access-token"
                                               value="${currentTtsVolcCloneAccessToken}"
                                               placeholder="复刻 Access Token，空着则使用上方豆包 Token"
                                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-bottom: 8px;">

                                        <input type="text" id="phone-tts-volc-clone-app-id"
                                               value="${currentTtsVolcCloneAppId}"
                                               placeholder="复刻 APP ID，空着则使用上方火山 APP ID"
                                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-bottom: 8px;">

                                        <input type="text" id="phone-tts-volc-clone-speaker-id"
                                               value="${volcTtsVoice && /^S_[A-Za-z0-9_-]+$/.test(volcTtsVoice) ? volcTtsVoice : ''}"
                                               placeholder="S_ 开头的 Speaker ID 槽位"
                                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-bottom: 8px;">

                                        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                                            <select id="phone-tts-volc-clone-model-type" style="flex: 1; min-width: 0; height: 30px; padding: 0 6px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                                                <option value="4">ICL 2.0</option>
                                                <option value="1">ICL 1.0</option>
                                                <option value="2">DiT 标准</option>
                                                <option value="3">DiT 还原</option>
                                            </select>
                                            <select id="phone-tts-volc-clone-language" style="flex: 1; min-width: 0; height: 30px; padding: 0 6px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                                                <option value="0">中文</option>
                                                <option value="1">英文</option>
                                                <option value="2">日语</option>
                                            </select>
                                        </div>

                                        <div style="font-size: 12px; color: #333; margin-bottom: 6px;">音频文件</div>
                                        <input type="file" id="phone-tts-volc-clone-audio" accept=".wav,.mp3,.m4a,.ogg,.aac" style="display: none;">
                                        <div style="display: grid; grid-template-columns: 120px 1fr; gap: 8px; align-items: center; margin-bottom: 8px;">
                                            <button id="phone-tts-volc-clone-audio-pick" style="height: 30px; border: 1px solid #d8d8d8; border-radius: 8px; background: #fafafa; color: #222; font-size: 12px; cursor: pointer;">选择音频文件</button>
                                            <div id="phone-tts-volc-clone-audio-name" style="min-width: 0; color: #999; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">未选择文件</div>
                                        </div>
                                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                                            <button id="phone-tts-volc-clone-upload" style="height: 30px; border: 1px solid #d8d8d8; border-radius: 8px; background: #fafafa; color: #222; font-size: 12px; cursor: pointer;">上传复刻</button>
                                            <button id="phone-tts-volc-clone-status" style="height: 30px; border: 1px solid #d8d8d8; border-radius: 8px; background: #fafafa; color: #222; font-size: 12px; cursor: pointer;">查询状态</button>
                                        </div>
                                        <button id="phone-tts-volc-clone-use" style="width: 100%; height: 30px; margin-top: 8px; border: 1px solid #d8d8d8; border-radius: 8px; background: #fafafa; color: #222; font-size: 12px; cursor: pointer;">设为当前音色</button>
                                        <div id="phone-tts-volc-clone-result" class="setting-desc" style="margin-top: 8px; min-height: 16px;"></div>
                                    </div>
                                </div>
                            </details>

                            <details data-tts-fold-key="phone-tts-fallback-section-open" ${isTtsFallbackSectionOpen ? 'open' : ''} style="margin: 8px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                                <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                                    <span>全局兜底音色</span>
                                    ${SETTINGS_FOLD_ARROW_HTML}
                                </summary>
                                <div style="padding: 10px 10px 4px;">
                                    <div class="setting-desc" style="margin-bottom: 10px;">联系人或蜜语主播没有绑定专属音色时，会按角色性别调用这里的男/女兜底音色。</div>
                                    <div class="setting-item" style="margin-top: 0;">
                                        <div style="font-size: 13px; font-weight: 700; color: #333; margin-bottom: 8px;">男声兜底</div>
                                        <select id="phone-tts-fallback-male-provider" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box;">
                                            ${renderTtsProviderOptions(fallbackMaleProvider)}
                                        </select>
                                        <input type="text" id="phone-tts-fallback-male-voice"
                                               value="${this._escapeHtml(fallbackMaleVoice)}"
                                               placeholder="男声音色 ID"
                                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; margin-top: 6px; box-sizing: border-box;">
                                        <button id="phone-tts-fallback-male-preview" style="width: 100%; height: 30px; margin-top: 8px; border: 1px solid #d8d8d8; border-radius: 8px; background: #fafafa; color: #222; font-size: 12px; cursor: pointer;">试听男声兜底</button>
                                    </div>
                                    <div class="setting-item">
                                        <div style="font-size: 13px; font-weight: 700; color: #333; margin-bottom: 8px;">女声兜底</div>
                                        <select id="phone-tts-fallback-female-provider" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box;">
                                            ${renderTtsProviderOptions(fallbackFemaleProvider)}
                                        </select>
                                        <input type="text" id="phone-tts-fallback-female-voice"
                                               value="${this._escapeHtml(fallbackFemaleVoice)}"
                                               placeholder="女声音色 ID"
                                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; margin-top: 6px; box-sizing: border-box;">
                                        <button id="phone-tts-fallback-female-preview" style="width: 100%; height: 30px; margin-top: 8px; border: 1px solid #d8d8d8; border-radius: 8px; background: #fafafa; color: #222; font-size: 12px; cursor: pointer;">试听女声兜底</button>
                                    </div>
                                </div>
                            </details>

                            <details data-tts-fold-key="phone-tts-wechat-section-open" ${isTtsWechatSectionOpen ? 'open' : ''} style="margin: 8px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                                <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                                    <span>微信语音/视频通话</span>
                                    ${SETTINGS_FOLD_ARROW_HTML}
                                </summary>
                                <div style="padding: 10px 10px 4px;">
                                    <div class="setting-item setting-toggle" style="margin-top: 0;">
                                        <div>
                                            <div class="setting-label">自动播报</div>
                                            <div class="setting-desc">开启后，微信通话中 AI 回复会自动播放绑定音色</div>
                                        </div>
                                        <label class="toggle-switch">
                                            <input type="checkbox" id="wechat-call-auto-tts" ${this.storage.get('wechat-call-auto-tts') ? 'checked' : ''}>
                                            <span class="toggle-slider"></span>
                                        </label>
                                    </div>
                                </div>
                            </details>

                            <details data-tts-fold-key="phone-tts-honey-section-open" ${isTtsHoneySectionOpen ? 'open' : ''} style="margin: 8px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                                <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                                    <span>蜜语 TTS 配置</span>
                                    ${SETTINGS_FOLD_ARROW_HTML}
                                </summary>
                                <div class="setting-item" style="margin-top: 0; padding: 10px 10px 4px;">

                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                    <span style="font-size: 13px; color: #222;">启用剧情语音</span>
                                    <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #666;">
                                        <input type="checkbox" id="phone-honey-tts-enabled" ${this.storage.get('phone-honey-tts-enabled') ? 'checked' : ''} style="width: 16px; height: 16px;">
                                        开启
                                    </label>
                                </div>

                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                    <span style="font-size: 13px; color: #222;">播报模式</span>
                                    <select id="phone-honey-tts-mode" style="width: 140px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                                        <option value="full" ${(this.storage.get('phone-honey-tts-mode') || 'full') === 'full' ? 'selected' : ''}>全文本</option>
                                        <option value="quotes" ${(this.storage.get('phone-honey-tts-mode') || 'full') === 'quotes' ? 'selected' : ''}>仅双引号内容</option>
                                    </select>
                                </div>

                                <div style="display: flex; align-items: center; justify-content: space-between;">
                                    <span style="font-size: 13px; color: #222;">音频缓存</span>
                                    <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #666;">
                                        <input type="checkbox" id="phone-honey-tts-cache-enabled" ${this.storage.get('phone-honey-tts-cache-enabled') === false ? '' : 'checked'} style="width: 16px; height: 16px;">
                                        开启
                                    </label>
                                </div>
                            </div>
                            </details>
                        </div>
                    </div>

                <div class="phone-settings-tab-content ${this.currentTab === 'image' ? 'is-active' : 'is-hidden'}" id="tab-image">
                        ${this.renderImageGenerationSection()}
                    </div>
                    ${isLobbyMode
                        ? `<div class="phone-settings-tab-content ${this.currentTab === 'lobby' ? 'is-active' : 'is-hidden'}" id="tab-lobby">
                            ${this.renderLobbyLinkSection(context)}
                        </div>`
                        : ''}
                </div>
            </div>
        `;

        this.phoneShell.setContent(html);
        this.bindEvents();
    }

    _getImagePromptAppDefs() {
        return [
            { id: 'honey', name: '蜜语' },
            { id: 'wechat', name: '微信' },
            { id: 'weibo', name: '微博' },
            { id: 'diary', name: '日记' }
        ];
    }

    _normalizeImagePromptApp(app) {
        const value = String(app || '').trim().toLowerCase();
        return this._getImagePromptAppDefs().some(def => def.id === value) ? value : 'honey';
    }

    _normalizeImagePresetScope(app) {
        const appKey = this._normalizeImagePromptApp(app);
        return appKey === 'diary' ? 'wechat' : appKey;
    }

    _getImageProviderAppBindings() {
        const raw = this.storage.get('phone-image-provider-app-bindings');
        let parsed = {};
        try {
            parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
        } catch (e) {
            parsed = {};
        }

        const allowedProviders = new Set(['novelai', 'openai', 'siliconflow', 'sd', 'comfyui']);
        const bindings = {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            this._getImagePromptAppDefs().forEach((def) => {
                const provider = String(parsed[def.id] || '').trim().toLowerCase();
                if (allowedProviders.has(provider)) bindings[def.id] = provider;
            });
        }
        return bindings;
    }

    _renderImageProviderAppBinding(providerKey, bindings = this._getImageProviderAppBindings()) {
        const safeProvider = String(providerKey || '').trim().toLowerCase();
        const options = this._getImagePromptAppDefs().map((def) => {
            const safeApp = this._escapeHtml(def.id);
            const safeName = this._escapeHtml(def.name);
            const checked = bindings?.[def.id] === safeProvider ? 'checked' : '';
            return `
                <label style="display:flex; align-items:center; gap:5px; min-width:0; font-size:12px; color:#222;">
                    <input type="checkbox" class="phone-image-provider-app-bind" data-provider="${this._escapeHtml(safeProvider)}" data-app="${safeApp}" ${checked}>
                    <span>${safeName}</span>
                </label>
            `;
        }).join('');

        return `
            <div class="setting-item phone-image-provider-app-binding" data-provider-binding-panel="${this._escapeHtml(safeProvider)}">
                <div class="setting-label">固定 App 绑定</div>
                <div class="setting-desc">勾选后，对应 App 生图优先使用本供应商配置；未绑定的 App 继续使用上面的全局供应商。</div>
                <div style="display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:8px; margin-top:8px;">
                    ${options}
                </div>
            </div>
        `;
    }

    _getImagePromptDraft(app) {
        const appKey = this._normalizeImagePresetScope(app);
        return {
            fixedPrompt: String(this.storage.get(`phone-image-${appKey}-fixed-prompt`) || ''),
            fixedPromptEnd: String(this.storage.get(`phone-image-${appKey}-fixed-prompt-end`) || ''),
            negativePrompt: String(this.storage.get(`phone-image-${appKey}-negative-prompt`) || '')
        };
    }

    _getImagePromptPresetMap() {
        const raw = this.storage.get('phone-image-prompt-presets-by-app');
        let parsed = {};
        try {
            parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
        } catch (e) {
            parsed = {};
        }
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }

    _normalizeImagePromptPresets(presets = []) {
        const seen = new Set();
        return (Array.isArray(presets) ? presets : []).map((preset) => {
            const id = String(preset?.id || '').trim();
            const name = String(preset?.name || '').trim();
            if (!id || !name || seen.has(id)) return null;
            seen.add(id);
            return {
                id,
                name,
                fixedPrompt: String(preset?.fixedPrompt || ''),
                fixedPromptEnd: String(preset?.fixedPromptEnd || ''),
                negativePrompt: String(preset?.negativePrompt || ''),
                novelaiModel: String(preset?.novelaiModel || preset?.model || ''),
                novelaiSampler: String(preset?.novelaiSampler || preset?.sampler || ''),
                novelaiSchedule: String(preset?.novelaiSchedule || preset?.schedule || ''),
                honeyWidth: preset?.honeyWidth,
                honeyHeight: preset?.honeyHeight,
                wechatWidth: preset?.wechatWidth,
                wechatHeight: preset?.wechatHeight,
                weiboWidth: preset?.weiboWidth,
                weiboHeight: preset?.weiboHeight,
                diaryWidth: preset?.diaryWidth,
                diaryHeight: preset?.diaryHeight,
                width: preset?.width,
                height: preset?.height,
                steps: preset?.steps,
                scale: preset?.scale,
                cfgRescale: preset?.cfgRescale,
                seed: preset?.seed,
                updatedAt: Number(preset?.updatedAt || 0) || Date.now()
            };
        }).filter(Boolean);
    }

    _getImagePromptPresets(app = 'honey') {
        const appKey = this._normalizeImagePresetScope(app);
        const presetMap = this._getImagePromptPresetMap();
        if (Array.isArray(presetMap[appKey])) {
            return this._normalizeImagePromptPresets(presetMap[appKey]);
        }

        const rawGlobal = this.storage.get('phone-image-prompt-presets');
        let globalPresets = null;
        try {
            globalPresets = typeof rawGlobal === 'string' ? JSON.parse(rawGlobal || '[]') : rawGlobal;
        } catch (e) {
            globalPresets = null;
        }
        if (appKey === 'honey' && Array.isArray(globalPresets)) {
            return this._normalizeImagePromptPresets(globalPresets);
        }

        return [];
    }

    async _saveImagePromptPresets(app, presets) {
        const appKey = this._normalizeImagePresetScope(app);
        const normalized = this._normalizeImagePromptPresets(presets);
        const presetMap = this._getImagePromptPresetMap();
        presetMap[appKey] = normalized;
        await this.storage.set('phone-image-prompt-presets-by-app', JSON.stringify(presetMap));
        if (appKey === 'honey') {
            await this.storage.set('phone-image-prompt-presets', JSON.stringify(normalized));
        }
    }

    _normalizeOpenAIImagePresets(presets = []) {
        const seen = new Set();
        return (Array.isArray(presets) ? presets : []).map((preset) => {
            const id = String(preset?.id || '').trim();
            const name = String(preset?.name || '').trim();
            if (!id || !name || seen.has(id)) return null;
            seen.add(id);
            return {
                id,
                name,
                fixedPrompt: String(preset?.fixedPrompt || ''),
                fixedPromptEnd: String(preset?.fixedPromptEnd || ''),
                negativePrompt: String(preset?.negativePrompt || ''),
                openaiModel: String(preset?.openaiModel || preset?.model || '').trim(),
                openaiMode: 'images',
                openaiQuality: String(preset?.openaiQuality || 'auto').trim() || 'auto',
                honeyWidth: preset?.honeyWidth,
                honeyHeight: preset?.honeyHeight,
                wechatWidth: preset?.wechatWidth,
                wechatHeight: preset?.wechatHeight,
                weiboWidth: preset?.weiboWidth,
                weiboHeight: preset?.weiboHeight,
                diaryWidth: preset?.diaryWidth,
                diaryHeight: preset?.diaryHeight,
                width: preset?.width,
                height: preset?.height,
                updatedAt: Number(preset?.updatedAt || 0) || Date.now()
            };
        }).filter(Boolean);
    }

    _getOpenAIImagePresets() {
        const raw = this.storage.get('phone-image-openai-presets');
        let presets = [];
        try {
            presets = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
        } catch (e) {
            presets = [];
        }
        return this._normalizeOpenAIImagePresets(presets);
    }

    async _saveOpenAIImagePresets(presets) {
        await this.storage.set('phone-image-openai-presets', JSON.stringify(this._normalizeOpenAIImagePresets(presets)));
    }

    _normalizeComfyUIWorkflows(workflows = []) {
        const seen = new Set();
        return (Array.isArray(workflows) ? workflows : []).map((workflow) => {
            const id = String(workflow?.id || '').trim();
            const name = String(workflow?.name || '').trim();
            const workflowText = typeof workflow?.workflow === 'string'
                ? workflow.workflow
                : (workflow?.workflow && typeof workflow.workflow === 'object' ? JSON.stringify(workflow.workflow, null, 2) : '');
            if (!id || !name || seen.has(id)) return null;
            seen.add(id);
            return {
                id,
                name,
                workflow: String(workflowText || '').trim(),
                nodeMapping: typeof workflow?.nodeMapping === 'string'
                    ? String(workflow.nodeMapping || '').trim()
                    : (workflow?.nodeMapping && typeof workflow.nodeMapping === 'object' ? JSON.stringify(workflow.nodeMapping, null, 2) : ''),
                comfyuiModel: String(workflow?.comfyuiModel || workflow?.model || '').trim(),
                comfyuiSampler: String(workflow?.comfyuiSampler || workflow?.sampler || 'euler').trim() || 'euler',
                comfyuiScheduler: String(workflow?.comfyuiScheduler || workflow?.scheduler || 'normal').trim() || 'normal',
                comfyuiVae: String(workflow?.comfyuiVae || workflow?.vae || '').trim(),
                comfyuiClip: String(workflow?.comfyuiClip || workflow?.clip || '').trim(),
                updatedAt: Number(workflow?.updatedAt || 0) || Date.now()
            };
        }).filter(Boolean);
    }

    _getComfyUIWorkflows() {
        const raw = this.storage.get('phone-image-comfyui-workflows');
        let workflows = [];
        try {
            workflows = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
        } catch (e) {
            workflows = [];
        }
        return this._normalizeComfyUIWorkflows(workflows);
    }

    async _saveComfyUIWorkflows(workflows) {
        await this.storage.set('phone-image-comfyui-workflows', JSON.stringify(this._normalizeComfyUIWorkflows(workflows)));
    }

    _clampNovelAIVibeValue(value, fallback = 0.7) {
        const num = Number.parseFloat(value);
        if (!Number.isFinite(num)) return fallback;
        return Math.round(Math.max(0, Math.min(1, num)) * 100) / 100;
    }

    _normalizeNovelAIVibeGroups(groups = []) {
        const seen = new Set();
        return (Array.isArray(groups) ? groups : []).map((group) => {
            const id = String(group?.id || '').trim();
            const name = String(group?.name || '').trim();
            if (!id || !name || seen.has(id)) return null;
            seen.add(id);
            const items = (Array.isArray(group?.items) ? group.items : (Array.isArray(group?.vibes) ? group.vibes : []))
                .map((item) => {
                    const image = String(item?.image || item?.imageUrl || item?.url || '').trim();
                    if (!image) return null;
                    return {
                        id: String(item?.id || `vibe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`).trim(),
                        name: String(item?.name || item?.title || 'Vibe').trim() || 'Vibe',
                        image,
                        strength: this._clampNovelAIVibeValue(item?.strength ?? item?.referenceStrength, 0.6),
                        informationExtracted: this._clampNovelAIVibeValue(item?.informationExtracted ?? item?.referenceInformationExtracted, 1),
                        cacheSecretKey: String(item?.cacheSecretKey || item?.cache_secret_key || '').trim()
                    };
                })
                .filter(Boolean);
            return {
                id,
                name,
                items,
                updatedAt: Number(group?.updatedAt || 0) || Date.now()
            };
        }).filter(group => group && group.items.length > 0);
    }

    _getNovelAIVibeGroups() {
        const raw = this.storage.get('phone-image-novelai-vibe-groups');
        let groups = [];
        try {
            groups = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
        } catch (e) {
            groups = [];
        }
        return this._normalizeNovelAIVibeGroups(groups);
    }

    async _saveNovelAIVibeGroups(groups) {
        await this.storage.set('phone-image-novelai-vibe-groups', JSON.stringify(this._normalizeNovelAIVibeGroups(groups)));
    }

    renderImageGenerationSection() {
        const provider = String(this.storage.get('phone-image-provider') || 'novelai').trim() || 'novelai';
        const enabled = this.storage.get('phone-image-enabled') === true || this.storage.get('phone-image-enabled') === 'true';
        const novelaiKey = String(this.storage.get('phone-image-novelai-key') || '').trim();
        const novelaiPublicKey = String(this.storage.get('phone-image-novelai-public-key') || '').trim();
        const openaiKey = String(this.storage.get('phone-image-openai-key') || '').trim();
        const openaiPublicKey = String(this.storage.get('phone-image-openai-public-key') || '').trim();
        const siliconflowKey = String(this.storage.get('phone-image-siliconflow-key') || this.storage.get('siliconflow_api_key') || '').trim();
        const novelaiModel = String(this.storage.get('phone-image-novelai-model') || 'nai-diffusion-4-5-full').trim();
        const openaiModel = String(this.storage.get('phone-image-openai-model') || 'gpt-image-2').trim();
        const siliconflowModel = String(this.storage.get('phone-image-siliconflow-model') || this.storage.get('image_generation_model') || 'Kwai-Kolors/Kolors').trim();
        const sdUrl = String(this.storage.get('phone-image-sd-url') || 'http://127.0.0.1:7860').trim();
        const sdModel = String(this.storage.get('phone-image-sd-model') || '').trim();
        const sdSampler = String(this.storage.get('phone-image-sd-sampler') || 'Euler a').trim() || 'Euler a';
        const sdAuth = String(this.storage.get('phone-image-sd-auth') || '').trim();
        const sdVae = String(this.storage.get('phone-image-sd-vae') || '').trim();
        const sdScheduler = String(this.storage.get('phone-image-sd-scheduler') || '').trim();
        const sdLora = String(this.storage.get('phone-image-sd-lora') || '').trim();
        const sdHiresFix = this.storage.get('phone-image-sd-hires-fix') === true || this.storage.get('phone-image-sd-hires-fix') === 'true';
        const sdUpscaler = String(this.storage.get('phone-image-sd-upscaler') || '').trim();
        const sdRestoreFaces = this.storage.get('phone-image-sd-restore-faces') === true || this.storage.get('phone-image-sd-restore-faces') === 'true';
        const sdADetailer = this.storage.get('phone-image-sd-adetailer') === true || this.storage.get('phone-image-sd-adetailer') === 'true';
        const comfyuiMode = String(this.storage.get('phone-image-comfyui-mode') || 'local').trim() === 'remote' ? 'remote' : 'local';
        const comfyuiUrl = String(this.storage.get('phone-image-comfyui-url') || 'http://127.0.0.1:8188').trim();
        const comfyuiRemoteUrl = String(this.storage.get('phone-image-comfyui-remote-url') || '').trim();
        const comfyuiModel = String(this.storage.get('phone-image-comfyui-model') || '').trim();
        const comfyuiSampler = String(this.storage.get('phone-image-comfyui-sampler') || 'euler').trim() || 'euler';
        const comfyuiScheduler = String(this.storage.get('phone-image-comfyui-scheduler') || 'normal').trim() || 'normal';
        const comfyuiVae = String(this.storage.get('phone-image-comfyui-vae') || '').trim();
        const comfyuiClip = String(this.storage.get('phone-image-comfyui-clip') || '').trim();
        const comfyuiWorkflow = String(this.storage.get('phone-image-comfyui-workflow') || '').trim();
        const comfyuiNodeMapping = String(this.storage.get('phone-image-comfyui-node-mapping') || '').trim();
        const novelaiSite = String(this.storage.get('phone-image-novelai-site') || 'official').trim() || 'official';
        const novelaiUrl = String(this.storage.get('phone-image-novelai-url') || '').trim();
        const novelaiPublicUrl = String(this.storage.get('phone-image-novelai-public-url') || '').trim();
        const novelaiQueueUrl = String(this.storage.get('phone-image-novelai-queue-url') || '').trim();
        const openaiSite = String(this.storage.get('phone-image-openai-site') || 'official').trim() || 'official';
        const openaiUrl = String(this.storage.get('phone-image-openai-url') || '').trim();
        const openaiPublicUrl = String(this.storage.get('phone-image-openai-public-url') || '').trim();
        const openaiPublicRelayUrl = String(this.storage.get('phone-image-openai-public-relay-url') || '').trim();
        const openaiQuality = String(this.storage.get('phone-image-openai-quality') || 'auto').trim() || 'auto';
        const sampler = String(this.storage.get('phone-image-novelai-sampler') || 'k_euler').trim() || 'k_euler';
        const schedule = String(this.storage.get('phone-image-novelai-schedule') || 'native').trim() || 'native';
        const novelaiSamplers = [
            ['k_euler', 'Euler'],
            ['ddim_v3', 'DDIM'],
            ['k_dpmpp_2s_ancestral', 'DPM++ 2S Ancestral'],
            ['k_dpmpp_2m', 'DPM++ 2M'],
            ['k_euler_ancestral', 'Euler Ancestral'],
            ['k_dpmpp_2m_sde', 'DPM++ 2M SDE'],
            ['k_dpmpp_sde', 'DPM++ SDE']
        ];
        const novelaiSchedules = [
            ['native', 'native'],
            ['exponential', 'exponential'],
            ['polyexponential', 'polyexponential'],
            ['karras', 'karras']
        ];
        const sdSamplers = [
            'Euler a',
            'Euler',
            'LMS',
            'Heun',
            'DPM2',
            'DPM2 a',
            'DPM++ 2S a',
            'DPM++ 2M',
            'DPM++ SDE',
            'DPM fast',
            'DPM adaptive',
            'LMS Karras',
            'DPM2 Karras',
            'DPM2 a Karras',
            'DPM++ 2S a Karras',
            'DPM++ 2M Karras',
            'DPM++ SDE Karras',
            'DDIM',
            'PLMS'
        ];
        const samplerValue = novelaiSamplers.some(([value]) => value === sampler) ? sampler : 'k_euler';
        const scheduleValue = novelaiSchedules.some(([value]) => value === schedule) ? schedule : 'native';
        const readImageNumber = (key, fallback, min = null, max = null, integer = true) => {
            const raw = this.storage.get(key);
            const num = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
            let value = Number.isFinite(num) ? num : fallback;
            if (integer) value = Math.round(value);
            if (min !== null) value = Math.max(min, value);
            if (max !== null) value = Math.min(max, value);
            return value;
        };
        const readImageSizePair = (widthKey, heightKey, fallbackWidth, fallbackHeight) => {
            const widthValue = readImageNumber(widthKey, fallbackWidth, 64, 2048, true);
            const heightValue = readImageNumber(heightKey, fallbackHeight, 64, 2048, true);
            return widthValue <= 64 && heightValue <= 64
                ? { width: fallbackWidth, height: fallbackHeight }
                : { width: widthValue, height: heightValue };
        };
        const sdClipSkip = readImageNumber('phone-image-sd-clip-skip', 0, 0, 12, true);
        const sdHiresSteps = readImageNumber('phone-image-sd-hires-steps', 0, 0, 80, true);
        const sdUpscaleFactor = readImageNumber('phone-image-sd-upscale-factor', 1.5, 1, 4, false);
        const sdDenoisingStrength = readImageNumber('phone-image-sd-denoising-strength', 0.45, 0, 1, false);
        const fallbackSize = readImageSizePair('phone-image-width', 'phone-image-height', 832, 1216);
        const honeySize = readImageSizePair('phone-image-honey-width', 'phone-image-honey-height', 832, 1216);
        const wechatSize = readImageSizePair('phone-image-wechat-width', 'phone-image-wechat-height', 512, 512);
        const weiboSize = readImageSizePair('phone-image-weibo-width', 'phone-image-weibo-height', 1024, 1024);
        const diarySize = readImageSizePair('phone-image-diary-width', 'phone-image-diary-height', 512, 512);
        const width = fallbackSize.width;
        const height = fallbackSize.height;
        const honeyWidth = honeySize.width;
        const honeyHeight = honeySize.height;
        const wechatWidth = wechatSize.width;
        const wechatHeight = wechatSize.height;
        const weiboWidth = weiboSize.width;
        const weiboHeight = weiboSize.height;
        const diaryWidth = diarySize.width;
        const diaryHeight = diarySize.height;
        const readStoredNumber = (key, fallback) => {
            const raw = this.storage.get(key);
            if (raw === null || typeof raw === 'undefined' || raw === '') return fallback;
            const value = Number(raw);
            return Number.isFinite(value) ? value : fallback;
        };
        const steps = readStoredNumber('phone-image-steps', 28);
        const scale = readStoredNumber('phone-image-scale', 6);
        const cfgRescale = readStoredNumber('phone-image-cfg-rescale', 0.2);
        const seed = Number(this.storage.get('phone-image-seed') ?? -1);
        const debugPayload = this.storage.get('phone-image-debug-payload') === true || this.storage.get('phone-image-debug-payload') === 'true';
        const novelaiSkipCfgCompat = this.storage.get('phone-image-novelai-skip-cfg-compat') !== false
            && this.storage.get('phone-image-novelai-skip-cfg-compat') !== 'false';
        const imagePromptAppDefs = this._getImagePromptAppDefs();
        const activeImagePromptApp = this._normalizeImagePromptApp(this.storage.get('phone-image-active-prompt-app') || 'honey');
        const activeImagePresetScope = this._normalizeImagePresetScope(activeImagePromptApp);
        const imagePromptDraft = this._getImagePromptDraft(activeImagePresetScope);
        const fixedPrompt = this._escapeHtml(imagePromptDraft.fixedPrompt);
        const fixedPromptEnd = this._escapeHtml(imagePromptDraft.fixedPromptEnd);
        const negativePrompt = this._escapeHtml(imagePromptDraft.negativePrompt);
        const imagePromptPresets = this._getImagePromptPresets(activeImagePresetScope);
        const activeImagePromptPresetId = String(this.storage.get(`phone-image-${activeImagePresetScope}-active-prompt-preset`) || '').trim();
        const activeImagePromptPreset = imagePromptPresets.find(preset => preset.id === activeImagePromptPresetId) || null;
        const activeImagePromptPresetName = this._escapeHtml(activeImagePromptPreset?.name || '');
        const imagePromptAppOptions = imagePromptAppDefs.map((def) => {
            const safeId = this._escapeHtml(def.id);
            const safeName = this._escapeHtml(def.name);
            return `<option value="${safeId}" ${def.id === activeImagePromptApp ? 'selected' : ''}>${safeName}</option>`;
        }).join('');
        const imagePromptPresetOptions = imagePromptPresets.map((preset) => {
            const safeId = this._escapeHtml(preset.id);
            const safeName = this._escapeHtml(preset.name);
            return `<option value="${safeId}" ${preset.id === activeImagePromptPresetId ? 'selected' : ''}>${safeName}</option>`;
        }).join('');
        const openaiImagePresets = this._getOpenAIImagePresets();
        const activeOpenaiImagePresetId = String(this.storage.get('phone-image-openai-active-preset') || '').trim();
        const activeOpenaiImagePreset = openaiImagePresets.find(preset => preset.id === activeOpenaiImagePresetId) || null;
        const activeOpenaiImagePresetName = this._escapeHtml(activeOpenaiImagePreset?.name || '');
        const openaiImagePresetOptions = openaiImagePresets.map((preset) => {
            const safeId = this._escapeHtml(preset.id);
            const safeName = this._escapeHtml(preset.name);
            return `<option value="${safeId}" ${preset.id === activeOpenaiImagePresetId ? 'selected' : ''}>${safeName}</option>`;
        }).join('');
        const comfyuiWorkflows = this._getComfyUIWorkflows();
        const activeComfyUIWorkflowId = String(
            this.storage.get(`phone-image-${activeImagePresetScope}-comfyui-active-workflow`)
            || this.storage.get('phone-image-comfyui-active-workflow')
            || ''
        ).trim();
        const activeComfyUIWorkflow = comfyuiWorkflows.find(workflow => workflow.id === activeComfyUIWorkflowId) || null;
        const activeComfyUIWorkflowName = this._escapeHtml(activeComfyUIWorkflow?.name || '');
        const comfyuiWorkflowOptions = comfyuiWorkflows.map((workflow) => {
            const safeId = this._escapeHtml(workflow.id);
            const safeName = this._escapeHtml(workflow.name);
            return `<option value="${safeId}" ${workflow.id === activeComfyUIWorkflowId ? 'selected' : ''}>${safeName}</option>`;
        }).join('');
        const novelaiVibeGroups = this._getNovelAIVibeGroups();
        const activeNovelAIVibeGroupId = String(this.storage.get('phone-image-novelai-active-vibe-group') || '').trim();
        const activeNovelAIVibeGroup = novelaiVibeGroups.find(group => group.id === activeNovelAIVibeGroupId) || null;
        const activeNovelAIVibeGroupName = this._escapeHtml(activeNovelAIVibeGroup?.name || '');
        const novelaiVibeGroupOptions = novelaiVibeGroups.map((group) => {
            const safeId = this._escapeHtml(group.id);
            const safeName = this._escapeHtml(group.name);
            return `<option value="${safeId}" ${group.id === activeNovelAIVibeGroupId ? 'selected' : ''}>${safeName}</option>`;
        }).join('');
        const novelaiVibeEnabled = this.storage.get('phone-image-novelai-vibe-enabled') === true || this.storage.get('phone-image-novelai-vibe-enabled') === 'true';
        const novelaiVibeNormalizeStrength = this.storage.get('phone-image-novelai-vibe-normalize-strength') === true || this.storage.get('phone-image-novelai-vibe-normalize-strength') === 'true';
        const novelaiVibeGroupItemsHtml = activeNovelAIVibeGroup?.items?.length
            ? activeNovelAIVibeGroup.items.map((item, index) => `
                <div class="phone-image-vibe-item" data-vibe-id="${this._escapeHtml(item.id)}" style="display:grid; grid-template-columns:44px 1fr 34px; gap:8px; align-items:center; padding:8px; border:1px solid #eee; border-radius:8px; background:#fafafa; margin-top:8px;">
                    <div style="width:44px; height:44px; border-radius:6px; overflow:hidden; background:#e5e7eb;">
                        <img src="${this._escapeHtml(item.image)}" alt="" style="width:100%; height:100%; object-fit:cover; display:block;">
                    </div>
                    <div style="min-width:0;">
                        <input type="text" class="phone-image-vibe-name" value="${this._escapeHtml(item.name || `Vibe ${index + 1}`)}" placeholder="Vibe 名称" style="width:100%; height:28px; padding:0 8px; border:1px solid #e0e0e0; border-radius:7px; font-size:12px; background:#fff; box-sizing:border-box;">
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:6px;">
                            <input type="number" class="phone-image-vibe-strength" min="0" max="1" step="0.01" value="${this._escapeHtml(item.strength)}" title="Reference Strength" style="width:100%; height:26px; padding:0 6px; border:1px solid #e0e0e0; border-radius:7px; font-size:11px; background:#fff; box-sizing:border-box;">
                            <input type="number" class="phone-image-vibe-info" min="0" max="1" step="0.01" value="${this._escapeHtml(item.informationExtracted)}" title="Information Extracted" style="width:100%; height:26px; padding:0 6px; border:1px solid #e0e0e0; border-radius:7px; font-size:11px; background:#fff; box-sizing:border-box;">
                        </div>
                    </div>
                    <button type="button" class="phone-image-vibe-remove" aria-label="删除 Vibe" title="删除 Vibe" style="width:34px; height:34px; border:1px solid rgba(211,51,51,0.25); border-radius:8px; background:#fff; color:#d33; cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0;">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `).join('')
            : '<div class="setting-desc" style="margin-top:8px;">当前组还没有 Vibe 图片。</div>';
        const imageProviderAppBindings = this._getImageProviderAppBindings();
        const novelaiDisplay = provider === 'novelai' ? '' : 'display: none;';
        const openaiDisplay = provider === 'openai' ? '' : 'display: none;';
        const siliconflowDisplay = provider === 'siliconflow' ? '' : 'display: none;';
        const sdDisplay = provider === 'sd' ? '' : 'display: none;';
        const comfyuiDisplay = provider === 'comfyui' ? '' : 'display: none;';
        const novelaiOnlyDisplay = provider === 'novelai' ? '' : 'display: none;';

        return `
            <div class="setting-section">
                <div class="setting-section-title">🖼️ 生图功能</div>

                <div class="setting-item setting-toggle">
                    <div>
                        <div class="setting-label">启用全局生图</div>
                        <div class="setting-desc">蜜语、微博、微信等 App 共用这里的生图服务配置</div>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="phone-image-enabled" ${enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>

                <div class="setting-item">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 14px; color: #000;">生图供应商</span>
                        <select id="phone-image-provider" style="width: 150px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                            <option value="novelai" ${provider === 'novelai' ? 'selected' : ''}>NovelAI / NAI</option>
                            <option value="openai" ${provider === 'openai' ? 'selected' : ''}>GPT / OpenAI兼容</option>
                            <option value="sd" ${provider === 'sd' ? 'selected' : ''}>本地 SD</option>
                            <option value="comfyui" ${provider === 'comfyui' ? 'selected' : ''}>ComfyUI</option>
                            <option value="siliconflow" ${provider === 'siliconflow' ? 'selected' : ''}>硅基流动</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="setting-section" id="phone-image-novelai-section" style="${novelaiDisplay}">
                <div class="setting-section-title">🎨 NovelAI / NAI</div>

                ${this._renderImageProviderAppBinding('novelai', imageProviderAppBindings)}

                <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                    <span style="font-size: 14px; color: #000;">接口站点</span>
                    <select id="phone-image-novelai-site" style="width: 150px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                        <option value="official" ${novelaiSite === 'official' ? 'selected' : ''}>官方站点</option>
                        <option value="public" ${novelaiSite === 'public' ? 'selected' : ''}>公益站点</option>
                        <option value="custom" ${novelaiSite === 'custom' ? 'selected' : ''}>自定义地址</option>
                    </select>
                </div>

                <div class="setting-item" id="phone-image-novelai-public-url-row" style="${novelaiSite === 'public' ? '' : 'display: none;'}">
                    <div class="setting-label">公益站点 Base URL</div>
                    <div class="setting-desc">填写兼容 NovelAI /ai/generate-image 的中转或公益站地址。</div>
                    <input type="text" id="phone-image-novelai-public-url"
                           value="${this._escapeHtml(novelaiPublicUrl)}"
                           placeholder="例如：https://your-nai-site.example.com"
                           style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                </div>

                <div class="setting-item" id="phone-image-novelai-url-row" style="${novelaiSite === 'custom' ? '' : 'display: none;'}">
                    <div class="setting-label">自定义 Base URL</div>
                    <input type="text" id="phone-image-novelai-url"
                           value="${this._escapeHtml(novelaiUrl)}"
                           placeholder="例如：https://image.novelai.net"
                           style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                </div>

                <div class="setting-item" id="phone-image-novelai-queue-row" style="${novelaiSite === 'public' ? 'display: none;' : ''}">
                    <div class="setting-label">共享队列服务 URL</div>
                    <div class="setting-desc">多人共用同一个 NAI Key 时填写；留空则直接请求 NAI。</div>
                    <input type="text" id="phone-image-novelai-queue-url"
                           value="${this._escapeHtml(novelaiQueueUrl)}"
                           placeholder="例如：https://your-queue.example.com"
                           style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                </div>

                <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                    <span id="phone-image-novelai-key-label" style="font-size: 14px; color: #000;">${novelaiSite === 'public' ? '公益站 Key' : 'API Key'}</span>
                    <div style="display: flex; align-items: center; width: 150px; height: 30px; border: 1px solid #e0e0e0; border-radius: 8px; background: #fafafa; overflow: hidden;">
                        <input type="password" id="phone-image-novelai-key"
                               value="${this._escapeHtml(novelaiSite === 'public' ? novelaiPublicKey : novelaiKey)}"
                               placeholder="${novelaiSite === 'public' ? '公益站 API Key' : 'NovelAI API Key'}"
                               style="flex: 1; min-width: 0; height: 100%; padding: 0 4px 0 8px; border: none; outline: none; font-size: 12px; background: transparent;">
                        <button type="button" class="phone-password-toggle" data-toggle-password-target="phone-image-novelai-key" aria-label="显示或隐藏 API Key" style="width: 30px; height: 100%; border: none; background: transparent; color: #777; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                    </div>
                </div>

                <div class="setting-item">
                    <button id="phone-image-test-novelai" class="phone-image-test-btn" style="width: 100%; height: 34px; border: none; border-radius: 8px; background: #7c3aed !important; color: #fff !important; font-size: 13px; font-weight: 600; cursor: pointer;">
                        测试 NAI 生图连接
                    </button>
                    <div class="setting-desc" id="phone-image-test-novelai-result" style="margin-top: 6px;">使用蜜语尺寸和当前 NovelAI 参数生成一张测试图。</div>
                </div>

                <div class="setting-item setting-toggle">
                    <div>
                        <div class="setting-label">控制台调试 NAI 参数</div>
                        <div class="setting-desc">开启后每次 NAI 生图会在浏览器控制台输出完整 payload，不包含 API Key。</div>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="phone-image-debug-payload" ${debugPayload ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>

                <div class="setting-item setting-toggle">
                    <div>
                        <div class="setting-label">NAI 4/4.5 自动兼容参数</div>
                        <div class="setting-desc">Euler Ancestral + karras/exponential 时自动发送 skip_cfg_above_sigma；关闭后按原始参数发包。</div>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="phone-image-novelai-skip-cfg-compat" ${novelaiSkipCfgCompat ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>

                <div class="setting-item">
                    <div class="setting-label">NAI 生图预设</div>
                    <div class="setting-desc">预设按蜜语、微信/日记、微博分别管理；微信和日记使用同一套当前预设。</div>
                    <select id="phone-image-prompt-app-select" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                        ${imagePromptAppOptions}
                    </select>
                    <select id="phone-image-prompt-preset-select" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                        <option value="">未选择设定</option>
                        ${imagePromptPresetOptions}
                    </select>
                    <input type="text" id="phone-image-prompt-preset-name"
                           value="${activeImagePromptPresetName}"
                           placeholder="设定名称，例如：画师串A / 厚涂 / 漫画风"
                           style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 8px;">
                        <button id="phone-image-prompt-preset-save" class="setting-btn" style="height: 30px; padding: 0 8px; font-size: 12px; background: #07c160; color: #fff; border: none; border-radius: 8px; cursor: pointer;">保存</button>
                        <button id="phone-image-prompt-preset-new" class="setting-btn" style="height: 30px; padding: 0 8px; font-size: 12px; background: #f2f2f2; color: #222; border: 1px solid #d8d8d8; border-radius: 8px; cursor: pointer;">新建</button>
                        <button id="phone-image-prompt-preset-delete" class="setting-btn" style="height: 30px; padding: 0 8px; font-size: 12px; background: #fff; color: #d33; border: 1px solid rgba(211,51,51,0.28); border-radius: 8px; cursor: pointer;">删除</button>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">
                        <button id="phone-image-prompt-preset-export" class="setting-btn" style="height: 30px; padding: 0 8px; font-size: 12px; background: #eef6ff; color: #1d4f91; border: 1px solid #b9d6fb; border-radius: 8px; cursor: pointer;">导出预设</button>
                        <button id="phone-image-prompt-preset-import" class="setting-btn" style="height: 30px; padding: 0 8px; font-size: 12px; background: #fff7ed; color: #8a4d16; border: 1px solid #f1c38c; border-radius: 8px; cursor: pointer;">导入预设</button>
                    </div>
                    <button id="phone-image-prompt-preset-clear-all" class="setting-btn" style="width: 100%; height: 30px; margin-top: 8px; padding: 0 8px; font-size: 12px; background: #fff; color: #d33; border: 1px solid rgba(211,51,51,0.28); border-radius: 8px; cursor: pointer;">一键删除所有 NAI 预设</button>
                    <input type="file" id="phone-image-prompt-preset-import-file" accept=".json,application/json,text/json" style="display: none;">
                </div>

                <div class="setting-item">
                    <div class="setting-label">模型</div>
                    <select id="phone-image-novelai-model" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                        ${!['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-4-full', 'nai-diffusion-4-curated-preview', 'nai-diffusion-3'].includes(novelaiModel) ? `<option value="${this._escapeHtml(novelaiModel)}" selected>${this._escapeHtml(novelaiModel)}</option>` : ''}
                        <option value="nai-diffusion-4-5-full" ${novelaiModel === 'nai-diffusion-4-5-full' ? 'selected' : ''}>NAI Diffusion 4.5 Full</option>
                        <option value="nai-diffusion-4-5-curated" ${novelaiModel === 'nai-diffusion-4-5-curated' ? 'selected' : ''}>NAI Diffusion 4.5 Curated</option>
                        <option value="nai-diffusion-4-full" ${novelaiModel === 'nai-diffusion-4-full' ? 'selected' : ''}>NAI Diffusion 4 Full</option>
                        <option value="nai-diffusion-4-curated-preview" ${novelaiModel === 'nai-diffusion-4-curated-preview' ? 'selected' : ''}>NAI Diffusion 4 Curated Preview</option>
                        <option value="nai-diffusion-3" ${novelaiModel === 'nai-diffusion-3' ? 'selected' : ''}>NAI Diffusion 3</option>
                    </select>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div class="setting-item">
                        <div class="setting-label">采样器</div>
                        <select id="phone-image-novelai-sampler" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                            ${novelaiSamplers.map(([value, label]) => `<option value="${value}" ${samplerValue === value ? 'selected' : ''}>${label}</option>`).join('')}
                        </select>
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">Schedule</div>
                        <select id="phone-image-novelai-schedule" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                            ${novelaiSchedules.map(([value, label]) => `<option value="${value}" ${scheduleValue === value ? 'selected' : ''}>${label}</option>`).join('')}
                        </select>
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">Prompt Guidance</div>
                        <input type="number" id="phone-image-novelai-guidance" data-phone-image-number-key="phone-image-scale" min="0" max="50" step="0.1" value="${scale}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">Guidance Rescale</div>
                        <input type="number" id="phone-image-novelai-guidance-rescale" data-phone-image-number-key="phone-image-cfg-rescale" min="0" max="1" step="0.01" value="${cfgRescale}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">Steps</div>
                        <input type="number" id="phone-image-steps" min="1" max="50" value="${steps}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">Seed</div>
                        <input type="number" id="phone-image-seed" min="-1" value="${seed}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    </div>
                </div>
            </div>

            <div class="setting-section" id="phone-image-openai-section" style="${openaiDisplay}">
                <div class="setting-section-title">🤖 GPT / OpenAI兼容</div>

                ${this._renderImageProviderAppBinding('openai', imageProviderAppBindings)}

                <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                    <span style="font-size: 14px; color: #000;">接口站点</span>
                    <select id="phone-image-openai-site" style="width: 150px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                        <option value="official" ${openaiSite === 'official' ? 'selected' : ''}>官方站点</option>
                        <option value="public" ${openaiSite === 'public' ? 'selected' : ''}>公益站点</option>
                        <option value="custom" ${openaiSite === 'custom' ? 'selected' : ''}>自定义地址</option>
                    </select>
                </div>

                <div class="setting-item" id="phone-image-openai-public-url-row" style="${openaiSite === 'public' ? '' : 'display: none;'}">
                    <div class="setting-label">公益站点真实 Base URL</div>
                    <div class="setting-desc">填写真实 GPT 公益站纯域名，不要带 /v1 或 /v1/images/generations。</div>
                    <input type="text" id="phone-image-openai-public-url"
                           value="${this._escapeHtml(openaiPublicUrl)}"
                           placeholder="例如：https://imagegen.mukyu.me"
                           style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                </div>

                <div class="setting-item" id="phone-image-openai-url-row" style="${openaiSite === 'custom' ? '' : 'display: none;'}">
                    <div class="setting-label">自定义 Base URL</div>
                    <div class="setting-desc">可填 Base URL，也可填完整 /v1/images/generations。</div>
                    <input type="text" id="phone-image-openai-url"
                           value="${this._escapeHtml(openaiUrl)}"
                           placeholder="例如：https://api.openai.com"
                           style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                </div>

                <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                    <span id="phone-image-openai-key-label" style="font-size: 14px; color: #000;">${openaiSite === 'public' ? '公益站 Key' : 'API Key'}</span>
                    <div style="display: flex; align-items: center; width: 150px; height: 30px; border: 1px solid #e0e0e0; border-radius: 8px; background: #fafafa; overflow: hidden;">
                        <input type="password" id="phone-image-openai-key"
                               value="${this._escapeHtml(openaiSite === 'public' ? openaiPublicKey : openaiKey)}"
                               placeholder="${openaiSite === 'public' ? '公益站 API Key' : 'OpenAI API Key'}"
                               style="flex: 1; min-width: 0; height: 100%; padding: 0 4px 0 8px; border: none; outline: none; font-size: 12px; background: transparent;">
                        <button type="button" class="phone-password-toggle" data-toggle-password-target="phone-image-openai-key" aria-label="显示或隐藏 API Key" style="width: 30px; height: 100%; border: none; background: transparent; color: #777; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                    </div>
                </div>

                <div class="setting-item">
                    <button id="phone-image-test-openai" class="phone-image-test-btn" style="width: 100%; height: 34px; border: none; border-radius: 8px; background: #111827 !important; color: #fff !important; font-size: 13px; font-weight: 600; cursor: pointer;">
                        测试 GPT 生图连接
                    </button>
                    <div class="setting-desc" id="phone-image-test-openai-result" style="margin-top: 6px;">使用 OpenAI 兼容 /v1/images/generations 生成一张测试图。</div>
                </div>

                <div class="setting-item">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                        <span style="font-size: 14px; color: #000;">模型</span>
                        <button type="button" id="phone-image-openai-fetch-models" style="height: 30px; padding: 0 10px; border: none; border-radius: 8px; background: #2563eb !important; color: #fff !important; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;">
                            拉取模型
                        </button>
                    </div>
                    <select id="phone-image-openai-model-preset" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                        <option value="">-- 快速选择 --</option>
                        <option value="gpt-image-2">gpt-image-2</option>
                        <option value="gpt-image-1.5">gpt-image-1.5</option>
                        <option value="gpt-image-1">gpt-image-1</option>
                        <option value="gpt-image-1-mini">gpt-image-1-mini</option>
                        <option value="dall-e-3">dall-e-3</option>
                    </select>
                    <input type="text" id="phone-image-openai-model"
                           value="${this._escapeHtml(openaiModel)}"
                           placeholder="gpt-image-2"
                           style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    <div class="setting-desc" id="phone-image-openai-models-result" style="margin-top: 6px;">从当前站点的 /v1/models 拉取可用模型。</div>
                </div>

                <div class="setting-item" id="phone-image-openai-public-relay-row" style="${openaiSite === 'public' ? '' : 'display: none;'}">
                    <div class="setting-label">移动端本地中转 URL</div>
                    <div class="setting-desc">仅移动端 Termux 使用本地中转时填写。电脑端留空；Termux 运行 imgrelay 后填 http://127.0.0.1:8787。</div>
                    <input type="text" id="phone-image-openai-public-relay-url"
                           value="${this._escapeHtml(openaiPublicRelayUrl)}"
                           placeholder="例如：http://127.0.0.1:8787"
                           style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                </div>

                <div class="setting-item">
                    <div class="setting-label">GPT 生图预设</div>
                    <div class="setting-desc">GPT 单独保存模型、质量、尺寸和提示词；不与 NAI 预设混用。</div>
                    <select id="phone-image-openai-preset-select" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                        <option value="">未选择 GPT 预设</option>
                        ${openaiImagePresetOptions}
                    </select>
                    <input type="text" id="phone-image-openai-preset-name"
                           value="${activeOpenaiImagePresetName}"
                           placeholder="预设名称，例如：GPT 方图 / 高清 / 快速"
                           style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 8px;">
                        <button id="phone-image-openai-preset-save" class="setting-btn" style="height: 30px; padding: 0 8px; font-size: 12px; background: #07c160; color: #fff; border: none; border-radius: 8px; cursor: pointer;">保存</button>
                        <button id="phone-image-openai-preset-new" class="setting-btn" style="height: 30px; padding: 0 8px; font-size: 12px; background: #f2f2f2; color: #222; border: 1px solid #d8d8d8; border-radius: 8px; cursor: pointer;">新建</button>
                        <button id="phone-image-openai-preset-delete" class="setting-btn" style="height: 30px; padding: 0 8px; font-size: 12px; background: #fff; color: #d33; border: 1px solid rgba(211,51,51,0.28); border-radius: 8px; cursor: pointer;">删除</button>
                    </div>
                </div>

                <input type="hidden" id="phone-image-openai-mode" value="images">

                <div class="setting-item">
                    <div class="setting-label">质量</div>
                    <select id="phone-image-openai-quality" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                        <option value="auto" ${openaiQuality === 'auto' ? 'selected' : ''}>auto</option>
                        <option value="low" ${openaiQuality === 'low' ? 'selected' : ''}>low</option>
                        <option value="medium" ${openaiQuality === 'medium' ? 'selected' : ''}>medium</option>
                        <option value="high" ${openaiQuality === 'high' ? 'selected' : ''}>high</option>
                    </select>
                </div>
            </div>

            <div class="setting-section" id="phone-image-siliconflow-section" style="${siliconflowDisplay}">
                <div class="setting-section-title">🌊 硅基流动</div>

                ${this._renderImageProviderAppBinding('siliconflow', imageProviderAppBindings)}

                <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                    <span style="font-size: 14px; color: #000;">API Key</span>
                    <div style="display: flex; align-items: center; width: 150px; height: 30px; border: 1px solid #e0e0e0; border-radius: 8px; background: #fafafa; overflow: hidden;">
                        <input type="password" id="siliconflow-api-key"
                               value="${this._escapeHtml(siliconflowKey)}"
                               placeholder="SiliconFlow API Key"
                               style="flex: 1; min-width: 0; height: 100%; padding: 0 4px 0 8px; border: none; outline: none; font-size: 12px; background: transparent;">
                        <button type="button" class="phone-password-toggle" data-toggle-password-target="siliconflow-api-key" aria-label="显示或隐藏 API Key" style="width: 30px; height: 100%; border: none; background: transparent; color: #777; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                    </div>
                </div>

                <div class="setting-item">
                    <div class="setting-label">模型名称</div>
                    <input type="text" id="image-generation-model"
                           value="${this._escapeHtml(siliconflowModel)}"
                           placeholder="Kwai-Kolors/Kolors"
                           style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                </div>
            </div>

            <div class="setting-section" id="phone-image-sd-section" style="${sdDisplay}">
                <div class="setting-section-title">本地 Stable Diffusion</div>

                ${this._renderImageProviderAppBinding('sd', imageProviderAppBindings)}

                <div class="setting-item">
                    <div class="setting-label">SD WebUI 地址</div>
                    <div class="setting-desc">填写本地或局域网 Stable Diffusion WebUI 地址，WebUI 需要开启 API。</div>
                    <input type="text" id="phone-image-sd-url"
                           value="${this._escapeHtml(sdUrl)}"
                           placeholder="http://127.0.0.1:7860"
                           style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                </div>

                <div class="setting-item">
                    <div class="setting-label">身份验证</div>
                    <div class="setting-desc">WebUI 设置了 --api-auth 时填写，格式为 用户名:密码；没有则留空。</div>
                    <input type="text" id="phone-image-sd-auth"
                           value="${this._escapeHtml(sdAuth)}"
                           placeholder="例如：user:password"
                           style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                </div>

                <div class="setting-item">
                    <button id="phone-image-sd-refresh-models" class="phone-image-test-btn" style="width: 100%; height: 34px; border: none; border-radius: 8px; background: #3b82f6 !important; color: #fff !important; font-size: 13px; font-weight: 600; cursor: pointer;">
                        连接并刷新 SD 数据
                    </button>
                    <div class="setting-desc" id="phone-image-sd-models-status" style="margin-top: 6px;">选择本地 SD 时，可先刷新模型、VAE、采样器、调度器、放大器和 LoRA。</div>
                </div>

                <div class="setting-item">
                    <div class="setting-label">模型</div>
                    <select id="phone-image-sd-model" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                        <option value="${this._escapeHtml(sdModel)}">${sdModel ? this._escapeHtml(sdModel) : '不指定模型'}</option>
                    </select>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div class="setting-item">
                        <div class="setting-label">VAE</div>
                        <select id="phone-image-sd-vae" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                            <option value="${this._escapeHtml(sdVae)}">${sdVae ? this._escapeHtml(sdVae) : '自动'}</option>
                        </select>
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">Clip Skip</div>
                        <input type="number" id="phone-image-sd-clip-skip" min="0" max="12" step="1" value="${sdClipSkip}"
                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">采样器</div>
                        <select id="phone-image-sd-sampler" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                            ${sdSamplers.map(value => `<option value="${this._escapeHtml(value)}" ${sdSampler === value ? 'selected' : ''}>${this._escapeHtml(value)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">调度器</div>
                        <select id="phone-image-sd-scheduler" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                            <option value="${this._escapeHtml(sdScheduler)}">${sdScheduler ? this._escapeHtml(sdScheduler) : '自动'}</option>
                        </select>
                    </div>
                </div>

                <div class="setting-item">
                    <div class="setting-label">LoRA</div>
                    <div class="setting-desc">选择 LoRA 后点添加；也可手动填写 name:weight 或 &lt;lora:name:weight&gt;，多个用换行分隔。</div>
                    <div style="display: grid; grid-template-columns: 1fr 64px; gap: 8px; margin-top: 6px;">
                        <select id="phone-image-sd-lora-select" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box;">
                            <option value="">未加载 LoRA</option>
                        </select>
                        <button type="button" id="phone-image-sd-add-lora" style="height: 30px; border: none; border-radius: 8px; background: #f1f5f9; color: #111; font-size: 12px; cursor: pointer;">添加</button>
                    </div>
                    <textarea id="phone-image-sd-lora" rows="3" placeholder="例如：detail_slider_v4:0.8"
                              style="width: 100%; min-height: 66px; padding: 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px; resize: vertical;">${this._escapeHtml(sdLora)}</textarea>
                </div>

                <div class="setting-item setting-toggle">
                    <div>
                        <div class="setting-label">高清修复</div>
                        <div class="setting-desc">对应 WebUI Hires.fix，适合先小图再放大修复。</div>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="phone-image-sd-hires-fix" ${sdHiresFix ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div class="setting-item">
                        <div class="setting-label">高清步数</div>
                        <input type="number" id="phone-image-sd-hires-steps" min="0" max="80" step="1" value="${sdHiresSteps}"
                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">放大器</div>
                        <select id="phone-image-sd-upscaler" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                            <option value="${this._escapeHtml(sdUpscaler)}">${sdUpscaler ? this._escapeHtml(sdUpscaler) : '自动'}</option>
                        </select>
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">放大倍数</div>
                        <input type="number" id="phone-image-sd-upscale-factor" min="1" max="4" step="0.1" value="${sdUpscaleFactor}"
                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">去噪强度</div>
                        <input type="number" id="phone-image-sd-denoising-strength" min="0" max="1" step="0.05" value="${sdDenoisingStrength}"
                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    </div>
                </div>

                <div class="setting-item setting-toggle">
                    <div>
                        <div class="setting-label">面部修复</div>
                        <div class="setting-desc">对应 WebUI restore_faces。</div>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="phone-image-sd-restore-faces" ${sdRestoreFaces ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>

                <div class="setting-item setting-toggle">
                    <div>
                        <div class="setting-label">ADetailer 脸部</div>
                        <div class="setting-desc">需要 WebUI 已安装并启用 ADetailer 扩展。</div>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="phone-image-sd-adetailer" ${sdADetailer ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>

                <div class="setting-item">
                    <button id="phone-image-test-sd" class="phone-image-test-btn" style="width: 100%; height: 34px; border: none; border-radius: 8px; background: #10b981 !important; color: #fff !important; font-size: 13px; font-weight: 600; cursor: pointer;">
                        测试 SD 生图连接
                    </button>
                    <div class="setting-desc" id="phone-image-test-sd-result" style="margin-top: 6px;">使用蜜语尺寸和当前 SD 参数生成一张测试图。</div>
                </div>
            </div>

            <div class="setting-section" id="phone-image-comfyui-section" style="${comfyuiDisplay}">
                <div class="setting-section-title">ComfyUI</div>

                ${this._renderImageProviderAppBinding('comfyui', imageProviderAppBindings)}

                <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                    <span style="font-size: 14px; color: #000;">连接位置</span>
                    <select id="phone-image-comfyui-mode" style="width: 150px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                        <option value="local" ${comfyuiMode === 'local' ? 'selected' : ''}>本地</option>
                        <option value="remote" ${comfyuiMode === 'remote' ? 'selected' : ''}>远端 / 云端</option>
                    </select>
                </div>

                <div class="setting-item" id="phone-image-comfyui-local-url-row" style="${comfyuiMode === 'local' ? '' : 'display: none;'}">
                    <div class="setting-label">本地 ComfyUI 地址</div>
                    <div class="setting-desc">切到“本地”时使用，默认端口通常是 8188。</div>
                    <input type="text" id="phone-image-comfyui-url"
                           value="${this._escapeHtml(comfyuiUrl)}"
                           placeholder="http://127.0.0.1:8188"
                           style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                </div>

                <div class="setting-item" id="phone-image-comfyui-remote-url-row" style="${comfyuiMode === 'remote' ? '' : 'display: none;'}">
                    <div class="setting-label">远端 ComfyUI 地址</div>
                    <div class="setting-desc">填写云端 ComfyUI 的公开 Base URL；工作流、模型和占位符仍使用同一套配置。</div>
                    <input type="text" id="phone-image-comfyui-remote-url"
                           value="${this._escapeHtml(comfyuiRemoteUrl)}"
                           placeholder="https://your-comfyui.example.com"
                           style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    <div class="setting-desc" style="margin-top: 6px;">远端服务需要开放 /object_info、/prompt、/history、/view 和 /upload/image，并允许浏览器跨域访问。</div>
                </div>

                <div class="setting-item">
                    <button id="phone-image-comfyui-refresh" class="phone-image-test-btn" style="width: 100%; height: 34px; border: none; border-radius: 8px; background: #6366f1 !important; color: #fff !important; font-size: 13px; font-weight: 600; cursor: pointer;">
                        连接并刷新 ComfyUI 数据
                    </button>
                    <div class="setting-desc" id="phone-image-comfyui-status" style="margin-top: 6px;">从 /object_info 读取模型、采样器、调度器、VAE 和 CLIP。</div>
                </div>

                <div class="setting-item">
                    <div class="setting-label">模型</div>
                    <select id="phone-image-comfyui-model" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                        <option value="${this._escapeHtml(comfyuiModel)}">${comfyuiModel ? this._escapeHtml(comfyuiModel) : '未选择模型'}</option>
                    </select>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div class="setting-item">
                        <div class="setting-label">采样器</div>
                        <select id="phone-image-comfyui-sampler" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                            <option value="${this._escapeHtml(comfyuiSampler)}">${this._escapeHtml(comfyuiSampler)}</option>
                        </select>
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">调度器</div>
                        <select id="phone-image-comfyui-scheduler" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                            <option value="${this._escapeHtml(comfyuiScheduler)}">${this._escapeHtml(comfyuiScheduler)}</option>
                        </select>
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">VAE</div>
                        <select id="phone-image-comfyui-vae" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                            <option value="${this._escapeHtml(comfyuiVae)}">${comfyuiVae ? this._escapeHtml(comfyuiVae) : '不指定'}</option>
                        </select>
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">CLIP</div>
                        <select id="phone-image-comfyui-clip" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                            <option value="${this._escapeHtml(comfyuiClip)}">${comfyuiClip ? this._escapeHtml(comfyuiClip) : '不指定'}</option>
                        </select>
                    </div>
                </div>

                <div class="setting-item">
                    <div style="display: flex; align-items: center; gap: 5px;">
                        <div class="setting-label">工作流 JSON</div>
                        <button type="button" id="phone-image-comfyui-workflow-help" aria-label="查看 ComfyUI 工作流说明" title="查看说明" style="width: 16px; height: 16px; border: 1px solid #d8d8d8; border-radius: 50%; background: #fff; color: #666; display: flex; align-items: center; justify-content: center; padding: 0; cursor: pointer; font-size: 10px; font-weight: 400; line-height: 1; font-family: Arial, sans-serif;">
                            i
                        </button>
                    </div>
                    <div class="setting-desc">工作流按蜜语、微信/日记、微博分别记住当前选择；微信和日记使用同一套工作流。</div>
                    <select id="phone-image-comfyui-app-select" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                        ${imagePromptAppOptions}
                    </select>
                    <select id="phone-image-comfyui-workflow-select" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                        <option value="">未选择工作流</option>
                        ${comfyuiWorkflowOptions}
                    </select>
                    <input type="text" id="phone-image-comfyui-workflow-name"
                           value="${activeComfyUIWorkflowName}"
                           placeholder="工作流名称，例如：基础文生图 / 微信参考图 / SDXL 高清"
                           style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 8px;">
                        <button id="phone-image-comfyui-workflow-save" class="setting-btn" style="height: 30px; padding: 0 8px; font-size: 12px; background: #fff; color: #078a46; border: 1px solid rgba(7,138,70,0.36); border-radius: 8px; cursor: pointer;">保存</button>
                        <button id="phone-image-comfyui-workflow-new" class="setting-btn" style="height: 30px; padding: 0 8px; font-size: 12px; background: #f2f2f2; color: #222; border: 1px solid #d8d8d8; border-radius: 8px; cursor: pointer;">新建</button>
                        <button id="phone-image-comfyui-workflow-delete" class="setting-btn" style="height: 30px; padding: 0 8px; font-size: 12px; background: #fff; color: #d33; border: 1px solid rgba(211,51,51,0.28); border-radius: 8px; cursor: pointer;">删除</button>
                        <button id="phone-image-comfyui-workflow-export" class="setting-btn" style="height: 30px; padding: 0 8px; font-size: 12px; background: #fff; color: #1d4ed8; border: 1px solid rgba(37,99,235,0.34); border-radius: 8px; cursor: pointer;">导出</button>
                        <button id="phone-image-comfyui-workflow-import" class="setting-btn" style="height: 30px; padding: 0 8px; font-size: 12px; background: #fff; color: #b45309; border: 1px solid rgba(245,158,11,0.42); border-radius: 8px; cursor: pointer;">导入</button>
                        <button id="phone-image-comfyui-workflow-clear" class="setting-btn" style="height: 30px; padding: 0 8px; font-size: 12px; background: #fff; color: #555; border: 1px solid #d8d8d8; border-radius: 8px; cursor: pointer;">内置</button>
                    </div>
                    <input type="file" id="phone-image-comfyui-workflow-import-file" accept=".json,application/json,text/json" style="display: none;">
                    <textarea id="phone-image-comfyui-workflow" rows="8"
                              style="width: 100%; min-height: 150px; padding: 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 11px; line-height: 1.45; background: #fafafa; box-sizing: border-box; margin-top: 6px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;">${this._escapeHtml(comfyuiWorkflow)}</textarea>
                </div>

                <textarea id="phone-image-comfyui-node-mapping" style="display:none;">${this._escapeHtml(comfyuiNodeMapping)}</textarea>

                <div class="setting-item">
                    <button id="phone-image-test-comfyui" class="phone-image-test-btn" style="width: 100%; height: 34px; border: none; border-radius: 8px; background: #10b981 !important; color: #fff !important; font-size: 13px; font-weight: 600; cursor: pointer;">
                        测试 ComfyUI 生图连接
                    </button>
                    <div class="setting-desc" id="phone-image-test-comfyui-result" style="margin-top: 6px;">使用当前 ComfyUI 工作流和蜜语尺寸生成一张测试图。</div>
                </div>
            </div>

            <div class="setting-section">
                <div class="setting-section-title">⚙️ 尺寸与通用参数</div>

                <div class="setting-item">
                    <div class="setting-label">各 App 生图尺寸</div>
                    <div class="setting-desc">蜜语默认使用 NAI 竖图；微信和日记默认小方图；微博默认方图。</div>
                    <button type="button" id="phone-image-reset-app-sizes" class="setting-btn" style="width: 100%; height: 30px; margin-top: 8px; border: 1px solid #d8d8d8; border-radius: 8px; background: #f7f7f7; color: #333; font-size: 12px; cursor: pointer;">恢复默认尺寸</button>
                    <div style="display: grid; grid-template-columns: 72px 1fr 1fr; gap: 8px; align-items: center; margin-top: 8px;">
                        <div style="font-size: 11px; color: #777;">App</div>
                        <div style="font-size: 11px; color: #777;">宽度</div>
                        <div style="font-size: 11px; color: #777;">高度</div>

                        <div style="font-size: 12px; color: #333;">蜜语</div>
                        <input type="number" id="phone-image-honey-width" min="64" max="2048" step="64" value="${honeyWidth}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box;">
                        <input type="number" id="phone-image-honey-height" min="64" max="2048" step="64" value="${honeyHeight}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box;">

                        <div style="font-size: 12px; color: #333;">微信</div>
                        <input type="number" id="phone-image-wechat-width" min="64" max="2048" step="64" value="${wechatWidth}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box;">
                        <input type="number" id="phone-image-wechat-height" min="64" max="2048" step="64" value="${wechatHeight}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box;">

                        <div style="font-size: 12px; color: #333;">微博</div>
                        <input type="number" id="phone-image-weibo-width" min="64" max="2048" step="64" value="${weiboWidth}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box;">
                        <input type="number" id="phone-image-weibo-height" min="64" max="2048" step="64" value="${weiboHeight}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box;">

                        <div style="font-size: 12px; color: #333;">日记</div>
                        <input type="number" id="phone-image-diary-width" min="64" max="2048" step="64" value="${diaryWidth}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box;">
                        <input type="number" id="phone-image-diary-height" min="64" max="2048" step="64" value="${diaryHeight}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box;">

                        <div style="font-size: 12px; color: #333;">全局兜底</div>
                        <input type="number" id="phone-image-width" min="64" max="2048" step="64" value="${width}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box;">
                        <input type="number" id="phone-image-height" min="64" max="2048" step="64" value="${height}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box;">
                    </div>
                </div>

                <div class="setting-item">
                    <div class="setting-label">固定前置提示词</div>
                    <div class="setting-desc">只对当前选择的 App 生效；日记跟随微信。画师串可放这里。</div>
                    <textarea id="phone-image-fixed-prompt" style="width: 100%; min-height: 58px; padding: 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; resize: vertical; margin-top: 6px;">${fixedPrompt}</textarea>
                </div>

                <div class="setting-item">
                    <div class="setting-label">固定后置提示词</div>
                    <div class="setting-desc">只对当前选择的 App 生效；日记跟随微信，会拼在 AI 本轮提示词后面。</div>
                    <textarea id="phone-image-fixed-prompt-end" style="width: 100%; min-height: 58px; padding: 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; resize: vertical; margin-top: 6px;">${fixedPromptEnd}</textarea>
                </div>

                <div class="setting-item">
                    <div class="setting-label">负面提示词</div>
                    <div class="setting-desc">只对当前选择的 App 生效；日记跟随微信，例如 low quality、bad hands、text、watermark。</div>
                    <textarea id="phone-image-negative-prompt" style="width: 100%; min-height: 70px; padding: 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; resize: vertical; margin-top: 6px;">${negativePrompt}</textarea>
                </div>

                <div class="setting-item phone-image-novelai-only" style="${novelaiOnlyDisplay}">
                    <div class="setting-label">氛围转移设置</div>
                    <div class="setting-desc">对应 NovelAI 官网的 Vibe Transfer，所有 App 的 NAI v4 / 4.5 生图共用当前启用组。</div>
                    <div style="display:grid; grid-template-columns:1fr 84px; gap:8px; margin-top:8px;">
                        <select id="phone-image-novelai-vibe-group-select" style="width:100%; height:30px; padding:0 8px; border:1px solid #e0e0e0; border-radius:8px; font-size:12px; background:#fafafa; box-sizing:border-box;">
                            <option value="">未选择 Vibe 组</option>
                            ${novelaiVibeGroupOptions}
                        </select>
                        <button type="button" id="phone-image-novelai-vibe-upload" style="height:30px; border:none; border-radius:8px; background:#7c3aed !important; color:#fff !important; font-size:12px; font-weight:600; cursor:pointer;">
                            <i class="fa-solid fa-upload"></i> 添加
                        </button>
                    </div>
                    <input type="text" id="phone-image-novelai-vibe-group-name"
                           value="${activeNovelAIVibeGroupName}"
                           placeholder="Vibe 组名称，例如：官网漫画风 / 暖色电影感"
                           style="width:100%; height:30px; padding:0 8px; border:1px solid #e0e0e0; border-radius:8px; font-size:12px; background:#fafafa; box-sizing:border-box; margin-top:6px;">
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-top:8px;">
                        <button type="button" id="phone-image-novelai-vibe-save" style="height:30px; padding:0 8px; font-size:12px; background:#fff; color:#078a46; border:1px solid rgba(7,138,70,0.36); border-radius:8px; cursor:pointer;">保存组</button>
                        <button type="button" id="phone-image-novelai-vibe-new" style="height:30px; padding:0 8px; font-size:12px; background:#f2f2f2; color:#222; border:1px solid #d8d8d8; border-radius:8px; cursor:pointer;">新建组</button>
                        <button type="button" id="phone-image-novelai-vibe-delete" style="height:30px; padding:0 8px; font-size:12px; background:#fff; color:#d33; border:1px solid rgba(211,51,51,0.28); border-radius:8px; cursor:pointer;">删除组</button>
                    </div>
                    <div id="phone-image-novelai-vibe-list" style="margin-top:8px;">
                        ${novelaiVibeGroupItemsHtml}
                    </div>
                    <input type="file" id="phone-image-novelai-vibe-file" accept="image/png,image/jpeg,image/webp,image/*" multiple style="display:none;">
                    <div class="setting-desc" id="phone-image-novelai-vibe-status" style="margin-top:8px;"></div>
                </div>

                <div class="setting-item setting-toggle phone-image-novelai-only" style="${novelaiOnlyDisplay}">
                    <div>
                        <div class="setting-label">启用 Vibe 组氛围转移</div>
                        <div class="setting-desc">使用当前 Vibe 组进行氛围转移。</div>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="phone-image-novelai-vibe-enabled" ${novelaiVibeEnabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>

                <div class="setting-item setting-toggle phone-image-novelai-only" style="${novelaiOnlyDisplay}">
                    <div>
                        <div class="setting-label">Normalize Reference Strength Values</div>
                        <div class="setting-desc">开启后会把当前组内 Vibe 强度归一化为总和 1.0。</div>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="phone-image-novelai-vibe-normalize-strength" ${novelaiVibeNormalizeStrength ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>
            </div>
        `;
    }
    // 渲染APP图标上传
    renderAppIconUpload() {
        // 从APPS配置中获取
        const APPS = this._getDefaultAppsForCustomization();
        const customNames = this._getCustomAppNames();
        
        return APPS.map(app => {
            const customIcon = this.imageManager.getAppIcon(app.id);
            const displayName = this._getAppDisplayName(app, customNames);
            return `
                <div class="upload-app-icon-item" data-app="${app.id}" data-upload-icon-target="upload-icon-${app.id}" role="button" tabindex="0" style="text-align: center; position: relative; touch-action: manipulation;">
                    <div style="display: block;">
                        <div style="width: 40px; height: 40px; border-radius: 10px;
                                    ${customIcon ? `background-image: url('${customIcon}'); background-size: contain; background-position: center; background-repeat: no-repeat; background-color: transparent;` : `background: ${app.color};`}
                                    display: flex; align-items: center; justify-content: center; margin: 0 auto;
                                    font-size: 20px;">
                            ${customIcon ? '' : app.icon}
                        </div>
                        <div style="font-size: 9px; margin-top: 3px; color: #666;">${this._escapeHtml(displayName)}</div>
                    </div>
                    <input type="file" id="upload-icon-${app.id}" accept="image/png, image/jpeg, image/gif, image/webp, image/svg+xml, image/*" style="position: fixed; left: -9999px; top: -9999px; width: 1px; height: 1px; opacity: 0;" class="app-icon-upload" data-app-id="${app.id}" tabindex="-1">
                </div>
            `;
        }).join('');
    }

    renderAppNameCustomization() {
        const apps = this._getDefaultAppsForCustomization();
        const customNames = this._getCustomAppNames();
        return apps.map(app => `
            <label class="app-name-custom-row">
                <span class="app-name-custom-label">${this._escapeHtml(app.name)}</span>
                <input class="app-name-custom-input" data-app-id="${this._escapeHtml(app.id)}" maxlength="8" value="${this._escapeHtml(String(customNames[app.id] || ''))}" placeholder="${this._escapeHtml(app.name)}">
            </label>
        `).join('');
    }

    // 🔥 渲染快捷栏配置
    renderDockConfig() {
        const APPS = this._getDefaultAppsForCustomization();
        const customNames = this._getCustomAppNames();

        // 获取当前配置
        let dockAppIds = ['wechat', 'weibo', 'phone', 'settings'];
        const saved = this.storage.get('dock-apps');
        if (saved) {
            try {
                dockAppIds = JSON.parse(saved);
            } catch (e) {}
        }

        return APPS.map((app, index) => {
            const isSelected = dockAppIds.includes(app.id);
            const customIcon = this.imageManager.getAppIcon(app.id);
            const displayName = this._getAppDisplayName(app, customNames);

            return `
                <div class="dock-config-item" data-app="${app.id}" style="text-align: center; cursor: pointer;">
                    <div style="width: 40px; height: 40px; border-radius: 10px;
                                ${customIcon ? `background-image: url('${customIcon}'); background-size: contain; background-position: center; background-repeat: no-repeat; background-color: transparent;` : `background: ${app.color};`}
                                display: flex; align-items: center; justify-content: center; margin: 0 auto;
                                font-size: 20px; position: relative;
                                border: 2px solid ${isSelected ? '#07c160' : 'transparent'};
                                box-shadow: ${isSelected ? '0 0 6px rgba(7, 193, 96, 0.5)' : 'none'};">
                        ${customIcon ? '' : app.icon}
                        ${isSelected ? '<span style="position: absolute; bottom: -2px; right: -2px; background: #07c160; color: #fff; width: 14px; height: 14px; border-radius: 50%; font-size: 9px; display: flex; align-items: center; justify-content: center;">✓</span>' : ''}
                    </div>
                    <div style="font-size: 9px; margin-top: 3px; color: #666;">${this._escapeHtml(displayName)}</div>
                </div>
            `;
        }).join('');
    }

    _getMemoryPermissionDefaults(appId) {
        const basePerms = {
            allowSummary: false,
            allowTable: false,
            allowVector: false,
            allowPrompt: false
        };
        const defaultsByApp = {
            wechat: { allowSummary: true, allowVector: true },
            weibo: { allowSummary: true, allowVector: true },
            diary: { allowSummary: true, allowVector: true },
            honey: { allowSummary: false, allowTable: false, allowVector: false, allowPrompt: false },
            phone_online: { allowSummary: false, allowTable: false, allowVector: false, allowPrompt: false }
        };
        return { ...basePerms, ...(defaultsByApp[appId] || {}) };
    }

    _getMemoryPermissionMap() {
        const rawPerms = this.storage.get('phone_memory_permissions');
        if (!rawPerms) return {};
        try {
            return typeof rawPerms === 'string' ? JSON.parse(rawPerms) : rawPerms;
        } catch (e) {
            console.warn('⚠️ 权限配置解析失败，已回退默认配置', e);
            return {};
        }
    }

    renderMemoryPermissionSection() {
        const isMemoryPermissionOpen = this.storage.get('phone-settings-memory-permission-open') === true;
        const userMessageListenerRaw = this.storage.get('phone-user-message-listener-enabled');
        const isUserMessageListenerEnabled = userMessageListenerRaw !== false && userMessageListenerRaw !== 'false';
        const wechatOfflineUserCleanRaw = this.storage.get('phone-wechat-offline-clean-user-reply-enabled');
        const isWechatOfflineUserCleanEnabled = wechatOfflineUserCleanRaw !== false && wechatOfflineUserCleanRaw !== 'false';
        const appDefs = [
            { id: 'wechat', name: '微信', desc: '聊天与社交场景' },
            { id: 'weibo', name: '微博', desc: '动态与评论场景' },
            { id: 'diary', name: '日记', desc: '日记生成场景' },
            { id: 'honey', name: '蜜语', desc: '直播互动场景' },
            { id: 'phone_online', name: '通话', desc: '语音/视频通话场景' }
        ];
        const allPerms = this._getMemoryPermissionMap();

        return `
            <details data-settings-fold-key="phone-settings-memory-permission-open" ${isMemoryPermissionOpen ? 'open' : ''} style="margin: 12px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                    <span>记忆表格联动</span>
                    ${SETTINGS_FOLD_ARROW_HTML}
                </summary>
                <div style="padding: 10px 10px 4px;">
                    <div class="setting-info">
                        控制手机各 App 对记忆插件的 API 权限通行证 (Signal) 下发。线下被动注入由记忆插件自身策略决定，不在此处配置。
                    </div>

                    <div class="setting-item setting-toggle">
                        <div>
                            <div class="setting-label">用户消息监听</div>
                            <div class="setting-desc">关闭后，酒馆正文生成时不做用户消息自动监听；明确的 &lt;回复联系人&gt; 标签仍会同步微信线上。</div>
                        </div>
                        <label class="toggle-switch">
                            <input type="checkbox" id="phone-user-message-listener-enabled" ${isUserMessageListenerEnabled ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>

                    <div class="setting-item setting-toggle" style="margin-top: 10px;">
                        <div>
                            <div class="setting-label">微信线下用户发言清洗</div>
                            <div class="setting-desc">开启后，线下转线上解析会清洗 AI 伪造的用户发言（如“用户: ...”）；关闭后保留并写入“我”的消息，适配 RP 扮演用户场景。</div>
                        </div>
                        <label class="toggle-switch">
                            <input type="checkbox" id="phone-wechat-offline-clean-user-reply-enabled" ${isWechatOfflineUserCleanEnabled ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>

                    ${appDefs.map(def => {
                        const merged = {
                            ...this._getMemoryPermissionDefaults(def.id),
                            ...(allPerms[def.id] || {})
                        };

                        return `
                            <div class="setting-item">
                                <div class="setting-label" style="font-size: 14px; color: #111;">${def.name}</div>
                                <div class="setting-desc">${def.desc}</div>
                                <div style="display: grid; grid-template-columns: repeat(2, minmax(120px, 1fr)); gap: 8px 10px; margin-top: 8px;">
                                    <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:#333;">
                                        <input type="checkbox" class="phone-memory-perm" data-app-id="${def.id}" data-perm-key="allowSummary" ${merged.allowSummary ? 'checked' : ''}>
                                        总结
                                    </label>
                                    <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:#333;">
                                        <input type="checkbox" class="phone-memory-perm" data-app-id="${def.id}" data-perm-key="allowTable" ${merged.allowTable ? 'checked' : ''}>
                                        表格数据
                                    </label>
                                    <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:#333;">
                                        <input type="checkbox" class="phone-memory-perm" data-app-id="${def.id}" data-perm-key="allowPrompt" ${merged.allowPrompt ? 'checked' : ''}>
                                        实时提示词
                                    </label>
                                    <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:#333;">
                                        <input type="checkbox" class="phone-memory-perm" data-app-id="${def.id}" data-perm-key="allowVector" ${merged.allowVector ? 'checked' : ''}>
                                        向量检索
                                    </label>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </details>
        `;
    }

    bindMemoryPermissionEvents() {
        const document = this._createSettingsScopedDocument();
        document.getElementById('phone-user-message-listener-enabled')?.addEventListener('change', async (e) => {
            await this.storage.set('phone-user-message-listener-enabled', !!e.target.checked);
        });
        document.getElementById('phone-wechat-offline-clean-user-reply-enabled')?.addEventListener('change', async (e) => {
            await this.storage.set('phone-wechat-offline-clean-user-reply-enabled', !!e.target.checked);
        });

        document.querySelectorAll('.phone-memory-perm').forEach(input => {
            const forceStyle = {
                appearance: 'auto',
                '-webkit-appearance': 'checkbox',
                opacity: '1',
                width: '16px',
                height: '16px',
                minWidth: '16px',
                minHeight: '16px',
                margin: '0',
                accentColor: '#30c46b',
                cursor: 'pointer',
                filter: 'none',
                transform: 'none'
            };
            Object.entries(forceStyle).forEach(([key, value]) => {
                const cssKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
                input.style.setProperty(cssKey, value, 'important');
            });
            input.addEventListener('change', async (e) => {
                const appId = String(e.target.dataset.appId || '').trim();
                const permKey = String(e.target.dataset.permKey || '').trim();
                if (!appId || !permKey) return;

                const allPerms = this._getMemoryPermissionMap();
                const merged = {
                    ...this._getMemoryPermissionDefaults(appId),
                    ...(allPerms[appId] || {})
                };
                merged[permKey] = !!e.target.checked;
                allPerms[appId] = merged;

                await this.storage.set('phone_memory_permissions', JSON.stringify(allPerms));
            });
        });
    }

    _escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _showPhoneConfirm({
        title = '确认操作',
        message = '',
        confirmText = '确定',
        cancelText = '取消',
        danger = false,
        host: preferredHost = null
    } = {}) {
        return new Promise((resolve) => {
            const host = preferredHost
                || document.querySelector('.phone-view-current .settings-app')
                || document.querySelector('.settings-app')
                || document.querySelector('.phone-view-current')
                || document.body;
            host.querySelector?.('#settings-phone-confirm-modal')?.remove();
            if (host !== document.body && window.getComputedStyle(host).position === 'static') {
                host.style.position = 'relative';
            }

            const overlay = document.createElement('div');
            overlay.id = 'settings-phone-confirm-modal';
            overlay.style.cssText = [
                'position:absolute',
                'inset:0',
                'z-index:10040',
                'display:flex',
                'align-items:center',
                'justify-content:center',
                'padding:16px',
                'box-sizing:border-box',
                'background:rgba(0,0,0,0.34)',
                'backdrop-filter:blur(8px)',
                '-webkit-backdrop-filter:blur(8px)'
            ].join(';');
            overlay.innerHTML = `
                <div role="dialog" aria-modal="true" style="width:100%; max-width:270px; background:rgba(255,255,255,0.92); color:#111; border-radius:14px; overflow:hidden; box-shadow:0 14px 34px rgba(0,0,0,0.24);">
                    <div style="padding:16px 16px 10px; text-align:center;">
                        <div style="font-size:15px; font-weight:700; line-height:1.35;">${this._escapeHtml(title)}</div>
                        <div style="font-size:12px; color:#555; line-height:1.55; margin-top:8px;">${this._escapeHtml(message)}</div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; border-top:1px solid rgba(0,0,0,0.08);">
                        <button type="button" data-action="cancel" style="height:42px; border:none; border-right:1px solid rgba(0,0,0,0.08); background:transparent; color:#333; font-size:14px; cursor:pointer;">${this._escapeHtml(cancelText)}</button>
                        <button type="button" data-action="confirm" style="height:42px; border:none; background:transparent; color:${danger ? '#d93025' : '#007aff'}; font-size:14px; font-weight:700; cursor:pointer;">${this._escapeHtml(confirmText)}</button>
                    </div>
                </div>
            `;

            const close = (value) => {
                overlay.remove();
                resolve(value);
            };
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) close(false);
            });
            overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', () => close(false));
            overlay.querySelector('[data-action="confirm"]')?.addEventListener('click', () => close(true));
            host.appendChild(overlay);
        });
    }

    _extractLastAssistantRawText(context) {
        if (!context?.chat || !Array.isArray(context.chat)) return '';

        for (let i = context.chat.length - 1; i >= 0; i--) {
            const msg = context.chat[i];
            if (!msg || msg.is_user || msg.role === 'system') continue;

            const swipeId = Number.isInteger(msg.swipe_id) ? msg.swipe_id : 0;
            if (Array.isArray(msg.swipes) && msg.swipes.length > swipeId && msg.swipes[swipeId]) {
                return String(msg.swipes[swipeId] || '');
            }
            if (msg.mes || msg.content) {
                return String(msg.mes || msg.content || '');
            }
        }

        return '';
    }

    renderTagFilterSection() {
        const cfg = readPhoneTagFilterConfig(this.storage);
        const hasMemoryFilter = hasGaigaiTagFilter();
        const isTagFilterOpen = this.storage.get('phone-settings-memory-tag-filter-open') === true;

        const blacklist = this._escapeHtml(cfg.blacklist);
        const whitelist = this._escapeHtml(cfg.whitelist);
        const memoryStatusText = hasMemoryFilter
            ? '✅ 已检测到记忆插件过滤器（优先使用记忆插件规则）'
            : '⚠️ 未检测到记忆插件过滤器（可启用下方本地过滤）';

        return `
            <details data-settings-fold-key="phone-settings-memory-tag-filter-open" ${isTagFilterOpen ? 'open' : ''} style="margin: 8px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                    <span>正文标签过滤</span>
                    ${SETTINGS_FOLD_ARROW_HTML}
                </summary>
                <div style="padding: 10px 10px 4px;">

                <div class="setting-item setting-toggle">
                    <div>
                        <div class="setting-label">启用本地标签过滤回退</div>
                        <div class="setting-desc">无记忆插件时，按下方黑白名单规则清洗正文/微博/日记/蜜语内容</div>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="phone-tag-filter-enabled" ${cfg.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>

                <div class="setting-item" style="padding-top: 6px;">
                    <div class="setting-desc" style="font-size: 12px; color: ${hasMemoryFilter ? '#07a35a' : '#b26a00'};">
                        ${memoryStatusText}
                    </div>
                </div>

                <div class="setting-item" style="display:block;">
                    <div class="setting-label" style="margin-bottom: 6px;">🚫 黑名单标签（去除）</div>
                    <textarea id="phone-tag-filter-blacklist" placeholder="例如：think, system, Memory, [歌曲], !--" style="width: 100%; min-height: 64px; padding: 8px 10px; border: 1px solid #e5e5e5; border-radius: 6px; font-size: 12px; line-height: 1.45; box-sizing: border-box; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;">${blacklist}</textarea>
                </div>

                <div class="setting-item" style="display:block;">
                    <div class="setting-label" style="margin-bottom: 6px;">✅ 白名单标签（仅留）</div>
                    <textarea id="phone-tag-filter-whitelist" placeholder="例如：content, globalTime, [时间]" style="width: 100%; min-height: 64px; padding: 8px 10px; border: 1px solid #e5e5e5; border-radius: 6px; font-size: 12px; line-height: 1.45; box-sizing: border-box; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;">${whitelist}</textarea>
                </div>

                <div class="setting-item setting-button" style="margin-top: 4px;">
                    <button class="setting-btn" id="phone-tag-filter-ai-diagnose" style="padding: 6px 10px; font-size: 12px; background: #17a2b8; color: #fff; border: none; border-radius: 6px;">
                        🤖 AI 智能诊断标签
                    </button>
                </div>

                <div class="setting-info">
                    过滤逻辑：先黑名单删除，再白名单提取。<br>
                    标签格式：尖括号标签填标签名（如 think），方括号标签请完整填（如 [歌曲]），HTML 注释填 !--。
                </div>
                </div>
            </details>
        `;
    }

    bindTagFilterEvents() {
        const document = this._createSettingsScopedDocument();
        const enabledInput = document.getElementById('phone-tag-filter-enabled');
        const blacklistInput = document.getElementById('phone-tag-filter-blacklist');
        const whitelistInput = document.getElementById('phone-tag-filter-whitelist');
        const diagnoseBtn = document.getElementById('phone-tag-filter-ai-diagnose');

        if (enabledInput) {
            enabledInput.addEventListener('change', async (e) => {
                await savePhoneTagFilterConfig(this.storage, { enabled: !!e.target.checked });
            });
        }

        let saveTimer = null;
        const queueSaveTextConfig = () => {
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(async () => {
                const blacklist = blacklistInput ? blacklistInput.value : '';
                const whitelist = whitelistInput ? whitelistInput.value : '';
                await savePhoneTagFilterConfig(this.storage, { blacklist, whitelist });
            }, 250);
        };

        if (blacklistInput) {
            blacklistInput.addEventListener('input', queueSaveTextConfig);
            blacklistInput.addEventListener('change', queueSaveTextConfig);
        }
        if (whitelistInput) {
            whitelistInput.addEventListener('input', queueSaveTextConfig);
            whitelistInput.addEventListener('change', queueSaveTextConfig);
        }

        if (diagnoseBtn) {
            diagnoseBtn.addEventListener('click', async () => {
                await this.runTagFilterAiDiagnosis();
            });
        }
    }

    async runTagFilterAiDiagnosis() {
        const document = this._createSettingsScopedDocument();
        const btn = document.getElementById('phone-tag-filter-ai-diagnose');
        const oldText = btn?.innerHTML || '🤖 AI 智能诊断标签';

        try {
            const context = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
                ? SillyTavern.getContext()
                : null;

            if (!context?.chat?.length) {
                alert('❌ 聊天记录为空，无法诊断');
                return;
            }

            const raw = this._extractLastAssistantRawText(context);
            if (!raw.trim()) {
                alert('❌ 未找到可诊断的 AI 回复');
                return;
            }

            if (!raw.includes('<') && !raw.includes('[')) {
                alert('ℹ️ 最后一条 AI 回复未检测到明显标签格式，无需诊断');
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 诊断中...';
            }

            const apiManager = window.VirtualPhone?.apiManager;
            if (!apiManager?.callAI) {
                throw new Error('API 管理器未初始化');
            }

            const sanitizedRaw = String(raw)
                .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+/g, '[BASE64_IMAGE]')
                .slice(0, 30000);
            const prompt = PHONE_TAG_FILTER_AI_DIAGNOSTIC_PROMPT.replace('{{RAW_TEXT}}', sanitizedRaw);

            const result = await apiManager.callAI(
                [{ role: 'user', content: prompt }],
                { appId: 'phone_online', max_tokens: 1200 }
            );

            if (!result?.success) {
                throw new Error(result?.error || 'AI 返回为空');
            }

            const parsed = parsePhoneTagFilterDiagnosticJson(result.summary || result.content || result.text || '');
            const hasBlacklist = Array.isArray(parsed.blacklist) && parsed.blacklist.length > 0;
            const hasWhitelist = Array.isArray(parsed.whitelist) && parsed.whitelist.length > 0;

            if (!hasBlacklist && !hasWhitelist) {
                alert('✅ AI 诊断完毕：当前文本无需新增过滤标签');
                return;
            }

            let confirmText = '🤖 AI 诊断结果：\n\n';
            if (parsed.reasoning) confirmText += `分析思路：${parsed.reasoning}\n\n`;
            if (hasBlacklist) confirmText += `黑名单建议：${parsed.blacklist.join(', ')}\n`;
            if (hasWhitelist) confirmText += `白名单建议：${parsed.whitelist.join(', ')}\n`;
            confirmText += '\n是否应用到输入框并保存？';

            if (!confirm(confirmText)) return;

            const blacklistValue = hasBlacklist ? parsed.blacklist.join(', ') : '';
            const whitelistValue = hasWhitelist ? parsed.whitelist.join(', ') : '';

            const blacklistInput = document.getElementById('phone-tag-filter-blacklist');
            const whitelistInput = document.getElementById('phone-tag-filter-whitelist');
            if (blacklistInput) blacklistInput.value = blacklistValue;
            if (whitelistInput) whitelistInput.value = whitelistValue;

            await savePhoneTagFilterConfig(this.storage, {
                blacklist: blacklistValue,
                whitelist: whitelistValue
            });

            if (blacklistInput) blacklistInput.style.background = 'rgba(76, 175, 80, 0.16)';
            if (whitelistInput) whitelistInput.style.background = 'rgba(76, 175, 80, 0.16)';
            setTimeout(() => {
                if (blacklistInput) blacklistInput.style.background = '';
                if (whitelistInput) whitelistInput.style.background = '';
            }, 900);

            alert('✅ 标签规则已更新并保存');
        } catch (error) {
            console.error('标签 AI 诊断失败:', error);
            alert('❌ AI 诊断失败：' + (error?.message || error));
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = oldText;
            }
        }
    }

    bindEvents() {
        const globalDocument = globalThis.document;
        const settingsRoot = this._getActiveSettingsRoot();
        const document = this._createSettingsScopedDocument(settingsRoot);
        const $ = (selector) => settingsRoot?.querySelector(selector) || document.querySelector(selector);

        const bindLobbyEvents = () => {
            const lobbyRoot = settingsRoot?.querySelector('#tab-lobby') || document.getElementById('tab-lobby');
            if (!lobbyRoot) return;

            const bindChecks = async () => {
                this._refreshLobbySelectionCountInDom();
                await this._saveLobbySelectionFromDom();
            };

            lobbyRoot.querySelectorAll('.phone-lobby-character-check, .phone-lobby-group-check').forEach(input => {
                input.addEventListener('change', () => {
                    bindChecks();
                });
            });

            document.getElementById('phone-lobby-groups-select-all')?.addEventListener('click', async () => {
                await this._setAllLobbyCheckboxes('.phone-lobby-group-check', true);
            });
            document.getElementById('phone-lobby-groups-clear')?.addEventListener('click', async () => {
                await this._setAllLobbyCheckboxes('.phone-lobby-group-check', false);
            });
            document.getElementById('phone-lobby-characters-select-all')?.addEventListener('click', async () => {
                await this._setAllLobbyCheckboxes('.phone-lobby-character-check', true);
            });
            document.getElementById('phone-lobby-characters-clear')?.addEventListener('click', async () => {
                await this._setAllLobbyCheckboxes('.phone-lobby-character-check', false);
            });
            document.getElementById('phone-lobby-refresh')?.addEventListener('click', () => {
                this.render();
            });
        };

        // Tab 切换
        document.querySelectorAll('.settings-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const nextTab = btn.dataset.tab;
                if (!nextTab || nextTab === this.currentTab) return;
                this.currentTab = nextTab;
                this.render();
            });
        });
        bindLobbyEvents();

        document.querySelectorAll('[data-settings-fold-key]').forEach((foldEl) => {
            foldEl.addEventListener('toggle', async () => {
                const key = foldEl.dataset.settingsFoldKey;
                if (!key) return;
                await this.storage.set(key, !!foldEl.open);
            });
        });

        // 上传壁纸 - 支持裁剪
        document.querySelectorAll('.settings-app #phone-version-info-btn').forEach((versionInfoBtn) => versionInfoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof window.VirtualPhone?.showCurrentUpdateInfo === 'function') {
                window.VirtualPhone.showCurrentUpdateInfo();
            }
        }));

        const formatImageUploadError = (err) => {
            const message = String(err?.message || err || '未知错误').trim() || '未知错误';
            if (/Failed to fetch|NetworkError|Load failed|Network request failed/i.test(message)) {
                return `${message}\n\n请确认当前页面能访问 /api/backgrounds/upload 和 /backgrounds/，移动端反代或登录 Cookie 异常时会导致上传失败。`;
            }
            return message;
        };

        document.getElementById('choose-wallpaper-btn')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            document.getElementById('upload-wallpaper')?.click?.();
        });

        document.getElementById('upload-wallpaper')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // 重置input
            e.target.value = '';

            try {
                // 使用裁剪器
                const cropper = new ImageCropper({
                    title: '裁剪壁纸',
                    outputWidth: 400,
                    outputHeight: 800,
                    quality: 0.85,
                    maxFileSize: SETTINGS_IMAGE_MAX_FILE_SIZE
                });

                const croppedImage = await cropper.open(file);
                const oldWallpaper = this.imageManager.getWallpaper();
                await this.imageManager.deleteManagedBackgroundByPath(oldWallpaper, { quiet: true });

                // 🔥 上传到服务端，避免 Base64 撑大存档
                const serverUrl = await this.imageManager._uploadToServer(croppedImage, 'wallpaper', { allowBase64Fallback: false });

                // 保存壁纸
                this.imageManager.cache.wallpaper = serverUrl;
                await this.imageManager.saveImages(this.imageManager.cache);

                // 更新预览
                const preview = document.getElementById('wallpaper-preview');
                const img = preview.querySelector('img');
                preview.style.display = 'block';
                img.style.display = 'block';
                img.src = serverUrl;
                const settingsRoot = document.querySelector('.phone-view-current .settings-app') || document.querySelector('.settings-app');
                if (settingsRoot) {
                    settingsRoot.classList.add('settings-has-wallpaper');
                    settingsRoot.style.backgroundImage = `url("${serverUrl.replace(/"/g, '\\"')}")`;
                    settingsRoot.style.backgroundSize = 'cover';
                    settingsRoot.style.backgroundPosition = 'center';
                }

                // 通知主屏幕更新
                window.dispatchEvent(new CustomEvent('phone:updateWallpaper', {
                    detail: { wallpaper: serverUrl }
                }));

                alert('✅ 壁纸上传成功！');
            } catch (err) {
                if (err.message !== '用户取消') {
                    alert('❌ 上传失败：' + formatImageUploadError(err));
                }
            }
        });
        
        // 删除壁纸
        document.querySelectorAll('.settings-app #delete-wallpaper').forEach((deleteWallpaperBtn) => deleteWallpaperBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const activeSettingsRoot = event.currentTarget?.closest?.('.settings-app') || settingsRoot;
            const ok = await this._showPhoneConfirm({
                title: '删除壁纸',
                message: '确定删除手机桌面壁纸吗？',
                confirmText: '删除',
                cancelText: '取消',
                danger: true,
                host: activeSettingsRoot
            });
            if (!ok) return;

            const oldWallpaper = this.imageManager.getWallpaper?.();
            try {
                await this.imageManager.deleteWallpaper();
            } catch (err) {
                console.warn('[Settings] 删除壁纸文件失败，已继续清空本地壁纸设置:', err);
                await this.imageManager.deleteManagedBackgroundByPath?.(oldWallpaper, { quiet: true });
                this.imageManager.cache.wallpaper = null;
                await this.imageManager.saveImages(this.imageManager.cache);
            }

            const preview = activeSettingsRoot?.querySelector('#wallpaper-preview') || document.getElementById('wallpaper-preview');
            if (preview) {
                preview.style.display = 'none';
                const img = preview.querySelector('img');
                if (img) {
                    img.style.display = 'none';
                    img.removeAttribute('src');
                }
            }

            if (activeSettingsRoot) {
                activeSettingsRoot.classList.remove('settings-has-wallpaper');
                activeSettingsRoot.style.backgroundImage = '';
                activeSettingsRoot.style.backgroundSize = '';
                activeSettingsRoot.style.backgroundPosition = '';
            }

            // 通知主屏幕更新
            window.dispatchEvent(new CustomEvent('phone:updateWallpaper', { 
                detail: { wallpaper: null } 
            }));
            
            this.phoneShell?.showNotification?.('已删除', '手机壁纸已删除', '✅');
        }));

        document.getElementById('choose-card-time-image-btn')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            document.getElementById('upload-card-time-image')?.click?.();
        });

        document.getElementById('upload-card-time-image')?.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            e.target.value = '';

            try {
                const cropper = new ImageCropper({
                    title: '裁剪时间卡片图片',
                    outputWidth: 800,
                    outputHeight: 320,
                    preserveTransparency: true,
                    outputFormat: ['image/png', 'image/svg+xml', 'image/webp'].includes(String(file.type || '').toLowerCase()) ? 'image/png' : 'image/jpeg',
                    quality: 0.85,
                    maxFileSize: SETTINGS_IMAGE_MAX_FILE_SIZE
                });

                const croppedImage = await cropper.open(file);
                const oldImage = this.storage.get('phone-card-time-image') || null;
                await this.imageManager.deleteManagedBackgroundByPath(oldImage, { quiet: true });
                const serverUrl = await this.imageManager._uploadToServer(croppedImage, 'card_time', { allowBase64Fallback: false });
                await this.storage.set('phone-card-time-image', serverUrl);

                const preview = document.getElementById('card-time-image-preview');
                const img = preview?.querySelector('img');
                if (preview && img) {
                    preview.style.display = 'block';
                    img.style.display = 'block';
                    img.src = serverUrl;
                }

                window.VirtualPhone?.home?.render?.({ forceDomRefresh: true });
                alert('✅ 时间卡片图片上传成功！');
            } catch (err) {
                if (err.message !== '用户取消') {
                    alert('❌ 上传失败：' + formatImageUploadError(err));
                }
            }
        });

        document.getElementById('delete-card-time-image')?.addEventListener('click', async () => {
            if (!confirm('确定删除时间卡片图片吗？')) return;

            const oldImage = this.storage.get('phone-card-time-image') || null;
            await this.imageManager.deleteManagedBackgroundByPath(oldImage, { quiet: true });
            await this.storage.remove('phone-card-time-image');

            const preview = document.getElementById('card-time-image-preview');
            const img = preview?.querySelector('img');
            if (preview && img) {
                preview.style.display = 'none';
                img.style.display = 'none';
                img.src = '';
            }

            window.VirtualPhone?.home?.render?.({ forceDomRefresh: true });
            alert('✅ 时间卡片图片已删除！');
        });

        document.getElementById('phone-home-layout')?.addEventListener('change', async (e) => {
            const value = String(e.target.value || 'icons') === 'cards' ? 'cards' : 'icons';
            await this.storage.set('phone-home-layout', value);
            this.phoneShell?.syncHomeLayoutChromeClass?.();
            window.VirtualPhone?.home?.render?.({ forceDomRefresh: true });
        });

        document.getElementById('save-card-layout-css')?.addEventListener('click', async () => {
            const textarea = document.getElementById('phone-card-layout-custom-css');
            const cssText = String(textarea?.value || '').trim();
            await this.storage.set(CARD_LAYOUT_CUSTOM_CSS_KEY, cssText);
            window.dispatchEvent(new CustomEvent('phone:updateCardLayoutCss'));
            window.VirtualPhone?.home?.render?.({ forceDomRefresh: true });
            this.phoneShell?.showNotification?.('已保存', '卡片式首页 CSS 已生效', '✅');
        });

        document.getElementById('insert-card-layout-css-template')?.addEventListener('click', () => {
            const textarea = document.getElementById('phone-card-layout-custom-css');
            if (!textarea) return;
            textarea.value = this._getCardLayoutCssTemplate();
            textarea.focus();
        });

        document.getElementById('clear-card-layout-css')?.addEventListener('click', async () => {
            const ok = confirm('确定清空卡片式首页 CSS 吗？');
            if (!ok) return;
            const textarea = document.getElementById('phone-card-layout-custom-css');
            if (textarea) textarea.value = '';
            await this.storage.set(CARD_LAYOUT_CUSTOM_CSS_KEY, '');
            window.dispatchEvent(new CustomEvent('phone:updateCardLayoutCss'));
            window.VirtualPhone?.home?.render?.({ forceDomRefresh: true });
            this.phoneShell?.showNotification?.('已清空', '卡片式首页 CSS 已恢复默认', '✅');
        });

        const phoneShellScaleSlider = document.getElementById('phone-shell-scale-slider');
        const phoneShellScaleValue = document.getElementById('phone-shell-scale-value');
        const syncPhoneShellScaleDisplay = (value) => {
            const percent = normalizePhoneShellScalePercent(value);
            if (phoneShellScaleSlider) phoneShellScaleSlider.value = String(percent);
            if (phoneShellScaleValue) phoneShellScaleValue.textContent = `${percent}%`;
            applyPhoneShellScale(percent);
            return percent;
        };

        phoneShellScaleSlider?.addEventListener('input', (e) => {
            syncPhoneShellScaleDisplay(e.target.value);
        });

        ['pointerdown', 'touchstart', 'touchmove'].forEach((eventName) => {
            phoneShellScaleSlider?.addEventListener(eventName, (e) => {
                e.stopPropagation();
            }, { passive: true });
        });

        phoneShellScaleSlider?.addEventListener('change', async (e) => {
            const percent = syncPhoneShellScaleDisplay(e.target.value);
            await this.storage.set('phone-shell-scale', percent);
        });

        document.getElementById('phone-shell-scale-reset')?.addEventListener('click', async () => {
            const percent = syncPhoneShellScaleDisplay(PHONE_SHELL_SCALE_DEFAULT);
            await this.storage.set('phone-shell-scale', percent);
        });

        document.getElementById('phone-frame-color-picker')?.addEventListener('input', (e) => {
            const color = e.target.value || '#1a1a1a';
            document.documentElement.style.setProperty('--phone-frame-color', color);
        });

        document.getElementById('phone-frame-color-picker')?.addEventListener('change', async (e) => {
            const color = e.target.value || '#1a1a1a';
            await this.storage.set('phone-frame-color', color);
            document.documentElement.style.setProperty('--phone-frame-color', color);
        });
        
        // APP图标上传 - 支持裁剪和PNG透明
        document.querySelectorAll('.upload-app-icon-item[data-upload-icon-target]').forEach(item => {
            const openPicker = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const inputId = item.dataset.uploadIconTarget;
                const input = inputId ? document.getElementById(inputId) : null;
                input?.click?.();
            };
            item.addEventListener('click', openPicker);
            item.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                openPicker(e);
            });
        });

        document.querySelectorAll('.app-icon-upload').forEach(input => {
            input.addEventListener('click', (e) => e.stopPropagation());
            input.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const appId = e.target.id.replace('upload-icon-', '');

                // 重置input
                e.target.value = '';

                try {
                    // 使用裁剪器，支持PNG透明
                    const cropper = new ImageCropper({
                        title: '裁剪应用图标',
                        aspectRatio: 1, // 正方形图标
                        outputWidth: 200,
                        outputHeight: 200,
                        preserveTransparency: true, // 支持PNG透明
                        outputFormat: ['image/png', 'image/svg+xml', 'image/webp'].includes(String(file.type || '').toLowerCase()) ? 'image/png' : 'image/jpeg',
                        quality: 0.9,
                        maxFileSize: SETTINGS_IMAGE_MAX_FILE_SIZE
                    });

                    const croppedImage = await cropper.open(file);
                    const oldIcon = this.imageManager.getAppIcon(appId);
                    await this.imageManager.deleteManagedBackgroundByPath(oldIcon, { quiet: true });

                    // 🔥 上传到服务端，避免 Base64 撑大存档
                    const serverUrl = await this.imageManager._uploadToServer(croppedImage, `icon_${appId}`, { allowBase64Fallback: false });

                    this.imageManager.cache.appIcons[appId] = serverUrl;
                    await this.imageManager.saveImages(this.imageManager.cache);

                    // 通知主屏幕更新图标
                    window.dispatchEvent(new CustomEvent('phone:updateAppIcon', {
                        detail: { appId, icon: serverUrl }
                    }));

                    alert('✅ 图标上传成功！');

                    // 重新渲染设置页面（保持在设置页面）
                    this.render();
                } catch (err) {
                    if (err.message !== '用户取消') {
                        alert('❌ 上传失败：' + formatImageUploadError(err));
                    }
                }
            });
        });

        // 一键恢复默认APP图标 + 清理上传文件
        document.getElementById('reset-app-icons-and-cleanup')?.addEventListener('click', async () => {
            const ok = confirm('确定恢复默认 APP 图标并清理已上传图标文件吗？\n\n该操作会清空当前自定义图标配置，且尝试删除对应 /backgrounds 文件。');
            if (!ok) return;

            const btn = document.getElementById('reset-app-icons-and-cleanup');
            const oldText = btn?.innerHTML;
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在恢复...';
            }

            try {
                const result = await this.imageManager.resetAppIconsAndCleanupUploads();

                const summary = [
                    `✅ 已恢复默认图标（${result.resetCount} 项）`,
                    `🧹 已清理上传文件：${result.fileDeleteSuccess}/${result.fileDeleteAttempted}`
                ];
                if (result.fileDeleteFailed > 0) {
                    summary.push(`⚠️ ${result.fileDeleteFailed} 个文件未能自动删除（可能是当前酒馆版本不支持删除接口），但图标引用已清空。`);
                }

                alert(summary.join('\n'));

                // 通知主屏幕刷新图标（重置后需要立即生效）
                window.dispatchEvent(new CustomEvent('phone:updateAppIcon', {
                    detail: { reset: true }
                }));

                this.render();
            } catch (e) {
                alert('❌ 恢复失败：' + (e?.message || e));
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = oldText || '恢复默认图标并清理上传';
                }
            }
        });

        document.getElementById('save-app-custom-names')?.addEventListener('click', async () => {
            const defaults = new Map(this._getDefaultAppsForCustomization().map(app => [app.id, app.name]));
            const names = {};
            document.querySelectorAll('.app-name-custom-input').forEach(input => {
                const appId = String(input.dataset.appId || '').trim();
                const value = String(input.value || '').trim().slice(0, 8);
                if (!appId || !value) return;
                if (value === defaults.get(appId)) return;
                names[appId] = value;
            });

            await this.storage.set('phone-app-custom-names', JSON.stringify(names));
            window.dispatchEvent(new CustomEvent('phone:updateAppIcon'));
            this.phoneShell?.showNotification?.('已保存', 'APP显示名称已更新', '✅');
            this.render();
        });

        document.getElementById('reset-app-custom-names')?.addEventListener('click', async () => {
            await this.storage.set('phone-app-custom-names', JSON.stringify({}));
            window.dispatchEvent(new CustomEvent('phone:updateAppIcon'));
            this.phoneShell?.showNotification?.('已恢复', 'APP显示名称已恢复默认', '✅');
            this.render();
        });
        
        // 互通模式切换（会话模式用会话键；大厅模式用全局键）
        document.getElementById('setting-wechat-interop-mode')?.addEventListener('change', async (e) => {
            const context = this.storage.getContext();
            const interopModeKey = this._getWechatInteropModeStorageKey(context);
            const onlineOnlyModeKey = this._getWechatOnlineOnlyModeStorageKey(context);
            const proactiveEnabledKey = this._getWechatOnlineProactiveEnabledStorageKey(context);
            const enabled = !!e.target.checked;
            await this.storage.set(interopModeKey, enabled);
            if (enabled) {
                await this.storage.set(onlineOnlyModeKey, false);
                await this.storage.set(proactiveEnabledKey, false);
                await window.VirtualPhone?.resetWechatOnlineProactiveSessionTimer?.('switch_to_interop');
                const onlineOnlyToggle = document.getElementById('setting-wechat-online-only-mode');
                if (onlineOnlyToggle) onlineOnlyToggle.checked = false;
                const proactiveToggle = document.getElementById('setting-wechat-online-proactive-enabled');
                if (proactiveToggle) proactiveToggle.checked = false;
                WECHAT_OFFLINE_INJECTION_TOGGLE_KEYS.forEach((key) => {
                    const toggle = document.getElementById(key);
                    if (toggle) toggle.disabled = false;
                });
            }
        });

        // 线上模式切换：与互通模式互斥，并强制关闭微信线下注入开关
        document.getElementById('setting-wechat-online-only-mode')?.addEventListener('change', async (e) => {
            const context = this.storage.getContext();
            const interopModeKey = this._getWechatInteropModeStorageKey(context);
            const onlineOnlyModeKey = this._getWechatOnlineOnlyModeStorageKey(context);
            const proactiveEnabledKey = this._getWechatOnlineProactiveEnabledStorageKey(context);
            const enabled = !!e.target.checked;
            await this.storage.set(onlineOnlyModeKey, enabled);
            if (enabled) {
                await this.storage.set(interopModeKey, false);
                await window.VirtualPhone?.resetWechatOnlineProactiveSessionTimer?.('switch_to_online');
                const interopToggle = document.getElementById('setting-wechat-interop-mode');
                if (interopToggle) interopToggle.checked = false;

                await this._disableWechatOfflineInjectionToggles();
                WECHAT_OFFLINE_INJECTION_TOGGLE_KEYS.forEach((key) => {
                    const toggle = document.getElementById(key);
                    if (toggle) {
                        toggle.checked = false;
                        toggle.disabled = true;
                    }
                });
            } else {
                await this.storage.set(proactiveEnabledKey, false);
                await window.VirtualPhone?.resetWechatOnlineProactiveSessionTimer?.('online_off');
                const proactiveToggle = document.getElementById('setting-wechat-online-proactive-enabled');
                if (proactiveToggle) proactiveToggle.checked = false;
                WECHAT_OFFLINE_INJECTION_TOGGLE_KEYS.forEach((key) => {
                    const toggle = document.getElementById(key);
                    if (toggle) toggle.disabled = false;
                });
            }
        });

        document.getElementById('setting-wechat-online-proactive-enabled')?.addEventListener('change', async (e) => {
            const context = this.storage.getContext();
            if (!this._isStorageTruthy(this._getWechatOnlineOnlyModeStorageKey(context))) {
                e.target.checked = false;
                this.phoneShell?.showNotification?.('线上主动触发', '请先开启线上模式', '⚠️');
                return;
            }
            const key = this._getWechatOnlineProactiveEnabledStorageKey(context);
            await this.storage.set(key, !!e.target.checked);
        });

        document.getElementById('setting-wechat-message-sound-enabled')?.addEventListener('change', async (e) => {
            const enabled = !!e.target.checked;
            await this.storage.set(WECHAT_MESSAGE_SOUND_ENABLED_KEY, enabled);
            this.phoneShell?.showNotification?.('微信提示音', enabled ? '已开启' : '已关闭', enabled ? '✅' : '📵');
            if (enabled) window.VirtualPhone?.playWechatMessageSound?.({ source: 'settings_preview', throttleMs: 0 });
        });

        document.getElementById('setting-wechat-online-proactive-interval')?.addEventListener('change', async (e) => {
            const limit = Number.parseInt(e.target.value, 10) || 10;
            const validLimit = Math.max(1, Math.min(9999, limit));
            e.target.value = validLimit;
            const key = this._getWechatOnlineProactiveIntervalStorageKey(this.storage.getContext());
            await this.storage.set(key, validLimit);
        });

        document.getElementById('setting-wechat-online-proactive-test')?.addEventListener('click', async () => {
            const runner = window.VirtualPhone?.triggerWechatOnlineProactive;
            if (typeof runner !== 'function') {
                this.phoneShell?.showNotification?.('线上主动触发', '调度器尚未初始化', '⚠️');
                return;
            }
            await runner({ force: true, reason: 'settings_test' });
        });

        // 快捷回复按钮开关
        document.getElementById('setting-inline-reply-btn')?.addEventListener('change', (e) => {
            this.storage.set('phone_inline_reply_btn', e.target.checked);
        });

        // 一键更新所有提示词（恢复默认）
        document.getElementById('setting-reset-all-prompts')?.addEventListener('click', async (e) => {
            const ok = confirm('确定将所有 APP 默认提示词一键同步为最新版本吗？\n\n若某项当前使用自定义预设，更新后会自动切回该自定义预设；已保存的自定义预设不会被覆盖。');
            if (!ok) return;

            const btn = e.currentTarget;
            const oldText = btn?.innerHTML;
            try {
                if (btn) {
                    btn.disabled = true;
                    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在更新...';
                }
                const promptManager = window.VirtualPhone?.promptManager;
                if (!promptManager) {
                    alert('❌ 提示词管理器未初始化');
                    return;
                }

                let resetResult = null;
                if (typeof promptManager.resetAllPromptsToDefault === 'function') {
                    resetResult = await promptManager.resetAllPromptsToDefault();
                } else {
                    const defaults = promptManager.getDefaultPrompts?.();
                    if (!defaults) throw new Error('无法读取默认提示词');
                    promptManager.prompts = JSON.parse(JSON.stringify(defaults));
                    promptManager._loaded = true;
                    if (typeof promptManager.savePrompts === 'function') {
                        await promptManager.savePrompts();
                    } else {
                        await this.storage.set('phone-prompts', JSON.stringify(defaults), true);
                    }
                }
                await this.storage.set('games_poker_ai_prompt', '', true);

                const restoredCount = Number(resetResult?.restoredActivePresetCount || 0);
                const defaultCount = Number(resetResult?.defaultPromptCount || 0);
                const details = [
                    defaultCount > 0 ? `已同步 ${defaultCount} 个官方默认提示词。` : '已同步官方默认提示词。',
                    restoredCount > 0
                        ? `当前正在使用的 ${restoredCount} 个自定义预设已自动保留并继续生效。`
                        : '当前使用默认预设的项目已切换到最新官方默认版本。'
                ];
                alert(`✅ 已一键同步默认提示词为最新版本\n\n${details.join('\n')}\n\n已保存的自定义预设不会被覆盖。`);
            } catch (e) {
                console.error('❌ 一键更新所有提示词失败:', e);
                alert('❌ 更新失败：' + (e?.message || e));
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = oldText || '<i class="fa-solid fa-rotate"></i> 一键更新所有提示词（恢复默认）';
                }
            }
        });

        // 🔥 上下文楼层限制设置
        document.getElementById('phone-context-limit')?.addEventListener('change', async (e) => {
            const validLimit = normalizePhoneContextLimit(e.target.value);
            e.target.value = validLimit;
            await this.storage.set(PHONE_CONTEXT_LIMIT_KEY, validLimit);
        });

        // 🔥 单聊记录发送条数设置
        document.getElementById('wechat-single-chat-limit')?.addEventListener('change', async (e) => {
            const limit = Number.parseInt(e.target.value, 10);
            const validLimit = Math.max(0, Math.min(9999, Number.isFinite(limit) ? limit : 200));
            e.target.value = validLimit;
            await this.storage.set('wechat-single-chat-limit', validLimit);
        });

        // 🔥 群聊记录发送条数设置
        document.getElementById('wechat-group-chat-limit')?.addEventListener('change', async (e) => {
            const limit = Number.parseInt(e.target.value, 10);
            const validLimit = Math.max(0, Math.min(9999, Number.isFinite(limit) ? limit : 200));
            e.target.value = validLimit;
            await this.storage.set('wechat-group-chat-limit', validLimit);
        });

        document.getElementById('wechat-single-call-history-limit')?.addEventListener('change', async (e) => {
            const limit = Number.parseInt(e.target.value, 10);
            const validLimit = Math.max(0, Math.min(9999, Number.isFinite(limit) ? limit : 30));
            e.target.value = validLimit;
            await this.storage.set('wechat-single-call-history-limit', validLimit);
        });

        document.getElementById('wechat-group-call-history-limit')?.addEventListener('change', async (e) => {
            const limit = Number.parseInt(e.target.value, 10);
            const validLimit = Math.max(0, Math.min(9999, Number.isFinite(limit) ? limit : 50));
            e.target.value = validLimit;
            await this.storage.set('wechat-group-call-history-limit', validLimit);
        });

        // 🔥 线下单聊发送条数设置
        document.getElementById('offline-single-chat-enabled')?.addEventListener('change', async (e) => {
            if (this._isWechatOnlineOnlyModeEnabled()) {
                e.target.checked = false;
                await this.storage.set('offline-single-chat-enabled', false);
                return;
            }
            await this.storage.set('offline-single-chat-enabled', !!e.target.checked);
        });

        document.getElementById('offline-wechat-prompt-enabled')?.addEventListener('change', async (e) => {
            if (this._isWechatOnlineOnlyModeEnabled()) {
                e.target.checked = false;
                await this.storage.set('offline-wechat-prompt-enabled', false);
                return;
            }
            await this.storage.set('offline-wechat-prompt-enabled', !!e.target.checked);
        });

        document.getElementById('offline-single-chat-limit')?.addEventListener('change', async (e) => {
            const limit = parseInt(e.target.value) || 30;
            const validLimit = Math.max(1, Math.min(9999, limit));
            e.target.value = validLimit;
            await this.storage.set('offline-single-chat-limit', validLimit);
        });

        // 🔥 线下群聊发送条数设置
        document.getElementById('offline-group-chat-enabled')?.addEventListener('change', async (e) => {
            if (this._isWechatOnlineOnlyModeEnabled()) {
                e.target.checked = false;
                await this.storage.set('offline-group-chat-enabled', false);
                return;
            }
            await this.storage.set('offline-group-chat-enabled', !!e.target.checked);
        });

        document.getElementById('offline-group-chat-limit')?.addEventListener('change', async (e) => {
            const limit = parseInt(e.target.value) || 10;
            const validLimit = Math.max(1, Math.min(9999, limit));
            e.target.value = validLimit;
            await this.storage.set('offline-group-chat-limit', validLimit);
        });

        document.getElementById('offline-honey-chat-enabled')?.addEventListener('change', async (e) => {
            await this.storage.set('offline-honey-chat-enabled', !!e.target.checked);
        });

        document.getElementById('offline-diary-history-enabled')?.addEventListener('change', async (e) => {
            await this.storage.set('offline-diary-history-enabled', !!e.target.checked);
        });

        document.getElementById('offline-diary-history-limit')?.addEventListener('change', async (e) => {
            const limit = parseInt(e.target.value) || 10;
            const validLimit = Math.max(1, Math.min(9999, limit));
            e.target.value = validLimit;
            await this.storage.set('offline-diary-history-limit', validLimit);
        });

        // 📞 线下通话记录注入开关
        document.getElementById('offline-phone-call-history-enabled')?.addEventListener('change', async (e) => {
            await this.storage.set('offline-phone-call-history-enabled', !!e.target.checked);
        });

        // 📞 通话发送条数设置
        document.getElementById('phone-call-limit')?.addEventListener('change', async (e) => {
            const limit = parseInt(e.target.value) || 10;
            const validLimit = Math.max(1, Math.min(9999, limit));
            e.target.value = validLimit;
            await this.storage.set('phone-call-limit', validLimit);
        });

        // 🧾 线下微博注入开关
        document.getElementById('offline-weibo-history-enabled')?.addEventListener('change', async (e) => {
            await this.storage.set('offline-weibo-history-enabled', !!e.target.checked);
        });

        // 🧾 线下微博注入条数
        document.getElementById('offline-weibo-history-limit')?.addEventListener('change', async (e) => {
            const limit = parseInt(e.target.value) || 5;
            const validLimit = Math.max(1, Math.min(50, limit));
            e.target.value = validLimit;
            await this.storage.set('offline-weibo-history-limit', validLimit);
        });

        // 🖼️ 全局生图配置
        const imageEnabled = document.getElementById('phone-image-enabled');
        const imageProvider = document.getElementById('phone-image-provider');
        const imageNovelaiSection = document.getElementById('phone-image-novelai-section');
        const imageOpenaiSection = document.getElementById('phone-image-openai-section');
        const imageSiliconflowSection = document.getElementById('phone-image-siliconflow-section');
        const imageSdSection = document.getElementById('phone-image-sd-section');
        const imageComfyUISection = document.getElementById('phone-image-comfyui-section');
        const imageNovelaiSite = document.getElementById('phone-image-novelai-site');
        const imageNovelaiKey = document.getElementById('phone-image-novelai-key');
        const imageNovelaiKeyLabel = document.getElementById('phone-image-novelai-key-label');
        const imageNovelaiQueueRow = document.getElementById('phone-image-novelai-queue-row');
        const imageNovelaiPublicUrlRow = document.getElementById('phone-image-novelai-public-url-row');
        const imageNovelaiUrlRow = document.getElementById('phone-image-novelai-url-row');
        const imageNovelaiModel = document.getElementById('phone-image-novelai-model');
        const imageOpenaiSite = document.getElementById('phone-image-openai-site');
        const imageOpenaiKey = document.getElementById('phone-image-openai-key');
        const imageOpenaiKeyLabel = document.getElementById('phone-image-openai-key-label');
        const imageOpenaiPublicUrlRow = document.getElementById('phone-image-openai-public-url-row');
        const imageOpenaiUrlRow = document.getElementById('phone-image-openai-url-row');
        const imageOpenaiPublicRelayRow = document.getElementById('phone-image-openai-public-relay-row');
        const imageOpenaiPublicRelayUrl = document.getElementById('phone-image-openai-public-relay-url');
        const imageOpenaiModel = document.getElementById('phone-image-openai-model');
        const imageOpenaiModelPreset = document.getElementById('phone-image-openai-model-preset');
        const imageOpenaiQuality = document.getElementById('phone-image-openai-quality');
        const imageOpenaiPresetSelect = document.getElementById('phone-image-openai-preset-select');
        const imageOpenaiPresetName = document.getElementById('phone-image-openai-preset-name');
        const imageOpenaiPresetSaveBtn = document.getElementById('phone-image-openai-preset-save');
        const imageOpenaiPresetNewBtn = document.getElementById('phone-image-openai-preset-new');
        const imageOpenaiPresetDeleteBtn = document.getElementById('phone-image-openai-preset-delete');
        const imageNovelAIVibeGroupSelect = document.getElementById('phone-image-novelai-vibe-group-select');
        const imageNovelAIVibeGroupName = document.getElementById('phone-image-novelai-vibe-group-name');
        const imageNovelAIVibeUploadBtn = document.getElementById('phone-image-novelai-vibe-upload');
        const imageNovelAIVibeFile = document.getElementById('phone-image-novelai-vibe-file');
        const imageNovelAIVibeSaveBtn = document.getElementById('phone-image-novelai-vibe-save');
        const imageNovelAIVibeNewBtn = document.getElementById('phone-image-novelai-vibe-new');
        const imageNovelAIVibeDeleteBtn = document.getElementById('phone-image-novelai-vibe-delete');
        const imageNovelAIVibeList = document.getElementById('phone-image-novelai-vibe-list');
        const imageNovelAIVibeEnabled = document.getElementById('phone-image-novelai-vibe-enabled');
        const imageNovelAIVibeNormalizeStrength = document.getElementById('phone-image-novelai-vibe-normalize-strength');
        const imageNovelAIVibeStatus = document.getElementById('phone-image-novelai-vibe-status');
        const imageComfyUIWorkflowSelect = document.getElementById('phone-image-comfyui-workflow-select');
        const imageComfyUIAppSelect = document.getElementById('phone-image-comfyui-app-select');
        const imageComfyUIWorkflowName = document.getElementById('phone-image-comfyui-workflow-name');
        const imageComfyUIWorkflowSaveBtn = document.getElementById('phone-image-comfyui-workflow-save');
        const imageComfyUIWorkflowNewBtn = document.getElementById('phone-image-comfyui-workflow-new');
        const imageComfyUIWorkflowDeleteBtn = document.getElementById('phone-image-comfyui-workflow-delete');
        const imageComfyUIWorkflowExportBtn = document.getElementById('phone-image-comfyui-workflow-export');
        const imageComfyUIWorkflowImportBtn = document.getElementById('phone-image-comfyui-workflow-import');
        const imageComfyUIWorkflowImportFile = document.getElementById('phone-image-comfyui-workflow-import-file');
        const imageComfyUIWorkflowClearBtn = document.getElementById('phone-image-comfyui-workflow-clear');
        const imageComfyUIWorkflowHelpBtn = document.getElementById('phone-image-comfyui-workflow-help');
        const imagePromptAppSelect = document.getElementById('phone-image-prompt-app-select');
        const imagePromptPresetSelect = document.getElementById('phone-image-prompt-preset-select');
        const imagePromptPresetName = document.getElementById('phone-image-prompt-preset-name');
        const imageFixedPromptInput = document.getElementById('phone-image-fixed-prompt');
        const imageFixedPromptEndInput = document.getElementById('phone-image-fixed-prompt-end');
        const imageNegativePromptInput = document.getElementById('phone-image-negative-prompt');
        const imagePromptPresetSaveBtn = document.getElementById('phone-image-prompt-preset-save');
        const imagePromptPresetNewBtn = document.getElementById('phone-image-prompt-preset-new');
        const imagePromptPresetDeleteBtn = document.getElementById('phone-image-prompt-preset-delete');
        const imagePromptPresetClearAllBtn = document.getElementById('phone-image-prompt-preset-clear-all');
        const imagePromptPresetExportBtn = document.getElementById('phone-image-prompt-preset-export');
        const imagePromptPresetImportBtn = document.getElementById('phone-image-prompt-preset-import');
        const imagePromptPresetImportFile = document.getElementById('phone-image-prompt-preset-import-file');
        const imageProviderAppBindInputs = Array.from(document.querySelectorAll('.phone-image-provider-app-bind'));
        const imageNovelaiOnlyRows = Array.from(document.querySelectorAll('.phone-image-novelai-only'));
        const setImageProviderVisibility = () => {
            const provider = String(imageProvider?.value || 'novelai').trim() || 'novelai';
            if (imageNovelaiSection) imageNovelaiSection.style.display = provider === 'novelai' ? '' : 'none';
            if (imageOpenaiSection) imageOpenaiSection.style.display = provider === 'openai' ? '' : 'none';
            if (imageSiliconflowSection) imageSiliconflowSection.style.display = provider === 'siliconflow' ? '' : 'none';
            if (imageSdSection) imageSdSection.style.display = provider === 'sd' ? '' : 'none';
            if (imageComfyUISection) imageComfyUISection.style.display = provider === 'comfyui' ? '' : 'none';
            imageNovelaiOnlyRows.forEach(row => {
                row.style.display = provider === 'novelai' ? '' : 'none';
            });
        };
        const getImageProviderAppBindings = () => this._getImageProviderAppBindings();
        const saveImageProviderAppBindings = async (bindings) => {
            await this.storage.set('phone-image-provider-app-bindings', JSON.stringify(bindings || {}));
        };
        const syncImageProviderAppBindingInputs = (bindings = getImageProviderAppBindings()) => {
            imageProviderAppBindInputs.forEach((input) => {
                const appKey = String(input.dataset.app || '').trim().toLowerCase();
                const providerKey = String(input.dataset.provider || '').trim().toLowerCase();
                input.checked = !!appKey && !!providerKey && bindings[appKey] === providerKey;
            });
        };
        let currentNovelaiSite = String(imageNovelaiSite?.value || this.storage.get('phone-image-novelai-site') || 'official').trim() || 'official';
        const syncNovelaiSiteFields = () => {
            const site = String(imageNovelaiSite?.value || 'official').trim() || 'official';
            if (imageNovelaiQueueRow) imageNovelaiQueueRow.style.display = site === 'public' ? 'none' : '';
            if (imageNovelaiPublicUrlRow) imageNovelaiPublicUrlRow.style.display = site === 'public' ? '' : 'none';
            if (imageNovelaiUrlRow) imageNovelaiUrlRow.style.display = site === 'custom' ? '' : 'none';
            if (imageNovelaiKeyLabel) imageNovelaiKeyLabel.textContent = site === 'public' ? '公益站 Key' : 'API Key';
            if (imageNovelaiKey) {
                imageNovelaiKey.placeholder = site === 'public' ? '公益站 API Key' : 'NovelAI API Key';
                imageNovelaiKey.value = String(this.storage.get(site === 'public' ? 'phone-image-novelai-public-key' : 'phone-image-novelai-key') || '').trim();
            }
            currentNovelaiSite = site;
        };
        let currentOpenaiSite = String(imageOpenaiSite?.value || this.storage.get('phone-image-openai-site') || 'official').trim() || 'official';
        const syncOpenaiSiteFields = () => {
            const site = String(imageOpenaiSite?.value || 'official').trim() || 'official';
            if (imageOpenaiPublicUrlRow) imageOpenaiPublicUrlRow.style.display = site === 'public' ? '' : 'none';
            if (imageOpenaiUrlRow) imageOpenaiUrlRow.style.display = site === 'custom' ? '' : 'none';
            if (imageOpenaiPublicRelayRow) imageOpenaiPublicRelayRow.style.display = site === 'public' ? '' : 'none';
            if (imageOpenaiKeyLabel) imageOpenaiKeyLabel.textContent = site === 'public' ? '公益站 Key' : 'API Key';
            if (imageOpenaiKey) {
                imageOpenaiKey.placeholder = site === 'public' ? '公益站 API Key' : 'OpenAI API Key';
                imageOpenaiKey.value = String(this.storage.get(site === 'public' ? 'phone-image-openai-public-key' : 'phone-image-openai-key') || '').trim();
            }
            currentOpenaiSite = site;
        };
        const clampNumberInput = (input, fallback, min, max, integer = false) => {
            if (!input) return fallback;
            let value = Number(input.value);
            if (!Number.isFinite(value)) value = fallback;
            if (Number.isFinite(min)) value = Math.max(min, value);
            if (Number.isFinite(max)) value = Math.min(max, value);
            if (integer) value = Math.round(value);
            input.value = String(value);
            return value;
        };
        const getImagePromptForm = () => ({
            fixedPrompt: String(imageFixedPromptInput?.value || '').trim(),
            fixedPromptEnd: String(imageFixedPromptEndInput?.value || '').trim(),
            negativePrompt: String(imageNegativePromptInput?.value || '').trim()
        });
        const readPresetNumber = (id, fallback, min, max, integer = false) => {
            const input = document.getElementById(id)
                || document.querySelector(`[data-phone-image-number-key="${id}"]`);
            return clampNumberInput(input, fallback, min, max, integer);
        };
        const setPresetNumber = async (id, value, fallback, min, max, integer = false) => {
            if (value === undefined || value === null || value === '') return;
            const inputs = Array.from(document.querySelectorAll(`#${id}, [data-phone-image-number-key="${id}"]`));
            const input = inputs[0];
            if (!input) return;
            input.value = String(value);
            const savedValue = clampNumberInput(input, fallback, min, max, integer);
            inputs.forEach(item => {
                item.value = String(savedValue);
            });
            await this.storage.set(id, savedValue);
        };
        const setPresetDimension = async (id, value, fallback) => {
            const rawText = String(value ?? '').trim();
            const numeric = rawText ? Number(rawText) : NaN;
            if (!Number.isFinite(numeric) || numeric < 64) {
                await setPresetNumber(id, fallback, fallback, 64, 2048, true);
                return;
            }
            await setPresetNumber(id, numeric, fallback, 64, 2048, true);
        };
        const setPresetDimensionPair = async (widthId, heightId, widthValue, heightValue, fallbackWidth, fallbackHeight) => {
            const widthNumber = String(widthValue ?? '').trim() ? Number(widthValue) : NaN;
            const heightNumber = String(heightValue ?? '').trim() ? Number(heightValue) : NaN;
            if (
                Number.isFinite(widthNumber) &&
                Number.isFinite(heightNumber) &&
                widthNumber <= 64 &&
                heightNumber <= 64
            ) {
                await setPresetDimension(widthId, fallbackWidth, fallbackWidth);
                await setPresetDimension(heightId, fallbackHeight, fallbackHeight);
                return;
            }
            await setPresetDimension(widthId, widthValue, fallbackWidth);
            await setPresetDimension(heightId, heightValue, fallbackHeight);
        };
        const restoreDefaultImageAppSizes = async () => {
            const defaults = {
                'phone-image-honey-width': 832,
                'phone-image-honey-height': 1216,
                'phone-image-wechat-width': 512,
                'phone-image-wechat-height': 512,
                'phone-image-weibo-width': 1024,
                'phone-image-weibo-height': 1024,
                'phone-image-diary-width': 512,
                'phone-image-diary-height': 512,
                'phone-image-width': 832,
                'phone-image-height': 1216
            };
            for (const [key, value] of Object.entries(defaults)) {
                const inputs = Array.from(document.querySelectorAll(`#${key}, [data-phone-image-number-key="${key}"]`));
                inputs.forEach(input => {
                    input.value = String(value);
                });
                await this.storage.set(key, value);
            }
        };
        const getImageGenerationPresetSettings = () => ({
            novelaiModel: String(imageNovelaiModel?.value || '').trim() || 'nai-diffusion-4-5-full',
            novelaiSampler: String(document.getElementById('phone-image-novelai-sampler')?.value || '').trim() || 'k_euler',
            novelaiSchedule: String(document.getElementById('phone-image-novelai-schedule')?.value || '').trim() || 'native',
            honeyWidth: readPresetNumber('phone-image-honey-width', 832, 64, 2048, true),
            honeyHeight: readPresetNumber('phone-image-honey-height', 1216, 64, 2048, true),
            wechatWidth: readPresetNumber('phone-image-wechat-width', 512, 64, 2048, true),
            wechatHeight: readPresetNumber('phone-image-wechat-height', 512, 64, 2048, true),
            weiboWidth: readPresetNumber('phone-image-weibo-width', 1024, 64, 2048, true),
            weiboHeight: readPresetNumber('phone-image-weibo-height', 1024, 64, 2048, true),
            diaryWidth: readPresetNumber('phone-image-diary-width', 512, 64, 2048, true),
            diaryHeight: readPresetNumber('phone-image-diary-height', 512, 64, 2048, true),
            width: readPresetNumber('phone-image-width', 832, 64, 2048, true),
            height: readPresetNumber('phone-image-height', 1216, 64, 2048, true),
            steps: readPresetNumber('phone-image-steps', 28, 1, 50, true),
            scale: readPresetNumber('phone-image-scale', 6, 0, 50, false),
            cfgRescale: readPresetNumber('phone-image-cfg-rescale', 0.2, 0, 1, false),
            seed: readPresetNumber('phone-image-seed', -1, -1, 4294967295, true)
        });
        const applyImageGenerationPresetSettings = async (preset) => {
            if (!preset) return;
            if (preset.novelaiModel) {
                const model = String(preset.novelaiModel || '').trim() || 'nai-diffusion-4-5-full';
                if (imageNovelaiModel) imageNovelaiModel.value = model;
                await this.storage.set('phone-image-novelai-model', model);
            }
            if (preset.novelaiSampler) {
                const value = String(preset.novelaiSampler || '').trim() || 'k_euler';
                const input = document.getElementById('phone-image-novelai-sampler');
                if (input) input.value = value;
                await this.storage.set('phone-image-novelai-sampler', value);
            }
            if (preset.novelaiSchedule) {
                const value = String(preset.novelaiSchedule || '').trim() || 'native';
                const input = document.getElementById('phone-image-novelai-schedule');
                if (input) input.value = value;
                await this.storage.set('phone-image-novelai-schedule', value);
            }

            await setPresetDimensionPair('phone-image-honey-width', 'phone-image-honey-height', preset.honeyWidth, preset.honeyHeight, 832, 1216);
            await setPresetDimensionPair('phone-image-wechat-width', 'phone-image-wechat-height', preset.wechatWidth, preset.wechatHeight, 512, 512);
            await setPresetDimensionPair('phone-image-weibo-width', 'phone-image-weibo-height', preset.weiboWidth, preset.weiboHeight, 1024, 1024);
            await setPresetDimensionPair('phone-image-diary-width', 'phone-image-diary-height', preset.diaryWidth, preset.diaryHeight, 512, 512);
            await setPresetDimensionPair('phone-image-width', 'phone-image-height', preset.width, preset.height, 832, 1216);
            await setPresetNumber('phone-image-steps', preset.steps, 28, 1, 50, true);
            await setPresetNumber('phone-image-scale', preset.scale, 6, 0, 50, false);
            await setPresetNumber('phone-image-cfg-rescale', preset.cfgRescale, 0.2, 0, 1, false);
            await setPresetNumber('phone-image-seed', preset.seed, -1, -1, 4294967295, true);
        };
        const getOpenAIImagePresetSettings = () => ({
            fixedPrompt: String(imageFixedPromptInput?.value || '').trim(),
            fixedPromptEnd: String(imageFixedPromptEndInput?.value || '').trim(),
            negativePrompt: String(imageNegativePromptInput?.value || '').trim(),
            openaiModel: String(imageOpenaiModel?.value || '').trim() || 'gpt-image-2',
            openaiMode: 'images',
            openaiQuality: String(imageOpenaiQuality?.value || 'auto').trim() || 'auto',
            honeyWidth: readPresetNumber('phone-image-honey-width', 832, 64, 2048, true),
            honeyHeight: readPresetNumber('phone-image-honey-height', 1216, 64, 2048, true),
            wechatWidth: readPresetNumber('phone-image-wechat-width', 512, 64, 2048, true),
            wechatHeight: readPresetNumber('phone-image-wechat-height', 512, 64, 2048, true),
            weiboWidth: readPresetNumber('phone-image-weibo-width', 1024, 64, 2048, true),
            weiboHeight: readPresetNumber('phone-image-weibo-height', 1024, 64, 2048, true),
            diaryWidth: readPresetNumber('phone-image-diary-width', 512, 64, 2048, true),
            diaryHeight: readPresetNumber('phone-image-diary-height', 512, 64, 2048, true),
            width: readPresetNumber('phone-image-width', 832, 64, 2048, true),
            height: readPresetNumber('phone-image-height', 1216, 64, 2048, true)
        });
        const applyOpenAIImagePresetSettings = async (preset) => {
            if (!preset) return;
            const appKey = getActiveImagePromptApp();
            const fixedPromptValue = String(preset.fixedPrompt || '');
            const fixedPromptEndValue = String(preset.fixedPromptEnd || '');
            const negativePromptValue = String(preset.negativePrompt || '');
            if (imageFixedPromptInput) imageFixedPromptInput.value = fixedPromptValue;
            if (imageFixedPromptEndInput) imageFixedPromptEndInput.value = fixedPromptEndValue;
            if (imageNegativePromptInput) imageNegativePromptInput.value = negativePromptValue;
            await saveImagePromptDraft(appKey, {
                fixedPrompt: fixedPromptValue,
                fixedPromptEnd: fixedPromptEndValue,
                negativePrompt: negativePromptValue
            });

            if (preset.openaiModel) {
                const model = String(preset.openaiModel || '').trim() || 'gpt-image-2';
                if (imageOpenaiModel) imageOpenaiModel.value = model;
                if (imageOpenaiModelPreset) imageOpenaiModelPreset.value = model;
                await this.storage.set('phone-image-openai-model', model);
            }
            const modeInput = document.getElementById('phone-image-openai-mode');
            if (modeInput) modeInput.value = 'images';
            await this.storage.set('phone-image-openai-mode', 'images');
            if (preset.openaiQuality) {
                const value = String(preset.openaiQuality || 'auto').trim() || 'auto';
                if (imageOpenaiQuality) imageOpenaiQuality.value = value;
                await this.storage.set('phone-image-openai-quality', value);
            }

            await setPresetDimensionPair('phone-image-honey-width', 'phone-image-honey-height', preset.honeyWidth, preset.honeyHeight, 832, 1216);
            await setPresetDimensionPair('phone-image-wechat-width', 'phone-image-wechat-height', preset.wechatWidth, preset.wechatHeight, 512, 512);
            await setPresetDimensionPair('phone-image-weibo-width', 'phone-image-weibo-height', preset.weiboWidth, preset.weiboHeight, 1024, 1024);
            await setPresetDimensionPair('phone-image-diary-width', 'phone-image-diary-height', preset.diaryWidth, preset.diaryHeight, 512, 512);
            await setPresetDimensionPair('phone-image-width', 'phone-image-height', preset.width, preset.height, 832, 1216);
        };
        const fillOpenAIImagePresetSelect = (presets, activeId = '') => {
            if (!imageOpenaiPresetSelect) return;
            imageOpenaiPresetSelect.innerHTML = '<option value="">未选择 GPT 预设</option>';
            presets.forEach((preset) => {
                const opt = document.createElement('option');
                opt.value = preset.id;
                opt.textContent = preset.name;
                opt.selected = preset.id === activeId;
                imageOpenaiPresetSelect.appendChild(opt);
            });
        };
        const getComfyUIWorkflowSettings = () => ({
            workflow: String(document.getElementById('phone-image-comfyui-workflow')?.value || '').trim(),
            nodeMapping: String(document.getElementById('phone-image-comfyui-node-mapping')?.value || '').trim(),
            comfyuiModel: String(document.getElementById('phone-image-comfyui-model')?.value || '').trim(),
            comfyuiSampler: String(document.getElementById('phone-image-comfyui-sampler')?.value || 'euler').trim() || 'euler',
            comfyuiScheduler: String(document.getElementById('phone-image-comfyui-scheduler')?.value || 'normal').trim() || 'normal',
            comfyuiVae: String(document.getElementById('phone-image-comfyui-vae')?.value || '').trim(),
            comfyuiClip: String(document.getElementById('phone-image-comfyui-clip')?.value || '').trim()
        });
        const setComfyUIFieldValue = (id, value) => {
            const input = document.getElementById(id);
            if (!input) return;
            if (input.tagName === 'SELECT' && value && !Array.from(input.options).some(option => option.value === value)) {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = value;
                input.appendChild(opt);
            }
            input.value = value;
        };
        const applyComfyUIWorkflowSettings = async (workflow) => {
            if (!workflow) return;
            const fields = [
                ['phone-image-comfyui-workflow', String(workflow.workflow || '')],
                ['phone-image-comfyui-node-mapping', String(workflow.nodeMapping || '')],
                ['phone-image-comfyui-model', String(workflow.comfyuiModel || '')],
                ['phone-image-comfyui-sampler', String(workflow.comfyuiSampler || 'euler').trim() || 'euler'],
                ['phone-image-comfyui-scheduler', String(workflow.comfyuiScheduler || 'normal').trim() || 'normal'],
                ['phone-image-comfyui-vae', String(workflow.comfyuiVae || '')],
                ['phone-image-comfyui-clip', String(workflow.comfyuiClip || '')]
            ];
            for (const [id, value] of fields) {
                setComfyUIFieldValue(id, value);
                await this.storage.set(id, value);
            }
        };
        const fillComfyUIWorkflowSelect = (workflows, activeId = '') => {
            if (!imageComfyUIWorkflowSelect) return;
            imageComfyUIWorkflowSelect.innerHTML = '<option value="">未选择工作流</option>';
            workflows.forEach((workflow) => {
                const opt = document.createElement('option');
                opt.value = workflow.id;
                opt.textContent = workflow.name;
                opt.selected = workflow.id === activeId;
                imageComfyUIWorkflowSelect.appendChild(opt);
            });
        };
        let currentImagePromptApp = this._normalizeImagePromptApp(this.storage.get('phone-image-active-prompt-app') || imagePromptAppSelect?.value || 'honey');
        const getActiveImagePromptApp = () => this._normalizeImagePromptApp(currentImagePromptApp || imagePromptAppSelect?.value || this.storage.get('phone-image-active-prompt-app') || 'honey');
        let currentComfyUIApp = this._normalizeImagePromptApp(this.storage.get('phone-image-active-comfyui-app') || imageComfyUIAppSelect?.value || getActiveImagePromptApp());
        const getComfyUIPresetScope = () => this._normalizeImagePresetScope(currentComfyUIApp || imageComfyUIAppSelect?.value || getActiveImagePromptApp());
        const getComfyUIActiveWorkflowId = () => String(
            this.storage.get(`phone-image-${getComfyUIPresetScope()}-comfyui-active-workflow`)
            || this.storage.get('phone-image-comfyui-active-workflow')
            || ''
        ).trim();
        const saveImagePromptDraft = async (app, form = getImagePromptForm()) => {
            const appKey = this._normalizeImagePresetScope(app);
            await this.storage.set(`phone-image-${appKey}-fixed-prompt`, String(form.fixedPrompt || '').trim());
            await this.storage.set(`phone-image-${appKey}-fixed-prompt-end`, String(form.fixedPromptEnd || '').trim());
            await this.storage.set(`phone-image-${appKey}-negative-prompt`, String(form.negativePrompt || '').trim());
        };
        const setImagePromptForm = async (preset) => {
            const fixedPromptValue = String(preset?.fixedPrompt || '');
            const fixedPromptEndValue = String(preset?.fixedPromptEnd || '');
            const negativePromptValue = String(preset?.negativePrompt || '');
            if (imageFixedPromptInput) imageFixedPromptInput.value = fixedPromptValue;
            if (imageFixedPromptEndInput) imageFixedPromptEndInput.value = fixedPromptEndValue;
            if (imageNegativePromptInput) imageNegativePromptInput.value = negativePromptValue;
            await saveImagePromptDraft(getActiveImagePromptApp(), {
                fixedPrompt: fixedPromptValue,
                fixedPromptEnd: fixedPromptEndValue,
                negativePrompt: negativePromptValue
            });
        };
        const fillImagePromptPresetSelect = (presets, activeId = '') => {
            if (!imagePromptPresetSelect) return;
            imagePromptPresetSelect.innerHTML = '<option value="">未选择设定</option>';
            presets.forEach((preset) => {
                const opt = document.createElement('option');
                opt.value = preset.id;
                opt.textContent = preset.name;
                opt.selected = preset.id === activeId;
                imagePromptPresetSelect.appendChild(opt);
            });
        };
        const createImagePromptPresetId = () => `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const createNovelAIVibeId = () => `vibe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const getNovelAIVibeGroups = () => this._getNovelAIVibeGroups();
        const getActiveNovelAIVibeGroupId = () => String(imageNovelAIVibeGroupSelect?.value || this.storage.get('phone-image-novelai-active-vibe-group') || '').trim();
        const setNovelAIVibeStatus = (text, color = '#666') => {
            if (imageNovelAIVibeStatus) {
                imageNovelAIVibeStatus.textContent = text;
                imageNovelAIVibeStatus.style.color = color;
            }
        };
        const getNovelAIVibeDraftItems = () => {
            if (!imageNovelAIVibeList) return [];
            return Array.from(imageNovelAIVibeList.querySelectorAll('.phone-image-vibe-item'))
                .map((row, index) => ({
                    id: String(row.dataset.vibeId || createNovelAIVibeId()).trim(),
                    name: String(row.querySelector('.phone-image-vibe-name')?.value || `Vibe ${index + 1}`).trim() || `Vibe ${index + 1}`,
                    image: String(row.dataset.vibeImage || row.querySelector('img')?.getAttribute('src') || '').trim(),
                    strength: this._clampNovelAIVibeValue(row.querySelector('.phone-image-vibe-strength')?.value, 0.6),
                    informationExtracted: this._clampNovelAIVibeValue(row.querySelector('.phone-image-vibe-info')?.value, 1),
                    cacheSecretKey: String(row.dataset.vibeCacheKey || '').trim()
                }))
                .filter(item => item.image);
        };
        const renderNovelAIVibeList = (items = []) => {
            if (!imageNovelAIVibeList) return;
            const normalizedItems = Array.isArray(items) ? items : [];
            if (!normalizedItems.length) {
                imageNovelAIVibeList.innerHTML = '<div class="setting-desc" style="margin-top:8px;">当前组还没有 Vibe 图片。</div>';
                return;
            }
            imageNovelAIVibeList.innerHTML = normalizedItems.map((item, index) => `
                <div class="phone-image-vibe-item" data-vibe-id="${this._escapeHtml(item.id || createNovelAIVibeId())}" data-vibe-image="${this._escapeHtml(item.image || '')}" data-vibe-cache-key="${this._escapeHtml(item.cacheSecretKey || '')}" style="display:grid; grid-template-columns:44px 1fr 34px; gap:8px; align-items:center; padding:8px; border:1px solid #eee; border-radius:8px; background:#fafafa; margin-top:8px;">
                    <div style="width:44px; height:44px; border-radius:6px; overflow:hidden; background:#e5e7eb;">
                        <img src="${this._escapeHtml(item.image || '')}" alt="" style="width:100%; height:100%; object-fit:cover; display:block;">
                    </div>
                    <div style="min-width:0;">
                        <input type="text" class="phone-image-vibe-name" value="${this._escapeHtml(item.name || `Vibe ${index + 1}`)}" placeholder="Vibe 名称" style="width:100%; height:28px; padding:0 8px; border:1px solid #e0e0e0; border-radius:7px; font-size:12px; background:#fff; box-sizing:border-box;">
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:6px;">
                            <input type="number" class="phone-image-vibe-strength" min="0" max="1" step="0.01" value="${this._escapeHtml(this._clampNovelAIVibeValue(item.strength, 0.6))}" title="Reference Strength" style="width:100%; height:26px; padding:0 6px; border:1px solid #e0e0e0; border-radius:7px; font-size:11px; background:#fff; box-sizing:border-box;">
                            <input type="number" class="phone-image-vibe-info" min="0" max="1" step="0.01" value="${this._escapeHtml(this._clampNovelAIVibeValue(item.informationExtracted, 1))}" title="Information Extracted" style="width:100%; height:26px; padding:0 6px; border:1px solid #e0e0e0; border-radius:7px; font-size:11px; background:#fff; box-sizing:border-box;">
                        </div>
                    </div>
                    <button type="button" class="phone-image-vibe-remove" aria-label="删除 Vibe" title="删除 Vibe" style="width:34px; height:34px; border:1px solid rgba(211,51,51,0.25); border-radius:8px; background:#fff; color:#d33; cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0;">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `).join('');
        };
        const fillNovelAIVibeGroupSelect = (groups, activeId = '') => {
            if (!imageNovelAIVibeGroupSelect) return;
            imageNovelAIVibeGroupSelect.innerHTML = '<option value="">未选择 Vibe 组</option>';
            groups.forEach((group) => {
                const opt = document.createElement('option');
                opt.value = group.id;
                opt.textContent = group.name;
                opt.selected = group.id === activeId;
                imageNovelAIVibeGroupSelect.appendChild(opt);
            });
        };
        const refreshNovelAIVibePanel = (activeId = getActiveNovelAIVibeGroupId()) => {
            const groups = getNovelAIVibeGroups();
            const group = groups.find(item => item.id === activeId) || null;
            fillNovelAIVibeGroupSelect(groups, group?.id || '');
            if (imageNovelAIVibeGroupName) imageNovelAIVibeGroupName.value = group?.name || '';
            renderNovelAIVibeList(group?.items || []);
        };
        const getImagePromptAppName = (appKey) => {
            const normalizedApp = this._normalizeImagePromptApp(appKey);
            return this._getImagePromptAppDefs().find(def => def.id === normalizedApp)?.name || normalizedApp;
        };
        const buildImagePromptPresetSharePayload = (appKey, presets = []) => ({
            type: 'yuzuki-phone-nai-presets',
            version: 1,
            app: this._normalizeImagePromptApp(appKey),
            exportedAt: new Date().toISOString(),
            presets: (Array.isArray(presets) ? presets : []).map(preset => ({
                name: String(preset?.name || '').trim(),
                fixedPrompt: String(preset?.fixedPrompt || ''),
                fixedPromptEnd: String(preset?.fixedPromptEnd || ''),
                negativePrompt: String(preset?.negativePrompt || ''),
                novelaiModel: String(preset?.novelaiModel || ''),
                novelaiSampler: String(preset?.novelaiSampler || ''),
                novelaiSchedule: String(preset?.novelaiSchedule || ''),
                honeyWidth: preset?.honeyWidth,
                honeyHeight: preset?.honeyHeight,
                wechatWidth: preset?.wechatWidth,
                wechatHeight: preset?.wechatHeight,
                weiboWidth: preset?.weiboWidth,
                weiboHeight: preset?.weiboHeight,
                diaryWidth: preset?.diaryWidth,
                diaryHeight: preset?.diaryHeight,
                width: preset?.width,
                height: preset?.height,
                steps: preset?.steps,
                scale: preset?.scale,
                cfgRescale: preset?.cfgRescale,
                seed: preset?.seed
            })).filter(preset => preset.name)
        });
        const readImportedNegativePrompt = (preset = {}) => {
            const direct = [
                preset?.negativePrompt,
                preset?.negative_prompt,
                preset?.negative,
                preset?.undesiredContent,
                preset?.undesired_content,
                preset?.uc,
                preset?.ucPrompt,
                preset?.uc_prompt
            ].find(value => String(value || '').trim());
            if (direct) return String(direct || '').trim();

            const v4Negative = preset?.v4_negative_prompt?.caption?.base_caption
                || preset?.parameters?.v4_negative_prompt?.caption?.base_caption
                || preset?.params?.v4_negative_prompt?.caption?.base_caption;
            if (String(v4Negative || '').trim()) return String(v4Negative).trim();

            const nested = preset?.parameters?.negative_prompt
                || preset?.params?.negative_prompt
                || preset?.settings?.negative_prompt
                || preset?.settings?.negativePrompt;
            return String(nested || '').trim();
        };
        const firstFiniteNumber = (...values) => {
            for (const value of values) {
                if (value === undefined || value === null || value === '') continue;
                const number = Number(value);
                if (Number.isFinite(number)) return number;
            }
            return undefined;
        };
        const normalizeImportedImagePreset = (preset, fallbackName = '') => {
            const name = String(preset?.name || preset?.title || fallbackName || '').trim();
            if (!name) return null;
            return {
                id: createImagePromptPresetId(),
                name,
                fixedPrompt: String(preset?.fixedPrompt || ''),
                fixedPromptEnd: String(preset?.fixedPromptEnd || ''),
                negativePrompt: readImportedNegativePrompt(preset),
                novelaiModel: String(preset?.novelaiModel || preset?.model || '').trim(),
                novelaiSampler: String(preset?.novelaiSampler || preset?.sampler || '').trim(),
                novelaiSchedule: String(preset?.novelaiSchedule || preset?.schedule || '').trim(),
                honeyWidth: preset?.honeyWidth,
                honeyHeight: preset?.honeyHeight,
                wechatWidth: preset?.wechatWidth,
                wechatHeight: preset?.wechatHeight,
                weiboWidth: preset?.weiboWidth,
                weiboHeight: preset?.weiboHeight,
                diaryWidth: preset?.diaryWidth,
                diaryHeight: preset?.diaryHeight,
                width: preset?.width,
                height: preset?.height,
                steps: preset?.steps,
                scale: firstFiniteNumber(
                    preset?.scale,
                    preset?.promptGuidance,
                    preset?.prompt_guidance,
                    preset?.guidance,
                    preset?.cfgScale,
                    preset?.cfg_scale,
                    preset?.parameters?.scale,
                    preset?.parameters?.cfg_scale,
                    preset?.params?.scale,
                    preset?.params?.cfg_scale,
                    preset?.settings?.scale,
                    preset?.settings?.cfg_scale
                ),
                cfgRescale: firstFiniteNumber(
                    preset?.cfgRescale,
                    preset?.cfg_rescale,
                    preset?.guidanceRescale,
                    preset?.guidance_rescale,
                    preset?.parameters?.cfg_rescale,
                    preset?.parameters?.guidance_rescale,
                    preset?.params?.cfg_rescale,
                    preset?.params?.guidance_rescale,
                    preset?.settings?.cfgRescale,
                    preset?.settings?.cfg_rescale
                ),
                seed: preset?.seed,
                updatedAt: Date.now()
            };
        };
        const parseImagePromptPresetImportText = (rawText = '') => {
            const text = String(rawText || '').trim();
            if (!text) return [];
            let payload = null;
            try {
                payload = JSON.parse(text);
            } catch (err) {
                throw new Error('导入内容不是有效 JSON');
            }

            const candidates = Array.isArray(payload)
                ? payload
                : (Array.isArray(payload?.presets)
                    ? payload.presets
                    : (Array.isArray(payload?.items) ? payload.items : []));
            return candidates
                .map((preset, index) => normalizeImportedImagePreset(preset, `导入预设 ${index + 1}`))
                .filter(Boolean);
        };
        const readJsonImportFile = async (file) => {
            if (!file) throw new Error('未选择文件');
            const text = await file.text();
            if (!String(text || '').trim()) throw new Error('文件内容为空');
            return text;
        };
        const downloadJsonFile = (payload, filename) => {
            const safeName = String(filename || 'yuzuki-export.json')
                .replace(/[\\/:*?"<>|]+/g, '-')
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '') || 'yuzuki-export.json';
            const finalName = /\.json$/i.test(safeName) ? safeName : `${safeName}.json`;
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = finalName;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            setTimeout(() => {
                URL.revokeObjectURL(url);
                link.remove();
            }, 0);
        };
        const buildImagePresetExportFilename = (presets = []) => {
            const list = Array.isArray(presets) ? presets : [];
            const firstName = String(list[0]?.name || 'NAI预设').trim() || 'NAI预设';
            if (list.length <= 1) return `${firstName}.json`;
            return `${firstName}等${list.length}个文件.json`;
        };
        const showImagePresetExportChooser = ({ title, desc, presets = [], selectedIds = [], onConfirm = null }) => {
            document.getElementById('phone-image-preset-export-chooser')?.remove();
            const normalizedPresets = (Array.isArray(presets) ? presets : []).filter(preset => preset?.id);
            if (!normalizedPresets.length) return;
            const selectedSet = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(id => String(id || '').trim()).filter(Boolean));
            const defaultSelected = selectedSet.size > 0
                ? selectedSet
                : new Set(normalizedPresets.map(preset => preset.id));
            const overlay = document.createElement('div');
            overlay.id = 'phone-image-preset-export-chooser';
            overlay.style.cssText = 'position:absolute; inset:0; z-index:10020; background:rgba(0,0,0,0.38); display:flex; align-items:center; justify-content:center; padding:14px; box-sizing:border-box; touch-action:pan-y; overscroll-behavior:contain;';
            overlay.innerHTML = `
                <div class="phone-image-preset-export-dialog" style="width:100%; max-width:320px; max-height:82%; background:#fff; border-radius:12px; box-shadow:0 12px 28px rgba(0,0,0,0.22); display:flex; flex-direction:column; overflow:hidden; touch-action:pan-y; overscroll-behavior:contain;">
                    <div style="padding:12px 14px 8px; border-bottom:1px solid #eee;">
                        <div style="font-size:15px; font-weight:700; color:#111;">${this._escapeHtml(title)}</div>
                        <div style="font-size:11px; line-height:1.45; color:#666; margin-top:4px;">${this._escapeHtml(desc)}</div>
                    </div>
                    <div style="padding:8px 12px; border-bottom:1px solid #eee; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <button type="button" id="phone-image-preset-export-all" style="height:28px; border:1px solid #d8d8d8; border-radius:8px; background:#f7f7f7; color:#333; font-size:12px; cursor:pointer;">全选</button>
                        <button type="button" id="phone-image-preset-export-none" style="height:28px; border:1px solid #d8d8d8; border-radius:8px; background:#fff; color:#333; font-size:12px; cursor:pointer;">清空</button>
                    </div>
                    <div class="phone-image-preset-export-list" style="flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; max-height:42vh; padding:6px 12px; background:#fbfbfb; -webkit-overflow-scrolling:touch; touch-action:pan-y; overscroll-behavior:contain;">
                        ${normalizedPresets.map((preset, index) => `
                            <label style="display:flex; align-items:flex-start; gap:8px; padding:9px 0; border-bottom:${index === normalizedPresets.length - 1 ? 'none' : '1px solid #eee'}; cursor:pointer;">
                                <input type="checkbox" class="phone-image-preset-export-choice" value="${this._escapeHtml(preset.id)}" ${defaultSelected.has(preset.id) ? 'checked' : ''} style="margin-top:1px; width:16px; height:16px; flex:0 0 16px;">
                                <span style="min-width:0; color:#222; font-size:12px; line-height:1.35; word-break:break-word;">${this._escapeHtml(preset.name || `预设 ${index + 1}`)}</span>
                            </label>
                        `).join('')}
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:10px 12px; border-top:1px solid #eee; background:#fff;">
                        <button type="button" id="phone-image-preset-export-cancel" style="height:32px; border:1px solid #ddd; border-radius:8px; background:#fff; color:#333; font-size:12px; cursor:pointer;">取消</button>
                        <button type="button" id="phone-image-preset-export-confirm" style="height:32px; border:none; border-radius:8px; background:#2563eb; color:#fff; font-size:12px; font-weight:700; cursor:pointer;">导出</button>
                    </div>
                </div>
            `;
            const host = document.querySelector('.phone-view-current') || document.querySelector('.phone-body-panel') || document.body;
            host.appendChild(overlay);
            const choices = () => Array.from(overlay.querySelectorAll('.phone-image-preset-export-choice'));
            const close = () => overlay.remove();
            overlay.querySelector('#phone-image-preset-export-cancel')?.addEventListener('click', close);
            overlay.querySelector('#phone-image-preset-export-all')?.addEventListener('click', () => {
                choices().forEach(input => { input.checked = true; });
            });
            overlay.querySelector('#phone-image-preset-export-none')?.addEventListener('click', () => {
                choices().forEach(input => { input.checked = false; });
            });
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) close();
            });
            overlay.querySelector('#phone-image-preset-export-confirm')?.addEventListener('click', async () => {
                try {
                    const ids = choices()
                        .filter(input => input.checked)
                        .map(input => String(input.value || '').trim())
                        .filter(Boolean);
                    if (!ids.length) throw new Error('请至少选择一个预设');
                    await onConfirm?.(ids);
                    close();
                } catch (err) {
                    this.phoneShell?.showNotification?.('导出失败', err?.message || String(err || '失败'), '⚠️');
                }
            });
        };
        const makeUniqueImagePresetName = (name, usedNames) => {
            const baseName = String(name || '导入预设').trim() || '导入预设';
            let nextName = baseName;
            let index = 2;
            while (usedNames.has(nextName)) {
                nextName = `${baseName} 导入${index}`;
                index += 1;
            }
            usedNames.add(nextName);
            return nextName;
        };
        const isLikelyComfyUIApiWorkflow = (workflow) => {
            const prompt = workflow?.prompt && typeof workflow.prompt === 'object' ? workflow.prompt : workflow;
            if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) return false;
            return Object.values(prompt).some(node => node && typeof node === 'object' && typeof node.class_type === 'string');
        };
        const convertComfyUIWorkflowToApiPrompt = (workflow) => {
            const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
            const links = Array.isArray(workflow?.links) ? workflow.links : [];
            if (!nodes.length) throw new Error('ComfyUI UI 工作流缺少 nodes');

            const nodeById = new Map(nodes.map(node => [String(node?.id || ''), node]).filter(([id]) => id));
            const originByLinkId = new Map();
            const bypassNodes = new Set();
            nodes.forEach((node) => {
                if (Number(node?.mode ?? 0) === 4) bypassNodes.add(String(node?.id || ''));
            });

            const linkMap = new Map();
            links.forEach((link) => {
                if (!Array.isArray(link) || link.length < 5) return;
                const linkId = String(link[0]);
                const originId = String(link[1]);
                const originSlot = Number(link[2]) || 0;
                linkMap.set(linkId, [originId, originSlot]);
                originByLinkId.set(linkId, { originId, originSlot });
            });

            const findBypassSource = (bypassNode, originSlot, seen = new Set()) => {
                const bypassId = String(bypassNode?.id || '');
                if (!bypassId || seen.has(bypassId)) return null;
                seen.add(bypassId);
                const inputs = Array.isArray(bypassNode?.inputs) ? bypassNode.inputs : [];
                const preferred = inputs[originSlot] || inputs.find(input => input?.link !== null && input?.link !== undefined);
                const linkId = preferred?.link !== null && preferred?.link !== undefined ? String(preferred.link) : '';
                const source = linkId ? originByLinkId.get(linkId) : null;
                if (!source) return null;
                if (!bypassNodes.has(source.originId)) return [source.originId, source.originSlot];
                return findBypassSource(nodeById.get(source.originId), source.originSlot, seen);
            };
            const resolveLink = (linkId) => {
                const source = linkMap.get(String(linkId));
                if (!source) return null;
                const [originId, originSlot] = source;
                if (!bypassNodes.has(originId)) return source;
                return findBypassSource(nodeById.get(originId), originSlot) || source;
            };

            const seedInputNames = new Set(['seed', 'noise_seed']);
            const controlAfterGenerateValues = new Set(['fixed', 'randomize', 'increment', 'decrement']);
            const prompt = {};
            nodes.forEach((node) => {
                const id = String(node.id || '').trim();
                const classType = String(node.type || '').trim();
                if (!node || [2, 4].includes(Number(node.mode ?? 0)) || /^(note|markdownnote|label(?:\s*\(rgthree\))?)$/i.test(classType)) return;
                if (!id || !classType) return;

                const inputs = {};
                const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : [];
                let widgetIndex = 0;
                (Array.isArray(node.inputs) ? node.inputs : []).forEach((input) => {
                    const name = String(input?.name || '').trim();
                    if (!name) return;
                    const linked = input?.link !== null && input?.link !== undefined && linkMap.has(String(input.link));
                    const hasWidget = !!input?.widget;
                    if (linked) {
                        const resolved = resolveLink(input.link);
                        if (resolved) inputs[name] = resolved;
                    } else if (hasWidget && widgetIndex < widgets.length) {
                        inputs[name] = widgets[widgetIndex];
                    }
                    if (hasWidget) {
                        widgetIndex += 1;
                        if (
                            seedInputNames.has(name) &&
                            widgetIndex < widgets.length &&
                            controlAfterGenerateValues.has(String(widgets[widgetIndex] || '').toLowerCase())
                        ) {
                            widgetIndex += 1;
                        }
                    }
                });
                if (Object.keys(inputs).length === 0 && widgets.length > 0) {
                    const classKey = classType.toLowerCase();
                    if (/primitive|string|text/.test(classKey)) inputs.value = widgets[0];
                    else if (/seed/.test(classKey)) inputs.seed = widgets[0];
                }
                prompt[id] = { inputs, class_type: classType };
                const title = String(node.title || node.properties?.['Node name for S&R'] || '').trim();
                if (title) prompt[id]._meta = { title };
            });

            Object.values(prompt).forEach((node) => {
                Object.entries(node.inputs || {}).forEach(([inputName, value]) => {
                    if (Array.isArray(value) && !prompt[String(value[0])]) delete node.inputs[inputName];
                });
            });
            if (!Object.keys(prompt).length) throw new Error('ComfyUI UI 工作流转换失败');
            return optimizeConvertedComfyUIPrompt(prompt);
        };
        const optimizeConvertedComfyUIPrompt = (prompt = {}) => {
            const graph = prompt && typeof prompt === 'object' && !Array.isArray(prompt) ? prompt : {};
            const getNode = (id) => graph[String(id)] || null;
            const resolveLink = (value) => {
                if (!Array.isArray(value) || value.length < 1) return value;
                const node = getNode(value[0]);
                if (!node) return value;
                const type = String(node.class_type || '');
                if (/^(PrimitiveBoolean|BooleanConstant)$/i.test(type) && Object.prototype.hasOwnProperty.call(node.inputs || {}, 'value')) {
                    return Boolean(node.inputs.value);
                }
                if (/^(PrimitiveInt|IntConstant|PrimitiveFloat|FloatConstant)$/i.test(type) && Object.prototype.hasOwnProperty.call(node.inputs || {}, 'value')) {
                    return node.inputs.value;
                }
                return value;
            };

            Object.values(graph).forEach((node) => {
                Object.entries(node.inputs || {}).forEach(([inputName, value]) => {
                    const resolved = resolveLink(value);
                    if (resolved !== value) node.inputs[inputName] = resolved;
                });
            });

            Object.entries(graph).forEach(([nodeId, node]) => {
                const type = String(node?.class_type || '');
                if (!/input switch$/i.test(type)) return;
                const booleanValue = resolveLink(node.inputs?.boolean);
                if (typeof booleanValue !== 'boolean') return;
                const selected = booleanValue
                    ? (node.inputs?.conditioning_a ?? node.inputs?.image_a ?? node.inputs?.input_a)
                    : (node.inputs?.conditioning_b ?? node.inputs?.image_b ?? node.inputs?.input_b);
                if (selected === undefined) return;
                Object.values(graph).forEach((targetNode) => {
                    Object.entries(targetNode.inputs || {}).forEach(([inputName, value]) => {
                        if (Array.isArray(value) && String(value[0]) === nodeId) {
                            targetNode.inputs[inputName] = selected;
                        }
                    });
                });
                delete graph[nodeId];
            });

            let changed = true;
            while (changed) {
                changed = false;
                const referenced = new Set();
                Object.values(graph).forEach((node) => {
                    Object.values(node.inputs || {}).forEach((value) => {
                        if (Array.isArray(value) && value.length > 0) referenced.add(String(value[0]));
                    });
                });
                Object.entries(graph).forEach(([nodeId, node]) => {
                    const type = String(node?.class_type || '');
                    const isUnreferencedHelper = !referenced.has(nodeId)
                        && /^(Fast Bypasser \(rgthree\)|PrimitiveBoolean|BooleanConstant|PrimitiveInt|IntConstant|PrimitiveFloat|FloatConstant)$/i.test(type);
                    if (isUnreferencedHelper) {
                        delete graph[nodeId];
                        changed = true;
                    }
                });
            }

            return graph;
        };
        const guessComfyUINodeMapping = (apiPrompt = {}, originalWorkflow = null) => {
            const entries = Object.entries(apiPrompt || {});
            const nodeTitle = (id, node) => String(node?._meta?.title || '').trim();
            const nodeText = (id, node) => `${node?.class_type || ''} ${nodeTitle(id, node)} ${JSON.stringify(node?.inputs || {})}`.toLowerCase();
            const hasInput = (node, input) => node?.inputs && Object.prototype.hasOwnProperty.call(node.inputs, input);
            const promptInputNames = ['text', 'value', 'clip_l', 'text_l', 'text_g', 't5xxl', 'prompt', 'positive'];
            const isPromptTextNode = (node) => {
                const classType = String(node?.class_type || '');
                return !/ksampler|samplercustom|basicguider|cfgguider/i.test(classType);
            };
            const getPromptInputs = (node) => promptInputNames.filter(input => hasInput(node, input));
            const mapping = {};

            const stringCandidates = entries
                .filter(([, node]) => /string|text|primitive/i.test(String(node?.class_type || '')) && hasInput(node, 'value'))
                .map(([id, node]) => ({ id, node, text: nodeText(id, node), value: String(node.inputs.value || '') }));
            const encoderCandidates = entries
                .filter(([, node]) => isPromptTextNode(node) && getPromptInputs(node).length > 0)
                .map(([id, node]) => ({ id, node, text: nodeText(id, node), inputs: getPromptInputs(node) }));
            const scorePromptCandidate = (item) => {
                let score = 0;
                if (/prompt|提示词/.test(item.text)) score += 20;
                if (/clip text encode|cliptextencode|conditioning|encode/i.test(item.text)) score += 18;
                if (item.inputs?.some(input => /^(clip_l|text_l|text_g|t5xxl)$/.test(input))) score += 16;
                if (/main|primary|主提示词/.test(item.text)) score += 8;
                if (/custom|upscale|sd upscale|prefix|额外|additional|negative|负面/.test(item.text)) score -= 30;
                return score;
            };
            const promptCandidate = [...stringCandidates]
                .sort((a, b) => scorePromptCandidate(b) - scorePromptCandidate(a))
                .find(item => scorePromptCandidate(item) > 0);
            if (typeof promptCandidate === 'string') {
                mapping.prompt = `${promptCandidate}.text`;
            } else if (promptCandidate?.id) {
                mapping.prompt = `${promptCandidate.id}.value`;
            } else {
                const encoderPrompt = [...encoderCandidates]
                    .sort((a, b) => scorePromptCandidate(b) - scorePromptCandidate(a))
                    .find(item => scorePromptCandidate(item) > 0)
                    || encoderCandidates.find(item => /cliptextencode|encode/i.test(String(item.node?.class_type || '')));
                if (encoderPrompt?.id) {
                    const bindings = encoderPrompt.inputs
                        .filter(input => !/negative|负面/i.test(`${input} ${encoderPrompt.text}`))
                        .map(input => `${encoderPrompt.id}.${input}`);
                    if (bindings.length > 0) mapping.prompt = bindings.length === 1 ? bindings[0] : bindings;
                }
            }
            const fixedCandidate = stringCandidates.find(item => /prefix|额外|additional/.test(item.text));
            if (fixedCandidate?.id) mapping.fixedPrompt = `${fixedCandidate.id}.value`;
            const negativeCandidate = entries.find(([id, node]) => isPromptTextNode(node) && /negative|负面/.test(nodeText(id, node)) && getPromptInputs(node).length > 0);
            if (negativeCandidate) {
                const inputs = getPromptInputs(negativeCandidate[1]);
                const bindings = inputs.map(input => `${negativeCandidate[0]}.${input}`);
                mapping.negative_prompt = bindings.length === 1 ? bindings[0] : bindings;
            }
            const latentCandidate = entries.find(([, node]) => /emptylatentimage/i.test(String(node?.class_type || '')) && hasInput(node, 'width') && hasInput(node, 'height'));
            if (latentCandidate) {
                mapping.width = `${latentCandidate[0]}.width`;
                mapping.height = `${latentCandidate[0]}.height`;
            }
            const seedCandidate = entries.find(([id, node]) => /seed/i.test(`${node?.class_type || ''} ${nodeTitle(id, node)}`) && hasInput(node, 'seed') && !/ksampler/i.test(String(node?.class_type || '')))
                || entries.find(([id, node]) => /(seed|ksampler)/i.test(`${node?.class_type || ''} ${nodeTitle(id, node)}`) && (hasInput(node, 'seed') || hasInput(node, 'noise_seed')));
            if (seedCandidate) mapping.seed = `${seedCandidate[0]}.${hasInput(seedCandidate[1], 'seed') ? 'seed' : 'noise_seed'}`;
            const cfgRescaleCandidate = entries.find(([, node]) => ['cfg_rescale', 'rescale_cfg', 'guidance_rescale'].some(input => hasInput(node, input)));
            if (cfgRescaleCandidate) {
                const inputName = ['cfg_rescale', 'rescale_cfg', 'guidance_rescale'].find(input => hasInput(cfgRescaleCandidate[1], input));
                if (inputName) mapping.cfg_rescale = `${cfgRescaleCandidate[0]}.${inputName}`;
            }
            return mapping;
        };
        const normalizeImportedComfyUIWorkflow = (item, fallbackName = '') => {
            const rawWorkflow = item?.workflow ?? item?.prompt ?? item;
            let workflowPayload = rawWorkflow;
            if (typeof workflowPayload === 'string') {
                try {
                    workflowPayload = JSON.parse(workflowPayload);
                } catch (err) {
                    return null;
                }
            }
            if (Array.isArray(workflowPayload?.workflows) && workflowPayload.workflows.length > 0) {
                return normalizeImportedComfyUIWorkflow(workflowPayload.workflows[0], fallbackName);
            }
            const isUiWorkflow = workflowPayload?.nodes && Array.isArray(workflowPayload.nodes);
            const prompt = isUiWorkflow
                ? convertComfyUIWorkflowToApiPrompt(workflowPayload)
                : (workflowPayload?.prompt && typeof workflowPayload.prompt === 'object' ? workflowPayload.prompt : workflowPayload);
            if (!isLikelyComfyUIApiWorkflow(prompt)) return null;
            const importedMapping = typeof item?.nodeMapping === 'string'
                ? String(item.nodeMapping || '').trim()
                : (item?.nodeMapping && typeof item.nodeMapping === 'object' ? JSON.stringify(item.nodeMapping, null, 2) : '');
            const guessedMapping = importedMapping || (isUiWorkflow ? JSON.stringify(guessComfyUINodeMapping(prompt, workflowPayload), null, 2) : '');
            return {
                id: createImagePromptPresetId(),
                name: String(item?.name || item?.title || fallbackName || '导入工作流').trim() || '导入工作流',
                workflow: JSON.stringify(prompt, null, 2),
                nodeMapping: guessedMapping,
                comfyuiModel: String(item?.comfyuiModel || item?.model || '').trim(),
                comfyuiSampler: String(item?.comfyuiSampler || item?.sampler || 'euler').trim() || 'euler',
                comfyuiScheduler: String(item?.comfyuiScheduler || item?.scheduler || 'normal').trim() || 'normal',
                comfyuiVae: String(item?.comfyuiVae || item?.vae || '').trim(),
                comfyuiClip: String(item?.comfyuiClip || item?.clip || '').trim(),
                updatedAt: Date.now()
            };
        };
        const parseComfyUIWorkflowImportText = (rawText = '') => {
            const text = String(rawText || '').trim();
            if (!text) return [];
            let payload = null;
            try {
                payload = JSON.parse(text);
            } catch (err) {
                throw new Error('导入内容不是有效 JSON');
            }
            const candidates = Array.isArray(payload)
                ? payload
                : (Array.isArray(payload?.workflows)
                    ? payload.workflows
                    : (Array.isArray(payload?.items) ? payload.items : [payload]));
            const workflows = candidates
                .map((item, index) => normalizeImportedComfyUIWorkflow(item, `导入工作流 ${index + 1}`))
                .filter(Boolean);
            return workflows;
        };
        const normalizeComfyUIWorkflowSettings = (settings, fallbackName = '当前工作流') => {
            if (!settings?.workflow) return settings;
            const normalized = normalizeImportedComfyUIWorkflow({
                name: fallbackName,
                workflow: settings.workflow,
                nodeMapping: settings.nodeMapping,
                comfyuiModel: settings.comfyuiModel,
                comfyuiSampler: settings.comfyuiSampler,
                comfyuiScheduler: settings.comfyuiScheduler,
                comfyuiVae: settings.comfyuiVae,
                comfyuiClip: settings.comfyuiClip
            }, fallbackName);
            if (!normalized) throw new Error('无法识别 ComfyUI 工作流 JSON，请粘贴 API Format、普通 UI 工作流或本项目导出的工作流包');
            return {
                ...settings,
                workflow: normalized.workflow,
                nodeMapping: normalized.nodeMapping || settings.nodeMapping || '',
                comfyuiModel: settings.comfyuiModel || normalized.comfyuiModel || '',
                comfyuiSampler: settings.comfyuiSampler || normalized.comfyuiSampler || 'euler',
                comfyuiScheduler: settings.comfyuiScheduler || normalized.comfyuiScheduler || 'normal',
                comfyuiVae: settings.comfyuiVae || normalized.comfyuiVae || '',
                comfyuiClip: settings.comfyuiClip || normalized.comfyuiClip || ''
            };
        };
        const makeUniqueComfyUIWorkflowName = (name, usedNames) => {
            const baseName = String(name || '导入工作流').trim() || '导入工作流';
            let nextName = baseName;
            let index = 2;
            while (usedNames.has(nextName)) {
                nextName = `${baseName} 导入${index}`;
                index += 1;
            }
            usedNames.add(nextName);
            return nextName;
        };
        const buildComfyUIWorkflowSharePayload = (workflows = []) => ({
            type: 'yuzuki-phone-comfyui-workflows',
            version: 1,
            exportedAt: new Date().toISOString(),
            workflows: (Array.isArray(workflows) ? workflows : []).map(workflow => ({
                name: String(workflow?.name || '').trim(),
                workflow: String(workflow?.workflow || '').trim(),
                nodeMapping: String(workflow?.nodeMapping || '').trim(),
                model: String(workflow?.comfyuiModel || '').trim(),
                sampler: String(workflow?.comfyuiSampler || '').trim(),
                scheduler: String(workflow?.comfyuiScheduler || '').trim(),
                vae: String(workflow?.comfyuiVae || '').trim(),
                clip: String(workflow?.comfyuiClip || '').trim()
            })).filter(workflow => workflow.name)
        });
        const showImagePromptPresetTextModal = ({ title, desc, value = '', mode = 'export', onConfirm = null }) => {
            document.getElementById('phone-image-preset-share-modal')?.remove();
            const overlay = document.createElement('div');
            overlay.id = 'phone-image-preset-share-modal';
            overlay.style.cssText = 'position:absolute; inset:0; z-index:10020; background:rgba(0,0,0,0.38); display:flex; align-items:center; justify-content:center; padding:14px; box-sizing:border-box;';
            overlay.innerHTML = `
                <div style="width:100%; max-width:320px; max-height:82%; background:#fff; border-radius:12px; box-shadow:0 12px 28px rgba(0,0,0,0.22); display:flex; flex-direction:column; overflow:hidden;">
                    <div style="padding:12px 14px 8px; border-bottom:1px solid #eee;">
                        <div style="font-size:15px; font-weight:700; color:#111;">${this._escapeHtml(title)}</div>
                        <div style="font-size:11px; line-height:1.45; color:#666; margin-top:4px;">${this._escapeHtml(desc)}</div>
                    </div>
                    <textarea id="phone-image-preset-share-text" spellcheck="false" style="height:240px; min-height:160px; max-height:48vh; width:100%; resize:vertical; border:none; outline:none; padding:10px 12px; box-sizing:border-box; font-size:11px; line-height:1.45; font-family:Consolas, Monaco, monospace; color:#111; background:#fbfbfb; touch-action:pan-y; overscroll-behavior:contain;">${this._escapeHtml(value)}</textarea>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:10px 12px; border-top:1px solid #eee; background:#fff;">
                        <button type="button" id="phone-image-preset-share-cancel" style="height:32px; border:1px solid #ddd; border-radius:8px; background:#fff; color:#333; font-size:12px; cursor:pointer;">取消</button>
                        <button type="button" id="phone-image-preset-share-confirm" style="height:32px; border:none; border-radius:8px; background:${mode === 'import' ? '#f59e0b' : '#2563eb'}; color:#fff; font-size:12px; font-weight:700; cursor:pointer;">${mode === 'import' ? '导入' : '复制'}</button>
                    </div>
                </div>
            `;
            const host = document.querySelector('.phone-view-current') || document.querySelector('.phone-body-panel') || document.body;
            host.appendChild(overlay);
            const textarea = overlay.querySelector('#phone-image-preset-share-text');
            const close = () => overlay.remove();
            overlay.querySelector('#phone-image-preset-share-cancel')?.addEventListener('click', close);
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) close();
            });
            overlay.querySelector('#phone-image-preset-share-confirm')?.addEventListener('click', async () => {
                try {
                    if (mode === 'export') {
                        textarea?.select?.();
                        await navigator.clipboard?.writeText?.(textarea?.value || '');
                        this.phoneShell?.showNotification?.('导出预设', 'JSON 已复制', '✅');
                        close();
                        return;
                    }
                    await onConfirm?.(String(textarea?.value || ''));
                    close();
                } catch (err) {
                    this.phoneShell?.showNotification?.('操作失败', err?.message || String(err || '失败'), '⚠️');
                }
            });
            setTimeout(() => {
                textarea?.focus?.();
                if (mode === 'export') textarea?.select?.();
            }, 30);
        };
        const refreshImagePromptAppPanel = async (appKey, options = {}) => {
            const normalizedApp = this._normalizeImagePromptApp(appKey);
            const presetScope = this._normalizeImagePresetScope(normalizedApp);
            const presets = this._getImagePromptPresets(normalizedApp);
            let activeId = String(this.storage.get(`phone-image-${presetScope}-active-prompt-preset`) || '').trim();
            const activePreset = presets.find(item => item.id === activeId);
            if (!activePreset) activeId = '';
            fillImagePromptPresetSelect(presets, activeId);
            if (imagePromptPresetSelect) imagePromptPresetSelect.value = activeId;

            const draft = activePreset || this._getImagePromptDraft(normalizedApp);
            if (imagePromptPresetName) imagePromptPresetName.value = activePreset?.name || '';
            if (imageFixedPromptInput) imageFixedPromptInput.value = String(draft.fixedPrompt || '');
            if (imageFixedPromptEndInput) imageFixedPromptEndInput.value = String(draft.fixedPromptEnd || '');
            if (imageNegativePromptInput) imageNegativePromptInput.value = String(draft.negativePrompt || '');
            if (activePreset && options.applyGenerationSettings !== false) {
                await applyImageGenerationPresetSettings(activePreset);
            }
        };
        const refreshComfyUIAppPanel = async (appKey, options = {}) => {
            currentComfyUIApp = this._normalizeImagePromptApp(appKey);
            const scope = getComfyUIPresetScope();
            const workflows = this._getComfyUIWorkflows();
            let activeId = String(this.storage.get(`phone-image-${scope}-comfyui-active-workflow`) || this.storage.get('phone-image-comfyui-active-workflow') || '').trim();
            const activeWorkflow = workflows.find(item => item.id === activeId);
            if (!activeWorkflow) activeId = '';
            fillComfyUIWorkflowSelect(workflows, activeId);
            if (imageComfyUIWorkflowSelect) imageComfyUIWorkflowSelect.value = activeId;
            if (imageComfyUIWorkflowName) imageComfyUIWorkflowName.value = activeWorkflow?.name || '';
            if (activeWorkflow && options.applyWorkflow !== false) {
                await applyComfyUIWorkflowSettings(activeWorkflow);
            }
        };

        imagePromptAppSelect?.addEventListener('change', async (e) => {
            const previousApp = currentImagePromptApp;
            const appKey = this._normalizeImagePromptApp(e.target.value);
            await saveImagePromptDraft(previousApp);
            currentImagePromptApp = appKey;
            await this.storage.set('phone-image-active-prompt-app', appKey);
            await refreshImagePromptAppPanel(appKey);
        });

        imageComfyUIAppSelect?.addEventListener('change', async (e) => {
            const appKey = this._normalizeImagePromptApp(e.target.value);
            currentComfyUIApp = appKey;
            await this.storage.set('phone-image-active-comfyui-app', appKey);
            await refreshComfyUIAppPanel(appKey);
        });

        imageEnabled?.addEventListener('change', async (e) => {
            await this.storage.set('phone-image-enabled', !!e.target.checked);
        });

        imageProvider?.addEventListener('change', async (e) => {
            const provider = String(e.target.value || 'novelai').trim() || 'novelai';
            await this.storage.set('phone-image-provider', provider);
            setImageProviderVisibility();
        });

        imageProviderAppBindInputs.forEach((input) => {
            input.addEventListener('change', async (e) => {
                const target = e.currentTarget;
                const appKey = this._normalizeImagePromptApp(target.dataset.app);
                const providerKey = String(target.dataset.provider || '').trim().toLowerCase();
                const bindings = getImageProviderAppBindings();
                if (target.checked) {
                    bindings[appKey] = providerKey;
                } else if (bindings[appKey] === providerKey) {
                    delete bindings[appKey];
                }
                await saveImageProviderAppBindings(bindings);
                syncImageProviderAppBindingInputs(bindings);
            });
        });
        syncImageProviderAppBindingInputs();

        imageNovelaiKey?.addEventListener('change', async (e) => {
            const site = String(imageNovelaiSite?.value || currentNovelaiSite || 'official').trim() || 'official';
            await this.storage.set(site === 'public' ? 'phone-image-novelai-public-key' : 'phone-image-novelai-key', String(e.target.value || '').trim());
        });

        imageOpenaiKey?.addEventListener('change', async (e) => {
            const site = String(imageOpenaiSite?.value || currentOpenaiSite || 'official').trim() || 'official';
            await this.storage.set(site === 'public' ? 'phone-image-openai-public-key' : 'phone-image-openai-key', String(e.target.value || '').trim());
        });

        document.querySelectorAll('[data-toggle-password-target]').forEach((button) => {
            button.addEventListener('click', () => {
                const targetId = String(button.dataset.togglePasswordTarget || '').trim();
                const input = targetId ? document.getElementById(targetId) : null;
                if (!input) return;
                const nextVisible = input.type === 'password';
                input.type = nextVisible ? 'text' : 'password';
                const icon = button.querySelector('i');
                if (icon) {
                    icon.className = nextVisible ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
                }
            });
        });

        document.getElementById('phone-image-debug-payload')?.addEventListener('change', async (e) => {
            await this.storage.set('phone-image-debug-payload', !!e.target.checked);
        });

        document.getElementById('phone-image-novelai-skip-cfg-compat')?.addEventListener('change', async (e) => {
            await this.storage.set('phone-image-novelai-skip-cfg-compat', !!e.target.checked);
        });

        imageNovelAIVibeEnabled?.addEventListener('change', async (e) => {
            await this.storage.set('phone-image-novelai-vibe-enabled', !!e.target.checked);
        });

        imageNovelAIVibeNormalizeStrength?.addEventListener('change', async (e) => {
            await this.storage.set('phone-image-novelai-vibe-normalize-strength', !!e.target.checked);
        });

        imageNovelAIVibeGroupSelect?.addEventListener('change', async (e) => {
            const groupId = String(e.target.value || '').trim();
            await this.storage.set('phone-image-novelai-active-vibe-group', groupId);
            refreshNovelAIVibePanel(groupId);
        });

        imageNovelAIVibeList?.addEventListener('click', (e) => {
            const btn = e.target?.closest?.('.phone-image-vibe-remove');
            if (!btn) return;
            btn.closest('.phone-image-vibe-item')?.remove();
            if (getNovelAIVibeDraftItems().length === 0) renderNovelAIVibeList([]);
        });

        imageNovelAIVibeUploadBtn?.addEventListener('click', () => {
            if (!imageNovelAIVibeFile) {
                this.phoneShell?.showNotification?.('添加失败', '当前环境不支持文件选择', '⚠️');
                return;
            }
            imageNovelAIVibeFile.value = '';
            imageNovelAIVibeFile.click();
        });

        imageNovelAIVibeFile?.addEventListener('change', async () => {
            const files = Array.from(imageNovelAIVibeFile.files || []).filter(file => /^image\//i.test(String(file.type || '')));
            if (!files.length) return;
            const existing = getNovelAIVibeDraftItems();
            try {
                setNovelAIVibeStatus('正在上传 Vibe 图片...', '#7c3aed');
                const uploader = window.VirtualPhone?.imageManager || this.imageManager;
                if (!uploader?.uploadBlob) throw new Error('图片上传器未初始化');
                const uploaded = [];
                for (const file of files) {
                    const image = await uploader.uploadBlob(file, 'nai_vibe');
                    uploaded.push({
                        id: createNovelAIVibeId(),
                        name: String(file.name || `Vibe ${existing.length + uploaded.length + 1}`).replace(/\.[^.]+$/, '').slice(0, 40) || `Vibe ${existing.length + uploaded.length + 1}`,
                        image,
                        strength: 0.6,
                        informationExtracted: 1,
                        cacheSecretKey: ''
                    });
                }
                renderNovelAIVibeList([...existing, ...uploaded]);
                setNovelAIVibeStatus(`已添加 ${uploaded.length} 张 Vibe 图片，记得保存组。`, '#0f9f6e');
            } catch (err) {
                const message = err?.message || String(err || '上传失败');
                setNovelAIVibeStatus(`上传失败：${message}`, '#d33');
                this.phoneShell?.showNotification?.('Vibe 图片上传失败', message, '⚠️');
            } finally {
                imageNovelAIVibeFile.value = '';
            }
        });

        imageNovelAIVibeSaveBtn?.addEventListener('click', async () => {
            const name = String(imageNovelAIVibeGroupName?.value || '').trim();
            const items = getNovelAIVibeDraftItems();
            if (!name) {
                this.phoneShell?.showNotification?.('保存失败', '请先填写 Vibe 组名称', '⚠️');
                imageNovelAIVibeGroupName?.focus?.();
                return;
            }
            if (!items.length) {
                this.phoneShell?.showNotification?.('保存失败', '请先添加至少 1 张 Vibe 图片', '⚠️');
                return;
            }
            const groups = getNovelAIVibeGroups();
            let activeId = getActiveNovelAIVibeGroupId();
            let target = groups.find(group => group.id === activeId);
            if (!target) {
                activeId = createImagePromptPresetId();
                target = { id: activeId, name, items: [], updatedAt: Date.now() };
                groups.push(target);
            }
            Object.assign(target, { name, items, updatedAt: Date.now() });
            await this._saveNovelAIVibeGroups(groups);
            await this.storage.set('phone-image-novelai-active-vibe-group', activeId);
            fillNovelAIVibeGroupSelect(getNovelAIVibeGroups(), activeId);
            if (imageNovelAIVibeGroupSelect) imageNovelAIVibeGroupSelect.value = activeId;
            setNovelAIVibeStatus(`已保存 Vibe 组：${name}`, '#0f9f6e');
            this.phoneShell?.showNotification?.('已保存 Vibe 组', name, '✅');
        });

        imageNovelAIVibeNewBtn?.addEventListener('click', async () => {
            if (imageNovelAIVibeGroupSelect) imageNovelAIVibeGroupSelect.value = '';
            if (imageNovelAIVibeGroupName) {
                imageNovelAIVibeGroupName.value = '';
                imageNovelAIVibeGroupName.focus();
            }
            renderNovelAIVibeList([]);
            await this.storage.set('phone-image-novelai-active-vibe-group', '');
            setNovelAIVibeStatus('已新建空 Vibe 组，添加图片后保存。', '#666');
        });

        imageNovelAIVibeDeleteBtn?.addEventListener('click', async () => {
            const activeId = getActiveNovelAIVibeGroupId();
            if (!activeId) {
                this.phoneShell?.showNotification?.('删除失败', '请先选择要删除的 Vibe 组', '⚠️');
                return;
            }
            const groups = getNovelAIVibeGroups();
            const target = groups.find(group => group.id === activeId);
            if (!target) return;
            if (!confirm(`删除 Vibe 组「${target.name}」？`)) return;
            const nextGroups = groups.filter(group => group.id !== activeId);
            await this._saveNovelAIVibeGroups(nextGroups);
            await this.storage.set('phone-image-novelai-active-vibe-group', '');
            refreshNovelAIVibePanel('');
            setNovelAIVibeStatus(`已删除 Vibe 组：${target.name}`, '#666');
        });

        document.getElementById('phone-image-test-novelai')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const resultEl = document.getElementById('phone-image-test-novelai-result');
            const setResult = (text, color = '#666') => {
                if (resultEl) {
                    resultEl.textContent = text;
                    resultEl.style.color = color;
                }
            };
            const oldText = btn?.textContent || '测试 NAI 生图连接';
            try {
                await this.storage.set('phone-image-provider', 'novelai');
                await this.storage.set('phone-image-enabled', true);
                const site = String(document.getElementById('phone-image-novelai-site')?.value || 'official').trim() || 'official';
                const publicUrl = String(document.getElementById('phone-image-novelai-public-url')?.value || '').trim();
                if (site === 'public' && !publicUrl) throw new Error('请先填写公益站点 Base URL');
                await this.storage.set('phone-image-novelai-site', site);
                await this.storage.set(site === 'public' ? 'phone-image-novelai-public-key' : 'phone-image-novelai-key', String(document.getElementById('phone-image-novelai-key')?.value || '').trim());
                await this.storage.set('phone-image-novelai-url', String(document.getElementById('phone-image-novelai-url')?.value || '').trim());
                await this.storage.set('phone-image-novelai-public-url', publicUrl);
                if (site !== 'public') await this.storage.set('phone-image-novelai-queue-url', String(document.getElementById('phone-image-novelai-queue-url')?.value || '').trim());
                await this.storage.set('phone-image-novelai-model', String(document.getElementById('phone-image-novelai-model')?.value || '').trim() || 'nai-diffusion-4-5-full');
                await this.storage.set('phone-image-novelai-sampler', String(document.getElementById('phone-image-novelai-sampler')?.value || '').trim() || 'k_euler');
                await this.storage.set('phone-image-novelai-schedule', String(document.getElementById('phone-image-novelai-schedule')?.value || '').trim() || 'native');

                const imageManager = window.VirtualPhone?.imageGenerationManager;
                if (!imageManager?.generate) throw new Error('生图管理器未初始化');

                if (btn) {
                    btn.disabled = true;
                    btn.textContent = '测试中...';
                }
                const queueUrl = site === 'public' ? '' : String(document.getElementById('phone-image-novelai-queue-url')?.value || '').trim();
                setResult(site === 'public' ? '正在请求公益站点...' : (queueUrl ? '正在进入 NAI 共享队列...' : '正在请求 NovelAI...'), '#7c3aed');
                const result = await imageManager.generate({
                    app: 'honey',
                    provider: 'novelai',
                    prompt: '1girl, solo, anime illustration, live streaming, looking at viewer',
                    width: 832,
                    height: 1216,
                    ignoreEnabled: true
                });
                if (!result?.imageUrl && !result?.imageData) throw new Error('NovelAI 未返回图片');
                const detail = [
                    result.width && result.height ? `${result.width}x${result.height}` : '',
                    result.steps ? `${result.steps} steps` : '',
                    result.sampler || '',
                    result.schedule || ''
                ].filter(Boolean).join(' · ');
                setResult(`NAI 连接成功，已收到图片数据${detail ? `：${detail}` : '。'}`, '#0f9f6e');
                this.phoneShell?.showNotification?.('生图测试', detail ? `NAI 连接成功 ${detail}` : 'NAI 连接成功', '✅');
            } catch (err) {
                const message = err?.message || String(err || '测试失败');
                setResult(`测试失败：${message}`, '#d33');
                this.phoneShell?.showNotification?.('生图测试失败', message, '❌');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = oldText;
                }
            }
        });

        document.getElementById('phone-image-test-openai')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const resultEl = document.getElementById('phone-image-test-openai-result');
            const setResult = (text, color = '#666') => {
                if (resultEl) {
                    resultEl.textContent = text;
                    resultEl.style.color = color;
                }
            };
            const oldText = btn?.textContent || '测试 GPT 生图连接';
            try {
                await this.storage.set('phone-image-provider', 'openai');
                await this.storage.set('phone-image-enabled', true);
                const site = String(document.getElementById('phone-image-openai-site')?.value || 'official').trim() || 'official';
                const publicUrl = String(document.getElementById('phone-image-openai-public-url')?.value || '').trim();
                const publicRelayUrl = String(document.getElementById('phone-image-openai-public-relay-url')?.value || '').trim();
                const customUrl = String(document.getElementById('phone-image-openai-url')?.value || '').trim();
                if (site === 'public' && !publicUrl) throw new Error('请先填写 GPT 公益站点 Base URL');
                if (site === 'custom' && !customUrl) throw new Error('请先填写 GPT 自定义 Base URL');
                await this.storage.set('phone-image-openai-site', site);
                await this.storage.set(site === 'public' ? 'phone-image-openai-public-key' : 'phone-image-openai-key', String(document.getElementById('phone-image-openai-key')?.value || '').trim());
                await this.storage.set('phone-image-openai-public-url', publicUrl);
                await this.storage.set('phone-image-openai-public-relay-url', publicRelayUrl);
                await this.storage.set('phone-image-openai-url', customUrl);
                await this.storage.set('phone-image-openai-model', String(document.getElementById('phone-image-openai-model')?.value || '').trim() || 'gpt-image-2');
                await this.storage.set('phone-image-openai-mode', 'images');
                await this.storage.set('phone-image-openai-quality', String(document.getElementById('phone-image-openai-quality')?.value || 'auto').trim() || 'auto');

                const imageManager = window.VirtualPhone?.imageGenerationManager;
                if (!imageManager?.generate) throw new Error('生图管理器未初始化');
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = '测试中...';
                }
                setResult(site === 'official' ? '正在请求 OpenAI 官方站点...' : '正在请求 GPT 兼容站点...', '#111827');
                const result = await imageManager.generate({
                    app: 'wechat',
                    provider: 'openai',
                    prompt: 'anime illustration, cute smartphone chat selfie sticker, soft light, clean background',
                    width: 1024,
                    height: 1024,
                    openaiMode: 'images',
                    fixedPrompt: String(document.getElementById('phone-image-fixed-prompt')?.value || '').trim(),
                    fixedPromptEnd: String(document.getElementById('phone-image-fixed-prompt-end')?.value || '').trim(),
                    negativePrompt: String(document.getElementById('phone-image-negative-prompt')?.value || '').trim(),
                    ignoreEnabled: true
                });
                if (!result?.imageUrl && !result?.imageData) throw new Error('GPT 生图未返回图片');
                const imagePayload = String(result?.imageData || result?.imageUrl || '').trim();
                const payloadType = imagePayload.startsWith('data:image/')
                    ? 'Base64，可直接保存'
                    : (imagePayload ? 'URL，实际使用时仍需读取远端图片' : '');
                const detail = [
                    result.width && result.height ? `${result.width}x${result.height}` : '',
                    result.quality ? `quality ${result.quality}` : '',
                    result.model || '',
                    payloadType
                ].filter(Boolean).join(' · ');
                setResult(`GPT 生图连接成功，已收到图片数据${detail ? `：${detail}` : '。'}`, '#0f9f6e');
                this.phoneShell?.showNotification?.('生图测试', detail ? `GPT 连接成功 ${detail}` : 'GPT 连接成功', '✓');
            } catch (err) {
                const message = err?.message || String(err || '测试失败');
                setResult(`测试失败：${message}`, '#d33');
                this.phoneShell?.showNotification?.('GPT 生图测试失败', message, '⚠️');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = oldText;
                }
            }
        });

        imageNovelaiSite?.addEventListener('change', async (e) => {
            if (imageNovelaiKey) {
                await this.storage.set(currentNovelaiSite === 'public' ? 'phone-image-novelai-public-key' : 'phone-image-novelai-key', String(imageNovelaiKey.value || '').trim());
            }
            const site = String(e.target.value || 'official').trim() || 'official';
            await this.storage.set('phone-image-novelai-site', site);
            syncNovelaiSiteFields();
        });

        imageOpenaiSite?.addEventListener('change', async (e) => {
            if (imageOpenaiKey) {
                await this.storage.set(currentOpenaiSite === 'public' ? 'phone-image-openai-public-key' : 'phone-image-openai-key', String(imageOpenaiKey.value || '').trim());
            }
            const site = String(e.target.value || 'official').trim() || 'official';
            await this.storage.set('phone-image-openai-site', site);
            syncOpenaiSiteFields();
        });

        document.getElementById('phone-image-novelai-public-url')?.addEventListener('change', async (e) => {
            await this.storage.set('phone-image-novelai-public-url', String(e.target.value || '').trim());
        });

        document.getElementById('phone-image-novelai-url')?.addEventListener('change', async (e) => {
            await this.storage.set('phone-image-novelai-url', String(e.target.value || '').trim());
        });

        document.getElementById('phone-image-novelai-queue-url')?.addEventListener('change', async (e) => {
            await this.storage.set('phone-image-novelai-queue-url', String(e.target.value || '').trim());
        });

        document.getElementById('phone-image-openai-public-url')?.addEventListener('change', async (e) => {
            await this.storage.set('phone-image-openai-public-url', String(e.target.value || '').trim());
        });

        imageOpenaiPublicRelayUrl?.addEventListener('change', async (e) => {
            await this.storage.set('phone-image-openai-public-relay-url', String(e.target.value || '').trim());
        });

        document.getElementById('phone-image-openai-url')?.addEventListener('change', async (e) => {
            await this.storage.set('phone-image-openai-url', String(e.target.value || '').trim());
        });

        imageOpenaiModelPreset?.addEventListener('change', async (e) => {
            const model = String(e.target.value || '').trim();
            if (!model || !imageOpenaiModel) return;
            imageOpenaiModel.value = model;
            await this.storage.set('phone-image-openai-model', model);
        });

        imageOpenaiModel?.addEventListener('change', async (e) => {
            const model = String(e.target.value || '').trim() || 'gpt-image-2';
            e.target.value = model;
            await this.storage.set('phone-image-openai-model', model);
        });

        document.getElementById('phone-image-openai-fetch-models')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const resultEl = document.getElementById('phone-image-openai-models-result');
            const setResult = (text, color = '#666') => {
                if (resultEl) {
                    resultEl.textContent = text;
                    resultEl.style.color = color;
                }
            };
            const oldText = btn?.textContent || '拉取 GPT 生图模型';
            try {
                const imageManager = window.VirtualPhone?.imageGenerationManager;
                if (!imageManager?.fetchOpenAIModels) throw new Error('生图管理器未初始化或版本过旧');
                const site = String(document.getElementById('phone-image-openai-site')?.value || 'official').trim() || 'official';
                const publicUrl = String(document.getElementById('phone-image-openai-public-url')?.value || '').trim();
                const publicRelayUrl = String(document.getElementById('phone-image-openai-public-relay-url')?.value || '').trim();
                const customUrl = String(document.getElementById('phone-image-openai-url')?.value || '').trim();
                const apiKey = String(document.getElementById('phone-image-openai-key')?.value || '').trim();
                if (site === 'public' && !publicUrl) throw new Error('请先填写 GPT 公益站点 Base URL');
                if (site === 'custom' && !customUrl) throw new Error('请先填写 GPT 自定义 Base URL');
                if (!apiKey) throw new Error('请先填写 GPT 生图 API Key');

                await this.storage.set('phone-image-openai-site', site);
                await this.storage.set(site === 'public' ? 'phone-image-openai-public-key' : 'phone-image-openai-key', apiKey);
                await this.storage.set('phone-image-openai-public-url', publicUrl);
                await this.storage.set('phone-image-openai-public-relay-url', publicRelayUrl);
                await this.storage.set('phone-image-openai-url', customUrl);

                if (btn) {
                    btn.disabled = true;
                    btn.textContent = '拉取中...';
                }
                setResult('正在请求 /v1/models...', '#2563eb');
                const data = await imageManager.fetchOpenAIModels({
                    openaiSite: site,
                    openaiPublicUrl: publicUrl,
                    openaiPublicRelayUrl: publicRelayUrl,
                    openaiCustomUrl: customUrl,
                    apiKey
                });
                const models = Array.isArray(data?.models) ? data.models : [];
                if (!models.length) throw new Error('模型列表为空');

                if (imageOpenaiModelPreset) {
                    imageOpenaiModelPreset.innerHTML = '<option value="">-- 快速选择 --</option>';
                    models.forEach((model) => {
                        const id = String(model?.id || model || '').trim();
                        if (!id) return;
                        const opt = document.createElement('option');
                        opt.value = id;
                        opt.textContent = id;
                        imageOpenaiModelPreset.appendChild(opt);
                    });
                }
                const currentModel = String(imageOpenaiModel?.value || '').trim();
                const firstModel = String(models[0]?.id || models[0] || '').trim();
                const modelIds = models.map(item => String(item?.id || item || '').trim()).filter(Boolean);
                const nextModel = modelIds.includes(currentModel) ? currentModel : firstModel;
                if (nextModel && imageOpenaiModel) {
                    imageOpenaiModel.value = nextModel;
                    await this.storage.set('phone-image-openai-model', nextModel);
                    if (imageOpenaiModelPreset) imageOpenaiModelPreset.value = nextModel;
                }
                setResult(`已拉取 ${models.length} 个${data?.filtered ? '生图' : ''}模型${nextModel ? `，当前选择 ${nextModel}` : '。'}`, '#0f9f6e');
            } catch (err) {
                const message = err?.message || String(err || '拉取失败');
                setResult(`拉取失败：${message}`, '#d33');
                this.phoneShell?.showNotification?.('GPT 模型拉取失败', message, '⚠️');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = oldText;
                }
            }
        });

        imageOpenaiQuality?.addEventListener('change', async (e) => {
            const value = String(e.target.value || 'auto').trim() || 'auto';
            e.target.value = value;
            await this.storage.set('phone-image-openai-quality', value);
        });

        imageOpenaiPresetSelect?.addEventListener('change', async (e) => {
            const presetId = String(e.target.value || '').trim();
            await this.storage.set('phone-image-openai-active-preset', presetId);
            const presets = this._getOpenAIImagePresets();
            const preset = presets.find(item => item.id === presetId);
            if (!preset) {
                if (imageOpenaiPresetName) imageOpenaiPresetName.value = '';
                return;
            }
            if (imageOpenaiPresetName) imageOpenaiPresetName.value = preset.name;
            await applyOpenAIImagePresetSettings(preset);
            this.phoneShell?.showNotification?.('已切换 GPT 预设', preset.name, '🎨');
        });

        imageOpenaiPresetSaveBtn?.addEventListener('click', async () => {
            const name = String(imageOpenaiPresetName?.value || '').trim();
            if (!name) {
                this.phoneShell?.showNotification?.('保存失败', '请先填写 GPT 预设名称', '⚠️');
                imageOpenaiPresetName?.focus?.();
                return;
            }

            const now = Date.now();
            const presets = this._getOpenAIImagePresets();
            let activeId = String(imageOpenaiPresetSelect?.value || this.storage.get('phone-image-openai-active-preset') || '').trim();
            let target = presets.find(preset => preset.id === activeId);
            if (!target) {
                activeId = createImagePromptPresetId();
                target = { id: activeId, name, updatedAt: now };
                presets.push(target);
            }

            Object.assign(target, getOpenAIImagePresetSettings(), { name, updatedAt: now });
            await saveImagePromptDraft(getActiveImagePromptApp(), {
                fixedPrompt: target.fixedPrompt,
                fixedPromptEnd: target.fixedPromptEnd,
                negativePrompt: target.negativePrompt
            });
            await this._saveOpenAIImagePresets(presets);
            await this.storage.set('phone-image-openai-active-preset', activeId);
            fillOpenAIImagePresetSelect(presets, activeId);
            if (imageOpenaiPresetSelect) imageOpenaiPresetSelect.value = activeId;
            this.phoneShell?.showNotification?.('已保存 GPT 预设', name, '✅');
        });

        imageOpenaiPresetNewBtn?.addEventListener('click', async () => {
            if (imageOpenaiPresetSelect) imageOpenaiPresetSelect.value = '';
            if (imageOpenaiPresetName) {
                imageOpenaiPresetName.value = '';
                imageOpenaiPresetName.focus();
            }
            await this.storage.set('phone-image-openai-active-preset', '');
            this.phoneShell?.showNotification?.('新建 GPT 预设', '填写名称后点击保存', '✏️');
        });

        imageOpenaiPresetDeleteBtn?.addEventListener('click', async () => {
            const activeId = String(imageOpenaiPresetSelect?.value || this.storage.get('phone-image-openai-active-preset') || '').trim();
            if (!activeId) {
                this.phoneShell?.showNotification?.('删除失败', '请先选择要删除的 GPT 预设', '⚠️');
                return;
            }
            const presets = this._getOpenAIImagePresets();
            const target = presets.find(preset => preset.id === activeId);
            if (!target) return;
            if (!confirm(`删除 GPT 生图预设「${target.name}」？`)) return;

            const nextPresets = presets.filter(preset => preset.id !== activeId);
            await this._saveOpenAIImagePresets(nextPresets);
            await this.storage.set('phone-image-openai-active-preset', '');
            fillOpenAIImagePresetSelect(nextPresets, '');
            if (imageOpenaiPresetName) imageOpenaiPresetName.value = '';
            this.phoneShell?.showNotification?.('已删除 GPT 预设', target.name, '🗑️');
        });

        imageNovelaiModel?.addEventListener('change', async (e) => {
            const model = String(e.target.value || '').trim() || 'nai-diffusion-4-5-full';
            e.target.value = model;
            await this.storage.set('phone-image-novelai-model', model);
        });

        document.getElementById('phone-image-novelai-sampler')?.addEventListener('change', async (e) => {
            const value = String(e.target.value || '').trim() || 'k_euler';
            e.target.value = value;
            await this.storage.set('phone-image-novelai-sampler', value);
        });

        document.getElementById('phone-image-novelai-schedule')?.addEventListener('change', async (e) => {
            const value = String(e.target.value || '').trim() || 'native';
            e.target.value = value;
            await this.storage.set('phone-image-novelai-schedule', value);
        });

        imagePromptPresetSelect?.addEventListener('change', async (e) => {
            const presetId = String(e.target.value || '').trim();
            const appKey = getActiveImagePromptApp();
            const presetScope = this._normalizeImagePresetScope(appKey);
            await this.storage.set(`phone-image-${presetScope}-active-prompt-preset`, presetId);
            const presets = this._getImagePromptPresets(appKey);
            const preset = presets.find(item => item.id === presetId);
            if (!preset) {
                if (imagePromptPresetName) imagePromptPresetName.value = '';
                return;
            }
            if (imagePromptPresetName) imagePromptPresetName.value = preset.name;
            await setImagePromptForm(preset);
            await applyImageGenerationPresetSettings(preset);
            this.phoneShell?.showNotification?.('已切换生图设定', preset.name, '🎨');
        });

        imagePromptPresetSaveBtn?.addEventListener('click', async () => {
            const name = String(imagePromptPresetName?.value || '').trim();
            if (!name) {
                this.phoneShell?.showNotification?.('保存失败', '请先填写设定名称', '⚠️');
                imagePromptPresetName?.focus?.();
                return;
            }

            const appKey = getActiveImagePromptApp();
            const now = Date.now();
            const presets = this._getImagePromptPresets(appKey);
            const presetScope = this._normalizeImagePresetScope(appKey);
            let activeId = String(imagePromptPresetSelect?.value || this.storage.get(`phone-image-${presetScope}-active-prompt-preset`) || '').trim();
            let target = presets.find(preset => preset.id === activeId);
            if (!target) {
                activeId = createImagePromptPresetId();
                target = { id: activeId, name, fixedPrompt: '', fixedPromptEnd: '', negativePrompt: '', updatedAt: now };
                presets.push(target);
            }

            const form = getImagePromptForm();
            const generationSettings = getImageGenerationPresetSettings();
            target.name = name;
            target.fixedPrompt = form.fixedPrompt;
            target.fixedPromptEnd = form.fixedPromptEnd;
            target.negativePrompt = form.negativePrompt;
            Object.assign(target, generationSettings);
            target.updatedAt = now;

            await saveImagePromptDraft(appKey, form);
            await this._saveImagePromptPresets(appKey, presets);
            await this.storage.set(`phone-image-${presetScope}-active-prompt-preset`, activeId);
            fillImagePromptPresetSelect(presets, activeId);
            this.phoneShell?.showNotification?.('已保存生图设定', name, '✅');
        });

        imagePromptPresetNewBtn?.addEventListener('click', async () => {
            const appKey = getActiveImagePromptApp();
            if (imagePromptPresetSelect) imagePromptPresetSelect.value = '';
            if (imagePromptPresetName) {
                imagePromptPresetName.value = '';
                imagePromptPresetName.focus();
            }
            await this.storage.set(`phone-image-${this._normalizeImagePresetScope(appKey)}-active-prompt-preset`, '');
            this.phoneShell?.showNotification?.('新建生图设定', '填写名称后点击保存', '✏️');
        });

        imagePromptPresetDeleteBtn?.addEventListener('click', async () => {
            const appKey = getActiveImagePromptApp();
            const presetScope = this._normalizeImagePresetScope(appKey);
            const activeId = String(imagePromptPresetSelect?.value || this.storage.get(`phone-image-${presetScope}-active-prompt-preset`) || '').trim();
            if (!activeId) {
                this.phoneShell?.showNotification?.('删除失败', '请先选择要删除的设定', '⚠️');
                return;
            }
            const presets = this._getImagePromptPresets(appKey);
            const target = presets.find(preset => preset.id === activeId);
            if (!target) return;
            if (!confirm(`删除生图提示词设定「${target.name}」？`)) return;

            const nextPresets = presets.filter(preset => preset.id !== activeId);
            await this._saveImagePromptPresets(appKey, nextPresets);
            await this.storage.set(`phone-image-${presetScope}-active-prompt-preset`, '');
            fillImagePromptPresetSelect(nextPresets, '');
            if (imagePromptPresetName) imagePromptPresetName.value = '';
            this.phoneShell?.showNotification?.('已删除生图设定', target.name, '🗑️');
        });

        imagePromptPresetClearAllBtn?.addEventListener('click', async () => {
            const presetMap = this._getImagePromptPresetMap();
            const scopes = Array.from(new Set(this._getImagePromptAppDefs().map(def => this._normalizeImagePresetScope(def.id))));
            const totalCount = scopes.reduce((sum, scope) => {
                const list = this._getImagePromptPresets(scope);
                return sum + list.length;
            }, 0);
            if (totalCount <= 0) {
                for (const scope of scopes) {
                    await this.storage.set(`phone-image-${scope}-active-prompt-preset`, '');
                    await this.storage.set(`phone-image-${scope}-fixed-prompt`, '');
                    await this.storage.set(`phone-image-${scope}-fixed-prompt-end`, '');
                    await this.storage.set(`phone-image-${scope}-negative-prompt`, '');
                }
                await restoreDefaultImageAppSizes();
                fillImagePromptPresetSelect([], '');
                if (imagePromptPresetSelect) imagePromptPresetSelect.value = '';
                if (imagePromptPresetName) imagePromptPresetName.value = '';
                await setImagePromptForm(this._getImagePromptDraft(getActiveImagePromptApp()));
                this.phoneShell?.showNotification?.('NAI 预设', '没有可删除的 NAI 预设，已恢复默认尺寸', '✅');
                return;
            }
            if (!confirm(`确定删除全部 ${totalCount} 套 NAI 生图预设吗？\n\n会清空蜜语、微信/日记、微博的 NAI 预设和当前选择，并恢复默认初始尺寸；API Key、模型和连接设置不会删除。`)) return;

            scopes.forEach(scope => {
                presetMap[scope] = [];
            });
            await this.storage.set('phone-image-prompt-presets-by-app', JSON.stringify(presetMap));
            await this.storage.set('phone-image-prompt-presets', JSON.stringify([]));
            for (const scope of scopes) {
                await this.storage.set(`phone-image-${scope}-active-prompt-preset`, '');
                await this.storage.set(`phone-image-${scope}-fixed-prompt`, '');
                await this.storage.set(`phone-image-${scope}-fixed-prompt-end`, '');
                await this.storage.set(`phone-image-${scope}-negative-prompt`, '');
            }
            await restoreDefaultImageAppSizes();

            const appKey = getActiveImagePromptApp();
            fillImagePromptPresetSelect([], '');
            if (imagePromptPresetSelect) imagePromptPresetSelect.value = '';
            if (imagePromptPresetName) imagePromptPresetName.value = '';
            await setImagePromptForm(this._getImagePromptDraft(appKey));
            this.phoneShell?.showNotification?.('已清空 NAI 预设', `已删除 ${totalCount} 套预设并恢复默认尺寸`, '🗑️');
        });

        imagePromptPresetExportBtn?.addEventListener('click', async () => {
            const appKey = getActiveImagePromptApp();
            const presets = this._getImagePromptPresets(appKey);
            if (!presets.length) {
                this.phoneShell?.showNotification?.('导出失败', '还没有可导出的共享 NAI 生图预设', '⚠️');
                return;
            }
            const presetScope = this._normalizeImagePresetScope(appKey);
            const activeId = String(imagePromptPresetSelect?.value || this.storage.get(`phone-image-${presetScope}-active-prompt-preset`) || '').trim();
            const appName = getImagePromptAppName(appKey);
            showImagePresetExportChooser({
                title: '导出 NAI 预设',
                desc: '选择要写入 JSON 文件的预设。',
                presets,
                selectedIds: activeId ? [activeId] : presets.map(preset => preset.id),
                onConfirm: async (selectedIds) => {
                    const selectedSet = new Set(selectedIds);
                    const exportPresets = presets.filter(preset => selectedSet.has(preset.id));
                    const payload = buildImagePromptPresetSharePayload(appKey, exportPresets);
                    downloadJsonFile(payload, buildImagePresetExportFilename(exportPresets));
                    this.phoneShell?.showNotification?.('导出完成', `已导出 ${payload.presets.length} 套 NAI 预设文件`, '✅');
                }
            });
        });

        imagePromptPresetImportBtn?.addEventListener('click', async () => {
            if (!imagePromptPresetImportFile) {
                this.phoneShell?.showNotification?.('导入失败', '当前环境不支持文件选择', '⚠️');
                return;
            }
            imagePromptPresetImportFile.value = '';
            imagePromptPresetImportFile.click();
        });

        imagePromptPresetImportFile?.addEventListener('change', async () => {
            const appKey = getActiveImagePromptApp();
            try {
                const rawText = await readJsonImportFile(imagePromptPresetImportFile.files?.[0]);
                const imported = parseImagePromptPresetImportText(rawText);
                if (!imported.length) throw new Error('没有识别到可导入的预设');
                const existing = this._getImagePromptPresets(appKey);
                const usedNames = new Set(existing.map(preset => String(preset.name || '').trim()).filter(Boolean));
                const nextPresets = [...existing];
                let firstImportedId = '';
                imported.forEach((preset) => {
                    preset.id = createImagePromptPresetId();
                    if (!firstImportedId) firstImportedId = preset.id;
                    preset.name = makeUniqueImagePresetName(preset.name, usedNames);
                    preset.updatedAt = Date.now();
                    nextPresets.push(preset);
                });
                await this._saveImagePromptPresets(appKey, nextPresets);
                const activeId = firstImportedId;
                if (activeId) {
                    await this.storage.set(`phone-image-${this._normalizeImagePresetScope(appKey)}-active-prompt-preset`, activeId);
                }
                fillImagePromptPresetSelect(nextPresets, activeId);
                if (imagePromptPresetSelect) imagePromptPresetSelect.value = activeId;
                const activePreset = nextPresets.find(preset => preset.id === activeId) || imported[0];
                if (activePreset) {
                    if (imagePromptPresetName) imagePromptPresetName.value = activePreset.name;
                    await setImagePromptForm(activePreset);
                    await applyImageGenerationPresetSettings(activePreset);
                }
                this.phoneShell?.showNotification?.('导入完成', `已导入 ${imported.length} 套 NAI 预设`, '✅');
            } catch (err) {
                this.phoneShell?.showNotification?.('导入失败', err?.message || String(err || '失败'), '⚠️');
            } finally {
                imagePromptPresetImportFile.value = '';
            }
        });

        document.getElementById('siliconflow-api-key')?.addEventListener('change', async (e) => {
            const value = String(e.target.value || '').trim();
            await this.storage.set('phone-image-siliconflow-key', value);
            await this.storage.set('siliconflow_api_key', value);
        });

        document.getElementById('image-generation-model')?.addEventListener('change', async (e) => {
            const nextModel = String(e.target.value || '').trim() || 'Kwai-Kolors/Kolors';
            e.target.value = nextModel;
            await this.storage.set('phone-image-siliconflow-model', nextModel);
            await this.storage.set('image_generation_model', nextModel);
        });

        const fillSdSelect = (select, items, selectedValue = '', emptyLabel = '自动', mapper = item => item) => {
            if (!select) return;
            const selected = String(selectedValue || '').trim();
            const values = [];
            const seen = new Set();
            (Array.isArray(items) ? items : []).forEach((item) => {
                const value = String(mapper(item) || '').trim();
                if (!value || seen.has(value)) return;
                seen.add(value);
                values.push(value);
            });
            select.innerHTML = '';
            if (emptyLabel !== null) {
                const emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = emptyLabel;
                select.appendChild(emptyOpt);
            }
            values.forEach((value) => {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = value;
                opt.selected = value === selected;
                select.appendChild(opt);
            });
            if (selected && !values.includes(selected)) {
                const opt = document.createElement('option');
                opt.value = selected;
                opt.textContent = selected;
                opt.selected = true;
                select.appendChild(opt);
            }
            if (!select.value && selected) select.value = selected;
        };
        const fallbackSdSamplers = [
            'Euler a',
            'Euler',
            'LMS',
            'Heun',
            'DPM2',
            'DPM2 a',
            'DPM++ 2S a',
            'DPM++ 2M',
            'DPM++ SDE',
            'DPM fast',
            'DPM adaptive',
            'LMS Karras',
            'DPM2 Karras',
            'DPM2 a Karras',
            'DPM++ 2S a Karras',
            'DPM++ 2M Karras',
            'DPM++ SDE Karras',
            'DDIM',
            'PLMS'
        ];
        const fallbackComfyUISamplers = ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_sde', 'ddim'];
        const fallbackComfyUISchedulers = ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform'];
        const getComfyUIMode = () => String(document.getElementById('phone-image-comfyui-mode')?.value || 'local').trim() === 'remote' ? 'remote' : 'local';
        const getActiveComfyUIUrl = () => {
            const mode = getComfyUIMode();
            const localUrl = String(document.getElementById('phone-image-comfyui-url')?.value || '').trim() || 'http://127.0.0.1:8188';
            const remoteUrl = String(document.getElementById('phone-image-comfyui-remote-url')?.value || '').trim();
            return mode === 'remote' ? (remoteUrl || localUrl) : localUrl;
        };
        const updateComfyUIModeRows = () => {
            const localRow = document.getElementById('phone-image-comfyui-local-url-row');
            const remoteRow = document.getElementById('phone-image-comfyui-remote-url-row');
            const isRemote = getComfyUIMode() === 'remote';
            if (localRow) localRow.style.display = isRemote ? 'none' : '';
            if (remoteRow) remoteRow.style.display = isRemote ? '' : 'none';
        };
        const saveComfyUISettings = async () => {
            await this.storage.set('phone-image-comfyui-mode', getComfyUIMode());
            const textFields = [
                ['phone-image-comfyui-url', 'http://127.0.0.1:8188'],
                ['phone-image-comfyui-remote-url', ''],
                ['phone-image-comfyui-model', ''],
                ['phone-image-comfyui-sampler', 'euler'],
                ['phone-image-comfyui-scheduler', 'normal'],
                ['phone-image-comfyui-vae', ''],
                ['phone-image-comfyui-clip', ''],
                ['phone-image-comfyui-workflow', ''],
                ['phone-image-comfyui-node-mapping', '']
            ];
            for (const [id, fallback] of textFields) {
                const input = document.getElementById(id);
                if (!input) continue;
                const value = String(input.value || '').trim() || fallback;
                if (id !== 'phone-image-comfyui-workflow') input.value = value;
                await this.storage.set(id, value);
            }
        };
        document.getElementById('phone-image-comfyui-mode')?.addEventListener('change', async () => {
            updateComfyUIModeRows();
            await saveComfyUISettings();
        });
        updateComfyUIModeRows();
        [
            'phone-image-comfyui-url',
            'phone-image-comfyui-remote-url',
            'phone-image-comfyui-model',
            'phone-image-comfyui-sampler',
            'phone-image-comfyui-scheduler',
            'phone-image-comfyui-vae',
            'phone-image-comfyui-clip',
            'phone-image-comfyui-workflow',
            'phone-image-comfyui-node-mapping'
        ].forEach((id) => {
            const input = document.getElementById(id);
            if (!input) return;
            input.addEventListener('change', saveComfyUISettings);
            input.addEventListener('blur', saveComfyUISettings);
        });

        imageComfyUIWorkflowSelect?.addEventListener('change', async (e) => {
            const workflowId = String(e.target.value || '').trim();
            const scope = getComfyUIPresetScope();
            await this.storage.set(`phone-image-${scope}-comfyui-active-workflow`, workflowId);
            await this.storage.set('phone-image-comfyui-active-workflow', workflowId);
            const workflows = this._getComfyUIWorkflows();
            const workflow = workflows.find(item => item.id === workflowId);
            if (!workflow) {
                if (imageComfyUIWorkflowName) imageComfyUIWorkflowName.value = '';
                return;
            }
            if (imageComfyUIWorkflowName) imageComfyUIWorkflowName.value = workflow.name;
            await applyComfyUIWorkflowSettings(workflow);
            this.phoneShell?.showNotification?.('已切换 ComfyUI 工作流', workflow.name, '🎨');
        });

        imageComfyUIWorkflowSaveBtn?.addEventListener('click', async () => {
            try {
                await saveComfyUISettings();
                const name = String(imageComfyUIWorkflowName?.value || '').trim();
                if (!name) {
                    this.phoneShell?.showNotification?.('保存失败', '请先填写 ComfyUI 工作流名称', '⚠️');
                    imageComfyUIWorkflowName?.focus?.();
                    return;
                }

                const settings = normalizeComfyUIWorkflowSettings(getComfyUIWorkflowSettings(), name);
                if (settings.workflow) setComfyUIFieldValue('phone-image-comfyui-workflow', settings.workflow);
                if (settings.nodeMapping) setComfyUIFieldValue('phone-image-comfyui-node-mapping', settings.nodeMapping);
                if (settings.nodeMapping) {
                    const parsedMapping = JSON.parse(settings.nodeMapping);
                    if (!parsedMapping || typeof parsedMapping !== 'object' || Array.isArray(parsedMapping)) {
                        throw new Error('节点映射必须是 JSON 对象');
                    }
                }

                const now = Date.now();
                const workflows = this._getComfyUIWorkflows();
                const scope = getComfyUIPresetScope();
                let activeId = String(imageComfyUIWorkflowSelect?.value || this.storage.get(`phone-image-${scope}-comfyui-active-workflow`) || this.storage.get('phone-image-comfyui-active-workflow') || '').trim();
                let target = workflows.find(workflow => workflow.id === activeId);
                if (!target) {
                    activeId = createImagePromptPresetId();
                    target = { id: activeId, name, workflow: '', updatedAt: now };
                    workflows.push(target);
                }
                Object.assign(target, settings, { name, updatedAt: now });
                await this._saveComfyUIWorkflows(workflows);
                await this.storage.set(`phone-image-${scope}-comfyui-active-workflow`, activeId);
                await this.storage.set('phone-image-comfyui-active-workflow', activeId);
                fillComfyUIWorkflowSelect(workflows, activeId);
                if (imageComfyUIWorkflowSelect) imageComfyUIWorkflowSelect.value = activeId;
                this.phoneShell?.showNotification?.('已保存 ComfyUI 工作流', name, '✅');
            } catch (err) {
                this.phoneShell?.showNotification?.('保存失败', err?.message || String(err || '失败'), '⚠️');
            }
        });

        imageComfyUIWorkflowNewBtn?.addEventListener('click', async () => {
            if (imageComfyUIWorkflowSelect) imageComfyUIWorkflowSelect.value = '';
            if (imageComfyUIWorkflowName) {
                imageComfyUIWorkflowName.value = '';
                imageComfyUIWorkflowName.focus();
            }
            await this.storage.set(`phone-image-${getComfyUIPresetScope()}-comfyui-active-workflow`, '');
            await this.storage.set('phone-image-comfyui-active-workflow', '');
            this.phoneShell?.showNotification?.('新建 ComfyUI 工作流', '填写名称后点击保存', '✏️');
        });

        imageComfyUIWorkflowDeleteBtn?.addEventListener('click', async () => {
            const scope = getComfyUIPresetScope();
            const activeId = String(imageComfyUIWorkflowSelect?.value || this.storage.get(`phone-image-${scope}-comfyui-active-workflow`) || this.storage.get('phone-image-comfyui-active-workflow') || '').trim();
            if (!activeId) {
                this.phoneShell?.showNotification?.('删除失败', '请先选择要删除的 ComfyUI 工作流', '⚠️');
                return;
            }
            const workflows = this._getComfyUIWorkflows();
            const target = workflows.find(workflow => workflow.id === activeId);
            if (!target) return;
            if (!confirm(`删除 ComfyUI 工作流「${target.name}」？`)) return;

            const nextWorkflows = workflows.filter(workflow => workflow.id !== activeId);
            await this._saveComfyUIWorkflows(nextWorkflows);
            await this.storage.set(`phone-image-${scope}-comfyui-active-workflow`, '');
            await this.storage.set('phone-image-comfyui-active-workflow', '');
            fillComfyUIWorkflowSelect(nextWorkflows, '');
            if (imageComfyUIWorkflowSelect) imageComfyUIWorkflowSelect.value = '';
            if (imageComfyUIWorkflowName) imageComfyUIWorkflowName.value = '';
            this.phoneShell?.showNotification?.('已删除 ComfyUI 工作流', target.name, '🗑️');
        });

        imageComfyUIWorkflowExportBtn?.addEventListener('click', async () => {
            const workflows = this._getComfyUIWorkflows();
            const activeId = String(imageComfyUIWorkflowSelect?.value || getComfyUIActiveWorkflowId()).trim();
            const activeWorkflow = workflows.find(workflow => workflow.id === activeId);
            const exportWorkflows = activeWorkflow ? [activeWorkflow] : workflows;
            if (!exportWorkflows.length) {
                this.phoneShell?.showNotification?.('导出失败', '还没有可导出的 ComfyUI 工作流', '⚠️');
                return;
            }
            const payload = buildComfyUIWorkflowSharePayload(exportWorkflows);
            const baseName = activeWorkflow
                ? `yuzuki-comfyui-workflow-${activeWorkflow.name}`
                : 'yuzuki-comfyui-workflows';
            downloadJsonFile(payload, `${baseName}-${new Date().toISOString().slice(0, 10)}.json`);
            this.phoneShell?.showNotification?.('导出完成', `已导出 ${payload.workflows.length} 套 ComfyUI 工作流文件`, '✅');
        });

        imageComfyUIWorkflowImportBtn?.addEventListener('click', async () => {
            if (!imageComfyUIWorkflowImportFile) {
                this.phoneShell?.showNotification?.('导入失败', '当前环境不支持文件选择', '⚠️');
                return;
            }
            imageComfyUIWorkflowImportFile.value = '';
            imageComfyUIWorkflowImportFile.click();
        });

        imageComfyUIWorkflowImportFile?.addEventListener('change', async () => {
            try {
                const rawText = await readJsonImportFile(imageComfyUIWorkflowImportFile.files?.[0]);
                const imported = parseComfyUIWorkflowImportText(rawText);
                if (!imported.length) throw new Error('没有识别到可导入的 ComfyUI 工作流');
                const existing = this._getComfyUIWorkflows();
                const usedNames = new Set(existing.map(workflow => String(workflow.name || '').trim()).filter(Boolean));
                const nextWorkflows = [...existing];
                let firstImportedId = '';
                imported.forEach((workflow) => {
                    workflow.id = createImagePromptPresetId();
                    if (!firstImportedId) firstImportedId = workflow.id;
                    workflow.name = makeUniqueComfyUIWorkflowName(workflow.name, usedNames);
                    workflow.updatedAt = Date.now();
                    nextWorkflows.push(workflow);
                });
                await this._saveComfyUIWorkflows(nextWorkflows);
                await this.storage.set(`phone-image-${getComfyUIPresetScope()}-comfyui-active-workflow`, firstImportedId);
                await this.storage.set('phone-image-comfyui-active-workflow', firstImportedId);
                fillComfyUIWorkflowSelect(nextWorkflows, firstImportedId);
                if (imageComfyUIWorkflowSelect) imageComfyUIWorkflowSelect.value = firstImportedId;
                const activeWorkflow = nextWorkflows.find(workflow => workflow.id === firstImportedId) || imported[0];
                if (activeWorkflow) {
                    if (imageComfyUIWorkflowName) imageComfyUIWorkflowName.value = activeWorkflow.name;
                    await applyComfyUIWorkflowSettings(activeWorkflow);
                }
                this.phoneShell?.showNotification?.('导入完成', `已导入 ${imported.length} 套 ComfyUI 工作流`, '✅');
            } catch (err) {
                this.phoneShell?.showNotification?.('导入失败', err?.message || String(err || '失败'), '⚠️');
            } finally {
                imageComfyUIWorkflowImportFile.value = '';
            }
        });

        imageComfyUIWorkflowClearBtn?.addEventListener('click', async () => {
            setComfyUIFieldValue('phone-image-comfyui-workflow', '');
            setComfyUIFieldValue('phone-image-comfyui-node-mapping', '');
            if (imageComfyUIWorkflowSelect) imageComfyUIWorkflowSelect.value = '';
            if (imageComfyUIWorkflowName) imageComfyUIWorkflowName.value = '';
            await this.storage.set(`phone-image-${getComfyUIPresetScope()}-comfyui-active-workflow`, '');
            await this.storage.set('phone-image-comfyui-active-workflow', '');
            await this.storage.set('phone-image-comfyui-node-mapping', '');
            await saveComfyUISettings();
            this.phoneShell?.showNotification?.('已切换内置工作流', '当前会使用基础文生图工作流', '✅');
        });

        imageComfyUIWorkflowHelpBtn?.addEventListener('click', () => {
            showImagePromptPresetTextModal({
                title: 'ComfyUI 工作流说明',
                desc: '第三方工作流导入和占位符用法',
                value: [
                    '不填则使用内置基础工作流。',
                    '这里只需要一个 JSON：可直接粘贴 ComfyUI 普通工作流、API Format，或本项目导出的工作流包。',
                    '普通工作流会自动转换，并自动识别提示词、尺寸、seed 和采样器节点。',
                    '简单工作流也可继续使用占位符：',
                    '%prompt%、%negative_prompt%、%width%、%height%、%MODEL_NAME%、%reference_image%。',
                    '如提示缺少节点，请在 ComfyUI Manager 安装对应自定义节点。'
                ].join('\n'),
                mode: 'export'
            });
        });

        document.getElementById('phone-image-comfyui-refresh')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const statusEl = document.getElementById('phone-image-comfyui-status');
            const modelSelect = document.getElementById('phone-image-comfyui-model');
            const samplerSelect = document.getElementById('phone-image-comfyui-sampler');
            const schedulerSelect = document.getElementById('phone-image-comfyui-scheduler');
            const vaeSelect = document.getElementById('phone-image-comfyui-vae');
            const clipSelect = document.getElementById('phone-image-comfyui-clip');
            const setStatus = (text, color = '#666') => {
                if (statusEl) {
                    statusEl.textContent = text;
                    statusEl.style.color = color;
                }
            };
            const oldText = btn?.textContent || '连接并刷新 ComfyUI 数据';
            try {
                await saveComfyUISettings();
                const comfyUrlValue = getActiveComfyUIUrl();
                if (getComfyUIMode() === 'remote' && !String(document.getElementById('phone-image-comfyui-remote-url')?.value || '').trim()) {
                    throw new Error('请先填写远端 ComfyUI 地址');
                }
                const imageManager = window.VirtualPhone?.imageGenerationManager;
                if (!imageManager?.fetchComfyUIResources) throw new Error('生图管理器未初始化');
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = '刷新中...';
                }
                setStatus(`正在读取 ${getComfyUIMode() === 'remote' ? '远端' : '本地'} ComfyUI /object_info...`, '#6366f1');
                const resources = await imageManager.fetchComfyUIResources(comfyUrlValue);
                const savedModel = String(this.storage.get('phone-image-comfyui-model') || '').trim();
                const savedSampler = String(this.storage.get('phone-image-comfyui-sampler') || 'euler').trim() || 'euler';
                const savedScheduler = String(this.storage.get('phone-image-comfyui-scheduler') || 'normal').trim() || 'normal';
                const savedVae = String(this.storage.get('phone-image-comfyui-vae') || '').trim();
                const savedClip = String(this.storage.get('phone-image-comfyui-clip') || '').trim();
                fillSdSelect(modelSelect, resources?.models || [], savedModel, '未选择模型');
                fillSdSelect(samplerSelect, resources?.samplers?.length ? resources.samplers : fallbackComfyUISamplers, savedSampler, null);
                fillSdSelect(schedulerSelect, resources?.schedulers?.length ? resources.schedulers : fallbackComfyUISchedulers, savedScheduler, null);
                fillSdSelect(vaeSelect, resources?.vae || [], savedVae, '不指定');
                fillSdSelect(clipSelect, resources?.clips || [], savedClip, '不指定');
                await saveComfyUISettings();
                const counts = [
                    `${Array.isArray(resources?.models) ? resources.models.length : 0} 个模型`,
                    `${Array.isArray(resources?.samplers) ? resources.samplers.length : 0} 个采样器`,
                    `${Array.isArray(resources?.vae) ? resources.vae.length : 0} 个 VAE`
                ].join('，');
                setStatus(`已刷新 ComfyUI 数据：${counts}。`, '#0f9f6e');
            } catch (err) {
                const message = err?.message || String(err || '刷新失败');
                setStatus(`刷新失败：${message}`, '#d33');
                this.phoneShell?.showNotification?.('ComfyUI 数据刷新失败', message, '⚠️');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = oldText;
                }
            }
        });

        document.getElementById('phone-image-test-comfyui')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const resultEl = document.getElementById('phone-image-test-comfyui-result');
            const setResult = (text, color = '#666') => {
                if (resultEl) {
                    resultEl.textContent = text;
                    resultEl.style.color = color;
                }
            };
            const oldText = btn?.textContent || '测试 ComfyUI 生图连接';
            try {
                await this.storage.set('phone-image-provider', 'comfyui');
                await this.storage.set('phone-image-enabled', true);
                await saveComfyUISettings();
                if (getComfyUIMode() === 'remote' && !String(document.getElementById('phone-image-comfyui-remote-url')?.value || '').trim()) {
                    throw new Error('请先填写远端 ComfyUI 地址');
                }
                const imageManager = window.VirtualPhone?.imageGenerationManager;
                if (!imageManager?.generate) throw new Error('生图管理器未初始化');
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = '测试中...';
                }
                setResult('正在提交 ComfyUI 工作流...', '#10b981');
                const result = await imageManager.generate({
                    app: 'honey',
                    provider: 'comfyui',
                    prompt: '1girl, solo, anime illustration, live streaming, looking at viewer',
                    width: 832,
                    height: 1216,
                    fixedPrompt: String(document.getElementById('phone-image-fixed-prompt')?.value || '').trim(),
                    fixedPromptEnd: String(document.getElementById('phone-image-fixed-prompt-end')?.value || '').trim(),
                    negativePrompt: String(document.getElementById('phone-image-negative-prompt')?.value || '').trim(),
                    ignoreEnabled: true
                });
                if (!result?.imageUrl && !result?.imageData) throw new Error('ComfyUI 未返回图片');
                const detail = [
                    result.width && result.height ? `${result.width}x${result.height}` : '',
                    result.steps ? `${result.steps} steps` : '',
                    result.sampler || '',
                    result.scheduler || ''
                ].filter(Boolean).join(' · ');
                setResult(`ComfyUI 连接成功，已收到图片数据${detail ? `：${detail}` : '。'}`, '#0f9f6e');
                this.phoneShell?.showNotification?.('生图测试', detail ? `ComfyUI 连接成功 ${detail}` : 'ComfyUI 连接成功', '✓');
            } catch (err) {
                const message = err?.message || String(err || '测试失败');
                setResult(`测试失败：${message}`, '#d33');
                this.phoneShell?.showNotification?.('ComfyUI 生图测试失败', message, '⚠️');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = oldText;
                }
            }
        });

        const saveSdSettings = async () => {
            const sdTextFields = [
                ['phone-image-sd-url', 'http://127.0.0.1:7860'],
                ['phone-image-sd-auth', ''],
                ['phone-image-sd-model', ''],
                ['phone-image-sd-vae', ''],
                ['phone-image-sd-sampler', 'Euler a'],
                ['phone-image-sd-scheduler', ''],
                ['phone-image-sd-upscaler', ''],
                ['phone-image-sd-lora', '']
            ];
            for (const [id, fallback] of sdTextFields) {
                const input = document.getElementById(id);
                if (!input) continue;
                const value = String(input.value || '').trim() || fallback;
                input.value = value;
                await this.storage.set(id, value);
            }
            const sdNumberFields = [
                ['phone-image-sd-clip-skip', 0, 0, 12, true],
                ['phone-image-sd-hires-steps', 0, 0, 80, true],
                ['phone-image-sd-upscale-factor', 1.5, 1, 4, false],
                ['phone-image-sd-denoising-strength', 0.45, 0, 1, false]
            ];
            for (const [id, fallback, min, max, integer] of sdNumberFields) {
                const input = document.getElementById(id);
                if (!input) continue;
                await this.storage.set(id, clampNumberInput(input, fallback, min, max, integer));
            }
            const sdToggles = [
                'phone-image-sd-hires-fix',
                'phone-image-sd-restore-faces',
                'phone-image-sd-adetailer'
            ];
            for (const id of sdToggles) {
                const input = document.getElementById(id);
                if (!input) continue;
                await this.storage.set(id, !!input.checked);
            }
        };

        [
            'phone-image-sd-url',
            'phone-image-sd-auth',
            'phone-image-sd-model',
            'phone-image-sd-vae',
            'phone-image-sd-sampler',
            'phone-image-sd-scheduler',
            'phone-image-sd-upscaler',
            'phone-image-sd-lora'
        ].forEach((id) => {
            const input = document.getElementById(id);
            if (!input) return;
            input.addEventListener('change', saveSdSettings);
            input.addEventListener('blur', saveSdSettings);
        });

        [
            'phone-image-sd-hires-fix',
            'phone-image-sd-restore-faces',
            'phone-image-sd-adetailer'
        ].forEach((id) => {
            document.getElementById(id)?.addEventListener('change', saveSdSettings);
        });

        document.getElementById('phone-image-sd-add-lora')?.addEventListener('click', async () => {
            const select = document.getElementById('phone-image-sd-lora-select');
            const textarea = document.getElementById('phone-image-sd-lora');
            const name = String(select?.value || '').trim();
            if (!name || !textarea) return;
            const current = String(textarea.value || '').trim();
            const nextLine = `<lora:${name}:1>`;
            if (!current.includes(nextLine)) {
                textarea.value = current ? `${current}\n${nextLine}` : nextLine;
            }
            await saveSdSettings();
        });

        document.getElementById('phone-image-sd-refresh-models')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const statusEl = document.getElementById('phone-image-sd-models-status');
            const modelSelect = document.getElementById('phone-image-sd-model');
            const samplerSelect = document.getElementById('phone-image-sd-sampler');
            const schedulerSelect = document.getElementById('phone-image-sd-scheduler');
            const vaeSelect = document.getElementById('phone-image-sd-vae');
            const upscalerSelect = document.getElementById('phone-image-sd-upscaler');
            const loraSelect = document.getElementById('phone-image-sd-lora-select');
            const setStatus = (text, color = '#666') => {
                if (statusEl) {
                    statusEl.textContent = text;
                    statusEl.style.color = color;
                }
            };
            const oldText = btn?.textContent || '连接并刷新 SD 数据';
            try {
                await saveSdSettings();
                const sdUrlValue = String(document.getElementById('phone-image-sd-url')?.value || '').trim() || 'http://127.0.0.1:7860';
                await this.storage.set('phone-image-sd-url', sdUrlValue);
                const imageManager = window.VirtualPhone?.imageGenerationManager;
                if (!imageManager?.fetchSdModels) throw new Error('生图管理器未初始化');
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = '刷新中...';
                }
                setStatus('正在读取 SD WebUI 数据...', '#3b82f6');
                const resources = imageManager.fetchSdResources
                    ? await imageManager.fetchSdResources(sdUrlValue)
                    : { models: await imageManager.fetchSdModels(sdUrlValue) };
                const models = Array.isArray(resources?.models) ? resources.models : [];
                const savedModel = String(this.storage.get('phone-image-sd-model') || '').trim();
                const savedSampler = String(this.storage.get('phone-image-sd-sampler') || 'Euler a').trim() || 'Euler a';
                const savedScheduler = String(this.storage.get('phone-image-sd-scheduler') || '').trim();
                const savedVae = String(this.storage.get('phone-image-sd-vae') || '').trim();
                const savedUpscaler = String(this.storage.get('phone-image-sd-upscaler') || '').trim();
                fillSdSelect(modelSelect, models, savedModel, '不指定模型', model => model?.title || model?.model_name || model?.name || model?.text || model?.value);
                fillSdSelect(samplerSelect, resources?.samplers?.length ? resources.samplers : fallbackSdSamplers, savedSampler, null);
                fillSdSelect(schedulerSelect, resources?.schedulers || [], savedScheduler, '自动');
                fillSdSelect(vaeSelect, resources?.vae || [], savedVae, '自动');
                fillSdSelect(upscalerSelect, resources?.upscalers || [], savedUpscaler, '自动');
                fillSdSelect(loraSelect, resources?.loras || [], '', '选择 LoRA');
                await saveSdSettings();
                const counts = [
                    `${models.length} 个模型`,
                    `${Array.isArray(resources?.samplers) ? resources.samplers.length : 0} 个采样器`,
                    `${Array.isArray(resources?.loras) ? resources.loras.length : 0} 个 LoRA`
                ].join('，');
                let corsHint = '';
                try {
                    const sdOrigin = new URL(sdUrlValue).origin;
                    if (
                        typeof window !== 'undefined' &&
                        window.location?.origin &&
                        sdOrigin !== window.location.origin &&
                        Array.isArray(resources?.loras) &&
                        resources.loras.length === 0
                    ) {
                        corsHint = ' 如控制台提示 CORS，请给 SD WebUI 启动参数加入 --cors-allow-origins=http://127.0.0.1:8000。';
                    }
                } catch (err) {
                    corsHint = '';
                }
                setStatus(`已刷新 SD 数据：${counts}。${corsHint}`, '#0f9f6e');
            } catch (err) {
                const message = err?.message || String(err || '刷新失败');
                setStatus(`刷新失败：${message}`, '#d33');
                this.phoneShell?.showNotification?.('SD 数据刷新失败', message, '⚠️');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = oldText;
                }
            }
        });

        document.getElementById('phone-image-test-sd')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const resultEl = document.getElementById('phone-image-test-sd-result');
            const setResult = (text, color = '#666') => {
                if (resultEl) {
                    resultEl.textContent = text;
                    resultEl.style.color = color;
                }
            };
            const oldText = btn?.textContent || '测试 SD 生图连接';
            try {
                await this.storage.set('phone-image-provider', 'sd');
                await this.storage.set('phone-image-enabled', true);
                await saveSdSettings();
                const imageManager = window.VirtualPhone?.imageGenerationManager;
                if (!imageManager?.generate) throw new Error('生图管理器未初始化');
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = '测试中...';
                }
                setResult('正在请求 Stable Diffusion...', '#10b981');
                const result = await imageManager.generate({
                    app: 'honey',
                    provider: 'sd',
                    prompt: '1girl, solo, anime illustration, live streaming, looking at viewer',
                    width: 832,
                    height: 1216,
                    ignoreEnabled: true
                });
                if (!result?.imageUrl && !result?.imageData) throw new Error('SD 未返回图片');
                const detail = [
                    result.width && result.height ? `${result.width}x${result.height}` : '',
                    result.steps ? `${result.steps} steps` : '',
                    result.sampler || ''
                ].filter(Boolean).join(' · ');
                setResult(`SD 连接成功，已收到图片数据${detail ? `，${detail}` : '。'}`, '#0f9f6e');
                this.phoneShell?.showNotification?.('生图测试', detail ? `SD 连接成功 ${detail}` : 'SD 连接成功', '✓');
            } catch (err) {
                const message = err?.message || String(err || '测试失败');
                setResult(`测试失败：${message}`, '#d33');
                this.phoneShell?.showNotification?.('SD 生图测试失败', message, '⚠️');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = oldText;
                }
            }
        });

        const imageNumberInputs = [
            ['phone-image-honey-width', 832, 64, 2048, true],
            ['phone-image-honey-height', 1216, 64, 2048, true],
            ['phone-image-wechat-width', 512, 64, 2048, true],
            ['phone-image-wechat-height', 512, 64, 2048, true],
            ['phone-image-weibo-width', 1024, 64, 2048, true],
            ['phone-image-weibo-height', 1024, 64, 2048, true],
            ['phone-image-diary-width', 512, 64, 2048, true],
            ['phone-image-diary-height', 512, 64, 2048, true],
            ['phone-image-width', 832, 64, 2048, true],
            ['phone-image-height', 1216, 64, 2048, true],
            ['phone-image-steps', 28, 1, 50, true],
            ['phone-image-scale', 6, 0, 50, false],
            ['phone-image-cfg-rescale', 0.2, 0, 1, false],
            ['phone-image-seed', -1, -1, 4294967295, true],
            ['phone-image-sd-clip-skip', 0, 0, 12, true],
            ['phone-image-sd-hires-steps', 0, 0, 80, true],
            ['phone-image-sd-upscale-factor', 1.5, 1, 4, false],
            ['phone-image-sd-denoising-strength', 0.45, 0, 1, false]
        ];
        const appSizeInputIds = new Set([
            'phone-image-honey-width',
            'phone-image-honey-height',
            'phone-image-wechat-width',
            'phone-image-wechat-height',
            'phone-image-weibo-width',
            'phone-image-weibo-height',
            'phone-image-diary-width',
            'phone-image-diary-height',
            'phone-image-width',
            'phone-image-height'
        ]);
        imageNumberInputs.forEach(([id, fallback, min, max, integer]) => {
            const inputs = Array.from(document.querySelectorAll(`#${id}, [data-phone-image-number-key="${id}"]`));
            if (!inputs.length) return;
            const syncLinkedInputs = (source, value) => {
                inputs.forEach(input => {
                    if (input !== source) input.value = String(value);
                });
            };
            const saveNumberInput = async (e) => {
                const value = clampNumberInput(e.target, fallback, min, max, integer);
                syncLinkedInputs(e.target, value);
                await this.storage.set(id, value);
            };
            inputs.forEach(input => {
                if (integer && id !== 'phone-image-seed' && !appSizeInputIds.has(id)) {
                    input.addEventListener('input', saveNumberInput);
                }
                input.addEventListener('change', saveNumberInput);
                input.addEventListener('blur', saveNumberInput);
                input.addEventListener('keydown', (e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    saveNumberInput(e).catch(err => console.warn('保存生图数字设置失败:', err));
                    e.currentTarget?.blur?.();
                });
            });
        });

        document.getElementById('phone-image-reset-app-sizes')?.addEventListener('click', async () => {
            await restoreDefaultImageAppSizes();
            this.phoneShell?.showNotification?.('生图尺寸', '已恢复默认尺寸', '✅');
        });

        [
            'phone-image-fixed-prompt',
            'phone-image-fixed-prompt-end',
            'phone-image-negative-prompt'
        ].forEach(id => {
            const input = document.getElementById(id);
            if (!input) return;
            const saveTextInput = async () => {
                await saveImagePromptDraft(getActiveImagePromptApp());
            };
            input.addEventListener('input', saveTextInput);
            input.addEventListener('change', saveTextInput);
            input.addEventListener('blur', saveTextInput);
        });

        // 🔊 TTS 设置事件绑定
        const ttsProvider = document.getElementById('phone-tts-provider');
        const ttsUrl = document.getElementById('phone-tts-url');
        const ttsUrlPreset = document.getElementById('phone-tts-url-preset');
        const ttsKey = document.getElementById('phone-tts-key');
        const ttsVolcKey = document.getElementById('phone-tts-volc-key');
        const ttsVolcAppId = document.getElementById('phone-tts-volc-app-id');
        const ttsVolcResourceId = document.getElementById('phone-tts-volc-resource-id');
        const ttsModel = document.getElementById('phone-tts-model');
        const ttsModelPreset = document.getElementById('phone-tts-model-preset');
        const ttsFetchModelsBtn = document.getElementById('phone-tts-fetch-models');
        const ttsModelsResult = document.getElementById('phone-tts-models-result');
        const ttsNimoRelayUrl = document.getElementById('phone-tts-nimo-relay-url');
        const ttsVoice = document.getElementById('phone-tts-voice');
        const ttsVoicePreset = document.getElementById('phone-tts-voice-preset');
        const ttsVolcVoice = document.getElementById('phone-tts-volc-voice');
        const ttsPreviewBtn = document.getElementById('phone-tts-preview');
        const ttsVolcPreviewBtn = document.getElementById('phone-tts-volc-preview');
        const ttsVolcCloneWorkerUrl = document.getElementById('phone-tts-volc-clone-worker-url');
        const ttsVolcCloneAccessToken = document.getElementById('phone-tts-volc-clone-access-token');
        const ttsVolcCloneAppId = document.getElementById('phone-tts-volc-clone-app-id');
        const ttsVolcCloneSpeakerId = document.getElementById('phone-tts-volc-clone-speaker-id');
        const ttsVolcCloneModelType = document.getElementById('phone-tts-volc-clone-model-type');
        const ttsVolcCloneLanguage = document.getElementById('phone-tts-volc-clone-language');
        const ttsVolcCloneAudio = document.getElementById('phone-tts-volc-clone-audio');
        const ttsVolcCloneAudioPickBtn = document.getElementById('phone-tts-volc-clone-audio-pick');
        const ttsVolcCloneAudioName = document.getElementById('phone-tts-volc-clone-audio-name');
        const ttsVolcCloneUploadBtn = document.getElementById('phone-tts-volc-clone-upload');
        const ttsVolcCloneStatusBtn = document.getElementById('phone-tts-volc-clone-status');
        const ttsVolcCloneUseBtn = document.getElementById('phone-tts-volc-clone-use');
        const ttsVolcCloneResult = document.getElementById('phone-tts-volc-clone-result');
        const ttsNimoCloneNick = document.getElementById('phone-tts-nimo-clone-nick');
        const ttsNimoCloneAudio = document.getElementById('phone-tts-nimo-clone-audio');
        const ttsNimoCloneAudioPickBtn = document.getElementById('phone-tts-nimo-clone-audio-pick');
        const ttsNimoCloneAudioName = document.getElementById('phone-tts-nimo-clone-audio-name');
        const ttsNimoCloneSaveBtn = document.getElementById('phone-tts-nimo-clone-save');
        const ttsNimoCloneResult = document.getElementById('phone-tts-nimo-clone-result');
        const ttsFallbackMaleProvider = document.getElementById('phone-tts-fallback-male-provider');
        const ttsFallbackMaleVoice = document.getElementById('phone-tts-fallback-male-voice');
        const ttsFallbackMalePreviewBtn = document.getElementById('phone-tts-fallback-male-preview');
        const ttsFallbackFemaleProvider = document.getElementById('phone-tts-fallback-female-provider');
        const ttsFallbackFemaleVoice = document.getElementById('phone-tts-fallback-female-voice');
        const ttsFallbackFemalePreviewBtn = document.getElementById('phone-tts-fallback-female-preview');
        const wechatCallAutoTtsToggle = document.getElementById('wechat-call-auto-tts');
        const honeyTtsEnabledToggle = document.getElementById('phone-honey-tts-enabled');
        const honeyTtsModeSelect = document.getElementById('phone-honey-tts-mode');
        const honeyTtsCacheEnabledToggle = document.getElementById('phone-honey-tts-cache-enabled');
        const getSelectedTtsProvider = () => String(ttsProvider?.value || this._getCurrentTtsProvider()).trim() || 'minimax_cn';
        const getSelectedMainTtsProvider = () => String(ttsProvider?.value || this._getCurrentMainTtsProvider()).trim() || 'minimax_cn';
        const readTtsVoiceHistory = () => {
            try {
                const parsed = JSON.parse(this.storage.get('phone-tts-voice-history') || '[]');
                return Array.isArray(parsed) ? parsed.map(v => String(v || '').trim()).filter(Boolean) : [];
            } catch (_e) {
                return [];
            }
        };
        const ttsModelPresetOptions = {
            minimax_cn: [
                { value: 'speech-2.8-hd', label: 'speech-2.8-hd' },
                { value: 'speech-2.6-hd', label: 'speech-2.6-hd' },
                { value: 'speech-2.8-turbo', label: 'speech-2.8-turbo' },
                { value: 'speech-2.6-turbo', label: 'speech-2.6-turbo' },
                { value: 'speech-02-hd', label: 'speech-02-hd' },
                { value: 'speech-02-turbo', label: 'speech-02-turbo' }
            ],
            minimax_intl: [
                { value: 'speech-2.8-hd', label: 'speech-2.8-hd' },
                { value: 'speech-2.6-hd', label: 'speech-2.6-hd' },
                { value: 'speech-2.8-turbo', label: 'speech-2.8-turbo' },
                { value: 'speech-2.6-turbo', label: 'speech-2.6-turbo' },
                { value: 'speech-02-hd', label: 'speech-02-hd' },
                { value: 'speech-02-turbo', label: 'speech-02-turbo' }
            ],
            openai: [
                { value: 'tts-1', label: 'tts-1' },
                { value: 'tts-1-hd', label: 'tts-1-hd' },
                { value: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts' }
            ],
            indextts: [
                { value: 'index-tts2', label: 'index-tts2' }
            ],
            nimo: [
                { value: 'mimo-v2.5-tts', label: 'mimo-v2.5-tts（预置音色）' },
                { value: 'mimo-v2.5-tts-voiceclone', label: 'mimo-v2.5-tts-voiceclone（音频复刻）' },
                { value: 'mimo-v2.5-tts-voicedesign', label: 'mimo-v2.5-tts-voicedesign（文字描述）' }
            ]
        };
        const ttsVoicePresetOptions = {
            openai: [
                { value: 'alloy', label: 'alloy' },
                { value: 'ash', label: 'ash' },
                { value: 'ballad', label: 'ballad' },
                { value: 'coral', label: 'coral' },
                { value: 'echo', label: 'echo' },
                { value: 'fable', label: 'fable' },
                { value: 'nova', label: 'nova' },
                { value: 'onyx', label: 'onyx' },
                { value: 'sage', label: 'sage' },
                { value: 'shimmer', label: 'shimmer' }
            ],
            indextts: [
                { value: 'default.wav', label: 'default.wav（默认）' }
            ],
            nimo: [
                { value: 'mimo_default', label: 'mimo_default（默认）' },
                { value: '冰糖', label: '冰糖' },
                { value: '茉莉', label: '茉莉' },
                { value: '苏打', label: '苏打' },
                { value: '白桦', label: '白桦' },
                { value: 'Mia', label: 'Mia' },
                { value: 'Chloe', label: 'Chloe' },
                { value: 'Milo', label: 'Milo' },
                { value: 'Dean', label: 'Dean' }
            ],
            minimax_cn: [],
            minimax_intl: []
        };
        const inferTtsProviderFromUrl = (urlValue, fallback = '') => {
            const url = String(urlValue || '').trim().toLowerCase();
            if (url.includes('minimaxi.com')) return 'minimax_cn';
            if (url.includes('minimax.chat') || url.includes('minimax.io')) return 'minimax_intl';
            if (url.includes('127.0.0.1:7880') || url.includes('localhost:7880') || url.includes('index-tts')) return 'indextts';
            if (url.includes('xiaomimimo.com') || /\/(?:v1\/)?chat\/completions\b/.test(url)) return 'nimo';
            if (url.includes('openspeech.bytedance.com')) return 'volcengine';
            if (url.includes('api.openai.com') || /\/audio\/speech\b/.test(url)) return 'openai';
            return String(fallback || '').trim() || 'minimax_cn';
        };
        const normalizeTtsProviderUrl = (provider, urlValue) => {
            const rawUrl = String(urlValue || '').trim();
            if (provider === 'minimax_intl' && /api\.minimax\.chat/i.test(rawUrl)) {
                return this._getTtsProviderDefaults('minimax_intl').url;
            }
            return rawUrl;
        };
        const getCurrentMainProviderFromForm = () => getSelectedMainTtsProvider();
        const refreshTtsPresetOptions = () => {
            const provider = getCurrentMainProviderFromForm();
            if (ttsModelPreset) {
                const models = ttsModelPresetOptions[provider] || [];
                ttsModelPreset.innerHTML = '<option value="">-- 快速选择 --</option>' + models
                    .map(item => `<option value="${this._escapeHtml(item.value)}">${this._escapeHtml(item.label)}</option>`)
                    .join('');
            }
            if (ttsVoicePreset) {
                const voices = ttsVoicePresetOptions[provider] || [];
                const presetVoiceSet = new Set(voices.map(item => String(item.value || '').trim()).filter(Boolean));
                const uniqueHistory = [...new Set(readTtsVoiceHistory())].filter(v => !presetVoiceSet.has(v));
                ttsVoicePreset.innerHTML = '<option value="">-- 快速选择 --</option>'
                    + voices.map(item => `<option value="${this._escapeHtml(item.value)}">${this._escapeHtml(item.label)}</option>`).join('')
                    + (uniqueHistory.length ? '<option value="" disabled>-- 历史音色 --</option>' : '')
                    + uniqueHistory.map(v => `<option value="${this._escapeHtml(v)}">${this._escapeHtml(v)}</option>`).join('');
            }
        };
        const setTtsProviderField = async (field, value, legacyKey = '') => {
            const provider = getSelectedTtsProvider();
            const safeValue = String(value || '').trim();
            await this.storage.set(this._getTtsProviderConfigKey(provider, field), safeValue);
            if (legacyKey && provider === this._getCurrentTtsProvider()) {
                await this.storage.set(legacyKey, safeValue);
            }
        };
        const setMainTtsProviderField = async (field, value, legacyKey = '') => {
            const provider = getCurrentMainProviderFromForm();
            const safeValue = String(value || '').trim();
            await this.storage.set(this._getTtsProviderConfigKey(provider, field), safeValue);
            if (['minimax_cn', 'minimax_intl', 'openai', 'indextts', 'nimo'].includes(provider)) {
                await this.storage.set('phone-tts-main-provider', provider);
                await this.storage.set('phone-tts-provider', provider);
            }
            if (legacyKey && provider === this._getCurrentTtsProvider()) {
                await this.storage.set(legacyKey, safeValue);
            }
        };
        const setVolcTtsField = async (field, value, legacyKey = '') => {
            const safeValue = String(value || '').trim();
            await this.storage.set(this._getTtsProviderConfigKey('volcengine', field), safeValue);
            if (legacyKey && this._getCurrentTtsProvider() === 'volcengine') {
                await this.storage.set(legacyKey, safeValue);
            }
        };
        const setNimoTtsField = async (field, value, legacyKey = '') => {
            const safeValue = String(value || '').trim();
            await this.storage.set(this._getTtsProviderConfigKey('nimo', field), safeValue);
            if (legacyKey && getCurrentMainProviderFromForm() === 'nimo') {
                await this.storage.set(legacyKey, safeValue);
            }
        };
        const addTtsVoiceHistory = async (voiceValue, {
            historyKey = 'phone-tts-voice-history',
            presetSelector = '#phone-tts-voice-preset'
        } = {}) => {
            const val = String(voiceValue || '').trim();
            if (!val) return;

            let history = [];
            try { history = JSON.parse(this.storage.get(historyKey) || '[]'); } catch(e) {}
            if (!history.includes(val)) {
                history.push(val);
                await this.storage.set(historyKey, JSON.stringify(history));
                document.querySelectorAll(presetSelector).forEach((preset) => {
                    if (preset.querySelector(`option[value="${CSS.escape(val)}"]`)) return;
                    const opt = document.createElement('option');
                    opt.value = val;
                    opt.textContent = val;
                    preset.appendChild(opt);
                });
            }
        };
        const saveTtsVoice = async (voiceValue) => {
            const val = String(voiceValue || '').trim();
            if (ttsVoice) ttsVoice.value = val;
            await setMainTtsProviderField('voice', val);
            await addTtsVoiceHistory(val, {
                historyKey: 'phone-tts-voice-history',
                presetSelector: '#phone-tts-voice-preset'
            });
        };
        const saveVolcTtsVoice = async (voiceValue) => {
            const val = String(voiceValue || '').trim();
            if (ttsVolcVoice) ttsVolcVoice.value = val;
            await setVolcTtsField('voice', val);
            await addTtsVoiceHistory(val, {
                historyKey: 'phone-tts-volc-voice-history',
                presetSelector: '#phone-tts-volc-voice-preset'
            });
        };
        const setCloneResult = (message, isError = false) => {
            if (!ttsVolcCloneResult) return;
            ttsVolcCloneResult.textContent = message || '';
            ttsVolcCloneResult.style.color = isError ? '#ff3b30' : '#666';
        };
        const setNimoCloneResult = (message, isError = false) => {
            if (!ttsNimoCloneResult) return;
            ttsNimoCloneResult.textContent = message || '';
            ttsNimoCloneResult.style.color = isError ? '#ff3b30' : '#666';
        };
        const setTtsModelsResult = (message, isError = false) => {
            if (!ttsModelsResult) return;
            ttsModelsResult.textContent = message || '';
            ttsModelsResult.style.color = isError ? '#ff3b30' : '#666';
        };
        const getCloneForm = () => ({
            apiKey: String(ttsVolcCloneAccessToken?.value || ttsVolcKey?.value || ttsKey?.value || '').trim(),
            appId: String(ttsVolcCloneAppId?.value || ttsVolcAppId?.value || '').trim(),
            speakerId: String(ttsVolcCloneSpeakerId?.value || '').trim(),
            workerUrl: String(ttsVolcCloneWorkerUrl?.value || '').trim(),
            resourceId: String(ttsVolcResourceId?.value || 'seed-icl-2.0').trim() || 'seed-icl-2.0',
            modelType: String(ttsVolcCloneModelType?.value || '4'),
            language: String(ttsVolcCloneLanguage?.value || '0'),
            audioFile: ttsVolcCloneAudio?.files?.[0] || null
        });
        const withBusyButton = async (button, busyText, task) => {
            if (!button) return;
            const originalText = button.textContent;
            button.disabled = true;
            button.textContent = busyText;
            try {
                await task();
            } finally {
                button.disabled = false;
                button.textContent = originalText;
            }
        };
        const withTimeoutSignal = async (timeoutMs, task) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                return await task(controller.signal);
            } finally {
                clearTimeout(timer);
            }
        };
        const waitForAudioPlaybackStart = (audio) => new Promise((resolve, reject) => {
            let settled = false;
            const cleanup = () => {
                audio.removeEventListener('playing', handlePlaying);
                audio.removeEventListener('canplay', handleCanPlay);
                audio.removeEventListener('error', handleError);
            };
            const settle = (fn, value) => {
                if (settled) return;
                settled = true;
                cleanup();
                fn(value);
            };
            const handlePlaying = () => settle(resolve);
            const handleCanPlay = () => settle(resolve);
            const handleError = () => settle(reject, new Error('音频解码或播放失败'));
            audio.addEventListener('playing', handlePlaying, { once: true });
            audio.addEventListener('canplay', handleCanPlay, { once: true });
            audio.addEventListener('error', handleError, { once: true });
            const playPromise = audio.play();
            if (playPromise?.then) {
                playPromise.then(() => settle(resolve)).catch(error => settle(reject, error));
            }
        });
        let ttsPreviewAudio = null;
        const playTtsPreview = async (provider, voice, button) => {
            const ttsManager = window.VirtualPhone?.ttsManager;
            if (!ttsManager?.requestTTS) {
                this.phoneShell.showNotification('试听失败', 'TTS 管理器未初始化', '⚠️');
                return;
            }
            await withBusyButton(button, '试听中...', async () => {
                let blobUrl = '';
                try {
                    const previewText = '这是一段小手机语音试听。';
                    const currentModel = String(ttsModel?.value || '').trim();
                    const isNimoVoiceClone = provider === 'nimo' && currentModel === 'mimo-v2.5-tts-voiceclone';
                    const requestTimeoutMs = isNimoVoiceClone ? 120000 : 30000;
                    const playbackTimeoutMs = isNimoVoiceClone ? 20000 : 10000;
                    blobUrl = await withTimeoutSignal(requestTimeoutMs, (signal) => ttsManager.requestTTS(previewText, { provider, voice, signal }));
                    if (ttsPreviewAudio) {
                        ttsPreviewAudio.pause();
                        if (ttsPreviewAudio.src?.startsWith('blob:')) URL.revokeObjectURL(ttsPreviewAudio.src);
                        ttsPreviewAudio.src = '';
                    }
                    ttsPreviewAudio = new Audio(blobUrl);
                    ttsPreviewAudio.onended = () => {
                        URL.revokeObjectURL(blobUrl);
                        blobUrl = '';
                    };
                    ttsPreviewAudio.onerror = () => {
                        if (blobUrl) URL.revokeObjectURL(blobUrl);
                        blobUrl = '';
                    };
                    await Promise.race([
                        waitForAudioPlaybackStart(ttsPreviewAudio),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('试听播放超时')), playbackTimeoutMs))
                    ]);
                } catch (error) {
                    if (blobUrl) URL.revokeObjectURL(blobUrl);
                    this.phoneShell.showNotification('试听失败', error?.message || '无法播放试听音频', '⚠️');
                }
            });
        };
        const saveTtsGenderFallback = async (gender, providerEl, voiceEl) => {
            const safeGender = String(gender || '').trim() === 'male' ? 'male' : 'female';
            const provider = String(providerEl?.value || this._getCurrentTtsProvider()).trim() || 'minimax_cn';
            const voice = String(voiceEl?.value || '').trim();
            await this.storage.set(`phone-tts-fallback-${safeGender}-provider`, provider);
            await this.storage.set(`phone-tts-fallback-${safeGender}-voice`, voice);
        };
        refreshTtsPresetOptions();

        if (ttsProvider) ttsProvider.addEventListener('change', async (e) => {
            const val = e.target.value;
            await this.storage.set('phone-tts-provider', val);
            // 联动填充默认 URL 和模型
            const d = this._getTtsProviderDefaults(val);
            const nextUrl = normalizeTtsProviderUrl(val, this._getTtsProviderValue(val, 'url') || d.url || '');
            const nextKey = this._getTtsProviderValue(val, 'key') || '';
            const nextModel = this._getTtsProviderValue(val, 'model') || d.model || '';
            const nextVoice = this._getTtsProviderValue(val, 'voice') || d.voice || '';
            const nextAppId = this._getTtsProviderValue(val, 'app-id') || '';
            const nextResourceId = this._getTtsProviderValue(val, 'resource-id') || d.resourceId || 'seed-tts-2.0';
            if (ttsUrl) { ttsUrl.value = nextUrl; await this.storage.set('phone-tts-url', nextUrl); }
            if (ttsKey) { ttsKey.value = nextKey; await this.storage.set('phone-tts-key', nextKey); }
            if (ttsModel) { ttsModel.value = nextModel; await this.storage.set('phone-tts-model', nextModel); }
            if (ttsVoice) { ttsVoice.value = nextVoice; }
            if (['minimax_cn', 'minimax_intl', 'openai', 'indextts', 'nimo'].includes(val)) {
                await this.storage.set('phone-tts-main-provider', val);
            }
            refreshTtsPresetOptions();
            if (val === 'volcengine') {
                if (ttsVolcKey) ttsVolcKey.value = nextKey;
                if (ttsVolcVoice) ttsVolcVoice.value = nextVoice;
                if (ttsVolcAppId) { ttsVolcAppId.value = nextAppId; await this.storage.set('phone-tts-volc-app-id', nextAppId); }
                if (ttsVolcResourceId) { ttsVolcResourceId.value = nextResourceId; await this.storage.set('phone-tts-volc-resource-id', nextResourceId); }
            }
        });

        document.querySelectorAll('[data-tts-fold-key]').forEach((foldEl) => {
            foldEl.addEventListener('toggle', async () => {
                const key = foldEl.dataset.ttsFoldKey;
                if (!key) return;
                await this.storage.set(key, !!foldEl.open);
            });
        });

        // 接口地址预设下拉 → 填入输入框
        if (ttsUrlPreset) ttsUrlPreset.addEventListener('change', async (e) => {
            const rawVal = e.target.value;
            if (rawVal === '__nimo_public__') {
                await this.storage.set('phone-tts-main-provider', 'nimo');
                await this.storage.set('phone-tts-provider', 'nimo');
                if (ttsProvider) ttsProvider.value = 'nimo';
                const defaults = this._getTtsProviderDefaults('nimo');
                const storedUrl = this._getTtsProviderValue('nimo', 'url') || '';
                const nextUrl = /xiaomimimo\.com/i.test(storedUrl) ? '' : storedUrl;
                const nextModel = this._getTtsProviderValue('nimo', 'model') || defaults.model || '';
                const nextVoice = this._getTtsProviderValue('nimo', 'voice') || defaults.voice || '';
                if (ttsUrl) { ttsUrl.value = nextUrl; await setMainTtsProviderField('url', nextUrl, 'phone-tts-url'); }
                if (ttsModel) { ttsModel.value = nextModel; await setMainTtsProviderField('model', nextModel, 'phone-tts-model'); }
                if (ttsVoice) { ttsVoice.value = nextVoice; await setMainTtsProviderField('voice', nextVoice, 'phone-tts-voice'); }
                refreshTtsPresetOptions();
                e.target.value = '';
                return;
            }
            const inferredProvider = inferTtsProviderFromUrl(rawVal, getSelectedMainTtsProvider());
            const val = normalizeTtsProviderUrl(inferredProvider, rawVal);
            if (!val) return;
            await this.storage.set('phone-tts-main-provider', inferredProvider);
            await this.storage.set('phone-tts-provider', inferredProvider);
            if (ttsProvider) ttsProvider.value = inferredProvider;
            const defaults = this._getTtsProviderDefaults(inferredProvider);
            const nextModel = this._getTtsProviderValue(inferredProvider, 'model') || defaults.model || '';
            const nextVoice = this._getTtsProviderValue(inferredProvider, 'voice') || defaults.voice || '';
            if (ttsUrl) { ttsUrl.value = val; await setMainTtsProviderField('url', val, 'phone-tts-url'); }
            if (ttsModel) { ttsModel.value = nextModel; await setMainTtsProviderField('model', nextModel, 'phone-tts-model'); }
            if (ttsVoice) { ttsVoice.value = nextVoice; await setMainTtsProviderField('voice', nextVoice, 'phone-tts-voice'); }
            refreshTtsPresetOptions();
            e.target.value = ''; // 重置下拉为占位项
        });

        // 模型预设下拉 → 填入输入框
        if (ttsModelPreset) ttsModelPreset.addEventListener('change', async (e) => {
            const val = e.target.value;
            if (!val) return;
            if (ttsModel) { ttsModel.value = val; await setMainTtsProviderField('model', val, 'phone-tts-model'); }
            e.target.value = ''; // 重置下拉为占位项
        });
        if (ttsFetchModelsBtn) ttsFetchModelsBtn.addEventListener('click', async () => {
            const provider = getCurrentMainProviderFromForm();
            if (provider !== 'nimo' && provider !== 'indextts') {
                setTtsModelsResult('当前仅支持拉取 MiMo / IndexTTS 本地模型与音色。', true);
                return;
            }
            const ttsManager = window.VirtualPhone?.ttsManager;
            if (!ttsManager) {
                setTtsModelsResult('TTS 管理器未初始化，无法拉取。', true);
                return;
            }
            await withBusyButton(ttsFetchModelsBtn, '拉取中...', async () => {
                try {
                    await setMainTtsProviderField('url', String(ttsUrl?.value || '').trim(), 'phone-tts-url');
                    await setMainTtsProviderField('key', String(ttsKey?.value || '').trim(), 'phone-tts-key');
                    if (provider === 'nimo') await setNimoTtsField('relay-url', String(ttsNimoRelayUrl?.value || '').trim());
                    setTtsModelsResult('正在请求 /v1/models...', false);

                    if (provider === 'indextts') {
                        if (!ttsManager.fetchIndexTtsVoices) throw new Error('当前版本 TTS 管理器不支持 IndexTTS 音色拉取');
                        const result = await ttsManager.fetchIndexTtsVoices(
                            String(ttsUrl?.value || '').trim(),
                            String(ttsKey?.value || '').trim()
                        );
                        const models = Array.isArray(result?.models) ? result.models : [];
                        const voices = Array.isArray(result?.voices) ? result.voices : [];
                        if (ttsModelPreset) {
                            ttsModelPreset.innerHTML = '<option value="">-- 快速选择 --</option>' + models
                                .map(id => `<option value="${this._escapeHtml(id)}">${this._escapeHtml(id)}</option>`)
                                .join('');
                        }
                        if (ttsVoicePreset) {
                            ttsVoicePreset.innerHTML = '<option value="">-- 快速选择 --</option>'
                                + voices.map(id => `<option value="${this._escapeHtml(id)}">${this._escapeHtml(id)}</option>`).join('');
                        }
                        const nextModel = models.includes(String(ttsModel?.value || '').trim())
                            ? String(ttsModel?.value || '').trim()
                            : (models[0] || 'index-tts2');
                        const nextVoice = voices.includes(String(ttsVoice?.value || '').trim())
                            ? String(ttsVoice?.value || '').trim()
                            : (voices[0] || '');
                        if (nextModel && ttsModel) {
                            ttsModel.value = nextModel;
                            await setMainTtsProviderField('model', nextModel, 'phone-tts-model');
                        }
                        if (nextVoice && ttsVoice) {
                            ttsVoice.value = nextVoice;
                            await saveTtsVoice(nextVoice);
                        }
                        setTtsModelsResult(`已拉取 ${models.length} 个模型、${voices.length} 个本地音色。`, false);
                        return;
                    }

                    if (!ttsManager.fetchNimoModels) throw new Error('当前版本 TTS 管理器不支持 MiMo 模型拉取');
                    const models = await ttsManager.fetchNimoModels(
                        String(ttsUrl?.value || '').trim(),
                        String(ttsKey?.value || '').trim(),
                        { relayUrl: String(ttsNimoRelayUrl?.value || '').trim() }
                    );
                    const preferred = models.filter(id => /mimo|tts|voice/i.test(id));
                    const displayModels = preferred.length ? preferred : models;
                    if (ttsModelPreset) {
                        ttsModelPreset.innerHTML = '<option value="">-- 快速选择 --</option>' + displayModels
                            .map(id => `<option value="${this._escapeHtml(id)}">${this._escapeHtml(id)}</option>`)
                            .join('');
                    }
                    const currentModel = String(ttsModel?.value || '').trim();
                    const nextModel = displayModels.includes(currentModel) ? currentModel : (displayModels[0] || '');
                    if (nextModel && ttsModel) {
                        ttsModel.value = nextModel;
                        await setMainTtsProviderField('model', nextModel, 'phone-tts-model');
                    }
                    setTtsModelsResult(`已拉取 ${models.length} 个模型${preferred.length ? `，显示 ${preferred.length} 个 MiMo/TTS 相关模型` : ''}。`, false);
                } catch (error) {
                    const message = error?.message || '拉取 MiMo 模型失败';
                    setTtsModelsResult(message, true);
                    this.phoneShell?.showNotification?.('MiMo 模型拉取失败', message, '⚠️');
                }
            });
        });

        if (ttsUrl) ttsUrl.addEventListener('change', async (e) => {
            const rawNextUrl = String(e.target.value || '').trim();
            const inferredProvider = getCurrentMainProviderFromForm();
            const nextUrl = normalizeTtsProviderUrl(inferredProvider, rawNextUrl);
            if (ttsUrl) ttsUrl.value = nextUrl;
            const defaults = this._getTtsProviderDefaults(inferredProvider);
            const nextModel = this._getTtsProviderValue(inferredProvider, 'model') || defaults.model || '';
            const nextVoice = this._getTtsProviderValue(inferredProvider, 'voice') || defaults.voice || '';
            await setMainTtsProviderField('url', nextUrl, 'phone-tts-url');
            if (ttsModel) { ttsModel.value = nextModel; await setMainTtsProviderField('model', nextModel, 'phone-tts-model'); }
            if (ttsVoice) { ttsVoice.value = nextVoice; await setMainTtsProviderField('voice', nextVoice, 'phone-tts-voice'); }
            refreshTtsPresetOptions();
        });
        if (ttsKey) ttsKey.addEventListener('change', async (e) => { await setMainTtsProviderField('key', e.target.value, 'phone-tts-key'); });
        if (ttsNimoRelayUrl) ttsNimoRelayUrl.addEventListener('change', async (e) => { await setNimoTtsField('relay-url', e.target.value); });
        if (ttsVolcKey) ttsVolcKey.addEventListener('change', async (e) => { await setVolcTtsField('key', e.target.value, 'phone-tts-key'); });
        if (ttsVolcAppId) ttsVolcAppId.addEventListener('change', async (e) => { await setVolcTtsField('app-id', e.target.value, 'phone-tts-volc-app-id'); });
        if (ttsVolcResourceId) ttsVolcResourceId.addEventListener('change', async (e) => { await setVolcTtsField('resource-id', e.target.value, 'phone-tts-volc-resource-id'); });
        if (ttsVolcCloneWorkerUrl) ttsVolcCloneWorkerUrl.addEventListener('change', async (e) => { await setVolcTtsField('clone-worker-url', e.target.value, 'phone-tts-volc-clone-worker-url'); });
        if (ttsVolcCloneAccessToken) ttsVolcCloneAccessToken.addEventListener('change', async (e) => { await setVolcTtsField('clone-access-token', e.target.value, 'phone-tts-volc-clone-access-token'); });
        if (ttsVolcCloneAppId) ttsVolcCloneAppId.addEventListener('change', async (e) => { await setVolcTtsField('clone-app-id', e.target.value, 'phone-tts-volc-clone-app-id'); });
        if (ttsModel) ttsModel.addEventListener('change', async (e) => { await setMainTtsProviderField('model', e.target.value, 'phone-tts-model'); });
        if (ttsVolcCloneAudioPickBtn && ttsVolcCloneAudio) {
            ttsVolcCloneAudioPickBtn.addEventListener('click', () => {
                ttsVolcCloneAudio.click();
            });
            ttsVolcCloneAudio.addEventListener('change', () => {
                const file = ttsVolcCloneAudio.files?.[0];
                if (ttsVolcCloneAudioName) {
                    ttsVolcCloneAudioName.textContent = file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)` : '未选择文件';
                    ttsVolcCloneAudioName.style.color = file ? '#333' : '#999';
                }
            });
        }
        if (ttsNimoCloneAudioPickBtn && ttsNimoCloneAudio) {
            ttsNimoCloneAudioPickBtn.addEventListener('click', () => {
                ttsNimoCloneAudio.click();
            });
            ttsNimoCloneAudio.addEventListener('change', () => {
                const file = ttsNimoCloneAudio.files?.[0];
                if (ttsNimoCloneAudioName) {
                    ttsNimoCloneAudioName.textContent = file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)` : '未选择文件';
                    ttsNimoCloneAudioName.style.color = file ? '#333' : '#999';
                }
                if (ttsNimoCloneNick && file && !String(ttsNimoCloneNick.value || '').trim()) {
                    ttsNimoCloneNick.value = file.name.replace(/\.[^.]+$/, '');
                }
            });
        }
        if (ttsPreviewBtn) {
            ttsPreviewBtn.addEventListener('click', async () => {
                const provider = getCurrentMainProviderFromForm();
                const voice = String(ttsVoice?.value || '').trim();
                if (provider === 'nimo') {
                    const currentNimoUrl = String(ttsUrl?.value || '').trim();
                    const currentNimoModel = String(ttsModel?.value || '').trim();
                    const currentNimoRelayUrl = String(ttsNimoRelayUrl?.value || '').trim();
                    await setMainTtsProviderField('url', currentNimoUrl, 'phone-tts-url');
                    await setMainTtsProviderField('key', String(ttsKey?.value || '').trim(), 'phone-tts-key');
                    await setMainTtsProviderField('model', currentNimoModel, 'phone-tts-model');
                    await setNimoTtsField('relay-url', currentNimoRelayUrl);
                }
                await saveTtsVoice(voice);
                await playTtsPreview(provider, voice || undefined, ttsPreviewBtn);
            });
        }
        if (ttsVolcPreviewBtn) {
            ttsVolcPreviewBtn.addEventListener('click', async () => {
                const voice = String(ttsVolcVoice?.value || '').trim();
                const volcDefaults = this._getTtsProviderDefaults('volcengine');
                await setVolcTtsField('url', volcDefaults.url);
                await setVolcTtsField('model', volcDefaults.model);
                if (ttsVolcResourceId && /^S_[A-Za-z0-9_-]+$/.test(voice)) {
                    ttsVolcResourceId.value = 'seed-icl-2.0';
                    await setVolcTtsField('resource-id', 'seed-icl-2.0', 'phone-tts-volc-resource-id');
                }
                await saveVolcTtsVoice(voice);
                await playTtsPreview('volcengine', voice || undefined, ttsVolcPreviewBtn);
            });
        }
        if (ttsFallbackMaleProvider) ttsFallbackMaleProvider.addEventListener('change', async () => {
            await saveTtsGenderFallback('male', ttsFallbackMaleProvider, ttsFallbackMaleVoice);
        });
        if (ttsFallbackMaleVoice) ttsFallbackMaleVoice.addEventListener('change', async () => {
            await saveTtsGenderFallback('male', ttsFallbackMaleProvider, ttsFallbackMaleVoice);
        });
        if (ttsFallbackMalePreviewBtn) {
            ttsFallbackMalePreviewBtn.addEventListener('click', async () => {
                await saveTtsGenderFallback('male', ttsFallbackMaleProvider, ttsFallbackMaleVoice);
                const provider = String(ttsFallbackMaleProvider?.value || this._getCurrentTtsProvider()).trim() || 'minimax_cn';
                const voice = String(ttsFallbackMaleVoice?.value || '').trim();
                await playTtsPreview(provider, voice || undefined, ttsFallbackMalePreviewBtn);
            });
        }
        if (ttsFallbackFemaleProvider) ttsFallbackFemaleProvider.addEventListener('change', async () => {
            await saveTtsGenderFallback('female', ttsFallbackFemaleProvider, ttsFallbackFemaleVoice);
        });
        if (ttsFallbackFemaleVoice) ttsFallbackFemaleVoice.addEventListener('change', async () => {
            await saveTtsGenderFallback('female', ttsFallbackFemaleProvider, ttsFallbackFemaleVoice);
        });
        if (ttsFallbackFemalePreviewBtn) {
            ttsFallbackFemalePreviewBtn.addEventListener('click', async () => {
                await saveTtsGenderFallback('female', ttsFallbackFemaleProvider, ttsFallbackFemaleVoice);
                const provider = String(ttsFallbackFemaleProvider?.value || this._getCurrentTtsProvider()).trim() || 'minimax_cn';
                const voice = String(ttsFallbackFemaleVoice?.value || '').trim();
                await playTtsPreview(provider, voice || undefined, ttsFallbackFemalePreviewBtn);
            });
        }
        if (ttsVolcCloneUploadBtn) {
            ttsVolcCloneUploadBtn.addEventListener('click', async () => {
                if (!ttsVolcCloneAudio?.files?.[0]) {
                    ttsVolcCloneAudio?.click();
                    setCloneResult('请先选择用于复刻的音频文件。');
                    return;
                }
                const ttsManager = window.VirtualPhone?.ttsManager;
                if (!ttsManager?.cloneVolcVoice) {
                    setCloneResult('TTS 管理器未初始化，无法上传复刻。', true);
                    return;
                }
                await withBusyButton(ttsVolcCloneUploadBtn, '上传中...', async () => {
                    try {
                        setCloneResult('正在上传音频并开始复刻...');
                        const form = getCloneForm();
                        const result = await ttsManager.cloneVolcVoice(form);
                        const speakerId = String(result.speakerId || form.speakerId).trim();
                        if (ttsVolcCloneSpeakerId) ttsVolcCloneSpeakerId.value = speakerId;
                        if (ttsVolcResourceId) {
                            ttsVolcResourceId.value = result.resourceId || 'seed-icl-2.0';
                            await setVolcTtsField('resource-id', ttsVolcResourceId.value, 'phone-tts-volc-resource-id');
                        }
                        await saveVolcTtsVoice(speakerId);
                        setCloneResult(`上传成功，音色 ${speakerId} 已加入历史。稍后可查询训练状态。`);
                        this.phoneShell.showNotification('上传成功', '豆包音色复刻已开始', '🎙️');
                    } catch (error) {
                        setCloneResult(error?.message || '豆包音色复刻失败', true);
                    }
                });
            });
        }
        if (ttsVolcCloneStatusBtn) {
            ttsVolcCloneStatusBtn.addEventListener('click', async () => {
                const ttsManager = window.VirtualPhone?.ttsManager;
                if (!ttsManager?.getVolcVoiceCloneStatus) {
                    setCloneResult('TTS 管理器未初始化，无法查询状态。', true);
                    return;
                }
                await withBusyButton(ttsVolcCloneStatusBtn, '查询中...', async () => {
                    try {
                        const form = getCloneForm();
                        const result = await ttsManager.getVolcVoiceCloneStatus(form);
                        const versionText = result.version ? `，版本 ${result.version}` : '';
                        setCloneResult(`状态：${result.statusText}${versionText}`);
                    } catch (error) {
                        setCloneResult(error?.message || '豆包音色状态查询失败', true);
                    }
                });
            });
        }
        if (ttsVolcCloneUseBtn) {
            ttsVolcCloneUseBtn.addEventListener('click', async () => {
                const speakerId = String(ttsVolcCloneSpeakerId?.value || '').trim();
                if (!speakerId) {
                    setCloneResult('请先填写 S_ 开头的 Speaker ID。', true);
                    return;
                }
                await this.storage.set('phone-tts-provider', 'volcengine');
                if (ttsProvider) ttsProvider.value = 'volcengine';
                if (ttsVolcResourceId) {
                    ttsVolcResourceId.value = 'seed-icl-2.0';
                    await setVolcTtsField('resource-id', 'seed-icl-2.0', 'phone-tts-volc-resource-id');
                }
                await saveVolcTtsVoice(speakerId);
                setCloneResult(`已设为当前豆包音色：${speakerId}`);
                this.phoneShell.showNotification('已设置', '复刻音色已设为当前音色', '✅');
            });
        }
        if (ttsNimoCloneSaveBtn) {
            ttsNimoCloneSaveBtn.addEventListener('click', async () => {
                if (!ttsNimoCloneAudio?.files?.[0]) {
                    ttsNimoCloneAudio?.click();
                    setNimoCloneResult('请先选择用于 MiMo 复刻的参考音频。');
                    return;
                }
                const ttsManager = window.VirtualPhone?.ttsManager;
                if (!ttsManager?.saveNimoCloneVoice) {
                    setNimoCloneResult('TTS 管理器未初始化，无法保存 MiMo 复刻音色。', true);
                    return;
                }
                await withBusyButton(ttsNimoCloneSaveBtn, '上传中...', async () => {
                    try {
                        const voice = await ttsManager.saveNimoCloneVoice({
                            nick: String(ttsNimoCloneNick?.value || '').trim(),
                            audioFile: ttsNimoCloneAudio.files[0]
                        });
                        const nimoDefaults = this._getTtsProviderDefaults('nimo');
                        const currentNimoUrl = String(ttsUrl?.value || this._getTtsProviderValue('nimo', 'url') || '').trim() || nimoDefaults.url;
                        const currentNimoKey = String(ttsKey?.value || this._getTtsProviderValue('nimo', 'key') || '').trim();
                        await this.storage.set('phone-tts-provider', 'nimo');
                        await this.storage.set('phone-tts-main-provider', 'nimo');
                        await this.storage.set(this._getTtsProviderConfigKey('nimo', 'url'), currentNimoUrl);
                        await this.storage.set(this._getTtsProviderConfigKey('nimo', 'key'), currentNimoKey);
                        await this.storage.set(this._getTtsProviderConfigKey('nimo', 'relay-url'), String(ttsNimoRelayUrl?.value || '').trim());
                        await this.storage.set(this._getTtsProviderConfigKey('nimo', 'model'), 'mimo-v2.5-tts-voiceclone');
                        await this.storage.set('phone-tts-url', currentNimoUrl);
                        await this.storage.set('phone-tts-key', currentNimoKey);
                        await this.storage.set('phone-tts-model', 'mimo-v2.5-tts-voiceclone');
                        if (ttsProvider) ttsProvider.value = 'nimo';
                        if (ttsUrl) ttsUrl.value = currentNimoUrl;
                        if (ttsModel) ttsModel.value = 'mimo-v2.5-tts-voiceclone';
                        refreshTtsPresetOptions();
                        await saveTtsVoice(voice.id);
                        setNimoCloneResult(`已上传到酒馆并设为 MiMo 复刻音色：${voice.nick || voice.id}`);
                        this.phoneShell.showNotification('已设置', 'MiMo 复刻音色已上传并设为当前音色', '✅');
                    } catch (error) {
                        setNimoCloneResult(error?.message || 'MiMo 复刻音色保存失败', true);
                    }
                });
            });
        }
        if (wechatCallAutoTtsToggle) {
            wechatCallAutoTtsToggle.addEventListener('change', async (e) => {
                await this.storage.set('wechat-call-auto-tts', !!e.target.checked);
            });
        }
        if (honeyTtsEnabledToggle) {
            honeyTtsEnabledToggle.addEventListener('change', async (e) => {
                await this.storage.set('phone-honey-tts-enabled', !!e.target.checked);
            });
        }
        if (honeyTtsModeSelect) {
            honeyTtsModeSelect.addEventListener('change', async (e) => {
                const val = String(e.target.value || '').trim() === 'quotes' ? 'quotes' : 'full';
                await this.storage.set('phone-honey-tts-mode', val);
            });
        }
        if (honeyTtsCacheEnabledToggle) {
            honeyTtsCacheEnabledToggle.addEventListener('change', async (e) => {
                await this.storage.set('phone-honey-tts-cache-enabled', !!e.target.checked);
            });
        }
        if (ttsVoice) ttsVoice.addEventListener('change', async (e) => {
            const val = e.target.value.trim();
            await saveTtsVoice(val);
        });
        if (ttsVolcVoice) ttsVolcVoice.addEventListener('change', async (e) => {
            const val = e.target.value.trim();
            await saveVolcTtsVoice(val);
            if (ttsVolcCloneSpeakerId && /^S_[A-Za-z0-9_-]+$/.test(val)) {
                ttsVolcCloneSpeakerId.value = val;
            }
        });

        // 音色历史下拉 → 选择填入输入框
        if (ttsVoicePreset) {
            ttsVoicePreset.addEventListener('change', async (e) => {
                const val = e.target.value;
                if (!val) return;
                await saveTtsVoice(val);
                e.target.value = ''; // 重置为占位项
            });

            // 长按删除音色历史（mousedown 计时）
            let voiceLongPressTimer = null;
            ttsVoicePreset.addEventListener('mousedown', () => {
                voiceLongPressTimer = setTimeout(async () => {
                    const selectedVal = ttsVoicePreset.value;
                    if (!selectedVal) return;
                    if (!confirm(`删除历史音色「${selectedVal}」？`)) return;
                    let history = [];
                    try { history = JSON.parse(this.storage.get('phone-tts-voice-history') || '[]'); } catch(e) {}
                    history = history.filter(v => v !== selectedVal);
                    await this.storage.set('phone-tts-voice-history', JSON.stringify(history));
                    // 移除 DOM option
                    const opt = ttsVoicePreset.querySelector(`option[value="${CSS.escape(selectedVal)}"]`);
                    if (opt) opt.remove();
                    ttsVoicePreset.value = '';
                    // 如果当前使用的就是被删的，清空输入框
                    if (ttsVoice && ttsVoice.value === selectedVal) {
                        ttsVoice.value = '';
                        await setTtsProviderField('voice', '');
                    }
                }, 800);
            });
            ttsVoicePreset.addEventListener('mouseup', () => clearTimeout(voiceLongPressTimer));
            ttsVoicePreset.addEventListener('mouseleave', () => clearTimeout(voiceLongPressTimer));
        }

        const ttsVolcVoicePreset = document.getElementById('phone-tts-volc-voice-preset');
        if (ttsVolcVoicePreset) {
            ttsVolcVoicePreset.addEventListener('change', async (e) => {
                const val = e.target.value;
                if (!val) return;
                await saveVolcTtsVoice(val);
                if (ttsVolcCloneSpeakerId && /^S_[A-Za-z0-9_-]+$/.test(val)) {
                    ttsVolcCloneSpeakerId.value = val;
                }
                e.target.value = '';
            });
        }

        // 删除音色按钮
        const ttsVoiceDeleteBtn = document.getElementById('phone-tts-voice-delete');
        if (ttsVoiceDeleteBtn) {
            ttsVoiceDeleteBtn.addEventListener('click', async () => {
                const currentVoice = ttsVoice?.value?.trim();
                if (!currentVoice) {
                    this.phoneShell.showNotification('提示', '请先选择或输入要删除的音色', '⚠️');
                    return;
                }
                if (!confirm(`确定删除音色「${currentVoice}」？`)) return;

                // 从历史列表移除
                let history = [];
                try { history = JSON.parse(this.storage.get('phone-tts-voice-history') || '[]'); } catch(e) {}
                history = history.filter(v => v !== currentVoice);
                await this.storage.set('phone-tts-voice-history', JSON.stringify(history));

                // 移除下拉选项
                const preset = document.getElementById('phone-tts-voice-preset');
                if (preset) {
                    const opt = preset.querySelector(`option[value="${CSS.escape(currentVoice)}"]`);
                    if (opt) opt.remove();
                    preset.value = '';
                }

                // 清空输入框和存储
                if (ttsVoice) ttsVoice.value = '';
                await setTtsProviderField('voice', '');

                this.phoneShell.showNotification('已删除', `音色「${currentVoice}」已移除`, '🗑️');
            });
        }

        const ttsVolcVoiceDeleteBtn = document.getElementById('phone-tts-volc-voice-delete');
        if (ttsVolcVoiceDeleteBtn) {
            ttsVolcVoiceDeleteBtn.addEventListener('click', async () => {
                const currentVoice = ttsVolcVoice?.value?.trim();
                if (!currentVoice) {
                    this.phoneShell.showNotification('提示', '请先选择或输入要删除的豆包音色', '⚠️');
                    return;
                }
                if (!confirm(`确定删除豆包音色「${currentVoice}」？`)) return;

                let history = [];
                try { history = JSON.parse(this.storage.get('phone-tts-volc-voice-history') || '[]'); } catch(e) {}
                history = history.filter(v => v !== currentVoice);
                await this.storage.set('phone-tts-volc-voice-history', JSON.stringify(history));

                document.querySelectorAll('#phone-tts-volc-voice-preset').forEach((preset) => {
                    const opt = preset.querySelector(`option[value="${CSS.escape(currentVoice)}"]`);
                    if (opt) opt.remove();
                    preset.value = '';
                });

                if (ttsVolcVoice) ttsVolcVoice.value = '';
                if (ttsVolcCloneSpeakerId?.value === currentVoice) ttsVolcCloneSpeakerId.value = '';
                await setVolcTtsField('voice', '');

                this.phoneShell.showNotification('已删除', `豆包音色「${currentVoice}」已移除`, '🗑️');
            });
        }

        // 清空当前角色数据
        document.getElementById('clear-current-data')?.addEventListener('click', () => {
            if (confirm('确定清空当前角色的所有手机数据（含蜜语生成内容）？\n\n微信/微博等全局自定义 CSS 会保留。\n此操作不可恢复！')) {
                window.dispatchEvent(new CustomEvent('phone:clearCurrentData'));
                alert('✅ 数据已清空！');
            }
        });
        
        // 清空所有数据
        document.getElementById('clear-all-data')?.addEventListener('click', () => {
            if (confirm('⚠️ 警告！\n\n确定清空所有角色的手机数据（含蜜语生成内容）？\n此操作将删除所有聊天记录、消息、联系人，并恢复微信/微博自定义 CSS！\n\n此操作不可恢复！')) {
                if (confirm('再次确认：真的要删除所有数据吗？')) {
                    window.dispatchEvent(new CustomEvent('phone:clearAllData'));
                    alert('✅ 所有数据已清空！');
                }
            }
        });

        // 🎨 颜色设置事件（新版：统一全局文字颜色）

        const applyGlobalTextColor = (color) => {
            const safeColor = typeof window.VirtualPhone?.applyGlobalTextColor === 'function'
                ? window.VirtualPhone.applyGlobalTextColor(color)
                : String(color || '#000000').trim() || '#000000';
            return safeColor;
        };

        // 全局文字颜色选择器（实时预览）
        document.getElementById('global-text-color-picker')?.addEventListener('input', (e) => {
            applyGlobalTextColor(e.target.value);
        });

        // 全局文字颜色选择器（保存设置）
        document.getElementById('global-text-color-picker')?.addEventListener('change', async (e) => {
            const color = applyGlobalTextColor(e.target.value);
            await this.storage.set('phone-global-text', color);
        });

        // ⏰ 时间管理功能
        // 显示当前手机时间
        this.updatePhoneTimeDisplay();

        // 从正文同步时间按钮
        document.getElementById('sync-time-btn')?.addEventListener('click', () => {
            this.syncTimeFromChat();
        });

        // 🔥 快捷栏配置点击事件
        document.querySelectorAll('.dock-config-item').forEach(item => {
            item.addEventListener('click', async () => {
                const appId = item.dataset.app;

                // 获取当前配置
                let dockAppIds = ['wechat', 'weibo', 'phone', 'settings'];
                const saved = this.storage.get('dock-apps');
                if (saved) {
                    try {
                        dockAppIds = JSON.parse(saved);
                    } catch (e) {}
                }

                const index = dockAppIds.indexOf(appId);
                if (index > -1) {
                    // 已选中，取消选择（但至少保留1个）
                    if (dockAppIds.length > 1) {
                        dockAppIds.splice(index, 1);
                    } else {
                        alert('⚠️ 至少需要保留1个快捷应用');
                        return;
                    }
                } else {
                    // 未选中，添加（最多4个）
                    if (dockAppIds.length >= 4) {
                        alert('⚠️ 最多只能选择4个快捷应用');
                        return;
                    }
                    dockAppIds.push(appId);
                }

                // 保存配置
                await this.storage.set('dock-apps', JSON.stringify(dockAppIds));

                // 🔥 只更新当前项的勾选状态，不重新渲染整个页面
                const isNowSelected = dockAppIds.includes(appId);
                const iconBox = item.querySelector('div > div');
                if (iconBox) {
                    iconBox.style.border = `2px solid ${isNowSelected ? '#07c160' : 'transparent'}`;
                    iconBox.style.boxShadow = isNowSelected ? '0 0 6px rgba(7, 193, 96, 0.5)' : 'none';

                    // 更新勾选标记
                    const checkMark = iconBox.querySelector('span');
                    if (isNowSelected && !checkMark) {
                        iconBox.insertAdjacentHTML('beforeend', '<span style="position: absolute; bottom: -2px; right: -2px; background: #07c160; color: #fff; width: 14px; height: 14px; border-radius: 50%; font-size: 9px; display: flex; align-items: center; justify-content: center;">✓</span>');
                    } else if (!isNowSelected && checkMark) {
                        checkMark.remove();
                    }
                }
            });
        });

        this.bindMemoryPermissionEvents();
        this.bindTagFilterEvents();

        // 👇 新增：在这里调用独立的 API 事件绑定方法
        this.bindApiConfigEvents();
    }

    // ==========================================
    // 🤖 大模型 API 配置面板逻辑 (独立方法)
    // ==========================================
    bindApiConfigEvents() {
        const document = this._createSettingsScopedDocument();
        const defaultApiConfig = () => ({
            useIndependentAPI: false,
            provider: 'openai',
            apiUrl: '',
            apiKey: '',
            model: '',
            maxTokens: 8192,
            useStream: true,
            profiles: [],
            activeProfileName: '',
            appProfileRoutes: {}
        });

        const normalizeApiConfig = (config) => {
            const merged = { ...defaultApiConfig(), ...(config || {}) };
            if (!Array.isArray(merged.profiles)) merged.profiles = [];
            merged.profiles = merged.profiles
                .filter(p => p && typeof p === 'object' && String(p.name || '').trim())
                .map(p => ({
                    name: String(p.name || '').trim(),
                    useIndependentAPI: p.useIndependentAPI !== false,
                    provider: p.provider || 'openai',
                    apiUrl: p.apiUrl || p.url || '',
                    apiKey: p.apiKey || p.key || '',
                    model: p.model || '',
                    maxTokens: parseInt(p.maxTokens, 10) || 8192,
                    useStream: p.useStream !== false
                }));
            const validProfileNames = new Set(merged.profiles.map(p => p.name));
            const rawRoutes = (merged.appProfileRoutes && typeof merged.appProfileRoutes === 'object')
                ? merged.appProfileRoutes
                : {};
            merged.appProfileRoutes = {};
            ['wechat', 'honey'].forEach((appId) => {
                const routeName = String(rawRoutes[appId] || '').trim();
                merged.appProfileRoutes[appId] = validProfileNames.has(routeName) ? routeName : '';
            });
            merged.maxTokens = parseInt(merged.maxTokens, 10) || 8192;
            merged.useStream = merged.useStream !== false;
            return merged;
        };

        const readApiConfig = () => {
            try {
                const raw = this.storage.get('phone_api_config');
                const parsed = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
                return normalizeApiConfig(parsed);
            } catch (e) {
                return defaultApiConfig();
            }
        };

        const rebuildApiManager = () => {
            try {
                if (window.VirtualPhone && window.VirtualPhone.apiManager) {
                    window.VirtualPhone.apiManager = new window.VirtualPhone.apiManager.constructor(this.storage);
                }
            } catch (e) {
                console.warn('重建 ApiManager 失败:', e);
            }
        };

        const saveApiConfig = async (config) => {
            const normalized = normalizeApiConfig(config);
            await this.storage.set('phone_api_config', JSON.stringify(normalized));
            rebuildApiManager();
            return normalized;
        };

        const collectConfigFromForm = () => ({
            useIndependentAPI: document.getElementById('phone-api-enabled')?.checked || false,
            provider: document.getElementById('phone-api-provider')?.value || 'openai',
            apiUrl: document.getElementById('phone-api-url')?.value.trim() || '',
            apiKey: document.getElementById('phone-api-key')?.value.trim() || '',
            model: document.getElementById('phone-api-model')?.value.trim() || '',
            maxTokens: parseInt(document.getElementById('phone-api-tokens')?.value, 10) || 8192,
            useStream: document.getElementById('phone-api-stream')?.checked !== false
        });

        const applyConfigToForm = (config) => {
            const enabledCb = document.getElementById('phone-api-enabled');
            if (enabledCb) enabledCb.checked = config.useIndependentAPI || false;

            const details = document.getElementById('phone-api-details');
            if (details) details.style.display = config.useIndependentAPI ? 'block' : 'none';

            const providerSel = document.getElementById('phone-api-provider');
            if (providerSel) providerSel.value = config.provider || 'openai';

            const urlInput = document.getElementById('phone-api-url');
            if (urlInput) urlInput.value = config.apiUrl || '';

            const keyInput = document.getElementById('phone-api-key');
            if (keyInput) keyInput.value = config.apiKey || '';

            const modelInput = document.getElementById('phone-api-model');
            if (modelInput) modelInput.value = config.model || '';
            const modelSelect = document.getElementById('phone-api-model-select');
            if (modelInput && modelSelect) {
                modelSelect.style.display = 'none';
                modelSelect.innerHTML = '';
                modelInput.style.display = 'block';
            }

            const tokensInput = document.getElementById('phone-api-tokens');
            if (tokensInput) tokensInput.value = config.maxTokens || 8192;

            const streamCb = document.getElementById('phone-api-stream');
            if (streamCb) streamCb.checked = config.useStream !== false;
        };

        const renderProfileSelect = (config) => {
            const select = document.getElementById('phone-api-profile-select');
            if (!select) return;
            const options = ['<option value="">-- 选择预设 --</option>'];
            config.profiles.forEach((p, idx) => {
                options.push(`<option value="${idx}">${p.name}</option>`);
            });
            select.innerHTML = options.join('');

            let activeIndex = -1;
            if (config.activeProfileName) {
                activeIndex = config.profiles.findIndex(p => p.name === config.activeProfileName);
            }
            if (activeIndex >= 0) {
                select.value = String(activeIndex);
            }
        };

        const renderAppRouteSelects = (config) => {
            const routeOptions = ['<option value="">跟随当前预设</option>']
                .concat(config.profiles.map(p => `<option value="${this._escapeHtml(p.name)}">${this._escapeHtml(p.name)}</option>`))
                .join('');
            ['wechat', 'honey'].forEach((appId) => {
                const select = document.getElementById(`phone-api-route-${appId}`);
                if (!select) return;
                const value = String(config.appProfileRoutes?.[appId] || '').trim();
                select.innerHTML = routeOptions;
                select.value = config.profiles.some(p => p.name === value) ? value : '';
            });
        };

        const parseOpenAIModelsResponse = (data) => {
            const apiManager = window.VirtualPhone?.apiManager;
            if (apiManager && typeof apiManager._parseOpenAIModelsResponse === 'function') {
                return apiManager._parseOpenAIModelsResponse(data);
            }
            if (typeof data === 'string') {
                try { data = JSON.parse(data); } catch { return []; }
            }
            const list = data?.data || data?.models || (Array.isArray(data) ? data : []);
            if (!Array.isArray(list)) return [];
            return list
                .map((m) => {
                    if (typeof m === 'string') return { id: m, name: m };
                    const id = m?.id || m?.model || m?.name;
                    if (!id) return null;
                    return { id, name: m?.name || id };
                })
                .filter(Boolean);
        };

        const updateProviderPlaceholders = (provider) => {
            const urlInput = document.getElementById('phone-api-url');
            const modelInput = document.getElementById('phone-api-model');
            if (!urlInput || !modelInput) return;

            urlInput.setAttribute('placeholder', '请输入 API 地址 (Base URL)...');
            modelInput.setAttribute('placeholder', '请输入模型名称...');

            if (provider === 'local') {
                urlInput.setAttribute('placeholder', '例如: http://127.0.0.1:7860/v1');
                modelInput.setAttribute('placeholder', '例如: gpt-3.5-turbo');
            } else if (provider === 'proxy_only') {
                urlInput.setAttribute('placeholder', '例如: http://127.0.0.1:8889/v1');
                modelInput.setAttribute('placeholder', '例如: gemini-2.5-pro');
            } else if (provider === 'compatible') {
                urlInput.setAttribute('placeholder', '例如: https://api.xxx.com/v1 或 OP兼容端点');
                modelInput.setAttribute('placeholder', '例如: gpt-4o, deepseek-chat');
            } else if (provider === 'openai') {
                urlInput.setAttribute('placeholder', '例如: https://api.openai.com/v1');
                modelInput.setAttribute('placeholder', '例如: gpt-4o');
            } else if (provider === 'deepseek') {
                urlInput.setAttribute('placeholder', '例如: https://api.deepseek.com/v1');
                modelInput.setAttribute('placeholder', '例如: deepseek-chat');
            } else if (provider === 'siliconflow') {
                urlInput.setAttribute('placeholder', '例如: https://api.siliconflow.cn/v1');
                modelInput.setAttribute('placeholder', '例如: deepseek-ai/DeepSeek-V3');
            } else if (provider === 'gemini') {
                urlInput.setAttribute('placeholder', '例如: https://generativelanguage.googleapis.com/v1beta');
                modelInput.setAttribute('placeholder', '例如: gemini-2.5-flash');
            } else if (provider === 'claude') {
                urlInput.setAttribute('placeholder', '例如: https://api.anthropic.com/v1/messages');
                modelInput.setAttribute('placeholder', '例如: claude-3-5-sonnet-20241022');
            }
        };

        // 1. 初始化读取配置并渲染到界面
        const initialConfig = readApiConfig();
        applyConfigToForm(initialConfig);
        renderProfileSelect(initialConfig);
        renderAppRouteSelects(initialConfig);
        updateProviderPlaceholders(initialConfig.provider || 'openai');

        // 2. 开关展开面板 (并自动保存状态)
        const apiEnabledCb = document.getElementById('phone-api-enabled');
        if (apiEnabledCb) {
            apiEnabledCb.onchange = async (e) => {
                const isChecked = e.target.checked;
                const details = document.getElementById('phone-api-details');
                if (details) details.style.display = isChecked ? 'block' : 'none';

                const config = readApiConfig();
                config.useIndependentAPI = isChecked;
                await saveApiConfig(config);
            };
        }

        const apiProviderSelect = document.getElementById('phone-api-provider');
        if (apiProviderSelect) {
            apiProviderSelect.onchange = () => {
                updateProviderPlaceholders(apiProviderSelect.value || 'openai');
                const modelSelect = document.getElementById('phone-api-model-select');
                const modelInput = document.getElementById('phone-api-model');
                if (modelSelect && modelInput) {
                    modelSelect.style.display = 'none';
                    modelSelect.innerHTML = '';
                    modelInput.style.display = 'block';
                }
            };
        }

        // 2.5 API预设切换
        const apiProfileSelect = document.getElementById('phone-api-profile-select');
        if (apiProfileSelect) {
            apiProfileSelect.onchange = async (e) => {
                const idx = parseInt(e.target.value, 10);
                if (!Number.isInteger(idx) || idx < 0) return;

                const config = readApiConfig();
                const profile = config.profiles[idx];
                if (!profile) return;

                const merged = {
                    ...config,
                    useIndependentAPI: profile.useIndependentAPI !== false,
                    provider: profile.provider || 'openai',
                    apiUrl: profile.apiUrl || '',
                    apiKey: profile.apiKey || '',
                    model: profile.model || '',
                    maxTokens: parseInt(profile.maxTokens, 10) || 8192,
                    useStream: profile.useStream !== false,
                    activeProfileName: profile.name
                };
                applyConfigToForm(merged);
                updateProviderPlaceholders(merged.provider || 'openai');
                await saveApiConfig(merged); // 切换预设即生效
                renderProfileSelect(merged);
                renderAppRouteSelects(merged);
            };
        }

        document.querySelectorAll('[data-api-route-app]').forEach((select) => {
            select.addEventListener('change', async (e) => {
                const appId = String(e.target.dataset.apiRouteApp || '').trim();
                if (!appId) return;
                const config = readApiConfig();
                config.appProfileRoutes = {
                    ...(config.appProfileRoutes || {}),
                    [appId]: String(e.target.value || '').trim()
                };
                const saved = await saveApiConfig(config);
                renderAppRouteSelects(saved);
            });
        });

        // 2.6 新建预设
        const apiProfileSaveBtn = document.getElementById('phone-api-profile-save');
        if (apiProfileSaveBtn) {
            apiProfileSaveBtn.onclick = async () => {
                const name = String(prompt('请输入新的 API 预设名称', '') || '').trim();
                if (!name) return;

                const config = readApiConfig();
                const existingIdx = config.profiles.findIndex(p => p.name === name);
                if (existingIdx >= 0) {
                    alert(`预设“${name}”已存在。请换一个名称，或选择该预设后点“保存当前”。`);
                    return;
                }

                const profile = { name, ...collectConfigFromForm() };
                config.profiles.push(profile);
                Object.assign(config, profile);
                config.activeProfileName = name;
                const saved = await saveApiConfig(config);
                renderProfileSelect(saved);
                renderAppRouteSelects(saved);
                const select = document.getElementById('phone-api-profile-select');
                if (select) {
                    const idx = saved.profiles.findIndex(p => p.name === name);
                    if (idx >= 0) select.value = String(idx);
                }
                alert('✅ API 预设已新建');
            };
        }

        // 2.6.1 保存当前预设
        const apiProfileSaveCurrentBtn = document.getElementById('phone-api-profile-save-current');
        if (apiProfileSaveCurrentBtn) {
            apiProfileSaveCurrentBtn.onclick = async () => {
                const select = document.getElementById('phone-api-profile-select');
                const idx = select ? parseInt(select.value, 10) : -1;
                if (!Number.isInteger(idx) || idx < 0) {
                    alert('请先选择一个要保存的预设；如果要创建新预设，请点“新建预设”。');
                    return;
                }

                const config = readApiConfig();
                const target = config.profiles[idx];
                if (!target) return;
                if (!confirm(`确定覆盖保存预设“${target.name}”吗？`)) return;

                const formConfig = collectConfigFromForm();
                config.profiles[idx] = { ...target, ...formConfig, name: target.name };
                Object.assign(config, config.profiles[idx]);
                config.activeProfileName = target.name;
                const saved = await saveApiConfig(config);
                renderProfileSelect(saved);
                renderAppRouteSelects(saved);
                const nextSelect = document.getElementById('phone-api-profile-select');
                if (nextSelect) nextSelect.value = String(idx);
                alert('✅ 当前 API 预设已保存');
            };
        }

        // 2.7 删除预设
        const apiProfileDeleteBtn = document.getElementById('phone-api-profile-delete');
        if (apiProfileDeleteBtn) {
            apiProfileDeleteBtn.onclick = async () => {
                const select = document.getElementById('phone-api-profile-select');
                const idx = select ? parseInt(select.value, 10) : -1;
                if (!Number.isInteger(idx) || idx < 0) {
                    alert('请先选择一个预设');
                    return;
                }

                const config = readApiConfig();
                const target = config.profiles[idx];
                if (!target) return;
                if (!confirm(`确定删除预设“${target.name}”吗？`)) return;

                config.profiles.splice(idx, 1);
                if (config.activeProfileName === target.name) config.activeProfileName = '';
                const saved = await saveApiConfig(config);
                renderProfileSelect(saved);
                renderAppRouteSelects(saved);
                alert('✅ 预设已删除');
            };
        }

        // 3. 💾 保存配置（保留预设并同步当前选中预设）
        const apiSaveBtn = document.getElementById('phone-api-save');
        if (apiSaveBtn) {
            apiSaveBtn.onclick = async () => {
                const config = readApiConfig();
                const formConfig = collectConfigFromForm();
                Object.assign(config, formConfig);

                const select = document.getElementById('phone-api-profile-select');
                const idx = select ? parseInt(select.value, 10) : -1;
                if (Number.isInteger(idx) && idx >= 0 && config.profiles[idx]) {
                    config.profiles[idx] = { ...config.profiles[idx], ...formConfig };
                    config.activeProfileName = config.profiles[idx].name;
                }

                const saved = await saveApiConfig(config);
                renderProfileSelect(saved);
                renderAppRouteSelects(saved);
                alert(Number.isInteger(idx) && idx >= 0
                    ? '✅ 手机专属 API 配置已保存，并已同步到当前选中预设。'
                    : '✅ 手机专属 API 配置已保存。');
            };
        }

        // 4. 🧪 测试连接
        let isTesting = false; // 防连击锁
        const apiTestBtn = document.getElementById('phone-api-test');
        if (apiTestBtn) {
            apiTestBtn.onclick = async () => {
                if (isTesting) return;
                isTesting = true;
                
                const originalText = apiTestBtn.innerText;
                apiTestBtn.innerText = '测试中...';
                
                const tempConfig = {
                    provider: document.getElementById('phone-api-provider')?.value || 'openai',
                    apiUrl: document.getElementById('phone-api-url')?.value.trim() || '',
                    apiKey: document.getElementById('phone-api-key')?.value.trim() || '',
                    model: document.getElementById('phone-api-model')?.value.trim() || '',
                    useIndependentAPI: true,
                    useStream: false,
                    maxTokens: parseInt(document.getElementById('phone-api-tokens')?.value, 10) || 8192
                };

                try {
                    const apiManager = window.VirtualPhone?.apiManager;
                    const testMessages = [{
                        role: 'user',
                        content: '这是一次API连通性测试。不要解释，不要输出思考过程，只回复：API_TEST_OK'
                    }];
                    const result = await apiManager.callAI(testMessages, {
                        appId: 'phone_online',
                        max_tokens: tempConfig.maxTokens || 8192,
                        overrideApiConfig: tempConfig
                    });

                    if (result.success) {
                        alert('✅ API 连接成功！');
                    } else {
                        alert('❌ 测试失败：\n' + result.error);
                    }
                } catch (error) {
                    alert('❌ 连接异常：\n' + error.message);
                } finally {
                    apiTestBtn.innerText = originalText;
                    isTesting = false;
                }
            };
        }

        // 5. 🔄 拉取模型列表
        let isFetching = false; // 防连击锁
        const apiFetchBtn = document.getElementById('phone-api-fetch-models');
        if (apiFetchBtn) {
            apiFetchBtn.onclick = async () => {
                if (isFetching) return;
                isFetching = true;

                const originalText = apiFetchBtn.innerText;
                apiFetchBtn.innerText = '拉取中...';

                const apiManager = window.VirtualPhone?.apiManager;
                let apiUrl = (document.getElementById('phone-api-url')?.value.trim() || '').replace(/\/+$/, '');
                const apiKey = document.getElementById('phone-api-key')?.value.trim() || '';
                const provider = document.getElementById('phone-api-provider')?.value || 'openai';
                const authHeader = apiKey ? (apiKey.startsWith('Bearer ') ? apiKey : ('Bearer ' + apiKey)) : undefined;

                if (apiManager && typeof apiManager._processApiUrl === 'function') {
                    apiUrl = apiManager._processApiUrl(apiUrl, provider, true);
                } else if (provider !== 'gemini' && !apiUrl.includes('/v1') && !apiUrl.includes('/chat')) {
                    apiUrl += '/v1';
                }

                try {
                    const displayModelSelect = (models) => {
                        const select = document.getElementById('phone-api-model-select');
                        const input = document.getElementById('phone-api-model');
                        if (!select || !input) return;

                        select.innerHTML = '<option value="__manual__">-- 手动输入 --</option>' +
                            models.map((m) => `<option value="${m.id}">${m.name || m.id}</option>`).join('');
                        const currentVal = input.value.trim();
                        const modelIds = models.map((m) => m.id);
                        select.value = modelIds.includes(currentVal) ? currentVal : '__manual__';
                        input.style.display = 'none';
                        select.style.display = 'block';
                        select.onchange = (e) => {
                            if (e.target.value === '__manual__') {
                                select.style.display = 'none';
                                input.style.display = 'block';
                                input.focus();
                            } else {
                                input.value = e.target.value;
                            }
                        };
                    };

                    const normalizeModels = (list) => (list || [])
                        .map((m) => {
                            if (typeof m === 'string') return { id: m, name: m };
                            const id = m?.id || m?.model || m?.name;
                            if (!id) return null;
                            return { id, name: m?.name || id };
                        })
                        .filter(Boolean);

                    let models = [];
                    let proxyErrorMsg = null;

                    const runProxyRequest = async () => {
                        if (!apiManager || typeof apiManager._getCsrfToken !== 'function') {
                            throw new Error('ApiManager 未初始化，无法使用后端代理拉取');
                        }

                        const csrfToken = await apiManager._getCsrfToken();
                        let targetSource = 'custom';
                        if (provider === 'openai' || provider === 'deepseek' || provider === 'siliconflow' || provider === 'compatible') {
                            targetSource = 'openai';
                        }

                        const customHeaders = { 'Content-Type': 'application/json' };
                        if (targetSource === 'custom' && authHeader) {
                            customHeaders.Authorization = authHeader;
                        }

                        const proxyPayload = {
                            chat_completion_source: targetSource,
                            custom_url: apiUrl,
                            reverse_proxy: apiUrl,
                            proxy_password: apiKey,
                            custom_include_headers: customHeaders
                        };

                        try {
                            const response = await fetch('/api/backends/chat-completions/status', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                                body: JSON.stringify(proxyPayload),
                                credentials: 'include'
                            });
                            const text = await response.text();
                            if (!response.ok) throw new Error(`后端代理请求失败: ${response.status} ${text.substring(0, 300)}`);

                            let rawData;
                            try {
                                rawData = JSON.parse(text);
                            } catch (e) {
                                throw new Error(`后端返回非JSON格式: ${text.substring(0, 120)}`);
                            }

                            let parsed = parseOpenAIModelsResponse(rawData);
                            if (!parsed.length) {
                                parsed = normalizeModels(rawData?.data || rawData?.models || (Array.isArray(rawData) ? rawData : []));
                            }
                            if (parsed.length > 0) return parsed;
                            throw new Error('后端代理返回空模型列表');
                        } catch (firstError) {
                            if ((provider === 'proxy_only' || provider === 'compatible') && targetSource === 'custom') {
                                let v1Url = apiUrl;
                                if (!v1Url.includes('/v1') && !v1Url.includes('/models')) {
                                    v1Url = v1Url.replace(/\/+$/, '') + '/v1';
                                }
                                const retryPayload = {
                                    chat_completion_source: 'openai',
                                    reverse_proxy: v1Url,
                                    proxy_password: apiKey
                                };
                                const retryResp = await fetch('/api/backends/chat-completions/status', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                                    body: JSON.stringify(retryPayload),
                                    credentials: 'include'
                                });
                                const retryText = await retryResp.text();
                                if (!retryResp.ok) throw new Error(`降级重试失败: ${retryResp.status} ${retryText.substring(0, 300)}`);

                                let retryData;
                                try {
                                    retryData = JSON.parse(retryText);
                                } catch {
                                    throw new Error(`降级重试返回非JSON: ${retryText.substring(0, 120)}`);
                                }

                                let parsed = parseOpenAIModelsResponse(retryData);
                                if (!parsed.length) {
                                    parsed = normalizeModels(retryData?.data || retryData?.models || (Array.isArray(retryData) ? retryData : []));
                                }
                                if (parsed.length > 0) return parsed;
                                throw new Error('降级重试返回空模型列表');
                            }
                            throw firstError;
                        }
                    };

                    const forceProxy = (provider === 'local' || provider === 'openai' || provider === 'claude' || provider === 'proxy_only' || provider === 'deepseek' || provider === 'siliconflow');
                    if (forceProxy || provider === 'compatible') {
                        try {
                            models = await runProxyRequest();
                        } catch (e) {
                            proxyErrorMsg = e.message;
                        }
                    }

                    if (models.length === 0) {
                        try {
                            let directUrl = `${apiUrl}/models`;
                            const headers = { 'Content-Type': 'application/json' };

                            if (provider === 'gemini') {
                                if (apiUrl.includes('googleapis.com') && !apiUrl.toLowerCase().includes('/v1')) {
                                    directUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
                                } else if (authHeader) {
                                    headers.Authorization = authHeader;
                                }
                            } else if (authHeader) {
                                headers.Authorization = authHeader;
                            }

                            const resp = await fetch(directUrl, { method: 'GET', headers });
                            const text = await resp.text();
                            if (!resp.ok) throw new Error(`浏览器直连失败: HTTP ${resp.status} ${text.substring(0, 300)}`);

                            let data;
                            try {
                                data = JSON.parse(text);
                            } catch {
                                throw new Error(`直连返回非JSON格式: ${text.substring(0, 120)}`);
                            }

                            if (provider === 'gemini' && Array.isArray(data?.models)) {
                                models = data.models.map((m) => ({
                                    id: String(m.name || '').replace(/^models\//, ''),
                                    name: m.displayName || m.name
                                })).filter((m) => m.id);
                            } else {
                                models = parseOpenAIModelsResponse(data);
                                if (!models.length) {
                                    models = normalizeModels(data?.data || data?.models || (Array.isArray(data) ? data : []));
                                }
                            }
                        } catch (directErr) {
                            if (proxyErrorMsg) {
                                throw new Error(`后端代理失败: ${proxyErrorMsg}\n直连失败: ${directErr.message}`);
                            }
                            throw directErr;
                        }
                    }

                    if (!models.length) {
                        throw new Error('未找到模型列表');
                    }

                    displayModelSelect(models);
                    alert(`✅ 成功拉取 ${models.length} 个模型！请在下拉框中选择。`);
                } catch (error) {
                    const baseMsg = `❌ 拉取失败: ${error.message}`;
                    alert(baseMsg + '\n\n您可以直接在下方输入框手动填写模型名。');
                } finally {
                    apiFetchBtn.innerText = originalText;
                    isFetching = false;
                }
            };
        }
    }

    // ⏰ 更新手机时间显示
    updatePhoneTimeDisplay() {
        const timeDisplay = document.getElementById('current-phone-time');
        if (!timeDisplay) return;

        try {
            const timeManager = window.VirtualPhone?.timeManager;
            if (timeManager) {
                const currentTime = timeManager.getCurrentStoryTime();
                timeDisplay.textContent = `${currentTime.date || '未知'} ${currentTime.time || '未知'} ${currentTime.weekday || ''}`;
            } else {
                timeDisplay.textContent = '时间管理器未初始化';
            }
        } catch (e) {
            console.error('❌ 获取手机时间失败:', e);
            timeDisplay.textContent = '获取失败';
        }
    }

    // ⏰ 从正文同步时间
    syncTimeFromChat() {
        try {
            const context = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
                ? SillyTavern.getContext()
                : null;

            if (!context || !context.chat || context.chat.length === 0) {
                alert('❌ 无法获取聊天记录');
                return;
            }

            // 从最后一条AI消息中提取时间
            let extractedTime = null;
            for (let i = context.chat.length - 1; i >= 0; i--) {
                const msg = context.chat[i];
                if (!msg.is_user && msg.mes) {
                    extractedTime = this.parseTimeFromMessage(msg.mes);
                    if (extractedTime) break;
                }
            }

            if (extractedTime) {
                // 更新到 TimeManager
                const timeManager = window.VirtualPhone?.timeManager;
                if (timeManager && timeManager.setTime) {
                    // 🔥 传递星期
                    timeManager.setTime(extractedTime.time, extractedTime.date, extractedTime.weekday, { force: true });
                    const effectiveTime = timeManager.getCurrentStoryTime?.();
                    const extractedTimestamp = timeManager.parseTimeToTimestamp?.(extractedTime);
                    const effectiveTimestamp = timeManager.parseTimeToTimestamp?.(effectiveTime);
                    const isEffectiveTimeLater = Number.isFinite(extractedTimestamp)
                        && Number.isFinite(effectiveTimestamp)
                        && effectiveTimestamp > extractedTimestamp;

                    this.updatePhoneTimeDisplay();

                    // 🔥 同步更新状态栏时间
                    const phoneShell = window.VirtualPhone?.phoneShell;
                    if (phoneShell?.updateStatusBarTime) {
                        phoneShell.updateStatusBarTime();
                    }

                    // 🔥 同步更新主屏幕时间
                    const home = window.VirtualPhone?.home;
                    if (home?.updateTimeDisplay) {
                        home.updateTimeDisplay();
                    }

                    // 🔥 通知中显示星期
                    if (isEffectiveTimeLater) {
                        const effectiveText = effectiveTime
                            ? `${effectiveTime.date || '未知'} ${effectiveTime.weekday || ''} ${effectiveTime.time || '未知'}`.trim()
                            : '未知';
                        alert(
                            '⚠️ 手机时间未回退\n\n' +
                            `正文时间：${extractedTime.date} ${extractedTime.weekday} ${extractedTime.time}\n` +
                            `当前手机时间：${effectiveText}\n\n` +
                            '系统会取正文时间和手机最新消息时间中的较晚值。' +
                            '如需改回正文时间，请删除小手机里更晚时间的微信聊天记录后再同步。'
                        );
                    } else {
                        alert(`✅ 时间已同步：${extractedTime.date} ${extractedTime.weekday} ${extractedTime.time}`);
                    }
                } else {
                    alert('❌ 时间管理器未初始化');
                }
            } else {
                alert(
                    '❌ 未能从正文中识别到可解析的时间格式\n\n' +
                    '可用示例：\n' +
                    '1) 417年11月7日|星期三|21:28\n' +
                    '2) 417年11月7日 星期三 21:28\n' +
                    '3) 417/11/7 21:28\n' +
                    '4) 417年11月7日 星期三 2128\n' +
                    '5) <statusbar>417年11月7日·星期三·21:28</statusbar>'
                );
            }
        } catch (e) {
            console.error('❌ 时间同步失败:', e);
            alert('❌ 时间同步失败：' + e.message);
        }
    }

    // ⏰ 从消息中解析时间（支持多种格式）
    parseTimeFromMessage(text) {
        const rawText = String(text || '');

        // 优先复用 TimeManager 的统一解析（支持无标签正文、竖线/斜杠、紧凑时间等）
        try {
            const parsedByTimeManager = window.VirtualPhone?.timeManager?.parseStatusbar?.(rawText);
            if (parsedByTimeManager?.date && parsedByTimeManager?.time) {
                return {
                    time: parsedByTimeManager.time,
                    date: parsedByTimeManager.date,
                    weekday: parsedByTimeManager.weekday
                };
            }
        } catch (e) {
            // 忽略，继续走本地兜底解析
        }

        // 兜底本地解析
        const tagMatch = rawText.match(/<(statusbar|globalTime|time)>([\s\S]*?)<\/\1>/i);
        const baseContent = tagMatch ? tagMatch[2] : rawText;
        const content = String(baseContent)
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/｜/g, '|')
            .replace(/／/g, '/');

        const dateMatch = content.match(/(\d{1,6})[-\/年]\s*(\d{1,2})[-\/月]\s*(\d{1,2})\s*日?/);
        const dateToken = dateMatch?.[0] || '';
        const afterDateContent = dateToken ? content.slice(content.indexOf(dateToken) + dateToken.length) : content;
        const standardTimeMatch = afterDateContent.match(/(\d{1,2})\s*[:：时]\s*(\d{1,2})(?:\s*分)?/);
        const compactTimeMatch = standardTimeMatch
            ? null
            : afterDateContent.match(/(?:^|[^\d])([01]?\d|2[0-3])([0-5]\d)(?:$|[^\d])/);
        const weekdayMatch = content.match(/(星期[一二三四五六日天]|周[一二三四五六日天])/);

        if (dateMatch && (standardTimeMatch || compactTimeMatch)) {
            const year = parseInt(dateMatch[1]);
            const month = parseInt(dateMatch[2]);
            const day = parseInt(dateMatch[3]);
            const hour = String(parseInt(standardTimeMatch ? standardTimeMatch[1] : compactTimeMatch[1])).padStart(2, '0');
            const minute = String(parseInt(standardTimeMatch ? standardTimeMatch[2] : compactTimeMatch[2])).padStart(2, '0');

            // 🔥 优先使用正文中的星期，否则用蔡勒公式计算
            let weekday;
            if (weekdayMatch) {
                weekday = weekdayMatch[1].replace('周', '星期'); // 统一转为星期X
                if (weekday === '星期天') weekday = '星期日';
            } else {
                weekday = this.calculateWeekday(year, month, day);
            }

            return {
                time: `${hour}:${minute}`,
                // 🔥 关键：返回给系统底层时，强制统一成标准格式，防止其他地方报错
                date: `${year}年${String(month).padStart(2, '0')}月${String(day).padStart(2, '0')}日`,
                weekday: weekday
            };
        }

        return null;
    }

    // 🔥 使用蔡勒公式计算星期几（支持任意年份）
    calculateWeekday(year, month, day) {
        let y = year;
        let m = month;

        if (m < 3) {
            m += 12;
            y -= 1;
        }

        const q = day;
        const k = y % 100;
        const j = Math.floor(y / 100);

        let h = (q + Math.floor((13 * (m + 1)) / 5) + k + Math.floor(k / 4) + Math.floor(j / 4) - 2 * j) % 7;
        h = ((h % 7) + 7) % 7;

        const weekdays = ['星期六', '星期日', '星期一', '星期二', '星期三', '星期四', '星期五'];
        return weekdays[h];
    }

    // ⚠️ 已废弃：以下方法保留以防兼容性问题，但不再使用
    // 🎨 应用颜色到页面的方法（旧版）
    applyColors() {
        // 已被统一的全局文字颜色系统替代
        console.warn('⚠️ applyColors() 已废弃，请使用全局文字颜色系统');
    }

    // 🎨 判断颜色是否为浅色（旧版）
    isLightColor(color) {
        const hex = color.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 155;
    }
    
    updatePhoneIcon() {
        const icon = document.getElementById('phoneDrawerIcon');
        if (icon) {
            if (this.settings.enabled) {
                icon.style.opacity = '1';
                icon.style.filter = 'none';
                icon.title = '虚拟手机 (已启用)';
            } else {
                icon.style.opacity = '0.4';
                icon.style.filter = 'grayscale(1)';
                icon.title = '虚拟手机 (已禁用)';
            }
        }
    }
}
