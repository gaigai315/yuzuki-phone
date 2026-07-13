const STORAGE_KEY = 'games_undercover_state';
const PLAYER_COUNT = 6;
const MAX_INVITED_CONTACTS = PLAYER_COUNT - 1;
const AI_AVATAR_PRESET_COUNT = 6;
const FALLBACK_WORD_PAIRS = [
    ['种草莓', '法式湿吻'],
    ['制服诱惑', '角色扮演'],
    ['传教士', '老汉推车'],
    ['情趣手铐', '丝绸眼罩'],
    ['打桩机', '缝纫机']
];
const FALLBACK_AI_PROFILES = [
    ['午夜心碎小狗', '擅长装无辜，发言轻松但会悄悄试探别人。'],
    ['纯情男大', '说话直接又有点害羞，遇到怀疑时会认真自证。'],
    ['海王本王', '喜欢带节奏和接话，擅长用暧昧玩笑模糊重点。'],
    ['夜猫观察员', '逻辑细致，习惯抓描述里的矛盾和用词差异。'],
    ['微醺小玫瑰', '语气松弛俏皮，喜欢顺着前面的人发言再反问。']
];

export class UndercoverData {
    constructor(storage) {
        this.storage = storage;
        this.state = this._load();
    }

    getState() {
        return {
            ...this.state,
            selectedContactIds: [...this.state.selectedContactIds],
            game: this._cloneGame(this.state.game)
        };
    }

    _load() {
        try {
            const raw = this.storage?.get?.(STORAGE_KEY);
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return {
                lastMode: parsed?.lastMode === 'friends' ? 'friends' : 'ai',
                selectedContactIds: this._normalizeContactIds(parsed?.selectedContactIds),
                game: this._normalizeStoredGame(parsed?.game)
            };
        } catch (error) {
            console.warn('[Undercover] 读取游戏状态失败:', error);
            return { lastMode: 'ai', selectedContactIds: [], game: null };
        }
    }

    setLastMode(mode) {
        this.state.lastMode = mode === 'friends' ? 'friends' : 'ai';
        this._save();
        return this.state.lastMode;
    }

    getSelectedContactIds() {
        return [...this.state.selectedContactIds];
    }

    setSelectedContactIds(ids = []) {
        this.state.selectedContactIds = this._normalizeContactIds(ids);
        this._save();
        return this.getSelectedContactIds();
    }

    toggleSelectedContactId(contactId) {
        const id = String(contactId || '').trim();
        if (!id) return this.getSelectedContactIds();
        const selected = new Set(this.state.selectedContactIds);
        if (selected.has(id)) selected.delete(id);
        else if (selected.size < MAX_INVITED_CONTACTS) selected.add(id);
        return this.setSelectedContactIds([...selected]);
    }

    reconcileSelectedContactIds(validIds = []) {
        const valid = new Set((Array.isArray(validIds) ? validIds : []).map(id => String(id || '').trim()).filter(Boolean));
        return this.setSelectedContactIds(this.state.selectedContactIds.filter(id => valid.has(id)));
    }

