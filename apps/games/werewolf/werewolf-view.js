/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  狼人杀 UI 视图
 * ======================================================== */

export class WerewolfView {
    constructor(app) {
        this.app = app;
        this._cssLoaded = false;
        this._chatExpanded = false;
        this._entryPromptOpen = false;
        this._inviteOpen = false;
        this._settingsOpen = false;
        this._recordOpen = false;
        this._shareOverlayOpen = false;
        this._shareTarget = null;
        this._selectedContactIds = new Set();
        this._userSpeechInput = '';
        this._expandedChatDays = new Set();
    }

    async render() {
        await this._loadCSS();
        const state = this.app.werewolfData.getState();
        const players = state.players || [];
        const phaseLabel = state.phase === 'night' ? '黑夜' : state.phase === 'setup' ? '匹配' : state.phase === 'vote' ? '投票' : state.phase === 'last_words' ? '遗言' : state.phase === 'ended' ? '结束' : '白天';
        const themeClass = state.phase === 'night' ? 'games-werewolf-night-theme' : 'games-werewolf-day-theme';
        const phaseIcon = state.phase === 'night' ? 'fa-moon' : 'fa-sun';
        const forceChatExpanded = !!(this.app.werewolfData.canUserSpeak?.() || this.app.werewolfData.canUserLastWords?.());
        const chatExpanded = this._chatExpanded || forceChatExpanded;
        const currentPlayer = players.find(player => Number(player.seat) === Number(state.currentSpeaker));
        const nightInfo = this.app.werewolfData.getNightStepInfo?.() || {};
        const html = `
            <div class="games-app games-werewolf-app ${themeClass} ${chatExpanded ? 'is-chat-expanded' : ''}">
                <div class="games-werewolf-backdrop" aria-hidden="true"></div>

                <div class="games-werewolf-topbar">
                    <button class="games-werewolf-icon-btn" id="games-werewolf-back" type="button" aria-label="返回大厅">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div class="games-werewolf-title-wrap">
                        <div class="games-werewolf-title">狼人杀</div>
                        <div class="games-werewolf-subtitle">夜幕降临</div>
                    </div>
                    <button class="games-werewolf-icon-btn games-werewolf-settings-btn" id="games-werewolf-settings" type="button" aria-label="狼人杀设置">
                        <i class="fa-solid fa-gear"></i>
                    </button>
                </div>

                <div class="games-werewolf-stage">
                    <div class="games-werewolf-board">
                        <div class="games-werewolf-seats">
                            ${players.map(player => this._renderPlayerCard(player)).join('')}
                        </div>

                        <div class="games-werewolf-oracle">
                            <div class="games-werewolf-moon"><i class="fa-solid ${phaseIcon}"></i></div>
                            <div class="games-werewolf-day">第 <strong>${Number(state.day || 1)}</strong> 天</div>
                            <div class="games-werewolf-phase">${this._escape(phaseLabel)}</div>
                            <div class="games-werewolf-divider"></div>
                            <div class="games-werewolf-turn">${state.phase === 'setup' ? '等待匹配' : state.phase === 'night' ? '夜晚行动' : state.phase === 'vote' ? '等待投票' : state.phase === 'ended' ? '游戏结束' : '当前轮到'}</div>
                            <div class="games-werewolf-speaker">${this._renderCenterSpeaker(state, currentPlayer, nightInfo)}</div>
                            ${state.phase !== 'setup' && state.userRoleHint ? `<div class="games-werewolf-role-hint">${this._escape(state.userRoleHint)}</div>` : ''}
                        </div>
                    </div>

                    <div class="games-werewolf-notice">
                        <span>系统公告：</span><strong>${this._escape(state.notice || '点击开始游戏。')}</strong>
                    </div>

                    <div class="games-werewolf-chat ${chatExpanded ? 'is-expanded' : ''}">
                        <button class="games-werewolf-chat-toggle" id="games-werewolf-chat-toggle" type="button" aria-expanded="${chatExpanded ? 'true' : 'false'}">
                            <span>发言区</span>
                            <i class="fa-solid fa-chevron-${chatExpanded ? 'down' : 'up'}"></i>
                        </button>
                        <div class="games-werewolf-chat-scroll">
                            ${(state.chat || []).length
                                ? this._renderChatRows(state)
                                : '<div class="games-werewolf-chat-empty">暂无发言</div>'}
                        </div>
                    </div>

                    ${this._renderUserSpeechBox(state)}
                    ${this._renderLastWordsBox(state)}
                    ${this._renderVoteBox(state)}
                    ${this._renderNightActionBox(state, nightInfo)}

                    <div class="games-werewolf-actions">
                        ${this._renderPrimaryActions(state)}
                        <button class="games-werewolf-action" type="button" id="games-werewolf-record">
                            <i class="fa-solid fa-book-open"></i>
                            <span>记录</span>
                        </button>
                    </div>
                </div>
                ${this._renderEntryPrompt(state)}
                ${this._renderInviteOverlay(state)}
                ${this._renderSettingsOverlay()}
                ${this._renderRecordOverlay(state)}
            </div>
        `;

        this.app.phoneShell.setContent(html, 'games-werewolf');
        this._bindEvents();
        if (this._recordOpen) this._scrollRecordListToBottom();
    }

    destroy() {}

    _setChatPanelExpanded(expanded) {
        const nextExpanded = !!expanded;
        if (this._chatExpanded === nextExpanded) return;
        this._chatExpanded = nextExpanded;
        if (!nextExpanded) {
            this._expandedChatDays.clear();
            this._refreshChatScroll();
        }
        const root = document.querySelector('.games-werewolf-app');
        const chat = document.querySelector('.games-werewolf-chat');
        const toggle = document.getElementById('games-werewolf-chat-toggle');
        root?.classList.toggle('is-chat-expanded', nextExpanded);
        chat?.classList.toggle('is-expanded', nextExpanded);
        toggle?.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
        const icon = toggle?.querySelector('i');
        if (icon) {
            icon.classList.toggle('fa-chevron-down', nextExpanded);
            icon.classList.toggle('fa-chevron-up', !nextExpanded);
        }
    }

