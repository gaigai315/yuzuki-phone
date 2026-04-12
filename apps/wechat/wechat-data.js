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
// 微信数据管理
export class WechatData {
    constructor(storage) {
        this.storage = storage;
        this.storageKey = 'wechat_data';
        this.messageKeyPrefix = 'wechat_msg';  // 🔥 消息单独存储的键前缀
        this.walletDefaultKey = '__default__'; // 会话钱包默认键（用于未指定chatId时）

        // 🔥 懒加载机制：分离轻量数据和消息内容
        this._messagesLoaded = {};  // 记录哪些聊天的消息已加载
        this._messagesDirty = {};   // 记录哪些聊天的消息需要保存

        this.data = this.loadData();
    }

    /**
     * 🔥 懒加载：初始化时只加载轻量数据（聊天列表、联系人、用户信息）
     * 消息内容在进入聊天时才从单独的存储键加载
     */
    loadData() {
        try {
            const key = this.getStorageKey();
            const saved = this.storage.get(key, false);

            if (saved && saved.trim() !== '') {
                try {
                    const data = JSON.parse(saved);
                    const normalizedUserInfo = this._normalizeUserInfo(data.userInfo);

                    // 🔥 先构建 chats 数组（迁移需要用到）
                    const chats = data.chats || [];

                    // 🔥 数据迁移：检查是否有旧格式的 messages 数据
                    if (data.messages && Object.keys(data.messages).length > 0) {
                        console.log('🔄 [数据迁移] 检测到旧格式数据，开始迁移消息到独立存储...');
                        this._migrateOldMessages(data.messages, chats);

                        // 🔥 迁移完成后，保存更新的基础数据（不含 messages，防止重复迁移）
                        const migratedData = {
                            userInfo: normalizedUserInfo,
                            chats: chats,  // 已更新 timestamp
                            contacts: data.contacts || [],
                            moments: data.moments || [],
                            customEmojis: data.customEmojis || [],
                            contactGenderMap: data.contactGenderMap || {},
                            contactAutoAvatarMap: data.contactAutoAvatarMap || {},
                            walletByChat: data.walletByChat || {}
                            // 🔥 不再包含 messages 字段
                        };
                        this.storage.set(key, JSON.stringify(migratedData), false);
                        console.log('✅ [数据迁移] 基础数据已更新保存');
                    }

                    // 兼容旧版：若还没有会话钱包映射，则把历史全局余额迁移为默认钱包
                    const walletByChat = data.walletByChat || {};
                    if (Object.keys(walletByChat).length === 0) {
                        const legacyBalance = data.userInfo?.walletBalance;
                        if (legacyBalance !== null && legacyBalance !== undefined && !isNaN(legacyBalance)) {
                            walletByChat[this.walletDefaultKey] = parseFloat(legacyBalance);
                        }
                    }

                    // 🔥 懒加载：不加载 messages，初始为空
                    return {
                        userInfo: normalizedUserInfo,
                        chats: chats,
                        contacts: data.contacts || [],
                        messages: {},  // 🔥 初始为空，按需从单独存储加载
                        moments: data.moments || [],
                        customEmojis: data.customEmojis || [],
                        contactGenderMap: data.contactGenderMap || {},
                        contactAutoAvatarMap: data.contactAutoAvatarMap || {},
                        walletByChat: walletByChat
                    };
                } catch (parseError) {
                    console.error('❌ JSON解析失败:', parseError.message);
                    this.storage.set(key, null, false);
                    console.warn('⚠️ 已清空损坏的数据，将创建新数据');
                }
            }
        } catch (e) {
            console.error('❌ 加载微信数据失败:', e);
        }

        return {
            userInfo: this._normalizeUserInfo(null),
            chats: [],
            contacts: [],
            messages: {},
            moments: [],
            customEmojis: [],
            contactGenderMap: {},
            contactAutoAvatarMap: {},
            walletByChat: {}
        };
    }

    /**
     * 🔥 数据迁移：将旧格式的 messages 迁移到独立存储
     * @param {Object} oldMessages - 旧格式的消息数据
     * @param {Array} chats - 聊天列表（用于更新 timestamp）
     */
    _migrateOldMessages(oldMessages, chats) {
        let migratedCount = 0;

        for (const chatId in oldMessages) {
            const messages = oldMessages[chatId];
            if (messages && messages.length > 0) {
                try {
                    const msgKey = this._getMessageKey(chatId);
                    this.storage.set(msgKey, JSON.stringify(messages), false);
                    migratedCount++;

                    // 🔥 修复 chat.timestamp：从最后一条消息获取
                    const chat = chats.find(c => c.id === chatId);
                    if (chat && !chat.timestamp) {
                        const lastMsg = messages[messages.length - 1];
                        chat.timestamp = lastMsg.timestamp || Date.now();
                    }
                } catch (e) {
                    console.error(`❌ 迁移聊天 ${chatId} 消息失败:`, e);
                }
            }
        }

        console.log(`✅ [数据迁移] 已迁移 ${migratedCount} 个聊天的消息到独立存储`);
    }

    /**
     * 🔥 获取消息存储键（每个聊天单独存储）
     */
    _getMessageKey(chatId) {
        return `${this.messageKeyPrefix}_${chatId}`;
    }

    /**
     * 🔥 获取运行时用户名字（优先取 SillyTavern 的 name1）
     */
    _getRuntimeUserName() {
        try {
            const context = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
                ? SillyTavern.getContext()
                : null;
            const name = String(context?.name1 || '').trim();
            if (name) return name;
        } catch (e) {
            // ignore
        }
        return '我';
    }

    /**
     * 🔥 归一化用户信息：
     * - 首次默认昵称取 user 名
     * - 历史默认值“我”自动升级为当前 user 名
     * - 用户手动改过的昵称保持不变
     */
    _normalizeUserInfo(userInfo) {
        const normalized = {
            ...this._getDefaultUserInfo(),
            ...(userInfo || {})
        };

        const currentName = String(normalized.name || '').trim();
        if (!currentName || currentName === '我') {
            normalized.name = this._getRuntimeUserName();
        }

        return normalized;
    }

    /**
     * 🔥 获取默认用户信息
     */
    _getDefaultUserInfo() {
        return {
            name: this._getRuntimeUserName(),
            wxid: 'wxid_' + Math.random().toString(36).substr(2, 9),
            avatar: '',
            signature: '',
            chatCustomCss: '',
            coverImage: null,
            momentsBackground: null,
            walletBalance: null
        };
    }
    
    getStorageKey() {
    // 🔥 修复：这个方法只应该返回数据类型，而不是完整的键。
    // 完整的键由 storage.js 统一构建。
    return this.storageKey; // this.storageKey 在构造函数中定义为 'wechat_data'
}
    
    async saveData() {
        try {
            // 🔥 验证数据有效性
            if (!this.data) {
                console.error('❌ 无效的数据，无法保存');
                return;
            }

            // 🔥 1. 保存基础数据（不含消息内容）
            const baseData = {
                userInfo: this.data.userInfo,
                chats: this.data.chats,
                contacts: this.data.contacts,
                moments: this.data.moments,
                customEmojis: this.data.customEmojis,
                contactGenderMap: this.data.contactGenderMap || {},
                contactAutoAvatarMap: this.data.contactAutoAvatarMap || {},
                walletByChat: this.data.walletByChat || {}
                // 🔥 messages 不再保存到主数据中
            };

            const key = this.getStorageKey();
            const jsonStr = JSON.stringify(baseData);

            if (!jsonStr || jsonStr === 'null' || jsonStr === 'undefined') {
                console.error('❌ JSON序列化失败:', jsonStr);
                return;
            }

            await this.storage.set(key, jsonStr, false);

            // 🔥 2. 保存已修改的消息（每个聊天单独存储）
            for (const chatId in this._messagesDirty) {
                if (this._messagesDirty[chatId]) {
                    this._saveMessages(chatId);
                    this._messagesDirty[chatId] = false;
                }
            }
        } catch (e) {
            console.error('❌ 保存微信数据失败:', e);
        }
    }

    /**
     * 🗑️ 彻底重置微信数据（清空当前角色的所有微信内容）
     * 会删除独立存储的 wechat_msg_xxx 消息键，防止幽灵数据残留
     */
    resetAllData() {
        // 1. 删除每个聊天的独立消息存储键
        const chatIds = Array.isArray(this.data.chats) ? this.data.chats.map(c => c.id) : [];
        this._removeMessageStoresByChatIds(chatIds);

        // 2. 清空内存中的懒加载标记
        this._messagesLoaded = {};
        this._messagesDirty = {};

        // 3. 重置内存数据为出厂状态
        this.data = {
            userInfo: this._getDefaultUserInfo(),
            chats: [],
            contacts: [],
            messages: {},
            moments: [],
            customEmojis: [],
            contactGenderMap: {},
            contactAutoAvatarMap: {},
            walletByChat: {}
        };

        // 4. 保存重置后的空数据
        this.saveData();

        // 5. 触发 chatMetadata 立即持久化
        this._flushChatMetadata();
    }

