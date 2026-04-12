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
    }

    /**
     * 🔥 清除缓存（当时间被更新时调用）
     */
    clearCache() {
        this._cache = null;
        this._cacheTimestamp = 0;
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

    // 🔹 情况1：未选择角色，返回现实时间（不缓存，因为是实时的）
    if (!context || !context.characterId) {
        return this.getRealTime();
    }

    // 🔥 收集所有时间源，最终取最晚的（时间只进不退）
    const candidates = [];

    // 来源1：manual-sync（通过 setTime 设置的）
    try {
        const saved = this.storage.get('story-current-time', true);
        if (saved) {
            const data = JSON.parse(saved);
            const isRecent = (Date.now() - data.timestamp) < 30 * 60 * 1000;
            if (isRecent && data.time && data.date && data.weekday) {
                candidates.push({
                    time: data.time,
                    date: data.date,
                    weekday: data.weekday,
                    timestamp: data.timestamp,
                    source: 'manual-sync'
                });
            }
        }
    } catch (e) {
        console.warn('⚠️ 读取手动同步时间失败:', e);
    }

    // 来源2：手机微信最后消息时间
    const timeFromPhone = this.getPhoneLastMessageTime();
    if (timeFromPhone) {
        candidates.push(timeFromPhone);
    }

    // 来源3：正文聊天记录时间
    const timeFromChat = this.extractTimeFromChat(context);
    if (timeFromChat) {
        candidates.push(timeFromChat);
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
            time: best.time,
            date: best.date,
            weekday: best.weekday,
            timestamp: best._ts || best.timestamp,
            source: best.source || 'merged'
        };
        delete result._ts;
        this._cache = result;
        this._cacheTimestamp = now;
        return result;
    }

    // 🔹 情况4：使用剧情初始时间（智能加载联系人时生成）
    const storyInitialTime = this.getStoryInitialTime();
    if (storyInitialTime) {
        this._cache = storyInitialTime;
        this._cacheTimestamp = now;
        return storyInitialTime;
    }

    // 🔹 情况5：智能推断时间
    const inferredTime = this.inferTimeFromLore(context);
    if (inferredTime) {
        this._cache = inferredTime;
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
     * - <time>2044年06月11日·🍦·星期三·14:30</time>
     * - 无标签正文：417年11月7日|星期三|21:28
     * - 无标签正文：417/11/7 21:28
     */
    parseStatusbar(text) {
        const rawText = String(text || '');

        // 1. 优先匹配时间包裹标签；如果没有标签，则直接从正文全文提取
        const tagMatch = rawText.match(/<(statusbar|globalTime|time)>([\s\S]*?)<\/\1>/i);
        const baseContent = tagMatch ? tagMatch[2] : rawText;
        const content = String(baseContent)
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/｜/g, '|')
            .replace(/／/g, '/');

        // 2. 独立提取年月日、时间、星期 (🔥超强兼容：支持横杠、斜杠、冒号、全角半角等)
        const dateMatch = content.match(/(\d{1,6})[-\/年]\s*(\d{1,2})[-\/月]\s*(\d{1,2})\s*日?/);
        // 时间兼容：
        // 1) 21:28 / 21：28
        // 2) 21时28分 / 21时28
        // 3) 紧凑写法 2128（优先在日期后半段里查，避免误匹配年份）
        const dateToken = dateMatch?.[0] || '';
        const afterDateContent = dateToken ? content.slice(content.indexOf(dateToken) + dateToken.length) : content;
        const standardTimeMatch = afterDateContent.match(/(\d{1,2})\s*[:：时]\s*(\d{1,2})(?:\s*分)?/);
        const compactTimeMatch = standardTimeMatch
            ? null
            : afterDateContent.match(/(?:^|[^\d])([01]?\d|2[0-3])([0-5]\d)(?:$|[^\d])/);
        const weekdayMatch = content.match(/(星期[一二三四五六日天]|周[一二三四五六日天])/);

        if (dateMatch && (standardTimeMatch || compactTimeMatch)) {
            const year = dateMatch[1];
            // 🔥 统一补零格式化
            const month = String(parseInt(dateMatch[2])).padStart(2, '0');
            const day = String(parseInt(dateMatch[3])).padStart(2, '0');
            const hour = String(standardTimeMatch ? standardTimeMatch[1] : compactTimeMatch[1]);
            const minute = String(standardTimeMatch ? standardTimeMatch[2] : compactTimeMatch[2]);

            // 🔥 优先使用正文中提取的星期，如果没有才计算
            let weekday;
            if (weekdayMatch) {
                weekday = weekdayMatch[1].replace('周', '星期');
                if (weekday === '星期天') weekday = '星期日';
            } else {
                // 计算星期（使用蔡勒公式，避免Date对远未来年份的问题）
                weekday = this.calculateWeekdayFromDate(parseInt(year), parseInt(month), parseInt(day));
            }

            const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));

            return {
                time: `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`,
                date: `${year}年${month}月${day}日`,
                weekday: weekday,
                timestamp: dateObj.getTime(),
                year: year,
                month: month,
                day: day,
                hour: hour,
                minute: minute
            };
        }

        return null;
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
            return {
                time: data.time,
                date: data.date,
                weekday: data.weekday,
                timestamp: this.parseTimeToTimestamp(data),
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
        const dateParts = timeData.date.match(/(\d{1,6})[-\/年]\s*(\d{1,2})[-\/月]\s*(\d{1,2})\s*日?/);
        const timeParts = timeData.time.match(/(\d{1,2})[:：](\d{2})/);
        
        if (dateParts && timeParts) {
            const year = parseInt(dateParts[1]);
            const month = parseInt(dateParts[2]) - 1;
            const day = parseInt(dateParts[3]);
            const hour = parseInt(timeParts[1]);
            const minute = parseInt(timeParts[2]);
            
            return new Date(year, month, day, hour, minute).getTime();
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
getPhoneLastMessageTime() {
    try {
        // 🔥 优先从内存中的 wechatData 读取（更准确、更实时）
        const wechatData = window.VirtualPhone?.wechatApp?.wechatData;
        if (!wechatData) return null;

        // 🔥 遍历所有聊天，找到最新的消息时间
        let latestTime = null;
        let latestTimestamp = 0;

        const chatList = wechatData.getChatList?.() || [];

        for (const chat of chatList) {
            const chatMessages = wechatData.getMessages?.(chat.id) || [];
            if (chatMessages.length > 0) {
                const lastMsg = chatMessages[chatMessages.length - 1];

                if (lastMsg.time && lastMsg.timestamp) {
                    if (lastMsg.timestamp > latestTimestamp) {
                        latestTimestamp = lastMsg.timestamp;
                        latestTime = {
                            time: lastMsg.time,
                            date: lastMsg.date || this.formatDate(new Date(lastMsg.timestamp)),
                            weekday: lastMsg.weekday || this.getWeekday(new Date(lastMsg.timestamp)),
                            timestamp: lastMsg.timestamp,
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
 * 🔥 微信消息时间步进策略（慢速）
 * 目标：AI 一次性多条消息时，避免时间快速跳动。
 * @param {string} content - 消息文本
 * @param {Object} options - 预留参数
 * @returns {number} 要推进的分钟数（0 或 1）
 */
getWechatMessageMinutesToAdd(content = '', options = {}) {
    const text = String(content || '').trim();
    const length = text.length;

    // 短句（嗯/好/收到）不推进分钟，避免一轮分句把时间推太快
    if (length <= 12) return 0;

    // 常规句子每条最多推进 1 分钟
    return 1;
}

/**
 * 🔥 精准时间推算：在给定时间基础上加减分钟数（自动处理跨天/跨月/跨年）
 * @param {Object} timeData - { time: "HH:MM", date: "YYYY年MM月DD日" }
 * @param {number} minutesToAdd - 要增加的分钟数
 * @returns {Object} { time, date, weekday, timestamp }
 */
addMinutesToStoryTime(timeData, minutesToAdd) {
    try {
        const dateParts = timeData.date.match(/(\d{1,6})[-\/年]\s*(\d{1,2})[-\/月]\s*(\d{1,2})\s*日?/);
        const timeParts = timeData.time.match(/(\d{1,2})[:：](\d{2})/);

        if (!dateParts || !timeParts) {
            console.warn('⚠️ addMinutesToStoryTime: 无法解析时间数据', timeData);
            return { time: timeData.time, date: timeData.date, weekday: timeData.weekday || '星期一', timestamp: Date.now() };
        }

        const year = parseInt(dateParts[1]);
        const month = parseInt(dateParts[2]) - 1;
        const day = parseInt(dateParts[3]);
        const hour = parseInt(timeParts[1]);
        const minute = parseInt(timeParts[2]);

        // JS 原生 Date 自动处理跨天、跨月、跨年进位
        const dateObj = new Date(year, month, day, hour, minute);
        dateObj.setMinutes(dateObj.getMinutes() + minutesToAdd);

        const newYear = dateObj.getFullYear();
        const newMonth = dateObj.getMonth() + 1;
        const newDay = dateObj.getDate();
        const newHour = dateObj.getHours();
        const newMinute = dateObj.getMinutes();

        // 🔥 修复点 1：保持日期格式对齐，永远补齐 0（例如 09月 05日）
        const paddedMonth = String(newMonth).padStart(2, '0');
        const paddedDay = String(newDay).padStart(2, '0');

        // 🔥 修复点 2：根据天数差值推算星期，防止 AI 幻觉和真实日历冲突
        let weekday = timeData.weekday;

        // 计算真实过去的天数
        const oldDateOnly = new Date(year, month, day).getTime();
        const newDateOnly = new Date(newYear, newMonth - 1, newDay).getTime();
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
            date: `${newYear}年${paddedMonth}月${paddedDay}日`,
            weekday: weekday,
            timestamp: dateObj.getTime()
        };
    } catch (e) {
        console.error('❌ addMinutesToStoryTime 失败:', e);
        return { time: timeData.time, date: timeData.date, weekday: timeData.weekday || '星期一', timestamp: Date.now() };
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
 */
setTime(time, date, weekday = null) {
    try {
        // 🔥 清除缓存，确保下次获取时间时重新计算
        this.clearCache();

        let finalTime = time;
        const finalDate = date;
        const finalWeekday = weekday || this.calculateWeekday(date);

        // 🔥 和手机聊天记录的最后时间比较，取更晚的
        const phoneLastTime = this.getPhoneLastMessageTime();
        if (phoneLastTime && phoneLastTime.time) {
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
            timestamp: Date.now()
        };

        this.storage.set('story-current-time', JSON.stringify(timeData), true);

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
        const match = dateStr.match(/(\d{1,6})[-\/年]\s*(\d{1,2})[-\/月]\s*(\d{1,2})\s*日?/);
        if (match) {
            return this.calculateWeekdayFromDate(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
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
            return {
                time: data.time,
                date: data.date,
                weekday: data.weekday,
                timestamp: data.timestamp
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
