/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  每日数独视图
 * ======================================================== */

export class SudokuView {
    constructor(app) {
        this.app = app;
        this._cssLoaded = false;
        this._timer = null;
    }

    render() {
        this._loadCSS();
        this.app.sudokuData.resumeTimer();
        const state = this.app.sudokuData.getState();
        const html = `
            <div class="games-app games-sudoku-app">
                <div class="games-sudoku-topbar">
                    <button class="games-sudoku-icon-btn" id="games-sudoku-back" type="button" aria-label="返回大厅">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <button class="games-sudoku-icon-btn" id="games-sudoku-new" type="button" title="新题">
                        <i class="fa-solid fa-rotate-right"></i>
                    </button>
                    <button class="games-sudoku-icon-btn" id="games-sudoku-difficulty" type="button" title="难度">
                        <i class="fa-solid fa-palette"></i>
                    </button>
                </div>

                <div class="games-sudoku-header">
                    <div class="games-sudoku-level">${this._escape(state.difficultyLabel || '每日')}</div>
                    <div class="games-sudoku-meta">
                        <strong>错误次数：${this._renderHearts(state)}</strong>
                        <span id="games-sudoku-timer">${this._formatTime(state.elapsedMs)}</span>
                    </div>
                </div>

                <div class="games-sudoku-board phone-gesture-control" id="games-sudoku-board">
                    ${this._renderCells(state)}
                </div>

                <div class="games-sudoku-tools">
                    <button class="games-sudoku-tool" id="games-sudoku-erase" type="button">
                        <i class="fa-solid fa-eraser"></i>
                        <span>擦除</span>
                    </button>
                    <button class="games-sudoku-tool ${state.history?.length ? '' : 'is-disabled'}" id="games-sudoku-undo" type="button" ${state.history?.length ? '' : 'disabled'}>
                        <i class="fa-solid fa-rotate-left"></i>
                        <span>撤回</span>
                    </button>
                    <button class="games-sudoku-tool ${state.noteMode ? 'is-active' : ''}" id="games-sudoku-note" type="button">
                        <i class="fa-solid fa-pencil"></i>
                        <span>笔记</span>
                    </button>
                    <button class="games-sudoku-tool" id="games-sudoku-auto-note" type="button">
                        <i class="fa-solid fa-list-check"></i>
                        <span>一键</span>
                    </button>
                    <button class="games-sudoku-tool" id="games-sudoku-hint" type="button">
                        <i class="fa-solid fa-lightbulb"></i>
                        <span>提示</span>
                    </button>
                </div>

                <div class="games-sudoku-keypad">
                    ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(value => `
                        <button class="games-sudoku-number" type="button" data-number="${value}">${value}</button>
                    `).join('')}
                </div>

                ${this._renderDifficultySheet()}
                ${this._renderResult(state)}
            </div>
        `;

        this.app.phoneShell.setContent(html, 'games-sudoku');
        this._bindEvents();
        this._startTimer();
    }

