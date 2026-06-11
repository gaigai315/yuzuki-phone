/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  狼人杀数据
 * ======================================================== */

const LEGACY_STORAGE_KEY = 'games_werewolf_state';
const STORAGE_KEY = 'chat_games_werewolf_state';

const ROLE_POOL = ['狼人', '狼人', '预言家', '女巫', '守卫', '村民', '村民', '村民'];
const NIGHT_STEPS = ['guard', 'werewolf', 'seer', 'witch'];
const NIGHT_STEP_LABELS = {
    guard: '守卫行动',
    werewolf: '狼人行动',
    seer: '预言家行动',
    witch: '女巫行动'
};
const NIGHT_STEP_ROLES = {
    guard: '守卫',
    werewolf: '狼人',
    seer: '预言家',
    witch: '女巫'
};

export class WerewolfData {
    constructor(storage) {
        this.storage = storage;
        this.state = this._loadState();
    }

    getState() {
        return this.state;
    }

    reset(userInfo = {}, options = {}) {
        this.state = this._createInitialState(userInfo);
        this.state.roleRevealMode = this._normalizeRoleRevealMode(options.roleRevealMode || this.state.roleRevealMode);
        this._persist();
        return this.state;
    }

    updateUserInfo(userInfo = {}) {
        this._sanitizeSetupSeats();
        const user = this.state.players?.find(player => player.isUser);
        if (!user) return this.state;
        const name = String(userInfo.name || user.name || '你').trim();
        user.id = 'user';
        user.name = name || '你';
        user.avatar = String(userInfo.avatar || user.avatar || '').trim();
        user.personality = String(userInfo.personality || user.personality || '用户本人，按用户输入发言').trim();
        user.tone = 'user';
        user.source = 'user';
        user.empty = false;
        user.alive = user.alive !== false;
        this._persist();
        return this.state;
    }

    setMatching(isMatching) {
        this.state.matching = !!isMatching;
        if (isMatching) this.state.notice = '正在准备玩家席位...';
        this._persist();
        return this.state;
    }

    applyMatchedPlayers(players = []) {
        const bySeat = new Map(
            players
                .filter(player => Number.isInteger(Number(player.seat)))
                .map(player => [Number(player.seat), player])
        );
        this.state.players = this.state.players.map(player => {
            if (player.isUser || !bySeat.has(player.seat)) return player;
            const matched = bySeat.get(player.seat);
            const source = String(matched.source || 'ai').trim();
            return {
                ...player,
                id: String(matched.id || `${source}_${player.seat}`).trim(),
                contactId: String(matched.contactId || '').trim(),
                name: String(matched.name || `玩家${player.seat}`).trim(),
                avatar: String(matched.avatar || '').trim(),
                gender: String(matched.gender || '').trim(),
                personality: String(matched.personality || matched.style || '').trim(),
                tone: this._toneForSeat(player.seat),
                source,
                empty: false,
                alive: true,
                active: false
            };
        });
        this.state.matching = false;
        this.state.phase = 'night';
        this.state.day = 1;
        this.state.dayStarted = false;
        this.state.round = 1;
        this.state.speaking = false;
        this.state.currentSpeaker = 0;
        this.state.nightStep = 'guard';
        this.state.nightActions = this._createNightActions();
        this.state.wolfChat = [];
        this.state.wolfChatLoading = false;
        this.state.lastGuardSeat = 0;
        this.state.lastKilledSeat = 0;
        this.state.eliminatedSeat = 0;
        this.state.lastWordsDone = false;
        this.state.voteResult = null;
        this.state.voting = false;
        this.state.gameOver = false;
        this.state.winner = '';
        this.state.roleRevealMode = this._normalizeRoleRevealMode(this.state.roleRevealMode);
        this.state.notice = '第 1 夜开始，天黑请闭眼。';
        this.state.chat = [
            {
                seat: 0,
                text: '8人局已开始，第 1 夜开始。'
            }
        ];
        this.state.privateLog = [];
        this.state.replayLog = [];
        this.state.seerChecks = [];
        this._assignRoles();
        this._updateUserRoleHint();
        this.recordReplay('system', '8人局已开始，身份已分配。', { visibility: 'private' });
        this.recordReplay('system', `用户座位 ${this.state.players.find(player => player.isUser)?.seat || '?'}号，身份：${this.state.userRole || '未知'}。`, { visibility: 'private' });
        this.recordReplay('system', '第 1 夜开始。', { visibility: 'public', phase: 'night' });
        this._persist();
        return this.state;
    }

    applyMatchError(message = '匹配失败，请稍后重试。') {
        this.state.matching = false;
        this.state.notice = message;
        this._persist();
        return this.state;
    }

    applySpeechError(message = '发言中断，请稍后重试。') {
        this.state.speaking = false;
        this.state.players = this.state.players.map(player => ({ ...player, active: false }));
        this.state.notice = message;
        this._persist();
        return this.state;
    }

    getEliminatedPlayer() {
        const seat = Number(this.state.eliminatedSeat || 0);
        return this.state.players.find(player => Number(player.seat) === seat) || null;
    }

    canUserLastWords() {
        const player = this.getEliminatedPlayer();
        return this.state.phase === 'last_words' && !!player?.isUser && !this.state.lastWordsDone;
    }

    getEmptySeats() {
        this._sanitizeSetupSeats();
        return this.state.players
            .filter(player => !player.isUser && player.empty)
            .map(player => player.seat);
    }

