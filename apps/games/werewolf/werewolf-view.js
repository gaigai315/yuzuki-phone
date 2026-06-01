/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  狼人杀 UI 预览视图
 * ======================================================== */

export class WerewolfView {
    constructor(app) {
        this.app = app;
        this._cssLoaded = false;
        this._chatExpanded = false;
        this._entryPromptOpen = false;
    }

    async render() {
        await this._loadCSS();
        const state = this.app.werewolfData.getState();
        const players = state.players || [];
        const phaseLabel = state.phase === 'night' ? '黑夜' : state.phase === 'setup' ? '匹配' : '白天';
        const themeClass = state.phase === 'night' ? 'games-werewolf-night-theme' : 'games-werewolf-day-theme';
        const html = `
            <div class="games-app games-werewolf-app ${themeClass} ${this._chatExpanded ? 'is-chat-expanded' : ''}">
                <div class="games-werewolf-backdrop" aria-hidden="true"></div>

                <div class="games-werewolf-topbar">
                    <button class="games-werewolf-icon-btn" id="games-werewolf-back" type="button" aria-label="返回大厅">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div class="games-werewolf-title-wrap">
                        <div class="games-werewolf-title">狼人杀</div>
                        <div class="games-werewolf-subtitle">夜幕降临</div>
                    </div>
                </div>

                <div class="games-werewolf-stage">
                    <div class="games-werewolf-board">
                        <div class="games-werewolf-seats">
                            ${players.map(player => this._renderPlayerCard(player)).join('')}
                        </div>

                        <div class="games-werewolf-oracle">
                            <div class="games-werewolf-moon"><i class="fa-solid fa-moon"></i></div>
                            <div class="games-werewolf-day">第 <strong>${Number(state.day || 1)}</strong> 天</div>
                            <div class="games-werewolf-phase">${this._escape(phaseLabel)}</div>
                            <div class="games-werewolf-divider"></div>
                            <div class="games-werewolf-turn">${state.phase === 'setup' ? '等待匹配' : '当前轮到'}</div>
                            <div class="games-werewolf-speaker">${state.phase === 'setup' ? '开始游戏' : `<strong>${Number(state.currentSpeaker || 1)}</strong>号 发言`}</div>
                        </div>
                    </div>

                    <div class="games-werewolf-notice">
                        <span>系统公告：</span><strong>${this._escape(state.notice || '点击开始游戏。')}</strong>
                    </div>

                    <div class="games-werewolf-chat ${this._chatExpanded ? 'is-expanded' : ''}">
                        <button class="games-werewolf-chat-toggle" id="games-werewolf-chat-toggle" type="button" aria-expanded="${this._chatExpanded ? 'true' : 'false'}">
                            <span>发言区</span>
                            <i class="fa-solid fa-chevron-${this._chatExpanded ? 'down' : 'up'}"></i>
                        </button>
                        <div class="games-werewolf-chat-scroll">
                            ${(state.chat || []).length
                                ? state.chat.map(item => this._renderChatRow(item.seat, item.text)).join('')
                                : '<div class="games-werewolf-chat-empty">暂无发言</div>'}
                        </div>
                    </div>

                    <div class="games-werewolf-actions">
                        ${this._renderPrimaryActions(state)}
                        <button class="games-werewolf-action" type="button">
                            <i class="fa-solid fa-book-open"></i>
                            <span>记录</span>
                        </button>
                    </div>
                </div>
                ${this._renderEntryPrompt(state)}
            </div>
        `;

        this.app.phoneShell.setContent(html, 'games-werewolf');
        this._bindEvents();
    }

    destroy() {}

