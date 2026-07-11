/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

import { WangxiangView } from './wangxiang-view.js';
import { applyPhoneTagFilter } from '../../config/tag-filter.js';

const WANGXIANG_TASK_VISUALS = [
    { accent: 'green', icon: 'fa-list-check' },
    { accent: 'cyan', icon: 'fa-shield-halved' },
    { accent: 'purple', icon: 'fa-crosshairs' },
    { accent: 'orange', icon: 'fa-crown' }
];

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

    _normalizeTaskTitle(value) {
        return String(value || '').trim().replace(/\s+/g, '');
    }

    _buildWechatTaskData(task) {
        return {
            id: String(task?.id || ''),
            title: String(task?.title || '未命名任务'),
            publisher: String(task?.publisher || '万象任务中心'),
            description: String(task?.description || ''),
            location: String(task?.location || '未注明'),
            reward: String(task?.reward || '0'),
            prestige: String(task?.prestige || '0'),
            extraReward: String(task?.extraReward || '无'),
            publishedAt: String(task?.publishedAt || task?.remaining || '--'),
            estimatedDuration: String(task?.estimatedDuration || task?.duration || '未注明'),
            objectives: Array.isArray(task?.objectives) ? task.objectives.map(item => ({ ...item })) : [],
            status: String(task?.status || 'available')
        };
    }

    async contactTaskPublisher(taskId) {
        this._syncTaskDataScope();
        const task = this.getTaskById(taskId);
        if (!task) throw new Error('任务不存在或已刷新');

        const publisherName = String(task.publisher || '').trim();
        if (!publisherName) throw new Error('任务没有发布人信息');

        let wechatApp = window.VirtualPhone?.wechatApp || null;
        if (!wechatApp) {
            const module = await import('../wechat/wechat-app.js');
            wechatApp = new module.WechatApp(this.phoneShell, this.storage);
            if (!window.VirtualPhone) window.VirtualPhone = {};
            window.VirtualPhone.wechatApp = wechatApp;
        }
        if (window.VirtualPhone?.cachedWechatData) {
            wechatApp.wechatData = window.VirtualPhone.cachedWechatData;
        }

        const wechatData = wechatApp.wechatData;
        const publisherNameKey = wechatData._normalizeLookupName?.(publisherName)
            || publisherName.replace(/\s+/g, '').toLowerCase();
        let contact = (wechatData.getContacts?.() || []).find(item => {
            const contactNameKey = wechatData._normalizeLookupName?.(item?.name)
                || String(item?.name || '').trim().replace(/\s+/g, '').toLowerCase();
            return !!contactNameKey && contactNameKey === publisherNameKey;
        }) || null;
        if (!contact) {
            const contactId = `contact_wangxiang_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            contact = wechatData.addContact({
                id: contactId,
                name: publisherName,
                avatar: '👤',
                letter: wechatData.getFirstLetter?.(publisherName) || '#',
                relation: '万象任务发布人',
                sourceApp: 'wangxiang',
                sourceLabel: '万象任务'
            });
            wechatData.globalSocialStore?.upsertContact?.({
                app: 'wechat',
                appContactId: contact?.id || contactId,
                name: publisherName,
                avatar: contact?.avatar || '👤',
                relation: '万象任务发布人',
                extra: { sourceApp: 'wangxiang' }
            });
        }

        const contactId = String(contact?.id || '').trim();
        let chat = contactId ? wechatData.getChatByContactId?.(contactId) : null;
        if (!chat) {
            chat = wechatData.createChat({
                id: `chat_${contactId || `wangxiang_${Date.now()}`}`,
                contactId,
                name: publisherName,
                type: 'single',
                avatar: contact?.avatar || '👤'
            });
        }

        const taskData = this._buildWechatTaskData(task);
        const objectiveText = taskData.objectives
            .map(item => `${String(item?.title || '任务目标')}（${Number(item?.current || 0)}/${Math.max(1, Number(item?.total || 1))}）`)
            .join('；');
        const confirmationTitle = taskData.title.replace(/[\]\r\n]/g, '').trim();
        const content = [
            '[万象任务申请]',
            `任务名称：${taskData.title}`,
            `发布者：${taskData.publisher}`,
            `任务描述：${taskData.description}`,
            `任务目标：${objectiveText || '完成任务要求'}`,
            `奖励：${taskData.reward} 信用点`,
            `发布时间：${taskData.publishedAt}`,
            `预估耗时：${taskData.estimatedDuration}`,
            '发布者可根据当前剧情进度、角色自身视角与性格人设，自主决定同意或拒绝派发。',
            `若同意派发，请只回复：[确认派发任务：${confirmationTitle}]`,
            '若拒绝派发，无需回复确认派发任务的格式，也不要输出确认标签；请以符合角色性格与立场的口吻自然说明拒绝。'
        ].join('\n');

        const added = wechatData.addMessage(chat.id, {
            from: 'me',
            type: 'wangxiang_task_card',
            content,
            wangxiangTaskData: taskData,
            avatar: wechatData.getUserInfo?.()?.avatar || ''
        });
        if (!added) throw new Error('任务卡片发送失败');
        wechatApp.enqueueExternalMessageForAI?.(chat.id);

        wechatApp.currentChat = chat;
        window.currentWechatApp = wechatApp;
        window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'wechat' } }));
        setTimeout(() => wechatApp.openChat?.(chat.id), 0);
        return { task, contact, chat };
    }

    confirmTaskAssignmentByTitle(taskTitle, source = {}) {
        this._syncTaskDataScope();
        const titleKey = this._normalizeTaskTitle(taskTitle);
        if (!titleKey) return null;

        const publisherKey = this._normalizeTaskTitle(source.publisherName);
        const candidates = this.generatedTasks.filter(task =>
            this._normalizeTaskTitle(task?.title) === titleKey && task?.status !== 'completed'
        );
        const task = candidates.find(item => publisherKey && this._normalizeTaskTitle(item?.publisher) === publisherKey)
            || candidates[0]
            || this.managedTasks.find(item => this._normalizeTaskTitle(item?.title) === titleKey)
            || null;
        if (!task) return null;

        const existing = this.managedTasks.find(item => String(item?.id || '') === String(task.id || ''));
        if (existing) return existing;

        const assignmentSource = {
            kind: 'wechat_confirmation',
            chatId: String(source.chatId || ''),
            messageId: String(source.messageId || ''),
            fromMainChatTag: source.fromMainChatTag === true,
            tavernMessageIndex: Number.isFinite(Number(source.tavernMessageIndex)) ? Number(source.tavernMessageIndex) : null,
            batchId: String(source.batchId || '')
        };
        const managedTask = {
            ...task,
            status: 'active',
            progress: 0,
            acceptedAt: Date.now(),
            assignmentSource
        };
        task.status = 'active';
        this.managedTasks = [managedTask, ...this.managedTasks];
        Promise.all([this._saveGeneratedTasks(), this._saveManagedTasks()]).catch(error => {
            console.error('[Wangxiang] 保存微信确认派发状态失败:', error);
        });
        return managedTask;
    }

    rollbackWechatAssignmentsToFloor(targetTavernIndex) {
        const targetFloor = Number(targetTavernIndex);
        if (!Number.isFinite(targetFloor)) return false;
        const removedIds = new Set();
        this.managedTasks = this.managedTasks.filter(task => {
            const source = task?.assignmentSource;
            const shouldRemove = source?.kind === 'wechat_confirmation'
                && source.fromMainChatTag === true
                && Number(source.tavernMessageIndex) >= targetFloor;
            if (shouldRemove) removedIds.add(String(task.id || ''));
            return !shouldRemove;
        });
        if (!removedIds.size) return false;
        this.generatedTasks.forEach(task => {
            if (removedIds.has(String(task?.id || ''))) task.status = 'available';
        });
        Promise.all([this._saveGeneratedTasks(), this._saveManagedTasks()]).catch(error => {
            console.error('[Wangxiang] 回滚微信确认派发状态失败:', error);
        });
        return true;
    }

    async acceptTask(taskId) {
        throw new Error('请联系任务发布者，并由对方确认派发后领取任务');
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
                max_tokens: 4200,
                min_max_tokens: 3000
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
        const titleMatch = text.match(/^\s*(?:\[(普通|中级|高级|特级|特技)\]\s*)?任务标题\s*[:：]\s*(.+)$/m);
        if (!titleMatch) return null;

        const visual = WANGXIANG_TASK_VISUALS[index % WANGXIANG_TASK_VISUALS.length];
        const readField = field => text.match(new RegExp(`^\\s*${field}\\s*[:：]\\s*(.+)$`, 'm'))?.[1]?.trim() || '';
        const contentMatch = text.match(/任务内容\s*[:：]\s*([\s\S]*?)(?=\n\s*(?:任务目标|奖励)\s*[:：]|$)/);
        const description = String(contentMatch?.[1] || '').replace(/\s+/g, ' ').trim();
        const rewardRaw = readField('奖励').replace(/[^\d.,]/g, '');
        const reward = rewardRaw || '0';
        const objectives = this._parseTaskObjectives(text);
        const comments = this._parseTaskComments(text);
        const publisherOrg = readField('发布者组织');

        return {
            id: `generated-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 6)}`,
            title: titleMatch[2].trim(),
            description: description || '任务详情将在接取后进一步说明。',
            publisher: readField('发布者') || publisherOrg || '万象任务中心',
            publishedAt: readField('发布时间') || '--',
            estimatedDuration: readField('预估耗时') || readField('预计时长') || '未注明',
            reward,
            prestige: readField('声望值').replace(/[^\d.,+-]/g, '') || '0',
            extraReward: readField('额外奖励') || '无',
            icon: visual.icon,
            accent: visual.accent,
            publisherOrg: publisherOrg || '独立委托方',
            publisherReputation: readField('发布者信誉') || '未知',
            location: readField('任务地点') || '未注明',
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
                const isLegacyLevelFormat = parts.length >= 4;
                return {
                    id: `comment-${index + 1}`,
                    name: parts[0] || '匿名执行者',
                    time: (isLegacyLevelFormat ? parts[2] : parts[1]) || '刚刚',
                    content: (isLegacyLevelFormat ? parts.slice(3) : parts.slice(2)).join('｜') || row
                };
            })
            .slice(0, 5);
    }

    _normalizeLoadedTask(task, index = 0) {
        const visual = WANGXIANG_TASK_VISUALS[index % WANGXIANG_TASK_VISUALS.length];
        return {
            ...task,
            publishedAt: String(task?.publishedAt || task?.remaining || '--'),
            estimatedDuration: String(task?.estimatedDuration || task?.duration || '未注明'),
            icon: String(task?.icon || visual.icon),
            accent: String(task?.accent || visual.accent)
        };
    }

    _loadGeneratedTasks() {
        try {
            const saved = this.storage?.get?.('wangxiang_generated_tasks', null);
            const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
            return Array.isArray(parsed) ? parsed.map((task, index) => this._normalizeLoadedTask(task, index)) : [];
        } catch (error) {
            console.warn('[Wangxiang] 读取任务缓存失败:', error);
            return [];
        }
    }

    _loadManagedTasks() {
        try {
            const saved = this.storage?.get?.('wangxiang_managed_tasks', null);
            const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
            return Array.isArray(parsed) ? parsed.map((task, index) => this._normalizeLoadedTask(task, index)) : [];
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