    prepareGame(userInfo = {}, invitedContacts = []) {
        const seen = new Set();
        const invited = (Array.isArray(invitedContacts) ? invitedContacts : [])
            .map(contact => {
                const id = String(contact?.id || contact?.contactId || contact?.name || '').trim();
                const name = String(contact?.name || contact?.remark || '').trim();
                if (!id || !name || seen.has(id)) return null;
                seen.add(id);
                return {
                    id: `wechat_${id}`,
                    contactId: id,
                    name,
                    avatar: String(contact?.avatar || '').trim(),
                    personality: String(contact?.personality || contact?.signature || contact?.description || contact?.remark || '熟悉用户，发言自然，会根据场上内容判断').trim(),
                    source: 'wechat',
                    isUser: false,
                    empty: false
                };
            })
            .filter(Boolean)
            .slice(0, MAX_INVITED_CONTACTS);

        const humans = [{
            id: 'user',
            name: String(userInfo?.name || '你').trim() || '你',
            avatar: String(userInfo?.avatar || '').trim(),
            personality: String(userInfo?.personality || userInfo?.signature || '按用户自己的方式发言').trim(),
            source: 'user',
            isUser: true,
            empty: false
        }, ...invited];
        const randomSeats = this._shuffle(Array.from({ length: PLAYER_COUNT }, (_, index) => index + 1));
        const humanBySeat = new Map(humans.map((player, index) => [randomSeats[index], player]));
        const players = Array.from({ length: PLAYER_COUNT }, (_, index) => {
            const seat = index + 1;
            const player = humanBySeat.get(seat);
            if (player) return { ...player, seat };
            return {
                id: `undercover_pending_${seat}`,
                name: '匹配中',
                avatar: '',
                personality: '',
                source: 'pending',
                isUser: false,
                empty: true,
                alive: true,
                seat
            };
        });

        this.state.lastMode = invited.length ? 'friends' : 'ai';
        this.state.game = {
            phase: 'matching',
            playerCount: PLAYER_COUNT,
            invitedCount: invited.length,
            players,
            wordPair: null,
            undercoverSeat: null,
            userWord: '',
            round: 1,
            currentSpeakerSeat: null,
            roundSpokenSeats: [],
            pendingUserSpeechCount: 0,
            status: 'dealing',
            statusText: '正在生成玩家与身份词',
            error: '',
            chatMessages: [],
            userVote: null,
            voteHistory: [],
            winner: '',
            startedAt: Date.now(),
            updatedAt: Date.now()
        };
        this._save();
        return this._cloneGame(this.state.game);
    }

    startGame(userInfo = {}, invitedContacts = []) {
        return this.prepareGame(userInfo, invitedContacts);
    }

    applyDealerResult(generatedPlayers = [], wordPair = {}) {
        if (!this.state.game) return null;
        const pendingSeats = this.state.game.players
            .filter(player => player.empty || player.source === 'pending')
            .map(player => Number(player.seat));
        const reservedNames = this.state.game.players
            .filter(player => !player.empty && player.source !== 'pending')
            .map(player => String(player.name || '').trim())
            .filter(Boolean);
        const profiles = this._buildAiProfiles(pendingSeats.length, generatedPlayers, reservedNames);
        const avatarPresets = this._shuffle(Array.from({ length: AI_AVATAR_PRESET_COUNT }, (_, index) => index + 1));
        let aiIndex = 0;
        const filledPlayers = this.state.game.players.map(player => {
            if (!player.empty && player.source !== 'pending') return { ...player };
            const profile = profiles[aiIndex] || profiles[profiles.length - 1] || {};
            const seat = Number(player.seat);
            const next = {
                id: `undercover_ai_${seat}`,
                name: String(profile.name || `午夜玩家${seat}`).trim(),
                avatar: '',
                avatarPreset: avatarPresets[aiIndex % avatarPresets.length],
                personality: String(profile.personality || '发言简短自然，会观察其他人的描述').trim(),
                source: 'ai',
                isUser: false,
                empty: false,
                alive: true,
                seat
            };
            aiIndex += 1;
            return next;
        });

        const normalizedPair = this._normalizeWordPair(wordPair);
        const undercoverSeat = Math.floor(Math.random() * PLAYER_COUNT) + 1;
        const assignedPlayers = filledPlayers.map(player => {
            const isUndercover = Number(player.seat) === undercoverSeat;
            return {
                ...player,
                alive: player.alive !== false,
                role: isUndercover ? 'undercover' : 'civilian',
                word: isUndercover ? normalizedPair.undercover : normalizedPair.civilian
            };
        });
        const firstSpeaker = assignedPlayers.find(player => Number(player.seat) === 1) || assignedPlayers[0];
        const user = assignedPlayers.find(player => player.isUser);

        Object.assign(this.state.game, {
            phase: 'playing',
            players: assignedPlayers,
            wordPair: normalizedPair,
            undercoverSeat,
            userWord: String(user?.word || ''),
            round: 1,
            currentSpeakerSeat: Number(firstSpeaker?.seat || 1),
            roundSpokenSeats: [],
            pendingUserSpeechCount: 0,
            status: firstSpeaker?.isUser ? 'waiting_user' : 'ready',
            statusText: firstSpeaker?.isUser ? '等待你发言' : `等待 ${firstSpeaker?.seat || 1}号发言`,
            error: '',
            userVote: null,
            voteHistory: [],
            winner: '',
            updatedAt: Date.now()
        });
        this._save();
        return this._cloneGame(this.state.game);
    }