    getCurrentSpeaker() {
        const seat = Number(this.state.currentSpeaker || 0);
        return this.state.players.find(player => Number(player.seat) === seat) || null;
    }

    canUserSpeak() {
        const speaker = this.getCurrentSpeaker();
        return !!speaker && speaker.isUser && speaker.alive !== false && this.state.phase === 'day' && !this.state.speaking;
    }

    getNightStepInfo() {
        const step = String(this.state.nightStep || NIGHT_STEPS[0]);
        return {
            step,
            label: NIGHT_STEP_LABELS[step] || '夜晚行动',
            role: NIGHT_STEP_ROLES[step] || '',
            isUserTurn: this.isUserNightTurn(),
            witchPotions: this.getWitchPotions(),
            lastGuardSeat: Number(this.state.lastGuardSeat || 0)
        };
    }

    getWitchPotions() {
        const potions = this.state.witchPotions && typeof this.state.witchPotions === 'object'
            ? this.state.witchPotions
            : { antidote: true, poison: true };
        return {
            antidote: potions.antidote !== false,
            poison: potions.poison !== false
        };
    }

    isUserNightTurn() {
        if (this.state.phase !== 'night') return false;
        const user = this.state.players.find(player => player.isUser);
        const role = NIGHT_STEP_ROLES[String(this.state.nightStep || '')];
        return !!user && !!role && user.role === role && user.alive !== false;
    }

    getNightTargets(options = {}) {
        const includeSelf = !!options.includeSelf;
        const user = this.state.players.find(player => player.isUser);
        const excludeSeat = Number(options.excludeSeat || 0);
        const excludeSeats = Array.isArray(options.excludeSeats)
            ? options.excludeSeats.map(seat => Number(seat || 0)).filter(Boolean)
            : [];
        const excludeRoles = Array.isArray(options.excludeRoles)
            ? options.excludeRoles.map(role => String(role || '').trim()).filter(Boolean)
            : [];
        return this.state.players
            .filter(player => !player.empty && player.alive !== false)
            .filter(player => !excludeSeat || Number(player.seat) !== excludeSeat)
            .filter(player => !excludeSeats.includes(Number(player.seat)))
            .filter(player => !excludeRoles.includes(String(player.role || '').trim()))
            .filter(player => includeSelf || !user || Number(player.seat) !== Number(user.seat))
            .map(player => this._publicPlayer(player));
    }

    getWerewolfMates() {
        const user = this.state.players.find(player => player.isUser);
        if (!user || user.role !== '狼人') return [];
        return this.state.players
            .filter(player => !player.empty && player.role === '狼人' && player.alive !== false)
            .map(player => this._publicPlayer(player));
    }

    addWolfChatMessage(seat, text) {
        const content = String(text || '').trim();
        if (!content) return this.state;
        if (!Array.isArray(this.state.wolfChat)) this.state.wolfChat = [];
        this.state.wolfChat.push({
            seat: Number(seat || 0),
            text: content,
            at: Date.now()
        });
        if (this.state.wolfChat.length > 80) this.state.wolfChat = this.state.wolfChat.slice(-80);
        this.recordReplay('wolf_discussion', `狼人夜谈：${seat ? `${seat}号：` : ''}${content}`, {
            visibility: 'private',
            phase: 'night',
            redactedText: `第 ${this.state.day || 1} 夜 狼人已完成夜谈。`
        });
        this._persist();
        return this.state;
    }

    setWolfChatLoading(isLoading) {
        this.state.wolfChatLoading = !!isLoading;
        this._persist();
        return this.state;
    }

    applyUserNightAction(payload = {}) {
        if (!this.isUserNightTurn()) return this.state;
        return this.applyNightAction(this.state.nightStep, payload, { actorSeat: this.state.players.find(player => player.isUser)?.seat || 0 });
    }

    canUserVote() {
        const user = this.state.players.find(player => player.isUser);
        return this.state.phase === 'vote' && !this.state.gameOver && !this.state.voting && !!user && user.alive !== false;
    }

    setVoting(isVoting) {
        if (this.state.phase !== 'vote') return this.state;
        this.state.voting = !!isVoting;
        if (isVoting) this.state.notice = '投票结算中，等待其他玩家投票。';
        this._persist();
        return this.state;
    }

    getVoteTargets() {
        const user = this.state.players.find(player => player.isUser);
        const userSeat = Number(user?.seat || 0);
        return this.state.players
            .filter(player => !player.empty && player.alive !== false)
            .filter(player => Number(player.seat) !== userSeat)
            .map(player => this._publicPlayer(player));
    }