    // 🧹 清理全部聊天数据（保留联系人/朋友圈）
    clearAllChatData() {
        const chatIds = Array.isArray(this.data.chats) ? this.data.chats.map(c => c.id) : [];
        this._removeMessageStoresByChatIds(chatIds);

        this.data.chats = [];
        this.data.messages = {};
        this.data.walletByChat = {};
        this._messagesLoaded = {};
        this._messagesDirty = {};

        window.VirtualPhone?.timeManager?.resetTime();
        this.saveData();
        this._flushChatMetadata();
    }

    // 🧹 清理朋友圈数据（仅朋友圈内容）
    clearMomentsData() {
        this.data.moments = [];
        this.saveData();
    }

    _removeMessageStoresByChatIds(chatIds = []) {
        if (!Array.isArray(chatIds) || chatIds.length === 0) return;

        const chatStore = this.storage._getChatMetadataStore?.();
        chatIds.forEach(chatId => {
            if (!chatId) return;
            const msgKey = this._getMessageKey(chatId);

            if (chatStore && chatStore[msgKey] !== undefined) {
                delete chatStore[msgKey];
            }

            try {
                this.storage.set(msgKey, null, false);
            } catch (e) {
                // ignore
            }

            try {
                const legacyKey = `${this.storage.storageKey}_${this.storage.getStorageKey(msgKey)}`;
                localStorage.removeItem(legacyKey);
            } catch (e) {
                // ignore
            }

            delete this._messagesLoaded[chatId];
            delete this._messagesDirty[chatId];
        });
    }

    _flushChatMetadata() {
        if (this.storage._saveChatTimer) {
            clearTimeout(this.storage._saveChatTimer);
        }
        const context = this.storage.getContext();
        if (context && typeof context.saveChat === 'function') {
            context.saveChat();
        }
    }

    getUserInfo() {
        return this.data.userInfo;
    }

    getWalletBalance(chatId = null) {
        if (!this.data.walletByChat) this.data.walletByChat = {};
        const key = chatId || this.walletDefaultKey;
        let balance = this.data.walletByChat[key];

        // chatId 没有独立钱包时，回落到默认钱包（仅读取，不写入）
        if (balance === undefined && chatId) {
            balance = this.data.walletByChat[this.walletDefaultKey];
        }
        return balance === undefined ? null : balance;
    }

    // 设置钱包金额（初始化用）
    setWalletBalance(amount, chatId = null) {
        if (!this.data.walletByChat) this.data.walletByChat = {};
        const key = chatId || this.walletDefaultKey;
        this.data.walletByChat[key] = parseFloat(amount);
        this.saveData();
    }

    // 变更钱包金额（收发红包/转账用，传入正数加钱，负数扣钱）
    updateWalletBalance(delta, chatId = null) {
        if (!this.data.walletByChat) this.data.walletByChat = {};
        const key = chatId || this.walletDefaultKey;
        let current = this.data.walletByChat[key];

        // chatId 首次使用时，若存在默认钱包则继承默认值
        if ((current === null || current === undefined) && chatId) {
            const inherited = this.data.walletByChat[this.walletDefaultKey];
            if (inherited !== null && inherited !== undefined && !isNaN(inherited)) {
                current = parseFloat(inherited);
            }
        }

        if (current === null || current === undefined || isNaN(current)) {
            current = 0; // 如果没初始化就强行收发，默认从0开始算
        }

        this.data.walletByChat[key] = Math.max(0, current + parseFloat(delta));
        this.saveData();
    }
    
    updateUserInfo(info) {
        Object.assign(this.data.userInfo, info);
        this.saveData();
    }
    
    getChatList() {
        // 🔥 按时间排序：最新消息的聊天在最前面
        // 使用 chat.timestamp，不读取消息（保持懒加载）
        return [...this.data.chats].sort((a, b) => {
            const timeA = a.timestamp || 0;
            const timeB = b.timestamp || 0;
            return timeB - timeA; // 降序排列（时间戳越大的越靠前）
        });
    }
    
    getChat(chatId) {
        return this.data.chats.find(c => c.id === chatId);
    }
    
    createChat(chatInfo) {
        const chat = {
            id: chatInfo.id || Date.now().toString(),
            contactId: chatInfo.contactId,
            name: chatInfo.name,
            type: chatInfo.type || 'single',
            avatar: chatInfo.avatar,
            lastMessage: '',
            time: '刚刚',
            unread: 0,
            timestamp: Date.now(),
            members: chatInfo.members || []
        };

        this.data.chats.push(chat);
        this.saveData();
        return chat;
    }
    
    getChatByContactId(contactId) {
        return this.data.chats.find(c => c.contactId === contactId);
    }
    
    /**
     * 🔥 懒加载：只在需要时才从单独存储加载该聊天的消息
     */
    getMessages(chatId) {
        // 🔥 如果内存中还没有这个数组，先初始化
        if (!this.data.messages[chatId]) {
            this.data.messages[chatId] = [];
        }

        // 🔥 如果该聊天的消息还没加载，且内存中当前也没有新消息，才从单独存储加载
        if (!this._messagesLoaded[chatId]) {
            try {
                const msgKey = this._getMessageKey(chatId);
                const saved = this.storage.get(msgKey, false);

                if (saved && saved.trim() !== '') {
                    const parsedData = JSON.parse(saved);
                    // 🛡️ 防覆盖结界：只有当本地解析出来的数据比内存多，或者内存完全为空时，才合并进去
                    if (Array.isArray(parsedData) && parsedData.length > 0) {
                        if (this.data.messages[chatId].length === 0) {
                            this.data.messages[chatId] = parsedData;
                        }
                    }
                }
            } catch (e) {
                console.warn(`⚠️ 加载聊天 ${chatId} 消息失败:`, e);
            }
            this._messagesLoaded[chatId] = true;
        }

        // 🔥 给没有id的旧消息补上id
        let patched = false;
        this.data.messages[chatId].forEach((m, i) => {
            if (!m.id) {
                m.id = `msg_legacy_${chatId}_${i}`;
                patched = true;
            }
        });
        if (patched) this._messagesDirty[chatId] = true;
        return this.data.messages[chatId];
    }

    /**
     * 🔥 保存单个聊天的消息（独立存储），完全同步化，拒绝异步抢占
     */
    _saveMessages(chatId) {
        if (!this.data.messages[chatId]) return;

        try {
            const msgKey = this._getMessageKey(chatId);
            // 强行同步序列化，确保存储的绝对是最新切片
            const safeData = JSON.stringify(this.data.messages[chatId]);
            this.storage.set(msgKey, safeData, false);
        } catch (e) {
            console.error(`❌ 保存聊天 ${chatId} 消息失败:`, e);
        }
    }

    getContactByName(name) {
        // 优先从联系人列表找
        let contact = this.data.contacts.find(c => c.name === name);
        if (contact) return contact;

        // 如果找不到，再从聊天列表里找（比如群聊或者临时会话）
        contact = this.data.chats.find(c => c.name === name);
        if (contact) return contact;

        // 如果还是找不到，检查是不是自己
        if (name === this.data.userInfo.name || name === 'me') {
            return this.data.userInfo;
        }
        
        return null;
    }
    