    markDealerThinking() {
        if (!this.state.game || this.state.game.phase !== 'matching') return null;
        this.state.game.status = 'dealing';
        this.state.game.statusText = '正在重新生成玩家与身份词';
        this.state.game.error = '';
        this.state.game.updatedAt = Date.now();
        this._save();
        return this._cloneGame(this.state.game);
    }

    getCurrentSpeaker() {
        if (!this.state.game) return null;
        const seat = Number(this.state.game.currentSpeakerSeat || 0);
        const player = this.state.game.players.find(item => Number(item.seat) === seat);
        return player ? { ...player } : null;
    }

    canUserSpeak() {
        const speaker = this.getCurrentSpeaker();
        return !!speaker?.isUser
            && this.state.game?.phase === 'playing'
            && ['waiting_user', 'user_composing', 'waiting_user_reply'].includes(this.state.game?.status);
    }

    hasPendingUserSpeech() {
        return this.canUserSpeak() && Number(this.state.game?.pendingUserSpeechCount || 0) > 0;
    }

    setUserInputFocused(focused) {
        if (!this.canUserSpeak()) return null;
        const hasPending = Number(this.state.game.pendingUserSpeechCount || 0) > 0;
        this.state.game.status = focused ? 'user_composing' : (hasPending ? 'waiting_user_reply' : 'waiting_user');
        this.state.game.statusText = focused
            ? '你正在输入'
            : (hasPending ? '等待补充发言' : '等待你发言');
        this.state.game.updatedAt = Date.now();
        this._save();
        return this._cloneGame(this.state.game);
    }

    finishUserTurn() {
        if (!this.canUserSpeak() || Number(this.state.game.pendingUserSpeechCount || 0) <= 0) return null;
        const speaker = this.getCurrentSpeaker();
        this.state.game.roundSpokenSeats = [...new Set([
            ...(Array.isArray(this.state.game.roundSpokenSeats) ? this.state.game.roundSpokenSeats : []),
            Number(speaker.seat)
        ])];
        this.state.game.pendingUserSpeechCount = 0;
        this._advanceTurn();
        this.state.game.updatedAt = Date.now();
        this._save();
        return this._cloneGame(this.state.game);
    }

    canUserVote() {
        const user = this.state.game?.players?.find(player => player.isUser);
        return !!user
            && user.alive !== false
            && this.state.game?.phase === 'voting'
            && this.state.game?.status === 'waiting_user_vote';
    }

    submitUserVote(targetSeat = 0) {
        if (!this.canUserVote()) return null;
        const user = this.state.game.players.find(player => player.isUser);
        const target = this.state.game.players.find(player => Number(player.seat) === Number(targetSeat));
        if (!target || target.alive === false || target.isUser) return null;
        this.state.game.userVote = {
            voterSeat: Number(user.seat),
            targetSeat: Number(target.seat)
        };
        this.state.game.status = 'vote_ready';
        this.state.game.statusText = '正在准备全员投票';
        this.state.game.updatedAt = Date.now();
        this._save();
        return { ...this.state.game.userVote };
    }

    markVoteThinking() {
        if (!this.state.game || this.state.game.phase !== 'voting') return null;
        this.state.game.status = 'voting';
        this.state.game.statusText = 'AI 正在统计本轮投票';
        this.state.game.error = '';
        this.state.game.updatedAt = Date.now();
        this._save();
        return this._cloneGame(this.state.game);
    }

    markCurrentSpeakerThinking() {
        const speaker = this.getCurrentSpeaker();
        if (!speaker || speaker.isUser || this.state.game?.phase !== 'playing') return null;
        this.state.game.status = 'thinking';
        this.state.game.statusText = `${speaker.seat}号 ${speaker.name} 正在发言`;
        this.state.game.error = '';
        this.state.game.updatedAt = Date.now();
        this._save();
        return this._cloneGame(this.state.game);
    }