    applyVoteResult(targetSeat, votes = [], options = {}) {
        if (this.state.phase !== 'vote') return this.state;
        const seat = Number(targetSeat || 0);
        const target = this.state.players.find(player => Number(player.seat) === seat && player.alive !== false);
        if (!target) {
            this.state.voteResult = {
                targetSeat: 0,
                votes: Array.isArray(votes) ? votes : [],
                reason: String(options.reason || '').trim(),
                at: Date.now()
            };
            this.state.eliminatedSeat = 0;
            this.state.voting = false;
            this.state.notice = '本轮投票无人出局，进入夜晚。';
        this.addSpeech(0, '本轮投票无人出局。', { system: true, keepNotice: true, skipReplay: true });
            this.recordReplay('vote', this._formatVoteReplay(null, this.state.voteResult), { visibility: 'public', phase: 'vote' });
            this.startNextNight();
            return this.state;
        }
        this.state.players = this.state.players.map(player => Number(player.seat) === seat ? { ...player, alive: false, active: false } : { ...player, active: false });
        this.state.voteResult = {
            targetSeat: seat,
            votes: Array.isArray(votes) ? votes : [],
            reason: String(options.reason || '').trim(),
            at: Date.now()
        };
        this.state.eliminatedSeat = seat;
        this.state.voting = false;
        this.state.phase = 'last_words';
        this.state.lastWordsDone = false;
        this.state.notice = `${seat}号 ${target.name || '玩家'} 被放逐，请发表遗言。`;
        this.addSpeech(0, `${seat}号 ${target.name || '玩家'} 被投票放逐。`, { system: true, keepNotice: true, skipReplay: true });
        this.recordReplay('vote', this._formatVoteReplay(target, this.state.voteResult), { visibility: 'public', phase: 'vote' });
        this._checkWinCondition();
        this._persist();
        return this.state;
    }

    addLastWords(seat, text) {
        const speakerSeat = Number(seat || this.state.eliminatedSeat || 0);
        const speech = String(text || '').trim();
        if (!speakerSeat || !speech || this.state.phase !== 'last_words') return this.state;
        this.addSpeech(speakerSeat, `遗言：${speech}`, { skipReplay: true });
        this.recordReplay('last_words', `${speakerSeat}号遗言：${speech}`, { visibility: 'public', phase: 'last_words' });
        this.state.lastWordsDone = true;
        this.state.notice = `${speakerSeat}号遗言结束。`;
        this._persist();
        return this.state;
    }

    startNextNight() {
        if (this.state.gameOver) return this.state;
        this.state.phase = 'night';
        this.state.nightStep = 'guard';
        this.state.nightActions = this._createNightActions();
        this.state.wolfChat = [];
        this.state.wolfChatLoading = false;
        this.state.currentSpeaker = 0;
        this.state.speaking = false;
        this.state.eliminatedSeat = 0;
        this.state.lastWordsDone = false;
        this.state.lastKilledSeat = 0;
        this.state.notice = `第 ${this.state.day} 夜开始，天黑请闭眼。`;
        this.addSpeech(0, `第 ${this.state.day} 夜开始。`, { system: true, keepNotice: true, skipReplay: true });
        this.recordReplay('system', `第 ${this.state.day} 夜开始。`, { visibility: 'public', phase: 'night' });
        this._persist();
        return this.state;
    }

    applyNightAction(step, payload = {}, options = {}) {
        const safeStep = String(step || this.state.nightStep || '').trim();
        if (!safeStep || this.state.phase !== 'night') return this.state;
        if (!this.state.nightActions || typeof this.state.nightActions !== 'object') {
            this.state.nightActions = this._createNightActions();
        }
        const actorSeat = Number(options.actorSeat || payload.actorSeat || 0);
        const action = {
            step: safeStep,
            actorSeat,
            targetSeat: Number(payload.targetSeat || 0),
            extraSeat: Number(payload.extraSeat || 0),
            usePotion: this._normalizePotionForAction(safeStep, payload, { actorSeat }),
            result: payload.result || null,
            discussion: String(payload.discussion || '').trim(),
            reason: String(payload.reason || '').trim(),
            at: Date.now()
        };
        if (safeStep === 'guard' && Number(action.targetSeat) === Number(this.state.lastGuardSeat || 0)) {
            action.targetSeat = 0;
        }
        if (safeStep === 'werewolf') {
            const target = this.state.players.find(player => Number(player.seat) === Number(action.targetSeat));
            if (!target || target.role === '狼人') action.targetSeat = 0;
        }
        if (safeStep === 'seer' && action.targetSeat && !action.result?.role) {
            const target = this.state.players.find(player => Number(player.seat) === Number(action.targetSeat));
            action.result = target ? { seat: action.targetSeat, role: target.role === '狼人' ? '狼人' : '好人' } : null;
        }
        if (safeStep === 'witch' && !action.usePotion) action.targetSeat = 0;
        this.state.nightActions[safeStep] = action;
        if (safeStep === 'werewolf') this.state.lastKilledSeat = action.targetSeat || 0;
        if (safeStep === 'guard' && action.targetSeat) this.state.lastGuardSeat = action.targetSeat;
        if (safeStep === 'seer') this._recordSeerCheck(action);
        if (safeStep === 'witch') this._consumeWitchPotion(action.usePotion);
        this._recordNightAction(action);
        this._advanceNightStep();
        this._persist();
        return this.state;
    }

    startDayFromNight() {
        const result = this._resolveNightResult();
        if (this.state.dayStarted) {
            this.state.day = Number(this.state.day || 1) + 1;
        } else {
            this.state.day = Math.max(1, Number(this.state.day || 1));
            this.state.dayStarted = true;
        }
        this.state.phase = 'day';
        this.state.nightStep = '';
        this.state.speaking = false;
        this.state.currentSpeaker = this._firstAliveSeatFrom(1);
        this.state.notice = result.notice;
        this.state.players = this.state.players.map(player => ({ ...player, active: false }));
        this.addSpeech(0, result.notice, { system: true, keepNotice: true, skipReplay: true });
        this.recordReplay('system', result.notice, { visibility: 'public' });
        if (this.state.currentSpeaker) {
            this.state.notice = this._isUserSeat(this.state.currentSpeaker)
                ? `请 ${this.state.currentSpeaker} 号玩家发言。`
                : `等待 ${this.state.currentSpeaker} 号玩家发言。`;
        }
        this._checkWinCondition();
        this._persist();
        return this.state;
    }

