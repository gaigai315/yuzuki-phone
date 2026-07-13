const UNDERCOVER_CSS_URL = new URL('./undercover.css?v=1.0.24', import.meta.url).href;
const UNDERCOVER_BACKGROUND_URL = new URL('./assets/sswdzt.png', import.meta.url).href;
const UNDERCOVER_GAME_BACKGROUND_URL = new URL('./assets/sswd.png', import.meta.url).href;
const UNDERCOVER_WORD_CARD_URL = new URL('./assets/sswdch.png', import.meta.url).href;
const UNDERCOVER_CHAT_BACKGROUND_URL = new URL('./assets/sswd-chat.png', import.meta.url).href;
const UNDERCOVER_INVITE_URL = new URL('./assets/yqhy.png', import.meta.url).href;
const UNDERCOVER_START_URL = new URL('./assets/ksan.png', import.meta.url).href;
const UNDERCOVER_BACK_URL = new URL('./assets/back.png', import.meta.url).href;
const UNDERCOVER_INPUT_URL = new URL('./assets/srk.png', import.meta.url).href;
const UNDERCOVER_SETTINGS_URL = new URL('./assets/sz.png', import.meta.url).href;
const UNDERCOVER_PLAYER_FRAME_URLS = Array.from({ length: 6 }, (_, index) => (
    new URL(`./assets/${index + 1}.png`, import.meta.url).href
));
const UNDERCOVER_AI_AVATAR_URLS = Array.from({ length: 6 }, (_, index) => (
    new URL(`./assets/t${index + 1}.png`, import.meta.url).href
));

export class UndercoverView {
    constructor(app) {
        this.app = app;
        this._settingsOpen = false;
        this._inviteOpen = false;
        this._gameOpen = false;
        this._isComposingChatInput = false;
        this._startingGame = false;
        this._startChoiceOpen = false;
        this._pendingStartContacts = [];
    }

    preload() {
        this._loadCSS();
        [UNDERCOVER_BACKGROUND_URL, UNDERCOVER_GAME_BACKGROUND_URL, UNDERCOVER_WORD_CARD_URL, UNDERCOVER_CHAT_BACKGROUND_URL, UNDERCOVER_INVITE_URL, UNDERCOVER_START_URL, UNDERCOVER_BACK_URL, UNDERCOVER_INPUT_URL, UNDERCOVER_SETTINGS_URL, ...UNDERCOVER_PLAYER_FRAME_URLS, ...UNDERCOVER_AI_AVATAR_URLS].forEach((href, index) => {
            const id = `games-undercover-image-${index + 1}`;
            if (document.getElementById(id)) return;
            const link = document.createElement('link');
            link.id = id;
            link.rel = 'preload';
            link.as = 'image';
            link.href = href;
            document.head.appendChild(link);
        });
    }