    addAiSpeech(seat, content = '') {
        return this._addSpeech(seat, content, 'player');
    }

    addUserChatMessage(content = '') {
        if (!this.canUserSpeak()) return null;
        const speaker = this.getCurrentSpeaker();
        return this._addSpeech(speaker.seat, content, 'user');
    }

    getMessageSegments(message = {}) {
        const savedSegments = Array.isArray(message?.segments)
            ? message.segments.map(segment => String(segment || '').trim()).filter(Boolean)
            : [];
        if (savedSegments.length) return savedSegments;
        const text = String(message?.content || '').trim();
        if (!text) return [];
        return message?.source === 'player' ? this._splitSpeechSegments(text) : [text];
    }

    setGameError(message = '') {
        if (!this.state.game) return null;
        const text = String(message || 'AI 请求失败').trim();
        this.state.game.status = 'error';
        this.state.game.statusText = this.state.game.phase === 'matching'
            ? '开局请求中断'
            : (this.state.game.phase === 'voting' ? '投票请求中断' : 'AI 发言中断');
        this.state.game.error = text;
        this.state.game.updatedAt = Date.now();
        this._save();
        return this._cloneGame(this.state.game);
    }

    applyVoteResult(aiVotes = []) {
        if (!this.state.game || this.state.game.phase !== 'voting') return null;
        const alivePlayers = this.state.game.players.filter(player => player.alive !== false);
        const aliveSeats = new Set(alivePlayers.map(player => Number(player.seat)));
        const user = alivePlayers.find(player => player.isUser);
        const requiredAiVoterSeats = alivePlayers.filter(player => !player.isUser).map(player => Number(player.seat));
        const votesByVoter = new Map();
        if (user && this.state.game.userVote) {
            const voterSeat = Number(this.state.game.userVote.voterSeat);
            const targetSeat = Number(this.state.game.userVote.targetSeat);
            if (voterSeat === Number(user.seat) && aliveSeats.has(targetSeat) && voterSeat !== targetSeat) {
                votesByVoter.set(voterSeat, { voterSeat, targetSeat });
            }
        }
        (Array.isArray(aiVotes) ? aiVotes : []).forEach(vote => {
            const voterSeat = Number(vote?.voterSeat || 0);
            const targetSeat = Number(vote?.targetSeat || 0);
            if (!requiredAiVoterSeats.includes(voterSeat) || votesByVoter.has(voterSeat)) return;
            if (!aliveSeats.has(targetSeat) || voterSeat === targetSeat) return;
            votesByVoter.set(voterSeat, { voterSeat, targetSeat });
        });
        requiredAiVoterSeats.forEach(voterSeat => {
            if (votesByVoter.has(voterSeat)) return;
            const targets = alivePlayers.filter(player => Number(player.seat) !== voterSeat);
            const target = targets[Math.floor(Math.random() * targets.length)];
            if (target) votesByVoter.set(voterSeat, { voterSeat, targetSeat: Number(target.seat) });
        });

        const votes = [...votesByVoter.values()].sort((a, b) => a.voterSeat - b.voterSeat);
        const tally = new Map();
        votes.forEach(vote => tally.set(vote.targetSeat, (tally.get(vote.targetSeat) || 0) + 1));
        const highest = Math.max(0, ...tally.values());
        const leaders = [...tally.entries()].filter(([, count]) => count === highest).map(([seat]) => Number(seat));
        const eliminatedSeat = highest > 0 && leaders.length === 1 ? leaders[0] : 0;
        const eliminated = eliminatedSeat
            ? this.state.game.players.find(player => Number(player.seat) === eliminatedSeat)
            : null;
        if (eliminated) eliminated.alive = false;

        const record = {
            round: Number(this.state.game.round || 1),
            votes,
            eliminatedSeat,
            tiedSeats: eliminatedSeat ? [] : leaders,
            createdAt: Date.now()
        };
        this.state.game.voteHistory = [...(this.state.game.voteHistory || []).map(item => ({ ...item })), record].slice(-20);
        const voteText = votes.map(vote => `${vote.voterSeat}号→${vote.targetSeat}号`).join('，');
        const resultText = eliminated
            ? `${eliminated.seat}号 ${eliminated.name} 出局，身份是${eliminated.role === 'undercover' ? '卧底' : '平民'}。`
            : `本轮平票（${leaders.map(seat => `${seat}号`).join('、')}），无人出局。`;
        const message = {
            id: `undercover_vote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            senderId: 'undercover_system',
            senderName: '投票结果',
            senderSeat: 0,
            round: Number(this.state.game.round || 1),
            content: `${voteText}。${resultText}`,
            source: 'system',
            createdAt: Date.now()
        };
        this.state.game.chatMessages = [...this._cloneChatMessages(this.state.game.chatMessages), message].slice(-120);

        const aliveAfterVote = this.state.game.players.filter(player => player.alive !== false);
        const undercoverAlive = aliveAfterVote.some(player => player.role === 'undercover');
        if (!undercoverAlive) {
            this.state.game.phase = 'ended';
            this.state.game.status = 'ended';
            this.state.game.statusText = '平民阵营获胜';
            this.state.game.winner = 'civilian';
            this.state.game.currentSpeakerSeat = null;
        } else if (aliveAfterVote.length <= 2) {
            this.state.game.phase = 'ended';
            this.state.game.status = 'ended';
            this.state.game.statusText = '卧底获胜';
            this.state.game.winner = 'undercover';
            this.state.game.currentSpeakerSeat = null;
        } else {
            const firstSpeaker = [...aliveAfterVote].sort((a, b) => Number(a.seat) - Number(b.seat))[0];
            this.state.game.phase = 'playing';
            this.state.game.round = Math.max(1, Number(this.state.game.round || 1)) + 1;
            this.state.game.roundSpokenSeats = [];
            this.state.game.pendingUserSpeechCount = 0;
            this.state.game.currentSpeakerSeat = Number(firstSpeaker?.seat || 1);
            this.state.game.status = firstSpeaker?.isUser ? 'waiting_user' : 'ready';
            this.state.game.statusText = firstSpeaker?.isUser ? '等待你发言' : `等待 ${firstSpeaker?.seat || 1}号发言`;
            this.state.game.userVote = null;
            this.state.game.error = '';
        }
        this.state.game.updatedAt = Date.now();
        this._save();
        return { game: this._cloneGame(this.state.game), message: { ...message }, record: { ...record, votes: votes.map(vote => ({ ...vote })) } };
    }

    _addSpeech(seat, content, source) {
        if (!this.state.game || this.state.game.phase !== 'playing') return null;
        const targetSeat = Number(seat || 0);
        if (targetSeat !== Number(this.state.game.currentSpeakerSeat || 0)) return null;
        const text = String(content || '').trim().slice(0, 300);
        if (!text) return null;
        const player = this.state.game.players.find(item => Number(item.seat) === targetSeat);
        if (!player) return null;
        const messageSource = source === 'user' ? 'user' : 'player';
        const segments = messageSource === 'player' ? this._splitSpeechSegments(text) : [text];
        const message = {
            id: `undercover_message_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            senderId: String(player.id || `seat_${targetSeat}`),
            senderName: String(player.name || `${targetSeat}号`),
            senderSeat: targetSeat,
            round: Number(this.state.game.round || 1),
            content: segments.join(''),
            segments,
            source: messageSource,
            createdAt: Date.now()
        };
        this.state.game.chatMessages = [
            ...this._cloneChatMessages(this.state.game.chatMessages),
            message
        ].slice(-120);
        if (messageSource === 'user') {
            this.state.game.pendingUserSpeechCount = Math.max(0, Number(this.state.game.pendingUserSpeechCount || 0)) + 1;
            this.state.game.status = 'user_composing';
            this.state.game.statusText = '你正在输入';
        } else {
            this.state.game.roundSpokenSeats = [...new Set([
                ...(Array.isArray(this.state.game.roundSpokenSeats) ? this.state.game.roundSpokenSeats : []),
                targetSeat
            ])];
            this._advanceTurn();
        }
        this.state.game.updatedAt = Date.now();
        this._save();
        return { ...message, segments: [...message.segments] };
    }