    setActiveSpeaker(seat, speaking = true) {
        const activeSeat = Number(seat || 0);
        this.state.speaking = !!speaking;
        this.state.currentSpeaker = activeSeat;
        this.state.players = this.state.players.map(player => ({
            ...player,
            active: !!speaking && Number(player.seat) === activeSeat
        }));
        const player = this.state.players.find(item => Number(item.seat) === activeSeat);
        if (player) {
            this.state.notice = speaking
                ? `当前 ${activeSeat} 号 ${player.name || '玩家'} 发言中。`
                : `等待 ${activeSeat} 号 ${player.name || '玩家'} 发言。`;
        }
        this._persist();
        return this.state;
    }

    addSpeech(seat, text, options = {}) {
        const speakerSeat = Number(seat || 0);
        const speech = String(text || '').trim();
        if (!speech) return this.state;
        if (!Array.isArray(this.state.chat)) this.state.chat = [];
        this.state.chat.push({
            seat: speakerSeat,
            text: speech,
            day: Number(options.day || this.state.day || 1),
            phase: String(options.phase || this.state.phase || '').trim(),
            at: Date.now(),
            system: !!options.system
        });
        if (!options.skipReplay) {
            this.recordReplay(speakerSeat ? 'speech' : 'system', speakerSeat ? `${speakerSeat}号：${speech}` : speech, {
                day: this.state.day,
                visibility: 'public'
            });
        }
        this.state.lastSpeechAt = Date.now();
        const player = this.state.players.find(item => Number(item.seat) === speakerSeat);
        if (player && !options.keepNotice) {
            this.state.notice = `${speakerSeat}号 ${player.name || '玩家'} 已发言。`;
        }
        this._persist();
        return this.state;
    }

    addSystemNotice(text) {
        const notice = String(text || '').trim();
        if (!notice) return this.state;
        this.state.notice = notice;
        this._persist();
        return this.state;
    }

    markSpeakerDone(seat) {
        const speakerSeat = Number(seat || this.state.currentSpeaker || 0);
        const nextSeat = this._firstAliveSeatFrom(speakerSeat + 1);
        const firstSeat = this._firstAliveSeatFrom(1);
        const wrappedToStart = nextSeat === firstSeat && speakerSeat >= this._lastAliveSeat();
        this.state.players = this.state.players.map(player => ({ ...player, active: false }));
        this.state.speaking = false;
        if (!nextSeat || wrappedToStart) {
            this.state.currentSpeaker = nextSeat || 0;
            this.state.notice = '本轮白天发言结束，等待投票流程。';
            this.state.phase = 'vote';
            this.addSpeech(0, '本轮白天发言结束，进入投票准备。', { system: true, keepNotice: true, skipReplay: true });
        } else {
            this.state.currentSpeaker = nextSeat;
            this.state.notice = this._isUserSeat(nextSeat)
                ? `请 ${nextSeat} 号玩家发言。`
                : `等待 ${nextSeat} 号玩家发言。`;
        }
        this._persist();
        return this.state;
    }

    skipDeadSpeaker() {
        const speaker = this.getCurrentSpeaker();
        if (!speaker || speaker.alive !== false) return this.state;
        this.addSpeech(0, `${speaker.seat}号玩家已死亡，跳过发言。`, { system: true, keepNotice: true, skipReplay: true });
        return this.markSpeakerDone(speaker.seat);
    }

    buildSpeechContext(player) {
        const speaker = player || this.getCurrentSpeaker();
        if (!speaker) return null;
        const seerChecks = speaker.role === '预言家'
            ? this._getSeerChecksForSeat(speaker.seat)
            : [];
        return {
            day: Number(this.state.day || 1),
            phase: this.state.phase,
            roleRevealMode: this._normalizeRoleRevealMode(this.state.roleRevealMode),
            speaker: this._publicPlayer(speaker),
            speakerPrivateRole: speaker.role || '村民',
            players: this.state.players.map(playerItem => this._publicPlayer(playerItem)),
            voteHistory: this._buildPublicVoteHistory(),
            publicLog: (this.state.chat || []).map(item => {
                const dayPrefix = Number(item.day || 0) ? `第${Number(item.day)}天 ` : '';
                if (Number(item.seat || 0) === 0) return `${dayPrefix}系统：${item.text}`;
                const target = this.state.players.find(playerItem => Number(playerItem.seat) === Number(item.seat));
                return `${dayPrefix}${item.seat}号${target?.name ? ` ${target.name}` : ''}：${item.text}`;
            }),
            roleSummary: this.state.players
                .filter(playerItem => !playerItem.isUser)
                .map(playerItem => `${playerItem.seat}号 ${playerItem.name}：${playerItem.role}，${playerItem.personality || '普通玩家'}`),
            seerChecks,
            userSeat: this.state.players.find(playerItem => playerItem.isUser)?.seat || 0
        };
    }

    _buildPublicVoteHistory() {
        const replayLog = Array.isArray(this.state.replayLog) ? this.state.replayLog : [];
        return replayLog
            .filter(item => String(item?.type || '') === 'vote' && String(item?.visibility || 'public') === 'public')
            .map(item => ({
                day: Number(item.day || 1),
                text: String(item.text || '').trim(),
                at: Number(item.at || 0)
            }))
            .filter(item => item.text);
    }

