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
// 存储管理系统 v2.0 - 防弹级持久化架构
// ========================================
// 核心特性：
// 1. 聊天数据 → chatMetadata（随聊天文件保存）
// 2. 全局配置 → extensionSettings（随 settings.json 保存）
// 3. localStorage 仅作为极限兜底
// 4. 自动迁移旧数据到新架构
// ========================================

export class PhoneStorage {
    constructor() {
        // ==================== 命名空间 ====================
        this.NAMESPACE = 'st_virtual_phone';
        this.storageKey = 'virtual_phone'; // 兼容旧版 localStorage 键名

        // ==================== 上下文缓存 ====================
        this.currentCharacterId = null;
        this.currentChatId = null;

        // ==================== 聊天数据的关键字匹配规则 ====================
        // 匹配这些关键字的 key 会被存入 chatMetadata（聊天专属）
        this.CHAT_DATA_PATTERNS = [
            /^wechat_/,           // 微信数据
            /^weibo_/,            // 微博数据
            /^honey_/,            // 蜜语数据
            /^pending[_-]contacts$/, // 待处理联系人
            /^chat_/,             // 聊天相关
            /^message_/,          // 消息相关
            /^contact_/,          // 联系人相关
            /_apps$/,             // APP状态（按聊天存储）
            /^story-/,            // 时间数据（避免频繁触发 settings_updated）
            /^diary_/,            // 日记数据（按聊天独立存储）
            /^phone_call_/,       // 通话记录数据
            /^music_/,            // 音乐播放列表数据
        ];

        // ==================== 防抖：saveChat ====================
        // 用于聊天数据的物理写入，防止短时间内频繁调用导致 IO 卡死
        this._saveChatTimer = null;
        this._saveChatDelay = 3000; // 3000ms 防抖延迟

        // ==================== 队列锁：全局配置保存 ====================
        // 使用 Promise 链实现 Mutex，防止并发写入导致数据覆盖
        this._settingsSaveQueue = Promise.resolve();
        this._settingsSaveQueued = false; // 标记是否已有待执行的保存任务

        // ==================== 初始化 ====================
        this._cleanupLegacyData();
    }

    // ========================================
    // 🔧 内部工具方法
    // ========================================

    /**
     * 清理旧版过大的 localStorage 备份数据
     */
    _cleanupLegacyData() {
        try {
            localStorage.removeItem('virtual_phone_backup');
        } catch (e) {
            // 忽略错误
        }
    }

    /**
     * 判断某个 key 是否属于聊天专属数据
     * @param {string} key - 存储键名
     * @returns {boolean}
     */
    _isChatData(key) {
        return this.CHAT_DATA_PATTERNS.some(pattern => pattern.test(key));
    }

    /**
     * 获取酒馆上下文
     * @returns {Object|null}
     */
    getContext() {
        try {
            const context = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
                ? SillyTavern.getContext()
                : null;

            if (context) {
                this.currentCharacterId = context.characterId || context.name2 || 'default';
                this.currentChatId = context.chatMetadata?.file_name || context.chatId || 'default_chat';
            }

            return context;
        } catch (e) {
            console.warn('[PhoneStorage] 获取上下文失败:', e);
            return null;
        }
    }

    /**
     * 生成存储键名（兼容旧版）
     * @param {string} dataType - 数据类型
     * @returns {string}
     */
    getStorageKey(dataType = 'apps') {
        this.getContext();
        return `${this.currentCharacterId}_${this.currentChatId}_${dataType}`;
    }

    // ========================================
    // 📦 chatMetadata 操作（聊天专属数据）
    // ========================================

    /**
     * 获取 chatMetadata 中的命名空间对象
     * @returns {Object|null}
     */
    _getChatMetadataStore() {
        try {
            const context = this.getContext();
            if (!context || !context.chatMetadata) return null;

            // 确保命名空间存在
            if (!context.chatMetadata[this.NAMESPACE]) {
                context.chatMetadata[this.NAMESPACE] = {};
            }
            return context.chatMetadata[this.NAMESPACE];
        } catch (e) {
            console.warn('[PhoneStorage] 获取 chatMetadata 失败:', e);
            return null;
        }
    }