    _advanceTurn() {
        const players = this.state.game.players
            .filter(player => player.alive !== false)
            .sort((a, b) => Number(a.seat) - Number(b.seat));
        const spoken = new Set((this.state.game.roundSpokenSeats || []).map(Number));
        if (players.length && players.every(player => spoken.has(Number(player.seat)))) {
            const user = players.find(player => player.isUser);
            this.state.game.phase = 'voting';
            this.state.game.currentSpeakerSeat = null;
            this.state.game.pendingUserSpeechCount = 0;
            this.state.game.userVote = null;
            this.state.game.status = user ? 'waiting_user_vote' : 'vote_ready';
            this.state.game.statusText = user ? '请选择本轮投票目标' : '正在准备全员投票';
            return;
        }
        const currentSeat = Number(this.state.game.currentSpeakerSeat || 0);
        const currentIndex = players.findIndex(player => Number(player.seat) === currentSeat);
        const orderedCandidates = currentIndex >= 0
            ? [...players.slice(currentIndex + 1), ...players.slice(0, currentIndex + 1)]
            : players;
        const next = orderedCandidates.find(player => !spoken.has(Number(player.seat))) || players[0];
        this.state.game.currentSpeakerSeat = Number(next?.seat || 1);
        this.state.game.pendingUserSpeechCount = 0;
        this.state.game.status = next?.isUser ? 'waiting_user' : 'ready';
        this.state.game.statusText = next?.isUser ? '等待你发言' : `等待 ${next?.seat || 1}号发言`;
        this.state.game.error = '';
    }

