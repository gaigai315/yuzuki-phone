/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  游戏大厅入口
 * ======================================================== */

import { PokerApp } from './poker/poker-app.js';
import { Game2048Data } from './game2048/game2048-data.js';
import { Game2048View } from './game2048/game2048-view.js';
import { SudokuData } from './sudoku/sudoku-data.js';
import { SudokuView } from './sudoku/sudoku-view.js';
import { CatboxData } from './catbox/catbox-data.js';
import { CatboxView } from './catbox/catbox-view.js';
import { WerewolfData } from './werewolf/werewolf-data.js';
import { WerewolfView } from './werewolf/werewolf-view.js';
import { UndercoverData } from './undercover/undercover-data.js';
import { UndercoverView } from './undercover/undercover-view.js';

const CATBOX_CSS_URL = new URL('./catbox/catbox.css?v=1.0.0', import.meta.url).href;
const WEREWOLF_CSS_URL = new URL('./werewolf/werewolf.css?v=1.0.49', import.meta.url).href;
const WEREWOLF_API_COOLDOWN_MS = 5000;
const WEREWOLF_LAST_WORDS_TIMEOUT_MS = 180000;
const UNDERCOVER_PLAYER_COUNT = 6;
const UNDERCOVER_USER_TURN_DELAY_MS = 6000;
const UNDERCOVER_API_COOLDOWN_MS = 5000;
const CATBOX_PRELOAD_ASSETS = [
    new URL('./catbox/assets/wxxw1.png', import.meta.url).href,
    new URL('./catbox/assets/wxxw2.png', import.meta.url).href,
    new URL('./catbox/assets/wxxw3.jpeg', import.meta.url).href,
    new URL('./catbox/assets/wxxw4.png', import.meta.url).href,
    new URL('./catbox/assets/A1.png', import.meta.url).href,
    new URL('./catbox/assets/A2.png', import.meta.url).href,
    new URL('./catbox/assets/A3.png', import.meta.url).href,
    new URL('./catbox/assets/A4.png', import.meta.url).href,
    new URL('./catbox/assets/A5.png', import.meta.url).href,
    new URL('./catbox/assets/A6.png', import.meta.url).href,
    new URL('./catbox/assets/A7.png', import.meta.url).href,
    new URL('./catbox/assets/A8.png', import.meta.url).href,
    new URL('./catbox/assets/A9.png', import.meta.url).href,
    new URL('./catbox/assets/A10.png', import.meta.url).href,
    new URL('./catbox/assets/A11.png', import.meta.url).href,
    new URL('./catbox/assets/A12.png', import.meta.url).href,
    new URL('./catbox/assets/tzxf.png', import.meta.url).href
];

export class GamesApp extends PokerApp {
    constructor(phoneShell, storage) {
        super(phoneShell, storage);
        this.game2048Data = new Game2048Data(storage);
        this.game2048View = new Game2048View(this);
        this.sudokuData = new SudokuData(storage);
        this.sudokuView = new SudokuView(this);
        this.catboxData = new CatboxData(storage);
        this.catboxView = new CatboxView(this);
        this.werewolfData = new WerewolfData(storage);
        this.werewolfView = new WerewolfView(this);
        this.undercoverData = new UndercoverData(storage);
        this.undercoverView = new UndercoverView(this);
        this._werewolfDriving = false;
        this._werewolfNightDriving = false;
        this._lastWerewolfApiRequestAt = 0;
        this._undercoverDriving = false;
        this._undercoverRunId = 0;
        this._undercoverAbortController = null;
        this._undercoverPendingUserContext = false;
        this._undercoverUserTurnTimer = null;
        this._undercoverUserTurnDelayMs = UNDERCOVER_USER_TURN_DELAY_MS;
        this._undercoverApiCooldownMs = UNDERCOVER_API_COOLDOWN_MS;
        this._lastUndercoverApiCompletedAt = 0;
        this._preloadCatboxAssets();
        this._preloadWerewolfAssets();
        this.undercoverView.preload();
        window.addEventListener('phone:panelVisibility', event => {
            const open = !!event.detail?.open;
            if (this.currentView !== 'sudoku') return;
            if (open) {
                this.sudokuData.resumeTimer();
                this.sudokuView.render();
            } else {
                this.sudokuView.destroy();
            }
        });
    }

    open2048() {
        this.applyPhoneChromeTheme();
        this.currentView = 'game2048';
        this.game2048View.render();
    }

    openUndercover() {
        this.applyPhoneChromeTheme();
        this.currentView = 'undercover';
        this.undercoverView.render();
    }

    getWechatContactsForUndercover() {
        const wechatData = this.getWechatData();
        const rawContacts = wechatData?.getContacts?.() || [];
        return this.getWechatContactsForPoker().map(contact => {
            const raw = rawContacts.find(item => (
                String(item?.id || '').trim() === contact.id
                || String(item?.name || '').trim() === contact.name
                || String(item?.remark || '').trim() === contact.name
            )) || {};
            return {
                ...contact,
                personality: String(
                    raw.personality
                    || raw.signature
                    || raw.description
                    || raw.remark
                    || '熟悉用户，发言自然，会根据场上内容判断'
                ).trim()
            };
        });
    }

    async startUndercoverGame(invitedContacts = []) {
        this.stopUndercoverFlow();
        this._lastUndercoverApiCompletedAt = 0;
        const runId = this._undercoverRunId;
        const wechatData = this.getWechatData();
        const userInfo = wechatData?.getUserInfo?.() || {};
        const prepared = this.undercoverData.prepareGame({
            name: String(userInfo.name || '你').trim() || '你',
            avatar: this.resolvePlayerAvatar({ id: 'user', name: userInfo.name || '你', avatar: userInfo.avatar }),
            personality: String(userInfo.signature || userInfo.personality || '按用户自己的方式发言').trim()
        }, invitedContacts);
        this.undercoverView.renderGame(prepared);

        return this._runUndercoverDealerStep(prepared, runId);
    }

    resumeUndercoverGame() {
        const storedGame = this.undercoverData.getState().game;
        if (!storedGame) return false;
        this.stopUndercoverFlow();
        const runId = this._undercoverRunId;
        const latestPublicMessage = [...(storedGame.chatMessages || [])]
            .reverse()
            .find(message => message?.source !== 'system');
        this._undercoverPendingUserContext = latestPublicMessage?.source === 'user';
        this.undercoverView.renderGame(storedGame);
        if (storedGame.phase === 'ended' || storedGame.status === 'error') return true;
        if (storedGame.phase === 'matching') {
            const prepared = this.undercoverData.markDealerThinking();
            this.undercoverView.syncGameRuntimeState?.(prepared);
            Promise.resolve().then(() => this._runUndercoverDealerStep(prepared, runId));
            return true;
        }
        Promise.resolve().then(() => this.driveUndercoverTurns({
            runId,
            includeUserContext: this._undercoverPendingUserContext
        }));
        return true;
    }

    async _runUndercoverDealerStep(prepared, runId = this._undercoverRunId) {
        try {
            const emptyCount = prepared.players.filter(player => player.empty || player.source === 'pending').length;
            const result = await this._callUndercoverDealerAi(emptyCount, prepared.players, runId);
            if (runId !== this._undercoverRunId) return null;
            if (result?.success === false) throw new Error(result.error || '开局发牌请求失败');
            const parsed = this._parseUndercoverDealerResult(result?.summary || result?.content || result?.text || '');
            const incomplete = parsed.players.length < emptyCount || !parsed.wordPair.civilian || !parsed.wordPair.undercover;
            const game = this.undercoverData.applyDealerResult(parsed.players, parsed.wordPair);
            this.undercoverView.renderGame(game);
            if (incomplete) {
                this.phoneShell?.showNotification?.('谁是卧底', 'AI 返回不完整，已自动补齐缺失内容', '⚠️');
            }
            await this.driveUndercoverTurns({ runId });
            return this.undercoverData.getState().game;
        } catch (error) {
            if (runId !== this._undercoverRunId) return null;
            console.warn('[Undercover] 开局发牌失败:', error);
            const message = this._formatError?.(error, '开局发牌失败') || error?.message || '开局发牌失败';
            const game = this.undercoverData.setGameError(message);
            this.undercoverView.syncGameRuntimeState?.(game);
            return null;
        }
    }

    submitUndercoverUserSpeech(content = '') {
        const message = this.undercoverData.addUserChatMessage(content);
        if (!message) return null;
        this._clearUndercoverUserTurnTimer();
        this._undercoverPendingUserContext = true;
        this.undercoverView.appendChatMessage?.(message);
        this.undercoverView.syncGameRuntimeState?.(this.undercoverData.getState().game);
        return message;
    }

    setUndercoverUserInputFocused(focused, options = {}) {
        if (!this.undercoverData.canUserSpeak()) return null;
        const hasDraft = !!options.hasDraft;
        this._clearUndercoverUserTurnTimer();
        const game = this.undercoverData.setUserInputFocused(!!focused || hasDraft);
        this.undercoverView.syncGameRuntimeState?.(game);
        if (!focused && !hasDraft && this.undercoverData.hasPendingUserSpeech()) {
            this._undercoverUserTurnTimer = setTimeout(() => {
                this._undercoverUserTurnTimer = null;
                const input = document.getElementById('games-undercover-chat-input');
                const isInputActive = document.activeElement === input;
                const hasCurrentDraft = !!String(input?.value || '').trim();
                if (isInputActive || hasCurrentDraft) {
                    const activeGame = this.undercoverData.setUserInputFocused(true);
                    this.undercoverView.syncGameRuntimeState?.(activeGame);
                    return;
                }
                this.finishUndercoverUserTurn();
            }, Math.max(0, Number(this._undercoverUserTurnDelayMs || UNDERCOVER_USER_TURN_DELAY_MS)));
        }
        return game;
    }

    finishUndercoverUserTurn() {
        this._clearUndercoverUserTurnTimer();
        const game = this.undercoverData.finishUserTurn();
        if (!game) return null;
        this._undercoverPendingUserContext = true;
        this.undercoverView.syncGameRuntimeState?.(game);
        Promise.resolve().then(() => this.driveUndercoverTurns({
            runId: this._undercoverRunId,
            includeUserContext: true
        }));
        return game;
    }

    _clearUndercoverUserTurnTimer() {
        if (this._undercoverUserTurnTimer) clearTimeout(this._undercoverUserTurnTimer);
        this._undercoverUserTurnTimer = null;
    }

    submitUndercoverUserVote(targetSeat) {
        const vote = this.undercoverData.submitUserVote(targetSeat);
        if (!vote) return null;
        this.undercoverView.syncGameRuntimeState?.(this.undercoverData.getState().game);
        Promise.resolve().then(() => this.driveUndercoverTurns({ runId: this._undercoverRunId }));
        return vote;
    }

    retryUndercoverFlow() {
        const game = this.undercoverData.getState().game;
        if (!game || game.status !== 'error') return false;
        if (game.phase === 'matching') {
            const prepared = this.undercoverData.markDealerThinking();
            this.undercoverView.syncGameRuntimeState?.(prepared);
            Promise.resolve().then(() => this._runUndercoverDealerStep(prepared, this._undercoverRunId));
            return true;
        }
        Promise.resolve().then(() => this.driveUndercoverTurns({ runId: this._undercoverRunId }));
        return true;
    }

    async driveUndercoverTurns(options = {}) {
        if (this._undercoverDriving) return;
        const runId = Number(options.runId ?? this._undercoverRunId);
        let includeUserContext = !!options.includeUserContext || this._undercoverPendingUserContext;
        this._undercoverDriving = true;
        try {
            let guard = 0;
            while (guard < UNDERCOVER_PLAYER_COUNT && runId === this._undercoverRunId) {
                const state = this.undercoverData.getState();
                if (!state.game || state.game.phase === 'ended') return;
                if (state.game.phase === 'voting') {
                    if (this.undercoverData.canUserVote()) {
                        this.undercoverView.syncGameRuntimeState?.(state.game);
                        return;
                    }
                    await this._runUndercoverVote(runId, { includeUserContext });
                    const nextGame = this.undercoverData.getState().game;
                    if (nextGame?.phase === 'playing' && runId === this._undercoverRunId) {
                        Promise.resolve().then(() => this.driveUndercoverTurns({ runId }));
                    }
                    return;
                }
                if (state.game.phase !== 'playing') return;
                guard += 1;
                const speaker = this.undercoverData.getCurrentSpeaker();
                if (!speaker) return;
                if (speaker.isUser) {
                    this.undercoverView.syncGameRuntimeState?.(state.game);
                    return;
                }

                try {
                    const result = await this._callUndercoverSpeechAi(speaker, {
                        includeUserContext,
                        runId,
                        onDispatch: () => {
                            const thinkingGame = this.undercoverData.markCurrentSpeakerThinking();
                            this.undercoverView.syncGameRuntimeState?.(thinkingGame);
                        }
                    });
                    if (runId !== this._undercoverRunId) return;
                    if (result?.success === false) throw new Error(result.error || 'AI 发言请求失败');
                    const speech = this._parseUndercoverSpeech(result?.summary || result?.content || result?.text || '');
                    if (!speech) throw new Error('AI 未返回有效的谁是卧底发言');
                    const message = this.undercoverData.addAiSpeech(speaker.seat, speech);
                    if (!message) throw new Error('当前发言回合已经变化');
                    includeUserContext = false;
                    this._undercoverPendingUserContext = false;
                    this.undercoverView.appendChatMessage?.(message);
                    this.undercoverView.syncGameRuntimeState?.(this.undercoverData.getState().game);
                } catch (error) {
                    if (runId !== this._undercoverRunId) return;
                    console.warn('[Undercover] AI 发言失败:', error);
                    const message = this._formatError?.(error, 'AI 发言失败') || error?.message || 'AI 发言失败';
                    const game = this.undercoverData.setGameError(message);
                    this.undercoverView.syncGameRuntimeState?.(game);
                    return;
                }
            }
        } finally {
            this._undercoverDriving = false;
            const pendingGame = this.undercoverData.getState().game;
            if (
                runId === this._undercoverRunId
                && pendingGame?.phase === 'voting'
                && pendingGame?.status === 'vote_ready'
            ) {
                Promise.resolve().then(() => this.driveUndercoverTurns({ runId }));
            }
        }
    }