    /**
     * 防抖保存聊天数据到后端
     * 延迟 500ms 执行，期间的多次调用会被合并
     */
    _debouncedSaveChat() {
        // 清除之前的定时器
        if (this._saveChatTimer) {
            clearTimeout(this._saveChatTimer);
        }

        // 记录当前聊天ID，防止切换后误写
        const queuedChatId = this.currentChatId;

        // 设置新的定时器
        this._saveChatTimer = setTimeout(async () => {
            this._saveChatTimer = null;
            try {
                const context = this.getContext();
                // 如果聊天已切换或上下文丢失，禁止保存
                if (!context || this.currentChatId !== queuedChatId) return;

                if (typeof window.saveChatDebounced === 'function') {
                    window.saveChatDebounced();
                } else if (typeof context.saveChat === 'function') {
                    await context.saveChat();
                }
            } catch (e) {
                console.error('[PhoneStorage] saveChat 失败:', e);
            }
        }, this._saveChatDelay);
    }

    // ========================================
    // ⚙️ extensionSettings 操作（全局配置）
    // ========================================

    /**
     * 获取 extensionSettings 中的命名空间对象
     * @returns {Object|null}
     */
    _getExtensionSettingsStore() {
        try {
            const context = this.getContext();
            if (!context || !context.extensionSettings) return null;

            // 确保命名空间存在
            if (!context.extensionSettings[this.NAMESPACE]) {
                context.extensionSettings[this.NAMESPACE] = {};
            }
            return context.extensionSettings[this.NAMESPACE];
        } catch (e) {
            console.warn('[PhoneStorage] 获取 extensionSettings 失败:', e);
            return null;
        }
    }

    /**
     * 兼容旧版：获取扩展设置对象（保持向后兼容）
     * @returns {Object|null}
     */
    getExtensionSettings() {
        return this._getExtensionSettingsStore();
    }

    /**
     * 队列锁保存全局配置
     * 使用 Promise 链实现 Mutex，确保"获取->合并->保存"的原子性
     */
    _queuedSaveExtensionSettings() {
        // 如果已有待执行的保存任务，直接返回（合并请求）
        if (this._settingsSaveQueued) {
            return;
        }

        this._settingsSaveQueued = true;

        // 将保存任务推入队列
        this._settingsSaveQueue = this._settingsSaveQueue.then(async () => {
            this._settingsSaveQueued = false;

            try {
                const context = this.getContext();
                if (!context) return;

                // ==================== 方式1：使用酒馆内置的保存函数 ====================
                // 优先使用酒馆自带的防抖保存，它会自动处理 CSRF 和并发问题
                if (typeof context.saveSettingsDebounced === 'function') {
                    context.saveSettingsDebounced();
                    return;
                }

                // 备用：全局 saveSettingsDebounced
                if (typeof saveSettingsDebounced === 'function') {
                    saveSettingsDebounced();
                    return;
                }

                // 备用：全局 saveSettings
                if (typeof saveSettings === 'function') {
                    saveSettings();
                    return;
                }

                // ==================== 方式2：手动调用 API（带队列锁保护） ====================
                // 只有在酒馆内置函数不可用时才使用
                await this._manualSaveSettings(context);

            } catch (e) {
                console.error('[PhoneStorage] 保存全局配置失败:', e);
            }
        }).catch(err => {
            console.error('[PhoneStorage] 队列保存异常:', err);
            this._settingsSaveQueued = false;
        });
    }

    /**
     * 手动保存设置到服务器（带完整的读取-合并-写入流程）
     * 只有在酒馆内置函数不可用时才调用
     * @param {Object} context - 酒馆上下文
     */
    async _manualSaveSettings(context) {
        try {
            // 1️⃣ 获取最新的服务器 settings
            const getResponse = await fetch('/api/settings/get', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            if (!getResponse.ok) {
                console.warn('[PhoneStorage] 获取服务器设置失败');
                return;
            }

            const serverSettings = await getResponse.json();

            // 2️⃣ 合并当前的 extensionSettings
            if (!serverSettings.extension_settings) {
                serverSettings.extension_settings = {};
            }
            serverSettings.extension_settings[this.NAMESPACE] =
                context.extensionSettings[this.NAMESPACE] || {};

            // 3️⃣ 写回服务器
            const saveResponse = await fetch('/api/settings/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(serverSettings)
            });

            if (!saveResponse.ok) {
                console.error('[PhoneStorage] 保存到服务器失败');
            }

        } catch (e) {
            console.error('[PhoneStorage] 手动保存设置异常:', e);
        }
    }

    /**
     * 兼容旧版：保存扩展设置
     */
    async saveExtensionSettings() {
        this._queuedSaveExtensionSettings();
    }

    // ========================================
    // 🔑 核心公共 API：get / set
    // ========================================

