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

// 聊天界面视图
export class ChatView {
    constructor(wechatApp) {
        this.app = wechatApp;
        this.inputText = '';
        this.showEmoji = false;
        this.showMore = false;
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
    }

    // 🔥 判断当前会话是否开启在线模式（per-chat）
    isOnlineMode() {
        const storage = window.VirtualPhone?.storage;
        if (!storage) return false;
        const val = storage.get('wechat_online_mode');
        if (val === true || val === 'true' || val === 1) return true;
        if (val === false || val === 'false' || val === 0 || val === null || val === undefined) return false;
        return !!val;
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
        if (!safeChatId) return;
        this.pendingChatIds.add(safeChatId);

        if (!this.isOnlineMode()) return;

        if (shouldStartTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = setTimeout(() => this.triggerAI(), 6000);
        }

        if (shouldShowStatus) {
            this.showTypingStatus('等待回复', safeChatId);
        }
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
        const isPanelOpen = !!(this.showEmoji || this.showMore);
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
            this.app.render();
            setTimeout(restore, 0);
            return;
        }

        restore();
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
        return String(window.VirtualPhone?.storage?.get('phone-tts-voice') || '').trim();
    }

    _resolveWechatBoundVoiceByName(name, { allowGlobalFallback = false } = {}) {
        const wechatData = this.app?.wechatData;
        const resolved = wechatData?.resolveTtsVoiceByName?.(name, { includeChats: true }) || null;
        const voice = String(resolved?.voice || '').trim();
        if (voice) {
            return {
                voice,
                contact: resolved.contact || null
            };
        }

        if (allowGlobalFallback) {
            return {
                voice: this._getGlobalTtsVoice(),
                contact: resolved?.contact || null
            };
        }

        return {
            voice: '',
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
            ? `[${safeSender}] 未绑定专属音色，无法发声`
            : `请先在通讯录编辑[${safeSender}]，绑定专属音色`;
        this.app?.phoneShell?.showNotification(title, message, '⚠️');
        return true;
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
    }

    _applyAiReplyTimeline(messageObj, fallbackContent = '', options = {}) {
        if (!messageObj || typeof messageObj !== 'object') return;

        const timeManager = window.VirtualPhone?.timeManager;
        if (!timeManager?.getCurrentStoryTime) return;

        const contentText = String(messageObj.content || fallbackContent || '').trim();
        let cursor = this._aiReplyTimeCursor || timeManager.getCurrentStoryTime();
        if (!cursor?.time || !cursor?.date) {
            cursor = timeManager.getCurrentStoryTime();
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
        minutesToAdd = Math.max(0, Number(minutesToAdd) || 0);

        let nextTime = cursor;
        if (typeof timeManager.addMinutesToStoryTime === 'function') {
            nextTime = timeManager.addMinutesToStoryTime(cursor, minutesToAdd);
        }

        messageObj.time = nextTime?.time || cursor?.time || messageObj.time;
        messageObj.date = messageObj.date || nextTime?.date || cursor?.date;
        messageObj.weekday = messageObj.weekday || nextTime?.weekday || cursor?.weekday;

        if (typeof timeManager.setTime === 'function' && messageObj.time && messageObj.date) {
            timeManager.setTime(messageObj.time, messageObj.date, messageObj.weekday || null);
        }

        this._aiReplyTimeCursor = timeManager.getCurrentStoryTime();
    }
renderChatRoom(chat) {
        const messages = this.app.wechatData.getMessages(chat.id);
        const userInfo = this.app.wechatData.getUserInfo();
        const isCurrentChatSending = this.isSending && String(this._activeSendingChatId || '') === String(chat.id || '');

        return `
    <div class="chat-room">
                <div class="chat-messages" id="chat-messages">
                    ${this.renderMessagesWithDateDividers(messages, userInfo)}
                </div>

                <!-- 输入区 -->
                <div class="chat-input-area" style="background: rgba(255, 255, 255, 0.15) !important; backdrop-filter: blur(35px) saturate(200%) !important; -webkit-backdrop-filter: blur(35px) saturate(200%) !important; border-top: 0.5px solid rgba(0, 0, 0, 0.15) !important;">
                    <!-- 表情面板 -->
                    ${this.showEmoji ? this.renderEmojiPanel() : ''}

                    <!-- 更多功能面板 -->
                    ${this.showMore ? this.renderMorePanel() : ''}

                    <!-- 引用预览栏 - 仿真实微信浅灰条 -->
                    ${this.activeQuote ? `<div class="active-quote-bar" style="padding: 2px 8px; background: rgba(0,0,0,0.05); font-size: 10px; color: #888; display: flex; justify-content: space-between; align-items: center; line-height: 1.2;"><div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${this.activeQuote.sender}: ${this.activeQuote.content.length > 20 ? this.activeQuote.content.substring(0, 20) + '...' : this.activeQuote.content}</div><button id="cancel-quote-btn" style="background: none; border: none; color: #aaa; cursor: pointer; padding: 0 4px; font-size: 10px; line-height: 1;"><i class="fa-solid fa-xmark"></i></button></div>` : ''}

                    <!-- 输入行 -->
                    <div class="chat-input-bar" style="display: flex; align-items: center; justify-content: space-between; background: transparent !important;">
                        <div style="display: flex; align-items: center; gap: 0px;">
                            <button class="input-btn" id="regenerate-btn" title="重新生成">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
                            </button>
                            <button class="input-btn" id="more-btn">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
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
                            <button class="input-btn" id="send-btn" style="color: ${isCurrentChatSending ? '#ff3b30' : '#07c160'};">
                                ${isCurrentChatSending
                ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>`
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
                const msgDate = msg.date || null;
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

                html += this.renderMessage(msg, userInfo);
            } catch (e) {
                console.error('渲染单条消息失败，已跳过:', e, msg);
            }
        });

        // 渲染完成后尝试水合表情包占位符
        this.scheduleInlineStickerHydration();
        return html;
    }

    // 🔥 智能局部刷新消息列表（移动端安全版防闪烁）
    smartUpdateMessages(messages, userInfo) {
        const container = document.getElementById('chat-messages');
        if (!container) return;

        // 1. 记录更新前的滚动状态
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;

        // 2. 生成新 HTML
        const newHtml = this.renderMessagesWithDateDividers(messages, userInfo);

        // 3. 移动端安全替换：抛弃危险的 outerHTML，使用原生 innerHTML 替换
        container.innerHTML = newHtml;

        // 4. 重新绑定事件
        this.bindMessageLongPressEvents();
        this.bindSpecialMessageEvents();

        // 5. 恢复滚动状态（如果本来在底部，就继续贴底）
        if (isNearBottom) {
            container.scrollTop = container.scrollHeight;
        }
    }

    // 渲染单条消息（全新红包样式）
    renderMessage(msg, userInfo) {
        const isMe = msg.from === 'me' || msg.from === userInfo.name;
        const isRedPacketOpened = msg.status === 'opened';

        // 🔥🔥🔥 系统消息特殊处理（居中透明气泡）
        if (msg.type === 'system' || msg.from === 'system') {
            return `
            <div class="chat-message message-system" style="
                display: flex;
                justify-content: center;
                margin: 12px 0;
            ">
                <div class="system-message-bubble" style="
                    background: rgba(0, 0, 0, 0.05);
                    border-radius: 4px;
                    padding: 4px 10px;
                    font-size: 12px;
                    color: #888;
                    max-width: 80%;
                    text-align: center;
                ">
                    ${msg.content || ''}
                </div>
            </div>
        `;
        }

        // 🔥🔥🔥 群聊消息处理：获取发送者名字和头像
        const isGroupChat = this.app.currentChat?.type === 'group';
        let senderName = msg.from || '';
        let senderAvatar = msg.avatar || '👤';

        if (!isMe) {
            if (isGroupChat) {
                // 群聊：使用每条消息的发送者信息
                senderName = msg.from || '群成员';

                // 尝试从联系人获取头像
                const senderContact = this.app.wechatData.getContactByName(msg.from);
                if (senderContact && senderContact.avatar) {
                    senderAvatar = senderContact.avatar;
                } else {
                    // 🔥 核心修复1：群聊中如果没有专属头像，强制置空，绝对不能继承 msg.avatar（因为那往往携带的是群头像）
                    senderAvatar = ''; 
                }
            } else {
                // 单聊：使用当前聊天的头像
                senderAvatar = this.app.currentChat?.avatar || msg.avatar || '👤';
            }
        }

        let messageBody = '';

        switch (msg.type) {
            case 'image':
                messageBody = `<div class="message-image-box" style="position: relative; display: inline-block; line-height: 0;"><img src="${msg.content}" class="message-image"></div>`;
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
                const newVMatch = /^\[语音\]\s*(.+)$/.exec(msg.content);
                if (newVMatch) {
                    voiceText = newVMatch[1].trim();
                    durationNum = Math.max(2, Math.min(Math.ceil(voiceText.length / 3), 60));
                    durationStr = durationNum + '"';
                } else {
                    const oldVMatch = /^\[语音\s*(\d+)秒?\]\(?([^)]*)\)?$/.exec(msg.content);
                    if (oldVMatch) {
                        durationStr = oldVMatch[1] + '"';
                        voiceText = oldVMatch[2] || '';
                        durationNum = parseInt(oldVMatch[1]);
                    }
                }

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
                <div class="message-text voice-bubble-playable" id="voice-bubble-${msg.id || Math.random().toString(36).substr(2, 9)}" data-text="${(voiceText || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}" style="width: ${dynamicWidth}px; display: flex; justify-content: space-between; align-items: center; box-sizing: border-box; cursor: pointer;">
                    ${isMe
                        ? `<span>${durationStr}</span> ${voiceSvgRight}`
                        : `${voiceSvgLeft} <span>${durationStr}</span>`}
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
                    ">${voiceText}</div>
                `;
                }
                messageBody += `</div>`;
                break;
            case 'transfer': {
                const isTransferOpened = msg.status === 'received';
                const transferSubtitle = isMe ? '你发起了一笔转账' : (msg.status === 'received' ? '已被接收' : '收到转账');
                const formattedAmount = parseFloat(msg.amount || 0).toFixed(2);
                messageBody = `
                <div class="message-transfer ${isTransferOpened ? 'opened' : ''}" data-msg-id="${msg.id}">
                    <div class="rp-main">
                        <div class="rp-icon">
                            <!-- fake-world transfer2-outlined.svg 原版图标 -->
                            <svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                                <path fill-rule="evenodd" clip-rule="evenodd" d="M2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12ZM20.8 12C20.8 16.8601 16.8601 20.8 12 20.8C7.13989 20.8 3.2 16.8601 3.2 12C3.2 7.13989 7.13989 3.2 12 3.2C16.8601 3.2 20.8 7.13989 20.8 12ZM9.7899 9.92367H17V11.1237H9L7.54588 11.1237C7.26974 11.1237 7.04588 10.8998 7.04588 10.6237C7.04588 10.4757 7.11143 10.3353 7.2249 10.2403L10.3863 7.59332C10.5557 7.4515 10.808 7.47384 10.9498 7.64322C11.0632 7.77865 11.0743 7.97241 10.9772 8.11994L9.7899 9.92367ZM7.04588 14.08H14.256L13.0687 15.8837C12.9716 16.0313 12.9827 16.225 13.0961 16.3605C13.2379 16.5298 13.4902 16.5522 13.6596 16.4104L16.821 13.7634C16.9344 13.6684 17 13.528 17 13.38C17 13.1039 16.7761 12.88 16.5 12.88H15.0459H7.04588V14.08Z" />
                            </svg>
                        </div>
                        <div class="rp-content">
                            <div class="rp-title">¥${formattedAmount}</div>
                            <div class="rp-subtitle">${transferSubtitle}</div>
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
                if (isMe) {
                    messageBody = `<div class="message-text" style="display: inline-flex; align-items: center; gap: 6px;">${callStatusText} ${callSvg}</div>`;
                } else {
                    messageBody = `<div class="message-text" style="display: inline-flex; align-items: center; gap: 6px;">${callSvg} ${callStatusText}</div>`;
                }
                break;
            }

            case 'redpacket':
                messageBody = `
                <div class="message-redpacket ${isRedPacketOpened ? 'opened' : ''}" data-msg-id="${msg.id}">
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
                            <div class="rp-title">${msg.wish || '恭喜发财，大吉大利'}</div>
                            <!-- 没被领取时不显示副标题，对齐原生 -->
                            ${isRedPacketOpened ? `<div class="rp-subtitle">已被领取</div>` : ''}
                        </div>
                    </div>
                    <div class="rp-footer">微信红包</div>
                </div>
            `;
                break;

            // 表情包消息：优先走 ALAPI 图片，失败降级为“关键词占位卡片”
           case 'sticker':
                const stickerKeyword = msg.keyword || '发呆';
                
                // 🌟🌟🌟 新增核心：优先检查是否匹配本地“我的表情” 🌟🌟🌟
                const customEmojis = this.app.wechatData.getCustomEmojis();
                const matchedCustomEmoji = customEmojis.find(e => 
                    e.name === stickerKeyword || e.description === stickerKeyword
                );

                if (matchedCustomEmoji && matchedCustomEmoji.image) {
                    // 匹配到了用户自定义表情，直接渲染本地图片，跳过 ALAPI！
                    messageBody = `
                    <div class="message-sticker-box" style="line-height:1.2;">
                        <img src="${matchedCustomEmoji.image}" alt="${this._escapeHtml(matchedCustomEmoji.name)}" style="max-width: 140px; max-height: 140px; border-radius: 8px; object-fit: contain;">
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
                        data-image-size="56"
                        data-emoji-size="24"
                        style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;min-height:42px;background:transparent;padding:0;">
                        ${this.buildStickerKeywordFallbackMarkup(stickerKeyword, 56)}
                    </span>
                </div>`;
                break;

            case 'weibo_card': {
                const wb = msg.weiboData || {};
                messageBody = `
                <div class="message-weibo-card" data-msg-id="${msg.id || ''}" style="background: #fff; border: 1px solid #e8e8e8; border-radius: 8px; overflow: hidden; max-width: 220px; cursor: pointer;">
                    <div style="padding: 10px;">
                        <div style="font-size: 13px; font-weight: 600; color: #1a1a1a; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${wb.blogger || '微博'}
                        </div>
                        <div style="font-size: 12px; color: #666; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                            ${(wb.content || '').substring(0, 80)}
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

            default:
                // 🔥 普通文本消息（引用在气泡外下方显示）
                messageBody = `<div class="message-text">${this.parseEmoji(this._stripCallSpeechPrefix(msg.content))}</div>`;
                break;
        }

        // 🔥 引用内容：独立的 div，不影响气泡宽度
        const quoteHtml = msg.quote ? `<div style="font-size: 10px; color: #888; background: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: 3px; margin-top: 3px; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;">${msg.quote.sender}: ${msg.quote.content.length > 10 ? msg.quote.content.substring(0, 10) + '...' : msg.quote.content}</div>` : '';

        return `
        <div class="chat-message ${isMe ? 'message-right' : 'message-left'}">
            ${!isMe ? `<div class="message-avatar">${this.app.renderAvatar(senderAvatar, '👤', senderName)}</div>` : ''}
            <div class="message-content" style="display: inline-flex; flex-direction: column; ${isMe ? 'align-items: flex-end;' : 'align-items: flex-start;'}">
                ${!isMe && isGroupChat ? `<div class="message-sender" style="font-size: 12px; color: #576b95; margin-bottom: 2px;">${senderName}</div>` : ''}
                <div style="display: inline-block;">${messageBody}</div>
                ${quoteHtml}
            </div>
            ${isMe ? `<div class="message-avatar">${this.app.renderAvatar(userInfo.avatar, '😊', userInfo.name)}</div>` : ''}
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

           <div class="emoji-scroll">
                <div class="emoji-grid">
                    ${this.emojiTab === 'custom' ? `
                        <!-- 自定义表情 -->
                        ${customEmojis.map(emoji => `
                            <span class="emoji-item custom-emoji-item" data-emoji-type="custom" data-emoji-id="${emoji.id}" title="${this._escapeHtml(String(emoji.description || emoji.name || '表情'))}">
                                <img src="${emoji.image}" alt="${emoji.name}">
                            </span>
                        `).join('')}

                        <!-- 添加表情按钮 -->
                        <span class="emoji-item emoji-add" id="add-custom-emoji">
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

        return {
            apiKey,
            model,
            endpoint: 'https://api.siliconflow.cn/v1/images/generations',
            imageSize: '768x1024',
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

    _refreshVisibleChatMessages(chatId) {
        const activeChatId = String(this.app.currentChat?.id || '').trim();
        const targetChatId = String(chatId || '').trim();
        if (!activeChatId || !targetChatId || activeChatId !== targetChatId) return;

        const messages = this.app.wechatData.getMessages(targetChatId);
        const userInfo = this.app.wechatData.getUserInfo();
        this.smartUpdateMessages(messages, userInfo);
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

        const messages = this.app.wechatData.getMessages(chatId);
        const message = messages.find((item) => String(item?.id || '').trim() === safeMessageId);
        if (!message) return;

        const status = String(message.imageGenStatus || '').trim();
        if (status === 'loading') return;

        const promptText = String(message.imagePrompt || message.content || '').trim();
        if (!promptText) {
            this.app.phoneShell?.showNotification('提示', '这条图片消息缺少描述，无法生成', '⚠️');
            return;
        }

        const config = this._getSiliconflowImageConfig();
        if (!config.apiKey) {
            this.app.phoneShell?.showNotification('提示', '请先在设置里填写 SiliconFlow API Key', '⚠️');
            return;
        }

        this.app.wechatData.updateMessageById(chatId, safeMessageId, {
            imageGenStatus: 'loading',
            imageGenError: '',
            imagePrompt: promptText
        });
        this._refreshVisibleChatMessages(chatId);

        try {
            const response = await fetch(config.endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: config.model,
                    prompt: this._buildSiliconflowPositivePrompt(promptText, config),
                    negative_prompt: this._buildSiliconflowNegativePrompt(promptText, config.negativePrompt, config.noPeopleNegativePrompt),
                    image_size: config.imageSize,
                    batch_size: config.batchSize,
                    num_inference_steps: config.numInferenceSteps,
                    guidance_scale: config.guidanceScale
                })
            });

            const rawText = await response.text();
            let payload = null;
            if (rawText) {
                try {
                    payload = JSON.parse(rawText);
                } catch (parseError) {
                    payload = null;
                }
            }

            if (!response.ok) {
                const serverMessage = String(
                    payload?.message ||
                    payload?.error?.message ||
                    payload?.error ||
                    rawText ||
                    ''
                ).trim();
                throw new Error(`SiliconFlow 请求失败 (${response.status})${serverMessage ? `: ${serverMessage.slice(0, 160)}` : ''}`);
            }

            const imageUrl = String(payload?.images?.[0]?.url || '').trim();
            if (!imageUrl) {
                throw new Error('接口返回成功，但没有拿到图片地址');
            }

            this.app.wechatData.updateMessageById(chatId, safeMessageId, {
                imagePrompt: promptText,
                generatedImageUrl: imageUrl,
                imageGenStatus: 'done',
                imageGenError: '',
                imageModel: config.model,
                imageProvider: 'siliconflow'
            });
            this._refreshVisibleChatMessages(chatId);
        } catch (error) {
            const rawMessage = String(error?.message || '').trim();
            const friendlyMessage = /failed to fetch|networkerror|load failed/i.test(rawMessage)
                ? '请求失败，可能是网络异常或浏览器跨域拦截'
                : (rawMessage || '未知错误');

            console.error('微信图片生成失败:', error);

            this.app.wechatData.updateMessageById(chatId, safeMessageId, {
                imagePrompt: promptText,
                imageGenStatus: 'failed',
                imageGenError: friendlyMessage
            });
            this._refreshVisibleChatMessages(chatId);
            this.app.phoneShell?.showNotification('生图失败', friendlyMessage, '❌');
        }
    }

    renderImagePromptCard(msg) {
        const promptRaw = String(msg?.imagePrompt || msg?.content || '待生成图片').trim() || '待生成图片';
        const promptText = this._escapeHtml(promptRaw);
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
            ? `⏳ 正在${actionText}中，请稍候...`
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
                    background:
                        linear-gradient(180deg, rgba(255,255,255,0.18), rgba(26,24,36,0.72)),
                        linear-gradient(135deg, rgba(255, 160, 197, 0.24), rgba(130, 108, 188, 0.2));
                    border: 1px solid rgba(255, 205, 228, 0.34);
                    box-sizing: border-box;
                    cursor: ${generationStatus === 'loading' ? 'progress' : 'pointer'};
                ">
                    ${generatedImageUrl ? `
                        <img src="${safeImageUrl}" alt="${promptText}" style="width:100%; height:100%; object-fit:cover; display:block;">
                        ${isVideo ? `<div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none;"><div style="width:40px; height:40px; border-radius:50%; background:rgba(0,0,0,0.5); border:2px solid #fff; display:flex; align-items:center; justify-content:center; color:#fff; font-size:18px; padding-left:4px;"><i class="fa-solid fa-play"></i></div></div>` : ''}
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
                        <div class="message-image-prompt-generate" data-message-id="${cardId}" title="${generationStatus === 'failed' ? '点击重试' : `点击${actionText}`}" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:8px; padding:12px; box-sizing:border-box;">
                            <div style="
                                width:56px; height:56px; border-radius:18px;
                                display:flex; align-items:center; justify-content:center;
                                background:rgba(255,255,255,0.18);
                                border:1px solid rgba(255,255,255,0.26);
                                color:#fff; font-size:22px;
                                box-shadow:0 8px 18px rgba(0,0,0,0.12);
                            ">${generationStatus === 'loading' ? '<i class="fa-solid fa-spinner fa-spin"></i>' : defaultIcon}</div>
                            <div style="font-size:12px; line-height:1.35; color:#fff; text-align:center; font-weight:600;">${statusText}</div>
                        </div>
                        <div class="message-image-prompt-show-back" data-message-id="${cardId}" title="查看${msg.mediaType || '图片'}描述" style="
                            position:absolute;
                            right:6px;
                            bottom:6px;
                            background:rgba(0,0,0,0.5);
                            color:#fff;
                            border-radius:999px;
                            padding:4px 8px;
                            font-size:10px;
                            line-height:1;
                            cursor:pointer;
                            box-shadow:0 2px 8px rgba(0,0,0,0.18);
                        ">描述</div>
                    `}
                </div>
                <div class="message-image-prompt-back-panel" id="img-prompt-back-${cardId}" style="
                    display:none;
                    width:156px;
                    max-width:100%;
                    aspect-ratio:1;
                    background:#f7f7f7;
                    border:1px dashed #e0e0e0;
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
                            color:#666;
                            line-height:1.5;
                            word-break:break-word;
                            white-space:pre-wrap;
                            text-align:center;
                            width:100%;
                        ">${promptText}</div>
                    </div>
                    <div class="message-image-prompt-restore" data-message-id="${cardId}" title="恢复卡片正面" style="
                        position:absolute;
                        bottom:4px;
                        right:4px;
                        background:rgba(0,0,0,0.5);
                        color:#fff;
                        border-radius:4px;
                        padding:3px 6px;
                        font-size:10px;
                        cursor:pointer;
                        z-index:10;
                        display:flex;
                        align-items:center;
                        gap:3px;
                        box-shadow:0 2px 4px rgba(0,0,0,0.2);
                    ">
                        ${defaultIcon} 恢复
                    </div>
                </div>
            </div>
        `;
    }

    _formatMessageContentForPrompt(msg) {
        if (!msg || typeof msg !== 'object') return '';
        if (msg.type === 'text') return String(msg.content || '');
        if (msg.type === 'image_prompt') {
            const promptText = String(msg.imagePrompt || msg.content || '待生成图片').trim() || '待生成图片';
            const mediaType = msg.mediaType || '图片';
            return `[${mediaType}]（${promptText}）`;
        }
        if (msg.type === 'transfer') {
            const status = String(msg.status || '').trim() === 'received' ? '已收款' : '未收款';
            return `[转账 ¥${msg.amount}]（状态：${status}）`;
        }
        if (msg.type === 'redpacket') {
            const status = String(msg.status || '').trim() === 'opened' ? '已领取' : '未领取';
            return `[红包 ¥${msg.amount}]（状态：${status}）`;
        }
        return `[${msg.type}]`;
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
                <!-- 第一排：相册、拍照、语音通话、视频通话 -->
                <div class="more-item" data-action="photo">
                    <div class="more-icon">
                        <i class="fa-solid fa-image" style="font-size: 14px;"></i>
                    </div>
                    <div class="more-name">相册</div>
                </div>

                <div class="more-item" data-action="camera">
                    <div class="more-icon">
                        <i class="fa-solid fa-camera" style="font-size: 14px;"></i>
                    </div>
                    <div class="more-name">拍照</div>
                </div>

                <div class="more-item" data-action="screenshot">
                    <div class="more-icon">
                        <i class="fa-solid fa-camera-retro" style="font-size: 14px;"></i>
                    </div>
                    <div class="more-name">截图</div>
                </div>

                <div class="more-item" data-action="longshot">
                    <div class="more-icon">
                        <i class="fa-solid fa-scroll" style="font-size: 14px;"></i>
                    </div>
                    <div class="more-name">长截图</div>
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

        let result = text;
        // 0️⃣ 文本内联表情包：[表情包](关键词) / [表情包]（关键词）
        // 单独一整条的表情包消息会在数据层被识别为 `sticker` 类型，不走这里
        // 仅走关键词 -> emoji 映射，不走任何外部图源请求
        const inlineStickerRegex = /\[表情包\]\s*[（(]\s*([^)）\n]+?)\s*[)）]/g;
        result = result.replace(inlineStickerRegex, (_, keywordRaw) => {
            const keyword = String(keywordRaw || '').trim();
            if (!keyword) return '';

            const mappedEmoji = this.getSystemEmojiByStickerKeyword(keyword);
            const finalEmoji = mappedEmoji || '🙂';
            return `<span class="wechat-inline-sticker-emoji" style="display:inline-flex;align-items:center;vertical-align:text-bottom;">${this.renderTwemojiEmoji(finalEmoji, 18, true)}</span>`;
        });

        // 1️⃣ 替换系统表情
        for (let emoji in emojiMap) {
            result = result.split(emoji).join(emojiMap[emoji]);
        }

        // 2️⃣ 替换自定义表情
        const customEmojis = this.app.wechatData.getCustomEmojis();
        customEmojis.forEach(emoji => {
            const pattern = `[${emoji.name}]`;
            if (result.includes(pattern)) {
                result = result.split(pattern).join(
                    `<img src="${emoji.image}" style="width:16px;height:16px;vertical-align:text-bottom;border-radius:4px;" alt="${emoji.name}" title="${emoji.name}">`
                );
            }
        });

        // 3️⃣ 将 Unicode emoji 统一渲染为 Twemoji 图片（仅替换纯文本，避免破坏已有 HTML 标签）
        result = this.renderTwemojiOutsideHtml(result, 16);

        return result;
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
        const imageSize = Math.max(20, Number(node.dataset.imageSize) || 26);
        node.style.background = 'transparent';
        node.style.padding = '0';
        node.style.minWidth = `${Math.round(imageSize * 0.8)}px`;
        node.style.minHeight = `${Math.round(imageSize * 0.8)}px`;
        node.innerHTML = `<img src="${safeUrl}" alt="${safeKeyword}" title="${safeKeyword}" referrerpolicy="no-referrer" style="width:${imageSize}px;height:${imageSize}px;object-fit:contain;vertical-align:middle;border-radius:4px;">`;
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
        const fallbackSize = Math.max(20, Number(node.dataset.imageSize) || Number(node.dataset.emojiSize) || 26);
        node.style.background = 'transparent';
        node.style.padding = '0';
        node.style.minWidth = `${Math.round(fallbackSize * 0.8)}px`;
        node.style.minHeight = `${Math.round(fallbackSize * 0.8)}px`;
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
        cache[cacheKey] = normalizedUrl || null;
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

    _stripCallSpeechPrefix(text) {
        let normalized = this.cleanAbnormalSpaces(String(text || ''));
        if (!normalized) return '';

        let previous = null;
        while (normalized !== previous) {
            previous = normalized;
            normalized = normalized
                .replace(/^\s*(?:\[\s*(?:语音|视频|语音通话|视频通话|通话)\s*\]|【\s*(?:语音|视频|语音通话|视频通话|通话)\s*】)\s*/i, '')
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
                    : (isMe ? '待对方收款' : '待你收款');
                lines.push(`${prefix}转账 ${amountText}｜发送方：${sender}｜状态：${status}`);
                return;
            }

            const redpacketStatus = String(msg.status || '').trim() === 'opened'
                ? (isMe ? '已被领取' : '你已领取')
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
        const transferMatch = content.match(/\[转账\]\s*(?:\(金额[：:]?\s*(\d+(?:\.\d+)?)\s*元?\s*\)|[¥￥]\s*(\d+(?:\.\d+)?))/);
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
        const redpacketMatch = content.match(/\[红包\]\s*(?:\(金额[：:]?\s*(\d+(?:\.\d+)?)\s*元?\s*\))?/);
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

        const inlineSpecialRegex = /\[转账\]\s*(?:\(金额[：:]?\s*\d+(?:\.\d+)?\s*元?\s*\)|[¥￥]\s*\d+(?:\.\d+)?)|\[红包\]\s*(?:\(金额[：:]?\s*\d+(?:\.\d+)?\s*元?\s*\))?|(?:\[\s*定位\s*\]|【\s*定位\s*】)\s*[（(]\s*[^)）]+?\s*[)）]|(?:\[\s*(?:拨打|发起)\s*(?:微信)?(?:群)?(?:语音|视频)(?:通话)?\s*\]|【\s*(?:拨打|发起)\s*(?:微信)?(?:群)?(?:语音|视频)(?:通话)?\s*】)/g;
        let hasMatch = false;
        let lastIndex = 0;
        let usedQuote = false;
        const result = [];

        let match;
        while ((match = inlineSpecialRegex.exec(rawContent)) !== null) {
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

            const specialRaw = match[0].trim();
            const special = this.parseSpecialMessage(specialRaw);
            if (special) {
                result.push({
                    ...message,
                    content: special.content || specialRaw,
                    specialMessage: special,
                    quote: null
                });
                usedQuote = true;
            }

            lastIndex = match.index + match[0].length;
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
                const messageId = e.currentTarget.dataset.msgId;
                if (messageId) this.openRedPacket(messageId);
            });
        });
        currentView.querySelectorAll('.message-transfer').forEach(tf => {
            tf.addEventListener('click', (e) => {
                const messageId = e.currentTarget.dataset.msgId;
                if (messageId) this.openTransferDetail(messageId);
            });
        });
        currentView.querySelectorAll('.message-weibo-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (Date.now() < (this._suppressWeiboCardClickUntil || 0)) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                const messageId = e.currentTarget.dataset.msgId;
                if (messageId) this.openWeiboCard(messageId);
            });
        });
        currentView.querySelectorAll('.message-image-prompt-generate').forEach(card => {
            card.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const messageId = e.currentTarget.dataset.messageId;
                if (messageId) {
                    await this.generateImagePromptMessage(messageId);
                }
            });
        });
        currentView.querySelectorAll('.message-image-prompt-show-back').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._toggleImagePromptCard(e.currentTarget.closest('.message-image-prompt-box'), true);
            });
        });
        currentView.querySelectorAll('.message-image-prompt-restore').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._toggleImagePromptCard(e.currentTarget.closest('.message-image-prompt-box'), false);
            });
        });

        this.scheduleInlineStickerHydration();
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

    showWeiboCardPreviewModal(weiboData = {}) {
        const esc = (v) => String(v || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        const stripName = (v) => String(v || '').trim().replace(/^@/, '');
        const cleanImageDesc = (raw) => {
            const txt = String(raw || '').trim();
            if (!txt) return '';
            const m = txt.match(/\[图片\]\s*[（(]([^）)]+)[）)]/);
            if (m && m[1]) return m[1].trim();
            return txt.replace(/^\[图片\]\s*/g, '').trim();
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
            .map(cleanImageDesc)
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
                        ${imageLines.map((line, i) => `<div style="font-size:11px; color:#666; line-height:1.5;">${i + 1}. ${esc(line)}</div>`).join('')}
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
        if (!dataUrl || !this.app.currentChat) return;

        try {
            const res = await fetch(dataUrl);
            const blob = await res.blob();
            const ext = blob.type === 'image/png' ? 'png' : 'jpg';
            const filename = `${filenamePrefix}_${Date.now()}.${ext}`;
            const formData = new FormData();
            formData.append('avatar', blob, filename);
            const headers = typeof window.getRequestHeaders === 'function' ? window.getRequestHeaders() : {};
            delete headers['Content-Type'];
            if (!headers['X-CSRF-Token']) {
                const csrfResp = await fetch('/csrf-token');
                if (csrfResp.ok) headers['X-CSRF-Token'] = (await csrfResp.json()).token;
            }
            const uploadResp = await fetch('/api/backgrounds/upload', { method: 'POST', body: formData, headers });
            if (!uploadResp.ok) {
                throw new Error(`上传失败（HTTP ${uploadResp.status}）`);
            }

            const finalUrl = `/backgrounds/${filename}`;
            this.app.wechatData.addMessage(this.app.currentChat.id, {
                from: 'me',
                type: 'image',
                content: finalUrl,
                avatar: this.app.wechatData.getUserInfo().avatar
            });

            this.app.render();

            if (this.isOnlineMode()) {
                this._enqueuePendingChat(this.app.currentChat.id);
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

        // 📱 输入框聚焦：用户正在编辑，立即打断自动回复倒计时
        input?.addEventListener('focus', () => {
            clearTimeout(this.batchTimer);
            this.hideTypingStatus();

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
                    }
                }, 100);
            } else {
                document.body.classList.remove('phone-input-active');
                restartPendingTimerIfNeeded();
            }
        });

        // 📱 输入中：有字就打断等待；删空时若仍在 focus，保持安静等待 blur 再决定
        input?.addEventListener('input', (e) => {
            this.inputText = e.target.value;
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
            this.handleSendClick(input);
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

        // 更多按钮
        query('#more-btn')?.addEventListener('click', () => {
            this.showMore = !this.showMore;
            this.showEmoji = false;
            this.app.render();
        });

        // 🔥 表情按钮
        query('#emoji-btn')?.addEventListener('click', () => {
            this.showEmoji = !this.showEmoji;
            this.showMore = false;
            this.app.render();
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
            // 只有点击空白区域才收起（不是点击消息气泡）
            if (this.showMore || this.showEmoji) {
                this.showMore = false;
                this.showEmoji = false;
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

        // 🔥 新增：表情标签切换
        queryAll('.emoji-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.emojiTab = tab.dataset.tab;
                this.app.render();
            });
        });

        // 🔥 新增：添加自定义表情
        query('#add-custom-emoji')?.addEventListener('click', () => {
            this.showAddCustomEmojiDialog();
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
                const emoji = this.app.wechatData.getCustomEmoji(emojiId);
                if (emoji) {
                    const imageUrl = String(emoji.image || '').trim();
                    if (imageUrl) {
                        this.showEmoji = false;
                        this.app.wechatData.addMessage(this.app.currentChat.id, {
                            from: 'me',
                            type: 'image',
                            content: imageUrl,
                            customEmojiId: emoji.id,
                            customEmojiName: String(emoji.name || '').trim(),
                            customEmojiDescription: String(emoji.description || emoji.name || '').trim(),
                            avatar: this.app.wechatData.getUserInfo().avatar
                        });

                        this.app.render();
                        this._closeEmojiPanelAndRestoreInputCaret();

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

        // 添加头像点击事件
        queryAll('.message-avatar').forEach(avatar => {
            avatar.addEventListener('click', (e) => {
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

        // 🔊 语音气泡点击播放逻辑
        const voiceMessagesDiv = document.getElementById('chat-messages');
        if (voiceMessagesDiv && !voiceMessagesDiv._voiceEventBound) {
            voiceMessagesDiv._voiceEventBound = true;
            voiceMessagesDiv.addEventListener('click', async (e) => {
                const bubble = e.target.closest('.voice-bubble-playable');
                if (!bubble) return;

                const storage = window.VirtualPhone?.storage;
                const provider = storage?.get('phone-tts-provider') || 'minimax_cn';
                const apiKey = storage?.get('phone-tts-key') || '';

                if (!apiKey) {
                    this.app.phoneShell.showNotification('提示', '请先在设置中配置 TTS 的 API Key', '⚠️');
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

                const apiUrl = storage.get('phone-tts-url');
                const model = storage.get('phone-tts-model');
                
                // 🔥 核心修改：动态判定发送者音色
                let finalVoice = this._getGlobalTtsVoice(); // 默认拿全局音色兜底（对自己有效）
                const msgNode = bubble.closest('.chat-message');
                const isMe = msgNode && msgNode.classList.contains('message-right');

                if (!isMe) {
                    // 如果是对方发来的，必须找对方的专属音色
                    let senderName = this.app.currentChat.name;
                    // 如果是群聊，找具体的发送者名字
                    const senderEl = msgNode.querySelector('.message-sender');
                    if (senderEl) senderName = senderEl.innerText;

                    const { voice } = this._resolveWechatBoundVoiceByName(senderName);
                    if (voice) {
                        finalVoice = voice;
                        this._clearMissingBoundVoiceWarn(senderName, { scene: 'chat' });
                    } else {
                        // ❌ 没有绑定音色，强制拦截并弹窗
                        this._notifyMissingBoundVoiceOnce(senderName, { scene: 'chat' });
                        return; // 中止播放
                    }
                }
                const voice = finalVoice;

                try {
                    bubble.style.opacity = '0.5'; // 加载中视觉反馈
                    // 停止之前正在播放的气泡动画
                    if (this.currentPlayingMsgId) {
                        const prevBubble = document.getElementById(this.currentPlayingMsgId);
                        if (prevBubble) prevBubble.classList.remove('voice-playing');
                    }
                    let blobUrl = '';

                    if (provider.startsWith('minimax')) {
                        // MiniMax 原生接口调用 (t2a_v2 返回 hex 编码)
                        const response = await fetch(apiUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                            body: JSON.stringify({
                                model: model || "speech-02-hd",
                                text: textToSpeak,
                                stream: false,
                                voice_setting: { voice_id: voice || "female-shaonv", speed: 1.0, vol: 1.0, pitch: 0 },
                                audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3" }
                            })
                        });
                        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
                        const resData = await response.json();
                        if (resData.base_resp?.status_code !== 0) throw new Error(resData.base_resp?.status_msg || 'MiniMax请求失败');

                        // 将 Hex 转为 Blob
                        const hexAudio = resData.data.audio;
                        const bytes = new Uint8Array(Math.ceil(hexAudio.length / 2));
                        for (let i = 0; i < bytes.length; i++) {
                            bytes[i] = parseInt(hexAudio.substr(i * 2, 2), 16);
                        }
                        const blob = new Blob([bytes], { type: 'audio/mp3' });
                        blobUrl = URL.createObjectURL(blob);

                    } else {
                        // OpenAI 标准接口调用
                        const response = await fetch(apiUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                            body: JSON.stringify({
                                model: model || "tts-1",
                                input: textToSpeak,
                                voice: voice || "alloy"
                            })
                        });
                        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
                        const blob = await response.blob();
                        blobUrl = URL.createObjectURL(blob);
                    }

                    // 播放音频
                    this.audioPlayer.src = blobUrl;
                    this.currentPlayingMsgId = bubble.id;

                    this.audioPlayer.onended = () => {
                        bubble.classList.remove('voice-playing');
                        bubble.style.opacity = '1';
                        URL.revokeObjectURL(blobUrl);
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
        const messagesDiv = document.getElementById('chat-messages');
        if (!messagesDiv) return;
        const longPressBubbleSelector = '.message-text, .message-voice, .message-image-box, .message-redpacket, .message-transfer, .message-location, .message-call-record, .message-call-text, .message-sticker-box, .message-weibo-card';

        // 🔥 性能核武器：确保整个聊天列表只绑定 1 次事件
        // 不再随消息数量增多而造成几何级卡顿！
        if (messagesDiv._longPressEventsBound) return;
        messagesDiv._longPressEventsBound = true;

        let pressTimer;
        let touchStartTarget = null;

        // 📱 移动端长按 (事件委托到父容器)
        messagesDiv.addEventListener('touchstart', (e) => {
            const targetBubble = e.target.closest(longPressBubbleSelector);
            if (!targetBubble) return;

            const msgElement = e.target.closest('.chat-message');
            if (!msgElement) return;

            touchStartTarget = msgElement;

            // 🌟 对图片消息阻止默认行为，防止浏览器弹出保存图片菜单
            if (e.target.closest('.message-image')) {
                e.preventDefault();
            }

            pressTimer = setTimeout(() => {
                const allMessages = document.querySelectorAll('.chat-message');
                const index = Array.from(allMessages).indexOf(msgElement);
                if (index !== -1) {
                    if (targetBubble.closest('.message-weibo-card')) {
                        this._suppressWeiboCardClickUntil = Date.now() + 800;
                    }
                    this.showMessageMenu(index);
                }
            }, 500);
        }, { passive: false });

        // 📱 滑动或松开时取消长按
        messagesDiv.addEventListener('touchend', () => {
            clearTimeout(pressTimer);
            touchStartTarget = null;
        });
        messagesDiv.addEventListener('touchmove', () => {
            clearTimeout(pressTimer);
            touchStartTarget = null;
        });

        // 💻 桌面端右键
        messagesDiv.addEventListener('contextmenu', (e) => {
            const targetBubble = e.target.closest(longPressBubbleSelector);
            if (!targetBubble) return;

            const msgElement = e.target.closest('.chat-message');
            if (!msgElement) return;

            e.preventDefault();
            const allMessages = document.querySelectorAll('.chat-message');
            const index = Array.from(allMessages).indexOf(msgElement);
            if (index !== -1) this.showMessageMenu(index);
        });

        // 💻 桌面端双击
        messagesDiv.addEventListener('dblclick', (e) => {
            const targetBubble = e.target.closest(longPressBubbleSelector);
            if (!targetBubble) return;

            const msgElement = e.target.closest('.chat-message');
            if (!msgElement) return;

            const allMessages = document.querySelectorAll('.chat-message');
            const index = Array.from(allMessages).indexOf(msgElement);
            if (index !== -1) this.showMessageMenu(index);
        });
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

        if (this.isSending && String(this._activeSendingChatId || '') === targetChatId) {
            this.abortSending();
            return;
        }

        const text = input.value.trim();

        // 🔥 组词保护：打开表情面板时，空输入不触发“催更/重试/空提示”逻辑
        // 等用户关闭面板后，再按原有规则检查输入内容
        if (!text && this.showEmoji) {
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
            this.activeQuote = null;  // 🔥 发送后清空引用

            // 🔥 移除引用预览栏
            const quoteBar = document.querySelector('.active-quote-bar');
            if (quoteBar) quoteBar.remove();

            // 🔥 只更新消息列表，不重新渲染整个界面（防止键盘收回）
            const messagesDiv = document.getElementById('chat-messages');
            if (messagesDiv) {
                const messages = this.app.wechatData.getMessages(this.app.currentChat.id);
                const userInfo = this.app.wechatData.getUserInfo();
                this.smartUpdateMessages(messages, userInfo);
            }

            this._enqueuePendingChat(targetChatId, {
                shouldStartTimer: false,
                shouldShowStatus: false
            });
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
                // 还在6秒倒计时内：立刻触发AI（催更）
                this.triggerAI();
            } else {
                // 倒计时已结束，检查是否有历史消息可以重试
                const messages = this.app.wechatData.getMessages(this.app.currentChat.id);
                if (messages.length > 0) {
                    // 有历史消息：强制触发重新请求（用于AI回复失败后重试）
                    this._enqueuePendingChat(targetChatId, {
                        shouldStartTimer: false,
                        shouldShowStatus: true
                    });
                    this.triggerAI(targetChatId);
                } else {
                    // 完全没聊过，输入框又是空的
                    this.app.phoneShell.showNotification('提示', '请先输入内容', '⚠️');
                }
            }
        }
    }

    // 🔥 智能连发：触发AI回复
    async triggerAI(targetChatId = null) {
        if (this._isFlushingPending) return;
        this._isFlushingPending = true;
        clearTimeout(this.batchTimer);

        try {
            if (!this.isOnlineMode()) {
                this.app.phoneShell.showNotification('离线模式', '请在设置中开启在线模式', '⚠️');
                this.hideTypingStatus();  // 🔥 离线模式未发送，清除"等待回复"状态
                return;
            }

            const preferredChatId = String(targetChatId || this.app.currentChat?.id || '').trim();
            const chatIds = this._getPendingChatIdsOrdered(preferredChatId);
            if (chatIds.length === 0) return;

            for (const chatId of chatIds) {
                if (!this.pendingChatIds.has(chatId)) continue;
                if (!this._isPendingChatSendable(chatId)) continue;

                const messages = this.app.wechatData.getMessages(chatId);
                const recentUserMessages = messages.filter(m => m.from === 'me').slice(-5);
                const combinedMessage = recentUserMessages.map(m => m.content).join('\n');
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

    async sendToAI(message, targetChatId = null) {
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

        let success = false;
        const responseBatchId = `wechat_ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
            const aiResponse = await this.sendToAIHidden(null, context, null, this.abortController?.signal, savedChatId);

            // 🔥 检查是否已中断
            if (this.abortController?.signal.aborted) {
                throw new Error('已中断发送');
            }

            // 5️⃣ 解析AI回复（支持多窗口路由分发）
            let parsedMessages = []; // 属于当前打开窗口的消息
            let backgroundMessages = {}; // 属于后台其他窗口的消息 { "窗口名": [消息数组] }
            let backgroundGroupHints = {}; // 后台窗口的群聊提示 { "窗口名": true/false }

            let aiRawText = this._extractWechatTagPayloadOrSelf(aiResponse);
            
            // 🔥 新增：拦截线下联动标签
            let triggerOffline = false;
            if (aiRawText.includes('[转线下]')) {
                triggerOffline = true;
                aiRawText = aiRawText.replace(/\[转线下\]/g, '').trim();
            }

            // 兼容联系人分隔符：---张三--- / ——张三—— / －－张三－－ 等
            aiRawText = aiRawText.replace(
                /^\s*(?:-{3,}|—{2,}|－{2,}|─{2,}|━{2,}|_{3,})\s*(.+?)\s*(?:-{3,}|—{2,}|－{2,}|─{2,}|━{2,}|_{3,})\s*$/gm,
                '---$1---'
            );

            const normalizeWechatWindowName = (name) => String(name || '')
                .trim()
                .replace(/\s+/g, '')
                .toLowerCase();
            const isSameWechatWindowName = (a, b) => {
                const left = normalizeWechatWindowName(a);
                const right = normalizeWechatWindowName(b);
                return !!left && !!right && left === right;
            };

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

                        lines.forEach(line => {
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

                            let quote = null;

                            // 🔥 格式1: 「引用 发送者: 内容」回复 （引用在行首）
                            const quoteMatch = line.match(/^「引用\s+([^:：]+)[:：]\s*([^」]+)」\s*(.*)$/);
                            if (quoteMatch) {
                                quote = { sender: quoteMatch[1].trim(), content: quoteMatch[2].trim() };
                                line = quoteMatch[3].trim();
                            }

                            // 🔥 格式2: 发送者: 「引用 xxx: 内容」回复 （引用在消息内容中）
                            const innerQuoteMatch = line.match(/^([^:：]+)[:：]\s*「引用\s+([^:：]+)[:：]\s*([^」]+)」\s*(.*)$/);
                            if (innerQuoteMatch) {
                                quote = { sender: innerQuoteMatch[2].trim(), content: innerQuoteMatch[3].trim() };
                                const sender = innerQuoteMatch[1].trim();
                                const content = innerQuoteMatch[4].trim();
                                extractedMsgs.push({ sender, content, quote });
                                return; // 已处理，跳过后续匹配
                            }

                            const groupMsgMatch = /^\[([0-9A-Za-z:：]+)\]\s*([^\s:：，。,\.!?！？]{1,20})[：:]\s*(.+)$/.exec(line);
                            const simpleMsgMatch = /^([^:：]+)[：:]\s*(.+)$/.exec(line);

                            if (groupMsgMatch) {
                                extractedMsgs.push({ time: groupMsgMatch[1], sender: groupMsgMatch[2].trim(), content: groupMsgMatch[3].trim(), quote });
                            } else if (simpleMsgMatch && simpleMsgMatch[1].length < 20) {
                                extractedMsgs.push({ sender: simpleMsgMatch[1].trim(), content: simpleMsgMatch[2].trim(), quote });
                            } else if (line) {
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

                    lines.forEach(line => {
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

                        let quote = null;

                        // 🔥 格式1: 「引用 发送者: 内容」回复 （引用在行首）
                        const quoteMatch = line.match(/^「引用\s+([^:：]+)[:：]\s*([^」]+)」\s*(.*)$/);
                        if (quoteMatch) {
                            quote = { sender: quoteMatch[1].trim(), content: quoteMatch[2].trim() };
                            line = quoteMatch[3].trim();
                        }

                        // 🔥 格式2: 发送者: 「引用 xxx: 内容」回复 （引用在消息内容中）
                        const innerQuoteMatch = line.match(/^([^:：]+)[:：]\s*「引用\s+([^:：]+)[:：]\s*([^」]+)」\s*(.*)$/);
                        if (innerQuoteMatch) {
                            quote = { sender: innerQuoteMatch[2].trim(), content: innerQuoteMatch[3].trim() };
                            const sender = innerQuoteMatch[1].trim();
                            const content = innerQuoteMatch[4].trim();
                            parsedMessages.push({ sender, content, quote });
                            return; // 已处理，跳过后续匹配
                        }

                        const groupMsgMatch = /^\[([0-9A-Za-z:：]+)\]\s*([^\s:：，。,\.!?！？]{1,20})[：:]\s*(.+)$/.exec(line);
                        const simpleMsgMatch = /^([^:：]+)[：:]\s*(.+)$/.exec(line);

                        if (isGroupChat && groupMsgMatch) {
                            parsedMessages.push({ time: groupMsgMatch[1], sender: groupMsgMatch[2].trim(), content: groupMsgMatch[3].trim(), quote });
                        } else if (simpleMsgMatch && simpleMsgMatch[1].length < 20) {
                            parsedMessages.push({ sender: simpleMsgMatch[1].trim(), content: simpleMsgMatch[2].trim(), quote });
                        } else if (line) {
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

            // 处理后台窗口消息 (静默存入，红点提示)
            for (const [targetName, msgs] of Object.entries(backgroundMessages)) {
                if (msgs.length === 0) continue;

                const allChats = this.app.wechatData.getChatList();
                const sameNameChats = allChats.filter(c => isSameWechatWindowName(c.name, targetName));
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
                        const existingContact = contacts.find(c => isSameWechatWindowName(c.name, targetName));

                        if (existingContact) {
                            // 联系人存在，查找或创建聊天窗口
                            bgChat = this.app.wechatData.getChatByContactId(existingContact.id);
                            if (!bgChat) {
                                bgChat = allChats.find(c => c.type !== 'group' && isSameWechatWindowName(c.name, targetName));
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
                            bgChat = allChats.find(c => c.type !== 'group' && isSameWechatWindowName(c.name, targetName));

                            if (!bgChat) {
                                // 联系人不存在，先添加联系人再创建聊天
                                const newContactId = `contact_${Date.now()}`;
                                this.app.wechatData.addContact({
                                    id: newContactId,
                                    name: targetName,
                                    avatar: '👤',
                                    letter: this.app.wechatData.getFirstLetter(targetName)
                                });

                                bgChat = this.app.wechatData.createChat({
                                    id: `chat_${newContactId}`,
                                    contactId: newContactId,
                                    name: targetName,
                                    type: 'single',
                                    avatar: '👤'
                                });
                            }
                        }
                    }
                }

                let bgAddedCount = 0;
                let bgLatestPreview = '';
                const isBgGroupChat = bgChat?.type === 'group';
                let senderAvatar = bgChat.avatar || '👤';
                for (let bgIndex = 0; bgIndex < msgs.length; bgIndex++) {
                    const m = msgs[bgIndex];
                    const cleanContent = this.cleanAbnormalSpaces(m.content);
                    const normalizedTextContent = this._stripCallSpeechPrefix(cleanContent);
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

                    this._applyAiReplyTimeline(m, normalizedTextContent, { isFirstInReplyBatch: bgIndex === 0 });

                    const msgData = special
                        ? { from: m.sender, ...special, time: m.time, avatar: senderAvatar, replyBatchId: responseBatchId }
                        : { from: m.sender, content: normalizedTextContent, type: 'text', time: m.time, quote: m.quote, avatar: senderAvatar, replyBatchId: responseBatchId };
                    if (special?.type === 'redpacket') msgData.id = `rp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                    const candidatePreview = String((special?.content || normalizedTextContent || '')).replace(/\s+/g, ' ').trim();
                    if (candidatePreview) {
                        bgLatestPreview = candidatePreview.length > 34 ? `${candidatePreview.slice(0, 34)}...` : candidatePreview;
                    }
                    this.app.wechatData.addMessage(bgChat.id, msgData);
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
                    } else {
                        this.app.phoneShell?.showNotification('新微信消息', `${targetName} 给你发了新消息`, '💬');
                    }
                }
            }

            // 6️⃣ 将AI回复添加到微信界面（使用动态打字延迟）
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
                const normalizedTextContent = this._stripCallSpeechPrefix(cleanContent);
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

                this._applyAiReplyTimeline(msg, normalizedTextContent, { isFirstInReplyBatch: msgIndex === 0 });

                const msgData = special
                    // 🔥 核心修复3：如果是群聊，禁止 fallback 到 savedChatAvatar
                    ? { from: msg.sender, ...special, time: msg.time, avatar: senderContact?.avatar || (isGroupChat ? '' : savedChatAvatar) || '👤', replyBatchId: responseBatchId }
                    : { from: msg.sender, content: normalizedTextContent, time: msg.time, type: 'text', avatar: senderContact?.avatar || (isGroupChat ? '' : savedChatAvatar) || '👤', quote: msg.quote, replyBatchId: responseBatchId };
                if (special?.type === 'redpacket') msgData.id = `rp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                this.app.wechatData.addMessage(savedChatId, msgData);
                if (special?.type === 'weibo_card' && special.weiboData) {
                    this.syncWeiboNewsToWeiboApp(special.weiboData, msg.sender);
                }

                // ⚠️ 重新检查用户现在是否还在这个界面（因为 await 之后状态可能变了）
                const isStillViewing = !!document.querySelector('.phone-view-current .wechat-app') &&
                    this.app.currentChat && this.app.currentChat.id === savedChatId;

                if (isStillViewing) {
                    // 如果还在当前聊天，使用智能防闪烁引擎刷新
                    const messagesDiv = document.getElementById('chat-messages');
                    if (messagesDiv) {
                        const messages = this.app.wechatData.getMessages(this.app.currentChat.id);
                        const userInfo = this.app.wechatData.getUserInfo();
                        this.smartUpdateMessages(messages, userInfo);
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
                        } else {
                            this.app.phoneShell?.showNotification('新微信消息', `${savedChatName} 给你发了新消息`, '💬');
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
                console.error('❌ 发送手机消息失败:', error);
                this.app.phoneShell?.showNotification('发送失败', error.message, '❌');
                
                // 🔥 修复2：发生严重代码报错时，强制把它从连发等待队列里踢出去，彻底杜绝死循环！
                this._dequeuePendingChat(savedChatId);
            }
        } finally {
            // 🔥 无论成功还是失败，都重置状态
            this.isSending = false;
            if (String(this._activeSendingChatId || '') === String(savedChatId || '')) {
                this._activeSendingChatId = null;
            }
            this.abortController = null;
            this._aiReplyRequestStartedAt = 0;
            this._resetAiReplyTimeCursor();
            this.hideTypingStatus();
            // 🔥 只有手机还开着才刷新界面（需要更新发送按钮状态）
            if (this.app.currentChat) {
                // 🔥 只更新发送按钮区域，避免整个界面重绘
                const sendBtn = document.getElementById('send-btn');
                if (sendBtn) {
                    // 🔥 修复：恢复为SVG线条图标
                    sendBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
                    sendBtn.style.color = '#07c160';
                }
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
    async sendToAIHidden(prompt, context, callMode = null, signal = null, targetChatId = null) {
        if (!context) throw new Error('❌ 无法访问 context');

        // 1. 组装手机界面的独特上下文数组 (这里的逻辑不动，完美隔离)
        const messages = await this.buildMessagesArray(prompt, context, callMode, targetChatId);

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
                throw new Error(result.error);
            }

            return result.summary;

        } catch (error) {
            if (error.message === '已中断发送') throw error;
            console.error('❌ [手机聊天] 静默调用失败:', error);
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
            dataUrl = '';
        }

        if (cacheMap) {
            cacheMap.set(raw, dataUrl);
            cacheMap.set(normalizedUrl, dataUrl);
        }
        return dataUrl;
    }

    async buildMessagesArray(prompt, context, callMode = null, targetChatId = null) {
        const messages = [];

        // 🔥🔥🔥 快照绑定：优先使用传入的 targetChatId，防止倒计时期间切换窗口导致串味
        const targetChat = targetChatId
            ? this.app.wechatData.getChatList().find(c => c.id === targetChatId)
            : this.app.currentChat;

        // ========================================
        // 1️⃣ 获取角色名和用户名（参考记忆插件）
        // ========================================
        const userName = context.name1 || '用户';
        let charName = targetChat?.name || context.name2 || '角色';

        // 优先使用 characterId 获取真实角色名
        if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
            charName = context.characters[context.characterId].name || context.name2 || '角色';
        }

        // 🔥🔥🔥 检测是否是群聊
        const isGroupChat = targetChat?.type === 'group';
        const groupName = isGroupChat ? targetChat?.name : '';

        // 🔥 从多个来源获取群成员：1.聊天对象的members 2.历史消息中的发送者
        let groupMembersArray = [];
        if (isGroupChat) {
            // 1. 从聊天对象获取已保存的成员
            if (targetChat?.members && targetChat.members.length > 0) {
                groupMembersArray = [...targetChat.members];
            }

            // 2. 从历史消息中提取发送者（更全面）
            const wechatMessages = this.app.wechatData.getMessages(targetChat.id);
            wechatMessages.forEach(msg => {
                if (msg.from && msg.from !== 'me' && msg.from !== 'system' && !groupMembersArray.includes(msg.from)) {
                    groupMembersArray.push(msg.from);
                }
            });

        }
        const groupMembers = groupMembersArray.join('、');

        // ========================================
        // 2️⃣ 角色信息（从角色卡读取）
        // ========================================
        if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
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


            // 🔥 新增：读取世界书/角色书条目（character_book）
            if (char.data && char.data.character_book && char.data.character_book.entries) {
                const entries = char.data.character_book.entries;
                if (entries.length > 0) {
                    let worldInfo = '【世界书/角色书信息】\n';
                    entries.forEach((entry, idx) => {
                        if (entry.content && entry.enabled !== false) {
                            // 只取前500字符，避免过长
                            const content = entry.content.substring(0, 500);
                            worldInfo += `${content}\n---\n`;
                        }
                    });

                    messages.push({
                        role: 'system',
                        content: worldInfo,
                        name: 'SYSTEM (世界书)',
                        isPhoneMessage: true
                    });

                }
            }
        }

        // ========================================
        // 3️⃣ 用户信息（Persona）
        // ========================================
        // 从 DOM 读取用户 Persona
        const personaTextarea = document.getElementById('persona_description');
        if (personaTextarea && personaTextarea.value && personaTextarea.value.trim()) {
            messages.push({
                role: 'system',
                content: `【用户信息】\n${personaTextarea.value.trim()}`,
                name: 'SYSTEM (用户Persona)',
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
                if (currentContact.sourceApp === 'honey' || currentContact.sourceLabel === '蜜语') {
                    contactNotes.push(`来源应用：蜜语`);
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
        // 4️⃣ 酒馆聊天上下文（使用与记忆插件相同的方式读取）
        // ========================================
        const storage = window.VirtualPhone?.storage;
        const contextLimit = storage ? (parseInt(storage.get('phone-context-limit')) || 10) : 10;

        if (context.chat && Array.isArray(context.chat) && context.chat.length > 0) {
            // 使用 slice 读取最近 N 条消息（参考记忆插件）
            const startIndex = Math.max(0, context.chat.length - contextLimit);
            const endIndex = context.chat.length;
            const chatSlice = context.chat.slice(startIndex, endIndex);


            chatSlice.forEach((msg, idx) => {
                // 跳过系统消息和记忆插件的特殊消息
                if (msg.isGaigaiPrompt || msg.isGaigaiData || msg.isPhoneMessage) return;

                // 🔥 优先使用 msg.mes（酒馆正则处理后的内容），参考记忆插件
                let content = msg.mes || msg.content || '';

                // 标签清洗：记忆插件可用时走记忆插件；否则按手机本地开关回退
                content = applyPhoneTagFilter(content, { storage: this.app?.storage || window.VirtualPhone?.storage });

                // 清理 base64 图片（防止请求体过大）
                content = content.replace(/<img[^>]*src=["']data:image[^"']*["'][^>]*>/gi, '[图片]');
                content = content.replace(/!\[[^\]]*\]\(data:image[^)]*\)/gi, '[图片]');

                // 移除微信标签（完全删除，不留痕迹）
                content = content.replace(/<wechat>[\s\S]*?<\/wechat>/gi, '');
                content = content.replace(/<wechat[^>]*>[\s\S]*?<\/wechat>/gi, '');

                content = content.trim();

                if (content) {
                    const isUser = msg.is_user;
                    const speaker = isUser ? userName : charName;

                    messages.push({
                        role: isUser ? 'user' : 'assistant',
                        content: `${speaker}: ${content}`,
                        isPhoneMessage: true
                    });
                }
            });
        }

        // ========================================
        // 🔌 兼容记忆插件的向量检索锚点
        // 记忆插件会在 Fetch Hijack 时查找此标识，并在其上方插入检索到的向量数据
        // ========================================
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
        // 5️⃣ 跨聊天上下文关联 (群聊带私聊 / 私聊带群聊)
        // 🔥 放在提示词上面，让AI先看到历史记录再看规则
        // ========================================
        const allChats = this.app.wechatData.getChatList();
        const isolateCurrentChatStrictly = true;
        let relatedContextStr = '';

        if (!callMode && !isolateCurrentChatStrictly) {
            if (isGroupChat) {
                // 在群聊中：查找群成员的单聊记录
                const singleChatLimit = parseInt(storage?.get('wechat-single-chat-limit')) || 200;
                const relatedSingleChats = allChats.filter(c => c.type !== 'group' && groupMembersArray.includes(c.name));

                if (relatedSingleChats.length > 0) {
                    relatedContextStr += '【补充上下文：相关私聊记录】\n';
                    relatedContextStr += '说明：以下是部分群成员与用户的最近私聊记录。\n⚠️ 严厉警告：私聊是绝对保密的！其他群成员绝对不知道私聊内容。请在群里发言时严格保持信息隔离，但你可以隐晦地暗示你们的私聊。\n\n';

                    relatedSingleChats.forEach(c => {
                        const msgs = this.app.wechatData.getMessages(c.id).slice(-singleChatLimit);
                        if (msgs.length > 0) {
                            relatedContextStr += `--- 用户与 ${c.name} 的私聊 ---\n`;
                            let lastDate = null;
                            msgs.forEach(m => {
                                // 🔥 添加日期分隔
                                if (m.date && m.date !== lastDate) {
                                    relatedContextStr += `[${m.date}]\n`;
                                    lastDate = m.date;
                                }
                                const speaker = m.from === 'me' ? userName : c.name;
                                let text = this._formatMessageContentForPrompt(m);
                                if (m.quote) text = `「引用 ${m.quote.sender}: ${m.quote.content}」 ${text}`;
                                relatedContextStr += `[${m.time || ''}] ${speaker}: ${text}\n`;
                            });
                            relatedContextStr += '\n';
                        }
                    });
                }
            } else {
                // 在单聊中：查找两人共同参与的群聊记录
                const groupChatLimit = parseInt(storage?.get('wechat-group-chat-limit')) || 200;
                const currentChatName = targetChat?.name || charName;
                const relatedGroupChats = allChats.filter(c => c.type === 'group' && c.members && c.members.includes(currentChatName));

                if (relatedGroupChats.length > 0) {
                    relatedContextStr += '【补充上下文：共同群聊记录】\n';
                    relatedContextStr += `说明：以下是用户与 ${currentChatName} 共同参与的群聊最近记录。你们可以基于群里刚刚发生的事情进行私聊拓展（例如吐槽群里的话题）。\n\n`;

                    relatedGroupChats.forEach(c => {
                        const msgs = this.app.wechatData.getMessages(c.id).slice(-groupChatLimit);
                        if (msgs.length > 0) {
                            relatedContextStr += `--- 群聊：${c.name} ---\n`;
                            let lastDate = null;
                            msgs.forEach(m => {
                                // 🔥 添加日期分隔
                                if (m.date && m.date !== lastDate) {
                                    relatedContextStr += `[${m.date}]\n`;
                                    lastDate = m.date;
                                }
                                const speaker = m.from === 'me' ? userName : (m.from === 'system' ? '系统' : (m.from || '群成员'));
                                let text = this._formatMessageContentForPrompt(m);
                                if (m.quote) text = `「引用 ${m.quote.sender}: ${m.quote.content}」 ${text}`;
                                relatedContextStr += `[${m.time || ''}] ${speaker}: ${text}\n`;
                            });
                            relatedContextStr += '\n';
                        }
                    });
                }
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

        messages.push({
            role: 'system',
            content: '【当前窗口隔离规则】你现在只能看到并回复当前这个微信窗口。绝对禁止提及、猜测、影射、总结、回应任何不属于当前窗口的好友、群聊、未读消息、其他对话内容。即使用户同时和多个人聊天，你也必须把其他窗口当作完全不可见。',
            name: 'SYSTEM (窗口隔离)',
            isPhoneMessage: true
        });

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
        let systemPrompt = '';

        // 🔥 根据模式选择提示词（非通话模式时）
        if (!callMode) {
            try {
                if (isGroupChat && promptManager?.isEnabled?.('wechat', 'groupChat')) {
                    // 群聊模式
                    systemPrompt = promptManager.getPromptForFeature('wechat', 'groupChat') || '';

                    // 🔥 获取好友列表用于私聊窗口名
                    const contacts = this.app.wechatData.getContacts() || [];
                    const contactNames = contacts.map(c => c.name).filter(n => n);
                    const wechatContactsList = contactNames.length > 0 ? contactNames.join('、') : '暂无好友';

                    // 替换群聊相关变量
                    systemPrompt = systemPrompt
                        .replace(/\{\{groupName\}\}/g, groupName)
                        .replace(/\{\{groupMembers\}\}/g, groupMembers)
                        .replace(/\{\{wechatContacts\}\}/g, wechatContactsList)
                        .replace(/\{\{customEmojiList\}\}/g, customEmojiList);
                } else if (promptManager?.isEnabled?.('wechat', 'online')) {
                    // 单聊模式
                    systemPrompt = promptManager.getPromptForFeature('wechat', 'online') || '';
                    // 🔥 替换单聊窗口名变量
                    const chatName = targetChat?.name || charName;
                    systemPrompt = systemPrompt
                        .replace(/\{\{chatName\}\}/g, chatName)
                        .replace(/\{\{customEmojiList\}\}/g, customEmojiList);
                }
            } catch (e) {
                console.warn('⚠️ 获取微信聊天提示词失败:', e);
            }
        }

        if (systemPrompt) {
            messages.push({
                role: 'system',
                content: systemPrompt,
                name: isGroupChat ? 'SYSTEM (👥群聊模式)' : 'SYSTEM (📱手机聊天)',
                isPhoneMessage: true
            });
        }

        // ========================================
        // 6️⃣ 当前微信聊天记录 / 通话记录
        // ========================================
        const wechatMessages = this.app.wechatData.getMessages(targetChat.id);

        // 🔥 根据聊天类型动态读取限制条数（isGroupChat 和 storage 已在上方声明）
        const wechatLimit = isGroupChat
            ? (parseInt(storage?.get('wechat-group-chat-limit')) || 200)
            : (parseInt(storage?.get('wechat-single-chat-limit')) || 200);

        // 🔥 展开 call_record 的 transcript 后按交互条数截取
        // 逆序遍历，展开 call_record 内部行数，直到总交互次数达到 wechatLimit
        let totalLines = 0;
        let startIdx = wechatMessages.length;
        for (let i = wechatMessages.length - 1; i >= 0; i--) {
            const msg = wechatMessages[i];
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
        const recentWechatMessages = wechatMessages.slice(startIdx);
        const aiImageDataCache = new Map();
        const paymentStatusContext = !isGroupChat
            ? this._buildWechatPaymentStatusContext(recentWechatMessages, userName)
            : '';

        const timeManager = window.VirtualPhone?.timeManager;
        const currentTime = timeManager?.getCurrentStoryTime?.()?.time || '21:30';

        // 先统一构建微信聊天历史（文本 + 图片 + 通话记录），通话模式也复用这段上下文
        let wechatTranscript = '';
        if (recentWechatMessages.length > 0) {
            wechatTranscript = '【📱 手机微信已有消息】\n';
            wechatTranscript += `⏰ 当前时间：${currentTime}\n`;
            wechatTranscript += `以下是用户手机里已经存在的消息记录。请严格遵守当前微信模式提示词调用规则，并将其视为已发生且已落地的历史事实。\n`;
            wechatTranscript += `凡与已有消息记录在发送者、语义内容、时间意图上构成重复的输入，不得再次判定为新消息，不得在正文、微信标签或代发格式中二次落地，必须按已有记录后的时间线自然衔接。\n`;
            wechatTranscript += `新消息时间必须在 ${currentTime} 之后。\n\n`;
            wechatTranscript += `━━━ ${targetChat.name} 的聊天记录 ━━━\n`;

            let lastDate = null;

            for (const msg of recentWechatMessages) {
                const isUser = msg.from === 'me';
                let speaker = isUser ? userName : targetChat.name;
                if (!isUser && isGroupChat && msg.from && msg.from !== 'system') {
                    speaker = msg.from;
                }

                if (msg.date && msg.date !== lastDate) {
                    wechatTranscript += `--- ${msg.date} ---\n`;
                    lastDate = msg.date;
                }

                const timeStr = msg.time ? `[${msg.time}] ` : '';
                const quoteStr = msg.quote ? `「引用 ${msg.quote.sender}: ${msg.quote.content}」` : '';

                if (msg.from === 'system' || msg.type === 'system') {
                    wechatTranscript += `${timeStr}[系统] ${msg.content || ''}\n`;
                } else if (msg.type === 'call_record') {
                    const callTypeName = msg.callType === 'video' ? '视频通话' : '语音通话';
                    const statusText = msg.status === 'answered'
                        ? `通话时长 ${msg.duration}`
                        : (msg.status === 'rejected' || msg.status === 'declined')
                            ? '对方已拒绝'
                            : msg.status === 'cancelled'
                                ? '已取消'
                                : '未接听';
                    wechatTranscript += `${timeStr}[${callTypeName} - ${statusText}]\n`;
                    if (msg.transcript && msg.transcript.length > 0) {
                        msg.transcript.forEach(t => {
                            const tSpeaker = t.from === 'me' ? userName : t.from;
                            wechatTranscript += `  [通话记录] ${tSpeaker}: ${t.text}\n`;
                        });
                    }
                } else if (msg.type === 'image') {
                    const resolvedImageData = await this._resolveWechatImageForAi(msg.content, aiImageDataCache);
                    if (resolvedImageData && resolvedImageData.startsWith('data:image')) {
                        const imgId = `__ST_PHONE_IMAGE_${Date.now()}_${Math.random().toString(36).substr(2, 5)}__`;
                        if (!window.VirtualPhone._pendingImages) {
                            window.VirtualPhone._pendingImages = {};
                        }
                        window.VirtualPhone._pendingImages[imgId] = resolvedImageData;
                        wechatTranscript += `${timeStr}${speaker}: ${quoteStr}[发送了图片#${imgId}#]\n`;
                    } else {
                        wechatTranscript += `${timeStr}${speaker}: ${quoteStr}[发送了一张图片]\n`;
                    }
                } else if (msg.type === 'image_prompt') {
                    // 🔥 修复：将 [图片/视频] 标签原样包裹回去
                    const mediaType = msg.mediaType || '图片';
                    const promptText = msg.imagePrompt || msg.content || '';
                    wechatTranscript += `${timeStr}${speaker}: ${quoteStr}[${mediaType}]（${promptText}）\n`;
                } else if (msg.type === 'transfer') {
                    // 🔥 修复：直接将转账状态贴在文字后面
                    const status = String(msg.status || '').trim() === 'received' ? '已收款' : '未收款';
                    wechatTranscript += `${timeStr}${speaker}: ${quoteStr}[转账 ¥${msg.amount}]（状态：${status}）\n`;
                } else if (msg.type === 'redpacket') {
                    // 🔥 修复：直接将红包状态贴在文字后面
                    const status = String(msg.status || '').trim() === 'opened' ? '已领取' : '未领取';
                    wechatTranscript += `${timeStr}${speaker}: ${quoteStr}[红包 ¥${msg.amount}]（状态：${status}）\n`;
                } else if (msg.type === 'location') {
                    const locationText = String(msg.locationText || msg.locationAddress || msg.content || '').trim();
                    wechatTranscript += `${timeStr}${speaker}: ${quoteStr}[定位]（${locationText || '未知位置'}）\n`;
                } else {
                    wechatTranscript += `${timeStr}${speaker}: ${quoteStr}${msg.content || ''}\n`;
                }
            }
            wechatTranscript = wechatTranscript.trim();
        }

        // 🔥 通话模式：将通话规则、当前微信聊天历史、本次通话输入分开注入
        if (callMode) {
            const promptManager = window.VirtualPhone?.promptManager;
            const promptFeature = this._getCallPromptFeature(callMode, targetChat);
            const contacts = this.app.wechatData.getContacts() || [];
            const contactNames = contacts.map(c => c.name).filter(Boolean);
            const wechatContactsList = contactNames.length > 0 ? contactNames.join('、') : '暂无好友';

            let callSystemPrompt = '';
            if (promptManager?.isEnabled?.('wechat', promptFeature)) {
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
        }

        // ========================================
        // 7️⃣ 末尾追加模式强化提示
        // ========================================
        let currentModeName = '微信单聊';
        if (callMode === 'video') currentModeName = isGroupChat ? '微信群视频通话' : '微信视频通话';
        else if (callMode === 'voice') currentModeName = isGroupChat ? '微信群语音通话' : '微信语音通话';
        else if (isGroupChat) currentModeName = '微信群聊';

        let finalUserContent = `现在你处于${currentModeName}的模式，请根据以上所有信息，遵守回复格式，继续微信回复。`;
        if (!callMode) {
            if (isGroupChat) {
                finalUserContent += '\n群聊场景下，通话前后的发言仍需使用“发送者: 内容”格式，且发送者必须是群成员。';
            }
        }

        // 🔥 把所有待发送的图片代币附加到 user 消息末尾（多模态只能在 user 消息中生效）
        if (window.VirtualPhone?._pendingImages) {
            const imgIds = Object.keys(window.VirtualPhone._pendingImages);
            if (imgIds.length > 0) {
                finalUserContent += '\n\n[以下是聊天记录中标注的图片，请结合上方时间线理解图片内容]\n';
                imgIds.forEach(id => {
                    finalUserContent += `${id}\n`;
                });
            }
        }

        messages.push({
            role: 'user',
            content: finalUserContent,
            name: 'USER (系统指令)',
            isPhoneMessage: true
        });

        return messages;
    }

    async handleMoreAction(action) {
        switch (action) {
            case 'emoji':
                // 🔥 打开表情面板
                this.showMore = false;
                this.showEmoji = true;
                this.app.render();
                break;
            case 'photo':
                this.selectPhoto();
                break;
            case 'camera':
                this.takePhoto();
                break;
            case 'screenshot':
                await this.captureAndSendChatSnapshot({ longCapture: false });
                break;
            case 'longshot':
                await this.captureAndSendChatSnapshot({ longCapture: true });
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
                this.showTransferDialog();
                break;
            case 'redpacket':
                this.showRedPacketDialog();
                break;
        }
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
            const currentBalance = this.app.wechatData.getWalletBalance(this.app.currentChat.id);
            if (currentBalance !== null && parseFloat(amount) > currentBalance) {
                this.app.phoneShell.showNotification('余额不足', `你的零钱只剩 ¥${parseFloat(currentBalance).toFixed(2)} 啦`, '❌');
                return;
            }
            // 扣款
            if (currentBalance !== null) {
                this.app.wechatData.updateWalletBalance(-parseFloat(amount), this.app.currentChat.id);
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

            if (file.size > 2 * 1024 * 1024) {
                this.app.phoneShell.showNotification('提示', '图片太大，请选择小于2MB的图片', '⚠️');
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
                const formData = new FormData();
                const imgResp = await fetch(croppedImage);
                const blob = await imgResp.blob();
                const ext = blob.type === 'image/png' ? 'png' : 'jpg';
                const filename = `phone_chat_avatar_${Date.now()}.${ext}`;
                formData.append('avatar', blob, filename);

                const headers = typeof window.getRequestHeaders === 'function' ? window.getRequestHeaders() : {};
                delete headers['Content-Type'];
                if (!headers['X-CSRF-Token']) {
                    const csrfResp = await fetch('/csrf-token');
                    if (csrfResp.ok) headers['X-CSRF-Token'] = (await csrfResp.json()).token;
                }
                const uploadResp = await fetch('/api/backgrounds/upload', { method: 'POST', body: formData, headers });
                if (!uploadResp.ok) {
                    throw new Error(`上传失败（HTTP ${uploadResp.status}）`);
                }
                newAvatar = `/backgrounds/${filename}`;
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
                    const cleanupTask = window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(oldAvatar, { quiet: true });
                    cleanupTask?.catch?.(() => { });
                }
            } else {
                this.app.wechatData.saveData();
            }

            this.app.phoneShell.showNotification('保存成功', '设置已更新', '✅');
            setTimeout(() => this.app.render(), 1000);
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

    hideTypingStatus() {
        this.syncHeaderStatusDot();
    }
    // 🔧 显示聊天设置菜单
    showChatMenu() {
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

                    <!-- 拉黑好友 -->
                    <div style="background: #fff; padding: 15px 20px; margin-bottom: 10px; cursor: pointer;" id="block-contact-btn">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div style="font-size: 16px; color: #ff3b30;">拉黑好友</div>
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

        // 拉黑好友按钮
        document.getElementById('block-contact-btn')?.addEventListener('click', () => {
            this.showBlockConfirm();
        });

        // 🔥 清空聊天记录按钮
        document.getElementById('clear-chat-btn')?.addEventListener('click', () => {
            if (confirm('确定清空与「' + this.app.currentChat.name + '」的所有聊天记录？\n\n此操作不可恢复！')) {
                const chatId = this.app.currentChat.id;

                // 🔥 改用底层封装好的 clearMessages 方法，它内置了清空时间缓存的逻辑
                this.app.wechatData.clearMessages(chatId);

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
            '#ffffff', // 纯白
            this.app._getWechatAssetUrl('backgrounds/bg1.png'),
            this.app._getWechatAssetUrl('backgrounds/bg2.png'),
            this.app._getWechatAssetUrl('backgrounds/bg3.png'),
            this.app._getWechatAssetUrl('backgrounds/bg4.png')
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

                    <!-- 同步到微信主页背景 -->
                    <div style="background: #fff; border-radius: 10px; padding: 20px; margin-bottom: 15px;">
                        <div style="font-size: 14px; color: #999; margin-bottom: 4px;">微信主页背景</div>
                        <div style="font-size: 11px; color: #07c160; margin-bottom: 12px;">
                            当前状态：${listBgActive ? '已设置（微信/通讯录/朋友圈/我）' : '未设置'}
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
                            ">同步四页背景</button>
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
                            ">清除四页背景</button>
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
                this.app.phoneShell.showNotification('提示', '当前没有可同步的聊天背景（四页）', '⚠️');
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

            this.app.phoneShell.showNotification('设置成功', '微信主页四页背景已同步', '✅');
            setTimeout(() => this.app.render(), 320);
        });

        document.getElementById('clear-chatlist-bg')?.addEventListener('click', () => {
            const latestUserInfo = this.app.wechatData.getUserInfo?.() || {};
            const oldListBg = String(latestUserInfo.chatListBackground || '').trim();
            if (!oldListBg) {
                this.app.phoneShell.showNotification('提示', '当前未设置四页背景', 'ℹ️');
                return;
            }

            this.app.wechatData.setChatListBackground(null);
            const keepSet = new Set([
                String(this.app.currentChat?.background || '').trim(),
                String(latestUserInfo.globalChatBackground || '').trim(),
                String(latestUserInfo.momentsBackground || '').trim()
            ].filter(Boolean));
            tryCleanupOldListBg(oldListBg, keepSet);

            this.app.phoneShell.showNotification('已清除', '微信主页四页背景已恢复默认', '✅');
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

                const res = await fetch(croppedImage);
                const blob = await res.blob();
                const ext = blob.type === 'image/png' ? 'png' : 'jpg';
                const filename = `phone_chatbg_${Date.now()}.${ext}`;
                const formData = new FormData();
                formData.append('avatar', blob, filename);
                const headers = typeof window.getRequestHeaders === 'function' ? window.getRequestHeaders() : {};
                delete headers['Content-Type'];
                if (!headers['X-CSRF-Token']) {
                    const csrfResp = await fetch('/csrf-token');
                    if (csrfResp.ok) headers['X-CSRF-Token'] = (await csrfResp.json()).token;
                }
                const uploadResp = await fetch('/api/backgrounds/upload', { method: 'POST', body: formData, headers });
                if (!uploadResp.ok) {
                    throw new Error(`上传失败（HTTP ${uploadResp.status}）`);
                }
                const finalUrl = `/backgrounds/${filename}`;
                const imageManager = window.VirtualPhone?.imageManager;

                // 🔥 提示用户：全局还是局部？
                const isGlobal = confirm("上传成功！\n\n点击【确定】将此图片设为「全局默认背景」\n点击【取消】仅设为「当前聊天背景」");
                if (isGlobal) {
                    const oldGlobalBg = String(this.app.wechatData.getUserInfo?.()?.globalChatBackground || '').trim();
                    this.app.wechatData.setGlobalChatBackground(finalUrl);
                    // 清空当前聊天的独立背景，让它跟随全局
                    this.app.wechatData.setChatBackground(this.app.currentChat.id, null); 
                    if (oldGlobalBg && oldGlobalBg !== finalUrl) {
                        const cleanupTask = imageManager?.deleteManagedBackgroundByPath?.(oldGlobalBg, { quiet: true });
                        cleanupTask?.catch?.(() => { });
                    }
                    this.app.phoneShell.showNotification('设置成功', '全局背景已更新', '✅');
                } else {
                    const oldChatBg = String(this.app.currentChat?.background || '').trim();
                    this.app.wechatData.setChatBackground(this.app.currentChat.id, finalUrl);
                    if (oldChatBg && oldChatBg !== finalUrl) {
                        const cleanupTask = imageManager?.deleteManagedBackgroundByPath?.(oldChatBg, { quiet: true });
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
                    // 清空当前聊天的局部设置，跟随全局
                    this.app.wechatData.setChatBackground(this.app.currentChat.id, null);
                    this.app.phoneShell.showNotification('设置成功', '已设为全局默认背景', '✅');
                    
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

    // 🗑️ 显示消息操作菜单（毛玻璃样式）
    showMessageMenu(messageIndex) {
        const messages = this.app.wechatData.getMessages(this.app.currentChat.id);
        const message = messages[messageIndex];

        // 移除旧菜单
        document.querySelectorAll('.message-action-menu').forEach(menu => menu.remove());

        // 获取消息元素并判断对齐方向
        const messageElement = document.querySelectorAll('.chat-message')[messageIndex];
        if (!messageElement) return;

        const isRight = messageElement.classList.contains('message-right');

        // 找到消息内容区域
        const contentEl = messageElement.querySelector('.message-content');
        if (!contentEl) return;

        // 找到气泡元素（包括图片）
        const bubbleEl = contentEl.querySelector('.message-text, .message-voice, .message-redpacket, .message-image-box, .message-transfer, .message-location, .message-call-record, .message-call-text, .message-sticker-box, .message-weibo-card');
        if (!bubbleEl) return;

        // 设置气泡为相对定位（用于菜单绝对定位的参考）
        bubbleEl.style.position = 'relative';
        // 🔥 核心修复：防止红包、转账的 overflow: hidden 将弹出的菜单裁切掉
        bubbleEl.style.setProperty('overflow', 'visible', 'important');

        // 🔥 根据消息类型决定显示哪些按钮
        const isTextMessage = message.type === 'text' || !message.type;
        const isLocationMessage = message.type === 'location';
        const isImageMessage = message.type === 'image';
        const isVoiceMessage = message.type === 'voice';
        const isSystemMessage = message.type === 'system';
        const hasCallTranscript = message.type === 'call_record'
            && message.status === 'answered'
            && Array.isArray(message.transcript)
            && message.transcript.length > 0;

        // 系统消息不显示菜单
        if (isSystemMessage) return;

        // 构建按钮HTML
        let buttonsHtml = '';

        // 编辑按钮：仅文本消息显示
        if (isTextMessage || isLocationMessage) {
            buttonsHtml += `
                <button class="msg-action-btn" data-action="edit" data-index="${messageIndex}" style="
                    background: transparent;
                    color: #333;
                    border: none;
                    border-right: 0.5px solid rgba(0,0,0,0.08);
                    padding: 4px 8px;
                    font-size: 11px;
                    cursor: pointer;
                ">编辑</button>`;
        }

        // 引用按钮：文本和图片消息显示
        if (isTextMessage || isImageMessage) {
            buttonsHtml += `
                <button class="msg-action-btn" data-action="quote" data-index="${messageIndex}" style="
                    background: transparent;
                    color: #333;
                    border: none;
                    border-right: 0.5px solid rgba(0,0,0,0.08);
                    padding: 4px 8px;
                    font-size: 11px;
                    cursor: pointer;
                ">引用</button>`;
        }

        // 查看按钮：仅已接通且有 transcript 的通话记录显示
        if (hasCallTranscript) {
            buttonsHtml += `
                <button class="msg-action-btn" data-action="view" data-index="${messageIndex}" style="
                    background: transparent;
                    color: #333;
                    border: none;
                    border-right: 0.5px solid rgba(0,0,0,0.08);
                    padding: 4px 8px;
                    font-size: 11px;
                    cursor: pointer;
                ">查看</button>`;
        }

        // 撤回按钮：所有消息类型都显示
        buttonsHtml += `
            <button class="msg-action-btn" data-action="recall" data-index="${messageIndex}" style="
                background: transparent;
                color: #333;
                border: none;
                border-right: 0.5px solid rgba(0,0,0,0.08);
                padding: 4px 8px;
                font-size: 11px;
                cursor: pointer;
            ">撤回</button>`;

        // 删除按钮：所有消息类型都显示
        buttonsHtml += `
            <button class="msg-action-btn" data-action="delete" data-index="${messageIndex}" style="
                background: transparent;
                color: #ff3b30;
                border: none;
                padding: 4px 8px;
                font-size: 11px;
                cursor: pointer;
            ">删除</button>`;

        // 🔥 核心修复：改用标准 DOM 创建方式，杜绝模板字符串中的换行符残留撑大气泡
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
            <div style="
                display: flex;
                background: rgba(255,255,255,0.9);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                border-radius: 4px;
                overflow: hidden;
                box-shadow: 0 1px 4px rgba(0,0,0,0.12);
                white-space: nowrap;
            ">
                ${buttonsHtml}
            </div>
        `;

        // 插入到气泡内部
        bubbleEl.insertBefore(menuEl, bubbleEl.firstChild);

        // 绑定按钮事件
        document.querySelectorAll('.msg-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const index = parseInt(btn.dataset.index);

                // 先移除菜单
                document.querySelectorAll('.message-action-menu').forEach(menu => menu.remove());

                if (action === 'delete') {
                    this.deleteMessage(index);
                } else if (action === 'edit') {
                    this.editMessage(index);
                } else if (action === 'recall') {
                    this.recallMessage(index);
                } else if (action === 'quote') {
                    this.quoteMessage(index);
                } else if (action === 'view') {
                    this.viewCallTranscript(index);
                }
            });
        });

        // 点击其他地方关闭菜单
        setTimeout(() => {
            document.addEventListener('click', function closeMenu() {
                document.querySelectorAll('.message-action-menu').forEach(menu => menu.remove());
                // 🔥 菜单关闭后，恢复原本的 overflow 属性
                if (bubbleEl) bubbleEl.style.removeProperty('overflow');
                document.removeEventListener('click', closeMenu);
            }, { once: true });
        }, 100);
    }

    // 📄 查看通话 transcript（长按菜单 -> 查看）
    viewCallTranscript(messageIndex) {
        const messages = this.app.wechatData.getMessages(this.app.currentChat.id);
        const message = messages[messageIndex];
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
    deleteMessage(messageIndex) {
        // 直接删除，不需要确认（因为已经是长按操作了）
        this.app.wechatData.deleteMessage(this.app.currentChat.id, messageIndex);

        // 🔥 局部刷新：只更新消息列表，不重绘整个界面
        const messagesDiv = document.getElementById('chat-messages');
        if (messagesDiv) {
            const messages = this.app.wechatData.getMessages(this.app.currentChat.id);
            const userInfo = this.app.wechatData.getUserInfo();
            messagesDiv.innerHTML = this.renderMessagesWithDateDividers(messages, userInfo);
            // 🔥 重新绑定长按事件
            this.bindMessageLongPressEvents();
        }

        // 🔥🔥🔥 核心修复：通知手机外壳立即刷新左上角状态栏时间
        if (this.app.phoneShell && typeof this.app.phoneShell.updateStatusBarTime === 'function') {
            this.app.phoneShell.updateStatusBarTime();
        }
    }

    // 🔄 撤回消息
    recallMessage(messageIndex) {
        const messages = this.app.wechatData.getMessages(this.app.currentChat.id);
        const message = messages[messageIndex];
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
        const messagesDiv = document.getElementById('chat-messages');
        if (messagesDiv) {
            const updatedMessages = this.app.wechatData.getMessages(this.app.currentChat.id);
            messagesDiv.innerHTML = this.renderMessagesWithDateDividers(updatedMessages, userInfo);
            // 🔥 重新绑定长按事件
            this.bindMessageLongPressEvents();
        }
    }

    // 💬 引用消息
    quoteMessage(messageIndex) {
        const messages = this.app.wechatData.getMessages(this.app.currentChat.id);
        const message = messages[messageIndex];
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
        this.activeQuote = { sender, content };
        this.app.render();

        // 聚焦输入框
        setTimeout(() => {
            const input = document.querySelector('.chat-input');
            if (input) input.focus();
        }, 100);
    }

    // ✏️ 编辑消息（直接在气泡上编辑）
    editMessage(messageIndex) {
        const messages = this.app.wechatData.getMessages(this.app.currentChat.id);
        const message = messages[messageIndex];

        // 🔥 找到对应的消息气泡
        const messageElements = document.querySelectorAll('.chat-message');
        const messageEl = messageElements[messageIndex];
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
            const messagesDiv = document.getElementById('chat-messages');
            if (messagesDiv) {
                const latestMessages = this.app.wechatData.getMessages(this.app.currentChat.id);
                const userInfo = this.app.wechatData.getUserInfo();
                messagesDiv.innerHTML = this.renderMessagesWithDateDividers(latestMessages, userInfo);
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
                    this._saveCallRecordTranscript(messageIndex, newContent);
                } else {
                    this.app.wechatData.editMessage(this.app.currentChat.id, messageIndex, newContent);
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
                        this._saveCallRecordTranscript(messageIndex, newContent);
                    } else {
                        this.app.wechatData.editMessage(this.app.currentChat.id, messageIndex, newContent);
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
            const messagesDiv = document.getElementById('chat-messages');
            if (messagesDiv) {
                this.smartUpdateMessages(updatedMessages, userInfo);
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

    // 🚫 显示拉黑确认界面
    showBlockConfirm() {
        const html = `
            <div class="wechat-app">
                <div class="wechat-header">
                    <div class="wechat-header-left">
                        <button class="wechat-back-btn" id="back-from-block">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>
                    <div class="wechat-header-title">拉黑好友</div>
                    <div class="wechat-header-right"></div>
                </div>
                
                <div class="wechat-content" style="background: #ededed; padding: 20px;">
                    <div style="background: #fff; border-radius: 12px; padding: 30px; text-align: center;">
                        <i class="fa-solid fa-ban" style="font-size: 48px; color: #ff3b30; margin-bottom: 20px;"></i>
                        <div style="font-size: 18px; font-weight: 600; color: #000; margin-bottom: 10px;">确定要拉黑 ${this.app.currentChat.name} 吗？</div>
                        <div style="font-size: 14px; color: #999; margin-bottom: 30px;">拉黑后将无法收到对方消息</div>
                        
                        <button id="confirm-block" style="
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
                        ">确定拉黑</button>
                        
                        <button id="cancel-block" style="
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

        document.getElementById('back-from-block')?.addEventListener('click', () => {
            this.showChatMenu();
        });

        document.getElementById('cancel-block')?.addEventListener('click', () => {
            this.showChatMenu();
        });

        document.getElementById('confirm-block')?.addEventListener('click', () => {
            this.app.wechatData.blockContact(this.app.currentChat.contactId);
            this.app.phoneShell.showNotification('已拉黑', `${this.app.currentChat.name}已被拉黑`, '✅');
            this.app.currentChat = null;
            this.app.currentView = 'chats';
            setTimeout(() => this.app.render(), 1000);
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
                            border: 1px solid rgba(255,255,255,0.4);
                            border-radius: 18px;
                            background: rgba(255,255,255,0.8);
                            color: #333;
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
                    ? `<div class="call-msg-sender-label" style="font-size:10px; color:rgba(255,255,255,0.86); margin:0 0 4px 2px;">${entry.sender}</div>`
                    : '';
                const aiMsgHtml = `
                    <div class="call-msg-row" style="display: flex; justify-content: flex-start;">
                        <div style="max-width: 75%; display:flex; flex-direction:column; align-items:flex-start;">
                            ${senderLabelHtml}
                            <div class="wechat-call-ai-bubble call-msg-bubble" id="${bubbleId}" data-msg-idx="${chatMessages.length}" data-call-type="video" data-round-id="${roundId}" data-sender="${this._escapeHtml(entry.sender)}" data-text="${this._escapeHtml(entry.text)}" style="max-width: 100%; padding: 8px 12px; background: rgba(255,255,255,0.85); color: #333; border-radius: 12px; font-size: 13px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer; transition: all 0.3s; position: relative;">${entry.text}</div>
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
            return timeManager.getCurrentStoryTime?.() || endTime;
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

            // 🔥 精简的通话提示词 - 只包含必要信息
            const prompt = isGroupCall
                ? `【微信群${callTypeName}通话中】
当前群聊：${contactName}
可发言成员：${groupParticipants.join('、') || '暂无成员'}
${userName}说：${message}

最近通话记录：
${chatHistory.slice(-8).map(h => `${h.from === 'me' ? userName : h.from}: ${h.text}`).join('\n')}

请以群成员的身份继续通话。回复时必须使用“发送者: 内容”格式，且发送者必须来自可发言成员名单。`
                : `【${callTypeName}通话中】
${userName}说：${message}

通话记录：
${chatHistory.slice(-5).map(h => `${h.from === 'me' ? userName : contactName}: ${h.text}`).join('\n')}

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
                            border: 1px solid rgba(0,0,0,0.1);
                            border-radius: 18px;
                            background: rgba(255,255,255,0.8);
                            color: #333;
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
                    ? `<div class="call-msg-sender-label" style="font-size:10px; color:rgba(0,0,0,0.48); margin:0 0 4px 2px;">${entry.sender}</div>`
                    : '';
                const aiMsgHtml = `
                    <div class="call-msg-row" style="display: flex; justify-content: flex-start;">
                        <div style="max-width: 80%; display:flex; flex-direction:column; align-items:flex-start;">
                            ${senderLabelHtml}
                            <div class="wechat-call-ai-bubble call-msg-bubble" id="${bubbleId}" data-msg-idx="${chatMessages.length}" data-call-type="voice" data-round-id="${roundId}" data-sender="${this._escapeHtml(entry.sender)}" data-text="${this._escapeHtml(entry.text)}" style="max-width: 100%; padding: 6px 10px; background: rgba(255,255,255,0.85); color: #333; border-radius: 10px; font-size: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.1); cursor: pointer; transition: all 0.3s; position: relative;">${entry.text}</div>
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
            const currentBalance = this.app.wechatData.getWalletBalance(this.app.currentChat.id);
            if (currentBalance !== null && parseFloat(amount) > currentBalance) {
                this.app.phoneShell.showNotification('余额不足', `你的零钱只剩 ¥${parseFloat(currentBalance).toFixed(2)} 啦`, '❌');
                return;
            }
            // 扣款
            if (currentBalance !== null) {
                this.app.wechatData.updateWalletBalance(-parseFloat(amount), this.app.currentChat.id);
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
                    <div style="font-size: 14px; color: #999; margin-bottom: 15px;">点击选择图片（支持批量）</div>
                    
                    <!-- 预览区 -->
                    <div id="emoji-preview" style="
                        width: 100%;
                        min-height: 120px;
                        border-radius: 12px;
                        border: 2px dashed #ccc;
                        margin: 0 auto 20px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        flex-wrap: wrap;
                        gap: 8px;
                        padding: 10px;
                        box-sizing: border-box;
                        font-size: 15px;
                        color: #999;
                        cursor: pointer;
                        overflow: hidden;
                    ">
                        <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
                            <i class="fa-solid fa-plus" style="font-size:28px;color:#ccc;"></i>
                            <span>点击添加图片</span>
                        </div>
                    </div>

                    <input type="file" id="emoji-image-upload" accept="image/png, image/jpeg, image/gif, image/webp, image/*" multiple style="display: none;">
                    <div id="emoji-select-hint" style="text-align:left; font-size:12px; color:#999; margin-bottom:16px;">每张图片建议小于 1MB，保存时将批量上传。</div>
                    
                    <button id="save-custom-emoji" style="
                        width: 100%;
                        padding: 14px;
                        background: #07c160;
                        color: #fff;
                        border: none;
                        border-radius: 8px;
                        font-size: 16px;
                        font-weight: 500;
                        cursor: pointer;
                    ">保存</button>
                </div>
            </div>
        </div>
    `;

        this.app.phoneShell.setContent(html);
        const currentView = document.querySelector('.phone-view-current') || document;
        const query = (selector) => currentView.querySelector(selector);

        const selectedFiles = [];
        const selectedNameSet = new Set();
        const previewUrls = new Set();
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

        const renderSelectedPreview = () => {
            const preview = query('#emoji-preview');
            const hint = query('#emoji-select-hint');
            if (!preview) return;
            if (selectedFiles.length === 0) {
                preview.innerHTML = `
                    <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
                        <i class="fa-solid fa-plus" style="font-size:28px;color:#ccc;"></i>
                        <span>点击添加图片</span>
                    </div>
                `;
                if (hint) hint.textContent = '每张图片建议小于 1MB，保存时将批量上传。';
                return;
            }

            const thumbs = selectedFiles.map((item, index) => `
                <div style="width:72px; display:flex; flex-direction:column; align-items:center; gap:6px;">
                    <img src="${item.preview}" style="width:54px;height:54px;object-fit:cover;border-radius:8px;border:1px solid #eee;">
                    <input type="text"
                        class="emoji-name-input"
                        data-emoji-index="${index}"
                        value="${this._escapeHtml(String(item.name || ''))}"
                        placeholder="表情描述"
                        maxlength="20"
                        style="width:100%; height:24px; border:1px solid #e5e5e5; border-radius:6px; padding:0 6px; box-sizing:border-box; font-size:11px; color:#333; background:#fafafa; text-align:center;">
                </div>
            `).join('');
            preview.innerHTML = `
                <div style="width:100%;display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-start;">
                    ${thumbs}
                </div>
            `;
            if (hint) hint.textContent = `已选择 ${selectedFiles.length} 张，点击预览区域可继续添加。`;
        };

        const readFileAsDataURL = (file) => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(String(e?.target?.result || ''));
            reader.onerror = () => reject(new Error('读取图片失败'));
            reader.readAsDataURL(file);
        });
        const createPreviewUrl = (file) => {
            const objectUrl = URL.createObjectURL(file);
            previewUrls.add(objectUrl);
            return objectUrl;
        };
        const cleanupPreviewUrls = () => {
            previewUrls.forEach((url) => {
                try {
                    URL.revokeObjectURL(url);
                } catch (err) { }
            });
            previewUrls.clear();
        };

        query('#back-from-add-emoji')?.addEventListener('click', () => {
            cleanupPreviewUrls();
            this.app.render();
        });

        query('#emoji-preview')?.addEventListener('click', (e) => {
            if (e.target?.closest?.('.emoji-name-input')) return;
            query('#emoji-image-upload')?.click();
        });
        query('#emoji-preview')?.addEventListener('input', (e) => {
            const input = e.target?.closest?.('.emoji-name-input');
            if (!input) return;
            const index = Number.parseInt(String(input.dataset.emojiIndex || ''), 10);
            if (!Number.isInteger(index) || !selectedFiles[index]) return;
            selectedFiles[index].name = sanitizeEmojiName(input.value, selectedFiles[index].name || `表情${index + 1}`);
        });

        query('#emoji-image-upload')?.addEventListener('change', async (e) => {
            const files = Array.from(e?.target?.files || []);
            e.target.value = '';
            if (!files.length) return;

            let skipped = 0;
            for (const file of files) {
                if (!file?.type?.startsWith?.('image/')) {
                    skipped += 1;
                    continue;
                }
                if (file.size > 1 * 1024 * 1024) {
                    skipped += 1;
                    continue;
                }
                try {
                    const preview = createPreviewUrl(file);
                    if (!preview) {
                        skipped += 1;
                        continue;
                    }
                    const autoName = buildEmojiName(file?.name, selectedFiles.length + 1);
                    selectedFiles.push({
                        file,
                        preview,
                        autoName,
                        name: autoName
                    });
                } catch (err) {
                    skipped += 1;
                }
            }

            renderSelectedPreview();
            if (skipped > 0) {
                this.app.phoneShell.showNotification('提示', `已跳过 ${skipped} 张不合规图片`, '⚠️');
            }
        });

        query('#save-custom-emoji')?.addEventListener('click', async () => { // 🔥 注意这里加上了 async
            if (selectedFiles.length === 0) {
                this.app.phoneShell.showNotification('提示', '请先选择至少一张图片', '⚠️');
                return;
            }

            this.app.phoneShell.showNotification('处理中', `正在上传 ${selectedFiles.length} 张表情...`, '⏳');
            const saveBtn = query('#save-custom-emoji');
            if (saveBtn) saveBtn.disabled = true;

            let successCount = 0;
            let failCount = 0;
            try {
                for (let i = 0; i < selectedFiles.length; i += 1) {
                    const item = selectedFiles[i];
                    const file = item.file;
                    const autoName = String(item.autoName || '').trim() || `表情${i + 1}`;
                    const emojiDescription = sanitizeEmojiName(item.name, autoName);

                    try {
                        const ext = file.type === 'image/png'
                            ? 'png'
                            : (file.type === 'image/webp' ? 'webp' : (file.type === 'image/gif' ? 'gif' : 'jpg'));
                        const filename = `phone_emoji_${Date.now()}_${i + 1}.${ext}`;
                        const formData = new FormData();
                        formData.append('avatar', file, filename);

                        const headers = typeof window.getRequestHeaders === 'function' ? window.getRequestHeaders() : {};
                        delete headers['Content-Type'];
                        if (!headers['X-CSRF-Token']) {
                            const csrfResp = await fetch('/csrf-token');
                            if (csrfResp.ok) headers['X-CSRF-Token'] = (await csrfResp.json()).token;
                        }
                        const uploadResp = await fetch('/api/backgrounds/upload', { method: 'POST', body: formData, headers });
                        if (!uploadResp.ok) {
                            throw new Error(`上传失败（HTTP ${uploadResp.status}）`);
                        }
                        const finalUrl = `/backgrounds/${filename}`;

                        this.app.wechatData.addCustomEmoji({
                            name: emojiDescription,
                            description: emojiDescription,
                            image: finalUrl
                        });
                        successCount += 1;
                    } catch (err) {
                        failCount += 1;
                        console.warn('表情包上传失败:', err);
                        continue;
                    }
                }

                cleanupPreviewUrls();
                if (successCount > 0) {
                    const suffix = failCount > 0 ? `，失败 ${failCount} 张` : '';
                    this.app.phoneShell.showNotification('添加成功', `已添加 ${successCount} 张表情${suffix}`, '✅');
                } else {
                    this.app.phoneShell.showNotification('上传失败', '表情上传失败，请检查酒馆后台', '❌');
                }
                this.emojiTab = 'custom';
                setTimeout(() => this.app.render(), 300);
            } finally {
                if (saveBtn) saveBtn.disabled = false;
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
        const contact = this.app.wechatData.getContactByName(message.from);

        if (!isMe && !isOpened) {
            const updatedMessage = this.app.wechatData.updateMessageById(chatId, messageId, { status: 'opened' });
            resolvedStatus = String(updatedMessage?.status || 'opened').trim();
            isOpened = resolvedStatus === 'opened';
            // 收红包，加钱
            const rpAmount = parseFloat(message.amount) || 0;
            this.app.wechatData.updateWalletBalance(rpAmount);
            this.app.phoneShell.showNotification('微信红包', `已存入零钱: ¥${rpAmount.toFixed(2)}`, '');
        }

        const senderName = message.from === 'me' ? this.app.wechatData.getUserInfo().name : message.from;
        const av = contact?.avatar || (message.from === 'me' ? this.app.wechatData.getUserInfo().avatar : '👤');
        const avatarHtml = this.app.renderAvatar(av, '👤', senderName);

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
                        <div style="font-size:11px; color:#e6a158;">${isMe ? '红包已发出' : '已存入零钱'}</div>
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
        if (!isMe && resolvedStatus !== 'received') {
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
        const statusTitle = isMe ? '待对方确认收款' : '你已收款，资金已存入零钱';

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
                        <div style="font-size:11px; color:#07c160; margin-bottom:16px;">零钱余额</div>
                    </div>

                    <!-- 时间信息 -->
                    <div style="margin: 0 16px; border-top:1px solid #f0f0f0; padding:10px 0;">
                        <div style="display:flex; justify-content:space-between; font-size:11px; color:#888; margin-bottom:6px;">
                            <span>转账时间</span><span>${timeStr}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; font-size:11px; color:#888;">
                            <span>收款时间</span><span>${timeStr}</span>
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
    showGroupSettings() {
        const chat = this.app.currentChat;
        if (!chat || chat.type !== 'group') return;

        // 🔥 群成员数量 +1，因为用户自己也在群里（但不加入白名单）
        const memberCount = (chat.members?.length || 0) + 1;
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
                    <input type="text" id="group-name-input" value="${chat.name}"
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
                        ${(chat.members || []).map(member => {
            const contact = this.app.wechatData.getContactByName(member);
            const avatar = contact?.avatar || '👤';
            return `
                                <div class="group-member-item" data-member="${member}" style="text-align: center; width: 50px; position: relative;">
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
                                    <div style="font-size: 10px; color: #666; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${member}</div>
                                    <button class="remove-member-btn" data-member="${member}" style="
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

        this.app.phoneShell.setContent(html);

        // 🔥 临时存储
        let newAvatar = null;
        const originalName = chat.name;

        // 返回按钮
        document.getElementById('back-from-group-settings')?.addEventListener('click', () => {
            this.app.render();
        });

        // 点击头像区域
        document.getElementById('group-avatar-preview')?.addEventListener('click', () => {
            document.getElementById('group-avatar-upload').click();
        });

        // 上传头像
        document.getElementById('group-avatar-upload')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                if (file.size > 2 * 1024 * 1024) {
                    this.app.phoneShell.showNotification('提示', '图片太大，请选择小于2MB的图片', '⚠️');
                    return;
                }

                // 本地预览（不写入持久数据）
                const reader = new FileReader();
                reader.onload = (e) => {
                    const preview = document.getElementById('group-avatar-preview');
                    preview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;">`;
                };
                reader.readAsDataURL(file);

                // 上传到服务器
                try {
                    this.app.phoneShell.showNotification('处理中', '正在上传群头像...', '⏳');
                    const formData = new FormData();
                    const ext = file.type === 'image/png' ? 'png' : 'jpg';
                    const filename = `phone_group_${Date.now()}.${ext}`;
                    formData.append('avatar', file, filename);

                    const headers = typeof window.getRequestHeaders === 'function' ? window.getRequestHeaders() : {};
                    delete headers['Content-Type'];
                    if (!headers['X-CSRF-Token']) {
                        const csrfResp = await fetch('/csrf-token');
                        if (csrfResp.ok) headers['X-CSRF-Token'] = (await csrfResp.json()).token;
                    }
                    const uploadResp = await fetch('/api/backgrounds/upload', { method: 'POST', body: formData, headers });
                    if (!uploadResp.ok) {
                        throw new Error(`上传失败（HTTP ${uploadResp.status}）`);
                    }
                    newAvatar = `/backgrounds/${filename}`;
                    this.app.phoneShell.showNotification('成功', '群头像已上传', '✅');
                } catch (err) {
                    console.warn('群头像上传失败:', err);
                    this.app.phoneShell.showNotification('上传失败', err?.message || '群头像上传失败', '❌');
                }
            }
        });

        // 🔥 移除成员按钮
        document.querySelectorAll('.remove-member-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const memberName = btn.dataset.member;

                if (!chat.members || chat.members.length <= 2) {
                    this.app.phoneShell.showNotification('提示', '群聊至少需要2人', '⚠️');
                    return;
                }

                // 从成员列表移除
                chat.members = chat.members.filter(m => m !== memberName);

                // 🔥 同步更新 wechatData 中的聊天数据
                const dataChat = this.app.wechatData.getChat(chat.id);
                if (dataChat) {
                    dataChat.members = chat.members;
                }

                // 添加系统消息
                this.app.wechatData.addMessage(chat.id, {
                    type: 'system',
                    from: 'system',
                    content: `"${memberName}" 被移出了群聊`
                });

                this.app.wechatData.saveData();

                // 刷新页面
                setTimeout(() => this.showGroupSettings(), 300);
            });
        });

        // 🔥 添加成员按钮
        document.getElementById('add-member-btn')?.addEventListener('click', () => {
            this.showAddMemberDialog(chat);
        });

        // 保存按钮
        document.getElementById('save-group-settings')?.addEventListener('click', () => {
            const newName = document.getElementById('group-name-input').value.trim();

            // 🔥 如果群名改变，添加系统消息
            if (newName && newName !== originalName) {
                chat.name = newName;
                this.app.wechatData.addMessage(chat.id, {
                    type: 'system',
                    from: 'system',
                    content: `群名已改为"${newName}"`
                });
            }

            if (newAvatar) {
                const oldAvatar = String(chat.avatar || '').trim();
                chat.avatar = newAvatar;
                if (oldAvatar && oldAvatar !== newAvatar) {
                    const cleanupTask = window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(oldAvatar, { quiet: true });
                    cleanupTask?.catch?.(() => { });
                }
            }

            // 保存数据
            this.app.wechatData.saveData();

            this.app.render();
        });
    }

    // 🔥 添加群成员弹窗
    showAddMemberDialog(chat) {
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
                            <div class="add-member-item" data-name="${contact.name}" style="
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

        this.app.phoneShell.setContent(html);

        // 返回按钮
        document.getElementById('back-from-add-member')?.addEventListener('click', () => {
            this.showGroupSettings();
        });

        const addMemberByName = (rawName) => {
            const memberName = String(rawName || '').trim();
            if (!memberName) return;

            const exists = (chat.members || []).some(m => String(m || '').trim() === memberName);
            if (exists) {
                this.app.phoneShell.showNotification('提示', '该成员已在群里', '⚠️');
                return;
            }

            if (!chat.members) chat.members = [];
            chat.members.push(memberName);

            const dataChat = this.app.wechatData.getChat(chat.id);
            if (dataChat) {
                if (!dataChat.members) dataChat.members = [];
                dataChat.members = chat.members;
            }

            this.app.wechatData.addMessage(chat.id, {
                type: 'system',
                from: 'system',
                content: `"${memberName}" 加入了群聊`
            });

            this.app.wechatData.saveData();
            setTimeout(() => this.showGroupSettings(), 220);
        };

        document.getElementById('manual-member-add-btn')?.addEventListener('click', () => {
            const input = document.getElementById('manual-member-input');
            addMemberByName(input?.value || '');
        });

        document.getElementById('manual-member-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addMemberByName(e.currentTarget.value || '');
            }
        });

        // 点击添加成员
        document.querySelectorAll('.add-member-item').forEach(item => {
            item.addEventListener('click', () => {
                addMemberByName(item.dataset.name);
            });
        });
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
        if (!storage) return;
        const provider = storage.get('phone-tts-provider') || 'minimax_cn';
        const apiKey = storage.get('phone-tts-key') || '';
        const apiUrl = storage.get('phone-tts-url');
        const model = storage.get('phone-tts-model');
        // 🔥 核心修改：拦截通话全局音色，强制要求专属音色
        let finalVoice = this._getGlobalTtsVoice();
        const row = bubble?.closest?.('.call-msg-row');
        const isMe = !!(bubble && !bubble.classList.contains('wechat-call-ai-bubble')) ||
            (row && String(row.style?.justifyContent || '').trim() === 'flex-end');
        
        if (!isMe) {
            // 通话中对方说话，优先使用气泡绑定的发送者，再回退到发送者标签
            const senderName = this._resolveCallBubbleSenderName(bubble);
            if (senderName) {
                const { voice } = this._resolveWechatBoundVoiceByName(senderName);
                if (voice) {
                    finalVoice = voice;
                    this._clearMissingBoundVoiceWarn(senderName, { scene: 'call' });
                } else {
                    // ❌ 未绑定音色，拦截提示并跳过当前语音的生成
                    this._notifyMissingBoundVoiceOnce(senderName, { scene: 'call' });
                    return; 
                }
            }
        }
        const voice = finalVoice;

        if (!apiKey || !apiUrl) return;

        try {
            // 停止上一个
            if (this.currentPlayingCallMsgId) {
                const prevBubble = document.getElementById(this.currentPlayingCallMsgId);
                if (prevBubble) prevBubble.classList.remove('voice-playing');
            }

            let blobUrl = '';
            if (provider.startsWith('minimax')) {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({
                        model: model || 'speech-02-hd', text: text, stream: false,
                        voice_setting: { voice_id: voice || 'female-shaonv', speed: 1.0, vol: 1.0, pitch: 0 },
                        audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3' }
                    })
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const resData = await response.json();
                if (resData.base_resp?.status_code !== 0) throw new Error(resData.base_resp?.status_msg);
                const hexAudio = resData.data.audio;
                const bytes = new Uint8Array(Math.ceil(hexAudio.length / 2));
                for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hexAudio.substr(i * 2, 2), 16);
                blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/mp3' }));
            } else {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({ model: model || 'tts-1', input: text, voice: voice || 'alloy' })
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                blobUrl = URL.createObjectURL(await response.blob());
            }

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
