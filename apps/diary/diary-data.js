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
// ========================================
// 📔 日记数据引擎 - 存储与AI调用
// ========================================
import { applyPhoneTagFilter } from '../../config/tag-filter.js';

export class DiaryData {
    constructor(storage) {
        this.storage = storage;
        this._entries = null;
        this._settings = null;
        this.stopBatch = false; // 分批停止标志
    }

    // ==================== 数据读写 ====================

    getEntries() {
        if (!this._entries) {
            const saved = this.storage.get('diary_entries', null);
            if (saved) {
                try {
                    this._entries = typeof saved === 'string' ? JSON.parse(saved) : saved;
                } catch (e) {
                    console.error('[DiaryData] 解析日记条目失败:', e);
                    this._entries = [];
                }
            } else {
                this._entries = [];
            }
        }
        return this._entries;
    }

    saveEntries() {
        this.storage.set('diary_entries', JSON.stringify(this._entries || []));
    }

    getSettings() {
        if (!this._settings) {
            const saved = this.storage.get('diary_settings', null);
            if (saved) {
                try {
                    this._settings = typeof saved === 'string' ? JSON.parse(saved) : saved;
                } catch (e) {
                    this._settings = {};
                }
            } else {
                this._settings = {};
            }
        }
        return this._settings;
    }

    saveSettings() {
        this.storage.set('diary_settings', JSON.stringify(this._settings || {}));
    }

   // ==================== 背景图管理 ====================

    // 🔥 核心魔法：将 base64 图片转换为实体文件并上传到酒馆的 backgrounds 文件夹
    async _uploadImageToServer(base64, type) {
        if (!base64 || !base64.startsWith('data:image')) return base64; // 如果已经是链接则跳过
        try {
            // 将 base64 转为 Blob 实体对象
            const res = await fetch(base64);
            const blob = await res.blob();
            const ext = blob.type === 'image/png' ? 'png' : 'jpg';
            // 生成唯一文件名，防止互相覆盖
            const filename = `diary_${type}_${Date.now()}.${ext}`;
            
            const formData = new FormData();
            formData.append('avatar', blob, filename); // 酒馆背景接口使用 avatar 作为字段名
            
            // 调用酒馆自带的上传接口
            const response = await fetch('/api/backgrounds/upload', {
                method: 'POST',
                body: formData
            });
            
            if (response.ok) {
                // 上传成功，返回酒馆静态文件的真实相对路径
                return `/backgrounds/${filename}`;
            }
        } catch (e) {
            console.error('[Diary] 上传图片到服务器文件夹失败:', e);
        }
        return base64; // 如果上传失败，降级返回原 base64 字符串
    }

    getPageBg(entryId) {
        const settings = this.getSettings();
        return settings[`bg_${entryId}`] || null;
    }

    async setPageBg(entryId, base64) {
        const settings = this.getSettings();
        if (base64) {
            const url = await this._uploadImageToServer(base64, `page_${entryId}`);
            settings[`bg_${entryId}`] = url;
        } else {
            delete settings[`bg_${entryId}`];
        }
        this.saveSettings();
    }

    getGlobalBg() {
        // 优先读取服务器存储的路径，如果没有则兼容读取旧版的本地缓存防止丢失
        return this.storage.get('global_diary_bg_global') || localStorage.getItem('diary_shared_bg_global') || null;
    }

    async setGlobalBg(base64) {
        if (base64) {
            const url = await this._uploadImageToServer(base64, 'global');
            // 使用 storage.set 会存入酒馆服务器的 settings.json 中，突破浏览器限制
            this.storage.set('global_diary_bg_global', url);
        } else {
            this.storage.remove('global_diary_bg_global');
        }
    }

    getCoverBg() {
        return this.storage.get('global_diary_bg_cover') || localStorage.getItem('diary_shared_bg_cover') || null;
    }

    async setCoverBg(base64) {
        if (base64) {
            const url = await this._uploadImageToServer(base64, 'cover');
            this.storage.set('global_diary_bg_cover', url);
        } else {
            this.storage.remove('global_diary_bg_cover');
        }
    }