    _publicPlayer(player) {
        const alive = player.alive !== false;
        const publicRole = !alive && this.state.roleRevealMode !== 'hidden'
            ? String(player.role || '').trim()
            : '';
        return {
            seat: player.seat,
            name: player.name,
            source: player.source || '',
            alive,
            isUser: !!player.isUser,
            personality: player.personality || '',
            publicRole,
            status: alive ? '存活' : publicRole ? `死亡，公开身份：${publicRole}` : '死亡'
        };
    }

    _loadState() {
        const saved = this.storage?.get?.(STORAGE_KEY);
        if (this._isValidState(saved)) {
            this._removeLegacyGlobalState();
            if (saved.phase === 'setup' && this._shouldRandomizeLegacyUserSeat(saved)) {
                return this._createInitialState();
            }
            const migrated = this._migrateState(saved);
            if (saved.phase === 'setup' && this._hasDirtySetupSeats(saved, migrated)) {
                this.state = migrated;
                this._persist();
            }
            if (migrated._werewolfStateMigrated) {
                delete migrated._werewolfStateMigrated;
                this.state = migrated;
                this._persist();
            }
            return migrated;
        }

        const legacySaved = this.storage?.get?.(LEGACY_STORAGE_KEY);
        if (this._isValidState(legacySaved)) {
            const migrated = this._migrateState(legacySaved);
            if (migrated._werewolfStateMigrated) delete migrated._werewolfStateMigrated;
            this.state = migrated;
            this._persist();
            this._removeLegacyGlobalState();
            return migrated;
        }

        this._removeLegacyGlobalState();
        return this._createInitialState();
    }

    _removeLegacyGlobalState() {
        if (this.storage?.get?.(LEGACY_STORAGE_KEY) !== undefined && this.storage?.get?.(LEGACY_STORAGE_KEY) !== null) {
            this.storage?.remove?.(LEGACY_STORAGE_KEY);
        }
    }

    _createEmptyPlayer(seat) {
        const safeSeat = Number(seat || 0);
        return {
            id: `empty_${safeSeat}`,
            seat: safeSeat,
            name: '空位',
            avatar: '',
            gender: '',
            personality: '',
            role: '',
            tone: 'empty',
            source: '',
            empty: true,
            isUser: false,
            alive: true,
            active: false
        };
    }

    _createInitialState(userInfo = {}) {
        const userSeat = this._randomSeat();
        const userName = String(userInfo.name || '你').trim() || '你';
        return {
            phase: 'setup',
            matching: false,
            speaking: false,
            day: 1,
            dayStarted: false,
            round: 1,
            currentSpeaker: 0,
            nightStep: '',
            nightActions: this._createNightActions(),
            wolfChat: [],
            wolfChatLoading: false,
            lastGuardSeat: 0,
            witchPotions: { antidote: true, poison: true },
            lastKilledSeat: 0,
            eliminatedSeat: 0,
            lastWordsDone: false,
            voteResult: null,
            voting: false,
            gameOver: false,
            winner: '',
            roleRevealMode: 'open',
            privateLog: [],
            replayLog: [],
            seerChecks: [],
            notice: '点击开始游戏，邀请微信好友入座。',
            chat: [],
            players: Array.from({ length: 8 }, (_, index) => {
                const seat = index + 1;
                if (seat === userSeat) {
                    return {
                        id: 'user',
                        seat,
                        name: userName,
                        avatar: String(userInfo.avatar || '').trim(),
                        gender: '',
                        personality: '用户本人，按用户输入发言',
                        role: '',
                        tone: 'user',
                        source: 'user',
                        empty: false,
                        isUser: true,
                        alive: true,
                        active: false
                    };
                }
                return this._createEmptyPlayer(seat);
            })
        };
    }