    render() {
        this.preload();
        const html = `
            <div class="games-app games-undercover-app">
                <main class="games-undercover-home" style="background-image: url('${UNDERCOVER_BACKGROUND_URL}')">
                    <header class="games-undercover-toolbar">
                        <button class="games-undercover-back-image-btn" id="games-undercover-back" type="button" aria-label="返回游戏大厅" title="返回">
                            <img src="${UNDERCOVER_BACK_URL}" alt="" aria-hidden="true" draggable="false">
                        </button>
                        <button class="games-undercover-settings-image-btn" id="games-undercover-settings-open" type="button" aria-label="打开谁是卧底设置" title="设置">
                            <img src="${UNDERCOVER_SETTINGS_URL}" alt="" aria-hidden="true" draggable="false">
                        </button>
                    </header>

                    <section class="games-undercover-entry-actions" aria-label="谁是卧底游戏入口">
                        <button class="games-undercover-image-btn" id="games-undercover-invite" type="button" aria-label="邀请好友一起玩">
                            <img src="${UNDERCOVER_INVITE_URL}" alt="邀请好友，和朋友一起玩" draggable="false">
                        </button>
                        <button class="games-undercover-image-btn" id="games-undercover-start" type="button" aria-label="使用当前邀请名单开始游戏">
                            <img src="${UNDERCOVER_START_URL}" alt="开始游戏，和 AI 一起玩" draggable="false">
                        </button>
                    </section>

                    ${this._renderInviteOverlay()}
                    ${this._renderSettingsOverlay()}
                    ${this._renderStartChoiceOverlay()}
                </main>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'games-undercover');
        this._bindEvents();
    }

    renderGame(game = this.app.undercoverData.getState().game) {
        if (!game || !Array.isArray(game.players) || game.players.length !== 6) {
            this._gameOpen = false;
            this.render();
            return;
        }

        this.preload();
        this._gameOpen = true;
        this._inviteOpen = false;
        this._settingsOpen = false;
        const html = `
            <div class="games-app games-undercover-app games-undercover-game">
                <main class="games-undercover-game-stage" style="background-image: url('${UNDERCOVER_GAME_BACKGROUND_URL}')">
                    <header class="games-undercover-toolbar games-undercover-game-toolbar">
                        <button class="games-undercover-back-image-btn" id="games-undercover-game-back" type="button" aria-label="返回谁是卧底首页" title="返回">
                            <img src="${UNDERCOVER_BACK_URL}" alt="" aria-hidden="true" draggable="false">
                        </button>
                        <div class="games-undercover-game-heading">
                            <strong>谁是卧底 <i class="games-undercover-status-dot ${this._getStatusDotClass(game)}" id="games-undercover-status-dot" aria-hidden="true"></i></strong>
                            <span id="games-undercover-status-text">${this._escape(this._getStatusText(game))}</span>
                        </div>
                        <span class="games-undercover-toolbar-spacer" aria-hidden="true"></span>
                    </header>
                    <section class="games-undercover-player-strip" aria-label="本局六名玩家">
                        ${game.players.map(player => `
                            <article class="games-undercover-player ${Number(game.currentSpeakerSeat) === Number(player.seat) ? 'is-current' : ''} ${game.status === 'thinking' && Number(game.currentSpeakerSeat) === Number(player.seat) ? 'is-thinking' : ''} ${player.alive === false ? 'is-eliminated' : ''}" data-seat="${Number(player.seat || 0)}">
                                <div class="games-undercover-player-avatar-wrap">
                                    <div class="games-undercover-player-avatar">
                                        ${this._renderPlayerAvatar(player)}
                                    </div>
                                    <img class="games-undercover-player-frame" src="${UNDERCOVER_PLAYER_FRAME_URLS[Math.max(0, Math.min(5, Number(player.seat || 1) - 1))]}" alt="${Number(player.seat || 0)}号头像框" draggable="false">
                                </div>
                                <div class="games-undercover-player-name" title="${this._escapeAttr(player.name)}">${this._escape(player.name)}</div>
                            </article>
                        `).join('')}
                    </section>
                    <section class="games-undercover-word-card" aria-label="你的当前词语">
                        <img class="games-undercover-word-card-image" src="${UNDERCOVER_WORD_CARD_URL}" alt="" aria-hidden="true" draggable="false">
                        <div class="games-undercover-word-card-content">
                            <span class="games-undercover-word-private"><i class="fa-solid fa-eye-slash"></i>仅你可见</span>
                            <div class="games-undercover-word-line">
                                <span>你的词</span>
                                <i class="fa-solid fa-angles-right" aria-hidden="true"></i>
                                <strong>${this._escape(game.phase === 'matching' ? '正在发牌' : (game.userWord || game.players.find(player => player.isUser)?.word || '未知'))}</strong>
                            </div>
                        </div>
                    </section>
                    <section class="games-undercover-chat-panel" style="background-image: url('${UNDERCOVER_CHAT_BACKGROUND_URL}')" aria-label="本局聊天区域">
                        <div class="games-undercover-chat-scroll" id="games-undercover-chat-scroll" role="log" aria-live="polite">
                            ${this._renderChatMessages(game.chatMessages, game.players)}
                        </div>
                        <div class="games-undercover-vote-slot" id="games-undercover-vote-slot">
                            ${this._renderVotePanel(game)}
                        </div>
                        <form class="games-undercover-composer" id="games-undercover-composer" autocomplete="off">
                            <img class="games-undercover-composer-image" src="${UNDERCOVER_INPUT_URL}" alt="" aria-hidden="true" draggable="false">
                            <input class="games-undercover-chat-input" id="games-undercover-chat-input" type="text" maxlength="300" placeholder="${this._escapeAttr(this._getComposerPlaceholder(game))}" aria-label="输入你的发言" ${this._canUserSpeak(game) ? '' : 'disabled'}>
                            <button class="games-undercover-chat-send" id="games-undercover-chat-send" type="submit" aria-label="发送" title="发送" disabled></button>
                        </form>
                    </section>
                    <div class="games-undercover-error-slot" id="games-undercover-error-slot">
                        ${this._renderGameErrorDialog(game)}
                    </div>
                </main>
            </div>
        `;
        this.app.phoneShell.setContent(html, 'games-undercover-game');
        document.getElementById('games-undercover-game-back')?.addEventListener('click', () => this.backToHome());
        this._bindGameComposer();
        this._bindVoteEvents();
        this._bindGameErrorEvents();
        this._scrollChatToBottom();
    }

    backToHome() {
        this.app.stopUndercoverFlow?.();
        this._gameOpen = false;
        this.render();
    }

    isGameOpen() {
        return this._gameOpen;
    }

    handleBack() {
        if (this._inviteOpen || this._settingsOpen || this._startChoiceOpen) {
            this._inviteOpen = false;
            this._settingsOpen = false;
            this._startChoiceOpen = false;
            this._pendingStartContacts = [];
            this.render();
            return true;
        }
        if (this._gameOpen) {
            this.backToHome();
            return true;
        }
        return false;
    }

    _renderSettingsOverlay() {
        if (!this._settingsOpen) return '';
        const promptManager = this.app._getUndercoverPromptManager?.();
        const dealerPrompt = this.app.getUndercoverDealerPromptTemplate();
        const speechPrompt = this.app.getUndercoverPrompt();
        return `
            <div class="games-undercover-settings-overlay" id="games-undercover-settings-overlay" role="presentation">
                <section class="games-undercover-settings-panel" role="dialog" aria-modal="true" aria-labelledby="games-undercover-settings-title">
                    <header class="games-undercover-settings-header">
                        <h2 id="games-undercover-settings-title">谁是卧底设置</h2>
                        <button class="games-undercover-overlay-close" id="games-undercover-settings-close" type="button" aria-label="关闭设置" title="关闭">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </header>
                    <div class="games-undercover-settings-tabs" role="tablist" aria-label="提示词类型">
                        <button class="games-undercover-settings-tab is-active" type="button" role="tab" aria-selected="true" aria-controls="games-undercover-dealer-prompt-panel" data-prompt-tab="dealer">开局生成</button>
                        <button class="games-undercover-settings-tab" type="button" role="tab" aria-selected="false" aria-controls="games-undercover-speech-prompt-panel" data-prompt-tab="speech">AI 发言</button>
                    </div>
                    <div class="games-undercover-settings-prompt-panel is-active" id="games-undercover-dealer-prompt-panel" role="tabpanel" data-prompt-panel="dealer">
                        <div class="games-undercover-settings-prompt-title">开局生成提示词</div>
                        ${promptManager?.renderPromptPresetControls?.('games', 'undercoverDealer') || ''}
                        <textarea class="games-undercover-settings-textarea" id="games-undercover-dealer-prompt">${this._escape(dealerPrompt)}</textarea>
                        <button class="games-undercover-settings-reset" type="button" data-reset-prompt-feature="undercoverDealer">恢复默认</button>
                    </div>
                    <div class="games-undercover-settings-prompt-panel" id="games-undercover-speech-prompt-panel" role="tabpanel" data-prompt-panel="speech" hidden>
                        <div class="games-undercover-settings-prompt-title">AI 发言提示词</div>
                        ${promptManager?.renderPromptPresetControls?.('games', 'undercoverSpeech') || ''}
                        <textarea class="games-undercover-settings-textarea" id="games-undercover-speech-prompt">${this._escape(speechPrompt)}</textarea>
                        <button class="games-undercover-settings-reset" type="button" data-reset-prompt-feature="undercoverSpeech">恢复默认</button>
                    </div>
                </section>
            </div>
        `;
    }

    _renderInviteOverlay() {
        if (!this._inviteOpen) return '';
        const contacts = this.app.getWechatContactsForUndercover();
        const selectedIds = new Set(this.app.undercoverData.getSelectedContactIds());
        const maxInvites = 5;
        return `
            <div class="games-undercover-invite-overlay" id="games-undercover-invite-overlay" role="presentation">
                <section class="games-undercover-invite-panel" role="dialog" aria-modal="true" aria-labelledby="games-undercover-invite-title">
                    <header class="games-undercover-invite-header">
                        <div>
                            <h2 id="games-undercover-invite-title">邀请微信好友</h2>
                            <p>已选 <span id="games-undercover-invite-count">${selectedIds.size}/${maxInvites}</span>，其余座位由 AI 补齐</p>
                        </div>
                        <button class="games-undercover-overlay-close" id="games-undercover-invite-close" type="button" aria-label="关闭好友列表" title="关闭">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </header>
                    <div class="games-undercover-contact-list">
                        ${contacts.length ? contacts.map(contact => {
                            const checked = selectedIds.has(contact.id);
                            const disabled = !checked && selectedIds.size >= maxInvites;
                            return `
                                <button class="games-undercover-contact-choice ${checked ? 'is-active' : ''}" type="button" data-contact-id="${this._escapeAttr(contact.id)}" data-no-swipe-back aria-pressed="${checked ? 'true' : 'false'}" ${disabled ? 'disabled' : ''}>
                                    <span class="games-undercover-contact-avatar">${this.app.renderPlayerAvatar({ id: contact.id, contactId: contact.id, name: contact.name, avatar: contact.avatar })}</span>
                                    <span class="games-undercover-contact-name">${this._escape(contact.name)}</span>
                                    <i class="fa-solid ${checked ? 'fa-check' : 'fa-plus'}"></i>
                                </button>
                            `;
                        }).join('') : '<div class="games-undercover-contact-empty">微信通讯录暂无可邀请好友，本局将由 AI 自动补齐。</div>'}
                    </div>
                    <button class="games-undercover-invite-confirm" id="games-undercover-invite-confirm" type="button">
                        ${selectedIds.size ? `确认邀请（${selectedIds.size}）` : '暂不邀请'}
                    </button>
                </section>
            </div>
        `;
    }

    _renderStartChoiceOverlay() {
        if (!this._startChoiceOpen) return '';
        const game = this.app.undercoverData.getState().game;
        if (!game) return '';
        const user = (game.players || []).find(player => player.isUser);
        const phaseText = game.phase === 'matching'
            ? '开局匹配'
            : (game.phase === 'voting' ? '投票阶段' : (game.phase === 'ended' ? '本局结束' : `第${Number(game.round || 1)}轮`));
        return `
            <div class="games-undercover-start-choice-overlay" id="games-undercover-start-choice-overlay" role="presentation">
                <section class="games-undercover-start-choice-panel" role="dialog" aria-modal="true" aria-labelledby="games-undercover-start-choice-title">
                    <header class="games-undercover-start-choice-header">
                        <div>
                            <h2 id="games-undercover-start-choice-title">谁是卧底</h2>
                            <p>当前存档：${this._escape(phaseText)} · 你在 ${Number(user?.seat || 1)} 号位</p>
                        </div>
                        <button class="games-undercover-overlay-close" id="games-undercover-start-choice-close" type="button" aria-label="关闭" title="关闭">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </header>
                    <div class="games-undercover-start-choice-actions">
                        <button class="games-undercover-start-choice-btn" id="games-undercover-continue-game" type="button">继续当前游戏</button>
                        <button class="games-undercover-start-choice-btn is-primary" id="games-undercover-new-game" type="button">重新开局</button>
                    </div>
                </section>
            </div>
        `;
    }

    _bindEvents() {
        document.getElementById('games-undercover-back')?.addEventListener('click', () => {
            this.app.backToLobby();
        });
        document.getElementById('games-undercover-settings-open')?.addEventListener('click', () => {
            this._inviteOpen = false;
            this._settingsOpen = true;
            this.render();
        });
        document.getElementById('games-undercover-settings-close')?.addEventListener('click', () => {
            this._settingsOpen = false;
            this.render();
        });
        document.getElementById('games-undercover-settings-overlay')?.addEventListener('click', event => {
            if (event.target?.id !== 'games-undercover-settings-overlay') return;
            this._settingsOpen = false;
            this.render();
        });
        this._bindPromptSettingsEvents();
        document.getElementById('games-undercover-invite')?.addEventListener('click', () => {
            this.app.undercoverData.setLastMode('friends');
            const contacts = this.app.getWechatContactsForUndercover();
            this.app.undercoverData.reconcileSelectedContactIds(contacts.map(contact => contact.id));
            this._settingsOpen = false;
            this._inviteOpen = true;
            this.render();
        });
        document.getElementById('games-undercover-start')?.addEventListener('click', async () => {
            if (this._startingGame) return;
            const selectedIds = new Set(this.app.undercoverData.getSelectedContactIds());
            const invitedContacts = this.app.getWechatContactsForUndercover()
                .filter(contact => selectedIds.has(contact.id));
            const existingGame = this.app.undercoverData.getState().game;
            if (existingGame) {
                this._pendingStartContacts = invitedContacts;
                this._startChoiceOpen = true;
                this.render();
                return;
            }
            this._startingGame = true;
            try {
                await this.app.startUndercoverGame(invitedContacts);
            } finally {
                this._startingGame = false;
            }
        });
        this._bindStartChoiceEvents();
        this._bindInviteEvents();
    }

    _bindStartChoiceEvents() {
        const close = () => {
            this._startChoiceOpen = false;
            this._pendingStartContacts = [];
            this.render();
        };
        document.getElementById('games-undercover-start-choice-close')?.addEventListener('click', close);
        document.getElementById('games-undercover-start-choice-overlay')?.addEventListener('click', event => {
            if (event.target?.id === 'games-undercover-start-choice-overlay') close();
        });
        document.getElementById('games-undercover-continue-game')?.addEventListener('click', () => {
            this._startChoiceOpen = false;
            this._pendingStartContacts = [];
            this.app.resumeUndercoverGame?.();
        });
        document.getElementById('games-undercover-new-game')?.addEventListener('click', async () => {
            if (this._startingGame) return;
            this._startingGame = true;
            const contacts = [...this._pendingStartContacts];
            this._startChoiceOpen = false;
            this._pendingStartContacts = [];
            try {
                await this.app.startUndercoverGame(contacts);
            } finally {
                this._startingGame = false;
            }
        });
    }

    _bindPromptSettingsEvents() {
        const root = document.querySelector('.games-undercover-settings-panel');
        if (!root) return;
        root.querySelectorAll('.games-undercover-settings-tab[data-prompt-tab]').forEach(tab => {
            tab.addEventListener('click', () => {
                const target = String(tab.dataset.promptTab || 'dealer');
                root.querySelectorAll('.games-undercover-settings-tab[data-prompt-tab]').forEach(item => {
                    const active = item === tab;
                    item.classList.toggle('is-active', active);
                    item.setAttribute('aria-selected', active ? 'true' : 'false');
                });
                root.querySelectorAll('.games-undercover-settings-prompt-panel[data-prompt-panel]').forEach(panel => {
                    const active = panel.dataset.promptPanel === target;
                    panel.classList.toggle('is-active', active);
                    panel.hidden = !active;
                });
            });
        });

        const promptManager = this.app._getUndercoverPromptManager?.();
        const notify = (title, message, icon) => this.app.phoneShell?.showNotification?.(title, message, icon);
        [
            ['undercoverDealer', '#games-undercover-dealer-prompt'],
            ['undercoverSpeech', '#games-undercover-speech-prompt']
        ].forEach(([feature, selector]) => {
            promptManager?.bindPromptPresetControls?.(root, 'games', feature, selector, { notify });
        });

        root.querySelectorAll('.games-undercover-settings-reset[data-reset-prompt-feature]').forEach(button => {
            button.addEventListener('click', () => {
                const feature = String(button.dataset.resetPromptFeature || '').trim();
                if (!feature || !promptManager) return;
                const text = promptManager.resetPromptToDefault?.('games', feature) || '';
                const panel = button.closest('.games-undercover-settings-prompt-panel');
                const textarea = panel?.querySelector('.games-undercover-settings-textarea');
                const select = panel?.querySelector('.phone-prompt-preset-select');
                if (textarea) textarea.value = text;
                if (select) select.value = promptManager.getActivePromptPresetId?.('games', feature) || '';
                notify('已恢复默认', feature === 'undercoverDealer' ? '开局生成提示词' : 'AI 发言提示词', '✅');
            });
        });
    }

    _bindInviteEvents() {
        document.getElementById('games-undercover-invite-close')?.addEventListener('click', () => {
            this._inviteOpen = false;
            this.render();
        });
        document.getElementById('games-undercover-invite-overlay')?.addEventListener('click', event => {
            if (event.target?.id !== 'games-undercover-invite-overlay') return;
            this._inviteOpen = false;
            this.render();
        });
        const contactList = document.querySelector('.games-undercover-contact-list');
        contactList?.addEventListener('click', event => {
            const button = event.target?.closest?.('.games-undercover-contact-choice[data-contact-id]');
            if (!button || button.disabled || !contactList.contains(button)) return;
            const contactId = String(button.dataset.contactId || '').trim();
            if (!contactId) return;
            this.app.undercoverData.toggleSelectedContactId(contactId);
            this._refreshInviteSelection();
        });
        document.getElementById('games-undercover-invite-confirm')?.addEventListener('click', () => {
            const count = this.app.undercoverData.getSelectedContactIds().length;
            this._inviteOpen = false;
            this.render();
            this.app.phoneShell?.showNotification?.('谁是卧底', count ? `已邀请 ${count} 位微信好友` : '本局将由 AI 补齐', '✅');
        });
    }

    _refreshInviteSelection() {
        const selectedIds = new Set(this.app.undercoverData.getSelectedContactIds());
        const countElement = document.getElementById('games-undercover-invite-count');
        if (countElement) countElement.textContent = `${selectedIds.size}/5`;
        const confirmButton = document.getElementById('games-undercover-invite-confirm');
        if (confirmButton) confirmButton.textContent = selectedIds.size ? `确认邀请（${selectedIds.size}）` : '暂不邀请';

        document.querySelectorAll('.games-undercover-contact-choice[data-contact-id]').forEach(button => {
            const checked = selectedIds.has(String(button.dataset.contactId || '').trim());
            button.classList.toggle('is-active', checked);
            button.setAttribute('aria-pressed', checked ? 'true' : 'false');
            button.disabled = !checked && selectedIds.size >= 5;
            const icon = button.querySelector('i');
            icon?.classList.toggle('fa-check', checked);
            icon?.classList.toggle('fa-plus', !checked);
        });
    }

    destroy() {
        this._settingsOpen = false;
        this._inviteOpen = false;
        this._gameOpen = false;
        this._isComposingChatInput = false;
        this._startingGame = false;
        this._startChoiceOpen = false;
        this._pendingStartContacts = [];
    }

    _renderChatMessages(messages = [], players = []) {
        const html = (Array.isArray(messages) ? messages : [])
            .map(message => this._renderChatMessage(message, players))
            .join('');
        return html || '<div class="games-undercover-chat-empty" id="games-undercover-chat-empty">等待第一位玩家发言</div>';
    }

    _renderChatMessage(message = {}, players = []) {
        const isUser = message.source === 'user';
        const isSystem = message.source === 'system';
        if (isSystem) {
            return `
                <article class="games-undercover-chat-message is-system" data-message-id="${this._escapeAttr(message.id || '')}">
                    <span class="games-undercover-chat-sender">${this._escape(message.senderName || '系统')}</span>
                    <p>${this._escape(message.content || '')}</p>
                </article>
            `;
        }
        const player = (Array.isArray(players) ? players : []).find(item => (
            String(item?.id || '') === String(message.senderId || '')
            || Number(item?.seat || 0) === Number(message.senderSeat || 0)
        )) || {
            id: message.senderId,
            seat: Number(message.senderSeat || 0),
            name: message.senderName || (isUser ? '你' : '玩家'),
            source: isUser ? 'user' : (String(message.senderId || '').startsWith('undercover_ai_') ? 'ai' : 'wechat'),
            isUser
        };
        const segments = this.app.undercoverData.getMessageSegments?.(message) || [String(message.content || '')];
        const displayName = `${Number(player.seat || message.senderSeat || 0)}号 ${player.name || message.senderName || (isUser ? '你' : '玩家')}`;
        return `
            <article class="games-undercover-chat-message ${isUser ? 'is-user' : 'is-player'}" data-message-id="${this._escapeAttr(message.id || '')}">
                <div class="games-undercover-chat-avatar" aria-hidden="true">${this._renderPlayerAvatar(player)}</div>
                <div class="games-undercover-chat-content">
                    <span class="games-undercover-chat-sender">${this._escape(displayName)}</span>
                    <div class="games-undercover-chat-bubbles">
                        ${segments.map(segment => `<p>${this._escape(segment)}</p>`).join('')}
                    </div>
                </div>
            </article>
        `;
    }

    _bindGameComposer() {
        const form = document.getElementById('games-undercover-composer');
        const input = document.getElementById('games-undercover-chat-input');
        const send = document.getElementById('games-undercover-chat-send');
        if (!form || !input || !send) return;

        const syncSendState = () => {
            const game = this.app.undercoverData.getState().game;
            const hasText = !!String(input.value || '').trim();
            const hasPendingSpeech = Number(game?.pendingUserSpeechCount || 0) > 0;
            send.disabled = !this._canUserSpeak(game) || (!hasText && !hasPendingSpeech);
            const isFinishAction = !hasText && hasPendingSpeech;
            send.setAttribute('aria-label', isFinishAction ? '结束发言' : '发送');
            send.title = isFinishAction ? '结束发言' : '发送';
        };
        input.addEventListener('input', syncSendState);
        input.addEventListener('focus', () => {
            this.app.setUndercoverUserInputFocused?.(true, {
                hasDraft: !!String(input.value || '').trim()
            });
            syncSendState();
        });
        input.addEventListener('blur', () => {
            this.app.setUndercoverUserInputFocused?.(false, {
                hasDraft: !!String(input.value || '').trim()
            });
            syncSendState();
        });
        input.addEventListener('compositionstart', () => {
            this._isComposingChatInput = true;
        });
        input.addEventListener('compositionend', () => {
            this._isComposingChatInput = false;
            syncSendState();
        });
        form.addEventListener('submit', event => {
            event.preventDefault();
            if (this._isComposingChatInput) return;
            const content = String(input.value || '').trim();
            if (!content) {
                if (Number(this.app.undercoverData.getState().game?.pendingUserSpeechCount || 0) <= 0) return;
                input.blur();
                this.app.finishUndercoverUserTurn?.();
                syncSendState();
                return;
            }
            const message = this.app.submitUndercoverUserSpeech?.(content);
            if (!message) return;
            input.value = '';
            if (document.activeElement !== input) {
                this.app.setUndercoverUserInputFocused?.(false, { hasDraft: false });
            }
            syncSendState();
            this._scrollChatToBottom();
        });
        syncSendState();
    }

    appendChatMessage(message = {}) {
        const scroll = document.getElementById('games-undercover-chat-scroll');
        if (!scroll || !message?.id || scroll.querySelector(`[data-message-id="${CSS.escape(String(message.id))}"]`)) return;
        scroll.querySelector('#games-undercover-chat-empty')?.remove();
        const players = this.app.undercoverData.getState().game?.players || [];
        scroll.insertAdjacentHTML('beforeend', this._renderChatMessage(message, players));
        this._scrollChatToBottom();
    }

    syncGameRuntimeState(game = this.app.undercoverData.getState().game) {
        if (!game || !this._gameOpen) return;
        const dot = document.getElementById('games-undercover-status-dot');
        if (dot) dot.className = `games-undercover-status-dot ${this._getStatusDotClass(game)}`;
        const statusText = document.getElementById('games-undercover-status-text');
        if (statusText) statusText.textContent = this._getStatusText(game);
        document.querySelectorAll('.games-undercover-player[data-seat]').forEach(element => {
            const seat = Number(element.dataset.seat || 0);
            const player = game.players.find(item => Number(item.seat) === seat);
            const isCurrent = Number(game.currentSpeakerSeat) === seat;
            element.classList.toggle('is-current', isCurrent);
            element.classList.toggle('is-thinking', isCurrent && game.status === 'thinking');
            element.classList.toggle('is-eliminated', player?.alive === false);
        });
        const voteSlot = document.getElementById('games-undercover-vote-slot');
        if (voteSlot) {
            voteSlot.innerHTML = this._renderVotePanel(game);
            this._bindVoteEvents();
        }
        const errorSlot = document.getElementById('games-undercover-error-slot');
        if (errorSlot) {
            errorSlot.innerHTML = this._renderGameErrorDialog(game);
            this._bindGameErrorEvents();
        }
        const input = document.getElementById('games-undercover-chat-input');
        const send = document.getElementById('games-undercover-chat-send');
        const canSpeak = this._canUserSpeak(game);
        if (input) {
            input.disabled = !canSpeak;
            input.placeholder = this._getComposerPlaceholder(game);
        }
        if (send) {
            const hasText = !!String(input?.value || '').trim();
            const hasPendingSpeech = Number(game.pendingUserSpeechCount || 0) > 0;
            send.disabled = !canSpeak || (!hasText && !hasPendingSpeech);
            const isFinishAction = !hasText && hasPendingSpeech;
            send.setAttribute('aria-label', isFinishAction ? '结束发言' : '发送');
            send.title = isFinishAction ? '结束发言' : '发送';
        }
    }

    _renderVotePanel(game = {}) {
        if (game.status === 'error') return '';
        if (game.phase === 'ended') {
            const result = game.winner === 'civilian' ? '平民找出了卧底' : '卧底坚持到了最后';
            return `<div class="games-undercover-vote-panel is-result"><strong>${this._escape(game.statusText || '本局结束')}</strong><span>${this._escape(result)}</span></div>`;
        }
        if (game.phase !== 'voting') return '';
        if (game.status !== 'waiting_user_vote') {
            return '<div class="games-undercover-vote-panel is-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>正在统计本轮投票</span></div>';
        }
        const targets = (game.players || []).filter(player => player.alive !== false && !player.isUser);
        return `
            <div class="games-undercover-vote-panel">
                <strong>你认为谁是卧底？</strong>
                <div class="games-undercover-vote-options">
                    ${targets.map(player => `
                        <button class="games-undercover-vote-option" type="button" data-vote-seat="${Number(player.seat)}" data-no-swipe-back>
                            <span>${Number(player.seat)}号</span>${this._escape(player.name)}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    }

    _bindVoteEvents() {
        const slot = document.getElementById('games-undercover-vote-slot');
        if (!slot || slot.dataset.bound === '1') return;
        slot.dataset.bound = '1';
        slot.addEventListener('click', event => {
            const button = event.target?.closest?.('.games-undercover-vote-option[data-vote-seat]');
            if (!button || button.disabled || !slot.contains(button)) return;
            const vote = this.app.submitUndercoverUserVote?.(Number(button.dataset.voteSeat));
            if (!vote) return;
            slot.querySelectorAll('.games-undercover-vote-option').forEach(item => { item.disabled = true; });
        });
    }

    _renderGameErrorDialog(game = {}) {
        if (game.status !== 'error') return '';
        const title = game.phase === 'matching'
            ? '开局请求中断'
            : (game.phase === 'voting' ? '投票请求中断' : 'AI 发言中断');
        return `
            <div class="games-undercover-error-overlay" role="presentation">
                <section class="games-undercover-error-dialog" role="alertdialog" aria-modal="true" aria-labelledby="games-undercover-error-title">
                    <div class="games-undercover-error-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
                    <h2 id="games-undercover-error-title">${this._escape(title)}</h2>
                    <div class="games-undercover-error-message">${this._escape(game.error || '请求意外中断，请重试当前环节。')}</div>
                    <button class="games-undercover-error-retry" type="button" data-no-swipe-back>重新请求 API</button>
                </section>
            </div>
        `;
    }

    _bindGameErrorEvents() {
        const slot = document.getElementById('games-undercover-error-slot');
        if (!slot || slot.dataset.bound === '1') return;
        slot.dataset.bound = '1';
        slot.addEventListener('click', event => {
            const button = event.target?.closest?.('.games-undercover-error-retry');
            if (!button || button.disabled || !slot.contains(button)) return;
            button.disabled = true;
            this.app.retryUndercoverFlow?.();
        });
    }

    _canUserSpeak(game = {}) {
        const user = (game.players || []).find(player => player.isUser);
        return game.phase === 'playing'
            && ['waiting_user', 'user_composing', 'waiting_user_reply'].includes(game.status)
            && user?.alive !== false
            && Number(game.currentSpeakerSeat) === Number(user?.seat);
    }

    _getStatusDotClass(game = {}) {
        if (['dealing', 'thinking', 'voting', 'error'].includes(game.status)) return 'dot-red';
        if (['waiting_user', 'waiting_user_reply', 'waiting_user_vote'].includes(game.status)) return 'dot-yellow';
        return 'dot-green';
    }

    _getStatusText(game = {}) {
        if (game.phase === 'matching') return '正在生成玩家与身份词';
        if (game.phase === 'ended') return game.statusText || '本局结束';
        if (game.status === 'thinking') return game.statusText || 'AI 正在发言';
        if (game.status === 'voting') return 'AI 正在投票';
        if (game.status === 'waiting_user_vote') return `第${Number(game.round || 1)}轮 · 等待你投票`;
        if (game.status === 'user_composing') return `第${Number(game.round || 1)}轮 · 你正在输入`;
        if (game.status === 'waiting_user_reply') return `第${Number(game.round || 1)}轮 · 等待补充发言`;
        if (game.status === 'waiting_user') return `第${Number(game.round || 1)}轮 · 轮到你发言`;
        if (game.status === 'error') return game.statusText || '请求中断';
        return `第${Number(game.round || 1)}轮 · 游戏进行中`;
    }

    _getComposerPlaceholder(game = {}) {
        if (game.phase === 'matching') return '正在生成身份词...';
        if (game.phase === 'voting') return '本轮发言结束，请先投票';
        if (game.phase === 'ended') return '本局已经结束';
        if (game.status === 'error') return 'AI 请求中断';
        return this._canUserSpeak(game) ? '输入你的发言' : '等待其他玩家发言...';
    }

    _scrollChatToBottom() {
        const scroll = document.getElementById('games-undercover-chat-scroll');
        if (!scroll) return;
        requestAnimationFrame(() => {
            scroll.scrollTop = scroll.scrollHeight;
        });
    }

    _renderPlayerAvatar(player = {}) {
        if (player?.source === 'pending' || player?.empty) {
            return '<span class="games-undercover-player-pending"><i class="fa-solid fa-spinner fa-spin"></i></span>';
        }
        if (player?.source === 'ai') {
            const requestedPreset = Number(player.avatarPreset);
            const fallbackPreset = Number(player.seat) || 1;
            const preset = Math.max(1, Math.min(6, Number.isInteger(requestedPreset) ? requestedPreset : fallbackPreset));
            const avatarUrl = UNDERCOVER_AI_AVATAR_URLS[preset - 1];
            return `<img src="${this._escapeAttr(avatarUrl)}" alt="${this._escapeAttr(player.name || 'AI玩家')}">`;
        }
        return this.app.renderPlayerAvatar(player);
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

    _loadCSS() {
        const existing = document.getElementById('games-undercover-css');
        if (existing) {
            if (existing.href !== UNDERCOVER_CSS_URL) existing.href = UNDERCOVER_CSS_URL;
            return;
        }
        const link = document.createElement('link');
        link.id = 'games-undercover-css';
        link.rel = 'stylesheet';
        link.href = UNDERCOVER_CSS_URL;
        document.head.appendChild(link);
    }
}