       addMessage(chatId, message) {
        // 🔥 关键修复：先触发懒加载，避免在“未打开聊天”的情况下把历史消息数组覆盖成空
        const loadedMessages = this.getMessages(chatId);
        if (!Array.isArray(loadedMessages)) {
            this.data.messages[chatId] = [];
        }

        // 🔥 记录消息在酒馆对话中的位置 (只在外部未传入时才兜底计算，极为重要)
        if (message.tavernMessageIndex === undefined) {
            try {
                const context = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
                if (context && context.chat && Array.isArray(context.chat)) {
                    message.tavernMessageIndex = Math.max(0, context.chat.length - 1);
                } else {
                    message.tavernMessageIndex = 0;
                }
            } catch (e) {
                console.error('❌ 记录索引失败:', e);
                message.tavernMessageIndex = 0;
            }
        }

        // 🔥🔥🔥 核心防御：亡灵拦截结界 🔥🔥🔥
        let chat = this.getChat(chatId);
        if (chat && chat.clearedAt_tavernIndex !== undefined && message.tavernMessageIndex !== undefined) {
            // 如果这条消息的楼层小于用户点击清空时的楼层，直接拒收
            if (message.tavernMessageIndex < chat.clearedAt_tavernIndex) {
                return false; 
            }
        }

        // 🔥🔥🔥 核心清洗：同楼层流式碎片与废案清洗机制 🔥🔥🔥
        if (message.tavernMessageIndex !== undefined && message.batchId && message.fromMainChatTag) {
            const originalLen = this.data.messages[chatId].length;
            this.data.messages[chatId] = this.data.messages[chatId].filter(m => {
                // 如果是同一层楼，且来自于正文解析，但是批次号不同，说明是 AI 重新生成的废案或者旧的流式碎片，直接抛弃！
                if (m.tavernMessageIndex === message.tavernMessageIndex && m.fromMainChatTag && m.batchId !== message.batchId) {
                    return false; 
                }
                return true;
            });
            if (this.data.messages[chatId].length !== originalLen) {
                this._messagesDirty[chatId] = true;
            }
        }

        // 🔥 动态拦截表情包与语音（线上模式）
        if ((message.type === 'text' || !message.type) && message.content) {
            const contentStr = message.content.trim();
            const stickerMatch = /^\[表情包\]\s*[（(]\s*([^)）]+?)\s*[)）]\s*$/.exec(contentStr);
            if (stickerMatch) {
                message.type = 'sticker';
                message.keyword = stickerMatch[1].trim();
            }
            const newVoiceMatch = /^\[语音\]\s*(.+)$/.exec(contentStr);
            if (newVoiceMatch) {
                message.type = 'voice';
                message.voiceText = newVoiceMatch[1].trim();
                let seconds = Math.ceil(message.voiceText.length / 3);
                seconds = Math.max(2, Math.min(seconds, 60));
                message.duration = seconds + '"';
            }
        }

        // 🔥 防重复检测：避免 AI 重复输出导致消息重影
        const recentMessages = this.data.messages[chatId].slice(-30);
        const msgType = String(message.type || 'text');
        const msgFrom = String(message.from || '');
        const msgContent = String(message.content || '');

        const isDuplicate = recentMessages.some(m => {
            if (String(m.from || '') !== msgFrom) return false;
            if (String(m.content || '') !== msgContent) return false;
            if (String(m.type || 'text') !== msgType) return false;

            // 只要同楼层且内容完全一致，必定是重复触发
            if (message.tavernMessageIndex !== undefined && m.tavernMessageIndex !== undefined) {
                return Number(m.tavernMessageIndex) === Number(message.tavernMessageIndex);
            }
            return false;
        });
        if (isDuplicate) return false; // 拦截重复

        // 🔥 时间戳保底机制
        if (!message.time) {
            message.time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        }
        if (!message.timestamp) {
            // 🔥 优先根据 date + time 计算剧情时间戳（修复线下转线上跨天时间不更新）
            if (message.date && message.time) {
                try {
                    const dateParts = message.date.match(/(\d{1,6})[-\/年]\s*(\d{1,2})[-\/月]\s*(\d{1,2})\s*日?/);
                    const timeParts = message.time.match(/(\d{1,2})[:：](\d{2})/);
                    if (dateParts && timeParts) {
                        const dateObj = new Date(parseInt(dateParts[1]), parseInt(dateParts[2]) - 1, parseInt(dateParts[3]), parseInt(timeParts[1]), parseInt(timeParts[2]));
                        message.timestamp = dateObj.getTime();
                    } else {
                        message.timestamp = Date.now();
                    }
                } catch (e) {
                    message.timestamp = Date.now();
                }
            } else {
                message.timestamp = Date.now();
            }
        }
        if (!message.realTimestamp) {
            message.realTimestamp = Date.now();
        }
        if (!message.id) {
            message.id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        }

        // 🔥 将消息真正塞入内存
        this.data.messages[chatId].push(message);

        // 🔥 同步更新聊天列表的预览
        chat = this.getChat(chatId);
        if (chat) {
            chat.lastMessage = this.getMessagePreview(message);
            chat.time = message.time;
            chat.timestamp = message.timestamp || Date.now();
        }

        // 🔥 标记需要持久化
        this._messagesLoaded[chatId] = true;
        this._messagesDirty[chatId] = true;

        // 🔥🔥🔥 核心修复：立即同步保存消息到独立存储，不依赖 async saveData() 的延迟调度！
        // 这确保了 render() 中 loadData() 重新加载时，存储里已经有最新消息。
        this._saveMessages(chatId);

        this.saveData();
        return true;
    }

/**
 * 🔥 获取消息预览文本（用于聊天列表显示）
 */
getMessagePreview(message) {
    switch (message.type) {
        case 'image':
            return '[图片]';
        case 'voice':
            return '[语音]';
        case 'video':
            return '[视频]';
        case 'sticker':
            return '[表情包]';
        case 'transfer':
            return `[转账] ¥${message.amount || ''}`;
        case 'redpacket':
            return '[红包]';
        case 'call_record':
            return message.callType === 'video' ? '[视频通话]' : '[语音通话]';
        case 'call_text':
            const icon = message.callType === 'video' ? '📹' : '📞';
            return `${icon} ${message.content || ''}`;
        case 'weibo_card':
            return '[微博分享]';
        default:
            return message.content || '';
    }
}

/**
 * 🔧 辅助方法：获取星期几
 */
getWeekday(date) {
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return weekdays[date.getDay()];
}
    
    getContacts() {
        return this.data.contacts;
    }

    getContact(contactId) {
        return this.data.contacts.find(c => c.id === contactId);
    }

    _normalizeGenderValue(gender) {
        const raw = String(gender || '').trim().toLowerCase();
        if (raw === 'male' || raw === 'm' || raw === '男') return 'male';
        if (raw === 'female' || raw === 'f' || raw === '女') return 'female';
        return 'unknown';
    }

    _getContactGenderMapKey(contactIdOrName) {
        const raw = String(contactIdOrName || '').trim();
        if (!raw) return '';
        const byId = this.data.contacts.find(c => c.id === raw);
        if (byId?.id) return byId.id;
        const byName = this.data.contacts.find(c => c.name === raw);
        if (byName?.id) return byName.id;
        return raw;
    }

    getContactGenderMap() {
        if (!this.data.contactGenderMap || typeof this.data.contactGenderMap !== 'object') {
            this.data.contactGenderMap = {};
        }
        return this.data.contactGenderMap;
    }

    getContactGender(contactIdOrName) {
        const key = this._getContactGenderMapKey(contactIdOrName);
        if (!key) return 'unknown';
        const map = this.getContactGenderMap();
        return this._normalizeGenderValue(map[key]);
    }

    setContactGender(contactIdOrName, gender) {
        const key = this._getContactGenderMapKey(contactIdOrName);
        if (!key) return false;
        const safeGender = this._normalizeGenderValue(gender);
        const map = this.getContactGenderMap();
        map[key] = safeGender;
        this.saveData();
        return true;
    }

    getContactAutoAvatarMap() {
        if (!this.data.contactAutoAvatarMap || typeof this.data.contactAutoAvatarMap !== 'object') {
            this.data.contactAutoAvatarMap = {};
        }
        return this.data.contactAutoAvatarMap;
    }

    getContactAutoAvatar(contactIdOrName) {
        const key = this._getContactGenderMapKey(contactIdOrName);
        if (!key) return '';
        const map = this.getContactAutoAvatarMap();
        return String(map[key] || '').trim();
    }

    setContactAutoAvatar(contactIdOrName, avatarUrl) {
        const key = this._getContactGenderMapKey(contactIdOrName);
        if (!key) return false;
        const map = this.getContactAutoAvatarMap();
        const safeUrl = String(avatarUrl || '').trim();
        if (!safeUrl) {
            delete map[key];
        } else {
            map[key] = safeUrl;
        }
        this.saveData();
        return true;
    }

    addContact(contact) {
        this.data.contacts.push(contact);
        this.saveData();
    }

    // 🔥 更新联系人信息（包括头像和名字双向同步）
    updateContact(contactId, updates) {
        const contact = this.data.contacts.find(c => c.id === contactId);
        if (contact) {
            const oldName = contact.name; // 记录旧名字
            Object.assign(contact, updates);

            // 🔥 新增：如果修改了名字，同步更新关联的聊天窗口名字
            if (updates.name && updates.name !== oldName) {
                const chat = this.getChatByContactId(contactId);
                if (chat) {
                    chat.name = updates.name;
                } else {
                    // 兜底：兼容没有 contactId 的旧数据，通过旧名字匹配单聊
                    const chatByName = this.data.chats.find(c => c.type !== 'group' && c.name === oldName);
                    if (chatByName) chatByName.name = updates.name;
                }
            }

            this.saveData();
            return true;
        }
        return false;
    }

    // 🔥 同步头像到所有相关位置（聊天、联系人）
    syncContactAvatar(contactIdOrName, avatar) {
        let foundContact = false;
        let foundChat = false;

        // 1. 尝试通过 contactId 查找联系人
        let contact = this.data.contacts.find(c => c.id === contactIdOrName);

        // 2. 如果找不到，尝试通过名字查找
        if (!contact) {
            contact = this.data.contacts.find(c => c.name === contactIdOrName);
        }

        if (contact) {
            contact.avatar = avatar;
            foundContact = true;
        }

        // 3. 更新相关聊天（通过 contactId 或名字）
        this.data.chats.forEach(chat => {
            if (chat.contactId === contactIdOrName || chat.name === contactIdOrName ||
                (contact && chat.contactId === contact.id) || (contact && chat.name === contact.name)) {
                chat.avatar = avatar;
                foundChat = true;
            }
        });

        this.saveData();
    }

    // 🔥 通过聊天对象同步头像（更可靠）
    syncAvatarByChat(chat, avatar) {
        // 1. 更新聊天本身
        chat.avatar = avatar;

        // 2. 通过 contactId 更新联系人
        if (chat.contactId) {
            const contact = this.data.contacts.find(c => c.id === chat.contactId);
            if (contact) {
                contact.avatar = avatar;
            }
        }

        // 3. 通过名字更新联系人
        const contactByName = this.data.contacts.find(c => c.name === chat.name);
        if (contactByName) {
            contactByName.avatar = avatar;
        }

        this.saveData();
    }
    
    getMoments() {
        return this.data.moments;
    }
    
    getMoment(momentId) {
        return this.data.moments.find(m => m.id === momentId);
    }
    
    addMoment(moment) {
        this.data.moments.unshift(moment);
        this.saveData();
    }
    
 // ✅ 智能加载联系人（调用AI）