    _normalizeStoredGame(game) {
        if (!Array.isArray(game?.players) || game.players.length !== PLAYER_COUNT) return null;
        const players = game.players.map((player, index) => ({
            ...player,
            seat: Number(player?.seat || index + 1),
            empty: !!player?.empty,
            alive: player?.alive !== false
        }));
        const phase = ['matching', 'playing', 'voting', 'ended'].includes(game.phase) ? game.phase : 'playing';
        const currentSpeakerSeat = Number(game.currentSpeakerSeat || 1);
        const currentSpeaker = players.find(player => Number(player.seat) === currentSpeakerSeat) || players[0];
        const defaultStatus = phase === 'matching'
            ? 'dealing'
            : (phase === 'voting'
                ? (players.some(player => player.isUser && player.alive !== false) ? 'waiting_user_vote' : 'vote_ready')
                : (phase === 'ended' ? 'ended' : (currentSpeaker?.isUser ? 'waiting_user' : 'ready')));
        let normalizedStatus = String(game.status || defaultStatus);
        const pendingUserSpeechCount = Math.max(0, Number(game.pendingUserSpeechCount || 0));
        if (phase === 'playing' && currentSpeaker?.isUser && normalizedStatus === 'user_composing') {
            normalizedStatus = pendingUserSpeechCount > 0 ? 'waiting_user_reply' : 'waiting_user';
        }
        return {
            ...game,
            phase,
            players,
            chatMessages: this._cloneChatMessages(game.chatMessages),
            round: Math.max(1, Number(game.round || 1)),
            currentSpeakerSeat: phase === 'matching' || phase === 'voting' || phase === 'ended' ? null : Number(currentSpeaker?.seat || 1),
            roundSpokenSeats: Array.isArray(game.roundSpokenSeats) ? game.roundSpokenSeats.map(Number) : [],
            pendingUserSpeechCount,
            status: normalizedStatus,
            statusText: String(game.statusText || ''),
            error: String(game.error || ''),
            userVote: game.userVote ? { ...game.userVote } : null,
            voteHistory: Array.isArray(game.voteHistory) ? game.voteHistory.map(item => ({ ...item, votes: (item.votes || []).map(vote => ({ ...vote })) })) : [],
            winner: String(game.winner || '')
        };
    }