    _collapseChatPanel() {
        this._setChatPanelExpanded(false);
    }

    _toggleChatPanel(event = null) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        this._setChatPanelExpanded(!this._chatExpanded);
    }

    _refreshChatScroll() {
        const scroll = document.querySelector('.games-werewolf-chat-scroll');
        if (!scroll) return;
        const state = this.app.werewolfData.getState();
        scroll.innerHTML = (state.chat || []).length
            ? this._renderChatRows(state)
            : '<div class="games-werewolf-chat-empty">暂无发言</div>';
        this._bindChatDayToggles();
    }

    _setButtonBusy(button, label = '处理中') {
        if (!button) return;
        button.disabled = true;
        const icon = button.querySelector('i');
        const text = button.querySelector('span');
        if (icon) {
            icon.className = 'fa-solid fa-spinner fa-spin';
        }
        if (text) text.textContent = label;
        else button.textContent = label;
    }

    _setActionButtonBusy(buttonId, label = '处理中') {
        this._setButtonBusy(document.getElementById(buttonId), label);
    }

    _setVoteTargetsBusy(label = '结算中') {
        document.querySelectorAll('.games-werewolf-vote-target').forEach(btn => {
            this._setButtonBusy(btn, label);
        });
    }

    clearUserSpeechInput() {
        this._userSpeechInput = '';
    }

    openEntryPrompt() {
        this._entryPromptOpen = true;
    }

    closeEntryPrompt() {
        this._entryPromptOpen = false;
    }

    _bindEvents() {
        document.getElementById('games-werewolf-back')?.addEventListener('click', () => {
            this.app.backToLobby();
        });
        document.getElementById('games-werewolf-settings')?.addEventListener('click', () => {
            this._settingsOpen = true;
            this.render();
        });
        const chatToggle = document.getElementById('games-werewolf-chat-toggle');
        chatToggle?.addEventListener('click', e => {
            this._toggleChatPanel(e);
        });
        document.querySelector('.games-werewolf-app')?.addEventListener('pointerup', e => {
            if (!this._chatExpanded) return;
            if (e.target?.closest?.('.games-werewolf-chat')) return;
            this._collapseChatPanel();
        });
        this._bindChatDayToggles();
        document.getElementById('games-werewolf-start')?.addEventListener('click', () => {
            this._inviteOpen = true;
            this.render();
        });
        document.getElementById('games-werewolf-continue-speech')?.addEventListener('click', () => {
            this._setActionButtonBusy('games-werewolf-continue-speech', '续接中');
            this.app.continueWerewolfSpeech();
        });
        document.getElementById('games-werewolf-resolve-vote')?.addEventListener('click', () => {
            this._setActionButtonBusy('games-werewolf-resolve-vote', '结算中');
            this.app.resolveWerewolfVote();
        });
        document.querySelectorAll('.games-werewolf-vote-target[data-seat]').forEach(btn => {
            btn.addEventListener('click', () => {
                this._setVoteTargetsBusy('结算中');
                this.app.submitWerewolfUserVote(Number(btn.dataset.seat || 0));
            });
        });
        document.getElementById('games-werewolf-submit-speech')?.addEventListener('click', () => {
            const input = document.getElementById('games-werewolf-user-speech');
            this._userSpeechInput = input?.value || '';
            this.app.submitWerewolfUserSpeech(this._userSpeechInput);
        });
        document.getElementById('games-werewolf-user-speech')?.addEventListener('input', e => {
            this._userSpeechInput = e.target.value || '';
        });
        document.getElementById('games-werewolf-submit-lastwords')?.addEventListener('click', () => {
            const input = document.getElementById('games-werewolf-lastwords-input');
            this._userSpeechInput = input?.value || '';
            this.app.submitWerewolfUserLastWords(this._userSpeechInput);
        });
        document.getElementById('games-werewolf-lastwords-input')?.addEventListener('input', e => {
            this._userSpeechInput = e.target.value || '';
        });
        document.querySelectorAll('.games-werewolf-night-target[data-seat]').forEach(btn => {
            btn.addEventListener('click', () => {
                const seat = Number(btn.dataset.seat || 0);
                const action = String(btn.dataset.action || '').trim();
                this.app.submitWerewolfNightAction({ targetSeat: seat, usePotion: action });
            });
        });
        document.getElementById('games-werewolf-night-skip')?.addEventListener('click', () => {
            this.app.submitWerewolfNightAction({ targetSeat: 0, usePotion: '' });
        });
        document.getElementById('games-werewolf-wolf-chat-send')?.addEventListener('click', () => {
            const input = document.getElementById('games-werewolf-wolf-chat-input');
            this.app.submitWerewolfWolfChat(input?.value || '');
        });
        document.getElementById('games-werewolf-wolf-chat-ai')?.addEventListener('click', () => {
            this.app.requestWerewolfWolfMateAdvice();
        });
        document.getElementById('games-werewolf-record')?.addEventListener('click', () => {
            this._recordOpen = true;
            this._shareOverlayOpen = false;
            this._shareTarget = null;
            this.render();
            this._scrollRecordListToBottom();
        });
        document.getElementById('games-werewolf-continue')?.addEventListener('click', () => {
            this.closeEntryPrompt();
            this.render();
            this.app.continueWerewolfSpeech();
        });
        document.getElementById('games-werewolf-new')?.addEventListener('click', () => {
            this.app.startNewWerewolfGame({ roleRevealMode: 'open' });
        });
        document.getElementById('games-werewolf-new-hidden')?.addEventListener('click', () => {
            this.app.startNewWerewolfGame({ roleRevealMode: 'hidden' });
        });
        this._bindInviteEvents();
        this._bindSettingsEvents();
        this._bindRecordEvents();
        this._bindShareEvents();
    }

    _bindChatDayToggles() {
        document.querySelectorAll('.games-werewolf-chat-day-toggle[data-day]').forEach(btn => {
            btn.addEventListener('click', () => {
                const day = Number(btn.dataset.day || 0);
                if (!day) return;
                if (this._expandedChatDays.has(day)) this._expandedChatDays.delete(day);
                else this._expandedChatDays.add(day);
                this._refreshChatScroll();
            });
        });
    }

    _bindInviteEvents() {
        document.getElementById('games-werewolf-invite-close')?.addEventListener('click', () => {
            this._inviteOpen = false;
            this.render();
        });
        document.getElementById('games-werewolf-invite-overlay')?.addEventListener('click', e => {
            if (e.target?.id !== 'games-werewolf-invite-overlay') return;
            this._inviteOpen = false;
            this.render();
        });
        document.querySelectorAll('.games-werewolf-contact-choice[data-contact-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = String(btn.dataset.contactId || '').trim();
                if (!id) return;
                if (this._selectedContactIds.has(id)) this._selectedContactIds.delete(id);
                else if (this._selectedContactIds.size < this._emptySeatCount()) this._selectedContactIds.add(id);
                this._refreshInviteSelection();
            });
        });
        document.getElementById('games-werewolf-invite-start')?.addEventListener('click', () => {
            const contacts = this.app.getWechatContactsForWerewolf()
                .filter(contact => this._selectedContactIds.has(contact.id));
            this._inviteOpen = false;
            this.closeEntryPrompt();
            this.app.startWerewolfMatch(contacts);
        });
    }

    _bindSettingsEvents() {
        document.getElementById('games-werewolf-settings-close')?.addEventListener('click', () => {
            this._settingsOpen = false;
            this.render();
        });
        document.getElementById('games-werewolf-settings-overlay')?.addEventListener('click', e => {
            if (e.target?.id !== 'games-werewolf-settings-overlay') return;
            this._settingsOpen = false;
            this.render();
        });
        document.getElementById('games-werewolf-worldbook-enabled')?.addEventListener('change', async e => {
            await this.app.setWerewolfWorldbookEnabled(!!e.target.checked);
            this.renderWerewolfWorldbookList();
        });
        document.getElementById('games-werewolf-prompt-save')?.addEventListener('click', () => {
            this.app.setWerewolfPrompt(document.getElementById('games-werewolf-ai-prompt')?.value || '');
            this.app.phoneShell?.showNotification?.('狼人杀设置', '提示词已保存', '✅');
            this._settingsOpen = false;
            this.render();
        });
        document.getElementById('games-werewolf-prompt-reset')?.addEventListener('click', () => {
            const text = this.app.resetWerewolfPrompt();
            const textarea = document.getElementById('games-werewolf-ai-prompt');
            if (textarea) textarea.value = text;
            this.app.phoneShell?.showNotification?.('狼人杀设置', '已恢复默认提示词', '✅');
        });
        this.renderWerewolfWorldbookList();
    }

    _bindRecordEvents() {
        document.getElementById('games-werewolf-record-close')?.addEventListener('click', () => {
            this._recordOpen = false;
            this._shareOverlayOpen = false;
            this._shareTarget = null;
            this.render();
        });
        document.getElementById('games-werewolf-record-overlay')?.addEventListener('click', e => {
            if (e.target?.id !== 'games-werewolf-record-overlay') return;
            this._recordOpen = false;
            this._shareOverlayOpen = false;
            this._shareTarget = null;
            this.render();
        });
        document.getElementById('games-werewolf-share-record')?.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            this._shareOverlayOpen = true;
            this._shareTarget = null;
            this.render();
            this._scrollRecordListToBottom();
        });
    }

    _bindShareEvents() {
        document.getElementById('games-werewolf-share-close')?.addEventListener('click', () => {
            this._shareOverlayOpen = false;
            this._shareTarget = null;
            this.render();
            this._scrollRecordListToBottom();
        });
        document.getElementById('games-werewolf-share-back')?.addEventListener('click', () => {
            this._shareTarget = null;
            this.render();
            this._scrollRecordListToBottom();
        });
        document.getElementById('games-werewolf-share-cancel')?.addEventListener('click', () => {
            this._shareTarget = null;
            this.render();
            this._scrollRecordListToBottom();
        });
        document.getElementById('games-werewolf-share-overlay')?.addEventListener('click', e => {
            if (e.target?.id !== 'games-werewolf-share-overlay') return;
            this._shareOverlayOpen = false;
            this._shareTarget = null;
            this.render();
            this._scrollRecordListToBottom();
        });
        document.querySelectorAll('.games-werewolf-share-contact[data-name]').forEach(item => {
            item.addEventListener('click', () => {
                const name = String(item.dataset.name || '').trim();
                const target = this._getShareTargets().find(entry => entry.name === name) || { name };
                this._shareTarget = target;
                this.render();
                this._scrollRecordListToBottom();
            });
        });
        document.getElementById('games-werewolf-share-send')?.addEventListener('click', async () => {
            const target = this._shareTarget;
            if (!target?.name) return;
            const btn = document.getElementById('games-werewolf-share-send');
            if (btn) btn.disabled = true;
            try {
                await this.app.shareWerewolfToWechat(target.name);
                this.app.phoneShell?.showNotification?.('分享成功', `已发送给 ${target.name}`, '✅');
                this._shareOverlayOpen = false;
                this._shareTarget = null;
                this.render();
            } catch (error) {
                this.app.phoneShell?.showNotification?.('分享失败', error?.message || '发送失败', '❌');
                if (btn) btn.disabled = false;
            }
        });
    }

    _scrollRecordListToBottom() {
        requestAnimationFrame(() => {
            const list = document.querySelector('.games-werewolf-record-list');
            if (list) list.scrollTop = list.scrollHeight;
        });
    }

    _refreshInviteSelection() {
        const required = this._emptySeatCount();
        const selectedCount = this._selectedContactIds.size;
        const countEl = document.getElementById('games-werewolf-invite-count');
        if (countEl) countEl.textContent = `${selectedCount}/${required}`;

        document.querySelectorAll('.games-werewolf-contact-choice[data-contact-id]').forEach(btn => {
            const id = String(btn.dataset.contactId || '').trim();
            const checked = !!id && this._selectedContactIds.has(id);
            const disabled = !checked && selectedCount >= required;
            btn.classList.toggle('is-active', checked);
            btn.disabled = disabled;
            const icon = btn.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-check', checked);
                icon.classList.toggle('fa-plus', !checked);
            }
        });
    }

    _renderPlayerCard(player) {
        const alive = player.alive !== false;
        const isEmptySeat = !!player.empty && !player.isUser;
        const hasAvatar = !!this.app.resolvePlayerAvatar?.(player);
        const classes = [
            'games-werewolf-player',
            `games-werewolf-seat-${player.seat}`,
            `games-werewolf-avatar-${player.tone}`,
            player.active ? 'is-active' : '',
            player.isUser ? 'is-user' : '',
            isEmptySeat ? 'is-empty' : '',
            !isEmptySeat && !hasAvatar ? 'has-no-avatar' : '',
            !alive ? 'is-dead' : ''
        ].filter(Boolean).join(' ');
        return `
            <div class="${classes}">
                <div class="games-werewolf-seat-no"><span>${player.seat}</span></div>
                <div class="games-werewolf-avatar" aria-hidden="true">${this._renderAvatar(player)}</div>
                <div class="games-werewolf-player-name">${this._escape(player.name)}</div>
                <div class="games-werewolf-player-status"><span></span>${alive ? '存活' : '死亡'}</div>
            </div>
        `;
    }

    _renderAvatar(player) {
        const state = this.app.werewolfData.getState();
        if (player.alive === false && state.roleRevealMode !== 'hidden') {
            const roleImage = this._getDeathRoleImage(player.role);
            if (roleImage) {
                return `<img class="games-werewolf-role-card-img" src="${this._escapeAttr(roleImage)}" alt="${this._escapeAttr(player.role || '身份')}">`;
            }
        }
        if (player.empty && !player.isUser) return '';
        return this.app.renderPlayerAvatar?.(player) || '';
    }

    _getDeathRoleImage(role = '') {
        const map = {
            守卫: 'Guard.png',
            女巫: 'Witch.png',
            狼人: 'Werewolf.png',
            村民: 'Villager.png',
            预言家: 'Seer.png'
        };
        const file = map[String(role || '').trim()];
        return file ? new URL(`./assets/${file}`, import.meta.url).href : '';
    }

    _renderChatRows(state) {
        const currentDay = Number(state.day || 1);
        const groups = new Map();
        (state.chat || []).forEach(item => {
            const day = Number(item.day || 1);
            if (!groups.has(day)) groups.set(day, []);
            groups.get(day).push(item);
        });
        return [...groups.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([day, items]) => {
                const collapsed = day < currentDay && !this._expandedChatDays.has(day);
                if (collapsed) return this._renderChatDayCollapsed(day, items);
                return items.map(item => this._renderChatRow(item.seat, item.text)).join('');
            })
            .join('');
    }

    _renderChatDayCollapsed(day, items = []) {
        const count = Array.isArray(items) ? items.length : 0;
        const speeches = (Array.isArray(items) ? items : []).filter(item => Number(item.seat || 0)).length;
        return `
            <button class="games-werewolf-chat-day-toggle" type="button" data-day="${Number(day)}">
                <span>第 ${Number(day)} 天记录已折叠</span>
                <em>${count} 条 · ${speeches} 条发言</em>
            </button>
        `;
    }

    _renderChatRow(seat, text) {
        if (!seat) {
            const isDaybreak = String(text || '').trim().startsWith('天亮了');
            return `
                <div class="games-werewolf-chat-row games-werewolf-chat-row-system ${isDaybreak ? 'is-daybreak' : ''}">
                    <span>!</span>
                    <p>${this._escape(text)}</p>
                </div>
            `;
        }
        return `
            <div class="games-werewolf-chat-row games-werewolf-chat-row-${seat}">
                <span>${seat}</span>
                <p>${this._escape(text)}</p>
            </div>
        `;
    }

    _renderUserSpeechBox(state) {
        if (!this.app.werewolfData.canUserSpeak()) return '';
        return `
            <div class="games-werewolf-user-speech-box">
                <textarea id="games-werewolf-user-speech" class="games-werewolf-user-speech" rows="2" placeholder="输入你的白天发言">${this._escape(this._userSpeechInput)}</textarea>
                <button id="games-werewolf-submit-speech" class="games-werewolf-speech-send" type="button">发送</button>
            </div>
        `;
    }

    _renderLastWordsBox(state) {
        if (!this.app.werewolfData.canUserLastWords?.()) return '';
        return `
            <div class="games-werewolf-user-speech-box">
                <textarea id="games-werewolf-lastwords-input" class="games-werewolf-user-speech" rows="2" placeholder="输入你的遗言">${this._escape(this._userSpeechInput)}</textarea>
                <button id="games-werewolf-submit-lastwords" class="games-werewolf-speech-send" type="button">遗言</button>
            </div>
        `;
    }

    _renderVoteBox(state) {
        if (!this.app.werewolfData.canUserVote?.()) return '';
        const targets = this.app.werewolfData.getVoteTargets?.() || [];
        return `
            <div class="games-werewolf-night-box games-werewolf-vote-box">
                <div class="games-werewolf-night-title">请选择你要投票放逐的玩家</div>
                <div class="games-werewolf-night-desc">你的票会先记录，再由 AI 根据公开发言模拟其他玩家投票。</div>
                <div class="games-werewolf-night-targets">
                    ${targets.map(player => `
                        <button class="games-werewolf-night-target games-werewolf-vote-target" type="button" data-seat="${Number(player.seat)}">
                            投 ${Number(player.seat)}号 ${this._escape(player.name)}
                        </button>
                    `).join('')}
                </div>
                <button class="games-werewolf-night-skip games-werewolf-vote-target" type="button" data-seat="0">弃票</button>
            </div>
        `;
    }

    _renderNightActionBox(state, nightInfo = {}) {
        if (state.phase !== 'night' || !nightInfo.isUserTurn) return '';
        const role = String(nightInfo.role || state.userRole || '').trim();
        const lastGuardSeat = Number(nightInfo.lastGuardSeat || state.lastGuardSeat || 0);
        const targets = this.app.werewolfData.getNightTargets({
            includeSelf: role === '守卫' || role === '女巫',
            excludeRoles: role === '狼人' ? ['狼人'] : [],
            excludeSeats: role === '守卫' && lastGuardSeat ? [lastGuardSeat] : []
        });
        const userSeat = Number((state.players || []).find(player => player.isUser)?.seat || 0);
        const wolfMates = role === '狼人'
            ? (state.players || []).filter(player => player.role === '狼人').map(player => `${player.seat}号 ${player.name}`).join('、')
            : '';
        const titleMap = {
            守卫: lastGuardSeat ? `选择今晚守护的玩家（不能守 ${lastGuardSeat} 号）` : '选择今晚守护的玩家',
            狼人: '选择今晚袭击的玩家',
            预言家: '选择今晚查验的玩家',
            女巫: '选择今晚使用药剂的目标'
        };
        if (role === '女巫') {
            const killedSeat = Number(state.lastKilledSeat || 0);
            const killedPlayer = targets.find(player => Number(player.seat) === killedSeat);
            const potions = this.app.werewolfData.getWitchPotions?.() || { antidote: true, poison: true };
            const poisonTargets = this.app.werewolfData.getNightTargets({ includeSelf: false, excludeSeat: userSeat });
            return `
                <div class="games-werewolf-night-box">
                    <div class="games-werewolf-night-title">${killedPlayer ? `今晚 ${Number(killedPlayer.seat)}号 ${this._escape(killedPlayer.name)} 被袭击` : '今晚无人被告知死亡'}</div>
                    <div class="games-werewolf-night-desc">解药：${potions.antidote ? '可用' : '已用'} · 毒药：${potions.poison ? '可用' : '已用'}</div>
                    ${killedPlayer && potions.antidote ? `<button class="games-werewolf-night-skip games-werewolf-night-target" type="button" data-seat="${Number(killedPlayer.seat)}" data-action="antidote">使用解药救 ${Number(killedPlayer.seat)}号</button>` : ''}
                    ${potions.poison ? `
                        <div class="games-werewolf-night-targets">
                            ${poisonTargets.map(player => `
                                <button class="games-werewolf-night-target" type="button" data-seat="${Number(player.seat)}" data-action="poison">
                                    毒 ${Number(player.seat)}号
                                </button>
                            `).join('')}
                        </div>
                    ` : ''}
                    <button class="games-werewolf-night-skip" id="games-werewolf-night-skip" type="button">不使用药剂，直接天亮</button>
                </div>
            `;
        }
        return `
            <div class="games-werewolf-night-box">
                <div class="games-werewolf-night-title">${this._escape(titleMap[role] || '选择夜晚行动目标')}</div>
                ${role === '狼人' ? this._renderWolfNightChat(state) : wolfMates ? `<div class="games-werewolf-night-desc">狼人同伴：${this._escape(wolfMates)}</div>` : ''}
                <div class="games-werewolf-night-targets">
                    ${targets.map(player => `
                        <button class="games-werewolf-night-target" type="button" data-seat="${Number(player.seat)}" data-action="">
                            ${Number(player.seat)}号 ${this._escape(player.name)}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    }

    _renderWolfNightChat(state) {
        const mates = this.app.werewolfData.getWerewolfMates?.() || [];
        const chat = Array.isArray(state.wolfChat) ? state.wolfChat : [];
        const loading = !!state.wolfChatLoading;
        return `
            <div class="games-werewolf-wolf-panel">
                <div class="games-werewolf-night-desc">狼人同伴：${this._escape(mates.map(player => `${player.seat}号 ${player.name}`).join('、') || '仅剩你一名狼人')}</div>
                <div class="games-werewolf-wolf-chat">
                    ${chat.length ? chat.slice(-8).map(item => `
                        <div class="games-werewolf-wolf-chat-row">
                            <span>${Number(item.seat || 0) ? `${Number(item.seat)}号` : '狼队'}</span>
                            <p>${this._escape(item.text || '')}</p>
                        </div>
                    `).join('') : '<div class="games-werewolf-night-desc">还没有狼队私聊，可以先说你的想法或让队友建议。</div>'}
                </div>
                <div class="games-werewolf-wolf-chat-input">
                    <input id="games-werewolf-wolf-chat-input" type="text" placeholder="输入狼队私聊">
                    <button id="games-werewolf-wolf-chat-send" type="button">发送</button>
                    <button id="games-werewolf-wolf-chat-ai" type="button" ${loading ? 'disabled' : ''}>${loading ? '思考中' : '队友建议'}</button>
                </div>
            </div>
        `;
    }

    _renderCenterSpeaker(state, currentPlayer, nightInfo = {}) {
        if (state.phase === 'setup') return '开始游戏';
        if (state.phase === 'ended') return this._escape(state.winner === 'werewolves' ? '狼人胜利' : '好人胜利');
        if (state.phase === 'night') {
            if (nightInfo.isUserTurn) return `<strong>${this._escape(nightInfo.role || '你')}</strong> 行动`;
            return this._escape(nightInfo.label || '夜晚行动中');
        }
        if (!currentPlayer) return '等待';
        return `<strong>${Number(currentPlayer.seat)}</strong>号 ${this._escape(currentPlayer.name || '玩家')}`;
    }

    _renderPrimaryActions(state) {
        if (state.phase === 'setup') {
            return `
                <button class="games-werewolf-action games-werewolf-action-primary ${state.matching ? 'is-waiting' : ''}" id="games-werewolf-start" type="button" ${state.matching ? 'disabled' : ''}>
                    <i class="fa-solid ${state.matching ? 'fa-spinner fa-spin' : 'fa-paw'}"></i>
                    <span>${state.matching ? '匹配中' : '开始游戏'}</span>
                </button>
                <button class="games-werewolf-action" type="button" disabled>
                    <i class="fa-solid fa-comment-dots"></i>
                    <span>发言</span>
                </button>
            `;
        }
        if (state.phase === 'night') {
            const canContinueNight = !this.app.werewolfData.isUserNightTurn?.()
                && /中断|失败|429|请求/.test(String(state.notice || ''));
            return `
                <button class="games-werewolf-action" type="button" disabled>
                    <i class="fa-solid fa-moon"></i>
                    <span>夜晚</span>
                </button>
                <button class="games-werewolf-action games-werewolf-action-primary ${canContinueNight ? '' : 'is-waiting'}" ${canContinueNight ? 'id="games-werewolf-continue-speech"' : ''} type="button" ${canContinueNight ? '' : 'disabled'}>
                    <i class="fa-solid ${canContinueNight ? 'fa-forward-step' : 'fa-spinner fa-spin'}"></i>
                    <span>${canContinueNight ? '续接行动' : '行动中'}</span>
                </button>
            `;
        }
        if (state.phase === 'last_words') {
            const canUserLastWords = this.app.werewolfData.canUserLastWords?.();
            const isWaitingLastWords = !!state.speaking;
            const canContinueLastWords = !canUserLastWords && !isWaitingLastWords && !state.lastWordsDone;
            return `
                <button class="games-werewolf-action" type="button" disabled>
                    <i class="fa-solid fa-comment-dots"></i>
                    <span>遗言</span>
                </button>
                <button class="games-werewolf-action games-werewolf-action-primary ${isWaitingLastWords ? 'is-waiting' : ''}" ${canContinueLastWords ? 'id="games-werewolf-continue-speech"' : ''} type="button" ${canContinueLastWords ? '' : 'disabled'}>
                    <i class="fa-solid ${isWaitingLastWords ? 'fa-spinner fa-spin' : canContinueLastWords ? 'fa-forward-step' : 'fa-pen'}"></i>
                    <span>${isWaitingLastWords ? '等待' : canContinueLastWords ? '续接遗言' : '请发言'}</span>
                </button>
            `;
        }
        if (state.phase === 'ended') {
            return `
                <button class="games-werewolf-action" type="button" disabled>
                    <i class="fa-solid fa-flag-checkered"></i>
                    <span>结束</span>
                </button>
                <button class="games-werewolf-action games-werewolf-action-primary" type="button" disabled>
                    <i class="fa-solid fa-book-open"></i>
                    <span>看复盘</span>
                </button>
            `;
        }
        if (state.phase === 'vote') {
            const canUserVote = this.app.werewolfData.canUserVote?.();
            return `
                <button class="games-werewolf-action" id="games-werewolf-resolve-vote" type="button" ${canUserVote || state.voting ? 'disabled' : ''}>
                    <i class="fa-solid fa-check-to-slot"></i>
                    <span>投票</span>
                </button>
                <button class="games-werewolf-action games-werewolf-action-primary ${state.voting ? 'is-waiting' : ''}" type="button" disabled>
                    <i class="fa-solid ${state.voting ? 'fa-spinner fa-spin' : 'fa-hand-pointer'}"></i>
                    <span>${state.voting ? '结算中' : canUserVote ? '选目标' : '看结算'}</span>
                </button>
            `;
        }
        const isWaitingSpeech = !!state.speaking;
        const canContinue = state.phase === 'day' && !this.app.werewolfData.canUserSpeak() && !isWaitingSpeech;
        return `
            <button class="games-werewolf-action ${isWaitingSpeech ? 'is-waiting' : ''}" id="games-werewolf-continue-speech" type="button" ${canContinue ? '' : 'disabled'}>
                <i class="fa-solid ${isWaitingSpeech ? 'fa-spinner fa-spin' : 'fa-forward-step'}"></i>
                <span>${isWaitingSpeech ? '等待中' : '续接发言'}</span>
            </button>
            <button class="games-werewolf-action games-werewolf-action-primary" id="games-werewolf-resolve-vote" type="button" disabled>
                <i class="fa-solid fa-check-to-slot"></i>
                <span>投票</span>
            </button>
        `;
    }

    _renderEntryPrompt(state) {
        if (!this._entryPromptOpen) return '';
        const user = state.players?.find(player => player.isUser);
        const filledCount = (state.players || []).filter(player => !player.empty).length;
        const phaseText = state.phase === 'setup' ? '未开始' : state.phase === 'night' ? '夜间' : state.phase === 'vote' ? '投票' : state.phase === 'last_words' ? '遗言' : state.phase === 'ended' ? '结束' : '白天';
        const revealText = state.roleRevealMode === 'hidden' ? '暗牌局' : '明牌局';
        return `
            <div class="games-werewolf-entry-overlay">
                <div class="games-werewolf-entry-panel">
                    <div class="games-werewolf-entry-title">狼人杀</div>
                    <div class="games-werewolf-entry-desc">
                        当前存档：${this._escape(phaseText)} · ${this._escape(revealText)} · ${filledCount}/8 人 · 你在 ${Number(user?.seat || 8)} 号位
                    </div>
                    <div class="games-werewolf-entry-actions">
                        <button class="games-werewolf-entry-btn" id="games-werewolf-continue" type="button">继续当前游戏</button>
                        <button class="games-werewolf-entry-btn is-primary" id="games-werewolf-new" type="button">明牌局</button>
                        <button class="games-werewolf-entry-btn" id="games-werewolf-new-hidden" type="button">暗牌局</button>
                    </div>
                </div>
            </div>
        `;
    }

    _renderInviteOverlay() {
        if (!this._inviteOpen) return '';
        const contacts = this.app.getWechatContactsForWerewolf();
        const required = this._emptySeatCount();
        return `
            <div class="games-werewolf-invite-overlay" id="games-werewolf-invite-overlay">
                <div class="games-werewolf-invite-panel">
                    <div class="games-werewolf-invite-head">
                        <div>
                            <div class="games-werewolf-entry-title">邀请微信好友</div>
                            <div class="games-werewolf-entry-desc">已选 <span id="games-werewolf-invite-count">${this._selectedContactIds.size}/${required}</span>，未选空位会由 AI 补齐</div>
                        </div>
                        <button class="games-werewolf-icon-btn" id="games-werewolf-invite-close" type="button" aria-label="关闭">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div class="games-werewolf-contact-list">
                        ${contacts.length ? contacts.map(contact => {
                            const checked = this._selectedContactIds.has(contact.id);
                            const disabled = !checked && this._selectedContactIds.size >= required;
                            return `
                                <button class="games-werewolf-contact-choice ${checked ? 'is-active' : ''}" type="button" data-contact-id="${this._escapeAttr(contact.id)}" ${disabled ? 'disabled' : ''}>
                                    <span class="games-werewolf-contact-avatar">${this.app.renderPlayerAvatar({ name: contact.name, avatar: contact.avatar })}</span>
                                    <span>${this._escape(contact.name)}</span>
                                    <i class="fa-solid ${checked ? 'fa-check' : 'fa-plus'}"></i>
                                </button>
                            `;
                        }).join('') : '<div class="games-werewolf-contact-empty">微信通讯录暂无可邀请好友，将由 AI 自动补齐。</div>'}
                    </div>
                    <button class="games-werewolf-entry-btn is-primary" id="games-werewolf-invite-start" type="button">开始匹配</button>
                </div>
            </div>
        `;
    }

    _renderSettingsOverlay() {
        if (!this._settingsOpen) return '';
        const prompt = this.app.getWerewolfPrompt();
        const worldbookChecked = this.app.isWerewolfWorldbookEnabled() ? 'checked' : '';
        return `
            <div class="games-werewolf-settings-overlay" id="games-werewolf-settings-overlay">
                <div class="games-werewolf-settings-panel">
                    <div class="games-werewolf-invite-head">
                        <div>
                            <div class="games-werewolf-entry-title">狼人杀设置</div>
                            <div class="games-werewolf-entry-desc">默认提示词与世界书</div>
                        </div>
                        <button class="games-werewolf-icon-btn" id="games-werewolf-settings-close" type="button" aria-label="关闭">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <label class="games-werewolf-setting-toggle">
                        <span>使用世界书</span>
                        <input id="games-werewolf-worldbook-enabled" type="checkbox" ${worldbookChecked}>
                    </label>
                    <div class="games-werewolf-setting-desc">请求会注入角色卡和用户信息；开启后额外注入已勾选世界书，不注入酒馆最近正文。</div>
                    <div class="games-werewolf-worldbook-list" id="games-werewolf-worldbook-list">
                        <div class="games-werewolf-setting-desc">正在读取当前可用世界书...</div>
                    </div>
                    <div class="games-werewolf-prompt-card">
                        <div class="games-werewolf-prompt-title">默认狼人杀提示词</div>
                        <textarea id="games-werewolf-ai-prompt" class="games-werewolf-settings-textarea">${this._escape(prompt)}</textarea>
                        <div class="games-werewolf-prompt-actions">
                            <button class="games-werewolf-entry-btn" id="games-werewolf-prompt-reset" type="button">恢复默认</button>
                            <button class="games-werewolf-entry-btn is-primary" id="games-werewolf-prompt-save" type="button">保存</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    _renderRecordOverlay(state) {
        if (!this._recordOpen) return '';
        const gameOver = !!state.gameOver || state.phase === 'ended';
        const records = (Array.isArray(state.replayLog) ? state.replayLog : [])
            .map(item => this._getDisplayRecord(item, gameOver))
            .filter(Boolean);
        return `
            <div class="games-werewolf-record-overlay" id="games-werewolf-record-overlay">
                <div class="games-werewolf-record-panel">
                    <div class="games-werewolf-invite-head">
                        <div>
                            <div class="games-werewolf-entry-title">狼人杀复盘</div>
                            <div class="games-werewolf-entry-desc">${gameOver ? '游戏已结束，完整后台记录已解锁' : '游戏进行中，仅显示公开记录和脱敏夜晚记录'}</div>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <button class="games-werewolf-icon-btn" id="games-werewolf-share-record" type="button" aria-label="分享到微信" title="分享到微信">
                                <i class="fa-solid fa-share-nodes"></i>
                            </button>
                            <button class="games-werewolf-icon-btn" id="games-werewolf-record-close" type="button" aria-label="关闭">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                    </div>
                    <div class="games-werewolf-record-list">
                        ${records.length ? records.map(item => `
                            <div class="games-werewolf-record-item is-${this._escapeAttr(item.visibility || 'private')}">
                                <span>${this._escape(this._formatRecordMeta(item))}</span>
                                <p>${this._escape(item.displayText || '')}</p>
                            </div>
                        `).join('') : '<div class="games-werewolf-contact-empty">暂无复盘记录</div>'}
                    </div>
                    ${this._renderShareOverlay()}
                </div>
            </div>
        `;
    }

    _renderShareOverlay() {
        if (!this._shareOverlayOpen) return '';
        const shareText = this.app.getWerewolfShareText?.() || '';
        const preview = shareText.split('\n').slice(0, 5).join('\n');
        const target = this._shareTarget;
        if (target) {
            return `
                <div class="games-share-overlay" id="games-werewolf-share-overlay">
                    <div class="games-share-dialog games-share-compose">
                        <div class="games-share-header">
                            <button class="games-share-close" id="games-werewolf-share-back" type="button"><i class="fa-solid fa-chevron-left"></i></button>
                            <span>发送给</span>
                            <button class="games-share-close" id="games-werewolf-share-close" type="button"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                        <div class="games-share-recipient">
                            <div class="games-share-avatar">${this.app.renderPlayerAvatar({ name: target.name, avatar: target.avatar })}</div>
                            <div class="games-share-name">${this._escape(target.name)}</div>
                        </div>
                        <div class="games-share-preview">
                            <div class="games-share-card">
                                <div class="games-share-card-icon">狼</div>
                                <div>
                                    <div class="games-share-card-title">狼人杀复盘记录</div>
                                    <div class="games-share-card-desc">${this._escape(preview)}</div>
                                </div>
                            </div>
                        </div>
                        <div class="games-share-actions">
                            <button class="games-share-action games-share-cancel" id="games-werewolf-share-cancel" type="button">取消</button>
                            <button class="games-share-action games-share-send" id="games-werewolf-share-send" type="button">发送</button>
                        </div>
                    </div>
                </div>
            `;
        }

        const targets = this._getShareTargets();
        return `
            <div class="games-share-overlay" id="games-werewolf-share-overlay">
                <div class="games-share-dialog">
                    <div class="games-share-header">
                        <span>分享到微信</span>
                        <button class="games-share-close" id="games-werewolf-share-close" type="button"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div class="games-share-preview">
                        <div class="games-share-card">
                            <div class="games-share-card-icon">狼</div>
                            <div>
                                <div class="games-share-card-title">狼人杀复盘记录</div>
                                <div class="games-share-card-desc">${this._escape(preview)}</div>
                            </div>
                        </div>
                    </div>
                    <div class="games-share-list">
                        ${targets.length ? targets.map(item => `
                            <button class="games-share-contact games-werewolf-share-contact" type="button" data-name="${this._escapeAttr(item.name)}">
                                <span class="games-share-avatar">${this.app.renderPlayerAvatar({ name: item.name, avatar: item.avatar })}</span>
                                <span class="games-share-name">${this._escape(item.name)}</span>
                            </button>
                        `).join('') : '<div class="games-share-empty">请先在微信中添加联系人</div>'}
                    </div>
                </div>
            </div>
        `;
    }

    _getShareTargets() {
        const wechatData = this.app.getWechatData?.();
        if (!wechatData) return [];
        const contacts = (wechatData.getContacts?.() || [])
            .filter(item => item && String(item.name || '').trim())
            .map(item => ({
                name: String(item.name || '').trim(),
                avatar: this.app.resolveContactAvatar?.(item, wechatData) || item.avatar || ''
            }));
        const groups = (wechatData.getChatList?.() || [])
            .filter(item => item?.type === 'group' && String(item.name || '').trim())
            .map(item => ({
                name: String(item.name || '').trim(),
                avatar: item.avatar || '👥',
                isGroup: true
            }));
        const seen = new Set();
        return [...contacts, ...groups].filter(item => {
            if (seen.has(item.name)) return false;
            seen.add(item.name);
            return true;
        });
    }

    _getDisplayRecord(item = {}, gameOver = false) {
        if (gameOver) return { ...item, displayText: item.text || '' };
        if (item.visibility === 'public') return { ...item, displayText: item.text || '' };
        const redactedText = String(item.redactedText || '').trim();
        if (!redactedText) return null;
        return { ...item, displayText: redactedText };
    }

    _formatRecordMeta(item = {}) {
        const phaseMap = { setup: '准备', night: '夜晚', day: '白天', vote: '投票', last_words: '遗言', ended: '结束' };
        const visibility = item.visibility === 'public' ? '公开' : '后台';
        return `第${Number(item.day || 1)}天 · ${phaseMap[item.phase] || item.phase || '记录'} · ${visibility}`;
    }

    async renderWerewolfWorldbookList() {
        const container = document.getElementById('games-werewolf-worldbook-list');
        const manager = window.VirtualPhone?.worldbookManager;
        if (!container || !manager) return;
        if (!this.app.isWerewolfWorldbookEnabled()) {
            container.innerHTML = '<div class="games-werewolf-setting-desc">世界书注入已关闭。</div>';
            return;
        }
        try {
            const sources = await manager.listAvailableWorldbooks({ includeEntries: false, force: true });
            const selection = manager.getSelectionState('games');
            if (!sources.length) {
                container.innerHTML = '<div class="games-werewolf-setting-desc">未读取到世界书列表。</div>';
                return;
            }
            const isSelected = source => selection.initialized && manager.matchesSelection?.(source, selection.ids);
            container.innerHTML = [...sources].sort((a, b) => Number(isSelected(b)) - Number(isSelected(a))).map(source => `
                <label class="games-werewolf-worldbook-item">
                    <input type="checkbox" class="games-werewolf-worldbook-choice" value="${this._escapeAttr(source.id)}" ${isSelected(source) ? 'checked' : ''}>
                    <span>
                        <strong>${this._escape(source.name)}</strong>
                        <em>${this._escape(source.sourceLabel || '世界书')} · ${isSelected(source) ? '发送时读取并注入' : '未勾选不读取'}</em>
                    </span>
                </label>
            `).join('');
            container.querySelectorAll('.games-werewolf-worldbook-choice').forEach(input => {
                input.addEventListener('change', async () => {
                    const ids = Array.from(container.querySelectorAll('.games-werewolf-worldbook-choice:checked')).map(item => item.value);
                    await manager.setSelection('games', ids);
                    this.renderWerewolfWorldbookList();
                });
            });
        } catch (error) {
            console.warn('[Werewolf] 世界书列表渲染失败:', error);
            container.innerHTML = '<div class="games-werewolf-setting-desc">世界书读取失败，请稍后重试。</div>';
        }
    }

    _emptySeatCount() {
        return this.app.werewolfData.getEmptySeats().length;
    }

    _loadCSS() {
        if (this._cssLoaded) return Promise.resolve();
        const existing = document.getElementById('games-werewolf-css');
        if (existing) {
            this._cssLoaded = true;
            if (existing.sheet) return Promise.resolve();
            return new Promise(resolve => {
                existing.addEventListener('load', resolve, { once: true });
                existing.addEventListener('error', resolve, { once: true });
                setTimeout(resolve, 300);
            });
        }
        const link = document.createElement('link');
        link.id = 'games-werewolf-css';
        link.rel = 'stylesheet';
        link.href = new URL('./werewolf.css?v=1.0.48', import.meta.url).href;
        document.head.appendChild(link);
        this._cssLoaded = true;
        return new Promise(resolve => {
            link.addEventListener('load', resolve, { once: true });
            link.addEventListener('error', resolve, { once: true });
            setTimeout(resolve, 300);
        });
    }

    _escape(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _escapeAttr(text) {
        return this._escape(text);
    }
}
