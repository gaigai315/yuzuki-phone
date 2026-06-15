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

export class PhoneCallView {
    constructor(app) {
        this.app = app;
        this.currentView = 'main'; // 'main' | 'contacts' | 'dialing' | 'incoming' | 'active' | 'transcript' | 'settings'
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
        this.contactSelectionMode = false;
        this.selectedContactIds = new Set();
        this.contactAddPanelOpen = false;
        this.phoneWechatDataLoading = null;
        this.phoneWechatDataLoadAttempted = false;
    }

    render() {
        switch (this.currentView) {
            case 'contacts':
                this.renderContacts();
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

        // TTS开关
        const autoTTS = this.app.storage.get('phone-call-auto-tts') || false;

        const html = `
            <div class="phone-call-main">
                <div class="phone-call-main-header">
                    <div class="phone-call-main-title">通话</div>
                    <div style="display: flex; align-items: center; gap: 8px; margin-left: auto;">
                        <label class="phone-call-toggle">
                            <input type="checkbox" id="phone-call-tts-toggle-main" ${autoTTS ? 'checked' : ''}>
                            <span class="phone-call-toggle-slider"></span>
                        </label>
                        <span style="font-size: 12px; color: var(--phone-secondary-text, #999);">TTS</span>
                        <button class="phone-call-settings-btn" id="phone-call-open-contacts" title="联系人">
                            <i class="fa-solid fa-address-book"></i>
                        </button>
                        <button class="phone-call-settings-btn" id="phone-call-open-settings">
                            <i class="fa-solid fa-gear"></i>
                        </button>
                    </div>
                </div>
                ${listHtml}
            </div>
        `;

        this.app.phoneShell.setContent(html, 'phone-main');

        // 绑定TTS开关
        document.getElementById('phone-call-tts-toggle-main')?.addEventListener('change', (e) => {
            this.app.storage.set('phone-call-auto-tts', e.target.checked);
        });

        document.getElementById('phone-call-open-contacts')?.addEventListener('click', () => {
            this.renderContacts();
        });

        // 绑定设置按钮
        document.getElementById('phone-call-open-settings')?.addEventListener('click', () => {
            this.returnViewAfterSettings = this.currentView || 'main';
            this.renderSettings();
        });

        this._bindCallHistoryEvents(history);

        // 点击空白处关闭删除按钮
        document.querySelector('.phone-call-main')?.addEventListener('click', (e) => {
            if (!e.target.closest('.phone-call-history-item')) {
                document.querySelectorAll('.phone-call-delete-btn').forEach(btn => btn.remove());
            }
        });
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

        const html = `
            <div class="phone-call-contacts">
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
            this.renderMain();
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

            this._addCallRecord(safeName, 'missed', 0, []);
            this.app.phoneShell.showNotification('未接通', decision.reason || `${safeName} 未接听`, '📵');
            this.renderContacts();
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

        const html = `
            <div class="phone-call-settings">
                <div class="phone-call-settings-header">
                    <button class="phone-call-settings-back" id="phone-call-settings-back">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div class="phone-call-settings-title">通话设置</div>
                </div>
                <div class="phone-call-settings-body">
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
                                <div style="margin-top:6px; font-size:11px; color:var(--phone-secondary-text, #999); line-height:1.5;">
                                    可用变量：<code>{{user}}</code>、<code>{{callerName}}</code>（同义：<code>{{caller}}</code> / <code>{{char}}</code>）
                                </div>
                                <div class="phone-call-prompt-btns">
                                    <button class="phone-call-prompt-btn phone-call-prompt-btn-save" id="phone-call-save-call">保存</button>
                                    <button class="phone-call-prompt-btn phone-call-prompt-btn-reset" id="phone-call-reset-call">恢复默认</button>
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

        // 返回（用 onclick 覆盖式绑定，防止 DOM Diffing 导致重复监听）
        const backBtn = query('#phone-call-settings-back');
        if (backBtn) backBtn.onclick = () => this._returnFromSettings();

        // 保存通话提示词
        const saveBtn = query('#phone-call-save-call');
        if (saveBtn) saveBtn.onclick = () => {
            const content = query('#phone-call-call-prompt')?.value || '';
            if (pm) pm.updateActivePromptUserPreset?.('phone', 'call', content) ?? pm.updatePrompt('phone', 'call', content);
            this.app.phoneShell.showNotification('已保存', '通话提示词已更新', '✅');
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

        // 移动端手势豁免：在提示词框内滑动/选字时，不让外层手机壳手势抢事件
        const textarea = query('#phone-call-call-prompt');
        if (textarea) {
            textarea.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
            textarea.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
            textarea.addEventListener('touchend', (e) => e.stopPropagation(), { passive: true });
        }
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
                    <input type="text" class="phone-call-input" id="phone-call-input" placeholder="发送消息...">
                    <button class="phone-call-regen-btn" id="phone-call-regen" title="重新生成" style="display:none; color: rgba(255,255,255,0.7);">
                        <i class="fa-solid fa-rotate-right" style="color: inherit;"></i>
                    </button>
                    <button class="phone-call-send-btn" id="phone-call-send" style="color: #34c759;">
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
            isCallSending = true;
            setCallStatus('red');
            try {
                await requestAIReply('【系统提示】电话已接通。现在是用户主动拨打给你，你必须先开口说第一句话，像真实电话接通后的自然开场。');
            } finally {
                isCallSending = false;
                setCallStatus('green');
            }
        };

        // 发送消息
        const sendMessage = async () => {
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
        const phoneInput = document.getElementById('phone-call-input');
        const phoneSendBtn = document.getElementById('phone-call-send');

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
            if (isHandlingCallSend) return;
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

            const messages = [
                {
                    role: 'system',
                    content: [
                        '【主动拨打电话接听判定】',
                        `${userName} 正在主动拨打 ${callRoleName} 的电话。`,
                        `你只需要判断 ${callRoleName} 此刻是否会接听电话。`,
                        '必须结合角色性格、关系、当前剧情、情绪和场景判断。',
                        '只输出一行 JSON，不要解释，不要输出代码块。',
                        '格式：{"answer":"yes","reason":"简短原因"} 或 {"answer":"no","reason":"简短原因"}'
                    ].join('\n'),
                    isPhoneMessage: true
                }
            ];

            if (recentChat) {
                messages.push({
                    role: 'system',
                    content: `【最近剧情】\n${recentChat}`,
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
                max_tokens: 120
            });
            if (!result.success) throw new Error(result.error || '接听判定失败');

            const raw = String(result.summary || result.content || result.text || '').trim();
            const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
            let parsed = null;
            try {
                parsed = JSON.parse(jsonText);
            } catch (e) {
                const negative = /不接|拒接|没接|挂断|no|false|decline|reject/i.test(raw);
                return { answered: !negative, reason: negative ? `${callRoleName} 暂时没有接听` : '' };
            }

            const answer = String(parsed?.answer || parsed?.answered || '').toLowerCase();
            const answered = parsed?.answered === true
                || ['yes', 'true', '接听', '会接', '接'].includes(answer)
                || (answer !== 'no' && answer !== 'false' && /接听|会接/.test(String(parsed?.answer || '')));
            return {
                answered,
                reason: String(parsed?.reason || '').trim()
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
                        let worldInfo = '【世界书/角色书信息】\n';
                        entries.forEach(entry => {
                            if (entry.content && entry.enabled !== false) {
                                const content = String(entry.content || '');
                                worldInfo += `${content}\n---\n`;
                            }
                        });
                        messages.push({
                            role: 'system',
                            content: worldInfo,
                            isPhoneMessage: true
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

            messages.push({
                role: 'system',
                content: [
                    '【通话身份锁定】',
                    `你必须严格根据角色设定，扮演“${callRoleName}”与${userName}通话。`,
                    `当前来电方姓名：${callRoleName}。`,
                    '严禁切换成其他角色名称回复，严禁使用不确定的“你/某人/角色A/B”代称。'
                ].join('\n'),
                isPhoneMessage: true
            });

            // ========================================
            // 5️⃣ 通话提示词（phone.call）
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
            // 6️⃣ 通话聊天记录（最近 phone-call-limit 条）
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
            // 7️⃣ 当前用户消息
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