async loadContactsFromCharacter() {
    try {
        // 🔑 定义 context
        const context = typeof SillyTavern !== 'undefined' && SillyTavern.getContext 
            ? SillyTavern.getContext() 
            : null;
        
        if (!context) {
            return { success: false, message: '❌ 无法获取SillyTavern上下文' };
        }
        
        
        // ✅ 构建AI提示词
        const prompt = this.buildContactPrompt(context);
        
        
        // ✅ 调用AI
        const aiResponse = await this.sendToAI(prompt);
        
        if (!aiResponse) {
            throw new Error('AI未返回数据');
        }
        
        
        // ✅ 解析AI返回
        const generatedData = this.parseAIResponse(aiResponse);
        
        if (!generatedData || !generatedData.contacts) {
            throw new Error('AI返回的数据格式错误');
        }
        
        // 🔒 幂等保护：已存在的好友/群绝不覆盖，仅新增不存在的
        const normalizeName = (raw) => {
            return String(raw || '')
                .trim()
                .replace(/\s+/g, '')
                .replace(/[（(][^（）()]*[）)]/g, '') // 忽略尾部关系备注
                .toLowerCase();
        };

        // ✅ 添加联系人（仅补全缺失，不覆盖已有）
        let addedCount = 0;
        let addedGroupCount = 0;
        const selfNameKey = normalizeName(context?.name1 || '用户');
        const existingContactKeys = new Set(this.data.contacts.map(c => normalizeName(c.name)));

        const ensureContact = (rawName, options = {}) => {
            const displayName = String(rawName || '').trim();
            const key = normalizeName(displayName);
            if (!displayName || !key || key === selfNameKey) return null;

            const existed = this.data.contacts.find(c => normalizeName(c.name) === key);
            if (existed) return { contact: existed, created: false };

            const relation = options.relation || '';
            const avatar = options.avatar || '';
            const newContact = {
                id: `contact_${Date.now()}_${Math.random()}`,
                name: displayName,
                avatar,
                remark: options.remark || '',
                letter: this.getFirstLetter(displayName),
                relation
            };
            this.data.contacts.push(newContact);
            existingContactKeys.add(key);
            return { contact: newContact, created: true };
        };

        generatedData.contacts.forEach(contact => {
            const result = ensureContact(contact?.name, {
                avatar: contact?.avatar || '',
                relation: contact?.relation || '',
                remark: contact?.remark || ''
            });
            if (result?.created) addedCount++;
        });
        
        // ✅ 添加群聊（仅补全缺失，不覆盖已有）
        if (generatedData.groups && generatedData.groups.length > 0) {
            const existingChatKeys = new Set(this.data.chats.map(c => normalizeName(c.name)));
            const batchGroupKeys = new Set();

            generatedData.groups.forEach(group => {
                const groupName = String(group?.name || '').trim();
                const key = normalizeName(groupName);
                if (!groupName || !key) return;

                // 先规范化群成员：
                // - 允许不是好友的人出现在群里
                // - 但绝不因为群成员而自动新增通讯录联系人
                const groupMemberNames = [];
                const groupMemberKeys = new Set();
                const sourceMembers = Array.isArray(group?.members) ? group.members : [];

                sourceMembers.forEach(memberRaw => {
                    const raw = String(memberRaw || '').trim();
                    if (!raw) return;
                    const cleaned = raw.replace(/\s*[（(][^()（）]+[）)]\s*$/g, '').trim();
                    const memberKey = normalizeName(cleaned);
                    if (!cleaned || !memberKey || memberKey === selfNameKey || groupMemberKeys.has(memberKey)) return;

                    // 若该成员本身在通讯录里，优先使用通讯录中的规范名称
                    const existedContact = this.data.contacts.find(c => normalizeName(c.name) === memberKey);
                    const finalName = existedContact?.name || cleaned;
                    const finalKey = normalizeName(finalName);
                    if (!finalKey || finalKey === selfNameKey || groupMemberKeys.has(finalKey)) return;

                    groupMemberKeys.add(finalKey);
                    groupMemberNames.push(finalName);
                });

                // 已有群：仅补充 AI 明确给出的成员（不覆盖、不清空、不自动新增好友）
                const existedGroup = this.data.chats.find(c => c.type === 'group' && normalizeName(c.name) === key);
                if (existedGroup) {
                    const existedMembers = Array.isArray(existedGroup.members) ? existedGroup.members : [];
                    const existedMemberKeys = new Set(existedMembers.map(m => normalizeName(m)).filter(Boolean));
                    const mergedMembers = [...existedMembers];

                    groupMemberNames.forEach(memberName => {
                        const mk = normalizeName(memberName);
                        if (!mk || mk === selfNameKey || existedMemberKeys.has(mk)) return;
                        existedMemberKeys.add(mk);
                        mergedMembers.push(memberName);
                    });

                    existedGroup.members = mergedMembers;
                    return;
                }

                // 本批次重复群名 -> 跳过
                if (batchGroupKeys.has(key)) return;

                const chatId = `group_${Date.now()}_${Math.random()}`;
                this.data.chats.push({
                    id: chatId,
                    name: groupName,
                    type: 'group',
                    avatar: group.avatar || '',
                    lastMessage: '',
                    time: '刚刚',
                    unread: 0,
                    members: groupMemberNames
                });
                addedGroupCount++;
                existingChatKeys.add(key);
                batchGroupKeys.add(key);
                
                if (group.lastMessage) {
                    this.addMessage(chatId, {
                        from: groupMemberNames[0] || '群成员',
                        content: group.lastMessage,
                        time: '刚刚',
                        type: 'text',
                        avatar: '👤'
                    });
                }
            });
        }

        // 🔥 保存初始时间（如果有）
        if (generatedData.initialTime) {
            this.storage.set('story-initial-time', JSON.stringify(generatedData.initialTime), true);
        }

        await this.saveData();
        
        return {
            success: true,
            count: addedCount,
            time: generatedData.initialTime || null,
            message: `✅ 新增${addedCount}个联系人，新增${addedGroupCount}个群聊（已有项已跳过）`
        };
        
    } catch (error) {
        console.error('❌ AI生成失败:', error);
        return {
            success: false,
            message: `生成失败: ${error.message}`
        };
    }
}
    
