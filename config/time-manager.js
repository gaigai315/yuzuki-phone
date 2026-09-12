/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 * 
 * ⚠️ 版权声明 (Copyright Notice):
 * 1. 禁止商业化：本项目仅供交流学习，严禁任何形式的倒卖、盈利等商业行为。
 * 2. 禁止二改发布：严禁未经授权修改代码后作为独立项目二次发布或分发。
 * 3. 禁止抄袭：严禁盗用本项目的核心逻辑、UI设计与相关原代码。
 * 
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */
// 剧情时间管理器
export class TimeManager {
    constructor(storage) {
        this.storage = storage;
        // 🔥 缓存机制：避免频繁读取 storage 和遍历数据
        this._cache = null;
        this._cacheTimestamp = 0;
        this._cacheTTL = 5000; // 缓存有效期 5 秒
        this._lastStableStoryTime = null;
    }

    /**
     * 🔥 清除缓存（当时间被更新时调用）
     */
    clearCache() {
        this._cache = null;
        this._cacheTimestamp = 0;
    }

    _parseChineseNumber(value) {
        const raw = String(value || '').trim().replace(/^初/, '');
        if (!raw) return NaN;
        if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
        if (raw === '元') return 1;

        const digits = {
            '〇': 0, '零': 0,
            '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
            '五': 5, '六': 6, '七': 7, '八': 8, '九': 9
        };

        if (/^[〇零一二三四五六七八九两]+$/.test(raw)) {
            return Number.parseInt(Array.from(raw).map(char => digits[char]).join(''), 10);
        }

        let total = 0;
        let current = 0;
        for (const char of raw) {
            if (Object.prototype.hasOwnProperty.call(digits, char)) {
                current = digits[char];
                continue;
            }
            if (char === '廿') {
                total += 20;
                current = 0;
                continue;
            }
            if (char === '卅') {
                total += 30;
                current = 0;
                continue;
            }
            const unit = char === '十' ? 10 : char === '百' ? 100 : char === '千' ? 1000 : 0;
            if (!unit) return NaN;
            total += (current || 1) * unit;
            current = 0;
        }
        return total + current;
    }

    _formatChineseNumber(value) {
        const number = Number.parseInt(value, 10);
        if (!Number.isFinite(number) || number <= 0) return String(value || '');
        const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
        if (number < 10) return digits[number];
        if (number < 20) return `十${number % 10 ? digits[number % 10] : ''}`;
        if (number < 100) {
            const tens = Math.floor(number / 10);
            const ones = number % 10;
            return `${digits[tens]}十${ones ? digits[ones] : ''}`;
        }
        return Array.from(String(number)).map(char => digits[Number(char)]).join('');
    }

    _formatAncientDay(value) {
        const day = Number.parseInt(value, 10);
        if (day >= 1 && day <= 10) return `初${this._formatChineseNumber(day)}`;
        if (day >= 21 && day <= 29) return `廿${this._formatChineseNumber(day - 20)}`;
        return this._formatChineseNumber(day);
    }