    /**
     * 通用读取方法
     * 优先级：内存 → localStorage旧数据（自动迁移） → defaultValue
     *
     * @param {string} key - 存储键名
     * @param {*} defaultValue - 默认值（可选，默认为 null）
     * @returns {*} 存储的值
     */
    get(key, defaultValue = null) {
        try {
            const isChatData = this._isChatData(key);

            // ==================== 第1优先级：从酒馆内存读取 ====================
            let value = null;

            if (isChatData) {
                // 聊天专属数据 → chatMetadata
                const chatStore = this._getChatMetadataStore();
                if (chatStore && chatStore[key] !== undefined) {
                    value = chatStore[key];
                }
            } else {
                // 全局配置数据 → extensionSettings
                const extStore = this._getExtensionSettingsStore();
                if (extStore && extStore[key] !== undefined) {
                    value = extStore[key];
                }
            }

            if (value !== null && value !== undefined) {
                return value;
            }

            // ==================== 第2优先级：从 localStorage 读取旧数据并自动迁移 ====================
            // 仅全局设置允许走 localStorage 兜底，聊天专属数据禁止（防止亡灵复活）
            if (!isChatData) {
                const legacyKey = this._getLegacyLocalStorageKey(key, isChatData);
                const legacyValue = this._getFromLocalStorage(legacyKey);

                if (legacyValue !== null && legacyValue !== undefined) {
                    // 🔥 自动迁移：将旧数据写入新架构
                    this._migrateToNewArchitecture(key, legacyValue, isChatData);
                    return legacyValue;
                }
            }

            // ==================== 第3优先级：返回默认值 ====================
            return defaultValue;

        } catch (e) {
            console.warn(`[PhoneStorage] 读取 ${key} 失败:`, e);
            return defaultValue;
        }
    }

    /**
     * 通用写入方法
     * 根据 key 自动判断存入 chatMetadata 或 extensionSettings
     * 同时写入 localStorage 作为极限兜底
     *
     * @param {string} key - 存储键名
     * @param {*} value - 要存储的值
     */
    async set(key, value) {
        try {
            const isChatData = this._isChatData(key);

            // ==================== 写入酒馆内存 ====================
            if (isChatData) {
                // 聊天专属数据 → chatMetadata
                const chatStore = this._getChatMetadataStore();
                if (chatStore) {
                    chatStore[key] = value;
                    // 🔥 防抖保存到后端
                    this._debouncedSaveChat();
                }
            } else {
                // 全局配置数据 → extensionSettings
                const extStore = this._getExtensionSettingsStore();
                if (extStore) {
                    extStore[key] = value;
                    // 🔥 队列锁保存到后端
                    this._queuedSaveExtensionSettings();
                }
            }

            // ==================== 同步写入 localStorage 作为兜底 ====================
            // 仅全局设置写入 localStorage，聊天专属数据禁止（防止数据回档）
            if (!isChatData) {
                this._setToLocalStorage(key, value, isChatData);
            }

        } catch (e) {
            console.error(`[PhoneStorage] 保存 ${key} 失败:`, e);
        }
    }

    /**
     * 🔥 删除指定 key 的数据
     * @param {string} key - 存储键名
     */
    async remove(key) {
        try {
            const isChatData = this._isChatData(key);

            // ==================== 从酒馆内存删除 ====================
            if (isChatData) {
                const chatStore = this._getChatMetadataStore();
                if (chatStore && chatStore[key] !== undefined) {
                    delete chatStore[key];
                    this._debouncedSaveChat();
                }
            } else {
                const extStore = this._getExtensionSettingsStore();
                if (extStore && extStore[key] !== undefined) {
                    delete extStore[key];
                    this._queuedSaveExtensionSettings();
                }
            }

            // ==================== 从 localStorage 删除 ====================
            const fullKey = this._getLegacyLocalStorageKey(key, isChatData);
            try {
                localStorage.removeItem(fullKey);
            } catch (e) {
                // 忽略 localStorage 错误
            }

        } catch (e) {
            console.error(`[PhoneStorage] 删除 ${key} 失败:`, e);
        }
    }

    // ========================================
    // 🗄️ localStorage 兜底操作
    // ========================================

    /**
     * 获取旧版 localStorage 键名
     */
    _getLegacyLocalStorageKey(key, isChatData) {
        if (isChatData) {
            return `${this.storageKey}_${this.getStorageKey(key)}`;
        } else {
            return `${this.storageKey}_global_${key}`;
        }
    }

