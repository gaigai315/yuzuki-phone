/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 * ======================================================== */

import { STREET_LABELS } from './poker-data.js';

export class PokerView {
    constructor(app) {
        this.app = app;
        this._cssLoaded = false;
        this._actionPanelOpen = false;
        this._logPanelOpen = false;
        this._pendingChatInput = '';
        this._wagerModalOpen = false;
        this._wagerModalAction = '';
        this._wagerModalValue = '';
        this._wagerModalDefault = 0;
        this._setupOpen = false;
        this._settingsOpen = false;
        this._aiErrorDialog = null;
        this._shareOverlayOpen = false;
        this._shareTarget = null;
        this._speechQueue = [];
        this._activeSeatSpeech = null;
        this._lastSpeechAt = 0;
        this._speechTimer = null;
    }

    renderLobby() {
        this._loadCSS();
        const html = `
            <div class="games-app games-lobby">
                <div class="games-topbar">
                    <button class="games-back-btn" id="games-back-home" type="button" aria-label="返回">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div>
                        <div class="games-title">游戏</div>
                        <div class="games-subtitle">选择一个游戏开始</div>
                    </div>
                    <button class="games-icon-btn" id="games-settings-open" type="button" title="游戏设置">
                        <i class="fa-solid fa-gear"></i>
                    </button>
                </div>

                <div class="games-lobby-content">
                    <button class="games-game-card games-werewolf-card" id="games-open-werewolf" type="button">
                        <div class="games-game-art">
                            <div class="games-werewolf-lobby-art" aria-hidden="true">狼</div>
                        </div>
                        <div class="games-game-info">
                            <div class="games-game-title">狼人杀</div>
                            <div class="games-game-desc">身份推理 · 联机游戏</div>
                        </div>
                        <i class="fa-solid fa-chevron-right games-game-chevron"></i>
                    </button>

                    <button class="games-game-card games-poker-card" id="games-open-poker" type="button">
                        <div class="games-game-art">
                            <span class="games-lobby-card games-lobby-card-black">A♠</span>
                            <span class="games-lobby-card games-lobby-card-red">K♥</span>
                        </div>
                        <div class="games-game-info">
                            <div class="games-game-title">德州扑克</div>
                            <div class="games-game-desc">2-6人牌桌 · 联机游戏</div>
                        </div>
                        <i class="fa-solid fa-chevron-right games-game-chevron"></i>
                    </button>

                    <button class="games-game-card games-2048-card" id="games-open-2048" type="button">
                        <div class="games-game-art">
                            <div class="games-2048-lobby-art" aria-hidden="true">
                                <span>2</span><span>4</span><span>8</span><span>∞</span>
                            </div>
                        </div>
                        <div class="games-game-info">
                            <div class="games-game-title">奇点融合</div>
                            <div class="games-game-desc">2048 · 单机游戏</div>
                        </div>
                        <i class="fa-solid fa-chevron-right games-game-chevron"></i>
                    </button>

                    <button class="games-game-card games-sudoku-card" id="games-open-sudoku" type="button">
                        <div class="games-game-art">
                            <div class="games-sudoku-lobby-art" aria-hidden="true">
                                <span>3</span><span>9</span><span>1</span><span>5</span>
                            </div>
                        </div>
                        <div class="games-game-info">
                            <div class="games-game-title">每日数独</div>
                            <div class="games-game-desc">9x9 · 单机游戏</div>
                        </div>
                        <i class="fa-solid fa-chevron-right games-game-chevron"></i>
                    </button>

                    <button class="games-game-card games-catbox-card" id="games-open-catbox" type="button">
                        <div class="games-game-art">
                            <div class="games-catbox-lobby-art" aria-hidden="true">
                                <i class="fa-solid fa-paw"></i>
                            </div>
                        </div>
                        <div class="games-game-info">
                            <div class="games-game-title">猫盒</div>
                            <div class="games-game-desc">像素小猫 · 领养养成</div>
                        </div>
                        <i class="fa-solid fa-chevron-right games-game-chevron"></i>
                    </button>
                </div>
                ${this._renderPokerSetupOverlay()}
                ${this._renderSettingsOverlay()}
                ${this._renderAiErrorDialog()}
            </div>
        `;

        this.app.phoneShell.setContent(html, 'games-lobby');
        this._bindLobbyEvents();
    }

