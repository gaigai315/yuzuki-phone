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
// 通话APP视图层（核心文件）
// ========================================
import { applyPhoneTagFilter } from '../../config/tag-filter.js';
import { readPhoneContextLimit } from '../../config/context-settings.js';
import { PHONE_CONFIG } from '../../config/apps.js';
import { formatWechatChatListTime } from '../wechat/chat-list-time.js';

export class PhoneCallView {
    constructor(app) {
        this.app = app;
        this.currentView = 'main'; // 'main' | 'sms' | 'sms-thread' | 'contacts' | 'dialing' | 'incoming' | 'active' | 'transcript' | 'settings'
        this.callTimer = null;
        this.dialingTimer = null;
        this.callDuration = 0;
        this.chatMessages = [];
        this.currentCaller = '';
        this.audioPlayer = new Audio();
        this.currentPlayingBubble = null;
        this.currentTtsRound = null;
        this._phoneCallTtsCache = new Map();
        this._phoneCallTtsCacheOrder = [];
        this._phoneCallTtsCacheLimit = 24;
        this.returnViewAfterSettings = 'main';
        this.returnViewAfterContacts = 'main';
        this.currentSmsContact = '';
        this.contactSelectionMode = false;
        this.selectedContactIds = new Set();
        this.contactAddPanelOpen = false;
        this.phoneWechatDataLoading = null;
        this.phoneWechatDataLoadAttempted = false;
        this._smsPendingRequests = new Set();
        this._smsPendingBatches = new Map();
        this._smsBatchTimers = new Map();
        this._smsRequestEpochs = new Map();
        this._smsRuntimeGeneration = 0;
        this._activeSmsMenuCleanup = null;
    }

    render() {
        switch (this.currentView) {
            case 'contacts':
                this.renderContacts();
                break;
            case 'sms':
                this.renderSmsList();
                break;
            case 'sms-thread':
                this.renderSmsThread(this.currentSmsContact);
                break;
            case 'dialing':
                this.renderDialingCall(this.currentCaller);
                break;
            case 'incoming':
                this.renderIncomingCall(this.currentCaller);
                break;
            case 'active':
                this.renderActiveCall(this.currentCaller);
                break;
            case 'settings':
                this.renderSettings();
                break;
            case 'transcript':
                // transcript 需要 record 参数，从 main 重新渲染
                this.renderMain();
                break;
            default:
                this.renderMain();
        }
    }

    // ========================================
    // 通话记录首页
    // ========================================
    renderMain() {
        this.currentView = 'main';
        this.contactSelectionMode = false;
        this.selectedContactIds.clear();
        this.contactAddPanelOpen = false;

        // 安全清理历史栈中的通话遗留页面，防止按返回键又回到死去的通话界面
        if (this.app.phoneShell && this.app.phoneShell.viewHistory) {
            this.app.phoneShell.viewHistory = this.app.phoneShell.viewHistory.filter(
                v => v.id !== 'phone-incoming' && v.id !== 'phone-active'
            );
        }

        const history = this.app.phoneCallData.getCallHistory();

        let listHtml = '';
        if (history.length === 0) {
            listHtml = '<div class="phone-call-empty">暂无通话记录</div>';
        } else {
            // 倒序显示
            const reversed = [...history].reverse();
            listHtml = '<div class="phone-call-history-list">';
            reversed.forEach((record, idx) => {
                const isMissed = record.status === 'missed' || record.status === 'rejected' || record.status === 'canceled';
                const missedClass = isMissed ? 'phone-call-missed' : '';
                const icon = isMissed ? '📵' : '📞';
                const statusText = record.status === 'missed' ? '未接' :
                    record.status === 'rejected' ? '已拒绝' :
                    record.status === 'canceled' ? '已取消' : '已接通';
                const durationText = record.status === 'answered' && record.duration > 0
                    ? `${Math.floor(record.duration / 60)}分${record.duration % 60}秒`
                    : statusText;
                const timeText = record.time || '';
                const dateText = record.date || '';
                const clickable = record.status === 'answered' && record.transcript && record.transcript.length > 0;
                const clickClass = clickable ? 'phone-call-history-clickable' : '';

                listHtml += `
                    <div class="phone-call-history-item ${missedClass} ${clickClass}" data-record-idx="${idx}">
                        <div class="phone-call-history-icon">${icon}</div>
                        <div class="phone-call-history-info">
                            <div class="phone-call-history-name">${record.caller || '未知'}</div>
                            <div class="phone-call-history-meta">${dateText} ${timeText}</div>
                        </div>
                        <div class="phone-call-history-duration">${durationText}</div>
                    </div>
                `;
            });
            listHtml += '</div>';
        }

        const shellBg = this._getSystemWallpaperShellBackgroundConfig();

        const html = `
            <div class="${shellBg.appClass}" style="${shellBg.appStyle}">
                ${this._renderPhoneHubHeader('call')}
                ${listHtml}
            </div>
        `;

        this.app.phoneShell.setContent(html, 'phone-main');
        this._bindPhoneHubHeader('call');

        this._bindCallHistoryEvents(history);

        // 点击空白处关闭删除按钮
        document.querySelector('.phone-call-main')?.addEventListener('click', (e) => {
            if (!e.target.closest('.phone-call-history-item')) {
                document.querySelectorAll('.phone-call-delete-btn').forEach(btn => btn.remove());
            }
        });
    }

    _renderPhoneHubHeader(activeMode = 'call') {
        const callActive = activeMode === 'call';
        const smsActive = activeMode === 'sms';
        return `
            <div class="phone-call-main-header phone-call-hub-header">
                <button class="phone-call-settings-btn phone-call-hub-action" id="phone-call-open-contacts" title="联系人" aria-label="联系人">
                    <i class="fa-solid fa-address-book"></i>
                </button>
                <div class="phone-call-main-title">通话</div>
                <button class="phone-call-settings-btn phone-call-hub-action" id="phone-call-open-settings" title="设置" aria-label="设置">
                    <i class="fa-solid fa-gear"></i>
                </button>
            </div>
            <div class="phone-call-mode-switch" role="tablist" aria-label="通话与短信">
                <button class="phone-call-mode-tab ${callActive ? 'is-active' : ''}" id="phone-call-mode-call" role="tab" aria-selected="${callActive}">通话</button>
                <button class="phone-call-mode-tab ${smsActive ? 'is-active' : ''}" id="phone-call-mode-sms" role="tab" aria-selected="${smsActive}">短信</button>
            </div>
        `;
    }

    _bindPhoneHubHeader(activeMode = 'call') {
        const root = document.querySelector('.phone-view-current');
        if (!root) return;

        root.querySelector('#phone-call-open-contacts')?.addEventListener('click', () => {
            this.returnViewAfterContacts = activeMode === 'sms' ? 'sms' : 'main';
            this.renderContacts();
        });
        root.querySelector('#phone-call-open-settings')?.addEventListener('click', () => {
            this.returnViewAfterSettings = activeMode === 'sms' ? 'sms' : 'main';
            this.renderSettings();
        });
        root.querySelector('#phone-call-mode-call')?.addEventListener('click', () => {
            if (activeMode !== 'call') this.renderMain();
        });
        root.querySelector('#phone-call-mode-sms')?.addEventListener('click', () => {
            if (activeMode !== 'sms') this.renderSmsList();
        });
    }

    _getSmsStyleContacts() {
        const conversations = this.app.phoneCallData.getSmsConversations?.();
        if (!Array.isArray(conversations)) return [];

        return conversations.flatMap(conversation => {
            const name = String(conversation?.name || conversation?.contactName || '').trim();
            const messages = Array.isArray(conversation?.messages)
                ? conversation.messages.filter(message => String(message?.text || message?.content || '').trim())
                : [];
            if (!name || messages.length === 0) return [];

            const lastMessage = messages[messages.length - 1];
            return [{
                name,
                id: String(conversation?.id || name),
                preview: String(lastMessage?.text || lastMessage?.content || '').trim(),
                date: String(lastMessage?.date || conversation?.date || ''),
                time: String(lastMessage?.time || conversation?.time || ''),
                updatedAt: Number(lastMessage?.createdAt || conversation?.updatedAt || 0)
            }];
        }).sort((a, b) => b.updatedAt - a.updatedAt);
    }

    // ========================================
    // 短信样式骨架（数据与任务逻辑后续接入）
    // ========================================
    renderSmsList() {
        this.currentView = 'sms';
        this.currentSmsContact = '';
        this.contactSelectionMode = false;
        this.selectedContactIds.clear();
        this.contactAddPanelOpen = false;
        this._ensurePhoneWechatDataLoaded();

        const contacts = this._getSmsStyleContacts();
        const storyTime = window.VirtualPhone?.timeManager?.getCurrentStoryTime?.() || {};
        const listHtml = contacts.length > 0
            ? contacts.map(contact => {
                const meta = formatWechatChatListTime({
                    lastMessage: contact.preview,
                    time: contact.time,
                    date: contact.date
                }, storyTime);
                return `
                    <button class="phone-sms-conversation" type="button" data-sms-contact="${this._escapeAttr(contact.name)}" data-sms-search="${this._escapeAttr(contact.name.toLowerCase())}">
                        <div class="phone-sms-conversation-copy">
                            <div class="phone-sms-conversation-topline">
                                <span class="phone-sms-conversation-name">${this._escapeHtml(contact.name)}</span>
                                <span class="phone-sms-conversation-time">${this._escapeHtml(meta)}</span>
                            </div>
                            <div class="phone-sms-conversation-preview">${this._escapeHtml(contact.preview)}</div>
                        </div>
                        <i class="fa-solid fa-chevron-right phone-sms-conversation-chevron" aria-hidden="true"></i>
                    </button>
                `;
            }).join('')
            : `
                <div class="phone-sms-empty">
                    <div class="phone-sms-empty-icon"><i class="fa-regular fa-message"></i></div>
                    <div class="phone-sms-empty-title">暂无短信</div>
                </div>
            `;
        const shellBg = this._getSystemWallpaperShellBackgroundConfig('phone-sms-main');

        const html = `
            <div class="${shellBg.appClass}" style="${shellBg.appStyle}">
                ${this._renderPhoneHubHeader('sms')}
                <div class="phone-sms-search-wrap">
                    <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                    <input class="phone-sms-search" id="phone-sms-search" type="search" placeholder="搜索短信联系人" autocomplete="off">
                </div>
                <div class="phone-sms-conversation-list" id="phone-sms-conversation-list">
                    ${listHtml}
                </div>
                <button class="phone-sms-compose" id="phone-sms-compose" type="button" title="新短信" aria-label="新短信">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'phone-sms');
        this._bindPhoneHubHeader('sms');

        const root = document.querySelector('.phone-view-current .phone-sms-main');
        if (!root) return;
        const searchInput = root.querySelector('#phone-sms-search');
        const conversationItems = Array.from(root.querySelectorAll('.phone-sms-conversation'));
        searchInput?.addEventListener('input', () => {
            const keyword = String(searchInput.value || '').trim().toLowerCase();
            conversationItems.forEach(item => {
                item.hidden = Boolean(keyword) && !String(item.dataset.smsSearch || '').includes(keyword);
            });
        });
        root.querySelector('#phone-sms-compose')?.addEventListener('click', () => this._openSmsComposer(root));
        conversationItems.forEach(item => {
            item.addEventListener('click', event => {
                if (Number(item.dataset.smsSuppressClickUntil || 0) > Date.now()) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                this.renderSmsThread(item.dataset.smsContact);
            });
        });
        this._bindSmsConversationDeleteEvents(root.querySelector('#phone-sms-conversation-list'));
    }

    renderSmsThread(contactName = '') {
        const safeName = String(contactName || '').trim();
        if (!safeName) {
            this.renderSmsList();
            return;
        }

        this.currentView = 'sms-thread';
        this.currentSmsContact = safeName;
        const conversation = this.app.phoneCallData.getSmsConversationByName?.(safeName);
        const messages = Array.isArray(conversation?.messages)
            ? conversation.messages.filter(message => String(message?.text || message?.content || '').trim())
            : [];
        const messagesHtml = messages.length > 0
            ? messages.map(message => {
                const isOutgoing = message?.direction === 'outgoing' || message?.from === 'me';
                const text = String(message?.text || message?.content || '').trim();
                return `
                    <div class="phone-sms-bubble-row ${isOutgoing ? 'is-outgoing' : 'is-incoming'}" data-sms-message-id="${this._escapeAttr(message?.id || '')}">
                        <div class="phone-sms-bubble-stack">
                            <div class="phone-sms-bubble">${this._escapeHtml(text)}</div>
                            <div class="phone-sms-bubble-time">${this._escapeHtml(message?.time || '')}</div>
                        </div>
                    </div>
                `;
            }).join('')
            : `
                <div class="phone-sms-empty phone-sms-thread-empty">
                    <div class="phone-sms-empty-icon"><i class="fa-regular fa-message"></i></div>
                    <div class="phone-sms-empty-title">暂无短信</div>
                </div>
            `;
        const shellBg = this._getSystemWallpaperShellBackgroundConfig('phone-sms-thread');
        const statusColor = this._getSmsStatusColor(safeName);
        const html = `
            <div class="${shellBg.appClass}" style="${shellBg.appStyle}">
                ${this._renderPhoneHubHeader('sms')}
                <div class="phone-sms-thread-header">
                    <button class="phone-sms-thread-action" id="phone-sms-thread-back" type="button" aria-label="返回短信列表">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div class="phone-sms-thread-contact">
                        <div class="phone-sms-thread-name-line">
                            <div class="phone-sms-thread-name">${this._escapeHtml(safeName)}</div>
                            <span class="phone-call-status-dot phone-dot-${statusColor}" data-sms-status-dot aria-label="发送状态"></span>
                        </div>
                    </div>
                    <button class="phone-sms-thread-action" type="button" aria-label="更多">
                        <i class="fa-solid fa-ellipsis"></i>
                    </button>
                </div>
                <div class="phone-sms-thread-messages" id="phone-sms-thread-messages">
                    ${messagesHtml}
                </div>
                <div class="phone-sms-composer">
                    <button class="phone-sms-composer-action" type="button" aria-label="添加附件" disabled>
                        <i class="fa-solid fa-plus"></i>
                    </button>
                    <input class="phone-sms-composer-input" id="phone-sms-composer-input" type="text" maxlength="1000" autocomplete="off" placeholder="输入短信内容">
                    <button class="phone-sms-send" type="button" aria-label="发送" disabled>
                        <i class="fa-solid fa-paper-plane"></i>
                    </button>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'phone-sms-thread');
        this._bindPhoneHubHeader('sms');
        document.querySelector('.phone-view-current .phone-sms-thread #phone-sms-thread-back')
            ?.addEventListener('click', () => this.renderSmsList());
        const messagesRoot = document.querySelector('.phone-view-current .phone-sms-thread-messages');
        if (messagesRoot) {
            messagesRoot.scrollTop = messagesRoot.scrollHeight;
            this._bindSmsMessageDeleteEvents(messagesRoot, safeName);
        }

        const threadRoot = document.querySelector('.phone-view-current .phone-sms-thread');
        const input = threadRoot?.querySelector('#phone-sms-composer-input');
        const sendButton = threadRoot?.querySelector('.phone-sms-send');
        const refreshSendState = () => {
            if (sendButton) sendButton.disabled = !String(input?.value || '').trim();
        };
        const syncEditingState = () => {
            const hasDraft = Boolean(String(input?.value || '').trim());
            if (hasDraft) {
                this._pauseSmsBatch(safeName);
            } else {
                this._resumeSmsBatch(safeName);
            }
            refreshSendState();
        };
        const sendCurrentMessage = () => {
            const text = String(input?.value || '').trim();
            if (!text) return;
            const result = this._storeOutgoingSms(safeName, text);
            if (!result?.message) return;

            input.value = '';
            refreshSendState();
            this._appendSmsMessageBubble(result.message);
            this._queueSmsReply(safeName, result.message);
            input.focus();
        };

