/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  日历数据层
 * ======================================================== */

export class CalendarData {
    constructor(storage) {
        this.storage = storage;
        this.memoKey = 'calendar_memos';
        this.holidayKey = 'calendar_holidays';
        this.defaultHolidayVersionKey = 'calendar_holiday_defaults_version';
        this.defaultHolidayVersion = '20260527_school_and_festival_holidays';
        this.themeKey = 'calendar_theme';
        this.reminderEnabledKey = 'calendar_reminder_enabled';
        this.reminderAdvanceMinutesKey = 'calendar_reminder_advance_minutes';
        this.autoScheduleEnabledKey = 'calendar_auto_schedule_enabled';
        this._memos = null;
        this._holidays = null;
    }

    getMemos() {
        if (!this._memos) {
            try {
                const saved = this.storage?.get?.(this.memoKey, '[]');
                const parsed = Array.isArray(saved) ? saved : JSON.parse(saved || '[]');
                this._memos = Array.isArray(parsed) ? parsed.filter(Boolean) : [];
            } catch (e) {
                console.warn('[CalendarData] 解析备忘录失败:', e);
                this._memos = [];
            }
        }
        return this._memos;
    }

    getMemosByDate(dateKey) {
        const key = String(dateKey || '').trim();
        return this.getMemos()
            .filter(memo => this.isMemoOnDate(memo, key))
            .sort((a, b) => {
                const pinnedDiff = (b.pinned === true) - (a.pinned === true);
                if (pinnedDiff) return pinnedDiff;
                return String(a.time || '').localeCompare(String(b.time || ''));
            });
    }

    getCalendarItemsByDate(dateKey) {
        return [
            ...this.getHolidaysByDate(dateKey),
            ...this.getMemosByDate(dateKey)
        ];
    }