    getTocBg() {
        return this.storage.get('global_diary_bg_toc') || localStorage.getItem('diary_shared_bg_toc') || null;
    }

    async setTocBg(base64) {
        if (base64) {
            const url = await this._uploadImageToServer(base64, 'toc');
            this.storage.set('global_diary_bg_toc', url);
        } else {
            this.storage.remove('global_diary_bg_toc');
        }
    }

    // ==================== 行间距 ====================

    getPageLineHeight(entryId) {
        const settings = this.getSettings();
        return settings[`lh_${entryId}`] || this.getGlobalLineHeight();
    }

    setPageLineHeight(entryId, value) {
        const settings = this.getSettings();
        settings[`lh_${entryId}`] = value;
        this.saveSettings();
    }

    getGlobalLineHeight() {
        const settings = this.getSettings();
        return settings.globalLineHeight || 2;
    }

    setGlobalLineHeight(value) {
        const settings = this.getSettings();
        settings.globalLineHeight = value;
        this.saveSettings();
    }

    // ==================== 字体大小 ====================

    getGlobalFontSize() {
        const settings = this.getSettings();
        return settings.globalFontSize || 15;
    }

    setGlobalFontSize(value) {
        const settings = this.getSettings();
        settings.globalFontSize = value;
        this.saveSettings();
    }

    // ==================== 条目管理 ====================

    addEntry(entry) {
        const entries = this.getEntries();
        entry.id = entry.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        entry.createdAt = entry.createdAt || Date.now();
        entries.push(entry);
        this.saveEntries();
        return entry;
    }

    deleteEntry(entryId) {
        const entries = this.getEntries();
        const idx = entries.findIndex(e => e.id === entryId);
        if (idx !== -1) {
            entries.splice(idx, 1);
            this.saveEntries();
            const settings = this.getSettings();
            delete settings[`bg_${entryId}`];
            delete settings[`lh_${entryId}`];
            this.saveSettings();
            return true;
        }
        return false;
    }

    clearAllEntries() {
        this._entries = [];
        this.saveEntries();
        // 清除所有日记相关的设置（背景、行高等）
        const settings = this.getSettings();
        const keysToDelete = Object.keys(settings).filter(k => k.startsWith('bg_') || k.startsWith('lh_'));
        keysToDelete.forEach(k => delete settings[k]);
        this.saveSettings();
    }

    getEntry(entryId) {
        return this.getEntries().find(e => e.id === entryId) || null;
    }

    updateEntryContent(entryId, newContent) {
        const entries = this.getEntries();
        const entry = entries.find(e => e.id === entryId);
        if (entry) {
            entry.content = newContent;
            // 更新日期（如果内容中有新日期）
            const newDate = this._extractDateFromContent(newContent);
            if (newDate) {
                entry.date = newDate;
            }
            this.saveEntries();
            return true;
        }
        return false;
    }

    getLastDiaryFloorIndex() {
        const entries = this.getEntries();
        if (entries.length === 0) return -1;
        const last = entries[entries.length - 1];
        return last.endIndex || -1;
    }

    // ==================== AI 日记生成（参考 memory 插件的 generateRaw 调用） ====================

    /**
     * 调用AI生成日记
     * @param {number} startIndex - 聊天记录起始楼层
     * @param {number} endIndex - 聊天记录结束楼层
     * @returns {Promise<Array>} 生成的日记数组 [{content, date, title}, ...]
     */
    async callAIToWriteDiary(startIndex, endIndex) {
        const context = this._getContext();
        if (!context) throw new Error('无法获取酒馆上下文');
        if (typeof context.generateRaw !== 'function') throw new Error('当前酒馆版本不支持 generateRaw API');

        const chatMessages = this._collectChatHistory(context, startIndex, endIndex);
        if (!chatMessages) throw new Error('没有可用的聊天记录');

        const promptContent = this._getDiaryPrompt(context);
        const userName = context.name1 || '用户';
        const charName = context.name2 || '角色';
        const filledPrompt = promptContent
            .replace(/\{\{user\}\}/g, userName)
            .replace(/\{\{char\}\}/g, charName)
            .replace(/\{\{chatHistory\}\}/g, ''); // 清除占位符，聊天记录已通过消息数组传入

        // 🔥 构建消息数组：系统提示词 + 聊天记录 + 最终指令
        const messages = [
            { role: 'system', content: filledPrompt, isPhoneMessage: true },
            ...chatMessages,
            { role: 'user', content: '请根据上述聊天记录，以第一人称写一篇私人日记。', isPhoneMessage: true }
        ];

        // 🚀 核心：移交 ApiManager 处理
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager) throw new Error('API Manager 未初始化');

