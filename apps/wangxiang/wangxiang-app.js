/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

import { WangxiangView } from './wangxiang-view.js';
import { applyPhoneTagFilter } from '../../config/tag-filter.js';

const WANGXIANG_TASK_LEVELS = {
    '普通': { accent: 'green', icon: 'fa-list-check', difficulty: 1 },
    '中级': { accent: 'cyan', icon: 'fa-shield-halved', difficulty: 2 },
    '高级': { accent: 'purple', icon: 'fa-crosshairs', difficulty: 3 },
    '特级': { accent: 'orange', icon: 'fa-crown', difficulty: 4 }
};

export class WangxiangApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.wangxiangView = new WangxiangView(this);
        this.isRefreshingTasks = false;
        this._taskDataScopeKey = this._getCurrentTaskScopeKey();
        this.generatedTasks = this._loadGeneratedTasks();
        this.managedTasks = this._loadManagedTasks();
        this._reconcileGeneratedTaskStatuses();

        window.addEventListener('phone:swipeBack', () => this.handleSwipeBack());
    }

    render() {
        this._syncTaskDataScope();
        return this.wangxiangView.render();
    }

    clearCache() {
        this._taskDataScopeKey = '';
        this.generatedTasks = [];
        this.managedTasks = [];
        this.wangxiangView.currentTaskId = '';
        this._syncTaskDataScope();
    }

    getGeneratedTasks() {
        return Array.isArray(this.generatedTasks) ? this.generatedTasks : [];
    }

    getManagedTasks() {
        return Array.isArray(this.managedTasks) ? this.managedTasks : [];
    }

    getTaskById(taskId) {
        const id = String(taskId || '').trim();
        return this.managedTasks.find(item => String(item?.id || '') === id)
            || this.generatedTasks.find(item => String(item?.id || '') === id)
            || null;
    }

    async acceptTask(taskId) {
        this._syncTaskDataScope();
        const id = String(taskId || '').trim();
        const task = this.generatedTasks.find(item => String(item?.id || '') === id);
        if (!task) throw new Error('任务不存在或已刷新');

        const existing = this.managedTasks.find(item => String(item?.id || '') === id);
        if (existing) return existing;

        const managedTask = {
            ...task,
            status: 'active',
            progress: 0,
            acceptedAt: Date.now()
        };
        task.status = 'active';
        this.managedTasks = [managedTask, ...this.managedTasks];
        await Promise.all([
            this._saveGeneratedTasks(),
            this._saveManagedTasks()
        ]);
        return managedTask;
    }

    async setManagedTaskStatus(taskId, status, patch = {}) {
        this._syncTaskDataScope();
        const allowedStatuses = new Set(['active', 'submit', 'completed']);
        if (!allowedStatuses.has(status)) throw new Error('无效的任务状态');
        const task = this.managedTasks.find(item => String(item?.id || '') === String(taskId || ''));
        if (!task) throw new Error('未找到已接取任务');

        Object.assign(task, patch, { status });
        if (status === 'submit') task.progress = 100;
        if (status === 'completed') {
            task.progress = 100;
            task.completedAt = task.completedAt || new Date().toLocaleString('zh-CN', { hour12: false });
        }
        const generatedTask = this.generatedTasks.find(item => String(item?.id || '') === String(task.id || ''));
        if (generatedTask) generatedTask.status = status;
        if (status === 'completed') {
            this.generatedTasks = this.generatedTasks.filter(item => String(item?.id || '') !== String(task.id || ''));
        }
        await Promise.all([
            this._saveGeneratedTasks(),
            this._saveManagedTasks()
        ]);
        return task;
    }

    completeTask(taskId) {
        return this.setManagedTaskStatus(taskId, 'completed');
    }

    async abandonTask(taskId) {
        this._syncTaskDataScope();
        const id = String(taskId || '').trim();
        const task = this.managedTasks.find(item => String(item?.id || '') === id);
        if (!task) throw new Error('未找到已接取任务');
        this.managedTasks = this.managedTasks.filter(item => String(item?.id || '') !== id);
        const generatedTask = this.generatedTasks.find(item => String(item?.id || '') === id);
        if (generatedTask) generatedTask.status = 'available';
        await Promise.all([
            this._saveGeneratedTasks(),
            this._saveManagedTasks()
        ]);
        return task;
    }

    async refreshTaskHall() {
        if (this.isRefreshingTasks) return null;
        this._syncTaskDataScope();
        const requestScopeKey = this._taskDataScopeKey;
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager?.callAI) throw new Error('API Manager 未初始化');

        this.isRefreshingTasks = true;
        try {
            const messages = await this._buildTaskMessages();
            const result = await apiManager.callAI(messages, {
                appId: 'wangxiang',
                temperature: 0.75,
                max_tokens: 2600,
                min_max_tokens: 1800
            });
            if (!result?.success) throw new Error(result?.error || '任务生成失败');

            const rawText = String(result.summary || result.content || result.text || '').trim();
            const cleanedText = applyPhoneTagFilter(rawText, { storage: this.storage }) || rawText;
            if (this._getCurrentTaskScopeKey() !== requestScopeKey) {
                throw new Error('生成期间会话已切换，本次任务未写入任何聊天');
            }
            const tasks = this._parseTaskResponse(cleanedText);
            if (!tasks.length) throw new Error('没有解析到有效任务，请重新下拉生成');

            const preservedTasks = this.managedTasks
                .filter(task => task.status === 'active' || task.status === 'submit')
                .map(task => ({ ...task }));
            const preservedIds = new Set(preservedTasks.map(task => String(task?.id || '')));
            const freshTasks = tasks.filter(task => !preservedIds.has(String(task?.id || '')));
            this.generatedTasks = [...freshTasks, ...preservedTasks];
            await this._saveGeneratedTasks();
            return this.generatedTasks;
        } finally {
            this.isRefreshingTasks = false;
        }
    }

    async _buildTaskMessages() {
        const context = this._getContext();
        if (!context) throw new Error('无法访问 SillyTavern 角色信息');

        const userName = context.name1 || '用户';
        const charName = context.name2 || '角色';
        const messages = [
            this._buildCharacterMessage(context, charName),
            this._buildPersonaMessage(context, userName)
        ].filter(Boolean);

        const worldbookMessage = await window.VirtualPhone?.worldbookManager?.buildWorldbookMessage?.('wangxiang');
        if (worldbookMessage?.content) messages.push(worldbookMessage);

        const promptManager = window.VirtualPhone?.promptManager;
        promptManager?.ensureLoaded?.();
        let taskPrompt = promptManager?.getPromptForFeature?.('wangxiang', 'tasks')
            || promptManager?.getDefaultPrompts?.()?.wangxiang?.tasks?.content
            || '';
        const storyTime = this._getCurrentPhoneTimeLabel();
        taskPrompt = String(taskPrompt)
            .replace(/\{\{\s*user\s*\}\}/g, userName)
            .replace(/\{\{\s*char\s*\}\}/g, charName)
            .replace(/\{\{\s*storyTime\s*\}\}/gi, storyTime)
            .replace(/\{\{\s*STORY_TIME\s*\}\}/g, storyTime)
            .trim();
        if (!taskPrompt) throw new Error('任务大厅提示词为空');
        messages.push({ role: 'user', content: taskPrompt, isPhoneMessage: true });
        return messages;
    }

    _getCurrentPhoneTimeLabel() {
        try {
            const timeManager = window.VirtualPhone?.timeManager;
            const current = timeManager?.getCurrentStoryTime?.() || timeManager?.getCurrentTime?.();
            const parts = [current?.date, current?.weekday, current?.time]
                .map(value => String(value || '').trim())
                .filter(Boolean);
            if (parts.length) return parts.join(' ');
        } catch (error) {
            console.warn('[Wangxiang] 获取手机当前时间失败:', error);
        }
        return '当前手机时间未知，请根据故事背景合理推断';
    }

    _buildCharacterMessage(context, fallbackName = '角色') {
        const character = context?.characterId !== undefined && context?.characters
            ? context.characters[context.characterId]
            : null;
        const parts = [`角色名：${character?.name || fallbackName}`];
        if (character?.description) parts.push(`描述：${String(character.description).trim().slice(0, 2400)}`);
        if (character?.personality) parts.push(`性格：${String(character.personality).trim().slice(0, 1200)}`);
        if (character?.scenario || context?.scenario) parts.push(`场景/背景：${String(character?.scenario || context.scenario).trim().slice(0, 1600)}`);
        if (character?.first_mes) parts.push(`开场白：${String(character.first_mes).trim().slice(0, 800)}`);
        if (character?.mes_example) parts.push(`示例对话：${String(character.mes_example).trim().slice(0, 1200)}`);
        if (character?.data?.system_prompt) parts.push(`角色系统提示词：${String(character.data.system_prompt).trim().slice(0, 1200)}`);
        return {
            role: 'system',
            content: `【角色卡信息】\n${parts.join('\n')}`,
            name: 'SYSTEM (角色卡信息)',
            isPhoneMessage: true
        };
    }

    _buildPersonaMessage(context, userName = '用户') {
        const personaText = String(document.getElementById('persona_description')?.value || '').trim();
        const parts = [`姓名：${userName}`];
        if (personaText) parts.push(`用户设定：${personaText.slice(0, 2400)}`);
        return {
            role: 'system',
            content: `【用户信息】\n${parts.join('\n')}`,
            name: 'SYSTEM (用户信息)',
            isPhoneMessage: true
        };
    }

    _parseTaskResponse(rawText) {
        const wrapper = String(rawText || '').match(/<任务>([\s\S]*?)<\/任务>/i);
        if (!wrapper) return [];

        return wrapper[1]
            .split(/\n\s*---+\s*\n/g)
            .map((block, index) => this._parseTaskBlock(block, index))
            .filter(Boolean)
            .slice(0, 10);
    }

    _parseTaskBlock(block, index) {
        const text = String(block || '').trim();
        const titleMatch = text.match(/^\s*\[(普通|中级|高级|特级|特技)\]\s*任务标题\s*[:：]\s*(.+)$/m);
        if (!titleMatch) return null;

        const normalizedLevel = titleMatch[1] === '特技' ? '特级' : titleMatch[1];
        const levelConfig = WANGXIANG_TASK_LEVELS[normalizedLevel];
        const readField = field => text.match(new RegExp(`^\\s*${field}\\s*[:：]\\s*(.+)$`, 'm'))?.[1]?.trim() || '';
        const contentMatch = text.match(/任务内容\s*[:：]\s*([\s\S]*?)(?=\n\s*(?:任务目标|奖励)\s*[:：]|$)/);
        const description = String(contentMatch?.[1] || '').replace(/\s+/g, ' ').trim();
        const rewardRaw = readField('奖励').replace(/[^\d.,]/g, '');
        const reward = rewardRaw || '0';
        const objectives = this._parseTaskObjectives(text);
        const comments = this._parseTaskComments(text);

        return {
            id: `generated-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 6)}`,
            level: normalizedLevel,
            title: titleMatch[2].trim(),
            description: description || '任务详情将在接取后进一步说明。',
            publisher: readField('发布者') || '万象任务中心',
            remaining: readField('发布时间') || '--:--:--',
            reward,
            prestige: readField('声望值').replace(/[^\d.,+-]/g, '') || '0',
            extraReward: readField('额外奖励') || '无',
            icon: levelConfig.icon,
            accent: levelConfig.accent,
            difficulty: levelConfig.difficulty,
            remainingTime: readField('剩余时间') || '未注明',
            publisherOrg: readField('发布者组织') || '独立委托方',
            publisherReputation: readField('发布者信誉') || '未知',
            location: readField('任务地点') || '未注明',
            recommendedLevel: readField('推荐等级') || '无',
            duration: readField('预计时长') || '未注明',
            objectives,
            comments,
            status: 'available'
        };
    }

    _parseTaskObjectives(text) {
        const section = String(text || '').match(/任务目标\s*[:：]\s*([\s\S]*?)(?=\n\s*(?:奖励|声望值|额外奖励|任务讨论)\s*[:：]|$)/)?.[1] || '';
        const rows = section.split('\n').map(line => line.replace(/^\s*[-•]\s*/, '').trim()).filter(Boolean);
        const objectives = rows.map((row, index) => {
            const parts = row.split(/[｜|]/).map(part => part.trim()).filter(Boolean);
            const progress = String(parts[1] || '').match(/(\d+)\s*\/\s*(\d+)/);
            const total = Math.max(1, Number(progress?.[2] || 1));
            const current = Math.max(0, Math.min(total, Number(progress?.[1] || 0)));
            return {
                id: `objective-${index + 1}`,
                title: parts[0] || `任务目标 ${index + 1}`,
                current,
                total,
                completed: current >= total
            };
        });
        return objectives.length ? objectives.slice(0, 6) : [{
            id: 'objective-1',
            title: '完成任务要求',
            current: 0,
            total: 1,
            completed: false
        }];
    }

    _parseTaskComments(text) {
        const section = String(text || '').match(/任务讨论\s*[:：]\s*([\s\S]*?)$/)?.[1] || '';
        return section.split('\n')
            .map(line => line.replace(/^\s*[-•]\s*/, '').trim())
            .filter(Boolean)
            .map((row, index) => {
                const parts = row.split(/[｜|]/).map(part => part.trim());
                return {
                    id: `comment-${index + 1}`,
                    name: parts[0] || '匿名执行者',
                    level: parts[1] || 'Lv.??',
                    time: parts[2] || '刚刚',
                    content: parts.slice(3).join('｜') || parts[1] || row
                };
            })
            .slice(0, 5);
    }

    _loadGeneratedTasks() {
        try {
            const saved = this.storage?.get?.('wangxiang_generated_tasks', null);
            const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.warn('[Wangxiang] 读取任务缓存失败:', error);
            return [];
        }
    }

    _loadManagedTasks() {
        try {
            const saved = this.storage?.get?.('wangxiang_managed_tasks', null);
            const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.warn('[Wangxiang] 读取我的任务失败:', error);
            return [];
        }
    }

    _getCurrentTaskScopeKey() {
        try {
            const scopedKey = this.storage?.getStorageKey?.('wangxiang-scope');
            if (scopedKey) return String(scopedKey);
            const context = this.storage?.getContext?.() || this._getContext();
            const characterId = context?.characterId ?? context?.name2 ?? 'default';
            const chatId = context?.chatMetadata?.file_name ?? context?.chatId ?? 'default_chat';
            return `${characterId}::${chatId}`;
        } catch (error) {
            console.warn('[Wangxiang] 获取当前聊天作用域失败:', error);
            return 'default::default_chat';
        }
    }

    _syncTaskDataScope() {
        const nextScopeKey = this._getCurrentTaskScopeKey();
        if (nextScopeKey === this._taskDataScopeKey) return false;
        this._taskDataScopeKey = nextScopeKey;
        this.generatedTasks = this._loadGeneratedTasks();
        this.managedTasks = this._loadManagedTasks();
        this._reconcileGeneratedTaskStatuses();
        return true;
    }

    _reconcileGeneratedTaskStatuses() {
        const statusById = new Map(this.managedTasks.map(task => [String(task?.id || ''), task.status]));
        this.generatedTasks = this.generatedTasks.filter(task => {
            const managedStatus = statusById.get(String(task?.id || ''));
            if (managedStatus === 'completed') return false;
            if (managedStatus) task.status = managedStatus;
            return task.status !== 'completed';
        });
    }

    _saveGeneratedTasks() {
        return this.storage?.set?.('wangxiang_generated_tasks', JSON.stringify(this.generatedTasks));
    }

    _saveManagedTasks() {
        return this.storage?.set?.('wangxiang_managed_tasks', JSON.stringify(this.managedTasks));
    }

    _getContext() {
        return (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
            ? SillyTavern.getContext()
            : null;
    }

    handleSwipeBack() {
        const currentView = document.querySelector('.phone-view-current');
        if (!currentView?.querySelector('.wangxiang-app')) return;

        if (this.wangxiangView.handleBack()) return;

        window.dispatchEvent(new CustomEvent('phone:goHome'));
    }
}