    getMemoDatesForMonth(year, month) {
        const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-`;
        const map = new Map();
        this.getMemos().forEach(memo => {
            const key = String(memo?.dateKey || '');
            if (key.startsWith(prefix)) {
                map.set(key, (map.get(key) || 0) + 1);
                return;
            }

            if (!this.isRecurringMemo(memo)) return;
            const parts = this.parseDateKey(key);
            if (!parts) return;
            const targetMonth = Number(month);
            const targetYear = Number(year);
            if (this.normalizeType(memo?.type) === 'birthday' && parts.month !== targetMonth) return;
            if (this.normalizeType(memo?.type) === 'anniversary') {
                const targetSerial = this.dateSerial({ year: targetYear, month: targetMonth, day: parts.day });
                if (targetSerial < this.dateSerial(parts)) return;
            }
            if (parts.day > this.getDaysInMonth(targetYear, targetMonth)) return;
            const recurringKey = `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
            map.set(recurringKey, (map.get(recurringKey) || 0) + 1);
        });
        this.getHolidayDatesForMonth(year, month).forEach((count, key) => {
            map.set(key, (map.get(key) || 0) + count);
        });
        return map;
    }

    addMemo({ dateKey, title, time = '', type = 'daily', color = 'blue', source = 'manual', globalReminder = null }) {
        const safeDateKey = String(dateKey || '').trim();
        const safeTitle = String(title || '').trim();
        if (!safeDateKey || !safeTitle) return null;
        const safeType = this.normalizeType(type);

        const memo = {
            id: `calendar_memo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            dateKey: safeDateKey,
            title: safeTitle.slice(0, 160),
            time: String(time || '').trim().slice(0, 16),
            color: this.normalizeColor(color),
            type: safeType,
            source: String(source || 'manual').trim() || 'manual',
            globalReminder: globalReminder === null || typeof globalReminder === 'undefined'
                ? this.isRecurringType(safeType)
                : globalReminder === true,
            createdAt: Date.now(),
            pinned: false
        };

        this.getMemos().push(memo);
        this.saveMemos();
        return memo;
    }

    updateMemo(id, updates = {}) {
        const memo = this.getMemos().find(item => String(item?.id || '') === String(id || ''));
        if (!memo) return false;

        if (Object.prototype.hasOwnProperty.call(updates, 'title')) {
            const safeTitle = String(updates.title || '').trim();
            if (!safeTitle) return false;
            memo.title = safeTitle.slice(0, 160);
        }
        if (Object.prototype.hasOwnProperty.call(updates, 'time')) {
            memo.time = String(updates.time || '').trim().slice(0, 16);
        }
        if (Object.prototype.hasOwnProperty.call(updates, 'type')) {
            memo.type = this.normalizeType(updates.type);
        }
        if (Object.prototype.hasOwnProperty.call(updates, 'remindedKeys')) {
            memo.remindedKeys = Array.isArray(updates.remindedKeys) ? updates.remindedKeys : [];
        }
        if (Object.prototype.hasOwnProperty.call(updates, 'globalReminder')) {
            memo.globalReminder = updates.globalReminder === true;
        }
        memo.updatedAt = Date.now();
        this.saveMemos();
        return true;
    }

    deleteMemo(id) {
        const safeId = String(id || '').trim();
        if (!safeId) return false;
        const memos = this.getMemos();
        const idx = memos.findIndex(memo => String(memo?.id || '') === safeId);
        if (idx < 0) return false;
        memos.splice(idx, 1);
        this.saveMemos();
        return true;
    }

    togglePinned(id) {
        const memo = this.getMemos().find(item => String(item?.id || '') === String(id || ''));
        if (!memo) return false;
        memo.pinned = memo.pinned !== true;
        this.saveMemos();
        return true;
    }

    toggleGlobalReminder(id) {
        const memo = this.getMemos().find(item => String(item?.id || '') === String(id || ''));
        if (!memo) return false;
        memo.globalReminder = memo.globalReminder !== true;
        memo.updatedAt = Date.now();
        this.saveMemos();
        return memo.globalReminder;
    }

    getGlobalReminderMemosByDate(dateKey) {
        return this.getMemosByDate(dateKey)
            .filter(memo => memo?.globalReminder === true);
    }

    getGlobalReminderItemsByDate(dateKey) {
        return this.getCalendarItemsByDate(dateKey)
            .filter(item => item?.globalReminder === true);
    }

    getHolidays() {
        if (!this._holidays) {
            try {
                const saved = this.storage?.get?.(this.holidayKey, null);
                if (saved === null || typeof saved === 'undefined' || saved === '') {
                    this._holidays = this.getDefaultHolidays();
                    this.saveHolidays();
                } else {
                    const parsed = Array.isArray(saved) ? saved : JSON.parse(saved || '[]');
                    this._holidays = Array.isArray(parsed)
                        ? parsed.map(item => this.normalizeHoliday(item)).filter(Boolean)
                        : [];
                    this.mergeDefaultHolidays();
                }
            } catch (e) {
                console.warn('[CalendarData] 解析节日失败:', e);
                this._holidays = this.getDefaultHolidays();
                this.saveHolidays();
            }
        }
        return this._holidays;
    }

    getDefaultHolidays() {
        const now = Date.now();
        return [
            { id: 'holiday_new_year', title: '元旦', month: 1, day: 1, icon: 'yd.png' },
            { id: 'holiday_winter_break', title: '寒假', month: 1, day: 15, icon: 'hj.png' },
            { id: 'holiday_lantern', title: '元宵节', month: 1, day: 15, icon: 'yx.png' },
            { id: 'holiday_valentine', title: '情人节', month: 2, day: 14, icon: 'qr.png' },
            { id: 'holiday_april_fools', title: '愚人节', month: 4, day: 1, icon: 'yr.png' },
            { id: 'holiday_qingming', title: '清明节', month: 4, day: 4, icon: 'qm.png' },
            { id: 'holiday_labor', title: '劳动节', month: 5, day: 1, icon: 'ld.png' },
            { id: 'holiday_dragon_boat', title: '端午', month: 5, day: 5, icon: 'dw.png' },
            { id: 'holiday_children', title: '儿童节', month: 6, day: 1, icon: 'et.png' },
            { id: 'holiday_summer_break', title: '暑假', month: 7, day: 1, icon: 'sj.png' },
            { id: 'holiday_qixi', title: '七夕', month: 7, day: 7, icon: 'qx.png' },
            { id: 'holiday_mid_autumn', title: '中秋', month: 8, day: 15, icon: 'zq.png' },
            { id: 'holiday_national', title: '国庆节', month: 10, day: 1, icon: 'gq.png' },
            { id: 'holiday_halloween', title: '万圣节', month: 10, day: 31, icon: 'ws.png' },
            { id: 'holiday_winter_solstice', title: '冬至', month: 12, day: 22, icon: 'dz.png' },
            { id: 'holiday_christmas_eve', title: '平安夜', month: 12, day: 24, icon: 'pa.png' },
            { id: 'holiday_christmas', title: '圣诞节', month: 12, day: 25, icon: 'sd.png' },
            { id: 'holiday_new_year_eve', title: '除夕', month: 12, day: 30, icon: 'cxj.png' }
        ].map(item => ({
            ...item,
            type: 'holiday',
            globalReminder: true,
            builtIn: true,
            createdAt: now
        }));
    }

    mergeDefaultHolidays() {
        if (!Array.isArray(this._holidays)) return false;
        const savedVersion = String(this.storage?.get?.(this.defaultHolidayVersionKey, '') || '');
        if (savedVersion === this.defaultHolidayVersion) return false;

        const idsToMerge = new Set([
            'holiday_dragon_boat',
            'holiday_qixi',
            'holiday_mid_autumn',
            'holiday_winter_solstice',
            'holiday_new_year_eve',
            'holiday_winter_break',
            'holiday_lantern',
            'holiday_april_fools',
            'holiday_qingming',
            'holiday_children',
            'holiday_summer_break'
        ]);
        const existingIds = new Set(this._holidays.map(item => String(item?.id || '')));
        const missing = this.getDefaultHolidays()
            .filter(item => item?.id && idsToMerge.has(item.id) && !existingIds.has(item.id))
            .map(item => this.normalizeHoliday(item))
            .filter(Boolean);
        if (missing.length) {
            this._holidays.push(...missing);
            this.saveHolidays();
        }
        this.storage?.set?.(this.defaultHolidayVersionKey, this.defaultHolidayVersion);
        return missing.length > 0;
    }

    normalizeHoliday(item) {
        const title = String(item?.title || '').trim();
        const month = Number.parseInt(item?.month, 10);
        const day = Number.parseInt(item?.day, 10);
        if (!title || !this.isValidMonthDay(month, day)) return null;
        return {
            id: String(item?.id || `calendar_holiday_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
            title: title.slice(0, 80),
            month,
            day,
            type: 'holiday',
            icon: this.normalizeHolidayIcon(item?.icon, item?.id, title),
            globalReminder: item?.globalReminder !== false,
            builtIn: item?.builtIn === true,
            createdAt: Number(item?.createdAt) || Date.now(),
            updatedAt: Number(item?.updatedAt) || undefined
        };
    }

    saveHolidays() {
        this.storage?.set?.(this.holidayKey, JSON.stringify(this.getHolidays()));
    }

    addHoliday({ title, month, day, globalReminder = true }) {
        const safeTitle = String(title || '').trim();
        const safeMonth = Number.parseInt(month, 10);
        const safeDay = Number.parseInt(day, 10);
        if (!safeTitle || !this.isValidMonthDay(safeMonth, safeDay)) return null;
        const holiday = {
            id: `calendar_holiday_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            title: safeTitle.slice(0, 80),
            month: safeMonth,
            day: safeDay,
            type: 'holiday',
            icon: this.normalizeHolidayIcon('hd.png'),
            globalReminder: globalReminder !== false,
            builtIn: false,
            createdAt: Date.now()
        };
        this.getHolidays().push(holiday);
        this.saveHolidays();
        return holiday;
    }

    updateHoliday(id, updates = {}) {
        const holiday = this.getHolidays().find(item => String(item?.id || '') === String(id || ''));
        if (!holiday) return false;

        const nextTitle = Object.prototype.hasOwnProperty.call(updates, 'title')
            ? String(updates.title || '').trim()
            : holiday.title;
        const nextMonth = Object.prototype.hasOwnProperty.call(updates, 'month')
            ? Number.parseInt(updates.month, 10)
            : holiday.month;
        const nextDay = Object.prototype.hasOwnProperty.call(updates, 'day')
            ? Number.parseInt(updates.day, 10)
            : holiday.day;
        if (!nextTitle || !this.isValidMonthDay(nextMonth, nextDay)) return false;

        holiday.title = nextTitle.slice(0, 80);
        holiday.month = nextMonth;
        holiday.day = nextDay;
        if (Object.prototype.hasOwnProperty.call(updates, 'globalReminder')) {
            holiday.globalReminder = updates.globalReminder === true;
        }
        holiday.updatedAt = Date.now();
        this.saveHolidays();
        return true;
    }

    deleteHoliday(id) {
        const safeId = String(id || '').trim();
        if (!safeId) return false;
        const holidays = this.getHolidays();
        const idx = holidays.findIndex(item => String(item?.id || '') === safeId);
        if (idx < 0) return false;
        holidays.splice(idx, 1);
        this.saveHolidays();
        return true;
    }

    toggleHolidayGlobalReminder(id) {
        const holiday = this.getHolidays().find(item => String(item?.id || '') === String(id || ''));
        if (!holiday) return false;
        holiday.globalReminder = holiday.globalReminder !== true;
        holiday.updatedAt = Date.now();
        this.saveHolidays();
        return holiday.globalReminder;
    }

    getHolidaysByDate(dateKey) {
        const parts = this.parseDateKey(dateKey);
        if (!parts) return [];
        return this.getHolidays()
            .filter(holiday => holiday.month === parts.month && holiday.day === parts.day)
            .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN'))
            .map(holiday => this.toHolidayCalendarItem(holiday, dateKey));
    }

    getHolidayDatesForMonth(year, month) {
        const targetYear = Number(year);
        const targetMonth = Number(month);
        const map = new Map();
        this.getHolidays().forEach(holiday => {
            if (holiday.month !== targetMonth) return;
            if (holiday.day > this.getDaysInMonth(targetYear, targetMonth)) return;
            const key = `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(holiday.day).padStart(2, '0')}`;
            map.set(key, (map.get(key) || 0) + 1);
        });
        return map;
    }

    getUpcomingHolidayItems(currentDateKey, yearsAhead = 1) {
        const currentParts = this.parseDateKey(currentDateKey);
        if (!currentParts) return [];
        const currentSerial = this.dateSerial(currentParts);
        const items = [];
        for (let year = currentParts.year; year <= currentParts.year + Number(yearsAhead || 0); year += 1) {
            this.getHolidays().forEach(holiday => {
                if (holiday.day > this.getDaysInMonth(year, holiday.month)) return;
                const dateKey = `${String(year).padStart(4, '0')}-${String(holiday.month).padStart(2, '0')}-${String(holiday.day).padStart(2, '0')}`;
                const parts = this.parseDateKey(dateKey);
                if (!parts || this.dateSerial(parts) < currentSerial) return;
                items.push(this.toHolidayCalendarItem(holiday, dateKey));
            });
        }
        return items.sort((a, b) => this.dateSerial(this.parseDateKey(a.dateKey)) - this.dateSerial(this.parseDateKey(b.dateKey)));
    }

    toHolidayCalendarItem(holiday, dateKey) {
        return {
            id: `calendar_holiday_item_${holiday.id}_${dateKey}`,
            holidayId: holiday.id,
            dateKey,
            title: holiday.title,
            icon: this.normalizeHolidayIcon(holiday.icon, holiday.id, holiday.title),
            heroIcon: this.normalizeHolidayHeroIcon(holiday.icon, holiday.id, holiday.title),
            time: '',
            type: 'event',
            color: 'green',
            source: 'holiday',
            isHoliday: true,
            globalReminder: holiday.globalReminder === true,
            pinned: true
        };
    }

    normalizeHolidayIcon(icon, id = '', title = '') {
        const value = String(icon || '').trim();
        const allowed = new Set(['yd.png', 'hj.png', 'yx.png', 'qr.png', 'yr.png', 'qm.png', 'ld.png', 'dw.png', 'et.png', 'sj.png', 'qx.png', 'zq.png', 'gq.png', 'ws.png', 'dz.png', 'pa.png', 'sd.png', 'cxj.png', 'hd.png']);
        if (allowed.has(value)) return value;

        const safeId = String(id || '').trim();
        const safeTitle = String(title || '').trim();
        if (safeId === 'holiday_new_year' || safeTitle === '元旦') return 'yd.png';
        if (safeId === 'holiday_winter_break' || safeTitle === '寒假') return 'hj.png';
        if (safeId === 'holiday_lantern' || safeTitle === '元宵节') return 'yx.png';
        if (safeId === 'holiday_valentine' || safeTitle === '情人节') return 'qr.png';
        if (safeId === 'holiday_april_fools' || safeTitle === '愚人节') return 'yr.png';
        if (safeId === 'holiday_qingming' || safeTitle === '清明节') return 'qm.png';
        if (safeId === 'holiday_labor' || safeTitle === '劳动节') return 'ld.png';
        if (safeId === 'holiday_dragon_boat' || safeTitle === '端午') return 'dw.png';
        if (safeId === 'holiday_children' || safeTitle === '儿童节') return 'et.png';
        if (safeId === 'holiday_summer_break' || safeTitle === '暑假') return 'sj.png';
        if (safeId === 'holiday_qixi' || safeTitle === '七夕') return 'qx.png';
        if (safeId === 'holiday_mid_autumn' || safeTitle === '中秋') return 'zq.png';
        if (safeId === 'holiday_national' || safeTitle === '国庆节') return 'gq.png';
        if (safeId === 'holiday_halloween' || safeTitle === '万圣节') return 'ws.png';
        if (safeId === 'holiday_winter_solstice' || safeTitle === '冬至') return 'dz.png';
        if (safeId === 'holiday_christmas_eve' || safeTitle === '平安夜') return 'pa.png';
        if (safeId === 'holiday_christmas' || safeTitle === '圣诞节') return 'sd.png';
        if (safeId === 'holiday_new_year_eve' || safeTitle === '除夕') return 'cxj.png';
        return 'hd.png';
    }

    normalizeHolidayHeroIcon(icon, id = '', title = '') {
        const value = String(icon || '').trim();
        const dedicated = new Set(['yd.png', 'hj.png', 'yx.png', 'qr.png', 'yr.png', 'qm.png', 'ld.png', 'dw.png', 'et.png', 'sj.png', 'qx.png', 'zq.png', 'gq.png', 'ws.png', 'dz.png', 'pa.png', 'sd.png', 'cxj.png']);
        if (dedicated.has(value)) return value;

        const safeId = String(id || '').trim();
        const safeTitle = String(title || '').trim();
        if (safeId === 'holiday_new_year' || safeTitle === '元旦') return 'yd.png';
        if (safeId === 'holiday_winter_break' || safeTitle === '寒假') return 'hj.png';
        if (safeId === 'holiday_lantern' || safeTitle === '元宵节') return 'yx.png';
        if (safeId === 'holiday_valentine' || safeTitle === '情人节') return 'qr.png';
        if (safeId === 'holiday_april_fools' || safeTitle === '愚人节') return 'yr.png';
        if (safeId === 'holiday_qingming' || safeTitle === '清明节') return 'qm.png';
        if (safeId === 'holiday_labor' || safeTitle === '劳动节') return 'ld.png';
        if (safeId === 'holiday_dragon_boat' || safeTitle === '端午') return 'dw.png';
        if (safeId === 'holiday_children' || safeTitle === '儿童节') return 'et.png';
        if (safeId === 'holiday_summer_break' || safeTitle === '暑假') return 'sj.png';
        if (safeId === 'holiday_qixi' || safeTitle === '七夕') return 'qx.png';
        if (safeId === 'holiday_mid_autumn' || safeTitle === '中秋') return 'zq.png';
        if (safeId === 'holiday_national' || safeTitle === '国庆节') return 'gq.png';
        if (safeId === 'holiday_halloween' || safeTitle === '万圣节') return 'ws.png';
        if (safeId === 'holiday_winter_solstice' || safeTitle === '冬至') return 'dz.png';
        if (safeId === 'holiday_christmas_eve' || safeTitle === '平安夜') return 'pa.png';
        if (safeId === 'holiday_christmas' || safeTitle === '圣诞节') return 'sd.png';
        if (safeId === 'holiday_new_year_eve' || safeTitle === '除夕') return 'cxj.png';
        return '';
    }

    clearExpiredAutoMemos(currentDateKey) {
        const currentParts = this.parseDateKey(currentDateKey);
        if (!currentParts) return 0;
        const currentSerial = this.dateSerial(currentParts);
        const memos = this.getMemos();
        const before = memos.length;
        this._memos = memos.filter(memo => {
            if (String(memo?.source || '') !== 'auto_schedule') return true;
            if (this.isRecurringMemo(memo)) return true;
            const memoParts = this.parseDateKey(memo?.dateKey);
            if (!memoParts) return true;
            if (this.dateSerial(memoParts) >= currentSerial) return true;
            if (!this.isReminderEnabled()) return false;
            return !this.hasMemoReminderFired(memo, memo.dateKey);
        });
        const removed = before - this._memos.length;
        if (removed > 0) this.saveMemos();
        return removed;
    }

    saveMemos() {
        this.storage?.set?.(this.memoKey, JSON.stringify(this.getMemos()));
    }

    isReminderEnabled() {
        const raw = this.storage?.get?.(this.reminderEnabledKey, false);
        return raw === true || raw === 'true' || raw === 1 || raw === '1';
    }

    setReminderEnabled(enabled) {
        const value = !!enabled;
        this.storage?.set?.(this.reminderEnabledKey, value);
        return value;
    }

    getReminderAdvanceMinutes() {
        const raw = this.storage?.get?.(this.reminderAdvanceMinutesKey, 0);
        const value = Number.parseInt(raw, 10);
        if (!Number.isFinite(value)) return 0;
        return Math.max(0, Math.min(1440, value));
    }

    setReminderAdvanceMinutes(minutes) {
        const value = Number.parseInt(minutes, 10);
        const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(1440, value)) : 0;
        this.storage?.set?.(this.reminderAdvanceMinutesKey, safeValue);
        return safeValue;
    }

    isAutoScheduleEnabled() {
        const raw = this.storage?.get?.(this.autoScheduleEnabledKey, false);
        return raw === true || raw === 'true' || raw === 1 || raw === '1';
    }

    setAutoScheduleEnabled(enabled) {
        const value = !!enabled;
        this.storage?.set?.(this.autoScheduleEnabledKey, value);
        return value;
    }

    hasCurrentOrFutureOrdinaryMemos(currentDateKey) {
        const currentParts = this.parseDateKey(currentDateKey);
        if (!currentParts) return true;
        const currentSerial = this.dateSerial(currentParts);
        return this.getMemos().some(memo => {
            if (this.isRecurringMemo(memo)) return false;
            const memoParts = this.parseDateKey(memo?.dateKey);
            if (!memoParts) return false;
            return this.dateSerial(memoParts) >= currentSerial;
        });
    }

    getTheme() {
        const theme = String(this.storage?.get?.(this.themeKey, 'light') || 'light');
        return theme === 'dark' ? 'dark' : 'light';
    }

    setTheme(theme) {
        const nextTheme = theme === 'dark' ? 'dark' : 'light';
        this.storage?.set?.(this.themeKey, nextTheme);
        return nextTheme;
    }

    normalizeColor(color) {
        const value = String(color || '').trim();
        return ['blue', 'red', 'purple', 'green', 'amber'].includes(value) ? value : 'blue';
    }

    normalizeType(type) {
        const value = String(type || '').trim();
        return ['daily', 'work', 'date', 'birthday', 'anniversary', 'study', 'travel', 'health', 'money', 'event'].includes(value)
            ? value
            : 'daily';
    }

    getDaysInMonth(year, month) {
        if ([1, 3, 5, 7, 8, 10, 12].includes(Number(month))) return 31;
        if ([4, 6, 9, 11].includes(Number(month))) return 30;
        const y = Number(year);
        return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28;
    }

    isValidMonthDay(month, day) {
        const safeMonth = Number(month);
        const safeDay = Number(day);
        if (!Number.isFinite(safeMonth) || !Number.isFinite(safeDay)) return false;
        if (safeMonth < 1 || safeMonth > 12 || safeDay < 1) return false;
        return safeDay <= this.getDaysInMonth(2024, safeMonth);
    }

    isRecurringMemo(memo) {
        return this.isRecurringType(memo?.type);
    }

    isRecurringType(type) {
        const normalized = this.normalizeType(type);
        return normalized === 'birthday' || normalized === 'anniversary';
    }

    isMemoOnDate(memo, dateKey) {
        const memoKey = String(memo?.dateKey || '').trim();
        const targetKey = String(dateKey || '').trim();
        if (!memoKey || !targetKey) return false;
        if (memoKey === targetKey) return true;
        if (!this.isRecurringMemo(memo)) return false;

        const memoParts = this.parseDateKey(memoKey);
        const targetParts = this.parseDateKey(targetKey);
        if (!memoParts || !targetParts || memoParts.day !== targetParts.day) return false;

        const type = this.normalizeType(memo?.type);
        if (type === 'birthday') {
            return memoParts.month === targetParts.month;
        }
        if (type === 'anniversary') {
            return this.dateSerial(targetParts) >= this.dateSerial(memoParts);
        }
        return false;
    }

    getReminderDueMemo(previousTime, currentTime) {
        if (!this.isReminderEnabled()) return null;
        const prev = this.normalizeStoryTime(previousTime);
        const curr = this.normalizeStoryTime(currentTime);
        if (!curr) return null;
        if (prev && prev.dateKey !== curr.dateKey) {
            const prevParts = this.parseDateKey(prev.dateKey);
            const currParts = this.parseDateKey(curr.dateKey);
            if (!prevParts || !currParts || this.dateSerial(currParts) < this.dateSerial(prevParts)) {
                return { skipped: true, reason: 'time_rewind' };
            }
        }

        const currentMinutes = curr.minutes;
        const previousMinutes = prev?.dateKey === curr.dateKey ? prev.minutes : -1;
        if (currentMinutes <= previousMinutes) return null;

        const advanceMinutes = this.getReminderAdvanceMinutes();
        const due = this.getMemosByDate(curr.dateKey)
            .filter(memo => this.isMemoReminderCandidate(memo, curr.dateKey))
            .map(memo => {
                const memoMinutes = this.parseTimeToMinutes(memo.time);
                if (!Number.isFinite(memoMinutes)) return null;
                return {
                    memo,
                    memoMinutes,
                    triggerMinutes: Math.max(0, memoMinutes - advanceMinutes)
                };
            })
            .filter(Boolean)
            .filter(item => item.triggerMinutes > previousMinutes && item.triggerMinutes <= currentMinutes)
            .filter(item => !this.hasMemoReminderFired(item.memo, curr.dateKey))
            .sort((a, b) => b.triggerMinutes - a.triggerMinutes || b.memoMinutes - a.memoMinutes);

        const hit = due[0];
        if (!hit) return null;
        return {
            memo: hit.memo,
            dateKey: curr.dateKey,
            time: this.formatMinutes(hit.memoMinutes),
            triggerTime: this.formatMinutes(hit.triggerMinutes),
            advanceMinutes,
            title: String(hit.memo?.title || '').trim()
        };
    }

    markMemoReminderFired(memoId, dateKey) {
        const memo = this.getMemos().find(item => String(item?.id || '') === String(memoId || ''));
        if (!memo) return false;
        const key = this.getMemoReminderKey(memo, dateKey);
        const list = Array.isArray(memo.remindedKeys) ? memo.remindedKeys : [];
        if (!list.includes(key)) list.push(key);
        memo.remindedKeys = list.slice(-240);
        memo.updatedAt = Date.now();
        this.saveMemos();
        return true;
    }

    isMemoReminderCandidate(memo, dateKey) {
        if (!memo || !this.parseTimeToMinutes(memo.time) && this.parseTimeToMinutes(memo.time) !== 0) return false;
        return this.isMemoOnDate(memo, dateKey);
    }

    hasMemoReminderFired(memo, dateKey) {
        const key = this.getMemoReminderKey(memo, dateKey);
        return Array.isArray(memo?.remindedKeys) && memo.remindedKeys.includes(key);
    }

    getMemoReminderKey(memo, dateKey) {
        return `${String(dateKey || '')}|${String(memo?.time || '').trim()}|${String(memo?.title || '').trim()}`;
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

    dateSerial(dateParts) {
        return (Number(dateParts.year) * 372) + (Number(dateParts.month) * 31) + Number(dateParts.day);
    }

    normalizeStoryTime(timeData) {
        if (!timeData?.date || !timeData?.time) return null;
        const dateMatch = String(timeData.date).match(/(\d{1,6})[-\/年]\s*(\d{1,2})[-\/月]\s*(\d{1,2})\s*日?/);
        if (!dateMatch) return null;
        const minutes = this.parseTimeToMinutes(timeData.time);
        if (!Number.isFinite(minutes)) return null;
        const dateKey = [
            String(dateMatch[1]).padStart(4, '0'),
            String(Number.parseInt(dateMatch[2], 10)).padStart(2, '0'),
            String(Number.parseInt(dateMatch[3], 10)).padStart(2, '0')
        ].join('-');
        return { dateKey, minutes };
    }

    parseTimeToMinutes(timeText) {
        const match = String(timeText || '').match(/^(\d{1,2})\s*[:：]\s*(\d{2})$/);
        if (!match) return NaN;
        const hour = Number.parseInt(match[1], 10);
        const minute = Number.parseInt(match[2], 10);
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return NaN;
        return hour * 60 + minute;
    }

    formatMinutes(totalMinutes) {
        const minutes = Math.max(0, Number(totalMinutes) || 0);
        const hour = Math.floor(minutes / 60) % 24;
        const minute = minutes % 60;
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }

    clearCache() {
        this._memos = null;
        this._holidays = null;
    }
}
