/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  狼人杀数据
 * ======================================================== */

const STORAGE_KEY = 'games_werewolf_state';

const ROLE_POOL = ['狼人', '狼人', '预言家', '女巫', '守卫', '村民', '村民', '村民'];

export class WerewolfData {
    constructor(storage) {
        this.storage = storage;
        this.state = this._loadState();
    }

    getState() {
        return this.state;
    }

    reset() {
        this.state = this._createInitialState();
        this._persist();
        return this.state;
    }

    setMatching(isMatching) {
        this.state.matching = !!isMatching;
        if (isMatching) this.state.notice = '正在匹配游戏好友...';
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
            return {
                ...player,
                name: String(matched.name || `玩家${player.seat}`).trim(),
                gender: String(matched.gender || '').trim(),
                personality: String(matched.personality || '').trim(),
                tone: this._toneForSeat(player.seat),
                source: 'ai',
                empty: false
            };
        });
        this.state.matching = false;
        this.state.phase = 'day';
        this.state.day = 1;
        this.state.currentSpeaker = this._firstAiSeat();
        this.state.notice = '匹配完成，游戏开始。';
        this.state.chat = [
            {
                seat: 0,
                text: '8人局已开始，请按顺序发言。'
            }
        ];
        this._assignRoles();
        this._persist();
        return this.state;
    }

    applyMatchError(message = '匹配失败，请稍后重试。') {
        this.state.matching = false;
        this.state.notice = message;
        this._persist();
        return this.state;
    }

    getEmptySeats() {
        return this.state.players
            .filter(player => !player.isUser && player.empty)
            .map(player => player.seat);
    }

    _loadState() {
        const saved = this.storage?.get?.(STORAGE_KEY);
        if (this._isValidState(saved)) {
            if (saved.phase === 'setup' && this._shouldRandomizeLegacyUserSeat(saved)) {
                return this._createInitialState();
            }
            return saved;
        }
        return this._createInitialState();
    }

    _createInitialState() {
        const userSeat = this._randomSeat();
        return {
            phase: 'setup',
            matching: false,
            day: 1,
            currentSpeaker: 0,
            notice: '点击开始游戏，自动匹配空位。',
            chat: [],
            players: Array.from({ length: 8 }, (_, index) => {
                const seat = index + 1;
                if (seat === userSeat) {
                    return {
                        seat,
                        name: '你',
                        gender: '',
                        personality: '',
                        role: '',
                        tone: 'user',
                        source: 'user',
                        empty: false,
                        isUser: true,
                        alive: true
                    };
                }
                return {
                    seat,
                    name: '空位',
                    gender: '',
                    personality: '',
                    role: '',
                    tone: 'empty',
                    source: '',
                    empty: true,
                    isUser: false,
                    alive: true
                };
            })
        };
    }

    _assignRoles() {
        const roles = this._shuffle(ROLE_POOL.slice());
        this.state.players = this.state.players.map((player, index) => ({
            ...player,
            role: roles[index] || '村民'
        }));
    }

    _firstAiSeat() {
        return this.state.players.find(player => !player.isUser && !player.empty)?.seat || this._getUserSeat();
    }

    _getUserSeat() {
        return this.state.players.find(player => player.isUser)?.seat || 8;
    }

    _toneForSeat(seat) {
        const tones = ['hood', 'knight', 'witch', 'hunter', 'hood', 'youth', 'hood'];
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