    _parseStoryDate(dateText, options = {}) {
        const source = String(dateText || '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/[／]/g, '/')
            .trim();
        if (!source) return null;

        const numberToken = '(?:元|[〇零一二三四五六七八九十百千廿卅两]+|\\d{1,6})';
        const monthToken = '(?:正|冬|腊|[〇零一二三四五六七八九十廿卅两]+|\\d{1,2})';
        const dayToken = '(?:初?[〇零一二三四五六七八九十两]+|廿[一二三四五六七八九]?|卅|\\d{1,2})';
        const eraPattern = new RegExp(`([〇\\u3400-\\u9fff\\d]{1,26})年\\s*(${monthToken})月\\s*(${dayToken})日`);
        const eraMatch = source.match(eraPattern);
        const beforeYear = String(eraMatch?.[1] || '');
        const yearSuffixMatch = beforeYear.match(new RegExp(`(${numberToken})$`));
        const eraYearToken = String(yearSuffixMatch?.[1] || '');
        const eraCandidate = eraYearToken ? beforeYear.slice(0, -eraYearToken.length) : '';
        const knownEraPrefix = /^(?:夏|商|周|秦|西汉|东汉|蜀汉|汉|曹魏|孙吴|西晋|东晋|晋|北魏|南梁|北齐|北周|隋|大唐|唐|后梁|后唐|后晋|后汉|后周|辽|金|西夏|北宋|南宋|宋|大元|元|大明|明|大清|清|春秋|战国)/;
        const eraUsesChineseYear = Boolean(eraYearToken) && !/^\d+$/.test(eraYearToken);
        const shouldUseEraMatch = Boolean(eraMatch && eraYearToken)
            && (
                options.preferAncient === true
                || (options.allowUnknownEra === true && Boolean(eraCandidate))
                || eraUsesChineseYear
                || knownEraPrefix.test(eraCandidate)
            );

        let fullMatch = null;
        let era = '';
        let yearToken = '';
        let monthTokenValue = '';
        let dayTokenValue = '';

        if (shouldUseEraMatch) {
            fullMatch = eraMatch[0];
            era = eraCandidate;
            yearToken = eraYearToken;
            monthTokenValue = eraMatch[2];
            dayTokenValue = eraMatch[3];
        } else {
            // 现代日期统一兼容：YYYY年MM月DD日、YYYY年|MM月|DD日、
            // YYYY年-MM月-DD日、YYYY年/MM月/DD日、YYYY-MM-DD、YYYY/MM/DD。
            const yearSeparator = '(?:[-/]\\s*|年\\s*(?:[|\\-/]\\s*)?)';
            const monthSeparator = '(?:[-/]\\s*|月\\s*(?:[|\\-/]\\s*)?)';
            const genericPattern = new RegExp(`(${numberToken})${yearSeparator}(${monthToken})${monthSeparator}(${dayToken})\\s*日?`);
            const genericMatch = source.match(genericPattern);
            if (!genericMatch) return null;
            [fullMatch, yearToken, monthTokenValue, dayTokenValue] = genericMatch;
        }

        const month = monthTokenValue === '正'
            ? 1
            : monthTokenValue === '冬'
                ? 11
                : monthTokenValue === '腊'
                    ? 12
                    : this._parseChineseNumber(monthTokenValue);
        const year = this._parseChineseNumber(yearToken);
        const day = this._parseChineseNumber(dayTokenValue);
        if (![year, month, day].every(Number.isFinite) || month < 1 || month > 12 || day < 1 || day > 31) {
            return null;
        }

        const usesChineseNumerals = !/^\d+$/.test(yearToken)
            || !/^\d+$/.test(monthTokenValue)
            || !/^\d+$/.test(dayTokenValue);
        const isAncient = Boolean(era) || usesChineseNumerals;
        const displayDate = isAncient
            ? String(fullMatch).replace(/\s+/g, '')
            : `${yearToken}年${String(month).padStart(2, '0')}月${String(day).padStart(2, '0')}日`;

        return {
            year,
            month,
            day,
            era: String(era || '').replace(/\s+/g, ''),
            isAncient,
            matchedText: String(fullMatch),
            displayDate,
            calendarDate: `${year}年${String(month).padStart(2, '0')}月${String(day).padStart(2, '0')}日`,
            yearToken,
            monthToken: monthTokenValue,
            dayToken: dayTokenValue,
            yearUsesDigits: /^\d+$/.test(yearToken),
            monthUsesDigits: /^\d+$/.test(monthTokenValue),
            dayUsesDigits: /^\d+$/.test(dayTokenValue)
        };
    }

    _formatStoryDate(parsedDate, year, month, day) {
        if (!parsedDate?.isAncient) {
            return `${year}年${String(month).padStart(2, '0')}月${String(day).padStart(2, '0')}日`;
        }

        const yearText = year === parsedDate.year
            ? parsedDate.yearToken
            : parsedDate.yearUsesDigits ? String(year) : this._formatChineseNumber(year);
        const monthText = month === parsedDate.month
            ? parsedDate.monthToken
            : parsedDate.monthUsesDigits ? String(month).padStart(2, '0') : this._formatChineseNumber(month);
        const dayText = day === parsedDate.day
            ? parsedDate.dayToken
            : parsedDate.dayUsesDigits ? String(day).padStart(2, '0') : this._formatAncientDay(day);
        return `${parsedDate.era || ''}${yearText}年${monthText}月${dayText}日`;
    }

    _createStoryTimestamp(year, month, day, hour, minute) {
        const date = new Date(0);
        date.setFullYear(Number(year), Number(month) - 1, Number(day));
        date.setHours(Number(hour), Number(minute), 0, 0);
        return date.getTime();
    }

    isAncientTimeData(timeData) {
        if (timeData?.isAncient === true) return true;
        return this._parseStoryDate(timeData?.date, { allowUnknownEra: true })?.isAncient === true;
    }

    _getEraKey(timeData) {
        const parsedDate = this._parseStoryDate(timeData?.date, { allowUnknownEra: true });
        if (timeData?.isAncient !== true && !parsedDate?.isAncient) return 'modern';
        return `ancient:${String(timeData?.era || parsedDate?.era || 'unknown').trim()}`;
    }

    _isSameStoryEra(left, right) {
        if (!left || !right) return true;
        const leftAncient = this.isAncientTimeData(left);
        const rightAncient = this.isAncientTimeData(right);
        if (leftAncient !== rightAncient) return false;
        if (!leftAncient) return true;

        const leftKey = this._getEraKey(left);
        const rightKey = this._getEraKey(right);
        return leftKey.endsWith(':unknown') || rightKey.endsWith(':unknown') || leftKey === rightKey;
    }

    _getRecentManualSyncTime() {
        try {
            const saved = this.storage.get('story-current-time', true);
            if (!saved) return null;

            const data = JSON.parse(saved);
            if (!data.time || !data.date) return null;

            const parsedDate = this._parseStoryDate(data.date, { allowUnknownEra: true });
            const isAncient = data.isAncient === true || parsedDate?.isAncient === true;

            return {
                ...data,
                time: data.time,
                date: data.date,
                weekday: isAncient ? '' : (data.weekday || this.calculateWeekday(data.date)),
                timestamp: this.parseTimeToTimestamp(data),
                isAncient,
                era: data.era || parsedDate?.era || '',
                calendarDate: data.calendarDate || parsedDate?.calendarDate || data.date,
                source: data.source || 'story-current'
            };
        } catch (e) {
            console.warn('⚠️ 读取手动同步时间失败:', e);
            return null;
        }
    }

    _rememberStableStoryTime(timeData) {
        if (!timeData?.time || !timeData?.date) return timeData;
        this._lastStableStoryTime = {
            ...timeData,
            isReal: false
        };
        return timeData;
    }

    _isStorageToggleEnabled(key, defaultValue = true) {
        try {
            const raw = this.storage?.get?.(key);
            if (raw === undefined || raw === null) return defaultValue;
            return raw !== false && raw !== 'false';
        } catch (e) {
            console.warn(`⚠️ 读取开关 ${key} 失败:`, e);
            return defaultValue;
        }
    }

    isOfflineTimeSourceEnabled() {
        return this._isStorageToggleEnabled('offline-wechat-prompt-enabled', true)
            || this._isStorageToggleEnabled('offline-single-chat-enabled', true)
            || this._isStorageToggleEnabled('offline-group-chat-enabled', true)
            || this._isStorageToggleEnabled('offline-moments-history-enabled', false)
            || this._isStorageToggleEnabled('offline-honey-chat-enabled', false)
            || this._isStorageToggleEnabled('offline-phone-call-history-enabled', false)
            || this._isStorageToggleEnabled('offline-weibo-history-enabled', false)
            || this._isStorageToggleEnabled('offline-diary-history-enabled', false);
    }

    _isLikelyRealClockPollution(candidate, references = []) {
        if (!candidate?.date || !candidate?.time || !references.length) return false;

        const candidateTs = this.parseTimeToTimestamp(candidate);
        if (!Number.isFinite(candidateTs)) return false;

        const now = new Date();
        const realTodayTs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const candidateDate = new Date(candidateTs);
        const candidateDateTs = new Date(candidateDate.getFullYear(), candidateDate.getMonth(), candidateDate.getDate()).getTime();
        const candidateNearRealToday = Math.abs(candidateDateTs - realTodayTs) <= 2 * 24 * 60 * 60 * 1000;
        if (!candidateNearRealToday) return false;

        return references.some(ref => {
            const refTs = this.parseTimeToTimestamp(ref);
            if (!Number.isFinite(refTs)) return false;
            const diffDays = Math.abs(candidateTs - refTs) / (1000 * 60 * 60 * 24);
            return diffDays > 30;
        });
    }

    /**
     * 🔥 完全重置时间（清除缓存 + 清除 manual-sync 存储）
     * 用于删除消息后重新计算最新时间
     */
    resetTime() {
        console.log('🔥 [TimeManager] resetTime() 被调用，正在清除缓存和存储...');
        this._cache = null;
        this._cacheTimestamp = 0;
        // 🔥 清除 manual-sync 存储，让系统重新从消息中计算时间
        try {
            this.storage?.remove?.('story-current-time');
            console.log('✅ [TimeManager] story-current-time 已从存储中删除');
        } catch (e) {
            console.warn('⚠️ 清除 story-current-time 失败:', e);
        }
    }

    /**
     * 🎯 核心方法：获取当前剧情时间
     * @returns {Object} { time: "14:30", date: "2044年10月28日", weekday: "星期三", timestamp: 1730102400000 }
     */
    getCurrentStoryTime() {
    // 🔥 检查缓存是否有效
    const now = Date.now();
    if (this._cache && (now - this._cacheTimestamp) < this._cacheTTL) {
        return this._cache;
    }

    const context = this.getContext();
    const manualSyncTime = this._getRecentManualSyncTime();

    // 🔹 情况1：上下文短暂不可用时，优先保留当前聊天的剧情时间，避免状态栏跳回现实时间
    if (!context || context.characterId === undefined || context.characterId === null || context.characterId === '') {
        if (manualSyncTime) {
            this._cache = this._rememberStableStoryTime(manualSyncTime);
            this._cacheTimestamp = now;
            return this._cache;
        }
        if (this._lastStableStoryTime) {
            this._cache = this._lastStableStoryTime;
            this._cacheTimestamp = now;
            return this._cache;
        }
        return this.getRealTime();
    }

    const offlineTimeSourceEnabled = this.isOfflineTimeSourceEnabled();

    // 来源1：正文聊天记录时间。线下注入全部关闭时，用户通常只使用线上功能，此时不读正文时间。
    const timeFromChat = offlineTimeSourceEnabled ? this.extractTimeFromChat(context) : null;
    const timeFromPhone = this.getPhoneLastMessageTime(timeFromChat || manualSyncTime);

    // 🔥 收集所有时间源。正文/持久剧情时间是权威源，手机消息只用于没有权威源时兜底。
    const authoritativeCandidates = [];

    // 来源2：已保存的剧情时间。若旧数据明显偏离最新正文时间，按旧污染数据处理。
    if (manualSyncTime) {
        let shouldUseSavedTime = true;
        if (!offlineTimeSourceEnabled && timeFromPhone && manualSyncTime.source !== 'manual-sync') {
            shouldUseSavedTime = false;
        }
        if (timeFromChat) {
            if (!this._isSameStoryEra(manualSyncTime, timeFromChat)) {
                shouldUseSavedTime = false;
            } else if (manualSyncTime.source !== 'manual-sync') {
                const savedTs = this.parseTimeToTimestamp(manualSyncTime);
                const chatTs = this.parseTimeToTimestamp(timeFromChat);
                const diffDays = Math.abs(savedTs - chatTs) / (1000 * 60 * 60 * 24);
                shouldUseSavedTime = Number.isFinite(diffDays) && diffDays <= 7;
            }
        }
        if (shouldUseSavedTime) {
            authoritativeCandidates.push(manualSyncTime);
        }
    }

    if (timeFromChat) {
        authoritativeCandidates.push({
            ...timeFromChat,
            source: timeFromChat.source || 'chat'
        });
    }

    const candidates = [...authoritativeCandidates];

    // 来源3：手机线上消息时间。正常参与“取最晚”，允许线上聊天把剧情时间推到正文之后。
    // 只过滤一种情况：候选时间接近现实今天，且和正文/保存剧情时间相差很远，通常是旧版本现实时间戳污染。
    const eraReference = timeFromChat || authoritativeCandidates[0] || null;
    const phoneTimeHasMatchingEra = !eraReference || this._isSameStoryEra(timeFromPhone, eraReference);
    const phoneTimeLooksPolluted = this._isLikelyRealClockPollution(timeFromPhone, authoritativeCandidates);
    if (timeFromPhone && phoneTimeHasMatchingEra && !phoneTimeLooksPolluted) {
        candidates.push(timeFromPhone);
    }

    // 🔥 从所有候选中取时间戳最大的（时间只进不退）
    if (candidates.length > 0) {
        // 确保每个候选都有可比较的时间戳
        candidates.forEach(c => {
            if (!c._ts) {
                c._ts = this.parseTimeToTimestamp(c);
            }
        });
        candidates.sort((a, b) => (b._ts || 0) - (a._ts || 0));
        const best = candidates[0];
        const result = {
            ...best,
            weekday: this.isAncientTimeData(best) ? '' : best.weekday,
            timestamp: best._ts || best.timestamp,
            source: best.source || 'merged'
        };
        delete result._ts;
        this._cache = this._rememberStableStoryTime(result);
        this._cacheTimestamp = now;
        return this._cache;
    }

    // 🔹 情况4：使用剧情初始时间（智能加载联系人时生成）
    const storyInitialTime = this.getStoryInitialTime();
    if (storyInitialTime) {
        this._cache = this._rememberStableStoryTime(storyInitialTime);
        this._cacheTimestamp = now;
        return storyInitialTime;
    }

    // 🔹 情况5：智能推断时间
    const inferredTime = this.inferTimeFromLore(context);
    if (inferredTime) {
        this._cache = this._rememberStableStoryTime(inferredTime);
        this._cacheTimestamp = now;
        return inferredTime;
    }

    // 🔹 情况6：默认时间
    const defaultTime = this.getDefaultStoryTime();
    this._cache = defaultTime;
    this._cacheTimestamp = now;
    return defaultTime;
}
    
    /**
     * 🔍 从聊天记录提取时间（优先级最高）
     */
    extractTimeFromChat(context) {
        if (!context.chat || context.chat.length === 0) {
            return null;
        }
        
        // 从最后一条AI消息的状态栏提取
        for (let i = context.chat.length - 1; i >= 0; i--) {
            const msg = context.chat[i];
            if (!msg.is_user && msg.mes) {
                const statusbarTime = this.parseStatusbar(msg.mes);
                if (statusbarTime) {
                    return statusbarTime;
                }
            }
        }
        
        return null;
    }
    
    /**
     * 🔍 解析状态栏时间（万能智能提取）
     * 支持格式：
     * - <statusbar>全局时间：2044年10月28日·晚上·星期一·21:30</statusbar>
     * - <globalTime>2832年09月12日·🍂·星期一·17:00·🌤️</globalTime>
     * - <globalTime>T_story：大明永乐十二年九月初八日·🍂·辰时(07:30)·晴天·18°C</globalTime>
     * - <time>2044年06月11日·🍦·星期三·14:30</time>
     * - 无标签正文：417年11月7日|星期三|21:28
     * - 无标签正文：417/11/7 21:28
     * - 无标签或标签正文：2021年|01月|01日|14:30|星期二
     * - 无标签或标签正文：2021年-01月-01日-14:30-星期二
     * - 无标签或标签正文：2021年/01月/01日/14:30/星期二
     */
    parseStatusbar(text) {
        const rawText = String(text || '');

        // 1. 优先匹配时间包裹标签；如果没有标签，则直接从正文全文提取
        const tagMatch = rawText.match(/<(statusbar|globalTime|time|horae)>([\s\S]*?)<\/\1>/i);
        const baseContent = tagMatch ? tagMatch[2] : rawText;
        const content = String(baseContent)
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/｜/g, '|')
            .replace(/／/g, '/');

        // 2. 日期既支持现代公历，也支持“大明永乐十二年九月初八日”一类古代纪年。
        const hourBranchMatch = content.match(/(子|丑|寅|卯|辰|巳|午|未|申|酉|戌|亥)[时時](?:\s*[（(]\s*([01]?\d|2[0-3])\s*[:：时]\s*([0-5]?\d)(?:\s*分)?\s*[)）])?/);
        const parsedDate = this._parseStoryDate(content, { preferAncient: Boolean(hourBranchMatch) });
        if (!parsedDate) return null;

        const dateToken = parsedDate.matchedText || '';
        const dateIndex = dateToken ? content.indexOf(dateToken) : -1;
        const afterDateContent = dateIndex >= 0 ? content.slice(dateIndex + dateToken.length) : content;
        const standardTimeMatch = afterDateContent.match(/([01]?\d|2[0-3])\s*[:：时]\s*([0-5]?\d)(?:\s*分)?/);
        const compactTimeMatch = standardTimeMatch
            ? null
            : afterDateContent.match(/(?:^|[^\d])([01]?\d|2[0-3])([0-5]\d)(?:$|[^\d])/);

        const branchMidpoint = {
            子: '00:00', 丑: '02:00', 寅: '04:00', 卯: '06:00',
            辰: '08:00', 巳: '10:00', 午: '12:00', 未: '14:00',
            申: '16:00', 酉: '18:00', 戌: '20:00', 亥: '22:00'
        };
        const inferredBranchTime = hourBranchMatch ? branchMidpoint[hourBranchMatch[1]] : '';
        const hourValue = hourBranchMatch?.[2]
            ?? standardTimeMatch?.[1]
            ?? compactTimeMatch?.[1]
            ?? (inferredBranchTime ? inferredBranchTime.split(':')[0] : null);
        const minuteValue = hourBranchMatch?.[3]
            ?? standardTimeMatch?.[2]
            ?? compactTimeMatch?.[2]
            ?? (inferredBranchTime ? inferredBranchTime.split(':')[1] : null);
        if (hourValue === null || minuteValue === null) return null;

        const isAncient = parsedDate.isAncient || Boolean(hourBranchMatch);
        const hour = String(Number.parseInt(hourValue, 10)).padStart(2, '0');
        const minute = String(Number.parseInt(minuteValue, 10)).padStart(2, '0');
        const weekdayMatch = content.match(/(星期[一二三四五六日天]|周[一二三四五六日天])/);
        let weekday = '';
        if (!isAncient) {
            if (weekdayMatch) {
                weekday = weekdayMatch[1].replace('周', '星期');
                if (weekday === '星期天') weekday = '星期日';
            } else {
                weekday = this.calculateWeekdayFromDate(parsedDate.year, parsedDate.month, parsedDate.day);
            }
        }

        return {
            time: `${hour}:${minute}`,
            date: parsedDate.displayDate,
            weekday,
            timestamp: this._createStoryTimestamp(parsedDate.year, parsedDate.month, parsedDate.day, hour, minute),
            year: String(parsedDate.year),
            month: String(parsedDate.month).padStart(2, '0'),
            day: String(parsedDate.day).padStart(2, '0'),
            hour,
            minute,
            isAncient,
            era: parsedDate.era,
            calendarDate: parsedDate.calendarDate,
            traditionalTime: hourBranchMatch ? `${hourBranchMatch[1]}时` : ''
        };

    }