    _migrateState(state) {
        const next = {
            ...state,
            speaking: !!state.speaking,
            dayStarted: typeof state.dayStarted === 'boolean' ? state.dayStarted : this._inferDayStarted(state),
            round: Number(state.round || 1),
            chat: Array.isArray(state.chat) ? state.chat : [],
            nightStep: String(state.nightStep || ''),
            nightActions: state.nightActions && typeof state.nightActions === 'object' ? state.nightActions : this._createNightActions(),
            wolfChat: Array.isArray(state.wolfChat) ? state.wolfChat : [],
            wolfChatLoading: !!state.wolfChatLoading,
            lastGuardSeat: Number(state.lastGuardSeat || 0),
            witchPotions: state.witchPotions && typeof state.witchPotions === 'object' ? state.witchPotions : { antidote: true, poison: true },
            lastKilledSeat: Number(state.lastKilledSeat || 0),
            eliminatedSeat: Number(state.eliminatedSeat || 0),
            lastWordsDone: !!state.lastWordsDone,
            voteResult: state.voteResult || null,
            voting: !!state.voting,
            gameOver: !!state.gameOver,
            winner: String(state.winner || ''),
            roleRevealMode: this._normalizeRoleRevealMode(state.roleRevealMode),
            privateLog: Array.isArray(state.privateLog) ? state.privateLog : [],
            replayLog: Array.isArray(state.replayLog) ? state.replayLog : [],
            seerChecks: Array.isArray(state.seerChecks) ? state.seerChecks : []
        };
        next.players = next.players.map(player => {
            const seat = Number(player.seat || 0);
            if (next.phase === 'setup' && !player.isUser) return this._createEmptyPlayer(seat);
            if (player.isUser) {
                return {
                    ...player,
                    id: 'user',
                    seat,
                    name: String(player.name || '你').trim() || '你',
                    avatar: String(player.avatar || '').trim(),
                    personality: String(player.personality || '用户本人，按用户输入发言').trim(),
                    tone: 'user',
                    source: 'user',
                    empty: false,
                    active: !!player.active,
                    alive: player.alive !== false
                };
            }
            return {
                ...player,
                id: String(player.id || (player.isUser ? 'user' : `${player.source || 'player'}_${seat}`)).trim(),
                seat,
                avatar: String(player.avatar || '').trim(),
                empty: !!player.empty,
                active: !!player.active,
                alive: player.alive !== false
            };
        });
        if (next.phase === 'last_words' && next.speaking && !next.lastWordsDone) {
            const eliminated = next.players.find(player => Number(player.seat) === Number(next.eliminatedSeat || 0));
            if (eliminated && !eliminated.isUser) {
                next.speaking = false;
                next.players = next.players.map(player => ({ ...player, active: false }));
                next.notice = `${eliminated.seat}号遗言中断，点击续接遗言可继续。`;
                next._werewolfStateMigrated = true;
            }
        }
        if (next.phase === 'night') {
            const hadRuntimeState = !!next.speaking
                || !!next.wolfChatLoading
                || next.players.some(player => !!player.active);
            if (hadRuntimeState) {
                next.speaking = false;
                next.wolfChatLoading = false;
                next.players = next.players.map(player => ({ ...player, active: false }));
                next.notice = next.nightStep
                    ? `夜晚行动中断，点击继续当前游戏可从${this._nightStepLabel(next.nightStep)}续接。`
                    : '夜晚行动已结束，点击继续当前游戏进入天亮。';
                next._werewolfStateMigrated = true;
            }
        }
        return next;
    }

    _nightStepLabel(step = '') {
        return NIGHT_STEP_LABELS[String(step || '')] || '当前夜晚阶段';
    }

    _hasDirtySetupSeats(originalState = {}, migratedState = {}) {
        if (String(originalState.phase || '') !== 'setup') return false;
        const originalPlayers = Array.isArray(originalState.players) ? originalState.players : [];
        const migratedPlayers = Array.isArray(migratedState.players) ? migratedState.players : [];
        if (originalPlayers.length !== migratedPlayers.length) return true;
        return originalPlayers.some((player) => {
            if (player?.isUser) return false;
            return player?.empty !== true
                || String(player?.name || '') !== '空位'
                || !!String(player?.avatar || '').trim()
                || !!String(player?.contactId || '').trim()
                || !!String(player?.source || '').trim();
        });
    }

    _sanitizeSetupSeats() {
        if (this.state?.phase !== 'setup' || !Array.isArray(this.state.players)) return false;
        let changed = false;
        this.state.players = this.state.players.map(player => {
            if (player?.isUser) return player;
            const seat = Number(player?.seat || 0);
            const dirty = player?.empty !== true
                || String(player?.name || '') !== '空位'
                || !!String(player?.avatar || '').trim()
                || !!String(player?.contactId || '').trim()
                || !!String(player?.source || '').trim()
                || String(player?.tone || '') !== 'empty';
            if (!dirty) return player;
            changed = true;
            return this._createEmptyPlayer(seat);
        });
        if (changed) this._persist();
        return changed;
    }

    _assignRoles() {
        const roles = this._shuffle(ROLE_POOL.slice());
        this.state.players = this.state.players.map((player, index) => ({
            ...player,
            role: roles[index] || '村民'
        }));
    }

    _updateUserRoleHint() {
        const user = this.state.players.find(player => player.isUser);
        this.state.userRole = user?.role || '';
        this.state.userRoleHint = user?.role
            ? `你的身份：${user.role}`
            : '';
    }

    _createNightActions() {
        return {
            guard: null,
            werewolf: null,
            seer: null,
            witch: null
        };
    }

    _consumeWitchPotion(usePotion = '') {
        const potion = String(usePotion || '').trim();
        if (potion !== 'antidote' && potion !== 'poison') return;
        if (!this.state.witchPotions || typeof this.state.witchPotions !== 'object') {
            this.state.witchPotions = { antidote: true, poison: true };
        }
        this.state.witchPotions[potion] = false;
    }

    _recordSeerCheck(action = {}) {
        const actorSeat = Number(action.actorSeat || 0);
        const targetSeat = Number(action.targetSeat || action.result?.seat || 0);
        if (!actorSeat || !targetSeat) return;
        const resultRole = action.result?.role === '狼人' ? '狼人' : '好人';
        if (!Array.isArray(this.state.seerChecks)) this.state.seerChecks = [];
        this.state.seerChecks.push({
            day: Number(this.state.day || 1),
            actorSeat,
            targetSeat,
            resultRole,
            at: Number(action.at || Date.now())
        });
        if (this.state.seerChecks.length > 80) this.state.seerChecks = this.state.seerChecks.slice(-80);
    }

