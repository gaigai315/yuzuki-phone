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
import { ImageCropper } from '../settings/image-cropper.js';
import { captureWechatChatSnapshot } from './chat-snapshot.js';
import { applyPhoneTagFilter } from '../../config/tag-filter.js';
import { readPhoneContextLimit } from '../../config/context-settings.js';
import { CatboxData } from '../games/catbox/catbox-data.js';

const LOBBY_LINK_CHARACTER_IDS_KEY = 'phone-lobby-link-character-ids';
const LOBBY_LINK_GROUP_IDS_KEY = 'phone-lobby-link-group-ids';
const WECHAT_STICKER_ALAPI_CACHE_KEY = 'phone_wechat_alapi_sticker_cache_v1';
const WECHAT_STICKER_ALAPI_CACHE_MAX = 240;
const WECHAT_STICKER_ALAPI_CACHE_TTL = 90 * 24 * 60 * 60 * 1000;
// 聊天界面视图
export class ChatView {
    constructor(wechatApp) {
        this.app = wechatApp;
        this.inputText = '';
        this.showEmoji = false;
        this.showMore = false;
        this.showQuickReplies = false;
        this.showToolbar = false; // 工具栏默认折叠
        this.emojiTab = 'default';
        this.isSending = false;  // 🔥 发送状态
        this._activeSendingChatId = null;
        this._isFlushingPending = false;
        this.abortController = null;  // 🔥 用于中断请求
        this.batchTimer = null;  // 🔥 智能连发倒计时
        this.pendingChatIds = new Set(); // 🔥 记录等待统一发送的会话队列
        this.activeQuote = null;  // 🔥 当前激活的引用消息
        this.audioPlayer = new Audio();
        this.currentPlayingMsgId = null;
        this.currentPlayingCallMsgId = null;
        this.currentTtsRound = null;
        this._suppressWeiboCardClickUntil = 0;
        this._inlineStickerHydrateTimer = null;
        this._missingBoundVoiceWarned = new Set();
        this._aiReplyTimeCursor = null;
        this._aiReplyRequestStartedAt = 0;
        this._isMessageInlineEditing = false;
        this._wechatTtsCache = new Map();
        this._wechatTtsCacheOrder = [];
        this._wechatTtsCacheLimit = 24;
        this._imagePromptGenerationLocks = new Set();
        this.customEmojiSelectionMode = false;
        this.selectedCustomEmojiIds = new Set();
        this.messageSelectionMode = false;
        this.selectedMessageIds = new Set();
        this.messageSelectionChatId = null;
        this._lobbyPersonaProfileCache = new Map();
        this._lobbyPersonaCacheTTL = 10 * 60 * 1000;
        this._lobbyPersonaEmptyCacheTTL = 45 * 1000;
        this._lobbyPersonaCacheMax = 128;
    }

    _readNonNegativeLimit(key, defaultValue = 0, maxValue = 9999) {
        const storage = window.VirtualPhone?.storage || this.app?.storage;
        const raw = storage?.get?.(key);
        if (raw === undefined || raw === null || raw === '') return defaultValue;
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isFinite(parsed)) return defaultValue;
        return Math.max(0, Math.min(maxValue, parsed));
    }

    _formatRealDateTime(timestamp = Date.now()) {
        const dateObj = new Date(Number(timestamp || Date.now()));
        const pad = (value) => String(value).padStart(2, '0');
        return {
            date: `${dateObj.getFullYear()}年${pad(dateObj.getMonth() + 1)}月${pad(dateObj.getDate())}日`,
            time: `${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`,
            timestamp: dateObj.getTime()
        };
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

    _getCurrentTavernChatId() {
        try {
            const context = this._safeGetContext();
            return String(context?.chatMetadata?.file_name || context?.chatId || 'default_chat');
        } catch (e) {
            return 'default_chat';
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

    _getContactForChat(chat = null) {
        if (!chat) return null;
        const contactId = String(chat?.contactId || '').trim();
        const chatName = String(chat?.name || '').trim();
        return (contactId ? this.app.wechatData?.getContact?.(contactId) : null)
            || this.app.wechatData?.findContactByNameLoose?.(chatName, { includeChats: false })
            || (this.app.wechatData?.getContacts?.() || [])
                .find(item => this._normalizeLookupName(item?.name) === this._normalizeLookupName(chatName))
            || null;
    }

    _isBlockedSingleChat(chat = null) {
        if (!chat || chat.type === 'group') return false;
        return !!this._getContactForChat(chat)?.blocked;
    }

    _getContactByDisplayName(name = '') {
        const safeName = String(name || '').trim();
        if (!safeName) return null;
        return this.app.wechatData?.findContactByNameLoose?.(safeName, { includeChats: false })
            || (this.app.wechatData?.getContacts?.() || [])
                .find(item => this._normalizeLookupName(item?.name) === this._normalizeLookupName(safeName))
            || null;
    }

    _formatWechatContactNameForPrompt(name = '') {
        const safeName = String(name || '').trim();
        if (!safeName) return '';
        const contact = this._getContactByDisplayName(safeName);
        return contact?.blocked ? `${safeName}（已拉黑）` : safeName;
    }

    _formatWechatContactListForPrompt(contacts = []) {
        const names = (Array.isArray(contacts) ? contacts : [])
            .map(contact => {
                const name = String(contact?.name || '').trim();
                return name ? (contact?.blocked ? `${name}（已拉黑）` : name) : '';
            })
            .filter(Boolean);
        return names.length > 0 ? names.join('、') : '暂无好友';
    }

    _formatGroupMembersForPrompt(members = []) {
        return (Array.isArray(members) ? members : [])
            .map(name => this._formatWechatContactNameForPrompt(name))
            .filter(Boolean);
    }

    _notifyBlockedChatSend(chat = null) {
        const name = String(chat?.name || '该好友').trim() || '该好友';
        this.app.phoneShell?.showNotification('无法发送', `${name}已被拉黑，请先移除黑名单`, '⚠️');
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
                const members = rawMembers
                    .map(member => String(member?.name || member?.avatar || member || '').trim())
                    .filter(Boolean);
                const id = this._normalizeLobbyId('group', group?.id || group?.name || name, index);
                if (seen.has(id)) return;
                seen.add(id);
                list.push({ id, name, members });
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

    _buildLobbySelection(context = null) {
        const ctx = context || this._safeGetContext();
        const isLobby = this._isLobbyMode(ctx);
        if (!isLobby) return { isLobby: false, characters: [], groups: [] };

        const storage = window.VirtualPhone?.storage;
        const allCharacters = this._extractLobbyCharacters(ctx);
        const allGroups = this._extractLobbyGroups(ctx);
        const characterIds = this._parseIdList(storage?.get(LOBBY_LINK_CHARACTER_IDS_KEY));
        const groupIds = this._parseIdList(storage?.get(LOBBY_LINK_GROUP_IDS_KEY));
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
        const selection = lobbySelection || this._buildLobbySelection(this._safeGetContext());
        if (!selection?.isLobby) return [];
        return (selection.groups || [])
            .filter(item => String(item?.id || '').startsWith('group_persona:'))
            .map(item => {
                const members = Array.isArray(item?.members) ? item.members : [];
                return String(members[0] || item?.name || '').trim();
            })
            .filter(Boolean);
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
                    if (typeof item === 'string') return;
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
                        if (mappedName) {
                            pushProfile(mappedName, safeAvatarId, value);
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
        if (selectedName) pushProfile(selectedName, selectedName, selectedDescription);

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

    // 🔥 判断当前会话是否开启手机内 AI 互动（互通模式或线上模式）
    isOnlineMode() {
        const storage = window.VirtualPhone?.storage;
        if (!storage) return false;
        const context = this._safeGetContext?.();
        const interopKey = this.app?.wechatData?.getOnlineModeStorageKey?.(context) || 'wechat_online_mode';
        const onlineOnlyKey = this.app?.wechatData?.getOnlineOnlyModeStorageKey?.(context) || 'wechat_online_only_mode';
        const isEnabled = (key) => {
            const val = storage.get(key);
            return val === true || val === 'true' || val === 1;
        };
        return isEnabled(interopKey) || isEnabled(onlineOnlyKey);
    }

    _notifyOnlineModeRequired() {
        this.app?.phoneShell?.showNotification?.('离线模式', '请先在设置中开启微信互通模式或线上模式', '⚠️');
    }

    _stripWechatCommentWrapper(text) {
        let out = String(text || '').replace(/\r\n/g, '\n').trim();
        if (!out) return '';

        const wrappedMatch = out.match(/^<!--\s*([\s\S]*?)\s*-->$/);
        if (wrappedMatch) {
            out = String(wrappedMatch[1] || '');
        }

        return out
            .replace(/^\s*<!--\s*/i, '')
            .replace(/\s*-->\s*$/i, '')
            .replace(/^\s*<!--\s*$/gim, '')
            .replace(/^\s*-->\s*$/gim, '')
            .trim();
    }

    _extractWechatTagPayload(text) {
        const match = String(text || '').match(/<\s*wechat\b[^>]*>([\s\S]*?)<\s*\/\s*wechat\s*>/i);
        if (!match) return '';
        return this._stripWechatCommentWrapper(match[1]);
    }

    _extractWechatTagPayloadOrSelf(text) {
        const payload = this._extractWechatTagPayload(text);
        if (payload) return payload;
        return this._stripWechatCommentWrapper(text);
    }

    _getPendingChatIdsOrdered(preferredChatId = null) {
        const preferred = String(preferredChatId || '').trim();
        const ids = Array.from(this.pendingChatIds || []).map(id => String(id || '').trim()).filter(Boolean);
        if (!preferred) return ids;
        const unique = [];
        if (ids.includes(preferred)) unique.push(preferred);
        ids.forEach((id) => {
            if (id !== preferred) unique.push(id);
        });
        return unique;
    }

    _enqueuePendingChat(chatId, { shouldStartTimer = true, shouldShowStatus = true } = {}) {
        const safeChatId = String(chatId || '').trim();
        if (!safeChatId) return false;

        if (!this.isOnlineMode()) {
            clearTimeout(this.batchTimer);
            this.hideTypingStatus(safeChatId);
            return false;
        }

        this.pendingChatIds.add(safeChatId);

        if (shouldStartTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = setTimeout(() => this.triggerAI(), 6000);
        }

        if (shouldShowStatus) {
            this.showTypingStatus('等待回复', safeChatId);
        }

        return true;
    }

    _dequeuePendingChat(chatId) {
        const safeChatId = String(chatId || '').trim();
        if (!safeChatId) return;
        this.pendingChatIds.delete(safeChatId);
    }

    _hasPendingChat(chatId = null) {
        if (!chatId) return this.pendingChatIds.size > 0;
        return this.pendingChatIds.has(String(chatId || '').trim());
    }

    _isComposingInCurrentChat(chatId = null) {
        const safeChatId = String(chatId || this.app.currentChat?.id || '').trim();
        const currentChatId = String(this.app.currentChat?.id || '').trim();
        if (!safeChatId || !currentChatId || safeChatId !== currentChatId) {
            return false;
        }

        const currentView = this.getCurrentWechatView ? this.getCurrentWechatView() : document;
        const input = currentView.querySelector('#chat-input') || document.getElementById('chat-input');
        const isInputFocused = !!input && document.activeElement === input;
        const hasInputText = !!input && String(input.value || this.inputText || '').trim() !== '';
        const isPanelOpen = !!(this.showEmoji || this.showMore || this.showQuickReplies);
        const isInlineEditing = this._isMessageInlineEditing
            || !!currentView.querySelector('.inline-edit-input, .call-inline-edit');
        return isInputFocused || hasInputText || isPanelOpen || isInlineEditing;
    }

    _setMessageInlineEditMode(active = false, chatId = null) {
        this._isMessageInlineEditing = !!active;
        if (this._isMessageInlineEditing) {
            clearTimeout(this.batchTimer);
            this.hideTypingStatus();
            return;
        }

        const targetChatId = String(chatId || this.app.currentChat?.id || '').trim();
        if (!targetChatId) return;

        const currentView = this.getCurrentWechatView ? this.getCurrentWechatView() : document;
        const input = currentView.querySelector('#chat-input') || document.getElementById('chat-input');
        const trimmedText = String(input?.value || this.inputText || '').trim();
        const shouldRestart = this._hasPendingChat(targetChatId)
            && !this._isComposingInCurrentChat(targetChatId)
            && trimmedText === ''
            && !this.showEmoji
            && !this.showMore
            && !this.showQuickReplies
            && document.activeElement !== input;
        if (shouldRestart) {
            this._restartPendingTimerIfNeeded(targetChatId);
        }
    }

    _isPendingChatSendable(chatId = null) {
        const safeChatId = String(chatId || '').trim();
        if (!safeChatId) return false;

        // 当前会话正在发送时，禁止进入“等待回复(黄灯)”分支，避免覆盖发送中红灯。
        if (this.isSending && String(this._activeSendingChatId || '').trim() === safeChatId) {
            return false;
        }

        return !this._isComposingInCurrentChat(safeChatId);
    }

    _closeEmojiPanelAndRestoreInputCaret(caretPos = null) {
        const restore = () => {
            const currentView = this.getCurrentWechatView ? this.getCurrentWechatView() : document;
            const input = currentView.querySelector('#chat-input') || document.getElementById('chat-input');
            if (!input) return;
            input.value = this.inputText;
            input.focus();
            const end = input.value.length;
            const targetPos = Number.isFinite(Number(caretPos))
                ? Math.max(0, Math.min(end, Number(caretPos)))
                : end;
            if (typeof input.setSelectionRange === 'function') {
                input.setSelectionRange(targetPos, targetPos);
            }
        };

        if (this.showEmoji) {
            this.showEmoji = false;
            this._setCustomEmojiSelectionMode(false);
            this.app.render();
            setTimeout(restore, 0);
            return;
        }

        restore();
    }

    _closeActionPanelsAfterImmediateSend() {
        const shouldRender = this.showEmoji || this.showMore || this.showQuickReplies || this.customEmojiSelectionMode;
        this.showEmoji = false;
        this.showMore = false;
        this.showQuickReplies = false;
        this._setCustomEmojiSelectionMode(false);
        if (shouldRender) {
            this.app.render();
        }
    }

    _renderChatSendButtonIcon(mode = 'send') {
        if (mode === 'stop') {
            return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>';
        }
        if (mode === 'more') {
            return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
        }
        return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
    }

    _syncChatSendButton(input = null) {
        const currentView = this.getCurrentWechatView ? this.getCurrentWechatView() : document;
        const targetInput = input || currentView.querySelector('#chat-input') || document.getElementById('chat-input');
        const button = currentView.querySelector('#send-btn') || document.getElementById('send-btn');
        if (!button) return;
        const targetChatId = String(this.app?.currentChat?.id || '').trim();
        const isCurrentChatSending = this.isSending && String(this._activeSendingChatId || '') === targetChatId;
        const text = String(targetInput?.value ?? this.inputText ?? '').trim();
        const isInputFocused = !!targetInput && document.activeElement === targetInput;
        const mode = isCurrentChatSending ? 'stop' : ((text || isInputFocused) ? 'send' : 'more');
        if (button.dataset.mode === mode) return;
        button.dataset.mode = mode;
        button.innerHTML = this._renderChatSendButtonIcon(mode);
        button.style.color = mode === 'stop' ? '#ff3b30' : (mode === 'send' ? '#07c160' : '#555');
    }

    _insertTextIntoChatInput(text = '') {
        const insertText = String(text || '');
        if (!insertText) return;

        const currentView = this.getCurrentWechatView ? this.getCurrentWechatView() : document;
        const input = currentView.querySelector('#chat-input') || document.getElementById('chat-input');
        const source = String(input?.value ?? this.inputText ?? '');
        const start = input && Number.isInteger(input.selectionStart) ? input.selectionStart : source.length;
        const end = input && Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
        const insertStart = Math.max(0, Math.min(source.length, start));
        const insertEnd = Math.max(insertStart, Math.min(source.length, end));
        const nextText = `${source.slice(0, insertStart)}${insertText}${source.slice(insertEnd)}`;
        this.inputText = nextText;

        if (input) {
            input.value = nextText;
            input.focus();
            const nextCaret = insertStart + insertText.length;
            if (typeof input.setSelectionRange === 'function') {
                input.setSelectionRange(nextCaret, nextCaret);
            }
            this._syncChatSendButton(input);
        }
    }

    resetTransientInputPanels() {
        this.showEmoji = false;
        this.showMore = false;
        this.showQuickReplies = false;
        this._setCustomEmojiSelectionMode(false);
    }

    _setCustomEmojiSelectionMode(enabled = false) {
        this.customEmojiSelectionMode = !!enabled;
        if (!this.customEmojiSelectionMode) {
            this.selectedCustomEmojiIds.clear();
        }
    }

    _toggleCustomEmojiSelection(emojiId) {
        const safeId = String(emojiId || '').trim();
        if (!safeId) return;
        if (this.selectedCustomEmojiIds.has(safeId)) {
            this.selectedCustomEmojiIds.delete(safeId);
        } else {
            this.selectedCustomEmojiIds.add(safeId);
        }
    }

    _syncCustomEmojiSelectionWithData() {
        const existingIds = new Set((this.app.wechatData.getCustomEmojis() || []).map(e => String(e?.id || '').trim()).filter(Boolean));
        this.selectedCustomEmojiIds.forEach(id => {
            if (!existingIds.has(id)) {
                this.selectedCustomEmojiIds.delete(id);
            }
        });
    }

    _toggleSelectAllCustomEmojis() {
        const emojis = this.app.wechatData.getCustomEmojis() || [];
        const ids = emojis.map(e => String(e?.id || '').trim()).filter(Boolean);
        if (ids.length === 0) {
            this.selectedCustomEmojiIds.clear();
            return;
        }
        const allSelected = ids.every(id => this.selectedCustomEmojiIds.has(id));
        if (allSelected) {
            this.selectedCustomEmojiIds.clear();
            return;
        }
        this.selectedCustomEmojiIds = new Set(ids);
    }

    async _deleteCustomEmojiSet(emojiIdList = [], { clearAll = false } = {}) {
        const ids = Array.from(new Set((emojiIdList || []).map(id => String(id || '').trim()).filter(Boolean)));
        if (ids.length === 0) {
            this.app.phoneShell.showNotification('提示', '请先选择要删除的表情', '⚠️');
            return;
        }

        const allCustomEmojis = this.app.wechatData.getCustomEmojis() || [];
        const targetEmojis = allCustomEmojis.filter(e => ids.includes(String(e?.id || '').trim()));
        if (targetEmojis.length === 0) {
            this.app.phoneShell.showNotification('提示', '未找到可删除的表情', '⚠️');
            return;
        }

        const confirmText = clearAll
            ? `确定清空全部 ${targetEmojis.length} 张自定义表情吗？`
            : `确定删除已选中的 ${targetEmojis.length} 张自定义表情吗？`;
        if (!window.confirm(confirmText)) return;

        const imageManager = window.VirtualPhone?.imageManager;
        let fileCleanupFailedCount = 0;
        for (const emoji of targetEmojis) {
            if (!imageManager?.deleteManagedBackgroundByPath) continue;
            try {
                const result = await imageManager.deleteManagedBackgroundByPath(emoji.image, { quiet: true });
                if (result?.attempted === true && result?.success !== true) {
                    fileCleanupFailedCount += 1;
                }
            } catch (e) {
                fileCleanupFailedCount += 1;
            }
        }

        ids.forEach(id => this.app.wechatData.deleteCustomEmoji(id));
        this._setCustomEmojiSelectionMode(false);
        this._syncCustomEmojiSelectionWithData();

        const deletedCount = targetEmojis.length;
        if (fileCleanupFailedCount > 0) {
            this.app.phoneShell.showNotification('已删除', `已删除 ${deletedCount} 张（${fileCleanupFailedCount} 张旧图清理失败）`, '⚠️');
        } else {
            this.app.phoneShell.showNotification('已删除', `已删除 ${deletedCount} 张自定义表情`, '🗑️');
        }
        this.app.render();
    }

    getHeaderStatusDotColor(chatId = null) {
        const safeChatId = String(chatId || this.app.currentChat?.id || '').trim();
        if (!safeChatId) return 'green';

        if (this.isSending && String(this._activeSendingChatId || '').trim() === safeChatId) {
            return 'red';
        }

        if (this._hasPendingChat(safeChatId)) {
            if (!this._isPendingChatSendable(safeChatId)) {
                return 'green';
            }
            return 'yellow';
        }

        return 'green';
    }

    getHeaderStatusDotClass(chatId = null) {
        const color = this.getHeaderStatusDotColor(chatId);
        if (color === 'red') return 'dot-red';
        if (color === 'yellow') return 'dot-yellow';
        return 'dot-green';
    }

    _getGlobalTtsVoice() {
        return this._getGlobalTtsVoiceConfig().voice;
    }

    _getGlobalTtsVoiceConfig() {
        const storage = window.VirtualPhone?.storage;
        const provider = String(storage?.get?.('phone-tts-provider') || 'minimax_cn').trim() || 'minimax_cn';
        const scopedVoice = String(storage?.get?.(`phone-tts-${provider}-voice`) || '').trim();
        if (scopedVoice) return { provider, voice: scopedVoice, source: 'global' };
        if (provider !== 'volcengine') {
            return {
                provider,
                voice: String(storage?.get?.('phone-tts-voice') || '').trim(),
                source: 'global'
            };
        }
        return { provider, voice: '', source: 'global' };
    }

    _normalizeTtsGender(gender = '') {
        const raw = String(gender || '').trim().toLowerCase();
        if (raw === 'male' || raw === 'm' || raw === '男') return 'male';
        if (raw === 'female' || raw === 'f' || raw === '女') return 'female';
        return '';
    }

    _getGenderFallbackTtsVoice(gender = '') {
        const storage = window.VirtualPhone?.storage;
        const safeGender = this._normalizeTtsGender(gender);
        const globalConfig = this._getGlobalTtsVoiceConfig();
        if (!safeGender) return globalConfig;

        const provider = String(storage?.get?.(`phone-tts-fallback-${safeGender}-provider`) || globalConfig.provider || 'minimax_cn').trim() || 'minimax_cn';
        const voice = String(storage?.get?.(`phone-tts-fallback-${safeGender}-voice`) || '').trim();
        if (voice) {
            return { provider, voice, source: `fallback_${safeGender}` };
        }
        return globalConfig;
    }

    _buildWechatTtsCacheKey({ messageId = '', provider = '', voice = '', text = '' } = {}) {
        return [
            String(messageId || '').trim(),
            String(provider || '').trim(),
            String(voice || '').trim(),
            String(text || '').trim()
        ].join('\u001f');
    }

    _touchWechatTtsCacheKey(cacheKey = '') {
        if (!cacheKey) return;
        this._wechatTtsCacheOrder = this._wechatTtsCacheOrder.filter(key => key !== cacheKey);
        this._wechatTtsCacheOrder.push(cacheKey);
    }

    _storeWechatTtsCache(cacheKey = '', blobUrl = '') {
        if (!cacheKey || !blobUrl) return;
        const existed = this._wechatTtsCache.get(cacheKey);
        if (existed && existed !== blobUrl) {
            try { URL.revokeObjectURL(existed); } catch (e) { /* ignore */ }
        }
        this._wechatTtsCache.set(cacheKey, blobUrl);
        this._touchWechatTtsCacheKey(cacheKey);

        while (this._wechatTtsCacheOrder.length > this._wechatTtsCacheLimit) {
            const oldKey = this._wechatTtsCacheOrder.shift();
            const oldUrl = this._wechatTtsCache.get(oldKey);
            this._wechatTtsCache.delete(oldKey);
            if (oldUrl) {
                try { URL.revokeObjectURL(oldUrl); } catch (e) { /* ignore */ }
            }
        }
    }

    _resolveWechatBoundVoiceByName(name, { allowGlobalFallback = false, allowGenderFallback = false } = {}) {
        const wechatData = this.app?.wechatData;
        const resolved = wechatData?.resolveTtsVoiceByName?.(name, { includeChats: true }) || null;
        const voice = String(resolved?.voice || '').trim();
        if (voice) {
            return {
                voice,
                provider: String(resolved?.provider || '').trim(),
                contact: resolved.contact || null,
                source: 'bound'
            };
        }

        if (allowGenderFallback) {
            const resolvedContact = resolved?.contact || null;
            const looseContact = wechatData?.findContactByNameLoose?.(name, { includeChats: true }) || null;
            const currentChat = this.app?.currentChat || null;
            const genderCandidates = [
                resolvedContact?.gender,
                looseContact?.gender,
                wechatData?.getContactGender?.(resolvedContact?.id || ''),
                wechatData?.getContactGender?.(resolvedContact?.name || ''),
                wechatData?.getContactGender?.(looseContact?.id || ''),
                wechatData?.getContactGender?.(looseContact?.name || ''),
                wechatData?.getContactGender?.(name || ''),
                wechatData?.getContactGender?.(currentChat?.contactId || ''),
                wechatData?.getContactGender?.(currentChat?.name || '')
            ];
            const gender = this._normalizeTtsGender(
                genderCandidates.find(value => this._normalizeTtsGender(value))
                || ''
            );
            const fallback = this._getGenderFallbackTtsVoice(gender);
            return {
                voice: String(fallback.voice || '').trim(),
                provider: String(fallback.provider || resolved?.provider || '').trim(),
                contact: resolvedContact || looseContact || null,
                source: fallback.source || 'global'
            };
        }

        if (allowGlobalFallback) {
            const fallback = this._getGlobalTtsVoiceConfig();
            return {
                voice: fallback.voice,
                provider: fallback.provider,
                contact: resolved?.contact || null,
                source: fallback.source
            };
        }

        return {
            voice: '',
            provider: String(resolved?.provider || '').trim(),
            contact: resolved?.contact || null
        };
    }

    _getMissingVoiceWarnKey(senderName = '', { scene = 'chat' } = {}) {
        const safeScene = String(scene || 'chat').trim().toLowerCase() || 'chat';
        const chatId = String(this.app?.currentChat?.id || '').trim() || 'unknown';
        const normalizedSender = String(senderName || '')
            .trim()
            .replace(/\s+/g, ' ')
            .toLowerCase() || 'unknown';
        return `${safeScene}:${chatId}:${normalizedSender}`;
    }

    _clearMissingBoundVoiceWarn(senderName = '', options = {}) {
        const key = this._getMissingVoiceWarnKey(senderName, options);
        this._missingBoundVoiceWarned?.delete(key);
    }

    _notifyMissingBoundVoiceOnce(senderName = '', { scene = 'chat' } = {}) {
        const key = this._getMissingVoiceWarnKey(senderName, { scene });
        if (this._missingBoundVoiceWarned?.has(key)) {
            return false;
        }
        this._missingBoundVoiceWarned?.add(key);
        const safeSender = String(senderName || '').trim() || '当前联系人';
        const title = scene === 'call' ? '静音警告' : '无法播放';
        const message = scene === 'call'
            ? `[${safeSender}] 未绑定专属音色，且没有可用的全局兜底音色`
            : `请先在通讯录编辑[${safeSender}]绑定音色，或在设置里填写全局兜底音色`;
        this.app?.phoneShell?.showNotification(title, message, '⚠️');
        return true;
    }

    _formatErrorForLog(error, fallback = '未知错误') {
        if (error === undefined || error === null) return fallback;
        if (typeof error === 'string') return error || fallback;
        if (typeof error === 'number' || typeof error === 'boolean') return String(error);

        const parts = [];
        const name = String(error?.name || '').trim();
        const message = String(error?.message || '').trim();
        const status = error?.status || error?.statusCode || error?.code || '';
        const statusText = String(error?.statusText || '').trim();

        if (name) parts.push(name);
        if (message) parts.push(message);
        if (status || statusText) parts.push(`status=${status || '?'}${statusText ? ` ${statusText}` : ''}`);

        try {
            const json = JSON.stringify(error);
            if (json && json !== '{}' && !parts.includes(json)) parts.push(json);
        } catch (_e) {
            // ignore
        }

        const causeText = error?.cause ? this._formatErrorForLog(error.cause, '') : '';
        if (causeText) parts.push(`cause=${causeText}`);

        return parts.filter(Boolean).join(' | ') || fallback;
    }

    _escapeRegExp(text) {
        return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    _getGroupChatParticipants(chat = null) {
        const targetChat = chat || this.app.currentChat;
        if (!targetChat || targetChat.type !== 'group') return [];

        const names = [];
        const seen = new Set();
        const pushName = (rawName) => {
            const name = String(rawName || '').trim();
            if (!name || name === 'me' || name === 'system' || seen.has(name)) return;
            seen.add(name);
            names.push(name);
        };

        (targetChat.members || []).forEach(pushName);

        try {
            const messages = this.app.wechatData.getMessages(targetChat.id) || [];
            messages.forEach(msg => pushName(msg?.from));
        } catch (e) {
            // ignore
        }

        return names;
    }

    async _getHoneyHostSummaryForWechatContact(contact = {}) {
        const hostName = String(contact?.honeyHostName || contact?.honeySource || contact?.name || '').trim();
        if (!hostName) return '';
        try {
            const mod = await import('../honey/honey-data.js');
            const HoneyData = mod?.HoneyData;
            if (!HoneyData) return '';
            const honeyData = window.VirtualPhone?.honeyApp?.honeyData || new HoneyData(this.app.storage || window.VirtualPhone?.storage);
            const summary = honeyData.getHostHistorySummary?.(hostName);
            if (typeof honeyData.formatHostHistorySummaryForContext === 'function') {
                return honeyData.formatHostHistorySummaryForContext(summary);
            }
            return String(summary?.text || '').trim();
        } catch (error) {
            console.warn('[Wechat] 读取蜜语记录总结失败:', error);
            return '';
        }
    }

    _isHoneyHostWechatContact(contact = {}) {
        if (!contact || typeof contact !== 'object') return false;
        const sourceApp = String(contact?.sourceApp || contact?.extra?.sourceApp || '').trim().toLowerCase();
        const sourceLabel = String(contact?.sourceLabel || contact?.extra?.sourceLabel || '').trim();
        const relation = String(contact?.relation || '').trim();
        const hostName = String(contact?.honeyHostName || contact?.extra?.honeyHostName || '').trim();
        return sourceApp === 'honey'
            && (sourceLabel === '主播' || relation.includes('主播') || !!hostName);
    }

    _resolveHoneyHostContactByMemberName(memberName = '', contacts = []) {
        const rawName = String(memberName || '').trim();
        const memberKey = this._normalizeLookupName(rawName);
        if (!rawName || !memberKey) return null;

        const direct = this.app.wechatData?.findContactByNameLoose?.(rawName, { includeChats: false });
        if (this._isHoneyHostWechatContact(direct)) return direct;

        const list = Array.isArray(contacts) ? contacts : [];
        const getKeys = (contact) => [
            contact?.name,
            contact?.remark,
            contact?.honeyHostName,
            contact?.extra?.honeyHostName,
            contact?.honeySource,
            contact?.extra?.honeySource
        ].map(value => this._normalizeLookupName(value)).filter(Boolean);

        return list.find(contact => this._isHoneyHostWechatContact(contact)
            && getKeys(contact).some(key => key === memberKey))
            || list.find(contact => this._isHoneyHostWechatContact(contact)
                && getKeys(contact).some(key => key.includes(memberKey) || memberKey.includes(key)))
            || null;
    }

    async _buildGroupHoneyHostSummaryMessage(targetChat = null, groupMembersArray = []) {
        if (!targetChat || targetChat.type !== 'group') return null;
        const contacts = this.app.wechatData?.getContacts?.() || [];
        const memberNames = [];
        const memberSeen = new Set();
        const pushMember = (value) => {
            const name = String(value || '').trim();
            const key = this._normalizeLookupName(name);
            if (!name || !key || key === 'me' || key === 'system' || memberSeen.has(key)) return;
            memberSeen.add(key);
            memberNames.push(name);
        };

        (Array.isArray(groupMembersArray) ? groupMembersArray : []).forEach(pushMember);
        (Array.isArray(targetChat.members) ? targetChat.members : []).forEach(pushMember);
        this._getGroupChatParticipants(targetChat).forEach(pushMember);

        const entries = [];
        const byHostKey = new Map();
        const bySummaryKey = new Map();
        for (const memberName of memberNames) {
            const contact = this._resolveHoneyHostContactByMemberName(memberName, contacts);
            if (!contact) continue;

            const hostName = String(contact?.honeyHostName || contact?.extra?.honeyHostName || contact?.honeySource || contact?.name || memberName).trim();
            const hostKey = this._normalizeLookupName(hostName);
            if (!hostName || !hostKey) continue;

            let entry = byHostKey.get(hostKey);
            if (!entry) {
                const summary = await this._getHoneyHostSummaryForWechatContact(contact);
                if (!summary) continue;

                const summaryKey = this._normalizeLookupName(summary);
                entry = summaryKey ? bySummaryKey.get(summaryKey) : null;
                if (!entry) {
                    entry = { hostName, summary, memberNames: [] };
                    entries.push(entry);
                    if (summaryKey) bySummaryKey.set(summaryKey, entry);
                }
                byHostKey.set(hostKey, entry);
            }

            const displayName = String(contact?.name || memberName || '').trim();
            const memberLabel = displayName && displayName !== hostName
                ? `${memberName} / ${displayName}`
                : memberName;
            if (memberLabel && !entry.memberNames.includes(memberLabel)) {
                entry.memberNames.push(memberLabel);
            }
        }

        if (entries.length === 0) return null;
        const lines = [
            '【群内蜜语主播总结】',
            '以下微信群成员是蜜语主播；对应直播间总结会影响这些成员在当前群聊里的关系背景和发言，不要逐字复述。'
        ];
        entries.forEach(entry => {
            const memberText = entry.memberNames.length > 0 ? `（群成员：${entry.memberNames.join('、')}）` : '';
            lines.push(`━━━ ${entry.hostName}${memberText} ━━━`);
            lines.push(entry.summary);
            lines.push('');
        });

        return {
            role: 'system',
            content: lines.join('\n').trim(),
            name: 'SYSTEM (群内蜜语主播总结)',
            isPhoneMessage: true
        };
    }

    clearTtsCache({ keepRecent = 0 } = {}) {
        const keepCount = Math.max(0, Number.parseInt(keepRecent, 10) || 0);
        const keepKeys = new Set(keepCount > 0 ? this._wechatTtsCacheOrder.slice(-keepCount) : []);
        this._wechatTtsCache.forEach((blobUrl, key) => {
            if (keepKeys.has(key)) return;
            if (blobUrl) {
                try { URL.revokeObjectURL(blobUrl); } catch (e) { /* ignore */ }
            }
            this._wechatTtsCache.delete(key);
        });
        this._wechatTtsCacheOrder = this._wechatTtsCacheOrder.filter(key => this._wechatTtsCache.has(key));
    }

    releaseInactiveResources() {
        if (this.audioPlayer) {
            try {
                this.audioPlayer.pause();
                this.audioPlayer.removeAttribute('src');
                this.audioPlayer.load?.();
            } catch (e) { /* ignore */ }
        }
        this.currentPlayingMsgId = null;
        this.currentPlayingCallMsgId = null;
        this.currentTtsRound = null;
        this.clearTtsCache({ keepRecent: 6 });
        this.app?.wechatData?.releaseLoadedMessages?.({
            keepChatIds: [this.app?.currentChat?.id].filter(Boolean)
        });
    }

    _collectGroupParticipantsForFilter(chat = null, context = null) {
        const targetChat = chat || this.app.currentChat;
        if (!targetChat || targetChat.type !== 'group') return [];

        const names = [];
        const seen = new Set();
        const normalizeKey = (value) => this._normalizeLookupName(value);
        const pushName = (rawName) => {
            const raw = String(rawName || '').trim();
            if (!raw || raw === 'me' || raw === 'system') return;

            const contactById = this.app.wechatData?.getContact?.(raw);
            const contactByName = this.app.wechatData?.findContactByNameLoose?.(raw, { includeChats: false });
            const candidates = [
                contactById?.name,
                contactByName?.name,
                raw
            ];

            candidates.forEach((candidate) => {
                const name = String(candidate || '').trim();
                const key = normalizeKey(name);
                if (!name || !key || key === 'me' || key === 'system' || seen.has(key)) return;
                seen.add(key);
                names.push(name);
            });
        };

        (Array.isArray(targetChat.members) ? targetChat.members : []).forEach(pushName);
        this._getGroupChatParticipants(targetChat).forEach(pushName);

        const lobbySelection = this._buildLobbySelection(context || this._safeGetContext());
        if (lobbySelection?.isLobby) {
            const groupKey = normalizeKey(targetChat.name);
            const existingMemberKeys = new Set(names.map(item => normalizeKey(item)).filter(Boolean));

            (lobbySelection.groups || []).forEach((group) => {
                const groupNameKey = normalizeKey(group?.name);
                const groupMembers = Array.isArray(group?.members) ? group.members : [];
                const memberKeys = groupMembers.map(item => normalizeKey(item)).filter(Boolean);
                const isCurrentGroup = groupKey && groupNameKey && groupNameKey === groupKey;
                const overlapsSavedMembers = memberKeys.some(key => existingMemberKeys.has(key));
                const onlySelectedPersonaGroup = String(group?.id || '').startsWith('group_persona:');

                if (isCurrentGroup || overlapsSavedMembers || onlySelectedPersonaGroup) {
                    groupMembers.forEach(pushName);
                }
            });

            (lobbySelection.characters || []).forEach(character => pushName(character?.name));
            this._resolveLobbySelectedUsers(lobbySelection).forEach(pushName);
        }

        return names;
    }

    _normalizeGroupParticipantName(name, participants = []) {
        const rawName = String(name || '').trim();
        if (!rawName) return '';
        if (participants.includes(rawName)) return rawName;

        const contact = this.app.wechatData?.findContactByNameLoose?.(rawName, { includeChats: true });
        const contactName = String(contact?.name || '').trim();
        if (contactName && participants.includes(contactName)) return contactName;

        const normalize = (value) => String(value || '')
            .trim()
            .replace(/\s+/g, '')
            .replace(/[（(][^（）()]*[）)]/g, '')
            .toLowerCase();

        const rawKey = normalize(rawName);
        if (!rawKey) return rawName;

        const fuzzy = participants.find(item => {
            const itemKey = normalize(item);
            return itemKey && (itemKey === rawKey || itemKey.includes(rawKey) || rawKey.includes(itemKey));
        });

        return fuzzy || rawName;
    }

    _resolveAllowedGroupSpeaker(name, participants = []) {
        const rawName = String(name || '').trim();
        if (!rawName) return '';
        const allowed = Array.isArray(participants)
            ? participants.map(item => String(item || '').trim()).filter(Boolean)
            : [];
        if (allowed.length === 0) return rawName;
        const normalized = this._normalizeGroupParticipantName(rawName, allowed);
        return allowed.includes(normalized) ? normalized : '';
    }

    _filterGroupMessagesByParticipants(messages = [], participants = [], contextLabel = '群聊', options = {}) {
        const list = Array.isArray(messages) ? messages : [];
        const allowed = Array.isArray(participants)
            ? participants.map(item => String(item || '').trim()).filter(Boolean)
            : [];
        if (allowed.length === 0) return list;

        const dropped = [];
        const filtered = list
            .map((msg) => {
                const sender = this._resolveAllowedGroupSpeaker(msg?.sender, allowed);
                if (!sender) {
                    dropped.push(msg?.sender);
                    return null;
                }
                return { ...msg, sender };
            })
            .filter(Boolean);

        if (dropped.length > 0) {
            const logData = {
                group: contextLabel,
                senders: Array.from(new Set(dropped.map(item => String(item || '').trim()).filter(Boolean))),
                allowed
            };
            if (options.keepAllWhenAllDropped && filtered.length === 0 && list.length > 0) {
                console.warn('⚠️ [微信大厅] 群成员过滤名单不兼容，已保留本轮AI群聊回复:', logData);
                return list;
            }
            console.warn('⚠️ [微信] 已丢弃非群成员发言:', logData);
        }

        return filtered;
    }

    _collectSingleChatAliasesForFilter(chat = null, context = null) {
        const targetChat = chat || this.app.currentChat;
        if (!targetChat || targetChat.type === 'group') return [];

        const aliases = [];
        const seen = new Set();
        const pushAlias = (rawName) => {
            const name = String(rawName || '').trim();
            const key = this._normalizeLookupName(name);
            if (!name || !key || seen.has(key)) return;
            seen.add(key);
            aliases.push(name);
        };

        pushAlias(targetChat.name);
        pushAlias(targetChat.contactId);

        const contactById = targetChat.contactId ? this.app.wechatData?.getContact?.(targetChat.contactId) : null;
        const contactByName = this.app.wechatData?.findContactByNameLoose?.(targetChat.name, { includeChats: false });
        pushAlias(contactById?.name);
        pushAlias(contactByName?.name);
        pushAlias(contactById?.remark);
        pushAlias(contactByName?.remark);

        const lobbySelection = this._buildLobbySelection(context || this._safeGetContext());
        if (lobbySelection?.isLobby) {
            const chatKey = this._normalizeLookupName(targetChat.name);
            const matchedCharacters = (lobbySelection.characters || []).filter((character) => {
                const charKey = this._normalizeLookupName(character?.name);
                return chatKey && charKey && (chatKey === charKey || chatKey.includes(charKey) || charKey.includes(chatKey));
            });
            matchedCharacters.forEach(character => pushAlias(character?.name));

            (lobbySelection.groups || []).forEach((group) => {
                const members = Array.isArray(group?.members) ? group.members : [];
                const hasTargetMember = members.some(member => {
                    const memberKey = this._normalizeLookupName(member);
                    return chatKey && memberKey && (memberKey === chatKey || memberKey.includes(chatKey) || chatKey.includes(memberKey));
                });
                if (hasTargetMember) members.forEach(pushAlias);
            });
        }

        return aliases;
    }

    _getCallPromptFeature(callMode, targetChat = null) {
        const chat = targetChat || this.app.currentChat;
        if (chat?.type === 'group') {
            return callMode === 'video' ? 'groupVideoCall' : 'groupVoiceCall';
        }
        return callMode === 'video' ? 'videoCall' : 'voiceCall';
    }

    _extractWechatBlockByName(content, blockName = '') {
        const source = String(content || '').trim();
        const safeName = String(blockName || '').trim();
        if (!source || !safeName || !source.includes('---')) return source;

        const blockRegex = new RegExp(`---${this._escapeRegExp(safeName)}---([\\s\\S]*?)(?=---[^-]+---|$)`, 'i');
        const matched = source.match(blockRegex);
        return matched ? String(matched[1] || '').trim() : source;
    }

    _parseCallReplyEntries(rawText, { contactName = '', participants = [], groupName = '', isGroupCall = false } = {}) {
        const groupCall = isGroupCall === true || (Array.isArray(participants) && participants.length > 0);
        let content = this._extractWechatTagPayloadOrSelf(rawText);
        if (!content) return [];

        if (groupCall) {
            content = this._extractWechatBlockByName(content, groupName);
        }

        const lines = content
            .split(/\|\|\||\n+/)
            .map(line => String(line || '').trim())
            .filter(Boolean);

        const entries = [];
        const fallbackSender = groupCall ? (participants[0] || contactName || '群成员') : (contactName || '对方');
        let pendingSender = '';

        for (let line of lines) {
            if (/^(接听|answer)$/i.test(line)) continue;
            if (/^(拒绝|reject)$/i.test(line)) continue;
            if (/^type[：:]/i.test(line) || /^date[：:]/i.test(line)) continue;

            const senderOnlyMatch = /^([^:：]{1,20})[：:]\s*$/.exec(line);
            if (groupCall && senderOnlyMatch) {
                pendingSender = this._normalizeGroupParticipantName(senderOnlyMatch[1], participants);
                continue;
            }

            let sender = '';
            let text = '';

            const timedGroupMatch = /^\[[0-9A-Za-z:：]+\]\s*([^:：]{1,20})[：:]\s*(.+)$/.exec(line);
            const simpleGroupMatch = /^([^:：]{1,20})[：:]\s*(.+)$/.exec(line);

            if (groupCall && timedGroupMatch) {
                sender = this._normalizeGroupParticipantName(timedGroupMatch[1], participants);
                text = timedGroupMatch[2];
            } else if (groupCall && simpleGroupMatch) {
                sender = this._normalizeGroupParticipantName(simpleGroupMatch[1], participants);
                text = simpleGroupMatch[2];
            } else if (groupCall) {
                sender = pendingSender || fallbackSender;
                text = line;
            } else {
                sender = fallbackSender;
                text = line;
                if (contactName) {
                    const senderPrefixRegex = new RegExp(`^${this._escapeRegExp(contactName)}\\s*[：:]\\s*`);
                    text = text.replace(senderPrefixRegex, '');
                }
            }

            text = String(text || '')
                .replace(/^\[[0-9A-Za-z:：]+\]\s*/, '')
                .replace(/^from\s+\S+[：:]\s*/i, '');
            text = this._stripCallSpeechPrefix(text).trim();
            if (!text) {
                pendingSender = '';
                continue;
            }

            entries.push({
                sender: sender || fallbackSender,
                text
            });
            pendingSender = '';
        }

        return entries;
    }

    _getOnlineOverridePrompt(promptManager, replacements = {}) {
        let text = '';
        try {
            text = promptManager?.getPromptForFeature?.('wechat', 'override') || '';
        } catch (e) {
            console.warn('⚠️ 获取微信破限词失败:', e);
        }
        text = String(text || '').trim();
        if (!text) return '';
        Object.entries(replacements || {}).forEach(([key, value]) => {
            text = text.replace(new RegExp(`\\{\\{${this._escapeRegExp(key)}\\}\\}`, 'g'), String(value ?? ''));
        });
        return text.trim();
    }

    _formatPersonalImageTagRows(rows = []) {
        const normalized = (Array.isArray(rows) ? rows : [])
            .map((item) => {
                const name = String(item?.name || '').trim();
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

    _buildWechatPersonalImageTagInfo({ targetChat = null, isGroupChat = false } = {}) {
        const contacts = this.app?.wechatData?.getContacts?.() || [];
        const userInfo = this.app?.wechatData?.getUserInfo?.() || {};
        const userTags = String(userInfo?.naiPromptTags || userInfo?.imageTags || '').trim();
        const userRow = userTags ? [{ name: '{{user}}', tags: userTags }] : [];
        if (!Array.isArray(contacts) || contacts.length === 0) {
            return this._formatPersonalImageTagRows(userRow);
        }

        if (isGroupChat) {
            const participants = this._collectGroupParticipantsForFilter(targetChat || this.app.currentChat, this._safeGetContext());
            const participantKeys = new Set(participants.map(name => this._normalizeLookupName(name)).filter(Boolean));
            return this._formatPersonalImageTagRows([
                ...userRow,
                ...contacts
                .filter(contact => participantKeys.has(this._normalizeLookupName(contact?.name)))
                .map(contact => ({
                    name: contact?.name,
                    tags: contact?.naiPromptTags || contact?.imageTags
                }))
            ]);
        }

        const chatName = String(targetChat?.name || '').trim();
        const contactId = String(targetChat?.contactId || '').trim();
        const contact = (contactId ? this.app.wechatData?.getContact?.(contactId) : null)
            || this.app.wechatData?.findContactByNameLoose?.(chatName, { includeChats: false })
            || contacts.find(item => this._normalizeLookupName(item?.name) === this._normalizeLookupName(chatName));
        return this._formatPersonalImageTagRows([
            ...userRow,
            ...(contact ? [{
                name: contact.name || chatName,
                tags: contact.naiPromptTags || contact.imageTags
            }] : [])
        ]);
    }

    _renderGroupCallParticipantsStrip(chat = null) {
        const targetChat = chat || this.app.currentChat;
        if (!targetChat || targetChat.type !== 'group') return '';

        const userInfo = this.app.wechatData.getUserInfo?.() || {};
        const members = this._getGroupChatParticipants(targetChat);
        const participantItems = [
            {
                name: userInfo.name || '我',
                avatar: userInfo.avatar || '',
                isSelf: true
            },
            ...members.map(name => ({
                name,
                avatar: this.app.wechatData.findContactByNameLoose?.(name, { includeChats: true })?.avatar || ''
            }))
        ].slice(0, 8);

        return `
            <div style="display:flex; gap:8px; overflow-x:auto; padding:6px 0 2px; -ms-overflow-style:none; scrollbar-width:none;">
                ${participantItems.map(item => `
                    <div style="display:flex; flex-direction:column; align-items:center; min-width:44px; flex-shrink:0;">
                        <div class="call-avatar-fix" style="width:34px; height:34px; border-radius:50%; overflow:hidden; background:rgba(255,255,255,0.72); box-shadow:0 2px 8px rgba(0,0,0,0.08);">
                            ${this.app.renderAvatar(item.avatar, item.isSelf ? '😊' : '👤', item.name)}
                        </div>
                        <div style="margin-top:4px; font-size:9px; color:rgba(0,0,0,0.58); max-width:52px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.name}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    _restartPendingTimerIfNeeded(preferredChatId = null) {
        if (!this.isOnlineMode() || this.pendingChatIds.size === 0) {
            clearTimeout(this.batchTimer);
            return;
        }

        const pendingIds = Array.from(this.pendingChatIds || []).map(id => String(id || '').trim()).filter(Boolean);
        const sendableIds = pendingIds.filter(id => this._isPendingChatSendable(id));
        clearTimeout(this.batchTimer);
        if (sendableIds.length === 0) {
            this.hideTypingStatus();
            return;
        }

        this.batchTimer = setTimeout(() => this.triggerAI(), 6000);
        const visibleChatId = String(preferredChatId || this.app.currentChat?.id || '').trim();
        if (visibleChatId && this.pendingChatIds.has(visibleChatId)) {
            if (this._isPendingChatSendable(visibleChatId)) {
                this.showTypingStatus('等待回复', visibleChatId);
            } else {
                this.hideTypingStatus();
            }
        }
    }

    _resetAiReplyTimeCursor() {
        this._aiReplyTimeCursor = null;
        this._aiReplyTimestampCursor = null;
    }

    _formatWechatTimeFromTimestamp(timestamp) {
        const dateObj = new Date(Number(timestamp || 0));
        if (!Number.isFinite(dateObj.getTime())) return '';
        return `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;
    }

    _formatWechatDateFromTimestamp(timestamp) {
        const dateObj = new Date(Number(timestamp || 0));
        if (!Number.isFinite(dateObj.getTime())) return '';
        return `${dateObj.getFullYear()}年${String(dateObj.getMonth() + 1).padStart(2, '0')}月${String(dateObj.getDate()).padStart(2, '0')}日`;
    }

    _normalizeWechatDateDisplay(dateText = '') {
        return String(dateText || '').replace(/^0+(\d{1,6}年)/, '$1');
    }

    _parseManualTimeAdvanceCommand(text = '') {
        const raw = String(text || '').trim();
        const match = raw.match(/^\[\s*时间推进\s*[：:]\s*([^\]]+?)\s*\]$/);
        if (!match) return null;

        const payload = String(match[1] || '').trim();
        const parsed = window.VirtualPhone?.timeManager?.parseStatusbar?.(payload);
        if (!parsed?.time || !parsed?.date) return null;

        const timestamp = typeof window.VirtualPhone?.timeManager?.parseTimeToTimestamp === 'function'
            ? window.VirtualPhone.timeManager.parseTimeToTimestamp(parsed)
            : (Number(parsed.timestamp) || Date.now());

        return {
            time: parsed.time,
            date: parsed.date,
            weekday: parsed.weekday || window.VirtualPhone?.timeManager?.calculateWeekday?.(parsed.date) || '星期一',
            timestamp: Number.isFinite(Number(timestamp)) ? Number(timestamp) : Date.now()
        };
    }

    _handleManualTimeAdvance(input, text, targetChatId) {
        const parsedTime = this._parseManualTimeAdvanceCommand(text);
        if (!parsedTime || !targetChatId) return false;

        const timeManager = window.VirtualPhone?.timeManager;
        if (typeof timeManager?.setTime === 'function') {
            timeManager.setTime(parsedTime.time, parsedTime.date, parsedTime.weekday, { force: true });
            window.VirtualPhone?.checkCalendarScheduleReminders?.(timeManager.getCurrentStoryTime?.() || parsedTime);
        }

        this.app.wechatData.addMessage(targetChatId, {
            from: 'system',
            type: 'time_marker',
            content: '',
            time: parsedTime.time,
            date: parsedTime.date,
            weekday: parsedTime.weekday,
            timestamp: parsedTime.timestamp,
            isTimeMarker: true,
            hiddenFromPrompt: true,
            hiddenFromPreview: true
        });

        input.value = '';
        this.inputText = '';
        this.activeQuote = null;

        const quoteBar = document.querySelector('.active-quote-bar');
        if (quoteBar) quoteBar.remove();

        const messages = this.app.wechatData.getMessages(targetChatId);
        const userInfo = this.app.wechatData.getUserInfo();
        this.smartUpdateMessages(messages, userInfo, { chatId: targetChatId });

        this.app.phoneShell?.updateStatusBarTime?.();
        window.VirtualPhone?.home?.render?.({ forceDomRefresh: true });
        return true;
    }

    _getWechatWeekdayFromTimestamp(timestamp, fallback = '星期一') {
        const dateObj = new Date(Number(timestamp || 0));
        if (!Number.isFinite(dateObj.getTime())) return fallback || '星期一';
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        return weekdays[dateObj.getDay()] || fallback || '星期一';
    }

    _getWechatReplySecondsToAdd(content = '', { isFirstInReplyBatch = false } = {}) {
        const text = String(content || '').replace(/\s+/g, '').trim();
        if (isFirstInReplyBatch) {
            return text.length <= 12 ? 6 + Math.floor(Math.random() * 10) : 12 + Math.floor(Math.random() * 18);
        }
        if (!text) return 3 + Math.floor(Math.random() * 4);
        const readingSeconds = Math.ceil(text.length * 0.9);
        const randomThinkSeconds = 3 + Math.floor(Math.random() * 8);
        return Math.max(4, Math.min(55, readingSeconds + randomThinkSeconds));
    }

    _isShortWechatReplyForTimeline(content = '') {
        const text = String(content || '').replace(/\s+/g, '').trim();
        if (!text) return false;

        const timeManager = window.VirtualPhone?.timeManager;
        if (typeof timeManager?.getWechatMessageMinutesToAdd === 'function') {
            const minutes = Number(timeManager.getWechatMessageMinutesToAdd(text, { inBatch: true }));
            if (Number.isFinite(minutes)) {
                return minutes <= 0;
            }
        }

        return text.length <= 12;
    }

    _buildShortWechatReplyGapMap(messageList = []) {
        const extras = new Map();
        if (!Array.isArray(messageList) || messageList.length <= 2) {
            return extras;
        }

        const flushRun = (runIndexes) => {
            if (runIndexes.length <= 2) return;
            for (let i = 2; i < runIndexes.length; i++) {
                const targetIndex = runIndexes[i];
                const randomExtraMinutes = 1 + Math.floor(Math.random() * 3); // 1~3分钟随机分散
                extras.set(targetIndex, randomExtraMinutes);
            }
        };

        let shortRun = [];
        for (let i = 0; i < messageList.length; i++) {
            const msg = messageList[i] || {};
            const cleanContent = this.cleanAbnormalSpaces(msg.content);
            const normalizedTextContent = this._stripCallSpeechPrefix(cleanContent);
            const special = msg.specialMessage || this.parseSpecialMessage(cleanContent);
            const isShortTextReply = !special && this._isShortWechatReplyForTimeline(normalizedTextContent);

            if (isShortTextReply) {
                shortRun.push(i);
            } else {
                flushRun(shortRun);
                shortRun = [];
            }
        }
        flushRun(shortRun);
        return extras;
    }

    _applyAiReplyTimeline(messageObj, fallbackContent = '', options = {}) {
        if (!messageObj || typeof messageObj !== 'object') return;

        const contentText = String(messageObj.content || fallbackContent || '').trim();
        if (options?.realTimeMode === true) {
            let baseTimestamp = Number(this._aiReplyTimestampCursor || options?.baseTimestamp || Date.now());
            if (!Number.isFinite(baseTimestamp) || baseTimestamp <= 0) baseTimestamp = Date.now();

            let minutesToAdd = contentText.length <= 12 ? 0 : 1;
            const isFirstInReplyBatch = options?.isFirstInReplyBatch === true;
            if (isFirstInReplyBatch) {
                const startedAt = Number(this._aiReplyRequestStartedAt || 0);
                if (Number.isFinite(startedAt) && startedAt > 0) {
                    const waitedMs = Math.max(0, Date.now() - startedAt);
                    if (waitedMs > 60 * 1000) messageObj.forceTimeDivider = true;
                    minutesToAdd = Math.max(minutesToAdd, Math.max(0, Math.floor(waitedMs / (60 * 1000))));
                }
            }

            minutesToAdd += Math.max(0, Number(options?.extraGapMinutes) || 0);
            let nextTimestamp = baseTimestamp + (Math.max(0, minutesToAdd) * 60 * 1000);
            nextTimestamp += this._getWechatReplySecondsToAdd(contentText, { isFirstInReplyBatch }) * 1000;

            messageObj.time = this._formatWechatTimeFromTimestamp(nextTimestamp) || messageObj.time;
            messageObj.date = messageObj.date || this._formatWechatDateFromTimestamp(nextTimestamp);
            messageObj.weekday = messageObj.weekday || this._getWechatWeekdayFromTimestamp(nextTimestamp, '');
            messageObj.timestamp = nextTimestamp;
            messageObj.realTimestamp = Date.now();
            this._aiReplyTimestampCursor = nextTimestamp;
            this._aiReplyTimeCursor = {
                time: messageObj.time,
                date: messageObj.date,
                weekday: messageObj.weekday,
                timestamp: nextTimestamp
            };
            return;
        }

        const timeManager = window.VirtualPhone?.timeManager;
        if (!timeManager?.getCurrentStoryTime) return;

        let cursor = this._aiReplyTimeCursor || timeManager.getCurrentStoryTime();
        if (!cursor?.time || !cursor?.date) {
            cursor = timeManager.getCurrentStoryTime();
        }
        const cursorTimestamp = Number(this._aiReplyTimestampCursor || cursor.timestamp || 0);
        if (Number.isFinite(cursorTimestamp) && cursorTimestamp > 0) {
            cursor = {
                ...cursor,
                timestamp: cursorTimestamp,
                time: this._formatWechatTimeFromTimestamp(cursorTimestamp) || cursor.time,
                date: this._formatWechatDateFromTimestamp(cursorTimestamp) || cursor.date,
                weekday: this._getWechatWeekdayFromTimestamp(cursorTimestamp, cursor.weekday)
            };
        }

        // 线上微信聊天统一由插件推进时间，忽略 AI 输出的显式时间，避免模型乱算时间造成跳时序。
        const hasExplicitTime = false;
        if (hasExplicitTime) {
            if (!messageObj.date) messageObj.date = cursor?.date || '';
            if (!messageObj.weekday) messageObj.weekday = cursor?.weekday || '';
            if (typeof timeManager.setTime === 'function' && messageObj.date) {
                timeManager.setTime(messageObj.time, messageObj.date, messageObj.weekday || null);
            }
            this._aiReplyTimeCursor = timeManager.getCurrentStoryTime();
            return;
        }

        let minutesToAdd = 1;
        if (typeof timeManager.getWechatMessageMinutesToAdd === 'function') {
            minutesToAdd = timeManager.getWechatMessageMinutesToAdd(contentText, { inBatch: true });
        } else {
            minutesToAdd = contentText.length <= 12 ? 0 : 1;
        }

        const isFirstInReplyBatch = options?.isFirstInReplyBatch === true;
        if (isFirstInReplyBatch) {
            const startedAt = Number(this._aiReplyRequestStartedAt || 0);
            if (Number.isFinite(startedAt) && startedAt > 0) {
                const waitedMs = Math.max(0, Date.now() - startedAt);
                if (waitedMs > 60 * 1000) {
                    // 首条回复等待超过 1 分钟时，强制显示时间胶囊（渲染层识别）
                    messageObj.forceTimeDivider = true;
                }
                const waitedMinutes = Math.max(0, Math.floor(waitedMs / (60 * 1000)));
                minutesToAdd = Math.max(minutesToAdd, waitedMinutes);
            }
        }
        const extraGapMinutes = Math.max(0, Number(options?.extraGapMinutes) || 0);
        if (extraGapMinutes > 0) {
            minutesToAdd += extraGapMinutes;
        }
        minutesToAdd = Math.max(0, Number(minutesToAdd) || 0);

        let nextTime = cursor;
        if (typeof timeManager.addMinutesToStoryTime === 'function') {
            nextTime = timeManager.addMinutesToStoryTime(cursor, minutesToAdd);
        }
        let nextTimestamp = Number(nextTime?.timestamp || cursor?.timestamp || 0);
        if (Number.isFinite(nextTimestamp) && nextTimestamp > 0) {
            nextTimestamp += this._getWechatReplySecondsToAdd(contentText, { isFirstInReplyBatch }) * 1000;
            nextTime = {
                ...nextTime,
                timestamp: nextTimestamp,
                time: this._formatWechatTimeFromTimestamp(nextTimestamp) || nextTime?.time || cursor?.time,
                date: this._formatWechatDateFromTimestamp(nextTimestamp) || nextTime?.date || cursor?.date,
                weekday: this._getWechatWeekdayFromTimestamp(nextTimestamp, nextTime?.weekday || cursor?.weekday)
            };
        }

        messageObj.time = nextTime?.time || cursor?.time || messageObj.time;
        messageObj.date = messageObj.date || nextTime?.date || cursor?.date;
        messageObj.weekday = messageObj.weekday || nextTime?.weekday || cursor?.weekday;
        if (Number.isFinite(nextTimestamp) && nextTimestamp > 0) {
            messageObj.timestamp = nextTimestamp;
        }

        if (typeof timeManager.setTime === 'function' && messageObj.time && messageObj.date) {
            timeManager.setTime(messageObj.time, messageObj.date, messageObj.weekday || null);
            window.VirtualPhone?.checkCalendarScheduleReminders?.(timeManager.getCurrentStoryTime?.() || {
                time: messageObj.time,
                date: messageObj.date,
                weekday: messageObj.weekday
            });
        }

        this._aiReplyTimeCursor = timeManager.getCurrentStoryTime();
        this._aiReplyTimestampCursor = Number(messageObj.timestamp || nextTime?.timestamp || 0) || null;
    }
renderChatRoom(chat) {
        const messages = this.app.wechatData.getMessages(chat.id);
        const userInfo = this.app.wechatData.getUserInfo();
        const isCurrentChatSending = this.isSending && String(this._activeSendingChatId || '') === String(chat.id || '');
        const hasInputText = String(this.inputText || '').trim() !== '';
        const rightButtonIsMore = !isCurrentChatSending && !hasInputText;
        const safeChatId = this._escapeHtml(String(chat?.id || '').trim());

        return `
    <div class="chat-room" data-chat-id="${safeChatId}">
                <div class="chat-messages" id="chat-messages" data-chat-id="${safeChatId}">
                    ${this.renderMessagesWithDateDividers(messages, userInfo)}
                </div>

                <!-- 输入区 -->
                <div class="chat-input-area" style="background: rgba(255, 255, 255, 0.15) !important; backdrop-filter: blur(35px) saturate(200%) !important; -webkit-backdrop-filter: blur(35px) saturate(200%) !important; border-top: 0.5px solid rgba(0, 0, 0, 0.15) !important;">
                    <!-- 表情面板 -->
                    ${this.showEmoji ? this.renderEmojiPanel() : ''}

                    <!-- 更多功能面板 -->
                    ${this.showMore ? this.renderMorePanel() : ''}

                    <!-- 快捷回复面板 -->
                    ${this.showQuickReplies ? this.renderQuickReplyPanel() : ''}

                    <!-- 引用预览栏 - 仿真实微信浅灰条 -->
                    ${this.activeQuote ? `<div class="active-quote-bar" style="padding: 2px 8px; background: rgba(0,0,0,0.05); font-size: 10px; color: #888; display: flex; justify-content: space-between; align-items: center; line-height: 1.2;"><div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${this._escapeHtml(this.activeQuote.sender)}: ${this._escapeHtml(this.activeQuote.content.length > 20 ? this.activeQuote.content.substring(0, 20) + '...' : this.activeQuote.content)}</div><button id="cancel-quote-btn" style="background: none; border: none; color: #aaa; cursor: pointer; padding: 0 4px; font-size: 10px; line-height: 1;"><i class="fa-solid fa-xmark"></i></button></div>` : ''}

                    <!-- 输入行 -->
                    <div class="chat-input-bar" style="display: flex; align-items: center; justify-content: space-between; background: transparent !important;">
                        <div style="display: flex; align-items: center; gap: 0px;">
                            <button class="input-btn" id="quick-reply-btn" title="快捷回复">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="4" y="4" width="5.4" height="5.4" rx="1.15"/>
                                    <rect x="14.6" y="4" width="5.4" height="5.4" rx="1.15"/>
                                    <rect x="4" y="14.6" width="5.4" height="5.4" rx="1.15"/>
                                    <rect x="14.6" y="14.6" width="5.4" height="5.4" rx="1.15"/>
                                </svg>
                            </button>
                            <button class="input-btn" id="regenerate-btn" title="重新生成">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
                            </button>
                        </div>
                        <div class="chat-input-wrapper" style="flex: 1; margin: 0;">
                            <input type="text" class="chat-input" id="chat-input"
                                   style="background: rgba(255, 255, 255, 0.42) !important; border: 0.5px solid rgba(255, 255, 255, 0.58) !important; color: #111111 !important; backdrop-filter: blur(8px) saturate(130%) !important; -webkit-backdrop-filter: blur(8px) saturate(130%) !important;"
                                   placeholder="输入消息..." value="${this.inputText}">
                        </div>
                        <div style="display: flex; align-items: center; gap: 0px;">
                            <button class="input-btn" id="emoji-btn" title="表情">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                            </button>
                            <button class="input-btn" id="send-btn" data-mode="${rightButtonIsMore ? 'more' : 'send'}" style="color: ${isCurrentChatSending ? '#ff3b30' : (rightButtonIsMore ? '#555' : '#07c160')};">
                                ${isCurrentChatSending
                ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>`
                : rightButtonIsMore
                    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`
                    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`
            }
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // 🔥 渲染消息列表（常规3分钟时间胶囊 + AI首条>1分钟强制显示）
    renderMessagesWithDateDividers(messages, userInfo) {
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return '';
        }

        let html = '';
        let lastRenderedTimestamp = 0;
        let lastRenderedDate = null;

        messages.forEach((msg, index) => {
            try {
                const msgTimestamp = msg.timestamp || 0;
                const msgDate = msg.date ? this._normalizeWechatDateDisplay(msg.date) : null;
                const prevMsg = index > 0 ? messages[index - 1] : null;
                const prevTimestamp = Number(prevMsg?.timestamp || 0);
                const currentBatchId = String(msg?.replyBatchId || '').trim();
                const prevBatchId = String(prevMsg?.replyBatchId || '').trim();
                const isFirstAiReplyMessage = !!currentBatchId && currentBatchId !== prevBatchId;
                const aiFirstGapMs = (msgTimestamp && prevTimestamp) ? (msgTimestamp - prevTimestamp) : 0;
                const shouldShowAiFirstDivider = isFirstAiReplyMessage && (
                    msg?.forceTimeDivider === true || aiFirstGapMs >= 60 * 1000
                );

                // 🔥 日期变化时强制显示日期分隔符（线下转线上跨天场景）
                const isDateChanged = msgDate && msgDate !== lastRenderedDate;
                // 🔥 常规：间隔达到3分钟或日期变化；新增：AI首条>1分钟也显示时间胶囊
                const isManualTimeMarker = msg?.isTimeMarker === true || msg?.type === 'time_marker';
                if (isManualTimeMarker) {
                    const markerText = this._buildWechatTimeDividerText(msg, { forceDate: true });
                    if (markerText) {
                        html += this.renderManualTimeMarkerDivider(msg, index, markerText);
                        lastRenderedTimestamp = msgTimestamp;
                        if (msgDate) lastRenderedDate = msgDate;
                    }
                    return;
                }

                if (isDateChanged || shouldShowAiFirstDivider || msgTimestamp - lastRenderedTimestamp >= 3 * 60 * 1000 || (index === 0 && msgTimestamp)) {
                    let displayText = '';
                    if (isDateChanged) {
                        displayText = `${msgDate}${msg.weekday ? ' ' + msg.weekday : ''} ${msg.time || ''}`;
                    } else {
                        displayText = msg.time || '';
                    }

                    if (displayText.trim()) {
                        html += `
                            <div class="message-time-divider" style="
                                display: flex;
                                justify-content: center;
                                margin: 15px 0;
                            ">
                                <span class="time-divider-text" style="
                                    padding: 3px 10px;
                                    font-size: 10px;
                                    color: #b0b0b0;
                                ">${displayText.trim()}</span>
                            </div>
                        `;
                        lastRenderedTimestamp = msgTimestamp;
                        if (msgDate) lastRenderedDate = msgDate;
                    }
                }

                html += this.renderMessage(msg, userInfo, index);
            } catch (e) {
                console.error('渲染单条消息失败，已跳过:', e, msg);
            }
        });

        // 渲染完成后尝试水合表情包占位符
        this.scheduleInlineStickerHydration();
        return html;
    }

    _buildWechatTimeDividerText(msg = {}, { forceDate = false } = {}) {
        const msgTimestamp = Number(msg?.timestamp || 0);
        const msgDate = msg?.date ? this._normalizeWechatDateDisplay(msg.date) : null;
        const time = String(msg?.time || '').trim();
        if (forceDate && msgDate) {
            return `${msgDate}${msg.weekday ? ' ' + msg.weekday : ''}${time ? ' ' + time : ''}`.trim();
        }
        if (time) return time;
        if (msgTimestamp) {
            const dateText = this._formatWechatDateFromTimestamp(msgTimestamp);
            const timeText = this._formatWechatTimeFromTimestamp(msgTimestamp);
            return forceDate ? `${dateText} ${timeText}`.trim() : timeText;
        }
        return '';
    }

    renderManualTimeMarkerDivider(msg, messageIndex, displayText) {
        const messageId = String(msg?.id || '').trim();
        return `
            <div class="message-time-divider wechat-manual-time-marker" data-message-id="${this._escapeHtml(messageId)}" data-message-index="${Number(messageIndex)}" style="
                display: flex;
                justify-content: center;
                margin: 15px 0;
                position: relative;
            ">
                <span class="time-divider-text" style="
                    padding: 3px 10px;
                    font-size: 10px;
                    color: #b0b0b0;
                    cursor: default;
                    -webkit-user-select: none;
                    user-select: none;
                ">${this._escapeHtml(displayText)}</span>
            </div>
        `;
    }

    _getCurrentMessageSelectionChatId() {
        return String(this.messageSelectionChatId || '').trim();
    }

    _isMessageSelectionActiveForCurrentChat() {
        const currentChatId = String(this.app.currentChat?.id || '').trim();
        return !!this.messageSelectionMode
            && !!currentChatId
            && this._getCurrentMessageSelectionChatId() === currentChatId;
    }

    _refreshCurrentChatMessages(options = {}) {
        const chatId = String(this.app.currentChat?.id || '').trim();
        const messagesDiv = this._getVisibleChatMessagesContainer(chatId);
        if (!messagesDiv || !chatId) return false;

        const keepScroll = options.keepScroll !== false;
        const previousTop = messagesDiv.scrollTop;
        const previousHeight = messagesDiv.scrollHeight;
        const wasNearBottom = previousHeight - previousTop - messagesDiv.clientHeight < 100;

        const messages = this.app.wechatData.getMessages(chatId);
        const userInfo = this.app.wechatData.getUserInfo();
        messagesDiv.innerHTML = this.renderMessagesWithDateDividers(messages, userInfo);

        this.bindMessageLongPressEvents();
        this.bindManualTimeMarkerEvents();
        this.bindSpecialMessageEvents();
        this.bindInnerThoughtEvents();
        this.bindMessageSelectionEvents();
        this._syncMessageSelectionBar();

        if (!keepScroll) return true;
        if (wasNearBottom) {
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        } else {
            const delta = messagesDiv.scrollHeight - previousHeight;
            messagesDiv.scrollTop = Math.max(0, previousTop + delta);
        }
        return true;
    }

    _renderMessageSelectionBar() {
        const selectedCount = this.selectedMessageIds?.size || 0;
        return `
            <div class="wechat-message-selection-bar">
                <button class="wechat-message-selection-action" data-action="select-all">
                    <i class="fa-regular fa-circle-check"></i>
                    <span>全选</span>
                </button>
                <button class="wechat-message-selection-action ${selectedCount > 0 ? '' : 'is-disabled'}" data-action="delete-tail" ${selectedCount > 0 ? '' : 'disabled'}>
                    <i class="fa-solid fa-arrow-down-long"></i>
                    <span>删至末尾</span>
                </button>
                <button class="wechat-message-selection-action ${selectedCount > 0 ? 'is-danger' : 'is-disabled'}" data-action="delete" ${selectedCount > 0 ? '' : 'disabled'}>
                    <i class="fa-regular fa-trash-can"></i>
                    <span>删除${selectedCount > 0 ? `(${selectedCount})` : ''}</span>
                </button>
                <button class="wechat-message-selection-action is-close" data-action="cancel" aria-label="退出多选">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `;
    }

    _syncMessageSelectionBar() {
        const chatRoom = this._getCurrentChatRoom(this.app.currentChat?.id);
        if (!chatRoom) return;

        const bars = Array.from(chatRoom.querySelectorAll('.wechat-message-selection-bar'));
        const existingBar = bars[0] || null;
        bars.slice(1).forEach(el => el.remove());
        const inputArea = chatRoom.querySelector('.chat-input-area');

        if (!this._isMessageSelectionActiveForCurrentChat()) {
            if (inputArea) inputArea.style.removeProperty('display');
            existingBar?.remove();
            return;
        }

        if (inputArea) inputArea.style.display = 'none';
        let bar = existingBar;
        if (!bar) {
            chatRoom.insertAdjacentHTML('beforeend', this._renderMessageSelectionBar());
            bar = chatRoom.querySelector('.wechat-message-selection-bar');
            this._bindMessageSelectionBarEvents(bar);
        } else {
            this._updateMessageSelectionBarState(bar);
        }
    }

    _bindMessageSelectionBarEvents(bar) {
        if (!bar || bar.dataset.bound === '1') return;
        bar.dataset.bound = '1';
        bar?.querySelector('[data-action="delete"]')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.deleteSelectedMessages();
        });
        bar?.querySelector('[data-action="delete-tail"]')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.deleteMessagesFromFirstSelectionToEnd();
        });
        bar?.querySelector('[data-action="select-all"]')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectAllMessagesInCurrentChat();
        });
        bar?.querySelector('[data-action="cancel"]')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.exitMessageSelectionMode();
        });
    }

    _updateMessageSelectionBarState(bar = null) {
        const targetBar = bar || this.getCurrentWechatView()?.querySelector('.wechat-message-selection-bar');
        if (!targetBar) return;
        const selectedCount = this.selectedMessageIds?.size || 0;
        const deleteBtn = targetBar.querySelector('[data-action="delete"]');
        const deleteTailBtn = targetBar.querySelector('[data-action="delete-tail"]');

        if (deleteBtn) {
            deleteBtn.disabled = selectedCount <= 0;
            deleteBtn.classList.toggle('is-danger', selectedCount > 0);
            deleteBtn.classList.toggle('is-disabled', selectedCount <= 0);
            const label = deleteBtn.querySelector('span');
            if (label) label.textContent = `删除${selectedCount > 0 ? `(${selectedCount})` : ''}`;
        }

        if (deleteTailBtn) {
            deleteTailBtn.disabled = selectedCount <= 0;
            deleteTailBtn.classList.toggle('is-disabled', selectedCount <= 0);
        }
    }

    _syncMessageSelectionDom(messageId = '') {
        const currentView = this.getCurrentWechatView();
        const messagesDiv = currentView?.querySelector('#chat-messages');
        if (!messagesDiv) return;

        const syncItem = (item) => {
            const id = String(item?.dataset?.messageId || '').trim();
            if (!id) return;
            const selected = this.selectedMessageIds?.has(id) || false;
            item.classList.toggle('is-selected', selected);
            const check = item.querySelector('.message-select-check');
            if (check) {
                check.classList.toggle('checked', selected);
                check.setAttribute('aria-label', selected ? '取消选择' : '选择消息');
                check.innerHTML = selected ? '<i class="fa-solid fa-check"></i>' : '';
            }
        };

        const safeMessageId = String(messageId || '').trim();
        if (safeMessageId) {
            Array.from(messagesDiv.querySelectorAll('.chat-message[data-message-id]'))
                .filter(item => String(item.dataset.messageId || '').trim() === safeMessageId)
                .forEach(syncItem);
        } else {
            messagesDiv.querySelectorAll('.chat-message[data-message-id]').forEach(syncItem);
        }
    }

    _syncSelectedMessageIdsWithData(chatId = null) {
        const safeChatId = String(chatId || this.app.currentChat?.id || '').trim();
        if (!safeChatId || !this.selectedMessageIds) return;

        const messages = this.app.wechatData.getMessages(safeChatId) || [];
        const liveIds = new Set(messages.map(msg => String(msg?.id || '').trim()).filter(Boolean));
        Array.from(this.selectedMessageIds).forEach(id => {
            if (!liveIds.has(id)) this.selectedMessageIds.delete(id);
        });
    }

    enterMessageSelectionMode(initialMessageId = null) {
        const chatId = String(this.app.currentChat?.id || '').trim();
        if (!chatId) return;

        this.messageSelectionMode = true;
        this.messageSelectionChatId = chatId;
        this.selectedMessageIds = new Set();

        const safeMessageId = String(initialMessageId || '').trim();
        if (safeMessageId) this.selectedMessageIds.add(safeMessageId);

        this.showEmoji = false;
        this.showMore = false;
        this._setCustomEmojiSelectionMode(false);
        this._syncSelectedMessageIdsWithData(chatId);
        const refreshed = this._refreshCurrentChatMessages({ keepScroll: true });
        if (!refreshed && typeof this.app.render === 'function') {
            this.app.render();
        }
        setTimeout(() => {
            if (!this._isMessageSelectionActiveForCurrentChat()) return;
            this._syncSelectedMessageIdsWithData(chatId);
            this._syncMessageSelectionBar();
            this._syncMessageSelectionDom();
            this.bindMessageSelectionEvents();
        }, 0);
    }

    exitMessageSelectionMode() {
        if (!this.messageSelectionMode && this.selectedMessageIds.size === 0) return;
        this.messageSelectionMode = false;
        this.messageSelectionChatId = null;
        this.selectedMessageIds.clear();
        document.querySelectorAll('.wechat-message-selection-bar').forEach(el => el.remove());
        this._refreshCurrentChatMessages({ keepScroll: true });
    }

    toggleMessageSelection(messageId) {
        if (!this._isMessageSelectionActiveForCurrentChat()) return;
        const safeMessageId = String(messageId || '').trim();
        if (!safeMessageId) return;

        if (this.selectedMessageIds.has(safeMessageId)) {
            this.selectedMessageIds.delete(safeMessageId);
        } else {
            this.selectedMessageIds.add(safeMessageId);
        }
        this._syncMessageSelectionDom(safeMessageId);
        this._syncMessageSelectionBar();
    }

    selectAllMessagesInCurrentChat() {
        if (!this._isMessageSelectionActiveForCurrentChat()) return;
        const chatId = String(this.app.currentChat?.id || '').trim();
        const messages = this.app.wechatData.getMessages(chatId) || [];
        this.selectedMessageIds = new Set(
            messages.map(msg => String(msg?.id || '').trim()).filter(Boolean)
        );
        this._syncMessageSelectionDom();
        this._syncMessageSelectionBar();
    }

    deleteSelectedMessages() {
        if (!this._isMessageSelectionActiveForCurrentChat()) return;
        const chatId = String(this.app.currentChat?.id || '').trim();
        const ids = Array.from(this.selectedMessageIds || []).map(id => String(id || '').trim()).filter(Boolean);
        if (!chatId || ids.length === 0) {
            this.app.phoneShell?.showNotification('提示', '请先选择要删除的消息', '⚠️');
            return;
        }

        const messagesBeforeDelete = this.app.wechatData.getMessages(chatId) || [];
        const deletedImageUrls = this._collectManagedWechatGeneratedImages(
            messagesBeforeDelete.filter(msg => ids.includes(String(msg?.id || '').trim()))
        );
        const deletedCount = this.app.wechatData.deleteMessagesByIds(chatId, ids);
        this._cleanupWechatGeneratedImages(deletedImageUrls);
        this.messageSelectionMode = false;
        this.messageSelectionChatId = null;
        this.selectedMessageIds.clear();
        document.querySelectorAll('.wechat-message-selection-bar').forEach(el => el.remove());
        this._refreshCurrentChatMessages({ keepScroll: true });

        if (this.app.phoneShell && typeof this.app.phoneShell.updateStatusBarTime === 'function') {
            this.app.phoneShell.updateStatusBarTime();
        }
        this.app.phoneShell?.showNotification('已删除', `已删除 ${deletedCount} 条消息`, '🗑️');
    }

    deleteMessagesFromFirstSelectionToEnd() {
        if (!this._isMessageSelectionActiveForCurrentChat()) return;
        const chatId = String(this.app.currentChat?.id || '').trim();
        const selectedIds = new Set(Array.from(this.selectedMessageIds || []).map(id => String(id || '').trim()).filter(Boolean));
        if (!chatId || selectedIds.size === 0) {
            this.app.phoneShell?.showNotification('提示', '请先选择起始消息', '⚠️');
            return;
        }

        const messages = this.app.wechatData.getMessages(chatId) || [];
        const startMessage = messages.find(msg => selectedIds.has(String(msg?.id || '').trim()));
        if (!startMessage?.id) {
            this.app.phoneShell?.showNotification('提示', '未找到起始消息', '⚠️');
            return;
        }

        const startIndex = messages.findIndex(msg => String(msg?.id || '').trim() === String(startMessage.id || '').trim());
        const deletedImageUrls = this._collectManagedWechatGeneratedImages(startIndex >= 0 ? messages.slice(startIndex) : []);
        const deletedCount = this.app.wechatData.deleteMessagesFromId(chatId, startMessage.id);
        this._cleanupWechatGeneratedImages(deletedImageUrls);
        this.messageSelectionMode = false;
        this.messageSelectionChatId = null;
        this.selectedMessageIds.clear();
        document.querySelectorAll('.wechat-message-selection-bar').forEach(el => el.remove());
        this._refreshCurrentChatMessages({ keepScroll: true });

        if (this.app.phoneShell && typeof this.app.phoneShell.updateStatusBarTime === 'function') {
            this.app.phoneShell.updateStatusBarTime();
        }
        this.app.phoneShell?.showNotification('已删除', `已从该处删除 ${deletedCount} 条消息`, '🗑️');
    }

    bindMessageSelectionEvents() {
        const currentView = this.getCurrentWechatView();
        const messagesDiv = currentView?.querySelector('#chat-messages');
        if (!messagesDiv || messagesDiv._messageSelectionEventsBound) return;
        messagesDiv._messageSelectionEventsBound = true;

        messagesDiv.addEventListener('click', (e) => {
            if (!this._isMessageSelectionActiveForCurrentChat()) return;
            const target = e.target.closest('.message-select-check, .message-content, .system-message-bubble');
            if (!target) return;

            const msgElement = target.closest('.chat-message[data-message-id]');
            if (!msgElement) return;
            e.preventDefault();
            e.stopPropagation();
            this.toggleMessageSelection(msgElement.dataset.messageId);
        });
    }

    _resolveMessageAvatarIdentity(msg, userInfo) {
        const isMe = msg.from === 'me' || msg.from === userInfo.name;
        if (isMe) {
            return {
                isMe: true,
                senderName: userInfo.name || '我',
                senderAvatar: userInfo.avatar || ''
            };
        }

        const isGroupChat = this.app.currentChat?.type === 'group';
        if (isGroupChat) {
            const senderName = msg.from || '群成员';
            const senderContact = this.app.wechatData.getContactByName(senderName);
            return {
                isMe: false,
                senderName,
                senderAvatar: senderContact?.avatar || ''
            };
        }

        const currentChat = this.app.currentChat || {};
        const currentContact = currentChat.contactId
            ? this.app.wechatData.getContact(currentChat.contactId)
            : this.app.wechatData.getContactByName(currentChat.name);
        const senderName = currentContact?.name || currentChat.name || msg.from || '对方';
        const senderAvatar = currentContact?.avatar || currentChat.avatar || msg.avatar || '';

        return {
            isMe: false,
            senderName,
            senderAvatar
        };
    }

    // 🔥 智能局部刷新消息列表（移动端安全版防闪烁）
    smartUpdateMessages(messages, userInfo, options = {}) {
        const container = this._getVisibleChatMessagesContainer?.(options.chatId) || document.getElementById('chat-messages');
        if (!container) return;

        // 1. 记录更新前的滚动状态
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;

        // 2. 生成新 HTML
        let newHtml = '';
        try {
            newHtml = this.renderMessagesWithDateDividers(messages, userInfo);
        } catch (error) {
            console.error('微信消息列表 HTML 生成失败:', error);
            return;
        }

        // 3. 移动端安全替换：抛弃危险的 outerHTML，使用原生 innerHTML 替换
        try {
            container.innerHTML = newHtml;
        } catch (error) {
            console.error('微信消息列表刷新失败:', error);
            return;
        }

        // 4. 重新绑定事件。这里不能影响发送主流程，否则会出现 API 已完成但微信一直黄灯。
        try {
            this.bindMessageLongPressEvents();
            this.bindManualTimeMarkerEvents();
            this.bindSpecialMessageEvents();
            this.bindInnerThoughtEvents();
            this.bindMessageSelectionEvents();
        } catch (error) {
            console.error('微信消息列表事件绑定失败:', error);
        }

        // 5. 恢复滚动状态（如果本来在底部，就继续贴底）
        if (isNearBottom) {
            container.scrollTop = container.scrollHeight;
        }
    }

    // 渲染单条消息（全新红包样式）
    renderMessage(msg, userInfo, messageIndex = -1) {
        if (msg?.isTimeMarker === true || msg?.type === 'time_marker') {
            return '';
        }

        const { isMe, senderName, senderAvatar } = this._resolveMessageAvatarIdentity(msg, userInfo);
        const paymentStatus = String(msg.status || '').trim();
        const isRedPacketOpened = paymentStatus === 'opened';
        const isPaymentRefunded = paymentStatus === 'refunded';
        const messageId = String(msg?.id || '').trim();
        const isSelectionMode = this._isMessageSelectionActiveForCurrentChat();
        const isSelected = messageId && this.selectedMessageIds.has(messageId);
        const selectionClass = isSelectionMode ? ' is-selection-mode' : '';
        const selectedClass = isSelected ? ' is-selected' : '';
        const selectionCheckHtml = isSelectionMode && messageId ? `
            <button class="message-select-check ${isSelected ? 'checked' : ''}" data-message-id="${this._escapeHtml(messageId)}" aria-label="${isSelected ? '取消选择' : '选择消息'}" style="order:-1;">
                ${isSelected ? '<i class="fa-solid fa-check"></i>' : ''}
            </button>
        ` : '';

        // 🔥🔥🔥 系统消息特殊处理（居中透明气泡）
        if (msg.type === 'system' || msg.from === 'system') {
            const systemContent = this._escapeHtml(msg.content || '');
            return `
            <div class="chat-message message-system${selectionClass}${selectedClass}" data-message-id="${this._escapeHtml(messageId)}" data-message-index="${Number(messageIndex)}" style="
                display: flex;
                justify-content: center;
                margin: 12px 0;
            ">
                ${selectionCheckHtml}
                <div class="system-message-bubble" style="
                    background: rgba(0, 0, 0, 0.05);
                    border-radius: 4px;
                    padding: 4px 10px;
                    font-size: 12px;
                    color: #888;
                    max-width: 80%;
                    text-align: center;
                ">
                    ${systemContent}
                </div>
            </div>
        `;
        }

        // 🔥🔥🔥 群聊消息处理：获取发送者名字和头像
        const isGroupChat = this.app.currentChat?.type === 'group';

        let messageBody = '';

        const contentStr = String(msg?.content || '').trim();
        const inlineVoiceNewMatch = /^(?:\[\s*(?:语音条|语音)\s*\]|【\s*(?:语音条|语音)\s*】)\s*[:：]?\s*(.+)$/i.exec(contentStr);
        const inlineVoiceOldMatch = /^\[语音\s*(\d+)秒?\]\(?([^)]*)\)?$/i.exec(contentStr);
        const effectiveType = (msg.type === 'text' || !msg.type)
            && (inlineVoiceNewMatch || inlineVoiceOldMatch)
            ? 'voice'
            : msg.type;

        switch (effectiveType) {
            case 'image':
                {
                    const isCustomEmojiImage = !!(msg.customEmojiId || msg.customEmojiName || msg.customEmojiDescription);
                    const safeImageContent = this.escapeInlineStickerAttr(msg.content || '');
                    const customEmojiBoxStyle = isCustomEmojiImage
                        ? 'max-width:min(156px, 100%); max-height:156px;'
                        : '';
                    const customEmojiImgStyle = isCustomEmojiImage
                        ? 'display: block; max-width:100%; max-height:156px; width:auto; height:auto; object-fit:contain;'
                        : '';
                    messageBody = `<div class="message-image-box ${isCustomEmojiImage ? 'message-image-box-custom-emoji' : ''}" style="position: relative; display: inline-block; line-height: 0; ${customEmojiBoxStyle}"><img src="${safeImageContent}" class="message-image" style="${customEmojiImgStyle}"></div>`;
                }
                break;
            case 'image_prompt':
                messageBody = this.renderImagePromptCard(msg);
                break;
            case 'location': {
                const locationRaw = String(msg.locationText || msg.locationAddress || msg.content || '').trim() || '未知位置';
                const locationTitleRaw = locationRaw.length > 22 ? `${locationRaw.slice(0, 22)}...` : locationRaw;
                const locationTitle = this._escapeHtml(locationTitleRaw);
                const locationDetail = this._escapeHtml(locationRaw);
                messageBody = `
                <div class="message-location style-compact">
                    <div class="icon-area">
                        <i class="fa-solid fa-location-dot"></i>
                    </div>
                    <div class="text-area">
                        <div class="title">${locationTitle}</div>
                        <div class="detail">${locationDetail}</div>
                    </div>
                </div>
            `;
                break;
            }
            case 'voice':
                let durationStr = msg.duration || '3"';
                let durationNum = parseInt(durationStr.replace('"', '').replace('秒', '')) || 3;
                let voiceText = msg.voiceText || '';

                // 兼容新老格式提取
                const newVMatch = inlineVoiceNewMatch || /^(?:\[\s*(?:语音条|语音)\s*\]|【\s*(?:语音条|语音)\s*】)\s*[:：]?\s*(.+)$/i.exec(msg.content);
                if (newVMatch) {
                    voiceText = String(newVMatch[1] || '').trim();
                    const wrappedVoiceMatch = voiceText.match(/^[（(]\s*([\s\S]*?)\s*[)）]$/);
                    if (wrappedVoiceMatch) {
                        voiceText = String(wrappedVoiceMatch[1] || '').trim();
                    }
                    voiceText = voiceText
                        .replace(/^(?:语音条?\s*)?(?:转文字|转文本|转写|转录|转化出的文字|转化文字|转换文字|文字内容|内容)\s*[：:]\s*/i, '')
                        .replace(/^语音条转文字内容\s*[：:]\s*/i, '')
                        .trim();
                    durationNum = Math.max(2, Math.min(Math.ceil(voiceText.length / 3), 60));
                    durationStr = durationNum + '"';
                } else {
                    const oldVMatch = inlineVoiceOldMatch || /^\[语音\s*(\d+)秒?\]\(?([^)]*)\)?$/.exec(msg.content);
                    if (oldVMatch) {
                        durationStr = oldVMatch[1] + '"';
                        voiceText = oldVMatch[2] || '';
                        durationNum = parseInt(oldVMatch[1]);
                    }
                }
                voiceText = String(voiceText || '')
                    .replace(/^(?:语音条?\s*)?(?:转文字|转文本|转写|转录|转化出的文字|转化文字|转换文字|文字内容|内容)\s*[：:]\s*/i, '')
                    .replace(/^语音条转文字内容\s*[：:]\s*/i, '')
                    .trim();

                // 动态宽度
                const minW = 60;
                const maxW = 200;
                let dynamicWidth = minW + (durationNum / 60) * (maxW - minW);
                if (dynamicWidth > maxW) dynamicWidth = maxW;

                // SVG波纹 (微调了垂直对齐) - 带动画 class
                const voiceSvgLeft = `<svg class="voice-wave-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; margin-top: -1px;"><path d="M8 12h.01"/><path class="voice-arc-1" d="M12 8.5a5 5 0 0 1 0 7"/><path class="voice-arc-2" d="M16 5a10 10 0 0 1 0 14"/></svg>`;
                const voiceSvgRight = `<svg class="voice-wave-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: scaleX(-1); flex-shrink: 0; margin-top: -1px;"><path d="M8 12h.01"/><path class="voice-arc-1" d="M12 8.5a5 5 0 0 1 0 7"/><path class="voice-arc-2" d="M16 5a10 10 0 0 1 0 14"/></svg>`;

                // 🔥 包裹容器：竖向排列语音条和转文字
                messageBody = `<div style="display: flex; flex-direction: column; gap: 4px; align-items: ${isMe ? 'flex-end' : 'flex-start'};">`;

                // 🔥 1. 语音条：【完全复用 .message-text 类】，保证 padding、颜色、圆角、小尾巴和纯文字框 100% 像素级一致！
                // 使用 display: flex 实现左右对齐
                messageBody += `
                <div class="message-text voice-bubble-playable" id="voice-bubble-${this.escapeInlineStickerAttr(msg.id || Math.random().toString(36).substr(2, 9))}" data-text="${this.escapeInlineStickerAttr(voiceText || '')}" style="width: ${dynamicWidth}px; display: flex; justify-content: space-between; align-items: center; box-sizing: border-box; cursor: pointer;">
                    ${isMe
                        ? `<span>${this._escapeHtml(durationStr)}</span> ${voiceSvgRight}`
                        : `${voiceSvgLeft} <span>${this._escapeHtml(durationStr)}</span>`}
                </div>
            `;

                // 🔥 2. 语音转文字：仿照文本框手写样式，但不加 .message-text 类（为了避免小尾巴重复出现）
                if (voiceText) {
                    messageBody += `
                    <div style="
                        padding: 7px 10px;
                        border-radius: 4px;
                        font-size: 14px;
                        line-height: 1.4;
                        background: ${isMe ? '#95ec69' : '#fff'};
                        color: ${isMe ? '#000' : '#1c1c1e'};
                        box-shadow: ${isMe ? 'none' : '0 1px 2px rgba(0,0,0,0.08)'};
                        word-break: break-word;
                        max-width: 100%;
                        box-sizing: border-box;
                        text-align: left;
                    ">${this._escapeHtml(voiceText)}</div>
                `;
                }
                messageBody += `</div>`;
                break;
            case 'transfer': {
                const isTransferOpened = paymentStatus === 'received' || isPaymentRefunded;
                const transferSubtitle = isPaymentRefunded
                    ? '已退回'
                    : (isMe
                        ? (paymentStatus === 'received' ? '对方已收款' : '你发起了一笔转账')
                        : (paymentStatus === 'received' ? '已接收' : '收到转账'));
                const formattedAmount = parseFloat(msg.amount || 0).toFixed(2);
                messageBody = `
                <div class="message-transfer ${isTransferOpened ? 'opened' : ''}" data-msg-id="${this._escapeHtml(msg.id || '')}">
                    <div class="rp-main">
                        <div class="rp-icon">
                            <!-- fake-world transfer2-outlined.svg 原版图标 -->
                            <svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                                <path fill-rule="evenodd" clip-rule="evenodd" d="M2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12ZM20.8 12C20.8 16.8601 16.8601 20.8 12 20.8C7.13989 20.8 3.2 16.8601 3.2 12C3.2 7.13989 7.13989 3.2 12 3.2C16.8601 3.2 20.8 7.13989 20.8 12ZM9.7899 9.92367H17V11.1237H9L7.54588 11.1237C7.26974 11.1237 7.04588 10.8998 7.04588 10.6237C7.04588 10.4757 7.11143 10.3353 7.2249 10.2403L10.3863 7.59332C10.5557 7.4515 10.808 7.47384 10.9498 7.64322C11.0632 7.77865 11.0743 7.97241 10.9772 8.11994L9.7899 9.92367ZM7.04588 14.08H14.256L13.0687 15.8837C12.9716 16.0313 12.9827 16.225 13.0961 16.3605C13.2379 16.5298 13.4902 16.5522 13.6596 16.4104L16.821 13.7634C16.9344 13.6684 17 13.528 17 13.38C17 13.1039 16.7761 12.88 16.5 12.88H15.0459H7.04588V14.08Z" />
                            </svg>
                        </div>
                        <div class="rp-content">
                            <div class="rp-title">¥${formattedAmount}</div>
                            <div class="rp-subtitle">${this._escapeHtml(transferSubtitle)}</div>
                        </div>
                    </div>
                    <div class="rp-footer">微信转账</div>
                </div>
            `;
                break;
            }

            case 'call_record': {
                const callStatusText = msg.status === 'answered'
                    ? `通话时长 ${msg.duration}`
                    : msg.status === 'rejected'
                        ? '对方已拒绝'
                        : msg.status === 'declined'
                            ? '对方已拒绝'
                            : msg.status === 'cancelled'
                                ? '已取消'
                                : '未接听';
                const phoneSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
                const videoSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="14" height="14" rx="2" ry="2"/><polygon points="23 7 16 12 23 17 23 7"/></svg>`;
                const callSvg = msg.callType === 'video' ? videoSvg : phoneSvg;
                const safeCallStatusText = this._escapeHtml(callStatusText);
                if (isMe) {
                    messageBody = `<div class="message-text" style="display: inline-flex; align-items: center; gap: 6px;">${safeCallStatusText} ${callSvg}</div>`;
                } else {
                    messageBody = `<div class="message-text" style="display: inline-flex; align-items: center; gap: 6px;">${callSvg} ${safeCallStatusText}</div>`;
                }
                break;
            }

            case 'redpacket':
                messageBody = `
                <div class="message-redpacket ${(isRedPacketOpened || isPaymentRefunded) ? 'opened' : ''}" data-msg-id="${this._escapeHtml(msg.id || '')}">
                    <div class="rp-main">
                        <div class="rp-icon">
                            <!-- 微信经典红包图标 -->
                            <svg viewBox="0 0 24 24" fill="none">
                                <rect x="2" y="4" width="20" height="16" rx="2" fill="#F45448"/>
                                <path d="M2 6 C 2 6, 12 14, 22 6 L 22 4 C 22 4, 2 4, 2 4 Z" fill="#FBD878"/>
                                <circle cx="12" cy="10" r="3.5" fill="#FBD878"/>
                                <rect x="11.2" y="9.2" width="1.6" height="1.6" fill="#F45448"/>
                            </svg>
                        </div>
                        <div class="rp-content">
                            <div class="rp-title">${this._escapeHtml(msg.wish || '恭喜发财，大吉大利')}</div>
                            <!-- 没被领取时不显示副标题，对齐原生 -->
                            ${isPaymentRefunded ? `<div class="rp-subtitle">已退回</div>` : (isRedPacketOpened ? `<div class="rp-subtitle">${isMe ? '已被领取' : '已领取'}</div>` : '')}
                        </div>
                    </div>
                    <div class="rp-footer">微信红包</div>
                </div>
            `;
                break;

            // 表情包消息：本地自定义表情优先，其次 ALAPI，最后关键词占位卡片
           case 'sticker':
                const stickerKeyword = String(msg.keyword || '发呆');
                const directStickerUrl = this.normalizeStickerDirectImageUrl(msg.stickerUrl || stickerKeyword);
                if (directStickerUrl) {
                    messageBody = `
                    <div class="message-sticker-box" style="line-height:0; display:inline-block; max-width:min(156px, 100%); max-height:156px;">
                        ${this.renderDirectStickerImage(directStickerUrl, '表情包', { maxHeight: 156 })}
                    </div>`;
                    break;
                }

                const matchedCustomEmoji = this.findCustomEmojiByKeyword(stickerKeyword);

                if (matchedCustomEmoji && matchedCustomEmoji.image) {
                    messageBody = `
                    <div class="message-sticker-box" style="line-height:0; display:inline-block; max-width:min(156px, 100%); max-height:156px;">
                        ${this.renderCustomEmojiStickerImage(matchedCustomEmoji, { maxHeight: 156 })}
                    </div>`;
                    break;
                }

                // 没有匹配到自定义表情，走 API；若失败则显示关键词占位卡片（不再映射 emoji）
                const stickerCacheKey = this.buildStickerCacheKey(stickerKeyword);
                messageBody = `
                <div class="message-sticker-box" style="line-height:1.2;">
                    <span class="wechat-sticker-target"
                        data-key="${this.escapeInlineStickerAttr(stickerCacheKey)}"
                        data-keyword="${this.escapeInlineStickerAttr(stickerKeyword)}"
                        data-fallback-size="56"
                        data-emoji-size="24"
                        style="display:inline-flex;align-items:center;justify-content:center;max-width:min(156px, 100%);max-height:156px;background:transparent;padding:0;">
                        ${this.buildStickerKeywordFallbackMarkup(stickerKeyword, 56)}
                    </span>
                </div>`;
                break;

            case 'weibo_card': {
                const wb = msg.weiboData || {};
                messageBody = `
                <div class="message-weibo-card" data-msg-id="${this._escapeHtml(msg.id || '')}" style="background: #fff; border: 1px solid #e8e8e8; border-radius: 8px; overflow: hidden; max-width: 220px; cursor: pointer;">
                    <div style="padding: 10px;">
                        <div style="font-size: 13px; font-weight: 600; color: #1a1a1a; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${this._escapeHtml(wb.blogger || '微博')}
                        </div>
                        <div style="font-size: 12px; color: #666; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                            ${this._escapeHtml((wb.content || '').substring(0, 80))}
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: flex-start; gap: 6px; padding: 6px 10px; background: #f5f5f5; border-top: 1px solid #eee;">
                        <div style="width: 18px; height: 18px; border-radius: 4px; background: #ff9f3d; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 400; flex-shrink: 0;">微</div>
                        <span style="font-size: 11px; color: #999; font-weight: 400;">微博</span>
                    </div>
                </div>
                `;
                break;
            }

            case 'poker_card': {
                const poker = msg.pokerData || {};
                const title = this._escapeHtml(poker.title || '德州扑克牌局记录');
                const desc = this._escapeHtml(poker.desc || poker.content || '点击查看完整牌局内容');
                messageBody = `
                <div class="message-poker-card" data-msg-id="${this._escapeHtml(msg.id || '')}" style="background:#fff; border:1px solid #e8e8e8; border-radius:8px; overflow:hidden; max-width:228px; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                    <div style="padding:11px 11px 10px;">
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:7px;">
                            <div style="width:28px; height:28px; border-radius:7px; background:linear-gradient(135deg,#2563eb,#0f172a); color:#fff; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700; flex-shrink:0;">♠</div>
                            <div style="min-width:0; flex:1;">
                                <div style="font-size:13px; font-weight:700; color:#1a1a1a; line-height:1.25; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${title}</div>
                                <div style="font-size:10px; color:#999; line-height:1.25; margin-top:2px;">牌局分享</div>
                            </div>
                        </div>
                        <div style="font-size:12px; color:#666; line-height:1.45; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; word-break:break-word;">${desc}</div>
                    </div>
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:7px 10px; background:#f6f6f6; border-top:1px solid #eee;">
                        <span style="font-size:11px; color:#999;">德州扑克</span>
                        <span style="font-size:10px; color:#b0b0b0;">查看详情</span>
                    </div>
                </div>
                `;
                break;
            }

            case 'werewolf_card': {
                const werewolf = msg.werewolfData || {};
                const title = this._escapeHtml(werewolf.title || '狼人杀复盘记录');
                const desc = this._escapeHtml(werewolf.desc || werewolf.content || '点击查看完整复盘内容');
                const result = this._escapeHtml(werewolf.result || '复盘分享');
                messageBody = `
                <div class="message-werewolf-card" data-msg-id="${this._escapeHtml(msg.id || '')}" style="background:#fff; border:1px solid #e8e8e8; border-radius:8px; overflow:hidden; max-width:228px; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                    <div style="padding:11px 11px 10px;">
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:7px;">
                            <div style="width:28px; height:28px; border-radius:7px; background:linear-gradient(135deg,#7f1d1d,#111827); color:#fff; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:800; flex-shrink:0;">狼</div>
                            <div style="min-width:0; flex:1;">
                                <div style="font-size:13px; font-weight:700; color:#1a1a1a; line-height:1.25; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${title}</div>
                                <div style="font-size:10px; color:#999; line-height:1.25; margin-top:2px;">${result}</div>
                            </div>
                        </div>
                        <div style="font-size:12px; color:#666; line-height:1.45; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; word-break:break-word;">${desc}</div>
                    </div>
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:7px 10px; background:#f6f6f6; border-top:1px solid #eee;">
                        <span style="font-size:11px; color:#999;">狼人杀</span>
                        <span style="font-size:10px; color:#b0b0b0;">查看复盘</span>
                    </div>
                </div>
                `;
                break;
            }

            case 'catbox_care_card': {
                const petName = this._escapeHtml(msg.catboxPetName || '小猫');
                messageBody = `
                    <div class="message-catbox-care-card" style="width: 190px; border-radius: 10px; overflow: hidden; background: #f5d98a; border: 1px solid #ead7aa; box-shadow: 0 1px 2px rgba(0,0,0,0.08);">
                        <div style="display:flex; align-items:center; gap:7px; padding:8px; background:#f5d98a;">
                            <div style="width:28px; height:28px; border-radius:8px; background:#fffaf0; color:#19120f; display:flex; align-items:center; justify-content:center; font-size:15px; border:1px solid rgba(42,28,25,0.14);">🐾</div>
                            <div style="min-width:0;">
                                <div style="font-size:12px; font-weight:700; color:#2a1c19;">猫盒照顾</div>
                                <div style="font-size:10px; color:#6d4c27; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">帮你喂养了 ${petName}</div>
                            </div>
                        </div>
                    </div>
                `;
                break;
            }

            case 'catbox_coadopt_invite': {
                const status = String(msg.catboxInviteStatus || 'pending').trim();
                const petName = this._escapeHtml(msg.catboxPetName || '小猫');
                const statusText = status === 'accepted' ? '已接收' : (status === 'rejected' ? '已拒绝' : '等待中');
                const statusColor = status === 'accepted' ? '#228b52' : (status === 'rejected' ? '#9a3b42' : '#8a6428');
                messageBody = `
                    <div class="message-catbox-invite-card" style="width: 190px; border-radius: 10px; overflow: hidden; background: #f5d98a; border: 1px solid #ead7aa; box-shadow: 0 1px 2px rgba(0,0,0,0.08);">
                        <div style="display:flex; align-items:center; gap:7px; padding:8px;">
                            <div style="width:28px; height:28px; border-radius:8px; background:#fffaf0; color:#19120f; display:flex; align-items:center; justify-content:center; font-size:15px; border:1px solid rgba(42,28,25,0.14);">🐾</div>
                            <div style="min-width:0; flex:1;">
                                <div style="font-size:12px; font-weight:700; color:#2a1c19;">猫盒共养邀请</div>
                                <div style="font-size:10px; color:#6d4c27; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">一起照顾 ${petName}</div>
                            </div>
                            <span style="flex:0 0 auto; border-radius:999px; padding:3px 6px; background:rgba(255,255,255,0.66); color:${statusColor}; font-size:10px; font-weight:700;">${statusText}</span>
                        </div>
                    </div>
                `;
                break;
            }

            case 'music_listen': {
                const activeSession = this.app.wechatData.getMusicListening?.(this.app.currentChat?.id);
                const musicInfo = msg.musicListen || activeSession || {};
                const listenStatus = String(msg.musicListenStatus || '').trim();
                const sourceMessageId = String(activeSession?.sourceMessageId || '').trim();
                const thisMessageId = String(msg.id || '').trim();
                const savedSongName = String(musicInfo.songName || '').trim();
                const savedArtist = String(musicInfo.artist || '').trim();
                const activeSongName = String(activeSession?.songName || '').trim();
                const activeArtist = String(activeSession?.artist || '').trim();
                const isSameSong = !!savedSongName
                    && savedSongName === activeSongName
                    && (!savedArtist || !activeArtist || savedArtist === activeArtist);
                const isOwnActiveSession = !!activeSession
                    && (sourceMessageId ? sourceMessageId === thisMessageId : isSameSong);
                const isEnded = listenStatus === 'ended' || listenStatus === 'cancelled' || !isOwnActiveSession;
                const songTitle = this._escapeHtml(musicInfo.songName || '正在播放');
                const artistName = this._escapeHtml(musicInfo.artist || '');
                const contactName = this._escapeHtml(activeSession?.contactName || musicInfo.contactName || senderName || this.app.currentChat?.name || '好友');
                const userAvatar = activeSession?.userAvatar || userInfo.avatar || '';
                const normalizeAvatar = value => String(value || '').trim();
                const pickContactAvatar = (...candidates) => {
                    const normalizedUserAvatar = normalizeAvatar(userAvatar);
                    for (const candidate of candidates) {
                        const normalized = normalizeAvatar(candidate);
                        if (normalized && normalized !== normalizedUserAvatar) return candidate;
                    }
                    return '';
                };
                const contactAvatar = pickContactAvatar(
                    this.app.wechatData.getContact?.(activeSession?.contactId || musicInfo.contactId)?.avatar,
                    this.app.wechatData.getContactByName?.(activeSession?.contactName || musicInfo.contactName)?.avatar,
                    this.app.currentChat?.avatar,
                    this.app.wechatData.getContactAutoAvatar?.(activeSession?.contactId || musicInfo.contactId),
                    this.app.wechatData.getContactAutoAvatar?.(activeSession?.contactName || musicInfo.contactName),
                    senderAvatar,
                    musicInfo.contactAvatar,
                    activeSession?.contactAvatar
                );
                const playlistCover = (() => {
                    const list = window.VirtualPhone?.musicApp?.musicData?.getPlaylist?.() || [];
                    const targetSong = String(musicInfo.songName || '').trim();
                    const targetArtist = String(musicInfo.artist || '').trim();
                    const found = Array.isArray(list)
                        ? list.find(song =>
                            String(song?.name || '').trim() === targetSong
                            && (!targetArtist || String(song?.artist || '').trim() === targetArtist)
                        )
                        : null;
                    return found?.pic || '';
                })();
                const coverUrl = this._escapeHtml(musicInfo.cover || musicInfo.pic || playlistCover || this._getDefaultMusicCover());
                const fallbackCover = this._escapeHtml(this._getDefaultMusicCover());
                const stateClass = isEnded ? 'state-ended' : 'state-active';
                const statusText = isEnded ? '共听已结束' : '<span class="message-music-card-dot"></span>正在共听';
                const bottomText = isEnded ? `你和 ${contactName}` : `你和 ${contactName}`;
                messageBody = `
                    <div class="message-music-card ${stateClass}" data-chat-id="${this._escapeHtml(this.app.currentChat?.id || '')}">
                        <div class="message-music-card-bg" style="background-image:url('${coverUrl}')"></div>
                        <div class="message-music-card-overlay"></div>
                        <div class="message-music-card-content">
                            <div class="message-music-card-top">
                                <div class="message-music-card-visual">
                                    <div class="message-music-card-vinyl"></div>
                                    <img class="message-music-card-cover" src="${coverUrl}" alt="" onerror="this.src='${fallbackCover}'">
                                </div>
                                <div class="message-music-card-info">
                                    <div class="message-music-card-status">${statusText}</div>
                                    <div class="message-music-card-title">${songTitle}</div>
                                    <div class="message-music-card-artist">${artistName}</div>
                                </div>
                            </div>
                            <div class="message-music-card-bottom">
                                <div class="message-music-card-users">
                                    <div class="message-music-card-avatars">
                                        <span>${this.app.renderAvatar(userAvatar, '😊', userInfo.name)}</span>
                                        <span>${this.app.renderAvatar(contactAvatar, '👤', contactName)}</span>
                                    </div>
                                    <span class="message-music-card-user-text">${bottomText}</span>
                                </div>
                                ${isEnded ? `
                                    <span class="message-music-card-ended">已结束</span>
                                ` : `
                                    <button type="button" class="message-music-card-btn is-glass message-music-listen-cancel" data-chat-id="${this._escapeHtml(this.app.currentChat?.id || '')}">
                                        取消听歌
                                    </button>
                                `}
                            </div>
                        </div>
                    </div>
                `;
                break;
            }

            case 'music_invite': {
                const activeSession = this.app.wechatData.getMusicListening?.(this.app.currentChat?.id);
                const invite = msg.musicInvite || {};
                const status = String(msg.musicInviteStatus || invite.status || 'pending').trim();
                const sourceMessageId = String(activeSession?.sourceMessageId || '').trim();
                const thisMessageId = String(msg.id || '').trim();
                const inviteSongName = String(invite.songName || msg.songName || '').trim();
                const inviteArtist = String(invite.artist || msg.artist || '').trim();
                const activeSongName = String(activeSession?.songName || '').trim();
                const activeArtist = String(activeSession?.artist || '').trim();
                const isSameSong = !!inviteSongName
                    && inviteSongName === activeSongName
                    && (!inviteArtist || !activeArtist || inviteArtist === activeArtist);
                const isOwnActiveSession = !!activeSession
                    && (sourceMessageId ? sourceMessageId === thisMessageId : isSameSong);
                const isAccepted = status === 'accepted' && isOwnActiveSession;
                const isRejected = status === 'rejected';
                const isEndedByPlayback = status === 'ended' || status === 'cancelled' || (status === 'accepted' && !isOwnActiveSession);
                const isEnded = isRejected || isEndedByPlayback;
                const songTitle = this._escapeHtml(inviteSongName || '未知歌曲');
                const artistName = this._escapeHtml(inviteArtist || '未知歌手');
                const coverUrl = this._escapeHtml(invite.cover || msg.cover || this._getDefaultMusicCover());
                const fallbackCover = this._escapeHtml(this._getDefaultMusicCover());
                const inviterName = this._escapeHtml(msg.from || senderName || this.app.currentChat?.name || '对方');
                const userInfo = this.app.wechatData.getUserInfo();
                const userAvatar = userInfo.avatar || '';
                const inviterAvatar = senderAvatar || this.app.currentChat?.avatar || '';
                const stateClass = isAccepted ? 'state-active' : (isEnded ? 'state-ended' : 'state-invite');
                const statusText = isAccepted ? '<span class="message-music-card-dot"></span>正在共听' : (isEnded ? '共听已结束' : '邀请你一起听歌');
                const bottomText = isAccepted ? `你和 ${inviterName}` : (isEnded ? `你和 ${inviterName}` : `来自 ${inviterName}`);
                messageBody = `
                    <div class="message-music-card ${stateClass}" data-message-id="${this._escapeHtml(msg.id || '')}">
                        <div class="message-music-card-bg" style="background-image:url('${coverUrl}')"></div>
                        <div class="message-music-card-overlay"></div>
                        <div class="message-music-card-content">
                            <div class="message-music-card-top">
                                <div class="message-music-card-visual">
                                    <div class="message-music-card-vinyl"></div>
                                    <img class="message-music-card-cover" src="${coverUrl}" alt="" onerror="this.src='${fallbackCover}'">
                                </div>
                                <div class="message-music-card-info">
                                    <div class="message-music-card-status">${statusText}</div>
                                    <div class="message-music-card-title">${songTitle}</div>
                                    <div class="message-music-card-artist">${artistName}</div>
                                </div>
                            </div>
                            <div class="message-music-card-bottom">
                                <div class="message-music-card-users">
                                    <div class="message-music-card-avatars">
                                        ${isAccepted ? `
                                            <span>${this.app.renderAvatar(userAvatar, '😊', userInfo.name)}</span>
                                            <span>${this.app.renderAvatar(inviterAvatar, '👤', inviterName)}</span>
                                        ` : `
                                            <span>${this.app.renderAvatar(inviterAvatar, '👤', inviterName)}</span>
                                        `}
                                    </div>
                                    <span class="message-music-card-user-text">${bottomText}</span>
                                </div>
                                ${isAccepted || isEnded ? `
                                    <span class="message-music-card-ended">${isAccepted ? '共听中' : (isRejected ? '已拒绝' : '已结束')}</span>
                                ` : `
                                    <div class="message-music-card-actions">
                                        <button type="button" class="message-music-card-btn is-glass" data-action="reject-music-invite" data-message-id="${this._escapeHtml(msg.id || '')}">拒绝</button>
                                        <button type="button" class="message-music-card-btn is-primary" data-action="accept-music-invite" data-message-id="${this._escapeHtml(msg.id || '')}">接受</button>
                                    </div>
                                `}
                            </div>
                        </div>
                    </div>
                `;
                break;
            }

            case 'honey_invite': {
                const statusText = String(msg.honeyInviteStatus || msg.status || '').trim();
                const displayStatus = statusText || (isMe ? '等待回应' : '等待中...');
                const statusClass = /拒绝/.test(displayStatus)
                    ? 'is-rejected'
                    : (/接受/.test(displayStatus) ? 'is-accepted' : 'is-waiting');
                messageBody = `
                <div class="message-honey-invite ${statusClass}">
                    <div class="message-honey-invite-head">
                        <span class="message-honey-invite-title">蜜语邀约</span>
                        <span class="message-honey-invite-badge">${isMe ? '已发送' : '微信好友'}</span>
                    </div>
                    <div class="message-honey-invite-sub">直播间</div>
                    <div class="message-honey-invite-foot">${this._escapeHtml(displayStatus)}</div>
                </div>
            `;
                break;
            }

            default:
                // 🔥 普通文本消息（引用在气泡外下方显示）
                messageBody = this.renderTextMessageBubble(msg.content, { isGroupChat });
                break;
        }

        // 🔥 引用内容：独立的 div，不影响气泡宽度
        const quoteHtml = msg.quote ? `<div style="font-size: 10px; color: #888; background: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: 3px; margin-top: 3px; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;">${this._escapeHtml(msg.quote.sender)}: ${this._escapeHtml(msg.quote.content.length > 10 ? msg.quote.content.substring(0, 10) + '...' : msg.quote.content)}</div>` : '';

        return `
        <div class="chat-message ${isMe ? 'message-right' : 'message-left'}${selectionClass}${selectedClass}" data-message-id="${this._escapeHtml(messageId)}" data-message-index="${Number(messageIndex)}">
            ${selectionCheckHtml}
            ${!isMe ? `<div class="message-avatar">${this.app.renderAvatar(senderAvatar, '👤', senderName)}</div>` : ''}
            <div class="message-content" style="display: inline-flex; flex-direction: column; ${isMe ? 'align-items: flex-end;' : 'align-items: flex-start;'}">
                ${!isMe && isGroupChat ? `<div class="message-sender" style="font-size: 12px; color: #576b95; margin-bottom: 2px;">${this._escapeHtml(senderName)}</div>` : ''}
                <div style="display: inline-block; max-width:100%;">${messageBody}</div>
                ${quoteHtml}
            </div>
            ${isMe ? `<div class="message-avatar">${this.app.renderAvatar(userInfo.avatar, '😊', userInfo.name)}</div>` : ''}
        </div>
    `;
    }

    extractInnerThought(content) {
        const source = String(content ?? '');
        const thoughts = [];
        const visibleContent = source.replace(/\[\s*内心\s*\]\s*[（(]\s*([\s\S]*?)\s*[）)]/g, (_match, thought) => {
            const text = String(thought || '').trim();
            if (text) thoughts.push(text);
            return '';
        }).replace(/[ \t]{2,}/g, ' ').trim();

        return {
            visibleContent,
            innerThought: thoughts.join('\n')
        };
    }

    renderTextMessageBubble(content, { isGroupChat = false } = {}) {
        const parsed = this.extractInnerThought(content);
        const cleanContent = parsed.visibleContent || (parsed.innerThought ? '...' : content);
        const visibleText = this._stripCallSpeechPrefix(cleanContent);
        const visibleHtml = this.parseEmoji(visibleText);

        if (!parsed.innerThought || isGroupChat) {
            return `<div class="message-text">${visibleHtml}</div>`;
        }

        return `
            <div class="wechat-inner-os-wrapper">
                <div class="message-text wechat-inner-os-bubble">
                    ${visibleHtml}
                    <button class="wechat-inner-os-fold" type="button" aria-label="查看内心OS"></button>
                </div>
                <div class="wechat-inner-os-popup" role="note">
                    <div class="wechat-inner-os-title">INNER THOUGHTS</div>
                    <div class="wechat-inner-os-content">${this._escapeHtml(parsed.innerThought)}</div>
                </div>
            </div>
        `;
    }

    renderEmojiPanel() {
        const emojis = [
            // 😀 表情情绪
            '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘',
            '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥳', '🤩',
            '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤',
            '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫',
            '🫢', '🫣', '🫡', '😴', '🤤', '😪', '😵', '😵‍💫', '🤐', '😶', '🙄', '😬',

            // 👋 手势
            '👋', '🤚', '🖐️', '✋', '🖖', '🫱', '🫲', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙',
            '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🙏',

            // ❤️ 常用符号
            '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝',
            '⭐', '✨', '⚡', '🔥', '💧', '🌈', '☀️', '🌙', '🍀', '🎉', '🎊', '🎁',

            // 🐶 常见动物
            '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐤', '🐧', '🐦',

            // 🍔 食物与出行
            '🍎', '🍓', '🍉', '🍔', '🍟', '🍕', '☕', '🍺', '🚗', '🚕', '🚌', '🚇', '✈️', '🚀'
        ];

        const customEmojis = this.app.wechatData.getCustomEmojis();
        this._syncCustomEmojiSelectionWithData();
        const customMode = this.emojiTab === 'custom';
        const isSelectionMode = customMode && this.customEmojiSelectionMode;
        const selectedCount = this.selectedCustomEmojiIds.size;
        const customIds = customEmojis.map(emoji => String(emoji?.id || '').trim()).filter(Boolean);
        const allSelected = customIds.length > 0 && customIds.every(id => this.selectedCustomEmojiIds.has(id));

        return `
        <div class="emoji-panel">
            <!-- 🔥 新增：表情标签 -->
            <div class="emoji-tabs">
                <div class="emoji-tab ${this.emojiTab !== 'custom' ? 'active' : ''}" data-tab="default">
                    系统表情
                </div>
                <div class="emoji-tab ${this.emojiTab === 'custom' ? 'active' : ''}" data-tab="custom">
                    我的表情
                </div>
            </div>

            ${customMode ? `
            <div class="emoji-custom-toolbar" style="display:flex; gap:6px; padding:8px 10px 6px; border-bottom:1px solid rgba(0,0,0,0.08); background:transparent;">
                <button id="toggle-custom-emoji-manage" style="flex:1; border:1px solid ${isSelectionMode ? 'rgba(0,0,0,0.14)' : 'rgba(7,193,96,0.25)'}; border-radius:10px; background:${isSelectionMode ? 'rgba(0,0,0,0.06)' : 'rgba(7,193,96,0.14)'}; color:${isSelectionMode ? '#555' : '#0b8f52'}; font-size:12px; font-weight:600; padding:7px 8px;">
                    ${isSelectionMode ? '完成' : '多选删除'}
                </button>
                <button id="delete-selected-custom-emoji" ${!isSelectionMode || selectedCount === 0 ? 'disabled' : ''} style="flex:1; border:1px solid ${isSelectionMode && selectedCount > 0 ? 'rgba(255,59,48,0.25)' : 'rgba(0,0,0,0.08)'}; border-radius:10px; background:${isSelectionMode && selectedCount > 0 ? 'rgba(255,59,48,0.12)' : 'rgba(0,0,0,0.05)'}; color:${isSelectionMode && selectedCount > 0 ? '#c53030' : '#aaa'}; font-size:12px; font-weight:600; padding:7px 8px;">
                    删除选中${selectedCount > 0 ? `(${selectedCount})` : ''}
                </button>
                <button id="clear-custom-emoji-all" ${customEmojis.length === 0 ? 'disabled' : ''} style="flex:1; border:1px solid ${customEmojis.length > 0 ? 'rgba(217,83,79,0.26)' : 'rgba(0,0,0,0.08)'}; border-radius:10px; background:${customEmojis.length > 0 ? 'rgba(217,83,79,0.12)' : 'rgba(0,0,0,0.05)'}; color:${customEmojis.length > 0 ? '#b54742' : '#aaa'}; font-size:12px; font-weight:600; padding:7px 8px;">
                    一键清空
                </button>
            </div>
            ${isSelectionMode ? `
            <div style="padding:0 10px 6px; font-size:11px; color:#888;">
                当前处于多选删除模式，点击表情可勾选。<button id="select-all-custom-emoji" style="border:none; background:transparent; color:#07c160; font-size:11px; padding:0; margin-left:4px;">${allSelected ? '取消全选' : '全选'}</button>
            </div>
            ` : ''}
            ` : ''}

           <div class="emoji-scroll">
                <div class="emoji-grid">
                    ${this.emojiTab === 'custom' ? `
                        <!-- 自定义表情 -->
                        ${customEmojis.map(emoji => `
                            <span class="emoji-item custom-emoji-item ${isSelectionMode && this.selectedCustomEmojiIds.has(String(emoji.id || '')) ? 'is-selected' : ''}" data-emoji-type="custom" data-emoji-id="${this._escapeHtml(emoji.id || '')}" data-selection-mode="${isSelectionMode ? '1' : '0'}" title="${this._escapeHtml(String(emoji.description || emoji.name || '表情'))}" style="position:relative;${isSelectionMode && this.selectedCustomEmojiIds.has(String(emoji.id || '')) ? 'outline:2px solid #07c160; outline-offset:1px; border-radius:10px;' : ''}">
                                <img src="${this.escapeInlineStickerAttr(emoji.image || '')}" alt="${this._escapeHtml(emoji.name || '')}">
                                ${isSelectionMode ? `<span style="position:absolute; top:2px; right:2px; width:14px; height:14px; border-radius:50%; background:${this.selectedCustomEmojiIds.has(String(emoji.id || '')) ? '#07c160' : 'rgba(255,255,255,0.9)'}; border:1px solid ${this.selectedCustomEmojiIds.has(String(emoji.id || '')) ? '#07c160' : '#ccc'}; color:#fff; font-size:10px; line-height:12px; text-align:center;">${this.selectedCustomEmojiIds.has(String(emoji.id || '')) ? '✓' : ''}</span>` : ''}
                            </span>
                        `).join('')}

                        <!-- 添加表情按钮 -->
                        <span class="emoji-item emoji-add" id="add-custom-emoji" style="${isSelectionMode ? 'opacity:0.45; pointer-events:none;' : ''}">
                            <i class="fa-solid fa-plus"></i>
                        </span>
                    ` : `
                        <!-- 系统表情 -->
                        ${emojis.map(emoji => `
                            <span class="emoji-item" data-emoji="${emoji}" title="${emoji}">${this.renderTwemojiEmoji(emoji, 20, false)}</span>
                        `).join('')}
                    `}
                </div>
            </div>
        </div>
    `;
    }

    getTwemojiUrl(emoji) {
        if (!emoji) return '';
        const codePoints = Array.from(String(emoji))
            .map(ch => ch.codePointAt(0).toString(16).toLowerCase())
            .filter(cp => cp !== 'fe0f');
        return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${codePoints.join('-')}.svg`;
    }

    _getSiliconflowImageConfig() {
        const storage = window.VirtualPhone?.storage || this.app?.storage;
        const apiKey = String(storage?.get('siliconflow_api_key') || '').trim();
        const model = String(storage?.get('image_generation_model') || '').trim() || 'Kwai-Kolors/Kolors';
        const width = Math.max(64, Math.min(2048, Number(storage?.get('phone-image-wechat-width') || 512) || 512));
        const height = Math.max(64, Math.min(2048, Number(storage?.get('phone-image-wechat-height') || 512) || 512));

        return {
            apiKey,
            model,
            endpoint: 'https://api.siliconflow.cn/v1/images/generations',
            imageSize: `${Math.round(width)}x${Math.round(height)}`,
            batchSize: 1,
            numInferenceSteps: 16,
            guidanceScale: 6.5,
            positivePromptSuffix: '二次元插画风, 非真人, 非照片, 非写实, 动漫感, 赛璐璐上色, 游戏CG质感, 杰作, 高质量, 细节清晰, 构图完整, 光线自然, 色彩干净, 单主体突出, 适合手机聊天展示',
            characterPositivePromptSuffix: '人物性别特征明确, 不要中性化, 主体明确, 面部与肢体自然',
            scenePositivePromptSuffix: '纯场景构图, 纯物体特写或空镜画面, 画面中不要出现人物, 不要出现角色, 不要出现路人, 不要出现人形轮廓, 不要出现手脚或身体局部',
            negativePrompt: '真人, 写实, 摄影感, 照片感, 低质量, 最差质量, 模糊, 锯齿, JPEG压缩痕迹, 多余肢体, 畸形手指, 五官错位, 性别模糊, 中性外观, 文本, 水印, 签名, 用户名',
            noPeopleNegativePrompt: '人物, 人类, 角色, 路人, 肖像, 半身像, 全身像, 人脸, 头部特写, 手, 手臂, 腿, 脚, 身体局部, 拟人化角色'
        };
    }

    _buildSiliconflowPrompt(rawPrompt, positivePromptSuffix = '') {
        const prompt = String(rawPrompt || '').trim();
        const suffix = String(positivePromptSuffix || '').trim();
        if (!prompt) return suffix;
        if (!suffix) return prompt;
        return `${prompt}，${suffix}`;
    }

    _promptLikelyNeedsCharacter(rawPrompt) {
        const prompt = String(rawPrompt || '').trim();
        if (!prompt) return false;

        const humanIndicators = [
            '人物', '角色', '人像', '肖像', '少年', '少女', '男生', '女生', '男人', '女人', '男孩', '女孩',
            '帅哥', '美女', '男主', '女主', '主角', '偶像', '主播', '老师', '同学', '妈妈', '爸爸', '情侣',
            'coser', '模特', '骑士', '公主', '王子', '精灵', '猫娘', '狐娘', '兽耳', '女仆', '拟人',
            'character', 'person', 'people', 'girl', 'boy', 'man', 'woman', 'portrait', 'human'
        ];

        return humanIndicators.some(token => prompt.toLowerCase().includes(token.toLowerCase()));
    }

    _buildSiliconflowNegativePrompt(rawPrompt, baseNegativePrompt = '', noPeopleNegativePrompt = '') {
        const negatives = [
            String(baseNegativePrompt || '').trim()
        ];

        if (!this._promptLikelyNeedsCharacter(rawPrompt)) {
            negatives.push(String(noPeopleNegativePrompt || '').trim());
        }

        return negatives.filter(Boolean).join(', ');
    }

    _buildSiliconflowPositivePrompt(rawPrompt, config = {}) {
        const prompt = String(rawPrompt || '').trim();
        const parts = [
            prompt,
            String(config.positivePromptSuffix || '').trim()
        ];

        if (this._promptLikelyNeedsCharacter(prompt)) {
            parts.push(String(config.characterPositivePromptSuffix || '').trim());
        } else {
            parts.push(String(config.scenePositivePromptSuffix || '').trim());
        }

        return parts.filter(Boolean).join('，');
    }

    _getVisibleChatMessagesContainer(chatId = null) {
        const targetChatId = String(chatId || '').trim();
        const activeChatId = String(this.app.currentChat?.id || '').trim();
        if (targetChatId && activeChatId && activeChatId !== targetChatId) return null;

        const currentView = this.getCurrentWechatView ? this.getCurrentWechatView() : null;
        const escapedChatId = this._escapeCssIdentifier(targetChatId);
        const selector = targetChatId
            ? `#chat-messages[data-chat-id="${escapedChatId}"]`
            : '#chat-messages';
        return currentView?.querySelector?.(selector)
            || document.querySelector(`.phone-view-current ${selector}`)
            || currentView?.querySelector?.('#chat-messages')
            || document.querySelector('.phone-view-current #chat-messages')
            || document.getElementById('chat-messages');
    }

    _getCurrentChatRoom(chatId = null) {
        const targetChatId = String(chatId || this.app.currentChat?.id || '').trim();
        const currentView = this.getCurrentWechatView ? this.getCurrentWechatView() : null;
        if (targetChatId) {
            const selector = `.chat-room[data-chat-id="${this._escapeCssIdentifier(targetChatId)}"]`;
            const matched = currentView?.querySelector?.(selector)
                || document.querySelector(`.phone-view-current ${selector}`);
            if (matched) return matched;
        }
        return currentView?.querySelector?.('.chat-room')
            || document.querySelector('.phone-view-current .chat-room')
            || document.querySelector('.chat-room');
    }

    _escapeCssIdentifier(value) {
        const text = String(value || '');
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
            return CSS.escape(text);
        }
        return text.replace(/["\\]/g, '\\$&');
    }

    _refreshVisibleChatMessages(chatId) {
        const activeChatId = String(this.app.currentChat?.id || '').trim();
        const targetChatId = String(chatId || '').trim();
        if (!activeChatId || !targetChatId || activeChatId !== targetChatId) return;

        const messages = this.app.wechatData.getMessages(targetChatId);
        const userInfo = this.app.wechatData.getUserInfo();
        this.smartUpdateMessages(messages, userInfo, { chatId: targetChatId });
    }

    _toggleImagePromptCard(cardEl, showBack) {
        if (!cardEl) return;
        const front = cardEl.querySelector('.message-image-prompt-front-panel');
        const back = cardEl.querySelector('.message-image-prompt-back-panel');
        if (!front || !back) return;
        front.style.display = showBack ? 'none' : 'block';
        back.style.display = showBack ? 'block' : 'none';
    }

    async generateImagePromptMessage(messageId) {
        const chatId = String(this.app.currentChat?.id || '').trim();
        const safeMessageId = String(messageId || '').trim();
        if (!chatId || !safeMessageId) return;
        const generationLockKey = `${chatId}:${safeMessageId}`;
        if (this._imagePromptGenerationLocks.has(generationLockKey)) return;

        const messages = this.app.wechatData.getMessages(chatId);
        const message = messages.find((item) => String(item?.id || '').trim() === safeMessageId);
        if (!message) return;

        const status = String(message.imageGenStatus || '').trim();
        if (status === 'loading') return;
        this._imagePromptGenerationLocks.add(generationLockKey);

        const rawPromptText = String(message.imagePrompt || message.content || '').trim();
        const parsedRawPrompt = this._parseImagePromptText(rawPromptText);
        const promptText = String(parsedRawPrompt.prompt || rawPromptText).trim();
        if (!promptText) {
            this._imagePromptGenerationLocks.delete(generationLockKey);
            this.app.phoneShell?.showNotification('提示', '这条图片消息缺少描述，无法生成', '⚠️');
            return;
        }
        const parsedCurrentPrompt = this._parseImagePromptText(String(message.content || rawPromptText || ''));
        const descriptionText = String(message.imageDescription || parsedRawPrompt.description || parsedCurrentPrompt.description || promptText).trim();
        const allowChinesePrompt = this._isWechatImageProviderOpenAI();
        if (this._hasCjkText(promptText) && !allowChinesePrompt) {
            this._imagePromptGenerationLocks.delete(generationLockKey);
            this.app.phoneShell?.showNotification('生图格式错误', '缺少英文生图Tag，请使用 [图片]（中文描述）（English tags）', '⚠️');
            this.app.wechatData.updateMessageById(chatId, safeMessageId, {
                imagePrompt: promptText,
                imageDescription: descriptionText,
                imageGenStatus: 'failed',
                imageGenError: '缺少英文生图Tag：第二个括号必须只写英文逗号分隔 tags'
            });
            this._refreshVisibleChatMessages(chatId);
            return;
        }

        const imageManager = window.VirtualPhone?.imageGenerationManager;
        if (!imageManager || typeof imageManager.generate !== 'function') {
            this._imagePromptGenerationLocks.delete(generationLockKey);
            this.app.phoneShell?.showNotification('生图失败', '生图管理器未初始化', '❌');
            return;
        }
        const storage = this.app?.storage || window.VirtualPhone?.storage || null;
        if (storage && imageManager.storage !== storage) {
            imageManager.storage = storage;
        }
        const novelAIReferences = await this._buildWechatPersonalImageReferences(message);
        const generationPrompt = this._buildWechatImagePromptWithContactTags(message, promptText);
        const generationId = `wechat_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const previousImageUrl = String(message.generatedImageUrl || '').trim();

        this.app.wechatData.updateMessageById(chatId, safeMessageId, {
            imageGenStatus: 'loading',
            imageGenerationId: generationId,
            imageGenError: '',
            imagePrompt: promptText,
            imageDescription: descriptionText,
            generatedImageUrl: '',
            imageModel: '',
            imageProvider: '',
            imageGenerationWidth: '',
            imageGenerationHeight: ''
        });
        this._refreshVisibleChatMessages(chatId);

        try {
            const result = await imageManager.generate({
                app: 'wechat',
                prompt: generationPrompt,
                novelAIReferences,
                referenceImages: novelAIReferences
            });
            const rawImageUrl = String(result?.imageUrl || result?.imageData || '').trim();
            const imageUrl = await this._persistWechatGeneratedImage(rawImageUrl, {
                chatId,
                messageId: safeMessageId,
                promptText,
                generationId
            });
            if (!imageUrl) {
                throw new Error('接口返回成功，但没有拿到图片地址');
            }
            const latestMessage = this.app.wechatData.getMessages(chatId)
                .find((item) => String(item?.id || '').trim() === safeMessageId);
            if (String(latestMessage?.imageGenerationId || '') !== generationId) return;

            this.app.wechatData.updateMessageById(chatId, safeMessageId, {
                imagePrompt: promptText,
                imageDescription: descriptionText,
                generatedImageUrl: imageUrl,
                imageGenStatus: 'done',
                imageGenError: '',
                imageModel: String(result?.model || '').trim(),
                imageProvider: String(result?.provider || '').trim(),
                imageGenerationWidth: Number(result?.width || result?.requestedWidth || 0) || '',
                imageGenerationHeight: Number(result?.height || result?.requestedHeight || 0) || ''
            });
            this._cleanupReplacedWechatGeneratedImage(previousImageUrl, imageUrl);
            this._refreshVisibleChatMessages(chatId);
        } catch (error) {
            const rawMessage = String(error?.message || '').trim();
            const friendlyMessage = /安全策略拒绝|content[_\s-]?policy|content[_\s-]?filter|policy[_\s-]?violation|moderation|safety/i.test(rawMessage)
                ? rawMessage
                : /failed to fetch|networkerror|load failed/i.test(rawMessage)
                ? '请求失败，可能是网络异常或浏览器跨域拦截'
                : (rawMessage || '未知错误');

            console.error('微信图片生成失败:', error);

            const latestMessage = this.app.wechatData.getMessages(chatId)
                .find((item) => String(item?.id || '').trim() === safeMessageId);
            if (String(latestMessage?.imageGenerationId || '') !== generationId) return;

            this.app.wechatData.updateMessageById(chatId, safeMessageId, {
                imagePrompt: promptText,
                imageDescription: descriptionText,
                imageGenStatus: 'failed',
                imageGenError: friendlyMessage
            });
            this._refreshVisibleChatMessages(chatId);
            this.app.phoneShell?.showNotification('生图失败', friendlyMessage, '❌');
        } finally {
            this._imagePromptGenerationLocks.delete(generationLockKey);
        }
    }

    async _persistWechatGeneratedImage(imageUrl, { chatId = '', messageId = '', promptText = '', generationId = '' } = {}) {
        const safeUrl = String(imageUrl || '').trim();
        if (!safeUrl) return '';
        if (/^\/backgrounds\/phone_[^?#]+/i.test(safeUrl)) return safeUrl;

        const imageUploader = window.VirtualPhone?.imageManager;
        if (!imageUploader?.uploadBlob) {
            throw new Error('图片上传管理器未初始化，无法保存微信生图');
        }

        const blob = await this._loadGeneratedWechatImageBlob(safeUrl);
        const uniquePart = String(generationId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_');
        const seed = `${chatId || 'chat'}_${messageId || 'msg'}_${this._simpleImageHash(promptText || safeUrl).toString(36)}_${uniquePart}`;
        const uploadedUrl = await imageUploader.uploadBlob(blob, `wechat_img_${seed}`);
        const normalized = String(uploadedUrl || '').trim();
        if (!/^\/backgrounds\/phone_[^?#]+/i.test(normalized)) {
            throw new Error('微信生图保存失败：未得到有效本地图片路径');
        }
        return normalized;
    }

    async _loadGeneratedWechatImageBlob(imageUrl) {
        const safeUrl = String(imageUrl || '').trim();
        if (!safeUrl) throw new Error('生图结果为空');
        const response = await fetch(safeUrl, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`读取微信生图失败（HTTP ${response.status}）`);
        }
        const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const arrayBuffer = await response.arrayBuffer();
        if (!arrayBuffer || arrayBuffer.byteLength <= 0) {
            throw new Error('微信生图结果不是有效图片');
        }
        const bytes = new Uint8Array(arrayBuffer);
        const mime = /^image\//i.test(contentType)
            ? contentType
            : this._detectGeneratedWechatImageMime(bytes);
        if (!mime) throw new Error('微信生图结果不是有效图片');
        const blob = new Blob([arrayBuffer], { type: mime });
        return blob;
    }

    _detectGeneratedWechatImageMime(bytes) {
        if (!bytes || bytes.length < 4) return '';
        if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
        if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
        if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
        if (
            bytes.length >= 12 &&
            bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
            bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
        ) {
            return 'image/webp';
        }
        return '';
    }

    _simpleImageHash(text) {
        const str = String(text || '');
        let hash = 2166136261;
        for (let i = 0; i < str.length; i += 1) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    _getManagedWechatGeneratedImageUrl(message) {
        const raw = String(message?.generatedImageUrl || '').trim();
        const match = raw.match(/\/backgrounds\/phone_wechat_img_[^?#\s)）]+/i);
        return match?.[0] || '';
    }

    _collectManagedWechatGeneratedImages(messages = []) {
        const list = Array.isArray(messages) ? messages : [messages];
        return [...new Set(list
            .map(msg => this._getManagedWechatGeneratedImageUrl(msg))
            .filter(Boolean))];
    }

    _cleanupWechatGeneratedImages(urls = []) {
        const imageManager = window.VirtualPhone?.imageManager;
        if (!imageManager?.deleteManagedBackgroundByPath) return;
        [...new Set((Array.isArray(urls) ? urls : [urls]).map(url => String(url || '').trim()).filter(Boolean))]
            .forEach((url) => {
                imageManager.deleteManagedBackgroundByPath(url, {
                    quiet: true,
                    skipIfReferenced: true
                }).catch(() => {});
            });
    }

    _cleanupReplacedWechatGeneratedImage(oldUrl, nextUrl) {
        const oldPath = String(oldUrl || '').trim();
        const nextPath = String(nextUrl || '').trim();
        if (!oldPath || oldPath === nextPath || !/^\/backgrounds\/phone_wechat_img_/i.test(oldPath)) return;
        this._cleanupWechatGeneratedImages([oldPath]);
    }

    _openPhoneImageViewer(imageUrl, alt = '') {
        const safeUrl = String(imageUrl || '').trim();
        if (!safeUrl) return;
        this.app?.phoneShell?.showImageViewer?.(safeUrl, { alt });
    }

    async _imageUrlToWechatReferenceDataUrl(url) {
        const safeUrl = String(url || '').trim();
        if (!safeUrl) return '';
        if (safeUrl.startsWith('data:image/')) return safeUrl;
        const response = await fetch(safeUrl, {
            credentials: 'include',
            cache: 'no-store'
        });
        if (!response.ok) {
            throw new Error(`个人形象参考图读取失败 (${response.status})`);
        }
        const blob = await response.blob();
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('个人形象参考图读取失败'));
            reader.readAsDataURL(blob);
        });
        if (!dataUrl.startsWith('data:image/')) return '';
        return dataUrl;
    }

    _resolveWechatPersonalReferenceContact(message = {}) {
        const mediaType = String(message?.mediaType || '').trim();
        const contentText = String(message?.rawContent || message?.displayContent || message?.content || '').trim();
        const explicitPersonalReference = message?.usePersonalReference === true;
        const isPersonalImage = explicitPersonalReference
            || mediaType === '个人图片'
            || /^\[\s*个人图片\s*\]/.test(contentText);
        if (!isPersonalImage || mediaType === '视频') return null;
        if (mediaType === '图片' && !explicitPersonalReference && !/^\[\s*个人图片\s*\]/.test(contentText)) return null;
        const senderName = String(message.from || message.sender || message.contactName || '').trim();
        if (!senderName || senderName === 'me') return null;
        const contacts = this.app?.wechatData?.getContacts?.() || [];
        const normalize = (value) => this._normalizeLookupName(value);
        const senderKey = normalize(senderName);
        return contacts.find(contact => this.app.wechatData._isSameLookupName?.(contact.name, senderName))
            || contacts.find(contact => String(contact?.name || '').trim() === senderName)
            || contacts.find(contact => {
                const contactKey = normalize(contact?.name);
                return contactKey
                    && senderKey
                    && (contactKey.includes(senderKey) || senderKey.includes(contactKey));
            })
            || null;
    }

    _buildWechatImagePromptWithContactTags(message = {}, promptText = '') {
        const parsedPrompt = this._parseImagePromptText(promptText);
        const basePrompt = String(parsedPrompt.prompt || promptText || '').trim();
        if (message?.useUserReference === true || String(message?.mediaType || '').trim() === '用户照片') {
            const userInfo = this.app?.wechatData?.getUserInfo?.() || {};
            const userTags = String(userInfo?.naiPromptTags || userInfo?.imageTags || '')
                .split(/[,，\n]+/)
                .map(tag => tag.trim())
                .filter(Boolean)
                .join(', ');
            if (!userTags) return basePrompt;
            if (!basePrompt) return userTags;
            return `${userTags}, ${basePrompt}`;
        }
        const contact = this._resolveWechatPersonalReferenceContact(message);
        const contactTags = String(contact?.naiPromptTags || contact?.imageTags || '')
            .split(/[,，\n]+/)
            .map(tag => tag.trim())
            .filter(Boolean)
            .join(', ');
        if (!contactTags) return basePrompt;
        if (!basePrompt) return contactTags;
        return `${contactTags}, ${basePrompt}`;
    }

    async _buildWechatPersonalImageReferences(message = {}) {
        const contact = this._resolveWechatPersonalReferenceContact(message);
        if (!contact) return [];
        const referenceImage = String(contact.naiReferenceImage || contact.referenceImage || '').trim();
        if (!referenceImage || contact.naiReferenceEnabled === false || contact.naiReferenceEnabled === 'false') return [];
        try {
            const image = await this._imageUrlToWechatReferenceDataUrl(referenceImage);
            if (!image) return [];
            const rawStrength = Number(contact.naiReferenceStrength ?? 0.7);
            const strength = Math.max(0, Math.min(1, Number.isFinite(rawStrength) ? rawStrength : 0.7));
            const rawInfo = Number(contact.naiReferenceInformationExtracted ?? 1);
            const informationExtracted = Math.max(0, Math.min(1, Number.isFinite(rawInfo) ? rawInfo : 1));
            return [{ image, strength, informationExtracted }];
        } catch (err) {
            console.warn('[Wechat NAI] 个人形象参考图读取失败，已跳过:', err);
            this.app?.phoneShell?.showNotification?.('微信', '个人形象参考图读取失败，本次将不使用参考图', '⚠️');
            return [];
        }
    }

    renderImagePromptCard(msg) {
        const displayPrompt = this._normalizeImagePromptDisplayFields(msg);
        const promptRaw = displayPrompt.prompt || '待生成图片';
        const promptText = this._escapeHtml(promptRaw);
        const descriptionRaw = displayPrompt.description || promptRaw;
        const descriptionText = this._escapeHtml(descriptionRaw);
        const promptLabel = this._hasCjkText(promptRaw) && !this._isWechatImageProviderOpenAI()
            ? '缺少英文Tag'
            : promptRaw;
        const promptLabelHtml = this._escapeHtml(promptLabel);
        const cardId = this.escapeInlineStickerAttr(String(msg?.id || `imgprompt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`));
        const generatedImageUrl = String(msg?.generatedImageUrl || '').trim();
        const safeImageUrl = this.escapeInlineStickerAttr(generatedImageUrl);
        const generationStatus = generatedImageUrl
            ? 'done'
            : (String(msg?.imageGenStatus || '').trim() || 'idle');
            
        // 🔥 根据是图片还是视频，动态显示不同的提示和图标
        const isVideo = msg?.mediaType === '视频';
        const actionText = isVideo ? '生成视频封面' : '生成图片';
        const defaultIcon = isVideo ? '<i class="fa-solid fa-video"></i>' : '<i class="fa-regular fa-image"></i>';

        const statusText = generationStatus === 'loading'
            ? `正在${actionText}中，请稍候...`
            : generationStatus === 'failed'
                ? '❌ 生成失败，点击重试'
                : `点击${actionText}`;

        return `
            <div class="message-image-box message-image-prompt-box" data-message-id="${cardId}" style="position: relative; display: inline-block; width: 156px; max-width: 100%;">
                <div class="message-image-prompt-front-panel" id="img-prompt-front-${cardId}" style="
                    width: 156px;
                    max-width: 100%;
                    aspect-ratio: 1;
                    border-radius: 10px;
                    overflow: hidden;
                    position: relative;
                    background: ${generatedImageUrl ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.02)'};
                    border: ${generatedImageUrl ? '1px solid rgba(255,255,255,0.18)' : '2px dashed rgba(156,156,166,0.6)'};
                    box-sizing: border-box;
                    cursor: ${generationStatus === 'loading' ? 'progress' : 'pointer'};
                ">
                    ${generatedImageUrl ? `
                        <img src="${safeImageUrl}" alt="${promptText}" style="width:100%; height:100%; object-fit:cover; display:block;">
                        ${isVideo ? `<div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none;"><div style="width:40px; height:40px; border-radius:50%; background:rgba(0,0,0,0.5); border:2px solid #fff; display:flex; align-items:center; justify-content:center; color:#fff; font-size:18px; padding-left:4px;"><i class="fa-solid fa-play"></i></div></div>` : ''}
                        <div class="message-image-prompt-regenerate" data-message-id="${cardId}" title="重新生成${msg.mediaType || '图片'}" style="
                            position:absolute;
                            left:6px;
                            bottom:6px;
                            background:rgba(0,0,0,0.55);
                            color:#fff;
                            border-radius:999px;
                            padding:4px 8px;
                            font-size:10px;
                            line-height:1;
                            cursor:pointer;
                            box-shadow:0 2px 8px rgba(0,0,0,0.18);
                        ">重新生成</div>
                        <div class="message-image-prompt-show-back" data-message-id="${cardId}" title="查看${msg.mediaType || '图片'}描述" style="
                            position:absolute;
                            right:6px;
                            bottom:6px;
                            background:rgba(0,0,0,0.55);
                            color:#fff;
                            border-radius:999px;
                            padding:4px 8px;
                            font-size:10px;
                            line-height:1;
                            cursor:pointer;
                            box-shadow:0 2px 8px rgba(0,0,0,0.18);
                        ">描述</div>
                    ` : `
                        <div class="message-image-prompt-generate" data-message-id="${cardId}" title="${generationStatus === 'failed' ? '点击重试' : `点击${actionText}`}" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:8px; padding:12px; box-sizing:border-box; background:transparent;">
                            <div style="
                                width:38px; height:34px; border-radius:0;
                                display:flex; align-items:center; justify-content:center;
                                background:transparent;
                                border:none;
                                color:rgba(156,156,166,0.9); font-size:25px;
                                box-shadow:none;
                            ">${generationStatus === 'loading' ? '<i class="fa-solid fa-spinner fa-spin"></i>' : defaultIcon}</div>
                            <div style="font-size:12px; line-height:1.35; color:rgba(156,156,166,0.95); text-align:center; font-weight:600; text-shadow:0 1px 2px rgba(0,0,0,0.18);">${statusText}</div>
                        </div>
                        <div class="message-image-prompt-show-back" data-message-id="${cardId}" title="查看${msg.mediaType || '图片'}描述" style="
                            position:absolute;
                            right:6px;
                            bottom:6px;
                            background:rgba(80,80,88,0.18);
                            color:rgba(156,156,166,0.95);
                            border-radius:999px;
                            padding:4px 8px;
                            font-size:10px;
                            line-height:1;
                            cursor:pointer;
                            box-shadow:none;
                        ">描述</div>
                    `}
                </div>
                <div class="message-image-prompt-back-panel" id="img-prompt-back-${cardId}" style="
                    display:none;
                    width:156px;
                    max-width:100%;
                    aspect-ratio:1;
                    background:rgba(255,255,255,0.02);
                    border:2px dashed rgba(156,156,166,0.6);
                    border-radius:10px;
                    box-sizing:border-box;
                    position:relative;
                    overflow:hidden;
                ">
                    <div style="
                        width:100%;
                        height:100%;
                        padding:10px;
                        padding-bottom:28px;
                        overflow-y:auto;
                        box-sizing:border-box;
                        display:flex;
                    ">
                        <div style="
                            margin:auto;
                            font-size:11px;
                            color:rgba(156,156,166,0.95);
                            line-height:1.5;
                            word-break:break-word;
                            white-space:pre-wrap;
                            text-align:center;
                            width:100%;
                            text-shadow:0 1px 2px rgba(0,0,0,0.18);
                        ">
                            <div style="font-weight:700; margin-bottom:6px;">中文描述</div>
                            <div>${descriptionText}</div>
                            <div style="font-weight:700; margin:10px 0 6px;">英文Tag</div>
                            <div>${promptLabelHtml}</div>
                        </div>
                    </div>
                    <div class="message-image-prompt-restore" data-message-id="${cardId}" title="恢复卡片正面" style="
                        position:absolute;
                        bottom:4px;
                        right:4px;
                        background:rgba(80,80,88,0.18);
                        color:rgba(156,156,166,0.95);
                        border-radius:999px;
                        padding:3px 6px;
                        font-size:10px;
                        cursor:pointer;
                        z-index:10;
                        display:flex;
                        align-items:center;
                        gap:3px;
                        box-shadow:none;
                    ">
                        ${defaultIcon} 恢复
                    </div>
                </div>
            </div>
        `;
    }

    _formatWeiboCardForPrompt(msg = {}) {
        const normalizeText = (value) => this.cleanAbnormalSpaces(String(value || '')
            .replace(/\r\n/g, '\n')
            .replace(/&nbsp;/gi, ' ')
            .replace(/\u00a0/g, ' ')
            .replace(/\u3000/g, ' ')
            .split('\n')
            .map(line => line.trim())
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim());

        const isPlaceholderOnly = (value) => {
            const text = normalizeText(value);
            return !text || /^\[(?:微博分享|微博新闻|weibo_card)\]$/i.test(text);
        };

        const formatMedia = (raw, index) => {
            const text = normalizeText(raw);
            if (!text) return '';
            const tagged = text.match(/^\[(用户照片|个人图片|图片|视频)\]\s*([\s\S]*)$/);
            if (tagged) {
                const type = tagged[1] || '图片';
                const desc = String(tagged[2] || '').trim();
                return desc ? `[${type}]${desc}` : `[${type}${index ? index + 1 : ''}]`;
            }
            if (/^(?:https?:|data:image|blob:)/i.test(text) || /\.(?:png|jpe?g|gif|webp|avif)(?:[?#].*)?$/i.test(text)) {
                return `[图片${index ? index + 1 : ''}]`;
            }
            return text;
        };

        const wb = msg?.weiboData && typeof msg.weiboData === 'object' ? msg.weiboData : {};
        const hasWeiboData = Object.keys(wb).length > 0;
        const fullContent = normalizeText(msg.content);
        if (!hasWeiboData) {
            return isPlaceholderOnly(fullContent) ? '[微博分享]' : (fullContent || '[微博分享]');
        }

        const lines = [];
        const blogger = normalizeText(wb.blogger || '');
        const bloggerType = normalizeText(wb.bloggerType || '');
        const body = normalizeText(wb.content || '');
        const time = normalizeText(wb.originalTime || wb.time || '');
        const device = normalizeText(wb.device || '');
        const forward = Number.parseInt(wb.forward, 10) || 0;
        const commentsCount = Number.parseInt(wb.comments, 10) || (Array.isArray(wb.commentList) ? wb.commentList.length : 0);
        const likes = Number.parseInt(wb.likes, 10) || 0;

        lines.push(`[微博分享]${blogger ? ` ${blogger}${bloggerType ? `（${bloggerType}）` : ''}` : ''}`);
        if (time || device) lines.push(`时间：${[time, device ? `来自${device}` : ''].filter(Boolean).join(' ')}`);
        if (body) lines.push(`正文：${body}`);

        const mediaLines = (Array.isArray(wb.images) ? wb.images : [])
            .map((item, index) => formatMedia(item, index))
            .filter(Boolean);
        if (mediaLines.length > 0) lines.push(`配图：${mediaLines.join(' ')}`);
        if (forward || commentsCount || likes) lines.push(`数据：转发 ${forward} | 评论 ${commentsCount} | 点赞 ${likes}`);

        const commentLines = (Array.isArray(wb.commentList) ? wb.commentList : [])
            .map((comment) => {
                const name = normalizeText(comment?.name || '网友');
                const replyTo = normalizeText(comment?.replyTo || '');
                const location = normalizeText(comment?.location || '');
                const text = normalizeText(comment?.text || '');
                if (!text) return '';
                const replyText = replyTo ? `回复${replyTo}` : '';
                const locationText = location ? `（ip${location}）` : '';
                return `${name}${locationText}${replyText}：${text}`;
            })
            .filter(Boolean);
        if (commentLines.length > 0) {
            lines.push('评论区：');
            lines.push(...commentLines);
        }

        const rebuilt = lines.filter(Boolean).join('\n').trim();
        if (rebuilt && rebuilt !== '[微博分享]') return rebuilt;
        return isPlaceholderOnly(fullContent) ? '[微博分享]' : (fullContent || '[微博分享]');
    }

    _formatMessageContentForPrompt(msg, targetChat = null) {
        if (!msg || typeof msg !== 'object') return '';
        if (msg.hiddenFromPrompt === true || msg.isTimeMarker === true || msg.type === 'time_marker') return '';

        const normalizeImageName = (raw = '') => String(raw || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 20);
        const inferImageNameFromPath = (imagePath = '') => {
            const rawPath = String(imagePath || '').trim();
            if (!rawPath) return '';
            try {
                const noQuery = rawPath.split('?')[0].split('#')[0];
                const basename = noQuery.split('/').pop() || '';
                const decoded = decodeURIComponent(basename);
                const withoutExt = decoded.replace(/\.[^.]+$/, '').trim();
                if (!withoutExt) return '';
                // 服务端生成名对用户无意义，直接回退为通用名称
                if (/^phone_emoji_\d+_\d+$/i.test(withoutExt)) return '图片';
                return normalizeImageName(withoutExt);
            } catch (e) {
                return '';
            }
        };
        const getImageDisplayName = () => {
            const fromDesc = normalizeImageName(msg.customEmojiDescription || msg.customEmojiName || '');
            if (fromDesc) return fromDesc;
            const fromPath = inferImageNameFromPath(msg.content);
            if (fromPath) return fromPath;
            return '图片';
        };

        if (msg.type === 'text') return String(msg.content || '');
        if (msg.type === 'image') {
            return `[图片]（${getImageDisplayName()}）`;
        }
        if (msg.type === 'image_prompt') return this._formatImagePromptTagForPrompt(msg);
        if (msg.type === 'sticker') {
            const stickerValue = String(msg.stickerUrl || msg.keyword || msg.content || '表情包').trim() || '表情包';
            return `[表情包]（${stickerValue}）`;
        }
        if (msg.type === 'call_record') {
            const isGroupCall = targetChat?.type === 'group';
            const callTypeName = msg.callType === 'video' ? '视频通话' : '语音通话';
            const status = String(msg.status || '').trim();
            const statusText = status === 'answered'
                ? `通话时长 ${msg.duration || '未知'}`
                : (status === 'rejected' || status === 'declined')
                    ? (isGroupCall ? '群成员未接听' : '对方已拒绝')
                    : status === 'cancelled'
                        ? '用户已取消'
                        : '未接听';
            return `[微信${isGroupCall ? '群' : ''}${callTypeName} - ${statusText}]`;
        }
        if (msg.type === 'poker_card') {
            const poker = msg.pokerData || {};
            const title = String(poker.title || '德州扑克牌局记录').trim();
            const content = String(poker.content || poker.desc || '').trim();
            const header = `[德州扑克分享]${title ? ` ${title}` : ''}`;
            return content ? `${header}\n${content}` : header;
        }
        if (msg.type === 'werewolf_card') {
            const werewolf = msg.werewolfData || {};
            const title = String(werewolf.title || '狼人杀复盘记录').trim();
            const content = String(werewolf.content || werewolf.desc || '').trim();
            const header = `[狼人杀复盘分享]${title ? ` ${title}` : ''}`;
            return content ? `${header}\n${content}` : header;
        }
        if (msg.type === 'weibo_card') {
            return this._formatWeiboCardForPrompt(msg);
        }
        if (msg.type === 'music_listen') {
            return this._formatMusicListenMessageForPrompt(msg, targetChat);
        }
        if (msg.type === 'music_invite') {
            const invite = msg.musicInvite || {};
            const songName = String(invite.songName || msg.songName || '').trim() || '未知歌曲';
            const artist = String(invite.artist || msg.artist || '').trim();
            const status = String(msg.musicInviteStatus || 'pending').trim();
            const songText = artist ? `《${songName}》 - ${artist}` : `《${songName}》`;
            if (status === 'accepted') return `${msg.from || '对方'}邀请用户一起听${songText}，用户已接受，双方正在一起听歌。`;
            if (status === 'ended' || status === 'cancelled') return `${msg.from || '对方'}邀请用户一起听${songText}，用户已接受，但现在一起听歌已结束。`;
            if (status === 'rejected') return `${msg.from || '对方'}邀请用户一起听${songText}，用户已拒绝。`;
            return `${msg.from || '对方'}邀请用户一起听${songText}，等待用户接受或拒绝。`;
        }
        if (msg.type === 'transfer') {
            const rawStatus = String(msg.status || '').trim();
            const status = rawStatus === 'received' ? '已收款' : (rawStatus === 'refunded' ? '已退回' : '未收款');
            return `[转账 ¥${msg.amount}]（状态：${status}）`;
        }
        if (msg.type === 'redpacket') {
            const rawStatus = String(msg.status || '').trim();
            const status = rawStatus === 'opened' ? '已领取' : (rawStatus === 'refunded' ? '已退回' : '未领取');
            return `[红包 ¥${msg.amount}]（状态：${status}）`;
        }
        return `[${msg.type}]`;
    }

    _formatMusicListenMessageForPrompt(msg = {}, targetChat = null) {
        const chat = targetChat || this.app?.currentChat || null;
        const activeSession = this.app?.wechatData?.getMusicListening?.(chat?.id) || null;
        const savedInfo = msg.musicListen || {};
        const snapshot = activeSession
            ? (window.VirtualPhone?.musicApp?.musicData?.getListeningSnapshot?.() || null)
            : null;
        const musicInfo = snapshot || savedInfo || activeSession || {};
        const songName = String(musicInfo.songName || savedInfo.songName || activeSession?.songName || '').trim() || '未知歌曲';
        const artist = String(musicInfo.artist || savedInfo.artist || activeSession?.artist || '').trim();
        const otherName = String(
            activeSession?.contactName
            || savedInfo.contactName
            || chat?.name
            || this.app?.wechatData?.getContact?.(activeSession?.contactId)?.name
            || '对方'
        ).trim();
        const songText = artist ? `《${songName}》 - ${artist}` : `《${songName}》`;
        const currentSeconds = Number(musicInfo.currentTime);
        const durationSeconds = Number(musicInfo.duration);
        const hasCurrentTime = Number.isFinite(currentSeconds) && currentSeconds >= 0;
        const progress = hasCurrentTime
            ? `，当前播放到 ${this._formatMusicListenTime(currentSeconds)}${Number.isFinite(durationSeconds) && durationSeconds > 0 ? ` / ${this._formatMusicListenTime(durationSeconds)}` : ''}`
            : '';
        const listenStatus = String(msg.musicListenStatus || '').trim();
        const isEnded = listenStatus === 'ended' || listenStatus === 'cancelled' || (!activeSession && msg.type === 'music_listen');

        if (isEnded) {
            if (msg.from === 'me') {
                return `用户曾邀请“${otherName}”一起听歌，歌曲是${songText}，但现在一起听歌已结束。`;
            }
            return `${otherName}曾发起一起听歌邀请，歌曲是${songText}，但现在一起听歌已结束。`;
        }

        if (msg.from === 'me') {
            return `用户邀请了“${otherName}”一起听歌。当前正在一起听${songText}${progress}。`;
        }
        return `${otherName}发起了一起听歌邀请。当前正在一起听${songText}${progress}。`;
    }

    _normalizeImagePromptDisplayFields(msg = {}) {
        const fallback = '待生成图片';
        const contentRaw = String(msg?.content || '').trim();
        const imagePromptRaw = String(msg?.imagePrompt || '').trim();
        const imageDescriptionRaw = String(msg?.imageDescription || '').trim();
        let prompt = imagePromptRaw || contentRaw || fallback;
        let description = imageDescriptionRaw || this._parseImagePromptText(contentRaw).description || prompt;
        const parsedCandidates = [imageDescriptionRaw, imagePromptRaw, contentRaw]
            .map(value => this._parseImagePromptText(value))
            .filter(parsed => parsed.description && parsed.prompt && parsed.description !== parsed.prompt);
        const splitCandidate = parsedCandidates.find(parsed => !this._hasCjkText(parsed.prompt)) || parsedCandidates[0];

        if (splitCandidate) {
            const descriptionLooksRaw = !description
                || description === prompt
                || this._looksLikeImagePromptMarkup(description)
                || (this._hasCjkText(description) && !this._hasCjkText(splitCandidate.prompt) && description.includes(splitCandidate.prompt));
            const promptLooksBad = !prompt
                || this._looksLikeImagePromptMarkup(prompt)
                || (this._hasCjkText(prompt) && !this._hasCjkText(splitCandidate.prompt));

            if (descriptionLooksRaw) description = splitCandidate.description;
            if (promptLooksBad) prompt = splitCandidate.prompt;
        }

        return {
            description: String(description || fallback).trim() || fallback,
            prompt: String(prompt || fallback).trim() || fallback
        };
    }

    _looksLikeImagePromptMarkup(value = '') {
        return /^\s*\[(?:用户照片|个人图片|图片|视频)\]/i.test(String(value || '').trim())
            || /^\s*[（(][\s\S]+[）)]\s*[（(][\s\S]+[）)]\s*$/.test(String(value || '').trim());
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

    _hasCjkText(value = '') {
        return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(String(value || ''));
    }

    _isWechatImageProviderOpenAI() {
        const imageManager = window.VirtualPhone?.imageGenerationManager;
        if (imageManager?.resolveProvider) {
            return String(imageManager.resolveProvider({ app: 'wechat' }) || '').trim().toLowerCase() === 'openai';
        }
        const storage = this.app?.storage || window.VirtualPhone?.storage;
        const appBindingsRaw = storage?.get?.('phone-image-provider-app-bindings');
        let appBindings = {};
        try {
            appBindings = typeof appBindingsRaw === 'string' ? JSON.parse(appBindingsRaw || '{}') : (appBindingsRaw || {});
        } catch (_e) {
            appBindings = {};
        }
        return String(appBindings?.wechat || storage?.get?.('phone-image-provider') || 'novelai').trim().toLowerCase() === 'openai';
    }

    _formatImagePromptTagForPrompt(msg = {}) {
        const mediaType = msg.useUserReference ? '用户照片' : (msg.usePersonalReference ? '个人图片' : (msg.mediaType || '图片'));
        const promptText = String(msg.imagePrompt || msg.content || '待生成图片').trim() || '待生成图片';
        const descriptionText = String(msg.imageDescription || '').trim();
        if (descriptionText && descriptionText !== promptText) {
            return `[${mediaType}]（${descriptionText}）（${promptText}）`;
        }
        return `[${mediaType}]（${promptText}）`;
    }

    _getDefaultMusicCover() {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1ed760"/><stop offset="1" stop-color="#6a5cff"/></linearGradient></defs><rect width="96" height="96" rx="16" fill="url(#g)"/><path d="M60 22v34.5a11 11 0 1 1-5-9.2V31l-24 5v27.5a11 11 0 1 1-5-9.2V30l34-8Z" fill="white" fill-opacity=".9"/></svg>';
        return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    }

    async _ensureMusicAppForInvite() {
        if (window.VirtualPhone?.musicApp) return window.VirtualPhone.musicApp;
        try {
            const module = await import('../music/music-app.js');
            window.VirtualPhone.musicApp = new module.MusicApp(this.app.phoneShell, window.VirtualPhone?.storage || this.app.storage);
            window.VirtualPhone.musicApp.initFloatingWidget?.();
            return window.VirtualPhone.musicApp;
        } catch (error) {
            console.error('加载音乐播放器失败:', error);
            return null;
        }
    }

    async acceptMusicInvite(messageId = '') {
        const chatId = this.app.currentChat?.id || '';
        const messages = this.app.wechatData.getMessages(chatId) || [];
        const message = messages.find(item => String(item?.id || '') === String(messageId));
        if (!message) return;

        const invite = message.musicInvite || {};
        const songName = String(invite.songName || message.songName || '').trim();
        const artist = String(invite.artist || message.artist || '').trim();
        if (!songName) return;

        const musicApp = await this._ensureMusicAppForInvite();
        const playedSong = await musicApp?.musicData?.playSongByName?.(songName, artist, {
            pic: invite.cover || message.cover || null
        });
        if (!playedSong) {
            this.app.phoneShell?.showNotification('音乐', '这首歌暂时无法播放', '⚠️');
            return;
        }

        const resolvedSongName = String(playedSong.name || songName).trim() || songName;
        const resolvedArtist = String(playedSong.artist || artist || '').trim();
        const contact = this.app.wechatData.getContactByName?.(message.from)
            || this.app.wechatData.getContact?.(this.app.currentChat?.contactId)
            || this.app.currentChat
            || {};
        const snapshot = musicApp.musicData.getListeningSnapshot?.() || {
            songName: resolvedSongName,
            artist: resolvedArtist,
            cover: invite.cover || message.cover || ''
        };
        snapshot.sourceMessageId = String(messageId || '').trim();
        this.app.wechatData.startMusicListening?.(chatId, contact, snapshot);
        this.app.wechatData.updateMessageById(chatId, messageId, {
            musicInviteStatus: 'accepted',
            content: `已接受一起听《${resolvedSongName}》${resolvedArtist ? ` - ${resolvedArtist}` : ''}`,
            musicInvite: {
                ...invite,
                songName: resolvedSongName,
                artist: resolvedArtist,
                cover: snapshot.cover || playedSong.pic || invite.cover || ''
            }
        });
        this.app.syncMusicListenHeaderIndicator?.(chatId);
        this.smartUpdateMessages(this.app.wechatData.getMessages(chatId), this.app.wechatData.getUserInfo(), { chatId });
    }

    rejectMusicInvite(messageId = '') {
        const chatId = this.app.currentChat?.id || '';
        const message = (this.app.wechatData.getMessages(chatId) || [])
            .find(item => String(item?.id || '') === String(messageId));
        if (!message) return;
        const invite = message.musicInvite || {};
        const songName = String(invite.songName || message.songName || '').trim() || '这首歌';
        const artist = String(invite.artist || message.artist || '').trim();
        this.app.wechatData.updateMessageById(chatId, messageId, {
            musicInviteStatus: 'rejected',
            content: `已拒绝一起听《${songName}》${artist ? ` - ${artist}` : ''}`
        });
        this.smartUpdateMessages(this.app.wechatData.getMessages(chatId), this.app.wechatData.getUserInfo(), { chatId });
    }

    renderTwemojiEmoji(emoji, size = 24, inline = true) {
        if (!emoji) return '';
        const src = this.getTwemojiUrl(emoji);
        const display = inline ? 'inline-block' : 'block';
        const verticalAlign = inline ? 'vertical-align:text-bottom;' : '';
        return `<img src="${src}" alt="${emoji}" draggable="false" class="twemoji-img" style="width:${size}px;height:${size}px;${verticalAlign}display:${display};object-fit:contain;" onerror="this.replaceWith(document.createTextNode(this.alt))">`;
    }

    renderMorePanel() {
        const isGroupChat = this.app.currentChat?.type === 'group';
        const voiceLabel = isGroupChat ? '群语音' : '语音';
        const videoLabel = isGroupChat ? '群视频' : '视频';
        return `
        <div class="more-panel">
            <div class="more-grid">
                <!-- 第一排：图片、截图、蜜语、通话 -->
                <div class="more-item" data-action="image">
                    <div class="more-icon">
                        <i class="fa-solid fa-image" style="font-size: 14px;"></i>
                    </div>
                    <div class="more-name">图片</div>
                </div>

                <div class="more-item" data-action="screenshot">
                    <div class="more-icon">
                        <i class="fa-solid fa-camera-retro" style="font-size: 14px;"></i>
                    </div>
                    <div class="more-name">截图</div>
                </div>

                <div class="more-item" data-action="honey">
                    <div class="more-icon">
                        <i class="fa-solid fa-heart" style="font-size: 14px;"></i>
                    </div>
                    <div class="more-name">蜜语</div>
                </div>

                <div class="more-item" data-action="voice">
                    <div class="more-icon">
                        <i class="fa-solid fa-phone" style="font-size: 14px;"></i>
                    </div>
                    <div class="more-name">${voiceLabel}</div>
                </div>

                <div class="more-item" data-action="video">
                    <div class="more-icon">
                        <i class="fa-solid fa-video" style="font-size: 14px;"></i>
                    </div>
                    <div class="more-name">${videoLabel}</div>
                </div>

                <!-- 第二排：转账、红包 -->
                <div class="more-item" data-action="transfer">
                    <div class="more-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="7,4 3,8 7,12"/>
                            <line x1="3" y1="8" x2="21" y2="8"/>
                            <polyline points="17,12 21,16 17,20"/>
                            <line x1="21" y1="16" x2="3" y2="16"/>
                        </svg>
                    </div>
                    <div class="more-name">转账</div>
                </div>

                <div class="more-item" data-action="redpacket">
                    <div class="more-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <g fill="currentColor">
                                <path d="M5 5 C5 3, 8 2, 12 2 S 19 3, 19 5 L19 8.5 Q12 13, 5 8.5 Z"/>
                                <path d="M5 9.5 Q12 14, 19 9.5 L19 21 A1 1 0 0 1 18 22 L6 22 A1 1 0 0 1 5 21 Z"/>
                            </g>
                            <circle cx="12" cy="13" r="2.5" fill="white"/>
                        </svg>
                    </div>
                    <div class="more-name">红包</div>
                </div>
            </div>

            <!-- 隐藏的文件上传input（相册用，不带capture） -->
            <input type="file" id="photo-upload-input" accept="image/png, image/jpeg, image/gif, image/webp, image/*" style="display: none;">
            <!-- 隐藏的拍照input（带capture调用摄像头） -->
            <input type="file" id="camera-upload-input" accept="image/png, image/jpeg, image/gif, image/webp, image/*" capture="environment" style="display: none;">
            <div class="wechat-image-source-sheet" id="wechat-image-source-sheet" style="display:none; position:absolute; left:10px; right:10px; bottom:8px; z-index:50;">
                <div style="background:rgba(255,255,255,0.96); border:0.5px solid rgba(0,0,0,0.08); border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,0.16); overflow:hidden;">
                    <button class="wechat-image-source-btn" data-source="photo" style="width:100%; height:44px; border:none; border-bottom:0.5px solid rgba(0,0,0,0.08); background:transparent; color:#111; font-size:14px; display:flex; align-items:center; justify-content:center; gap:8px;">
                        <i class="fa-solid fa-image" style="font-size:14px;"></i><span>从相册选择</span>
                    </button>
                    <button class="wechat-image-source-btn" data-source="camera" style="width:100%; height:44px; border:none; background:transparent; color:#111; font-size:14px; display:flex; align-items:center; justify-content:center; gap:8px;">
                        <i class="fa-solid fa-camera" style="font-size:14px;"></i><span>调用摄像头</span>
                    </button>
                </div>
            </div>
        </div>
    `;
    }

    renderQuickReplyPanel() {
        const items = [
            { key: 'image', icon: 'fa-solid fa-image', label: '图片', template: '[图片]（描述）' },
            { key: 'video', icon: 'fa-solid fa-video', label: '视频', template: '[视频]（描述）' },
            { key: 'sticker', icon: 'fa-regular fa-face-smile', label: '表情包', template: '[表情包]（描述）' },
            { key: 'voice-strip', icon: 'fa-solid fa-microphone-lines', label: '语音条', template: '[语音条]（描述）' },
            { key: 'location', icon: 'fa-solid fa-location-dot', label: '定位', template: '[定位]（描述）' },
            { key: 'time', icon: 'fa-regular fa-clock', label: '时间推进', template: '[时间推进：年月日HH:MM]' }
        ];

        return `
        <div class="quick-reply-panel more-panel" style="padding:10px 10px 12px;">
            <div style="display:grid; grid-template-columns:repeat(6, minmax(0, 1fr)); gap:6px;">
                ${items.map(item => `
                    <button class="quick-reply-item" data-template="${this._escapeHtml(item.template)}" title="${item.template}" style="
                        min-width:0;
                        border:none;
                        background:transparent;
                        padding:0;
                        display:flex;
                        flex-direction:column;
                        align-items:center;
                        gap:5px;
                        color:#555;
                        cursor:pointer;
                    ">
                        <span style="width:38px; height:38px; border-radius:11px; background:rgba(255,255,255,0.9); box-shadow:0 1px 5px rgba(0,0,0,0.08); display:flex; align-items:center; justify-content:center;">
                            <i class="${item.icon}" style="font-size:15px;"></i>
                        </span>
                        <span style="font-size:10px; line-height:1.1; color:#666; white-space:nowrap;">${item.label}</span>
                    </button>
                `).join('')}
            </div>
        </div>
    `;
    }

    parseEmoji(text) {
        const emojiMap = {
            '[微笑]': '😊',
            '[撇嘴]': '😥',
            '[色]': '😍',
            '[发呆]': '😳',
            '[得意]': '😏',
            '[流泪]': '😭',
            '[害羞]': '😊',
            '[闭嘴]': '🤐',
            '[睡]': '😴',
            '[大哭]': '😭',
            '[尴尬]': '😅',
            '[发怒]': '😠',
            '[调皮]': '😜',
            '[呲牙]': '😁',
            '[惊讶]': '😮',
            '[难过]': '😔',
            '[酷]': '😎',
            '[冷汗]': '😰',
            '[抓狂]': '😤',
            '[吐]': '🤮'
        };

        let result = this._escapeHtml(text);
        // 0️⃣ 文本内联表情包：[表情包](关键词) / [表情包]（关键词）
        // 单独一整条的表情包消息会在数据层被识别为 `sticker` 类型，不走这里
        // 这里与单条表情包保持一致：本地自定义表情 -> ALAPI -> 关键词占位卡片
        const inlineStickerRegex = /\[表情包\]\s*[（(]\s*([^)）\n]+?)\s*[)）]/g;
        result = result.replace(inlineStickerRegex, (_, keywordRaw) => {
            const keyword = String(keywordRaw || '').trim();
            if (!keyword) return '';

            const directStickerUrl = this.normalizeStickerDirectImageUrl(keyword);
            if (directStickerUrl) {
                return `<span class="wechat-inline-custom-sticker" style="display:inline-flex;align-items:center;vertical-align:text-bottom;line-height:0;">${this.renderDirectStickerImage(directStickerUrl, '表情包', { maxHeight: 56, inline: true })}</span>`;
            }

            const matchedCustomEmoji = this.findCustomEmojiByKeyword(keyword);
            if (matchedCustomEmoji?.image) {
                return `<span class="wechat-inline-custom-sticker" style="display:inline-flex;align-items:center;vertical-align:text-bottom;line-height:0;">${this.renderCustomEmojiStickerImage(matchedCustomEmoji, { maxHeight: 56, inline: true })}</span>`;
            }

            const stickerCacheKey = this.buildStickerCacheKey(keyword);
            return `<span class="wechat-inline-sticker"
                data-key="${this.escapeInlineStickerAttr(stickerCacheKey)}"
                data-keyword="${this.escapeInlineStickerAttr(keyword)}"
                data-fallback-size="56"
                data-image-size="56"
                style="display:inline-flex;align-items:center;justify-content:center;vertical-align:text-bottom;line-height:1.2;background:transparent;padding:0;">
                ${this.buildStickerKeywordFallbackMarkup(keyword, 56)}
            </span>`;
        });

        // 1️⃣ 替换系统表情
        for (let emoji in emojiMap) {
            result = result.split(emoji).join(emojiMap[emoji]);
        }

        // 2️⃣ 替换自定义表情
        const customEmojis = this.app.wechatData.getCustomEmojis();
        customEmojis.forEach(emoji => {
            const pattern = `[${this._escapeHtml(emoji.name)}]`;
            if (result.includes(pattern)) {
                result = result.split(pattern).join(
                    `<img src="${this.escapeInlineStickerAttr(emoji.image || '')}" style="width:16px;height:16px;vertical-align:text-bottom;border-radius:4px;" alt="${this._escapeHtml(emoji.name || '')}" title="${this._escapeHtml(emoji.name || '')}">`
                );
            }
        });

        // 3️⃣ 将 Unicode emoji 统一渲染为 Twemoji 图片（仅替换纯文本，避免破坏已有 HTML 标签）
        result = this.renderTwemojiOutsideHtml(result, 16);

        return result;
    }

    normalizeCustomEmojiKeyword(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[【】\[\]（）(){}<>《》「」『』"'“”‘’]/g, '')
            .replace(/\s+/g, '');
    }

    findCustomEmojiByKeyword(keyword) {
        const normalizedKeyword = this.normalizeCustomEmojiKeyword(keyword);
        if (!normalizedKeyword) return null;

        const customEmojis = Array.isArray(this.app?.wechatData?.getCustomEmojis?.())
            ? this.app.wechatData.getCustomEmojis()
            : [];

        const normalizedFields = (emoji) => [
            emoji?.name,
            emoji?.description
        ].map(value => this.normalizeCustomEmojiKeyword(value)).filter(Boolean);

        const exactMatch = customEmojis.find(emoji =>
            normalizedFields(emoji).some(field => field === normalizedKeyword)
        );
        if (exactMatch) return exactMatch;

        return customEmojis.find(emoji =>
            normalizedFields(emoji).some(field =>
                field.length >= 2
                && normalizedKeyword.length >= 2
                && (field.includes(normalizedKeyword) || normalizedKeyword.includes(field))
            )
        ) || null;
    }

    normalizeStickerDirectImageUrl(rawUrl) {
        const value = String(rawUrl || '').trim();
        if (!value) return '';
        const normalized = this.normalizeStickerUrl(value);
        if (!normalized) return '';
        try {
            const urlObj = new URL(normalized);
            if (!/^https?:$/i.test(urlObj.protocol)) return '';
            if (!/\.(?:png|jpe?g|gif|webp|avif|bmp|svg)(?:$|[?#])/i.test(urlObj.pathname)) return '';
            return urlObj.href;
        } catch (e) {
            return '';
        }
    }

    renderDirectStickerImage(imageUrl, label = '表情包', { maxHeight = 156, inline = false } = {}) {
        const safeUrl = this.escapeInlineStickerAttr(imageUrl || '');
        const safeLabel = this._escapeHtml(String(label || '表情包'));
        const height = Math.max(20, Number(maxHeight) || 156);
        const borderRadius = inline ? 6 : 8;
        return `<img src="${safeUrl}" alt="${safeLabel}" title="${safeLabel}" referrerpolicy="no-referrer" style="display:block;max-width:100%;max-height:${height}px;width:auto;height:auto;border-radius:${borderRadius}px;object-fit:contain;">`;
    }

    renderCustomEmojiStickerImage(emoji, { maxHeight = 156, inline = false } = {}) {
        const safeUrl = this.escapeInlineStickerAttr(emoji?.image || '');
        const safeName = this._escapeHtml(String(emoji?.description || emoji?.name || '表情包'));
        const height = Math.max(20, Number(maxHeight) || 156);
        const borderRadius = inline ? 6 : 8;
        return `<img src="${safeUrl}" alt="${safeName}" title="${safeName}" style="display:block;max-width:100%;max-height:${height}px;width:auto;height:auto;border-radius:${borderRadius}px;object-fit:contain;">`;
    }

    renderTwemojiOutsideHtml(text, size = 16) {
        const source = String(text || '');
        if (!source) return source;

        const twemojiRegex = /(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3)/gu;
        const segments = source.split(/(<[^>]+>)/g);

        return segments.map(segment => {
            if (!segment) return segment;
            if (segment.startsWith('<') && segment.endsWith('>')) return segment;
            return segment.replace(twemojiRegex, (emoji) => this.renderTwemojiEmoji(emoji, size, true));
        }).join('');
    }

    getSystemEmojiByStickerKeyword(keyword) {
        const raw = String(keyword || '').trim();
        if (!raw) return '';

        const norm = raw.toLowerCase().replace(/\s+/g, '');
        const exactMap = {
            '挑眉': '😏',
            '坏笑': '😏',
            '得意': '😏',
            '斜眼': '😏',
            '白眼': '🙄',
            '微笑': '😊',
            '笑': '😊',
            '大笑': '😁',
            '偷笑': '🤭',
            '害羞': '😊',
            '无语': '😅',
            '捂脸': '🤦',
            '流泪': '😭',
            '大哭': '😭',
            '委屈': '🥺',
            '可怜': '🥺',
            '生气': '😠',
            '发怒': '😠',
            '惊讶': '😮',
            '震惊': '😮',
            '疑惑': '🤔',
            '问号': '🤔',
            '亲亲': '😘',
            '色': '😍',
            '爱心眼': '😍',
            '酷': '😎',
            '晕': '😵',
            '抓狂': '😤',
            '吐': '🤮'
        };

        if (exactMap[norm]) return exactMap[norm];

        const fuzzyMap = [
            { keys: ['挑眉', '坏笑', '斜眼', '轻蔑', '嘴角'], emoji: '😏' },
            { keys: ['白眼', '翻白眼'], emoji: '🙄' },
            { keys: ['笑', '开心'], emoji: '😊' },
            { keys: ['哭', '流泪', '泪'], emoji: '😭' },
            { keys: ['气', '怒'], emoji: '😠' },
            { keys: ['惊', '震惊'], emoji: '😮' },
            { keys: ['疑惑', '问'], emoji: '🤔' }
        ];

        for (const item of fuzzyMap) {
            if (item.keys.some(k => norm.includes(k))) return item.emoji;
        }

        return '';
    }

    escapeInlineStickerAttr(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    buildStickerCacheKey(keyword) {
        const tokenFlag = this.getStickerAlapiToken() ? 'token' : 'no-token';
        const normalizedKeyword = String(keyword || '').trim().toLowerCase();
        return `sticker:${tokenFlag}:${encodeURIComponent(normalizedKeyword)}`;
    }

    _getStickerPersistentStorage() {
        return window.VirtualPhone?.storage || this.app?.storage || null;
    }

    _readPersistentStickerCache() {
        const storage = this._getStickerPersistentStorage();
        if (!storage?.get) return {};
        try {
            const raw = storage.get(WECHAT_STICKER_ALAPI_CACHE_KEY, {});
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
            return parsed;
        } catch (e) {
            console.warn('[Wechat] 读取 ALAPI 表情缓存失败:', e);
            return {};
        }
    }

    _normalizePersistentStickerCacheEntry(entry) {
        const normalizeCachedUrl = (url) => {
            const rawUrl = String(url || '').trim();
            if (/^\/backgrounds\/phone_[^?#]+/i.test(rawUrl)) return rawUrl;
            return this.normalizeStickerUrl(rawUrl) || '';
        };
        if (typeof entry === 'string') {
            return {
                url: normalizeCachedUrl(entry),
                savedAt: 0,
                failed: false
            };
        }
        if (!entry || typeof entry !== 'object') return null;
        return {
            url: normalizeCachedUrl(entry.url),
            keyword: String(entry.keyword || '').trim(),
            savedAt: Number(entry.savedAt) || 0,
            failed: entry.failed === true
        };
    }

    _getPersistentStickerCacheEntry(cacheKey) {
        const key = String(cacheKey || '').trim();
        if (!key) return null;
        const cache = this._readPersistentStickerCache();
        const entry = this._normalizePersistentStickerCacheEntry(cache[key]);
        if (!entry) return null;

        const now = Date.now();
        if (entry.savedAt > 0 && now - entry.savedAt > WECHAT_STICKER_ALAPI_CACHE_TTL) {
            delete cache[key];
            this._writePersistentStickerCache(cache);
            return null;
        }
        if (entry.failed) return { ...entry, url: '' };
        if (!entry.url) return null;
        return entry;
    }

    _writePersistentStickerCache(cache) {
        const storage = this._getStickerPersistentStorage();
        if (!storage?.set || !cache || typeof cache !== 'object') return;
        const entries = Object.entries(cache)
            .map(([key, value]) => [key, this._normalizePersistentStickerCacheEntry(value)])
            .filter(([key, value]) => key && value && (value.url || value.failed))
            .sort((a, b) => (Number(b[1].savedAt) || 0) - (Number(a[1].savedAt) || 0))
            .slice(0, WECHAT_STICKER_ALAPI_CACHE_MAX);
        const nextCache = Object.fromEntries(entries);
        storage.set(WECHAT_STICKER_ALAPI_CACHE_KEY, nextCache);
    }

    _setPersistentStickerCacheEntry(cacheKey, entry) {
        const key = String(cacheKey || '').trim();
        if (!key) return;
        const cache = this._readPersistentStickerCache();
        cache[key] = {
            keyword: String(entry?.keyword || '').trim(),
            url: String(entry?.url || '').trim(),
            failed: entry?.failed === true,
            savedAt: Number(entry?.savedAt) || Date.now()
        };
        this._writePersistentStickerCache(cache);
    }

    getStickerAlapiToken() {
        const storage = window.VirtualPhone?.storage;
        if (!storage || typeof storage.get !== 'function') return '';
        return String(storage.get('global_alapi_token') || '').trim();
    }

    buildAlapiStickerApiUrl(keyword, token) {
        const params = new URLSearchParams({
            token: String(token || '').trim(),
            keyword: String(keyword || '').trim()
        });
        return `https://v2.alapi.cn/api/doutu?${params.toString()}`;
    }

    normalizeStickerUrl(rawUrl) {
        const value = String(rawUrl || '').trim();
        if (!value) return '';
        if (value.startsWith('//')) return `https:${value}`;
        if (/^https?:\/\//i.test(value)) return value;
        return '';
    }

    extractStickerUrlFromPayload(payload) {
        if (!payload) return '';

        const tryUrl = (candidate) => this.normalizeStickerUrl(candidate);

        if (typeof payload === 'string') {
            const textUrl = tryUrl(payload);
            if (textUrl) return textUrl;
        }

        const candidates = [
            payload?.url,
            payload?.imgurl,
            payload?.image,
            payload?.data?.url,
            payload?.data?.imgurl,
            payload?.data?.image,
            payload?.data?.doutu,
            payload?.data?.img,
            payload?.data?.[0]?.url,
            payload?.data?.[0]?.imgurl,
            payload?.data?.[0]?.image,
            payload?.result?.url,
            payload?.result?.imgurl,
            payload?.result?.image
        ];

        for (const candidate of candidates) {
            const normalized = tryUrl(candidate);
            if (normalized) return normalized;
        }

        try {
            const serialized = JSON.stringify(payload);
            const match = serialized.match(/https?:\\?\/\\?\/[^"\\\s]+/i);
            if (match && match[0]) {
                return tryUrl(match[0].replace(/\\\//g, '/'));
            }
        } catch (e) {
            // ignore
        }

        return '';
    }

    async resolveStickerUrlFromAlapi(apiUrl) {
        const fallbackUrl = String(apiUrl || '').trim();
        if (!fallbackUrl) return '';

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4500);

        try {
            const resp = await fetch(fallbackUrl, {
                method: 'GET',
                signal: controller.signal,
                headers: { Accept: 'application/json,text/plain,*/*' }
            });

            if (!resp.ok) return fallbackUrl;

            const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
            if (contentType.startsWith('image/')) {
                return fallbackUrl;
            }

            const raw = await resp.text();
            if (!raw) return fallbackUrl;

            let parsed = null;
            try {
                parsed = JSON.parse(raw);
            } catch (e) {
                parsed = raw;
            }

            const resolved = this.extractStickerUrlFromPayload(parsed);
            return resolved || fallbackUrl;
        } catch (err) {
            // 网络/CORS 失败时，交给 <img src=apiUrl> 再尝试一次
            return fallbackUrl;
        } finally {
            clearTimeout(timeout);
        }
    }

    async _loadRemoteStickerBlob(imageUrl) {
        const safeUrl = String(imageUrl || '').trim();
        if (!safeUrl || !/^https?:\/\//i.test(safeUrl)) return null;
        const response = await fetch(safeUrl, {
            method: 'GET',
            cache: 'no-store',
            credentials: 'omit',
            referrerPolicy: 'no-referrer'
        });
        if (!response.ok) throw new Error(`读取 ALAPI 表情失败（HTTP ${response.status}）`);

        const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const arrayBuffer = await response.arrayBuffer();
        if (!arrayBuffer || arrayBuffer.byteLength <= 0) throw new Error('ALAPI 表情图片为空');

        const bytes = new Uint8Array(arrayBuffer);
        const mime = /^image\//i.test(contentType)
            ? contentType
            : this._detectGeneratedWechatImageMime(bytes);
        if (!mime) throw new Error('ALAPI 表情响应不是有效图片');
        return new Blob([arrayBuffer], { type: mime });
    }

    async _persistAlapiStickerImage(remoteUrl, cacheKey, keyword) {
        const safeUrl = String(remoteUrl || '').trim();
        if (!safeUrl) return '';
        if (/^\/backgrounds\/phone_[^?#]+/i.test(safeUrl)) return safeUrl;
        if (!/^https?:\/\//i.test(safeUrl)) return '';

        const imageManager = window.VirtualPhone?.imageManager;
        if (!imageManager?.uploadBlob) return '';

        const blob = await this._loadRemoteStickerBlob(safeUrl);
        if (!blob) return '';
        const seed = `${this._simpleImageHash(`${cacheKey}|${keyword}|${safeUrl}`).toString(36)}`;
        const uploadedUrl = await imageManager.uploadBlob(blob, `wechat_sticker_${seed}`);
        const normalized = String(uploadedUrl || '').trim();
        return /^\/backgrounds\/phone_[^?#]+/i.test(normalized) ? normalized : '';
    }

    getInlineStickerCacheStore() {
        if (!window.VirtualPhone) window.VirtualPhone = {};
        if (!window.VirtualPhone._wechatInlineStickerCache || typeof window.VirtualPhone._wechatInlineStickerCache !== 'object') {
            window.VirtualPhone._wechatInlineStickerCache = {};
        }
        return window.VirtualPhone._wechatInlineStickerCache;
    }

    getInlineStickerPendingStore() {
        if (!window.VirtualPhone) window.VirtualPhone = {};
        if (!(window.VirtualPhone._wechatInlineStickerPending instanceof Set)) {
            window.VirtualPhone._wechatInlineStickerPending = new Set();
        }
        return window.VirtualPhone._wechatInlineStickerPending;
    }

    scheduleInlineStickerHydration() {
        if (this._inlineStickerHydrateTimer) {
            clearTimeout(this._inlineStickerHydrateTimer);
        }
        this._inlineStickerHydrateTimer = setTimeout(() => {
            this._inlineStickerHydrateTimer = null;
            this.hydrateInlineStickers();
        }, 60);
    }

    hydrateInlineStickers() {
        const root = document.getElementById('chat-messages');
        if (!root) return;

        const nodes = Array.from(root.querySelectorAll('.wechat-inline-sticker[data-key][data-keyword], .wechat-sticker-target[data-key][data-keyword]'));
        if (nodes.length === 0) return;

        const cache = this.getInlineStickerCacheStore();
        const pending = this.getInlineStickerPendingStore();

        nodes.forEach(node => {
            if (!node || !node.isConnected) return;
            const key = String(node.dataset.key || '').trim();
            const keyword = String(node.dataset.keyword || '').trim();
            if (!key || !keyword) return;

            if (Object.prototype.hasOwnProperty.call(cache, key)) {
                const cachedUrl = cache[key];
                if (cachedUrl) {
                    this.applyInlineStickerNode(node, cachedUrl, keyword);
                } else {
                    this.applyInlineStickerFallback(node, keyword);
                }
                return;
            }

            const persistentEntry = this._getPersistentStickerCacheEntry(key);
            if (persistentEntry) {
                cache[key] = persistentEntry.url || null;
                if (persistentEntry.url) {
                    this.applyInlineStickerNode(node, persistentEntry.url, keyword);
                } else {
                    this.applyInlineStickerFallback(node, keyword);
                }
                return;
            }

            if (pending.has(key)) return;
            pending.add(key);
            this.fetchInlineStickerByKeyword(key, keyword).finally(() => {
                pending.delete(key);
            });
        });
    }

    applyInlineStickerNode(node, imageUrl, keyword) {
        if (!node || !node.isConnected) return;
        const safeUrl = String(imageUrl || '');
        const safeKeyword = this.escapeInlineStickerAttr(keyword);
        const imageSize = Number(node.dataset.imageSize) || 0;
        const maxImageSize = imageSize > 0 ? `${Math.max(20, imageSize)}px` : 'min(156px, 100%)';
        const maxImageHeight = imageSize > 0 ? `${Math.max(20, imageSize)}px` : '156px';
        node.style.background = 'transparent';
        node.style.padding = '0';
        node.style.minWidth = '0';
        node.style.minHeight = '0';
        node.style.maxWidth = maxImageSize;
        node.style.maxHeight = maxImageHeight;
        node.innerHTML = `<img src="${safeUrl}" alt="${safeKeyword}" title="${safeKeyword}" referrerpolicy="no-referrer" style="display:block;max-width:100%;max-height:${maxImageHeight};width:auto;height:auto;object-fit:contain;vertical-align:middle;border-radius:8px;">`;
        const imgEl = node.querySelector('img');
        if (imgEl) {
            imgEl.addEventListener('error', () => {
                this.applyInlineStickerFallback(node, keyword);
            }, { once: true });
        }
    }

    buildStickerKeywordFallbackMarkup(keyword, size = 56) {
        const rawKeyword = String(keyword || '').trim() || '表情包';
        const safeKeyword = this._escapeHtml(rawKeyword);
        const boxSize = Math.max(20, Number(size) || 56);

        if (boxSize >= 40) {
            const fontSize = Math.max(10, Math.round(boxSize * 0.2));
            return `<span class="wechat-sticker-fallback-card" title="${safeKeyword}" style="display:inline-flex;align-items:center;justify-content:center;width:${boxSize}px;height:${boxSize}px;padding:6px;box-sizing:border-box;border-radius:8px;background:linear-gradient(180deg,#f7f8fa 0%,#eef1f5 100%);border:1px dashed #cfd6e0;color:#596579;font-size:${fontSize}px;line-height:1.2;text-align:center;word-break:break-all;overflow:hidden;">${safeKeyword}</span>`;
        }

        const chipMaxWidth = Math.max(64, Math.round(boxSize * 4));
        const chipMinHeight = Math.max(18, Math.round(boxSize * 0.95));
        const chipFontSize = Math.max(10, Math.round(boxSize * 0.48));
        return `<span class="wechat-sticker-fallback-chip" title="${safeKeyword}" style="display:inline-flex;align-items:center;justify-content:center;max-width:${chipMaxWidth}px;min-height:${chipMinHeight}px;padding:0 7px;box-sizing:border-box;border-radius:999px;background:#f1f3f6;border:1px dashed #cfd6e0;color:#5a667a;font-size:${chipFontSize}px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${safeKeyword}</span>`;
    }

    applyInlineStickerFallback(node, keyword) {
        if (!node || !node.isConnected) return;
        const fallbackSize = Math.max(20, Number(node.dataset.fallbackSize) || Number(node.dataset.emojiSize) || 26);
        node.style.background = 'transparent';
        node.style.padding = '0';
        node.style.minWidth = `${Math.round(fallbackSize * 0.8)}px`;
        node.style.minHeight = `${Math.round(fallbackSize * 0.8)}px`;
        node.style.maxWidth = '';
        node.style.maxHeight = '';
        node.innerHTML = this.buildStickerKeywordFallbackMarkup(keyword, fallbackSize);
    }

    applyInlineStickerByCacheKey(cacheKey, imageUrl, keyword) {
        const root = document.getElementById('chat-messages');
        if (!root) return;

        const targets = Array.from(root.querySelectorAll('.wechat-inline-sticker[data-key][data-keyword], .wechat-sticker-target[data-key][data-keyword]'));
        targets.forEach(node => {
            if (!node || !node.isConnected) return;
            if (String(node.dataset.key || '') !== cacheKey) return;
            if (imageUrl) {
                this.applyInlineStickerNode(node, imageUrl, keyword);
            } else {
                this.applyInlineStickerFallback(node, keyword);
            }
        });
    }

    async fetchInlineStickerByKeyword(cacheKey, keyword) {
        const cache = this.getInlineStickerCacheStore();
        const token = this.getStickerAlapiToken();
        if (!token) {
            cache[cacheKey] = null;
            this.applyInlineStickerByCacheKey(cacheKey, null, keyword);
            return;
        }

        const apiUrl = this.buildAlapiStickerApiUrl(keyword, token);
        const resolvedUrl = await this.resolveStickerUrlFromAlapi(apiUrl);
        const normalizedUrl = this.normalizeStickerUrl(resolvedUrl);
        let finalUrl = normalizedUrl || null;
        if (normalizedUrl) {
            try {
                finalUrl = await this._persistAlapiStickerImage(normalizedUrl, cacheKey, keyword) || normalizedUrl;
            } catch (e) {
                console.warn('[Wechat] ALAPI 表情保存到本地失败，临时使用远程地址:', e);
                finalUrl = normalizedUrl;
            }
        }

        cache[cacheKey] = finalUrl || null;
        if (finalUrl && /^\/backgrounds\/phone_[^?#]+/i.test(finalUrl)) {
            this._setPersistentStickerCacheEntry(cacheKey, {
                keyword,
                url: finalUrl,
                failed: false
            });
        }
        this.applyInlineStickerByCacheKey(cacheKey, cache[cacheKey], keyword);
    }

    /**
     * 🔥 清理AI返回文本中的异常字符间空格
     * 某些AI模型会在中文字符之间插入空格，如 "不 过 ， 如 果"
     * 此方法会智能清理这种异常空格，同时保留正常的词间空格
     */
    cleanAbnormalSpaces(text) {
        if (!text || typeof text !== 'string') return text;

        // 🔥 模式1：连续的"单字+空格"序列（如"不 过 ， 如 果"）
        // 匹配：中文字符/标点 + 空格 + 中文字符/标点，且这种模式连续出现3次以上
        // 这表示AI在每个字符之间都加了空格

        // 检测是否存在异常空格模式：单个中文字符后跟空格，连续出现
        const abnormalPattern = /([\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef])\s(?=[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef])/g;

        // 计算异常模式出现的次数
        const matches = text.match(abnormalPattern);

        // 如果异常模式出现次数超过3次，说明这是AI的异常输出，需要清理
        if (matches && matches.length >= 3) {
            // 移除中文字符之间的单个空格
            return text.replace(/([\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef])\s+(?=[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef])/g, '$1');
        }

        return text;
    }

    _stripCallSpeechPrefix(text, options = {}) {
        const preserveVoiceTag = options?.preserveVoiceTag === true;
        let normalized = this.cleanAbnormalSpaces(String(text || ''));
        if (!normalized) return '';

        let previous = null;
        while (normalized !== previous) {
            previous = normalized;
            normalized = normalized
                .replace(
                    preserveVoiceTag
                        ? /^\s*(?:\[\s*(?:视频|语音通话|视频通话|通话)\s*\]|【\s*(?:视频|语音通话|视频通话|通话)\s*】)\s*/i
                        : /^\s*(?:\[\s*(?:语音|视频|语音通话|视频通话|通话)\s*\]|【\s*(?:语音|视频|语音通话|视频通话|通话)\s*】)\s*/i,
                    ''
                )
                .replace(/^\s*(?:语音|视频)(?:通话)?\s*[：:]\s*/i, '')
                .trim();
        }

        return normalized;
    }

    _buildWechatPaymentStatusContext(messages = [], userName = '用户') {
        const recentPayments = (Array.isArray(messages) ? messages : [])
            .filter(msg => msg && (msg.type === 'transfer' || msg.type === 'redpacket'))
            .slice(-8);
        if (recentPayments.length === 0) return '';

        const lines = ['【最近资金状态】'];
        recentPayments.forEach((msg, index) => {
            const isMe = msg.from === 'me' || msg.from === userName;
            const sender = String(isMe ? userName : (msg.from || '对方')).trim() || '对方';
            const amount = Number.parseFloat(msg.amount || 0);
            const amountText = Number.isFinite(amount) ? `¥${amount.toFixed(2)}` : '金额未知';
            const timeText = String(msg.time || '').trim();
            const prefix = `${index + 1}. ${timeText ? `[${timeText}] ` : ''}`;

            if (msg.type === 'transfer') {
                const status = String(msg.status || '').trim() === 'received'
                    ? (isMe ? '对方已收款' : '你已收款')
                    : String(msg.status || '').trim() === 'refunded'
                        ? (isMe ? '已退回给你' : '你已退回')
                    : (isMe ? '待对方收款' : '待你收款');
                lines.push(`${prefix}转账 ${amountText}｜发送方：${sender}｜状态：${status}`);
                return;
            }

            const redpacketStatus = String(msg.status || '').trim() === 'opened'
                ? (isMe ? '已被领取' : '你已领取')
                : String(msg.status || '').trim() === 'refunded'
                    ? (isMe ? '已退回给你' : '你已退回')
                : (isMe ? '待对方领取' : '待你领取');
            lines.push(`${prefix}红包 ${amountText}｜发送方：${sender}｜状态：${redpacketStatus}`);
        });

        lines.push('以上资金状态是系统真实记录，必须视为当前有效事实，不得擅自篡改已领取/已收款状态。');
        return lines.join('\n');
    }

    _parseWeiboCommentLine(line) {
        if (!line) return null;
        const cleaned = String(line || '').trim();
        if (!cleaned) return null;

        // 兼容：1. 昵称 (ip[地区])：内容 / 昵称 回复 昵称 (ip[地区])：内容
        const matched = cleaned.match(/^\d+[.、]\s*(.+?)\s*(?:[（(]\s*(?:ip|IP|来自|IP属地)?[：:\s]*\[?([^\]）)]+)\]?\s*[）)])?\s*[：:]\s*([\s\S]+)$/i);
        if (!matched) return null;

        let head = (matched[1] || '').trim();
        const location = String(matched[2] || '').replace(/^(ip|IP|来自|IP属地)[：:\s]*/i, '').trim();
        const text = (matched[3] || '').trim();
        if (!head || !text) return null;

        let replyTo = '';
        const replyMatch = head.match(/^(.+?)\s*回复\s*(.+)$/);
        if (replyMatch) {
            head = replyMatch[1].trim();
            replyTo = replyMatch[2].trim();
        }

        const cleanName = (name) => String(name || '').trim().replace(/^@/, '').replace(/^[\[\(（【]/, '').replace(/[\]\)）】]$/, '').trim();
        const name = cleanName(head) || '网友';
        replyTo = cleanName(replyTo);

        return { name, location, text, replyTo };
    }

    _parseWeiboNewsCard(content) {
        const raw = String(content || '');
        const blockMatch = raw.match(/\[微博新闻\]([\s\S]*?)\[\/微博新闻\]/i);
        if (!blockMatch) return null;

        const body = blockMatch[1] || '';
        const lines = body.split('\n').map(line => line.trim()).filter(Boolean);
        if (lines.length === 0) return null;

        let blogger = '';
        let bloggerType = '';
        let time = '';
        let device = '';
        let text = '';
        let forward = 0;
        let comments = 0;
        let likes = 0;
        const images = [];
        const commentList = [];
        let inCommentSection = false;

        for (const line of lines) {
            if (/^博主[：:]/.test(line)) {
                const rawBlogger = line.replace(/^博主[：:]\s*/, '').trim();
                const bm = rawBlogger.match(/^(.+?)(?:\s*[（(]([^）)]+)[）)])?$/);
                blogger = (bm?.[1] || rawBlogger).trim();
                bloggerType = (bm?.[2] || '').trim();
                if (/标注账号类型|如：|比如/.test(bloggerType)) bloggerType = '';
                continue;
            }
            if (/^时间[：:]/.test(line)) {
                time = line.replace(/^时间[：:]\s*/, '').trim();
                continue;
            }
            if (/^来自[：:]/.test(line)) {
                device = line.replace(/^来自[：:]\s*/, '').trim();
                continue;
            }
            if (/^正文[：:]/.test(line)) {
                text = line.replace(/^正文[：:]\s*/, '').trim();
                continue;
            }
            if (/^配图[：:]/.test(line)) {
                const imageLine = line.replace(/^配图[：:]\s*/, '').trim();
                const imgReg = /\[图片\]\s*[（(]([^）)]+)[）)]/g;
                let m;
                while ((m = imgReg.exec(imageLine)) !== null) {
                    const desc = String(m[1] || '').trim();
                    if (desc) images.push(`[图片]（${desc}）`);
                }
                if (images.length === 0 && imageLine.includes('[图片]')) {
                    images.push('[图片]');
                }
                continue;
            }
            if (/^数据[：:]/.test(line)) {
                const dm = line.match(/转发\s*([0-9]+)\s*\|\s*评论\s*([0-9]+)\s*\|\s*点赞\s*([0-9]+)/);
                if (dm) {
                    forward = parseInt(dm[1], 10) || 0;
                    comments = parseInt(dm[2], 10) || 0;
                    likes = parseInt(dm[3], 10) || 0;
                }
                continue;
            }
            if (/^评论区/.test(line)) {
                inCommentSection = true;
                continue;
            }
            if (inCommentSection) {
                const parsed = this._parseWeiboCommentLine(line);
                if (parsed) commentList.push(parsed);
            }
        }

        if (!blogger && !text) return null;
        if (!comments) comments = commentList.length;

        return {
            type: 'weibo_card',
            content: `[微博分享] ${blogger || '微博'}\n${text || ''}`.trim(),
            weiboData: {
                blogger: blogger || '微博',
                bloggerType: bloggerType || '',
                content: text || '',
                images,
                forward,
                comments,
                likes,
                commentList,
                likeList: [],
                time,
                device
            }
        };
    }

    _extractWeiboNewsTokens(text) {
        const source = String(text || '');
        const tokenMap = new Map();
        let index = 0;

        const replaced = source.replace(/\[微博新闻\][\s\S]*?\[\/微博新闻\]/gi, (blockText) => {
            const parsed = this._parseWeiboNewsCard(blockText);
            if (!parsed) return '';
            const token = `__WEIBO_NEWS_TOKEN_${Date.now()}_${index++}__`;
            tokenMap.set(token, parsed);
            return `\n${token}\n`;
        });

        return { text: replaced, tokenMap };
    }

    _extractLeadingQuote(line = '') {
        let rest = String(line || '').trim();
        if (!rest) return { quote: null, rest: '' };

        let quote = null;
        let guard = 0;
        while (guard < 5) {
            guard += 1;
            const match = rest.match(/^「引用\s+([^:：]+)[:：]\s*([^」]+)」\s*(.*)$/);
            if (!match) break;
            quote = { sender: String(match[1] || '').trim(), content: String(match[2] || '').trim() };
            rest = String(match[3] || '').trim();
        }
        return { quote, rest };
    }

    _isStandaloneWechatTimeLine(line = '') {
        const text = String(line || '').trim();
        if (!text) return false;
        return /^(?:\[\s*)?\d{1,2}\s*[:：]\s*\d{2}(?:\s*[:：]\s*\d{2})?(?:\s*[APap][Mm])?\s*(?:\])?$/.test(text)
            || /^【\s*\d{1,2}\s*[:：]\s*\d{2}(?:\s*[:：]\s*\d{2})?(?:\s*[APap][Mm])?\s*】$/.test(text);
    }

    _parseTimedWechatSenderLine(line = '') {
        const text = String(line || '').trim();
        if (!text) return null;
        // 支持：
        // [15:48] 张三: 内容
        // 【15:48】 张三: 内容
        // [15:48:01] 张三: 内容
        const match = text.match(/^(?:\[\s*([^\]\r\n]+?)\s*\]|【\s*([^】\r\n]+?)\s*】)\s*([^\s:：，。,\.!?！？\[\]【】()（）]{1,20})[：:]\s*(.+)$/);
        if (!match) return null;
        return {
            time: String(match[1] || match[2] || '').trim(),
            sender: String(match[3] || '').trim(),
            content: String(match[4] || '').trim()
        };
    }

    _stripLeadingWechatTimePrefix(line = '') {
        return String(line || '')
            .trim()
            .replace(/^(?:\[\s*\d{1,2}\s*[:：]\s*\d{2}(?:\s*[:：]\s*\d{2})?(?:\s*[APap][Mm])?\s*\]|【\s*\d{1,2}\s*[:：]\s*\d{2}(?:\s*[:：]\s*\d{2})?(?:\s*[APap][Mm])?\s*】)\s*/, '')
            .trim();
    }

    _parseIncomingCallMarker(content) {
        const source = String(content || '');
        if (!source) return null;

        const callMatch = source.match(/(?:\[\s*(?:拨打|发起)\s*(?:微信)?(群)?(语音|视频)(?:通话)?\s*\]|【\s*(?:拨打|发起)\s*(?:微信)?(群)?(语音|视频)(?:通话)?\s*】)/i);
        if (!callMatch) return null;

        const callTypeStr = callMatch[2] || callMatch[4] || '语音';
        const callType = callTypeStr === '视频' ? 'video' : 'voice';
        const isGroupCall = Boolean((callMatch[1] || callMatch[3] || '').trim());

        return {
            callType,
            callTypeStr,
            isGroupCall
        };
    }

    // 🔥 解析AI返回的特殊消息格式（转账/红包/定位/微博新闻/来电）
    parseSpecialMessage(content) {
        if (!content || typeof content !== 'string') return null;
        const trimmedContent = String(content || '').trim();

        const coAdoptResponseMatch = trimmedContent.match(/^\[(同意收养|拒绝收养)\]$/);
        if (coAdoptResponseMatch) {
            const decisionText = coAdoptResponseMatch[1];
            return {
                type: 'catbox_coadopt_response',
                decision: decisionText === '同意收养' ? 'accepted' : 'rejected',
                content: `[${decisionText}]`
            };
        }

        const catboxUseMatch = trimmedContent.match(/^\[使用[：:]\s*([^x×\]\s]+)\s*[x×]\s*(\d+)\]\s*(?:[（(]([\s\S]*?)[）)])?$/);
        if (catboxUseMatch) {
            return {
                type: 'catbox_item_use',
                itemName: String(catboxUseMatch[1] || '').trim(),
                quantity: Math.max(1, Number.parseInt(catboxUseMatch[2], 10) || 1),
                note: String(catboxUseMatch[3] || '').trim(),
                content: trimmedContent
            };
        }

        const paymentActionMatch = trimmedContent.match(/^\[(收款|领取红包|退回转账|退回红包)\](?:\s*[（(]\s*([^）)]*)\s*[）)])?$/);
        if (paymentActionMatch) {
            const marker = String(paymentActionMatch[1] || '').trim();
            return {
                type: 'payment_action',
                action: marker.includes('退回') ? 'refund' : 'accept',
                targetType: marker.includes('红包') ? 'redpacket' : 'transfer',
                note: String(paymentActionMatch[2] || '').trim(),
                content: `[${marker}]`
            };
        }

        // 匹配 [微博新闻]...[/微博新闻]
        if (content.includes('[微博新闻]') && content.includes('[/微博新闻]')) {
            const parsedWeibo = this._parseWeiboNewsCard(content);
            if (parsedWeibo) return parsedWeibo;
        }

        // 匹配 [定位](地理位置) / [定位]（地理位置）/ 【定位】(地理位置)
        const locationMatch = content.match(/(?:\[\s*定位\s*\]|【\s*定位\s*】)\s*[（(]\s*([^)）]+?)\s*[)）]/);
        if (locationMatch) {
            const locationText = String(locationMatch[1] || '').trim();
            if (locationText) {
                return {
                    type: 'location',
                    locationText,
                    content: locationText
                };
            }
        }

        // 匹配 [转账](金额：xx元) 或 [转账] ¥xx
        const transferMatch = content.match(/\[转账\]\s*(?:[（(]\s*(?:金额[：:]?\s*)?(\d+(?:\.\d+)?)\s*元?\s*[)）]|[¥￥]\s*(\d+(?:\.\d+)?))/);
        if (transferMatch) {
            const amount = transferMatch[1] || transferMatch[2];
            return {
                type: 'transfer',
                amount: amount,
                desc: '转账给你',
                content: `[转账] ¥${parseFloat(amount).toFixed(2)}`
            };
        }

        // 匹配 [红包](金额：xx元) 或 [红包]
        const redpacketMatch = content.match(/\[红包\]\s*(?:[（(]\s*(?:金额[：:]?\s*)?(\d+(?:\.\d+)?)\s*元?\s*[)）])?/);
        if (redpacketMatch) {
            const amount = redpacketMatch[1] || '0.01';
            return {
                type: 'redpacket',
                amount: parseFloat(amount).toFixed(2),
                wish: '恭喜发财，大吉大利',
                status: 'sent',
                content: `[红包] ¥${parseFloat(amount).toFixed(2)}`
            };
        }

        const callMarker = this._parseIncomingCallMarker(content);
        if (callMarker) {
            const callContent = callMarker.isGroupCall
                ? `[拨打微信群${callMarker.callTypeStr}]`
                : `[拨打微信${callMarker.callTypeStr}]`;
            return {
                type: 'incoming_call',
                callType: callMarker.callType,
                isGroupCall: callMarker.isGroupCall,
                content: callContent
            };
        }

        const honeyMatch = String(content || '').trim().match(/^[［\[]\s*蜜语\s*[］\]]\s*(?:[（(]\s*([^）)]*)\s*[）)])?\s*$/i);
        if (honeyMatch) {
            const status = String(honeyMatch[1] || '等待中...').trim() || '等待中...';
            return {
                type: 'honey_invite',
                honeyInviteStatus: status,
                content: `[蜜语]（${status}）`
            };
        }

        const musicInviteMatch = String(content || '').trim().match(/^(?:[［\[]\s*音乐\s*[］\]]|【\s*音乐\s*】)\s*[（(]\s*([^，,）)]+?)(?:\s*[，,]\s*([^）)]+?))?\s*[）)]\s*$/i);
        if (musicInviteMatch) {
            const songName = String(musicInviteMatch[1] || '').trim();
            const artist = String(musicInviteMatch[2] || '').trim();
            if (songName) {
                return {
                    type: 'music_invite',
                    musicInviteStatus: 'pending',
                    musicInvite: { songName, artist },
                    songName,
                    artist,
                    content: artist ? `[音乐]（${songName}，${artist}）` : `[音乐]（${songName}）`
                };
            }
        }

        const stickerMatch = String(content || '').trim().match(/^\[表情包\]\s*[（(]\s*([^)）]+?)\s*[)）]\s*$/);
        if (stickerMatch) {
            const keyword = String(stickerMatch[1] || '').trim();
            const stickerUrl = this.normalizeStickerDirectImageUrl(keyword);
            return {
                type: 'sticker',
                keyword,
                stickerUrl,
                content: `[表情包]（${keyword || '表情包'}）`
            };
        }

        const imageMatch = String(content || '').trim().match(/^(?:(.{1,40})[：:]\s*)?\[(用户照片|个人图片|图片|视频)\]\s*([\s\S]+?)\s*$/);
        if (imageMatch) {
            const parsedImagePrompt = this._parseImagePromptText(imageMatch[3]);
            const parsed = {
                type: 'image_prompt',
                mediaType: imageMatch[2],
                usePersonalReference: imageMatch[2] === '个人图片',
                useUserReference: imageMatch[2] === '用户照片',
                imageDescription: parsedImagePrompt.description,
                imagePrompt: parsedImagePrompt.prompt,
                content: parsedImagePrompt.prompt
            };
            const inlineSender = String(imageMatch[1] || '').trim();
            if (inlineSender) parsed.sender = inlineSender;
            return parsed;
        }

        return null;
    }

    /**
     * 🔥 混合消息拆分器：
     * 支持 "普通文本 + [转账]/[红包]/[定位]标签 + 普通文本" 的行内拆分，
     * 将标签转换为独立特殊消息，同时保留其余文字内容。
     */
    splitMixedSpecialMessage(message) {
        if (!message || message.specialMessage) return [message];

        const rawContent = String(message.content || '');
        if (!rawContent.trim()) return [message];

        const wholeSpecial = this.parseSpecialMessage(rawContent);
        if (wholeSpecial) {
            return [{
                ...message,
                from: wholeSpecial.sender || message.from,
                sender: wholeSpecial.sender || message.sender,
                content: wholeSpecial.content || rawContent,
                specialMessage: wholeSpecial
            }];
        }

        const inlineSpecialRegex = /\[(?:同意收养|拒绝收养)\]|\[使用[：:]\s*[^x×\]\s]+\s*[x×]\s*\d+\]\s*(?:[（(][\s\S]*?[）)])?|\[(?:收款|领取红包|退回转账|退回红包)\](?:\s*[（(]\s*[^）)]*\s*[）)])?|\[转账\]\s*(?:[（(]\s*(?:金额[：:]?\s*)?\d+(?:\.\d+)?\s*元?\s*[)）]|[¥￥]\s*\d+(?:\.\d+)?)|\[红包\]\s*(?:[（(]\s*(?:金额[：:]?\s*)?\d+(?:\.\d+)?\s*元?\s*[)）])?|(?:\[\s*定位\s*\]|【\s*定位\s*】)\s*[（(]\s*[^)）]+?\s*[)）]|(?:\[\s*蜜语\s*\]|【\s*蜜语\s*】)\s*(?:[（(]\s*[^）)]*\s*[）)])?|(?:\[\s*音乐\s*\]|【\s*音乐\s*】)\s*[（(]\s*[^，,）)]+?(?:\s*[，,]\s*[^）)]+?)?\s*[）)]|(?:\[\s*(?:拨打|发起)\s*(?:微信)?(?:群)?(?:语音|视频)(?:通话)?\s*\]|【\s*(?:拨打|发起)\s*(?:微信)?(?:群)?(?:语音|视频)(?:通话)?\s*】)/g;
        const inlineMatches = [];
        this._collectInlineImagePromptMatches(rawContent).forEach(item => inlineMatches.push(item));
        let regexMatch;
        while ((regexMatch = inlineSpecialRegex.exec(rawContent)) !== null) {
            inlineMatches.push({
                index: regexMatch.index,
                raw: regexMatch[0]
            });
        }
        inlineMatches.sort((a, b) => a.index - b.index || b.raw.length - a.raw.length);
        let hasMatch = false;
        let lastIndex = 0;
        let usedQuote = false;
        const result = [];

        for (const match of inlineMatches) {
            if (match.index < lastIndex) continue;
            hasMatch = true;

            const beforeText = rawContent.slice(lastIndex, match.index).trim();
            if (beforeText) {
                result.push({
                    ...message,
                    content: beforeText,
                    quote: usedQuote ? null : message.quote
                });
                usedQuote = true;
            }

            const specialRaw = match.raw.trim();
            const special = this.parseSpecialMessage(specialRaw);
            if (special) {
                result.push({
                    ...message,
                    from: special.sender || message.from,
                    sender: special.sender || message.sender,
                    content: special.content || specialRaw,
                    specialMessage: special,
                    quote: null
                });
                usedQuote = true;
            }

            lastIndex = match.index + match.raw.length;
        }

        if (!hasMatch) return [message];

        const afterText = rawContent.slice(lastIndex).trim();
        if (afterText) {
            result.push({
                ...message,
                content: afterText,
                quote: usedQuote ? null : message.quote
            });
        }

        return result.filter(m => (m.specialMessage || String(m.content || '').trim()));
    }

    _collectInlineImagePromptMatches(rawContent = '') {
        const content = String(rawContent || '');
        const tagRegex = /\[(用户照片|个人图片|图片|视频)\]/g;
        const matches = [];
        let tagMatch;
        while ((tagMatch = tagRegex.exec(content)) !== null) {
            let cursor = tagRegex.lastIndex;
            while (cursor < content.length && /\s/.test(content[cursor])) cursor += 1;

            const firstGroup = this._readBracketGroupAt(content, cursor);
            if (!firstGroup) continue;
            cursor = firstGroup.endIndex;
            while (cursor < content.length && /\s/.test(content[cursor])) cursor += 1;

            const secondGroup = this._readBracketGroupAt(content, cursor);
            if (secondGroup) cursor = secondGroup.endIndex;

            matches.push({
                index: tagMatch.index,
                raw: content.slice(tagMatch.index, cursor)
            });
            tagRegex.lastIndex = cursor;
        }
        return matches;
    }

    _applyWechatPaymentAction(chatId, action = {}, actorName = '') {
        const safeChatId = String(chatId || '').trim();
        if (!safeChatId || !action || action.type !== 'payment_action') return null;

        const messages = this.app.wechatData.getMessages(safeChatId) || [];
        const targetType = action.targetType === 'redpacket' ? 'redpacket' : 'transfer';
        let target = null;
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (!msg || msg.type !== targetType) continue;
            const isUserSent = msg.from === 'me' || msg.from === this.app.wechatData.getUserInfo()?.name;
            if (!isUserSent) continue;
            const status = String(msg.status || '').trim();
            const isPending = targetType === 'redpacket'
                ? (status === '' || status === 'sent')
                : status !== 'received' && status !== 'refunded';
            if (!isPending) continue;
            target = msg;
            break;
        }

        if (!target?.id) return null;

        const isRefund = action.action === 'refund';
        const nextStatus = isRefund ? 'refunded' : (targetType === 'redpacket' ? 'opened' : 'received');
        const amount = Number.parseFloat(target.amount || 0);
        const updated = this.app.wechatData.updateMessageById(safeChatId, target.id, {
            status: nextStatus,
            paymentHandledBy: String(actorName || '').trim(),
            paymentHandledAt: Date.now()
        });

        if (isRefund && Number.isFinite(amount) && amount > 0) {
            this.app.wechatData.updateWalletBalance(amount, safeChatId);
        }

        if (updated) {
            const statusText = isRefund
                ? '已退回'
                : (targetType === 'redpacket' ? '对方已领取' : '对方已收款');
            this.app.wechatData.addMessage(safeChatId, {
                from: 'system',
                type: 'system',
                content: statusText,
                paymentTargetId: target.id,
                paymentTargetType: targetType,
                paymentAction: isRefund ? 'refund' : 'accept'
            });
        }

        return updated;
    }

    _getCatboxData() {
        if (window.VirtualPhone?.gamesApp?.catboxData) return window.VirtualPhone.gamesApp.catboxData;
        if (!this._catboxData) {
            this._catboxData = new CatboxData(this.app?.storage || window.VirtualPhone?.storage);
        }
        return this._catboxData;
    }

    _handleCatboxCoAdoptResponse(chatId, special = {}, senderName = '') {
        const catboxData = this._getCatboxData();
        const chat = this.app.wechatData.getChat?.(chatId);
        const name = String(senderName || chat?.name || '').trim();
        const status = special.decision === 'accepted' ? 'accepted' : 'rejected';
        if (special.decision === 'accepted') {
            catboxData.acceptCoAdopt?.(chatId, name);
        } else {
            catboxData.rejectCoAdopt?.(chatId, name);
        }
        const state = catboxData.getState?.() || {};
        const invite = state.coAdoptInvite || {};
        const messageId = String(invite.messageId || '').trim();
        if (messageId) {
            this.app.wechatData.updateMessageById?.(chatId, messageId, {
                catboxInviteStatus: status,
                catboxInviteResolvedBy: name,
                catboxInviteResolvedAt: Date.now()
            });
        }
        window.VirtualPhone?.gamesApp?.catboxView?.render?.();
        return { content: status === 'accepted' ? `${name || '好友'}同意共同收养` : `${name || '好友'}拒绝共同收养` };
    }

    _buildCatboxCareCardMessage(chatId, special = {}, senderName = '', senderAvatar = '', time = '', replyBatchId = '') {
        const result = this._getCatboxData().applyFriendItemUse?.({
            chatId,
            senderName,
            itemName: special.itemName,
            quantity: special.quantity,
            note: special.note
        });
        window.VirtualPhone?.gamesApp?.catboxView?.render?.();
        if (!result?.success) {
            return {
                from: senderName,
                type: 'text',
                content: result?.content || '猫盒照顾失败',
                time,
                avatar: senderAvatar,
                replyBatchId
            };
        }
        return {
            from: senderName,
            type: 'catbox_care_card',
            content: result.content,
            catboxPetName: result.petName,
            catboxItemName: result.itemName,
            catboxQuantity: result.quantity,
            catboxNote: result.note,
            time,
            avatar: senderAvatar,
            replyBatchId
        };
    }

    _collectIncomingCallFollowUps(messages = [], callIndex = 0) {
        const queuedLines = [];
        let consumedCount = 0;
        const caller = String(messages?.[callIndex]?.sender || '').trim();

        for (let i = callIndex + 1; i < messages.length; i++) {
            const nextMsg = messages[i];
            if (!nextMsg) break;

            const nextSender = String(nextMsg.sender || '').trim();
            if (caller && nextSender && nextSender !== caller) break;

            const nextContent = this._stripCallSpeechPrefix(nextMsg.content || '');
            const nextSpecial = nextMsg.specialMessage || this.parseSpecialMessage(nextContent);
            if (nextSpecial) break;

            consumedCount++;
            if (!nextContent) continue;
            queuedLines.push(nextContent);
        }

        return { queuedLines, consumedCount };
    }

    // 🔥 绑定红包/转账气泡的点击事件
    bindSpecialMessageEvents() {
        const currentView = this.getCurrentWechatView();
        currentView.querySelectorAll('.message-redpacket').forEach(rp => {
            rp.addEventListener('click', (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                const messageId = e.currentTarget.dataset.msgId;
                if (messageId) this.openRedPacket(messageId);
            });
        });
        currentView.querySelectorAll('.message-transfer').forEach(tf => {
            tf.addEventListener('click', (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                const messageId = e.currentTarget.dataset.msgId;
                if (messageId) this.openTransferDetail(messageId);
            });
        });
        currentView.querySelectorAll('.message-weibo-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                if (Date.now() < (this._suppressWeiboCardClickUntil || 0)) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                const messageId = e.currentTarget.dataset.msgId;
                if (messageId) this.openWeiboCard(messageId);
            });
        });
        currentView.querySelectorAll('.message-poker-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                if (Date.now() < (this._suppressPokerCardClickUntil || 0)) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                const messageId = e.currentTarget.dataset.msgId;
                if (messageId) this.openPokerCard(messageId);
            });
        });
        currentView.querySelectorAll('.message-werewolf-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                if (Date.now() < (this._suppressWerewolfCardClickUntil || 0)) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                const messageId = e.currentTarget.dataset.msgId;
                if (messageId) this.openWerewolfCard(messageId);
            });
        });
        currentView.querySelectorAll('.message-music-listen-cancel').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                e.preventDefault();
                e.stopPropagation();
                const chatId = btn.dataset.chatId || this.app.currentChat?.id || '';
                this.app.endMusicListening?.(chatId, { reason: 'manual' });
            });
        });
        currentView.querySelectorAll('[data-action="accept-music-invite"], [data-action="reject-music-invite"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                e.preventDefault();
                e.stopPropagation();
                const messageId = btn.dataset.messageId || '';
                if (!messageId) return;
                if (btn.dataset.action === 'accept-music-invite') {
                    await this.acceptMusicInvite(messageId);
                } else {
                    this.rejectMusicInvite(messageId);
                }
            });
        });
        currentView.querySelectorAll('.message-image-prompt-generate').forEach(card => {
            card.addEventListener('click', async (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                e.preventDefault();
                e.stopPropagation();
                const messageId = e.currentTarget.dataset.messageId;
                if (messageId) {
                    await this.generateImagePromptMessage(messageId);
                }
            });
        });
        currentView.querySelectorAll('.message-image-prompt-regenerate').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                e.preventDefault();
                e.stopPropagation();
                const messageId = e.currentTarget.dataset.messageId;
                if (messageId) {
                    await this.generateImagePromptMessage(messageId);
                }
            });
        });
        currentView.querySelectorAll('.message-image-prompt-front-panel img').forEach(img => {
            img.addEventListener('click', (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                e.preventDefault();
                e.stopPropagation();
                this._openPhoneImageViewer(e.currentTarget.getAttribute('src'), e.currentTarget.getAttribute('alt') || '');
            });
        });
        currentView.querySelectorAll('.message-image').forEach(img => {
            img.addEventListener('click', (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                e.preventDefault();
                e.stopPropagation();
                this._openPhoneImageViewer(e.currentTarget.getAttribute('src'), e.currentTarget.getAttribute('alt') || '');
            });
        });
        currentView.querySelectorAll('.message-image-prompt-show-back').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                e.preventDefault();
                e.stopPropagation();
                this._toggleImagePromptCard(e.currentTarget.closest('.message-image-prompt-box'), true);
            });
        });
        currentView.querySelectorAll('.message-image-prompt-restore').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                e.preventDefault();
                e.stopPropagation();
                this._toggleImagePromptCard(e.currentTarget.closest('.message-image-prompt-box'), false);
            });
        });

        this.scheduleInlineStickerHydration();
    }

    bindInnerThoughtEvents() {
        const currentView = this.getCurrentWechatView();
        const root = currentView?.querySelector('#chat-messages') || currentView;
        if (!root) return;

        root.querySelectorAll('.wechat-inner-os-fold').forEach(btn => {
            if (btn.dataset.innerOsBound === '1') return;
            btn.dataset.innerOsBound = '1';
            btn.addEventListener('click', (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                e.preventDefault();
                e.stopPropagation();

                const wrapper = btn.closest('.wechat-inner-os-wrapper');
                if (!wrapper) return;
                const shouldOpen = !wrapper.classList.contains('show-os');
                root.querySelectorAll('.wechat-inner-os-wrapper.show-os').forEach(el => {
                    if (el !== wrapper) el.classList.remove('show-os');
                });
                wrapper.classList.toggle('show-os', shouldOpen);
            });
        });
    }

    async syncWeiboNewsToWeiboApp(weiboPayload, fallbackBlogger = '微博', options = {}) {
        if (!weiboPayload) return null;

        try {
            const suppressNotify = options?.suppressNotify === true;
            let weiboDataEngine = window.VirtualPhone?.weiboApp?.weiboData || window.VirtualPhone?.cachedWeiboDataEngine || null;
            if (!weiboDataEngine) {
                const module = await import('../weibo/weibo-data.js');
                const storage = window.VirtualPhone?.storage || this.app.storage;
                if (!storage) return null;
                weiboDataEngine = new module.WeiboData(storage);
                if (window.VirtualPhone) {
                    window.VirtualPhone.cachedWeiboDataEngine = weiboDataEngine;
                }
            }

            const post = weiboDataEngine.upsertFromWechatWeiboCard(weiboPayload, { fallbackBlogger });

            if (post && !suppressNotify) {
                const bloggerName = String(post.blogger || fallbackBlogger || '微博').trim();
                const rawText = String(post.content || post.text || '').replace(/\s+/g, ' ').trim();
                const preview = rawText ? `${rawText.slice(0, 20)}${rawText.length > 20 ? '...' : ''}` : '收到 1 条微博更新';
                if (window.VirtualPhone?.notify) {
                    window.VirtualPhone.notify('微博', `${bloggerName}：${preview}`, '📱', {
                        avatarText: '微',
                        avatarBg: '#ff8200',
                        avatarColor: '#fff',
                        name: bloggerName || '微博',
                        content: preview,
                        timeText: '刚刚',
                        senderKey: `weibo:wechat-sync:${Date.now()}`
                    });
                } else {
                    this.app.phoneShell?.showNotification('微博', `${bloggerName}：${preview}`, '📱');
                }
            }

            // 即使手机面板没打开，只要微博实例已存在，也标记并刷新推荐页数据
            const weiboApp = window.VirtualPhone?.weiboApp;
            if (post && weiboApp) {
                weiboApp.handleExternalRecommendUpdate?.();
            }

            return post;
        } catch (error) {
            console.error('同步微博新闻到微博APP失败:', error);
            return null;
        }
    }

    async _ensureHoneyAppReady() {
        if (window.VirtualPhone?.honeyApp) return window.VirtualPhone.honeyApp;
        const module = await import('../honey/honey-app.js');
        const phoneShell = window.VirtualPhone?.phoneShell || this.app.phoneShell;
        const storage = window.VirtualPhone?.storage || this.app.storage;
        if (!window.VirtualPhone) window.VirtualPhone = {};
        window.VirtualPhone.honeyApp = new module.HoneyApp(phoneShell, storage);
        return window.VirtualPhone.honeyApp;
    }

    async _openHoneyFromWechatContact(contactName, chatId = '', options = {}) {
        const safeName = String(contactName || '').trim();
        if (!safeName) return false;
        const inviteSource = String(options?.inviteSource || 'user_request').trim() || 'user_request';
        const isFriendInvite = inviteSource === 'friend_invite';
        const honeyApp = await this._ensureHoneyAppReady();
        const host = honeyApp.honeyData?.ensureFollowedHostFromWechat?.(safeName, {
            title: '',
            intro: isFriendInvite ? '微信好友邀请用户进入蜜语直播间。' : '微信好友接受了用户发起的蜜语邀约。'
        });
        const hostName = host?.name || safeName;
        this.app.wechatData.recordHoneyInviteDecision?.(safeName, 'accepted', {
            message: isFriendInvite ? '用户接受了微信好友发起的蜜语邀约' : '用户主动发起，AI接受'
        });
        if (chatId) this.app.wechatData.setHoneyHistoryInjectionForChat?.(chatId, true);
        window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'honey' } }));
        setTimeout(() => {
            window.VirtualPhone?.honeyApp?.openFollowedHostLive?.(hostName, {
                autoGenerateIfMissing: false,
                title: `${hostName} 的直播间`,
                intro: isFriendInvite ? '你接受了微信好友发起的蜜语邀约。' : '微信好友接受了你发起的蜜语邀约。',
                inviteSource,
                resetSession: isFriendInvite
            });
        }, 180);
        return true;
    }

    _isHoneyInviteWaitingStatus(status = '') {
        return /等待|请求|邀约中|pending|wait/i.test(String(status || '').trim());
    }

    _refreshChatMessagesIfVisible(chatId = '') {
        const safeChatId = String(chatId || '').trim();
        if (!safeChatId || String(this.app.currentChat?.id || '').trim() !== safeChatId) return;
        const messagesDiv = this._getVisibleChatMessagesContainer(safeChatId);
        if (!messagesDiv) return;
        const messages = this.app.wechatData.getMessages(safeChatId) || [];
        const userInfo = this.app.wechatData.getUserInfo();
        this.smartUpdateMessages(messages, userInfo, { chatId: safeChatId });
    }

    _updateHoneyInviteMessageStatus(chatId = '', messageId = '', status = '') {
        const safeChatId = String(chatId || '').trim();
        const safeMessageId = String(messageId || '').trim();
        const safeStatus = String(status || '').trim();
        if (!safeChatId || !safeStatus) return null;

        let targetId = safeMessageId;
        if (!targetId) {
            const messages = this.app.wechatData.getMessages(safeChatId) || [];
            const lastInvite = [...messages].reverse().find(msg => msg?.type === 'honey_invite');
            targetId = String(lastInvite?.id || '').trim();
        }
        if (!targetId) return null;

        const updated = this.app.wechatData.updateMessageById?.(safeChatId, targetId, {
            honeyInviteStatus: safeStatus,
            content: `[蜜语]（${safeStatus}）`
        });
        this._refreshChatMessagesIfVisible(safeChatId);
        return updated;
    }

    _showHoneyInvitePopup({ contactName = '', chatId = '', messageId = '', message = '' } = {}) {
        const safeContactName = String(contactName || '').trim();
        if (!safeContactName) return;
        const fingerprint = `${chatId || ''}:${messageId || ''}:${safeContactName}`;
        const old = document.getElementById('st-phone-honey-invite-modal');
        if (old?.dataset?.fingerprint === fingerprint) return;
        old?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'st-phone-honey-invite-modal';
        overlay.className = 'st-phone-honey-invite-modal honey-live-collab-modal';
        overlay.dataset.fingerprint = fingerprint;
        overlay.innerHTML = `
            <button class="st-phone-honey-invite-backdrop honey-live-collab-modal-backdrop" type="button" data-action="dismiss" aria-label="关闭蜜语邀约"></button>
            <div class="st-phone-honey-invite-panel honey-live-collab-modal-panel" role="dialog" aria-modal="true" aria-label="蜜语邀约">
                <div class="honey-live-collab-modal-head">
                    <div class="honey-live-collab-modal-title">蜜语邀请</div>
                    <button class="honey-live-collab-modal-close" type="button" data-action="dismiss" aria-label="关闭蜜语邀约">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="st-phone-honey-invite-text">${this._escapeHtml(safeContactName)} 邀请你进入蜜语直播间。</div>
                <div class="st-phone-honey-invite-actions">
                    <button class="st-phone-honey-invite-action is-reject" type="button" data-action="reject">拒绝</button>
                    <button class="st-phone-honey-invite-action is-accept" type="button" data-action="accept">接受</button>
                </div>
            </div>
        `;

        const host = document.querySelector('.phone-view-current .wechat-app')
            || document.querySelector('.phone-view-current')
            || document.getElementById('phone-panel')
            || document.body;
        host.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelectorAll('[data-action="dismiss"]').forEach(el => {
            el.addEventListener('click', close);
        });
        overlay.querySelector('.st-phone-honey-invite-action[data-action="reject"]')?.addEventListener('click', () => {
            close();
            this._updateHoneyInviteMessageStatus(chatId, messageId, '已拒绝');
            this.app.wechatData.recordHoneyInviteDecision?.(safeContactName, 'rejected', { message: message || '用户拒绝' });
            this.app.phoneShell?.showNotification?.('蜜语邀约', '已拒绝，对方会在下轮知道结果', '💔');
        });
        overlay.querySelector('.st-phone-honey-invite-action[data-action="accept"]')?.addEventListener('click', () => {
            close();
            this._updateHoneyInviteMessageStatus(chatId, messageId, '已接受');
            this._openHoneyFromWechatContact(safeContactName, chatId, { inviteSource: 'friend_invite' }).catch((err) => {
                console.error('打开蜜语失败:', err);
                this.app.phoneShell?.showNotification('蜜语', '打开蜜语失败：' + (err?.message || err), '⚠️');
            });
        });
    }

    _handleHoneyInviteResponse(special, { senderName = '', chatId = '' } = {}) {
        if (!special || special.type !== 'honey_invite') return;
        const status = String(special.honeyInviteStatus || '').trim();
        const targetName = String(senderName || this.app.currentChat?.name || '').trim();
        if (!targetName) return;
        if (this._isHoneyInviteWaitingStatus(status)) {
            this._showHoneyInvitePopup({
                contactName: targetName,
                chatId,
                messageId: special.id || special.messageId || '',
                message: status || '等待中...'
            });
            return;
        }
        if (/拒绝|不接受|decline|reject/i.test(status)) {
            this.app.wechatData.recordHoneyInviteDecision?.(targetName, 'rejected', { message: status || '拒绝' });
            return;
        }
        if (/^(?:接受|同意|接收|accept|yes|ok)$/i.test(status)) {
            this._openHoneyFromWechatContact(targetName, chatId, { inviteSource: 'friend_invite' }).catch((err) => {
                console.error('打开蜜语失败:', err);
                this.app.phoneShell?.showNotification('蜜语', '打开蜜语失败：' + (err?.message || err), '⚠️');
            });
        }
    }

    async openWeiboCard(messageId) {
        try {
            const chatId = this.app.currentChat?.id;
            if (!chatId) return;

            const messages = this.app.wechatData.getMessages(chatId) || [];
            const target = messages.find(m => m.id === messageId);
            if (!target || target.type !== 'weibo_card' || !target.weiboData) return;

            const userInfo = this.app.wechatData.getUserInfo();
            const isUserForwardCard = target.from === 'me' || target.from === userInfo?.name;

            // 用户自己转发的微博：保持微信内弹窗预览样式，不跳微博APP
            if (isUserForwardCard) {
                // 后台同步到微博数据池（不打断弹窗显示）
                this.syncWeiboNewsToWeiboApp(target.weiboData, target.from || '微博', { suppressNotify: true }).catch(() => {});
                this.showWeiboCardPreviewModal(target.weiboData);
                return;
            }

            // AI/他人转发的微博：跳微博正文详情
            const post = await this.syncWeiboNewsToWeiboApp(target.weiboData, target.from || '微博', { suppressNotify: true });
            if (!post) {
                // 兜底：同步失败时仍可在微信内查看
                this.showWeiboCardPreviewModal(target.weiboData);
                return;
            }

            let weiboApp = window.VirtualPhone?.weiboApp || null;
            if (!weiboApp) {
                const module = await import('../weibo/weibo-app.js');
                const phoneShell = window.VirtualPhone?.phoneShell || this.app.phoneShell;
                const storage = window.VirtualPhone?.storage || this.app.storage;
                if (!phoneShell || !storage) return;
                weiboApp = new module.WeiboApp(phoneShell, storage);
                if (window.VirtualPhone) {
                    window.VirtualPhone.weiboApp = weiboApp;
                }
            }

            weiboApp.weiboView.currentHotSearchTitle = null;
            weiboApp.weiboView.entrySource = {
                appId: 'wechat',
                chatId: chatId,
                chatName: this.app.currentChat?.name || ''
            };
            weiboApp.weiboView.currentPostId = post.id;
            weiboApp.weiboView.currentPostMode = 'recommend';
            weiboApp.weiboView.currentTab = 'recommend';
            weiboApp.weiboView.currentView = 'postDetail';
            weiboApp.render();
        } catch (error) {
            console.error('打开微博卡片失败:', error);
            this.app.phoneShell?.showNotification('提示', '微博卡片打开失败', '⚠️');
        }
    }

    openPokerCard(messageId) {
        try {
            const chatId = this.app.currentChat?.id;
            if (!chatId) return;

            const messages = this.app.wechatData.getMessages(chatId) || [];
            const target = messages.find(m => m.id === messageId);
            if (!target || target.type !== 'poker_card' || !target.pokerData) return;

            this.showPokerCardPreviewModal(target.pokerData);
        } catch (error) {
            console.error('打开德州扑克卡片失败:', error);
            this.app.phoneShell?.showNotification('提示', '德州扑克卡片打开失败', '⚠️');
        }
    }

    showPokerCardPreviewModal(pokerData = {}) {
        const title = this._escapeHtml(pokerData.title || '德州扑克牌局记录');
        const content = this._escapeHtml(pokerData.content || pokerData.desc || '暂无牌局内容');
        const timeText = this._escapeHtml(String(pokerData.sharedAt || '').trim());

        const currentView = document.querySelector('.phone-view-current') || document;
        const host = currentView.querySelector('.wechat-app') || currentView;
        if (!host) return;

        const old = currentView.querySelector('#wechat-poker-preview-modal');
        if (old) old.remove();

        const modal = document.createElement('div');
        modal.id = 'wechat-poker-preview-modal';
        modal.style.cssText = `
            position:absolute; inset:0; z-index:9999;
            background:rgba(0,0,0,0.5);
            display:flex; align-items:center; justify-content:center;
            padding:12px; box-sizing:border-box;
        `;

        modal.innerHTML = `
            <div style="
                background:#fff; border-radius:10px;
                width:100%; max-width:320px; max-height:82%;
                overflow:hidden; display:flex; flex-direction:column;
                box-sizing:border-box;
            ">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:13px 14px 10px; border-bottom:0.5px solid #eee;">
                    <div style="min-width:0;">
                        <div style="font-size:14px; color:#111; font-weight:700; line-height:1.3; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${title}</div>
                        ${timeText ? `<div style="font-size:10px; color:#999; margin-top:3px;">${timeText}</div>` : ''}
                    </div>
                    <button id="wechat-poker-preview-close" style="border:none; background:none; color:#999; font-size:14px; cursor:pointer; line-height:1; flex:0 0 auto;">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="wechat-poker-preview-body" style="padding:12px 14px 14px; overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; touch-action:pan-y; overscroll-behavior:contain; min-height:0; flex:1;">
                    <div style="font-size:12px; line-height:1.65; color:#333; text-align:left; white-space:pre-wrap; word-break:break-word; font-family:inherit;">${content}</div>
                </div>
            </div>
        `;

        host.appendChild(modal);

        const close = () => modal.remove();
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });
        modal.querySelector('#wechat-poker-preview-close')?.addEventListener('click', close);
    }

    openWerewolfCard(messageId) {
        try {
            const chatId = this.app.currentChat?.id;
            if (!chatId) return;

            const messages = this.app.wechatData.getMessages(chatId) || [];
            const target = messages.find(m => m.id === messageId);
            if (!target || target.type !== 'werewolf_card' || !target.werewolfData) return;

            this.showWerewolfCardPreviewModal(target.werewolfData);
        } catch (error) {
            console.error('打开狼人杀卡片失败:', error);
            this.app.phoneShell?.showNotification('提示', '狼人杀卡片打开失败', '⚠️');
        }
    }

    showWerewolfCardPreviewModal(werewolfData = {}) {
        const title = this._escapeHtml(werewolfData.title || '狼人杀复盘记录');
        const result = this._escapeHtml(werewolfData.result || '复盘分享');
        const content = this._escapeHtml(werewolfData.content || werewolfData.desc || '暂无复盘内容');
        const timeText = this._escapeHtml(String(werewolfData.sharedAt || '').trim());

        const currentView = document.querySelector('.phone-view-current') || document;
        const host = currentView.querySelector('.wechat-app') || currentView;
        if (!host) return;

        const old = currentView.querySelector('#wechat-werewolf-preview-modal');
        if (old) old.remove();

        const modal = document.createElement('div');
        modal.id = 'wechat-werewolf-preview-modal';
        modal.style.cssText = `
            position:absolute; inset:0; z-index:9999;
            background:rgba(0,0,0,0.5);
            display:flex; align-items:center; justify-content:center;
            padding:12px; box-sizing:border-box;
        `;

        modal.innerHTML = `
            <div class="wechat-werewolf-preview-panel" style="
                background:#fff; border-radius:10px;
                width:100%; max-width:320px; max-height:82%;
                overflow:hidden; display:flex; flex-direction:column;
                box-sizing:border-box;
                transition:transform 0.18s ease, opacity 0.18s ease;
            ">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:13px 14px 10px; border-bottom:0.5px solid #eee;">
                    <div style="min-width:0;">
                        <div style="font-size:14px; color:#111; font-weight:700; line-height:1.3; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${title}</div>
                        <div style="font-size:10px; color:#999; margin-top:3px;">${result}${timeText ? ` · ${timeText}` : ''}</div>
                    </div>
                    <button id="wechat-werewolf-preview-close" style="border:none; background:none; color:#999; font-size:14px; cursor:pointer; line-height:1; flex:0 0 auto;">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="wechat-werewolf-preview-body" style="padding:12px 14px 14px; overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; touch-action:pan-y; overscroll-behavior:contain; min-height:0; flex:1;">
                    <div style="font-size:12px; line-height:1.65; color:#333; text-align:left; white-space:pre-wrap; word-break:break-word; font-family:inherit;">${content}</div>
                </div>
            </div>
        `;

        host.appendChild(modal);

        const close = () => modal.remove();
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });
        modal.querySelector('#wechat-werewolf-preview-close')?.addEventListener('click', close);

        const panel = modal.querySelector('.wechat-werewolf-preview-panel');
        const body = modal.querySelector('.wechat-werewolf-preview-body');
        let touchStartY = 0;
        let touchStartX = 0;
        let pullDistance = 0;
        let trackingPullDown = false;

        body?.addEventListener('touchstart', (e) => {
            const touch = e.touches?.[0];
            if (!touch) return;
            touchStartY = Number(touch.clientY || 0);
            touchStartX = Number(touch.clientX || 0);
            pullDistance = 0;
            trackingPullDown = Number(body.scrollTop || 0) <= 0;
        }, { passive: true });

        body?.addEventListener('touchmove', (e) => {
            if (!trackingPullDown || !panel) return;
            const touch = e.touches?.[0];
            if (!touch) return;
            const deltaY = Number(touch.clientY || 0) - touchStartY;
            const deltaX = Math.abs(Number(touch.clientX || 0) - touchStartX);
            if (deltaY <= 0 || deltaY <= deltaX) return;
            pullDistance = Math.min(120, Math.round(deltaY * 0.45));
            if (pullDistance > 8 && e.cancelable) e.preventDefault();
            panel.style.transform = `translateY(${pullDistance}px)`;
            panel.style.opacity = String(Math.max(0.72, 1 - pullDistance / 220));
        }, { passive: false });

        const finishPull = () => {
            if (!panel) return;
            const shouldClose = trackingPullDown && pullDistance >= 54;
            trackingPullDown = false;
            pullDistance = 0;
            panel.style.transform = '';
            panel.style.opacity = '';
            if (shouldClose) close();
        };

        body?.addEventListener('touchend', finishPull, { passive: true });
        body?.addEventListener('touchcancel', finishPull, { passive: true });
    }

    showWeiboCardPreviewModal(weiboData = {}) {
        const esc = (v) => String(v || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        const stripName = (v) => String(v || '').trim().replace(/^@/, '');
        const parseWeiboMediaPreview = (raw) => {
            const txt = String(raw || '').trim();
            if (!txt) return null;
            const m = txt.match(/\[(用户照片|个人图片|图片|视频)\]\s*[（(]([^）)]+)[）)]/);
            if (m && m[2]) {
                return { type: m[1], desc: m[2].trim() };
            }
            const stripped = txt.replace(/^\[(用户照片|个人图片|图片|视频)\]\s*/g, '').trim();
            return stripped ? { type: '图片', desc: stripped } : null;
        };

        const bloggerRaw = String(weiboData.blogger || '微博').trim();
        const blogger = esc(bloggerRaw || '微博');
        const bloggerType = esc(weiboData.bloggerType || '');
        const time = esc(weiboData.time || '');
        const device = esc(weiboData.device || '');
        const avatarChar = esc(stripName(bloggerRaw).charAt(0) || '微');
        const rawContent = String(weiboData.content || '')
            .replace(/\r\n/g, '\n')
            .replace(/&nbsp;/gi, ' ')
            .replace(/\u00a0/g, ' ')
            .replace(/\u3000/g, ' ')
            .split('\n')
            .map(line => line.trim())
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        const content = esc(this.cleanAbnormalSpaces(rawContent));

        const forward = Number.parseInt(weiboData.forward, 10) || 0;
        const comments = Number.parseInt(weiboData.comments, 10) || (Array.isArray(weiboData.commentList) ? weiboData.commentList.length : 0);
        const likes = Number.parseInt(weiboData.likes, 10) || 0;

        const imageLines = (Array.isArray(weiboData.images) ? weiboData.images : [])
            .map(parseWeiboMediaPreview)
            .filter(Boolean)
            .slice(0, 6);

        const commentList = (Array.isArray(weiboData.commentList) ? weiboData.commentList : [])
            .slice(0, 30)
            .map((c, idx) => ({
                floor: idx + 1,
                name: stripName(c?.name) || '网友',
                location: String(c?.location || '').trim(),
                replyTo: stripName(c?.replyTo),
                text: String(c?.text || '').replace(/\s+/g, ' ').trim()
            }))
            .filter(c => c.text);

        // 楼中楼：回复楼层挂到被回复人的主评论下面，找不到目标则降级为主评论
        const topLevel = [];
        const mainByName = new Map();
        commentList.forEach((c) => {
            if (c.replyTo && mainByName.has(c.replyTo)) {
                mainByName.get(c.replyTo).replies.push(c);
                return;
            }
            const node = { ...c, replies: [] };
            topLevel.push(node);
            mainByName.set(c.name, node);
        });

        const renderCommentLine = (comment, nested = false) => {
            const name = esc(comment.name || '网友');
            const replyTo = esc(comment.replyTo || '');
            const location = esc(comment.location || '');
            const text = esc(comment.text || '');
            return `
                <div style="padding:${nested ? '5px 0' : '6px 0'}; font-size:11px; line-height:1.5; color:#333; text-align:left; word-break:break-word;">
                    ${nested ? `<span style="color:#aaa;">↳ </span>` : `<span style="color:#999;">${comment.floor}. </span>`}
                    <span style="color:#4a90d9;">${name}</span>
                    ${location ? `<span style="color:#c3c3c3; font-size:10px;"> (ip${location})</span>` : ''}
                    ${replyTo ? `<span style="color:#999;"> 回复 </span><span style="color:#4a90d9;">${replyTo}</span>` : ''}
                    <span style="color:#666;">：${text}</span>
                </div>
            `;
        };

        const commentsHtml = topLevel.map((main) => {
            const replyHtml = main.replies.map(reply => renderCommentLine(reply, true)).join('');
            return `
                <div style="padding: 0 0 6px 0; border-bottom: 0.5px solid #f1f1f1;">
                    ${renderCommentLine(main, false)}
                    ${replyHtml ? `<div style="margin-left: 14px; padding-left: 8px; border-left: 1px solid #eee;">${replyHtml}</div>` : ''}
                </div>
            `;
        }).join('');

        const currentView = document.querySelector('.phone-view-current') || document;
        const host = currentView.querySelector('.wechat-app') || currentView;
        if (!host) return;

        const old = currentView.querySelector('#wechat-weibo-preview-modal');
        if (old) old.remove();

        const modal = document.createElement('div');
        modal.id = 'wechat-weibo-preview-modal';
        modal.style.cssText = `
            position:absolute; inset:0; z-index:9999;
            background:rgba(0,0,0,0.5);
            display:flex; align-items:center; justify-content:center;
            padding:12px; box-sizing:border-box;
        `;

        modal.innerHTML = `
            <div style="
                background:#fff; border-radius:10px;
                width:100%; max-width:320px; max-height:82%;
                overflow-y:auto; -webkit-overflow-scrolling:touch;
                padding:14px; box-sizing:border-box;
            ">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
                    <div style="font-size:13px; color:#111;">微博分享</div>
                    <button id="wechat-weibo-preview-close" style="border:none; background:none; color:#999; font-size:14px; cursor:pointer; line-height:1;">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
                    <div style="
                        width:32px; height:32px; border-radius:50%;
                        background:linear-gradient(135deg,#ff8200,#e85d04);
                        color:#fff; display:flex; align-items:center; justify-content:center;
                        font-size:12px; flex-shrink:0;
                    ">${avatarChar}</div>
                    <div style="min-width:0;">
                        <div style="font-size:13px; color:#1a1a1a; line-height:1.3;">
                            ${blogger}${bloggerType ? ` <span style="font-size:10px; color:#ff8200;">${bloggerType}</span>` : ''}
                        </div>
                        <div style="font-size:10px; color:#999; line-height:1.3;">
                            ${time}${device ? ` ${device}` : ''}
                        </div>
                    </div>
                </div>

                <div style="font-size:13px; line-height:1.6; margin:0 0 10px 0; text-align:left; white-space:pre-wrap; word-break:break-word; text-indent:0; padding:0;">${content}</div>

                ${imageLines.length > 0 ? `
                    <div style="margin-bottom:10px; background:#f7f7f7; border:0.5px solid #eee; border-radius:6px; padding:8px;">
                        ${imageLines.map((item, i) => `<div style="font-size:11px; color:#666; line-height:1.5;">${i + 1}. [${esc(item.type)}]（${esc(item.desc)}）</div>`).join('')}
                    </div>
                ` : ''}

                <div style="display:flex; gap:16px; font-size:11px; color:#999; padding:6px 0; border-top:0.5px solid #eee;">
                    <span>转发 ${forward}</span>
                    <span>评论 ${comments}</span>
                    <span>点赞 ${likes}</span>
                </div>

                ${commentsHtml ? `
                    <div style="margin-top:8px; padding-top:8px; border-top:4px solid #f5f5f5;">
                        <div style="font-size:12px; color:#1a1a1a; margin-bottom:6px;">评论 ${commentList.length}</div>
                        ${commentsHtml}
                    </div>
                ` : ''}
            </div>
        `;

        host.appendChild(modal);

        const close = () => modal.remove();
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });
        modal.querySelector('#wechat-weibo-preview-close')?.addEventListener('click', close);
    }

    compressChatImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const maxW = 1080;
                    let scale = 1;
                    if (img.width > maxW || img.height > maxW) {
                        scale = Math.min(maxW / img.width, maxW / img.height);
                    }
                    canvas.width = img.width * scale;
                    canvas.height = img.height * scale;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                    const exportFormat = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
                    const quality = exportFormat === 'image/png' ? undefined : 0.6;
                    resolve(canvas.toDataURL(exportFormat, quality));
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    waitForNextPaint() {
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }

    async sendImageMessageFromDataUrl(dataUrl, filenamePrefix = 'phone_chatimg') {
        const targetChatId = String(this.app.currentChat?.id || '').trim();
        if (!dataUrl || !targetChatId) return;

        try {
            const finalUrl = await window.VirtualPhone?.imageManager?.uploadDataUrl?.(dataUrl, filenamePrefix);
            if (!finalUrl) throw new Error('图片上传管理器未初始化');
            this.app.wechatData.addMessage(targetChatId, {
                from: 'me',
                type: 'image',
                content: finalUrl,
                avatar: this.app.wechatData.getUserInfo().avatar
            });

            this.resetTransientInputPanels();
            if (String(this.app.currentChat?.id || '') === targetChatId) {
                this.app.render();
            }

            if (this.isOnlineMode()) {
                this._enqueuePendingChat(targetChatId);
            }
        } catch (uploadErr) {
            console.warn('聊天图片上传服务器失败:', uploadErr);
            this.app.phoneShell.showNotification('上传失败', uploadErr?.message || '图片上传失败', '❌');
            return;
        }
    }

    async getSnapshotChatRoot() {
        return this.getCurrentWechatRoot();
    }

    async captureAndSendChatSnapshot({ longCapture = false } = {}) {
        if (!this.app.currentChat) return;

        const actionLabel = longCapture ? '长截图' : '截图';
        
        try {
            this.showMore = false;
            this.showEmoji = false;
            this.app.render(); 

            await new Promise(resolve => setTimeout(resolve, 250));

            this.app.phoneShell.showNotification(actionLabel, longCapture ? '正在生成长图(可能需要几秒)...' : '正在生成截图...', '📸');
            
            const snapshotRoot = this.getCurrentWechatRoot();
            if (!snapshotRoot) throw new Error('找不到聊天截图根节点');

            // 拿到 Base64 图片数据
            const imageDataUrl = await captureWechatChatSnapshot(snapshotRoot, { longCapture });
            
            // 🔥🔥🔥 核心修复：手机端完美下载机制（将 Base64 转换为真实的二进制文件 Blob）
            const dataURItoBlob = (dataURI) => {
                const byteString = atob(dataURI.split(',')[1]);
                const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
                const ab = new ArrayBuffer(byteString.length);
                const ia = new Uint8Array(ab);
                for (let i = 0; i < byteString.length; i++) {
                    ia[i] = byteString.charCodeAt(i);
                }
                return new Blob([ab], {type: mimeString});
            };

            const blob = dataURItoBlob(imageDataUrl);
            const blobUrl = URL.createObjectURL(blob); // 生成系统级临时文件链接

            const link = document.createElement('a');
            link.href = blobUrl;
            
            const timeStamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
            link.download = `WeChat_${longCapture ? 'Long' : ''}Snapshot_${timeStamp}.png`;
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // 释放内存，防止手机浏览器崩溃
            setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
            
            this.app.phoneShell.showNotification(actionLabel, '截图已触发下载，请查看相册或通知栏', '✅');
        } catch (err) {
            console.error(`[ChatView] ${actionLabel}失败:`, err);
            this.app.phoneShell.showNotification('错误', `${actionLabel}失败，请看控制台`, '❌');
        }
    }

    getCurrentWechatRoot() {
        return document.querySelector('.phone-view-current .wechat-app') || document.querySelector('.wechat-app');
    }

    getCurrentWechatView() {
        return document.querySelector('.phone-view-current') || document;
    }

    bindEvents() {
        const currentView = this.getCurrentWechatView();
        const input = currentView.querySelector('#chat-input');
        const sendBtn = currentView.querySelector('#send-btn');
        const query = (selector) => currentView.querySelector(selector);
        const queryAll = (selector) => currentView.querySelectorAll(selector);

        if (this._isMessageSelectionActiveForCurrentChat()) {
            this._syncSelectedMessageIdsWithData(this.app.currentChat?.id);
            this._syncMessageSelectionBar();
        }

        // 📱 输入框聚焦：用户正在编辑，立即打断自动回复倒计时
        input?.addEventListener('focus', () => {
            clearTimeout(this.batchTimer);
            this.hideTypingStatus();
            this._syncChatSendButton(input);

            if (window.innerWidth <= 500) {
                document.body.classList.add('phone-input-active');

                // 滚动消息到底部
                setTimeout(() => {
                    const messagesDiv = document.getElementById('chat-messages');
                    if (messagesDiv) {
                        messagesDiv.scrollTop = messagesDiv.scrollHeight;
                    }
                }, 300);
            }
        });

        // 📱 输入框失焦：仅在空文本 + 有待回复会话 + 面板关闭时，启动6秒倒计时
        input?.addEventListener('blur', () => {
            const restartPendingTimerIfNeeded = () => {
                const currentInput = document.getElementById('chat-input');
                const trimmedText = String(currentInput?.value || '').trim();
                const canRestart = trimmedText === ''
                    && this._hasPendingChat()
                    && !this.showEmoji
                    && !this.showMore;
                if (!canRestart) return;
                this._restartPendingTimerIfNeeded(this.app.currentChat?.id);
            };

            if (window.innerWidth <= 500) {
                setTimeout(() => {
                    const currentInput = document.getElementById('chat-input');
                    if (document.activeElement !== currentInput) {
                        document.body.classList.remove('phone-input-active');
                        restartPendingTimerIfNeeded();
                        this._syncChatSendButton(currentInput);
                    }
                }, 100);
            } else {
                document.body.classList.remove('phone-input-active');
                restartPendingTimerIfNeeded();
                this._syncChatSendButton(input);
            }
        });

        // 📱 输入中：有字就打断等待；删空时若仍在 focus，保持安静等待 blur 再决定
        input?.addEventListener('input', (e) => {
            this.inputText = e.target.value;
            this._syncChatSendButton(e.target);
            const text = e.target.value.trim();

            if (text !== '') {
                clearTimeout(this.batchTimer);
                this.hideTypingStatus();
                return;
            }

            if (document.activeElement === e.target) {
                // 用户仍在输入框内编辑（包括删空），不立即触发等待倒计时
                return;
            }
        });

        // 发送按钮 - 智能连发 / 中断发送 / 重试
        // 🔥 终极防抖与多端兼容：彻底解决窄屏失效和连击跳过倒计时问题
        let isHandlingSend = false;
        const executeSend = (e) => {
            if (e) e.preventDefault();
            if (isHandlingSend) return;
            isHandlingSend = true;
            const currentInput = query('#chat-input') || input;
            const currentSendBtn = query('#send-btn') || sendBtn;
            const sendMode = String(currentSendBtn?.dataset.mode || '').trim();
            if (String(currentInput?.value || '').trim() === '' && sendMode !== 'send' && sendMode !== 'stop') {
                this.showMore = !this.showMore;
                this.showEmoji = false;
                this.showQuickReplies = false;
                this._setCustomEmojiSelectionMode(false);
                this.app.render();
            } else {
                if (String(currentInput?.value || '').trim() === '' && sendMode === 'send') {
                    this.showMore = false;
                    this.showEmoji = false;
                    this.showQuickReplies = false;
                    this._setCustomEmojiSelectionMode(false);
                }
                this.handleSendClick(currentInput);
            }
            // 300毫秒防抖，防止触屏和鼠标事件同时触发导致跳过6秒等待
            setTimeout(() => { isHandlingSend = false; }, 300);
        };

        sendBtn?.addEventListener('touchstart', (e) => {
            e.preventDefault();  // 阻止 blur，保持键盘弹起
        }, { passive: false });

        sendBtn?.addEventListener('touchend', executeSend);

        sendBtn?.addEventListener('mousedown', (e) => {
            e.preventDefault();  // 阻止 blur
        });

        sendBtn?.addEventListener('click', executeSend);

        // Enter键 - 直接调用 handleSendClick
        input?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendClick(input);
            }
        });

        // 🔥 重新生成按钮
        query('#regenerate-btn')?.addEventListener('click', () => {
            this.regenerateLastAIMessage();
        });

        // 🔥 取消引用按钮
        query('#cancel-quote-btn')?.addEventListener('click', () => {
            this.activeQuote = null;
            this.app.render();
        });

        // 快捷回复按钮
        query('#quick-reply-btn')?.addEventListener('click', () => {
            this.showQuickReplies = !this.showQuickReplies;
            if (this.showEmoji) this._setCustomEmojiSelectionMode(false);
            this.showEmoji = false;
            this.showMore = false;
            this.app.render();
        });

        // 🔥 表情按钮
        query('#emoji-btn')?.addEventListener('click', () => {
            if (this.showEmoji) {
                this._setCustomEmojiSelectionMode(false);
            }
            this.showEmoji = !this.showEmoji;
            this.showMore = false;
            this.showQuickReplies = false;
            this.app.render();
        });

        queryAll('.quick-reply-item').forEach(item => {
            item.addEventListener('click', () => {
                const template = item.dataset.template || '';
                this._insertTextIntoChatInput(template);
            });
        });

        // 选择表情
        queryAll('.emoji-item').forEach(item => {
            item.addEventListener('click', () => {
                const emoji = item.dataset.emoji;
                if (!emoji) return;
                const currentInput = query('#chat-input') || document.getElementById('chat-input');
                const source = String(this.inputText || '');
                const start = currentInput && Number.isInteger(currentInput.selectionStart)
                    ? currentInput.selectionStart
                    : source.length;
                const end = currentInput && Number.isInteger(currentInput.selectionEnd)
                    ? currentInput.selectionEnd
                    : start;
                const insertStart = Math.max(0, Math.min(source.length, start));
                const insertEnd = Math.max(insertStart, Math.min(source.length, end));
                this.inputText = `${source.slice(0, insertStart)}${emoji}${source.slice(insertEnd)}`;
                this._closeEmojiPanelAndRestoreInputCaret(insertStart + String(emoji).length);
            });
        });

        // 更多功能
        queryAll('.more-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.dataset.action;
                this.handleMoreAction(action);
            });
        });

        // 🔥 点击消息区域空白处，收起功能面板和表情面板
        const messagesDiv = query('#chat-messages');
        messagesDiv?.addEventListener('click', (e) => {
            if (this._isMessageSelectionActiveForCurrentChat()) return;
            // 只有点击空白区域才收起（不是点击消息气泡）
            if (this.showMore || this.showEmoji || this.showQuickReplies) {
                if (this.showEmoji) {
                    this._setCustomEmojiSelectionMode(false);
                }
                this.hideImageSourceSheet();
                this.showMore = false;
                this.showEmoji = false;
                this.showQuickReplies = false;
                this.app.render();
            }
        });

        // 🔥 新增：相册上传处理
        const handleImageFile = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            e.target.value = ''; // 清空input，允许重复选择同一文件

            try {
                this.app.phoneShell.showNotification('处理中', '正在上传图片...', '⏳');
                const compressedBase64 = await this.compressChatImage(file);
                await this.sendImageMessageFromDataUrl(compressedBase64, 'phone_chatimg');
            } catch (err) {
                console.error('图片处理失败:', err);
                this.app.phoneShell.showNotification('错误', '图片处理失败', '❌');
            }
        };

        query('#photo-upload-input')?.addEventListener('change', handleImageFile);
        query('#camera-upload-input')?.addEventListener('change', handleImageFile);
        queryAll('.wechat-image-source-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.hideImageSourceSheet();
                const source = String(btn.dataset.source || '');
                if (source === 'camera') this.takePhoto();
                else this.selectPhoto();
            });
        });

        // 🔥 新增：表情标签切换
        queryAll('.emoji-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.emojiTab = tab.dataset.tab;
                if (this.emojiTab !== 'custom') {
                    this._setCustomEmojiSelectionMode(false);
                }
                this.app.render();
            });
        });

        // 🔥 新增：添加自定义表情
        query('#add-custom-emoji')?.addEventListener('click', () => {
            this.showAddCustomEmojiDialog();
        });

        query('#toggle-custom-emoji-manage')?.addEventListener('click', () => {
            this._setCustomEmojiSelectionMode(!this.customEmojiSelectionMode);
            this.app.render();
        });

        query('#select-all-custom-emoji')?.addEventListener('click', () => {
            this._toggleSelectAllCustomEmojis();
            this.app.render();
        });

        query('#delete-selected-custom-emoji')?.addEventListener('click', async () => {
            if (!this.customEmojiSelectionMode) return;
            await this._deleteCustomEmojiSet(Array.from(this.selectedCustomEmojiIds), { clearAll: false });
        });

        query('#clear-custom-emoji-all')?.addEventListener('click', async () => {
            const ids = (this.app.wechatData.getCustomEmojis() || []).map(emoji => String(emoji?.id || '').trim()).filter(Boolean);
            await this._deleteCustomEmojiSet(ids, { clearAll: true });
        });

        // 🔥 新增：选择自定义表情
        queryAll('.custom-emoji-item').forEach(item => {
            let longPressTimer = null;
            let suppressClick = false;
            const clearLongPressTimer = () => {
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            };
            const startManageGesture = () => {
                if (this.customEmojiSelectionMode) return;
                clearLongPressTimer();
                suppressClick = false;
                longPressTimer = setTimeout(() => {
                    const emojiId = item.dataset.emojiId;
                    suppressClick = true;
                    this.manageCustomEmoji(emojiId);
                }, 520);
            };

            item.addEventListener('pointerdown', startManageGesture);
            item.addEventListener('pointerup', clearLongPressTimer);
            item.addEventListener('pointerleave', clearLongPressTimer);
            item.addEventListener('pointercancel', clearLongPressTimer);
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (this.customEmojiSelectionMode) return;
                clearLongPressTimer();
                suppressClick = true;
                this.manageCustomEmoji(item.dataset.emojiId);
            });
            item.addEventListener('click', () => {
                if (suppressClick) {
                    suppressClick = false;
                    return;
                }
                const emojiId = item.dataset.emojiId;
                if (this.customEmojiSelectionMode) {
                    this._toggleCustomEmojiSelection(emojiId);
                    this.app.render();
                    return;
                }
                const emoji = this.app.wechatData.getCustomEmoji(emojiId);
                if (emoji) {
                    const imageUrl = String(emoji.image || '').trim();
                    if (imageUrl) {
                        this.app.wechatData.addMessage(this.app.currentChat.id, {
                            from: 'me',
                            type: 'image',
                            content: imageUrl,
                            customEmojiId: emoji.id,
                            customEmojiName: String(emoji.name || '').trim(),
                            customEmojiDescription: String(emoji.description || emoji.name || '').trim(),
                            avatar: this.app.wechatData.getUserInfo().avatar
                        });

                        this._closeActionPanelsAfterImmediateSend();

                        if (this.isOnlineMode()) {
                            this._enqueuePendingChat(this.app.currentChat.id);
                        }
                        return;
                    }

                    // 兼容旧数据：若图片字段为空，退回文本占位插入
                    const token = `[${emoji.name}]`;
                    const currentInput = query('#chat-input') || document.getElementById('chat-input');
                    const source = String(this.inputText || '');
                    const start = currentInput && Number.isInteger(currentInput.selectionStart)
                        ? currentInput.selectionStart
                        : source.length;
                    const end = currentInput && Number.isInteger(currentInput.selectionEnd)
                        ? currentInput.selectionEnd
                        : start;
                    const insertStart = Math.max(0, Math.min(source.length, start));
                    const insertEnd = Math.max(insertStart, Math.min(source.length, end));
                    this.inputText = `${source.slice(0, insertStart)}${token}${source.slice(insertEnd)}`;
                    this._closeEmojiPanelAndRestoreInputCaret(insertStart + token.length);
                }
            });
        });

        // 🔥 绑定红包/转账气泡点击事件
        this.bindSpecialMessageEvents();
        this.bindInnerThoughtEvents();

        // 添加头像点击事件
        queryAll('.message-avatar').forEach(avatar => {
            avatar.addEventListener('click', (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                const message = e.target.closest('.chat-message');
                if (!message) return;
                const isMe = message.classList.contains('message-right');

                if (!isMe) {
                    this.showAvatarSettings(this.app.currentChat);
                }
            });
        });

        // 滚动到底部（首次加载时）
        this.scrollToBottomIfNeeded(true);

        // 🔧 绑定消息气泡长按/点击事件
        this.bindMessageLongPressEvents();
        this.bindManualTimeMarkerEvents();
        this.bindMessageSelectionEvents();

        // 🔊 语音气泡点击播放逻辑
        const voiceMessagesDiv = document.getElementById('chat-messages');
        if (voiceMessagesDiv && !voiceMessagesDiv._voiceEventBound) {
            voiceMessagesDiv._voiceEventBound = true;
            voiceMessagesDiv.addEventListener('click', async (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                const bubble = e.target.closest('.voice-bubble-playable');
                if (!bubble) return;

                const storage = window.VirtualPhone?.storage;
                const ttsManager = window.VirtualPhone?.ttsManager;

                if (!ttsManager) {
                    this.app.phoneShell.showNotification('提示', 'TTS 管理器未初始化', '⚠️');
                    return;
                }

                const textToSpeak = bubble.dataset.text;
                if (!textToSpeak) return;

                // 如果点击正在播放的音频，则停止
                if (this.currentPlayingMsgId === bubble.id && !this.audioPlayer.paused) {
                    this.audioPlayer.pause();
                    this.audioPlayer.currentTime = 0;
                    bubble.classList.remove('voice-playing');
                    bubble.style.opacity = '1';
                    return;
                }

                // 🔥 核心修改：动态判定发送者音色
                let finalVoice = this._getGlobalTtsVoice(); // 默认拿全局音色兜底（对自己有效）
                let finalProvider = String(storage?.get('phone-tts-provider') || '').trim();
                const msgNode = bubble.closest('.chat-message');
                const isMe = msgNode && msgNode.classList.contains('message-right');

                if (!isMe) {
                    // 如果是对方发来的，必须找对方的专属音色
                    let senderName = this.app.currentChat.name;
                    // 如果是群聊，找具体的发送者名字
                    const senderEl = msgNode.querySelector('.message-sender');
                    if (senderEl) senderName = senderEl.innerText;

                    const { voice, provider } = this._resolveWechatBoundVoiceByName(senderName, { allowGenderFallback: true });
                    if (voice) {
                        finalVoice = voice;
                        finalProvider = provider || finalProvider;
                        this._clearMissingBoundVoiceWarn(senderName, { scene: 'chat' });
                    } else {
                        // 没有绑定音色且兜底音色也未配置时才拦截
                        this._notifyMissingBoundVoiceOnce(senderName, { scene: 'chat' });
                        return; // 中止播放
                    }
                }
                const voice = finalVoice;
                const provider = finalProvider;
                const messageId = String(bubble.id || '').replace(/^voice-bubble-/, '');
                const cacheKey = this._buildWechatTtsCacheKey({
                    messageId,
                    provider,
                    voice,
                    text: textToSpeak
                });

                try {
                    bubble.style.opacity = '0.5'; // 加载中视觉反馈
                    // 停止之前正在播放的气泡动画
                    if (this.currentPlayingMsgId) {
                        const prevBubble = document.getElementById(this.currentPlayingMsgId);
                        if (prevBubble) prevBubble.classList.remove('voice-playing');
                    }
                    let blobUrl = this._wechatTtsCache.get(cacheKey) || '';
                    if (blobUrl) {
                        this._touchWechatTtsCacheKey(cacheKey);
                    } else {
                        blobUrl = await ttsManager.requestTTS(textToSpeak, { provider: provider || undefined, voice: voice || undefined });
                        this._storeWechatTtsCache(cacheKey, blobUrl);
                    }

                    // 播放音频
                    this.audioPlayer.src = blobUrl;
                    this.currentPlayingMsgId = bubble.id;

                    this.audioPlayer.onended = () => {
                        bubble.classList.remove('voice-playing');
                        bubble.style.opacity = '1';
                    };

                    await this.audioPlayer.play();
                    bubble.classList.add('voice-playing');
                    bubble.style.opacity = '1';

                } catch (error) {
                    console.error('TTS Error:', error);
                    bubble.classList.remove('voice-playing');
                    bubble.style.opacity = '1';
                    this.app.phoneShell.showNotification('语音播放失败', error.message, '❌');
                }
            });
        }

        if (this._hasPendingChat(this.app.currentChat?.id)) {
            this._restartPendingTimerIfNeeded(this.app.currentChat?.id);
        } else {
            this.hideTypingStatus();
        }
    }

    // 🔥 抽取为独立方法：绑定消息长按事件（性能优化版：事件委托）
    bindMessageLongPressEvents() {
        const currentView = this.getCurrentWechatView();
        const messagesDiv = currentView?.querySelector('#chat-messages');
        if (!messagesDiv) return;
        const longPressBubbleSelector = '.message-text, .message-voice, .message-image-box, .message-redpacket, .message-transfer, .message-location, .message-call-record, .message-call-text, .message-sticker-box, .message-weibo-card, .message-poker-card, .message-werewolf-card, .message-music-card, .message-music-listen-card';
        const resolveMessageIndexFromElement = (msgElement) => {
            const messages = this.app?.wechatData?.getMessages?.(this.app?.currentChat?.id) || [];
            const domIndex = Number.parseInt(msgElement?.dataset?.messageIndex || '', 10);
            if (Number.isInteger(domIndex) && domIndex >= 0 && domIndex < messages.length) {
                return domIndex;
            }

            const messageId = String(msgElement?.dataset?.messageId || '').trim();
            if (messageId) {
                const indexById = messages.findIndex(msg => String(msg?.id || '').trim() === messageId);
                if (indexById !== -1) return indexById;
            }
            const allMessages = messagesDiv.querySelectorAll('.chat-message');
            return Array.from(allMessages).indexOf(msgElement);
        };

        // 🔥 性能核武器：确保整个聊天列表只绑定 1 次事件
        // 不再随消息数量增多而造成几何级卡顿！
        if (messagesDiv._longPressEventsBound) return;
        messagesDiv._longPressEventsBound = true;

        let pressTimer;
        let touchStartTarget = null;
        let touchStartX = 0;
        let touchStartY = 0;
        let longPressTriggered = false;

        // 📱 移动端长按 (事件委托到父容器)
        messagesDiv.addEventListener('touchstart', (e) => {
            if (this._isMessageSelectionActiveForCurrentChat()) return;
            const targetBubble = e.target.closest(longPressBubbleSelector);
            if (!targetBubble) return;

            const msgElement = e.target.closest('.chat-message');
            if (!msgElement) return;

            touchStartTarget = msgElement;
            longPressTriggered = false;
            const firstTouch = e.touches && e.touches[0] ? e.touches[0] : null;
            touchStartX = firstTouch ? Number(firstTouch.clientX) : 0;
            touchStartY = firstTouch ? Number(firstTouch.clientY) : 0;

            // 🌟 对图片消息阻止默认行为，防止浏览器弹出保存图片菜单
            if (e.target.closest('.message-image')) {
                e.preventDefault();
            }

            pressTimer = setTimeout(() => {
                const index = resolveMessageIndexFromElement(msgElement);
                if (index !== -1) {
                    longPressTriggered = true;
                    if (targetBubble.closest('.message-weibo-card')) {
                        this._suppressWeiboCardClickUntil = Date.now() + 800;
                    }
                    if (targetBubble.closest('.message-poker-card')) {
                        this._suppressPokerCardClickUntil = Date.now() + 800;
                    }
                    if (targetBubble.closest('.message-werewolf-card')) {
                        this._suppressWerewolfCardClickUntil = Date.now() + 800;
                    }
                    this.showMessageMenu(index);
                }
            }, 500);
        }, { passive: false });

        // 📱 滑动或松开时取消长按
        messagesDiv.addEventListener('touchend', (e) => {
            clearTimeout(pressTimer);
            if (longPressTriggered) {
                // 长按已触发时，阻断这次抬手产生的点击回流，避免菜单“闪现即消失”
                e.preventDefault();
                e.stopPropagation();
            }
            touchStartTarget = null;
            longPressTriggered = false;
        }, { passive: false });
        messagesDiv.addEventListener('touchmove', (e) => {
            if (!touchStartTarget) return;
            const currentTouch = e.touches && e.touches[0] ? e.touches[0] : null;
            if (!currentTouch) return;
            const dx = Math.abs(Number(currentTouch.clientX) - touchStartX);
            const dy = Math.abs(Number(currentTouch.clientY) - touchStartY);
            // 允许轻微抖动，避免手指微动就把长按取消
            if (dx > 10 || dy > 10) {
                clearTimeout(pressTimer);
                touchStartTarget = null;
                longPressTriggered = false;
            }
        }, { passive: true });
        messagesDiv.addEventListener('touchcancel', () => {
            clearTimeout(pressTimer);
            touchStartTarget = null;
            longPressTriggered = false;
        }, { passive: true });

        // 💻 桌面端右键
        messagesDiv.addEventListener('contextmenu', (e) => {
            if (this._isMessageSelectionActiveForCurrentChat()) return;
            const targetBubble = e.target.closest(longPressBubbleSelector);
            if (!targetBubble) return;

            const msgElement = e.target.closest('.chat-message');
            if (!msgElement) return;

            e.preventDefault();
            const index = resolveMessageIndexFromElement(msgElement);
            if (index !== -1) this.showMessageMenu(index);
        });

        // 💻 桌面端双击
        messagesDiv.addEventListener('dblclick', (e) => {
            if (this._isMessageSelectionActiveForCurrentChat()) return;
            const targetBubble = e.target.closest(longPressBubbleSelector);
            if (!targetBubble) return;

            const msgElement = e.target.closest('.chat-message');
            if (!msgElement) return;

            const index = resolveMessageIndexFromElement(msgElement);
            if (index !== -1) this.showMessageMenu(index);
        });
    }

    bindManualTimeMarkerEvents() {
        const currentView = this.getCurrentWechatView();
        const messagesDiv = currentView?.querySelector('#chat-messages');
        if (!messagesDiv || messagesDiv._manualTimeMarkerEventsBound) return;
        messagesDiv._manualTimeMarkerEventsBound = true;

        let pressTimer = null;
        let touchStartTarget = null;
        let touchStartX = 0;
        let touchStartY = 0;
        let longPressTriggered = false;

        const clearPress = () => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        };

        const resolveMarkerIndex = (markerEl) => {
            const messages = this.app?.wechatData?.getMessages?.(this.app?.currentChat?.id) || [];
            const messageId = String(markerEl?.dataset?.messageId || '').trim();
            if (messageId) {
                const indexById = messages.findIndex(msg => String(msg?.id || '').trim() === messageId);
                if (indexById !== -1) return indexById;
            }
            const domIndex = Number.parseInt(markerEl?.dataset?.messageIndex || '', 10);
            return Number.isInteger(domIndex) ? domIndex : -1;
        };

        const openMarkerMenu = (markerEl) => {
            const index = resolveMarkerIndex(markerEl);
            if (index < 0) return;
            const messages = this.app?.wechatData?.getMessages?.(this.app?.currentChat?.id) || [];
            const marker = messages[index];
            if (!marker || !(marker?.isTimeMarker === true || marker?.type === 'time_marker')) return;
            this.showManualTimeMarkerMenu(markerEl, index, String(marker?.id || '').trim());
        };

        messagesDiv.addEventListener('touchstart', (e) => {
            if (this._isMessageSelectionActiveForCurrentChat()) return;
            const markerEl = e.target.closest('.wechat-manual-time-marker');
            if (!markerEl) return;

            touchStartTarget = markerEl;
            longPressTriggered = false;
            const firstTouch = e.touches && e.touches[0] ? e.touches[0] : null;
            touchStartX = firstTouch ? Number(firstTouch.clientX) : 0;
            touchStartY = firstTouch ? Number(firstTouch.clientY) : 0;
            clearPress();
            pressTimer = setTimeout(() => {
                longPressTriggered = true;
                openMarkerMenu(markerEl);
            }, 500);
        }, { passive: true });

        messagesDiv.addEventListener('touchmove', (e) => {
            if (!touchStartTarget) return;
            const currentTouch = e.touches && e.touches[0] ? e.touches[0] : null;
            if (!currentTouch) return;
            const dx = Math.abs(Number(currentTouch.clientX) - touchStartX);
            const dy = Math.abs(Number(currentTouch.clientY) - touchStartY);
            if (dx > 10 || dy > 10) {
                clearPress();
                touchStartTarget = null;
                longPressTriggered = false;
            }
        }, { passive: true });

        messagesDiv.addEventListener('touchend', (e) => {
            clearPress();
            if (longPressTriggered) {
                e.preventDefault();
                e.stopPropagation();
            }
            touchStartTarget = null;
            longPressTriggered = false;
        }, { passive: false });

        messagesDiv.addEventListener('touchcancel', () => {
            clearPress();
            touchStartTarget = null;
            longPressTriggered = false;
        }, { passive: true });

        messagesDiv.addEventListener('contextmenu', (e) => {
            const markerEl = e.target.closest('.wechat-manual-time-marker');
            if (!markerEl) return;
            e.preventDefault();
            openMarkerMenu(markerEl);
        });

        messagesDiv.addEventListener('dblclick', (e) => {
            const markerEl = e.target.closest('.wechat-manual-time-marker');
            if (!markerEl) return;
            openMarkerMenu(markerEl);
        });
    }

    showManualTimeMarkerMenu(markerEl, messageIndex, messageId = '') {
        const currentView = this.getCurrentWechatView();
        if (!currentView || !markerEl) return;

        currentView.querySelectorAll('.message-action-menu, .wechat-time-marker-menu').forEach(menu => menu.remove());
        if (typeof this._activeCloseMenu === 'function') {
            document.removeEventListener('click', this._activeCloseMenu);
            document.removeEventListener('touchend', this._activeCloseMenu);
            this._activeCloseMenu = null;
        }
        if (typeof this._activeTimeMarkerCloseMenu === 'function') {
            document.removeEventListener('click', this._activeTimeMarkerCloseMenu);
            document.removeEventListener('touchend', this._activeTimeMarkerCloseMenu);
            this._activeTimeMarkerCloseMenu = null;
        }

        markerEl.style.position = 'relative';
        const menuEl = document.createElement('div');
        menuEl.className = 'wechat-time-marker-menu';
        menuEl.style.cssText = `
            position: absolute;
            left: 50%;
            bottom: 100%;
            transform: translateX(-50%);
            margin-bottom: 4px;
            z-index: 120;
        `;
        menuEl.innerHTML = `
            <div style="display:flex; background:rgba(255,255,255,0.92); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); border-radius:4px; overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,0.12); white-space:nowrap;">
                <button class="wechat-time-marker-delete" type="button" style="background:transparent; color:#ff3b30; border:none; padding:5px 10px; font-size:11px; cursor:pointer;">删除时间推进</button>
            </div>
        `;
        markerEl.appendChild(menuEl);

        const cleanupMenu = () => {
            currentView.querySelectorAll('.wechat-time-marker-menu').forEach(menu => menu.remove());
            if (typeof this._activeTimeMarkerCloseMenu === 'function') {
                document.removeEventListener('click', this._activeTimeMarkerCloseMenu);
                document.removeEventListener('touchend', this._activeTimeMarkerCloseMenu);
                this._activeTimeMarkerCloseMenu = null;
            }
        };

        menuEl.querySelector('.wechat-time-marker-delete')?.addEventListener('click', (e) => {
            e.stopPropagation();
            cleanupMenu();
            this.deleteManualTimeMarker(messageIndex, messageId);
        });

        setTimeout(() => {
            const openedAt = Date.now();
            const closeMenu = (evt) => {
                if (Date.now() - openedAt < 350) return;
                if (menuEl.contains(evt.target)) return;
                cleanupMenu();
            };
            this._activeTimeMarkerCloseMenu = closeMenu;
            document.addEventListener('click', closeMenu);
            document.addEventListener('touchend', closeMenu);
        }, 0);
    }

    // 🔥 发送按钮点击处理（抽取为独立方法，方便复用）
    handleSendClick(input) {
        // 🔥 终极全局防抖：抵抗 DOM 重绘带来的闭合变量失效与幽灵点击中止
        const now = Date.now();
        if (this._lastSendClickTime && now - this._lastSendClickTime < 600) {
            return;
        }
        this._lastSendClickTime = now;

        const targetChatId = String(this.app?.currentChat?.id || '').trim();  // 🔥 快照绑定：防止倒计时期间切换窗口导致串味
        if (!targetChatId) return;
        if (this._isBlockedSingleChat(this.app.currentChat)) {
            this._notifyBlockedChatSend(this.app.currentChat);
            return;
        }

        if (this.isSending && String(this._activeSendingChatId || '') === targetChatId) {
            this.abortSending();
            return;
        }

        const text = input.value.trim();

        if (this._handleManualTimeAdvance(input, text, targetChatId)) {
            return;
        }

        // 🔥 组词保护：打开表情或 + 号面板时，空输入不触发“催更/重试/空提示”逻辑
        // 等用户关闭面板后，再按原有规则检查输入内容
        if (!text && (this.showEmoji || this.showMore)) {
            return;
        }

        if (text) {
            // 🔥 移动端：发送前先阻止页面滚动
            if (window.innerWidth <= 500) {
                document.body.classList.add('phone-input-active');
            }

            // 有文字：发送到屏幕，清空输入框，开始6秒倒计时
            this.app.wechatData.addMessage(this.app.currentChat.id, {
                from: 'me', content: text, type: 'text', avatar: this.app.wechatData.getUserInfo().avatar,
                quote: this.activeQuote  // 🔥 携带引用信息
            });
            input.value = '';
            this.inputText = '';
            this._syncChatSendButton(input);
            this.activeQuote = null;  // 🔥 发送后清空引用

            // 🔥 移除引用预览栏
            const quoteBar = document.querySelector('.active-quote-bar');
            if (quoteBar) quoteBar.remove();

            // 🔥 只更新消息列表，不重新渲染整个界面（防止键盘收回）
            const messagesDiv = this._getVisibleChatMessagesContainer(targetChatId);
            if (messagesDiv) {
                const messages = this.app.wechatData.getMessages(targetChatId);
                const userInfo = this.app.wechatData.getUserInfo();
                this.smartUpdateMessages(messages, userInfo, { chatId: targetChatId });
            }

            const didEnqueue = this._enqueuePendingChat(targetChatId, {
                shouldStartTimer: false,
                shouldShowStatus: false
            });
            if (!didEnqueue) {
                this._notifyOnlineModeRequired();
                return;
            }
            // 🔥 核心修复：发送后若输入框仍保持焦点（移动端连续输入），不进入倒计时
            if (document.activeElement === input) {
                clearTimeout(this.batchTimer);
                this.hideTypingStatus();
            } else {
                // 仅在输入框失焦时进入倒计时
                this._restartPendingTimerIfNeeded(targetChatId);
            }

        } else {
            // 输入框为空
            if (this._hasPendingChat()) {
                if (!this.isOnlineMode()) {
                    this._clearPendingStateForChat(targetChatId);
                    this._notifyOnlineModeRequired();
                    return;
                }

                // 还在6秒倒计时内：立刻触发AI（催更）
                this.triggerAI(targetChatId, { forceCurrentChat: true });
            } else {
                // 倒计时已结束，检查是否有历史消息可以重试
                const messages = this.app.wechatData.getMessages(this.app.currentChat.id);
                if (messages.length > 0) {
                    if (!this.isOnlineMode()) {
                        this._clearPendingStateForChat(targetChatId);
                        this._notifyOnlineModeRequired();
                        return;
                    }

                    // 有历史消息：强制触发重新请求（用于AI回复失败后重试）
                    const didEnqueue = this._enqueuePendingChat(targetChatId, {
                        shouldStartTimer: false,
                        shouldShowStatus: true
                    });
                    if (!didEnqueue) {
                        this._notifyOnlineModeRequired();
                        return;
                    }
                    this.triggerAI(targetChatId, { forceCurrentChat: true });
                } else {
                    // 完全没聊过，输入框又是空的
                    this.app.phoneShell.showNotification('提示', '请先输入内容', '⚠️');
                }
            }
        }
    }

    // 🔥 智能连发：触发AI回复
    async triggerAI(targetChatId = null, options = {}) {
        if (this._isFlushingPending) return;
        this._isFlushingPending = true;
        clearTimeout(this.batchTimer);

        try {
            const preferredChatId = String(targetChatId || this.app.currentChat?.id || '').trim();
            if (!this.isOnlineMode()) {
                if (preferredChatId) {
                    this._clearPendingStateForChat(preferredChatId);
                }
                this._notifyOnlineModeRequired();
                this.hideTypingStatus();  // 🔥 离线模式未发送，清除"等待回复"状态
                return;
            }

            const forceCurrentChat = options?.forceCurrentChat === true && !!preferredChatId;
            const chatIds = this._getPendingChatIdsOrdered(preferredChatId);
            if (chatIds.length === 0) return;

            for (const chatId of chatIds) {
                if (!this.pendingChatIds.has(chatId)) continue;
                const forceThisChat = forceCurrentChat && chatId === preferredChatId;
                if (!forceThisChat && !this._isPendingChatSendable(chatId)) continue;

                const messages = this.app.wechatData.getMessages(chatId);
                const userInfo = this.app.wechatData.getUserInfo?.() || {};
                const userName = String(userInfo?.name || '').trim();
                const isMyMessage = (msg) => {
                    const from = String(msg?.from || '').trim();
                    return from === 'me' || (!!userName && from === userName);
                };
                const isAssistantMessage = (msg) => {
                    if (!msg || isMyMessage(msg)) return false;
                    const from = String(msg?.from || '').trim().toLowerCase();
                    return from !== 'system';
                };

                // 仅提取“上一轮 AI 回复之后”的新用户输入，避免把上一轮用户消息重复送给模型
                let lastAssistantIndex = -1;
                for (let i = messages.length - 1; i >= 0; i--) {
                    if (isAssistantMessage(messages[i])) {
                        lastAssistantIndex = i;
                        break;
                    }
                }

                const pendingUserMessages = messages
                    .slice(lastAssistantIndex + 1)
                    .filter(m => isMyMessage(m));

                const combinedMessage = pendingUserMessages
                    .map(m => String(this._formatMessageContentForPrompt(m, this.app.wechatData.getChatList().find(c => c.id === chatId)) || '').trim())
                    .filter(Boolean)
                    .join('\n')
                    .trim();

                if (!combinedMessage) {
                    this._dequeuePendingChat(chatId);
                    continue;
                }
                const success = await this.sendToAI(combinedMessage, chatId);

                if (success) {
                    this._dequeuePendingChat(chatId);
                    this.syncHeaderStatusDot(chatId);
                } else {
                    break;
                }
            }

            if (this.pendingChatIds.size > 0) {
                this._restartPendingTimerIfNeeded(this.app.currentChat?.id);
            }
        } finally {
            this._isFlushingPending = false;
        }
    }

    async sendToAI(message, targetChatId = null, options = {}) {
        if (!this.isOnlineMode()) {
            return false;
        }

        // 🔥🔥🔥 优先使用传入的 targetChatId，否则使用当前聊天信息
        const savedChatId = targetChatId || this.app.currentChat?.id;
        const targetChat = this.app.wechatData.getChatList().find(c => c.id === savedChatId);
        const savedChatName = targetChat?.name || this.app.currentChat?.name;
        const savedChatAvatar = targetChat?.avatar || this.app.currentChat?.avatar;
        const savedChatType = targetChat?.type || this.app.currentChat?.type;
        
        // 🔥 修复1：在这里定义 isGroupChat 变量！
        const isGroupChat = savedChatType === 'group';

        if (!savedChatId) {
            console.error('❌ 无法获取当前聊天ID');
            return false;
        }
        if (!isGroupChat && this._isBlockedSingleChat(targetChat || this.app.currentChat)) {
            this._dequeuePendingChat(savedChatId);
            this.hideTypingStatus(savedChatId);
            this._notifyBlockedChatSend(targetChat || this.app.currentChat);
            return false;
        }

        let success = false;
        const isProactive = !!options.proactive;
        const responseBatchId = `${isProactive ? 'wechat_proactive' : 'wechat_ai'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this._resetAiReplyTimeCursor();
        this._aiReplyRequestStartedAt = Date.now();

        // 🔥 设置发送状态
        this.isSending = true;
        this._activeSendingChatId = savedChatId;
        this.abortController = new AbortController();

        // 🔥 核心修复：不再全局重绘，避免闪烁与输入焦点丢失
        const isWechatActive = !!document.querySelector('.phone-view-current .wechat-app');
        const isViewingTargetChat = isWechatActive && this.app.currentChat && this.app.currentChat.id === savedChatId;
        if (isViewingTargetChat) {
            // 局部更新发送按钮为“停止”图标
            const sendBtn = document.getElementById('send-btn');
            if (sendBtn) {
                sendBtn.dataset.mode = 'stop';
                sendBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>';
                sendBtn.style.color = '#ff3b30';
            }
        }

        // 🔥 显示正在输入状态
        this.showTypingStatus('正在输入', savedChatId);

        try {
            // 1️⃣ 获取上下文
            const context = window.SillyTavern?.getContext?.();
            if (!context) {
                throw new Error('无法获取酒馆上下文');
            }

            // 2️⃣ 获取完整聊天记录（酒馆历史 + 手机微信记录）
            const chatHistory = [];

            // 酒馆聊天记录
            if (context.chat && Array.isArray(context.chat)) {
                context.chat.forEach(msg => {
                    if (msg.mes && msg.mes.trim()) {
                        const speaker = msg.is_user ? (context.name1 || '用户') : (context.name2 || '角色');
                        let content = msg.mes || msg.content || '';
                        content = applyPhoneTagFilter(content, { storage: this.app?.storage || window.VirtualPhone?.storage });
                        content = content.replace(/<[^>]*>/g, '').replace(/\*.*?\*/g, '').trim().substring(0, 500);

                        if (content.trim()) {
                            chatHistory.push({
                                speaker: speaker,
                                message: content,
                                source: 'tavern'
                            });
                        }
                    }
                });
            }

            // 当前微信聊天记录 - 🔥 使用保存的 chatId
            const wechatMessages = this.app.wechatData.getMessages(savedChatId);
            wechatMessages.forEach(msg => {
                const speaker = msg.from === 'me'
                    ? (context.name1 || '用户')
                    : (context.name2 || savedChatName);

                chatHistory.push({
                    speaker: speaker,
                    message: msg.content || '',
                    source: 'wechat'
                });
            });

            // 🔥 检查是否已中断
            if (this.abortController?.signal.aborted) {
                throw new Error('已中断发送');
            }

            // 3️⃣ 静默发送给AI
            // 直接调用，因为历史记录和系统提示词全在 buildMessagesArray 里处理了
            const aiResponse = await this.sendToAIHidden(message, context, null, this.abortController?.signal, savedChatId, options);

            // 🔥 检查是否已中断
            if (this.abortController?.signal.aborted) {
                throw new Error('已中断发送');
            }

            const sourceTavernChatId = String(options?.sourceTavernChatId || '').trim();
            if (sourceTavernChatId) {
                const currentTavernChatId = this._getCurrentTavernChatId();
                if (currentTavernChatId !== sourceTavernChatId) {
                    console.warn('[微信线上主动触发] 会话已切换，丢弃过期返回结果:', {
                        sourceTavernChatId,
                        currentTavernChatId,
                        targetChatId: savedChatId
                    });
                    return false;
                }
            }

            // 5️⃣ 解析AI回复（支持多窗口路由分发）
            let parsedMessages = []; // 属于当前打开窗口的消息
            let backgroundMessages = {}; // 属于后台其他窗口的消息 { "窗口名": [消息数组] }
            let backgroundGroupHints = {}; // 后台窗口的群聊提示 { "窗口名": true/false }

            let aiRawText = this._extractWechatTagPayloadOrSelf(aiResponse);
            
            let triggerOffline = false;
            const isWechatInteropModeEnabledForOfflineTransfer = () => {
                const storage = window.VirtualPhone?.storage;
                if (!storage) return false;
                const interopKey = this.app?.wechatData?.getOnlineModeStorageKey?.(context) || 'wechat_online_mode';
                const onlineOnlyKey = this.app?.wechatData?.getOnlineOnlyModeStorageKey?.(context) || 'wechat_online_only_mode';
                const isEnabled = (key) => {
                    const val = storage.get(key);
                    return val === true || val === 'true' || val === 1;
                };
                return isEnabled(interopKey) && !isEnabled(onlineOnlyKey);
            };
            const hasOfflineTransferTag = (value = '') => /\[转线下\]/.test(String(value || ''));
            const stripOfflineTransferTag = (value = '') => String(value || '').replace(/\[转线下\]/g, '').trim();
            const messageHasOfflineTransferTag = (message) => hasOfflineTransferTag(message?.content) || hasOfflineTransferTag(message?.specialMessage?.content);
            const stripOfflineTransferTagFromMessage = (message) => {
                if (!message) return message;
                const next = { ...message };
                if (typeof next.content === 'string') {
                    next.content = stripOfflineTransferTag(next.content);
                }
                if (next.specialMessage && typeof next.specialMessage.content === 'string') {
                    next.specialMessage = {
                        ...next.specialMessage,
                        content: stripOfflineTransferTag(next.specialMessage.content)
                    };
                }
                return next;
            };

            // 兼容联系人分隔符：---张三--- / ——张三—— / －－张三－－ 等
            aiRawText = aiRawText.replace(
                /^\s*(?:-{3,}|—{2,}|－{2,}|─{2,}|━{2,}|_{3,})\s*(.+?)\s*(?:-{3,}|—{2,}|－{2,}|─{2,}|━{2,}|_{3,})\s*$/gm,
                '---$1---'
            );

            const normalizeWechatWindowName = (name) => String(name || '')
                .trim()
                .replace(/\s+/g, '')
                .toLowerCase();
            const stripWechatSenderTimePrefix = (name) => String(name || '')
                .trim()
                .replace(/^(?:\[\s*[^\]\r\n]+?\s*\]|【\s*[^】\r\n]+?\s*】)\s*/, '')
                .trim();
            const normalizeWechatSingleName = (name) => normalizeWechatWindowName(name)
                .replace(/[（(][^（）()]*[）)]/g, '');
            const isSameWechatWindowName = (a, b) => {
                const left = normalizeWechatWindowName(a);
                const right = normalizeWechatWindowName(b);
                return !!left && !!right && left === right;
            };
            const isSameWechatSingleName = (a, b) => {
                const left = normalizeWechatSingleName(a);
                const right = normalizeWechatSingleName(b);
                return !!left && !!right && left === right;
            };
            const singleChatAliases = isGroupChat ? [] : this._collectSingleChatAliasesForFilter(targetChat || this.app.currentChat, context);
            const isAllowedSingleChatSender = (sender, expectedSender) => {
                const rawSender = stripWechatSenderTimePrefix(sender);
                const expected = String(expectedSender || '').trim();
                if (!rawSender) return true;
                const allowedNames = [expected, ...singleChatAliases]
                    .map(item => String(item || '').trim())
                    .filter(Boolean);
                return allowedNames.some(name => isSameWechatSingleName(rawSender, name));
            };
            const getAllowedSingleChatCommonGroup = (name) => {
                if (isGroupChat) return null;
                const targetKey = normalizeWechatWindowName(name);
                if (!targetKey) return null;
                const allChats = this.app.wechatData.getChatList();
                const currentSingleName = String(savedChatName || context.name2 || '').trim();
                const currentSingleKey = normalizeWechatSingleName(currentSingleName);
                return allChats.find((chat) => {
                    if (chat?.type !== 'group' || normalizeWechatWindowName(chat.name) !== targetKey) return false;
                    const members = this._collectGroupParticipantsForFilter(chat, context);
                    return members.some(member => normalizeWechatSingleName(member) === currentSingleKey);
                }) || null;
            };
            const filterSingleChatCommonGroupReplies = (messages = []) => {
                const expectedSender = String(savedChatName || context.name2 || '').trim();
                if (!expectedSender) return [];
                return (messages || [])
                    .map((message) => {
                        const rawSender = String(message?.sender || '').trim();
                        const content = String(message?.content || message?.specialMessage?.content || '').trim();
                        if (!content && !message?.specialMessage) return null;
                        if (!isAllowedSingleChatSender(rawSender, expectedSender)) {
                            console.warn('⚠️ [微信单聊] 已丢弃共同群聊里的非当前好友发言:', {
                                currentChat: expectedSender,
                                sender: rawSender,
                                aliases: singleChatAliases
                            });
                            return null;
                        }
                        return { ...message, sender: expectedSender, content };
                    })
                    .filter(Boolean);
            };
            const normalizeInlineSingleReply = (message) => {
                if (!message || isGroupChat) return message;
                const expectedSender = String(savedChatName || context.name2 || '').trim();
                if (!expectedSender) return message;

                const next = { ...message, sender: expectedSender };
                next.content = String(next.content || '').trim();
                return next;
            };
            const filterInlineSingleReply = (message) => {
                if (!message || isGroupChat) return message;
                const expectedSender = String(savedChatName || context.name2 || '').trim();
                const rawSender = stripWechatSenderTimePrefix(message.sender);
                const content = String(message.content || message.specialMessage?.content || '').trim();
                if (!content && !message.specialMessage) return null;
                if (!expectedSender) return { ...message, content };
                if (!isAllowedSingleChatSender(rawSender, expectedSender)) {
                    console.warn('⚠️ [微信单聊] 已丢弃非当前好友发言:', {
                        currentChat: expectedSender,
                        sender: rawSender,
                        aliases: singleChatAliases
                    });
                    return null;
                }
                return { ...message, sender: expectedSender, content };
            };
            const currentGroupChat = targetChat || this.app.currentChat || { id: savedChatId, name: savedChatName, type: 'group' };
            const currentGroupParticipants = isGroupChat
                ? this._collectGroupParticipantsForFilter(currentGroupChat, context)
                : [];
            const keepLobbyGroupRepliesOnMismatch = isGroupChat && this._buildLobbySelection(context)?.isLobby;

            // 如果AI使用了跨聊天多开标签 <wechat> 或包含了 --- 分隔符
            if (aiRawText.includes('---')) {
                aiRawText = aiRawText.trim();
                const blocks = aiRawText.split(/(?=---.+---)/); // 按分隔符拆分块

                blocks.forEach(block => {
                    const headerMatch = block.match(/^---(.+?)---/);
                    if (headerMatch) {
                        const targetName = headerMatch[1].trim();
                        const isTargetCurrentChat = isSameWechatWindowName(targetName, savedChatName);
                        let blockContent = block.replace(/^---.+---/, '').trim();
                        const blockDeclaredGroup = /(^|\n)\s*type[：:]\s*group\s*(?=\n|$)/i.test(blockContent);
                        blockContent = blockContent.replace(/^type[：:]\s*\S+\s*$/gmi, '');
                        blockContent = blockContent.replace(/^date[：:]\s*.+$/gmi, '');
                        const weiboTokenResult = this._extractWeiboNewsTokens(blockContent);
                        blockContent = weiboTokenResult.text;

                        const lines = blockContent.split('\n').map(l => l.trim()).filter(l => l);
                        const extractedMsgs = [];
                        let pendingSender = '';
                        let deferredQuote = null; // { sender: string, quote: {sender, content} }
                        const consumeDeferredQuote = (sender, quote) => {
                            if (quote || !deferredQuote) return quote;
                            const senderName = String(sender || '').trim();
                            const targetSender = String(deferredQuote.sender || '').trim();
                            const matched = !targetSender || senderName === targetSender;
                            const nextQuote = matched ? deferredQuote.quote : null;
                            deferredQuote = null; // 仅作用于下一条有效消息
                            return nextQuote || quote;
                        };

                        lines.forEach(line => {
                            if (this._isStandaloneWechatTimeLine(line)) {
                                pendingSender = '';
                                return;
                            }
                            line = this._stripLeadingWechatTimePrefix(line);
                            if (!line) return;
                            const senderOnlyMatch = /^([^:：]+)[：:]\s*$/.exec(line);
                            if (senderOnlyMatch) {
                                pendingSender = senderOnlyMatch[1].trim();
                                return;
                            }

                            const weiboSpecial = weiboTokenResult.tokenMap.get(line);
                            if (weiboSpecial) {
                                extractedMsgs.push({
                                    sender: pendingSender || (isTargetCurrentChat ? (context.name2 || targetName) : targetName),
                                    content: weiboSpecial.content || '[微博分享]',
                                    specialMessage: weiboSpecial
                                });
                                pendingSender = '';
                                return;
                            }

                            const quoteResult = this._extractLeadingQuote(line);
                            let quote = quoteResult.quote;
                            line = quoteResult.rest;
                            if (quote && !line) {
                                deferredQuote = { sender: '', quote };
                                pendingSender = '';
                                return;
                            }

                            const timedLine = this._parseTimedWechatSenderLine(line);
                            if (timedLine) {
                                quote = consumeDeferredQuote(timedLine.sender, quote);
                                extractedMsgs.push({ time: timedLine.time, sender: timedLine.sender, content: timedLine.content, quote });
                                pendingSender = '';
                                return;
                            }

                            // 🔥 格式2: 发送者: 「引用 xxx: 内容」回复 （引用在消息内容中）
                            const innerQuoteMatch = line.match(/^([^\[\]【】\r\n:：]{1,20})[:：]\s*(.+)$/);
                            if (innerQuoteMatch) {
                                const sender = innerQuoteMatch[1].trim();
                                const contentWithMaybeQuote = innerQuoteMatch[2].trim();
                                const innerQuoteResult = this._extractLeadingQuote(contentWithMaybeQuote);
                                if (innerQuoteResult.quote) quote = innerQuoteResult.quote;
                                const content = innerQuoteResult.rest;
                                if (quote && !content) {
                                    deferredQuote = { sender, quote };
                                    pendingSender = '';
                                    return;
                                }
                                quote = consumeDeferredQuote(sender, quote);
                                extractedMsgs.push({ sender, content, quote });
                                return; // 已处理，跳过后续匹配
                            }

                            const simpleMsgMatch = /^([^:：]+)[：:]\s*(.+)$/.exec(line);

                            if (simpleMsgMatch && simpleMsgMatch[1].length < 20) {
                                quote = consumeDeferredQuote(simpleMsgMatch[1].trim(), quote);
                                extractedMsgs.push({ sender: simpleMsgMatch[1].trim(), content: simpleMsgMatch[2].trim(), quote });
                            } else if (line) {
                                const fallbackSender = isTargetCurrentChat ? (context.name2 || targetName) : targetName;
                                quote = consumeDeferredQuote(fallbackSender, quote);
                                extractedMsgs.push({ sender: isTargetCurrentChat ? (context.name2 || targetName) : targetName, content: line, quote });
                            }
                            pendingSender = '';
                        });

                        // 分流：是当前窗口，还是后台窗口？
                        // 仅允许归一化后精确匹配，避免“群名包含好友名”导致串窗
                        const isCurrentChat = isTargetCurrentChat;
                        if (isCurrentChat) {
                            parsedMessages.push(...extractedMsgs);
                        } else {
                            if (!isGroupChat && !isProactive) {
                                const allowedCommonGroup = getAllowedSingleChatCommonGroup(targetName);
                                if (!allowedCommonGroup) {
                                    console.warn('⚠️ [微信单聊] 已丢弃非当前窗口输出:', {
                                        currentChat: savedChatName,
                                        targetName
                                    });
                                    return;
                                }
                                const groupMsgs = filterSingleChatCommonGroupReplies(extractedMsgs);
                                if (groupMsgs.length === 0) {
                                    console.warn('⚠️ [微信单聊] 共同群聊输出无有效当前好友发言，已跳过:', {
                                        currentChat: savedChatName,
                                        targetName
                                    });
                                    return;
                                }
                                if (!backgroundMessages[allowedCommonGroup.name]) backgroundMessages[allowedCommonGroup.name] = [];
                                backgroundMessages[allowedCommonGroup.name].push(...groupMsgs);
                                backgroundGroupHints[allowedCommonGroup.name] = true;
                                console.log('✅ [微信单聊] 已转发当前好友消息到共同群聊:', {
                                    currentChat: savedChatName,
                                    groupName: allowedCommonGroup.name,
                                    count: groupMsgs.length
                                });
                                return;
                            }
                            if (!backgroundMessages[targetName]) backgroundMessages[targetName] = [];
                            backgroundMessages[targetName].push(...extractedMsgs);
                            if (blockDeclaredGroup) {
                                backgroundGroupHints[targetName] = true;
                            } else if (backgroundGroupHints[targetName] === undefined) {
                                backgroundGroupHints[targetName] = false;
                            }
                        }
                    }
                });
            }

            // 修复：只有当既没有解析到当前窗口消息，也没有解析到任何后台消息时，才触发纯文本兜底
            // 防止 AI 只回复了后台好友时，后台消息被错误地当作纯文本塞进当前聊天窗口
            if (parsedMessages.length === 0 && Object.keys(backgroundMessages).length === 0) {
                // 兜底：提取纯文本作为当前窗口消息
                let fallbackText = this._stripWechatCommentWrapper(aiRawText).trim();
                if (!fallbackText) fallbackText = this._stripWechatCommentWrapper(aiRawText.split('---')[0]).trim();

                if (fallbackText) {
                    // 走原有的基础清理逻辑
                    fallbackText = fallbackText.replace(/^from[：:]\s*\S+\s*$/gmi, '');
                    fallbackText = fallbackText.replace(/^\[[0-9A-Za-z:：]+\]\s*/gm, '');
                    const weiboTokenResult = this._extractWeiboNewsTokens(fallbackText);
                    fallbackText = weiboTokenResult.text;
                    const lines = fallbackText.split('\n').map(l => l.trim()).filter(l => l);

                    const isGroupChat = this.app.currentChat?.type === 'group';
                    let pendingSender = '';
                    let deferredQuote = null; // { sender: string, quote: {sender, content} }
                    const consumeDeferredQuote = (sender, quote) => {
                        if (quote || !deferredQuote) return quote;
                        const senderName = String(sender || '').trim();
                        const targetSender = String(deferredQuote.sender || '').trim();
                        const matched = !targetSender || senderName === targetSender;
                        const nextQuote = matched ? deferredQuote.quote : null;
                        deferredQuote = null; // 仅作用于下一条有效消息
                        return nextQuote || quote;
                    };

                    lines.forEach(line => {
                        if (this._isStandaloneWechatTimeLine(line)) {
                            pendingSender = '';
                            return;
                        }
                        line = this._stripLeadingWechatTimePrefix(line);
                        if (!line) return;
                        const senderOnlyMatch = /^([^:：]+)[：:]\s*$/.exec(line);
                        if (senderOnlyMatch) {
                            pendingSender = senderOnlyMatch[1].trim();
                            return;
                        }

                        const weiboSpecial = weiboTokenResult.tokenMap.get(line);
                        if (weiboSpecial) {
                            parsedMessages.push({
                                sender: pendingSender || (context.name2 || savedChatName),
                                content: weiboSpecial.content || '[微博分享]',
                                specialMessage: weiboSpecial
                            });
                            pendingSender = '';
                            return;
                        }

                        const quoteResult = this._extractLeadingQuote(line);
                        let quote = quoteResult.quote;
                        line = quoteResult.rest;
                        if (quote && !line) {
                            deferredQuote = { sender: '', quote };
                            pendingSender = '';
                            return;
                        }

                        const timedLine = this._parseTimedWechatSenderLine(line);
                        if (timedLine) {
                            quote = consumeDeferredQuote(timedLine.sender, quote);
                            parsedMessages.push({ time: timedLine.time, sender: timedLine.sender, content: timedLine.content, quote });
                            pendingSender = '';
                            return;
                        }

                        // 🔥 格式2: 发送者: 「引用 xxx: 内容」回复 （引用在消息内容中）
                        const innerQuoteMatch = line.match(/^([^\[\]【】\r\n:：]{1,20})[:：]\s*(.+)$/);
                        if (innerQuoteMatch) {
                            const sender = innerQuoteMatch[1].trim();
                            const contentWithMaybeQuote = innerQuoteMatch[2].trim();
                            const innerQuoteResult = this._extractLeadingQuote(contentWithMaybeQuote);
                            if (innerQuoteResult.quote) quote = innerQuoteResult.quote;
                            const content = innerQuoteResult.rest;
                            if (quote && !content) {
                                deferredQuote = { sender, quote };
                                pendingSender = '';
                                return;
                            }
                            quote = consumeDeferredQuote(sender, quote);
                            parsedMessages.push({ sender, content, quote });
                            return; // 已处理，跳过后续匹配
                        }

                        const simpleMsgMatch = /^([^:：]+)[：:]\s*(.+)$/.exec(line);

                        if (simpleMsgMatch && simpleMsgMatch[1].length < 20) {
                            quote = consumeDeferredQuote(simpleMsgMatch[1].trim(), quote);
                            parsedMessages.push({ sender: simpleMsgMatch[1].trim(), content: simpleMsgMatch[2].trim(), quote });
                        } else if (line) {
                            const fallbackSender = context.name2 || savedChatName;
                            quote = consumeDeferredQuote(fallbackSender, quote);
                            parsedMessages.push({ sender: context.name2 || savedChatName, content: line, quote });
                        }
                        pendingSender = '';
                    });
                }
            }

            // 🔥 统一拆分：支持“文本里夹着 [转账]/[红包] 标签”并转成独立气泡
            const expandMixedSpecialList = (list) => {
                const out = [];
                (list || []).forEach(item => {
                    out.push(...this.splitMixedSpecialMessage(item));
                });
                return out;
            };
            parsedMessages = expandMixedSpecialList(parsedMessages);
            Object.keys(backgroundMessages).forEach(chatName => {
                backgroundMessages[chatName] = expandMixedSpecialList(backgroundMessages[chatName]);
            });
            if (!isGroupChat && !isProactive) {
                parsedMessages = parsedMessages
                    .map(filterInlineSingleReply)
                    .filter(Boolean)
                    .map(normalizeInlineSingleReply);
                triggerOffline = isWechatInteropModeEnabledForOfflineTransfer() && parsedMessages.some(messageHasOfflineTransferTag);
            } else {
                parsedMessages = this._filterGroupMessagesByParticipants(parsedMessages, currentGroupParticipants, savedChatName, {
                    keepAllWhenAllDropped: keepLobbyGroupRepliesOnMismatch
                });
            }
            parsedMessages = parsedMessages
                .map(stripOfflineTransferTagFromMessage)
                .filter(item => String(item?.content || item?.specialMessage?.content || '').trim() || item?.specialMessage);
            Object.keys(backgroundMessages).forEach(chatName => {
                backgroundMessages[chatName] = (backgroundMessages[chatName] || [])
                    .map(stripOfflineTransferTagFromMessage)
                    .filter(item => String(item?.content || item?.specialMessage?.content || '').trim() || item?.specialMessage);
            });

            // 处理后台窗口消息 (静默存入，红点提示)
            for (const [targetName, rawMsgs] of Object.entries(backgroundMessages)) {
                let msgs = Array.isArray(rawMsgs) ? rawMsgs : [];
                if (msgs.length === 0) continue;

                const allChats = this.app.wechatData.getChatList();
                const sameNameChats = allChats.filter(c =>
                    c.type === 'group'
                        ? isSameWechatWindowName(c.name, targetName)
                        : isSameWechatSingleName(c.name, targetName)
                );
                const currentUserName = context?.name1 || this.app.wechatData.getUserInfo()?.name || '用户';
                const userSenderKeys = new Set(['me', '我', '用户', normalizeWechatWindowName(currentUserName)]);
                const senderNames = [...new Set(msgs.map(m => String(m?.sender || '').trim()).filter(Boolean))];
                const senderKeys = senderNames.map(name => normalizeWechatWindowName(name)).filter(Boolean);
                const groupMemberCandidates = senderNames.filter(name => !userSenderKeys.has(normalizeWechatWindowName(name)));
                const explicitGroupHint = backgroundGroupHints[targetName] === true;
                const inferredGroupBySenders = [...new Set(senderKeys.filter(key => !userSenderKeys.has(key)))].length > 1;

                let bgChat = null;
                if (sameNameChats.length > 0) {
                    const exactGroupChat = sameNameChats.find(c => c.type === 'group');
                    const exactSingleChat = sameNameChats.find(c => c.type !== 'group');
                    if (exactGroupChat && exactSingleChat) {
                        bgChat = (explicitGroupHint || inferredGroupBySenders) ? exactGroupChat : exactSingleChat;
                    } else {
                        bgChat = exactGroupChat || exactSingleChat || null;
                    }
                }

                if (!bgChat) {
                    if (explicitGroupHint || inferredGroupBySenders) {
                        // 🔥 群聊：查找同名群，没有才创建
                        bgChat = allChats.find(c => c.type === 'group' && isSameWechatWindowName(c.name, targetName));
                        if (!bgChat) {
                            bgChat = this.app.wechatData.createChat({
                                id: `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                name: targetName,
                                type: 'group',
                                avatar: '👥',
                                members: groupMemberCandidates
                            });
                        }
                    } else {
                        // 🔥 单聊：先查找联系人（严格名称归一匹配）
                        const contacts = this.app.wechatData.getContacts();
                        const existingContact = contacts.find(c => isSameWechatSingleName(c.name, targetName));

                        if (existingContact) {
                            // 联系人存在，查找或创建聊天窗口
                            bgChat = this.app.wechatData.getChatByContactId(existingContact.id);
                            if (!bgChat) {
                                bgChat = allChats.find(c => c.type !== 'group' && isSameWechatSingleName(c.name, targetName));
                            }
                            if (!bgChat) {
                                bgChat = this.app.wechatData.createChat({
                                    id: `chat_${existingContact.id}`,
                                    contactId: existingContact.id,
                                    name: existingContact.name,
                                    type: 'single',
                                    avatar: existingContact.avatar || '👤'
                                });
                            }
                        } else {
                            // 🔥 也尝试通过名字直接查找聊天（严格名称归一匹配）
                            bgChat = allChats.find(c => c.type !== 'group' && isSameWechatSingleName(c.name, targetName));

                            if (!bgChat) {
                                // 联系人不存在，先添加联系人再创建聊天
                                const newContactId = `contact_${Date.now()}`;
                                const newContact = this.app.wechatData.addContact({
                                    id: newContactId,
                                    name: targetName,
                                    avatar: '👤',
                                    letter: this.app.wechatData.getFirstLetter(targetName)
                                }) || { id: newContactId, name: targetName, avatar: '👤' };

                                bgChat = this.app.wechatData.createChat({
                                    id: `chat_${newContact.id || newContactId}`,
                                    contactId: newContact.id || newContactId,
                                    name: newContact.name || targetName,
                                    type: 'single',
                                    avatar: newContact.avatar || '👤'
                                });
                            }
                        }
                    }
                }

                let bgAddedCount = 0;
                let bgLatestPreview = '';
                const isBgGroupChat = bgChat?.type === 'group';
                let bgGroupParticipants = [];
                if (isBgGroupChat) {
                    bgGroupParticipants = this._collectGroupParticipantsForFilter(bgChat, context);
                    const beforeCount = msgs.length;
                    const isLobbyBgGroup = this._buildLobbySelection(context)?.isLobby;
                    msgs = this._filterGroupMessagesByParticipants(msgs, bgGroupParticipants, targetName, {
                        keepAllWhenAllDropped: isLobbyBgGroup
                    });
                    if (msgs.length === 0) {
                        console.warn('⚠️ [微信] 后台群聊消息全部来自非群成员，已跳过:', { group: targetName, beforeCount });
                        continue;
                    }
                }
                let senderAvatar = bgChat.avatar || '👤';
                const bgShortGapMap = this._buildShortWechatReplyGapMap(msgs);
                for (let bgIndex = 0; bgIndex < msgs.length; bgIndex++) {
                    const m = msgs[bgIndex];
                    const cleanContent = this.cleanAbnormalSpaces(m.content);
                    const normalizedTextContent = this._stripCallSpeechPrefix(cleanContent, { preserveVoiceTag: true });
                    const special = m.specialMessage || this.parseSpecialMessage(cleanContent);
                    // 🔥 核心修复2：如果是群聊，绝不能拿群聊头像(bgChat.avatar)给个人用
                    senderAvatar = this.app.wechatData.getContactByName(m.sender)?.avatar || (isBgGroupChat ? '' : bgChat.avatar) || '👤';
                    if (special?.type === 'incoming_call') {
                        const { queuedLines, consumedCount } = this._collectIncomingCallFollowUps(msgs, bgIndex);
                        bgIndex += consumedCount;
                        window.VirtualPhone?.triggerWechatIncomingCall?.(
                            bgChat.id,
                            targetName || m.sender || '对方',
                            special.callType || 'voice',
                            queuedLines
                        );
                        continue;
                    }

                    this._applyAiReplyTimeline(m, normalizedTextContent, {
                        isFirstInReplyBatch: bgIndex === 0,
                        extraGapMinutes: bgShortGapMap.get(bgIndex) || 0,
                        realTimeMode: isProactive,
                        baseTimestamp: options?.proactiveMeta?.now || Date.now()
                    });

                    const specialSender = String(special?.sender || '').trim();
                    const senderNameForCatbox = specialSender || m.sender;
                    const senderAvatarForCatbox = senderAvatar;
                    let msgData = special
                        ? { from: specialSender || m.sender, ...special, time: m.time, avatar: senderAvatar, replyBatchId: responseBatchId }
                        : { from: m.sender, content: normalizedTextContent, type: 'text', time: m.time, quote: m.quote, avatar: senderAvatar, replyBatchId: responseBatchId };
                    if (special?.type === 'catbox_item_use') {
                        msgData = this._buildCatboxCareCardMessage(bgChat.id, special, senderNameForCatbox, senderAvatarForCatbox, m.time, responseBatchId);
                    }
                    if (special?.type === 'payment_action') {
                        this._applyWechatPaymentAction(bgChat.id, special, m.sender);
                        continue;
                    }
                    if (special?.type === 'catbox_coadopt_response') {
                        this._handleCatboxCoAdoptResponse(bgChat.id, special, senderNameForCatbox);
                        this.app.wechatData.saveData?.();
                        continue;
                    }
                    if (special?.type === 'redpacket') msgData.id = `rp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                    const candidatePreview = String((special?.content || normalizedTextContent || '')).replace(/\s+/g, ' ').trim();
                    if (candidatePreview) {
                        bgLatestPreview = candidatePreview.length > 34 ? `${candidatePreview.slice(0, 34)}...` : candidatePreview;
                    }
                    const bgAdded = this.app.wechatData.addMessage(bgChat.id, msgData);
                    if (!bgAdded) {
                        continue;
                    }
                    if (special?.type === 'honey_invite') {
                        const latestMessages = this.app.wechatData.getMessages(bgChat.id) || [];
                        const latestMsg = latestMessages[latestMessages.length - 1] || {};
                        this._handleHoneyInviteResponse(
                            { ...special, messageId: latestMsg.id || special.messageId || '' },
                            { senderName: targetName || m.sender, chatId: bgChat.id }
                        );
                    }
                    bgAddedCount++;
                    if (special?.type === 'weibo_card' && special.weiboData) {
                        this.syncWeiboNewsToWeiboApp(special.weiboData, m.sender);
                    }
                }

                if (bgAddedCount > 0) {
                    bgChat.unread = (bgChat.unread || 0) + bgAddedCount;
                    this.app.wechatData.saveData();
                    if (window.VirtualPhone?.notify) {
                        let finalNotifyAvatar = bgChat.avatar || '';
                        if (!this.app._isCustomAvatarValue(finalNotifyAvatar)) {
                            finalNotifyAvatar = this.app.wechatData.getContactAutoAvatar(targetName) || finalNotifyAvatar;
                        }
                        window.VirtualPhone.notify('新微信消息', bgLatestPreview || `${targetName} 给你发了新消息`, '', {
                            avatar: finalNotifyAvatar,
                            name: targetName || '微信',
                            content: bgLatestPreview || '发来新消息',
                            timeText: '刚刚',
                            senderKey: `wechat:bg:${bgChat.id}:${Date.now()}`
                        });
                        window.VirtualPhone.playWechatMessageSound?.({ source: 'online_background' });
                    } else {
                        this.app.phoneShell?.showNotification('新微信消息', `${targetName} 给你发了新消息`, '💬');
                        window.VirtualPhone?.playWechatMessageSound?.({ source: 'online_background' });
                    }
                }
            }

            // 6️⃣ 将AI回复添加到微信界面（使用动态打字延迟）
            const inlineShortGapMap = this._buildShortWechatReplyGapMap(parsedMessages);
            for (let msgIndex = 0; msgIndex < parsedMessages.length; msgIndex++) {
                const msg = parsedMessages[msgIndex];
                if (this.abortController?.signal.aborted) {
                    throw new Error('已中断发送');
                }

                // 检查等待前用户是否还停留在这个聊天界面（必须微信前台可见）
                const isViewingThisChat = !!document.querySelector('.phone-view-current .wechat-app') &&
                    this.app.currentChat && this.app.currentChat.id === savedChatId;

                const baseDelay = 800;
                const typingDelay = String(msg.content || '').length * 50;
                const totalDelay = baseDelay + typingDelay;

                if (isViewingThisChat) {
                    this.showTypingStatus('正在输入');
                }

                // 等待打字延迟
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(resolve, totalDelay);
                    if (this.abortController) {
                        this.abortController.signal.addEventListener('abort', () => {
                            clearTimeout(timer);
                            reject(new Error('已中断发送'));
                        });
                    }
                });

                // 存入数据库
                const senderContact = this.app.wechatData.getContactByName(msg.sender);
                const cleanContent = this.cleanAbnormalSpaces(msg.content);
                const normalizedTextContent = this._stripCallSpeechPrefix(cleanContent, { preserveVoiceTag: true });
                const special = msg.specialMessage || this.parseSpecialMessage(cleanContent);
                if (special?.type === 'incoming_call') {
                    const { queuedLines, consumedCount } = this._collectIncomingCallFollowUps(parsedMessages, msgIndex);
                    msgIndex += consumedCount;

                    const isStillViewing = !!document.querySelector('.phone-view-current .wechat-app') &&
                        this.app.currentChat && this.app.currentChat.id === savedChatId;

                    if (isStillViewing) {
                        const callContact = this.app.currentChat || targetChat || {
                            name: savedChatName || msg.sender || '对方',
                            avatar: savedChatAvatar || '👤'
                        };
                        // 来电界面不阻塞主发送流程，避免“发送中卡死”体验
                        if ((special.callType || 'voice') === 'video') {
                            this.showIncomingVideoCall(callContact, queuedLines);
                        } else {
                            this.showIncomingVoiceCall(callContact, queuedLines);
                        }
                    } else {
                        // 后台也强制全局弹窗（不再直接记未接）
                        window.VirtualPhone?.triggerWechatIncomingCall?.(
                            savedChatId,
                            savedChatName || msg.sender || '对方',
                            special.callType || 'voice',
                            queuedLines
                        );
                    }
                    continue;
                }

                this._applyAiReplyTimeline(msg, normalizedTextContent, {
                    isFirstInReplyBatch: msgIndex === 0,
                    extraGapMinutes: inlineShortGapMap.get(msgIndex) || 0,
                    realTimeMode: isProactive,
                    baseTimestamp: options?.proactiveMeta?.now || Date.now()
                });

                const specialSender = String(special?.sender || '').trim();
                const senderNameForCatbox = specialSender || msg.sender;
                const senderAvatarForCatbox = senderContact?.avatar || (isGroupChat ? '' : savedChatAvatar) || '👤';
                let msgData = special
                    // 🔥 核心修复3：如果是群聊，禁止 fallback 到 savedChatAvatar
                    ? { from: specialSender || msg.sender, ...special, time: msg.time, avatar: senderAvatarForCatbox, replyBatchId: responseBatchId }
                    : { from: msg.sender, content: normalizedTextContent, time: msg.time, type: 'text', avatar: senderAvatarForCatbox, quote: msg.quote, replyBatchId: responseBatchId };
                if (special?.type === 'catbox_item_use') {
                    msgData = this._buildCatboxCareCardMessage(savedChatId, special, senderNameForCatbox, senderAvatarForCatbox, msg.time, responseBatchId);
                }
                if (special?.type === 'payment_action') {
                    this._applyWechatPaymentAction(savedChatId, special, msg.sender);
                    if (isViewingThisChat) {
                        this.hideTypingStatus();
                        this._refreshVisibleChatMessages(savedChatId);
                    }
                    continue;
                }
                if (special?.type === 'catbox_coadopt_response') {
                    this._handleCatboxCoAdoptResponse(savedChatId, special, senderNameForCatbox);
                    if (isViewingThisChat) {
                        this.hideTypingStatus();
                        this._refreshVisibleChatMessages(savedChatId);
                    }
                    continue;
                }
                if (special?.type === 'redpacket') msgData.id = `rp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                const added = this.app.wechatData.addMessage(savedChatId, msgData);
                if (!added) {
                    continue;
                }
                if (special?.type === 'honey_invite') {
                    const latestMessages = this.app.wechatData.getMessages(savedChatId) || [];
                    const latestMsg = latestMessages[latestMessages.length - 1] || {};
                    this._handleHoneyInviteResponse(
                        { ...special, messageId: latestMsg.id || special.messageId || '' },
                        { senderName: msg.sender || savedChatName, chatId: savedChatId }
                    );
                }
                if (special?.type === 'weibo_card' && special.weiboData) {
                    this.syncWeiboNewsToWeiboApp(special.weiboData, msg.sender);
                }

                // ⚠️ 重新检查用户现在是否还在这个界面（因为 await 之后状态可能变了）
                const isStillViewing = !!document.querySelector('.phone-view-current .wechat-app') &&
                    this.app.currentChat && this.app.currentChat.id === savedChatId;

                if (isStillViewing) {
                    window.VirtualPhone?.playWechatMessageSound?.({ source: 'online_inline_foreground' });
                    // 如果还在当前聊天，使用智能防闪烁引擎刷新
                    const messagesDiv = this._getVisibleChatMessagesContainer(savedChatId);
                    if (messagesDiv) {
                        const messages = this.app.wechatData.getMessages(savedChatId);
                        const userInfo = this.app.wechatData.getUserInfo();
                        this.smartUpdateMessages(messages, userInfo, { chatId: savedChatId });
                    }
                } else {
                    // 🔥 核心修复：如果用户切到了别的窗口或退到了列表，将此消息视为"后台新消息"处理
                    const bgChat = this.app.wechatData.getChat(savedChatId);
                    if (bgChat) {
                        bgChat.unread = (bgChat.unread || 0) + 1; // 增加未读红点
                        this.app.wechatData.saveData();
                        if (window.VirtualPhone?.notify) {
                            let finalNotifyAvatar = senderContact?.avatar || savedChatAvatar || bgChat.avatar || '';
                            if (!this.app._isCustomAvatarValue(finalNotifyAvatar)) {
                                finalNotifyAvatar = this.app.wechatData.getContactAutoAvatar(savedChatName) || finalNotifyAvatar;
                            }
                            const inlinePreviewRaw = String((special?.content || cleanContent || '')).replace(/\s+/g, ' ').trim();
                            const inlinePreview = inlinePreviewRaw.length > 34 ? `${inlinePreviewRaw.slice(0, 34)}...` : inlinePreviewRaw;
                            window.VirtualPhone.notify('新微信消息', inlinePreview || `${savedChatName} 给你发了新消息`, '', {
                                avatar: finalNotifyAvatar,
                                name: savedChatName || msg.sender || '微信',
                                content: inlinePreview || '发来新消息',
                                timeText: '刚刚',
                                senderKey: `wechat:inline:${savedChatId}:${Date.now()}`
                            });
                            window.VirtualPhone.playWechatMessageSound?.({ source: 'online_inline_background' });
                        } else {
                            this.app.phoneShell?.showNotification('新微信消息', `${savedChatName} 给你发了新消息`, '💬');
                            window.VirtualPhone?.playWechatMessageSound?.({ source: 'online_inline_background' });
                        }

                        // 同步全局红点
                        if (window.VirtualPhone?.home) {
                            const apps = window.VirtualPhone.home.apps;
                            if (apps) {
                                const wechatAppIcon = apps.find(a => a.id === 'wechat');
                                if (wechatAppIcon) {
                                    const chatList = this.app.wechatData.getChatList();
                                    wechatAppIcon.badge = chatList.reduce((sum, c) => sum + c.unread, 0);
                                    window.dispatchEvent(new CustomEvent('phone:updateGlobalBadge'));
                                }
                            }
                        }

                        // 如果当前在外层聊天列表，刷新列表以显示红点和新预览
                        if (this.app.currentView === 'chats' && !this.app.currentChat) {
                            this.app.render();
                        }
                    }
                }
            }

            // 🔥 新增：如果触发了线下联动，自动关闭手机并点击酒馆发送按钮
            if (triggerOffline) {
                const markWechatOnlineToOfflineHintPending = () => {
                    window.VirtualPhone?.markWechatOnlineToOfflineTransferPending?.({
                        chatId: savedChatId,
                        chatName: savedChatName
                    });
                };
                markWechatOnlineToOfflineHintPending();
                setTimeout(() => {
                    // 1. 优雅地关闭手机面板
                    const drawerIcon = document.getElementById('phoneDrawerIcon');
                    const drawerPanel = document.getElementById('phone-panel');
                    if (drawerPanel && drawerPanel.classList.contains('phone-panel-open')) {
                        drawerPanel.classList.remove('phone-panel-open', 'openDrawer', 'drawer-content', 'fillRight');
                        drawerPanel.classList.add('phone-panel-hidden');
                        drawerPanel.style.cssText = 'display:none !important; visibility:hidden !important; opacity:0 !important; pointer-events:none !important; position:absolute !important; width:0 !important; height:0 !important; overflow:hidden !important;';
                    }

                    // 2. 延迟触发酒馆的发送按钮，让剧情继续
                    setTimeout(() => {
                        // 🔥 仅释放由于手机面板隐藏导致的死锁焦点，防止浏览器卡死
                        if (document.activeElement) {
                            document.activeElement.blur();
                        }

                        // 🔥 直接点击发送按钮，绝不触发任何 input 事件，完美避开 AutoComplete 报错
                        const sendBtn = document.getElementById('send_but');
                        if (sendBtn) {
                            markWechatOnlineToOfflineHintPending();
                            sendBtn.click();
                        }
                    }, 500);
                }, 1500); // 延迟1.5秒，确保用户有时间看完最后一条微信消息
            }

            success = true;

        } catch (error) {
            // 🔥 区分中断和其他错误，静默处理中断，彻底干掉恶心的弹窗！
            if (error.message === '已中断发送' || error.name === 'AbortError') {
                console.log('✅ 手机端发送已中断，静默处理');
            } else {
                const errorText = this._formatErrorForLog(error, '发送手机消息失败');
                console.error('❌ 发送手机消息失败:', {
                    message: errorText,
                    stack: error?.stack,
                    raw: error
                });
                this.app.phoneShell?.showNotification('发送失败', errorText, '❌');
                
                // 🔥 修复2：发生严重代码报错时，强制把它从连发等待队列里踢出去，彻底杜绝死循环！
                this._dequeuePendingChat(savedChatId);
            }
        } finally {
            if (success) {
                this._dequeuePendingChat(savedChatId);
            }
            // 🔥 无论成功还是失败，都重置状态
            this.isSending = false;
            if (String(this._activeSendingChatId || '') === String(savedChatId || '')) {
                this._activeSendingChatId = null;
            }
            this.abortController = null;
            this._aiReplyRequestStartedAt = 0;
            this._resetAiReplyTimeCursor();
            this.syncHeaderStatusDot(savedChatId);
            this._refreshVisibleChatMessages(savedChatId);
            // 🔥 只有手机还开着才刷新界面（需要更新发送按钮状态）
            if (this.app.currentChat) {
                // 🔥 只更新发送按钮区域，避免整个界面重绘
                const currentView = this.getCurrentWechatView ? this.getCurrentWechatView() : document;
                const input = currentView.querySelector('#chat-input') || document.getElementById('chat-input');
                this._syncChatSendButton(input);
            }
        }
        return success;
    }

    // 🔥 中断发送方法
    abortSending() {
        if (this.abortController) {
            // 1. 中断手机端的流程等待
            this.abortController.abort();

            // 2. 🔥 核心杀招：调用抓取到的酒馆真实全局停止函数
            if (typeof window.stopGeneration === 'function') {
                window.stopGeneration();
            }

            // 3. 🔥 暴力兜底：强制点击界面的停止按钮（去掉了原来愚蠢的可见性判断）
            const stStopBtn = document.getElementById('mes_stop');
            if (stStopBtn) {
                stStopBtn.click();
            }
        }
        this.isSending = false;
        this._activeSendingChatId = null;
        this.hideTypingStatus();
        this.app.render();
    }

    // ✅ 静默调用AI（临时劫持底层配置，强制开启图片发送，由 ApiManager 接管）
    async sendToAIHidden(prompt, context, callMode = null, signal = null, targetChatId = null, options = {}) {
        if (!context) throw new Error('❌ 无法访问 context');

        // 1. 组装手机界面的独特上下文数组 (这里的逻辑不动，完美隔离)
        const messages = await this.buildMessagesArray(prompt, context, callMode, targetChatId, options);

        // 🔥 开启图片发送补丁（应对多模态）
        const stSettings = ['openai_settings', 'chat_completion_settings', 'claude_settings', 'maker_settings', 'google_settings'];
        const backups = {};
        stSettings.forEach(key => {
            if (window[key] && window[key].send_inline_pictures !== undefined) {
                backups[key] = window[key].send_inline_pictures;
                window[key].send_inline_pictures = true;
            }
        });

        try {
            // 🚀 核心：移交 ApiManager 处理
            const apiManager = window.VirtualPhone?.apiManager;
            if (!apiManager) throw new Error('API Manager 未初始化');

            const result = await apiManager.callAI(messages, {
                signal: signal,
                max_tokens: context.max_response_length,
                appId: 'wechat'
            });

            if (!result.success) {
                if (result.aborted) {
                    console.log('✅ 发送已取消');
                    throw new Error('已中断发送');
                }
                throw new Error(result.error || 'AI 返回失败但未提供错误信息');
            }

            return result.summary;

        } catch (error) {
            if (error.message === '已中断发送') throw error;
            console.error('❌ [手机聊天] 静默调用失败:', {
                message: this._formatErrorForLog(error, '静默调用失败'),
                stack: error?.stack,
                raw: error
            });
            throw error;
        } finally {
            // 还原配置
            stSettings.forEach(key => {
                if (window[key] && backups[key] !== undefined) window[key].send_inline_pictures = backups[key];
            });
        }
    }

    // 🔥 构建 messages 数组（参考记忆插件的方式读取酒馆数据）
    // callMode: null=微信聊天, 'voice'=语音通话, 'video'=视频通话
    _blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            try {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(new Error('read_blob_failed'));
                reader.readAsDataURL(blob);
            } catch (err) {
                reject(err);
            }
        });
    }

    async _resolveWechatImageForAi(imageValue, cacheMap = null) {
        const raw = String(imageValue || '').trim();
        if (!raw) return '';
        if (raw.startsWith('data:image')) return raw;
        if (cacheMap && cacheMap.has(raw)) return cacheMap.get(raw);

        const normalizedUrl = (() => {
            try {
                if (/^\/backgrounds\//i.test(raw)) return raw;
                if (/^https?:\/\//i.test(raw)) return raw;
                return new URL(raw, window.location.origin).href;
            } catch (e) {
                return raw;
            }
        })();

        let dataUrl = '';
        try {
            const resp = await fetch(normalizedUrl, { credentials: 'include' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            if (!String(blob?.type || '').startsWith('image/')) {
                throw new Error(`not_image_blob:${blob?.type || 'unknown'}`);
            }
            dataUrl = await this._blobToDataUrl(blob);
        } catch (err) {
            console.warn('[Wechat] 图片发送给AI失败，已降级为文字图片标记:', raw, err?.message || err);
            dataUrl = '';
        }

        if (cacheMap) {
            cacheMap.set(raw, dataUrl);
            cacheMap.set(normalizedUrl, dataUrl);
        }
        return dataUrl;
    }

    async buildMessagesArray(prompt, context, callMode = null, targetChatId = null, options = {}) {
        const messages = [];
        const isProactive = !!options.proactive;
        const proactiveMeta = options.proactiveMeta || {};
        const lobbySelection = this._buildLobbySelection(context);
        const lobbyUsers = this._resolveLobbySelectedUsers(lobbySelection);
        const lobbyUserProfiles = await this._resolveLobbySelectedUserProfiles(lobbySelection, context);
        const primaryLobbyUser = lobbyUsers.length > 0 ? lobbyUsers[0] : '';

        // 🔥🔥🔥 快照绑定：优先使用传入的 targetChatId，防止倒计时期间切换窗口导致串味
        const targetChat = targetChatId
            ? this.app.wechatData.getChatList().find(c => c.id === targetChatId)
            : this.app.currentChat;

        // ========================================
        // 1️⃣ 获取角色名和用户名（参考记忆插件）
        // ========================================
        const userName = (lobbySelection.isLobby && primaryLobbyUser) ? primaryLobbyUser : (context.name1 || '用户');
        const wechatUserName = String(this.app?.wechatData?.getUserInfo?.()?.name || '').trim();
        if (wechatUserName && wechatUserName !== userName) {
            messages.push({
                role: 'system',
                content: `【用户身份别名】酒馆正文中的“${userName}”与小手机微信昵称“${wechatUserName}”是同一个人，均指代{{user}}。微信聊天记录里“${wechatUserName}”发出的内容等同于“${userName}”发出的内容，不要把这两个名字当成两个人。`,
                name: 'SYSTEM (用户身份别名)',
                isPhoneMessage: true
            });
        }
        let charName = targetChat?.name || context.name2 || '角色';

        // 优先使用 characterId 获取真实角色名
        if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
            charName = context.characters[context.characterId].name || context.name2 || '角色';
        }

        // 🔥🔥🔥 检测是否是群聊
        const isGroupChat = targetChat?.type === 'group';
        const groupName = isGroupChat ? targetChat?.name : '';
        const profileContextEnabled = isGroupChat
            || this.app.wechatData.isProfileContextInjectionEnabledForChat?.(targetChat?.id) !== false;

        // 🔥 从多个来源获取群成员：1.聊天对象的members 2.历史消息中的发送者
        let groupMembersArray = [];
        if (isGroupChat) {
            groupMembersArray = this._collectGroupParticipantsForFilter(targetChat, context);
        }
        const groupMembers = this._formatGroupMembersForPrompt(groupMembersArray).join('、');

        // ========================================
        // 2️⃣ 角色信息（从角色卡读取）
        // ========================================
        if (profileContextEnabled && context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
            const char = context.characters[context.characterId];
            let charInfo = `【角色信息】\n角色名: ${char.name || charName}\n`;

            // 基础字段
            if (char.description) {
                charInfo += `描述: ${char.description}\n`;
            }
            if (char.personality) {
                charInfo += `性格: ${char.personality}\n`;
            }
            if (char.scenario) {
                charInfo += `场景/背景: ${char.scenario}\n`;
            }

            // 🔥 新增：读取 data.system_prompt（角色卡的系统提示词）
            if (char.data && char.data.system_prompt) {
                charInfo += `\n${char.data.system_prompt}\n`;
            }

            messages.push({
                role: 'system',
                content: charInfo,
                name: 'SYSTEM (角色卡)',
                isPhoneMessage: true
            });
        }

        const worldInfoMessage = await window.VirtualPhone?.worldbookManager?.buildWorldbookMessage?.('wechat');
        if (worldInfoMessage) messages.push(worldInfoMessage);

        if (profileContextEnabled && lobbySelection.isLobby && lobbySelection.characters.length > 0) {
            const lobbyCharacterSummary = lobbySelection.characters.map(item => this._formatLobbyCharacterDetail(item)).join('\n');
            messages.push({
                role: 'system',
                content: `【大厅联动白名单】当前是酒馆大厅模式，线上微信聊天只可参考以下角色卡：\n${lobbyCharacterSummary}`,
                name: 'SYSTEM (大厅角色白名单)',
                isPhoneMessage: true
            });
        }

        if (profileContextEnabled && lobbySelection.isLobby && lobbySelection.groups.length > 0) {
            const lobbyGroupSummary = lobbySelection.groups.map(item => {
                const memberText = Array.isArray(item.members) && item.members.length > 0
                    ? `（成员：${item.members.join('、')}）`
                    : '';
                return `${item.name}${memberText}`;
            }).join('；');
            messages.push({
                role: 'system',
                content: `【大厅联动用户组】当前是酒馆大厅模式，线上微信聊天优先使用以下用户组关系：${lobbyGroupSummary}`,
                name: 'SYSTEM (大厅用户组白名单)',
                isPhoneMessage: true
            });
        }

        // ========================================
        // 3️⃣ 用户信息（Persona）
        // ========================================
        // 从 DOM 读取用户 Persona
        const personaTextarea = document.getElementById('persona_description');
        if (profileContextEnabled && !lobbySelection.isLobby && personaTextarea && personaTextarea.value && personaTextarea.value.trim()) {
            messages.push({
                role: 'system',
                content: `【用户信息】\n${personaTextarea.value.trim()}`,
                name: 'SYSTEM (用户Persona)',
                isPhoneMessage: true
            });
        }

        if (profileContextEnabled && lobbySelection.isLobby) {
            if (lobbyUserProfiles.length > 0) {
                const profileText = lobbyUserProfiles.map(item => `【${item.name}】\n${item.description || '暂无该用户人设'}`).join('\n\n');
                messages.push({
                    role: 'system',
                    content: `【大厅用户人设】\n${profileText}`,
                    name: 'SYSTEM (大厅用户人设)',
                    isPhoneMessage: true
                });
            }
            messages.push({
                role: 'system',
                content: lobbyUsers.length > 0
                    ? `【大厅用户规则】当前大厅已勾选用户：${lobbyUsers.join('、')}。以“${primaryLobbyUser}”作为主用户视角，其余勾选用户可作为同场互动消息来源。`
                    : '【大厅用户规则】当前大厅未勾选具体用户，按默认用户视角处理。',
                name: 'SYSTEM (大厅用户规则)',
                isPhoneMessage: true
            });
        }

        let contactProfileMessage = null;
        if (!isGroupChat) {
            const currentContact = targetChat?.contactId
                ? this.app.wechatData.getContact(targetChat.contactId)
                : this.app.wechatData.getContactByName(targetChat?.name || charName);
            if (currentContact) {
                const contactNotes = [
                    `【当前聊天对象档案】`,
                    `联系人：${currentContact.name || targetChat?.name || charName}`
                ];

                if (currentContact.relation) {
                    contactNotes.push(`关系：${currentContact.relation}`);
                }
                if (currentContact.sourceApp === 'honey' || currentContact.sourceLabel === '蜜语' || currentContact.sourceLabel === '主播') {
                    contactNotes.push(`来源应用：蜜语`);
                    if (currentContact.sourceLabel === '主播' || String(currentContact.relation || '').includes('主播')) {
                        contactNotes.push(`来源身份：主播`);
                    }
                }
                if (currentContact.honeySource) {
                    contactNotes.push(`认识场景：${currentContact.honeySource}`);
                }
                if (currentContact.honeyVisibleIntro) {
                    contactNotes.push(`对外申请话术：${currentContact.honeyVisibleIntro}`);
                }
                if (currentContact.honeyHiddenBackground) {
                    contactNotes.push(`隐藏设定：${currentContact.honeyHiddenBackground}`);
                    contactNotes.push('这段隐藏设定是该联系人在后续微信聊天里的持续前提。你必须记住你们是怎么认识的，但不要生硬复述成说明书。');
                }
                if (currentContact.sourceApp === 'honey' || currentContact.sourceLabel === '蜜语' || currentContact.sourceLabel === '主播') {
                    const honeySummary = await this._getHoneyHostSummaryForWechatContact(currentContact);
                    if (honeySummary) {
                        contactNotes.push(`蜜语记录总结：${honeySummary}`);
                    }
                }
                if (currentContact.remark) {
                    contactNotes.push(`备注：${currentContact.remark}`);
                }

                contactProfileMessage = {
                    role: 'system',
                    content: contactNotes.join('\n'),
                    name: 'SYSTEM (联系人设定)',
                    isPhoneMessage: true
                };
            }
        }

        // ========================================
        // 🔌 兼容记忆插件的向量检索锚点
        // 记忆插件会在 Fetch Hijack 时查找此标识，并在其上方插入检索到的向量数据
        // ========================================
        const storage = window.VirtualPhone?.storage;
        const shouldInjectVectorAnchor = (() => {
            const basePerms = { allowSummary: false, allowTable: false, allowVector: false, allowPrompt: false };
            const defaults = { ...basePerms, allowSummary: true, allowVector: true };
            try {
                const rawPerms = storage?.get('phone_memory_permissions');
                const allPerms = rawPerms
                    ? (typeof rawPerms === 'string' ? JSON.parse(rawPerms) : rawPerms)
                    : {};
                const wechatPerms = (allPerms && typeof allPerms.wechat === 'object') ? allPerms.wechat : {};
                const merged = { ...defaults, ...wechatPerms };
                return merged.allowVector !== false;
            } catch (e) {
                return defaults.allowVector !== false;
            }
        })();

        if (shouldInjectVectorAnchor) {
            messages.push({
                role: 'system',
                content: '[Start a new chat]',
                name: 'SYSTEM (分界线)',
                isPhoneMessage: true
            });
        }

        // ========================================
        // 4️⃣ 酒馆聊天上下文（使用与记忆插件相同的方式读取）
        // ========================================
        const contextLimit = readPhoneContextLimit(window.VirtualPhone?.storage || this.app?.storage);

        if (contextLimit > 0 && context.chat && Array.isArray(context.chat) && context.chat.length > 0) {
            const isLobbySystemNoise = (msg, rawContent = '') => {
                if (!lobbySelection.isLobby) return false;
                if (msg?.is_user) return false;
                const plainText = String(rawContent || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                if (!plainText) return true;
                if (plainText === '[Start a new chat]') return true;
                if (plainText.includes('API 连接') && plainText.includes('角色管理') && plainText.includes('扩展程序')) return true;
                if (/如果您已连接到一个\s*API/.test(plainText)) return true;
                if (/将角色设为欢迎页面的助手/.test(plainText)) return true;
                if (/menu_button|drawer-opener|sys-settings-button|rightNavHolder|extensions-settings-button/i.test(String(rawContent || ''))) return true;
                return false;
            };

            const collectedContextMessages = [];
            for (let idx = context.chat.length - 1; idx >= 0 && collectedContextMessages.length < contextLimit; idx--) {
                const msg = context.chat[idx];
                // 跳过手机/记忆插件内部消息；隐藏楼层有正文时保留，避免占用楼层后又丢正文。
                if (!msg || msg.isGaigaiPrompt || msg.isGaigaiData || msg.isPhoneMessage) continue;

                // 🔥 优先使用 msg.mes（酒馆正则处理后的内容），参考记忆插件
                let content = msg.mes || msg.content || '';

                // 标签清洗：记忆插件可用时走记忆插件；否则按手机本地开关回退
                content = applyPhoneTagFilter(content, { storage: this.app?.storage || window.VirtualPhone?.storage });

                // 清理 base64 图片（防止请求体过大）
                content = content.replace(/<img[^>]*src=["']data:image[^"']*["'][^>]*>/gi, '[图片]');
                content = content.replace(/!\[[^\]]*\]\(data:image[^)]*\)/gi, '[图片]');
                if (isLobbySystemNoise(msg, content)) continue;

                content = content.trim();

                if (content) {
                    const isUser = msg.is_user || msg.role === 'user';
                    const speaker = isUser ? userName : charName;

                    collectedContextMessages.unshift({
                        role: isUser ? 'user' : 'assistant',
                        content: `${speaker}: ${content}`,
                        isPhoneMessage: true
                    });
                }
            }
            messages.push(...collectedContextMessages);
        }

        // ========================================
        // 5️⃣ 跨聊天上下文关联 (群聊带私聊 / 私聊带群聊)
        // 🔥 放在提示词上面，让AI先看到历史记录再看规则
        // ========================================
        const allChats = this.app.wechatData.getChatList();
        let relatedContextStr = '';
        let commonGroupNamesForSingleChat = [];
        let commonGroupListForSingleChat = '';
        const normalizeRelatedWechatName = (value) => String(value || '')
            .trim()
            .replace(/\s+/g, '')
            .replace(/[（(][^（）()]*[）)]/g, '')
            .toLowerCase();

        if (!callMode && !isGroupChat) {
            // 单聊只补充“共同群聊”作为参考。
            const normalizeCommonGroupName = (value) => String(value || '')
                .trim()
                .replace(/\s+/g, '')
                .replace(/[（(][^（）()]*[）)]/g, '')
                .toLowerCase();
            const groupChatLimit = this._readNonNegativeLimit('wechat-group-chat-limit', 200);
            const currentChatName = targetChat?.name || charName;
            const currentChatKey = normalizeCommonGroupName(currentChatName);
            const relatedGroupChats = allChats.filter((chat) => {
                if (chat?.type !== 'group') return false;
                const members = this._collectGroupParticipantsForFilter(chat, context);
                return members.some(member => normalizeCommonGroupName(member) === currentChatKey);
            });
            const relatedGroupMeta = relatedGroupChats
                .map((chat) => {
                    const name = String(chat?.name || '').trim();
                    const members = this._formatGroupMembersForPrompt(
                        this._collectGroupParticipantsForFilter(chat, context)
                            .map(member => String(member || '').trim())
                            .filter(Boolean)
                    );
                    return { chat, name, members };
                })
                .filter(item => item.name);
            commonGroupNamesForSingleChat = relatedGroupMeta.map(item => item.name);
            commonGroupListForSingleChat = relatedGroupMeta
                .map(item => `${item.name}${item.members.length > 0 ? `(${item.members.join('、')})` : ''}`)
                .join('、');

            if (relatedGroupChats.length > 0) {
                relatedContextStr += '【补充上下文：共同群聊参考】\n';

                if (groupChatLimit > 0) relatedGroupChats.forEach(c => {
                    const msgs = this.app.wechatData.getMessages(c.id).slice(-groupChatLimit);
                    if (msgs.length > 0) {
                        relatedContextStr += `--- 共同群聊参考：${c.name} ---\n`;
                        let lastDate = null;
                        msgs.forEach(m => {
                            if (m.date && m.date !== lastDate) {
                                relatedContextStr += `[${m.date}]\n`;
                                lastDate = m.date;
                            }
                            const speaker = m.from === 'me' ? userName : (m.from === 'system' ? '系统' : (m.from || '群成员'));
                            let text = this._formatMessageContentForPrompt(m, c);
                            if (m.quote) text = `「引用 ${m.quote.sender}: ${m.quote.content}」 ${text}`;
                            relatedContextStr += `[${m.time || ''}] ${speaker}: ${text}\n`;
                        });
                        relatedContextStr += '\n';
                    }
                });
            }
        } else if (!callMode && isGroupChat) {
            const singleChatLimit = this._readNonNegativeLimit('wechat-single-chat-limit', 200);
            const memberKeys = new Set(groupMembersArray.map(member => normalizeRelatedWechatName(member)).filter(Boolean));
            if (singleChatLimit > 0 && memberKeys.size > 0) {
                const relatedSingleChats = allChats
                    .filter(chat => {
                        if (chat?.type === 'group') return false;
                        const chatNameKey = normalizeRelatedWechatName(chat?.name || '');
                        const contact = chat?.contactId
                            ? this.app.wechatData.getContact(chat.contactId)
                            : this.app.wechatData.getContactByName(chat?.name || '');
                        const contactNameKey = normalizeRelatedWechatName(contact?.name || '');
                        return (chatNameKey && memberKeys.has(chatNameKey)) || (contactNameKey && memberKeys.has(contactNameKey));
                    })
                    .filter((chat, index, arr) => arr.findIndex(item => String(item?.id || '') === String(chat?.id || '')) === index);

                relatedSingleChats.forEach(chat => {
                    const msgs = this.app.wechatData.getMessages(chat.id)
                        .filter(m => !(m?.hiddenFromPrompt === true || m?.isTimeMarker === true || m?.type === 'time_marker'))
                        .slice(-singleChatLimit);
                    if (!msgs.length) return;

                    if (!relatedContextStr.trim()) relatedContextStr += '【补充上下文：群成员单聊参考】\n';
                    relatedContextStr += `--- 群成员单聊参考：${chat.name} ---\n`;
                    let lastDate = null;
                    msgs.forEach(m => {
                        if (m.date && m.date !== lastDate) {
                            relatedContextStr += `[${m.date}]\n`;
                            lastDate = m.date;
                        }
                        const speaker = m.from === 'me' ? userName : (m.from === 'system' ? '系统' : (m.from || chat.name || '群成员'));
                        let text = this._formatMessageContentForPrompt(m, chat);
                        if (m.quote) text = `「引用 ${m.quote.sender}: ${m.quote.content}」 ${text}`;
                        relatedContextStr += `[${m.time || ''}] ${speaker}: ${text}\n`;
                    });
                    relatedContextStr += '\n';
                });
            }
        }

        if (relatedContextStr.trim()) {
            messages.push({
                role: 'system',
                content: relatedContextStr.trim(),
                name: 'SYSTEM (跨聊天记忆)',
                isPhoneMessage: true
            });
        }

        if (isGroupChat) {
            const groupHoneyHostSummaryMessage = await this._buildGroupHoneyHostSummaryMessage(targetChat, groupMembersArray);
            if (groupHoneyHostSummaryMessage) {
                messages.push(groupHoneyHostSummaryMessage);
            }

            messages.push({
                role: 'system',
                content: '【当前窗口隔离规则】你现在只能回复当前这个微信群窗口。系统若提供了【群成员单聊参考】，只表示这些群成员与{{user}}在私聊中已经发生过的共同经历，可作为该成员在群聊中的关系、记忆和语气参考；没有提供单聊参考的群成员就不要假装知道私聊内容。绝对禁止提及、猜测、影射、总结、回应任何非群成员私聊、未读消息或其他无关窗口内容。',
                name: 'SYSTEM (窗口隔离)',
                isPhoneMessage: true
            });
        }

        // ========================================
        // 5.5️⃣ 手机聊天系统提示词（线上模式）
        // 🔥 放在跨聊天上下文之后，让AI先看历史再看规则
        // ========================================
        const promptManager = window.VirtualPhone?.promptManager;
        const myCustomEmojis = this.app.wechatData.getCustomEmojis();
        const customEmojiNames = Array.isArray(myCustomEmojis)
            ? myCustomEmojis.map(e => String(e?.description || e?.name || '').trim()).filter(Boolean)
            : [];
        const customEmojiList = customEmojiNames.length > 0 ? customEmojiNames.join('、') : '暂无可用自定义表情包';
        const personalImageTagInfo = this._buildWechatPersonalImageTagInfo({ targetChat, isGroupChat });
        let systemPrompt = '';
        const overrideReplacements = {
            user: userName,
            chatName: targetChat?.name || charName,
            char: targetChat?.name || charName,
            groupName,
            groupMembers,
            customEmojiList,
            personalImageTagInfo
        };
        const onlineOverridePrompt = this._getOnlineOverridePrompt(promptManager, overrideReplacements);
        if (onlineOverridePrompt) {
            messages.unshift({
                role: 'system',
                content: onlineOverridePrompt,
                name: 'SYSTEM (🧩微信破限词)',
                isPhoneMessage: true
            });
        }

        // 🔥 根据模式选择提示词（非通话模式时）
        if (!callMode) {
            try {
                if (isGroupChat && promptManager?.getPromptForFeature) {
                    // 群聊模式
                    systemPrompt = promptManager.getPromptForFeature('wechat', 'groupChat') || '';

                    // 🔥 获取好友列表用于私聊窗口名
                    const contacts = this.app.wechatData.getContacts() || [];
                    const wechatContactsList = this._formatWechatContactListForPrompt(contacts);

                    // 替换群聊相关变量
                    systemPrompt = systemPrompt
                        .replace(/\{\{groupName\}\}/g, groupName)
                        .replace(/\{\{chatName\}\}/g, '好友完整微信名')
                        .replace(/\{\{groupMembers\}\}/g, groupMembers)
                        .replace(/\{\{wechatContacts\}\}/g, wechatContactsList)
                        .replace(/\{\{customEmojiList\}\}/g, customEmojiList)
                        .replace(/\{\{personalImageTagInfo\}\}/g, personalImageTagInfo);
                } else if (promptManager?.getPromptForFeature) {
                    // 单聊模式
                    systemPrompt = promptManager.getPromptForFeature('wechat', 'online') || '';
                    // 🔥 替换单聊窗口名变量
                    const chatName = targetChat?.name || charName;
                    systemPrompt = systemPrompt
                        .replace(/\{\{chatName\}\}/g, chatName)
                        .replace(/\{\{commonGroupNames\}\}/g, commonGroupNamesForSingleChat.length > 0 ? commonGroupNamesForSingleChat.join('、') : '无')
                        .replace(/\{\{commonGroupList\}\}/g, commonGroupListForSingleChat || '无')
                        .replace(/\{\{customEmojiList\}\}/g, customEmojiList)
                        .replace(/\{\{personalImageTagInfo\}\}/g, personalImageTagInfo);
                }
            } catch (e) {
                console.warn('⚠️ 获取微信聊天提示词失败:', e);
            }
        }

        // ========================================
        // 6️⃣ 当前微信聊天记录 / 通话记录
        // ========================================
        const wechatMessages = this.app.wechatData.getMessages(targetChat.id);

        // 🔥 根据聊天类型动态读取限制条数（isGroupChat 和 storage 已在上方声明）
        const wechatLimit = isGroupChat
            ? this._readNonNegativeLimit('wechat-group-chat-limit', 200)
            : this._readNonNegativeLimit('wechat-single-chat-limit', 200);

        // 🔥 展开 call_record 的 transcript 后按交互条数截取
        // 逆序遍历，展开 call_record 内部行数，直到总交互次数达到 wechatLimit
        let recentWechatMessages = [];
        if (wechatLimit > 0) {
            let totalLines = 0;
            let startIdx = wechatMessages.length;
            for (let i = wechatMessages.length - 1; i >= 0; i--) {
                const msg = wechatMessages[i];
                if (msg?.hiddenFromPrompt === true || msg?.isTimeMarker === true || msg?.type === 'time_marker') {
                    continue;
                }
                if (msg.type === 'call_record' && msg.transcript && msg.transcript.length > 0) {
                    totalLines += msg.transcript.length + 1; // transcript 行数 + 通话记录本身
                } else {
                    totalLines += 1;
                }
                if (totalLines >= wechatLimit) {
                    startIdx = i;
                    break;
                }
                startIdx = i;
            }
            recentWechatMessages = wechatMessages.slice(startIdx);
        }
        const aiImageDataCache = new Map();
        const aiImageNotes = [];
        const aiImageTokenIds = [];
        const paymentStatusContext = !isGroupChat
            ? this._buildWechatPaymentStatusContext(recentWechatMessages, userName)
            : '';
        const musicListeningContext = !callMode
            ? this._buildMusicListeningContext(targetChat, userName)
            : '';
        const catboxCoAdoptContext = !callMode && !isGroupChat
            ? String(this._getCatboxData().getCoAdoptContextForChat?.(targetChat?.id, targetChat?.name || charName) || '').replace(/\{\{user\}\}/g, userName)
            : '';

        const timeManager = window.VirtualPhone?.timeManager;
        const realTimeInfo = this._formatRealDateTime(proactiveMeta.now || Date.now());
        const currentTime = isProactive
            ? realTimeInfo.time
            : (timeManager?.getCurrentStoryTime?.()?.time || '21:30');

        const appendWechatChatTranscript = async (chat, messagesForChat) => {
            let text = `━━━ ${chat.name} 的聊天记录 ━━━\n`;
            let lastDate = null;
            const chatIsGroup = chat?.type === 'group';

            for (const msg of messagesForChat) {
                if (msg?.hiddenFromPrompt === true || msg?.isTimeMarker === true || msg?.type === 'time_marker') {
                    continue;
                }
                const isUser = msg.from === 'me';
                let speaker = isUser ? userName : chat.name;
                if (!isUser && chatIsGroup && msg.from && msg.from !== 'system') {
                    speaker = msg.from;
                }

                if (msg.date && msg.date !== lastDate) {
                    text += `--- ${msg.date} ---\n`;
                    lastDate = msg.date;
                }

                const timeStr = msg.time ? `[${msg.time}] ` : '';
                const quoteStr = msg.quote ? `「引用 ${msg.quote.sender}: ${msg.quote.content}」` : '';

                if (msg.from === 'system' || msg.type === 'system') {
                    text += `${timeStr}[系统] ${msg.content || ''}\n`;
                } else if (msg.type === 'call_record') {
                    const callTypeName = msg.callType === 'video' ? '视频通话' : '语音通话';
                    const statusText = msg.status === 'answered'
                        ? `通话时长 ${msg.duration}`
                        : (msg.status === 'rejected' || msg.status === 'declined')
                            ? '对方已拒绝'
                            : msg.status === 'cancelled'
                                ? '已取消'
                                : '未接听';
                    text += `${timeStr}[${callTypeName} - ${statusText}]\n`;
                    if (msg.transcript && msg.transcript.length > 0) {
                        msg.transcript.forEach(t => {
                            const tSpeaker = t.from === 'me' ? userName : t.from;
                            text += `  [通话记录] ${tSpeaker}: ${t.text}\n`;
                        });
                    }
                } else if (msg.type === 'image') {
                    const resolvedImageData = await this._resolveWechatImageForAi(msg.content, aiImageDataCache);
                    const imageText = this._formatMessageContentForPrompt(msg, chat) || '[图片]';
                    if (resolvedImageData && resolvedImageData.startsWith('data:image')) {
                        const imgId = `__ST_PHONE_IMAGE_${Date.now()}_${Math.random().toString(36).substr(2, 5)}__`;
                        if (!window.VirtualPhone._pendingImages) {
                            window.VirtualPhone._pendingImages = {};
                        }
                        window.VirtualPhone._pendingImages[imgId] = {
                            url: resolvedImageData,
                            label: imageText
                        };
                        aiImageTokenIds.push(imgId);
                        aiImageNotes.push(`${timeStr}${speaker}: ${quoteStr}${imageText} ${imgId}`);
                        text += `${timeStr}${speaker}: ${quoteStr}${imageText}\n`;
                    } else {
                        text += `${timeStr}${speaker}: ${quoteStr}${imageText}\n`;
                    }
                } else if (msg.type === 'image_prompt') {
                    // 🔥 修复：将 [图片/视频] 标签原样包裹回去
                    text += `${timeStr}${speaker}: ${quoteStr}${this._formatImagePromptTagForPrompt(msg)}\n`;
                } else if (msg.type === 'transfer') {
                    // 🔥 修复：直接将转账状态贴在文字后面
                    const rawStatus = String(msg.status || '').trim();
                    const status = rawStatus === 'received' ? '已收款' : (rawStatus === 'refunded' ? '已退回' : '未收款');
                    text += `${timeStr}${speaker}: ${quoteStr}[转账 ¥${msg.amount}]（状态：${status}）\n`;
                } else if (msg.type === 'redpacket') {
                    // 🔥 修复：直接将红包状态贴在文字后面
                    const rawStatus = String(msg.status || '').trim();
                    const status = rawStatus === 'opened' ? '已领取' : (rawStatus === 'refunded' ? '已退回' : '未领取');
                    text += `${timeStr}${speaker}: ${quoteStr}[红包 ¥${msg.amount}]（状态：${status}）\n`;
                } else if (msg.type === 'location') {
                    const locationText = String(msg.locationText || msg.locationAddress || msg.content || '').trim();
                    text += `${timeStr}${speaker}: ${quoteStr}[定位]（${locationText || '未知位置'}）\n`;
                } else if (msg.type === 'catbox_care_card') {
                    const noteText = msg.catboxNote ? `，留言：${msg.catboxNote}` : '';
                    text += `${timeStr}${speaker}: ${quoteStr}[猫盒照顾] 使用 ${msg.catboxItemName || '零食'}x${msg.catboxQuantity || 1}${noteText}\n`;
                } else {
                    const lineText = this._formatMessageContentForPrompt(msg, chat);
                    text += `${timeStr}${speaker}: ${quoteStr}${lineText || ''}\n`;
                }
            }
            return text.trim();
        };

        // 先统一构建微信聊天历史（文本 + 图片 + 通话记录），通话模式也复用这段上下文
        let wechatTranscript = '';
        if (isProactive && !callMode) {
            const transcriptSections = [];
            const allWechatChats = this.app.wechatData.getChatList();
            for (const chat of allWechatChats) {
                const limit = chat?.type === 'group'
                    ? this._readNonNegativeLimit('wechat-group-chat-limit', 200)
                    : this._readNonNegativeLimit('wechat-single-chat-limit', 200);
                if (limit <= 0) continue;
                const chatMessages = this.app.wechatData.getMessages(chat.id).slice(-limit);
                if (chatMessages.length === 0) continue;
                const section = await appendWechatChatTranscript(chat, chatMessages);
                if (section) transcriptSections.push(section);
            }
            if (transcriptSections.length > 0) {
                wechatTranscript = '【📱 手机微信已有消息】\n';
                wechatTranscript += `⏰ 当前时间：${currentTime}\n`;
                wechatTranscript += `以下是用户手机已经存在的微信消息记录。使用微信时，请严格遵守当前微信模式规则，不得重复已有聊天记录内容。\n\n`;
                wechatTranscript += transcriptSections.join('\n\n');
            }
        } else if (recentWechatMessages.length > 0) {
            wechatTranscript = '【📱 手机微信已有消息】\n';
            wechatTranscript += `⏰ 当前时间：${currentTime}\n`;
            wechatTranscript += `以下是用户手机已经存在的微信消息记录。使用微信时，请严格遵守当前微信模式规则，并严格执行【微信线下模式】关于历史消息不可重复生成的约束，不得重复已有聊天记录内容。\n`;
            wechatTranscript += `\n`;
            wechatTranscript += await appendWechatChatTranscript(targetChat, recentWechatMessages);
        }

        if (!callMode && catboxCoAdoptContext) {
            messages.push({
                role: 'system',
                content: catboxCoAdoptContext,
                name: 'SYSTEM (猫盒共同收养)',
                isPhoneMessage: true
            });
        }

        if (systemPrompt) {
            messages.push({
                role: 'system',
                content: systemPrompt,
                name: isGroupChat ? 'SYSTEM (👥群聊模式)' : 'SYSTEM (📱手机聊天)',
                isPhoneMessage: true
            });
        }

        if (isProactive && !callMode) {
            const proactiveRules = this._buildOnlineProactiveRules({
                userName,
                targetChat,
                customEmojiList,
                proactiveMeta
            });
            if (proactiveRules) {
                messages.push({
                    role: 'system',
                    content: proactiveRules,
                    name: 'SYSTEM (微信线上主动触发规则)',
                    isPhoneMessage: true
                });
            }
        }

        // 🔥 通话模式：将通话规则、当前微信聊天历史、本次通话输入分开注入
        if (callMode) {
            const promptManager = window.VirtualPhone?.promptManager;
            const promptFeature = this._getCallPromptFeature(callMode, targetChat);
            const contacts = this.app.wechatData.getContacts() || [];
            const wechatContactsList = this._formatWechatContactListForPrompt(contacts);

            let callSystemPrompt = '';
            if (promptManager?.getPromptForFeature) {
                callSystemPrompt = promptManager.getPromptForFeature('wechat', promptFeature) || '';
            }

            callSystemPrompt = callSystemPrompt
                .replace(/\{\{user\}\}/g, userName)
                .replace(/\{\{char\}\}/g, targetChat.name)
                .replace(/\{\{groupName\}\}/g, groupName)
                .replace(/\{\{groupMembers\}\}/g, groupMembers)
                .replace(/\{\{wechatContacts\}\}/g, wechatContactsList);

            if (callSystemPrompt) {
                messages.push({
                    role: 'system',
                    content: callSystemPrompt,
                    name: `SYSTEM (${isGroupChat ? '群' : ''}${callMode === 'video' ? '视频' : '语音'}通话)`,
                    isPhoneMessage: true
                });
            }

            if (paymentStatusContext) {
                messages.push({
                    role: 'system',
                    content: paymentStatusContext,
                    name: 'SYSTEM (资金状态)',
                    isPhoneMessage: true
                });
            }

            if (contactProfileMessage) {
                messages.push(contactProfileMessage);
            }

            if (wechatTranscript) {
                messages.push({
                    role: 'system',
                    content: wechatTranscript,
                    name: 'SYSTEM (微信记录)',
                    isPhoneMessage: true
                });
            }

            if (prompt) {
                messages.push({
                    role: 'user',
                    content: `当前时间: ${currentTime}\n\n${prompt}`,
                    isPhoneMessage: true
                });
            }
        } else {
            if (paymentStatusContext) {
                messages.push({
                    role: 'system',
                    content: paymentStatusContext,
                    name: 'SYSTEM (资金状态)',
                    isPhoneMessage: true
                });
            }
            if (contactProfileMessage) {
                messages.push(contactProfileMessage);
            }
            if (wechatTranscript) {
                messages.push({
                    role: 'system',
                    content: wechatTranscript,
                    name: 'SYSTEM (微信记录)',
                    isPhoneMessage: true
                });
            }
            if (musicListeningContext) {
                messages.push({
                    role: 'system',
                    content: musicListeningContext,
                    name: 'SYSTEM (一起听歌)',
                    isPhoneMessage: true
                });
            }
        }

        // ========================================
        // 7️⃣ 末尾追加模式强化提示
        // ========================================
        let currentModeName = '微信单聊';
        if (callMode === 'video') currentModeName = isGroupChat ? '微信群视频通话' : '微信视频通话';
        else if (callMode === 'voice') currentModeName = isGroupChat ? '微信群语音通话' : '微信语音通话';
        else if (isGroupChat) currentModeName = '微信群聊';

        let finalUserContent = isProactive
            ? `现在你处于微信线上主动触发模式。现实时间到点后，微信好友或微信群需要主动联系${userName}。请根据以上所有信息、微信单聊规则和微信群聊规则，主动生成新的线上微信消息。`
            : `现在你处于${currentModeName}的模式，请根据以上所有信息，遵守回复格式，自然承接用户的消息进行回复。`;
        if (!callMode) {
            if (isGroupChat) {
                finalUserContent += '\n群聊场景下，通话前后的发言仍需使用“发送者: 内容”格式，且发送者必须是群成员。';
            }

            const latestUserInput = String(prompt || '').trim();
            if (latestUserInput) {
                finalUserContent += isProactive
                    ? `\n\n【线上主动触发背景】\n${latestUserInput}`
                    : `\n\n【用户最新输入】\n${userName}: ${latestUserInput}`;
            }
            finalUserContent += '\n\n【本轮约束】';
            if (isProactive) {
                const elapsedMinutes = Math.max(0, Number.parseInt(proactiveMeta.elapsedMinutes, 10) || 0);
                const intervalMinutes = Math.max(1, Number.parseInt(proactiveMeta.intervalMinutes, 10) || 1);
                finalUserContent += `\n- 【现实时间】当前现实时间为 ${realTimeInfo.date} ${realTimeInfo.time}；距离上次线上主动触发约 ${elapsedMinutes} 分钟，用户设置的触发间隔为 ${intervalMinutes} 分钟。`;
                finalUserContent += '\n- 本轮不是用户刚刚发消息，而是线上模式按现实时间自动触发；你必须让合适的微信好友或微信群主动联系用户。';
                finalUserContent += '\n- 必须只输出一个 <wechat>...</wechat> 标签，禁止返回空，禁止解释，禁止输出标签外文字。';
                finalUserContent += '\n- 必须同时审视【手机微信已有消息】里的单聊窗口和群聊窗口；可以选择一个最合理的单聊、一个最合理的群聊，或在同一个 <wechat> 中输出多个合理窗口。';
                finalUserContent += '\n- 窗口名必须来自已有微信聊天记录窗口，且格式沿用现有微信线上单聊/群聊规则。';
                finalUserContent += `\n- 所有新增消息都必须是发给手机主人“${userName}”的线上微信消息；禁止替${userName}发言。`;
                finalUserContent += '\n- 单聊窗口继续遵守微信单聊模式；群聊窗口继续遵守微信群聊模式，群内发送者必须来自该群成员白名单。';
                finalUserContent += '\n- 消息时间必须按当前现实时间或当前窗口最后一条已存在消息之后自然推进。';
            } else if (!isGroupChat) {
                finalUserContent += `\n- 【方向锁定】当前微信单聊窗口是“${targetChat?.name || charName}”；手机主人/用户本人是“${userName}”。你只能扮演“${targetChat?.name || charName}”给“${userName}”发新增微信消息。`;
                finalUserContent += `\n- 即使角色卡主角、酒馆 assistant 或正文叙事视角不是“${targetChat?.name || charName}”，当前微信单聊也必须以“${targetChat?.name || charName}”的身份和口吻回复；角色卡和正文只作为背景参考。`;
                finalUserContent += `\n- 【用户最新输入】是“${userName}”刚刚发出的消息，只能作为被回复的内容；禁止把“${userName}”当成聊天对象、联系人、窗口名或回复发送者，禁止输出“${userName}:”、用户:、玩家:。`;
                finalUserContent += '\n- 微信消息内容必须是角色真实打进聊天框里的文字；禁止写动作、环境、神态、写字过程、语气说明，禁止出现“顿了顿/指尖悬停/又补了一条/语气里”等叙事句。';
                finalUserContent += '\n- 正文/酒馆上下文是当前现实剧情状态的依据；如果正文显示双方已经线下面对面、同处一地、正在现实互动，你必须承认这个状态，必要时用 [转线下] 结束当前单聊微信，而不是把现实剧情当作不存在。';
            }
            finalUserContent += isProactive
                ? '\n- 只输出新的主动微信消息；不得重复任何已有微信消息，也不得把正文里刚发生的对白原样复读成微信消息。'
                : '\n- 只输出当前微信窗口的新增回复；严禁重复“手机微信已有消息”中已经存在的微信消息，严禁将正文里刚发生的对白重复成微信消息。';
            finalUserContent += '\n- 可以基于正文最新事件、情绪、地点变化作出自然回应，但回复必须是新的微信内容。';
            finalUserContent += '\n- 消息时间必须承接当前窗口最后一条已存在消息的时间并向后推进。';
        }

        // 🔥 把所有待发送的图片代币附加到 user 消息末尾（多模态只能在 user 消息中生效）
        if (aiImageTokenIds.length > 0 && aiImageNotes.length > 0) {
            finalUserContent += '\n\n[以下是聊天记录中标注的图片，请结合上方时间线理解图片内容]\n';
            aiImageNotes.forEach(note => {
                finalUserContent += `${note}\n`;
            });
        }

        messages.push({
            role: 'user',
            content: finalUserContent,
            name: 'USER (系统指令)',
            isPhoneMessage: true
        });

        return messages;
    }

    _buildOnlineProactiveRules({ userName = '用户', targetChat = null, customEmojiList = '', proactiveMeta = {} } = {}) {
        const promptManager = window.VirtualPhone?.promptManager;
        const realTimeInfo = this._formatRealDateTime(proactiveMeta.now || Date.now());
        const chats = this.app.wechatData.getChatList();
        const contacts = this.app.wechatData.getContacts?.() || [];
        const wechatContactsList = this._formatWechatContactListForPrompt(contacts);
        const allPersonalImageTagInfo = this._formatPersonalImageTagRows(contacts.map(contact => ({
            name: contact?.name,
            tags: contact?.naiPromptTags || contact?.imageTags
        })));

        const normalizePrompt = (text, replacements = {}) => {
            let out = String(text || '').trim();
            Object.entries(replacements).forEach(([key, value]) => {
                out = out.replace(new RegExp(`\\{\\{${this._escapeRegExp(key)}\\}\\}`, 'g'), String(value ?? ''));
            });
            return out.trim();
        };

        let singlePrompt = '';
        let groupPrompt = '';
        try {
            const sampleSingle = chats.find(chat => chat?.type !== 'group') || targetChat || {};
            const sampleGroup = chats.find(chat => chat?.type === 'group') || {};
            const groupMembers = sampleGroup?.type === 'group'
                ? this._formatGroupMembersForPrompt(this._collectGroupParticipantsForFilter(sampleGroup, this._safeGetContext())).join('、')
                : '请参考【手机微信已有消息】中各群聊窗口的群成员白名单';
            singlePrompt = normalizePrompt(promptManager?.getPromptForFeature?.('wechat', 'online') || '', {
                chatName: sampleSingle?.name || '候选微信好友',
                commonGroupNames: '按【手机微信已有消息】判断',
                commonGroupList: '按【手机微信已有消息】判断',
                customEmojiList,
                personalImageTagInfo: this._buildWechatPersonalImageTagInfo({ targetChat: sampleSingle, isGroupChat: false })
            });
            groupPrompt = normalizePrompt(promptManager?.getPromptForFeature?.('wechat', 'groupChat') || '', {
                groupName: sampleGroup?.name || '候选微信群',
                groupMembers,
                wechatContacts: wechatContactsList,
                chatName: '好友完整微信名',
                customEmojiList,
                personalImageTagInfo: sampleGroup?.type === 'group'
                    ? this._buildWechatPersonalImageTagInfo({ targetChat: sampleGroup, isGroupChat: true })
                    : allPersonalImageTagInfo
            });
        } catch (e) {
            console.warn('⚠️ 构建微信线上主动触发规则失败:', e);
        }

        const elapsedMinutes = Math.max(0, Number.parseInt(proactiveMeta.elapsedMinutes, 10) || 0);
        const intervalMinutes = Math.max(1, Number.parseInt(proactiveMeta.intervalMinutes, 10) || 1);

        return [
            '【微信线上主动触发】',
            `当前现实时间：${realTimeInfo.date} ${realTimeInfo.time}`,
            `距离上次线上主动触发约 ${elapsedMinutes} 分钟；用户设置的自动触发间隔为 ${intervalMinutes} 分钟。`,
            '这是线上模式按现实时间自动触发，不是用户主动发消息。你必须复用下方微信线上单聊和微信群聊规则，输出标准 <wechat> 标签，让合适的好友或群聊主动联系用户。',
            '',
            singlePrompt ? `【复用：微信线上单聊提示词】\n${singlePrompt}` : '',
            groupPrompt ? `【复用：微信群聊提示词】\n${groupPrompt}` : ''
        ].filter(Boolean).join('\n\n');
    }

    async handleMoreAction(action) {
        switch (action) {
            case 'emoji':
                // 🔥 打开表情面板
                this.showMore = false;
                this.showEmoji = true;
                this.app.render();
                break;
            case 'image':
                this.showImageSourceSheet();
                break;
            case 'screenshot':
                await this.captureAndSendChatSnapshot({ longCapture: false });
                break;
            case 'honey':
                await this.startHoneyInviteFromWechat();
                break;
            case 'video':
                this.startVideoCall();
                break;
            case 'voice':
                this.startVoiceCall();
                break;
            case 'location':
                this.app.phoneShell.showNotification('位置', '正在获取位置...', '📍');
                break;
            case 'transfer':
                this.resetTransientInputPanels();
                this.showTransferDialog();
                break;
            case 'redpacket':
                this.resetTransientInputPanels();
                this.showRedPacketDialog();
                break;
        }
    }

    _buildMusicListeningContext(targetChat, userName = '用户') {
        if (!targetChat?.id) return '';
        const session = this.app.wechatData.getMusicListening?.(targetChat.id);
        if (!session) return '';

        const snapshot = window.VirtualPhone?.musicApp?.musicData?.getListeningSnapshot?.() || null;
        const songName = String(snapshot?.songName || session.songName || '').trim() || '未知歌曲';
        const artist = String(snapshot?.artist || session.artist || '').trim() || '未知歌手';
        const currentSeconds = Number(snapshot?.currentTime || 0);
        const currentTime = this._formatMusicListenTime(currentSeconds);
        const duration = Number(snapshot?.duration || 0) > 0 ? this._formatMusicListenTime(Number(snapshot.duration)) : '';
        const lyric = String(snapshot?.lyric || '').trim();
        const translation = String(snapshot?.lyricTranslation || '').trim();
        const around = Array.isArray(snapshot?.lyricAround)
            ? snapshot.lyricAround.map(item => String(item || '').trim()).filter(Boolean)
            : [];
        const lyricWindow = Array.isArray(snapshot?.lyricWindow)
            ? snapshot.lyricWindow.map(item => String(item || '').trim()).filter(Boolean)
            : [];
        const playlistSongs = Array.isArray(snapshot?.playlistSongs)
            ? snapshot.playlistSongs.map(item => String(item || '').trim()).filter(Boolean)
            : [];
        const favoriteSongs = Array.isArray(snapshot?.favoriteSongs)
            ? snapshot.favoriteSongs.map(item => String(item || '').trim()).filter(Boolean)
            : [];
        const otherName = String(session.contactName || targetChat.name || '对方').trim();

        const lines = [
            '【一起听歌状态】',
            `${userName} 已邀请微信好友“${otherName}”一起听歌，双方当前仍处于一起听歌状态。`,
            `当前实时播放歌曲：《${songName}》`,
            `歌手/演唱者：${artist}`,
            `当前播放位置：${currentTime}${duration ? ` / ${duration}` : ''}`
        ];

        if (lyric) lines.push(`当前唱到的歌词：${lyric}${translation ? `（${translation}）` : ''}`);
        if (around.length > 0) lines.push(`附近歌词节选：${around.join(' / ')}`);
        if (lyricWindow.length > 0) {
            lines.push('预计AI回复时段歌词节选（当前播放点后约40-80秒）：');
            lyricWindow.forEach(item => lines.push(`- ${item}`));
        }
        if (playlistSongs.length > 0) lines.push(`用户普通歌单：${playlistSongs.join('；')}`);
        if (favoriteSongs.length > 0) lines.push(`用户收藏歌单：${favoriteSongs.join('；')}`);
        lines.push('后续微信回复必须知道双方正在一起听这首歌，可以自然提及歌曲、歌手、当前歌词或播放位置，但不要机械复述这段系统说明。');

        return lines.join('\n');
    }

    _formatMusicListenTime(seconds = 0) {
        const value = Math.max(0, Number(seconds || 0));
        const m = Math.floor(value / 60);
        const s = Math.floor(value % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    showImageSourceSheet() {
        const sheet = document.getElementById('wechat-image-source-sheet');
        if (!sheet) {
            this.selectPhoto();
            return;
        }
        sheet.style.display = sheet.style.display === 'none' ? 'block' : 'none';
    }

    hideImageSourceSheet() {
        const sheet = document.getElementById('wechat-image-source-sheet');
        if (sheet) sheet.style.display = 'none';
    }

    async startHoneyInviteFromWechat() {
        const chat = this.app.currentChat;
        if (!chat || chat.type === 'group') {
            this.app.phoneShell.showNotification('蜜语', '蜜语邀约仅支持微信单聊', '⚠️');
            return;
        }
        if (!this.isOnlineMode()) {
            this.app.phoneShell.showNotification('离线模式', '请在设置中开启在线模式', '⚠️');
            return;
        }

        this.showMore = false;
        this.showEmoji = false;
        this._setCustomEmojiSelectionMode(false);

        const userInfo = this.app.wechatData.getUserInfo();
        this.app.wechatData.addMessage(chat.id, {
            from: 'me',
            type: 'honey_invite',
            content: '[蜜语]（等待回应）',
            honeyInviteStatus: '等待回应',
            avatar: userInfo.avatar
        });
        this.app.render();

        await this.sendToAI('用户主动发起了蜜语邀约。', chat.id);
    }

    showTransferDialog() {
        const chat = this.app.currentChat;
        const avatarHtml = this.app.renderAvatar(chat.avatar, '👤', chat.name);

        const html = `
        <div class="wechat-app">
            <!-- 顶部灰色区域 -->
            <div style="background: #ededed; padding: 34px 12px 14px 12px;">
                <button class="wechat-back-btn" id="back-from-transfer" style="color:#000; background:none; border:none; font-size:14px; cursor:pointer; padding:0; margin-bottom:12px;">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
                <div style="display:flex; align-items:center; justify-content:space-between;">
                    <div style="font-size:14px; font-weight:500; color:#000;">转账给 ${chat.name}</div>
                    <div style="width:36px; height:36px; border-radius:50%; background:#ddd; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                        ${avatarHtml}
                    </div>
                </div>
            </div>

            <!-- 白色卡片区 -->
            <div class="wechat-content" style="background: #f5f5f5; padding: 0; overflow:hidden;">
                <div style="background:#fff; border-radius: 8px 8px 0 0; margin-top:6px; padding: 14px 14px 20px;">
                    <div style="font-size:12px; color:#888; margin-bottom:10px;">转账金额</div>
                    <div style="display:flex; align-items:baseline; border-bottom:1px solid #e5e5e5; padding-bottom:8px;">
                        <span style="font-size:22px; font-weight:bold; color:#000; margin-right:4px;">¥</span>
                        <input type="number" id="transfer-amount" placeholder="0.00" style="
                            border:none; outline:none; font-size:22px; font-weight:bold; color:#000;
                            flex:1; min-width:0; background:transparent;
                        ">
                    </div>
                    <div style="margin-top:10px;">
                        <input type="text" id="transfer-desc" placeholder="添加转账说明" style="
                            border:none; outline:none; font-size:12px; color:#07c160; background:transparent; padding:0; width:100%;
                        ">
                    </div>
                </div>

                <!-- 底部转账按钮（右下角） -->
                <div style="flex:1;"></div>
                <div style="padding: 12px 14px; display:flex; justify-content:flex-end;">
                    <button id="confirm-transfer" style="
                        padding: 10px 28px; background: #07c160; color: #fff;
                        border: none; border-radius: 6px; font-size: 13px; cursor: pointer;
                    ">转账</button>
                </div>
            </div>
        </div>
    `;

        this.app.phoneShell.setContent(html);

        const backBtn = document.getElementById('back-from-transfer');
        if (backBtn) backBtn.onclick = () => this.app.render();

        document.getElementById('confirm-transfer')?.addEventListener('click', async () => {
            const amount = document.getElementById('transfer-amount').value;
            const desc = document.getElementById('transfer-desc').value || '转账给你';

            if (!amount || isNaN(amount) || amount <= 0) {
                this.app.phoneShell.showNotification('提示', '请输入正确的金额', '⚠️');
                return;
            }

            // 检查钱包余额
            const currentBalance = this.app.wechatData.getWalletBalance();
            if (currentBalance !== null && parseFloat(amount) > currentBalance) {
                this.app.phoneShell.showNotification('余额不足', `你的零钱只剩 ¥${parseFloat(currentBalance).toFixed(2)} 啦`, '❌');
                return;
            }
            // 扣款
            if (currentBalance !== null) {
                this.app.wechatData.updateWalletBalance(-parseFloat(amount));
            }

            this.app.wechatData.addMessage(this.app.currentChat.id, {
                from: 'me',
                type: 'transfer',
                content: `[转账] ¥${amount} ${desc}`,
                amount: amount,
                desc: desc
            });

            this.app.phoneShell.showNotification('转账成功', `已向${this.app.currentChat.name}转账¥${amount}`, '✅');

            // 🔥 如果开启在线模式，触发连发倒计时
            if (this.isOnlineMode()) {
                this._enqueuePendingChat(this.app.currentChat.id);
            }

            setTimeout(() => this.app.render(), 1000);
        });
    }

    selectPhoto() {
        const input = document.getElementById('photo-upload-input');
        if (!input) {
            console.error('找不到文件上传input');
            return;
        }

        // 点击隐藏的input，触发相册选择
        input.click();
    }

    // 🔥 拍照功能
    takePhoto() {
        const input = document.getElementById('camera-upload-input');
        if (!input) {
            console.error('找不到拍照input');
            return;
        }

        // 点击隐藏的input，触发摄像头
        input.click();
    }

    showAvatarSettings(chat) {
        // 🔥 不用弹窗，在手机内部显示设置页面
        const html = `
        <div class="wechat-app">
            <div class="wechat-header">
                <div class="wechat-header-left">
                    <button class="wechat-back-btn" id="back-to-chat">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                </div>
                <div class="wechat-header-title">聊天设置</div>
                <div class="wechat-header-right"></div>
            </div>

            <div class="wechat-content" style="background: #ededed;">
                <!-- 头像区域 -->
                <div style="background: #fff; padding: 20px; margin-bottom: 10px;">
                    <div style="text-align: center; margin-bottom: 15px; color: #999; font-size: 13px;">
                        点击头像更换
                    </div>
                    <div id="avatar-preview" style="
                        width: 100px;
                        height: 100px;
                        border-radius: 10px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        margin: 0 auto;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 50px;
                        cursor: pointer;
                        overflow: hidden;
                    ">${this.app.renderAvatar(chat.avatar, '👤', chat.name)}</div>
                    <input type="file" id="avatar-upload" accept="image/png, image/jpeg, image/gif, image/webp, image/*" style="display: none;">
                </div>

                <!-- 备注名 -->
                <div style="background: #fff; padding: 15px 20px; margin-bottom: 10px;">
                    <div style="color: #999; font-size: 13px; margin-bottom: 8px;">备注名</div>
                    <input type="text" id="remark-input" value="${chat.name}"
                           placeholder="设置备注名" style="
                        width: 100%;
                        padding: 10px;
                        border: 1px solid #e5e5e5;
                        border-radius: 6px;
                        font-size: 15px;
                        box-sizing: border-box;
                    ">
                </div>

                <!-- 保存按钮 -->
                <div style="padding: 20px;">
                    <button id="save-chat-settings" style="
                        width: 100%;
                        padding: 12px;
                        background: #07c160;
                        color: #fff;
                        border: none;
                        border-radius: 6px;
                        font-size: 16px;
                        cursor: pointer;
                    ">保存</button>
                </div>

                <!-- 🔥 清空聊天记录按钮 -->
                <div style="padding: 0 20px 20px;">
                    <button id="clear-chat-messages" style="
                        width: 100%;
                        padding: 12px;
                        background: #fff;
                        color: #ff3b30;
                        border: 1px solid #ff3b30;
                        border-radius: 6px;
                        font-size: 16px;
                        cursor: pointer;
                    ">清空聊天记录</button>
                </div>
            </div>
        </div>
    `;

        this.app.phoneShell.setContent(html);

        // 🔥 临时存储新头像
        let newAvatar = null;

        // 绑定事件
        document.getElementById('back-to-chat')?.addEventListener('click', () => {
            this.app.render();
        });

        document.getElementById('avatar-preview')?.addEventListener('click', () => {
            document.getElementById('avatar-upload').click();
        });

        document.getElementById('avatar-upload')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            e.target.value = '';

            if (file.size > 5 * 1024 * 1024) {
                this.app.phoneShell.showNotification('提示', '图片太大，请选择小于5MB的图片', '⚠️');
                return;
            }

            try {
                const cropper = new ImageCropper({
                    title: '裁剪好友头像',
                    aspectRatio: 1,
                    outputWidth: 512,
                    outputHeight: 512,
                    quality: 0.92,
                    maxFileSize: 5 * 1024 * 1024
                });
                const croppedImage = await cropper.open(file);

                const preview = document.getElementById('avatar-preview');
                if (preview) {
                    preview.innerHTML = `<img src="${croppedImage}" style="width:100%;height:100%;object-fit:cover;">`;
                }

                this.app.phoneShell.showNotification('处理中', '正在上传头像...', '⏳');
                newAvatar = await window.VirtualPhone?.imageManager?.uploadDataUrl?.(croppedImage, 'chat_avatar');
                if (!newAvatar) throw new Error('图片上传管理器未初始化');
                this.app.phoneShell.showNotification('成功', '头像已上传', '✅');
            } catch (err) {
                if (String(err?.message || '') === '用户取消') return;
                console.warn('单聊头像上传失败:', err);
                this.app.phoneShell.showNotification('上传失败', err?.message || '头像上传失败', '❌');
            }
        });

        document.getElementById('save-chat-settings')?.addEventListener('click', () => {
            const remark = document.getElementById('remark-input').value.trim();
            if (remark && remark !== chat.name) {
                const oldName = chat.name;
                chat.name = remark;

                // 🔥 同步更新通讯录里的联系人名字
                if (chat.contactId) {
                    this.app.wechatData.updateContact(chat.contactId, { 
                        name: remark, 
                        letter: this.app.wechatData.getFirstLetter(remark) 
                    });
                } else {
                    // 兜底兼容旧数据
                    const contact = this.app.wechatData.getContacts().find(c => c.name === oldName);
                    if (contact) {
                        this.app.wechatData.updateContact(contact.id, { 
                            name: remark, 
                            letter: this.app.wechatData.getFirstLetter(remark) 
                        });
                    }
                }
            }

            // 🔥 如果上传了新头像，同步到所有相关位置
            if (newAvatar) {
                const oldAvatar = String(chat.avatar || '').trim();
                // 使用更可靠的同步方法
                this.app.wechatData.syncAvatarByChat(chat, newAvatar);
                if (oldAvatar && oldAvatar !== newAvatar) {
                    const cleanupTask = window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(oldAvatar, { quiet: true, skipIfReferenced: true });
                    cleanupTask?.catch?.(() => { });
                }
            } else {
                this.app.wechatData.saveData();
            }

            setTimeout(() => this.app.render(), 200);
        });

        // 🔥 清空聊天记录按钮
        document.getElementById('clear-chat-messages')?.addEventListener('click', () => {
            // 显示确认弹窗
            const confirmHtml = `
            <div style="
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999;
            " id="clear-confirm-modal">
                <div style="
                    background: #fff;
                    border-radius: 12px;
                    padding: 20px;
                    width: 280px;
                    text-align: center;
                ">
                    <div style="font-size: 16px; font-weight: 500; margin-bottom: 10px;">确定清空聊天记录？</div>
                    <div style="font-size: 14px; color: #999; margin-bottom: 20px;">此操作不可恢复</div>
                    <div style="display: flex; gap: 10px;">
                        <button id="clear-cancel" style="
                            flex: 1;
                            padding: 10px;
                            background: #f5f5f5;
                            color: #333;
                            border: none;
                            border-radius: 6px;
                            font-size: 15px;
                            cursor: pointer;
                        ">取消</button>
                        <button id="clear-confirm" style="
                            flex: 1;
                            padding: 10px;
                            background: #ff3b30;
                            color: #fff;
                            border: none;
                            border-radius: 6px;
                            font-size: 15px;
                            cursor: pointer;
                        ">清空</button>
                    </div>
                </div>
            </div>
        `;
            document.body.insertAdjacentHTML('beforeend', confirmHtml);

            document.getElementById('clear-cancel')?.addEventListener('click', () => {
                document.getElementById('clear-confirm-modal')?.remove();
            });

            document.getElementById('clear-confirm')?.addEventListener('click', () => {
                // 清空当前聊天的所有消息
                this.app.wechatData.clearMessages(chat.id);
                this._clearPendingStateForChat(chat.id);
                document.getElementById('clear-confirm-modal')?.remove();

                // 🔥🔥🔥 核心修复：通知手机外壳立即刷新左上角状态栏时间
                if (this.app.phoneShell && typeof this.app.phoneShell.updateStatusBarTime === 'function') {
                    this.app.phoneShell.updateStatusBarTime();
                }

                this.app.phoneShell.showNotification('已清空', '聊天记录已清空', '✅');
                setTimeout(() => this.app.render(), 500);
            });
        });
    }

    _setHeaderStatusDot(color = 'green', targetChatId = null) {
        if (targetChatId && (!this.app.currentChat || String(this.app.currentChat.id || '') !== String(targetChatId))) {
            return;
        }

        const dot = document.querySelector('.phone-view-current .wechat-header-title .status-dot')
            || document.querySelector('.wechat-header-title .status-dot');
        if (!dot) return;

        dot.classList.remove('dot-green', 'dot-yellow', 'dot-red');
        if (color === 'red') {
            dot.classList.add('dot-red');
            return;
        }
        if (color === 'yellow') {
            dot.classList.add('dot-yellow');
            return;
        }
        dot.classList.add('dot-green');
    }

    syncHeaderStatusDot(targetChatId = null) {
        this._setHeaderStatusDot(this.getHeaderStatusDotColor(targetChatId), targetChatId);
    }

    showTypingStatus(statusText = '正在输入', targetChatId = null) {
        const text = String(statusText || '').trim();
        if (/等待回复/.test(text)) {
            this._setHeaderStatusDot('yellow', targetChatId);
            return;
        }
        if (/正在输入/.test(text)) {
            this._setHeaderStatusDot('red', targetChatId);
            return;
        }
        this._setHeaderStatusDot('yellow', targetChatId);
    }

    hideTypingStatus(targetChatId = null) {
        this.syncHeaderStatusDot(targetChatId);
    }

    _clearPendingStateForChat(chatId = null) {
        const safeChatId = String(chatId || '').trim();
        if (!safeChatId) return;

        this._dequeuePendingChat(safeChatId);
        if (this.pendingChatIds.size === 0) {
            clearTimeout(this.batchTimer);
        } else {
            this._restartPendingTimerIfNeeded(this.app.currentChat?.id);
        }

        this.syncHeaderStatusDot(safeChatId);
    }
    // 🔧 显示聊天设置菜单
    showChatMenu() {
        const currentChat = this.app.currentChat || {};
        const isGroupChat = currentChat.type === 'group';
        const honeyInjectEnabled = !isGroupChat && this.app.wechatData.isHoneyHistoryInjectionEnabledForChat?.(currentChat.id);
        const profileContextEnabled = isGroupChat || this.app.wechatData.isProfileContextInjectionEnabledForChat?.(currentChat.id) !== false;
        const isBlocked = this._isBlockedSingleChat(currentChat);
        const html = `
            <div class="wechat-app">
                <div class="wechat-header">
                    <div class="wechat-header-left">
                        <button class="wechat-back-btn" id="back-from-menu">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>
                    <div class="wechat-header-title">聊天设置</div>
                    <div class="wechat-header-right"></div>
                </div>
                
                <div class="wechat-content" style="background: #ededed;">
                    <!-- 聊天背景 -->
                    <div style="background: #fff; padding: 15px 20px; margin-bottom: 10px; cursor: pointer;" id="set-bg-btn">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-size: 16px; color: #000;">设置聊天背景</div>
                                <div style="font-size: 12px; color: #999; margin-top: 3px;">更换当前聊天的背景图片</div>
                            </div>
                            <i class="fa-solid fa-chevron-right" style="color: #c8c8c8;"></i>
                        </div>
                    </div>

                    ${!isGroupChat ? `
                    <div style="background: #fff; padding: 15px 20px; margin-bottom: 10px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 14px;">
                            <div style="min-width: 0;">
                                <div style="font-size: 16px; color: #000;">注入角色卡和用户信息</div>
                                <div style="font-size: 12px; color: #999; margin-top: 3px; line-height: 1.35;">关闭后，仅当前好友聊天不再带入角色卡、用户 Persona 和大厅角色/用户资料</div>
                            </div>
                            <label class="toggle-switch" style="flex: 0 0 auto;">
                                <input type="checkbox" id="wechat-profile-context-toggle" ${profileContextEnabled ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>

                    <div style="background: #fff; padding: 15px 20px; margin-bottom: 10px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 14px;">
                            <div style="min-width: 0;">
                                <div style="font-size: 16px; color: #000;">注入蜜语聊天记录</div>
                                <div style="font-size: 12px; color: #999; margin-top: 3px; line-height: 1.35;">开启后，此好友在蜜语直播间互动时会带上当前微信聊天记录</div>
                            </div>
                            <label class="toggle-switch" style="flex: 0 0 auto;">
                                <input type="checkbox" id="wechat-honey-history-toggle" ${honeyInjectEnabled ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                    ` : ''}

                    <!-- 拉黑好友 / 移除黑名单 -->
                    <div style="background: #fff; padding: 15px 20px; margin-bottom: 10px; cursor: pointer;" id="${isBlocked ? 'unblock-contact-btn' : 'block-contact-btn'}">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-size: 16px; color: ${isBlocked ? '#07c160' : '#ff3b30'};">${isBlocked ? '移除黑名单' : '拉黑好友'}</div>
                                ${isBlocked ? '<div style="font-size: 12px; color: #999; margin-top: 3px;">移除后可以重新发送和接收消息</div>' : ''}
                            </div>
                            <i class="fa-solid fa-chevron-right" style="color: #c8c8c8;"></i>
                        </div>
                    </div>

                    <!-- 🔥 清空聊天记录 -->
                    <div style="background: #fff; padding: 15px 20px; margin-top: 10px; cursor: pointer;" id="clear-chat-btn">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div style="font-size: 16px; color: #ff3b30;">清空聊天记录</div>
                            <i class="fa-solid fa-chevron-right" style="color: #c8c8c8;"></i>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html);

        // 返回按钮
        document.getElementById('back-from-menu')?.addEventListener('click', () => {
            this.app.render();
        });

        // 设置背景按钮
        document.getElementById('set-bg-btn')?.addEventListener('click', () => {
            this.showBackgroundPicker();
        });

        document.getElementById('wechat-profile-context-toggle')?.addEventListener('change', (e) => {
            const enabled = !!e.target.checked;
            const ok = this.app.wechatData.setProfileContextInjectionForChat?.(this.app.currentChat?.id, enabled);
            if (ok) {
                this.app.phoneShell.showNotification('微信', enabled ? '已开启角色卡和用户信息注入' : '已关闭此好友的角色卡和用户信息注入', '💬');
            }
        });

        document.getElementById('wechat-honey-history-toggle')?.addEventListener('change', (e) => {
            const enabled = !!e.target.checked;
            const ok = this.app.wechatData.setHoneyHistoryInjectionForChat?.(this.app.currentChat?.id, enabled);
            if (ok) {
                this.app.phoneShell.showNotification('微信', enabled ? '已开启蜜语记录注入' : '已关闭蜜语记录注入', '💬');
            }
        });

        // 拉黑好友按钮
        document.getElementById('block-contact-btn')?.addEventListener('click', () => {
            this.showBlockContactDialog(false);
        });

        document.getElementById('unblock-contact-btn')?.addEventListener('click', () => {
            this.showBlockContactDialog(true);
        });

        // 🔥 清空聊天记录按钮
        document.getElementById('clear-chat-btn')?.addEventListener('click', () => {
            if (confirm('确定清空与「' + this.app.currentChat.name + '」的所有聊天记录？\n\n此操作不可恢复！')) {
                const chatId = this.app.currentChat.id;

                // 🔥 改用底层封装好的 clearMessages 方法，它内置了清空时间缓存的逻辑
                this.app.wechatData.clearMessages(chatId);
                this._clearPendingStateForChat(chatId);

                // 🔥🔥🔥 核心修复：通知手机外壳立即刷新左上角状态栏时间
                if (this.app.phoneShell && typeof this.app.phoneShell.updateStatusBarTime === 'function') {
                    this.app.phoneShell.updateStatusBarTime();
                }

                this.app.phoneShell.showNotification('已清空', '聊天记录已清空', '✅');
                setTimeout(() => this.app.render(), 1000);
            }
        });
    }

    // 🎨 显示背景选择器
    showBackgroundPicker() {
        // 🔥 在这里配置你的本地预设壁纸路径
        // 🔥 在这里配置你的本地预设壁纸路径
        const presetBgs = [
            this.app._getWechatAssetUrl('backgrounds/bg1.png'),
            this.app._getWechatAssetUrl('backgrounds/bg2.png'),
            this.app._getWechatAssetUrl('backgrounds/bg3.png'),
            this.app._getWechatAssetUrl('backgrounds/bg4.png'),
            this.app._getWechatAssetUrl('backgrounds/bg5.png'),
            this.app._getWechatAssetUrl('backgrounds/bg6.png')
        ];

        // 动态生成预设图的HTML
        const presetHtml = presetBgs.map(bg => {
            const style = bg.startsWith('#') 
                ? `background: ${bg}; border: 1px solid #e5e5e5;` 
                : `background-image: url('${bg}'); background-size: cover; background-position: center;`;
            return `<div class="preset-bg" data-bg="${bg}" style="height: 100px; border-radius: 8px; ${style} cursor: pointer; position: relative;"></div>`;
        }).join('');
        const userInfo = this.app.wechatData.getUserInfo?.() || {};
        const listBgActive = String(userInfo.chatListBackground || '').trim();

        const html = `
            <div class="wechat-app">
                <div class="wechat-header">
                    <div class="wechat-header-left">
                        <button class="wechat-back-btn" id="back-from-bg">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>
                    <div class="wechat-header-title">选择背景</div>
                    <div class="wechat-header-right"></div>
                </div>
                
                <div class="wechat-content" style="background: #ededed; padding: 20px;">
                    <!-- 上传自定义背景 -->
                    <div style="background: #fff; border-radius: 10px; padding: 20px; margin-bottom: 15px; text-align: center;">
                        <div style="font-size: 14px; color: #999; margin-bottom: 12px;">上传自定义背景</div>
                        <input type="file" id="bg-upload" accept="image/png, image/jpeg, image/gif, image/webp, image/*" style="display: none;">
                        <button id="upload-bg-btn" style="
                            width: 100%;
                            padding: 12px;
                            background: #ffffff;
                            color: #333;
                            border: 1px solid #d8d8d8;
                            border-radius: 8px;
                            font-size: 14px;
                            font-weight: 500;
                            cursor: pointer;
                        ">
                            <i class="fa-solid fa-upload"></i> 选择图片
                        </button>
                    </div>

                    <!-- 同步到全局微信背景 -->
                    <div style="background: #fff; border-radius: 10px; padding: 20px; margin-bottom: 15px;">
                        <div style="font-size: 14px; color: #999; margin-bottom: 4px;">全局微信背景</div>
                        <div style="font-size: 11px; color: #07c160; margin-bottom: 12px;">
                            当前状态：${listBgActive ? '已设置（微信/通讯录/朋友圈/我 全局同步）' : '未设置'}
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                            <button id="sync-current-bg-to-chatlist" style="
                                width: 100%;
                                padding: 10px;
                                background: #ffffff;
                                color: #333;
                                border: 1px solid #d8d8d8;
                                border-radius: 8px;
                                font-size: 13px;
                                font-weight: 500;
                                cursor: pointer;
                            ">同步全局微信背景</button>
                            <button id="clear-chatlist-bg" style="
                                width: 100%;
                                padding: 10px;
                                background: #ffffff;
                                color: #333;
                                border: 1px solid #d8d8d8;
                                border-radius: 8px;
                                font-size: 13px;
                                font-weight: 500;
                                cursor: pointer;
                            ">清除全局背景</button>
                        </div>
                    </div>
                    
                    <!-- 预设背景 -->
                    <div style="background: #fff; border-radius: 10px; padding: 20px;">
                        <div style="font-size: 14px; color: #999; margin-bottom: 4px;">预设背景</div>
                        <div style="font-size: 11px; color: #07c160; margin-bottom: 15px;">💡 短按设为当前聊天，长按设为全局默认</div>
                        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                            ${presetHtml}
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html);

        // 返回按钮
        document.getElementById('back-from-bg')?.addEventListener('click', () => {
            this.showChatMenu();
        });

        // 上传背景按钮
        document.getElementById('upload-bg-btn')?.addEventListener('click', () => {
            document.getElementById('bg-upload').click();
        });

        const tryCleanupOldListBg = (oldBg, keepSet = new Set()) => {
            const oldValue = String(oldBg || '').trim();
            if (!oldValue) return;
            if (keepSet.has(oldValue)) return;
            const cleanupTask = window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(oldValue, { quiet: true });
            cleanupTask?.catch?.(() => { });
        };

        document.getElementById('sync-current-bg-to-chatlist')?.addEventListener('click', () => {
            const latestUserInfo = this.app.wechatData.getUserInfo?.() || {};
            const sourceBg = String(this.app.currentChat?.background || latestUserInfo.globalChatBackground || '').trim();
            if (!sourceBg) {
                this.app.phoneShell.showNotification('提示', '当前没有可同步的聊天背景', '⚠️');
                return;
            }

            const oldListBg = String(latestUserInfo.chatListBackground || '').trim();
            this.app.wechatData.setChatListBackground(sourceBg);

            if (oldListBg && oldListBg !== sourceBg) {
                const keepSet = new Set([
                    sourceBg,
                    String(this.app.currentChat?.background || '').trim(),
                    String(latestUserInfo.globalChatBackground || '').trim(),
                    String(latestUserInfo.momentsBackground || '').trim()
                ].filter(Boolean));
                tryCleanupOldListBg(oldListBg, keepSet);
            }

            this.app.phoneShell.showNotification('设置成功', '全局微信背景已同步', '✅');
            setTimeout(() => this.app.render(), 320);
        });

        document.getElementById('clear-chatlist-bg')?.addEventListener('click', () => {
            const latestUserInfo = this.app.wechatData.getUserInfo?.() || {};
            const oldListBg = String(latestUserInfo.chatListBackground || '').trim();
            const oldGlobalBg = String(latestUserInfo.globalChatBackground || '').trim();
            if (!oldListBg && !oldGlobalBg) {
                this.app.phoneShell.showNotification('提示', '当前未设置全局微信背景', 'ℹ️');
                return;
            }

            this.app.wechatData.setChatListBackground(null);
            this.app.wechatData.setGlobalChatBackground(null);
            const keepSet = new Set([
                String(this.app.currentChat?.background || '').trim(),
                String(latestUserInfo.momentsBackground || '').trim()
            ].filter(Boolean));
            tryCleanupOldListBg(oldListBg, keepSet);
            if (oldGlobalBg && oldGlobalBg !== oldListBg) {
                tryCleanupOldListBg(oldGlobalBg, keepSet);
            }

            this.app.phoneShell.showNotification('已清除', '全局微信背景和聊天默认背景已恢复默认', '✅');
            setTimeout(() => this.app.render(), 320);
        });

        // 上传背景 - 支持裁剪
        document.getElementById('bg-upload')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            e.target.value = '';

            try {
                const cropper = new ImageCropper({
                    title: '裁剪聊天背景',
                    outputWidth: 1080,
                    outputHeight: 1920,
                    quality: 0.9,
                    maxFileSize: 5 * 1024 * 1024
                });

                const croppedImage = await cropper.open(file);

                const finalUrl = await window.VirtualPhone?.imageManager?.uploadDataUrl?.(croppedImage, 'chatbg');
                if (!finalUrl) throw new Error('图片上传管理器未初始化');
                const imageManager = window.VirtualPhone?.imageManager;

                // 🔥 提示用户：全局还是局部？
                const isGlobal = confirm("上传成功！\n\n点击【确定】将此图片设为「全局微信背景」\n点击【取消】仅设为「当前聊天背景」");
                if (isGlobal) {
                    const latestUserInfo = this.app.wechatData.getUserInfo?.() || {};
                    const oldGlobalBg = String(latestUserInfo.globalChatBackground || '').trim();
                    const oldListBg = String(latestUserInfo.chatListBackground || '').trim();
                    this.app.wechatData.setGlobalChatBackground(finalUrl);
                    this.app.wechatData.setChatListBackground(finalUrl);
                    // 清空当前聊天的独立背景，让它跟随全局
                    this.app.wechatData.setChatBackground(this.app.currentChat.id, null); 
                    if (oldGlobalBg && oldGlobalBg !== finalUrl) {
                        const cleanupTask = imageManager?.deleteManagedBackgroundByPath?.(oldGlobalBg, { quiet: true, skipIfReferenced: true });
                        cleanupTask?.catch?.(() => { });
                    }
                    if (oldListBg && oldListBg !== finalUrl && oldListBg !== oldGlobalBg) {
                        const cleanupTask = imageManager?.deleteManagedBackgroundByPath?.(oldListBg, { quiet: true, skipIfReferenced: true });
                        cleanupTask?.catch?.(() => { });
                    }
                    this.app.phoneShell.showNotification('设置成功', '全局微信背景已更新', '✅');
                } else {
                    const oldChatBg = String(this.app.currentChat?.background || '').trim();
                    this.app.wechatData.setChatBackground(this.app.currentChat.id, finalUrl);
                    if (oldChatBg && oldChatBg !== finalUrl) {
                        const cleanupTask = imageManager?.deleteManagedBackgroundByPath?.(oldChatBg, { quiet: true, skipIfReferenced: true });
                        cleanupTask?.catch?.(() => { });
                    }
                    this.app.phoneShell.showNotification('设置成功', '当前聊天背景已更新', '✅');
                }
                
                setTimeout(() => this.app.render(), 500);
            } catch (error) {
                if (error.message !== '用户取消') {
                    this.app.phoneShell.showNotification('上传失败', error.message, '❌');
                }
            }
        });

        // 🔥 预设背景点击/长按事件绑定
        document.querySelectorAll('.preset-bg').forEach(item => {
            const bg = item.dataset.bg;
            let pressTimer;
            let isLongPress = false;

            const startPress = () => {
                isLongPress = false;
                pressTimer = setTimeout(() => {
                    isLongPress = true;
                    // 长按逻辑：设置为全局
                    this.app.wechatData.setGlobalChatBackground(bg);
                    this.app.wechatData.setChatListBackground(bg);
                    // 清空当前聊天的局部设置，跟随全局
                    this.app.wechatData.setChatBackground(this.app.currentChat.id, null);
                    this.app.phoneShell.showNotification('设置成功', '已设为全局微信背景', '✅');
                    
                    // 触觉反馈（如果设备支持）
                    if (navigator.vibrate) navigator.vibrate(50);
                    
                    setTimeout(() => this.app.render(), 800);
                }, 600); // 600毫秒触发长按
            };

            const endPress = (e) => {
                clearTimeout(pressTimer);
                if (!isLongPress) {
                    // 短按逻辑：设置为当前聊天
                    this.app.wechatData.setChatBackground(this.app.currentChat.id, bg);
                    this.app.phoneShell.showNotification('设置成功', '当前聊天背景已更新', '✅');
                    setTimeout(() => this.app.render(), 800);
                }
            };

            // 电脑端鼠标事件
            item.addEventListener('mousedown', startPress);
            item.addEventListener('mouseup', endPress);
            item.addEventListener('mouseleave', () => clearTimeout(pressTimer));

            // 手机端触摸事件
            item.addEventListener('touchstart', (e) => {
                // e.preventDefault(); // 不要阻止默认事件，否则无法滚动
                startPress();
            }, { passive: true });
            item.addEventListener('touchend', endPress);
            item.addEventListener('touchmove', () => clearTimeout(pressTimer));
            
            // 屏蔽右键菜单，防止长按时跳出浏览器菜单
            item.addEventListener('contextmenu', e => { e.preventDefault(); });
        });
    }

    showMessageMenu(messageIndex) {
        const currentView = this.getCurrentWechatView();
        const messagesDiv = currentView?.querySelector('#chat-messages');
        if (!messagesDiv) return;

        // 🔥 核心修复：打开新菜单前，先解绑上一轮全局关闭监听，避免事件泄露（闪烁元凶）
        if (typeof this._activeCloseMenu === 'function') {
            document.removeEventListener('click', this._activeCloseMenu);
            document.removeEventListener('touchend', this._activeCloseMenu);
            this._activeCloseMenu = null;
        }
        if (typeof this._activeTimeMarkerCloseMenu === 'function') {
            document.removeEventListener('click', this._activeTimeMarkerCloseMenu);
            document.removeEventListener('touchend', this._activeTimeMarkerCloseMenu);
            this._activeTimeMarkerCloseMenu = null;
        }

        const messages = this.app.wechatData.getMessages(this.app.currentChat.id);
        const message = messages[messageIndex];
        if (!message) return;

        // 移除当前视图旧菜单
        currentView.querySelectorAll('.message-action-menu, .wechat-time-marker-menu').forEach(menu => menu.remove());

        // 获取消息元素并判断对齐方向。优先用 message id 定位，避免隐藏/过滤消息导致 DOM 顺序和数据下标偏移。
        const messageId = String(message?.id || '').trim();
        const allMessageElements = Array.from(messagesDiv.querySelectorAll('.chat-message'));
        const messageElement = messageId
            ? allMessageElements.find(el => String(el?.dataset?.messageId || '').trim() === messageId)
            || allMessageElements.find(el => Number.parseInt(el?.dataset?.messageIndex || '', 10) === messageIndex)
            : allMessageElements.find(el => Number.parseInt(el?.dataset?.messageIndex || '', 10) === messageIndex)
            || allMessageElements[messageIndex];
        if (!messageElement) return;

        const isRight = messageElement.classList.contains('message-right');

        // 找到消息内容区域
        const contentEl = messageElement.querySelector('.message-content');
        if (!contentEl) return;

        // 找到气泡元素（包括图片）
        const bubbleEl = contentEl.querySelector('.message-text, .message-voice, .message-redpacket, .message-image-box, .message-transfer, .message-location, .message-call-record, .message-call-text, .message-sticker-box, .message-weibo-card, .message-poker-card, .message-werewolf-card, .message-music-card, .message-music-listen-card');
        if (!bubbleEl) return;

        // 设置气泡为相对定位（用于菜单绝对定位的参考）
        bubbleEl.style.position = 'relative';
        // 🔥 核心修复：防止红包、转账的 overflow: hidden 将弹出的菜单裁切掉
        bubbleEl.style.setProperty('overflow', 'visible', 'important');

        const isTextMessage = message.type === 'text' || !message.type;
        const isLocationMessage = message.type === 'location';
        const isImageMessage = message.type === 'image';
        const isSystemMessage = message.type === 'system';
        const hasCallTranscript = message.type === 'call_record'
            && message.status === 'answered'
            && Array.isArray(message.transcript)
            && message.transcript.length > 0;

        // 系统消息不显示菜单
        if (isSystemMessage) return;

        let buttonsHtml = '';

        if (isTextMessage || isLocationMessage) {
            buttonsHtml += `<button class="msg-action-btn" data-action="edit" data-index="${messageIndex}" data-message-id="${this._escapeHtml(messageId)}" style="background: transparent; color: #333; border: none; border-right: 0.5px solid rgba(0,0,0,0.08); padding: 4px 8px; font-size: 11px; cursor: pointer;">编辑</button>`;
        }
        buttonsHtml += `<button class="msg-action-btn" data-action="multi-select" data-index="${messageIndex}" data-message-id="${this._escapeHtml(messageId)}" style="background: transparent; color: #333; border: none; border-right: 0.5px solid rgba(0,0,0,0.08); padding: 4px 8px; font-size: 11px; cursor: pointer;">多选</button>`;
        if (isTextMessage || isImageMessage) {
            buttonsHtml += `<button class="msg-action-btn" data-action="quote" data-index="${messageIndex}" data-message-id="${this._escapeHtml(messageId)}" style="background: transparent; color: #333; border: none; border-right: 0.5px solid rgba(0,0,0,0.08); padding: 4px 8px; font-size: 11px; cursor: pointer;">引用</button>`;
        }
        if (hasCallTranscript) {
            buttonsHtml += `<button class="msg-action-btn" data-action="view" data-index="${messageIndex}" data-message-id="${this._escapeHtml(messageId)}" style="background: transparent; color: #333; border: none; border-right: 0.5px solid rgba(0,0,0,0.08); padding: 4px 8px; font-size: 11px; cursor: pointer;">查看</button>`;
        }
        buttonsHtml += `<button class="msg-action-btn" data-action="recall" data-index="${messageIndex}" data-message-id="${this._escapeHtml(messageId)}" style="background: transparent; color: #333; border: none; border-right: 0.5px solid rgba(0,0,0,0.08); padding: 4px 8px; font-size: 11px; cursor: pointer;">撤回</button>`;
        buttonsHtml += `<button class="msg-action-btn" data-action="delete" data-index="${messageIndex}" data-message-id="${this._escapeHtml(messageId)}" style="background: transparent; color: #ff3b30; border: none; padding: 4px 8px; font-size: 11px; cursor: pointer;">删除</button>`;

        const menuEl = document.createElement('div');
        menuEl.className = 'message-action-menu';
        menuEl.style.cssText = `
            position: absolute;
            bottom: 100%;
            ${isRight ? 'right: 0;' : 'left: 0;'}
            margin-bottom: 2px;
            z-index: 100;
        `;
        menuEl.innerHTML = `
            <div style="display: flex; background: rgba(255,255,255,0.9); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border-radius: 4px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.12); white-space: nowrap;">
                ${buttonsHtml}
            </div>
        `;

        bubbleEl.insertBefore(menuEl, bubbleEl.firstChild);

        // 🔥 定义统一的菜单清理函数，彻底切断内存泄漏
        const cleanupMenu = () => {
            currentView.querySelectorAll('.message-action-menu').forEach(m => m.remove());
            if (bubbleEl) bubbleEl.style.removeProperty('overflow');
            if (typeof this._activeCloseMenu === 'function') {
                document.removeEventListener('click', this._activeCloseMenu);
                document.removeEventListener('touchend', this._activeCloseMenu);
                this._activeCloseMenu = null;
            }
        };

        // 按钮点击事件
        menuEl.querySelectorAll('.msg-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const index = parseInt(btn.dataset.index);
                const actionMessageId = String(btn.dataset.messageId || '').trim();
                const messages = this.app.wechatData.getMessages(this.app.currentChat.id) || [];
                const resolvedIndex = actionMessageId
                    ? messages.findIndex(msg => String(msg?.id || '').trim() === actionMessageId)
                    : index;
                const safeIndex = resolvedIndex !== -1 ? resolvedIndex : index;

                cleanupMenu(); // 🔥 核心：执行任何操作前，先打扫干净战场！

                if (action === 'delete') {
                    this.deleteMessage(safeIndex, actionMessageId);
                } else if (action === 'edit') {
                    this.editMessage(safeIndex, actionMessageId);
                } else if (action === 'multi-select') {
                    const targetMessage = messages?.[safeIndex];
                    this.enterMessageSelectionMode(targetMessage?.id || null);
                } else if (action === 'recall') {
                    this.recallMessage(safeIndex, actionMessageId);
                } else if (action === 'quote') {
                    this.quoteMessage(safeIndex, actionMessageId);
                } else if (action === 'view') {
                    this.viewCallTranscript(safeIndex, actionMessageId);
                }
            });
        });

        // 外部点击关闭事件
        setTimeout(() => {
            const openedAt = Date.now();
            const closeMenu = (evt) => {
                // 移动端长按后的首个回流点击不关菜单，避免闪现
                if (Date.now() - openedAt < 350) return;
                if (menuEl.contains(evt.target)) return;
                cleanupMenu(); // 点击外侧时打扫战场
            };
            this._activeCloseMenu = closeMenu;
            document.addEventListener('click', closeMenu);
            document.addEventListener('touchend', closeMenu);
        }, 0);
    }

    // 📄 查看通话 transcript（长按菜单 -> 查看）
    viewCallTranscript(messageIndex, messageId = '') {
        const messages = this.app.wechatData.getMessages(this.app.currentChat.id);
        const safeMessageId = String(messageId || '').trim();
        const message = safeMessageId
            ? messages.find(msg => String(msg?.id || '').trim() === safeMessageId)
            : messages[messageIndex];
        if (!message || message.type !== 'call_record') return;

        const transcript = Array.isArray(message.transcript) ? message.transcript : [];
        if (transcript.length === 0) {
            this.app.phoneShell?.showNotification('提示', '该通话没有可查看的记录', 'ℹ️');
            return;
        }

        document.getElementById('wechat-call-transcript-modal')?.remove();

        const userInfo = this.app.wechatData.getUserInfo();
        const userName = userInfo?.name || '我';
        const callTypeName = message.callType === 'video' ? '视频通话' : '语音通话';
        const title = `${callTypeName} · ${message.duration || ''}`.trim();

        const transcriptHtml = transcript.map(item => {
            const from = String(item?.from || '').trim();
            const text = String(item?.text || '').trim();
            if (!text) return '';

            const isMe = from === 'me' || from === userName;
            const speaker = isMe ? userName : from;

            return `
                <div style="display:flex; ${isMe ? 'justify-content:flex-end;' : 'justify-content:flex-start;'} margin-bottom:8px;">
                    <div style="max-width:82%; display:flex; flex-direction:column; ${isMe ? 'align-items:flex-end;' : 'align-items:flex-start;'}">
                        <div style="font-size:10px; color:#888; margin-bottom:2px;">${this._escapeHtml(speaker)}</div>
                        <div style="
                            background:${isMe ? '#95ec69' : '#fff'};
                            color:#222;
                            border-radius:10px;
                            padding:7px 10px;
                            font-size:12px;
                            line-height:1.45;
                            box-shadow:${isMe ? 'none' : '0 1px 2px rgba(0,0,0,0.08)'};
                            word-break:break-word;
                        ">${this._escapeHtml(text)}</div>
                    </div>
                </div>
            `;
        }).join('');

        const html = `
            <div id="wechat-call-transcript-modal" class="wechat-call-transcript-overlay" style="
                position:absolute; inset:0; z-index:9999;
                background:rgba(0,0,0,0.36);
                display:flex; align-items:center; justify-content:center;
                padding:18px 14px;
                box-sizing:border-box;
            ">
                <div class="wechat-call-transcript-panel" style="
                    width:100%; max-width:330px; max-height:78%;
                    background:#f5f5f5;
                    border-radius:14px;
                    box-shadow:0 12px 28px rgba(0,0,0,0.22);
                    overflow:hidden;
                    display:flex; flex-direction:column;
                ">
                    <div style="
                        height:42px; flex-shrink:0;
                        display:flex; align-items:center; justify-content:space-between;
                        padding:0 10px 0 12px;
                        border-bottom:1px solid rgba(0,0,0,0.06);
                        background:#fff;
                    ">
                        <div style="font-size:13px; color:#222; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            ${this._escapeHtml(title)}
                        </div>
                        <button id="wechat-call-transcript-close" style="
                            border:none; background:transparent; color:#666;
                            width:28px; height:28px; border-radius:6px; cursor:pointer;
                            display:flex; align-items:center; justify-content:center;
                        ">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div class="wechat-call-transcript-body" style="
                        flex:1; overflow-y:auto; overflow-x:hidden;
                        -webkit-overflow-scrolling:touch;
                        padding:10px 10px 12px;
                        box-sizing:border-box;
                    ">
                        ${transcriptHtml || '<div style="font-size:12px;color:#999;text-align:center;padding:14px 0;">暂无内容</div>'}
                    </div>
                </div>
            </div>
        `;

        const host = document.querySelector('.phone-view-current') || document.body;
        host.insertAdjacentHTML('beforeend', html);

        const close = () => {
            document.getElementById('wechat-call-transcript-modal')?.remove();
        };
        document.getElementById('wechat-call-transcript-close')?.addEventListener('click', close);
        document.getElementById('wechat-call-transcript-modal')?.addEventListener('click', (e) => {
            if (e.target?.id === 'wechat-call-transcript-modal') close();
        });
    }

    // 🗑️ 删除消息
    deleteMessage(messageIndex, messageId = '') {
        // 直接删除，不需要确认（因为已经是长按操作了）
        const chatId = this.app.currentChat.id;
        const messages = this.app.wechatData.getMessages(chatId) || [];
        const safeMessageId = String(messageId || '').trim();
        const resolvedIndex = safeMessageId
            ? messages.findIndex(msg => String(msg?.id || '').trim() === safeMessageId)
            : messageIndex;
        const safeIndex = resolvedIndex !== -1 ? resolvedIndex : messageIndex;
        if (!messages[safeIndex]) return;

        const deletedImageUrls = this._collectManagedWechatGeneratedImages(messages[safeIndex]);
        this.app.wechatData.deleteMessage(chatId, safeIndex);
        this._cleanupWechatGeneratedImages(deletedImageUrls);

        // 🔥 局部刷新：只更新消息列表，不重绘整个界面
        this._refreshCurrentChatMessages({ keepScroll: true });

        // 🔥🔥🔥 核心修复：通知手机外壳立即刷新左上角状态栏时间
        if (this.app.phoneShell && typeof this.app.phoneShell.updateStatusBarTime === 'function') {
            this.app.phoneShell.updateStatusBarTime();
        }
    }

    deleteManualTimeMarker(messageIndex, messageId = '') {
        const chatId = String(this.app?.currentChat?.id || '').trim();
        if (!chatId) return;

        const messages = this.app.wechatData.getMessages(chatId) || [];
        const safeMessageId = String(messageId || '').trim();
        const resolvedIndex = safeMessageId
            ? messages.findIndex(msg => String(msg?.id || '').trim() === safeMessageId)
            : messageIndex;
        const safeIndex = resolvedIndex !== -1 ? resolvedIndex : messageIndex;
        const marker = messages[safeIndex];
        if (!marker || !(marker?.isTimeMarker === true || marker?.type === 'time_marker')) return;

        this.app.wechatData.deleteMessage(chatId, safeIndex);
        this._refreshCurrentChatMessages({ keepScroll: true });

        this.app.phoneShell?.updateStatusBarTime?.();
        window.VirtualPhone?.home?.render?.({ forceDomRefresh: true });
        this.app.phoneShell?.showNotification?.('已删除', '时间推进已删除', '✅');
    }

    // 🔄 撤回消息
    recallMessage(messageIndex, messageId = '') {
        const messages = this.app.wechatData.getMessages(this.app.currentChat.id);
        const safeMessageId = String(messageId || '').trim();
        const message = safeMessageId
            ? messages.find(msg => String(msg?.id || '').trim() === safeMessageId)
            : messages[messageIndex];
        if (!message) return;

        // 获取发送者名字
        const userInfo = this.app.wechatData.getUserInfo();
        const isMe = message.from === 'me' || message.from === userInfo.name;
        const senderName = isMe ? (userInfo.name || '你') : message.from;

        // 将消息替换为系统消息
        message.type = 'system';
        message.from = 'system';
        message.content = `"${senderName}"撤回了一条消息`;

        // 保存数据
        this.app.wechatData.saveData();

        // 🔥 局部刷新：只更新消息列表，不重绘整个界面
        const currentView = this.getCurrentWechatView();
        const messagesDiv = currentView?.querySelector('#chat-messages');
        if (messagesDiv) {
            const updatedMessages = this.app.wechatData.getMessages(this.app.currentChat.id);
            messagesDiv.innerHTML = this.renderMessagesWithDateDividers(updatedMessages, userInfo);
            // 🔥 重新绑定长按事件
            this.bindMessageLongPressEvents();
            this.bindManualTimeMarkerEvents();
        }
    }

    // 💬 引用消息
    quoteMessage(messageIndex, messageId = '') {
        const messages = this.app.wechatData.getMessages(this.app.currentChat.id);
        const safeMessageId = String(messageId || '').trim();
        const message = safeMessageId
            ? messages.find(msg => String(msg?.id || '').trim() === safeMessageId)
            : messages[messageIndex];
        if (!message || message.type === 'system') return;

        // 获取发送者名字
        const userInfo = this.app.wechatData.getUserInfo();
        const isMe = message.from === 'me' || message.from === userInfo.name;
        const sender = isMe ? (userInfo.name || '我') : (message.from || this.app.currentChat.name);

        // 获取消息内容（截取前50个字符）
        let content = message.content || '';
        if (content.length > 50) {
            content = content.substring(0, 50) + '...';
        }

        // 设置当前引用
        this.activeQuote = {
            sender,
            content
        };
        this.app.render();

        // 聚焦输入框
        setTimeout(() => {
            const input = document.querySelector('.chat-input');
            if (input) input.focus();
        }, 100);
    }

    // ✏️ 编辑消息（直接在气泡上编辑）
    editMessage(messageIndex, messageId = '') {
        const messages = this.app.wechatData.getMessages(this.app.currentChat.id);
        const safeMessageId = String(messageId || '').trim();
        const resolvedIndex = safeMessageId
            ? messages.findIndex(msg => String(msg?.id || '').trim() === safeMessageId)
            : messageIndex;
        const safeIndex = resolvedIndex !== -1 ? resolvedIndex : messageIndex;
        const message = messages[safeIndex];
        if (!message) return;

        // 🔥 找到对应的消息气泡
        const currentView = this.getCurrentWechatView();
        const messagesDiv = currentView?.querySelector('#chat-messages');
        if (!messagesDiv) return;
        const targetMessageId = String(message?.id || '').trim();
        const messageElements = Array.from(messagesDiv.querySelectorAll('.chat-message'));
        const messageEl = targetMessageId
            ? messageElements.find(el => String(el?.dataset?.messageId || '').trim() === targetMessageId)
            || messageElements.find(el => Number.parseInt(el?.dataset?.messageIndex || '', 10) === safeIndex)
            : messageElements.find(el => Number.parseInt(el?.dataset?.messageIndex || '', 10) === safeIndex)
            || messageElements[safeIndex];
        if (!messageEl) return;

        const textEl = messageEl.querySelector('.message-text, .message-location');
        if (!textEl) return;
        this._setMessageInlineEditMode(true, this.app.currentChat?.id);

        // 保存原始内容
        const isCallRecord = message.type === 'call_record';
        const isLocationMessage = message.type === 'location';
        let originalContent;
        if (isCallRecord) {
            // 将 transcript 数组格式化为可编辑文本
            const userInfo = this.app.wechatData.getUserInfo();
            const userName = userInfo?.name || '我';
            originalContent = (message.transcript || []).map(t => {
                const speaker = t.from === 'me' ? userName : t.from;
                return `${speaker}: ${t.text}`;
            }).join('\n') || '';
        } else {
            originalContent = message.content;
        }
        const isRight = messageEl.classList.contains('message-right');

        // 🔥 将气泡替换为编辑框
        textEl.innerHTML = `
            <textarea class="inline-edit-input" style="
                width: 100%;
                min-height: 40px;
                max-height: 150px;
                padding: 8px;
                border: none;
                border-radius: 6px;
                font-size: 15px;
                line-height: 1.5;
                resize: none;
                background: ${isLocationMessage ? '#fff' : (isRight ? '#95ec69' : '#fff')};
                color: #000;
                outline: none;
                font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                box-sizing: border-box;
            ">${originalContent}</textarea>
            <div class="inline-edit-actions" style="
                display: flex;
                justify-content: flex-end;
                gap: 8px;
                margin-top: 6px;
            ">
                <button class="inline-edit-cancel" style="
                    padding: 4px 10px;
                    background: #f0f0f0;
                    color: #666;
                    border: none;
                    border-radius: 4px;
                    font-size: 12px;
                    cursor: pointer;
                ">取消</button>
                <button class="inline-edit-save" style="
                    padding: 4px 10px;
                    background: #07c160;
                    color: #fff;
                    border: none;
                    border-radius: 4px;
                    font-size: 12px;
                    cursor: pointer;
                ">保存</button>
            </div>
        `;

       // 自动聚焦并选中文本
        const textarea = textEl.querySelector('.inline-edit-input');
        if (textarea) {
            textarea.focus();
            textarea.select();
            
            // 🛡️ 核心护盾：阻止键盘和输入事件冒泡给酒馆，防止 AutoComplete 插件报错崩溃
            textarea.addEventListener('input', (ev) => ev.stopPropagation());
            textarea.addEventListener('keydown', (ev) => ev.stopPropagation());
            textarea.addEventListener('keyup', (ev) => ev.stopPropagation());
            textarea.addEventListener('focus', (ev) => ev.stopPropagation());
            textarea.addEventListener('blur', (ev) => ev.stopPropagation());
        }

        // 自动调整高度
        const adjustHeight = () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
        };
        textarea?.addEventListener('input', adjustHeight);
        adjustHeight();

        const finishInlineEditAndRefresh = () => {
            const view = this.getCurrentWechatView();
            const scopedMessagesDiv = view?.querySelector('#chat-messages');
            if (scopedMessagesDiv) {
                const latestMessages = this.app.wechatData.getMessages(this.app.currentChat.id);
                const userInfo = this.app.wechatData.getUserInfo();
                scopedMessagesDiv.innerHTML = this.renderMessagesWithDateDividers(latestMessages, userInfo);
                this.bindMessageLongPressEvents();
            }
            setTimeout(() => this._setMessageInlineEditMode(false, this.app.currentChat?.id), 0);
        };

        // 取消按钮
        textEl.querySelector('.inline-edit-cancel')?.addEventListener('click', (e) => {
            e.stopPropagation();
            finishInlineEditAndRefresh();
        });

        // 保存按钮
        textEl.querySelector('.inline-edit-save')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const newContent = textarea.value.trim();
            if (newContent) {
                if (isCallRecord) {
                    this._saveCallRecordTranscript(safeIndex, newContent);
                } else {
                    this.app.wechatData.editMessage(this.app.currentChat.id, safeIndex, newContent);
                }
                finishInlineEditAndRefresh();
                this.app.phoneShell.showNotification('已修改', '消息已更新', '✅');
            }
        });

        // 按 Enter 保存，Escape 取消
        textarea?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const newContent = textarea.value.trim();
                if (newContent) {
                    if (isCallRecord) {
                        this._saveCallRecordTranscript(safeIndex, newContent);
                    } else {
                        this.app.wechatData.editMessage(this.app.currentChat.id, safeIndex, newContent);
                    }
                    finishInlineEditAndRefresh();
                    this.app.phoneShell.showNotification('已修改', '消息已更新', '✅');
                }
            } else if (e.key === 'Escape') {
                finishInlineEditAndRefresh();
            }
        });
    }

    // 🔥 保存 call_record 的 transcript 编辑结果
    _saveCallRecordTranscript(messageIndex, textContent) {
        const messages = this.app.wechatData.getMessages(this.app.currentChat.id);
        const message = messages[messageIndex];
        if (!message) return;

        const userInfo = this.app.wechatData.getUserInfo();
        const userName = userInfo?.name || '我';

        // 将文本按行解析回 {from, text} 数组
        const transcript = textContent.split('\n').filter(l => l.trim()).map(line => {
            const colonIdx = line.indexOf(':');
            const colonIdx2 = line.indexOf('：');
            const idx = colonIdx === -1 ? colonIdx2 : (colonIdx2 === -1 ? colonIdx : Math.min(colonIdx, colonIdx2));
            if (idx > 0) {
                const speaker = line.substring(0, idx).trim();
                const text = line.substring(idx + 1).trim();
                return { from: speaker === userName ? 'me' : speaker, text };
            }
            return { from: 'me', text: line.trim() };
        });

        message.transcript = transcript;
        this.app.wechatData._messagesDirty[this.app.currentChat.id] = true;
        this.app.wechatData.saveData();
    }

    // 🔄 重新生成最后的AI消息
    async regenerateLastAIMessage() {
        if (!this.isOnlineMode()) {
            this.app.phoneShell?.showNotification('提示', '请先开启在线模式', '⚠️');
            return;
        }

        const messages = this.app.wechatData.getMessages(this.app.currentChat.id);
        if (messages.length === 0) {
            this.app.phoneShell?.showNotification('提示', '没有记录可重新生成', '⚠️');
            return;
        }

        const currentChatId = this.app.currentChat.id;
        const userInfo = this.app.wechatData.getUserInfo();
        const isMyMessage = (msg) => !!msg && (msg.from === 'me' || msg.from === userInfo.name);
        const deletableIndexes = [];
        const tailMessage = messages[messages.length - 1];
        const tailBatchId = String(tailMessage?.replyBatchId || '').trim();

        // 优先按上一轮 AI 批次精确回滚，适配“一次连发多条”
        if (tailBatchId && !isMyMessage(tailMessage)) {
            for (let i = messages.length - 1; i >= 0; i--) {
                const msg = messages[i];
                if (String(msg?.replyBatchId || '').trim() !== tailBatchId) break;
                deletableIndexes.push(i);
            }
        }

        // 兼容旧消息：没有批次标记时，回退到“删掉最后一条用户消息之后的连续回复”
        if (deletableIndexes.length === 0) {
            let lastUserMessageIndex = -1;

            for (let i = messages.length - 1; i >= 0; i--) {
                if (isMyMessage(messages[i])) {
                    lastUserMessageIndex = i;
                    break;
                }
            }

            if (lastUserMessageIndex !== -1) {
                for (let i = messages.length - 1; i > lastUserMessageIndex; i--) {
                    if (isMyMessage(messages[i])) break;
                    deletableIndexes.push(i);
                }
            } else {
                deletableIndexes.push(messages.length - 1);
            }
        }

        if (deletableIndexes.length === 0) {
            this.app.phoneShell?.showNotification('提示', '上一轮没有可撤销的 AI 回复', '⚠️');
            return;
        }

        deletableIndexes.sort((a, b) => b - a).forEach((index) => {
            this.app.wechatData.deleteMessage(currentChatId, index);
        });

        const updatedMessages = this.app.wechatData.getMessages(currentChatId);
        const currentView = document.querySelector('.phone-view-current .wechat-app');
        if (currentView && this.app.currentChat?.id === currentChatId) {
            const messagesDiv = this._getVisibleChatMessagesContainer(currentChatId);
            if (messagesDiv) {
                this.smartUpdateMessages(updatedMessages, userInfo, { chatId: currentChatId });
            } else {
                this.app.render();
            }
        } else {
            this.app.render();
        }

        // 🔥🔥🔥 通知手机外壳立即刷新左上角状态栏时间
        if (this.app.phoneShell && typeof this.app.phoneShell.updateStatusBarTime === 'function') {
            this.app.phoneShell.updateStatusBarTime();
        }

        // 🔥 重新发送请求
        this._enqueuePendingChat(currentChatId, {
            shouldStartTimer: false,
            shouldShowStatus: true
        });
        await this.triggerAI(currentChatId);
    }

    // 📋 显示删除聊天确认界面
    showDeleteConfirm() {
        const html = `
            <div class="wechat-app">
                <div class="wechat-header">
                    <div class="wechat-header-left">
                        <button class="wechat-back-btn" id="back-from-delete">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>
                    <div class="wechat-header-title">删除聊天</div>
                    <div class="wechat-header-right"></div>
                </div>
                
                <div class="wechat-content" style="background: #ededed; padding: 20px;">
                    <div style="background: #fff; border-radius: 12px; padding: 30px; text-align: center;">
                        <i class="fa-solid fa-trash" style="font-size: 48px; color: #ff3b30; margin-bottom: 20px;"></i>
                        <div style="font-size: 18px; font-weight: 600; color: #000; margin-bottom: 10px;">确定要删除这个聊天吗？</div>
                        <div style="font-size: 14px; color: #999; margin-bottom: 30px;">删除后将清空所有聊天记录</div>
                        
                        <button id="confirm-delete" style="
                            width: 100%;
                            padding: 14px;
                            background: #ff3b30;
                            color: #fff;
                            border: none;
                            border-radius: 8px;
                            font-size: 16px;
                            font-weight: 600;
                            cursor: pointer;
                            margin-bottom: 10px;
                        ">确定删除</button>
                        
                        <button id="cancel-delete" style="
                            width: 100%;
                            padding: 14px;
                            background: #f0f0f0;
                            color: #666;
                            border: none;
                            border-radius: 8px;
                            font-size: 16px;
                            cursor: pointer;
                        ">取消</button>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html);

        document.getElementById('back-from-delete')?.addEventListener('click', () => {
            this.showChatMenu();
        });

        document.getElementById('cancel-delete')?.addEventListener('click', () => {
            this.showChatMenu();
        });

        document.getElementById('confirm-delete')?.addEventListener('click', () => {
            this.app.wechatData.deleteChat(this.app.currentChat.id);
            this.app.phoneShell.showNotification('已删除', '聊天已删除', '✅');
            this.app.currentChat = null;
            this.app.currentView = 'chats';
            setTimeout(() => this.app.render(), 1000);
        });
    }

    showBlockContactDialog(isUnblock = false) {
        const chat = this.app.currentChat;
        if (!chat || chat.type === 'group') return;

        const modalId = 'wechat-block-contact-modal';
        document.getElementById(modalId)?.remove();

        const title = isUnblock ? '移除黑名单' : '拉黑好友';
        const message = isUnblock
            ? `将「${chat.name}」移出黑名单？`
            : `确定要拉黑「${chat.name}」吗？`;
        const desc = isUnblock
            ? '移除后可以重新发送和接收消息'
            : '拉黑后将无法收到对方消息';
        const actionText = isUnblock ? '移除' : '拉黑';
        const actionColor = isUnblock ? '#07c160' : '#ff3b30';

        const html = `
            <div id="${modalId}" style="
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.28);
                z-index: 100000;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 18px;
                box-sizing: border-box;
            ">
                <div style="
                    width: min(270px, 100%);
                    background: #fff;
                    border-radius: 14px;
                    overflow: hidden;
                    box-shadow: 0 12px 36px rgba(0,0,0,0.18);
                    text-align: center;
                ">
                    <div style="padding: 22px 18px 16px;">
                        <div style="font-size: 17px; font-weight: 700; color: #111; margin-bottom: 8px;">${title}</div>
                        <div style="font-size: 14px; color: #333; line-height: 1.45; margin-bottom: 6px;">${message}</div>
                        <div style="font-size: 12px; color: #999; line-height: 1.45;">${desc}</div>
                    </div>
                    <button id="wechat-block-dialog-confirm" style="
                        width: 100%;
                        height: 46px;
                        border: none;
                        border-top: 1px solid #eee;
                        background: #fff;
                        color: ${actionColor};
                        font-size: 16px;
                        font-weight: 600;
                        cursor: pointer;
                    ">${actionText}</button>
                    <button id="wechat-block-dialog-cancel" style="
                        width: 100%;
                        height: 46px;
                        border: none;
                        border-top: 1px solid #eee;
                        background: #fff;
                        color: #333;
                        font-size: 16px;
                        cursor: pointer;
                    ">取消</button>
                </div>
            </div>
        `;

        const host = document.querySelector('.phone-view-current') || document.body;
        host.insertAdjacentHTML('beforeend', html);

        const close = () => document.getElementById(modalId)?.remove();
        document.getElementById('wechat-block-dialog-cancel')?.addEventListener('click', close);
        document.getElementById(modalId)?.addEventListener('click', (e) => {
            if (e.target?.id === modalId) close();
        });
        document.getElementById('wechat-block-dialog-confirm')?.addEventListener('click', () => {
            const ok = isUnblock
                ? this.app.wechatData.unblockContact?.(chat.contactId)
                : (this.app.wechatData.blockContact(chat.contactId), true);
            close();
            this.app.phoneShell.showNotification(
                ok ? (isUnblock ? '已移除' : '已拉黑') : '操作失败',
                ok ? (isUnblock ? `${chat.name}已移出黑名单` : `${chat.name}已被拉黑`) : '找不到该联系人',
                ok ? '✅' : '❌'
            );
            this.showChatMenu();
        });
    }

    // 📹 视频通话界面（带AI接听/拒绝逻辑）- 白色玻璃风格
    async startVideoCall() {
        // 🔥 关闭更多面板
        this.showMore = false;

        // 🔥 检查在线模式
        if (!this.isOnlineMode()) {
            this.app.phoneShell?.showNotification('离线模式', '请先在设置中开启在线模式才能发起通话', '⚠️');
            return;
        }

        const contact = this.app.currentChat;
        const isGroupCall = contact?.type === 'group';
        const groupParticipantsStrip = isGroupCall ? this._renderGroupCallParticipantsStrip(contact) : '';

        // ========================================
        // 阶段1：呼叫界面 - 白色玻璃风格
        // ========================================
        const callingHtml = `
        <div class="call-fullscreen">
        <div class="wechat-app" style="background: linear-gradient(135deg, #a8edea 0%, #fed6e3 50%, #d299c2 100%); height: 100%; display: flex; flex-direction: column; overflow: hidden;">
            <div class="wechat-header" style="background: rgba(255,255,255,0.3); backdrop-filter: blur(20px); border-bottom: 1px solid rgba(255,255,255,0.3);">
                <div class="wechat-header-left">
                    <!-- 隐藏的返回按钮，用于接管并拦截右滑手势，防止路由迷失直接退回桌面 -->
                    <button class="wechat-back-btn" id="overlay-hidden-back" style="display:none;"></button>
                </div>
                <div class="wechat-header-title" style="color: #333;">${isGroupCall ? '群视频通话' : '视频通话'}</div>
                <div class="wechat-header-right"></div>
            </div>

            <div class="wechat-content" style="flex: 1; background: transparent; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 20px;">
                <div id="call-avatar" class="call-avatar-fix" style="
                    width: 110px;
                    height: 110px;
                    border-radius: 55px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 55px;
                    margin-bottom: 25px;
                    box-shadow: 0 8px 32px rgba(102, 126, 234, 0.4);
                    animation: video-calling-pulse 1.5s ease-in-out infinite;
                    overflow: hidden;
                ">${this.app.renderAvatar(contact.avatar, '👤', contact.name)}</div>

                <div style="font-size: 24px; font-weight: 600; color: #333; margin-bottom: 8px;">
                    ${contact.name}
                </div>
                ${groupParticipantsStrip}

                <div id="call-status" style="font-size: 15px; color: rgba(0,0,0,0.5); margin-bottom: 50px;">
                    ${isGroupCall ? '正在呼叫群成员...' : '正在呼叫...'}
                </div>

                <button id="cancel-call-btn" style="
                    width: 65px;
                    height: 65px;
                    border-radius: 50%;
                    background: #ff3b30;
                    border: none;
                    color: #fff;
                    font-size: 26px;
                    cursor: pointer;
                    box-shadow: 0 6px 20px rgba(255, 59, 48, 0.4);
                ">
                    <i class="fa-solid fa-phone-slash"></i>
                </button>
                <div style="font-size: 12px; color: rgba(0,0,0,0.4); margin-top: 10px;">取消</div>
            </div>
        </div>
        </div>

        <style>
            @keyframes video-calling-pulse {
                0%, 100% {
                    transform: scale(1);
                    box-shadow: 0 8px 32px rgba(102, 126, 234, 0.4);
                }
                50% {
                    transform: scale(1.05);
                    box-shadow: 0 12px 40px rgba(102, 126, 234, 0.6);
                }
            }
            .call-avatar-fix img {
                width: 100% !important;
                height: 100% !important;
                margin: 0 !important;
                border-radius: 50% !important;
            }
            .call-avatar-fix div {
                border-radius: 50% !important;
            }
        </style>
    `;

        this.app.phoneShell.setContent(callingHtml, 'wechat-call-overlay');
        // 拦截右滑返回手势，将其等同于点击挂断/取消/拒绝按钮
        document.getElementById('overlay-hidden-back')?.addEventListener('click', () => {
            const cancelBtn = document.getElementById('cancel-call-btn') || 
                              document.getElementById('video-hangup-btn') || 
                              document.getElementById('voice-hangup-btn') || 
                              document.getElementById('incoming-call-reject-btn');
            if (cancelBtn) cancelBtn.click();
            else this.app.render();
        });

        let isCancelled = false;
        const callAbortController = new AbortController();
        document.getElementById('cancel-call-btn')?.addEventListener('click', () => {
            isCancelled = true;
            callAbortController.abort();
            // 🔥 核心杀招：调用酒馆真实全局停止函数
            if (typeof window.stopGeneration === 'function') {
                window.stopGeneration();
            }
            // 🔥 暴力兜底：强制点击界面的停止按钮
            const stStopBtn = document.getElementById('mes_stop');
            if (stStopBtn) {
                stStopBtn.click();
            }
            this.addCallRecord('video', 'cancelled', '0分0秒');
            this.app.phoneShell.showNotification('已取消', isGroupCall ? '群视频通话已取消' : '视频通话已取消', '📹');
            setTimeout(() => this.app.render(), 500);
        });

        // ========================================
        // 阶段2：AI决策（接听/拒绝）
        // ========================================

        try {
            await new Promise(resolve => setTimeout(resolve, 2000)); // 呼叫2秒

            if (isCancelled) return;

            // 🔥 调用AI决策
            const decision = await this.askAIForCallDecision('video', contact.name);

            // 🔥 等AI思考完返回时，再次检查用户是否已经点击了取消，或者是否已经退出了聊天界面
            if (isCancelled || !this.app.currentChat) return;

            if (decision.action === 'reject') {
                // 拒绝
                const statusDiv = document.getElementById('call-status');
                if (statusDiv) {
                    statusDiv.textContent = isGroupCall ? '群成员未接听' : '对方已拒绝';
                    statusDiv.style.color = '#ff3b30';
                }

                this.addCallRecord('video', 'rejected', '0分0秒');

                setTimeout(() => {
                    this.app.phoneShell.showNotification('通话结束', isGroupCall ? '群成员未接听视频通话' : '对方拒绝了视频通话', '❌');
                    setTimeout(() => this.app.render(), 1000);
                }, 2000);

                return;
            }

            // ========================================
            // 阶段3：接听成功，显示通话界面
            // ========================================

            this.showVideoCallInterface(contact, decision.firstMessage);

        } catch (error) {
            // 🔥 区分中断和其他错误，静默处理中断
            if (isCancelled || error.name === 'AbortError') {
                console.log('✅ 视频通话已取消，静默处理');
            } else {
                console.error('❌ 视频通话失败:', error);
                this.app.phoneShell.showNotification('通话失败', 'API请求失败，请检查网络和在线模式设置', '❌');
                setTimeout(() => this.app.render(), 1000);
            }
        }
    }

    // 🔥 显示视频通话界面（接通后）- 白色玻璃风格
    showVideoCallInterface(contact, aiFirstMessage) {
        // 🔥 记录通话开始的剧情时间
        const timeManager = window.VirtualPhone?.timeManager;
        const callStartTime = timeManager
            ? timeManager.getCurrentStoryTime()
            : { time: '21:30', date: '2044年10月28日' };
        const callStartEpoch = Date.now();
        const isGroupCall = contact?.type === 'group';
        const groupParticipants = this._getGroupChatParticipants(contact);
        const groupParticipantsStrip = isGroupCall ? this._renderGroupCallParticipantsStrip(contact) : '';

        const html = `
        <div class="call-fullscreen">
        <div class="wechat-app" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%); height: 100%; display: flex; flex-direction: column; overflow: hidden;">
            <div class="wechat-header" style="background: rgba(255,255,255,0.25); backdrop-filter: blur(20px); border-bottom: 1px solid rgba(255,255,255,0.2);">
                <div class="wechat-header-left">
                    <!-- 隐藏的返回按钮，用于接管并拦截右滑手势，防止路由迷失直接退回桌面 -->
                    <button class="wechat-back-btn" id="overlay-hidden-back" style="display:none;"></button>
                </div>
                <div class="wechat-header-title" style="color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.2);">
                    <span class="wechat-header-title-text">${contact.name}${isGroupCall ? '<span style="font-size:11px; margin-left:4px; opacity:0.88;">(群视频)</span>' : ''}<span class="status-dot dot-green" id="video-call-status-dot"></span></span>
                </div>
                <div class="wechat-header-right">
                    <span id="video-timer" style="font-size: 13px; color: rgba(255,255,255,0.9);">00:00</span>
                </div>
            </div>

            <div class="wechat-content" style="background: transparent; display: flex; flex-direction: column; overflow: hidden; padding: 0;">

                <!-- 顶部：视频画面区域 -->
                <div style="height: 140px; background: rgba(255,255,255,0.15); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; position: relative; flex-shrink: 0; margin: 10px; border-radius: 16px;">
                    <div style="text-align: center;">
                        <div class="call-avatar-fix" style="
                            width: 70px;
                            height: 70px;
                            border-radius: 50%;
                            background: linear-gradient(135deg, #fff 0%, #f0f0f0 100%);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 35px;
                            margin: 0 auto 8px;
                            box-shadow: 0 4px 15px rgba(0,0,0,0.15);
                            overflow: hidden;
                        ">
                            ${this.app.renderAvatar(contact.avatar, '👤', contact.name)}
                        </div>
                        <div style="font-size: 14px; font-weight: 500; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.2);">${contact.name}</div>
                        ${groupParticipantsStrip}
                    </div>

                    <!-- 小窗口（自己） -->
                    <div class="call-avatar-fix" style="
                        position: absolute;
                        top: 8px;
                        right: 8px;
                        width: 56px;
                        height: 56px;
                        background: rgba(255,255,255,0.9);
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 24px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.15);
                        overflow: hidden;
                    ">
                        ${this.app.renderAvatar(this.app.wechatData.getUserInfo().avatar, '😊', this.app.wechatData.getUserInfo().name)}
                    </div>
                </div>

                <!-- 中间：聊天消息区域 -->
                <div id="video-chat-messages" style="
                    flex: 1;
                    overflow-y: auto;
                    padding: 10px 12px;
                    background: rgba(255,255,255,0.22);
                    margin: 0 10px;
                    border-radius: 12px;
                    border: 1px solid rgba(255,255,255,0.14);
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    min-height: 0;
                    contain: paint;
                    transform: translateZ(0);
                ">
                    <div style="text-align: center; color: rgba(255,255,255,0.6); font-size: 11px; padding: 5px 0;">
                        视频通话中可发送文字
                    </div>
                </div>

                <!-- 底部：输入框和控制按钮 -->
                <div style="background: rgba(255,255,255,0.24); padding: 10px; flex-shrink: 0; margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.16);">
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <button id="video-hangup-btn" style="
                            width: 30px;
                            height: 30px;
                            border-radius: 50%;
                            background: rgba(255,59,48,0.14);
                            border: 1px solid rgba(255,59,48,0.35);
                            color: #ff3b30;
                            cursor: pointer;
                            flex-shrink: 0;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        ">
                            <i class="fa-solid fa-phone-slash" style="font-size: 13px;"></i>
                        </button>
                        <input type="text" id="video-chat-input" placeholder="发送消息..." style="
                            flex: 1;
                            min-width: 0;
                            padding: 8px 18px 8px 12px;
                            border: 1px solid rgba(255,255,255,0.22);
                            border-radius: 18px;
                            background: rgba(255,255,255,0.12);
                            color: #fff;
                            font-size: 13px;
                            outline: none;
                            -webkit-user-select: text;
                            user-select: text;
                            -webkit-touch-callout: default;
                            touch-action: auto;
                        ">
                        <button id="video-send-btn" style="
                            width: 30px;
                            height: 30px;
                            background: rgba(7,193,96,0.14);
                            color: #07c160;
                            border: 1px solid rgba(7,193,96,0.35);
                            border-radius: 50%;
                            cursor: pointer;
                            flex-shrink: 0;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        "><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
                    </div>
                </div>
            </div>
        </div>
        </div>

        <style>
            .call-avatar-fix img {
                width: 100% !important;
                height: 100% !important;
                margin: 0 !important;
                border-radius: 50% !important;
            }
            .call-avatar-fix div {
                border-radius: 50% !important;
            }
            #video-chat-input {
                background: rgba(255,255,255,0.12) !important;
                color: #ffffff !important;
                -webkit-text-fill-color: #ffffff !important;
                caret-color: #ffffff !important;
                border: 1px solid rgba(255,255,255,0.22) !important;
                box-shadow: inset 0 0 0 1000px rgba(255,255,255,0.12) !important;
                filter: none !important;
                opacity: 1 !important;
            }
            #video-chat-input::placeholder {
                color: rgba(255,255,255,0.62) !important;
                -webkit-text-fill-color: rgba(255,255,255,0.62) !important;
            }
        </style>
    `;

        this.app.phoneShell.setContent(html, 'wechat-call-overlay');
        // 拦截右滑返回手势，将其等同于点击挂断/取消/拒绝按钮
        document.getElementById('overlay-hidden-back')?.addEventListener('click', () => {
            const cancelBtn = document.getElementById('cancel-call-btn') || 
                              document.getElementById('video-hangup-btn') || 
                              document.getElementById('voice-hangup-btn') || 
                              document.getElementById('incoming-call-reject-btn');
            if (cancelBtn) cancelBtn.click();
            else this.app.render();
        });

        const setVideoCallStatus = (color = 'green') => {
            const dot = document.getElementById('video-call-status-dot');
            if (!dot) return;
            dot.classList.remove('dot-green', 'dot-yellow', 'dot-red');
            if (color === 'red') {
                dot.classList.add('dot-red');
                return;
            }
            if (color === 'yellow') {
                dot.classList.add('dot-yellow');
                return;
            }
            dot.classList.add('dot-green');
        };

        const getVideoInput = () => document.getElementById('video-chat-input');
        const hardenVideoInputStyle = () => {
            const input = getVideoInput();
            if (!input?.style?.setProperty) return;
            input.style.setProperty('background', 'rgba(255,255,255,0.12)', 'important');
            input.style.setProperty('color', '#ffffff', 'important');
            input.style.setProperty('-webkit-text-fill-color', '#ffffff', 'important');
            input.style.setProperty('caret-color', '#ffffff', 'important');
            input.style.setProperty('border', '1px solid rgba(255,255,255,0.22)', 'important');
            input.style.setProperty('box-shadow', 'inset 0 0 0 1000px rgba(255,255,255,0.12)', 'important');
            input.style.setProperty('filter', 'none', 'important');
            input.style.setProperty('opacity', '1', 'important');
        };
        hardenVideoInputStyle();
        const getVideoMessages = () => document.getElementById('video-chat-messages');

        let videoBatchTimer = null;
        let videoPendingUserLines = [];
        let isVideoSending = false;

        const clearVideoBatchTimer = () => {
            clearTimeout(videoBatchTimer);
            videoBatchTimer = null;
        };

        const restartVideoPendingTimerIfNeeded = () => {
            const input = getVideoInput();
            const text = String(input?.value || '').trim();
            const isEditing = !!input && document.activeElement === input;
            const canRestart = !isEditing && text === '' && videoPendingUserLines.length > 0 && !isVideoSending;
            if (!canRestart) {
                if (isEditing && !isVideoSending) {
                    setVideoCallStatus('green');
                }
                return;
            }
            clearVideoBatchTimer();
            videoBatchTimer = setTimeout(() => {
                triggerVideoAI();
            }, 6000);
            setVideoCallStatus('yellow');
        };

        const getVideoCallTypingDelay = (line) => {
            const length = String(line || '').trim().length;
            return Math.min(2200, 420 + length * 45);
        };

        const renderVideoAiLinesSequentially = async (lines, roundId) => {
            const bubbleMetas = [];
            const renderLines = Array.isArray(lines) ? lines : [];

            for (let i = 0; i < renderLines.length; i++) {
                const messagesDiv = getVideoMessages();
                if (!messagesDiv) break;

                const entry = typeof renderLines[i] === 'string'
                    ? { sender: contact.name, text: String(renderLines[i] || '').trim() }
                    : {
                        sender: String(renderLines[i]?.sender || contact.name).trim() || contact.name,
                        text: String(renderLines[i]?.text || '').trim()
                    };
                if (!entry.text) continue;

                document.getElementById('video-typing-indicator')?.remove();
                const typingHtml = `
                    <div id="video-typing-indicator" style="display: flex; justify-content: flex-start;">
                        <div style="padding: 8px 12px; background: rgba(255,255,255,0.5); color: rgba(0,0,0,0.5); border-radius: 12px; font-size: 12px;">正在输入...</div>
                    </div>
                `;
                messagesDiv.insertAdjacentHTML('beforeend', typingHtml);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;

                await new Promise(resolve => setTimeout(resolve, getVideoCallTypingDelay(entry.text)));
                document.getElementById('video-typing-indicator')?.remove();

                const bubbleId = 'wechat-call-ai-msg-' + Math.random().toString(36).slice(2, 8);
                const senderLabelHtml = isGroupCall
                    ? `<div class="call-msg-sender-label" style="font-size:10px; color:rgba(255,255,255,0.86); margin:0 0 4px 2px;">${this._escapeHtml(entry.sender)}</div>`
                    : '';
                const safeEntryText = this._escapeHtml(entry.text);
                const aiMsgHtml = `
                    <div class="call-msg-row" style="display: flex; justify-content: flex-start;">
                        <div style="max-width: 75%; display:flex; flex-direction:column; align-items:flex-start;">
                            ${senderLabelHtml}
                            <div class="wechat-call-ai-bubble call-msg-bubble" id="${bubbleId}" data-msg-idx="${chatMessages.length}" data-call-type="video" data-round-id="${roundId}" data-sender="${this._escapeHtml(entry.sender)}" data-text="${safeEntryText}" style="max-width: 100%; padding: 8px 12px; background: rgba(255,255,255,0.85); color: #333; border-radius: 12px; font-size: 13px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer; transition: all 0.3s; position: relative;">${safeEntryText}</div>
                        </div>
                    </div>
                `;
                messagesDiv.insertAdjacentHTML('beforeend', aiMsgHtml);
                chatMessages.push({ from: entry.sender, text: entry.text });
                bubbleMetas.push({ id: bubbleId, sender: entry.sender, text: entry.text });
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }

            document.getElementById('video-typing-indicator')?.remove();
            return bubbleMetas;
        };

        // 聊天消息记录
        const chatMessages = [];
        // 🔥 激活视频通话的长按菜单
        this.bindCallMessageLongPressEvents(document.getElementById('video-chat-messages'), chatMessages);

        // 🔥 AI主动发第一句话（支持多条消息）
        if (aiFirstMessage && aiFirstMessage.trim()) {
            const messagesDiv = getVideoMessages();
            if (messagesDiv) {
                // 清理格式
                let cleanedGreeting = aiFirstMessage.trim();
                cleanedGreeting = cleanedGreeting.replace(/\[微信\][^:：]*[：:]\s*/g, ''); // 移除 [微信] xxx: 格式
                cleanedGreeting = cleanedGreeting.replace(/^from\s+\S+[：:]\s*/gmi, ''); // 移除 from xxx: 格式

                const msgLines = this._parseCallReplyEntries(cleanedGreeting, {
                    contactName: contact.name,
                    participants: isGroupCall ? groupParticipants : [],
                    groupName: contact.name,
                    isGroupCall
                });
                const roundId = 'round_greeting_' + Date.now();
                (async () => {
                    const bubbleMetas = await renderVideoAiLinesSequentially(msgLines, roundId);
                    this.bindCallBubbleClickEvents(messagesDiv);
                    const autoTTS = !!window.VirtualPhone?.storage?.get('wechat-call-auto-tts');
                    this.currentTtsRound = roundId;
                    if (autoTTS) {
                        for (let i = 0; i < bubbleMetas.length; i++) {
                            if (this.currentTtsRound !== roundId) break;
                            const bubble = document.getElementById(bubbleMetas[i].id);
                            const ttsText = this._resolveCallTTSContent(bubbleMetas[i].text, 'video');
                            if (!ttsText) continue;
                            await this.playWechatCallTTS(ttsText, bubble);
                        }
                    }
                })();
            }
        }

        // 计时器
        let videoDuration = 0;
        const videoTimer = setInterval(() => {
            videoDuration++;
            const minutes = Math.floor(videoDuration / 60).toString().padStart(2, '0');
            const seconds = (videoDuration % 60).toString().padStart(2, '0');
            const timerDiv = document.getElementById('video-timer');
            if (timerDiv) {
                timerDiv.textContent = `${minutes}:${seconds}`;
            }
        }, 1000);

        const triggerVideoAI = async () => {
            if (isVideoSending || videoPendingUserLines.length === 0) return;

            if (!this.isOnlineMode()) {
                this.app.phoneShell.showNotification('离线模式', '请在设置中开启在线模式', '⚠️');
                clearVideoBatchTimer();
                setVideoCallStatus('green');
                return;
            }

            const messagesDiv = getVideoMessages();
            if (!messagesDiv) return;

            isVideoSending = true;
            clearVideoBatchTimer();
            setVideoCallStatus('red');

            const messageToSend = videoPendingUserLines.join('\n');
            videoPendingUserLines = [];

            try {
                document.getElementById('video-typing-indicator')?.remove();
                const typingHtml = `
                    <div id="video-typing-indicator" style="display: flex; justify-content: flex-start;">
                        <div style="padding: 8px 12px; background: rgba(255,255,255,0.5); color: rgba(0,0,0,0.5); border-radius: 12px; font-size: 12px;">正在输入...</div>
                    </div>
                `;
                messagesDiv.insertAdjacentHTML('beforeend', typingHtml);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;

                const aiReply = await this.sendCallMessageToAI(messageToSend, contact.name, chatMessages, 'video');
                document.getElementById('video-typing-indicator')?.remove();

                const roundId = 'round_' + Date.now();
                const aiEntries = this._parseCallReplyEntries(aiReply, {
                    contactName: contact.name,
                    participants: isGroupCall ? groupParticipants : [],
                    groupName: contact.name,
                    isGroupCall
                });
                const renderLines = aiEntries.length > 0 ? aiEntries : [{ sender: contact.name, text: '...' }];
                const bubbleMetas = await renderVideoAiLinesSequentially(renderLines, roundId);

                this.bindCallBubbleClickEvents(messagesDiv);
                const autoTTS = !!window.VirtualPhone?.storage?.get('wechat-call-auto-tts');
                this.currentTtsRound = roundId;
                if (autoTTS) {
                    for (let i = 0; i < bubbleMetas.length; i++) {
                        if (this.currentTtsRound !== roundId) break;
                        const bubble = document.getElementById(bubbleMetas[i].id);
                        const ttsText = this._resolveCallTTSContent(bubbleMetas[i].text, 'video');
                        if (!ttsText) continue;
                        await this.playWechatCallTTS(ttsText, bubble);
                    }
                }
            } catch (error) {
                console.error('❌ 视频通话消息发送失败:', error);
                document.getElementById('video-typing-indicator')?.remove();
            } finally {
                isVideoSending = false;
                if (videoPendingUserLines.length > 0) {
                    restartVideoPendingTimerIfNeeded();
                } else {
                    setVideoCallStatus('green');
                }
            }
        };

        // 发送消息（复刻微信聊天的“连发等待”逻辑）
        const sendMessage = async () => {
            this.stopWechatCallTTS(); // 发新消息时打断旧语音
            const input = getVideoInput();
            const messagesDiv = getVideoMessages();
            if (!input || !messagesDiv) return;

            const text = input.value.trim();
            if (text) {
                const myMsgHtml = `
                    <div class="call-msg-row" style="display: flex; justify-content: flex-end;">
                        <div class="call-msg-bubble" data-msg-idx="${chatMessages.length}" style="max-width: 75%; padding: 8px 12px; background: #95ec69; color: #000; border-radius: 12px; font-size: 13px; position: relative;">${text}</div>
                    </div>
                `;
                messagesDiv.insertAdjacentHTML('beforeend', myMsgHtml);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;

                chatMessages.push({ from: 'me', text: text });
                videoPendingUserLines.push(text);
                input.value = '';

                if (document.activeElement === input) {
                    // 输入框有竖线（仍在编辑）时，只等待，不立刻触发AI
                    clearVideoBatchTimer();
                    setVideoCallStatus('green');
                } else {
                    restartVideoPendingTimerIfNeeded();
                }
                return;
            }

            if (videoPendingUserLines.length > 0) {
                await triggerVideoAI();
                return;
            }

            const recentUserLines = chatMessages
                .filter(m => m.from === 'me')
                .slice(-5)
                .map(m => m.text)
                .filter(Boolean);
            if (recentUserLines.length > 0) {
                videoPendingUserLines = recentUserLines;
                await triggerVideoAI();
                return;
            }

            this.app.phoneShell.showNotification('提示', '请先输入内容', '⚠️');
        };

        const videoInput = getVideoInput();
        const videoSendBtn = document.getElementById('video-send-btn');

        videoInput?.addEventListener('focus', () => {
            clearVideoBatchTimer();
            setVideoCallStatus('green');
        });

        videoInput?.addEventListener('blur', () => {
            restartVideoPendingTimerIfNeeded();
        });

        videoInput?.addEventListener('input', (e) => {
            const text = String(e.target.value || '').trim();
            if (text !== '') {
                clearVideoBatchTimer();
                setVideoCallStatus('green');
                return;
            }
            if (document.activeElement === e.target) {
                return;
            }
            restartVideoPendingTimerIfNeeded();
        });

        let isHandlingVideoSend = false;
        const executeVideoSend = (e) => {
            if (e) e.preventDefault();
            if (isHandlingVideoSend) return;
            isHandlingVideoSend = true;
            sendMessage();
            setTimeout(() => {
                isHandlingVideoSend = false;
            }, 300);
        };

        videoSendBtn?.addEventListener('touchstart', (e) => {
            e.preventDefault();
        }, { passive: false });
        videoSendBtn?.addEventListener('touchend', executeVideoSend);
        videoSendBtn?.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });
        videoSendBtn?.addEventListener('click', executeVideoSend);
        videoInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // 挂断
        document.getElementById('video-hangup-btn')?.addEventListener('click', () => {
            this.stopWechatCallTTS();
            clearInterval(videoTimer);
            clearVideoBatchTimer();
            videoPendingUserLines = [];
            isVideoSending = false;

            // 🔥 终极防报错保护。如果退出了当前聊天界面，直接返回即可，不再去读 id
            if (!this.app.currentChat) {
                this.app.render();
                return;
            }

            const wallElapsedSeconds = Math.max(0, Math.floor((Date.now() - callStartEpoch) / 1000));
            const effectiveDurationSec = Math.max(videoDuration, wallElapsedSeconds);
            const durationText = `${Math.floor(effectiveDurationSec / 60)}分${effectiveDurationSec % 60}秒`;

            // 🔥 过滤掉被删除的废弃消息
            const validChatMessages = chatMessages.filter(m => !m.isDeleted);

            this.addCallRecord('video', 'answered', durationText, {
                callStartTime,
                elapsedSeconds: effectiveDurationSec,
                transcript: validChatMessages.length > 0 ? [...validChatMessages] : undefined
            });

            // 🔥 如果开启在线模式，通知AI
            if (this.isOnlineMode() && effectiveDurationSec > 0) {
                this.notifyAI(`刚才和你视频通话了${durationText}`);
            }

            this.app.phoneShell.showNotification('通话结束', `${isGroupCall ? '群视频通话' : '视频通话'} ${durationText}`, '📹');
            setTimeout(() => this.app.render(), 1000);
        });
    }

    // 🔥 新增：向AI询问是否接听
    async askAIForCallDecision(callType, contactName) {
        try {
            const context = window.SillyTavern?.getContext?.();
            if (!context) {
                throw new Error('无法获取SillyTavern上下文，通话连接失败');
            }

            const callTypeName = callType === 'video' ? '视频通话' : '语音通话';
            const targetChat = this.app.currentChat;
            const isGroupCall = targetChat?.type === 'group';
            const groupParticipants = this._getGroupChatParticipants(targetChat);

            const prompt = isGroupCall
                ? `【剧情事件】${context.name1 || '用户'}向微信群"${contactName}"发起了${callTypeName}请求。

当前可接听成员白名单：
${groupParticipants.join('、') || '暂无成员'}

你需要根据当前剧情和群成员状态，决定是否有人接听。

如果接听，请用<wechat>标签回复。允许1-4人发言，且每一句必须使用“发送者: 内容”格式：
<wechat>
接听
张三: 第一位成员的开场白
李四: 第二位成员的开场白
</wechat>

如果拒绝或无人接听，请回复：
<wechat>
拒绝
</wechat>`.trim()
                : `【剧情事件】${context.name1 || '用户'}向你发起了${callTypeName}请求。

你现在扮演${contactName}，请根据当前剧情和角色性格决定是否接听。

如果接听，请用<wechat>标签回复你的第一句话：
<wechat>
接听
你的第一句话（可以多行）
</wechat>

如果拒绝，请回复：
<wechat>
拒绝
</wechat>`.trim();

            // 🔥 传递 callType 作为 callMode，避免加载微信聊天提示词
            const aiResponse = await this.sendToAIHidden(prompt, context, callType);

            // 🔥 解析 <wechat> 标签格式
            const content = this._extractWechatTagPayloadOrSelf(aiResponse);
            if (content) {
                const lines = content.split('\n').map(l => l.trim()).filter(l => l);

                if (lines.length > 0) {
                    const firstLine = lines[0];

                    // 判断是拒绝还是接听
                    if (firstLine.includes('拒绝') || firstLine.includes('reject')) {
                        return { action: 'reject', reason: lines.slice(1).join(' ') || '对方忙碌' };
                    }

                    // 接听：提取第一句话（跳过"接听"标记行）
                    let messageLines = lines;
                    if (firstLine.includes('接听') || firstLine.includes('answer')) {
                        messageLines = lines.slice(1);
                    }
                    const firstMessage = messageLines.join('\n').trim();
                    if (!firstMessage) {
                        throw new Error('AI接听了通话但未提供开场白');
                    }
                    return { action: 'answer', firstMessage };
                }
            }

            // 🔥 兼容容错：AI 没有用标签
            if (aiResponse.includes('拒绝') || aiResponse.includes('reject') || aiResponse.includes('不方便')) {
                return { action: 'reject', reason: '对方忙碌' };
            }

            // 兼容旧版 JSON 格式
            try {
                const jsonMatch = aiResponse.match(/\{[\s\S]*?"action"[\s\S]*?\}/);
                if (jsonMatch) {
                    const decision = JSON.parse(jsonMatch[0].trim());
                    if (decision.action === 'answer' || decision.action === 'reject') {
                        return decision;
                    }
                }
            } catch (e) { /* 忽略 JSON 解析失败 */ }

            // 最终容错：提取任何可用文本作为开场白
            let firstMessage = this.extractContactMessageFromResponse(aiResponse, contactName, {
                isGroupCall,
                groupName: contactName,
                participants: groupParticipants
            });
            if (!firstMessage) {
                throw new Error('无法从AI回复中解析出有效的通话决策');
            }

            return { action: 'answer', firstMessage: firstMessage };

        } catch (error) {
            console.error('❌ AI决策失败:', error);
            throw error;
        }
    }

    // 🔥 从AI回复中提取指定联系人的消息（处理 <wechat> 格式等）
    extractContactMessageFromResponse(response, contactName, options = {}) {
        const isGroupCall = options?.isGroupCall === true;
        const participants = Array.isArray(options?.participants) ? options.participants : [];
        const groupName = String(options?.groupName || contactName || '').trim();

        if (isGroupCall) {
            const groupEntries = this._parseCallReplyEntries(response, {
                contactName,
                participants,
                groupName,
                isGroupCall
            });
            return groupEntries.map(item => `${item.sender}: ${item.text}`).join('\n');
        }

        let messages = [];
        const normalizedResponse = String(response || '').replace(
            /^\s*(?:-{3,}|—{2,}|－{2,}|─{2,}|━{2,}|_{3,})\s*(.+?)\s*(?:-{3,}|—{2,}|－{2,}|─{2,}|━{2,}|_{3,})\s*$/gm,
            '---$1---'
        );

        // 方式1: 处理 <wechat> 格式
        const wechatContent = this._extractWechatTagPayload(normalizedResponse) || this._stripWechatCommentWrapper(normalizedResponse);
        if (wechatContent) {

            // 1a: 尝试找到当前联系人的 ---name--- 区块
            const contactBlockRegex = new RegExp(`---${contactName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}---([\\s\\S]*?)(?=---[^-]+---|$)`, 'i');
            const contactBlock = wechatContent.match(contactBlockRegex);

            if (contactBlock) {
                const msgLines = contactBlock[1].match(/\[[0-9A-Za-z:：]+\]\s*(.+)/g);
                if (msgLines) {
                    messages = msgLines.map(line => line.replace(/\[[0-9A-Za-z:：]+\]\s*/, '').trim());
                }
                // 如果没有时间戳格式，按行提取（线上模式 发送者: 内容）
                if (messages.length === 0) {
                    messages = contactBlock[1].split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('type:') && !l.startsWith('date:'));
                }
            }

            // 1b: 🔥 无 ---name--- 标头（语音/视频通话格式）：直接按行提取全部内容
            if (messages.length === 0 && !wechatContent.includes('---')) {
                const lines = wechatContent.split('\n').map(l => l.trim()).filter(l => l);
                // 移除可能的 type:/date: 行和时间戳前缀
                messages = lines
                    .filter(l => !l.startsWith('type:') && !l.startsWith('date:'))
                    .map(l => l.replace(/^\[[0-9A-Za-z:：]+\]\s*/, '').trim())
                    .filter(l => l);
            }
        }

        // 方式2: 处理纯文本消息（移除格式标记）
        if (messages.length === 0) {
            let cleanText = normalizedResponse
                .replace(/<wechat>[\s\S]*?<\/wechat>/gi, '') // 移除wechat标签
                .replace(/```[\s\S]*?```/g, '') // 移除代码块
                .replace(/\{[\s\S]*?\}/g, '') // 移除JSON
                .replace(/---[^-]+---/g, '') // 移除分隔符
                .replace(/date:\d{1,6}年\d{1,2}月\d{1,2}日/gi, '') // 移除日期
                .replace(/\[[0-9A-Za-z:：]+\]/g, '') // 移除时间戳
                .trim();
            cleanText = this._stripWechatCommentWrapper(cleanText);

            if (cleanText) {
                messages = cleanText.split('\n').map(l => l.trim()).filter(l => l && l.length > 0);
            }
        }

        // 返回合并的消息（用换行分隔，方便后续拆分显示）
        return messages.join('\n');
    }

    _getCurrentStoryTimeText() {
        const timeManager = window.VirtualPhone?.timeManager;
        return timeManager
            ? timeManager.getCurrentStoryTime().time
            : new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }

    _resolveCallEndStoryTime(callStartTime = null, elapsedSeconds = 0, { forceAdvanceMinute = false } = {}) {
        const timeManager = window.VirtualPhone?.timeManager;
        const safeElapsed = Math.max(0, Number(elapsedSeconds) || 0);

        const fallbackNow = () => {
            const now = new Date();
            const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
            return {
                time: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
                date: `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日`,
                weekday: weekdays[now.getDay()],
                timestamp: now.getTime()
            };
        };

        const baseTime = (callStartTime && callStartTime.time && callStartTime.date)
            ? callStartTime
            : (timeManager?.getCurrentStoryTime?.() || fallbackNow());

        const minutesElapsedRaw = Math.ceil(safeElapsed / 60);
        const minutesElapsed = Math.max(forceAdvanceMinute ? 1 : 0, minutesElapsedRaw);

        let endTime = baseTime;
        if (minutesElapsed > 0 && timeManager?.addMinutesToStoryTime) {
            endTime = timeManager.addMinutesToStoryTime(baseTime, minutesElapsed);
        }

        if (timeManager?.setTime && endTime?.time && endTime?.date) {
            timeManager.setTime(endTime.time, endTime.date, endTime.weekday || null);
            const latestTime = timeManager.getCurrentStoryTime?.() || endTime;
            window.VirtualPhone?.checkCalendarScheduleReminders?.(latestTime);
            return latestTime;
        }

        return endTime;
    }

    // 🔥 添加通话记录到聊天（使用剧情时间）
    addCallRecord(callType, status, duration, options = {}) {
        const elapsedSeconds = Math.max(0, Number(options?.elapsedSeconds) || 0);
        const callStartTime = options?.callStartTime || null;
        const shouldAdvance = String(status || '').trim() === 'answered';
        const storyTime = shouldAdvance
            ? this._resolveCallEndStoryTime(callStartTime, elapsedSeconds, { forceAdvanceMinute: true })
            : (window.VirtualPhone?.timeManager?.getCurrentStoryTime?.() || null);
        const currentTime = storyTime?.time || this._getCurrentStoryTimeText();

        this.app.wechatData.addMessage(this.app.currentChat.id, {
            from: 'me',
            type: 'call_record',
            callType: callType,
            status: status,
            duration: duration,
            transcript: Array.isArray(options?.transcript) && options.transcript.length > 0 ? options.transcript : undefined,
            time: currentTime,  // ✅ 使用剧情时间
            date: storyTime?.date,
            weekday: storyTime?.weekday
        });

    }

    async showIncomingVoiceCall(contact, queuedAiLines = []) {
        const safeContact = contact || this.app.currentChat || { name: '对方', avatar: '👤' };
        const contactName = safeContact.name || '对方';
        const isGroupCall = safeContact?.type === 'group';
        const groupParticipantsStrip = isGroupCall ? this._renderGroupCallParticipantsStrip(safeContact) : '';
        const incomingHtml = `
        <div class="call-fullscreen">
        <div class="wechat-app" style="background: linear-gradient(135deg, #a8edea 0%, #fed6e3 50%, #d299c2 100%); height: 100%; display: flex; flex-direction: column; overflow: hidden;">
            <div class="wechat-header" style="background: rgba(255,255,255,0.3); backdrop-filter: blur(20px); border-bottom: 1px solid rgba(255,255,255,0.3);">
                <div class="wechat-header-left">
                    <!-- 隐藏的返回按钮，用于接管并拦截右滑手势，防止路由迷失直接退回桌面 -->
                    <button class="wechat-back-btn" id="overlay-hidden-back" style="display:none;"></button>
                </div>
                <div class="wechat-header-title" style="color: #333;">${isGroupCall ? '群语音来电' : '语音来电'}</div>
                <div class="wechat-header-right"></div>
            </div>

            <div class="wechat-content" style="flex: 1; background: transparent; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 30px 20px;">
                <div class="call-avatar-fix" style="
                    width: 78px;
                    height: 78px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 34px;
                    margin-bottom: 20px;
                    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
                    animation: incoming-pulse 1.35s ease-in-out infinite;
                    overflow: hidden;
                ">${this.app.renderAvatar(safeContact.avatar, '👤', contactName)}</div>

                <div style="font-size: 18px; font-weight: 600; color: #333; margin-bottom: 6px;">
                    ${contactName}
                </div>
                ${groupParticipantsStrip}
                <div style="font-size: 13px; color: rgba(0,0,0,0.52); margin-bottom: 44px;">
                    ${isGroupCall ? '邀请你加入群语音通话...' : '邀请你语音通话...'}
                </div>

                <div style="display: flex; align-items: center; gap: 36px;">
                    <button id="incoming-call-reject-btn" style="
                        width: 56px;
                        height: 56px;
                        border-radius: 50%;
                        background: #ff3b30;
                        border: none;
                        color: #fff;
                        font-size: 17px;
                        cursor: pointer;
                        box-shadow: 0 4px 16px rgba(255, 59, 48, 0.35);
                    "><i class="fa-solid fa-phone-slash"></i></button>
                    <button id="incoming-call-answer-btn" style="
                        width: 56px;
                        height: 56px;
                        border-radius: 50%;
                        background: #34c759;
                        border: none;
                        color: #fff;
                        font-size: 17px;
                        cursor: pointer;
                        box-shadow: 0 4px 16px rgba(52, 199, 89, 0.35);
                    "><i class="fa-solid fa-phone"></i></button>
                </div>
                <div style="display: flex; align-items: center; justify-content: center; gap: 52px; margin-top: 8px; font-size: 10px; color: rgba(0,0,0,0.45);">
                    <span>拒绝</span>
                    <span>接听</span>
                </div>
            </div>
        </div>
        </div>

        <style>
            @keyframes incoming-pulse {
                0%, 100% {
                    transform: scale(1);
                    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
                }
                50% {
                    transform: scale(1.04);
                    box-shadow: 0 10px 30px rgba(102, 126, 234, 0.48);
                }
            }
            .call-avatar-fix img {
                width: 100% !important;
                height: 100% !important;
                margin: 0 !important;
                border-radius: 50% !important;
            }
            .call-avatar-fix div {
                border-radius: 50% !important;
            }
        </style>
    `;

        this.app.phoneShell.setContent(incomingHtml, 'wechat-call-overlay');
        // 拦截右滑返回手势，将其等同于点击挂断/取消/拒绝按钮
        document.getElementById('overlay-hidden-back')?.addEventListener('click', () => {
            const cancelBtn = document.getElementById('cancel-call-btn') || 
                              document.getElementById('video-hangup-btn') || 
                              document.getElementById('voice-hangup-btn') || 
                              document.getElementById('incoming-call-reject-btn');
            if (cancelBtn) cancelBtn.click();
            else this.app.render();
        });

        return new Promise((resolve) => {
            let handled = false;
            const done = (accepted) => {
                if (handled) return;
                handled = true;
                resolve(accepted);
            };

            document.getElementById('incoming-call-reject-btn')?.addEventListener('click', () => {
                this.addCallRecord('voice', 'rejected', '0分0秒');
                this.app.phoneShell?.showNotification('已拒绝', `你拒绝了${contactName}的${isGroupCall ? '群语音通话' : '语音通话'}`, '📞');
                this.app.render();
                done(false);
            });

            document.getElementById('incoming-call-answer-btn')?.addEventListener('click', () => {
                const aiGreeting = (Array.isArray(queuedAiLines) ? queuedAiLines : [])
                    .map(line => String(line || '').trim())
                    .filter(Boolean)
                    .join('\n');
                this.showVoiceCallInterface(safeContact, aiGreeting);
                done(true);
            });
        });
    }

    async showIncomingVideoCall(contact, queuedAiLines = []) {
        const safeContact = contact || this.app.currentChat || { name: '对方', avatar: '👤' };
        const contactName = safeContact.name || '对方';
        const isGroupCall = safeContact?.type === 'group';
        const groupParticipantsStrip = isGroupCall ? this._renderGroupCallParticipantsStrip(safeContact) : '';
        const incomingHtml = `
        <div class="call-fullscreen">
        <div class="wechat-app" style="background: linear-gradient(135deg, #a8edea 0%, #fed6e3 50%, #d299c2 100%); height: 100%; display: flex; flex-direction: column; overflow: hidden;">
            <div class="wechat-header" style="background: rgba(255,255,255,0.3); backdrop-filter: blur(20px); border-bottom: 1px solid rgba(255,255,255,0.3);">
                <div class="wechat-header-left">
                    <!-- 隐藏的返回按钮，用于接管并拦截右滑手势，防止路由迷失直接退回桌面 -->
                    <button class="wechat-back-btn" id="overlay-hidden-back" style="display:none;"></button>
                </div>
                <div class="wechat-header-title" style="color: #333;">${isGroupCall ? '群视频来电' : '视频来电'}</div>
                <div class="wechat-header-right"></div>
            </div>

            <div class="wechat-content" style="flex: 1; background: transparent; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 30px 20px;">
                <div class="call-avatar-fix" style="
                    width: 78px;
                    height: 78px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 34px;
                    margin-bottom: 20px;
                    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
                    animation: incoming-pulse 1.35s ease-in-out infinite;
                    overflow: hidden;
                ">${this.app.renderAvatar(safeContact.avatar, '👤', contactName)}</div>

                <div style="font-size: 18px; font-weight: 600; color: #333; margin-bottom: 6px;">
                    ${contactName}
                </div>
                ${groupParticipantsStrip}
                <div style="font-size: 13px; color: rgba(0,0,0,0.52); margin-bottom: 44px;">
                    ${isGroupCall ? '邀请你加入群视频通话...' : '邀请你视频通话...'}
                </div>

                <div style="display: flex; align-items: center; gap: 36px;">
                    <button id="incoming-call-reject-btn" style="
                        width: 56px;
                        height: 56px;
                        border-radius: 50%;
                        background: #ff3b30;
                        border: none;
                        color: #fff;
                        font-size: 17px;
                        cursor: pointer;
                        box-shadow: 0 4px 16px rgba(255, 59, 48, 0.35);
                    "><i class="fa-solid fa-phone-slash"></i></button>
                    <button id="incoming-call-answer-btn" style="
                        width: 56px;
                        height: 56px;
                        border-radius: 50%;
                        background: #34c759;
                        border: none;
                        color: #fff;
                        font-size: 17px;
                        cursor: pointer;
                        box-shadow: 0 4px 16px rgba(52, 199, 89, 0.35);
                    "><i class="fa-solid fa-phone"></i></button>
                </div>
                <div style="display: flex; align-items: center; justify-content: center; gap: 52px; margin-top: 8px; font-size: 10px; color: rgba(0,0,0,0.45);">
                    <span>拒绝</span>
                    <span>接听</span>
                </div>
            </div>
        </div>
        </div>

        <style>
            @keyframes incoming-pulse {
                0%, 100% {
                    transform: scale(1);
                    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
                }
                50% {
                    transform: scale(1.04);
                    box-shadow: 0 10px 30px rgba(102, 126, 234, 0.48);
                }
            }
            .call-avatar-fix img {
                width: 100% !important;
                height: 100% !important;
                margin: 0 !important;
                border-radius: 50% !important;
            }
            .call-avatar-fix div {
                border-radius: 50% !important;
            }
        </style>
    `;

        this.app.phoneShell.setContent(incomingHtml, 'wechat-call-overlay');
        // 拦截右滑返回手势，将其等同于点击挂断/取消/拒绝按钮
        document.getElementById('overlay-hidden-back')?.addEventListener('click', () => {
            const cancelBtn = document.getElementById('cancel-call-btn') || 
                              document.getElementById('video-hangup-btn') || 
                              document.getElementById('voice-hangup-btn') || 
                              document.getElementById('incoming-call-reject-btn');
            if (cancelBtn) cancelBtn.click();
            else this.app.render();
        });

        return new Promise((resolve) => {
            let handled = false;
            const done = (accepted) => {
                if (handled) return;
                handled = true;
                resolve(accepted);
            };

            document.getElementById('incoming-call-reject-btn')?.addEventListener('click', () => {
                this.addCallRecord('video', 'rejected', '0分0秒');
                this.app.phoneShell?.showNotification('已拒绝', `你拒绝了${contactName}的${isGroupCall ? '群视频通话' : '视频通话'}`, '📞');
                this.app.render();
                done(false);
            });

            document.getElementById('incoming-call-answer-btn')?.addEventListener('click', () => {
                const aiGreeting = (Array.isArray(queuedAiLines) ? queuedAiLines : [])
                    .map(line => String(line || '').trim())
                    .filter(Boolean)
                    .join('\n');
                this.showVideoCallInterface(safeContact, aiGreeting);
                done(true);
            });
        });
    }

    // 📞 语音通话（新增完整方法）
    async startVoiceCall() {
        // 🔥 关闭更多面板
        this.showMore = false;

        // 🔥 检查在线模式
        if (!this.isOnlineMode()) {
            this.app.phoneShell?.showNotification('离线模式', '请先在设置中开启在线模式才能发起通话', '⚠️');
            return;
        }

        const contact = this.app.currentChat;
        const isGroupCall = contact?.type === 'group';
        const groupParticipantsStrip = isGroupCall ? this._renderGroupCallParticipantsStrip(contact) : '';

        // 呼叫界面 - 白色玻璃风格
        const callingHtml = `
        <div class="call-fullscreen">
        <div class="wechat-app" style="background: linear-gradient(135deg, #a8edea 0%, #fed6e3 50%, #d299c2 100%); height: 100%; display: flex; flex-direction: column; overflow: hidden;">
            <div class="wechat-header" style="background: rgba(255,255,255,0.3); backdrop-filter: blur(20px); border-bottom: 1px solid rgba(255,255,255,0.3);">
                <div class="wechat-header-left">
                    <!-- 隐藏的返回按钮，用于接管并拦截右滑手势，防止路由迷失直接退回桌面 -->
                    <button class="wechat-back-btn" id="overlay-hidden-back" style="display:none;"></button>
                </div>
                <div class="wechat-header-title" style="color: #333;">${isGroupCall ? '群语音通话' : '语音通话'}</div>
                <div class="wechat-header-right"></div>
            </div>

            <div class="wechat-content" style="flex: 1; background: transparent; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 30px 20px;">
                <div class="call-avatar-fix" style="
                    width: 70px;
                    height: 70px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 32px;
                    margin-bottom: 20px;
                    box-shadow: 0 6px 24px rgba(102, 126, 234, 0.4);
                    animation: calling-pulse 1.5s ease-in-out infinite;
                    overflow: hidden;
                ">${this.app.renderAvatar(contact.avatar, '👤', contact.name)}</div>

                <div style="font-size: 18px; font-weight: 600; color: #333; margin-bottom: 6px;">
                    ${contact.name}
                </div>
                ${groupParticipantsStrip}

                <div id="call-status" style="font-size: 13px; color: rgba(0,0,0,0.5); margin-bottom: 40px;">
                    ${isGroupCall ? '正在呼叫群成员...' : '正在呼叫...'}
                </div>

                <button id="cancel-call-btn" style="
                    width: 50px;
                    height: 50px;
                    border-radius: 50%;
                    background: #ff3b30;
                    border: none;
                    color: #fff;
                    font-size: 20px;
                    cursor: pointer;
                    box-shadow: 0 4px 16px rgba(255, 59, 48, 0.4);
                ">
                    <i class="fa-solid fa-phone-slash"></i>
                </button>
                <div style="font-size: 10px; color: rgba(0,0,0,0.4); margin-top: 6px;">取消</div>
            </div>
        </div>
        </div>

        <style>
            @keyframes calling-pulse {
                0%, 100% {
                    transform: scale(1);
                    box-shadow: 0 6px 24px rgba(102, 126, 234, 0.4);
                }
                50% {
                    transform: scale(1.03);
                    box-shadow: 0 8px 32px rgba(102, 126, 234, 0.5);
                }
            }
            .call-avatar-fix img {
                width: 100% !important;
                height: 100% !important;
                margin: 0 !important;
                border-radius: 50% !important;
            }
            .call-avatar-fix div {
                border-radius: 50% !important;
            }
        </style>
    `;

        this.app.phoneShell.setContent(callingHtml, 'wechat-call-overlay');
        // 拦截右滑返回手势，将其等同于点击挂断/取消/拒绝按钮
        document.getElementById('overlay-hidden-back')?.addEventListener('click', () => {
            const cancelBtn = document.getElementById('cancel-call-btn') || 
                              document.getElementById('video-hangup-btn') || 
                              document.getElementById('voice-hangup-btn') || 
                              document.getElementById('incoming-call-reject-btn');
            if (cancelBtn) cancelBtn.click();
            else this.app.render();
        });

        let isCancelled = false;
        const callAbortController = new AbortController();
        document.getElementById('cancel-call-btn')?.addEventListener('click', () => {
            isCancelled = true;
            callAbortController.abort();
            // 🔥 核心杀招：调用酒馆真实全局停止函数
            if (typeof window.stopGeneration === 'function') {
                window.stopGeneration();
            }
            // 🔥 暴力兜底：强制点击界面的停止按钮
            const stStopBtn = document.getElementById('mes_stop');
            if (stStopBtn) {
                stStopBtn.click();
            }
            this.addCallRecord('voice', 'cancelled', '0分0秒');
            this.app.phoneShell.showNotification('已取消', isGroupCall ? '群语音通话已取消' : '语音通话已取消', '📞');
            setTimeout(() => this.app.render(), 500);
        });

        try {
            await new Promise(resolve => setTimeout(resolve, 2000));

            if (isCancelled) return;

            const decision = await this.askAIForCallDecision('voice', contact.name);

            // 🔥 等AI思考完返回时，再次检查用户是否已经点击了取消，或者是否已经退出了聊天界面
            if (isCancelled || !this.app.currentChat) return;

            if (decision.action === 'reject') {
                const statusDiv = document.getElementById('call-status');
                if (statusDiv) {
                    statusDiv.textContent = isGroupCall ? '群成员未接听' : '对方已拒绝';
                    statusDiv.style.color = '#ff3b30';
                }

                this.addCallRecord('voice', 'rejected', '0分0秒');

                setTimeout(() => {
                    this.app.phoneShell.showNotification('通话结束', isGroupCall ? '群成员未接听语音通话' : '对方拒绝了语音通话', '❌');
                    setTimeout(() => this.app.render(), 1000);
                }, 2000);

                return;
            }

            // 接通后显示通话界面，并处理AI的开场白
            this.showVoiceCallInterface(contact, decision.firstMessage);

        } catch (error) {
            // 🔥 区分中断和其他错误，静默处理中断
            if (isCancelled || error.name === 'AbortError') {
                console.log('✅ 语音通话已取消，静默处理');
            } else {
                console.error('❌ 语音通话失败:', error);
                this.app.phoneShell.showNotification('通话失败', 'API请求失败，请检查网络和在线模式设置', '❌');
                setTimeout(() => this.app.render(), 1000);
            }
        }
    }

    _normalizeCallReplyLines(rawText, contactName = '') {
        const source = String(rawText || '')
            .replace(/\r\n/g, '\n')
            .replace(/\[微信\][^:：]*[：:]\s*/g, '')
            .trim();
        if (!source) return [];

        const escapedName = String(contactName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const senderPrefixRegex = escapedName ? new RegExp(`^${escapedName}\\s*[：:]\\s*`) : null;

        return source
            .split(/\|\|\||\n+/)
            .map(line => String(line || '').trim())
            .map(line => line.replace(/^\[[0-9A-Za-z:：]+\]\s*/, ''))
            .map(line => line.replace(/^from\s+\S+[：:]\s*/i, ''))
            .map(line => senderPrefixRegex ? line.replace(senderPrefixRegex, '') : line)
            .map(line => this._stripCallSpeechPrefix(line))
            .map(line => line.trim())
            .filter(Boolean);
    }

    // 📹 通话中发送消息给AI（语音/视频通用）
    async sendCallMessageToAI(message, contactName, chatHistory, callType = 'voice') {
        try {
            const context = window.SillyTavern?.getContext?.();
            if (!context) return '...';

            const callTypeName = callType === 'video' ? '视频' : '语音';
            const userName = context.name1 || '用户';
            const targetChat = this.app.currentChat;
            const isGroupCall = targetChat?.type === 'group';
            const groupParticipants = this._getGroupChatParticipants(targetChat);
            const callHistoryLimit = isGroupCall
                ? this._readNonNegativeLimit('wechat-group-call-history-limit', 50)
                : this._readNonNegativeLimit('wechat-single-call-history-limit', 30);
            const recentCallHistory = callHistoryLimit > 0 ? chatHistory.slice(-callHistoryLimit) : [];

            // 🔥 精简的通话提示词 - 只包含必要信息
            const prompt = isGroupCall
                ? `【微信群${callTypeName}通话中】
当前群聊：${contactName}
可发言成员：${groupParticipants.join('、') || '暂无成员'}
${userName}说：${message}

最近通话记录：
${recentCallHistory.map(h => `${h.from === 'me' ? userName : h.from}: ${h.text}`).join('\n')}

请以群成员的身份继续通话。回复时必须使用“发送者: 内容”格式，且发送者必须来自可发言成员名单。`
                : `【${callTypeName}通话中】
${userName}说：${message}

通话记录：
${recentCallHistory.map(h => `${h.from === 'me' ? userName : contactName}: ${h.text}`).join('\n')}

请以${contactName}的身份回复。`;

            // 🔥 传递 callType 作为 callMode
            const aiResponse = await this.sendToAIHidden(prompt, context, callType);

            // 🔥 使用统一方法提取当前联系人的消息
            let cleanedResponse = this.extractContactMessageFromResponse(aiResponse, contactName, {
                isGroupCall,
                groupName: contactName,
                participants: groupParticipants
            });

            // 如果提取失败，尝试简单清理
            if (!cleanedResponse) {
                cleanedResponse = this._extractWechatTagPayloadOrSelf(aiResponse).trim();
            }

            if (isGroupCall) {
                const groupEntries = this._parseCallReplyEntries(cleanedResponse, {
                    contactName,
                    participants: groupParticipants,
                    groupName: contactName,
                    isGroupCall
                });
                if (groupEntries.length > 0) {
                    return groupEntries.map(item => `${item.sender}: ${item.text}`).join('\n');
                }
                return String(cleanedResponse || '').trim() || '...';
            }

            const lines = this._normalizeCallReplyLines(cleanedResponse, contactName);
            return lines.length > 0 ? lines.join('\n') : '...';

        } catch (error) {
            console.error(`❌ ${callType}通话消息发送失败:`, error);
            return '...';
        }
    }

    // 📹 视频通话中发送消息给AI（兼容旧调用）
    async sendVideoCallMessageToAI(message, contactName, chatHistory) {
        return this.sendCallMessageToAI(message, contactName, chatHistory, 'video');
    }

    // 🔥 显示语音通话界面（接通后）- 简洁版
    showVoiceCallInterface(contact, aiGreeting = '') {
        // 🔥 记录通话开始的剧情时间
        const timeManager = window.VirtualPhone?.timeManager;
        const callStartTime = timeManager
            ? timeManager.getCurrentStoryTime()
            : { time: '21:30', date: '2044年10月28日' };
        const callStartEpoch = Date.now();
        const isGroupCall = contact?.type === 'group';
        const groupParticipants = this._getGroupChatParticipants(contact);
        const groupParticipantsStrip = isGroupCall ? this._renderGroupCallParticipantsStrip(contact) : '';

        const html = `
        <div class="call-fullscreen">
        <div class="wechat-app" style="background: linear-gradient(135deg, #a8edea 0%, #fed6e3 50%, #d299c2 100%); height: 100%; display: flex; flex-direction: column; overflow: hidden;">
            <div class="wechat-header" style="background: rgba(255,255,255,0.4); backdrop-filter: blur(20px); border-bottom: 1px solid rgba(255,255,255,0.3); flex-shrink: 0;">
                <div class="wechat-header-left">
                    <!-- 隐藏的返回按钮，用于接管并拦截右滑手势，防止路由迷失直接退回桌面 -->
                    <button class="wechat-back-btn" id="overlay-hidden-back" style="display:none;"></button>
                </div>
                <div class="wechat-header-title" style="color: #333;">
                    <span class="wechat-header-title-text">${contact.name}${isGroupCall ? '<span style="font-size:11px; margin-left:4px; opacity:0.78;">(群语音)</span>' : ''}<span class="status-dot dot-green" id="voice-call-status-dot"></span></span>
                </div>
                <div class="wechat-header-right">
                    <span id="call-timer" style="font-size: 13px; color: #666;">00:00</span>
                </div>
            </div>

            <div class="wechat-content" style="background: transparent; display: flex; flex-direction: column; flex: 1; overflow: hidden; padding: 0; min-height: 0;">

                <!-- 顶部：头像区域 -->
                <div style="padding: 8px; text-align: center; flex-shrink: 0;">
                    <div class="call-avatar-fix" style="
                        width: 40px;
                        height: 40px;
                        border-radius: 50%;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        margin: 0 auto;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 20px;
                        box-shadow: 0 0 0 0 rgba(102, 126, 234, 0.5);
                        animation: voice-glow 2s infinite;
                        overflow: hidden;
                    ">
                        ${this.app.renderAvatar(contact.avatar, '👤', contact.name)}
                    </div>
                    <div style="font-size: 9px; color: rgba(0,0,0,0.5); margin-top: 3px;">${isGroupCall ? '群语音通话中' : '语音通话中'}</div>
                    ${groupParticipantsStrip}
                </div>

                <!-- 中间：聊天消息区域 -->
                <div id="voice-chat-messages" style="
                    flex: 1;
                    overflow-y: auto;
                    padding: 8px;
                    background: rgba(255,255,255,0.3);
                    backdrop-filter: blur(10px);
                    margin: 0 8px;
                    border-radius: 10px;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    min-height: 0;
                ">
                    <div style="text-align: center; color: rgba(0,0,0,0.4); font-size: 10px; padding: 3px 0;">
                        通话中可发送文字
                    </div>
                </div>

                <!-- 底部：输入框和挂断按钮 -->
                <div style="background: rgba(255,255,255,0.5); backdrop-filter: blur(20px); padding: 8px; flex-shrink: 0;">
                    <!-- 文字输入行 -->
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="text" id="voice-chat-input" placeholder="发送消息..." style="
                            flex: 1;
                            min-width: 0;
                            padding: 8px 18px 8px 12px;
                            border: 1px solid rgba(255,255,255,0.22);
                            border-radius: 18px;
                            background: rgba(255,255,255,0.12);
                            color: #fff;
                            font-size: 13px;
                            outline: none;
                            -webkit-user-select: text;
                            user-select: text;
                            -webkit-touch-callout: default;
                            touch-action: auto;
                        ">
                        <button id="voice-send-btn" style="
                            width: 32px;
                            height: 32px;
                            background: transparent;
                            border: none;
                            color: #07c160;
                            font-size: 18px;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            flex-shrink: 0;
                        ">
                            <i class="fa-solid fa-paper-plane"></i>
                        </button>
                        <button id="voice-hangup-btn" style="
                            width: 32px;
                            height: 32px;
                            background: transparent;
                            border: none;
                            color: #ff3b30;
                            font-size: 18px;
                            cursor: pointer;
                            flex-shrink: 0;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        ">
                            <i class="fa-solid fa-phone-slash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
        </div>

        <style>
            @keyframes voice-glow {
                0%, 100% { box-shadow: 0 0 0 0 rgba(102, 126, 234, 0.5); }
                50% { box-shadow: 0 0 0 8px rgba(102, 126, 234, 0); }
            }
            .call-avatar-fix img {
                width: 100% !important;
                height: 100% !important;
                margin: 0 !important;
                border-radius: 50% !important;
            }
            .call-avatar-fix div {
                border-radius: 50% !important;
            }
            #voice-chat-input {
                background: rgba(255,255,255,0.12) !important;
                color: #ffffff !important;
                -webkit-text-fill-color: #ffffff !important;
                caret-color: #ffffff !important;
                border: 1px solid rgba(255,255,255,0.22) !important;
                box-shadow: inset 0 0 0 1000px rgba(255,255,255,0.12) !important;
                filter: none !important;
                opacity: 1 !important;
            }
            #voice-chat-input::placeholder {
                color: rgba(255,255,255,0.62) !important;
                -webkit-text-fill-color: rgba(255,255,255,0.62) !important;
            }
        </style>
    `;

        this.app.phoneShell.setContent(html, 'wechat-call-overlay');
        // 拦截右滑返回手势，将其等同于点击挂断/取消/拒绝按钮
        document.getElementById('overlay-hidden-back')?.addEventListener('click', () => {
            const cancelBtn = document.getElementById('cancel-call-btn') || 
                              document.getElementById('video-hangup-btn') || 
                              document.getElementById('voice-hangup-btn') || 
                              document.getElementById('incoming-call-reject-btn');
            if (cancelBtn) cancelBtn.click();
            else this.app.render();
        });

        const setVoiceCallStatus = (color = 'green') => {
            const dot = document.getElementById('voice-call-status-dot');
            if (!dot) return;
            dot.classList.remove('dot-green', 'dot-yellow', 'dot-red');
            if (color === 'red') {
                dot.classList.add('dot-red');
                return;
            }
            if (color === 'yellow') {
                dot.classList.add('dot-yellow');
                return;
            }
            dot.classList.add('dot-green');
        };

        const getVoiceInput = () => document.getElementById('voice-chat-input');
        const hardenVoiceInputStyle = () => {
            const input = getVoiceInput();
            if (!input?.style?.setProperty) return;
            input.style.setProperty('background', 'rgba(255,255,255,0.12)', 'important');
            input.style.setProperty('background-color', 'rgba(255,255,255,0.12)', 'important');
            input.style.setProperty('color', '#ffffff', 'important');
            input.style.setProperty('-webkit-text-fill-color', '#ffffff', 'important');
            input.style.setProperty('caret-color', '#ffffff', 'important');
            input.style.setProperty('border', '1px solid rgba(255,255,255,0.22)', 'important');
            input.style.setProperty('box-shadow', 'inset 0 0 0 1000px rgba(255,255,255,0.12)', 'important');
            input.style.setProperty('outline', 'none', 'important');
            input.style.setProperty('appearance', 'none', 'important');
            input.style.setProperty('-webkit-appearance', 'none', 'important');
            input.style.setProperty('filter', 'none', 'important');
            input.style.setProperty('opacity', '1', 'important');
        };
        hardenVoiceInputStyle();
        // 某些主题会在下一个渲染帧二次覆盖 input 样式，这里再补一帧和延时兜底
        requestAnimationFrame(() => hardenVoiceInputStyle());
        setTimeout(() => hardenVoiceInputStyle(), 80);
        const getVoiceMessages = () => document.getElementById('voice-chat-messages');

        let voiceBatchTimer = null;
        let voicePendingUserLines = [];
        let isVoiceSending = false;

        const clearVoiceBatchTimer = () => {
            clearTimeout(voiceBatchTimer);
            voiceBatchTimer = null;
        };

        const restartVoicePendingTimerIfNeeded = () => {
            const input = getVoiceInput();
            const text = String(input?.value || '').trim();
            const isEditing = !!input && document.activeElement === input;
            const canRestart = !isEditing && text === '' && voicePendingUserLines.length > 0 && !isVoiceSending;
            if (!canRestart) {
                if (isEditing && !isVoiceSending) {
                    setVoiceCallStatus('green');
                }
                return;
            }
            clearVoiceBatchTimer();
            voiceBatchTimer = setTimeout(() => {
                triggerVoiceAI();
            }, 6000);
            setVoiceCallStatus('yellow');
        };

        const getVoiceCallTypingDelay = (line) => {
            const length = String(line || '').trim().length;
            return Math.min(2000, 360 + length * 40);
        };

        const renderVoiceAiLinesSequentially = async (lines, roundId) => {
            const bubbleMetas = [];
            const renderLines = Array.isArray(lines) ? lines : [];

            for (let i = 0; i < renderLines.length; i++) {
                const messagesDiv = getVoiceMessages();
                if (!messagesDiv) break;

                const entry = typeof renderLines[i] === 'string'
                    ? { sender: contact.name, text: String(renderLines[i] || '').trim() }
                    : {
                        sender: String(renderLines[i]?.sender || contact.name).trim() || contact.name,
                        text: String(renderLines[i]?.text || '').trim()
                    };
                if (!entry.text) continue;

                document.getElementById('voice-typing-indicator')?.remove();
                const typingHtml = `
                    <div id="voice-typing-indicator" style="display: flex; justify-content: flex-start;">
                        <div style="padding: 6px 10px; background: rgba(255,255,255,0.6); color: rgba(0,0,0,0.5); border-radius: 10px; font-size: 11px;">正在输入...</div>
                    </div>
                `;
                messagesDiv.insertAdjacentHTML('beforeend', typingHtml);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;

                await new Promise(resolve => setTimeout(resolve, getVoiceCallTypingDelay(entry.text)));
                document.getElementById('voice-typing-indicator')?.remove();

                const bubbleId = 'wechat-call-ai-msg-' + Math.random().toString(36).slice(2, 8);
                const senderLabelHtml = isGroupCall
                    ? `<div class="call-msg-sender-label" style="font-size:10px; color:rgba(0,0,0,0.48); margin:0 0 4px 2px;">${this._escapeHtml(entry.sender)}</div>`
                    : '';
                const safeEntryText = this._escapeHtml(entry.text);
                const aiMsgHtml = `
                    <div class="call-msg-row" style="display: flex; justify-content: flex-start;">
                        <div style="max-width: 80%; display:flex; flex-direction:column; align-items:flex-start;">
                            ${senderLabelHtml}
                            <div class="wechat-call-ai-bubble call-msg-bubble" id="${bubbleId}" data-msg-idx="${chatMessages.length}" data-call-type="voice" data-round-id="${roundId}" data-sender="${this._escapeHtml(entry.sender)}" data-text="${safeEntryText}" style="max-width: 100%; padding: 6px 10px; background: rgba(255,255,255,0.85); color: #333; border-radius: 10px; font-size: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.1); cursor: pointer; transition: all 0.3s; position: relative;">${safeEntryText}</div>
                        </div>
                    </div>
                `;
                messagesDiv.insertAdjacentHTML('beforeend', aiMsgHtml);
                chatMessages.push({ from: entry.sender, text: entry.text });
                bubbleMetas.push({ id: bubbleId, sender: entry.sender, text: entry.text });
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }

            document.getElementById('voice-typing-indicator')?.remove();
            return bubbleMetas;
        };

        // 计时器
        let callDuration = 0;
        const callTimer = setInterval(() => {
            callDuration++;
            const minutes = Math.floor(callDuration / 60).toString().padStart(2, '0');
            const seconds = (callDuration % 60).toString().padStart(2, '0');
            const timerDiv = document.getElementById('call-timer');
            if (timerDiv) {
                timerDiv.textContent = `${minutes}:${seconds}`;
            }
        }, 1000);

        // 聊天消息记录
        const chatMessages = [];
        // 🔥 激活语音通话的长按菜单
        this.bindCallMessageLongPressEvents(document.getElementById('voice-chat-messages'), chatMessages);

        // 🔥 如果有AI开场白，显示（支持多条消息）
        if (aiGreeting && aiGreeting.trim()) {
            const messagesDiv = getVoiceMessages();
            if (messagesDiv) {
                let cleanedGreeting = aiGreeting.trim();
                cleanedGreeting = cleanedGreeting.replace(/\[微信\][^:：]*[：:]\s*/g, '');
                cleanedGreeting = cleanedGreeting.replace(/^from\s+\S+[：:]\s*/gmi, '');

                const msgLines = this._parseCallReplyEntries(cleanedGreeting, {
                    contactName: contact.name,
                    participants: isGroupCall ? groupParticipants : [],
                    groupName: contact.name,
                    isGroupCall
                });
                const roundId = 'round_greeting_' + Date.now();
                (async () => {
                    const bubbleMetas = await renderVoiceAiLinesSequentially(msgLines, roundId);
                    this.bindCallBubbleClickEvents(messagesDiv);
                    const autoTTS = !!window.VirtualPhone?.storage?.get('wechat-call-auto-tts');
                    this.currentTtsRound = roundId;
                    if (autoTTS) {
                        for (let i = 0; i < bubbleMetas.length; i++) {
                            if (this.currentTtsRound !== roundId) break;
                            const bubble = document.getElementById(bubbleMetas[i].id);
                            await this.playWechatCallTTS(bubbleMetas[i].text, bubble);
                        }
                    }
                })();
            }
        }

        const triggerVoiceAI = async () => {
            if (isVoiceSending || voicePendingUserLines.length === 0) return;

            if (!this.isOnlineMode()) {
                this.app.phoneShell.showNotification('离线模式', '请在设置中开启在线模式', '⚠️');
                clearVoiceBatchTimer();
                setVoiceCallStatus('green');
                return;
            }

            const messagesDiv = getVoiceMessages();
            if (!messagesDiv) return;

            isVoiceSending = true;
            clearVoiceBatchTimer();
            setVoiceCallStatus('red');

            const messageToSend = voicePendingUserLines.join('\n');
            voicePendingUserLines = [];

            try {
                document.getElementById('voice-typing-indicator')?.remove();
                const typingHtml = `
                    <div id="voice-typing-indicator" style="display: flex; justify-content: flex-start;">
                        <div style="padding: 6px 10px; background: rgba(255,255,255,0.6); color: rgba(0,0,0,0.5); border-radius: 10px; font-size: 11px;">正在输入...</div>
                    </div>
                `;
                messagesDiv.insertAdjacentHTML('beforeend', typingHtml);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;

                const aiReply = await this.sendCallMessageToAI(messageToSend, contact.name, chatMessages, 'voice');
                document.getElementById('voice-typing-indicator')?.remove();

                const roundId = 'round_' + Date.now();
                const aiEntries = this._parseCallReplyEntries(aiReply, {
                    contactName: contact.name,
                    participants: isGroupCall ? groupParticipants : [],
                    groupName: contact.name,
                    isGroupCall
                });
                const renderLines = aiEntries.length > 0 ? aiEntries : [{ sender: contact.name, text: '...' }];
                const bubbleMetas = await renderVoiceAiLinesSequentially(renderLines, roundId);

                this.bindCallBubbleClickEvents(messagesDiv);
                const autoTTS = !!window.VirtualPhone?.storage?.get('wechat-call-auto-tts');
                this.currentTtsRound = roundId;
                if (autoTTS) {
                    for (let i = 0; i < bubbleMetas.length; i++) {
                        if (this.currentTtsRound !== roundId) break;
                        const bubble = document.getElementById(bubbleMetas[i].id);
                        await this.playWechatCallTTS(bubbleMetas[i].text, bubble);
                    }
                }
            } catch (error) {
                console.error('❌ 语音通话消息发送失败:', error);
                document.getElementById('voice-typing-indicator')?.remove();
            } finally {
                isVoiceSending = false;
                if (voicePendingUserLines.length > 0) {
                    restartVoicePendingTimerIfNeeded();
                } else {
                    setVoiceCallStatus('green');
                }
            }
        };

        // 发送消息（复刻微信聊天的“连发等待”逻辑）
        const sendMessage = async () => {
            this.stopWechatCallTTS();
            const input = getVoiceInput();
            const messagesDiv = getVoiceMessages();
            if (!input || !messagesDiv) return;

            const text = input.value.trim();
            if (text) {
                const myMsgHtml = `
                    <div class="call-msg-row" style="display: flex; justify-content: flex-end;">
                        <div class="call-msg-bubble" data-msg-idx="${chatMessages.length}" style="max-width: 75%; padding: 8px 12px; background: #95ec69; color: #000; border-radius: 12px; font-size: 13px; position: relative;">${text}</div>
                    </div>
                `;
                messagesDiv.insertAdjacentHTML('beforeend', myMsgHtml);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;

                chatMessages.push({ from: 'me', text: text });
                voicePendingUserLines.push(text);
                input.value = '';

                if (document.activeElement === input) {
                    clearVoiceBatchTimer();
                    setVoiceCallStatus('green');
                } else {
                    restartVoicePendingTimerIfNeeded();
                }
                return;
            }

            if (voicePendingUserLines.length > 0) {
                await triggerVoiceAI();
                return;
            }

            const recentUserLines = chatMessages
                .filter(m => m.from === 'me')
                .slice(-5)
                .map(m => m.text)
                .filter(Boolean);
            if (recentUserLines.length > 0) {
                voicePendingUserLines = recentUserLines;
                await triggerVoiceAI();
                return;
            }

            this.app.phoneShell.showNotification('提示', '请先输入内容', '⚠️');
        };

        const voiceInput = getVoiceInput();
        const voiceSendBtn = document.getElementById('voice-send-btn');

        voiceInput?.addEventListener('focus', () => {
            clearVoiceBatchTimer();
            setVoiceCallStatus('green');
        });

        voiceInput?.addEventListener('blur', () => {
            restartVoicePendingTimerIfNeeded();
        });

        voiceInput?.addEventListener('input', (e) => {
            const text = String(e.target.value || '').trim();
            if (text !== '') {
                clearVoiceBatchTimer();
                setVoiceCallStatus('green');
                return;
            }
            if (document.activeElement === e.target) {
                return;
            }
            restartVoicePendingTimerIfNeeded();
        });

        let isHandlingVoiceSend = false;
        const executeVoiceSend = (e) => {
            if (e) e.preventDefault();
            if (isHandlingVoiceSend) return;
            isHandlingVoiceSend = true;
            sendMessage();
            setTimeout(() => {
                isHandlingVoiceSend = false;
            }, 300);
        };

        voiceSendBtn?.addEventListener('touchstart', (e) => {
            e.preventDefault();
        }, { passive: false });
        voiceSendBtn?.addEventListener('touchend', executeVoiceSend);
        voiceSendBtn?.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });
        voiceSendBtn?.addEventListener('click', executeVoiceSend);
        voiceInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // 挂断
        // 挂断
        document.getElementById('voice-hangup-btn')?.addEventListener('click', () => {
            this.stopWechatCallTTS();
            clearInterval(callTimer);
            clearVoiceBatchTimer();
            voicePendingUserLines = [];
            isVoiceSending = false;

            // 🔥 修复：终极防报错保护。如果退出了当前聊天界面，直接返回即可，不再去读 id
            if (!this.app.currentChat) {
                this.app.render();
                return;
            }

            const wallElapsedSeconds = Math.max(0, Math.floor((Date.now() - callStartEpoch) / 1000));
            const effectiveDurationSec = Math.max(callDuration, wallElapsedSeconds);
            const durationText = `${Math.floor(effectiveDurationSec / 60)}分${effectiveDurationSec % 60}秒`;

            // 🔥 过滤掉被删除的废弃消息
            const validChatMessages = chatMessages.filter(m => !m.isDeleted);

            this.addCallRecord('voice', 'answered', durationText, {
                callStartTime,
                elapsedSeconds: effectiveDurationSec,
                transcript: validChatMessages.length > 0 ? [...validChatMessages] : undefined
            });

            if (this.isOnlineMode() && effectiveDurationSec > 0) {
                this.notifyAI(`刚才和你语音通话了${durationText}`);
            }

            this.app.phoneShell.showNotification('通话结束', `${isGroupCall ? '群语音通话' : '语音通话'} ${durationText}`, '📞');
            setTimeout(() => this.app.render(), 1000);
        });
    }

    // 💰 转账后通知AI
    async notifyTransfer(amount, desc) {
        if (!this.isOnlineMode()) return;

        const message = `用户通过微信向你转账了¥${amount}，备注：${desc}`;
        await this.notifyAI(message);
    }

    // 🧧 显示发红包界面（高仿微信原版）
    showRedPacketDialog() {
        const html = `
        <div class="wechat-app">
            <div class="wechat-header" style="background: #f7f7f7;">
                <div class="wechat-header-left">
                    <button class="wechat-back-btn" id="back-from-redpacket" style="color: #000;">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                </div>
                <div class="wechat-header-title" style="font-size:14px;">发红包</div>
                <div class="wechat-header-right">
                    <button class="wechat-header-btn" style="font-size: 12px; color: #666;">
                        <i class="fa-solid fa-ellipsis"></i>
                    </button>
                </div>
            </div>

            <div class="wechat-content" style="background: #f7f7f7; padding: 8px 0 0; display: flex; flex-direction: column; overflow: hidden; box-sizing: border-box;">
                <!-- 卡片1: 单个金额 -->
                <div style="background: #fff; border-radius: 8px; margin: 0 10px 8px; padding: 0 12px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; height: 40px;">
                        <span style="font-size: 13px; color: #000;">单个金额</span>
                        <div style="display: flex; align-items: center;">
                            <span style="font-size: 13px; color: #ccc; margin-right: 2px;">¥</span>
                            <input type="text" id="redpacket-amount"
                                   placeholder="0.00"
                                   inputmode="decimal"
                                   style="background:transparent; border:none; outline:none; font-size:13px; text-align:right; color:#ccc; width:60px;">
                        </div>
                    </div>
                </div>

                <!-- 卡片2: 祝福语 -->
                <div style="background: #fff; border-radius: 8px; margin: 0 10px 8px; padding: 0 12px;">
                    <div style="display: flex; align-items: center; height: 40px;">
                        <input type="text" id="redpacket-wish" placeholder="恭喜发财，大吉大利" maxlength="25" style="
                            flex: 1; min-width: 0; background: transparent; border: none; outline: none;
                            font-size: 13px; color: #000; padding: 0;
                        ">
                        <span style="font-size: 16px; color: #ccc; margin-left: 6px; flex-shrink: 0;">😊</span>
                    </div>
                </div>

                <!-- 卡片3: 红包封面 -->
                <div style="background: #fff; border-radius: 8px; margin: 0 10px; padding: 0 12px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; height: 40px;">
                        <span style="font-size: 13px; color: #000;">红包封面</span>
                        <div style="display: flex; align-items: center; color: #ccc; font-size: 11px;">
                            <span>领封面</span>
                            <span style="color: #fa5151; margin: 0 3px; font-size: 8px;">●</span>
                            <i class="fa-solid fa-chevron-right" style="font-size: 10px;"></i>
                        </div>
                    </div>
                </div>

                <!-- 金额主显示区 -->
                <div style="text-align: center; margin: 25px 0 15px;">
                    <span style="font-size: 30px; font-weight: 500; color: #000;">¥ </span>
                    <span id="redpacket-amount-main" style="font-size: 30px; font-weight: 500; color: #000;">0.00</span>
                </div>

                <!-- 塞钱进红包按钮 -->
                <div style="padding: 0 30px;">
                    <button id="confirm-redpacket" style="
                        width: 100%; padding: 10px; background: #e54c45; color: #fff;
                        border: none; border-radius: 6px; font-size: 13px; cursor: pointer;
                        box-sizing: border-box;
                    ">塞钱进红包</button>
                </div>

                <!-- 底部提示文字 -->
                <div style="text-align: center; font-size: 11px; color: #aaa; margin-top: auto; padding: 10px 0;">
                    可直接使用收到的零钱发红包
                </div>
            </div>
        </div>
    `;

        this.app.phoneShell.setContent(html);

        // 获取元素
        const amountInput = document.getElementById('redpacket-amount');
        const amountMainDisplay = document.getElementById('redpacket-amount-main');

        // 监听输入，实时更新下方的大号金额
        amountInput.addEventListener('input', () => {
            let valueStr = amountInput.value.replace(/[^\d.]/g, ''); // 只允许数字和小数点

            const parts = valueStr.split('.');
            if (parts.length > 2) valueStr = parts[0] + '.' + parts.slice(1).join('');
            if (parts[1] && parts[1].length > 2) valueStr = parts[0] + '.' + parts[1].substring(0, 2);

            amountInput.value = valueStr; // 更新输入框的值

            let displayValue = parseFloat(valueStr).toFixed(2);
            if (isNaN(displayValue) || valueStr === '' || valueStr === '.') {
                amountMainDisplay.textContent = '0.00';
            } else {
                amountMainDisplay.textContent = displayValue;
            }
        });

        // 控制占位符和输入文字的颜色
        amountInput.addEventListener('focus', () => {
            amountInput.style.color = '#000'; //聚焦时，输入文字变黑色
            if (amountInput.value === '0.00' || amountInput.value === '') {
                amountInput.placeholder = ''; //聚焦时清空占位符
            }
        });

        amountInput.addEventListener('blur', () => {
            if (amountInput.value === '') {
                amountInput.style.color = '#ccc'; //失焦且为空时，文字恢复灰色
                amountInput.placeholder = '0.00'; //恢复占位符
            }
        });

        // 返回按钮
        document.getElementById('back-from-redpacket')?.addEventListener('click', () => this.app.render());

        // 确认发送红包 (逻辑保持不变)
        document.getElementById('confirm-redpacket')?.addEventListener('click', async () => {
            const amount = amountInput.value;
            const wish = document.getElementById('redpacket-wish').value || '恭喜发财，大吉大利';

            if (!amount || isNaN(amount) || amount <= 0) {
                this.app.phoneShell.showNotification('提示', '请输入正确的金额', '⚠️');
                return;
            }

            // 检查钱包余额
            const currentBalance = this.app.wechatData.getWalletBalance();
            if (currentBalance !== null && parseFloat(amount) > currentBalance) {
                this.app.phoneShell.showNotification('余额不足', `你的零钱只剩 ¥${parseFloat(currentBalance).toFixed(2)} 啦`, '❌');
                return;
            }
            // 扣款
            if (currentBalance !== null) {
                this.app.wechatData.updateWalletBalance(-parseFloat(amount));
            }

            this.app.wechatData.addMessage(this.app.currentChat.id, {
                id: `rp_${Date.now()}`,
                from: 'me',
                type: 'redpacket',
                content: `[红包] ¥${parseFloat(amount).toFixed(2)} ${wish}`,
                amount: parseFloat(amount).toFixed(2),
                wish: wish,
                status: 'sent'
            });

            this.app.render();

            this.app.phoneShell.showNotification('红包已发送', `已向${this.app.currentChat.name}发送¥${amount}红包`, '🧧');

            // 🔥 如果开启在线模式，触发连发倒计时
            if (this.isOnlineMode()) {
                this._enqueuePendingChat(this.app.currentChat.id);
            }
        });
    }

    // 🎨 添加自定义表情弹窗
    showAddCustomEmojiDialog() {
        const html = `
        <div class="wechat-app">
            <div class="wechat-header">
                <div class="wechat-header-left">
                    <button class="wechat-back-btn" id="back-from-add-emoji">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                </div>
                <div class="wechat-header-title">添加表情</div>
                <div class="wechat-header-right"></div>
            </div>
            
            <div class="wechat-content" style="background: #ededed; padding: 20px;">
                <div style="background: #fff; border-radius: 12px; padding: 25px; text-align: center;">
                    <div style="font-size: 14px; color: #666; margin-bottom: 12px;">选择图片后自动上传（支持批量）</div>
                    <input type="file" id="emoji-image-upload" accept="image/png, image/jpeg, image/gif, image/webp, image/*" multiple style="display: none;">
                    <button id="pick-custom-emoji" style="
                        width: 100%;
                        padding: 14px;
                        background: #07c160;
                        color: #fff;
                        border: none;
                        border-radius: 8px;
                        font-size: 16px;
                        font-weight: 500;
                        cursor: pointer;
                    ">选择图片</button>
                    <div id="emoji-select-hint" style="text-align:left; font-size:12px; color:#999; margin-top:12px;">大图会在上传前等比缩小到最长边 1024px，原图超过 10MB 会跳过。</div>
                </div>
            </div>
        </div>
    `;

        this.app.phoneShell.setContent(html);
        const currentView = document.querySelector('.phone-view-current') || document;
        const query = (selector) => currentView.querySelector(selector);

        const EMOJI_MAX_DIMENSION = 1024;
        const EMOJI_RAW_FILE_MAX_SIZE = 10 * 1024 * 1024;
        const selectedNameSet = new Set();
        let isUploading = false;
        const buildEmojiName = (fileName = '', fallbackIndex = 1) => {
            const rawBase = String(fileName || '')
                .replace(/\.[^.]+$/, '')
                .replace(/[\r\n\t]/g, ' ')
                .replace(/[<>]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            // 默认直接采用文件名（去扩展名），让用户可通过电脑改名后一键上传
            const base = rawBase.slice(0, 20);
            const defaultBase = base || `表情${fallbackIndex}`;
            let candidate = defaultBase;
            let i = 2;
            while (selectedNameSet.has(candidate)) {
                candidate = `${defaultBase.slice(0, Math.max(1, 20 - String(i).length))}${i}`;
                i += 1;
            }
            selectedNameSet.add(candidate);
            return candidate;
        };
        const sanitizeEmojiName = (value = '', fallback = '') => {
            const trimmed = String(value || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 20);
            return trimmed || fallback;
        };

        const resizeEmojiImageIfNeeded = async (file) => {
            if (!file?.type?.startsWith?.('image/')) {
                return { file, resized: false };
            }
            // GIF 可能包含动画，保持原文件避免破坏动图
            if (file.type === 'image/gif') {
                return { file, resized: false };
            }

            const objectUrl = URL.createObjectURL(file);
            try {
                const img = await new Promise((resolve, reject) => {
                    const image = new Image();
                    image.onload = () => resolve(image);
                    image.onerror = () => reject(new Error('图片解码失败'));
                    image.src = objectUrl;
                });

                const srcWidth = Number(img?.naturalWidth || 0);
                const srcHeight = Number(img?.naturalHeight || 0);
                if (srcWidth <= 0 || srcHeight <= 0) {
                    return { file, resized: false };
                }

                const scale = Math.min(1, EMOJI_MAX_DIMENSION / Math.max(srcWidth, srcHeight));
                if (scale >= 1) {
                    return { file, resized: false };
                }

                const targetWidth = Math.max(1, Math.round(srcWidth * scale));
                const targetHeight = Math.max(1, Math.round(srcHeight * scale));
                const canvas = document.createElement('canvas');
                canvas.width = targetWidth;
                canvas.height = targetHeight;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    return { file, resized: false };
                }
                ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

                const targetType = file.type === 'image/png'
                    ? 'image/png'
                    : (file.type === 'image/webp' ? 'image/webp' : 'image/jpeg');
                const quality = targetType === 'image/jpeg' || targetType === 'image/webp' ? 0.9 : undefined;

                const resizedBlob = await new Promise((resolve, reject) => {
                    canvas.toBlob((blob) => {
                        if (blob) resolve(blob);
                        else reject(new Error('图片缩放失败'));
                    }, targetType, quality);
                });

                const resizedFile = new File([resizedBlob], file.name, {
                    type: resizedBlob.type || targetType,
                    lastModified: Date.now()
                });
                return { file: resizedFile, resized: true };
            } catch (err) {
                console.warn('表情图片缩放失败，已回退原图上传:', err);
                return { file, resized: false };
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        };

        const uploadCustomEmojiBatch = async (items = []) => {
            let successCount = 0;
            let failCount = 0;
            let resizedCount = 0;

            for (let i = 0; i < items.length; i += 1) {
                const item = items[i];
                const originalFile = item.file;
                const emojiDescription = sanitizeEmojiName(item.name, `表情${i + 1}`);

                try {
                    const { file, resized } = await resizeEmojiImageIfNeeded(originalFile);
                    if (resized) resizedCount += 1;

                    const finalUrl = await window.VirtualPhone?.imageManager?.uploadBlob?.(file, 'emoji');
                    if (!finalUrl) throw new Error('图片上传管理器未初始化');

                    this.app.wechatData.addCustomEmoji({
                        name: emojiDescription,
                        description: emojiDescription,
                        image: finalUrl
                    });
                    successCount += 1;
                } catch (err) {
                    failCount += 1;
                    console.warn('表情包上传失败:', err);
                }
            }

            return { successCount, failCount, resizedCount };
        };

        query('#back-from-add-emoji')?.addEventListener('click', () => {
            this.app.render();
        });

        query('#pick-custom-emoji')?.addEventListener('click', () => {
            if (isUploading) return;
            query('#emoji-image-upload')?.click();
        });

        query('#emoji-image-upload')?.addEventListener('change', async (e) => {
            const files = Array.from(e?.target?.files || []);
            e.target.value = '';
            if (!files.length || isUploading) return;

            let skipped = 0;
            const selectedItems = [];
            for (const file of files) {
                if (!file?.type?.startsWith?.('image/')) {
                    skipped += 1;
                    continue;
                }
                if (file.size > EMOJI_RAW_FILE_MAX_SIZE) {
                    skipped += 1;
                    continue;
                }
                try {
                    const autoName = buildEmojiName(file?.name, selectedItems.length + 1);
                    selectedItems.push({
                        file,
                        name: autoName
                    });
                } catch (err) {
                    skipped += 1;
                }
            }

            if (skipped > 0) {
                this.app.phoneShell.showNotification('提示', `已跳过 ${skipped} 张不合规图片`, '⚠️');
            }
            if (selectedItems.length === 0) {
                this.app.phoneShell.showNotification('提示', '请先选择至少一张图片', '⚠️');
                return;
            }

            isUploading = true;
            const pickBtn = query('#pick-custom-emoji');
            if (pickBtn) pickBtn.disabled = true;
            this.app.phoneShell.showNotification('处理中', `正在上传 ${selectedItems.length} 张表情...`, '⏳');

            try {
                const { successCount, failCount, resizedCount } = await uploadCustomEmojiBatch(selectedItems);

                if (successCount > 0) {
                    const suffix = failCount > 0 ? `，失败 ${failCount} 张` : '';
                    const resizedHint = resizedCount > 0 ? `，已等比缩小 ${resizedCount} 张` : '';
                    this.app.phoneShell.showNotification('添加成功', `已添加 ${successCount} 张表情${resizedHint}${suffix}`, '✅');
                    this.emojiTab = 'custom';
                    setTimeout(() => this.app.render(), 300);
                } else {
                    this.app.phoneShell.showNotification('上传失败', '表情上传失败，请检查酒馆后台', '❌');
                }
            } finally {
                if (pickBtn) pickBtn.disabled = false;
                isUploading = false;
            }
        });
    }

    async manageCustomEmoji(emojiId) {
        const emoji = this.app.wechatData.getCustomEmoji(emojiId);
        if (!emoji) return;

        const currentDescription = String(emoji.description || emoji.name || '').trim();
        const nextDescriptionRaw = window.prompt(
            '修改这个自定义表情的线下描述。\n\n线上发送时仍然发图片；只有线下正文注入时会转成这个描述。\n\n输入 /delete 可删除该表情。',
            currentDescription
        );

        if (nextDescriptionRaw === null) return;

        const normalized = String(nextDescriptionRaw || '').replace(/\s+/g, ' ').trim().slice(0, 20);
        if (normalized === '/delete') {
            const ok = window.confirm(`确定删除表情“${emoji.name || currentDescription || '未命名表情'}”吗？`);
            if (!ok) return;

            let fileCleanupFailed = false;
            const imageManager = window.VirtualPhone?.imageManager;
            if (imageManager?.deleteManagedBackgroundByPath) {
                try {
                    const result = await imageManager.deleteManagedBackgroundByPath(emoji.image, { quiet: true });
                    fileCleanupFailed = result?.attempted === true && result?.success !== true;
                } catch (e) {
                    fileCleanupFailed = true;
                }
            }

            this.app.wechatData.deleteCustomEmoji(emojiId);
            this.app.phoneShell.showNotification(
                '已删除',
                fileCleanupFailed ? '自定义表情已删除（旧图片清理失败）' : '自定义表情已删除',
                fileCleanupFailed ? '⚠️' : '🗑️'
            );
            this.app.render();
            return;
        }

        if (!normalized) {
            this.app.phoneShell.showNotification('提示', '描述不能为空', '⚠️');
            return;
        }

        this.app.wechatData.updateCustomEmoji(emojiId, {
            name: normalized,
            description: normalized
        });
        this.app.phoneShell.showNotification('已更新', '表情描述已保存', '✅');
        this.app.render();
    }

    // 🔔 通用AI通知方法
    async notifyAI(message) {
        if (!this.isOnlineMode()) return;

        try {
            const context = window.SillyTavern?.getContext?.();
            if (!context) return;

            const prompt = `${context.name1 || '用户'}${message}`;

            // 静默调用AI
            await this.sendToAIHidden(prompt, context);

        } catch (error) {
            console.error('❌ 通知AI失败:', error);
        }
    }

    // 🧧 打开红包详情界面（全新）
    openRedPacket(messageId) {
        const chatId = this.app.currentChat?.id;
        if (!chatId) return;
        const messages = this.app.wechatData.getMessages(chatId);
        const message = messages.find(m => m.id === messageId);
        if (!message) return;

        const isMe = message.from === 'me' || message.from === this.app.wechatData.getUserInfo().name;
        let resolvedStatus = String(message.status || '').trim();
        let isOpened = resolvedStatus === 'opened';
        let isRefunded = resolvedStatus === 'refunded';
        const contact = this.app.wechatData.getContactByName(message.from);

        if (!isMe && !isOpened && !isRefunded) {
            const updatedMessage = this.app.wechatData.updateMessageById(chatId, messageId, { status: 'opened' });
            resolvedStatus = String(updatedMessage?.status || 'opened').trim();
            isOpened = resolvedStatus === 'opened';
            isRefunded = resolvedStatus === 'refunded';
            // 收红包，加钱
            const rpAmount = parseFloat(message.amount) || 0;
            this.app.wechatData.updateWalletBalance(rpAmount);
            this.app.phoneShell.showNotification('微信红包', `已存入零钱: ¥${rpAmount.toFixed(2)}`, '');
        }

        const senderName = message.from === 'me' ? this.app.wechatData.getUserInfo().name : message.from;
        const av = contact?.avatar || (message.from === 'me' ? this.app.wechatData.getUserInfo().avatar : '👤');
        const avatarHtml = this.app.renderAvatar(av, '👤', senderName);
        const redPacketStatusText = isRefunded
            ? (isMe ? '红包已退回' : '红包已被退回')
            : (isMe ? (isOpened ? '红包已被领取' : '红包已发出') : '已存入零钱');

        const html = `
            <div class="wechat-app" style="position: relative;">
                <div id="redpacket-detail-view" style="
                    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                    background-color: #fff; z-index: 10; display: flex; flex-direction: column;
                ">
                    <!-- 顶部红色弧形 -->
                    <div style="background: #e75a46; height: 60px; border-radius: 0 0 50% 50% / 0 0 20px 20px; position: relative;">
                        <button class="wechat-back-btn" id="back-from-rp-detail" style="position:absolute; top:30px; right:12px; background:none; border:none; color:#fff; font-size:14px; cursor:pointer;">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>

                    <!-- 红包内容 -->
                    <div style="text-align: center; padding: 20px 16px 0;">
                        <div style="display:flex; align-items:center; justify-content:center; margin-bottom:6px;">
                            <div style="width:28px; height:28px; border-radius:50%; background:#ddd; margin-right:6px; display:flex; align-items:center; justify-content:center; overflow:hidden; font-size:14px;">
                                ${avatarHtml}
                            </div>
                            <span style="font-size:13px; color:#000;">${senderName}发出的红包</span>
                        </div>
                        <div style="font-size:11px; color:#999; margin-bottom:16px;">${message.wish || '恭喜发财，大吉大利'}</div>
                        <div style="margin-bottom:4px;">
                            <span style="font-size:28px; font-weight:bold; color:#c4884f;">${message.amount}</span>
                            <span style="font-size:12px; color:#c4884f; margin-left:2px;">元</span>
                        </div>
                        <div style="font-size:11px; color:#e6a158;">${redPacketStatusText}</div>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'wechat-redpacket-detail');

        const backBtn = document.getElementById('back-from-rp-detail');
        if (backBtn) backBtn.onclick = () => this.app.render();
    }

    // 💰 打开转账详情界面
    openTransferDetail(messageId) {
        const chatId = this.app.currentChat?.id;
        if (!chatId) return;
        const messages = this.app.wechatData.getMessages(chatId);
        const message = messages.find(m => m.id === messageId);
        if (!message) return;

        const isMe = message.from === 'me' || message.from === this.app.wechatData.getUserInfo().name;
        const formattedAmount = parseFloat(message.amount || 0).toFixed(2);
        let resolvedStatus = String(message.status || '').trim();
        
        // 对方发来的转账，如果还没被收款（用 status 记录），点击后存入钱包
        if (!isMe && resolvedStatus !== 'received' && resolvedStatus !== 'refunded') {
            const updatedMessage = this.app.wechatData.updateMessageById(chatId, messageId, { status: 'received' });
            resolvedStatus = String(updatedMessage?.status || 'received').trim();
            this.app.wechatData.updateWalletBalance(parseFloat(formattedAmount));
            this.app.wechatData.addMessage(chatId, {
                from: 'system',
                type: 'system',
                content: '你已收款'
            });
        }

        const now = new Date();
        const timeStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        const isTransferRefunded = resolvedStatus === 'refunded';
        const isTransferReceived = resolvedStatus === 'received';
        const statusTitle = isTransferRefunded
            ? (isMe ? '转账已退回' : '你已退回该笔转账')
            : (isMe
                ? (isTransferReceived ? '对方已收款' : '待对方确认收款')
                : '你已收款，资金已存入零钱');
        const balanceLabel = isTransferRefunded
            ? (isMe ? '已退回零钱' : '未存入零钱')
            : '零钱余额';
        const receiveTimeLabel = isTransferRefunded ? '退回时间' : '收款时间';

        const html = `
            <div class="wechat-app" style="position: relative;">
                <div id="transfer-detail-view" style="
                    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                    background-color: #fff; z-index: 10; display: flex; flex-direction: column;
                ">
                    <!-- 顶部返回 -->
                    <div style="padding: 34px 12px 0;">
                        <div class="wechat-header-title" style="display:none;">转账详情</div>
                        <button class="wechat-back-btn" id="back-from-transfer-detail" style="background:none; border:none; color:#000; font-size:14px; cursor:pointer; padding:0;">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>

                    <!-- 主内容 -->
                    <div style="text-align:center; padding: 24px 16px 0;">
                        <!-- 绿色勾 -->
                        <div style="width:44px; height:44px; border-radius:50%; background:#07c160; margin:0 auto 12px; display:flex; align-items:center; justify-content:center;">
                            <i class="fa-solid fa-check" style="color:#fff; font-size:20px;"></i>
                        </div>
                        <div style="font-size:12px; color:#000; margin-bottom:10px;">${statusTitle}</div>
                        <div style="font-size:28px; font-weight:bold; color:#000; margin-bottom:4px;">¥ ${formattedAmount}</div>
                        <div style="font-size:11px; color:#07c160; margin-bottom:16px;">${balanceLabel}</div>
                    </div>

                    <!-- 时间信息 -->
                    <div style="margin: 0 16px; border-top:1px solid #f0f0f0; padding:10px 0;">
                        <div style="display:flex; justify-content:space-between; font-size:11px; color:#888; margin-bottom:6px;">
                            <span>转账时间</span><span>${timeStr}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; font-size:11px; color:#888;">
                            <span>${receiveTimeLabel}</span><span>${timeStr}</span>
                        </div>
                    </div>

                    <!-- 零钱通广告 -->
                    <div style="margin: 0 16px; border-top:1px solid #f0f0f0; padding:10px 0; display:flex; align-items:center;">
                        <div style="width:28px; height:28px; border-radius:50%; background:linear-gradient(135deg,#f7d86c,#e6b422); margin-right:8px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                            <span style="font-size:12px;">💎</span>
                        </div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:10px; color:#888;">零钱通 七日年化2.59%</div>
                            <div style="font-size:11px; color:#000;">转入零钱通 省心赚收益</div>
                        </div>
                        <button style="background:#07c160; color:#fff; border:none; border-radius:4px; padding:4px 12px; font-size:11px; cursor:pointer; flex-shrink:0;">转入</button>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'wechat-transfer-detail');

        const currentView = document.querySelector('.phone-view-current') || document;
        const backBtn = currentView.querySelector('#back-from-transfer-detail');
        if (backBtn) backBtn.onclick = () => this.app.render();
    }

    // 🔥 群聊设置页面（点击群聊头部标题进入）
    showGroupSettings(options = {}) {
        const chat = this.app.currentChat;
        if (!chat || chat.type !== 'group') return;
        const returnToChatList = options?.returnToChatList === true;
        const liveChat = this.app.wechatData.getChat(chat.id) || chat;
        let isGroupMutating = false;

        // 🔥 群成员数量 +1，因为用户自己也在群里（但不加入白名单）
        const memberCount = (liveChat.members?.length || 0) + 1;
        const userInfo = this.app.wechatData.getUserInfo();

        const html = `
        <div class="wechat-app">
            <div class="wechat-header">
                <div class="wechat-header-left">
                    <button class="wechat-back-btn" id="back-from-group-settings">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                </div>
                <div class="wechat-header-title">聊天信息(${memberCount})</div>
                <div class="wechat-header-right"></div>
            </div>

            <div class="wechat-content" style="background: #ededed;">
                <!-- 群头像区域 -->
                <div style="background: #fff; padding: 20px; margin-bottom: 10px;">
                    <div style="text-align: center; margin-bottom: 15px; color: #999; font-size: 13px;">
                        点击头像更换
                    </div>
                    <div id="group-avatar-preview" style="
                        width: 80px;
                        height: 80px;
                        border-radius: 10px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        margin: 0 auto;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 40px;
                        cursor: pointer;
                        overflow: hidden;
                    ">${this.app.renderAvatar(chat.avatar, '👥', chat.name)}</div>
                    <input type="file" id="group-avatar-upload" accept="image/png, image/jpeg, image/gif, image/webp, image/*" style="display: none;">
                </div>

                <!-- 群名称 -->
                <div style="background: #fff; padding: 15px 20px; margin-bottom: 10px;">
                    <div style="color: #999; font-size: 13px; margin-bottom: 8px;">群名称</div>
                    <input type="text" id="group-name-input" value="${liveChat.name}"
                           placeholder="设置群名称" style="
                        width: 100%;
                        padding: 10px;
                        border: 1px solid #e5e5e5;
                        border-radius: 6px;
                        font-size: 15px;
                        box-sizing: border-box;
                    ">
                </div>

                <!-- 群成员列表 -->
                <div style="background: #fff; padding: 15px 20px; margin-bottom: 10px;">
                    <div style="color: #999; font-size: 13px; margin-bottom: 12px;">群成员(${memberCount}人)</div>
                    <div id="group-members-grid" style="display: flex; flex-wrap: wrap; gap: 10px;">
                        ${(liveChat.members || []).map(member => {
            const contact = this.app.wechatData.getContactByName(member);
            const avatar = contact?.avatar || '👤';
            const memberToken = this._encodeDataToken(member);
            const memberLabel = this._escapeHtml(member);
            return `
                                <div class="group-member-item" data-member="${memberToken}" style="text-align: center; width: 50px; position: relative;">
                                    <div style="
                                        width: 44px;
                                        height: 44px;
                                        border-radius: 6px;
                                        background: #f0f0f0;
                                        display: flex;
                                        align-items: center;
                                        justify-content: center;
                                        font-size: 22px;
                                        overflow: hidden;
                                        margin: 0 auto 4px;
                                    ">${this.app.renderAvatar(avatar, '👤', member)}</div>
                                    <div style="font-size: 10px; color: #666; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${memberLabel}</div>
                                    <button class="remove-member-btn" data-member="${memberToken}" style="
                                        position: absolute;
                                        top: -4px;
                                        right: 0;
                                        width: 16px;
                                        height: 16px;
                                        border-radius: 50%;
                                        background: #ff3b30;
                                        color: #fff;
                                        border: none;
                                        font-size: 10px;
                                        cursor: pointer;
                                        display: flex;
                                        align-items: center;
                                        justify-content: center;
                                    "><i class="fa-solid fa-minus" style="font-size: 8px;"></i></button>
                                </div>
                            `;
        }).join('')}
                        <!-- 添加成员按钮 -->
                        <div id="add-member-btn" style="text-align: center; width: 50px; cursor: pointer;">
                            <div style="
                                width: 44px;
                                height: 44px;
                                border-radius: 6px;
                                background: #fff;
                                border: 1px dashed #ccc;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                font-size: 18px;
                                color: #ccc;
                                margin: 0 auto 4px;
                            "><i class="fa-solid fa-plus"></i></div>
                            <div style="font-size: 10px; color: #999;">添加</div>
                        </div>
                    </div>
                </div>

                <!-- 保存按钮 -->
                <div style="padding: 20px;">
                    <button id="save-group-settings" style="
                        width: 100%;
                        padding: 12px;
                        background: transparent;
                        color: #576b95;
                        border: 1px solid #576b95;
                        border-radius: 6px;
                        font-size: 15px;
                        cursor: pointer;
                    ">保存</button>
                </div>
            </div>
        </div>
    `;

        this.app.phoneShell.setContent(html, `wechat-group-settings-${liveChat.id}`);

        // 🔥 临时存储
        let newAvatar = null;
        const originalName = liveChat.name;
        const currentView = document.querySelector('.phone-view-current') || document;
        const query = (selector) => currentView.querySelector(selector);

        // 返回按钮
        query('#back-from-group-settings')?.addEventListener('click', () => {
            if (returnToChatList) {
                this.app.currentChat = null;
                this.app.currentView = 'chats';
            }
            this.app.render();
        });

        // 点击头像区域
        query('#group-avatar-preview')?.addEventListener('click', () => {
            query('#group-avatar-upload')?.click();
        });

        // 上传头像
        query('#group-avatar-upload')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                if (file.size > 5 * 1024 * 1024) {
                    this.app.phoneShell.showNotification('提示', '图片太大，请选择小于5MB的图片', '⚠️');
                    return;
                }

                // 本地预览（不写入持久数据）
                const reader = new FileReader();
                reader.onload = (e) => {
                    const preview = query('#group-avatar-preview');
                    if (preview) preview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;">`;
                };
                reader.readAsDataURL(file);

                // 上传到服务器
                try {
                    this.app.phoneShell.showNotification('处理中', '正在上传群头像...', '⏳');
                    newAvatar = await window.VirtualPhone?.imageManager?.uploadBlob?.(file, 'group_avatar');
                    if (!newAvatar) throw new Error('图片上传管理器未初始化');
                    this.app.phoneShell.showNotification('成功', '群头像已上传', '✅');
                } catch (err) {
                    console.warn('群头像上传失败:', err);
                    this.app.phoneShell.showNotification('上传失败', err?.message || '群头像上传失败', '❌');
                }
            }
        });

        // 🔥 移除成员按钮
        currentView.querySelectorAll('.remove-member-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (isGroupMutating) return;
                const memberName = this._decodeDataToken(btn.dataset.member);
                if (!memberName) return;
                isGroupMutating = true;

                if (!liveChat.members || liveChat.members.length <= 2) {
                    this.app.phoneShell.showNotification('提示', '群聊至少需要2人', '⚠️');
                    isGroupMutating = false;
                    return;
                }

                // 从成员列表移除
                liveChat.members = liveChat.members.filter(m => m !== memberName);

                // 🔥 同步更新 wechatData 中的聊天数据
                const dataChat = this.app.wechatData.getChat(liveChat.id);
                if (dataChat) {
                    dataChat.members = liveChat.members;
                    this.app.currentChat = dataChat;
                }

                // 添加系统消息
                this.app.wechatData.addMessage(liveChat.id, {
                    type: 'system',
                    from: 'system',
                    content: `"${memberName}" 被移出了群聊`
                });

                // 刷新页面
                setTimeout(() => this.showGroupSettings({ returnToChatList }), 300);
            });
        });

        // 🔥 添加成员按钮
        query('#add-member-btn')?.addEventListener('click', () => {
            this.showAddMemberDialog(liveChat, { returnToChatList });
        });

        // 保存按钮
        query('#save-group-settings')?.addEventListener('click', () => {
            const newName = query('#group-name-input')?.value?.trim() || '';

            // 🔥 如果群名改变，添加系统消息
            if (newName && newName !== originalName) {
                liveChat.name = newName;
                this.app.wechatData.addMessage(liveChat.id, {
                    type: 'system',
                    from: 'system',
                    content: `群名已改为"${newName}"`
                });
            }

            if (newAvatar) {
                const oldAvatar = String(liveChat.avatar || '').trim();
                liveChat.avatar = newAvatar;
                if (oldAvatar && oldAvatar !== newAvatar) {
                    const cleanupTask = window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(oldAvatar, { quiet: true, skipIfReferenced: true });
                    cleanupTask?.catch?.(() => { });
                }
            }

            // 保存数据
            this.app.wechatData.saveData();

            if (returnToChatList) {
                this.app.currentChat = null;
                this.app.currentView = 'chats';
            }
            this.app.render();
        });
    }

    // 🔥 添加群成员弹窗
    showAddMemberDialog(chat, options = {}) {
        const returnToChatList = options?.returnToChatList === true;
        let isAddingMember = false;
        // 获取所有联系人（排除已在群里的）
        const contacts = this.app.wechatData.getContacts();
        const existingMembers = chat.members || [];
        const availableContacts = contacts.filter(c => !existingMembers.includes(c.name));

        const html = `
        <div class="wechat-app">
            <div class="wechat-header">
                <div class="wechat-header-left">
                    <button class="wechat-back-btn" id="back-from-add-member">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                </div>
                <div class="wechat-header-title">添加群成员</div>
                <div class="wechat-header-right"></div>
            </div>

            <div class="wechat-content" style="background: #ededed;">
                <div style="background: #fff; padding: 12px 15px; margin-bottom: 8px; border-bottom: 0.5px solid #f0f0f0;">
                    <div style="font-size: 12px; color: #999; margin-bottom: 8px;">手动添加（可添加非好友）</div>
                    <div style="display: flex; gap: 8px;">
                        <input id="manual-member-input" type="text" placeholder="输入成员名字" style="
                            flex: 1;
                            min-width: 0;
                            padding: 8px 10px;
                            border: 1px solid #e5e5e5;
                            border-radius: 6px;
                            font-size: 13px;
                            outline: none;
                            box-sizing: border-box;
                        ">
                        <button id="manual-member-add-btn" style="
                            padding: 8px 12px;
                            border: 1px solid #d9d9d9;
                            background: #fff;
                            color: #333;
                            border-radius: 6px;
                            font-size: 12px;
                            cursor: pointer;
                            flex-shrink: 0;
                        ">添加</button>
                    </div>
                </div>

                ${availableContacts.length > 0 ? `
                    <div style="background: #fff; padding: 10px 0;">
                        ${availableContacts.map(contact => `
                            <div class="add-member-item" data-name="${this._encodeDataToken(contact.name)}" style="
                                display: flex;
                                align-items: center;
                                padding: 10px 15px;
                                cursor: pointer;
                                border-bottom: 0.5px solid #f0f0f0;
                            ">
                                <div style="
                                    width: 40px;
                                    height: 40px;
                                    border-radius: 6px;
                                    background: #f0f0f0;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    font-size: 20px;
                                    margin-right: 12px;
                                    overflow: hidden;
                                ">${this.app.renderAvatar(contact.avatar, '👤', contact.name)}</div>
                                <div style="flex: 1;">
                                    <div style="font-size: 15px; color: #000;">${contact.name}</div>
                                </div>
                                <i class="fa-solid fa-plus" style="color: #07c160; font-size: 16px;"></i>
                            </div>
                        `).join('')}
                    </div>
                ` : `
                    <div style="text-align: center; padding: 40px; color: #999;">
                        没有可添加的联系人
                    </div>
                `}
            </div>
        </div>
    `;

        this.app.phoneShell.setContent(html, `wechat-add-member-${chat.id}`);
        const currentView = document.querySelector('.phone-view-current') || document;
        const query = (selector) => currentView.querySelector(selector);

        // 返回按钮
        query('#back-from-add-member')?.addEventListener('click', () => {
            this.showGroupSettings({ returnToChatList });
        });

        const addMemberByName = (rawName) => {
            if (isAddingMember) return;
            const memberName = String(rawName || '').trim();
            if (!memberName) return;
            isAddingMember = true;

            const exists = (chat.members || []).some(m => String(m || '').trim() === memberName);
            if (exists) {
                this.app.phoneShell.showNotification('提示', '该成员已在群里', '⚠️');
                isAddingMember = false;
                return;
            }

            if (!chat.members) chat.members = [];
            chat.members.push(memberName);

            const dataChat = this.app.wechatData.getChat(chat.id);
            if (dataChat) {
                if (!dataChat.members) dataChat.members = [];
                dataChat.members = chat.members;
                this.app.currentChat = dataChat;
            }

            this.app.wechatData.addMessage(chat.id, {
                type: 'system',
                from: 'system',
                content: `"${memberName}" 加入了群聊`
            });
            setTimeout(() => this.showGroupSettings({ returnToChatList }), 220);
        };

        query('#manual-member-add-btn')?.addEventListener('click', () => {
            const input = query('#manual-member-input');
            addMemberByName(input?.value || '');
        });

        query('#manual-member-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addMemberByName(e.currentTarget.value || '');
            }
        });

        // 点击添加成员
        currentView.querySelectorAll('.add-member-item').forEach(item => {
            item.addEventListener('click', () => {
                addMemberByName(this._decodeDataToken(item.dataset.name));
            });
        });
    }

    _encodeDataToken(value) {
        return encodeURIComponent(String(value || ''));
    }

    _decodeDataToken(value) {
        try {
            return decodeURIComponent(String(value || ''));
        } catch (_) {
            return String(value || '');
        }
    }

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = String(text ?? '');
        return div.innerHTML;
    }

    _decodeHtmlEntities(text) {
        const div = document.createElement('div');
        div.innerHTML = String(text ?? '');
        return div.textContent || '';
    }

    _resolveCallTTSContent(text, callType = 'voice') {
        let raw = this._stripCallSpeechPrefix(this._decodeHtmlEntities(text));
        if (callType === 'video') {
            // 视频通话：只读对白，跳过括号内的画面描写（支持中英文括号）
            let prev = '';
            while (raw !== prev) {
                prev = raw;
                raw = raw.replace(/（[^（）]*）|\([^()]*\)/g, ' ');
            }
            raw = raw.replace(/\s+/g, ' ').trim();
        }
        return raw;
    }

    _resolveCallBubbleSenderName(bubble = null) {
        const normalizeName = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        if (!bubble) return normalizeName(this.app?.currentChat?.name || '对方') || '对方';

        let senderName = normalizeName(this._decodeHtmlEntities(bubble.dataset?.sender || ''));
        if (senderName) return senderName;

        const row = bubble.closest('.call-msg-row');
        const senderLabel = row?.querySelector('.call-msg-sender-label') || bubble.parentElement?.querySelector('.call-msg-sender-label');
        senderName = normalizeName(senderLabel?.textContent || senderLabel?.innerText || '');
        if (senderName) return senderName;

        return normalizeName(this.app?.currentChat?.name || '对方') || '对方';
    }

    // 停止微信通话的TTS播放
    stopWechatCallTTS() {
        this.currentTtsRound = null; // 打断任何正在进行的队列
        if (this.audioPlayer) {
            this.audioPlayer.pause();
            this.audioPlayer.src = '';
        }
        if (this.currentPlayingCallMsgId) {
            const prevBubble = document.getElementById(this.currentPlayingCallMsgId);
            if (prevBubble) prevBubble.classList.remove('voice-playing');
            this.currentPlayingCallMsgId = null;
        }
    }

    // 播放微信通话的TTS
    async playWechatCallTTS(text, bubble) {
        const storage = window.VirtualPhone?.storage;
        const ttsManager = window.VirtualPhone?.ttsManager;
        if (!storage) return;
        // 🔥 核心修改：拦截通话全局音色，强制要求专属音色
        let finalVoice = this._getGlobalTtsVoice();
        let finalProvider = String(storage.get('phone-tts-provider') || '').trim();
        const row = bubble?.closest?.('.call-msg-row');
        const isMe = !!(bubble && !bubble.classList.contains('wechat-call-ai-bubble')) ||
            (row && String(row.style?.justifyContent || '').trim() === 'flex-end');
        
        if (!isMe) {
            // 通话中对方说话，优先使用气泡绑定的发送者，再回退到发送者标签
            const senderName = this._resolveCallBubbleSenderName(bubble);
            if (senderName) {
                const { voice, provider } = this._resolveWechatBoundVoiceByName(senderName, { allowGenderFallback: true });
                if (voice) {
                    finalVoice = voice;
                    finalProvider = provider || finalProvider;
                    this._clearMissingBoundVoiceWarn(senderName, { scene: 'call' });
                } else {
                    // 未绑定音色且兜底音色也未配置时，跳过当前语音的生成
                    this._notifyMissingBoundVoiceOnce(senderName, { scene: 'call' });
                    return; 
                }
            }
        }
        const voice = finalVoice;
        const provider = finalProvider;

        if (!ttsManager) return;

        try {
            // 停止上一个
            if (this.currentPlayingCallMsgId) {
                const prevBubble = document.getElementById(this.currentPlayingCallMsgId);
                if (prevBubble) prevBubble.classList.remove('voice-playing');
            }

            const blobUrl = await ttsManager.requestTTS(text, { provider: provider || undefined, voice: voice || undefined });

            this.audioPlayer.src = blobUrl;
            this.currentPlayingCallMsgId = bubble ? bubble.id : null;
            if (bubble) bubble.classList.add('voice-playing');

            await new Promise((resolve, reject) => {
                this.audioPlayer.onended = () => {
                    if (bubble) bubble.classList.remove('voice-playing');
                    URL.revokeObjectURL(blobUrl);
                    this.currentPlayingCallMsgId = null;
                    resolve();
                };
                this.audioPlayer.onerror = (e) => {
                    if (bubble) bubble.classList.remove('voice-playing');
                    URL.revokeObjectURL(blobUrl);
                    this.currentPlayingCallMsgId = null;
                    resolve(); // 容错继续下一个
                };
                this.audioPlayer.play().catch(() => resolve());
            });
        } catch (error) {
            console.error('Call TTS Error:', error);
            if (bubble) bubble.classList.remove('voice-playing');
        }
    }

    // 绑定微信通话气泡点击连播事件
    bindCallBubbleClickEvents(messagesDiv) {
        if (!messagesDiv || messagesDiv._callEventBound) return;
        messagesDiv._callEventBound = true;
        messagesDiv.addEventListener('click', async (e) => {
            const bubble = e.target.closest('.wechat-call-ai-bubble');
            if (!bubble) return;
            
            // 🔥 如果正在编辑文本，或者刚刚结束长按，禁止触发语音播报
            if (bubble.dataset.isEditing === "true" || bubble.dataset.suppressClick === "true") return;

            // 再次点击正在播放的气泡 -> 停止播放并中断当前序列
            if (this.currentPlayingCallMsgId === bubble.id && !this.audioPlayer.paused) {
                this.stopWechatCallTTS();
                return;
            }

            const roundId = bubble.dataset.roundId;
            this.currentTtsRound = 'manual_' + Date.now(); // 生成新手工队列标记，打断旧队列
            const currentManualRound = this.currentTtsRound;

            const allBubbles = Array.from(messagesDiv.querySelectorAll(`.wechat-call-ai-bubble[data-round-id="${roundId}"]`));
            const startIndex = allBubbles.indexOf(bubble);
            if (startIndex !== -1) {
                for (let i = startIndex; i < allBubbles.length; i++) {
                    if (this.currentTtsRound !== currentManualRound) break; // 中途被打断
                    const b = allBubbles[i];
                    const ttsText = this._resolveCallTTSContent(b.dataset.text, b.dataset.callType || 'voice');
                    if (!ttsText) continue;
                    await this.playWechatCallTTS(ttsText, b);
                }
            }
        });
    }

    // 🔥 智能滚动：只有用户在底部附近时才自动滚动
    scrollToBottomIfNeeded(force = false) {
        const messagesDiv = document.getElementById('chat-messages');
        if (!messagesDiv) return;

        // 计算用户是否在底部附近（距离底部100px以内）
        const isNearBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight < 100;

        // 强制滚动（首次加载）或用户在底部附近时才滚动
        if (force || isNearBottom) {
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
    }

    // 🔥 新增：绑定通话界面中的气泡长按（编辑/删除）事件
    bindCallMessageLongPressEvents(messagesDiv, chatMessages) {
        if (!messagesDiv || messagesDiv._callLongPressBound) return;
        messagesDiv._callLongPressBound = true;

        let pressTimer;
        let touchStartTarget = null;

        const showMenu = (bubbleEl, index) => {
            // 先移除已有的菜单
            document.querySelectorAll('.call-action-menu').forEach(m => m.remove());

            const isRight = bubbleEl.parentElement.style.justifyContent === 'flex-end';

            const menuEl = document.createElement('div');
            menuEl.className = 'call-action-menu';
            menuEl.style.cssText = `
                position: absolute;
                top: -36px;
                ${isRight ? 'right: 0;' : 'left: 0;'}
                z-index: 1000;
                display: flex;
                background: rgba(255,255,255,0.95);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                border-radius: 6px;
                overflow: hidden;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                white-space: nowrap;
            `;
            menuEl.innerHTML = `
                <button class="call-action-btn" data-action="edit" style="background:transparent;color:#333;border:none;border-right:1px solid #eee;padding:6px 12px;font-size:12px;cursor:pointer;">编辑</button>
                <button class="call-action-btn" data-action="delete" style="background:transparent;color:#ff3b30;border:none;padding:6px 12px;font-size:12px;cursor:pointer;">删除</button>
            `;

            bubbleEl.appendChild(menuEl);

            menuEl.querySelectorAll('.call-action-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    menuEl.remove();

                    if (action === 'delete') {
                        // 隐藏气泡并打上删除标记
                        bubbleEl.closest('.call-msg-row').style.display = 'none';
                        chatMessages[index].isDeleted = true;
                    } else if (action === 'edit') {
                        const originalText = chatMessages[index].text;
                        const isMe = chatMessages[index].from === 'me';
                        this._setMessageInlineEditMode(true, this.app.currentChat?.id);
                        
                        // 🔥 修复1：记录原宽度，并在编辑时强行撑满气泡（不超过 max-width 75% 的限制）
                        const originalWidth = bubbleEl.style.width;
                        bubbleEl.style.width = '100%';
                        bubbleEl.style.minWidth = '140px'; 
                        
                        // 🔥 修复2：移除 textarea 的固定 min-width，改为高度自适应 (overflow-y:auto)
                        bubbleEl.innerHTML = `
                            <textarea class="call-inline-edit" style="width:100%; height:auto; min-height:40px; max-height:120px; padding:6px; border:none; border-radius:6px; font-size:13px; resize:none; background:${isMe ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.05)'}; color:#000; outline:none; box-sizing:border-box; font-family:inherit; overflow-y:auto;">${originalText}</textarea>
                            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px;">
                                <button class="call-edit-cancel" style="padding:4px 10px;font-size:11px;border:none;border-radius:4px;background:rgba(0,0,0,0.1);color:#333;cursor:pointer;">取消</button>
                                <button class="call-edit-save" style="padding:4px 10px;font-size:11px;border:none;border-radius:4px;background:#07c160;color:#fff;cursor:pointer;">保存</button>
                            </div>
                        `;
                        
                        const textarea = bubbleEl.querySelector('.call-inline-edit');
                        textarea.focus();

                        // 🔥 修复3：加入文本框高度动态自适应逻辑
                        const adjustHeight = () => {
                            textarea.style.height = '40px'; // 先重置，才能往下缩
                            textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
                        };
                        textarea.addEventListener('input', adjustHeight);
                        setTimeout(adjustHeight, 10); // 初始化时调一次高度
                        
                        // 🛡️ 核心护盾：阻止键盘和输入事件冒泡给酒馆，防止 AutoComplete 插件报错崩溃
                        textarea.addEventListener('input', (ev) => ev.stopPropagation());
                        textarea.addEventListener('keydown', (ev) => ev.stopPropagation());
                        textarea.addEventListener('keyup', (ev) => ev.stopPropagation());
                        textarea.addEventListener('focus', (ev) => ev.stopPropagation());
                        textarea.addEventListener('blur', (ev) => ev.stopPropagation());
                        
                        // 标记处于编辑状态，防止点击触发语音播报
                        bubbleEl.dataset.isEditing = "true";

                        bubbleEl.querySelector('.call-edit-cancel').onclick = (ev) => {
                            ev.stopPropagation();
                            // 🔥 恢复气泡原来的宽度
                            bubbleEl.style.width = originalWidth;
                            bubbleEl.style.minWidth = '';
                            bubbleEl.innerHTML = this._escapeHtml(chatMessages[index].text);
                            delete bubbleEl.dataset.isEditing;
                            this._setMessageInlineEditMode(false, this.app.currentChat?.id);
                        };

                        bubbleEl.querySelector('.call-edit-save').onclick = (ev) => {
                            ev.stopPropagation();
                            const newText = textarea.value.trim();
                            // 🔥 恢复气泡原来的宽度
                            bubbleEl.style.width = originalWidth;
                            bubbleEl.style.minWidth = '';
                            
                            if (newText) {
                                chatMessages[index].text = newText;
                                bubbleEl.innerHTML = this._escapeHtml(newText);
                                // 同步更新 TTS 朗读的文本
                                if(bubbleEl.classList.contains('wechat-call-ai-bubble')) {
                                    bubbleEl.dataset.text = newText;
                                }
                            } else {
                                bubbleEl.innerHTML = this._escapeHtml(chatMessages[index].text);
                            }
                            delete bubbleEl.dataset.isEditing;
                            this._setMessageInlineEditMode(false, this.app.currentChat?.id);
                        };
                    }
                });
            });

            // 点击其他区域自动关闭菜单
            setTimeout(() => {
                document.addEventListener('click', function closeMenu(e) {
                    if (!menuEl.contains(e.target)) {
                        menuEl.remove();
                        document.removeEventListener('click', closeMenu);
                    }
                }, { once: true });
            }, 100);
        };

        const handleStart = (e) => {
            const bubble = e.target.closest('.call-msg-bubble');
            if (!bubble || bubble.dataset.isEditing === "true") return;
            touchStartTarget = bubble;
            
            pressTimer = setTimeout(() => {
                const idx = parseInt(bubble.dataset.msgIdx, 10);
                if (!isNaN(idx)) {
                    showMenu(bubble, idx);
                    // 标记压制点击，防止长按松开时触发TTS
                    bubble.dataset.suppressClick = "true";
                    setTimeout(() => delete bubble.dataset.suppressClick, 400); 
                }
            }, 500);
        };

        const handleEnd = () => { clearTimeout(pressTimer); touchStartTarget = null; };

        messagesDiv.addEventListener('touchstart', handleStart, { passive: true });
        messagesDiv.addEventListener('touchend', handleEnd);
        messagesDiv.addEventListener('touchmove', handleEnd);
        
        // 兼容 PC 端右键和长按
        messagesDiv.addEventListener('mousedown', (e) => {
            if(e.button === 2) { // 右键
                e.preventDefault();
                const bubble = e.target.closest('.call-msg-bubble');
                if (bubble && bubble.dataset.isEditing !== "true") {
                    const idx = parseInt(bubble.dataset.msgIdx, 10);
                    if (!isNaN(idx)) showMenu(bubble, idx);
                }
            } else {
                handleStart(e);
            }
        });
        messagesDiv.addEventListener('mouseup', handleEnd);
        messagesDiv.addEventListener('mouseleave', handleEnd);
        messagesDiv.addEventListener('contextmenu', e => {
            if(e.target.closest('.call-msg-bubble')) e.preventDefault();
        });
    }
}