// 🔧 构建联系人生成提示词（重构版）
buildContactPrompt(context) {
    const charName = context?.name2 || context?.name || '角色';
    const userName = context?.name1 || '用户';
    const char = (context?.characters && context.characterId !== undefined)
        ? context.characters[context.characterId]
        : null;

    const personality = (char?.personality || char?.description || '').trim();
    const scenario = (context?.scenario || char?.scenario || '').trim();

    let persona = '';
    const personaTextarea = document.getElementById('persona_description');
    if (personaTextarea && personaTextarea.value) {
        persona = personaTextarea.value.trim();
    }

    let worldBook = '';
    if (char?.data?.character_book?.entries) {
        const entries = char.data.character_book.entries;
        const chunks = [];
        entries.forEach((entry, idx) => {
            if (!entry?.content) return;
            const title = entry.comment || entry.keys || `条目${idx + 1}`;
            chunks.push(`【${title}】\n${entry.content}`);
        });
        worldBook = chunks.join('\n\n');
    }

    let chatHistory = '';
    if (Array.isArray(context?.chat) && context.chat.length > 0) {
        chatHistory = context.chat.slice(-20).map(msg => {
            const speaker = msg.is_user ? userName : charName;
            const rawText = msg.mes || msg.content || '';
            const cleanText = String(rawText).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
            return `${speaker}: ${cleanText.substring(0, 300)}`;
        }).join('\n');
    }

    const promptManager = window.VirtualPhone?.promptManager;
    if (!promptManager) {
        throw new Error('PromptManager 未初始化');
    }
    if (!promptManager._loaded && typeof promptManager.ensureLoaded === 'function') {
        promptManager.ensureLoaded();
    }

    const loadContactsPrompt = promptManager.getPromptForFeature('wechat', 'loadContacts');
    if (!loadContactsPrompt) {
        throw new Error('未找到智能加载联系人提示词');
    }

    const sections = [
        `【主角信息】\n姓名：${charName}\n性格：${personality || '未知'}`,
        `【场景设定】\n${scenario || '暂无场景设定'}`,
        `【用户信息】\n姓名：${userName}\n${persona || '暂无用户信息'}`,
        `【世界书背景】\n${worldBook || '暂无世界书背景'}`,
        `【聊天记录】\n${chatHistory || '暂无聊天记录'}`
    ];

    return `${sections.join('\n\n')}\n\n${loadContactsPrompt}`;
}

// 🔧 辅助方法：判断是否可能是人名
isPossibleName(str) {
    if (!str || typeof str !== 'string') return false;
    
    const s = str.trim();
    
    // 长度检查
    if (s.length < 2 || s.length > 10) return false;
    
    // 排除系统字段
    if (this.isSystemField(s)) return false;
    
    // 排除纯数字
    if (/^\d+$/.test(s)) return false;
    
    // 排除包含特殊符号的
    if (/[【】\{\}\[\]<>\/\\]/.test(s)) return false;
    
    // 中文名字规则（2-4个汉字）
    if (/^[\u4e00-\u9fa5]{2,4}$/.test(s)) return true;
    
    // 称呼类
    if (['妈妈', '爸爸', '爷爷', '奶奶', '老师', '同学', '朋友', '同事', '老板'].includes(s)) return true;
    
    // 带姓氏的可能性更大
    const commonSurnames = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡'];
    if (commonSurnames.some(surname => s.startsWith(surname))) return true;
    
    return false;
}

// 🔧 辅助方法：判断是否是系统字段
isSystemField(str) {
    if (!str) return true;
    
    const systemKeywords = [
        '时代', '天气', '地点', '年龄', '全局时间', '待办', '区域', '方位', 
        '生理', '物品', '静态', '动态', '状态', '数值', '日期', '时间',
        '服装', '服饰', '佩戴', '位置', '当前', '主角', '用户', 'NPC'
    ];
    
    return systemKeywords.some(keyword => str.includes(keyword));
}
    
async sendToAI(prompt) {
        try {
            const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
            if (!context) throw new Error('无法获取 SillyTavern 上下文');

            const messages = [
                { role: 'system', content: '你是一个数据分析助手，不要进行角色扮演。严格遵循用户消息中的输出格式要求。' },
                { role: 'user', content: prompt }
            ];

            // 🚀 核心：移交 ApiManager 处理
            const apiManager = window.VirtualPhone?.apiManager;
            if (!apiManager) throw new Error('API Manager 未初始化');

            const resolvedMaxTokens = Number.parseInt(context?.max_response_length, 10)
                || Number.parseInt(context?.max_length, 10)
                || Number.parseInt(context?.amount_gen, 10);
            const callAiOptions = { appId: 'wechat' };
            if (Number.isFinite(resolvedMaxTokens) && resolvedMaxTokens > 0) {
                callAiOptions.max_tokens = resolvedMaxTokens;
            }
            const result = await apiManager.callAI(messages, callAiOptions);

            if (!result.success) {
                throw new Error(result.error);
            }

            return result.summary; // 直接返回字符串，后续逻辑会自动解析 JSON

        } catch (error) {
            console.error('❌ [AI调用] 失败:', error);
            throw error;
        }
    }
    