    _getSeerChecksForSeat(seat) {
        const actorSeat = Number(seat || 0);
        if (!actorSeat) return [];
        return (Array.isArray(this.state.seerChecks) ? this.state.seerChecks : [])
            .filter(item => Number(item.actorSeat || 0) === actorSeat)
            .map(item => ({
                day: Number(item.day || 1),
                actorSeat,
                targetSeat: Number(item.targetSeat || 0),
                resultRole: item.resultRole === '狼人' ? '狼人' : '好人'
            }))
            .filter(item => item.targetSeat);
    }

    _normalizePotionForAction(step, payload = {}, options = {}) {
        if (String(step || '') !== 'witch') return '';
        const potion = String(payload.usePotion || '').trim();
        if (potion !== 'antidote' && potion !== 'poison') return '';
        const targetSeat = Number(payload.targetSeat || 0);
        const potions = this.getWitchPotions();
        if (potion === 'antidote') {
            const killedSeat = Number(this.state.lastKilledSeat || 0);
            return potions.antidote && killedSeat && targetSeat === killedSeat ? 'antidote' : '';
        }
        const actorSeat = Number(options.actorSeat || payload.actorSeat || 0);
        return potions.poison && targetSeat && targetSeat !== actorSeat ? 'poison' : '';
    }