        const result = await apiManager.callAI(messages, { max_tokens: context.max_response_length, appId: 'diary' });
        
        if (!result.success) {
            throw new Error(result.error || '日记生成失败');
        }

        const rawSummary = String(result.summary || result.content || result.text || '');
        const filteredSummary = applyPhoneTagFilter(rawSummary, { storage: this.storage });
        const rawContent = filteredSummary || rawSummary;

        // 使用新的多日记解析方法
        return this.parseMultipleDiaries(rawContent);
    }

    /**
     * 分批生成日记（带冷却逻辑，参考 memory 插件）
     * @param {number} startIndex - 起始楼层
     * @param {number} endIndex - 结束楼层
     * @param {number} batchSize - 每批楼层数
     * @param {Function} onProgress - 进度回调 (current, total, status)
     * @returns {Promise<Array>} 生成的日记条目数组
     */
    async batchGenerateDiary(startIndex, endIndex, batchSize = 50, onProgress = null, isAuto = false) {
        const totalFloors = endIndex - startIndex;
        const batchCount = Math.ceil(totalFloors / batchSize);
        const results = [];
        this.stopBatch = false;

        // 🔥 设置全局状态，防止切出界面后任务丢失
        if (window.VirtualPhone) {
            window.VirtualPhone.isDiaryBatchRunning = true;
            window.VirtualPhone.diaryBatchProgress = { current: 0, total: batchCount };
        }

        try {
            if (totalFloors <= batchSize) {
                if (onProgress) onProgress(0, 1, '生成中...');
                const diaries = await this.callAIToWriteDiary(startIndex, endIndex);
                for (const diary of diaries) {
                    const entry = this.addEntry({
                        content: diary.content,
                        title: diary.title,
                        startIndex,
                        endIndex,
                        date: diary.date,
                    });
                    results.push(entry);
                }
                if (isAuto) this.setAutoLastFloor(endIndex);
                if (window.VirtualPhone?.diaryBatchProgress) window.VirtualPhone.diaryBatchProgress.current = 1;
                if (onProgress) onProgress(1, 1, '完成');
            } else {
                for (let i = 0; i < batchCount; i++) {
                    if (this.stopBatch) {
                        if (onProgress) onProgress(i, batchCount, '已停止');
                        break;
                    }

                    // 🔥 批次间冷却 5 秒（参考 memory 插件，避免 API 限流 429）
                    if (i > 0) {
                        for (let d = 5; d > 0; d--) {
                            if (this.stopBatch) break;
                            if (onProgress) onProgress(i, batchCount, `冷却 ${d}s...`);
                            await new Promise(r => setTimeout(r, 1000));
                        }
                        if (this.stopBatch) break;
                    }

                    const bStart = startIndex + i * batchSize;
                    const bEnd = Math.min(bStart + batchSize, endIndex);

                    if (onProgress) onProgress(i, batchCount, `生成 ${i + 1}/${batchCount}...`);

                    try {
                        const diaries = await this.callAIToWriteDiary(bStart, bEnd);
                        for (const diary of diaries) {
                            const entry = this.addEntry({
                                content: diary.content,
                                title: diary.title,
                                startIndex: bStart,
                                endIndex: bEnd,
                                date: diary.date,
                            });
                            results.push(entry);
                        }
                        if (isAuto) this.setAutoLastFloor(bEnd);
                    } catch (err) {
                        console.error(`[DiaryData] 批次 ${i + 1} 失败:`, err);
                        if (onProgress) onProgress(i, batchCount, `批次 ${i + 1} 失败: ${err.message}`);
                    }

                    // 🔥 更新全局进度
                    if (window.VirtualPhone?.diaryBatchProgress) {
                        window.VirtualPhone.diaryBatchProgress.current = i + 1;
                    }
                }
                if (!this.stopBatch && onProgress) onProgress(batchCount, batchCount, '全部完成');
            }
        } finally {
            // 🔥 无论成功、失败、停止，都重置全局状态
            if (window.VirtualPhone) {
                window.VirtualPhone.isDiaryBatchRunning = false;
                delete window.VirtualPhone.diaryBatchProgress;
            }
        }

        return results;
    }

    /**
     * 自动生成日记（由 onMessageReceived 触发）
     */
    async autoGenerateDiary() {
        try {
            const context = this._getContext();
            if (!context || !context.chat) return;

            // 🔥 核心修改：读取专属自动日记追踪器
            const lastIndex = this.getAutoLastFloor();
            const startIndex = lastIndex + 1;
            const endIndex = context.chat.length;

            if (endIndex - startIndex < 5) return;

            const promptManager = window.VirtualPhone?.promptManager;
            let batchMode = true;
            let batchSize = 50;
            if (promptManager) {
                promptManager.ensureLoaded();
                batchMode = promptManager.prompts?.diary?.batchMode !== false;
                batchSize = promptManager.prompts?.diary?.autoFloor || 50;
            }

            if (batchMode && (endIndex - startIndex) > batchSize) {
                // 🔥 核心修改：传入 isAuto = true
                const generatedEntries = await this.batchGenerateDiary(startIndex, endIndex, batchSize, null, true);
                this._notifyAutoDiaryGenerated(generatedEntries.length, startIndex, endIndex);
            } else {
                const diaries = await this.callAIToWriteDiary(startIndex, endIndex);
                // 处理返回的多篇日记
                for (const diary of diaries) {
                    this.addEntry({
                        content: diary.content,
                        title: diary.title,
                        startIndex,
                        endIndex,
                        date: diary.date,
                    });
                }
                // 🔥 核心修改：生成成功后，推高专属标记
                this.setAutoLastFloor(endIndex);
                this._notifyAutoDiaryGenerated(diaries.length, startIndex, endIndex);
            }
        } catch (e) {
            console.error('[DiaryData] 自动生成日记失败:', e);
        }
    }

    _notifyAutoDiaryGenerated(count, startIndex, endIndex) {
        const safeCount = Number(count) || 0;
        if (safeCount <= 0) return;

        const notify = window.VirtualPhone?.notify;
        if (typeof notify !== 'function') return;

        notify('日记', `自动写日记完成，新增 ${safeCount} 篇`, '📱', {
            avatarText: '记',
            avatarBg: '#5b6cff',
            avatarColor: '#ffffff',
            name: '日记',
            content: `自动写日记完成，新增 ${safeCount} 篇（${startIndex}-${endIndex} 层）`,
            timeText: '刚刚',
            senderKey: 'diary:auto'
        });
    }

    // ==================== 内部工具方法 ====================

    _getContext() {
        return (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
            ? SillyTavern.getContext()
            : null;
    }

    _collectChatHistory(context, startIndex, endIndex) {
        if (!context.chat || context.chat.length === 0) return null;

        const start = Math.max(0, startIndex);
        const end = Math.min(context.chat.length, endIndex);
        const messages =[];

        for (let i = start; i < end; i++) {
            const msg = context.chat[i];
            if (!msg) continue;

            // 精准跳过系统消息和插件自身消息，不要使用 msg.is_system，以免误杀
            if (msg.role === 'system' || msg.isPhoneMessage || msg.isGaigaiData || msg.isGaigaiPrompt) continue;

            let originalText = msg.mes || msg.content || '';
            let text = originalText;

            // 标签清洗：优先记忆插件，缺失时按手机本地开关回退
            text = applyPhoneTagFilter(text, { storage: this.storage });

            // 2. 基础兜底处理（仅去除HTML标签，保留星号动作描写，日记需要动作上下文）
            text = text.replace(/<[^>]*>/g, '').trim();

            // 3. 安全防空盾：如果清洗后变为空，但原本有内容，大概率是被误杀了，回退基础清洗
            if (!text && originalText) {
                text = originalText.replace(/<[^>]*>/g, '').trim();
            }

            if (!text) continue;

            messages.push({
                role: msg.is_user ? 'user' : 'assistant',
                content: text,
                isPhoneMessage: true
            });
        }

        return messages.length > 0 ? messages : null;
    }

    _getDiaryPrompt(context) {
        const promptManager = window.VirtualPhone?.promptManager;
        if (promptManager) {
            promptManager.ensureLoaded();
            const diaryPrompt = promptManager.prompts?.diary?.generate?.content;
            if (diaryPrompt) return diaryPrompt;
        }

        return `请根据以下聊天记录，以${context.name2 || '角色'}的口吻写一篇日记，体现情感变化。\n\n聊天记录：\n{{chatHistory}}`;
    }

    /**
     * 从日记内容中提取日期（支持新格式：————YYYY年MM月DD日 星期* 天气 姓名）
     */
    _extractDateFromContent(content) {
        // 新格式：————2024年12月25日 星期三 晴 小雨
        const newMatch = content.match(/————(\d{1,6}年\d{1,2}月\d{1,2}日)\s*(星期[一二三四五六日天])?/);
        if (newMatch) {
            return newMatch[2] ? `${newMatch[1]} ${newMatch[2]}` : newMatch[1];
        }

        // 旧格式兼容：【2024年12月25日 星期三】
        const oldMatch = content.match(/【(\d{1,6}年\d{1,2}月\d{1,2}日\s*星期[一二三四五六日天]?)】/);
        if (oldMatch) return oldMatch[1];

        // 通用日期匹配
        const generalMatch = content.match(/(\d{1,6}年\d{1,2}月\d{1,2}日)/);
        if (generalMatch) return generalMatch[1];

        return '未知日期';
    }

    /**
     * 从日记内容中提取标题（【日记标题】格式）
     */
    _extractTitleFromContent(content) {
        const match = content.match(/【([^】]+)】/);
        if (match && !match[1].match(/\d{1,6}年/)) {
            // 确保不是日期格式的【】
            return match[1];
        }
        return null;
    }

    /**
     * 解析AI返回的日记内容，支持多篇日记分割
     * @param {string} rawContent - AI返回的原始内容
     * @returns {Array} 解析后的日记数组 [{content, date, title}, ...]
     */
    parseMultipleDiaries(rawContent) {
        if (!rawContent || typeof rawContent !== 'string') {
            return [];
        }

        // 按分割线分割多篇日记（支持多种分割线格式）
        const separatorRegex = /\n---+分割线---+\n|\n-{3,}\n|\n={3,}\n/;
        const parts = rawContent.split(separatorRegex).filter(p => p.trim());

        const diaries = [];
        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;

            const date = this._extractDateFromContent(trimmed);
            const title = this._extractTitleFromContent(trimmed);

            diaries.push({
                content: trimmed,
                date: date,
                title: title
            });
        }

        // 如果没有分割线，整体作为一篇日记
        if (diaries.length === 0 && rawContent.trim()) {
            diaries.push({
                content: rawContent.trim(),
                date: this._extractDateFromContent(rawContent),
                title: this._extractTitleFromContent(rawContent)
            });
        }

        return diaries;
    }

    clearCache() {
        this._entries = null;
        this._settings = null;
        this.stopBatch = false;
    }

    // ==================== 专属自动日记楼层追踪器 ====================
    getAutoLastFloor() {
        const saved = this.storage.get('diary_auto_last_floor', 0);
        return parseInt(saved);
    }

    setAutoLastFloor(floorIndex) {
        this.storage.set('diary_auto_last_floor', floorIndex);
    }
}