    _buildAiProfiles(count, generatedPlayers = [], reservedNames = []) {
        const usedNames = new Set((Array.isArray(reservedNames) ? reservedNames : []).map(name => String(name || '').trim()).filter(Boolean));
        const valid = [];
        (Array.isArray(generatedPlayers) ? generatedPlayers : [])
            .map(player => ({
                name: String(player?.name || player?.nickname || '').trim(),
                personality: String(player?.personality || '').trim()
            }))
            .forEach(player => {
                if (!player.name || !player.personality || usedNames.has(player.name)) return;
                usedNames.add(player.name);
                valid.push(player);
            });
        for (let index = valid.length; index < count; index += 1) {
            const fallback = FALLBACK_AI_PROFILES[index % FALLBACK_AI_PROFILES.length];
            let name = fallback[0];
            if (usedNames.has(name)) name = `${name}${index + 1}`;
            usedNames.add(name);
            valid.push({ name, personality: fallback[1] });
        }
        return valid.slice(0, count);
    }

    _normalizeWordPair(wordPair = {}) {
        const civilian = String(wordPair?.civilian || wordPair?.normal || '').trim();
        const undercover = String(wordPair?.undercover || '').trim();
        if (civilian && undercover && civilian !== undercover) return { civilian, undercover };
        const fallback = FALLBACK_WORD_PAIRS[Math.floor(Math.random() * FALLBACK_WORD_PAIRS.length)] || FALLBACK_WORD_PAIRS[0];
        return { civilian: fallback[0], undercover: fallback[1] };
    }

    _splitSpeechSegments(text = '') {
        const source = String(text || '').replace(/\r/g, '').trim();
        if (!source) return [];
        const sentenceParts = source
            .split(/\n+/)
            .flatMap(line => line.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [])
            .map(part => part.trim())
            .filter(Boolean);
        const segments = [];
        sentenceParts.forEach(part => {
            if (part.length <= 52) {
                segments.push(part);
                return;
            }
            const clauses = part.match(/[^，,]+[，,]?/g) || [part];
            let buffer = '';
            clauses.forEach(clause => {
                const next = String(clause || '').trim();
                if (!next) return;
                if (buffer && buffer.length + next.length > 42) {
                    segments.push(buffer);
                    buffer = next;
                } else {
                    buffer += next;
                }
            });
            if (buffer) segments.push(buffer);
        });
        if (segments.length <= 8) return segments;
        return [...segments.slice(0, 7), segments.slice(7).join('')];
    }

    _normalizeContactIds(ids = []) {
        return [...new Set((Array.isArray(ids) ? ids : [])
            .map(id => String(id || '').trim())
            .filter(Boolean))]
            .slice(0, MAX_INVITED_CONTACTS);
    }

    _shuffle(items = []) {
        const shuffled = [...items];
        for (let index = shuffled.length - 1; index > 0; index -= 1) {
            const target = Math.floor(Math.random() * (index + 1));
            [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
        }
        return shuffled;
    }

    _cloneChatMessages(messages = []) {
        return (Array.isArray(messages) ? messages : [])
            .filter(message => message && typeof message === 'object')
            .map(message => ({
                ...message,
                segments: Array.isArray(message.segments) ? [...message.segments] : undefined
            }));
    }

    _cloneGame(game) {
        if (!game) return null;
        return {
            ...game,
            wordPair: game.wordPair ? { ...game.wordPair } : null,
            players: (game.players || []).map(player => ({ ...player })),
            chatMessages: this._cloneChatMessages(game.chatMessages),
            roundSpokenSeats: [...(game.roundSpokenSeats || [])],
            userVote: game.userVote ? { ...game.userVote } : null,
            voteHistory: (game.voteHistory || []).map(item => ({ ...item, votes: (item.votes || []).map(vote => ({ ...vote })) }))
        };
    }

    _save() {
        this.storage?.set?.(STORAGE_KEY, {
            ...this.state,
            selectedContactIds: [...this.state.selectedContactIds],
            game: this._cloneGame(this.state.game)
        }, true);
    }
}
