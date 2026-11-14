import { CALL_HANGUP_RULE, parseCallHangupReply } from '../../config/call-hangup.js';
/* ========================================================
 *  æŸšæœˆå°æ‰‹æœº (Yuzuki's Little Phone)
 *  ä½œè€… (Author): yuzuki
 * 
 * âš ï¸ ç‰ˆæƒå£°æ˜ (Copyright Notice):
 * 1. ç¦æ­¢å•†ä¸šåŒ–ï¼šæœ¬é¡¹ç›®ä»…ä¾›äº¤æµå­¦ä¹ ï¼Œä¸¥ç¦ä»»ä½•å½¢å¼çš„å€’å–ã€ç›ˆåˆ©ç­‰å•†ä¸šè¡Œä¸ºã€‚
 * 2. ç¦æ­¢äºŒæ”¹å‘å¸ƒï¼šä¸¥ç¦æœªç»æˆæƒä¿®æ”¹ä»£ç åä½œä¸ºç‹¬ç«‹é¡¹ç›®äºŒæ¬¡å‘å¸ƒæˆ–åˆ†å‘ã€‚
 * 3. ç¦æ­¢æŠ„è¢­ï¼šä¸¥ç¦ç›—ç”¨æœ¬é¡¹ç›®çš„æ ¸å¿ƒé€»è¾‘ã€UIè®¾è®¡ä¸ç›¸å…³åŸä»£ç ã€‚
 * 
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */
import { startCallTimer } from '../../config/call-timer.js';
import { parseWechatFile, formatWechatFile, tokenizeWechatFiles, getWechatFileAppearance } from './file-message.js';
import { ImageCropper } from '../settings/image-cropper.js';
import { captureWechatChatSnapshot } from './chat-snapshot.js';
import { applyPhoneTagFilter } from '../../config/tag-filter.js';
import { readPhoneContextLimit } from '../../config/context-settings.js';
import {
    extractImagePromptItems,
    parseImagePromptDescriptionPair,
    readBalancedImagePromptGroup
} from '../../config/image-prompt-format.js';
import { CatboxData } from '../games/catbox/catbox-data.js';
import { parseWangxiangTaskTags, tokenizeWangxiangTaskTags } from '../wangxiang/wangxiang-task-parser.js';
import {
    parseWechatInnerThoughtContent,
    parseWechatTranslationContent,
    parseWechatVoiceContent,
    stripWechatTranslationContent,
    stripWechatTtsNonSpeechContent
} from './voice-text.js';
import { detectImageMime, normalizeImageDataUrlMime, resolveImageMime } from '../../config/image-mime.js';
import {
    getPhoneInlineEmoji,
    renderPhoneInlineEmoji,
    replacePhoneEmojiTokens,
    replacePhoneInlineEmojiTokens,
    replacePhoneNamedEmojiTokens
} from '../../config/phone-emoji.js';

const LOBBY_LINK_CHARACTER_IDS_KEY = 'phone-lobby-link-character-ids';
const LOBBY_LINK_GROUP_IDS_KEY = 'phone-lobby-link-group-ids';
const WECHAT_STICKER_ALAPI_CACHE_KEY = 'phone_wechat_alapi_sticker_cache_v1';
const WECHAT_STICKER_ALAPI_CACHE_MAX = 240;
const WECHAT_STICKER_ALAPI_CACHE_TTL = 90 * 24 * 60 * 60 * 1000;
export const WECHAT_MESSAGE_PAGE_SIZE = 50;
export const WECHAT_AI_IMAGE_TOTAL_CHAR_BUDGET = 384 * 1024;
export const WECHAT_AI_IMAGE_MAX_CHAR_BUDGET = 320 * 1024;

export function getWechatAiImageCharLimit(imageCount = 1) {
    const count = Math.max(1, Number.parseInt(imageCount, 10) || 1);
    return Math.min(WECHAT_AI_IMAGE_MAX_CHAR_BUDGET, Math.floor(WECHAT_AI_IMAGE_TOTAL_CHAR_BUDGET / count));
}

export function buildWechatCharacterCardInfo(character = null) {
    if (!character || typeof character !== 'object') return '';

    const profileLines = [];
    const description = String(character.description || '').trim();
    const personality = String(character.personality || '').trim();
    const scenario = String(character.scenario || '').trim();
    const systemPrompt = String(character.data?.system_prompt || '').trim();

    if (description) profileLines.push(description);
    if (personality) profileLines.push(`æ€§æ ¼: ${personality}`);
    if (scenario) profileLines.push(`åœºæ™¯/èƒŒæ™¯: ${scenario}`);

    const sections = [];
    if (profileLines.length > 0) sections.push(profileLines.join('\n'));
    if (systemPrompt) sections.push(systemPrompt);
    if (sections.length === 0) return '';

    return `ã€è§’è‰²å¡ä¿¡æ¯ã€‘\n${sections.join('\n\n')}`;
}

export function formatWechatTavernContextContent(content = '', { isUser = false, userName = 'ç”¨æˆ·' } = {}) {
    const normalizedContent = String(content || '').trim();
    if (!normalizedContent || !isUser) return normalizedContent;

    const normalizedUserName = String(userName || '').trim() || 'ç”¨æˆ·';
    return `${normalizedUserName}: ${normalizedContent}`;
}

// èŠå¤©ç•Œé¢è§†å›¾
export class ChatView {
    constructor(wechatApp) {
        this.app = wechatApp;
        this.inputText = '';
        this.showEmoji = false;
        this.showMore = false;
        this.showQuickReplies = false;
        this.activeQuickReplyKey = '';
        this.quickReplyTimeText = '';
        this._quickTimeScrollTimers = new Map();
        this._suppressEmptySendUntil = 0;
        this.showToolbar = false; // å·¥å…·æ é»˜è®¤æŠ˜å 
        this.emojiTab = 'default';
        this.isSending = false;  // ğŸ”¥ å‘é€çŠ¶æ€
        this._activeSendingChatId = null;
        this._isFlushingPending = false;
        this.abortController = null;  // ğŸ”¥ ç”¨äºä¸­æ–­è¯·æ±‚
        this.batchTimer = null;  // ğŸ”¥ æ™ºèƒ½è¿å‘å€’è®¡æ—¶
        this.pendingChatIds = new Set(); // ğŸ”¥ è®°å½•ç­‰å¾…ç»Ÿä¸€å‘é€çš„ä¼šè¯é˜Ÿåˆ—
        this.activeQuote = null;  // ğŸ”¥ å½“å‰æ¿€æ´»çš„å¼•ç”¨æ¶ˆæ¯
        this.audioPlayer = new Audio();
        this.currentPlayingMsgId = null;
        this.currentPlayingCallMsgId = null;
        this.currentTtsRound = null;
        this._suppressWeiboCardClickUntil = 0;
        this._suppressXCardClickUntil = 0;
        this._suppressWangxiangCardClickUntil = 0;
        this._suppressPokerCardClickUntil = 0;
        this._suppressWerewolfCardClickUntil = 0;
        this._suppressUndercoverCardClickUntil = 0;
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
        this.customEmojiManageMenuOpen = false;
        this.selectedCustomEmojiIds = new Set();
        this.messageSelectionMode = false;
        this.selectedMessageIds = new Set();
        this.messageSelectionChatId = null;
        this._visibleMessageCounts = new Map();
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

    _resolveCallRecordStartTime(message = {}) {
        const stored = String(message.callStartTime || '').trim();
        if (/^\d{1,2}:\d{2}$/.test(stored)) return stored;

        const endMatch = String(message.time || '').trim().match(/^(\d{1,2}):(\d{2})$/);
        const durationMatch = String(message.duration || '').match(/(?:(\d+)\s*åˆ†)?\s*(?:(\d+)\s*ç§’)?/);
        if (!endMatch || !durationMatch || (!durationMatch[1] && !durationMatch[2])) return '';

        const durationSeconds = (Number(durationMatch[1]) || 0) * 60 + (Number(durationMatch[2]) || 0);
        const elapsedMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
        const endMinutes = (Number(endMatch[1]) * 60) + Number(endMatch[2]);
        const startMinutes = (endMinutes - elapsedMinutes + 24 * 60) % (24 * 60);
        return `${String(Math.floor(startMinutes / 60)).padStart(2, '0')}:${String(startMinutes % 60).padStart(2, '0')}`;
    }

    _formatCallRecordForPrompt(message = {}, userName = 'ç”¨æˆ·', endTimePrefix = '') {
        const callTypeName = message.callType === 'video' ? 'è§†é¢‘é€šè¯' : 'è¯­éŸ³é€šè¯';
        if (message.status !== 'answered') {
            const statusText = (message.status === 'rejected' || message.status === 'declined')
                ? 'å¯¹æ–¹å·²æ‹’ç»'
                : message.status === 'cancelled'
                    ? 'å·²å–æ¶ˆ'
                    : 'æœªæ¥å¬';
            return `${endTimePrefix}[${callTypeName} - ${statusText}]\n`;
        }

        const callStartTime = this._resolveCallRecordStartTime(message);
        const lines = [`${callStartTime ? `[${callStartTime}] ` : ''}[${callTypeName}èŠå¤©è®°å½•]`];
        if (Array.isArray(message.transcript)) {
            message.transcript.forEach((entry) => {
                const speaker = entry?.from === 'me' ? userName : String(entry?.from || 'å¯¹æ–¹');
                const content = String(entry?.text || '').trim();
                if (content) lines.push(`${speaker}: ${content}`);
            });
        }
        const durationText = message.duration ? `ï¼Œæ—¶é•¿ ${message.duration}` : '';
        lines.push(`${endTimePrefix}[${callTypeName}èŠå¤©ç»“æŸ${durationText}]`);
        return `${lines.join('\n')}\n`;
    }

    _stripWechatTagsFromTavernContext(text = '') {
        let out = String(text || '');
        if (!out) return out;

        // çº¿ä¸Šå¾®ä¿¡è¯·æ±‚ä¼šå•ç‹¬æ³¨å…¥ç»“æ„åŒ–çš„å°æ‰‹æœºèŠå¤©è®°å½•ï¼›è¿™é‡Œå‰¥æ‰é…’é¦†æ­£æ–‡é‡Œçš„åŸå§‹
        // <wechat> æ ‡ç­¾ï¼Œé¿å…åŒä¸€æ¡æ‰‹æœºæ¶ˆæ¯ä»æ­£æ–‡æ ‡ç­¾å’Œæ‰‹æœºå­˜æ¡£å„è¿›å…¥ä¸€æ¬¡ä¸Šä¸‹æ–‡ã€‚
        const tagBoundary = '(?:<|&lt;)\\s*wechat\\b(?:(?!>|&gt;)[\\s\\S])*?(?:>|&gt;)';
        const closeBoundary = '(?:<|&lt;)\\s*\\/\\s*wechat\\s*(?:>|&gt;)';
        out = out.replace(new RegExp(`${tagBoundary}[\\s\\S]*?${closeBoundary}`, 'gi'), '');

        return out.replace(/\n{3,}/g, '\n\n').trim();
    }

    _formatRealDateTime(timestamp = Date.now()) {
        const dateObj = new Date(Number(timestamp || Date.now()));
        const pad = (value) => String(value).padStart(2, '0');
        return {
            date: `${dateObj.getFullYear()}å¹´${pad(dateObj.getMonth() + 1)}æœˆ${pad(dateObj.getDate())}æ—¥`,
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
            .replace(/[ï¼ˆ(][^ï¼ˆï¼‰()]*[ï¼‰)]/g, '')
            .toLowerCase();
    }

    _isCurrentWechatUserName(name = '') {
        const rawName = String(name || '').trim();
        const key = this._normalizeLookupName(rawName);
        if (!key) return false;
        if (['me', 'æˆ‘', 'ç”¨æˆ·', 'ç©å®¶', 'user', '{{user}}'].includes(key)) return true;

        const aliases = [];
        const pushAlias = (value) => {
            const alias = String(value || '').trim();
            if (alias) aliases.push(alias);
        };

        try {
            pushAlias(this.app.wechatData?.getUserInfo?.()?.name);
        } catch (e) { }

        try {
            pushAlias(this._safeGetContext?.()?.name1);
        } catch (e) { }

        return aliases.some(alias => this._normalizeLookupName(alias) === key);
    }

    _isOfflineUserReplyCleanEnabled() {
        const raw = window.VirtualPhone?.storage?.get?.('phone-wechat-offline-clean-user-reply-enabled');
        return raw !== false && raw !== 'false';
    }

    _normalizeGeneratedUserReply(message = null, contextLabel = 'å¾®ä¿¡') {
        if (!message || !this._isCurrentWechatUserName(message.sender)) return message;
        if (this._isOfflineUserReplyCleanEnabled()) {
            console.warn('âš ï¸ [å¾®ä¿¡] å·²æŒ‰ç”¨æˆ·å‘è¨€æ¸…æ´—å¼€å…³ä¸¢å¼ƒAIç”Ÿæˆçš„ç”¨æˆ·å‘è¨€:', {
                context: contextLabel,
                sender: message.sender,
                content: message.content || message.specialMessage?.content || ''
            });
            return null;
        }
        return { ...message, sender: 'me' };
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

    _getContactDisplayName(contact = {}, fallback = '') {
        return this.app.wechatData?.getContactDisplayName?.(contact)
            || String(contact?.remark || contact?.nickname || contact?.name || contact?.realName || fallback || '').trim();
    }

    _formatWechatContactNameForPrompt(name = '') {
        const safeName = String(name || '').trim();
        if (!safeName) return '';
        const contact = this._getContactByDisplayName(safeName);
        const displayName = this._getContactDisplayName(contact, safeName) || safeName;
        return contact?.blocked ? `${displayName}ï¼ˆå·²æ‹‰é»‘ï¼‰` : displayName;
    }

    _formatWechatContactListForPrompt(contacts = []) {
        const names = (Array.isArray(contacts) ? contacts : [])
            .map(contact => {
                const name = this._getContactDisplayName(contact);
                return name ? (contact?.blocked ? `${name}ï¼ˆå·²æ‹‰é»‘ï¼‰` : name) : '';
            })
            .filter(Boolean);
        return names.length > 0 ? names.join('ã€') : 'æš‚æ— å¥½å‹';
    }

    _formatGroupMembersForPrompt(members = []) {
        return (Array.isArray(members) ? members : [])
            .map(name => this._formatWechatContactNameForPrompt(name))
            .filter(Boolean);
    }

    _notifyBlockedChatSend(chat = null) {
        const name = String(chat?.name || 'è¯¥å¥½å‹').trim() || 'è¯¥å¥½å‹';
        this.app.phoneShell?.showNotification('æ— æ³•å‘é€', `${name}å·²è¢«æ‹‰é»‘ï¼Œè¯·å…ˆç§»é™¤é»‘åå•`, 'âš ï¸');
    }

    _extractPersonaUsers(context = null) {
        const ctx = context || this._safeGetContext();
        const users = [];
        const seen = new Set();
        const isLikelyValidPersonaName = (value) => {
            const text = String(value || '').trim();
            if (!text) return false;
            const lower = text.toLowerCase();
            if (text === 'æ— ') return false;
            if (lower === 'user avatar' || lower === 'avatar' || lower === 'default') return false;
            if (/\.png$|\.jpe?g$|\.webp$|\.gif$/i.test(text)) return false;
            if (/^\d{10,}[-_a-z0-9.]*$/i.test(text)) return false;
            if (text.length > 40) return false;
            if (/å½“å‰èŠå¤©|å½“å‰è§’è‰²|ç»‘å®š|æ˜ å°„|è®¾å®šæè¿°|persona|avatar/i.test(text)) return false;
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
        const name = String(item?.name || '').trim() || 'æœªå‘½åè§’è‰²';
        const lines = [`- ${name}`];
        const description = String(item?.description || '').trim();
        const personality = String(item?.personality || '').trim();
        const scenario = String(item?.scenario || '').trim();
        const systemPrompt = String(item?.systemPrompt || '').trim();

        if (description) lines.push(`  æè¿°ï¼š${description}`);
        if (personality) lines.push(`  æ€§æ ¼ï¼š${personality}`);
        if (scenario) lines.push(`  åœºæ™¯ï¼š${scenario}`);
        if (systemPrompt) lines.push(`  ç³»ç»Ÿæç¤ºè¯ï¼š${systemPrompt}`);
        if (lines.length === 1) lines.push('  ï¼ˆæš‚æ— å¯ç”¨è¯¦æƒ…ï¼‰');
        return lines.join('\n');
    }

    // ğŸ”¥ åˆ¤æ–­å½“å‰ä¼šè¯æ˜¯å¦å¼€å¯æ‰‹æœºå†… AI äº’åŠ¨ï¼ˆäº’é€šæ¨¡å¼æˆ–çº¿ä¸Šæ¨¡å¼ï¼‰
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

    _shouldUseRealTimeForOnlineChat(options = {}) {
        if (options?.realTimeMode === false) return false;
        if (options?.realTimeMode === true) return true;
        const storage = window.VirtualPhone?.storage;
        if (!storage) return false;
        const context = this._safeGetContext?.();
        const interopKey = this.app?.wechatData?.getOnlineModeStorageKey?.(context) || 'wechat_online_mode';
        const onlineOnlyKey = this.app?.wechatData?.getOnlineOnlyModeStorageKey?.(context) || 'wechat_online_only_mode';
        const interopVal = storage.get(interopKey);
        const interopEnabled = interopVal === true || interopVal === 'true' || interopVal === 1;
        if (interopEnabled) return false;
        const onlineOnlyVal = storage.get(onlineOnlyKey);
        const onlineOnlyEnabled = onlineOnlyVal === true || onlineOnlyVal === 'true' || onlineOnlyVal === 1;
        if (!onlineOnlyEnabled) return false;

        const isLobby = this._isLobbyMode?.(context);
        const timeKey = isLobby
            ? 'phone_lobby_wechat_online_only_real_time_enabled'
            : 'wechat_online_only_real_time_enabled';
        const val = storage.get(timeKey);
        return val === undefined || val === null || val === '' || val === true || val === 'true' || val === 1;
    }

    _buildWechatRealTimeFields(timestamp = Date.now()) {
        const info = this._formatRealDateTime(timestamp);
        return {
            time: info.time,
            date: info.date,
            weekday: this._getWechatWeekdayFromTimestamp(info.timestamp, ''),
            timestamp: info.timestamp,
            realTimestamp: info.timestamp
        };
    }

    _notifyOnlineModeRequired() {
        this.app?.phoneShell?.showNotification?.('ç¦»çº¿æ¨¡å¼', 'è¯·å…ˆåœ¨è®¾ç½®ä¸­å¼€å¯å¾®ä¿¡äº’é€šæ¨¡å¼æˆ–çº¿ä¸Šæ¨¡å¼', 'âš ï¸');
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

    _normalizeWechatResponseBoundaries(text) {
        let out = String(text || '').replace(/\r\n/g, '\n');
        if (!out) return '';

        // Some compatible proxies HTML-escape the response envelope, sometimes twice.
        // Decode only WeChat tag boundaries so message text and other HTML stay inert.
        const escapedBoundary = /(?:&(?:amp;)*lt;|&#0*60;)(\s*\/?\s*wechat\b[^\r\n]*?)(?:&(?:amp;)*gt;|&#0*62;)/gi;
        for (let pass = 0; pass < 3; pass++) {
            const decoded = out.replace(escapedBoundary, '<$1>');
            if (decoded === out) break;
            out = decoded;
        }
        return out;
    }

    _stripWechatBoundaryArtifacts(text) {
        let out = this._normalizeWechatResponseBoundaries(text).trim();
        if (!out) return '';

        // A proxy assistant-prefill can prepend a second <wechat>, while truncated
        // streams may leave an unmatched boundary. Neither is chat message content.
        out = out
            .replace(/^\s*(?:<\s*wechat\b[^>]*>\s*)+/i, '')
            .replace(/(?:\s*<\s*\/\s*wechat\s*>\s*)+$/i, '')
            .replace(/^[\t ]*<\s*\/?\s*wechat\b[^>]*>[\t ]*$/gmi, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        return out;
    }

    _cleanWechatResponsePayload(text) {
        let out = this._normalizeWechatResponseBoundaries(text).trim();
        for (let pass = 0; pass < 3 && out; pass++) {
            const cleaned = this._stripWechatCommentWrapper(this._stripWechatBoundaryArtifacts(out));
            if (cleaned === out) break;
            out = cleaned;
        }
        return this._stripWechatBoundaryArtifacts(out);
    }

    _extractWechatTagPayload(text) {
        const normalized = this._normalizeWechatResponseBoundaries(text);
        const match = normalized.match(/<\s*wechat\b[^>]*>([\s\S]*?)<\s*\/\s*wechat\s*>/i);
        if (!match) return '';
        return this._cleanWechatResponsePayload(match[1]);
    }

    _extractWechatTagPayloadOrSelf(text) {
        const payload = this._extractWechatTagPayload(text);
        if (payload) return payload;
        return this._cleanWechatResponsePayload(text);
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
            this.showTypingStatus('ç­‰å¾…å›å¤', safeChatId);
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

        // å½“å‰ä¼šè¯æ­£åœ¨å‘é€æ—¶ï¼Œç¦æ­¢è¿›å…¥â€œç­‰å¾…å›å¤(é»„ç¯)â€åˆ†æ”¯ï¼Œé¿å…è¦†ç›–å‘é€ä¸­çº¢ç¯ã€‚
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
            this.customEmojiManageMenuOpen = false;
            this._setCustomEmojiSelectionMode(false);
            this.app.render();
            setTimeout(restore, 0);
            return;
        }

        restore();
    }

    _closeActionPanelsAfterImmediateSend() {
        this._collapseTransientInputPanels({ render: true });
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
        this.customEmojiManageMenuOpen = false;
        this.showMore = false;
        this.showQuickReplies = false;
        this.activeQuickReplyKey = '';
        this.quickReplyTimeText = '';
        this._setCustomEmojiSelectionMode(false);
    }

    _collapseTransientInputPanels(options = {}) {
        const shouldRender = this.showEmoji || this.showMore || this.showQuickReplies || this.customEmojiSelectionMode;
        this.hideImageSourceSheet?.();
        this.resetTransientInputPanels();
        if (!shouldRender) return;

        if (options?.render !== false) {
            this.app.render();
            return;
        }

        const currentView = this.getCurrentWechatView ? this.getCurrentWechatView() : document;
        currentView.querySelectorAll('.quick-reply-panel, .emoji-panel, .more-panel').forEach(panel => panel.remove());
        const input = currentView.querySelector('#chat-input') || document.getElementById('chat-input');
        if (input) input.placeholder = 'è¾“å…¥æ¶ˆæ¯...';
        this._syncChatSendButton(input);
    }

    _finishImmediateMediaSend(targetChatId, caretPos = null) {
        const safeChatId = String(targetChatId || '').trim();
        if (!safeChatId) return false;

        const currentView = this.getCurrentWechatView ? this.getCurrentWechatView() : document;
        const input = currentView.querySelector('#chat-input') || document.getElementById('chat-input');
        this._collapseTransientInputPanels({ render: false });

        const messagesDiv = this._getVisibleChatMessagesContainer(safeChatId);
        if (messagesDiv) {
            const messages = this.app.wechatData.getMessages(safeChatId);
            const userInfo = this.app.wechatData.getUserInfo();
            this.smartUpdateMessages(messages, userInfo, { chatId: safeChatId });
        }

        if (input) {
            input.value = this.inputText;
            input.focus();
            const end = input.value.length;
            const targetPos = Number.isFinite(Number(caretPos))
                ? Math.max(0, Math.min(end, Number(caretPos)))
                : end;
            if (typeof input.setSelectionRange === 'function') {
                input.setSelectionRange(targetPos, targetPos);
            }
            this._syncChatSendButton(input);
        }

        const didEnqueue = this._enqueuePendingChat(safeChatId, {
            shouldStartTimer: false,
            shouldShowStatus: false
        });
        if (!didEnqueue) {
            this._notifyOnlineModeRequired();
            return false;
        }

        if (input && document.activeElement === input) {
            clearTimeout(this.batchTimer);
            this.hideTypingStatus();
        } else {
            this._restartPendingTimerIfNeeded(safeChatId);
        }

        return true;
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
            this.app.phoneShell.showNotification('æç¤º', 'è¯·å…ˆé€‰æ‹©è¦åˆ é™¤çš„è¡¨æƒ…', 'âš ï¸');
            return;
        }

        const allCustomEmojis = this.app.wechatData.getCustomEmojis() || [];
        const targetEmojis = allCustomEmojis.filter(e => ids.includes(String(e?.id || '').trim()));
        if (targetEmojis.length === 0) {
            this.app.phoneShell.showNotification('æç¤º', 'æœªæ‰¾åˆ°å¯åˆ é™¤çš„è¡¨æƒ…', 'âš ï¸');
            return;
        }

        const confirmText = clearAll
            ? `ç¡®å®šæ¸…ç©ºå…¨éƒ¨ ${targetEmojis.length} å¼ è‡ªå®šä¹‰è¡¨æƒ…å—ï¼Ÿ`
            : `ç¡®å®šåˆ é™¤å·²é€‰ä¸­çš„ ${targetEmojis.length} å¼ è‡ªå®šä¹‰è¡¨æƒ…å—ï¼Ÿ`;
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
            this.app.phoneShell.showNotification('å·²åˆ é™¤', `å·²åˆ é™¤ ${deletedCount} å¼ ï¼ˆ${fileCleanupFailedCount} å¼ æ—§å›¾æ¸…ç†å¤±è´¥ï¼‰`, 'âš ï¸');
        } else {
            this.app.phoneShell.showNotification('å·²åˆ é™¤', `å·²åˆ é™¤ ${deletedCount} å¼ è‡ªå®šä¹‰è¡¨æƒ…`, 'ğŸ—‘ï¸');
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

    _resolveWechatUserVoice() {
        const globalConfig = this._getGlobalTtsVoiceConfig();
        const userInfo = this.app?.wechatData?.getUserInfo?.() || {};
        const providerVoices = (userInfo.ttsVoices && typeof userInfo.ttsVoices === 'object')
            ? userInfo.ttsVoices
            : {};
        const globalProviderVoice = String(providerVoices[globalConfig.provider] || '').trim();
        if (globalProviderVoice) {
            return { provider: globalConfig.provider, voice: globalProviderVoice, source: 'user_provider' };
        }

        const userProvider = String(userInfo.ttsProvider || '').trim();
        const userProviderVoice = String(providerVoices[userProvider] || '').trim();
        if (userProvider && userProviderVoice) {
            return { provider: userProvider, voice: userProviderVoice, source: 'user_default_provider' };
        }

        const legacyVoice = String(userInfo.ttsVoice || '').trim();
        if (legacyVoice) {
            return { provider: userProvider || globalConfig.provider, voice: legacyVoice, source: 'user_legacy' };
        }

        return globalConfig;
    }

    _normalizeTtsGender(gender = '') {
        const raw = String(gender || '').trim().toLowerCase();
        if (raw === 'male' || raw === 'm' || raw === 'ç”·') return 'male';
        if (raw === 'female' || raw === 'f' || raw === 'å¥³') return 'female';
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

    _buildWechatTtsCacheKey({ messageId = '', provider = '', voice = '', languageBoost = '', text = '' } = {}) {
        return [
            String(messageId || '').trim(),
            String(provider || '').trim(),
            String(voice || '').trim(),
            String(languageBoost || '').trim(),
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
                languageBoost: String(resolved?.languageBoost || 'auto').trim() || 'auto',
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
                languageBoost: String(resolved?.languageBoost || 'auto').trim() || 'auto',
                contact: resolvedContact || looseContact || null,
                source: fallback.source || 'global'
            };
        }

        if (allowGlobalFallback) {
            const fallback = this._getGlobalTtsVoiceConfig();
            return {
                voice: fallback.voice,
                provider: fallback.provider,
                languageBoost: String(resolved?.languageBoost || 'auto').trim() || 'auto',
                contact: resolved?.contact || null,
                source: fallback.source
            };
        }

        return {
            voice: '',
            provider: String(resolved?.provider || '').trim(),
            languageBoost: String(resolved?.languageBoost || 'auto').trim() || 'auto',
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
        const safeSender = String(senderName || '').trim() || 'å½“å‰è”ç³»äºº';
        const title = scene === 'call' ? 'é™éŸ³è­¦å‘Š' : 'æ— æ³•æ’­æ”¾';
        const message = scene === 'call'
            ? `[${safeSender}] æœªç»‘å®šä¸“å±éŸ³è‰²ï¼Œä¸”æ²¡æœ‰å¯ç”¨çš„å…¨å±€å…œåº•éŸ³è‰²`
            : `è¯·å…ˆåœ¨é€šè®¯å½•ç¼–è¾‘[${safeSender}]ç»‘å®šéŸ³è‰²ï¼Œæˆ–åœ¨è®¾ç½®é‡Œå¡«å†™å…¨å±€å…œåº•éŸ³è‰²`;
        this.app?.phoneShell?.showNotification(title, message, 'âš ï¸');
        return true;
    }

    _formatErrorForLog(error, fallback = 'æœªçŸ¥é”™è¯¯') {
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

    _getWechatSupplementalSetting(contact = {}) {
        return String(contact?.wechatSupplementalSetting || '').trim();
    }

    _buildGroupSupplementalContactProfileMessage(targetChat = null) {
        if (!targetChat || targetChat.type !== 'group') return null;

        const contacts = this.app.wechatData.getContacts?.() || [];
        if (!Array.isArray(contacts) || contacts.length === 0) return null;

        const explicitMembers = Array.isArray(targetChat.members)
            ? targetChat.members.map(name => String(name || '').trim()).filter(Boolean)
            : [];
        const memberNames = explicitMembers.length > 0
            ? explicitMembers
            : this._getGroupChatParticipants(targetChat);
        const seenContacts = new Set();
        const memberProfiles = [];

        memberNames.forEach((memberName) => {
            const contact = this.app.wechatData.findContactByNameLoose?.(memberName, { includeChats: false });
            if (!contact) return;

            const isWechatContact = contacts.some((item) => item === contact
                || (item?.id && contact?.id && String(item.id) === String(contact.id)));
            if (!isWechatContact) return;

            const contactKey = String(contact.id || contact.name || memberName).trim();
            if (!contactKey || seenContacts.has(contactKey)) return;

            const supplementalSetting = this._getWechatSupplementalSetting(contact);
            if (!supplementalSetting) return;

            seenContacts.add(contactKey);
            memberProfiles.push(`ã€${contact.name || memberName}ã€‘\n${supplementalSetting}`);
        });

        if (memberProfiles.length === 0) return null;
        return {
            role: 'system',
            content: [
                'ã€å½“å‰ç¾¤èŠæˆå‘˜è¡¥å……æ¡£æ¡ˆã€‘',
                'ä»¥ä¸‹è®¾å®šåªé€‚ç”¨äºå¯¹åº”çš„å½“å‰ç¾¤æˆå‘˜ï¼š',
                ...memberProfiles
            ].join('\n\n'),
            name: 'SYSTEM (ç¾¤æˆå‘˜è®¾å®š)',
            isPhoneMessage: true
        };
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
            console.warn('[Wechat] è¯»å–èœœè¯­è®°å½•æ€»ç»“å¤±è´¥:', error);
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
            && (sourceLabel === 'ä¸»æ’­' || relation.includes('ä¸»æ’­') || !!hostName);
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
            'ã€ç¾¤å†…èœœè¯­ä¸»æ’­æ€»ç»“ã€‘',
            'ä»¥ä¸‹å¾®ä¿¡ç¾¤æˆå‘˜æ˜¯èœœè¯­ä¸»æ’­ï¼›å¯¹åº”ç›´æ’­é—´æ€»ç»“ä¼šå½±å“è¿™äº›æˆå‘˜åœ¨å½“å‰ç¾¤èŠé‡Œçš„å…³ç³»èƒŒæ™¯å’Œå‘è¨€ï¼Œä¸è¦é€å­—å¤è¿°ã€‚'
        ];
        entries.forEach(entry => {
            const memberText = entry.memberNames.length > 0 ? `ï¼ˆç¾¤æˆå‘˜ï¼š${entry.memberNames.join('ã€')}ï¼‰` : '';
            lines.push(`â”â”â” ${entry.hostName}${memberText} â”â”â”`);
            lines.push(entry.summary);
            lines.push('');
        });

        return {
            role: 'system',
            content: lines.join('\n').trim(),
            name: 'SYSTEM (ç¾¤å†…èœœè¯­ä¸»æ’­æ€»ç»“)',
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
            .replace(/[ï¼ˆ(][^ï¼ˆï¼‰()]*[ï¼‰)]/g, '')
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
        if (this._isCurrentWechatUserName(rawName)) return rawName;
        const allowed = Array.isArray(participants)
            ? participants.map(item => String(item || '').trim()).filter(Boolean)
            : [];
        if (allowed.length === 0) return rawName;
        const normalized = this._normalizeGroupParticipantName(rawName, allowed);
        return allowed.includes(normalized) ? normalized : '';
    }

    _filterGroupMessagesByParticipants(messages = [], participants = [], contextLabel = 'ç¾¤èŠ', options = {}) {
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
                console.warn('âš ï¸ [å¾®ä¿¡å¤§å…] ç¾¤æˆå‘˜è¿‡æ»¤åå•ä¸å…¼å®¹ï¼Œå·²ä¿ç•™æœ¬è½®AIç¾¤èŠå›å¤:', logData);
                return list;
            }
            console.warn('âš ï¸ [å¾®ä¿¡] å·²ä¸¢å¼ƒéç¾¤æˆå‘˜å‘è¨€:', logData);
        }

        return filtered;
    }

    _resolveGroupMemberIdentity(rawMember = '') {
        const rawName = String(rawMember || '').trim();
        if (!rawName || rawName === 'me' || rawName === 'system') return null;

        const contactById = this.app.wechatData?.getContact?.(rawName);
        const contactByName = this.app.wechatData?.findContactByNameLoose?.(rawName, { includeChats: false });
        const contact = contactById || contactByName || null;
        const aliases = [rawName, contact?.id, contact?.name, contact?.remark, contact?.nickname, contact?.realName]
            .map(value => String(value || '').trim())
            .filter(Boolean);

        if (aliases.some(alias => this._isCurrentWechatUserName(alias))) return null;

        const displayName = this._getContactDisplayName(contact, rawName);
        const normalizedName = this._normalizeLookupName(displayName);
        if (!normalizedName) return null;

        return {
            key: contact?.id ? `contact:${String(contact.id).trim()}` : `name:${normalizedName}`,
            name: displayName,
            aliases
        };
    }

    _collectGroupMemberIdentityMap(chat = null, context = null) {
        if (!chat || chat.type !== 'group') return new Map();

        const identities = new Map();
        const explicitMembers = Array.isArray(chat.members)
            ? chat.members.map(member => String(member || '').trim()).filter(Boolean)
            : [];
        const memberSource = explicitMembers.length > 0
            ? explicitMembers
            : this._collectGroupParticipantsForFilter(chat, context);
        memberSource.forEach((member) => {
            const identity = this._resolveGroupMemberIdentity(member);
            if (!identity?.key) return;

            const existing = identities.get(identity.key);
            if (!existing) {
                identities.set(identity.key, identity);
                return;
            }
            identity.aliases.forEach((alias) => {
                if (!existing.aliases.includes(alias)) existing.aliases.push(alias);
            });
        });
        return identities;
    }

    _buildCrossGroupSharedHistoryContext(currentGroup = null, allChats = [], context = null, userName = 'ç”¨æˆ·', historyLimit = null) {
        if (!currentGroup || currentGroup.type !== 'group') return '';

        const currentMembers = this._collectGroupMemberIdentityMap(currentGroup, context);
        if (currentMembers.size === 0) return '';

        const parsedLimit = historyLimit === null || historyLimit === undefined
            ? this._readNonNegativeLimit('wechat-group-chat-limit', 200)
            : Math.max(0, Number.parseInt(historyLimit, 10) || 0);
        const currentId = String(currentGroup.id || '').trim();
        const currentNameKey = this._normalizeLookupName(currentGroup.name);
        const relatedGroups = (Array.isArray(allChats) ? allChats : [])
            .filter((chat) => {
                if (!chat || chat.type !== 'group' || chat === currentGroup) return false;
                const chatId = String(chat.id || '').trim();
                if (currentId && chatId && chatId === currentId) return false;
                if (!currentId && currentNameKey && this._normalizeLookupName(chat.name) === currentNameKey) return false;
                return true;
            })
            .map((chat) => {
                const sourceMembers = this._collectGroupMemberIdentityMap(chat, context);
                const sharedKeys = [...currentMembers.keys()].filter(key => sourceMembers.has(key));
                if (sharedKeys.length === 0) return null;

                const visibleMessages = parsedLimit > 0
                    ? (this.app.wechatData?.getMessages?.(chat.id) || [])
                        .filter(msg => !(msg?.hiddenFromPrompt === true || msg?.isTimeMarker === true || msg?.type === 'time_marker'))
                        .slice(-parsedLimit)
                    : [];
                return { chat, sharedKeys, visibleMessages };
            })
            .filter(Boolean);

        if (relatedGroups.length === 0) return '';

        const lines = [
            'ã€å…¶ä»–å…±åŒç¾¤èŠè®°å½•ä¸çŸ¥æƒ…æƒé™ã€‘',
            `ä»¥ä¸‹è®°å½•æ¥è‡ªå½“å‰ç¾¤â€œ${String(currentGroup.name || 'å½“å‰ç¾¤èŠ').trim()}â€ä»¥å¤–çš„å¾®ä¿¡ç¾¤ï¼Œä¸æ˜¯å½“å‰ç¾¤å·²ç»å…¬å¼€è¯´è¿‡çš„è¯ã€‚`,
            'å¿…é¡»æŒ‰æ¯ä¸ªæ¥æºç¾¤å•ç‹¬æ‰§è¡ŒçŸ¥æƒ…æƒé™ï¼šåªæœ‰â€œå½“å‰ç¾¤ä¸­åŒæ—¶å±äºè¯¥æ¥æºç¾¤çš„çŸ¥æƒ…æˆå‘˜â€å¯ä»¥è®°å¾—ã€æåŠæˆ–ä¾æ®è¯¥ç¾¤è®°å½•ä½œå‡ºååº”ï¼›å½“å‰ç¾¤å…¶ä»–æˆå‘˜æ²¡æœ‰åŠ å…¥è¯¥æ¥æºç¾¤ï¼Œç»å¯¹ä¸å¾—çŸ¥é“ã€å¤è¿°ã€çŒœæµ‹ã€æš—ç¤ºã€æ€»ç»“æˆ–å›åº”å…¶ä¸­ä»»ä½•å†…å®¹ã€‚',
            `æ‰‹æœºä¸»äººâ€œ${userName}â€å¯ä»¥çœ‹åˆ°è‡ªå·±æ‰‹æœºé‡Œçš„ç¾¤è®°å½•ï¼›ä¸‹åˆ—æˆå‘˜åå•ä¸“é—¨é™åˆ¶ä½ æ‰€æ‰®æ¼”çš„å½“å‰ç¾¤æˆå‘˜ï¼Œç¦æ­¢æŠŠæ¨¡å‹å·²è¯»åˆ°çš„ä¿¡æ¯è‡ªåŠ¨è§†ä¸ºæ‰€æœ‰ç¾¤æˆå‘˜éƒ½çŸ¥é“ã€‚`
        ];

        relatedGroups.forEach(({ chat, sharedKeys, visibleMessages }) => {
            const informedNames = sharedKeys.map(key => currentMembers.get(key)?.name).filter(Boolean);
            const uninformedNames = [...currentMembers.entries()]
                .filter(([key]) => !sharedKeys.includes(key))
                .map(([, identity]) => identity?.name)
                .filter(Boolean);

            lines.push('', `--- æ¥æºç¾¤ï¼š${String(chat.name || 'æœªå‘½åç¾¤èŠ').trim()} ---`);
            lines.push(`å½“å‰ç¾¤ä¸­åŒæ—¶å±äºè¯¥ç¾¤çš„çŸ¥æƒ…æˆå‘˜ï¼š${informedNames.join('ã€')}`);
            lines.push(`å½“å‰ç¾¤ä¸­æœªåŠ å…¥è¯¥ç¾¤ã€ç»ä¸çŸ¥æƒ…çš„æˆå‘˜ï¼š${uninformedNames.length > 0 ? uninformedNames.join('ã€') : 'æ— '}`);
            lines.push(`æƒé™ç¡¬çº¦æŸï¼šåªæœ‰ ${informedNames.join('ã€')} å¯ä»¥ä¿ç•™å¹¶ä½¿ç”¨ä¸‹é¢çš„è®°å¿†ï¼›å…¶ä»–å½“å‰ç¾¤æˆå‘˜ä¸å¾—è¡¨ç°å‡ºçŸ¥é“è¯¥æ¥æºç¾¤å­˜åœ¨æˆ–çŸ¥é“å…¶ä¸­å†…å®¹ã€‚`);

            if (visibleMessages.length === 0) {
                lines.push('è¯¥æ¥æºç¾¤å½“å‰æ²¡æœ‰å¯æ³¨å…¥çš„å†å²æ¶ˆæ¯ã€‚');
                return;
            }

            lines.push('è¯¥æ¥æºç¾¤å†å²ï¼š');
            let lastDate = null;
            visibleMessages.forEach((message) => {
                if (message.date && message.date !== lastDate) {
                    lines.push(`[${message.date}]`);
                    lastDate = message.date;
                }

                const senderIdentity = this._resolveGroupMemberIdentity(message.from);
                const speaker = message.from === 'me'
                    ? userName
                    : (message.from === 'system' || message.type === 'system')
                        ? 'ç³»ç»Ÿ'
                        : (senderIdentity?.name || String(message.from || 'ç¾¤æˆå‘˜').trim());
                let content = this._formatMessageContentForPrompt(message, chat);
                if (message.quote) content = `ã€Œå¼•ç”¨ ${message.quote.sender}: ${message.quote.content}ã€ ${content}`;
                const timeText = message.time ? `[${message.time}] ` : '';
                lines.push(`${timeText}${speaker}: ${content || ''}`);
            });
        });

        return lines.join('\n').trim();
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
        pushAlias(contactById?.nickname);
        pushAlias(contactByName?.nickname);
        pushAlias(contactById?.remark);
        pushAlias(contactByName?.remark);
        pushAlias(contactById?.realName);
        pushAlias(contactByName?.realName);

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

    _buildSingleChatMomentsContext(chat = null, userName = 'ç”¨æˆ·') {
        const targetChat = chat || this.app.currentChat;
        if (!targetChat || targetChat.type === 'group') return '';

        const contactById = targetChat.contactId
            ? this.app.wechatData?.getContact?.(targetChat.contactId)
            : null;
        const contactByName = this.app.wechatData?.findContactByNameLoose?.(targetChat.name, { includeChats: false });
        const targetKeys = new Set([
            targetChat.name,
            targetChat.remark,
            targetChat.nickname,
            contactById?.name,
            contactById?.remark,
            contactById?.nickname,
            contactById?.realName,
            contactByName?.name,
            contactByName?.remark,
            contactByName?.nickname,
            contactByName?.realName
        ].map(name => this._normalizeLookupName(name)).filter(Boolean));

        const wechatUserName = String(this.app.wechatData?.getUserInfo?.()?.name || '').trim();
        const userKeys = new Set([
            wechatUserName,
            userName,
            this._safeGetContext?.()?.name1
        ].map(name => this._normalizeLookupName(name)).filter(Boolean));
        if (targetKeys.size === 0 && userKeys.size === 0) return '';

        const limit = this._readNonNegativeLimit('wechat-moments-context-limit', 30, 100);
        if (limit <= 0) return '';

        const moments = this.app.wechatData?.getMoments?.();
        if (!Array.isArray(moments) || moments.length === 0) return '';

        const targetViewer = contactById || contactByName || targetChat;
        const targetChatId = String(targetChat?.id || '').trim();
        const targetContactId = String(contactById?.id || contactByName?.id || targetChat?.contactId || '').trim();
        const relevantMoments = moments
            .filter((moment) => {
                const authorKey = this._normalizeLookupName(moment?.name);
                if (userKeys.has(authorKey)) {
                    return this.app.wechatData?.canContactViewMoment?.(moment, targetViewer) !== false;
                }

                const sourceChatId = String(moment?.sourceChatId || '').trim();
                const momentContact = authorKey
                    ? this.app.wechatData?.findContactByNameLoose?.(moment?.name, { includeChats: false })
                    : null;
                const momentContactId = String(momentContact?.id || '').trim();
                return targetKeys.has(authorKey)
                    || (!!targetChatId && sourceChatId === targetChatId)
                    || (!!targetContactId && momentContactId === targetContactId);
            })
            .slice(0, limit);
        if (relevantMoments.length === 0) return '';

        const formatMomentTime = (moment) => {
            const date = String(moment?.date || '').trim();
            const time = String(moment?.time || '').trim();
            if (date && time) return `${date} ${time}`;
            return time || date || 'æ‰‹æœºæ—¶é—´æœªçŸ¥';
        };
        const formatMomentImage = (moment, image, index) => {
            const state = Array.isArray(moment?.imageGenerationStates)
                ? moment.imageGenerationStates[index]
                : null;
            const description = String(state?.description || state?.prompt || '').trim();
            if (description) return `é…å›¾${index + 1}ï¼š${description}`;

            const raw = typeof image === 'string'
                ? image.trim()
                : String(image?.description || image?.prompt || '').trim();
            if (!raw || /^(?:data:|blob:|https?:\/\/|\/backgrounds\/)/i.test(raw)) {
                return `é…å›¾${index + 1}ï¼šå·²å‘å¸ƒå›¾ç‰‡`;
            }
            return `é…å›¾${index + 1}ï¼š${raw}`;
        };

        const lines = [
            'ã€å½“å‰å•èŠåŒæ–¹æœ‹å‹åœˆã€‘',
            `ä»¥ä¸‹ä»…åŒ…å«å½“å‰å¾®ä¿¡å¥½å‹â€œ${targetChat.name || contactById?.name || contactByName?.name || 'å½“å‰å¥½å‹'}â€æœ‰æƒæŸ¥çœ‹çš„åŒæ–¹è¿‘æœŸæœ‹å‹åœˆåŠå…¶çœŸå®äº’åŠ¨ã€‚æœªå‘è¯¥å¥½å‹å¼€æ”¾çš„åŠ¨æ€å·²è¢«ç³»ç»Ÿå‰”é™¤ï¼Œç¦æ­¢çŒœæµ‹ã€æåŠã€å›åº”æˆ–æš—ç¤ºå…¶å†…å®¹ã€‚è¯„è®ºå’Œå›å¤å±äºå¯¹åº”åŠ¨æ€ï¼Œåªä½œä¸ºåŒæ–¹å·²çŸ¥çš„ç¤¾äº¤èƒŒæ™¯ï¼Œä¸è¦å°†å…¶è¯¯å½“æˆæœ¬è½®æ–°å¾®ä¿¡æ¶ˆæ¯ã€‚`,
            'ã€æœ‹å‹åœˆå»é‡ç¡¬çº¦æŸã€‘ä¸‹åˆ—åŠ¨æ€å‡å·²çœŸå®å‘å¸ƒã€‚ç”Ÿæˆæ–°çš„ moments JSON å‰å¿…é¡»é€æ¡å¯¹ç…§å‘å¸ƒè€…ã€æ­£æ–‡ã€é…å›¾å’Œå‘å¸ƒæ—¶é—´ï¼›ä¸¥ç¦å†æ¬¡ç”Ÿæˆå†…å®¹ç›¸åŒæˆ–é«˜åº¦ç›¸ä¼¼çš„æœ‹å‹åœˆã€‚å½“å‰æ²¡æœ‰åˆç†çš„æ–°åŠ¨æ€æ—¶ï¼Œå¿…é¡»çœç•¥ moments JSONï¼Œåªå›å¤å¾®ä¿¡æ¶ˆæ¯ã€‚'
        ];

        relevantMoments.forEach((moment, index) => {
            const authorName = String(moment?.name || '').trim() || 'æœªçŸ¥å‘å¸ƒè€…';
            const authorKey = this._normalizeLookupName(authorName);
            const authorRole = userKeys.has(authorKey) ? 'æ‰‹æœºç”¨æˆ·æœ¬äºº' : 'å½“å‰å¾®ä¿¡å¥½å‹';
            const text = String(moment?.text || '').trim();
            const images = Array.isArray(moment?.images) ? moment.images : [];
            const likeList = (Array.isArray(moment?.likeList) ? moment.likeList : [])
                .map(name => String(name || '').trim())
                .filter(Boolean);
            const comments = (Array.isArray(moment?.commentList) ? moment.commentList : [])
                .map(comment => ({
                    name: String(comment?.name || '').trim(),
                    text: String(comment?.text || '').trim(),
                    replyTo: String(comment?.replyTo || '').trim()
                }))
                .filter(comment => comment.name && comment.text);

            lines.push('', `--- æœ‹å‹åœˆåŠ¨æ€ ${index + 1}ï¼ˆ${authorRole}ï¼‰---`);
            lines.push(`å‘å¸ƒè€…ï¼š${authorName}`);
            lines.push(`å‘å¸ƒæ—¶é—´ï¼š${formatMomentTime(moment)}`);
            lines.push(`æ­£æ–‡ï¼š${text || (images.length > 0 ? 'æ— æ–‡å­—ï¼Œä»…å‘å¸ƒé…å›¾' : 'æ— æ–‡å­—')}`);
            images.forEach((image, imageIndex) => lines.push(formatMomentImage(moment, image, imageIndex)));
            lines.push(`ç‚¹èµï¼š${likeList.length > 0 ? likeList.join('ã€') : 'æ— '}`);
            if (comments.length > 0) {
                lines.push('è¯„è®ºï¼š');
                comments.forEach((comment) => {
                    const replyText = comment.replyTo ? ` å›å¤ ${comment.replyTo}` : '';
                    lines.push(`- ${comment.name}${replyText}ï¼š${comment.text}`);
                });
            } else {
                lines.push('è¯„è®ºï¼šæ— ');
            }
        });

        return lines.join('\n').trim();
    }

    _buildGroupChatMomentsContext(chat = null, context = null) {
        const targetChat = chat || this.app.currentChat;
        if (!targetChat || targetChat.type !== 'group') return '';

        const memberIdentities = this._collectGroupMemberIdentityMap(
            targetChat,
            context || this._safeGetContext?.()
        );
        if (memberIdentities.size === 0) return '';

        const limit = this._readNonNegativeLimit('wechat-moments-context-limit', 30, 100);
        if (limit <= 0) return '';

        const moments = this.app.wechatData?.getMoments?.();
        if (!Array.isArray(moments) || moments.length === 0) return '';

        const identityByAlias = new Map();
        const identityByContactId = new Map();
        memberIdentities.forEach((identity) => {
            (identity?.aliases || []).forEach((alias) => {
                const key = this._normalizeLookupName(alias);
                if (key && !identityByAlias.has(key)) identityByAlias.set(key, identity);
            });
            const contactId = String(identity?.key || '').startsWith('contact:')
                ? String(identity.key).slice('contact:'.length).trim()
                : '';
            if (contactId) identityByContactId.set(contactId, identity);
        });

        const identityBySingleChatId = new Map();
        const allChats = this.app.wechatData?.getChatList?.() || [];
        (Array.isArray(allChats) ? allChats : []).forEach((item) => {
            if (!item || item.type === 'group') return;
            const chatId = String(item.id || '').trim();
            if (!chatId) return;

            const contactId = String(item.contactId || '').trim();
            const contact = contactId
                ? this.app.wechatData?.getContact?.(contactId)
                : this.app.wechatData?.findContactByNameLoose?.(item.name, { includeChats: false });
            const identity = identityByContactId.get(String(contact?.id || contactId || '').trim())
                || identityByAlias.get(this._normalizeLookupName(contact?.name))
                || identityByAlias.get(this._normalizeLookupName(item.name));
            if (identity) identityBySingleChatId.set(chatId, identity);
        });

        const resolveMomentIdentity = (moment) => {
            const authorName = String(moment?.name || '').trim();
            const authorKey = this._normalizeLookupName(authorName);
            if (authorKey && identityByAlias.has(authorKey)) return identityByAlias.get(authorKey);

            const authorContact = authorName
                ? this.app.wechatData?.findContactByNameLoose?.(authorName, { includeChats: false })
                : null;
            const authorContactId = String(authorContact?.id || '').trim();
            if (authorContactId && identityByContactId.has(authorContactId)) {
                return identityByContactId.get(authorContactId);
            }

            const sourceChatId = String(moment?.sourceChatId || '').trim();
            return sourceChatId ? (identityBySingleChatId.get(sourceChatId) || null) : null;
        };

        const relevantMoments = moments
            .map(moment => ({ moment, identity: resolveMomentIdentity(moment) }))
            .filter(item => !!item.identity)
            .slice(0, limit);
        if (relevantMoments.length === 0) return '';

        const formatMomentTime = (moment) => {
            const date = String(moment?.date || '').trim();
            const time = String(moment?.time || '').trim();
            if (date && time) return `${date} ${time}`;
            return time || date || 'æ‰‹æœºæ—¶é—´æœªçŸ¥';
        };
        const formatMomentImage = (moment, image, index) => {
            const state = Array.isArray(moment?.imageGenerationStates)
                ? moment.imageGenerationStates[index]
                : null;
            const description = String(state?.description || state?.prompt || '').trim();
            if (description) return `é…å›¾${index + 1}ï¼š${description}`;

            const raw = typeof image === 'string'
                ? image.trim()
                : String(image?.description || image?.prompt || '').trim();
            if (!raw || /^(?:data:|blob:|https?:\/\/|\/backgrounds\/)/i.test(raw)) {
                return `é…å›¾${index + 1}ï¼šå·²å‘å¸ƒå›¾ç‰‡`;
            }
            return `é…å›¾${index + 1}ï¼š${raw}`;
        };

        const matchedMemberNames = [...new Set(relevantMoments
            .map(item => String(item.identity?.name || '').trim())
            .filter(Boolean))];
        const lines = [
            'ã€å½“å‰å¾®ä¿¡ç¾¤æˆå‘˜æœ‹å‹åœˆã€‘',
            `ä»¥ä¸‹ä»…åŒ…å«å½“å‰å¾®ä¿¡ç¾¤â€œ${String(targetChat.name || 'å½“å‰ç¾¤èŠ').trim()}â€å†…å¥½å‹å·²ç»å‘å¸ƒçš„è¿‘æœŸæœ‹å‹åœˆã€‚å‘½ä¸­çš„ç¾¤å¥½å‹ï¼š${matchedMemberNames.join('ã€')}ã€‚è¿™äº›åŠ¨æ€ä¸æ˜¯ç¾¤èŠæ¶ˆæ¯ï¼Œä¹Ÿä¸ä»£è¡¨å·²ç»å‘åˆ°ç¾¤å†…ã€‚`,
            'ã€æœ‹å‹åœˆçŸ¥æƒ…è¾¹ç•Œã€‘åŠ¨æ€å‘å¸ƒè€…ã€å®é™…ç‚¹èµè€…ã€å®é™…è¯„è®ºè€…å’Œæ‰‹æœºç”¨æˆ·å¯ä»¥çŸ¥é“å¯¹åº”åŠ¨æ€ï¼›é™¤éå…¶ä»–å·²æ³¨å…¥è®°å½•æ˜ç¡®è¯æ˜ï¼Œç¾¤å†…å…¶ä½™æˆå‘˜ä¸å¾—è‡ªåŠ¨çŸ¥é“ã€å¤è¿°ã€æš—ç¤ºæˆ–å›åº”è¿™äº›æœ‹å‹åœˆå†…å®¹ã€‚',
            'ã€æœ‹å‹åœˆå»é‡ç¡¬çº¦æŸã€‘ä¸‹åˆ—åŠ¨æ€å‡å·²çœŸå®å‘å¸ƒã€‚ç”Ÿæˆæ–°çš„ moments JSON å‰å¿…é¡»é€æ¡å¯¹ç…§å‘å¸ƒè€…ã€æ­£æ–‡ã€é…å›¾å’Œå‘å¸ƒæ—¶é—´ï¼›ä¸¥ç¦å†æ¬¡ç”Ÿæˆå†…å®¹ç›¸åŒæˆ–é«˜åº¦ç›¸ä¼¼çš„æœ‹å‹åœˆã€‚å½“å‰æ²¡æœ‰åˆç†çš„æ–°åŠ¨æ€æ—¶ï¼Œå¿…é¡»çœç•¥ moments JSONï¼Œåªå›å¤å¾®ä¿¡æ¶ˆæ¯ã€‚'
        ];

        relevantMoments.forEach(({ moment, identity }, index) => {
            const authorName = String(moment?.name || identity?.name || '').trim() || 'æœªçŸ¥å‘å¸ƒè€…';
            const memberName = String(identity?.name || authorName).trim();
            const text = String(moment?.text || '').trim();
            const images = Array.isArray(moment?.images) ? moment.images : [];
            const likeList = (Array.isArray(moment?.likeList) ? moment.likeList : [])
                .map(name => String(name || '').trim())
                .filter(Boolean);
            const comments = (Array.isArray(moment?.commentList) ? moment.commentList : [])
                .map(comment => ({
                    name: String(comment?.name || '').trim(),
                    text: String(comment?.text || '').trim(),
                    replyTo: String(comment?.replyTo || '').trim()
                }))
                .filter(comment => comment.name && comment.text);

            lines.push('', `--- ç¾¤æˆå‘˜æœ‹å‹åœˆ ${index + 1}ï¼ˆ${memberName}ï¼‰---`);
            lines.push(`å‘å¸ƒè€…ï¼š${authorName}`);
            lines.push(`å‘å¸ƒæ—¶é—´ï¼š${formatMomentTime(moment)}`);
            lines.push(`æ­£æ–‡ï¼š${text || (images.length > 0 ? 'æ— æ–‡å­—ï¼Œä»…å‘å¸ƒé…å›¾' : 'æ— æ–‡å­—')}`);
            images.forEach((image, imageIndex) => lines.push(formatMomentImage(moment, image, imageIndex)));
            lines.push(`ç‚¹èµï¼š${likeList.length > 0 ? likeList.join('ã€') : 'æ— '}`);
            if (comments.length > 0) {
                lines.push('è¯„è®ºï¼š');
                comments.forEach((comment) => {
                    const replyText = comment.replyTo ? ` å›å¤ ${comment.replyTo}` : '';
                    lines.push(`- ${comment.name}${replyText}ï¼š${comment.text}`);
                });
            } else {
                lines.push('è¯„è®ºï¼šæ— ');
            }
        });

        return lines.join('\n').trim();
    }

    _buildPhoneCallHistoryContextForSingleChat(chat = null, userName = 'ç”¨æˆ·') {
        const targetChat = chat || this.app.currentChat;
        if (!targetChat || targetChat.type === 'group') return '';

        const contactById = targetChat.contactId
            ? this.app.wechatData?.getContact?.(targetChat.contactId)
            : null;
        const contactByName = this.app.wechatData?.findContactByNameLoose?.(targetChat.name, { includeChats: false });
        const aliasKeys = new Set([
            targetChat.name,
            targetChat.remark,
            targetChat.nickname,
            contactById?.name,
            contactById?.remark,
            contactById?.nickname,
            contactById?.realName,
            contactByName?.name,
            contactByName?.remark,
            contactByName?.nickname,
            contactByName?.realName
        ].map(name => this._normalizeLookupName(name)).filter(Boolean));
        if (aliasKeys.size === 0) return '';

        let callHistory = null;
        try {
            const phoneCallData = window.VirtualPhone?.phoneApp?.phoneCallData;
            if (phoneCallData?.getCallHistory) {
                callHistory = phoneCallData.getCallHistory();
            } else {
                const storage = window.VirtualPhone?.storage || this.app?.storage;
                const saved = storage?.get?.('phone_call_history', null);
                if (saved) {
                    callHistory = typeof saved === 'string' ? JSON.parse(saved) : saved;
                }
            }
        } catch (e) {
            console.warn('[å¾®ä¿¡] è¯»å–é€šè¯ App å†å²è®°å½•å¤±è´¥:', e);
            return '';
        }

        if (!Array.isArray(callHistory) || callHistory.length === 0) return '';

        const matchedCalls = callHistory.filter(record => {
            const callerKey = this._normalizeLookupName(record?.caller);
            return callerKey
                && aliasKeys.has(callerKey)
                && record?.status === 'answered'
                && Array.isArray(record?.transcript)
                && record.transcript.length > 0;
        });
        if (matchedCalls.length === 0) return '';

        const callLimit = this._readNonNegativeLimit('phone-call-limit', 10);
        if (callLimit <= 0) return '';

        const contactName = String(targetChat.name || matchedCalls[0]?.caller || 'å½“å‰å¥½å‹').trim();
        let text = `ã€ğŸ“ ä¸ ${contactName} çš„é€šè¯ App å†å²è®°å½•ã€‘\n`;
        text += 'ä»¥ä¸‹å†…å®¹æ¥è‡ªç‹¬ç«‹â€œé€šè¯â€Appï¼Œä»…ä½œä¸ºä½ ä»¬å·²ç»å‘ç”Ÿè¿‡çš„é€šè¯æ—¶é—´çº¿å’Œå¯¹è¯èƒŒæ™¯ï¼›ä¸è¦é€å­—å¤è¿°ã€‚\n\n';

        matchedCalls.forEach(record => {
            const dateTime = `${record.date || ''} ${record.time || ''}`.trim();
            const duration = record.duration ? `ï¼Œæ—¶é•¿ ${record.duration}` : '';
            text += `â”â”â” ${dateTime || 'å†å²é€šè¯'}${duration} â”â”â”\n`;
            record.transcript.slice(-callLimit).forEach(message => {
                const speaker = message?.from === 'me' ? userName : contactName;
                const content = String(message?.text || '').trim();
                if (content) text += `${speaker}: ${content}\n`;
            });
            text += '\n';
        });

        return text.trim();
    }

    _buildPhoneSmsHistoryContextForSingleChat(chat = null, userName = 'ç”¨æˆ·') {
        const targetChat = chat || this.app.currentChat;
        if (!targetChat || targetChat.type === 'group') return '';

        const contactById = targetChat.contactId
            ? this.app.wechatData?.getContact?.(targetChat.contactId)
            : null;
        const contactByName = this.app.wechatData?.findContactByNameLoose?.(targetChat.name, { includeChats: false });
        const aliasKeys = new Set([
            targetChat.name,
            targetChat.remark,
            targetChat.nickname,
            contactById?.name,
            contactById?.remark,
            contactById?.nickname,
            contactById?.realName,
            contactByName?.name,
            contactByName?.remark,
            contactByName?.nickname,
            contactByName?.realName
        ].map(name => this._normalizeLookupName(name)).filter(Boolean));
        if (aliasKeys.size === 0) return '';

        let conversations = null;
        try {
            const phoneCallData = window.VirtualPhone?.phoneApp?.phoneCallData;
            if (phoneCallData?.getSmsConversations) {
                conversations = phoneCallData.getSmsConversations();
            } else {
                const storage = window.VirtualPhone?.storage || this.app?.storage;
                const saved = storage?.get?.('phone_call_sms_conversations', null);
                if (saved) {
                    conversations = typeof saved === 'string' ? JSON.parse(saved) : saved;
                }
            }
        } catch (e) {
            console.warn('[å¾®ä¿¡] è¯»å–é€šè¯ App çŸ­ä¿¡è®°å½•å¤±è´¥:', e);
            return '';
        }

        if (!Array.isArray(conversations) || conversations.length === 0) return '';

        const matchedConversations = conversations.filter(conversation => {
            const contactKey = this._normalizeLookupName(conversation?.name);
            return contactKey
                && aliasKeys.has(contactKey)
                && Array.isArray(conversation?.messages)
                && conversation.messages.length > 0;
        });
        if (matchedConversations.length === 0) return '';

        const smsLimit = this._readNonNegativeLimit('phone-sms-limit', 20);
        if (smsLimit <= 0) return '';

        const recentMessages = matchedConversations
            .flatMap((conversation, conversationIndex) => conversation.messages.map((message, messageIndex) => ({
                message,
                order: conversationIndex * 100000 + messageIndex
            })))
            .filter(item => String(item.message?.text || item.message?.content || '').trim())
            .sort((left, right) => {
                const leftCreatedAt = Number(left.message?.createdAt || 0);
                const rightCreatedAt = Number(right.message?.createdAt || 0);
                if (leftCreatedAt > 0 && rightCreatedAt > 0 && leftCreatedAt !== rightCreatedAt) {
                    return leftCreatedAt - rightCreatedAt;
                }
                return left.order - right.order;
            })
            .slice(-smsLimit)
            .map(item => item.message);
        if (recentMessages.length === 0) return '';

        const contactName = String(targetChat.name || matchedConversations[0]?.name || 'å½“å‰å¥½å‹').trim();
        let text = `ã€ğŸ’¬ ä¸ ${contactName} çš„çŸ­ä¿¡ App å†å²è®°å½•ã€‘\n`;
        text += 'ä»¥ä¸‹å†…å®¹æ¥è‡ªç‹¬ç«‹â€œé€šè¯â€Appï¼Œä»…ä½œä¸ºä½ ä»¬å·²ç»å‘ç”Ÿè¿‡çš„çŸ­ä¿¡æ—¶é—´çº¿å’Œå¯¹è¯èƒŒæ™¯ï¼›ä¸è¦é€å­—å¤è¿°ã€‚\n\n';
        let lastDate = '';

        recentMessages.forEach(message => {
            const date = String(message?.date || '').trim();
            if (date && date !== lastDate) {
                text += `â”â”â” ${date} â”â”â”\n`;
                lastDate = date;
            }
            const time = message?.time ? `[${message.time}] ` : '';
            const speaker = message?.direction === 'outgoing' || message?.from === 'me'
                ? userName
                : contactName;
            const content = String(message?.text || message?.content || '').trim();
            if (content) text += `${time}${speaker}: ${content}\n`;
        });

        return text.trim();
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
        const fallbackSender = groupCall ? (participants[0] || contactName || 'ç¾¤æˆå‘˜') : (contactName || 'å¯¹æ–¹');
        let pendingSender = '';

        for (let line of lines) {
            if (/^(æ¥å¬|answer)$/i.test(line)) continue;
            if (/^(æ‹’ç»|reject)$/i.test(line)) continue;
            if (/^type[ï¼š:]/i.test(line) || /^date[ï¼š:]/i.test(line)) continue;

            const senderOnlyMatch = /^([^:ï¼š]{1,20})[ï¼š:]\s*$/.exec(line);
            if (groupCall && senderOnlyMatch) {
                pendingSender = this._normalizeGroupParticipantName(senderOnlyMatch[1], participants);
                continue;
            }

            let sender = '';
            let text = '';

            const timedGroupMatch = /^\[[0-9A-Za-z:ï¼š]+\]\s*([^:ï¼š]{1,20})[ï¼š:]\s*(.+)$/.exec(line);
            const simpleGroupMatch = /^([^:ï¼š]{1,20})[ï¼š:]\s*(.+)$/.exec(line);

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
                    const senderPrefixRegex = new RegExp(`^${this._escapeRegExp(contactName)}\\s*[ï¼š:]\\s*`);
                    text = text.replace(senderPrefixRegex, '');
                }
            }

            text = String(text || '')
                .replace(/^\[[0-9A-Za-z:ï¼š]+\]\s*/, '')
                .replace(/^from\s+\S+[ï¼š:]\s*/i, '');
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
            console.warn('âš ï¸ è·å–å¾®ä¿¡ç ´é™è¯å¤±è´¥:', e);
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
                    .split(/[,ï¼Œ\n]+/)
                    .map(tag => tag.trim())
                    .filter(Boolean)
                    .join(', ');
                return name && tags ? `${name}ï¼š${tags}` : '';
            })
            .filter(Boolean);
        return normalized.length > 0 ? normalized.join('\n') : 'æš‚æ— ';
    }

    _buildWechatPersonalImageTagInfo({ targetChat = null, isGroupChat = false } = {}) {
        const contacts = this.app?.wechatData?.getContacts?.() || [];
        const userInfo = this.app?.wechatData?.getUserInfo?.() || {};
        const userTags = String(userInfo?.naiPromptTags || userInfo?.imageTags || '').trim();
        const userVariableName = String(userInfo?.realName || userInfo?.name || 'user')
            .replace(/[{}\r\n]/g, '')
            .trim() || 'user';
        const userRow = userTags ? [{ name: `{{${userVariableName}}}`, tags: userTags }] : [];
        if (!Array.isArray(contacts) || contacts.length === 0) {
            return this._formatPersonalImageTagRows(userRow);
        }

        if (isGroupChat) {
            const participants = this._collectGroupParticipantsForFilter(targetChat || this.app.currentChat, this._safeGetContext());
            const participantKeys = new Set(participants.map(name => this._normalizeLookupName(name)).filter(Boolean));
            return this._formatPersonalImageTagRows([
                ...userRow,
                ...contacts
                .filter(contact => {
                    const aliases = this.app.wechatData?._getContactAliasValues?.(contact)
                        || [contact?.name, contact?.nickname, contact?.remark, contact?.realName];
                    return aliases.some(alias => participantKeys.has(this._normalizeLookupName(alias)));
                })
                .map(contact => ({
                    name: this._getContactDisplayName(contact),
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
                name: this._getContactDisplayName(contact, chatName),
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
                name: userInfo.name || 'æˆ‘',
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
                            ${this.app.renderAvatar(item.avatar, item.isSelf ? 'ğŸ˜Š' : 'ğŸ‘¤', item.name)}
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
                this.showTypingStatus('ç­‰å¾…å›å¤', visibleChatId);
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
        return `${dateObj.getFullYear()}å¹´${String(dateObj.getMonth() + 1).padStart(2, '0')}æœˆ${String(dateObj.getDate()).padStart(2, '0')}æ—¥`;
    }

    _normalizeWechatDateDisplay(dateText = '') {
        return String(dateText || '').replace(/^0+(\d{1,6}å¹´)/, '$1');
    }

    _parseManualTimeAdvanceCommand(text = '') {
        const raw = String(text || '').trim();
        const match = raw.match(/^\[\s*æ—¶é—´æ¨è¿›\s*[ï¼š:]\s*([^\]]+?)\s*\]$/);
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
            weekday: parsed.weekday || window.VirtualPhone?.timeManager?.calculateWeekday?.(parsed.date) || 'æ˜ŸæœŸä¸€',
            timestamp: Number.isFinite(Number(timestamp)) ? Number(timestamp) : Date.now()
        };
    }

    _handleManualTimeAdvance(input, text, targetChatId, options = {}) {
        const parsedTime = this._parseManualTimeAdvanceCommand(text);
        if (!parsedTime || !targetChatId) return false;
        const preserveDraft = options?.preserveDraft === true;

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

        if (!preserveDraft) {
            input.value = '';
            this.inputText = '';
            this.activeQuote = null;
        }

        if (!preserveDraft) {
            const quoteBar = document.querySelector('.active-quote-bar');
            if (quoteBar) quoteBar.remove();
        }

        const messages = this.app.wechatData.getMessages(targetChatId);
        const userInfo = this.app.wechatData.getUserInfo();
        this.smartUpdateMessages(messages, userInfo, { chatId: targetChatId });

        this.app.phoneShell?.updateStatusBarTime?.();
        window.VirtualPhone?.home?.render?.({ forceDomRefresh: true });
        return true;
    }

    _getWechatWeekdayFromTimestamp(timestamp, fallback = 'æ˜ŸæœŸä¸€') {
        const dateObj = new Date(Number(timestamp || 0));
        if (!Number.isFinite(dateObj.getTime())) return fallback || 'æ˜ŸæœŸä¸€';
        const weekdays = ['æ˜ŸæœŸæ—¥', 'æ˜ŸæœŸä¸€', 'æ˜ŸæœŸäºŒ', 'æ˜ŸæœŸä¸‰', 'æ˜ŸæœŸå››', 'æ˜ŸæœŸäº”', 'æ˜ŸæœŸå…­'];
        return weekdays[dateObj.getDay()] || fallback || 'æ˜ŸæœŸä¸€';
    }

    _getWechatReplySecondsToAdd(content = '', { isFirstInReplyBatch = false } = {}) {
        const length = String(content || '').replace(/\s+/g, '').length;
        const thinkSeconds = 2 + Math.floor(Math.random() * 4);
        const seconds = Math.max(4, Math.min(20, Math.ceil(length * 0.35) + thinkSeconds));
        return isFirstInReplyBatch ? Math.max(6, seconds) : seconds;
    }

    _applyAiReplyTimeline(messageObj, fallbackContent = '', options = {}) {
        if (!messageObj || typeof messageObj !== 'object') return;

        const now = Date.now();
        const startedAt = Number(this._aiReplyRequestStartedAt || 0);
        const isFirstInReplyBatch = options?.isFirstInReplyBatch === true;
        const waitedMs = isFirstInReplyBatch && startedAt > 0 ? Math.max(0, now - startedAt) : 0;
        if (waitedMs > 60000) messageObj.forceTimeDivider = true;

        // Reality mode always uses the clock at arrival, with no simulated delay.
        if (this._shouldUseRealTimeForOnlineChat(options)) {
            Object.assign(messageObj, this._buildWechatRealTimeFields(now));
            this._aiReplyTimestampCursor = now;
            this._aiReplyTimeCursor = { ...this._buildWechatRealTimeFields(now) };
            return;
        }

        const timeManager = window.VirtualPhone?.timeManager;
        if (!timeManager?.getCurrentStoryTime || !timeManager?.addMinutesToStoryTime) return;
        let cursor = this._aiReplyTimeCursor || timeManager.getCurrentStoryTime();
        if (!cursor?.time || !cursor?.date) return;
        // Respect a newer global time if another window advanced it during this batch.
        const current = timeManager.getCurrentStoryTime();
        let cursorTimestamp = Number(this._aiReplyTimestampCursor || cursor.timestamp || timeManager.parseTimeToTimestamp(cursor));
        if (Number(current?.timestamp) > cursorTimestamp) {
            cursor = current;
            cursorTimestamp = Number(current.timestamp);
        }
        if (!Number.isFinite(cursorTimestamp)) return;

        const contentText = String(messageObj.content || fallbackContent || '').trim();
        let secondsToAdd = this._getWechatReplySecondsToAdd(contentText, { isFirstInReplyBatch });
        if (waitedMs > 60000) secondsToAdd = Math.max(secondsToAdd, Math.floor(waitedMs / 1000));
        // Only proactive contact supplies an additional story gap, once per request.
        secondsToAdd += Math.max(0, Number(options?.extraGapMinutes) || 0) * 60;
        const nextTimestamp = cursorTimestamp + secondsToAdd * 1000;
        const minuteTimestamp = timeManager.parseTimeToTimestamp({ ...cursor, timestamp: undefined });
        const nextTime = timeManager.addMinutesToStoryTime(cursor, Math.floor((nextTimestamp - minuteTimestamp) / 60000));
        Object.assign(messageObj, {
            time: nextTime.time,
            date: nextTime.date,
            weekday: nextTime.weekday,
            timestamp: nextTimestamp,
            realTimestamp: now
        });
        timeManager.setTime?.(messageObj.time, messageObj.date, messageObj.weekday || null, { timestamp: nextTimestamp });
        window.VirtualPhone?.checkCalendarScheduleReminders?.(timeManager.getCurrentStoryTime() || nextTime);
        this._aiReplyTimeCursor = { ...nextTime, timestamp: nextTimestamp };
        this._aiReplyTimestampCursor = nextTimestamp;
    }

    _getMessageTimelineFields(messageObj = {}) {
        return {
            time: messageObj.time,
            date: messageObj.date,
            weekday: messageObj.weekday,
            timestamp: messageObj.timestamp,
            realTimestamp: messageObj.realTimestamp
        };
    }

    _attachMessageTimelineFields(target = {}, source = {}) {
        return {
            ...target,
            ...this._getMessageTimelineFields(source)
        };
    }

    resetMessageHistoryWindow(chatId = '') {
        const safeChatId = String(chatId || '').trim();
        if (safeChatId) {
            this._visibleMessageCounts?.delete?.(safeChatId);
            return;
        }
        this._visibleMessageCounts?.clear?.();
    }

    _getMessageHistoryWindow(messages, chatId = '') {
        const allMessages = Array.isArray(messages) ? messages : [];
        const safeChatId = String(chatId || this.app?.currentChat?.id || '').trim();
        if (!(this._visibleMessageCounts instanceof Map)) {
            this._visibleMessageCounts = new Map();
        }

        const storedCount = safeChatId ? this._visibleMessageCounts.get(safeChatId) : null;
        const requestedCount = Number.isFinite(Number(storedCount))
            ? Math.max(WECHAT_MESSAGE_PAGE_SIZE, Number(storedCount))
            : WECHAT_MESSAGE_PAGE_SIZE;
        const visibleCount = Math.min(allMessages.length, requestedCount);
        const startIndex = Math.max(0, allMessages.length - visibleCount);

        return {
            chatId: safeChatId,
            messages: allMessages.slice(startIndex),
            startIndex,
            hiddenCount: startIndex,
            visibleCount
        };
    }

    _expandMessageHistoryWindow(chatId, totalCount) {
        const safeChatId = String(chatId || this.app?.currentChat?.id || '').trim();
        const safeTotal = Math.max(0, Number(totalCount) || 0);
        const currentCount = this._getMessageHistoryWindow(new Array(safeTotal), safeChatId).visibleCount;
        const nextCount = Math.min(safeTotal, currentCount + WECHAT_MESSAGE_PAGE_SIZE);
        if (safeChatId) this._visibleMessageCounts.set(safeChatId, nextCount);
        return nextCount;
    }

    _renderMessageHistoryWindow(messages, userInfo, chatId = '') {
        const windowState = this._getMessageHistoryWindow(messages, chatId);
        const historyButton = windowState.hiddenCount > 0 ? `
            <div class="wechat-message-history-loader">
                <button type="button" class="wechat-message-history-button" data-chat-id="${this._escapeHtml(windowState.chatId)}" aria-label="å±•å¼€æ›´æ—©çš„ ${Math.min(WECHAT_MESSAGE_PAGE_SIZE, windowState.hiddenCount)} æ¡æ¶ˆæ¯">
                    <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
                    <span>å±•å¼€æ›´æ—©æ¶ˆæ¯</span>
                    <span class="wechat-message-history-count">å‰©ä½™ ${windowState.hiddenCount} æ¡</span>
                </button>
            </div>
        ` : '';
        return historyButton + this.renderMessagesWithDateDividers(windowState.messages, userInfo, {
            startIndex: windowState.startIndex
        });
    }

    _captureMessageHistoryScroll(messagesDiv) {
        const previousTop = Number(messagesDiv?.scrollTop || 0);
        const anchor = Array.from(messagesDiv?.querySelectorAll?.('[data-message-index]') || [])[0] || null;
        return {
            previousTop,
            previousHeight: Number(messagesDiv?.scrollHeight || 0),
            anchorIndex: String(anchor?.dataset?.messageIndex || ''),
            anchorOffset: anchor ? Number(anchor.offsetTop || 0) - previousTop : null
        };
    }

    _restoreMessageHistoryScroll(messagesDiv, snapshot = {}) {
        if (!messagesDiv) return;
        const anchorIndex = String(snapshot.anchorIndex || '');
        if (anchorIndex) {
            const anchor = Array.from(messagesDiv.querySelectorAll?.('[data-message-index]') || [])
                .find(element => String(element?.dataset?.messageIndex || '') === anchorIndex);
            if (anchor) {
                messagesDiv.scrollTop = Math.max(0, Number(anchor.offsetTop || 0) - Number(snapshot.anchorOffset || 0));
                return;
            }
        }

        const addedHeight = Number(messagesDiv.scrollHeight || 0) - Number(snapshot.previousHeight || 0);
        messagesDiv.scrollTop = Math.max(0, Number(snapshot.previousTop || 0) + addedHeight);
    }

    bindMessageHistoryEvents() {
        const currentView = this.getCurrentWechatView();
        const messagesDiv = currentView?.querySelector('#chat-messages');
        if (!messagesDiv || messagesDiv._messageHistoryEventsBound) return;
        messagesDiv._messageHistoryEventsBound = true;

        messagesDiv.addEventListener('click', (event) => {
            const button = event.target.closest?.('.wechat-message-history-button');
            if (!button || !messagesDiv.contains(button)) return;
            event.preventDefault();

            const chatId = String(button.dataset.chatId || this.app?.currentChat?.id || '').trim();
            if (!chatId || String(this.app?.currentChat?.id || '').trim() !== chatId) return;

            const messages = this.app.wechatData.getMessages(chatId) || [];
            const userInfo = this.app.wechatData.getUserInfo();
            const scrollSnapshot = this._captureMessageHistoryScroll(messagesDiv);

            this._expandMessageHistoryWindow(chatId, messages.length);
            messagesDiv.innerHTML = this._renderMessageHistoryWindow(messages, userInfo, chatId);

            this.bindMessageLongPressEvents();
            this.bindManualTimeMarkerEvents();
            this.bindSpecialMessageEvents();
            this.bindInnerThoughtEvents();
            this.bindMessageSelectionEvents();

            const restoreScrollPosition = () => {
                this._restoreMessageHistoryScroll(messagesDiv, scrollSnapshot);
            };
            restoreScrollPosition();
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(restoreScrollPosition);
            }
        });
    }
renderChatRoom(chat) {
        const messages = this.app.wechatData.getMessages(chat.id);
        const userInfo = this.app.wechatData.getUserInfo();
        const isCurrentChatSending = this.isSending && String(this._activeSendingChatId || '') === String(chat.id || '');
        const hasInputText = String(this.inputText || '').trim() !== '';
        const rightButtonIsMore = !isCurrentChatSending && !hasInputText;
        const safeChatId = this._escapeHtml(String(chat?.id || '').trim());
        const inputAreaStyle = this.showQuickReplies
            ? 'background: transparent !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; border-top: none !important;'
            : 'background: rgba(255, 255, 255, 0.15) !important; backdrop-filter: blur(35px) saturate(200%) !important; -webkit-backdrop-filter: blur(35px) saturate(200%) !important; border-top: 0.5px solid rgba(0, 0, 0, 0.15) !important;';
        const inputBarStyle = this.showQuickReplies
            ? 'background: rgba(255, 255, 255, 0.15) !important; backdrop-filter: blur(35px) saturate(200%) !important; -webkit-backdrop-filter: blur(35px) saturate(200%) !important; border-top: 0.5px solid rgba(0, 0, 0, 0.15) !important;'
            : 'background: transparent !important;';

        return `
    <div class="chat-room" data-chat-id="${safeChatId}">
                <div class="chat-messages" id="chat-messages" data-chat-id="${safeChatId}">
                    ${this._renderMessageHistoryWindow(messages, userInfo, chat.id)}
                </div>

                <!-- è¾“å…¥åŒº -->
                <div class="chat-input-area" style="${inputAreaStyle}">
                    <!-- è¡¨æƒ…é¢æ¿ -->
                    ${this.showEmoji ? this.renderEmojiPanel() : ''}

                    <!-- æ›´å¤šåŠŸèƒ½é¢æ¿ -->
                    ${this.showMore ? this.renderMorePanel() : ''}

                    <!-- å¿«æ·å›å¤é¢æ¿ -->
                    ${this.showQuickReplies ? this.renderQuickReplyPanel() : ''}

                    <!-- å¼•ç”¨é¢„è§ˆæ  - ä»¿çœŸå®å¾®ä¿¡æµ…ç°æ¡ -->
                    ${this.activeQuote ? `<div class="active-quote-bar" style="padding: 2px 8px; background: rgba(0,0,0,0.05); font-size: 10px; color: #888; display: flex; justify-content: space-between; align-items: center; line-height: 1.2;"><div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${this._escapeHtml(this.activeQuote.sender)}: ${this._escapeHtml(this.activeQuote.content.length > 20 ? this.activeQuote.content.substring(0, 20) + '...' : this.activeQuote.content)}</div><button id="cancel-quote-btn" style="background: none; border: none; color: #aaa; cursor: pointer; padding: 0 4px; font-size: 10px; line-height: 1;"><i class="fa-solid fa-xmark"></i></button></div>` : ''}

                    <!-- è¾“å…¥è¡Œ -->
                    <div class="chat-input-bar" style="display: flex; align-items: center; justify-content: space-between; ${inputBarStyle}">
                        <div style="display: flex; align-items: center; gap: 0px;">
                            <button class="input-btn" id="quick-reply-btn" title="å¿«æ·å›å¤">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="4" y="4" width="5.4" height="5.4" rx="1.15"/>
                                    <rect x="14.6" y="4" width="5.4" height="5.4" rx="1.15"/>
                                    <rect x="4" y="14.6" width="5.4" height="5.4" rx="1.15"/>
                                    <rect x="14.6" y="14.6" width="5.4" height="5.4" rx="1.15"/>
                                </svg>
                            </button>
                            <button class="input-btn" id="regenerate-btn" title="é‡æ–°ç”Ÿæˆ">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
                            </button>
                        </div>
                        <div class="chat-input-wrapper" style="flex: 1; margin: 0;">
                            <input type="text" class="chat-input" id="chat-input"
                                   style="background: rgba(255, 255, 255, 0.42) !important; border: 0.5px solid rgba(255, 255, 255, 0.58) !important; color: #111111 !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important;"
                                   placeholder="${this._escapeHtml(this._getQuickReplyInputPlaceholder())}" value="${this._escapeHtml(this.inputText)}">
                        </div>
                        <div style="display: flex; align-items: center; gap: 0px;">
                            <button class="input-btn" id="emoji-btn" title="è¡¨æƒ…">
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

    // ğŸ”¥ æ¸²æŸ“æ¶ˆæ¯åˆ—è¡¨ï¼ˆå¸¸è§„2åˆ†é’Ÿæ—¶é—´èƒ¶å›Š + AIé¦–æ¡>1åˆ†é’Ÿå¼ºåˆ¶æ˜¾ç¤ºï¼‰
    renderMessagesWithDateDividers(messages, userInfo, options = {}) {
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return '';
        }

        let html = '';
        let lastRenderedTimestamp = 0;
        let lastRenderedDate = null;

        const startIndex = Math.max(0, Number(options.startIndex) || 0);
        messages.forEach((msg, index) => {
            try {
                const messageIndex = startIndex + index;
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

                // ğŸ”¥ æ—¥æœŸå˜åŒ–æ—¶å¼ºåˆ¶æ˜¾ç¤ºæ—¥æœŸåˆ†éš”ç¬¦ï¼ˆçº¿ä¸‹è½¬çº¿ä¸Šè·¨å¤©åœºæ™¯ï¼‰
                const isDateChanged = msgDate && msgDate !== lastRenderedDate;
                // ğŸ”¥ å¸¸è§„ï¼šè·ä¸Šæ¬¡æ—¶é—´æ ‡ç­¾è¾¾åˆ°2åˆ†é’Ÿæˆ–æ—¥æœŸå˜åŒ–ï¼›AIé¦–æ¡>1åˆ†é’Ÿä¹Ÿæ˜¾ç¤ºæ—¶é—´èƒ¶å›Š
                const isManualTimeMarker = msg?.isTimeMarker === true || msg?.type === 'time_marker';
                if (isManualTimeMarker) {
                    const markerText = this._buildWechatTimeDividerText(msg, { forceDate: true });
                    if (markerText) {
                        html += this.renderManualTimeMarkerDivider(msg, messageIndex, markerText);
                        lastRenderedTimestamp = msgTimestamp;
                        if (msgDate) lastRenderedDate = msgDate;
                    }
                    return;
                }

                if (isDateChanged || shouldShowAiFirstDivider || msgTimestamp - lastRenderedTimestamp >= 2 * 60 * 1000 || (index === 0 && msgTimestamp)) {
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

                html += this.renderMessage(msg, userInfo, messageIndex);
            } catch (e) {
                console.error('æ¸²æŸ“å•æ¡æ¶ˆæ¯å¤±è´¥ï¼Œå·²è·³è¿‡:', e, msg);
            }
        });

        // æ¸²æŸ“å®Œæˆåå°è¯•æ°´åˆè¡¨æƒ…åŒ…å ä½ç¬¦
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
        messagesDiv.innerHTML = this._renderMessageHistoryWindow(messages, userInfo, chatId);

        this.bindMessageLongPressEvents();
        this.bindManualTimeMarkerEvents();
        this.bindSpecialMessageEvents();
        this.bindInnerThoughtEvents();
        this.bindMessageSelectionEvents();
        this.bindMessageHistoryEvents();
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
                    <span>å…¨é€‰</span>
                </button>
                <button class="wechat-message-selection-action ${selectedCount > 0 ? '' : 'is-disabled'}" data-action="delete-tail" ${selectedCount > 0 ? '' : 'disabled'}>
                    <i class="fa-solid fa-arrow-down-long"></i>
                    <span>åˆ è‡³æœ«å°¾</span>
                </button>
                <button class="wechat-message-selection-action ${selectedCount > 0 ? 'is-danger' : 'is-disabled'}" data-action="delete" ${selectedCount > 0 ? '' : 'disabled'}>
                    <i class="fa-regular fa-trash-can"></i>
                    <span>åˆ é™¤${selectedCount > 0 ? `(${selectedCount})` : ''}</span>
                </button>
                <button class="wechat-message-selection-action ${selectedCount > 0 ? '' : 'is-disabled'}" data-action="forward" ${selectedCount > 0 ? '' : 'disabled'}>
                    <i class="fa-solid fa-share"></i><span>è½¬å‘</span>
                </button>
                <button class="wechat-message-selection-action is-close" data-action="cancel" aria-label="é€€å‡ºå¤šé€‰">
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
        bar.querySelector('[data-action="forward"]')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showMessageForwardDialog();
        });
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
        const forwardBtn = targetBar.querySelector('[data-action="forward"]');
        if (forwardBtn) {
            forwardBtn.disabled = selectedCount <= 0;
            forwardBtn.classList.toggle('is-disabled', selectedCount <= 0);
        }
        const deleteTailBtn = targetBar.querySelector('[data-action="delete-tail"]');

        if (deleteBtn) {
            deleteBtn.disabled = selectedCount <= 0;
            deleteBtn.classList.toggle('is-danger', selectedCount > 0);
            deleteBtn.classList.toggle('is-disabled', selectedCount <= 0);
            const label = deleteBtn.querySelector('span');
            if (label) label.textContent = `åˆ é™¤${selectedCount > 0 ? `(${selectedCount})` : ''}`;
        }

        if (deleteTailBtn) {
            deleteTailBtn.disabled = selectedCount <= 0;
            deleteTailBtn.classList.toggle('is-disabled', selectedCount <= 0);
        }
    }

    _buildSelectedForwardEntries() {
        const data = this.app.wechatData;
        const sourceId = this._getCurrentMessageSelectionChatId();
        const source = data.getChat(sourceId);
        if (!source || !this._isMessageSelectionActiveForCurrentChat()) return [];
        const user = data.getUserInfo();
        return data.getMessages(sourceId)
            .filter(msg => this.selectedMessageIds.has(String(msg.id)))
            .map(msg => {
                const content = this._formatMessageContentForPrompt({ ...msg, type: msg.type || 'text' }, source);
                if (!content) return null;
                const contact = data.getContact(msg.from);
                const sender = msg.from === 'me' ? (user.name || 'ç”¨æˆ·')
                    : (data.getContact(msg.from)?.name || (msg.from === 'char' ? source.name : msg.from) || source.name);
                const avatar = msg.from === 'me' ? user.avatar : (msg.avatar || contact?.avatar || (source.type !== 'group' ? source.avatar : ''));
                return {
                    sender, avatar: /^data:/i.test(String(avatar || '')) ? '' : (avatar || ''), content,
                    date: String(msg.date || ''), time: String(msg.time || ''),
                    timestamp: Number.isFinite(Number(msg.timestamp)) ? Number(msg.timestamp) : 0
                };
            }).filter(Boolean);
    }

    _formatForwardEntryTime(entry) {
        let date = String(entry.date || '').trim();
        let time = String(entry.time || '').trim();
        if (Number(entry.timestamp) > 0) {
            if (!date) date = this._formatWechatDateFromTimestamp(entry.timestamp);
            if (!time) time = this._formatWechatTimeFromTimestamp(entry.timestamp);
        }
        date = date.replace(/^(\d{1,6})[-/]\s*(\d{1,2})[-/]\s*(\d{1,2})$/, '$1å¹´$2æœˆ$3æ—¥');
        return [date, time].filter(Boolean).join(' ');
    }

    _buildSelectedForwardContent(entries = this._buildSelectedForwardEntries()) {
        const source = this.app.wechatData.getChat(this._getCurrentMessageSelectionChatId());
        if (!source) return '';
        const lines = entries.map(entry => {
            const time = this._formatForwardEntryTime(entry);
            return `${entry.sender}${time ? `ï¼ˆ${time}ï¼‰` : ''}ï¼š${entry.content}`;
        });
        return lines.length ? `ã€è½¬å‘èŠå¤©è®°å½•ï¼š${source.name}ã€‘\n${lines.join('\n\n')}` : '';
    }

    _getMessageForwardTargets() {
        const data = this.app.wechatData;
        const sourceId = this._getCurrentMessageSelectionChatId();
        const contacts = data.getContacts();
        return [
            ...contacts.filter(c => !c.blocked).map(c => ({
                key: `friend:${c.id}`, name: data.getContactDisplayName(c) || c.name,
                contactId: c.id, type: 'single', avatar: c.avatar
            })),
            ...data.getChatList().filter(c => c.type !== 'group' && c.id !== sourceId
                && !contacts.some(contact => contact.id === c.contactId || contact.name === c.name)
                && !this._isBlockedSingleChat(c)).map(c => ({
                key: `chat:${c.id}`, name: c.name, chatId: c.id, type: 'single', avatar: c.avatar
            })),
            ...data.getChatList().filter(c => c.type === 'group' && c.id !== sourceId).map(c => ({
                key: `group:${c.id}`, name: c.name, chatId: c.id, type: 'group', avatar: c.avatar
            }))
        ];
    }

    _sendForwardedMessages(target, content, entries = this._buildSelectedForwardEntries()) {
        if (!content) throw new Error('æ²¡æœ‰å¯è½¬å‘çš„æ¶ˆæ¯');
        const data = this.app.wechatData;
        if (target.type !== 'group' && data.getContact(target.contactId)?.blocked) throw new Error('è¯¥å¥½å‹å·²è¢«æ‹‰é»‘');
        const chat = target.chatId ? data.getChat(target.chatId) : data.createChat(target);
        if (!chat) throw new Error('ç›®æ ‡èŠå¤©ä¸å­˜åœ¨');
        const timeFields = this._shouldUseRealTimeForOnlineChat() ? this._buildWechatRealTimeFields() : {};
        const added = data.addMessage(chat.id, {
            from: 'me', type: 'forward_card', content, avatar: data.getUserInfo().avatar,
            forwardEntries: entries.map(entry => ({ ...entry })),
            batchId: `forward_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            ...timeFields
        });
        if (added === false) throw new Error('æ¶ˆæ¯æœªèƒ½ä¿å­˜');
        return chat;
    }

    showMessageForwardDialog() {
        const entries = this._buildSelectedForwardEntries();
        const content = this._buildSelectedForwardContent(entries);
        if (!content) {
            this.app.phoneShell.showNotification('æç¤º', 'è¯·é€‰æ‹©å¯è½¬å‘çš„èŠå¤©æ¶ˆæ¯', 'â„¹ï¸');
            return;
        }
        const root = this.getCurrentWechatView();
        if (!root) return;
        root.querySelector('.wechat-forward-overlay')?.remove();
        const targets = this._getMessageForwardTargets();
        const overlay = document.createElement('div');
        overlay.className = 'wechat-forward-overlay';
        overlay.innerHTML = `<div class="wechat-forward-dialog" role="dialog" aria-modal="true" aria-label="è½¬å‘èŠå¤©è®°å½•">
            <div class="wechat-forward-heading">è½¬å‘èŠå¤©è®°å½•</div>
            <div class="wechat-forward-preview">${this._escapeHtml(content)}</div>
            <div class="wechat-forward-section-title">è½¬å‘ç»™</div>
            <div class="wechat-forward-list">${targets.map((target, index) => `
                <button type="button" class="wechat-forward-target" data-target="${index}" aria-pressed="false">
                    <span class="wechat-forward-avatar" aria-hidden="true">${this.app.renderAvatar(target.avatar, target.type === 'group' ? 'ğŸ‘¥' : 'ğŸ‘¤', target.name)}</span>
                    <span class="wechat-forward-name">${this._escapeHtml(target.name)}</span>
                    <span class="wechat-forward-check" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M5 12.5 9.5 17 19 7" /></svg></span>
                </button>`).join('') || '<p class="wechat-forward-empty">æš‚æ— å¯è½¬å‘çš„å¥½å‹æˆ–ç¾¤èŠ</p>'}</div>
            <div class="wechat-forward-actions"><button type="button" data-action="close">å–æ¶ˆ</button><button type="button" data-action="send" disabled>å‘é€</button></div>
        </div>`;
        root.appendChild(overlay);
        let chosen = null;
        const send = overlay.querySelector('[data-action="send"]');
        overlay.addEventListener('click', e => {
            e.stopPropagation();
            if (e.target === overlay || e.target.closest('[data-action="close"]')) overlay.remove();
            const button = e.target.closest('[data-target]');
            if (button) {
                chosen = targets[Number(button.dataset.target)];
                overlay.querySelectorAll('[data-target]').forEach(el => {
                    el.classList.toggle('is-selected', el === button);
                    el.setAttribute('aria-pressed', String(el === button));
                });
                send.disabled = false;
            }
        });
        send.addEventListener('click', () => {
            if (!chosen || send.disabled) return;
            send.disabled = true;
            try {
                this._sendForwardedMessages(chosen, content, entries);
                overlay.remove();
                this.exitMessageSelectionMode();
                this.app.phoneShell.showNotification('è½¬å‘æˆåŠŸ', `å·²è½¬å‘ç»™ ${chosen.name}`, 'âœ…');
            } catch (error) {
                send.disabled = false;
                this.app.phoneShell.showNotification('è½¬å‘å¤±è´¥', error.message, 'âš ï¸');
            }
        });
    }

    _getForwardedRecord(msg) {
        const content = String(msg?.content || '');
        const header = content.match(/^ã€è½¬å‘èŠå¤©è®°å½•ï¼š([^\r\n]*)ã€‘\r?\n/);
        if (msg?.type !== 'forward_card' && !((msg?.type === 'text' || !msg?.type) && header)) return null;
        return {
            title: header ? `${header[1]}çš„èŠå¤©è®°å½•` : 'èŠå¤©è®°å½•',
            content: header ? content.slice(header[0].length) : content
        };
    }

    _renderForwardedRecordCard(msg) {
        const record = this._getForwardedRecord(msg);
        if (!record) return '';
        const preview = record.content.split(/\r?\n/).filter(line => line.trim()).slice(0, 3).join('\n');
        return `<div class="wechat-forward-record-card" data-msg-id="${this._escapeHtml(msg.id || '')}" role="button" tabindex="0" aria-label="æŸ¥çœ‹èŠå¤©è®°å½•">
            <div class="wechat-forward-record-title">${this._escapeHtml(record.title)}</div>
            <div class="wechat-forward-record-summary">${this._escapeHtml(preview)}</div>
            <div class="wechat-forward-record-footer"><span>èŠå¤©è®°å½•</span><span>æŸ¥çœ‹è¯¦æƒ…</span></div>
        </div>`;
    }

    openForwardedRecord(messageId) {
        const msg = this.app.wechatData.getMessages(this.app.currentChat?.id)
            .find(item => String(item.id) === String(messageId));
        const record = this._getForwardedRecord(msg);
        const root = this.getCurrentWechatView();
        if (!record || !root) return;
        root.querySelector('.wechat-forward-record-overlay')?.remove();
        const modal = document.createElement('div');
        modal.className = 'wechat-forward-overlay wechat-forward-record-overlay';
        modal.innerHTML = `<div class="wechat-forward-dialog wechat-forward-record-dialog" role="dialog" aria-modal="true" aria-label="èŠå¤©è®°å½•è¯¦æƒ…">
            <div class="wechat-forward-heading">${this._escapeHtml(record.title)}</div>
            <div class="wechat-forward-record-body${msg.forwardEntries?.length ? ' wechat-forward-record-structured' : ''}">${this._renderForwardedRecordDetails(msg, record)}</div>
            <div class="wechat-forward-actions"><button type="button" data-action="close">å…³é—­</button></div>
        </div>`;
        root.appendChild(modal);
        modal.addEventListener('click', e => {
            e.stopPropagation();
            if (e.target === modal || e.target.closest('[data-action="close"]')) modal.remove();
        });
    }

    _renderForwardedRecordDetails(msg, record = this._getForwardedRecord(msg)) {
        if (!Array.isArray(msg.forwardEntries) || !msg.forwardEntries.length) return this._escapeHtml(record?.content || '');
        return msg.forwardEntries.map(entry => `<div class="wechat-forward-record-entry">
            <div class="wechat-forward-avatar" aria-hidden="true">${this.app.renderAvatar(entry.avatar, 'ğŸ‘¤', entry.sender)}</div>
            <div class="wechat-forward-record-entry-main">
                <div class="wechat-forward-record-entry-header"><span class="wechat-forward-record-sender">${this._escapeHtml(entry.sender)}</span><span class="wechat-forward-record-time">${this._escapeHtml(this._formatForwardEntryTime(entry))}</span></div>
                <div class="wechat-forward-record-entry-text">${this._escapeHtml(entry.content)}</div>
            </div>
        </div>`).join('');
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
                check.setAttribute('aria-label', selected ? 'å–æ¶ˆé€‰æ‹©' : 'é€‰æ‹©æ¶ˆæ¯');
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
            this.app.phoneShell?.showNotification('æç¤º', 'è¯·å…ˆé€‰æ‹©è¦åˆ é™¤çš„æ¶ˆæ¯', 'âš ï¸');
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
        this.app.phoneShell?.showNotification('å·²åˆ é™¤', `å·²åˆ é™¤ ${deletedCount} æ¡æ¶ˆæ¯`, 'ğŸ—‘ï¸');
    }

    deleteMessagesFromFirstSelectionToEnd() {
        if (!this._isMessageSelectionActiveForCurrentChat()) return;
        const chatId = String(this.app.currentChat?.id || '').trim();
        const selectedIds = new Set(Array.from(this.selectedMessageIds || []).map(id => String(id || '').trim()).filter(Boolean));
        if (!chatId || selectedIds.size === 0) {
            this.app.phoneShell?.showNotification('æç¤º', 'è¯·å…ˆé€‰æ‹©èµ·å§‹æ¶ˆæ¯', 'âš ï¸');
            return;
        }

        const messages = this.app.wechatData.getMessages(chatId) || [];
        const startMessage = messages.find(msg => selectedIds.has(String(msg?.id || '').trim()));
        if (!startMessage?.id) {
            this.app.phoneShell?.showNotification('æç¤º', 'æœªæ‰¾åˆ°èµ·å§‹æ¶ˆæ¯', 'âš ï¸');
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
        this.app.phoneShell?.showNotification('å·²åˆ é™¤', `å·²ä»è¯¥å¤„åˆ é™¤ ${deletedCount} æ¡æ¶ˆæ¯`, 'ğŸ—‘ï¸');
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
                senderName: userInfo.name || 'æˆ‘',
                senderAvatar: userInfo.avatar || ''
            };
        }

        const isGroupChat = this.app.currentChat?.type === 'group';
        if (isGroupChat) {
            const senderName = msg.from || 'ç¾¤æˆå‘˜';
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
        const senderName = currentContact?.name || currentChat.name || msg.from || 'å¯¹æ–¹';
        const senderAvatar = currentContact?.avatar || currentChat.avatar || msg.avatar || '';

        return {
            isMe: false,
            senderName,
            senderAvatar
        };
    }

    // ğŸ”¥ æ™ºèƒ½å±€éƒ¨åˆ·æ–°æ¶ˆæ¯åˆ—è¡¨ï¼ˆç§»åŠ¨ç«¯å®‰å…¨ç‰ˆé˜²é—ªçƒï¼‰
    smartUpdateMessages(messages, userInfo, options = {}) {
        const container = this._getVisibleChatMessagesContainer?.(options.chatId) || document.getElementById('chat-messages');
        if (!container) return;

        // 1. è®°å½•æ›´æ–°å‰çš„æ»šåŠ¨çŠ¶æ€
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;

        // 2. ç”Ÿæˆæ–° HTML
        let newHtml = '';
        try {
            const chatId = String(options.chatId || this.app?.currentChat?.id || '').trim();
            newHtml = this._renderMessageHistoryWindow(messages, userInfo, chatId);
        } catch (error) {
            console.error('å¾®ä¿¡æ¶ˆæ¯åˆ—è¡¨ HTML ç”Ÿæˆå¤±è´¥:', error);
            return;
        }

        // 3. ç§»åŠ¨ç«¯å®‰å…¨æ›¿æ¢ï¼šæŠ›å¼ƒå±é™©çš„ outerHTMLï¼Œä½¿ç”¨åŸç”Ÿ innerHTML æ›¿æ¢
        try {
            container.innerHTML = newHtml;
        } catch (error) {
            console.error('å¾®ä¿¡æ¶ˆæ¯åˆ—è¡¨åˆ·æ–°å¤±è´¥:', error);
            return;
        }

        // 4. é‡æ–°ç»‘å®šäº‹ä»¶ã€‚è¿™é‡Œä¸èƒ½å½±å“å‘é€ä¸»æµç¨‹ï¼Œå¦åˆ™ä¼šå‡ºç° API å·²å®Œæˆä½†å¾®ä¿¡ä¸€ç›´é»„ç¯ã€‚
        try {
            this.bindMessageLongPressEvents();
            this.bindManualTimeMarkerEvents();
            this.bindSpecialMessageEvents();
            this.bindInnerThoughtEvents();
            this.bindMessageSelectionEvents();
            this.bindMessageHistoryEvents();
        } catch (error) {
            console.error('å¾®ä¿¡æ¶ˆæ¯åˆ—è¡¨äº‹ä»¶ç»‘å®šå¤±è´¥:', error);
        }

        // 5. æ¢å¤æ»šåŠ¨çŠ¶æ€ï¼ˆå¦‚æœæœ¬æ¥åœ¨åº•éƒ¨ï¼Œå°±ç»§ç»­è´´åº•ï¼‰
        if (isNearBottom) {
            container.scrollTop = container.scrollHeight;
        }
    }

    // æ¸²æŸ“å•æ¡æ¶ˆæ¯ï¼ˆå…¨æ–°çº¢åŒ…æ ·å¼ï¼‰
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
            <button class="message-select-check ${isSelected ? 'checked' : ''}" data-message-id="${this._escapeHtml(messageId)}" aria-label="${isSelected ? 'å–æ¶ˆé€‰æ‹©' : 'é€‰æ‹©æ¶ˆæ¯'}" style="order:-1;">
                ${isSelected ? '<i class="fa-solid fa-check"></i>' : ''}
            </button>
        ` : '';

        // ğŸ”¥ğŸ”¥ğŸ”¥ ç³»ç»Ÿæ¶ˆæ¯ç‰¹æ®Šå¤„ç†ï¼ˆå±…ä¸­é€æ˜æ°”æ³¡ï¼‰
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

        // ğŸ”¥ğŸ”¥ğŸ”¥ ç¾¤èŠæ¶ˆæ¯å¤„ç†ï¼šè·å–å‘é€è€…åå­—å’Œå¤´åƒ
        const isGroupChat = this.app.currentChat?.type === 'group';

        let messageBody = '';

        const contentStr = String(msg?.content || '').trim();
        const inlineVoiceNewMatch = /^(?:\[\s*(?:è¯­éŸ³æ¡|è¯­éŸ³)\s*\]|ã€\s*(?:è¯­éŸ³æ¡|è¯­éŸ³)\s*ã€‘)\s*[:ï¼š]?\s*(.+)$/i.exec(contentStr);
        const inlineVoiceOldMatch = /^\[è¯­éŸ³\s*(\d+)ç§’?\]\(?([^)]*)\)?$/i.exec(contentStr);
        const effectiveType = this._getForwardedRecord(msg) ? 'forward_card' : (msg.type === 'text' || !msg.type)
            && (inlineVoiceNewMatch || inlineVoiceOldMatch)
            ? 'voice'
            : msg.type;

        switch (effectiveType) {
            case 'forward_card':
                messageBody = this._renderForwardedRecordCard(msg);
                break;
            case 'file_card': {
                const appearance = getWechatFileAppearance(msg.fileTitle);
                messageBody = `<div class="wechat-forward-record-card wechat-file-card" data-msg-id="${this._escapeHtml(msg.id || '')}" role="button" tabindex="0" aria-label="æ‰“å¼€æ–‡ä»¶">
                    <div class="wechat-file-card-main"><div class="wechat-file-card-title">${this._escapeHtml(msg.fileTitle || 'æ–‡ä»¶')}</div><span class="wechat-file-card-icon is-${appearance.kind}" aria-hidden="true">${appearance.glyph}</span></div>
                    <div class="wechat-forward-record-footer"><span>${appearance.label}</span><span>ç‚¹å‡»æŸ¥çœ‹</span></div></div>`;
                break;
            }
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
                    const photoBoxClass = isCustomEmojiImage
                        ? 'message-image-box-custom-emoji'
                        : 'wechat-chat-photo-box';
                    const photoClass = isCustomEmojiImage ? '' : 'wechat-chat-photo';
                    messageBody = `<div class="message-image-box ${photoBoxClass}" style="position: relative; display: inline-block; line-height: 0; ${customEmojiBoxStyle}"><img src="${safeImageContent}" class="message-image ${photoClass}" style="${customEmojiImgStyle}"></div>`;
                }
                break;
            case 'image_prompt':
                messageBody = this.renderImagePromptCard(msg);
                break;
            case 'location': {
                const locationRaw = String(msg.locationText || msg.locationAddress || msg.content || '').trim() || 'æœªçŸ¥ä½ç½®';
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
                let durationNum = parseInt(durationStr.replace('"', '').replace('ç§’', '')) || 3;
                let voiceText = msg.voiceText || '';
                let innerThought = String(msg.innerThought || '').trim();
                let hasExplicitLegacyDuration = false;

                // å…¼å®¹æ–°è€æ ¼å¼æå–
                const newVMatch = inlineVoiceNewMatch || /^(?:\[\s*(?:è¯­éŸ³æ¡|è¯­éŸ³)\s*\]|ã€\s*(?:è¯­éŸ³æ¡|è¯­éŸ³)\s*ã€‘)\s*[:ï¼š]?\s*(.+)$/i.exec(msg.content);
                if (newVMatch) {
                    voiceText = newVMatch[1];
                } else {
                    const oldVMatch = inlineVoiceOldMatch || /^\[è¯­éŸ³\s*(\d+)ç§’?\]\(?([^)]*)\)?$/.exec(msg.content);
                    if (oldVMatch) {
                        durationStr = oldVMatch[1] + '"';
                        voiceText = oldVMatch[2] || '';
                        durationNum = parseInt(oldVMatch[1]);
                        hasExplicitLegacyDuration = true;
                    }
                }
                const parsedVoice = parseWechatVoiceContent(voiceText);
                voiceText = parsedVoice.voiceText;
                const voiceTtsText = parsedVoice.ttsText;
                const voiceDisplay = this._parseWechatBubbleDisplay(voiceText);
                if (!innerThought) innerThought = parsedVoice.innerThought;
                if (!hasExplicitLegacyDuration) {
                    durationNum = Math.max(2, Math.min(Math.ceil((voiceTtsText || voiceText || 'è¯­éŸ³').length / 3), 60));
                    durationStr = durationNum + '"';
                }

                // åŠ¨æ€å®½åº¦
                const minW = 60;
                const maxW = 200;
                let dynamicWidth = minW + (durationNum / 60) * (maxW - minW);
                if (dynamicWidth > maxW) dynamicWidth = maxW;

                // SVGæ³¢çº¹ (å¾®è°ƒäº†å‚ç›´å¯¹é½) - å¸¦åŠ¨ç”» class
                const voiceSvgLeft = `<svg class="voice-wave-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; margin-top: -1px;"><path d="M8 12h.01"/><path class="voice-arc-1" d="M12 8.5a5 5 0 0 1 0 7"/><path class="voice-arc-2" d="M16 5a10 10 0 0 1 0 14"/></svg>`;
                const voiceSvgRight = `<svg class="voice-wave-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: scaleX(-1); flex-shrink: 0; margin-top: -1px;"><path d="M8 12h.01"/><path class="voice-arc-1" d="M12 8.5a5 5 0 0 1 0 7"/><path class="voice-arc-2" d="M16 5a10 10 0 0 1 0 14"/></svg>`;

                const showInnerThought = !!innerThought;
                if (showInnerThought) {
                    messageBody = '<div class="wechat-inner-os-wrapper">';
                }

                // ğŸ”¥ åŒ…è£¹å®¹å™¨ï¼šç«–å‘æ’åˆ—è¯­éŸ³æ¡å’Œè½¬æ–‡å­—
                messageBody += `<div style="display: flex; flex-direction: column; gap: 4px; align-items: ${isMe ? 'flex-end' : 'flex-start'};">`;

                // ğŸ”¥ 1. è¯­éŸ³æ¡ï¼šã€å®Œå…¨å¤ç”¨ .message-text ç±»ã€‘ï¼Œä¿è¯ paddingã€é¢œè‰²ã€åœ†è§’ã€å°å°¾å·´å’Œçº¯æ–‡å­—æ¡† 100% åƒç´ çº§ä¸€è‡´ï¼
                // ä½¿ç”¨ display: flex å®ç°å·¦å³å¯¹é½
                messageBody += `
                <div class="message-text voice-bubble-playable" id="voice-bubble-${this.escapeInlineStickerAttr(msg.id || Math.random().toString(36).substr(2, 9))}" data-text="${this.escapeInlineStickerAttr(voiceTtsText || '')}" style="width: ${dynamicWidth}px; display: flex; justify-content: space-between; align-items: center; box-sizing: border-box; cursor: pointer;">
                    ${isMe
                        ? `<span>${this._escapeHtml(durationStr)}</span> ${voiceSvgRight}`
                        : `${voiceSvgLeft} <span>${this._escapeHtml(durationStr)}</span>`}
                    ${showInnerThought && !voiceText ? '<button class="wechat-inner-os-fold" type="button" aria-label="æŸ¥çœ‹å†…å¿ƒOS"></button>' : ''}
                </div>
            `;

                // ğŸ”¥ 2. è¯­éŸ³è½¬æ–‡å­—ï¼šä»¿ç…§æ–‡æœ¬æ¡†æ‰‹å†™æ ·å¼ï¼Œä½†ä¸åŠ  .message-text ç±»ï¼ˆä¸ºäº†é¿å…å°å°¾å·´é‡å¤å‡ºç°ï¼‰
                if (voiceText) {
                    messageBody += `
                    <div class="${['wechat-voice-transcript', voiceDisplay.hasTranslation ? 'wechat-translation-card' : '', showInnerThought ? 'wechat-inner-os-bubble' : ''].filter(Boolean).join(' ')}" style="
                        position: relative;
                        padding: 7px 10px;
                        border-radius: 4px;
                        ${showInnerThought ? 'padding-right: 22px; border-bottom-right-radius: 0;' : ''}
                        font-size: 14px;
                        line-height: 1.4;
                        background: ${isMe ? '#95ec69' : '#fff'};
                        color: ${isMe ? '#000' : '#1c1c1e'};
                        box-shadow: ${isMe ? 'none' : '0 1px 2px rgba(0,0,0,0.08)'};
                        word-break: break-word;
                        max-width: 100%;
                        box-sizing: border-box;
                        text-align: left;
                    ">${voiceDisplay.hasTranslation
                        ? this._renderWechatTranslationContent(voiceDisplay.originalText, voiceDisplay.translationText, { hasInnerThought: showInnerThought })
                        : `${this._escapeHtml(voiceText)}${showInnerThought ? '<button class="wechat-inner-os-fold" type="button" aria-label="æŸ¥çœ‹å†…å¿ƒOS"></button>' : ''}`}</div>
                `;
                }
                messageBody += `</div>`;
                if (showInnerThought) {
                    messageBody += `
                        <div class="wechat-inner-os-popup" role="note">
                            <div class="wechat-inner-os-title">INNER THOUGHTS</div>
                            <div class="wechat-inner-os-content">${this._escapeHtml(innerThought)}</div>
                        </div>
                    </div>`;
                }
                break;
            case 'transfer': {
                const isTransferOpened = paymentStatus === 'received' || isPaymentRefunded;
                const transferSubtitle = isPaymentRefunded
                    ? 'å·²é€€å›'
                    : (isMe
                        ? (paymentStatus === 'received' ? 'å¯¹æ–¹å·²æ”¶æ¬¾' : 'ä½ å‘èµ·äº†ä¸€ç¬”è½¬è´¦')
                        : (paymentStatus === 'received' ? 'å·²æ¥æ”¶' : 'æ”¶åˆ°è½¬è´¦'));
                const formattedAmount = parseFloat(msg.amount || 0).toFixed(2);
                messageBody = `
                <div class="message-transfer ${isTransferOpened ? 'opened' : ''}" data-msg-id="${this._escapeHtml(msg.id || '')}">
                    <div class="rp-main">
                        <div class="rp-icon">
                            <!-- fake-world transfer2-outlined.svg åŸç‰ˆå›¾æ ‡ -->
                            <svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                                <path fill-rule="evenodd" clip-rule="evenodd" d="M2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12ZM20.8 12C20.8 16.8601 16.8601 20.8 12 20.8C7.13989 20.8 3.2 16.8601 3.2 12C3.2 7.13989 7.13989 3.2 12 3.2C16.8601 3.2 20.8 7.13989 20.8 12ZM9.7899 9.92367H17V11.1237H9L7.54588 11.1237C7.26974 11.1237 7.04588 10.8998 7.04588 10.6237C7.04588 10.4757 7.11143 10.3353 7.2249 10.2403L10.3863 7.59332C10.5557 7.4515 10.808 7.47384 10.9498 7.64322C11.0632 7.77865 11.0743 7.97241 10.9772 8.11994L9.7899 9.92367ZM7.04588 14.08H14.256L13.0687 15.8837C12.9716 16.0313 12.9827 16.225 13.0961 16.3605C13.2379 16.5298 13.4902 16.5522 13.6596 16.4104L16.821 13.7634C16.9344 13.6684 17 13.528 17 13.38C17 13.1039 16.7761 12.88 16.5 12.88H15.0459H7.04588V14.08Z" />
                            </svg>
                        </div>
                        <div class="rp-content">
                            <div class="rp-title">Â¥${formattedAmount}</div>
                            <div class="rp-subtitle">${this._escapeHtml(transferSubtitle)}</div>
                        </div>
                    </div>
                    <div class="rp-footer">å¾®ä¿¡è½¬è´¦</div>
                </div>
            `;
                break;
            }

            case 'call_record': {
                const callStatusText = msg.status === 'answered'
                    ? `é€šè¯æ—¶é•¿ ${msg.duration}`
                    : msg.status === 'rejected'
                        ? 'å¯¹æ–¹å·²æ‹’ç»'
                        : msg.status === 'declined'
                            ? 'å¯¹æ–¹å·²æ‹’ç»'
                            : msg.status === 'cancelled'
                                ? 'å·²å–æ¶ˆ'
                                : 'æœªæ¥å¬';
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

            case 'redpacket': {
                const packetMode = String(msg.packetMode || '').trim();
                const isGroupPacket = isGroupChat && (msg.isGroupPacket === true || packetMode === 'group_lucky' || packetMode === 'group_average');
                const recipientName = String(msg.recipientName || msg.targetName || '').trim();
                const isTargetedGroupPacket = isGroupChat && !isGroupPacket && !!recipientName;
                const packetFooter = isGroupPacket
                    ? 'ç¾¤çº¢åŒ…'
                    : (isTargetedGroupPacket ? `ç»™${recipientName}çš„çº¢åŒ…` : 'å¾®ä¿¡çº¢åŒ…');
                const claims = Array.isArray(msg.claims) ? msg.claims : [];
                const claimSummary = claims.length > 0
                    ? `<div class="rp-subtitle">${claims.length}äººå·²é¢†å–</div>`
                    : '';
                const statusSummary = isPaymentRefunded
                    ? '<div class="rp-subtitle">å·²é€€å›</div>'
                    : (isRedPacketOpened
                        ? `<div class="rp-subtitle">${isMe ? 'å·²è¢«é¢†å–' : 'å·²é¢†å–'}</div>`
                        : claimSummary);
                messageBody = `
                <div class="message-redpacket ${(isRedPacketOpened || isPaymentRefunded) ? 'opened' : ''}" data-msg-id="${this._escapeHtml(msg.id || '')}">
                    <div class="rp-main">
                        <div class="rp-icon">
                            <svg viewBox="0 0 24 24" fill="none">
                                <rect x="2" y="4" width="20" height="16" rx="2" fill="#F45448"/>
                                <path d="M2 6 C 2 6, 12 14, 22 6 L 22 4 C 22 4, 2 4, 2 4 Z" fill="#FBD878"/>
                                <circle cx="12" cy="10" r="3.5" fill="#FBD878"/>
                                <rect x="11.2" y="9.2" width="1.6" height="1.6" fill="#F45448"/>
                            </svg>
                        </div>
                        <div class="rp-content">
                            <div class="rp-title">${this._escapeHtml(msg.wish || 'æ­å–œå‘è´¢ï¼Œå¤§å‰å¤§åˆ©')}</div>
                            ${statusSummary}
                        </div>
                    </div>
                    <div class="rp-footer">${this._escapeHtml(packetFooter)}</div>
                </div>
            `;
                break;
            }
            // è¡¨æƒ…åŒ…æ¶ˆæ¯ï¼šæœ¬åœ°è‡ªå®šä¹‰è¡¨æƒ…ä¼˜å…ˆï¼Œå…¶æ¬¡ ALAPIï¼Œæœ€åå…³é”®è¯å ä½å¡ç‰‡
           case 'sticker':
                const stickerKeyword = String(msg.keyword || 'å‘å‘†');
                const directStickerUrl = this.normalizeStickerDirectImageUrl(msg.stickerUrl || stickerKeyword);
                if (directStickerUrl) {
                    messageBody = `
                    <div class="message-sticker-box" style="line-height:0; display:inline-block; max-width:min(156px, 100%); max-height:156px;">
                        ${this.renderDirectStickerImage(directStickerUrl, stickerKeyword || 'è¡¨æƒ…åŒ…', { maxHeight: 156 })}
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

                // æ²¡æœ‰åŒ¹é…åˆ°è‡ªå®šä¹‰è¡¨æƒ…ï¼Œèµ° APIï¼›è‹¥å¤±è´¥åˆ™æ˜¾ç¤ºå…³é”®è¯å ä½å¡ç‰‡ï¼ˆä¸å†æ˜ å°„ emojiï¼‰
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
                            ${this._escapeHtml(wb.blogger || 'å¾®åš')}
                        </div>
                        <div style="font-size: 12px; color: #666; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                            ${replacePhoneEmojiTokens(this._escapeHtml((wb.content || '').substring(0, 80)), {
                                size: 16,
                                className: 'wechat-inline-system-emoji'
                            })}
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: flex-start; gap: 6px; padding: 6px 10px; background: #f5f5f5; border-top: 1px solid #eee;">
                        <div style="width: 18px; height: 18px; border-radius: 4px; background: #ff9f3d; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 400; flex-shrink: 0;">å¾®</div>
                        <span style="font-size: 11px; color: #999; font-weight: 400;">å¾®åš</span>
                    </div>
                </div>
                `;
                break;
            }

            case 'x_card': {
                const xData = msg.xData && typeof msg.xData === 'object' ? msg.xData : {};
                const author = xData.author && typeof xData.author === 'object' ? xData.author : {};
                const authorName = this._escapeHtml(author.name || 'X ç”¨æˆ·');
                const accountType = String(author.accountType || '').trim().toLowerCase();
                const accountLabel = accountType === 'official'
                    ? '<span style="color:#1d9bf0; font-size:10px; margin-left:3px;">å®˜æ–¹è®¤è¯</span>'
                    : accountType === 'advertiser'
                        ? '<span style="color:#d4a72c; font-size:10px; margin-left:3px;">å¹¿å‘Šè´¦å·</span>'
                        : '';
                const contentPreview = replacePhoneEmojiTokens(
                    this._escapeHtml(String(xData.content || msg.content || '').trim().slice(0, 100)),
                    { size: 16, className: 'wechat-inline-system-emoji' }
                );
                const imageStates = Array.isArray(xData.imageGenerationStates) ? xData.imageGenerationStates : [];
                const images = Array.isArray(xData.images) ? xData.images : [];
                let thumbnail = '';
                for (let index = 0; index < Math.max(images.length, imageStates.length); index += 1) {
                    const stateUrl = String(imageStates[index]?.generatedImageUrl || '').trim();
                    const rawImage = String(images[index] || '').trim();
                    const rawMatch = rawImage.match(/((?:https?:\/\/|\/backgrounds\/)[^\s)ï¼‰]+)/i);
                    const imageUrl = stateUrl || String(rawMatch?.[1] || '').trim();
                    if (imageUrl) {
                        thumbnail = `<img src="${this._escapeHtml(imageUrl)}" alt="" style="width:56px;height:56px;object-fit:cover;flex:0 0 56px;background:#eff3f4;">`;
                        break;
                    }
                }
                messageBody = `
                <div class="message-x-card" data-msg-id="${this._escapeHtml(msg.id || '')}" style="width:230px;max-width:100%;overflow:hidden;border:1px solid #e7e9ea;border-radius:8px;background:#fff;box-shadow:0 1px 2px rgba(15,20,25,0.06);cursor:pointer;">
                    <div style="display:flex;min-height:72px;">
                        <div style="min-width:0;flex:1;padding:10px;">
                            <div style="display:flex;align-items:center;min-width:0;margin-bottom:4px;white-space:nowrap;overflow:hidden;">
                                <strong style="min-width:0;overflow:hidden;text-overflow:ellipsis;color:#0f1419;font-size:13px;">${authorName}</strong>${accountLabel}
                            </div>
                            <div style="display:-webkit-box;overflow:hidden;color:#536471;font-size:12px;line-height:1.45;-webkit-box-orient:vertical;-webkit-line-clamp:2;word-break:break-word;">${contentPreview || 'åˆ†äº«äº†ä¸€æ¡ X å¸–å­'}</div>
                        </div>
                        ${thumbnail}
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;padding:6px 10px;border-top:1px solid #eff3f4;background:#f7f9f9;">
                        <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;background:#0f1419;color:#fff;font-size:10px;font-weight:700;">X</span>
                        <span style="color:#536471;font-size:11px;">X åˆ†äº«</span>
                    </div>
                </div>
                `;
                break;
            }

            case 'wangxiang_task_card':
            case 'wangxiang_task_confirmation':
            case 'wangxiang_task_invitation': {
                const task = msg.wangxiangTaskData || {};
                const isConfirmation = msg.type === 'wangxiang_task_confirmation';
                const isInvitation = msg.type === 'wangxiang_task_invitation';
                const invitationStatus = String(msg.taskInvitationStatus || 'pending');
                const matched = msg.assignmentMatched !== false;
                const title = this._escapeHtml(task.title || msg.taskTitle || 'ä¸‡è±¡ä»»åŠ¡');
                const description = this._escapeHtml(task.description || (isConfirmation ? 'å‘å¸ƒäººå·²ç¡®è®¤æ´¾å‘è¯¥ä»»åŠ¡' : 'ç‚¹å‡»æŸ¥çœ‹ä»»åŠ¡è¯¦æƒ…'));
                const footerLabel = isInvitation
                    ? (invitationStatus === 'accepted' ? 'å·²åŒæ„å¹¶åŠ å…¥æˆ‘çš„ä»»åŠ¡' : invitationStatus === 'cancelled' ? 'å·²å–æ¶ˆ' : 'ä»»åŠ¡é‚€è¯·')
                    : isConfirmation
                        ? (matched ? 'å·²ç¡®è®¤æ´¾å‘' : 'æœªåŒ¹é…åˆ°åŒåä»»åŠ¡')
                        : 'ä»»åŠ¡ç”³è¯·';
                const accentColor = isInvitation
                    ? (invitationStatus === 'accepted' ? '#16a36a' : invitationStatus === 'cancelled' ? '#8b949e' : '#7c5ce7')
                    : isConfirmation ? (matched ? '#16a36a' : '#d97706') : '#1687b8';
                const iconClass = isInvitation ? 'fa-envelope-open-text' : isConfirmation ? 'fa-clipboard-check' : 'fa-list-check';
                messageBody = `
                <div class="message-wangxiang-task-card" data-msg-id="${this._escapeHtml(msg.id || '')}" style="background:#fff; border:1px solid #e3e8ec; border-radius:8px; overflow:hidden; width:220px; max-width:100%; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                    <div style="padding:11px 11px 10px;">
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:7px;">
                            <div style="width:30px; height:30px; border-radius:7px; background:${accentColor}; color:#fff; display:flex; align-items:center; justify-content:center; font-size:14px; flex:0 0 30px;"><i class="fa-solid ${iconClass}"></i></div>
                            <div style="min-width:0; flex:1;">
                                <div style="font-size:13px; font-weight:700; color:#17212b; line-height:1.3; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${title}</div>
                                <div style="font-size:10px; color:${accentColor}; line-height:1.25; margin-top:2px;">${footerLabel}</div>
                            </div>
                        </div>
                        <div style="font-size:12px; color:#5f6b75; line-height:1.5; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; word-break:break-word;">${description}</div>
                    </div>
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:7px 10px; background:#f5f7f8; border-top:1px solid #e8ecef;">
                        <span style="font-size:11px; color:#77838d;">ä¸‡è±¡</span>
                        <span style="font-size:10px; color:#9aa4ac;">æŸ¥çœ‹è¯¦æƒ…</span>
                    </div>
                </div>`;
                break;
            }

            case 'poker_card': {
                const poker = msg.pokerData || {};
                const title = this._escapeHtml(poker.title || 'å¾·å·æ‰‘å…‹ç‰Œå±€è®°å½•');
                const desc = this._escapeHtml(poker.desc || poker.content || 'ç‚¹å‡»æŸ¥çœ‹å®Œæ•´ç‰Œå±€å†…å®¹');
                messageBody = `
                <div class="message-poker-card" data-msg-id="${this._escapeHtml(msg.id || '')}" style="background:#fff; border:1px solid #e8e8e8; border-radius:8px; overflow:hidden; max-width:228px; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                    <div style="padding:11px 11px 10px;">
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:7px;">
                            <div style="width:28px; height:28px; border-radius:7px; background:linear-gradient(135deg,#2563eb,#0f172a); color:#fff; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700; flex-shrink:0;">â™ </div>
                            <div style="min-width:0; flex:1;">
                                <div style="font-size:13px; font-weight:700; color:#1a1a1a; line-height:1.25; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${title}</div>
                                <div style="font-size:10px; color:#999; line-height:1.25; margin-top:2px;">ç‰Œå±€åˆ†äº«</div>
                            </div>
                        </div>
                        <div style="font-size:12px; color:#666; line-height:1.45; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; word-break:break-word;">${desc}</div>
                    </div>
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:7px 10px; background:#f6f6f6; border-top:1px solid #eee;">
                        <span style="font-size:11px; color:#999;">å¾·å·æ‰‘å…‹</span>
                        <span style="font-size:10px; color:#b0b0b0;">æŸ¥çœ‹è¯¦æƒ…</span>
                    </div>
                </div>
                `;
                break;
            }

            case 'werewolf_card': {
                const werewolf = msg.werewolfData || {};
                const title = this._escapeHtml(werewolf.title || 'ç‹¼äººæ€å¤ç›˜è®°å½•');
                const desc = this._escapeHtml(werewolf.desc || werewolf.content || 'ç‚¹å‡»æŸ¥çœ‹å®Œæ•´å¤ç›˜å†…å®¹');
                const result = this._escapeHtml(werewolf.result || 'å¤ç›˜åˆ†äº«');
                messageBody = `
                <div class="message-werewolf-card" data-msg-id="${this._escapeHtml(msg.id || '')}" style="background:#fff; border:1px solid #e8e8e8; border-radius:8px; overflow:hidden; max-width:228px; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                    <div style="padding:11px 11px 10px;">
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:7px;">
                            <div style="width:28px; height:28px; border-radius:7px; background:linear-gradient(135deg,#7f1d1d,#111827); color:#fff; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:800; flex-shrink:0;">ç‹¼</div>
                            <div style="min-width:0; flex:1;">
                                <div style="font-size:13px; font-weight:700; color:#1a1a1a; line-height:1.25; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${title}</div>
                                <div style="font-size:10px; color:#999; line-height:1.25; margin-top:2px;">${result}</div>
                            </div>
                        </div>
                        <div style="font-size:12px; color:#666; line-height:1.45; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; word-break:break-word;">${desc}</div>
                    </div>
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:7px 10px; background:#f6f6f6; border-top:1px solid #eee;">
                        <span style="font-size:11px; color:#999;">ç‹¼äººæ€</span>
                        <span style="font-size:10px; color:#b0b0b0;">æŸ¥çœ‹å¤ç›˜</span>
                    </div>
                </div>
                `;
                break;
            }

            case 'undercover_card': {
                const undercover = msg.undercoverData || {};
                const title = this._escapeHtml(undercover.title || 'è°æ˜¯å§åº•æœ¬å±€æˆ˜ç»©');
                const desc = this._escapeHtml(undercover.desc || undercover.content || 'ç‚¹å‡»æŸ¥çœ‹å®Œæ•´æœ¬å±€æˆ˜ç»©');
                const result = this._escapeHtml(undercover.result || 'æœ¬å±€æˆ˜ç»©åˆ†äº«');
                messageBody = `
                <div class="message-undercover-card" data-msg-id="${this._escapeHtml(msg.id || '')}" style="background:#fff; border:1px solid #e8e8e8; border-radius:8px; overflow:hidden; max-width:228px; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,0.04);">
                    <div style="padding:11px 11px 10px;">
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:7px;">
                            <div style="width:28px; height:28px; border-radius:7px; background:linear-gradient(135deg,#c27a35,#604126); color:#fff; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:800; flex-shrink:0;">å§</div>
                            <div style="min-width:0; flex:1;">
                                <div style="font-size:13px; font-weight:700; color:#1a1a1a; line-height:1.25; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${title}</div>
                                <div style="font-size:10px; color:#999; line-height:1.25; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${result}</div>
                            </div>
                        </div>
                        <div style="font-size:12px; color:#666; line-height:1.45; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; word-break:break-word;">${desc}</div>
                    </div>
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:7px 10px; background:#f6f6f6; border-top:1px solid #eee;">
                        <span style="font-size:11px; color:#999;">è°æ˜¯å§åº•</span>
                        <span style="font-size:10px; color:#b0b0b0;">æŸ¥çœ‹æˆ˜ç»©</span>
                    </div>
                </div>
                `;
                break;
            }

            case 'catbox_care_card': {
                const petName = this._escapeHtml(msg.catboxPetName || 'å°çŒ«');
                messageBody = `
                    <div class="message-catbox-care-card" style="width: 190px; border-radius: 10px; overflow: hidden; background: #f5d98a; border: 1px solid #ead7aa; box-shadow: 0 1px 2px rgba(0,0,0,0.08);">
                        <div style="display:flex; align-items:center; gap:7px; padding:8px; background:#f5d98a;">
                            <div style="width:28px; height:28px; border-radius:8px; background:#fffaf0; color:#19120f; display:flex; align-items:center; justify-content:center; font-size:15px; border:1px solid rgba(42,28,25,0.14);">ğŸ¾</div>
                            <div style="min-width:0;">
                                <div style="font-size:12px; font-weight:700; color:#2a1c19;">çŒ«ç›’ç…§é¡¾</div>
                                <div style="font-size:10px; color:#6d4c27; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">å¸®ä½ å–‚å…»äº† ${petName}</div>
                            </div>
                        </div>
                    </div>
                `;
                break;
            }

            case 'catbox_coadopt_invite': {
                const status = String(msg.catboxInviteStatus || 'pending').trim();
                const petName = this._escapeHtml(msg.catboxPetName || 'å°çŒ«');
                const statusText = status === 'accepted' ? 'å·²æ¥æ”¶' : (status === 'rejected' ? 'å·²æ‹’ç»' : 'ç­‰å¾…ä¸­');
                const statusColor = status === 'accepted' ? '#228b52' : (status === 'rejected' ? '#9a3b42' : '#8a6428');
                messageBody = `
                    <div class="message-catbox-invite-card" style="width: 190px; border-radius: 10px; overflow: hidden; background: #f5d98a; border: 1px solid #ead7aa; box-shadow: 0 1px 2px rgba(0,0,0,0.08);">
                        <div style="display:flex; align-items:center; gap:7px; padding:8px;">
                            <div style="width:28px; height:28px; border-radius:8px; background:#fffaf0; color:#19120f; display:flex; align-items:center; justify-content:center; font-size:15px; border:1px solid rgba(42,28,25,0.14);">ğŸ¾</div>
                            <div style="min-width:0; flex:1;">
                                <div style="font-size:12px; font-weight:700; color:#2a1c19;">çŒ«ç›’å…±å…»é‚€è¯·</div>
                                <div style="font-size:10px; color:#6d4c27; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">ä¸€èµ·ç…§é¡¾ ${petName}</div>
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
                const songTitle = this._escapeHtml(musicInfo.songName || 'æ­£åœ¨æ’­æ”¾');
                const artistName = this._escapeHtml(musicInfo.artist || '');
                const contactName = this._escapeHtml(activeSession?.contactName || musicInfo.contactName || senderName || this.app.currentChat?.name || 'å¥½å‹');
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
                const statusText = isEnded ? 'å…±å¬å·²ç»“æŸ' : '<span class="message-music-card-dot"></span>æ­£åœ¨å…±å¬';
                const bottomText = isEnded ? `ä½ å’Œ ${contactName}` : `ä½ å’Œ ${contactName}`;
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
                                        <span>${this.app.renderAvatar(userAvatar, 'ğŸ˜Š', userInfo.name)}</span>
                                        <span>${this.app.renderAvatar(contactAvatar, 'ğŸ‘¤', contactName)}</span>
                                    </div>
                                    <span class="message-music-card-user-text">${bottomText}</span>
                                </div>
                                ${isEnded ? `
                                    <span class="message-music-card-ended">å·²ç»“æŸ</span>
                                ` : `
                                    <button type="button" class="message-music-card-btn is-glass message-music-listen-cancel" data-chat-id="${this._escapeHtml(this.app.currentChat?.id || '')}">
                                        å–æ¶ˆå¬æ­Œ
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
                const songTitle = this._escapeHtml(inviteSongName || 'æœªçŸ¥æ­Œæ›²');
                const artistName = this._escapeHtml(inviteArtist || 'æœªçŸ¥æ­Œæ‰‹');
                const coverUrl = this._escapeHtml(invite.cover || msg.cover || this._getDefaultMusicCover());
                const fallbackCover = this._escapeHtml(this._getDefaultMusicCover());
                const inviterName = this._escapeHtml(msg.from || senderName || this.app.currentChat?.name || 'å¯¹æ–¹');
                const userInfo = this.app.wechatData.getUserInfo();
                const userAvatar = userInfo.avatar || '';
                const inviterAvatar = senderAvatar || this.app.currentChat?.avatar || '';
                const stateClass = isAccepted ? 'state-active' : (isEnded ? 'state-ended' : 'state-invite');
                const statusText = isAccepted ? '<span class="message-music-card-dot"></span>æ­£åœ¨å…±å¬' : (isEnded ? 'å…±å¬å·²ç»“æŸ' : 'é‚€è¯·ä½ ä¸€èµ·å¬æ­Œ');
                const bottomText = isAccepted ? `ä½ å’Œ ${inviterName}` : (isEnded ? `ä½ å’Œ ${inviterName}` : `æ¥è‡ª ${inviterName}`);
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
                                            <span>${this.app.renderAvatar(userAvatar, 'ğŸ˜Š', userInfo.name)}</span>
                                            <span>${this.app.renderAvatar(inviterAvatar, 'ğŸ‘¤', inviterName)}</span>
                                        ` : `
                                            <span>${this.app.renderAvatar(inviterAvatar, 'ğŸ‘¤', inviterName)}</span>
                                        `}
                                    </div>
                                    <span class="message-music-card-user-text">${bottomText}</span>
                                </div>
                                ${isAccepted || isEnded ? `
                                    <span class="message-music-card-ended">${isAccepted ? 'å…±å¬ä¸­' : (isRejected ? 'å·²æ‹’ç»' : 'å·²ç»“æŸ')}</span>
                                ` : `
                                    <div class="message-music-card-actions">
                                        <button type="button" class="message-music-card-btn is-glass" data-action="reject-music-invite" data-message-id="${this._escapeHtml(msg.id || '')}">æ‹’ç»</button>
                                        <button type="button" class="message-music-card-btn is-primary" data-action="accept-music-invite" data-message-id="${this._escapeHtml(msg.id || '')}">æ¥å—</button>
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
                const displayStatus = statusText || (isMe ? 'ç­‰å¾…å›åº”' : 'ç­‰å¾…ä¸­...');
                const statusClass = /æ‹’ç»/.test(displayStatus)
                    ? 'is-rejected'
                    : (/æ¥å—/.test(displayStatus) ? 'is-accepted' : 'is-waiting');
                messageBody = `
                <div class="message-honey-invite ${statusClass}">
                    <div class="message-honey-invite-head">
                        <span class="message-honey-invite-title">èœœè¯­é‚€çº¦</span>
                        <span class="message-honey-invite-badge">${isMe ? 'å·²å‘é€' : 'å¾®ä¿¡å¥½å‹'}</span>
                    </div>
                    <div class="message-honey-invite-sub">ç›´æ’­é—´</div>
                    <div class="message-honey-invite-foot">${this._escapeHtml(displayStatus)}</div>
                </div>
            `;
                break;
            }

            default:
                // ğŸ”¥ æ™®é€šæ–‡æœ¬æ¶ˆæ¯ï¼ˆå¼•ç”¨åœ¨æ°”æ³¡å¤–ä¸‹æ–¹æ˜¾ç¤ºï¼‰
                messageBody = this.renderTextMessageBubble(msg.content, { isGroupChat });
                break;
        }

        // ğŸ”¥ å¼•ç”¨å†…å®¹ï¼šç‹¬ç«‹çš„ divï¼Œä¸å½±å“æ°”æ³¡å®½åº¦
        const quoteHtml = msg.quote ? `<div style="font-size: 10px; color: #888; background: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: 3px; margin-top: 3px; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;">${this._escapeHtml(msg.quote.sender)}: ${this._escapeHtml(msg.quote.content.length > 10 ? msg.quote.content.substring(0, 10) + '...' : msg.quote.content)}</div>` : '';

        return `
        <div class="chat-message ${isMe ? 'message-right' : 'message-left'}${selectionClass}${selectedClass}" data-message-id="${this._escapeHtml(messageId)}" data-message-index="${Number(messageIndex)}">
            ${selectionCheckHtml}
            ${!isMe ? `<div class="message-avatar">${this.app.renderAvatar(senderAvatar, 'ğŸ‘¤', senderName)}</div>` : ''}
            <div class="message-content" style="display: inline-flex; flex-direction: column; ${isMe ? 'align-items: flex-end;' : 'align-items: flex-start;'}">
                ${!isMe && isGroupChat ? `<div class="message-sender" style="font-size: 12px; color: #576b95; margin-bottom: 2px;">${this._escapeHtml(senderName)}</div>` : ''}
                <div style="display: inline-block; max-width:100%;">${messageBody}</div>
                ${quoteHtml}
            </div>
            ${isMe ? `<div class="message-avatar">${this.app.renderAvatar(userInfo.avatar, 'ğŸ˜Š', userInfo.name)}</div>` : ''}
        </div>
    `;
    }

    extractInnerThought(content) {
        return parseWechatInnerThoughtContent(content);
    }

    _renderInnerThoughtPopup(innerThought = '') {
        const safeThought = String(innerThought || '').trim();
        if (!safeThought) return '';
        return `
            <div class="wechat-inner-os-popup" role="note">
                <div class="wechat-inner-os-title">INNER THOUGHTS</div>
                <div class="wechat-inner-os-content">${this._escapeHtml(safeThought)}</div>
            </div>
        `;
    }

    _parseWechatBubbleDisplay(content = '', { stripSpeechPrefix = false } = {}) {
        const rawText = String(content || '').trim();
        const parsedInnerThought = this.extractInnerThought(rawText);
        let visibleText = parsedInnerThought.visibleContent || (parsedInnerThought.innerThought ? '...' : rawText);
        if (stripSpeechPrefix) visibleText = this._stripCallSpeechPrefix(visibleText);

        const parsedTranslation = parseWechatTranslationContent(visibleText);
        return {
            rawText,
            originalText: parsedTranslation.speechText || (parsedTranslation.translationText ? '...' : visibleText),
            translationText: parsedTranslation.translationText,
            innerThought: parsedInnerThought.innerThought,
            hasTranslation: !!parsedTranslation.translationText
        };
    }

    _renderWechatTranslationContent(originalText = '', translationText = '', {
        parseEmoji = false,
        hasInnerThought = false
    } = {}) {
        const renderText = (value) => parseEmoji
            ? this.parseEmoji(String(value || ''))
            : this._escapeHtml(String(value || ''));

        return `
            <div class="wechat-translation-source">
                <div class="wechat-translation-source-text">${renderText(originalText)}</div>
                <span class="wechat-translation-heart" aria-hidden="true">â™¥</span>
            </div>
            <div class="wechat-translation-target">
                <span class="wechat-translation-badge" aria-hidden="true"><b>A</b><small>æ–‡</small></span>
                <div class="wechat-translation-target-text">${renderText(translationText)}</div>
            </div>
            ${hasInnerThought ? '<button class="wechat-inner-os-fold" type="button" aria-label="æŸ¥çœ‹å†…å¿ƒOS"></button>' : ''}
        `;
    }

    _renderWechatCallTranslationContent(originalText = '', translationText = '', {
        hasInnerThought = false
    } = {}) {
        return `
            <div class="wechat-call-translation-source">${this._escapeHtml(String(originalText || ''))}${this._renderWechatCallSpeechWave()}</div>
            <div class="wechat-call-translation-target">
                <span class="wechat-call-translation-label">ç¿»è¯‘ï¼š</span>
                <span class="wechat-call-translation-text">${this._escapeHtml(String(translationText || ''))}</span>
            </div>
            ${hasInnerThought ? '<button class="wechat-inner-os-fold" type="button" aria-label="æŸ¥çœ‹å†…å¿ƒOS"></button>' : ''}
        `;
    }

    _renderWechatCallSpeechWave() {
        return '<span class="wechat-call-speech-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>';
    }

    _renderWechatCallAiBubbleMarkup({
        text = '',
        bubbleId = '',
        messageIndex = -1,
        callType = 'voice',
        roundId = '',
        sender = ''
    } = {}) {
        const rawText = String(text || '').trim();
        const parsed = this._parseWechatBubbleDisplay(rawText);
        const hasInnerThought = !!parsed.innerThought;
        const isVideo = callType === 'video';
        const basePaddingRight = isVideo ? 12 : 10;
        const verticalPadding = isVideo ? 8 : 6;
        const bubbleRadius = isVideo ? 12 : 10;
        const fontSize = isVideo ? 13 : 12;
        const shadow = isVideo ? '0 1px 3px rgba(0,0,0,0.1)' : '0 1px 2px rgba(0,0,0,0.1)';

        return `
            <div class="wechat-inner-os-wrapper wechat-call-inner-os-wrapper">
                <div class="wechat-call-ai-bubble call-msg-bubble wechat-call-spoken-bubble${parsed.hasTranslation ? ' wechat-call-translation-card' : ''}${hasInnerThought ? ' wechat-inner-os-bubble' : ''}"
                     id="${this.escapeInlineStickerAttr(bubbleId)}"
                     data-msg-idx="${Number(messageIndex)}"
                     data-call-type="${this.escapeInlineStickerAttr(callType)}"
                     data-round-id="${this.escapeInlineStickerAttr(roundId)}"
                     data-sender="${this.escapeInlineStickerAttr(sender)}"
                     data-text="${this.escapeInlineStickerAttr(rawText)}"
                     data-base-padding-right="${basePaddingRight}"
                     style="max-width:100%; padding:${verticalPadding}px ${hasInnerThought ? 22 : basePaddingRight}px ${verticalPadding}px ${isVideo ? 12 : 10}px; background:rgba(255,255,255,0.85); color:#333; border-radius:${bubbleRadius}px; font-size:${fontSize}px; box-shadow:${shadow}; cursor:pointer; transition:all 0.3s; position:relative; box-sizing:border-box; word-break:break-word;">
                    ${parsed.hasTranslation
                        ? this._renderWechatCallTranslationContent(parsed.originalText, parsed.translationText, { hasInnerThought })
                        : `${this._escapeHtml(parsed.originalText)}${this._renderWechatCallSpeechWave()}${hasInnerThought ? '<button class="wechat-inner-os-fold" type="button" aria-label="æŸ¥çœ‹å†…å¿ƒOS"></button>' : ''}`}
                </div>
                ${this._renderInnerThoughtPopup(parsed.innerThought)}
            </div>
        `;
    }

    _syncWechatCallBubbleInnerThought(bubble, text = '') {
        if (!bubble) return;
        const rawText = String(text || '').trim();
        const parsed = this._parseWechatBubbleDisplay(rawText);
        const hasInnerThought = !!parsed.innerThought;
        const basePaddingRight = Math.max(0, Number(bubble.dataset.basePaddingRight) || 10);

        bubble.dataset.text = rawText;
        bubble.classList.add('wechat-call-spoken-bubble');
        bubble.classList.remove('wechat-translation-card');
        bubble.classList.toggle('wechat-call-translation-card', parsed.hasTranslation);
        bubble.classList.toggle('wechat-inner-os-bubble', hasInnerThought);
        bubble.style.paddingRight = `${hasInnerThought ? 22 : basePaddingRight}px`;
        bubble.innerHTML = parsed.hasTranslation
            ? this._renderWechatCallTranslationContent(parsed.originalText, parsed.translationText, { hasInnerThought })
            : `${this._escapeHtml(parsed.originalText)}${this._renderWechatCallSpeechWave()}${hasInnerThought ? '<button class="wechat-inner-os-fold" type="button" aria-label="æŸ¥çœ‹å†…å¿ƒOS"></button>' : ''}`;

        const wrapper = bubble.closest('.wechat-call-inner-os-wrapper');
        if (!wrapper) return;
        Array.from(wrapper.children).forEach(child => {
            if (child.classList?.contains('wechat-inner-os-popup')) child.remove();
        });
        if (hasInnerThought) {
            wrapper.insertAdjacentHTML('beforeend', this._renderInnerThoughtPopup(parsed.innerThought));
        }
    }

    renderTextMessageBubble(content, { isGroupChat = false } = {}) {
        const parsed = this._parseWechatBubbleDisplay(content, { stripSpeechPrefix: true });
        const showInnerThought = !!parsed.innerThought;
        const bubbleClasses = [
            'message-text',
            parsed.hasTranslation ? 'wechat-translation-card' : '',
            showInnerThought ? 'wechat-inner-os-bubble' : ''
        ].filter(Boolean).join(' ');
        const bubbleContent = parsed.hasTranslation
            ? this._renderWechatTranslationContent(parsed.originalText, parsed.translationText, {
                parseEmoji: true,
                hasInnerThought: showInnerThought
            })
            : `${this.parseEmoji(parsed.originalText)}${showInnerThought ? '<button class="wechat-inner-os-fold" type="button" aria-label="æŸ¥çœ‹å†…å¿ƒOS"></button>' : ''}`;

        if (!showInnerThought) {
            return `<div class="${bubbleClasses}">${bubbleContent}</div>`;
        }

        return `
            <div class="wechat-inner-os-wrapper">
                <div class="${bubbleClasses}">${bubbleContent}</div>
                ${this._renderInnerThoughtPopup(parsed.innerThought)}
            </div>
        `;
    }

    renderEmojiPanel() {
        const emojis = [
            '[ç‹—å¤´]',
            '[è½¬åœˆ]',
            // ğŸ˜€ è¡¨æƒ…æƒ…ç»ª
            'ğŸ˜€', 'ğŸ˜ƒ', 'ğŸ˜„', 'ğŸ˜', 'ğŸ˜†', 'ğŸ˜…', 'ğŸ˜‚', 'ğŸ¤£', 'ğŸ˜Š', 'ğŸ™‚', 'ğŸ™ƒ', 'ğŸ˜‰', 'ğŸ˜Œ', 'ğŸ˜', 'ğŸ¥°', 'ğŸ˜˜',
            'ğŸ˜—', 'ğŸ˜™', 'ğŸ˜š', 'ğŸ˜‹', 'ğŸ˜›', 'ğŸ˜', 'ğŸ˜œ', 'ğŸ¤ª', 'ğŸ¤¨', 'ğŸ§', 'ğŸ¤“', 'ğŸ˜', 'ğŸ¥³', 'ğŸ¤©',
            'ğŸ˜', 'ğŸ˜’', 'ğŸ˜', 'ğŸ˜”', 'ğŸ˜Ÿ', 'ğŸ˜•', 'ğŸ™', 'â˜¹ï¸', 'ğŸ˜£', 'ğŸ˜–', 'ğŸ˜«', 'ğŸ˜©', 'ğŸ¥º', 'ğŸ˜¢', 'ğŸ˜­', 'ğŸ˜¤',
            'ğŸ˜ ', 'ğŸ˜¡', 'ğŸ¤¬', 'ğŸ¤¯', 'ğŸ˜³', 'ğŸ¥µ', 'ğŸ¥¶', 'ğŸ˜±', 'ğŸ˜¨', 'ğŸ˜°', 'ğŸ˜¥', 'ğŸ˜“', 'ğŸ¤—', 'ğŸ¤”', 'ğŸ¤­', 'ğŸ¤«',
            'ğŸ«¢', 'ğŸ«£', 'ğŸ«¡', 'ğŸ˜´', 'ğŸ¤¤', 'ğŸ˜ª', 'ğŸ˜µ', 'ğŸ˜µâ€ğŸ’«', 'ğŸ¤', 'ğŸ˜¶', 'ğŸ™„', 'ğŸ˜¬',

            // ğŸ‘‹ æ‰‹åŠ¿
            'ğŸ‘‹', 'ğŸ¤š', 'ğŸ–ï¸', 'âœ‹', 'ğŸ––', 'ğŸ«±', 'ğŸ«²', 'ğŸ‘Œ', 'ğŸ¤Œ', 'ğŸ¤', 'âœŒï¸', 'ğŸ¤', 'ğŸ«°', 'ğŸ¤Ÿ', 'ğŸ¤˜', 'ğŸ¤™',
            'ğŸ‘ˆ', 'ğŸ‘‰', 'ğŸ‘†', 'ğŸ–•', 'ğŸ‘‡', 'â˜ï¸', 'ğŸ‘', 'ğŸ‘', 'âœŠ', 'ğŸ‘Š', 'ğŸ¤›', 'ğŸ¤œ', 'ğŸ‘', 'ğŸ™Œ', 'ğŸ‘', 'ğŸ¤²', 'ğŸ™',

            // â¤ï¸ å¸¸ç”¨ç¬¦å·
            'â¤ï¸', 'ğŸ§¡', 'ğŸ’›', 'ğŸ’š', 'ğŸ’™', 'ğŸ’œ', 'ğŸ–¤', 'ğŸ¤', 'ğŸ¤', 'ğŸ’”', 'â£ï¸', 'ğŸ’•', 'ğŸ’', 'ğŸ’“', 'ğŸ’—', 'ğŸ’–', 'ğŸ’˜', 'ğŸ’',
            'â­', 'âœ¨', 'âš¡', 'ğŸ”¥', 'ğŸ’§', 'ğŸŒˆ', 'â˜€ï¸', 'ğŸŒ™', 'ğŸ€', 'ğŸ‰', 'ğŸŠ', 'ğŸ',

            // ğŸ¶ å¸¸è§åŠ¨ç‰©
            'ğŸ¶', 'ğŸ±', 'ğŸ­', 'ğŸ¹', 'ğŸ°', 'ğŸ¦Š', 'ğŸ»', 'ğŸ¼', 'ğŸ¨', 'ğŸ¯', 'ğŸ¦', 'ğŸ®', 'ğŸ·', 'ğŸ¸', 'ğŸµ', 'ğŸ¤', 'ğŸ§', 'ğŸ¦',

            // ğŸ” é£Ÿç‰©ä¸å‡ºè¡Œ
            'ğŸ', 'ğŸ“', 'ğŸ‰', 'ğŸ”', 'ğŸŸ', 'ğŸ•', 'â˜•', 'ğŸº', 'ğŸš—', 'ğŸš•', 'ğŸšŒ', 'ğŸš‡', 'âœˆï¸', 'ğŸš€'
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
            <!-- ğŸ”¥ æ–°å¢ï¼šè¡¨æƒ…æ ‡ç­¾ -->
            <div class="emoji-tabs" role="tablist" aria-label="è¡¨æƒ…åˆ†ç±»">
                <div class="emoji-tab ${this.emojiTab !== 'custom' ? 'active' : ''}" data-tab="default" role="tab" tabindex="0" aria-selected="${this.emojiTab !== 'custom' ? 'true' : 'false'}">
                    ç³»ç»Ÿè¡¨æƒ…
                </div>
                <div class="wechat-emoji-custom-tab">
                    <div class="emoji-tab ${this.emojiTab === 'custom' ? 'active' : ''}" data-tab="custom" role="tab" tabindex="0" aria-selected="${this.emojiTab === 'custom' ? 'true' : 'false'}">
                        <span>æˆ‘çš„è¡¨æƒ…</span>
                    </div>
                    <button type="button" class="wechat-emoji-manage-trigger" aria-label="è¡¨æƒ…ç®¡ç†" aria-expanded="${this.customEmojiManageMenuOpen ? 'true' : 'false'}">
                        <i class="fa-solid fa-broom" aria-hidden="true"></i>
                    </button>
                </div>
            </div>

            ${customMode ? `
            <div class="wechat-emoji-manage-menu${this.customEmojiManageMenuOpen ? ' is-open' : ''}" aria-hidden="${this.customEmojiManageMenuOpen ? 'false' : 'true'}">
                <button type="button" id="toggle-custom-emoji-manage" class="wechat-emoji-manage-action">
                    <i class="fa-solid ${isSelectionMode ? 'fa-check' : 'fa-list-check'}" aria-hidden="true"></i>
                    <span>${isSelectionMode ? 'å®Œæˆ' : 'å¤šé€‰åˆ é™¤'}</span>
                </button>
                <button type="button" id="delete-selected-custom-emoji" class="wechat-emoji-manage-action is-danger" ${!isSelectionMode || selectedCount === 0 ? 'disabled' : ''}>
                    <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
                    <span>åˆ é™¤é€‰ä¸­${selectedCount > 0 ? `(${selectedCount})` : ''}</span>
                </button>
                <button type="button" id="clear-custom-emoji-all" class="wechat-emoji-manage-action is-danger" ${customEmojis.length === 0 ? 'disabled' : ''}>
                    <i class="fa-solid fa-eraser" aria-hidden="true"></i>
                    <span>ä¸€é”®æ¸…ç©º</span>
                </button>
            </div>
            ${isSelectionMode ? `
            <div class="wechat-emoji-selection-hint">
                å½“å‰å¤„äºå¤šé€‰åˆ é™¤æ¨¡å¼ï¼Œç‚¹å‡»è¡¨æƒ…å¯å‹¾é€‰ã€‚<button type="button" id="select-all-custom-emoji">${allSelected ? 'å–æ¶ˆå…¨é€‰' : 'å…¨é€‰'}</button>
            </div>
            ` : ''}
            ` : ''}

           <div class="emoji-scroll">
                <div class="emoji-grid${customMode ? ' wechat-custom-emoji-grid' : ''}">
                    ${this.emojiTab === 'custom' ? `
                        <!-- è‡ªå®šä¹‰è¡¨æƒ… -->
                        ${customEmojis.length === 0 ? `
                            <div class="wechat-custom-emoji-empty" role="status">
                                <span>è¿˜æ²¡æœ‰æ·»åŠ è¡¨æƒ…</span>
                                <small>ç‚¹å‡»ä¸‹æ–¹åŠ å·æ·»åŠ </small>
                            </div>
                        ` : ''}
                        ${customEmojis.map(emoji => `
                            <span class="emoji-item custom-emoji-item ${isSelectionMode && this.selectedCustomEmojiIds.has(String(emoji.id || '')) ? 'is-selected' : ''}" data-emoji-type="custom" data-emoji-id="${this._escapeHtml(emoji.id || '')}" data-selection-mode="${isSelectionMode ? '1' : '0'}" title="${this._escapeHtml(String(emoji.description || emoji.name || 'è¡¨æƒ…'))}" style="position:relative;${isSelectionMode && this.selectedCustomEmojiIds.has(String(emoji.id || '')) ? 'outline:2px solid #07c160; outline-offset:1px; border-radius:10px;' : ''}">
                                <img src="${this.escapeInlineStickerAttr(emoji.image || '')}" data-custom-emoji-src="${this.escapeInlineStickerAttr(emoji.image || '')}" alt="${this._escapeHtml(emoji.name || '')}" referrerpolicy="no-referrer">
                                ${isSelectionMode ? `<span style="position:absolute; top:2px; right:2px; width:14px; height:14px; border-radius:50%; background:${this.selectedCustomEmojiIds.has(String(emoji.id || '')) ? '#07c160' : 'rgba(255,255,255,0.9)'}; border:1px solid ${this.selectedCustomEmojiIds.has(String(emoji.id || '')) ? '#07c160' : '#ccc'}; color:#fff; font-size:10px; line-height:12px; text-align:center;">${this.selectedCustomEmojiIds.has(String(emoji.id || '')) ? 'âœ“' : ''}</span>` : ''}
                            </span>
                        `).join('')}

                        <!-- æ·»åŠ è¡¨æƒ…æŒ‰é’® -->
                        <span class="emoji-item emoji-add" id="add-custom-emoji" style="${isSelectionMode ? 'opacity:0.45; pointer-events:none;' : ''}">
                            <i class="fa-solid fa-plus"></i>
                        </span>
                    ` : `
                        <!-- ç³»ç»Ÿè¡¨æƒ… -->
                        ${emojis.map(emoji => {
                            const mappedEmoji = getPhoneInlineEmoji(emoji);
                            const title = mappedEmoji?.name || emoji;
                            const renderedEmoji = mappedEmoji
                                ? renderPhoneInlineEmoji(emoji, { size: 20, inline: false, className: 'wechat-system-emoji-image' })
                                : this.renderTwemojiEmoji(emoji, 20, false);
                            return `
                                <span class="emoji-item" data-emoji="${this._escapeHtml(emoji)}" title="${this._escapeHtml(title)}">${renderedEmoji}</span>
                            `;
                        }).join('')}
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
            positivePromptSuffix: 'äºŒæ¬¡å…ƒæ’ç”»é£, éçœŸäºº, éç…§ç‰‡, éå†™å®, åŠ¨æ¼«æ„Ÿ, èµ›ç’ç’ä¸Šè‰², æ¸¸æˆCGè´¨æ„Ÿ, æ°ä½œ, é«˜è´¨é‡, ç»†èŠ‚æ¸…æ™°, æ„å›¾å®Œæ•´, å…‰çº¿è‡ªç„¶, è‰²å½©å¹²å‡€, å•ä¸»ä½“çªå‡º, é€‚åˆæ‰‹æœºèŠå¤©å±•ç¤º',
            characterPositivePromptSuffix: 'äººç‰©æ€§åˆ«ç‰¹å¾æ˜ç¡®, ä¸è¦ä¸­æ€§åŒ–, ä¸»ä½“æ˜ç¡®, é¢éƒ¨ä¸è‚¢ä½“è‡ªç„¶',
            scenePositivePromptSuffix: 'çº¯åœºæ™¯æ„å›¾, çº¯ç‰©ä½“ç‰¹å†™æˆ–ç©ºé•œç”»é¢, ç”»é¢ä¸­ä¸è¦å‡ºç°äººç‰©, ä¸è¦å‡ºç°è§’è‰², ä¸è¦å‡ºç°è·¯äºº, ä¸è¦å‡ºç°äººå½¢è½®å»“, ä¸è¦å‡ºç°æ‰‹è„šæˆ–èº«ä½“å±€éƒ¨',
            negativePrompt: 'çœŸäºº, å†™å®, æ‘„å½±æ„Ÿ, ç…§ç‰‡æ„Ÿ, ä½è´¨é‡, æœ€å·®è´¨é‡, æ¨¡ç³Š, é”¯é½¿, JPEGå‹ç¼©ç—•è¿¹, å¤šä½™è‚¢ä½“, ç•¸å½¢æ‰‹æŒ‡, äº”å®˜é”™ä½, æ€§åˆ«æ¨¡ç³Š, ä¸­æ€§å¤–è§‚, æ–‡æœ¬, æ°´å°, ç­¾å, ç”¨æˆ·å',
            noPeopleNegativePrompt: 'äººç‰©, äººç±», è§’è‰², è·¯äºº, è‚–åƒ, åŠèº«åƒ, å…¨èº«åƒ, äººè„¸, å¤´éƒ¨ç‰¹å†™, æ‰‹, æ‰‹è‡‚, è…¿, è„š, èº«ä½“å±€éƒ¨, æ‹ŸäººåŒ–è§’è‰²'
        };
    }

    _buildSiliconflowPrompt(rawPrompt, positivePromptSuffix = '') {
        const prompt = String(rawPrompt || '').trim();
        const suffix = String(positivePromptSuffix || '').trim();
        if (!prompt) return suffix;
        if (!suffix) return prompt;
        return `${prompt}ï¼Œ${suffix}`;
    }

    _promptLikelyNeedsCharacter(rawPrompt) {
        const prompt = String(rawPrompt || '').trim();
        if (!prompt) return false;

        const humanIndicators = [
            'äººç‰©', 'è§’è‰²', 'äººåƒ', 'è‚–åƒ', 'å°‘å¹´', 'å°‘å¥³', 'ç”·ç”Ÿ', 'å¥³ç”Ÿ', 'ç”·äºº', 'å¥³äºº', 'ç”·å­©', 'å¥³å­©',
            'å¸…å“¥', 'ç¾å¥³', 'ç”·ä¸»', 'å¥³ä¸»', 'ä¸»è§’', 'å¶åƒ', 'ä¸»æ’­', 'è€å¸ˆ', 'åŒå­¦', 'å¦ˆå¦ˆ', 'çˆ¸çˆ¸', 'æƒ…ä¾£',
            'coser', 'æ¨¡ç‰¹', 'éª‘å£«', 'å…¬ä¸»', 'ç‹å­', 'ç²¾çµ', 'çŒ«å¨˜', 'ç‹å¨˜', 'å…½è€³', 'å¥³ä»†', 'æ‹Ÿäºº',
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

        return parts.filter(Boolean).join('ï¼Œ');
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

    _buildImagePromptEditPatch(message = {}, descriptionValue = '', promptValue = '') {
        const prompt = String(promptValue || '').trim();
        if (!prompt) return null;

        const description = String(descriptionValue || '').trim() || prompt;
        return {
            imageDescription: description,
            imagePrompt: prompt,
            content: prompt,
            imageGenStatus: String(message?.generatedImageUrl || '').trim() ? 'done' : 'idle',
            imageGenerationRuntimeId: '',
            imageGenError: ''
        };
    }

    openImagePromptEditor(messageId) {
        const chatId = String(this.app.currentChat?.id || '').trim();
        const safeMessageId = String(messageId || '').trim();
        if (!chatId || !safeMessageId) return;

        const message = this.app.wechatData.getMessages(chatId)
            .find(item => String(item?.id || '').trim() === safeMessageId);
        if (!message || message.type !== 'image_prompt') return;

        const isCurrentGenerationLoading = String(message.imageGenStatus || '').trim() === 'loading'
            && String(message.imageGenerationRuntimeId || '').trim() === String(this.app.wechatData.imageGenerationRuntimeId || '').trim();
        if (isCurrentGenerationLoading) {
            this.app.phoneShell?.showNotification('æç¤º', 'å›¾ç‰‡æ­£åœ¨ç”Ÿæˆï¼Œè¯·å®Œæˆåå†ä¿®æ”¹æè¿°', 'âš ï¸');
            return;
        }

        const currentView = this.getCurrentWechatView ? this.getCurrentWechatView() : document;
        const host = currentView.querySelector?.('.wechat-app') || currentView;
        if (!host?.appendChild) return;

        currentView.querySelector?.('#wechat-image-prompt-editor-modal')?.remove();
        const displayPrompt = this._normalizeImagePromptDisplayFields(message);
        const mediaLabel = String(message.mediaType || 'å›¾ç‰‡').trim() || 'å›¾ç‰‡';
        const modal = document.createElement('div');
        modal.id = 'wechat-image-prompt-editor-modal';
        modal.className = 'wechat-image-prompt-editor-overlay';
        modal.innerHTML = `
            <div class="wechat-image-prompt-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="wechat-image-prompt-editor-title">
                <div class="wechat-image-prompt-editor-header">
                    <div id="wechat-image-prompt-editor-title" class="wechat-image-prompt-editor-title">ç¼–è¾‘${this._escapeHtml(mediaLabel)}æè¿°</div>
                    <button type="button" class="wechat-image-prompt-editor-close" data-action="close" title="å…³é—­">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="wechat-image-prompt-editor-body">
                    <label class="wechat-image-prompt-editor-field">
                        <span>å±•ç¤ºæè¿°</span>
                        <textarea class="wechat-image-prompt-editor-textarea" data-field="description" rows="3">${this._escapeHtml(displayPrompt.description)}</textarea>
                    </label>
                    <label class="wechat-image-prompt-editor-field">
                        <span>å®é™…ç”Ÿå›¾å†…å®¹</span>
                        <textarea class="wechat-image-prompt-editor-textarea is-prompt" data-field="prompt" rows="5">${this._escapeHtml(displayPrompt.prompt)}</textarea>
                    </label>
                </div>
                <div class="wechat-image-prompt-editor-actions">
                    <button type="button" class="wechat-image-prompt-editor-button is-secondary" data-action="cancel">å–æ¶ˆ</button>
                    <button type="button" class="wechat-image-prompt-editor-button is-secondary" data-action="save">ä»…ä¿å­˜</button>
                    <button type="button" class="wechat-image-prompt-editor-button is-primary" data-action="save-generate">ä¿å­˜å¹¶ç”Ÿæˆ</button>
                </div>
            </div>
        `;
        host.appendChild(modal);
        this._setMessageInlineEditMode(true, chatId);

        const descriptionInput = modal.querySelector('[data-field="description"]');
        const promptInput = modal.querySelector('[data-field="prompt"]');
        const actionButtons = Array.from(modal.querySelectorAll('[data-action="save"], [data-action="save-generate"]'));
        let saving = false;
        let closed = false;

        const close = () => {
            if (closed) return;
            closed = true;
            modal.remove();
            this._setMessageInlineEditMode(false, chatId);
        };
        const stopInputPropagation = (event) => {
            event.stopPropagation();
            if (event.type === 'keydown' && event.key === 'Escape') {
                event.preventDefault();
                close();
            }
        };
        [descriptionInput, promptInput].forEach((input) => {
            ['input', 'keydown', 'keyup', 'focus', 'blur'].forEach(eventName => {
                input?.addEventListener(eventName, stopInputPropagation);
            });
        });

        const save = async (generateAfterSave = false) => {
            if (saving) return;
            const latestMessage = this.app.wechatData.getMessages(chatId)
                .find(item => String(item?.id || '').trim() === safeMessageId);
            if (!latestMessage) {
                close();
                return;
            }
            const latestIsLoading = String(latestMessage.imageGenStatus || '').trim() === 'loading'
                && String(latestMessage.imageGenerationRuntimeId || '').trim() === String(this.app.wechatData.imageGenerationRuntimeId || '').trim();
            if (latestIsLoading) {
                this.app.phoneShell?.showNotification('æç¤º', 'å›¾ç‰‡æ­£åœ¨ç”Ÿæˆï¼Œè¯·å®Œæˆåå†ä¿å­˜ä¿®æ”¹', 'âš ï¸');
                return;
            }

            const patch = this._buildImagePromptEditPatch(
                latestMessage,
                descriptionInput?.value,
                promptInput?.value
            );
            if (!patch) {
                this.app.phoneShell?.showNotification('æç¤º', 'å®é™…ç”Ÿå›¾æè¿°ä¸èƒ½ä¸ºç©º', 'âš ï¸');
                promptInput?.focus();
                return;
            }

            saving = true;
            actionButtons.forEach(button => { button.disabled = true; });
            this.app.wechatData.updateMessageById(chatId, safeMessageId, patch);
            close();
            this._refreshVisibleChatMessages(chatId);
            this.app.phoneShell?.showNotification('å·²ä¿å­˜', generateAfterSave ? 'å·²æŒ‰ä¿®æ”¹åçš„æè¿°å¼€å§‹ç”Ÿæˆ' : 'å›¾ç‰‡æè¿°å·²æ›´æ–°', 'âœ…');
            if (generateAfterSave) {
                await this.generateImagePromptMessage(safeMessageId);
            }
        };

        modal.addEventListener('click', (event) => {
            if (event.target === modal) close();
        });
        modal.querySelector('[data-action="close"]')?.addEventListener('click', close);
        modal.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
        modal.querySelector('[data-action="save"]')?.addEventListener('click', () => save(false));
        modal.querySelector('[data-action="save-generate"]')?.addEventListener('click', () => save(true));
        modal.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            }
        });

        requestAnimationFrame(() => {
            promptInput?.focus();
            promptInput?.setSelectionRange?.(promptInput.value.length, promptInput.value.length);
        });
    }

    async _resolveWechatImageGenerationPrompt(rawPrompt = '') {
        const sourcePrompt = String(rawPrompt || '').trim();
        if (!sourcePrompt || !this._hasCjkText(sourcePrompt)) return sourcePrompt;

        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager || typeof apiManager.callAI !== 'function') {
            throw new Error('å°æ‰‹æœº API æœªåˆå§‹åŒ–ï¼Œæ— æ³•ç”Ÿæˆè‹±æ–‡ TAG');
        }

        const result = await apiManager.callAI([
            {
                role: 'system',
                content: [
                    'You convert Chinese image descriptions into English image-generation prompt tags.',
                    'Output only concise English comma-separated tags.',
                    'Do not output explanations, Markdown, Chinese, labels, or complete sentences.',
                    'Preserve subject, gender, count, appearance, pose, expression, clothing, setting, camera distance, angle, lighting, atmosphere, and illustration style.',
                    'Do not add unrelated content.'
                ].join('\n')
            },
            {
                role: 'user',
                content: `Chinese image description:\n${sourcePrompt}\n\nEnglish comma-separated tags only:`
            }
        ], {
            appId: 'wechat',
            max_tokens: 360,
            stream: false
        });
        if (!result?.success) {
            throw new Error(result?.error || 'å°æ‰‹æœº API æœªèƒ½ç”Ÿæˆè‹±æ–‡ TAG');
        }

        const translatedPrompt = String(result?.summary || result?.content || result?.text || '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/```[a-z]*|```/gi, '')
            .replace(/^\s*(?:prompt|positive prompt|tags?|english tags?|æç¤ºè¯|æ­£é¢æç¤ºè¯)\s*[:ï¼š]/i, '')
            .replace(/[\r\n;ï¼›]+/g, ', ')
            .replace(/[ï¼Œã€]/g, ', ')
            .replace(/[ã€‚ï¼ï¼Ÿ]/g, '')
            .replace(/\s*,\s*/g, ', ')
            .replace(/\s{2,}/g, ' ')
            .replace(/^["'â€œâ€â€˜â€™\s]+|["'â€œâ€â€˜â€™\s]+$/g, '')
            .trim();
        if (!translatedPrompt || this._hasCjkText(translatedPrompt)) {
            throw new Error('å°æ‰‹æœº API è¿”å›çš„è‹±æ–‡ TAG æ— æ•ˆ');
        }
        return translatedPrompt;
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
        if (
            status === 'loading'
            && String(message.imageGenerationRuntimeId || '').trim() === String(this.app.wechatData.imageGenerationRuntimeId || '').trim()
        ) return;
        this._imagePromptGenerationLocks.add(generationLockKey);

        const rawPromptText = String(message.imagePrompt || message.content || '').trim();
        const parsedRawPrompt = this._parseImagePromptText(rawPromptText);
        const sourcePromptText = String(parsedRawPrompt.prompt || rawPromptText).trim();
        if (!sourcePromptText) {
            this._imagePromptGenerationLocks.delete(generationLockKey);
            this.app.phoneShell?.showNotification('æç¤º', 'è¿™æ¡å›¾ç‰‡æ¶ˆæ¯ç¼ºå°‘æè¿°ï¼Œæ— æ³•ç”Ÿæˆ', 'âš ï¸');
            return;
        }
        const parsedCurrentPrompt = this._parseImagePromptText(String(message.content || rawPromptText || ''));
        const descriptionText = String(message.imageDescription || parsedRawPrompt.description || parsedCurrentPrompt.description || sourcePromptText).trim();
        const imageManager = window.VirtualPhone?.imageGenerationManager;
        if (!imageManager || typeof imageManager.generate !== 'function') {
            this._imagePromptGenerationLocks.delete(generationLockKey);
            this.app.phoneShell?.showNotification('ç”Ÿå›¾å¤±è´¥', 'ç”Ÿå›¾ç®¡ç†å™¨æœªåˆå§‹åŒ–', 'âŒ');
            return;
        }
        const storage = this.app?.storage || window.VirtualPhone?.storage || null;
        if (storage && imageManager.storage !== storage) {
            imageManager.storage = storage;
        }
        const generationId = `wechat_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const previousImageUrl = String(message.generatedImageUrl || '').trim();

        this.app.wechatData.updateMessageById(chatId, safeMessageId, {
            imageGenStatus: 'loading',
            imageGenerationId: generationId,
            imageGenerationRuntimeId: this.app.wechatData.imageGenerationRuntimeId,
            imageGenError: '',
            imagePrompt: sourcePromptText,
            imageDescription: descriptionText,
            generatedImageUrl: '',
            imageModel: '',
            imageProvider: '',
            imageGenerationWidth: '',
            imageGenerationHeight: ''
        });
        this._refreshVisibleChatMessages(chatId);

        let promptText = '';
        try {
            promptText = await this._resolveWechatImageGenerationPrompt(sourcePromptText);
        } catch (error) {
            const promptError = String(error?.message || 'è‹±æ–‡ TAG ç”Ÿæˆå¤±è´¥').trim();
            this.app.wechatData.updateMessageById(chatId, safeMessageId, {
                imagePrompt: sourcePromptText,
                imageDescription: descriptionText,
                imageGenStatus: 'failed',
                imageGenerationRuntimeId: '',
                imageGenError: promptError
            });
            this._refreshVisibleChatMessages(chatId);
            this._imagePromptGenerationLocks.delete(generationLockKey);
            this.app.phoneShell?.showNotification('è‹±æ–‡ TAG ç”Ÿæˆå¤±è´¥', promptError, 'âŒ');
            return;
        }
        const latestBeforeGeneration = this.app.wechatData.getMessages(chatId)
            .find((item) => String(item?.id || '').trim() === safeMessageId);
        if (String(latestBeforeGeneration?.imageGenerationId || '') !== generationId) {
            this._imagePromptGenerationLocks.delete(generationLockKey);
            return;
        }
        if (promptText !== sourcePromptText) {
            this.app.wechatData.updateMessageById(chatId, safeMessageId, {
                imagePrompt: promptText,
                imageDescription: descriptionText,
                content: promptText
            });
            this._refreshVisibleChatMessages(chatId);
        }

        const novelAIReferences = await this._buildWechatPersonalImageReferences(message);
        const generationPrompt = this._buildWechatImagePromptWithContactTags(message, promptText);

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
                throw new Error('æ¥å£è¿”å›æˆåŠŸï¼Œä½†æ²¡æœ‰æ‹¿åˆ°å›¾ç‰‡åœ°å€');
            }
            const latestMessage = this.app.wechatData.getMessages(chatId)
                .find((item) => String(item?.id || '').trim() === safeMessageId);
            if (String(latestMessage?.imageGenerationId || '') !== generationId) return;

            this.app.wechatData.updateMessageById(chatId, safeMessageId, {
                imagePrompt: promptText,
                imageDescription: descriptionText,
                generatedImageUrl: imageUrl,
                imageGenStatus: 'done',
                imageGenerationRuntimeId: '',
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
            const friendlyMessage = /å®‰å…¨ç­–ç•¥æ‹’ç»|content[_\s-]?policy|content[_\s-]?filter|policy[_\s-]?violation|moderation|safety/i.test(rawMessage)
                ? rawMessage
                : /failed to fetch|networkerror|load failed/i.test(rawMessage)
                ? 'è¯·æ±‚å¤±è´¥ï¼Œå¯èƒ½æ˜¯ç½‘ç»œå¼‚å¸¸æˆ–æµè§ˆå™¨è·¨åŸŸæ‹¦æˆª'
                : (rawMessage || 'æœªçŸ¥é”™è¯¯');

            console.error('å¾®ä¿¡å›¾ç‰‡ç”Ÿæˆå¤±è´¥:', error);

            const latestMessage = this.app.wechatData.getMessages(chatId)
                .find((item) => String(item?.id || '').trim() === safeMessageId);
            if (String(latestMessage?.imageGenerationId || '') !== generationId) return;

            this.app.wechatData.updateMessageById(chatId, safeMessageId, {
                imagePrompt: promptText,
                imageDescription: descriptionText,
                imageGenStatus: 'failed',
                imageGenerationRuntimeId: '',
                imageGenError: friendlyMessage
            });
            this._refreshVisibleChatMessages(chatId);
            this.app.phoneShell?.showNotification('ç”Ÿå›¾å¤±è´¥', friendlyMessage, 'âŒ');
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
            throw new Error('å›¾ç‰‡ä¸Šä¼ ç®¡ç†å™¨æœªåˆå§‹åŒ–ï¼Œæ— æ³•ä¿å­˜å¾®ä¿¡ç”Ÿå›¾');
        }

        const blob = await this._loadGeneratedWechatImageBlob(safeUrl);
        const uniquePart = String(generationId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_');
        const seed = `${chatId || 'chat'}_${messageId || 'msg'}_${this._simpleImageHash(promptText || safeUrl).toString(36)}_${uniquePart}`;
        const uploadedUrl = await imageUploader.uploadBlob(blob, `wechat_img_${seed}`);
        const normalized = String(uploadedUrl || '').trim();
        if (!/^\/backgrounds\/phone_[^?#]+/i.test(normalized)) {
            throw new Error('å¾®ä¿¡ç”Ÿå›¾ä¿å­˜å¤±è´¥ï¼šæœªå¾—åˆ°æœ‰æ•ˆæœ¬åœ°å›¾ç‰‡è·¯å¾„');
        }
        return normalized;
    }

    async _loadGeneratedWechatImageBlob(imageUrl) {
        const safeUrl = String(imageUrl || '').trim();
        if (!safeUrl) throw new Error('ç”Ÿå›¾ç»“æœä¸ºç©º');
        const response = await fetch(safeUrl, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`è¯»å–å¾®ä¿¡ç”Ÿå›¾å¤±è´¥ï¼ˆHTTP ${response.status}ï¼‰`);
        }
        const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const arrayBuffer = await response.arrayBuffer();
        if (!arrayBuffer || arrayBuffer.byteLength <= 0) {
            throw new Error('å¾®ä¿¡ç”Ÿå›¾ç»“æœä¸æ˜¯æœ‰æ•ˆå›¾ç‰‡');
        }
        const bytes = new Uint8Array(arrayBuffer);
        const mime = resolveImageMime(bytes, contentType);
        if (!mime) throw new Error('å¾®ä¿¡ç”Ÿå›¾ç»“æœä¸æ˜¯æœ‰æ•ˆå›¾ç‰‡');
        const blob = new Blob([arrayBuffer], { type: mime });
        return blob;
    }

    _detectGeneratedWechatImageMime(bytes) {
        return detectImageMime(bytes);
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
        const match = raw.match(/\/backgrounds\/phone_wechat_img_[^?#\s)ï¼‰]+/i);
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
            throw new Error(`ä¸ªäººå½¢è±¡å‚è€ƒå›¾è¯»å–å¤±è´¥ (${response.status})`);
        }
        const blob = await response.blob();
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('ä¸ªäººå½¢è±¡å‚è€ƒå›¾è¯»å–å¤±è´¥'));
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
            || mediaType === 'ä¸ªäººå›¾ç‰‡'
            || /^\[\s*ä¸ªäººå›¾ç‰‡\s*\]/.test(contentText);
        if (!isPersonalImage || mediaType === 'è§†é¢‘') return null;
        if (mediaType === 'å›¾ç‰‡' && !explicitPersonalReference && !/^\[\s*ä¸ªäººå›¾ç‰‡\s*\]/.test(contentText)) return null;
        const senderName = String(message.from || message.sender || message.contactName || '').trim();
        if (!senderName || senderName === 'me') return null;
        const wechatData = this.app?.wechatData;
        const contacts = wechatData?.getContacts?.() || [];
        const currentChat = this.app?.currentChat;
        const messageContactId = String(message.contactId || message.senderId || '').trim();
        const directChatContactId = currentChat?.type !== 'group'
            ? String(currentChat?.contactId || '').trim()
            : '';
        const linkedContactId = messageContactId || directChatContactId;
        const linkedContact = linkedContactId
            ? (wechatData?.getContact?.(linkedContactId)
                || contacts.find(contact => String(contact?.id || '').trim() === linkedContactId))
            : null;
        if (linkedContact) return linkedContact;

        const normalize = (value) => this._normalizeLookupName(value);
        const senderKey = normalize(senderName);
        if (!senderKey) return null;
        return contacts.find(contact => String(contact?.realName || '')
            .split(/[ã€,ï¼Œ/|ï½œï¼›;]+/)
            .map(alias => normalize(alias))
            .filter(Boolean)
            .includes(senderKey)) || null;
    }

    _buildWechatImagePromptWithContactTags(message = {}, promptText = '') {
        const parsedPrompt = this._parseImagePromptText(promptText);
        const basePrompt = String(parsedPrompt.prompt || promptText || '').trim();
        if (message?.useUserReference === true || String(message?.mediaType || '').trim() === 'ç”¨æˆ·ç…§ç‰‡') {
            const userInfo = this.app?.wechatData?.getUserInfo?.() || {};
            const userTags = String(userInfo?.naiPromptTags || userInfo?.imageTags || '')
                .split(/[,ï¼Œ\n]+/)
                .map(tag => tag.trim())
                .filter(Boolean)
                .join(', ');
            if (!userTags) return basePrompt;
            if (!basePrompt) return userTags;
            return `${userTags}, ${basePrompt}`;
        }
        const contact = this._resolveWechatPersonalReferenceContact(message);
        const contactTags = String(contact?.naiPromptTags || contact?.imageTags || '')
            .split(/[,ï¼Œ\n]+/)
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
            console.warn('[Wechat NAI] ä¸ªäººå½¢è±¡å‚è€ƒå›¾è¯»å–å¤±è´¥ï¼Œå·²è·³è¿‡:', err);
            this.app?.phoneShell?.showNotification?.('å¾®ä¿¡', 'ä¸ªäººå½¢è±¡å‚è€ƒå›¾è¯»å–å¤±è´¥ï¼Œæœ¬æ¬¡å°†ä¸ä½¿ç”¨å‚è€ƒå›¾', 'âš ï¸');
            return [];
        }
    }

    renderImagePromptCard(msg) {
        const displayPrompt = this._normalizeImagePromptDisplayFields(msg);
        const promptRaw = displayPrompt.prompt || 'å¾…ç”Ÿæˆå›¾ç‰‡';
        const promptText = this._escapeHtml(promptRaw);
        const descriptionRaw = displayPrompt.description || promptRaw;
        const descriptionText = this._escapeHtml(descriptionRaw);
        const promptLabel = promptRaw;
        const promptLabelHtml = this._escapeHtml(promptLabel);
        const cardId = this.escapeInlineStickerAttr(String(msg?.id || `imgprompt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`));
        const generatedImageUrl = String(msg?.generatedImageUrl || '').trim();
        const safeImageUrl = this.escapeInlineStickerAttr(generatedImageUrl);
        const generationStatus = generatedImageUrl
            ? 'done'
            : (String(msg?.imageGenStatus || '').trim() || 'idle');
            
        // ğŸ”¥ æ ¹æ®æ˜¯å›¾ç‰‡è¿˜æ˜¯è§†é¢‘ï¼ŒåŠ¨æ€æ˜¾ç¤ºä¸åŒçš„æç¤ºå’Œå›¾æ ‡
        const isVideo = msg?.mediaType === 'è§†é¢‘';
        const actionText = isVideo ? 'ç”Ÿæˆè§†é¢‘å°é¢' : 'ç”Ÿæˆå›¾ç‰‡';
        const defaultIcon = isVideo ? '<i class="fa-solid fa-video"></i>' : '<i class="fa-regular fa-image"></i>';

        const statusText = generationStatus === 'loading'
            ? `æ­£åœ¨${actionText}ä¸­ï¼Œè¯·ç¨å€™...`
            : generationStatus === 'failed'
                ? 'âŒ ç”Ÿæˆå¤±è´¥ï¼Œç‚¹å‡»é‡è¯•'
                : `ç‚¹å‡»${actionText}`;

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
                        <div class="message-image-prompt-regenerate" data-message-id="${cardId}" title="é‡æ–°ç”Ÿæˆ${msg.mediaType || 'å›¾ç‰‡'}" style="
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
                        ">é‡æ–°ç”Ÿæˆ</div>
                        <div class="message-image-prompt-show-back" data-message-id="${cardId}" title="æŸ¥çœ‹${msg.mediaType || 'å›¾ç‰‡'}æè¿°" style="
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
                        ">æè¿°</div>
                    ` : `
                        <div class="message-image-prompt-generate" data-message-id="${cardId}" title="${generationStatus === 'failed' ? 'ç‚¹å‡»é‡è¯•' : `ç‚¹å‡»${actionText}`}" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:8px; padding:12px; box-sizing:border-box; background:transparent;">
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
                        <div class="message-image-prompt-show-back" data-message-id="${cardId}" title="æŸ¥çœ‹${msg.mediaType || 'å›¾ç‰‡'}æè¿°" style="
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
                        ">æè¿°</div>
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
                        padding-bottom:30px;
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
                            <div style="font-weight:700; margin-bottom:6px;">ä¸­æ–‡æè¿°</div>
                            <div>${descriptionText}</div>
                            <div style="font-weight:700; margin:10px 0 6px;">è‹±æ–‡Tag</div>
                            <div>${promptLabelHtml}</div>
                        </div>
                    </div>
                    <div class="message-image-prompt-edit" data-message-id="${cardId}" title="ç¼–è¾‘${msg.mediaType || 'å›¾ç‰‡'}æè¿°" style="
                        position:absolute;
                        bottom:4px;
                        left:4px;
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
                        <i class="fa-solid fa-pen"></i> ç¼–è¾‘
                    </div>
                    <div class="message-image-prompt-restore" data-message-id="${cardId}" title="æ¢å¤å¡ç‰‡æ­£é¢" style="
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
                        ${defaultIcon} æ¢å¤
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
            return !text || /^\[(?:å¾®åšåˆ†äº«|å¾®åšæ–°é—»|weibo_card)\]$/i.test(text);
        };

        const formatMedia = (raw, index) => {
            const text = normalizeText(raw);
            if (!text) return '';
            const tagged = text.match(/^\[(ç”¨æˆ·ç…§ç‰‡|ä¸ªäººå›¾ç‰‡|å›¾ç‰‡|è§†é¢‘)\]\s*([\s\S]*)$/);
            if (tagged) {
                const type = tagged[1] || 'å›¾ç‰‡';
                const desc = String(tagged[2] || '').trim();
                return desc ? `[${type}]${desc}` : `[${type}${index ? index + 1 : ''}]`;
            }
            if (/^(?:https?:|data:image|blob:)/i.test(text) || /\.(?:png|jpe?g|gif|webp|avif)(?:[?#].*)?$/i.test(text)) {
                return `[å›¾ç‰‡${index ? index + 1 : ''}]`;
            }
            return text;
        };

        const wb = msg?.weiboData && typeof msg.weiboData === 'object' ? msg.weiboData : {};
        const hasWeiboData = Object.keys(wb).length > 0;
        const fullContent = normalizeText(msg.content);
        if (!hasWeiboData) {
            return isPlaceholderOnly(fullContent) ? '[å¾®åšåˆ†äº«]' : (fullContent || '[å¾®åšåˆ†äº«]');
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

        lines.push(`[å¾®åšåˆ†äº«]${blogger ? ` ${blogger}${bloggerType ? `ï¼ˆ${bloggerType}ï¼‰` : ''}` : ''}`);
        if (time || device) lines.push(`æ—¶é—´ï¼š${[time, device ? `æ¥è‡ª${device}` : ''].filter(Boolean).join(' ')}`);
        if (body) lines.push(`æ­£æ–‡ï¼š${body}`);

        const mediaLines = (Array.isArray(wb.images) ? wb.images : [])
            .map((item, index) => formatMedia(item, index))
            .filter(Boolean);
        if (mediaLines.length > 0) lines.push(`é…å›¾ï¼š${mediaLines.join(' ')}`);
        if (forward || commentsCount || likes) lines.push(`æ•°æ®ï¼šè½¬å‘ ${forward} | è¯„è®º ${commentsCount} | ç‚¹èµ ${likes}`);

        const commentLines = (Array.isArray(wb.commentList) ? wb.commentList : [])
            .map((comment) => {
                const name = normalizeText(comment?.name || 'ç½‘å‹');
                const replyTo = normalizeText(comment?.replyTo || '');
                const location = normalizeText(comment?.location || '');
                const text = normalizeText(comment?.text || '');
                if (!text) return '';
                const replyText = replyTo ? `å›å¤${replyTo}` : '';
                const locationText = location ? `ï¼ˆip${location}ï¼‰` : '';
                return `${name}${locationText}${replyText}ï¼š${text}`;
            })
            .filter(Boolean);
        if (commentLines.length > 0) {
            lines.push('è¯„è®ºåŒºï¼š');
            lines.push(...commentLines);
        }

        const rebuilt = lines.filter(Boolean).join('\n').trim();
        if (rebuilt && rebuilt !== '[å¾®åšåˆ†äº«]') return rebuilt;
        return isPlaceholderOnly(fullContent) ? '[å¾®åšåˆ†äº«]' : (fullContent || '[å¾®åšåˆ†äº«]');
    }

    _formatXCardForPrompt(msg = {}) {
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
        const xData = msg?.xData && typeof msg.xData === 'object' ? msg.xData : {};
        const fullContent = normalizeText(msg.content);
        if (Object.keys(xData).length === 0) {
            return fullContent || '[Xåˆ†äº«]';
        }

        const author = xData.author && typeof xData.author === 'object' ? xData.author : {};
        const authorName = normalizeText(author.name || 'X ç”¨æˆ·') || 'X ç”¨æˆ·';
        const accountType = String(author.accountType || '').trim().toLowerCase();
        const accountLabel = accountType === 'official'
            ? 'ï¼ˆå®˜æ–¹è®¤è¯ï¼‰'
            : accountType === 'advertiser'
                ? 'ï¼ˆå¹¿å‘Šè´¦å·ï¼‰'
                : '';
        const body = normalizeText(xData.content || '');
        const time = normalizeText(xData.originalTime || xData.time || '');
        const imageStates = Array.isArray(xData.imageGenerationStates) ? xData.imageGenerationStates : [];
        const mediaLines = (Array.isArray(xData.images) ? xData.images : [])
            .map((raw, index) => {
                const state = imageStates[index] || {};
                const description = normalizeText(state.description || '');
                if (description) return `[å›¾ç‰‡${index ? index + 1 : ''}]ï¼ˆ${description}ï¼‰`;
                const text = normalizeText(raw);
                if (!text) return '';
                const tagged = text.match(/^\[(ç”¨æˆ·ç…§ç‰‡|ä¸ªäººå›¾ç‰‡|å›¾ç‰‡|è§†é¢‘)\]\s*([\s\S]*)$/);
                if (tagged) return tagged[2] ? `[${tagged[1]}${index ? index + 1 : ''}]${tagged[2]}` : `[${tagged[1]}${index ? index + 1 : ''}]`;
                if (/^(?:https?:|data:image|blob:|\/backgrounds\/)/i.test(text) || /\.(?:png|jpe?g|gif|webp|avif)(?:[?#].*)?$/i.test(text)) {
                    return `[å›¾ç‰‡${index ? index + 1 : ''}]`;
                }
                return text;
            })
            .filter(Boolean);
        imageStates.slice((Array.isArray(xData.images) ? xData.images.length : 0)).forEach((state, offset) => {
            const index = (Array.isArray(xData.images) ? xData.images.length : 0) + offset;
            const description = normalizeText(state?.description || '');
            if (description || state?.generatedImageUrl) {
                mediaLines.push(description ? `[å›¾ç‰‡${index ? index + 1 : ''}]ï¼ˆ${description}ï¼‰` : `[å›¾ç‰‡${index ? index + 1 : ''}]`);
            }
        });

        const comments = Array.isArray(xData.commentList) ? xData.commentList : [];
        const namesByTarget = new Map();
        comments.forEach(comment => {
            const name = normalizeText(comment?.name || 'X ç”¨æˆ·') || 'X ç”¨æˆ·';
            if (comment?.id) namesByTarget.set(String(comment.id), name);
            if (comment?.handle) namesByTarget.set(String(comment.handle), name);
        });
        const commentLines = comments.map(comment => {
            const text = normalizeText(comment?.text || '');
            if (!text) return '';
            const name = normalizeText(comment?.name || 'X ç”¨æˆ·') || 'X ç”¨æˆ·';
            const rawReplyTo = String(comment?.replyTo || '').trim();
            const replyTo = namesByTarget.get(rawReplyTo) || normalizeText(rawReplyTo.replace(/^@/, ''));
            return `${name}${replyTo ? ` å›å¤ ${replyTo}` : ''}ï¼š${text}`;
        }).filter(Boolean);

        const commentsCount = Math.max(Number.parseInt(xData.comments, 10) || 0, comments.length);
        const likes = Math.max(0, Number.parseInt(xData.likes, 10) || 0);
        const lines = [`[Xåˆ†äº«] ${authorName}${accountLabel}`];
        if (time) lines.push(`æ—¶é—´ï¼š${time}`);
        if (body) lines.push(`æ­£æ–‡ï¼š${body}`);
        if (mediaLines.length > 0) lines.push(`é…å›¾ï¼š${mediaLines.join(' ')}`);
        if (commentsCount || likes) lines.push(`æ•°æ®ï¼šå›å¤ ${commentsCount} | å–œæ¬¢ ${likes}`);
        if (commentLines.length > 0) lines.push('è¯„è®ºåŒºï¼š', ...commentLines);
        return lines.join('\n').trim() || fullContent || '[Xåˆ†äº«]';
    }

    _formatWangxiangTaskForPrompt(msg = {}) {
        const fullContent = String(msg.content || '').trim();
        const task = msg.wangxiangTaskData && typeof msg.wangxiangTaskData === 'object'
            ? msg.wangxiangTaskData
            : {};
        const isConfirmation = msg.type === 'wangxiang_task_confirmation';
        const isInvitation = msg.type === 'wangxiang_task_invitation';
        const invitationStatus = String(msg.taskInvitationStatus || 'pending');
        const isPlaceholder = !fullContent
            || /^\[(?:wangxiang_task_card|wangxiang_task_confirmation|wangxiang_task_invitation|ä¸‡è±¡ä»»åŠ¡ç”³è¯·|ä¸‡è±¡ä»»åŠ¡é‚€è¯·|ä»»åŠ¡å·²ç¡®è®¤æ´¾å‘|ä»»åŠ¡æ´¾å‘ç¡®è®¤ï¼šæœªåŒ¹é…)\](?:\s+.*)?$/i.test(fullContent);
        if (!isConfirmation && !isInvitation && !isPlaceholder) return fullContent;
        if (Object.keys(task).length === 0) {
            return fullContent || (isInvitation ? '[ä¸‡è±¡ä»»åŠ¡é‚€è¯·]' : isConfirmation ? '[ä¸‡è±¡ä»»åŠ¡ç¡®è®¤]' : '[ä¸‡è±¡ä»»åŠ¡ç”³è¯·]');
        }

        const objectives = (Array.isArray(task.objectives) ? task.objectives : [])
            .map(item => {
                const title = String(item?.title || 'å®Œæˆä»»åŠ¡è¦æ±‚').trim();
                const current = Number(item?.current || 0);
                const total = Math.max(1, Number(item?.total || 1));
                return `${title}ï¼ˆ${current}/${total}ï¼‰`;
            })
            .filter(Boolean);
        const rewards = [
            task.reward ? `${task.reward} ä¿¡ç”¨ç‚¹` : '',
            task.prestige ? `${task.prestige} å£°æœ›å€¼` : '',
            task.extraReward && task.extraReward !== 'æ— ' ? `é¢å¤–å¥–åŠ±ï¼š${task.extraReward}` : ''
        ].filter(Boolean);
        const lines = [
            isInvitation
                ? `[ä¸‡è±¡ä»»åŠ¡é‚€è¯·ï¼š${invitationStatus === 'accepted' ? 'ç”¨æˆ·å·²åŒæ„å¹¶åŠ å…¥æˆ‘çš„ä»»åŠ¡' : invitationStatus === 'cancelled' ? 'ç”¨æˆ·å·²å–æ¶ˆ' : 'ç­‰å¾…ç”¨æˆ·å¤„ç†'}]`
                : isConfirmation
                    ? `[ä¸‡è±¡ä»»åŠ¡ç¡®è®¤ï¼š${msg.assignmentMatched === false ? 'æœªåŒ¹é…åˆ°ä»»åŠ¡' : 'å·²ç¡®è®¤æ´¾å‘'}]`
                    : '[ä¸‡è±¡ä»»åŠ¡ç”³è¯·]',
            task.title ? `ä»»åŠ¡åç§°ï¼š${task.title}` : '',
            task.publisher ? `å‘å¸ƒè€…ï¼š${task.publisher}` : '',
            task.description ? `ä»»åŠ¡æè¿°ï¼š${task.description}` : '',
            task.location ? `ä»»åŠ¡åœ°ç‚¹ï¼š${task.location}` : '',
            objectives.length ? `ä»»åŠ¡ç›®æ ‡ï¼š${objectives.join('ï¼›')}` : '',
            rewards.length ? `ä»»åŠ¡å¥–åŠ±ï¼š${rewards.join('ï¼›')}` : '',
            task.publishedAt ? `å‘å¸ƒæ—¶é—´ï¼š${task.publishedAt}` : '',
            (task.startsAt || task.startTime) ? `ä»»åŠ¡å¼€å§‹æ—¶é—´ï¼š${task.startsAt || task.startTime}` : '',
            task.estimatedDuration ? `é¢„ä¼°è€—æ—¶ï¼š${task.estimatedDuration}` : ''
        ].filter(Boolean);
        return lines.join('\n');
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
                // æœåŠ¡ç«¯ç”Ÿæˆåå¯¹ç”¨æˆ·æ— æ„ä¹‰ï¼Œç›´æ¥å›é€€ä¸ºé€šç”¨åç§°
                if (/^phone_emoji_\d+_\d+$/i.test(withoutExt)) return 'å›¾ç‰‡';
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
            return 'å›¾ç‰‡';
        };

        if (msg.type === 'file_card') return formatWechatFile(msg.fileTitle, msg.fileText);
        if (msg.type === 'forward_card' || msg.type === 'text') return String(msg.content || '');
        if (msg.type === 'image') {
            return `[å›¾ç‰‡]ï¼ˆ${getImageDisplayName()}ï¼‰`;
        }
        if (msg.type === 'image_prompt') return this._formatImagePromptTagForPrompt(msg);
        if (msg.type === 'sticker') {
            const stickerValue = String(msg.stickerUrl || msg.keyword || msg.content || 'è¡¨æƒ…åŒ…').trim() || 'è¡¨æƒ…åŒ…';
            return `[è¡¨æƒ…åŒ…]ï¼ˆ${stickerValue}ï¼‰`;
        }
        if (msg.type === 'voice') {
            let voiceSource = String(msg.voiceText || '').trim();
            if (!voiceSource) {
                const rawContent = String(msg.content || '').trim();
                const taggedVoiceMatch = /^(?:\[\s*(?:è¯­éŸ³æ¡|è¯­éŸ³)\s*\]|ã€\s*(?:è¯­éŸ³æ¡|è¯­éŸ³)\s*ã€‘)\s*[:ï¼š]?\s*(.+)$/i.exec(rawContent);
                const legacyVoiceMatch = /^\[è¯­éŸ³\s*\d+ç§’?\]\(?([^)]*)\)?$/i.exec(rawContent);
                voiceSource = taggedVoiceMatch?.[1] || legacyVoiceMatch?.[1] || rawContent;
            }

            const voiceText = parseWechatVoiceContent(voiceSource).voiceText;
            return voiceText ? `[è¯­éŸ³æ¡]ï¼ˆ${voiceText}ï¼‰` : '[è¯­éŸ³æ¡]';
        }
        if (msg.type === 'call_record') {
            const isGroupCall = targetChat?.type === 'group';
            const callTypeName = msg.callType === 'video' ? 'è§†é¢‘é€šè¯' : 'è¯­éŸ³é€šè¯';
            const status = String(msg.status || '').trim();
            const statusText = status === 'answered'
                ? `é€šè¯æ—¶é•¿ ${msg.duration || 'æœªçŸ¥'}`
                : (status === 'rejected' || status === 'declined')
                    ? (isGroupCall ? 'ç¾¤æˆå‘˜æœªæ¥å¬' : 'å¯¹æ–¹å·²æ‹’ç»')
                    : status === 'cancelled'
                        ? 'ç”¨æˆ·å·²å–æ¶ˆ'
                        : 'æœªæ¥å¬';
            return `[å¾®ä¿¡${isGroupCall ? 'ç¾¤' : ''}${callTypeName} - ${statusText}]`;
        }
        if (msg.type === 'poker_card') {
            const poker = msg.pokerData || {};
            const title = String(poker.title || 'å¾·å·æ‰‘å…‹ç‰Œå±€è®°å½•').trim();
            const content = String(poker.content || poker.desc || '').trim();
            const header = `[å¾·å·æ‰‘å…‹åˆ†äº«]${title ? ` ${title}` : ''}`;
            return content ? `${header}\n${content}` : header;
        }
        if (msg.type === 'werewolf_card') {
            const werewolf = msg.werewolfData || {};
            const title = String(werewolf.title || 'ç‹¼äººæ€å¤ç›˜è®°å½•').trim();
            const content = String(werewolf.content || werewolf.desc || '').trim();
            const header = `[ç‹¼äººæ€å¤ç›˜åˆ†äº«]${title ? ` ${title}` : ''}`;
            return content ? `${header}\n${content}` : header;
        }
        if (msg.type === 'undercover_card') {
            const undercover = msg.undercoverData || {};
            const title = String(undercover.title || 'è°æ˜¯å§åº•æœ¬å±€æˆ˜ç»©').trim();
            const content = String(undercover.content || undercover.desc || '').trim();
            const header = `[è°æ˜¯å§åº•æˆ˜ç»©åˆ†äº«]${title ? ` ${title}` : ''}`;
            return content ? `${header}\n${content}` : header;
        }
        if (msg.type === 'weibo_card') {
            return this._formatWeiboCardForPrompt(msg);
        }
        if (msg.type === 'x_card') {
            return this._formatXCardForPrompt(msg);
        }
        if (msg.type === 'wangxiang_task_card' || msg.type === 'wangxiang_task_confirmation' || msg.type === 'wangxiang_task_invitation') {
            return this._formatWangxiangTaskForPrompt(msg);
        }
        if (msg.type === 'music_listen') {
            return this._formatMusicListenMessageForPrompt(msg, targetChat);
        }
        if (msg.type === 'music_invite') {
            const invite = msg.musicInvite || {};
            const songName = String(invite.songName || msg.songName || '').trim() || 'æœªçŸ¥æ­Œæ›²';
            const artist = String(invite.artist || msg.artist || '').trim();
            const status = String(msg.musicInviteStatus || 'pending').trim();
            const songText = artist ? `ã€Š${songName}ã€‹ - ${artist}` : `ã€Š${songName}ã€‹`;
            if (status === 'accepted') return `${msg.from || 'å¯¹æ–¹'}é‚€è¯·ç”¨æˆ·ä¸€èµ·å¬${songText}ï¼Œç”¨æˆ·å·²æ¥å—ï¼ŒåŒæ–¹æ­£åœ¨ä¸€èµ·å¬æ­Œã€‚`;
            if (status === 'ended' || status === 'cancelled') return `${msg.from || 'å¯¹æ–¹'}é‚€è¯·ç”¨æˆ·ä¸€èµ·å¬${songText}ï¼Œç”¨æˆ·å·²æ¥å—ï¼Œä½†ç°åœ¨ä¸€èµ·å¬æ­Œå·²ç»“æŸã€‚`;
            if (status === 'rejected') return `${msg.from || 'å¯¹æ–¹'}é‚€è¯·ç”¨æˆ·ä¸€èµ·å¬${songText}ï¼Œç”¨æˆ·å·²æ‹’ç»ã€‚`;
            return `${msg.from || 'å¯¹æ–¹'}é‚€è¯·ç”¨æˆ·ä¸€èµ·å¬${songText}ï¼Œç­‰å¾…ç”¨æˆ·æ¥å—æˆ–æ‹’ç»ã€‚`;
        }
        if (msg.type === 'transfer') {
            const rawStatus = String(msg.status || '').trim();
            const status = rawStatus === 'received' ? 'å·²æ”¶æ¬¾' : (rawStatus === 'refunded' ? 'å·²é€€å›' : 'æœªæ”¶æ¬¾');
            return `[è½¬è´¦ Â¥${msg.amount}]ï¼ˆçŠ¶æ€ï¼š${status}ï¼‰`;
        }
        if (msg.type === 'redpacket') {
            const rawStatus = String(msg.status || '').trim();
            const claims = Array.isArray(msg.claims) ? msg.claims : [];
            const status = rawStatus === 'opened' ? 'å·²é¢†å–' : (rawStatus === 'refunded' ? 'å·²é€€å›' : (claims.length > 0 ? 'éƒ¨åˆ†é¢†å–' : 'æœªé¢†å–'));
            const isGroupChat = targetChat?.type === 'group';
            const packetMode = String(msg.packetMode || '').trim();
            const isGroupPacket = isGroupChat && (msg.isGroupPacket === true || packetMode === 'group_lucky' || packetMode === 'group_average');
            const recipientName = String(msg.recipientName || msg.targetName || '').trim();
            const claimText = claims.length > 0
                ? `ï¼›å·²é¢†å–ï¼š${claims.map(claim => `${claim.name || 'ç¾¤æˆå‘˜'} Â¥${claim.amount || '0.00'}`).join('ã€')}`
                : '';
            if (isGroupPacket) return `[ç¾¤çº¢åŒ…]ï¼ˆçŠ¶æ€ï¼š${status}${claimText}ï¼‰`;
            if (isGroupChat && recipientName) return `[ç»™${recipientName}çš„çº¢åŒ… Â¥${msg.amount}]ï¼ˆçŠ¶æ€ï¼š${status}ï¼‰`;
            return `[çº¢åŒ… Â¥${msg.amount}]ï¼ˆçŠ¶æ€ï¼š${status}ï¼‰`;
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
        const songName = String(musicInfo.songName || savedInfo.songName || activeSession?.songName || '').trim() || 'æœªçŸ¥æ­Œæ›²';
        const artist = String(musicInfo.artist || savedInfo.artist || activeSession?.artist || '').trim();
        const otherName = String(
            activeSession?.contactName
            || savedInfo.contactName
            || chat?.name
            || this.app?.wechatData?.getContact?.(activeSession?.contactId)?.name
            || 'å¯¹æ–¹'
        ).trim();
        const songText = artist ? `ã€Š${songName}ã€‹ - ${artist}` : `ã€Š${songName}ã€‹`;
        const currentSeconds = Number(musicInfo.currentTime);
        const durationSeconds = Number(musicInfo.duration);
        const hasCurrentTime = Number.isFinite(currentSeconds) && currentSeconds >= 0;
        const progress = hasCurrentTime
            ? `ï¼Œå½“å‰æ’­æ”¾åˆ° ${this._formatMusicListenTime(currentSeconds)}${Number.isFinite(durationSeconds) && durationSeconds > 0 ? ` / ${this._formatMusicListenTime(durationSeconds)}` : ''}`
            : '';
        const listenStatus = String(msg.musicListenStatus || '').trim();
        const isEnded = listenStatus === 'ended' || listenStatus === 'cancelled' || (!activeSession && msg.type === 'music_listen');

        if (isEnded) {
            if (msg.from === 'me') {
                return `ç”¨æˆ·æ›¾é‚€è¯·â€œ${otherName}â€ä¸€èµ·å¬æ­Œï¼Œæ­Œæ›²æ˜¯${songText}ï¼Œä½†ç°åœ¨ä¸€èµ·å¬æ­Œå·²ç»“æŸã€‚`;
            }
            return `${otherName}æ›¾å‘èµ·ä¸€èµ·å¬æ­Œé‚€è¯·ï¼Œæ­Œæ›²æ˜¯${songText}ï¼Œä½†ç°åœ¨ä¸€èµ·å¬æ­Œå·²ç»“æŸã€‚`;
        }

        if (msg.from === 'me') {
            return `ç”¨æˆ·é‚€è¯·äº†â€œ${otherName}â€ä¸€èµ·å¬æ­Œã€‚å½“å‰æ­£åœ¨ä¸€èµ·å¬${songText}${progress}ã€‚`;
        }
        return `${otherName}å‘èµ·äº†ä¸€èµ·å¬æ­Œé‚€è¯·ã€‚å½“å‰æ­£åœ¨ä¸€èµ·å¬${songText}${progress}ã€‚`;
    }

    _normalizeImagePromptDisplayFields(msg = {}) {
        const fallback = 'å¾…ç”Ÿæˆå›¾ç‰‡';
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
        return /^\s*\[(?:ç”¨æˆ·ç…§ç‰‡|ä¸ªäººå›¾ç‰‡|å›¾ç‰‡|è§†é¢‘)\]/i.test(String(value || '').trim())
            || /^\s*[ï¼ˆ(][\s\S]+[ï¼‰)]\s*[ï¼ˆ(][\s\S]+[ï¼‰)]\s*$/.test(String(value || '').trim());
    }

    _parseImagePromptText(rawValue = '') {
        const parsed = parseImagePromptDescriptionPair(rawValue);
        return {
            description: parsed.description,
            prompt: parsed.prompt
        };
    }

    _readBracketGroupAt(value = '', startIndex = 0) {
        return readBalancedImagePromptGroup(value, startIndex);
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
        const mediaType = msg.useUserReference ? 'ç”¨æˆ·ç…§ç‰‡' : (msg.usePersonalReference ? 'ä¸ªäººå›¾ç‰‡' : (msg.mediaType || 'å›¾ç‰‡'));
        const promptText = String(msg.imagePrompt || msg.content || 'å¾…ç”Ÿæˆå›¾ç‰‡').trim() || 'å¾…ç”Ÿæˆå›¾ç‰‡';
        const descriptionText = String(msg.imageDescription || '').trim();
        if (descriptionText && descriptionText !== promptText) {
            return `[${mediaType}]ï¼ˆ${descriptionText}ï¼‰ï¼ˆ${promptText}ï¼‰`;
        }
        return `[${mediaType}]ï¼ˆ${promptText}ï¼‰`;
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
            console.error('åŠ è½½éŸ³ä¹æ’­æ”¾å™¨å¤±è´¥:', error);
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
            this.app.phoneShell?.showNotification('éŸ³ä¹', 'è¿™é¦–æ­Œæš‚æ—¶æ— æ³•æ’­æ”¾', 'âš ï¸');
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
            content: `å·²æ¥å—ä¸€èµ·å¬ã€Š${resolvedSongName}ã€‹${resolvedArtist ? ` - ${resolvedArtist}` : ''}`,
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
        const songName = String(invite.songName || message.songName || '').trim() || 'è¿™é¦–æ­Œ';
        const artist = String(invite.artist || message.artist || '').trim();
        this.app.wechatData.updateMessageById(chatId, messageId, {
            musicInviteStatus: 'rejected',
            content: `å·²æ‹’ç»ä¸€èµ·å¬ã€Š${songName}ã€‹${artist ? ` - ${artist}` : ''}`
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
        const voiceLabel = isGroupChat ? 'ç¾¤è¯­éŸ³' : 'è¯­éŸ³';
        const videoLabel = isGroupChat ? 'ç¾¤è§†é¢‘' : 'è§†é¢‘';
        return `
        <div class="more-panel">
            <div class="more-grid">
                <!-- ç¬¬ä¸€æ’ï¼šå›¾ç‰‡ã€æˆªå›¾ã€èœœè¯­ã€é€šè¯ -->
                <div class="more-item" data-action="image">
                    <div class="more-icon">
                        <i class="fa-solid fa-image" style="font-size: 14px;"></i>
                    </div>
                    <div class="more-name">å›¾ç‰‡</div>
                </div>

                <div class="more-item" data-action="screenshot">
                    <div class="more-icon">
                        <i class="fa-solid fa-camera-retro" style="font-size: 14px;"></i>
                    </div>
                    <div class="more-name">æˆªå›¾</div>
                </div>

                <div class="more-item" data-action="honey">
                    <div class="more-icon">
                        <i class="fa-solid fa-heart" style="font-size: 14px;"></i>
                    </div>
                    <div class="more-name">èœœè¯­</div>
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

                <!-- ç¬¬äºŒæ’ï¼šè½¬è´¦ã€çº¢åŒ… -->
                <div class="more-item" data-action="file">
                    <div class="more-icon"><i class="fa-solid fa-folder" style="font-size: 14px;"></i></div>
                    <div class="more-name">æ–‡ä»¶</div>
                </div>
                <div class="more-item" data-action="transfer">
                    <div class="more-icon">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M3 8l5-5v3h13v4H8v3L3 8Z"/>
                            <path d="M21 16l-5 5v-3H3v-4h13v-3l5 5Z"/>
                        </svg>
                    </div>
                    <div class="more-name">è½¬è´¦</div>
                </div>
                <div class="more-item" data-action="redpacket">
                    <div class="more-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M5 8V6.5C5 4.6 6.6 3 8.5 3h7C17.4 3 19 4.6 19 6.5V8l-7 4.6L5 8Z"/>
                            <path d="M5 9.2 12 14l7-4.8V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V9.2Z"/>
                            <circle cx="12" cy="13.2" r="1.7" fill="#fff"/>
                        </svg>
                    </div>
                    <div class="more-name">çº¢åŒ…</div>
                </div>
            </div>
            <!-- éšè—çš„æ–‡ä»¶ä¸Šä¼ inputï¼ˆç›¸å†Œç”¨ï¼Œä¸å¸¦captureï¼‰ -->
            <input type="file" id="photo-upload-input" accept="image/png, image/jpeg, image/gif, image/webp, image/*" style="display: none;">
            <!-- éšè—çš„æ‹ç…§inputï¼ˆå¸¦captureè°ƒç”¨æ‘„åƒå¤´ï¼‰ -->
            <input type="file" id="camera-upload-input" accept="image/png, image/jpeg, image/gif, image/webp, image/*" capture="environment" style="display: none;">
            <div class="wechat-image-source-sheet" id="wechat-image-source-sheet" style="display:none; position:absolute; left:10px; right:10px; bottom:8px; z-index:50;">
                <div style="background:rgba(255,255,255,0.96); border:0.5px solid rgba(0,0,0,0.08); border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,0.16); overflow:hidden;">
                    <button class="wechat-image-source-btn" data-source="photo" style="width:100%; height:44px; border:none; border-bottom:0.5px solid rgba(0,0,0,0.08); background:transparent; color:#111; font-size:14px; display:flex; align-items:center; justify-content:center; gap:8px;">
                        <i class="fa-solid fa-image" style="font-size:14px;"></i><span>ä»ç›¸å†Œé€‰æ‹©</span>
                    </button>
                    <button class="wechat-image-source-btn" data-source="camera" style="width:100%; height:44px; border:none; background:transparent; color:#111; font-size:14px; display:flex; align-items:center; justify-content:center; gap:8px;">
                        <i class="fa-solid fa-camera" style="font-size:14px;"></i><span>è°ƒç”¨æ‘„åƒå¤´</span>
                    </button>
                </div>
            </div>
        </div>
    `;
    }

    _getQuickReplyItems() {
        return [
            { key: 'image', icon: 'fa-solid fa-image', label: 'å›¾ç‰‡', template: '[å›¾ç‰‡]ï¼ˆæè¿°ï¼‰' },
            { key: 'video', icon: 'fa-solid fa-video', label: 'è§†é¢‘', template: '[è§†é¢‘]ï¼ˆæè¿°ï¼‰' },
            { key: 'sticker', icon: 'fa-regular fa-face-smile', label: 'è¡¨æƒ…åŒ…', template: '[è¡¨æƒ…åŒ…]ï¼ˆæè¿°ï¼‰' },
            { key: 'voice-strip', icon: 'fa-solid fa-microphone-lines', label: 'è¯­éŸ³æ¡', template: '[è¯­éŸ³æ¡]ï¼ˆæè¿°ï¼‰' },
            { key: 'location', icon: 'fa-solid fa-location-dot', label: 'å®šä½', template: '[å®šä½]ï¼ˆæè¿°ï¼‰' },
            { key: 'time', icon: 'fa-regular fa-clock', label: 'æ—¶é—´æ¨è¿›', template: '[æ—¶é—´æ¨è¿›ï¼šå¹´æœˆæ—¥HH:MM]' }
        ];
    }

    _getQuickReplyConfig(key = '') {
        return this._getQuickReplyItems().find(item => item.key === key) || null;
    }

    _getQuickReplyInputPlaceholder() {
        const config = this._getQuickReplyConfig(this.activeQuickReplyKey);
        if (!this.showQuickReplies || !config) return 'è¾“å…¥æ¶ˆæ¯...';
        if (config.key === 'image') return 'æè¿°æƒ³å‘é€çš„å›¾ç‰‡å†…å®¹...';
        if (config.key === 'video') return 'æè¿°æƒ³å‘é€çš„è§†é¢‘å†…å®¹...';
        if (config.key === 'sticker') return 'è¾“å…¥è¡¨æƒ…åŒ…å…³é”®è¯æˆ–æè¿°...';
        if (config.key === 'voice-strip') return 'è¾“å…¥è¦è½¬æˆè¯­éŸ³çš„æ–‡å­—...';
        if (config.key === 'location') return 'è¾“å…¥å®šä½åç§°æˆ–åœ°å€...';
        if (config.key === 'time') return 'è¾“å…¥ç›®æ ‡æ—¶é—´...';
        return 'è¾“å…¥æ¶ˆæ¯...';
    }

    _getQuickReplyDefaultTimeText() {
        const storyTime = window.VirtualPhone?.timeManager?.getCurrentStoryTime?.() || {};
        const date = String(storyTime.date || '').trim();
        const weekday = String(storyTime.weekday || '').trim();
        const time = String(storyTime.time || '').trim();
        if (date || time) return [date, weekday, time].filter(Boolean).join(' ');

        const now = new Date();
        const pad = value => String(value).padStart(2, '0');
        const weekdays = ['æ˜ŸæœŸæ—¥', 'æ˜ŸæœŸä¸€', 'æ˜ŸæœŸäºŒ', 'æ˜ŸæœŸä¸‰', 'æ˜ŸæœŸå››', 'æ˜ŸæœŸäº”', 'æ˜ŸæœŸå…­'];
        return `${now.getFullYear()}å¹´${pad(now.getMonth() + 1)}æœˆ${pad(now.getDate())}æ—¥ ${weekdays[now.getDay()]} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }

    _makeDateFromQuickReplyParts(parts = {}) {
        const date = new Date(0);
        date.setFullYear(Number(parts.year) || 2000, Math.max(0, (Number(parts.month) || 1) - 1), Number(parts.day) || 1);
        date.setHours(Number(parts.hour) || 0, Number(parts.minute) || 0, 0, 0);
        return date;
    }

    _getQuickReplyWeekday(parts = {}) {
        const dateText = `${Number(parts.year) || 2000}å¹´${Number(parts.month) || 1}æœˆ${Number(parts.day) || 1}æ—¥`;
        const calculated = window.VirtualPhone?.timeManager?.calculateWeekday?.(dateText);
        if (calculated) return calculated;
        const date = this._makeDateFromQuickReplyParts(parts);
        const weekdays = ['æ˜ŸæœŸæ—¥', 'æ˜ŸæœŸä¸€', 'æ˜ŸæœŸäºŒ', 'æ˜ŸæœŸä¸‰', 'æ˜ŸæœŸå››', 'æ˜ŸæœŸäº”', 'æ˜ŸæœŸå…­'];
        return weekdays[date.getDay()] || '';
    }

    _shiftQuickReplyWeekday(weekday = '', offsetDays = 0) {
        const weekdays = ['æ˜ŸæœŸæ—¥', 'æ˜ŸæœŸä¸€', 'æ˜ŸæœŸäºŒ', 'æ˜ŸæœŸä¸‰', 'æ˜ŸæœŸå››', 'æ˜ŸæœŸäº”', 'æ˜ŸæœŸå…­'];
        const normalized = String(weekday || '').replace('æ˜ŸæœŸå¤©', 'æ˜ŸæœŸæ—¥').trim();
        const index = weekdays.indexOf(normalized);
        if (index < 0) return '';
        const nextIndex = ((index + Number(offsetDays || 0)) % 7 + 7) % 7;
        return weekdays[nextIndex] || '';
    }

    _parseQuickReplyTimeParts(text = '') {
        const fallback = this._getQuickReplyDefaultTimeText();
        const source = String(text || fallback || '').trim();
        const match = source.match(/(\d{1,6})å¹´\s*(\d{1,2})æœˆ\s*(\d{1,2})æ—¥(?:\s*(æ˜ŸæœŸ[ä¸€äºŒä¸‰å››äº”å…­æ—¥å¤©]))?\s*(\d{1,2})[:ï¼š](\d{1,2})/);
        const raw = match ? match : String(fallback || '').match(/(\d{1,6})å¹´\s*(\d{1,2})æœˆ\s*(\d{1,2})æ—¥(?:\s*(æ˜ŸæœŸ[ä¸€äºŒä¸‰å››äº”å…­æ—¥å¤©]))?\s*(\d{1,2})[:ï¼š](\d{1,2})/);
        if (!raw) {
            const now = new Date();
            return {
                year: now.getFullYear(),
                month: now.getMonth() + 1,
                day: now.getDate(),
                weekday: this._getQuickReplyWeekday({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }),
                hour: now.getHours(),
                minute: now.getMinutes()
            };
        }
        const parts = {
            year: Number.parseInt(raw[1], 10) || 2000,
            month: Number.parseInt(raw[2], 10) || 1,
            day: Number.parseInt(raw[3], 10) || 1,
            weekday: String(raw[4] || '').replace('æ˜ŸæœŸå¤©', 'æ˜ŸæœŸæ—¥'),
            hour: Math.max(0, Math.min(23, Number.parseInt(raw[5], 10) || 0)),
            minute: Math.max(0, Math.min(59, Number.parseInt(raw[6], 10) || 0))
        };
        if (!parts.weekday) parts.weekday = this._getQuickReplyWeekday(parts);
        return parts;
    }

    _formatQuickReplyTimeParts(parts = {}) {
        const pad = value => String(Math.max(0, Number(value) || 0)).padStart(2, '0');
        const fullParts = {
            year: Number(parts.year) || 2000,
            month: Number(parts.month) || 1,
            day: Number(parts.day) || 1,
            weekday: parts.weekday || this._getQuickReplyWeekday(parts),
            hour: Math.max(0, Math.min(23, Number(parts.hour) || 0)),
            minute: Math.max(0, Math.min(59, Number(parts.minute) || 0))
        };
        return `${fullParts.year}å¹´${pad(fullParts.month)}æœˆ${pad(fullParts.day)}æ—¥ ${fullParts.weekday} ${pad(fullParts.hour)}:${pad(fullParts.minute)}`;
    }

    _offsetQuickReplyDateParts(parts = {}, offsetDays = 0) {
        const date = this._makeDateFromQuickReplyParts(parts);
        date.setDate(date.getDate() + Number(offsetDays || 0));
        const next = {
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            day: date.getDate(),
            hour: Number(parts.hour) || 0,
            minute: Number(parts.minute) || 0
        };
        next.weekday = this._shiftQuickReplyWeekday(parts.weekday, offsetDays) || this._getQuickReplyWeekday(next);
        return next;
    }

    _extractQuickReplyPayload(text = '', key = '') {
        const raw = String(text || '').trim();
        if (!raw) return '';
        const map = {
            image: 'å›¾ç‰‡',
            video: 'è§†é¢‘',
            sticker: 'è¡¨æƒ…åŒ…',
            'voice-strip': 'è¯­éŸ³æ¡',
            location: 'å®šä½'
        };
        const label = map[key];
        if (label) {
            const match = new RegExp(`^\\[${label}\\]\\s*[ï¼ˆ(]\\s*([\\s\\S]*?)\\s*[ï¼‰)]$`).exec(raw);
            if (match) return String(match[1] || '').trim();
        }
        const timeMatch = /^\[\s*æ—¶é—´æ¨è¿›\s*[ï¼š:]\s*([^\]]+?)\s*\]$/.exec(raw);
        if (key === 'time' && timeMatch) return String(timeMatch[1] || '').trim();
        return raw;
    }

    _buildQuickReplySendText(text = '', key = this.activeQuickReplyKey) {
        const payload = this._extractQuickReplyPayload(text, key);
        if (!payload) return '';
        switch (key) {
            case 'image':
                return `[å›¾ç‰‡]ï¼ˆ${payload}ï¼‰`;
            case 'video':
                return `[è§†é¢‘]ï¼ˆ${payload}ï¼‰`;
            case 'sticker':
                return `[è¡¨æƒ…åŒ…]ï¼ˆ${payload}ï¼‰`;
            case 'voice-strip':
                return `[è¯­éŸ³æ¡]ï¼ˆ${payload}ï¼‰`;
            case 'location':
                return `[å®šä½]ï¼ˆ${payload}ï¼‰`;
            case 'time':
                return `[æ—¶é—´æ¨è¿›ï¼š${payload}]`;
            default:
                return payload;
        }
    }

    _resolveQuickReplySendText(text = '') {
        const key = String(this.activeQuickReplyKey || '').trim();
        if (!this.showQuickReplies || !this._getQuickReplyConfig(key)) return String(text || '').trim();
        return this._buildQuickReplySendText(text, key);
    }

    _activateQuickReply(key = '') {
        const config = this._getQuickReplyConfig(key);
        if (!config) return;
        const currentInput = this.getCurrentWechatView?.().querySelector('#chat-input') || document.getElementById('chat-input');
        const source = String(currentInput?.value ?? this.inputText ?? '');
        this.activeQuickReplyKey = config.key;
        this.showQuickReplies = true;
        this.showEmoji = false;
        this.showMore = false;
        this._setCustomEmojiSelectionMode(false);
        if (config.key === 'time') {
            if (!String(this.quickReplyTimeText || '').trim()) {
                this.quickReplyTimeText = this._getQuickReplyDefaultTimeText();
            }
            this.app.render();
            setTimeout(() => this._scrollQuickReplyTimeSelectionIntoView(), 0);
            return;
        }
        this.inputText = this._extractQuickReplyPayload(source, config.key);
        this.app.render();
        setTimeout(() => {
            const input = this.getCurrentWechatView?.().querySelector('#chat-input') || document.getElementById('chat-input');
            if (!input) return;
            input.focus();
            const end = input.value.length;
            if (typeof input.setSelectionRange === 'function') input.setSelectionRange(end, end);
            this._syncChatSendButton(input);
        }, 0);
    }

    _sendActiveQuickReply() {
        const currentView = this.getCurrentWechatView ? this.getCurrentWechatView() : document;
        const input = currentView.querySelector('#chat-input') || document.getElementById('chat-input');
        if (!input) return;
        if (this.activeQuickReplyKey === 'time') {
            const targetChatId = String(this.app?.currentChat?.id || '').trim();
            const timeText = String(this.quickReplyTimeText || this._getQuickReplyDefaultTimeText()).trim();
            if (!targetChatId || !timeText) return;
            const markerText = this._buildQuickReplySendText(timeText, 'time');
            if (this._handleManualTimeAdvance(input, markerText, targetChatId, { preserveDraft: true })) {
                this._suppressEmptySendUntil = Date.now() + 650;
                this.showQuickReplies = false;
                this.activeQuickReplyKey = '';
                this.quickReplyTimeText = '';
                this.app.render();
            }
            return;
        }
        if (!String(input.value || '').trim()) {
            this.app.phoneShell?.showNotification?.('æç¤º', 'è¯·å…ˆè¾“å…¥å†…å®¹', 'âš ï¸');
            return;
        }
        this.handleSendClick(input);
    }

    _setQuickReplyInputText(value = '') {
        const next = String(value || '').trim();
        this.inputText = next;
        const currentView = this.getCurrentWechatView ? this.getCurrentWechatView() : document;
        const input = currentView.querySelector('#chat-input') || document.getElementById('chat-input');
        if (input) input.value = next;
        currentView.querySelectorAll('.quick-reply-live-text').forEach(el => {
            el.textContent = next || this._getQuickReplyInputPlaceholder();
        });
        this._syncChatSendButton(input);
    }

    _setQuickReplyTimeText(value = '') {
        const next = String(value || '').trim();
        this.quickReplyTimeText = next;
        const currentView = this.getCurrentWechatView ? this.getCurrentWechatView() : document;
        currentView.querySelectorAll('.quick-reply-live-text').forEach(el => {
            el.textContent = next || this._getQuickReplyDefaultTimeText();
        });
    }

    _refreshQuickReplyTimePanel(parts = null) {
        const currentView = this.getCurrentWechatView ? this.getCurrentWechatView() : document;
        const nextParts = parts || this._parseQuickReplyTimeParts(this.quickReplyTimeText || this._getQuickReplyDefaultTimeText());
        const selectedDateKey = `${nextParts.year}-${nextParts.month}-${nextParts.day}`;

        currentView.querySelectorAll('.quick-time-option').forEach(option => {
            const part = String(option.dataset.timePart || '').trim();
            let isSelected = false;
            if (part === 'date') {
                const optionDateKey = `${option.dataset.year}-${option.dataset.month}-${option.dataset.day}`;
                isSelected = optionDateKey === selectedDateKey;
            } else if (part === 'hour') {
                isSelected = Number.parseInt(option.dataset.value || '-1', 10) === nextParts.hour;
            } else if (part === 'minute') {
                isSelected = Number.parseInt(option.dataset.value || '-1', 10) === nextParts.minute;
            }

            option.style.background = isSelected ? 'rgba(31,122,255,0.1)' : 'transparent';
            option.style.color = isSelected ? '#1f7aff' : '#aeb4bd';
            option.style.fontWeight = isSelected ? '700' : '500';
            option.dataset.selected = isSelected ? 'true' : 'false';
            option.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        });
    }

    _clearQuickReplyTimeScrollTimers() {
        if (!this._quickTimeScrollTimers) return;
        this._quickTimeScrollTimers.forEach(timer => clearTimeout(timer));
        this._quickTimeScrollTimers.clear();
    }

    _handleQuickReplyTimeOption(optionEl) {
        if (!optionEl) return;
        const part = String(optionEl.dataset.timePart || '').trim();
        const parts = this._parseQuickReplyTimeParts(this.quickReplyTimeText || this._getQuickReplyDefaultTimeText());
        if (part === 'date') {
            parts.year = Number.parseInt(optionEl.dataset.year || parts.year, 10) || parts.year;
            parts.month = Number.parseInt(optionEl.dataset.month || parts.month, 10) || parts.month;
            parts.day = Number.parseInt(optionEl.dataset.day || parts.day, 10) || parts.day;
            parts.weekday = String(optionEl.dataset.weekday || '') || this._getQuickReplyWeekday(parts);
        } else if (part === 'hour') {
            parts.hour = Math.max(0, Math.min(23, Number.parseInt(optionEl.dataset.value || parts.hour, 10) || 0));
        } else if (part === 'minute') {
            parts.minute = Math.max(0, Math.min(59, Number.parseInt(optionEl.dataset.value || parts.minute, 10) || 0));
        }
        this._setQuickReplyTimeText(this._formatQuickReplyTimeParts(parts));
        this._refreshQuickReplyTimePanel(parts);
    }

    _getCenteredQuickTimeOption(columnEl) {
        if (!columnEl) return null;
        const options = Array.from(columnEl.querySelectorAll('.quick-time-option'));
        if (options.length === 0) return null;
        const columnRect = columnEl.getBoundingClientRect();
        const centerY = columnRect.top + columnRect.height / 2;
        let best = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        options.forEach(option => {
            const rect = option.getBoundingClientRect();
            const optionCenter = rect.top + rect.height / 2;
            const distance = Math.abs(optionCenter - centerY);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = option;
            }
        });
        return best;
    }

    _handleQuickReplyTimeColumnScroll(columnEl) {
        if (!columnEl) return;
        const key = String(columnEl.dataset.timeColumn || Math.random());
        if (this._quickTimeScrollTimers.has(key)) {
            clearTimeout(this._quickTimeScrollTimers.get(key));
        }
        const timer = setTimeout(() => {
            this._quickTimeScrollTimers.delete(key);
            const centered = this._getCenteredQuickTimeOption(columnEl);
            if (centered) this._handleQuickReplyTimeOption(centered);
        }, 140);
        this._quickTimeScrollTimers.set(key, timer);
    }

    _scrollQuickReplyTimeSelectionIntoView() {
        const currentView = this.getCurrentWechatView ? this.getCurrentWechatView() : document;
        currentView.querySelectorAll('.quick-time-column').forEach(column => {
            const selected = column.querySelector('.quick-time-option[data-selected="true"], .quick-time-option[aria-selected="true"], .quick-time-option[style*="font-weight:700"]');
            if (!selected) return;
            const top = selected.offsetTop - Math.max(0, (column.clientHeight - selected.clientHeight) / 2);
            column.scrollTop = Math.max(0, top);
        });
    }

    renderQuickReplyPanel() {
        const items = this._getQuickReplyItems();
        const activeKey = this.activeQuickReplyKey || 'image';
        const active = this._getQuickReplyConfig(activeKey) || items[0];
        const isTime = active.key === 'time';
        const inputText = active.key === 'time'
            ? (String(this.quickReplyTimeText || '').trim() || this._getQuickReplyDefaultTimeText())
            : this._extractQuickReplyPayload(this.inputText, active.key);
        const safeInputText = this._escapeHtml(inputText);
        const quickPreview = (() => {
            if (active.key === 'video') {
                return `<div style="width:58px;height:58px;border-radius:10px;overflow:hidden;background:linear-gradient(160deg,#f3b37b,#7895c9);display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.4);"><span style="width:26px;height:26px;border-radius:50%;border:2px solid rgba(255,255,255,0.9);display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-play" style="font-size:10px;margin-left:2px;"></i></span></div>`;
            }
            if (active.key === 'sticker') {
                return `<div style="width:58px;height:58px;border-radius:14px;background:linear-gradient(145deg,#fff7d6,#e9f3ff);display:flex;align-items:center;justify-content:center;color:#ff9f0a;font-size:25px;border:0.5px solid rgba(0,0,0,0.06);"><i class="fa-regular fa-face-laugh-beam"></i></div>`;
            }
            if (active.key === 'voice-strip') {
                return `<div style="height:34px;border-radius:17px;background:linear-gradient(90deg,#eef5ff,#f8fbff);display:flex;align-items:center;gap:7px;padding:0 9px;color:#2f80ff;border:0.5px solid rgba(47,128,255,0.08);"><span style="width:24px;height:24px;border-radius:50%;background:#e3f0ff;display:flex;align-items:center;justify-content:center;font-size:12px;"><i class="fa-solid fa-microphone"></i></span><span style="flex:1;height:20px;background:repeating-linear-gradient(90deg,#2f80ff 0 2px,transparent 2px 7px);opacity:.75;border-radius:10px;clip-path:polygon(0 40%,4% 25%,8% 60%,12% 20%,16% 70%,20% 35%,24% 55%,28% 15%,32% 78%,36% 32%,40% 48%,44% 28%,48% 68%,52% 40%,56% 55%,60% 18%,64% 76%,68% 38%,72% 58%,76% 26%,80% 66%,84% 36%,88% 52%,92% 30%,96% 58%,100% 42%);"></span><span style="font-size:10px;color:#8b96a8;">00:00</span></div>`;
            }
            if (active.key === 'location') {
                return `<div style="width:58px;height:58px;border-radius:11px;background:linear-gradient(145deg,#eef6ff,#f8fbff);display:flex;align-items:center;justify-content:center;color:#1f7aff;border:0.5px solid rgba(0,0,0,0.06);"><i class="fa-solid fa-location-dot" style="font-size:25px;"></i></div>`;
            }
            return `<div style="width:58px;height:58px;border-radius:10px;background:linear-gradient(145deg,#eef6ff,#f8fbff);position:relative;overflow:hidden;border:0.5px solid rgba(0,0,0,0.06);"><div style="position:absolute;left:0;right:0;bottom:0;height:36px;background:linear-gradient(135deg,#9ecbff,#d6eaff);clip-path:polygon(0 100%,32% 36%,54% 66%,76% 30%,100% 72%,100% 100%);"></div><div style="position:absolute;right:12px;top:12px;width:16px;height:16px;border-radius:50%;background:#b7d9ff;"></div></div>`;
        })();
        const timeParts = this._parseQuickReplyTimeParts(inputText);
        const selectedDateKey = `${timeParts.year}-${timeParts.month}-${timeParts.day}`;
        const selectedStyle = 'background:rgba(31,122,255,0.1);color:#1f7aff;font-weight:700;';
        const normalStyle = 'background:transparent;color:#aeb4bd;font-weight:500;';
        const dateOptionsHtml = Array.from({ length: 15 }, (_, index) => {
            const offset = index - 7;
            const parts = this._offsetQuickReplyDateParts(timeParts, offset);
            const key = `${parts.year}-${parts.month}-${parts.day}`;
            const isSelected = key === selectedDateKey;
            const label = `${parts.month}æœˆ${parts.day}æ—¥ ${parts.weekday || ''}`;
            return `<button type="button" class="quick-time-option" data-time-part="date" data-year="${parts.year}" data-month="${parts.month}" data-day="${parts.day}" data-weekday="${this._escapeHtml(parts.weekday || '')}" data-selected="${isSelected ? 'true' : 'false'}" aria-selected="${isSelected ? 'true' : 'false'}" style="height:24px;border:none;border-radius:7px;${isSelected ? selectedStyle : normalStyle}font-size:12px;white-space:nowrap;">${this._escapeHtml(label)}</button>`;
        }).join('');
        const hourOptionsHtml = Array.from({ length: 24 }, (_, hour) => {
            const isSelected = hour === timeParts.hour;
            return `<button type="button" class="quick-time-option" data-time-part="hour" data-value="${hour}" data-selected="${isSelected ? 'true' : 'false'}" aria-selected="${isSelected ? 'true' : 'false'}" style="height:24px;border:none;border-radius:7px;${isSelected ? selectedStyle : normalStyle}font-size:12px;">${String(hour).padStart(2, '0')}</button>`;
        }).join('');
        const minuteOptionsHtml = Array.from({ length: 60 }, (_, minute) => {
            const isSelected = minute === timeParts.minute;
            return `<button type="button" class="quick-time-option" data-time-part="minute" data-value="${minute}" data-selected="${isSelected ? 'true' : 'false'}" aria-selected="${isSelected ? 'true' : 'false'}" style="height:24px;border:none;border-radius:7px;${isSelected ? selectedStyle : normalStyle}font-size:12px;">${String(minute).padStart(2, '0')}</button>`;
        }).join('');

        const timePanel = `
            <div style="text-align:center;padding:10px 10px 9px;">
                <div style="font-size:15px;font-weight:700;color:#111;line-height:1.25;">æ—¶é—´æ¨è¿›</div>
                <div style="font-size:10px;color:#9ca3af;margin-top:1px;">é€‰æ‹©ç›®æ ‡æ—¶é—´</div>
                <div class="quick-reply-live-text" style="margin:6px auto 8px;max-width:238px;height:32px;border-radius:8px;background:rgba(245,249,255,0.92);border:0.5px solid rgba(47,128,255,0.18);display:flex;align-items:center;justify-content:center;color:#1f7aff;font-size:14px;font-weight:600;">${safeInputText || this._escapeHtml(this._getQuickReplyDefaultTimeText())}</div>
                <div style="margin:0 auto 8px;max-width:282px;height:76px;border-radius:13px;background:rgba(255,255,255,0.72);border:0.5px solid rgba(0,0,0,0.07);display:grid;grid-template-columns:1.15fr 0.72fr 0.72fr;align-items:stretch;color:#aeb4bd;font-size:11px;overflow:hidden;position:relative;">
                    <div class="quick-time-column" data-time-column="date" style="display:flex;flex-direction:column;gap:3px;overflow-y:auto;padding:27px 5px;scrollbar-width:none;touch-action:pan-y;overscroll-behavior:contain;">${dateOptionsHtml}</div>
                    <div class="quick-time-column" data-time-column="hour" style="display:flex;flex-direction:column;gap:3px;overflow-y:auto;padding:27px 5px;border-left:0.5px solid #e5eaf2;border-right:0.5px solid #e5eaf2;scrollbar-width:none;touch-action:pan-y;overscroll-behavior:contain;">${hourOptionsHtml}</div>
                    <div class="quick-time-column" data-time-column="minute" style="display:flex;flex-direction:column;gap:3px;overflow-y:auto;padding:27px 5px;scrollbar-width:none;touch-action:pan-y;overscroll-behavior:contain;">${minuteOptionsHtml}</div>
                </div>
                <div style="display:flex;justify-content:center;gap:10px;padding-top:1px;">
                    <button type="button" class="quick-reply-cancel" style="width:72px;height:28px;border:none;border-radius:9px;background:rgba(245,245,247,0.96);color:#111;font-size:12px;font-weight:600;">å–æ¶ˆ</button>
                    <button type="button" class="quick-reply-send" style="width:82px;height:28px;border:none;border-radius:9px;background:#1f7aff;color:#fff;font-size:12px;font-weight:600;">ç¡®å®š</button>
                </div>
            </div>
        `;

        const mediaPanel = `
            <div style="padding:10px 10px 11px;">
                <div style="font-size:15px;font-weight:700;color:#111;margin:0 0 6px 0;">å‘é€${this._escapeHtml(active.label)}</div>
                <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:stretch;">
                    <div class="quick-reply-live-text" style="min-height:58px;max-height:58px;overflow:hidden;border-radius:10px;background:rgba(255,255,255,0.7);border:0.5px solid rgba(0,0,0,0.1);box-shadow:0 1px 4px rgba(0,0,0,0.04);padding:9px;color:#9ca3af;font-size:12px;line-height:1.4;">${safeInputText || this._escapeHtml(this._getQuickReplyInputPlaceholder())}</div>
                    <div style="display:flex;align-items:center;justify-content:center;">${quickPreview}</div>
                </div>
            </div>
        `;

        return `
        <div class="quick-reply-panel" style="padding:6px 10px 7px;background:transparent;display:flex;flex-direction:column;gap:9px;touch-action:pan-y;overscroll-behavior:contain;">
            <div class="quick-reply-editor-card" style="background:rgba(255,255,255,0.94);backdrop-filter:blur(28px) saturate(180%);-webkit-backdrop-filter:blur(28px) saturate(180%);border:0.5px solid rgba(255,255,255,0.76);border-radius:18px;box-shadow:0 7px 20px rgba(0,0,0,0.09);overflow:hidden;">
                ${isTime ? timePanel : mediaPanel}
            </div>
            <div class="quick-reply-shortcut-card" style="display:grid; grid-template-columns:repeat(6, minmax(0, 1fr)); gap:6px; padding:7px 4px 3px; background:rgba(255,255,255,0.86);backdrop-filter:blur(22px) saturate(170%);-webkit-backdrop-filter:blur(22px) saturate(170%);border:0.5px solid rgba(255,255,255,0.72);border-radius:15px;box-shadow:0 4px 14px rgba(0,0,0,0.06);">
                ${items.map(item => `
                    <button class="quick-reply-item" data-quick-key="${this._escapeHtml(item.key)}" title="${item.template}" style="
                        min-width:0;
                        border:none;
                        background:transparent;
                        padding:0;
                        display:flex;
                        flex-direction:column;
                        align-items:center;
                        gap:3px;
                        color:${item.key === active.key ? '#1f7aff' : '#555'};
                        cursor:pointer;
                    ">
                        <span style="width:32px; height:32px; border-radius:10px; background:${item.key === active.key ? 'rgba(31,122,255,0.1)' : 'rgba(255,255,255,0.9)'}; border:${item.key === active.key ? '0.5px solid rgba(31,122,255,0.65)' : '0.5px solid rgba(255,255,255,0.7)'}; box-shadow:0 1px 5px rgba(0,0,0,0.08); display:flex; align-items:center; justify-content:center;">
                            <i class="${item.icon}" style="font-size:13px;"></i>
                        </span>
                        <span style="font-size:9px; line-height:1.05; color:${item.key === active.key ? '#1f7aff' : '#666'}; white-space:nowrap;">${item.label}</span>
                    </button>
                `).join('')}
            </div>
        </div>
    `;
    }

    parseEmoji(text) {
        let result = this._escapeHtml(text);
        result = replacePhoneInlineEmojiTokens(result, {
            size: 16,
            className: 'wechat-inline-system-emoji'
        });
        // 0ï¸âƒ£ æ–‡æœ¬å†…è”è¡¨æƒ…åŒ…ï¼š[è¡¨æƒ…åŒ…](å…³é”®è¯) / [è¡¨æƒ…åŒ…]ï¼ˆå…³é”®è¯ï¼‰
        // å•ç‹¬ä¸€æ•´æ¡çš„è¡¨æƒ…åŒ…æ¶ˆæ¯ä¼šåœ¨æ•°æ®å±‚è¢«è¯†åˆ«ä¸º `sticker` ç±»å‹ï¼Œä¸èµ°è¿™é‡Œ
        // è¿™é‡Œä¸å•æ¡è¡¨æƒ…åŒ…ä¿æŒä¸€è‡´ï¼šæœ¬åœ°è‡ªå®šä¹‰è¡¨æƒ… -> ALAPI -> å…³é”®è¯å ä½å¡ç‰‡
        const inlineNamedStickerRegex = /\[([^\]\r\n]{1,40})\]\s*[ï¼ˆ(]\s*((?:https?:)?\/\/[^)ï¼‰\s]+)\s*[)ï¼‰]/gi;
        result = result.replace(inlineNamedStickerRegex, (full, labelRaw, urlRaw) => {
            const label = String(labelRaw || '').trim();
            if (this.isReservedStickerLabel(label)) return full;
            const directStickerUrl = this.normalizeStickerDirectImageUrl(urlRaw);
            if (!directStickerUrl) return full;
            return `<span class="wechat-inline-custom-sticker" style="display:inline-flex;align-items:center;vertical-align:text-bottom;line-height:0;">${this.renderDirectStickerImage(directStickerUrl, label || 'è¡¨æƒ…åŒ…', { maxHeight: 56, inline: true })}</span>`;
        });

        const inlineStickerRegex = /\[è¡¨æƒ…åŒ…\]\s*[ï¼ˆ(]\s*([^)ï¼‰\n]+?)\s*[)ï¼‰]/g;
        result = result.replace(inlineStickerRegex, (_, keywordRaw) => {
            const keyword = String(keywordRaw || '').trim();
            if (!keyword) return '';

            const directStickerUrl = this.normalizeStickerDirectImageUrl(keyword);
            if (directStickerUrl) {
                return `<span class="wechat-inline-custom-sticker" style="display:inline-flex;align-items:center;vertical-align:text-bottom;line-height:0;">${this.renderDirectStickerImage(directStickerUrl, 'è¡¨æƒ…åŒ…', { maxHeight: 56, inline: true })}</span>`;
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

        // 1ï¸âƒ£ å…¼å®¹ AI è¯¯ç”¨çš„ [å·ç¬‘]ã€[å‚²æ…¢]ã€[åŠ æ²¹] ç­‰æ–‡å­—è¡¨æƒ…æ ¼å¼
        result = replacePhoneNamedEmojiTokens(result);

        // 2ï¸âƒ£ æ›¿æ¢è‡ªå®šä¹‰è¡¨æƒ…
        const customEmojis = this.app.wechatData.getCustomEmojis();
        customEmojis.forEach(emoji => {
            const pattern = `[${this._escapeHtml(emoji.name)}]`;
            if (result.includes(pattern)) {
                result = result.split(pattern).join(
                    `<img src="${this.escapeInlineStickerAttr(emoji.image || '')}" style="width:16px;height:16px;vertical-align:text-bottom;border-radius:4px;" alt="${this._escapeHtml(emoji.name || '')}" title="${this._escapeHtml(emoji.name || '')}">`
                );
            }
        });

        // 3ï¸âƒ£ å°† Unicode emoji ç»Ÿä¸€æ¸²æŸ“ä¸º Twemoji å›¾ç‰‡ï¼ˆä»…æ›¿æ¢çº¯æ–‡æœ¬ï¼Œé¿å…ç ´åå·²æœ‰ HTML æ ‡ç­¾ï¼‰
        result = this.renderTwemojiOutsideHtml(result, 16);

        return result;
    }

    normalizeCustomEmojiKeyword(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[ã€ã€‘\[\]ï¼ˆï¼‰(){}<>ã€Šã€‹ã€Œã€ã€ã€"'â€œâ€â€˜â€™]/g, '')
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

    isReservedStickerLabel(label) {
        const key = this.normalizeCustomEmojiKeyword(label);
        return [
            'è¡¨æƒ…åŒ…',
            'ç”¨æˆ·ç…§ç‰‡',
            'ä¸ªäººå›¾ç‰‡',
            'å›¾ç‰‡',
            'è§†é¢‘',
            'çº¢åŒ…',
            'è½¬è´¦',
            'å®šä½',
            'è¯­éŸ³',
            'è¯­éŸ³æ¡',
            'éŸ³ä¹',
            'èœœè¯­'
        ].some(item => this.normalizeCustomEmojiKeyword(item) === key);
    }

    parseDirectNamedStickerToken(content = '') {
        const match = String(content || '').trim().match(/^\[([^\]\r\n]{1,40})\]\s*[ï¼ˆ(]\s*((?:https?:)?\/\/[^)ï¼‰\s]+)\s*[)ï¼‰]\s*$/i);
        if (!match) return null;
        const label = String(match[1] || '').trim();
        if (!label || this.isReservedStickerLabel(label)) return null;
        const url = this.normalizeStickerDirectImageUrl(match[2]);
        if (!url) return null;
        return { label, url };
    }

    renderDirectStickerImage(imageUrl, label = 'è¡¨æƒ…åŒ…', { maxHeight = 156, inline = false } = {}) {
        const safeUrl = this.escapeInlineStickerAttr(imageUrl || '');
        const safeLabel = this._escapeHtml(String(label || 'è¡¨æƒ…åŒ…'));
        const height = Math.max(20, Number(maxHeight) || 156);
        const borderRadius = inline ? 6 : 8;
        return `<img src="${safeUrl}" alt="${safeLabel}" title="${safeLabel}" referrerpolicy="no-referrer" style="display:block;max-width:100%;max-height:${height}px;width:auto;height:auto;border-radius:${borderRadius}px;object-fit:contain;">`;
    }

    renderCustomEmojiStickerImage(emoji, { maxHeight = 156, inline = false } = {}) {
        const safeUrl = this.escapeInlineStickerAttr(emoji?.image || '');
        const safeName = this._escapeHtml(String(emoji?.description || emoji?.name || 'è¡¨æƒ…åŒ…'));
        const height = Math.max(20, Number(maxHeight) || 156);
        const borderRadius = inline ? 6 : 8;
        return `<img src="${safeUrl}" alt="${safeName}" title="${safeName}" style="display:block;max-width:100%;max-height:${height}px;width:auto;height:auto;border-radius:${borderRadius}px;object-fit:contain;">`;
    }

    _bindCustomEmojiImageRecovery(item) {
        const img = item?.querySelector?.('img[data-custom-emoji-src]');
        if (!img) return;

        let retried = false;
        const showFallback = () => {
            img.removeEventListener('error', handleError);
            img.hidden = true;
            item.classList.add('is-broken');
            if (!item.querySelector('.custom-emoji-broken-placeholder')) {
                const placeholder = document.createElement('span');
                placeholder.className = 'custom-emoji-broken-placeholder';
                placeholder.setAttribute('aria-label', 'è¡¨æƒ…å›¾ç‰‡å¤±æ•ˆ');
                placeholder.innerHTML = '<i class="fa-regular fa-image" aria-hidden="true"></i>';
                item.appendChild(placeholder);
            }
        };
        const handleError = () => {
            const source = String(img.dataset.customEmojiSrc || '').trim();
            if (!retried && /^\/backgrounds\/phone_[^?#]+/i.test(source)) {
                retried = true;
                const separator = source.includes('?') ? '&' : '?';
                img.src = `${source}${separator}phone_emoji_retry=${Date.now()}`;
                return;
            }
            showFallback();
        };

        img.addEventListener('error', handleError);
        if (img.complete && img.naturalWidth === 0) Promise.resolve().then(handleError);
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
            'æŒ‘çœ‰': 'ğŸ˜',
            'åç¬‘': 'ğŸ˜',
            'å¾—æ„': 'ğŸ˜',
            'æ–œçœ¼': 'ğŸ˜',
            'ç™½çœ¼': 'ğŸ™„',
            'å¾®ç¬‘': 'ğŸ˜Š',
            'ç¬‘': 'ğŸ˜Š',
            'å¤§ç¬‘': 'ğŸ˜',
            'å·ç¬‘': 'ğŸ¤­',
            'å®³ç¾': 'ğŸ˜Š',
            'æ— è¯­': 'ğŸ˜…',
            'æ‚è„¸': 'ğŸ¤¦',
            'æµæ³ª': 'ğŸ˜­',
            'å¤§å“­': 'ğŸ˜­',
            'å§”å±ˆ': 'ğŸ¥º',
            'å¯æ€œ': 'ğŸ¥º',
            'ç”Ÿæ°”': 'ğŸ˜ ',
            'å‘æ€’': 'ğŸ˜ ',
            'æƒŠè®¶': 'ğŸ˜®',
            'éœ‡æƒŠ': 'ğŸ˜®',
            'ç–‘æƒ‘': 'ğŸ¤”',
            'é—®å·': 'ğŸ¤”',
            'äº²äº²': 'ğŸ˜˜',
            'è‰²': 'ğŸ˜',
            'çˆ±å¿ƒçœ¼': 'ğŸ˜',
            'é…·': 'ğŸ˜',
            'æ™•': 'ğŸ˜µ',
            'æŠ“ç‹‚': 'ğŸ˜¤',
            'å': 'ğŸ¤®'
        };

        if (exactMap[norm]) return exactMap[norm];

        const fuzzyMap = [
            { keys: ['æŒ‘çœ‰', 'åç¬‘', 'æ–œçœ¼', 'è½»è”‘', 'å˜´è§’'], emoji: 'ğŸ˜' },
            { keys: ['ç™½çœ¼', 'ç¿»ç™½çœ¼'], emoji: 'ğŸ™„' },
            { keys: ['ç¬‘', 'å¼€å¿ƒ'], emoji: 'ğŸ˜Š' },
            { keys: ['å“­', 'æµæ³ª', 'æ³ª'], emoji: 'ğŸ˜­' },
            { keys: ['æ°”', 'æ€’'], emoji: 'ğŸ˜ ' },
            { keys: ['æƒŠ', 'éœ‡æƒŠ'], emoji: 'ğŸ˜®' },
            { keys: ['ç–‘æƒ‘', 'é—®'], emoji: 'ğŸ¤”' }
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
            console.warn('[Wechat] è¯»å– ALAPI è¡¨æƒ…ç¼“å­˜å¤±è´¥:', e);
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
            // ç½‘ç»œ/CORS å¤±è´¥æ—¶ï¼Œäº¤ç»™ <img src=apiUrl> å†å°è¯•ä¸€æ¬¡
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
        if (!response.ok) throw new Error(`è¯»å– ALAPI è¡¨æƒ…å¤±è´¥ï¼ˆHTTP ${response.status}ï¼‰`);

        const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const arrayBuffer = await response.arrayBuffer();
        if (!arrayBuffer || arrayBuffer.byteLength <= 0) throw new Error('ALAPI è¡¨æƒ…å›¾ç‰‡ä¸ºç©º');

        const bytes = new Uint8Array(arrayBuffer);
        const mime = resolveImageMime(bytes, contentType);
        if (!mime) throw new Error('ALAPI è¡¨æƒ…å“åº”ä¸æ˜¯æœ‰æ•ˆå›¾ç‰‡');
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

    buildStickerKeywordFallbackMarkup(keyword,ßmwÛ†òµë(š+my×FVçBÇÂ6ÆVä6öçFVçBÇÂrr’’ç&WÆ6R‚õÇ2²örÂrr’çG&–Ò‚“°Ğ¢6öç7B–æÆ–æU&Wf–WrÒ–æÆ–æU&Wf–Wu&ræÆVæwF‚â3BòG¶–æÆ–æU&Wf–Wu&rç6Æ–6RƒÂ3B—Òââæ¢–æÆ–æU&Wf–Wu&s°Ğ¢v–æF÷råf—'GVÅ†öæRææ÷F–g’‚~ik[êîKúkhhòrÂ–æÆ–æU&Wf–WrÇÂG·6fVD6†DæÖWÒ{¹KÚXùK¨nikkhhöÂrrÂ°Ğ¢fF#¢f–æÄæ÷F–g”fF"ÀĞ¢æÖS¢6fVD6†DæÖRÇÂ×6rç6VæFW"ÇÂ~[êîKúrÀĞ¢6öçFVçC¢–æÆ–æU&Wf–WrÇÂ~XùiÚ^ikkhhòrÀĞ¢F–ÖUFW‡C¢~X‰®X‰¢rÀĞ¢6VæFW$¶W“¢vV6†C¦–æÆ–æS¢G·6fVD6†D–GÓ¢G´FFRææ÷r‚—Ö Ğ¢Ò“°Ğ¢v–æF÷råf—'GVÅ†öæRçÆ•vV6†DÖW76vU6÷VæCòâ‡²6÷W&6S¢vöæÆ–æUö–æÆ–æUö&6¶w&÷VæBrÒ“°Ğ¢ÒVÇ6R°Ğ¢F†—2æç†öæU6†VÆÃòç6†÷tæ÷F–f–6F–öâ‚~ik[êîKúkhhòrÂG·6fVD6†DæÖWÒ{¹KÚXùK¨nikkhhöÂ	ù*Âr“°Ğ¢v–æF÷råf—'GVÅ†öæSòçÆ•vV6†DÖW76vU6÷VæCòâ‡²6÷W&6S¢vöæÆ–æUö–æÆ–æUö&6¶w&÷VæBrÒ“°Ğ¢ĞĞ Ğ¢òòYÎjÚ^XZ[{ª.x+Ğ¢–b‡v–æF÷råf—'GVÅ†öæSòæ†öÖR’°Ğ¢6öç7B2Òv–æF÷råf—'GVÅ†öæRæ†öÖRæ3°Ğ¢–b†2’°Ğ¢6öç7BvV6†D–6öâÒ2æf–æB†Óâæ–BÓÓÒwvV6†Br“°Ğ¢–b‡vV6†D–6öâ’°Ğ¢6öç7B6†DÆ—7BÒF†—2æçvV6†DFFævWD6†DÆ—7B‚“°Ğ¢vV6†D–6öâæ&FvRÒ6†DÆ—7Bç&VGV6R‚‡7VÒÂ2’Óâ7VÒ²2çVç&VBÂ“°Ğ¢v–æF÷ræF—7F6„WfVçB†æWr7W7FöÔWfVçB‚w†öæS§WFFTvÆö&Ä&FvRr’“°Ğ¢ĞĞ¢ĞĞ¢ĞĞ Ğ¢òòK¸^X‹~ikX˜ŞXû[êîKúX‰~ŠûÉ¾YîXû˜xŞ{¹KÉ®h¨®yJh‹~jÚ>YÊKÛşyJy¨NX[nK¹bŠhny¹nhè8 Ğ¢6öç7B—5vV6†Df÷&Vw&÷VæBÒFö7VÖVçBçVW'•6VÆV7F÷"‚rç†öæR×f–WrÖ7W'&VçBçvV6†BÖr“°Ğ¢–b†—5vV6†Df÷&Vw&÷VæBbbF†—2ææ7W'&VçEf–WrÓÓÒv6†G2rbbF†—2ææ7W'&VçD6†B’°Ğ¢F†—2æç&VæFW"‚“°Ğ¢ĞĞ¢ĞĞ¢ĞĞ¢ĞĞ Ğ¢òò	ùJRikZ)îûÉ®Zh.iéÎŠznXùK¨n{«şKˆ¾ˆNXªûÈÎˆz®XªX[>™zŞh˜¾iË®[›nx+X{¾˜Y.šhnXù˜hÈ™*àĞ¢–b‡G&–vvW$öffÆ–æR’°Ğ¢6öç7BÖ&µvV6†DöæÆ–æUFôöffÆ–æT†–çEVæF–ærÒ‚’Óâ°Ğ¢v–æF÷råf—'GVÅ†öæSòæÖ&µvV6†DöæÆ–æUFôöffÆ–æUG&ç6fW%VæF–æsòâ‡°Ğ¢6†D–C¢6fVD6†D–BÀĞ¢6†DæÖS¢6fVD6†DæÖPĞ¢Ò“°Ğ¢Ó°Ğ¢Ö&µvV6†DöæÆ–æUFôöffÆ–æT†–çEVæF–ær‚“°Ğ¢6WEF–ÖV÷WB‚‚’Óâ°Ğ¢òòâKÉ™¸^YËX[>™zŞh˜¾iË®™Ú.iÛğĞ¢6öç7BG&vW$–6öâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w†öæTG&vW$–6öâr“°Ğ¢6öç7BG&vW%æVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w†öæR×æVÂr“°Ğ¢–b†G&vW%æVÂbbG&vW%æVÂæ6Æ74Æ—7Bæ6öçF–ç2‚w†öæR×æVÂÖ÷Vâr’’°Ğ¢G&vW%æVÂæ6Æ74Æ—7Bç&VÖ÷fR‚w†öæR×æVÂÖ÷VârÂv÷VäG&vW"rÂvG&vW"Ö6öçFVçBrÂvf–ÆÅ&–v‡Br“°Ğ¢G&vW%æVÂæ6Æ74Æ—7BæFB‚w†öæR×æVÂÖ†–FFVâr“°Ğ¢G&vW%æVÂç7G–ÆRæ775FW‡BÒvF—7Æ“¦æöæR–×÷'FçC²f—6–&–Æ—G“¦†–FFVâ–×÷'FçC²÷6—G“£–×÷'FçC²ö–çFW"ÖWfVçG3¦æöæR–×÷'FçC²÷6—F–öã¦'6öÇWFR–×÷'FçC²v–GFƒ£–×÷'FçC²†V–v‡C£–×÷'FçC²÷fW&fÆ÷s¦†–FFVâ–×÷'FçC²s°Ğ¢ĞĞ Ğ¢òò"â[»n‹ùşŠznXù˜Y.šhny¨NXù˜hÈ™*îûÈÎŠêXš~h8^{º~{ºĞĞ¢6WEF–ÖV÷WB‚‚’Óâ°Ğ¢òò	ùJRK¸^˜x®iKîyKK¨îh˜¾iË®™Ú.iÛş™©‰xşZûÎˆ{Ny¨NjÛ¾™HxJnx+ûÈÎ™‹.jÚ.kXşŠxYšXÚjÛ°Ğ¢–b†Fö7VÖVçBæ7F—fTVÆVÖVçB’°Ğ¢Fö7VÖVçBæ7F—fTVÆVÖVçBæ&ÇW"‚“°Ğ¢ĞĞ Ğ¢òò	ùJRy»Nhê^x+X{¾Xù˜hÈ™*îûÈÎ{¹ŞKˆŞŠznXùK»¾KÙR–çWBK¨¾K»nûÈÎZèÎ{èî˜ş[ÈWFô6ö×ÆWFRhª^™IĞ¢6öç7B6VæD'FâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w6VæEö'WBr“°Ğ¢–b‡6VæD'Fâ’°Ğ¢Ö&µvV6†DöæÆ–æUFôöffÆ–æT†–çEVæF–ær‚“°Ğ¢6VæD'Fâæ6Æ–6²‚“°Ğ¢ĞĞ¢ÒÂS“°Ğ¢ÒÂS“²òò[»n‹ùóã^zy.ûÈÎzîKùŞyJh‹~iÈi{n™{NyÈ¾ZèÎiÈYîKˆiÚ[êîKúkhhğĞ¢ĞĞ Ğ¢7V66W72ÒG'VS°Ğ Ğ¢Ò6F6‚†W'&÷"’°Ğ¢òò	ùJRXË®XˆnKŠŞijŞY(ÎX[nK¹n™IŠúşûÈÎ™Ù›¹ZHNynKŠŞijŞûÈÎ[Û¾[©^[›.hèhn[ø>y¨N[Ëz©~ûÈĞ¢–b†W'&÷"æÖW76vRÓÓÒ~[{.KŠŞijŞXù˜rÇÂW'&÷"ææÖRÓÓÒt&÷'DW'&÷"r’°Ğ¢6öç6öÆRæÆör‚~)ÈRh˜¾iË®zºşXù˜[{.KŠŞijŞûÈÎ™Ù›¹ZHNybr“°Ğ¢ÒVÇ6R°Ğ¢6öç7BW'&÷%FW‡BÒF†—2åöf÷&ÖDW'&÷$f÷$Æör†W'&÷"Â~Xù˜h˜¾iË®khhşZK‹JRr“°Ğ¢6öç6öÆRæW'&÷"‚~)ØÂXù˜h˜¾iË®khhşZK‹JS¢rÂ°Ğ¢ÖW76vS¢W'&÷%FW‡BÀĞ¢7F6³¢W'&÷#òç7F6²ÀĞ¢&s¢W'&÷ Ğ¢Ò“°Ğ¢F†—2æç†öæU6†VÆÃòç6†÷tæ÷F–f–6F–öâ‚~Xù˜ZK‹JRrÂW'&÷%FW‡BÂ~)ØÂr“°Ğ¢ Ğ¢òò	ùJRKúîZHÓ.ûÉ®XùyIşKŠ^˜xŞKº>zhª^™Ii{nûÈÎ[Ë®X‹nh¨®Zè>K¸î‹ùîXùzØ[è^™‰şX‰~˜xÎ‹Š.X{®Xë¾ûÈÎ[Û¾[©^iÙÎ{¹ŞjÛ¾[ê®xêşûÈĞ¢F†—2åöFWVWVUVæF–æt6†B‡6fVD6†D–B“°Ğ¢ĞĞ¢Òf–æÆÇ’°Ğ¢–b‡7V66W72’°Ğ¢F†—2åöFWVWVUVæF–æt6†B‡6fVD6†D–B“°Ğ¢ĞĞ¢òò	ùJRizŠë®h‰X©ş‹ùiŠşZK‹J^ûÈÎ˜;Ş˜xŞ{Úîx«nhĞ¢F†—2æ—56VæF–ærÒfÇ6S°Ğ¢–b…7G&–ær‡F†—2åö7F—fU6VæF–æt6†D–BÇÂrr’ÓÓÒ7G&–ær‡6fVD6†D–BÇÂrr’’°Ğ¢F†—2åö7F—fU6VæF–æt6†D–BÒçVÆÃ°Ğ¢ĞĞ¢F†—2æ&÷'D6öçG&öÆÆW"ÒçVÆÃ°Ğ¢F†—2åö•&WÇ•&WVW7E7F'FVDBÒ°Ğ¢F†—2å÷&W6WD•&WÇ•F–ÖT7W'6÷"‚“°Ğ¢F†—2ç7–æ4†VFW%7FGW4F÷B‡6fVD6†D–B“°Ğ¢F†—2å÷&Vg&W6…f—6–&ÆT6†DÖW76vW2‡6fVD6†D–B“°Ğ¢òò	ùJRXú®iÈh˜¾iË®‹ù[ÈyØh˜ŞX‹~ikyXÎ™Ú.ûÈ™ÈŠhi»NikXù˜hÈ™*îx«nhûÈĞ¢–b‡F†—2ææ7W'&VçD6†B’°Ğ¢òò	ùJRXú®i»NikXù˜hÈ™*îXË®YùşûÈÎ˜şXXŞi[NKŠ®yXÎ™Ú.˜xŞ{¹€Ğ¢6öç7B7W'&VçEf–WrÒF†—2ævWD7W'&VçEvV6†Ef–WròF†—2ævWD7W'&VçEvV6†Ef–Wr‚’¢Fö7VÖVçC°Ğ¢6öç7B–çWBÒ7W'&VçEf–WrçVW'•6VÆV7F÷"‚r66†BÖ–çWBr’ÇÂFö7VÖVçBævWDVÆVÖVçD'”–B‚v6†BÖ–çWBr“°Ğ¢F†—2å÷7–æ46†E6VæD'WGFöâ†–çWB“°Ğ¢ĞĞ¢ĞĞ¢&WGW&â7V66W73°Ğ¢ĞĞ Ğ¢òò	ùJRKŠŞijŞXù˜ikk9PĞ¢&÷'E6VæF–ær‚’°Ğ¢–b‡F†—2æ&÷'D6öçG&öÆÆW"’°Ğ¢òòâKŠŞijŞh˜¾iË®zºşy¨NkXzˆ¾zØ[èPĞ¢F†—2æ&÷'D6öçG&öÆÆW"æ&÷'B‚“°Ğ Ğ¢òò"â	ùJRj[ø>iØh¹¾ûÉ®‹>yJh©>XùnX‹y¨N˜Y.šhnyÉşZéîXZ[XÎjÚ.X{Şi[ Ğ¢–b‡G—Vöbv–æF÷rç7F÷vVæW&F–öâÓÓÒvgVæ7F–öâr’°Ğ¢v–æF÷rç7F÷vVæW&F–öâ‚“°Ğ¢ĞĞ Ğ¢òò2â	ùJRi«NX©¾XYÎ[©^ûÉ®[Ë®X‹nx+X{¾yXÎ™Ú.y¨NXÎjÚ.hÈ™*îûÈXë¾hèK¨nXéşiÚ^hI®Š
.y¨NXúşŠxh
~XŠNijŞûÈĞ¢6öç7B7E7F÷'FâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖW5÷7F÷r“°Ğ¢–b‡7E7F÷'Fâ’°Ğ¢7E7F÷'Fâæ6Æ–6²‚“°Ğ¢ĞĞ¢ĞĞ¢F†—2æ—56VæF–ærÒfÇ6S°Ğ¢F†—2åö7F—fU6VæF–æt6†D–BÒçVÆÃ°Ğ¢F†—2æ†–FUG—–æu7FGW2‚“°Ğ¢F†—2æç&VæFW"‚“°Ğ¢ĞĞ Ğ¢òò)ÈR™Ù›¹‹>yJ„ûÈK‹Ni{nXª¾hÈ[©^[.˜XŞ{ÚîûÈÎ[Ë®X‹n[ÈY
şY»îx˜~Xù˜ûÈÎyK”ÖævW"hê^zêûÈĞ¢7–æ26VæEFô”†–FFVâ‡&ö×BÂ6öçFW‡BÂ6ÆÄÖöFRÒçVÆÂÂ6–væÂÒçVÆÂÂF&vWD6†D–BÒçVÆÂÂ÷F–öç2Ò·Ò’°Ğ¢–b‚6öçFW‡B’F‡&÷ræWrW'&÷"‚~)ØÂizk9^Šëş™zâ6öçFW‡Br“°Ğ Ğ¢òòâ{¸NŠ8^h˜¾iË®yXÎ™Ú.y¨NxºÎx›Kˆ®Kˆ¾ih~i[{¸B‹ù˜xÎy¨N˜¾‹éKˆŞXªûÈÎZèÎ{èî™©Nzk²Ğ¢6öç7BÖW76vW2Òv—BF†—2æ'V–ÆDÖW76vW4'&’‡&ö×BÂ6öçFW‡BÂ6ÆÄÖöFRÂF&vWD6†D–BÂ÷F–öç2“°Ğ Ğ¢òò	ùJR[ÈY
şY»îx˜~Xù˜Š^KˆûÈ[©NZûZI®jŠhûÈĞ¢6öç7B7E6WGF–æw2Ò²v÷Væ•÷6WGF–æw2rÂv6†Eö6ö×ÆWF–öå÷6WGF–æw2rÂv6ÆVFU÷6WGF–æw2rÂvÖ¶W%÷6WGF–æw2rÂvvöövÆU÷6WGF–æw2uÓ°Ğ¢6öç7B&6·W2Ò·Ó°Ğ¢7E6WGF–æw2æf÷$V6‚†¶W’Óâ°Ğ¢–b‡v–æF÷u¶¶W•Òbbv–æF÷u¶¶W•Òç6VæEö–æÆ–æU÷–7GW&W2ÓÒVæFVf–æVB’°Ğ¢&6·W5¶¶W•ÒÒv–æF÷u¶¶W•Òç6VæEö–æÆ–æU÷–7GW&W3°Ğ¢v–æF÷u¶¶W•Òç6VæEö–æÆ–æU÷–7GW&W2ÒG'VS°Ğ¢ĞĞ¢Ò“°Ğ Ğ¢G'’°Ğ¢òò	ù¨j[ø>ûÉ®z{¾KªB”ÖævW"ZHNy`Ğ¢6öç7B”ÖævW"Òv–æF÷råf—'GVÅ†öæSòæ”ÖævW#°Ğ¢–b‚”ÖævW"’F‡&÷ræWrW'&÷"‚t’ÖævW"iÊ®X‰ŞZx¾XÉbr“°Ğ Ğ¢6öç7B&W7VÇBÒv—B”ÖævW"æ6ÆÄ’†ÖW76vW2Â°Ğ¢6–væÃ¢6–væÂÀĞ¢Ö…÷Fö¶Vç3¢6öçFW‡BæÖ…÷&W7öç6UöÆVæwF‚ÀĞ¢–C¢wvV6†BpĞ¢Ò“°Ğ Ğ¢–b‚&W7VÇBç7V66W72’°Ğ¢–b‡&W7VÇBæ&÷'FVB’°Ğ¢6öç6öÆRæÆör‚~)ÈRXù˜[{.Xùnkh‚r“°Ğ¢F‡&÷ræWrW'&÷"‚~[{.KŠŞijŞXù˜r“°Ğ¢ĞĞ¢F‡&÷ræWrW'&÷"‡&W7VÇBæW'&÷"ÇÂt’‹ùNY¹îZK‹J^KØniÊ®hùKé¾™IŠúşKúhòr“°Ğ¢ĞĞ Ğ¢&WGW&â&W7VÇBç7VÖÖ'“°Ğ Ğ¢Ò6F6‚†W'&÷"’°Ğ¢–b†W'&÷"æÖW76vRÓÓÒ~[{.KŠŞijŞXù˜r’F‡&÷rW'&÷#°Ğ¢6öç6öÆRæW'&÷"‚~)ØÂ¾h˜¾iË®ˆ®ZJ•Ò™Ù›¹‹>yJZK‹JS¢rÂ°Ğ¢ÖW76vS¢F†—2åöf÷&ÖDW'&÷$f÷$Æör†W'&÷"Â~™Ù›¹‹>yJZK‹JRr’ÀĞ¢7F6³¢W'&÷#òç7F6²ÀĞ¢&s¢W'&÷ Ğ¢Ò“°Ğ¢F‡&÷rW'&÷#°Ğ¢Òf–æÆÇ’°Ğ¢òò‹ùXéş˜XŞ{ÚàĞ¢7E6WGF–æw2æf÷$V6‚†¶W’Óâ°Ğ¢–b‡v–æF÷u¶¶W•Òbb&6·W5¶¶W•ÒÓÒVæFVf–æVB’v–æF÷u¶¶W•Òç6VæEö–æÆ–æU÷–7GW&W2Ò&6·W5¶¶W•Ó°Ğ¢Ò“°Ğ¢ĞĞ¢ĞĞ Ğ¢òò	ùJRièN[»¢ÖW76vW2i[{¸NûÈXø.ˆ>Šë[ønhù.K»ny¨Nik[ÈşŠû¾Xùn˜Y.šhni[hÚîûÈĞ¢òò6ÆÄÖöFS¢çVÆÃŞ[êîKúˆ®ZJ’Âwfö–6RsŞŠúŞ™û>˜	®ŠùÒÂwf–FVòsŞŠxnš)˜	®ŠùĞĞ¢ö&Æö%FôFFW&Â†&Æö"’°Ğ¢&WGW&âæWr&öÖ—6R‚‡&W6öÇfRÂ&V¦V7B’Óâ°Ğ¢G'’°Ğ¢6öç7B&VFW"ÒæWrf–ÆU&VFW"‚“°Ğ¢&VFW"æöæÆöBÒ‚’Óâ&W6öÇfR…7G&–ær‡&VFW"ç&W7VÇBÇÂrr’“°Ğ¢&VFW"æöæW'&÷"Ò‚’Óâ&V¦V7B†æWrW'&÷"‚w&VEö&Æö%öf–ÆVBr’“°Ğ¢&VFW"ç&VD4FFU$Â†&Æö"“°Ğ¢Ò6F6‚†W'"’°Ğ¢&V¦V7B†W'"“°Ğ¢ĞĞ¢Ò“°Ğ¢ĞĞ Ğ¢7–æ2ö6ö×&W75vV6†Ef—6–öäFFW&Â†FFW&ÂÂÖ„6†'2ÒtT4„Eô•ô”ÔtUôÔ…ô4„%ô%TDtUB’°Ğ¢6öç7Bæ÷&ÖÆ—¦VBÒæ÷&ÖÆ—¦T–ÖvTFFW&ÄÖ–ÖR…7G&–ær†FFW&ÂÇÂrr’çG&–Ò‚’“°Ğ¢6öç7BÆ–Ö—BÒÖF‚æÖ‚ƒÂçVÖ&W"ç'6T–çB†Ö„6†'2Â’ÇÂtT4„Eô•ô”ÔtUôÔ…ô4„%ô%TDtUB“°Ğ¢–b‚õæFF¦–ÖvUÂòö’çFW7B†æ÷&ÖÆ—¦VB’’F‡&÷ræWrW'&÷"‚~izk9^ŠønXŠ¾ŠhXù˜{¹’’y¨NY»îx˜~jÎ[ÈşûÈÎiÊÎjÊŠû~k.[{.Xùnkh‚r“°Ğ¢–b‚õæFF¦–ÖvUÂöv–bö’çFW7B†æ÷&ÖÆ—¦VB’bbæ÷&ÖÆ—¦VBæÆVæwF‚ÃÒÆ–Ö—B’&WGW&âæ÷&ÖÆ—¦VC°Ğ¢–b‡G—Vöb–ÖvRÓÒvgVæ7F–öârÇÂG—VöbFö7VÖVçBÓÓÒwVæFVf–æVBr’°Ğ¢F‡&÷ræWrW'&÷"‚~[Ù>X˜ŞxêşZ(>izk9^Xè¾{ÊY»îx˜~ûÈÎiÊÎjÊY»îx˜~iÊ®Xù˜{¹’’r“°Ğ¢ĞĞ Ğ¢G'’°Ğ¢6öç7B–ÖvRÒv—BæWr&öÖ—6R‚‡&W6öÇfRÂ&V¦V7B’Óâ°Ğ¢6öç7BæW‡D–ÖvRÒæWr–ÖvR‚“°Ğ¢æW‡D–ÖvRæöæÆöBÒ‚’Óâ&W6öÇfR†æW‡D–ÖvR“°Ğ¢æW‡D–ÖvRæöæW'&÷"Ò‚’Óâ&V¦V7B†æWrW'&÷"‚vFV6öFUö–ÖvUöf–ÆVBr’“°Ğ¢æW‡D–ÖvRç7&2Òæ÷&ÖÆ—¦VC°Ğ¢Ò“°Ğ¢6öç7B6÷W&6Uv–GF‚ÒçVÖ&W"†–ÖvRææGW&Åv–GF‚ÇÂ–ÖvRçv–GF‚ÇÂ“°Ğ¢6öç7B6÷W&6T†V–v‡BÒçVÖ&W"†–ÖvRææGW&Ä†V–v‡BÇÂ–ÖvRæ†V–v‡BÇÂ“°Ğ¢–b‚‡6÷W&6Uv–GF‚âbb6÷W&6T†V–v‡Bâ’’F‡&÷ræWrW'&÷"‚~izk9^Šû¾XùnY»îx˜~[®ZûûÈÎiÊÎjÊY»îx˜~iÊ®Xù˜{¹’’r“°Ğ Ğ¢ÆWBÖ…6–FRÒÖF‚æÖ–âƒ“cÂÖF‚æÖ‚‡6÷W&6Uv–GF‚Â6÷W&6T†V–v‡B’“°Ğ¢ÆWBVÆ—G’Òãs#°Ğ¢ÆWB6ÖÆÆW7BÒrs°Ğ¢f÷"†ÆWBGFV×BÒ²GFV×BÂƒ²GFV×B³Ò’°Ğ¢6öç7B66ÆRÒÖF‚æÖ–âƒÂÖ…6–FRòÖF‚æÖ‚‡6÷W&6Uv–GF‚Â6÷W&6T†V–v‡B’“°Ğ¢6öç7Bv–GF‚ÒÖF‚æÖ‚ƒÂÖF‚ç&÷VæB‡6÷W&6Uv–GF‚¢66ÆR’“°Ğ¢6öç7B†V–v‡BÒÖF‚æÖ‚ƒÂÖF‚ç&÷VæB‡6÷W&6T†V–v‡B¢66ÆR’“°Ğ¢6öç7B6çf2ÒFö7VÖVçBæ7&VFTVÆVÖVçB‚v6çf2r“°Ğ¢6çf2çv–GF‚Òv–GFƒ°Ğ¢6çf2æ†V–v‡BÒ†V–v‡C°Ğ¢6öç7B6öçFW‡BÒ6çf2ævWD6öçFW‡B‚s&Br“°Ğ¢–b‚6öçFW‡B’F‡&÷ræWrW'&÷"‚~izk9^X‰¾[»®Y»îx˜~Xè¾{ÊyK¾[ˆ>ûÈÎiÊÎjÊY»îx˜~iÊ®Xù˜{¹’’r“°Ğ¢6öçFW‡Bæf–ÆÅ7G–ÆRÒr6ffbs°Ğ¢6öçFW‡Bæf–ÆÅ&V7BƒÂÂv–GF‚Â†V–v‡B“°Ğ¢6öçFW‡BæG&t–ÖvR†–ÖvRÂÂÂv–GF‚Â†V–v‡B“°Ğ¢6öç7B6æF–FFRÒ6çf2çFôFFU$Â‚v–ÖvRö§VrrÂVÆ—G’“°Ğ¢–b‚6ÖÆÆW7BÇÂ6æF–FFRæÆVæwF‚Â6ÖÆÆW7BæÆVæwF‚’6ÖÆÆW7BÒ6æF–FFS°Ğ¢–b†6æF–FFRæÆVæwF‚ÃÒÆ–Ö—B’&WGW&â6æF–FFS°Ğ¢Ö…6–FRÒÖF‚æÖ‚ƒ#CÂÖF‚æfÆö÷"†Ö…6–FR¢ãs‚’“°Ğ¢VÆ—G’ÒÖF‚æÖ‚ƒã3"ÂVÆ—G’Òã‚“°Ğ¢ĞĞ¢F‡&÷ræWrW'&÷"†Y»îx˜~Xè¾{ÊYîK¸Ş‹h^‹ø~KŠŞ‹ÚÎ™™X‹nûÈ‚G·6ÖÆÆW7BæÆVæwF‡ÒâG¶Æ–Ö—GŞûÈûÈÎiÊÎjÊY»îx˜~iÊ®Xù˜{¹’–“°Ğ¢Ò6F6‚†W'&÷"’°Ğ¢6öç6öÆRçv&â‚uµvV6†EÒ’ŠxnŠxY»îx˜~ZHNynZK‹J^ûÈÎ[{.XùnkhiÊÎjÊŠû~k#¢rÂW'&÷#òæÖW76vRÇÂW'&÷"“°Ğ¢F‡&÷rW'&÷#°Ğ¢ĞĞ¢ĞĞ Ğ¢7–æ2÷&W6öÇfUvV6†D–ÖvTf÷$’†–ÖvUfÇVRÂ66†TÖÒçVÆÂÂ÷F–öç2Ò·Ò’°Ğ¢6öç7B&rÒ7G&–ær†–ÖvUfÇVRÇÂrr’çG&–Ò‚“°Ğ¢–b‚&r’&WGW&ârs°Ğ¢6öç7BÖ„6†'2Ò÷F–öç2æÖ„6†'2ÇÂtT4„Eô•ô”ÔtUôÔ…ô4„%ô%TDtUC°Ğ¢–b‚õæFF¦–ÖvRö’çFW7B‡&r’’&WGW&âF†—2åö6ö×&W75vV6†Ef—6–öäFFW&Â‡&rÂÖ„6†'2“°Ğ¢–b†66†TÖbb66†TÖæ†2‡&r’’&WGW&â66†TÖævWB‡&r“°Ğ Ğ¢6öç7Bæ÷&ÖÆ—¦VEW&ÂÒ‚‚’Óâ°Ğ¢G'’°Ğ¢–b‚õåÂö&6¶w&÷VæG5Âòö’çFW7B‡&r’’&WGW&â&s°Ğ¢–b‚õæ‡GG3ó¥ÂõÂòö’çFW7B‡&r’’&WGW&â&s°Ğ¢&WGW&âæWrU$Â‡&rÂv–æF÷ræÆö6F–öâæ÷&–v–â’æ‡&Vc°Ğ¢Ò6F6‚†R’°Ğ¢&WGW&â&s°Ğ¢ĞĞ¢Ò’‚“°Ğ Ğ¢ÆWBFFW&ÂÒrs°Ğ¢G'’°Ğ¢6öç7B&W7Òv—BfWF6‚†æ÷&ÖÆ—¦VEW&ÂÂ²7&VFVçF–Ç3¢v–æ6ÇVFRrÒ“°Ğ¢–b‚&W7æö²’F‡&÷ræWrW'&÷"†…EEG·&W7ç7FGW7Ö“°Ğ¢6öç7B6öçFVçEG—RÒ7G&–ær‡&W7æ†VFW'2ævWB‚v6öçFVçB×G—Rr’ÇÂrr’ç7Æ—B‚s²r•³ÒçG&–Ò‚’çFôÆ÷vW$66R‚“°Ğ¢6öç7B'&”'VffW"Òv—B&W7æ'&”'VffW"‚“°Ğ¢–b‚'&”'VffW"ÇÂ'&”'VffW"æ'—FTÆVæwF‚ÃÒ’F‡&÷ræWrW'&÷"‚vV×G•ö–ÖvRr“°Ğ¢6öç7BÖ–ÖRÒ&W6öÇfT–ÖvTÖ–ÖR†æWrV–çC„'&’†'&”'VffW"’Â6öçFVçEG—R“°Ğ¢–b‚Ö–ÖR’F‡&÷ræWrW'&÷"†æ÷Eö–ÖvUö&Æö#¢G¶6öçFVçEG—RÇÂwVæ¶æ÷vâwÖ“°Ğ¢6öç7B&Æö"ÒæWr&Æö"…¶'&”'VffW%ÒÂ²G—S¢Ö–ÖRÒ“°Ğ¢FFW&ÂÒv—BF†—2åö&Æö%FôFFW&Â†&Æö"“°Ğ¢FFW&ÂÒv—BF†—2åö6ö×&W75vV6†Ef—6–öäFFW&Â†FFW&ÂÂÖ„6†'2“°Ğ¢Ò6F6‚†W'"’°Ğ¢6öç6öÆRçv&â‚uµvV6†EÒY»îx˜~Xù˜{¹’’ZK‹J^ûÈÎ[{.XùnkhiÊÎjÊŠû~k#¢rÂ&rÂW'#òæÖW76vRÇÂW'"“°Ğ¢F‡&÷ræWrW'&÷"†Y»îx˜~iÊ®Xù˜{¹’ûÉ¢G¶W'#òæÖW76vRÇÂ~Y»îx˜~Šû¾XùnZK‹JRwÖ“°Ğ¢ĞĞ Ğ¢–b†66†TÖ’°Ğ¢66†TÖç6WB‡&rÂFFW&Â“°Ğ¢66†TÖç6WB†æ÷&ÖÆ—¦VEW&ÂÂFFW&Â“°Ğ¢ĞĞ¢&WGW&âFFW&Ã°Ğ¢ĞĞ Ğ¢7–æ2'V–ÆDÖW76vW4'&’‡&ö×BÂ6öçFW‡BÂ6ÆÄÖöFRÒçVÆÂÂF&vWD6†D–BÒçVÆÂÂ÷F–öç2Ò·Ò’°Ğ¢6öç7BÖW76vW2ÒµÓ°Ğ¢6öç7B—5&ö7F—fRÒ÷F–öç2ç&ö7F—fS°Ğ¢6öç7B&ö7F—fTÖWFÒ÷F–öç2ç&ö7F—fTÖWFÇÂ·Ó°Ğ¢6öç7BÆö&'•6VÆV7F–öâÒF†—2åö'V–ÆDÆö&'•6VÆV7F–öâ†6öçFW‡B“°Ğ¢6öç7BÆö&'•W6W'2ÒF†—2å÷&W6öÇfTÆö&'•6VÆV7FVEW6W'2†Æö&'•6VÆV7F–öâ“°Ğ¢6öç7BÆö&'•W6W%&öf–ÆW2Òv—BF†—2å÷&W6öÇfTÆö&'•6VÆV7FVEW6W%&öf–ÆW2†Æö&'•6VÆV7F–öâÂ6öçFW‡B“°Ğ¢6öç7B&–Ö'”Æö&'•W6W"ÒÆö&'•W6W'2æÆVæwF‚âòÆö&'•W6W'5³Ò¢rs°Ğ Ğ¢òò	ùJ_	ùJ_	ùJR[ú¾xZ~{¹Zé®ûÉ®KÉXXKÛşyJKÊXZ^y¨BF&vWD6†D–NûÈÎ™‹.jÚ.X	.Šêi{niÉş™{NXˆ~hÚ.z©~Xú>ZûÎˆ{NK‹.Y0Ğ¢6öç7BF&vWD6†BÒF&vWD6†D–@Ğ¢òF†—2æçvV6†DFFævWD6†DÆ—7B‚’æf–æB†2Óâ2æ–BÓÓÒF&vWD6†D–BĞ¢¢F†—2ææ7W'&VçD6†C°Ğ Ğ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢òòûˆş(:2ˆë~XùnŠy.ˆ›.YŞY(ÎyJh‹~YŞûÈXø.ˆ>Šë[ønhù.K»nûÈĞ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢6öç7BW6W$æÖRÒ†Æö&'•6VÆV7F–öâæ—4Æö&'’bb&–Ö'”Æö&'•W6W"’ò&–Ö'”Æö&'•W6W"¢†6öçFW‡BææÖSÇÂ~yJh‹rr“°Ğ¢6öç7BvV6†EW6W$æÖRÒ7G&–ær‡F†—2æòçvV6†DFFòævWEW6W$–æfóòâ‚“òææÖRÇÂrr’çG&–Ò‚“°Ğ¢–b‡vV6†EW6W$æÖRbbvV6†EW6W$æÖRÓÒW6W$æÖR’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢8	yJh‹~‹ª¾K»ŞXŠ¾YŞ8	˜Y.šhnjÚ>ih~KŠŞy¨N(	ÂG·W6W$æÖWŞ(	ŞKˆî[şh˜¾iË®[êîKúi‹^z{(	ÂG·vV6†EW6W$æÖWŞ(	ŞiŠşYÎKˆKŠ®K«®ûÈÎYØ~hÈ~Kº7··W6W'×Ş8.[êîKúˆ®ZJŠë[Ù^˜xÎ(	ÂG·vV6†EW6W$æÖWŞ(	ŞXùX{®y¨NXh^ZëzØYÎK¨î(	ÂG·W6W$æÖWŞ(	ŞXùX{®y¨NXh^ZëûÈÎKˆŞŠhh¨®‹ùKŠNKŠ®YŞZÙ~[Ù>h‰KŠNKŠ®K«®8&ÀĞ¢æÖS¢u5•5DTÒyJh‹~‹ª¾K»ŞXŠ¾YÒ’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ¢ÆWB6†$æÖRÒF&vWD6†CòææÖRÇÂ6öçFW‡BææÖS"ÇÂ~Šy.ˆ›"s°Ğ Ğ¢òòKÉXXKÛşyJ‚6†&7FW$–Bˆë~XùnyÉşZéîŠy.ˆ›.YĞĞ¢–b†6öçFW‡Bæ6†&7FW$–BÓÒVæFVf–æVBbb6öçFW‡Bæ6†&7FW'2bb6öçFW‡Bæ6†&7FW'5¶6öçFW‡Bæ6†&7FW$–EÒ’°Ğ¢6†$æÖRÒ6öçFW‡Bæ6†&7FW'5¶6öçFW‡Bæ6†&7FW$–EÒææÖRÇÂ6öçFW‡BææÖS"ÇÂ~Šy.ˆ›"s°Ğ¢ĞĞ Ğ¢òò	ùJ_	ùJ_	ùJRj8kX¾iŠşY
niŠş{êNˆ Ğ¢6öç7B—4w&÷W6†BÒF&vWD6†CòçG—RÓÓÒvw&÷Ws°Ğ¢6öç7Bw&÷WæÖRÒ—4w&÷W6†BòF&vWD6†CòææÖR¢rs°Ğ¢6öç7B&öf–ÆT6öçFW‡DVæ&ÆVBÒ—4w&÷W6†@Ğ¢ÇÂF†—2æçvV6†DFFæ—5&öf–ÆT6öçFW‡D–æ¦V7F–öäVæ&ÆVDf÷$6†Còâ‡F&vWD6†Còæ–B’ÓÒfÇ6S°Ğ Ğ¢òò	ùJRK¸îZI®KŠ®iÚ^k©ˆë~Xùn{êNh‰YûÉ£îˆ®ZJZû‹y¨FÖVÖ&W'2"îXènXû.khhşKŠŞy¨NXù˜ˆPĞ¢ÆWBw&÷WÖVÖ&W'4'&’ÒµÓ°Ğ¢–b†—4w&÷W6†B’°Ğ¢w&÷WÖVÖ&W'4'&’ÒF†—2åö6öÆÆV7Dw&÷W'F–6—çG4f÷$f–ÇFW"‡F&vWD6†BÂ6öçFW‡B“°Ğ¢ĞĞ¢6öç7Bw&÷WÖVÖ&W'2ÒF†—2åöf÷&ÖDw&÷WÖVÖ&W'4f÷%&ö×B†w&÷WÖVÖ&W'4'&’’æ¦ö–â‚~8r“°Ğ Ğ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢òò.ûˆş(:2Šy.ˆ›.XÚKúhşûÈK¸îŠy.ˆ›.XÚŠû¾XùnûÉ¾K¸^YÊiÈZéî™˜^‹XNiii{nk:XZ^ûÈĞ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢–b‡&öf–ÆT6öçFW‡DVæ&ÆVBbb6öçFW‡Bæ6†&7FW$–BÓÒVæFVf–æVBbb6öçFW‡Bæ6†&7FW'2bb6öçFW‡Bæ6†&7FW'5¶6öçFW‡Bæ6†&7FW$–EÒ’°Ğ¢6öç7B6†"Ò6öçFW‡Bæ6†&7FW'5¶6öçFW‡Bæ6†&7FW$–EÓ°Ğ¢6öç7B6†$–æfòÒ'V–ÆEvV6†D6†&7FW$6&D–æfò†6†"“°Ğ¢–b†6†$–æfò’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢6†$–æfòÀĞ¢æÖS¢u5•5DTÒŠy.ˆ›.XÚ’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ¢ĞĞ Ğ¢–b‡&öf–ÆT6öçFW‡DVæ&ÆVBbbÆö&'•6VÆV7F–öâæ—4Æö&'’bbÆö&'•6VÆV7F–öâæ6†&7FW'2æÆVæwF‚â’°Ğ¢6öç7BÆö&'”6†&7FW%7VÖÖ'’ÒÆö&'•6VÆV7F–öâæ6†&7FW'2æÖ†—FVÒÓâF†—2åöf÷&ÖDÆö&'”6†&7FW$FWF–Â†—FVÒ’’æ¦ö–â‚uÆâr“°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢8	ZJ~Xè^ˆNXªy›ŞYŞXÙ^8	[Ù>X˜ŞiŠş˜Y.šhnZJ~Xè^jŠ[ÈşûÈÎ{«şKˆ®[êîKúˆ®ZJXú®XúşXø.ˆ>Kº^Kˆ¾Šy.ˆ›.XÚûÉ¥ÆâG¶Æö&'”6†&7FW%7VÖÖ'—ÖÀĞ¢æÖS¢u5•5DTÒZJ~Xè^Šy.ˆ›.y›ŞYŞXÙR’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ Ğ¢–b‡&öf–ÆT6öçFW‡DVæ&ÆVBbbÆö&'•6VÆV7F–öâæ—4Æö&'’bbÆö&'•6VÆV7F–öâæw&÷W2æÆVæwF‚â’°Ğ¢6öç7BÆö&'”w&÷W7VÖÖ'’ÒÆö&'•6VÆV7F–öâæw&÷W2æÖ†—FVÒÓâ°Ğ¢6öç7BÖVÖ&W%FW‡BÒ'&’æ—4'&’†—FVÒæÖVÖ&W'2’bb—FVÒæÖVÖ&W'2æÆVæwF‚â Ğ¢òûÈh‰YûÉ¢G¶—FVÒæÖVÖ&W'2æ¦ö–â‚~8r—ŞûÈ– Ğ¢¢rs°Ğ¢&WGW&âG¶—FVÒææÖWÒG¶ÖVÖ&W%FW‡GÖ°Ğ¢Ò’æ¦ö–â‚~ûÉ²r“°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢8	ZJ~Xè^ˆNXªyJh‹~{¸N8	[Ù>X˜ŞiŠş˜Y.šhnZJ~Xè^jŠ[ÈşûÈÎ{«şKˆ®[êîKúˆ®ZJKÉXXKÛşyJKº^Kˆ¾yJh‹~{¸NX[>{;¾ûÉ¢G¶Æö&'”w&÷W7VÖÖ'—ÖÀĞ¢æÖS¢u5•5DTÒZJ~Xè^yJh‹~{¸Ny›ŞYŞXÙR’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ Ğ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢òò>ûˆş(:2yJh‹~KúhşûÈ…W'6öæûÈĞ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢òòK¸âDôÒŠû¾XùnyJh‹rW'6öæĞ¢6öç7BW'6öæFW‡F&VÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wW'6öæöFW67&—F–öâr“°Ğ¢–b‡&öf–ÆT6öçFW‡DVæ&ÆVBbbÆö&'•6VÆV7F–öâæ—4Æö&'’bbW'6öæFW‡F&VbbW'6öæFW‡F&VçfÇVRbbW'6öæFW‡F&VçfÇVRçG&–Ò‚’’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢8	yJh‹~Kúhş8	ÆâG·W'6öæFW‡F&VçfÇVRçG&–Ò‚—ÖÀĞ¢æÖS¢u5•5DTÒyJh‹uW'6öæ’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ Ğ¢–b‡&öf–ÆT6öçFW‡DVæ&ÆVBbbÆö&'•6VÆV7F–öâæ—4Æö&'’’°Ğ¢–b†Æö&'•W6W%&öf–ÆW2æÆVæwF‚â’°Ğ¢6öç7B&öf–ÆUFW‡BÒÆö&'•W6W%&öf–ÆW2æÖ†—FVÒÓâ8	G¶—FVÒææÖWŞ8	ÆâG¶—FVÒæFW67&—F–öâÇÂ~i¨.izŠú^yJh‹~K«®ŠëâwÖ’æ¦ö–â‚uÆåÆâr“°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢8	ZJ~Xè^yJh‹~K«®Šëî8	ÆâG·&öf–ÆUFW‡GÖÀĞ¢æÖS¢u5•5DTÒZJ~Xè^yJh‹~K«®Šëâ’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢Æö&'•W6W'2æÆVæwF‚â Ğ¢ò8	ZJ~Xè^yJh‹~ŠxNX‰8	[Ù>X˜ŞZJ~Xè^[{.X»î˜yJh‹~ûÉ¢G¶Æö&'•W6W'2æ¦ö–â‚~8r—Ş8.Kº^(	ÂG·&–Ö'”Æö&'•W6W'Ş(	ŞKÙÎK‹®K‹¾yJh‹~ŠxnŠy.ûÈÎX[nKÙX»î˜yJh‹~XúşKÙÎK‹®YÎYË®K©.XªkhhşiÚ^k©8& Ğ¢¢~8	ZJ~Xè^yJh‹~ŠxNX‰8	[Ù>X˜ŞZJ~Xè^iÊ®X»î˜X[~KÙ>yJh‹~ûÈÎhÈ›¹ŠêNyJh‹~ŠxnŠy.ZHNyn8"rÀĞ¢æÖS¢u5•5DTÒZJ~Xè^yJh‹~ŠxNX‰’’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ Ğ¢ÆWB6öçF7E&öf–ÆTÖW76vRÒçVÆÃ°Ğ¢–b‚—4w&÷W6†B’°Ğ¢6öç7B7W'&VçD6öçF7BÒF&vWD6†Còæ6öçF7D–@Ğ¢òF†—2æçvV6†DFFævWD6öçF7B‡F&vWD6†Bæ6öçF7D–BĞ¢¢F†—2æçvV6†DFFævWD6öçF7D'”æÖR‡F&vWD6†CòææÖRÇÂ6†$æÖR“°Ğ¢–b†7W'&VçD6öçF7B’°Ğ¢6öç7B6öçF7Dæ÷FW2Ò°Ğ¢8	[Ù>X˜Şˆ®ZJZû‹j>j8	ÀĞ¢ˆN{;¾K«®ûÉ¢G¶7W'&VçD6öçF7BææÖRÇÂF&vWD6†CòææÖRÇÂ6†$æÖWÖ Ğ¢Ó°Ğ Ğ¢–b†7W'&VçD6öçF7Bç&VÆF–öâ’°Ğ¢6öçF7Dæ÷FW2çW6‚†X[>{;¾ûÉ¢G¶7W'&VçD6öçF7Bç&VÆF–öçÖ“°Ğ¢ĞĞ¢6öç7B7WÆVÖVçFÅ6WGF–ærÒF†—2åövWEvV6†E7WÆVÖVçFÅ6WGF–ær†7W'&VçD6öçF7B“°Ğ¢–b‡7WÆVÖVçFÅ6WGF–ær’°Ğ¢6öçF7Dæ÷FW2çW6‚†Š^XX^[êîKúŠëîZé®ûÉ¥ÆâG·7WÆVÖVçFÅ6WGF–æwÖ“°Ğ¢ĞĞ¢–b†7W'&VçD6öçF7Bç6÷W&6TÓÓÒv†öæW’rÇÂ7W'&VçD6öçF7Bç6÷W&6TÆ&VÂÓÓÒ~‰ÉÎŠúÒrÇÂ7W'&VçD6öçF7Bç6÷W&6TÆ&VÂÓÓÒ~K‹¾i*Òr’°Ğ¢6öçF7Dæ÷FW2çW6‚†iÚ^k©[©NyJûÉ®‰ÉÎŠúÖ“°Ğ¢–b†7W'&VçD6öçF7Bç6÷W&6TÆ&VÂÓÓÒ~K‹¾i*ÒrÇÂ7G&–ær†7W'&VçD6öçF7Bç&VÆF–öâÇÂrr’æ–æ6ÇVFW2‚~K‹¾i*Òr’’°Ğ¢6öçF7Dæ÷FW2çW6‚†iÚ^k©‹ª¾K»ŞûÉ®K‹¾i*Ö“°Ğ¢ĞĞ¢ĞĞ¢–b†7W'&VçD6öçF7Bæ†öæW•6÷W&6R’°Ğ¢6öçF7Dæ÷FW2çW6‚†ŠêNŠønYË®išşûÉ¢G¶7W'&VçD6öçF7Bæ†öæW•6÷W&6WÖ“°Ğ¢ĞĞ¢–b†7W'&VçD6öçF7Bæ†öæW•f—6–&ÆT–çG&ò’°Ğ¢6öçF7Dæ÷FW2çW6‚†ZûZInyK>Šû~ŠùŞiÊşûÉ¢G¶7W'&VçD6öçF7Bæ†öæW•f—6–&ÆT–çG&÷Ö“°Ğ¢ĞĞ¢–b†7W'&VçD6öçF7Bæ†öæW”†–FFVä&6¶w&÷VæB’°Ğ¢6öçF7Dæ÷FW2çW6‚†™©‰xşŠëîZé®ûÉ¢G¶7W'&VçD6öçF7Bæ†öæW”†–FFVä&6¶w&÷VæGÖ“°Ğ¢6öçF7Dæ÷FW2çW6‚‚~‹ùjë^™©‰xşŠëîZé®iŠşŠú^ˆN{;¾K«®YÊYî{ºŞ[êîKúˆ®ZJ˜xÎy¨NhÈ{ºŞX˜Şhù8.KÚ[ø^š¾ŠëKØşKÚKºÎiŠşhîK˜ŠêNŠøny¨NûÈÎKØnKˆŞŠhyIşzÎZHŞ‹ûh‰ŠûNiˆîKšn8"r“°Ğ¢ĞĞ¢–b†7W'&VçD6öçF7Bç6÷W&6TÓÓÒv†öæW’rÇÂ7W'&VçD6öçF7Bç6÷W&6TÆ&VÂÓÓÒ~‰ÉÎŠúÒrÇÂ7W'&VçD6öçF7Bç6÷W&6TÆ&VÂÓÓÒ~K‹¾i*Òr’°Ğ¢6öç7B†öæW•7VÖÖ'’Òv—BF†—2åövWD†öæW”†÷7E7VÖÖ'”f÷%vV6†D6öçF7B†7W'&VçD6öçF7B“°Ğ¢–b††öæW•7VÖÖ'’’°Ğ¢6öçF7Dæ÷FW2çW6‚†‰ÉÎŠúŞŠë[Ù^h¾{¹>ûÉ¢G¶†öæW•7VÖÖ'—Ö“°Ğ¢ĞĞ¢ĞĞ¢–b†7W'&VçD6öçF7Bç&VÖ&²’°Ğ¢6öçF7Dæ÷FW2çW6‚†ZH~k:ûÉ¢G¶7W'&VçD6öçF7Bç&VÖ&·Ö“°Ğ¢ĞĞ Ğ¢6öçF7E&öf–ÆTÖW76vRÒ°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢6öçF7Dæ÷FW2æ¦ö–â‚uÆâr’ÀĞ¢æÖS¢u5•5DTÒˆN{;¾K«®ŠëîZé¢’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ó°Ğ¢ĞĞ¢ÒVÇ6R°Ğ¢6öçF7E&öf–ÆTÖW76vRÒF†—2åö'V–ÆDw&÷W7WÆVÖVçFÄ6öçF7E&öf–ÆTÖW76vR‡F&vWD6†B“°Ğ¢ĞĞ Ğ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢òò	ùHÂX[ÎZëŠë[ønhù.K»ny¨NY	˜xşj8{J.™I®x+Ğ¢òòŠë[ønhù.K»nKÉ®YÊ‚fWF6‚†–¦6²i{niú^h›îjÚNj~ŠønûÈÎ[›nYÊX[nKˆ®ikhù.XZ^j8{J.X‹y¨NY	˜xşi[hÚàĞ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢6öç7B7F÷&vRÒv–æF÷råf—'GVÅ†öæSòç7F÷&vS°Ğ¢6öç7B6†÷VÆD–æ¦V7EfV7F÷$æ6†÷"Ò‚‚’Óâ°Ğ¢6öç7B&6UW&×2Ò²ÆÆ÷u7VÖÖ'“¢fÇ6RÂÆÆ÷uF&ÆS¢fÇ6RÂÆÆ÷ufV7F÷#¢fÇ6RÓ°Ğ¢6öç7BFVfVÇG2Ò²ââæ&6UW&×2ÂÆÆ÷u7VÖÖ'“¢G'VRÂÆÆ÷ufV7F÷#¢G'VRÓ°Ğ¢G'’°Ğ¢6öç7B&uW&×2Ò7F÷&vSòævWB‚w†öæUöÖVÖ÷'•÷W&Ö—76–öç2r“°Ğ¢6öç7BÆÅW&×2Ò&uW&×0Ğ¢ò‡G—Vöb&uW&×2ÓÓÒw7G&–ærrò¥4ôâç'6R‡&uW&×2’¢&uW&×2Ğ¢¢·Ó°Ğ¢6öç7BvV6†EW&×2Ò†ÆÅW&×2bbG—VöbÆÅW&×2çvV6†BÓÓÒvö&¦V7Br’òÆÅW&×2çvV6†B¢·Ó°Ğ¢6öç7BÖW&vVBÒ²ââæFVfVÇG2ÂââçvV6†EW&×2Ó°Ğ¢&WGW&âÖW&vVBæÆÆ÷ufV7F÷"ÓÒfÇ6S°Ğ¢Ò6F6‚†R’°Ğ¢&WGW&âFVfVÇG2æÆÆ÷ufV7F÷"ÓÒfÇ6S°Ğ¢ĞĞ¢Ò’‚“°Ğ Ğ¢òò[êîKúXh^X»î˜y¨NK‰nyXÎKšnxºÎz¸¾iKîYÊŠy.ˆ›.XÚşyJh‹~KúhşK˜¾Yî8XènXû.XˆnyXÎ{«şK˜¾X˜Ş8 Ğ¢v—Bv–æF÷råf—'GVÅ†öæSòçv÷&ÆF&öö´ÖævW#òæVæEv÷&ÆF&öö´ÖW76vW3òâ†ÖW76vW2ÂwvV6†Br“°Ğ Ğ¢–b‡6†÷VÆD–æ¦V7EfV7F÷$æ6†÷"’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢uµ7F'BæWr6†EÒrÀĞ¢æÖS¢u5•5DTÒXˆnyXÎ{«ò’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ Ğ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢òòNûˆş(:2˜Y.šhnˆ®ZJKˆ®Kˆ¾ih~ûÈKÛşyJKˆîŠë[ønhù.K»ny»YÎy¨Nik[ÈşŠû¾XùnûÈĞ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢6öç7B6öçFW‡DÆ–Ö—BÒ&VE†öæT6öçFW‡DÆ–Ö—B‡v–æF÷råf—'GVÅ†öæSòç7F÷&vRÇÂF†—2æòç7F÷&vR“°Ğ Ğ¢–b†6öçFW‡DÆ–Ö—Bâbb6öçFW‡Bæ6†Bbb'&’æ—4'&’†6öçFW‡Bæ6†B’bb6öçFW‡Bæ6†BæÆVæwF‚â’°Ğ¢6öç7B—4Æö&'•7—7FVÔæö—6RÒ†×6rÂ&t6öçFVçBÒrr’Óâ°Ğ¢–b‚Æö&'•6VÆV7F–öâæ—4Æö&'’’&WGW&âfÇ6S°Ğ¢–b†×6sòæ—5÷W6W"’&WGW&âfÇ6S°Ğ¢6öç7BÆ–åFW‡BÒ7G&–ær‡&t6öçFVçBÇÂrr’ç&WÆ6R‚óÅµãåÒ£âörÂrr’ç&WÆ6R‚õÇ2²örÂrr’çG&–Ò‚“°Ğ¢–b‚Æ–åFW‡B’&WGW&âG'VS°Ğ¢–b‡Æ–åFW‡BÓÓÒuµ7F'BæWr6†EÒr’&WGW&âG'VS°Ğ¢–b‡Æ–åFW‡Bæ–æ6ÇVFW2‚t’‹ùîhêRr’bbÆ–åFW‡Bæ–æ6ÇVFW2‚~Šy.ˆ›.zêybr’bbÆ–åFW‡Bæ–æ6ÇVFW2‚~hš[^zˆ¾[¨òr’’&WGW&âG'VS°Ğ¢–b‚şZh.iéÎh*[{.‹ùîhê^X‹KˆKŠ¥Ç2¤’òçFW7B‡Æ–åFW‡B’’&WGW&âG'VS°Ğ¢–b‚ş[nŠy.ˆ›.ŠëîK‹®jÊ.‹øîš^™Ú.y¨NXªh˜²òçFW7B‡Æ–åFW‡B’’&WGW&âG'VS°Ğ¢–b‚öÖVçUö'WGFöçÆG&vW"Ö÷VæW'Ç7—2×6WGF–æw2Ö'WGFöçÇ&–v‡Dæd†öÆFW'ÆW‡FVç6–öç2×6WGF–æw2Ö'WGFöâö’çFW7B…7G&–ær‡&t6öçFVçBÇÂrr’’’&WGW&âG'VS°Ğ¢&WGW&âfÇ6S°Ğ¢Ó°Ğ Ğ¢6öç7B6öÆÆV7FVD6öçFW‡DÖW76vW2ÒµÓ°Ğ¢f÷"†ÆWB–G‚Ò6öçFW‡Bæ6†BæÆVæwF‚Ò²–G‚ãÒbb6öÆÆV7FVD6öçFW‡DÖW76vW2æÆVæwF‚Â6öçFW‡DÆ–Ö—C²–G‚ÒÒ’°Ğ¢6öç7B×6rÒ6öçFW‡Bæ6†E¶–G…Ó°Ğ¢òò‹{>‹ø~h˜¾iË¢şŠë[ønhù.K»nXh^˜:khhşûÉ¾™©‰xşj[Î[.iÈjÚ>ih~i{nKùŞyYûÈÎ˜şXXŞXÚyJj[Î[.YîXøKŠ.jÚ>ih~8 Ğ¢–b‚×6rÇÂ×6ræ—4v–v•&ö×BÇÂ×6ræ—4v–v”FFÇÂ×6ræ—5†öæTÖW76vR’6öçF–çVS°Ğ Ğ¢òò	ùJRKÉXXKÛşyJ‚×6ræÖW>ûÈ˜Y.šhnjÚ>X‰ZHNynYîy¨NXh^ZëûÈûÈÎXø.ˆ>Šë[ønhù.K»`Ğ¢ÆWB6öçFVçBÒ×6ræÖW2ÇÂ×6ræ6öçFVçBÇÂrs°Ğ Ğ¢òòj~zÛîkˆ^kI~ûÉ®Šë[ønhù.K»nXúşyJi{n‹[Šë[ønhù.K»nûÉ¾Y
nX‰hÈh˜¾iË®iÊÎYË[ÈX[>Y¹î˜ Ğ¢6öçFVçBÒÇ•†öæUFtf–ÇFW"†6öçFVçBÂ²7F÷&vS¢F†—2æòç7F÷&vRÇÂv–æF÷råf—'GVÅ†öæSòç7F÷&vRÒ“°Ğ¢6öçFVçBÒF†—2å÷7G&—vV6†EFw4g&öÕFfW&ä6öçFW‡B†6öçFVçB“°Ğ Ğ¢òòkˆ^yb&6ScBY»îx˜~ûÈ™‹.jÚ.Šû~k.KÙ>‹ø~ZJ~ûÈĞ¢6öçFVçBÒ6öçFVçBç&WÆ6R‚óÆ–ÖuµãåÒ§7&3Õ²"uÖFF¦–ÖvUµâ"uÒ¥²"uÕµãåÒ£âöv’Âu¾Y»îx˜uÒr“°Ğ¢6öçFVçBÒ6öçFVçBç&WÆ6R‚òÅµµåÅÕÒ¥ÅÕÂ†FF¦–ÖvUµâ•Ò¥Â’öv’Âu¾Y»îx˜uÒr“°Ğ¢–b†—4Æö&'•7—7FVÔæö—6R†×6rÂ6öçFVçB’’6öçF–çVS°Ğ Ğ¢6öçFVçBÒ6öçFVçBçG&–Ò‚“°Ğ Ğ¢–b†6öçFVçB’°Ğ¢6öç7B—5W6W"Ò×6ræ—5÷W6W"ÇÂ×6rç&öÆRÓÓÒwW6W"s°Ğ Ğ¢6öÆÆV7FVD6öçFW‡DÖW76vW2çVç6†–gB‡°Ğ¢&öÆS¢—5W6W"òwW6W"r¢v76—7FçBrÀĞ¢6öçFVçC¢f÷&ÖEvV6†EFfW&ä6öçFW‡D6öçFVçB†6öçFVçBÂ²—5W6W"ÂW6W$æÖRÒ’ÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ¢ĞĞ¢ÖW76vW2çW6‚‚ââæ6öÆÆV7FVD6öçFW‡DÖW76vW2“°Ğ¢ĞĞ Ğ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢òò^ûˆş(:2‹zˆ®ZJKˆ®Kˆ¾ih~X[>ˆB{êNˆ®[Šnzxˆ¢òzxˆ®[Šn{êNˆ¢Ğ¢òò	ùJRiKîYÊhùzK®ŠøŞKˆ®™Ú.ûÈÎŠê”XXyÈ¾X‹XènXû.Šë[Ù^XhŞyÈ¾ŠxNX‰Ğ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢6öç7BÆÄ6†G2ÒF†—2æçvV6†DFFævWD6†DÆ—7B‚“°Ğ¢ÆWB&VÆFVD6öçFW‡E7G"Òrs°Ğ¢ÆWB7&÷74w&÷W6†&VD†—7F÷'”6öçFW‡BÒrs°Ğ¢ÆWB6öÖÖöäw&÷WæÖW4f÷%6–ævÆT6†BÒµÓ°Ğ¢ÆWB6öÖÖöäw&÷WÆ—7Df÷%6–ævÆT6†BÒrs°Ğ¢6öç7Bæ÷&ÖÆ—¦U&VÆFVEvV6†DæÖRÒ‡fÇVR’Óâ7G&–ær‡fÇVRÇÂrrĞ¢çG&–Ò‚Ğ¢ç&WÆ6R‚õÇ2²örÂrrĞ¢ç&WÆ6R‚õ¾ûÈ‚…ÕµîûÈûÈ’‚•Ò¥¾ûÈ’•ÒörÂrrĞ¢çFôÆ÷vW$66R‚“°Ğ Ğ¢–b‚6ÆÄÖöFRbb—4w&÷W6†B’°Ğ¢òòXÙ^ˆ®Xú®Š^XX^(	ÎX[YÎ{êNˆ®(	ŞKÙÎK‹®Xø.ˆ>8 Ğ¢6öç7Bæ÷&ÖÆ—¦T6öÖÖöäw&÷WæÖRÒ‡fÇVR’Óâ7G&–ær‡fÇVRÇÂrrĞ¢çG&–Ò‚Ğ¢ç&WÆ6R‚õÇ2²örÂrrĞ¢ç&WÆ6R‚õ¾ûÈ‚…ÕµîûÈûÈ’‚•Ò¥¾ûÈ’•ÒörÂrrĞ¢çFôÆ÷vW$66R‚“°Ğ¢6öç7Bw&÷W6†DÆ–Ö—BÒF†—2å÷&VDæöäæVvF—fTÆ–Ö—B‚wvV6†BÖw&÷WÖ6†BÖÆ–Ö—BrÂ#“°Ğ¢6öç7B7W'&VçD6†DæÖRÒF&vWD6†CòææÖRÇÂ6†$æÖS°Ğ¢6öç7B7W'&VçD6†D¶W’Òæ÷&ÖÆ—¦T6öÖÖöäw&÷WæÖR†7W'&VçD6†DæÖR“°Ğ¢6öç7B&VÆFVDw&÷W6†G2ÒÆÄ6†G2æf–ÇFW"‚†6†B’Óâ°Ğ¢–b†6†CòçG—RÓÒvw&÷Wr’&WGW&âfÇ6S°Ğ¢6öç7BÖVÖ&W'2ÒF†—2åö6öÆÆV7Dw&÷W'F–6—çG4f÷$f–ÇFW"†6†BÂ6öçFW‡B“°Ğ¢&WGW&âÖVÖ&W'2ç6öÖR†ÖVÖ&W"Óâæ÷&ÖÆ—¦T6öÖÖöäw&÷WæÖR†ÖVÖ&W"’ÓÓÒ7W'&VçD6†D¶W’“°Ğ¢Ò“°Ğ¢6öç7B&VÆFVDw&÷WÖWFÒ&VÆFVDw&÷W6†G0Ğ¢æÖ‚†6†B’Óâ°Ğ¢6öç7BæÖRÒ7G&–ær†6†CòææÖRÇÂrr’çG&–Ò‚“°Ğ¢6öç7BÖVÖ&W'2ÒF†—2åöf÷&ÖDw&÷WÖVÖ&W'4f÷%&ö×B€Ğ¢F†—2åö6öÆÆV7Dw&÷W'F–6—çG4f÷$f–ÇFW"†6†BÂ6öçFW‡BĞ¢æÖ†ÖVÖ&W"Óâ7G&–ær†ÖVÖ&W"ÇÂrr’çG&–Ò‚’Ğ¢æf–ÇFW"„&ööÆVâĞ¢“°Ğ¢&WGW&â²6†BÂæÖRÂÖVÖ&W'2Ó°Ğ¢ÒĞ¢æf–ÇFW"†—FVÒÓâ—FVÒææÖR“°Ğ¢6öÖÖöäw&÷WæÖW4f÷%6–ævÆT6†BÒ&VÆFVDw&÷WÖWFæÖ†—FVÒÓâ—FVÒææÖR“°Ğ¢6öÖÖöäw&÷WÆ—7Df÷%6–ævÆT6†BÒ&VÆFVDw&÷WÖWFĞ¢æÖ†—FVÒÓâG¶—FVÒææÖWÒG¶—FVÒæÖVÖ&W'2æÆVæwF‚âò‚G¶—FVÒæÖVÖ&W'2æ¦ö–â‚~8r—Ò–¢rwÖĞ¢æ¦ö–â‚~8r“°Ğ Ğ¢–b‡&VÆFVDw&÷W6†G2æÆVæwF‚â’°Ğ¢&VÆFVD6öçFW‡E7G"³Ò~8	Š^XX^Kˆ®Kˆ¾ih~ûÉ®X[YÎ{êNˆ®Xø.ˆ>8	Æâs°Ğ Ğ¢–b†w&÷W6†DÆ–Ö—Bâ’&VÆFVDw&÷W6†G2æf÷$V6‚†2Óâ°Ğ¢6öç7B×6w2ÒF†—2æçvV6†DFFævWDÖW76vW2†2æ–B’ç6Æ–6R‚Öw&÷W6†DÆ–Ö—B“°Ğ¢–b†×6w2æÆVæwF‚â’°Ğ¢&VÆFVD6öçFW‡E7G"³ÒÒÒÒX[YÎ{êNˆ®Xø.ˆ>ûÉ¢G¶2ææÖWÒÒÒÕÆæ°Ğ¢ÆWBÆ7DFFRÒçVÆÃ°Ğ¢×6w2æf÷$V6‚†ÒÓâ°Ğ¢–b†ÒæFFRbbÒæFFRÓÒÆ7DFFR’°Ğ¢&VÆFVD6öçFW‡E7G"³Ò²G¶ÒæFFWÕÕÆæ°Ğ¢Æ7DFFRÒÒæFFS°Ğ¢ĞĞ¢6öç7B7V¶W"ÒÒæg&öÒÓÓÒvÖRròW6W$æÖR¢†Òæg&öÒÓÓÒw7—7FVÒrò~{;¾{¹òr¢†Òæg&öÒÇÂ~{êNh‰Y‚r’“°Ğ¢ÆWBFW‡BÒF†—2åöf÷&ÖDÖW76vT6öçFVçDf÷%&ö×B†ÒÂ2“°Ğ¢–b†ÒçV÷FR’FW‡BÒ8Î[É^yJ‚G¶ÒçV÷FRç6VæFW'Ó¢G¶ÒçV÷FRæ6öçFVçGŞ8ÒG·FW‡GÖ°Ğ¢&VÆFVD6öçFW‡E7G"³Ò²G¶ÒçF–ÖRÇÂrwÕÒG·7V¶W'Ó¢G·FW‡GÕÆæ°Ğ¢Ò“°Ğ¢&VÆFVD6öçFW‡E7G"³ÒuÆâs°Ğ¢ĞĞ¢Ò“°Ğ¢ĞĞ¢ÒVÇ6R–b‚6ÆÄÖöFRbb—4w&÷W6†B’°Ğ¢7&÷74w&÷W6†&VD†—7F÷'”6öçFW‡BÒF†—2åö'V–ÆD7&÷74w&÷W6†&VD†—7F÷'”6öçFW‡B€Ğ¢F&vWD6†BÀĞ¢ÆÄ6†G2ÀĞ¢6öçFW‡BÀĞ¢W6W$æÖPĞ¢“°Ğ¢6öç7B6–ævÆT6†DÆ–Ö—BÒF†—2å÷&VDæöäæVvF—fTÆ–Ö—B‚wvV6†B×6–ævÆRÖ6†BÖÆ–Ö—BrÂ#“°Ğ¢6öç7BÖVÖ&W$¶W—2ÒæWr6WB†w&÷WÖVÖ&W'4'&’æÖ†ÖVÖ&W"Óâæ÷&ÖÆ—¦U&VÆFVEvV6†DæÖR†ÖVÖ&W"’’æf–ÇFW"„&ööÆVâ’“°Ğ¢–b‡6–ævÆT6†DÆ–Ö—BâbbÖVÖ&W$¶W—2ç6—¦Râ’°Ğ¢6öç7B&VÆFVE6–ævÆT6†G2ÒÆÄ6†G0Ğ¢æf–ÇFW"†6†BÓâ°Ğ¢–b†6†CòçG—RÓÓÒvw&÷Wr’&WGW&âfÇ6S°Ğ¢6öç7B6†DæÖT¶W’Òæ÷&ÖÆ—¦U&VÆFVEvV6†DæÖR†6†CòææÖRÇÂrr“°Ğ¢6öç7B6öçF7BÒ6†Còæ6öçF7D–@Ğ¢òF†—2æçvV6†DFFævWD6öçF7B†6†Bæ6öçF7D–BĞ¢¢F†—2æçvV6†DFFævWD6öçF7D'”æÖR†6†CòææÖRÇÂrr“°Ğ¢6öç7B6öçF7DæÖT¶W’Òæ÷&ÖÆ—¦U&VÆFVEvV6†DæÖR†6öçF7CòææÖRÇÂrr“°Ğ¢&WGW&â†6†DæÖT¶W’bbÖVÖ&W$¶W—2æ†2†6†DæÖT¶W’’’ÇÂ†6öçF7DæÖT¶W’bbÖVÖ&W$¶W—2æ†2†6öçF7DæÖT¶W’’“°Ğ¢ÒĞ¢æf–ÇFW"‚†6†BÂ–æFW‚Â'"’Óâ'"æf–æD–æFW‚†—FVÒÓâ7G&–ær†—FVÓòæ–BÇÂrr’ÓÓÒ7G&–ær†6†Còæ–BÇÂrr’’ÓÓÒ–æFW‚“°Ğ Ğ¢&VÆFVE6–ævÆT6†G2æf÷$V6‚†6†BÓâ°Ğ¢6öç7B×6w2ÒF†—2æçvV6†DFFævWDÖW76vW2†6†Bæ–BĞ¢æf–ÇFW"†ÒÓâ†Óòæ†–FFVäg&öÕ&ö×BÓÓÒG'VRÇÂÓòæ—5F–ÖTÖ&¶W"ÓÓÒG'VRÇÂÓòçG—RÓÓÒwF–ÖUöÖ&¶W"r’Ğ¢ç6Æ–6R‚×6–ævÆT6†DÆ–Ö—B“°Ğ¢–b‚×6w2æÆVæwF‚’&WGW&ã°Ğ Ğ¢–b‚&VÆFVD6öçFW‡E7G"çG&–Ò‚’’&VÆFVD6öçFW‡E7G"³Ò~8	Š^XX^Kˆ®Kˆ¾ih~ûÉ®{êNh‰YXÙ^ˆ®Xø.ˆ>8	Æâs°Ğ¢&VÆFVD6öçFW‡E7G"³ÒÒÒÒ{êNh‰YXÙ^ˆ®Xø.ˆ>ûÉ¢G¶6†BææÖWÒÒÒÕÆæ°Ğ¢ÆWBÆ7DFFRÒçVÆÃ°Ğ¢×6w2æf÷$V6‚†ÒÓâ°Ğ¢–b†ÒæFFRbbÒæFFRÓÒÆ7DFFR’°Ğ¢&VÆFVD6öçFW‡E7G"³Ò²G¶ÒæFFWÕÕÆæ°Ğ¢Æ7DFFRÒÒæFFS°Ğ¢ĞĞ¢6öç7B7V¶W"ÒÒæg&öÒÓÓÒvÖRròW6W$æÖR¢†Òæg&öÒÓÓÒw7—7FVÒrò~{;¾{¹òr¢†Òæg&öÒÇÂ6†BææÖRÇÂ~{êNh‰Y‚r’“°Ğ¢ÆWBFW‡BÒF†—2åöf÷&ÖDÖW76vT6öçFVçDf÷%&ö×B†ÒÂ6†B“°Ğ¢–b†ÒçV÷FR’FW‡BÒ8Î[É^yJ‚G¶ÒçV÷FRç6VæFW'Ó¢G¶ÒçV÷FRæ6öçFVçGŞ8ÒG·FW‡GÖ°Ğ¢&VÆFVD6öçFW‡E7G"³Ò²G¶ÒçF–ÖRÇÂrwÕÒG·7V¶W'Ó¢G·FW‡GÕÆæ°Ğ¢Ò“°Ğ¢&VÆFVD6öçFW‡E7G"³ÒuÆâs°Ğ¢Ò“°Ğ¢ĞĞ¢ĞĞ Ğ¢–b‡&VÆFVD6öçFW‡E7G"çG&–Ò‚’’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢&VÆFVD6öçFW‡E7G"çG&–Ò‚’ÀĞ¢æÖS¢u5•5DTÒ‹zˆ®ZJŠë[øb’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ Ğ¢–b†7&÷74w&÷W6†&VD†—7F÷'”6öçFW‡B’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢7&÷74w&÷W6†&VD†—7F÷'”6öçFW‡BÀĞ¢æÖS¢u5•5DTÒX[nK¹nX[YÎ{êNˆ®Šë[Ù^Kˆîyú^h8^iØ>™™’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ Ğ¢–b†—4w&÷W6†B’°Ğ¢6öç7Bw&÷W†öæW”†÷7E7VÖÖ'”ÖW76vRÒv—BF†—2åö'V–ÆDw&÷W†öæW”†÷7E7VÖÖ'”ÖW76vR‡F&vWD6†BÂw&÷WÖVÖ&W'4'&’“°Ğ¢–b†w&÷W†öæW”†÷7E7VÖÖ'”ÖW76vR’°Ğ¢ÖW76vW2çW6‚†w&÷W†öæW”†÷7E7VÖÖ'”ÖW76vR“°Ğ¢ĞĞ Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢~8	[Ù>X˜Şz©~Xú>Kˆî‹z{êNyú^h8^iØ>™™8	KÚxëYÊXú®ˆ;ŞY¹îZHŞ[Ù>X˜Ş‹ùKŠ®[êîKú{êNz©~Xú>8.{;¾{¹şˆº^hùKé¾K¨n8	{êNh‰YXÙ^ˆ®Xø.ˆ>8	ûÈÎXú®ŠzK®Zû[©N{êNh‰YKˆç··W6W'×ŞYÊzxˆ®KŠŞ[{.{¸şXùyIş‹ø~y¨NX[YÎ{¸şXènûÉ¾k*iÈhùKé¾XÙ^ˆ®Xø.ˆ>y¨Nh‰YKˆŞ[é~X~Š8^yú^˜>zxˆ®Xh^Zë8.{;¾{¹şˆº^hùKé¾K¨n8	X[nK¹nX[YÎ{êNˆ®Šë[Ù^Kˆîyú^h8^iØ>™™8	ûÈÎ[ø^š¾˜	KŠ®iÚ^k©{êN˜^ZèX[nKŠŞy¨Nyú^h8^h‰YYŞXÙ^ûÉ®Xú®iÈYÎi{nXªXZ^iÚ^k©{êNY(Î[Ù>X˜Ş{êNy¨Nh‰YXúşKº^KÛşyJZû[©NŠë[Ù^ûÈÎ[Ù>X˜Ş{êNX[nK¹nh‰YXÛ>KÛşKˆîKÚZHNK¨îYÎKˆz©~Xú>K™ş{¹ŞZûKˆŞ[é~yú^˜>8ZHŞ‹û8i©~zK®h‰nKéŞhÚîŠú^Šë[Ù^KÙÎX{®XøŞ[©N8.iÊ®X‰~X{®y¨NX[nK¹n{êN8™Ùî{êNh‰Yzxˆ®8iÊ®Šû¾khhşY(ÎizX[>z©~Xú>Xh^ZëKˆ[è¾zhjÚ.hùXø®8xÉÎkX¾8[Û[N8h¾{¹>h‰nY¹î[©N8"rÀĞ¢æÖS¢u5•5DTÒz©~Xú>™©Nzk²’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ Ğ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢òòRã^ûˆş(:2h˜¾iË®ˆ®ZJ{;¾{¹şhùzK®ŠøŞûÈ{«şKˆ®jŠ[ÈşûÈĞ¢òò	ùJRiKîYÊ‹zˆ®ZJKˆ®Kˆ¾ih~K˜¾YîûÈÎŠê”XXyÈ¾XènXû.XhŞyÈ¾ŠxNX‰Ğ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢6öç7B&ö×DÖævW"Òv–æF÷råf—'GVÅ†öæSòç&ö×DÖævW#°Ğ¢6öç7B×”7W7FöÔVÖö¦—2ÒF†—2æçvV6†DFFævWD7W7FöÔVÖö¦—2‚“°Ğ¢6öç7B7W7FöÔVÖö¦”æÖW2Ò'&’æ—4'&’†×”7W7FöÔVÖö¦—2Ğ¢ò×”7W7FöÔVÖö¦—2æÖ†RÓâ7G&–ær†SòæFW67&—F–öâÇÂSòææÖRÇÂrr’çG&–Ò‚’’æf–ÇFW"„&ööÆVâĞ¢¢µÓ°Ğ¢6öç7B7W7FöÔVÖö¦”Æ—7BÒ7W7FöÔVÖö¦”æÖW2æÆVæwF‚âò7W7FöÔVÖö¦”æÖW2æ¦ö–â‚~8r’¢~i¨.izXúşyJˆz®Zé®K˜Šh8^XÈRs°Ğ¢6öç7BW'6öæÄ–ÖvUFt–æfòÒF†—2åö'V–ÆEvV6†EW'6öæÄ–ÖvUFt–æfò‡²F&vWD6†BÂ—4w&÷W6†BÒ“°Ğ¢ÆWB7—7FVÕ&ö×BÒrs°Ğ¢6öç7B÷fW'&–FU&WÆ6VÖVçG2Ò°Ğ¢W6W#¢W6W$æÖRÀĞ¢6†DæÖS¢F&vWD6†CòææÖRÇÂ6†$æÖRÀĞ¢6†#¢F&vWD6†CòææÖRÇÂ6†$æÖRÀĞ¢w&÷WæÖRÀĞ¢w&÷WÖVÖ&W'2ÀĞ¢7W7FöÔVÖö¦”Æ—7BÀĞ¢W'6öæÄ–ÖvUFt–æfğĞ¢Ó°Ğ¢6öç7BöæÆ–æT÷fW'&–FU&ö×BÒF†—2åövWDöæÆ–æT÷fW'&–FU&ö×B‡&ö×DÖævW"Â÷fW'&–FU&WÆ6VÖVçG2“°Ğ¢–b†öæÆ–æT÷fW'&–FU&ö×B’°Ğ¢ÖW76vW2çVç6†–gB‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢öæÆ–æT÷fW'&–FU&ö×BÀĞ¢æÖS¢u5•5DTÒ	úz[êîKúzN™™ŠøÒ’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ Ğ¢òò	ùJRjhÚîjŠ[Èş˜hºhùzK®ŠøŞûÈ™Ùî˜	®ŠùŞjŠ[Èşi{nûÈĞ¢–b‚6ÆÄÖöFR’°Ğ¢G'’°Ğ¢–b†—4w&÷W6†Bbb&ö×DÖævW#òævWE&ö×Df÷$fVGW&R’°Ğ¢òò{êNˆ®jŠ[ÈğĞ¢7—7FVÕ&ö×BÒ&ö×DÖævW"ævWE&ö×Df÷$fVGW&R‚wvV6†BrÂvw&÷W6†Br’ÇÂrs°Ğ Ğ¢òò	ùJRˆë~XùnZ[ŞXø¾X‰~ŠyJK¨îzxˆ®z©~Xú>YĞĞ¢6öç7B6öçF7G2ÒF†—2æçvV6†DFFævWD6öçF7G2‚’ÇÂµÓ°Ğ¢6öç7BvV6†D6öçF7G4Æ—7BÒF†—2åöf÷&ÖEvV6†D6öçF7DÆ—7Df÷%&ö×B†6öçF7G2“°Ğ Ğ¢òòi»şhÚ.{êNˆ®y»X[>Xù˜xğĞ¢7—7FVÕ&ö×BÒ7—7FVÕ&ö×@Ğ¢ç&WÆ6R‚õÇµÇ¶w&÷WæÖUÇÕÇÒörÂw&÷WæÖRĞ¢ç&WÆ6R‚õÇµÇ¶6†DæÖUÇÕÇÒörÂ~Z[ŞXø¾ZèÎi[N[êîKúYÒrĞ¢ç&WÆ6R‚õÇµÇ¶w&÷WÖVÖ&W'5ÇÕÇÒörÂw&÷WÖVÖ&W'2Ğ¢ç&WÆ6R‚õÇµÇ·vV6†D6öçF7G5ÇÕÇÒörÂvV6†D6öçF7G4Æ—7BĞ¢ç&WÆ6R‚õÇµÇ¶7W7FöÔVÖö¦”Æ—7EÇÕÇÒörÂ7W7FöÔVÖö¦”Æ—7BĞ¢ç&WÆ6R‚õÇµÇ·W'6öæÄ–ÖvUFt–æfõÇÕÇÒörÂW'6öæÄ–ÖvUFt–æfò“°Ğ¢ÒVÇ6R–b‡&ö×DÖævW#òævWE&ö×Df÷$fVGW&R’°Ğ¢òòXÙ^ˆ®jŠ[ÈğĞ¢7—7FVÕ&ö×BÒ&ö×DÖævW"ævWE&ö×Df÷$fVGW&R‚wvV6†BrÂvöæÆ–æRr’ÇÂrs°Ğ¢òò	ùJRi»şhÚ.XÙ^ˆ®z©~Xú>YŞXù˜xğĞ¢6öç7B6†DæÖRÒF&vWD6†CòææÖRÇÂ6†$æÖS°Ğ¢7—7FVÕ&ö×BÒ7—7FVÕ&ö×@Ğ¢ç&WÆ6R‚õÇµÇ¶6†DæÖUÇÕÇÒörÂ6†DæÖRĞ¢ç&WÆ6R‚õÇµÇ¶6öÖÖöäw&÷WæÖW5ÇÕÇÒörÂ6öÖÖöäw&÷WæÖW4f÷%6–ævÆT6†BæÆVæwF‚âò6öÖÖöäw&÷WæÖW4f÷%6–ævÆT6†Bæ¦ö–â‚~8r’¢~izrĞ¢ç&WÆ6R‚õÇµÇ¶6öÖÖöäw&÷WÆ—7EÇÕÇÒörÂ6öÖÖöäw&÷WÆ—7Df÷%6–ævÆT6†BÇÂ~izrĞ¢ç&WÆ6R‚õÇµÇ¶7W7FöÔVÖö¦”Æ—7EÇÕÇÒörÂ7W7FöÔVÖö¦”Æ—7BĞ¢ç&WÆ6R‚õÇµÇ·W'6öæÄ–ÖvUFt–æfõÇÕÇÒörÂW'6öæÄ–ÖvUFt–æfò“°Ğ¢ĞĞ¢Ò6F6‚†R’°Ğ¢6öç6öÆRçv&â‚~)ªûˆòˆë~Xùn[êîKúˆ®ZJhùzK®ŠøŞZK‹JS¢rÂR“°Ğ¢ĞĞ¢ĞĞ Ğ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢òònûˆş(:2[Ù>X˜Ş[êîKúˆ®ZJŠë[ÙRò˜	®ŠùŞŠë[ÙPĞ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢6öç7BvV6†DÖW76vW2ÒF†—2æçvV6†DFFævWDÖW76vW2‡F&vWD6†Bæ–B“°Ğ¢6öç7BÆFW7EW6W$ÖW76vT–E6WBÒæWr6WB€Ğ¢„'&’æ—4'&’†÷F–öç2æÆFW7EW6W$ÖW76vT–G2’ò÷F–öç2æÆFW7EW6W$ÖW76vT–G2¢µÒĞ¢æÖ†–BÓâ7G&–ær†–BÇÂrr’çG&–Ò‚’Ğ¢æf–ÇFW"„&ööÆVâĞ¢“°Ğ¢òòiÊÎ‹Úî[è^Y¹îZHŞkhhşKÉ®XÙ^xºÎiKîXZ^iÊ¾[îy¨N(	ÎyJh‹~iÈik‹é>XZ^(	ŞûÈÎKˆŞXhŞk{~XZ^[{.iÈˆ®ZJŠë[Ù^8 Ğ¢6öç7BÆFW7EW6W$ÖW76vW2ÒÆFW7EW6W$ÖW76vT–E6WBç6—¦Râ Ğ¢òvV6†DÖW76vW2æf–ÇFW"†×6rÓâÆFW7EW6W$ÖW76vT–E6WBæ†2…7G&–ær†×6sòæ–BÇÂrr’çG&–Ò‚’’Ğ¢¢µÓ°Ğ¢6öç7B†—7F÷'•vV6†DÖW76vW2ÒÆFW7EW6W$ÖW76vT–E6WBç6—¦Râ Ğ¢òvV6†DÖW76vW2æf–ÇFW"†×6rÓâÆFW7EW6W$ÖW76vT–E6WBæ†2…7G&–ær†×6sòæ–BÇÂrr’çG&–Ò‚’’Ğ¢¢vV6†DÖW76vW3°Ğ Ğ¢òò	ùJRjhÚîˆ®ZJ{¾Yè¾XªhŠû¾Xùn™™X‹niÚi[ûÈ†—4w&÷W6†BY(Â7F÷&vR[{.YÊKˆ®ikZ;iˆîûÈĞ¢6öç7BvV6†DÆ–Ö—BÒ—4w&÷W6†@Ğ¢òF†—2å÷&VDæöäæVvF—fTÆ–Ö—B‚wvV6†BÖw&÷WÖ6†BÖÆ–Ö—BrÂ#Ğ¢¢F†—2å÷&VDæöäæVvF—fTÆ–Ö—B‚wvV6†B×6–ævÆRÖ6†BÖÆ–Ö—BrÂ#“°Ğ Ğ¢òò	ùJR[^[È6ÆÅ÷&V6÷&By¨BG&ç67&—BYîhÈKªNK©.iÚi[hŠ®Xù`Ğ¢òò˜n[¨ş˜ŞXènûÈÎ[^[È6ÆÅ÷&V6÷&BXh^˜:ŠÎi[ûÈÎy»NX‹h¾KªNK©.jÊi[‹ëîX‹vV6†DÆ–Ö—@Ğ¢ÆWB&V6VçEvV6†DÖW76vW2ÒµÓ°Ğ¢–b‡vV6†DÆ–Ö—Bâ’°Ğ¢ÆWBF÷FÄÆ–æW2Ò°Ğ¢ÆWB7F'D–G‚Ò†—7F÷'•vV6†DÖW76vW2æÆVæwFƒ°Ğ¢f÷"†ÆWB’Ò†—7F÷'•vV6†DÖW76vW2æÆVæwF‚Ò²’ãÒ²’ÒÒ’°Ğ¢6öç7B×6rÒ†—7F÷'•vV6†DÖW76vW5¶•Ó°Ğ¢–b†×6sòæ†–FFVäg&öÕ&ö×BÓÓÒG'VRÇÂ×6sòæ—5F–ÖTÖ&¶W"ÓÓÒG'VRÇÂ×6sòçG—RÓÓÒwF–ÖUöÖ&¶W"r’°Ğ¢6öçF–çVS°Ğ¢ĞĞ¢–b†×6rçG—RÓÓÒv6ÆÅ÷&V6÷&Br’°Ğ¢6öç7BG&ç67&—D6÷VçBÒ'&’æ—4'&’†×6rçG&ç67&—B’ò×6rçG&ç67&—BæÆVæwF‚¢°Ğ¢F÷FÄÆ–æW2³Ò×6rç7FGW2ÓÓÒvç7vW&VBròG&ç67&—D6÷VçB²"¢°Ğ¢ÒVÇ6R°Ğ¢F÷FÄÆ–æW2³Ò°Ğ¢ĞĞ¢–b‡F÷FÄÆ–æW2ãÒvV6†DÆ–Ö—B’°Ğ¢7F'D–G‚Ò“°Ğ¢'&V³°Ğ¢ĞĞ¢7F'D–G‚Ò“°Ğ¢ĞĞ¢&V6VçEvV6†DÖW76vW2Ò†—7F÷'•vV6†DÖW76vW2ç6Æ–6R‡7F'D–G‚“°Ğ¢ĞĞ¢6öç7B”–ÖvTFF66†RÒæWrÖ‚“°Ğ¢6öç7B”–ÖvTæ÷FW2ÒµÓ°Ğ¢6öç7B”–ÖvUFö¶Vä–G2ÒµÓ°Ğ¢6öç7BÆFW7Ef—6–öä–ÖvT6÷VçBÒÆFW7EW6W$ÖW76vW0Ğ¢æf–ÇFW"†ÖW76vRÓâÖW76vSòçG—RÓÓÒv–ÖvRrbbÖW76vSòæ†–FFVäg&öÕ&ö×BÓÒG'VRĞ¢æÆVæwFƒ°Ğ¢6öç7B”–ÖvT6†$Æ–Ö—BÒvWEvV6†D”–ÖvT6†$Æ–Ö—B†ÆFW7Ef—6–öä–ÖvT6÷VçB“°Ğ Ğ¢6öç7B×W6–4Æ—7FVæ–æt6öçFW‡BÒ6ÆÄÖöFPĞ¢òF†—2åö'V–ÆD×W6–4Æ—7FVæ–æt6öçFW‡B‡F&vWD6†BÂW6W$æÖRĞ¢¢rs°Ğ¢6öç7B6F&÷„6ôF÷D6öçFW‡BÒ6ÆÄÖöFRbb—4w&÷W6†@Ğ¢ò7G&–ær‡F†—2åövWD6F&÷„FF‚’ævWD6ôF÷D6öçFW‡Df÷$6†Còâ‡F&vWD6†Còæ–BÂF&vWD6†CòææÖRÇÂ6†$æÖR’ÇÂrr’ç&WÆ6R‚õÇµÇ·W6W%ÇÕÇÒörÂW6W$æÖRĞ¢¢rs°Ğ Ğ¢6öç7BF–ÖTÖævW"Òv–æF÷råf—'GVÅ†öæSòçF–ÖTÖævW#°Ğ¢6öç7B&VÅF–ÖT–æfòÒF†—2åöf÷&ÖE&VÄFFUF–ÖR‡&ö7F—fTÖWFææ÷rÇÂFFRææ÷r‚’“°Ğ¢6öç7BW6U&VÅF–ÖTf÷$öæÆ–æT6†BÒF†—2å÷6†÷VÆEW6U&VÅF–ÖTf÷$öæÆ–æT6†B†÷F–öç2“°Ğ¢6öç7B7F÷'•F–ÖT–æfòÒF–ÖTÖævW#òævWD7W'&VçE7F÷'•F–ÖSòâ‚“°Ğ¢6öç7B7W'&VçEF–ÖRÒW6U&VÅF–ÖTf÷$öæÆ–æT6†@Ğ¢ò&VÅF–ÖT–æfòçF–ÖPĞ¢¢‡7F÷'•F–ÖT–æfóòçF–ÖRÇÂs#£3r“°Ğ¢6öç7B7W'&VçDFFUF–ÖUFW‡BÒW6U&VÅF–ÖTf÷$öæÆ–æT6†@Ğ¢òG·&VÅF–ÖT–æfòæFFWÒG·&VÅF–ÖT–æfòçF–ÖWÖ Ğ¢¢G·7F÷'•F–ÖT–æfóòæFFRÇÂrwÒG·7F÷'•F–ÖT–æfóòçF–ÖRÇÂ7W'&VçEF–ÖWÖçG&–Ò‚“°Ğ Ğ¢6öç7BVæEvV6†D6†EG&ç67&—BÒ7–æ2†6†BÂÖW76vW4f÷$6†BÂf÷&ÖD÷F–öç2Ò·Ò’Óâ°Ğ¢6öç7B–æ6ÇVFT†VFW"Òf÷&ÖD÷F–öç2æ–æ6ÇVFT†VFW"ÓÒfÇ6S°Ğ¢6öç7B–æ6ÇVFTFFW2Òf÷&ÖD÷F–öç2æ–æ6ÇVFTFFW2ÓÒfÇ6S°Ğ¢6öç7B–æ6ÇVFUf—6–öä–ÖvW2Òf÷&ÖD÷F–öç2æ–æ6ÇVFUf—6–öä–ÖvW2ÓÓÒG'VS°Ğ¢ÆWBFW‡BÒ–æ6ÇVFT†VFW"ò)H)H)HG¶6†BææÖWÒy¨Nˆ®ZJŠë[ÙR)H)H)HÆæ¢rs°Ğ¢ÆWBÆ7DFFRÒçVÆÃ°Ğ¢6öç7B6†D—4w&÷WÒ6†CòçG—RÓÓÒvw&÷Ws°Ğ Ğ¢f÷"†6öç7B×6röbÖW76vW4f÷$6†B’°Ğ¢–b†×6sòæ†–FFVäg&öÕ&ö×BÓÓÒG'VRÇÂ×6sòæ—5F–ÖTÖ&¶W"ÓÓÒG'VRÇÂ×6sòçG—RÓÓÒwF–ÖUöÖ&¶W"r’°Ğ¢6öçF–çVS°Ğ¢ĞĞ¢6öç7B—5W6W"Ò×6ræg&öÒÓÓÒvÖRs°Ğ¢ÆWB7V¶W"Ò—5W6W"òW6W$æÖR¢6†BææÖS°Ğ¢–b‚—5W6W"bb6†D—4w&÷Wbb×6ræg&öÒbb×6ræg&öÒÓÒw7—7FVÒr’°Ğ¢7V¶W"Ò×6ræg&öÓ°Ğ¢ĞĞ Ğ¢–b†–æ6ÇVFTFFW2bb×6ræFFRbb×6ræFFRÓÒÆ7DFFR’°Ğ¢FW‡B³ÒÒÒÒG¶×6ræFFWÒÒÒÕÆæ°Ğ¢Æ7DFFRÒ×6ræFFS°Ğ¢ĞĞ Ğ¢6öç7BF–ÖU7G"Ò×6rçF–ÖRò²G¶×6rçF–ÖWÕÒ¢rs°Ğ¢6öç7BV÷FU7G"Ò×6rçV÷FRò8Î[É^yJ‚G¶×6rçV÷FRç6VæFW'Ó¢G¶×6rçV÷FRæ6öçFVçGŞ8Ö¢rs°Ğ Ğ¢–b†×6ræg&öÒÓÓÒw7—7FVÒrÇÂ×6rçG—RÓÓÒw7—7FVÒr’°Ğ¢FW‡B³ÒG·F–ÖU7G'Õ¾{;¾{¹õÒG¶×6ræ6öçFVçBÇÂrwÕÆæ°Ğ¢ÒVÇ6R–b†×6rçG—RÓÓÒv6ÆÅ÷&V6÷&Br’°Ğ¢FW‡B³ÒF†—2åöf÷&ÖD6ÆÅ&V6÷&Df÷%&ö×B†×6rÂW6W$æÖRÂF–ÖU7G"“°Ğ¢ÒVÇ6R–b†×6rçG—RÓÓÒv–ÖvRr’°Ğ¢6öç7B–ÖvUFW‡BÒF†—2åöf÷&ÖDÖW76vT6öçFVçDf÷%&ö×B†×6rÂ6†B’ÇÂu¾Y»îx˜uÒs°Ğ¢6öç7B&W6öÇfVD–ÖvTFFÒ–æ6ÇVFUf—6–öä–ÖvW0Ğ¢òv—BF†—2å÷&W6öÇfUvV6†D–ÖvTf÷$’†×6ræ6öçFVçBÂ”–ÖvTFF66†RÂ²Ö„6†'3¢”–ÖvT6†$Æ–Ö—BÒĞ¢¢rs°Ğ¢–b†–æ6ÇVFUf—6–öä–ÖvW2bb&W6öÇfVD–ÖvTFFbb&W6öÇfVD–ÖvTFFç7F'G5v—F‚‚vFF¦–ÖvRr’’°Ğ¢6öç7B–Öt–BÒõõ5Eõ„ôäUô”ÔtUòG´FFRææ÷r‚—ÕòG´ÖF‚ç&æFöÒ‚’çFõ7G&–ærƒ3b’ç7V'7G"ƒ"ÂR—Õõö°Ğ¢–b‚v–æF÷råf—'GVÅ†öæRå÷VæF–æt–ÖvW2’°Ğ¢v–æF÷råf—'GVÅ†öæRå÷VæF–æt–ÖvW2Ò·Ó°Ğ¢ĞĞ¢v–æF÷råf—'GVÅ†öæRå÷VæF–æt–ÖvW5¶–Öt–EÒÒ°Ğ¢W&Ã¢&W6öÇfVD–ÖvTFFÀĞ¢Æ&VÃ¢–ÖvUFW‡@Ğ¢Ó°Ğ¢”–ÖvUFö¶Vä–G2çW6‚†–Öt–B“°Ğ¢”–ÖvTæ÷FW2çW6‚†G·F–ÖU7G'ÒG·7V¶W'Ó¢G·V÷FU7G'ÒG¶–ÖvUFW‡GÒG¶–Öt–GÖ“°Ğ¢FW‡B³ÒG·F–ÖU7G'ÒG·7V¶W'Ó¢G·V÷FU7G'ÒG¶–ÖvUFW‡GÕÆæ°Ğ¢ÒVÇ6R°Ğ¢FW‡B³ÒG·F–ÖU7G'ÒG·7V¶W'Ó¢G·V÷FU7G'ÒG¶–ÖvUFW‡GÕÆæ°Ğ¢ĞĞ¢ÒVÇ6R–b†×6rçG—RÓÓÒv–ÖvU÷&ö×Br’°Ğ¢òò	ùJRKúîZHŞûÉ®[b¾Y»îx˜rşŠxnš)Òj~zÛîXéşj~XÈ^Š;Y¹îXë°Ğ¢FW‡B³ÒG·F–ÖU7G'ÒG·7V¶W'Ó¢G·V÷FU7G'ÒG·F†—2åöf÷&ÖD–ÖvU&ö×EFtf÷%&ö×B†×6r—ÕÆæ°Ğ¢ÒVÇ6R–b†×6rçG—RÓÓÒwG&ç6fW"r’°Ğ¢òò	ùJRKúîZHŞûÉ®y»Nhê^[n‹ÚÎ‹Jnx«nh‹KNYÊih~ZÙ~Yî™Ú Ğ¢6öç7B&u7FGW2Ò7G&–ær†×6rç7FGW2ÇÂrr’çG&–Ò‚“°Ğ¢6öç7B7FGW2Ò&u7FGW2ÓÓÒw&V6V—fVBrò~[{.iKnjËâr¢‡&u7FGW2ÓÓÒw&VgVæFVBrò~[{.˜Y¹âr¢~iÊ®iKnjËâr“°Ğ¢FW‡B³ÒG·F–ÖU7G'ÒG·7V¶W'Ó¢G·V÷FU7G'Õ¾‹ÚÎ‹Jb*RG¶×6ræÖ÷VçGÕŞûÈx«nhûÉ¢G·7FGW7ŞûÈ•Ææ°Ğ¢ÒVÇ6R–b†×6rçG—RÓÓÒw&VG6¶WBr’°Ğ¢6öç7B&u7FGW2Ò7G&–ær†×6rç7FGW2ÇÂrr’çG&–Ò‚“°Ğ¢6öç7B6Æ–×2Ò'&’æ—4'&’†×6ræ6Æ–×2’ò×6ræ6Æ–×2¢µÓ°Ğ¢6öç7B7FGW2Ò&u7FGW2ÓÓÒv÷VæVBrò~[{.š(nXùbr¢‡&u7FGW2ÓÓÒw&VgVæFVBrò~[{.˜Y¹âr¢†6Æ–×2æÆVæwF‚âò~˜:Xˆnš(nXùbr¢~iÊ®š(nXùbr’“°Ğ¢6öç7BG&ç67&—D—4w&÷WÒ6†CòçG—RÓÓÒvw&÷Ws°Ğ¢6öç7B6¶WDÖöFRÒ7G&–ær†×6rç6¶WDÖöFRÇÂrr’çG&–Ò‚“°Ğ¢6öç7B—4w&÷W6¶WBÒG&ç67&—D—4w&÷Wbb†×6ræ—4w&÷W6¶WBÓÓÒG'VRÇÂ6¶WDÖöFRÓÓÒvw&÷WöÇV6·’rÇÂ6¶WDÖöFRÓÓÒvw&÷WöfW&vRr“°Ğ¢6öç7B&V6—–VçDæÖRÒ7G&–ær†×6rç&V6—–VçDæÖRÇÂ×6rçF&vWDæÖRÇÂrr’çG&–Ò‚“°Ğ¢6öç7B6Æ–ÕFW‡BÒ6Æ–×2æÆVæwF‚â Ğ¢òûÙÎ[{.š(nXùnûÉ¢G¶6Æ–×2æÖ†6Æ–ÒÓâG¶6Æ–ÒææÖRÇÂ~{êNh‰Y‚wÒ*RG´çVÖ&W"ç'6TfÆöB†6Æ–ÒæÖ÷VçBÇÂ’çFôf—†VBƒ"—Ö’æ¦ö–â‚~8r—Ö Ğ¢¢rs°Ğ¢ÆWB6¶WEFW‡BÒrs°Ğ¢–b†—4w&÷W6¶WB’°Ğ¢6öç7B6¶WEG—RÒ6¶WDÖöFRÓÓÒvw&÷WöfW&vRrò~YØ~Xˆn{ª.XÈRr¢~h»Îh˜¾k	N{ª.XÈRs°Ğ¢6öç7BÖ÷VçBÒçVÖ&W"ç'6TfÆöB†×6ræÖ÷VçBÇÂ“°Ğ¢6öç7BÖ÷VçEFW‡BÒçVÖ&W"æ—4f–æ—FR†Ö÷VçB’ò*RG¶Ö÷VçBçFôf—†VBƒ"—Ö¢~˜yš)ŞiÊ®yúRs°Ğ¢6öç7B6¶WD6÷VçBÒÖF‚æÖ‚ƒÂçVÖ&W"ç'6T–çB†×6ræ6÷VçBÇÂ×6rç6¶WD6÷VçBÇÂÂ’ÇÂ“°Ğ¢6öç7Bw&÷W7FGW2Ò&u7FGW2ÓÓÒv÷VæVBrò~[{.š(nZèÂr¢‡&u7FGW2ÓÓÒw&VgVæFVBrò~[{.˜Y¹âr¢†6Æ–×2æÆVæwF‚âò~˜:Xˆnš(nXùbr¢~iÊ®š(nXùbr’“°Ğ¢6¶WEFW‡BÒ¾{êN{ª.XÈ^ûÙÎ{¾Yè¾ûÉ¢G·6¶WEG—WŞûÙÎh¾˜yš)ŞûÉ¢G¶Ö÷VçEFW‡GŞûÙÎ{ª.XÈ^KŠ®i[ûÉ¢G·6¶WD6÷VçBÇÂ~iÊ®Šë[ÙRwÕŞûÈx«nhûÉ¢G¶w&÷W7FGW7ÒG¶6Æ–ÕFW‡GŞûÈ–°Ğ¢ÒVÇ6R–b‡G&ç67&—D—4w&÷Wbb&V6—–VçDæÖR’°Ğ¢6¶WEFW‡BÒ¾{¹’G·&V6—–VçDæÖWŞy¨N{ª.XÈR*RG¶×6ræÖ÷VçGÕŞûÈx«nhûÉ¢G·7FGW7ŞûÈ–°Ğ¢ÒVÇ6R°Ğ¢6¶WEFW‡BÒ¾{ª.XÈR*RG¶×6ræÖ÷VçGÕŞûÈx«nhûÉ¢G·7FGW7ŞûÈ–°Ğ¢ĞĞ¢FW‡B³ÒG·F–ÖU7G'ÒG·7V¶W'Ó¢G·V÷FU7G'ÒG·6¶WEFW‡GÕÆæ°Ğ¢ÒVÇ6R–b†×6rçG—RÓÓÒvÆö6F–öâr’°Ğ¢6öç7BÆö6F–öåFW‡BÒ7G&–ær†×6ræÆö6F–öåFW‡BÇÂ×6ræÆö6F–öäFG&W72ÇÂ×6ræ6öçFVçBÇÂrr’çG&–Ò‚“°Ğ¢FW‡B³ÒG·F–ÖU7G'ÒG·7V¶W'Ó¢G·V÷FU7G'Õ¾Zé®KØÕŞûÈ‚G¶Æö6F–öåFW‡BÇÂ~iÊ®yú^KØŞ{ÚâwŞûÈ•Ææ°Ğ¢ÒVÇ6R–b†×6rçG—RÓÓÒv6F&÷…ö6&Uö6&Br’°Ğ¢6öç7Bæ÷FUFW‡BÒ×6ræ6F&÷„æ÷FRòûÈÎyYŠˆûÉ¢G¶×6ræ6F&÷„æ÷FWÖ¢rs°Ğ¢FW‡B³ÒG·F–ÖU7G'ÒG·7V¶W'Ó¢G·V÷FU7G'Õ¾xÊ¾y¹.xZ~šåÒKÛşyJ‚G¶×6ræ6F&÷„—FVÔæÖRÇÂ~™»nš9òw×‚G¶×6ræ6F&÷…VçF—G’ÇÂÒG¶æ÷FUFW‡GÕÆæ°Ğ¢ÒVÇ6R°Ğ¢6öç7BÆ–æUFW‡BÒF†—2åöf÷&ÖDÖW76vT6öçFVçDf÷%&ö×B†×6rÂ6†B“°Ğ¢FW‡B³ÒG·F–ÖU7G'ÒG·7V¶W'Ó¢G·V÷FU7G'ÒG¶Æ–æUFW‡BÇÂrwÕÆæ°Ğ¢ĞĞ¢ĞĞ¢&WGW&âFW‡BçG&–Ò‚“°Ğ¢Ó°Ğ Ğ¢òòXX{¹şKˆièN[»®[êîKúˆ®ZJXènXû.ûÈih~iÊÂ²Y»îx˜r²˜	®ŠùŞŠë[Ù^ûÈûÈÎ˜	®ŠùŞjŠ[ÈşK™şZHŞyJ‹ùjë^Kˆ®Kˆ¾ihpĞ¢ÆWBvV6†EG&ç67&—BÒrs°Ğ¢–b†—5&ö7F—fRbb6ÆÄÖöFR’°Ğ¢6öç7BG&ç67&—E6V7F–öç2ÒµÓ°Ğ¢6öç7BÆÅvV6†D6†G2ÒF†—2æçvV6†DFFævWD6†DÆ—7B‚“°Ğ¢f÷"†6öç7B6†BöbÆÅvV6†D6†G2’°Ğ¢6öç7BÆ–Ö—BÒ6†CòçG—RÓÓÒvw&÷WpĞ¢òF†—2å÷&VDæöäæVvF—fTÆ–Ö—B‚wvV6†BÖw&÷WÖ6†BÖÆ–Ö—BrÂ#Ğ¢¢F†—2å÷&VDæöäæVvF—fTÆ–Ö—B‚wvV6†B×6–ævÆRÖ6†BÖÆ–Ö—BrÂ#“°Ğ¢–b†Æ–Ö—BÃÒ’6öçF–çVS°Ğ¢6öç7B6†DÖW76vW2ÒF†—2æçvV6†DFFævWDÖW76vW2†6†Bæ–B’ç6Æ–6R‚ÖÆ–Ö—B“°Ğ¢–b†6†DÖW76vW2æÆVæwF‚ÓÓÒ’6öçF–çVS°Ğ¢6öç7B6V7F–öâÒv—BVæEvV6†D6†EG&ç67&—B†6†BÂ6†DÖW76vW2“°Ğ¢–b‡6V7F–öâ’G&ç67&—E6V7F–öç2çW6‚‡6V7F–öâ“°Ğ¢ĞĞ¢–b‡G&ç67&—E6V7F–öç2æÆVæwF‚â’°Ğ¢vV6†EG&ç67&—BÒ~8		ù;h˜¾iË®[êîKú[{.iÈkhhş8	Æâs°Ğ¢vV6†EG&ç67&—B³Ò(û[Ù>X˜Şi{n™{NûÉ¢G¶7W'&VçEF–ÖWÕÆæ°Ğ¢vV6†EG&ç67&—B³ÒKº^Kˆ¾iŠşyJh‹~h˜¾iË®[{.{¸şZÙYÊy¨N[êîKúkhhşŠë[Ù^8.KÛşyJ[êîKúi{nûÈÎŠû~KŠ^jÎ˜^Zè[Ù>X˜Ş[êîKújŠ[ÈşŠxNX‰ûÈÎKˆŞ[é~˜xŞZHŞ[{.iÈˆ®ZJŠë[Ù^Xh^Zë8%ÆåÆæ°Ğ¢vV6†EG&ç67&—B³ÒG&ç67&—E6V7F–öç2æ¦ö–â‚uÆåÆâr“°Ğ¢ĞĞ¢ÒVÇ6R°Ğ¢–b‡&V6VçEvV6†DÖW76vW2æÆVæwF‚â’°Ğ¢vV6†EG&ç67&—BÒ~8		ù;h˜¾iË®[êîKú[{.iÈkhhş8	Æâs°Ğ¢vV6†EG&ç67&—B³Ò(û[Ù>X˜Şi{n™{NûÉ¢G¶7W'&VçEF–ÖWÕÆæ°Ğ¢vV6†EG&ç67&—B³ÒKº^Kˆ¾iŠşyJh‹~h˜¾iË®[{.{¸şZÙYÊy¨N[êîKúkhhşŠë[Ù^8.KÛşyJ[êîKúi{nûÈÎŠû~KŠ^jÎ˜^Zè[Ù>X˜Ş[êîKújŠ[ÈşŠxNX‰ûÈÎ[›nKŠ^jÎhš~ŠÎ8	[êîKú{«şKˆ¾jŠ[Èş8	X[>K¨îXènXû.khhşKˆŞXúş˜xŞZHŞyIşh‰y¨N{ªniÙşûÈÎKˆŞ[é~˜xŞZHŞ[{.iÈˆ®ZJŠë[Ù^Xh^Zë8%Ææ°Ğ¢vV6†EG&ç67&—B³ÒÆæ°Ğ¢vV6†EG&ç67&—B³Òv—BVæEvV6†D6†EG&ç67&—B‡F&vWD6†BÂ&V6VçEvV6†DÖW76vW2“°Ğ¢ĞĞ¢ĞĞ¢6öç7Bf÷&ÖGFVDÆFW7EW6W$–çWBÒ—5&ö7F—fRbb6ÆÄÖöFRbbÆFW7EW6W$ÖW76vW2æÆVæwF‚â Ğ¢òv—BVæEvV6†D6†EG&ç67&—B‡F&vWD6†BÂÆFW7EW6W$ÖW76vW2Â°Ğ¢–æ6ÇVFT†VFW#¢fÇ6RÀĞ¢–æ6ÇVFTFFW3¢fÇ6RÀĞ¢–æ6ÇVFUf—6–öä–ÖvW3¢G'VPĞ¢ÒĞ¢¢rs°Ğ¢6öç7B†öæT6ÆÄ†—7F÷'”6öçFW‡BÒ—4w&÷W6†@Ğ¢òF†—2åö'V–ÆE†öæT6ÆÄ†—7F÷'”6öçFW‡Df÷%6–ævÆT6†B‡F&vWD6†BÂW6W$æÖRĞ¢¢rs°Ğ¢6öç7B†öæU6×4†—7F÷'”6öçFW‡BÒ—4w&÷W6†@Ğ¢òF†—2åö'V–ÆE†öæU6×4†—7F÷'”6öçFW‡Df÷%6–ævÆT6†B‡F&vWD6†BÂW6W$æÖRĞ¢¢rs°Ğ¢6öç7B6–ævÆT6†DÖöÖVçG46öçFW‡BÒ—4w&÷W6†@Ğ¢òF†—2åö'V–ÆE6–ævÆT6†DÖöÖVçG46öçFW‡B‡F&vWD6†BÂW6W$æÖRĞ¢¢rs°Ğ¢6öç7Bw&÷W6†DÖöÖVçG46öçFW‡BÒ—4w&÷W6†@Ğ¢òF†—2åö'V–ÆDw&÷W6†DÖöÖVçG46öçFW‡B‡F&vWD6†BÂ6öçFW‡BĞ¢¢rs°Ğ Ğ¢–b‚6ÆÄÖöFRbb6F&÷„6ôF÷D6öçFW‡B’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢6F&÷„6ôF÷D6öçFW‡BÀĞ¢æÖS¢u5•5DTÒxÊ¾y¹.X[YÎiKnX[²’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ Ğ¢–b‡7—7FVÕ&ö×B’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢7—7FVÕ&ö×BÀĞ¢æÖS¢—4w&÷W6†Bòu5•5DTÒ	ù^{êNˆ®jŠ[Èò’r¢u5•5DTÒ	ù;h˜¾iË®ˆ®ZJ’’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ Ğ¢–b†—4w&÷W6†Bbb6ÆÄÖöFR’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢°Ğ¢~8	[êîKú{êN{ª.XÈ^K‰>yJŠxNX‰8	rÀĞ¢~{êNˆ®{ª.XÈ^KˆŞˆ;ŞZY~yJXÙ^ˆ®y¨B¾{ª.XÈR*^˜yš)ÕÒjÎ[ÈşûÈÎ[ø^š¾jhÚî{ª.XÈ^{¾Yè¾‹é>X{®KˆŞYÎj~zÛîûÉ¾Zé®Y	{ª.XÈ^K™şKˆŞŠhi‹îzK®XÙ^ˆ®{ª.XÈ^y¨NZH~k:ih~ZÙ~8"rÀĞ¢sâyJh‹~YÊ{êN˜xÎhÈ~Zé®Xù{¹iùKˆKØŞ{êNh‰Yi{nûÈÎXú®i‹îzK®K‹®ûÉ¥¾{¹{êNXø¾YŞZÙ~y¨N{ª.XÈR*S#ãŞûÈx«nhûÉ®iÊ®š(nXùnûÈûÈÎKˆŞŠhi‹îzK®XÙ^ˆ®{ª.XÈ^y¨NZH~k:ih~ZÙ~8"rÀĞ¢s"â{êNh‰Yš(nXùnhÈ~Zé®{ª.XÈ^i{nûÈÎXú®‹é>X{®xºÎz¸¾j~zÛîûÉ¥¾š(nXùn{ª.XÈUŞûÉ¾Xú®iÈŠ*¾hÈ~Zé®y¨N{êNh‰YiÊÎK«®XúşKº^š(nXùnûÈÎX[nK¹nh‰YKˆŞŠhi»şš(n8"rÀĞ¢s2âyJh‹~Xù˜h»Îh˜¾k	Nh‰nYØ~Xˆn{êN{ª.XÈ^YîûÈÎˆ®ZJŠë[Ù^KÉ®i‹îzK®ZèÎi[N{¾Yè¾8h¾˜yš)Ş8{ª.XÈ^KŠ®i[Y(Îx«nh8.{êNh‰YK™şXúşKº^K‹¾XªXù˜{êN{ª.XÈ^ûÈÎKØn[ø^š¾XÙ^xºÎ‹é>X{®ZèÎi[Nj~zÛîûÈÎKè¾Zh.ûÉ®{êNXø´ûÉ¥¾{êN{ª.XÈ^ûÙÎ{¾Yè¾ûÉ®h»Îh˜¾k	N{ª.XÈ^ûÙÎh¾˜yš)ŞûÉ¬*SãûÙÎ{ª.XÈ^KŠ®i[ûÉ£EŞûÈÎh‰n{êNXø´ûÉ¥¾{êN{ª.XÈ^ûÙÎ{¾Yè¾ûÉ®YØ~Xˆn{ª.XÈ^ûÙÎh¾˜yš)ŞûÉ¬*SãûÙÎ{ª.XÈ^KŠ®i[ûÉ£EŞûÉ¾KˆŞŠhXú®‹é>X{®{Ë®[	˜yš)ŞY(ÎKŠ®i[y¨B¾{êN{ª.XÈUŞ8"rÀĞ¢sBâh»Îh˜¾k	N{ª.XÈ^yKKˆŞYÎ{êNh‰Yš(nXùnûÈÎjøşjÊXú®ˆ;ŞyKKˆYŞ{êNh‰Y‹é>X{®ûÉ¥¾š(nXùnh»Îh˜¾k	N{ª.XÈ\*W‡‚ç‡…ŞûÉ¾jøşKØŞh‰Y˜yš)ŞXúşKº^KˆŞYÎûÈÎKØnh˜iÈš(nXùn˜yš)ŞK˜¾Y(Î{¹ŞZûKˆŞˆ;Ş‹h^‹ø~{ª.XÈ^h¾š)ŞûÈÎiÈYîKˆKØŞš(nXùnˆ^ˆë~[é~{ª.XÈ^XšKÙKÙš)Ş8"rÀĞ¢sRâYØ~Xˆn{ª.XÈ^yKKˆŞYÎ{êNh‰Yš(nXùnûÈÎjøşjÊ‹é>X{®ûÉ¥¾š(nXùnYØ~Xˆn{ª.XÈ\*W‡‚ç‡…ŞûÉ¾jøşKØŞh‰Y˜yš)Ş[©NhÈ{ª.XÈ^h¾š)ŞY(ÎKŠ®i[[›>YØ~Xˆn˜XŞûÈÎiÈYîKˆKØŞš(nXùnˆ^ˆë~[é~Yº[şi[Xùni[NKª~yIşy¨NXšKÙKÙš)Ş8"rÀĞ¢sbâyJh‹~iÊÎK«®XúşKº^x+X{¾š(nXùnˆz®[{XùX{®y¨Nh»Îh˜¾k	Nh‰nYØ~Xˆn{êN{ª.XÈ^ûÉ´’{êNh‰YXù˜ˆ^KˆŞŠhš(nXùnˆz®[{XùX{®y¨N{ª.XÈ^8.X[nK¹nyÉşZéî{êNh‰YYØ~Xúşš(nXùnûÈÎjøşYŞh‰YXú®ˆ;Şš(nXùnKˆjÊûÈÎš(nXùnK«®i[KˆŞˆ;Ş‹h^‹ø~{ª.XÈ^KŠ®i[8"rÀĞ¢srâyJh‹~iÊÎK«®˜	®‹ø~x+X{¾{êN{ª.XÈ^š(nXùnûÈXÈ^hºÎˆz®[{XùX{®y¨N{êN{ª.XÈ^ûÈûÈÎ{;¾{¹şKÉ®ˆz®Xª™¨şiË®{¹>zé~˜yš)ŞûÉ¾KÚKˆŞ[é~i»şyJh‹~‹é>X{®š(nXùnj~zÛî8.{êNh‰Yš(nXùni{n[ø^š¾KÛşyJyÉşZéî{êNh‰YYŞZÙ~ûÈÎKè¾Zh.ûÉ®{êNXø´.ûÉ¥¾š(nXùnh»Îh˜¾k	N{ª.XÈ\*S"ãƒŞ8"rÀĞ¢s‚â{ª.XÈ^Xù˜Y(Îš(nXùnj~zÛî[ø^š¾XÙ^xºÎh‰iÚûÈÎKˆŞŠhY(Îišî˜	®ˆ®ZJih~ZÙ~8XªKÙÎhøşXih‰nŠz>˜x®k{~YÊYÎKˆj~zÛîXh^8"rÀĞ¢~™šN™ÙîyJh‹~iˆîzîŠhk.ûÈÎKˆŞŠhi8^ˆz®iKXù{ª.XÈ^{¾Yè¾8h¾˜yš)Ş8{ª.XÈ^KŠ®i[8š(nXùnx«nhh‰n{êNh‰YYŞXÙ^8"pĞ¢Òæ¦ö–â‚uÆâr’ÀĞ¢æÖS¢u5•5DTÒ	ù^[êîKú{êN{ª.XÈ^ŠxNX‰’’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ¢–b†—5&ö7F—fRbb6ÆÄÖöFR’°Ğ¢6öç7B&ö7F—fU'VÆW2ÒF†—2åö'V–ÆDöæÆ–æU&ö7F—fU'VÆW2‡°Ğ¢W6W$æÖRÀĞ¢F&vWD6†BÀĞ¢7W7FöÔVÖö¦”Æ—7BÀĞ¢&ö7F—fTÖWFĞ¢Ò“°Ğ¢–b‡&ö7F—fU'VÆW2’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢&ö7F—fU'VÆW2ÀĞ¢æÖS¢u5•5DTÒ[êîKú{«şKˆ®K‹¾XªŠznXùŠxNX‰’’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ¢ĞĞ Ğ¢òò	ùJR˜	®ŠùŞjŠ[ÈşûÉ®[n˜	®ŠùŞŠxNX‰8[Ù>X˜Ş[êîKúˆ®ZJXènXû.8iÊÎjÊ˜	®ŠùŞ‹é>XZ^Xˆn[Èk:XZPĞ¢–b†6ÆÄÖöFR’°Ğ¢6öç7B&ö×DÖævW"Òv–æF÷råf—'GVÅ†öæSòç&ö×DÖævW#°Ğ¢6öç7B&ö×DfVGW&RÒF†—2åövWD6ÆÅ&ö×DfVGW&R†6ÆÄÖöFRÂF&vWD6†B“°Ğ¢6öç7B6öçF7G2ÒF†—2æçvV6†DFFævWD6öçF7G2‚’ÇÂµÓ°Ğ¢6öç7BvV6†D6öçF7G4Æ—7BÒF†—2åöf÷&ÖEvV6†D6öçF7DÆ—7Df÷%&ö×B†6öçF7G2“°Ğ Ğ¢ÆWB6ÆÅ7—7FVÕ&ö×BÒrs°Ğ¢–b‡&ö×DÖævW#òævWE&ö×Df÷$fVGW&R’°Ğ¢6ÆÅ7—7FVÕ&ö×BÒ&ö×DÖævW"ævWE&ö×Df÷$fVGW&R‚wvV6†BrÂ&ö×DfVGW&R’ÇÂrs°Ğ¢ĞĞ Ğ¢–b‚6ÆÅ7—7FVÕ&ö×Bæ–æ6ÇVFW2„4ÄÅô„äuUõ%TÄR’’6ÆÅ7—7FVÕ&ö×B³ÒÆåÆâG´4ÄÅô„äuUõ%TÄWÖ°Ğ¢6ÆÅ7—7FVÕ&ö×BÒ6ÆÅ7—7FVÕ&ö×@Ğ¢ç&WÆ6R‚õÇµÇ·W6W%ÇÕÇÒörÂW6W$æÖRĞ¢ç&WÆ6R‚õÇµÇ¶6†%ÇÕÇÒörÂF&vWD6†BææÖRĞ¢ç&WÆ6R‚õÇµÇ¶w&÷WæÖUÇÕÇÒörÂw&÷WæÖRĞ¢ç&WÆ6R‚õÇµÇ¶w&÷WÖVÖ&W'5ÇÕÇÒörÂw&÷WÖVÖ&W'2Ğ¢ç&WÆ6R‚õÇµÇ·vV6†D6öçF7G5ÇÕÇÒörÂvV6†D6öçF7G4Æ—7B“°Ğ Ğ¢–b†6ÆÅ7—7FVÕ&ö×B’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢6ÆÅ7—7FVÕ&ö×BÀĞ¢æÖS¢5•5DTÒ‚G¶—4w&÷W6†Bò~{êBr¢rwÒG¶6ÆÄÖöFRÓÓÒwf–FVòrò~Šxnš)r¢~ŠúŞ™û2wŞ˜	®ŠùÒ–ÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ Ğ Ğ¢–b†6öçF7E&öf–ÆTÖW76vR’°Ğ¢ÖW76vW2çW6‚†6öçF7E&öf–ÆTÖW76vR“°Ğ¢ĞĞ Ğ¢–b‡†öæT6ÆÄ†—7F÷'”6öçFW‡B’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢†öæT6ÆÄ†—7F÷'”6öçFW‡BÀĞ¢æÖS¢u5•5DTÒ˜	®ŠùÒŠë[ÙR’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ Ğ¢–b‡†öæU6×4†—7F÷'”6öçFW‡B’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢†öæU6×4†—7F÷'”6öçFW‡BÀĞ¢æÖS¢u5•5DTÒyúŞKúŠë[ÙR’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ Ğ¢–b‡6–ævÆT6†DÖöÖVçG46öçFW‡B’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢6–ævÆT6†DÖöÖVçG46öçFW‡BÀĞ¢æÖS¢u5•5DTÒiÈ¾Xø¾YÈŠë[ÙR’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ Ğ¢–b†w&÷W6†DÖöÖVçG46öçFW‡B’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢w&÷W6†DÖöÖVçG46öçFW‡BÀĞ¢æÖS¢u5•5DTÒ{êNh‰YiÈ¾Xø¾YÈŠë[ÙR’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ Ğ¢–b‡vV6†EG&ç67&—B’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢vV6†EG&ç67&—BÀĞ¢æÖS¢u5•5DTÒ[êîKúŠë[ÙR’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ Ğ¢–b‡&ö×B’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢wW6W"rÀĞ¢6öçFVçC¢&ö×BÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ¢ÒVÇ6R°Ğ¢–b†6öçF7E&öf–ÆTÖW76vR’°Ğ¢ÖW76vW2çW6‚†6öçF7E&öf–ÆTÖW76vR“°Ğ¢ĞĞ¢–b‡†öæT6ÆÄ†—7F÷'”6öçFW‡B’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢†öæT6ÆÄ†—7F÷'”6öçFW‡BÀĞ¢æÖS¢u5•5DTÒ˜	®ŠùÒŠë[ÙR’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ¢–b‡†öæU6×4†—7F÷'”6öçFW‡B’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢†öæU6×4†—7F÷'”6öçFW‡BÀĞ¢æÖS¢u5•5DTÒyúŞKúŠë[ÙR’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ¢–b‡6–ævÆT6†DÖöÖVçG46öçFW‡B’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢6–ævÆT6†DÖöÖVçG46öçFW‡BÀĞ¢æÖS¢u5•5DTÒiÈ¾Xø¾YÈŠë[ÙR’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ¢–b†w&÷W6†DÖöÖVçG46öçFW‡B’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢w&÷W6†DÖöÖVçG46öçFW‡BÀĞ¢æÖS¢u5•5DTÒ{êNh‰YiÈ¾Xø¾YÈŠë[ÙR’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ¢–b‡vV6†EG&ç67&—B’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢vV6†EG&ç67&—BÀĞ¢æÖS¢u5•5DTÒ[êîKúŠë[ÙR’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ¢–b†×W6–4Æ—7FVæ–æt6öçFW‡B’°Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢w7—7FVÒrÀĞ¢6öçFVçC¢×W6–4Æ—7FVæ–æt6öçFW‡BÀĞ¢æÖS¢u5•5DTÒKˆ‹[~Y
ÎjØÂ’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ¢ĞĞ¢ĞĞ Ğ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢òò~ûˆş(:2iÊ¾[î‹ûŞXªjŠ[Èş[Ë®XÉnhùzK Ğ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢ÆWB7W'&VçDÖöFTæÖRÒ~[êîKúXÙ^ˆ¢s°Ğ¢–b†6ÆÄÖöFRÓÓÒwf–FVòr’7W'&VçDÖöFTæÖRÒ—4w&÷W6†Bò~[êîKú{êNŠxnš)˜	®ŠùÒr¢~[êîKúŠxnš)˜	®ŠùÒs°Ğ¢VÇ6R–b†6ÆÄÖöFRÓÓÒwfö–6Rr’7W'&VçDÖöFTæÖRÒ—4w&÷W6†Bò~[êîKú{êNŠúŞ™û>˜	®ŠùÒr¢~[êîKúŠúŞ™û>˜	®ŠùÒs°Ğ¢VÇ6R–b†—4w&÷W6†B’7W'&VçDÖöFTæÖRÒ~[êîKú{êNˆ¢s°Ğ Ğ¢ÆWBf–æÅW6W$6öçFVçBÒ—5&ö7F—fPĞ¢òxëYÊKÚZHNK¨î[êîKú{«şKˆ®K‹¾XªŠznXùjŠ[Èş8.{«şKˆ®K‹¾XªŠznXùi{nûÈÎ[êîKúZ[ŞXø¾h‰n[êîKú{êN™ÈŠhK‹¾XªˆN{;²G·W6W$æÖWŞ8.Šû~jhÚîKº^Kˆ®h˜iÈKúhş8[êîKúXÙ^ˆ®ŠxNX‰Y(Î[êîKú{êNˆ®ŠxNX‰ûÈÎK‹¾XªyIşh‰iky¨N{«şKˆ®[êîKúkhhş8& Ğ¢¢xëYÊKÚZHNK¨âG¶7W'&VçDÖöFTæÖWŞy¨NjŠ[ÈşûÈÎŠû~jhÚîKº^Kˆ®h˜iÈKúhşûÈÎ˜^ZèY¹îZHŞjÎ[ÈşûÈÎˆz®xKnh›şhê^yJh‹~y¨Nkhhş‹ù¾ŠÎY¹îZHŞ8&°Ğ¢–b‚6ÆÄÖöFR’°Ğ¢–b†—4w&÷W6†B’°Ğ¢f–æÅW6W$6öçFVçB³ÒuÆî{êNˆ®YË®išşKˆ¾ûÈÎ˜	®ŠùŞX˜ŞYîy¨NXùŠˆK¸Ş™ÈKÛşyJ(	ÎXù˜ˆS¢Xh^Zë(	ŞjÎ[ÈşûÈÎK‰NXù˜ˆ^[ø^š¾iŠş{êNh‰Y8"s°Ğ¢ĞĞ Ğ¢6öç7BÆFW7EW6W$–çWBÒ7G&–ær†f÷&ÖGFVDÆFW7EW6W$–çWBÇÂ&ö×BÇÂrr’çG&–Ò‚“°Ğ¢–b†ÆFW7EW6W$–çWB’°Ğ¢f–æÅW6W$6öçFVçB³Ò—5&ö7F—fPĞ¢òÆåÆî8	{«şKˆ®K‹¾XªŠznXùˆ8Îišş8	ÆâG¶ÆFW7EW6W$–çWGÖ Ğ¢¢ÆåÆî8	yJh‹~iÈik‹é>XZ^8	ÆâG¶f÷&ÖGFVDÆFW7EW6W$–çWBòÆFW7EW6W$–çWB¢G·W6W$æÖWÓ¢G¶ÆFW7EW6W$–çWGÖÖ°Ğ¢ĞĞ¢f–æÅW6W$6öçFVçB³ÒuÆåÆî8	iÊÎ‹Úî{ªniÙş8	s°Ğ¢f–æÅW6W$6öçFVçB³ÒuÆâÒ‹é>X{®XúşKº^yKKŠNKŠ®[›nŠÎi[hÚîYÙ~{¸Nh‰ûÉ®j~XxbÇvV6†CâââãÂ÷vV6†Câ[êîKúY¹îZHŞûÈÎKº^Xø®[{.k:XZ^K‰nyXÎKšnŠhk.y¨NxºÎz¸²²&ÖöÖVçG2#¥²ââå×ÒiÈ¾Xø¾YÈ‚¥4ôî8.iÈ¾Xø¾YÈ‚¥4ôâ[ø^š¾iKîYÊ‚Â÷vV6†CâK˜¾YîûÈÎKˆŞ[é~Xi‹ù¾ˆ®ZJz©~Xú>ûÉ¾k*iÈiÈ¾Xø¾YÈXªhi{nXúşyÈyZ^ŠúR¥4ôî8"s°Ğ¢–b†—5&ö7F—fR’°Ğ¢6öç7BVÆ6VDÖ–çWFW2ÒÖF‚æÖ‚ƒÂçVÖ&W"ç'6T–çB‡&ö7F—fTÖWFæVÆ6VDÖ–çWFW2Â’ÇÂ“°Ğ¢6öç7B–çFW'fÄÖ–çWFW2ÒÖF‚æÖ‚ƒÂçVÖ&W"ç'6T–çB‡&ö7F—fTÖWFæ–çFW'fÄÖ–çWFW2Â’ÇÂ“°Ğ¢f–æÅW6W$6öçFVçB³ÒW6U&VÅF–ÖTf÷$öæÆ–æT6†@Ğ¢òÆâÒ8	xëZéîi{n™{N8	[Ù>X˜ŞxëZéîi{n™{NK‹¢G¶7W'&VçDFFUF–ÖUFW‡GŞûÉ¾‹yŞzk¾Kˆ®jÊ{«şKˆ®K‹¾XªŠznXù{ªbG¶VÆ6VDÖ–çWFW7ÒXˆn™)şûÈÎyJh‹~Šëî{Úîy¨NŠznXù™{N™©NK‹¢G¶–çFW'fÄÖ–çWFW7ÒXˆn™)ş8& Ğ¢¢ÆâÒ8	Xš~h8^i{n™{N8	[Ù>X˜ŞXš~h8^i{n™{NK‹¢G¶7W'&VçDFFUF–ÖUFW‡BÇÂ7W'&VçEF–ÖWŞûÉ¾xëZéî‹yŞzk¾Kˆ®jÊ{«şKˆ®K‹¾XªŠznXù{ªbG¶VÆ6VDÖ–çWFW7ÒXˆn™)şûÈÎyJh‹~Šëî{Úîy¨NŠznXù™{N™©NK‹¢G¶–çFW'fÄÖ–çWFW7ÒXˆn™)ş8&°Ğ¢f–æÅW6W$6öçFVçB³ÒuÆâÒiÊÎ‹ÚîKˆŞiŠşyJh‹~X‰®X‰®XùkhhşûÈÎˆÎiŠş{«şKˆ®jŠ[ÈşZé®i{nK‹¾XªŠznXùûÉ¾KÚ[ø^š¾ŠêY˜.y¨N[êîKúZ[ŞXø¾h‰n[êîKú{êNK‹¾XªˆN{;¾yJh‹~8"s°Ğ¢f–æÅW6W$6öçFVçB³ÒuÆâÒ[êîKúkhhş˜:Xˆn[ø^š¾Xú®XÈ^Y
¾KˆKŠ¢ÇvV6†CâââãÂ÷vV6†Câj~zÛîûÉ¾XXŠëhÈKˆ®KˆiÚ[›nŠÎ‹é>X{®XØşŠêîYÊj~zÛîYî‹ûŞXªxºÎz¸²ÖöÖVçG2¥4ôîûÈÎ™šNjÚNK˜¾ZInzhjÚ.Šz>˜x®h‰n‹é>X{®X[nK¹nj~zÛîZInih~ZÙ~8"s°Ğ¢f–æÅW6W$6öçFVçB³ÒuÆâÒ[ø^š¾YÎi{nZêŠxn8	h˜¾iË®[êîKú[{.iÈkhhş8	˜xÎy¨NXÙ^ˆ®z©~Xú>Y(Î{êNˆ®z©~Xú>ûÉ¾XúşKº^˜hºKˆKŠ®iÈYyny¨NXÙ^ˆ®8KˆKŠ®iÈYyny¨N{êNˆ®ûÈÎh‰nYÊYÎKˆKŠ¢ÇvV6†CâKŠŞ‹é>X{®ZI®KŠ®Yynz©~Xú>8"s°Ğ¢f–æÅW6W$6öçFVçB³ÒuÆâÒz©~Xú>YŞ[ø^š¾iÚ^ˆz®[{.iÈ[êîKúˆ®ZJŠë[Ù^z©~Xú>ûÈÎK‰NjÎ[Èşk+şyJxëiÈ[êîKú{«şKˆ®XÙ^ˆ¢ş{êNˆ®ŠxNX‰8"s°Ğ¢f–æÅW6W$6öçFVçB³ÒÆâÒh˜iÈikZ)îkhhş˜;Ş[ø^š¾iŠşXù{¹h˜¾iË®K‹¾K«®(	ÂG·W6W$æÖWŞ(	Şy¨N{«şKˆ®[êîKúkhhşûÉ¾zhjÚ.i»òG·W6W$æÖWŞXùŠˆ8&°Ğ¢f–æÅW6W$6öçFVçB³ÒuÆâÒXÙ^ˆ®z©~Xú>{º~{ºŞ˜^Zè[êîKúXÙ^ˆ®jŠ[ÈşûÉ¾{êNˆ®z©~Xú>{º~{ºŞ˜^Zè[êîKú{êNˆ®jŠ[ÈşûÈÎ{êNXh^Xù˜ˆ^[ø^š¾iÚ^ˆz®Šú^{êNh‰Yy›ŞYŞXÙ^8"s°Ğ¢f–æÅW6W$6öçFVçB³ÒW6U&VÅF–ÖTf÷$öæÆ–æT6†@Ğ¢òuÆâÒkhhşi{n™{N[ø^š¾hÈ[Ù>X˜ŞxëZéîi{n™{Nh‰n[Ù>X˜Şz©~Xú>iÈYîKˆiÚ[{.ZÙYÊkhhşK˜¾Yîˆz®xKnhê‹ù¾8"pĞ¢¢uÆâÒkhhşi{n™{N[ø^š¾hÈ[Ù>X˜ŞXš~h8^i{n™{Nh‰n[Ù>X˜Şz©~Xú>iÈYîKˆiÚ[{.ZÙYÊkhhşK˜¾Yîˆz®xKnhê‹ù¾8"s°Ğ¢ÒVÇ6R–b‚—4w&÷W6†B’°Ğ¢f–æÅW6W$6öçFVçB³ÒÆâÒ8	ikY	™HZé®8	[Ù>X˜Ş[êîKúXÙ^ˆ®z©~Xú>iŠş(	ÂG·F&vWD6†CòææÖRÇÂ6†$æÖWŞ(	ŞûÉ¾h˜¾iË®K‹¾K«¢şyJh‹~iÊÎK«®iŠş(	ÂG·W6W$æÖWŞ(	Ş8.KÚXú®ˆ;ŞhšîkÉN(	ÂG·F&vWD6†CòææÖRÇÂ6†$æÖWŞ(	Ş{¹(	ÂG·W6W$æÖWŞ(	ŞXùikZ)î[êîKúkhhş8&°Ğ¢f–æÅW6W$6öçFVçB³ÒÆâÒXÛ>KÛşŠy.ˆ›.XÚK‹¾Šy.8˜Y.šhb76—7FçBh‰njÚ>ih~XùK¨¾ŠxnŠy.KˆŞiŠş(	ÂG·F&vWD6†CòææÖRÇÂ6†$æÖWŞ(	ŞûÈÎ[Ù>X˜Ş[êîKúXÙ^ˆ®K™ş[ø^š¾Kº^(	ÂG·F&vWD6†CòææÖRÇÂ6†$æÖWŞ(	Şy¨N‹ª¾K»ŞY(ÎXú>Y¾Y¹îZHŞûÉ¾Šy.ˆ›.XÚY(ÎjÚ>ih~Xú®KÙÎK‹®ˆ8ÎišşXø.ˆ>8&°Ğ¢f–æÅW6W$6öçFVçB³ÒÆâÒ8	yJh‹~iÈik‹é>XZ^8	iŠş(	ÂG·W6W$æÖWŞ(	ŞX‰®X‰®XùX{®y¨NkhhşûÈÎXú®ˆ;ŞKÙÎK‹®Š*¾Y¹îZHŞy¨NXh^ZëûÉ¾zhjÚ.h¨®(	ÂG·W6W$æÖWŞ(	Ş[Ù>h‰ˆ®ZJZû‹8ˆN{;¾K«®8z©~Xú>YŞh‰nY¹îZHŞXù˜ˆ^ûÈÎzhjÚ.‹é>X{®(	ÂG·W6W$æÖWÓ®(	Ş8yJh‹s®8xêZëc®8&°Ğ¢f–æÅW6W$6öçFVçB³ÒuÆâÒ[êîKúkhhşXh^Zë[ø^š¾iŠşŠy.ˆ›.yÉşZéîh™>‹ù¾ˆ®ZJjn˜xÎy¨Nih~ZÙ~ûÉ¾zhjÚ.XiXªKÙÎ8xêşZ(>8zYîh8XiZÙ~‹ø~zˆ¾8ŠúŞk	NŠûNiˆîûÈÎzhjÚ.X{®xë(	ÎšşK¨nšòşhÈ~[	nh*ÎXÂşXøŠ^K¨nKˆiÚşŠúŞk	N˜xÎ(	ŞzØXùK¨¾Xú^8"s°Ğ¢ĞĞ¢f–æÅW6W$6öçFVçB³Ò—5&ö7F—fPĞ¢òuÆâÒXú®‹é>X{®iky¨NK‹¾Xª[êîKúkhhşûÉ¾KˆŞ[é~˜xŞZHŞK»¾KÙ^[{.iÈ[êîKúkhhşûÈÎK™şKˆŞ[é~h¨®jÚ>ih~˜xÎX‰®XùyIşy¨NZûy›ŞXéşj~ZHŞŠû¾h‰[êîKúkhhş8"pĞ¢¢uÆâÒXú®‹é>X{®[Ù>X˜Ş[êîKúz©~Xú>y¨NikZ)îY¹îZHŞûÉ¾KŠ^zh˜xŞZHŞ(	Îh˜¾iË®[êîKú[{.iÈkhhş(	ŞKŠŞ[{.{¸şZÙYÊy¨N[êîKúkhhşûÈÎKŠ^zh[njÚ>ih~˜xÎX‰®XùyIşy¨NZûy›Ş˜xŞZHŞh‰[êîKúkhhş8"s°Ğ¢f–æÅW6W$6öçFVçB³ÒuÆâÒXúşKº^Yû®K¨îjÚ>ih~iÈikK¨¾K»n8h8^{º®8YËx+XùXÉnKÙÎX{®ˆz®xKnY¹î[©NûÈÎKØnY¹îZHŞ[ø^š¾iŠşiky¨N[êîKúXh^Zë8"s°Ğ¢f–æÅW6W$6öçFVçB³ÒuÆâÒkhhşi{n™{N[ø^š¾h›şhê^[Ù>X˜Şz©~Xú>iÈYîKˆiÚ[{.ZÙYÊkhhşy¨Ni{n™{N[›nY	Yîhê‹ù¾8"s°Ğ¢ĞĞ Ğ¢òòXú®h¨®iÊÎ‹ÚîiÈikyJh‹~‹é>XZ^KŠŞy¨NY»îx˜~™˜NXªX‹W6W"khhşiÊ¾[îûÉ¾XènXû.Y»îx˜~K¸^KùŞyYih~ZÙ~ŠûNiˆî8 Ğ¢–b‚6ÆÄÖöFRbb”–ÖvUFö¶Vä–G2æÆVæwF‚âbb”–ÖvTæ÷FW2æÆVæwF‚â’°Ğ¢f–æÅW6W$6öçFVçB³ÒuÆåÆå¾Kº^Kˆ¾iŠşiÊÎ‹ÚîyJh‹~iÈik‹é>XZ^KŠŞy¨NY»îx˜~ûÈÎŠû~{¹>YKˆ®iki{n™{N{«şynŠz>Y»îx˜~Xh^Zë•ÕÆâs°Ğ¢”–ÖvTæ÷FW2æf÷$V6‚†æ÷FRÓâ°Ğ¢f–æÅW6W$6öçFVçB³ÒG¶æ÷FWÕÆæ°Ğ¢Ò“°Ğ¢ĞĞ Ğ¢ÖW76vW2çW6‚‡°Ğ¢&öÆS¢wW6W"rÀĞ¢6öçFVçC¢f–æÅW6W$6öçFVçBÀĞ¢æÖS¢uU4U"{;¾{¹şhÈ~KºB’rÀĞ¢—5†öæTÖW76vS¢G'VPĞ¢Ò“°Ğ Ğ¢&WGW&âÖW76vW3°Ğ¢ĞĞ Ğ¢ö'V–ÆDöæÆ–æU&ö7F—fU'VÆW2‡²W6W$æÖRÒ~yJh‹rrÂF&vWD6†BÒçVÆÂÂ7W7FöÔVÖö¦”Æ—7BÒrrÂ&ö7F—fTÖWFÒ·ÒÒÒ·Ò’°Ğ¢6öç7B&ö×DÖævW"Òv–æF÷råf—'GVÅ†öæSòç&ö×DÖævW#°Ğ¢6öç7B&VÅF–ÖT–æfòÒF†—2åöf÷&ÖE&VÄFFUF–ÖR‡&ö7F—fTÖWFææ÷rÇÂFFRææ÷r‚’“°Ğ¢6öç7BF–ÖTÖævW"Òv–æF÷råf—'GVÅ†öæSòçF–ÖTÖævW#°Ğ¢6öç7BW6U&VÅF–ÖTf÷$öæÆ–æT6†BÒF†—2å÷6†÷VÆEW6U&VÅF–ÖTf÷$öæÆ–æT6†B‚“°Ğ¢6öç7B7F÷'•F–ÖT–æfòÒF–ÖTÖævW#òævWD7W'&VçE7F÷'•F–ÖSòâ‚“°Ğ¢6öç7B7W'&VçDFFUF–ÖUFW‡BÒW6U&VÅF–ÖTf÷$öæÆ–æT6†@Ğ¢òG·&VÅF–ÖT–æfòæFFWÒG·&VÅF–ÖT–æfòçF–ÖWÖ Ğ¢¢G·7F÷'•F–ÖT–æfóòæFFRÇÂrwÒG·7F÷'•F–ÖT–æfóòçF–ÖRÇÂrwÖçG&–Ò‚“°Ğ¢6öç7B6†G2ÒF†—2æçvV6†DFFævWD6†DÆ—7B‚“°Ğ¢6öç7B6öçF7G2ÒF†—2æçvV6†DFFævWD6öçF7G3òâ‚’ÇÂµÓ°Ğ¢6öç7BvV6†D6öçF7G4Æ—7BÒF†—2åöf÷&ÖEvV6†D6öçF7DÆ—7Df÷%&ö×B†6öçF7G2“°Ğ¢6öç7BÆÅW'6öæÄ–ÖvUFt–æfòÒF†—2åöf÷&ÖEW'6öæÄ–ÖvUFu&÷w2†6öçF7G2æÖ†6öçF7BÓâ‡°Ğ¢æÖS¢6öçF7CòææÖRÀĞ¢Fw3¢6öçF7Còææ•&ö×EFw2ÇÂ6öçF7Còæ–ÖvUFw0Ğ¢Ò’’“°Ğ Ğ¢6öç7Bæ÷&ÖÆ—¦U&ö×BÒ‡FW‡BÂ&WÆ6VÖVçG2Ò·Ò’Óâ°Ğ¢ÆWB÷WBÒ7G&–ær‡FW‡BÇÂrr’çG&–Ò‚“°Ğ¢ö&¦V7BæVçG&–W2‡&WÆ6VÖVçG2’æf÷$V6‚‚…¶¶W’ÂfÇVUÒ’Óâ°Ğ¢÷WBÒ÷WBç&WÆ6R†æWr&VtW‡†ÅÇµÅÇ²G·F†—2åöW66U&VtW‡†¶W’—ÕÅÇÕÅÇÖÂvrr’Â7G&–ær‡fÇVRóòrr’“°Ğ¢Ò“°Ğ¢&WGW&â÷WBçG&–Ò‚“°Ğ¢Ó°Ğ Ğ¢ÆWB6–ævÆU&ö×BÒrs°Ğ¢ÆWBw&÷W&ö×BÒrs°Ğ¢G'’°Ğ¢6öç7B6×ÆU6–ævÆRÒ6†G2æf–æB†6†BÓâ6†CòçG—RÓÒvw&÷Wr’ÇÂF&vWD6†BÇÂ·Ó°Ğ¢6öç7B6×ÆTw&÷WÒ6†G2æf–æB†6†BÓâ6†CòçG—RÓÓÒvw&÷Wr’ÇÂ·Ó°Ğ¢6öç7Bw&÷WÖVÖ&W'2Ò6×ÆTw&÷WòçG—RÓÓÒvw&÷WpĞ¢òF†—2åöf÷&ÖDw&÷WÖVÖ&W'4f÷%&ö×B‡F†—2åö6öÆÆV7Dw&÷W'F–6—çG4f÷$f–ÇFW"‡6×ÆTw&÷WÂF†—2å÷6fTvWD6öçFW‡B‚’’’æ¦ö–â‚~8rĞ¢¢~Šû~Xø.ˆ>8	h˜¾iË®[êîKú[{.iÈkhhş8	KŠŞYN{êNˆ®z©~Xú>y¨N{êNh‰Yy›ŞYŞXÙRs°Ğ¢6–ævÆU&ö×BÒæ÷&ÖÆ—¦U&ö×B‡&ö×DÖævW#òævWE&ö×Df÷$fVGW&Sòâ‚wvV6†BrÂvöæÆ–æRr’ÇÂrrÂ°Ğ¢6†DæÖS¢6×ÆU6–ævÆSòææÖRÇÂ~X	˜[êîKúZ[ŞXø²rÀĞ¢6öÖÖöäw&÷WæÖW3¢~hÈ8	h˜¾iË®[êîKú[{.iÈkhhş8	XŠNijÒrÀĞ¢6öÖÖöäw&÷WÆ—7C¢~hÈ8	h˜¾iË®[êîKú[{.iÈkhhş8	XŠNijÒrÀĞ¢7W7FöÔVÖö¦”Æ—7BÀĞ¢W'6öæÄ–ÖvUFt–æfó¢F†—2åö'V–ÆEvV6†EW'6öæÄ–ÖvUFt–æfò‡²F&vWD6†C¢6×ÆU6–ævÆRÂ—4w&÷W6†C¢fÇ6RÒĞ¢Ò“°Ğ¢w&÷W&ö×BÒæ÷&ÖÆ—¦U&ö×B‡&ö×DÖævW#òævWE&ö×Df÷$fVGW&Sòâ‚wvV6†BrÂvw&÷W6†Br’ÇÂrrÂ°Ğ¢w&÷WæÖS¢6×ÆTw&÷WòææÖRÇÂ~X	˜[êîKú{êBrÀĞ¢w&÷WÖVÖ&W'2ÀĞ¢vV6†D6öçF7G3¢vV6†D6öçF7G4Æ—7BÀĞ¢6†DæÖS¢~Z[ŞXø¾ZèÎi[N[êîKúYÒrÀĞ¢7W7FöÔVÖö¦”Æ—7BÀĞ¢W'6öæÄ–ÖvUFt–æfó¢6×ÆTw&÷WòçG—RÓÓÒvw&÷WpĞ¢òF†—2åö'V–ÆEvV6†EW'6öæÄ–ÖvUFt–æfò‡²F&vWD6†C¢6×ÆTw&÷WÂ—4w&÷W6†C¢G'VRÒĞ¢¢ÆÅW'6öæÄ–ÖvUFt–æfğĞ¢Ò“°Ğ¢Ò6F6‚†R’°Ğ¢6öç6öÆRçv&â‚~)ªûˆòièN[»®[êîKú{«şKˆ®K‹¾XªŠznXùŠxNX‰ZK‹JS¢rÂR“°Ğ¢ĞĞ Ğ¢6öç7BVÆ6VDÖ–çWFW2ÒÖF‚æÖ‚ƒÂçVÖ&W"ç'6T–çB‡&ö7F—fTÖWFæVÆ6VDÖ–çWFW2Â’ÇÂ“°Ğ¢6öç7B–çFW'fÄÖ–çWFW2ÒÖF‚æÖ‚ƒÂçVÖ&W"ç'6T–çB‡&ö7F—fTÖWFæ–çFW'fÄÖ–çWFW2Â’ÇÂ“°Ğ Ğ¢&WGW&â°Ğ¢~8	[êîKú{«şKˆ®K‹¾XªŠznXù8	rÀĞ¢W6U&VÅF–ÖTf÷$öæÆ–æT6†@Ğ¢ò[Ù>X˜ŞxëZéîi{n™{NûÉ¢G¶7W'&VçDFFUF–ÖUFW‡GÖ Ğ¢¢[Ù>X˜ŞXš~h8^i{n™{NûÉ¢G¶7W'&VçDFFUF–ÖUFW‡BÇÂ~iÊ®yúRwÖÀĞ¢‹yŞzk¾Kˆ®jÊ{«şKˆ®K‹¾XªŠznXù{ªbG¶VÆ6VDÖ–çWFW7ÒXˆn™)şûÉ¾yJh‹~Šëî{Úîy¨Nˆz®XªŠznXù™{N™©NK‹¢G¶–çFW'fÄÖ–çWFW7ÒXˆn™)ş8&ÀĞ¢~‹ùiŠş{«şKˆ®jŠ[ÈşZé®i{nK‹¾XªŠznXùûÈÎKˆŞiŠşyJh‹~K‹¾XªXùkhhş8.KÚ[ø^š¾ZHŞyJKˆ¾ik[êîKú{«şKˆ®XÙ^ˆ®Y(Î[êîKú{êNˆ®ŠxNX‰ûÈÎ‹é>X{®j~XxbÇvV6†Câj~zÛîûÈÎŠêY˜.y¨NZ[ŞXø¾h‰n{êNˆ®K‹¾XªˆN{;¾yJh‹~8"rÀĞ¢rrÀĞ¢6–ævÆU&ö×Bò8	ZHŞyJûÉ®[êîKú{«şKˆ®XÙ^ˆ®hùzK®ŠøŞ8	ÆâG·6–ævÆU&ö×GÖ¢rrÀĞ¢w&÷W&ö×Bò8	ZHŞyJûÉ®[êîKú{êNˆ®hùzK®ŠøŞ8	ÆâG¶w&÷W&ö×GÖ¢rpĞ¢Òæf–ÇFW"„&ööÆVâ’æ¦ö–â‚uÆåÆâr“°Ğ¢ĞĞ Ğ¢6†÷uvV6†Df–ÆT6ö×÷6W"‚’°Ğ¢6öç7B6†D–BÒF†—2ææ7W'&VçD6†Còæ–C°Ğ¢6öç7B&ö÷BÒF†—2ævWD7W'&VçEvV6†Ef–Wr‚“°Ğ¢–b‚6†D–BÇÂ&ö÷B’&WGW&ã°Ğ¢–b‡F†—2åö—4&Æö6¶VE6–ævÆT6†B‡F†—2ææ7W'&VçD6†B’’°Ğ¢F†—2åöæ÷F–g”&Æö6¶VD6†E6VæB‡F†—2ææ7W'&VçD6†B“°Ğ¢&WGW&ã°Ğ¢ĞĞ¢&ö÷BçVW'•6VÆV7F÷"‚rçvV6†BÖf–ÆRÖ6ö×÷6RÖ÷fW&Æ’r“òç&VÖ÷fR‚“°Ğ¢6öç7BÖöFÂÒFö7VÖVçBæ7&VFTVÆVÖVçB‚vF—br“°Ğ¢ÖöFÂæ6Æ74æÖRÒwvV6†BÖf÷'v&BÖ÷fW&Æ’vV6†BÖf–ÆRÖ6ö×÷6RÖ÷fW&Æ’s°Ğ¢ÖöFÂæ–ææW$…DÔÂÒÆF—b6Æ73Ò'vV6†BÖf÷'v&BÖF–ÆörvV6†BÖf–ÆRÖ6ö×÷6RÖF–Æör"&öÆSÒ&F–Æör"&–ÖÖöFÃÒ'G'VR"&–ÖÆ&VÃÒ.Xù˜ih~K»b#àĞ¢ÆF—b6Æ73Ò'vV6†BÖf÷'v&BÖ†VF–ær#îXù˜ih~K»cÂöF—càĞ¢ÆÆ&VÂ6Æ73Ò'vV6†BÖf–ÆRÖ6ö×÷6RÖÆ&VÂ#îih~K»nj~š)ƒÆ–çWB6Æ73Ò'vV6†BÖf–ÆR×F—FÆRÖ–çWB"G—SÒ'FW‡B"Æ6V†öÆFW#Ò.Kè¾Zh.ûÉ®KÉ®Šêî{ª®ŠhæFö78šyºîŠûNiˆâçFb"Ö†ÆVæwFƒÒ##ãÂöÆ&VÃàĞ¢ÆF—b6Æ73Ò'vV6†BÖf–ÆRÖ6ö×÷6RÖ†–çB#îiJşhÈFö>8Fö78Fn8†Ç78G8G‡BzØih~K»nYŞûÈÎXh^ZëZ¾XiYÊKˆ¾ik8#ÂöF—càĞ¢ÆÆ&VÂ6Æ73Ò'vV6†BÖf–ÆRÖ6ö×÷6RÖÆ&VÂ#îih~K»nXh^Zë“ÇFW‡F&V6Æ73Ò'vV6†BÖf–ÆR×FW‡BÖ–çWB"Æ6V†öÆFW#Ò.‹é>XZ^ih~K»nKŠŞy¨Nih~ZÙ~Xh^Zë’#ãÂ÷FW‡F&VãÂöÆ&VÃàĞ¢ÆF—b6Æ73Ò'vV6†BÖf–ÆRÖ6ö×÷6RÖW'&÷""&öÆSÒ'7FGW2#ãÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖf÷'v&BÖ7F–öç2#ãÆ'WGFöâG—SÒ&'WGFöâ"FFÖ7F–öãÒ&6Æ÷6R#îXùnkhƒÂö'WGFöããÆ'WGFöâG—SÒ&'WGFöâ"FFÖ7F–öãÒ'6VæB#îXù˜Âö'WGFöããÂöF—càĞ¢ÂöF—cæ°Ğ¢&ö÷BæVæD6†–ÆB†ÖöFÂ“°Ğ¢ÖöFÂæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂRÓâ°Ğ¢Rç7F÷&÷vF–öâ‚“°Ğ¢–b†RçF&vWBÓÓÒÖöFÂÇÂRçF&vWBæ6Æ÷6W7B‚u¶FFÖ7F–öãÒ&6Æ÷6R%Òr’’ÖöFÂç&VÖ÷fR‚“°Ğ¢Ò“°Ğ¢6öç7B6VæBÒÖöFÂçVW'•6VÆV7F÷"‚u¶FFÖ7F–öãÒ'6VæB%Òr“°Ğ¢6VæBæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢–b‡6VæBæF—6&ÆVB’&WGW&ã°Ğ¢6öç7BF—FÆRÒÖöFÂçVW'•6VÆV7F÷"‚rçvV6†BÖf–ÆR×F—FÆRÖ–çWBr’çfÇVRçG&–Ò‚“°Ğ¢6öç7BFW‡BÒÖöFÂçVW'•6VÆV7F÷"‚rçvV6†BÖf–ÆR×FW‡BÖ–çWBr’çfÇVRçG&–Ò‚“°Ğ¢–b‚F—FÆRÇÂFW‡B’°Ğ¢ÖöFÂçVW'•6VÆV7F÷"‚rçvV6†BÖf–ÆRÖ6ö×÷6RÖW'&÷"r’çFW‡D6öçFVçBÒ~Šû~Z¾Xiih~K»nj~š)Y(ÎXh^Zë’s°Ğ¢&WGW&ã°Ğ¢ĞĞ¢6VæBæF—6&ÆVBÒG'VS°Ğ¢G'’°Ğ¢F†—2å÷6VæEvV6†Df–ÆR†6†D–BÂF—FÆRÂFW‡B“°Ğ¢ÖöFÂç&VÖ÷fR‚“°Ğ¢F†—2åö6öÆÆ6UG&ç6–VçD–çWEæVÇ2‡²&VæFW#¢fÇ6RÒ“°Ğ¢F†—2åövWD7W'&VçD6†E&ööÒ†6†D–B“òçVW'•6VÆV7F÷"‚ræÖ÷&R×æVÂr“òç&VÖ÷fR‚“°Ğ¢–b…7G&–ær‡F†—2ææ7W'&VçD6†Còæ–B’ÓÓÒ7G&–ær†6†D–B’’°Ğ¢F†—2ç6Ö'EWFFTÖW76vW2‡F†—2æçvV6†DFFævWDÖW76vW2†6†D–B’ÂF†—2æçvV6†DFFævWEW6W$–æfò‚’Â²6†D–BÒ“°Ğ¢ĞĞ¢F†—2åöVçVWVUVæF–æt6†B†6†D–B“°Ğ¢Ò6F6‚†W'&÷"’°Ğ¢6VæBæF—6&ÆVBÒfÇ6S°Ğ¢ÖöFÂçVW'•6VÆV7F÷"‚rçvV6†BÖf–ÆRÖ6ö×÷6RÖW'&÷"r’çFW‡D6öçFVçBÒW'&÷"æÖW76vS°Ğ¢ĞĞ¢Ò“°Ğ¢ĞĞ Ğ¢÷6VæEvV6†Df–ÆR†6†D–BÂF—FÆRÂFW‡B’°Ğ¢–b‚7G&–ær‡F—FÆRÇÂrr’çG&–Ò‚’ÇÂ7G&–ær‡FW‡BÇÂrr’çG&–Ò‚’’F‡&÷ræWrW'&÷"‚~Šû~Z¾Xiih~K»nj~š)Y(ÎXh^Zë’r“°Ğ¢6öç7BFFÒF†—2æçvV6†DFF°Ğ¢6öç7B6†BÒFFævWD6†B†6†D–B“°Ğ¢–b‚6†BÇÂF†—2åö—4&Æö6¶VE6–ævÆT6†B†6†B’’F‡&÷ræWrW'&÷"‚~[Ù>X˜Şˆ®ZJizk9^Xù˜ih~K»br“°Ğ¢6öç7BFFVBÒFFæFDÖW76vR†6†D–BÂ°Ğ¢g&öÓ¢vÖRrÂG—S¢vf–ÆUö6&BrÂf–ÆUF—FÆS¢F—FÆRçG&–Ò‚’Âf–ÆUFW‡C¢FW‡BçG&–Ò‚’ÀĞ¢6öçFVçC¢f÷&ÖEvV6†Df–ÆR‡F—FÆRÂFW‡B’ÂfF#¢FFævWEW6W$–æfò‚’æfF"ÀĞ¢&F6„–C¢f–ÆUòG´FFRææ÷r‚—ÕòG´ÖF‚ç&æFöÒ‚’çFõ7G&–ærƒ3b’ç6Æ–6Rƒ"—ÖÀĞ¢âââ‡F†—2å÷6†÷VÆEW6U&VÅF–ÖTf÷$öæÆ–æT6†B‚’òF†—2åö'V–ÆEvV6†E&VÅF–ÖTf–VÆG2‚’¢·ÒĞ¢Ò“°Ğ¢–b†FFVBÓÓÒfÇ6R’F‡&÷ræWrW'&÷"‚~ih~K»niÊ®ˆ;ŞKùŞZÙ‚r“°Ğ¢&WGW&âFFVC°Ğ¢ĞĞ Ğ¢÷VåvV6†Df–ÆR†ÖW76vT–B’°Ğ¢6öç7B&ö÷BÒF†—2ævWD7W'&VçEvV6†Ef–Wr‚“°Ğ¢6öç7B×6rÒF†—2æçvV6†DFFævWDÖW76vW2‡F†—2ææ7W'&VçD6†Còæ–B’æf–æB†—FVÒÓâ7G&–ær†—FVÒæ–B’ÓÓÒ7G&–ær†ÖW76vT–B’“°Ğ¢–b‚&ö÷BÇÂ×6sòçG—RÓÒvf–ÆUö6&Br’&WGW&ã°Ğ¢&ö÷BçVW'•6VÆV7F÷"‚rçvV6†BÖf–ÆRÖFWF–ÂÖ÷fW&Æ’r“òç&VÖ÷fR‚“°Ğ¢6öç7BÖöFÂÒFö7VÖVçBæ7&VFTVÆVÖVçB‚vF—br“°Ğ¢ÖöFÂæ6Æ74æÖRÒwvV6†BÖf÷'v&BÖ÷fW&Æ’vV6†BÖf–ÆRÖFWF–ÂÖ÷fW&Æ’s°Ğ¢ÖöFÂæ–ææW$…DÔÂÒÆF—b6Æ73Ò'vV6†BÖf÷'v&BÖF–ÆörvV6†BÖf÷'v&B×&V6÷&BÖF–Æör"&öÆSÒ&F–Æör"&–ÖÖöFÃÒ'G'VR"&–ÖÆ&VÃÒ.ih~K»nXh^Zë’#àĞ¢ÆF—b6Æ73Ò'vV6†BÖf÷'v&BÖ†VF–ær#âG·F†—2åöW66T‡FÖÂ†×6ræf–ÆUF—FÆRÇÂ~ih~K»br—ÓÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖf÷'v&B×&V6÷&BÖ&öG’#âG·F†—2åöW66T‡FÖÂ†×6ræf–ÆUFW‡BÇÂrr—ÓÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖf÷'v&BÖ7F–öç2#ãÆ'WGFöâG—SÒ&'WGFöâ"FFÖ7F–öãÒ&6Æ÷6R#îX[>™zÓÂö'WGFöããÂöF—càĞ¢ÂöF—cæ°Ğ¢&ö÷BæVæD6†–ÆB†ÖöFÂ“°Ğ¢ÖöFÂæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂRÓâ°Ğ¢Rç7F÷&÷vF–öâ‚“°Ğ¢–b†RçF&vWBÓÓÒÖöFÂÇÂRçF&vWBæ6Æ÷6W7B‚u¶FFÖ7F–öãÒ&6Æ÷6R%Òr’’ÖöFÂç&VÖ÷fR‚“°Ğ¢Ò“°Ğ¢ĞĞ Ğ¢7–æ2†æFÆTÖ÷&T7F–öâ†7F–öâ’°Ğ¢7v—F6‚†7F–öâ’°Ğ¢66Rvf–ÆRs Ğ¢F†—2ç6†÷uvV6†Df–ÆT6ö×÷6W"‚“°Ğ¢'&V³°Ğ¢66RvVÖö¦’s Ğ¢òò	ùJRh™>[ÈŠh8^™Ú.iÛğĞ¢F†—2ç6†÷tÖ÷&RÒfÇ6S°Ğ¢F†—2ç6†÷tVÖö¦’ÒG'VS°Ğ¢F†—2æç&VæFW"‚“°Ğ¢'&V³°Ğ¢66Rv–ÖvRs Ğ¢F†—2ç6†÷t–ÖvU6÷W&6U6†VWB‚“°Ğ¢'&V³°Ğ¢66Rw67&VVç6†÷Bs Ğ¢v—BF†—2æ6GW&TæE6VæD6†E6æ6†÷B‡²Æöæt6GW&S¢fÇ6RÒ“°Ğ¢'&V³°Ğ¢66Rv†öæW’s Ğ¢v—BF†—2ç7F'D†öæW”–çf—FTg&öÕvV6†B‚“°Ğ¢'&V³°Ğ¢66Rwf–FVòs Ğ¢F†—2ç7F'Ef–FVô6ÆÂ‚“°Ğ¢'&V³°Ğ¢66Rwfö–6Rs Ğ¢F†—2ç7F'Efö–6T6ÆÂ‚“°Ğ¢'&V³°Ğ¢66RvÆö6F–öâs Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~KØŞ{ÚârÂ~jÚ>YÊˆë~XùnKØŞ{ÚâââârÂ	ù8Òr“°Ğ¢'&V³°Ğ¢66RwG&ç6fW"s Ğ¢F†—2ç&W6WEG&ç6–VçD–çWEæVÇ2‚“°Ğ¢F†—2ç6†÷uG&ç6fW$F–Æör‚“°Ğ¢'&V³°Ğ¢66Rw&VG6¶WBs Ğ¢F†—2ç&W6WEG&ç6–VçD–çWEæVÇ2‚“°Ğ¢F†—2ç6†÷u&VE6¶WDF–Æör‚“°Ğ¢'&V³°Ğ¢ĞĞ¢ĞĞ Ğ¢ö'V–ÆD×W6–4Æ—7FVæ–æt6öçFW‡B‡F&vWD6†BÂW6W$æÖRÒ~yJh‹rr’°Ğ¢–b‚F&vWD6†Còæ–B’&WGW&ârs°Ğ¢6öç7B6W76–öâÒF†—2æçvV6†DFFævWD×W6–4Æ—7FVæ–æsòâ‡F&vWD6†Bæ–B“°Ğ¢–b‚6W76–öâ’&WGW&ârs°Ğ Ğ¢6öç7B6æ6†÷BÒv–æF÷råf—'GVÅ†öæSòæ×W6–4òæ×W6–4FFòævWDÆ—7FVæ–æu6æ6†÷Còâ‚’ÇÂçVÆÃ°Ğ¢6öç7B6öætæÖRÒ7G&–ær‡6æ6†÷Còç6öætæÖRÇÂ6W76–öâç6öætæÖRÇÂrr’çG&–Ò‚’ÇÂ~iÊ®yú^jØÎi»"s°Ğ¢6öç7B'F—7BÒ7G&–ær‡6æ6†÷Còæ'F—7BÇÂ6W76–öâæ'F—7BÇÂrr’çG&–Ò‚’ÇÂ~iÊ®yú^jØÎh˜²s°Ğ¢6öç7B7W'&VçE6V6öæG2ÒçVÖ&W"‡6æ6†÷Còæ7W'&VçEF–ÖRÇÂ“°Ğ¢6öç7B7W'&VçEF–ÖRÒF†—2åöf÷&ÖD×W6–4Æ—7FVåF–ÖR†7W'&VçE6V6öæG2“°Ğ¢6öç7BGW&F–öâÒçVÖ&W"‡6æ6†÷CòæGW&F–öâÇÂ’âòF†—2åöf÷&ÖD×W6–4Æ—7FVåF–ÖR„çVÖ&W"‡6æ6†÷BæGW&F–öâ’’¢rs°Ğ¢6öç7BÇ—&–2Ò7G&–ær‡6æ6†÷CòæÇ—&–2ÇÂrr’çG&–Ò‚“°Ğ¢6öç7BG&ç6ÆF–öâÒ7G&–ær‡6æ6†÷CòæÇ—&–5G&ç6ÆF–öâÇÂrr’çG&–Ò‚“°Ğ¢6öç7B&÷VæBÒ'&’æ—4'&’‡6æ6†÷CòæÇ—&–4&÷VæBĞ¢ò6æ6†÷BæÇ—&–4&÷VæBæÖ†—FVÒÓâ7G&–ær†—FVÒÇÂrr’çG&–Ò‚’’æf–ÇFW"„&ööÆVâĞ¢¢µÓ°Ğ¢6öç7BÇ—&–5v–æF÷rÒ'&’æ—4'&’‡6æ6†÷CòæÇ—&–5v–æF÷rĞ¢ò6æ6†÷BæÇ—&–5v–æF÷ræÖ†—FVÒÓâ7G&–ær†—FVÒÇÂrr’çG&–Ò‚’’æf–ÇFW"„&ööÆVâĞ¢¢µÓ°Ğ¢6öç7BÆ–Æ—7E6öæw2Ò'&’æ—4'&’‡6æ6†÷CòçÆ–Æ—7E6öæw2Ğ¢ò6æ6†÷BçÆ–Æ—7E6öæw2æÖ†—FVÒÓâ7G&–ær†—FVÒÇÂrr’çG&–Ò‚’’æf–ÇFW"„&ööÆVâĞ¢¢µÓ°Ğ¢6öç7Bff÷&—FU6öæw2Ò'&’æ—4'&’‡6æ6†÷Còæff÷&—FU6öæw2Ğ¢ò6æ6†÷Bæff÷&—FU6öæw2æÖ†—FVÒÓâ7G&–ær†—FVÒÇÂrr’çG&–Ò‚’’æf–ÇFW"„&ööÆVâĞ¢¢µÓ°Ğ¢6öç7B÷F†W$æÖRÒ7G&–ær‡6W76–öâæ6öçF7DæÖRÇÂF&vWD6†BææÖRÇÂ~Zûik’r’çG&–Ò‚“°Ğ Ğ¢6öç7BÆ–æW2Ò°Ğ¢~8	Kˆ‹[~Y
ÎjØÎx«nh8	rÀĞ¢G·W6W$æÖWÒ[{.˜(Šû~[êîKúZ[ŞXø¾(	ÂG¶÷F†W$æÖWŞ(	ŞKˆ‹[~Y
ÎjØÎûÈÎXøÎik[Ù>X˜ŞK¸ŞZHNK¨îKˆ‹[~Y
ÎjØÎx«nh8&ÀĞ¢[Ù>X˜ŞZéîi{ni*ŞiKîjØÎi».ûÉ®8¢G·6öætæÖWŞ8¶ÀĞ¢jØÎh˜²şkÉNYKˆ^ûÉ¢G¶'F—7GÖÀĞ¢[Ù>X˜Şi*ŞiKîKØŞ{ÚîûÉ¢G¶7W'&VçEF–ÖWÒG¶GW&F–öâòòG¶GW&F–öçÖ¢rwÖ Ğ¢Ó°Ğ Ğ¢–b†Ç—&–2’Æ–æW2çW6‚†[Ù>X˜ŞYKX‹y¨NjØÎŠøŞûÉ¢G¶Ç—&–7ÒG·G&ç6ÆF–öâòûÈ‚G·G&ç6ÆF–öçŞûÈ–¢rwÖ“°Ğ¢–b†&÷VæBæÆVæwF‚â’Æ–æW2çW6‚†™˜N‹ùjØÎŠøŞˆ¨.˜ûÉ¢G¶&÷VæBæ¦ö–â‚ròr—Ö“°Ğ¢–b†Ç—&–5v–æF÷ræÆVæwF‚â’°Ğ¢Æ–æW2çW6‚‚~š(NŠêY¹îZHŞi{një^jØÎŠøŞˆ¨.˜ûÈ[Ù>X˜Şi*ŞiKîx+Yî{ªcCÓƒzy.ûÈûÉ¢r“°Ğ¢Ç—&–5v–æF÷ræf÷$V6‚†—FVÒÓâÆ–æW2çW6‚†ÒG¶—FV×Ö’“°Ğ¢ĞĞ¢–b‡Æ–Æ—7E6öæw2æÆVæwF‚â’Æ–æW2çW6‚†yJh‹~išî˜	®jØÎXÙ^ûÉ¢G·Æ–Æ—7E6öæw2æ¦ö–â‚~ûÉ²r—Ö“°Ğ¢–b†ff÷&—FU6öæw2æÆVæwF‚â’Æ–æW2çW6‚†yJh‹~iKn‰xşjØÎXÙ^ûÉ¢G¶ff÷&—FU6öæw2æ¦ö–â‚~ûÉ²r—Ö“°Ğ¢Æ–æW2çW6‚‚~Yî{ºŞ[êîKúY¹îZHŞ[ø^š¾yú^˜>XøÎikjÚ>YÊKˆ‹[~Y
Î‹ùšinjØÎûÈÎXúşKº^ˆz®xKnhùXø®jØÎi».8jØÎh˜¾8[Ù>X˜ŞjØÎŠøŞh‰ni*ŞiKîKØŞ{ÚîûÈÎKØnKˆŞŠhiË®j+ZHŞ‹û‹ùjë^{;¾{¹şŠûNiˆî8"r“°Ğ Ğ¢&WGW&âÆ–æW2æ¦ö–â‚uÆâr“°Ğ¢ĞĞ Ğ¢öf÷&ÖD×W6–4Æ—7FVåF–ÖR‡6V6öæG2Ò’°Ğ¢6öç7BfÇVRÒÖF‚æÖ‚ƒÂçVÖ&W"‡6V6öæG2ÇÂ’“°Ğ¢6öç7BÒÒÖF‚æfÆö÷"‡fÇVRòc“°Ğ¢6öç7B2ÒÖF‚æfÆö÷"‡fÇVRRc“°Ğ¢&WGW&âG¶×Ó¢Gµ7G&–ær‡2’çE7F'Bƒ"Âsr—Ö°Ğ¢ĞĞ Ğ¢6†÷t–ÖvU6÷W&6U6†VWB‚’°Ğ¢6öç7B6†VWBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wvV6†BÖ–ÖvR×6÷W&6R×6†VWBr“°Ğ¢–b‚6†VWB’°Ğ¢F†—2ç6VÆV7E†÷Fò‚“°Ğ¢&WGW&ã°Ğ¢ĞĞ¢6†VWBç7G–ÆRæF—7Æ’Ò6†VWBç7G–ÆRæF—7Æ’ÓÓÒvæöæRròv&Æö6²r¢væöæRs°Ğ¢ĞĞ Ğ¢†–FT–ÖvU6÷W&6U6†VWB‚’°Ğ¢6öç7B6†VWBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wvV6†BÖ–ÖvR×6÷W&6R×6†VWBr“°Ğ¢–b‡6†VWB’6†VWBç7G–ÆRæF—7Æ’ÒvæöæRs°Ğ¢ĞĞ Ğ¢7–æ27F'D†öæW”–çf—FTg&öÕvV6†B‚’°Ğ¢6öç7B6†BÒF†—2ææ7W'&VçD6†C°Ğ¢–b‚6†BÇÂ6†BçG—RÓÓÒvw&÷Wr’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~‰ÉÎŠúÒrÂ~‰ÉÎŠúŞ˜({ªnK¸^iJşhÈ[êîKúXÙ^ˆ¢rÂ~)ªûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ¢–b‚F†—2æ—4öæÆ–æTÖöFR‚’’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~zk¾{«şjŠ[ÈòrÂ~Šû~YÊŠëî{ÚîKŠŞ[ÈY
şYÊ{«şjŠ[ÈòrÂ~)ªûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢F†—2ç6†÷tÖ÷&RÒfÇ6S°Ğ¢F†—2ç6†÷tVÖö¦’ÒfÇ6S°Ğ¢F†—2å÷6WD7W7FöÔVÖö¦•6VÆV7F–öäÖöFR†fÇ6R“°Ğ Ğ¢6öç7BW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfò‚“°Ğ¢F†—2æçvV6†DFFæFDÖW76vR†6†Bæ–BÂ°Ğ¢g&öÓ¢vÖRrÀĞ¢G—S¢v†öæW•ö–çf—FRrÀĞ¢6öçFVçC¢u¾‰ÉÎŠúÕŞûÈzØ[è^Y¹î[©NûÈ’rÀĞ¢†öæW”–çf—FU7FGW3¢~zØ[è^Y¹î[©BrÀĞ¢fF#¢W6W$–æfòæfF"ÀĞ¢âââ‡F†—2å÷6†÷VÆEW6U&VÅF–ÖTf÷$öæÆ–æT6†B‚’òF†—2åö'V–ÆEvV6†E&VÅF–ÖTf–VÆG2‚’¢·ÒĞ¢Ò“°Ğ¢F†—2æç&VæFW"‚“°Ğ Ğ¢v—BF†—2ç6VæEFô’‚~yJh‹~K‹¾XªXù‹[~K¨n‰ÉÎŠúŞ˜({ªn8"rÂ6†Bæ–B“°Ğ¢ĞĞ Ğ¢÷6VÆV7EvV6†E–ÖVçE6÷W&6R†Ö÷VçBÂ7F–öäÆ&VÂÒ~K¹jËâr’°Ğ¢Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚r7vV6†BÖ6†B×–ÖVçBÖÖöFÂr’æf÷$V6‚†VÆVÖVçBÓâVÆVÖVçBç&VÖ÷fR‚’“°Ğ¢6öç7B6÷W&6W2ÒF†—2æçvV6†DFFævWEvÆÆWE&W–ÖVçE6÷W&6W3òâ‚’ÇÂµÓ°Ğ¢6öç7Bf÷&ÖDÖ÷VçBÒfÇVRÓâçVÖ&W"‡fÇVRÇÂ’çFôÆö6ÆU7G&–ær‚w¦‚Ô4ârÂ°Ğ¢Ö–æ–×VÔg&7F–öäF–v—G3¢"ÀĞ¢Ö†–×VÔg&7F–öäF–v—G3¢ Ğ¢Ò“°Ğ¢6öç7B&÷w2Ò6÷W&6W2æÖ‚‡6÷W&6RÂ–æFW‚’Óâ°Ğ¢6öç7BÆ&VÂÒ6÷W&6RçG—RÓÓÒwvÆÆWBrò~[êîKúiJşK¹‚r¢~™;nŠÎXÚiJşK¹‚s°Ğ¢6öç7BFWF–ÂÒ6÷W&6RçG—RÓÓÒwvÆÆWBpĞ¢ò~™»n™+pĞ¢¢G·6÷W&6RæÆ&VÇÒG·6÷W&6RçF–ÄçVÖ&W"ò[îXûrG·6÷W&6RçF–ÄçVÖ&W'Ö¢rwÖ°Ğ¢&WGW&â Ğ¢ÆÆ&VÂ6Æ73Ò'vV6†B×vÆÆWB×&W–ÖVçB×6÷W&6R#àĞ¢Æ–çWBG—SÒ'&F–ò"æÖSÒ'vV6†BÖ6†B×–ÖVçB×6÷W&6R"fÇVSÒ"G·F†—2åöW66T‡FÖÂ‡6÷W&6Ræ–B—Ò"G¶–æFW‚ÓÓÒòv6†V6¶VBr¢rwÓàĞ¢Ç7â6Æ73Ò'vV6†B×vÆÆWB×&W–ÖVçB×6÷W&6RÖ6÷’#àĞ¢Ç7G&öæsâG¶Æ&VÇÓÂ÷7G&öæsàĞ¢Ç7ãâG·F†—2åöW66T‡FÖÂ†FWF–Â—ÓÂ÷7ãàĞ¢Â÷7ãàĞ¢Ç7â6Æ73Ò'vV6†B×vÆÆWB×&W–ÖVçB×6÷W&6RÖ&Ææ6R#îKÙš)Ò*RG¶f÷&ÖDÖ÷VçB‡6÷W&6Ræ&Ææ6R—ÓÂ÷7ãàĞ¢ÂöÆ&VÃàĞ¢°Ğ¢Ò’æ¦ö–â‚rr“°Ğ¢6öç7BÖöFÄ‡FÖÂÒ Ğ¢ÆF—b–CÒ'vV6†BÖ6†B×–ÖVçBÖÖöFÂ"6Æ73Ò'vV6†B×vÆÆWB×&W–ÖVçBÖ÷fW&Æ’#àĞ¢Ç6V7F–öâ6Æ73Ò'vV6†B×vÆÆWB×&W–ÖVçBÖF–Æör"&öÆSÒ&F–Æör"&–ÖÖöFÃÒ'G'VR"&–ÖÆ&VÆÆVF'“Ò'vV6†BÖ6†B×–ÖVçB×F—FÆR#àĞ¢Æ†VFW"6Æ73Ò'vV6†B×vÆÆWB×&W–ÖVçBÖ†VFW"#àĞ¢Ç7G&öær–CÒ'vV6†BÖ6†B×–ÖVçB×F—FÆR#î˜hºiJşK¹ik[ÈóÂ÷7G&öæsàĞ¢Æ'WGFöâG—SÒ&'WGFöâ"6Æ73Ò'vV6†B×vÆÆWB×&W–ÖVçBÖ6Æ÷6R"FFÖ6†B×–ÖVçBÖ6Æ÷6R&–ÖÆ&VÃÒ.X[>™zÒ"F—FÆSÒ.X[>™zÒ#àĞ¢Æ’6Æ73Ò&f×6öÆ–Bf×†Ö&²"&–Ö†–FFVãÒ'G'VR#ãÂö“àĞ¢Âö'WGFöãàĞ¢Âö†VFW#àĞ¢ÆF—b6Æ73Ò'vV6†B×vÆÆWB×&W–ÖVçBÖ&öG’#àĞ¢ÆF—b6Æ73Ò'vV6†B×vÆÆWB×&W–ÖVçB×7VÖÖ'’#àĞ¢Ç7ãâG·F†—2åöW66T‡FÖÂ†7F–öäÆ&VÂ—ÓÂ÷7ãàĞ¢Ç7G&öæsì*RG¶f÷&ÖDÖ÷VçB†Ö÷VçB—ÓÂ÷7G&öæsàĞ¢Ç6ÖÆÃîKúyJXÚKˆŞiJşhÈ‹ÚÎ‹Jnh‰nXù{ª.XÈSÂ÷6ÖÆÃàĞ¢ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†B×vÆÆWB×&W–ÖVçB×6V7F–öâ×F—FÆR#îK¹jËîik[ÈóÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†B×vÆÆWB×&W–ÖVçB×6÷W&6W2#âG·&÷w7ÓÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†B×vÆÆWB×&W–ÖVçBÖW'&÷""FFÖ6†B×–ÖVçBÖW'&÷"&–ÖÆ—fSÒ'öÆ—FR#ãÂöF—càĞ¢ÂöF—càĞ¢Æfö÷FW"6Æ73Ò'vV6†B×vÆÆWB×&W–ÖVçBÖ7F–öç2#àĞ¢Æ'WGFöâG—SÒ&'WGFöâ"6Æ73Ò'vV6†B×vÆÆWB×&W–ÖVçBÖ6æ6VÂ"FFÖ6†B×–ÖVçBÖ6Æ÷6SîXùnkhƒÂö'WGFöãàĞ¢Æ'WGFöâG—SÒ&'WGFöâ"6Æ73Ò'vV6†B×vÆÆWB×&W–ÖVçBÖ6öæf—&Ò"FFÖ6†B×–ÖVçBÖ6öæf—&ÓîzîŠêNiJşK¹ƒÂö'WGFöãàĞ¢Âöfö÷FW#àĞ¢Â÷6V7F–öãàĞ¢ÂöF—càĞ¢°Ğ Ğ¢6öç7B7W'&VçEf–WrÒFö7VÖVçBçVW'•6VÆV7F÷"‚rç†öæR×f–WrÖ7W'&VçBr’ÇÂFö7VÖVçC°Ğ¢7W'&VçEf–Wræ–ç6W'DF¦6VçD…DÔÂ‚v&Vf÷&VVæBrÂÖöFÄ‡FÖÂ“°Ğ¢6öç7BÖöFÂÒ7W'&VçEf–WrçVW'•6VÆV7F÷"‚r7vV6†BÖ6†B×–ÖVçBÖÖöFÂr“°Ğ¢&WGW&âæWr&öÖ—6R‡&W6öÇfRÓâ°Ğ¢–b‚ÖöFÂ’&WGW&â&W6öÇfR†çVÆÂ“°Ğ¢ÆWB6WGFÆVBÒfÇ6S°Ğ¢6öç7Bf–æ—6‚ÒfÇVRÓâ°Ğ¢–b‡6WGFÆVB’&WGW&ã°Ğ¢6WGFÆVBÒG'VS°Ğ¢ÖöFÂç&VÖ÷fR‚“°Ğ¢&W6öÇfR‡fÇVR“°Ğ¢Ó°Ğ¢ÖöFÂçVW'•6VÆV7F÷$ÆÂ‚u¶FFÖ6†B×–ÖVçBÖ6Æ÷6UÒr’æf÷$V6‚†'WGFöâÓâ°Ğ¢'WGFöâæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâf–æ—6‚†çVÆÂ’“°Ğ¢Ò“°Ğ¢ÖöFÂæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂWfVçBÓâ°Ğ¢–b†WfVçBçF&vWBÓÓÒÖöFÂ’f–æ—6‚†çVÆÂ“°Ğ¢Ò“°Ğ¢ÖöFÂçVW'•6VÆV7F÷"‚u¶FFÖ6†B×–ÖVçBÖ6öæf—&ÕÒr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7B6VÆV7FVBÒÖöFÂçVW'•6VÆV7F÷"‚v–çWE¶æÖSÒ'vV6†BÖ6†B×–ÖVçB×6÷W&6R%Ó¦6†V6¶VBr“°Ğ¢–b‚6VÆV7FVB’°Ğ¢ÖöFÂçVW'•6VÆV7F÷"‚u¶FFÖ6†B×–ÖVçBÖW'&÷%Òr’çFW‡D6öçFVçBÒ~Šû~˜hºiJşK¹ik[Èş8"s°Ğ¢&WGW&ã°Ğ¢ĞĞ¢f–æ—6‚‡6VÆV7FVBçfÇVR“°Ğ¢Ò“°Ğ¢Ò“°Ğ¢ĞĞ Ğ¢6†÷uG&ç6fW$F–Æör‚’°Ğ¢6öç7B6†BÒF†—2ææ7W'&VçD6†C°Ğ¢6öç7BfF$‡FÖÂÒF†—2æç&VæFW$fF"†6†BæfF"Â	ùBrÂ6†BææÖR“°Ğ Ğ¢6öç7B‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò'vV6†BÖvV6†B×–ÖVçBÖ6ö×÷6R×vRvV6†B×G&ç6fW"Ö6ö×÷6R×vR#àĞ¢ÂÒÒšn˜:xˆ›.XË®YùòÒÓàĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6VFVFVC²FF–æs¢3G‚'‚G‚'ƒ²#àĞ¢Æ'WGFöâ6Æ73Ò'vV6†BÖ&6²Ö'Fâ"–CÒ&&6²Ög&öÒ×G&ç6fW""7G–ÆSÒ&6öÆ÷#¢3²&6¶w&÷VæC¦æöæS²&÷&FW#¦æöæS²föçB×6—¦S£Gƒ²7W'6÷#§ö–çFW#²FF–æs£²Ö&v–âÖ&÷GFöÓ£'ƒ²#àĞ¢Æ’6Æ73Ò&f×6öÆ–BfÖ6†Wg&öâÖÆVgB#ãÂö“àĞ¢Âö'WGFöãàĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ²Æ–vâÖ—FV×3¦6VçFW#²§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã²#àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ²föçB×vV–v‡C£S²6öÆ÷#¢3²#î‹ÚÎ‹Jn{¹’G¶6†BææÖWÓÂöF—càĞ¢ÆF—b7G–ÆSÒ'v–GFƒ£3gƒ²†V–v‡C£3gƒ²&÷&FW"×&F—W3£SS²&6¶w&÷VæC¢6FFC²F—7Æ“¦fÆWƒ²Æ–vâÖ—FV×3¦6VçFW#²§W7F–g’Ö6öçFVçC¦6VçFW#²÷fW&fÆ÷s¦†–FFVã²#àĞ¢G¶fF$‡FÖÇĞĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ Ğ¢ÂÒÒy›Şˆ›.XÚx˜~XË¢ÒÓàĞ¢ÆF—b6Æ73Ò'vV6†BÖ6öçFVçB"7G–ÆSÒ&&6¶w&÷VæC¢6cVcVcS²FF–æs¢²÷fW&fÆ÷s¦†–FFVã²#àĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6ffc²&÷&FW"×&F—W3¢‡‚‡‚²Ö&v–â×F÷£gƒ²FF–æs¢G‚G‚#ƒ²#àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S£'ƒ²6öÆ÷#¢3ƒƒƒ²Ö&v–âÖ&÷GFöÓ£ƒ²#î‹ÚÎ‹Jn˜yš)ÓÂöF—càĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ²Æ–vâÖ—FV×3¦&6VÆ–æS²&÷&FW"Ö&÷GFöÓ£‚6öÆ–B6SVSVSS²FF–ærÖ&÷GFöÓ£‡ƒ²#àĞ¢Ç7â7G–ÆSÒ&föçB×6—¦S£#'ƒ²föçB×vV–v‡C¦&öÆC²6öÆ÷#¢3²Ö&v–â×&–v‡C£Gƒ²#ì*SÂ÷7ãàĞ¢Æ–çWBG—SÒ&çVÖ&W""–CÒ'G&ç6fW"ÖÖ÷VçB"Æ6V†öÆFW#Ò#ã"7G–ÆSÒ Ğ¢&÷&FW#¦æöæS²÷WFÆ–æS¦æöæS²föçB×6—¦S£#'ƒ²föçB×vV–v‡C¦&öÆC²6öÆ÷#¢3°Ğ¢fÆWƒ£²Ö–â×v–GFƒ£²&6¶w&÷VæC§G&ç7&VçC°Ğ¢#àĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£ƒ²#àĞ¢Æ–çWBG—SÒ'FW‡B"–CÒ'G&ç6fW"ÖFW62"Æ6V†öÆFW#Ò.k{¾Xª‹ÚÎ‹JnŠûNiˆâ"7G–ÆSÒ Ğ¢&÷&FW#¦æöæS²÷WFÆ–æS¦æöæS²föçB×6—¦S£'ƒ²6öÆ÷#¢3v3c²&6¶w&÷VæC§G&ç7&VçC²FF–æs£²v–GFƒ£S°Ğ¢#àĞ¢ÂöF—càĞ¢ÂöF—càĞ Ğ¢ÂÒÒ[©^˜:‹ÚÎ‹JnhÈ™*îûÈXû>Kˆ¾Šy.ûÈ’ÒÓàĞ¢ÆF—b7G–ÆSÒ&fÆWƒ£²#ãÂöF—càĞ¢ÆF—b7G–ÆSÒ'FF–æs¢'‚Gƒ²F—7Æ“¦fÆWƒ²§W7F–g’Ö6öçFVçC¦fÆW‚ÖVæC²#àĞ¢Æ'WGFöâ–CÒ&6öæf—&Ò×G&ç6fW""7G–ÆSÒ Ğ¢FF–æs¢‚#‡ƒ²&6¶w&÷VæC¢3v3c²6öÆ÷#¢6ffc°Ğ¢&÷&FW#¢æöæS²&÷&FW"×&F—W3¢gƒ²föçB×6—¦S¢7ƒ²7W'6÷#¢ö–çFW#°Ğ¢#î‹ÚÎ‹JcÂö'WGFöãàĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢°Ğ Ğ¢F†—2æç†öæU6†VÆÂç6WD6öçFVçB†‡FÖÂ“°Ğ Ğ¢6öç7B&6´'FâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v&6²Ög&öÒ×G&ç6fW"r“°Ğ¢–b†&6´'Fâ’&6´'Fâæöæ6Æ–6²Ò‚’ÓâF†—2æç&VæFW"‚“°Ğ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6öæf—&Ò×G&ç6fW"r“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ7–æ2‚’Óâ°Ğ¢6öç7BÖ÷VçBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wG&ç6fW"ÖÖ÷VçBr’çfÇVS°Ğ¢6öç7BFW62ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wG&ç6fW"ÖFW62r’çfÇVRÇÂ~‹ÚÎ‹Jn{¹KÚs°Ğ Ğ¢–b‚Ö÷VçBÇÂ—4æâ†Ö÷VçB’ÇÂÖ÷VçBÃÒ’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~Šû~‹é>XZ^jÚ>zîy¨N˜yš)ÒrÂ~)ªûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6öç7BG&ç6fW$Ö÷VçBÒ'6TfÆöB†Ö÷VçB“°Ğ¢6öç7B–ÖVçE6÷W&6T–BÒv—BF†—2å÷6VÆV7EvV6†E–ÖVçE6÷W&6R‡G&ç6fW$Ö÷VçBÂ~[êîKú‹ÚÎ‹Jbr“°Ğ¢–b‚–ÖVçE6÷W&6T–B’&WGW&ã°Ğ¢6öç7BG&ç6fW$–BÒG&ç6fW%òG´FFRææ÷r‚—ÕòG´ÖF‚ç&æFöÒ‚’çFõ7G&–ærƒ3b’ç6Æ–6Rƒ"Âb—Ö°Ğ¢6öç7BG&ç6fW%G&ç67F–öâÒ°Ğ¢G—S¢wG&ç6fW"rÀĞ¢F—FÆS¢G·F†—2ææ7W'&VçD6†CòçG—RÓÓÒvw&÷Wrò~{êNˆ®‹ÚÎ‹Jbr¢~‹ÚÎ‹JbwÒÒG·F†—2ææ7W'&VçD6†BææÖWÖÀĞ¢FWF–Ã¢FW62ÀĞ¢6÷W&6S¢wvV6†BrÀĞ¢6†D–C¢F†—2ææ7W'&VçD6†Bæ–BÀĞ¢6÷VçFW''G“¢F†—2ææ7W'&VçD6†BææÖRÀĞ¢ÖW76vT–C¢G&ç6fW$–BÀĞ¢&VfW&Væ6T–C¢vV6†C§G&ç6fW#§6VæC¢G·G&ç6fW$–GÖ Ğ¢Ó°Ğ¢6öç7B7VæE&W7VÇBÒF†—2æçvV6†DFFç7VæDg&öÕ–ÖVçE6÷W&6R‡G&ç6fW$Ö÷VçBÂ–ÖVçE6÷W&6T–BÂçVÆÂÂG&ç6fW%G&ç67F–öâ“°Ğ¢–b‚7VæE&W7VÇCòç7V66W72’°Ğ¢6öç7B6÷W&6TæÖRÒ7VæE&W7VÇCòç6÷W&6SòçG—RÓÓÒwvÆÆWBrò~™»n™+r¢~Šú^™;nŠÎXÚs°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~KÙš)ŞKˆŞ‹k2rÂG·6÷W&6TæÖWŞXú®Xš’*RG´çVÖ&W"‡7VæE&W7VÇCòæ&Ææ6T&Vf÷&RÇÂ’çFôf—†VBƒ"—ÖÂ~)ØÂr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢F†—2æçvV6†DFFæFDÖW76vR‡F†—2ææ7W'&VçD6†Bæ–BÂ°Ğ¢–C¢G&ç6fW$–BÀĞ¢g&öÓ¢vÖRrÀĞ¢G—S¢wG&ç6fW"rÀĞ¢6öçFVçC¢¾‹ÚÎ‹JeÒ*RG¶Ö÷VçGÒG¶FW67ÖÀĞ¢Ö÷VçC¢Ö÷VçBÀĞ¢FW63¢FW62ÀĞ¢âââ‡F†—2å÷6†÷VÆEW6U&VÅF–ÖTf÷$öæÆ–æT6†B‚’òF†—2åö'V–ÆEvV6†E&VÅF–ÖTf–VÆG2‚’¢·ÒĞ¢Ò“°Ğ Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~‹ÚÎ‹Jnh‰X©òrÂ[{.Y	G·F†—2ææ7W'&VçD6†BææÖWŞ‹ÚÎ‹Jl*RG¶Ö÷VçGÖÂ~)ÈRr“°Ğ Ğ¢òò	ùJRZh.iéÎ[ÈY
şYÊ{«şjŠ[ÈşûÈÎŠznXù‹ùîXùX	.Šêi{`Ğ¢–b‡F†—2æ—4öæÆ–æTÖöFR‚’’°Ğ¢F†—2åöVçVWVUVæF–æt6†B‡F†—2ææ7W'&VçD6†Bæ–B“°Ğ¢ĞĞ Ğ¢6WEF–ÖV÷WB‚‚’ÓâF†—2æç&VæFW"‚’Â“°Ğ¢Ò“°Ğ¢ĞĞ Ğ¢6VÆV7E†÷Fò‚’°Ğ¢6öç7B–çWBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w†÷Fò×WÆöBÖ–çWBr“°Ğ¢–b‚–çWB’°Ğ¢6öç6öÆRæW'&÷"‚~h›îKˆŞX‹ih~K»nKˆ®KÊ–çWBr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢òòx+X{¾™©‰xşy¨F–çWNûÈÎŠznXùy»XhÎ˜hºĞ¢–çWBæ6Æ–6²‚“°Ğ¢ĞĞ Ğ¢òò	ùJRh¸ŞxZ~X©şˆ;ĞĞ¢F¶U†÷Fò‚’°Ğ¢6öç7B–çWBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6ÖW&×WÆöBÖ–çWBr“°Ğ¢–b‚–çWB’°Ğ¢6öç6öÆRæW'&÷"‚~h›îKˆŞX‹h¸ŞxZv–çWBr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢òòx+X{¾™©‰xşy¨F–çWNûÈÎŠznXùiNX8şZK@Ğ¢–çWBæ6Æ–6²‚“°Ğ¢ĞĞ Ğ¢6†÷tfF%6WGF–æw2†6†B’°Ğ¢6öç7B6öçF7BÒ†6†Còæ6öçF7D–BòF†—2æçvV6†DFFævWD6öçF7B†6†Bæ6öçF7D–B’¢çVÆÂĞ¢ÇÂF†—2æçvV6†DFFævWD6öçF7D'”æÖSòâ†6†CòææÖRĞ¢ÇÂF†—2æçvV6†DFFæf–æD6öçF7D'”æÖTÆö÷6Sòâ†6†CòææÖRÂ²–æ6ÇVFT6†G3¢fÇ6RÒ“°Ğ Ğ¢–b†6öçF7Còæ–BbbF†—2ææ6öçF7G5f–Wsòç6†÷tVF—D6öçF7EvR’°Ğ¢F†—2ææ6öçF7G5f–Wrç6†÷tVF—D6öçF7EvR†6öçF7Bæ–BÂ°Ğ¢&WGW&åFô6†D–C¢6†Còæ–@Ğ¢Ò“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~iÊ®h›îX‹Zû[©NˆN{;¾K«®ûÈÎŠû~XXX‹˜	®Šêş[Ù^k{¾XªrÂ~)ªûˆòr“°Ğ¢ĞĞ Ğ¢÷6WD†VFW%7FGW4F÷B†6öÆ÷"Òvw&VVârÂF&vWD6†D–BÒçVÆÂ’°Ğ¢–b‡F&vWD6†D–Bbb‚F†—2ææ7W'&VçD6†BÇÂ7G&–ær‡F†—2ææ7W'&VçD6†Bæ–BÇÂrr’ÓÒ7G&–ær‡F&vWD6†D–B’’’°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6öç7BF÷BÒFö7VÖVçBçVW'•6VÆV7F÷"‚rç†öæR×f–WrÖ7W'&VçBçvV6†BÖ†VFW"×F—FÆRç7FGW2ÖF÷BrĞ¢ÇÂFö7VÖVçBçVW'•6VÆV7F÷"‚rçvV6†BÖ†VFW"×F—FÆRç7FGW2ÖF÷Br“°Ğ¢–b‚F÷B’&WGW&ã°Ğ Ğ¢F÷Bæ6Æ74Æ—7Bç&VÖ÷fR‚vF÷BÖw&VVârÂvF÷B×–VÆÆ÷rrÂvF÷B×&VBr“°Ğ¢–b†6öÆ÷"ÓÓÒw&VBr’°Ğ¢F÷Bæ6Æ74Æ—7BæFB‚vF÷B×&VBr“°Ğ¢&WGW&ã°Ğ¢ĞĞ¢–b†6öÆ÷"ÓÓÒw–VÆÆ÷rr’°Ğ¢F÷Bæ6Æ74Æ—7BæFB‚vF÷B×–VÆÆ÷rr“°Ğ¢&WGW&ã°Ğ¢ĞĞ¢F÷Bæ6Æ74Æ—7BæFB‚vF÷BÖw&VVâr“°Ğ¢ĞĞ Ğ¢7–æ4†VFW%7FGW4F÷B‡F&vWD6†D–BÒçVÆÂ’°Ğ¢F†—2å÷6WD†VFW%7FGW4F÷B‡F†—2ævWD†VFW%7FGW4F÷D6öÆ÷"‡F&vWD6†D–B’ÂF&vWD6†D–B“°Ğ¢ĞĞ Ğ¢6†÷uG—–æu7FGW2‡7FGW5FW‡BÒ~jÚ>YÊ‹é>XZRrÂF&vWD6†D–BÒçVÆÂ’°Ğ¢6öç7BFW‡BÒ7G&–ær‡7FGW5FW‡BÇÂrr’çG&–Ò‚“°Ğ¢–b‚şzØ[è^Y¹îZHÒòçFW7B‡FW‡B’’°Ğ¢F†—2å÷6WD†VFW%7FGW4F÷B‚w–VÆÆ÷rrÂF&vWD6†D–B“°Ğ¢&WGW&ã°Ğ¢ĞĞ¢–b‚şjÚ>YÊ‹é>XZRòçFW7B‡FW‡B’’°Ğ¢F†—2å÷6WD†VFW%7FGW4F÷B‚w&VBrÂF&vWD6†D–B“°Ğ¢&WGW&ã°Ğ¢ĞĞ¢F†—2å÷6WD†VFW%7FGW4F÷B‚w–VÆÆ÷rrÂF&vWD6†D–B“°Ğ¢ĞĞ Ğ¢†–FUG—–æu7FGW2‡F&vWD6†D–BÒçVÆÂ’°Ğ¢F†—2ç7–æ4†VFW%7FGW4F÷B‡F&vWD6†D–B“°Ğ¢ĞĞ Ğ¢övWD6†E6WGF–æw56†VÆÄ&6¶w&÷VæD6öæf–r‚’°Ğ¢6öç7BW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfóòâ‚’ÇÂ·Ó°Ğ¢6öç7BFVfVÇD6†D&rÒF†—2æåövWEvV6†D76WEW&Ãòâ‚v&6¶w&÷VæG2ö&sçærr’ÇÂrs°Ğ¢6öç7B&t&rÒ7G&–ær€Ğ¢F†—2ææ7W'&VçD6†Còæ&6¶w&÷Væ@Ğ¢ÇÂW6W$–æfòævÆö&Ä6†D&6¶w&÷Væ@Ğ¢ÇÂW6W$–æfòæ6†DÆ—7D&6¶w&÷Væ@Ğ¢ÇÂFVfVÇD6†D&pĞ¢ÇÂrpĞ¢’çG&–Ò‚“°Ğ Ğ¢–b‚&t&r’°Ğ¢&WGW&â°Ğ¢6Æ73¢wvV6†BÖrÀĞ¢7G–ÆS¢rrÀĞ¢6öçFVçD&u7G–ÆS¢v&6¶w&÷VæC¢6VFVFVC²pĞ¢Ó°Ğ¢ĞĞ Ğ¢6öç7B—4–ÖvT&rÒ&t&rç7F'G5v—F‚‚vFF¢r’ÇÂ&t&rç7F'G5v—F‚‚ròr’ÇÂ&t&rç7F'G5v—F‚‚v‡GGr“°Ğ¢6öç7B7G–ÆRÒ—4–ÖvT&pĞ¢ò&6¶w&÷VæBÖ–ÖvS¢W&Â‚rG·&t&wÒr“²&6¶w&÷VæB×6—¦S¢6÷fW#²&6¶w&÷VæB×÷6—F–öã¢6VçFW#¶ Ğ¢¢&6¶w&÷VæC¢G·&t&wÓ¶°Ğ Ğ¢&WGW&â°Ğ¢6Æ73¢wvV6†BÖvV6†BÖÖ–â×6†VÆÂvV6†BÖ6†FÆ—7BÖ&rÖVæ&ÆVBrÀĞ¢7G–ÆRÀĞ¢6öçFVçD&u7G–ÆS¢v&6¶w&÷VæC¢G&ç7&VçC²pĞ¢Ó°Ğ¢ĞĞ Ğ¢övWEvV6†D6ÆÄ&6¶w&÷VæE7G–ÆR†6†BÒçVÆÂÂfÆÆ&6²ÒvÆ–æV"Öw&F–VçBƒ3VFVrÂ6†VFVRÂ6fVCfS2SRÂ6C#“–3"R’r’°Ğ¢6öç7BW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfóòâ‚’ÇÂ·Ó°Ğ¢6öç7BFVfVÇD6†D&rÒF†—2æåövWEvV6†D76WEW&Ãòâ‚v&6¶w&÷VæG2ö&sçærr’ÇÂrs°Ğ¢6öç7B&t&rÒ7G&–ær€Ğ¢6†Còæ&6¶w&÷Væ@Ğ¢ÇÂF†—2ææ7W'&VçD6†Còæ&6¶w&÷Væ@Ğ¢ÇÂW6W$–æfòævÆö&Ä6†D&6¶w&÷Væ@Ğ¢ÇÂW6W$–æfòæ6†DÆ—7D&6¶w&÷Væ@Ğ¢ÇÂFVfVÇD6†D&pĞ¢ÇÂrpĞ¢’çG&–Ò‚“°Ğ Ğ¢–b‚&t&r’&WGW&â&6¶w&÷VæC¢G¶fÆÆ&6·Ó¶°Ğ Ğ¢6öç7B6fT&rÒ&t&rç&WÆ6R‚òrörÂ%ÅÂr"“°Ğ¢6öç7B—4–ÖvT&rÒ6fT&rç7F'G5v—F‚‚vFF¢r’ÇÂ6fT&rç7F'G5v—F‚‚ròr’ÇÂ6fT&rç7F'G5v—F‚‚v‡GGr“°Ğ¢&WGW&â—4–ÖvT&pĞ¢ò&6¶w&÷VæBÖ–ÖvS¢W&Â‚rG·6fT&wÒr“²&6¶w&÷VæB×6—¦S¢6÷fW#²&6¶w&÷VæB×÷6—F–öã¢6VçFW#¶ Ğ¢¢&6¶w&÷VæC¢G·6fT&wÓ¶°Ğ¢ĞĞ Ğ¢ö6ÆV%VæF–æu7FFTf÷$6†B†6†D–BÒçVÆÂ’°Ğ¢6öç7B6fT6†D–BÒ7G&–ær†6†D–BÇÂrr’çG&–Ò‚“°Ğ¢–b‚6fT6†D–B’&WGW&ã°Ğ Ğ¢F†—2åöFWVWVUVæF–æt6†B‡6fT6†D–B“°Ğ¢–b‡F†—2çVæF–æt6†D–G2ç6—¦RÓÓÒ’°Ğ¢6ÆV%F–ÖV÷WB‡F†—2æ&F6…F–ÖW"“°Ğ¢ÒVÇ6R°Ğ¢F†—2å÷&W7F'EVæF–æuF–ÖW$–dæVVFVB‡F†—2ææ7W'&VçD6†Còæ–B“°Ğ¢ĞĞ Ğ¢F†—2ç7–æ4†VFW%7FGW4F÷B‡6fT6†D–B“°Ğ¢ĞĞ¢òò	ùJri‹îzK®ˆ®ZJŠëî{ÚîˆùÎXÙPĞ¢6†÷t6†DÖVçR‚’°Ğ¢6öç7B7W'&VçD6†BÒF†—2ææ7W'&VçD6†BÇÂ·Ó°Ğ¢6öç7B—4w&÷W6†BÒ7W'&VçD6†BçG—RÓÓÒvw&÷Ws°Ğ¢6öç7BöffÆ–æT†—7F÷'”–æ¦V7DVæ&ÆVBÒF†—2æçvV6†DFFæ—4öffÆ–æT†—7F÷'”–æ¦V7F–öäVæ&ÆVDf÷$6†Còâ†7W'&VçD6†Bæ–B’ÓÒfÇ6S°Ğ¢6öç7B†öæW”–æ¦V7DVæ&ÆVBÒ—4w&÷W6†BbbF†—2æçvV6†DFFæ—4†öæW”†—7F÷'”–æ¦V7F–öäVæ&ÆVDf÷$6†Còâ†7W'&VçD6†Bæ–B“°Ğ¢6öç7B&öf–ÆT6öçFW‡DVæ&ÆVBÒ—4w&÷W6†BÇÂF†—2æçvV6†DFFæ—5&öf–ÆT6öçFW‡D–æ¦V7F–öäVæ&ÆVDf÷$6†Còâ†7W'&VçD6†Bæ–B’ÓÒfÇ6S°Ğ¢6öç7B—4&Æö6¶VBÒF†—2åö—4&Æö6¶VE6–ævÆT6†B†7W'&VçD6†B“°Ğ¢6öç7B6†VÆÄ&rÒF†—2åövWD6†E6WGF–æw56†VÆÄ&6¶w&÷VæD6öæf–r‚“°Ğ¢6öç7B‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò"G·F†—2æåövWE&VF&ÆUvV6†E6†VÆÄ6Æ72‡6†VÆÄ&ræ6Æ72—Ò"7G–ÆSÒ"G·6†VÆÄ&ræ7G–ÆWÒ#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"ÖÆVgB#àĞ¢Æ'WGFöâ6Æ73Ò'vV6†BÖ&6²Ö'Fâ"–CÒ&&6²Ög&öÒÖÖVçR#àĞ¢Æ’6Æ73Ò&f×6öÆ–BfÖ6†Wg&öâÖÆVgB#ãÂö“àĞ¢Âö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×F—FÆR#îˆ®ZJŠëî{ÚãÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×&–v‡B#ãÂöF—càĞ¢ÂöF—càĞ¢ Ğ¢ÆF—b6Æ73Ò'vV6†BÖ6öçFVçB"7G–ÆSÒ"G·6†VÆÄ&ræ6öçFVçD&u7G–ÆWÒ#àĞ¢ÂÒÒˆ®ZJˆ8ÎišòÒÓàĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6ffc²FF–æs¢W‚#ƒ²Ö&v–âÖ&÷GFöÓ¢ƒ²7W'6÷#¢ö–çFW#²"–CÒ'6WBÖ&rÖ'Fâ#àĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²§W7F–g’Ö6öçFVçC¢76RÖ&WGvVVã²Æ–vâÖ—FV×3¢6VçFW#²#àĞ¢ÆF—càĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢gƒ²6öÆ÷#¢3²#îŠëî{Úîˆ®ZJˆ8ÎišóÂöF—càĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢'ƒ²6öÆ÷#¢3“““²Ö&v–â×F÷¢7ƒ²#îi»NhÚ.[Ù>X˜Şˆ®ZJy¨Nˆ8ÎišşY»îx˜sÂöF—càĞ¢ÂöF—càĞ¢Æ’6Æ73Ò&f×6öÆ–BfÖ6†Wg&öâ×&–v‡B"7G–ÆSÒ&6öÆ÷#¢63†3†3ƒ²#ãÂö“àĞ¢ÂöF—càĞ¢ÂöF—càĞ Ğ¢G²—4w&÷W6†Bò Ğ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6ffc²FF–æs¢W‚#ƒ²Ö&v–âÖ&÷GFöÓ¢ƒ²#àĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²§W7F–g’Ö6öçFVçC¢76RÖ&WGvVVã²Æ–vâÖ—FV×3¢6VçFW#²v¢Gƒ²#àĞ¢ÆF—b7G–ÆSÒ&Ö–â×v–GFƒ¢²#àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢gƒ²6öÆ÷#¢3²#îk:XZ^Šy.ˆ›.XÚY(ÎyJh‹~KúhóÂöF—càĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢'ƒ²6öÆ÷#¢3“““²Ö&v–â×F÷¢7ƒ²Æ–æRÖ†V–v‡C¢ã3S²#îX[>™zŞYîûÈÎK¸^[Ù>X˜ŞZ[ŞXø¾ˆ®ZJKˆŞXhŞ[ŠnXZ^Šy.ˆ›.XÚ8yJh‹rW'6öæY(ÎZJ~Xè^Šy.ˆ›"şyJh‹~‹XNii“ÂöF—càĞ¢ÂöF—càĞ¢ÆÆ&VÂ6Æ73Ò'FövvÆR×7v—F6‚"7G–ÆSÒ&fÆWƒ¢WFó²#àĞ¢Æ–çWBG—SÒ&6†V6¶&÷‚"–CÒ'vV6†B×&öf–ÆRÖ6öçFW‡B×FövvÆR"G·&öf–ÆT6öçFW‡DVæ&ÆVBòv6†V6¶VBr¢rwÓàĞ¢Ç7â6Æ73Ò'FövvÆR×6Æ–FW"#ãÂ÷7ãàĞ¢ÂöÆ&VÃàĞ¢ÂöF—càĞ¢ÂöF—càĞ¢¢rwĞĞ Ğ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6ffc²FF–æs¢W‚#ƒ²Ö&v–âÖ&÷GFöÓ¢ƒ²#àĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²§W7F–g’Ö6öçFVçC¢76RÖ&WGvVVã²Æ–vâÖ—FV×3¢6VçFW#²v¢Gƒ²#àĞ¢ÆF—b7G–ÆSÒ&Ö–â×v–GFƒ¢²#àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢gƒ²6öÆ÷#¢3²#îk:XZ^jÚ>ih~ˆ®ZJŠë[ÙSÂöF—càĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢'ƒ²6öÆ÷#¢3“““²Ö&v–â×F÷¢7ƒ²Æ–æRÖ†V–v‡C¢ã3S²#îX[>™zŞYîûÈÎ[Ù>X˜ŞKÉ®ŠùŞy¨N[êîKúˆ®ZJŠë[Ù^KˆŞKÉ®k:XZ^˜Y.šhnjÚ>ih~ûÈÎKˆŞ[ÛY8ŞiÊÎz©~Xú>Xh^KùŞZÙY(Îiú^yÈ³ÂöF—càĞ¢ÂöF—càĞ¢ÆÆ&VÂ6Æ73Ò'FövvÆR×7v—F6‚"7G–ÆSÒ&fÆWƒ¢WFó²#àĞ¢Æ–çWBG—SÒ&6†V6¶&÷‚"–CÒ'vV6†BÖöffÆ–æRÖ†—7F÷'’×FövvÆR"G¶öffÆ–æT†—7F÷'”–æ¦V7DVæ&ÆVBòv6†V6¶VBr¢rwÓàĞ¢Ç7â6Æ73Ò'FövvÆR×6Æ–FW"#ãÂ÷7ãàĞ¢ÂöÆ&VÃàĞ¢ÂöF—càĞ¢ÂöF—càĞ Ğ¢G²—4w&÷W6†Bò Ğ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6ffc²FF–æs¢W‚#ƒ²Ö&v–âÖ&÷GFöÓ¢ƒ²#àĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²§W7F–g’Ö6öçFVçC¢76RÖ&WGvVVã²Æ–vâÖ—FV×3¢6VçFW#²v¢Gƒ²#àĞ¢ÆF—b7G–ÆSÒ&Ö–â×v–GFƒ¢²#àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢gƒ²6öÆ÷#¢3²#îk:XZ^‰ÉÎŠúŞˆ®ZJŠë[ÙSÂöF—càĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢'ƒ²6öÆ÷#¢3“““²Ö&v–â×F÷¢7ƒ²Æ–æRÖ†V–v‡C¢ã3S²#î[ÈY
şYîûÈÎjÚNZ[ŞXø¾YÊ‰ÉÎŠúŞy»Ni*Ş™{NK©.Xªi{nKÉ®[ŠnKˆ®[Ù>X˜Ş[êîKúˆ®ZJŠë[ÙSÂöF—càĞ¢ÂöF—càĞ¢ÆÆ&VÂ6Æ73Ò'FövvÆR×7v—F6‚"7G–ÆSÒ&fÆWƒ¢WFó²#àĞ¢Æ–çWBG—SÒ&6†V6¶&÷‚"–CÒ'vV6†BÖ†öæW’Ö†—7F÷'’×FövvÆR"G¶†öæW”–æ¦V7DVæ&ÆVBòv6†V6¶VBr¢rwÓàĞ¢Ç7â6Æ73Ò'FövvÆR×6Æ–FW"#ãÂ÷7ãàĞ¢ÂöÆ&VÃàĞ¢ÂöF—càĞ¢ÂöF—càĞ¢¢rwĞĞ Ğ¢ÂÒÒh¸›¹Z[ŞXø²òz{¾™šN›¹YŞXÙRÒÓàĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6ffc²FF–æs¢W‚#ƒ²Ö&v–âÖ&÷GFöÓ¢ƒ²7W'6÷#¢ö–çFW#²"–CÒ"G¶—4&Æö6¶VBòwVæ&Æö6²Ö6öçF7BÖ'Fâr¢v&Æö6²Ö6öçF7BÖ'FâwÒ#àĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²§W7F–g’Ö6öçFVçC¢76RÖ&WGvVVã²Æ–vâÖ—FV×3¢6VçFW#²#àĞ¢ÆF—càĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢gƒ²6öÆ÷#¢G¶—4&Æö6¶VBòr3v3cr¢r6fc6#3wÓ²#âG¶—4&Æö6¶VBò~z{¾™šN›¹YŞXÙRr¢~h¸›¹Z[ŞXø²wÓÂöF—càĞ¢G¶—4&Æö6¶VBòsÆF—b7G–ÆSÒ&föçB×6—¦S¢'ƒ²6öÆ÷#¢3“““²Ö&v–â×F÷¢7ƒ²#îz{¾™šNYîXúşKº^˜xŞikXù˜Y(Îhê^iKnkhhóÂöF—câr¢rwĞĞ¢ÂöF—càĞ¢Æ’6Æ73Ò&f×6öÆ–BfÖ6†Wg&öâ×&–v‡B"7G–ÆSÒ&6öÆ÷#¢63†3†3ƒ²#ãÂö“àĞ¢ÂöF—càĞ¢ÂöF—càĞ Ğ¢ÂÒÒ	ùJRkˆ^z›®ˆ®ZJŠë[ÙRÒÓàĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6ffc²FF–æs¢W‚#ƒ²Ö&v–â×F÷¢ƒ²7W'6÷#¢ö–çFW#²"–CÒ&6ÆV"Ö6†BÖ'Fâ#àĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²§W7F–g’Ö6öçFVçC¢76RÖ&WGvVVã²Æ–vâÖ—FV×3¢6VçFW#²#àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢gƒ²6öÆ÷#¢6fc6#3²#îkˆ^z›®ˆ®ZJŠë[ÙSÂöF—càĞ¢Æ’6Æ73Ò&f×6öÆ–BfÖ6†Wg&öâ×&–v‡B"7G–ÆSÒ&6öÆ÷#¢63†3†3ƒ²#ãÂö“àĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢°Ğ Ğ¢F†—2æç†öæU6†VÆÂç6WD6öçFVçB†‡FÖÂ“°Ğ Ğ¢òò‹ùNY¹îhÈ™*àĞ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v&6²Ög&öÒÖÖVçRr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢F†—2æç&VæFW"‚“°Ğ¢Ò“°Ğ Ğ¢òòŠëî{Úîˆ8ÎišşhÈ™*àĞ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚w6WBÖ&rÖ'Fâr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢F†—2ç6†÷t&6¶w&÷VæE–6¶W"‚“°Ğ¢Ò“°Ğ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wvV6†BÖöffÆ–æRÖ†—7F÷'’×FövvÆRr“òæFDWfVçDÆ—7FVæW"‚v6†ævRrÂ†R’Óâ°Ğ¢6öç7BVæ&ÆVBÒRçF&vWBæ6†V6¶VC°Ğ¢6öç7Bö²ÒF†—2æçvV6†DFFç6WDöffÆ–æT†—7F÷'”–æ¦V7F–öäf÷$6†Còâ‡F†—2ææ7W'&VçD6†Còæ–BÂVæ&ÆVB“°Ğ¢–b†ö²’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~[êîKúrÂVæ&ÆVBò~[{.XXŠë[Ù>X˜ŞKÉ®ŠùŞˆ®ZJŠë[Ù^k:XZ^jÚ>ihrr¢~[{.zhjÚ.[Ù>X˜ŞKÉ®ŠùŞˆ®ZJŠë[Ù^k:XZ^jÚ>ihrrÂ	ù*Âr“°Ğ¢ĞĞ¢Ò“°Ğ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wvV6†B×&öf–ÆRÖ6öçFW‡B×FövvÆRr“òæFDWfVçDÆ—7FVæW"‚v6†ævRrÂ†R’Óâ°Ğ¢6öç7BVæ&ÆVBÒRçF&vWBæ6†V6¶VC°Ğ¢6öç7Bö²ÒF†—2æçvV6†DFFç6WE&öf–ÆT6öçFW‡D–æ¦V7F–öäf÷$6†Còâ‡F†—2ææ7W'&VçD6†Còæ–BÂVæ&ÆVB“°Ğ¢–b†ö²’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~[êîKúrÂVæ&ÆVBò~[{.[ÈY
şŠy.ˆ›.XÚY(ÎyJh‹~Kúhşk:XZRr¢~[{.X[>™zŞjÚNZ[ŞXø¾y¨NŠy.ˆ›.XÚY(ÎyJh‹~Kúhşk:XZRrÂ	ù*Âr“°Ğ¢ĞĞ¢Ò“°Ğ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wvV6†BÖ†öæW’Ö†—7F÷'’×FövvÆRr“òæFDWfVçDÆ—7FVæW"‚v6†ævRrÂ†R’Óâ°Ğ¢6öç7BVæ&ÆVBÒRçF&vWBæ6†V6¶VC°Ğ¢6öç7Bö²ÒF†—2æçvV6†DFFç6WD†öæW”†—7F÷'”–æ¦V7F–öäf÷$6†Còâ‡F†—2ææ7W'&VçD6†Còæ–BÂVæ&ÆVB“°Ğ¢–b†ö²’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~[êîKúrÂVæ&ÆVBò~[{.[ÈY
ş‰ÉÎŠúŞŠë[Ù^k:XZRr¢~[{.X[>™zŞ‰ÉÎŠúŞŠë[Ù^k:XZRrÂ	ù*Âr“°Ğ¢ĞĞ¢Ò“°Ğ Ğ¢òòh¸›¹Z[ŞXø¾hÈ™*àĞ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v&Æö6²Ö6öçF7BÖ'Fâr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢F†—2ç6†÷t&Æö6´6öçF7DF–Æör†fÇ6R“°Ğ¢Ò“°Ğ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wVæ&Æö6²Ö6öçF7BÖ'Fâr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢F†—2ç6†÷t&Æö6´6öçF7DF–Æör‡G'VR“°Ğ¢Ò“°Ğ Ğ¢òò	ùJRkˆ^z›®ˆ®ZJŠë[Ù^hÈ™*àĞ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6ÆV"Ö6†BÖ'Fâr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢–b†6öæf—&Ò‚~zîZé®kˆ^z›®Kˆî8Âr²F†—2ææ7W'&VçD6†BææÖR²~8Şy¨Nh˜iÈˆ®ZJŠë[Ù^ûÉõÆåÆîy»X[>™»n™+kXkNK™şKÉ®kˆ^™šNûÈÎjÚNi8ŞKÙÎKˆŞXúşh.ZHŞûÈr’’°Ğ¢6öç7B6†D–BÒF†—2ææ7W'&VçD6†Bæ–C°Ğ Ğ¢òò	ùJRiKyJ[©^[.[Š8^Z[Şy¨B6ÆV$ÖW76vW2ikk9^ûÈÎZè>Xh^{ÚîK¨nkˆ^z›®i{n™{N{É>ZÙy¨N˜¾‹éĞ¢F†—2æçvV6†DFFæ6ÆV$ÖW76vW2†6†D–B“°Ğ¢F†—2åö6ÆV%VæF–æu7FFTf÷$6†B†6†D–B“°Ğ Ğ¢òò	ùJ_	ùJ_	ùJRj[ø>KúîZHŞûÉ®˜	®yú^h˜¾iË®ZInZ;>z¸¾XÛ>X‹~ik[znKˆ®Šy.x«nhjşi{n™{@Ğ¢–b‡F†—2æç†öæU6†VÆÂbbG—VöbF†—2æç†öæU6†VÆÂçWFFU7FGW4&%F–ÖRÓÓÒvgVæ7F–öâr’°Ğ¢F†—2æç†öæU6†VÆÂçWFFU7FGW4&%F–ÖR‚“°Ğ¢ĞĞ Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~[{.kˆ^z›¢rÂ~ˆ®ZJŠë[Ù^[{.kˆ^z›¢rÂ~)ÈRr“°Ğ¢6WEF–ÖV÷WB‚‚’ÓâF†—2æç&VæFW"‚’Â“°Ğ¢ĞĞ¢Ò“°Ğ¢ĞĞ Ğ¢òò	øê‚i‹îzK®ˆ8Îišş˜hºYš€Ğ¢6†÷t&6¶w&÷VæE–6¶W"‚’°Ğ¢òò	ùJRYÊ‹ù˜xÎ˜XŞ{ÚîKÚy¨NiÊÎYËš(NŠëîZ8{«‹zş[è@Ğ¢òò	ùJRYÊ‹ù˜xÎ˜XŞ{ÚîKÚy¨NiÊÎYËš(NŠëîZ8{«‹zş[è@Ğ¢6öç7B&W6WD&w2Ò°Ğ¢F†—2æåövWEvV6†D76WEW&Â‚v&6¶w&÷VæG2ö&sçærr’ÀĞ¢F†—2æåövWEvV6†D76WEW&Â‚v&6¶w&÷VæG2ö&s"çærr’ÀĞ¢F†—2æåövWEvV6†D76WEW&Â‚v&6¶w&÷VæG2ö&s2çærr’ÀĞ¢F†—2æåövWEvV6†D76WEW&Â‚v&6¶w&÷VæG2ö&sBçærr’ÀĞ¢F†—2æåövWEvV6†D76WEW&Â‚v&6¶w&÷VæG2ö&sRçærr’ÀĞ¢F†—2æåövWEvV6†D76WEW&Â‚v&6¶w&÷VæG2ö&sbçærr’ÀĞ¢F†—2æåövWEvV6†D76WEW&Â‚v&6¶w&÷VæG2ö&sræ§rrĞ¢Ó°Ğ Ğ¢òòXªhyIşh‰š(NŠëîY»îy¨D…DÔÀĞ¢6öç7B&W6WD‡FÖÂÒ&W6WD&w2æÖ†&rÓâ°Ğ¢6öç7B7G–ÆRÒ&rç7F'G5v—F‚‚r2r’ Ğ¢ò&6¶w&÷VæC¢G¶&wÓ²&÷&FW#¢‚6öÆ–B6SVSVSS¶ Ğ¢¢&6¶w&÷VæBÖ–ÖvS¢W&Â‚rG¶&wÒr“²&6¶w&÷VæB×6—¦S¢6÷fW#²&6¶w&÷VæB×÷6—F–öã¢6VçFW#¶°Ğ¢&WGW&âÆF—b6Æ73Ò'&W6WBÖ&r"FFÖ&sÒ"G¶&wÒ"7G–ÆSÒ&†V–v‡C¢ƒ²&÷&FW"×&F—W3¢‡ƒ²G·7G–ÆWÒ7W'6÷#¢ö–çFW#²÷6—F–öã¢&VÆF—fS²#ãÂöF—cæ°Ğ¢Ò’æ¦ö–â‚rr“°Ğ¢6öç7BW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfóòâ‚’ÇÂ·Ó°Ğ¢6öç7BÆ—7D&t7F—fRÒ7G&–ær‡W6W$–æfòæ6†DÆ—7D&6¶w&÷VæBÇÂrr’çG&–Ò‚“°Ğ¢6öç7BÆÄ6†G4&t7F—fRÒ7G&–ær‡W6W$–æfòævÆö&Ä6†D&6¶w&÷VæBÇÂrr’çG&–Ò‚“°Ğ¢6öç7B6†VÆÄ&rÒF†—2åövWD6†E6WGF–æw56†VÆÄ&6¶w&÷VæD6öæf–r‚“°Ğ¢6öç7B–6¶W$6öçFVçE7G–ÆRÒG·6†VÆÄ&ræ6öçFVçD&u7G–ÆWÒFF–æs¢#ƒ¶°Ğ¢6öç7B&VF&ÆU6†VÆÄ6Æ72ÒF†—2æåövWE&VF&ÆUvV6†E6†VÆÄ6Æ72‡6†VÆÄ&ræ6Æ72“°Ğ¢6öç7B&6¶w&÷VæD7F–öä'WGFöå7G–ÆRÒ Ğ¢v–GFƒ¢S°Ğ¢Ö–âÖ†V–v‡C¢SGƒ°Ğ¢FF–æs¢—‚‡ƒ°Ğ¢&6¶w&÷VæC¢f"‚Ò×vV6†B×&VF&ÆR×7W&f6RÂ4cTcdc‚“°Ğ¢6öÆ÷#¢f"‚Ò×vV6†B×FW‡BÖ6öÆ÷"Â3“°Ğ¢&÷&FW#¢‚6öÆ–Bf"‚Ò×vV6†B×&VF&ÆRÖ&÷&FW"Â3„„„“°Ğ¢&÷&FW"×&F—W3¢‡ƒ°Ğ¢föçB×6—¦S¢7ƒ°Ğ¢föçB×vV–v‡C¢S°Ğ¢Æ–æRÖ†V–v‡C¢ã3S°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢°Ğ Ğ¢6öç7B‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò"G·&VF&ÆU6†VÆÄ6Æ77Ò"7G–ÆSÒ"G·6†VÆÄ&ræ7G–ÆWÒ#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"ÖÆVgB#àĞ¢Æ'WGFöâ6Æ73Ò'vV6†BÖ&6²Ö'Fâ"–CÒ&&6²Ög&öÒÖ&r#àĞ¢Æ’6Æ73Ò&f×6öÆ–BfÖ6†Wg&öâÖÆVgB#ãÂö“àĞ¢Âö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×F—FÆR#î˜hºˆ8ÎišóÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×&–v‡B#ãÂöF—càĞ¢ÂöF—càĞ¢ Ğ¢ÆF—b6Æ73Ò'vV6†BÖ6öçFVçB"7G–ÆSÒ"G·–6¶W$6öçFVçE7G–ÆWÒ#àĞ¢ÂÒÒKˆ®KÊˆz®Zé®K˜ˆ8ÎišòÒÓàĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢f"‚Ò×vV6†B×&VF&ÆR×7W&f6RÂ4cTcdc‚“²&÷&FW#¢‚6öÆ–Bf"‚Ò×vV6†B×&VF&ÆRÖ&÷&FW"Â3„„„“²&÷&FW"×&F—W3¢ƒ²FF–æs¢#ƒ²Ö&v–âÖ&÷GFöÓ¢Wƒ²FW‡BÖÆ–vã¢6VçFW#²#àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢Gƒ²6öÆ÷#¢3“““²Ö&v–âÖ&÷GFöÓ¢'ƒ²#îKˆ®KÊˆz®Zé®K˜ˆ8ÎišóÂöF—càĞ¢Æ–çWBG—SÒ&f–ÆR"–CÒ&&r×WÆöB"66WCÒ&–ÖvR÷ærÂ–ÖvRö§VrÂ–ÖvRöv–bÂ–ÖvR÷vV'Â–ÖvRò¢"7G–ÆSÒ&F—7Æ“¢æöæS²#àĞ¢Æ'WGFöâ–CÒ'WÆöBÖ&rÖ'Fâ"7G–ÆSÒ Ğ¢v–GFƒ¢S°Ğ¢FF–æs¢'ƒ°Ğ¢&6¶w&÷VæC¢f"‚Ò×vV6†B×&VF&ÆR×7W&f6RÂ4cTcdc‚“°Ğ¢6öÆ÷#¢f"‚Ò×vV6†B×FW‡BÖ6öÆ÷"Â3“°Ğ¢&÷&FW#¢‚6öÆ–Bf"‚Ò×vV6†B×&VF&ÆRÖ&÷&FW"Â3„„„“°Ğ¢&÷&FW"×&F—W3¢‡ƒ°Ğ¢föçB×6—¦S¢Gƒ°Ğ¢föçB×vV–v‡C¢S°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢#àĞ¢Æ’6Æ73Ò&f×6öÆ–Bf×WÆöB#ãÂö“â˜hºY»îx˜pĞ¢Âö'WGFöãàĞ¢ÂöF—càĞ Ğ¢ÂÒÒ[êîKúˆ8ÎišşYÎjÚRÒÓàĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢f"‚Ò×vV6†B×&VF&ÆR×7W&f6RÂ4cTcdc‚“²&÷&FW#¢‚6öÆ–Bf"‚Ò×vV6†B×&VF&ÆRÖ&÷&FW"Â3„„„“²&÷&FW"×&F—W3¢ƒ²FF–æs¢#ƒ²Ö&v–âÖ&÷GFöÓ¢Wƒ²#àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢Gƒ²6öÆ÷#¢3“““²Ö&v–âÖ&÷GFöÓ¢Gƒ²#î[êîKúˆ8ÎišşYÎjÚSÂöF—càĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢ƒ²6öÆ÷#¢3v3c²Ö&v–âÖ&÷GFöÓ¢'ƒ²#àĞ¢[êîKúK‹¾š^ûÉ¢G¶Æ—7D&t7F—fRò~[{.YÎjÚRr¢~iÊ®YÎjÚRwÒ+rh˜iÈKÉ®ŠùŞ›¹ŠêNûÉ¢G¶ÆÄ6†G4&t7F—fRò~[{.Šëî{Úâr¢~iÊ®Šëî{ÚâwĞĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢w&–C²w&–B×FV×ÆFRÖ6öÇVÖç3¢g"g#²v¢ƒ²#àĞ¢Æ'WGFöâ–CÒ'7–æ2Ö7W'&VçBÖ&r×FòÖ6†FÆ—7B"7G–ÆSÒ"G¶&6¶w&÷VæD7F–öä'WGFöå7G–ÆWÒ#îYÎjÚ^[Ù>X˜ŞKÉ®ŠùŞˆ8ÎišóÂö'WGFöãàĞ¢Æ'WGFöâ–CÒ'7–æ2Ö7W'&VçBÖ&r×FòÖÆÂÖ6†G2"7G–ÆSÒ"G¶&6¶w&÷VæD7F–öä'WGFöå7G–ÆWÒ#îYÎjÚ^h˜iÈKÉ®ŠùŞˆ8ÎišóÂö'WGFöãàĞ¢Æ'WGFöâ–CÒ&6ÆV"×vV6†BÖ&6¶w&÷VæG2"7G–ÆSÒ"G¶&6¶w&÷VæD7F–öä'WGFöå7G–ÆWÒw&–BÖ6öÇVÖã¢òÓ²Ö–âÖ†V–v‡C¢CGƒ²#îkˆ^™šNˆ8ÎišóÂö'WGFöãàĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ Ğ¢ÂÒÒš(NŠëîˆ8ÎišòÒÓàĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢f"‚Ò×vV6†B×&VF&ÆR×7W&f6RÂ4cTcdc‚“²&÷&FW#¢‚6öÆ–Bf"‚Ò×vV6†B×&VF&ÆRÖ&÷&FW"Â3„„„“²&÷&FW"×&F—W3¢ƒ²FF–æs¢#ƒ²#àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢Gƒ²6öÆ÷#¢3“““²Ö&v–âÖ&÷GFöÓ¢Gƒ²#îš(NŠëîˆ8ÎišóÂöF—càĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢ƒ²6öÆ÷#¢3v3c²Ö&v–âÖ&÷GFöÓ¢Wƒ²#ï	ù*yúŞhÈŠëîK‹®[Ù>X˜Şˆ®ZJûÈÎ™[şhÈŠëîK‹®XZ[›¹ŠêCÂöF—càĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢w&–C²w&–B×FV×ÆFRÖ6öÇVÖç3¢&WVBƒ2Âg"“²v¢ƒ²#àĞ¢G·&W6WD‡FÖÇĞĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢°Ğ Ğ¢F†—2æç†öæU6†VÆÂç6WD6öçFVçB†‡FÖÂ“°Ğ Ğ¢òò‹ùNY¹îhÈ™*àĞ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v&6²Ög&öÒÖ&rr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢F†—2ç6†÷t6†DÖVçR‚“°Ğ¢Ò“°Ğ Ğ¢òòKˆ®KÊˆ8ÎišşhÈ™*àĞ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wWÆöBÖ&rÖ'Fâr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v&r×WÆöBr’æ6Æ–6²‚“°Ğ¢Ò“°Ğ Ğ¢6öç7BG'”6ÆVçW&6¶w&÷VæBÒ†öÆD&rÂ¶VW6WBÒæWr6WB‚’’Óâ°Ğ¢6öç7BöÆEfÇVRÒ7G&–ær†öÆD&rÇÂrr’çG&–Ò‚“°Ğ¢–b‚öÆEfÇVR’&WGW&ã°Ğ¢–b†¶VW6WBæ†2†öÆEfÇVR’’&WGW&ã°Ğ¢6öç7B6ÆVçWF6²Òv–æF÷råf—'GVÅ†öæSòæ–ÖvTÖævW#òæFVÆWFTÖævVD&6¶w&÷VæD'•Fƒòâ†öÆEfÇVRÂ°Ğ¢V–WC¢G'VRÀĞ¢6¶—–e&VfW&Væ6VC¢G'VPĞ¢Ò“°Ğ¢6ÆVçWF6³òæ6F6ƒòâ‚‚’Óâ²Ò“°Ğ¢Ó°Ğ Ğ¢6öç7B6ÆVçW&6¶w&÷VæG2Ò†&6¶w&÷VæG2Â¶VW6WBÒæWr6WB‚’’Óâ°Ğ¢²ââææWr6WB‚„'&’æ—4'&’†&6¶w&÷VæG2’ò&6¶w&÷VæG2¢¶&6¶w&÷VæG5ÒĞ¢æÖ†—FVÒÓâ7G&–ær†—FVÒÇÂrr’çG&–Ò‚’Ğ¢æf–ÇFW"„&ööÆVâ’•ĞĞ¢æf÷$V6‚†—FVÒÓâG'”6ÆVçW&6¶w&÷VæB†—FVÒÂ¶VW6WB’“°Ğ¢Ó°Ğ Ğ¢6öç7BvWD7W'&VçD&6¶w&÷VæDf÷%7–æ2Ò‚’Óâ°Ğ¢6öç7B6†D–BÒ7G&–ær‡F†—2ææ7W'&VçD6†Còæ–BÇÂrr’çG&–Ò‚“°Ğ¢6öç7BFVfVÇD6†D&rÒF†—2æåövWEvV6†D76WEW&Ãòâ‚v&6¶w&÷VæG2ö&sçærr’ÇÂrs°Ğ¢&WGW&â7G&–ær‡F†—2æçvV6†DFFævWD6†D&6¶w&÷VæCòâ†6†D–BÂFVfVÇD6†D&r’ÇÂrr’çG&–Ò‚“°Ğ¢Ó°Ğ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚w7–æ2Ö7W'&VçBÖ&r×FòÖ6†FÆ—7Br“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7BÆFW7EW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfóòâ‚’ÇÂ·Ó°Ğ¢6öç7B6÷W&6T&rÒvWD7W'&VçD&6¶w&÷VæDf÷%7–æ2‚“°Ğ¢–b‚6÷W&6T&r’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~[Ù>X˜Şk*iÈXúşYÎjÚ^y¨Nˆ®ZJˆ8ÎišòrÂ~)ªûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6öç7BöÆDÆ—7D&rÒ7G&–ær†ÆFW7EW6W$–æfòæ6†DÆ—7D&6¶w&÷VæBÇÂrr’çG&–Ò‚“°Ğ¢F†—2æçvV6†DFFç6WD6†DÆ—7D&6¶w&÷VæB‡6÷W&6T&r“°Ğ Ğ¢–b†öÆDÆ—7D&rbböÆDÆ—7D&rÓÒ6÷W&6T&r’°Ğ¢6öç7B¶VW6WBÒæWr6WB…°Ğ¢6÷W&6T&rÀĞ¢7G&–ær‡F†—2ææ7W'&VçD6†Còæ&6¶w&÷VæBÇÂrr’çG&–Ò‚’ÀĞ¢7G&–ær†ÆFW7EW6W$–æfòævÆö&Ä6†D&6¶w&÷VæBÇÂrr’çG&–Ò‚’ÀĞ¢7G&–ær†ÆFW7EW6W$–æfòæÖöÖVçG4&6¶w&÷VæBÇÂrr’çG&–Ò‚Ğ¢Òæf–ÇFW"„&ööÆVâ’“°Ğ¢G'”6ÆVçW&6¶w&÷VæB†öÆDÆ—7D&rÂ¶VW6WB“°Ğ¢ĞĞ Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~Šëî{Úîh‰X©òrÂ~[Ù>X˜ŞKÉ®ŠùŞˆ8Îišş[{.YÎjÚ^X‹[êîKúK‹¾šRrÂ~)ÈRr“°Ğ¢6WEF–ÖV÷WB‚‚’ÓâF†—2æç&VæFW"‚’Â3#“°Ğ¢Ò“°Ğ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚w7–æ2Ö7W'&VçBÖ&r×FòÖÆÂÖ6†G2r“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7B6÷W&6T&rÒvWD7W'&VçD&6¶w&÷VæDf÷%7–æ2‚“°Ğ¢–b‚6÷W&6T&r’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~[Ù>X˜Şk*iÈXúşYÎjÚ^y¨Nˆ®ZJˆ8ÎišòrÂ~)ªûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6öç7BÆFW7EW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfóòâ‚’ÇÂ·Ó°Ğ¢6öç7B&WÆ6VD&6¶w&÷VæG2Ò°Ğ¢ÆFW7EW6W$–æfòævÆö&Ä6†D&6¶w&÷VæBÀĞ¢ââçF†—2æçvV6†DFFævWD6†DÆ—7B‚’æÖ†6†BÓâ6†Còæ&6¶w&÷VæBĞ¢Ó°Ğ¢6öç7B&W7VÇBÒF†—2æçvV6†DFFç6WDÆÄ6†D&6¶w&÷VæG2‡6÷W&6T&r“°Ğ¢6ÆVçW&6¶w&÷VæG2‡&WÆ6VD&6¶w&÷VæG2ÂæWr6WB…·6÷W&6T&uÒ’“°Ğ Ğ¢6öç7B6†D6÷VçBÒçVÖ&W"‡&W7VÇCòæ6†D6÷VçBÇÂ“°Ğ¢6öç7BÖW76vRÒ6†D6÷VçBâ Ğ¢ò[{.YÎjÚRG¶6†D6÷VçGÒKŠ®xëiÈKÉ®ŠùŞûÈÎ[›nŠëîK‹®ikKÉ®ŠùŞ›¹ŠêNˆ8Îišö Ğ¢¢~[{.ŠëîK‹®h˜iÈKÉ®ŠùŞY(ÎikKÉ®ŠùŞy¨N›¹ŠêNˆ8Îišòs°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~Šëî{Úîh‰X©òrÂÖW76vRÂ~)ÈRr“°Ğ¢6WEF–ÖV÷WB‚‚’ÓâF†—2æç&VæFW"‚’Â3#“°Ğ¢Ò“°Ğ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6ÆV"×vV6†BÖ&6¶w&÷VæG2r“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7BÖöFÄ–BÒwvV6†BÖ&6¶w&÷VæBÖ6ÆV"ÖÖöFÂs°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B†ÖöFÄ–B“òç&VÖ÷fR‚“°Ğ Ğ¢6öç7BÖöFÂÒFö7VÖVçBæ7&VFTVÆVÖVçB‚vF—br“°Ğ¢ÖöFÂæ–BÒÖöFÄ–C°Ğ¢ÖöFÂç7G–ÆRæ775FW‡BÒw÷6—F–öã¦'6öÇWFS¶–ç6WC£·¢Ö–æFWƒ£¶&6¶w&÷VæC§&v&ƒÃÃÂã3"“¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦fÆW‚ÖVæC¶§W7F–g’Ö6öçFVçC¦6VçFW#·FF–æs£'ƒ¶&÷‚×6—¦–æs¦&÷&FW"Ö&÷ƒ²s°Ğ¢ÖöFÂæ–ææW$…DÔÂÒ Ğ¢ÆF—b&öÆSÒ&F–Æör"&–ÖÖöFÃÒ'G'VR"&–ÖÆ&VÃÒ.˜hºŠhkˆ^™šNy¨Nˆ8Îišò"7G–ÆSÒ'v–GFƒ£S¶Ö‚×v–GFƒ£33ƒ¶÷fW&fÆ÷s¦†–FFVã¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC¢6c&c&cs¶&÷‚×6†F÷s£'‚3g‚&v&ƒÃÃÂã#"“²#àĞ¢ÆF—b7G–ÆSÒ'FF–æs£G‚g‚ƒ·FW‡BÖÆ–vã¦6VçFW#¶&6¶w&÷VæC§&v&ƒ#SRÃ#SRÃ#SRÂã“B“²#àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£c¶6öÆ÷#¢3²#îkˆ^™šNˆ8ÎišóÂöF—càĞ¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£Gƒ¶föçB×6—¦S£ƒ¶Æ–æRÖ†V–v‡C£ãCS¶6öÆ÷#¢3ƒƒƒ²#î˜hºkˆ^™šNˆÈ>Y»CÂöF—càĞ¢ÂöF—càĞ¢Æ'WGFöâG—SÒ&'WGFöâ"FF×vV6†BÖ&6¶w&÷VæBÖ6ÆV#Ò&7W'&VçB"7G–ÆSÒ'v–GFƒ£S¶Ö–âÖ†V–v‡C£Sƒ·FF–æs£‡‚Gƒ¶&÷&FW#£¶&÷&FW"×F÷£‚6öÆ–B6SVSVSS¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3¶föçB×6—¦S£Gƒ¶7W'6÷#§ö–çFW#²#îkˆ^™šN[Ù>X˜ŞKÉ®ŠùŞˆ8ÎišóÂö'WGFöãàĞ¢Æ'WGFöâG—SÒ&'WGFöâ"FF×vV6†BÖ&6¶w&÷VæBÖ6ÆV#Ò&vÆö&Â"7G–ÆSÒ'v–GFƒ£S¶Ö–âÖ†V–v‡C£Sƒ·FF–æs£‡‚Gƒ¶&÷&FW#£¶&÷&FW"×F÷£‚6öÆ–B6SVSVSS¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3¶föçB×6—¦S£Gƒ¶7W'6÷#§ö–çFW#²#îkˆ^™šNXZ[ˆ8ÎišóÂö'WGFöãàĞ¢Æ'WGFöâG—SÒ&'WGFöâ"FF×vV6†BÖ&6¶w&÷VæBÖ6ÆV#Ò&ÆÂ"7G–ÆSÒ'v–GFƒ£S¶Ö–âÖ†V–v‡C£Sƒ·FF–æs£‡‚Gƒ¶&÷&FW#£¶&÷&FW"×F÷£‚6öÆ–B6SVSVSS¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢6C“3#S¶föçB×6—¦S£Gƒ¶föçB×vV–v‡C£c¶7W'6÷#§ö–çFW#²#îkˆ^™šNh˜iÈKÉ®ŠùŞXø®XZ[ˆ8ÎišóÂö'WGFöãàĞ¢Æ'WGFöâG—SÒ&'WGFöâ"FF×vV6†BÖ&6¶w&÷VæBÖ6ÆV#Ò&6æ6VÂ"7G–ÆSÒ'v–GFƒ£S¶Ö–âÖ†V–v‡C£C‡ƒ¶Ö&v–â×F÷£wƒ·FF–æs£‡‚Gƒ¶&÷&FW#£¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3Ssf#“S¶föçB×6—¦S£Gƒ¶föçB×vV–v‡C£c¶7W'6÷#§ö–çFW#²#îXùnkhƒÂö'WGFöãàĞ¢ÂöF—càĞ¢°Ğ Ğ¢6öç7B†÷7BÒFö7VÖVçBçVW'•6VÆV7F÷"‚rç†öæR×f–WrÖ7W'&VçBr’ÇÂFö7VÖVçBæ&öG“°Ğ¢†÷7BæVæD6†–ÆB†ÖöFÂ“°Ğ¢6öç7B6Æ÷6RÒ‚’ÓâÖöFÂç&VÖ÷fR‚“°Ğ¢6öç7Bf–æ—6‚Ò†ÖW76vRÂöÆD&6¶w&÷VæG2ÒµÒ’Óâ°Ğ¢6Æ÷6R‚“°Ğ¢6ÆVçW&6¶w&÷VæG2†öÆD&6¶w&÷VæG2“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~[{.kˆ^™šBrÂÖW76vRÂ~)ÈRr“°Ğ¢6WEF–ÖV÷WB‚‚’ÓâF†—2æç&VæFW"‚’Â3#“°Ğ¢Ó°Ğ Ğ¢ÖöFÂæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ†WfVçB’Óâ°Ğ¢–b†WfVçBçF&vWBÓÓÒÖöFÂ’6Æ÷6R‚“°Ğ¢Ò“°Ğ¢ÖöFÂçVW'•6VÆV7F÷"‚u¶FF×vV6†BÖ&6¶w&÷VæBÖ6ÆV#Ò&6æ6VÂ%Òr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ6Æ÷6R“°Ğ Ğ¢ÖöFÂçVW'•6VÆV7F÷"‚u¶FF×vV6†BÖ&6¶w&÷VæBÖ6ÆV#Ò&7W'&VçB%Òr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7B6†D–BÒ7G&–ær‡F†—2ææ7W'&VçD6†Còæ–BÇÂrr’çG&–Ò‚“°Ğ¢6öç7BÆFW7EW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfóòâ‚’ÇÂ·Ó°Ğ¢6öç7BöÆD7W'&VçD&rÒ7G&–ær‡F†—2ææ7W'&VçD6†Còæ&6¶w&÷VæBÇÂrr’çG&–Ò‚“°Ğ¢6öç7BvÆö&Ä&rÒ7G&–ær†ÆFW7EW6W$–æfòævÆö&Ä6†D&6¶w&÷VæBÇÂrr’çG&–Ò‚“°Ğ¢–b‚öÆD7W'&VçD&rbbvÆö&Ä&r’°Ğ¢6Æ÷6R‚“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~[Ù>X˜ŞKÉ®ŠùŞ[{.{¸şKÛşyJ›¹ŠêNˆ8ÎišòrÂ~(Kûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6öç7BFVfVÇD6†D&rÒF†—2æåövWEvV6†D76WEW&Â‚v&6¶w&÷VæG2ö&sçærr“°Ğ¢F†—2æçvV6†DFFç6WD6†D&6¶w&÷VæB†6†D–BÂvÆö&Ä&ròFVfVÇD6†D&r¢çVÆÂ“°Ğ¢f–æ—6‚‚~[Ù>X˜ŞKÉ®ŠùŞˆ8Îišş[{.h.ZHŞ›¹ŠêBrÂ¶öÆD7W'&VçD&uÒ“°Ğ¢Ò“°Ğ Ğ¢ÖöFÂçVW'•6VÆV7F÷"‚u¶FF×vV6†BÖ&6¶w&÷VæBÖ6ÆV#Ò&vÆö&Â%Òr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7BÆFW7EW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfóòâ‚’ÇÂ·Ó°Ğ¢6öç7BöÆDÆ—7D&rÒ7G&–ær†ÆFW7EW6W$–æfòæ6†DÆ—7D&6¶w&÷VæBÇÂrr’çG&–Ò‚“°Ğ¢6öç7BöÆDvÆö&Ä&rÒ7G&–ær†ÆFW7EW6W$–æfòævÆö&Ä6†D&6¶w&÷VæBÇÂrr’çG&–Ò‚“°Ğ¢–b‚öÆDÆ—7D&rbböÆDvÆö&Ä&r’°Ğ¢6Æ÷6R‚“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~[Ù>X˜ŞiÊ®Šëî{ÚîXZ[ˆ8ÎišòrÂ~(Kûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢F†—2æçvV6†DFFç6WD6†DÆ—7D&6¶w&÷VæB†çVÆÂ“°Ğ¢F†—2æçvV6†DFFç6WDvÆö&Ä6†D&6¶w&÷VæB†çVÆÂ“°Ğ¢f–æ—6‚‚~XZ[ˆ8Îišş[{.h.ZHŞ›¹ŠêNûÈÎXÙ^xºÎKÉ®ŠùŞˆ8ÎišşKùŞhÈKˆŞXù‚rÂ¶öÆDÆ—7D&rÂöÆDvÆö&Ä&uÒ“°Ğ¢Ò“°Ğ Ğ¢ÖöFÂçVW'•6VÆV7F÷"‚u¶FF×vV6†BÖ&6¶w&÷VæBÖ6ÆV#Ò&ÆÂ%Òr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7BÆFW7EW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfóòâ‚’ÇÂ·Ó°Ğ¢6öç7BöÆD&6¶w&÷VæG2Ò°Ğ¢ÆFW7EW6W$–æfòæ6†DÆ—7D&6¶w&÷VæBÀĞ¢ÆFW7EW6W$–æfòævÆö&Ä6†D&6¶w&÷VæBÀĞ¢ââçF†—2æçvV6†DFFævWD6†DÆ—7B‚’æÖ†6†BÓâ6†Còæ&6¶w&÷VæBĞ¢Ó°Ğ Ğ¢F†—2æçvV6†DFFç6WD6†DÆ—7D&6¶w&÷VæB†çVÆÂ“°Ğ¢F†—2æçvV6†DFFç6WDÆÄ6†D&6¶w&÷VæG2†çVÆÂ“°Ğ¢f–æ—6‚‚~h˜iÈKÉ®ŠùŞXø®XZ[ˆ8Îišş[{.h.ZHŞ›¹ŠêBrÂöÆD&6¶w&÷VæG2“°Ğ¢Ò“°Ğ¢Ò“°Ğ Ğ¢òòKˆ®KÊˆ8ÎišòÒiJşhÈŠ8Xš Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v&r×WÆöBr“òæFDWfVçDÆ—7FVæW"‚v6†ævRrÂ7–æ2†R’Óâ°Ğ¢6öç7Bf–ÆRÒRçF&vWBæf–ÆW5³Ó°Ğ¢–b‚f–ÆR’&WGW&ã°Ğ¢RçF&vWBçfÇVRÒrs°Ğ Ğ¢G'’°Ğ¢6öç7B7&÷W"ÒæWr–ÖvT7&÷W"‡°Ğ¢F—FÆS¢~Š8Xš®ˆ®ZJˆ8ÎišòrÀĞ¢÷WGWEv–GFƒ¢ƒÀĞ¢÷WGWD†V–v‡C¢“#ÀĞ¢f—DÖöFS¢v6öçF–ârÀĞ¢&W6W'fU6÷W&6T7V7E&F–ó¢G'VRÀĞ¢VÆ—G“¢ã’ÀĞ¢Ö„f–ÆU6—¦S¢R¢#B¢#@Ğ¢Ò“°Ğ Ğ¢6öç7B7&÷VD–ÖvRÒv—B7&÷W"æ÷Vâ†f–ÆR“°Ğ Ğ¢6öç7Bf–æÅW&ÂÒv—Bv–æF÷råf—'GVÅ†öæSòæ–ÖvTÖævW#òçWÆöDFFW&Ãòâ†7&÷VD–ÖvRÂv6†F&rr“°Ğ¢–b‚f–æÅW&Â’F‡&÷ræWrW'&÷"‚~Y»îx˜~Kˆ®KÊzêynYšiÊ®X‰ŞZx¾XÉbr“°Ğ¢6öç7B–ÖvTÖævW"Òv–æF÷råf—'GVÅ†öæSòæ–ÖvTÖævW#°Ğ Ğ¢òò	ùJRhùzK®yJh‹~ûÉ®XZ[‹ùiŠş[˜:ûÉğĞ¢6öç7B—4vÆö&ÂÒ6öæf—&Ò‚.Kˆ®KÊh‰X©şûÈÆåÆîx+X{¾8	zîZé®8	[njÚNY»îx˜~ŠëîK‹®8ÎXZ[[êîKúˆ8Îišş8ÕÆîx+X{¾8	Xùnkh8	K¸^ŠëîK‹®8Î[Ù>X˜Şˆ®ZJˆ8Îišş8Ò"“°Ğ¢–b†—4vÆö&Â’°Ğ¢6öç7BÆFW7EW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfóòâ‚’ÇÂ·Ó°Ğ¢6öç7BöÆDvÆö&Ä&rÒ7G&–ær†ÆFW7EW6W$–æfòævÆö&Ä6†D&6¶w&÷VæBÇÂrr’çG&–Ò‚“°Ğ¢6öç7BöÆDÆ—7D&rÒ7G&–ær†ÆFW7EW6W$–æfòæ6†DÆ—7D&6¶w&÷VæBÇÂrr’çG&–Ò‚“°Ğ¢F†—2æçvV6†DFFç6WDvÆö&Ä6†D&6¶w&÷VæB†f–æÅW&Â“°Ğ¢F†—2æçvV6†DFFç6WD6†DÆ—7D&6¶w&÷VæB†f–æÅW&Â“°Ğ¢òòkˆ^z›®[Ù>X˜Şˆ®ZJy¨NxºÎz¸¾ˆ8ÎišşûÈÎŠêZè>‹yş™¨şXZ[ Ğ¢F†—2æçvV6†DFFç6WD6†D&6¶w&÷VæB‡F†—2ææ7W'&VçD6†Bæ–BÂçVÆÂ“² Ğ¢–b†öÆDvÆö&Ä&rbböÆDvÆö&Ä&rÓÒf–æÅW&Â’°Ğ¢6öç7B6ÆVçWF6²Ò–ÖvTÖævW#òæFVÆWFTÖævVD&6¶w&÷VæD'•Fƒòâ†öÆDvÆö&Ä&rÂ²V–WC¢G'VRÂ6¶—–e&VfW&Væ6VC¢G'VRÒ“°Ğ¢6ÆVçWF6³òæ6F6ƒòâ‚‚’Óâ²Ò“°Ğ¢ĞĞ¢–b†öÆDÆ—7D&rbböÆDÆ—7D&rÓÒf–æÅW&ÂbböÆDÆ—7D&rÓÒöÆDvÆö&Ä&r’°Ğ¢6öç7B6ÆVçWF6²Ò–ÖvTÖævW#òæFVÆWFTÖævVD&6¶w&÷VæD'•Fƒòâ†öÆDÆ—7D&rÂ²V–WC¢G'VRÂ6¶—–e&VfW&Væ6VC¢G'VRÒ“°Ğ¢6ÆVçWF6³òæ6F6ƒòâ‚‚’Óâ²Ò“°Ğ¢ĞĞ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~Šëî{Úîh‰X©òrÂ~XZ[[êîKúˆ8Îišş[{.i»NikrÂ~)ÈRr“°Ğ¢ÒVÇ6R°Ğ¢6öç7BöÆD6†D&rÒ7G&–ær‡F†—2ææ7W'&VçD6†Còæ&6¶w&÷VæBÇÂrr’çG&–Ò‚“°Ğ¢F†—2æçvV6†DFFç6WD6†D&6¶w&÷VæB‡F†—2ææ7W'&VçD6†Bæ–BÂf–æÅW&Â“°Ğ¢–b†öÆD6†D&rbböÆD6†D&rÓÒf–æÅW&Â’°Ğ¢6öç7B6ÆVçWF6²Ò–ÖvTÖævW#òæFVÆWFTÖævVD&6¶w&÷VæD'•Fƒòâ†öÆD6†D&rÂ²V–WC¢G'VRÂ6¶—–e&VfW&Væ6VC¢G'VRÒ“°Ğ¢6ÆVçWF6³òæ6F6ƒòâ‚‚’Óâ²Ò“°Ğ¢ĞĞ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~Šëî{Úîh‰X©òrÂ~[Ù>X˜Şˆ®ZJˆ8Îišş[{.i»NikrÂ~)ÈRr“°Ğ¢ĞĞ¢ Ğ¢6WEF–ÖV÷WB‚‚’ÓâF†—2æç&VæFW"‚’ÂS“°Ğ¢Ò6F6‚†W'&÷"’°Ğ¢–b†W'&÷"æÖW76vRÓÒ~yJh‹~Xùnkh‚r’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~Kˆ®KÊZK‹JRrÂW'&÷"æÖW76vRÂ~)ØÂr“°Ğ¢ĞĞ¢ĞĞ¢Ò“°Ğ Ğ¢òò	ùJRš(NŠëîˆ8Îišşx+X{²ş™[şhÈK¨¾K»n{¹Zé Ğ¢Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚rç&W6WBÖ&rr’æf÷$V6‚†—FVÒÓâ°Ğ¢6öç7B&rÒ—FVÒæFF6WBæ&s°Ğ¢ÆWB&W75F–ÖW#°Ğ¢ÆWB—4Æöæu&W72ÒfÇ6S°Ğ Ğ¢6öç7B7F'E&W72Ò‚’Óâ°Ğ¢—4Æöæu&W72ÒfÇ6S°Ğ¢&W75F–ÖW"Ò6WEF–ÖV÷WB‚‚’Óâ°Ğ¢—4Æöæu&W72ÒG'VS°Ğ¢òò™[şhÈ˜¾‹éûÉ®Šëî{ÚîK‹®XZ[ Ğ¢F†—2æçvV6†DFFç6WDvÆö&Ä6†D&6¶w&÷VæB†&r“°Ğ¢F†—2æçvV6†DFFç6WD6†DÆ—7D&6¶w&÷VæB†&r“°Ğ¢òòkˆ^z›®[Ù>X˜Şˆ®ZJy¨N[˜:Šëî{ÚîûÈÎ‹yş™¨şXZ[ Ğ¢F†—2æçvV6†DFFç6WD6†D&6¶w&÷VæB‡F†—2ææ7W'&VçD6†Bæ–BÂçVÆÂ“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~Šëî{Úîh‰X©òrÂ~[{.ŠëîK‹®XZ[[êîKúˆ8ÎišòrÂ~)ÈRr“°Ğ¢ Ğ¢òòŠznŠxXøŞšhûÈZh.iéÎŠëîZH~iJşhÈûÈĞ¢–b†æf–vF÷"çf–'&FR’æf–vF÷"çf–'&FRƒS“°Ğ¢ Ğ¢6WEF–ÖV÷WB‚‚’ÓâF†—2æç&VæFW"‚’Âƒ“°Ğ¢ÒÂc“²òòcjú¾zy.ŠznXù™[şhÈĞ¢Ó°Ğ Ğ¢6öç7BVæE&W72Ò†R’Óâ°Ğ¢6ÆV%F–ÖV÷WB‡&W75F–ÖW"“°Ğ¢–b‚—4Æöæu&W72’°Ğ¢òòyúŞhÈ˜¾‹éûÉ®Šëî{ÚîK‹®[Ù>X˜Şˆ®ZJĞ¢F†—2æçvV6†DFFç6WD6†D&6¶w&÷VæB‡F†—2ææ7W'&VçD6†Bæ–BÂ&r“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~Šëî{Úîh‰X©òrÂ~[Ù>X˜Şˆ®ZJˆ8Îišş[{.i»NikrÂ~)ÈRr“°Ğ¢6WEF–ÖV÷WB‚‚’ÓâF†—2æç&VæFW"‚’Âƒ“°Ğ¢ĞĞ¢Ó°Ğ Ğ¢òòyK^ˆIzºş›Êj~K¨¾K»`Ğ¢—FVÒæFDWfVçDÆ—7FVæW"‚vÖ÷W6VF÷vârÂ7F'E&W72“°Ğ¢—FVÒæFDWfVçDÆ—7FVæW"‚vÖ÷W6WWrÂVæE&W72“°Ğ¢—FVÒæFDWfVçDÆ—7FVæW"‚vÖ÷W6VÆVfRrÂ‚’Óâ6ÆV%F–ÖV÷WB‡&W75F–ÖW"’“°Ğ Ğ¢òòh˜¾iË®zºşŠzniK¨¾K»`Ğ¢—FVÒæFDWfVçDÆ—7FVæW"‚wF÷V6‡7F'BrÂ†R’Óâ°Ğ¢òòRç&WfVçDFVfVÇB‚“²òòKˆŞŠh™‹¾jÚ.›¹ŠêNK¨¾K»nûÈÎY
nX‰izk9^k¹®Xª€Ğ¢7F'E&W72‚“°Ğ¢ÒÂ²76—fS¢G'VRÒ“°Ğ¢—FVÒæFDWfVçDÆ—7FVæW"‚wF÷V6†VæBrÂVæE&W72“°Ğ¢—FVÒæFDWfVçDÆ—7FVæW"‚wF÷V6†Ö÷fRrÂ‚’Óâ6ÆV%F–ÖV÷WB‡&W75F–ÖW"’“°Ğ¢ Ğ¢òò[ş‰KŞXû>™JîˆùÎXÙ^ûÈÎ™‹.jÚ.™[şhÈi{n‹{>X{®kXşŠxYšˆùÎXÙPĞ¢—FVÒæFDWfVçDÆ—7FVæW"‚v6öçFW‡FÖVçRrÂRÓâ²Rç&WfVçDFVfVÇB‚“²Ò“°Ğ¢Ò“°Ğ¢ĞĞ Ğ¢6†÷tÖW76vTÖVçR†ÖW76vT–æFW‚’°Ğ¢6öç7B7W'&VçEf–WrÒF†—2ævWD7W'&VçEvV6†Ef–Wr‚“°Ğ¢6öç7BÖW76vW4F—bÒ7W'&VçEf–WsòçVW'•6VÆV7F÷"‚r66†BÖÖW76vW2r“°Ğ¢–b‚ÖW76vW4F—b’&WGW&ã°Ğ Ğ¢òò	ùJRj[ø>KúîZHŞûÉ®h™>[ÈikˆùÎXÙ^X˜ŞûÈÎXXŠz>{¹Kˆ®Kˆ‹ÚîXZ[X[>™zŞy¹Y
ÎûÈÎ˜şXXŞK¨¾K»nk8N™Ë.ûÈ™z®x8XX>X{nûÈĞ¢–b‡G—VöbF†—2åö7F—fT6Æ÷6TÖVçRÓÓÒvgVæ7F–öâr’°Ğ¢Fö7VÖVçBç&VÖ÷fTWfVçDÆ—7FVæW"‚v6Æ–6²rÂF†—2åö7F—fT6Æ÷6TÖVçR“°Ğ¢Fö7VÖVçBç&VÖ÷fTWfVçDÆ—7FVæW"‚wF÷V6†VæBrÂF†—2åö7F—fT6Æ÷6TÖVçR“°Ğ¢F†—2åö7F—fT6Æ÷6TÖVçRÒçVÆÃ°Ğ¢ĞĞ¢–b‡G—VöbF†—2åö7F—fUF–ÖTÖ&¶W$6Æ÷6TÖVçRÓÓÒvgVæ7F–öâr’°Ğ¢Fö7VÖVçBç&VÖ÷fTWfVçDÆ—7FVæW"‚v6Æ–6²rÂF†—2åö7F—fUF–ÖTÖ&¶W$6Æ÷6TÖVçR“°Ğ¢Fö7VÖVçBç&VÖ÷fTWfVçDÆ—7FVæW"‚wF÷V6†VæBrÂF†—2åö7F—fUF–ÖTÖ&¶W$6Æ÷6TÖVçR“°Ğ¢F†—2åö7F—fUF–ÖTÖ&¶W$6Æ÷6TÖVçRÒçVÆÃ°Ğ¢ĞĞ Ğ¢6öç7BÖW76vW2ÒF†—2æçvV6†DFFævWDÖW76vW2‡F†—2ææ7W'&VçD6†Bæ–B“°Ğ¢6öç7BÖW76vRÒÖW76vW5¶ÖW76vT–æFW…Ó°Ğ¢–b‚ÖW76vR’&WGW&ã°Ğ Ğ¢òòz{¾™šN[Ù>X˜ŞŠxnY»îiz~ˆùÎXÙPĞ¢7W'&VçEf–WrçVW'•6VÆV7F÷$ÆÂ‚ræÖW76vRÖ7F–öâÖÖVçRÂçvV6†B×F–ÖRÖÖ&¶W"ÖÖVçRr’æf÷$V6‚†ÖVçRÓâÖVçRç&VÖ÷fR‚’“°Ğ Ğ¢òòˆë~XùnkhhşXX>{J[›nXŠNijŞZû›ÙikY	8.KÉXXyJ‚ÖW76vR–BZé®KØŞûÈÎ˜şXXŞ™©‰xòş‹ø~kºNkhhşZûÎˆ{BDôÒš®[¨şY(Îi[hÚîKˆ¾j~Xşz{¾8 Ğ¢6öç7BÖW76vT–BÒ7G&–ær†ÖW76vSòæ–BÇÂrr’çG&–Ò‚“°Ğ¢6öç7BÆÄÖW76vTVÆVÖVçG2Ò'&’æg&öÒ†ÖW76vW4F—bçVW'•6VÆV7F÷$ÆÂ‚ræ6†BÖÖW76vRr’“°Ğ¢6öç7BÖW76vTVÆVÖVçBÒÖW76vT–@Ğ¢òÆÄÖW76vTVÆVÖVçG2æf–æB†VÂÓâ7G&–ær†VÃòæFF6WCòæÖW76vT–BÇÂrr’çG&–Ò‚’ÓÓÒÖW76vT–BĞ¢ÇÂÆÄÖW76vTVÆVÖVçG2æf–æB†VÂÓâçVÖ&W"ç'6T–çB†VÃòæFF6WCòæÖW76vT–æFW‚ÇÂrrÂ’ÓÓÒÖW76vT–æFW‚Ğ¢¢ÆÄÖW76vTVÆVÖVçG2æf–æB†VÂÓâçVÖ&W"ç'6T–çB†VÃòæFF6WCòæÖW76vT–æFW‚ÇÂrrÂ’ÓÓÒÖW76vT–æFW‚Ğ¢ÇÂÆÄÖW76vTVÆVÖVçG5¶ÖW76vT–æFW…Ó°Ğ¢–b‚ÖW76vTVÆVÖVçB’&WGW&ã°Ğ Ğ¢6öç7B—5&–v‡BÒÖW76vTVÆVÖVçBæ6Æ74Æ—7Bæ6öçF–ç2‚vÖW76vR×&–v‡Br“°Ğ Ğ¢òòh›îX‹khhşXh^ZëXË®YùğĞ¢6öç7B6öçFVçDVÂÒÖW76vTVÆVÖVçBçVW'•6VÆV7F÷"‚ræÖW76vRÖ6öçFVçBr“°Ğ¢–b‚6öçFVçDVÂ’&WGW&ã°Ğ Ğ¢òòh›îX‹k	Nk:XX>{JûÈXÈ^hºÎY»îx˜~ûÈĞ¢6öç7B'V&&ÆTVÂÒ6öçFVçDVÂçVW'•6VÆV7F÷"‚ræÖW76vR×FW‡BÂæÖW76vR×fö–6RÂæÖW76vR×&VG6¶WBÂæÖW76vRÖ–ÖvRÖ&÷‚ÂæÖW76vR×G&ç6fW"ÂæÖW76vRÖÆö6F–öâÂæÖW76vRÖ6ÆÂ×&V6÷&BÂæÖW76vRÖ6ÆÂ×FW‡BÂæÖW76vR×7F–6¶W"Ö&÷‚ÂæÖW76vR×vV–&òÖ6&BÂæÖW76vR×‚Ö6&BÂæÖW76vR×væw†–ær×F6²Ö6&BÂæÖW76vR×ö¶W"Ö6&BÂæÖW76vR×vW&WvöÆbÖ6&BÂæÖW76vR×VæFW&6÷fW"Ö6&BÂæÖW76vRÖ×W6–2Ö6&BÂæÖW76vRÖ×W6–2ÖÆ—7FVâÖ6&Br“°Ğ¢–b‚'V&&ÆTVÂ’&WGW&ã°Ğ Ğ¢6öç7B—5FW‡DÖW76vRÒÖW76vRçG—RÓÓÒwFW‡BrÇÂÖW76vRçG—S°Ğ¢6öç7B—4Æö6F–öäÖW76vRÒÖW76vRçG—RÓÓÒvÆö6F–öâs°Ğ¢6öç7B—4–ÖvTÖW76vRÒÖW76vRçG—RÓÓÒv–ÖvRs°Ğ¢6öç7B—4–ÖvU&ö×DÖW76vRÒÖW76vRçG—RÓÓÒv–ÖvU÷&ö×Bs°Ğ¢6öç7B—57—7FVÔÖW76vRÒÖW76vRçG—RÓÓÒw7—7FVÒs°Ğ¢6öç7B†46ÆÅG&ç67&—BÒÖW76vRçG—RÓÓÒv6ÆÅ÷&V6÷&BpĞ¢bbÖW76vRç7FGW2ÓÓÒvç7vW&VBpĞ¢bb'&’æ—4'&’†ÖW76vRçG&ç67&—BĞ¢bbÖW76vRçG&ç67&—BæÆVæwF‚â°Ğ Ğ¢òò{;¾{¹şkhhşKˆŞi‹îzK®ˆùÎXÙPĞ¢–b†—57—7FVÔÖW76vR’&WGW&ã°Ğ Ğ¢ÆWB'WGFöç4‡FÖÂÒrs°Ğ Ğ¢–b†—5FW‡DÖW76vRÇÂ—4Æö6F–öäÖW76vRÇÂ—4–ÖvU&ö×DÖW76vR’°Ğ¢'WGFöç4‡FÖÂ³ÒÆ'WGFöâG—SÒ&'WGFöâ"6Æ73Ò&×6rÖ7F–öâÖ'Fâ"FFÖ7F–öãÒ&VF—B"FFÖ–æFWƒÒ"G¶ÖW76vT–æFW‡Ò"FFÖÖW76vRÖ–CÒ"G·F†—2åöW66T‡FÖÂ†ÖW76vT–B—Ò"7G–ÆSÒ&&6¶w&÷VæC¢G&ç7&VçC²6öÆ÷#¢3333²&÷&FW#¢æöæS²&÷&FW"×&–v‡C¢ãW‚6öÆ–B&v&ƒÃÃÃã‚“²FF–æs¢G‚‡ƒ²föçB×6—¦S¢ƒ²7W'6÷#¢ö–çFW#²#î{Én‹éÂö'WGFöãæ°Ğ¢ĞĞ¢'WGFöç4‡FÖÂ³ÒÆ'WGFöâG—SÒ&'WGFöâ"6Æ73Ò&×6rÖ7F–öâÖ'Fâ"FFÖ7F–öãÒ&×VÇF’×6VÆV7B"FFÖ–æFWƒÒ"G¶ÖW76vT–æFW‡Ò"FFÖÖW76vRÖ–CÒ"G·F†—2åöW66T‡FÖÂ†ÖW76vT–B—Ò"7G–ÆSÒ&&6¶w&÷VæC¢G&ç7&VçC²6öÆ÷#¢3333²&÷&FW#¢æöæS²&÷&FW"×&–v‡C¢ãW‚6öÆ–B&v&ƒÃÃÃã‚“²FF–æs¢G‚‡ƒ²föçB×6—¦S¢ƒ²7W'6÷#¢ö–çFW#²#îZI®˜“Âö'WGFöãæ°Ğ¢–b†—5FW‡DÖW76vRÇÂ—4–ÖvTÖW76vR’°Ğ¢'WGFöç4‡FÖÂ³ÒÆ'WGFöâG—SÒ&'WGFöâ"6Æ73Ò&×6rÖ7F–öâÖ'Fâ"FFÖ7F–öãÒ'V÷FR"FFÖ–æFWƒÒ"G¶ÖW76vT–æFW‡Ò"FFÖÖW76vRÖ–CÒ"G·F†—2åöW66T‡FÖÂ†ÖW76vT–B—Ò"7G–ÆSÒ&&6¶w&÷VæC¢G&ç7&VçC²6öÆ÷#¢3333²&÷&FW#¢æöæS²&÷&FW"×&–v‡C¢ãW‚6öÆ–B&v&ƒÃÃÃã‚“²FF–æs¢G‚‡ƒ²föçB×6—¦S¢ƒ²7W'6÷#¢ö–çFW#²#î[É^yJƒÂö'WGFöãæ°Ğ¢ĞĞ¢–b††46ÆÅG&ç67&—B’°Ğ¢'WGFöç4‡FÖÂ³ÒÆ'WGFöâG—SÒ&'WGFöâ"6Æ73Ò&×6rÖ7F–öâÖ'Fâ"FFÖ7F–öãÒ'f–Wr"FFÖ–æFWƒÒ"G¶ÖW76vT–æFW‡Ò"FFÖÖW76vRÖ–CÒ"G·F†—2åöW66T‡FÖÂ†ÖW76vT–B—Ò"7G–ÆSÒ&&6¶w&÷VæC¢G&ç7&VçC²6öÆ÷#¢3333²&÷&FW#¢æöæS²&÷&FW"×&–v‡C¢ãW‚6öÆ–B&v&ƒÃÃÃã‚“²FF–æs¢G‚‡ƒ²föçB×6—¦S¢ƒ²7W'6÷#¢ö–çFW#²#îiú^yÈ³Âö'WGFöãæ°Ğ¢ĞĞ¢'WGFöç4‡FÖÂ³ÒÆ'WGFöâG—SÒ&'WGFöâ"6Æ73Ò&×6rÖ7F–öâÖ'Fâ"FFÖ7F–öãÒ'&V6ÆÂ"FFÖ–æFWƒÒ"G¶ÖW76vT–æFW‡Ò"FFÖÖW76vRÖ–CÒ"G·F†—2åöW66T‡FÖÂ†ÖW76vT–B—Ò"7G–ÆSÒ&&6¶w&÷VæC¢G&ç7&VçC²6öÆ÷#¢3333²&÷&FW#¢æöæS²&÷&FW"×&–v‡C¢ãW‚6öÆ–B&v&ƒÃÃÃã‚“²FF–æs¢G‚‡ƒ²föçB×6—¦S¢ƒ²7W'6÷#¢ö–çFW#²#îi*NY¹ãÂö'WGFöãæ°Ğ¢'WGFöç4‡FÖÂ³ÒÆ'WGFöâG—SÒ&'WGFöâ"6Æ73Ò&×6rÖ7F–öâÖ'Fâ"FFÖ7F–öãÒ&FVÆWFR"FFÖ–æFWƒÒ"G¶ÖW76vT–æFW‡Ò"FFÖÖW76vRÖ–CÒ"G·F†—2åöW66T‡FÖÂ†ÖW76vT–B—Ò"7G–ÆSÒ&&6¶w&÷VæC¢G&ç7&VçC²6öÆ÷#¢6fc6#3²&÷&FW#¢æöæS²FF–æs¢G‚‡ƒ²föçB×6—¦S¢ƒ²7W'6÷#¢ö–çFW#²#îXŠ™šCÂö'WGFöãæ°Ğ Ğ¢6öç7BÖVçTVÂÒFö7VÖVçBæ7&VFTVÆVÖVçB‚vF—br“°Ğ¢ÖVçTVÂæ6Æ74æÖRÒvÖW76vRÖ7F–öâÖÖVçRvV6†BÖÖW76vRÖ7F–öâÖÖVçRs°Ğ¢ÖVçTVÂç7G–ÆRæ775FW‡BÒ Ğ¢÷6—F–öã¢'6öÇWFR–×÷'FçC°Ğ¢ÆVgC¢–×÷'FçC°Ğ¢F÷¢–×÷'FçC°Ğ¢&–v‡C¢WFò–×÷'FçC°Ğ¢&÷GFöÓ¢WFò–×÷'FçC°Ğ¢¢Ö–æFWƒ¢C–×÷'FçC°Ğ¢Ö‚×v–GFƒ¢6Æ2ƒRÒg‚’–×÷'FçC°Ğ¢Ö&v–ã¢–×÷'FçC°Ğ¢f—6–&–Æ—G“¢†–FFVâ–×÷'FçC°Ğ¢G&ç6f÷&Ó¢æöæR–×÷'FçC°Ğ¢°Ğ¢ÖVçTVÂæ–ææW$…DÔÂÒ Ğ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃã’“²&6¶G&÷Öf–ÇFW#¢&ÇW"ƒ‡‚“²×vV&¶—BÖ&6¶G&÷Öf–ÇFW#¢&ÇW"ƒ‡‚“²&÷&FW"×&F—W3¢Gƒ²÷fW&fÆ÷s¢†–FFVã²&÷‚×6†F÷s¢‚G‚&v&ƒÃÃÃã"“²v†—FR×76S¢æ÷w&²#àĞ¢G¶'WGFöç4‡FÖÇĞĞ¢ÂöF—càĞ¢°Ğ Ğ¢6öç7BÖVçT†÷7BÒ'V&&ÆTVÂæ6Æ÷6W7B‚rç†öæR×f–WrÖÆ–W"rĞ¢ÇÂ7W'&VçEf–WsòçVW'•6VÆV7F÷#òâ‚rçvV6†BÖrĞ¢ÇÂ7W'&VçEf–Ws°Ğ¢–b‚ÖVçT†÷7CòæVæD6†–ÆBÇÂÖVçT†÷7CòævWD&÷VæF–æt6Æ–VçE&V7B’&WGW&ã°Ğ¢ÖVçT†÷7BæVæD6†–ÆB†ÖVçTVÂ“°Ğ Ğ¢6öç7B÷6—F–öäÖVçRÒ‚’Óâ°Ğ¢–b‚ÖVçTVÂæ—46öææV7FVBÇÂ'V&&ÆTVÂæ—46öææV7FVB’&WGW&ã°Ğ¢6öç7B†÷7E&V7BÒÖVçT†÷7BævWD&÷VæF–æt6Æ–VçE&V7B‚“°Ğ¢6öç7B'V&&ÆU&V7BÒ'V&&ÆTVÂævWD&÷VæF–æt6Æ–VçE&V7B‚“°Ğ¢6öç7BÖVçU&V7BÒÖVçTVÂævWD&÷VæF–æt6Æ–VçE&V7B‚“°Ğ¢6öç7B†÷7Ev–GF‚Ò†÷7E&V7Bçv–GF‚ÇÂÖVçT†÷7Bæ6Æ–VçEv–GF‚ÇÂ°Ğ¢6öç7B†÷7D†V–v‡BÒ†÷7E&V7Bæ†V–v‡BÇÂÖVçT†÷7Bæ6Æ–VçD†V–v‡BÇÂ°Ğ¢6öç7BVFvRÒƒ°Ğ¢6öç7BvÒC°Ğ Ğ¢ÆWBÆVgBÒ—5&–v‡@Ğ¢ò'V&&ÆU&V7Bç&–v‡BÒ†÷7E&V7BæÆVgBÒÖVçU&V7Bçv–GF€Ğ¢¢'V&&ÆU&V7BæÆVgBÒ†÷7E&V7BæÆVgC°Ğ¢6öç7BÖ„ÆVgBÒÖF‚æÖ‚†VFvRÂ†÷7Ev–GF‚ÒÖVçU&V7Bçv–GF‚ÒVFvR“°Ğ¢ÆVgBÒÖF‚æÖ–â„ÖF‚æÖ‚†VFvRÂÆVgB’ÂÖ„ÆVgB“°Ğ Ğ¢6öç7B&÷fRÒ'V&&ÆU&V7BçF÷Ò†÷7E&V7BçF÷ÒÖVçU&V7Bæ†V–v‡BÒv°Ğ¢6öç7B&VÆ÷rÒ'V&&ÆU&V7Bæ&÷GFöÒÒ†÷7E&V7BçF÷²v°Ğ¢6öç7BÖ…F÷ÒÖF‚æÖ‚†VFvRÂ†÷7D†V–v‡BÒÖVçU&V7Bæ†V–v‡BÒVFvR“°Ğ¢6öç7BF÷Ò&÷fRãÒVFvPĞ¢ò&÷fPĞ¢¢ÖF‚æÖ–â„ÖF‚æÖ‚†VFvRÂ&VÆ÷r’ÂÖ…F÷“°Ğ Ğ¢ÖVçTVÂç7G–ÆRç6WE&÷W'G’‚vÆVgBrÂG´ÖF‚ç&÷VæB†ÆVgB—×†Âv–×÷'FçBr“°Ğ¢ÖVçTVÂç7G–ÆRç6WE&÷W'G’‚wF÷rÂG´ÖF‚ç&÷VæB‡F÷—×†Âv–×÷'FçBr“°Ğ¢ÖVçTVÂç7G–ÆRç6WE&÷W'G’‚w&–v‡BrÂvWFòrÂv–×÷'FçBr“°Ğ¢ÖVçTVÂç7G–ÆRç6WE&÷W'G’‚v&÷GFöÒrÂvWFòrÂv–×÷'FçBr“°Ğ¢ÖVçTVÂç7G–ÆRç6WE&÷W'G’‚wf—6–&–Æ—G’rÂwf—6–&ÆRrÂv–×÷'FçBr“°Ğ¢Ó°Ğ¢÷6—F–öäÖVçR‚“°Ğ¢&WVW7Dæ–ÖF–öäg&ÖR‡÷6—F–öäÖVçR“°Ğ Ğ¢òò	ùJRZé®K˜{¹şKˆy¨NˆùÎXÙ^kˆ^ynX{Şi[ûÈÎ[Û¾[©^Xˆ~ijŞXh^ZÙk8NkÈğĞ¢6öç7B6ÆVçWÖVçRÒ‚’Óâ°Ğ¢7W'&VçEf–WrçVW'•6VÆV7F÷$ÆÂ‚ræÖW76vRÖ7F–öâÖÖVçRr’æf÷$V6‚†ÒÓâÒç&VÖ÷fR‚’“°Ğ¢–b‡G—VöbF†—2åö7F—fT6Æ÷6TÖVçRÓÓÒvgVæ7F–öâr’°Ğ¢Fö7VÖVçBç&VÖ÷fTWfVçDÆ—7FVæW"‚v6Æ–6²rÂF†—2åö7F—fT6Æ÷6TÖVçR“°Ğ¢Fö7VÖVçBç&VÖ÷fTWfVçDÆ—7FVæW"‚wF÷V6†VæBrÂF†—2åö7F—fT6Æ÷6TÖVçR“°Ğ¢F†—2åö7F—fT6Æ÷6TÖVçRÒçVÆÃ°Ğ¢ĞĞ¢Ó°Ğ Ğ¢òòhÈ™*îx+X{¾K¨¾K»`Ğ¢ÖVçTVÂçVW'•6VÆV7F÷$ÆÂ‚ræ×6rÖ7F–öâÖ'Fâr’æf÷$V6‚†'FâÓâ°Ğ¢F†—2åö&–æEvV6†DÖVçT7F–öâ†'FâÂ‚’Óâ°Ğ¢6öç7B7F–öâÒ'FâæFF6WBæ7F–öã°Ğ¢6öç7B–æFW‚Ò'6T–çB†'FâæFF6WBæ–æFW‚“°Ğ¢6öç7B7F–öäÖW76vT–BÒ7G&–ær†'FâæFF6WBæÖW76vT–BÇÂrr’çG&–Ò‚“°Ğ¢6öç7BÖW76vW2ÒF†—2æçvV6†DFFævWDÖW76vW2‡F†—2ææ7W'&VçD6†Bæ–B’ÇÂµÓ°Ğ¢6öç7B&W6öÇfVD–æFW‚Ò7F–öäÖW76vT–@Ğ¢òÖW76vW2æf–æD–æFW‚†×6rÓâ7G&–ær†×6sòæ–BÇÂrr’çG&–Ò‚’ÓÓÒ7F–öäÖW76vT–BĞ¢¢–æFWƒ°Ğ¢6öç7B6fT–æFW‚Ò&W6öÇfVD–æFW‚ÓÒÓò&W6öÇfVD–æFW‚¢–æFWƒ°Ğ Ğ¢6ÆVçWÖVçR‚“²òò	ùJRj[ø>ûÉ®hš~ŠÎK»¾KÙ^i8ŞKÙÎX˜ŞûÈÎXXh™>hš¾[›.Xxh‰YË®ûÈĞ Ğ¢–b†7F–öâÓÓÒvFVÆWFRr’°Ğ¢F†—2æFVÆWFTÖW76vR‡6fT–æFW‚Â7F–öäÖW76vT–B“°Ğ¢ÒVÇ6R–b†7F–öâÓÓÒvVF—Br’°Ğ¢6öç7BF&vWDÖW76vRÒÖW76vW3òå·6fT–æFW…Ó°Ğ¢–b‡F&vWDÖW76vSòçG—RÓÓÒv–ÖvU÷&ö×Br’°Ğ¢F†—2æ÷Vä–ÖvU&ö×DVF—F÷"‡F&vWDÖW76vRæ–BÇÂ7F–öäÖW76vT–B“°Ğ¢ÒVÇ6R°Ğ¢F†—2æVF—DÖW76vR‡6fT–æFW‚Â7F–öäÖW76vT–B“°Ğ¢ĞĞ¢ÒVÇ6R–b†7F–öâÓÓÒv×VÇF’×6VÆV7Br’°Ğ¢6öç7BF&vWDÖW76vRÒÖW76vW3òå·6fT–æFW…Ó°Ğ¢F†—2æVçFW$ÖW76vU6VÆV7F–öäÖöFR‡F&vWDÖW76vSòæ–BÇÂçVÆÂ“°Ğ¢ÒVÇ6R–b†7F–öâÓÓÒw&V6ÆÂr’°Ğ¢F†—2ç&V6ÆÄÖW76vR‡6fT–æFW‚Â7F–öäÖW76vT–B“°Ğ¢ÒVÇ6R–b†7F–öâÓÓÒwV÷FRr’°Ğ¢F†—2çV÷FTÖW76vR‡6fT–æFW‚Â7F–öäÖW76vT–B“°Ğ¢ÒVÇ6R–b†7F–öâÓÓÒwf–Wrr’°Ğ¢F†—2çf–Wt6ÆÅG&ç67&—B‡6fT–æFW‚Â7F–öäÖW76vT–B“°Ğ¢ĞĞ¢Ò“°Ğ¢Ò“°Ğ Ğ¢òòZIn˜:x+X{¾X[>™zŞK¨¾K»`Ğ¢6WEF–ÖV÷WB‚‚’Óâ°Ğ¢6öç7B÷VæVDBÒFFRææ÷r‚“°Ğ¢6öç7B6Æ÷6TÖVçRÒ†WgB’Óâ°Ğ¢òòz{¾Xªzºş™[şhÈYîy¨NšinKŠ®Y¹îkXx+X{¾KˆŞX[>ˆùÎXÙ^ûÈÎ˜şXXŞ™z®xë Ğ¢–b„FFRææ÷r‚’Ò÷VæVDBÂ3S’&WGW&ã°Ğ¢–b†ÖVçTVÂæ6öçF–ç2†WgBçF&vWB’’&WGW&ã°Ğ¢6ÆVçWÖVçR‚“²òòx+X{¾ZInKê~i{nh™>hš¾h‰YË Ğ¢Ó°Ğ¢F†—2åö7F—fT6Æ÷6TÖVçRÒ6Æ÷6TÖVçS°Ğ¢Fö7VÖVçBæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ6Æ÷6TÖVçR“°Ğ¢Fö7VÖVçBæFDWfVçDÆ—7FVæW"‚wF÷V6†VæBrÂ6Æ÷6TÖVçR“°Ğ¢ÒÂ“°Ğ¢ĞĞ Ğ¢òò	ù8Biú^yÈ¾˜	®ŠùÒG&ç67&—NûÈ™[şhÈˆùÎXÙRÓâiú^yÈ¾ûÈĞ¢f–Wt6ÆÅG&ç67&—B†ÖW76vT–æFW‚ÂÖW76vT–BÒrr’°Ğ¢6öç7BÖW76vW2ÒF†—2æçvV6†DFFævWDÖW76vW2‡F†—2ææ7W'&VçD6†Bæ–B“°Ğ¢6öç7B6fTÖW76vT–BÒ7G&–ær†ÖW76vT–BÇÂrr’çG&–Ò‚“°Ğ¢6öç7BÖW76vRÒ6fTÖW76vT–@Ğ¢òÖW76vW2æf–æB†×6rÓâ7G&–ær†×6sòæ–BÇÂrr’çG&–Ò‚’ÓÓÒ6fTÖW76vT–BĞ¢¢ÖW76vW5¶ÖW76vT–æFW…Ó°Ğ¢–b‚ÖW76vRÇÂÖW76vRçG—RÓÒv6ÆÅ÷&V6÷&Br’&WGW&ã°Ğ Ğ¢6öç7BG&ç67&—BÒ'&’æ—4'&’†ÖW76vRçG&ç67&—B’òÖW76vRçG&ç67&—B¢µÓ°Ğ¢–b‡G&ç67&—BæÆVæwF‚ÓÓÒ’°Ğ¢F†—2æç†öæU6†VÆÃòç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~Šú^˜	®ŠùŞk*iÈXúşiú^yÈ¾y¨NŠë[ÙRrÂ~(Kûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wvV6†BÖ6ÆÂ×G&ç67&—BÖÖöFÂr“òç&VÖ÷fR‚“°Ğ Ğ¢6öç7BW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfò‚“°Ğ¢6öç7BW6W$æÖRÒW6W$–æfóòææÖRÇÂ~h‰s°Ğ¢6öç7B6ÆÅG—TæÖRÒÖW76vRæ6ÆÅG—RÓÓÒwf–FVòrò~Šxnš)˜	®ŠùÒr¢~ŠúŞ™û>˜	®ŠùÒs°Ğ¢6öç7BF—FÆRÒG¶6ÆÅG—TæÖWÒ+rG¶ÖW76vRæGW&F–öâÇÂrwÖçG&–Ò‚“°Ğ Ğ¢6öç7BG&ç67&—D‡FÖÂÒG&ç67&—BæÖ†—FVÒÓâ°Ğ¢6öç7Bg&öÒÒ7G&–ær†—FVÓòæg&öÒÇÂrr’çG&–Ò‚“°Ğ¢6öç7BFW‡BÒ7G&–ær†—FVÓòçFW‡BÇÂrr’çG&–Ò‚“°Ğ¢–b‚FW‡B’&WGW&ârs°Ğ Ğ¢6öç7B—4ÖRÒg&öÒÓÓÒvÖRrÇÂg&öÒÓÓÒW6W$æÖS°Ğ¢6öç7B7V¶W"Ò—4ÖRòW6W$æÖR¢g&öÓ°Ğ¢6öç7B'6VBÒF†—2å÷'6UvV6†D'V&&ÆTF—7Æ’‡FW‡B“°Ğ¢6öç7B†4–ææW%F†÷Vv‡BÒ'6VBæ–ææW%F†÷Vv‡C°Ğ Ğ¢&WGW&â Ğ¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ²G¶—4ÖRòv§W7F–g’Ö6öçFVçC¦fÆW‚ÖVæC²r¢v§W7F–g’Ö6öçFVçC¦fÆW‚×7F'C²wÒÖ&v–âÖ&÷GFöÓ£‡ƒ²#àĞ¢ÆF—b7G–ÆSÒ&Ö‚×v–GFƒ£ƒ"S²F—7Æ“¦fÆWƒ²fÆW‚ÖF—&V7F–öã¦6öÇVÖã²G¶—4ÖRòvÆ–vâÖ—FV×3¦fÆW‚ÖVæC²r¢vÆ–vâÖ—FV×3¦fÆW‚×7F'C²wÒ#àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ²6öÆ÷#¢3ƒƒƒ²Ö&v–âÖ&÷GFöÓ£'ƒ²#âG·F†—2åöW66T‡FÖÂ‡7V¶W"—ÓÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ–ææW"Ö÷2×w&W"#àĞ¢ÆF—b6Æ73Ò"Gµ²wvV6†BÖ6ÆÂ×7ö¶VâÖ'V&&ÆRrÂ'6VBæ†5G&ç6ÆF–öâòwvV6†BÖ6ÆÂ×G&ç6ÆF–öâÖ6&Br¢rrÂ†4–ææW%F†÷Vv‡BòwvV6†BÖ–ææW"Ö÷2Ö'V&&ÆRr¢ruÒæf–ÇFW"„&ööÆVâ’æ¦ö–â‚rr—Ò"7G–ÆSÒ Ğ¢÷6—F–öã§&VÆF—fS°Ğ¢&6¶w&÷VæC¢G¶—4ÖRòr3“VV3c’r¢r6ffbwÓ°Ğ¢6öÆ÷#¢3###°Ğ¢&÷&FW"×&F—W3£ƒ°Ğ¢FF–æs£w‚G¶†4–ææW%F†÷Vv‡Bòs#'‚r¢s‚wÒw‚ƒ°Ğ¢föçB×6—¦S£'ƒ°Ğ¢Æ–æRÖ†V–v‡C£ãCS°Ğ¢&÷‚×6†F÷s¢G¶—4ÖRòvæöæRr¢s‚'‚&v&ƒÃÃÃã‚’wÓ°Ğ¢v÷&BÖ'&V³¦'&V²×v÷&C°Ğ¢#âG·'6VBæ†5G&ç6ÆF–öàĞ¢òF†—2å÷&VæFW%vV6†D6ÆÅG&ç6ÆF–öä6öçFVçB‡'6VBæ÷&–v–æÅFW‡BÂ'6VBçG&ç6ÆF–öåFW‡BÂ²†4–ææW%F†÷Vv‡BÒĞ¢¢G·F†—2åöW66T‡FÖÂ‡'6VBæ÷&–v–æÅFW‡B—ÒG·F†—2å÷&VæFW%vV6†D6ÆÅ7VV6…vfR‚—ÒG¶†4–ææW%F†÷Vv‡BòsÆ'WGFöâ6Æ73Ò'vV6†BÖ–ææW"Ö÷2ÖföÆB"G—SÒ&'WGFöâ"&–ÖÆ&VÃÒ.iú^yÈ¾Xh^[ø4õ2#ãÂö'WGFöãâr¢rwÖÓÂöF—càĞ¢G·F†—2å÷&VæFW$–ææW%F†÷Vv‡E÷W‡'6VBæ–ææW%F†÷Vv‡B—ĞĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢°Ğ¢Ò’æ¦ö–â‚rr“°Ğ Ğ¢6öç7B‡FÖÂÒ Ğ¢ÆF—b–CÒ'vV6†BÖ6ÆÂ×G&ç67&—BÖÖöFÂ"6Æ73Ò'vV6†BÖ6ÆÂ×G&ç67&—BÖ÷fW&Æ’"7G–ÆSÒ Ğ¢÷6—F–öã¦'6öÇWFS²–ç6WC£²¢Ö–æFWƒ£““““°Ğ¢&6¶w&÷VæC§&v&ƒÃÃÃã3b“°Ğ¢F—7Æ“¦fÆWƒ²Æ–vâÖ—FV×3¦6VçFW#²§W7F–g’Ö6öçFVçC¦6VçFW#°Ğ¢FF–æs£‡‚Gƒ°Ğ¢&÷‚×6—¦–æs¦&÷&FW"Ö&÷ƒ°Ğ¢#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ6ÆÂ×G&ç67&—B×æVÂ"7G–ÆSÒ Ğ¢v–GFƒ£S²Ö‚×v–GFƒ£33ƒ²Ö‚Ö†V–v‡C£s‚S°Ğ¢&6¶w&÷VæC¢6cVcVcS°Ğ¢&÷&FW"×&F—W3£Gƒ°Ğ¢&÷‚×6†F÷s£'‚#‡‚&v&ƒÃÃÃã#"“°Ğ¢÷fW&fÆ÷s¦†–FFVã°Ğ¢F—7Æ“¦fÆWƒ²fÆW‚ÖF—&V7F–öã¦6öÇVÖã°Ğ¢#àĞ¢ÆF—b7G–ÆSÒ Ğ¢†V–v‡C£C'ƒ²fÆW‚×6‡&–æ³£°Ğ¢F—7Æ“¦fÆWƒ²Æ–vâÖ—FV×3¦6VçFW#²§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã°Ğ¢FF–æs£‚'ƒ°Ğ¢&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒÃÃÃãb“°Ğ¢&6¶w&÷VæC¢6ffc°Ğ¢#àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S£7ƒ²6öÆ÷#¢3###²föçB×vV–v‡C£S²÷fW&fÆ÷s¦†–FFVã²FW‡BÖ÷fW&fÆ÷s¦VÆÆ—6—3²v†—FR×76S¦æ÷w&²#àĞ¢G·F†—2åöW66T‡FÖÂ‡F—FÆR—ĞĞ¢ÂöF—càĞ¢Æ'WGFöâ–CÒ'vV6†BÖ6ÆÂ×G&ç67&—BÖ6Æ÷6R"7G–ÆSÒ Ğ¢&÷&FW#¦æöæS²&6¶w&÷VæC§G&ç7&VçC²6öÆ÷#¢3ccc°Ğ¢v–GFƒ£#‡ƒ²†V–v‡C£#‡ƒ²&÷&FW"×&F—W3£gƒ²7W'6÷#§ö–çFW#°Ğ¢F—7Æ“¦fÆWƒ²Æ–vâÖ—FV×3¦6VçFW#²§W7F–g’Ö6öçFVçC¦6VçFW#°Ğ¢#àĞ¢Æ’6Æ73Ò&f×6öÆ–Bf×†Ö&²#ãÂö“àĞ¢Âö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ6ÆÂ×G&ç67&—BÖ&öG’"7G–ÆSÒ Ğ¢fÆWƒ£²÷fW&fÆ÷r×“¦WFó²÷fW&fÆ÷r×ƒ¦†–FFVã°Ğ¢×vV&¶—BÖ÷fW&fÆ÷r×67&öÆÆ–æs§F÷V6ƒ°Ğ¢FF–æs£‚‚'ƒ°Ğ¢&÷‚×6—¦–æs¦&÷&FW"Ö&÷ƒ°Ğ¢#àĞ¢G·G&ç67&—D‡FÖÂÇÂsÆF—b7G–ÆSÒ&föçB×6—¦S£'ƒ¶6öÆ÷#¢3“““·FW‡BÖÆ–vã¦6VçFW#·FF–æs£G‚²#îi¨.izXh^Zë“ÂöF—câwĞĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢°Ğ Ğ¢6öç7B†÷7BÒFö7VÖVçBçVW'•6VÆV7F÷"‚rç†öæR×f–WrÖ7W'&VçBr’ÇÂFö7VÖVçBæ&öG“°Ğ¢†÷7Bæ–ç6W'DF¦6VçD…DÔÂ‚v&Vf÷&VVæBrÂ‡FÖÂ“°Ğ¢F†—2æ&–æD–ææW%F†÷Vv‡DWfVçG2†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wvV6†BÖ6ÆÂ×G&ç67&—BÖÖöFÂr’“°Ğ Ğ¢6öç7B6Æ÷6RÒ‚’Óâ°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wvV6†BÖ6ÆÂ×G&ç67&—BÖÖöFÂr“òç&VÖ÷fR‚“°Ğ¢Ó°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wvV6†BÖ6ÆÂ×G&ç67&—BÖ6Æ÷6Rr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ6Æ÷6R“°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wvV6†BÖ6ÆÂ×G&ç67&—BÖÖöFÂr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ†R’Óâ°Ğ¢–b†RçF&vWCòæ–BÓÓÒwvV6†BÖ6ÆÂ×G&ç67&—BÖÖöFÂr’6Æ÷6R‚“°Ğ¢Ò“°Ğ¢ĞĞ Ğ¢òò	ùyûˆòXŠ™šNkhhğĞ¢FVÆWFTÖW76vR†ÖW76vT–æFW‚ÂÖW76vT–BÒrr’°Ğ¢òòy»Nhê^XŠ™šNûÈÎKˆŞ™ÈŠhzîŠêNûÈYºK‹®[{.{¸şiŠş™[şhÈi8ŞKÙÎK¨nûÈĞ¢6öç7B6†D–BÒF†—2ææ7W'&VçD6†Bæ–C°Ğ¢6öç7BÖW76vW2ÒF†—2æçvV6†DFFævWDÖW76vW2†6†D–B’ÇÂµÓ°Ğ¢6öç7B6fTÖW76vT–BÒ7G&–ær†ÖW76vT–BÇÂrr’çG&–Ò‚“°Ğ¢6öç7B&W6öÇfVD–æFW‚Ò6fTÖW76vT–@Ğ¢òÖW76vW2æf–æD–æFW‚†×6rÓâ7G&–ær†×6sòæ–BÇÂrr’çG&–Ò‚’ÓÓÒ6fTÖW76vT–BĞ¢¢ÖW76vT–æFWƒ°Ğ¢6öç7B6fT–æFW‚Ò&W6öÇfVD–æFW‚ÓÒÓò&W6öÇfVD–æFW‚¢ÖW76vT–æFWƒ°Ğ¢–b‚ÖW76vW5·6fT–æFW…Ò’&WGW&ã°Ğ Ğ¢6öç7BFVÆWFVD–ÖvUW&Ç2ÒF†—2åö6öÆÆV7DÖævVEvV6†DvVæW&FVD–ÖvW2†ÖW76vW5·6fT–æFW…Ò“°Ğ¢F†—2æçvV6†DFFæFVÆWFTÖW76vR†6†D–BÂ6fT–æFW‚“°Ğ¢F†—2åö6ÆVçWvV6†DvVæW&FVD–ÖvW2†FVÆWFVD–ÖvUW&Ç2“°Ğ Ğ¢òò	ùJR[˜:X‹~ikûÉ®Xú®i»NikkhhşX‰~ŠûÈÎKˆŞ˜xŞ{¹i[NKŠ®yXÎ™Ú Ğ¢F†—2å÷&Vg&W6„7W'&VçD6†DÖW76vW2‡²¶VW67&öÆÃ¢G'VRÒ“°Ğ Ğ¢òò	ùJ_	ùJ_	ùJRj[ø>KúîZHŞûÉ®˜	®yú^h˜¾iË®ZInZ;>z¸¾XÛ>X‹~ik[znKˆ®Šy.x«nhjşi{n™{@Ğ¢–b‡F†—2æç†öæU6†VÆÂbbG—VöbF†—2æç†öæU6†VÆÂçWFFU7FGW4&%F–ÖRÓÓÒvgVæ7F–öâr’°Ğ¢F†—2æç†öæU6†VÆÂçWFFU7FGW4&%F–ÖR‚“°Ğ¢ĞĞ¢ĞĞ Ğ¢FVÆWFTÖçVÅF–ÖTÖ&¶W"†ÖW76vT–æFW‚ÂÖW76vT–BÒrr’°Ğ¢6öç7B6†D–BÒ7G&–ær‡F†—2æòæ7W'&VçD6†Còæ–BÇÂrr’çG&–Ò‚“°Ğ¢–b‚6†D–B’&WGW&ã°Ğ Ğ¢6öç7BÖW76vW2ÒF†—2æçvV6†DFFævWDÖW76vW2†6†D–B’ÇÂµÓ°Ğ¢6öç7B6fTÖW76vT–BÒ7G&–ær†ÖW76vT–BÇÂrr’çG&–Ò‚“°Ğ¢6öç7B&W6öÇfVD–æFW‚Ò6fTÖW76vT–@Ğ¢òÖW76vW2æf–æD–æFW‚†×6rÓâ7G&–ær†×6sòæ–BÇÂrr’çG&–Ò‚’ÓÓÒ6fTÖW76vT–BĞ¢¢ÖW76vT–æFWƒ°Ğ¢6öç7B6fT–æFW‚Ò&W6öÇfVD–æFW‚ÓÒÓò&W6öÇfVD–æFW‚¢ÖW76vT–æFWƒ°Ğ¢6öç7BÖ&¶W"ÒÖW76vW5·6fT–æFW…Ó°Ğ¢–b‚Ö&¶W"ÇÂ†Ö&¶W#òæ—5F–ÖTÖ&¶W"ÓÓÒG'VRÇÂÖ&¶W#òçG—RÓÓÒwF–ÖUöÖ&¶W"r’’&WGW&ã°Ğ Ğ¢F†—2æçvV6†DFFæFVÆWFTÖW76vR†6†D–BÂ6fT–æFW‚“°Ğ¢F†—2å÷&Vg&W6„7W'&VçD6†DÖW76vW2‡²¶VW67&öÆÃ¢G'VRÒ“°Ğ Ğ¢F†—2æç†öæU6†VÆÃòçWFFU7FGW4&%F–ÖSòâ‚“°Ğ¢v–æF÷råf—'GVÅ†öæSòæ†öÖSòç&VæFW#òâ‡²f÷&6TFöÕ&Vg&W6ƒ¢G'VRÒ“°Ğ¢F†—2æç†öæU6†VÆÃòç6†÷tæ÷F–f–6F–öãòâ‚~[{.XŠ™šBrÂ~i{n™{Nhê‹ù¾[{.XŠ™šBrÂ~)ÈRr“°Ğ¢ĞĞ Ğ¢òò	ùHBi*NY¹îkhhğĞ¢&V6ÆÄÖW76vR†ÖW76vT–æFW‚ÂÖW76vT–BÒrr’°Ğ¢6öç7BÖW76vW2ÒF†—2æçvV6†DFFævWDÖW76vW2‡F†—2ææ7W'&VçD6†Bæ–B“°Ğ¢6öç7B6fTÖW76vT–BÒ7G&–ær†ÖW76vT–BÇÂrr’çG&–Ò‚“°Ğ¢6öç7BÖW76vRÒ6fTÖW76vT–@Ğ¢òÖW76vW2æf–æB†×6rÓâ7G&–ær†×6sòæ–BÇÂrr’çG&–Ò‚’ÓÓÒ6fTÖW76vT–BĞ¢¢ÖW76vW5¶ÖW76vT–æFW…Ó°Ğ¢–b‚ÖW76vR’&WGW&ã°Ğ Ğ¢òòˆë~XùnXù˜ˆ^YŞZÙpĞ¢6öç7BW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfò‚“°Ğ¢6öç7B—4ÖRÒÖW76vRæg&öÒÓÓÒvÖRrÇÂÖW76vRæg&öÒÓÓÒW6W$–æfòææÖS°Ğ¢6öç7B6VæFW$æÖRÒ—4ÖRò‡W6W$–æfòææÖRÇÂ~KÚr’¢ÖW76vRæg&öÓ°Ğ Ğ¢òò[nkhhşi»şhÚ.K‹®{;¾{¹şkhhğĞ¢ÖW76vRçG—RÒw7—7FVÒs°Ğ¢ÖW76vRæg&öÒÒw7—7FVÒs°Ğ¢ÖW76vRæ6öçFVçBÒ"G·6VæFW$æÖWÒ.i*NY¹îK¨nKˆiÚkhhö°Ğ Ğ¢òòKùŞZÙi[hÚàĞ¢F†—2æçvV6†DFFç6fTFF‚“°Ğ Ğ¢òò	ùJR[˜:X‹~ikûÉ®Xú®i»NikkhhşX‰~ŠûÈÎKˆŞ˜xŞ{¹i[NKŠ®yXÎ™Ú Ğ¢6öç7B7W'&VçEf–WrÒF†—2ævWD7W'&VçEvV6†Ef–Wr‚“°Ğ¢6öç7BÖW76vW4F—bÒ7W'&VçEf–WsòçVW'•6VÆV7F÷"‚r66†BÖÖW76vW2r“°Ğ¢–b†ÖW76vW4F—b’°Ğ¢6öç7BWFFVDÖW76vW2ÒF†—2æçvV6†DFFævWDÖW76vW2‡F†—2ææ7W'&VçD6†Bæ–B“°Ğ¢ÖW76vW4F—bæ–ææW$…DÔÂÒF†—2å÷&VæFW$ÖW76vT†—7F÷'•v–æF÷r‡WFFVDÖW76vW2ÂW6W$–æfòÂF†—2ææ7W'&VçD6†Bæ–B“°Ğ¢òò	ùJR˜xŞik{¹Zé®™[şhÈK¨¾K»`Ğ¢F†—2æ&–æDÖW76vTÆöæu&W74WfVçG2‚“°Ğ¢F†—2æ&–æDÖçVÅF–ÖTÖ&¶W$WfVçG2‚“°Ğ¢ĞĞ¢ĞĞ Ğ¢òò	ù*Â[É^yJkhhğĞ¢V÷FTÖW76vR†ÖW76vT–æFW‚ÂÖW76vT–BÒrr’°Ğ¢6öç7BÖW76vW2ÒF†—2æçvV6†DFFævWDÖW76vW2‡F†—2ææ7W'&VçD6†Bæ–B“°Ğ¢6öç7B6fTÖW76vT–BÒ7G&–ær†ÖW76vT–BÇÂrr’çG&–Ò‚“°Ğ¢6öç7BÖW76vRÒ6fTÖW76vT–@Ğ¢òÖW76vW2æf–æB†×6rÓâ7G&–ær†×6sòæ–BÇÂrr’çG&–Ò‚’ÓÓÒ6fTÖW76vT–BĞ¢¢ÖW76vW5¶ÖW76vT–æFW…Ó°Ğ¢–b‚ÖW76vRÇÂÖW76vRçG—RÓÓÒw7—7FVÒr’&WGW&ã°Ğ Ğ¢òòˆë~XùnXù˜ˆ^YŞZÙpĞ¢6öç7BW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfò‚“°Ğ¢6öç7B—4ÖRÒÖW76vRæg&öÒÓÓÒvÖRrÇÂÖW76vRæg&öÒÓÓÒW6W$–æfòææÖS°Ğ¢6öç7B6VæFW"Ò—4ÖRò‡W6W$–æfòææÖRÇÂ~h‰r’¢†ÖW76vRæg&öÒÇÂF†—2ææ7W'&VçD6†BææÖR“°Ğ Ğ¢òòˆë~XùnkhhşXh^ZëûÈhŠ®XùnX˜ÓSKŠ®ZÙ~zÊnûÈĞ¢ÆWB6öçFVçBÒÖW76vRæ6öçFVçBÇÂrs°Ğ¢–b†6öçFVçBæÆVæwF‚âS’°Ğ¢6öçFVçBÒ6öçFVçBç7V'7G&–ærƒÂS’²râââs°Ğ¢ĞĞ Ğ¢òòŠëî{Úî[Ù>X˜Ş[É^yJ€Ğ¢F†—2æ7F—fUV÷FRÒ°Ğ¢6VæFW"ÀĞ¢6öçFVç@Ğ¢Ó°Ğ¢F†—2æç&VæFW"‚“°Ğ Ğ¢òòˆ®xJn‹é>XZ^j`Ğ¢6WEF–ÖV÷WB‚‚’Óâ°Ğ¢6öç7B–çWBÒFö7VÖVçBçVW'•6VÆV7F÷"‚ræ6†BÖ–çWBr“°Ğ¢–b†–çWB’–çWBæfö7W2‚“°Ğ¢ÒÂ“°Ğ¢ĞĞ Ğ¢òò)Èşûˆò{Én‹ékhhşûÈy»Nhê^YÊk	Nk:Kˆ®{Én‹éûÈĞ¢VF—DÖW76vR†ÖW76vT–æFW‚ÂÖW76vT–BÒrr’°Ğ¢6öç7BÖW76vW2ÒF†—2æçvV6†DFFævWDÖW76vW2‡F†—2ææ7W'&VçD6†Bæ–B“°Ğ¢6öç7B6fTÖW76vT–BÒ7G&–ær†ÖW76vT–BÇÂrr’çG&–Ò‚“°Ğ¢6öç7B&W6öÇfVD–æFW‚Ò6fTÖW76vT–@Ğ¢òÖW76vW2æf–æD–æFW‚†×6rÓâ7G&–ær†×6sòæ–BÇÂrr’çG&–Ò‚’ÓÓÒ6fTÖW76vT–BĞ¢¢ÖW76vT–æFWƒ°Ğ¢6öç7B6fT–æFW‚Ò&W6öÇfVD–æFW‚ÓÒÓò&W6öÇfVD–æFW‚¢ÖW76vT–æFWƒ°Ğ¢6öç7BÖW76vRÒÖW76vW5·6fT–æFW…Ó°Ğ¢–b‚ÖW76vR’&WGW&ã°Ğ Ğ¢òò	ùJRh›îX‹Zû[©Ny¨Nkhhşk	Nk:Ğ¢6öç7B7W'&VçEf–WrÒF†—2ævWD7W'&VçEvV6†Ef–Wr‚“°Ğ¢6öç7BÖW76vW4F—bÒ7W'&VçEf–WsòçVW'•6VÆV7F÷"‚r66†BÖÖW76vW2r“°Ğ¢–b‚ÖW76vW4F—b’&WGW&ã°Ğ¢6öç7BF&vWDÖW76vT–BÒ7G&–ær†ÖW76vSòæ–BÇÂrr’çG&–Ò‚“°Ğ¢6öç7BÖW76vTVÆVÖVçG2Ò'&’æg&öÒ†ÖW76vW4F—bçVW'•6VÆV7F÷$ÆÂ‚ræ6†BÖÖW76vRr’“°Ğ¢6öç7BÖW76vTVÂÒF&vWDÖW76vT–@Ğ¢òÖW76vTVÆVÖVçG2æf–æB†VÂÓâ7G&–ær†VÃòæFF6WCòæÖW76vT–BÇÂrr’çG&–Ò‚’ÓÓÒF&vWDÖW76vT–BĞ¢ÇÂÖW76vTVÆVÖVçG2æf–æB†VÂÓâçVÖ&W"ç'6T–çB†VÃòæFF6WCòæÖW76vT–æFW‚ÇÂrrÂ’ÓÓÒ6fT–æFW‚Ğ¢¢ÖW76vTVÆVÖVçG2æf–æB†VÂÓâçVÖ&W"ç'6T–çB†VÃòæFF6WCòæÖW76vT–æFW‚ÇÂrrÂ’ÓÓÒ6fT–æFW‚Ğ¢ÇÂÖW76vTVÆVÖVçG5·6fT–æFW…Ó°Ğ¢–b‚ÖW76vTVÂ’&WGW&ã°Ğ Ğ¢6öç7BFW‡DVÂÒÖW76vTVÂçVW'•6VÆV7F÷"‚ræÖW76vR×FW‡BÂæÖW76vRÖÆö6F–öâr“°Ğ¢–b‚FW‡DVÂ’&WGW&ã°Ğ¢F†—2å÷6WDÖW76vT–æÆ–æTVF—DÖöFR‡G'VRÂF†—2ææ7W'&VçD6†Còæ–B“°Ğ Ğ¢òòKùŞZÙXéşZx¾Xh^ZëĞ¢6öç7B—46ÆÅ&V6÷&BÒÖW76vRçG—RÓÓÒv6ÆÅ÷&V6÷&Bs°Ğ¢6öç7B—4Æö6F–öäÖW76vRÒÖW76vRçG—RÓÓÒvÆö6F–öâs°Ğ¢ÆWB÷&–v–æÄ6öçFVçC°Ğ¢–b†—46ÆÅ&V6÷&B’°Ğ¢òò[bG&ç67&—Bi[{¸NjÎ[ÈşXÉnK‹®Xúş{Én‹éih~iÊÀĞ¢6öç7BW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfò‚“°Ğ¢6öç7BW6W$æÖRÒW6W$–æfóòææÖRÇÂ~h‰s°Ğ¢÷&–v–æÄ6öçFVçBÒ†ÖW76vRçG&ç67&—BÇÂµÒ’æÖ‡BÓâ°Ğ¢6öç7B7V¶W"ÒBæg&öÒÓÓÒvÖRròW6W$æÖR¢Bæg&öÓ°Ğ¢&WGW&âG·7V¶W'Ó¢G·BçFW‡GÖ°Ğ¢Ò’æ¦ö–â‚uÆâr’ÇÂrs°Ğ¢ÒVÇ6R°Ğ¢÷&–v–æÄ6öçFVçBÒÖW76vRæ6öçFVçC°Ğ¢ĞĞ¢6öç7B—5&–v‡BÒÖW76vTVÂæ6Æ74Æ—7Bæ6öçF–ç2‚vÖW76vR×&–v‡Br“°Ğ Ğ¢òò	ùJR[nk	Nk:i»şhÚ.K‹®{Én‹éj`Ğ¢FW‡DVÂæ–ææW$…DÔÂÒ Ğ¢ÇFW‡F&V6Æ73Ò&–æÆ–æRÖVF—BÖ–çWB"7G–ÆSÒ Ğ¢v–GFƒ¢S°Ğ¢Ö–âÖ†V–v‡C¢Cƒ°Ğ¢Ö‚Ö†V–v‡C¢Sƒ°Ğ¢FF–æs¢‡ƒ°Ğ¢&÷&FW#¢æöæS°Ğ¢&÷&FW"×&F—W3¢gƒ°Ğ¢föçB×6—¦S¢Wƒ°Ğ¢Æ–æRÖ†V–v‡C¢ãS°Ğ¢&W6—¦S¢æöæS°Ğ¢&6¶w&÷VæC¢G¶—4Æö6F–öäÖW76vRòr6ffbr¢†—5&–v‡Bòr3“VV3c’r¢r6ffbr—Ó°Ğ¢6öÆ÷#¢3°Ğ¢÷WFÆ–æS¢æöæS°Ğ¢föçBÖfÖ–Ç“¢ÖÆR×7—7FVÒÂ&Æ–æ´Ö57—7FVÔföçBÂ6ç2×6W&–c°Ğ¢&÷‚×6—¦–æs¢&÷&FW"Ö&÷ƒ°Ğ¢#âG¶÷&–v–æÄ6öçFVçGÓÂ÷FW‡F&VàĞ¢ÆF—b6Æ73Ò&–æÆ–æRÖVF—BÖ7F–öç2"7G–ÆSÒ Ğ¢F—7Æ“¢fÆWƒ°Ğ¢§W7F–g’Ö6öçFVçC¢fÆW‚ÖVæC°Ğ¢v¢‡ƒ°Ğ¢Ö&v–â×F÷¢gƒ°Ğ¢#àĞ¢Æ'WGFöâ6Æ73Ò&–æÆ–æRÖVF—BÖ6æ6VÂ"7G–ÆSÒ Ğ¢FF–æs¢G‚ƒ°Ğ¢&6¶w&÷VæC¢6ccc°Ğ¢6öÆ÷#¢3ccc°Ğ¢&÷&FW#¢æöæS°Ğ¢&÷&FW"×&F—W3¢Gƒ°Ğ¢föçB×6—¦S¢'ƒ°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢#îXùnkhƒÂö'WGFöãàĞ¢Æ'WGFöâ6Æ73Ò&–æÆ–æRÖVF—B×6fR"7G–ÆSÒ Ğ¢FF–æs¢G‚ƒ°Ğ¢&6¶w&÷VæC¢3v3c°Ğ¢6öÆ÷#¢6ffc°Ğ¢&÷&FW#¢æöæS°Ğ¢&÷&FW"×&F—W3¢Gƒ°Ğ¢föçB×6—¦S¢'ƒ°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢#îKùŞZÙƒÂö'WGFöãàĞ¢ÂöF—càĞ¢°Ğ Ğ¢òòˆz®Xªˆ®xJn[›n˜KŠŞih~iÊÀĞ¢6öç7BFW‡F&VÒFW‡DVÂçVW'•6VÆV7F÷"‚ræ–æÆ–æRÖVF—BÖ–çWBr“°Ğ¢–b‡FW‡F&V’°Ğ¢FW‡F&Væfö7W2‚“°Ğ¢FW‡F&Vç6VÆV7B‚“°Ğ¢ Ğ¢òò	ùºûˆòj[ø>hªNy»îûÉ®™‹¾jÚ.™Jîy¹Y(Î‹é>XZ^K¨¾K»nXi.k:{¹˜Y.šhnûÈÎ™‹.jÚ"WFô6ö×ÆWFRhù.K»nhª^™I[Jk¨0Ğ¢FW‡F&VæFDWfVçDÆ—7FVæW"‚v–çWBrÂ†Wb’ÓâWbç7F÷&÷vF–öâ‚’“°Ğ¢FW‡F&VæFDWfVçDÆ—7FVæW"‚v¶W–F÷vârÂ†Wb’ÓâWbç7F÷&÷vF–öâ‚’“°Ğ¢FW‡F&VæFDWfVçDÆ—7FVæW"‚v¶W—WrÂ†Wb’ÓâWbç7F÷&÷vF–öâ‚’“°Ğ¢FW‡F&VæFDWfVçDÆ—7FVæW"‚vfö7W2rÂ†Wb’ÓâWbç7F÷&÷vF–öâ‚’“°Ğ¢FW‡F&VæFDWfVçDÆ—7FVæW"‚v&ÇW"rÂ†Wb’ÓâWbç7F÷&÷vF–öâ‚’“°Ğ¢ĞĞ Ğ¢òòˆz®Xª‹>i[Nš¹[ª`Ğ¢6öç7BF§W7D†V–v‡BÒ‚’Óâ°Ğ¢FW‡F&Vç7G–ÆRæ†V–v‡BÒvWFòs°Ğ¢FW‡F&Vç7G–ÆRæ†V–v‡BÒÖF‚æÖ–â‡FW‡F&Vç67&öÆÄ†V–v‡BÂS’²w‚s°Ğ¢Ó°Ğ¢FW‡F&VòæFDWfVçDÆ—7FVæW"‚v–çWBrÂF§W7D†V–v‡B“°Ğ¢F§W7D†V–v‡B‚“°Ğ Ğ¢6öç7Bf–æ—6„–æÆ–æTVF—DæE&Vg&W6‚Ò‚’Óâ°Ğ¢6öç7Bf–WrÒF†—2ævWD7W'&VçEvV6†Ef–Wr‚“°Ğ¢6öç7B66÷VDÖW76vW4F—bÒf–WsòçVW'•6VÆV7F÷"‚r66†BÖÖW76vW2r“°Ğ¢–b‡66÷VDÖW76vW4F—b’°Ğ¢6öç7BÆFW7DÖW76vW2ÒF†—2æçvV6†DFFævWDÖW76vW2‡F†—2ææ7W'&VçD6†Bæ–B“°Ğ¢6öç7BW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfò‚“°Ğ¢66÷VDÖW76vW4F—bæ–ææW$…DÔÂÒF†—2å÷&VæFW$ÖW76vT†—7F÷'•v–æF÷r†ÆFW7DÖW76vW2ÂW6W$–æfòÂF†—2ææ7W'&VçD6†Bæ–B“°Ğ¢F†—2æ&–æDÖW76vTÆöæu&W74WfVçG2‚“°Ğ¢ĞĞ¢6WEF–ÖV÷WB‚‚’ÓâF†—2å÷6WDÖW76vT–æÆ–æTVF—DÖöFR†fÇ6RÂF†—2ææ7W'&VçD6†Còæ–B’Â“°Ğ¢Ó°Ğ Ğ¢òòXùnkhhÈ™*àĞ¢FW‡DVÂçVW'•6VÆV7F÷"‚ræ–æÆ–æRÖVF—BÖ6æ6VÂr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ†R’Óâ°Ğ¢Rç7F÷&÷vF–öâ‚“°Ğ¢f–æ—6„–æÆ–æTVF—DæE&Vg&W6‚‚“°Ğ¢Ò“°Ğ Ğ¢òòKùŞZÙhÈ™*àĞ¢FW‡DVÂçVW'•6VÆV7F÷"‚ræ–æÆ–æRÖVF—B×6fRr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ†R’Óâ°Ğ¢Rç7F÷&÷vF–öâ‚“°Ğ¢6öç7BæWt6öçFVçBÒFW‡F&VçfÇVRçG&–Ò‚“°Ğ¢–b†æWt6öçFVçB’°Ğ¢–b†—46ÆÅ&V6÷&B’°Ğ¢F†—2å÷6fT6ÆÅ&V6÷&EG&ç67&—B‡6fT–æFW‚ÂæWt6öçFVçB“°Ğ¢ÒVÇ6R°Ğ¢F†—2æçvV6†DFFæVF—DÖW76vR‡F†—2ææ7W'&VçD6†Bæ–BÂ6fT–æFW‚ÂæWt6öçFVçB“°Ğ¢ĞĞ¢f–æ—6„–æÆ–æTVF—DæE&Vg&W6‚‚“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~[{.KúîiK’rÂ~khhş[{.i»NikrÂ~)ÈRr“°Ğ¢ĞĞ¢Ò“°Ğ Ğ¢òòhÈ’VçFW"KùŞZÙûÈÄW66RXùnkh€Ğ¢FW‡F&VòæFDWfVçDÆ—7FVæW"‚v¶W–F÷vârÂ†R’Óâ°Ğ¢–b†Ræ¶W’ÓÓÒtVçFW"rbbRç6†–gD¶W’’°Ğ¢Rç&WfVçDFVfVÇB‚“°Ğ¢6öç7BæWt6öçFVçBÒFW‡F&VçfÇVRçG&–Ò‚“°Ğ¢–b†æWt6öçFVçB’°Ğ¢–b†—46ÆÅ&V6÷&B’°Ğ¢F†—2å÷6fT6ÆÅ&V6÷&EG&ç67&—B‡6fT–æFW‚ÂæWt6öçFVçB“°Ğ¢ÒVÇ6R°Ğ¢F†—2æçvV6†DFFæVF—DÖW76vR‡F†—2ææ7W'&VçD6†Bæ–BÂ6fT–æFW‚ÂæWt6öçFVçB“°Ğ¢ĞĞ¢f–æ—6„–æÆ–æTVF—DæE&Vg&W6‚‚“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~[{.KúîiK’rÂ~khhş[{.i»NikrÂ~)ÈRr“°Ğ¢ĞĞ¢ÒVÇ6R–b†Ræ¶W’ÓÓÒtW66Rr’°Ğ¢f–æ—6„–æÆ–æTVF—DæE&Vg&W6‚‚“°Ğ¢ĞĞ¢Ò“°Ğ¢ĞĞ Ğ¢òò	ùJRKùŞZÙ‚6ÆÅ÷&V6÷&By¨BG&ç67&—B{Én‹é{¹>iéÀĞ¢÷6fT6ÆÅ&V6÷&EG&ç67&—B†ÖW76vT–æFW‚ÂFW‡D6öçFVçB’°Ğ¢6öç7BÖW76vW2ÒF†—2æçvV6†DFFævWDÖW76vW2‡F†—2ææ7W'&VçD6†Bæ–B“°Ğ¢6öç7BÖW76vRÒÖW76vW5¶ÖW76vT–æFW…Ó°Ğ¢–b‚ÖW76vR’&WGW&ã°Ğ Ğ¢6öç7BW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfò‚“°Ğ¢6öç7BW6W$æÖRÒW6W$–æfóòææÖRÇÂ~h‰s°Ğ Ğ¢òò[nih~iÊÎhÈŠÎŠz>iéY¹â¶g&öÒÂFW‡GÒi[{¸@Ğ¢6öç7BG&ç67&—BÒFW‡D6öçFVçBç7Æ—B‚uÆâr’æf–ÇFW"†ÂÓâÂçG&–Ò‚’’æÖ†Æ–æRÓâ°Ğ¢6öç7B6öÆöä–G‚ÒÆ–æRæ–æFW„öb‚s¢r“°Ğ¢6öç7B6öÆöä–Gƒ"ÒÆ–æRæ–æFW„öb‚~ûÉ¢r“°Ğ¢6öç7B–G‚Ò6öÆöä–G‚ÓÓÒÓò6öÆöä–Gƒ"¢†6öÆöä–Gƒ"ÓÓÒÓò6öÆöä–G‚¢ÖF‚æÖ–â†6öÆöä–G‚Â6öÆöä–Gƒ"’“°Ğ¢–b†–G‚â’°Ğ¢6öç7B7V¶W"ÒÆ–æRç7V'7G&–ærƒÂ–G‚’çG&–Ò‚“°Ğ¢6öç7BFW‡BÒÆ–æRç7V'7G&–ær†–G‚²’çG&–Ò‚“°Ğ¢&WGW&â²g&öÓ¢7V¶W"ÓÓÒW6W$æÖRòvÖRr¢7V¶W"ÂFW‡BÓ°Ğ¢ĞĞ¢&WGW&â²g&öÓ¢vÖRrÂFW‡C¢Æ–æRçG&–Ò‚’Ó°Ğ¢Ò“°Ğ Ğ¢ÖW76vRçG&ç67&—BÒG&ç67&—C°Ğ¢F†—2æçvV6†DFFåöÖW76vW4F—'G•·F†—2ææ7W'&VçD6†Bæ–EÒÒG'VS°Ğ¢F†—2æçvV6†DFFç6fTFF‚“°Ğ¢ĞĞ Ğ¢òò	ùHB˜xŞikyIşh‰iÈYîy¨DkhhğĞ¢7–æ2&VvVæW&FTÆ7D”ÖW76vR‚’°Ğ¢–b‚F†—2æ—4öæÆ–æTÖöFR‚’’°Ğ¢F†—2æç†öæU6†VÆÃòç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~Šû~XX[ÈY
şYÊ{«şjŠ[ÈòrÂ~)ªûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6öç7BÖW76vW2ÒF†—2æçvV6†DFFævWDÖW76vW2‡F†—2ææ7W'&VçD6†Bæ–B“°Ğ¢–b†ÖW76vW2æÆVæwF‚ÓÓÒ’°Ğ¢F†—2æç†öæU6†VÆÃòç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~k*iÈŠë[Ù^Xúş˜xŞikyIşh‰rÂ~)ªûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6öç7B7W'&VçD6†D–BÒF†—2ææ7W'&VçD6†Bæ–C°Ğ¢6öç7BW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfò‚“°Ğ¢6öç7B—4×”ÖW76vRÒ†×6r’Óâ×6rbb†×6ræg&öÒÓÓÒvÖRrÇÂ×6ræg&öÒÓÓÒW6W$–æfòææÖR“°Ğ¢6öç7BFVÆWF&ÆT–æFW†W2ÒµÓ°Ğ¢6öç7BF–ÄÖW76vRÒÖW76vW5¶ÖW76vW2æÆVæwF‚ÒÓ°Ğ¢6öç7BF–Ä&F6„–BÒ7G&–ær‡F–ÄÖW76vSòç&WÇ”&F6„–BÇÂrr’çG&–Ò‚“°Ğ Ğ¢òòKÉXXhÈKˆ®Kˆ‹Úâ’h›jÊ{+îzîY¹îk¹®ûÈÎ˜.˜XŞ(	ÎKˆjÊ‹ùîXùZI®iÚ(	ĞĞ¢–b‡F–Ä&F6„–Bbb—4×”ÖW76vR‡F–ÄÖW76vR’’°Ğ¢f÷"†ÆWB’ÒÖW76vW2æÆVæwF‚Ò²’ãÒ²’ÒÒ’°Ğ¢6öç7B×6rÒÖW76vW5¶•Ó°Ğ¢–b…7G&–ær†×6sòç&WÇ”&F6„–BÇÂrr’çG&–Ò‚’ÓÒF–Ä&F6„–B’'&V³°Ğ¢FVÆWF&ÆT–æFW†W2çW6‚†’“°Ğ¢ĞĞ¢ĞĞ Ğ¢òòX[ÎZëiz~khhşûÉ®k*iÈh›jÊj~Šëi{nûÈÎY¹î˜X‹(	ÎXŠhèiÈYîKˆiÚyJh‹~khhşK˜¾Yîy¨N‹ùî{ºŞY¹îZHŞ(	ĞĞ¢–b†FVÆWF&ÆT–æFW†W2æÆVæwF‚ÓÓÒ’°Ğ¢ÆWBÆ7EW6W$ÖW76vT–æFW‚ÒÓ°Ğ Ğ¢f÷"†ÆWB’ÒÖW76vW2æÆVæwF‚Ò²’ãÒ²’ÒÒ’°Ğ¢–b†—4×”ÖW76vR†ÖW76vW5¶•Ò’’°Ğ¢Æ7EW6W$ÖW76vT–æFW‚Ò“°Ğ¢'&V³°Ğ¢ĞĞ¢ĞĞ Ğ¢–b†Æ7EW6W$ÖW76vT–æFW‚ÓÒÓ’°Ğ¢f÷"†ÆWB’ÒÖW76vW2æÆVæwF‚Ò²’âÆ7EW6W$ÖW76vT–æFWƒ²’ÒÒ’°Ğ¢–b†—4×”ÖW76vR†ÖW76vW5¶•Ò’’'&V³°Ğ¢FVÆWF&ÆT–æFW†W2çW6‚†’“°Ğ¢ĞĞ¢ÒVÇ6R°Ğ¢FVÆWF&ÆT–æFW†W2çW6‚†ÖW76vW2æÆVæwF‚Ò“°Ğ¢ĞĞ¢ĞĞ Ğ¢–b†FVÆWF&ÆT–æFW†W2æÆVæwF‚ÓÓÒ’°Ğ¢F†—2æç†öæU6†VÆÃòç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~Kˆ®Kˆ‹Úîk*iÈXúşi*N™Hy¨B’Y¹îZHÒrÂ~)ªûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢FVÆWF&ÆT–æFW†W2ç6÷'B‚†Â"’Óâ"Ò’æf÷$V6‚‚†–æFW‚’Óâ°Ğ¢F†—2æçvV6†DFFæFVÆWFTÖW76vR†7W'&VçD6†D–BÂ–æFW‚“°Ğ¢Ò“°Ğ Ğ¢6öç7BWFFVDÖW76vW2ÒF†—2æçvV6†DFFævWDÖW76vW2†7W'&VçD6†D–B“°Ğ¢6öç7B7W'&VçEf–WrÒFö7VÖVçBçVW'•6VÆV7F÷"‚rç†öæR×f–WrÖ7W'&VçBçvV6†BÖr“°Ğ¢–b†7W'&VçEf–WrbbF†—2ææ7W'&VçD6†Còæ–BÓÓÒ7W'&VçD6†D–B’°Ğ¢6öç7BÖW76vW4F—bÒF†—2åövWEf—6–&ÆT6†DÖW76vW46öçF–æW"†7W'&VçD6†D–B“°Ğ¢–b†ÖW76vW4F—b’°Ğ¢F†—2ç6Ö'EWFFTÖW76vW2‡WFFVDÖW76vW2ÂW6W$–æfòÂ²6†D–C¢7W'&VçD6†D–BÒ“°Ğ¢ÒVÇ6R°Ğ¢F†—2æç&VæFW"‚“°Ğ¢ĞĞ¢ÒVÇ6R°Ğ¢F†—2æç&VæFW"‚“°Ğ¢ĞĞ Ğ¢òò	ùJ_	ùJ_	ùJR˜	®yú^h˜¾iË®ZInZ;>z¸¾XÛ>X‹~ik[znKˆ®Šy.x«nhjşi{n™{@Ğ¢–b‡F†—2æç†öæU6†VÆÂbbG—VöbF†—2æç†öæU6†VÆÂçWFFU7FGW4&%F–ÖRÓÓÒvgVæ7F–öâr’°Ğ¢F†—2æç†öæU6†VÆÂçWFFU7FGW4&%F–ÖR‚“°Ğ¢ĞĞ Ğ¢òò	ùJR˜xŞikXù˜Šû~k Ğ¢F†—2åöVçVWVUVæF–æt6†B†7W'&VçD6†D–BÂ°Ğ¢6†÷VÆE7F'EF–ÖW#¢fÇ6RÀĞ¢6†÷VÆE6†÷u7FGW3¢G'VPĞ¢Ò“°Ğ¢v—BF†—2çG&–vvW$’†7W'&VçD6†D–B“°Ğ¢ĞĞ Ğ¢òò	ù8²i‹îzK®XŠ™šNˆ®ZJzîŠêNyXÎ™Ú Ğ¢6†÷tFVÆWFT6öæf—&Ò‚’°Ğ¢6öç7B‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò'vV6†BÖvV6†B×&VF&ÆR×6WGF–æw2#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"ÖÆVgB#àĞ¢Æ'WGFöâ6Æ73Ò'vV6†BÖ&6²Ö'Fâ"–CÒ&&6²Ög&öÒÖFVÆWFR#àĞ¢Æ’6Æ73Ò&f×6öÆ–BfÖ6†Wg&öâÖÆVgB#ãÂö“àĞ¢Âö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×F—FÆR#îXŠ™šNˆ®ZJ“ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×&–v‡B#ãÂöF—càĞ¢ÂöF—càĞ¢ Ğ¢ÆF—b6Æ73Ò'vV6†BÖ6öçFVçB"7G–ÆSÒ&&6¶w&÷VæC¢6VFVFVC²FF–æs¢#ƒ²#àĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6ffc²&÷&FW"×&F—W3¢'ƒ²FF–æs¢3ƒ²FW‡BÖÆ–vã¢6VçFW#²#àĞ¢Æ’6Æ73Ò&f×6öÆ–Bf×G&6‚"7G–ÆSÒ&föçB×6—¦S¢C‡ƒ²6öÆ÷#¢6fc6#3²Ö&v–âÖ&÷GFöÓ¢#ƒ²#ãÂö“àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢‡ƒ²föçB×vV–v‡C¢c²6öÆ÷#¢3²Ö&v–âÖ&÷GFöÓ¢ƒ²#îzîZé®ŠhXŠ™šN‹ùKŠ®ˆ®ZJY	~ûÉóÂöF—càĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢Gƒ²6öÆ÷#¢3“““²Ö&v–âÖ&÷GFöÓ¢3ƒ²#îXŠ™šNYî[nkˆ^z›®ˆ®ZJŠë[Ù^Kˆîy»X[>™»n™+kXkCÂöF—càĞ¢ Ğ¢Æ'WGFöâ–CÒ&6öæf—&ÒÖFVÆWFR"7G–ÆSÒ Ğ¢v–GFƒ¢S°Ğ¢FF–æs¢Gƒ°Ğ¢&6¶w&÷VæC¢6fc6#3°Ğ¢6öÆ÷#¢6ffc°Ğ¢&÷&FW#¢æöæS°Ğ¢&÷&FW"×&F—W3¢‡ƒ°Ğ¢föçB×6—¦S¢gƒ°Ğ¢föçB×vV–v‡C¢c°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢Ö&v–âÖ&÷GFöÓ¢ƒ°Ğ¢#îzîZé®XŠ™šCÂö'WGFöãàĞ¢ Ğ¢Æ'WGFöâ–CÒ&6æ6VÂÖFVÆWFR"7G–ÆSÒ Ğ¢v–GFƒ¢S°Ğ¢FF–æs¢Gƒ°Ğ¢&6¶w&÷VæC¢6ccc°Ğ¢6öÆ÷#¢3ccc°Ğ¢&÷&FW#¢æöæS°Ğ¢&÷&FW"×&F—W3¢‡ƒ°Ğ¢föçB×6—¦S¢gƒ°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢#îXùnkhƒÂö'WGFöãàĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢°Ğ Ğ¢F†—2æç†öæU6†VÆÂç6WD6öçFVçB†‡FÖÂ“°Ğ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v&6²Ög&öÒÖFVÆWFRr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢F†—2ç6†÷t6†DÖVçR‚“°Ğ¢Ò“°Ğ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6æ6VÂÖFVÆWFRr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢F†—2ç6†÷t6†DÖVçR‚“°Ğ¢Ò“°Ğ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6öæf—&ÒÖFVÆWFRr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢F†—2æçvV6†DFFæFVÆWFT6†B‡F†—2ææ7W'&VçD6†Bæ–B“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~[{.XŠ™šBrÂ~ˆ®ZJ[{.XŠ™šBrÂ~)ÈRr“°Ğ¢F†—2ææ7W'&VçD6†BÒçVÆÃ°Ğ¢F†—2ææ7W'&VçEf–WrÒv6†G2s°Ğ¢6WEF–ÖV÷WB‚‚’ÓâF†—2æç&VæFW"‚’Â“°Ğ¢Ò“°Ğ¢ĞĞ Ğ¢6†÷t&Æö6´6öçF7DF–Æör†—5Væ&Æö6²ÒfÇ6R’°Ğ¢6öç7B6†BÒF†—2ææ7W'&VçD6†C°Ğ¢–b‚6†BÇÂ6†BçG—RÓÓÒvw&÷Wr’&WGW&ã°Ğ Ğ¢6öç7BÖöFÄ–BÒwvV6†BÖ&Æö6²Ö6öçF7BÖÖöFÂs°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B†ÖöFÄ–B“òç&VÖ÷fR‚“°Ğ Ğ¢6öç7BF—FÆRÒ—5Væ&Æö6²ò~z{¾™šN›¹YŞXÙRr¢~h¸›¹Z[ŞXø²s°Ğ¢6öç7BÖW76vRÒ—5Væ&Æö6°Ğ¢ò[n8ÂG¶6†BææÖWŞ8Şz{¾X{®›¹YŞXÙ^ûÉö Ğ¢¢zîZé®Šhh¸›¹8ÂG¶6†BææÖWŞ8ŞY	~ûÉö°Ğ¢6öç7BFW62Ò—5Væ&Æö6°Ğ¢ò~z{¾™šNYîXúşKº^˜xŞikXù˜Y(Îhê^iKnkhhòpĞ¢¢~h¸›¹Yî[nizk9^iKnX‹Zûikkhhòs°Ğ¢6öç7B7F–öåFW‡BÒ—5Væ&Æö6²ò~z{¾™šBr¢~h¸›¹s°Ğ¢6öç7B7F–öä6öÆ÷"Ò—5Væ&Æö6²òr3v3cr¢r6fc6#3s°Ğ Ğ¢6öç7B‡FÖÂÒ Ğ¢ÆF—b–CÒ"G¶ÖöFÄ–GÒ"7G–ÆSÒ Ğ¢÷6—F–öã¢f—†VC°Ğ¢–ç6WC¢°Ğ¢&6¶w&÷VæC¢&v&ƒÃÃÃã#‚“°Ğ¢¢Ö–æFWƒ¢°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢Æ–vâÖ—FV×3¢6VçFW#°Ğ¢§W7F–g’Ö6öçFVçC¢6VçFW#°Ğ¢FF–æs¢‡ƒ°Ğ¢&÷‚×6—¦–æs¢&÷&FW"Ö&÷ƒ°Ğ¢#àĞ¢ÆF—b7G–ÆSÒ Ğ¢v–GFƒ¢Ö–âƒ#s‚ÂR“°Ğ¢&6¶w&÷VæC¢6ffc°Ğ¢&÷&FW"×&F—W3¢Gƒ°Ğ¢÷fW&fÆ÷s¢†–FFVã°Ğ¢&÷‚×6†F÷s¢'‚3g‚&v&ƒÃÃÃã‚“°Ğ¢FW‡BÖÆ–vã¢6VçFW#°Ğ¢#àĞ¢ÆF—b7G–ÆSÒ'FF–æs¢#'‚‡‚gƒ²#àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢wƒ²föçB×vV–v‡C¢s²6öÆ÷#¢3²Ö&v–âÖ&÷GFöÓ¢‡ƒ²#âG·F—FÆWÓÂöF—càĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢Gƒ²6öÆ÷#¢3333²Æ–æRÖ†V–v‡C¢ãCS²Ö&v–âÖ&÷GFöÓ¢gƒ²#âG¶ÖW76vWÓÂöF—càĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢'ƒ²6öÆ÷#¢3“““²Æ–æRÖ†V–v‡C¢ãCS²#âG¶FW67ÓÂöF—càĞ¢ÂöF—càĞ¢Æ'WGFöâ–CÒ'vV6†BÖ&Æö6²ÖF–ÆörÖ6öæf—&Ò"7G–ÆSÒ Ğ¢v–GFƒ¢S°Ğ¢†V–v‡C¢Cgƒ°Ğ¢&÷&FW#¢æöæS°Ğ¢&÷&FW"×F÷¢‚6öÆ–B6VVS°Ğ¢&6¶w&÷VæC¢6ffc°Ğ¢6öÆ÷#¢G¶7F–öä6öÆ÷'Ó°Ğ¢föçB×6—¦S¢gƒ°Ğ¢föçB×vV–v‡C¢c°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢#âG¶7F–öåFW‡GÓÂö'WGFöãàĞ¢Æ'WGFöâ–CÒ'vV6†BÖ&Æö6²ÖF–ÆörÖ6æ6VÂ"7G–ÆSÒ Ğ¢v–GFƒ¢S°Ğ¢†V–v‡C¢Cgƒ°Ğ¢&÷&FW#¢æöæS°Ğ¢&÷&FW"×F÷¢‚6öÆ–B6VVS°Ğ¢&6¶w&÷VæC¢6ffc°Ğ¢6öÆ÷#¢3333°Ğ¢föçB×6—¦S¢gƒ°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢#îXùnkhƒÂö'WGFöãàĞ¢ÂöF—càĞ¢ÂöF—càĞ¢°Ğ Ğ¢6öç7B†÷7BÒFö7VÖVçBçVW'•6VÆV7F÷"‚rç†öæR×f–WrÖ7W'&VçBr’ÇÂFö7VÖVçBæ&öG“°Ğ¢†÷7Bæ–ç6W'DF¦6VçD…DÔÂ‚v&Vf÷&VVæBrÂ‡FÖÂ“°Ğ Ğ¢6öç7B6Æ÷6RÒ‚’ÓâFö7VÖVçBævWDVÆVÖVçD'”–B†ÖöFÄ–B“òç&VÖ÷fR‚“°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wvV6†BÖ&Æö6²ÖF–ÆörÖ6æ6VÂr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ6Æ÷6R“°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B†ÖöFÄ–B“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ†R’Óâ°Ğ¢–b†RçF&vWCòæ–BÓÓÒÖöFÄ–B’6Æ÷6R‚“°Ğ¢Ò“°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wvV6†BÖ&Æö6²ÖF–ÆörÖ6öæf—&Òr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7Bö²Ò—5Væ&Æö6°Ğ¢òF†—2æçvV6†DFFçVæ&Æö6´6öçF7Còâ†6†Bæ6öçF7D–BĞ¢¢‡F†—2æçvV6†DFFæ&Æö6´6öçF7B†6†Bæ6öçF7D–B’ÂG'VR“°Ğ¢6Æ÷6R‚“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ€Ğ¢ö²ò†—5Væ&Æö6²ò~[{.z{¾™šBr¢~[{.h¸›¹r’¢~i8ŞKÙÎZK‹JRrÀĞ¢ö²ò†—5Væ&Æö6²òG¶6†BææÖWŞ[{.z{¾X{®›¹YŞXÙV¢G¶6†BææÖWŞ[{.Š*¾h¸›¹’¢~h›îKˆŞX‹Šú^ˆN{;¾K«¢rÀĞ¢ö²ò~)ÈRr¢~)ØÂpĞ¢“°Ğ¢F†—2ç6†÷t6†DÖVçR‚“°Ğ¢Ò“°Ğ¢ĞĞ Ğ¢òò	ù;’Šxnš)˜	®ŠùŞyXÎ™Ú.ûÈ[Šdhê^Y
Âşh¹.{¹Ş˜¾‹éûÈ’Òy›Şˆ›.xë¾y(>š8îjÀĞ¢7–æ27F'Ef–FVô6ÆÂ‚’°Ğ¢òò	ùJRX[>™zŞi»NZI®™Ú.iÛğĞ¢F†—2ç6†÷tÖ÷&RÒfÇ6S°Ğ Ğ¢òò	ùJRj8iú^YÊ{«şjŠ[ÈğĞ¢–b‚F†—2æ—4öæÆ–æTÖöFR‚’’°Ğ¢F†—2æç†öæU6†VÆÃòç6†÷tæ÷F–f–6F–öâ‚~zk¾{«şjŠ[ÈòrÂ~Šû~XXYÊŠëî{ÚîKŠŞ[ÈY
şYÊ{«şjŠ[Èşh˜Şˆ;ŞXù‹[~˜	®ŠùÒrÂ~)ªûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6öç7B6öçF7BÒF†—2ææ7W'&VçD6†C°Ğ¢6öç7B—4w&÷W6ÆÂÒ6öçF7CòçG—RÓÓÒvw&÷Ws°Ğ¢6öç7Bw&÷W'F–6—çG57G&—Ò—4w&÷W6ÆÂòF†—2å÷&VæFW$w&÷W6ÆÅ'F–6—çG57G&—†6öçF7B’¢rs°Ğ¢6öç7B6ÆÄ&u7G–ÆRÒF†—2åövWEvV6†D6ÆÄ&6¶w&÷VæE7G–ÆR†6öçF7B“°Ğ Ğ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢òò™‹njëSûÉ®YÎXú¾yXÎ™Ú"Òy›Şˆ›.xë¾y(>š8îjÀĞ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢6öç7B6ÆÆ–æt‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò&6ÆÂÖgVÆÇ67&VVâ#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ"7G–ÆSÒ"G¶6ÆÄ&u7G–ÆWÒ†V–v‡C¢S²F—7Æ“¢fÆWƒ²fÆW‚ÖF—&V7F–öã¢6öÇVÖã²÷fW&fÆ÷s¢†–FFVã²#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW""7G–ÆSÒ&&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃã2“²&6¶G&÷Öf–ÇFW#¢&ÇW"ƒ#‚“²&÷&FW"Ö&÷GFöÓ¢‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÃã2“²#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"ÖÆVgB#àĞ¢ÂÒÒ™©‰xşy¨N‹ùNY¹îhÈ™*îûÈÎyJK¨îhê^zê[›nhºnhŠ®Xû>k¹h˜¾X«şûÈÎ™‹.jÚ.‹zşyK‹û~ZKy»Nhê^˜Y¹îjÎ™Ú"ÒÓàĞ¢Æ'WGFöâ6Æ73Ò'vV6†BÖ&6²Ö'Fâ"–CÒ&÷fW&Æ’Ö†–FFVâÖ&6²"7G–ÆSÒ&F—7Æ“¦æöæS²#ãÂö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×F—FÆR"7G–ÆSÒ&6öÆ÷#¢3333²#âG¶—4w&÷W6ÆÂò~{êNŠxnš)˜	®ŠùÒr¢~Šxnš)˜	®ŠùÒwÓÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×&–v‡B#ãÂöF—càĞ¢ÂöF—càĞ Ğ¢ÆF—b6Æ73Ò'vV6†BÖ6öçFVçB"7G–ÆSÒ&fÆWƒ¢²&6¶w&÷VæC¢G&ç7&VçC²F—7Æ“¢fÆWƒ²fÆW‚ÖF—&V7F–öã¢6öÇVÖã²Æ–vâÖ—FV×3¢6VçFW#²§W7F–g’Ö6öçFVçC¢6VçFW#²FF–æs¢C‚#ƒ²#àĞ¢ÆF—b–CÒ&6ÆÂÖfF""6Æ73Ò&6ÆÂÖfF"Öf—‚"7G–ÆSÒ Ğ¢v–GFƒ¢ƒ°Ğ¢†V–v‡C¢ƒ°Ğ¢&÷&FW"×&F—W3¢SWƒ°Ğ¢&6¶w&÷VæC¢Æ–æV"Öw&F–VçBƒ3VFVrÂ3ccvVVRÂ3scF&"R“°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢Æ–vâÖ—FV×3¢6VçFW#°Ğ¢§W7F–g’Ö6öçFVçC¢6VçFW#°Ğ¢föçB×6—¦S¢SWƒ°Ğ¢Ö&v–âÖ&÷GFöÓ¢#Wƒ°Ğ¢&÷‚×6†F÷s¢‡‚3'‚&v&ƒ"Â#bÂ#3BÂãB“°Ğ¢æ–ÖF–öã¢f–FVòÖ6ÆÆ–ær×VÇ6RãW2V6RÖ–âÖ÷WB–æf–æ—FS°Ğ¢÷fW&fÆ÷s¢†–FFVã°Ğ¢#âG·F†—2æç&VæFW$fF"†6öçF7BæfF"Â	ùBrÂ6öçF7BææÖR—ÓÂöF—càĞ Ğ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢#Gƒ²föçB×vV–v‡C¢c²6öÆ÷#¢3333²Ö&v–âÖ&÷GFöÓ¢‡ƒ²#àĞ¢G¶6öçF7BææÖWĞĞ¢ÂöF—càĞ¢G¶w&÷W'F–6—çG57G&—ĞĞ Ğ¢ÆF—b–CÒ&6ÆÂ×7FGW2"7G–ÆSÒ&föçB×6—¦S¢Wƒ²6öÆ÷#¢&v&ƒÃÃÃãR“²Ö&v–âÖ&÷GFöÓ¢Sƒ²#àĞ¢G¶—4w&÷W6ÆÂò~jÚ>YÊYÎXú¾{êNh‰Y‚âââr¢~jÚ>YÊYÎXú²âââwĞĞ¢ÂöF—càĞ Ğ¢Æ'WGFöâ–CÒ&6æ6VÂÖ6ÆÂÖ'Fâ"7G–ÆSÒ Ğ¢v–GFƒ¢cWƒ°Ğ¢†V–v‡C¢cWƒ°Ğ¢&÷&FW"×&F—W3¢SS°Ğ¢&6¶w&÷VæC¢6fc6#3°Ğ¢&÷&FW#¢æöæS°Ğ¢6öÆ÷#¢6ffc°Ğ¢föçB×6—¦S¢#gƒ°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢&÷‚×6†F÷s¢g‚#‚&v&ƒ#SRÂS’ÂC‚ÂãB“°Ğ¢#àĞ¢Æ’6Æ73Ò&f×6öÆ–Bf×†öæR×6Æ6‚#ãÂö“àĞ¢Âö'WGFöãàĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢'ƒ²6öÆ÷#¢&v&ƒÃÃÃãB“²Ö&v–â×F÷¢ƒ²#îXùnkhƒÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ Ğ¢Ç7G–ÆSàĞ¢¶W–g&ÖW2f–FVòÖ6ÆÆ–ær×VÇ6R°Ğ¢RÂR°Ğ¢G&ç6f÷&Ó¢66ÆRƒ“°Ğ¢&÷‚×6†F÷s¢‡‚3'‚&v&ƒ"Â#bÂ#3BÂãB“°Ğ¢ĞĞ¢SR°Ğ¢G&ç6f÷&Ó¢66ÆRƒãR“°Ğ¢&÷‚×6†F÷s¢'‚C‚&v&ƒ"Â#bÂ#3BÂãb“°Ğ¢ĞĞ¢ĞĞ¢æ6ÆÂÖfF"Öf—‚–Ör°Ğ¢v–GFƒ¢R–×÷'FçC°Ğ¢†V–v‡C¢R–×÷'FçC°Ğ¢Ö&v–ã¢–×÷'FçC°Ğ¢&÷&FW"×&F—W3¢SR–×÷'FçC°Ğ¢ĞĞ¢æ6ÆÂÖfF"Öf—‚F—b°Ğ¢&÷&FW"×&F—W3¢SR–×÷'FçC°Ğ¢ĞĞ¢Â÷7G–ÆSàĞ¢°Ğ Ğ¢F†—2æç†öæU6†VÆÂç6WD6öçFVçB†6ÆÆ–æt‡FÖÂÂwvV6†BÖ6ÆÂÖ÷fW&Æ’r“°Ğ¢òòhºnhŠ®Xû>k¹‹ùNY¹îh˜¾X«şûÈÎ[nX[nzØYÎK¨îx+X{¾hÈ.ijÒşXùnkh‚şh¹.{¹ŞhÈ™*àĞ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v÷fW&Æ’Ö†–FFVâÖ&6²r“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7B6æ6VÄ'FâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6æ6VÂÖ6ÆÂÖ'Fâr’ÇÂ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVòÖ†æwWÖ'Fâr’ÇÂ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6RÖ†æwWÖ'Fâr’ÇÂ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v–æ6öÖ–ærÖ6ÆÂ×&V¦V7BÖ'Fâr“°Ğ¢–b†6æ6VÄ'Fâ’6æ6VÄ'Fâæ6Æ–6²‚“°Ğ¢VÇ6RF†—2æç&VæFW"‚“°Ğ¢Ò“°Ğ Ğ¢ÆWB—46æ6VÆÆVBÒfÇ6S°Ğ¢6öç7B6ÆÄ&÷'D6öçG&öÆÆW"ÒæWr&÷'D6öçG&öÆÆW"‚“°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6æ6VÂÖ6ÆÂÖ'Fâr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢—46æ6VÆÆVBÒG'VS°Ğ¢6ÆÄ&÷'D6öçG&öÆÆW"æ&÷'B‚“°Ğ¢òò	ùJRj[ø>iØh¹¾ûÉ®‹>yJ˜Y.šhnyÉşZéîXZ[XÎjÚ.X{Şi[ Ğ¢–b‡G—Vöbv–æF÷rç7F÷vVæW&F–öâÓÓÒvgVæ7F–öâr’°Ğ¢v–æF÷rç7F÷vVæW&F–öâ‚“°Ğ¢ĞĞ¢òò	ùJRi«NX©¾XYÎ[©^ûÉ®[Ë®X‹nx+X{¾yXÎ™Ú.y¨NXÎjÚ.hÈ™*àĞ¢6öç7B7E7F÷'FâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖW5÷7F÷r“°Ğ¢–b‡7E7F÷'Fâ’°Ğ¢7E7F÷'Fâæ6Æ–6²‚“°Ğ¢ĞĞ¢F†—2æFD6ÆÅ&V6÷&B‚wf–FVòrÂv6æ6VÆÆVBrÂsXˆczy"r“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~[{.Xùnkh‚rÂ—4w&÷W6ÆÂò~{êNŠxnš)˜	®ŠùŞ[{.Xùnkh‚r¢~Šxnš)˜	®ŠùŞ[{.Xùnkh‚rÂ	ù;’r“°Ğ¢6WEF–ÖV÷WB‚‚’ÓâF†—2æç&VæFW"‚’ÂS“°Ğ¢Ò“°Ğ Ğ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢òò™‹njëS.ûÉ¤Xk>zÙnûÈhê^Y
Âşh¹.{¹ŞûÈĞ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ Ğ¢G'’°Ğ¢v—BæWr&öÖ—6R‡&W6öÇfRÓâ6WEF–ÖV÷WB‡&W6öÇfRÂ#’“²òòYÎXú³.zy Ğ Ğ¢–b†—46æ6VÆÆVB’&WGW&ã°Ğ Ğ¢òò	ùJR‹>yJ„Xk>zÙ`Ğ¢6öç7BFV6—6–öâÒv—BF†—2æ6´”f÷$6ÆÄFV6—6–öâ‚wf–FVòrÂ6öçF7BææÖR“°Ğ Ğ¢òò	ùJRzØ”h	Şˆ>ZèÎ‹ùNY¹îi{nûÈÎXhŞjÊj8iú^yJh‹~iŠşY
n[{.{¸şx+X{¾K¨nXùnkhûÈÎh‰nˆ^iŠşY
n[{.{¸ş˜X{®K¨nˆ®ZJyXÎ™Ú Ğ¢–b†—46æ6VÆÆVBÇÂF†—2ææ7W'&VçD6†B’&WGW&ã°Ğ Ğ¢–b†FV6—6–öâæ7F–öâÓÓÒw&V¦V7Br’°Ğ¢òòh¹.{¹ĞĞ¢6öç7B7FGW4F—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6ÆÂ×7FGW2r“°Ğ¢–b‡7FGW4F—b’°Ğ¢7FGW4F—bçFW‡D6öçFVçBÒ—4w&÷W6ÆÂò~{êNh‰YiÊ®hê^Y
Âr¢~Zûik[{.h¹.{¹Òs°Ğ¢7FGW4F—bç7G–ÆRæ6öÆ÷"Òr6fc6#3s°Ğ¢ĞĞ Ğ¢F†—2æFD6ÆÅ&V6÷&B‚wf–FVòrÂw&V¦V7FVBrÂsXˆczy"r“°Ğ Ğ¢6WEF–ÖV÷WB‚‚’Óâ°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~˜	®ŠùŞ{¹>iÙòrÂ—4w&÷W6ÆÂò~{êNh‰YiÊ®hê^Y
ÎŠxnš)˜	®ŠùÒr¢~Zûikh¹.{¹ŞK¨nŠxnš)˜	®ŠùÒrÂ~)ØÂr“°Ğ¢6WEF–ÖV÷WB‚‚’ÓâF†—2æç&VæFW"‚’Â“°Ğ¢ÒÂ#“°Ğ Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ¢òò™‹njëS>ûÉ®hê^Y
Îh‰X©şûÈÎi‹îzK®˜	®ŠùŞyXÎ™Ú Ğ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓĞĞ Ğ¢F†—2ç6†÷uf–FVô6ÆÄ–çFW&f6R†6öçF7BÂFV6—6–öâæf—'7DÖW76vR“°Ğ Ğ¢Ò6F6‚†W'&÷"’°Ğ¢òò	ùJRXË®XˆnKŠŞijŞY(ÎX[nK¹n™IŠúşûÈÎ™Ù›¹ZHNynKŠŞijĞĞ¢–b†—46æ6VÆÆVBÇÂW'&÷"ææÖRÓÓÒt&÷'DW'&÷"r’°Ğ¢6öç6öÆRæÆör‚~)ÈRŠxnš)˜	®ŠùŞ[{.XùnkhûÈÎ™Ù›¹ZHNybr“°Ğ¢ÒVÇ6R°Ğ¢6öç6öÆRæW'&÷"‚~)ØÂŠxnš)˜	®ŠùŞZK‹JS¢rÂW'&÷"“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~˜	®ŠùŞZK‹JRrÂtŠû~k.ZK‹J^ûÈÎŠû~j8iú^{Ù{¹ÎY(ÎYÊ{«şjŠ[ÈşŠëî{ÚârÂ~)ØÂr“°Ğ¢6WEF–ÖV÷WB‚‚’ÓâF†—2æç&VæFW"‚’Â“°Ğ¢ĞĞ¢ĞĞ¢ĞĞ Ğ¢òò	ùJRi‹îzK®Šxnš)˜	®ŠùŞyXÎ™Ú.ûÈhê^˜	®YîûÈ’Òy›Şˆ›.xë¾y(>š8îjÀĞ¢6†÷uf–FVô6ÆÄ–çFW&f6R†6öçF7BÂ”f—'7DÖW76vR’°Ğ¢6ÆV$–çFW'fÂ‡F†—2å÷vV6†D6ÆÅF–ÖW"“°Ğ¢òò	ùJRŠë[Ù^˜	®ŠùŞ[ÈZx¾y¨NXš~h8^i{n™{@Ğ¢6öç7BF–ÖTÖævW"Òv–æF÷råf—'GVÅ†öæSòçF–ÖTÖævW#°Ğ¢6öç7B6ÆÅ7F'EF–ÖRÒF†—2å÷6†÷VÆEW6U&VÅF–ÖTf÷$öæÆ–æT6†B‚Ğ¢òF†—2åö'V–ÆEvV6†E&VÅF–ÖTf–VÆG2‚Ğ¢¢‡F–ÖTÖævW Ğ¢òF–ÖTÖævW"ævWD7W'&VçE7F÷'•F–ÖR‚Ğ¢¢²F–ÖS¢s#£3rÂFFS¢s#CN[›CiÈƒ#izRrÒ“°Ğ¢6öç7B6ÆÅ7F'DWö6‚ÒFFRææ÷r‚“°Ğ¢6öç7B—4w&÷W6ÆÂÒ6öçF7CòçG—RÓÓÒvw&÷Ws°Ğ¢6öç7Bw&÷W'F–6—çG2ÒF†—2åövWDw&÷W6†E'F–6—çG2†6öçF7B“°Ğ¢6öç7Bw&÷W'F–6—çG57G&—Ò—4w&÷W6ÆÂòF†—2å÷&VæFW$w&÷W6ÆÅ'F–6—çG57G&—†6öçF7B’¢rs°Ğ¢6öç7B6ÆÄ&u7G–ÆRÒF†—2åövWEvV6†D6ÆÄ&6¶w&÷VæE7G–ÆR†6öçF7BÂvÆ–æV"Öw&F–VçBƒ3VFVrÂ3ccvVVRÂ3scF&"SRÂ6c“6f"R’r“°Ğ Ğ¢6öç7B‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò&6ÆÂÖgVÆÇ67&VVâ#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ"7G–ÆSÒ"G¶6ÆÄ&u7G–ÆWÒ†V–v‡C¢S²F—7Æ“¢fÆWƒ²fÆW‚ÖF—&V7F–öã¢6öÇVÖã²÷fW&fÆ÷s¢†–FFVã²#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW""7G–ÆSÒ&&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃã#R“²&6¶G&÷Öf–ÇFW#¢&ÇW"ƒ#‚“²&÷&FW"Ö&÷GFöÓ¢‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÃã"“²#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"ÖÆVgB#àĞ¢ÂÒÒ™©‰xşy¨N‹ùNY¹îhÈ™*îûÈÎyJK¨îhê^zê[›nhºnhŠ®Xû>k¹h˜¾X«şûÈÎ™‹.jÚ.‹zşyK‹û~ZKy»Nhê^˜Y¹îjÎ™Ú"ÒÓàĞ¢Æ'WGFöâ6Æ73Ò'vV6†BÖ&6²Ö'Fâ"–CÒ&÷fW&Æ’Ö†–FFVâÖ&6²"7G–ÆSÒ&F—7Æ“¦æöæS²#ãÂö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×F—FÆR"7G–ÆSÒ&6öÆ÷#¢6ffc²FW‡B×6†F÷s¢‚'‚&v&ƒÃÃÃã"“²#àĞ¢Ç7â6Æ73Ò'vV6†BÖ†VFW"×F—FÆR×FW‡B#âG¶6öçF7BææÖWÒG¶—4w&÷W6ÆÂòsÇ7â7G–ÆSÒ&föçB×6—¦S£ƒ²Ö&v–âÖÆVgC£Gƒ²÷6—G“£ãƒƒ²#â{êNŠxnš)“Â÷7ãâr¢rwÓÇ7â6Æ73Ò'7FGW2ÖF÷BF÷BÖw&VVâ"–CÒ'f–FVòÖ6ÆÂ×7FGW2ÖF÷B#ãÂ÷7ããÂ÷7ãàĞ¢ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×&–v‡B#àĞ¢Ç7â–CÒ'f–FVò×F–ÖW""7G–ÆSÒ&föçB×6—¦S¢7ƒ²6öÆ÷#¢&v&ƒ#SRÃ#SRÃ#SRÃã’“²#ã£Â÷7ãàĞ¢ÂöF—càĞ¢ÂöF—càĞ Ğ¢ÆF—b6Æ73Ò'vV6†BÖ6öçFVçB"7G–ÆSÒ&&6¶w&÷VæC¢G&ç7&VçC²F—7Æ“¢fÆWƒ²fÆW‚ÖF—&V7F–öã¢6öÇVÖã²÷fW&fÆ÷s¢†–FFVã²FF–æs¢²#àĞ Ğ¢ÂÒÒšn˜:ûÉ®Šxnš)yK¾™Ú.XË®YùòÒÓàĞ¢ÆF—b7G–ÆSÒ&†V–v‡C¢Cƒ²&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃãR“²&6¶G&÷Öf–ÇFW#¢&ÇW"ƒ‚“²F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²§W7F–g’Ö6öçFVçC¢6VçFW#²÷6—F–öã¢&VÆF—fS²fÆW‚×6‡&–æ³¢²Ö&v–ã¢ƒ²&÷&FW"×&F—W3¢gƒ²#àĞ¢ÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¢6VçFW#²#àĞ¢ÆF—b6Æ73Ò&6ÆÂÖfF"Öf—‚"7G–ÆSÒ Ğ¢v–GFƒ¢sƒ°Ğ¢†V–v‡C¢sƒ°Ğ¢&÷&FW"×&F—W3¢SS°Ğ¢&6¶w&÷VæC¢Æ–æV"Öw&F–VçBƒ3VFVrÂ6ffbRÂ6cccR“°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢Æ–vâÖ—FV×3¢6VçFW#°Ğ¢§W7F–g’Ö6öçFVçC¢6VçFW#°Ğ¢föçB×6—¦S¢3Wƒ°Ğ¢Ö&v–ã¢WFò‡ƒ°Ğ¢&÷‚×6†F÷s¢G‚W‚&v&ƒÃÃÃãR“°Ğ¢÷fW&fÆ÷s¢†–FFVã°Ğ¢#àĞ¢G·F†—2æç&VæFW$fF"†6öçF7BæfF"Â	ùBrÂ6öçF7BææÖR—ĞĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢Gƒ²föçB×vV–v‡C¢S²6öÆ÷#¢6ffc²FW‡B×6†F÷s¢‚'‚&v&ƒÃÃÃã"“²#âG¶6öçF7BææÖWÓÂöF—càĞ¢G¶w&÷W'F–6—çG57G&—ĞĞ¢ÂöF—càĞ Ğ¢ÂÒÒ[şz©~Xú>ûÈˆz®[{ûÈ’ÒÓàĞ¢ÆF—b6Æ73Ò&6ÆÂÖfF"Öf—‚"7G–ÆSÒ Ğ¢÷6—F–öã¢'6öÇWFS°Ğ¢F÷¢‡ƒ°Ğ¢&–v‡C¢‡ƒ°Ğ¢v–GFƒ¢Sgƒ°Ğ¢†V–v‡C¢Sgƒ°Ğ¢&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃã’“°Ğ¢&÷&FW"×&F—W3¢SS°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢Æ–vâÖ—FV×3¢6VçFW#°Ğ¢§W7F–g’Ö6öçFVçC¢6VçFW#°Ğ¢föçB×6—¦S¢#Gƒ°Ğ¢&÷‚×6†F÷s¢'‚‚&v&ƒÃÃÃãR“°Ğ¢÷fW&fÆ÷s¢†–FFVã°Ğ¢#àĞ¢G·F†—2æç&VæFW$fF"‡F†—2æçvV6†DFFævWEW6W$–æfò‚’æfF"Â	ùˆ¢rÂF†—2æçvV6†DFFævWEW6W$–æfò‚’ææÖR—ĞĞ¢ÂöF—càĞ¢ÂöF—càĞ Ğ¢ÂÒÒKŠŞ™{NûÉ®ˆ®ZJkhhşXË®YùòÒÓàĞ¢ÆF—b–CÒ'f–FVòÖ6†BÖÖW76vW2"7G–ÆSÒ Ğ¢fÆWƒ¢°Ğ¢÷fW&fÆ÷r×“¢WFó°Ğ¢FF–æs¢‚'ƒ°Ğ¢&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃã#"“°Ğ¢Ö&v–ã¢ƒ°Ğ¢&÷&FW"×&F—W3¢'ƒ°Ğ¢&÷&FW#¢‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÃãB“°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢fÆW‚ÖF—&V7F–öã¢6öÇVÖã°Ğ¢v¢‡ƒ°Ğ¢Ö–âÖ†V–v‡C¢°Ğ¢6öçF–ã¢–çC°Ğ¢G&ç6f÷&Ó¢G&ç6ÆFU¢ƒ“°Ğ¢#àĞ¢ÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¢6VçFW#²6öÆ÷#¢&v&ƒ#SRÃ#SRÃ#SRÃãb“²föçB×6—¦S¢ƒ²FF–æs¢W‚²#àĞ¢Šxnš)˜	®ŠùŞKŠŞXúşXù˜ih~ZÙpĞ¢ÂöF—càĞ¢ÂöF—càĞ Ğ¢ÂÒÒ[©^˜:ûÉ®‹é>XZ^jnY(Îhê~X‹nhÈ™*âÒÓàĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃã#B“²FF–æs¢ƒ²fÆW‚×6‡&–æ³¢²Ö&v–â×F÷¢‡ƒ²&÷&FW"×F÷¢‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÃãb“²#àĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²v¢‡ƒ²Æ–vâÖ—FV×3¢6VçFW#²#àĞ¢Æ'WGFöâ–CÒ'f–FVòÖ†æwWÖ'Fâ"7G–ÆSÒ Ğ¢v–GFƒ¢3ƒ°Ğ¢†V–v‡C¢3ƒ°Ğ¢&÷&FW"×&F—W3¢SS°Ğ¢&6¶w&÷VæC¢&v&ƒ#SRÃS’ÃC‚ÃãB“°Ğ¢&÷&FW#¢‚6öÆ–B&v&ƒ#SRÃS’ÃC‚Ãã3R“°Ğ¢6öÆ÷#¢6fc6#3°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢fÆW‚×6‡&–æ³¢°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢Æ–vâÖ—FV×3¢6VçFW#°Ğ¢§W7F–g’Ö6öçFVçC¢6VçFW#°Ğ¢#àĞ¢Æ’6Æ73Ò&f×6öÆ–Bf×†öæR×6Æ6‚"7G–ÆSÒ&föçB×6—¦S¢7ƒ²#ãÂö“àĞ¢Âö'WGFöãàĞ¢Æ–çWBG—SÒ'FW‡B"–CÒ'f–FVòÖ6†BÖ–çWB"Æ6V†öÆFW#Ò.Xù˜khhòâââ"7G–ÆSÒ Ğ¢fÆWƒ¢°Ğ¢Ö–â×v–GFƒ¢°Ğ¢FF–æs¢‡‚‡‚‡‚'ƒ°Ğ¢&÷&FW#¢‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÃã#"“°Ğ¢&÷&FW"×&F—W3¢‡ƒ°Ğ¢&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃã"“°Ğ¢6öÆ÷#¢f"‚Ò×†öæRÖvÆö&Â×FW‡BÂ3“°Ğ¢föçB×6—¦S¢7ƒ°Ğ¢÷WFÆ–æS¢æöæS°Ğ¢×vV&¶—B×W6W"×6VÆV7C¢FW‡C°Ğ¢W6W"×6VÆV7C¢FW‡C°Ğ¢×vV&¶—B×F÷V6‚Ö6ÆÆ÷WC¢FVfVÇC°Ğ¢F÷V6‚Ö7F–öã¢WFó°Ğ¢#àĞ¢Æ'WGFöâ–CÒ'f–FVò×6VæBÖ'Fâ"7G–ÆSÒ Ğ¢v–GFƒ¢3ƒ°Ğ¢†V–v‡C¢3ƒ°Ğ¢&6¶w&÷VæC¢&v&ƒrÃ“2Ã“bÃãB“°Ğ¢6öÆ÷#¢3v3c°Ğ¢&÷&FW#¢‚6öÆ–B&v&ƒrÃ“2Ã“bÃã3R“°Ğ¢&÷&FW"×&F—W3¢SS°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢fÆW‚×6‡&–æ³¢°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢Æ–vâÖ—FV×3¢6VçFW#°Ğ¢§W7F–g’Ö6öçFVçC¢6VçFW#°Ğ¢#ãÇ7frv–GFƒÒ#B"†V–v‡CÒ#B"f–Wt&÷ƒÒ##B#B"f–ÆÃÒ&æöæR"7G&ö¶SÒ&7W'&VçD6öÆ÷""7G&ö¶R×v–GFƒÒ#"ã""7G&ö¶RÖÆ–æV6Ò'&÷VæB"7G&ö¶RÖÆ–æV¦ö–ãÒ'&÷VæB#ãÆÆ–æRƒÒ##""“Ò#""ƒ#Ò#"“#Ò#2"óãÇöÇ–vöâö–çG3Ò##""R#"2"’#"""óãÂ÷7fsãÂö'WGFöãàĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ Ğ¢Ç7G–ÆSàĞ¢æ6ÆÂÖfF"Öf—‚–Ör°Ğ¢v–GFƒ¢R–×÷'FçC°Ğ¢†V–v‡C¢R–×÷'FçC°Ğ¢Ö&v–ã¢–×÷'FçC°Ğ¢&÷&FW"×&F—W3¢SR–×÷'FçC°Ğ¢ĞĞ¢æ6ÆÂÖfF"Öf—‚F—b°Ğ¢&÷&FW"×&F—W3¢SR–×÷'FçC°Ğ¢ĞĞ¢7f–FVòÖ6†BÖ–çWB°Ğ¢&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃã"’–×÷'FçC°Ğ¢6öÆ÷#¢f"‚Ò×†öæRÖvÆö&Â×FW‡BÂ3’–×÷'FçC°Ğ¢×vV&¶—B×FW‡BÖf–ÆÂÖ6öÆ÷#¢f"‚Ò×†öæRÖvÆö&Â×FW‡BÂ3’–×÷'FçC°Ğ¢6&WBÖ6öÆ÷#¢f"‚Ò×†öæRÖvÆö&Â×FW‡BÂ3’–×÷'FçC°Ğ¢&÷&FW#¢‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÃã#"’–×÷'FçC°Ğ¢&÷‚×6†F÷s¢–ç6WB‚&v&ƒ#SRÃ#SRÃ#SRÃã"’–×÷'FçC°Ğ¢f–ÇFW#¢æöæR–×÷'FçC°Ğ¢÷6—G“¢–×÷'FçC°Ğ¢ĞĞ¢7f–FVòÖ6†BÖ–çWC£§Æ6V†öÆFW"°Ğ¢6öÆ÷#¢f"‚Ò×†öæRÖvÆö&Â×FW‡BÂ3’–×÷'FçC°Ğ¢×vV&¶—B×FW‡BÖf–ÆÂÖ6öÆ÷#¢f"‚Ò×†öæRÖvÆö&Â×FW‡BÂ3’–×÷'FçC°Ğ¢÷6—G“¢ãR–×÷'FçC°Ğ¢ĞĞ¢Â÷7G–ÆSàĞ¢°Ğ Ğ¢F†—2æç†öæU6†VÆÂç6WD6öçFVçB†‡FÖÂÂwvV6†BÖ6ÆÂÖ÷fW&Æ’r“°Ğ¢òòhºnhŠ®Xû>k¹‹ùNY¹îh˜¾X«şûÈÎ[nX[nzØYÎK¨îx+X{¾hÈ.ijÒşXùnkh‚şh¹.{¹ŞhÈ™*àĞ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v÷fW&Æ’Ö†–FFVâÖ&6²r“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7B6æ6VÄ'FâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6æ6VÂÖ6ÆÂÖ'Fâr’ÇÂ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVòÖ†æwWÖ'Fâr’ÇÂ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6RÖ†æwWÖ'Fâr’ÇÂ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v–æ6öÖ–ærÖ6ÆÂ×&V¦V7BÖ'Fâr“°Ğ¢–b†6æ6VÄ'Fâ’6æ6VÄ'Fâæ6Æ–6²‚“°Ğ¢VÇ6RF†—2æç&VæFW"‚“°Ğ¢Ò“°Ğ Ğ¢6öç7B6WEf–FVô6ÆÅ7FGW2Ò†6öÆ÷"Òvw&VVâr’Óâ°Ğ¢6öç7BF÷BÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVòÖ6ÆÂ×7FGW2ÖF÷Br“°Ğ¢–b‚F÷B’&WGW&ã°Ğ¢F÷Bæ6Æ74Æ—7Bç&VÖ÷fR‚vF÷BÖw&VVârÂvF÷B×–VÆÆ÷rrÂvF÷B×&VBr“°Ğ¢–b†6öÆ÷"ÓÓÒw&VBr’°Ğ¢F÷Bæ6Æ74Æ—7BæFB‚vF÷B×&VBr“°Ğ¢&WGW&ã°Ğ¢ĞĞ¢–b†6öÆ÷"ÓÓÒw–VÆÆ÷rr’°Ğ¢F÷Bæ6Æ74Æ—7BæFB‚vF÷B×–VÆÆ÷rr“°Ğ¢&WGW&ã°Ğ¢ĞĞ¢F÷Bæ6Æ74Æ—7BæFB‚vF÷BÖw&VVâr“°Ğ¢Ó°Ğ Ğ¢6öç7BvWEf–FVô–çWBÒ‚’ÓâFö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVòÖ6†BÖ–çWBr“°Ğ¢6öç7B†&FVåf–FVô–çWE7G–ÆRÒ‚’Óâ°Ğ¢6öç7B–çWBÒvWEf–FVô–çWB‚“°Ğ¢–b‚–çWCòç7G–ÆSòç6WE&÷W'G’’&WGW&ã°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚v&6¶w&÷VæBrÂw&v&ƒ#SRÃ#SRÃ#SRÃã"’rÂv–×÷'FçBr“°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚v6öÆ÷"rÂwf"‚Ò×†öæRÖvÆö&Â×FW‡BÂ3’rÂv–×÷'FçBr“°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚r×vV&¶—B×FW‡BÖf–ÆÂÖ6öÆ÷"rÂwf"‚Ò×†öæRÖvÆö&Â×FW‡BÂ3’rÂv–×÷'FçBr“°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚v6&WBÖ6öÆ÷"rÂwf"‚Ò×†öæRÖvÆö&Â×FW‡BÂ3’rÂv–×÷'FçBr“°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚v&÷&FW"rÂs‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÃã#"’rÂv–×÷'FçBr“°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚v&÷‚×6†F÷rrÂv–ç6WB‚&v&ƒ#SRÃ#SRÃ#SRÃã"’rÂv–×÷'FçBr“°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚vf–ÇFW"rÂvæöæRrÂv–×÷'FçBr“°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚v÷6—G’rÂsrÂv–×÷'FçBr“°Ğ¢Ó°Ğ¢†&FVåf–FVô–çWE7G–ÆR‚“°Ğ¢6öç7BvWEf–FVôÖW76vW2Ò‚’ÓâFö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVòÖ6†BÖÖW76vW2r“°Ğ Ğ¢ÆWBf–FVô&F6…F–ÖW"ÒçVÆÃ°Ğ¢ÆWBf–FVõVæF–æuW6W$Æ–æW2ÒµÓ°Ğ¢ÆWB—5f–FVõ6VæF–ærÒfÇ6S°Ğ Ğ¢6öç7B6ÆV%f–FVô&F6…F–ÖW"Ò‚’Óâ°Ğ¢6ÆV%F–ÖV÷WB‡f–FVô&F6…F–ÖW"“°Ğ¢f–FVô&F6…F–ÖW"ÒçVÆÃ°Ğ¢Ó°Ğ Ğ¢6öç7B&W7F'Ef–FVõVæF–æuF–ÖW$–dæVVFVBÒ‚’Óâ°Ğ¢–b†6ÆÄVæFVB’&WGW&ã°Ğ¢6öç7B–çWBÒvWEf–FVô–çWB‚“°Ğ¢6öç7BFW‡BÒ7G&–ær†–çWCòçfÇVRÇÂrr’çG&–Ò‚“°Ğ¢6öç7B—4VF—F–ærÒ–çWBbbFö7VÖVçBæ7F—fTVÆVÖVçBÓÓÒ–çWC°Ğ¢6öç7B6å&W7F'BÒ—4VF—F–ærbbFW‡BÓÓÒrrbbf–FVõVæF–æuW6W$Æ–æW2æÆVæwF‚âbb—5f–FVõ6VæF–æs°Ğ¢–b‚6å&W7F'B’°Ğ¢–b†—4VF—F–ærbb—5f–FVõ6VæF–ær’°Ğ¢6WEf–FVô6ÆÅ7FGW2‚vw&VVâr“°Ğ¢ĞĞ¢&WGW&ã°Ğ¢ĞĞ¢6ÆV%f–FVô&F6…F–ÖW"‚“°Ğ¢f–FVô&F6…F–ÖW"Ò6WEF–ÖV÷WB‚‚’Óâ°Ğ¢G&–vvW%f–FVô’‚“°Ğ¢ÒÂc“°Ğ¢6WEf–FVô6ÆÅ7FGW2‚w–VÆÆ÷rr“°Ğ¢Ó°Ğ Ğ¢6öç7BvWEf–FVô6ÆÅG—–ætFVÆ’Ò†Æ–æR’Óâ°Ğ¢6öç7BÆVæwF‚Ò7G&–ær†Æ–æRÇÂrr’çG&–Ò‚’æÆVæwFƒ°Ğ¢&WGW&âÖF‚æÖ–âƒ##ÂC#²ÆVæwF‚¢CR“°Ğ¢Ó°Ğ Ğ¢ÆWB6ÆÄVæFVBÒfÇ6S°Ğ¢6öç7B6ÆÄ6†D–BÒ6öçF7Bæ–C°Ğ¢6öç7B6ÆÄÖW76vW4VÆVÖVçBÒvWEf–FVôÖW76vW2‚“°Ğ¢6öç7Bf–æ—6„6ÆÂÒ†VæFVD'’’Óâ°Ğ¢–b†6ÆÄVæFVBÇÂ6ÆÄÖW76vW4VÆVÖVçCòæ—46öææV7FVB’&WGW&ã°Ğ¢6ÆÄVæFVBÒG'VS°Ğ¢F†—2ç7F÷vV6†D6ÆÅEE2‚“°Ğ¢6ÆV$–çFW'fÂ‡f–FVõF–ÖW"“°Ğ¢6ÆV%f–FVô&F6…F–ÖW"‚“°Ğ¢f–FVõVæF–æuW6W$Æ–æW2ÒµÓ°Ğ¢—5f–FVõ6VæF–ærÒfÇ6S°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVò×G—–ærÖ–æF–6F÷"r“òç&VÖ÷fR‚“°Ğ¢6†DÖW76vW2çW6‚‡°Ğ¢g&öÓ¢VæFVD'’ÓÓÒwW6W"ròvÖRr¢6öçF7BææÖRÀĞ¢FW‡C¢VæFVD'’ÓÓÒwW6W"rò~[{.hÈ.ijŞûÈyJh‹~K‹¾XªhÈ.ijŞûÈ’r¢~[{.hÈ.ijŞûÈŠy.ˆ›.K‹¾XªhÈ.ijŞûÈ’rÀĞ¢G—S¢v6ÆÅö†æwWrÂVæFVD'Ğ¢Ò“°Ğ¢6öç7BVffV7F—fTGW&F–öå6V2ÒÖF‚æÖ‚‡f–FVôGW&F–öâÂÖF‚æfÆö÷"‚„FFRææ÷r‚’Ò6ÆÅ7F'DWö6‚’ò’“°Ğ¢6öç7BGW&F–öåFW‡BÒG´ÖF‚æfÆö÷"†VffV7F—fTGW&F–öå6V2òc—ŞXˆbG¶VffV7F—fTGW&F–öå6V2RcŞzy&°Ğ¢F†—2æFD6ÆÅ&V6÷&B‚wf–FVòrÂvç7vW&VBrÂGW&F–öåFW‡BÂ°Ğ¢6†D–C¢6ÆÄ6†D–BÂ6ÆÅ7F'EF–ÖRÂVÆ6VE6V6öæG3¢VffV7F—fTGW&F–öå6V2ÀĞ¢VæFVD'’ÂG&ç67&—C¢6†DÖW76vW2æf–ÇFW"†ÒÓâÒæ—4FVÆWFVB’æÖ†ÒÓâ‡²ââæÒÒ’Ğ¢Ò“°Ğ¢6ÆÄÖW76vW4VÆVÖVçBæ–ç6W'DF¦6VçD…DÔÂ‚v&Vf÷&VVæBrÂsÆF—b6Æ73Ò'vV6†BÖ6ÆÂÖVæFVB"7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW#²6öÆ÷#¢3ƒƒƒ²föçB×6—¦S£'ƒ²FF–æs£‚²fÆW‚×6‡&–æ³£²#î[{.hÈ.ijÓÂöF—câr“°Ğ¢6ÆÄÖW76vW4VÆVÖVçBç67&öÆÅF÷Ò6ÆÄÖW76vW4VÆVÖVçBç67&öÆÄ†V–v‡C°Ğ¢6öç7B–çWBÒvWEf–FVô–çWB‚“°Ğ¢–b†–çWB’²–çWBæF—6&ÆVBÒG'VS²–çWBçÆ6V†öÆFW"Ò~˜	®ŠùŞ[{.{¹>iÙòs²ĞĞ¢6öç7B6VæD'WGFöâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVò×6VæBÖ'Fâr“°Ğ¢–b‡6VæD'WGFöâ’6VæD'WGFöâæF—6&ÆVBÒG'VS°Ğ¢6WEf–FVô6ÆÅ7FGW2‚w&VBr“°Ğ¢6öç7B†æwW'WGFöâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVòÖ†æwWÖ'Fâr“°Ğ¢–b††æwW'WGFöâ’²†æwW'WGFöâçF—FÆRÒ~‹ùNY¹îˆ®ZJ’s²†æwW'WGFöâç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂ~‹ùNY¹îˆ®ZJ’r“²ĞĞ¢Ó°Ğ Ğ¢6öç7B&VæFW%f–FVô”Æ–æW56WVVçF–ÆÇ’Ò7–æ2†Æ–æW2Â&÷VæD–B’Óâ°Ğ¢6öç7B'V&&ÆTÖWF2ÒµÓ°Ğ¢6öç7B&VæFW$Æ–æW2Ò'&’æ—4'&’†Æ–æW2’òÆ–æW2¢µÓ°Ğ Ğ¢f÷"†ÆWB’Ò²’Â&VæFW$Æ–æW2æÆVæwFƒ²’²²’°Ğ¢6öç7BÖW76vW4F—bÒvWEf–FVôÖW76vW2‚“°Ğ¢–b‚ÖW76vW4F—b’'&V³°Ğ Ğ¢6öç7BVçG'’ÒG—Vöb&VæFW$Æ–æW5¶•ÒÓÓÒw7G&–ærpĞ¢ò²6VæFW#¢6öçF7BææÖRÂFW‡C¢7G&–ær‡&VæFW$Æ–æW5¶•ÒÇÂrr’çG&–Ò‚’ĞĞ¢¢°Ğ¢6VæFW#¢7G&–ær‡&VæFW$Æ–æW5¶•Óòç6VæFW"ÇÂ6öçF7BææÖR’çG&–Ò‚’ÇÂ6öçF7BææÖRÀĞ¢FW‡C¢7G&–ær‡&VæFW$Æ–æW5¶•ÓòçFW‡BÇÂrr’çG&–Ò‚Ğ¢Ó°Ğ¢–b†6ÆÄVæFVBÇÂ6ÆÄÖW76vW4VÆVÖVçCòæ—46öææV7FVB’'&V³°Ğ¢–b‚VçG'’çFW‡B’6öçF–çVS°Ğ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVò×G—–ærÖ–æF–6F÷"r“òç&VÖ÷fR‚“°Ğ¢6öç7BG—–æt‡FÖÂÒ Ğ¢ÆF—b–CÒ'f–FVò×G—–ærÖ–æF–6F÷""7G–ÆSÒ&F—7Æ“¢fÆWƒ²§W7F–g’Ö6öçFVçC¢fÆW‚×7F'C²#àĞ¢ÆF—b7G–ÆSÒ'FF–æs¢‡‚'ƒ²&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃãR“²6öÆ÷#¢&v&ƒÃÃÃãR“²&÷&FW"×&F—W3¢'ƒ²föçB×6—¦S¢'ƒ²#îZûikjÚ>YÊŠûNŠùÒââãÂöF—càĞ¢ÂöF—càĞ¢°Ğ¢ÖW76vW4F—bæ–ç6W'DF¦6VçD…DÔÂ‚v&Vf÷&VVæBrÂG—–æt‡FÖÂ“°Ğ¢ÖW76vW4F—bç67&öÆÅF÷ÒÖW76vW4F—bç67&öÆÄ†V–v‡C°Ğ Ğ¢v—BæWr&öÖ—6R‡&W6öÇfRÓâ6WEF–ÖV÷WB‡&W6öÇfRÂvWEf–FVô6ÆÅG—–ætFVÆ’†VçG'’çFW‡B’’“°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVò×G—–ærÖ–æF–6F÷"r“òç&VÖ÷fR‚“°Ğ¢–b†6ÆÄVæFVBÇÂ6ÆÄÖW76vW4VÆVÖVçCòæ—46öææV7FVB’'&V³°Ğ Ğ¢6öç7B'V&&ÆT–BÒwvV6†BÖ6ÆÂÖ’Ö×6rÒr²ÖF‚ç&æFöÒ‚’çFõ7G&–ærƒ3b’ç6Æ–6Rƒ"Â‚“°Ğ¢6öç7B6VæFW$Æ&VÄ‡FÖÂÒ—4w&÷W6ÆÀĞ¢òÆF—b6Æ73Ò&6ÆÂÖ×6r×6VæFW"ÖÆ&VÂ"7G–ÆSÒ&föçB×6—¦S£ƒ²6öÆ÷#§&v&ƒ#SRÃ#SRÃ#SRÃãƒb“²Ö&v–ã£G‚'ƒ²#âG·F†—2åöW66T‡FÖÂ†VçG'’ç6VæFW"—ÓÂöF—cæ Ğ¢¢rs°Ğ¢6öç7B”×6t‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò&6ÆÂÖ×6r×&÷r"7G–ÆSÒ&F—7Æ“¢fÆWƒ²§W7F–g’Ö6öçFVçC¢fÆW‚×7F'C²#àĞ¢ÆF—b7G–ÆSÒ&Ö‚×v–GFƒ¢sRS²F—7Æ“¦fÆWƒ²fÆW‚ÖF—&V7F–öã¦6öÇVÖã²Æ–vâÖ—FV×3¦fÆW‚×7F'C²#àĞ¢G·6VæFW$Æ&VÄ‡FÖÇĞĞ¢G·F†—2å÷&VæFW%vV6†D6ÆÄ”'V&&ÆTÖ&·W‡°Ğ¢FW‡C¢VçG'’çFW‡BÀĞ¢'V&&ÆT–BÀĞ¢ÖW76vT–æFWƒ¢6†DÖW76vW2æÆVæwF‚ÀĞ¢6ÆÅG—S¢wf–FVòrÀĞ¢&÷VæD–BÀĞ¢6VæFW#¢VçG'’ç6VæFW Ğ¢Ò—ĞĞ¢ÂöF—càĞ¢ÂöF—càĞ¢°Ğ¢ÖW76vW4F—bæ–ç6W'DF¦6VçD…DÔÂ‚v&Vf÷&VVæBrÂ”×6t‡FÖÂ“°Ğ¢6†DÖW76vW2çW6‚‡²g&öÓ¢VçG'’ç6VæFW"ÂFW‡C¢VçG'’çFW‡BÒ“°Ğ¢'V&&ÆTÖWF2çW6‚‡²–C¢'V&&ÆT–BÂ6VæFW#¢VçG'’ç6VæFW"ÂFW‡C¢VçG'’çFW‡BÒ“°Ğ¢ÖW76vW4F—bç67&öÆÅF÷ÒÖW76vW4F—bç67&öÆÄ†V–v‡C°Ğ¢ĞĞ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVò×G—–ærÖ–æF–6F÷"r“òç&VÖ÷fR‚“°Ğ¢&WGW&â'V&&ÆTÖWF3°Ğ¢Ó°Ğ Ğ¢òòˆ®ZJkhhşŠë[ÙPĞ¢6öç7B6†DÖW76vW2ÒµÓ°Ğ¢òò	ùJRkøkK¾Šxnš)˜	®ŠùŞy¨N™[şhÈˆùÎXÙPĞ¢6öç7Bf–FVô6ÆÄÖW76vW2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVòÖ6†BÖÖW76vW2r“°Ğ¢F†—2æ&–æD6ÆÄÖW76vTÆöæu&W74WfVçG2‡f–FVô6ÆÄÖW76vW2Â6†DÖW76vW2“°Ğ¢F†—2æ&–æD–ææW%F†÷Vv‡DWfVçG2‡f–FVô6ÆÄÖW76vW2“°Ğ Ğ¢òò	ùJRK‹¾XªXùzÊÎKˆXú^ŠùŞûÈiJşhÈZI®iÚkhhşûÈĞ¢–b†”f—'7DÖW76vRbb”f—'7DÖW76vRçG&–Ò‚’’°Ğ¢6öç7BÖW76vW4F—bÒvWEf–FVôÖW76vW2‚“°Ğ¢–b†ÖW76vW4F—b’°Ğ¢òòkˆ^ynjÎ[ÈğĞ¢ÆWB6ÆVæVDw&VWF–ærÒ”f—'7DÖW76vRçG&–Ò‚“°Ğ¢6ÆVæVDw&VWF–ærÒ6ÆVæVDw&VWF–ærç&WÆ6R‚õÅ¾[êîKúÅÕµã®ûÉ¥Ò¥¾ûÉ£¥ÕÇ2¢örÂrr“²òòz{¾™šB¾[êîKúÒ‡‡ƒ¢jÎ[ÈğĞ¢6ÆVæVDw&VWF–ærÒ6ÆVæVDw&VWF–ærç&WÆ6R‚õæg&öÕÇ2µÅ2µ¾ûÉ£¥ÕÇ2¢övÖ’Ârr“²òòz{¾™šBg&öÒ‡‡ƒ¢jÎ[ÈğĞ Ğ¢6öç7Bw&VWF–æt†æwWÒ'6T6ÆÄ†æwW&WÇ’†6ÆVæVDw&VWF–ær“°Ğ¢6öç7B×6tÆ–æW2ÒF†—2å÷'6T6ÆÅ&WÇ”VçG&–W2†w&VWF–æt†æwWçFW‡BÂ°Ğ¢6öçF7DæÖS¢6öçF7BææÖRÀĞ¢'F–6—çG3¢—4w&÷W6ÆÂòw&÷W'F–6—çG2¢µÒÀĞ¢w&÷WæÖS¢6öçF7BææÖRÀĞ¢—4w&÷W6ÆÀĞ¢Ò“°Ğ¢6öç7B&÷VæD–BÒw&÷VæEöw&VWF–æuòr²FFRææ÷r‚“°Ğ¢†7–æ2‚’Óâ°Ğ¢6öç7B'V&&ÆTÖWF2Òv—B&VæFW%f–FVô”Æ–æW56WVVçF–ÆÇ’†×6tÆ–æW2Â&÷VæD–B“°Ğ¢–b†6ÆÄVæFVBÇÂ6ÆÄÖW76vW4VÆVÖVçCòæ—46öææV7FVB’&WGW&ã°Ğ¢F†—2æ&–æD6ÆÄ'V&&ÆT6Æ–6´WfVçG2†ÖW76vW4F—b“°Ğ¢6öç7BWFõEE2Òv–æF÷råf—'GVÅ†öæSòç7F÷&vSòævWB‚wvV6†BÖ6ÆÂÖWFò×GG2r“°Ğ¢F†—2æ7W'&VçEGG5&÷VæBÒ&÷VæD–C°Ğ¢–b†WFõEE2’°Ğ¢f÷"†ÆWB’Ò²’Â'V&&ÆTÖWF2æÆVæwFƒ²’²²’°Ğ¢–b‡F†—2æ7W'&VçEGG5&÷VæBÓÒ&÷VæD–B’'&V³°Ğ¢6öç7B'V&&ÆRÒFö7VÖVçBævWDVÆVÖVçD'”–B†'V&&ÆTÖWF5¶•Òæ–B“°Ğ¢6öç7BGG5FW‡BÒF†—2å÷&W6öÇfT6ÆÅEE46öçFVçB†'V&&ÆTÖWF5¶•ÒçFW‡BÂwf–FVòr“°Ğ¢–b‚GG5FW‡B’6öçF–çVS°Ğ¢v—BF†—2çÆ•vV6†D6ÆÅEE2‡GG5FW‡BÂ'V&&ÆR“°Ğ¢ĞĞ¢ĞĞ¢–b†w&VWF–æt†æwWæVæFVB’f–æ—6„6ÆÂ‚v6†&7FW"r“°Ğ¢Ò’‚“°Ğ¢ĞĞ¢ĞĞ Ğ¢òòŠêi{nYš€Ğ¢ÆWBf–FVôGW&F–öâÒ°Ğ¢6öç7Bf–FVõF–ÖW"Ò7F'D6ÆÅF–ÖW"†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVò×F–ÖW"r’Â6V6öæG2Óâ°Ğ¢f–FVôGW&F–öâÒ6V6öæG3°Ğ¢Ò“°Ğ¢F†—2å÷vV6†D6ÆÅF–ÖW"Òf–FVõF–ÖW#°Ğ Ğ¢6öç7BG&–vvW%f–FVô’Ò7–æ2‚’Óâ°Ğ¢–b†6ÆÄVæFVBÇÂ6ÆÄÖW76vW4VÆVÖVçCòæ—46öææV7FVBÇÂ—5f–FVõ6VæF–ærÇÂf–FVõVæF–æuW6W$Æ–æW2æÆVæwF‚ÓÓÒ’&WGW&ã°Ğ Ğ¢–b‚F†—2æ—4öæÆ–æTÖöFR‚’’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~zk¾{«şjŠ[ÈòrÂ~Šû~YÊŠëî{ÚîKŠŞ[ÈY
şYÊ{«şjŠ[ÈòrÂ~)ªûˆòr“°Ğ¢6ÆV%f–FVô&F6…F–ÖW"‚“°Ğ¢6WEf–FVô6ÆÅ7FGW2‚vw&VVâr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6öç7BÖW76vW4F—bÒvWEf–FVôÖW76vW2‚“°Ğ¢–b‚ÖW76vW4F—b’&WGW&ã°Ğ Ğ¢—5f–FVõ6VæF–ærÒG'VS°Ğ¢6ÆV%f–FVô&F6…F–ÖW"‚“°Ğ¢6WEf–FVô6ÆÅ7FGW2‚w&VBr“°Ğ Ğ¢6öç7BÖW76vUFõ6VæBÒf–FVõVæF–æuW6W$Æ–æW2æ¦ö–â‚uÆâr“°Ğ¢f–FVõVæF–æuW6W$Æ–æW2ÒµÓ°Ğ Ğ¢G'’°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVò×G—–ærÖ–æF–6F÷"r“òç&VÖ÷fR‚“°Ğ¢6öç7BG—–æt‡FÖÂÒ Ğ¢ÆF—b–CÒ'f–FVò×G—–ærÖ–æF–6F÷""7G–ÆSÒ&F—7Æ“¢fÆWƒ²§W7F–g’Ö6öçFVçC¢fÆW‚×7F'C²#àĞ¢ÆF—b7G–ÆSÒ'FF–æs¢‡‚'ƒ²&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃãR“²6öÆ÷#¢&v&ƒÃÃÃãR“²&÷&FW"×&F—W3¢'ƒ²föçB×6—¦S¢'ƒ²#îZûikjÚ>YÊŠûNŠùÒââãÂöF—càĞ¢ÂöF—càĞ¢°Ğ¢ÖW76vW4F—bæ–ç6W'DF¦6VçD…DÔÂ‚v&Vf÷&VVæBrÂG—–æt‡FÖÂ“°Ğ¢ÖW76vW4F—bç67&öÆÅF÷ÒÖW76vW4F—bç67&öÆÄ†V–v‡C°Ğ Ğ¢6öç7B•&WÇ’Òv—BF†—2ç6VæD6ÆÄÖW76vUFô’†ÖW76vUFõ6VæBÂ6öçF7BææÖRÂ6†DÖW76vW2Âwf–FVòr“°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVò×G—–ærÖ–æF–6F÷"r“òç&VÖ÷fR‚“°Ğ Ğ¢–b†6ÆÄVæFVBÇÂ6ÆÄÖW76vW4VÆVÖVçCòæ—46öææV7FVB’&WGW&ã°Ğ¢6öç7B†æwW&WÇ’Ò'6T6ÆÄ†æwW&WÇ’†•&WÇ’“°Ğ¢6öç7B&÷VæD–BÒw&÷VæEòr²FFRææ÷r‚“°Ğ¢6öç7B”VçG&–W2ÒF†—2å÷'6T6ÆÅ&WÇ”VçG&–W2††æwW&WÇ’çFW‡BÂ°Ğ¢6öçF7DæÖS¢6öçF7BææÖRÀĞ¢'F–6—çG3¢—4w&÷W6ÆÂòw&÷W'F–6—çG2¢µÒÀĞ¢w&÷WæÖS¢6öçF7BææÖRÀĞ¢—4w&÷W6ÆÀĞ¢Ò“°Ğ¢6öç7B&VæFW$Æ–æW2Ò”VçG&–W2æÆVæwF‚âò”VçG&–W2¢††æwW&WÇ’æVæFVBòµÒ¢·²6VæFW#¢6öçF7BææÖRÂFW‡C¢rââârÕÒ“°Ğ¢6öç7B'V&&ÆTÖWF2Òv—B&VæFW%f–FVô”Æ–æW56WVVçF–ÆÇ’‡&VæFW$Æ–æW2Â&÷VæD–B“°Ğ¢–b†6ÆÄVæFVBÇÂ6ÆÄÖW76vW4VÆVÖVçCòæ—46öææV7FVB’&WGW&ã°Ğ Ğ¢F†—2æ&–æD6ÆÄ'V&&ÆT6Æ–6´WfVçG2†ÖW76vW4F—b“°Ğ¢6öç7BWFõEE2Òv–æF÷råf—'GVÅ†öæSòç7F÷&vSòævWB‚wvV6†BÖ6ÆÂÖWFò×GG2r“°Ğ¢F†—2æ7W'&VçEGG5&÷VæBÒ&÷VæD–C°Ğ¢–b†WFõEE2’°Ğ¢f÷"†ÆWB’Ò²’Â'V&&ÆTÖWF2æÆVæwFƒ²’²²’°Ğ¢–b‡F†—2æ7W'&VçEGG5&÷VæBÓÒ&÷VæD–B’'&V³°Ğ¢6öç7B'V&&ÆRÒFö7VÖVçBævWDVÆVÖVçD'”–B†'V&&ÆTÖWF5¶•Òæ–B“°Ğ¢6öç7BGG5FW‡BÒF†—2å÷&W6öÇfT6ÆÅEE46öçFVçB†'V&&ÆTÖWF5¶•ÒçFW‡BÂwf–FVòr“°Ğ¢–b‚GG5FW‡B’6öçF–çVS°Ğ¢v—BF†—2çÆ•vV6†D6ÆÅEE2‡GG5FW‡BÂ'V&&ÆR“°Ğ¢ĞĞ¢ĞĞ¢–b††æwW&WÇ’æVæFVB’f–æ—6„6ÆÂ‚v6†&7FW"r“°Ğ¢Ò6F6‚†W'&÷"’°Ğ¢6öç6öÆRæW'&÷"‚~)ØÂŠxnš)˜	®ŠùŞkhhşXù˜ZK‹JS¢rÂW'&÷"“°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVò×G—–ærÖ–æF–6F÷"r“òç&VÖ÷fR‚“°Ğ¢Òf–æÆÇ’°Ğ¢—5f–FVõ6VæF–ærÒfÇ6S°Ğ¢–b‡f–FVõVæF–æuW6W$Æ–æW2æÆVæwF‚â’°Ğ¢&W7F'Ef–FVõVæF–æuF–ÖW$–dæVVFVB‚“°Ğ¢ÒVÇ6R–b‚6ÆÄVæFVB’°Ğ¢6WEf–FVô6ÆÅ7FGW2‚vw&VVâr“°Ğ¢ĞĞ¢ĞĞ¢Ó°Ğ Ğ¢òòXù˜khhşûÈZHŞX‹¾[êîKúˆ®ZJy¨N(	Î‹ùîXùzØ[è^(	Ş˜¾‹éûÈĞ¢6öç7B6VæDÖW76vRÒ7–æ2‚’Óâ°Ğ¢–b†6ÆÄVæFVBÇÂ6ÆÄÖW76vW4VÆVÖVçCòæ—46öææV7FVB’&WGW&ã°Ğ¢F†—2ç7F÷vV6†D6ÆÅEE2‚“²òòXùikkhhşi{nh™>ijŞiz~ŠúŞ™û0Ğ¢6öç7B–çWBÒvWEf–FVô–çWB‚“°Ğ¢6öç7BÖW76vW4F—bÒvWEf–FVôÖW76vW2‚“°Ğ¢–b‚–çWBÇÂÖW76vW4F—b’&WGW&ã°Ğ Ğ¢6öç7BFW‡BÒ–çWBçfÇVRçG&–Ò‚“°Ğ¢–b‡FW‡B’°Ğ¢6öç7B×”×6t‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò&6ÆÂÖ×6r×&÷r"7G–ÆSÒ&F—7Æ“¢fÆWƒ²§W7F–g’Ö6öçFVçC¢fÆW‚ÖVæC²#àĞ¢ÆF—b6Æ73Ò&6ÆÂÖ×6rÖ'V&&ÆR"FFÖ×6rÖ–GƒÒ"G¶6†DÖW76vW2æÆVæwF‡Ò"7G–ÆSÒ&Ö‚×v–GFƒ¢sRS²FF–æs¢‡‚'ƒ²&6¶w&÷VæC¢3“VV3c“²6öÆ÷#¢3²&÷&FW"×&F—W3¢'ƒ²föçB×6—¦S¢7ƒ²÷6—F–öã¢&VÆF—fS²#âG·FW‡GÓÂöF—càĞ¢ÂöF—càĞ¢°Ğ¢ÖW76vW4F—bæ–ç6W'DF¦6VçD…DÔÂ‚v&Vf÷&VVæBrÂ×”×6t‡FÖÂ“°Ğ¢ÖW76vW4F—bç67&öÆÅF÷ÒÖW76vW4F—bç67&öÆÄ†V–v‡C°Ğ Ğ¢6†DÖW76vW2çW6‚‡²g&öÓ¢vÖRrÂFW‡C¢FW‡BÒ“°Ğ¢f–FVõVæF–æuW6W$Æ–æW2çW6‚‡FW‡B“°Ğ¢–çWBçfÇVRÒrs°Ğ Ğ¢–b†Fö7VÖVçBæ7F—fTVÆVÖVçBÓÓÒ–çWB’°Ğ¢òò‹é>XZ^jniÈz¹n{«şûÈK¸ŞYÊ{Én‹éûÈi{nûÈÎXú®zØ[è^ûÈÎKˆŞz¸¾X‹¾ŠznXùĞ¢6ÆV%f–FVô&F6…F–ÖW"‚“°Ğ¢6WEf–FVô6ÆÅ7FGW2‚vw&VVâr“°Ğ¢ÒVÇ6R°Ğ¢&W7F'Ef–FVõVæF–æuF–ÖW$–dæVVFVB‚“°Ğ¢ĞĞ¢&WGW&ã°Ğ¢ĞĞ Ğ¢–b‡f–FVõVæF–æuW6W$Æ–æW2æÆVæwF‚â’°Ğ¢v—BG&–vvW%f–FVô’‚“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6öç7B&V6VçEW6W$Æ–æW2Ò6†DÖW76vW0Ğ¢æf–ÇFW"†ÒÓâÒæg&öÒÓÓÒvÖRrĞ¢ç6Æ–6R‚ÓRĞ¢æÖ†ÒÓâÒçFW‡BĞ¢æf–ÇFW"„&ööÆVâ“°Ğ¢–b‡&V6VçEW6W$Æ–æW2æÆVæwF‚â’°Ğ¢f–FVõVæF–æuW6W$Æ–æW2Ò&V6VçEW6W$Æ–æW3°Ğ¢v—BG&–vvW%f–FVô’‚“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~Šû~XX‹é>XZ^Xh^Zë’rÂ~)ªûˆòr“°Ğ¢Ó°Ğ Ğ¢6öç7Bf–FVô–çWBÒvWEf–FVô–çWB‚“°Ğ¢6öç7Bf–FVõ6VæD'FâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVò×6VæBÖ'Fâr“°Ğ Ğ¢f–FVô–çWCòæFDWfVçDÆ—7FVæW"‚vfö7W2rÂ‚’Óâ°Ğ¢6ÆV%f–FVô&F6…F–ÖW"‚“°Ğ¢6WEf–FVô6ÆÅ7FGW2‚vw&VVâr“°Ğ¢Ò“°Ğ Ğ¢f–FVô–çWCòæFDWfVçDÆ—7FVæW"‚v&ÇW"rÂ‚’Óâ°Ğ¢&W7F'Ef–FVõVæF–æuF–ÖW$–dæVVFVB‚“°Ğ¢Ò“°Ğ Ğ¢f–FVô–çWCòæFDWfVçDÆ—7FVæW"‚v–çWBrÂ†R’Óâ°Ğ¢6öç7BFW‡BÒ7G&–ær†RçF&vWBçfÇVRÇÂrr’çG&–Ò‚“°Ğ¢–b‡FW‡BÓÒrr’°Ğ¢6ÆV%f–FVô&F6…F–ÖW"‚“°Ğ¢6WEf–FVô6ÆÅ7FGW2‚vw&VVâr“°Ğ¢&WGW&ã°Ğ¢ĞĞ¢–b†Fö7VÖVçBæ7F—fTVÆVÖVçBÓÓÒRçF&vWB’°Ğ¢&WGW&ã°Ğ¢ĞĞ¢&W7F'Ef–FVõVæF–æuF–ÖW$–dæVVFVB‚“°Ğ¢Ò“°Ğ Ğ¢ÆWB—4†æFÆ–æuf–FVõ6VæBÒfÇ6S°Ğ¢6öç7BW†V7WFUf–FVõ6VæBÒ†R’Óâ°Ğ¢–b†R’Rç&WfVçDFVfVÇB‚“°Ğ¢–b†—4†æFÆ–æuf–FVõ6VæB’&WGW&ã°Ğ¢—4†æFÆ–æuf–FVõ6VæBÒG'VS°Ğ¢6VæDÖW76vR‚“°Ğ¢6WEF–ÖV÷WB‚‚’Óâ°Ğ¢—4†æFÆ–æuf–FVõ6VæBÒfÇ6S°Ğ¢ÒÂ3“°Ğ¢Ó°Ğ Ğ¢f–FVõ6VæD'FãòæFDWfVçDÆ—7FVæW"‚wF÷V6‡7F'BrÂ†R’Óâ°Ğ¢Rç&WfVçDFVfVÇB‚“°Ğ¢ÒÂ²76—fS¢fÇ6RÒ“°Ğ¢f–FVõ6VæD'FãòæFDWfVçDÆ—7FVæW"‚wF÷V6†VæBrÂW†V7WFUf–FVõ6VæB“°Ğ¢f–FVõ6VæD'FãòæFDWfVçDÆ—7FVæW"‚vÖ÷W6VF÷vârÂ†R’Óâ°Ğ¢Rç&WfVçDFVfVÇB‚“°Ğ¢Ò“°Ğ¢f–FVõ6VæD'FãòæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂW†V7WFUf–FVõ6VæB“°Ğ¢f–FVô–çWCòæFDWfVçDÆ—7FVæW"‚v¶W—&W72rÂ†R’Óâ°Ğ¢–b†Ræ¶W’ÓÓÒtVçFW"rbbRç6†–gD¶W’’°Ğ¢Rç&WfVçDFVfVÇB‚“°Ğ¢6VæDÖW76vR‚“°Ğ¢ĞĞ¢Ò“°Ğ Ğ¢òòhÈ.ijĞĞ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVòÖ†æwWÖ'Fâr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢–b†6ÆÄVæFVB’F†—2æç&VæFW"‚“°Ğ¢VÇ6Rf–æ—6„6ÆÂ‚wW6W"r“°Ğ¢Ò“°Ğ¢ĞĞ Ğ¢òò	ùJRikZ)îûÉ®Y	Šú.™zîiŠşY
nhê^Y
ÀĞ¢7–æ26´”f÷$6ÆÄFV6—6–öâ†6ÆÅG—RÂ6öçF7DæÖR’°Ğ¢G'’°Ğ¢6öç7B6öçFW‡BÒv–æF÷rå6–ÆÇ•FfW&ãòævWD6öçFW‡Còâ‚“°Ğ¢–b‚6öçFW‡B’°Ğ¢F‡&÷ræWrW'&÷"‚~izk9^ˆë~Xùe6–ÆÇ•FfW&îKˆ®Kˆ¾ih~ûÈÎ˜	®ŠùŞ‹ùîhê^ZK‹JRr“°Ğ¢ĞĞ Ğ¢6öç7B6ÆÅG—TæÖRÒ6ÆÅG—RÓÓÒwf–FVòrò~Šxnš)˜	®ŠùÒr¢~ŠúŞ™û>˜	®ŠùÒs°Ğ¢6öç7BF&vWD6†BÒF†—2ææ7W'&VçD6†C°Ğ¢6öç7B—4w&÷W6ÆÂÒF&vWD6†CòçG—RÓÓÒvw&÷Ws°Ğ¢6öç7Bw&÷W'F–6—çG2ÒF†—2åövWDw&÷W6†E'F–6—çG2‡F&vWD6†B“°Ğ Ğ¢6öç7B&ö×BÒ—4w&÷W6ÆÀĞ¢ò8	Xš~h8^K¨¾K»n8	G¶6öçFW‡BææÖSÇÂ~yJh‹rwŞY	[êîKú{êB"G¶6öçF7DæÖWÒ.Xù‹[~K¨bG¶6ÆÅG—TæÖWŞŠû~k.8 Ğ Ğ®[Ù>X˜ŞXúşhê^Y
Îh‰Yy›ŞYŞXÙ^ûÉ Ğ¢G¶w&÷W'F–6—çG2æ¦ö–â‚~8r’ÇÂ~i¨.izh‰Y‚wĞĞ Ğ®KÚ™ÈŠhjhÚî[Ù>X˜ŞXš~h8^Y(Î{êNh‰Yx«nhûÈÎXk>Zé®iŠşY
niÈK«®hê^Y
Î8 Ğ Ğ®Zh.iéÎhê^Y
ÎûÈÎŠû~yJƒÇvV6†Cîj~zÛîY¹îZHŞ8.XXŠëƒÓNK«®XùŠˆûÈÎK‰NjøşKˆXú^[ø^š¾KÛşyJ(	ÎXù˜ˆS¢Xh^Zë(	ŞjÎ[ÈşûÉ Ğ£ÇvV6†CàĞ®hê^Y
ÀĞ®[ÊKˆ“¢zÊÎKˆKØŞh‰Yy¨N[ÈYË®y›ĞĞ®iØîY¹³¢zÊÎK¨ÎKØŞh‰Yy¨N[ÈYË®y›ĞĞ£Â÷vV6†CàĞ Ğ®Zh.iéÎh¹.{¹Şh‰nizK«®hê^Y
ÎûÈÎŠû~Y¹îZHŞûÉ Ğ£ÇvV6†CàĞ®h¹.{¹ĞĞ£Â÷vV6†CæçG&–Ò‚Ğ¢¢8	Xš~h8^K¨¾K»n8	G¶6öçFW‡BææÖSÇÂ~yJh‹rwŞY	KÚXù‹[~K¨bG¶6ÆÅG—TæÖWŞŠû~k.8 Ğ Ğ®KÚxëYÊhšîkÉBG¶6öçF7DæÖWŞûÈÎŠû~jhÚî[Ù>X˜ŞXš~h8^Y(ÎŠy.ˆ›.h
~jÎXk>Zé®iŠşY
nhê^Y
Î8 Ğ Ğ®Zh.iéÎhê^Y
ÎûÈÎŠû~yJƒÇvV6†Cîj~zÛîY¹îZHŞKÚy¨NzÊÎKˆXú^ŠùŞûÉ Ğ£ÇvV6†CàĞ®hê^Y
ÀĞ®KÚy¨NzÊÎKˆXú^ŠùŞûÈXúşKº^ZI®ŠÎûÈĞ£Â÷vV6†CàĞ Ğ®Zh.iéÎh¹.{¹ŞûÈÎŠû~Y¹îZHŞûÉ Ğ£ÇvV6†CàĞ®h¹.{¹ĞĞ£Â÷vV6†CæçG&–Ò‚“°Ğ Ğ¢òò	ùJRKÊ˜	"6ÆÅG—RKÙÎK‹¢6ÆÄÖöF^ûÈÎ˜şXXŞXª‹ÛŞ[êîKúˆ®ZJhùzK®ŠøĞĞ¢6öç7B•&W7öç6RÒv—BF†—2ç6VæEFô”†–FFVâ‡&ö×BÂ6öçFW‡BÂ6ÆÅG—R“°Ğ Ğ¢òò	ùJRŠz>iéÇvV6†Câj~zÛîjÎ[ÈğĞ¢6öç7B6öçFVçBÒF†—2åöW‡G&7EvV6†EFu–ÆöD÷%6VÆb†•&W7öç6R“°Ğ¢–b†6öçFVçB’°Ğ¢6öç7BÆ–æW2Ò6öçFVçBç7Æ—B‚uÆâr’æÖ†ÂÓâÂçG&–Ò‚’’æf–ÇFW"†ÂÓâÂ“°Ğ Ğ¢–b†Æ–æW2æÆVæwF‚â’°Ğ¢6öç7Bf—'7DÆ–æRÒÆ–æW5³Ó°Ğ Ğ¢òòXŠNijŞiŠşh¹.{¹Ş‹ùiŠşhê^Y
ÀĞ¢–b†f—'7DÆ–æRæ–æ6ÇVFW2‚~h¹.{¹Òr’ÇÂf—'7DÆ–æRæ–æ6ÇVFW2‚w&V¦V7Br’’°Ğ¢&WGW&â²7F–öã¢w&V¦V7BrÂ&V6öã¢Æ–æW2ç6Æ–6Rƒ’æ¦ö–â‚rr’ÇÂ~Zûik[ùz(ÂrÓ°Ğ¢ĞĞ Ğ¢òòhê^Y
ÎûÉ®hùXùnzÊÎKˆXú^ŠùŞûÈ‹{>‹ør.hê^Y
Â.j~ŠëŠÎûÈĞ¢ÆWBÖW76vTÆ–æW2ÒÆ–æW3°Ğ¢–b†f—'7DÆ–æRæ–æ6ÇVFW2‚~hê^Y
Âr’ÇÂf—'7DÆ–æRæ–æ6ÇVFW2‚vç7vW"r’’°Ğ¢ÖW76vTÆ–æW2ÒÆ–æW2ç6Æ–6Rƒ“°Ğ¢ĞĞ¢6öç7Bf—'7DÖW76vRÒÖW76vTÆ–æW2æ¦ö–â‚uÆâr’çG&–Ò‚“°Ğ¢–b‚f—'7DÖW76vR’°Ğ¢F‡&÷ræWrW'&÷"‚thê^Y
ÎK¨n˜	®ŠùŞKØniÊ®hùKé¾[ÈYË®y›Òr“°Ğ¢ĞĞ¢&WGW&â²7F–öã¢vç7vW"rÂf—'7DÖW76vRÓ°Ğ¢ĞĞ¢ĞĞ Ğ¢òò	ùJRX[ÎZëZë™IûÉ¤’k*iÈyJj~zÛàĞ¢–b†•&W7öç6Ræ–æ6ÇVFW2‚~h¹.{¹Òr’ÇÂ•&W7öç6Ræ–æ6ÇVFW2‚w&V¦V7Br’ÇÂ•&W7öç6Ræ–æ6ÇVFW2‚~KˆŞikKëòr’’°Ğ¢&WGW&â²7F–öã¢w&V¦V7BrÂ&V6öã¢~Zûik[ùz(ÂrÓ°Ğ¢ĞĞ Ğ¢òòX[ÎZëiz~x˜‚¥4ôâjÎ[ÈğĞ¢G'’°Ğ¢6öç7B§6öäÖF6‚Ò•&W7öç6RæÖF6‚‚õÇµµÇ5Å5Ò£ò&7F–öâ%µÇ5Å5Ò£õÇÒò“°Ğ¢–b†§6öäÖF6‚’°Ğ¢6öç7BFV6—6–öâÒ¥4ôâç'6R†§6öäÖF6…³ÒçG&–Ò‚’“°Ğ¢–b†FV6—6–öâæ7F–öâÓÓÒvç7vW"rÇÂFV6—6–öâæ7F–öâÓÓÒw&V¦V7Br’°Ğ¢&WGW&âFV6—6–öã°Ğ¢ĞĞ¢ĞĞ¢Ò6F6‚†R’²ò¢[ûŞyZR¥4ôâŠz>iéZK‹JR¢òĞĞ Ğ¢òòiÈ{¸Zë™IûÉ®hùXùnK»¾KÙ^XúşyJih~iÊÎKÙÎK‹®[ÈYË®y›ĞĞ¢ÆWBf—'7DÖW76vRÒF†—2æW‡G&7D6öçF7DÖW76vTg&öÕ&W7öç6R†•&W7öç6RÂ6öçF7DæÖRÂ°Ğ¢—4w&÷W6ÆÂÀĞ¢w&÷WæÖS¢6öçF7DæÖRÀĞ¢'F–6—çG3¢w&÷W'F–6—çG0Ğ¢Ò“°Ğ¢–b‚f—'7DÖW76vR’°Ğ¢F‡&÷ræWrW'&÷"‚~izk9^K¸äY¹îZHŞKŠŞŠz>iéX{®iÈiXy¨N˜	®ŠùŞXk>zÙbr“°Ğ¢ĞĞ Ğ¢&WGW&â²7F–öã¢vç7vW"rÂf—'7DÖW76vS¢f—'7DÖW76vRÓ°Ğ Ğ¢Ò6F6‚†W'&÷"’°Ğ¢6öç6öÆRæW'&÷"‚~)ØÂXk>zÙnZK‹JS¢rÂW'&÷"“°Ğ¢F‡&÷rW'&÷#°Ğ¢ĞĞ¢ĞĞ Ğ¢òò	ùJRK¸äY¹îZHŞKŠŞhùXùnhÈ~Zé®ˆN{;¾K«®y¨NkhhşûÈZHNybÇvV6†CâjÎ[ÈşzØûÈĞ¢W‡G&7D6öçF7DÖW76vTg&öÕ&W7öç6R‡&W7öç6RÂ6öçF7DæÖRÂ÷F–öç2Ò·Ò’°Ğ¢6öç7B—4w&÷W6ÆÂÒ÷F–öç3òæ—4w&÷W6ÆÂÓÓÒG'VS°Ğ¢6öç7B'F–6—çG2Ò'&’æ—4'&’†÷F–öç3òç'F–6—çG2’ò÷F–öç2ç'F–6—çG2¢µÓ°Ğ¢6öç7Bw&÷WæÖRÒ7G&–ær†÷F–öç3òæw&÷WæÖRÇÂ6öçF7DæÖRÇÂrr’çG&–Ò‚“°Ğ Ğ¢–b†—4w&÷W6ÆÂ’°Ğ¢6öç7Bw&÷WVçG&–W2ÒF†—2å÷'6T6ÆÅ&WÇ”VçG&–W2‡&W7öç6RÂ°Ğ¢6öçF7DæÖRÀĞ¢'F–6—çG2ÀĞ¢w&÷WæÖRÀĞ¢—4w&÷W6ÆÀĞ¢Ò“°Ğ¢&WGW&âw&÷WVçG&–W2æÖ†—FVÒÓâG¶—FVÒç6VæFW'Ó¢G¶—FVÒçFW‡GÖ’æ¦ö–â‚uÆâr“°Ğ¢ĞĞ Ğ¢ÆWBÖW76vW2ÒµÓ°Ğ¢6öç7Bæ÷&ÖÆ—¦VE&W7öç6RÒ7G&–ær‡&W7öç6RÇÂrr’ç&WÆ6R€Ğ¢õåÇ2¢ƒó¢×³2Ç×Î(	G³"Ç×ÎûÈ×³"Ç×Î)H³"Ç×Î)H³"Ç×Å÷³2ÇÒ•Ç2¢‚â³ò•Ç2¢ƒó¢×³2Ç×Î(	G³"Ç×ÎûÈ×³"Ç×Î)H³"Ç×Î)H³"Ç×Å÷³2ÇÒ•Ç2¢BövÒÀĞ¢rÒÒÒCÒÒÒpĞ¢“°Ğ Ğ¢òòik[Èó¢ZHNybÇvV6†CâjÎ[ÈğĞ¢6öç7BvV6†D6öçFVçBÒF†—2åöW‡G&7EvV6†EFu–ÆöB†æ÷&ÖÆ—¦VE&W7öç6R’ÇÂF†—2å÷7G&—vV6†D6öÖÖVçEw&W"†æ÷&ÖÆ—¦VE&W7öç6R“°Ğ¢–b‡vV6†D6öçFVçB’°Ğ Ğ¢òò¢[	ŞŠù^h›îX‹[Ù>X˜ŞˆN{;¾K«®y¨BÒÒÖæÖRÒÒÒXË®YÙpĞ¢6öç7B6öçF7DÆ–6W2Ò°Ğ¢6öçF7DæÖRÀĞ¢ââçF†—2åö6öÆÆV7E6–ævÆT6†DÆ–6W4f÷$f–ÇFW"‡F†—2ææ7W'&VçD6†BÂF†—2å÷6fTvWD6öçFW‡B‚’Ğ¢ÒæÖ†æÖRÓâ7G&–ær†æÖRÇÂrr’çG&–Ò‚’’æf–ÇFW"„&ööÆVâ“°Ğ¢6öç7BW66VDÆ–6W2Ò²ââææWr6WB†6öçF7DÆ–6W2•ĞĞ¢æÖ†æÖRÓâæÖRç&WÆ6R‚õ²â¢³õâG·Ò‚—ÅµÅÕÅÅÒörÂuÅÂBbr’“°Ğ¢6öç7B6öçF7D&Æö6µ&VvW‚ÒW66VDÆ–6W2æÆVæwF‚â Ğ¢òæWr&VtW‡†ÒÒÒƒó¢G¶W66VDÆ–6W2æ¦ö–â‚wÂr—Ò’ÒÒÒ…µÅÇ5ÅÅ5Ò£ò’ƒóÒÒÒÕµâÕÒ²ÒÒ×ÂB–Âv’rĞ¢¢çVÆÃ°Ğ¢6öç7B6öçF7D&Æö6²Ò6öçF7D&Æö6µ&VvW‚òvV6†D6öçFVçBæÖF6‚†6öçF7D&Æö6µ&VvW‚’¢çVÆÃ°Ğ Ğ¢–b†6öçF7D&Æö6²’°Ğ¢6öç7B×6tÆ–æW2Ò6öçF7D&Æö6µ³ÒæÖF6‚‚õÅµ³Ó”Õ¦×£®ûÉ¥ÒµÅÕÇ2¢‚â²’ör“°Ğ¢–b†×6tÆ–æW2’°Ğ¢ÖW76vW2Ò×6tÆ–æW2æÖ†Æ–æRÓâÆ–æRç&WÆ6R‚õÅµ³Ó”Õ¦×£®ûÉ¥ÒµÅÕÇ2¢òÂrr’çG&–Ò‚’“°Ğ¢ĞĞ¢òòZh.iéÎk*iÈi{n™{Nh‹>jÎ[ÈşûÈÎhÈŠÎhùXùnûÈ{«şKˆ®jŠ[ÈòXù˜ˆS¢Xh^ZëûÈĞ¢–b†ÖW76vW2æÆVæwF‚ÓÓÒ’°Ğ¢ÖW76vW2Ò6öçF7D&Æö6µ³Òç7Æ—B‚uÆâr’æÖ†ÂÓâÂçG&–Ò‚’’æf–ÇFW"†ÂÓâÂbbÂç7F'G5v—F‚‚wG—S¢r’bbÂç7F'G5v—F‚‚vFFS¢r’“°Ğ¢ĞĞ¢ĞĞ Ğ¢òò#¢	ùJRizÒÒÖæÖRÒÒÒj~ZKNûÈŠúŞ™û2şŠxnš)˜	®ŠùŞjÎ[ÈşûÈûÉ®y»Nhê^hÈŠÎhùXùnXZ˜:Xh^ZëĞ¢–b†ÖW76vW2æÆVæwF‚ÓÓÒbbvV6†D6öçFVçBæ–æ6ÇVFW2‚rÒÒÒr’’°Ğ¢6öç7BÆ–æW2ÒvV6†D6öçFVçBç7Æ—B‚uÆâr’æÖ†ÂÓâÂçG&–Ò‚’’æf–ÇFW"†ÂÓâÂ“°Ğ¢òòz{¾™šNXúşˆ;Şy¨BG—S¢öFFS¢ŠÎY(Îi{n™{Nh‹>X˜Ş{È Ğ¢ÖW76vW2ÒÆ–æW0Ğ¢æf–ÇFW"†ÂÓâÂç7F'G5v—F‚‚wG—S¢r’bbÂç7F'G5v—F‚‚vFFS¢r’Ğ¢æÖ†ÂÓâÂç&WÆ6R‚õåÅµ³Ó”Õ¦×£®ûÉ¥ÒµÅÕÇ2¢òÂrr’çG&–Ò‚’Ğ¢æf–ÇFW"†ÂÓâÂ“°Ğ¢ĞĞ¢ĞĞ Ğ¢òòik[Èó#¢ZHNyn{ªşih~iÊÎkhhşûÈz{¾™šNjÎ[Èşj~ŠëûÈĞ¢–b†ÖW76vW2æÆVæwF‚ÓÓÒ’°Ğ¢ÆWB6ÆVåFW‡BÒæ÷&ÖÆ—¦VE&W7öç6PĞ¢ç&WÆ6R‚óÇvV6†CåµÇ5Å5Ò£óÅÂ÷vV6†Câöv’Ârr’òòz{¾™šGvV6†Nj~zÛàĞ¢ç&WÆ6R‚öµÇ5Å5Ò£öörÂrr’òòz{¾™šNKº>zYÙpĞ¢ç&WÆ6R‚õÇµµÇ5Å5Ò£õÇÒörÂrr’òòz{¾™šD¥4ôàĞ¢ç&WÆ6R‚òÒÒÕµâÕÒ²ÒÒÒörÂrr’òòz{¾™šNXˆn™©NzÊ`Ğ¢ç&WÆ6R‚öFFS¥ÆG³ÃgŞ[›EÆG³Ã'ŞiÈ…ÆG³Ã'ŞizRöv’Ârr’òòz{¾™šNiz^iÉğĞ¢ç&WÆ6R‚õÅµ³Ó”Õ¦×£®ûÉ¥ÒµÅÒörÂrr’òòz{¾™šNi{n™{Nh‹0Ğ¢çG&–Ò‚“°Ğ¢6ÆVåFW‡BÒF†—2å÷7G&—vV6†D6öÖÖVçEw&W"†6ÆVåFW‡B“°Ğ Ğ¢–b†6ÆVåFW‡B’°Ğ¢ÖW76vW2Ò6ÆVåFW‡Bç7Æ—B‚uÆâr’æÖ†ÂÓâÂçG&–Ò‚’’æf–ÇFW"†ÂÓâÂbbÂæÆVæwF‚â“°Ğ¢ĞĞ¢ĞĞ Ğ¢òò‹ùNY¹îY[›ny¨NkhhşûÈyJhÚ.ŠÎXˆn™©NûÈÎikKëşYî{ºŞh¸nXˆni‹îzK®ûÈĞ¢&WGW&âÖW76vW2æ¦ö–â‚uÆâr“°Ğ¢ĞĞ Ğ¢övWD7W'&VçE7F÷'•F–ÖUFW‡B‚’°Ğ¢6öç7BF–ÖTÖævW"Òv–æF÷råf—'GVÅ†öæSòçF–ÖTÖævW#°Ğ¢&WGW&âF–ÖTÖævW Ğ¢òF–ÖTÖævW"ævWD7W'&VçE7F÷'•F–ÖR‚’çF–ÖPĞ¢¢æWrFFR‚’çFôÆö6ÆUF–ÖU7G&–ær‚w¦‚Ô4ârÂ²†÷W#¢s"ÖF–v—BrÂÖ–çWFS¢s"ÖF–v—BrÒ“°Ğ¢ĞĞ Ğ¢÷&W6öÇfT6ÆÄVæE7F÷'•F–ÖR†6ÆÅ7F'EF–ÖRÒçVÆÂÂVÆ6VE6V6öæG2ÒÂ²f÷&6TGfæ6TÖ–çWFRÒfÇ6RÒÒ·Ò’°Ğ¢6öç7BF–ÖTÖævW"Òv–æF÷råf—'GVÅ†öæSòçF–ÖTÖævW#°Ğ¢6öç7B6fTVÆ6VBÒÖF‚æÖ‚ƒÂçVÖ&W"†VÆ6VE6V6öæG2’ÇÂ“°Ğ¢6öç7BW6U&VÅF–ÖRÒF†—2å÷6†÷VÆEW6U&VÅF–ÖTf÷$öæÆ–æT6†B‚“°Ğ Ğ¢6öç7BfÆÆ&6´æ÷rÒ‚’Óâ°Ğ¢6öç7Bæ÷rÒæWrFFR‚“°Ğ¢6öç7BvVV¶F—2Ò²~i‰şiÉşizRrÂ~i‰şiÉşKˆrÂ~i‰şiÉşK¨ÂrÂ~i‰şiÉşKˆ’rÂ~i‰şiÉşY¹²rÂ~i‰şiÉşK©BrÂ~i‰şiÉşXZÒuÓ°Ğ¢&WGW&â°Ğ¢F–ÖS¢æ÷rçFôÆö6ÆUF–ÖU7G&–ær‚w¦‚Ô4ârÂ²†÷W#¢s"ÖF–v—BrÂÖ–çWFS¢s"ÖF–v—BrÒ’ÀĞ¢FFS¢G¶æ÷rævWDgVÆÅ–V"‚—Ş[›BGµ7G&–ær†æ÷rævWDÖöçF‚‚’²’çE7F'Bƒ"Âsr—ŞiÈ‚Gµ7G&–ær†æ÷rævWDFFR‚’’çE7F'Bƒ"Âsr—ŞizVÀĞ¢vVV¶F“¢vVV¶F—5¶æ÷rævWDF’‚•ÒÀĞ¢F–ÖW7F×¢æ÷rævWEF–ÖR‚Ğ¢Ó°Ğ¢Ó°Ğ Ğ¢–b‡W6U&VÅF–ÖR’°Ğ¢6öç7B&6UF–ÖW7F×ÒçVÖ&W"†6ÆÅ7F'EF–ÖSòçF–ÖW7F×ÇÂFFRææ÷r‚’“°Ğ¢6öç7BVæEF–ÖW7F×Ò„çVÖ&W"æ—4f–æ—FR†&6UF–ÖW7F×’bb&6UF–ÖW7F×âò&6UF–ÖW7F×¢FFRææ÷r‚’’²6fTVÆ6VB¢°Ğ¢&WGW&âF†—2åö'V–ÆEvV6†E&VÅF–ÖTf–VÆG2†VæEF–ÖW7F×“°Ğ¢ĞĞ Ğ¢6öç7B&6UF–ÖRÒ†6ÆÅ7F'EF–ÖRbb6ÆÅ7F'EF–ÖRçF–ÖRbb6ÆÅ7F'EF–ÖRæFFRĞ¢ò6ÆÅ7F'EF–ÖPĞ¢¢‡F–ÖTÖævW#òævWD7W'&VçE7F÷'•F–ÖSòâ‚’ÇÂfÆÆ&6´æ÷r‚’“°Ğ Ğ¢6öç7BÖ–çWFW4VÆ6VE&rÒÖF‚æ6V–Â‡6fTVÆ6VBòc“°Ğ¢6öç7BÖ–çWFW4VÆ6VBÒÖF‚æÖ‚†f÷&6TGfæ6TÖ–çWFRò¢ÂÖ–çWFW4VÆ6VE&r“°Ğ Ğ¢ÆWBVæEF–ÖRÒ&6UF–ÖS°Ğ¢–b†Ö–çWFW4VÆ6VBâbbF–ÖTÖævW#òæFDÖ–çWFW5Fõ7F÷'•F–ÖR’°Ğ¢VæEF–ÖRÒF–ÖTÖævW"æFDÖ–çWFW5Fõ7F÷'•F–ÖR†&6UF–ÖRÂÖ–çWFW4VÆ6VB“°Ğ¢ĞĞ Ğ¢–b‡F–ÖTÖævW#òç6WEF–ÖRbbVæEF–ÖSòçF–ÖRbbVæEF–ÖSòæFFR’°Ğ¢F–ÖTÖævW"ç6WEF–ÖR†VæEF–ÖRçF–ÖRÂVæEF–ÖRæFFRÂVæEF–ÖRçvVV¶F’ÇÂçVÆÂ“°Ğ¢6öç7BÆFW7EF–ÖRÒF–ÖTÖævW"ævWD7W'&VçE7F÷'•F–ÖSòâ‚’ÇÂVæEF–ÖS°Ğ¢v–æF÷råf—'GVÅ†öæSòæ6†V6´6ÆVæF%66†VGVÆU&VÖ–æFW'3òâ†ÆFW7EF–ÖR“°Ğ¢&WGW&âÆFW7EF–ÖS°Ğ¢ĞĞ Ğ¢&WGW&âVæEF–ÖS°Ğ¢ĞĞ Ğ¢òò	ùJRk{¾Xª˜	®ŠùŞŠë[Ù^X‹ˆ®ZJûÈKÛşyJXš~h8^i{n™{NûÈĞ¢FD6ÆÅ&V6÷&B†6ÆÅG—RÂ7FGW2ÂGW&F–öâÂ÷F–öç2Ò·Ò’°Ğ¢6öç7BVÆ6VE6V6öæG2ÒÖF‚æÖ‚ƒÂçVÖ&W"†÷F–öç3òæVÆ6VE6V6öæG2’ÇÂ“°Ğ¢6öç7B6ÆÅ7F'EF–ÖRÒ÷F–öç3òæ6ÆÅ7F'EF–ÖRÇÂçVÆÃ°Ğ¢6öç7B6†÷VÆDGfæ6RÒ7G&–ær‡7FGW2ÇÂrr’çG&–Ò‚’ÓÓÒvç7vW&VBs°Ğ¢6öç7B7F÷'•F–ÖRÒ6†÷VÆDGfæ6PĞ¢òF†—2å÷&W6öÇfT6ÆÄVæE7F÷'•F–ÖR†6ÆÅ7F'EF–ÖRÂVÆ6VE6V6öæG2Â²f÷&6TGfæ6TÖ–çWFS¢G'VRÒĞ¢¢‡F†—2å÷6†÷VÆEW6U&VÅF–ÖTf÷$öæÆ–æT6†B‚’òF†—2åö'V–ÆEvV6†E&VÅF–ÖTf–VÆG2‚’¢‡v–æF÷råf—'GVÅ†öæSòçF–ÖTÖævW#òævWD7W'&VçE7F÷'•F–ÖSòâ‚’ÇÂçVÆÂ’“°Ğ¢6öç7B7W'&VçEF–ÖRÒ7F÷'•F–ÖSòçF–ÖRÇÂF†—2åövWD7W'&VçE7F÷'•F–ÖUFW‡B‚“°Ğ Ğ¢F†—2æçvV6†DFFæFDÖW76vR†÷F–öç3òæ6†D–BÇÂF†—2ææ7W'&VçD6†Bæ–BÂ°Ğ¢g&öÓ¢vÖRrÀĞ¢G—S¢v6ÆÅ÷&V6÷&BrÀĞ¢6ÆÅG—S¢6ÆÅG—RÀĞ¢7FGW3¢7FGW2ÀĞ¢GW&F–öã¢GW&F–öâÀĞ¢VæFVD'“¢÷F–öç3òæVæFVD'’ÇÂVæFVf–æVBÀĞ¢G&ç67&—C¢'&’æ—4'&’†÷F–öç3òçG&ç67&—B’bb÷F–öç2çG&ç67&—BæÆVæwF‚âò÷F–öç2çG&ç67&—B¢VæFVf–æVBÀĞ¢6ÆÅ7F'EF–ÖS¢7G&–ær†6ÆÅ7F'EF–ÖSòçF–ÖRÇÂrr’çG&–Ò‚’ÇÂVæFVf–æVBÀĞ¢6ÆÅ7F'DFFS¢7G&–ær†6ÆÅ7F'EF–ÖSòæFFRÇÂrr’çG&–Ò‚’ÇÂVæFVf–æVBÀĞ¢6ÆÅ7F'EvVV¶F“¢7G&–ær†6ÆÅ7F'EF–ÖSòçvVV¶F’ÇÂrr’çG&–Ò‚’ÇÂVæFVf–æVBÀĞ¢F–ÖS¢7W'&VçEF–ÖRÂòò)ÈRKÛşyJXš~h8^i{n™{@Ğ¢FFS¢7F÷'•F–ÖSòæFFRÀĞ¢vVV¶F“¢7F÷'•F–ÖSòçvVV¶FĞ¢Ò“°Ğ Ğ¢ĞĞ Ğ¢7–æ26†÷t–æ6öÖ–æufö–6T6ÆÂ†6öçF7BÂVWVVD”Æ–æW2ÒµÒ’°Ğ¢6öç7B6fT6öçF7BÒ6öçF7BÇÂF†—2ææ7W'&VçD6†BÇÂ²æÖS¢~Zûik’rÂfF#¢	ùBrÓ°Ğ¢6öç7B6öçF7DæÖRÒ6fT6öçF7BææÖRÇÂ~Zûik’s°Ğ¢6öç7B—4w&÷W6ÆÂÒ6fT6öçF7CòçG—RÓÓÒvw&÷Ws°Ğ¢6öç7Bw&÷W'F–6—çG57G&—Ò—4w&÷W6ÆÂòF†—2å÷&VæFW$w&÷W6ÆÅ'F–6—çG57G&—‡6fT6öçF7B’¢rs°Ğ¢6öç7B6ÆÄ&u7G–ÆRÒF†—2åövWEvV6†D6ÆÄ&6¶w&÷VæE7G–ÆR‡6fT6öçF7B“°Ğ¢6öç7B–æ6öÖ–æt‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò&6ÆÂÖgVÆÇ67&VVâ#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ"7G–ÆSÒ"G¶6ÆÄ&u7G–ÆWÒ†V–v‡C¢S²F—7Æ“¢fÆWƒ²fÆW‚ÖF—&V7F–öã¢6öÇVÖã²÷fW&fÆ÷s¢†–FFVã²#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW""7G–ÆSÒ&&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃã2“²&6¶G&÷Öf–ÇFW#¢&ÇW"ƒ#‚“²&÷&FW"Ö&÷GFöÓ¢‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÃã2“²#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"ÖÆVgB#àĞ¢ÂÒÒ™©‰xşy¨N‹ùNY¹îhÈ™*îûÈÎyJK¨îhê^zê[›nhºnhŠ®Xû>k¹h˜¾X«şûÈÎ™‹.jÚ.‹zşyK‹û~ZKy»Nhê^˜Y¹îjÎ™Ú"ÒÓàĞ¢Æ'WGFöâ6Æ73Ò'vV6†BÖ&6²Ö'Fâ"–CÒ&÷fW&Æ’Ö†–FFVâÖ&6²"7G–ÆSÒ&F—7Æ“¦æöæS²#ãÂö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×F—FÆR"7G–ÆSÒ&6öÆ÷#¢3333²#âG¶—4w&÷W6ÆÂò~{êNŠúŞ™û>iÚ^yKRr¢~ŠúŞ™û>iÚ^yKRwÓÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×&–v‡B#ãÂöF—càĞ¢ÂöF—càĞ Ğ¢ÆF—b6Æ73Ò'vV6†BÖ6öçFVçB"7G–ÆSÒ&fÆWƒ¢²&6¶w&÷VæC¢G&ç7&VçC²F—7Æ“¢fÆWƒ²fÆW‚ÖF—&V7F–öã¢6öÇVÖã²Æ–vâÖ—FV×3¢6VçFW#²§W7F–g’Ö6öçFVçC¢6VçFW#²FF–æs¢3‚#ƒ²#àĞ¢ÆF—b6Æ73Ò&6ÆÂÖfF"Öf—‚"7G–ÆSÒ Ğ¢v–GFƒ¢s‡ƒ°Ğ¢†V–v‡C¢s‡ƒ°Ğ¢&÷&FW"×&F—W3¢SS°Ğ¢&6¶w&÷VæC¢Æ–æV"Öw&F–VçBƒ3VFVrÂ3ccvVVRÂ3scF&"R“°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢Æ–vâÖ—FV×3¢6VçFW#°Ğ¢§W7F–g’Ö6öçFVçC¢6VçFW#°Ğ¢föçB×6—¦S¢3Gƒ°Ğ¢Ö&v–âÖ&÷GFöÓ¢#ƒ°Ğ¢&÷‚×6†F÷s¢‡‚#G‚&v&ƒ"Â#bÂ#3BÂãB“°Ğ¢æ–ÖF–öã¢–æ6öÖ–ær×VÇ6Rã3W2V6RÖ–âÖ÷WB–æf–æ—FS°Ğ¢÷fW&fÆ÷s¢†–FFVã°Ğ¢#âG·F†—2æç&VæFW$fF"‡6fT6öçF7BæfF"Â	ùBrÂ6öçF7DæÖR—ÓÂöF—càĞ Ğ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢‡ƒ²föçB×vV–v‡C¢c²6öÆ÷#¢3333²Ö&v–âÖ&÷GFöÓ¢gƒ²#àĞ¢G¶6öçF7DæÖWĞĞ¢ÂöF—càĞ¢G¶w&÷W'F–6—çG57G&—ĞĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢7ƒ²6öÆ÷#¢&v&ƒÃÃÃãS"“²Ö&v–âÖ&÷GFöÓ¢CGƒ²#àĞ¢G¶—4w&÷W6ÆÂò~˜(Šû~KÚXªXZ^{êNŠúŞ™û>˜	®ŠùÒâââr¢~˜(Šû~KÚŠúŞ™û>˜	®ŠùÒâââwĞĞ¢ÂöF—càĞ Ğ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²v¢3gƒ²#àĞ¢Æ'WGFöâ–CÒ&–æ6öÖ–ærÖ6ÆÂ×&V¦V7BÖ'Fâ"7G–ÆSÒ Ğ¢v–GFƒ¢Sgƒ°Ğ¢†V–v‡C¢Sgƒ°Ğ¢&÷&FW"×&F—W3¢SS°Ğ¢&6¶w&÷VæC¢6fc6#3°Ğ¢&÷&FW#¢æöæS°Ğ¢6öÆ÷#¢6ffc°Ğ¢föçB×6—¦S¢wƒ°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢&÷‚×6†F÷s¢G‚g‚&v&ƒ#SRÂS’ÂC‚Âã3R“°Ğ¢#ãÆ’6Æ73Ò&f×6öÆ–Bf×†öæR×6Æ6‚#ãÂö“ãÂö'WGFöãàĞ¢Æ'WGFöâ–CÒ&–æ6öÖ–ærÖ6ÆÂÖç7vW"Ö'Fâ"7G–ÆSÒ Ğ¢v–GFƒ¢Sgƒ°Ğ¢†V–v‡C¢Sgƒ°Ğ¢&÷&FW"×&F—W3¢SS°Ğ¢&6¶w&÷VæC¢33F3sS“°Ğ¢&÷&FW#¢æöæS°Ğ¢6öÆ÷#¢6ffc°Ğ¢föçB×6—¦S¢wƒ°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢&÷‚×6†F÷s¢G‚g‚&v&ƒS"Â“’Âƒ’Âã3R“°Ğ¢#ãÆ’6Æ73Ò&f×6öÆ–Bf×†öæR#ãÂö“ãÂö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²§W7F–g’Ö6öçFVçC¢6VçFW#²v¢S'ƒ²Ö&v–â×F÷¢‡ƒ²föçB×6—¦S¢ƒ²6öÆ÷#¢&v&ƒÃÃÃãCR“²#àĞ¢Ç7ãîh¹.{¹ÓÂ÷7ãàĞ¢Ç7ãîhê^Y
ÃÂ÷7ãàĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ Ğ¢Ç7G–ÆSàĞ¢¶W–g&ÖW2–æ6öÖ–ær×VÇ6R°Ğ¢RÂR°Ğ¢G&ç6f÷&Ó¢66ÆRƒ“°Ğ¢&÷‚×6†F÷s¢‡‚#G‚&v&ƒ"Â#bÂ#3BÂãB“°Ğ¢ĞĞ¢SR°Ğ¢G&ç6f÷&Ó¢66ÆRƒãB“°Ğ¢&÷‚×6†F÷s¢‚3‚&v&ƒ"Â#bÂ#3BÂãC‚“°Ğ¢ĞĞ¢ĞĞ¢æ6ÆÂÖfF"Öf—‚–Ör°Ğ¢v–GFƒ¢R–×÷'FçC°Ğ¢†V–v‡C¢R–×÷'FçC°Ğ¢Ö&v–ã¢–×÷'FçC°Ğ¢&÷&FW"×&F—W3¢SR–×÷'FçC°Ğ¢ĞĞ¢æ6ÆÂÖfF"Öf—‚F—b°Ğ¢&÷&FW"×&F—W3¢SR–×÷'FçC°Ğ¢ĞĞ¢Â÷7G–ÆSàĞ¢°Ğ Ğ¢F†—2æç†öæU6†VÆÂç6WD6öçFVçB†–æ6öÖ–æt‡FÖÂÂwvV6†BÖ6ÆÂÖ÷fW&Æ’r“°Ğ¢òòhºnhŠ®Xû>k¹‹ùNY¹îh˜¾X«şûÈÎ[nX[nzØYÎK¨îx+X{¾hÈ.ijÒşXùnkh‚şh¹.{¹ŞhÈ™*àĞ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v÷fW&Æ’Ö†–FFVâÖ&6²r“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7B6æ6VÄ'FâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6æ6VÂÖ6ÆÂÖ'Fâr’ÇÂ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVòÖ†æwWÖ'Fâr’ÇÂ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6RÖ†æwWÖ'Fâr’ÇÂ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v–æ6öÖ–ærÖ6ÆÂ×&V¦V7BÖ'Fâr“°Ğ¢–b†6æ6VÄ'Fâ’6æ6VÄ'Fâæ6Æ–6²‚“°Ğ¢VÇ6RF†—2æç&VæFW"‚“°Ğ¢Ò“°Ğ Ğ¢&WGW&âæWr&öÖ—6R‚‡&W6öÇfR’Óâ°Ğ¢ÆWB†æFÆVBÒfÇ6S°Ğ¢6öç7BFöæRÒ†66WFVB’Óâ°Ğ¢–b††æFÆVB’&WGW&ã°Ğ¢†æFÆVBÒG'VS°Ğ¢&W6öÇfR†66WFVB“°Ğ¢Ó°Ğ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v–æ6öÖ–ærÖ6ÆÂ×&V¦V7BÖ'Fâr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢F†—2æFD6ÆÅ&V6÷&B‚wfö–6RrÂw&V¦V7FVBrÂsXˆczy"r“°Ğ¢F†—2æç†öæU6†VÆÃòç6†÷tæ÷F–f–6F–öâ‚~[{.h¹.{¹ÒrÂKÚh¹.{¹ŞK¨bG¶6öçF7DæÖWŞy¨BG¶—4w&÷W6ÆÂò~{êNŠúŞ™û>˜	®ŠùÒr¢~ŠúŞ™û>˜	®ŠùÒwÖÂ	ù9âr“°Ğ¢F†—2æç&VæFW"‚“°Ğ¢FöæR†fÇ6R“°Ğ¢Ò“°Ğ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v–æ6öÖ–ærÖ6ÆÂÖç7vW"Ö'Fâr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7B”w&VWF–ærÒ„'&’æ—4'&’‡VWVVD”Æ–æW2’òVWVVD”Æ–æW2¢µÒĞ¢æÖ†Æ–æRÓâ7G&–ær†Æ–æRÇÂrr’çG&–Ò‚’Ğ¢æf–ÇFW"„&ööÆVâĞ¢æ¦ö–â‚uÆâr“°Ğ¢F†—2ç6†÷ufö–6T6ÆÄ–çFW&f6R‡6fT6öçF7BÂ”w&VWF–ær“°Ğ¢FöæR‡G'VR“°Ğ¢Ò“°Ğ¢Ò“°Ğ¢ĞĞ Ğ¢7–æ26†÷t–æ6öÖ–æuf–FVô6ÆÂ†6öçF7BÂVWVVD”Æ–æW2ÒµÒ’°Ğ¢6öç7B6fT6öçF7BÒ6öçF7BÇÂF†—2ææ7W'&VçD6†BÇÂ²æÖS¢~Zûik’rÂfF#¢	ùBrÓ°Ğ¢6öç7B6öçF7DæÖRÒ6fT6öçF7BææÖRÇÂ~Zûik’s°Ğ¢6öç7B—4w&÷W6ÆÂÒ6fT6öçF7CòçG—RÓÓÒvw&÷Ws°Ğ¢6öç7Bw&÷W'F–6—çG57G&—Ò—4w&÷W6ÆÂòF†—2å÷&VæFW$w&÷W6ÆÅ'F–6—çG57G&—‡6fT6öçF7B’¢rs°Ğ¢6öç7B6ÆÄ&u7G–ÆRÒF†—2åövWEvV6†D6ÆÄ&6¶w&÷VæE7G–ÆR‡6fT6öçF7B“°Ğ¢6öç7B–æ6öÖ–æt‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò&6ÆÂÖgVÆÇ67&VVâ#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ"7G–ÆSÒ"G¶6ÆÄ&u7G–ÆWÒ†V–v‡C¢S²F—7Æ“¢fÆWƒ²fÆW‚ÖF—&V7F–öã¢6öÇVÖã²÷fW&fÆ÷s¢†–FFVã²#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW""7G–ÆSÒ&&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃã2“²&6¶G&÷Öf–ÇFW#¢&ÇW"ƒ#‚“²&÷&FW"Ö&÷GFöÓ¢‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÃã2“²#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"ÖÆVgB#àĞ¢ÂÒÒ™©‰xşy¨N‹ùNY¹îhÈ™*îûÈÎyJK¨îhê^zê[›nhºnhŠ®Xû>k¹h˜¾X«şûÈÎ™‹.jÚ.‹zşyK‹û~ZKy»Nhê^˜Y¹îjÎ™Ú"ÒÓàĞ¢Æ'WGFöâ6Æ73Ò'vV6†BÖ&6²Ö'Fâ"–CÒ&÷fW&Æ’Ö†–FFVâÖ&6²"7G–ÆSÒ&F—7Æ“¦æöæS²#ãÂö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×F—FÆR"7G–ÆSÒ&6öÆ÷#¢3333²#âG¶—4w&÷W6ÆÂò~{êNŠxnš)iÚ^yKRr¢~Šxnš)iÚ^yKRwÓÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×&–v‡B#ãÂöF—càĞ¢ÂöF—càĞ Ğ¢ÆF—b6Æ73Ò'vV6†BÖ6öçFVçB"7G–ÆSÒ&fÆWƒ¢²&6¶w&÷VæC¢G&ç7&VçC²F—7Æ“¢fÆWƒ²fÆW‚ÖF—&V7F–öã¢6öÇVÖã²Æ–vâÖ—FV×3¢6VçFW#²§W7F–g’Ö6öçFVçC¢6VçFW#²FF–æs¢3‚#ƒ²#àĞ¢ÆF—b6Æ73Ò&6ÆÂÖfF"Öf—‚"7G–ÆSÒ Ğ¢v–GFƒ¢s‡ƒ°Ğ¢†V–v‡C¢s‡ƒ°Ğ¢&÷&FW"×&F—W3¢SS°Ğ¢&6¶w&÷VæC¢Æ–æV"Öw&F–VçBƒ3VFVrÂ3ccvVVRÂ3scF&"R“°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢Æ–vâÖ—FV×3¢6VçFW#°Ğ¢§W7F–g’Ö6öçFVçC¢6VçFW#°Ğ¢föçB×6—¦S¢3Gƒ°Ğ¢Ö&v–âÖ&÷GFöÓ¢#ƒ°Ğ¢&÷‚×6†F÷s¢‡‚#G‚&v&ƒ"Â#bÂ#3BÂãB“°Ğ¢æ–ÖF–öã¢–æ6öÖ–ær×VÇ6Rã3W2V6RÖ–âÖ÷WB–æf–æ—FS°Ğ¢÷fW&fÆ÷s¢†–FFVã°Ğ¢#âG·F†—2æç&VæFW$fF"‡6fT6öçF7BæfF"Â	ùBrÂ6öçF7DæÖR—ÓÂöF—càĞ Ğ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢‡ƒ²föçB×vV–v‡C¢c²6öÆ÷#¢3333²Ö&v–âÖ&÷GFöÓ¢gƒ²#àĞ¢G¶6öçF7DæÖWĞĞ¢ÂöF—càĞ¢G¶w&÷W'F–6—çG57G&—ĞĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢7ƒ²6öÆ÷#¢&v&ƒÃÃÃãS"“²Ö&v–âÖ&÷GFöÓ¢CGƒ²#àĞ¢G¶—4w&÷W6ÆÂò~˜(Šû~KÚXªXZ^{êNŠxnš)˜	®ŠùÒâââr¢~˜(Šû~KÚŠxnš)˜	®ŠùÒâââwĞĞ¢ÂöF—càĞ Ğ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²v¢3gƒ²#àĞ¢Æ'WGFöâ–CÒ&–æ6öÖ–ærÖ6ÆÂ×&V¦V7BÖ'Fâ"7G–ÆSÒ Ğ¢v–GFƒ¢Sgƒ°Ğ¢†V–v‡C¢Sgƒ°Ğ¢&÷&FW"×&F—W3¢SS°Ğ¢&6¶w&÷VæC¢6fc6#3°Ğ¢&÷&FW#¢æöæS°Ğ¢6öÆ÷#¢6ffc°Ğ¢föçB×6—¦S¢wƒ°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢&÷‚×6†F÷s¢G‚g‚&v&ƒ#SRÂS’ÂC‚Âã3R“°Ğ¢#ãÆ’6Æ73Ò&f×6öÆ–Bf×†öæR×6Æ6‚#ãÂö“ãÂö'WGFöãàĞ¢Æ'WGFöâ–CÒ&–æ6öÖ–ærÖ6ÆÂÖç7vW"Ö'Fâ"7G–ÆSÒ Ğ¢v–GFƒ¢Sgƒ°Ğ¢†V–v‡C¢Sgƒ°Ğ¢&÷&FW"×&F—W3¢SS°Ğ¢&6¶w&÷VæC¢33F3sS“°Ğ¢&÷&FW#¢æöæS°Ğ¢6öÆ÷#¢6ffc°Ğ¢föçB×6—¦S¢wƒ°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢&÷‚×6†F÷s¢G‚g‚&v&ƒS"Â“’Âƒ’Âã3R“°Ğ¢#ãÆ’6Æ73Ò&f×6öÆ–Bf×†öæR#ãÂö“ãÂö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²§W7F–g’Ö6öçFVçC¢6VçFW#²v¢S'ƒ²Ö&v–â×F÷¢‡ƒ²föçB×6—¦S¢ƒ²6öÆ÷#¢&v&ƒÃÃÃãCR“²#àĞ¢Ç7ãîh¹.{¹ÓÂ÷7ãàĞ¢Ç7ãîhê^Y
ÃÂ÷7ãàĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ Ğ¢Ç7G–ÆSàĞ¢¶W–g&ÖW2–æ6öÖ–ær×VÇ6R°Ğ¢RÂR°Ğ¢G&ç6f÷&Ó¢66ÆRƒ“°Ğ¢&÷‚×6†F÷s¢‡‚#G‚&v&ƒ"Â#bÂ#3BÂãB“°Ğ¢ĞĞ¢SR°Ğ¢G&ç6f÷&Ó¢66ÆRƒãB“°Ğ¢&÷‚×6†F÷s¢‚3‚&v&ƒ"Â#bÂ#3BÂãC‚“°Ğ¢ĞĞ¢ĞĞ¢æ6ÆÂÖfF"Öf—‚–Ör°Ğ¢v–GFƒ¢R–×÷'FçC°Ğ¢†V–v‡C¢R–×÷'FçC°Ğ¢Ö&v–ã¢–×÷'FçC°Ğ¢&÷&FW"×&F—W3¢SR–×÷'FçC°Ğ¢ĞĞ¢æ6ÆÂÖfF"Öf—‚F—b°Ğ¢&÷&FW"×&F—W3¢SR–×÷'FçC°Ğ¢ĞĞ¢Â÷7G–ÆSàĞ¢°Ğ Ğ¢F†—2æç†öæU6†VÆÂç6WD6öçFVçB†–æ6öÖ–æt‡FÖÂÂwvV6†BÖ6ÆÂÖ÷fW&Æ’r“°Ğ¢òòhºnhŠ®Xû>k¹‹ùNY¹îh˜¾X«şûÈÎ[nX[nzØYÎK¨îx+X{¾hÈ.ijÒşXùnkh‚şh¹.{¹ŞhÈ™*àĞ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v÷fW&Æ’Ö†–FFVâÖ&6²r“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7B6æ6VÄ'FâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6æ6VÂÖ6ÆÂÖ'Fâr’ÇÂ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVòÖ†æwWÖ'Fâr’ÇÂ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6RÖ†æwWÖ'Fâr’ÇÂ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v–æ6öÖ–ærÖ6ÆÂ×&V¦V7BÖ'Fâr“°Ğ¢–b†6æ6VÄ'Fâ’6æ6VÄ'Fâæ6Æ–6²‚“°Ğ¢VÇ6RF†—2æç&VæFW"‚“°Ğ¢Ò“°Ğ Ğ¢&WGW&âæWr&öÖ—6R‚‡&W6öÇfR’Óâ°Ğ¢ÆWB†æFÆVBÒfÇ6S°Ğ¢6öç7BFöæRÒ†66WFVB’Óâ°Ğ¢–b††æFÆVB’&WGW&ã°Ğ¢†æFÆVBÒG'VS°Ğ¢&W6öÇfR†66WFVB“°Ğ¢Ó°Ğ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v–æ6öÖ–ærÖ6ÆÂ×&V¦V7BÖ'Fâr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢F†—2æFD6ÆÅ&V6÷&B‚wf–FVòrÂw&V¦V7FVBrÂsXˆczy"r“°Ğ¢F†—2æç†öæU6†VÆÃòç6†÷tæ÷F–f–6F–öâ‚~[{.h¹.{¹ÒrÂKÚh¹.{¹ŞK¨bG¶6öçF7DæÖWŞy¨BG¶—4w&÷W6ÆÂò~{êNŠxnš)˜	®ŠùÒr¢~Šxnš)˜	®ŠùÒwÖÂ	ù9âr“°Ğ¢F†—2æç&VæFW"‚“°Ğ¢FöæR†fÇ6R“°Ğ¢Ò“°Ğ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v–æ6öÖ–ærÖ6ÆÂÖç7vW"Ö'Fâr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7B”w&VWF–ærÒ„'&’æ—4'&’‡VWVVD”Æ–æW2’òVWVVD”Æ–æW2¢µÒĞ¢æÖ†Æ–æRÓâ7G&–ær†Æ–æRÇÂrr’çG&–Ò‚’Ğ¢æf–ÇFW"„&ööÆVâĞ¢æ¦ö–â‚uÆâr“°Ğ¢F†—2ç6†÷uf–FVô6ÆÄ–çFW&f6R‡6fT6öçF7BÂ”w&VWF–ær“°Ğ¢FöæR‡G'VR“°Ğ¢Ò“°Ğ¢Ò“°Ğ¢ĞĞ Ğ¢òò	ù9âŠúŞ™û>˜	®ŠùŞûÈikZ)îZèÎi[Nikk9^ûÈĞ¢7–æ27F'Efö–6T6ÆÂ‚’°Ğ¢òò	ùJRX[>™zŞi»NZI®™Ú.iÛğĞ¢F†—2ç6†÷tÖ÷&RÒfÇ6S°Ğ Ğ¢òò	ùJRj8iú^YÊ{«şjŠ[ÈğĞ¢–b‚F†—2æ—4öæÆ–æTÖöFR‚’’°Ğ¢F†—2æç†öæU6†VÆÃòç6†÷tæ÷F–f–6F–öâ‚~zk¾{«şjŠ[ÈòrÂ~Šû~XXYÊŠëî{ÚîKŠŞ[ÈY
şYÊ{«şjŠ[Èşh˜Şˆ;ŞXù‹[~˜	®ŠùÒrÂ~)ªûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6öç7B6öçF7BÒF†—2ææ7W'&VçD6†C°Ğ¢6öç7B—4w&÷W6ÆÂÒ6öçF7CòçG—RÓÓÒvw&÷Ws°Ğ¢6öç7Bw&÷W'F–6—çG57G&—Ò—4w&÷W6ÆÂòF†—2å÷&VæFW$w&÷W6ÆÅ'F–6—çG57G&—†6öçF7B’¢rs°Ğ¢6öç7B6ÆÄ&u7G–ÆRÒF†—2åövWEvV6†D6ÆÄ&6¶w&÷VæE7G–ÆR†6öçF7B“°Ğ Ğ¢òòYÎXú¾yXÎ™Ú"Òy›Şˆ›.xë¾y(>š8îjÀĞ¢6öç7B6ÆÆ–æt‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò&6ÆÂÖgVÆÇ67&VVâ#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ"7G–ÆSÒ"G¶6ÆÄ&u7G–ÆWÒ†V–v‡C¢S²F—7Æ“¢fÆWƒ²fÆW‚ÖF—&V7F–öã¢6öÇVÖã²÷fW&fÆ÷s¢†–FFVã²#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW""7G–ÆSÒ&&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃã2“²&6¶G&÷Öf–ÇFW#¢&ÇW"ƒ#‚“²&÷&FW"Ö&÷GFöÓ¢‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÃã2“²#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"ÖÆVgB#àĞ¢ÂÒÒ™©‰xşy¨N‹ùNY¹îhÈ™*îûÈÎyJK¨îhê^zê[›nhºnhŠ®Xû>k¹h˜¾X«şûÈÎ™‹.jÚ.‹zşyK‹û~ZKy»Nhê^˜Y¹îjÎ™Ú"ÒÓàĞ¢Æ'WGFöâ6Æ73Ò'vV6†BÖ&6²Ö'Fâ"–CÒ&÷fW&Æ’Ö†–FFVâÖ&6²"7G–ÆSÒ&F—7Æ“¦æöæS²#ãÂö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×F—FÆR"7G–ÆSÒ&6öÆ÷#¢3333²#âG¶—4w&÷W6ÆÂò~{êNŠúŞ™û>˜	®ŠùÒr¢~ŠúŞ™û>˜	®ŠùÒwÓÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×&–v‡B#ãÂöF—càĞ¢ÂöF—càĞ Ğ¢ÆF—b6Æ73Ò'vV6†BÖ6öçFVçB"7G–ÆSÒ&fÆWƒ¢²&6¶w&÷VæC¢G&ç7&VçC²F—7Æ“¢fÆWƒ²fÆW‚ÖF—&V7F–öã¢6öÇVÖã²Æ–vâÖ—FV×3¢6VçFW#²§W7F–g’Ö6öçFVçC¢6VçFW#²FF–æs¢3‚#ƒ²#àĞ¢ÆF—b6Æ73Ò&6ÆÂÖfF"Öf—‚"7G–ÆSÒ Ğ¢v–GFƒ¢sƒ°Ğ¢†V–v‡C¢sƒ°Ğ¢&÷&FW"×&F—W3¢SS°Ğ¢&6¶w&÷VæC¢Æ–æV"Öw&F–VçBƒ3VFVrÂ3ccvVVRÂ3scF&"R“°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢Æ–vâÖ—FV×3¢6VçFW#°Ğ¢§W7F–g’Ö6öçFVçC¢6VçFW#°Ğ¢föçB×6—¦S¢3'ƒ°Ğ¢Ö&v–âÖ&÷GFöÓ¢#ƒ°Ğ¢&÷‚×6†F÷s¢g‚#G‚&v&ƒ"Â#bÂ#3BÂãB“°Ğ¢æ–ÖF–öã¢6ÆÆ–ær×VÇ6RãW2V6RÖ–âÖ÷WB–æf–æ—FS°Ğ¢÷fW&fÆ÷s¢†–FFVã°Ğ¢#âG·F†—2æç&VæFW$fF"†6öçF7BæfF"Â	ùBrÂ6öçF7BææÖR—ÓÂöF—càĞ Ğ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢‡ƒ²föçB×vV–v‡C¢c²6öÆ÷#¢3333²Ö&v–âÖ&÷GFöÓ¢gƒ²#àĞ¢G¶6öçF7BææÖWĞĞ¢ÂöF—càĞ¢G¶w&÷W'F–6—çG57G&—ĞĞ Ğ¢ÆF—b–CÒ&6ÆÂ×7FGW2"7G–ÆSÒ&föçB×6—¦S¢7ƒ²6öÆ÷#¢&v&ƒÃÃÃãR“²Ö&v–âÖ&÷GFöÓ¢Cƒ²#àĞ¢G¶—4w&÷W6ÆÂò~jÚ>YÊYÎXú¾{êNh‰Y‚âââr¢~jÚ>YÊYÎXú²âââwĞĞ¢ÂöF—càĞ Ğ¢Æ'WGFöâ–CÒ&6æ6VÂÖ6ÆÂÖ'Fâ"7G–ÆSÒ Ğ¢v–GFƒ¢Sƒ°Ğ¢†V–v‡C¢Sƒ°Ğ¢&÷&FW"×&F—W3¢SS°Ğ¢&6¶w&÷VæC¢6fc6#3°Ğ¢&÷&FW#¢æöæS°Ğ¢6öÆ÷#¢6ffc°Ğ¢föçB×6—¦S¢#ƒ°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢&÷‚×6†F÷s¢G‚g‚&v&ƒ#SRÂS’ÂC‚ÂãB“°Ğ¢#àĞ¢Æ’6Æ73Ò&f×6öÆ–Bf×†öæR×6Æ6‚#ãÂö“àĞ¢Âö'WGFöãàĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢ƒ²6öÆ÷#¢&v&ƒÃÃÃãB“²Ö&v–â×F÷¢gƒ²#îXùnkhƒÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ Ğ¢Ç7G–ÆSàĞ¢¶W–g&ÖW26ÆÆ–ær×VÇ6R°Ğ¢RÂR°Ğ¢G&ç6f÷&Ó¢66ÆRƒ“°Ğ¢&÷‚×6†F÷s¢g‚#G‚&v&ƒ"Â#bÂ#3BÂãB“°Ğ¢ĞĞ¢SR°Ğ¢G&ç6f÷&Ó¢66ÆRƒã2“°Ğ¢&÷‚×6†F÷s¢‡‚3'‚&v&ƒ"Â#bÂ#3BÂãR“°Ğ¢ĞĞ¢ĞĞ¢æ6ÆÂÖfF"Öf—‚–Ör°Ğ¢v–GFƒ¢R–×÷'FçC°Ğ¢†V–v‡C¢R–×÷'FçC°Ğ¢Ö&v–ã¢–×÷'FçC°Ğ¢&÷&FW"×&F—W3¢SR–×÷'FçC°Ğ¢ĞĞ¢æ6ÆÂÖfF"Öf—‚F—b°Ğ¢&÷&FW"×&F—W3¢SR–×÷'FçC°Ğ¢ĞĞ¢Â÷7G–ÆSàĞ¢°Ğ Ğ¢F†—2æç†öæU6†VÆÂç6WD6öçFVçB†6ÆÆ–æt‡FÖÂÂwvV6†BÖ6ÆÂÖ÷fW&Æ’r“°Ğ¢òòhºnhŠ®Xû>k¹‹ùNY¹îh˜¾X«şûÈÎ[nX[nzØYÎK¨îx+X{¾hÈ.ijÒşXùnkh‚şh¹.{¹ŞhÈ™*àĞ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v÷fW&Æ’Ö†–FFVâÖ&6²r“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7B6æ6VÄ'FâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6æ6VÂÖ6ÆÂÖ'Fâr’ÇÂ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVòÖ†æwWÖ'Fâr’ÇÂ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6RÖ†æwWÖ'Fâr’ÇÂ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v–æ6öÖ–ærÖ6ÆÂ×&V¦V7BÖ'Fâr“°Ğ¢–b†6æ6VÄ'Fâ’6æ6VÄ'Fâæ6Æ–6²‚“°Ğ¢VÇ6RF†—2æç&VæFW"‚“°Ğ¢Ò“°Ğ Ğ¢ÆWB—46æ6VÆÆVBÒfÇ6S°Ğ¢6öç7B6ÆÄ&÷'D6öçG&öÆÆW"ÒæWr&÷'D6öçG&öÆÆW"‚“°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6æ6VÂÖ6ÆÂÖ'Fâr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢—46æ6VÆÆVBÒG'VS°Ğ¢6ÆÄ&÷'D6öçG&öÆÆW"æ&÷'B‚“°Ğ¢òò	ùJRj[ø>iØh¹¾ûÉ®‹>yJ˜Y.šhnyÉşZéîXZ[XÎjÚ.X{Şi[ Ğ¢–b‡G—Vöbv–æF÷rç7F÷vVæW&F–öâÓÓÒvgVæ7F–öâr’°Ğ¢v–æF÷rç7F÷vVæW&F–öâ‚“°Ğ¢ĞĞ¢òò	ùJRi«NX©¾XYÎ[©^ûÉ®[Ë®X‹nx+X{¾yXÎ™Ú.y¨NXÎjÚ.hÈ™*àĞ¢6öç7B7E7F÷'FâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖW5÷7F÷r“°Ğ¢–b‡7E7F÷'Fâ’°Ğ¢7E7F÷'Fâæ6Æ–6²‚“°Ğ¢ĞĞ¢F†—2æFD6ÆÅ&V6÷&B‚wfö–6RrÂv6æ6VÆÆVBrÂsXˆczy"r“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~[{.Xùnkh‚rÂ—4w&÷W6ÆÂò~{êNŠúŞ™û>˜	®ŠùŞ[{.Xùnkh‚r¢~ŠúŞ™û>˜	®ŠùŞ[{.Xùnkh‚rÂ	ù9âr“°Ğ¢6WEF–ÖV÷WB‚‚’ÓâF†—2æç&VæFW"‚’ÂS“°Ğ¢Ò“°Ğ Ğ¢G'’°Ğ¢v—BæWr&öÖ—6R‡&W6öÇfRÓâ6WEF–ÖV÷WB‡&W6öÇfRÂ#’“°Ğ Ğ¢–b†—46æ6VÆÆVB’&WGW&ã°Ğ Ğ¢6öç7BFV6—6–öâÒv—BF†—2æ6´”f÷$6ÆÄFV6—6–öâ‚wfö–6RrÂ6öçF7BææÖR“°Ğ Ğ¢òò	ùJRzØ”h	Şˆ>ZèÎ‹ùNY¹îi{nûÈÎXhŞjÊj8iú^yJh‹~iŠşY
n[{.{¸şx+X{¾K¨nXùnkhûÈÎh‰nˆ^iŠşY
n[{.{¸ş˜X{®K¨nˆ®ZJyXÎ™Ú Ğ¢–b†—46æ6VÆÆVBÇÂF†—2ææ7W'&VçD6†B’&WGW&ã°Ğ Ğ¢–b†FV6—6–öâæ7F–öâÓÓÒw&V¦V7Br’°Ğ¢6öç7B7FGW4F—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6ÆÂ×7FGW2r“°Ğ¢–b‡7FGW4F—b’°Ğ¢7FGW4F—bçFW‡D6öçFVçBÒ—4w&÷W6ÆÂò~{êNh‰YiÊ®hê^Y
Âr¢~Zûik[{.h¹.{¹Òs°Ğ¢7FGW4F—bç7G–ÆRæ6öÆ÷"Òr6fc6#3s°Ğ¢ĞĞ Ğ¢F†—2æFD6ÆÅ&V6÷&B‚wfö–6RrÂw&V¦V7FVBrÂsXˆczy"r“°Ğ Ğ¢6WEF–ÖV÷WB‚‚’Óâ°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~˜	®ŠùŞ{¹>iÙòrÂ—4w&÷W6ÆÂò~{êNh‰YiÊ®hê^Y
ÎŠúŞ™û>˜	®ŠùÒr¢~Zûikh¹.{¹ŞK¨nŠúŞ™û>˜	®ŠùÒrÂ~)ØÂr“°Ğ¢6WEF–ÖV÷WB‚‚’ÓâF†—2æç&VæFW"‚’Â“°Ğ¢ÒÂ#“°Ğ Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢òòhê^˜	®Yîi‹îzK®˜	®ŠùŞyXÎ™Ú.ûÈÎ[›nZHNydy¨N[ÈYË®y›ĞĞ¢F†—2ç6†÷ufö–6T6ÆÄ–çFW&f6R†6öçF7BÂFV6—6–öâæf—'7DÖW76vR“°Ğ Ğ¢Ò6F6‚†W'&÷"’°Ğ¢òò	ùJRXË®XˆnKŠŞijŞY(ÎX[nK¹n™IŠúşûÈÎ™Ù›¹ZHNynKŠŞijĞĞ¢–b†—46æ6VÆÆVBÇÂW'&÷"ææÖRÓÓÒt&÷'DW'&÷"r’°Ğ¢6öç6öÆRæÆör‚~)ÈRŠúŞ™û>˜	®ŠùŞ[{.XùnkhûÈÎ™Ù›¹ZHNybr“°Ğ¢ÒVÇ6R°Ğ¢6öç6öÆRæW'&÷"‚~)ØÂŠúŞ™û>˜	®ŠùŞZK‹JS¢rÂW'&÷"“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~˜	®ŠùŞZK‹JRrÂtŠû~k.ZK‹J^ûÈÎŠû~j8iú^{Ù{¹ÎY(ÎYÊ{«şjŠ[ÈşŠëî{ÚârÂ~)ØÂr“°Ğ¢6WEF–ÖV÷WB‚‚’ÓâF†—2æç&VæFW"‚’Â“°Ğ¢ĞĞ¢ĞĞ¢ĞĞ Ğ¢öæ÷&ÖÆ—¦T6ÆÅ&WÇ”Æ–æW2‡&uFW‡BÂ6öçF7DæÖRÒrr’°Ğ¢6öç7B6÷W&6RÒ7G&–ær‡&uFW‡BÇÂrrĞ¢ç&WÆ6R‚õÇ%ÆâörÂuÆârĞ¢ç&WÆ6R‚õÅ¾[êîKúÅÕµã®ûÉ¥Ò¥¾ûÉ£¥ÕÇ2¢örÂrrĞ¢çG&–Ò‚“°Ğ¢–b‚6÷W&6R’&WGW&âµÓ°Ğ Ğ¢6öç7BW66VDæÖRÒ7G&–ær†6öçF7DæÖRÇÂrr’ç&WÆ6R‚õ²â¢³õâG·Ò‚—ÅµÅÕÅÅÒörÂuÅÂBbr“°Ğ¢6öç7B6VæFW%&Vf—…&VvW‚ÒW66VDæÖRòæWr&VtW‡†âG¶W66VDæÖWÕÅÇ2¥¾ûÉ£¥ÕÅÇ2¦’¢çVÆÃ°Ğ Ğ¢&WGW&â6÷W&6PĞ¢ç7Æ—B‚õÇÅÇÅÇÇÅÆâ²òĞ¢æÖ†Æ–æRÓâ7G&–ær†Æ–æRÇÂrr’çG&–Ò‚’Ğ¢æÖ†Æ–æRÓâÆ–æRç&WÆ6R‚õåÅµ³Ó”Õ¦×£®ûÉ¥ÒµÅÕÇ2¢òÂrr’Ğ¢æÖ†Æ–æRÓâÆ–æRç&WÆ6R‚õæg&öÕÇ2µÅ2µ¾ûÉ£¥ÕÇ2¢ö’Ârr’Ğ¢æÖ†Æ–æRÓâ6VæFW%&Vf—…&VvW‚òÆ–æRç&WÆ6R‡6VæFW%&Vf—…&VvW‚Ârr’¢Æ–æRĞ¢æÖ†Æ–æRÓâF†—2å÷7G&—6ÆÅ7VV6…&Vf—‚†Æ–æR’Ğ¢æÖ†Æ–æRÓâÆ–æRçG&–Ò‚’Ğ¢æf–ÇFW"„&ööÆVâ“°Ğ¢ĞĞ Ğ¢òò	ù;’˜	®ŠùŞKŠŞXù˜khhş{¹”ûÈŠúŞ™û2şŠxnš)˜	®yJûÈĞ¢7–æ26VæD6ÆÄÖW76vUFô’†ÖW76vRÂ6öçF7DæÖRÂ6†D†—7F÷'’Â6ÆÅG—RÒwfö–6Rr’°Ğ¢G'’°Ğ¢6öç7B6öçFW‡BÒv–æF÷rå6–ÆÇ•FfW&ãòævWD6öçFW‡Còâ‚“°Ğ¢–b‚6öçFW‡B’&WGW&ârâââs°Ğ Ğ¢6öç7B6ÆÅG—TæÖRÒ6ÆÅG—RÓÓÒwf–FVòrò~Šxnš)r¢~ŠúŞ™û2s°Ğ¢6öç7BW6W$æÖRÒ6öçFW‡BææÖSÇÂ~yJh‹rs°Ğ¢6öç7BF&vWD6†BÒF†—2ææ7W'&VçD6†C°Ğ¢6öç7B—4w&÷W6ÆÂÒF&vWD6†CòçG—RÓÓÒvw&÷Ws°Ğ¢6öç7Bw&÷W'F–6—çG2ÒF†—2åövWDw&÷W6†E'F–6—çG2‡F&vWD6†B“°Ğ¢6öç7B6ÆÄ†—7F÷'”Æ–Ö—BÒ—4w&÷W6ÆÀĞ¢òF†—2å÷&VDæöäæVvF—fTÆ–Ö—B‚wvV6†BÖw&÷WÖ6ÆÂÖ†—7F÷'’ÖÆ–Ö—BrÂSĞ¢¢F†—2å÷&VDæöäæVvF—fTÆ–Ö—B‚wvV6†B×6–ævÆRÖ6ÆÂÖ†—7F÷'’ÖÆ–Ö—BrÂ3“°Ğ¢6öç7B&V6VçD6ÆÄ†—7F÷'’Ò6ÆÄ†—7F÷'”Æ–Ö—Bâò6†D†—7F÷'’ç6Æ–6R‚Ö6ÆÄ†—7F÷'”Æ–Ö—B’¢µÓ°Ğ Ğ¢6öç7B6ÆÅG&ç67&—BÒ&V6VçD6ÆÄ†—7F÷'Ğ¢æÖ†‚ÓâG¶‚æg&öÒÓÓÒvÖRròW6W$æÖR¢†—4w&÷W6ÆÂò‚æg&öÒ¢6öçF7DæÖR—Ó¢G¶‚çFW‡GÖĞ¢æ¦ö–â‚uÆâr’ÇÂ~i¨.iz˜	®ŠùŞŠë[ÙRs°Ğ¢6öç7B&ö×BÒ8	[êîKúG¶6ÆÅG—TæÖWŞ˜	®ŠùŞKŠŞ8	Ğ®˜	®ŠùŞŠë[Ù^ûÉ Ğ¢G¶6ÆÅG&ç67&—GÖ°Ğ Ğ¢òò	ùJRKÊ˜	"6ÆÅG—RKÙÎK‹¢6ÆÄÖöFPĞ¢6öç7B•&W7öç6RÒv—BF†—2ç6VæEFô”†–FFVâ‡&ö×BÂ6öçFW‡BÂ6ÆÅG—R“°Ğ Ğ¢òò	ùJRKÛşyJ{¹şKˆikk9^hùXùn[Ù>X˜ŞˆN{;¾K«®y¨NkhhğĞ¢ÆWB6ÆVæVE&W7öç6RÒF†—2æW‡G&7D6öçF7DÖW76vTg&öÕ&W7öç6R†•&W7öç6RÂ6öçF7DæÖRÂ°Ğ¢—4w&÷W6ÆÂÀĞ¢w&÷WæÖS¢6öçF7DæÖRÀĞ¢'F–6—çG3¢w&÷W'F–6—çG0Ğ¢Ò“°Ğ Ğ¢òòZh.iéÎhùXùnZK‹J^ûÈÎ[	ŞŠù^zèXÙ^kˆ^y`Ğ¢–b‚6ÆVæVE&W7öç6R’°Ğ¢6ÆVæVE&W7öç6RÒF†—2åöW‡G&7EvV6†EFu–ÆöD÷%6VÆb†•&W7öç6R’çG&–Ò‚“°Ğ¢ĞĞ Ğ¢6öç7B†æwW&WÇ’Ò'6T6ÆÄ†æwW&WÇ’†6ÆVæVE&W7öç6R“°Ğ¢6ÆVæVE&W7öç6RÒ†æwW&WÇ’çFW‡C°Ğ¢6öç7Bv—F„†æwWÒFW‡BÓâ†æwW&WÇ’æVæFVBòG·FW‡GÕÆî[{.hÈ.ijÖçG&–Ò‚’¢FW‡C°Ğ Ğ¢–b†—4w&÷W6ÆÂ’°Ğ¢6öç7Bw&÷WVçG&–W2ÒF†—2å÷'6T6ÆÅ&WÇ”VçG&–W2†6ÆVæVE&W7öç6RÂ°Ğ¢6öçF7DæÖRÀĞ¢'F–6—çG3¢w&÷W'F–6—çG2ÀĞ¢w&÷WæÖS¢6öçF7DæÖRÀĞ¢—4w&÷W6ÆÀĞ¢Ò“°Ğ¢–b†w&÷WVçG&–W2æÆVæwF‚â’°Ğ¢&WGW&âv—F„†æwW†w&÷WVçG&–W2æÖ†—FVÒÓâG¶—FVÒç6VæFW'Ó¢G¶—FVÒçFW‡GÖ’æ¦ö–â‚uÆâr’“°Ğ¢ĞĞ¢&WGW&âv—F„†æwW…7G&–ær†6ÆVæVE&W7öç6RÇÂrr’çG&–Ò‚’ÇÂ††æwW&WÇ’æVæFVBòrr¢râââr’“°Ğ¢ĞĞ Ğ¢6öç7BÆ–æW2ÒF†—2åöæ÷&ÖÆ—¦T6ÆÅ&WÇ”Æ–æW2†6ÆVæVE&W7öç6RÂ6öçF7DæÖR“°Ğ¢&WGW&âv—F„†æwW†Æ–æW2æÆVæwF‚âòÆ–æW2æ¦ö–â‚uÆâr’¢††æwW&WÇ’æVæFVBòrr¢râââr’“°Ğ Ğ¢Ò6F6‚†W'&÷"’°Ğ¢6öç6öÆRæW'&÷"†)ØÂG¶6ÆÅG—WŞ˜	®ŠùŞkhhşXù˜ZK‹JS¦ÂW'&÷"“°Ğ¢&WGW&ârâââs°Ğ¢ĞĞ¢ĞĞ Ğ¢òò	ù;’Šxnš)˜	®ŠùŞKŠŞXù˜khhş{¹”ûÈX[ÎZëiz~‹>yJûÈĞ¢7–æ26VæEf–FVô6ÆÄÖW76vUFô’†ÖW76vRÂ6öçF7DæÖRÂ6†D†—7F÷'’’°Ğ¢&WGW&âF†—2ç6VæD6ÆÄÖW76vUFô’†ÖW76vRÂ6öçF7DæÖRÂ6†D†—7F÷'’Âwf–FVòr“°Ğ¢ĞĞ Ğ¢òò	ùJRi‹îzK®ŠúŞ™û>˜	®ŠùŞyXÎ™Ú.ûÈhê^˜	®YîûÈ’ÒzèkHx˜€Ğ¢6†÷ufö–6T6ÆÄ–çFW&f6R†6öçF7BÂ”w&VWF–ærÒrr’°Ğ¢6ÆV$–çFW'fÂ‡F†—2å÷vV6†D6ÆÅF–ÖW"“°Ğ¢òò	ùJRŠë[Ù^˜	®ŠùŞ[ÈZx¾y¨NXš~h8^i{n™{@Ğ¢6öç7BF–ÖTÖævW"Òv–æF÷råf—'GVÅ†öæSòçF–ÖTÖævW#°Ğ¢6öç7B6ÆÅ7F'EF–ÖRÒF†—2å÷6†÷VÆEW6U&VÅF–ÖTf÷$öæÆ–æT6†B‚Ğ¢òF†—2åö'V–ÆEvV6†E&VÅF–ÖTf–VÆG2‚Ğ¢¢‡F–ÖTÖævW Ğ¢òF–ÖTÖævW"ævWD7W'&VçE7F÷'•F–ÖR‚Ğ¢¢²F–ÖS¢s#£3rÂFFS¢s#CN[›CiÈƒ#izRrÒ“°Ğ¢6öç7B6ÆÅ7F'DWö6‚ÒFFRææ÷r‚“°Ğ¢6öç7B—4w&÷W6ÆÂÒ6öçF7CòçG—RÓÓÒvw&÷Ws°Ğ¢6öç7Bw&÷W'F–6—çG2ÒF†—2åövWDw&÷W6†E'F–6—çG2†6öçF7B“°Ğ¢6öç7Bw&÷W'F–6—çG57G&—Ò—4w&÷W6ÆÂòF†—2å÷&VæFW$w&÷W6ÆÅ'F–6—çG57G&—†6öçF7B’¢rs°Ğ¢6öç7B6ÆÄ&u7G–ÆRÒF†—2åövWEvV6†D6ÆÄ&6¶w&÷VæE7G–ÆR†6öçF7B“°Ğ Ğ¢6öç7B‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò&6ÆÂÖgVÆÇ67&VVâ#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ"7G–ÆSÒ"G¶6ÆÄ&u7G–ÆWÒ†V–v‡C¢S²F—7Æ“¢fÆWƒ²fÆW‚ÖF—&V7F–öã¢6öÇVÖã²÷fW&fÆ÷s¢†–FFVã²#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW""7G–ÆSÒ&&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃãB“²&6¶G&÷Öf–ÇFW#¢&ÇW"ƒ#‚“²&÷&FW"Ö&÷GFöÓ¢‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÃã2“²fÆW‚×6‡&–æ³¢²#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"ÖÆVgB#àĞ¢ÂÒÒ™©‰xşy¨N‹ùNY¹îhÈ™*îûÈÎyJK¨îhê^zê[›nhºnhŠ®Xû>k¹h˜¾X«şûÈÎ™‹.jÚ.‹zşyK‹û~ZKy»Nhê^˜Y¹îjÎ™Ú"ÒÓàĞ¢Æ'WGFöâ6Æ73Ò'vV6†BÖ&6²Ö'Fâ"–CÒ&÷fW&Æ’Ö†–FFVâÖ&6²"7G–ÆSÒ&F—7Æ“¦æöæS²#ãÂö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×F—FÆR"7G–ÆSÒ&6öÆ÷#¢3333²#àĞ¢Ç7â6Æ73Ò'vV6†BÖ†VFW"×F—FÆR×FW‡B#âG¶6öçF7BææÖWÒG¶—4w&÷W6ÆÂòsÇ7â7G–ÆSÒ&föçB×6—¦S£ƒ²Ö&v–âÖÆVgC£Gƒ²÷6—G“£ãsƒ²#â{êNŠúŞ™û2“Â÷7ãâr¢rwÓÇ7â6Æ73Ò'7FGW2ÖF÷BF÷BÖw&VVâ"–CÒ'fö–6RÖ6ÆÂ×7FGW2ÖF÷B#ãÂ÷7ããÂ÷7ãàĞ¢ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×&–v‡B#àĞ¢Ç7â–CÒ&6ÆÂ×F–ÖW""7G–ÆSÒ&föçB×6—¦S¢7ƒ²6öÆ÷#¢3ccc²#ã£Â÷7ãàĞ¢ÂöF—càĞ¢ÂöF—càĞ Ğ¢ÆF—b6Æ73Ò'vV6†BÖ6öçFVçB"7G–ÆSÒ&&6¶w&÷VæC¢G&ç7&VçC²F—7Æ“¢fÆWƒ²fÆW‚ÖF—&V7F–öã¢6öÇVÖã²fÆWƒ¢²÷fW&fÆ÷s¢†–FFVã²FF–æs¢²Ö–âÖ†V–v‡C¢²#àĞ Ğ¢ÂÒÒšn˜:ûÉ®ZKNX8şXË®YùòÒÓàĞ¢ÆF—b7G–ÆSÒ'FF–æs¢‡ƒ²FW‡BÖÆ–vã¢6VçFW#²fÆW‚×6‡&–æ³¢²#àĞ¢ÆF—b6Æ73Ò&6ÆÂÖfF"Öf—‚"7G–ÆSÒ Ğ¢v–GFƒ¢Cƒ°Ğ¢†V–v‡C¢Cƒ°Ğ¢&÷&FW"×&F—W3¢SS°Ğ¢&6¶w&÷VæC¢Æ–æV"Öw&F–VçBƒ3VFVrÂ3ccvVVRÂ3scF&"R“°Ğ¢Ö&v–ã¢WFó°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢Æ–vâÖ—FV×3¢6VçFW#°Ğ¢§W7F–g’Ö6öçFVçC¢6VçFW#°Ğ¢föçB×6—¦S¢#ƒ°Ğ¢&÷‚×6†F÷s¢&v&ƒ"Â#bÂ#3BÂãR“°Ğ¢æ–ÖF–öã¢fö–6RÖvÆ÷r'2–æf–æ—FS°Ğ¢÷fW&fÆ÷s¢†–FFVã°Ğ¢#àĞ¢G·F†—2æç&VæFW$fF"†6öçF7BæfF"Â	ùBrÂ6öçF7BææÖR—ĞĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢—ƒ²6öÆ÷#¢&v&ƒÃÃÃãR“²Ö&v–â×F÷¢7ƒ²#âG¶—4w&÷W6ÆÂò~{êNŠúŞ™û>˜	®ŠùŞKŠÒr¢~ŠúŞ™û>˜	®ŠùŞKŠÒwÓÂöF—càĞ¢G¶w&÷W'F–6—çG57G&—ĞĞ¢ÂöF—càĞ Ğ¢ÂÒÒKŠŞ™{NûÉ®ˆ®ZJkhhşXË®YùòÒÓàĞ¢ÆF—b–CÒ'fö–6RÖ6†BÖÖW76vW2"7G–ÆSÒ Ğ¢fÆWƒ¢°Ğ¢÷fW&fÆ÷r×“¢WFó°Ğ¢FF–æs¢‡ƒ°Ğ¢&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃã2“°Ğ¢&6¶G&÷Öf–ÇFW#¢&ÇW"ƒ‚“°Ğ¢Ö&v–ã¢‡ƒ°Ğ¢&÷&FW"×&F—W3¢ƒ°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢fÆW‚ÖF—&V7F–öã¢6öÇVÖã°Ğ¢v¢gƒ°Ğ¢Ö–âÖ†V–v‡C¢°Ğ¢#àĞ¢ÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¢6VçFW#²6öÆ÷#¢&v&ƒÃÃÃãB“²föçB×6—¦S¢ƒ²FF–æs¢7‚²#àĞ¢˜	®ŠùŞKŠŞXúşXù˜ih~ZÙpĞ¢ÂöF—càĞ¢ÂöF—càĞ Ğ¢ÂÒÒ[©^˜:ûÉ®‹é>XZ^jnY(ÎhÈ.ijŞhÈ™*âÒÓàĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃãR“²&6¶G&÷Öf–ÇFW#¢&ÇW"ƒ#‚“²FF–æs¢‡ƒ²fÆW‚×6‡&–æ³¢²#àĞ¢ÂÒÒih~ZÙ~‹é>XZ^ŠÂÒÓàĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²v¢‡ƒ²#àĞ¢Æ–çWBG—SÒ'FW‡B"–CÒ'fö–6RÖ6†BÖ–çWB"Æ6V†öÆFW#Ò.Xù˜khhòâââ"7G–ÆSÒ Ğ¢fÆWƒ¢°Ğ¢Ö–â×v–GFƒ¢°Ğ¢FF–æs¢‡‚‡‚‡‚'ƒ°Ğ¢&÷&FW#¢‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÃã#"“°Ğ¢&÷&FW"×&F—W3¢‡ƒ°Ğ¢&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃã"“°Ğ¢6öÆ÷#¢f"‚Ò×†öæRÖvÆö&Â×FW‡BÂ3“°Ğ¢föçB×6—¦S¢7ƒ°Ğ¢÷WFÆ–æS¢æöæS°Ğ¢×vV&¶—B×W6W"×6VÆV7C¢FW‡C°Ğ¢W6W"×6VÆV7C¢FW‡C°Ğ¢×vV&¶—B×F÷V6‚Ö6ÆÆ÷WC¢FVfVÇC°Ğ¢F÷V6‚Ö7F–öã¢WFó°Ğ¢#àĞ¢Æ'WGFöâ–CÒ'fö–6R×6VæBÖ'Fâ"7G–ÆSÒ Ğ¢v–GFƒ¢3'ƒ°Ğ¢†V–v‡C¢3'ƒ°Ğ¢&6¶w&÷VæC¢G&ç7&VçC°Ğ¢&÷&FW#¢æöæS°Ğ¢6öÆ÷#¢3v3c°Ğ¢föçB×6—¦S¢‡ƒ°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢Æ–vâÖ—FV×3¢6VçFW#°Ğ¢§W7F–g’Ö6öçFVçC¢6VçFW#°Ğ¢fÆW‚×6‡&–æ³¢°Ğ¢#àĞ¢Æ’6Æ73Ò&f×6öÆ–Bf×W"×ÆæR#ãÂö“àĞ¢Âö'WGFöãàĞ¢Æ'WGFöâ–CÒ'fö–6RÖ†æwWÖ'Fâ"7G–ÆSÒ Ğ¢v–GFƒ¢3'ƒ°Ğ¢†V–v‡C¢3'ƒ°Ğ¢&6¶w&÷VæC¢G&ç7&VçC°Ğ¢&÷&FW#¢æöæS°Ğ¢6öÆ÷#¢6fc6#3°Ğ¢föçB×6—¦S¢‡ƒ°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢fÆW‚×6‡&–æ³¢°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢Æ–vâÖ—FV×3¢6VçFW#°Ğ¢§W7F–g’Ö6öçFVçC¢6VçFW#°Ğ¢#àĞ¢Æ’6Æ73Ò&f×6öÆ–Bf×†öæR×6Æ6‚#ãÂö“àĞ¢Âö'WGFöãàĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ Ğ¢Ç7G–ÆSàĞ¢¶W–g&ÖW2fö–6RÖvÆ÷r°Ğ¢RÂR²&÷‚×6†F÷s¢&v&ƒ"Â#bÂ#3BÂãR“²ĞĞ¢SR²&÷‚×6†F÷s¢‡‚&v&ƒ"Â#bÂ#3BÂ“²ĞĞ¢ĞĞ¢æ6ÆÂÖfF"Öf—‚–Ör°Ğ¢v–GFƒ¢R–×÷'FçC°Ğ¢†V–v‡C¢R–×÷'FçC°Ğ¢Ö&v–ã¢–×÷'FçC°Ğ¢&÷&FW"×&F—W3¢SR–×÷'FçC°Ğ¢ĞĞ¢æ6ÆÂÖfF"Öf—‚F—b°Ğ¢&÷&FW"×&F—W3¢SR–×÷'FçC°Ğ¢ĞĞ¢7fö–6RÖ6†BÖ–çWB°Ğ¢&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃã"’–×÷'FçC°Ğ¢6öÆ÷#¢f"‚Ò×†öæRÖvÆö&Â×FW‡BÂ3’–×÷'FçC°Ğ¢×vV&¶—B×FW‡BÖf–ÆÂÖ6öÆ÷#¢f"‚Ò×†öæRÖvÆö&Â×FW‡BÂ3’–×÷'FçC°Ğ¢6&WBÖ6öÆ÷#¢f"‚Ò×†öæRÖvÆö&Â×FW‡BÂ3’–×÷'FçC°Ğ¢&÷&FW#¢‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÃã#"’–×÷'FçC°Ğ¢&÷‚×6†F÷s¢–ç6WB‚&v&ƒ#SRÃ#SRÃ#SRÃã"’–×÷'FçC°Ğ¢f–ÇFW#¢æöæR–×÷'FçC°Ğ¢÷6—G“¢–×÷'FçC°Ğ¢ĞĞ¢7fö–6RÖ6†BÖ–çWC£§Æ6V†öÆFW"°Ğ¢6öÆ÷#¢f"‚Ò×†öæRÖvÆö&Â×FW‡BÂ3’–×÷'FçC°Ğ¢×vV&¶—B×FW‡BÖf–ÆÂÖ6öÆ÷#¢f"‚Ò×†öæRÖvÆö&Â×FW‡BÂ3’–×÷'FçC°Ğ¢÷6—G“¢ãR–×÷'FçC°Ğ¢ĞĞ¢Â÷7G–ÆSàĞ¢°Ğ Ğ¢F†—2æç†öæU6†VÆÂç6WD6öçFVçB†‡FÖÂÂwvV6†BÖ6ÆÂÖ÷fW&Æ’r“°Ğ¢òòhºnhŠ®Xû>k¹‹ùNY¹îh˜¾X«şûÈÎ[nX[nzØYÎK¨îx+X{¾hÈ.ijÒşXùnkh‚şh¹.{¹ŞhÈ™*àĞ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v÷fW&Æ’Ö†–FFVâÖ&6²r“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7B6æ6VÄ'FâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6æ6VÂÖ6ÆÂÖ'Fâr’ÇÂ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wf–FVòÖ†æwWÖ'Fâr’ÇÂ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6RÖ†æwWÖ'Fâr’ÇÂ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v–æ6öÖ–ærÖ6ÆÂ×&V¦V7BÖ'Fâr“°Ğ¢–b†6æ6VÄ'Fâ’6æ6VÄ'Fâæ6Æ–6²‚“°Ğ¢VÇ6RF†—2æç&VæFW"‚“°Ğ¢Ò“°Ğ Ğ¢6öç7B6WEfö–6T6ÆÅ7FGW2Ò†6öÆ÷"Òvw&VVâr’Óâ°Ğ¢6öç7BF÷BÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6RÖ6ÆÂ×7FGW2ÖF÷Br“°Ğ¢–b‚F÷B’&WGW&ã°Ğ¢F÷Bæ6Æ74Æ—7Bç&VÖ÷fR‚vF÷BÖw&VVârÂvF÷B×–VÆÆ÷rrÂvF÷B×&VBr“°Ğ¢–b†6öÆ÷"ÓÓÒw&VBr’°Ğ¢F÷Bæ6Æ74Æ—7BæFB‚vF÷B×&VBr“°Ğ¢&WGW&ã°Ğ¢ĞĞ¢–b†6öÆ÷"ÓÓÒw–VÆÆ÷rr’°Ğ¢F÷Bæ6Æ74Æ—7BæFB‚vF÷B×–VÆÆ÷rr“°Ğ¢&WGW&ã°Ğ¢ĞĞ¢F÷Bæ6Æ74Æ—7BæFB‚vF÷BÖw&VVâr“°Ğ¢Ó°Ğ Ğ¢6öç7BvWEfö–6T–çWBÒ‚’ÓâFö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6RÖ6†BÖ–çWBr“°Ğ¢6öç7B†&FVåfö–6T–çWE7G–ÆRÒ‚’Óâ°Ğ¢6öç7B–çWBÒvWEfö–6T–çWB‚“°Ğ¢–b‚–çWCòç7G–ÆSòç6WE&÷W'G’’&WGW&ã°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚v&6¶w&÷VæBrÂw&v&ƒ#SRÃ#SRÃ#SRÃã"’rÂv–×÷'FçBr“°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚v&6¶w&÷VæBÖ6öÆ÷"rÂw&v&ƒ#SRÃ#SRÃ#SRÃã"’rÂv–×÷'FçBr“°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚v6öÆ÷"rÂwf"‚Ò×†öæRÖvÆö&Â×FW‡BÂ3’rÂv–×÷'FçBr“°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚r×vV&¶—B×FW‡BÖf–ÆÂÖ6öÆ÷"rÂwf"‚Ò×†öæRÖvÆö&Â×FW‡BÂ3’rÂv–×÷'FçBr“°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚v6&WBÖ6öÆ÷"rÂwf"‚Ò×†öæRÖvÆö&Â×FW‡BÂ3’rÂv–×÷'FçBr“°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚v&÷&FW"rÂs‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÃã#"’rÂv–×÷'FçBr“°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚v&÷‚×6†F÷rrÂv–ç6WB‚&v&ƒ#SRÃ#SRÃ#SRÃã"’rÂv–×÷'FçBr“°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚v÷WFÆ–æRrÂvæöæRrÂv–×÷'FçBr“°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚vV&æ6RrÂvæöæRrÂv–×÷'FçBr“°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚r×vV&¶—BÖV&æ6RrÂvæöæRrÂv–×÷'FçBr“°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚vf–ÇFW"rÂvæöæRrÂv–×÷'FçBr“°Ğ¢–çWBç7G–ÆRç6WE&÷W'G’‚v÷6—G’rÂsrÂv–×÷'FçBr“°Ğ¢Ó°Ğ¢†&FVåfö–6T–çWE7G–ÆR‚“°Ğ¢òòiùK©¾K‹¾š)KÉ®YÊKˆ¾KˆKŠ®k‹.iù>[Š~K¨ÎjÊŠhny¹b–çWBj~[ÈşûÈÎ‹ù˜xÎXhŞŠ^Kˆ[Š~Y(Î[»ni{nXYÎ[©PĞ¢&WVW7Dæ–ÖF–öäg&ÖR‚‚’Óâ†&FVåfö–6T–çWE7G–ÆR‚’“°Ğ¢6WEF–ÖV÷WB‚‚’Óâ†&FVåfö–6T–çWE7G–ÆR‚’Âƒ“°Ğ¢6öç7BvWEfö–6TÖW76vW2Ò‚’ÓâFö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6RÖ6†BÖÖW76vW2r“°Ğ Ğ¢ÆWBfö–6T&F6…F–ÖW"ÒçVÆÃ°Ğ¢ÆWBfö–6UVæF–æuW6W$Æ–æW2ÒµÓ°Ğ¢ÆWB—5fö–6U6VæF–ærÒfÇ6S°Ğ Ğ¢6öç7B6ÆV%fö–6T&F6…F–ÖW"Ò‚’Óâ°Ğ¢6ÆV%F–ÖV÷WB‡fö–6T&F6…F–ÖW"“°Ğ¢fö–6T&F6…F–ÖW"ÒçVÆÃ°Ğ¢Ó°Ğ Ğ¢6öç7B&W7F'Efö–6UVæF–æuF–ÖW$–dæVVFVBÒ‚’Óâ°Ğ¢–b†6ÆÄVæFVB’&WGW&ã°Ğ¢6öç7B–çWBÒvWEfö–6T–çWB‚“°Ğ¢6öç7BFW‡BÒ7G&–ær†–çWCòçfÇVRÇÂrr’çG&–Ò‚“°Ğ¢6öç7B—4VF—F–ærÒ–çWBbbFö7VÖVçBæ7F—fTVÆVÖVçBÓÓÒ–çWC°Ğ¢6öç7B6å&W7F'BÒ—4VF—F–ærbbFW‡BÓÓÒrrbbfö–6UVæF–æuW6W$Æ–æW2æÆVæwF‚âbb—5fö–6U6VæF–æs°Ğ¢–b‚6å&W7F'B’°Ğ¢–b†—4VF—F–ærbb—5fö–6U6VæF–ær’°Ğ¢6WEfö–6T6ÆÅ7FGW2‚vw&VVâr“°Ğ¢ĞĞ¢&WGW&ã°Ğ¢ĞĞ¢6ÆV%fö–6T&F6…F–ÖW"‚“°Ğ¢fö–6T&F6…F–ÖW"Ò6WEF–ÖV÷WB‚‚’Óâ°Ğ¢G&–vvW%fö–6T’‚“°Ğ¢ÒÂc“°Ğ¢6WEfö–6T6ÆÅ7FGW2‚w–VÆÆ÷rr“°Ğ¢Ó°Ğ Ğ¢6öç7BvWEfö–6T6ÆÅG—–ætFVÆ’Ò†Æ–æR’Óâ°Ğ¢6öç7BÆVæwF‚Ò7G&–ær†Æ–æRÇÂrr’çG&–Ò‚’æÆVæwFƒ°Ğ¢&WGW&âÖF‚æÖ–âƒ#Â3c²ÆVæwF‚¢C“°Ğ¢Ó°Ğ Ğ¢ÆWB6ÆÄVæFVBÒfÇ6S°Ğ¢6öç7B6ÆÄ6†D–BÒ6öçF7Bæ–C°Ğ¢6öç7B6ÆÄÖW76vW4VÆVÖVçBÒvWEfö–6TÖW76vW2‚“°Ğ¢6öç7Bf–æ—6„6ÆÂÒ†VæFVD'’’Óâ°Ğ¢–b†6ÆÄVæFVBÇÂ6ÆÄÖW76vW4VÆVÖVçCòæ—46öææV7FVB’&WGW&ã°Ğ¢6ÆÄVæFVBÒG'VS°Ğ¢F†—2ç7F÷vV6†D6ÆÅEE2‚“°Ğ¢6ÆV$–çFW'fÂ†6ÆÅF–ÖW"“°Ğ¢6ÆV%fö–6T&F6…F–ÖW"‚“°Ğ¢fö–6UVæF–æuW6W$Æ–æW2ÒµÓ°Ğ¢—5fö–6U6VæF–ærÒfÇ6S°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6R×G—–ærÖ–æF–6F÷"r“òç&VÖ÷fR‚“°Ğ¢6†DÖW76vW2çW6‚‡°Ğ¢g&öÓ¢VæFVD'’ÓÓÒwW6W"ròvÖRr¢6öçF7BææÖRÀĞ¢FW‡C¢VæFVD'’ÓÓÒwW6W"rò~[{.hÈ.ijŞûÈyJh‹~K‹¾XªhÈ.ijŞûÈ’r¢~[{.hÈ.ijŞûÈŠy.ˆ›.K‹¾XªhÈ.ijŞûÈ’rÀĞ¢G—S¢v6ÆÅö†æwWrÂVæFVD'Ğ¢Ò“°Ğ¢6öç7BVffV7F—fTGW&F–öå6V2ÒÖF‚æÖ‚†6ÆÄGW&F–öâÂÖF‚æfÆö÷"‚„FFRææ÷r‚’Ò6ÆÅ7F'DWö6‚’ò’“°Ğ¢6öç7BGW&F–öåFW‡BÒG´ÖF‚æfÆö÷"†VffV7F—fTGW&F–öå6V2òc—ŞXˆbG¶VffV7F—fTGW&F–öå6V2RcŞzy&°Ğ¢F†—2æFD6ÆÅ&V6÷&B‚wfö–6RrÂvç7vW&VBrÂGW&F–öåFW‡BÂ°Ğ¢6†D–C¢6ÆÄ6†D–BÂ6ÆÅ7F'EF–ÖRÂVÆ6VE6V6öæG3¢VffV7F—fTGW&F–öå6V2ÀĞ¢VæFVD'’ÂG&ç67&—C¢6†DÖW76vW2æf–ÇFW"†ÒÓâÒæ—4FVÆWFVB’æÖ†ÒÓâ‡²ââæÒÒ’Ğ¢Ò“°Ğ¢6ÆÄÖW76vW4VÆVÖVçBæ–ç6W'DF¦6VçD…DÔÂ‚v&Vf÷&VVæBrÂsÆF—b6Æ73Ò'vV6†BÖ6ÆÂÖVæFVB"7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW#²6öÆ÷#¢3ƒƒƒ²föçB×6—¦S£'ƒ²FF–æs£‚²fÆW‚×6‡&–æ³£²#î[{.hÈ.ijÓÂöF—câr“°Ğ¢6ÆÄÖW76vW4VÆVÖVçBç67&öÆÅF÷Ò6ÆÄÖW76vW4VÆVÖVçBç67&öÆÄ†V–v‡C°Ğ¢6öç7B–çWBÒvWEfö–6T–çWB‚“°Ğ¢–b†–çWB’²–çWBæF—6&ÆVBÒG'VS²–çWBçÆ6V†öÆFW"Ò~˜	®ŠùŞ[{.{¹>iÙòs²ĞĞ¢6öç7B6VæD'WGFöâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6R×6VæBÖ'Fâr“°Ğ¢–b‡6VæD'WGFöâ’6VæD'WGFöâæF—6&ÆVBÒG'VS°Ğ¢6WEfö–6T6ÆÅ7FGW2‚w&VBr“°Ğ¢6öç7B†æwW'WGFöâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6RÖ†æwWÖ'Fâr“°Ğ¢–b††æwW'WGFöâ’²†æwW'WGFöâçF—FÆRÒ~‹ùNY¹îˆ®ZJ’s²†æwW'WGFöâç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂ~‹ùNY¹îˆ®ZJ’r“²ĞĞ¢Ó°Ğ Ğ¢6öç7B&VæFW%fö–6T”Æ–æW56WVVçF–ÆÇ’Ò7–æ2†Æ–æW2Â&÷VæD–B’Óâ°Ğ¢6öç7B'V&&ÆTÖWF2ÒµÓ°Ğ¢6öç7B&VæFW$Æ–æW2Ò'&’æ—4'&’†Æ–æW2’òÆ–æW2¢µÓ°Ğ Ğ¢f÷"†ÆWB’Ò²’Â&VæFW$Æ–æW2æÆVæwFƒ²’²²’°Ğ¢6öç7BÖW76vW4F—bÒvWEfö–6TÖW76vW2‚“°Ğ¢–b‚ÖW76vW4F—b’'&V³°Ğ Ğ¢6öç7BVçG'’ÒG—Vöb&VæFW$Æ–æW5¶•ÒÓÓÒw7G&–ærpĞ¢ò²6VæFW#¢6öçF7BææÖRÂFW‡C¢7G&–ær‡&VæFW$Æ–æW5¶•ÒÇÂrr’çG&–Ò‚’ĞĞ¢¢°Ğ¢6VæFW#¢7G&–ær‡&VæFW$Æ–æW5¶•Óòç6VæFW"ÇÂ6öçF7BææÖR’çG&–Ò‚’ÇÂ6öçF7BææÖRÀĞ¢FW‡C¢7G&–ær‡&VæFW$Æ–æW5¶•ÓòçFW‡BÇÂrr’çG&–Ò‚Ğ¢Ó°Ğ¢–b†6ÆÄVæFVBÇÂ6ÆÄÖW76vW4VÆVÖVçCòæ—46öææV7FVB’'&V³°Ğ¢–b‚VçG'’çFW‡B’6öçF–çVS°Ğ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6R×G—–ærÖ–æF–6F÷"r“òç&VÖ÷fR‚“°Ğ¢6öç7BG—–æt‡FÖÂÒ Ğ¢ÆF—b–CÒ'fö–6R×G—–ærÖ–æF–6F÷""7G–ÆSÒ&F—7Æ“¢fÆWƒ²§W7F–g’Ö6öçFVçC¢fÆW‚×7F'C²#àĞ¢ÆF—b7G–ÆSÒ'FF–æs¢g‚ƒ²&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃãb“²6öÆ÷#¢&v&ƒÃÃÃãR“²&÷&FW"×&F—W3¢ƒ²föçB×6—¦S¢ƒ²#îZûikjÚ>YÊŠûNŠùÒââãÂöF—càĞ¢ÂöF—càĞ¢°Ğ¢ÖW76vW4F—bæ–ç6W'DF¦6VçD…DÔÂ‚v&Vf÷&VVæBrÂG—–æt‡FÖÂ“°Ğ¢ÖW76vW4F—bç67&öÆÅF÷ÒÖW76vW4F—bç67&öÆÄ†V–v‡C°Ğ Ğ¢v—BæWr&öÖ—6R‡&W6öÇfRÓâ6WEF–ÖV÷WB‡&W6öÇfRÂvWEfö–6T6ÆÅG—–ætFVÆ’†VçG'’çFW‡B’’“°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6R×G—–ærÖ–æF–6F÷"r“òç&VÖ÷fR‚“°Ğ¢–b†6ÆÄVæFVBÇÂ6ÆÄÖW76vW4VÆVÖVçCòæ—46öææV7FVB’'&V³°Ğ Ğ¢6öç7B'V&&ÆT–BÒwvV6†BÖ6ÆÂÖ’Ö×6rÒr²ÖF‚ç&æFöÒ‚’çFõ7G&–ærƒ3b’ç6Æ–6Rƒ"Â‚“°Ğ¢6öç7B6VæFW$Æ&VÄ‡FÖÂÒ—4w&÷W6ÆÀĞ¢òÆF—b6Æ73Ò&6ÆÂÖ×6r×6VæFW"ÖÆ&VÂ"7G–ÆSÒ&föçB×6—¦S£ƒ²6öÆ÷#§&v&ƒÃÃÃãC‚“²Ö&v–ã£G‚'ƒ²#âG·F†—2åöW66T‡FÖÂ†VçG'’ç6VæFW"—ÓÂöF—cæ Ğ¢¢rs°Ğ¢6öç7B”×6t‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò&6ÆÂÖ×6r×&÷r"7G–ÆSÒ&F—7Æ“¢fÆWƒ²§W7F–g’Ö6öçFVçC¢fÆW‚×7F'C²#àĞ¢ÆF—b7G–ÆSÒ&Ö‚×v–GFƒ¢ƒS²F—7Æ“¦fÆWƒ²fÆW‚ÖF—&V7F–öã¦6öÇVÖã²Æ–vâÖ—FV×3¦fÆW‚×7F'C²#àĞ¢G·6VæFW$Æ&VÄ‡FÖÇĞĞ¢G·F†—2å÷&VæFW%vV6†D6ÆÄ”'V&&ÆTÖ&·W‡°Ğ¢FW‡C¢VçG'’çFW‡BÀĞ¢'V&&ÆT–BÀĞ¢ÖW76vT–æFWƒ¢6†DÖW76vW2æÆVæwF‚ÀĞ¢6ÆÅG—S¢wfö–6RrÀĞ¢&÷VæD–BÀĞ¢6VæFW#¢VçG'’ç6VæFW Ğ¢Ò—ĞĞ¢ÂöF—càĞ¢ÂöF—càĞ¢°Ğ¢ÖW76vW4F—bæ–ç6W'DF¦6VçD…DÔÂ‚v&Vf÷&VVæBrÂ”×6t‡FÖÂ“°Ğ¢6†DÖW76vW2çW6‚‡²g&öÓ¢VçG'’ç6VæFW"ÂFW‡C¢VçG'’çFW‡BÒ“°Ğ¢'V&&ÆTÖWF2çW6‚‡²–C¢'V&&ÆT–BÂ6VæFW#¢VçG'’ç6VæFW"ÂFW‡C¢VçG'’çFW‡BÒ“°Ğ¢ÖW76vW4F—bç67&öÆÅF÷ÒÖW76vW4F—bç67&öÆÄ†V–v‡C°Ğ¢ĞĞ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6R×G—–ærÖ–æF–6F÷"r“òç&VÖ÷fR‚“°Ğ¢&WGW&â'V&&ÆTÖWF3°Ğ¢Ó°Ğ Ğ¢òòŠêi{nYš€Ğ¢ÆWB6ÆÄGW&F–öâÒ°Ğ¢6öç7B6ÆÅF–ÖW"Ò7F'D6ÆÅF–ÖW"†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6ÆÂ×F–ÖW"r’Â6V6öæG2Óâ°Ğ¢6ÆÄGW&F–öâÒ6V6öæG3°Ğ¢Ò“°Ğ¢F†—2å÷vV6†D6ÆÅF–ÖW"Ò6ÆÅF–ÖW#°Ğ Ğ¢òòˆ®ZJkhhşŠë[ÙPĞ¢6öç7B6†DÖW76vW2ÒµÓ°Ğ¢òò	ùJRkøkK¾ŠúŞ™û>˜	®ŠùŞy¨N™[şhÈˆùÎXÙPĞ¢6öç7Bfö–6T6ÆÄÖW76vW2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6RÖ6†BÖÖW76vW2r“°Ğ¢F†—2æ&–æD6ÆÄÖW76vTÆöæu&W74WfVçG2‡fö–6T6ÆÄÖW76vW2Â6†DÖW76vW2“°Ğ¢F†—2æ&–æD–ææW%F†÷Vv‡DWfVçG2‡fö–6T6ÆÄÖW76vW2“°Ğ Ğ¢òò	ùJRZh.iéÎiÈ”[ÈYË®y›ŞûÈÎi‹îzK®ûÈiJşhÈZI®iÚkhhşûÈĞ¢–b†”w&VWF–ærbb”w&VWF–ærçG&–Ò‚’’°Ğ¢6öç7BÖW76vW4F—bÒvWEfö–6TÖW76vW2‚“°Ğ¢–b†ÖW76vW4F—b’°Ğ¢ÆWB6ÆVæVDw&VWF–ærÒ”w&VWF–ærçG&–Ò‚“°Ğ¢6ÆVæVDw&VWF–ærÒ6ÆVæVDw&VWF–ærç&WÆ6R‚õÅ¾[êîKúÅÕµã®ûÉ¥Ò¥¾ûÉ£¥ÕÇ2¢örÂrr“°Ğ¢6ÆVæVDw&VWF–ærÒ6ÆVæVDw&VWF–ærç&WÆ6R‚õæg&öÕÇ2µÅ2µ¾ûÉ£¥ÕÇ2¢övÖ’Ârr“°Ğ Ğ¢6öç7Bw&VWF–æt†æwWÒ'6T6ÆÄ†æwW&WÇ’†6ÆVæVDw&VWF–ær“°Ğ¢6öç7B×6tÆ–æW2ÒF†—2å÷'6T6ÆÅ&WÇ”VçG&–W2†w&VWF–æt†æwWçFW‡BÂ°Ğ¢6öçF7DæÖS¢6öçF7BææÖRÀĞ¢'F–6—çG3¢—4w&÷W6ÆÂòw&÷W'F–6—çG2¢µÒÀĞ¢w&÷WæÖS¢6öçF7BææÖRÀĞ¢—4w&÷W6ÆÀĞ¢Ò“°Ğ¢6öç7B&÷VæD–BÒw&÷VæEöw&VWF–æuòr²FFRææ÷r‚“°Ğ¢†7–æ2‚’Óâ°Ğ¢6öç7B'V&&ÆTÖWF2Òv—B&VæFW%fö–6T”Æ–æW56WVVçF–ÆÇ’†×6tÆ–æW2Â&÷VæD–B“°Ğ¢–b†6ÆÄVæFVBÇÂ6ÆÄÖW76vW4VÆVÖVçCòæ—46öææV7FVB’&WGW&ã°Ğ¢F†—2æ&–æD6ÆÄ'V&&ÆT6Æ–6´WfVçG2†ÖW76vW4F—b“°Ğ¢6öç7BWFõEE2Òv–æF÷råf—'GVÅ†öæSòç7F÷&vSòævWB‚wvV6†BÖ6ÆÂÖWFò×GG2r“°Ğ¢F†—2æ7W'&VçEGG5&÷VæBÒ&÷VæD–C°Ğ¢–b†WFõEE2’°Ğ¢f÷"†ÆWB’Ò²’Â'V&&ÆTÖWF2æÆVæwFƒ²’²²’°Ğ¢–b‡F†—2æ7W'&VçEGG5&÷VæBÓÒ&÷VæD–B’'&V³°Ğ¢6öç7B'V&&ÆRÒFö7VÖVçBævWDVÆVÖVçD'”–B†'V&&ÆTÖWF5¶•Òæ–B“°Ğ¢v—BF†—2çÆ•vV6†D6ÆÅEE2†'V&&ÆTÖWF5¶•ÒçFW‡BÂ'V&&ÆR“°Ğ¢ĞĞ¢ĞĞ¢–b†w&VWF–æt†æwWæVæFVB’f–æ—6„6ÆÂ‚v6†&7FW"r“°Ğ¢Ò’‚“°Ğ¢ĞĞ¢ĞĞ Ğ¢6öç7BG&–vvW%fö–6T’Ò7–æ2‚’Óâ°Ğ¢–b†6ÆÄVæFVBÇÂ6ÆÄÖW76vW4VÆVÖVçCòæ—46öææV7FVBÇÂ—5fö–6U6VæF–ærÇÂfö–6UVæF–æuW6W$Æ–æW2æÆVæwF‚ÓÓÒ’&WGW&ã°Ğ Ğ¢–b‚F†—2æ—4öæÆ–æTÖöFR‚’’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~zk¾{«şjŠ[ÈòrÂ~Šû~YÊŠëî{ÚîKŠŞ[ÈY
şYÊ{«şjŠ[ÈòrÂ~)ªûˆòr“°Ğ¢6ÆV%fö–6T&F6…F–ÖW"‚“°Ğ¢6WEfö–6T6ÆÅ7FGW2‚vw&VVâr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6öç7BÖW76vW4F—bÒvWEfö–6TÖW76vW2‚“°Ğ¢–b‚ÖW76vW4F—b’&WGW&ã°Ğ Ğ¢—5fö–6U6VæF–ærÒG'VS°Ğ¢6ÆV%fö–6T&F6…F–ÖW"‚“°Ğ¢6WEfö–6T6ÆÅ7FGW2‚w&VBr“°Ğ Ğ¢6öç7BÖW76vUFõ6VæBÒfö–6UVæF–æuW6W$Æ–æW2æ¦ö–â‚uÆâr“°Ğ¢fö–6UVæF–æuW6W$Æ–æW2ÒµÓ°Ğ Ğ¢G'’°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6R×G—–ærÖ–æF–6F÷"r“òç&VÖ÷fR‚“°Ğ¢6öç7BG—–æt‡FÖÂÒ Ğ¢ÆF—b–CÒ'fö–6R×G—–ærÖ–æF–6F÷""7G–ÆSÒ&F—7Æ“¢fÆWƒ²§W7F–g’Ö6öçFVçC¢fÆW‚×7F'C²#àĞ¢ÆF—b7G–ÆSÒ'FF–æs¢g‚ƒ²&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃãb“²6öÆ÷#¢&v&ƒÃÃÃãR“²&÷&FW"×&F—W3¢ƒ²föçB×6—¦S¢ƒ²#îZûikjÚ>YÊŠûNŠùÒââãÂöF—càĞ¢ÂöF—càĞ¢°Ğ¢ÖW76vW4F—bæ–ç6W'DF¦6VçD…DÔÂ‚v&Vf÷&VVæBrÂG—–æt‡FÖÂ“°Ğ¢ÖW76vW4F—bç67&öÆÅF÷ÒÖW76vW4F—bç67&öÆÄ†V–v‡C°Ğ Ğ¢6öç7B•&WÇ’Òv—BF†—2ç6VæD6ÆÄÖW76vUFô’†ÖW76vUFõ6VæBÂ6öçF7BææÖRÂ6†DÖW76vW2Âwfö–6Rr“°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6R×G—–ærÖ–æF–6F÷"r“òç&VÖ÷fR‚“°Ğ Ğ¢–b†6ÆÄVæFVBÇÂ6ÆÄÖW76vW4VÆVÖVçCòæ—46öææV7FVB’&WGW&ã°Ğ¢6öç7B†æwW&WÇ’Ò'6T6ÆÄ†æwW&WÇ’†•&WÇ’“°Ğ¢6öç7B&÷VæD–BÒw&÷VæEòr²FFRææ÷r‚“°Ğ¢6öç7B”VçG&–W2ÒF†—2å÷'6T6ÆÅ&WÇ”VçG&–W2††æwW&WÇ’çFW‡BÂ°Ğ¢6öçF7DæÖS¢6öçF7BææÖRÀĞ¢'F–6—çG3¢—4w&÷W6ÆÂòw&÷W'F–6—çG2¢µÒÀĞ¢w&÷WæÖS¢6öçF7BææÖRÀĞ¢—4w&÷W6ÆÀĞ¢Ò“°Ğ¢6öç7B&VæFW$Æ–æW2Ò”VçG&–W2æÆVæwF‚âò”VçG&–W2¢††æwW&WÇ’æVæFVBòµÒ¢·²6VæFW#¢6öçF7BææÖRÂFW‡C¢rââârÕÒ“°Ğ¢6öç7B'V&&ÆTÖWF2Òv—B&VæFW%fö–6T”Æ–æW56WVVçF–ÆÇ’‡&VæFW$Æ–æW2Â&÷VæD–B“°Ğ¢–b†6ÆÄVæFVBÇÂ6ÆÄÖW76vW4VÆVÖVçCòæ—46öææV7FVB’&WGW&ã°Ğ Ğ¢F†—2æ&–æD6ÆÄ'V&&ÆT6Æ–6´WfVçG2†ÖW76vW4F—b“°Ğ¢6öç7BWFõEE2Òv–æF÷råf—'GVÅ†öæSòç7F÷&vSòævWB‚wvV6†BÖ6ÆÂÖWFò×GG2r“°Ğ¢F†—2æ7W'&VçEGG5&÷VæBÒ&÷VæD–C°Ğ¢–b†WFõEE2’°Ğ¢f÷"†ÆWB’Ò²’Â'V&&ÆTÖWF2æÆVæwFƒ²’²²’°Ğ¢–b‡F†—2æ7W'&VçEGG5&÷VæBÓÒ&÷VæD–B’'&V³°Ğ¢6öç7B'V&&ÆRÒFö7VÖVçBævWDVÆVÖVçD'”–B†'V&&ÆTÖWF5¶•Òæ–B“°Ğ¢v—BF†—2çÆ•vV6†D6ÆÅEE2†'V&&ÆTÖWF5¶•ÒçFW‡BÂ'V&&ÆR“°Ğ¢ĞĞ¢ĞĞ¢–b††æwW&WÇ’æVæFVB’f–æ—6„6ÆÂ‚v6†&7FW"r“°Ğ¢Ò6F6‚†W'&÷"’°Ğ¢6öç6öÆRæW'&÷"‚~)ØÂŠúŞ™û>˜	®ŠùŞkhhşXù˜ZK‹JS¢rÂW'&÷"“°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6R×G—–ærÖ–æF–6F÷"r“òç&VÖ÷fR‚“°Ğ¢Òf–æÆÇ’°Ğ¢—5fö–6U6VæF–ærÒfÇ6S°Ğ¢–b‡fö–6UVæF–æuW6W$Æ–æW2æÆVæwF‚â’°Ğ¢&W7F'Efö–6UVæF–æuF–ÖW$–dæVVFVB‚“°Ğ¢ÒVÇ6R–b‚6ÆÄVæFVB’°Ğ¢6WEfö–6T6ÆÅ7FGW2‚vw&VVâr“°Ğ¢ĞĞ¢ĞĞ¢Ó°Ğ Ğ¢òòXù˜khhşûÈZHŞX‹¾[êîKúˆ®ZJy¨N(	Î‹ùîXùzØ[è^(	Ş˜¾‹éûÈĞ¢6öç7B6VæDÖW76vRÒ7–æ2‚’Óâ°Ğ¢–b†6ÆÄVæFVBÇÂ6ÆÄÖW76vW4VÆVÖVçCòæ—46öææV7FVB’&WGW&ã°Ğ¢F†—2ç7F÷vV6†D6ÆÅEE2‚“°Ğ¢6öç7B–çWBÒvWEfö–6T–çWB‚“°Ğ¢6öç7BÖW76vW4F—bÒvWEfö–6TÖW76vW2‚“°Ğ¢–b‚–çWBÇÂÖW76vW4F—b’&WGW&ã°Ğ Ğ¢6öç7BFW‡BÒ–çWBçfÇVRçG&–Ò‚“°Ğ¢–b‡FW‡B’°Ğ¢6öç7B×”×6t‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò&6ÆÂÖ×6r×&÷r"7G–ÆSÒ&F—7Æ“¢fÆWƒ²§W7F–g’Ö6öçFVçC¢fÆW‚ÖVæC²#àĞ¢ÆF—b6Æ73Ò&6ÆÂÖ×6rÖ'V&&ÆR"FFÖ×6rÖ–GƒÒ"G¶6†DÖW76vW2æÆVæwF‡Ò"7G–ÆSÒ&Ö‚×v–GFƒ¢sRS²FF–æs¢‡‚'ƒ²&6¶w&÷VæC¢3“VV3c“²6öÆ÷#¢3²&÷&FW"×&F—W3¢'ƒ²föçB×6—¦S¢7ƒ²÷6—F–öã¢&VÆF—fS²#âG·FW‡GÓÂöF—càĞ¢ÂöF—càĞ¢°Ğ¢ÖW76vW4F—bæ–ç6W'DF¦6VçD…DÔÂ‚v&Vf÷&VVæBrÂ×”×6t‡FÖÂ“°Ğ¢ÖW76vW4F—bç67&öÆÅF÷ÒÖW76vW4F—bç67&öÆÄ†V–v‡C°Ğ Ğ¢6†DÖW76vW2çW6‚‡²g&öÓ¢vÖRrÂFW‡C¢FW‡BÒ“°Ğ¢fö–6UVæF–æuW6W$Æ–æW2çW6‚‡FW‡B“°Ğ¢–çWBçfÇVRÒrs°Ğ Ğ¢–b†Fö7VÖVçBæ7F—fTVÆVÖVçBÓÓÒ–çWB’°Ğ¢6ÆV%fö–6T&F6…F–ÖW"‚“°Ğ¢6WEfö–6T6ÆÅ7FGW2‚vw&VVâr“°Ğ¢ÒVÇ6R°Ğ¢&W7F'Efö–6UVæF–æuF–ÖW$–dæVVFVB‚“°Ğ¢ĞĞ¢&WGW&ã°Ğ¢ĞĞ Ğ¢–b‡fö–6UVæF–æuW6W$Æ–æW2æÆVæwF‚â’°Ğ¢v—BG&–vvW%fö–6T’‚“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6öç7B&V6VçEW6W$Æ–æW2Ò6†DÖW76vW0Ğ¢æf–ÇFW"†ÒÓâÒæg&öÒÓÓÒvÖRrĞ¢ç6Æ–6R‚ÓRĞ¢æÖ†ÒÓâÒçFW‡BĞ¢æf–ÇFW"„&ööÆVâ“°Ğ¢–b‡&V6VçEW6W$Æ–æW2æÆVæwF‚â’°Ğ¢fö–6UVæF–æuW6W$Æ–æW2Ò&V6VçEW6W$Æ–æW3°Ğ¢v—BG&–vvW%fö–6T’‚“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~Šû~XX‹é>XZ^Xh^Zë’rÂ~)ªûˆòr“°Ğ¢Ó°Ğ Ğ¢6öç7Bfö–6T–çWBÒvWEfö–6T–çWB‚“°Ğ¢6öç7Bfö–6U6VæD'FâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6R×6VæBÖ'Fâr“°Ğ Ğ¢fö–6T–çWCòæFDWfVçDÆ—7FVæW"‚vfö7W2rÂ‚’Óâ°Ğ¢6ÆV%fö–6T&F6…F–ÖW"‚“°Ğ¢6WEfö–6T6ÆÅ7FGW2‚vw&VVâr“°Ğ¢Ò“°Ğ Ğ¢fö–6T–çWCòæFDWfVçDÆ—7FVæW"‚v&ÇW"rÂ‚’Óâ°Ğ¢&W7F'Efö–6UVæF–æuF–ÖW$–dæVVFVB‚“°Ğ¢Ò“°Ğ Ğ¢fö–6T–çWCòæFDWfVçDÆ—7FVæW"‚v–çWBrÂ†R’Óâ°Ğ¢6öç7BFW‡BÒ7G&–ær†RçF&vWBçfÇVRÇÂrr’çG&–Ò‚“°Ğ¢–b‡FW‡BÓÒrr’°Ğ¢6ÆV%fö–6T&F6…F–ÖW"‚“°Ğ¢6WEfö–6T6ÆÅ7FGW2‚vw&VVâr“°Ğ¢&WGW&ã°Ğ¢ĞĞ¢–b†Fö7VÖVçBæ7F—fTVÆVÖVçBÓÓÒRçF&vWB’°Ğ¢&WGW&ã°Ğ¢ĞĞ¢&W7F'Efö–6UVæF–æuF–ÖW$–dæVVFVB‚“°Ğ¢Ò“°Ğ Ğ¢ÆWB—4†æFÆ–æufö–6U6VæBÒfÇ6S°Ğ¢6öç7BW†V7WFUfö–6U6VæBÒ†R’Óâ°Ğ¢–b†R’Rç&WfVçDFVfVÇB‚“°Ğ¢–b†—4†æFÆ–æufö–6U6VæB’&WGW&ã°Ğ¢—4†æFÆ–æufö–6U6VæBÒG'VS°Ğ¢6VæDÖW76vR‚“°Ğ¢6WEF–ÖV÷WB‚‚’Óâ°Ğ¢—4†æFÆ–æufö–6U6VæBÒfÇ6S°Ğ¢ÒÂ3“°Ğ¢Ó°Ğ Ğ¢fö–6U6VæD'FãòæFDWfVçDÆ—7FVæW"‚wF÷V6‡7F'BrÂ†R’Óâ°Ğ¢Rç&WfVçDFVfVÇB‚“°Ğ¢ÒÂ²76—fS¢fÇ6RÒ“°Ğ¢fö–6U6VæD'FãòæFDWfVçDÆ—7FVæW"‚wF÷V6†VæBrÂW†V7WFUfö–6U6VæB“°Ğ¢fö–6U6VæD'FãòæFDWfVçDÆ—7FVæW"‚vÖ÷W6VF÷vârÂ†R’Óâ°Ğ¢Rç&WfVçDFVfVÇB‚“°Ğ¢Ò“°Ğ¢fö–6U6VæD'FãòæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂW†V7WFUfö–6U6VæB“°Ğ¢fö–6T–çWCòæFDWfVçDÆ—7FVæW"‚v¶W—&W72rÂ†R’Óâ°Ğ¢–b†Ræ¶W’ÓÓÒtVçFW"rbbRç6†–gD¶W’’°Ğ¢Rç&WfVçDFVfVÇB‚“°Ğ¢6VæDÖW76vR‚“°Ğ¢ĞĞ¢Ò“°Ğ Ğ¢òòhÈ.ijĞĞ¢òòhÈ.ijĞĞ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfö–6RÖ†æwWÖ'Fâr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢–b†6ÆÄVæFVB’F†—2æç&VæFW"‚“°Ğ¢VÇ6Rf–æ—6„6ÆÂ‚wW6W"r“°Ğ¢Ò“°Ğ¢ĞĞ Ğ¢òò	ù+‹ÚÎ‹JnYî˜	®yúTĞ¢7–æ2æ÷F–g•G&ç6fW"†Ö÷VçBÂFW62’°Ğ¢–b‚F†—2æ—4öæÆ–æTÖöFR‚’’&WGW&ã°Ğ Ğ¢6öç7BÖW76vRÒyJh‹~˜	®‹ø~[êîKúY	KÚ‹ÚÎ‹JnK¨l*RG¶Ö÷VçGŞûÈÎZH~k:ûÉ¢G¶FW67Ö°Ğ¢v—BF†—2ææ÷F–g”’†ÖW76vR“°Ğ¢ĞĞ Ğ¢òò	úzri‹îzK®Xù{ª.XÈ^yXÎ™Ú.ûÈš¹K»ş[êîKúXéşx˜ûÈĞ¢6†÷u&VE6¶WDF–Æör‚’°Ğ¢6öç7B7W'&VçD6†BÒF†—2ææ7W'&VçD6†BÇÂ·Ó°Ğ¢6öç7B—4w&÷W6†BÒ7W'&VçD6†BçG—RÓÓÒvw&÷Ws°Ğ¢6öç7Bw&÷WÖVÖ&W'2Ò—4w&÷W6†@Ğ¢òF†—2åö6öÆÆV7Dw&÷W'F–6—çG4f÷$f–ÇFW"†7W'&VçD6†B’æf–ÇFW"†æÖRÓâF†—2åö—47W'&VçEvV6†EW6W$æÖR†æÖR’Ğ¢¢µÓ°Ğ¢6öç7B6Æ–Ö&ÆTw&÷WÖVÖ&W$6÷VçBÒ—4w&÷W6†Bòw&÷WÖVÖ&W'2æÆVæwF‚²¢°Ğ¢6öç7BW66T‡FÖÂÒ‡fÇVR’Óâ7G&–ær‡fÇVRóòrrĞ¢ç&WÆ6R‚òbörÂrf×²rĞ¢ç&WÆ6R‚óÂörÂrfÇC²rĞ¢ç&WÆ6R‚óâörÂrfwC²rĞ¢ç&WÆ6R‚ò"örÂrgV÷C²rĞ¢ç&WÆ6R‚òrörÂrb33“²r“°Ğ¢6öç7BÖVÖ&W$÷F–öç2Òw&÷WÖVÖ&W'2æÆVæwF‚â Ğ¢òw&÷WÖVÖ&W'2æÖ†æÖRÓâÆ÷F–öâfÇVSÒ"G¶W66T‡FÖÂ†æÖR—Ò"7G–ÆSÒ'FW‡BÖÆ–vã¢ÆVgC²FW‡BÖÆ–vâÖÆ7C¢ÆVgC²F—&V7F–öã¢ÇG#²#âG¶W66T‡FÖÂ†æÖR—ÓÂö÷F–öãæ’æ¦ö–â‚rrĞ¢¢sÆ÷F–öâfÇVSÒ""7G–ÆSÒ'FW‡BÖÆ–vã¢ÆVgC²FW‡BÖÆ–vâÖÆ7C¢ÆVgC²F—&V7F–öã¢ÇG#²#îi¨.izXúş˜{êNh‰YƒÂö÷F–öãâs°Ğ Ğ¢6öç7B6–ævÆT6†Df÷&ÒÒ Ğ¢ÆF—b6Æ73Ò'vV6†B×&VG6¶WB×6–ævÆRÖf÷&Ò"7G–ÆSÒ&F—7Æ“¢fÆWƒ²fÆW‚ÖF—&V7F–öã¢6öÇVÖã²fÆWƒ¢²Ö–âÖ†V–v‡C¢²#àĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6ffc²&÷&FW"×&F—W3¢'ƒ²Ö&v–ã¢'‚ƒ²FF–æs¢g‚ƒ²&÷‚×6—¦–æs¢&÷&FW"Ö&÷ƒ²#àĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²§W7F–g’Ö6öçFVçC¢76RÖ&WGvVVã²†V–v‡C¢Cgƒ²#àĞ¢Ç7â7G–ÆSÒ&föçB×6—¦S¢Gƒ²6öÆ÷#¢3###²#îXÙ^KŠ®˜yš)ÓÂ÷7ãàĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²§W7F–g’Ö6öçFVçC¢fÆW‚ÖVæC²†V–v‡C¢C'ƒ²Ö–â×v–GFƒ¢3ƒ²FF–æs¢ƒ²&÷&FW"×&F—W3¢ƒ²&6¶w&÷VæC¢6ffc²&÷‚×6—¦–æs¢&÷&FW"Ö&÷ƒ²#àĞ¢Ç7â7G–ÆSÒ&föçB×6—¦S¢Gƒ²6öÆ÷#¢6#†#†#ƒ²Ö&v–â×&–v‡C¢wƒ²#ì*SÂ÷7ãàĞ¢Æ–çWBG—SÒ'FW‡B"–CÒ'&VG6¶WBÖÖ÷VçB"Æ6V†öÆFW#Ò#ã"–çWFÖöFSÒ&FV6–ÖÂ"7G–ÆSÒ&&6¶w&÷VæC¢G&ç7&VçB–×÷'FçC²&÷&FW#¢æöæR–×÷'FçC²÷WFÆ–æS¢æöæR–×÷'FçC²&÷‚×6†F÷s¢æöæR–×÷'FçC²föçB×6—¦S¢gƒ²Æ–æRÖ†V–v‡C¢²FW‡BÖÆ–vã¢&–v‡C²6öÆ÷#¢6††ƒ²v–GFƒ¢cGƒ²FF–æs¢²#àĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²&6¶w&÷VæC¢6ffc²&÷&FW"×&F—W3¢'ƒ²Ö&v–ã¢'‚ƒ²FF–æs¢'ƒ²&÷‚×6—¦–æs¢&÷&FW"Ö&÷ƒ²Ö–âÖ†V–v‡C¢S‡ƒ²#àĞ¢Æ–çWBG—SÒ'FW‡B"–CÒ'&VG6¶WB×v—6‚"Æ6V†öÆFW#Ò.hŞYiÎXù‹J.ûÈÎZJ~YZJ~XŠ’"Ö†ÆVæwFƒÒ##R"7G–ÆSÒ&fÆWƒ¢²Ö–â×v–GFƒ¢²†V–v‡C¢C'ƒ²&6¶w&÷VæC¢G&ç7&VçB–×÷'FçC²&÷&FW#¢æöæR–×÷'FçC²÷WFÆ–æS¢æöæR–×÷'FçC²&÷‚×6†F÷s¢æöæR–×÷'FçC²föçB×6—¦S¢Gƒ²6öÆ÷#¢3###²FF–æs¢²#àĞ¢Æ’6Æ73Ò&f×&VwVÆ"fÖf6R×6Ö–ÆR"&–Ö†–FFVãÒ'G'VR"7G–ÆSÒ&föçB×6—¦S¢‡ƒ²6öÆ÷#¢3†††²Ö&v–âÖÆVgC¢‡ƒ²fÆW‚×6‡&–æ³¢²#ãÂö“àĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¢6VçFW#²Ö&v–ã¢#W‚Wƒ²#àĞ¢Ç7â7G–ÆSÒ&föçB×6—¦S¢3ƒ²föçB×vV–v‡C¢S²6öÆ÷#¢3²#ì*RÂ÷7ãàĞ¢Ç7â–CÒ'&VG6¶WBÖÖ÷VçBÖÖ–â"7G–ÆSÒ&föçB×6—¦S¢3ƒ²föçB×vV–v‡C¢S²6öÆ÷#¢3²#ããÂ÷7ãàĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ'FF–æs¢3ƒ²#àĞ¢Æ'WGFöâ–CÒ&6öæf—&Ò×&VG6¶WB"7G–ÆSÒ'v–GFƒ¢S²FF–æs¢ƒ²&6¶w&÷VæC¢6SSF3CS²6öÆ÷#¢6ffc²&÷&FW#¢æöæS²&÷&FW"×&F—W3¢gƒ²föçB×6—¦S¢7ƒ²7W'6÷#¢ö–çFW#²&÷‚×6—¦–æs¢&÷&FW"Ö&÷ƒ²#îZî™+‹ù¾{ª.XÈSÂö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¢6VçFW#²föçB×6—¦S¢ƒ²6öÆ÷#¢6²Ö&v–â×F÷¢WFó²FF–æs¢‚²#îXúşy»Nhê^KÛşyJiKnX‹y¨N™»n™+Xù{ª.XÈSÂöF—càĞ¢ÂöF—càĞ¢°Ğ Ğ¢6öç7Bw&÷W6–ævÆTf÷&ÒÒ Ğ¢ÆF—b6Æ73Ò'vV6†B×&VG6¶WBÖw&÷W×æVÂ"FF×&VG6¶WBÖÖöFSÒ'6–ævÆR"7G–ÆSÒ&F—7Æ“¢fÆWƒ²fÆW‚ÖF—&V7F–öã¢6öÇVÖã²fÆWƒ¢²Ö–âÖ†V–v‡C¢²#àĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6ffc²&÷&FW"×&F—W3¢Gƒ²Ö&v–ã¢'‚ƒ²FF–æs¢Gƒ²&÷‚×6—¦–æs¢&÷&FW"Ö&÷ƒ²#àĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²§W7F–g’Ö6öçFVçC¢76RÖ&WGvVVã²Ö–âÖ†V–v‡C¢S‡ƒ²&÷&FW"Ö&÷GFöÓ¢‚6öÆ–B6ccc²#àĞ¢Ç7â7G–ÆSÒ&föçB×6—¦S¢Gƒ²6öÆ÷#¢3###²#îXÙ^KŠ®˜yš)ÓÂ÷7ãàĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²#àĞ¢Ç7â7G–ÆSÒ&föçB×6—¦S¢Gƒ²6öÆ÷#¢6#†#†#ƒ²Ö&v–â×&–v‡C¢‡ƒ²#ì*SÂ÷7ãàĞ¢Æ–çWBG—SÒ'FW‡B"–CÒ'&VG6¶WBÖÖ÷VçB"Æ6V†öÆFW#Ò#ã"–çWFÖöFSÒ&FV6–ÖÂ"7G–ÆSÒ&&6¶w&÷VæC¢G&ç7&VçB–×÷'FçC²&÷&FW#¢æöæR–×÷'FçC²÷WFÆ–æS¢æöæR–×÷'FçC²&÷‚×6†F÷s¢æöæR–×÷'FçC²föçB×6—¦S¢wƒ²FW‡BÖÆ–vã¢&–v‡C²6öÆ÷#¢6††ƒ²v–GFƒ¢cGƒ²FF–æs¢²#àĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²§W7F–g’Ö6öçFVçC¢76RÖ&WGvVVã²Ö–âÖ†V–v‡C¢S‡ƒ²&÷&FW"Ö&÷GFöÓ¢‚6öÆ–B6ccc²#àĞ¢Ç7â7G–ÆSÒ&föçB×6—¦S¢Gƒ²6öÆ÷#¢3###²#îXù{¹“Â÷7ãàĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²Ö–â×v–GFƒ¢²Ö‚×v–GFƒ¢c‚S²#àĞ¢Ç6VÆV7B–CÒ'&VG6¶WBÖw&÷W×&V6—–VçB"&–ÖÆ&VÃÒ.˜hº{êNh‰Y‚"7G–ÆSÒ&Ö‚×v–GFƒ¢sƒ²&÷&FW#¢æöæR–×÷'FçC²÷WFÆ–æS¢æöæR–×÷'FçC²&÷‚×6†F÷s¢æöæR–×÷'FçC²&6¶w&÷VæC¢G&ç7&VçB–×÷'FçC²6öÆ÷#¢3“““²föçB×6—¦S¢7ƒ²FW‡BÖÆ–vã¢&–v‡C²FW‡BÖÆ–vâÖÆ7C¢&–v‡C²V&æ6S¢æöæS²FF–æs¢g‚²#àĞ¢Æ÷F–öâfÇVSÒ""7G–ÆSÒ'FW‡BÖÆ–vã¢ÆVgC²FW‡BÖÆ–vâÖÆ7C¢ÆVgC²F—&V7F–öã¢ÇG#²#î˜hº{êNh‰YƒÂö÷F–öãàĞ¢G¶ÖVÖ&W$÷F–öç7ĞĞ¢Â÷6VÆV7CàĞ¢Æ’6Æ73Ò&f×6öÆ–BfÖ6†Wg&öâ×&–v‡B"&–Ö†–FFVãÒ'G'VR"7G–ÆSÒ&föçB×6—¦S¢ƒ²6öÆ÷#¢6&&#²Ö&v–âÖÆVgC¢Óƒ²#ãÂö“àĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²Ö–âÖ†V–v‡C¢S‡ƒ²#àĞ¢Ç7â7G–ÆSÒ&föçB×6—¦S¢Gƒ²6öÆ÷#¢3###²Ö&v–â×&–v‡C¢#Gƒ²#îzYŞzhşŠúÓÂ÷7ãàĞ¢Æ–çWBG—SÒ'FW‡B"–CÒ'&VG6¶WB×v—6‚"Æ6V†öÆFW#Ò.hŞYiÎXù‹J.ûÈÎZJ~YZJ~XŠ’"Ö†ÆVæwFƒÒ##R"7G–ÆSÒ&fÆWƒ¢²Ö–â×v–GFƒ¢²&6¶w&÷VæC¢G&ç7&VçB–×÷'FçC²&÷&FW#¢æöæR–×÷'FçC²÷WFÆ–æS¢æöæR–×÷'FçC²&÷‚×6†F÷s¢æöæR–×÷'FçC²föçB×6—¦S¢7ƒ²6öÆ÷#¢3###²FF–æs¢²#àĞ¢Æ’6Æ73Ò&f×&VwVÆ"fÖf6R×6Ö–ÆR"&–Ö†–FFVãÒ'G'VR"7G–ÆSÒ&föçB×6—¦S¢wƒ²6öÆ÷#¢3†††²Ö&v–âÖÆVgC¢‡ƒ²fÆW‚×6‡&–æ³¢²#ãÂö“àĞ¢ÂöF—càĞ Ğ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6ffc²&÷&FW"×&F—W3¢Gƒ²Ö&v–ã¢'‚ƒ²FF–æs¢#‚g‚‡ƒ²FW‡BÖÆ–vã¢6VçFW#²&÷‚×6—¦–æs¢&÷&FW"Ö&÷ƒ²#àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢7ƒ²6öÆ÷#¢3333²Ö&v–âÖ&÷GFöÓ¢gƒ²#î˜yš)ÓÂöF—càĞ¢ÆF—cãÇ7â7G–ÆSÒ&föçB×6—¦S¢3ƒ²föçB×vV–v‡C¢S²6öÆ÷#¢3²#ì*RÂ÷7ããÇ7â–CÒ'&VG6¶WBÖÖ÷VçBÖÖ–â"7G–ÆSÒ&föçB×6—¦S¢3Gƒ²föçB×vV–v‡C¢S²6öÆ÷#¢3²#ããÂ÷7ããÂöF—càĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢–æÆ–æRÖfÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²v¢Wƒ²Ö&v–â×F÷¢‡ƒ²FF–æs¢W‚—ƒ²&÷&FW"×&F—W3¢Wƒ²&6¶w&÷VæC¢6cvcvcs²6öÆ÷#¢3“““²föçB×6—¦S¢ƒ²#ãÆ’6Æ73Ò&f×6öÆ–BfÖ6—&6ÆRÖ–æfò"&–Ö†–FFVãÒ'G'VR#ãÂö“îXÙ^xºÎ{ª.XÈ^K¸^Xù{¹KˆKŠ®K«£ÂöF—càĞ¢Æ'WGFöâ–CÒ&6öæf—&Ò×&VG6¶WB"7G–ÆSÒ'v–GFƒ¢S²Ö&v–â×F÷¢#‡ƒ²FF–æs¢ƒ²&6¶w&÷VæC¢6fc6cCS²6öÆ÷#¢6ffc²&÷&FW#¢æöæS²&÷&FW"×&F—W3¢—ƒ²föçB×6—¦S¢Gƒ²7W'6÷#¢ö–çFW#²&÷‚×6—¦–æs¢&÷&FW"Ö&÷ƒ²#îZî™+‹ù¾{ª.XÈSÂö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¢6VçFW#²föçB×6—¦S¢ƒ²6öÆ÷#¢6²Ö&v–â×F÷¢WFó²FF–æs¢‡‚ƒ²#îXúşy»Nhê^KÛşyJiKnX‹y¨N™»n™+Xù{ª.XÈSÂöF—càĞ¢ÂöF—càĞ¢°Ğ Ğ¢6öç7Bw&÷W6¶WDf÷&ÒÒ Ğ¢ÆF—b6Æ73Ò'vV6†B×&VG6¶WBÖw&÷W×æVÂ"FF×&VG6¶WBÖÖöFSÒ&w&÷W"7G–ÆSÒ&F—7Æ“¢æöæS²fÆW‚ÖF—&V7F–öã¢6öÇVÖã²fÆWƒ¢²Ö–âÖ†V–v‡C¢²#àĞ¢ÆF—bFF×&VG6¶WBÖw&÷WÖæ÷FR7G–ÆSÒ&Ö&v–ã¢'‚ƒ²FF–æs¢‚'ƒ²&÷&FW"×&F—W3¢wƒ²&6¶w&÷VæC¢6ffcVc#²6öÆ÷#¢63“ƒssƒ²föçB×6—¦S¢ƒ²FW‡BÖÆ–vã¢6VçFW#²#ãÆ’6Æ73Ò&f×6öÆ–BfÖ6—&6ÆRÖ–æfò"&–Ö†–FFVãÒ'G'VR"7G–ÆSÒ&Ö&v–â×&–v‡C¢Gƒ²#ãÂö“î{êNh‰Yš(nXùnYî™¨şiË®h¸nXˆcÂöF—càĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6ffc²&÷&FW"×&F—W3¢Gƒ²Ö&v–ã¢'‚ƒ²FF–æs¢Gƒ²&÷‚×6—¦–æs¢&÷&FW"Ö&÷ƒ²#àĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²§W7F–g’Ö6öçFVçC¢76RÖ&WGvVVã²Ö–âÖ†V–v‡C¢S‡ƒ²&÷&FW"Ö&÷GFöÓ¢‚6öÆ–B6ccc²#àĞ¢Ç7â7G–ÆSÒ&föçB×6—¦S¢Gƒ²6öÆ÷#¢3###²#î{ª.XÈ^{¾Yè³Â÷7ãàĞ¢Æ'WGFöâ–CÒ'&VG6¶WBÖw&÷WÖ¶–æB×FövvÆR"G—SÒ&'WGFöâ"7G–ÆSÒ&F—7Æ“¢–æÆ–æRÖfÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²v¢‡ƒ²&÷&FW#¢æöæR–×÷'FçC²÷WFÆ–æS¢æöæR–×÷'FçC²&6¶w&÷VæC¢G&ç7&VçB–×÷'FçC²6öÆ÷#¢3ccc²föçB×6—¦S¢7ƒ²FF–æs¢²7W'6÷#¢ö–çFW#²#ãÇ7ãîh»Îh˜¾k	N{ª.XÈSÂ÷7ããÆ’6Æ73Ò&f×6öÆ–BfÖ6†Wg&öâ×&–v‡B"&–Ö†–FFVãÒ'G'VR"7G–ÆSÒ&föçB×6—¦S¢ƒ²6öÆ÷#¢6&&#²#ãÂö“ãÂö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²§W7F–g’Ö6öçFVçC¢76RÖ&WGvVVã²Ö–âÖ†V–v‡C¢S‡ƒ²&÷&FW"Ö&÷GFöÓ¢‚6öÆ–B6ccc²#àĞ¢Ç7â7G–ÆSÒ&föçB×6—¦S¢Gƒ²6öÆ÷#¢3###²#îh¾˜yš)ÓÂ÷7ãàĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²#ãÇ7â7G–ÆSÒ&föçB×6—¦S¢Gƒ²6öÆ÷#¢6#†#†#ƒ²Ö&v–â×&–v‡C¢‡ƒ²#ì*SÂ÷7ããÆ–çWBG—SÒ'FW‡B"–CÒ'&VG6¶WBÖw&÷W×F÷FÂ"Æ6V†öÆFW#Ò#ã"–çWFÖöFSÒ&FV6–ÖÂ"7G–ÆSÒ&&6¶w&÷VæC¢G&ç7&VçB–×÷'FçC²&÷&FW#¢æöæR–×÷'FçC²÷WFÆ–æS¢æöæR–×÷'FçC²&÷‚×6†F÷s¢æöæR–×÷'FçC²föçB×6—¦S¢wƒ²FW‡BÖÆ–vã¢&–v‡C²6öÆ÷#¢3“““²v–GFƒ¢cGƒ²FF–æs¢²#ãÂöF—càĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²§W7F–g’Ö6öçFVçC¢76RÖ&WGvVVã²Ö–âÖ†V–v‡C¢S‡ƒ²&÷&FW"Ö&÷GFöÓ¢‚6öÆ–B6ccc²#àĞ¢Ç7â7G–ÆSÒ&föçB×6—¦S¢Gƒ²6öÆ÷#¢3###²#î{ª.XÈ^KŠ®i[Â÷7ãàĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²6öÆ÷#¢6²föçB×6—¦S¢7ƒ²#ãÆ–çWB–CÒ'&VG6¶WBÖw&÷WÖ6÷VçB"G—SÒ'FW‡B"–çWFÖöFSÒ&çVÖW&–2"GFW&ãÒ%³Ó•Ò¢"Ö†ÆVæwFƒÒ#2"Æ6V†öÆFW#Ò.Z¾XiKŠ®i["&–ÖÆ&VÃÒ.{ª.XÈ^KŠ®i["7G–ÆSÒ'v–GFƒ¢s'ƒ²&6¶w&÷VæC¢G&ç7&VçB–×÷'FçC²&÷&FW#¢æöæR–×÷'FçC²÷WFÆ–æS¢æöæR–×÷'FçC²&÷‚×6†F÷s¢æöæR–×÷'FçC²6öÆ÷#¢3ƒƒƒ²föçB×6—¦S¢7ƒ²FW‡BÖÆ–vã¢&–v‡C²FF–æs¢²#ãÇ7â7G–ÆSÒ&Ö&v–âÖÆVgC¢Wƒ²6öÆ÷#¢3ƒƒƒ²#îKŠ£Â÷7ããÂöF—càĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²Ö–âÖ†V–v‡C¢S‡ƒ²#àĞ¢Ç7â7G–ÆSÒ&föçB×6—¦S¢Gƒ²6öÆ÷#¢3###²Ö&v–â×&–v‡C¢#Gƒ²#îzYŞzhşŠúÓÂ÷7ãàĞ¢Æ–çWBG—SÒ'FW‡B"–CÒ'&VG6¶WBÖw&÷W×v—6‚"Æ6V†öÆFW#Ò.hŞYiÎXù‹J.ûÈÎZJ~YZJ~XŠ’"Ö†ÆVæwFƒÒ##R"7G–ÆSÒ&fÆWƒ¢²Ö–â×v–GFƒ¢²&6¶w&÷VæC¢G&ç7&VçB–×÷'FçC²&÷&FW#¢æöæR–×÷'FçC²÷WFÆ–æS¢æöæR–×÷'FçC²&÷‚×6†F÷s¢æöæR–×÷'FçC²föçB×6—¦S¢7ƒ²6öÆ÷#¢3###²FF–æs¢²#àĞ¢Æ’6Æ73Ò&f×&VwVÆ"fÖf6R×6Ö–ÆR"&–Ö†–FFVãÒ'G'VR"7G–ÆSÒ&föçB×6—¦S¢wƒ²6öÆ÷#¢3†††²Ö&v–âÖÆVgC¢‡ƒ²fÆW‚×6‡&–æ³¢²#ãÂö“àĞ¢ÂöF—càĞ Ğ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6ffc²&÷&FW"×&F—W3¢Gƒ²Ö&v–ã¢'‚ƒ²FF–æs¢#‚g‚‡ƒ²FW‡BÖÆ–vã¢6VçFW#²&÷‚×6—¦–æs¢&÷&FW"Ö&÷ƒ²#àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢7ƒ²6öÆ÷#¢3333²Ö&v–âÖ&÷GFöÓ¢gƒ²#î˜yš)ÓÂöF—càĞ¢ÆF—cãÇ7â7G–ÆSÒ&föçB×6—¦S¢3ƒ²föçB×vV–v‡C¢S²6öÆ÷#¢3²#ì*RÂ÷7ããÇ7â–CÒ'&VG6¶WBÖw&÷WÖÖ÷VçBÖÖ–â"7G–ÆSÒ&föçB×6—¦S¢3Gƒ²föçB×vV–v‡C¢S²6öÆ÷#¢3²#ããÂ÷7ããÂöF—càĞ¢ÆF—bFF×&VG6¶WBÖw&÷W×7VÖÖ'’7G–ÆSÒ&F—7Æ“¢–æÆ–æRÖfÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²v¢Wƒ²Ö&v–â×F÷¢‡ƒ²FF–æs¢W‚—ƒ²&÷&FW"×&F—W3¢Wƒ²&6¶w&÷VæC¢6cvcvcs²6öÆ÷#¢3“““²föçB×6—¦S¢ƒ²#ãÆ’6Æ73Ò&f×6öÆ–BfÖ6—&6ÆRÖ–æfò"&–Ö†–FFVãÒ'G'VR#ãÂö“î{êNh‰Yš(nXùnYî™¨şiË®h¸nXˆcÂöF—càĞ¢Æ'WGFöâ–CÒ&6öæf—&ÒÖw&÷W×&VG6¶WB"G—SÒ&'WGFöâ"7G–ÆSÒ'v–GFƒ¢S²Ö&v–â×F÷¢#‡ƒ²FF–æs¢ƒ²&6¶w&÷VæC¢6fc6cCS²6öÆ÷#¢6ffc²&÷&FW#¢æöæS²&÷&FW"×&F—W3¢—ƒ²föçB×6—¦S¢Gƒ²7W'6÷#¢ö–çFW#²&÷‚×6—¦–æs¢&÷&FW"Ö&÷ƒ²#îZî™+‹ù¾{ª.XÈSÂö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¢6VçFW#²föçB×6—¦S¢ƒ²6öÆ÷#¢6²Ö&v–â×F÷¢WFó²FF–æs¢‡‚ƒ²#îXúşy»Nhê^KÛşyJiKnX‹y¨N™»n™+Xù{ª.XÈSÂöF—càĞ¢ÂöF—càĞ¢°Ğ Ğ¢6öç7Bw&÷WF'2Ò—4w&÷W6†Bò Ğ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²Ö&v–ã¢'‚ƒ²FF–æs¢wƒ²†V–v‡C¢S'ƒ²&÷&FW"×&F—W3¢7ƒ²&6¶w&÷VæC¢6ffc²#àĞ¢Æ'WGFöâ6Æ73Ò'vV6†B×&VG6¶WBÖw&÷W×F""FF×&VG6¶WBÖÖöFSÒ'6–ævÆR"G—SÒ&'WGFöâ"7G–ÆSÒ&fÆWƒ¢²†V–v‡C¢S²&÷&FW#¢æöæR–×÷'FçC²÷WFÆ–æS¢æöæR–×÷'FçC²&6¶w&÷VæC¢G&ç7&VçB–×÷'FçC²6öÆ÷#¢6fSS²föçB×6—¦S¢Gƒ²föçB×vV–v‡C¢c²7W'6÷#¢ö–çFW#²#ãÇ7â7G–ÆSÒ&F—7Æ“¢–æÆ–æRÖfÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²†V–v‡C¢S²&÷&FW"Ö&÷GFöÓ¢'‚6öÆ–B6fSS²&÷‚×6—¦–æs¢&÷&FW"Ö&÷ƒ²#îXÙ^xºÎ{ª.XÈSÂ÷7ããÂö'WGFöãàĞ¢Æ'WGFöâ6Æ73Ò'vV6†B×&VG6¶WBÖw&÷W×F""FF×&VG6¶WBÖÖöFSÒ&w&÷W"G—SÒ&'WGFöâ"7G–ÆSÒ&fÆWƒ¢²†V–v‡C¢S²&÷&FW#¢æöæR–×÷'FçC²÷WFÆ–æS¢æöæR–×÷'FçC²&6¶w&÷VæC¢G&ç7&VçB–×÷'FçC²6öÆ÷#¢3ƒƒƒ²föçB×6—¦S¢Gƒ²7W'6÷#¢ö–çFW#²#ãÇ7â7G–ÆSÒ&F—7Æ“¢–æÆ–æRÖfÆWƒ²Æ–vâÖ—FV×3¢6VçFW#²†V–v‡C¢S²&÷&FW"Ö&÷GFöÓ¢'‚6öÆ–BG&ç7&VçC²&÷‚×6—¦–æs¢&÷&FW"Ö&÷ƒ²#î{êN{ª.XÈSÂ÷7ããÂö'WGFöãàĞ¢ÂöF—càĞ¢¢rs°Ğ¢6öç7BF–Æöt&öG’Ò—4w&÷W6†@Ğ¢òG¶w&÷WF'7ÓÆF—b6Æ73Ò'vV6†B×&VG6¶WBÖw&÷WÖf÷&×2"7G–ÆSÒ&F—7Æ“¢fÆWƒ²fÆW‚ÖF—&V7F–öã¢6öÇVÖã²fÆWƒ¢²Ö–âÖ†V–v‡C¢²#âG¶w&÷W6–ævÆTf÷&×ÒG¶w&÷W6¶WDf÷&×ÓÂöF—cæ Ğ¢¢6–ævÆT6†Df÷&Ó°Ğ¢6öç7B‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò'vV6†BÖvV6†B×–ÖVçBÖ6ö×÷6R×vRvV6†B×&VG6¶WBÖ6ö×÷6R×vR#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW""7G–ÆSÒ&&6¶w&÷VæC¢6cvcvcs²#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"ÖÆVgB#àĞ¢Æ'WGFöâ6Æ73Ò'vV6†BÖ&6²Ö'Fâ"–CÒ&&6²Ög&öÒ×&VG6¶WB"7G–ÆSÒ&6öÆ÷#¢3²#àĞ¢Æ’6Æ73Ò&f×6öÆ–BfÖ6†Wg&öâÖÆVgB#ãÂö“àĞ¢Âö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×F—FÆR"7G–ÆSÒ&föçB×6—¦S£Gƒ²#îXù{ª.XÈSÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×&–v‡B#àĞ¢Æ'WGFöâ6Æ73Ò'vV6†BÖ†VFW"Ö'Fâ"7G–ÆSÒ&föçB×6—¦S¢'ƒ²6öÆ÷#¢3ccc²#àĞ¢Æ’6Æ73Ò&f×6öÆ–BfÖVÆÆ—6—2#ãÂö“àĞ¢Âö'WGFöãàĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ6öçFVçB"7G–ÆSÒ&&6¶w&÷VæC¢6cvcvcs²FF–æs¢G¶—4w&÷W6†Bòs‚r¢s‡‚wÓ²F—7Æ“¢fÆWƒ²fÆW‚ÖF—&V7F–öã¢6öÇVÖã²÷fW&fÆ÷r×“¢WFó²÷fW&fÆ÷r×ƒ¢†–FFVã²&÷‚×6—¦–æs¢&÷&FW"Ö&÷ƒ²#àĞ¢G¶F–Æöt&öG—ĞĞ¢ÂöF—càĞ¢ÂöF—càĞ¢°Ğ Ğ¢F†—2æç†öæU6†VÆÂç6WD6öçFVçB†‡FÖÂ“°Ğ Ğ¢6öç7BÖ÷VçD–çWBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&VG6¶WBÖÖ÷VçBr“°Ğ¢6öç7BÖ÷VçDÖ–äF—7Æ’ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&VG6¶WBÖÖ÷VçBÖÖ–âr“°Ğ Ğ¢–b†Ö÷VçD–çWBbbÖ÷VçDÖ–äF—7Æ’’°Ğ¢Ö÷VçD–çWBæFDWfVçDÆ—7FVæW"‚v–çWBrÂ‚’Óâ°Ğ¢ÆWBfÇVU7G"ÒÖ÷VçD–çWBçfÇVRç&WÆ6R‚õµåÆBåÒörÂrr“°Ğ¢6öç7B'G2ÒfÇVU7G"ç7Æ—B‚râr“°Ğ¢–b‡'G2æÆVæwF‚â"’fÇVU7G"Ò'G5³Ò²râr²'G2ç6Æ–6Rƒ’æ¦ö–â‚rr“°Ğ¢–b‡'G5³Òbb'G5³ÒæÆVæwF‚â"’fÇVU7G"Ò'G5³Ò²râr²'G5³Òç7V'7G&–ærƒÂ"“°Ğ¢Ö÷VçD–çWBçfÇVRÒfÇVU7G#°Ğ¢6öç7B'6VEfÇVRÒ'6TfÆöB‡fÇVU7G"“°Ğ¢Ö÷VçDÖ–äF—7Æ’çFW‡D6öçFVçBÒçVÖ&W"æ—4f–æ—FR‡'6VEfÇVR’ò'6VEfÇVRçFôf—†VBƒ"’¢sãs°Ğ¢Ò“°Ğ Ğ¢Ö÷VçD–çWBæFDWfVçDÆ—7FVæW"‚vfö7W2rÂ‚’Óâ°Ğ¢Ö÷VçD–çWBç7G–ÆRæ6öÆ÷"Òr3s°Ğ¢–b†Ö÷VçD–çWBçfÇVRÓÓÒsãrÇÂÖ÷VçD–çWBçfÇVRÓÓÒrr’Ö÷VçD–çWBçÆ6V†öÆFW"Òrs°Ğ¢Ò“°Ğ Ğ¢Ö÷VçD–çWBæFDWfVçDÆ—7FVæW"‚v&ÇW"rÂ‚’Óâ°Ğ¢–b†Ö÷VçD–çWBçfÇVRÓÓÒrr’°Ğ¢Ö÷VçD–çWBç7G–ÆRæ6öÆ÷"Òr6662s°Ğ¢Ö÷VçD–çWBçÆ6V†öÆFW"Òsãs°Ğ¢ĞĞ¢Ò“°Ğ¢ĞĞ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v&6²Ög&öÒ×&VG6¶WBr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’ÓâF†—2æç&VæFW"‚’“°Ğ Ğ¢–b†—4w&÷W6†B’°Ğ¢6öç7BF'2ÒFö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚rçvV6†B×&VG6¶WBÖw&÷W×F"r“°Ğ¢6öç7BæVÇ2ÒFö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚rçvV6†B×&VG6¶WBÖw&÷W×æVÂr“°Ğ¢F'2æf÷$V6‚‡F"Óâ°Ğ¢F"æFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7BÖöFRÒF"æFF6WBç&VG6¶WDÖöFS°Ğ¢F'2æf÷$V6‚†—FVÒÓâ°Ğ¢6öç7B7F—fRÒ—FVÒæFF6WBç&VG6¶WDÖöFRÓÓÒÖöFS°Ğ¢—FVÒç7G–ÆRæ6öÆ÷"Ò7F—fRòr6fSSr¢r3ƒƒ‚s°Ğ¢—FVÒç7G–ÆRæföçEvV–v‡BÒ7F—fRòscr¢sCs°Ğ¢6öç7BÆ&VÂÒ—FVÒçVW'•6VÆV7F÷"‚w7âr“°Ğ¢–b†Æ&VÂ’Æ&VÂç7G–ÆRæ&÷&FW$&÷GFöÔ6öÆ÷"Ò7F—fRòr6fSSr¢wG&ç7&VçBs°Ğ¢Ò“°Ğ¢æVÇ2æf÷$V6‚‡æVÂÓâ°Ğ¢æVÂç7G–ÆRæF—7Æ’ÒæVÂæFF6WBç&VG6¶WDÖöFRÓÓÒÖöFRòvfÆW‚r¢væöæRs°Ğ¢Ò“°Ğ¢Ò“°Ğ¢Ò“°Ğ Ğ¢6öç7Bw&÷W6÷VçD–çWBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&VG6¶WBÖw&÷WÖ6÷VçBr“°Ğ¢w&÷W6÷VçD–çWCòæFDWfVçDÆ—7FVæW"‚v–çWBrÂ‚’Óâ°Ğ¢6öç7BF–v—G2Òw&÷W6÷VçD–çWBçfÇVRç&WÆ6R‚õÄBörÂrr’ç&WÆ6R‚õã²òÂrr“°Ğ¢w&÷W6÷VçD–çWBçfÇVRÒF–v—G2ç6Æ–6RƒÂ2“°Ğ¢Ò“°Ğ Ğ¢6öç7Bw&÷WF÷FÄ–çWBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&VG6¶WBÖw&÷W×F÷FÂr“°Ğ¢6öç7Bw&÷WÖ÷VçDÖ–äF—7Æ’ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&VG6¶WBÖw&÷WÖÖ÷VçBÖÖ–âr“°Ğ¢w&÷WF÷FÄ–çWCòæFDWfVçDÆ—7FVæW"‚v–çWBrÂ‚’Óâ°Ğ¢ÆWBfÇVU7G"Òw&÷WF÷FÄ–çWBçfÇVRç&WÆ6R‚õµåÆBåÒörÂrr“°Ğ¢6öç7B'G2ÒfÇVU7G"ç7Æ—B‚râr“°Ğ¢–b‡'G2æÆVæwF‚â"’fÇVU7G"Ò'G5³Ò²râr²'G2ç6Æ–6Rƒ’æ¦ö–â‚rr“°Ğ¢–b‡'G5³Òbb'G5³ÒæÆVæwF‚â"’fÇVU7G"Ò'G5³Ò²râr²'G5³Òç7V'7G&–ærƒÂ"“°Ğ¢w&÷WF÷FÄ–çWBçfÇVRÒfÇVU7G#°Ğ¢6öç7B'6VEfÇVRÒ'6TfÆöB‡fÇVU7G"“°Ğ¢–b†w&÷WÖ÷VçDÖ–äF—7Æ’’°Ğ¢w&÷WÖ÷VçDÖ–äF—7Æ’çFW‡D6öçFVçBÒçVÖ&W"æ—4f–æ—FR‡'6VEfÇVR’ò'6VEfÇVRçFôf—†VBƒ"’¢sãs°Ğ¢ĞĞ¢Ò“°Ğ Ğ¢6öç7Bw&÷W¶–æEFövvÆRÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&VG6¶WBÖw&÷WÖ¶–æB×FövvÆRr“°Ğ¢w&÷W¶–æEFövvÆSòæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7B—4ÇV6·’Òw&÷W¶–æEFövvÆRæFF6WBç&VG6¶WD¶–æBÓÒvfW&vRs°Ğ¢w&÷W¶–æEFövvÆRæFF6WBç&VG6¶WD¶–æBÒ—4ÇV6·’òvfW&vRr¢vÇV6·’s°Ğ¢6öç7BÆ&VÂÒw&÷W¶–æEFövvÆRçVW'•6VÆV7F÷"‚w7âr“°Ğ¢–b†Æ&VÂ’Æ&VÂçFW‡D6öçFVçBÒ—4ÇV6·’ò~[›>YØ~Xˆn{ª.XÈRr¢~h»Îh˜¾k	N{ª.XÈRs°Ğ¢6öç7Bæ÷FRÒFö7VÖVçBçVW'•6VÆV7F÷"‚u¶FF×&VG6¶WBÖw&÷WÖæ÷FUÒr“°Ğ¢–b†æ÷FR’æ÷FRçFW‡D6öçFVçBÒ—4ÇV6·’ò~{êNh‰Yš(nXùnYîjøşK«®˜yš)Şy»YÂr¢~{êNh‰Yš(nXùnYî™¨şiË®h¸nXˆbs°Ğ¢6öç7Bw&÷Wæ÷FRÒFö7VÖVçBçVW'•6VÆV7F÷"‚u¶FF×&VG6¶WBÖw&÷W×7VÖÖ'•Òr“°Ğ¢–b†w&÷Wæ÷FR’w&÷Wæ÷FRçFW‡D6öçFVçBÒ—4ÇV6·’ò~{êNh‰Yš(nXùnYîjøşK«®˜yš)Şy»YÂr¢~{êNh‰Yš(nXùnYî™¨şiË®h¸nXˆbs°Ğ¢Ò“°Ğ Ğ¢6öç7B6VæDw&÷W&VE6¶WBÒ7–æ2‡6¶WDÖöFR’Óâ°Ğ¢6öç7B6†BÒF†—2ææ7W'&VçD6†BÇÂ7W'&VçD6†C°Ğ¢6öç7B—5F&vWFVE6¶WBÒ6¶WDÖöFRÓÓÒw6–ævÆRs°Ğ¢6öç7B&tÖ÷VçBÒ—5F&vWFVE6¶WBòÖ÷VçD–çWCòçfÇVR¢w&÷WF÷FÄ–çWCòçfÇVS°Ğ¢6öç7BÖ÷VçBÒçVÖ&W"ç'6TfÆöB‡&tÖ÷VçBÇÂsr“°Ğ¢–b‚çVÖ&W"æ—4f–æ—FR†Ö÷VçB’ÇÂÖ÷VçBÃÒ’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~Šû~‹é>XZ^jÚ>zîy¨N˜yš)ÒrÂ~)ªûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6öç7B&V6—–VçDæÖRÒ7G&–ær†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&VG6¶WBÖw&÷W×&V6—–VçBr“òçfÇVRÇÂrr’çG&–Ò‚“°Ğ¢–b†—5F&vWFVE6¶WBbb&V6—–VçDæÖR’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~Šû~˜hºŠhXù{¹y¨N{êNh‰Y‚rÂ~)ªûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6öç7B6¶WD6÷VçBÒ—5F&vWFVE6¶WBò¢çVÖ&W"ç'6T–çB†w&÷W6÷VçD–çWCòçfÇVRÇÂsrÂ“°Ğ¢–b‚—5F&vWFVE6¶WBbb‚çVÖ&W"æ—4–çFVvW"‡6¶WD6÷VçB’ÇÂ6¶WD6÷VçBÃÒ’’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~Šû~‹é>XZ^jÚ>zîy¨N{ª.XÈ^KŠ®i[rÂ~)ªûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ¢–b‚—5F&vWFVE6¶WBbb6¶WD6÷VçBâ6Æ–Ö&ÆTw&÷WÖVÖ&W$6÷VçB’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~{ª.XÈ^KŠ®i[KˆŞˆ;Ş‹h^‹ø~{êNXh^Xúşš(nXùnK«®i[ûÈXÈ^hºÎˆz®[{ûÈ’rÂ~)ªûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ¢–b‚—5F&vWFVE6¶WBbbÖF‚ç&÷VæB†Ö÷VçB¢’Â6¶WD6÷VçB’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~h¾˜yš)ŞKˆŞ‹k>ûÈÎ™ÈKùŞŠøjøşKŠ®{ª.XÈ^ˆ{>[	*SãrÂ~)ªûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6öç7BÖ÷VçEFW‡BÒÖ÷VçBçFôf—†VBƒ"“°Ğ¢6öç7Bv—6‚Ò—5F&vWFVE6¶W@Ğ¢ò†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&VG6¶WB×v—6‚r“òçfÇVRÇÂ~hŞYiÎXù‹J.ûÈÎZJ~YZJ~XŠ’rĞ¢¢†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&VG6¶WBÖw&÷W×v—6‚r“òçfÇVRÇÂ~hŞYiÎXù‹J.ûÈÎZJ~YZJ~XŠ’r“°Ğ¢6öç7B–ÖVçE6÷W&6T–BÒv—BF†—2å÷6VÆV7EvV6†E–ÖVçE6÷W&6R†Ö÷VçBÂ—5F&vWFVE6¶WBò~Zé®Y	{ª.XÈRr¢~{êN{ª.XÈRr“°Ğ¢–b‚–ÖVçE6÷W&6T–B’&WGW&ã°Ğ¢6öç7B&VG6¶WD–BÒ'òG´FFRææ÷r‚—ÕòG´ÖF‚ç&æFöÒ‚’çFõ7G&–ærƒ3b’ç6Æ–6Rƒ"Âb—Ö°Ğ¢6öç7B&VG6¶WEG&ç67F–öâÒ°Ğ¢G—S¢w&VG6¶WBrÀĞ¢F—FÆS¢{êNˆ®{ª.XÈRÒG¶6†BææÖWÖÀĞ¢FWF–Ã¢v—6‚ÀĞ¢6÷W&6S¢wvV6†BrÀĞ¢6†D–C¢6†Bæ–BÀĞ¢6÷VçFW''G“¢6†BææÖRÀĞ¢ÖW76vT–C¢&VG6¶WD–BÀĞ¢&VfW&Væ6T–C¢vV6†C§&VG6¶WC§6VæC¢G·&VG6¶WD–GÖ Ğ¢Ó°Ğ¢6öç7B7VæE&W7VÇBÒF†—2æçvV6†DFFç7VæDg&öÕ–ÖVçE6÷W&6R†Ö÷VçBÂ–ÖVçE6÷W&6T–BÂçVÆÂÂ&VG6¶WEG&ç67F–öâ“°Ğ¢–b‚7VæE&W7VÇCòç7V66W72’°Ğ¢6öç7B6÷W&6TæÖRÒ7VæE&W7VÇCòç6÷W&6SòçG—RÓÓÒwvÆÆWBrò~™»n™+r¢~Šú^™;nŠÎXÚs°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~KÙš)ŞKˆŞ‹k2rÂG·6÷W&6TæÖWŞXú®Xš’*RG´çVÖ&W"‡7VæE&W7VÇCòæ&Ææ6T&Vf÷&RÇÂ’çFôf—†VBƒ"—ÖÂ~)ØÂr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6öç7B—4ÇV6·•6¶WBÒw&÷W¶–æEFövvÆSòæFF6WBç&VG6¶WD¶–æBÓÒvfW&vRs°Ğ¢F†—2æçvV6†DFFæFDÖW76vR†6†Bæ–BÂ°Ğ¢–C¢&VG6¶WD–BÀĞ¢g&öÓ¢vÖRrÀĞ¢G—S¢w&VG6¶WBrÀĞ¢6öçFVçC¢—5F&vWFVE6¶WBò¾{¹’G·&V6—–VçDæÖWŞy¨N{ª.XÈR*RG¶Ö÷VçEFW‡GÕÖ¢u¾{êN{ª.XÈUÒrÀĞ¢Ö÷VçC¢Ö÷VçEFW‡BÀĞ¢v—6‚ÀĞ¢7FGW3¢w6VçBrÀĞ¢âââ†—5F&vWFVE6¶W@Ğ¢ò²6¶WDÖöFS¢w6–ævÆRrÂ&V6—–VçDæÖRĞĞ¢¢°Ğ¢—4w&÷W6¶WC¢G'VRÀĞ¢6¶WDÖöFS¢—4ÇV6·•6¶WBòvw&÷WöÇV6·’r¢vw&÷WöfW&vRrÀĞ¢6÷VçC¢6¶WD6÷VçBÀĞ¢6¶WD6÷VçBÀĞ¢6Æ–×3¢µÒÀĞ¢6¶WD6Æ–Ô6÷VçC¢ Ğ¢Ò’ÀĞ¢âââ‡F†—2å÷6†÷VÆEW6U&VÅF–ÖTf÷$öæÆ–æT6†B‚’òF†—2åö'V–ÆEvV6†E&VÅF–ÖTf–VÆG2‚’¢·ÒĞ¢Ò“°Ğ Ğ¢F†—2æç&VæFW"‚“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ€Ğ¢~{ª.XÈ^[{.Xù˜rÀĞ¢—5F&vWFVE6¶WBò[{.Y	G·&V6—–VçDæÖWŞXù˜*RG¶Ö÷VçEFW‡GÒ{ª.XÈV¢[{.Xù˜*RG¶Ö÷VçEFW‡GÒ{êN{ª.XÈVÀĞ¢	úzrpĞ¢“°Ğ¢–b‡F†—2æ—4öæÆ–æTÖöFR‚’’F†—2åöVçVWVUVæF–æt6†B†6†Bæ–B“°Ğ¢Ó°Ğ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6öæf—&Ò×&VG6¶WBr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6VæDw&÷W&VE6¶WB‚w6–ævÆRr“°Ğ¢Ò“°Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6öæf—&ÒÖw&÷W×&VG6¶WBr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6VæDw&÷W&VE6¶WB‚vw&÷Wr“°Ğ¢Ò“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6öæf—&Ò×&VG6¶WBr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ7–æ2‚’Óâ°Ğ¢6öç7BÖ÷VçBÒÖ÷VçD–çWBçfÇVS°Ğ¢6öç7Bv—6‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&VG6¶WB×v—6‚r’çfÇVRÇÂ~hŞYiÎXù‹J.ûÈÎZJ~YZJ~XŠ’s°Ğ Ğ¢–b‚Ö÷VçBÇÂ—4æâ†Ö÷VçB’ÇÂÖ÷VçBÃÒ’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~Šû~‹é>XZ^jÚ>zîy¨N˜yš)ÒrÂ~)ªûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6öç7B&VG6¶WDÖ÷VçBÒ'6TfÆöB†Ö÷VçB“°Ğ¢6öç7B–ÖVçE6÷W&6T–BÒv—BF†—2å÷6VÆV7EvV6†E–ÖVçE6÷W&6R‡&VG6¶WDÖ÷VçBÂ~[êîKú{ª.XÈRr“°Ğ¢–b‚–ÖVçE6÷W&6T–B’&WGW&ã°Ğ¢6öç7B&VG6¶WD–BÒ'òG´FFRææ÷r‚—ÕòG´ÖF‚ç&æFöÒ‚’çFõ7G&–ærƒ3b’ç6Æ–6Rƒ"Âb—Ö°Ğ¢6öç7B&VG6¶WEG&ç67F–öâÒ°Ğ¢G—S¢w&VG6¶WBrÀĞ¢F—FÆS¢G·F†—2ææ7W'&VçD6†CòçG—RÓÓÒvw&÷Wrò~{êNˆ®{ª.XÈRr¢~{ª.XÈ^iJşX{¢wÒÒG·F†—2ææ7W'&VçD6†BææÖWÖÀĞ¢FWF–Ã¢v—6‚ÀĞ¢6÷W&6S¢wvV6†BrÀĞ¢6†D–C¢F†—2ææ7W'&VçD6†Bæ–BÀĞ¢6÷VçFW''G“¢F†—2ææ7W'&VçD6†BææÖRÀĞ¢ÖW76vT–C¢&VG6¶WD–BÀĞ¢&VfW&Væ6T–C¢vV6†C§&VG6¶WC§6VæC¢G·&VG6¶WD–GÖ Ğ¢Ó°Ğ¢6öç7B7VæE&W7VÇBÒF†—2æçvV6†DFFç7VæDg&öÕ–ÖVçE6÷W&6R‡&VG6¶WDÖ÷VçBÂ–ÖVçE6÷W&6T–BÂçVÆÂÂ&VG6¶WEG&ç67F–öâ“°Ğ¢–b‚7VæE&W7VÇCòç7V66W72’°Ğ¢6öç7B6÷W&6TæÖRÒ7VæE&W7VÇCòç6÷W&6SòçG—RÓÓÒwvÆÆWBrò~™»n™+r¢~Šú^™;nŠÎXÚs°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~KÙš)ŞKˆŞ‹k2rÂG·6÷W&6TæÖWŞXú®Xš’*RG´çVÖ&W"‡7VæE&W7VÇCòæ&Ææ6T&Vf÷&RÇÂ’çFôf—†VBƒ"—ÖÂ~)ØÂr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢F†—2æçvV6†DFFæFDÖW76vR‡F†—2ææ7W'&VçD6†Bæ–BÂ°Ğ¢–C¢&VG6¶WD–BÀĞ¢g&öÓ¢vÖRrÀĞ¢G—S¢w&VG6¶WBrÀĞ¢6öçFVçC¢¾{ª.XÈUÒ*RG·'6TfÆöB†Ö÷VçB’çFôf—†VBƒ"—ÒG·v—6‡ÖÀĞ¢Ö÷VçC¢'6TfÆöB†Ö÷VçB’çFôf—†VBƒ"’ÀĞ¢v—6ƒ¢v—6‚ÀĞ¢7FGW3¢w6VçBrÀĞ¢âââ‡F†—2å÷6†÷VÆEW6U&VÅF–ÖTf÷$öæÆ–æT6†B‚’òF†—2åö'V–ÆEvV6†E&VÅF–ÖTf–VÆG2‚’¢·ÒĞ¢Ò“°Ğ Ğ¢F†—2æç&VæFW"‚“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~{ª.XÈ^[{.Xù˜rÂ[{.Y	G·F†—2ææ7W'&VçD6†BææÖWŞXù˜*RG¶Ö÷VçGŞ{ª.XÈVÂ	úzrr“°Ğ¢–b‡F†—2æ—4öæÆ–æTÖöFR‚’’F†—2åöVçVWVUVæF–æt6†B‡F†—2ææ7W'&VçD6†Bæ–B“°Ğ¢Ò“°Ğ¢ĞĞ¢òò	øê‚k{¾Xªˆz®Zé®K˜Šh8^[Ëz©pĞ¢6†÷tFD7W7FöÔVÖö¦”F–Æör‚’°Ğ¢6öç7B‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò'vV6†BÖvV6†B×&VF&ÆR×6WGF–æw2#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"ÖÆVgB#àĞ¢Æ'WGFöâ6Æ73Ò'vV6†BÖ&6²Ö'Fâ"–CÒ&&6²Ög&öÒÖFBÖVÖö¦’#àĞ¢Æ’6Æ73Ò&f×6öÆ–BfÖ6†Wg&öâÖÆVgB#ãÂö“àĞ¢Âö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×F—FÆR#îk{¾XªŠh8SÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×&–v‡B#ãÂöF—càĞ¢ÂöF—càĞ¢ Ğ¢ÆF—b6Æ73Ò'vV6†BÖ6öçFVçB"7G–ÆSÒ&&6¶w&÷VæC¢6VFVFVC²FF–æs¢#ƒ²#àĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6ffc²&÷&FW"×&F—W3¢'ƒ²FF–æs¢#Wƒ²FW‡BÖÆ–vã¢6VçFW#²#àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢Gƒ²6öÆ÷#¢3ccc²Ö&v–âÖ&÷GFöÓ¢'ƒ²#î˜hºY»îx˜~Yîˆz®XªKˆ®KÊûÈiJşhÈh›˜xşûÈ“ÂöF—càĞ¢Æ–çWBG—SÒ&f–ÆR"–CÒ&VÖö¦’Ö–ÖvR×WÆöB"66WCÒ&–ÖvR÷ærÂ–ÖvRö§VrÂ–ÖvRöv–bÂ–ÖvR÷vV'Â–ÖvRò¢"×VÇF—ÆR7G–ÆSÒ&F—7Æ“¢æöæS²#àĞ¢Æ'WGFöâ–CÒ'–6²Ö7W7FöÒÖVÖö¦’"7G–ÆSÒ Ğ¢v–GFƒ¢S°Ğ¢FF–æs¢Gƒ°Ğ¢&6¶w&÷VæC¢3v3c°Ğ¢6öÆ÷#¢6ffc°Ğ¢&÷&FW#¢æöæS°Ğ¢&÷&FW"×&F—W3¢‡ƒ°Ğ¢föçB×6—¦S¢gƒ°Ğ¢föçB×vV–v‡C¢S°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢#î˜hºY»îx˜sÂö'WGFöãàĞ¢ÆF—b–CÒ&VÖö¦’×6VÆV7BÖ†–çB"7G–ÆSÒ'FW‡BÖÆ–vã¦ÆVgC²föçB×6—¦S£'ƒ²6öÆ÷#¢3“““²Ö&v–â×F÷£'ƒ²#îZJ~Y»îKÉ®YÊKˆ®KÊX˜ŞzØjùN{Ê[şX‹iÈ™[ş‹ë’#GûÈÎXéşY»î‹h^‹ørÔ"KÉ®‹{>‹ø~8#ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢°Ğ Ğ¢F†—2æç†öæU6†VÆÂç6WD6öçFVçB†‡FÖÂ“°Ğ¢6öç7B7W'&VçEf–WrÒFö7VÖVçBçVW'•6VÆV7F÷"‚rç†öæR×f–WrÖ7W'&VçBr’ÇÂFö7VÖVçC°Ğ¢6öç7BVW'’Ò‡6VÆV7F÷"’Óâ7W'&VçEf–WrçVW'•6VÆV7F÷"‡6VÆV7F÷"“°Ğ Ğ¢6öç7BTÔô¤•ôÔ…ôD”ÔTå4”ôâÒ#C°Ğ¢6öç7BTÔô¤•õ$uôd”ÄUôÔ…õ4•¤RÒ¢#B¢#C°Ğ¢6öç7B6VÆV7FVDæÖU6WBÒæWr6WB‚“°Ğ¢ÆWB—5WÆöF–ærÒfÇ6S°Ğ¢6öç7B'V–ÆDVÖö¦”æÖRÒ†f–ÆTæÖRÒrrÂfÆÆ&6´–æFW‚Ò’Óâ°Ğ¢6öç7B&t&6RÒ7G&–ær†f–ÆTæÖRÇÂrrĞ¢ç&WÆ6R‚õÂåµâåÒ²BòÂrrĞ¢ç&WÆ6R‚õµÇ%ÆåÇEÒörÂrrĞ¢ç&WÆ6R‚õ³ÃåÒörÂrrĞ¢ç&WÆ6R‚õÇ2²örÂrrĞ¢çG&–Ò‚“°Ğ¢òò›¹ŠêNy»Nhê^˜x~yJih~K»nYŞûÈXë¾hš[^YŞûÈûÈÎŠêyJh‹~Xúş˜	®‹ø~yK^ˆIiKYŞYîKˆ™JîKˆ®KÊ Ğ¢6öç7B&6RÒ&t&6Rç6Æ–6RƒÂ#“°Ğ¢6öç7BFVfVÇD&6RÒ&6RÇÂŠh8RG¶fÆÆ&6´–æFW‡Ö°Ğ¢ÆWB6æF–FFRÒFVfVÇD&6S°Ğ¢ÆWB’Ò#°Ğ¢v†–ÆR‡6VÆV7FVDæÖU6WBæ†2†6æF–FFR’’°Ğ¢6æF–FFRÒG¶FVfVÇD&6Rç6Æ–6RƒÂÖF‚æÖ‚ƒÂ#Ò7G&–ær†’’æÆVæwF‚’—ÒG¶—Ö°Ğ¢’³Ò°Ğ¢ĞĞ¢6VÆV7FVDæÖU6WBæFB†6æF–FFR“°Ğ¢&WGW&â6æF–FFS°Ğ¢Ó°Ğ¢6öç7B6æ—F—¦TVÖö¦”æÖRÒ‡fÇVRÒrrÂfÆÆ&6²Òrr’Óâ°Ğ¢6öç7BG&–ÖÖVBÒ7G&–ær‡fÇVRÇÂrrĞ¢ç&WÆ6R‚õÇ2²örÂrrĞ¢çG&–Ò‚Ğ¢ç6Æ–6RƒÂ#“°Ğ¢&WGW&âG&–ÖÖVBÇÂfÆÆ&6³°Ğ¢Ó°Ğ Ğ¢6öç7B&W6—¦TVÖö¦”–ÖvT–dæVVFVBÒ7–æ2†f–ÆR’Óâ°Ğ¢–b‚f–ÆSòçG—Sòç7F'G5v—Fƒòâ‚v–ÖvRòr’’°Ğ¢&WGW&â²f–ÆRÂ&W6—¦VC¢fÇ6RÓ°Ğ¢ĞĞ¢òòt”bXúşˆ;ŞXÈ^Y
¾XªyK¾ûÈÎKùŞhÈXéşih~K»n˜şXXŞzNYØşXªY»àĞ¢–b†f–ÆRçG—RÓÓÒv–ÖvRöv–br’°Ğ¢&WGW&â²f–ÆRÂ&W6—¦VC¢fÇ6RÓ°Ğ¢ĞĞ Ğ¢6öç7Bö&¦V7EW&ÂÒU$Âæ7&VFTö&¦V7EU$Â†f–ÆR“°Ğ¢G'’°Ğ¢6öç7B–ÖrÒv—BæWr&öÖ—6R‚‡&W6öÇfRÂ&V¦V7B’Óâ°Ğ¢6öç7B–ÖvRÒæWr–ÖvR‚“°Ğ¢–ÖvRæöæÆöBÒ‚’Óâ&W6öÇfR†–ÖvR“°Ğ¢–ÖvRæöæW'&÷"Ò‚’Óâ&V¦V7B†æWrW'&÷"‚~Y»îx˜~Šz>zZK‹JRr’“°Ğ¢–ÖvRç7&2Òö&¦V7EW&Ã°Ğ¢Ò“°Ğ Ğ¢6öç7B7&5v–GF‚ÒçVÖ&W"†–ÖsòææGW&Åv–GF‚ÇÂ“°Ğ¢6öç7B7&4†V–v‡BÒçVÖ&W"†–ÖsòææGW&Ä†V–v‡BÇÂ“°Ğ¢–b‡7&5v–GF‚ÃÒÇÂ7&4†V–v‡BÃÒ’°Ğ¢&WGW&â²f–ÆRÂ&W6—¦VC¢fÇ6RÓ°Ğ¢ĞĞ Ğ¢6öç7B66ÆRÒÖF‚æÖ–âƒÂTÔô¤•ôÔ…ôD”ÔTå4”ôâòÖF‚æÖ‚‡7&5v–GF‚Â7&4†V–v‡B’“°Ğ¢–b‡66ÆRãÒ’°Ğ¢&WGW&â²f–ÆRÂ&W6—¦VC¢fÇ6RÓ°Ğ¢ĞĞ Ğ¢6öç7BF&vWEv–GF‚ÒÖF‚æÖ‚ƒÂÖF‚ç&÷VæB‡7&5v–GF‚¢66ÆR’“°Ğ¢6öç7BF&vWD†V–v‡BÒÖF‚æÖ‚ƒÂÖF‚ç&÷VæB‡7&4†V–v‡B¢66ÆR’“°Ğ¢6öç7B6çf2ÒFö7VÖVçBæ7&VFTVÆVÖVçB‚v6çf2r“°Ğ¢6çf2çv–GF‚ÒF&vWEv–GFƒ°Ğ¢6çf2æ†V–v‡BÒF&vWD†V–v‡C°Ğ Ğ¢6öç7B7G‚Ò6çf2ævWD6öçFW‡B‚s&Br“°Ğ¢–b‚7G‚’°Ğ¢&WGW&â²f–ÆRÂ&W6—¦VC¢fÇ6RÓ°Ğ¢ĞĞ¢7G‚æG&t–ÖvR†–ÖrÂÂÂF&vWEv–GF‚ÂF&vWD†V–v‡B“°Ğ Ğ¢6öç7BF&vWEG—RÒf–ÆRçG—RÓÓÒv–ÖvR÷ærpĞ¢òv–ÖvR÷ærpĞ¢¢†f–ÆRçG—RÓÓÒv–ÖvR÷vV'ròv–ÖvR÷vV'r¢v–ÖvRö§Vrr“°Ğ¢6öç7BVÆ—G’ÒF&vWEG—RÓÓÒv–ÖvRö§VrrÇÂF&vWEG—RÓÓÒv–ÖvR÷vV'ròã’¢VæFVf–æVC°Ğ Ğ¢6öç7B&W6—¦VD&Æö"Òv—BæWr&öÖ—6R‚‡&W6öÇfRÂ&V¦V7B’Óâ°Ğ¢6çf2çFô&Æö"‚†&Æö"’Óâ°Ğ¢–b†&Æö"’&W6öÇfR†&Æö"“°Ğ¢VÇ6R&V¦V7B†æWrW'&÷"‚~Y»îx˜~{ÊiKîZK‹JRr’“°Ğ¢ÒÂF&vWEG—RÂVÆ—G’“°Ğ¢Ò“°Ğ Ğ¢6öç7B&W6—¦VDf–ÆRÒæWrf–ÆR…·&W6—¦VD&Æö%ÒÂf–ÆRææÖRÂ°Ğ¢G—S¢&W6—¦VD&Æö"çG—RÇÂF&vWEG—RÀĞ¢Æ7DÖöF–f–VC¢FFRææ÷r‚Ğ¢Ò“°Ğ¢&WGW&â²f–ÆS¢&W6—¦VDf–ÆRÂ&W6—¦VC¢G'VRÓ°Ğ¢Ò6F6‚†W'"’°Ğ¢6öç6öÆRçv&â‚~Šh8^Y»îx˜~{ÊiKîZK‹J^ûÈÎ[{.Y¹î˜XéşY»îKˆ®KÊ¢rÂW'"“°Ğ¢&WGW&â²f–ÆRÂ&W6—¦VC¢fÇ6RÓ°Ğ¢Òf–æÆÇ’°Ğ¢U$Âç&Wfö¶Tö&¦V7EU$Â†ö&¦V7EW&Â“°Ğ¢ĞĞ¢Ó°Ğ Ğ¢6öç7BWÆöD7W7FöÔVÖö¦”&F6‚Ò7–æ2†—FV×2ÒµÒ’Óâ°Ğ¢ÆWB7V66W746÷VçBÒ°Ğ¢ÆWBf–Ä6÷VçBÒ°Ğ¢ÆWB&W6—¦VD6÷VçBÒ°Ğ Ğ¢f÷"†ÆWB’Ò²’Â—FV×2æÆVæwFƒ²’³Ò’°Ğ¢6öç7B—FVÒÒ—FV×5¶•Ó°Ğ¢6öç7B÷&–v–æÄf–ÆRÒ—FVÒæf–ÆS°Ğ¢6öç7BVÖö¦”FW67&—F–öâÒ6æ—F—¦TVÖö¦”æÖR†—FVÒææÖRÂŠh8RG¶’²Ö“°Ğ Ğ¢G'’°Ğ¢6öç7B²f–ÆRÂ&W6—¦VBÒÒv—B&W6—¦TVÖö¦”–ÖvT–dæVVFVB†÷&–v–æÄf–ÆR“°Ğ¢–b‡&W6—¦VB’&W6—¦VD6÷VçB³Ò°Ğ Ğ¢6öç7Bf–æÅW&ÂÒv—Bv–æF÷råf—'GVÅ†öæSòæ–ÖvTÖævW#òçWÆöD&Æö#òâ†f–ÆRÂvVÖö¦’r“°Ğ¢–b‚f–æÅW&Â’F‡&÷ræWrW'&÷"‚~Y»îx˜~Kˆ®KÊzêynYšiÊ®X‰ŞZx¾XÉbr“°Ğ Ğ¢F†—2æçvV6†DFFæFD7W7FöÔVÖö¦’‡°Ğ¢æÖS¢VÖö¦”FW67&—F–öâÀĞ¢FW67&—F–öã¢VÖö¦”FW67&—F–öâÀĞ¢–ÖvS¢f–æÅW&ÀĞ¢Ò“°Ğ¢7V66W746÷VçB³Ò°Ğ¢Ò6F6‚†W'"’°Ğ¢f–Ä6÷VçB³Ò°Ğ¢6öç6öÆRçv&â‚~Šh8^XÈ^Kˆ®KÊZK‹JS¢rÂW'"“°Ğ¢ĞĞ¢ĞĞ Ğ¢&WGW&â²7V66W746÷VçBÂf–Ä6÷VçBÂ&W6—¦VD6÷VçBÓ°Ğ¢Ó°Ğ Ğ¢VW'’‚r6&6²Ög&öÒÖFBÖVÖö¦’r“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢F†—2æç&VæFW"‚“°Ğ¢Ò“°Ğ Ğ¢VW'’‚r7–6²Ö7W7FöÒÖVÖö¦’r“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢–b†—5WÆöF–ær’&WGW&ã°Ğ¢VW'’‚r6VÖö¦’Ö–ÖvR×WÆöBr“òæ6Æ–6²‚“°Ğ¢Ò“°Ğ Ğ¢VW'’‚r6VÖö¦’Ö–ÖvR×WÆöBr“òæFDWfVçDÆ—7FVæW"‚v6†ævRrÂ7–æ2†R’Óâ°Ğ¢6öç7Bf–ÆW2Ò'&’æg&öÒ†SòçF&vWCòæf–ÆW2ÇÂµÒ“°Ğ¢RçF&vWBçfÇVRÒrs°Ğ¢–b‚f–ÆW2æÆVæwF‚ÇÂ—5WÆöF–ær’&WGW&ã°Ğ Ğ¢ÆWB6¶—VBÒ°Ğ¢6öç7B6VÆV7FVD—FV×2ÒµÓ°Ğ¢f÷"†6öç7Bf–ÆRöbf–ÆW2’°Ğ¢–b‚f–ÆSòçG—Sòç7F'G5v—Fƒòâ‚v–ÖvRòr’’°Ğ¢6¶—VB³Ò°Ğ¢6öçF–çVS°Ğ¢ĞĞ¢–b†f–ÆRç6—¦RâTÔô¤•õ$uôd”ÄUôÔ…õ4•¤R’°Ğ¢6¶—VB³Ò°Ğ¢6öçF–çVS°Ğ¢ĞĞ¢G'’°Ğ¢6öç7BWFôæÖRÒ'V–ÆDVÖö¦”æÖR†f–ÆSòææÖRÂ6VÆV7FVD—FV×2æÆVæwF‚²“°Ğ¢6VÆV7FVD—FV×2çW6‚‡°Ğ¢f–ÆRÀĞ¢æÖS¢WFôæÖPĞ¢Ò“°Ğ¢Ò6F6‚†W'"’°Ğ¢6¶—VB³Ò°Ğ¢ĞĞ¢ĞĞ Ğ¢–b‡6¶—VBâ’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ[{.‹{>‹ørG·6¶—VGÒ[ÊKˆŞYŠxNY»îx˜vÂ~)ªûˆòr“°Ğ¢ĞĞ¢–b‡6VÆV7FVD—FV×2æÆVæwF‚ÓÓÒ’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~Šû~XX˜hºˆ{>[	Kˆ[ÊY»îx˜rrÂ~)ªûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢—5WÆöF–ærÒG'VS°Ğ¢6öç7B–6´'FâÒVW'’‚r7–6²Ö7W7FöÒÖVÖö¦’r“°Ğ¢–b‡–6´'Fâ’–6´'FâæF—6&ÆVBÒG'VS°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~ZHNynKŠÒrÂjÚ>YÊKˆ®KÊG·6VÆV7FVD—FV×2æÆVæwF‡Ò[ÊŠh8RââæÂ~(û2r“°Ğ Ğ¢G'’°Ğ¢6öç7B²7V66W746÷VçBÂf–Ä6÷VçBÂ&W6—¦VD6÷VçBÒÒv—BWÆöD7W7FöÔVÖö¦”&F6‚‡6VÆV7FVD—FV×2“°Ğ Ğ¢–b‡7V66W746÷VçBâ’°Ğ¢6öç7B7Vff—‚Òf–Ä6÷VçBâòûÈÎZK‹JRG¶f–Ä6÷VçGÒ[Ê¢rs°Ğ¢6öç7B&W6—¦VD†–çBÒ&W6—¦VD6÷VçBâòûÈÎ[{.zØjùN{Ê[òG·&W6—¦VD6÷VçGÒ[Ê¢rs°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~k{¾Xªh‰X©òrÂ[{.k{¾XªG·7V66W746÷VçGÒ[ÊŠh8RG·&W6—¦VD†–çGÒG·7Vff—‡ÖÂ~)ÈRr“°Ğ¢F†—2æVÖö¦•F"Òv7W7FöÒs°Ğ¢6WEF–ÖV÷WB‚‚’ÓâF†—2æç&VæFW"‚’Â3“°Ğ¢ÒVÇ6R°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~Kˆ®KÊZK‹JRrÂ~Šh8^Kˆ®KÊZK‹J^ûÈÎŠû~j8iú^˜Y.šhnYîXûrÂ~)ØÂr“°Ğ¢ĞĞ¢Òf–æÆÇ’°Ğ¢–b‡–6´'Fâ’–6´'FâæF—6&ÆVBÒfÇ6S°Ğ¢—5WÆöF–ærÒfÇ6S°Ğ¢ĞĞ¢Ò“°Ğ¢ĞĞ Ğ¢7–æ2ÖævT7W7FöÔVÖö¦’†VÖö¦”–B’°Ğ¢–b‡F†—2åö7W7FöÔVÖö¦”ÖævT'W7’ÇÂFFRææ÷r‚’Â‡F†—2åö7W7FöÔVÖö¦”ÖævU7W&W75VçF–ÂÇÂ’’&WGW&ã°Ğ¢F†—2åö7W7FöÔVÖö¦”ÖævT'W7’ÒG'VS°Ğ¢G'’°Ğ¢6öç7BVÖö¦’ÒF†—2æçvV6†DFFævWD7W7FöÔVÖö¦’†VÖö¦”–B“°Ğ¢–b‚VÖö¦’’&WGW&ã°Ğ Ğ¢6öç7B7W'&VçDFW67&—F–öâÒ7G&–ær†VÖö¦’æFW67&—F–öâÇÂVÖö¦’ææÖRÇÂrr’çG&–Ò‚“°Ğ¢6öç7BæW‡DFW67&—F–öå&rÒv–æF÷rç&ö×B€Ğ¢~KúîiK‹ùKŠ®ˆz®Zé®K˜Šh8^y¨N{«şKˆ¾høş‹û8%ÆåÆî{«şKˆ®Xù˜i{nK¸ŞxKnXùY»îx˜~ûÉ¾Xú®iÈ{«şKˆ¾jÚ>ih~k:XZ^i{nKÉ®‹ÚÎh‰‹ùKŠ®høş‹û8%ÆåÆî‹é>XZRöFVÆWFRXúşXŠ™šNŠú^Šh8^8"rÀĞ¢7W'&VçDFW67&—F–öàĞ¢“°Ğ Ğ¢–b†æW‡DFW67&—F–öå&rÓÓÒçVÆÂ’&WGW&ã°Ğ Ğ¢6öç7Bæ÷&ÖÆ—¦VBÒ7G&–ær†æW‡DFW67&—F–öå&rÇÂrr’ç&WÆ6R‚õÇ2²örÂrr’çG&–Ò‚’ç6Æ–6RƒÂ#“°Ğ¢–b†æ÷&ÖÆ—¦VBÓÓÒröFVÆWFRr’°Ğ¢6öç7Bö²Òv–æF÷ræ6öæf—&Ò†zîZé®XŠ™šNŠh8^(	ÂG¶VÖö¦’ææÖRÇÂ7W'&VçDFW67&—F–öâÇÂ~iÊ®YŞYŞŠh8RwŞ(	ŞY	~ûÉö“°Ğ¢–b‚ö²’&WGW&ã°Ğ Ğ¢ÆWBf–ÆT6ÆVçWf–ÆVBÒfÇ6S°Ğ¢6öç7B–ÖvTÖævW"Òv–æF÷råf—'GVÅ†öæSòæ–ÖvTÖævW#°Ğ¢–b†–ÖvTÖævW#òæFVÆWFTÖævVD&6¶w&÷VæD'•F‚’°Ğ¢G'’°Ğ¢6öç7B&W7VÇBÒv—B–ÖvTÖævW"æFVÆWFTÖævVD&6¶w&÷VæD'•F‚†VÖö¦’æ–ÖvRÂ²V–WC¢G'VRÒ“°Ğ¢f–ÆT6ÆVçWf–ÆVBÒ&W7VÇCòæGFV×FVBÓÓÒG'VRbb&W7VÇCòç7V66W72ÓÒG'VS°Ğ¢Ò6F6‚†R’°Ğ¢f–ÆT6ÆVçWf–ÆVBÒG'VS°Ğ¢ĞĞ¢ĞĞ Ğ¢F†—2æçvV6†DFFæFVÆWFT7W7FöÔVÖö¦’†VÖö¦”–B“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ€Ğ¢~[{.XŠ™šBrÀĞ¢f–ÆT6ÆVçWf–ÆVBò~ˆz®Zé®K˜Šh8^[{.XŠ™šNûÈiz~Y»îx˜~kˆ^ynZK‹J^ûÈ’r¢~ˆz®Zé®K˜Šh8^[{.XŠ™šBrÀĞ¢f–ÆT6ÆVçWf–ÆVBò~)ªûˆòr¢	ùyûˆòpĞ¢“°Ğ¢F†—2æç&VæFW"‚“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢–b‚æ÷&ÖÆ—¦VB’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~høş‹ûKˆŞˆ;ŞK‹®z›¢rÂ~)ªûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢F†—2æçvV6†DFFçWFFT7W7FöÔVÖö¦’†VÖö¦”–BÂ°Ğ¢æÖS¢æ÷&ÖÆ—¦VBÀĞ¢FW67&—F–öã¢æ÷&ÖÆ—¦V@Ğ¢Ò“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~[{.i»NikrÂ~Šh8^høş‹û[{.KùŞZÙ‚rÂ~)ÈRr“°Ğ¢F†—2æç&VæFW"‚“°Ğ¢Òf–æÆÇ’°Ğ¢F†—2åö7W7FöÔVÖö¦”ÖævT'W7’ÒfÇ6S°Ğ¢F†—2åö7W7FöÔVÖö¦”ÖævU7W&W75VçF–ÂÒFFRææ÷r‚’²c°Ğ¢ĞĞ¢ĞĞ Ğ¢òò	ùIB˜	®yJ„˜	®yú^ikk9PĞ¢7–æ2æ÷F–g”’†ÖW76vR’°Ğ¢–b‚F†—2æ—4öæÆ–æTÖöFR‚’’&WGW&ã°Ğ Ğ¢G'’°Ğ¢6öç7B6öçFW‡BÒv–æF÷rå6–ÆÇ•FfW&ãòævWD6öçFW‡Còâ‚“°Ğ¢–b‚6öçFW‡B’&WGW&ã°Ğ Ğ¢6öç7B&ö×BÒG¶6öçFW‡BææÖSÇÂ~yJh‹rwÒG¶ÖW76vWÖ°Ğ Ğ¢òò™Ù›¹‹>yJ„Ğ¢v—BF†—2ç6VæEFô”†–FFVâ‡&ö×BÂ6öçFW‡B“°Ğ Ğ¢Ò6F6‚†W'&÷"’°Ğ¢6öç6öÆRæW'&÷"‚~)ØÂ˜	®yúTZK‹JS¢rÂW'&÷"“°Ğ¢ĞĞ¢ĞĞ Ğ¢ö6Æ–Ôw&÷W&VE6¶WDf÷$7W'&VçEW6W"†6†D–BÂÖW76vRÒ·Ò’°Ğ¢6öç7B6fT6†D–BÒ7G&–ær†6†D–BÇÂrr’çG&–Ò‚“°Ğ¢6öç7B6¶WDÖöFRÒ7G&–ær†ÖW76vRç6¶WDÖöFRÇÂrr’çG&–Ò‚“°Ğ¢6öç7B—4w&÷W6¶WBÒÖW76vRæ—4w&÷W6¶WBÓÓÒG'VRÇÂ6¶WDÖöFRÓÓÒvw&÷WöÇV6·’rÇÂ6¶WDÖöFRÓÓÒvw&÷WöfW&vRs°Ğ¢6öç7B6¶WE7FGW2Ò7G&–ær†ÖW76vRç7FGW2ÇÂrr’çG&–Ò‚“°Ğ¢–b‚6fT6†D–BÇÂÖW76vSòæ–BÇÂ—4w&÷W6¶WBÇÂ6¶WE7FGW2ÓÓÒw&VgVæFVBrÇÂ6¶WE7FGW2ÓÓÒv÷VæVBr’&WGW&âçVÆÃ°Ğ Ğ¢6öç7BW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfóòâ‚’ÇÂ·Ó°Ğ¢6öç7BW6W$æÖRÒ7G&–ær‡W6W$–æfòææÖRÇÂ~h‰r’çG&–Ò‚’ÇÂ~h‰s°Ğ¢6öç7B6VæFW$æÖRÒ7G&–ær†ÖW76vRæg&öÒÓÓÒvÖRròW6W$æÖR¢†ÖW76vRæg&öÒÇÂrr’’çG&–Ò‚“°Ğ Ğ¢6öç7B&Wf–÷W46Æ–×2Ò'&’æ—4'&’†ÖW76vRæ6Æ–×2’òÖW76vRæ6Æ–×2¢µÓ°Ğ¢6öç7BW6W$¶W’ÒF†—2åöæ÷&ÖÆ—¦TÆöö·WæÖR‡W6W$æÖR“°Ğ¢–b‚W6W$¶W’ÇÂ&Wf–÷W46Æ–×2ç6öÖR†6Æ–ÒÓâF†—2åöæ÷&ÖÆ—¦TÆöö·WæÖR†6Æ–ÓòææÖR’ÓÓÒW6W$¶W’’’&WGW&âçVÆÃ°Ğ Ğ¢6öç7B6Æ–ÔÖ÷VçBÒF†—2åö6Æ7VÆFTw&÷W&VE6¶WD6Æ–ÔÖ÷VçB†ÖW76vRÂ&Wf–÷W46Æ–×2“°Ğ¢–b‚çVÖ&W"æ—4f–æ—FR†6Æ–ÔÖ÷VçB’ÇÂ6Æ–ÔÖ÷VçBÃÒ’&WGW&âçVÆÃ°Ğ Ğ¢6öç7B6¶WD6÷VçBÒÖF‚æÖ‚ƒÂçVÖ&W"ç'6T–çB†ÖW76vRæ6÷VçBÇÂÖW76vRç6¶WD6÷VçBÇÂÂ’ÇÂ“°Ğ¢6öç7BF÷FÄÖ÷VçBÒçVÖ&W"ç'6TfÆöB†ÖW76vRæÖ÷VçBÇÂ“°Ğ¢6öç7B6Æ–×2Ò²ââç&Wf–÷W46Æ–×2Â°Ğ¢æÖS¢W6W$æÖRÀĞ¢Ö÷VçC¢6Æ–ÔÖ÷VçBçFôf—†VBƒ"’ÀĞ¢ÖöFS¢6¶WDÖöFRÓÓÒvw&÷WöÇV6·’ròvÇV6·’r¢vfW&vRrÀĞ¢F–ÖW7F×¢FFRææ÷r‚Ğ¢ÕÓ°Ğ¢6öç7B6Æ–ÖVDÖ÷VçBÒ6Æ–×2ç&VGV6R‚‡7VÒÂ6Æ–Ò’Óâ7VÒ²ÖF‚ç&÷VæB‚„çVÖ&W"ç'6TfÆöB†6Æ–ÓòæÖ÷VçBÇÂ’ÇÂ’¢’Â’ò°Ğ¢6öç7B—4gVÆÇ”6Æ–ÖVBÒ‡6¶WD6÷VçBâbb6Æ–×2æÆVæwF‚ãÒ6¶WD6÷VçBĞ¢ÇÂ„çVÖ&W"æ—4f–æ—FR‡F÷FÄÖ÷VçB’bb6Æ–ÖVDÖ÷VçBãÒF÷FÄÖ÷VçB“°Ğ¢6öç7BWFFVDÖW76vRÒF†—2æçvV6†DFFçWFFTÖW76vT'”–B‡6fT6†D–BÂÖW76vRæ–BÂ°Ğ¢7FGW3¢—4gVÆÇ”6Æ–ÖVBòv÷VæVBr¢w6VçBrÀĞ¢6Æ–×2ÀĞ¢6¶WD6Æ–Ô6÷VçC¢6Æ–×2æÆVæwF‚ÀĞ¢6Æ–ÖVDÖ÷VçC¢6Æ–ÖVDÖ÷VçBçFôf—†VBƒ"’ÀĞ¢&VÖ–æ–ætÖ÷VçC¢çVÖ&W"æ—4f–æ—FR‡F÷FÄÖ÷VçB’òÖF‚æÖ‚ƒÂF÷FÄÖ÷VçBÒ6Æ–ÖVDÖ÷VçB’çFôf—†VBƒ"’¢sãrÀĞ¢Æ7D6Æ–ÖVD'“¢W6W$æÖRÀĞ¢Æ7D6Æ–ÖVDÖ÷VçC¢6Æ–ÔÖ÷VçBçFôf—†VBƒ"’ÀĞ¢–ÖVçD†æFÆVD'“¢W6W$æÖRÀĞ¢–ÖVçD†æFÆVDC¢FFRææ÷r‚Ğ¢Ò“°Ğ¢–b‚WFFVDÖW76vR’&WGW&âçVÆÃ°Ğ Ğ¢F†—2æçvV6†DFFçWFFUvÆÆWD&Ææ6R†6Æ–ÔÖ÷VçBÂçVÆÂÂ°Ğ¢G—S¢w&VG6¶WBrÀĞ¢F—FÆS¢{êN{ª.XÈ^iKnXZRÒG·6VæFW$æÖRÇÂF†—2ææ7W'&VçD6†CòææÖRÇÂ~{êNh‰Y‚wÖÀĞ¢FWF–Ã¢6¶WDÖöFRÓÓÒvw&÷WöfW&vRrò~YØ~Xˆn{êN{ª.XÈRr¢~h»Îh˜¾k	N{êN{ª.XÈRrÀĞ¢6÷W&6S¢wvV6†BrÀĞ¢6†D–C¢6fT6†D–BÀĞ¢6÷VçFW''G“¢6VæFW$æÖRÀĞ¢ÖW76vT–C¢7G&–ær†ÖW76vRæ–BÇÂrr’ÀĞ¢&VfW&Væ6T–C¢vV6†C§&VG6¶WC¦w&÷WÖ6Æ–Ó¢G¶ÖW76vRæ–GÓ¢G·W6W$¶W—ÖÀĞ¢FFS¢ÖW76vRæFFRÀĞ¢F–ÖS¢ÖW76vRçF–ÖRÀĞ¢vVV¶F“¢ÖW76vRçvVV¶F’ÀĞ¢F–ÖW7F×¢ÖW76vRçF–ÖW7F×ÀĞ¢&VÅF–ÖW7F×¢ÖW76vRç&VÅF–ÖW7F×ÀĞ¢g&öÔÖ–ä6†EFs¢ÖW76vRæg&öÔÖ–ä6†EFrÓÓÒG'VRÀĞ¢FfW&äÖW76vT–æFWƒ¢ÖW76vRçFfW&äÖW76vT–æFW‚ÀĞ¢&F6„–C¢ÖW76vRæ&F6„–@Ğ¢Ò“°Ğ Ğ¢&WGW&â²ÖW76vS¢WFFVDÖW76vRÂÖ÷VçC¢6Æ–ÔÖ÷VçBÓ°Ğ¢ĞĞ Ğ¢÷6†÷t–æ6öÖ–æu&VE6¶WD÷Vå&ö×B†6†D–BÂÖW76vRÒ·Ò’°Ğ¢6öç7B6fT6†D–BÒ7G&–ær†6†D–BÇÂrr’çG&–Ò‚“°Ğ¢–b‚6fT6†D–BÇÂÖW76vSòæ–B’&WGW&ã°Ğ Ğ¢6öç7B7W'&VçEf–WrÒFö7VÖVçBçVW'•6VÆV7F÷"‚rç†öæR×f–WrÖ7W'&VçBrĞ¢ÇÂFö7VÖVçBçVW'•6VÆV7F÷"‚rç†öæR×67&VVâr“°Ğ¢–b‚7W'&VçEf–Wr’&WGW&ã°Ğ Ğ¢7W'&VçEf–WrçVW'•6VÆV7F÷"‚r7vV6†B×&VG6¶WBÖ÷VâÖ÷fW&Æ’r“òç&VÖ÷fR‚“°Ğ Ğ¢6öç7B6VæFW$æÖRÒ7G&–ær†ÖW76vRæg&öÒÇÂF†—2ææ7W'&VçD6†CòææÖRÇÂ~[êîKúZ[ŞXø²r’çG&–Ò‚’ÇÂ~[êîKúZ[ŞXø²s°Ğ¢6öç7B6öçF7BÒF†—2æçvV6†DFFævWD6öçF7D'”æÖR‡6VæFW$æÖR“°Ğ¢6öç7BfF$‡FÖÂÒF†—2æç&VæFW$fF"†6öçF7CòæfF"ÇÂ	úzrrÂ	úzrrÂ6VæFW$æÖR“°Ğ¢6öç7B÷fW&Æ’ÒFö7VÖVçBæ7&VFTVÆVÖVçB‚vF—br“°Ğ¢÷fW&Æ’æ–BÒwvV6†B×&VG6¶WBÖ÷VâÖ÷fW&Æ’s°Ğ¢÷fW&Æ’æ6Æ74æÖRÒwvV6†B×&VG6¶WBÖ÷VâÖ÷fW&Æ’s°Ğ¢÷fW&Æ’æ–ææW$…DÔÂÒ Ğ¢ÆF—b6Æ73Ò'vV6†B×&VG6¶WBÖ÷VâÖ&6¶G&÷#ãÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†B×&VG6¶WBÖ÷VâÖF–Æör"&öÆSÒ&F–Æör"&–ÖÖöFÃÒ'G'VR"&–ÖÆ&VÃÒ.h™>[È{ª.XÈR#àĞ¢ÆF—b6Æ73Ò'vV6†B×&VG6¶WBÖ÷VâÖ6&B#àĞ¢ÆF—b6Æ73Ò'vV6†B×&VG6¶WBÖ÷VâÖfF"#âG¶fF$‡FÖÇÓÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†B×&VG6¶WBÖ÷Vâ×6VæFW"#âG·F†—2åöW66T‡FÖÂ‡6VæFW$æÖR—ŞXùiÚ^y¨N{ª.XÈSÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†B×&VG6¶WBÖ÷Vâ×v—6‚#âG·F†—2åöW66T‡FÖÂ…7G&–ær†ÖW76vRçv—6‚ÇÂ~hŞYiÎXù‹J.ûÈÎZJ~YZJ~XŠ’r’—ÓÂöF—càĞ¢Æ'WGFöâG—SÒ&'WGFöâ"6Æ73Ò'vV6†B×&VG6¶WBÖ÷VâÖ'WGFöâ"–CÒ&6öæf—&ÒÖ÷Vâ×&VG6¶WB"&–ÖÆ&VÃÒ.h™>[È{ª.XÈR#î™h³Âö'WGFöãàĞ¢ÂöF—càĞ¢Æ'WGFöâG—SÒ&'WGFöâ"6Æ73Ò'vV6†B×&VG6¶WBÖ÷VâÖ6Æ÷6R"–CÒ&6Æ÷6R×&VG6¶WB×&ö×B"&–ÖÆ&VÃÒ.X[>™zÒ#àĞ¢Æ’6Æ73Ò&f×6öÆ–Bf×†Ö&²#ãÂö“àĞ¢Âö'WGFöãàĞ¢ÂöF—càĞ¢°Ğ¢7W'&VçEf–WræVæD6†–ÆB†÷fW&Æ’“°Ğ Ğ¢6öç7B6Æ÷6U&ö×BÒ‚’Óâ÷fW&Æ’ç&VÖ÷fR‚“°Ğ¢÷fW&Æ’çVW'•6VÆV7F÷"‚r66Æ÷6R×&VG6¶WB×&ö×Br“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ6Æ÷6U&ö×B“°Ğ¢÷fW&Æ’çVW'•6VÆV7F÷"‚rçvV6†B×&VG6¶WBÖ÷VâÖ&6¶G&÷r“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ6Æ÷6U&ö×B“°Ğ¢÷fW&Æ’çVW'•6VÆV7F÷"‚r66öæf—&ÒÖ÷Vâ×&VG6¶WBr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂWfVçBÓâ°Ğ¢6öç7B'WGFöâÒWfVçBæ7W'&VçEF&vWC°Ğ¢–b†'WGFöâæFF6WBæ÷Væ–ærÓÓÒsr’&WGW&ã°Ğ¢'WGFöâæFF6WBæ÷Væ–ærÒss°Ğ¢'WGFöâæF—6&ÆVBÒG'VS°Ğ¢÷fW&Æ’æ6Æ74Æ—7BæFB‚v—2Ö÷Væ–ærr“°Ğ¢v–æF÷rç6WEF–ÖV÷WB‚‚’Óâ°Ğ¢÷fW&Æ’ç&VÖ÷fR‚“°Ğ¢F†—2æ÷Vå&VE6¶WB†ÖW76vRæ–BÂ²WFô÷Vã¢G'VRÒ“°Ğ¢ÒÂ#c“°Ğ¢Ò“°Ğ¢ĞĞ Ğ¢òò	úzrh™>[È{ª.XÈ^Šúnh8^yXÎ™Ú.ûÈXZikûÈĞ¢÷Vå&VE6¶WB†ÖW76vT–BÂ²WFô÷VâÒfÇ6RÒÒ·Ò’°Ğ¢6öç7B6†D–BÒF†—2ææ7W'&VçD6†Còæ–C°Ğ¢–b‚6†D–B’&WGW&ã°Ğ¢6öç7BÖW76vW2ÒF†—2æçvV6†DFFævWDÖW76vW2†6†D–B“°Ğ¢ÆWBÖW76vRÒÖW76vW2æf–æB†ÒÓâÒæ–BÓÓÒÖW76vT–B“°Ğ¢–b‚ÖW76vR’&WGW&ã°Ğ Ğ¢6öç7B–æ—F–Å6¶WDÖöFRÒ7G&–ær†ÖW76vRç6¶WDÖöFRÇÂrr’çG&–Ò‚“°Ğ¢6öç7B–æ—F–Ä—4w&÷W6¶WBÒÖW76vRæ—4w&÷W6¶WBÓÓÒG'VRÇÂ–æ—F–Å6¶WDÖöFRÓÓÒvw&÷WöÇV6·’rÇÂ–æ—F–Å6¶WDÖöFRÓÓÒvw&÷WöfW&vRs°Ğ¢6öç7B–æ—F–Å7FGW2Ò7G&–ær†ÖW76vRç7FGW2ÇÂrr’çG&–Ò‚“°Ğ¢6öç7BW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfóòâ‚’ÇÂ·Ó°Ğ¢6öç7BW6W$æÖRÒ7G&–ær‡W6W$–æfòææÖRÇÂrr’çG&–Ò‚“°Ğ¢6öç7B—4ÖT–æ—F–ÆÇ’ÒÖW76vRæg&öÒÓÓÒvÖRrÇÂÖW76vRæg&öÒÓÓÒW6W$æÖS°Ğ¢6öç7B†47W'&VçEW6W$6Æ–ÖVBÒ–æ—F–Ä—4w&÷W6¶WBbb'&’æ—4'&’†ÖW76vRæ6Æ–×2Ğ¢bbÖW76vRæ6Æ–×2ç6öÖR†6Æ–ÒÓâF†—2åöæ÷&ÖÆ—¦TÆöö·WæÖR†6Æ–ÓòææÖR’ÓÓÒF†—2åöæ÷&ÖÆ—¦TÆöö·WæÖR‡W6W$æÖR’“°Ğ¢6öç7B6ä÷Vä–æ6öÖ–æu6¶WBÒ—4ÖT–æ—F–ÆÇĞ¢bb–æ—F–Å7FGW2ÓÒw&VgVæFVBpĞ¢bb†–æ—F–Ä—4w&÷W6¶W@Ğ¢ò–æ—F–Å7FGW2ÓÒv÷VæVBrbb†47W'&VçEW6W$6Æ–ÖV@Ğ¢¢–æ—F–Å7FGW2ÓÒv÷VæVBr“°Ğ Ğ¢–b†6ä÷Vä–æ6öÖ–æu6¶WBbbWFô÷Vâ’°Ğ¢F†—2å÷6†÷t–æ6öÖ–æu&VE6¶WD÷Vå&ö×B†6†D–BÂÖW76vR“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢–b†–æ—F–Ä—4w&÷W6¶WB’°Ğ¢6öç7B6Æ–Õ&W7VÇBÒF†—2åö6Æ–Ôw&÷W&VE6¶WDf÷$7W'&VçEW6W"†6†D–BÂÖW76vR“°Ğ¢–b†6Æ–Õ&W7VÇCòæÖW76vR’°Ğ¢ÖW76vRÒ6Æ–Õ&W7VÇBæÖW76vS°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~š(nXùn{êN{ª.XÈRrÂ[{.š(nXùb*RG¶6Æ–Õ&W7VÇBæÖ÷VçBçFôf—†VBƒ"—ÖÂ	úzrr“°Ğ¢ĞĞ¢ĞĞ Ğ¢6öç7B—4ÖRÒÖW76vRæg&öÒÓÓÒvÖRrÇÂÖW76vRæg&öÒÓÓÒF†—2æçvV6†DFFævWEW6W$–æfò‚’ææÖS°Ğ¢6öç7B6¶WDÖöFRÒ7G&–ær†ÖW76vRç6¶WDÖöFRÇÂrr’çG&–Ò‚“°Ğ¢6öç7B—4w&÷W6¶WBÒÖW76vRæ—4w&÷W6¶WBÓÓÒG'VRÇÂ6¶WDÖöFRÓÓÒvw&÷WöÇV6·’rÇÂ6¶WDÖöFRÓÓÒvw&÷WöfW&vRs°Ğ¢6öç7B6Æ–×2Ò'&’æ—4'&’†ÖW76vRæ6Æ–×2’òÖW76vRæ6Æ–×2¢µÓ°Ğ¢6öç7B6¶WD6÷VçBÒÖF‚æÖ‚ƒÂçVÖ&W"ç'6T–çB†ÖW76vRæ6÷VçBÇÂÖW76vRç6¶WD6÷VçBÇÂÂ’ÇÂ“°Ğ¢6öç7BF÷FÄÖ÷VçBÒçVÖ&W"ç'6TfÆöB†ÖW76vRæÖ÷VçBÇÂ“°Ğ¢6öç7B6Æ–ÖVDÖ÷VçBÒ6Æ–×2ç&VGV6R‚‡7VÒÂ6Æ–Ò’Óâ°Ğ¢6öç7BÖ÷VçBÒçVÖ&W"ç'6TfÆöB†6Æ–ÓòæÖ÷VçBÇÂ“°Ğ¢&WGW&â7VÒ²„çVÖ&W"æ—4f–æ—FR†Ö÷VçB’òÖ÷VçB¢“°Ğ¢ÒÂ“°Ğ¢ÆWB&W6öÇfVE7FGW2Ò7G&–ær†ÖW76vRç7FGW2ÇÂrr’çG&–Ò‚“°Ğ¢ÆWB—4÷VæVBÒ&W6öÇfVE7FGW2ÓÓÒv÷VæVBs°Ğ¢ÆWB—5&VgVæFVBÒ&W6öÇfVE7FGW2ÓÓÒw&VgVæFVBs°Ğ¢6öç7B6öçF7BÒF†—2æçvV6†DFFævWD6öçF7D'”æÖR†ÖW76vRæg&öÒ“°Ğ Ğ¢–b‚—4ÖRbb—4w&÷W6¶WBbb—4÷VæVBbb—5&VgVæFVB’°Ğ¢6öç7BWFFVDÖW76vRÒF†—2æçvV6†DFFçWFFTÖW76vT'”–B†6†D–BÂÖW76vT–BÂ²7FGW3¢v÷VæVBrÒ“°Ğ¢&W6öÇfVE7FGW2Ò7G&–ær‡WFFVDÖW76vSòç7FGW2ÇÂv÷VæVBr’çG&–Ò‚“°Ğ¢—4÷VæVBÒ&W6öÇfVE7FGW2ÓÓÒv÷VæVBs°Ğ¢—5&VgVæFVBÒ&W6öÇfVE7FGW2ÓÓÒw&VgVæFVBs°Ğ¢òòiKn{ª.XÈ^ûÈÎXª™+Ğ¢6öç7B'Ö÷VçBÒ'6TfÆöB†ÖW76vRæÖ÷VçB’ÇÂ°Ğ¢F†—2æçvV6†DFFçWFFUvÆÆWD&Ææ6R‡'Ö÷VçBÂçVÆÂÂ°Ğ¢G—S¢w&VG6¶WBrÀĞ¢F—FÆS¢{ª.XÈ^iKnXZRÒGµ7G&–ær†ÖW76vRæg&öÒÇÂF†—2ææ7W'&VçD6†CòææÖRÇÂ~[êîKúZ[ŞXø²r—ÖÀĞ¢FWF–Ã¢7G&–ær†ÖW76vRçv—6‚ÇÂ~[êîKú{ª.XÈRr’ÀĞ¢6÷W&6S¢wvV6†BrÀĞ¢6†D–BÀĞ¢6÷VçFW''G“¢7G&–ær†ÖW76vRæg&öÒÇÂrr’ÀĞ¢ÖW76vT–BÀĞ¢&VfW&Væ6T–C¢vV6†C§&VG6¶WC§&V6V—fS¢G¶ÖW76vT–GÖÀĞ¢FFS¢ÖW76vRæFFRÀĞ¢F–ÖS¢ÖW76vRçF–ÖRÀĞ¢vVV¶F“¢ÖW76vRçvVV¶F’ÀĞ¢F–ÖW7F×¢ÖW76vRçF–ÖW7F×ÀĞ¢&VÅF–ÖW7F×¢ÖW76vRç&VÅF–ÖW7F×ÀĞ¢g&öÔÖ–ä6†EFs¢ÖW76vRæg&öÔÖ–ä6†EFrÓÓÒG'VRÀĞ¢FfW&äÖW76vT–æFWƒ¢ÖW76vRçFfW&äÖW76vT–æFW‚ÀĞ¢&F6„–C¢ÖW76vRæ&F6„–@Ğ¢Ò“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~[êîKú{ª.XÈRrÂ[{.ZÙXZ^™»n™+¢*RG·'Ö÷VçBçFôf—†VBƒ"—ÖÂrr“°Ğ¢ĞĞ Ğ¢6öç7B6VæFW$æÖRÒÖW76vRæg&öÒÓÓÒvÖRròF†—2æçvV6†DFFævWEW6W$–æfò‚’ææÖR¢ÖW76vRæg&öÓ°Ğ¢6öç7BbÒ6öçF7CòæfF"ÇÂ†ÖW76vRæg&öÒÓÓÒvÖRròF†—2æçvV6†DFFævWEW6W$–æfò‚’æfF"¢	ùBr“°Ğ¢6öç7BfF$‡FÖÂÒF†—2æç&VæFW$fF"†bÂ	ùBrÂ6VæFW$æÖR“°Ğ¢6öç7B—4gVÆÇ”6Æ–ÖVBÒ—4w&÷W6¶WBbb6¶WD6÷VçBâbb6Æ–×2æÆVæwF‚ãÒ6¶WD6÷VçC°Ğ¢6öç7B&VE6¶WE7FGW5FW‡BÒ—4w&÷W6¶W@Ğ¢ò†—5&VgVæFV@Ğ¢ò†—4ÖRò~{ª.XÈ^[{.˜Y¹âr¢~{ª.XÈ^[{.Š*¾˜Y¹ârĞ¢¢†—4gVÆÇ”6Æ–ÖVBò~{ª.XÈ^[{.š(nZèÂr¢†6Æ–×2æÆVæwF‚âò[{.š(nXùbG¶6Æ–×2æÆVæwF‡ÒòG·6¶WD6÷VçBÇÂ6Æ–×2æÆVæwF‡ÒKŠ¦¢~{ª.XÈ^[{.XùX{¢r’’Ğ¢¢†—5&VgVæFV@Ğ¢ò†—4ÖRò~{ª.XÈ^[{.˜Y¹âr¢~{ª.XÈ^[{.Š*¾˜Y¹ârĞ¢¢†—4ÖRò†—4÷VæVBò~{ª.XÈ^[{.Š*¾š(nXùbr¢~{ª.XÈ^[{.XùX{¢r’¢~[{.ZÙXZ^™»n™+r’“°Ğ¢6öç7Bw&÷W6Æ–Õ&öw&W75FW‡BÒ6¶WD6÷VçBâ Ğ¢ò[{.š(nXùbG¶6Æ–×2æÆVæwF‡ÒòG·6¶WD6÷VçGÒKŠ®ûÈÎX[G¶6Æ–ÖVDÖ÷VçBçFôf—†VBƒ"—ÒòG´çVÖ&W"æ—4f–æ—FR‡F÷FÄÖ÷VçB’òF÷FÄÖ÷VçBçFôf—†VBƒ"’¢sãwÒXX6 Ğ¢¢[{.š(nXùbG¶6Æ–×2æÆVæwF‡ÒKŠ®ûÈÎX[G¶6Æ–ÖVDÖ÷VçBçFôf—†VBƒ"—ÒXX6°Ğ¢6öç7Bw&÷W6Æ–Õ&÷w4‡FÖÂÒ6Æ–×2æÖ†6Æ–ÒÓâ°Ğ¢6öç7B6Æ–ÔæÖRÒ7G&–ær†6Æ–ÓòææÖRÇÂ~{êNh‰Y‚r’çG&–Ò‚’ÇÂ~{êNh‰Y‚s°Ğ¢6öç7B—47W'&VçEW6W$6Æ–ÒÒF†—2åö—47W'&VçEvV6†EW6W$æÖR†6Æ–ÔæÖR“°Ğ¢6öç7B6Æ–Ô6öçF7BÒF†—2æçvV6†DFFævWD6öçF7D'”æÖR†6Æ–ÔæÖR“°Ğ¢6öç7B6Æ–ÔfF%fÇVRÒ—47W'&VçEW6W$6Æ–ÒòF†—2æçvV6†DFFævWEW6W$–æfò‚“òæfF"¢6Æ–Ô6öçF7CòæfF#°Ğ¢6öç7B6Æ–ÔfF"ÒF†—2æç&VæFW$fF"†6Æ–ÔfF%fÇVRÇÂ	ùBrÂ	ùBrÂ6Æ–ÔæÖR“°Ğ¢6öç7B6Æ–ÔÖ÷VçBÒçVÖ&W"ç'6TfÆöB†6Æ–ÓòæÖ÷VçBÇÂ“°Ğ¢6öç7B6Æ–ÕF–ÖW7F×ÒçVÖ&W"†6Æ–ÓòçF–ÖW7F×ÇÂ“°Ğ¢6öç7B6Æ–ÕF–ÖRÒçVÖ&W"æ—4f–æ—FR†6Æ–ÕF–ÖW7F×’bb6Æ–ÕF–ÖW7F×â Ğ¢òæWrFFR†6Æ–ÕF–ÖW7F×’çFôÆö6ÆUF–ÖU7G&–ær‚w¦‚Ô4ârÂ²†÷W#¢s"ÖF–v—BrÂÖ–çWFS¢s"ÖF–v—BrÂ†÷W##¢fÇ6RÒĞ¢¢rs°Ğ¢&WGW&â Ğ¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ²Æ–vâÖ—FV×3¦6VçFW#²Ö–âÖ†V–v‡C£S‡ƒ²FF–æs£‡‚gƒ²&÷&FW"Ö&÷GFöÓ£‚6öÆ–B6c&c&c#²&÷‚×6—¦–æs¦&÷&FW"Ö&÷ƒ²#àĞ¢ÆF—b7G–ÆSÒ'v–GFƒ£3gƒ²†V–v‡C£3gƒ²&÷&FW"×&F—W3£Gƒ²÷fW&fÆ÷s¦†–FFVã²&6¶w&÷VæC¢6VVS²fÆW‚×6‡&–æ³£²F—7Æ“¦fÆWƒ²Æ–vâÖ—FV×3¦6VçFW#²§W7F–g’Ö6öçFVçC¦6VçFW#²#âG¶6Æ–ÔfF'ÓÂöF—càĞ¢ÆF—b7G–ÆSÒ&Ö–â×v–GFƒ£²fÆWƒ£²Ö&v–âÖÆVgC£ƒ²FW‡BÖÆ–vã¦ÆVgC²#àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S£7ƒ²6öÆ÷#¢3###²÷fW&fÆ÷s¦†–FFVã²FW‡BÖ÷fW&fÆ÷s¦VÆÆ—6—3²v†—FR×76S¦æ÷w&²#âG·F†—2åöW66T‡FÖÂ†6Æ–ÔæÖR—ÓÂöF—càĞ¢G¶6Æ–ÕF–ÖRòÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ²6öÆ÷#¢6²Ö&v–â×F÷£7ƒ²#âG·F†—2åöW66T‡FÖÂ†6Æ–ÕF–ÖR—ÓÂöF—cæ¢rwĞĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ²6öÆ÷#¢3###²föçB×f&–çBÖçVÖW&–3§F'VÆ"ÖçV×3²Ö&v–âÖÆVgC£'ƒ²#âG´çVÖ&W"æ—4f–æ—FR†6Æ–ÔÖ÷VçB’ò6Æ–ÔÖ÷VçBçFôf—†VBƒ"’¢sãwÒXX3ÂöF—càĞ¢ÂöF—càĞ¢°Ğ¢Ò’æ¦ö–â‚rr“°Ğ Ğ¢6öç7B‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò'vV6†BÖvV6†B×–ÖVçBÖf—†VB×vRvV6†B×&VG6¶WBÖFWF–Â×vR"7G–ÆSÒ'÷6—F–öã¢&VÆF—fS²#àĞ¢ÆF—b–CÒ'&VG6¶WBÖFWF–Â×f–Wr"7G–ÆSÒ Ğ¢÷6—F–öã¢'6öÇWFS²F÷¢²ÆVgC¢²v–GFƒ¢S²†V–v‡C¢S°Ğ¢&6¶w&÷VæBÖ6öÆ÷#¢6ffc²¢Ö–æFWƒ¢²F—7Æ“¢fÆWƒ²fÆW‚ÖF—&V7F–öã¢6öÇVÖã°Ğ¢#àĞ¢ÂÒÒšn˜:{ª.ˆ›.[Ê~[Ú"ÒÓàĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6SsVCc²†V–v‡C¢cƒ²&÷&FW"×&F—W3¢SRSRò#‚#ƒ²÷6—F–öã¢&VÆF—fS²#àĞ¢Æ'WGFöâ6Æ73Ò'vV6†BÖ&6²Ö'Fâ"–CÒ&&6²Ög&öÒ×'ÖFWF–Â"7G–ÆSÒ'÷6—F–öã¦'6öÇWFS²F÷£3ƒ²&–v‡C£'ƒ²&6¶w&÷VæC¦æöæS²&÷&FW#¦æöæS²6öÆ÷#¢6ffc²föçB×6—¦S£Gƒ²7W'6÷#§ö–çFW#²#àĞ¢Æ’6Æ73Ò&f×6öÆ–Bf×†Ö&²#ãÂö“àĞ¢Âö'WGFöãàĞ¢ÂöF—càĞ Ğ¢ÂÒÒ{ª.XÈ^Xh^Zë’ÒÓàĞ¢ÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¢6VçFW#²FF–æs¢#‚g‚²#àĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ²Æ–vâÖ—FV×3¦6VçFW#²§W7F–g’Ö6öçFVçC¦6VçFW#²Ö&v–âÖ&÷GFöÓ£gƒ²#àĞ¢ÆF—b7G–ÆSÒ'v–GFƒ£#‡ƒ²†V–v‡C£#‡ƒ²&÷&FW"×&F—W3£SS²&6¶w&÷VæC¢6FFC²Ö&v–â×&–v‡C£gƒ²F—7Æ“¦fÆWƒ²Æ–vâÖ—FV×3¦6VçFW#²§W7F–g’Ö6öçFVçC¦6VçFW#²÷fW&fÆ÷s¦†–FFVã²föçB×6—¦S£Gƒ²#àĞ¢G¶fF$‡FÖÇĞĞ¢ÂöF—càĞ¢Ç7â7G–ÆSÒ&föçB×6—¦S£7ƒ²6öÆ÷#¢3²#âG·6VæFW$æÖWŞXùX{®y¨N{ª.XÈSÂ÷7ãàĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ²6öÆ÷#¢3“““²Ö&v–âÖ&÷GFöÓ£gƒ²#âG¶ÖW76vRçv—6‚ÇÂ~hŞYiÎXù‹J.ûÈÎZJ~YZJ~XŠ’wÓÂöF—càĞ¢ÆF—b7G–ÆSÒ&Ö&v–âÖ&÷GFöÓ£Gƒ²#àĞ¢Ç7â7G–ÆSÒ&föçB×6—¦S£#‡ƒ²föçB×vV–v‡C¦&öÆC²6öÆ÷#¢63CƒƒFc²#âG¶ÖW76vRæÖ÷VçGÓÂ÷7ãàĞ¢Ç7â7G–ÆSÒ&föçB×6—¦S£'ƒ²6öÆ÷#¢63CƒƒFc²Ö&v–âÖÆVgC£'ƒ²#îXX3Â÷7ãàĞ¢ÂöF—càĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ²6öÆ÷#¢6SfSƒ²#âG·&VE6¶WE7FGW5FW‡GÓÂöF—càĞ¢ÂöF—càĞ¢G¶—4w&÷W6¶WBò Ğ¢ÆF—b7G–ÆSÒ&†V–v‡C£‡ƒ²&6¶w&÷VæC¢6cvcvcs²Ö&v–â×F÷£#Gƒ²fÆW‚×6‡&–æ³£²#ãÂöF—càĞ¢ÆF—b7G–ÆSÒ'FF–æs£'‚g‚—ƒ²föçB×6—¦S£ƒ²6öÆ÷#¢3“““²FW‡BÖÆ–vã¦ÆVgC²&÷&FW"Ö&÷GFöÓ£‚6öÆ–B6c&c&c#²fÆW‚×6‡&–æ³£²#âG¶w&÷W6Æ–Õ&öw&W75FW‡GÓÂöF—càĞ¢ÆF—b7G–ÆSÒ&fÆWƒ£²Ö–âÖ†V–v‡C£²÷fW&fÆ÷r×“¦WFó²&6¶w&÷VæC¢6ffc²#àĞ¢G¶w&÷W6Æ–Õ&÷w4‡FÖÂÇÂsÆF—b7G–ÆSÒ'FF–æs£3'‚gƒ²FW‡BÖÆ–vã¦6VçFW#²6öÆ÷#¢6&&#²föçB×6—¦S£'ƒ²#îi¨.i{n‹ùk*iÈ{êNh‰Yš(nXùcÂöF—câwĞĞ¢ÂöF—càĞ¢¢rwĞĞ¢ÂöF—càĞ¢ÂöF—càĞ¢°Ğ Ğ¢F†—2æç†öæU6†VÆÂç6WD6öçFVçB†‡FÖÂÂwvV6†B×&VG6¶WBÖFWF–Âr“°Ğ Ğ¢6öç7B&6´'FâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v&6²Ög&öÒ×'ÖFWF–Âr“°Ğ¢–b†&6´'Fâ’&6´'Fâæöæ6Æ–6²Ò‚’ÓâF†—2æç&VæFW"‚“°Ğ¢ĞĞ Ğ¢övWEG&ç6fW$FWF–Å†öæUF–ÖR†fÆÆ&6´ÖW76vRÒ·Ò’°Ğ¢6öç7BF–ÖTÖævW"Òv–æF÷råf—'GVÅ†öæSòçF–ÖTÖævW#°Ğ¢6öç7B†öæU6†VÆÂÒF†—2æòç†öæU6†VÆÃ°Ğ¢ÆWB7W'&VçBÒçVÆÃ°Ğ¢G'’°Ğ¢6öç7BW6U&VÅF–ÖRÒ†öæU6†VÆÃòå÷6†÷VÆEW6U&VÅF–ÖTf÷%†öæTF—7Æ“òâ‚’ÓÓÒG'VS°Ğ¢–b‡W6U&VÅF–ÖRbbG—VöbF–ÖTÖævW#òævWE&VÅF–ÖRÓÓÒvgVæ7F–öâr’°Ğ¢7W'&VçBÒF–ÖTÖævW"ævWE&VÅF–ÖR‚’ÇÂçVÆÃ°Ğ¢ÒVÇ6R°Ğ¢F–ÖTÖævW#òæ6ÆV$66†Sòâ‚“°Ğ¢7W'&VçBÒF–ÖTÖævW#òævWD7W'&VçE7F÷'•F–ÖSòâ‚’ÇÂçVÆÃ°Ğ¢ĞĞ¢6öç7BF—7Æ–VEF–ÖRÒ7G&–ær‡†öæU6†VÆÃòævWD7W'&VçEF–ÖSòâ‚’ÇÂrr’çG&–Ò‚“°Ğ¢–b†7W'&VçBbbF—7Æ–VEF–ÖR’7W'&VçBÒ²ââæ7W'&VçBÂF–ÖS¢F—7Æ–VEF–ÖRÓ°Ğ¢Ò6F6‚†R’°Ğ¢6öç6öÆRçv&â‚~)ªûˆò¾[êîKú‹ÚÎ‹JeÒˆë~Xùnh˜¾iË®i{n™{NZK‹J^ûÈÎKÛşyJkhhşi{n™{NXYÎ[©S¢rÂR“°Ğ¢ĞĞ Ğ¢6öç7B6÷W&6RÒ7W'&VçCòæFFRbb7W'&VçCòçF–ÖRò7W'&VçB¢fÆÆ&6´ÖW76vS°Ğ¢6öç7BF–ÖW7F×ÒçVÖ&W"‡6÷W&6SòçF–ÖW7F×“°Ğ¢&WGW&â°Ğ¢FFS¢7G&–ær‡6÷W&6SòæFFRÇÂfÆÆ&6´ÖW76vSòæFFRÇÂrr’çG&–Ò‚’ÀĞ¢F–ÖS¢7G&–ær‡6÷W&6SòçF–ÖRÇÂfÆÆ&6´ÖW76vSòçF–ÖRÇÂrr’çG&–Ò‚’ÀĞ¢vVV¶F“¢7G&–ær‡6÷W&6SòçvVV¶F’ÇÂfÆÆ&6´ÖW76vSòçvVV¶F’ÇÂrr’çG&–Ò‚’ÀĞ¢F–ÖW7F×¢çVÖ&W"æ—4f–æ—FR‡F–ÖW7F×’bbF–ÖW7F×âòF–ÖW7F×¢çVÆÀĞ¢Ó°Ğ¢ĞĞ Ğ¢öf÷&ÖEG&ç6fW$FWF–ÅF–ÖR‡F–ÖTFFÒ·ÒÂfÆÆ&6´ÖW76vRÒ·Ò’°Ğ¢ÆWBFFRÒ7G&–ær‡F–ÖTFFòæFFRÇÂfÆÆ&6´ÖW76vSòæFFRÇÂrr’çG&–Ò‚“°Ğ¢ÆWBF–ÖRÒ7G&–ær‡F–ÖTFFòçF–ÖRÇÂfÆÆ&6´ÖW76vSòçF–ÖRÇÂrr’çG&–Ò‚“°Ğ¢6öç7BF–ÖW7F×ÒçVÖ&W"‡F–ÖTFFòçF–ÖW7F×ÇÂfÆÆ&6´ÖW76vSòçF–ÖW7F×ÇÂ“°Ğ Ğ¢–b‚‚FFRÇÂF–ÖR’bbçVÖ&W"æ—4f–æ—FR‡F–ÖW7F×’bbF–ÖW7F×â’°Ğ¢–b‚FFR’FFRÒF†—2åöf÷&ÖEvV6†DFFTg&öÕF–ÖW7F×‡F–ÖW7F×“°Ğ¢–b‚F–ÖR’F–ÖRÒF†—2åöf÷&ÖEvV6†EF–ÖTg&öÕF–ÖW7F×‡F–ÖW7F×“°Ğ¢ĞĞ Ğ¢6öç7BF–ÖTÖF6‚ÒF–ÖRæÖF6‚‚ò…ÆG³Ã'Ò•³®ûÉ¥Ò…ÆG³'Ò’ò“°Ğ¢6öç7Bæ÷&ÖÆ—¦VEF–ÖRÒF–ÖTÖF6€Ğ¢òG·F–ÖTÖF6…³ÒçE7F'Bƒ"Âsr—Ó¢G·F–ÖTÖF6…³%×Ö Ğ¢¢F–ÖS°Ğ¢&WGW&â¶FFRÂæ÷&ÖÆ—¦VEF–ÖUÒæf–ÇFW"„&ööÆVâ’æ¦ö–â‚rr’ÇÂ~i{n™{NiÊ®yúRs°Ğ¢ĞĞ Ğ¢ö66WD–æ6öÖ–æuG&ç6fW"†6†D–BÂÖW76vRÒ·Ò’°Ğ¢6öç7B6fT6†D–BÒ7G&–ær†6†D–BÇÂrr’çG&–Ò‚“°Ğ¢6öç7BW6W$æÖRÒ7G&–ær‡F†—2æçvV6†DFFævWEW6W$–æfóòâ‚“òææÖRÇÂrr’çG&–Ò‚“°Ğ¢6öç7B—4ÖRÒÖW76vRæg&öÒÓÓÒvÖRrÇÂÖW76vRæg&öÒÓÓÒW6W$æÖS°Ğ¢6öç7B7W'&VçE7FGW2Ò7G&–ær†ÖW76vRç7FGW2ÇÂrr’çG&–Ò‚“°Ğ¢–b‚6fT6†D–BÇÂÖW76vSòæ–BÇÂ—4ÖRÇÂ7W'&VçE7FGW2ÓÓÒw&V6V—fVBrÇÂ7W'&VçE7FGW2ÓÓÒw&VgVæFVBr’&WGW&âçVÆÃ°Ğ Ğ¢6öç7BG&ç6fW%&V6V—fVEF–ÖRÒF†—2åövWEG&ç6fW$FWF–Å†öæUF–ÖR†ÖW76vR“°Ğ¢6öç7BWFFVDÖW76vRÒF†—2æçvV6†DFFçWFFTÖW76vT'”–B‡6fT6†D–BÂÖW76vRæ–BÂ°Ğ¢7FGW3¢w&V6V—fVBrÀĞ¢G&ç6fW%&V6V—fVEF–ÖRÀĞ¢–ÖVçD†æFÆVD'“¢W6W$æÖRÇÂ~yJh‹rrÀĞ¢–ÖVçD†æFÆVDC¢FFRææ÷r‚Ğ¢Ò“°Ğ¢–b‚WFFVDÖW76vR’&WGW&âçVÆÃ°Ğ Ğ¢6öç7BÖ÷VçBÒçVÖ&W"ç'6TfÆöB†ÖW76vRæÖ÷VçBÇÂ’ÇÂ°Ğ¢F†—2æçvV6†DFFçWFFUvÆÆWD&Ææ6R†Ö÷VçBÂçVÆÂÂ°Ğ¢G—S¢wG&ç6fW"rÀĞ¢F—FÆS¢‹ÚÎ‹JniKnjËâÒGµ7G&–ær†ÖW76vRæg&öÒÇÂF†—2ææ7W'&VçD6†CòææÖRÇÂ~[êîKúZ[ŞXø²r—ÖÀĞ¢FWF–Ã¢7G&–ær†ÖW76vRæFW62ÇÂ~[êîKú‹ÚÎ‹Jbr’ÀĞ¢6÷W&6S¢wvV6†BrÀĞ¢6†D–C¢6fT6†D–BÀĞ¢6÷VçFW''G“¢7G&–ær†ÖW76vRæg&öÒÇÂrr’ÀĞ¢ÖW76vT–C¢7G&–ær†ÖW76vRæ–B’ÀĞ¢&VfW&Væ6T–C¢vV6†C§G&ç6fW#§&V6V—fS¢G¶ÖW76vRæ–GÖÀĞ¢FFS¢G&ç6fW%&V6V—fVEF–ÖRæFFRÀĞ¢F–ÖS¢G&ç6fW%&V6V—fVEF–ÖRçF–ÖRÀĞ¢vVV¶F“¢G&ç6fW%&V6V—fVEF–ÖRçvVV¶F’ÀĞ¢F–ÖW7F×¢G&ç6fW%&V6V—fVEF–ÖRçF–ÖW7F×ÀĞ¢&VÅF–ÖW7F×¢ÖW76vRç&VÅF–ÖW7F×ÀĞ¢g&öÔÖ–ä6†EFs¢ÖW76vRæg&öÔÖ–ä6†EFrÓÓÒG'VRÀĞ¢FfW&äÖW76vT–æFWƒ¢ÖW76vRçFfW&äÖW76vT–æFW‚ÀĞ¢&F6„–C¢ÖW76vRæ&F6„–@Ğ¢Ò“°Ğ¢F†—2æçvV6†DFFæFDÖW76vR‡6fT6†D–BÂF†—2åö'V–ÆE–ÖVçE7FGW4ÖW76vR€Ğ¢WFFVDÖW76vRÀĞ¢~KÚ[{.iKnjËârÀĞ¢wG&ç6fW"rÀĞ¢v66WBrÀĞ¢ÖW76vPĞ¢’“°Ğ Ğ¢&WGW&â²ÖW76vS¢WFFVDÖW76vRÂÖ÷VçBÂF–ÖS¢G&ç6fW%&V6V—fVEF–ÖRÓ°Ğ¢ĞĞ Ğ¢÷&VgVæD–æ6öÖ–æuG&ç6fW"†6†D–BÂÖW76vRÒ·Ò’°Ğ¢6öç7B6fT6†D–BÒ7G&–ær†6†D–BÇÂrr’çG&–Ò‚“°Ğ¢6öç7BW6W$æÖRÒ7G&–ær‡F†—2æçvV6†DFFævWEW6W$–æfóòâ‚“òææÖRÇÂrr’çG&–Ò‚“°Ğ¢6öç7B—4ÖRÒÖW76vRæg&öÒÓÓÒvÖRrÇÂÖW76vRæg&öÒÓÓÒW6W$æÖS°Ğ¢6öç7B7W'&VçE7FGW2Ò7G&–ær†ÖW76vRç7FGW2ÇÂrr’çG&–Ò‚“°Ğ¢–b‚6fT6†D–BÇÂÖW76vSòæ–BÇÂ—4ÖRÇÂ7W'&VçE7FGW2ÓÓÒw&V6V—fVBrÇÂ7W'&VçE7FGW2ÓÓÒw&VgVæFVBr’&WGW&âçVÆÃ°Ğ Ğ¢6öç7BG&ç6fW%&VgVæFVEF–ÖRÒF†—2åövWEG&ç6fW$FWF–Å†öæUF–ÖR†ÖW76vR“°Ğ¢6öç7BWFFVDÖW76vRÒF†—2æçvV6†DFFçWFFTÖW76vT'”–B‡6fT6†D–BÂÖW76vRæ–BÂ°Ğ¢7FGW3¢w&VgVæFVBrÀĞ¢G&ç6fW%&VgVæFVEF–ÖRÀĞ¢–ÖVçD†æFÆVD'“¢W6W$æÖRÇÂ~yJh‹rrÀĞ¢–ÖVçD†æFÆVDC¢FFRææ÷r‚Ğ¢Ò“°Ğ¢–b‚WFFVDÖW76vR’&WGW&âçVÆÃ°Ğ Ğ¢F†—2æçvV6†DFFæFDÖW76vR‡6fT6†D–BÂF†—2åö'V–ÆE–ÖVçE7FGW4ÖW76vR€Ğ¢WFFVDÖW76vRÀĞ¢~KÚ[{.˜Y¹îŠú^zÉN‹ÚÎ‹JbrÀĞ¢wG&ç6fW"rÀĞ¢w&VgVæBrÀĞ¢ÖW76vPĞ¢’“°Ğ Ğ¢&WGW&â²ÖW76vS¢WFFVDÖW76vRÂF–ÖS¢G&ç6fW%&VgVæFVEF–ÖRÓ°Ğ¢ĞĞ Ğ¢òò	ù+h™>[È‹ÚÎ‹JnŠúnh8^yXÎ™Ú Ğ¢÷VåG&ç6fW$FWF–Â†ÖW76vT–B’°Ğ¢6öç7B6†D–BÒF†—2ææ7W'&VçD6†Còæ–C°Ğ¢–b‚6†D–B’&WGW&ã°Ğ¢6öç7BÖW76vW2ÒF†—2æçvV6†DFFævWDÖW76vW2†6†D–B“°Ğ¢6öç7BÖW76vRÒÖW76vW2æf–æB†ÒÓâÒæ–BÓÓÒÖW76vT–B“°Ğ¢–b‚ÖW76vR’&WGW&ã°Ğ Ğ¢6öç7B—4ÖRÒÖW76vRæg&öÒÓÓÒvÖRrÇÂÖW76vRæg&öÒÓÓÒF†—2æçvV6†DFFævWEW6W$–æfò‚’ææÖS°Ğ¢6öç7Bf÷&ÖGFVDÖ÷VçBÒ'6TfÆöB†ÖW76vRæÖ÷VçBÇÂ’çFôf—†VBƒ"“°Ğ¢6öç7B&W6öÇfVE7FGW2Ò7G&–ær†ÖW76vRç7FGW2ÇÂrr’çG&–Ò‚“°Ğ¢ÆWB&W6öÇfVDÖW76vRÒÖW76vS°Ğ¢ÆWBG&ç6fW%&V6V—fVEF–ÖRÒÖW76vRçG&ç6fW%&V6V—fVEF–ÖRÇÂçVÆÃ°Ğ¢ÆWBG&ç6fW%&VgVæFVEF–ÖRÒÖW76vRçG&ç6fW%&VgVæFVEF–ÖRÇÂçVÆÃ°Ğ Ğ¢6öç7B—5G&ç6fW%&VgVæFVBÒ&W6öÇfVE7FGW2ÓÓÒw&VgVæFVBs°Ğ¢6öç7B—5G&ç6fW%&V6V—fVBÒ&W6öÇfVE7FGW2ÓÓÒw&V6V—fVBs°Ğ¢6öç7B—5VæF–æt–æ6öÖ–æuG&ç6fW"Ò—4ÖRbb—5G&ç6fW%&VgVæFVBbb—5G&ç6fW%&V6V—fVC°Ğ¢–b†—5G&ç6fW%&V6V—fVBbbG&ç6fW%&V6V—fVEF–ÖR’°Ğ¢G&ç6fW%&V6V—fVEF–ÖRÒF†—2åövWEG&ç6fW$FWF–Å†öæUF–ÖR†ÖW76vR“°Ğ¢&W6öÇfVDÖW76vRÒF†—2æçvV6†DFFçWFFTÖW76vT'”–B†6†D–BÂÖW76vT–BÂ°Ğ¢G&ç6fW%&V6V—fVEF–ÖPĞ¢Ò’ÇÂ&W6öÇfVDÖW76vS°Ğ¢ÒVÇ6R–b†—5G&ç6fW%&VgVæFVBbbG&ç6fW%&VgVæFVEF–ÖR’°Ğ¢G&ç6fW%&VgVæFVEF–ÖRÒF†—2åövWEG&ç6fW$FWF–Å†öæUF–ÖR†ÖW76vR“°Ğ¢&W6öÇfVDÖW76vRÒF†—2æçvV6†DFFçWFFTÖW76vT'”–B†6†D–BÂÖW76vT–BÂ°Ğ¢G&ç6fW%&VgVæFVEF–ÖPĞ¢Ò’ÇÂ&W6öÇfVDÖW76vS°Ğ¢ĞĞ Ğ¢6öç7BG&ç6fW%F–ÖU7G"ÒF†—2åöf÷&ÖEG&ç6fW$FWF–ÅF–ÖR†ÖW76vR“°Ğ¢6öç7B6ö×ÆWF–öåF–ÖRÒ—5G&ç6fW%&VgVæFVBòG&ç6fW%&VgVæFVEF–ÖR¢G&ç6fW%&V6V—fVEF–ÖS°Ğ¢6öç7B6ö×ÆWF–öåF–ÖU7G"Ò6ö×ÆWF–öåF–ÖPĞ¢òF†—2åöf÷&ÖEG&ç6fW$FWF–ÅF–ÖR†6ö×ÆWF–öåF–ÖRÂ&W6öÇfVDÖW76vRĞ¢¢rs°Ğ¢6öç7B7FGW5F—FÆRÒ—5G&ç6fW%&VgVæFV@Ğ¢ò†—4ÖRò~‹ÚÎ‹Jn[{.˜Y¹âr¢~KÚ[{.˜Y¹îŠú^zÉN‹ÚÎ‹JbrĞ¢¢†—4ÖPĞ¢ò†—5G&ç6fW%&V6V—fVBò~Zûik[{.iKnjËâr¢~[è^ZûikzîŠêNiKnjËârĞ¢¢†—5G&ç6fW%&V6V—fVBò~KÚ[{.iKnjËîûÈÎ‹XN˜y[{.ZÙXZ^™»n™+r¢~[è^KÚiKnjËâr’“°Ğ¢6öç7B&Ææ6TÆ&VÂÒ—5G&ç6fW%&VgVæFV@Ğ¢ò†—4ÖRò~[{.˜Y¹î™»n™+r¢~iÊ®ZÙXZ^™»n™+rĞ¢¢†—5G&ç6fW%&V6V—fVBò~™»n™+KÙš)Òr¢rr“°Ğ¢6öç7B&V6V—fUF–ÖTÆ&VÂÒ—5G&ç6fW%&VgVæFVBò~˜Y¹îi{n™{Br¢~iKnjËîi{n™{Bs°Ğ¢6öç7B7FGW4–6öä6Æ72Ò—5VæF–æt–æ6öÖ–æuG&ç6fW"ÇÂ‚—5G&ç6fW%&V6V—fVBbb—5G&ç6fW%&VgVæFVBĞ¢òvf×&VwVÆ"fÖ6Æö6²pĞ¢¢†—5G&ç6fW%&VgVæFVBòvf×6öÆ–BfÖ'&÷r×&÷FFRÖÆVgBr¢vf×6öÆ–BfÖ6†V6²r“°Ğ¢6öç7B7FGW4–6öäÖöF–f–W"Ò—5VæF–æt–æ6öÖ–æuG&ç6fW"ÇÂ‚—5G&ç6fW%&V6V—fVBbb—5G&ç6fW%&VgVæFVBĞ¢òv—2×VæF–ærpĞ¢¢†—5G&ç6fW%&VgVæFVBòv—2×&VgVæFVBr¢v—2×&V6V—fVBr“°Ğ Ğ¢6öç7B‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò'vV6†BÖvV6†B×–ÖVçBÖf—†VB×vRvV6†B×G&ç6fW"ÖFWF–Â×vR"7G–ÆSÒ'÷6—F–öã¢&VÆF—fS²#àĞ¢ÆF—b–CÒ'G&ç6fW"ÖFWF–Â×f–Wr"6Æ73Ò'vV6†B×G&ç6fW"ÖFWF–Â×f–Wr#àĞ¢ÂÒÒšn˜:‹ùNY¹âÒÓàĞ¢ÆF—b7G–ÆSÒ'FF–æs¢3G‚'‚²#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×F—FÆR"7G–ÆSÒ&F—7Æ“¦æöæS²#î‹ÚÎ‹JnŠúnh8SÂöF—càĞ¢Æ'WGFöâ6Æ73Ò'vV6†BÖ&6²Ö'Fâ"–CÒ&&6²Ög&öÒ×G&ç6fW"ÖFWF–Â"7G–ÆSÒ&&6¶w&÷VæC¦æöæS²&÷&FW#¦æöæS²6öÆ÷#¢3²föçB×6—¦S£Gƒ²7W'6÷#§ö–çFW#²FF–æs£²#àĞ¢Æ’6Æ73Ò&f×6öÆ–BfÖ6†Wg&öâÖÆVgB#ãÂö“àĞ¢Âö'WGFöãàĞ¢ÂöF—càĞ Ğ¢ÂÒÒK‹¾Xh^Zë’ÒÓàĞ¢ÆF—b6Æ73Ò'vV6†B×G&ç6fW"ÖFWF–ÂÖÖ–â#àĞ¢ÆF—b6Æ73Ò'vV6†B×G&ç6fW"×7FGW2Ö–6öâG·7FGW4–6öäÖöF–f–W'Ò#àĞ¢Æ’6Æ73Ò"G·7FGW4–6öä6Æ77Ò#ãÂö“àĞ¢ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†B×G&ç6fW"×7FGW2×F—FÆR#âG·7FGW5F—FÆWÓÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†B×G&ç6fW"ÖFWF–ÂÖÖ÷VçB#ì*RG¶f÷&ÖGFVDÖ÷VçGÓÂöF—càĞ¢G¶&Ææ6TÆ&VÂòÆF—b6Æ73Ò'vV6†B×G&ç6fW"Ö&Ææ6RÖÆ&VÂ#âG¶&Ææ6TÆ&VÇÓÂöF—cæ¢sÆF—b6Æ73Ò'vV6†B×G&ç6fW"Ö&Ææ6RÖÆ&VÂ—2ÖV×G’#ãÂöF—câwĞĞ¢ÂöF—càĞ Ğ¢ÂÒÒi{n™{NKúhòÒÓàĞ¢ÆF—b7G–ÆSÒ&Ö&v–ã¢gƒ²&÷&FW"×F÷£‚6öÆ–B6ccc²FF–æs£‚²#àĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ²§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã²föçB×6—¦S£ƒ²6öÆ÷#¢3ƒƒƒ²Ö&v–âÖ&÷GFöÓ£gƒ²#àĞ¢Ç7ãî‹ÚÎ‹Jni{n™{CÂ÷7ããÇ7ãâG·F†—2åöW66T‡FÖÂ‡G&ç6fW%F–ÖU7G"—ÓÂ÷7ãàĞ¢ÂöF—càĞ¢G¶6ö×ÆWF–öåF–ÖU7G"ò Ğ¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ²§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã²föçB×6—¦S£ƒ²6öÆ÷#¢3ƒƒƒ²#àĞ¢Ç7ãâG·&V6V—fUF–ÖTÆ&VÇÓÂ÷7ããÇ7ãâG·F†—2åöW66T‡FÖÂ†6ö×ÆWF–öåF–ÖU7G"—ÓÂ÷7ãàĞ¢ÂöF—càĞ¢¢rwĞĞ¢ÂöF—càĞ Ğ¢G¶—5VæF–æt–æ6öÖ–æuG&ç6fW"ò Ğ¢ÆF—b6Æ73Ò'vV6†B×G&ç6fW"×VæF–ærÖ7F–öç2#àĞ¢Æ'WGFöâG—SÒ&'WGFöâ"–CÒ'&V6V—fR×G&ç6fW""6Æ73Ò'vV6†B×G&ç6fW"×&V6V—fRÖ'WGFöâ#îiKnjËãÂö'WGFöãàĞ¢ÆF—b6Æ73Ò'vV6†B×G&ç6fW"×&VgVæBÖ†–çB#îzîŠêNYî‹XN˜y[nZÙXZ^™»n™+8#Æ'WGFöâG—SÒ&'WGFöâ"–CÒ'&VgVæB×G&ç6fW""6Æ73Ò'vV6†B×G&ç6fW"×&VgVæBÖ'WGFöâ#î˜‹ùƒÂö'WGFöããÂöF—càĞ¢ÂöF—càĞ¢¢ Ğ¢ÆF—b6Æ73Ò'vV6†B×G&ç6fW"ÖFWF–ÂÖfö÷FW"#î‹JnXÙ^Šúnh8SÂöF—càĞ¢ĞĞ¢ÂöF—càĞ¢ÂöF—càĞ¢°Ğ Ğ¢F†—2æç†öæU6†VÆÂç6WD6öçFVçB†‡FÖÂÂwvV6†B×G&ç6fW"ÖFWF–Âr“°Ğ Ğ¢6öç7B7W'&VçEf–WrÒFö7VÖVçBçVW'•6VÆV7F÷"‚rç†öæR×f–WrÖ7W'&VçBr’ÇÂFö7VÖVçC°Ğ¢6öç7B&6´'FâÒ7W'&VçEf–WrçVW'•6VÆV7F÷"‚r6&6²Ög&öÒ×G&ç6fW"ÖFWF–Âr“°Ğ¢–b†&6´'Fâ’&6´'Fâæöæ6Æ–6²Ò‚’ÓâF†—2æç&VæFW"‚“°Ğ Ğ¢6öç7B&V6V—fT'WGFöâÒ7W'&VçEf–WrçVW'•6VÆV7F÷"‚r7&V6V—fR×G&ç6fW"r“°Ğ¢–b‡&V6V—fT'WGFöâ’&V6V—fT'WGFöâæöæ6Æ–6²Ò‚’Óâ°Ğ¢–b‡&V6V—fT'WGFöâæF—6&ÆVB’&WGW&ã°Ğ¢&V6V—fT'WGFöâæF—6&ÆVBÒG'VS°Ğ¢6öç7B&W7VÇBÒF†—2åö66WD–æ6öÖ–æuG&ç6fW"†6†D–BÂÖW76vR“°Ğ¢–b‚&W7VÇB’°Ğ¢F†—2æ÷VåG&ç6fW$FWF–Â†ÖW76vT–B“°Ğ¢&WGW&ã°Ğ¢ĞĞ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~[êîKú‹ÚÎ‹JbrÂ[{.ZÙXZ^™»n™+ûÉ¬*RG·&W7VÇBæÖ÷VçBçFôf—†VBƒ"—ÖÂ	ù+r“°Ğ¢F†—2æ÷VåG&ç6fW$FWF–Â†ÖW76vT–B“°Ğ¢Ó°Ğ Ğ¢6öç7B&VgVæD'WGFöâÒ7W'&VçEf–WrçVW'•6VÆV7F÷"‚r7&VgVæB×G&ç6fW"r“°Ğ¢–b‡&VgVæD'WGFöâ’&VgVæD'WGFöâæöæ6Æ–6²Ò‚’Óâ°Ğ¢–b‡&VgVæD'WGFöâæF—6&ÆVB’&WGW&ã°Ğ¢&VgVæD'WGFöâæF—6&ÆVBÒG'VS°Ğ¢6öç7B&W7VÇBÒF†—2å÷&VgVæD–æ6öÖ–æuG&ç6fW"†6†D–BÂÖW76vR“°Ğ¢–b‚&W7VÇB’°Ğ¢F†—2æ÷VåG&ç6fW$FWF–Â†ÖW76vT–B“°Ğ¢&WGW&ã°Ğ¢ĞĞ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~[êîKú‹ÚÎ‹JbrÂ~Šú^zÉN‹ÚÎ‹Jn[{.˜Y¹ârÂ~(jûˆòr“°Ğ¢F†—2æ÷VåG&ç6fW$FWF–Â†ÖW76vT–B“°Ğ¢Ó°Ğ¢ĞĞ Ğ¢òò	ùJR{êNˆ®Šëî{Úîš^™Ú.ûÈx+X{¾{êNˆ®ZKN˜:j~š)‹ù¾XZ^ûÈĞ¢6†÷tw&÷W6WGF–æw2†÷F–öç2Ò·Ò’°Ğ¢6öç7B6†BÒF†—2ææ7W'&VçD6†C°Ğ¢–b‚6†BÇÂ6†BçG—RÓÒvw&÷Wr’&WGW&ã°Ğ¢6öç7B&WGW&åFô6†DÆ—7BÒ÷F–öç3òç&WGW&åFô6†DÆ—7BÓÓÒG'VS°Ğ¢6öç7BÆ—fT6†BÒF†—2æçvV6†DFFævWD6†B†6†Bæ–B’ÇÂ6†C°Ğ¢ÆWB—4w&÷W×WFF–ærÒfÇ6S°Ğ Ğ¢òò	ùJR{êNh‰Yi[˜xò³ûÈÎYºK‹®yJh‹~ˆz®[{K™şYÊ{êN˜xÎûÈKØnKˆŞXªXZ^y›ŞYŞXÙ^ûÈĞ¢6öç7BÖVÖ&W$6÷VçBÒ†Æ—fT6†BæÖVÖ&W'3òæÆVæwF‚ÇÂ’²°Ğ¢6öç7BW6W$–æfòÒF†—2æçvV6†DFFævWEW6W$–æfò‚“°Ğ Ğ¢6öç7B‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò'vV6†BÖvV6†B×&VF&ÆR×6WGF–æw2#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"ÖÆVgB#àĞ¢Æ'WGFöâ6Æ73Ò'vV6†BÖ&6²Ö'Fâ"–CÒ&&6²Ög&öÒÖw&÷W×6WGF–æw2#àĞ¢Æ’6Æ73Ò&f×6öÆ–BfÖ6†Wg&öâÖÆVgB#ãÂö“àĞ¢Âö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×F—FÆR#îˆ®ZJKúhò‚G¶ÖVÖ&W$6÷VçGÒ“ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×&–v‡B#ãÂöF—càĞ¢ÂöF—càĞ Ğ¢ÆF—b6Æ73Ò'vV6†BÖ6öçFVçB"7G–ÆSÒ&&6¶w&÷VæC¢6VFVFVC²#àĞ¢ÂÒÒ{êNZKNX8şXË®YùòÒÓàĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6ffc²FF–æs¢#ƒ²Ö&v–âÖ&÷GFöÓ¢ƒ²#àĞ¢ÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¢6VçFW#²Ö&v–âÖ&÷GFöÓ¢Wƒ²6öÆ÷#¢3“““²föçB×6—¦S¢7ƒ²#àĞ¢x+X{¾ZKNX8şi»NhÚ Ğ¢ÂöF—càĞ¢ÆF—b–CÒ&w&÷WÖfF"×&Wf–Wr"7G–ÆSÒ Ğ¢v–GFƒ¢ƒƒ°Ğ¢†V–v‡C¢ƒƒ°Ğ¢&÷&FW"×&F—W3¢ƒ°Ğ¢&6¶w&÷VæC¢Æ–æV"Öw&F–VçBƒ3VFVrÂ3ccvVVRÂ3scF&"R“°Ğ¢Ö&v–ã¢WFó°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢Æ–vâÖ—FV×3¢6VçFW#°Ğ¢§W7F–g’Ö6öçFVçC¢6VçFW#°Ğ¢föçB×6—¦S¢Cƒ°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢÷fW&fÆ÷s¢†–FFVã°Ğ¢#âG·F†—2æç&VæFW$fF"†6†BæfF"Â	ùRrÂ6†BææÖR—ÓÂöF—càĞ¢Æ–çWBG—SÒ&f–ÆR"–CÒ&w&÷WÖfF"×WÆöB"66WCÒ&–ÖvR÷ærÂ–ÖvRö§VrÂ–ÖvRöv–bÂ–ÖvR÷vV'Â–ÖvRò¢"7G–ÆSÒ&F—7Æ“¢æöæS²#àĞ¢ÂöF—càĞ Ğ¢ÂÒÒ{êNYŞz{ÒÓàĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6ffc²FF–æs¢W‚#ƒ²Ö&v–âÖ&÷GFöÓ¢ƒ²#àĞ¢ÆF—b7G–ÆSÒ&6öÆ÷#¢3“““²föçB×6—¦S¢7ƒ²Ö&v–âÖ&÷GFöÓ¢‡ƒ²#î{êNYŞz{ÂöF—càĞ¢Æ–çWBG—SÒ'FW‡B"–CÒ&w&÷WÖæÖRÖ–çWB"fÇVSÒ"G¶Æ—fT6†BææÖWÒ Ğ¢Æ6V†öÆFW#Ò.Šëî{Úî{êNYŞz{"7G–ÆSÒ Ğ¢v–GFƒ¢S°Ğ¢FF–æs¢ƒ°Ğ¢&÷&FW#¢‚6öÆ–B6SVSVSS°Ğ¢&÷&FW"×&F—W3¢gƒ°Ğ¢föçB×6—¦S¢Wƒ°Ğ¢&÷‚×6—¦–æs¢&÷&FW"Ö&÷ƒ°Ğ¢#àĞ¢ÂöF—càĞ Ğ¢ÂÒÒ{êNh‰YX‰~Š‚ÒÓàĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6ffc²FF–æs¢W‚#ƒ²Ö&v–âÖ&÷GFöÓ¢ƒ²#àĞ¢ÆF—b7G–ÆSÒ&6öÆ÷#¢3“““²föçB×6—¦S¢7ƒ²Ö&v–âÖ&÷GFöÓ¢'ƒ²#î{êNh‰Y‚‚G¶ÖVÖ&W$6÷VçGŞK«¢“ÂöF—càĞ¢ÆF—b–CÒ&w&÷WÖÖVÖ&W'2Öw&–B"7G–ÆSÒ&F—7Æ“¢fÆWƒ²fÆW‚×w&¢w&²v¢ƒ²#àĞ¢G²†Æ—fT6†BæÖVÖ&W'2ÇÂµÒ’æÖ†ÖVÖ&W"Óâ°Ğ¢6öç7B6öçF7BÒF†—2æçvV6†DFFævWD6öçF7D'”æÖR†ÖVÖ&W"“°Ğ¢6öç7BfF"Ò6öçF7CòæfF"ÇÂ	ùBs°Ğ¢6öç7BÖVÖ&W%Fö¶VâÒF†—2åöVæ6öFTFFFö¶Vâ†ÖVÖ&W"“°Ğ¢6öç7BÖVÖ&W$Æ&VÂÒF†—2åöW66T‡FÖÂ†ÖVÖ&W"“°Ğ¢&WGW&â Ğ¢ÆF—b6Æ73Ò&w&÷WÖÖVÖ&W"Ö—FVÒ"FFÖÖVÖ&W#Ò"G¶ÖVÖ&W%Fö¶VçÒ"7G–ÆSÒ'FW‡BÖÆ–vã¢6VçFW#²v–GFƒ¢Sƒ²÷6—F–öã¢&VÆF—fS²#àĞ¢ÆF—b7G–ÆSÒ Ğ¢v–GFƒ¢CGƒ°Ğ¢†V–v‡C¢CGƒ°Ğ¢&÷&FW"×&F—W3¢gƒ°Ğ¢&6¶w&÷VæC¢6ccc°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢Æ–vâÖ—FV×3¢6VçFW#°Ğ¢§W7F–g’Ö6öçFVçC¢6VçFW#°Ğ¢föçB×6—¦S¢#'ƒ°Ğ¢÷fW&fÆ÷s¢†–FFVã°Ğ¢Ö&v–ã¢WFòGƒ°Ğ¢#âG·F†—2æç&VæFW$fF"†fF"Â	ùBrÂÖVÖ&W"—ÓÂöF—càĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢ƒ²6öÆ÷#¢3ccc²÷fW&fÆ÷s¢†–FFVã²FW‡BÖ÷fW&fÆ÷s¢VÆÆ—6—3²v†—FR×76S¢æ÷w&²#âG¶ÖVÖ&W$Æ&VÇÓÂöF—càĞ¢Æ'WGFöâ6Æ73Ò'&VÖ÷fRÖÖVÖ&W"Ö'Fâ"FFÖÖVÖ&W#Ò"G¶ÖVÖ&W%Fö¶VçÒ"7G–ÆSÒ Ğ¢÷6—F–öã¢'6öÇWFS°Ğ¢F÷¢ÓGƒ°Ğ¢&–v‡C¢°Ğ¢v–GFƒ¢gƒ°Ğ¢†V–v‡C¢gƒ°Ğ¢&÷&FW"×&F—W3¢SS°Ğ¢&6¶w&÷VæC¢6fc6#3°Ğ¢6öÆ÷#¢6ffc°Ğ¢&÷&FW#¢æöæS°Ğ¢föçB×6—¦S¢ƒ°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢Æ–vâÖ—FV×3¢6VçFW#°Ğ¢§W7F–g’Ö6öçFVçC¢6VçFW#°Ğ¢#ãÆ’6Æ73Ò&f×6öÆ–BfÖÖ–çW2"7G–ÆSÒ&föçB×6—¦S¢‡ƒ²#ãÂö“ãÂö'WGFöãàĞ¢ÂöF—càĞ¢°Ğ¢Ò’æ¦ö–â‚rr—ĞĞ¢ÂÒÒk{¾Xªh‰YhÈ™*âÒÓàĞ¢ÆF—b–CÒ&FBÖÖVÖ&W"Ö'Fâ"7G–ÆSÒ'FW‡BÖÆ–vã¢6VçFW#²v–GFƒ¢Sƒ²7W'6÷#¢ö–çFW#²#àĞ¢ÆF—b7G–ÆSÒ Ğ¢v–GFƒ¢CGƒ°Ğ¢†V–v‡C¢CGƒ°Ğ¢&÷&FW"×&F—W3¢gƒ°Ğ¢&6¶w&÷VæC¢6ffc°Ğ¢&÷&FW#¢‚F6†VB6663°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢Æ–vâÖ—FV×3¢6VçFW#°Ğ¢§W7F–g’Ö6öçFVçC¢6VçFW#°Ğ¢föçB×6—¦S¢‡ƒ°Ğ¢6öÆ÷#¢6663°Ğ¢Ö&v–ã¢WFòGƒ°Ğ¢#ãÆ’6Æ73Ò&f×6öÆ–Bf×ÇW2#ãÂö“ãÂöF—càĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢ƒ²6öÆ÷#¢3“““²#îk{¾XªÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ Ğ¢ÂÒÒKùŞZÙhÈ™*âÒÓàĞ¢ÆF—b7G–ÆSÒ'FF–æs¢#ƒ²#àĞ¢Æ'WGFöâ–CÒ'6fRÖw&÷W×6WGF–æw2"7G–ÆSÒ Ğ¢v–GFƒ¢S°Ğ¢FF–æs¢'ƒ°Ğ¢&6¶w&÷VæC¢G&ç7&VçC°Ğ¢6öÆ÷#¢3Ssf#“S°Ğ¢&÷&FW#¢‚6öÆ–B3Ssf#“S°Ğ¢&÷&FW"×&F—W3¢gƒ°Ğ¢föçB×6—¦S¢Wƒ°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢#îKùŞZÙƒÂö'WGFöãàĞ¢ÂöF—càĞ¢ÂöF—càĞ¢ÂöF—càĞ¢°Ğ Ğ¢F†—2æç†öæU6†VÆÂç6WD6öçFVçB†‡FÖÂÂvV6†BÖw&÷W×6WGF–æw2ÒG¶Æ—fT6†Bæ–GÖ“°Ğ Ğ¢òò	ùJRK‹Ni{nZÙX*€Ğ¢ÆWBæWtfF"ÒçVÆÃ°Ğ¢6öç7B÷&–v–æÄæÖRÒÆ—fT6†BææÖS°Ğ¢6öç7B7W'&VçEf–WrÒFö7VÖVçBçVW'•6VÆV7F÷"‚rç†öæR×f–WrÖ7W'&VçBr’ÇÂFö7VÖVçC°Ğ¢6öç7BVW'’Ò‡6VÆV7F÷"’Óâ7W'&VçEf–WrçVW'•6VÆV7F÷"‡6VÆV7F÷"“°Ğ Ğ¢òò‹ùNY¹îhÈ™*àĞ¢VW'’‚r6&6²Ög&öÒÖw&÷W×6WGF–æw2r“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢–b‡&WGW&åFô6†DÆ—7B’°Ğ¢F†—2ææ7W'&VçD6†BÒçVÆÃ°Ğ¢F†—2ææ7W'&VçEf–WrÒv6†G2s°Ğ¢ĞĞ¢F†—2æç&VæFW"‚“°Ğ¢Ò“°Ğ Ğ¢òòx+X{¾ZKNX8şXË®YùğĞ¢VW'’‚r6w&÷WÖfF"×&Wf–Wrr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢VW'’‚r6w&÷WÖfF"×WÆöBr“òæ6Æ–6²‚“°Ğ¢Ò“°Ğ Ğ¢òòKˆ®KÊZKNX8ğĞ¢VW'’‚r6w&÷WÖfF"×WÆöBr“òæFDWfVçDÆ—7FVæW"‚v6†ævRrÂ7–æ2†R’Óâ°Ğ¢6öç7Bf–ÆRÒRçF&vWBæf–ÆW5³Ó°Ğ¢–b†f–ÆR’°Ğ¢–b†f–ÆRç6—¦RâR¢#B¢#B’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~Y»îx˜~ZJ®ZJ~ûÈÎŠû~˜hº[şK¨ãTÔ.y¨NY»îx˜rrÂ~)ªûˆòr“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢òòiÊÎYËš(NŠxûÈKˆŞXiXZ^hÈK˜^i[hÚîûÈĞ¢6öç7B&VFW"ÒæWrf–ÆU&VFW"‚“°Ğ¢&VFW"æöæÆöBÒ†R’Óâ°Ğ¢6öç7B&Wf–WrÒVW'’‚r6w&÷WÖfF"×&Wf–Wrr“°Ğ¢–b‡&Wf–Wr’&Wf–Wræ–ææW$…DÔÂÒÆ–Ör7&3Ò"G¶RçF&vWBç&W7VÇGÒ"7G–ÆSÒ'v–GFƒ£S¶†V–v‡C£S¶ö&¦V7BÖf—C¦6÷fW#²#æ°Ğ¢Ó°Ğ¢&VFW"ç&VD4FFU$Â†f–ÆR“°Ğ Ğ¢òòKˆ®KÊX‹iÈŞXªYš€Ğ¢G'’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~ZHNynKŠÒrÂ~jÚ>YÊKˆ®KÊ{êNZKNX8òââârÂ~(û2r“°Ğ¢æWtfF"Òv—Bv–æF÷råf—'GVÅ†öæSòæ–ÖvTÖævW#òçWÆöD&Æö#òâ†f–ÆRÂvw&÷WöfF"r“°Ğ¢–b‚æWtfF"’F‡&÷ræWrW'&÷"‚~Y»îx˜~Kˆ®KÊzêynYšiÊ®X‰ŞZx¾XÉbr“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~h‰X©òrÂ~{êNZKNX8ş[{.Kˆ®KÊrÂ~)ÈRr“°Ğ¢Ò6F6‚†W'"’°Ğ¢6öç6öÆRçv&â‚~{êNZKNX8şKˆ®KÊZK‹JS¢rÂW'"“°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~Kˆ®KÊZK‹JRrÂW'#òæÖW76vRÇÂ~{êNZKNX8şKˆ®KÊZK‹JRrÂ~)ØÂr“°Ğ¢ĞĞ¢ĞĞ¢Ò“°Ğ Ğ¢òò	ùJRz{¾™šNh‰YhÈ™*àĞ¢7W'&VçEf–WrçVW'•6VÆV7F÷$ÆÂ‚rç&VÖ÷fRÖÖVÖ&W"Ö'Fâr’æf÷$V6‚†'FâÓâ°Ğ¢'FâæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ†R’Óâ°Ğ¢Rç7F÷&÷vF–öâ‚“°Ğ¢–b†—4w&÷W×WFF–ær’&WGW&ã°Ğ¢6öç7BÖVÖ&W$æÖRÒF†—2åöFV6öFTFFFö¶Vâ†'FâæFF6WBæÖVÖ&W"“°Ğ¢–b‚ÖVÖ&W$æÖR’&WGW&ã°Ğ¢—4w&÷W×WFF–ærÒG'VS°Ğ Ğ¢–b‚Æ—fT6†BæÖVÖ&W'2ÇÂÆ—fT6†BæÖVÖ&W'2æÆVæwF‚ÃÒ"’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~{êNˆ®ˆ{>[	™ÈŠh.K«¢rÂ~)ªûˆòr“°Ğ¢—4w&÷W×WFF–ærÒfÇ6S°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢òòK¸îh‰YX‰~Šz{¾™š@Ğ¢Æ—fT6†BæÖVÖ&W'2ÒÆ—fT6†BæÖVÖ&W'2æf–ÇFW"†ÒÓâÒÓÒÖVÖ&W$æÖR“°Ğ Ğ¢òò	ùJRYÎjÚ^i»NikvV6†DFFKŠŞy¨Nˆ®ZJi[hÚàĞ¢6öç7BFF6†BÒF†—2æçvV6†DFFævWD6†B†Æ—fT6†Bæ–B“°Ğ¢–b†FF6†B’°Ğ¢FF6†BæÖVÖ&W'2ÒÆ—fT6†BæÖVÖ&W'3°Ğ¢F†—2ææ7W'&VçD6†BÒFF6†C°Ğ¢ĞĞ Ğ¢òòk{¾Xª{;¾{¹şkhhğĞ¢F†—2æçvV6†DFFæFDÖW76vR†Æ—fT6†Bæ–BÂ°Ğ¢G—S¢w7—7FVÒrÀĞ¢g&öÓ¢w7—7FVÒrÀĞ¢6öçFVçC¢"G¶ÖVÖ&W$æÖWÒ"Š*¾z{¾X{®K¨n{êNˆ¦ Ğ¢Ò“°Ğ Ğ¢òòX‹~ikš^™Ú Ğ¢6WEF–ÖV÷WB‚‚’ÓâF†—2ç6†÷tw&÷W6WGF–æw2‡²&WGW&åFô6†DÆ—7BÒ’Â3“°Ğ¢Ò“°Ğ¢Ò“°Ğ Ğ¢òò	ùJRk{¾Xªh‰YhÈ™*àĞ¢VW'’‚r6FBÖÖVÖ&W"Ö'Fâr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢F†—2ç6†÷tFDÖVÖ&W$F–Æör†Æ—fT6†BÂ²&WGW&åFô6†DÆ—7BÒ“°Ğ¢Ò“°Ğ Ğ¢òòKùŞZÙhÈ™*àĞ¢VW'’‚r76fRÖw&÷W×6WGF–æw2r“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7BæWtæÖRÒVW'’‚r6w&÷WÖæÖRÖ–çWBr“òçfÇVSòçG&–Ò‚’ÇÂrs°Ğ Ğ¢òò	ùJRZh.iéÎ{êNYŞiKXùûÈÎk{¾Xª{;¾{¹şkhhğĞ¢–b†æWtæÖRbbæWtæÖRÓÒ÷&–v–æÄæÖR’°Ğ¢Æ—fT6†BææÖRÒæWtæÖS°Ğ¢F†—2æçvV6†DFFæFDÖW76vR†Æ—fT6†Bæ–BÂ°Ğ¢G—S¢w7—7FVÒrÀĞ¢g&öÓ¢w7—7FVÒrÀĞ¢6öçFVçC¢{êNYŞ[{.iKK‹¢"G¶æWtæÖWÒ& Ğ¢Ò“°Ğ¢ĞĞ Ğ¢–b†æWtfF"’°Ğ¢6öç7BöÆDfF"Ò7G&–ær†Æ—fT6†BæfF"ÇÂrr’çG&–Ò‚“°Ğ¢Æ—fT6†BæfF"ÒæWtfF#°Ğ¢–b†öÆDfF"bböÆDfF"ÓÒæWtfF"’°Ğ¢6öç7B6ÆVçWF6²Òv–æF÷råf—'GVÅ†öæSòæ–ÖvTÖævW#òæFVÆWFTÖævVD&6¶w&÷VæD'•Fƒòâ†öÆDfF"Â²V–WC¢G'VRÂ6¶—–e&VfW&Væ6VC¢G'VRÒ“°Ğ¢6ÆVçWF6³òæ6F6ƒòâ‚‚’Óâ²Ò“°Ğ¢ĞĞ¢ĞĞ Ğ¢òòKùŞZÙi[hÚàĞ¢F†—2æçvV6†DFFç6fTFF‚“°Ğ Ğ¢–b‡&WGW&åFô6†DÆ—7B’°Ğ¢F†—2ææ7W'&VçD6†BÒçVÆÃ°Ğ¢F†—2ææ7W'&VçEf–WrÒv6†G2s°Ğ¢ĞĞ¢F†—2æç&VæFW"‚“°Ğ¢Ò“°Ğ¢ĞĞ Ğ¢òò	ùJRk{¾Xª{êNh‰Y[Ëz©pĞ¢6†÷tFDÖVÖ&W$F–Æör†6†BÂ÷F–öç2Ò·Ò’°Ğ¢6öç7B&WGW&åFô6†DÆ—7BÒ÷F–öç3òç&WGW&åFô6†DÆ—7BÓÓÒG'VS°Ğ¢ÆWB—4FF–ætÖVÖ&W"ÒfÇ6S°Ğ¢òòˆë~Xùnh˜iÈˆN{;¾K«®ûÈhé.™šN[{.YÊ{êN˜xÎy¨NûÈĞ¢6öç7B6öçF7G2ÒF†—2æçvV6†DFFævWD6öçF7G2‚“°Ğ¢6öç7BW†—7F–ætÖVÖ&W'2Ò6†BæÖVÖ&W'2ÇÂµÓ°Ğ¢6öç7BW†—7F–ætÖVÖ&W$¶W—2ÒæWr6WB†W†—7F–ætÖVÖ&W'2æÖ†æÖRÓâF†—2åöæ÷&ÖÆ—¦TÆöö·WæÖR†æÖR’’æf–ÇFW"„&ööÆVâ’“°Ğ¢6öç7Bf–Æ&ÆT6öçF7G2Ò6öçF7G2æf–ÇFW"‚†6öçF7B’Óâ°Ğ¢6öç7BÆ–6W2ÒF†—2æçvV6†DFFòåövWD6öçF7DÆ–5fÇVW3òâ†6öçF7BĞ¢ÇÂ¶6öçF7CòææÖRÂ6öçF7Còææ–6¶æÖRÂ6öçF7Còç&VÖ&²Â6öçF7Còç&VÄæÖUÓ°Ğ¢&WGW&âÆ–6W2ç6öÖR†Æ–2ÓâW†—7F–ætÖVÖ&W$¶W—2æ†2‡F†—2åöæ÷&ÖÆ—¦TÆöö·WæÖR†Æ–2’’“°Ğ¢Ò“°Ğ Ğ¢6öç7B‡FÖÂÒ Ğ¢ÆF—b6Æ73Ò'vV6†BÖvV6†B×&VF&ÆR×6WGF–æw2#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"#àĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"ÖÆVgB#àĞ¢Æ'WGFöâ6Æ73Ò'vV6†BÖ&6²Ö'Fâ"–CÒ&&6²Ög&öÒÖFBÖÖVÖ&W"#àĞ¢Æ’6Æ73Ò&f×6öÆ–BfÖ6†Wg&öâÖÆVgB#ãÂö“àĞ¢Âö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×F—FÆR#îk{¾Xª{êNh‰YƒÂöF—càĞ¢ÆF—b6Æ73Ò'vV6†BÖ†VFW"×&–v‡B#ãÂöF—càĞ¢ÂöF—càĞ Ğ¢ÆF—b6Æ73Ò'vV6†BÖ6öçFVçB"7G–ÆSÒ&&6¶w&÷VæC¢6VFVFVC²#àĞ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6ffc²FF–æs¢'‚Wƒ²Ö&v–âÖ&÷GFöÓ¢‡ƒ²&÷&FW"Ö&÷GFöÓ¢ãW‚6öÆ–B6ccc²#àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢'ƒ²6öÆ÷#¢3“““²Ö&v–âÖ&÷GFöÓ¢‡ƒ²#îh˜¾Xªk{¾XªûÈXúşk{¾Xª™ÙîZ[ŞXø¾ûÈ“ÂöF—càĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¢fÆWƒ²v¢‡ƒ²#àĞ¢Æ–çWB–CÒ&ÖçVÂÖÖVÖ&W"Ö–çWB"G—SÒ'FW‡B"Æ6V†öÆFW#Ò.‹é>XZ^h‰YYŞZÙr"7G–ÆSÒ Ğ¢fÆWƒ¢°Ğ¢Ö–â×v–GFƒ¢°Ğ¢FF–æs¢‡‚ƒ°Ğ¢&÷&FW#¢‚6öÆ–B6SVSVSS°Ğ¢&÷&FW"×&F—W3¢gƒ°Ğ¢föçB×6—¦S¢7ƒ°Ğ¢÷WFÆ–æS¢æöæS°Ğ¢&÷‚×6—¦–æs¢&÷&FW"Ö&÷ƒ°Ğ¢#àĞ¢Æ'WGFöâ–CÒ&ÖçVÂÖÖVÖ&W"ÖFBÖ'Fâ"7G–ÆSÒ Ğ¢FF–æs¢‡‚'ƒ°Ğ¢&÷&FW#¢‚6öÆ–B6C–C–C“°Ğ¢&6¶w&÷VæC¢6ffc°Ğ¢6öÆ÷#¢3333°Ğ¢&÷&FW"×&F—W3¢gƒ°Ğ¢föçB×6—¦S¢'ƒ°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢fÆW‚×6‡&–æ³¢°Ğ¢#îk{¾XªÂö'WGFöãàĞ¢ÂöF—càĞ¢ÂöF—càĞ Ğ¢G¶f–Æ&ÆT6öçF7G2æÆVæwF‚âò Ğ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢6ffc²FF–æs¢‚²#àĞ¢G¶f–Æ&ÆT6öçF7G2æÖ†6öçF7BÓâ°Ğ¢6öç7BF—7Æ”æÖRÒF†—2åövWD6öçF7DF—7Æ”æÖR†6öçF7B“°Ğ¢&WGW&â Ğ¢ÆF—b6Æ73Ò&FBÖÖVÖ&W"Ö—FVÒ"FFÖæÖSÒ"G·F†—2åöVæ6öFTFFFö¶Vâ†F—7Æ”æÖR—Ò"7G–ÆSÒ Ğ¢F—7Æ“¢fÆWƒ°Ğ¢Æ–vâÖ—FV×3¢6VçFW#°Ğ¢FF–æs¢‚Wƒ°Ğ¢7W'6÷#¢ö–çFW#°Ğ¢&÷&FW"Ö&÷GFöÓ¢ãW‚6öÆ–B6ccc°Ğ¢#àĞ¢ÆF—b7G–ÆSÒ Ğ¢v–GFƒ¢Cƒ°Ğ¢†V–v‡C¢Cƒ°Ğ¢&÷&FW"×&F—W3¢gƒ°Ğ¢&6¶w&÷VæC¢6ccc°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢Æ–vâÖ—FV×3¢6VçFW#°Ğ¢§W7F–g’Ö6öçFVçC¢6VçFW#°Ğ¢föçB×6—¦S¢#ƒ°Ğ¢Ö&v–â×&–v‡C¢'ƒ°Ğ¢÷fW&fÆ÷s¢†–FFVã°Ğ¢#âG·F†—2æç&VæFW$fF"†6öçF7BæfF"Â	ùBrÂF—7Æ”æÖR—ÓÂöF—càĞ¢ÆF—b7G–ÆSÒ&fÆWƒ¢²#àĞ¢ÆF—b7G–ÆSÒ&föçB×6—¦S¢Wƒ²6öÆ÷#¢3²#âG¶F—7Æ”æÖWÓÂöF—càĞ¢ÂöF—càĞ¢Æ’6Æ73Ò&f×6öÆ–Bf×ÇW2"7G–ÆSÒ&6öÆ÷#¢3v3c²föçB×6—¦S¢gƒ²#ãÂö“àĞ¢ÂöF—càĞ¢·Ò’æ¦ö–â‚rr—ĞĞ¢ÂöF—càĞ¢¢ Ğ¢ÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¢6VçFW#²FF–æs¢Cƒ²6öÆ÷#¢3“““²#àĞ¢k*iÈXúşk{¾Xªy¨NˆN{;¾K« Ğ¢ÂöF—càĞ¢ĞĞ¢ÂöF—càĞ¢ÂöF—càĞ¢°Ğ Ğ¢F†—2æç†öæU6†VÆÂç6WD6öçFVçB†‡FÖÂÂvV6†BÖFBÖÖVÖ&W"ÒG¶6†Bæ–GÖ“°Ğ¢6öç7B7W'&VçEf–WrÒFö7VÖVçBçVW'•6VÆV7F÷"‚rç†öæR×f–WrÖ7W'&VçBr’ÇÂFö7VÖVçC°Ğ¢6öç7BVW'’Ò‡6VÆV7F÷"’Óâ7W'&VçEf–WrçVW'•6VÆV7F÷"‡6VÆV7F÷"“°Ğ Ğ¢òò‹ùNY¹îhÈ™*àĞ¢VW'’‚r6&6²Ög&öÒÖFBÖÖVÖ&W"r“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢F†—2ç6†÷tw&÷W6WGF–æw2‡²&WGW&åFô6†DÆ—7BÒ“°Ğ¢Ò“°Ğ Ğ¢6öç7BFDÖVÖ&W$'”æÖRÒ‡&tæÖR’Óâ°Ğ¢–b†—4FF–ætÖVÖ&W"’&WGW&ã°Ğ¢6öç7BÖVÖ&W$æÖRÒ7G&–ær‡&tæÖRÇÂrr’çG&–Ò‚“°Ğ¢–b‚ÖVÖ&W$æÖR’&WGW&ã°Ğ¢—4FF–ætÖVÖ&W"ÒG'VS°Ğ Ğ¢6öç7BW†—7G2Ò†6†BæÖVÖ&W'2ÇÂµÒ’ç6öÖR†ÒÓâ7G&–ær†ÒÇÂrr’çG&–Ò‚’ÓÓÒÖVÖ&W$æÖR“°Ğ¢–b†W†—7G2’°Ğ¢F†—2æç†öæU6†VÆÂç6†÷tæ÷F–f–6F–öâ‚~hùzK¢rÂ~Šú^h‰Y[{.YÊ{êN˜xÂrÂ~)ªûˆòr“°Ğ¢—4FF–ætÖVÖ&W"ÒfÇ6S°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢–b‚6†BæÖVÖ&W'2’6†BæÖVÖ&W'2ÒµÓ°Ğ¢6†BæÖVÖ&W'2çW6‚†ÖVÖ&W$æÖR“°Ğ Ğ¢6öç7BFF6†BÒF†—2æçvV6†DFFævWD6†B†6†Bæ–B“°Ğ¢–b†FF6†B’°Ğ¢–b‚FF6†BæÖVÖ&W'2’FF6†BæÖVÖ&W'2ÒµÓ°Ğ¢FF6†BæÖVÖ&W'2Ò6†BæÖVÖ&W'3°Ğ¢F†—2ææ7W'&VçD6†BÒFF6†C°Ğ¢ĞĞ Ğ¢F†—2æçvV6†DFFæFDÖW76vR†6†Bæ–BÂ°Ğ¢G—S¢w7—7FVÒrÀĞ¢g&öÓ¢w7—7FVÒrÀĞ¢6öçFVçC¢"G¶ÖVÖ&W$æÖWÒ"XªXZ^K¨n{êNˆ¦ Ğ¢Ò“°Ğ¢6WEF–ÖV÷WB‚‚’ÓâF†—2ç6†÷tw&÷W6WGF–æw2‡²&WGW&åFô6†DÆ—7BÒ’Â##“°Ğ¢Ó°Ğ Ğ¢VW'’‚r6ÖçVÂÖÖVÖ&W"ÖFBÖ'Fâr“òæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢6öç7B–çWBÒVW'’‚r6ÖçVÂÖÖVÖ&W"Ö–çWBr“°Ğ¢FDÖVÖ&W$'”æÖR†–çWCòçfÇVRÇÂrr“°Ğ¢Ò“°Ğ Ğ¢VW'’‚r6ÖçVÂÖÖVÖ&W"Ö–çWBr“òæFDWfVçDÆ—7FVæW"‚v¶W–F÷vârÂ†R’Óâ°Ğ¢–b†Ræ¶W’ÓÓÒtVçFW"r’°Ğ¢Rç&WfVçDFVfVÇB‚“°Ğ¢FDÖVÖ&W$'”æÖR†Ræ7W'&VçEF&vWBçfÇVRÇÂrr“°Ğ¢ĞĞ¢Ò“°Ğ Ğ¢òòx+X{¾k{¾Xªh‰Y€Ğ¢7W'&VçEf–WrçVW'•6VÆV7F÷$ÆÂ‚ræFBÖÖVÖ&W"Ö—FVÒr’æf÷$V6‚†—FVÒÓâ°Ğ¢—FVÒæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°Ğ¢FDÖVÖ&W$'”æÖR‡F†—2åöFV6öFTFFFö¶Vâ†—FVÒæFF6WBææÖR’“°Ğ¢Ò“°Ğ¢Ò“°Ğ¢ĞĞ Ğ¢öVæ6öFTFFFö¶Vâ‡fÇVR’°Ğ¢&WGW&âVæ6öFUU$”6ö×öæVçB…7G&–ær‡fÇVRÇÂrr’“°Ğ¢ĞĞ Ğ¢öFV6öFTFFFö¶Vâ‡fÇVR’°Ğ¢G'’°Ğ¢&WGW&âFV6öFUU$”6ö×öæVçB…7G&–ær‡fÇVRÇÂrr’“°Ğ¢Ò6F6‚…ò’°Ğ¢&WGW&â7G&–ær‡fÇVRÇÂrr“°Ğ¢ĞĞ¢ĞĞ Ğ¢öW66T‡FÖÂ‡FW‡B’°Ğ¢6öç7BF—bÒFö7VÖVçBæ7&VFTVÆVÖVçB‚vF—br“°Ğ¢F—bçFW‡D6öçFVçBÒ7G&–ær‡FW‡Bóòrr“°Ğ¢&WGW&âF—bæ–ææW$…DÔÃ°Ğ¢ĞĞ Ğ¢öFV6öFT‡FÖÄVçF—F–W2‡FW‡B’°Ğ¢6öç7BF—bÒFö7VÖVçBæ7&VFTVÆVÖVçB‚vF—br“°Ğ¢F—bæ–ææW$…DÔÂÒ7G&–ær‡FW‡Bóòrr“°Ğ¢&WGW&âF—bçFW‡D6öçFVçBÇÂrs°Ğ¢ĞĞ Ğ¢÷&W6öÇfT6ÆÅEE46öçFVçB‡FW‡BÂ6ÆÅG—RÒwfö–6Rr’°Ğ¢ÆWB&rÒF†—2å÷7G&—6ÆÅ7VV6…&Vf—‚‡F†—2åöFV6öFT‡FÖÄVçF—F–W2‡FW‡B’“°Ğ¢&rÒ7G&—vV6†EGG4æöå7VV6„6öçFVçB‡&r“°Ğ¢–b†6ÆÅG—RÓÓÒwf–FVòr’°Ğ¢òòŠxnš)˜	®ŠùŞûÉ®Xú®Šû¾Zûy›ŞûÈÎ‹{>‹ø~hºÎXû~Xh^y¨NyK¾™Ú.høşXiûÈiJşhÈKŠŞˆ»ih~hºÎXû~ûÈĞ¢ÆWB&WbÒrs°Ğ¢v†–ÆR‡&rÓÒ&Wb’°Ğ¢&WbÒ&s°Ğ¢&rÒ&rç&WÆ6R‚şûÈ…µîûÈûÈ•Ò®ûÈ—ÅÂ…µâ‚•Ò¥Â’örÂrr“°Ğ¢ĞĞ¢&rÒ&rç&WÆ6R‚õÇ2²örÂrr’çG&–Ò‚“°Ğ¢ĞĞ¢&WGW&â&s°Ğ¢ĞĞ Ğ¢÷&W6öÇfT6ÆÄ'V&&ÆU6VæFW$æÖR†'V&&ÆRÒçVÆÂ’°Ğ¢6öç7Bæ÷&ÖÆ—¦TæÖRÒ‡fÇVR’Óâ7G&–ær‡fÇVRÇÂrr’ç&WÆ6R‚õÇ2²örÂrr’çG&–Ò‚“°Ğ¢–b‚'V&&ÆR’&WGW&âæ÷&ÖÆ—¦TæÖR‡F†—2æòæ7W'&VçD6†CòææÖRÇÂ~Zûik’r’ÇÂ~Zûik’s°Ğ Ğ¢ÆWB6VæFW$æÖRÒæ÷&ÖÆ—¦TæÖR‡F†—2åöFV6öFT‡FÖÄVçF—F–W2†'V&&ÆRæFF6WCòç6VæFW"ÇÂrr’“°Ğ¢–b‡6VæFW$æÖR’&WGW&â6VæFW$æÖS°Ğ Ğ¢6öç7B&÷rÒ'V&&ÆRæ6Æ÷6W7B‚ræ6ÆÂÖ×6r×&÷rr“°Ğ¢6öç7B6VæFW$Æ&VÂÒ&÷sòçVW'•6VÆV7F÷"‚ræ6ÆÂÖ×6r×6VæFW"ÖÆ&VÂr’ÇÂ'V&&ÆRç&VçDVÆVÖVçCòçVW'•6VÆV7F÷"‚ræ6ÆÂÖ×6r×6VæFW"ÖÆ&VÂr“°Ğ¢6VæFW$æÖRÒæ÷&ÖÆ—¦TæÖR‡6VæFW$Æ&VÃòçFW‡D6öçFVçBÇÂ6VæFW$Æ&VÃòæ–ææW%FW‡BÇÂrr“°Ğ¢–b‡6VæFW$æÖR’&WGW&â6VæFW$æÖS°Ğ Ğ¢&WGW&âæ÷&ÖÆ—¦TæÖR‡F†—2æòæ7W'&VçD6†CòææÖRÇÂ~Zûik’r’ÇÂ~Zûik’s°Ğ¢ĞĞ Ğ¢òòXÎjÚ.[êîKú˜	®ŠùŞy¨EEE>i*ŞiKàĞ¢7F÷vV6†D6ÆÅEE2‚’°Ğ¢F†—2æ7W'&VçEGG5&÷VæBÒçVÆÃ²òòh™>ijŞK»¾KÙ^jÚ>YÊ‹ù¾ŠÎy¨N™‰şX‰pĞ¢–b‡F†—2æVF–õÆ–W"’°Ğ¢F†—2æVF–õÆ–W"çW6R‚“°Ğ¢F†—2æVF–õÆ–W"ç7&2Òrs°Ğ¢ĞĞ¢–b‡F†—2æ7W'&VçEÆ––æt6ÆÄ×6t–B’°Ğ¢6öç7B&Wd'V&&ÆRÒFö7VÖVçBævWDVÆVÖVçD'”–B‡F†—2æ7W'&VçEÆ––æt6ÆÄ×6t–B“°Ğ¢–b‡&Wd'V&&ÆR’&Wd'V&&ÆRæ6Æ74Æ—7Bç&VÖ÷fR‚wfö–6R×Æ––ærr“°Ğ¢F†—2æ7W'&VçEÆ––æt6ÆÄ×6t–BÒçVÆÃ°Ğ¢ĞĞ¢ĞĞ Ğ¢òòi*ŞiKî[êîKú˜	®ŠùŞy¨EEE0Ğ¢7–æ2Æ•vV6†D6ÆÅEE2‡FW‡BÂ'V&&ÆR’°Ğ¢6öç7B7F÷&vRÒv–æF÷råf—'GVÅ†öæSòç7F÷&vS°Ğ¢6öç7BGG4ÖævW"Òv–æF÷råf—'GVÅ†öæSòçGG4ÖævW#°Ğ¢–b‚7F÷&vR’&WGW&ã°Ğ¢6öç7BFW‡EFõ7V²ÒF†—2å÷&W6öÇfT6ÆÅEE46öçFVçB‡FW‡BÂ'V&&ÆSòæFF6WCòæ6ÆÅG—RÇÂwfö–6Rr“°Ğ¢–b‚FW‡EFõ7V²’&WGW&ã°Ğ¢òòZûik[ø^š¾KÛşyJ{¹Zé®™û>ˆ›.ûÉ¾ˆz®[{y¨NŠúŞ™û>KÉXXKÛşyJKŠ®K«®‹XNiiKŠŞy¨NK‰>[î˜XŞ{Úî8 Ğ¢6öç7BW6W%fö–6RÒF†—2å÷&W6öÇfUvV6†EW6W%fö–6R‚“°Ğ¢ÆWBf–æÅfö–6RÒW6W%fö–6Rçfö–6S°Ğ¢ÆWBf–æÅ&÷f–FW"ÒW6W%fö–6Rç&÷f–FW#°Ğ¢ÆWBf–æÄÆæwVvT&ö÷7BÒvWFòs°Ğ¢6öç7B&÷rÒ'V&&ÆSòæ6Æ÷6W7Còâ‚ræ6ÆÂÖ×6r×&÷rr“°Ğ¢6öç7B—4ÖRÒ†'V&&ÆRbb'V&&ÆRæ6Æ74Æ—7Bæ6öçF–ç2‚wvV6†BÖ6ÆÂÖ’Ö'V&&ÆRr’’ÇÀĞ¢‡&÷rbb7G&–ær‡&÷rç7G–ÆSòæ§W7F–g”6öçFVçBÇÂrr’çG&–Ò‚’ÓÓÒvfÆW‚ÖVæBr“°Ğ¢ Ğ¢–b‚—4ÖR’°Ğ¢òò˜	®ŠùŞKŠŞZûikŠûNŠùŞûÈÎKÉXXKÛşyJk	Nk:{¹Zé®y¨NXù˜ˆ^ûÈÎXhŞY¹î˜X‹Xù˜ˆ^j~zÛàĞ¢6öç7B6VæFW$æÖRÒF†—2å÷&W6öÇfT6ÆÄ'V&&ÆU6VæFW$æÖR†'V&&ÆR“°Ğ¢–b‡6VæFW$æÖR’°Ğ¢6öç7B²fö–6RÂ&÷f–FW"ÂÆæwVvT&ö÷7BÒÒF†—2å÷&W6öÇfUvV6†D&÷VæEfö–6T'”æÖR‡6VæFW$æÖRÂ²ÆÆ÷tvVæFW$fÆÆ&6³¢G'VRÒ“°Ğ¢–b‡fö–6R’°Ğ¢f–æÅfö–6RÒfö–6S°Ğ¢f–æÅ&÷f–FW"Ò&÷f–FW"ÇÂf–æÅ&÷f–FW#°Ğ¢f–æÄÆæwVvT&ö÷7BÒÆæwVvT&ö÷7BÇÂvWFòs°Ğ¢F†—2åö6ÆV$Ö—76–æt&÷VæEfö–6Uv&â‡6VæFW$æÖRÂ²66VæS¢v6ÆÂrÒ“°Ğ¢ÒVÇ6R°Ğ¢òòiÊ®{¹Zé®™û>ˆ›.K‰NXYÎ[©^™û>ˆ›.K™şiÊ®˜XŞ{Úîi{nûÈÎ‹{>‹ø~[Ù>X˜ŞŠúŞ™û>y¨NyIşh‰ Ğ¢F†—2åöæ÷F–g”Ö—76–æt&÷VæEfö–6Töæ6R‡6VæFW$æÖRÂ²66VæS¢v6ÆÂrÒ“°Ğ¢&WGW&ã² Ğ¢ĞĞ¢ĞĞ¢ĞĞ¢6öç7Bfö–6RÒf–æÅfö–6S°Ğ¢6öç7B&÷f–FW"Òf–æÅ&÷f–FW#°Ğ¢6öç7BÆæwVvT&ö÷7BÒf–æÄÆæwVvT&ö÷7C°Ğ Ğ¢–b‚GG4ÖævW"’&WGW&ã°Ğ Ğ¢G'’°Ğ¢òòXÎjÚ.Kˆ®KˆKŠ Ğ¢–b‡F†—2æ7W'&VçEÆ––æt6ÆÄ×6t–B’°Ğ¢6öç7B&Wd'V&&ÆRÒFö7VÖVçBævWDVÆVÖVçD'”–B‡F†—2æ7W'&VçEÆ––æt6ÆÄ×6t–B“°Ğ¢–b‡&Wd'V&&ÆR’&Wd'V&&ÆRæ6Æ74Æ—7Bç&VÖ÷fR‚wfö–6R×Æ––ærr“°Ğ¢ĞĞ Ğ¢6öç7B&Æö%W&ÂÒv—BGG4ÖævW"ç&WVW7EEE2‡FW‡EFõ7V²Â°Ğ¢&÷f–FW#¢&÷f–FW"ÇÂVæFVf–æVBÀĞ¢fö–6S¢fö–6RÇÂVæFVf–æVBÀĞ¢ÆæwVvT&ö÷7@Ğ¢Ò“°Ğ Ğ¢F†—2æVF–õÆ–W"ç7&2Ò&Æö%W&Ã°Ğ¢F†—2æ7W'&VçEÆ––æt6ÆÄ×6t–BÒ'V&&ÆRò'V&&ÆRæ–B¢çVÆÃ°Ğ¢–b†'V&&ÆR’'V&&ÆRæ6Æ74Æ—7BæFB‚wfö–6R×Æ––ærr“°Ğ Ğ¢v—BæWr&öÖ—6R‚‡&W6öÇfRÂ&V¦V7B’Óâ°Ğ¢F†—2æVF–õÆ–W"æöæVæFVBÒ‚’Óâ°Ğ¢–b†'V&&ÆR’'V&&ÆRæ6Æ74Æ—7Bç&VÖ÷fR‚wfö–6R×Æ––ærr“°Ğ¢U$Âç&Wfö¶Tö&¦V7EU$Â†&Æö%W&Â“°Ğ¢F†—2æ7W'&VçEÆ––æt6ÆÄ×6t–BÒçVÆÃ°Ğ¢&W6öÇfR‚“°Ğ¢Ó°Ğ¢F†—2æVF–õÆ–W"æöæW'&÷"Ò†R’Óâ°Ğ¢–b†'V&&ÆR’'V&&ÆRæ6Æ74Æ—7Bç&VÖ÷fR‚wfö–6R×Æ––ærr“°Ğ¢U$Âç&Wfö¶Tö&¦V7EU$Â†&Æö%W&Â“°Ğ¢F†—2æ7W'&VçEÆ––æt6ÆÄ×6t–BÒçVÆÃ°Ğ¢&W6öÇfR‚“²òòZë™I{º~{ºŞKˆ¾KˆKŠ Ğ¢Ó°Ğ¢F†—2æVF–õÆ–W"çÆ’‚’æ6F6‚‚‚’Óâ&W6öÇfR‚’“°Ğ¢Ò“°Ğ¢Ò6F6‚†W'&÷"’°Ğ¢6öç6öÆRæW'&÷"‚t6ÆÂEE2W'&÷#¢rÂW'&÷"“°Ğ¢–b†'V&&ÆR’'V&&ÆRæ6Æ74Æ—7Bç&VÖ÷fR‚wfö–6R×Æ––ærr“°Ğ¢ĞĞ¢ĞĞ Ğ¢òò{¹Zé®[êîKú˜	®ŠùŞk	Nk:x+X{¾‹ùîi*ŞK¨¾K»`Ğ¢&–æD6ÆÄ'V&&ÆT6Æ–6´WfVçG2†ÖW76vW4F—b’°Ğ¢–b‚ÖW76vW4F—bÇÂÖW76vW4F—båö6ÆÄWfVçD&÷VæB’&WGW&ã°Ğ¢ÖW76vW4F—båö6ÆÄWfVçD&÷VæBÒG'VS°Ğ¢ÖW76vW4F—bæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ7–æ2†R’Óâ°Ğ¢–b†RçF&vWBæ6Æ÷6W7Còâ‚rçvV6†BÖ–ææW"Ö÷2ÖföÆBÂçvV6†BÖ–ææW"Ö÷2×÷Wr’’&WGW&ã°Ğ¢6öç7B'V&&ÆRÒRçF&vWBæ6Æ÷6W7B‚rçvV6†BÖ6ÆÂÖ’Ö'V&&ÆRr“°Ğ¢–b‚'V&&ÆR’&WGW&ã°Ğ¢ Ğ¢òò	ùJRZh.iéÎjÚ>YÊ{Én‹éih~iÊÎûÈÎh‰nˆ^X‰®X‰®{¹>iÙş™[şhÈûÈÎzhjÚ.ŠznXùŠúŞ™û>i*ŞhªPĞ¢–b†'V&&ÆRæFF6WBæ—4VF—F–ærÓÓÒ'G'VR"ÇÂ'V&&ÆRæFF6WBç7W&W746Æ–6²ÓÓÒ'G'VR"’&WGW&ã°Ğ Ğ¢òòXhŞjÊx+X{¾jÚ>YÊi*ŞiKîy¨Nk	Nk:ÓâXÎjÚ.i*ŞiKî[›nKŠŞijŞ[Ù>X˜Ş[¨şX‰pĞ¢–b‡F†—2æ7W'&VçEÆ––æt6ÆÄ×6t–BÓÓÒ'V&&ÆRæ–BbbF†—2æVF–õÆ–W"çW6VB’°Ğ¢F†—2ç7F÷vV6†D6ÆÅEE2‚“°Ğ¢&WGW&ã°Ğ¢ĞĞ Ğ¢6öç7B&÷VæD–BÒ'V&&ÆRæFF6WBç&÷VæD–C°Ğ¢F†—2æ7W'&VçEGG5&÷VæBÒvÖçVÅòr²FFRææ÷r‚“²òòyIşh‰ikh˜¾[z^™‰şX‰~j~ŠëûÈÎh™>ijŞiz~™‰şX‰pĞ¢6öç7B7W'&VçDÖçVÅ&÷VæBÒF†—2æ7W'&VçEGG5&÷VæC°Ğ Ğ¢6öç7BÆÄ'V&&ÆW2Ò'&’æg&öÒ†ÖW76vW4F—bçVW'•6VÆV7F÷$ÆÂ†çvV6†BÖ6ÆÂÖ’Ö'V&&ÆU¶FF×&÷VæBÖ–CÒ"G·&÷VæD–GÒ%Ö’“°Ğ¢6öç7B7F'D–æFW‚ÒÆÄ'V&&ÆW2æ–æFW„öb†'V&&ÆR“°Ğ¢–b‡7F'D–æFW‚ÓÒÓ’°Ğ¢f÷"†ÆWB’Ò7F'D–æFWƒ²’ÂÆÄ'V&&ÆW2æÆVæwFƒ²’²²’°Ğ¢–b‡F†—2æ7W'&VçEGG5&÷VæBÓÒ7W'&VçDÖçVÅ&÷VæB’'&V³²òòKŠŞ˜	NŠ*¾h™>ijĞĞ¢6öç7B"ÒÆÄ'V&&ÆW5¶•Ó°Ğ¢6öç7BGG5FW‡BÒF†—2å÷&W6öÇfT6ÆÅEE46öçFVçB†"æFF6WBçFW‡BÂ"æFF6WBæ6ÆÅG—RÇÂwfö–6Rr“°Ğ¢–b‚GG5FW‡B’6öçF–çVS°Ğ¢v—BF†—2çÆ•vV6†D6ÆÅEE2‡GG5FW‡BÂ"“°Ğ¢ĞĞ¢ĞĞ¢Ò“°Ğ¢ĞĞ Ğ¢òò	ùJRi›®ˆ;Şk¹®XªûÉ®Xú®iÈyJh‹~YÊ[©^˜:™˜N‹ùi{nh˜Şˆz®Xªk¹®Xª€Ğ¢67&öÆÅFô&÷GFöÔ–dæVVFVB†f÷&6RÒfÇ6R’°Ğ¢6öç7BÖW76vW4F—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6†BÖÖW76vW2r“°Ğ¢–b‚ÖW76vW4F—b’&WGW&ã°Ğ Ğ¢òòŠêzé~yJh‹~iŠşY
nYÊ[©^˜:™˜N‹ùûÈ‹yŞzk¾[©^˜:ƒKº^Xh^ûÈĞ¢6öç7B—4æV$&÷GFöÒÒÖW76vW4F—bç67&öÆÄ†V–v‡BÒÖW76vW4F—bç67&öÆÅF÷ÒÖW76vW4F—bæ6Æ–VçD†V–v‡BÂ°Ğ Ğ¢òò[Ë®X‹nk¹®XªûÈšinjÊXª‹ÛŞûÈh‰nyJh‹~YÊ[©^˜:™˜N‹ùi{nh˜Şk¹®Xª€Ğ¢–b†f÷&6RÇÂ—4æV$&÷GFöÒ’°Ğ¢ÖW76vW4F—bç67&öÆÅF÷ÒÖW76vW4F—bç67&öÆÄ†V–v‡C°Ğ¢ĞĞ¢ĞĞ Ğ¢òò	ùJRikZ)îûÉ®{¹Zé®˜	®ŠùŞyXÎ™Ú.KŠŞy¨Nk	Nk:™[şhÈûÈ{Én‹éşXŠ™šNûÈK¨¾K»`Ğ¢&–æD6ÆÄÖW76vTÆöæu&W74WfVçG2†ÖW76vW4F—bÂ6†DÖW76vW2’°Ğ¢–b‚ÖW76vW4F—bÇÂÖW76vW4F—båö6ÆÄÆöæu&W74&÷VæB’&WGW&ã°Ğ¢ÖW76vW4F—båö6ÆÄÆöæu&W74&÷VæBÒG'VS°Ğ Ğ¢ÆWB&W75F–ÖW#°Ğ¢ÆWBF÷V6…7F'EF&vWBÒçVÆÃ°Ğ Ğ¢6öç7B6†÷tÖVçRÒ†'V&&ÆTVÂÂ–æFW‚’Óâ°Ğ¢òòXXz{¾™šN[{.iÈy¨NˆùÎXÙPĞ¢Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚ræ6ÆÂÖ7F–öâÖÖVçRr’æf÷$V6‚†ÒÓâÒç&VÖ÷fR‚’“°Ğ Ğ¢6öç7B—5&–v‡BÒ'V&&ÆTVÂç&VçDVÆVÖVçBç7G–ÆRæ§W7F–g”6öçFVçBÓÓÒvfÆW‚ÖVæBs°Ğ Ğ¢6öç7BÖVçTVÂÒFö7VÖVçBæ7&VFTVÆVÖVçB‚vF—br“°Ğ¢ÖVçTVÂæ6Æ74æÖRÒv6ÆÂÖ7F–öâÖÖVçRs°Ğ¢ÖVçTVÂç7G–ÆRæ775FW‡BÒ Ğ¢÷6—F–öã¢'6öÇWFS°Ğ¢F÷¢Ó3gƒ°Ğ¢G¶—5&–v‡Bòw&–v‡C¢²r¢vÆVgC¢²wĞĞ¢¢Ö–æFWƒ¢°Ğ¢F—7Æ“¢fÆWƒ°Ğ¢&6¶w&÷VæC¢&v&ƒ#SRÃ#SRÃ#SRÃã“R“°Ğ¢&6¶G&÷Öf–ÇFW#¢&ÇW"ƒ‡‚“°Ğ¢×vV&¶—BÖ&6¶G&÷Öf–ÇFW#¢&ÇW"ƒ‡‚“°Ğ¢&÷&FW"×&F—W3¢gƒ°Ğ¢÷fW&fÆ÷s¢†–FFVã°Ğ¢&÷‚×6†F÷s¢'‚‡‚&v&ƒÃÃÃãR“°Ğ¢v†—FR×76S¢æ÷w&°Ğ¢°Ğ¢ÖVçTVÂæ–ææW$…DÔÂÒ Ğ¢Æ'WGFöâ6Æ73Ò&6ÆÂÖ7F–öâÖ'Fâ"FFÖ7F–öãÒ&VF—B"7G–ÆSÒ&&6¶w&÷VæC§G&ç7&VçC¶6öÆ÷#¢3333¶&÷&FW#¦æöæS¶&÷&FW"×&–v‡C£‚6öÆ–B6VVS·FF–æs£g‚'ƒ¶föçB×6—¦S£'ƒ¶7W'6÷#§ö–çFW#²#î{Én‹éÂö'WGFöãàĞ¢Æ'WGFöâ6Æ73Ò&6ÆÂÖ7F–öâÖ'Fâ"FFÖ7F–öãÒ&FVÆWFR"7G–ÆSÒ&&6¶w&÷VæC§G&ç7&VçC¶6öÆ÷#¢6fc6#3¶&÷&FW#¦æöæS·FF–æs£g‚'ƒ¶föçB×6—¦S£'ƒ¶7W'6÷#§ö–çFW#²#îXŠ™šCÂö'WGFöãàĞ¢°Ğ Ğ¢'V&&ÆTVÂæVæD6†–ÆB†ÖVçTVÂ“°Ğ Ğ¢ÖVçTVÂçVW'•6VÆV7F÷$ÆÂ‚ræ6ÆÂÖ7F–öâÖ'Fâr’æf÷$V6‚†'FâÓâ°Ğ¢'FâæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ†R’Óâ°Ğ¢Rç7F÷&÷vF–öâ‚“°Ğ¢6öç7B7F–öâÒ'FâæFF6WBæ7F–öã°Ğ¢ÖVçTVÂç&VÖ÷fR‚“°Ğ Ğ¢–b†7F–öâÓÓÒvFVÆWFRr’°Ğ¢òò™©‰xşk	Nk:[›nh™>Kˆ®XŠ™šNj~Šë Ğ¢'V&&ÆTVÂæ6Æ÷6W7B‚ræ6ÆÂÖ×6r×&÷rr’ç7G–ÆRæF—7Æ’ÒvæöæRs°Ğ¢6†DÖW76vW5¶–æFW…Òæ—4FVÆWFVBÒG'VS°Ğ¢ÒVÇ6R–b†7F–öâÓÓÒvVF—Br’°Ğ¢6öç7B÷&–v–æÅFW‡BÒ6†DÖW76vW5¶–æFW…ÒçFW‡C°Ğ¢6öç7B—4ÖRÒ6†DÖW76vW5¶–æFW…Òæg&öÒÓÓÒvÖRs°Ğ¢F†—2å÷6WDÖW76vT–æÆ–æTVF—DÖöFR‡G'VRÂF†—2ææ7W'&VçD6†Còæ–B“°Ğ¢'V&&ÆTVÂæ6Æ÷6W7B‚rçvV6†BÖ–ææW"Ö÷2×w&W"r“òæ6Æ74Æ—7Bç&VÖ÷fR‚w6†÷rÖ÷2r“°Ğ¢ Ğ¢òò	ùJRKúîZHÓûÉ®Šë[Ù^XéşZëŞ[ªnûÈÎ[›nYÊ{Én‹éi{n[Ë®ŠÎi)kºk	Nk:ûÈKˆŞ‹h^‹ørÖ‚×v–GF‚sRRy¨N™™X‹nûÈĞ¢6öç7B÷&–v–æÅv–GF‚Ò'V&&ÆTVÂç7G–ÆRçv–GFƒ°Ğ¢'V&&ÆTVÂç7G–ÆRçv–GF‚ÒsRs°Ğ¢'V&&ÆTVÂç7G–ÆRæÖ–åv–GF‚ÒsC‚s² Ğ¢ Ğ¢òò	ùJRKúîZHÓ.ûÉ®z{¾™šBFW‡F&Vy¨NY»®Zé¢Ö–â×v–GFûÈÎiKK‹®š¹[ªnˆz®˜.[©B†÷fW&fÆ÷r×“¦WFòĞ¢'V&&ÆTVÂæ–ææW$…DÔÂÒ Ğ¢ÇFW‡F&V6Æ73Ò&6ÆÂÖ–æÆ–æRÖVF—B"7G–ÆSÒ'v–GFƒ£S²†V–v‡C¦WFó²Ö–âÖ†V–v‡C£Cƒ²Ö‚Ö†V–v‡C£#ƒ²FF–æs£gƒ²&÷&FW#¦æöæS²&÷&FW"×&F—W3£gƒ²föçB×6—¦S£7ƒ²&W6—¦S¦æöæS²&6¶w&÷VæC¢G¶—4ÖRòw&v&ƒ#SRÃ#SRÃ#SRÃãb’r¢w&v&ƒÃÃÃãR’wÓ²6öÆ÷#¢3²÷WFÆ–æS¦æöæS²&÷‚×6—¦–æs¦&÷&FW"Ö&÷ƒ²föçBÖfÖ–Ç“¦–æ†W&—C²÷fW&fÆ÷r×“¦WFó²#âG¶÷&–v–æÅFW‡GÓÂ÷FW‡F&VàĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC¦fÆW‚ÖVæC¶v£‡ƒ¶Ö&v–â×F÷£gƒ²#àĞ¢Æ'WGFöâ6Æ73Ò&6ÆÂÖVF—BÖ6æ6VÂ"7G–ÆSÒ'FF–æs£G‚ƒ¶föçB×6—¦S£ƒ¶&÷&FW#¦æöæS¶&÷&FW"×&F—W3£Gƒ¶&6¶w&÷VæC§&v&ƒÃÃÃã“¶6öÆ÷#¢3333¶7W'6÷#§ö–çFW#²#îXùnkhƒÂö'WGFöãàĞ¢Æ'WGFöâ6Æ73Ò&6ÆÂÖVF—B×6fR"7G–ÆSÒ'FF–æs£G‚ƒ¶föçB×6—¦S£ƒ¶&÷&FW#¦æöæS¶&÷&FW"×&F—W3£Gƒ¶&6¶w&÷VæC¢3v3c¶6öÆ÷#¢6ffc¶7W'6÷#§ö–çFW#²#îKùŞZÙƒÂö'WGFöãàĞ¢ÂöF—càĞ¢°Ğ¢ Ğ¢6öç7BFW‡F&VÒ'V&&ÆTVÂçVW'•6VÆV7F÷"‚ræ6ÆÂÖ–æÆ–æRÖVF—Br“°Ğ¢FW‡F&Væfö7W2‚“°Ğ Ğ¢òò	ùJRKúîZHÓ>ûÉ®XªXZ^ih~iÊÎjnš¹[ªnXªhˆz®˜.[©N˜¾‹éĞ¢6öç7BF§W7D†V–v‡BÒ‚’Óâ°Ğ¢FW‡F&Vç7G–ÆRæ†V–v‡BÒsC‚s²òòXX˜xŞ{ÚîûÈÎh˜Şˆ;Ş[èKˆ¾{ÊĞ¢FW‡F&Vç7G–ÆRæ†V–v‡BÒÖF‚æÖ–â‡FW‡F&Vç67&öÆÄ†V–v‡BÂ#’²w‚s°Ğ¢Ó°Ğ¢FW‡F&VæFDWfVçDÆ—7FVæW"‚v–çWBrÂF§W7D†V–v‡B“°Ğ¢6WEF–ÖV÷WB†F§W7D†V–v‡BÂ“²òòX‰ŞZx¾XÉni{n‹>KˆjÊš¹[ª`Ğ¢ Ğ¢òò	ùºûˆòj[ø>hªNy»îûÉ®™‹¾jÚ.™Jîy¹Y(Î‹é>XZ^K¨¾K»nXi.k:{¹˜Y.šhnûÈÎ™‹.jÚ"WFô6ö×ÆWFRhù.K»nhª^™I[Jk¨0Ğ¢FW‡F&VæFDWfVçDÆ—7FVæW"‚v–çWBrÂ†Wb’ÓâWbç7F÷&÷vF–öâ‚’“°Ğ¢FW‡F&VæFDWfVçDÆ—7FVæW"‚v¶W–F÷vârÂ†Wb’ÓâWbç7F÷&÷vF–öâ‚’“°Ğ¢FW‡F&VæFDWfVçDÆ—7FVæW"‚v¶W—WrÂ†Wb’ÓâWbç7F÷&÷vF–öâ‚’“°Ğ¢FW‡F&VæFDWfVçDÆ—7FVæW"‚vfö7W2rÂ†Wb’ÓâWbç7F÷&÷vF–öâ‚’“°Ğ¢FW‡F&VæFDWfVçDÆ—7FVæW"‚v&ÇW"rÂ†Wb’ÓâWbç7F÷&÷vF–öâ‚’“°Ğ¢ Ğ¢òòj~ŠëZHNK¨î{Én‹éx«nhûÈÎ™‹.jÚ.x+X{¾ŠznXùŠúŞ™û>i*ŞhªPĞ¢'V&&ÆTVÂæFF6WBæ—4VF—F–ærÒ'G'VR#°Ğ Ğ¢'V&&ÆTVÂçVW'•6VÆV7F÷"‚ræ6ÆÂÖVF—BÖ6æ6VÂr’æöæ6Æ–6²Ò†Wb’Óâ°Ğ¢Wbç7F÷&÷vF–öâ‚“°Ğ¢òò	ùJRh.ZHŞk	Nk:XéşiÚ^y¨NZëŞ[ª`Ğ¢'V&&ÆTVÂç7G–ÆRçv–GF‚Ò÷&–v–æÅv–GFƒ°Ğ¢'V&&ÆTVÂç7G–ÆRæÖ–åv–GF‚Òrs°Ğ¢–b†'V&&ÆTVÂæ6Æ74Æ—7Bæ6öçF–ç2‚wvV6†BÖ6ÆÂÖ’Ö'V&&ÆRr’’°Ğ¢F†—2å÷7–æ5vV6†D6ÆÄ'V&&ÆT–ææW%F†÷Vv‡B†'V&&ÆTVÂÂ6†DÖW76vW5¶–æFW…ÒçFW‡B“°Ğ¢ÒVÇ6R°Ğ¢'V&&ÆTVÂæ–ææW$…DÔÂÒF†—2åöW66T‡FÖÂ†6†DÖW76vW5¶–æFW…ÒçFW‡B“°Ğ¢ĞĞ¢FVÆWFR'V&&ÆTVÂæFF6WBæ—4VF—F–æs°Ğ¢F†—2å÷6WDÖW76vT–æÆ–æTVF—DÖöFR†fÇ6RÂF†—2ææ7W'&VçD6†Còæ–B“°Ğ¢Ó°Ğ Ğ¢'V&&ÆTVÂçVW'•6VÆV7F÷"‚ræ6ÆÂÖVF—B×6fRr’æöæ6Æ–6²Ò†Wb’Óâ°Ğ¢Wbç7F÷&÷vF–öâ‚“°Ğ¢6öç7BæWuFW‡BÒFW‡F&VçfÇVRçG&–Ò‚“°Ğ¢òò	ùJRh.ZHŞk	Nk:XéşiÚ^y¨NZëŞ[ª`Ğ¢'V&&ÆTVÂç7G–ÆRçv–GF‚Ò÷&–v–æÅv–GFƒ°Ğ¢'V&&ÆTVÂç7G–ÆRæÖ–åv–GF‚Òrs°Ğ¢ Ğ¢–b†æWuFW‡B’°Ğ¢6†DÖW76vW5¶–æFW…ÒçFW‡BÒæWuFW‡C°Ğ¢–b†'V&&ÆTVÂæ6Æ74Æ—7Bæ6öçF–ç2‚wvV6†BÖ6ÆÂÖ’Ö'V&&ÆRr’’°Ğ¢F†—2å÷7–æ5vV6†D6ÆÄ'V&&ÆT–ææW%F†÷Vv‡B†'V&&ÆTVÂÂæWuFW‡B“°Ğ¢ÒVÇ6R°Ğ¢'V&&ÆTVÂæ–ææW$…DÔÂÒF†—2åöW66T‡FÖÂ†æWuFW‡B“°Ğ¢ĞĞ¢ÒVÇ6R°Ğ¢–b†'V&&ÆTVÂæ6Æ74Æ—7Bæ6öçF–ç2‚wvV6†BÖ6ÆÂÖ’Ö'V&&ÆRr’’°Ğ¢F†—2å÷7–æ5vV6†D6ÆÄ'V&&ÆT–ææW%F†÷Vv‡B†'V&&ÆTVÂÂ6†DÖW76vW5¶–æFW…ÒçFW‡B“°Ğ¢ÒVÇ6R°Ğ¢'V&&ÆTVÂæ–ææW$…DÔÂÒF†—2åöW66T‡FÖÂ†6†DÖW76vW5¶–æFW…ÒçFW‡B“°Ğ¢ĞĞ¢ĞĞ¢FVÆWFR'V&&ÆTVÂæFF6WBæ—4VF—F–æs°Ğ¢F†—2å÷6WDÖW76vT–æÆ–æTVF—DÖöFR†fÇ6RÂF†—2ææ7W'&VçD6†Còæ–B“°Ğ¢Ó°Ğ¢ĞĞ¢Ò“°Ğ¢Ò“°Ğ Ğ¢òòx+X{¾X[nK¹nXË®Yùşˆz®XªX[>™zŞˆùÎXÙPĞ¢6WEF–ÖV÷WB‚‚’Óâ°Ğ¢Fö7VÖVçBæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂgVæ7F–öâ6Æ÷6TÖVçR†R’°Ğ¢–b‚ÖVçTVÂæ6öçF–ç2†RçF&vWB’’°Ğ¢ÖVçTVÂç&VÖ÷fR‚“°Ğ¢Fö7VÖVçBç&VÖ÷fTWfVçDÆ—7FVæW"‚v6Æ–6²rÂ6Æ÷6TÖVçR“°Ğ¢ĞĞ¢ÒÂ²öæ6S¢G'VRÒ“°Ğ¢ÒÂ“°Ğ¢Ó°Ğ Ğ¢6öç7B†æFÆU7F'BÒ†R’Óâ°Ğ¢–b†RçF&vWBæ6Æ÷6W7Còâ‚rçvV6†BÖ–ææW"Ö÷2ÖföÆBÂçvV6†BÖ–ææW"Ö÷2×÷Wr’’&WGW&ã°Ğ¢6öç7B'V&&ÆRÒRçF&vWBæ6Æ÷6W7B‚ræ6ÆÂÖ×6rÖ'V&&ÆRr“°Ğ¢–b‚'V&&ÆRÇÂ'V&&ÆRæFF6WBæ—4VF—F–ærÓÓÒ'G'VR"’&WGW&ã°Ğ¢F÷V6…7F'EF&vWBÒ'V&&ÆS°Ğ¢ Ğ¢&W75F–ÖW"Ò6WEF–ÖV÷WB‚‚’Óâ°Ğ¢6öç7B–G‚Ò'6T–çB†'V&&ÆRæFF6WBæ×6t–G‚Â“°Ğ¢–b‚—4æâ†–G‚’’°Ğ¢6†÷tÖVçR†'V&&ÆRÂ–G‚“°Ğ¢òòj~ŠëXè¾X‹nx+X{¾ûÈÎ™‹.jÚ.™[şhÈiÛî[Èi{nŠznXùEE0Ğ¢'V&&ÆRæFF6WBç7W&W746Æ–6²Ò'G'VR#°Ğ¢6WEF–ÖV÷WB‚‚’ÓâFVÆWFR'V&&ÆRæFF6WBç7W&W746Æ–6²ÂC“² Ğ¢ĞĞ¢ÒÂS“°Ğ¢Ó°Ğ Ğ¢6öç7B†æFÆTVæBÒ‚’Óâ²6ÆV%F–ÖV÷WB‡&W75F–ÖW"“²F÷V6…7F'EF&vWBÒçVÆÃ²Ó°Ğ Ğ¢ÖW76vW4F—bæFDWfVçDÆ—7FVæW"‚wF÷V6‡7F'BrÂ†æFÆU7F'BÂ²76—fS¢G'VRÒ“°Ğ¢ÖW76vW4F—bæFDWfVçDÆ—7FVæW"‚wF÷V6†VæBrÂ†æFÆTVæB“°Ğ¢ÖW76vW4F—bæFDWfVçDÆ—7FVæW"‚wF÷V6†Ö÷fRrÂ†æFÆTVæB“°Ğ¢ Ğ¢òòX[ÎZë’2zºşXû>™JîY(Î™[şhÈĞ¢ÖW76vW4F—bæFDWfVçDÆ—7FVæW"‚vÖ÷W6VF÷vârÂ†R’Óâ°Ğ¢–b†Ræ'WGFöâÓÓÒ"’²òòXû>™JàĞ¢Rç&WfVçDFVfVÇB‚“°Ğ¢6öç7B'V&&ÆRÒRçF&vWBæ6Æ÷6W7B‚ræ6ÆÂÖ×6rÖ'V&&ÆRr“°Ğ¢–b†'V&&ÆRbb'V&&ÆRæFF6WBæ—4VF—F–ærÓÒ'G'VR"’°Ğ¢6öç7B–G‚Ò'6T–çB†'V&&ÆRæFF6WBæ×6t–G‚Â“°Ğ¢–b‚—4æâ†–G‚’’6†÷tÖVçR†'V&&ÆRÂ–G‚“°Ğ¢ĞĞ¢ÒVÇ6R°Ğ¢†æFÆU7F'B†R“°Ğ¢ĞĞ¢Ò“°Ğ¢ÖW76vW4F—bæFDWfVçDÆ—7FVæW"‚vÖ÷W6WWrÂ†æFÆTVæB“°Ğ¢ÖW76vW4F—bæFDWfVçDÆ—7FVæW"‚vÖ÷W6VÆVfRrÂ†æFÆTVæB“°Ğ¢ÖW76vW4F—bæFDWfVçDÆ—7FVæW"‚v6öçFW‡FÖVçRrÂRÓâ°Ğ¢–b†RçF&vWBæ6Æ÷6W7B‚ræ6ÆÂÖ×6rÖ'V&&ÆRr’’Rç&WfVçDFVfVÇB‚“°Ğ¢Ò“°Ğ¢ĞĞ§ĞĞ