    renderPoker() {
        this._loadCSS();
        const state = this.app.gamesData.getState();
        if (!state) {
            this._setupOpen = true;
            this.renderLobby();
            return;
        }
        const actions = this.app.gamesData.getUserActions();

        const html = `
            <div class="games-app">
                <div class="games-topbar">
                    <div class="games-title-wrap">
                        <div class="games-title">
                            <span class="games-title-text">德州扑克<span class="status-dot ${this.app.getPokerStatusDotClass?.() || 'dot-green'}"></span></span>
                        </div>
                        <div class="games-subtitle">第 ${state.handNo} 局 · ${STREET_LABELS[state.street] || '牌桌'}</div>
                    </div>
                    <button class="games-icon-btn" id="games-share-poker" type="button" title="分享到微信">
                        <i class="fa-solid fa-share-nodes"></i>
                    </button>
                    <button class="games-icon-btn games-icon-btn-home" id="games-back-lobby" type="button" title="返回大厅">
                        <i class="fa-solid fa-house"></i>
                    </button>
                </div>

                <div class="games-poker-table-wrap">
                    <div class="games-poker-table">
                        ${state.players.filter(player => player.id !== 'user').map(player => this._renderSeat(player, state)).join('')}
                        <div class="games-board">
                            <div class="games-pot">
                                <span>底池</span>
                                <strong>${this._fmt(state.pot)}</strong>
                            </div>
                            <div class="games-community">
                                ${[0, 1, 2, 3, 4].map(idx => this._renderCard(state.community[idx], true)).join('')}
                            </div>
                            <div class="games-round-info">
                                <span>最低跟注 ${this._fmt(Math.max(0, state.currentBet - this._user(state).bet))}</span>
                                <span>当前注额 ${this._fmt(state.currentBet)}</span>
                            </div>
                        </div>
                        ${this._renderSeat(this._user(state), state)}
                    </div>
                </div>

                <div class="games-bottom-panel">
                    <div class="games-message">
                        <span><i class="fa-solid fa-user-tie"></i> 荷官</span>
                        <strong>${this._escape(state.dealerMessage || state.message || '')}</strong>
                    </div>
                    ${this._renderActionPanel(state, actions)}
                </div>
                ${this._renderWagerModal()}
                ${this._renderShareOverlay()}
                ${this._renderSettingsOverlay()}
                ${this._renderAiErrorDialog()}
            </div>
        `;

        this.app.phoneShell.setContent(html, 'games-poker');
        this._bindPokerEvents();
        this._syncSeatSpeechFromState(state);
    }

    openPokerSetupOverlay() {
        this._setupOpen = true;
        this.renderLobby();
    }

    _renderPokerSetupOverlay() {
        if (!this._setupOpen) return '';
        const selectedCount = this.app.gamesData.getSelectedPlayerCount();
        const chipsMode = this.app.gamesData.getChipsMode();
        const contacts = this.app.getWechatContactsForPoker();
        const availableIds = new Set(contacts.map(contact => contact.id));
        const cleanSelectedIds = this.app.gamesData.getSelectedContactIds().filter(id => availableIds.has(id));
        if (cleanSelectedIds.length !== this.app.gamesData.getSelectedContactIds().length) {
            this.app.gamesData.setSelectedContactIds(cleanSelectedIds);
        }
        const selectedIds = new Set(cleanSelectedIds);
        const requiredFriends = Math.max(1, selectedCount - 1);
        const selectedFriends = contacts.filter(contact => selectedIds.has(contact.id)).slice(0, requiredFriends);
        const canStart = selectedFriends.length === requiredFriends;
        return `
            <div class="games-setup-overlay" id="games-setup-overlay">
                <div class="games-setup-panel">
                    <div class="games-setup-hero">
                        <div class="games-game-card-stack">
                            ${this._renderCard({ rank: 'A', suitSymbol: '♠', color: 'black' }, true)}
                            ${this._renderCard({ rank: 'K', suitSymbol: '♥', color: 'red' }, true)}
                        </div>
                        <div>
                            <div class="games-game-title">德州扑克</div>
                        </div>
                    </div>

                    <div class="games-setup-label">游戏人数</div>
                    <div class="games-player-count-grid">
                        ${[2, 3, 4, 5, 6].map(count => `
                            <button class="games-player-count-btn ${count === selectedCount ? 'is-active' : ''}" type="button" data-player-count="${count}">
                                ${count}人
                            </button>
                        `).join('')}
                    </div>

                    <div class="games-setup-label">邀请微信好友 <span>${selectedFriends.length}/${requiredFriends}</span></div>
                    <div class="games-contact-list">
                        ${contacts.length ? contacts.map(contact => {
                            const checked = selectedIds.has(contact.id);
                            const disabled = !checked && selectedFriends.length >= requiredFriends;
                            return `
                                <button class="games-contact-choice ${checked ? 'is-active' : ''}" type="button" data-contact-id="${this._escape(contact.id)}" ${disabled ? 'disabled' : ''}>
                                    <span class="games-contact-avatar">${this.app.renderPlayerAvatar({ name: contact.name, avatar: contact.avatar })}</span>
                                    <span>${this._escape(contact.name)}</span>
                                    <i class="fa-solid ${checked ? 'fa-check' : 'fa-plus'}"></i>
                                </button>
                            `;
                        }).join('') : '<div class="games-contact-empty">微信通讯录暂无可邀请好友</div>'}
                    </div>

                    <div class="games-setup-label">起始筹码</div>
                    <div class="games-chips-mode-grid">
                        <button class="games-player-count-btn ${chipsMode === 'equal' ? 'is-active' : ''}" type="button" data-chips-mode="equal">
                            平均筹码
                        </button>
                        <button class="games-player-count-btn ${chipsMode === 'random' ? 'is-active' : ''}" type="button" data-chips-mode="random">
                            随机筹码
                        </button>
                    </div>

                    <div class="games-setup-actions">
                        <button class="games-player-count-btn" id="games-poker-setup-cancel" type="button">取消</button>
                        <button class="games-primary-btn games-start-btn" id="games-start-poker" type="button" ${canStart ? '' : 'disabled'}>开始游戏</button>
                    </div>
                </div>
            </div>
        `;
    }

