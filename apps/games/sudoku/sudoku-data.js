/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  每日数独数据
 * ======================================================== */

const STORAGE_KEY = 'games_sudoku_state';
const SIZE = 9;
const BOX = 3;
const MAX_MISTAKES = 3;

const DIFFICULTY_CONFIG = {
    easy: { label: '简单', holes: 36 },
    normal: { label: '每日', holes: 44 },
    hard: { label: '困难', holes: 52 }
};

export class SudokuData {
    constructor(storage) {
        this.storage = storage;
        this.state = this._loadState();
    }

    getState() {
        this._syncElapsed();
        return this.state;
    }

    pauseTimer() {
        this._pauseTimer();
        this.storage?.set?.(STORAGE_KEY, this.state);
        return this.state;
    }

    resumeTimer() {
        if (!this.state || this.state.completed || this.state.failed || this.state.startedAt) return this.state;
        this.state.startedAt = Date.now();
        this.storage?.set?.(STORAGE_KEY, this.state);
        return this.state;
    }

    newDaily(difficulty = 'normal') {
        const mode = this._normalizeDifficulty(difficulty);
        const seed = this._hashSeed(`${this._getDailyKey()}-${mode}`);
        this.state = this._createState(mode, seed);
        this._persist();
        return this.state;
    }

    newGame(difficulty = this.state?.difficulty || 'normal') {
        const mode = this._normalizeDifficulty(difficulty);
        this.state = this._createState(mode, Date.now());
        this._persist();
        return this.state;
    }

    select(row, col) {
        if (!this._isCell(row, col)) return this.state;
        this.state.selected = { row, col };
        this._persist();
        return this.state;
    }

    toggleNoteMode() {
        this.state.noteMode = !this.state.noteMode;
        this._persist();
        return this.state;
    }

    autoNotes() {
        if (this.state.completed || this.state.failed) return this.state;
        const nextNotes = this._cloneNotes(this.state.notes);
        let changed = false;

        for (let row = 0; row < SIZE; row += 1) {
            for (let col = 0; col < SIZE; col += 1) {
                const notes = (!this.state.fixed[row][col] && !this.state.board[row][col])
                    ? this._getCandidates(row, col)
                    : [];
                if (!this._sameNotes(nextNotes[row][col], notes)) {
                    nextNotes[row][col] = notes;
                    changed = true;
                }
            }
        }

        if (!changed) return this.state;
        this._pushHistory();
        this.state.notes = nextNotes;
        this._persist();
        return this.state;
    }

    setNumber(value) {
        const number = Number(value);
        const { row, col } = this.state.selected || {};
        if (!this._isCell(row, col) || number < 1 || number > 9 || this._isLocked(row, col)) return { ok: false, state: this.state };

        if (this.state.noteMode) {
            this._pushHistory();
            const notes = this.state.notes[row][col];
            if (notes.includes(number)) {
                this.state.notes[row][col] = notes.filter(item => item !== number);
            } else {
                this.state.notes[row][col] = [...notes, number].sort((a, b) => a - b);
            }
            this._persist();
            return { ok: true, state: this.state };
        }

        if (this.state.solution[row][col] !== number) {
            this.state.mistakes = Math.min(MAX_MISTAKES, Number(this.state.mistakes || 0) + 1);
            this.state.lastWrong = { row, col, value: number, at: Date.now() };
            if (this.state.mistakes >= MAX_MISTAKES) {
                this.state.failed = true;
                this._pauseTimer();
            }
            this._persist();
            return { ok: false, state: this.state };
        }

        this._pushHistory();
        this.state.board[row][col] = number;
        this.state.notes[row][col] = [];
        this.state.lastWrong = null;
        this._removePeerNotes(row, col, number);
        this._checkComplete();
        this._persist();
        return { ok: true, state: this.state };
    }