    async _runUndercoverVote(runId = this._undercoverRunId, options = {}) {
        const state = this.undercoverData.getState().game;
        if (!state || state.phase !== 'voting') return null;
        try {
            const result = await this._callUndercoverVoteAi(state, runId, {
                ...options,
                onDispatch: () => {
                    const thinkingGame = this.undercoverData.markVoteThinking();
                    this.undercoverView.syncGameRuntimeState?.(thinkingGame);
                }
            });
            if (runId !== this._undercoverRunId) return null;
            if (result?.success === false) throw new Error(result.error || 'AI 投票请求失败');
            const votes = this._parseUndercoverVotes(result?.summary || result?.content || result?.text || '');
            const applied = this.undercoverData.applyVoteResult(votes);
            if (!applied) throw new Error('本轮投票结算失败');
            this._undercoverPendingUserContext = false;
            this.undercoverView.appendChatMessage?.(applied.message);
            this.undercoverView.syncGameRuntimeState?.(applied.game);
            if (applied.game.phase === 'ended') {
                const title = applied.game.winner === 'civilian' ? '平民阵营获胜' : '卧底获胜';
                this.phoneShell?.showNotification?.('谁是卧底', title, '🏆');
            }
            return applied;
        } catch (error) {
            if (runId !== this._undercoverRunId) return null;
            console.warn('[Undercover] AI 投票失败:', error);
            const message = this._formatError?.(error, 'AI 投票失败') || error?.message || 'AI 投票失败';
            const game = this.undercoverData.setGameError(message);
            this.undercoverView.syncGameRuntimeState?.(game);
            return null;
        }
    }

    stopUndercoverFlow() {
        this._undercoverRunId += 1;
        this._undercoverDriving = false;
        this._undercoverPendingUserContext = false;
        this._clearUndercoverUserTurnTimer();
        if (this._undercoverAbortController) {
            try {
                this._undercoverAbortController.abort();
            } catch (error) {
                console.warn('[Undercover] 中止请求失败:', error);
            }
            this._undercoverAbortController = null;
        }
    }

    async _callUndercoverDealerAi(emptyCount, players = [], runId = this._undercoverRunId) {
        const existingPlayers = (Array.isArray(players) ? players : [])
            .filter(player => !player.empty && player.source !== 'pending')
            .map(player => `${player.seat}号：${player.name}`)
            .join('\n') || '无';
        const recentWordPairs = this.undercoverData.getRecentWordPairs?.() || [];
        const recentWords = recentWordPairs.length
            ? [...recentWordPairs]
                .reverse()
                .map((pair, index) => `${index + 1}. ${pair.civilian} / ${pair.undercover}`)
                .join('\n')
            : '暂无历史词组';
        const messages = [
            {
                role: 'system',
                name: 'SYSTEM (谁是卧底午夜场发牌官)',
                isPhoneMessage: true,
                content: this._getUndercoverDealerPrompt(emptyCount)
            },
            {
                role: 'user',
                name: 'USER (谁是卧底开局任务)',
                isPhoneMessage: true,
                content: [
                    `空缺人数：${Math.max(0, Number(emptyCount || 0))}`,
                    '已经落座的真人玩家：',
                    existingPlayers,
                    '最近10局已经使用过的身份词（本局禁用）：',
                    recentWords,
                    '本局生成的普通玩家身份词和卧底玩家身份词，都不得复用上述列表中的任何一个词；请换一个新的细分领域。',
                    '请生成所有空缺位置需要的 AI 玩家资料，并给出本轮身份词。'
                ].join('\n')
            }
        ];
        return this._callUndercoverAi(messages, {
            runId,
            temperature: 0.96,
            max_tokens: 1100
        });
    }

    async _callUndercoverSpeechAi(player, options = {}) {
        const state = this.undercoverData.getState().game;
        if (!state) throw new Error('谁是卧底游戏状态不存在');
        const publicLog = this._formatUndercoverPublicLog(state.chatMessages, 36);
        const playerList = (state.players || [])
            .slice()
            .sort((a, b) => Number(a.seat) - Number(b.seat))
            .map(item => `${item.seat}号 ${item.name}（${item.alive === false ? '已出局' : '存活'}）`)
            .join('、');
        const shouldIncludeRoleContext = !!options.includeUserContext || player?.source === 'wechat';
        const userContext = shouldIncludeRoleContext
            ? await this.buildGamesAiContextMessages({
                includeWorldbook: true,
                includeRecentChat: true
            })
            : [];
        const messages = [
            {
                role: 'system',
                name: 'SYSTEM (谁是卧底发言规则)',
                isPhoneMessage: true,
                content: this.getUndercoverPrompt()
            },
            ...userContext,
            {
                role: 'system',
                name: 'SYSTEM (当前玩家私有信息)',
                isPhoneMessage: true,
                content: [
                    `当前轮次：第 ${Number(state.round || 1)} 轮。`,
                    `当前玩家：${player.seat}号 ${player.name}。`,
                    `当前玩家自己的词：${player.word}。`,
                    `当前玩家自己的性格与发言风格：${player.personality || '自然、简短地发言'}。`,
                    `本局公开座位：${playerList}。`,
                    '除当前玩家自己的词和性格外，你没有收到任何其他玩家的身份词、真实身份或私有性格。',
                    '本局公开发言：',
                    publicLog.length ? publicLog.join('\n') : '暂无，这是本局第一段发言。'
                ].join('\n')
            },
            {
                role: 'user',
                name: 'USER (当前发言任务)',
                isPhoneMessage: true,
                content: [
                    `请以 ${player.seat}号 ${player.name} 的身份完成当前这一段发言。`,
                    '发言必须拆成3到8个自然、口语化的短句，每个短句单独换行，不要把所有内容写成一个长段落。',
                    '只能返回以下标签，不要输出其他内容：',
                    '<谁是卧底发言>',
                    '发言内容',
                    '</谁是卧底发言>'
                ].join('\n')
            }
        ];
        return this._callUndercoverAi(messages, {
            runId: options.runId,
            temperature: 0.88,
            max_tokens: 420,
            onDispatch: options.onDispatch
        });
    }

    async _callUndercoverVoteAi(game, runId = this._undercoverRunId, options = {}) {
        const alivePlayers = (game?.players || []).filter(player => player.alive !== false);
        const aiVoters = alivePlayers.filter(player => !player.isUser);
        const publicLog = this._formatUndercoverPublicLog(game?.chatMessages, 48);
        const userVoteStatus = game?.userVote
            ? '用户已完成本轮投票，具体投票目标由插件保密并在 AI 返回后独立计入统计'
            : '用户本轮不参与投票';
        const userContext = await this.buildGamesAiContextMessages({
            includeWorldbook: true,
            includeRecentChat: true
        });
        const messages = [
            {
                role: 'system',
                name: 'SYSTEM (谁是卧底投票裁判)',
                isPhoneMessage: true,
                content: [
                    '你是六人谁是卧底游戏的投票裁判。现在一轮公开发言已经结束。',
                    '你需要在一次回复中分别扮演所有列出的 AI 托管玩家，根据唯一提供的普通玩家身份词和全部公开发言独立投票。',
                    '不同玩家可以得出不同判断。不得让任何玩家知道其他人的身份词或真实身份。',
                    '投票上下文只会提供普通玩家身份词；不得索取、猜测系统信息或要求提供卧底身份词。',
                    '用户票由插件在本地独立保存和统计。不要推测、复述或输出用户投给了谁。',
                    '只输出列出的 AI 投票者，不能遗漏，不能投给自己或已经出局的玩家。',
                    '必须只返回 <谁是卧底投票> 标签，不要 Markdown，不要解释。'
                ].join('\n')
            },
            ...userContext,
            {
                role: 'system',
                name: 'SYSTEM (本轮投票上下文)',
                isPhoneMessage: true,
                content: [
                    `当前轮次：第 ${Number(game?.round || 1)} 轮。`,
                    `存活座位：${alivePlayers.map(player => `${player.seat}号 ${player.name}`).join('、')}。`,
                    `用户投票状态：${userVoteStatus}。`,
                    `普通玩家身份词：${String(game?.wordPair?.civilian || '').trim() || '未知'}。`,
                    '全部公开发言：',
                    publicLog.join('\n') || '暂无'
                ].join('\n')
            },
            {
                role: 'user',
                name: 'USER (全员投票任务)',
                isPhoneMessage: true,
                content: [
                    `需要模拟投票的座位：${aiVoters.map(player => `${player.seat}号`).join('、') || '无'}。`,
                    '请让上面每个 AI 座位都投出且只投出一票，不要输出用户的票。',
                    '<谁是卧底投票>',
                    '票型：AI座位号->目标座位号，AI座位号->目标座位号',
                    '</谁是卧底投票>'
                ].join('\n')
            }
        ];
        return this._callUndercoverAi(messages, {
            runId,
            temperature: 0.76,
            max_tokens: 520,
            onDispatch: options.onDispatch
        });
    }

    _formatUndercoverPublicLog(messages = [], limit = 48) {
        const source = (Array.isArray(messages) ? messages : [])
            .slice(-Math.max(1, Number(limit) || 48))
            .filter(message => String(message?.content || '').trim());
        const lines = [];
        let currentRound = null;
        source.forEach(message => {
            const round = Math.max(1, Number(message?.round || 1));
            if (round !== currentRound) {
                lines.push(currentRound === null ? `【第${round}轮】` : `----- 第${round}轮 -----`);
                currentRound = round;
            }
            if (message.source === 'system') {
                lines.push(`系统：${String(message.content || '').trim()}`);
                return;
            }
            lines.push(`${Number(message.senderSeat || 0)}号 ${message.senderName || '玩家'}：${String(message.content || '').trim()}`);
        });
        return lines;
    }