    destroy() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        this.app.sudokuData.pauseTimer();
    }

    _renderCells(state) {
        const selected = state.selected || {};
        const selectedValue = state.board?.[selected.row]?.[selected.col] || 0;
        return state.board.map((row, rowIndex) => row.map((value, colIndex) => {
            const fixed = !!state.fixed?.[rowIndex]?.[colIndex];
            const sameCell = selected.row === rowIndex && selected.col === colIndex;
            const sameGroup = selected.row === rowIndex
                || selected.col === colIndex
                || (Math.floor(selected.row / 3) === Math.floor(rowIndex / 3) && Math.floor(selected.col / 3) === Math.floor(colIndex / 3));
            const sameNumber = selectedValue && value === selectedValue;
            const wrong = state.lastWrong?.row === rowIndex && state.lastWrong?.col === colIndex && Date.now() - Number(state.lastWrong?.at || 0) < 1600;
            const classes = [
                'games-sudoku-cell',
                fixed ? 'is-fixed' : '',
                sameGroup ? 'is-related' : '',
                sameNumber ? 'is-same-number' : '',
                sameCell ? 'is-selected' : '',
                wrong ? 'is-wrong' : ''
            ].filter(Boolean).join(' ');
            return `
                <button class="${classes}" type="button" data-row="${rowIndex}" data-col="${colIndex}">
                    ${value ? `<span class="games-sudoku-value">${value}</span>` : this._renderNotes(state.notes?.[rowIndex]?.[colIndex] || [])}
                </button>
            `;
        }).join('')).join('');
    }

    _renderNotes(notes = []) {
        const set = new Set(notes.map(Number));
        return `
            <span class="games-sudoku-notes">
                ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(value => `<span>${set.has(value) ? value : ''}</span>`).join('')}
            </span>
        `;
    }

    _renderHearts(state) {
        const mistakes = Number(state.mistakes || 0);
        const max = Number(state.maxMistakes || 3);
        return Array.from({ length: max }, (_, index) => `<span class="${index < mistakes ? 'is-lost' : ''}">♥</span>`).join('');
    }

    _renderDifficultySheet() {
        return `
            <div class="games-sudoku-difficulty-sheet" id="games-sudoku-difficulty-sheet" hidden>
                <div class="games-sudoku-difficulty-panel">
                    <strong>选择新题难度</strong>
                    <button type="button" data-difficulty="easy">简单</button>
                    <button type="button" data-difficulty="normal">每日</button>
                    <button type="button" data-difficulty="hard">困难</button>
                </div>
            </div>
        `;
    }

    _renderResult(state) {
        if (!state.completed && !state.failed) return '';
        const title = state.completed ? '完成数独' : '挑战失败';
        const desc = state.completed
            ? `用时 ${this._formatTime(state.elapsedMs)} · 提示 ${Number(state.hintsUsed || 0)}`
            : '错误次数已用完';
        return `
            <div class="games-sudoku-result">
                <div class="games-sudoku-result-panel">
                    <strong>${title}</strong>
                    <span>${desc}</span>
                    <button id="games-sudoku-result-new" type="button">再来一局</button>
                </div>
            </div>
        `;
    }

    _bindEvents() {
        document.getElementById('games-sudoku-back')?.addEventListener('click', () => this.app.backToLobby());
        document.getElementById('games-sudoku-new')?.addEventListener('click', () => this.app.newSudoku());
        document.getElementById('games-sudoku-result-new')?.addEventListener('click', () => this.app.newSudoku());
        document.getElementById('games-sudoku-erase')?.addEventListener('click', () => this.app.eraseSudoku());
        document.getElementById('games-sudoku-undo')?.addEventListener('click', () => this.app.undoSudoku());
        document.getElementById('games-sudoku-note')?.addEventListener('click', () => this.app.toggleSudokuNoteMode());
        document.getElementById('games-sudoku-auto-note')?.addEventListener('click', () => this.app.autoNoteSudoku());
        document.getElementById('games-sudoku-hint')?.addEventListener('click', () => this.app.hintSudoku());

        document.querySelectorAll('.games-sudoku-cell').forEach(cell => {
            cell.addEventListener('click', () => {
                this.app.selectSudokuCell(Number(cell.dataset.row), Number(cell.dataset.col));
            });
        });
        document.querySelectorAll('.games-sudoku-number').forEach(button => {
            button.addEventListener('click', () => this.app.setSudokuNumber(Number(button.dataset.number)));
        });

        const sheet = document.getElementById('games-sudoku-difficulty-sheet');
        document.getElementById('games-sudoku-difficulty')?.addEventListener('click', () => {
            if (sheet) sheet.hidden = false;
        });
        sheet?.addEventListener('click', event => {
            if (event.target === sheet) sheet.hidden = true;
        });
        sheet?.querySelectorAll('[data-difficulty]').forEach(button => {
            button.addEventListener('click', () => this.app.newSudoku(button.dataset.difficulty));
        });
    }

    _startTimer() {
        if (this._timer) clearInterval(this._timer);
        this._timer = setInterval(() => {
            if (this.app.currentView !== 'sudoku') {
                this.destroy();
                return;
            }
            const state = this.app.sudokuData.getState();
            const el = document.getElementById('games-sudoku-timer');
            if (el) el.textContent = this._formatTime(state.elapsedMs);
            if (state.completed || state.failed) this.destroy();
        }, 1000);
    }

    _loadCSS() {
        if (this._cssLoaded) return;
        if (document.getElementById('games-sudoku-css')) {
            this._cssLoaded = true;
            return;
        }
        const link = document.createElement('link');
        link.id = 'games-sudoku-css';
        link.rel = 'stylesheet';
        link.href = new URL('./sudoku.css?v=1.0.0', import.meta.url).href;
        document.head.appendChild(link);
        this._cssLoaded = true;
    }

    _formatTime(ms = 0) {
        const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const seconds = total % 60;
        if (hours > 0) {
            return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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