    /**
 * 🆕 获取剧情初始时间（从智能加载联系人时生成）
 */
getStoryInitialTime() {
    try {
        const saved = this.storage.get('story-initial-time', true);
        if (saved) {
            const data = JSON.parse(saved);
            if (!data.date || !data.time) return null;
            const parsedDate = this._parseStoryDate(data.date, { allowUnknownEra: true });
            const isAncient = data.isAncient === true || parsedDate?.isAncient === true;
            return {
                ...data,
                time: data.time,
                date: data.date,
                weekday: isAncient ? '' : data.weekday,
                timestamp: this.parseTimeToTimestamp(data),
                isAncient,
                era: data.era || parsedDate?.era || '',
                calendarDate: data.calendarDate || parsedDate?.calendarDate || data.date,
                isStoryInitial: true
            };
        }
    } catch (e) {
        console.warn('⚠️ 获取剧情初始时间失败:', e);
    }
    return null;
}

/**
 * 🔧 辅助方法：将时间字符串转为时间戳
 */
parseTimeToTimestamp(timeData) {
    try {
        if (!timeData?.date || !timeData?.time) return Date.now();
        const dateParts = this._parseStoryDate(timeData.date, { allowUnknownEra: true });
        const timeParts = timeData.time.match(/(\d{1,2})[:：](\d{2})/);
        
        if (dateParts && timeParts) {
            const year = dateParts.year;
            const month = dateParts.month;
            const day = dateParts.day;
            const hour = parseInt(timeParts[1]);
            const minute = parseInt(timeParts[2]);

            return this._createStoryTimestamp(year, month, day, hour, minute);
        }
    } catch (e) {
        console.warn('⚠️ 时间戳解析失败:', e);
    }
    return Date.now();
}
    