    erase() {
        const { row, col } = this.state.selected || {};
        if (!this._isCell(row, col) || this._isLocked(row, col)) return this.state;
        if (!this.state.board[row][col] && !this.state.notes[row][col].length) return this.state;
        this._pushHistory();
        this.state.board[row][col] = 0;
        this.state.notes[row][col] = [];
        this._persist();
        return this.state;
    }

    undo() {
        const previous = this.state.history.pop();
        if (!previous) return this.state;
        this.state.board = this._cloneBoard(previous.board);
        this.state.notes = this._cloneNotes(previous.notes);
        this.state.mistakes = previous.mistakes;
        this.state.lastWrong = null;
        this.state.completed = false;
        this.state.failed = false;
        this._persist();
        return this.state;
    }

    hint() {
        if (this.state.completed || this.state.failed) return this.state;
        const selected = this.state.selected || {};
        const target = this._isCell(selected.row, selected.col) && !this._isLocked(selected.row, selected.col) && !this.state.board[selected.row][selected.col]
            ? selected
            : this._findFirstEmptyCell();
        if (!target) return this.state;
        this._pushHistory();
        this.state.selected = { row: target.row, col: target.col };
        this.state.board[target.row][target.col] = this.state.solution[target.row][target.col];
        this.state.notes[target.row][target.col] = [];
        this.state.hintsUsed = Number(this.state.hintsUsed || 0) + 1;
        this._removePeerNotes(target.row, target.col, this.state.board[target.row][target.col]);
        this._checkComplete();
        this._persist();
        return this.state;
    }

    _loadState() {
        const saved = this.storage?.get?.(STORAGE_KEY);
        if (this._isValidState(saved)) {
            saved.startedAt = 0;
            return saved;
        }
        return this._createState('normal', this._hashSeed(this._getDailyKey()));
    }