    async _callUndercoverAi(messages, options = {}) {
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager?.callAI) throw new Error('API Manager 未初始化');
        await this._waitForPokerApiIdle();
        await this._waitForUndercoverApiCooldown(options.runId);
        if (Number(options.runId ?? this._undercoverRunId) !== this._undercoverRunId) {
            const error = new Error('谁是卧底请求已中止');
            error.name = 'AbortError';
            throw error;
        }
        if (typeof options.onDispatch === 'function') options.onDispatch();
        const controller = new AbortController();
        this._undercoverAbortController = controller;
        const requestRunId = Number(options.runId ?? this._undercoverRunId);
        let completedAt = 0;
        try {
            const result = await apiManager.callAI(messages, {
                appId: 'games',
                temperature: options.temperature,
                max_tokens: options.max_tokens,
                signal: controller.signal
            });
            completedAt = Number(result?.streamCompletedAt) || Date.now();
            if (result?.aborted) {
                const error = new Error('谁是卧底请求已中止');
                error.name = 'AbortError';
                throw error;
            }
            return result;
        } finally {
            if (requestRunId === this._undercoverRunId) {
                this._lastUndercoverApiCompletedAt = completedAt || Date.now();
            }
            if (this._undercoverAbortController === controller) {
                this._undercoverAbortController = null;
            }
        }
    }

    async _waitForUndercoverApiCooldown(runId = this._undercoverRunId) {
        const cooldown = Math.max(0, Number(this._undercoverApiCooldownMs || 0));
        const game = this.undercoverData?.getState?.()?.game;
        const latestMessageAt = (Array.isArray(game?.chatMessages) ? game.chatMessages : [])
            .reduce((latest, message) => Math.max(latest, Number(message?.createdAt || 0)), 0);
        // 与狼人杀一致，从“发言已经写入游戏状态”之后开始冷却。
        // API 完成时间只作为兜底，避免解析、落盘和 UI 更新占掉请求间隔。
        const latestAnchor = Math.max(
            Number(this._lastUndercoverApiCompletedAt || 0),
            Number.isFinite(latestMessageAt) ? latestMessageAt : 0
        );
        const elapsed = Date.now() - latestAnchor;
        const remaining = Math.max(0, cooldown - elapsed);
        if (remaining > 0) {
            await new Promise(resolve => setTimeout(resolve, remaining));
        }
        if (Number(runId ?? this._undercoverRunId) !== this._undercoverRunId) {
            const error = new Error('谁是卧底请求已中止');
            error.name = 'AbortError';
            throw error;
        }
    }

    _getUndercoverDealerPrompt(emptyCount = 0) {
        const count = Math.max(0, Number(emptyCount || 0));
        return this.getUndercoverDealerPromptTemplate()
            .replace(/\{\{emptyCount\}\}/g, String(count));
    }

    getDefaultUndercoverDealerPromptTemplate() {
        return [
            '你现在是《谁是卧底》游戏的发牌官（Game Master）。',
            '当前游戏共有6个座位，已有部分真人玩家落座。你需要完成以下两个任务：',
            '',
            '【任务一：生成AI玩家】',
            '请根据系统提供的空缺人数（{{emptyCount}}人），严格生成对应数量的虚拟AI玩家。',
            '1. 玩家昵称：要求极具个性，符合当代互联网年轻人的精神状态。可以是自嘲、抽象、擦边、暗黑、搞笑或海王风。每次生成必须保证极高的随机性和新鲜感。',
            '2. 性格：用一两句话设定该AI的发言风格与游戏策略。',
            '',
            '【任务二：生成午夜局身份词】',
            '请生成一对《谁是卧底》游戏的身份词。',
            '1. 词汇主题大类（每次调用请随机选择一个细分领域）：',
            '   - 两性边缘话题与暧昧互动（NSFW / 成人午夜场 / 两性亲密互动 / 经典姿势 / 暧昧道具）',
            '   - 互联网地狱笑话与抽象烂梗',
            '   - 奇葩小众癖好与人类迷惑行为',
            '   - 职场/成年人的深夜崩溃瞬间',
            '   - 酒桌野蛮文化与夜店社交',
            '   - 渣男/渣女/海王的经典操作',
            '2. 词汇要求：平民词和卧底词必须属于同一个极度细分的垂直领域。两者在概念和场景上必须高度相似且具有极强的迷惑性，但本质或细节上存在致命差异。（例如：传教士 vs 老汉推车；种草莓 vs 法式湿吻；打桩机 vs 缝纫机；制服诱惑 vs 角色扮演）。请尽量避免举例中的词汇。',
            '3. 创新约束：禁止使用常见的陈词滥调。每次生成的词汇必须发散思维，极具脑洞，适合玩家进行隐晦的描述、试探与伪装。',
            '4. 绝对不要给出任何解释、前言或废话。',
            '',
            '【输出格式要求】',
            '必须严格按照以下标签格式输出（注意闭合标签准确），千万不要输出Markdown语法或其他无关内容！',
            '',
            '<玩家生成>',
            '玩家昵称：昵称1',
            '性格：性格描述1',
            '---',
            '玩家昵称：昵称2',
            '性格：性格描述2',
            '</玩家生成>',
            '',
            '<游戏身份词>',
            '普通玩家身份词：词A',
            '卧底玩家身份词：词B',
            '</游戏身份词>'
        ].join('\n');
    }

    _parseUndercoverDealerResult(text = '') {
        const source = String(text || '').trim();
        const playerBlock = source.match(/<玩家生成>([\s\S]*?)<\/玩家生成>/)?.[1] || '';
        const players = playerBlock
            .split(/\n\s*---\s*\n/)
            .map(section => ({
                name: String(section.match(/玩家昵称\s*[:：]\s*([^\n]+)/)?.[1] || '').trim(),
                personality: String(section.match(/性格\s*[:：]\s*([\s\S]*?)$/)?.[1] || '').trim()
            }))
            .filter(player => player.name && player.personality);
        const wordBlock = source.match(/<游戏身份词>([\s\S]*?)<\/游戏身份词>/)?.[1] || '';
        return {
            players,
            wordPair: {
                civilian: String(wordBlock.match(/普通玩家身份词\s*[:：]\s*([^\n]+)/)?.[1] || '').trim(),
                undercover: String(wordBlock.match(/卧底玩家身份词\s*[:：]\s*([^\n]+)/)?.[1] || '').trim()
            }
        };
    }

    _parseUndercoverSpeech(text = '') {
        const source = String(text || '').trim();
        return String(source.match(/<谁是卧底发言>([\s\S]*?)<\/谁是卧底发言>/)?.[1] || '').trim();
    }

    _parseUndercoverVotes(text = '') {
        const source = String(text || '').trim();
        const block = source.match(/<谁是卧底投票>([\s\S]*?)<\/谁是卧底投票>/)?.[1] || '';
        const voteText = block.match(/票型\s*[:：]\s*([^\n]+)/)?.[1] || block;
        const votes = [];
        const seen = new Set();
        const pattern = /(\d+)\s*(?:号)?\s*(?:->|→|投给|投)\s*(\d+)\s*(?:号)?/g;
        let match = null;
        while ((match = pattern.exec(voteText))) {
            const voterSeat = Number(match[1]);
            const targetSeat = Number(match[2]);
            if (seen.has(voterSeat)) continue;
            seen.add(voterSeat);
            votes.push({ voterSeat, targetSeat });
        }
        return votes;
    }

    move2048(direction) {
        const result = this.game2048Data.move(direction);
        if (result.moved) this.game2048View.render();
    }

    reset2048() {
        this.game2048Data.reset();
        this.game2048View.render();
    }

    openSudoku() {
        this.applyPhoneChromeTheme();
        this.currentView = 'sudoku';
        this.sudokuView.render();
    }

    newSudoku(difficulty) {
        this.sudokuData.newGame(difficulty);
        this.sudokuView.render();
    }

    selectSudokuCell(row, col) {
        this.sudokuData.select(row, col);
        this.sudokuView.render();
    }

    setSudokuNumber(value) {
        this.sudokuData.setNumber(value);
        this.sudokuView.render();
    }

    eraseSudoku() {
        this.sudokuData.erase();
        this.sudokuView.render();
    }

    undoSudoku() {
        this.sudokuData.undo();
        this.sudokuView.render();
    }

    toggleSudokuNoteMode() {
        this.sudokuData.toggleNoteMode();
        this.sudokuView.render();
    }

    autoNoteSudoku() {
        this.sudokuData.autoNotes();
        this.sudokuView.render();
    }

    hintSudoku() {
        this.sudokuData.hint();
        this.sudokuView.render();
    }

    openCatbox() {
        this.applyPhoneChromeTheme();
        this.currentView = 'catbox';
        this.catboxView.resetHudCollapsed?.();
        this.catboxView.render();
    }

    openWerewolf() {
        this.applyPhoneChromeTheme();
        this.currentView = 'werewolf';
        this.werewolfData.updateUserInfo(this._getWerewolfUserInfo());
        this.werewolfView.openEntryPrompt();
        this.werewolfView.render();
        const state = this.werewolfData.getState();
        if (state?.phase === 'night' && !this.werewolfData.isUserNightTurn?.()) {
            Promise.resolve().then(() => this.driveWerewolfNight());
        }
    }

    startNewWerewolfGame(options = {}) {
        this.werewolfData.reset(this._getWerewolfUserInfo(), options);
        this.werewolfView.closeEntryPrompt();
        this.werewolfView.render();
        this.driveWerewolfNight();
    }

    getWechatContactsForWerewolf() {
        return this.getWechatContactsForPoker();
    }

    getDefaultWerewolfPrompt() {
        return [
            '你正在为小手机狼人杀扮演当前发言玩家。',
            '你只能根据系统公告、场上公开状态和已经出现的发言来判断。',
            '你会收到自己的真实身份，但绝不能在发言中直接暴露身份，除非当前策略确实需要跳身份。',
            '你不能读取或泄露其他玩家的真实身份，也不要说“系统告诉我”。',
            '首日白天如果系统公告没有给出夜晚结果，不能凭空说查杀、金水、银水、验人结果、守护结果或刀口信息。',
            '第一轮发言以自我介绍、表水、轻度试探和听后置位发言为主，不要直接推进到完整推理结论。',
            '发言要像真实玩家：可以怀疑、拉票、反驳、试探、隐藏、伪装或分析票型，但必须围绕场上公开信息。',
            '禁止描写心理活动、动作、表情或旁白，不要使用括号补充任何非发言内容。',
            '每次只输出当前玩家 1 段发言，建议 40-120 字。',
            '必须只返回 <狼人杀发言> 标签包裹内容，不要 Markdown，不要解释。'
        ].join('\n');
    }

    getWerewolfPrompt() {
        const saved = String(this.storage?.get?.('games_werewolf_ai_prompt') || '').trim();
        return saved || this.getDefaultWerewolfPrompt();
    }

    setWerewolfPrompt(value) {
        const text = String(value || '').trim();
        this.storage?.set?.('games_werewolf_ai_prompt', text, true);
        return text;
    }

    resetWerewolfPrompt() {
        this.storage?.set?.('games_werewolf_ai_prompt', '', true);
        return this.getDefaultWerewolfPrompt();
    }

    _getUndercoverPromptManager() {
        if (typeof window === 'undefined') return null;
        const promptManager = window.VirtualPhone?.promptManager;
        promptManager?.ensureLoaded?.();
        return promptManager || null;
    }

    getUndercoverDealerPromptTemplate() {
        const promptManager = this._getUndercoverPromptManager();
        return String(
            promptManager?.getPromptForFeature?.('games', 'undercoverDealer')
            || this.getDefaultUndercoverDealerPromptTemplate()
        );
    }

    getDefaultUndercoverPrompt() {
        const promptManager = this._getUndercoverPromptManager();
        const managedDefault = promptManager?.getBuiltInPromptPresets?.('games', 'undercoverSpeech')?.[0]?.content;
        if (managedDefault) return String(managedDefault);
        return [
            '你正在参与一场六人谁是卧底游戏。你的初始状态不知道自己是平民还是卧底。',
            '请严格遵守以下游戏规则和发言逻辑：',
            '',
            '1. 【信息限制】你只能根据系统提供给你的词语、当前轮次、其他玩家的公开发言和投票记录进行判断。绝对不能在发言中直接说出或包含你的词语本身，也不能泄露任何系统提示信息。',
            '2. 【身份推理与发言策略】',
            '   - 根据上下文发言内容，请在暗中将他们的描述与你手中的词语进行对比。',
            '   - 若他人的描述与你的词语相符，说明你大概率是平民。你的发言需继续描述自己的词，可以适度试探、抓漏洞或自证。',
            '   - 若你发现多人的描述与你的词语存在明显偏差或冲突，说明你极有可能是卧底！此时你必须立刻停止描述自己的词，改为根据其他人的发言推测出“平民词”，并紧接着他们的逻辑进行伪装描述，以防被票出。',
            '3. 【发言风格】必须符合玩家角色性格，语气简短、自然、口语化。禁止出现任何心理活动、动作描写或旁白。',
            '4. 【篇幅限制】每次只生成当前你的一段发言，内容控制在3到8个短句之内。',
            '5. 【格式要求】必须且只能返回 `<谁是卧底发言>` 标签包裹的发言内容，不要使用任何 Markdown 语法，不要输出任何解释、推理过程或多余的废话。',
            '',
            '<谁是卧底发言>',
            '',
            '</谁是卧底发言>'
        ].join('\n');
    }

    getUndercoverPrompt() {
        const promptManager = this._getUndercoverPromptManager();
        if (promptManager) {
            this._migrateLegacyUndercoverPrompt(promptManager);
            return String(
                promptManager.getPromptForFeature?.('games', 'undercoverSpeech')
                || this.getDefaultUndercoverPrompt()
            );
        }
        const saved = String(this.storage?.get?.('games_undercover_ai_prompt') || '').trim();
        return saved || this.getDefaultUndercoverPrompt();
    }

    _migrateLegacyUndercoverPrompt(promptManager = this._getUndercoverPromptManager()) {
        if (!promptManager || this.storage?.get?.('games_undercover_prompt_presets_migrated')) return;
        const legacy = String(this.storage?.get?.('games_undercover_ai_prompt') || '').trim();
        if (legacy) {
            const existing = promptManager.getPromptUserPresets?.('games', 'undercoverSpeech')
                ?.find?.(preset => String(preset?.content || '') === legacy);
            if (existing) promptManager.applyPromptPreset?.('games', 'undercoverSpeech', existing.id);
            else promptManager.createPromptUserPreset?.('games', 'undercoverSpeech', '旧版自定义提示词', legacy);
        }
        this.storage?.set?.('games_undercover_prompt_presets_migrated', '1', true);
    }

    setUndercoverPrompt(value) {
        const text = String(value || '').trim();
        const promptManager = this._getUndercoverPromptManager();
        if (promptManager) {
            this._migrateLegacyUndercoverPrompt(promptManager);
            const activeId = promptManager.getActivePromptPresetId?.('games', 'undercoverSpeech') || '';
            if (activeId && !String(activeId).startsWith('builtin:')) {
                promptManager.updateActivePromptUserPreset?.('games', 'undercoverSpeech', text);
            } else {
                promptManager.createPromptUserPreset?.('games', 'undercoverSpeech', '自定义提示词', text);
            }
            return text;
        }
        this.storage?.set?.('games_undercover_ai_prompt', text, true);
        return text;
    }

    resetUndercoverPrompt() {
        const promptManager = this._getUndercoverPromptManager();
        if (promptManager) {
            return promptManager.resetPromptToDefault?.('games', 'undercoverSpeech') || this.getDefaultUndercoverPrompt();
        }
        this.storage?.set?.('games_undercover_ai_prompt', '', true);
        return this.getDefaultUndercoverPrompt();
    }

    getUndercoverShareText() {
        const game = this.undercoverData?.getState?.()?.game || {};
        if (game.phase !== 'ended') return '';

        const players = Array.isArray(game.players) ? game.players.filter(Boolean) : [];
        const playerBySeat = new Map(players.map(player => [Number(player.seat), player]));
        const user = players.find(player => player.isUser);
        const winnerFaction = game.winner === 'civilian' ? '平民阵营' : (game.winner === 'undercover' ? '卧底' : '未结算');
        const userFaction = user?.role === 'undercover' ? 'undercover' : 'civilian';
        const userResult = game.winner && user ? (game.winner === userFaction ? '你获胜' : '你落败') : '';
        const undercover = playerBySeat.get(Number(game.undercoverSeat))
            || players.find(player => player.role === 'undercover');
        const sourceMap = { user: '本人', wechat: '微信好友', friend: '微信好友', ai: 'AI玩家' };
        const playerLines = players
            .slice()
            .sort((a, b) => Number(a.seat) - Number(b.seat))
            .map(player => {
                const role = player.role === 'undercover' ? '卧底' : '平民';
                const state = player.alive === false ? '已出局' : '存活';
                const source = sourceMap[player.source] || (player.isUser ? '本人' : '真人玩家');
                return `${Number(player.seat)}号 ${player.name || '玩家'} / ${role} / ${state} / ${source}`;
            });
        const voteLines = (Array.isArray(game.voteHistory) ? game.voteHistory : []).map(record => {
            const votes = (record.votes || []).map(vote => {
                const voter = playerBySeat.get(Number(vote.voterSeat));
                const target = playerBySeat.get(Number(vote.targetSeat));
                return `${Number(vote.voterSeat)}号${voter?.name ? ` ${voter.name}` : ''} → ${Number(vote.targetSeat)}号${target?.name ? ` ${target.name}` : ''}`;
            }).join('，');
            const eliminated = playerBySeat.get(Number(record.eliminatedSeat));
            const result = eliminated
                ? `${Number(eliminated.seat)}号 ${eliminated.name || '玩家'} 出局`
                : `平票${(record.tiedSeats || []).length ? `（${record.tiedSeats.map(seat => `${Number(seat)}号`).join('、')}）` : ''}，无人出局`;
            return `第${Number(record.round || 1)}轮：${votes || '暂无投票'}；${result}`;
        });
        const speechLines = this._formatUndercoverPublicLog(game.chatMessages, 120);
        const storyTime = this._getUndercoverStoryShareTimeParts();
        return [
            '[谁是卧底战绩]',
            storyTime.sharedAt ? `分享时间：${storyTime.sharedAt}` : '',
            `结果：${winnerFaction}获胜${userResult ? `（${userResult}）` : ''}`,
            `平民词：${game.wordPair?.civilian || '未知'}`,
            `卧底词：${game.wordPair?.undercover || '未知'}`,
            `卧底：${undercover ? `${Number(undercover.seat)}号 ${undercover.name || '玩家'}` : '未知'}`,
            '',
            '本局玩家：',
            playerLines.length ? playerLines.map(line => `- ${line}`).join('\n') : '- 暂无',
            '',
            '投票记录：',
            voteLines.length ? voteLines.map(line => `- ${line}`).join('\n') : '- 暂无',
            '',
            '公开发言：',
            speechLines.length ? speechLines.join('\n') : '暂无公开发言'
        ].filter(line => line !== '').join('\n');
    }

    buildUndercoverShareCardData(shareText = '') {
        const content = String(shareText || this.getUndercoverShareText() || '').trim();
        const game = this.undercoverData?.getState?.()?.game || {};
        const user = (game.players || []).find(player => player.isUser);
        const userFaction = user?.role === 'undercover' ? 'undercover' : 'civilian';
        const userResult = game.winner && user ? (game.winner === userFaction ? '你获胜' : '你落败') : '';
        const winnerText = game.winner === 'civilian' ? '平民阵营获胜' : (game.winner === 'undercover' ? '卧底获胜' : '本局结束');
        const words = [game.wordPair?.civilian, game.wordPair?.undercover].filter(Boolean).join(' vs ');
        return {
            title: '谁是卧底本局战绩',
            desc: [winnerText, userResult, words].filter(Boolean).join(' · ') || '点击查看完整本局战绩',
            content,
            result: [winnerText, userResult].filter(Boolean).join(' · '),
            sharedAt: this._getUndercoverStoryShareTimeParts().sharedAt
        };
    }

    _getUndercoverStoryShareTimeParts() {
        try {
            const timeManager = window.VirtualPhone?.timeManager;
            const storyTime = timeManager?.getCurrentStoryTime?.();
            const date = String(storyTime?.date || '').trim();
            const time = String(storyTime?.time || '').trim().replace('：', ':');
            if (date && /^\d{1,2}:\d{2}$/.test(time)) {
                const timestamp = Number.isFinite(Number(storyTime?.timestamp))
                    ? Number(storyTime.timestamp)
                    : (typeof timeManager?.parseTimeToTimestamp === 'function' ? timeManager.parseTimeToTimestamp(storyTime) : 0);
                return {
                    date,
                    time,
                    weekday: storyTime?.weekday || '',
                    timestamp: Number.isFinite(Number(timestamp)) ? Number(timestamp) : 0,
                    sharedAt: [date, storyTime?.weekday, time].filter(Boolean).join(' ')
                };
            }
        } catch (error) {
            console.warn('[Games] 读取谁是卧底分享时间失败:', error);
        }
        return { date: '', time: '', weekday: '', timestamp: 0, sharedAt: '' };
    }

    async shareUndercoverToWechat(targetName, options = {}) {
        const recipientName = String(targetName || '').trim();
        if (!recipientName) throw new Error('未选择微信好友或群聊');
        const wechatData = this.getWechatData();
        if (!wechatData) throw new Error('微信数据库加载失败');

        const game = this.undercoverData?.getState?.()?.game;
        if (!game || game.phase !== 'ended') throw new Error('本局尚未结束，暂时无法分享');
        const shareText = String(options.shareText || this.getUndercoverShareText() || '').trim();
        if (!shareText) throw new Error('暂无可分享的谁是卧底战绩');

        let chat = (wechatData.getChatList?.() || []).find(item => String(item?.name || '').trim() === recipientName);
        if (!chat) {
            const contact = (wechatData.getContacts?.() || []).find(item => String(item?.name || '').trim() === recipientName);
            if (contact) {
                chat = wechatData.createChat({
                    id: `chat_${contact.id || Date.now()}`,
                    contactId: contact.id,
                    name: contact.name,
                    type: 'single',
                    avatar: contact.avatar || ''
                });
            }
        }
        if (!chat) throw new Error('未找到对应的微信好友或群聊');

        const userInfo = wechatData.getUserInfo?.() || {};
        const storyTime = this._getUndercoverStoryShareTimeParts();
        const undercoverData = this.buildUndercoverShareCardData(shareText);
        const shareTime = this._getWechatShareTimeFields(storyTime);
        wechatData.addMessage(chat.id, {
            from: 'me',
            content: '[谁是卧底战绩分享]',
            type: 'undercover_card',
            undercoverData,
            avatar: userInfo.avatar || '',
            ...shareTime
        });

        chat.unread = (chat.unread || 0) + 1;
        chat.lastMessage = '[谁是卧底战绩分享]';
        chat.time = shareTime.time || chat.time;
        if (shareTime.timestamp) chat.timestamp = shareTime.timestamp;
        wechatData.saveData?.();
        this._syncWechatHomeBadge(wechatData);
        return { success: true, chatId: chat.id, chatName: chat.name };
    }

    getWerewolfShareText() {
        const state = this.werewolfData?.getState?.() || {};
        const gameOver = !!state.gameOver || state.phase === 'ended';
        const roleMode = state.roleRevealMode === 'hidden' ? '暗牌局' : '明牌局';
        const winnerText = state.winner === 'werewolves'
            ? '狼人阵营胜利'
            : (state.winner === 'villagers' ? '好人阵营胜利' : '未结算');
        const phaseMap = { setup: '准备', night: '夜晚', day: '白天', vote: '投票', last_words: '遗言', ended: '结束' };
        const visibilityText = item => item?.visibility === 'public' ? '公开' : '后台';
        const displayRecordText = (item = {}) => {
            if (gameOver) return String(item.text || '').trim();
            if (item.visibility === 'public') return String(item.text || '').trim();
            return String(item.redactedText || '').trim();
        };
        const players = (state.players || [])
            .filter(player => player && !player.empty)
            .map(player => {
                const roleText = gameOver || state.roleRevealMode !== 'hidden'
                    ? ` / ${player.role || '未知'}`
                    : '';
                const aliveText = player.alive === false ? '死亡' : '存活';
                return `${player.seat}号 ${player.name || '玩家'}${roleText} / ${aliveText}`;
            });
        const records = (Array.isArray(state.replayLog) ? state.replayLog : [])
            .map(item => ({
                meta: `第${Number(item.day || 1)}天 · ${phaseMap[item.phase] || item.phase || '记录'} · ${visibilityText(item)}`,
                text: displayRecordText(item)
            }))
            .filter(item => item.text);
        const storyTime = this._getWerewolfStoryShareTimeParts();
        return [
            '[狼人杀复盘]',
            storyTime.sharedAt ? `分享时间：${storyTime.sharedAt}` : '',
            `局型：${roleMode}`,
            `结果：${winnerText}`,
            '',
            '玩家：',
            players.length ? players.map(line => `- ${line}`).join('\n') : '- 暂无',
            '',
            '复盘记录：',
            records.length ? records.map(item => `【${item.meta}】\n${item.text}`).join('\n\n') : '暂无复盘记录'
        ].filter(line => line !== '').join('\n');
    }

    buildWerewolfShareCardData(shareText = '') {
        const content = String(shareText || this.getWerewolfShareText() || '').trim();
        const state = this.werewolfData?.getState?.() || {};
        const lines = content
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
        const summaryLines = lines
            .filter(line => !/^\[[^\]]+\]$/.test(line))
            .slice(0, 3);
        return {
            title: '狼人杀复盘记录',
            desc: summaryLines.join(' / ') || '点击查看完整复盘内容',
            content,
            result: state.winner === 'werewolves' ? '狼人阵营胜利' : (state.winner === 'villagers' ? '好人阵营胜利' : ''),
            sharedAt: this._getWerewolfStoryShareTimeParts().sharedAt
        };
    }

    _getWerewolfStoryShareTimeParts() {
        try {
            const timeManager = window.VirtualPhone?.timeManager;
            const storyTime = timeManager?.getCurrentStoryTime?.();
            const date = String(storyTime?.date || '').trim();
            const time = String(storyTime?.time || '').trim().replace('：', ':');
            if (date && /^\d{1,2}:\d{2}$/.test(time)) {
                const timestamp = Number.isFinite(Number(storyTime?.timestamp))
                    ? Number(storyTime.timestamp)
                    : (typeof timeManager?.parseTimeToTimestamp === 'function' ? timeManager.parseTimeToTimestamp(storyTime) : 0);
                return {
                    date,
                    time,
                    weekday: storyTime?.weekday || '',
                    timestamp: Number.isFinite(Number(timestamp)) ? Number(timestamp) : 0,
                    sharedAt: [date, storyTime?.weekday, time].filter(Boolean).join(' ')
                };
            }
        } catch (error) {
            console.warn('[Games] 读取狼人杀分享时间失败:', error);
        }
        return { date: '', time: '', weekday: '', timestamp: 0, sharedAt: '' };
    }

    async shareWerewolfToWechat(targetName, options = {}) {
        const friendName = String(targetName || '').trim();
        if (!friendName) throw new Error('未选择微信好友');
        const wechatData = this.getWechatData();
        if (!wechatData) throw new Error('微信数据库加载失败');

        const shareText = String(options.shareText || this.getWerewolfShareText() || '').trim();
        if (!shareText) throw new Error('暂无可分享的狼人杀复盘');

        let chat = (wechatData.getChatList?.() || []).find(item => String(item?.name || '').trim() === friendName);
        if (!chat) {
            const contact = (wechatData.getContacts?.() || []).find(item => String(item?.name || '').trim() === friendName);
            if (contact) {
                chat = wechatData.createChat({
                    id: `chat_${contact.id || Date.now()}`,
                    contactId: contact.id,
                    name: contact.name,
                    type: 'single',
                    avatar: contact.avatar || ''
                });
            }
        }
        if (!chat) {
            chat = wechatData.createChat({
                name: friendName,
                type: 'single',
                avatar: '👤'
            });
        }

        const userInfo = wechatData.getUserInfo?.() || {};
        const storyTime = this._getWerewolfStoryShareTimeParts();
        const werewolfData = this.buildWerewolfShareCardData(shareText);
        const shareTime = this._getWechatShareTimeFields(storyTime);
        wechatData.addMessage(chat.id, {
            from: 'me',
            content: '[狼人杀复盘分享]',
            type: 'werewolf_card',
            werewolfData,
            avatar: userInfo.avatar || '',
            ...shareTime
        });

        if (chat) {
            chat.unread = (chat.unread || 0) + 1;
            chat.lastMessage = '[狼人杀复盘分享]';
            chat.time = shareTime.time || chat.time;
            if (shareTime.timestamp) {
                chat.timestamp = shareTime.timestamp;
            }
        }
        wechatData.saveData?.();
        this._syncWechatHomeBadge(wechatData);
        return { success: true, chatId: chat.id, chatName: chat.name };
    }

    async startWerewolfMatch(invitedContacts = []) {
        this.werewolfData.randomizeSetupUserSeat();
        const emptySeats = this.werewolfData.getEmptySeats();
        if (!emptySeats.length) {
            this.phoneShell?.showNotification?.('狼人杀', '已经没有空位需要匹配', '🐺');
            return;
        }
        this.werewolfData.setMatching(true);
        this.werewolfView.render();
        try {
            const invited = this._buildWerewolfInvitedPlayers(invitedContacts, emptySeats);
            const remainingSeats = emptySeats.filter(seat => !invited.some(player => Number(player.seat) === Number(seat)));
            let generated = [];
            if (remainingSeats.length) {
                const result = await this._callWerewolfMatchAi(remainingSeats);
                generated = this._parseWerewolfMatch(result?.summary || result?.content || result?.text || '')
                    .filter(player => remainingSeats.includes(Number(player.seat)))
                    .map(player => ({ ...player, source: 'ai' }));
                if (generated.length !== remainingSeats.length) {
                    generated = this._buildWerewolfFallbackPlayers(remainingSeats, generated);
                }
            }
            this.werewolfData.applyMatchedPlayers([...invited, ...generated]);
            this.werewolfView.render();
            await this.driveWerewolfNight();
        } catch (error) {
            console.warn('[Werewolf] 匹配失败:', error);
            const message = this._formatError?.(error, '匹配失败') || error?.message || '匹配失败';
            this.werewolfData.applyMatchError(message);
            this.werewolfView.render();
            this.phoneShell?.showNotification?.('狼人杀匹配失败', message, '❌');
        }
    }

    async _callWerewolfMatchAi(emptySeats = []) {
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager?.callAI) throw new Error('API Manager 未初始化');
        await this._waitWerewolfApiCooldown();
        const seatsText = emptySeats.map(seat => `${seat}号`).join('、');
        const userSeat = this.werewolfData.getState().players?.find(player => player.isUser)?.seat || 8;
        const messages = [
            {
                role: 'system',
                name: 'SYSTEM (狼人杀匹配)',
                isPhoneMessage: true,
                content: [
                    '你是狼人杀游戏的匹配系统，只负责生成临时游戏好友资料。',
                    `当前是 8 人局狼人杀，${userSeat}号是用户本人，其余空位需要生成游戏好友。`,
                    '只生成姓名、性别、性格及语言风格，不要分配狼人杀身份，不要写游戏过程。',
                    '姓名应像真实中文昵称或姓名，避免重复，性格和语言风格要适合狼人杀发言。',
                    '必须只返回 <狼人杀匹配环节> 标签包裹的内容，不要 Markdown，不要解释。'
                ].join('\n')
            },
            {
                role: 'user',
                isPhoneMessage: true,
                content: [
                    `目前空置位置：${seatsText}。`,
                    '请为这些位置生成游戏好友。',
                    '严格使用以下格式：',
                    '<狼人杀匹配环节>',
                    '【3号】',
                    '姓名：',
                    '性别：',
                    '性格及语言风格：',
                    '---',
                    '【4号】',
                    '姓名：',
                    '性别：',
                    '性格及语言风格：',
                    '</狼人杀匹配环节>'
                ].join('\n')
            }
        ];
        this._lastWerewolfApiRequestAt = Date.now();
        return apiManager.callAI(messages, {
            appId: 'games',
            temperature: 0.9,
            max_tokens: 900
        });
    }

    async _waitWerewolfApiCooldown() {
        const state = this.werewolfData?.getState?.() || {};
        const latestSpeechAt = Number(state.lastSpeechAt || 0);
        const latestAnchor = Math.max(
            Number(this._lastWerewolfApiRequestAt || 0),
            Number.isFinite(latestSpeechAt) ? latestSpeechAt : 0
        );
        const waitMs = latestAnchor
            ? Math.max(0, WEREWOLF_API_COOLDOWN_MS - (Date.now() - latestAnchor))
            : 0;
        if (waitMs > 0) {
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }
    }

    async driveWerewolfDaySpeeches() {
        if (this._werewolfDriving) return;
        this._werewolfDriving = true;
        try {
            let guard = 0;
            while (guard < 16) {
                guard += 1;
                const state = this.werewolfData.getState();
                if (!state || state.gameOver || state.phase !== 'day') break;
                const speaker = this.werewolfData.getCurrentSpeaker();
                if (!speaker) break;
                if (speaker.alive === false) {
                    this.werewolfData.skipDeadSpeaker();
                    this.werewolfView.render();
                    continue;
                }
                if (speaker.isUser) {
                    this.werewolfData.setActiveSpeaker(speaker.seat, false);
                    this.werewolfData.addSystemNotice(`请 ${speaker.seat}号 ${speaker.name || '你'} 发言。`);
                    this.werewolfView.render();
                    break;
                }
                const ok = await this._runWerewolfAiSpeechTurn(speaker);
                if (ok === false) break;
            }
        } finally {
            this._werewolfDriving = false;
            this.werewolfView.render();
        }
    }

    async driveWerewolfNight() {
        if (this._werewolfNightDriving) return;
        this._werewolfNightDriving = true;
        try {
            let guard = 0;
            while (guard < 8) {
                guard += 1;
                const state = this.werewolfData.getState();
                if (!state || state.gameOver || state.phase !== 'night') return;
                if (!state.nightStep) {
                    this.werewolfData.startDayFromNight();
                    this.werewolfView.render();
                    await this.driveWerewolfDaySpeeches();
                    return;
                }
                if (this.werewolfData.isUserNightTurn()) {
                    this.werewolfView.render();
                    return;
                }
                const ok = await this._runWerewolfAiNightAction();
                if (ok === false) {
                    this.werewolfView.render();
                    return;
                }
                this.werewolfView.render();
                await new Promise(resolve => setTimeout(resolve, 450));
            }
        } finally {
            this._werewolfNightDriving = false;
        }
    }

    submitWerewolfNightAction(payload = {}) {
        const state = this.werewolfData.getState();
        if (!state || state.gameOver) return;
        const user = state?.players?.find?.(player => player.isUser);
        const isWitchTurn = state?.phase === 'night' && state?.nightStep === 'witch' && user?.role === '女巫';
        const isSeerTurn = state?.phase === 'night' && state?.nightStep === 'seer' && user?.role === '预言家';
        const usePotion = String(payload.usePotion || '').trim();
        const targetSeat = Number(payload.targetSeat || 0);
        let seerResultText = '';
        if (isWitchTurn && usePotion === 'poison' && targetSeat && targetSeat === Number(user.seat || 0)) {
            this.phoneShell?.showNotification?.('狼人杀', '女巫不能对自己使用毒药，已按跳过处理。', '🌙');
            payload = { ...payload, targetSeat: 0, usePotion: '' };
        } else if (isWitchTurn && !usePotion) {
            this.phoneShell?.showNotification?.('狼人杀', '你选择不使用药剂，夜晚继续。', '🌙');
        }
        if (isSeerTurn) {
            const target = (state.players || []).find(player => Number(player.seat) === targetSeat && !player.empty && player.alive !== false);
            if (!target || Number(target.seat) === Number(user.seat || 0)) {
                this.phoneShell?.showNotification?.('狼人杀', '请选择一名可查验的玩家', '⚠️');
                return;
            }
            const resultRole = target.role === '狼人' ? '狼人' : '好人';
            payload = { ...payload, result: { seat: targetSeat, role: resultRole } };
            seerResultText = `查验结果：${targetSeat}号 ${target.name || '玩家'} 是${resultRole}。`;
        }
        if (state.nightStep === 'werewolf' && user?.role === '狼人') {
            payload = {
                ...payload,
                discussion: (Array.isArray(state.wolfChat) ? state.wolfChat : [])
                    .map(item => `${item.seat || '狼队'}号：${item.text}`)
                    .join(' / ')
            };
        }
        this.werewolfData.applyUserNightAction(payload);
        if (seerResultText) {
            this.werewolfData.addSystemNotice(`${seerResultText} 夜晚继续。`);
            this.phoneShell?.showNotification?.('预言家查验', seerResultText, '🔮');
        }
        this.werewolfView.render();
        Promise.resolve().then(() => this.driveWerewolfNight());
    }

    submitWerewolfWolfChat(text = '') {
        const state = this.werewolfData.getState();
        const user = state?.players?.find?.(player => player.isUser);
        const content = String(text || '').trim();
        if (!content || state?.phase !== 'night' || state?.nightStep !== 'werewolf' || user?.role !== '狼人') return;
        this.werewolfData.addWolfChatMessage(user.seat, content);
        this.werewolfView.render();
    }

    async requestWerewolfWolfMateAdvice() {
        const state = this.werewolfData.getState();
        const user = state?.players?.find?.(player => player.isUser);
        if (!state || state.phase !== 'night' || state.nightStep !== 'werewolf' || user?.role !== '狼人' || state.wolfChatLoading) return;
        const mates = (state.players || []).filter(player => player.role === '狼人' && !player.isUser && player.alive !== false);
        if (!mates.length) {
            this.phoneShell?.showNotification?.('狼人杀', '没有存活的 AI 狼人队友可以商量', '🐺');
            return;
        }
        this.werewolfData.setWolfChatLoading(true);
        this.werewolfView.render();
        try {
            const result = await this._callWerewolfWolfMateAdviceAi(mates);
            if (result?.success === false) throw new Error(result.error || 'AI 请求失败');
            const advice = this._parseWerewolfWolfAdvice(result?.summary || result?.content || result?.text || '');
            this.werewolfData.addWolfChatMessage(mates[0].seat, advice || '我建议先刀最像神职的人，别暴露狼队视角。');
        } catch (error) {
            console.warn('[Werewolf] 狼队友建议失败:', error);
            this.phoneShell?.showNotification?.('狼人杀狼队友失败', error?.message || '请求失败', '❌');
        } finally {
            this.werewolfData.setWolfChatLoading(false);
            this.werewolfView.render();
        }
    }

    async resolveWerewolfVote() {
        const state = this.werewolfData.getState();
        if (!state || state.gameOver || state.phase !== 'vote' || state.voting) return;
        if (!this.werewolfData.canUserVote?.()) {
            this.werewolfData.setVoting?.(true);
            try {
                const result = await this._callWerewolfVoteAi(null);
                if (result?.success === false) throw new Error(result.error || 'AI 请求失败');
                const decision = this._parseWerewolfVoteDecision(result?.summary || result?.content || result?.text || '');
                const normalized = this._normalizeWerewolfVoteDecision(decision, null);
                this.werewolfData.applyVoteResult(normalized.targetSeat, normalized.votes, { reason: normalized.reason });
                this.werewolfView.render();
                await this.driveWerewolfLastWords();
            } catch (error) {
                console.warn('[Werewolf] 投票 AI 失败:', error);
                const fallbackSeat = this._fallbackWerewolfVoteTarget();
                this.werewolfData.applyVoteResult(fallbackSeat, [], { reason: '投票请求失败，系统按兜底规则放逐。' });
                this.werewolfView.render();
                await this.driveWerewolfLastWords();
            }
            return;
        }
        const user = state?.players?.find?.(player => player.isUser);
        return this.submitWerewolfUserVote(0);
    }

    async submitWerewolfUserVote(targetSeat) {
        const state = this.werewolfData.getState();
        if (!state || state.gameOver || state.phase !== 'vote') return;
        if (!this.werewolfData.canUserVote?.()) {
            this.phoneShell?.showNotification?.('狼人杀', '你当前不能投票', '⚠️');
            return;
        }
        const user = state.players.find(player => player.isUser);
        const target = Number(targetSeat || 0)
            ? this.werewolfData.getVoteTargets?.().find(player => Number(player.seat) === Number(targetSeat))
            : null;
        if (Number(targetSeat || 0) && !target) {
            this.phoneShell?.showNotification?.('狼人杀', '请选择一名可投票玩家', '⚠️');
            return;
        }
        const userVote = { voterSeat: Number(user.seat), targetSeat: Number(target?.seat || 0) };
        this.werewolfData.addSystemNotice(`${userVote.voterSeat}号已${userVote.targetSeat ? '投票' : '弃票'}，等待其他玩家投票。`);
        this.werewolfData.setVoting?.(true);
        try {
            const result = await this._callWerewolfVoteAi(userVote);
            if (result?.success === false) throw new Error(result.error || 'AI 请求失败');
            const decision = this._parseWerewolfVoteDecision(result?.summary || result?.content || result?.text || '');
            const normalized = this._normalizeWerewolfVoteDecision(decision, userVote);
            this.werewolfData.applyVoteResult(normalized.targetSeat, normalized.votes, { reason: normalized.reason });
            this.werewolfView.render();
            await this.driveWerewolfLastWords();
        } catch (error) {
            console.warn('[Werewolf] 投票 AI 失败:', error);
            const fallbackSeat = Number(userVote.targetSeat || 0);
            this.werewolfData.applyVoteResult(fallbackSeat, [userVote], { reason: '投票请求失败，系统按已记录投票处理。' });
            this.werewolfData.setVoting?.(false);
            this.werewolfView.render();
            await this.driveWerewolfLastWords();
        }
    }

    async driveWerewolfLastWords() {
        if (this._werewolfLastWordsDriving) return;
        const state = this.werewolfData.getState();
        if (!state || state.gameOver || state.phase !== 'last_words') return;
        this._werewolfLastWordsDriving = true;
        const player = this.werewolfData.getEliminatedPlayer();
        try {
            if (!player) {
                this.werewolfData.startNextNight();
                this.werewolfView.render();
                await this.driveWerewolfNight();
                return;
            }
            if (player.isUser) {
                this.werewolfView.render();
                return;
            }
            this.werewolfData.setActiveSpeaker(player.seat, true);
            this.werewolfView.render();
            const result = await this._callWerewolfLastWordsAi(player);
            if (result?.success === false) throw new Error(result.error || 'AI 请求失败');
            const words = this._parseWerewolfLastWords(result?.summary || result?.content || result?.text || '');
            this.werewolfData.addLastWords(player.seat, words || '我没什么好说的，后面的人自己盘。');
        } catch (error) {
            console.warn('[Werewolf] 遗言 AI 失败:', error);
            const message = this._formatError?.(error, '遗言失败') || error?.message || '遗言失败';
            this.werewolfData.applySpeechError(`${player?.seat || '?'}号遗言中断，点击续接遗言可继续。${message}`);
            this.phoneShell?.showNotification?.('狼人杀遗言失败', `${player?.seat || '?'}号：${message}`, '❌');
            this.werewolfView.render();
            return;
        } finally {
            this._werewolfLastWordsDriving = false;
        }
        if (this.werewolfData.getState()?.gameOver) {
            this.werewolfView.render();
            return;
        }
        this.werewolfData.startNextNight();
        this.werewolfView.render();
        await this.driveWerewolfNight();
    }

    submitWerewolfUserLastWords(text = '') {
        const player = this.werewolfData.getEliminatedPlayer();
        if (!player?.isUser) return;
        this.werewolfData.addLastWords(player.seat, String(text || '').trim() || '我没有遗言。');
        if (this.werewolfData.getState()?.gameOver) {
            this.werewolfView.clearUserSpeechInput?.();
            this.werewolfView.render();
            return;
        }
        this.werewolfData.startNextNight();
        this.werewolfView.clearUserSpeechInput?.();
        this.werewolfView.render();
        this.driveWerewolfNight();
    }

    async _runWerewolfAiNightAction() {
        const state = this.werewolfData.getState();
        const step = String(state?.nightStep || '');
        const actors = this._getWerewolfNightActors(step);
        if (!actors.length) {
            this._applyFallbackWerewolfNightAction();
            return true;
        }
        const actor = actors[0];
        try {
            const result = await this._callWerewolfNightAi(actors, step);
            if (result?.success === false) throw new Error(result.error || 'AI 请求失败');
            const decision = this._parseWerewolfNightDecision(result?.summary || result?.content || result?.text || '', step);
            const normalized = this._normalizeWerewolfNightDecision(decision, step);
            this.werewolfData.applyNightAction(step, normalized, { actorSeat: actor.seat });
            return true;
        } catch (error) {
            console.warn('[Werewolf] 夜晚 AI 行动失败:', error);
            const message = this._formatError?.(error, '夜晚行动失败') || error?.message || '夜晚行动失败';
            this.werewolfData.applySpeechError(`${this._formatWerewolfNightStepName(step)}中断，点击续接发言可继续。${message}`);
            this.phoneShell?.showNotification?.('狼人杀夜晚行动失败', message, '❌');
            return false;
        }
    }

    async _callWerewolfNightAi(actors, step) {
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager?.callAI) throw new Error('API Manager 未初始化');
        await this._waitWerewolfApiCooldown();
        const messages = await this._buildWerewolfNightMessages(actors, step);
        this._lastWerewolfApiRequestAt = Date.now();
        return apiManager.callAI(messages, {
            appId: 'games',
            temperature: step === 'werewolf' ? 0.85 : 0.75,
            max_tokens: step === 'werewolf' ? 760 : 420
        });
    }

    async _callWerewolfWolfMateAdviceAi(mates = []) {
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager?.callAI) throw new Error('API Manager 未初始化');
        await this._waitWerewolfApiCooldown();
        const state = this.werewolfData.getState();
        const user = (state.players || []).find(player => player.isUser);
        const livePlayers = (state.players || []).filter(player => !player.empty && player.alive !== false);
        const publicLog = this._formatWerewolfPublicChatLog(state);
        const voteHistory = this._formatWerewolfVoteHistory(state);
        const wolfChat = (Array.isArray(state.wolfChat) ? state.wolfChat : []).slice(-12).map(item => {
            const speaker = (state.players || []).find(player => Number(player.seat) === Number(item.seat));
            return `${item.seat || '狼队'}号${speaker?.name ? ` ${speaker.name}` : ''}：${item.text}`;
        });
        const targetPool = livePlayers
            .filter(player => player.role !== '狼人')
            .map(player => `${player.seat}号 ${player.name}：存活`)
            .join('\n');
        const messages = [
            {
                role: 'system',
                name: 'SYSTEM (狼人杀狼队私聊)',
                isPhoneMessage: true,
                content: [
                    '你正在扮演用户的 AI 狼人队友，在夜晚私聊里给出建议。',
                    '这是狼人内部信息，不是公开发言。',
                    '你知道狼队成员，但不知道神职身份，只能根据座位、姓名、公开发言和投票记录推测刀人目标。',
                    '不要替用户最终决定，只给简短建议和理由。',
                    '必须只返回 <狼人杀狼队建议> 标签包裹内容。'
                ].join('\n')
            },
            {
                role: 'user',
                isPhoneMessage: true,
                content: [
                    `当前第 ${state.day || 1} 夜，狼人行动。`,
                    `用户狼人：${user?.seat || '?'}号 ${user?.name || '用户'}。`,
                    `AI 狼人队友：${mates.map(player => `${player.seat}号 ${player.name}`).join('、')}。`,
                    '可袭击目标：',
                    targetPool || '无',
                    '公开记录：',
                    publicLog.map(line => `- ${line}`).join('\n') || '- 暂无',
                    '历史投票结果：',
                    voteHistory.map(line => `- ${line}`).join('\n') || '- 暂无',
                    '狼队私聊记录：',
                    wolfChat.map(line => `- ${line}`).join('\n') || '- 暂无',
                    '<狼人杀狼队建议>',
                    '一句狼队私聊建议',
                    '</狼人杀狼队建议>'
                ].join('\n')
            }
        ];
        this._lastWerewolfApiRequestAt = Date.now();
        return apiManager.callAI(messages, { appId: 'games', temperature: 0.86, max_tokens: 260 });
    }

    async _buildWerewolfNightMessages(actors, step) {
        const state = this.werewolfData.getState();
        const actorList = Array.isArray(actors) ? actors.filter(Boolean) : [actors].filter(Boolean);
        const actor = actorList[0];
        const livePlayers = (state?.players || []).filter(player => !player.empty && player.alive !== false);
        const publicLog = this._formatWerewolfPublicChatLog(state);
        const voteHistory = this._formatWerewolfVoteHistory(state);
        const roleLines = livePlayers.map(player => {
            const visibleRole = step === 'werewolf' && player.role === '狼人'
                ? '狼人同伴'
                : Number(player.seat) === Number(actor.seat)
                    ? actor.role
                    : '未知';
            return `${player.seat}号 ${player.name}：${player.alive === false ? '死亡' : '存活'}，身份视角=${visibleRole}`;
        });
        const killedSeat = Number(state.lastKilledSeat || 0);
        const witchPotions = this.werewolfData.getWitchPotions?.() || { antidote: true, poison: true };
        const wolfTeamText = actorList.map(item => `${item.seat}号 ${item.name}`).join('、');
        const seerChecks = step === 'seer'
            ? (Array.isArray(state.seerChecks) ? state.seerChecks : [])
                .filter(item => Number(item.actorSeat || 0) === Number(actor?.seat || 0))
                .map(item => `第 ${Number(item.day || 1)} 夜查验 ${Number(item.targetSeat || 0)}号：${item.resultRole === '狼人' ? '狼人' : '好人'}`)
                .filter(Boolean)
            : [];
        const wolfActionInstruction = actorList.length > 1
            ? '你是狼人阵营。请模拟存活狼人短暂内部讨论，再给出最终袭击目标。目标必须是非狼人存活玩家，只写座位号。'
            : '你是狼人阵营。目前只剩一名存活狼人，请独自决定今晚袭击目标。目标必须是非狼人存活玩家，只写座位号。';
        const formatRule = [
            '<狼人杀夜晚行动>',
            step === 'werewolf' && actorList.length > 1 ? '讨论：存活狼人用内部语气简短商量，1-4句' : '',
            '目标：数字座位号或0',
            step === 'witch' ? '药剂：解药/毒药/不用' : '药剂：不用',
            '理由：一句话',
            '</狼人杀夜晚行动>'
        ].filter(Boolean).join('\n');
        const instructionMap = {
            guard: `你是守卫。请选择今晚守护一名存活玩家，可以守自己，但不能连续守和上一晚相同的目标${state.lastGuardSeat ? `。上次守护的是 ${state.lastGuardSeat} 号` : ''}。目标只写座位号。`,
            werewolf: wolfActionInstruction,
            seer: '你是预言家。请选择今晚查验一名存活玩家。目标只写座位号。',
            witch: killedSeat
                ? `你是女巫。今晚被狼人袭击的是 ${killedSeat}号。剩余药剂：解药${witchPotions.antidote ? '可用' : '已用'}，毒药${witchPotions.poison ? '可用' : '已用'}。只能使用仍可用的药，或不用药。`
                : `你是女巫。今晚没有可救信息。剩余药剂：解药${witchPotions.antidote ? '可用' : '已用'}，毒药${witchPotions.poison ? '可用' : '已用'}。只能使用仍可用的毒药，或不用药。`
        };
        const messages = [
            {
                role: 'system',
                name: 'SYSTEM (狼人杀夜晚裁判)',
                isPhoneMessage: true,
                content: [
                    '你正在为小手机狼人杀执行夜晚私密行动。',
                    '只根据你这个身份可知道的信息做决定。',
                    '不要输出公开发言，不要解释规则，不要 Markdown。',
                    instructionMap[step] || '请选择夜晚行动目标。',
                    '必须严格按标签格式返回。'
                ].join('\n')
            }
        ];
        messages.push(...await this._buildWerewolfWorldbookMessages());
        messages.push({
            role: 'user',
            isPhoneMessage: true,
            content: [
                `当前阶段：第 ${state.day || 1} 夜，${this._formatWerewolfNightStepName(step)}。`,
                step === 'werewolf'
                    ? `当前存活狼人：${wolfTeamText || '无'}。${actorList.length > 1 ? '请由存活狼人共同决定目标。' : '请由唯一存活狼人决定目标。'}`
                    : `当前行动者：${actor.seat}号 ${actor.name}，身份：${actor.role}。`,
                '存活玩家和你的身份视角：',
                roleLines.join('\n'),
                killedSeat ? `女巫可见刀口：${killedSeat}号。` : '',
                step === 'witch' ? `女巫剩余药剂：解药${witchPotions.antidote ? '可用' : '已用'}，毒药${witchPotions.poison ? '可用' : '已用'}。` : '',
                seerChecks.length ? `你的历史查验：${seerChecks.join('；')}。` : '',
                '公开记录：',
                publicLog.length ? publicLog.map(line => `- ${line}`).join('\n') : '- 暂无',
                '历史投票结果：',
                voteHistory.length ? voteHistory.map(line => `- ${line}`).join('\n') : '- 暂无',
                '返回格式：',
                formatRule
            ].filter(Boolean).join('\n')
        });
        return messages;
    }

    _parseWerewolfNightDecision(text = '', step = '') {
        const source = String(text || '').trim();
        const block = source.match(/<狼人杀夜晚行动>([\s\S]*?)<\/狼人杀夜晚行动>/)?.[1] || source;
        const discussion = this._extractWerewolfNightField(block, '讨论');
        const targetText = this._extractWerewolfNightField(block, '目标');
        const potionText = this._extractWerewolfNightField(block, '药剂');
        const reason = this._extractWerewolfNightField(block, '理由');
        return {
            targetSeat: this._extractFirstNumber(targetText),
            usePotion: this._normalizeWerewolfPotion(potionText, step),
            discussion,
            reason
        };
    }

    _parseWerewolfWolfAdvice(text = '') {
        const source = String(text || '').trim();
        return String(source.match(/<狼人杀狼队建议>([\s\S]*?)<\/狼人杀狼队建议>/)?.[1] || source).trim();
    }

    _normalizeWerewolfNightDecision(decision = {}, step = '') {
        const state = this.werewolfData.getState();
        const liveSeats = new Set((state?.players || []).filter(player => !player.empty && player.alive !== false).map(player => Number(player.seat)));
        let targetSeat = Number(decision.targetSeat || 0);
        if (!liveSeats.has(targetSeat)) targetSeat = 0;
        if (step === 'werewolf') {
            const target = (state?.players || []).find(player => Number(player.seat) === targetSeat);
            if (!target || target.role === '狼人') targetSeat = this._fallbackWerewolfNightTarget(step);
        } else if (step === 'seer' || step === 'guard') {
            if (!targetSeat) targetSeat = this._fallbackWerewolfNightTarget(step);
        }
        const result = step === 'seer' && targetSeat
            ? {
                seat: targetSeat,
                role: (state?.players || []).find(player => Number(player.seat) === targetSeat)?.role === '狼人' ? '狼人' : '好人'
            }
            : null;
        return {
            targetSeat,
            usePotion: this._normalizeWerewolfNightPotionForState(step, decision.usePotion, targetSeat),
            result,
            discussion: String(decision.discussion || '').trim(),
            reason: String(decision.reason || '').trim()
        };
    }

    _normalizeWerewolfNightPotionForState(step = '', potion = '', targetSeat = 0) {
        if (step !== 'witch') return '';
        const value = String(potion || '').trim();
        const state = this.werewolfData.getState();
        const potions = this.werewolfData.getWitchPotions?.() || { antidote: true, poison: true };
        if (value === 'antidote') {
            const killedSeat = Number(state?.lastKilledSeat || 0);
            return potions.antidote && killedSeat && Number(targetSeat) === killedSeat ? 'antidote' : '';
        }
        if (value === 'poison') return potions.poison && Number(targetSeat || 0) ? 'poison' : '';
        return '';
    }

    _applyFallbackWerewolfNightAction() {
        const state = this.werewolfData.getState();
        const step = String(state?.nightStep || '');
        const livePlayers = (state?.players || []).filter(player => !player.empty && player.alive !== false);
        const userSeat = Number((state?.players || []).find(player => player.isUser)?.seat || 0);
        const pick = (items) => {
            const pool = items.filter(Boolean);
            return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
        };
        if (step === 'guard') {
            const guard = livePlayers.find(player => player.role === '守卫');
            const lastGuardSeat = Number(state.lastGuardSeat || 0);
            const targets = livePlayers.filter(player => Number(player.seat) !== lastGuardSeat);
            const target = pick(targets.length ? targets : livePlayers);
            this.werewolfData.applyNightAction(step, { targetSeat: target?.seat || 0 }, { actorSeat: guard?.seat || 0 });
            return;
        }
        if (step === 'werewolf') {
            const wolves = livePlayers.filter(player => player.role === '狼人');
            const targets = livePlayers.filter(player => player.role !== '狼人');
            const target = pick(targets);
            this.werewolfData.applyNightAction(step, { targetSeat: target?.seat || userSeat || 0 }, { actorSeat: wolves[0]?.seat || 0 });
            return;
        }
        if (step === 'seer') {
            const seer = livePlayers.find(player => player.role === '预言家');
            const target = pick(livePlayers.filter(player => player.seat !== seer?.seat));
            const result = target ? { seat: target.seat, role: target.role === '狼人' ? '狼人' : '好人' } : null;
            this.werewolfData.applyNightAction(step, { targetSeat: target?.seat || 0, result }, { actorSeat: seer?.seat || 0 });
            return;
        }
        if (step === 'witch') {
            const witch = livePlayers.find(player => player.role === '女巫');
            const killedSeat = Number(state.lastKilledSeat || 0);
            const potions = this.werewolfData.getWitchPotions?.() || { antidote: true, poison: true };
            const shouldSave = potions.antidote && killedSeat && Math.random() < 0.45;
            this.werewolfData.applyNightAction(step, {
                usePotion: shouldSave ? 'antidote' : '',
                targetSeat: shouldSave ? killedSeat : 0
            }, { actorSeat: witch?.seat || 0 });
        }
    }

    _getWerewolfNightActors(step = '') {
        const state = this.werewolfData.getState();
        const roleMap = { guard: '守卫', werewolf: '狼人', seer: '预言家', witch: '女巫' };
        const role = roleMap[String(step || '')];
        if (!role) return [];
        const players = (state?.players || []).filter(player => player.role === role && player.alive !== false && !player.empty && !player.isUser);
        return step === 'werewolf' ? players : players.slice(0, 1);
    }

    _fallbackWerewolfNightTarget(step = '') {
        const state = this.werewolfData.getState();
        const livePlayers = (state?.players || []).filter(player => !player.empty && player.alive !== false);
        const pool = step === 'werewolf'
            ? livePlayers.filter(player => player.role !== '狼人')
            : livePlayers;
        return pool.length ? Number(pool[Math.floor(Math.random() * pool.length)].seat) : 0;
    }

    _extractWerewolfNightField(body, label) {
        const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = String(body || '').match(new RegExp(`${escaped}\\s*[:：]\\s*([^\\n\\r]*)`));
        return String(match?.[1] || '').trim();
    }

    _normalizeWerewolfPotion(text = '', step = '') {
        if (step !== 'witch') return '';
        const value = String(text || '').trim();
        if (/解药|救|antidote/i.test(value)) return 'antidote';
        if (/毒药|毒|poison/i.test(value)) return 'poison';
        return '';
    }

    _formatWerewolfNightStepName(step = '') {
        const map = { guard: '守卫行动', werewolf: '狼人行动', seer: '预言家行动', witch: '女巫行动' };
        return map[String(step || '')] || '夜晚行动';
    }

    async submitWerewolfUserSpeech(text = '') {
        const speech = String(text || '').trim();
        if (!speech) {
            return;
        }
        if (!this.werewolfData.canUserSpeak()) {
            this.phoneShell?.showNotification?.('狼人杀', '还没轮到你发言', '⏳');
            return;
        }
        const speaker = this.werewolfData.getCurrentSpeaker();
        this.werewolfData.setActiveSpeaker(speaker.seat, true);
        this.werewolfData.addSpeech(speaker.seat, speech);
        this.werewolfData.markSpeakerDone(speaker.seat);
        this.werewolfView.clearUserSpeechInput?.();
        this.werewolfView.render();
        await this.driveWerewolfDaySpeeches();
    }

    async continueWerewolfSpeech() {
        const phase = this.werewolfData.getState()?.phase;
        if (phase === 'night') {
            await this.driveWerewolfNight();
            return;
        }
        if (phase === 'last_words') {
            await this.driveWerewolfLastWords();
            return;
        }
        await this.driveWerewolfDaySpeeches();
    }

    async _runWerewolfAiSpeechTurn(player) {
        try {
            this.werewolfData.setActiveSpeaker(player.seat, true);
            this.werewolfView.render();
            const result = await this._callWerewolfSpeechAi(player);
            if (result?.success === false) throw new Error(result.error || 'AI 请求失败');
            const speech = this._parseWerewolfSpeech(result?.summary || result?.content || result?.text || '');
            if (!speech) throw new Error('AI 未返回有效狼人杀发言');
            this.werewolfData.addSpeech(player.seat, speech);
            this.werewolfData.markSpeakerDone(player.seat);
            return true;
        } catch (error) {
            console.warn('[Werewolf] AI 发言失败:', error);
            const message = this._formatError?.(error, 'AI 发言失败') || error?.message || 'AI 发言失败';
            this.werewolfData.applySpeechError(`${player.seat}号发言中断，点击续接发言可继续。${message}`);
            this.phoneShell?.showNotification?.('狼人杀 AI 失败', `${player.seat}号：${message}`, '❌');
            this.werewolfView.render();
            return false;
        }
    }

    async _callWerewolfSpeechAi(player) {
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager?.callAI) throw new Error('API Manager 未初始化');
        await this._waitWerewolfApiCooldown();
        const messages = await this._buildWerewolfSpeechMessages(player);
        this._lastWerewolfApiRequestAt = Date.now();
        return apiManager.callAI(messages, {
            appId: 'games',
            temperature: 0.82,
            max_tokens: 520
        });
    }

    async _callWerewolfVoteAi(userVote = null) {
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager?.callAI) throw new Error('API Manager 未初始化');
        await this._waitWerewolfApiCooldown();
        const state = this.werewolfData.getState();
        const livePlayers = (state?.players || []).filter(player => !player.empty && player.alive !== false);
        const userSeat = Number(state?.players?.find?.(player => player.isUser)?.seat || 0);
        const aiVoters = livePlayers.filter(player => Number(player.seat) !== userSeat);
        const messages = [
            {
                role: 'system',
                name: 'SYSTEM (狼人杀投票裁判)',
                isPhoneMessage: true,
                content: [
                    '你是狼人杀投票裁判，负责根据公开发言和玩家公开人物信息模拟 AI 玩家投票。',
                    '用户已经先投票，你不能改写用户这一票，也不要为用户投票。',
                    '除已死亡玩家外，所有需要你模拟投票的存活 AI 玩家都必须逐个输出一票。',
                    '允许弃票，但弃票也必须写入票型，格式为“座位号->0”。',
                    '票型里不得遗漏任何“需要你模拟投票的玩家”。',
                    '只能使用公开信息，不要读取、推断或泄露任何真实身份。',
                    '必须返回标签格式，不要 Markdown，不要解释。'
                ].join('\n')
            },
            {
                role: 'system',
                name: 'SYSTEM (狼人杀当前场况)',
                isPhoneMessage: true,
                content: [
                    `当前第 ${state.day || 1} 天，进入投票。`,
                    userVote ? `用户已投票：${userVote.voterSeat}号 -> ${userVote.targetSeat ? `${userVote.targetSeat}号` : '弃票'}。` : '用户尚未投票，本次由系统模拟投票结算。',
                    `用户座位：${userSeat || '?'}号。`,
                    '存活玩家：',
                    livePlayers.map(player => `${player.seat}号 ${player.name}：${player.personality || '普通玩家'}，公开状态=${player.alive === false ? '死亡' : '存活'}`).join('\n') || '无'
                ].join('\n')
            },
            ...this._buildWerewolfPublicRecordMessages(state),
            {
                role: 'user',
                name: 'USER (投票模拟任务)',
                isPhoneMessage: true,
                content: [
                    '需要你模拟投票的玩家：',
                    aiVoters.map(player => `${player.seat}号 ${player.name}`).join('\n') || '无',
                    '请只模拟上面这些存活 AI 玩家投票，不要输出用户票；每个需要模拟的玩家必须写一票，可以投存活玩家，也可以弃票写 0。',
                    '回复格式：',
                    '<狼人杀投票>',
                    '票型：2->3，3->0，4->3',
                    '出局：0',
                    '理由：一句话；如果弃票较多或没有形成明确多数，可以无人出局',
                    '</狼人杀投票>'
                ].filter(Boolean).join('\n')
            }
        ];
        this._lastWerewolfApiRequestAt = Date.now();
        return apiManager.callAI(messages, { appId: 'games', temperature: 0.78, max_tokens: 520 });
    }

    async _callWerewolfLastWordsAi(player) {
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager?.callAI) throw new Error('API Manager 未初始化');
        await this._waitWerewolfApiCooldown();
        const state = this.werewolfData.getState();
        const publicLog = this._formatWerewolfPublicChatLog(state);
        const voteHistory = this._formatWerewolfVoteHistory(state);
        const isOpenReveal = String(state?.roleRevealMode || 'open') !== 'hidden';
        const isEliminatedWolf = String(player?.role || '').trim() === '狼人';
        const lastWordsRoleRule = isEliminatedWolf && isOpenReveal
            ? '当前为明牌局，你作为被放逐狼人时身份已经公开，不需要继续装好人；可以坦然以狼人视角发表遗言、带节奏、卖队友、干扰好人判断或留下误导。'
            : '狼人可以继续伪装、带节奏、卖队友或混淆视听；好人应尽量交代视角和怀疑对象。';
        const messages = [
            {
                role: 'system',
                name: 'SYSTEM (狼人杀遗言)',
                isPhoneMessage: true,
                content: [
                    '你正在扮演被白天投票放逐的狼人杀玩家发表遗言。',
                    '你知道自己的真实身份，但不能知道其他非同阵营玩家的真实身份。',
                    lastWordsRoleRule,
                    '遗言必须是公开发言，40-140字。',
                    '必须只返回 <狼人杀遗言> 标签包裹内容。'
                ].join('\n')
            },
            {
                role: 'user',
                isPhoneMessage: true,
                content: [
                    `当前第 ${state.day || 1} 天，${player.seat}号 ${player.name} 被投票放逐。`,
                    `当前局型：${isOpenReveal ? '明牌局' : '暗牌局'}。`,
                    `你的真实身份：${player.role || '村民'}。`,
                    player.role === '狼人'
                        ? `存活狼人同伴：${(state.players || []).filter(item => item.role === '狼人' && item.alive !== false).map(item => `${item.seat}号 ${item.name}`).join('、')}`
                        : '',
                    '公开记录：',
                    publicLog.map(line => `- ${line}`).join('\n') || '- 暂无',
                    '历史投票结果：',
                    voteHistory.map(line => `- ${line}`).join('\n') || '- 暂无',
                    '<狼人杀遗言>',
                    '遗言内容',
                    '</狼人杀遗言>'
                ].filter(Boolean).join('\n')
            }
        ];
        this._lastWerewolfApiRequestAt = Date.now();
        return this._withWerewolfTimeout(
            apiManager.callAI(messages, { appId: 'games', temperature: 0.86, max_tokens: 420 }),
            WEREWOLF_LAST_WORDS_TIMEOUT_MS,
            '狼人杀遗言请求超时，请点击续接遗言重试'
        );
    }

    _withWerewolfTimeout(promise, timeoutMs, message) {
        let timer = null;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(message || '狼人杀请求超时，请重试')), timeoutMs);
        });
        return Promise.race([promise, timeout]).finally(() => {
            if (timer) clearTimeout(timer);
        });
    }

    _parseWerewolfVoteDecision(text = '') {
        const source = String(text || '').trim();
        const block = source.match(/<狼人杀投票>([\s\S]*?)<\/狼人杀投票>/)?.[1] || source;
        const voteText = this._extractWerewolfNightField(block, '票型');
        const targetText = this._extractWerewolfNightField(block, '出局');
        const reason = this._extractWerewolfNightField(block, '理由');
        const votes = [];
        String(voteText || '').replace(/[，,；;]/g, ' ').split(/\s+/).forEach(part => {
            const match = part.match(/(\d+)\s*(?:->|→|投|票)\s*(\d+|弃票)/);
            if (match) votes.push({ voterSeat: Number(match[1]), targetSeat: /弃票/.test(match[2]) ? 0 : Number(match[2]) });
        });
        return { targetSeat: this._extractFirstNumber(targetText), votes, reason };
    }

    _normalizeWerewolfVoteDecision(decision = {}, userVote = null) {
        const state = this.werewolfData.getState();
        const liveSeats = new Set((state?.players || []).filter(player => !player.empty && player.alive !== false).map(player => Number(player.seat)));
        const liveSeatList = [...liveSeats].sort((a, b) => a - b);
        const userSeat = Number(userVote?.voterSeat || 0);
        const votes = (Array.isArray(decision.votes) ? decision.votes : [])
            .filter(vote => liveSeats.has(Number(vote.voterSeat)) && (Number(vote.targetSeat) === 0 || liveSeats.has(Number(vote.targetSeat))))
            .filter(vote => !userSeat || Number(vote.voterSeat) !== userSeat)
            .map(vote => ({ voterSeat: Number(vote.voterSeat), targetSeat: Number(vote.targetSeat) }));
        if (userVote && liveSeats.has(Number(userVote.voterSeat)) && (Number(userVote.targetSeat) === 0 || liveSeats.has(Number(userVote.targetSeat)))) {
            votes.unshift({ voterSeat: Number(userVote.voterSeat), targetSeat: Number(userVote.targetSeat) });
        }
        const votedSeats = new Set(votes.map(vote => Number(vote.voterSeat)));
        liveSeatList.forEach(seat => {
            if (votedSeats.has(seat)) return;
            votes.push({ voterSeat: seat, targetSeat: 0 });
        });
        votes.sort((a, b) => Number(a.voterSeat) - Number(b.voterSeat));
        const targetSeat = this._resolveWerewolfVoteTarget(votes);
        return {
            targetSeat,
            votes,
            reason: String(decision.reason || '').trim()
        };
    }

    _resolveWerewolfVoteTarget(votes = []) {
        const counts = new Map();
        votes.forEach(vote => {
            const targetSeat = Number(vote.targetSeat || 0);
            if (!targetSeat) return;
            counts.set(targetSeat, (counts.get(targetSeat) || 0) + 1);
        });
        if (!counts.size) return 0;
        const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
        const topCount = Number(sorted[0]?.[1] || 0);
        const tied = sorted.filter(item => Number(item[1]) === topCount);
        return tied.length === 1 ? Number(sorted[0]?.[0] || 0) : 0;
    }

    _formatWerewolfPublicChatLog(state = null) {
        const safeState = state || this.werewolfData?.getState?.() || {};
        const players = Array.isArray(safeState.players) ? safeState.players : [];
        return (Array.isArray(safeState.chat) ? safeState.chat : []).map(item => {
            const day = Number(item?.day || 0) ? `第${Number(item.day)}天 ` : '';
            if (Number(item?.seat || 0) === 0) return `${day}系统：${item?.text || ''}`;
            const player = players.find(playerItem => Number(playerItem.seat) === Number(item.seat));
            return `${day}${item.seat}号${player?.name ? ` ${player.name}` : ''}：${item?.text || ''}`;
        });
    }

    _buildWerewolfPublicRecordMessages(state = null) {
        const safeState = state || this.werewolfData?.getState?.() || {};
        const players = Array.isArray(safeState.players) ? safeState.players : [];
        const recordsByDay = new Map();
        const ensureDay = (day) => {
            const safeDay = Number(day || 0) || 1;
            if (!recordsByDay.has(safeDay)) recordsByDay.set(safeDay, { speeches: [], votes: [] });
            return recordsByDay.get(safeDay);
        };

        (Array.isArray(safeState.chat) ? safeState.chat : []).forEach(item => {
            const day = Number(item?.day || 0) || 1;
            const target = ensureDay(day);
            if (Number(item?.seat || 0) === 0) {
                target.speeches.push(`系统：${item?.text || ''}`);
                return;
            }
            const player = players.find(playerItem => Number(playerItem.seat) === Number(item.seat));
            target.speeches.push(`${item.seat}号${player?.name ? ` ${player.name}` : ''}：${item?.text || ''}`);
        });

        const voteItems = Array.isArray(safeState.voteHistory)
            ? safeState.voteHistory
            : (Array.isArray(safeState.replayLog)
                ? safeState.replayLog.filter(item => String(item?.type || '') === 'vote' && String(item?.visibility || 'public') === 'public')
                : []);
        voteItems.forEach(item => {
            const day = Number(item?.day || 0) || 1;
            const text = String(item?.text || '').trim();
            if (text) ensureDay(day).votes.push(text);
        });

        const currentDay = Number(safeState.day || 1) || 1;
        for (let day = 1; day <= currentDay; day += 1) ensureDay(day);

        return [...recordsByDay.entries()]
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([day, record]) => ({
                role: 'system',
                name: `SYSTEM (狼人杀第${day}天公开记录)`,
                isPhoneMessage: true,
                content: [
                    `【第 ${day} 天公开记录】`,
                    '公开发言与系统公告：',
                    record.speeches.length ? record.speeches.map(line => `- ${line}`).join('\n') : '- 暂无',
                    '当天投票结果：',
                    record.votes.length ? record.votes.map(line => `- ${line}`).join('\n') : '- 暂无'
                ].join('\n')
            }));
    }

    _formatWerewolfVoteHistory(stateOrContext = null) {
        const source = stateOrContext || this.werewolfData?.getState?.() || {};
        const rawList = Array.isArray(source.voteHistory)
            ? source.voteHistory
            : (Array.isArray(source.replayLog)
                ? source.replayLog.filter(item => String(item?.type || '') === 'vote' && String(item?.visibility || 'public') === 'public')
                : []);
        return rawList
            .map(item => {
                const day = Number(item?.day || 0) || 1;
                const text = String(item?.text || '').trim();
                return text ? `第${day}天 ${text}` : '';
            })
            .filter(Boolean);
    }

    _fallbackWerewolfVoteTarget(userVote = null) {
        const state = this.werewolfData.getState();
        const live = (state?.players || []).filter(player => !player.empty && player.alive !== false);
        if (!live.length) return 0;
        if (userVote && live.some(player => Number(player.seat) === Number(userVote.targetSeat))) {
            return Number(userVote.targetSeat);
        }
        const sorted = [...live].sort((a, b) => Number(b.seat) - Number(a.seat));
        return Number(sorted[0]?.seat || live[0].seat || 0);
    }

    _parseWerewolfLastWords(text = '') {
        const source = String(text || '').trim();
        return String(source.match(/<狼人杀遗言>([\s\S]*?)<\/狼人杀遗言>/)?.[1] || source).trim();
    }

    async _buildWerewolfSpeechMessages(player) {
        const context = this.werewolfData.buildSpeechContext(player);
        if (!context) throw new Error('狼人杀上下文为空');
        const messages = [
            {
                role: 'system',
                name: 'SYSTEM (狼人杀规则)',
                isPhoneMessage: true,
                content: this._formatWerewolfRulesMessage()
            },
            ...await this._buildWerewolfWorldbookMessages(),
            {
                role: 'system',
                name: 'SYSTEM (发言简报与系统公告)',
                isPhoneMessage: true,
                content: this._formatWerewolfPublicLogMessage(context)
            },
            {
                role: 'system',
                name: 'SYSTEM (场上公开状态)',
                isPhoneMessage: true,
                content: this._formatWerewolfPublicStateMessage(context)
            },
            {
                role: 'user',
                name: 'USER (当前发言任务)',
                isPhoneMessage: true,
                content: this._formatWerewolfSpeechTaskMessage(context)
            }
        ];
        return messages;
    }

    async _buildWerewolfWorldbookMessages() {
        return this.buildGamesAiContextMessages({
            includeRecentChat: false
        });
    }

    _formatWerewolfRulesMessage() {
        return this.getWerewolfPrompt();
    }

    _formatWerewolfPublicStateMessage(context = {}) {
        const playerLines = (context.players || [])
            .map(player => `${player.seat}号 ${player.name}：${player.status}${player.isUser ? '，用户本人' : ''}`)
            .join('\n');
        const isOpenReveal = String(context.roleRevealMode || 'open') !== 'hidden';
        return [
            '【场上公开玩家状态】',
            `当前：第 ${context.day || 1} 天白天。`,
            `用户座位：${context.userSeat || '?'}号。`,
            isOpenReveal
                ? '本局为明牌模式：死亡或被投票放逐的玩家会公开真实身份；场上状态中写明的公开身份就是已公开事实，可以直接作为发言依据。'
                : '本局为暗牌模式：死亡或被投票放逐的玩家不会公开真实身份；除公开发言和系统公告外，不得断言其真实身份。',
            playerLines || '暂无'
        ].join('\n');
    }

    _formatWerewolfPublicLogMessage(context = {}) {
        const logLines = (context.publicLog || []).length
            ? context.publicLog.map(line => `- ${line}`).join('\n')
            : '- 暂无';
        const voteLines = this._formatWerewolfVoteHistory(context);
        return [
            '【发言简报与系统公告】',
            Number(context.day || 1) === 1 ? '当前是首日白天，系统尚未公布任何夜晚技能结果；禁止凭空声称查杀、金水、银水、刀口或验人结果。' : '',
            '系统公告与已公开发言记录：',
            logLines,
            '已公开投票结果：',
            voteLines.length ? voteLines.map(line => `- ${line}`).join('\n') : '- 暂无'
        ].filter(Boolean).join('\n');
    }

    _formatWerewolfSpeechTaskMessage(context = {}) {
        const state = this.werewolfData.getState();
        const speakerSeat = Number(context.speaker?.seat || 0);
        const wolfMates = context.speakerPrivateRole === '狼人'
            ? (state?.players || [])
                .filter(player => player.role === '狼人' && player.alive !== false)
                .map(player => `${player.seat}号 ${player.name}`)
                .join('、')
            : '';
        const seerChecks = context.speakerPrivateRole === '预言家' && Array.isArray(context.seerChecks)
            ? context.seerChecks
                .map(item => `第 ${Number(item.day || 1)} 夜查验 ${Number(item.targetSeat || 0)}号：${item.resultRole === '狼人' ? '狼人' : '好人'}`)
                .filter(Boolean)
            : [];
        return [
            '【当前发言任务】',
            '以下身份信息只给当前发言玩家用于策略判断。',
            `当前该 ${speakerSeat || '?'}号 ${context.speaker?.name || '玩家'} 发言。`,
            `当前发言玩家性格及语言风格：${context.speaker?.personality || '普通玩家，自然发言'}。`,
            `当前发言玩家真实身份：${context.speakerPrivateRole || '村民'}。`,
            wolfMates ? `狼人同伴：${wolfMates}。` : '',
            seerChecks.length ? `你的预言家查验结果：${seerChecks.join('；')}。` : '',
            '其他玩家真实身份不得在发言中泄露；除非场上公开信息已经说明，否则不要假装知道。',
            '可以基于已公开投票结果分析“谁投了谁、谁跟票、谁弃票、谁票型异常”，并据此提出怀疑或辩解。',
            '禁止描写心理活动、动作、表情或旁白，不要使用括号补充任何非发言内容。',
            '请只输出当前玩家的公开发言。格式：',
            '<狼人杀发言>',
            '发言内容',
            '</狼人杀发言>'
        ].filter(Boolean).join('\n');
    }

    _parseWerewolfSpeech(text = '') {
        const source = String(text || '').trim();
        const tagged = source.match(/<狼人杀发言>([\s\S]*?)<\/狼人杀发言>/)?.[1];
        return String(tagged || source)
            .replace(/^发言\s*[:：]/, '')
            .trim();
    }

    _buildWerewolfInvitedPlayers(contacts = [], emptySeats = []) {
        const seats = emptySeats.slice();
        for (let index = seats.length - 1; index > 0; index -= 1) {
            const swap = Math.floor(Math.random() * (index + 1));
            [seats[index], seats[swap]] = [seats[swap], seats[index]];
        }
        const seen = new Set();
        return (Array.isArray(contacts) ? contacts : [])
            .map(contact => {
                const id = String(contact?.id || contact?.contactId || contact?.name || '').trim();
                const name = String(contact?.name || contact?.remark || '').trim();
                if (!id || !name || seen.has(id) || !seats.length) return null;
                seen.add(id);
                const seat = seats.shift();
                return {
                    seat,
                    id: `wechat_${id}`,
                    contactId: id,
                    name,
                    avatar: String(contact?.avatar || '').trim(),
                    personality: String(contact?.personality || contact?.pokerStyle || '微信好友，按角色性格自然发言').trim(),
                    source: 'wechat'
                };
            })
            .filter(Boolean);
    }

    _buildWerewolfFallbackPlayers(emptySeats = [], generated = []) {
        const bySeat = new Map(generated.map(player => [Number(player.seat), player]));
        const names = ['青岚', '夜航', '阿澈', '小满', '林鹿', '北辰', '梨白'];
        return emptySeats.map((seat, index) => {
            const item = bySeat.get(Number(seat));
            if (item?.name) return item;
            return {
                seat,
                id: `ai_${seat}`,
                name: names[index % names.length],
                gender: '',
                personality: '谨慎观察，发言简短但会抓矛盾',
                source: 'ai'
            };
        });
    }

    _getWerewolfUserInfo() {
        const wechatData = this.getWechatData?.();
        const userInfo = wechatData?.getUserInfo?.() || {};
        return {
            name: String(userInfo.name || '你').trim(),
            avatar: String(userInfo.avatar || '').trim(),
            personality: String(userInfo.signature || '').trim()
        };
    }

    _parseWerewolfMatch(text = '') {
        const source = String(text || '').trim();
        const block = source.match(/<狼人杀匹配环节>([\s\S]*?)<\/狼人杀匹配环节>/)?.[1] || source;
        const sections = [];
        const pattern = /【\s*(\d+)\s*号\s*】([\s\S]*?)(?=---\s*【\s*\d+\s*号\s*】|【\s*\d+\s*号\s*】|$)/g;
        let match = null;
        while ((match = pattern.exec(block))) {
            const seat = Number(match[1]);
            const body = String(match[2] || '');
            sections.push({
                seat,
                name: this._extractWerewolfField(body, '姓名'),
                gender: this._extractWerewolfField(body, '性别'),
                personality: this._extractWerewolfField(body, '性格及语言风格')
            });
        }
        return sections.filter(item => item.seat >= 1 && item.seat <= 8 && item.name && item.personality);
    }

    _extractWerewolfField(body, label) {
        const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = String(body || '').match(new RegExp(`${escaped}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:姓名|性别|性格及语言风格)\\s*[:：]|$)`));
        return String(match?.[1] || '').trim();
    }

    _preloadCatboxAssets() {
        if (document.getElementById('games-catbox-css')) return;
        const stylesheet = document.createElement('link');
        stylesheet.id = 'games-catbox-css';
        stylesheet.rel = 'stylesheet';
        stylesheet.href = CATBOX_CSS_URL;
        document.head.appendChild(stylesheet);

        CATBOX_PRELOAD_ASSETS.forEach((href, index) => {
            const link = document.createElement('link');
            link.rel = 'preload';
            link.href = href;
            link.as = 'image';
            link.dataset.catboxPreload = String(index + 1);
            document.head.appendChild(link);
        });
    }

    _preloadWerewolfAssets() {
        const existingCss = document.getElementById('games-werewolf-css');
        if (existingCss) {
            if (existingCss.href !== WEREWOLF_CSS_URL) existingCss.href = WEREWOLF_CSS_URL;
        } else {
            const stylesheet = document.createElement('link');
            stylesheet.id = 'games-werewolf-css';
            stylesheet.rel = 'stylesheet';
            stylesheet.href = WEREWOLF_CSS_URL;
            document.head.appendChild(stylesheet);
        }

        if (!document.getElementById('games-werewolf-bg-preload')) {
            const link = document.createElement('link');
            link.id = 'games-werewolf-bg-preload';
            link.rel = 'preload';
            link.href = new URL('./werewolf/assets/werewolf-background.png', import.meta.url).href;
            link.as = 'image';
            document.head.appendChild(link);
        }

        if (!document.getElementById('games-werewolf-day-bg-preload')) {
            const link = document.createElement('link');
            link.id = 'games-werewolf-day-bg-preload';
            link.rel = 'preload';
            link.href = new URL('./werewolf/assets/day.png', import.meta.url).href;
            link.as = 'image';
            document.head.appendChild(link);
        }

        ['Guard.png', 'Witch.png', 'Werewolf.png', 'Villager.png'].forEach(file => {
            const id = `games-werewolf-role-${file.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
            if (document.getElementById(id)) return;
            const link = document.createElement('link');
            link.id = id;
            link.rel = 'preload';
            link.href = new URL(`./werewolf/assets/${file}`, import.meta.url).href;
            link.as = 'image';
            document.head.appendChild(link);
        });
    }

    randomCatboxCat() {
        this.catboxData.randomCat();
        this.catboxView.render();
    }

    adoptCatboxCat(name, gender) {
        if (!this.catboxData.getState().draftCatId) {
            this.phoneShell?.showNotification?.('猫盒', '请先随机一只小猫', '🐾');
            return;
        }
        this.catboxData.adoptCat(name, gender);
        this.catboxView.render();
    }

    performCatboxAction(action) {
        this.catboxData.performCare(action);
        this.catboxView.render();
    }

    useCatboxItem(itemId) {
        this.catboxData.useItem(itemId);
        this.catboxView.render();
    }

    buyCatboxItem(itemId) {
        this.catboxData.buyItem(itemId);
        this.catboxView.render();
    }

    getCatboxCoAdoptTargets() {
        const wechatData = this.getWechatData?.();
        const chats = wechatData?.getChatList?.() || [];
        const contacts = wechatData?.getContacts?.() || [];
        const byName = new Map();
        chats
            .filter(chat => chat && chat.type !== 'group' && String(chat.name || '').trim())
            .forEach(chat => {
                byName.set(String(chat.name || '').trim(), {
                    chatId: String(chat.id || '').trim(),
                    name: String(chat.name || '').trim(),
                    avatar: chat.avatar || ''
                });
            });
        contacts
            .filter(contact => contact && String(contact.name || '').trim())
            .forEach(contact => {
                const name = String(contact.name || '').trim();
                if (byName.has(name)) return;
                const chat = wechatData.getChatByContactId?.(contact.id)
                    || chats.find(item => item?.type !== 'group' && String(item.name || '').trim() === name);
                byName.set(name, {
                    chatId: String(chat?.id || `contact:${contact.id || name}`).trim(),
                    contactId: contact.id || '',
                    name,
                    avatar: this.resolveContactAvatar?.(contact, wechatData) || contact.avatar || ''
                });
            });
        return Array.from(byName.values()).filter(item => item.chatId && item.name);
    }

    inviteCatboxCoAdopt(chatId) {
        const wechatData = this.getWechatData?.();
        if (!wechatData) return;
        const rawId = String(chatId || '').trim();
        let chat = wechatData.getChat?.(rawId);
        if (!chat && rawId.startsWith('contact:')) {
            const contactId = rawId.slice('contact:'.length);
            const contact = wechatData.getContact?.(contactId);
            if (contact) {
                chat = wechatData.createChat?.({
                    id: `chat_${contact.id || Date.now()}`,
                    contactId: contact.id,
                    name: contact.name,
                    type: 'single',
                    avatar: contact.avatar || ''
                });
            }
        }
        if (!chat || chat.type === 'group') return;
        const invite = this.catboxData.createCoAdoptInvite({
            chatId: chat.id,
            name: chat.name
        });
        if (!invite) return;
        const userInfo = wechatData.getUserInfo?.() || {};
        const state = this.catboxData.getState();
        const messageId = `catbox_invite_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        this.catboxData.updateCoAdoptInviteMessage?.(chat.id, messageId);
        const inviteTime = this._getWechatShareTimeFields();
        wechatData.addMessage(chat.id, {
            id: messageId,
            from: 'me',
            type: 'catbox_coadopt_invite',
            content: '[猫盒共养邀请]',
            catboxPetName: state.catName,
            catboxInviteStatus: 'pending',
            catboxInviteChatId: chat.id,
            avatar: userInfo.avatar || '',
            ...inviteTime
        });
        chat.lastMessage = '[猫盒共养邀请]';
        chat.time = inviteTime.time || chat.time || '';
        chat.timestamp = inviteTime.timestamp || Date.now();
        wechatData.saveData?.();
        this._syncWechatHomeBadge?.(wechatData);
        this.phoneShell?.showNotification?.('猫盒', `已邀请${chat.name}共同收养`, '🐱');
        this.catboxView.render();
    }

    releaseCatboxCoAdopt() {
        const state = this.catboxData.releaseCoAdopt?.();
        if (!state) return;
        this.phoneShell?.showNotification?.('猫盒', '已解除共同收养', '💔');
        this.catboxView.render();
    }

    nextCatboxBackground() {
        this.catboxData.nextBackground();
        this.catboxView.render();
    }

    resetCatbox() {
        this.catboxData.resetAdoption();
        this.catboxView.render();
    }

    backToLobby() {
        this.stopUndercoverFlow?.();
        this.game2048View?.destroy?.();
        this.sudokuView?.destroy?.();
        this.catboxView?.destroy?.();
        this.werewolfView?.destroy?.();
        this.undercoverView?.destroy?.();
        super.backToLobby();
    }

    deactivate() {
        this.stopUndercoverFlow?.();
        this.clearPokerSession?.();
        this.removePhoneChromeTheme?.();
        this.game2048View?.destroy?.();
        this.sudokuView?.destroy?.();
        this.catboxView?.destroy?.();
        this.werewolfView?.destroy?.();
        this.undercoverView?.destroy?.();
    }

    handleSwipeBack() {
        if (this.currentView === 'undercover' && this.undercoverView?.handleBack?.()) {
            return;
        }
        if (this.currentView === 'game2048' || this.currentView === 'sudoku' || this.currentView === 'catbox' || this.currentView === 'werewolf' || this.currentView === 'undercover') {
            this.backToLobby();
            return;
        }
        super.handleSwipeBack();
    }
}