    /**
     * 🧠 从世界书/角色卡智能推断时间
     */
    inferTimeFromLore(context) {
        let inferredYear = null;
        let inferredDate = null;

        // 方法1：从Gaigai表格提取（如果存在）
        if (window.Gaigai?.m?.s) {
            const sections = window.Gaigai.m.s;
            sections.forEach(section => {
                if (section.n === '主线剧情' && section.r?.[0]) {
                    const firstRow = section.r[0];
                    const dateStr = firstRow['0'] || firstRow[0]; // 日期字段
                    if (dateStr) {
                        const match = dateStr.match(/(\d{1,6})[-\/年]\s*(\d{1,2})[-\/月]\s*(\d{1,2})\s*日?/);
                        if (match) {
                            inferredYear = match[1];
                            inferredDate = { month: match[2], day: match[3] };
                        }
                    }
                }
            });
        }

        // 方法2：从世界书提取
        if (!inferredYear && context.characters && context.characterId !== undefined) {
            const char = context.characters[context.characterId];
            if (char?.data?.character_book?.entries) {
                char.data.character_book.entries.forEach(entry => {
                    if (!inferredYear) {
                        // 匹配：剧情时间起点:2044年
                        const yearMatch = entry.content?.match(/(?:剧情时间|时代|年份|时间起点)[：:]\s*(\d{1,6})[-\/年]/);
                        if (yearMatch) {
                            inferredYear = yearMatch[1];
                        }
                    }
                });
            }
        }
        
        // 构建时间对象
        if (inferredYear) {
            const now = new Date();
            const month = inferredDate ? parseInt(inferredDate.month) : (now.getMonth() + 1);
            const day = inferredDate ? parseInt(inferredDate.day) : now.getDate();
            
            const date = new Date(inferredYear, month - 1, day, 9, 0); // 默认早上9点
            
            const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
            
            return {
                time: '09:00',
                date: `${inferredYear}年${month}月${day}日`,
                weekday: weekdays[date.getDay()],
                timestamp: date.getTime(),
                inferred: true
            };
        }
        
        return null;
    }
    