    _renderSettingsOverlay() {
        if (!this._settingsOpen) return '';
        const prompt = this.app.getPokerPrompt();
        const speechChecked = this.app.isPokerAiSpeechEnabled() ? 'checked' : '';
        const worldbookChecked = this.app.isPokerWorldbookEnabled() ? 'checked' : '';
        return `
            <div class="games-settings-overlay" id="games-settings-overlay">
                <div class="games-settings-panel">
                    <div class="games-settings-head">
                        <div>
                            <div class="games-game-title">德州扑克设置</div>
                            <div class="games-game-desc">AI 行动与牌桌发言提示词</div>
                        </div>
                        <button class="games-icon-btn" id="games-settings-close" type="button" title="关闭">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <label class="games-setting-toggle">
                        <span>AI 发言</span>
                        <input id="games-poker-ai-speech" type="checkbox" ${speechChecked}>
                    </label>
                    <label class="games-setting-toggle">
                        <span>使用酒馆世界书</span>
                        <input id="games-poker-worldbook-enabled" type="checkbox" ${worldbookChecked}>
                    </label>
                    <div class="games-setting-desc">开启后会注入当前角色卡对应勾选的世界书、角色卡、用户卡与最近酒馆上下文。</div>
                    <div class="games-worldbook-list" id="games-worldbook-list">
                        <div class="games-setting-desc">正在读取当前可用世界书...</div>
                    </div>
                    <div class="games-prompt-card">
                        <div class="games-prompt-title">默认德州扑克提示词</div>
                        <div class="games-prompt-desc">控制微信好友在牌桌中的发言、下注决策和互动边界。</div>
                        <textarea id="games-poker-ai-prompt" class="games-settings-textarea">${this._escape(prompt)}</textarea>
                        <div class="games-prompt-actions">
                            <button class="games-prompt-btn games-prompt-btn-muted" id="games-poker-prompt-reset" type="button">恢复默认</button>
                            <button class="games-prompt-btn games-prompt-btn-primary" id="games-poker-prompt-save" type="button">保存</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    _renderAiErrorDialog() {
        if (!this._aiErrorDialog) return '';
        return `
            <div class="games-ai-error-overlay" id="games-ai-error-overlay">
                <div class="games-ai-error-panel">
                    <div class="games-ai-error-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
                    <div class="games-ai-error-title">${this._escape(this._aiErrorDialog.title || 'AI 请求失败')}</div>
                    <div class="games-ai-error-message">${this._escape(this._aiErrorDialog.message || '')}</div>
                    <button class="games-primary-btn" id="games-ai-error-close" type="button">知道了</button>
                </div>
            </div>
        `;
    }

    _renderSeat(player, state) {
        const isUser = player.id === 'user';
        const isActive = state.activePlayerId === player.id && state.phase === 'playing';
        const reveal = isUser || state.phase === 'showdown' || state.phase === 'complete';
        const dealer = state.players[state.dealerIndex]?.id === player.id;
        const seatClass = [
            'games-seat',
            `games-seat-${player.seat}`,
            isUser ? 'games-seat-user' : '',
            isActive ? 'is-active' : '',
            player.folded ? 'is-folded' : '',
            player.allIn ? 'is-allin' : ''
        ].filter(Boolean).join(' ');
        const handLabel = player.bestHand?.label || (isUser && state.community.length >= 3
            ? this.app.gamesData.evaluateBestHand([...player.cards, ...state.community])?.label
            : '');

        return `
            <div class="${seatClass}">
                ${this._renderSeatSpeech(player)}
                <div class="games-seat-cards">
                    ${player.cards.map(card => this._renderCard(card, reveal)).join('')}
                </div>
                <div class="games-player-plate">
                    <div class="games-avatar">${this.app.renderPlayerAvatar(player)}</div>
                    <div class="games-player-meta">
                        <div class="games-player-name">
                            ${this._escape(player.name)}
                        </div>
                        <div class="games-player-chips">${this._fmt(player.chips)}</div>
                    </div>
                </div>
                ${dealer ? '<span class="games-dealer">D</span>' : ''}
                <div class="games-player-status">${this._escape(player.status || (isActive ? '待行动' : '等待'))}</div>
                ${player.bet > 0 ? `<div class="games-bet-chip">${this._fmt(player.bet)}</div>` : ''}
                ${handLabel ? `<div class="games-hand-label">${this._escape(handLabel)}</div>` : ''}
            </div>
        `;
    }

    _renderSeatSpeech(player) {
        const speech = this._activeSeatSpeech;
        if (!speech || speech.playerId !== player.id) return '';
        return `<div class="games-seat-speech">${this._escape(speech.content)}</div>`;
    }

    _renderCard(card, reveal) {
        if (!card || !reveal) {
            return `<div class="games-card games-card-back"><span></span></div>`;
        }
        return `
            <div class="games-card games-card-${card.color}">
                <strong>${this._escape(card.rank)}</strong>
                <span>${this._escape(card.suitSymbol)}</span>
            </div>
        `;
    }

    _renderActionPanel(state, actions) {
        const logSheet = this._renderLog(state);
        if (state.phase === 'showdown' || state.phase === 'complete') {
            this._actionPanelOpen = false;
            this._wagerModalOpen = false;
            this._wagerModalValue = '';
            return `
                <div class="games-action-entry">
                    <button id="games-log-toggle" class="games-log-toggle ${this._logPanelOpen ? 'is-open' : ''}" type="button" aria-expanded="${this._logPanelOpen ? 'true' : 'false'}" title="回合记录">
                        <i class="fa-solid fa-bell"></i>
                    </button>
                    <div class="games-action-input games-action-input-static">查看本局结算</div>
                    <div class="games-action-toggle-spacer" aria-hidden="true"></div>
                </div>
                <div class="games-bottom-float-layer">
                    ${logSheet}
                </div>
                <div class="games-result">
                    ${(state.awards || []).map(item => `
                        <div>${this._escape(item.name)} 赢得 ${this._fmt(item.amount)} · ${this._escape(item.hand)}</div>
                    `).join('')}
                </div>
                <button class="games-primary-btn" id="games-next-hand" type="button">下一局</button>
            `;
        }

        const raiseBase = Math.max(state.currentBet + state.minRaise, state.bigBlind);
        const betBase = Math.max(state.bigBlind, state.minRaise);
        const wagerAction = actions.canBet ? 'bet' : 'raise';
        const defaultWager = actions.canBet ? betBase : raiseBase;
        const wagerLabel = actions.canBet ? '下注' : '加注';
        const canWager = actions.canBet || actions.canRaise;
        const callLabel = actions.callAmount ? `跟注 ${this._fmt(actions.callAmount)}` : '跟注';
        const inputValue = this._escape(this._pendingChatInput);
        const user = this._user(state);
        const maxWager = user ? (user.bet + user.chips) : defaultWager;
        const isBusy = !!this.app.isPokerBusy?.();
        const actionDisabled = isBusy ? 'disabled' : '';
        const actionToggleTitle = isBusy ? '等待牌桌回复' : '下注/行动';
        const actionItems = [];
        if (actions.canCheck) {
            actionItems.push(`<button class="games-action-btn" data-action="check" ${actionDisabled}>过牌</button>`);
        }
        if (actions.canCall) {
            actionItems.push(`<button class="games-action-btn" data-action="call" ${actionDisabled}>${callLabel}</button>`);
        }
        if (canWager) {
            actionItems.push(`<button class="games-action-btn" data-action="${wagerAction}" data-open-wager="1" data-default-amount="${defaultWager}" ${actionDisabled}>${wagerLabel}</button>`);
            actionItems.push(`<button class="games-action-btn games-random-wager-btn" data-action="${wagerAction}" data-open-wager="1" data-random-wager="1" data-default-amount="${defaultWager}" data-max-amount="${Math.max(defaultWager, maxWager)}" ${actionDisabled}>随机${wagerLabel}</button>`);
        }
        if (actions.canAllIn) {
            actionItems.push(`<button class="games-action-btn games-danger" data-action="allin" ${actionDisabled}>全下</button>`);
        }
        if (actions.canFold) {
            actionItems.push(`<button class="games-action-btn games-muted" data-action="fold" ${actionDisabled}>弃牌</button>`);
        }

        return `
            <div class="games-action-entry">
                <button id="games-log-toggle" class="games-log-toggle ${this._logPanelOpen ? 'is-open' : ''}" type="button" aria-expanded="${this._logPanelOpen ? 'true' : 'false'}" title="回合记录">
                    <i class="fa-solid fa-bell"></i>
                </button>
                <input
                    id="games-action-input"
                    class="games-action-input"
                    type="text"
                    autocomplete="off"
                    placeholder="输入消息"
                    value="${inputValue}">
                <button id="games-action-toggle" class="games-action-toggle ${this._actionPanelOpen ? 'is-open' : ''} ${isBusy ? 'is-waiting' : ''}" type="button" aria-expanded="${this._actionPanelOpen ? 'true' : 'false'}" title="${actionToggleTitle}" ${actionDisabled}>
                    <i class="fa-solid ${isBusy ? 'fa-hourglass-half' : 'fa-clone'}"></i>
                </button>
            </div>
            <div class="games-bottom-float-layer">
                ${logSheet}
                <div class="games-action-sheet ${this._actionPanelOpen ? 'is-open' : ''}" id="games-action-sheet">
                    <div class="games-actions">
                        ${actionItems.join('')}
                    </div>
                </div>
            </div>
        `;
    }

    _renderLog(state) {
        const lines = (state.log || []).slice(-5).reverse();
        return `
            <div class="games-log-sheet ${this._logPanelOpen ? 'is-open' : ''}" id="games-log-sheet">
                <div class="games-log">
                ${lines.map(line => `<div>${this._escape(line)}</div>`).join('')}
                </div>
            </div>
        `;
    }

    _bindLobbyEvents() {
        document.getElementById('games-back-home')?.addEventListener('click', () => {
            this.app.removePhoneChromeTheme();
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        });
        document.getElementById('games-open-poker')?.addEventListener('click', () => {
            this.openPokerSetupOverlay();
        });
        document.getElementById('games-open-2048')?.addEventListener('click', () => {
            this.app.open2048();
        });
        document.getElementById('games-open-sudoku')?.addEventListener('click', () => {
            this.app.openSudoku();
        });
        document.getElementById('games-open-catbox')?.addEventListener('click', () => {
            this.app.openCatbox();
        });
        document.getElementById('games-open-werewolf')?.addEventListener('click', () => {
            this.app.openWerewolf();
        });
        document.getElementById('games-settings-open')?.addEventListener('click', () => {
            this._settingsOpen = true;
            this.renderLobby();
        });
        document.getElementById('games-poker-setup-cancel')?.addEventListener('click', () => {
            this._setupOpen = false;
            this.renderLobby();
        });
        document.getElementById('games-setup-overlay')?.addEventListener('click', e => {
            if (e.target?.id !== 'games-setup-overlay') return;
            this._setupOpen = false;
            this.renderLobby();
        });
        this._bindPokerSetupEvents();
        this._bindSettingsEvents();
    }

    _bindPokerSetupEvents() {
        document.querySelectorAll('.games-player-count-btn[data-player-count]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.app.gamesData.setSelectedPlayerCount(Number(btn.dataset.playerCount || 5));
                const availableIds = new Set(this.app.getWechatContactsForPoker().map(contact => contact.id));
                const selected = this.app.gamesData.getSelectedContactIds().filter(id => availableIds.has(id));
                this.app.gamesData.setSelectedContactIds(selected);
                this.renderLobby();
            });
        });
        document.querySelectorAll('.games-contact-choice[data-contact-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = String(btn.dataset.contactId || '').trim();
                const availableIds = new Set(this.app.getWechatContactsForPoker().map(contact => contact.id));
                const selected = this.app.gamesData.getSelectedContactIds().filter(item => availableIds.has(item));
                const required = Math.max(1, this.app.gamesData.getSelectedPlayerCount() - 1);
                const exists = selected.includes(id);
                const next = exists ? selected.filter(item => item !== id) : [...selected, id].slice(0, required);
                this.app.gamesData.setSelectedContactIds(next);
                this.renderLobby();
            });
        });
        document.querySelectorAll('.games-player-count-btn[data-chips-mode]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.app.gamesData.setChipsMode(String(btn.dataset.chipsMode || 'equal'));
                this.renderLobby();
            });
        });
        document.getElementById('games-start-poker')?.addEventListener('click', () => {
            const contacts = this.app.getWechatContactsForPoker();
            const selected = new Set(this.app.gamesData.getSelectedContactIds());
            const required = Math.max(1, this.app.gamesData.getSelectedPlayerCount() - 1);
            const invited = contacts.filter(contact => selected.has(contact.id)).slice(0, required);
            if (invited.length !== required) {
                this.app.phoneShell?.showNotification?.('游戏', `请选择 ${required} 位微信好友`, '⚠️');
                return;
            }
            this._setupOpen = false;
            this.app.startPokerGame(this.app.gamesData.getSelectedPlayerCount(), invited);
        });
    }

    _bindPokerEvents() {
        document.getElementById('games-settings-open')?.addEventListener('click', () => {
            this._settingsOpen = true;
            this.renderPoker();
        });
        document.getElementById('games-share-poker')?.addEventListener('click', () => {
            this._shareOverlayOpen = true;
            this._shareTarget = null;
            this.renderPoker();
        });
        document.getElementById('games-back-lobby')?.addEventListener('click', () => {
            this.app.backToLobby();
        });
        document.getElementById('games-next-hand')?.addEventListener('click', () => {
            this.app.gamesData.startNewHand();
            this.renderPoker();
            this.app.drivePokerAi();
        });
        const logToggle = document.getElementById('games-log-toggle');
        const actionInput = document.getElementById('games-action-input');
        const actionToggle = document.getElementById('games-action-toggle');
        logToggle?.addEventListener('click', () => {
            const nextOpen = !this._logPanelOpen;
            this._logPanelOpen = nextOpen;
            if (nextOpen) this._actionPanelOpen = false;
            this.renderPoker();
        });
        actionInput?.addEventListener('input', () => {
            this._pendingChatInput = String(actionInput.value || '');
            this.app.handlePokerComposerChanged?.();
        });
        actionInput?.addEventListener('focus', () => {
            this.app.handlePokerComposerChanged?.();
        });
        actionInput?.addEventListener('blur', () => {
            setTimeout(() => this.app.handlePokerComposerChanged?.(), 0);
        });
        actionInput?.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const text = String(actionInput.value || '').trim();
            if (!text) return;
            this.app.sendPokerTableChat(text);
        });
        actionToggle?.addEventListener('click', () => {
            if (this.app.isPokerBusy?.()) {
                this.app.phoneShell?.showNotification?.('德州扑克', '正在等待牌桌回复，请稍后行动', '⏳');
                return;
            }
            const nextOpen = !this._actionPanelOpen;
            this._actionPanelOpen = nextOpen;
            if (nextOpen) this._logPanelOpen = false;
            this._wagerModalOpen = false;
            this.renderPoker();
            if (nextOpen) this.app.holdPendingPokerChatForAction?.();
            else this.app.cancelPendingPokerActionChat?.();
            this.app.handlePokerComposerChanged?.();
        });
        document.querySelectorAll('.games-action-btn[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.disabled) return;
                if (this.app.isPokerBusy?.()) {
                    this.app.phoneShell?.showNotification?.('德州扑克', '正在等待牌桌回复，请稍后行动', '⏳');
                    return;
                }
                if (btn.dataset.openWager === '1') {
                    const action = String(btn.dataset.action || '');
                    const defaultAmount = Number(btn.dataset.defaultAmount || 0);
                    const maxAmount = Number(btn.dataset.maxAmount || defaultAmount);
                    const useRandom = btn.dataset.randomWager === '1';
                    const initialAmount = useRandom
                        ? this._randomInt(defaultAmount, Math.max(defaultAmount, maxAmount))
                        : defaultAmount;
                    this._openWagerModal(action, defaultAmount, initialAmount);
                    return;
                }
                const action = btn.dataset.action;
                const pendingText = String(this._pendingChatInput || '').trim();
                if (pendingText) {
                    this.app.stagePokerTableChatForAction?.(pendingText);
                }
                this._actionPanelOpen = false;
                this._wagerModalOpen = false;
                this.app.handleUserPokerAction(action, Number(btn.dataset.amount || 0));
            });
        });

        document.getElementById('games-wager-modal-cancel')?.addEventListener('click', () => {
            this.app.cancelPendingPokerActionChat?.();
            this._wagerModalOpen = false;
            this.renderPoker();
        });
        document.getElementById('games-wager-modal-send')?.addEventListener('click', () => {
            if (this.app.isPokerBusy?.()) {
                this.app.phoneShell?.showNotification?.('德州扑克', '正在等待牌桌回复，请稍后行动', '⏳');
                return;
            }
            const amount = this._resolveModalWagerAmount();
            const pendingText = String(this._pendingChatInput || '').trim();
            if (pendingText) {
                this.app.stagePokerTableChatForAction?.(pendingText);
            }
            this._actionPanelOpen = false;
            this._wagerModalOpen = false;
            this.app.handleUserPokerAction(this._wagerModalAction, amount);
        });
        document.getElementById('games-wager-modal-input')?.addEventListener('input', e => {
            this._wagerModalValue = String(e?.target?.value || '');
        });
        document.getElementById('games-wager-modal-backdrop')?.addEventListener('click', e => {
            if (e.target?.id !== 'games-wager-modal-backdrop') return;
            this.app.cancelPendingPokerActionChat?.();
            this._wagerModalOpen = false;
            this.renderPoker();
        });
        this._bindShareEvents();
        this._bindSettingsEvents();
    }

    _bindShareEvents() {
        document.getElementById('games-share-close')?.addEventListener('click', () => {
            this._shareOverlayOpen = false;
            this._shareTarget = null;
            this.renderPoker();
        });
        document.getElementById('games-share-back')?.addEventListener('click', () => {
            this._shareTarget = null;
            this.renderPoker();
        });
        document.getElementById('games-share-cancel')?.addEventListener('click', () => {
            this._shareTarget = null;
            this.renderPoker();
        });
        document.getElementById('games-share-overlay')?.addEventListener('click', e => {
            if (e.target?.id !== 'games-share-overlay') return;
            this._shareOverlayOpen = false;
            this._shareTarget = null;
            this.renderPoker();
        });
        document.querySelectorAll('.games-share-contact[data-name]').forEach(item => {
            item.addEventListener('click', () => {
                const name = String(item.dataset.name || '').trim();
                const target = this._getShareTargets().find(entry => entry.name === name) || { name };
                this._shareTarget = target;
                this.renderPoker();
            });
        });
        document.getElementById('games-share-send')?.addEventListener('click', async () => {
            const target = this._shareTarget;
            if (!target?.name) return;
            const btn = document.getElementById('games-share-send');
            if (btn) btn.disabled = true;
            try {
                await this.app.sharePokerToWechat(target.name);
                this.app.phoneShell?.showNotification?.('分享成功', `已发送给 ${target.name}`, '✅');
                this._shareOverlayOpen = false;
                this._shareTarget = null;
                this.renderPoker();
            } catch (error) {
                this.app.phoneShell?.showNotification?.('分享失败', error?.message || '发送失败', '❌');
                if (btn) btn.disabled = false;
            }
        });
    }

    _bindSettingsEvents() {
        document.getElementById('games-settings-close')?.addEventListener('click', () => {
            this._settingsOpen = false;
            this.app.currentView === 'poker' ? this.renderPoker() : this.renderLobby();
        });
        document.getElementById('games-settings-overlay')?.addEventListener('click', e => {
            if (e.target?.id !== 'games-settings-overlay') return;
            this._settingsOpen = false;
            this.app.currentView === 'poker' ? this.renderPoker() : this.renderLobby();
        });
        document.getElementById('games-poker-ai-speech')?.addEventListener('change', e => {
            this.app.setPokerAiSpeechEnabled(!!e.target.checked);
        });
        this.renderGamesWorldbookList();
        document.getElementById('games-poker-worldbook-enabled')?.addEventListener('change', async e => {
            const enabled = !!e.target.checked;
            await this.app.setPokerWorldbookEnabled(enabled);
            if (enabled) this.renderGamesWorldbookList();
            else {
                const container = document.getElementById('games-worldbook-list');
                if (container) container.innerHTML = '<div class="games-setting-desc">世界书注入已关闭。</div>';
            }
        });
        document.getElementById('games-poker-prompt-save')?.addEventListener('click', () => {
            this.app.setPokerPrompt(document.getElementById('games-poker-ai-prompt')?.value || '');
            this.app.phoneShell?.showNotification?.('游戏设置', '德州扑克提示词已保存', '✅');
            this._settingsOpen = false;
            this.app.currentView === 'poker' ? this.renderPoker() : this.renderLobby();
        });
        document.getElementById('games-poker-prompt-reset')?.addEventListener('click', () => {
            const text = this.app.resetPokerPrompt();
            const textarea = document.getElementById('games-poker-ai-prompt');
            if (textarea) textarea.value = text;
            this.app.phoneShell?.showNotification?.('游戏设置', '德州扑克提示词已恢复默认', '✅');
        });
        document.getElementById('games-ai-error-close')?.addEventListener('click', () => {
            this._aiErrorDialog = null;
            this.app.currentView === 'poker' ? this.renderPoker() : this.renderLobby();
        });
        document.getElementById('games-ai-error-overlay')?.addEventListener('click', e => {
            if (e.target?.id !== 'games-ai-error-overlay') return;
            this._aiErrorDialog = null;
            this.app.currentView === 'poker' ? this.renderPoker() : this.renderLobby();
        });
    }

    clearPendingChatInput() {
        this._pendingChatInput = '';
    }

    clearPokerActionInputDom({ keepFocus = false } = {}) {
        const input = document.querySelector('.phone-view-current #games-action-input') || document.getElementById('games-action-input');
        if (!input) return;
        input.value = '';
        this._pendingChatInput = '';
        if (keepFocus && document.activeElement === input) {
            requestAnimationFrame(() => input.focus({ preventScroll: true }));
        }
    }

    isPokerComposing() {
        if (this._actionPanelOpen || this._wagerModalOpen || this._shareOverlayOpen || this._settingsOpen) return true;
        const input = document.querySelector('.phone-view-current #games-action-input') || document.getElementById('games-action-input');
        const inputText = String(input?.value || this._pendingChatInput || '').trim();
        const inputFocused = !!input && document.activeElement === input;
        return inputFocused || inputText !== '';
    }

    _syncSeatSpeechFromState(state) {
        const speeches = Array.isArray(state?.speechEvents) && state.speechEvents.length
            ? state.speechEvents
            : (state?.lastSpeech ? [state.lastSpeech] : []);
        const pending = speeches
            .filter(speech => speech?.content && speech?.at && Number(speech.at) > Number(this._lastSpeechAt || 0))
            .sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
        if (!pending.length) return;
        pending.forEach(speech => {
            this._lastSpeechAt = Math.max(Number(this._lastSpeechAt || 0), Number(speech.at || 0));
            this._enqueueSeatSpeech(speech);
        });
    }

    syncLatestSeatSpeechFromState() {
        this._syncSeatSpeechFromState(this.app.gamesData.getState());
    }

    _enqueueSeatSpeech(speech) {
        const playerId = String(speech.playerId || this._resolveSpeechPlayerId(speech.sender) || '').trim();
        if (!playerId) return;
        this._speechQueue.push({
            playerId,
            sender: String(speech.sender || '').trim(),
            content: String(speech.content || '').trim(),
            at: Number(speech.at || Date.now())
        });
        if (!this._activeSeatSpeech) this._showNextSeatSpeech();
    }

    _showNextSeatSpeech() {
        if (this._speechTimer) {
            clearTimeout(this._speechTimer);
            this._speechTimer = null;
        }
        const next = this._speechQueue.shift();
        if (!next || !next.content) {
            this._activeSeatSpeech = null;
            return;
        }
        this._activeSeatSpeech = next;
        this._paintActiveSeatSpeech();
        this._speechTimer = setTimeout(() => {
            this._activeSeatSpeech = null;
            this._paintActiveSeatSpeech();
            this._showNextSeatSpeech();
        }, 4000);
    }

    _paintActiveSeatSpeech() {
        const root = document.querySelector('.phone-view-current .games-app');
        if (!root) return;
        root.querySelectorAll('.games-seat-speech').forEach(node => node.remove());
        const speech = this._activeSeatSpeech;
        if (!speech) return;
        const state = this.app.gamesData.getState();
        const player = state?.players?.find(item => item.id === speech.playerId);
        if (!player) return;
        const seat = root.querySelector(`.games-seat-${player.seat}`);
        if (!seat) return;
        seat.insertAdjacentHTML('afterbegin', `<div class="games-seat-speech">${this._escape(speech.content)}</div>`);
    }

    _resolveSpeechPlayerId(sender) {
        const name = String(sender || '').trim();
        const state = this.app.gamesData.getState();
        return state?.players?.find(player => player.name === name || player.id === name)?.id || '';
    }

    showAiErrorDialog(title, message) {
        this._aiErrorDialog = {
            title: String(title || 'AI 请求失败'),
            message: String(message || '')
        };
        this.renderPoker();
    }

    _renderShareOverlay() {
        if (!this._shareOverlayOpen) return '';
        const shareText = this.app.getPokerShareText?.() || '';
        const preview = shareText.split('\n').slice(0, 5).join('\n');
        const target = this._shareTarget;
        if (target) {
            return `
                <div class="games-share-overlay" id="games-share-overlay">
                    <div class="games-share-dialog games-share-compose">
                        <div class="games-share-header">
                            <button class="games-share-close" id="games-share-back" type="button"><i class="fa-solid fa-chevron-left"></i></button>
                            <span>发送给</span>
                            <button class="games-share-close" id="games-share-close" type="button"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                        <div class="games-share-recipient">
                            <div class="games-share-avatar">${this.app.renderPlayerAvatar({ name: target.name, avatar: target.avatar })}</div>
                            <div class="games-share-name">${this._escape(target.name)}</div>
                        </div>
                        <div class="games-share-preview">
                            <div class="games-share-card">
                                <div class="games-share-card-icon">牌</div>
                                <div>
                                    <div class="games-share-card-title">德州扑克牌局记录</div>
                                    <div class="games-share-card-desc">${this._escape(preview)}</div>
                                </div>
                            </div>
                        </div>
                        <div class="games-share-actions">
                            <button class="games-share-action games-share-cancel" id="games-share-cancel" type="button">取消</button>
                            <button class="games-share-action games-share-send" id="games-share-send" type="button">发送</button>
                        </div>
                    </div>
                </div>
            `;
        }

        const targets = this._getShareTargets();
        return `
            <div class="games-share-overlay" id="games-share-overlay">
                <div class="games-share-dialog">
                    <div class="games-share-header">
                        <span>分享到微信</span>
                        <button class="games-share-close" id="games-share-close" type="button"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div class="games-share-preview">
                        <div class="games-share-card">
                            <div class="games-share-card-icon">牌</div>
                            <div>
                                <div class="games-share-card-title">德州扑克牌局记录</div>
                                <div class="games-share-card-desc">${this._escape(preview)}</div>
                            </div>
                        </div>
                    </div>
                    <div class="games-share-list">
                        ${targets.length ? targets.map(item => `
                            <button class="games-share-contact" type="button" data-name="${this._escape(item.name)}">
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

    syncPokerStatusDot() {
        const dot = document.querySelector('.phone-view-current .games-title .status-dot')
            || document.querySelector('.games-title .status-dot');
        if (!dot) return;
        dot.classList.remove('dot-green', 'dot-yellow', 'dot-red');
        dot.classList.add(this.app.getPokerStatusDotClass?.() || 'dot-green');
    }

    async renderGamesWorldbookList() {
        const container = document.getElementById('games-worldbook-list');
        const manager = window.VirtualPhone?.worldbookManager;
        if (!container || !manager) return;

        if (!this.app.isPokerWorldbookEnabled()) {
            container.innerHTML = '<div class="games-setting-desc">世界书注入已关闭。</div>';
            return;
        }

        try {
            const sources = await manager.listAvailableWorldbooks({ includeEntries: false, force: true });
            const selection = manager.getSelectionState('games');
            if (!sources.length) {
                container.innerHTML = '<div class="games-setting-desc">未读取到酒馆世界书列表。</div>';
                return;
            }
            const isSelected = source => selection.initialized && manager.matchesSelection?.(source, selection.ids);
            const displaySources = [...sources].sort((a, b) => Number(isSelected(b)) - Number(isSelected(a)));
            container.innerHTML = displaySources.map(source => {
                const checked = isSelected(source) ? 'checked' : '';
                const disabledText = '';
                const countText = checked ? '发送时读取并注入' : '未勾选不读取';
                return `
                    <label class="games-worldbook-item">
                        <input type="checkbox" class="games-worldbook-choice" value="${this._escape(source.id)}" ${checked}>
                        <span>
                            <strong>${this._escape(source.name)}${this._escape(disabledText)}</strong>
                            <em>${this._escape(source.sourceLabel || '世界书')} · ${this._escape(countText)}</em>
                        </span>
                    </label>
                `;
            }).join('');

            container.querySelectorAll('.games-worldbook-choice').forEach(input => {
                input.addEventListener('change', async () => {
                    const ids = Array.from(container.querySelectorAll('.games-worldbook-choice:checked')).map(item => item.value);
                    await manager.setSelection('games', ids);
                    this.renderGamesWorldbookList();
                });
            });
        } catch (error) {
            console.warn('[Games] 世界书列表渲染失败:', error);
            container.innerHTML = '<div class="games-setting-desc games-setting-error">世界书读取失败，请稍后重试。</div>';
        }
    }

    _openWagerModal(action, defaultAmount, initialAmount) {
        this._wagerModalAction = action;
        this._wagerModalDefault = Number(defaultAmount || 0);
        this._wagerModalValue = String(initialAmount || this._wagerModalDefault || '');
        this._actionPanelOpen = false;
        this._wagerModalOpen = true;
        this.renderPoker();
    }

    _resolveModalWagerAmount() {
        const raw = String(document.getElementById('games-wager-modal-input')?.value || this._wagerModalValue || '').trim();
        this._wagerModalValue = raw;
        const numeric = raw.replace(/[^\d]/g, '');
        const requestedAmount = numeric ? Number(numeric) : this._wagerModalDefault;
        if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) return this._wagerModalDefault;
        return requestedAmount;
    }

    _randomInt(minValue, maxValue) {
        const min = Math.max(1, Math.floor(Number(minValue) || 1));
        const max = Math.max(min, Math.floor(Number(maxValue) || min));
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    _renderWagerModal() {
        if (!this._wagerModalOpen) return '';
        const title = this._wagerModalAction === 'raise' ? '输入加注金额' : '输入下注金额';
        return `
            <div class="games-wager-modal-backdrop" id="games-wager-modal-backdrop">
                <div class="games-wager-modal">
                    <div class="games-wager-modal-title">${title}</div>
                    <input id="games-wager-modal-input" class="games-wager-modal-input" type="text" inputmode="numeric" autocomplete="off" value="${this._escape(this._wagerModalValue)}">
                    <div class="games-wager-modal-actions">
                        <button id="games-wager-modal-cancel" class="games-player-count-btn" type="button">取消</button>
                        <button id="games-wager-modal-send" class="games-primary-btn games-wager-send-btn" type="button">发送</button>
                    </div>
                </div>
            </div>
        `;
    }

    _loadCSS() {
        if (this._cssLoaded) return;
        if (document.getElementById('games-css')) {
            this._cssLoaded = true;
            return;
        }
        const link = document.createElement('link');
        link.id = 'games-css';
        link.rel = 'stylesheet';
        link.href = new URL('./poker.css?v=1.0.0', import.meta.url).href;
        document.head.appendChild(link);
        this._cssLoaded = true;
    }

    _user(state) {
        return state.players.find(player => player.id === 'user');
    }

    _fmt(value) {
        return Number(value || 0).toLocaleString('zh-CN');
    }

    _escape(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}
