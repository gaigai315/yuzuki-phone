/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 * ======================================================== */

import { PokerData } from './poker-data.js';
import { PokerView } from './poker-view.js';
import { WechatData } from '../../wechat/wechat-data.js';
import { buildGameSillyTavernContextMessages } from '../common/games-ai-context.js';

export class PokerApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.gamesData = new PokerData(storage);
        this.gamesView = new PokerView(this);
        this.currentView = 'lobby';
        this._aiDriving = false;
        this.isSending = false;
        this._pokerStatusMode = 'idle';
        this._activeSendingPlayerId = null;
        this.abortController = null;
        this._pendingPokerChatMessages = [];
        this._pokerChatReplyTimer = null;
        this._pokerActionReplyTimer = null;
        this._pokerChatReplyDelay = 6000;
        this._pokerChatHasPendingReply = false;
        this._pendingUserPokerActionContext = null;

        window.addEventListener('phone:swipeBack', () => this.handleSwipeBack());
    }

    getDefaultPokerPrompt() {
        return [
            '%POKER_PLAYERS%正在用户在手机上进行一场德州扑克游戏',
            '所有角色必须只知道系统提供给自己的手牌、公共牌、底池、筹码、下注状态和最近行动记录。',
            '不要声称看到了其他玩家的暗牌。',
            '根据角色性格、牌力、位置、筹码压力和牌桌氛围做出合理行动。',
            '允许进行合理的牌桌话术、虚张声势、示弱、试探和心理施压。',
            '发言可以与真实牌力不完全一致，但行动必须符合角色性格、筹码压力和牌局策略。',
            '不要直接暴露自己的真实手牌，也不要声称看到了其他玩家暗牌。',
            '如果用户在牌桌聊天中说话，角色可以用牌桌话术回应；如果同时轮到自己行动，仍然必须继续给出合法行动，聊天不能替代下注/跟注/弃牌等牌局行动。',
            '牌桌聊天和牌局行动发生在同一场游戏里，需要承接用户刚才的发言、每局出牌情况、最近行动记录和当前牌桌气氛。多人牌局时，不同角色之间可互相试探，不要仅围绕用户回复。',
            '必须只返回<德州扑克>标签包裹内容和行动，不要使用 Markdown，不要解释及其他旁白。',
            '每次只输出当前轮到行动/回复的一个角色；牌桌发言/表现每行显示为一个气泡，每段建议 1-3 行。',
            '',
            '双人牌桌发言格式为：',
            '',
            '<德州扑克>',
            '--角色A姓名--',
            '牌桌发言：',
            '第一句',
            '第二句',
            '第三句',
            '行动：弃牌/加注xx/跟注',
            '</德州扑克>',
            '',
            '多人牌桌发言格式为：',
            '<德州扑克>',
            '--角色A姓名--',
            '牌桌发言：',
            '第一句',
            '第二句',
            '行动：弃牌/加注xx/跟注',
            '--角色B姓名--',
            '牌桌发言：',
            '第一句',
            '第二句',
            '第三句',
            '行动：弃牌/加注xx/跟注',
            '</德州扑克>'
        ].join('\n');
    }

    getPokerPrompt() {
        const saved = String(this.storage?.get?.('games_poker_ai_prompt') || '').trim();
        if (this._isLegacyPokerJsonPrompt(saved)) return this.getDefaultPokerPrompt();
        if (saved) return this._appendPokerChatWhilePlayingRule(saved);
        return this.getDefaultPokerPrompt();
    }

    setPokerPrompt(value) {
        const text = String(value || '').trim();
        this.storage?.set?.('games_poker_ai_prompt', text, true);
        return text;
    }

    resetPokerPrompt() {
        this.storage?.set?.('games_poker_ai_prompt', '', true);
        return this.getDefaultPokerPrompt();
    }

    _isLegacyPokerJsonPrompt(text) {
        const prompt = String(text || '');
        return prompt.includes('行动 JSON 格式')
            || prompt.includes('必须只返回 JSON')
            || prompt.includes('现在你正在用户在手机上进行一场德州扑克游戏');
    }

    _appendPokerChatWhilePlayingRule(text = '') {
        const prompt = String(text || '').trim();
        const rule = '如果用户在牌桌聊天中说话，角色可以用牌桌话术回应；如果同时轮到自己行动，仍然必须继续给出合法行动，聊天不能替代下注/跟注/弃牌等牌局行动。';
        const rule2 = '牌桌聊天和牌局行动发生在同一场游戏里，需要承接用户刚才的发言、每局出牌情况、最近行动记录和当前牌桌气氛。';
        if (!prompt || prompt.includes(rule)) return prompt;
        const next = prompt.replace(
            /(不要直接暴露自己的真实手牌，也不要声称看到了其他玩家暗牌。)/,
            `$1\n${rule}\n${rule2}`
        );
        return next.includes(rule) ? next : `${prompt}\n${rule}\n${rule2}`;
    }

    isPokerAiSpeechEnabled() {
        const raw = this.storage?.get?.('games_poker_ai_chat_enabled');
        return raw !== false && raw !== 'false';
    }

    setPokerAiSpeechEnabled(enabled) {
        this.storage?.set?.('games_poker_ai_chat_enabled', !!enabled, true);
    }

    isPokerWorldbookEnabled() {
        return window.VirtualPhone?.worldbookManager?.getEnabled?.('games') ?? true;
    }

    async setPokerWorldbookEnabled(enabled) {
        await window.VirtualPhone?.worldbookManager?.setEnabled?.('games', !!enabled);
        return !!enabled;
    }

    getPokerShareText() {
        return this.gamesData.exportPokerShareText();
    }

    buildPokerShareCardData(shareText = '') {
        const content = String(shareText || '').trim();
        const lines = content
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
        const summaryLines = lines
            .filter(line => !/^\[[^\]]+\]$/.test(line))
            .slice(0, 3);

        return {
            title: '德州扑克牌局记录',
            desc: summaryLines.join(' / ') || '点击查看完整牌局内容',
            content,
            sharedAt: this._getPokerStoryShareTime()
        };
    }

    _getPokerStoryShareTime() {
        try {
            const storyTime = window.VirtualPhone?.timeManager?.getCurrentStoryTime?.();
            const date = String(storyTime?.date || '').trim();
            const time = String(storyTime?.time || '').trim().replace('：', ':');
            if (date && /^\d{1,2}:\d{2}$/.test(time)) {
                return [date, storyTime?.weekday, time].filter(Boolean).join(' ');
            }
        } catch (error) {
            console.warn('[Games] 读取德州扑克分享时间失败:', error);
        }
        return '';
    }

    async sharePokerToWechat(targetName, options = {}) {
        const friendName = String(targetName || '').trim();
        if (!friendName) throw new Error('未选择微信好友');
        const wechatData = this.getWechatData();
        if (!wechatData) throw new Error('微信数据库加载失败');

        const shareText = String(options.shareText || this.getPokerShareText() || '').trim();
        if (!shareText) throw new Error('暂无可分享的牌局记录');

        let chat = (wechatData.getChatList?.() || []).find(item => String(item?.name || '').trim() === friendName);
        if (!chat) {
            const contact = (wechatData.getContacts?.() || []).find(item => String(item?.name || '').trim() === friendName);
            if (contact) {
                chat = wechatData.createChat({
                    id: `chat_${contact.id || Date.now()}`,
                    contactId: contact.id,
                    name: contact.name,
                    type: 'single',
                    avatar: contact.avatar || ''
                });
            }
        }
        if (!chat) {
            chat = wechatData.createChat({
                name: friendName,
                type: 'single',
                avatar: '👤'
            });
        }

        const userInfo = wechatData.getUserInfo?.() || {};
        const pokerData = this.buildPokerShareCardData(shareText);
        wechatData.addMessage(chat.id, {
            from: 'me',
            content: '[德州扑克分享]',
            type: 'poker_card',
            pokerData,
            avatar: userInfo.avatar || ''
        });

        if (chat) {
            chat.unread = (chat.unread || 0) + 1;
            chat.lastMessage = '[德州扑克分享]';
            chat.timestamp = Date.now();
        }
        wechatData.saveData?.();
        this._syncWechatHomeBadge(wechatData);
        return { success: true, chatId: chat.id, chatName: chat.name };
    }

    _syncWechatHomeBadge(wechatData = this.getWechatData()) {
        try {
            const apps = window.VirtualPhone?.home?.apps;
            if (!wechatData || !Array.isArray(apps)) return;
            const wechatAppIcon = apps.find(app => app.id === 'wechat');
            if (!wechatAppIcon) return;
            wechatAppIcon.badge = (wechatData.getChatList?.() || []).reduce((sum, chat) => sum + (Number(chat.unread) || 0), 0);
            window.dispatchEvent(new CustomEvent('phone:updateGlobalBadge'));
            this.storage?.saveApps?.(apps);
        } catch (error) {
            console.warn('[Games] 同步微信桌面角标失败:', error);
        }
    }

    getWechatData() {
        const fresh = this._refreshWechatDataForCurrentContext();
        if (fresh) return fresh;
        if (window.VirtualPhone?.cachedWechatData) return window.VirtualPhone.cachedWechatData;
        if (window.VirtualPhone?.wechatApp?.wechatData) return window.VirtualPhone.wechatApp.wechatData;
        if (!this._wechatData) {
            this._wechatData = new WechatData(this.storage);
        }
        return this._wechatData;
    }

    _refreshWechatDataForCurrentContext() {
        try {
            const contextKey = String(this.storage?.getStorageKey?.(this._wechatData?.getStorageKey?.() || 'wechat_data') || '').trim();
            if (contextKey && this._wechatDataContextKey === contextKey && this._wechatData) {
                return this._wechatData;
            }
            const nextData = new WechatData(this.storage);
            this._wechatDataContextKey = String(this.storage?.getStorageKey?.(nextData.getStorageKey?.() || 'wechat_data') || contextKey || '').trim();
            this._wechatData = nextData;
            if (window.VirtualPhone) {
                window.VirtualPhone.cachedWechatData = nextData;
                if (window.VirtualPhone.wechatApp) {
                    window.VirtualPhone.wechatApp.wechatData = nextData;
                }
            }
            return nextData;
        } catch (error) {
            console.warn('[Games] 刷新当前会话微信数据失败:', error);
            return null;
        }
    }

    getWechatContactsForPoker() {
        const wechatData = this.getWechatData();
        const contacts = wechatData?.getContacts?.() || [];
        return contacts
            .filter(contact => contact && String(contact.name || '').trim())
            .map(contact => ({
                id: String(contact.id || contact.name).trim(),
                name: String(contact.name || '').trim(),
                avatar: this.resolveContactAvatar(contact, wechatData),
                remark: String(contact.remark || '').trim()
            }));
    }

    getSelectedPokerContacts() {
        const selectedIds = new Set(this.gamesData.getSelectedContactIds());
        return this.getWechatContactsForPoker().filter(contact => selectedIds.has(contact.id));
    }

    resolvePlayerAvatar(player = {}) {
        const wechatData = this.getWechatData();
        const direct = this._normalizeWechatAvatarPath(player.avatar);
        if (direct) return direct;
        if (!wechatData) return '';
        if (player.id === 'user') {
            return this._normalizeWechatAvatarPath(wechatData.getUserInfo?.()?.avatar) || '';
        }
        const contact = player.contactId
            ? wechatData.getContact?.(player.contactId)
            : wechatData.getContactByName?.(player.name);
        return this.resolveContactAvatar(contact || player, wechatData);
    }

    resolveContactAvatar(contact = {}, wechatData = this.getWechatData()) {
        const direct = this._normalizeWechatAvatarPath(contact?.avatar);
        if (direct) return direct;
        if (!wechatData) return '';

        const keySet = new Set([
            contact?.id,
            contact?.contactId,
            contact?.name
        ].filter(Boolean).map(value => String(value).trim()));

        const contacts = typeof wechatData.getContacts === 'function' ? (wechatData.getContacts() || []) : [];
        const chats = typeof wechatData.getChatList === 'function' ? (wechatData.getChatList() || []) : [];
        for (const key of Array.from(keySet)) {
            const matchedContact = contacts.find(item =>
                String(item?.id || '').trim() === key
                || String(item?.name || '').trim() === key
                || String(item?.remark || '').trim() === key
            );
            if (matchedContact) {
                [matchedContact.id, matchedContact.contactId, matchedContact.name, matchedContact.remark]
                    .filter(Boolean)
                    .forEach(value => keySet.add(String(value).trim()));
                const contactAvatar = this._normalizeWechatAvatarPath(matchedContact.avatar);
                if (contactAvatar) return contactAvatar;
            }
            const matchedChat = chats.find(item =>
                item?.type !== 'group'
                && (
                    String(item?.contactId || '').trim() === key
                    || String(item?.name || '').trim() === key
                )
            );
            if (matchedChat) {
                [matchedChat.contactId, matchedChat.name]
                    .filter(Boolean)
                    .forEach(value => keySet.add(String(value).trim()));
                const chatAvatar = this._normalizeWechatAvatarPath(matchedChat.avatar);
                if (chatAvatar) return chatAvatar;
            }
        }

        for (const key of keySet) {
            const autoAvatar = this._normalizeWechatAvatarPath(wechatData.getContactAutoAvatar?.(key));
            if (autoAvatar) return autoAvatar;
        }

        const autoMap = typeof wechatData.getContactAutoAvatarMap === 'function'
            ? wechatData.getContactAutoAvatarMap()
            : null;
        if (autoMap && typeof autoMap === 'object') {
            for (const key of keySet) {
                const mappedAvatar = this._normalizeWechatAvatarPath(autoMap[key]);
                if (mappedAvatar) return mappedAvatar;
            }
        }

        return '';
    }

    renderPlayerAvatar(player = {}) {
        const wechatApp = window.VirtualPhone?.wechatApp;
        const avatar = this.resolvePlayerAvatar(player);
        const name = String(player?.name || '').trim();
        if (wechatApp && typeof wechatApp.renderAvatar === 'function') {
            return wechatApp.renderAvatar(avatar, '👤', name);
        }

        if (avatar && /^(data:image\/|https?:\/\/|\/|blob:|\.\/|backgrounds\/|apps\/)/i.test(String(avatar))) {
            return `<img src="${this._escapeAttr(avatar)}" alt="${this._escapeAttr(name)}">`;
        }

        const initial = Array.from(name)[0] || '人';
        return `<span>${this._escapeHtml(initial)}</span>`;
    }

    _normalizeWechatAvatarPath(value) {
        const raw = String(value || '').trim();
        if (!raw || raw === '👤' || raw === '👥') return '';
        if (/^(?:data:image|https?:\/\/|\/|blob:)/i.test(raw)) return raw;
        const cleaned = raw
            .replace(/^['"]|['"]$/g, '')
            .replace(/^\.?\/*/, '')
            .replace(/^apps\/wechat\/avatars\//i, '')
            .replace(/^wechat\/avatars\//i, '')
            .replace(/^avatars\//i, '');
        if (!cleaned || /\s/.test(cleaned)) return '';
        if (/^(?:male|female)\d+$/i.test(cleaned)) {
            return new URL(`../../wechat/avatars/${cleaned}.png`, import.meta.url).href;
        }
        if (/^[a-z0-9._-]+\.(?:png|jpg|jpeg|webp|gif)$/i.test(cleaned)) {
            return new URL(`../../wechat/avatars/${cleaned}`, import.meta.url).href;
        }
        return '';
    }

    render() {
        this.applyPhoneChromeTheme();
        this.currentView = 'lobby';
        this.gamesView.renderLobby();
    }

    openPoker() {
        this.applyPhoneChromeTheme();
        this.currentView = 'lobby';
        this.gamesView.openPokerSetupOverlay();
    }

    startPokerGame(playerCount, invitedContacts = this.getSelectedPokerContacts()) {
        this.applyPhoneChromeTheme();
        this.gamesData.startPokerGame(playerCount, invitedContacts);
        this.currentView = 'poker';
        this.gamesView.renderPoker();
        this.drivePokerAi();
    }

    clearPokerSession() {
        if (this._pokerChatReplyTimer) {
            clearTimeout(this._pokerChatReplyTimer);
            this._pokerChatReplyTimer = null;
        }
        this._pendingPokerChatMessages = [];
        this._pokerChatHasPendingReply = false;
        this._pokerStatusMode = 'idle';
        this._activeSendingPlayerId = null;
        this.isSending = false;
        this._aiDriving = false;
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        if (this.gamesData) {
            this.gamesData.state = null;
            this.gamesData.sessionLog = [];
            this.gamesData.sessionStartedAt = 0;
        }
        if (this.gamesView) {
            this.gamesView._speechQueue = [];
            this.gamesView._activeSeatSpeech = null;
            this.gamesView._lastSpeechAt = 0;
            if (this.gamesView._speechTimer) {
                clearTimeout(this.gamesView._speechTimer);
                this.gamesView._speechTimer = null;
            }
        }
    }

    async handleUserPokerAction(action, amount = 0) {
        if (this.isPokerBusy()) {
            this.phoneShell?.showNotification?.('德州扑克', '正在等待牌桌回复，请稍后行动', '⏳');
            return;
        }
        const combinedSpeech = this._consumePendingPokerChatForAction();
        this.gamesData.userAction(action, amount);
        if (combinedSpeech) {
            const actionLabel = [
                this._formatPokerActionName(action),
                Number(amount || 0) > 0 ? this._fmtPokerNumber(amount) : ''
            ].filter(Boolean).join('');
            this._pendingUserPokerActionContext = {
                speech: combinedSpeech,
                action: actionLabel || this._formatPokerActionName(action) || String(action || '').trim()
            };
        }
        this.gamesView.renderPoker();
        if (combinedSpeech) {
            this._schedulePokerAiAfterUserAction();
            return;
        }
        await this.drivePokerAi();
    }

    async sendPokerTableChat(message = '') {
        const text = String(message || '').trim();
        if (!text) return;
        this.gamesData.addTableSpeech(this.gamesData.getState()?.players?.find(p => p.id === 'user')?.name || '你', text);
        this._pendingPokerChatMessages.push(text);
        this._pokerChatHasPendingReply = true;
        this.gamesView.clearPendingChatInput?.();
        this.gamesView.clearPokerActionInputDom?.({ keepFocus: true });
        this.gamesView.syncLatestSeatSpeechFromState?.();
        this._schedulePokerTableChatReplies();
    }

    stagePokerTableChatForAction(message = '') {
        const text = String(message || '').trim();
        if (!text) return false;
        this.gamesData.addTableSpeech(this.gamesData.getState()?.players?.find(p => p.id === 'user')?.name || '你', text);
        this._pendingPokerChatMessages.push(text);
        this._pokerChatHasPendingReply = true;
        this.gamesView.clearPendingChatInput?.();
        this.holdPendingPokerChatForAction();
        return true;
    }

    _schedulePokerTableChatReplies() {
        if (this._pokerChatReplyTimer) {
            clearTimeout(this._pokerChatReplyTimer);
            this._pokerChatReplyTimer = null;
        }
        if (!this._pokerChatHasPendingReply || this._pendingPokerChatMessages.length === 0) {
            if (!this.isSending && !this._aiDriving) this._setPokerStatus('idle');
            return;
        }
        if (!this.isPokerAiSpeechEnabled()) {
            this.drivePokerAi();
            return;
        }
        if (this.isPokerComposing()) {
            this._setPokerStatus('idle');
            this.gamesView.updateStatusDot?.();
            return;
        }
        this._setPokerStatus('idle');
        this._pokerChatReplyTimer = setTimeout(() => {
            this._pokerChatReplyTimer = null;
            this._flushPokerTableChatReplies();
        }, this._pokerChatReplyDelay);
    }

    holdPendingPokerChatForAction() {
        if (this._pokerChatReplyTimer) {
            clearTimeout(this._pokerChatReplyTimer);
            this._pokerChatReplyTimer = null;
        }
        if (this._pokerChatHasPendingReply) {
            this._setPokerStatus('idle');
        }
    }

    cancelPendingPokerActionChat() {
        if (this._pokerChatReplyTimer) {
            clearTimeout(this._pokerChatReplyTimer);
            this._pokerChatReplyTimer = null;
        }
        if (!this._pokerChatHasPendingReply && this._pendingPokerChatMessages.length === 0) return;
        this._pendingPokerChatMessages = [];
        this._pokerChatHasPendingReply = false;
        if (!this.isSending && !this._aiDriving) this._setPokerStatus('idle');
    }

    _consumePendingPokerChatForAction() {
        if (this._pokerChatReplyTimer) {
            clearTimeout(this._pokerChatReplyTimer);
            this._pokerChatReplyTimer = null;
        }
        const messages = this._pendingPokerChatMessages.splice(0);
        this._pokerChatHasPendingReply = false;
        return messages.map(item => String(item || '').trim()).filter(Boolean).join('\n');
    }

    _schedulePokerAiAfterUserAction() {
        if (this._pokerActionReplyTimer) {
            clearTimeout(this._pokerActionReplyTimer);
            this._pokerActionReplyTimer = null;
        }
        this._setPokerStatus('waiting', 'user_action');
        this.gamesView.updateStatusDot?.();
        this._pokerActionReplyTimer = setTimeout(async () => {
            this._pokerActionReplyTimer = null;
            await this.drivePokerAi();
        }, this._pokerChatReplyDelay);
    }

    async _flushPokerTableChatReplies() {
        const messages = this._pendingPokerChatMessages.splice(0);
        const text = messages.map(item => String(item || '').trim()).filter(Boolean).join('\n');
        if (!text) {
            this._pokerChatHasPendingReply = false;
            if (!this.isSending && !this._aiDriving) this._setPokerStatus('idle');
            return;
        }
        this._pokerChatHasPendingReply = false;
        try {
            await this._requestPokerChatReplies(text);
            this.gamesView.renderPoker();
            await this.drivePokerAi();
        } finally {
            if (!this.isSending && !this._aiDriving) this._setPokerStatus('idle');
        }
    }

    isPokerComposing() {
        return !!this.gamesView?.isPokerComposing?.();
    }

    handlePokerComposerChanged() {
        if (!this._pokerChatHasPendingReply) return;
        this._schedulePokerTableChatReplies();
    }

    async drivePokerAi() {
        if (this._aiDriving) return;
        this._aiDriving = true;
        let stoppedByError = false;
        try {
            let guard = 0;
            while (guard < 30) {
                guard += 1;
                const state = this.gamesData.getState();
                if (!state || state.phase !== 'playing' || state.activePlayerId === 'user') break;
                const player = state.players.find(item => item.id === state.activePlayerId);
                if (!player) break;
                this.gamesView.renderPoker();
                if (player.source === 'wechat' && player.aiControlled !== false) {
                    const ok = await this._runWechatPokerAiTurn(player);
                    if (ok === false) {
                        stoppedByError = true;
                        break;
                    }
                } else {
                    this.gamesData.fallbackAiAction(player.id);
                }
            }
        } finally {
            this._aiDriving = false;
            if (this._pokerActionReplyTimer) {
                clearTimeout(this._pokerActionReplyTimer);
                this._pokerActionReplyTimer = null;
            }
            this._pendingUserPokerActionContext = null;
            if (!this.isSending) this._setPokerStatus('idle');
            if (!stoppedByError) this.gamesView.renderPoker();
        }
    }

    async _runWechatPokerAiTurn(player) {
        try {
            const apiManager = window.VirtualPhone?.apiManager;
            if (!apiManager?.callAI) throw new Error('API Manager 未初始化');
            const context = this.gamesData.buildAiDecisionContext(player.id);
            if (!context) throw new Error('牌局上下文为空');
            const result = await this._callPokerAi(player, () => this._buildPokerAiMessages(player, context, {
                mode: 'action',
                userActionContext: this._pendingUserPokerActionContext
            }), {
                appId: 'games',
                temperature: 0.8,
                max_tokens: 520
            });
            if (result?.success === false) {
                throw new Error(result.error || 'AI 请求失败');
            }
            const decision = this._parsePokerAiDecision(result?.summary || result?.content || result?.text || '', player.name);
            if (!decision.action) {
                throw new Error('AI 未返回有效德州扑克行动标签');
            }
            const legal = this.gamesData.getLegalActionsForPlayer(player.id);
            const normalized = this._normalizePokerDecision(decision, legal);
            this.gamesData.applyPlayerAction(player.id, normalized.action, normalized.amount, {
                speech: this.isPokerAiSpeechEnabled() ? normalized.speechLines : ''
            });
            return true;
        } catch (err) {
            console.warn('[Games] 微信好友德州扑克 AI 行动失败:', err);
            this._showPokerAiError(player?.name || 'AI', err);
            return false;
        }
    }

    async _requestPokerChatReplies(userMessage) {
        const state = this.gamesData.getState();
        const wechatPlayers = (state?.players || []).filter(player => player.source === 'wechat' && !player.folded);
        if (!wechatPlayers.length) return;
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager?.callAI) return;
        const tablePlayer = { id: 'table_chat', name: '牌桌' };
        try {
            const context = this.gamesData.buildAiChatContext(userMessage);
            const result = await this._callPokerAi(tablePlayer, () => this._buildPokerAiMessages(tablePlayer, context, {
                mode: 'chat',
                allowMulti: true,
                extraInstruction: '现在是多人牌桌聊天，可按当前气氛输出 1-3 个微信好友角色段落；不同角色可以互相试探、接话或回应用户。每个角色行动写“无行动”。'
            }), { appId: 'games', temperature: 0.9, max_tokens: 640 });
            if (result?.success === false) {
                throw new Error(result.error || 'AI 请求失败');
            }
            const sections = this._parsePokerAiSections(result?.summary || result?.content || result?.text || '');
            const validNames = new Set(wechatPlayers.map(player => String(player.name || '').trim()).filter(Boolean));
            const speeches = sections
                .map(section => ({
                    name: this._resolvePokerSectionPlayerName(section.name, validNames),
                    speeches: this._extractPokerFieldLines(section.body, '牌桌发言')
                }))
                .filter(item => item.name && item.speeches.length);
            const speechQueue = speeches.flatMap(item => item.speeches.map(speech => ({
                name: item.name,
                speech
            })));
            for (const item of speechQueue.slice(0, 8)) {
                this.gamesData.addTableSpeech(item.name, item.speech);
                this.gamesView.syncLatestSeatSpeechFromState?.();
            }
        } catch (e) {
            console.warn('[Games] 牌桌聊天 AI 回复失败:', e);
            this._showPokerAiError('牌桌', e);
        }
    }

    async _callPokerAi(player, buildMessages, options = {}) {
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager?.callAI) throw new Error('API Manager 未初始化');

        const playerId = String(player?.id || player?.name || 'ai').trim();
        this._setPokerStatus('waiting', playerId);

        let messages;
        try {
            await this._waitForPokerApiIdle();
            messages = typeof buildMessages === 'function' ? await buildMessages() : buildMessages;
        } catch (error) {
            this._setPokerStatus('idle');
            throw error;
        }

        const controller = new AbortController();
        this.abortController = controller;
        this.isSending = true;
        this._setPokerStatus('sending', playerId);

        try {
            const result = await apiManager.callAI(messages, {
                ...options,
                signal: controller.signal,
                appId: options.appId || 'games'
            });
            if (result?.aborted) throw new Error('已中断发送');
            return result;
        } finally {
            if (this.abortController === controller) {
                this.abortController = null;
                this.isSending = false;
                this._activeSendingPlayerId = null;
                this._setPokerStatus('idle');
            }
        }
    }

    async _waitForPokerApiIdle() {
        const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        let guard = 0;
        while (guard < 240) {
            guard += 1;
            const apiManager = window.VirtualPhone?.apiManager;
            const busy = !!(apiManager?.isBusy?.() || apiManager?.getActiveRequestCount?.() > 0);
            if (!busy) return;
            await wait(500);
        }
        throw new Error('等待手机 API 空闲超时');
    }

    getPokerStatusDotColor() {
        if (this.isSending) return 'red';
        if (this._pokerStatusMode === 'waiting') return 'yellow';
        return 'green';
    }

    getPokerStatusDotClass() {
        const color = this.getPokerStatusDotColor();
        if (color === 'red') return 'dot-red';
        if (color === 'yellow') return 'dot-yellow';
        return 'dot-green';
    }

    isPokerBusy() {
        return this.isSending || this._aiDriving || this._pokerStatusMode === 'waiting' || this._pokerStatusMode === 'sending';
    }

    _setPokerStatus(mode = 'idle', playerId = null) {
        const normalized = mode === 'sending' ? 'sending' : (mode === 'waiting' ? 'waiting' : 'idle');
        this._pokerStatusMode = normalized;
        this._activeSendingPlayerId = normalized === 'idle' ? null : String(playerId || '').trim();
        this.gamesView?.syncPokerStatusDot?.();
    }

    async _buildPokerAiMessages(player, pokerContext, options = {}) {
        const messages = [];
        const basePrompt = [this._resolvePokerPrompt(), String(options.extraInstruction || '').trim()]
            .filter(Boolean)
            .join('\n\n');
        messages.push({
            role: 'system',
            content: basePrompt,
            name: 'SYSTEM (德州扑克规则)',
            isPhoneMessage: true
        });

        const tavernContextMessages = await buildGameSillyTavernContextMessages('games', this.storage);
        if (tavernContextMessages.length > 0) {
            messages.push(...tavernContextMessages);
        }

        const perspective = [
            '【德州扑克视角限制】',
            options.allowMulti
                ? '本次是多人牌桌聊天，可输出多个角色段落；段落顺序就是牌桌发言气泡显示顺序。'
                : `本次只扮演并只输出：${player?.name || '未知玩家'}。不要输出其他玩家段落。`,
            '系统简报会提供所有非用户玩家的手牌，用户手牌不会提供。',
            '这些手牌是系统裁判信息，用于帮每个 AI 玩家按自己的牌做合理决策；牌桌发言里不要声称看到了其他玩家暗牌。',
            options.mode === 'chat'
                ? '本次任务是牌桌聊天，不要推动下注行动。牌桌发言最多 1-2 句。'
                : '本次任务是行动决策，只能从 legalActions 里选择一个合法行动。牌桌发言最多 1-2 句；行动文字请写成：弃牌、过牌、跟注、下注xx、加注xx、全下。'
        ].join('\n');
        messages.push({
            role: 'system',
            content: perspective,
            name: 'SYSTEM (牌桌视角)',
            isPhoneMessage: true
        });

        messages.push({
            role: 'user',
            content: this._formatPokerContextForPrompt(pokerContext, options),
            isPhoneMessage: true
        });
        return messages;
    }

    _formatPokerContextForPrompt(pokerContext = {}, options = {}) {
        const table = pokerContext?.table || {};
        const player = pokerContext?.player || {};
        const players = Array.isArray(table.players) ? table.players : (Array.isArray(pokerContext.players) ? pokerContext.players : []);
        const privateHand = Array.isArray(pokerContext.privateHand) && pokerContext.privateHand.length
            ? pokerContext.privateHand.join('、')
            : '未知';
        const visibleHands = Array.isArray(pokerContext.visibleHands) ? pokerContext.visibleHands : [];
        const visibleHandLines = visibleHands.length
            ? visibleHands.map(item => `${item?.name || '未知玩家'}：${Array.isArray(item?.cards) && item.cards.length ? item.cards.join('、') : '未知'}`).join('\n')
            : '暂无';
        const community = Array.isArray(table.community) && table.community.length
            ? table.community.join('、')
            : '暂无';
        const recentLog = Array.isArray(pokerContext.recentLog) && pokerContext.recentLog.length
            ? pokerContext.recentLog.map(line => `- ${line}`).join('\n')
            : '- 暂无';
        const playerLines = players.map(item => [
            item?.name || '未知玩家',
            `筹码${this._fmtPokerNumber(item?.chips)}`,
            `本轮下注${this._fmtPokerNumber(item?.bet)}`,
            `总投入${this._fmtPokerNumber(item?.totalCommitted)}`,
            item?.folded ? '已弃牌' : '',
            item?.allIn ? '已全下' : '',
            item?.status ? `状态:${item.status}` : ''
        ].filter(Boolean).join('，')).join('\n');

        const legalActions = Array.isArray(pokerContext.legalActions) && pokerContext.legalActions.length
            ? pokerContext.legalActions.map(action => {
                const name = this._formatPokerActionName(action?.action);
                if (action?.amount !== undefined) return `${name}${this._fmtPokerNumber(action.amount)}`;
                if (action?.minAmount !== undefined) return `${name}至少${this._fmtPokerNumber(action.minAmount)}`;
                return name;
            }).join(' / ')
            : '无';

        const lines = [
            options.mode === 'chat' ? '【德州扑克牌桌聊天简报】' : '【德州扑克行动简报】',
            `当前第 ${table.handNo || '?'} 局，阶段：${table.street || '未知'}。`,
            `现在轮到：${table.activePlayer || player.name || '未知玩家'}。${options.allowMulti ? '本次可由多个微信好友按牌桌气氛发言。' : `你正在扮演：${player.name || table.activePlayer || '未知玩家'}。`}`,
            options.allowMulti ? '各微信好友手牌见下方“系统可见非用户玩家手牌”。' : `当前行动/回复玩家手牌：${privateHand}。`,
            '系统可见非用户玩家手牌：',
            visibleHandLines,
            '用户手牌：未提供。',
            `公共牌：${community}。`,
            `底池：${this._fmtPokerNumber(table.pot)}；当前最高下注：${this._fmtPokerNumber(table.currentBet)}；最小加注：${this._fmtPokerNumber(table.minRaise)}。`,
            `庄家：${table.dealer || '未知'}；小盲/大盲：${this._fmtPokerNumber(table.smallBlind)}/${this._fmtPokerNumber(table.bigBlind)}。`,
            '明面玩家状态：',
            playerLines || '暂无',
            '最近行动记录：',
            recentLog
        ];

        if (options.mode === 'chat') {
            lines.push(`用户刚在牌桌说：${pokerContext.userMessage || '（空）'}`);
            lines.push('请只给出牌桌发言，行动写“无行动”。');
        } else {
            if (options.userActionContext?.speech) {
                lines.push(`用户刚才把以下牌桌发言和本次行动一起打出：${options.userActionContext.speech}`);
                if (options.userActionContext.action) {
                    lines.push(`用户本次行动：${options.userActionContext.action}。`);
                }
            }
            lines.push(`本次合法行动：${legalActions}。`);
            lines.push('请根据你的手牌、公共牌、位置、筹码压力和最近行动做出一个合法行动。');
        }

        return lines.join('\n');
    }

    _formatPokerActionName(action = '') {
        const normalized = String(action || '').trim().toLowerCase();
        const map = {
            check: '过牌',
            call: '跟注',
            bet: '下注',
            raise: '加注',
            allin: '全下',
            fold: '弃牌'
        };
        return map[normalized] || normalized || '行动';
    }

    _fmtPokerNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? String(number) : '0';
    }

    _resolvePokerPrompt() {
        return this.getPokerPrompt().replace(/%POKER_PLAYERS%/g, this._getPokerPromptPlayerNames());
    }

    _getPokerPromptPlayerNames() {
        const state = this.gamesData.getState();
        const names = (state?.players || [])
            .filter(player => player.id !== 'user' && player.source === 'wechat')
            .map(player => String(player.name || '').trim())
            .filter(Boolean);
        if (names.length > 0) return names.join('、');

        const selected = this.getSelectedPokerContacts()
            .map(contact => String(contact.name || '').trim())
            .filter(Boolean);
        return selected.length > 0 ? selected.join('、') : '微信好友';
    }

    _showPokerAiError(playerName, error) {
        const message = this._formatError(error, 'AI 回复失败');
        this.gamesView?.showAiErrorDialog?.(`德州扑克 AI 失败`, `${playerName}：${message}`);
        this.phoneShell?.showNotification?.('德州扑克 AI 失败', `${playerName}：${message}`, '❌', {
            senderKey: `games-ai-error-${playerName}`
        });
    }

    _formatError(error, fallback = '未知错误') {
        if (!error) return fallback;
        if (typeof error === 'string') return error;
        const message = String(error.message || error.error || '').trim();
        const status = error.status || error.statusCode || error.code || '';
        const statusText = String(error.statusText || '').trim();
        return [message || fallback, status || statusText ? `status=${status || '?'}${statusText ? ` ${statusText}` : ''}` : '']
            .filter(Boolean)
            .join(' | ');
    }

    _parsePokerAiDecision(text, playerName = '') {
        const block = this._extractPokerTagBlock(text);
        const section = this._extractPokerPlayerSection(block, playerName);
        const speechLines = this._extractPokerFieldLines(section, '牌桌发言');
        const speech = speechLines.join(' ').trim();
        const actionText = this._extractPokerLine(section, '行动');
        const parsedAction = this._parsePokerActionText(actionText);
        return {
            ...parsedAction,
            speech,
            speechLines
        };
    }

    _extractPokerTagBlock(text) {
        const raw = String(text || '').trim();
        if (!raw) return '';
        const standard = raw.match(/<德州扑克>([\s\S]*?)<\/德州扑克>/);
        if (standard) return standard[1].trim();

        const openTag = '<德州扑克>';
        const first = raw.indexOf(openTag);
        if (first < 0) return raw;
        const second = raw.indexOf(openTag, first + openTag.length);
        if (second >= 0) return raw.slice(first + openTag.length, second).trim();
        return raw.slice(first + openTag.length).trim();
    }

    _extractPokerPlayerSection(block, playerName = '') {
        const source = String(block || '').trim();
        const name = String(playerName || '').trim();
        const sections = this._extractPokerSections(source);
        if (sections.length <= 0) return source;
        const exact = sections.find(item => item.name === name);
        if (exact) return exact.body;
        const fuzzy = sections.find(item => item.name.includes(name) || name.includes(item.name));
        return (fuzzy || sections[0]).body;
    }

    _parsePokerAiSections(text) {
        const block = this._extractPokerTagBlock(text);
        const sections = this._extractPokerSections(block);
        return sections.length ? sections : [{ name: '', body: block }];
    }

    _extractPokerSections(sourceText) {
        const source = String(sourceText || '').trim();
        const sections = [];
        const pattern = /--([^-]+?)--([\s\S]*?)(?=--[^-]+?--|$)/g;
        let match = null;
        while ((match = pattern.exec(source))) {
            sections.push({
                name: String(match[1] || '').trim(),
                body: String(match[2] || '').trim()
            });
        }
        return sections;
    }

    _resolvePokerSectionPlayerName(name, validNames = new Set()) {
        const raw = String(name || '').trim();
        if (!raw) return '';
        if (validNames.has(raw)) return raw;
        for (const valid of validNames) {
            if (raw.includes(valid) || valid.includes(raw)) return valid;
        }
        return '';
    }

    _extractPokerLine(section, label) {
        const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = String(section || '').match(new RegExp(`${escaped}\\s*[:：]\\s*([^\\n\\r]*)`));
        return String(match?.[1] || '').trim();
    }

    _extractPokerField(section, label) {
        return this._extractPokerFieldLines(section, label).join(' ').trim();
    }

    _extractPokerFieldLines(section, label) {
        const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = String(section || '').match(new RegExp(`${escaped}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:牌桌发言|行动)\\s*[:：]|\\n\\s*--[^-]+?--|$)`));
        return String(match?.[1] || '')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
    }

    _parsePokerActionText(actionText) {
        const text = String(actionText || '').trim().toLowerCase();
        const amount = this._extractFirstNumber(text);
        if (!text || /无行动|只聊天|聊天|发言/.test(text)) return { action: '', amount: 0 };
        if (/弃牌|fold/.test(text)) return { action: 'fold', amount: 0 };
        if (/过牌|看牌|check/.test(text)) return { action: 'check', amount: 0 };
        if (/跟注|call/.test(text)) return { action: 'call', amount };
        if (/全下|all[\s-]?in|allin/.test(text)) return { action: 'allin', amount };
        if (/加注|raise/.test(text)) return { action: 'raise', amount };
        if (/下注|bet/.test(text)) return { action: 'bet', amount };
        return { action: '', amount: 0 };
    }

    _extractFirstNumber(text) {
        const match = String(text || '').replace(/[,，]/g, '').match(/\d+(?:\.\d+)?/);
        return match ? Math.max(0, Math.round(Number(match[0]) || 0)) : 0;
    }

    _normalizePokerDecision(decision, legalActions = []) {
        const legalSet = new Set(legalActions.map(item => item.action));
        let action = String(decision?.action || '').toLowerCase();
        if (!legalSet.has(action)) {
            action = legalSet.has('check') ? 'check' : legalSet.has('call') ? 'call' : 'fold';
        }
        const legal = legalActions.find(item => item.action === action) || {};
        let amount = Number(decision?.amount || legal.amount || legal.minAmount || 0) || 0;
        if (action === 'call' || action === 'allin') {
            amount = Number(legal.amount || amount || 0) || 0;
        }
        if (action === 'bet' || action === 'raise') {
            amount = Math.max(Number(legal.minAmount || 0), amount);
            if (legal.maxAmount) amount = Math.min(Number(legal.maxAmount), amount);
        }
        return {
            action,
            amount,
            speech: String(decision?.speech || '').trim(),
            speechLines: Array.isArray(decision?.speechLines) ? decision.speechLines.map(line => String(line || '').trim()).filter(Boolean) : []
        };
    }

    backToLobby() {
        this.clearPokerSession();
        this.applyPhoneChromeTheme();
        this.currentView = 'lobby';
        this.gamesView.renderLobby();
    }

    applyPhoneChromeTheme() {
        document.querySelectorAll('.phone-body-panel-games').forEach(el => el.classList.remove('phone-body-panel-games'));
        const panel = document.querySelector('.phone-body-panel');
        panel?.classList.add('phone-body-panel-games');
    }

    removePhoneChromeTheme() {
        const panel = document.querySelector('.phone-body-panel');
        panel?.classList.remove('phone-body-panel-games');
    }

    _escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _escapeAttr(text) {
        return this._escapeHtml(text);
    }

    handleSwipeBack() {
        const currentView = document.querySelector('.phone-view-current');
        if (!currentView || !currentView.querySelector('.games-app')) return;

        if (this.currentView === 'poker') {
            this.backToLobby();
        } else {
            this.removePhoneChromeTheme();
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        }

        const screen = document.querySelector('.phone-screen');
        if (screen) {
            screen.style.pointerEvents = 'none';
            setTimeout(() => { screen.style.pointerEvents = ''; }, 400);
        }
    }
}