    /**
     * 🕐 获取现实时间
     */
    getRealTime() {
        const now = new Date();
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        
        return {
            time: this.formatTime(now),
            date: this.formatDate(now),
            weekday: weekdays[now.getDay()],
            timestamp: now.getTime(),
            isReal: true
        };
    }
    
    /**
     * 🎲 获取默认剧情时间（当所有方法都失败时）
     */
    getDefaultStoryTime() {
        const now = new Date();
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        
        return {
            time: '09:00',
            date: this.formatDate(now),
            weekday: weekdays[now.getDay()],
            timestamp: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0).getTime(),
            isDefault: true
        };
    }
    
    /**
     * 🔧 辅助方法：格式化时间
     */
    formatTime(date) {
        const hour = date.getHours().toString().padStart(2, '0');
        const minute = date.getMinutes().toString().padStart(2, '0');
        return `${hour}:${minute}`;
    }
    
    formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}年${month}月${day}日`;
    }

    /**
 * 🔥 新增：从手机微信获取最后一条消息的时间
 */
getPhoneLastMessageTime(referenceTime = null) {
    try {
        // 🔥 优先从内存中的 wechatData 读取（更准确、更实时）
        const wechatData = window.VirtualPhone?.wechatApp?.wechatData;
        if (!wechatData) return null;

        // 🔥 遍历所有聊天，找到最新的消息时间
        let latestTime = null;
        let latestTimestamp = Number.NEGATIVE_INFINITY;

        const chatList = wechatData.getChatList?.() || [];

        for (const chat of chatList) {
            const chatMessages = wechatData.getMessages?.(chat.id) || [];
            if (chatMessages.length > 0) {
                const lastMsg = chatMessages[chatMessages.length - 1];

                if (lastMsg.time && (lastMsg.date || lastMsg.timestamp)) {
                    const messageDate = lastMsg.date || this.formatDate(new Date(lastMsg.timestamp));
                    const parsedDate = this._parseStoryDate(messageDate, { allowUnknownEra: true });
                    const candidate = {
                        time: lastMsg.time,
                        date: messageDate,
                        weekday: parsedDate?.isAncient ? '' : (lastMsg.weekday || this.getWeekday(new Date(lastMsg.timestamp))),
                        isAncient: parsedDate?.isAncient === true,
                        era: parsedDate?.era || '',
                        calendarDate: parsedDate?.calendarDate || messageDate
                    };
                    if (referenceTime && !this._isSameStoryEra(candidate, referenceTime)) continue;

                    const candidateTimestamp = parsedDate
                        ? this.parseTimeToTimestamp(candidate)
                        : Number(lastMsg.timestamp);
                    if (Number.isFinite(candidateTimestamp) && candidateTimestamp > latestTimestamp) {
                        latestTimestamp = candidateTimestamp;
                        latestTime = {
                            ...candidate,
                            timestamp: candidateTimestamp,
                            source: 'phone'
                        };
                    }
                }
            }
        }

        return latestTime;

    } catch (e) {
        console.warn('⚠️ 获取手机最后消息时间失败:', e);
        return null;
    }
}

/**
 * 🔧 辅助方法：获取星期几（从Date对象）
 */
getWeekday(date) {
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return weekdays[date.getDay()];
}

/**
 * 🔥 微信消息时间步进策略（字数分段 + 轻随机）
 * 目标：AI 一次性多条消息时，既避免时间僵硬，也避免跳太快。
 * @param {string} content - 消息文本
 * @param {Object} options - 预留参数
 * @returns {number} 要推进的分钟数
 */
getWechatMessageMinutesToAdd(content = '', options = {}) {
    const text = String(content || '').trim();
    const length = text.length;
    const rand = Math.random();

    // 很短句（嗯/好/收到）大多数不推进，少量推进 1 分钟
    if (length <= 6) return rand < 0.8 ? 0 : 1;

    // 短句：0/1 随机
    if (length <= 14) return rand < 0.55 ? 0 : 1;

    // 中句：多数推进 1，少量推进 2
    if (length <= 30) return rand < 0.8 ? 1 : 2;

    // 长句：1/2 随机，更偏向 2
    if (length <= 60) return rand < 0.35 ? 1 : 2;

    // 超长句：2/3 随机，更偏向 2，避免一下跳太猛
    return rand < 0.75 ? 2 : 3;
}

/**
 * 🔥 精准时间推算：在给定时间基础上加减分钟数（自动处理跨天/跨月/跨年）
 * @param {Object} timeData - { time: "HH:MM", date: "YYYY年MM月DD日" }
 * @param {number} minutesToAdd - 要增加的分钟数
 * @returns {Object} { time, date, weekday, timestamp }
 */
addMinutesToStoryTime(timeData, minutesToAdd) {
    try {
        const dateParts = this._parseStoryDate(timeData.date, { allowUnknownEra: true });
        const timeParts = timeData.time.match(/(\d{1,2})[:：](\d{2})/);

        if (!dateParts || !timeParts) {
            console.warn('⚠️ addMinutesToStoryTime: 无法解析时间数据', timeData);
            return {
                ...timeData,
                weekday: this.isAncientTimeData(timeData) ? '' : (timeData.weekday || '星期一'),
                timestamp: this.parseTimeToTimestamp(timeData)
            };
        }

        const year = dateParts.year;
        const month = dateParts.month;
        const day = dateParts.day;
        const hour = parseInt(timeParts[1]);
        const minute = parseInt(timeParts[2]);

        // JS 原生 Date 自动处理跨天、跨月、跨年进位
        const dateObj = new Date(this._createStoryTimestamp(year, month, day, hour, minute));
        dateObj.setMinutes(dateObj.getMinutes() + minutesToAdd);

        const newYear = dateObj.getFullYear();
        const newMonth = dateObj.getMonth() + 1;
        const newDay = dateObj.getDate();
        const newHour = dateObj.getHours();
        const newMinute = dateObj.getMinutes();

        // 🔥 修复点 2：根据天数差值推算星期，防止 AI 幻觉和真实日历冲突
        let weekday = dateParts.isAncient ? '' : timeData.weekday;

        // 计算真实过去的天数
        const oldDateOnly = this._createStoryTimestamp(year, month, day, 0, 0);
        const newDateOnly = this._createStoryTimestamp(newYear, newMonth, newDay, 0, 0);
        const dayDiff = Math.round((newDateOnly - oldDateOnly) / (1000 * 60 * 60 * 24));

        // 只有真的跨天了，才顺延星期
        if (dayDiff !== 0 && weekday) {
            const weekdays =['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
            let currentIndex = weekdays.indexOf(weekday);

            // 兼容AI可能发出的奇怪写法
            if (currentIndex === -1) {
                if (weekday === '星期天' || weekday === '周日') currentIndex = 0;
                else if (weekday === '周一') currentIndex = 1;
                else if (weekday === '周二') currentIndex = 2;
                else if (weekday === '周三') currentIndex = 3;
                else if (weekday === '周四') currentIndex = 4;
                else if (weekday === '周五') currentIndex = 5;
                else if (weekday === '周六') currentIndex = 6;
            }

            if (currentIndex !== -1) {
                // 基于旧星期，往后推算 N 天
                const newIndex = ((currentIndex + dayDiff) % 7 + 7) % 7;
                weekday = weekdays[newIndex];
            } else {
                // 实在认不出来，再用数学公式兜底
                weekday = this.calculateWeekdayFromDate(newYear, newMonth, newDay);
            }
        }

        return {
            time: `${String(newHour).padStart(2, '0')}:${String(newMinute).padStart(2, '0')}`,
            date: this._formatStoryDate(dateParts, newYear, newMonth, newDay),
            weekday: weekday,
            timestamp: dateObj.getTime(),
            isAncient: dateParts.isAncient,
            era: dateParts.era,
            calendarDate: `${newYear}年${String(newMonth).padStart(2, '0')}月${String(newDay).padStart(2, '0')}日`
        };
    } catch (e) {
        console.error('❌ addMinutesToStoryTime 失败:', e);
        return {
            ...timeData,
            weekday: this.isAncientTimeData(timeData) ? '' : (timeData.weekday || '星期一'),
            timestamp: this.parseTimeToTimestamp(timeData)
        };
    }
}

/**
 * 🔥 使用蔡勒公式计算星期几（支持任意年份，包括远未来）
 * @param {number} year - 年份
 * @param {number} month - 月份 (1-12)
 * @param {number} day - 日期
 * @returns {string} 星期几
 */
calculateWeekdayFromDate(year, month, day) {
    // 蔡勒公式：对于格里高利历
    // 1月和2月要当作上一年的13月和14月处理
    let y = year;
    let m = month;

    if (m < 3) {
        m += 12;
        y -= 1;
    }

    const q = day;
    const k = y % 100;
    const j = Math.floor(y / 100);

    // 蔡勒公式
    let h = (q + Math.floor((13 * (m + 1)) / 5) + k + Math.floor(k / 4) + Math.floor(j / 4) - 2 * j) % 7;

    // 确保结果为正数
    h = ((h % 7) + 7) % 7;

    // h: 0=周六, 1=周日, 2=周一, 3=周二, 4=周三, 5=周四, 6=周五
    const weekdays = ['星期六', '星期日', '星期一', '星期二', '星期三', '星期四', '星期五'];
    return weekdays[h];
}

/**
 * 🔥 设置当前剧情时间（由微信消息触发更新）
 * @param {string} time - 时间，格式 "HH:MM"
 * @param {string} date - 日期，格式 "YYYY年MM月DD日"
 * @param {string} weekday - 星期，如 "星期一"（可选，不传则自动计算）
 * @param {Object} options - 额外选项；force=true 时跳过手机最后消息时分纠偏
 */
setTime(time, date, weekday = null, options = {}) {
    try {
        // 🔥 清除缓存，确保下次获取时间时重新计算
        this.clearCache();

        let finalTime = time;
        const finalDate = date;
        const parsedDate = this._parseStoryDate(finalDate, { allowUnknownEra: true });
        const isAncient = options?.isAncient === true || parsedDate?.isAncient === true;
        const finalWeekday = isAncient ? '' : (weekday || this.calculateWeekday(date));
        const force = options?.force === true;

        // 🔥 和手机聊天记录的最后时间比较，取更晚的
        const phoneLastTime = this.getPhoneLastMessageTime({
            time,
            date: finalDate,
            weekday: finalWeekday,
            isAncient,
            era: options?.era || parsedDate?.era || ''
        });
        if (!force && phoneLastTime && phoneLastTime.time) {
            const [syncHour, syncMin] = time.split(':').map(Number);
            const [phoneHour, phoneMin] = phoneLastTime.time.split(':').map(Number);

            const syncMinutes = syncHour * 60 + syncMin;
            const phoneMinutes = phoneHour * 60 + phoneMin;

            if (phoneMinutes > syncMinutes) {
                finalTime = phoneLastTime.time;
            }
        }

        const timeData = {
            time: finalTime,
            date: finalDate,
            weekday: finalWeekday,
            isAncient,
            era: options?.era || parsedDate?.era || '',
            calendarDate: options?.calendarDate || parsedDate?.calendarDate || finalDate,
            source: options?.source || (force ? 'manual-sync' : 'story-current')
        };
        timeData.timestamp = this.parseTimeToTimestamp(timeData);

        this._rememberStableStoryTime(timeData);

        this.storage.set('story-current-time', JSON.stringify(timeData), true);

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('phone:timeUpdated', {
                detail: {
                    time: finalTime,
                    date: finalDate,
                    weekday: finalWeekday,
                    isAncient,
                    era: timeData.era,
                    source: timeData.source
                }
            }));
        }

        return true;
    } catch (e) {
        console.error('❌ [TimeManager] 设置时间失败:', e);
        return false;
    }
}

/**
 * 🔧 计算星期几（从日期字符串）
 */
calculateWeekday(dateStr) {
    try {
        const parsedDate = this._parseStoryDate(dateStr, { allowUnknownEra: true });
        if (parsedDate?.isAncient) return '';
        if (parsedDate) {
            return this.calculateWeekdayFromDate(parsedDate.year, parsedDate.month, parsedDate.day);
        }
    } catch (e) {
        console.warn('⚠️ 计算星期失败:', e);
    }
    return '星期一';
}

/**
 * 🔥 获取当前时间（优先读取手动设置的时间）
 */
getCurrentTime() {
    try {
        // 优先读取手动设置的时间
        const saved = this.storage.get('story-current-time', true);
        if (saved) {
            const data = JSON.parse(saved);
            const parsedDate = this._parseStoryDate(data.date, { allowUnknownEra: true });
            const isAncient = data.isAncient === true || parsedDate?.isAncient === true;
            return {
                ...data,
                weekday: isAncient ? '' : data.weekday,
                isAncient,
                era: data.era || parsedDate?.era || '',
                calendarDate: data.calendarDate || parsedDate?.calendarDate || data.date,
                timestamp: this.parseTimeToTimestamp(data)
            };
        }
    } catch (e) {
        console.warn('⚠️ 获取当前时间失败:', e);
    }

    // 降级到剧情时间
    return this.getCurrentStoryTime();
}

    getContext() {
        return (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) 
            ? SillyTavern.getContext() 
            : null;
    }
}