// 📥 解析AI返回（正则版）
parseAIResponse(text) {
    if (!text || typeof text !== 'string') {
        throw new Error('AI 返回为空');
    }

    const initMatch = text.match(/<初始化设定>([\s\S]*?)<\/初始化设定>/);
    if (!initMatch) {
        throw new Error('未找到 <初始化设定> 标签');
    }
    const initText = initMatch[1];

    const groupBlockMatch = initText.match(/---【微信群】---([\s\S]*?)(?=---【微信好友】---)/);
    if (!groupBlockMatch) {
        throw new Error('未找到微信群段落');
    }
    const parseMemberList = (raw) => {
        return String(raw || '')
            .split(/[、,，/|；;]+/)
            .map(s => s.trim())
            .map(s => s.replace(/\s*[（(][^()（）]+[）)]\s*$/g, '').trim())
            .filter(Boolean);
    };
    const groups = groupBlockMatch[1]
        .split('\n')
        .map(line => line.replace(/^\s*\d+\.\s*/, '').replace(/^[\-•]\s*/, '').trim())
        .filter(Boolean)
        .map(rawLine => {
            let name = rawLine;
            let members = [];

            // 格式1：群名（成员1、成员2）/ 群名（成员1）
            const withParenMatch = rawLine.match(/^(.+?)\s*[（(]\s*([^()（）]+)\s*[）)]\s*$/);
            if (withParenMatch) {
                name = withParenMatch[1].trim();
                members = parseMemberList(withParenMatch[2]);
            } else {
                // 格式2：群名: 成员1、成员2 / 群名-成员: 成员1、成员2 / 群名: 成员1
                const withColonMatch = rawLine.match(/^(.+?)(?:[：:\-]\s*成员)?[：:]\s*(.+)$/);
                if (withColonMatch) {
                    name = withColonMatch[1].trim();
                    members = parseMemberList(withColonMatch[2]);
                }
            }

            return {
                name,
                avatar: '',
                members: Array.from(new Set(members))
            };
        })
        .filter(g => g.name);

    const contactBlockMatch = initText.match(/---【微信好友】---([\s\S]*?)(?=---【初始时间】---)/);
    if (!contactBlockMatch) {
        throw new Error('未找到微信好友段落');
    }
    const contacts = contactBlockMatch[1]
        .split('\n')
        .map(line => line.replace(/^\s*\d+\.\s*/, '').replace(/^[\-•]\s*/, '').trim())
        .filter(Boolean)
        .map(rawLine => {
            let name = rawLine;
            let relation = '';
            const relationMatch = rawLine.match(/^(.+?)\s*[（(]\s*([^()（）]+)\s*[）)]\s*$/);
            if (relationMatch) {
                name = relationMatch[1].trim();
                relation = relationMatch[2].trim();
            }
            if (!name) return null;
            return {
                name,
                avatar: '',
                relation,
                remark: ''
            };
        })
        .filter(Boolean);

    const timeBlockMatch = initText.match(/---【初始时间】---([\s\S]*)/);
    if (!timeBlockMatch) {
        throw new Error('未找到初始时间段落');
    }
    const timeBlock = timeBlockMatch[1];

    // 🔥 核心修复：年份改为 \d{1,8}，支持 1年 到 99999999年 的修仙/科幻/古代背景
    // 允许年月日和时间之间有任意空格，支持中文冒号
    let datetimeLineMatch = timeBlock.match(/年月日[：:]\s*(\d{1,8}年[0-9]{1,2}月[0-9]{1,2}日)\s*([0-9]{1,2}[:：][0-9]{2})/);
    const weekdayLineMatch = timeBlock.match(/星期[：:]\s*(?:星期|周)?([一二三四五六日天])/);
    
    if (!datetimeLineMatch) {
        // 兜底方案：如果找不到带"年月日："前缀的，直接在段落里找时间格式
        const fallbackMatch = timeBlock.match(/(\d{1,8}年[0-9]{1,2}月[0-9]{1,2}日)\s*([0-9]{1,2}[:：][0-9]{2})/);
        if (!fallbackMatch) {
            throw new Error('初始时间格式不完整：AI未按格式返回 年月日 HH:mm');
        }
        datetimeLineMatch = [fallbackMatch[0], fallbackMatch[1], fallbackMatch[2]];
    }

    let weekdayStr = '星期一'; // 兜底默认值
    if (weekdayLineMatch) {
        weekdayStr = '星期' + weekdayLineMatch[1];
    } else {
        // 二次兜底：如果没抓到"星期："前缀，直接全文匹配
        const fallbackWeekday = timeBlock.match(/(星期|周)([一二三四五六日天])/);
        if (fallbackWeekday) {
            weekdayStr = '星期' + fallbackWeekday[2];
        }
    }

    const initialTime = {
        date: datetimeLineMatch[1],
        time: datetimeLineMatch[2].replace('：', ':'), // 兼容中文冒号
        weekday: weekdayStr
    };

    if (contacts.length === 0 && groups.length === 0) {
        throw new Error('未解析到任何联系人或群聊');
    }

    return { contacts, groups, initialTime };
}
    
    // 🎨 根据名字和关系猜测头像
    guessAvatar(name, relation) {
        const relationMap = {
            '妈妈': '👩', '母亲': '👩', 
            '爸爸': '👨', '父亲': '👨',
            '哥哥': '👨', '弟弟': '👨', '姐姐': '👩', '妹妹': '👩',
            '老师': '👨‍🏫', '教授': '👨‍🏫',
            '同事': '👔', '上司': '💼', '老板': '💼',
            '朋友': '👤', '同学': '🎓',
            '医生': '👨‍⚕️', '护士': '👩‍⚕️'
        };
        
        for (const [key, emoji] of Object.entries(relationMap)) {
            if (relation.includes(key)) {
                return emoji;
            }
        }
        
        // 根据性别猜测
        if (name.includes('女') || name.includes('小红') || name.includes('小芳')) {
            return '👩';
        }
        if (name.includes('男') || name.includes('小明') || name.includes('小刚')) {
            return '👨';
        }
        
        return '👤';
    }

    getFirstLetter(name) {
        if (!name || name.length === 0) return '#';

        const firstChar = name[0];

        // 英文字母直接返回大写
        if (/[a-zA-Z]/.test(firstChar)) {
            return firstChar.toUpperCase();
        }

        // 数字归到#
        if (/\d/.test(firstChar)) {
            return '#';
        }

        // 🔥 使用汉字 Unicode 码点范围判断拼音首字母
        // 这个方法基于 GB2312 汉字按拼音排序的特点
        const code = firstChar.charCodeAt(0);

        // 常用汉字区域 (0x4E00 - 0x9FA5)
        if (code >= 0x4E00 && code <= 0x9FA5) {
            // 基于拼音排序的区间划分
            const pinyinMap = [
                [0x9FA5, 'Z'], // 默认最大值
                [0x9F44, 'Z'], [0x9E99, 'Z'], [0x9DFA, 'Y'], [0x9D70, 'Y'],
                [0x9CE1, 'Y'], [0x9C10, 'X'], [0x9B92, 'X'], [0x9AFC, 'W'],
                [0x9A65, 'W'], [0x9963, 'T'], [0x98DC, 'T'], [0x984B, 'S'],
                [0x9798, 'S'], [0x96E8, 'R'], [0x9645, 'R'], [0x95B0, 'Q'],
                [0x9510, 'Q'], [0x9479, 'P'], [0x93D2, 'P'], [0x9338, 'O'],
                [0x928D, 'N'], [0x91E2, 'N'], [0x9149, 'M'], [0x90A8, 'M'],
                [0x8FFD, 'L'], [0x8F44, 'L'], [0x8E8A, 'K'], [0x8DDF, 'K'],
                [0x8D29, 'J'], [0x8C6A, 'J'], [0x8BB0, 'H'], [0x8AEE, 'H'],
                [0x8A3E, 'G'], [0x8984, 'G'], [0x88C4, 'F'], [0x8803, 'F'],
                [0x8757, 'E'], [0x86A9, 'D'], [0x85E9, 'D'], [0x8537, 'C'],
                [0x8468, 'C'], [0x83B8, 'B'], [0x82EB, 'B'], [0x8230, 'A']
            ];

            // 简化的拼音首字母查找（基于常用字的大致分布）
            // 这个方法不是100%准确，但覆盖率很高
            return this.getChinesePinyinInitial(firstChar) || '#';
        }

        return '#';
    }

    // 🔥 获取汉字拼音首字母（基于常用字映射 + Unicode区间估算）
    getChinesePinyinInitial(char) {
        // 优先使用精确映射
        const exactMap = {
            // 常见姓氏和名字用字
            '艾': 'A', '安': 'A', '敖': 'A', '奥': 'A', '阿': 'A', '爱': 'A', '昂': 'A',
            '白': 'B', '柏': 'B', '班': 'B', '包': 'B', '鲍': 'B', '贝': 'B', '毕': 'B', '卞': 'B', '边': 'B', '冰': 'B', '波': 'B', '博': 'B',
            '蔡': 'C', '曹': 'C', '岑': 'C', '柴': 'C', '昌': 'C', '常': 'C', '车': 'C', '陈': 'C', '成': 'C', '程': 'C', '池': 'C', '储': 'C', '楚': 'C', '褚': 'C', '崔': 'C', '春': 'C', '辰': 'C',
            '戴': 'D', '邓': 'D', '狄': 'D', '刁': 'D', '丁': 'D', '董': 'D', '窦': 'D', '杜': 'D', '段': 'D', '大': 'D', '德': 'D', '冬': 'D',
            '鄂': 'E', '恩': 'E', '尔': 'E',
            '樊': 'F', '范': 'F', '方': 'F', '房': 'F', '费': 'F', '冯': 'F', '封': 'F', '凤': 'F', '伏': 'F', '扶': 'F', '符': 'F', '傅': 'F', '付': 'F', '富': 'F', '芳': 'F', '飞': 'F', '风': 'F',
            '盖': 'G', '甘': 'G', '高': 'G', '戈': 'G', '葛': 'G', '耿': 'G', '弓': 'G', '龚': 'G', '宫': 'G', '巩': 'G', '贡': 'G', '勾': 'G', '古': 'G', '谷': 'G', '顾': 'G', '关': 'G', '管': 'G', '郭': 'G', '桂': 'G', '光': 'G', '国': 'G',
            '韩': 'H', '杭': 'H', '郝': 'H', '何': 'H', '贺': 'H', '赫': 'H', '衡': 'H', '洪': 'H', '侯': 'H', '胡': 'H', '花': 'H', '华': 'H', '滑': 'H', '怀': 'H', '黄': 'H', '惠': 'H', '霍': 'H', '海': 'H', '红': 'H', '虎': 'H', '辉': 'H',
            '姬': 'J', '嵇': 'J', '吉': 'J', '汲': 'J', '籍': 'J', '纪': 'J', '季': 'J', '贾': 'J', '简': 'J', '江': 'J', '姜': 'J', '蒋': 'J', '焦': 'J', '金': 'J', '靳': 'J', '荆': 'J', '景': 'J', '居': 'J', '鞠': 'J', '嘉': 'J', '佳': 'J', '杰': 'J', '静': 'J', '俊': 'J', '军': 'J', '君': 'J', '见': 'J',
            '康': 'K', '柯': 'K', '孔': 'K', '寇': 'K', '匡': 'K', '况': 'K', '邝': 'K', '凯': 'K', '可': 'K',
            '赖': 'L', '蓝': 'L', '郎': 'L', '劳': 'L', '雷': 'L', '冷': 'L', '黎': 'L', '李': 'L', '厉': 'L', '利': 'L', '连': 'L', '廉': 'L', '梁': 'L', '林': 'L', '凌': 'L', '令': 'L', '刘': 'L', '柳': 'L', '龙': 'L', '娄': 'L', '卢': 'L', '鲁': 'L', '陆': 'L', '路': 'L', '吕': 'L', '栾': 'L', '伦': 'L', '罗': 'L', '骆': 'L', '兰': 'L', '乐': 'L', '丽': 'L', '亮': 'L', '琳': 'L', '玲': 'L', '露': 'L', '璐': 'L', '老': 'L', '里': 'L',
            '麻': 'M', '马': 'M', '满': 'M', '毛': 'M', '茅': 'M', '梅': 'M', '孟': 'M', '糜': 'M', '米': 'M', '宓': 'M', '苗': 'M', '闵': 'M', '明': 'M', '缪': 'M', '莫': 'M', '牟': 'M', '母': 'M', '木': 'M', '穆': 'M', '慕': 'M', '美': 'M', '敏': 'M', '梦': 'M', '妙': 'M',
            '那': 'N', '南': 'N', '倪': 'N', '聂': 'N', '宁': 'N', '牛': 'N', '钮': 'N', '农': 'N', '娜': 'N', '妮': 'N', '念': 'N',
            '欧': 'O', '区': 'O',
            '潘': 'P', '庞': 'P', '裴': 'P', '彭': 'P', '皮': 'P', '平': 'P', '蒲': 'P', '濮': 'P', '朴': 'P', '鹏': 'P', '佩': 'P',
            '戚': 'Q', '齐': 'Q', '祁': 'Q', '钱': 'Q', '强': 'Q', '乔': 'Q', '秦': 'Q', '丘': 'Q', '邱': 'Q', '裘': 'Q', '屈': 'Q', '瞿': 'Q', '全': 'Q', '权': 'Q', '琪': 'Q', '琴': 'Q', '青': 'Q', '清': 'Q', '晴': 'Q', '庆': 'Q',
            '冉': 'R', '饶': 'R', '任': 'R', '荣': 'R', '容': 'R', '茹': 'R', '阮': 'R', '芮': 'R', '瑞': 'R', '蕊': 'R', '若': 'R', '然': 'R', '日': 'R',
            '桑': 'S', '沙': 'S', '山': 'S', '单': 'S', '尚': 'S', '邵': 'S', '佘': 'S', '申': 'S', '沈': 'S', '盛': 'S', '施': 'S', '石': 'S', '史': 'S', '舒': 'S', '束': 'S', '司': 'S', '宋': 'S', '苏': 'S', '孙': 'S', '索': 'S', '思': 'S', '诗': 'S', '淑': 'S', '书': 'S', '帅': 'S', '双': 'S', '爽': 'S', '水': 'S', '顺': 'S', '松': 'S', '素': 'S', '小': 'X',
            '谈': 'T', '谭': 'T', '汤': 'T', '唐': 'T', '陶': 'T', '滕': 'T', '田': 'T', '童': 'T', '佟': 'T', '涂': 'T', '屠': 'T', '天': 'T', '甜': 'T', '婷': 'T', '亭': 'T', '庭': 'T', '桐': 'T',
            '万': 'W', '汪': 'W', '王': 'W', '危': 'W', '韦': 'W', '卫': 'W', '魏': 'W', '温': 'W', '文': 'W', '翁': 'W', '邬': 'W', '巫': 'W', '吴': 'W', '伍': 'W', '武': 'W', '薇': 'W', '微': 'W', '伟': 'W', '炜': 'W', '维': 'W', '威': 'W', '婉': 'W', '皖': 'W', '晚': 'W',
            '奚': 'X', '席': 'X', '习': 'X', '夏': 'X', '项': 'X', '萧': 'X', '肖': 'X', '谢': 'X', '辛': 'X', '邢': 'X', '熊': 'X', '徐': 'X', '许': 'X', '宣': 'X', '薛': 'X', '荀': 'X', '小': 'X', '晓': 'X', '笑': 'X', '心': 'X', '欣': 'X', '新': 'X', '星': 'X', '馨': 'X', '秀': 'X', '雪': 'X', '旭': 'X', '轩': 'X', '萱': 'X', '璇': 'X', '雅': 'Y',
            '严': 'Y', '颜': 'Y', '言': 'Y', '阎': 'Y', '晏': 'Y', '燕': 'Y', '杨': 'Y', '羊': 'Y', '仰': 'Y', '姚': 'Y', '叶': 'Y', '伊': 'Y', '易': 'Y', '殷': 'Y', '尹': 'Y', '应': 'Y', '英': 'Y', '游': 'Y', '尤': 'Y', '于': 'Y', '余': 'Y', '俞': 'Y', '虞': 'Y', '元': 'Y', '袁': 'Y', '岳': 'Y', '云': 'Y', '月': 'Y', '悦': 'Y', '越': 'Y', '瑶': 'Y', '怡': 'Y', '依': 'Y', '宜': 'Y', '艺': 'Y', '忆': 'Y', '义': 'Y', '亦': 'Y', '奕': 'Y', '逸': 'Y', '毅': 'Y', '莹': 'Y', '盈': 'Y', '颖': 'Y', '映': 'Y', '永': 'Y', '咏': 'Y', '勇': 'Y', '友': 'Y', '有': 'Y', '又': 'Y', '右': 'Y', '幼': 'Y', '羽': 'Y', '雨': 'Y', '语': 'Y', '玉': 'Y', '育': 'Y', '郁': 'Y', '煜': 'Y', '裕': 'Y', '豫': 'Y', '渊': 'Y', '媛': 'Y', '缘': 'Y', '远': 'Y', '苑': 'Y', '愿': 'Y', '韵': 'Y',
            '臧': 'Z', '曾': 'Z', '翟': 'Z', '詹': 'Z', '湛': 'Z', '张': 'Z', '章': 'Z', '赵': 'Z', '甄': 'Z', '郑': 'Z', '钟': 'Z', '仲': 'Z', '周': 'Z', '朱': 'Z', '祝': 'Z', '竺': 'Z', '诸': 'Z', '庄': 'Z', '卓': 'Z', '邹': 'Z', '祖': 'Z', '左': 'Z', '子': 'Z', '梓': 'Z', '紫': 'Z', '自': 'Z', '字': 'Z', '宗': 'Z', '姿': 'Z', '智': 'Z', '志': 'Z', '芝': 'Z', '之': 'Z', '知': 'Z', '直': 'Z', '芷': 'Z', '止': 'Z', '至': 'Z', '致': 'Z', '稚': 'Z', '珍': 'Z', '真': 'Z', '振': 'Z', '镇': 'Z', '争': 'Z', '正': 'Z', '政': 'Z', '哲': 'Z', '喆': 'Z', '辙': 'Z', '者': 'Z', '这': 'Z', '浙': 'Z', '兆': 'Z', '照': 'Z', '召': 'Z', '朝': 'Z', '长': 'Z', '忠': 'Z', '中': 'Z', '众': 'Z', '舟': 'Z', '州': 'Z', '洲': 'Z', '重': 'Z', '竹': 'Z', '珠': 'Z', '株': 'Z', '主': 'Z', '柱': 'Z', '助': 'Z', '住': 'Z', '注': 'Z', '著': 'Z', '筑': 'Z', '铸': 'Z', '祝': 'Z', '驻': 'Z', '专': 'Z', '转': 'Z', '撰': 'Z', '赚': 'Z', '桩': 'Z', '装': 'Z', '壮': 'Z', '追': 'Z', '准': 'Z', '卓': 'Z', '拙': 'Z', '茁': 'Z', '着': 'Z', '灼': 'Z'
        };

        if (exactMap[char]) {
            return exactMap[char];
        }

        // 🔥 使用 Unicode 码点区间估算（基于汉字按拼音排序的规律）
        const code = char.charCodeAt(0);

        // CJK统一汉字区间的拼音首字母估算
        // 这些区间是根据GB2312等编码标准中汉字按拼音排序的特点估算的
        if (code >= 0x4E00 && code <= 0x9FFF) {
            // 简化的拼音分布区间（不100%精确，但覆盖大部分情况）
            if (code >= 0x9EA0) return 'Z';
            if (code >= 0x9D00) return 'Y';
            if (code >= 0x9B00) return 'X';
            if (code >= 0x9900) return 'W';
            if (code >= 0x9700) return 'T';
            if (code >= 0x9400) return 'S';
            if (code >= 0x9100) return 'R';
            if (code >= 0x8E00) return 'Q';
            if (code >= 0x8B00) return 'P';
            if (code >= 0x8900) return 'O';
            if (code >= 0x8700) return 'N';
            if (code >= 0x8400) return 'M';
            if (code >= 0x8000) return 'L';
            if (code >= 0x7D00) return 'K';
            if (code >= 0x7A00) return 'J';
            if (code >= 0x7700) return 'H';
            if (code >= 0x7400) return 'G';
            if (code >= 0x7100) return 'F';
            if (code >= 0x6E00) return 'E';
            if (code >= 0x6800) return 'D';
            if (code >= 0x6200) return 'C';
            if (code >= 0x5C00) return 'B';
            if (code >= 0x4E00) return 'A';
        }

        return '#';
    }

    // 🗑️ 删除消息
    deleteMessage(chatId, messageIndex) {
        if (this.data.messages[chatId] && this.data.messages[chatId][messageIndex]) {
            const deletedMsg = this.data.messages[chatId][messageIndex];

            // 🔥 如果删除的是通话记录(call_record)，同时删除相关的通话文字(call_text)
            if (deletedMsg.type === 'call_record') {
                const callType = deletedMsg.callType;
                const callTime = deletedMsg.time;

                // 找到这个通话记录之前连续的 call_text 消息并删除
                // 从当前位置往前找，删除同一通话的 call_text
                let i = messageIndex - 1;
                while (i >= 0) {
                    const msg = this.data.messages[chatId][i];
                    if (msg.type === 'call_text' && msg.callType === callType) {
                        // 同一类型的通话文字，删除
                        this.data.messages[chatId].splice(i, 1);
                        messageIndex--; // 调整索引
                        i--;
                    } else if (msg.type === 'call_text') {
                        // 不同类型的通话文字，停止
                        break;
                    } else {
                        // 遇到其他类型消息，停止
                        break;
                    }
                }
            }

            // 删除目标消息
            this.data.messages[chatId].splice(messageIndex, 1);

            // 🔥 更新聊天列表的 lastMessage
            const chat = this.getChat(chatId);
            if (chat) {
                const messages = this.data.messages[chatId];
                if (messages && messages.length > 0) {
                    // 获取新的最后一条消息
                    const lastMsg = messages[messages.length - 1];
                    chat.lastMessage = this.getMessagePreview(lastMsg);
                    chat.time = lastMsg.time;
                } else {
                    // 没有消息了
                    chat.lastMessage = '';
                    chat.time = '';
                }
            }

            // 🔥 标记消息已修改
            this._messagesDirty[chatId] = true;

            // 🔥 完全重置 TimeManager，让它重新从消息中计算最新时间
            window.VirtualPhone?.timeManager?.resetTime();

            this.saveData();
        }
    }

    // 🗑️ 清空聊天的所有消息
    clearMessages(chatId) {
        if (this.data.messages[chatId]) {
            // 清空消息数组
            this.data.messages[chatId] =[];

            // 更新聊天列表信息
            const chat = this.getChat(chatId);
            if (chat) {
                chat.lastMessage = '';
                chat.time = '';
                chat.unread = 0;
                
                // 🔥 核心防御：记录清空发生时的酒馆正文层数，防止旧楼层标签亡灵复活
                try {
                    const context = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
                    if (context && context.chat) {
                        chat.clearedAt_tavernIndex = context.chat.length - 1;
                    }
                } catch(e) {}
            }

            // 标记消息已修改
            this._messagesDirty[chatId] = true;

            // 🔥 完全重置 TimeManager，让它重新从消息中计算最新时间
            window.VirtualPhone?.timeManager?.resetTime();

            this.saveData();
        }
    }
     
    // 🔥🔥🔥 强力时光机：物理截断指定楼层及之后的所有微信消息 (完美对齐记忆插件的回档逻辑) 🔥🔥🔥
    rollbackToFloor(targetTavernIndex) {
        if (targetTavernIndex === undefined || targetTavernIndex === null) return;

        // 🔥🔥🔥 核心修复：由于懒加载机制，data.messages 可能是空的！
        // 必须先遍历所有聊天，强制触发 getMessages() 从独立存储加载消息到内存，
        // 否则回滚时遍历空对象，什么都删不掉！
        const allChats = this.data.chats || [];
        allChats.forEach(chat => {
            if (chat && chat.id) {
                this.getMessages(chat.id); // 强制加载到内存
            }
        });

        let isDirty = false;

        for (const chatId in this.data.messages) {
            const originalLen = this.data.messages[chatId].length;

            this.data.messages[chatId] = this.data.messages[chatId].filter(m => {
                // 凡是 >= 目标楼层的，统统视为未来废案，直接物理删除！
                if (m.tavernMessageIndex !== undefined && m.tavernMessageIndex >= targetTavernIndex) {
                    return false;
                }
                return true;
            });

           // 如果该聊天有被截断的废案，更新状态
            if (this.data.messages[chatId].length !== originalLen) {
                this._messagesDirty[chatId] = true;
                isDirty = true;

                // 更新聊天列表的最后一条消息预览
                const chat = this.getChat(chatId);
                if (chat) {
                    chat.unread = 0; // 🔥 核心修复：发生回档时，必须把未读红点强制清零，消灭幽灵红点！

                    const msgs = this.data.messages[chatId];
                    if (msgs.length > 0) {
                        const lastMsg = msgs[msgs.length - 1];
                        chat.lastMessage = this.getMessagePreview(lastMsg);
                        chat.time = lastMsg.time;
                        chat.timestamp = lastMsg.timestamp || Date.now();
                    } else {
                        chat.lastMessage = '';
                        chat.time = '';
                    }
                }
            }
        }

        // 如果真的发生了回滚，保存并重置时间锚点
        if (isDirty) {
            // 🔥 核心修复：必须同步保存每个被修改的聊天消息，确保存储立即更新
            for (const chatId in this._messagesDirty) {
                if (this._messagesDirty[chatId]) {
                    this._saveMessages(chatId);
                }
            }
            this.saveData();
            if (window.VirtualPhone?.timeManager) {
                window.VirtualPhone.timeManager.resetTime();
            }
            console.log(`⏪ [微信数据] 时光倒流成功：已抹除第 ${targetTavernIndex} 楼及之后的所有未来数据！`);
            return true; // 🔥 新增：返回 true 表示确实发生了数据回滚
        }
        return false; // 🔥 新增：没删数据则返回 false
    }

    // ✏️ 编辑消息
    editMessage(chatId, messageIndex, newContent) {
        if (this.data.messages[chatId] && this.data.messages[chatId][messageIndex]) {
            this.data.messages[chatId][messageIndex].content = newContent;
            // 🔥 标记消息已修改
            this._messagesDirty[chatId] = true;
            this.saveData();
        }
    }

    // 🎨 设置聊天背景
    setChatBackground(chatId, background) {
        const chat = this.getChat(chatId);
        if (chat) {
            chat.background = background;
            this.saveData();
        }
    }

    // 🗑️ 删除聊天
    deleteChat(chatId) {
        this.data.chats = this.data.chats.filter(c => c.id !== chatId);
        delete this.data.messages[chatId];

        // 🔥 同时删除独立存储的消息
        try {
            const msgKey = this._getMessageKey(chatId);
            this.storage.set(msgKey, null, false);
        } catch (e) {
            console.warn(`⚠️ 删除聊天 ${chatId} 的消息存储失败:`, e);
        }

        // 清除加载和脏标记
        delete this._messagesLoaded[chatId];
        delete this._messagesDirty[chatId];

        this.saveData();
    }
    
    // 🚫 拉黑联系人
    blockContact(contactId) {
        const contact = this.getContact(contactId);
        if (contact) {
            contact.blocked = true;
            this.saveData();
        }
    }

    // 🗑️ 删除联系人及对应的单聊会话
    deleteContactAndChat(contactId) {
        // 1. 找到对应的单聊会话并删除
        const chat = this.getChatByContactId(contactId);
        if (chat && chat.type !== 'group') {
            // 删除聊天记录
            delete this.data.messages[chat.id];
            // 删除聊天
            this.data.chats = this.data.chats.filter(c => c.id !== chat.id);
        }

        // 2. 删除联系人
        this.data.contacts = this.data.contacts.filter(c => c.id !== contactId);
        if (this.data.contactGenderMap && typeof this.data.contactGenderMap === 'object') {
            delete this.data.contactGenderMap[contactId];
        }
        if (this.data.contactAutoAvatarMap && typeof this.data.contactAutoAvatarMap === 'object') {
            delete this.data.contactAutoAvatarMap[contactId];
        }

        // 3. 保存数据
        this.saveData();

    }

    // ========================================
    // 🆕 群聊管理（新增）
    // ========================================
    
    // 创建群聊
    createGroupChat(groupInfo) {
        const chatId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const groupChat = {
            id: chatId,
            name: groupInfo.name || '群聊',
            type: 'group',
            avatar: groupInfo.avatar || '',
            lastMessage: '',
            time: '刚刚',
            unread: 0,
            timestamp: Date.now(),
            members: groupInfo.members || [],
            createdAt: new Date().toISOString()
        };

        this.data.chats.push(groupChat);
        
        // 🔥 添加系统消息：谁创建了群聊
        this.addMessage(chatId, {
            from: 'system',
            content: `你创建了群聊"${groupInfo.name}"`,
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
            type: 'system',
            avatar: '📢'
        });
        
        this.saveData();
        return groupChat;
    }
    
    // 添加群成员
    addGroupMember(chatId, memberId) {
        const chat = this.getChat(chatId);
        if (chat && chat.type === 'group') {
            if (!chat.members.includes(memberId)) {
                chat.members.push(memberId);
                this.saveData();
            }
        }
    }
    
    // 移除群成员
    removeGroupMember(chatId, memberId) {
        const chat = this.getChat(chatId);
        if (chat && chat.type === 'group') {
            chat.members = chat.members.filter(id => id !== memberId);
            this.saveData();
        }
    }    
    
// ========================================
// 🎨 自定义表情管理
// ========================================

// 获取所有自定义表情
getCustomEmojis() {
    if (!this.data.customEmojis) {
        this.data.customEmojis = [];
    }
    return this.data.customEmojis;
}

// 获取单个自定义表情
getCustomEmoji(emojiId) {
    return this.data.customEmojis?.find(e => e.id === emojiId);
}

// 添加自定义表情
addCustomEmoji(emojiData) {
    if (!this.data.customEmojis) {
        this.data.customEmojis = [];
    }
    
    const emoji = {
        id: `emoji_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: String(emojiData?.name || '').trim() || `表情${(this.data.customEmojis?.length || 0) + 1}`,
        image: emojiData.image,
        createdAt: new Date().toISOString()
    };
    
    this.data.customEmojis.push(emoji);
    this.saveData();
    
    return emoji;
}

// 删除自定义表情
deleteCustomEmoji(emojiId) {
    if (!this.data.customEmojis) return;
    
    this.data.customEmojis = this.data.customEmojis.filter(e => e.id !== emojiId);
    this.saveData();
    
   }
}