    recordReplay(type, text, options = {}) {
        const content = String(text || '').trim();
        if (!content) return this.state;
        const entry = {
            id: `ww_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            type: String(type || 'event').trim(),
            text: content,
            redactedText: String(options.redactedText || '').trim(),
            day: Number(options.day || this.state.day || 1),
            phase: String(options.phase || this.state.phase || '').trim(),
            visibility: String(options.visibility || 'private').trim(),
            at: Date.now()
        };
        if (!Array.isArray(this.state.replayLog)) this.state.replayLog = [];
        this.state.replayLog.push(entry);
        if (this.state.replayLog.length > 400) this.state.replayLog = this.state.replayLog.slice(-400);
        if (entry.visibility !== 'public') {
            if (!Array.isArray(this.state.privateLog)) this.state.privateLog = [];
            this.state.privateLog.push(entry);
            if (this.state.privateLog.length > 240) this.state.privateLog = this.state.privateLog.slice(-240);
        }
        return this.state;
    }

    _recordNightAction(action) {
        const labelMap = {
            guard: '守卫',
            werewolf: '狼人',
            seer: '预言家',
            witch: '女巫'
        };
        const label = labelMap[action.step] || '夜晚';
        const actorText = action.actorSeat ? `${action.actorSeat}号` : label;
        const targetText = action.targetSeat ? `${action.targetSeat}号` : '无目标';
        const potionText = action.usePotion ? `，药剂：${action.usePotion === 'antidote' ? '解药' : action.usePotion === 'poison' ? '毒药' : action.usePotion}` : '';
        const resultText = action.result?.role ? `，结果：${action.result.role}` : '';
        const reasonText = action.reason ? `，理由：${action.reason}` : '';
        const redactedText = this._formatRedactedNightAction(action, label);
        this.recordReplay('night_action', `第 ${this.state.day || 1} 夜 ${label}行动：${actorText} -> ${targetText}${potionText}${resultText}${reasonText}`, {
            visibility: 'private',
            phase: 'night',
            redactedText
        });
        if (action.discussion) {
            this.recordReplay('wolf_discussion', `狼人夜谈：${action.discussion}`, {
                visibility: 'private',
                phase: 'night',
                redactedText: `第 ${this.state.day || 1} 夜 狼人已完成夜谈。`
            });
        }
    }

    _formatRedactedNightAction(action, label) {
        const day = Number(this.state.day || 1);
        if (action.step === 'witch') {
            if (action.usePotion === 'antidote') return `第 ${day} 夜 女巫使用了解药。`;
            if (action.usePotion === 'poison') return `第 ${day} 夜 女巫使用了毒药。`;
            return `第 ${day} 夜 女巫未使用药剂。`;
        }
        if (action.step === 'werewolf') return `第 ${day} 夜 狼人已完成袭击行动。`;
        if (action.step === 'seer') return `第 ${day} 夜 预言家已完成查验。`;
        if (action.step === 'guard') return `第 ${day} 夜 守卫已完成守护。`;
        return `第 ${day} 夜 ${label}已行动。`;
    }

    _formatVoteReplay(target, voteResult) {
        const getName = (seat) => {
            const player = this.state.players.find(item => Number(item.seat) === Number(seat));
            return player?.name ? `${seat}号${player.name}` : `${seat}号`;
        };
        const votes = Array.isArray(voteResult?.votes) && voteResult.votes.length
            ? voteResult.votes
                .slice()
                .sort((a, b) => Number(a.voterSeat) - Number(b.voterSeat))
                .map(item => {
                    const voter = getName(item.voterSeat);
                    const targetSeat = Number(item.targetSeat || 0);
                    return `${voter}->${targetSeat ? getName(targetSeat) : '弃票'}`;
                })
                .join('，')
            : '投票明细未记录';
        const reason = voteResult?.reason ? `，理由：${voteResult.reason}` : '';
        if (!target) return `投票结果：无人出局。${votes}${reason}`;
        return `投票放逐：${target.seat}号 ${target.name || '玩家'} 出局。${votes}${reason}`;
    }

    _advanceNightStep() {
        const index = NIGHT_STEPS.indexOf(String(this.state.nightStep || ''));
        const nextStep = NIGHT_STEPS[index + 1] || '';
        this.state.nightStep = nextStep;
        this.state.players = this.state.players.map(player => ({ ...player, active: false }));
        this.state.notice = nextStep
            ? `夜晚行动中：${NIGHT_STEP_LABELS[nextStep] || '夜晚行动'}。`
            : '夜晚行动结束，等待天亮。';
    }

    _resolveNightResult() {
        const actions = this.state.nightActions || {};
        const guardedSeat = Number(actions.guard?.targetSeat || 0);
        const killedSeat = Number(actions.werewolf?.targetSeat || 0);
        const witch = actions.witch || {};
        const saved = witch.usePotion === 'antidote' && Number(witch.targetSeat || 0) === killedSeat;
        const poisonedSeat = witch.usePotion === 'poison' ? Number(witch.targetSeat || 0) : 0;
        const deaths = new Set();
        if (killedSeat && killedSeat !== guardedSeat && !saved) deaths.add(killedSeat);
        if (poisonedSeat) deaths.add(poisonedSeat);

        this.state.players = this.state.players.map(player => ({
            ...player,
            alive: deaths.has(Number(player.seat)) ? false : player.alive !== false
        }));

        const deathList = [...deaths].sort((a, b) => a - b);
        const notice = deathList.length
            ? `天亮了，昨夜 ${deathList.map(seat => `${seat}号`).join('、')} 死亡。`
            : '天亮了，昨夜无人死亡。';
        return { deaths: deathList, notice };
    }

    _checkWinCondition() {
        if (this.state.gameOver) return this.state;
        const alivePlayers = this.state.players.filter(player => !player.empty && player.alive !== false);
        const wolves = alivePlayers.filter(player => player.role === '狼人');
        const villagers = alivePlayers.filter(player => player.role !== '狼人');
        let winner = '';
        let notice = '';
        if (!wolves.length) {
            winner = 'villagers';
            notice = '游戏结束，好人阵营胜利。';
        } else if (wolves.length >= villagers.length) {
            winner = 'werewolves';
            notice = '游戏结束，狼人阵营胜利。';
        }
        if (!winner) return this.state;
        this.state.gameOver = true;
        this.state.winner = winner;
        this.state.phase = 'ended';
        this.state.nightStep = '';
        this.state.currentSpeaker = 0;
        this.state.speaking = false;
        this.state.players = this.state.players.map(player => ({ ...player, active: false }));
        this.state.notice = notice;
        this.addSpeech(0, notice, { system: true, keepNotice: true, skipReplay: true });
        this.recordReplay('system', notice, { visibility: 'public', phase: 'ended' });
        return this.state;
    }

    _firstAliveSeatFrom(startSeat) {
        const liveSeats = this.state.players
            .filter(player => !player.empty && player.alive !== false)
            .map(player => Number(player.seat))
            .sort((a, b) => a - b);
        if (!liveSeats.length) return 0;
        const normalizedStart = Number(startSeat || 1);
        return liveSeats.find(seat => seat >= normalizedStart) || liveSeats[0];
    }

    _lastAliveSeat() {
        const liveSeats = this.state.players
            .filter(player => !player.empty && player.alive !== false)
            .map(player => Number(player.seat));
        return liveSeats.length ? Math.max(...liveSeats) : 0;
    }

    _isUserSeat(seat) {
        return !!this.state.players.find(player => player.isUser && Number(player.seat) === Number(seat));
    }

    _toneForSeat(seat) {
        const tones = ['hood', 'knight', 'witch', 'hunter', 'hood', 'youth', 'hood', 'youth'];
        return tones[Math.max(0, Math.min(tones.length - 1, Number(seat || 1) - 1))] || 'hood';
    }

    _shuffle(items) {
        const result = items.slice();
        for (let index = result.length - 1; index > 0; index -= 1) {
            const swap = Math.floor(Math.random() * (index + 1));
            [result[index], result[swap]] = [result[swap], result[index]];
        }
        return result;
    }

    _randomSeat() {
        return Math.floor(Math.random() * 8) + 1;
    }

    _normalizeRoleRevealMode(mode = '') {
        return String(mode || '').trim() === 'hidden' ? 'hidden' : 'open';
    }

    _inferDayStarted(state = {}) {
        const phase = String(state.phase || '');
        const day = Number(state.day || 1);
        if (phase === 'setup') return false;
        if (phase === 'night' && day <= 1 && String(state.nightStep || '')) {
            const logs = Array.isArray(state.replayLog) ? state.replayLog : [];
            const chats = Array.isArray(state.chat) ? state.chat : [];
            const hasDayRecord = logs.some(item => ['day', 'vote', 'last_words', 'speech'].includes(String(item?.phase || item?.type || '')))
                || chats.some(item => ['day', 'vote', 'last_words'].includes(String(item?.phase || '')) || /第\s*1\s*天|白天|投票|发言/.test(String(item?.text || '')));
            return hasDayRecord;
        }
        return true;
    }

    _shouldRandomizeLegacyUserSeat(state) {
        const user = state.players?.find(player => player?.isUser);
        const allAiEmpty = state.players?.filter(player => !player?.isUser).every(player => player?.empty);
        return Number(user?.seat) === 8 && allAiEmpty;
    }

    _isValidState(state) {
        return !!state
            && Array.isArray(state.players)
            && state.players.length === 8
            && state.players.every(player => Number.isInteger(Number(player?.seat)));
    }

    _persist() {
        this.storage?.set?.(STORAGE_KEY, this.state);
    }
}