    /**
     * 从 localStorage 读取
     */
    _getFromLocalStorage(fullKey) {
        try {
            return localStorage.getItem(fullKey);
        } catch (e) {
            return null;
        }
    }

    /**
     * 写入 localStorage（忽略 QuotaExceededError）
     */
    _setToLocalStorage(key, value, isChatData) {
        try {
            const fullKey = this._getLegacyLocalStorageKey(key, isChatData);
            const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
            localStorage.setItem(fullKey, stringValue);
        } catch (e) {
            // 🔥 忽略 QuotaExceededError，localStorage 只是兜底
            if (e.name === 'QuotaExceededError' || e.code === 22) {
                console.warn('[PhoneStorage] localStorage 配额已满，跳过兜底存储');
            }
        }
    }

    /**
     * 自动迁移旧数据到新架构
     */
    _migrateToNewArchitecture(key, value, isChatData) {
        try {
            if (isChatData) {
                const chatStore = this._getChatMetadataStore();
                if (chatStore) {
                    chatStore[key] = value;
                    this._debouncedSaveChat();
                }
            } else {
                const extStore = this._getExtensionSettingsStore();
                if (extStore) {
                    extStore[key] = value;
                    this._queuedSaveExtensionSettings();
                }
            }
        } catch (e) {
            console.warn('[PhoneStorage] 自动迁移失败:', e);
        }
    }

    // ========================================
    // 📱 APP 数据操作（保持向后兼容）
    // ========================================

    /**
     * 保存 APP 数据
     * @param {Array} apps - APP 列表
     */
    async saveApps(apps) {
        try {
            const key = this.getStorageKey('apps');
            const data = JSON.stringify(apps);

            // 存入 chatMetadata（因为 APP 状态是聊天专属的）
            const chatStore = this._getChatMetadataStore();
            if (chatStore) {
                chatStore[key] = data;
                this._debouncedSaveChat();
            }

            // 兜底写入 localStorage
            this._setToLocalStorage(key, data, true);

        } catch (e) {
            console.error('[PhoneStorage] 保存 Apps 失败:', e);
        }
    }

    /**
     * 加载 APP 数据
     * @param {Array} defaultApps - 默认 APP 列表
     * @returns {Array}
     */
    loadApps(defaultApps) {
        try {
            const key = this.getStorageKey('apps');
            let saved = null;

            // 1️⃣ 优先从 chatMetadata 读取
            const chatStore = this._getChatMetadataStore();
            if (chatStore && chatStore[key]) {
                saved = chatStore[key];
            }

            // 2️⃣ 兼容：从旧版 extensionSettings 读取
            if (!saved) {
                const extStore = this._getExtensionSettingsStore();
                if (extStore && extStore[key]) {
                    saved = extStore[key];
                    // 迁移到 chatMetadata
                    if (chatStore) {
                        chatStore[key] = saved;
                        this._debouncedSaveChat();
                    }
                }
            }

            // 3️⃣ 兜底：从 localStorage 读取
            if (!saved) {
                saved = localStorage.getItem(`${this.storageKey}_${key}`);
                if (saved && chatStore) {
                    // 自动迁移
                    chatStore[key] = saved;
                    this._debouncedSaveChat();
                }
            }

            // 解析并合并
            if (saved && typeof saved === 'string' && saved.trim() !== '') {
                try {
                    const savedApps = JSON.parse(saved);

                    // 🔥 始终使用最新的应用列表配置，只恢复用户数据
                    return defaultApps.map(defaultApp => {
                        const savedApp = savedApps.find(s => s.id === defaultApp.id);
                        if (savedApp) {
                            return {
                                ...defaultApp,
                                badge: savedApp.badge || 0,
                                data: savedApp.data || defaultApp.data
                            };
                        }
                        return defaultApp;
                    });
                } catch (parseError) {
                    console.error('[PhoneStorage] Apps JSON 解析失败:', parseError.message);
                    // 清空损坏数据
                    if (chatStore) delete chatStore[key];
                    localStorage.removeItem(`${this.storageKey}_${key}`);
                }
            }
        } catch (e) {
            console.warn('[PhoneStorage] 加载 Apps 失败:', e);
        }

        return defaultApps;
    }

    // ========================================
    // ⚙️ 设置操作（保持向后兼容）
    // ========================================

    /**
     * 保存设置（全局配置）
     * @param {Object} settings - 设置对象
     */
    async saveSettings(settings) {
        try {
            const data = JSON.stringify(settings);

            // 存入 extensionSettings
            const extStore = this._getExtensionSettingsStore();
            if (extStore) {
                extStore['global_settings'] = data;
                this._queuedSaveExtensionSettings();
            }

            // 兜底写入 localStorage
            this._setToLocalStorage('global_settings', data, false);

        } catch (e) {
            console.error('[PhoneStorage] 保存设置失败:', e);
        }
    }

