/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  日历视图层
 * ======================================================== */

export class CalendarView {
    constructor(app) {
        this.app = app;
        this._cssLoaded = false;
        this._cssLoadingPromise = null;
        this.selectedDate = this.getStoryDateParts();
        this.visibleYear = this.selectedDate.year;
        this.visibleMonth = this.selectedDate.month;
        this.addPanelOpen = false;
        this.monthPickerOpen = false;
        this.typePickerOpen = false;
        this.selectedMemoType = 'daily';
        this.draftMemoTitle = '';
        this.draftMemoTime = '';
        this.activeDeleteMemoId = '';
        this.detailMemoId = '';
        this.detailEditMode = false;
        this.detailTypePickerOpen = false;
        this.editMemoType = 'daily';
        this.editMemoTitle = '';
        this.editMemoTime = '';
        this.currentView = 'main';
        this.holidayDraftTitle = '';
        this.holidayDraftMonth = '';
        this.holidayDraftDay = '';
    }

    async loadCSS() {
        if (this._cssLoaded) return true;
        if (this._cssLoadingPromise) return this._cssLoadingPromise;

        const existingLink = document.getElementById('yzp-calendar-css');
        if (existingLink?.dataset?.loaded === '1' || existingLink?.sheet) {
            this._cssLoaded = true;
            return true;
        }

        const link = existingLink || document.createElement('link');
        link.id = 'yzp-calendar-css';
        link.rel = 'stylesheet';
        link.href = new URL('./calendar.css?v=20260527-calendar-polish', import.meta.url).href;
        this._cssLoadingPromise = new Promise(resolve => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                link.dataset.loaded = '1';
                this._cssLoaded = true;
                resolve(true);
            };
            link.addEventListener('load', finish, { once: true });
            link.addEventListener('error', finish, { once: true });
            setTimeout(finish, 1200);
        });
        if (!existingLink) document.head.appendChild(link);
        return this._cssLoadingPromise;
    }

    getHeroImageUrl(theme = 'light', storyDate = null) {
        const holidayIcon = this.getHeroHolidayIcon(storyDate);
        const filename = holidayIcon || this.getDefaultHeroImage(theme);
        return new URL(`./assets/${filename}`, import.meta.url).href;
    }

    getDefaultHeroImage(theme = 'light') {
        return theme === 'dark' ? 'calendar-theme-d.png' : 'calendar-theme.png';
    }

    getDefaultHeroImageUrl(theme = 'light') {
        return new URL(`./assets/${this.getDefaultHeroImage(theme)}`, import.meta.url).href;
    }

    getHeroHolidayIcon(storyDate = null) {
        const selectedHoliday = this.getHeroHolidayForDate(this.selectedDate);
        const storyHoliday = storyDate ? this.getHeroHolidayForDate(storyDate) : null;
        return selectedHoliday?.heroIcon || storyHoliday?.heroIcon || '';
    }

    getHeroHolidayForDate(dateParts) {
        if (!dateParts) return null;
        const dateKey = this.toDateKey(dateParts);
        const holidays = this.app.calendarData.getHolidaysByDate?.(dateKey) || [];
        return holidays.find(item => item?.heroIcon) || null;
    }

    getAssetUrl(filename) {
        return new URL(`./assets/${filename}`, import.meta.url).href;
    }

    async render(options = {}) {
        await this.loadCSS();
        const storyDate = this.getStoryDateParts();
        if (options.syncStoryDate || !this.selectedDate) {
            this.selectedDate = storyDate;
            this.visibleYear = storyDate.year;
            this.visibleMonth = storyDate.month;
        }
        const theme = this.app.calendarData.getTheme();
        if (this.currentView === 'settings') {
            this.renderSettings(theme);
            return;
        }
        const heroHolidayIcon = this.getHeroHolidayIcon(storyDate);
        const heroUrl = this.getHeroImageUrl(theme, storyDate);
        const defaultHeroUrl = this.getDefaultHeroImageUrl(theme);
        const html = `
            <div class="yzp-calendar-app yzp-calendar-theme-${theme}">
                <header class="yzp-calendar-header">
                    <div class="yzp-calendar-header-left">
                        <button type="button" class="yzp-calendar-icon-btn" id="yzp-calendar-theme-toggle" aria-label="切换日夜模式">
                            <i class="fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}"></i>
                        </button>
                    </div>
                    <button type="button" class="yzp-calendar-month-btn" id="yzp-calendar-jump-story">
                        <span>${this.visibleMonth}月</span>
                        <i class="fa-solid fa-caret-down"></i>
                    </button>
                    <div class="yzp-calendar-header-actions">
                        <button type="button" class="yzp-calendar-icon-btn" id="yzp-calendar-add-open" aria-label="添加备忘">
                            <i class="fa-solid fa-plus"></i>
                        </button>
                    </div>
                </header>
                <main class="yzp-calendar-main">
                    <div class="yzp-calendar-hero ${heroHolidayIcon ? 'is-holiday' : ''}" aria-hidden="true">
                        <img src="${this.escapeAttr(heroUrl)}" data-default-src="${this.escapeAttr(defaultHeroUrl)}" onerror="this.onerror=null;this.src=this.dataset.defaultSrc;this.closest('.yzp-calendar-hero')?.classList.remove('is-holiday');" alt="">
                    </div>
                    ${this.renderCalendarGrid(storyDate)}
                    ${this.renderMemoSection(storyDate)}
                </main>
                ${this.addPanelOpen ? this.renderAddPanel() : ''}
                ${this.monthPickerOpen ? this.renderMonthPicker(storyDate) : ''}
                ${this.detailMemoId ? this.renderMemoDetail() : ''}
            </div>
        `;

        this.app.phoneShell.setContent(html, 'calendar-main');
        requestAnimationFrame(() => this.bindEvents());
    }

    renderCalendarGrid(storyDate) {
        const weeks = ['日', '一', '二', '三', '四', '五', '六'];
        const days = this.buildMonthDays(this.visibleYear, this.visibleMonth);
        const selectedKey = this.toDateKey(this.selectedDate);
        const storyKey = this.toDateKey(storyDate);
        const storyTs = this.dateSerial(storyDate);
        const memoDateMap = this.app.calendarData.getMemoDatesForMonth(this.visibleYear, this.visibleMonth);
        const hasStoryDateInCurrentMonth = storyDate.year === this.visibleYear && storyDate.month === this.visibleMonth;
        const featuredKey = hasStoryDateInCurrentMonth ? storyKey : selectedKey;
        const storyStickerLight = this.getAssetUrl('2.png');
        const storyStickerDark = this.getAssetUrl('1.png');

        return `
            <section class="yzp-calendar-board">
                <div class="yzp-calendar-week-row">
                    ${weeks.map((day, index) => `<div class="yzp-calendar-weekday ${index === 0 || index === 6 ? 'is-weekend' : ''}">${day}</div>`).join('')}
                </div>
                <div class="yzp-calendar-day-grid">
                    ${days.map(day => {
                        if (!day.inMonth) {
                            return '<div class="yzp-calendar-day yzp-calendar-day-empty" aria-hidden="true"></div>';
                        }
                        const key = this.toDateKey(day);
                        const dayTs = this.dateSerial(day);
                        const weekdayIndex = this.getWeekdayIndex(day.year, day.month, day.day);
                        const relation = dayTs < storyTs ? 'is-past' : (key === storyKey ? 'is-today' : 'is-future');
                        const isStoryDay = key === storyKey;
                        const isFeaturedDay = key === featuredKey;
                        const hasMemo = memoDateMap.has(key) && !isFeaturedDay;
                        const classes = [
                            'yzp-calendar-day',
                            day.inMonth ? 'is-current-month' : 'is-muted',
                            relation,
                            weekdayIndex === 0 || weekdayIndex === 6 ? 'is-weekend' : '',
                            hasMemo ? 'has-memo' : '',
                            key === selectedKey && !isFeaturedDay ? 'is-selected' : '',
                            isStoryDay ? 'is-story-day' : '',
                            isFeaturedDay ? 'is-featured-day' : ''
                        ].filter(Boolean).join(' ');
                        return `
                            <button type="button" class="${classes}" data-date-key="${key}" aria-label="${key}">
                                ${isFeaturedDay ? `<span class="yzp-calendar-story-sticker" aria-hidden="true"><img class="yzp-calendar-story-sticker-light" src="${this.escapeAttr(storyStickerLight)}" alt=""><img class="yzp-calendar-story-sticker-dark" src="${this.escapeAttr(storyStickerDark)}" alt=""></span>` : ''}
                                <span class="yzp-calendar-day-number">${day.day}</span>
                                ${hasMemo ? '<span class="yzp-calendar-memo-dot-mark" aria-hidden="true"></span>' : ''}
                            </button>
                        `;
                    }).join('')}
                </div>
            </section>
        `;
    }

    renderMemoSection(storyDate) {
        const selectedKey = this.toDateKey(this.selectedDate);
        const memos = this.app.calendarData.getCalendarItemsByDate(selectedKey);
        if (!memos.length) return '';

        return `
            <section class="yzp-calendar-memo-panel">
                <div class="yzp-calendar-memo-list">
                    ${memos.map(memo => this.renderMemoItem(memo)).join('')}
                </div>
            </section>
        `;
    }

    renderAddPanel() {
        const dateLabel = `${this.selectedDate.month}月${this.selectedDate.day}日 ${this.getWeekdayLabel(this.selectedDate)}`;
        const selectedType = this.getMemoTypeInfo(this.selectedMemoType);
        return `
            <div class="yzp-calendar-add-overlay" id="yzp-calendar-add-overlay">
                <section class="yzp-calendar-add-sheet">
                    <div class="yzp-calendar-add-head">
                        <div>
                            <div class="yzp-calendar-add-title">
                                <button type="button" class="yzp-calendar-add-title-icon" id="yzp-calendar-open-settings" aria-label="日历设置">
                                    <i class="fa-solid fa-gear"></i>
                                    <b>API</b>
                                </button>
                                <span>添加备忘录</span>
                            </div>
                            <div class="yzp-calendar-add-date">${this.escapeHtml(dateLabel)}</div>
                        </div>
                        <button type="button" class="yzp-calendar-icon-btn" id="yzp-calendar-add-close" aria-label="关闭">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <form class="yzp-calendar-add-form" id="yzp-calendar-add-form" autocomplete="off">
                        <textarea class="yzp-calendar-memo-input" id="yzp-calendar-memo-input" maxlength="160" placeholder="输入备忘内容">${this.escapeHtml(this.draftMemoTitle)}</textarea>
                        <input class="yzp-calendar-time-input" id="yzp-calendar-time-input" maxlength="16" placeholder="时间，例如 19:00" value="${this.escapeAttr(this.draftMemoTime)}">
                        <div class="yzp-calendar-type-wrap">
                            <button type="button" class="yzp-calendar-type-select" id="yzp-calendar-type-toggle" aria-expanded="${this.typePickerOpen ? 'true' : 'false'}">
                                <span>${this.escapeHtml(selectedType.label)}</span>
                                <i class="fa-solid fa-chevron-down"></i>
                            </button>
                            ${this.typePickerOpen ? `
                                <div class="yzp-calendar-type-menu" id="yzp-calendar-type-menu">
                                    ${this.getMemoTypes().map(type => `
                                        <button type="button" class="yzp-calendar-type-option ${type.id === selectedType.id ? 'is-active' : ''}" data-calendar-type="${this.escapeAttr(type.id)}">
                                            ${this.escapeHtml(type.label)}
                                        </button>
                                    `).join('')}
                                </div>
                            ` : ''}
                        </div>
                        <div class="yzp-calendar-add-actions">
                            <button type="button" class="yzp-calendar-cancel-btn" id="yzp-calendar-add-cancel">取消</button>
                            <button type="submit" class="yzp-calendar-submit-btn">添加</button>
                        </div>
                    </form>
                </section>
            </div>
        `;
    }

    renderSettings(theme) {
        const promptManager = this.getPromptManager();
        const prompt = this.getSchedulePromptConfig(promptManager);
        const holidays = this.app.calendarData.getHolidays();
        const reminderAdvanceMinutes = this.app.calendarData.getReminderAdvanceMinutes();
        const html = `
            <div class="yzp-calendar-app yzp-calendar-theme-${theme}">
                <header class="yzp-calendar-settings-header">
                    <button type="button" class="yzp-calendar-icon-btn" id="yzp-calendar-settings-back" aria-label="返回">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div class="yzp-calendar-settings-title">日历设置</div>
                    <span aria-hidden="true"></span>
                </header>
                <main class="yzp-calendar-settings-body">
                    <section class="yzp-calendar-settings-section">
                        <div class="yzp-calendar-setting-row">
                            <div>
                                <div class="yzp-calendar-settings-label">日程提醒</div>
                                <div class="yzp-calendar-settings-desc">剧情时间经过日程时间后，只提醒一次；跨天跳转不补提醒。</div>
                            </div>
                            <label class="yzp-calendar-switch">
                                <input type="checkbox" id="yzp-calendar-reminder-toggle" ${this.app.calendarData.isReminderEnabled() ? 'checked' : ''}>
                                <span></span>
                            </label>
                        </div>
                        <div class="yzp-calendar-setting-row">
                            <div>
                                <div class="yzp-calendar-settings-label">提前提醒</div>
                                <div class="yzp-calendar-settings-desc">AI 写入的是日程开始时间，提醒会提前指定分钟触发；填 0 表示准点提醒。</div>
                            </div>
                            <input class="yzp-calendar-reminder-advance-input" id="yzp-calendar-reminder-advance" type="number" inputmode="numeric" min="0" max="1440" step="1" value="${reminderAdvanceMinutes}">
                        </div>
                    </section>
                    <section class="yzp-calendar-settings-section">
                        <div class="yzp-calendar-setting-row">
                            <div>
                                <div class="yzp-calendar-settings-label">自动补全日程</div>
                                <div class="yzp-calendar-settings-desc">开启后，若今天及未来没有普通日程，会在 API 空闲时自动规划。</div>
                            </div>
                            <label class="yzp-calendar-switch">
                                <input type="checkbox" id="yzp-calendar-auto-schedule-toggle" ${this.app.calendarData.isAutoScheduleEnabled() ? 'checked' : ''}>
                                <span></span>
                            </label>
                        </div>
                    </section>
                    <section class="yzp-calendar-settings-section">
                        <div class="phone-prompt-fold" data-default-open="false">
                            <div class="phone-prompt-fold-header">
                                <div class="phone-prompt-fold-main">
                                    <div class="phone-prompt-fold-title">设定节日</div>
                                    <div class="phone-prompt-fold-desc">固定月日循环，可按世界观修改日期或新增节日。</div>
                                </div>
                                <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow"></i>
                            </div>
                            <div class="phone-prompt-fold-content">
                                <div class="yzp-calendar-holiday-list">
                                    ${holidays.map(holiday => this.renderHolidaySettingRow(holiday)).join('')}
                                </div>
                                <form class="yzp-calendar-holiday-add" id="yzp-calendar-holiday-add-form" autocomplete="off">
                                    <input class="yzp-calendar-holiday-title" id="yzp-calendar-holiday-title" maxlength="80" placeholder="节日名" value="${this.escapeAttr(this.holidayDraftTitle)}">
                                    <input class="yzp-calendar-holiday-month" id="yzp-calendar-holiday-month" inputmode="numeric" maxlength="2" placeholder="月" value="${this.escapeAttr(this.holidayDraftMonth)}">
                                    <input class="yzp-calendar-holiday-day" id="yzp-calendar-holiday-day" inputmode="numeric" maxlength="2" placeholder="日" value="${this.escapeAttr(this.holidayDraftDay)}">
                                    <button type="submit" class="yzp-calendar-submit-btn">添加</button>
                                </form>
                            </div>
                        </div>
                    </section>
                    <section class="yzp-calendar-settings-section">
                        <div class="phone-prompt-fold" data-default-open="false">
                            <div class="phone-prompt-fold-header">
                                <div class="phone-prompt-fold-main">
                                    <div class="phone-prompt-fold-title">${this.escapeHtml(prompt.name || '日程规划提示词')}</div>
                                    <div class="phone-prompt-fold-desc">${this.escapeHtml(prompt.description || '默认折叠，展开后可编辑完整提示词。')}</div>
                                </div>
                                <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow"></i>
                            </div>
                            <div class="phone-prompt-fold-content">
                                ${promptManager?.renderPromptPresetControls?.('calendar', 'schedule') || ''}
                                <textarea class="yzp-calendar-prompt-editor" id="yzp-calendar-schedule-prompt" spellcheck="false">${this.escapeHtml(prompt.content || '')}</textarea>
                                <div class="yzp-calendar-settings-actions">
                                    <button type="button" class="yzp-calendar-cancel-btn" id="yzp-calendar-reset-prompt">恢复默认</button>
                                    <button type="button" class="yzp-calendar-submit-btn" id="yzp-calendar-save-prompt">保存提示词</button>
                                </div>
                            </div>
                        </div>
                    </section>
                    <section class="yzp-calendar-settings-section">
                        <div class="yzp-calendar-settings-label">自动规划</div>
                        <div class="yzp-calendar-settings-desc">根据角色卡、用户信息、世界书和最近剧情生成可写入日历的待办。</div>
                        <button type="button" class="yzp-calendar-generate-btn ${this.app.isGeneratingSchedule ? 'is-loading' : ''}" id="yzp-calendar-settings-generate" ${this.app.isGeneratingSchedule ? 'disabled' : ''}>
                            <i class="fa-solid fa-wand-magic-sparkles"></i>
                            <span>${this.app.isGeneratingSchedule ? '规划中...' : '自动规划'}</span>
                        </button>
                    </section>
                </main>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'calendar-settings');
        requestAnimationFrame(() => this.bindEvents());
    }

    renderHolidaySettingRow(holiday) {
        const id = String(holiday?.id || '');
        const active = holiday?.globalReminder === true;
        return `
            <div class="yzp-calendar-holiday-row" data-holiday-row="${this.escapeAttr(id)}">
                <input class="yzp-calendar-holiday-title" data-holiday-title="${this.escapeAttr(id)}" maxlength="80" value="${this.escapeAttr(holiday?.title || '')}" aria-label="节日名">
                <input class="yzp-calendar-holiday-month" data-holiday-month="${this.escapeAttr(id)}" inputmode="numeric" maxlength="2" value="${this.escapeAttr(holiday?.month || '')}" aria-label="月份">
                <input class="yzp-calendar-holiday-day" data-holiday-day="${this.escapeAttr(id)}" inputmode="numeric" maxlength="2" value="${this.escapeAttr(holiday?.day || '')}" aria-label="日期">
                <button type="button" class="yzp-calendar-holiday-alarm ${active ? 'is-active' : ''}" data-holiday-global-reminder="${this.escapeAttr(id)}" aria-label="全局提醒">
                    <i class="fa-regular fa-clock"></i>
                </button>
                <button type="button" class="yzp-calendar-holiday-save" data-holiday-save="${this.escapeAttr(id)}" aria-label="保存">
                    <i class="fa-regular fa-floppy-disk"></i>
                </button>
                <button type="button" class="yzp-calendar-holiday-delete" data-holiday-settings-delete="${this.escapeAttr(id)}" aria-label="删除">
                    <i class="fa-regular fa-trash-can"></i>
                </button>
            </div>
        `;
    }

    renderMonthPicker(storyDate) {
        return `
            <div class="yzp-calendar-month-overlay" id="yzp-calendar-month-overlay">
                <section class="yzp-calendar-month-sheet">
                    <div class="yzp-calendar-month-head">
                        <button type="button" class="yzp-calendar-small-btn" id="yzp-calendar-picker-prev-year" aria-label="上一年">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                        <div class="yzp-calendar-picker-year">${this.visibleYear}年</div>
                        <button type="button" class="yzp-calendar-small-btn" id="yzp-calendar-picker-next-year" aria-label="下一年">
                            <i class="fa-solid fa-chevron-right"></i>
                        </button>
                    </div>
                    <div class="yzp-calendar-month-grid">
                        ${Array.from({ length: 12 }, (_, index) => {
                            const month = index + 1;
                            const classes = [
                                'yzp-calendar-month-choice',
                                month === this.visibleMonth ? 'is-active' : '',
                                this.visibleYear === storyDate.year && month === storyDate.month ? 'is-story-month' : ''
                            ].filter(Boolean).join(' ');
                            return `<button type="button" class="${classes}" data-calendar-month="${month}">${month}月</button>`;
                        }).join('')}
                    </div>
                    <div class="yzp-calendar-month-actions">
                        <button type="button" class="yzp-calendar-cancel-btn" id="yzp-calendar-picker-story">剧情时间</button>
                        <button type="button" class="yzp-calendar-submit-btn" id="yzp-calendar-picker-close">完成</button>
                    </div>
                </section>
            </div>
        `;
    }

    renderMemoItem(memo) {
        const type = this.normalizeMemoType(memo.type);
        const typeIconUrl = this.getMemoTypeIconUrl(type);
        const memoId = String(memo.id || '');
        const showDelete = this.activeDeleteMemoId === memoId;
        const isGlobalReminder = memo.globalReminder === true;
        const isHoliday = memo?.isHoliday === true;
        const memoTitle = this.escapeHtml(memo.title);
        const memoTime = String(memo.time || '').trim();
        const memoLine = memoTime
            ? `<span class="yzp-calendar-memo-time-inline">${this.escapeHtml(memoTime)}</span><span class="yzp-calendar-memo-dot">·</span>${memoTitle}`
            : memoTitle;
        return `
            <div class="yzp-calendar-memo-item yzp-calendar-memo-type-${this.escapeAttr(type)} ${isHoliday ? 'is-holiday' : ''} ${showDelete ? 'show-delete' : ''}" data-memo-id="${this.escapeAttr(memoId)}" ${isHoliday ? `data-holiday-id="${this.escapeAttr(memo.holidayId || '')}"` : ''}>
                <span class="yzp-calendar-memo-type-icon" aria-hidden="true">
                    <img src="${this.escapeAttr(typeIconUrl)}" data-default-src="${this.escapeAttr(this.getAssetUrl('hd.png'))}" onerror="this.onerror=null;this.src=this.dataset.defaultSrc;" alt="">
                </span>
                <div class="yzp-calendar-memo-copy">
                    <div class="yzp-calendar-memo-text">${memoLine}</div>
                </div>
                <button type="button" class="yzp-calendar-global-reminder-btn ${isGlobalReminder ? 'is-active' : ''}" ${isHoliday ? `data-holiday-global-reminder="${this.escapeAttr(memo.holidayId || '')}"` : `data-memo-global-reminder="${this.escapeAttr(memoId)}"`} aria-label="全局提醒">
                    <i class="fa-regular fa-clock"></i>
                </button>
                <button type="button" class="yzp-calendar-delete-btn" ${isHoliday ? `data-holiday-delete="${this.escapeAttr(memo.holidayId || '')}"` : `data-memo-delete="${this.escapeAttr(memoId)}"`} aria-label="删除">
                    <i class="fa-regular fa-trash-can"></i>
                </button>
            </div>
        `;
    }

    renderMemoDetail() {
        const memo = this.findMemoById(this.detailMemoId);
        if (!memo) return '';
        const type = this.normalizeMemoType(memo.type);
        const displayType = this.detailEditMode ? this.normalizeMemoType(this.editMemoType) : type;
        const selectedType = this.getMemoTypeInfo(displayType);
        const iconUrl = this.getMemoTypeIconUrl(displayType);
        const titleValue = this.detailEditMode ? this.editMemoTitle : memo.title;
        const timeValue = this.detailEditMode ? this.editMemoTime : memo.time;
        return `
            <div class="yzp-calendar-detail-overlay" id="yzp-calendar-detail-overlay">
                <section class="yzp-calendar-detail-sheet">
                    <div class="yzp-calendar-detail-head">
                        <span class="yzp-calendar-detail-icon" aria-hidden="true"><img src="${this.escapeAttr(iconUrl)}" alt=""></span>
                        <div class="yzp-calendar-detail-meta">
                            <div class="yzp-calendar-detail-type">${this.escapeHtml(selectedType.label)}</div>
                            <div class="yzp-calendar-detail-date">${this.escapeHtml(this.formatDateLabel(this.selectedDate))}${timeValue ? ` ${this.escapeHtml(timeValue)}` : ''}</div>
                        </div>
                        <div class="yzp-calendar-detail-actions">
                            ${this.detailEditMode ? '' : `
                                <button type="button" class="yzp-calendar-icon-btn" id="yzp-calendar-detail-edit" aria-label="编辑">
                                    <i class="fa-regular fa-pen-to-square"></i>
                                </button>
                            `}
                            <button type="button" class="yzp-calendar-icon-btn" id="yzp-calendar-detail-close" aria-label="关闭">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                    </div>
                    ${this.detailEditMode ? `
                        <form class="yzp-calendar-edit-form" id="yzp-calendar-edit-form" autocomplete="off">
                            <textarea class="yzp-calendar-memo-input yzp-calendar-edit-input" id="yzp-calendar-edit-input" maxlength="160">${this.escapeHtml(titleValue)}</textarea>
                            <input class="yzp-calendar-time-input" id="yzp-calendar-edit-time-input" maxlength="16" placeholder="时间，例如 19:00" value="${this.escapeAttr(timeValue)}">
                            <div class="yzp-calendar-type-wrap">
                                <button type="button" class="yzp-calendar-type-select" id="yzp-calendar-edit-type-toggle" aria-expanded="${this.detailTypePickerOpen ? 'true' : 'false'}">
                                    <span>${this.escapeHtml(selectedType.label)}</span>
                                    <i class="fa-solid fa-chevron-down"></i>
                                </button>
                                ${this.detailTypePickerOpen ? `
                                    <div class="yzp-calendar-type-menu yzp-calendar-edit-type-menu" id="yzp-calendar-edit-type-menu">
                                        ${this.getMemoTypes().map(item => `
                                            <button type="button" class="yzp-calendar-type-option ${item.id === selectedType.id ? 'is-active' : ''}" data-calendar-edit-type="${this.escapeAttr(item.id)}">
                                                ${this.escapeHtml(item.label)}
                                            </button>
                                        `).join('')}
                                    </div>
                                ` : ''}
                            </div>
                            <div class="yzp-calendar-edit-actions">
                                <button type="button" class="yzp-calendar-cancel-btn" id="yzp-calendar-edit-cancel">取消</button>
                                <button type="submit" class="yzp-calendar-submit-btn">保存</button>
                            </div>
                        </form>
                    ` : `
                        <div class="yzp-calendar-detail-body">${this.escapeHtml(memo.title)}</div>
                    `}
                </section>
            </div>
        `;
    }

    bindEvents() {
        const root = document.querySelector('.phone-view-current .yzp-calendar-app');
        if (!root) return;
        this.bindPromptFoldToggles(root);

        root.querySelector('#yzp-calendar-theme-toggle')?.addEventListener('click', () => {
            const current = this.app.calendarData.getTheme();
            this.app.calendarData.setTheme(current === 'dark' ? 'light' : 'dark');
            this.render();
        });
        root.querySelector('#yzp-calendar-jump-story')?.addEventListener('click', () => {
            this.monthPickerOpen = true;
            this.render();
        });
        root.querySelector('#yzp-calendar-add-open')?.addEventListener('click', () => {
            this.addPanelOpen = true;
            this.render();
            setTimeout(() => {
                document.querySelector('.phone-view-current #yzp-calendar-memo-input')?.focus?.();
            }, 50);
        });
        root.querySelectorAll('.yzp-calendar-day').forEach(btn => {
            btn.addEventListener('click', () => {
                const parsed = this.parseDateKey(btn.dataset.dateKey);
                if (!parsed) return;
                this.selectedDate = parsed;
                this.visibleYear = parsed.year;
                this.visibleMonth = parsed.month;
                this.render();
            });
        });
        root.querySelector('#yzp-calendar-add-overlay')?.addEventListener('click', (e) => {
            if (e.target?.id !== 'yzp-calendar-add-overlay') return;
            this.addPanelOpen = false;
            this.typePickerOpen = false;
            this.render();
        });
        root.querySelector('#yzp-calendar-add-close')?.addEventListener('click', () => {
            this.addPanelOpen = false;
            this.typePickerOpen = false;
            this.render();
        });
        root.querySelector('#yzp-calendar-add-cancel')?.addEventListener('click', () => {
            this.addPanelOpen = false;
            this.typePickerOpen = false;
            this.render();
        });
        root.querySelector('#yzp-calendar-open-settings')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.captureAddDraft(root);
            this.addPanelOpen = false;
            this.typePickerOpen = false;
            this.currentView = 'settings';
            this.render();
        });
        root.querySelector('#yzp-calendar-settings-back')?.addEventListener('click', () => {
            this.currentView = 'main';
            this.render();
        });
        root.querySelector('#yzp-calendar-reminder-toggle')?.addEventListener('change', (e) => {
            const enabled = this.app.calendarData.setReminderEnabled(!!e.target.checked);
            if (enabled) {
                this.app.checkScheduleReminders(window.VirtualPhone?.timeManager?.getCurrentStoryTime?.());
            }
            this.app.phoneShell?.showNotification?.('日历提醒', enabled ? '已开启日程提醒' : '已关闭日程提醒', '📅');
        });
        root.querySelector('#yzp-calendar-reminder-advance')?.addEventListener('change', (e) => {
            const value = this.app.calendarData.setReminderAdvanceMinutes(e.target.value);
            e.target.value = String(value);
            this.app.phoneShell?.showNotification?.('日历提醒', value > 0 ? `将提前 ${value} 分钟提醒` : '已设为准点提醒', '📅');
        });
        root.querySelector('#yzp-calendar-auto-schedule-toggle')?.addEventListener('change', (e) => {
            const enabled = this.app.calendarData.setAutoScheduleEnabled(!!e.target.checked);
            if (enabled) {
                window.VirtualPhone?._scheduleAutoCalendarIfNeeded?.({ reason: 'settings_enabled', forceCheck: true, delay: 800 });
            }
            this.app.phoneShell?.showNotification?.('日历', enabled ? '已开启自动补全日程' : '已关闭自动补全日程', '📅');
        });
        root.querySelector('#yzp-calendar-holiday-add-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const titleInput = root.querySelector('#yzp-calendar-holiday-title');
            const monthInput = root.querySelector('#yzp-calendar-holiday-month');
            const dayInput = root.querySelector('#yzp-calendar-holiday-day');
            const holiday = this.app.calendarData.addHoliday({
                title: titleInput?.value,
                month: monthInput?.value,
                day: dayInput?.value,
                globalReminder: true
            });
            if (!holiday) {
                this.app.phoneShell?.showNotification?.('日历', '请填写有效的节日名称和日期', '📅');
                return;
            }
            this.holidayDraftTitle = '';
            this.holidayDraftMonth = '';
            this.holidayDraftDay = '';
            this.app.phoneShell?.showNotification?.('日历', '已添加设定节日', '📅');
            this.render();
        });
        root.querySelectorAll('[data-holiday-save]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const id = btn.dataset.holidaySave;
                const row = btn.closest('[data-holiday-row]');
                const saved = this.app.calendarData.updateHoliday(id, {
                    title: row?.querySelector('[data-holiday-title]')?.value,
                    month: row?.querySelector('[data-holiday-month]')?.value,
                    day: row?.querySelector('[data-holiday-day]')?.value
                });
                this.app.phoneShell?.showNotification?.('日历', saved ? '已保存设定节日' : '节日日期无效', '📅');
                if (saved) this.render();
            });
        });
        root.querySelector('#yzp-calendar-save-prompt')?.addEventListener('click', () => {
            const promptManager = this.getPromptManager();
            const textarea = root.querySelector('#yzp-calendar-schedule-prompt');
            const content = String(textarea?.value || '');
            try {
                promptManager?.updateActivePromptUserPreset?.('calendar', 'schedule', content) ?? promptManager?.updatePrompt?.('calendar', 'schedule', content);
                this.app.phoneShell?.showNotification?.('保存成功', '日历提示词已更新', '✅');
            } catch (error) {
                this.app.phoneShell?.showNotification?.('保存失败', error?.message || '提示词保存失败', '⚠️');
            }
        });
        root.querySelector('#yzp-calendar-reset-prompt')?.addEventListener('click', () => {
            const promptManager = this.getPromptManager();
            const defaultContent = promptManager?.resetPromptToDefault?.('calendar', 'schedule')
                ?? promptManager?.getDefaultPrompts?.()?.calendar?.schedule?.content
                ?? '';
            const textarea = root.querySelector('#yzp-calendar-schedule-prompt');
            if (textarea) textarea.value = defaultContent;
            this.app.phoneShell?.showNotification?.('已恢复', '已恢复默认提示词', '🔄');
        });
        root.querySelector('#yzp-calendar-settings-generate')?.addEventListener('click', async () => {
            await this.app.generateScheduleMemos();
        });
        this.getPromptManager()?.bindPromptPresetControls?.(root, 'calendar', 'schedule', '#yzp-calendar-schedule-prompt', {
            notify: (title, message, icon) => this.app.phoneShell?.showNotification?.(title, message, icon)
        });
        root.querySelector('#yzp-calendar-type-toggle')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.captureAddDraft(root);
            this.typePickerOpen = !this.typePickerOpen;
            this.render();
        });
        root.querySelectorAll('[data-calendar-type]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.captureAddDraft(root);
                this.selectedMemoType = this.normalizeMemoType(btn.dataset.calendarType);
                this.typePickerOpen = false;
                this.render();
            });
        });
        root.querySelector('#yzp-calendar-add-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const titleInput = root.querySelector('#yzp-calendar-memo-input');
            const timeInput = root.querySelector('#yzp-calendar-time-input');
            const title = String(titleInput?.value || '').trim();
            if (!title) {
                this.app.phoneShell?.showNotification?.('日历', '请先输入备忘内容', '📅');
                titleInput?.focus?.();
                return;
            }
            this.app.calendarData.addMemo({
                dateKey: this.toDateKey(this.selectedDate),
                title,
                time: String(timeInput?.value || '').trim(),
                type: this.selectedMemoType || 'daily'
            });
            this.addPanelOpen = false;
            this.typePickerOpen = false;
            this.selectedMemoType = 'daily';
            this.draftMemoTitle = '';
            this.draftMemoTime = '';
            this.render();
        });
        root.querySelector('#yzp-calendar-month-overlay')?.addEventListener('click', (e) => {
            if (e.target?.id !== 'yzp-calendar-month-overlay') return;
            this.monthPickerOpen = false;
            this.render();
        });
        root.querySelector('#yzp-calendar-picker-close')?.addEventListener('click', () => {
            this.monthPickerOpen = false;
            this.render();
        });
        root.querySelector('#yzp-calendar-picker-story')?.addEventListener('click', () => {
            const storyDate = this.getStoryDateParts();
            this.selectedDate = storyDate;
            this.visibleYear = storyDate.year;
            this.visibleMonth = storyDate.month;
            this.monthPickerOpen = false;
            this.render();
        });
        root.querySelector('#yzp-calendar-picker-prev-year')?.addEventListener('click', () => {
            this.visibleYear -= 1;
            this.render();
        });
        root.querySelector('#yzp-calendar-picker-next-year')?.addEventListener('click', () => {
            this.visibleYear += 1;
            this.render();
        });
        root.querySelectorAll('[data-calendar-month]').forEach(btn => {
            btn.addEventListener('click', () => {
                const month = Number.parseInt(btn.dataset.calendarMonth, 10);
                if (!Number.isFinite(month)) return;
                this.visibleMonth = month;
                const maxDay = this.getDaysInMonth(this.visibleYear, this.visibleMonth);
                this.selectedDate = {
                    year: this.visibleYear,
                    month: this.visibleMonth,
                    day: Math.min(this.selectedDate.day, maxDay)
                };
                this.monthPickerOpen = false;
                this.render();
            });
        });
        root.querySelectorAll('.yzp-calendar-memo-item').forEach(item => {
            const memoId = String(item.dataset.memoId || '');
            const holidayId = String(item.dataset.holidayId || '');
            let pressTimer = null;
            let longPressOpened = false;
            const clearPress = () => {
                if (pressTimer) {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                }
            };
            const openDelete = (e) => {
                e?.preventDefault?.();
                e?.stopPropagation?.();
                longPressOpened = true;
                this.activeDeleteMemoId = memoId;
                this.render();
            };
            item.addEventListener('touchstart', () => {
                clearPress();
                pressTimer = setTimeout(() => openDelete(), 520);
            }, { passive: true });
            item.addEventListener('touchend', clearPress);
            item.addEventListener('touchcancel', clearPress);
            item.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                clearPress();
                pressTimer = setTimeout(() => openDelete(e), 520);
            });
            item.addEventListener('mouseup', clearPress);
            item.addEventListener('mouseleave', clearPress);
            item.addEventListener('contextmenu', openDelete);
            item.addEventListener('click', (e) => {
                if (e.target?.closest?.('.yzp-calendar-delete-btn, .yzp-calendar-global-reminder-btn')) return;
                if (longPressOpened) {
                    longPressOpened = false;
                    return;
                }
                if (holidayId) return;
                this.detailMemoId = memoId;
                this.detailEditMode = false;
                this.detailTypePickerOpen = false;
                this.activeDeleteMemoId = '';
                this.render();
            });
        });
        root.querySelector('#yzp-calendar-detail-overlay')?.addEventListener('click', (e) => {
            if (e.target?.id !== 'yzp-calendar-detail-overlay') return;
            this.closeMemoDetail();
            this.render();
        });
        root.querySelector('#yzp-calendar-detail-close')?.addEventListener('click', () => {
            this.closeMemoDetail();
            this.render();
        });
        root.querySelector('#yzp-calendar-detail-edit')?.addEventListener('click', () => {
            this.startMemoEdit(this.detailMemoId);
            this.render();
            setTimeout(() => {
                document.querySelector('.phone-view-current #yzp-calendar-edit-input')?.focus?.();
            }, 50);
        });
        root.querySelector('#yzp-calendar-edit-cancel')?.addEventListener('click', () => {
            this.detailEditMode = false;
            this.detailTypePickerOpen = false;
            this.render();
        });
        root.querySelector('#yzp-calendar-edit-type-toggle')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.captureEditDraft(root);
            this.detailTypePickerOpen = !this.detailTypePickerOpen;
            this.render();
        });
        root.querySelectorAll('[data-calendar-edit-type]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.captureEditDraft(root);
                this.editMemoType = this.normalizeMemoType(btn.dataset.calendarEditType);
                this.detailTypePickerOpen = false;
                this.render();
            });
        });
        root.querySelector('#yzp-calendar-edit-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const titleInput = root.querySelector('#yzp-calendar-edit-input');
            const timeInput = root.querySelector('#yzp-calendar-edit-time-input');
            const title = String(titleInput?.value || '').trim();
            if (!title) {
                this.app.phoneShell?.showNotification?.('日历', '请先输入备忘内容', '📅');
                titleInput?.focus?.();
                return;
            }
            const saved = this.app.calendarData.updateMemo(this.detailMemoId, {
                title,
                time: String(timeInput?.value || '').trim(),
                type: this.editMemoType || 'daily'
            });
            if (!saved) return;
            this.detailEditMode = false;
            this.detailTypePickerOpen = false;
            this.render();
        });
        root.querySelectorAll('[data-memo-delete]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.app.calendarData.deleteMemo(btn.dataset.memoDelete);
                this.activeDeleteMemoId = '';
                this.render();
            });
        });
        root.querySelectorAll('[data-holiday-settings-delete]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.app.calendarData.deleteHoliday(btn.dataset.holidaySettingsDelete);
                this.render();
            });
        });
        root.querySelectorAll('[data-holiday-delete]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.app.calendarData.deleteHoliday(btn.dataset.holidayDelete);
                this.activeDeleteMemoId = '';
                this.render();
            });
        });
        root.querySelectorAll('[data-memo-global-reminder]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const enabled = this.app.calendarData.toggleGlobalReminder(btn.dataset.memoGlobalReminder);
                this.activeDeleteMemoId = btn.dataset.memoGlobalReminder || '';
                this.render();
                this.app.phoneShell?.showNotification?.('日历', enabled ? '已加入全局提醒' : '已取消全局提醒', '📅');
            });
        });
        root.querySelectorAll('[data-holiday-global-reminder]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const enabled = this.app.calendarData.toggleHolidayGlobalReminder(btn.dataset.holidayGlobalReminder);
                this.activeDeleteMemoId = btn.closest('.yzp-calendar-memo-item')?.dataset?.memoId || '';
                this.render();
                this.app.phoneShell?.showNotification?.('日历', enabled ? '节日已加入全局提醒' : '节日已取消全局提醒', '📅');
            });
        });
    }

    shiftMonth(delta) {
        let nextMonth = this.visibleMonth + delta;
        let nextYear = this.visibleYear;
        while (nextMonth < 1) {
            nextMonth += 12;
            nextYear -= 1;
        }
        while (nextMonth > 12) {
            nextMonth -= 12;
            nextYear += 1;
        }
        this.visibleYear = nextYear;
        this.visibleMonth = nextMonth;
        const maxDay = this.getDaysInMonth(this.visibleYear, this.visibleMonth);
        this.selectedDate = {
            year: this.visibleYear,
            month: this.visibleMonth,
            day: Math.min(this.selectedDate.day, maxDay)
        };
        this.render();
    }

    startMemoEdit(id) {
        const memo = this.findMemoById(id);
        if (!memo) return;
        this.detailEditMode = true;
        this.detailTypePickerOpen = false;
        this.editMemoTitle = String(memo.title || '').slice(0, 160);
        this.editMemoTime = String(memo.time || '').slice(0, 16);
        this.editMemoType = this.normalizeMemoType(memo.type);
    }

    closeMemoDetail() {
        this.detailMemoId = '';
        this.detailEditMode = false;
        this.detailTypePickerOpen = false;
        this.editMemoTitle = '';
        this.editMemoTime = '';
        this.editMemoType = 'daily';
    }

    buildMonthDays(year, month) {
        const startOffset = this.getWeekdayIndex(year, month, 1);
        const daysInMonth = this.getDaysInMonth(year, month);
        const prevMonth = month === 1 ? 12 : month - 1;
        const prevYear = month === 1 ? year - 1 : year;
        const nextMonth = month === 12 ? 1 : month + 1;
        const nextYear = month === 12 ? year + 1 : year;
        const prevDays = this.getDaysInMonth(prevYear, prevMonth);
        const cells = [];

        for (let i = startOffset - 1; i >= 0; i -= 1) {
            cells.push({ year: prevYear, month: prevMonth, day: prevDays - i, inMonth: false });
        }
        for (let day = 1; day <= daysInMonth; day += 1) {
            cells.push({ year, month, day, inMonth: true });
        }
        let nextDay = 1;
        while (cells.length % 7 !== 0 || cells.length < 42) {
            cells.push({ year: nextYear, month: nextMonth, day: nextDay, inMonth: false });
            nextDay += 1;
        }
        return cells.slice(0, 42);
    }

    getDaysInMonth(year, month) {
        if ([1, 3, 5, 7, 8, 10, 12].includes(month)) return 31;
        if ([4, 6, 9, 11].includes(month)) return 30;
        return this.isLeapYear(year) ? 29 : 28;
    }

    dateSerial(dateParts) {
        return (Number(dateParts.year) * 372) + (Number(dateParts.month) * 31) + Number(dateParts.day);
    }

    getMemoTypes() {
        return [
            { id: 'daily', label: '日常' },
            { id: 'work', label: '工作' },
            { id: 'date', label: '约会' },
            { id: 'birthday', label: '生日' },
            { id: 'anniversary', label: '纪念日' },
            { id: 'study', label: '学习' },
            { id: 'travel', label: '出行' },
            { id: 'health', label: '健康' },
            { id: 'money', label: '账单' },
            { id: 'event', label: '活动' }
        ];
    }

    normalizeMemoType(type) {
        const value = String(type || '').trim();
        return this.getMemoTypes().some(item => item.id === value) ? value : 'daily';
    }

    getMemoTypeInfo(type) {
        return this.getMemoTypes().find(item => item.id === this.normalizeMemoType(type)) || this.getMemoTypes()[0];
    }

    getMemoTypeIconUrl(type) {
        const iconMap = {
            daily: 'rc.png',
            work: 'gz.png',
            date: 'yh.png',
            birthday: 'sr.png',
            anniversary: 'jnr.png',
            study: 'xx.png',
            travel: 'cx.png',
            health: 'jk.png',
            money: 'zd.png',
            event: 'hd.png'
        };
        return this.getAssetUrl(iconMap[this.normalizeMemoType(type)] || iconMap.daily);
    }

    findMemoById(id) {
        const safeId = String(id || '');
        return this.app.calendarData.getMemos().find(memo => String(memo?.id || '') === safeId) || null;
    }

    getPromptManager() {
        const promptManager = window.VirtualPhone?.promptManager;
        if (promptManager && !promptManager._loaded) {
            promptManager.ensureLoaded();
        }
        return promptManager;
    }

    getSchedulePromptConfig(promptManager = null) {
        const manager = promptManager || this.getPromptManager();
        let prompt = manager?.prompts?.calendar?.schedule;
        if (!prompt) {
            const defaultPrompt = manager?.getDefaultPrompts?.()?.calendar?.schedule;
            if (defaultPrompt) prompt = { ...defaultPrompt };
        }
        return prompt || {
            name: '📅 日程规划',
            description: '日历自动规划待办日程的提示词',
            content: ''
        };
    }

    bindPromptFoldToggles(root) {
        if (!root) return;
        root.querySelectorAll('.phone-prompt-fold').forEach(fold => {
            if (fold.dataset.foldInited !== '1') {
                fold.dataset.foldInited = '1';
                fold.classList.toggle('is-open', String(fold.dataset.defaultOpen || '').toLowerCase() === 'true');
            }
        });
        root.querySelectorAll('.phone-prompt-fold-header').forEach(header => {
            if (header.dataset.foldBound === '1') return;
            header.dataset.foldBound = '1';
            header.addEventListener('click', () => {
                const fold = header.closest('.phone-prompt-fold');
                if (!fold) return;
                fold.classList.toggle('is-open');
            });
        });
    }

    formatDateLabel(dateParts) {
        return `${dateParts.month}月${dateParts.day}日 ${this.getWeekdayLabel(dateParts)}`;
    }

    captureAddDraft(root) {
        this.draftMemoTitle = String(root?.querySelector?.('#yzp-calendar-memo-input')?.value || '').slice(0, 160);
        this.draftMemoTime = String(root?.querySelector?.('#yzp-calendar-time-input')?.value || '').slice(0, 16);
    }

    captureEditDraft(root) {
        this.editMemoTitle = String(root?.querySelector?.('#yzp-calendar-edit-input')?.value || '').slice(0, 160);
        this.editMemoTime = String(root?.querySelector?.('#yzp-calendar-edit-time-input')?.value || '').slice(0, 16);
    }

    isLeapYear(year) {
        return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    }

    getWeekdayIndex(year, month, day) {
        const mathIndex = this.getCalculatedWeekdayIndex(year, month, day);
        const storyAnchor = this.getStoryWeekdayAnchor();
        if (storyAnchor) {
            const storyMathIndex = this.getCalculatedWeekdayIndex(storyAnchor.year, storyAnchor.month, storyAnchor.day);
            if (storyMathIndex >= 0) {
                const delta = ((mathIndex - storyMathIndex) % 7 + 7) % 7;
                return (storyAnchor.weekdayIndex + delta) % 7;
            }
        }
        return mathIndex;
    }

    getCalculatedWeekdayIndex(year, month, day) {
        const tm = window.VirtualPhone?.timeManager;
        const weekday = tm?.calculateWeekdayFromDate
            ? tm.calculateWeekdayFromDate(year, month, day)
            : this.calculateWeekdayFromDate(year, month, day);
        return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'].indexOf(weekday);
    }

    getStoryWeekdayAnchor() {
        const storyTime = this.getStoryTime();
        const weekdayIndex = this.getWeekdayIndexFromText(storyTime?.weekday);
        if (weekdayIndex < 0) return null;

        const match = String(storyTime?.date || '').match(/(\d{1,6})[-\/年]\s*(\d{1,2})[-\/月]\s*(\d{1,2})\s*日?/);
        if (!match) return null;

        return {
            year: Number.parseInt(match[1], 10),
            month: Number.parseInt(match[2], 10),
            day: Number.parseInt(match[3], 10),
            weekdayIndex
        };
    }

    getWeekdayIndexFromText(weekday = '') {
        const normalized = String(weekday || '').trim().replace(/^周/, '星期').replace('星期天', '星期日');
        return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'].indexOf(normalized);
    }

    calculateWeekdayFromDate(year, month, day) {
        let y = year;
        let m = month;
        if (m < 3) {
            m += 12;
            y -= 1;
        }
        const q = day;
        const k = y % 100;
        const j = Math.floor(y / 100);
        const h = ((q + Math.floor((13 * (m + 1)) / 5) + k + Math.floor(k / 4) + Math.floor(j / 4) - 2 * j) % 7 + 7) % 7;
        return ['星期六', '星期日', '星期一', '星期二', '星期三', '星期四', '星期五'][h];
    }

    getStoryDateParts() {
        const storyTime = this.getStoryTime();
        const match = String(storyTime?.date || '').match(/(\d{1,6})[-\/年]\s*(\d{1,2})[-\/月]\s*(\d{1,2})\s*日?/);
        if (match) {
            return {
                year: Number.parseInt(match[1], 10),
                month: Number.parseInt(match[2], 10),
                day: Number.parseInt(match[3], 10)
            };
        }
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
    }

    getStoryTimeLabel() {
        const storyTime = this.getStoryTime();
        const date = storyTime?.date || `${this.selectedDate.year}年${this.selectedDate.month}月${this.selectedDate.day}日`;
        const time = storyTime?.time || '';
        const weekday = storyTime?.weekday || this.getWeekdayLabel(this.selectedDate);
        return `剧情时间 ${date} ${weekday}${time ? ` ${time}` : ''}`;
    }

    getStoryTime() {
        const tm = window.VirtualPhone?.timeManager;
        return tm?.getCurrentStoryTime?.() || tm?.getCurrentTime?.() || null;
    }

    getWeekdayLabel(dateParts) {
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        const weekdayIndex = this.getWeekdayIndex(dateParts.year, dateParts.month, dateParts.day);
        if (weekdayIndex >= 0) return weekdays[weekdayIndex];
        return this.calculateWeekdayFromDate(dateParts.year, dateParts.month, dateParts.day);
    }

    toDateKey(dateParts) {
        return [
            String(dateParts.year).padStart(4, '0'),
            String(dateParts.month).padStart(2, '0'),
            String(dateParts.day).padStart(2, '0')
        ].join('-');
    }

    parseDateKey(dateKey) {
        const match = String(dateKey || '').match(/^(\d{1,6})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        return {
            year: Number.parseInt(match[1], 10),
            month: Number.parseInt(match[2], 10),
            day: Number.parseInt(match[3], 10)
        };
    }

    escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    escapeAttr(text) {
        return this.escapeHtml(text).replace(/`/g, '&#96;');
    }
}