        input?.addEventListener('input', syncEditingState);
        input?.addEventListener('keydown', event => {
            if (event.key !== 'Enter' || event.isComposing) return;
            event.preventDefault();
            sendCurrentMessage();
        });
        sendButton?.addEventListener('click', sendCurrentMessage);
        refreshSendState();
    }

    _openSmsComposer(root) {
        if (!root || root.querySelector('.phone-sms-new-overlay')) return;
        const contactNames = new Set([
            ...this.app.phoneCallData.getContacts().map(contact => String(contact?.name || '').trim()),
            ...this.app.phoneCallData.getSmsConversations().map(conversation => String(conversation?.name || '').trim())
        ].filter(Boolean));
        const sortedContactNames = Array.from(contactNames)
            .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

        const overlay = document.createElement('div');
        overlay.className = 'phone-sms-new-overlay';
        overlay.innerHTML = `
            <section class="phone-sms-new-sheet" role="dialog" aria-modal="true" aria-labelledby="phone-sms-new-title">
                <div class="phone-sms-new-header">
                    <div class="phone-sms-new-title" id="phone-sms-new-title">新建短信</div>
                    <button class="phone-sms-new-close" type="button" aria-label="关闭"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="phone-sms-new-recipient-row">
                    <span>收件人</span>
                    <div class="phone-sms-new-recipient-control">
                        <input class="phone-sms-new-recipient" type="text" maxlength="80" autocomplete="off" placeholder="输入角色名" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="phone-sms-recipient-options">
                        <button class="phone-sms-new-recipient-toggle" type="button" aria-label="展开联系人候选" ${sortedContactNames.length ? '' : 'disabled'}>
                            <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                        </button>
                        <div class="phone-sms-new-recipient-options" id="phone-sms-recipient-options" role="listbox" hidden></div>
                    </div>
                </div>
                <textarea class="phone-sms-new-message" maxlength="1000" placeholder="输入短信内容"></textarea>
                <div class="phone-sms-new-footer">
                    <button class="phone-sms-new-send" type="button" disabled>
                        <span>发送</span><i class="fa-solid fa-paper-plane"></i>
                    </button>
                </div>
            </section>
        `;
        root.appendChild(overlay);

        const recipientInput = overlay.querySelector('.phone-sms-new-recipient');
        const recipientControl = overlay.querySelector('.phone-sms-new-recipient-control');
        const recipientToggle = overlay.querySelector('.phone-sms-new-recipient-toggle');
        const recipientOptions = overlay.querySelector('.phone-sms-new-recipient-options');
        const messageInput = overlay.querySelector('.phone-sms-new-message');
        const sendButton = overlay.querySelector('.phone-sms-new-send');
        let visibleContactNames = [];
        let activeOptionIndex = -1;
        const refreshSendState = () => {
            sendButton.disabled = !String(recipientInput.value || '').trim() || !String(messageInput.value || '').trim();
        };
        const hideRecipientOptions = () => {
            recipientOptions.hidden = true;
            recipientOptions.innerHTML = '';
            visibleContactNames = [];
            activeOptionIndex = -1;
            recipientInput.setAttribute('aria-expanded', 'false');
            recipientInput.removeAttribute('aria-activedescendant');
            recipientToggle?.classList.remove('is-open');
        };
        const setActiveOption = index => {
            if (!visibleContactNames.length) return;
            activeOptionIndex = (index + visibleContactNames.length) % visibleContactNames.length;
            const options = Array.from(recipientOptions.querySelectorAll('.phone-sms-new-recipient-option'));
            options.forEach((option, optionIndex) => option.classList.toggle('is-active', optionIndex === activeOptionIndex));
            const activeOption = options[activeOptionIndex];
            if (activeOption) {
                recipientInput.setAttribute('aria-activedescendant', activeOption.id);
                activeOption.scrollIntoView({ block: 'nearest' });
            }
        };
        const selectRecipient = name => {
            recipientInput.value = String(name || '').trim();
            refreshSendState();
            hideRecipientOptions();
            recipientInput.focus();
        };
        const showRecipientOptions = ({ showAll = false } = {}) => {
            const keyword = showAll ? '' : String(recipientInput.value || '').trim().toLocaleLowerCase('zh-CN');
            visibleContactNames = sortedContactNames.filter(name =>
                !keyword || name.toLocaleLowerCase('zh-CN').includes(keyword)
            );
            activeOptionIndex = -1;
            if (!visibleContactNames.length) {
                hideRecipientOptions();
                return;
            }
            recipientOptions.innerHTML = visibleContactNames.map((name, index) => `
                <button class="phone-sms-new-recipient-option" id="phone-sms-recipient-option-${index}" type="button" role="option" data-recipient-name="${this._escapeAttr(name)}">
                    ${this._escapeHtml(name)}
                </button>
            `).join('');
            recipientOptions.hidden = false;
            recipientInput.setAttribute('aria-expanded', 'true');
            recipientToggle?.classList.add('is-open');
        };
        const close = () => {
            hideRecipientOptions();
            overlay.remove();
        };

        overlay.querySelector('.phone-sms-new-close')?.addEventListener('click', close);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close();
            else if (!recipientControl?.contains(event.target)) hideRecipientOptions();
        });
        [recipientInput, messageInput].forEach(input => {
            input.addEventListener('input', refreshSendState);
            input.addEventListener('touchstart', event => event.stopPropagation(), { passive: true });
            input.addEventListener('touchmove', event => event.stopPropagation(), { passive: true });
            input.addEventListener('touchend', event => event.stopPropagation(), { passive: true });
        });
        recipientInput.addEventListener('focus', () => showRecipientOptions());
        recipientInput.addEventListener('input', () => showRecipientOptions());
        recipientInput.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (recipientOptions.hidden) showRecipientOptions();
                setActiveOption(activeOptionIndex + (event.key === 'ArrowDown' ? 1 : -1));
                return;
            }
            if (event.key === 'Enter' && !recipientOptions.hidden && activeOptionIndex >= 0) {
                event.preventDefault();
                selectRecipient(visibleContactNames[activeOptionIndex]);
                return;
            }
            if (event.key === 'Escape' && !recipientOptions.hidden) {
                event.preventDefault();
                hideRecipientOptions();
            }
        });
        recipientToggle?.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const shouldOpen = recipientOptions.hidden;
            recipientInput.focus();
            if (shouldOpen) showRecipientOptions({ showAll: true });
            else hideRecipientOptions();
        });
        recipientOptions.addEventListener('click', event => {
            const option = event.target.closest('.phone-sms-new-recipient-option');
            if (!option) return;
            event.preventDefault();
            event.stopPropagation();
            selectRecipient(option.dataset.recipientName);
        });
        recipientOptions.addEventListener('touchstart', event => event.stopPropagation(), { passive: true });
        recipientOptions.addEventListener('touchmove', event => event.stopPropagation(), { passive: true });
        recipientOptions.addEventListener('touchend', event => event.stopPropagation(), { passive: true });
        sendButton.addEventListener('click', () => {
            const contactName = String(recipientInput.value || '').trim();
            const text = String(messageInput.value || '').trim();
            if (!contactName || !text) return;

            const timeManager = window.VirtualPhone?.timeManager;
            const now = timeManager?.getCurrentStoryTime?.() || {
                date: new Date().toLocaleDateString('zh-CN'),
                time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
                weekday: ''
            };
            const result = this.app.phoneCallData.addSmsMessage(contactName, text, now);
            if (!result?.conversation) return;
            close();
            this.renderSmsThread(result.conversation.name);
            this._queueSmsReply(result.conversation.name, result.message);
        });

        setTimeout(() => recipientInput?.focus(), 50);
    }

    _normalizeSmsContactName(name = '') {
        return String(name || '').trim().toLocaleLowerCase('zh-CN');
    }

    _storeOutgoingSms(contactName, text) {
        const timeManager = window.VirtualPhone?.timeManager;
        const now = timeManager?.getCurrentStoryTime?.() || {
            date: new Date().toLocaleDateString('zh-CN'),
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
            weekday: ''
        };
        return this.app.phoneCallData.addSmsMessage(contactName, text, now);
    }

    _getSmsStatusColor(contactName = '') {
        const requestKey = this._normalizeSmsContactName(contactName);
        if (!requestKey) return 'green';
        if (this._smsPendingRequests.has(requestKey)) return 'red';
        if ((this._smsPendingBatches.get(requestKey) || []).length > 0) return 'yellow';
        return 'green';
    }

    _setSmsStatusDot(contactName = '') {
        const requestKey = this._normalizeSmsContactName(contactName);
        if (!requestKey || this.currentView !== 'sms-thread'
            || this._normalizeSmsContactName(this.currentSmsContact) !== requestKey) return;
        const dot = document.querySelector('.phone-view-current [data-sms-status-dot]');
        if (!dot) return;
        const color = this._getSmsStatusColor(contactName);
        dot.classList.remove('phone-dot-green', 'phone-dot-yellow', 'phone-dot-red');
        dot.classList.add(`phone-dot-${color}`);
    }

    _clearSmsBatchTimer(contactName = '') {
        const requestKey = this._normalizeSmsContactName(contactName);
        const timer = this._smsBatchTimers.get(requestKey);
        if (timer) clearTimeout(timer);
        this._smsBatchTimers.delete(requestKey);
    }

    _pauseSmsBatch(contactName = '') {
        const requestKey = this._normalizeSmsContactName(contactName);
        if (!requestKey || this._smsPendingRequests.has(requestKey)) return;
        this._clearSmsBatchTimer(requestKey);
        const dot = document.querySelector('.phone-view-current [data-sms-status-dot]');
        if (dot && this._normalizeSmsContactName(this.currentSmsContact) === requestKey) {
            dot.classList.remove('phone-dot-yellow', 'phone-dot-red');
            dot.classList.add('phone-dot-green');
        }
    }

    _resumeSmsBatch(contactName = '') {
        const requestKey = this._normalizeSmsContactName(contactName);
        const pending = this._smsPendingBatches.get(requestKey) || [];
        if (!requestKey || pending.length === 0 || this._smsPendingRequests.has(requestKey)
            || this._smsBatchTimers.has(requestKey)) {
            this._setSmsStatusDot(contactName);
            return;
        }
        const timer = setTimeout(() => this._flushSmsBatch(contactName), 6000);
        this._smsBatchTimers.set(requestKey, timer);
        this._setSmsStatusDot(contactName);
    }

    _queueSmsReply(contactName, outgoingMessage) {
        const safeName = String(contactName || '').trim();
        const requestKey = this._normalizeSmsContactName(safeName);
        if (!requestKey || !outgoingMessage) return;
        const pending = this._smsPendingBatches.get(requestKey) || [];
        pending.push(outgoingMessage);
        this._smsPendingBatches.set(requestKey, pending);
        this._clearSmsBatchTimer(requestKey);
        if (!this._smsPendingRequests.has(requestKey)) {
            const timer = setTimeout(() => this._flushSmsBatch(safeName), 6000);
            this._smsBatchTimers.set(requestKey, timer);
        }
        this._setSmsStatusDot(safeName);
    }

    _flushSmsBatch(contactName = '') {
        const safeName = String(contactName || '').trim();
        const requestKey = this._normalizeSmsContactName(safeName);
        this._clearSmsBatchTimer(requestKey);
        if (!requestKey || this._smsPendingRequests.has(requestKey)) return;
        const pending = this._smsPendingBatches.get(requestKey) || [];
        if (pending.length === 0) {
            this._setSmsStatusDot(safeName);
            return;
        }
        this._smsPendingBatches.delete(requestKey);
        this._requestSmsReply(safeName, pending).catch(error => {
            console.error('❌ 短信回复请求失败:', error);
        });
    }

    _appendSmsMessageBubble(message) {
        const messagesRoot = document.querySelector('.phone-view-current .phone-sms-thread-messages');
        if (!messagesRoot || !message) return;
        messagesRoot.querySelector('.phone-sms-thread-empty')?.remove();
        const isOutgoing = message?.direction === 'outgoing' || message?.from === 'me';
        messagesRoot.insertAdjacentHTML('beforeend', `
            <div class="phone-sms-bubble-row ${isOutgoing ? 'is-outgoing' : 'is-incoming'}" data-sms-message-id="${this._escapeAttr(message?.id || '')}">
                <div class="phone-sms-bubble-stack">
                    <div class="phone-sms-bubble">${this._escapeHtml(message?.text || message?.content || '')}</div>
                    <div class="phone-sms-bubble-time">${this._escapeHtml(message?.time || '')}</div>
                </div>
            </div>
        `);
        messagesRoot.scrollTop = messagesRoot.scrollHeight;
    }

    _removeSmsMessageFromPendingBatch(contactName, messageId) {
        const requestKey = this._normalizeSmsContactName(contactName);
        const safeMessageId = String(messageId || '').trim();
        if (!requestKey || !safeMessageId) return;
        const pending = this._smsPendingBatches.get(requestKey) || [];
        const remaining = pending.filter(message => String(message?.id || '').trim() !== safeMessageId);
        if (remaining.length === pending.length) return;
        this._clearSmsBatchTimer(requestKey);
        if (remaining.length === 0) {
            this._smsPendingBatches.delete(requestKey);
            this._setSmsStatusDot(contactName);
            return;
        }
        this._smsPendingBatches.set(requestKey, remaining);
        this._resumeSmsBatch(contactName);
    }

    _cancelSmsConversationRuntime(contactName) {
        const requestKey = this._normalizeSmsContactName(contactName);
        if (!requestKey) return;
        this._smsRequestEpochs.set(requestKey, (this._smsRequestEpochs.get(requestKey) || 0) + 1);
        this._clearSmsBatchTimer(requestKey);
        this._smsPendingBatches.delete(requestKey);
        this._smsPendingRequests.delete(requestKey);
        document.querySelectorAll('.phone-view-current [data-sms-typing-key]').forEach(element => {
            if (element.dataset.smsTypingKey === requestKey) element.remove();
        });
    }

    _showSmsConversationMenu(conversationItem) {
        const contactName = String(conversationItem?.dataset?.smsContact || '').trim();
        const smsRoot = conversationItem?.closest?.('.phone-sms-main');
        const listRoot = conversationItem?.closest?.('.phone-sms-conversation-list');
        if (!contactName || !smsRoot || !listRoot) return;
        this._closeSmsMessageMenu();

        const menu = document.createElement('div');
        menu.className = 'phone-sms-message-menu phone-sms-conversation-menu';
        menu.innerHTML = `
            <button class="phone-sms-message-delete" type="button" aria-label="删除这个短信会话">
                <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                <span>删除</span>
            </button>
        `;
        smsRoot.appendChild(menu);

        const positionMenu = () => {
            if (!menu.isConnected || !conversationItem.isConnected) return;
            const rootRect = smsRoot.getBoundingClientRect();
            const itemRect = conversationItem.getBoundingClientRect();
            const listRect = listRoot.getBoundingClientRect();
            const menuRect = menu.getBoundingClientRect();
            const edge = 8;
            const gap = 4;
            const left = Math.min(
                Math.max(edge, itemRect.right - rootRect.left - menuRect.width - edge),
                Math.max(edge, rootRect.width - menuRect.width - edge)
            );
            const below = itemRect.bottom - rootRect.top + gap;
            const above = itemRect.top - rootRect.top - menuRect.height - gap;
            const listTop = listRect.top - rootRect.top + gap;
            const listBottom = listRect.bottom - rootRect.top - menuRect.height - gap;
            const top = below <= listBottom
                ? below
                : Math.max(listTop, above);
            menu.style.left = `${Math.round(left)}px`;
            menu.style.top = `${Math.round(top)}px`;
            menu.style.visibility = 'visible';
        };
        positionMenu();
        requestAnimationFrame(positionMenu);

        let deleted = false;
        const cleanup = () => {
            menu.remove();
            document.removeEventListener('click', closeFromOutside);
            document.removeEventListener('touchend', closeFromOutside);
            if (this._activeSmsMenuCleanup === cleanup) this._activeSmsMenuCleanup = null;
        };
        const executeDelete = event => {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            if (deleted) return;
            deleted = true;
            const conversation = this.app.phoneCallData.deleteSmsConversation(contactName);
            if (!conversation) {
                cleanup();
                return;
            }
            this._cancelSmsConversationRuntime(contactName);
            cleanup();
            conversationItem.remove();
            if (!listRoot.querySelector('.phone-sms-conversation')) {
                listRoot.insertAdjacentHTML('beforeend', `
                    <div class="phone-sms-empty">
                        <div class="phone-sms-empty-icon"><i class="fa-regular fa-message"></i></div>
                        <div class="phone-sms-empty-title">暂无短信</div>
                    </div>
                `);
            }
        };
        const openedAt = Date.now();
        const closeFromOutside = event => {
            if (Date.now() - openedAt < 350 || menu.contains(event.target)) return;
            cleanup();
        };
        const deleteButton = menu.querySelector('.phone-sms-message-delete');
        deleteButton?.addEventListener('touchstart', event => event.stopPropagation(), { passive: true });
        deleteButton?.addEventListener('touchend', executeDelete, { passive: false });
        deleteButton?.addEventListener('click', executeDelete);
        this._activeSmsMenuCleanup = cleanup;
        setTimeout(() => {
            if (!menu.isConnected) return;
            document.addEventListener('click', closeFromOutside);
            document.addEventListener('touchend', closeFromOutside);
        }, 0);
    }

    _bindSmsConversationDeleteEvents(listRoot) {
        if (!listRoot || listRoot._smsConversationDeleteEventsBound) return;
        listRoot._smsConversationDeleteEventsBound = true;
        let pressTimer = null;
        let pressedItem = null;
        let startX = 0;
        let startY = 0;
        let longPressTriggered = false;
        const clearPress = () => {
            if (pressTimer) clearTimeout(pressTimer);
            pressTimer = null;
        };

        listRoot.addEventListener('touchstart', event => {
            const item = event.target.closest('.phone-sms-conversation');
            if (!item) return;
            const touch = event.touches?.[0];
            pressedItem = item;
            startX = Number(touch?.clientX || 0);
            startY = Number(touch?.clientY || 0);
            longPressTriggered = false;
            clearPress();
            pressTimer = setTimeout(() => {
                if (!pressedItem?.isConnected) return;
                longPressTriggered = true;
                pressedItem.dataset.smsSuppressClickUntil = String(Date.now() + 800);
                this._showSmsConversationMenu(pressedItem);
            }, 500);
        }, { passive: true });
        listRoot.addEventListener('touchmove', event => {
            if (!pressedItem) return;
            const touch = event.touches?.[0];
            const dx = Math.abs(Number(touch?.clientX || 0) - startX);
            const dy = Math.abs(Number(touch?.clientY || 0) - startY);
            if (dx > 10 || dy > 10) {
                clearPress();
                pressedItem = null;
                longPressTriggered = false;
            }
        }, { passive: true });
        listRoot.addEventListener('touchend', event => {
            clearPress();
            if (longPressTriggered) {
                event.preventDefault();
                event.stopPropagation();
            }
            pressedItem = null;
            longPressTriggered = false;
        }, { passive: false });
        listRoot.addEventListener('touchcancel', () => {
            clearPress();
            pressedItem = null;
            longPressTriggered = false;
        }, { passive: true });
        listRoot.addEventListener('contextmenu', event => {
            const item = event.target.closest('.phone-sms-conversation');
            if (!item) return;
            event.preventDefault();
            this._showSmsConversationMenu(item);
        });
    }

    _closeSmsMessageMenu() {
        if (typeof this._activeSmsMenuCleanup === 'function') {
            this._activeSmsMenuCleanup();
            return;
        }
        document.querySelectorAll('.phone-view-current .phone-sms-message-menu').forEach(menu => menu.remove());
    }

    _showSmsMessageMenu(messageRow, contactName) {
        const messageId = String(messageRow?.dataset?.smsMessageId || '').trim();
        const threadRoot = messageRow?.closest?.('.phone-sms-thread');
        if (!messageId || !threadRoot) return;
        this._closeSmsMessageMenu();

        const menu = document.createElement('div');
        menu.className = 'phone-sms-message-menu';
        menu.innerHTML = `
            <button class="phone-sms-message-delete" type="button" aria-label="删除这条短信">
                <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                <span>删除</span>
            </button>
        `;
        threadRoot.appendChild(menu);

        const positionMenu = () => {
            if (!menu.isConnected || !messageRow.isConnected) return;
            const rootRect = threadRoot.getBoundingClientRect();
            const rowRect = messageRow.getBoundingClientRect();
            const menuRect = menu.getBoundingClientRect();
            const messagesRect = threadRoot.querySelector('.phone-sms-thread-messages')?.getBoundingClientRect();
            const edge = 8;
            const gap = 4;
            const isOutgoing = messageRow.classList.contains('is-outgoing');
            const preferredLeft = isOutgoing
                ? rowRect.right - rootRect.left - menuRect.width
                : rowRect.left - rootRect.left;
            const maxLeft = Math.max(edge, rootRect.width - menuRect.width - edge);
            const left = Math.min(Math.max(edge, preferredLeft), maxLeft);
            const above = rowRect.top - rootRect.top - menuRect.height - gap;
            const below = rowRect.bottom - rootRect.top + gap;
            const minTop = messagesRect
                ? messagesRect.top - rootRect.top + gap
                : edge;
            const maxTop = messagesRect
                ? Math.max(minTop, messagesRect.bottom - rootRect.top - menuRect.height - gap)
                : Math.max(edge, rootRect.height - menuRect.height - edge);
            const top = above >= minTop
                ? Math.min(above, maxTop)
                : Math.min(Math.max(minTop, below), maxTop);
            menu.style.left = `${Math.round(left)}px`;
            menu.style.top = `${Math.round(top)}px`;
            menu.style.visibility = 'visible';
        };
        positionMenu();
        requestAnimationFrame(positionMenu);

        let deleted = false;
        const cleanup = () => {
            menu.remove();
            document.removeEventListener('click', closeFromOutside);
            document.removeEventListener('touchend', closeFromOutside);
            if (this._activeSmsMenuCleanup === cleanup) this._activeSmsMenuCleanup = null;
        };
        const executeDelete = event => {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            if (deleted) return;
            deleted = true;
            const result = this.app.phoneCallData.deleteSmsMessage(contactName, messageId);
            if (!result) {
                cleanup();
                return;
            }
            this._removeSmsMessageFromPendingBatch(contactName, messageId);
            cleanup();
            messageRow.remove();
            const messagesRoot = threadRoot.querySelector('.phone-sms-thread-messages');
            if (messagesRoot && !messagesRoot.querySelector('.phone-sms-bubble-row')) {
                messagesRoot.insertAdjacentHTML('beforeend', `
                    <div class="phone-sms-empty phone-sms-thread-empty">
                        <div class="phone-sms-empty-icon"><i class="fa-regular fa-message"></i></div>
                        <div class="phone-sms-empty-title">暂无短信</div>
                    </div>
                `);
            }
        };
        const openedAt = Date.now();
        const closeFromOutside = event => {
            if (Date.now() - openedAt < 350 || menu.contains(event.target)) return;
            cleanup();
        };
        const deleteButton = menu.querySelector('.phone-sms-message-delete');
        deleteButton?.addEventListener('touchstart', event => event.stopPropagation(), { passive: true });
        deleteButton?.addEventListener('touchend', executeDelete, { passive: false });
        deleteButton?.addEventListener('click', executeDelete);
        this._activeSmsMenuCleanup = cleanup;
        setTimeout(() => {
            if (!menu.isConnected) return;
            document.addEventListener('click', closeFromOutside);
            document.addEventListener('touchend', closeFromOutside);
        }, 0);
    }

    _bindSmsMessageDeleteEvents(messagesRoot, contactName) {
        if (!messagesRoot || messagesRoot._smsDeleteEventsBound) return;
        messagesRoot._smsDeleteEventsBound = true;
        let pressTimer = null;
        let pressedRow = null;
        let startX = 0;
        let startY = 0;
        let longPressTriggered = false;
        const clearPress = () => {
            if (pressTimer) clearTimeout(pressTimer);
            pressTimer = null;
        };

        messagesRoot.addEventListener('touchstart', event => {
            const bubble = event.target.closest('.phone-sms-bubble');
            const row = bubble?.closest('.phone-sms-bubble-row');
            if (!row) return;
            const touch = event.touches?.[0];
            pressedRow = row;
            startX = Number(touch?.clientX || 0);
            startY = Number(touch?.clientY || 0);
            longPressTriggered = false;
            clearPress();
            pressTimer = setTimeout(() => {
                if (!pressedRow?.isConnected) return;
                longPressTriggered = true;
                this._showSmsMessageMenu(pressedRow, contactName);
            }, 500);
        }, { passive: true });
        messagesRoot.addEventListener('touchmove', event => {
            if (!pressedRow) return;
            const touch = event.touches?.[0];
            const dx = Math.abs(Number(touch?.clientX || 0) - startX);
            const dy = Math.abs(Number(touch?.clientY || 0) - startY);
            if (dx > 10 || dy > 10) {
                clearPress();
                pressedRow = null;
                longPressTriggered = false;
            }
        }, { passive: true });
        messagesRoot.addEventListener('touchend', event => {
            clearPress();
            if (longPressTriggered) {
                event.preventDefault();
                event.stopPropagation();
            }
            pressedRow = null;
            longPressTriggered = false;
        }, { passive: false });
        messagesRoot.addEventListener('touchcancel', () => {
            clearPress();
            pressedRow = null;
            longPressTriggered = false;
        }, { passive: true });
        messagesRoot.addEventListener('contextmenu', event => {
            const bubble = event.target.closest('.phone-sms-bubble');
            const row = bubble?.closest('.phone-sms-bubble-row');
            if (!row) return;
            event.preventDefault();
            this._showSmsMessageMenu(row, contactName);
        });
    }

    clearSmsRuntime() {
        this._smsRuntimeGeneration += 1;
        this._smsBatchTimers.forEach(timer => clearTimeout(timer));
        this._smsBatchTimers.clear();
        this._smsPendingBatches.clear();
        this._smsPendingRequests.clear();
        this._smsRequestEpochs.clear();
        this._closeSmsMessageMenu();
        document.querySelectorAll('.phone-view-current [data-sms-typing-key]').forEach(element => element.remove());
    }

    _parseSmsAiResponse(response, fallbackSender = '') {
        const raw = String(response || '').replace(/```(?:\w+)?/g, '').trim();
        if (!raw) return [];

        const taggedBodies = [];
        const tagPattern = /<(?:短信|SMS)>([\s\S]*?)<\/\s*(?:短信|SMS)\s*>/gi;
        let match;
        while ((match = tagPattern.exec(raw)) !== null) {
            taggedBodies.push(match[1]);
        }
        const bodies = taggedBodies.length > 0 ? taggedBodies : [raw];

        return bodies.flatMap(body => String(body || '').split(/^\s*---+\s*$/gm)).flatMap(block => {
            const senderMatch = String(block || '').match(/^\s*\[([^\]\r\n]+)\]\s*$/m);
            const contentMatch = String(block || '').match(/内容\s*[：:]\s*([\s\S]*?)(?=\r?\n\s*发送时间\s*[：:]|$)/i);
            if (!senderMatch || !contentMatch) return [];

            const parsedSender = String(senderMatch[1] || '').trim();
            const sender = /^(?:发件方姓名|姓名)$/i.test(parsedSender)
                ? String(fallbackSender || '').trim()
                : parsedSender;
            const text = String(contentMatch[1] || '').trim();
            const timeMatch = String(block || '').match(/发送时间\s*[：:]\s*([0-2]?\d:[0-5]\d)/i);
            if (!sender || !text) return [];
            return [{ sender, text, time: String(timeMatch?.[1] || '').trim() }];
        });
    }

    async _requestSmsReply(recipientName, outgoingMessages) {
        const safeRecipient = String(recipientName || '').trim();
        const requestKey = this._normalizeSmsContactName(safeRecipient);
        if (!requestKey || this._smsPendingRequests.has(requestKey)) return;
        const runtimeGeneration = this._smsRuntimeGeneration;
        const requestEpoch = this._smsRequestEpochs.get(requestKey) || 0;
        this._smsPendingRequests.add(requestKey);
        this._setSmsStatusDot(safeRecipient);

        const batchMessages = (Array.isArray(outgoingMessages) ? outgoingMessages : [outgoingMessages])
            .filter(message => String(message?.text || '').trim());
        const outgoingText = batchMessages.map(message => String(message.text || '').trim()).join('\n');
        if (!outgoingText) {
            this._smsPendingRequests.delete(requestKey);
            this._setSmsStatusDot(safeRecipient);
            return;
        }

        const activeMessages = document.querySelector('.phone-view-current .phone-sms-thread-messages');
        if (activeMessages && this.currentView === 'sms-thread'
            && this._normalizeSmsContactName(this.currentSmsContact) === requestKey) {
            activeMessages.insertAdjacentHTML('beforeend', `
                <div class="phone-sms-typing" data-sms-typing-key="${this._escapeAttr(requestKey)}">
                    <span></span><span></span><span></span>
                </div>
            `);
            activeMessages.scrollTop = activeMessages.scrollHeight;
        }

        try {
            const conversation = this.app.phoneCallData.getSmsConversationByName(safeRecipient);
            const replies = await this.sendSmsMessageToAI(
                outgoingText,
                safeRecipient,
                Array.isArray(conversation?.messages) ? conversation.messages : []
            );
            if (runtimeGeneration !== this._smsRuntimeGeneration
                || requestEpoch !== (this._smsRequestEpochs.get(requestKey) || 0)) return;
            if (!Array.isArray(replies) || replies.length === 0) {
                this.app.phoneShell.showNotification('短信已发出', '暂未收到回复', '💬');
                return;
            }

            const timeManager = window.VirtualPhone?.timeManager;
            const now = timeManager?.getCurrentStoryTime?.() || {
                date: new Date().toLocaleDateString('zh-CN'),
                time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
                weekday: ''
            };
            const batchId = `phone_sms_batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const storedReplies = replies.map(reply => this.app.phoneCallData.addIncomingSmsMessage(reply.sender, reply.text, {
                ...now,
                time: reply.time || now.time
            }, { batchId })).filter(Boolean);

            if (document.querySelector('.phone-view-current .phone-sms-new-overlay')) {
                this.app.phoneShell.showNotification('收到新短信', replies[0].sender, '💬');
                return;
            }
            if (this.currentView === 'sms') {
                this.renderSmsList();
                return;
            }
            if (this.currentView === 'sms-thread') {
                const visibleContactKey = this._normalizeSmsContactName(this.currentSmsContact);
                storedReplies.forEach(result => {
                    if (this._normalizeSmsContactName(result?.conversation?.name) === visibleContactKey) {
                        this._appendSmsMessageBubble(result.message);
                    }
                });
            }
        } catch (error) {
            if (runtimeGeneration !== this._smsRuntimeGeneration
                || requestEpoch !== (this._smsRequestEpochs.get(requestKey) || 0)) return;
            console.error('❌ 短信AI请求失败:', error);
            this.app.phoneShell.showNotification('短信已发出', '回复请求失败', '⚠️');
        } finally {
            if (runtimeGeneration === this._smsRuntimeGeneration
                && requestEpoch === (this._smsRequestEpochs.get(requestKey) || 0)) {
                this._smsPendingRequests.delete(requestKey);
                document.querySelectorAll('.phone-view-current [data-sms-typing-key]').forEach(element => {
                    if (element.dataset.smsTypingKey === requestKey) element.remove();
                });
                const pending = this._smsPendingBatches.get(requestKey) || [];
                if (pending.length > 0) {
                    this._resumeSmsBatch(safeRecipient);
                } else {
                    this._setSmsStatusDot(safeRecipient);
                }
            }
        }
    }

    async sendSmsMessageToAI(message, recipientName, smsMessages = []) {
        const context = window.SillyTavern?.getContext?.();
        if (!context) return [];

        const userName = context.name1 || '用户';
        const smsRoleName = String(recipientName || '').trim() || '对方';
        let contextCharacterName = smsRoleName;
        if (context.characterId !== undefined && context.characters?.[context.characterId]) {
            contextCharacterName = context.characters[context.characterId].name || smsRoleName;
        }

        const storage = window.VirtualPhone?.storage || this.app?.storage;
        const messages = [];
        const char = context.characterId !== undefined ? context.characters?.[context.characterId] : null;
        if (char) {
            let charInfo = `【角色信息】\n角色卡主体: ${char.name || contextCharacterName}\n当前短信收件角色: ${smsRoleName}\n`;
            if (char.description) charInfo += `描述: ${char.description}\n`;
            if (char.personality) charInfo += `性格: ${char.personality}\n`;
            if (char.scenario) charInfo += `场景/背景: ${char.scenario}\n`;
            if (char.data?.system_prompt) charInfo += `\n${char.data.system_prompt}\n`;
            messages.push({ role: 'system', content: charInfo, isPhoneMessage: true });

            const entries = char.data?.character_book?.entries;
            if (Array.isArray(entries)) {
                entries.forEach(entry => {
                    if (entry?.content && entry.enabled !== false) {
                        messages.push({ role: 'system', content: String(entry.content).trim(), isPhoneMessage: true });
                    }
                });
            }
        }

        const persona = document.getElementById('persona_description')?.value?.trim();
        if (persona) {
            messages.push({ role: 'system', content: `【用户信息】\n${persona}`, isPhoneMessage: true });
        }

        const contextLimit = readPhoneContextLimit(storage);
        if (Array.isArray(context.chat)) {
            const collected = [];
            for (let index = context.chat.length - 1; index >= 0 && collected.length < contextLimit; index--) {
                const item = context.chat[index];
                if (!item || item.isGaigaiPrompt || item.isGaigaiData || item.isPhoneMessage) continue;
                let content = applyPhoneTagFilter(item.mes || item.content || '', { storage });
                content = content
                    .replace(/<img[^>]*src=["']data:image[^"']*["'][^>]*>/gi, '[图片]')
                    .replace(/!\[[^\]]*\]\(data:image[^)]*\)/gi, '[图片]')
                    .replace(/<Phone>[\s\S]*?<\/Phone>/gi, '')
                    .replace(/<Call>[\s\S]*?<\/Call>/gi, '')
                    .replace(/<短信>[\s\S]*?<\/\s*短信\s*>/gi, '')
                    .trim();
                if (!content) continue;
                const isUser = item.is_user || item.role === 'user';
                collected.unshift({
                    role: isUser ? 'user' : 'assistant',
                    content: `${isUser ? userName : smsRoleName}: ${content}`,
                    isPhoneMessage: true
                });
            }
            messages.push(...collected);
        }

        messages.push({
            role: 'system',
            content: '[Start a new chat]',
            name: 'SYSTEM (分界线)',
            isPhoneMessage: true
        });

        const wechatHistoryContext = await this._buildWechatHistoryContextForCall(smsRoleName, userName);
        if (wechatHistoryContext) {
            messages.push({
                role: 'system',
                content: wechatHistoryContext,
                name: 'SYSTEM (微信单聊记录)',
                isPhoneMessage: true
            });
        }

        const pm = this._getPromptManager();
        const smsPrompt = pm?.getPromptForFeature('phone', 'sms') || '';
        if (smsPrompt) {
            const processedPrompt = smsPrompt
                .replace(/\{\{char\}\}/gi, smsRoleName)
                .replace(/\{\{callerName\}\}/gi, smsRoleName)
                .replace(/\{\{caller\}\}/gi, smsRoleName)
                .replace(/\{\{roleName\}\}/gi, smsRoleName)
                .replace(/\{\{recipientName\}\}/gi, smsRoleName)
                .replace(/\{\{user\}\}/gi, userName);
            messages.push({ role: 'system', content: processedPrompt, isPhoneMessage: true });
        }

        const smsLimit = Math.max(1, Number.parseInt(storage?.get?.('phone-sms-limit'), 10) || 20);
        const recentSms = smsMessages.slice(-smsLimit);
        if (recentSms.length > 0) {
            let historyText = `【💬 与 ${smsRoleName} 的短信记录】\n`;
            recentSms.forEach(item => {
                const sender = item?.direction === 'outgoing' || item?.from === 'me'
                    ? userName
                    : String(item?.from || smsRoleName);
                const time = item?.time ? `[${item.time}] ` : '';
                historyText += `${time}${sender}: ${String(item?.text || item?.content || '').trim()}\n`;
            });
            messages.push({ role: 'system', content: historyText.trim(), isPhoneMessage: true });
        }

        messages.push({
            role: 'user',
            content: `${userName}刚刚向${smsRoleName}发送短信：\n${String(message || '').trim()}\n\n请严格按短信提示词格式生成回复。`,
            isPhoneMessage: true
        });

        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager) throw new Error('API Manager 未初始化');
        const resolvedMaxTokens = Number.parseInt(context?.max_response_length, 10)
            || Number.parseInt(context?.max_length, 10)
            || Number.parseInt(context?.amount_gen, 10);
        const options = { preserve_roles: true, appId: 'phone_sms' };
        if (Number.isFinite(resolvedMaxTokens) && resolvedMaxTokens > 0) {
            options.max_tokens = resolvedMaxTokens;
        }
        const result = await apiManager.callAI(messages, options);
        if (!result.success) throw new Error(result.error || '短信AI返回为空');

        const rawReply = String(result.summary || result.content || result.text || '').trim();
        return this._parseSmsAiResponse(rawReply, smsRoleName);
    }

    _bindCallHistoryEvents(history) {
        const reversedHistory = [...history].reverse();
        document.querySelectorAll('.phone-call-history-item').forEach(item => {
            const idx = parseInt(item.dataset.recordIdx, 10);
            const record = reversedHistory[idx];
            if (!record) return;

            let pressTimer = null;
            let longPressFired = false;
            let startX = 0;
            let startY = 0;
            let suppressClickUntil = 0;

            const clearPress = () => {
                if (pressTimer) {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                }
            };

            const startPress = (x, y) => {
                startX = x;
                startY = y;
                longPressFired = false;
                clearPress();
                pressTimer = setTimeout(() => {
                    pressTimer = null;
                    longPressFired = true;
                    suppressClickUntil = Date.now() + 450;
                    this._showCallRecordDeleteButton(item, record);
                }, 520);
            };

            const movePress = (x, y) => {
                if (!pressTimer) return;
                const dx = Math.abs(x - startX);
                const dy = Math.abs(y - startY);
                if (dx > 18 || dy > 18) {
                    clearPress();
                }
            };

            const endPress = () => {
                clearPress();
                if (longPressFired) {
                    suppressClickUntil = Date.now() + 450;
                    longPressFired = false;
                }
            };

            if (record.status === 'answered' && record.transcript && record.transcript.length > 0) {
                item.addEventListener('click', (e) => {
                    if (Date.now() < suppressClickUntil || item.querySelector('.phone-call-delete-btn')) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                    this.renderTranscript(record);
                });
            }

            item.addEventListener('touchstart', (e) => {
                if (!e.touches || e.touches.length === 0) return;
                const t = e.touches[0];
                startPress(t.clientX, t.clientY);
            }, { passive: true });

            item.addEventListener('touchmove', (e) => {
                if (!e.touches || e.touches.length === 0) return;
                const t = e.touches[0];
                movePress(t.clientX, t.clientY);
            }, { passive: true });

            item.addEventListener('touchend', endPress);
            item.addEventListener('touchcancel', () => {
                clearPress();
                longPressFired = false;
            });

            item.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                startPress(e.clientX, e.clientY);
            });
            item.addEventListener('mousemove', (e) => movePress(e.clientX, e.clientY));
            item.addEventListener('mouseup', endPress);
            item.addEventListener('mouseleave', () => {
                clearPress();
                longPressFired = false;
            });
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                suppressClickUntil = Date.now() + 450;
                this._showCallRecordDeleteButton(item, record);
            });
        });
    }

    _showCallRecordDeleteButton(item, record) {
        document.querySelectorAll('.phone-call-delete-btn').forEach(btn => btn.remove());
        if (!item || !record) return;

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'phone-call-delete-btn';
        deleteBtn.textContent = '删除';

        let deleting = false;
        const executeDelete = (ev) => {
            ev?.preventDefault?.();
            ev?.stopPropagation?.();
            if (deleting) return;
            deleting = true;
            this.clearCallRecordTtsCache(record);
            this.app.phoneCallData.deleteCallRecord(record.id);
            this.renderMain();
        };

        deleteBtn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
        deleteBtn.addEventListener('touchend', executeDelete, { passive: false });
        deleteBtn.addEventListener('click', executeDelete);

        item.style.position = 'relative';
        item.appendChild(deleteBtn);
    }

    // ========================================
    // 通话联系人页
    // ========================================
    renderContacts() {
        this.currentView = 'contacts';
        this._ensurePhoneWechatDataLoaded({ rerenderContacts: true });
        const contacts = this.app.phoneCallData.getContacts();
        const sortedContacts = [...contacts].sort((a, b) =>
            String(a?.name || '').localeCompare(String(b?.name || ''), 'zh-Hans-CN')
        );

        const contactsHtml = sortedContacts.length > 0
            ? sortedContacts.map(contact => `
                <div class="phone-call-contact-item ${this.contactSelectionMode ? 'is-selecting' : ''}" data-contact-id="${this._escapeAttr(contact.id)}">
                    <label class="phone-call-contact-check">
                        <input type="checkbox" class="phone-call-contact-select" data-contact-id="${this._escapeAttr(contact.id)}" ${this.selectedContactIds.has(String(contact.id)) ? 'checked' : ''}>
                        <span></span>
                    </label>
                    <div class="phone-call-contact-avatar">${this._getCallerAvatar(contact.name)}</div>
                    <div class="phone-call-contact-name">${this._escapeHtml(contact.name)}</div>
                    <button class="phone-call-contact-dial" data-contact-id="${this._escapeAttr(contact.id)}" title="拨打">
                        <i class="fa-solid fa-phone"></i>
                    </button>
                </div>
            `).join('')
            : '<div class="phone-call-empty">暂无联系人，请先添加姓名</div>';
        const shellBg = this._getSystemWallpaperShellBackgroundConfig('phone-call-contacts');

        const html = `
            <div class="${shellBg.appClass}" style="${shellBg.appStyle}">
                <div class="phone-call-main-header">
                    <button class="phone-call-settings-btn" id="phone-call-contacts-back">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div class="phone-call-main-title">${this.contactSelectionMode ? `已选 ${this.selectedContactIds.size}` : '电话联系人'}</div>
                    <button class="phone-call-settings-btn" id="phone-call-contact-selection-delete" title="删除所选" style="${this.contactSelectionMode ? '' : 'display:none;'}">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                    <button class="phone-call-settings-btn" id="phone-call-contact-selection-cancel" title="取消选择" style="${this.contactSelectionMode ? '' : 'display:none;'}">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                    <button class="phone-call-settings-btn" id="phone-call-contact-add-toggle" title="添加联系人" style="${this.contactSelectionMode ? 'display:none;' : ''}">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                </div>
                <div class="phone-call-contact-add" id="phone-call-contact-add-panel" style="${this.contactAddPanelOpen ? 'display:flex;' : 'display:none;'}">
                    <input type="text" class="phone-call-contact-input" id="phone-call-contact-name" placeholder="输入联系人姓名">
                    <button class="phone-call-contact-add-btn" id="phone-call-contact-add-btn">添加</button>
                </div>
                <div class="phone-call-contact-list">
                    ${contactsHtml}
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'phone-contacts');
        const root = document.querySelector('.phone-view-current .phone-call-contacts');
        if (!root) return;
        const query = (selector) => root.querySelector(selector);
        const queryAll = (selector) => Array.from(root.querySelectorAll(selector));
        if (root.dataset.phoneContactsBound === '1') return;
        root.dataset.phoneContactsBound = '1';

        query('#phone-call-contacts-back')?.addEventListener('click', () => {
            if (this.contactSelectionMode) {
                this.contactSelectionMode = false;
                this.selectedContactIds.clear();
                this.renderContacts();
                return;
            }
            this._returnFromContacts();
        });
        query('#phone-call-contact-selection-cancel')?.addEventListener('click', () => {
            this.contactSelectionMode = false;
            this.selectedContactIds.clear();
            this.renderContacts();
        });
        query('#phone-call-contact-selection-delete')?.addEventListener('click', () => {
            if (!this.contactSelectionMode || this.selectedContactIds.size === 0) return;
            Array.from(this.selectedContactIds).forEach(id => this.app.phoneCallData.deleteContact(id));
            this.contactSelectionMode = false;
            this.selectedContactIds.clear();
            this.renderContacts();
        });
        query('#phone-call-contact-add-toggle')?.addEventListener('click', () => {
            this.contactAddPanelOpen = !this.contactAddPanelOpen;
            this.renderContacts();
            if (this.contactAddPanelOpen) {
                setTimeout(() => {
                    const activeRoot = document.querySelector('.phone-view-current .phone-call-contacts');
                    activeRoot?.querySelector?.('#phone-call-contact-name')?.focus?.();
                }, 50);
            }
        });

        const addContact = () => {
            const input = query('#phone-call-contact-name');
            const name = String(input?.value || '').trim();
            if (!name) {
                this.app.phoneShell.showNotification('提示', '请输入联系人姓名', '⚠️');
                return;
            }
            this.app.phoneCallData.addContact(name);
            this.contactAddPanelOpen = false;
            this.renderContacts();
        };

        query('#phone-call-contact-add-btn')?.addEventListener('click', addContact);
        query('#phone-call-contact-name')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addContact();
            }
        });

        queryAll('.phone-call-contact-dial').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.contactSelectionMode) return;
                const contact = contacts.find(item => String(item?.id || '') === String(btn.dataset.contactId || ''));
                if (contact?.name) this.renderDialingCall(contact.name);
            });
        });

        queryAll('.phone-call-contact-select').forEach(input => {
            input.addEventListener('click', (e) => e.stopPropagation());
            input.addEventListener('change', (e) => {
                const id = String(e.currentTarget.dataset.contactId || '').trim();
                if (!id) return;
                if (e.currentTarget.checked) {
                    this.selectedContactIds.add(id);
                } else {
                    this.selectedContactIds.delete(id);
                }
                this.renderContacts();
            });
        });

        queryAll('.phone-call-contact-item').forEach(item => {
            const contactId = String(item.dataset.contactId || '').trim();
            let pressTimer = null;
            let startX = 0;
            let startY = 0;

            const clearPress = () => {
                if (pressTimer) {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                }
            };
            const startPress = (x, y) => {
                if (this.contactSelectionMode) return;
                startX = x;
                startY = y;
                clearPress();
                pressTimer = setTimeout(() => {
                    pressTimer = null;
                    this.contactSelectionMode = true;
                    this.selectedContactIds = new Set([contactId]);
                    this.renderContacts();
                }, 520);
            };
            const movePress = (x, y) => {
                if (!pressTimer) return;
                if (Math.abs(x - startX) > 18 || Math.abs(y - startY) > 18) clearPress();
            };

            item.addEventListener('click', (e) => {
                if (!this.contactSelectionMode) return;
                e.preventDefault();
                e.stopPropagation();
                if (this.selectedContactIds.has(contactId)) {
                    this.selectedContactIds.delete(contactId);
                } else {
                    this.selectedContactIds.add(contactId);
                }
                this.renderContacts();
            });
            item.addEventListener('touchstart', (e) => {
                if (!e.touches || e.touches.length === 0) return;
                const touch = e.touches[0];
                startPress(touch.clientX, touch.clientY);
            }, { passive: true });
            item.addEventListener('touchmove', (e) => {
                if (!e.touches || e.touches.length === 0) return;
                const touch = e.touches[0];
                movePress(touch.clientX, touch.clientY);
            }, { passive: true });
            item.addEventListener('touchend', clearPress);
            item.addEventListener('touchcancel', clearPress);
            item.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                startPress(e.clientX, e.clientY);
            });
            item.addEventListener('mousemove', (e) => movePress(e.clientX, e.clientY));
            item.addEventListener('mouseup', clearPress);
            item.addEventListener('mouseleave', clearPress);
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.contactSelectionMode = true;
                this.selectedContactIds = new Set([contactId]);
                this.renderContacts();
            });
        });
    }

    // ========================================
    // 主动拨号等待页
    // ========================================
    renderDialingCall(callerName) {
        const safeName = String(callerName || '').trim();
        if (!safeName) return;
        this.currentView = 'dialing';
        this.currentCaller = safeName;
        if (this.dialingTimer) {
            clearTimeout(this.dialingTimer);
            this.dialingTimer = null;
        }

        const avatarHtml = this._getCallerAvatar(safeName);
        const html = `
            <div class="phone-call-incoming phone-call-dialing">
                <div class="phone-call-incoming-avatar">${avatarHtml}</div>
                <div class="phone-call-incoming-name">${this._escapeHtml(safeName)}</div>
                <div class="phone-call-incoming-status" id="phone-call-dialing-status">正在拨号<span class="phone-call-typing-dots"></span></div>
                <div class="phone-call-incoming-btns">
                    <button class="phone-call-btn phone-call-btn-reject" id="phone-call-dial-cancel">
                        <i class="fa-solid fa-phone-slash"></i>
                    </button>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'phone-dialing');
        const root = document.querySelector('.phone-view-current .phone-call-dialing') || document;
        const query = (selector) => root.querySelector(selector);

        let canceled = false;
        const cancelDial = () => {
            canceled = true;
            if (this.dialingTimer) {
                clearTimeout(this.dialingTimer);
                this.dialingTimer = null;
            }
            this._addCallRecord(safeName, 'canceled', 0, []);
            this.app.phoneShell.showNotification('已取消', `已取消拨打 ${safeName}`, '📵');
            this.renderContacts();
        };

        query('#phone-call-dial-cancel')?.addEventListener('click', cancelDial);

        this.dialingTimer = setTimeout(async () => {
            if (canceled || this.currentView !== 'dialing' || this.currentCaller !== safeName) return;
            const statusEl = query('#phone-call-dialing-status');
            if (statusEl) statusEl.innerHTML = '等待对方接听<span class="phone-call-typing-dots"></span>';

            const decision = await this.decideOutgoingCallAnswer(safeName);
            if (canceled || this.currentView !== 'dialing' || this.currentCaller !== safeName) return;

            if (decision.answered) {
                this.renderActiveCall(safeName, { outgoing: true });
                return;
            }

            this._addCallRecord(safeName, 'rejected', 0, []);
            await this._showOutgoingCallRejectedDialog(safeName, decision.reason || `${safeName} 暂时不方便接听。`);
            if (this.currentView === 'dialing' && this.currentCaller === safeName) {
                this.renderContacts();
            }
        }, 1200);
    }

    // ========================================
    // 通话记录查看页
    // ========================================
    renderTranscript(record) {
        this.currentView = 'transcript';
        const context = window.SillyTavern?.getContext?.();
        const userName = context?.name1 || '用户';

        const durationText = record.duration > 0
            ? `${Math.floor(record.duration / 60)}分${record.duration % 60}秒`
            : '未知';

        // 构建消息列表
        let messagesHtml = '';
        if (record.transcript && record.transcript.length > 0) {
            record.transcript.forEach((msg, index) => {
                const isUser = msg.from === 'me';
                const cssClass = isUser ? 'phone-call-message-user' : 'phone-call-message-ai';
                const msgId = String(msg?._id || `${record.id || 'record'}_${index}`).trim();
                const ttsKey = String(msg?._ttsCacheKey || '').trim();
                if (!isUser && msg.text && msg.text.includes('\n')) {
                    // AI消息按行拆分为多个气泡
                    msg.text.split('\n').filter(l => l.trim()).forEach((line, lineIndex) => {
                        const lineText = line.trim();
                        messagesHtml += `<div class="${cssClass}" data-msg-id="${this._escapeAttr(`${msgId}_${lineIndex}`)}" data-phone-call-caller="${this._escapeAttr(record.caller || '')}" data-phone-call-tts-text="${this._escapeAttr(lineText)}">${this._escapeHtml(lineText)}</div>`;
                    });
                } else {
                    const ttsAttrs = isUser ? '' : ` data-msg-id="${this._escapeAttr(msgId)}" data-phone-call-caller="${this._escapeAttr(record.caller || '')}" data-phone-call-tts-text="${this._escapeAttr(msg.text || '')}" data-phone-call-tts-key="${this._escapeAttr(ttsKey)}"`;
                    messagesHtml += `<div class="${cssClass}"${ttsAttrs}>${this._escapeHtml(msg.text)}</div>`;
                }
            });
        }

        const html = `
            <div class="phone-call-transcript">
                <div class="phone-call-transcript-header">
                    <button class="phone-call-transcript-back" id="phone-call-transcript-back">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div class="phone-call-transcript-title">${this._escapeHtml(record.caller || '未知')}</div>
                    <div class="phone-call-transcript-duration">${durationText}</div>
                </div>
                <div class="phone-call-messages" id="phone-call-transcript-messages">
                    <div style="text-align: center; color: rgba(0,0,0,0.3); font-size: 10px; padding: 3px 0;">
                        通话已接通
                    </div>
                    ${messagesHtml}
                </div>
                <div class="phone-call-transcript-info">
                    <div class="phone-call-transcript-info-text">
                        ${record.date || ''} ${record.time || ''} ${record.weekday || ''}
                    </div>
                    <div class="phone-call-transcript-info-text">
                        通话时长：${durationText}
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'phone-transcript');

        // 绑定返回按钮
        document.getElementById('phone-call-transcript-back')?.addEventListener('click', () => {
            this.renderMain();
        });

        this._bindCallTtsBubbleClickEvents(document.getElementById('phone-call-transcript-messages'));
    }

    // ========================================
    // 设置界面（通话提示词编辑）
    // ========================================
    renderSettings() {
        const previousView = this.currentView === 'settings'
            ? (this.returnViewAfterSettings || 'main')
            : (this.currentView || 'main');
        this.returnViewAfterSettings = previousView;
        this.currentView = 'settings';

        const pm = this._getPromptManager();
        const callPrompt = pm?.getPromptForFeature('phone', 'call') || '';
        const smsPrompt = pm?.getPromptForFeature('phone', 'sms') || '';
        const autoTTS = this.app.storage.get('phone-call-auto-tts') || false;
        const shellBg = this._getSystemWallpaperShellBackgroundConfig('phone-call-settings');

        const html = `
            <div class="${shellBg.appClass}" style="${shellBg.appStyle}">
                <div class="phone-call-settings-header">
                    <button class="phone-call-settings-back" id="phone-call-settings-back">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div class="phone-call-settings-title">通话设置</div>
                </div>
                <div class="phone-call-settings-body">
                    <div class="phone-call-settings-section">
                        <div class="phone-call-settings-section-title">语音播放</div>
                        <div class="phone-call-settings-row">
                            <div class="phone-call-settings-copy">
                                <div class="phone-call-settings-label">自动播放 TTS</div>
                                <div class="phone-call-settings-desc">通话回复生成后自动播放语音。</div>
                            </div>
                            <label class="phone-call-toggle" aria-label="自动播放 TTS">
                                <input type="checkbox" id="phone-call-tts-toggle-settings" ${autoTTS ? 'checked' : ''}>
                                <span class="phone-call-toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                    <!-- 通话中提示词 -->
                    <div class="phone-call-settings-section">
                        <div class="phone-call-settings-section-title">通话中提示词</div>
                        <div class="phone-prompt-fold" data-default-open="false">
                            <div class="phone-prompt-fold-header">
                                <div class="phone-prompt-fold-main">
                                    <div class="phone-prompt-fold-title">📞 通话回复规则</div>
                                    <div class="phone-prompt-fold-desc">默认折叠，展开后可编辑提示词。</div>
                                </div>
                                <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow"></i>
                            </div>
                            <div class="phone-prompt-fold-content">
                                ${pm?.renderPromptPresetControls?.('phone', 'call') || ''}
                                <textarea class="phone-call-prompt-textarea" id="phone-call-call-prompt" placeholder="通话中回复规则...">${this._escapeHtml(callPrompt)}</textarea>
                                <div class="phone-call-settings-hint" style="margin-top:6px; font-size:11px; line-height:1.5;">
                                    可用变量：<code>{{user}}</code>、<code>{{callerName}}</code>（同义：<code>{{caller}}</code> / <code>{{char}}</code>）
                                </div>
                                <div class="phone-call-prompt-btns">
                                    <button class="phone-call-prompt-btn phone-call-prompt-btn-save" id="phone-call-save-call">保存</button>
                                    <button class="phone-call-prompt-btn phone-call-prompt-btn-reset" id="phone-call-reset-call">恢复默认</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="phone-call-settings-section">
                        <div class="phone-call-settings-section-title">短信提示词</div>
                        <div class="phone-prompt-fold" data-default-open="false">
                            <div class="phone-prompt-fold-header">
                                <div class="phone-prompt-fold-main">
                                    <div class="phone-prompt-fold-title">💬 拟真短信规则</div>
                                    <div class="phone-prompt-fold-desc">默认折叠，展开后可编辑提示词。</div>
                                </div>
                                <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow"></i>
                            </div>
                            <div class="phone-prompt-fold-content">
                                ${pm?.renderPromptPresetControls?.('phone', 'sms') || ''}
                                <textarea class="phone-call-prompt-textarea" id="phone-call-sms-prompt" placeholder="短信回复与通知规则...">${this._escapeHtml(smsPrompt)}</textarea>
                                <div class="phone-call-settings-hint" style="margin-top:6px; font-size:11px; line-height:1.5;">
                                    可用变量：<code>{{user}}</code>、<code>{{recipientName}}</code>（同义：<code>{{callerName}}</code> / <code>{{char}}</code>）
                                </div>
                                <div class="phone-call-prompt-btns">
                                    <button class="phone-call-prompt-btn phone-call-prompt-btn-save" id="phone-call-save-sms">保存</button>
                                    <button class="phone-call-prompt-btn phone-call-prompt-btn-reset" id="phone-call-reset-sms">恢复默认</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'phone-settings');
        this._bindSettingsEvents();
    }

    _bindSettingsEvents() {
        const pm = this._getPromptManager();
        const currentView = document.querySelector('.phone-view-current') || document;
        const query = (selector) => currentView.querySelector(selector);
        this._bindPromptFoldToggles(currentView);
        pm?.bindPromptPresetControls?.(currentView, 'phone', 'call', '#phone-call-call-prompt', {
            notify: (title, message, icon) => this.app.phoneShell.showNotification(title, message, icon)
        });
        pm?.bindPromptPresetControls?.(currentView, 'phone', 'sms', '#phone-call-sms-prompt', {
            notify: (title, message, icon) => this.app.phoneShell.showNotification(title, message, icon)
        });

        // 返回（用 onclick 覆盖式绑定，防止 DOM Diffing 导致重复监听）
        const backBtn = query('#phone-call-settings-back');
        if (backBtn) backBtn.onclick = () => this._returnFromSettings();

        const autoTtsToggle = query('#phone-call-tts-toggle-settings');
        if (autoTtsToggle) autoTtsToggle.onchange = (e) => {
            this.app.storage.set('phone-call-auto-tts', e.target.checked);
        };

        // 保存通话提示词
        const saveBtn = query('#phone-call-save-call');
        if (saveBtn) saveBtn.onclick = () => {
            const content = query('#phone-call-call-prompt')?.value || '';
            try {
                if (pm) pm.updateActivePromptUserPreset?.('phone', 'call', content) ?? pm.updatePrompt('phone', 'call', content);
                this.app.phoneShell.showNotification('已保存', '通话提示词已更新', '✅');
            } catch (e) {
                this.app.phoneShell.showNotification('不能保存默认', e?.message || '请先新增预设再保存', '⚠️');
            }
        };

        // 恢复通话默认
        const resetBtn = query('#phone-call-reset-call');
        if (resetBtn) resetBtn.onclick = () => {
            if (pm) {
                const defaultContent = pm.resetPromptToDefault?.('phone', 'call')
                    ?? pm.getDefaultPrompts().phone?.call?.content
                    ?? '';
                const textarea = query('#phone-call-call-prompt');
                if (textarea) textarea.value = defaultContent;
                this.app.phoneShell.showNotification('已恢复', '通话提示词已恢复默认', '✅');
            }
        };

        const saveSmsBtn = query('#phone-call-save-sms');
        if (saveSmsBtn) saveSmsBtn.onclick = () => {
            const content = query('#phone-call-sms-prompt')?.value || '';
            try {
                if (pm) pm.updateActivePromptUserPreset?.('phone', 'sms', content) ?? pm.updatePrompt('phone', 'sms', content);
                this.app.phoneShell.showNotification('已保存', '短信提示词已更新', '✅');
            } catch (e) {
                this.app.phoneShell.showNotification('不能保存默认', e?.message || '请先新增预设再保存', '⚠️');
            }
        };

        const resetSmsBtn = query('#phone-call-reset-sms');
        if (resetSmsBtn) resetSmsBtn.onclick = () => {
            if (pm) {
                const defaultContent = pm.resetPromptToDefault?.('phone', 'sms')
                    ?? pm.getDefaultPrompts().phone?.sms?.content
                    ?? '';
                const textarea = query('#phone-call-sms-prompt');
                if (textarea) textarea.value = defaultContent;
                this.app.phoneShell.showNotification('已恢复', '短信提示词已恢复默认', '✅');
            }
        };

        // 移动端手势豁免：在提示词框内滑动/选字时，不让外层手机壳手势抢事件
        [query('#phone-call-call-prompt'), query('#phone-call-sms-prompt')].filter(Boolean).forEach(textarea => {
            textarea.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
            textarea.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
            textarea.addEventListener('touchend', (e) => e.stopPropagation(), { passive: true });
        });
    }

    _returnFromSettings() {
        const targetView = this.returnViewAfterSettings || 'main';
        this.returnViewAfterSettings = 'main';
        if (targetView === 'active' && this.currentCaller) {
            this.renderActiveCall(this.currentCaller);
            return;
        }
        if (targetView === 'incoming' && this.currentCaller) {
            this.renderIncomingCall(this.currentCaller);
            return;
        }
        if (targetView === 'contacts') {
            this.renderContacts();
            return;
        }
        if (targetView === 'sms' || targetView === 'sms-thread') {
            this.renderSmsList();
            return;
        }
        this.renderMain();
    }

    _returnFromContacts() {
        const targetView = this.returnViewAfterContacts || 'main';
        this.returnViewAfterContacts = 'main';
        if (targetView === 'sms') {
            this.renderSmsList();
            return;
        }
        this.renderMain();
    }

    _bindPromptFoldToggles(root) {
        if (!root) return;
        root.querySelectorAll('.phone-prompt-fold').forEach(fold => {
            if (fold.dataset.foldInited !== '1') {
                fold.dataset.foldInited = '1';
                fold.classList.toggle('is-open', String(fold.dataset.defaultOpen || '').toLowerCase() === 'true');
            }
        });
        root.querySelectorAll('.phone-prompt-fold-header').forEach(header => {
            if (header.dataset.foldBound === '1') return;
            header.dataset.foldBound = '1';
            header.addEventListener('click', () => {
                const fold = header.closest('.phone-prompt-fold');
                if (!fold) return;
                fold.classList.toggle('is-open');
            });
        });
    }

    _showOutgoingCallRejectedDialog(callerName, reason) {
        const host = document.querySelector('.phone-view-current') || this.app.phoneShell?.screen || document.body;
        const safeName = String(callerName || '对方').trim() || '对方';
        const safeReason = String(reason || `${safeName} 暂时不方便接听。`).trim();
        const modalId = `phone-call-reject-reason-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.id = modalId;
            modal.className = 'phone-call-reject-reason-modal';
            modal.style.cssText = `
                position:absolute;
                inset:0;
                z-index:2600;
                display:flex;
                align-items:center;
                justify-content:center;
                padding:18px;
                box-sizing:border-box;
                background:rgba(0,0,0,0.36);
            `;
            modal.innerHTML = `
                <div style="width:100%; max-width:300px; background:rgba(255,255,255,0.96); border-radius:14px; overflow:hidden; box-shadow:0 12px 32px rgba(0,0,0,0.24);">
                    <div style="padding:16px 16px 10px; text-align:center; border-bottom:0.5px solid rgba(0,0,0,0.08);">
                        <div style="font-size:15px; font-weight:600; color:#111;">${this._escapeHtml(safeName)}拒绝了电话</div>
                    </div>
                    <div style="padding:14px 16px 16px; font-size:13px; line-height:1.6; color:#333; white-space:pre-wrap;">${this._escapeHtml(safeReason)}</div>
                    <button type="button" id="${this._escapeAttr(modalId)}-ok" style="width:100%; height:42px; border:none; border-top:0.5px solid rgba(0,0,0,0.08); background:#fff; color:#07c160; font-size:15px; font-weight:600; cursor:pointer;">确定</button>
                </div>
            `;

            const close = () => {
                modal.remove();
                resolve();
            };

            host.appendChild(modal);
            modal.querySelector(`#${this._escapeCssAttr(modalId)}-ok`)?.addEventListener('click', close, { once: true });
        });
    }

    // ========================================
    // 来电界面
    // ========================================
    renderIncomingCall(callerName) {
        this.currentView = 'incoming';
        // 确保来电时拥有底层垫片，防止挂断后白屏
        if (this.app.phoneShell.viewHistory.length === 0 && window.VirtualPhone?.home) {
            window.VirtualPhone.home.render();
        }
        this.currentCaller = callerName;

        // 尝试获取头像
        const avatarHtml = this._getCallerAvatar(callerName);

        const html = `
            <div class="phone-call-incoming">
                <div class="phone-call-incoming-avatar">${avatarHtml}</div>
                <div class="phone-call-incoming-name">${callerName}</div>
                <div class="phone-call-incoming-status">来电<span class="phone-call-typing-dots"></span></div>
                <div class="phone-call-incoming-btns">
                    <button class="phone-call-btn phone-call-btn-reject" id="phone-call-reject">
                        <i class="fa-solid fa-phone-slash"></i>
                    </button>
                    <button class="phone-call-btn phone-call-btn-accept" id="phone-call-accept">
                        <i class="fa-solid fa-phone"></i>
                    </button>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'phone-incoming');

        // 拒绝
        document.getElementById('phone-call-reject')?.addEventListener('click', () => {
            this._addCallRecord(callerName, 'rejected', 0, []);
            this.app.phoneShell.showNotification('来电', `已拒绝 ${callerName} 的来电`, '📵');
            this.renderMain();
        });

        // 接听
        document.getElementById('phone-call-accept')?.addEventListener('click', () => {
            this.renderActiveCall(callerName);
        });
    }

    // ========================================
    // 通话界面
    // ========================================
    renderActiveCall(callerName, options = {}) {
        const previousView = this.currentView;
        this.currentView = 'active';
        this.currentCaller = callerName;
        this._ensurePhoneWechatDataLoaded();
        this.callDuration = 0;
        this.chatMessages = [];
        const isOutgoingCall = options.outgoing === true;
        const shouldReplaceDialingView = isOutgoingCall && previousView === 'dialing';

        const avatarHtml = this._getCallerAvatar(callerName);

        const html = `
            <div class="phone-call-active">
                <div class="phone-call-active-header">
                    <div class="phone-call-active-name">${callerName}<span class="phone-call-status-dot phone-dot-green" id="phone-call-status-dot"></span></div>
                    <div class="phone-call-active-timer" id="phone-call-timer">00:00</div>
                </div>

                <div class="phone-call-active-avatar-area">
                    <div class="phone-call-active-avatar">${avatarHtml}</div>
                    <div class="phone-call-active-label">通话中</div>
                </div>

                <div class="phone-call-messages" id="phone-call-messages">
                    <div style="text-align: center; color: rgba(255,255,255,0.4) !important; font-size: 10px; padding: 3px 0;">
                        通话已接通
                    </div>
                </div>

                <div class="phone-call-bottom">
                    <input type="text" class="phone-call-input" id="phone-call-input" placeholder="${isOutgoingCall ? '等待对方回应...' : '发送消息...'}"${isOutgoingCall ? ' disabled aria-disabled="true"' : ''}>
                    <button class="phone-call-regen-btn" id="phone-call-regen" title="重新生成" style="display:none; color: rgba(255,255,255,0.7);">
                        <i class="fa-solid fa-rotate-right" style="color: inherit;"></i>
                    </button>
                    <button class="phone-call-send-btn" id="phone-call-send" style="color: #34c759;"${isOutgoingCall ? ' disabled aria-disabled="true"' : ''}>
                        <i class="fa-solid fa-paper-plane" style="color: inherit;"></i>
                    </button>
                    <button class="phone-call-hangup-btn" id="phone-call-hangup" style="color: #ff3b30;">
                        <i class="fa-solid fa-phone-slash" style="color: inherit;"></i>
                    </button>
                </div>
            </div>
        `;

        this._setPhoneShellContent(html, 'phone-active', {
            replaceViewIds: shouldReplaceDialingView ? ['phone-dialing'] : []
        });

        const phoneInput = document.getElementById('phone-call-input');
        const phoneSendBtn = document.getElementById('phone-call-send');
        let isOpeningLinePending = isOutgoingCall;
        const setOpeningComposerLocked = (locked) => {
            isOpeningLinePending = !!locked;
            if (phoneInput) {
                phoneInput.disabled = isOpeningLinePending;
                phoneInput.setAttribute('aria-disabled', String(isOpeningLinePending));
                phoneInput.placeholder = isOpeningLinePending ? '等待对方回应...' : '发送消息...';
            }
            if (phoneSendBtn) {
                phoneSendBtn.disabled = isOpeningLinePending;
                phoneSendBtn.setAttribute('aria-disabled', String(isOpeningLinePending));
                phoneSendBtn.style.opacity = isOpeningLinePending ? '0.35' : '';
            }
        };
        setOpeningComposerLocked(isOpeningLinePending);

        // 记录通话开始的剧情时间
        const timeManager = window.VirtualPhone?.timeManager;
        const callStartTime = timeManager
            ? timeManager.getCurrentStoryTime()
            : { time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), date: '' };

        // 计时器
        this.callTimer = setInterval(() => {
            this.callDuration++;
            const minutes = Math.floor(this.callDuration / 60).toString().padStart(2, '0');
            const seconds = (this.callDuration % 60).toString().padStart(2, '0');
            const timerDiv = document.getElementById('phone-call-timer');
            if (timerDiv) {
                timerDiv.textContent = `${minutes}:${seconds}`;
            }
        }, 1000);

        // 更新重新生成按钮的显示状态
        const updateRegenBtn = () => {
            const regenBtn = document.getElementById('phone-call-regen');
            if (!regenBtn) return;
            // 只要有AI消息就显示重新生成按钮
            const hasAiMsg = this.chatMessages.some(m => m.from !== 'me');
            regenBtn.style.display = hasAiMsg ? '' : 'none';
        };

        const setCallStatus = (color = 'green') => {
            const dot = document.getElementById('phone-call-status-dot');
            if (!dot) return;
            dot.classList.remove('phone-dot-green', 'phone-dot-yellow', 'phone-dot-red');
            if (color === 'red') {
                dot.classList.add('phone-dot-red');
                return;
            }
            if (color === 'yellow') {
                dot.classList.add('phone-dot-yellow');
                return;
            }
            dot.classList.add('phone-dot-green');
        };

        let callBatchTimer = null;
        let callPendingUserLines = [];
        let isCallSending = false;

        const clearCallBatchTimer = () => {
            clearTimeout(callBatchTimer);
            callBatchTimer = null;
        };

        const restartCallPendingTimerIfNeeded = () => {
            const input = document.getElementById('phone-call-input');
            const text = String(input?.value || '').trim();
            const isEditing = !!input && document.activeElement === input;
            const canRestart = !isEditing && text === '' && callPendingUserLines.length > 0 && !isCallSending;
            if (!canRestart) {
                if (isEditing && !isCallSending) {
                    setCallStatus('green');
                }
                return;
            }
            clearCallBatchTimer();
            callBatchTimer = setTimeout(() => {
                triggerCallAI();
            }, 6000);
            setCallStatus('yellow');
        };

        // 发送消息并获取AI回复（核心逻辑，复用于发送和重新生成）
        const requestAIReply = async (userText) => {
            const messagesDiv = document.getElementById('phone-call-messages');
            if (!messagesDiv) return;

            // 显示 "对方正在说话..." 指示器
            messagesDiv.insertAdjacentHTML('beforeend',
                `<div class="phone-call-typing" id="phone-call-typing">对方正在说话<span class="phone-call-typing-dots"></span></div>`
            );
            messagesDiv.scrollTop = messagesDiv.scrollHeight;

            try {
                // 调用AI获取回复（返回数组，每行一条）
                const aiLines = await this.sendCallMessageToAI(userText, callerName, this.chatMessages);

                // 移除打字指示器
                document.getElementById('phone-call-typing')?.remove();

                // 每行一个气泡
                const bubbleIds = [];
                for (const line of aiLines) {
                    const bubbleId = `phone-ai-msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                    const msgId = this._buildCallMessageId('ai');
                    messagesDiv.insertAdjacentHTML('beforeend',
                        `<div class="phone-call-message-ai" id="${bubbleId}" data-msg-id="${this._escapeAttr(msgId)}" data-phone-call-tts-text="${this._escapeAttr(line)}">${this._escapeHtml(line)}</div>`
                    );
                    this.chatMessages.push({ _id: msgId, from: callerName, text: line });
                    bubbleIds.push(bubbleId);
                }
                messagesDiv.scrollTop = messagesDiv.scrollHeight;

                updateRegenBtn();

                // 自动TTS：逐条播放
                const autoTTS = this.app.storage.get('phone-call-auto-tts');
                if (autoTTS) {
                    for (let i = 0; i < aiLines.length; i++) {
                        const bubble = document.getElementById(bubbleIds[i]);
                        if (bubble) {
                            await this.playTTS(aiLines[i], bubble, {
                                caller: callerName,
                                messageId: String(bubble.dataset?.msgId || bubble.id || '').trim()
                            });
                        }
                    }
                }

            } catch (error) {
                console.error('❌ 通话消息发送失败:', error);
                document.getElementById('phone-call-typing')?.remove();
                messagesDiv.insertAdjacentHTML('beforeend',
                    `<div class="phone-call-message-ai" data-msg-id="${this._escapeAttr(this._buildCallMessageId('ai'))}" style="opacity:0.5;">...</div>`
                );
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
                this.chatMessages.push({ _id: this._buildCallMessageId('ai'), from: callerName, text: '...' });
                updateRegenBtn();
            }
        };

        const triggerCallAI = async () => {
            if (isCallSending || callPendingUserLines.length === 0) return;

            isCallSending = true;
            clearCallBatchTimer();
            setCallStatus('red');
            const messageToSend = callPendingUserLines.join('\n');
            callPendingUserLines = [];

            try {
                await requestAIReply(messageToSend);
            } finally {
                isCallSending = false;
                if (callPendingUserLines.length > 0) {
                    restartCallPendingTimerIfNeeded();
                } else {
                    setCallStatus('green');
                }
            }
        };

        const triggerOpeningLine = async () => {
            if (!isOutgoingCall || isCallSending || this.currentView !== 'active' || this.currentCaller !== callerName) return;
            setOpeningComposerLocked(true);
            isCallSending = true;
            setCallStatus('red');
            try {
                await requestAIReply(`【系统提示】现在是用户主动拨打给你，${callerName}可选择拒绝/接听。`);
            } finally {
                isCallSending = false;
                setOpeningComposerLocked(false);
                setCallStatus('green');
            }
        };

        // 发送消息
        const sendMessage = async () => {
            if (isOpeningLinePending) return;
            this.audioPlayer.pause();
            this.audioPlayer.src = '';

            const input = document.getElementById('phone-call-input');
            const messagesDiv = document.getElementById('phone-call-messages');
            if (!input || !messagesDiv) return;

            const text = input.value.trim();
            if (text) {
                // 显示用户气泡
                messagesDiv.insertAdjacentHTML('beforeend',
                    `<div class="phone-call-message-user" data-msg-id="${this._escapeAttr(this._buildCallMessageId('user'))}">${this._escapeHtml(text)}</div>`
                );
                messagesDiv.scrollTop = messagesDiv.scrollHeight;

                const userMsgId = String(messagesDiv.lastElementChild?.dataset?.msgId || '').trim() || this._buildCallMessageId('user');
                this.chatMessages.push({ _id: userMsgId, from: 'me', text });
                callPendingUserLines.push(text);
                input.value = '';

                if (document.activeElement === input) {
                    clearCallBatchTimer();
                    setCallStatus('green');
                } else {
                    restartCallPendingTimerIfNeeded();
                }
                return;
            }

            if (callPendingUserLines.length > 0) {
                await triggerCallAI();
                return;
            }

            const recentUserLines = this.chatMessages
                .filter(m => m.from === 'me')
                .slice(-5)
                .map(m => m.text)
                .filter(Boolean);
            if (recentUserLines.length > 0) {
                callPendingUserLines = recentUserLines;
                await triggerCallAI();
                return;
            }

            this.app.phoneShell.showNotification('提示', '请先输入内容', '⚠️');
        };

        // 重新生成：删除最后一轮AI回复，重新发送
        const regenerate = async () => {
            const messagesDiv = document.getElementById('phone-call-messages');
            if (!messagesDiv) return;
            this._removeCallMessageDeleteButtons(messagesDiv);

            // 停止正在播放的音频
            this.stopTTS();

            // 从 chatMessages 尾部删除所有连续的AI消息，直到遇到用户消息
            while (this.chatMessages.length > 0 && this.chatMessages[this.chatMessages.length - 1].from !== 'me') {
                this.chatMessages.pop();
            }

            // 如果没有用户消息了，无法重新生成
            if (this.chatMessages.length === 0) return;

            // 获取最后一条用户消息（不删除）
            const lastUserMsg = this.chatMessages[this.chatMessages.length - 1].text;

            // 从 DOM 尾部删除所有连续的 AI 气泡
            const children = Array.from(messagesDiv.children);
            for (let i = children.length - 1; i >= 0; i--) {
                const child = children[i];
                if (child.classList.contains('phone-call-message-ai') || child.classList.contains('phone-call-typing')) {
                    child.remove();
                } else {
                    break; // 遇到非AI气泡就停止
                }
            }

            updateRegenBtn();

            clearCallBatchTimer();
            callPendingUserLines = [];
            isCallSending = true;
            setCallStatus('red');
            try {
                await requestAIReply(lastUserMsg);
            } finally {
                isCallSending = false;
                setCallStatus('green');
            }
        };

        // 绑定事件
        phoneInput?.addEventListener('focus', () => {
            clearCallBatchTimer();
            setCallStatus('green');
        });

        phoneInput?.addEventListener('blur', () => {
            restartCallPendingTimerIfNeeded();
        });

        phoneInput?.addEventListener('input', (e) => {
            const text = String(e.target.value || '').trim();
            if (text !== '') {
                clearCallBatchTimer();
                setCallStatus('green');
                return;
            }
            if (document.activeElement === e.target) return;
            restartCallPendingTimerIfNeeded();
        });

        let isHandlingCallSend = false;
        const executeCallSend = (e) => {
            if (e) e.preventDefault();
            if (isOpeningLinePending || isHandlingCallSend) return;
            isHandlingCallSend = true;
            sendMessage();
            setTimeout(() => {
                isHandlingCallSend = false;
            }, 300);
        };

        phoneSendBtn?.addEventListener('touchstart', (e) => {
            e.preventDefault();
        }, { passive: false });
        phoneSendBtn?.addEventListener('touchend', executeCallSend);
        phoneSendBtn?.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });
        phoneSendBtn?.addEventListener('click', executeCallSend);

        phoneInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        const activeMessagesDiv = document.getElementById('phone-call-messages');
        this._bindCallTtsBubbleClickEvents(activeMessagesDiv);
        this._bindCallMessageDeleteEvents(activeMessagesDiv, { onChanged: updateRegenBtn });
        document.getElementById('phone-call-regen')?.addEventListener('click', regenerate);
        setCallStatus('green');

        // 挂断
        const hangupCall = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            if (this.callTimer) {
                clearInterval(this.callTimer);
                this.callTimer = null;
            }
            clearCallBatchTimer();
            callPendingUserLines = [];
            isCallSending = false;

            // 停止音频播放
            this.stopTTS();

            const durationText = `${Math.floor(this.callDuration / 60)}分${this.callDuration % 60}秒`;

            // 推算通话结束时间
            const minutesElapsed = Math.max(1, Math.ceil(this.callDuration / 60));
            let endTime = callStartTime;
            if (timeManager?.addMinutesToStoryTime) {
                endTime = timeManager.addMinutesToStoryTime(callStartTime, minutesElapsed);
                timeManager.setTime?.(endTime.time, endTime.date, endTime.weekday);
            }

            // 添加已接通记录
            this._addCallRecord(callerName, 'answered', this.callDuration, [...this.chatMessages], endTime);

            this.app.phoneShell.showNotification('通话结束', `通话 ${durationText}`, '📞');
            this.renderContacts();
        };
        const hangupBtn = document.getElementById('phone-call-hangup');
        hangupBtn?.addEventListener('touchstart', (e) => {
            e.preventDefault();
        }, { passive: false });
        hangupBtn?.addEventListener('touchend', hangupCall, { passive: false });
        hangupBtn?.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });
        hangupBtn?.addEventListener('click', hangupCall);

        // 主动拨号接通后先展示通话界面，不自动弹出键盘覆盖界面
        if (!isOutgoingCall) {
            setTimeout(() => {
                document.getElementById('phone-call-input')?.focus();
            }, 300);
        }

        if (isOutgoingCall) {
            setTimeout(() => {
                if (this.currentView === 'active' && this.currentCaller === callerName) {
                    triggerOpeningLine();
                }
            }, 450);
        }
    }

    // ========================================
    // AI通信（完全重写，参照 chat-view.js:buildMessagesArray）
    // ========================================
    async decideOutgoingCallAnswer(callerName) {
        try {
            const context = window.SillyTavern?.getContext?.();
            const apiManager = window.VirtualPhone?.apiManager;
            if (!context || !apiManager) {
                return { answered: true, reason: '' };
            }

            const userName = context.name1 || '用户';
            const callRoleName = String(callerName || '').trim() || '对方';
            const recentChat = Array.isArray(context.chat)
                ? context.chat.slice(-8).map(msg => {
                    const speaker = msg.is_user ? userName : callRoleName;
                    let content = String(msg.mes || msg.content || '').trim();
                    content = applyPhoneTagFilter(content, { storage: this.app.storage });
                    content = content.replace(/<[^>]+>/g, '').trim();
                    return content ? `${speaker}: ${content}` : '';
                }).filter(Boolean).join('\n')
                : '';

            const messages = [];

            if (recentChat) {
                messages.push({
                    role: 'system',
                    content: `【最近剧情】\n${recentChat}`,
                    isPhoneMessage: true
                });
            }

            const pm = this._getPromptManager();
            const callPrompt = pm?.getPromptForFeature('phone', 'call') || '';
            if (callPrompt) {
                const processedPrompt = callPrompt
                    .replace(/\{\{char\}\}/gi, callRoleName)
                    .replace(/\{\{callerName\}\}/gi, callRoleName)
                    .replace(/\{\{caller\}\}/gi, callRoleName)
                    .replace(/\{\{roleName\}\}/gi, callRoleName)
                    .replace(/\{\{user\}\}/gi, userName);
                messages.push({
                    role: 'system',
                    content: processedPrompt,
                    isPhoneMessage: true
                });
            }

            messages.push({
                role: 'user',
                content: `判断 ${callRoleName} 是否接听 ${userName} 的电话。`,
                isPhoneMessage: true
            });

            const result = await apiManager.callAI(messages, {
                preserve_roles: true,
                appId: 'phone_online',
                max_tokens: 280
            });
            if (!result.success) throw new Error(result.error || '接听判定失败');

            const raw = String(result.summary || result.content || result.text || '').trim();
            const callBody = raw.match(/<Call>([\s\S]*?)<\/Call>/i)?.[1]?.trim() || raw;
            const rejectMatch = callBody.match(/\[拒绝电话\]\s*[：:]\s*([\s\S]*)/i);
            if (rejectMatch) {
                return {
                    answered: false,
                    reason: this._cleanCallRejectReason(rejectMatch[1], callRoleName)
                };
            }

            const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
            let parsed = null;
            try {
                parsed = JSON.parse(jsonText);
            } catch (e) {
                const negative = /不接|拒接|没接|挂断|no|false|decline|reject/i.test(raw);
                return {
                    answered: !negative,
                    reason: negative ? this._cleanCallRejectReason(raw, callRoleName) : ''
                };
            }

            const answer = String(parsed?.answer || parsed?.answered || '').toLowerCase();
            const answered = parsed?.answered === true
                || ['yes', 'true', '接听', '会接', '接'].includes(answer)
                || (answer !== 'no' && answer !== 'false' && /接听|会接/.test(String(parsed?.answer || '')));
            return {
                answered,
                reason: this._cleanCallRejectReason(parsed?.reason || '', callRoleName)
            };
        } catch (error) {
            console.warn('📞 主动拨号接听判定失败，默认接通:', error);
            return { answered: true, reason: '' };
        }
    }

    async sendCallMessageToAI(message, callerName, chatMessages) {
        try {
            const context = window.SillyTavern?.getContext?.();
            if (!context) return '...';

            const userName = context.name1 || '用户';
            const callRoleName = String(callerName || '').trim() || '对方';
            let contextCharacterName = callRoleName;

            // 优先使用 characterId 获取真实角色名
            if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
                contextCharacterName = context.characters[context.characterId].name || callRoleName;
            }

            const storage = window.VirtualPhone?.storage;
            const messages = [];

            // ========================================
            // 1️⃣ 角色信息（name、description、personality、scenario、system_prompt、character_book）
            // ========================================
            if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
                const char = context.characters[context.characterId];
                let charInfo = `【角色信息】\n角色卡主体: ${char.name || contextCharacterName}\n当前电话来电角色: ${callRoleName}\n`;

                if (char.description) charInfo += `描述: ${char.description}\n`;
                if (char.personality) charInfo += `性格: ${char.personality}\n`;
                if (char.scenario) charInfo += `场景/背景: ${char.scenario}\n`;

                if (char.data && char.data.system_prompt) {
                    charInfo += `\n${char.data.system_prompt}\n`;
                }

                messages.push({
                    role: 'system',
                    content: charInfo,
                    isPhoneMessage: true
                });

                // 世界书/角色书
                if (char.data && char.data.character_book && char.data.character_book.entries) {
                    const entries = char.data.character_book.entries;
                    if (entries.length > 0) {
                        entries.forEach(entry => {
                            if (entry.content && entry.enabled !== false) {
                                messages.push({
                                    role: 'system',
                                    content: String(entry.content).trim(),
                                    isPhoneMessage: true
                                });
                            }
                        });
                    }
                }
            }

            // ========================================
            // 2️⃣ 用户 Persona
            // ========================================
            const personaTextarea = document.getElementById('persona_description');
            if (personaTextarea && personaTextarea.value && personaTextarea.value.trim()) {
                messages.push({
                    role: 'system',
                    content: `【用户信息】\n${personaTextarea.value.trim()}`,
                    isPhoneMessage: true
                });
            }

            // ========================================
            // 3️⃣ 酒馆正文上下文（最近 phone-context-limit 条）
            // ========================================
            const contextLimit = readPhoneContextLimit(storage || this.app?.storage);

            if (context.chat && Array.isArray(context.chat) && context.chat.length > 0) {
                const collectedContextMessages = [];
                for (let idx = context.chat.length - 1; idx >= 0 && collectedContextMessages.length < contextLimit; idx--) {
                    const msg = context.chat[idx];
                    // 跳过系统消息和特殊消息
                    if (!msg || msg.isGaigaiPrompt || msg.isGaigaiData || msg.isPhoneMessage) continue;

                    let content = msg.mes || msg.content || '';

                    // 标签清洗：优先记忆插件，缺失时按手机本地开关回退
                    content = applyPhoneTagFilter(content, { storage });

                    // 清理 base64 图片
                    content = content.replace(/<img[^>]*src=["']data:image[^"']*["'][^>]*>/gi, '[图片]');
                    content = content.replace(/!\[[^\]]*\]\(data:image[^)]*\)/gi, '[图片]');

                    // 移除通话标签
                    content = content.replace(/<Phone>[\s\S]*?<\/Phone>/gi, '');
                    content = content.replace(/<Call>[\s\S]*?<\/Call>/gi, '');

                    content = content.trim();

                    if (content) {
                        const isUser = msg.is_user || msg.role === 'user';
                        const speaker = isUser ? userName : callRoleName;
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
            // 4️⃣ [Start a new chat] 记忆插件锚点
            // ========================================
            messages.push({
                role: 'system',
                content: '[Start a new chat]',
                name: 'SYSTEM (分界线)',
                isPhoneMessage: true
            });

            // ========================================
            // 5️⃣ 同一联系人的微信单聊记录
            // ========================================
            const wechatHistoryContext = await this._buildWechatHistoryContextForCall(callRoleName, userName);
            if (wechatHistoryContext) {
                messages.push({
                    role: 'system',
                    content: wechatHistoryContext,
                    name: 'SYSTEM (微信单聊记录)',
                    isPhoneMessage: true
                });
            }

            // ========================================
            // 6️⃣ 通话提示词（phone.call）
            // ========================================
            const pm = this._getPromptManager();
            const callPrompt = pm?.getPromptForFeature('phone', 'call') || '';
            if (callPrompt) {
                const processedPrompt = callPrompt
                    .replace(/\{\{char\}\}/gi, callRoleName)
                    .replace(/\{\{callerName\}\}/gi, callRoleName)
                    .replace(/\{\{caller\}\}/gi, callRoleName)
                    .replace(/\{\{roleName\}\}/gi, callRoleName)
                    .replace(/\{\{user\}\}/gi, userName);
                messages.push({
                    role: 'system',
                    content: processedPrompt,
                    isPhoneMessage: true
                });
            }

            // ========================================
            // 7️⃣ 通话聊天记录（最近 phone-call-limit 条）
            // ========================================
            const callLimit = storage ? (parseInt(storage.get('phone-call-limit')) || 10) : 10;
            const recentMessages = chatMessages.slice(-callLimit);
            if (recentMessages.length > 0) {
                let historyText = '【📞 当前通话记录】\n';
                recentMessages.forEach(h => {
                    const speaker = h.from === 'me' ? userName : callRoleName;
                    historyText += `${speaker}: ${h.text}\n`;
                });
                messages.push({
                    role: 'system',
                    content: historyText.trim(),
                    isPhoneMessage: true
                });
            }

            // ========================================
            // 8️⃣ 当前用户消息
            // ========================================
            messages.push({
                role: 'user',
                content: `${userName}说：${message}`,
                isPhoneMessage: true
            });

            // 通过 ApiManager 调用，确保通话场景权限信号下发
            const apiManager = window.VirtualPhone?.apiManager;
            if (!apiManager) throw new Error('API Manager 未初始化');

            const resolvedMaxTokens = Number.parseInt(context?.max_response_length, 10)
                || Number.parseInt(context?.max_length, 10)
                || Number.parseInt(context?.amount_gen, 10);
            const callAiOptions = {
                preserve_roles: true,
                appId: 'phone_online'
            };
            if (Number.isFinite(resolvedMaxTokens) && resolvedMaxTokens > 0) {
                callAiOptions.max_tokens = resolvedMaxTokens;
            }
            const result = await apiManager.callAI(messages, callAiOptions);
            if (!result.success) throw new Error(result.error || '通话AI返回为空');

            // 清理回复
            const rawReply = String(result.summary || result.content || result.text || '').trim();
            return this._cleanAIResponse(rawReply, callerName);

        } catch (error) {
            console.error('❌ 通话AI请求失败:', error);
            return ['...'];
        }
    }

    // ========================================
    // TTS播放
    // ========================================
    stopTTS() {
        this.currentTtsRound = null;
        if (this.audioPlayer) {
            this.audioPlayer.pause();
            this.audioPlayer.src = '';
        }
        if (this.currentPlayingBubble) {
            this.currentPlayingBubble.classList.remove('voice-playing');
            this.currentPlayingBubble = null;
        }
    }

    clearTtsCache() {
        this.stopTTS();
        this._phoneCallTtsCache.forEach((blobUrl) => {
            if (blobUrl && String(blobUrl).startsWith('blob:')) {
                try { URL.revokeObjectURL(blobUrl); } catch (e) { /* ignore */ }
            }
        });
        this._phoneCallTtsCache.clear();
        this._phoneCallTtsCacheOrder = [];
    }

    clearPersistedTtsCache() {
        const prefixes = [
            'virtual_phone_phone_call_tts_cache_',
            'virtual_phone_phone-call-tts-cache-'
        ];
        try {
            Object.keys(localStorage || {}).forEach((key) => {
                if (prefixes.some(prefix => String(key || '').startsWith(prefix))) localStorage.removeItem(key);
            });
        } catch (e) {
            // ignore
        }
    }

    clearCallRecordTtsCache(record = {}) {
        const caller = String(record?.caller || '').trim();
        const ttsConfig = this._resolveCallerTtsVoice(caller, { allowGlobalFallback: true });
        const provider = String(ttsConfig?.provider || '').trim();
        const voice = String(ttsConfig?.voice || '').trim();
        const transcript = Array.isArray(record?.transcript) ? record.transcript : [];
        transcript.forEach((msg, index) => {
            if (!msg || msg.from === 'me') return;
            const msgId = String(msg?._id || `${record.id || 'record'}_${index}`).trim();
            const text = String(msg.text || '').trim();
            if (!msgId && !text) return;
            if (msg._ttsCacheKey) {
                this._removePersistedPhoneCallTtsCacheByKey(msg._ttsCacheKey);
            }
            if (text.includes('\n')) {
                text.split('\n').filter(line => line.trim()).forEach((line, lineIndex) => {
                    this._removePersistedPhoneCallTtsCache({
                        bubbleId: `${msgId}_${lineIndex}`,
                        caller,
                        provider,
                        voice,
                        text: line.trim()
                    });
                });
                return;
            }
            this._removePersistedPhoneCallTtsCache({ bubbleId: msgId, caller, provider, voice, text });
        });
    }

    releaseInactiveResources() {
        this.clearTtsCache();
        if (this.callTimer) {
            clearInterval(this.callTimer);
            this.callTimer = null;
        }
        if (this.dialingTimer) {
            clearTimeout(this.dialingTimer);
            this.dialingTimer = null;
        }
    }

    _getGlobalTtsVoice() {
        const storage = window.VirtualPhone?.storage || this.app?.storage;
        const provider = String(storage?.get?.('phone-tts-provider') || 'minimax_cn').trim() || 'minimax_cn';
        const scopedVoice = String(storage?.get?.(`phone-tts-${provider}-voice`) || '').trim();
        if (scopedVoice) return scopedVoice;
        if (provider !== 'volcengine') {
            return String(storage?.get?.('phone-tts-voice') || '').trim();
        }
        return '';
    }

    _getGlobalTtsVoiceConfig() {
        const storage = window.VirtualPhone?.storage || this.app?.storage;
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

    _getPhoneCallGenderFallbackTtsVoice(gender = '') {
        const storage = window.VirtualPhone?.storage || this.app?.storage;
        const safeGender = this._normalizeTtsGender(gender);
        const globalConfig = this._getGlobalTtsVoiceConfig();
        if (!safeGender) return globalConfig;

        const provider = String(
            storage?.get?.(`phone-tts-fallback-${safeGender}-provider`)
            || globalConfig.provider
            || 'minimax_cn'
        ).trim() || 'minimax_cn';
        const voice = String(storage?.get?.(`phone-tts-fallback-${safeGender}-voice`) || '').trim();
        if (voice) {
            return { provider, voice, source: `fallback_${safeGender}` };
        }
        return globalConfig;
    }

    _buildPhoneCallTtsCacheKey({ bubbleId = '', caller = '', provider = '', voice = '', text = '' } = {}) {
        return [
            String(bubbleId || '').trim(),
            String(caller || '').trim(),
            String(provider || '').trim(),
            String(voice || '').trim(),
            String(text || '').trim()
        ].join('\u001f');
    }

    _getPhoneCallTtsStorageKey(parts = {}) {
        const raw = this._buildPhoneCallTtsCacheKey(parts);
        let hash = 2166136261;
        for (let i = 0; i < raw.length; i++) {
            hash ^= raw.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return `phone_call_tts_cache_${(hash >>> 0).toString(16)}_${raw.length}`;
    }

    async _blobUrlToDataUrl(url = '') {
        const safeUrl = String(url || '').trim();
        if (!safeUrl || safeUrl.startsWith('data:')) return safeUrl;
        if (!safeUrl.startsWith('blob:')) return '';
        try {
            const response = await fetch(safeUrl);
            if (!response.ok) return '';
            const blob = await response.blob();
            return await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => resolve('');
                reader.readAsDataURL(blob);
            });
        } catch (e) {
            return '';
        }
    }

    _getPersistedPhoneCallTtsCache(parts = {}) {
        const key = this._getPhoneCallTtsStorageKey(parts);
        return String(this.app?.storage?.get?.(key, '') || '').trim();
    }

    _getPersistedPhoneCallTtsCacheByKey(key = '') {
        const safeKey = String(key || '').trim();
        if (!safeKey) return '';
        return String(this.app?.storage?.get?.(safeKey, '') || '').trim();
    }

    async _storePersistedPhoneCallTtsCache(parts = {}, audioUrl = '') {
        const dataUrl = await this._blobUrlToDataUrl(audioUrl);
        if (!dataUrl || !dataUrl.startsWith('data:audio/')) return;
        const key = this._getPhoneCallTtsStorageKey(parts);
        await this.app?.storage?.set?.(key, dataUrl);
    }

    async _storePersistedPhoneCallTtsCacheByKey(key = '', audioUrl = '') {
        const safeKey = String(key || '').trim();
        if (!safeKey) return;
        const dataUrl = await this._blobUrlToDataUrl(audioUrl);
        if (!dataUrl || !dataUrl.startsWith('data:audio/')) return;
        await this.app?.storage?.set?.(safeKey, dataUrl);
    }

    _removePersistedPhoneCallTtsCache(parts = {}) {
        const key = this._getPhoneCallTtsStorageKey(parts);
        this.app?.storage?.remove?.(key);
    }

    _removePersistedPhoneCallTtsCacheByKey(key = '') {
        const safeKey = String(key || '').trim();
        if (!safeKey) return;
        this.app?.storage?.remove?.(safeKey);
    }

    _touchPhoneCallTtsCacheKey(cacheKey = '') {
        if (!cacheKey) return;
        this._phoneCallTtsCacheOrder = this._phoneCallTtsCacheOrder.filter(key => key !== cacheKey);
        this._phoneCallTtsCacheOrder.push(cacheKey);
    }

    _storePhoneCallTtsCache(cacheKey = '', blobUrl = '') {
        if (!cacheKey || !blobUrl) return;
        const existed = this._phoneCallTtsCache.get(cacheKey);
        if (existed && existed !== blobUrl && String(existed).startsWith('blob:')) {
            try { URL.revokeObjectURL(existed); } catch (e) { /* ignore */ }
        }
        this._phoneCallTtsCache.set(cacheKey, blobUrl);
        this._touchPhoneCallTtsCacheKey(cacheKey);

        while (this._phoneCallTtsCacheOrder.length > this._phoneCallTtsCacheLimit) {
            const oldKey = this._phoneCallTtsCacheOrder.shift();
            const oldUrl = this._phoneCallTtsCache.get(oldKey);
            this._phoneCallTtsCache.delete(oldKey);
            if (oldUrl && String(oldUrl).startsWith('blob:')) {
                try { URL.revokeObjectURL(oldUrl); } catch (e) { /* ignore */ }
            }
        }
    }

    _bindCallTtsBubbleClickEvents(messagesDiv) {
        if (!messagesDiv || messagesDiv._phoneCallTtsBound) return;
        messagesDiv._phoneCallTtsBound = true;
        messagesDiv.addEventListener('click', async (e) => {
            const suppressUntil = Number.parseInt(String(messagesDiv.dataset.phoneCallSuppressClickUntil || '0'), 10) || 0;
            if (Date.now() < suppressUntil) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            const bubble = e.target.closest('.phone-call-message-ai');
            if (!bubble) return;

            if (this.currentPlayingBubble === bubble && !this.audioPlayer.paused) {
                this.stopTTS();
                return;
            }

            const allBubbles = Array.from(messagesDiv.querySelectorAll('.phone-call-message-ai'));
            const startIndex = allBubbles.indexOf(bubble);
            if (startIndex < 0) return;

            const roundId = `manual_${Date.now()}`;
            this.currentTtsRound = roundId;
            for (let i = startIndex; i < allBubbles.length; i++) {
                if (this.currentTtsRound !== roundId) break;
                const targetBubble = allBubbles[i];
                const text = String(targetBubble.dataset?.phoneCallTtsText || targetBubble.textContent || '').trim();
                if (!text) continue;
                await this.playTTS(text, targetBubble, {
                    caller: String(targetBubble.dataset?.phoneCallCaller || this.currentCaller || '').trim(),
                    messageId: String(targetBubble.dataset?.msgId || targetBubble.id || '').trim(),
                    storageKey: String(targetBubble.dataset?.phoneCallTtsKey || '').trim()
                });
            }
        });
    }

    async playTTS(text, bubble, options = {}) {
        await this._ensurePhoneWechatDataLoaded();
        const ttsManager = window.VirtualPhone?.ttsManager;
        const callerName = String(options.caller || this.currentCaller || '').trim();
        const messageId = String(options.messageId || bubble?.dataset?.msgId || bubble?.id || '').trim();
        const explicitStorageKey = String(options.storageKey || bubble?.dataset?.phoneCallTtsKey || '').trim();
        const ttsConfig = this._resolveCallerTtsVoice(callerName, { allowGlobalFallback: true });
        const voice = String(ttsConfig?.voice || '').trim();
        const provider = String(ttsConfig?.provider || '').trim();
        const textToSpeak = String(text || '').trim();

        if (!ttsManager) {
            console.warn('📞 [TTS] ttsManager 未初始化');
            return;
        }
        if (!textToSpeak) return;

        try {
            // 停止之前播放的
            if (this.currentPlayingBubble) {
                this.currentPlayingBubble.classList.remove('voice-playing');
            }

            const cacheKey = this._buildPhoneCallTtsCacheKey({
                bubbleId: messageId,
                caller: callerName,
                provider,
                voice,
                text: textToSpeak
            });
            const persistedParts = {
                bubbleId: messageId,
                caller: callerName,
                provider,
                voice,
                text: textToSpeak
            };
            const storageKey = explicitStorageKey || this._getPhoneCallTtsStorageKey(persistedParts);
            let blobUrl = this._phoneCallTtsCache.get(cacheKey) || '';
            if (blobUrl) {
                this._touchPhoneCallTtsCacheKey(cacheKey);
            } else {
                blobUrl = this._getPersistedPhoneCallTtsCacheByKey(storageKey);
                if (!blobUrl) {
                    blobUrl = await ttsManager.requestTTS(textToSpeak, { provider: provider || undefined, voice: voice || undefined });
                    this._storePersistedPhoneCallTtsCacheByKey(storageKey, blobUrl);
                }
                this._storePhoneCallTtsCache(cacheKey, blobUrl);
            }
            if (bubble) bubble.dataset.phoneCallTtsKey = storageKey;
            const targetMsg = this.chatMessages.find(msg => String(msg?._id || '').trim() === messageId);
            if (targetMsg) targetMsg._ttsCacheKey = storageKey;

            // 播放并等待播放完毕
            this.audioPlayer.src = blobUrl;
            this.currentPlayingBubble = bubble;
            if (bubble) bubble.classList.add('voice-playing');

            await new Promise((resolve, reject) => {
                this.audioPlayer.onended = () => {
                    if (bubble) bubble.classList.remove('voice-playing');
                    this.currentPlayingBubble = null;
                    resolve();
                };
                this.audioPlayer.onerror = (e) => {
                    if (bubble) bubble.classList.remove('voice-playing');
                    this.currentPlayingBubble = null;
                    resolve();
                };
                this.audioPlayer.play().catch(() => resolve());
            });

        } catch (error) {
            console.error('TTS Error:', error);
            if (bubble) bubble.classList.remove('voice-playing');
        }
    }

    // ========================================
    // 工具方法
    // ========================================

    _setPhoneShellContent(html, viewId, { replaceViewIds = [] } = {}) {
        const idsToReplace = Array.isArray(replaceViewIds)
            ? replaceViewIds.map(id => String(id || '').trim()).filter(Boolean)
            : [];

        if (idsToReplace.length > 0 && this.app?.phoneShell) {
            const shell = this.app.phoneShell;
            const replacementSet = new Set(idsToReplace);
            const history = Array.isArray(shell.viewHistory) ? shell.viewHistory : [];
            const firstReplaceIndex = history.findIndex(item => replacementSet.has(String(item?.id || '')));
            if (firstReplaceIndex !== -1) {
                shell.viewHistory = [
                    ...history.slice(0, firstReplaceIndex),
                    { id: viewId }
                ];
            }

            const stack = shell.screen?.querySelector?.('.view-stack-container');
            idsToReplace.forEach(id => {
                stack?.querySelector?.(`[data-view-id="${this._escapeCssAttr(id)}"]`)?.remove?.();
            });
        }

        this.app.phoneShell.setContent(html, viewId);
    }

    _getSystemWallpaperShellBackgroundConfig(baseClass = 'phone-call-main') {
        let wallpaper = '';
        try {
            wallpaper = String(window.VirtualPhone?.imageManager?.getWallpaper?.() || '').trim();
        } catch (e) {
            wallpaper = '';
        }
        if (!wallpaper) {
            try {
                wallpaper = String(this.app?.storage?.get?.('phone-wallpaper') || '').trim();
            } catch (e) {
                wallpaper = '';
            }
        }
        if (!wallpaper) {
            wallpaper = String(PHONE_CONFIG.defaultWallpaper || '').trim();
        }

        if (!wallpaper) {
            return {
                appClass: baseClass,
                appStyle: ''
            };
        }

        return {
            appClass: `${baseClass} phone-call-wallpaper-shell`,
            appStyle: `background-image: url('${this._escapeAttr(wallpaper)}'); background-size: cover; background-position: center;`
        };
    }

    _addCallRecord(callerName, status, duration, transcript, timeInfo) {
        const timeManager = window.VirtualPhone?.timeManager;
        const now = timeInfo || (timeManager
            ? timeManager.getCurrentStoryTime()
            : { time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), date: '', weekday: '' });

        this.app.phoneCallData.addCallRecord({
            id: Date.now().toString(),
            caller: callerName,
            time: now.time || '',
            date: now.date || '',
            weekday: now.weekday || '',
            duration: duration,
            status: status,
            transcript: transcript || []
        });
    }

    _resolveWechatContact(callerName) {
        try {
            const wechatData = this._getPhoneWechatData();
            if (!wechatData) return null;
            return wechatData.findContactByNameLoose?.(callerName, { includeChats: true })
                || wechatData.getContactByName?.(callerName)
                || null;
        } catch (e) {
            return null;
        }
    }

    _normalizeWechatLookupName(value = '') {
        return String(value || '')
            .trim()
            .replace(/\s+/g, '')
            .replace(/[（(][^（）()]*[）)]/g, '')
            .toLowerCase();
    }

    _formatWechatMessageForPhonePrompt(message, chat = null) {
        if (!message || typeof message !== 'object') return '';
        if (message.hiddenFromPrompt === true || message.isTimeMarker === true || message.type === 'time_marker') return '';

        const wechatFormatter = window.VirtualPhone?.wechatApp?.chatView?._formatMessageContentForPrompt;
        if (typeof wechatFormatter === 'function') {
            try {
                const formatted = wechatFormatter.call(window.VirtualPhone.wechatApp.chatView, message, chat);
                if (formatted) return String(formatted).trim();
            } catch (e) {
                console.warn('📞 [通话] 复用微信消息格式化失败，已使用本地格式:', e);
            }
        }

        const type = String(message.type || 'text').trim();
        const content = String(message.content || '').trim();
        if (type === 'text' || type === 'system') return content;
        if (type === 'image') return '[图片]';
        if (type === 'image_prompt') return content || '[图片]';
        if (type === 'sticker') return `[表情包]（${message.keyword || content || '表情包'}）`;
        if (type === 'voice') return `[语音] ${String(message.voiceText || content || '').trim()}`.trim();
        if (type === 'location') return `[定位]（${message.locationText || message.locationAddress || content || '未知位置'}）`;
        if (type === 'transfer') {
            const status = message.status === 'received' ? '已收款' : (message.status === 'refunded' ? '已退回' : '未收款');
            return `[转账 ¥${message.amount || ''}]（状态：${status}）`;
        }
        if (type === 'redpacket') {
            const status = message.status === 'opened' ? '已领取' : (message.status === 'refunded' ? '已退回' : '未领取');
            return `[红包 ¥${message.amount || ''}]（状态：${status}）`;
        }
        if (type === 'call_record') {
            const callType = message.callType === 'video' ? '视频通话' : '语音通话';
            const status = message.status === 'answered'
                ? `通话时长 ${message.duration || '未知'}`
                : (message.status === 'rejected' || message.status === 'declined')
                    ? '对方已拒绝'
                    : message.status === 'cancelled'
                        ? '用户已取消'
                        : '未接听';
            return `[微信${callType} - ${status}]`;
        }
        return content || `[${type}]`;
    }

    async _buildWechatHistoryContextForCall(callerName, userName = '用户') {
        const callerKey = this._normalizeWechatLookupName(callerName);
        if (!callerKey) return '';

        try {
            const wechatData = await this._ensurePhoneWechatDataLoaded();
            if (!wechatData) return '';

            const contacts = typeof wechatData.getContacts === 'function' ? (wechatData.getContacts() || []) : [];
            const contact = contacts.find(item => [item?.name, item?.remark, item?.nickname]
                .some(value => this._normalizeWechatLookupName(value) === callerKey)) || null;
            const chatList = typeof wechatData.getChatList === 'function' ? (wechatData.getChatList() || []) : [];
            const chat = (contact?.id && typeof wechatData.getChatByContactId === 'function'
                ? wechatData.getChatByContactId(contact.id)
                : null)
                || chatList.find(item => item?.type !== 'group'
                    && [item?.name, item?.remark, item?.nickname]
                        .some(value => this._normalizeWechatLookupName(value) === callerKey))
                || null;
            if (!chat || chat.type === 'group' || typeof wechatData.getMessages !== 'function') return '';

            const storage = window.VirtualPhone?.storage || this.app?.storage;
            const rawLimit = storage?.get?.('wechat-single-chat-limit');
            const parsedLimit = Number.parseInt(rawLimit, 10);
            const messageLimit = rawLimit === undefined || rawLimit === null || rawLimit === '' || !Number.isFinite(parsedLimit)
                ? 200
                : Math.max(0, Math.min(9999, parsedLimit));
            if (messageLimit <= 0) return '';

            const allMessages = wechatData.getMessages(chat.id) || [];
            let totalLines = 0;
            let startIndex = allMessages.length;
            for (let index = allMessages.length - 1; index >= 0; index--) {
                const message = allMessages[index];
                if (message?.hiddenFromPrompt === true || message?.isTimeMarker === true || message?.type === 'time_marker') continue;
                const transcriptLines = message?.type === 'call_record' && Array.isArray(message.transcript)
                    ? message.transcript.length
                    : 0;
                totalLines += transcriptLines + 1;
                startIndex = index;
                if (totalLines >= messageLimit) break;
            }

            const recentMessages = allMessages.slice(startIndex);
            if (recentMessages.length === 0) return '';

            const contactName = String(chat.name || contact?.name || callerName || '当前联系人').trim();
            let text = `【💬 与 ${contactName} 的微信单聊记录】\n`;
            text += '以下内容来自微信中同一联系人的单聊，仅作为本次电话交流的既有背景；不要逐字复述。\n\n';
            let lastDate = '';
            let hasContent = false;

            recentMessages.forEach(message => {
                if (message?.hiddenFromPrompt === true || message?.isTimeMarker === true || message?.type === 'time_marker') return;
                const content = this._formatWechatMessageForPhonePrompt(message, chat);
                const transcript = message?.type === 'call_record' && Array.isArray(message.transcript)
                    ? message.transcript
                    : [];
                if (!content && transcript.length === 0) return;

                if (message.date && message.date !== lastDate) {
                    text += `--- ${message.date} ---\n`;
                    lastDate = message.date;
                }

                const time = message.time ? `[${message.time}] ` : '';
                const speaker = message.from === 'me'
                    ? userName
                    : (message.from === 'system' || message.type === 'system' ? '系统' : contactName);
                if (content) {
                    text += `${time}${speaker}: ${content}\n`;
                    hasContent = true;
                }
                transcript.forEach(line => {
                    const lineText = String(line?.text || '').trim();
                    if (!lineText) return;
                    const lineSpeaker = line?.from === 'me' ? userName : contactName;
                    text += `  [微信通话记录] ${lineSpeaker}: ${lineText}\n`;
                    hasContent = true;
                });
            });

            return hasContent ? text.trim() : '';
        } catch (error) {
            console.warn('📞 [通话] 注入微信单聊记录失败:', error);
            return '';
        }
    }

    _getPhoneWechatData() {
        return window.VirtualPhone?.wechatApp?.wechatData || window.VirtualPhone?.cachedWechatData || null;
    }

    _ensurePhoneWechatDataLoaded({ rerenderContacts = false } = {}) {
        if (this._getPhoneWechatData()) return Promise.resolve(this._getPhoneWechatData());
        if (this.phoneWechatDataLoading) return this.phoneWechatDataLoading;
        if (this.phoneWechatDataLoadAttempted) return Promise.resolve(null);

        this.phoneWechatDataLoadAttempted = true;
        this.phoneWechatDataLoading = import('../wechat/wechat-data.js')
            .then(module => {
                const storage = this.app?.storage || window.VirtualPhone?.storage;
                if (!storage || !module?.WechatData) return null;
                const wechatData = window.VirtualPhone?.wechatApp?.wechatData || new module.WechatData(storage);
                if (window.VirtualPhone && !window.VirtualPhone.cachedWechatData) {
                    window.VirtualPhone.cachedWechatData = wechatData;
                }
                return wechatData;
            })
            .catch(error => {
                console.warn('📞 [通话] 静默加载微信数据失败:', error);
                return null;
            })
            .finally(() => {
                this.phoneWechatDataLoading = null;
                if (rerenderContacts && this.currentView === 'contacts') {
                    this.renderContacts();
                }
            });

        return this.phoneWechatDataLoading;
    }

    _resolveCallerTtsVoice(callerName, { allowGlobalFallback = true } = {}) {
        const globalConfig = this._getGlobalTtsVoiceConfig();
        try {
            const wechatData = this._getPhoneWechatData();
            if (wechatData?.resolveTtsVoiceByName) {
                const resolved = wechatData.resolveTtsVoiceByName(callerName, { includeChats: true });
                const boundVoice = String(resolved?.voice || '').trim();
                if (boundVoice) {
                    return {
                        voice: boundVoice,
                        provider: String(resolved?.provider || globalConfig.provider || '').trim()
                    };
                }

                const resolvedContact = resolved?.contact || null;
                const looseContact = wechatData?.findContactByNameLoose?.(callerName, { includeChats: true }) || null;
                const genderCandidates = [
                    resolvedContact?.gender,
                    looseContact?.gender,
                    wechatData?.getContactGender?.(resolvedContact?.id || ''),
                    wechatData?.getContactGender?.(resolvedContact?.name || ''),
                    wechatData?.getContactGender?.(looseContact?.id || ''),
                    wechatData?.getContactGender?.(looseContact?.name || ''),
                    wechatData?.getContactGender?.(callerName || '')
                ];
                const resolvedGender = this._normalizeTtsGender(
                    genderCandidates.find(value => this._normalizeTtsGender(value)) || ''
                );
                const fallback = this._getPhoneCallGenderFallbackTtsVoice(resolvedGender);
                return {
                    voice: String(fallback?.voice || '').trim(),
                    provider: String(fallback?.provider || globalConfig.provider || '').trim()
                };
            }
        } catch (e) {
            // ignore
        }
        return {
            voice: allowGlobalFallback ? String(globalConfig.voice || '').trim() : '',
            provider: String(globalConfig.provider || '').trim()
        };
    }

    _getCallerAvatar(callerName) {
        // 尝试从微信联系人匹配头像
        try {
            const contact = this._resolveWechatContact(callerName);
            const avatar = this._normalizeWechatAvatarPath(contact?.avatar);
            if (avatar && avatar !== '👤') {
                return `<img src="${this._escapeAttr(avatar)}" style="width:100%;height:100%;object-fit:cover;">`;
            }
            const rawAvatar = String(contact?.avatar || '').trim();
            if (rawAvatar && rawAvatar !== '👤') return this._escapeHtml(rawAvatar);

            const wechatData = this._getPhoneWechatData();
            const autoAvatar = this._normalizeWechatAvatarPath(
                wechatData?.getContactAutoAvatar?.(contact?.id || callerName)
                || wechatData?.getContactAutoAvatar?.(callerName)
                || ''
            );
            if (autoAvatar) {
                return `<img src="${this._escapeAttr(autoAvatar)}" style="width:100%;height:100%;object-fit:cover;">`;
            }

            const autoMap = typeof wechatData?.getContactAutoAvatarMap === 'function'
                ? wechatData.getContactAutoAvatarMap()
                : null;
            if (autoMap && typeof autoMap === 'object') {
                const keySet = new Set([contact?.id, contact?.name, callerName].filter(Boolean).map(v => String(v).trim()));
                for (const key of keySet) {
                    const mappedAvatar = this._normalizeWechatAvatarPath(autoMap[key]);
                    if (mappedAvatar) {
                        return `<img src="${this._escapeAttr(mappedAvatar)}" style="width:100%;height:100%;object-fit:cover;">`;
                    }
                }
            }
        } catch (e) { /* ignore */ }
        return '👤';
    }

    _normalizeWechatAvatarPath(value) {
        const raw = String(value || '').trim();
        if (!raw || raw === '👤') return '';
        if (/^(?:https?:\/\/|\/|data:image|blob:)/i.test(raw)) return raw;
        const cleaned = raw.replace(/^['"]|['"]$/g, '').replace(/^\.?\/*/, '').replace(/^apps\/wechat\/avatars\//i, '').replace(/^wechat\/avatars\//i, '').replace(/^avatars\//i, '');
        if (!cleaned || /\s/.test(cleaned)) return '';
        if (/^(?:male|female)\d+$/i.test(cleaned)) {
            return new URL(`../wechat/avatars/${cleaned}.png`, import.meta.url).href;
        }
        if (/^[a-z0-9._-]+\.(?:png|jpg|jpeg|webp|gif)$/i.test(cleaned)) {
            return new URL(`../wechat/avatars/${cleaned}`, import.meta.url).href;
        }
        return '';
    }

    _getPromptManager() {
        return window.VirtualPhone?.promptManager || null;
    }

    _buildCallMessageId(prefix = 'msg') {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    _removeCallMessageDeleteButtons(scope = null) {
        const root = scope && typeof scope.querySelectorAll === 'function'
            ? scope
            : (document.querySelector('.phone-view-current .phone-call-active') || document);
        root.querySelectorAll?.('.phone-call-msg-delete-btn').forEach(btn => btn.remove());
    }

    _bindCallMessageDeleteEvents(messagesDiv, { onChanged } = {}) {
        if (!messagesDiv || messagesDiv._phoneCallDeleteBound) return;
        messagesDiv._phoneCallDeleteBound = true;

        let pressTimer = null;
        let longPressFired = false;
        let startX = 0;
        let startY = 0;

        const clearPress = () => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        };

        const openDeleteBtnForBubble = (bubble) => {
            if (!bubble || !bubble.isConnected) return;
            this._removeCallMessageDeleteButtons(messagesDiv);

            const msgId = String(bubble.dataset.msgId || '').trim();
            if (!msgId) return;

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'phone-call-msg-delete-btn';
            deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
            deleteBtn.setAttribute('aria-label', '删除此条');

            let deleting = false;
            const executeDelete = (ev) => {
                ev?.preventDefault?.();
                ev?.stopPropagation?.();
                if (deleting) return;
                deleting = true;
                const targetMsg = this.chatMessages.find(msg => String(msg?._id || '').trim() === msgId);
                if (targetMsg && targetMsg.from !== 'me') {
                    if (targetMsg._ttsCacheKey) this._removePersistedPhoneCallTtsCacheByKey(targetMsg._ttsCacheKey);
                    else this._removePersistedPhoneCallTtsCache({
                        bubbleId: msgId,
                        caller: String(this.currentCaller || targetMsg.from || '').trim(),
                        ...this._resolveCallerTtsVoice(String(this.currentCaller || targetMsg.from || '').trim(), { allowGlobalFallback: true }),
                        text: String(targetMsg.text || bubble.dataset.phoneCallTtsText || '').trim()
                    });
                }
                this.chatMessages = this.chatMessages.filter(msg => String(msg?._id || '').trim() !== msgId);
                bubble.remove();
                deleteBtn.remove();
                onChanged?.();
            };

            deleteBtn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
            deleteBtn.addEventListener('touchend', executeDelete, { passive: false });
            deleteBtn.addEventListener('click', executeDelete);

            bubble.style.position = 'relative';
            bubble.appendChild(deleteBtn);
        };

        const startPress = (bubble, x, y) => {
            startX = x;
            startY = y;
            longPressFired = false;
            clearPress();
            pressTimer = setTimeout(() => {
                pressTimer = null;
                longPressFired = true;
                messagesDiv.dataset.phoneCallSuppressClickUntil = String(Date.now() + 500);
                openDeleteBtnForBubble(bubble);
            }, 520);
        };

        const movePress = (x, y) => {
            if (!pressTimer) return;
            const dx = Math.abs(x - startX);
            const dy = Math.abs(y - startY);
            if (dx > 18 || dy > 18) {
                clearPress();
            }
        };

        const endPress = () => {
            clearPress();
            if (longPressFired) {
                messagesDiv.dataset.phoneCallSuppressClickUntil = String(Date.now() + 500);
                longPressFired = false;
            }
        };

        messagesDiv.addEventListener('touchstart', (e) => {
            const bubble = e.target?.closest?.('.phone-call-message-ai, .phone-call-message-user');
            if (!bubble || !messagesDiv.contains(bubble)) return;
            if (!e.touches || e.touches.length === 0) return;
            const t = e.touches[0];
            startPress(bubble, t.clientX, t.clientY);
        }, { passive: true });

        messagesDiv.addEventListener('touchmove', (e) => {
            if (!e.touches || e.touches.length === 0) return;
            const t = e.touches[0];
            movePress(t.clientX, t.clientY);
        }, { passive: true });

        messagesDiv.addEventListener('touchend', endPress);
        messagesDiv.addEventListener('touchcancel', () => {
            clearPress();
            longPressFired = false;
        });

        messagesDiv.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            const bubble = e.target?.closest?.('.phone-call-message-ai, .phone-call-message-user');
            if (!bubble || !messagesDiv.contains(bubble)) return;
            startPress(bubble, e.clientX, e.clientY);
        });

        messagesDiv.addEventListener('mousemove', (e) => movePress(e.clientX, e.clientY));
        messagesDiv.addEventListener('mouseup', endPress);
        messagesDiv.addEventListener('mouseleave', () => {
            clearPress();
            longPressFired = false;
        });

        messagesDiv.addEventListener('contextmenu', (e) => {
            const bubble = e.target?.closest?.('.phone-call-message-ai, .phone-call-message-user');
            if (!bubble || !messagesDiv.contains(bubble)) return;
            e.preventDefault();
            e.stopPropagation();
            messagesDiv.dataset.phoneCallSuppressClickUntil = String(Date.now() + 500);
            openDeleteBtnForBubble(bubble);
        });

        messagesDiv.addEventListener('click', (e) => {
            if (!e.target?.closest?.('.phone-call-msg-delete-btn') && !e.target?.closest?.('.phone-call-message-ai, .phone-call-message-user')) {
                this._removeCallMessageDeleteButtons(messagesDiv);
            }
        });
    }

    _cleanAIResponse(response, callerName) {
        if (!response) return ['...'];

        let cleaned = response.trim();

        // 提取 <Call> 标签内容
        const callMatch = cleaned.match(/<Call>([\s\S]*?)<\/Call>/i);
        if (callMatch) {
            cleaned = callMatch[1].trim();
        }

        // 去掉 ---姓名--- 行
        cleaned = cleaned.replace(/^---.*---\s*$/gm, '');

        // 清理残留的 <Call>/<Phone> 标签
        cleaned = cleaned.replace(/<\/?Call>/gi, '');
        cleaned = cleaned.replace(/<\/?Phone>/gi, '');

        // 清理旧格式标记
        cleaned = cleaned.replace(/\[手机来电通话\][^:：]*[：:]\s*/g, '');
        cleaned = cleaned.replace(/^from\s+\S+[：:]\s*/gmi, '');
        cleaned = cleaned.replace(new RegExp(`^${callerName}[：:]\\s*`, 'gmi'), '');
        cleaned = cleaned.replace(/\|\|\|/g, '');

        // 按换行拆分为多条消息，过滤空行 + 去重
        const lines = cleaned.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
        const deduped = [];
        const seen = new Set();
        lines.forEach((line) => {
            const key = String(line || '').replace(/\s+/g, ' ').trim();
            if (!key) return;
            if (seen.has(key)) return;
            seen.add(key);
            deduped.push(line);
        });

        return deduped.length > 0 ? deduped : ['...'];
    }

    _cleanCallRejectReason(text, callerName = '') {
        const safeCaller = String(callerName || '').trim();
        let cleaned = String(text || '').trim();
        cleaned = cleaned.replace(/<Call>|<\/Call>|<Phone>|<\/Phone>/gi, '').trim();
        cleaned = cleaned.replace(/\[拒绝电话\]\s*[：:]\s*/gi, '').trim();
        cleaned = cleaned.replace(/^---[\s\S]*?---\s*/gm, '').trim();
        if (safeCaller) {
            cleaned = cleaned.replace(new RegExp(`^${safeCaller.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[：:]\\s*`, 'i'), '').trim();
        }
        cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
        return cleaned || (safeCaller ? `${safeCaller} 暂时不方便接听。` : '对方暂时不方便接听。');
    }

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    _escapeAttr(text) {
        return this._escapeHtml(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    _escapeCssAttr(text) {
        const value = String(text || '');
        if (window.CSS?.escape) return window.CSS.escape(value);
        return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/]/g, '\\]');
    }
}
