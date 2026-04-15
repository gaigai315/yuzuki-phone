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

export class PhoneCallView {
    constructor(app) {
        this.app = app;
        this.currentView = 'main'; // 'main' | 'incoming' | 'active' | 'transcript' | 'settings'
        this.callTimer = null;
        this.callDuration = 0;
        this.chatMessages = [];
        this.currentCaller = '';
        this.audioPlayer = new Audio();
        this.currentPlayingBubble = null;
    }

    render() {
        switch (this.currentView) {
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
                const isMissed = record.status === 'missed' || record.status === 'rejected';
                const missedClass = isMissed ? 'phone-call-missed' : '';
                const icon = isMissed ? '📵' : '📞';
                const statusText = record.status === 'missed' ? '未接' :
                    record.status === 'rejected' ? '已拒绝' : '已接通';
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

        // 绑定设置按钮
        document.getElementById('phone-call-open-settings')?.addEventListener('click', () => {
            this.renderSettings();
        });

        // 绑定通话记录点击事件 + 长按删除
        const reversedHistory = [...history].reverse();
        document.querySelectorAll('.phone-call-history-item').forEach(item => {
            const idx = parseInt(item.dataset.recordIdx);
            const record = reversedHistory[idx];
            if (!record) return;

            // 点击：已接通的查看聊天记录
            if (record.status === 'answered' && record.transcript && record.transcript.length > 0) {
                item.addEventListener('click', (e) => {
                    // 如果删除按钮可见，点击先关闭删除按钮
                    if (item.querySelector('.phone-call-delete-btn')) return;
                    this.renderTranscript(record);
                });
            }

            // 长按：弹出删除按钮
            let longPressTimer = null;
            item.addEventListener('touchstart', (e) => {
                longPressTimer = setTimeout(() => {
                    // 先清除其他已显示的删除按钮
                    document.querySelectorAll('.phone-call-delete-btn').forEach(btn => btn.remove());
                    // 创建删除按钮
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'phone-call-delete-btn';
                    deleteBtn.textContent = '删除';
                    deleteBtn.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        this.app.phoneCallData.deleteCallRecord(record.id);
                        this.renderMain();
                    });
                    item.style.position = 'relative';
                    item.appendChild(deleteBtn);
                }, 600);
            });
            item.addEventListener('touchend', () => clearTimeout(longPressTimer));
            item.addEventListener('touchmove', () => clearTimeout(longPressTimer));

            // 鼠标端长按（PC兼容）
            item.addEventListener('mousedown', (e) => {
                longPressTimer = setTimeout(() => {
                    document.querySelectorAll('.phone-call-delete-btn').forEach(btn => btn.remove());
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'phone-call-delete-btn';
                    deleteBtn.textContent = '删除';
                    deleteBtn.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        this.app.phoneCallData.deleteCallRecord(record.id);
                        this.renderMain();
                    });
                    item.style.position = 'relative';
                    item.appendChild(deleteBtn);
                }, 600);
            });
            item.addEventListener('mouseup', () => clearTimeout(longPressTimer));
            item.addEventListener('mouseleave', () => clearTimeout(longPressTimer));
        });

        // 点击空白处关闭删除按钮
        document.querySelector('.phone-call-main')?.addEventListener('click', (e) => {
            if (!e.target.closest('.phone-call-history-item')) {
                document.querySelectorAll('.phone-call-delete-btn').forEach(btn => btn.remove());
            }
        });
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
            record.transcript.forEach(msg => {
                const isUser = msg.from === 'me';
                const cssClass = isUser ? 'phone-call-message-user' : 'phone-call-message-ai';
                if (!isUser && msg.text && msg.text.includes('\n')) {
                    // AI消息按行拆分为多个气泡
                    msg.text.split('\n').filter(l => l.trim()).forEach(line => {
                        messagesHtml += `<div class="${cssClass}">${this._escapeHtml(line.trim())}</div>`;
                    });
                } else {
                    messagesHtml += `<div class="${cssClass}">${this._escapeHtml(msg.text)}</div>`;
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
    }

    // ========================================
    // 设置界面（通话提示词编辑）
    // ========================================
    renderSettings() {
        this.currentView = 'settings';

        const callPrompt = this._getPromptManager()?.getPromptForFeature('phone', 'call') || '';

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
                        <textarea class="phone-call-prompt-textarea" id="phone-call-call-prompt" placeholder="通话中回复规则...">${this._escapeHtml(callPrompt)}</textarea>
                        <div class="phone-call-prompt-btns">
                            <button class="phone-call-prompt-btn phone-call-prompt-btn-save" id="phone-call-save-call">保存</button>
                            <button class="phone-call-prompt-btn phone-call-prompt-btn-reset" id="phone-call-reset-call">恢复默认</button>
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

        // 返回（用 onclick 覆盖式绑定，防止 DOM Diffing 导致重复监听）
        const backBtn = document.getElementById('phone-call-settings-back');
        if (backBtn) backBtn.onclick = () => this.renderMain();

        // 保存通话提示词
        const saveBtn = document.getElementById('phone-call-save-call');
        if (saveBtn) saveBtn.onclick = () => {
            const content = document.getElementById('phone-call-call-prompt')?.value || '';
            if (pm) pm.updatePrompt('phone', 'call', content);
            this.app.phoneShell.showNotification('已保存', '通话提示词已更新', '✅');
        };

        // 恢复通话默认
        const resetBtn = document.getElementById('phone-call-reset-call');
        if (resetBtn) resetBtn.onclick = () => {
            if (pm) {
                const defaults = pm.getDefaultPrompts();
                const defaultContent = defaults.phone?.call?.content || '';
                pm.updatePrompt('phone', 'call', defaultContent);
                const textarea = document.getElementById('phone-call-call-prompt');
                if (textarea) textarea.value = defaultContent;
                this.app.phoneShell.showNotification('已恢复', '通话提示词已恢复默认', '✅');
            }
        };
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
    renderActiveCall(callerName) {
        this.currentView = 'active';
        this.currentCaller = callerName;
        this.callDuration = 0;
        this.chatMessages = [];

        const avatarHtml = this._getCallerAvatar(callerName);

        const html = `
            <div class="phone-call-active">
                <div class="phone-call-active-header">
                    <div class="phone-call-active-name">${callerName}</div>
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

        this.app.phoneShell.setContent(html, 'phone-active');

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
                    messagesDiv.insertAdjacentHTML('beforeend',
                        `<div class="phone-call-message-ai" id="${bubbleId}">${this._escapeHtml(line)}</div>`
                    );
                    bubbleIds.push(bubbleId);
                }
                messagesDiv.scrollTop = messagesDiv.scrollHeight;

                // 合并为完整文本存入聊天记录
                const fullReply = aiLines.join('\n');
                this.chatMessages.push({ from: callerName, text: fullReply });
                updateRegenBtn();

                // 自动TTS：逐条播放
                const autoTTS = this.app.storage.get('phone-call-auto-tts');
                if (autoTTS) {
                    for (let i = 0; i < aiLines.length; i++) {
                        const bubble = document.getElementById(bubbleIds[i]);
                        if (bubble) {
                            await this.playTTS(aiLines[i], bubble);
                        }
                    }
                }

            } catch (error) {
                console.error('❌ 通话消息发送失败:', error);
                document.getElementById('phone-call-typing')?.remove();
                messagesDiv.insertAdjacentHTML('beforeend',
                    `<div class="phone-call-message-ai" style="opacity:0.5;">...</div>`
                );
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
                this.chatMessages.push({ from: callerName, text: '...' });
                updateRegenBtn();
            }
        };

        // 发送消息
        const sendMessage = async () => {
            const input = document.getElementById('phone-call-input');
            const messagesDiv = document.getElementById('phone-call-messages');
            if (!input || !messagesDiv) return;

            const text = input.value.trim();
            if (!text) return;

            // 显示用户气泡
            messagesDiv.insertAdjacentHTML('beforeend',
                `<div class="phone-call-message-user">${this._escapeHtml(text)}</div>`
            );
            messagesDiv.scrollTop = messagesDiv.scrollHeight;

            this.chatMessages.push({ from: 'me', text: text });
            input.value = '';

            await requestAIReply(text);
        };

        // 重新生成：删除最后一轮AI回复，重新发送
        const regenerate = async () => {
            const messagesDiv = document.getElementById('phone-call-messages');
            if (!messagesDiv) return;

            // 停止正在播放的音频
            this.audioPlayer.pause();
            this.audioPlayer.src = '';

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
            await requestAIReply(lastUserMsg);
        };

        // 绑定事件
        document.getElementById('phone-call-send')?.addEventListener('click', sendMessage);
        document.getElementById('phone-call-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
        document.getElementById('phone-call-regen')?.addEventListener('click', regenerate);

        // 挂断
        document.getElementById('phone-call-hangup')?.addEventListener('click', () => {
            if (this.callTimer) {
                clearInterval(this.callTimer);
                this.callTimer = null;
            }

            // 停止音频播放
            this.audioPlayer.pause();
            this.audioPlayer.src = '';

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
            this.renderMain();
        });

        // 聚焦输入框
        setTimeout(() => {
            document.getElementById('phone-call-input')?.focus();
        }, 300);
    }

    // ========================================
    // AI通信（完全重写，参照 chat-view.js:buildMessagesArray）
    // ========================================
    async sendCallMessageToAI(message, callerName, chatMessages) {
        try {
            const context = window.SillyTavern?.getContext?.();
            if (!context) return '...';

            const userName = context.name1 || '用户';
            let charName = callerName;

            // 优先使用 characterId 获取真实角色名
            if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
                charName = context.characters[context.characterId].name || callerName;
            }

            const storage = window.VirtualPhone?.storage;
            const messages = [];

            // ========================================
            // 1️⃣ 角色信息（name、description、personality、scenario、system_prompt、character_book）
            // ========================================
            if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
                const char = context.characters[context.characterId];
                let charInfo = `【角色信息】\n角色名: ${char.name || charName}\n`;

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
                                const content = entry.content.substring(0, 500);
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
            const contextLimit = storage ? (parseInt(storage.get('phone-context-limit')) || 10) : 10;

            if (context.chat && Array.isArray(context.chat) && context.chat.length > 0) {
                const startIndex = Math.max(0, context.chat.length - contextLimit);
                const chatSlice = context.chat.slice(startIndex);

                chatSlice.forEach(msg => {
                    // 跳过系统消息和特殊消息
                    if (msg.isGaigaiPrompt || msg.isGaigaiData || msg.isPhoneMessage) return;

                    let content = msg.mes || msg.content || '';

                    // 标签清洗：优先记忆插件，缺失时按手机本地开关回退
                    content = applyPhoneTagFilter(content, { storage });

                    // 清理 base64 图片
                    content = content.replace(/<img[^>]*src=["']data:image[^"']*["'][^>]*>/gi, '[图片]');
                    content = content.replace(/!\[[^\]]*\]\(data:image[^)]*\)/gi, '[图片]');

                    // 移除微信/通话标签
                    content = content.replace(/<wechat>[\s\S]*?<\/wechat>/gi, '');
                    content = content.replace(/<wechat[^>]*>[\s\S]*?<\/wechat>/gi, '');
                    content = content.replace(/<Phone>[\s\S]*?<\/Phone>/gi, '');
                    content = content.replace(/<Call>[\s\S]*?<\/Call>/gi, '');

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
            // 4️⃣ [Start a new chat] 记忆插件锚点
            // ========================================
            messages.push({
                role: 'system',
                content: '[Start a new chat]',
                name: 'SYSTEM (分界线)',
                isPhoneMessage: true
            });

            // ========================================
            // 5️⃣ 通话提示词（phone.call）
            // ========================================
            const pm = this._getPromptManager();
            const callPrompt = pm?.getPromptForFeature('phone', 'call') || '';
            if (callPrompt) {
                const processedPrompt = callPrompt
                    .replace(/\{\{char\}\}/gi, callerName)
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
                    const speaker = h.from === 'me' ? userName : callerName;
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
            return this._cleanAIResponse(result.summary || '', callerName);

        } catch (error) {
            console.error('❌ 通话AI请求失败:', error);
            return ['...'];
        }
    }

    // ========================================
    // TTS播放
    // ========================================
    async playTTS(text, bubble) {
        const provider = this.app.storage.get('phone-tts-provider') || 'minimax_cn';
        const apiKey = this.app.storage.get('phone-tts-key') || '';
        const apiUrl = this.app.storage.get('phone-tts-url');
        const model = this.app.storage.get('phone-tts-model');
        const voice = this._resolveCallerTtsVoice(this.currentCaller, { allowGlobalFallback: true });

        if (!apiKey || !apiUrl) {
            console.warn('📞 [TTS] 配置缺失 → provider:', provider, 'apiKey:', apiKey ? '***' : '空', 'apiUrl:', apiUrl);
            return;
        }

        try {
            // 停止之前播放的
            if (this.currentPlayingBubble) {
                this.currentPlayingBubble.classList.remove('voice-playing');
            }

            let blobUrl = '';

            if (provider.startsWith('minimax')) {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({
                        model: model || 'speech-02-hd',
                        text: text,
                        stream: false,
                        voice_setting: { voice_id: voice || 'female-shaonv', speed: 1.0, vol: 1.0, pitch: 0 },
                        audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3' }
                    })
                });
                if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
                const resData = await response.json();
                if (resData.base_resp?.status_code !== 0) throw new Error(resData.base_resp?.status_msg || 'MiniMax请求失败');

                const hexAudio = resData.data.audio;
                const bytes = new Uint8Array(Math.ceil(hexAudio.length / 2));
                for (let i = 0; i < bytes.length; i++) {
                    bytes[i] = parseInt(hexAudio.substr(i * 2, 2), 16);
                }
                const blob = new Blob([bytes], { type: 'audio/mp3' });
                blobUrl = URL.createObjectURL(blob);

            } else {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({
                        model: model || 'tts-1',
                        input: text,
                        voice: voice || 'alloy'
                    })
                });
                if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
                const blob = await response.blob();
                blobUrl = URL.createObjectURL(blob);
            }

            // 播放并等待播放完毕
            this.audioPlayer.src = blobUrl;
            this.currentPlayingBubble = bubble;
            if (bubble) bubble.classList.add('voice-playing');

            await new Promise((resolve, reject) => {
                this.audioPlayer.onended = () => {
                    if (bubble) bubble.classList.remove('voice-playing');
                    URL.revokeObjectURL(blobUrl);
                    this.currentPlayingBubble = null;
                    resolve();
                };
                this.audioPlayer.onerror = (e) => {
                    if (bubble) bubble.classList.remove('voice-playing');
                    URL.revokeObjectURL(blobUrl);
                    this.currentPlayingBubble = null;
                    reject(e);
                };
                this.audioPlayer.play().catch(reject);
            });

        } catch (error) {
            console.error('TTS Error:', error);
            if (bubble) bubble.classList.remove('voice-playing');
        }
    }

    // ========================================
    // 工具方法
    // ========================================

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
            const wechatData = window.VirtualPhone?.wechatApp?.wechatData;
            if (!wechatData) return null;
            return wechatData.findContactByNameLoose?.(callerName, { includeChats: true })
                || wechatData.getContactByName?.(callerName)
                || null;
        } catch (e) {
            return null;
        }
    }

    _resolveCallerTtsVoice(callerName, { allowGlobalFallback = true } = {}) {
        const globalVoice = String(this.app.storage.get('phone-tts-voice') || '').trim();
        try {
            const wechatData = window.VirtualPhone?.wechatApp?.wechatData;
            if (wechatData?.resolveTtsVoiceByName) {
                const resolved = wechatData.resolveTtsVoiceByName(callerName, { includeChats: true });
                const boundVoice = String(resolved?.voice || '').trim();
                if (boundVoice) return boundVoice;
            }
        } catch (e) {
            // ignore
        }
        return allowGlobalFallback ? globalVoice : '';
    }

    _getCallerAvatar(callerName) {
        // 尝试从微信联系人匹配头像
        try {
            const contact = this._resolveWechatContact(callerName);
            if (contact?.avatar) {
                return `<img src="${contact.avatar}" style="width:100%;height:100%;object-fit:cover;">`;
            }
        } catch (e) { /* ignore */ }
        return '👤';
    }

    _getPromptManager() {
        return window.VirtualPhone?.promptManager || null;
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

        // 按换行拆分为多条消息，过滤空行
        const lines = cleaned.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);

        return lines.length > 0 ? lines : ['...'];
    }

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