    _bindEvents() {
        document.getElementById('games-werewolf-back')?.addEventListener('click', () => {
            this.app.backToLobby();
        });
        document.getElementById('games-werewolf-chat-toggle')?.addEventListener('click', () => {
            this._chatExpanded = !this._chatExpanded;
            this.render();
        });
        document.getElementById('games-werewolf-start')?.addEventListener('click', () => {
            this.app.startWerewolfMatch();
        });
        document.getElementById('games-werewolf-continue')?.addEventListener('click', () => {
            this.closeEntryPrompt();
            this.render();
        });
        document.getElementById('games-werewolf-new')?.addEventListener('click', () => {
            this.app.startNewWerewolfGame();
        });
    }

    openEntryPrompt() {
        this._entryPromptOpen = true;
    }

    closeEntryPrompt() {
        this._entryPromptOpen = false;
    }

    _renderPlayerCard(player) {
        const classes = [
            'games-werewolf-player',
            `games-werewolf-seat-${player.seat}`,
            `games-werewolf-avatar-${player.tone}`,
            player.active ? 'is-active' : '',
            player.isUser ? 'is-user' : '',
            player.empty ? 'is-empty' : ''
        ].filter(Boolean).join(' ');
        return `
            <div class="${classes}">
                <div class="games-werewolf-seat-no"><span>${player.seat}</span></div>
                <div class="games-werewolf-avatar" aria-hidden="true"></div>
                <div class="games-werewolf-player-name">${this._escape(player.name)}</div>
                <div class="games-werewolf-player-status"><span></span>存活</div>
            </div>
        `;
    }

    _renderChatRow(seat, text) {
        if (!seat) {
            return `
                <div class="games-werewolf-chat-row games-werewolf-chat-row-system">
                    <span>!</span>
                    <p>${this._escape(text)}</p>
                </div>
            `;
        }
        return `
            <div class="games-werewolf-chat-row games-werewolf-chat-row-${seat}">
                <span>${seat}</span>
                <p>${seat}号：${this._escape(text)}</p>
            </div>
        `;
    }

    _renderPrimaryActions(state) {
        if (state.phase === 'setup') {
            return `
                <button class="games-werewolf-action games-werewolf-action-primary" id="games-werewolf-start" type="button" ${state.matching ? 'disabled' : ''}>
                    <i class="fa-solid ${state.matching ? 'fa-spinner fa-spin' : 'fa-paw'}"></i>
                    <span>${state.matching ? '匹配中' : '开始游戏'}</span>
                </button>
                <button class="games-werewolf-action" type="button" disabled>
                    <i class="fa-solid fa-comment-dots"></i>
                    <span>发言</span>
                </button>
            `;
        }
        return `
            <button class="games-werewolf-action" type="button">
                <i class="fa-solid fa-comment-dots"></i>
                <span>发言</span>
            </button>
            <button class="games-werewolf-action games-werewolf-action-primary" type="button">
                <i class="fa-solid fa-paw"></i>
                <span>投票</span>
            </button>
        `;
    }

    _renderEntryPrompt(state) {
        if (!this._entryPromptOpen) return '';
        const user = state.players?.find(player => player.isUser);
        const filledCount = (state.players || []).filter(player => !player.empty).length;
        const phaseText = state.phase === 'setup' ? '未开始' : state.phase === 'night' ? '夜间' : '白天';
        return `
            <div class="games-werewolf-entry-overlay">
                <div class="games-werewolf-entry-panel">
                    <div class="games-werewolf-entry-title">狼人杀</div>
                    <div class="games-werewolf-entry-desc">
                        当前存档：${this._escape(phaseText)} · ${filledCount}/8 人 · 你在 ${Number(user?.seat || 8)} 号位
                    </div>
                    <div class="games-werewolf-entry-actions">
                        <button class="games-werewolf-entry-btn" id="games-werewolf-continue" type="button">继续当前游戏</button>
                        <button class="games-werewolf-entry-btn is-primary" id="games-werewolf-new" type="button">开始新游戏</button>
                    </div>
                </div>
            </div>
        `;
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
        link.href = new URL('./werewolf.css?v=1.0.27', import.meta.url).href;
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
}