    _createState(difficulty, seed) {
        const rng = this._createRng(seed);
        const solution = this._generateSolution(rng);
        const puzzle = this._digHoles(solution, DIFFICULTY_CONFIG[difficulty].holes, rng);
        return {
            dailyKey: this._getDailyKey(),
            difficulty,
            difficultyLabel: DIFFICULTY_CONFIG[difficulty].label,
            solution,
            puzzle: this._cloneBoard(puzzle),
            board: this._cloneBoard(puzzle),
            fixed: puzzle.map(row => row.map(Boolean)),
            notes: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => [])),
            selected: { row: 0, col: 0 },
            noteMode: false,
            mistakes: 0,
            maxMistakes: MAX_MISTAKES,
            hintsUsed: 0,
            startedAt: Date.now(),
            elapsedMs: 0,
            completed: false,
            failed: false,
            lastWrong: null,
            history: []
        };
    }

    _generateSolution(rng) {
        const pattern = (row, col) => (BOX * (row % BOX) + Math.floor(row / BOX) + col) % SIZE;
        const shuffled = array => {
            const result = array.slice();
            for (let index = result.length - 1; index > 0; index -= 1) {
                const swap = Math.floor(rng() * (index + 1));
                [result[index], result[swap]] = [result[swap], result[index]];
            }
            return result;
        };
        const base = [0, 1, 2];
        const rows = shuffled(base).flatMap(group => shuffled(base).map(row => group * BOX + row));
        const cols = shuffled(base).flatMap(group => shuffled(base).map(col => group * BOX + col));
        const nums = shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        return rows.map(row => cols.map(col => nums[pattern(row, col)]));
    }

    _digHoles(solution, holes, rng) {
        const puzzle = this._cloneBoard(solution);
        const cells = [];
        for (let row = 0; row < SIZE; row += 1) {
            for (let col = 0; col < SIZE; col += 1) cells.push([row, col]);
        }
        for (let index = cells.length - 1; index > 0; index -= 1) {
            const swap = Math.floor(rng() * (index + 1));
            [cells[index], cells[swap]] = [cells[swap], cells[index]];
        }
        cells.slice(0, holes).forEach(([row, col]) => {
            puzzle[row][col] = 0;
        });
        return puzzle;
    }

    _pushHistory() {
        this.state.history = [
            ...(this.state.history || []),
            {
                board: this._cloneBoard(this.state.board),
                notes: this._cloneNotes(this.state.notes),
                mistakes: this.state.mistakes
            }
        ].slice(-80);
    }

    _removePeerNotes(row, col, number) {
        for (let index = 0; index < SIZE; index += 1) {
            this.state.notes[row][index] = this.state.notes[row][index].filter(item => item !== number);
            this.state.notes[index][col] = this.state.notes[index][col].filter(item => item !== number);
        }
        const rowStart = Math.floor(row / BOX) * BOX;
        const colStart = Math.floor(col / BOX) * BOX;
        for (let r = rowStart; r < rowStart + BOX; r += 1) {
            for (let c = colStart; c < colStart + BOX; c += 1) {
                this.state.notes[r][c] = this.state.notes[r][c].filter(item => item !== number);
            }
        }
    }

    _getCandidates(row, col) {
        const used = new Set();
        for (let index = 0; index < SIZE; index += 1) {
            if (this.state.board[row][index]) used.add(this.state.board[row][index]);
            if (this.state.board[index][col]) used.add(this.state.board[index][col]);
        }
        const rowStart = Math.floor(row / BOX) * BOX;
        const colStart = Math.floor(col / BOX) * BOX;
        for (let r = rowStart; r < rowStart + BOX; r += 1) {
            for (let c = colStart; c < colStart + BOX; c += 1) {
                if (this.state.board[r][c]) used.add(this.state.board[r][c]);
            }
        }
        return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(number => !used.has(number));
    }

    _sameNotes(a = [], b = []) {
        if (a.length !== b.length) return false;
        return a.every((value, index) => Number(value) === Number(b[index]));
    }

    _checkComplete() {
        const done = this.state.board.every((row, rowIndex) => row.every((value, colIndex) => value === this.state.solution[rowIndex][colIndex]));
        this.state.completed = done;
        if (done) this._pauseTimer();
    }

    _findFirstEmptyCell() {
        for (let row = 0; row < SIZE; row += 1) {
            for (let col = 0; col < SIZE; col += 1) {
                if (!this.state.fixed[row][col] && !this.state.board[row][col]) return { row, col };
            }
        }
        return null;
    }

    _pauseTimer() {
        this._syncElapsed();
        this.state.startedAt = 0;
    }

    _syncElapsed() {
        if (!this.state || this.state.completed || this.state.failed || !this.state.startedAt) return;
        const now = Date.now();
        this.state.elapsedMs = Number(this.state.elapsedMs || 0) + Math.max(0, now - Number(this.state.startedAt || now));
        this.state.startedAt = now;
    }

    _isLocked(row, col) {
        return this.state.completed || this.state.failed || !!this.state.fixed?.[row]?.[col];
    }

    _isCell(row, col) {
        return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < SIZE && col >= 0 && col < SIZE;
    }

    _normalizeDifficulty(value) {
        const key = String(value || 'normal').trim();
        return DIFFICULTY_CONFIG[key] ? key : 'normal';
    }

    _getDailyKey(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    _hashSeed(text) {
        let hash = 2166136261;
        String(text || '').split('').forEach(char => {
            hash ^= char.charCodeAt(0);
            hash = Math.imul(hash, 16777619);
        });
        return hash >>> 0;
    }

    _createRng(seed) {
        let value = Number(seed || 1) >>> 0;
        return () => {
            value += 0x6D2B79F5;
            let t = value;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    _isValidState(state) {
        return !!state
            && Array.isArray(state.solution)
            && Array.isArray(state.board)
            && state.solution.length === SIZE
            && state.board.length === SIZE;
    }

    _cloneBoard(board) {
        return board.map(row => row.slice());
    }

    _cloneNotes(notes) {
        return notes.map(row => row.map(cell => cell.slice()));
    }

    _persist() {
        this._syncElapsed();
        this.storage?.set?.(STORAGE_KEY, this.state);
    }
}