    /**
     * 加载设置
     * @returns {Object}
     */
    loadSettings() {
        const defaultSettings = {
            enabled: true,
            soundEnabled: true,
            vibrationEnabled: true,
            onlineMode: false,
            promptTemplate: null
        };

        try {
            let saved = null;

            // 1️⃣ 从 extensionSettings 读取
            const extStore = this._getExtensionSettingsStore();
            if (extStore && extStore['global_settings']) {
                saved = extStore['global_settings'];
            }

            // 2️⃣ 兜底：从 localStorage 读取
            if (!saved) {
                saved = localStorage.getItem(`${this.storageKey}_global_settings`);
                if (saved && extStore) {
                    // 自动迁移
                    extStore['global_settings'] = saved;
                    this._queuedSaveExtensionSettings();
                }
            }

            // 解析
            if (saved && typeof saved === 'string' && saved.trim() !== '') {
                try {
                    return JSON.parse(saved);
                } catch (parseError) {
                    console.error('[PhoneStorage] Settings JSON 解析失败:', parseError.message);
                    localStorage.removeItem(`${this.storageKey}_global_settings`);
                }
            }
        } catch (e) {
            console.warn('[PhoneStorage] 加载设置失败:', e);
        }

        return defaultSettings;
    }

    // ========================================
    // 🗑️ 数据清理
    // ========================================

    /**
     * 清空当前聊天的数据（保留全局个性化装扮）
     */
    async clearCurrentData() {
        try {
            this.getContext();
            const prefix = `${this.currentCharacterId}_${this.currentChatId}_`;

            // 1️⃣ 清理 chatMetadata（当前会话的全部数据）
            const chatStore = this._getChatMetadataStore();
            if (chatStore) {
                Object.keys(chatStore).forEach(k => {
                    delete chatStore[k];
                });
                // 立即保存（不防抖，确保清理生效）
                const context = this.getContext();
                if (context && typeof context.saveChat === 'function') {
                    await context.saveChat();
                }
            }

            // 2️⃣ 清理 localStorage 中的相关数据（带角色前缀的）
            const keys = Object.keys(localStorage);
            keys.forEach(k => {
                if (k.includes(prefix)) {
                    localStorage.removeItem(k);
                }
            });

            console.log('[PhoneStorage] 当前聊天数据已清空（全局装扮已保留）');

        } catch (e) {
            console.error('[PhoneStorage] 清空当前数据失败:', e);
        }
    }

    /**
     * 清空所有数据（恢复出厂设置：所有角色数据 + 全局装扮 + 缓存）
     */
    async clearAllData() {
        try {
            // 1️⃣ 清理当前聊天的 chatMetadata
            const chatStore = this._getChatMetadataStore();
            if (chatStore) {
                Object.keys(chatStore).forEach(k => delete chatStore[k]);
                const context = this.getContext();
                if (context && typeof context.saveChat === 'function') {
                    await context.saveChat();
                }
            }

            // 2️⃣ 清理 extensionSettings（全局装扮、提示词、图片等全部删除）
            const context2 = this.getContext();
            if (context2 && context2.extensionSettings) {
                // 彻底删除整个命名空间
                delete context2.extensionSettings[this.NAMESPACE];
                // 重新创建空命名空间（防止后续代码报错）
                context2.extensionSettings[this.NAMESPACE] = {};

                // 保存到服务器
                if (typeof context2.saveSettingsDebounced === 'function') {
                    context2.saveSettingsDebounced();
                } else if (typeof saveSettingsDebounced === 'function') {
                    saveSettingsDebounced();
                } else {
                    this._queuedSaveExtensionSettings();
                }
            }

            // 3️⃣ 清理 localStorage（所有带插件命名空间的键）
            const keys = Object.keys(localStorage);
            keys.forEach(k => {
                if (k.startsWith(this.storageKey) ||
                    k.startsWith(this.NAMESPACE) ||
                    k.includes('virtual_phone') ||
                    k.includes('st_virtual_phone')) {
                    localStorage.removeItem(k);
                }
            });

            console.log('[PhoneStorage] 恢复出厂设置完成：所有数据已清空');

        } catch (e) {
            console.error('[PhoneStorage] 清空所有数据失败:', e);
        }
    }
}

