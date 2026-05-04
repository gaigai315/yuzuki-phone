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
// 虚拟手机互动系统 v1.0.1
// SillyTavern 扩展插件
// ========================================

const ST_PHONE_BASE_URL = new URL('./', import.meta.url).href;
const ST_PHONE_GLOBAL_CSS_URL = new URL('./phone.css', import.meta.url).href;
const ST_PHONE_VERSION = '1.0.1';
const ST_PHONE_UPDATE_MANIFEST_URLS = [
    'https://raw.githubusercontent.com/gaigai315/yuzuki-phone/main/manifest.json',
    'https://raw.githubusercontent.com/gaigai315/yuzuki-phone/master/manifest.json'
];
const ST_PHONE_UPDATE_LOG_URLS = [
    'https://raw.githubusercontent.com/gaigai315/yuzuki-phone/main/update-log.json',
    'https://raw.githubusercontent.com/gaigai315/yuzuki-phone/master/update-log.json'
];
const ST_PHONE_CURRENT_UPDATE = {
    version: ST_PHONE_VERSION,
    date: '2026-05-04',
    items: [
        '日记新增注入功能，可把日记历史写入上下文。',
        '语音支持豆包；群语音支持 MiniMax 与豆包混合调用。',
        '适配折叠手机屏显示问题，优化特殊屏幕下的小手机布局。'
    ]
};

// 🔥 防重复加载检查（放在最前面，避免任何代码执行）
if (window.GGP_Loaded) {
    console.warn('⚠️ 虚拟手机已加载，跳过重复初始化');
} else {
    window.GGP_Loaded = true;
    console.log(`🚀 虚拟手机 v${ST_PHONE_VERSION} 启动`);

    // 🔥 核心模块（启动时加载）- 只加载最必要的
    let APPS, PhoneStorage;
    let ApiManager = null;

    // 🔥 按需加载的模块
    let PhoneShell = null;         // 打开手机面板时加载
    let HomeScreen = null;         // 打开手机面板时加载
    let ImageUploadManager = null; // 打开手机面板时加载
    let TimeManager = null;        // 需要时加载
    let PromptManager = null;      // 发消息时加载
    let SettingsApp = null;        // 打开设置时加载
    let TtsManager = null;         // 语音管理器

    // 🔥 三击唤醒手势状态
    let phoneTapCount = 0;
    let phoneLastTapTime = 0;

    // 🔥 延迟初始化的变量
    let phoneShell = null;
    let homeScreen = null;
    let currentApp = null;
    let totalNotifications = 0;
    let currentApps = null;
    let storage = null;
    let settings = null;
    let timeManager = null;
    let promptManager = null;
    let ttsManager = null;
    let modulesLoaded = false;
    let _lastWechatChatId = null; // 🔥 防串味：记录上一次处理微信数据的 chatId
    let _globalCssLoadingPromise = null;
    let _phoneStableViewportHeight = 0;
    let _phoneKeyboardAnchorTop = 0;
    let _phoneViewportResizeTimer = null;
    // 🔥 防重放护盾：仅允许被显式标记的旧楼层重新解析（用于 Swipe/Regenerate）
    const _forcedReplayFloors = new Map(); // key: `${chatId}:${floor}`, value: expireAt

    function _makeForcedReplayKey(floor, chatId = null) {
        const safeFloor = Number.parseInt(floor, 10);
        if (!Number.isFinite(safeFloor) || safeFloor < 0) return '';
        const ctx = getContext?.();
        const safeChatId = String(chatId || ctx?.chatId || 'default').trim() || 'default';
        return `${safeChatId}:${safeFloor}`;
    }

    function markForcedReplayFloor(floor, ttlMs = 120000, chatId = null) {
        const key = _makeForcedReplayKey(floor, chatId);
        if (!key) return;
        const expireAt = Date.now() + Math.max(5000, Number.parseInt(ttlMs, 10) || 120000);
        _forcedReplayFloors.set(key, expireAt);
    }

    function consumeForcedReplayFloor(floor, chatId = null) {
        const now = Date.now();
        for (const [k, expire] of _forcedReplayFloors.entries()) {
            if (!Number.isFinite(expire) || expire <= now) {
                _forcedReplayFloors.delete(k);
            }
        }
        const key = _makeForcedReplayKey(floor, chatId);
        if (!key) return false;
        const expireAt = _forcedReplayFloors.get(key);
        if (!Number.isFinite(expireAt) || expireAt <= now) {
            _forcedReplayFloors.delete(key);
            return false;
        }
        _forcedReplayFloors.delete(key);
        return true;
    }

    function checkBetaLock() {
        return true;
    }

    function getRuntimeSettings() {
        if (storage && typeof storage.loadSettings === 'function') {
            const latest = storage.loadSettings();
            if (latest) settings = latest;
        }
        return settings;
    }

    function isPhoneFeatureEnabled() {
        const runtime = getRuntimeSettings();
        return !!(runtime && runtime.enabled);
    }

    function updatePhonePanelViewportHeight(options = {}) {
        const panel = document.getElementById('phone-panel');
        const root = document.documentElement;
        if (!root) return;

        const viewport = window.visualViewport;
        const layoutHeight = Math.max(
            window.innerHeight || 0,
            document.documentElement?.clientHeight || 0
        );
        const visualHeight = viewport?.height || layoutHeight;
        const keyboardGap = layoutHeight && visualHeight ? layoutHeight - visualHeight : 0;
        const stableGap = _phoneStableViewportHeight ? _phoneStableViewportHeight - visualHeight : 0;
        const activeTag = String(document.activeElement?.tagName || '').toLowerCase();
        const isTypingTarget = ['input', 'textarea', 'select'].includes(activeTag)
            || document.activeElement?.isContentEditable;
        const keyboardOpen = Boolean(isTypingTarget && (keyboardGap > 120 || stableGap > 120));
        const phoneBody = panel?.querySelector?.('.phone-body-panel');

        panel?.classList.toggle('phone-keyboard-open', keyboardOpen);

        if (options.force || !_phoneStableViewportHeight || !keyboardOpen) {
            _phoneStableViewportHeight = Math.max(layoutHeight, visualHeight, 320);
            if (phoneBody) {
                const rect = phoneBody.getBoundingClientRect();
                if (Number.isFinite(rect.top) && rect.top >= 0) {
                    _phoneKeyboardAnchorTop = Math.round(rect.top);
                }
            }
        }

        const targetHeight = keyboardOpen
            ? Math.max(visualHeight, 320)
            : Math.max(layoutHeight, visualHeight, 320);
        const safeKeyboardAnchorTop = keyboardOpen
            ? Math.max(0, Math.min(_phoneKeyboardAnchorTop || 0, targetHeight - 320))
            : Math.max(0, _phoneKeyboardAnchorTop || 0);
        root.style.setProperty('--phone-panel-vh', `${Math.round(targetHeight)}px`);
        root.style.setProperty('--phone-keyboard-anchor-top', `${Math.round(safeKeyboardAnchorTop)}px`);
    }

    function schedulePhonePanelViewportUpdate(options = {}) {
        clearTimeout(_phoneViewportResizeTimer);
        _phoneViewportResizeTimer = setTimeout(() => {
            updatePhonePanelViewportHeight(options);
        }, 60);
    }

    function bindPhonePanelViewportGuards() {
        window.removeEventListener('resize', schedulePhonePanelViewportUpdate);
        window.addEventListener('resize', schedulePhonePanelViewportUpdate, { passive: true });

        if (window.visualViewport) {
            window.visualViewport.removeEventListener('resize', schedulePhonePanelViewportUpdate);
            window.visualViewport.addEventListener('resize', schedulePhonePanelViewportUpdate, { passive: true });
        }

        document.removeEventListener('focusin', schedulePhonePanelViewportUpdate);
        document.removeEventListener('focusout', schedulePhonePanelViewportUpdate);
        document.removeEventListener('focusin', schedulePhonePanelViewportUpdate, true);
        document.removeEventListener('focusout', schedulePhonePanelViewportUpdate, true);
        document.addEventListener('focusin', schedulePhonePanelViewportUpdate, true);
        document.addEventListener('focusout', schedulePhonePanelViewportUpdate, true);
    }

    async function loadCoreModules() {
        if (modulesLoaded) return;

        const startTime = performance.now();

        // 🔥 彻底废弃懒加载，将最核心的5个大脑模块在启动时一口气全部读入内存！
        const [
            appsModule,
            storageModule,
            apiManagerModule,
            timeManagerModule,      // 👈 新增：时间推算引擎
            promptManagerModule,    // 👈 新增：全局提示词中枢
            ttsManagerModule
        ] = await Promise.all([
            import('./config/apps.js'),
            import('./config/storage.js'),
            import('./config/api-manager.js'),
            import('./config/time-manager.js'),    // 👈 取消懒加载
            import('./config/prompt-manager.js'),  // 👈 取消懒加载
            import('./config/tts-manager.js')
        ]);

        APPS = appsModule.APPS;
        PhoneStorage = storageModule.PhoneStorage;
        ApiManager = apiManagerModule.ApiManager;
        TimeManager = timeManagerModule.TimeManager;       // 👈 绑定类
        PromptManager = promptManagerModule.PromptManager; // 👈 绑定类
        TtsManager = ttsManagerModule.TtsManager;

        // 初始化核心对象
        currentApps = JSON.parse(JSON.stringify(APPS));
        storage = new PhoneStorage();
        settings = storage.loadSettings();

        // 🔥 立即实例化时间和提示词，拔除任何延迟隐患！
        timeManager = new TimeManager(storage);
        promptManager = new PromptManager(storage);
        ttsManager = new TtsManager(storage);
        promptManager.ensureLoaded(); // 强制把所有提示词立即读入内存待命

        modulesLoaded = true;

        const endTime = performance.now();
        console.log(`✅ 虚拟手机核心模块加载完成 (${Math.round(endTime - startTime)}ms)`);
    }

    // 🔥 UI 模块加载状态
    let uiModulesLoaded = false;

    // 🔥 按需加载 UI 模块（打开手机面板时才加载）
    async function loadUIModules() {
        if (uiModulesLoaded) return;

        const startTime = performance.now();

        const [
            phoneShellModule,
            homeScreenModule,
            imageUploadModule
        ] = await Promise.all([
            import('./phone/phone-shell.js'),
            import('./phone/home-screen.js'),
            import('./apps/settings/image-upload.js')
        ]);

        PhoneShell = phoneShellModule.PhoneShell;
        HomeScreen = homeScreenModule.HomeScreen;
        ImageUploadManager = imageUploadModule.ImageUploadManager;

        uiModulesLoaded = true;

        const endTime = performance.now();
        console.log(`✅ 虚拟手机 UI 模块加载完成 (${Math.round(endTime - startTime)}ms)`);
    }

    // 🔥 按需加载 TimeManager
    async function loadTimeManager() {
        if (window.VirtualPhone) window.VirtualPhone.timeManager = timeManager;
        return timeManager;
    }

    // 🔥 按需加载 PromptManager
    async function loadPromptManager() {
        if (window.VirtualPhone) window.VirtualPhone.promptManager = promptManager;
        return promptManager;
    }

    // 🔥 按需加载设置模块
    async function loadSettingsModule() {
        if (!SettingsApp) {
            const module = await import('./apps/settings/settings-app.js');
            SettingsApp = module.SettingsApp;
        }
        return SettingsApp;
    }

    // 🔥 新版：轻量级XML格式微信标签（简单闭合标签，属性在内容里）
    const WECHAT_TAG_REGEX_NEW = /<\s*wechat\b[^>]*>([\s\S]*?)<\s*\/\s*wechat\s*>/gi;
    const WECHAT_OFFLINE_REGEX = /<wechat><\/wechat>/gi;
    const WECHAT_EMPTY_REGEX = /<wechat><\/wechat>/gi;

    // 兼容旧版标签（逐步废弃）
    const LEGACY_PHONE_TAG = /<Phone>([\s\S]*?)<\/Phone>/gi;
    const LEGACY_WECHAT_TAG = /<wechat\s+chatId="([^"]+)"\s+from="([^"]+)">([\s\S]*?)<\/wechat>/gi;

    // 来电标签正则
    const PHONE_CALL_REGEX = /\[手机来电通话\]呼叫方[：:\s]+([^<。\.\n\r]+)/;

    // 音乐标签正则（新版完整卡片格式，兼容大小写/空格/属性）
    const MUSIC_TAG_REGEX = /<\s*music\b[^>]*>([\s\S]*?)<\/\s*music\s*>/gi;

    const _fallbackNotificationQueue = [];

    function stripWechatCommentWrapper(text) {
        let out = String(text || '').replace(/\r\n/g, '\n').trim();
        if (!out) return '';

        const wrappedMatch = out.match(/^<!--\s*([\s\S]*?)\s*-->$/);
        if (wrappedMatch) {
            out = String(wrappedMatch[1] || '');
        }

        return out
            .replace(/^\s*<!--\s*/i, '')
            .replace(/\s*-->\s*$/i, '')
            .replace(/^\s*<!--\s*$/gim, '')
            .replace(/^\s*-->\s*$/gim, '')
            .trim();
    }

    function extractWechatTagPayload(text) {
        const match = String(text || '').match(/<\s*wechat\b[^>]*>([\s\S]*?)<\s*\/\s*wechat\s*>/i);
        if (!match) return '';
        return stripWechatCommentWrapper(match[1]);
    }
    let _isFallbackNotificationShowing = false;
    let _currentFallbackNotificationData = null;
    let _currentFallbackNotificationEl = null;
    const FALLBACK_NOTIFICATION_VISIBLE_MS = 5000;
    const WEIBO_NOTIFY_AVATAR = {
        avatarText: '微',
        avatarBg: '#ff8200',
        avatarColor: '#fff'
    };

    function _isLikelyImagePath(value) {
        const v = String(value || '').trim();
        return /^(https?:\/\/|data:image\/|\/)/i.test(v);
    }

    function _normalizeWechatAvatarPath(value) {
        const raw = String(value || '').trim().replace(/\\/g, '/');
        if (!raw) return '';
        if (/^(https?:\/\/|data:image\/|\/)/i.test(raw)) return raw;

        // 兼容旧数据：male001.png / female001.png / avatars/male001.png
        const cleaned = raw
            .replace(/^(?:\.\.?\/)+/g, '')
            .replace(/^apps\/wechat\/avatars\//i, '')
            .replace(/^avatars\//i, '')
            .replace(/^\.?\//, '');

        if (!cleaned || /\s/.test(cleaned)) return '';

        if (/^(male|female)\d+$/i.test(cleaned)) {
            return new URL(`apps/wechat/avatars/${cleaned}.png`, ST_PHONE_BASE_URL).href;
        }
        if (/^(male|female)\d+\.(png|jpg|jpeg|webp|gif)$/i.test(cleaned)) {
            return new URL(`apps/wechat/avatars/${cleaned}`, ST_PHONE_BASE_URL).href;
        }
        if (/^[a-z0-9._-]+\.(png|jpg|jpeg|webp|gif)$/i.test(cleaned)) {
            return new URL(`apps/wechat/avatars/${cleaned}`, ST_PHONE_BASE_URL).href;
        }

        return '';
    }

    const _DEFAULT_WECHAT_FRIEND_AVATAR = new URL('apps/wechat/avatars/male001.png', ST_PHONE_BASE_URL).href;

    function _resolveWechatNotificationAvatar(wechatData, chat, existingContact, data = {}) {
        const isGroup = (chat?.type === 'group') || String(data?.chatType || '').toLowerCase() === 'group';

        // 1) 用户自定义头像优先
        const directCandidates = [
            String(chat?.avatar || '').trim(),
            String(data?.avatar || '').trim(),
            String(existingContact?.avatar || '').trim()
        ];
        for (const candidate of directCandidates) {
            const normalized = _normalizeWechatAvatarPath(candidate);
            if (normalized) return normalized;
        }

        if (!wechatData) return isGroup ? '' : _DEFAULT_WECHAT_FRIEND_AVATAR;

        // 2) 自动头像映射（按 contactId/name 多键尝试）
        const keySet = new Set([
            chat?.contactId,
            existingContact?.id,
            data?.contact,
            existingContact?.name,
            chat?.name
        ].filter(Boolean).map(v => String(v).trim()));

        for (const key of keySet) {
            const autoAv = _normalizeWechatAvatarPath(wechatData.getContactAutoAvatar?.(key));
            if (autoAv) return autoAv;
        }

        // 3) 兼容旧存档：直接读 contactAutoAvatarMap 里的相对文件名
        const autoMap = (typeof wechatData.getContactAutoAvatarMap === 'function')
            ? wechatData.getContactAutoAvatarMap()
            : null;
        if (autoMap && typeof autoMap === 'object') {
            for (const key of keySet) {
                const fromMap = _normalizeWechatAvatarPath(autoMap[key]);
                if (fromMap) return fromMap;
            }
        }

        // 4) 好友兜底默认头像（群聊不强行套好友头像）
        if (!isGroup) {
            let gender = 'unknown';
            for (const key of keySet) {
                const g = String(wechatData.getContactGender?.(key) || '').trim().toLowerCase();
                if (g === 'male' || g === 'female') {
                    gender = g;
                    break;
                }
            }
            const fallbackFile = gender === 'female' ? 'female001.png' : 'male001.png';
            return new URL(`apps/wechat/avatars/${fallbackFile}`, ST_PHONE_BASE_URL).href;
        }

        return isGroup ? '' : _DEFAULT_WECHAT_FRIEND_AVATAR;
    }

    function _buildFallbackAvatarElement(meta = {}, icon = '📱') {
        const avatarEl = document.createElement('div');
        avatarEl.className = 'notification-avatar';

        if (meta.avatarBg) avatarEl.style.background = String(meta.avatarBg);
        if (meta.avatarColor) avatarEl.style.color = String(meta.avatarColor);

        const avatarRaw = String(meta.avatar || '').trim();
        if (avatarRaw && _isLikelyImagePath(avatarRaw)) {
            const img = document.createElement('img');
            img.src = avatarRaw;
            img.alt = String(meta.name || 'avatar');
            avatarEl.appendChild(img);
            return avatarEl;
        }

        const text = document.createElement('span');
        text.className = 'notification-avatar-text';
        const fallbackText = String(meta.avatarText || (icon === '📱' ? '微' : '👤')).trim();
        text.textContent = avatarRaw || fallbackText;
        avatarEl.appendChild(text);
        return avatarEl;
    }

    function _drainFallbackNotificationQueue() {
        if (_isFallbackNotificationShowing) return;
        const next = _fallbackNotificationQueue.shift();
        if (!next) return;

        _isFallbackNotificationShowing = true;

        const iconMap = {
            '📱': 'fa-solid fa-mobile-screen',
            '💬': 'fa-solid fa-comment',
            '✅': 'fa-solid fa-check',
            '❌': 'fa-solid fa-xmark',
            '⚠️': 'fa-solid fa-triangle-exclamation',
            '🎵': 'fa-solid fa-music',
            '🌐': 'fa-solid fa-globe',
            '🚧': 'fa-solid fa-wrench',
            '📞': 'fa-solid fa-phone',
            '📵': 'fa-solid fa-phone-slash',
            '📹': 'fa-solid fa-video',
            '⏳': 'fa-solid fa-hourglass-half',
            '🔄': 'fa-solid fa-rotate',
            '📋': 'fa-solid fa-clipboard',
            '🏷️': 'fa-solid fa-tag',
            '📰': 'fa-solid fa-newspaper',
            '📍': 'fa-solid fa-location-dot',
            '🧧': 'fa-solid fa-envelope',
            '🗑️': 'fa-solid fa-trash',
        };
        const faClass = iconMap[next.icon] || 'fa-solid fa-bell';

        const meta = next.meta || {};
        const useRichLayout = !!(meta.avatar || meta.avatarText || meta.name || meta.content || meta.timeText);

        const notification = document.createElement('div');
        notification.className = `phone-notification notification-current${useRichLayout ? ' phone-notification-rich' : ''}`;
        notification.style.position = 'fixed';
        notification.style.top = '56px';
        notification.style.left = '50%';
        notification.style.transform = 'translateX(-50%)';
        notification.style.zIndex = '120000';
        notification.style.pointerEvents = 'none';

        if (useRichLayout) {
            const avatarEl = _buildFallbackAvatarElement(meta, next.icon);

            const contentEl = document.createElement('div');
            contentEl.className = 'notification-content';

            const headerEl = document.createElement('div');
            headerEl.className = 'notification-header';

            const titleEl = document.createElement('div');
            titleEl.className = 'notification-title';
            titleEl.textContent = String(meta.name || next.title || '');

            const timeEl = document.createElement('div');
            timeEl.className = 'notification-time';
            timeEl.textContent = String(meta.timeText || '刚刚');

            const messageEl = document.createElement('div');
            messageEl.className = 'notification-message';
            messageEl.textContent = String(meta.content || next.message || '');

            headerEl.appendChild(titleEl);
            headerEl.appendChild(timeEl);
            contentEl.appendChild(headerEl);
            contentEl.appendChild(messageEl);
            notification.appendChild(avatarEl);
            notification.appendChild(contentEl);
        } else {
            const iconEl = document.createElement('div');
            iconEl.className = 'notification-icon';
            iconEl.innerHTML = `<i class="${faClass}"></i>`;

            const contentEl = document.createElement('div');
            contentEl.className = 'notification-content';

            const titleEl = document.createElement('div');
            titleEl.className = 'notification-title';
            titleEl.textContent = next.title;

            const messageEl = document.createElement('div');
            messageEl.className = 'notification-message';
            messageEl.textContent = next.message;

            contentEl.appendChild(titleEl);
            contentEl.appendChild(messageEl);
            notification.appendChild(iconEl);
            notification.appendChild(contentEl);
        }

        _currentFallbackNotificationData = next;
        _currentFallbackNotificationEl = notification;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => {
                notification.remove();
                _isFallbackNotificationShowing = false;
                _currentFallbackNotificationData = null;
                _currentFallbackNotificationEl = null;
                _drainFallbackNotificationQueue();
            }, 320);
        }, FALLBACK_NOTIFICATION_VISIBLE_MS);
    }

    function showUnifiedPhoneNotification(title, message, icon = '📱', options = {}) {
        const safeTitle = String(title || '系统提示');
        const safeMessage = String(message || '');
        const meta = (options && typeof options === 'object') ? options : {};
        const senderKey = String(meta.senderKey || `${safeTitle}:${safeMessage}:${icon}`);

        // 核心修复：检查手机面板是否真实可见
        const phonePanel = document.getElementById('phone-panel');
        const isPhoneOpen = phonePanel && phonePanel.classList.contains('phone-panel-open');

        // 只有当手机壳存在，且手机面板是打开状态时，才把通知渲染进手机壳里
        if (isPhoneOpen && phoneShell?.showNotification && phoneShell.container) {
            phoneShell.showNotification(safeTitle, safeMessage, icon, { ...meta, senderKey });
            return;
        }

        // 如果当前显示的是同一个 senderKey，直接热更新文字
        if (_isFallbackNotificationShowing && _currentFallbackNotificationData?.senderKey === senderKey && _currentFallbackNotificationEl) {
            const titleEl = _currentFallbackNotificationEl.querySelector('.notification-title');
            const messageEl = _currentFallbackNotificationEl.querySelector('.notification-message');
            const timeEl = _currentFallbackNotificationEl.querySelector('.notification-time');
            if (titleEl) titleEl.textContent = String(meta.name || safeTitle);
            if (messageEl) messageEl.textContent = String(meta.content || safeMessage);
            if (timeEl) timeEl.textContent = String(meta.timeText || '刚刚');
            return;
        }

        // 队列中已存在同一 senderKey，更新为最新内容
        const queuedSame = _fallbackNotificationQueue.find(item => item.senderKey === senderKey);
        if (queuedSame) {
            queuedSame.title = safeTitle;
            queuedSame.message = safeMessage;
            queuedSame.icon = icon;
            queuedSame.meta = meta;
            return;
        }

        // 兜底：即使手机面板未打开，也通过统一队列逐条显示
        _fallbackNotificationQueue.push({
            title: safeTitle,
            message: safeMessage,
            icon: icon,
            meta: meta,
            senderKey: senderKey
        });
        _drainFallbackNotificationQueue();
    }

    function compareSemver(a, b) {
        const parse = (value) => String(value || '')
            .replace(/^v/i, '')
            .split(/[.-]/)
            .map(part => Number.parseInt(part, 10))
            .map(num => (Number.isFinite(num) ? num : 0));
        const left = parse(a);
        const right = parse(b);
        const maxLen = Math.max(left.length, right.length, 3);
        for (let i = 0; i < maxLen; i++) {
            const diff = (left[i] || 0) - (right[i] || 0);
            if (diff !== 0) return diff > 0 ? 1 : -1;
        }
        return 0;
    }

    function getKnownUpdateNotes(version = ST_PHONE_VERSION) {
        if (String(version || '') === ST_PHONE_CURRENT_UPDATE.version) {
            return ST_PHONE_CURRENT_UPDATE;
        }
        return {
            version: String(version || '新版'),
            date: '',
            items: [
                '检测到远程仓库已有新版小手机。',
                '请前往扩展管理或插件页面手动更新。',
                '更新后首次启动会展示该版本的本地更新公告。'
            ]
        };
    }

    function showPhoneUpdateModal(mode, updateInfo, options = {}) {
        const data = updateInfo || getKnownUpdateNotes();
        const version = String(data.version || ST_PHONE_VERSION);
        const items = Array.isArray(data.items) && data.items.length ? data.items : getKnownUpdateNotes(version).items;
        const title = mode === 'remote' ? '发现小手机新版' : '小手机已更新';
        const subtitle = mode === 'remote'
            ? `当前版本 ${ST_PHONE_VERSION}，最新版本 ${version}`
            : `版本 ${version}${data.date ? ` · ${data.date}` : ''}`;
        const primaryText = mode === 'remote' ? '知道了' : '不再显示';

        document.getElementById('st-phone-update-modal')?.remove();

        const overlay = document.createElement('div');
        const viewportController = new AbortController();
        const syncUpdateModalViewport = () => {
            const vv = window.visualViewport;
            const width = Math.max(320, Math.round(vv?.width || window.innerWidth || document.documentElement?.clientWidth || 360));
            const height = Math.max(320, Math.round(vv?.height || window.innerHeight || document.documentElement?.clientHeight || 640));
            const left = Math.round(vv?.offsetLeft || 0);
            const top = Math.round(vv?.offsetTop || 0);
            overlay.style.setProperty('--st-phone-update-vw', `${width}px`);
            overlay.style.setProperty('--st-phone-update-vh', `${height}px`);
            overlay.style.setProperty('--st-phone-update-left', `${left}px`);
            overlay.style.setProperty('--st-phone-update-top', `${top}px`);
        };

        overlay.id = 'st-phone-update-modal';
        overlay.className = 'st-phone-update-modal';
        overlay.innerHTML = `
            <div class="st-phone-update-dialog" role="dialog" aria-modal="true" aria-labelledby="st-phone-update-title">
                <div class="st-phone-update-mark">${mode === 'remote' ? '↗' : '✓'}</div>
                <div class="st-phone-update-content">
                    <div class="st-phone-update-kicker">${mode === 'remote' ? '需要手动更新' : '本次更新内容'}</div>
                    <div class="st-phone-update-title" id="st-phone-update-title">${title}</div>
                    <div class="st-phone-update-subtitle">${subtitle}</div>
                    <ul class="st-phone-update-list">
                        ${items.map(item => `<li>${String(item || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</li>`).join('')}
                    </ul>
                    ${mode === 'remote' ? '<div class="st-phone-update-note">请在酒馆扩展管理中更新，或手动替换插件文件。</div>' : ''}
                    <div class="st-phone-update-actions">
                        <button type="button" class="st-phone-update-btn st-phone-update-btn-primary">${primaryText}</button>
                    </div>
                </div>
            </div>
        `;

        const close = async () => {
            const rememberKey = String(options.rememberKey || '');
            if (rememberKey && storage?.set) {
                await storage.set(rememberKey, version);
            }
            viewportController.abort();
            overlay.remove();
            if (typeof options.onClose === 'function') {
                options.onClose();
            }
        };

        overlay.querySelector('.st-phone-update-btn-primary')?.addEventListener('click', close);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay && mode === 'remote') close();
        });
        window.addEventListener('resize', syncUpdateModalViewport, { passive: true, signal: viewportController.signal });
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', syncUpdateModalViewport, { passive: true, signal: viewportController.signal });
            window.visualViewport.addEventListener('scroll', syncUpdateModalViewport, { passive: true, signal: viewportController.signal });
        }
        syncUpdateModalViewport();
        document.body.appendChild(overlay);
    }

    async function showLocalUpdateAnnouncementIfNeeded(options = {}) {
        if (!storage?.get || !storage?.set) return;
        const seenVersion = String(storage.get('phone-update-announcement-seen-version') || '');
        if (seenVersion === ST_PHONE_VERSION) return false;
        showPhoneUpdateModal('local', ST_PHONE_CURRENT_UPDATE, {
            rememberKey: 'phone-update-announcement-seen-version',
            onClose: options.onClose
        });
        return true;
    }

    async function checkRemotePhoneUpdate() {
        if (!storage?.get || !storage?.set || !window.fetch) return;
        const lastCheckAt = Number.parseInt(storage.get('phone-update-last-check-at') || '0', 10) || 0;
        const now = Date.now();
        if (now - lastCheckAt < 6 * 60 * 60 * 1000) return;
        await storage.set('phone-update-last-check-at', String(now));

        let remoteManifest = null;
        for (const url of ST_PHONE_UPDATE_MANIFEST_URLS) {
            try {
                const resp = await fetch(`${url}?_=${now}`, { cache: 'no-store' });
                if (!resp.ok) continue;
                remoteManifest = await resp.json();
                break;
            } catch (_e) {
                // 网络不可用或仓库不可达时静默失败，不能影响插件启动。
            }
        }
        const latestVersion = String(remoteManifest?.version || '').trim();
        if (!latestVersion || compareSemver(latestVersion, ST_PHONE_VERSION) <= 0) return;

        const acknowledged = String(storage.get('phone-update-remote-ack-version') || '');
        if (acknowledged === latestVersion) return;

        const notes = await fetchRemoteUpdateNotes(latestVersion, now);
        if (remoteManifest?.description && notes.version !== ST_PHONE_CURRENT_UPDATE.version) {
            notes.items = [
                `远程版本说明：${remoteManifest.description}`,
                ...notes.items
            ];
        }
        showPhoneUpdateModal('remote', notes, {
            rememberKey: 'phone-update-remote-ack-version'
        });
    }

    async function fetchRemoteUpdateNotes(version, cacheBust = Date.now()) {
        for (const url of ST_PHONE_UPDATE_LOG_URLS) {
            try {
                const resp = await fetch(`${url}?_=${cacheBust}`, { cache: 'no-store' });
                if (!resp.ok) continue;
                const log = await resp.json();
                const entry = log?.versions?.[version];
                if (entry && Array.isArray(entry.items) && entry.items.length) {
                    return {
                        version,
                        date: String(entry.date || ''),
                        items: entry.items.map(item => String(item || '')).filter(Boolean)
                    };
                }
            } catch (_e) {
                // 更新日志不可达时使用内置兜底文案。
            }
        }
        return getKnownUpdateNotes(version);
    }

    function schedulePhoneUpdateNotices() {
        setTimeout(() => {
            Promise.resolve(showLocalUpdateAnnouncementIfNeeded({ onClose: checkRemotePhoneUpdate })).then((showedLocal) => {
                if (!showedLocal) checkRemotePhoneUpdate();
            });
        }, 900);
    }

    async function getOrCreateMofoData() {
        if (!window.VirtualPhone) window.VirtualPhone = {};
        if (window.VirtualPhone.cachedMofoData) {
            if (window.VirtualPhone.mofoApp && window.VirtualPhone.mofoApp.mofoData !== window.VirtualPhone.cachedMofoData) {
                window.VirtualPhone.mofoApp.mofoData = window.VirtualPhone.cachedMofoData;
            }
            return window.VirtualPhone.cachedMofoData;
        }

        if (window.VirtualPhone.mofoApp?.mofoData) {
            window.VirtualPhone.cachedMofoData = window.VirtualPhone.mofoApp.mofoData;
            return window.VirtualPhone.cachedMofoData;
        }

        const module = await import('./apps/mofo/mofo-data.js');
        window.VirtualPhone.cachedMofoData = new module.MofoData(storage);
        if (window.VirtualPhone.mofoApp && window.VirtualPhone.mofoApp.mofoData !== window.VirtualPhone.cachedMofoData) {
            window.VirtualPhone.mofoApp.mofoData = window.VirtualPhone.cachedMofoData;
        }
        return window.VirtualPhone.cachedMofoData;
    }

    function insertTextToSendTextarea(text, cursorOffset = null) {
        const textarea = document.getElementById('send_textarea');
        if (!textarea) return false;

        const safeText = String(text || '');
        const startPos = textarea.selectionStart || textarea.value.length;
        const endPos = textarea.selectionEnd || textarea.value.length;
        const textBefore = textarea.value.substring(0, startPos);
        const textAfter = textarea.value.substring(endPos, textarea.value.length);

        textarea.value = textBefore + safeText + textAfter;
        const offset = Number.isInteger(cursorOffset) ? cursorOffset : safeText.length;
        const newCursorPos = startPos + Math.max(0, Math.min(offset, safeText.length));
        textarea.selectionStart = newCursorPos;
        textarea.selectionEnd = newCursorPos;
        textarea.focus();
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }

    async function processMofoTags(rawText, { source = 'assistant', messageIndex = null } = {}) {
        const safeText = String(rawText || '').trim();
        if (!safeText) return [];

        try {
            const mofoData = await getOrCreateMofoData();
            if (!mofoData || typeof mofoData.applyTagUpdatesFromText !== 'function') return [];
            return mofoData.applyTagUpdatesFromText(safeText, { source, messageIndex });
        } catch (e) {
            console.warn('⚠️ [魔坊] 标签解析失败:', e);
            return [];
        }
    }

    // ==========================================
    //  新增：魔坊动态更新气泡 & 全局速览弹窗
    // ==========================================
    if (!window.VirtualPhone) window.VirtualPhone = {};
    window.VirtualPhone.showMofoUpdateBubble = async function (mofoId) {
        try {
            const mofoData = await getOrCreateMofoData();
            const item = mofoData?.getItemById?.(mofoId);
            if (!item) return;

            const hostDoc = (() => {
                let hostWindow = window;
                try {
                    let probe = window;
                    while (probe.parent && probe.parent !== probe) {
                        const next = probe.parent;
                        if (!next.document?.body) break;
                        probe = next;
                    }
                    hostWindow = probe;
                } catch (e) {}
                try {
                    return hostWindow.document || document;
                } catch (e) {
                    return document;
                }
            })();
            const hostWin = hostDoc.defaultView || window;

            const escapeHtml = (text) => String(text ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
            const sanitizePreviewHtml = (html) => String(html || '')
                .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
                .replace(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
                .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, ' $1="#"');

            // 1. 注入气泡和弹窗的基础 CSS (只注入一次)
            {
                let style = hostDoc.getElementById('mofo-global-bubble-style');
                if (!style) {
                    style = hostDoc.createElement('style');
                    style.id = 'mofo-global-bubble-style';
                    (hostDoc.head || hostDoc.documentElement).appendChild(style);
                }
                style.textContent = `
                    #mofo-global-bubble-root {
                        position: fixed;
                        inset: 0;
                        z-index: 2147483646;
                        pointer-events: none;
                        isolation: isolate;
                    }
                    .mofo-update-bubble {
                        position: fixed;
                        width: max-content;
                        min-width: 142px;
                        max-width: min(78vw, 260px);
                        min-height: 46px;
                        padding: 5px 6px;
                        transform: translate(-50%, -50%) scale(0.9);
                        border-radius: 8px;
                        display: flex;
                        align-items: stretch;
                        justify-content: stretch;
                        background: linear-gradient(180deg,
                            rgba(243,248,255,0.84) 0%,
                            rgba(233,240,252,0.8) 62%,
                            rgba(214,226,246,0.86) 100%);
                        backdrop-filter: blur(10px) saturate(118%);
                        -webkit-backdrop-filter: blur(10px) saturate(118%);
                        border: 1px solid rgba(255,255,255,0.58);
                        box-shadow:
                            inset 0 1px 0 rgba(255,255,255,0.65),
                            0 10px 22px rgba(20,35,70,0.24);
                        box-sizing: border-box;
                        z-index: 2147483646;
                        cursor: pointer;
                        opacity: 0;
                        pointer-events: auto;
                        user-select: none;
                        transition: transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
                    }
                    .mofo-update-bubble::before {
                        content: '';
                        position: absolute;
                        inset: 0;
                        border-radius: inherit;
                        background: linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 100%);
                        pointer-events: none;
                    }
                    .mofo-update-bubble::after {
                        content: '';
                        position: absolute;
                        inset: 0;
                        border-radius: inherit;
                        border: 1px solid rgba(132, 156, 194, 0.34);
                        opacity: 0.7;
                        pointer-events: none;
                    }
                    .mofo-update-bubble.show {
                        transform: translate(-50%, -50%) scale(1);
                        opacity: 1;
                        animation: mofoRankFloat 2.6s ease-in-out infinite;
                    }
                    .mofo-update-bubble:hover {
                        transform: translate(-50%, -50%) scale(1.025);
                        filter: brightness(1.02);
                        box-shadow:
                            inset 0 1px 0 rgba(255,255,255,0.74),
                            0 14px 28px rgba(20,35,70,0.28);
                    }
                    .mofo-update-bubble:active { transform: translate(-50%, -50%) scale(0.98); }
                    .mofo-bubble-rank-mini {
                        position: relative;
                        z-index: 1;
                        width: 100%;
                        border-radius: 7px;
                        padding: 6px 7px;
                        background: linear-gradient(145deg, rgba(255,255,255,0.24), rgba(223,234,250,0.2));
                        border: 1px solid rgba(255,255,255,0.5);
                        box-shadow: inset 0 1px 0 rgba(255,255,255,0.45);
                    }
                    .mofo-bubble-rank-row {
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        align-items: center;
                        min-width: 0;
                    }
                    .mofo-bubble-rank-name {
                        font-size: 11px;
                        color: #355986;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        text-align: center;
                        font-weight: 700;
                        max-width: 100%;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        padding: 2px 10px;
                        background: rgba(255,255,255,0.62);
                        border: 1px solid rgba(136,168,214,0.52);
                        border-radius: 999px;
                        box-shadow: inset 0 1px 0 rgba(255,255,255,0.65);
                    }
                    #mofo-global-preview-overlay {
                        position: fixed;
                        inset: 0;
                        background: rgba(0,0,0,0.4);
                        z-index: 2147483647;
                        opacity: 0;
                        transition: opacity 0.2s ease;
                        backdrop-filter: blur(3px);
                        -webkit-backdrop-filter: blur(3px);
                    }
                    #mofo-global-preview-pop {
                        position: fixed;
                        left: 50%;
                        top: 50%;
                        transform: translate(-50%, -50%);
                        max-width: min(92vw, 920px);
                        max-height: 85vh;
                        overflow: auto;
                        box-sizing: border-box;
                        animation: mofoPopIn 0.26s cubic-bezier(0.2, 0.8, 0.2, 1);
                    }
                    @keyframes mofoRankFloat {
                        0%, 100% { transform: translate(-50%, -50%) scale(1); }
                        50% { transform: translate(-50%, calc(-50% - 3px)) scale(1.012); }
                    }
                    @keyframes mofoPopIn { 0% { transform: translate(-50%, -50%) scale(0.94); opacity: 0; } 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
                `;
            }

            let bubbleRoot = hostDoc.getElementById('mofo-global-bubble-root');
            if (!bubbleRoot) {
                bubbleRoot = hostDoc.createElement('div');
                bubbleRoot.id = 'mofo-global-bubble-root';
                (hostDoc.documentElement || hostDoc.body).appendChild(bubbleRoot);
            }

            const oldBubble = bubbleRoot.querySelector('.mofo-update-bubble');
            if (oldBubble) oldBubble.remove();
            window.VirtualPhone._mofoBubblePositionController?.abort?.();
            window.VirtualPhone._mofoBubbleDismissController?.abort?.();

            const bubblePositionController = new AbortController();
            window.VirtualPhone._mofoBubblePositionController = bubblePositionController;
            const bubbleDismissController = new AbortController();
            window.VirtualPhone._mofoBubbleDismissController = bubbleDismissController;

            // 2. 创建气泡 DOM
            const bubble = hostDoc.createElement('div');
            bubble.className = 'mofo-update-bubble';
            bubble.innerHTML = `
                <div class="mofo-bubble-rank-mini">
                    <div class="mofo-bubble-rank-row">
                        <span class="mofo-bubble-rank-name">${escapeHtml(item.name)}</span>
                    </div>
                </div>
            `;
            bubbleRoot.appendChild(bubble);

            const positionBubble = () => {
                if (!bubble.isConnected) {
                    bubblePositionController.abort();
                    return;
                }
                const vv = hostWin.visualViewport;
                const viewWidth = vv?.width || hostWin.innerWidth || window.innerWidth;
                const viewHeight = vv?.height || hostWin.innerHeight || window.innerHeight;
                const offsetLeft = vv?.offsetLeft || 0;
                const offsetTop = vv?.offsetTop || 0;
                const pickAnchorRect = () => {
                    const candidates = [
                        hostDoc.querySelector('#send_textarea'),
                        hostDoc.querySelector('#send_form'),
                        hostDoc.querySelector('#form_sheld')
                    ].filter(Boolean);
                    let best = null;
                    for (const el of candidates) {
                        const rect = el.getBoundingClientRect?.();
                        if (!rect || rect.width <= 0 || rect.height <= 0) continue;
                        const inLowerHalf = rect.top >= (viewHeight * 0.45);
                        if (!inLowerHalf) continue;
                        if (!best || rect.top > best.top) {
                            best = rect;
                        }
                    }
                    return best;
                };
                const anchorRect = pickAnchorRect();
                const hasAnchor = !!anchorRect;
                const bubbleHalfWidth = Math.max(24, (bubble.offsetWidth || 120) / 2);
                const bubbleHalfHeight = Math.max(20, (bubble.offsetHeight || 48) / 2);

                let targetX = offsetLeft + (viewWidth / 2);
                let targetY = offsetTop + viewHeight - bubbleHalfHeight - 22;

                if (hasAnchor) {
                    targetX = offsetLeft + anchorRect.left + (anchorRect.width / 2);
                    targetY = offsetTop + anchorRect.top - bubbleHalfHeight - 10;
                }

                const minX = offsetLeft + bubbleHalfWidth + 8;
                const maxX = offsetLeft + viewWidth - bubbleHalfWidth - 8;
                const minY = offsetTop + bubbleHalfHeight + 8;
                const maxY = offsetTop + viewHeight - bubbleHalfHeight - 8;
                targetX = Math.max(minX, Math.min(maxX, targetX));
                targetY = Math.max(minY, Math.min(maxY, targetY));

                bubble.style.left = `${targetX}px`;
                bubble.style.top = `${targetY}px`;
            };

            hostWin.addEventListener('resize', positionBubble, { passive: true, signal: bubblePositionController.signal });
            if (hostWin.visualViewport) {
                hostWin.visualViewport.addEventListener('resize', positionBubble, { passive: true, signal: bubblePositionController.signal });
                hostWin.visualViewport.addEventListener('scroll', positionBubble, { passive: true, signal: bubblePositionController.signal });
            }
            positionBubble();

            // 动画滑入
            setTimeout(() => bubble.classList.add('show'), 40);

            const hideBubble = () => {
                bubble.classList.remove('show');
                setTimeout(() => {
                    bubble.remove();
                    bubblePositionController.abort();
                    bubbleDismissController.abort();
                    if (window.VirtualPhone._mofoBubblePositionController === bubblePositionController) {
                        window.VirtualPhone._mofoBubblePositionController = null;
                    }
                    if (window.VirtualPhone._mofoBubbleDismissController === bubbleDismissController) {
                        window.VirtualPhone._mofoBubbleDismissController = null;
                    }
                }, 220);
            };

            // 点击空白处关闭（不自动消失）
            const closeByOutside = (e) => {
                const target = e?.target;
                if (!target) return;
                if (bubble.contains(target)) return;
                hideBubble();
            };
            hostDoc.addEventListener('pointerdown', closeByOutside, { capture: true, signal: bubbleDismissController.signal });
            hostDoc.addEventListener('mousedown', closeByOutside, { capture: true, signal: bubbleDismissController.signal });
            hostDoc.addEventListener('touchstart', closeByOutside, { passive: true, capture: true, signal: bubbleDismissController.signal });

            // 3. 点击气泡 -> 打开全屏速览
            bubble.onclick = () => {
                hideBubble();

                // --- 解析模板与CSS ---
                const htmlTemplate = String(item['html模板'] ?? item.htmlTemplate ?? item.templateHtml ?? '').trim();
                let innerHtml = '';
                if (htmlTemplate && typeof mofoData.renderTemplate === 'function') {
                    const rendered = mofoData.renderTemplate(htmlTemplate, item.state || {});
                    innerHtml = sanitizePreviewHtml(rendered);
                }
                if (!innerHtml.trim()) {
                    // 兜底渲染（针对没有写HTML模板或模板渲染为空的条目）
                    const rows = Object.entries(item.state || {}).map(([k, v]) => `
                        <div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:6px; padding:8px; background:#f5f8ff; border-radius:8px;">
                            <span style="color:#3c5277; font-size:12px;">${escapeHtml(k)}</span>
                            <strong style="color:#1f2f46; font-size:12px;">${escapeHtml(typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''))}</strong>
                        </div>
                    `).join('');
                    innerHtml = `<div class="mofo-preview-card" style="padding:12px; background:#fff; border-radius:12px;">
                        <div style="font-size:14px; font-weight:bold; margin-bottom:10px;">${escapeHtml(item.name)}</div>
                        ${rows || '<div class="mofo-runtime-empty" style="text-align:center; color:#999; padding:20px;">暂无数据</div>'}
                    </div>`;
                }

                // 为了防止 CSS 污染，包裹一个特定的作用域 class
                const scopeClass = 'mofo-global-scope-' + Date.now();
                const cssTextRaw = String(item.cssText || '').replace(/<\/style/gi, '<\\/style');
                const cssText = cssTextRaw.replace(/(^|[{}])(\s*[^@{}][^{}]*?)\{/g, (match, p1, p2) => {
                    const scoped = String(p2 || '')
                        .split(',')
                        .map((sel) => {
                            const selector = String(sel || '').trim();
                            if (!selector) return '';
                            if (/^(from|to|\d+%)$/i.test(selector)) return selector;
                            if (/^(html|body|:root)$/i.test(selector)) return `.${scopeClass}`;
                            if (selector.startsWith(`.${scopeClass}`)) return selector;
                            return `.${scopeClass} ${selector}`;
                        })
                        .filter(Boolean)
                        .join(', ');
                    return scoped ? `${p1}${scoped}{` : match;
                });

                // --- 创建遮罩层与卡片 ---
                const oldOverlay = hostDoc.getElementById('mofo-global-preview-overlay');
                oldOverlay?.remove();
                const overlay = hostDoc.createElement('div');
                overlay.id = 'mofo-global-preview-overlay';

                const pop = hostDoc.createElement('div');
                pop.id = 'mofo-global-preview-pop';
                pop.className = scopeClass;
                pop.innerHTML = `<style>${cssText}</style>${innerHtml}`;
                overlay.appendChild(pop);
                (hostDoc.documentElement || hostDoc.body).appendChild(overlay);

                const positionPop = () => {
                    if (!pop.isConnected) return;
                    const vv = hostWin.visualViewport;
                    const viewWidth = vv?.width || hostWin.innerWidth || window.innerWidth;
                    const viewHeight = vv?.height || hostWin.innerHeight || window.innerHeight;
                    const offsetLeft = vv?.offsetLeft || 0;
                    const offsetTop = vv?.offsetTop || 0;
                    pop.style.left = `${offsetLeft + (viewWidth / 2)}px`;
                    pop.style.top = `${offsetTop + (viewHeight / 2)}px`;
                    pop.style.maxHeight = `${Math.max(240, viewHeight - 28)}px`;
                };
                positionPop();

                const previewController = new AbortController();
                hostWin.addEventListener('resize', positionPop, { passive: true, signal: previewController.signal });
                if (hostWin.visualViewport) {
                    hostWin.visualViewport.addEventListener('resize', positionPop, { passive: true, signal: previewController.signal });
                    hostWin.visualViewport.addEventListener('scroll', positionPop, { passive: true, signal: previewController.signal });
                }

                // 淡入
                setTimeout(() => { overlay.style.opacity = '1'; }, 10);

                let overlayClosed = false;
                const closeOverlay = () => {
                    if (overlayClosed) return;
                    overlayClosed = true;
                    previewController.abort();
                    overlay.style.opacity = '0';
                    setTimeout(() => overlay.remove(), 200);
                };

                // 点击空白处关闭
                const closeByOutside = (e) => {
                    const target = e?.target;
                    if (!target) return;
                    if (pop.contains(target)) return;
                    closeOverlay();
                };
                overlay.addEventListener('pointerdown', closeByOutside, true);
                overlay.addEventListener('mousedown', closeByOutside, true);
                overlay.addEventListener('touchstart', closeByOutside, { passive: true, capture: true });
                hostDoc.addEventListener('pointerdown', closeByOutside, { capture: true, signal: previewController.signal });
                hostDoc.addEventListener('mousedown', closeByOutside, { capture: true, signal: previewController.signal });
                hostDoc.addEventListener('touchstart', closeByOutside, { passive: true, capture: true, signal: previewController.signal });
            };
        } catch (e) {
            console.error('魔坊气泡生成失败:', e);
        }
    };

    async function buildMofoOfflinePromptContent() {
        try {
            const mofoData = await getOrCreateMofoData();
            if (!mofoData) return '';

            const items = (typeof mofoData.getOfflinePromptItems === 'function')
                ? mofoData.getOfflinePromptItems()
                : ((typeof mofoData.getItems === 'function' ? mofoData.getItems() : []) || [])
                    .filter(item => item && item.offlinePromptEnabled !== false && String(item.promptTemplate || '').trim());

            if (!Array.isArray(items) || items.length === 0) return '';

            const stringifyState = (value) => {
                if (value === null) return 'null';
                if (typeof value === 'undefined') return '';
                if (typeof value === 'object') {
                    try { return JSON.stringify(value); } catch (e) { return '[object]'; }
                }
                return String(value);
            };
            const buildStateLines = (stateObj) => {
                const entries = Object.entries(stateObj || {});
                if (entries.length === 0) return '暂无状态';
                return entries.map(([k, v]) => `${k}: ${stringifyState(v)}`).join('\n');
            };
            const formatUpdatedAt = (ts) => {
                const n = Number(ts || 0);
                if (!Number.isFinite(n) || n <= 0) return '未知';
                const d = new Date(n);
                if (Number.isNaN(d.getTime())) return '未知';
                return d.toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            };

            const blocks = items.map(item => {
                const name = String(item?.name || '魔坊').trim() || '魔坊';
                const tagName = String(item?.tagName || name).trim() || name;
                const stateObj = (item?.state && typeof item.state === 'object' && !Array.isArray(item.state))
                    ? item.state
                    : {};
                const stateJson = (() => {
                    try { return JSON.stringify(stateObj, null, 2); } catch (e) { return '{}'; }
                })();
                const stateLines = buildStateLines(stateObj);
                const lastPayload = String(item?.lastPayload || '').trim() || '无';
                const updatedAt = formatUpdatedAt(item?.updatedAt);

                let tpl = String(item?.promptTemplate || '').trim();
                tpl = tpl
                    .replace(/\{\{mofoName\}\}/gi, name)
                    .replace(/\{\{mofoTag\}\}/gi, tagName)
                    .replace(/\{\{mofoState\}\}/gi, stateLines)
                    .replace(/\{\{mofoStateJson\}\}/gi, stateJson)
                    .replace(/\{\{mofoLastPayload\}\}/gi, lastPayload)
                    .replace(/\{\{mofoUpdatedAt\}\}/gi, updatedAt);

                return [
                    `【魔坊条目】${name}`,
                    `标签: <${tagName}>`,
                    `更新时间: ${updatedAt}`,
                    `当前状态:`,
                    stateLines,
                    `提示词模板:`,
                    tpl
                ].join('\n');
            });

            return `【魔坊线下提示词】\n${blocks.join('\n\n')}\n`;
        } catch (e) {
            console.warn('⚠️ [魔坊] 构建线下提示词失败:', e);
            return '';
        }
    }

    // 🔥 新增：在底部栏创建内嵌回复按钮（全局守护进程）
    function createInlineReplyButton() {
        const btnId = 'st-phone-inline-reply-btn';
        const legacyWrapperId = 'st-phone-inline-reply-wrapper';
        const qrScriptContainerId = 'script_container_st_phone_inline_reply';
        const qrWhitelistId = 'JSR::st_phone_inline_reply';
        const qrWhitelistItemId = 'st-phone-inline-reply-whitelist-item';
        const qrWhitelistInitKey = 'phone_inline_reply_qr_whitelist_initialized';
        const qrMenuItemId = 'st-phone-inline-reply-action-item';

        // 注入基础 CSS
        if (!document.getElementById('st-phone-inline-reply-style')) {
            const style = document.createElement('style');
            style.id = 'st-phone-inline-reply-style';
            style.textContent = `
                .remote-ctrl-btn { transition: all 0.2s; flex-shrink: 0; display: flex !important; align-items: center !important; justify-content: center !important; }
                .remote-ctrl-btn .qr--button-label { display: flex !important; align-items: center !important; justify-content: center !important; width: 100%; height: 100%; }
                .remote-ctrl-btn.active { opacity: 1 !important; color: var(--qc-accent); }
                .st-phone-inline-reply-wrapper { display: flex; align-items: center; }
    #phone-inline-reply-menu-pop {
    position: fixed; z-index: 2147483645;
    background: linear-gradient(180deg,
        rgba(243,248,255,0.72) 0%,
        rgba(233,240,252,0.66) 62%,
        rgba(214,226,246,0.82) 100%);
    backdrop-filter: blur(20px) saturate(135%);
    -webkit-backdrop-filter: blur(20px) saturate(135%);
    border: 1px solid rgba(255,255,255,0.52);
    border-radius: 12px;
    box-shadow: 0 14px 38px rgba(20,35,70,0.32), inset 0 1px 0 rgba(255,255,255,0.65);
    padding: 8px; 
    overflow: hidden; display: flex; flex-direction: column; gap: 6px;
    
    left: 50%;
    width: clamp(240px, 82vw, 420px); 
    height: clamp(280px, 68vh, 460px);
    max-height: calc(100dvh - 20px);
    box-sizing: border-box;

    /* 🔥 新增：移动端手势豁免，允许上下滑动，屏蔽左右滑动误触侧边栏，防止滚动穿透 */
    touch-action: pan-y !important;
    overscroll-behavior-y: contain !important;
}

#phone-inline-reply-menu-pop::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(180deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.04) 100%);
    pointer-events: none;
}

#phone-inline-reply-menu-pop::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 56px;
    border-radius: 0 0 12px 12px;
    background: linear-gradient(180deg, rgba(213,225,245,0) 0%, rgba(194,211,238,0.52) 100%);
    pointer-events: none;
}

/* 🔥 新增：用于显示真实头像的 CSS 类 */
.inline-reply-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.22);
    object-fit: cover;
    flex-shrink: 0;
}

/* 🔥 修复：让图标和 emoji 居中对齐 */
.inline-reply-menu-item > span:first-child {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.22);
    background: rgba(255,255,255,0.08);
    font-size: 16px;
}
                #phone-inline-reply-menu-pop::-webkit-scrollbar { width: 0; height: 0; }
                .inline-reply-menu-item {
                    display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px;
                    border: 1px solid rgba(151,171,207,0.46);
                    background: rgba(255,255,255,0.26);
                    box-shadow: inset 0 1px 0 rgba(255,255,255,0.5);
                    cursor: pointer; color: var(--SmartThemeBodyColor, #fff); font-size: 14px;
                    transition: background 0.2s, border-color 0.2s, transform 0.12s;
                    user-select: none;
                    position: relative;
                    z-index: 1;
                }
                .inline-reply-menu-item:hover {
                    background: rgba(255,255,255,0.44);
                    border-color: rgba(126,150,194,0.7);
                }
                .inline-reply-menu-item:active { transform: translateY(1px); }
                .inline-reply-name {
                    flex: 1;
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .inline-reply-tabbar {
                    display: flex;
                    gap: 6px;
                    margin-bottom: 8px;
                    flex-shrink: 0;
                    position: sticky;
                    top: 0;
                    z-index: 4;
                    background: linear-gradient(180deg, rgba(235,242,252,0.95), rgba(235,242,252,0.78));
                    padding-bottom: 6px;
                }
                .inline-reply-tab-btn {
                    flex: 1;
                    border: 1px solid rgba(129, 151, 192, 0.5);
                    border-radius: 8px;
                    background: rgba(255,255,255,0.35);
                    font-size: 12px;
                    color: #2e456f;
                    font-weight: 700;
                    padding: 7px 8px;
                    cursor: pointer;
                }
                .inline-reply-tab-btn.is-active {
                    background: linear-gradient(135deg, rgba(87,132,223,0.28), rgba(79,121,208,0.42));
                    border-color: rgba(66, 104, 183, 0.78);
                    color: #17315a;
                }
                .inline-reply-page {
                    display: none;
                    flex: 1;
                    min-height: 0;
                    overflow-y: auto;
                    overflow-x: hidden;
                    scrollbar-width: none;
                    -ms-overflow-style: none;
                    touch-action: pan-y !important;
                    overscroll-behavior-y: contain;
                }
                .inline-reply-page::-webkit-scrollbar { width: 0; height: 0; display: none; }
                .inline-reply-page.is-active { display: block; }
                .inline-reply-section-title {
                    font-size: 12px;
                    color: #6b7894;
                    padding: 2px 8px 6px;
                    border-bottom: 1px solid rgba(139,160,198,0.28);
                    margin-bottom: 6px;
                    font-weight: 700;
                    text-align: center;
                    letter-spacing: 0.5px;
                }
                .mofo-toolbar {
                    display: flex;
                    gap: 6px;
                    margin-bottom: 8px;
                }
                .mofo-toolbar-btn {
                    flex: 1;
                    border: 1px solid rgba(116, 139, 184, 0.55);
                    border-radius: 8px;
                    background: rgba(255,255,255,0.34);
                    color: #264672;
                    font-size: 11px;
                    padding: 6px 8px;
                    cursor: pointer;
                    font-weight: 700;
                }
                .mofo-entry {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    border: 1px solid rgba(151,171,207,0.46);
                    border-radius: 8px;
                    background: rgba(255,255,255,0.24);
                    padding: 9px 10px;
                    margin-bottom: 6px;
                    cursor: pointer;
                }
                .mofo-entry.is-active {
                    border-color: rgba(89, 121, 187, 0.85);
                    background: rgba(125, 164, 234, 0.28);
                }
                .mofo-entry-name {
                    font-size: 13px;
                    font-weight: 700;
                    color: #21436f;
                }
                .mofo-entry-head {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                }
                .mofo-entry-toggle {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 10px;
                    color: #43618f;
                    cursor: pointer;
                    user-select: none;
                }
                .mofo-entry-toggle input {
                    margin: 0;
                    accent-color: #4f7fd5;
                    cursor: pointer;
                }
                .mofo-entry-tag {
                    font-size: 11px;
                    color: #5372a1;
                }
                .mofo-entry-status {
                    font-size: 10px;
                }
                .mofo-preview-wrap {
                    margin-top: 8px;
                    border: 1px solid rgba(116, 139, 184, 0.45);
                    border-radius: 10px;
                    background: rgba(255,255,255,0.28);
                    padding: 8px;
                }
                .mofo-preview-head {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 6px;
                    gap: 8px;
                }
                .mofo-preview-title {
                    font-size: 12px;
                    color: #21436f;
                    font-weight: 700;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .mofo-preview-tag {
                    font-size: 10px;
                    color: #5f7da9;
                    white-space: nowrap;
                }
                .mofo-preview-card {
                    border-radius: 9px;
                    border: 1px solid rgba(120, 141, 181, 0.35);
                    background: rgba(255,255,255,0.25);
                    padding: 8px;
                }
                .mofo-kv-row {
                    display: flex;
                    justify-content: space-between;
                    gap: 6px;
                    font-size: 11px;
                    padding: 5px 6px;
                    border-radius: 7px;
                    background: rgba(255,255,255,0.34);
                    margin-bottom: 5px;
                }
                .mofo-kv-key {
                    color: #355986;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .mofo-kv-val {
                    color: #14345b;
                    font-weight: 700;
                    max-width: 56%;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    text-align: right;
                }
                .mofo-preview-actions {
                    display: flex;
                    gap: 6px;
                    margin-top: 7px;
                }
                .mofo-action-btn {
                    flex: 1;
                    border: 1px solid rgba(116, 139, 184, 0.55);
                    border-radius: 8px;
                    background: rgba(255,255,255,0.35);
                    color: #284a76;
                    font-size: 11px;
                    padding: 6px 8px;
                    cursor: pointer;
                    font-weight: 700;
                }
                .mofo-action-btn.delete {
                    border-color: rgba(188, 92, 117, 0.7);
                    color: #a33c57;
                }
            `;
            document.head.appendChild(style);
        }

        const getInlineReplyHost = () => {
            const qrBar = document.getElementById('qr--bar');
            const isQrAssistantEnabled = !!document.body?.classList?.contains('qra-enabled');

            // QR 助手启用时：直接挂在 qr--bar 根层，避开其对子容器的白名单隐藏规则
            if (isQrAssistantEnabled && qrBar) return qrBar;

            // 优先：QR 助手启用后的可见容器
            const visibleQrHost =
                document.querySelector('#qr--bar > .qr--buttons.qrq-wrapper-visible') ||
                document.querySelector('#qr--bar > .qr--buttons:not(.qrq-hidden-by-plugin)') ||
                document.querySelector('#qr--bar .qr--buttons:not(.qrq-hidden-by-plugin)');
            if (visibleQrHost) return visibleQrHost;

            // 其次：QR 火箭按钮同级
            const rocketButton = document.getElementById('quick-reply-rocket-button');
            if (rocketButton?.parentElement) return rocketButton.parentElement;

            // 最后兜底：发送按钮同级
            const sendButton = document.getElementById('send_but');
            if (sendButton?.parentElement) return sendButton.parentElement;

            return null;
        };

        const getQrAssistantContext = () => {
            const stContext = window.SillyTavern?.getContext?.();
            const qrSettings = stContext?.extensionSettings?.['qr-assistant'];
            return { stContext, qrSettings };
        };

        const applyQrWhitelist = () => {
            if (window.quickReplyMenu?.applyWhitelistDOMChanges) {
                window.quickReplyMenu.applyWhitelistDOMChanges();
            }
        };

        const ensureQrWhitelistInitialized = (qrSettings, stContext) => {
            if (!storage || !qrSettings) return;

            if (!Array.isArray(qrSettings.whitelist)) {
                qrSettings.whitelist = [];
            }

            const initialized = storage.get(qrWhitelistInitKey);
            if (initialized === true || initialized === 'true') {
                return;
            }

            if (!qrSettings.whitelist.includes(qrWhitelistId)) {
                qrSettings.whitelist.push(qrWhitelistId);
                stContext?.saveSettingsDebounced?.();
                applyQrWhitelist();
            }
            storage.set(qrWhitelistInitKey, true);
        };

        const syncQrWhitelistListItem = () => {
            const { qrSettings } = getQrAssistantContext();
            if (!qrSettings) return;

            if (!Array.isArray(qrSettings.whitelist)) {
                qrSettings.whitelist = [];
            }

            const nonList = document.getElementById('qrq-non-whitelisted-list');
            const wlList = document.getElementById('qrq-whitelisted-list');
            if (!nonList || !wlList) return;

            const duplicateItems = document.querySelectorAll(`#${qrWhitelistItemId}`);
            if (duplicateItems.length > 1) {
                duplicateItems.forEach((item, idx) => {
                    if (idx > 0) item.remove();
                });
            }

            let item = document.getElementById(qrWhitelistItemId);
            if (!item) {
                item = document.createElement('div');
                item.id = qrWhitelistItemId;
                item.className = 'qrq-whitelist-item';
                item.innerHTML = '<i class="fa-solid fa-moon" title="JSSlashRunner"></i><span style="flex:1; overflow:hidden; text-overflow:ellipsis;">手机快捷回复</span>';
                item.addEventListener('click', () => {
                    const { stContext: latestContext, qrSettings: latestSettings } = getQrAssistantContext();
                    if (!latestSettings) return;

                    if (!Array.isArray(latestSettings.whitelist)) {
                        latestSettings.whitelist = [];
                    }

                    const idx = latestSettings.whitelist.indexOf(qrWhitelistId);
                    if (idx > -1) {
                        latestSettings.whitelist.splice(idx, 1);
                    } else {
                        latestSettings.whitelist.push(qrWhitelistId);
                    }

                    latestContext?.saveSettingsDebounced?.();
                    applyQrWhitelist();
                    syncQrWhitelistListItem();
                });
            }

            const targetList = qrSettings.whitelist.includes(qrWhitelistId) ? wlList : nonList;
            if (item.parentElement !== targetList) {
                targetList.appendChild(item);
            }
        };

        const syncQrMenuActionItem = (isInlineBtnEnabled, qrSettings) => {
            const actionList = document.getElementById('qr-list-left');
            const existingItem = document.getElementById(qrMenuItemId);
            const isQrAssistantEnabled = !!document.body?.classList?.contains('qra-enabled');
            const inWhitelist = Array.isArray(qrSettings?.whitelist) && qrSettings.whitelist.includes(qrWhitelistId);
            const shouldShowInMenu = isInlineBtnEnabled && isQrAssistantEnabled && !inWhitelist;

            if (!shouldShowInMenu) {
                existingItem?.remove();
                return;
            }

            if (!actionList) return;

            const removeLeftEmptyState = () => {
                const parentColumn = actionList.parentElement;
                const emptyState = parentColumn?.querySelector('.empty-state');
                if (emptyState) emptyState.remove();
                actionList.style.display = 'flex';
            };

            if (existingItem) {
                if (existingItem.parentElement !== actionList) {
                    actionList.prepend(existingItem);
                }
                removeLeftEmptyState();
                return;
            }

            const item = document.createElement('button');
            item.id = qrMenuItemId;
            item.type = 'button';
            item.className = 'action-item';
            item.dataset.label = '手机快捷回复';
            item.dataset.isStandard = 'false';
            item.dataset.setName = '手机插件';
            item.dataset.source = 'RawDomElement';
            item.dataset.domId = btnId;
            item.innerHTML = '<span>手机快捷回复</span>';
            item.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (window.quickReplyMenu?.handleQuickReplyClick) {
                    window.quickReplyMenu.handleQuickReplyClick({ currentTarget: item });
                } else {
                    document.getElementById(btnId)?.click();
                }
            });

            actionList.prepend(item);
            removeLeftEmptyState();
        };

        const inject = () => {
            if (!storage) return;
            const isEnabled = storage.get('phone_inline_reply_btn') !== false;
            const existingBtn = document.getElementById(btnId);
            const existingWrapper =
                document.getElementById(qrScriptContainerId) ||
                document.getElementById(legacyWrapperId) ||
                existingBtn?.closest('.st-phone-inline-reply-wrapper');
            const isQrAssistantEnabled = !!document.body?.classList?.contains('qra-enabled');
            const { stContext, qrSettings } = getQrAssistantContext();

            if (qrSettings) {
                ensureQrWhitelistInitialized(qrSettings, stContext);
                syncQrWhitelistListItem();
            }
            syncQrMenuActionItem(isEnabled, qrSettings);

            // 如果开关关闭，移除按钮
            if (!isEnabled) {
                document.getElementById(qrScriptContainerId)?.remove();
                document.getElementById(legacyWrapperId)?.remove();
                existingWrapper?.remove();
                existingBtn?.remove();
                return;
            }

            const host = getInlineReplyHost();

            // 已存在时做兼容修复：确保在目标容器中，交给 QR 白名单机制控制显示
            if (existingBtn) {
                const currentWrapper =
                    existingBtn.closest(`#${qrScriptContainerId}`) ||
                    existingBtn.closest(`#${legacyWrapperId}`) ||
                    existingBtn.closest('.st-phone-inline-reply-wrapper') ||
                    existingBtn.parentElement;

                if (currentWrapper) {
                    currentWrapper.id = qrScriptContainerId;
                    currentWrapper.classList.add('st-phone-inline-reply-wrapper');
                    // 小铅笔同款：保持在 qr--buttons 容器中，继承酒馆/主题的按钮样式
                    currentWrapper.classList.add('qr--buttons', 'qr--color');
                    currentWrapper.classList.remove('qr--wrapper');
                    currentWrapper.style.setProperty('--qr--color', 'rgba(0,0,0,0)');
                    currentWrapper.dataset.stPhoneInlineReply = 'true';

                    if (!isQrAssistantEnabled) {
                        currentWrapper.classList.remove('qrq-hidden-by-plugin');
                    }

                    if (host && currentWrapper.parentElement !== host) {
                        const rocketButton = document.getElementById('quick-reply-rocket-button');
                        if (rocketButton && rocketButton.parentElement === host) {
                            rocketButton.insertAdjacentElement('afterend', currentWrapper);
                        } else {
                            host.prepend(currentWrapper);
                        }
                    }
                }
                return;
            }

            // 容器不存在则跳过，等待下一轮
            if (!host) return;

            const btn = document.createElement('div');
            btn.id = btnId;
            btn.className = 'remote-ctrl-btn qr--button menu_button interactable';
            btn.title = '快捷回复联系人 (手机插件)';
            btn.innerHTML = '<div class="qr--button-label"><i class="fa-solid fa-mobile-screen-button"></i></div>';

            // 🔥 防抖锁，防止多端触发两次
            let isMenuOpen = false;

            // 🛡️ 核心修复：完全照抄小铅笔，使用 mouseup 和 touchend 绕过酒馆拦截
            const handleAction = async (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (isMenuOpen) return;
                isMenuOpen = true;
                setTimeout(() => { isMenuOpen = false; }, 300); // 300ms 防抖

                try {
                    // 🔥 核心修改：同时提取联系人、群聊、以及系统自动分配的头像映射表
                    let contacts = [];
                    let groups = [];
                    let autoAvatarMap = {}; // 新增映射表变量

                    try {
                        const rawData = storage.get('wechat_data', false);
                        if (rawData) {
                            const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
                            contacts = parsed.contacts || [];
                            groups = (parsed.chats || []).filter(c => c.type === 'group');
                            autoAvatarMap = parsed.contactAutoAvatarMap || {}; // 提取系统分配的头像池映射
                        }
                    } catch (parseErr) {
                        console.error('📱 [手机插件] 解析微信数据失败:', parseErr);
                    }

                    // 🔥 辅助函数：智能解析真实头像（优先找自定义，其次找系统分配池）
                    const resolveAvatar = (id, customAvatar) => {
                        // 1. 如果有用户自定义上传的图片，优先使用
                        if (customAvatar && (customAvatar.startsWith('data:image') || customAvatar.startsWith('http') || customAvatar.startsWith('/'))) {
                            return customAvatar;
                        }
                        // 2. 如果没有自定义，去系统自动分配池里找（通过联系人 ID 匹配）
                        if (id && autoAvatarMap[id]) {
                            return autoAvatarMap[id];
                        }
                        return null; // 啥都没有就返回 null，让后面降级渲染 Emoji
                    };

                    // 组合微信列表
                    const combinedList = [
                        ...contacts.map(c => ({
                            name: c.name,
                            avatar: resolveAvatar(c.id, c.avatar),
                            fallbackIcon: '👤'
                        })),
                        ...groups.map(g => ({
                            name: g.name,
                            avatar: resolveAvatar(g.id, g.avatar),
                            fallbackIcon: '👥'
                        }))
                    ];

                    const mofoData = await getOrCreateMofoData();
                    let mofoItems = (typeof mofoData?.getItems === 'function') ? mofoData.getItems() : [];
                    let activeMofoId = mofoItems[0]?.id || '';

                    // 移除旧菜单
                    const oldMenu = document.getElementById('phone-inline-reply-menu-pop');
                    if (oldMenu) {
                        oldMenu._stPhoneDispose?.();
                        oldMenu.remove();
                    }

                    const menu = document.createElement('div');
                    menu.id = 'phone-inline-reply-menu-pop';

                    const escapeHtml = (text) => {
                        const div = document.createElement('div');
                        div.textContent = String(text ?? '');
                        return div.innerHTML;
                    };

                    const stringifyState = (value) => {
                        if (value === null) return 'null';
                        if (typeof value === 'undefined') return '';
                        if (typeof value === 'object') {
                            try { return JSON.stringify(value); } catch (e) { return '[object]'; }
                        }
                        return String(value);
                    };
                    const sanitizePreviewHtml = (html) => {
                        return String(html || '')
                            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
                            .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
                            .replace(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
                            .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, ' $1="#"');
                    };
                    const normalizeTemplateExprPath = (expr = '') => {
                        return String(expr ?? '')
                            .trim()
                            .replace(/\[(\d+)\]/g, '.$1')
                            .replace(/\[['"]([^'"[\]]+)['"]\]/g, '.$1')
                            .replace(/^\.+|\.+$/g, '');
                    };
                    const resolveTemplateExpr = (stateObj, expr = '') => {
                        const path = normalizeTemplateExprPath(expr);
                        if (!path) return { exists: false, value: '' };
                        const segments = path.split('.').map(seg => seg.trim()).filter(Boolean);
                        if (segments.length === 0) return { exists: false, value: '' };
                        let current = stateObj;
                        for (const seg of segments) {
                            if (current === null || typeof current === 'undefined') {
                                return { exists: false, value: '' };
                            }
                            if (Array.isArray(current)) {
                                if (!/^\d+$/.test(seg)) return { exists: false, value: '' };
                                const index = Number(seg);
                                if (index < 0 || index >= current.length) return { exists: false, value: '' };
                                current = current[index];
                                continue;
                            }
                            if (typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, seg)) {
                                current = current[seg];
                                continue;
                            }
                            return { exists: false, value: '' };
                        }
                        if (typeof current === 'undefined') return { exists: false, value: '' };
                        return { exists: true, value: current };
                    };
                    const extractTemplateExprList = (template = '') => {
                        const text = String(template || '');
                        if (!text) return [];
                        const unique = new Set();
                        const regex = /\{\{\s*([^{}]+?)\s*\}\}/g;
                        let match = regex.exec(text);
                        while (match) {
                            const expr = String(match[1] || '').trim();
                            if (expr) unique.add(expr);
                            match = regex.exec(text);
                        }
                        return Array.from(unique);
                    };
                    const renderMofoTemplatePreview = (template, stateObj = {}) => {
                        const rawTemplate = String(template ?? '').trim();
                        if (!rawTemplate) return { ok: false, html: '' };
                        const safeState = (stateObj && typeof stateObj === 'object' && !Array.isArray(stateObj))
                            ? stateObj
                            : {};
                        const exprList = extractTemplateExprList(rawTemplate);
                        const hasMissingExpr = exprList.some(expr => !resolveTemplateExpr(safeState, expr).exists);
                        if (hasMissingExpr) return { ok: false, html: '' };
                        const rendered = (typeof mofoData?.renderTemplate === 'function')
                            ? mofoData.renderTemplate(rawTemplate, safeState)
                            : rawTemplate;
                        const safeHtml = sanitizePreviewHtml(rendered);
                        if (!String(safeHtml || '').trim()) return { ok: false, html: '' };
                        return { ok: true, html: safeHtml };
                    };
                    const scopeMofoCssText = (cssText = '', scopeSelector = '.mofo-runtime-view') => {
                        const source = String(cssText || '').replace(/<\/style/gi, '<\\/style');
                        if (!source.trim()) return '';
                        return source.replace(/(^|[{}])(\s*[^@{}][^{}]*?)\{/g, (_all, boundary, selectorGroup) => {
                            const scopedSelectors = String(selectorGroup || '')
                                .split(',')
                                .map((part) => {
                                    const selector = String(part || '').trim();
                                    if (!selector) return '';
                                    if (/^(from|to|\d+%)$/i.test(selector)) return selector;
                                    if (/^(html|body|:root)$/i.test(selector)) return scopeSelector;
                                    if (selector.startsWith(scopeSelector)) return selector;
                                    return `${scopeSelector} ${selector}`;
                                })
                                .filter(Boolean);
                            if (scopedSelectors.length === 0) return _all;
                            return `${boundary}${scopedSelectors.join(', ')}{`;
                        });
                    };

                    const buildWechatListHtml = () => {
                        let html = '<div class="inline-reply-section-title">插入回复标签</div>';
                        if (combinedList.length === 0) {
                            html += `
                                <div class="inline-reply-menu-item" id="open-phone-empty-btn" style="color: #ff9800; justify-content: center;">
                                    <span>⚠️</span>
                                    <span>通讯录为空，点击打开手机</span>
                                </div>
                            `;
                            return html;
                        }
                        combinedList.forEach(item => {
                            const avatarHtml = item.avatar
                                ? `<img src="${item.avatar}" class="inline-reply-avatar" alt="${escapeHtml(item.name)}">`
                                : `<span>${item.fallbackIcon}</span>`;
                            html += `
                                <div class="inline-reply-menu-item" data-name="${escapeHtml(item.name)}">
                                    ${avatarHtml}
                                    <span class="inline-reply-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
                                </div>
                            `;
                        });
                        return html;
                    };

                    const getMofoById = (id) => mofoItems.find(item => String(item.id) === String(id)) || null;

                    const buildMofoListHtml = () => {
                        if (!Array.isArray(mofoItems) || mofoItems.length === 0) {
                            return `
                                <div style="font-size:11px; color:#5d78a4; line-height:1.6; border-radius:8px; padding:10px; background:rgba(255,255,255,0.26); border:1px dashed rgba(116,139,184,0.55);">
                                    还没有魔坊条目。点击上方“新建”创建。
                                </div>
                            `;
                        }
                        return mofoItems.map(item => `
                            <div class="mofo-entry" data-mofo-id="${escapeHtml(item.id)}">
                                <div class="mofo-entry-head">
                                    <div class="mofo-entry-name">${escapeHtml(item.name)}</div>
                                    <div style="display:inline-flex; align-items:center; gap:8px;">
                                        <label class="mofo-entry-toggle" title="勾选后为累计追加；取消勾选为替换当前状态">
                                            <input type="checkbox" class="mofo-update-mode-toggle" data-mofo-id="${escapeHtml(item.id)}" ${(item.updateMode || 'append') === 'replace' ? '' : 'checked'}>
                                            <span>累计</span>
                                        </label>
                                        <label class="mofo-entry-toggle" title="启用线下提示词注入">
                                        <input type="checkbox" class="mofo-offline-toggle" data-mofo-id="${escapeHtml(item.id)}" ${item.offlinePromptEnabled === false ? '' : 'checked'}>
                                        <span>线下</span>
                                    </label>
                                    </div>
                                </div>
                                <div style="display:flex; gap:6px; margin-top:6px;">
                                    <button type="button" class="mofo-inline-action-btn" data-mofo-action="edit" data-mofo-id="${escapeHtml(item.id)}" style="flex:1; border:1px solid rgba(116, 139, 184, 0.55); border-radius:8px; background:rgba(255,255,255,0.35); color:#284a76; font-size:11px; padding:6px 8px; cursor:pointer; font-weight:700;">编辑</button>
                                    <button type="button" class="mofo-inline-action-btn" data-mofo-action="clear-session" data-mofo-id="${escapeHtml(item.id)}" style="flex:1; border:1px solid rgba(83, 128, 201, 0.6); border-radius:8px; background:rgba(255,255,255,0.35); color:#2c5da8; font-size:11px; padding:6px 8px; cursor:pointer; font-weight:700;">清理本会话</button>
                                    <button type="button" class="mofo-inline-action-btn" data-mofo-action="delete-global" data-mofo-id="${escapeHtml(item.id)}" style="flex:1; border:1px solid rgba(188, 92, 117, 0.7); border-radius:8px; background:rgba(255,255,255,0.35); color:#a33c57; font-size:11px; padding:6px 8px; cursor:pointer; font-weight:700;">全局删除</button>
                                </div>
                            </div>
                        `).join('');
                    };

                    const buildMofoPageHtml = () => `
                        <div class="inline-reply-section-title">魔坊列表</div>
                        <div class="mofo-toolbar">
                            <button class="mofo-toolbar-btn" id="mofo-create-btn">新建</button>
                            <button class="mofo-toolbar-btn" id="mofo-refresh-btn">刷新</button>
                        </div>
                        <div id="mofo-list-wrap">${buildMofoListHtml()}</div>
                    `;

                    const buildMofoDetailHtml = (current) => {
                        if (!current) {
                            return `
                                <div id="mofo-detail-page">
                                    <div class="inline-reply-section-title" style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
                                        <button type="button" id="mofo-detail-back-btn" style="border:1px solid rgba(116, 139, 184, 0.55); border-radius:7px; background:rgba(255,255,255,0.34); color:#264672; font-size:11px; padding:4px 8px; cursor:pointer;">← 返回</button>
                                        <span>魔坊详情</span>
                                        <span style="width:52px;"></span>
                                    </div>
                                    <div style="font-size:11px; color:#5d78a4; border-radius:10px; padding:10px; border:1px dashed rgba(116,139,184,0.55); background:rgba(255,255,255,0.24);">
                                        条目不存在或已删除。
                                    </div>
                                </div>
                            `;
                        }

                        const safeCss = String(current.cssText || '').replace(/<\/style/gi, '<\\/style');
                        const stateEntries = Object.entries(current.state || {});
                        const rows = stateEntries.length > 0
                            ? stateEntries.map(([k, v]) => `
                                <div class="mofo-kv-row">
                                    <span class="mofo-kv-key">${escapeHtml(k)}</span>
                                    <span class="mofo-kv-val" title="${escapeHtml(stringifyState(v))}">${escapeHtml(stringifyState(v))}</span>
                                </div>
                            `).join('')
                            : '<div style="font-size:11px; color:#5d78a4;">暂无抓取值</div>';

                        return `
                            <style>${safeCss}</style>
                            <div id="mofo-detail-page">
                                <div class="inline-reply-section-title" style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
                                    <button type="button" id="mofo-detail-back-btn" style="border:1px solid rgba(116, 139, 184, 0.55); border-radius:7px; background:rgba(255,255,255,0.34); color:#264672; font-size:11px; padding:4px 8px; cursor:pointer;">← 返回</button>
                                    <span>${escapeHtml(current.name || '魔坊详情')}</span>
                                    <span style="width:52px;"></span>
                                </div>
                                <div class="mofo-preview-wrap">
                                    <div class="mofo-preview-head">
                                        <span class="mofo-preview-title">${escapeHtml(current.name || '未命名')}</span>
                                        <span class="mofo-preview-tag">&lt;${escapeHtml(current.tagName || '')}&gt;</span>
                                    </div>
                                    <div style="font-size:10px; color:${current.offlinePromptEnabled === false ? '#9a6a76' : '#2f6a54'}; margin-bottom:6px;">
                                        线下提示词注入：${current.offlinePromptEnabled === false ? '未启用' : '已启用'}
                                    </div>
                                    <div class="mofo-preview-card">${rows}</div>
                                    <div style="margin-top:7px; font-size:10px; color:#5876a4; line-height:1.5; white-space:pre-wrap; max-height:100px; overflow:auto;">${escapeHtml(current.promptTemplate || '未设置提示词模板')}</div>
                                    <div style="display:flex; gap:6px; margin-top:8px;">
                                        <button type="button" id="mofo-detail-edit-btn" style="flex:1; border:1px solid rgba(116, 139, 184, 0.55); border-radius:8px; background:rgba(255,255,255,0.35); color:#284a76; font-size:11px; padding:6px 8px; cursor:pointer; font-weight:700;">编辑</button>
                                        <button type="button" id="mofo-detail-clear-session-btn" style="flex:1; border:1px solid rgba(83, 128, 201, 0.6); border-radius:8px; background:rgba(255,255,255,0.35); color:#2c5da8; font-size:11px; padding:6px 8px; cursor:pointer; font-weight:700;">清理本会话</button>
                                        <button type="button" id="mofo-detail-delete-global-btn" style="flex:1; border:1px solid rgba(188, 92, 117, 0.7); border-radius:8px; background:rgba(255,255,255,0.35); color:#a33c57; font-size:11px; padding:6px 8px; cursor:pointer; font-weight:700;">全局删除</button>
                                    </div>
                                </div>
                            </div>
                        `;
                    };

                    const buildMofoEditorHtml = (current = null) => {
                        const oldName = String(current?.name || '').trim();
                        const oldTag = String(current?.tagName || current?.name || '').trim();
                        const oldCss = String(current?.cssText || '');
                        const oldHtmlTemplate = String(current?.['html模板'] ?? current?.htmlTemplate ?? current?.templateHtml ?? '');
                        const oldPrompt = String(current?.promptTemplate || '');
                        const oldOfflinePromptEnabled = current?.offlinePromptEnabled !== false;
                        const oldInitial = (() => {
                            try {
                                const source = current?.initialState;
                                if (!source || typeof source !== 'object' || Array.isArray(source)) return '';
                                if (Object.keys(source).length === 0) return '';
                                return JSON.stringify(source, null, 2);
                            } catch (e) { return ''; }
                        })();
                        const title = current ? '编辑魔坊' : '新建魔坊';
                        const saveText = current ? '保存' : '创建';

                        return `
                            <div class="inline-reply-section-title" style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
                                <button type="button" class="mofo-editor-back-btn" style="border:1px solid rgba(116, 139, 184, 0.55); border-radius:7px; background:rgba(255,255,255,0.34); color:#264672; font-size:11px; padding:4px 8px; cursor:pointer;">← 返回</button>
                                <span>${escapeHtml(title)}</span>
                                <span style="width:52px;"></span>
                            </div>
                            <div class="mofo-editor-inline" style="display:grid; gap:7px; min-height:0;">
                                <label style="display:grid; gap:4px;">
                                    <span style="font-size:11px; color:#4d638a; font-weight:600;">名称</span>
                                    <input type="text" id="mofo-editor-name" maxlength="40" value="${escapeHtml(oldName)}" placeholder="输入魔坊名称" style="height:32px; border:1px solid #d7e2f4; border-radius:8px; padding:0 8px; font-size:12px; outline:none; color:#213454; background:#fbfdff;">
                                </label>
                                <label style="display:grid; gap:4px;">
                                    <span style="font-size:11px; color:#4d638a; font-weight:600;">标签</span>
                                    <input type="text" id="mofo-editor-tag" maxlength="40" value="${escapeHtml(oldTag)}" placeholder="对应 <标签></标签>" style="height:32px; border:1px solid #d7e2f4; border-radius:8px; padding:0 8px; font-size:12px; outline:none; color:#213454; background:#fbfdff;">
                                </label>
                                <label style="display:grid; gap:4px;">
                                    <span style="font-size:11px; color:#4d638a; font-weight:600;">CSS</span>
                                    <textarea id="mofo-editor-css" placeholder="输入用于展示卡片的样式（可留空）" style="min-height:60px; border:1px solid #d7e2f4; border-radius:8px; padding:8px; font-size:11px; line-height:1.45; outline:none; resize:vertical; color:#213454; background:#fbfdff;">${escapeHtml(oldCss)}</textarea>
                                </label>
                                <label style="display:grid; gap:4px;">
                                    <span style="font-size:11px; color:#4d638a; font-weight:600;">HTML 模板</span>
                                    <textarea id="mofo-editor-html-template" placeholder="可使用 {{key}} / {{a.b}} 变量；留空则按键值对显示" style="min-height:82px; border:1px solid #d7e2f4; border-radius:8px; padding:8px; font-size:11px; line-height:1.45; outline:none; resize:vertical; color:#213454; background:#fbfdff;">${escapeHtml(oldHtmlTemplate)}</textarea>
                                </label>
                                <label style="display:grid; gap:4px;">
                                    <span style="font-size:11px; color:#4d638a; font-weight:600;">初始值</span>
                                    <textarea id="mofo-editor-initial" placeholder="支持 JSON 或 key:value 多行" style="min-height:60px; border:1px solid #d7e2f4; border-radius:8px; padding:8px; font-size:11px; line-height:1.45; outline:none; resize:vertical; color:#213454; background:#fbfdff;">${escapeHtml(oldInitial)}</textarea>
                                </label>
                                <label style="display:grid; gap:4px;">
                                    <span style="font-size:11px; color:#4d638a; font-weight:600;">提示词模板</span>
                                    <textarea id="mofo-editor-prompt" placeholder="建议约束 AI 只输出对应标签内容" style="min-height:72px; border:1px solid #d7e2f4; border-radius:8px; padding:8px; font-size:11px; line-height:1.45; outline:none; resize:vertical; color:#213454; background:#fbfdff;">${escapeHtml(oldPrompt)}</textarea>
                                </label>
                                <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:#35527f; background:#f6f9ff; border:1px solid #dbe5f7; border-radius:8px; padding:8px 10px;">
                                    <input type="checkbox" id="mofo-editor-offline-enabled" ${oldOfflinePromptEnabled ? 'checked' : ''} style="accent-color:#4f7fd5;">
                                    <span>启用该条目线下提示词注入（{{MOFO_PROMPT}}）</span>
                                </label>
                                <div style="display:flex; gap:6px; padding-top:2px;">
                                    <button type="button" id="mofo-editor-cancel-btn" style="flex:1; border:1px solid rgba(116, 139, 184, 0.55); border-radius:8px; background:rgba(255,255,255,0.34); color:#264672; font-size:11px; padding:7px 8px; cursor:pointer; font-weight:700;">返回</button>
                                    <button type="button" id="mofo-editor-save-btn" style="flex:1; border:1px solid rgba(89, 121, 187, 0.75); border-radius:8px; background:rgba(146, 178, 238, 0.35); color:#1d3f6b; font-size:11px; padding:7px 8px; cursor:pointer; font-weight:700;">${escapeHtml(saveText)}</button>
                                </div>
                            </div>
                        `;
                    };

                    menu.innerHTML = `
                        <div class="inline-reply-tabbar">
                            <button class="inline-reply-tab-btn is-active" data-tab-target="wechat">微信</button>
                            <button class="inline-reply-tab-btn" data-tab-target="mofo">魔坊</button>
                        </div>
                        <div class="inline-reply-page is-active" data-tab-page="wechat">${buildWechatListHtml()}</div>
                        <div class="inline-reply-page" data-tab-page="mofo">
                            <div id="mofo-page-root"></div>
                        </div>
                    `;
                    document.body.appendChild(menu);

                    const positionMenuCentered = () => {
                        const vv = window.visualViewport;
                        const viewWidth = vv?.width || window.innerWidth;
                        const viewHeight = vv?.height || window.innerHeight;
                        const offsetLeft = vv?.offsetLeft || 0;
                        const offsetTop = vv?.offsetTop || 0;

                        menu.style.left = `${offsetLeft + (viewWidth / 2)}px`;
                        menu.style.top = `${offsetTop + (viewHeight / 2)}px`;
                        menu.style.bottom = 'auto';
                        menu.style.transform = 'translate(-50%, -50%)';
                    };

                    const positioningController = new AbortController();
                    const repositionMenu = () => {
                        if (!menu.isConnected) {
                            positioningController.abort();
                            return;
                        }
                        positionMenuCentered();
                    };
                    positionMenuCentered();

                    window.addEventListener('resize', repositionMenu, { passive: true, signal: positioningController.signal });
                    if (window.visualViewport) {
                        window.visualViewport.addEventListener('resize', repositionMenu, { passive: true, signal: positioningController.signal });
                        window.visualViewport.addEventListener('scroll', repositionMenu, { passive: true, signal: positioningController.signal });
                    }

                    let mofoEditorMode = 'list';
                    let mofoEditingId = '';
                    let mofoEditorReturnMode = 'list';

                    const closeMenuSafely = () => {
                        positioningController.abort();
                        if (menu.isConnected) {
                            menu.remove();
                        }
                    };
                    menu._stPhoneDispose = closeMenuSafely;

                    const openMofoStandalonePreview = (itemInput) => {
                        if (!itemInput) return;
                        const item = JSON.parse(JSON.stringify(itemInput));

                        const hostDoc = (() => {
                            let hostWindow = window;
                            try {
                                let probe = window;
                                while (probe.parent && probe.parent !== probe) {
                                    const next = probe.parent;
                                    if (!next.document?.body) break;
                                    probe = next;
                                }
                                hostWindow = probe;
                            } catch (e) {}
                            try {
                                return hostWindow.document || document;
                            } catch (e) {
                                return document;
                            }
                        })();

                        const stringifyValue = (value) => {
                            if (value === null) return 'null';
                            if (typeof value === 'undefined') return '';
                            if (typeof value === 'object') {
                                try { return JSON.stringify(value); } catch (e) { return '[object]'; }
                            }
                            return String(value);
                        };

                        const toScopeToken = (value, fallback = 'item') => {
                            const raw = String(value || '').trim().toLowerCase();
                            const normalized = raw
                                .replace(/[^a-z0-9_-]+/g, '-')
                                .replace(/-+/g, '-')
                                .replace(/^-+|-+$/g, '')
                                .slice(0, 48);
                            if (normalized) return normalized;
                            const fb = String(fallback || '').trim().toLowerCase()
                                .replace(/[^a-z0-9_-]+/g, '-')
                                .replace(/-+/g, '-')
                                .replace(/^-+|-+$/g, '')
                                .slice(0, 48);
                            return fb || 'item';
                        };
                        const scopeToken = toScopeToken(item.tagName || item.name || item.id, item.id || 'item');
                        const scopeSelector = `#mofo-standalone-preview-root[data-mofo-scope="${scopeToken}"] .mofo-runtime-view`;
                        const safeCss = scopeMofoCssText(item.cssText || '', scopeSelector);
                        const htmlTemplate = String(item?.['html模板'] ?? item?.htmlTemplate ?? item?.templateHtml ?? '').trim();
                        const buildStateRowHtml = (key, value) => {
                            return `
                                <div class="mofo-kv-row" data-mofo-key="${escapeHtml(key)}">
                                    <span class="mofo-kv-key">${escapeHtml(key)}</span>
                                    <span class="mofo-kv-val" title="${escapeHtml(stringifyValue(value))}">${escapeHtml(stringifyValue(value))}</span>
                                    <button type="button" class="mofo-delete-trigger" data-mofo-action="delete-key" data-mofo-key="${escapeHtml(key)}" data-mofo-delete-mode="key" aria-label="delete"></button>
                                </div>
                            `;
                        };
                        const buildStateRowsHtml = (stateObj = {}) => {
                            const entries = Object.entries(stateObj || {});
                            if (entries.length === 0) {
                                return '<div class="mofo-runtime-empty">暂无抓取值</div>';
                            }
                            return entries.map(([k, v]) => buildStateRowHtml(k, v)).join('');
                        };
                        const buildRuntimePreviewBodyHtml = (stateObj = {}) => {
                            const normalizedState = (stateObj && typeof stateObj === 'object' && !Array.isArray(stateObj))
                                ? stateObj
                                : {};
                            const renderedTemplate = renderMofoTemplatePreview(htmlTemplate, normalizedState);
                            if (renderedTemplate.ok) {
                                return `<div class="mofo-template-preview">${renderedTemplate.html}</div>`;
                            }
                            return `<div class="mofo-preview-card" id="mofo-preview-card">${buildStateRowsHtml(normalizedState)}</div>`;
                        };
                        const runtimeStateHtml = buildRuntimePreviewBodyHtml(item.state || {});

                        const runtimeBaseStyle = `
                            #mofo-standalone-preview-root{
                                --mofo-overlay-bg:transparent;
                            }
                            #mofo-standalone-preview-root .mofo-runtime-backdrop{position:fixed; inset:0; background:var(--mofo-overlay-bg);}
                            #mofo-standalone-preview-root .mofo-runtime-pop{
                                position:fixed;
                                left:50%;
                                top:50%;
                                transform:translate(-50%, -50%);
                                width:var(--mofo-preview-width, auto);
                                height:var(--mofo-preview-height, auto);
                                min-width:var(--mofo-preview-min-width, 0);
                                max-width:min(94vw, var(--mofo-preview-max-width, 94vw));
                                max-height:calc(100dvh - var(--mofo-preview-safe-margin, 0px));
                                overflow:auto;
                                touch-action:pan-y;
                                overscroll-behavior:contain;
                                box-sizing:border-box;
                            }
                            #mofo-standalone-preview-root .mofo-runtime-view{display:block; box-sizing:border-box;}
                            #mofo-standalone-preview-root .mofo-delete-trigger{
                                display:none;
                                border:0;
                                background:transparent;
                                padding:0;
                            }
                        `;

                        const oldRoot = hostDoc.getElementById('mofo-standalone-preview-root');
                        oldRoot?.remove();

                        const root = hostDoc.createElement('div');
                        root.id = 'mofo-standalone-preview-root';
                        root.style.cssText = [
                            'position:fixed',
                            'inset:0',
                            'z-index:2147483647',
                            'pointer-events:auto',
                            'touch-action:pan-y'
                        ].join(';');
                        root.style.setProperty('position', 'fixed', 'important');
                        root.style.setProperty('inset', '0', 'important');
                        root.style.setProperty('z-index', '2147483647', 'important');
                        root.style.setProperty('pointer-events', 'auto', 'important');
                        root.style.setProperty('isolation', 'isolate', 'important');
                        root.classList.add(`mofo-scope-${scopeToken}`);
                        root.setAttribute('data-mofo-id', String(item.id || ''));
                        root.setAttribute('data-mofo-name', String(item.name || ''));
                        root.setAttribute('data-mofo-tag', String(item.tagName || ''));
                        root.setAttribute('data-mofo-scope', scopeToken);

                        root.innerHTML = `
                            <style>${runtimeBaseStyle}${safeCss}</style>
                            <div id="mofo-standalone-preview-backdrop" class="mofo-runtime-backdrop"></div>
                            <div id="mofo-standalone-preview-pop" class="mofo-runtime-pop">
                                <div class="mofo-runtime-view" data-mofo-id="${escapeHtml(item.id || '')}" data-mofo-name="${escapeHtml(item.name || '')}" data-mofo-tag="${escapeHtml(item.tagName || '')}" data-mofo-scope="${escapeHtml(scopeToken)}">
                                    ${runtimeStateHtml}
                                </div>
                            </div>
                        `;

                        const pop = root.querySelector('#mofo-standalone-preview-pop');
                        const backdrop = root.querySelector('#mofo-standalone-preview-backdrop');
                        const positionController = new AbortController();
                        const positionPop = () => {
                            if (!pop?.isConnected) {
                                positionController.abort();
                                return;
                            }
                            const vv = hostDoc.defaultView?.visualViewport;
                            const viewWidth = vv?.width || hostDoc.defaultView?.innerWidth || window.innerWidth;
                            const viewHeight = vv?.height || hostDoc.defaultView?.innerHeight || window.innerHeight;
                            const offsetLeft = vv?.offsetLeft || 0;
                            const offsetTop = vv?.offsetTop || 0;
                            const rootStyle = hostDoc.defaultView?.getComputedStyle(root);
                            const safeMargin = Math.max(0, Number.parseFloat(rootStyle?.getPropertyValue('--mofo-preview-safe-margin')) || 10);
                            const fitMinWidth = Math.max(0, Number.parseFloat(rootStyle?.getPropertyValue('--mofo-fit-min-width')) || 160);
                            const fitMinHeight = Math.max(0, Number.parseFloat(rootStyle?.getPropertyValue('--mofo-fit-min-height')) || 160);
                            pop.style.maxWidth = `${Math.max(fitMinWidth, viewWidth - (safeMargin * 2))}px`;
                            pop.style.maxHeight = `${Math.max(fitMinHeight, viewHeight - (safeMargin * 2))}px`;
                            pop.style.left = `${offsetLeft + (viewWidth / 2)}px`;
                            pop.style.top = `${offsetTop + (viewHeight / 2)}px`;
                            pop.style.transform = 'translate(-50%, -50%)';

                            const rect = pop.getBoundingClientRect();
                            if (rect.height > (viewHeight - (safeMargin * 2))) {
                                pop.style.top = `${offsetTop + safeMargin}px`;
                                pop.style.transform = 'translate(-50%, 0)';
                            }
                        };

                        const onEsc = (e) => {
                            if (e.key === 'Escape') {
                                e.preventDefault();
                                close();
                            }
                        };
                        hostDoc.defaultView?.addEventListener('resize', positionPop, { passive: true, signal: positionController.signal });
                        hostDoc.defaultView?.addEventListener('keydown', onEsc, { signal: positionController.signal });
                        if (hostDoc.defaultView?.visualViewport) {
                            hostDoc.defaultView.visualViewport.addEventListener('resize', positionPop, { passive: true, signal: positionController.signal });
                            hostDoc.defaultView.visualViewport.addEventListener('scroll', positionPop, { passive: true, signal: positionController.signal });
                        }

                        const close = () => {
                            positionController.abort();
                            root.remove();
                        };
                        const shouldCloseOnOutside = () => {
                            try {
                                const raw = String(hostDoc.defaultView?.getComputedStyle(root)?.getPropertyValue('--mofo-close-on-outside') || '')
                                    .trim()
                                    .toLowerCase();
                                if (!raw) return true;
                                return !['0', 'false', 'off', 'no', 'disabled'].includes(raw);
                            } catch (e) {
                                return true;
                            }
                        };
                        const closeByOutside = (e) => {
                            if (!shouldCloseOnOutside()) return;
                            const target = e?.target;
                            if (!target) return;
                            if (target === root || target === backdrop || target === pop || !pop?.contains(target)) {
                                close();
                            }
                        };
                        const closeByDocOutside = (e) => {
                            if (!shouldCloseOnOutside()) return;
                            const target = e?.target;
                            if (!target) return;
                            if (pop?.contains(target)) return;
                            close();
                        };
                        const persistMofoState = (nextState) => {
                            const normalizedState = (nextState && typeof nextState === 'object' && !Array.isArray(nextState))
                                ? JSON.parse(JSON.stringify(nextState))
                                : {};
                            item.state = normalizedState;
                            if (item.id && mofoData?.updateItem) {
                                mofoData.updateItem(item.id, { state: normalizedState });
                            }
                        };
                        const rerenderRuntimeView = () => {
                            const view = root.querySelector('.mofo-runtime-view');
                            if (!view) return;
                            view.innerHTML = buildRuntimePreviewBodyHtml(item.state || {});
                        };
                        root.addEventListener('click', (e) => {
                            const trigger = e.target?.closest?.('[data-mofo-action]');
                            if (!trigger) return;
                            const action = String(trigger.getAttribute('data-mofo-action') || '').trim();
                            if (action !== 'delete-key') return;
                            e.stopPropagation();
                            e.preventDefault();
                            const rowHost = trigger.closest?.('[data-mofo-key]');
                            const key = String(
                                trigger.getAttribute('data-mofo-key')
                                || trigger.getAttribute('data-mofo-target-key')
                                || rowHost?.getAttribute?.('data-mofo-key')
                                || ''
                            ).trim();
                            if (!key) return;
                            const currentState = (item.state && typeof item.state === 'object' && !Array.isArray(item.state))
                                ? JSON.parse(JSON.stringify(item.state))
                                : {};
                            if (!Object.prototype.hasOwnProperty.call(currentState, key)) return;
                            const deleteMode = String(trigger.getAttribute('data-mofo-delete-mode') || 'auto').trim().toLowerCase();
                            const explicitGroup = String(
                                trigger.getAttribute('data-mofo-group')
                                || trigger.getAttribute('data-mofo-prefix')
                                || ''
                            ).trim();
                            const groupToken = explicitGroup;
                            const shouldDeleteGroup = (
                                deleteMode === 'group'
                                || (deleteMode === 'auto' && !!explicitGroup)
                            );

                            if (shouldDeleteGroup) {
                                const prefixes = [];
                                if (groupToken) {
                                    prefixes.push(`${groupToken}_`, groupToken);
                                } else {
                                    prefixes.push(key);
                                }
                                Object.keys(currentState).forEach((stateKey) => {
                                    if (prefixes.some(prefix => stateKey === prefix || stateKey.startsWith(prefix))) {
                                        delete currentState[stateKey];
                                    }
                                });
                            } else {
                                delete currentState[key];
                            }
                            persistMofoState(currentState);
                            rerenderRuntimeView();
                        });
                        root.addEventListener('pointerdown', closeByOutside, true);
                        root.addEventListener('mousedown', closeByOutside, true);
                        root.addEventListener('touchstart', closeByOutside, { passive: true, capture: true });
                        backdrop?.addEventListener('click', closeByOutside);
                        hostDoc.addEventListener('pointerdown', closeByDocOutside, { capture: true, signal: positionController.signal });
                        hostDoc.addEventListener('mousedown', closeByDocOutside, { capture: true, signal: positionController.signal });
                        hostDoc.addEventListener('touchstart', closeByDocOutside, { passive: true, capture: true, signal: positionController.signal });
                        (hostDoc.body || hostDoc.documentElement).appendChild(root);
                        positionPop();
                    };

                    const getEditingMofo = () => mofoItems.find(item => String(item.id) === String(mofoEditingId)) || null;
                    const closeMofoEditor = () => {
                        mofoEditorMode = 'list';
                        mofoEditingId = '';
                        mofoEditorReturnMode = 'list';
                    };

                    const readMofoEditorDraft = () => {
                        const nameInput = menu.querySelector('#mofo-editor-name');
                        const tagInput = menu.querySelector('#mofo-editor-tag');
                        const cssInput = menu.querySelector('#mofo-editor-css');
                        const htmlTemplateInput = menu.querySelector('#mofo-editor-html-template');
                        const initialInput = menu.querySelector('#mofo-editor-initial');
                        const promptInput = menu.querySelector('#mofo-editor-prompt');
                        const offlineEnabledInput = menu.querySelector('#mofo-editor-offline-enabled');

                        return {
                            name: String(nameInput?.value || '').trim(),
                            tagName: String(tagInput?.value || '').trim(),
                            cssText: String(cssInput?.value || ''),
                            htmlTemplate: String(htmlTemplateInput?.value || ''),
                            initialStateRaw: String(initialInput?.value || ''),
                            promptTemplate: String(promptInput?.value || ''),
                            offlinePromptEnabled: !!offlineEnabledInput?.checked
                        };
                    };
                    const getCanonicalJson = (value) => {
                        try {
                            return JSON.stringify(value ?? {});
                        } catch (e) {
                            return '';
                        }
                    };
                    const parseInitialDraftToState = (rawText = '') => {
                        const text = String(rawText ?? '');
                        try {
                            if (typeof mofoData?._parseStatePayload === 'function') {
                                const parsed = mofoData._parseStatePayload(text, {});
                                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
                                return {};
                            }
                        } catch (e) {}
                        const trimmed = text.trim();
                        if (!trimmed) return {};
                        try {
                            const parsed = JSON.parse(trimmed);
                            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
                        } catch (e) {}
                        return {};
                    };
                    const isInitialDraftChanged = (currentItem, draft) => {
                        if (!currentItem || !draft || !Object.prototype.hasOwnProperty.call(draft, 'initialStateRaw')) {
                            return false;
                        }
                        const currentInitial = (currentItem.initialState && typeof currentItem.initialState === 'object' && !Array.isArray(currentItem.initialState))
                            ? currentItem.initialState
                            : {};
                        const nextInitial = parseInitialDraftToState(draft.initialStateRaw);
                        return getCanonicalJson(currentInitial) !== getCanonicalJson(nextInitial);
                    };
                    const isHtmlTemplateDraftChanged = (currentItem, draft) => {
                        if (!currentItem || !draft || !Object.prototype.hasOwnProperty.call(draft, 'htmlTemplate')) {
                            return false;
                        }
                        const currentTemplate = String(currentItem['html模板'] ?? currentItem.htmlTemplate ?? currentItem.templateHtml ?? '');
                        return currentTemplate !== String(draft.htmlTemplate ?? '');
                    };

                    const focusMofoEditorName = () => {
                        const nameInput = menu.querySelector('#mofo-editor-name');
                        if (!nameInput) return;
                        nameInput.focus();
                        nameInput.setSelectionRange?.(nameInput.value.length, nameInput.value.length);
                    };

                    const renderMofoPane = () => {
                        const mofoPageRoot = menu.querySelector('#mofo-page-root');
                        if (!mofoPageRoot) return;

                        if (mofoEditorMode === 'create') {
                            mofoPageRoot.innerHTML = buildMofoEditorHtml(null);
                        } else if (mofoEditorMode === 'detail') {
                            const current = getEditingMofo();
                            if (!current) {
                                closeMofoEditor();
                                mofoPageRoot.innerHTML = buildMofoPageHtml();
                            } else {
                                mofoPageRoot.innerHTML = buildMofoDetailHtml(current);
                            }
                        } else if (mofoEditorMode === 'edit') {
                            const current = getEditingMofo();
                            if (!current) {
                                closeMofoEditor();
                                mofoPageRoot.innerHTML = buildMofoPageHtml();
                            } else {
                                mofoPageRoot.innerHTML = buildMofoEditorHtml(current);
                            }
                        } else {
                            mofoPageRoot.innerHTML = buildMofoPageHtml();
                        }

                        bindMofoEvents();
                        positionMenuCentered();
                    };

                    const rerenderMofoPane = ({ keepEditor = true } = {}) => {
                        mofoItems = (typeof mofoData?.getItems === 'function') ? mofoData.getItems() : [];
                        if (mofoItems.length === 0) activeMofoId = '';
                        if (!keepEditor) {
                            closeMofoEditor();
                        } else if ((mofoEditorMode === 'edit' || mofoEditorMode === 'detail') && !getEditingMofo()) {
                            closeMofoEditor();
                        }
                        renderMofoPane();
                    };

                    const bindWechatEvents = () => {
                        const emptyBtn = menu.querySelector('#open-phone-empty-btn');
                        emptyBtn?.addEventListener('click', (ev) => {
                            ev.stopPropagation();
                            ev.preventDefault();
                            closeMenuSafely();
                            const phoneIcon = document.getElementById('phoneDrawerIcon');
                            if (phoneIcon) {
                                phoneIcon.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                            }
                        });

                        menu.querySelectorAll('.inline-reply-menu-item[data-name]').forEach(el => {
                            el.addEventListener('click', (ev) => {
                                ev.stopPropagation();
                                ev.preventDefault();
                                const name = String(el.dataset.name || '').trim();
                                if (!name) return;
                                const tagStr = `\n<回复${name}>\n\n</回复${name}>\n`;
                                const cursorPos = `\n<回复${name}>\n`.length;
                                insertTextToSendTextarea(tagStr, cursorPos);
                                closeMenuSafely();
                            });
                        });
                    };

                    const bindMofoEvents = () => {
                        if (menu.querySelector('#mofo-detail-page')) {
                            menu.querySelector('#mofo-detail-back-btn')?.addEventListener('click', (e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                mofoEditorMode = 'list';
                                mofoEditingId = '';
                                mofoEditorReturnMode = 'list';
                                renderMofoPane();
                            });
                            menu.querySelector('#mofo-detail-edit-btn')?.addEventListener('click', (e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                if (!mofoEditingId) return;
                                mofoEditorMode = 'edit';
                                mofoEditorReturnMode = 'detail';
                                renderMofoPane();
                            });
                            menu.querySelector('#mofo-detail-clear-session-btn')?.addEventListener('click', (e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                const current = getEditingMofo();
                                if (!current) return;
                                const ok = confirm(`清理魔坊「${current.name}」在当前会话的数据？\n条目会保留。`);
                                if (!ok) return;
                                mofoData.clearItemSessionData(current.id);
                                rerenderMofoPane({ keepEditor: true });
                            });
                            menu.querySelector('#mofo-detail-delete-global-btn')?.addEventListener('click', (e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                const current = getEditingMofo();
                                if (!current) return;
                                const ok = confirm(`全局删除魔坊「${current.name}」？\n会删除条目定义，并清理各会话里的对应运行态数据。`);
                                if (!ok) return;
                                mofoData.removeItem(current.id);
                                rerenderMofoPane({ keepEditor: false });
                            });
                            return;
                        }

                        if (menu.querySelector('.mofo-editor-inline')) {
                            const backToPrev = (ev) => {
                                ev?.stopPropagation?.();
                                ev?.preventDefault?.();
                                if (mofoEditorReturnMode === 'detail' && getEditingMofo()) {
                                    mofoEditorMode = 'detail';
                                } else {
                                    mofoEditorMode = 'list';
                                    mofoEditingId = '';
                                }
                                mofoEditorReturnMode = 'list';
                                renderMofoPane();
                            };

                            menu.querySelector('.mofo-editor-back-btn')?.addEventListener('click', backToPrev);
                            menu.querySelector('#mofo-editor-cancel-btn')?.addEventListener('click', backToPrev);
                            menu.querySelector('#mofo-editor-save-btn')?.addEventListener('click', () => {
                                const draft = readMofoEditorDraft();
                                if (!draft.name) {
                                    alert('名称不能为空');
                                    return;
                                }
                                try {
                                    if (mofoEditorMode === 'edit') {
                                        const targetId = String(mofoEditingId || '').trim();
                                        if (!targetId) return;
                                        const currentItem = getEditingMofo();
                                        if (!isInitialDraftChanged(currentItem, draft)) {
                                            delete draft.initialStateRaw;
                                        }
                                        if (!isHtmlTemplateDraftChanged(currentItem, draft)) {
                                            delete draft.htmlTemplate;
                                        }
                                        mofoData.updateItem(targetId, draft);
                                        activeMofoId = targetId;
                                        mofoEditorMode = mofoEditorReturnMode === 'detail' ? 'detail' : 'list';
                                        mofoEditorReturnMode = 'list';
                                    } else {
                                        const created = mofoData.createItem(draft);
                                        activeMofoId = created?.id || activeMofoId;
                                        mofoEditorMode = 'list';
                                        mofoEditingId = '';
                                        mofoEditorReturnMode = 'list';
                                    }
                                    rerenderMofoPane({ keepEditor: true });
                                } catch (err) {
                                    alert(err?.message || '保存失败');
                                }
                            });
                            focusMofoEditorName();
                            return;
                        }

                        menu.querySelectorAll('.mofo-entry[data-mofo-id]').forEach(entry => {
                            entry.addEventListener('click', () => {
                                const id = String(entry.getAttribute('data-mofo-id') || '').trim();
                                if (!id) return;
                                const current = getMofoById(id);
                                if (!current) return;
                                closeMenuSafely();
                                openMofoStandalonePreview(current);
                            });
                        });
                        menu.querySelectorAll('.mofo-offline-toggle[data-mofo-id]').forEach(input => {
                            input.addEventListener('click', (e) => e.stopPropagation());
                            input.addEventListener('change', (e) => {
                                e.stopPropagation();
                                const id = String(input.getAttribute('data-mofo-id') || '').trim();
                                if (!id) return;
                                mofoData.updateItem(id, { offlinePromptEnabled: !!input.checked });
                                rerenderMofoPane();
                            });
                        });
                        menu.querySelectorAll('.mofo-update-mode-toggle[data-mofo-id]').forEach(input => {
                            input.addEventListener('click', (e) => e.stopPropagation());
                            input.addEventListener('change', (e) => {
                                e.stopPropagation();
                                const id = String(input.getAttribute('data-mofo-id') || '').trim();
                                if (!id) return;
                                mofoData.updateItem(id, { updateMode: input.checked ? 'append' : 'replace' });
                                rerenderMofoPane();
                            });
                        });
                        menu.querySelectorAll('.mofo-entry-toggle').forEach(label => {
                            label.addEventListener('click', (e) => e.stopPropagation());
                        });

                        menu.querySelector('#mofo-refresh-btn')?.addEventListener('click', () => {
                            rerenderMofoPane();
                        });

                        menu.querySelector('#mofo-create-btn')?.addEventListener('click', () => {
                            mofoEditorMode = 'create';
                            mofoEditingId = '';
                            mofoEditorReturnMode = 'list';
                            renderMofoPane();
                        });
                        menu.querySelectorAll('.mofo-inline-action-btn[data-mofo-action][data-mofo-id]').forEach(btn => {
                            btn.addEventListener('click', (e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                const action = String(btn.getAttribute('data-mofo-action') || '').trim();
                                const id = String(btn.getAttribute('data-mofo-id') || '').trim();
                                if (!action || !id) return;

                                const current = getMofoById(id);
                                if (!current) return;
                                activeMofoId = id;

                                if (action === 'edit') {
                                    mofoEditorMode = 'edit';
                                    mofoEditingId = id;
                                    mofoEditorReturnMode = 'list';
                                    renderMofoPane();
                                    return;
                                }

                                if (action === 'clear-session') {
                                    const ok = confirm(`清理魔坊「${current.name}」在当前会话的数据？\n条目会保留。`);
                                    if (!ok) return;
                                    mofoData.clearItemSessionData(id);
                                    rerenderMofoPane();
                                    return;
                                }

                                if (action === 'delete-global' || action === 'delete') {
                                    const ok = confirm(`全局删除魔坊「${current.name}」？\n会删除条目定义，并清理各会话里的对应运行态数据。`);
                                    if (!ok) return;
                                    mofoData.removeItem(id);
                                    rerenderMofoPane();
                                    return;
                                }

                            });
                        });
                    };

                    const switchTab = (tabName = 'wechat') => {
                        menu.querySelectorAll('.inline-reply-tab-btn[data-tab-target]').forEach(btn => {
                            btn.classList.toggle('is-active', btn.dataset.tabTarget === tabName);
                        });
                        menu.querySelectorAll('.inline-reply-page[data-tab-page]').forEach(page => {
                            page.classList.toggle('is-active', page.dataset.tabPage === tabName);
                        });
                        positionMenuCentered();
                    };

                    menu.querySelectorAll('.inline-reply-tab-btn[data-tab-target]').forEach(btn => {
                        btn.addEventListener('click', (ev) => {
                            ev.stopPropagation();
                            ev.preventDefault();
                            switchTab(String(btn.dataset.tabTarget || 'wechat'));
                        });
                    });

                    bindWechatEvents();
                    rerenderMofoPane({ keepEditor: false });
                    switchTab('wechat');

                    // 🔥 核心修复3：解决移动端 300ms 点击延迟导致的“幽灵秒关”问题
                    setTimeout(() => {
                        const closeMenu = (ev) => {
                            if (!menu.contains(ev.target)) {
                                closeMenuSafely();
                                document.removeEventListener('mousedown', closeMenu);
                                document.removeEventListener('touchstart', closeMenu);
                            }
                        };
                        document.addEventListener('mousedown', closeMenu);
                        document.addEventListener('touchstart', closeMenu, { passive: true });
                    }, 50);

                } catch (e) {
                    console.error('📱 [手机插件] 快捷回复执行异常:', e);
                }
            };

            // 🔥 核心修复1：酒馆底栏有滑动拦截，统一使用 click，并阻止 touchstart 被滑动组件劫持
            btn.addEventListener('click', handleAction);
            btn.addEventListener('touchstart', (e) => {
                e.stopPropagation(); // 阻止事件冒泡给酒馆的横向滑动条
            }, { passive: false });

            let wrapper = document.createElement('div');
            wrapper.id = qrScriptContainerId;
            wrapper.className = 'st-phone-inline-reply-wrapper qr--buttons qr--color';
            wrapper.dataset.stPhoneInlineReply = 'true';
            if (!isQrAssistantEnabled) {
                wrapper.classList.remove('qrq-hidden-by-plugin');
            }
            wrapper.style.setProperty('--qr--color', 'rgba(0,0,0,0)');
            wrapper.appendChild(btn);

            const rocketButton = document.getElementById('quick-reply-rocket-button');
            if (rocketButton && rocketButton.parentElement === host) {
                rocketButton.insertAdjacentElement('afterend', wrapper);
            } else {
                host.prepend(wrapper); // 插入到可见容器最左侧
            }
        };

        setInterval(inject, 1000);
        inject();
    }

    // 创建顶部面板按钮
    function createTopPanel() {
        const extensionsMenu = document.getElementById('extensionsMenu');
        const topSettingsHolder = document.getElementById('top-settings-holder');
        const toolPanelHost = extensionsMenu || topSettingsHolder;
        if (!toolPanelHost) {
            console.error('❌ 找不到手机入口挂载点');
            return;
        }

        const oldPanel = document.getElementById('phone-panel-holder');
        if (oldPanel) oldPanel.remove();
        const oldTrigger = document.getElementById('phoneDrawerToolEntry');
        if (oldTrigger) oldTrigger.remove();

        const isEnabled = settings?.enabled ?? true;
        const iconStyle = isEnabled ? '' : 'opacity: 0.4; filter: grayscale(1);';
        const statusText = isEnabled ? '已启用' : '已禁用';

        const triggerHTML = extensionsMenu ? `
            <div id="phoneDrawerToolEntry" class="extension_container interactable" tabindex="0">
                <div id="phoneDrawerToolRow" class="list-group-item flex-container flexGap5 interactable"
                     tabindex="0"
                     role="listitem"
                     title="柚月の手机 (${statusText})">
                    <div id="phoneDrawerIcon" class="fa-fw fa-solid fa-mobile-screen-button extensionsMenuExtensionButton"
                         style="position:relative; ${iconStyle}"
                         tabindex="0"
                         role="button">
                        <span id="phone-badge" class="badge-notification" style="display:none; position:absolute; top:-4px; right:-6px;">0</span>
                    </div>
                    <span>柚月の手机</span>
                </div>
            </div>
        ` : `
            <div id="phoneDrawerToolEntry" class="extension_container interactable" tabindex="0" role="button"
                 title="柚月の手机 (${statusText})"
                 style="position:relative; display:flex; align-items:center; justify-content:center; min-width:38px; min-height:38px;">
                <div id="phoneDrawerIcon" class="fa-fw fa-solid fa-mobile-screen-button"
                     style="position:relative; display:flex; align-items:center; justify-content:center; width:100%; height:100%; ${iconStyle}"
                     tabindex="0"
                     role="button">
                    <span id="phone-badge" class="badge-notification" style="display:none; position:absolute; top:1px; right:1px;">0</span>
                </div>
            </div>
        `;

        // 🔥 面板本体单独挂到根层，避免工具面板 transform 影响 fixed 抽屉定位
        const panelHTML = `
            <div id="phone-panel-holder" class="drawer" style="background:transparent!important; box-shadow:none!important; backdrop-filter:none!important; -webkit-backdrop-filter:none!important; border:none!important;">
                <div id="phone-panel" class="phone-panel-hidden" style="display:none !important; visibility:hidden !important; opacity:0 !important; pointer-events:none !important; position:absolute !important; width:0 !important; height:0 !important; overflow:hidden !important;">
                    <div id="phone-panel-header" class="fa-solid fa-grip drag-grabber" style="display:none !important;"></div>
                    <div id="phone-panel-content">
                    </div>
                </div>
            </div>
        `;

        toolPanelHost.insertAdjacentHTML('afterbegin', triggerHTML);
        (document.body || topSettingsHolder).insertAdjacentHTML('beforeend', panelHTML);

        const drawerEntry = document.getElementById('phoneDrawerToolEntry');
        const drawerIcon = document.getElementById('phoneDrawerIcon');
        const drawerPanel = document.getElementById('phone-panel');
        const triggerTarget = drawerEntry || drawerIcon;

        // 🔥 新增：长按控制全局主开关逻辑
        if (triggerTarget && drawerIcon && drawerPanel) {
            let pressTimer;
            let isLongPress = false;

            const startPress = (e) => {
                isLongPress = false;
                // 800毫秒判定为长按
                pressTimer = setTimeout(async () => {
                    isLongPress = true;
                    settings = getRuntimeSettings() || { enabled: true };
                    // 切换全局主开关
                    settings.enabled = !settings.enabled;
                    await storage.saveSettings(settings);

                    // 视觉反馈：图标变灰/点亮
                    drawerIcon.style.cssText = settings.enabled ? '' : 'opacity: 0.4; filter: grayscale(1);';
                    drawerIcon.title = settings.enabled ? '柚月の手机 (已启用)' : '柚月の手机 (已休眠)';

                    // 手机震动反馈
                    if (navigator.vibrate) navigator.vibrate(50);

                    // 弹窗提示（统一为手机通知样式）
                    if (settings.enabled) {
                        showUnifiedPhoneNotification('系统提示', '手机已启用 (短按打开)', '✅');
                    } else {
                        showUnifiedPhoneNotification('系统提示', '手机已休眠 (不发提示词，保留音乐功能)', '⚠️');
                    }

                    // 如果手机正开着，强制关闭它
                    if (!settings.enabled && drawerPanel.classList.contains('phone-panel-open')) {
                        toggleDrawer(drawerIcon, drawerPanel);
                    }
                }, 800);
            };

            const endPress = (e) => {
                clearTimeout(pressTimer);
                // 如果是短按，且是鼠标抬起或手指抬起事件
                if (!isLongPress && (e.type === 'mouseup' || e.type === 'touchend')) {
                    e.preventDefault();
                    if (isPhoneFeatureEnabled()) {
                        if (!drawerPanel.classList.contains('phone-panel-open') && !checkBetaLock()) return;
                        toggleDrawer(drawerIcon, drawerPanel);
                    } else {
                        showUnifiedPhoneNotification('提示', '手机已休眠，请长按图标开启', '⚠️');
                    }
                }
            };

            const cancelPress = () => clearTimeout(pressTimer);

            const onKeyDown = (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                if (isPhoneFeatureEnabled()) {
                    if (!drawerPanel.classList.contains('phone-panel-open') && !checkBetaLock()) return;
                    toggleDrawer(drawerIcon, drawerPanel);
                } else {
                    showUnifiedPhoneNotification('提示', '手机已休眠，请长按图标开启', '⚠️');
                }
            };

            // 绑定鼠标和触摸事件
            triggerTarget.addEventListener('mousedown', startPress);
            triggerTarget.addEventListener('touchstart', startPress, { passive: true });
            triggerTarget.addEventListener('mouseup', endPress);
            triggerTarget.addEventListener('mouseleave', cancelPress);
            triggerTarget.addEventListener('touchend', endPress);
            triggerTarget.addEventListener('touchcancel', cancelPress);
            triggerTarget.addEventListener('contextmenu', (e) => e.preventDefault()); // 禁用右键防止弹菜单
            triggerTarget.addEventListener('keydown', onKeyDown);
        }
    }

    // 切换抽屉
    function toggleDrawer(icon, panel) {
        const isOpen = panel.classList.contains('phone-panel-open');

        if (isOpen) {
            // 关闭
            panel.classList.remove('phone-panel-open');
            panel.classList.remove('phone-keyboard-open');
            panel.classList.add('phone-panel-hidden');
            // 🔥 关闭时添加强力隐藏样式
            panel.style.cssText = 'display:none !important; visibility:hidden !important; opacity:0 !important; pointer-events:none !important; position:absolute !important; width:0 !important; height:0 !important; overflow:hidden !important;';
        } else {
            // 打开
            openPhonePanelWithOutsideClose(panel, icon);

            // 只在第一次打开时创建手机界面
            const content = document.getElementById('phone-panel-content');
            if (content && !content.querySelector('.phone-in-panel')) {
                // 🔥 先加载 UI 模块，再创建手机
                createPhoneInPanel();
            }

            // 🔥 展开手机时，如果刚好停留在微信某聊天界面，立刻刷新消除红点
            if (currentApp === 'wechat' && window.VirtualPhone?.wechatApp) {
                setTimeout(() => window.VirtualPhone.wechatApp.render(), 50);
            }
        }
    }

    function openPhonePanelWithOutsideClose(panel, icon) {
        if (!panel || !icon) return;

        updatePhonePanelViewportHeight({ force: true });
        panel.classList.add('phone-panel-open');
        panel.classList.remove('phone-panel-hidden');
        panel.style.cssText = '';
        panel.classList.add('drawer-content', 'fillRight', 'openDrawer');
        schedulePhonePanelViewportUpdate();

        // 自动唤起来电/转线上时也必须补上外部点击关闭监听
        panel.removeEventListener('click', handlePanelClick);
        panel.addEventListener('click', handlePanelClick);
    }

    // 🔥 处理面板点击事件：点击手机外部关闭手机
    function handlePanelClick(e) {
        // 【核心修复】：使用 e.composedPath() 获取真实点击路径。
        // 防止微信局部刷新导致旧 DOM 被销毁时被误判为“点击了外部”
        const path = e.composedPath();
        const clickedInsidePhone = path.some(el =>
            el.classList && (el.classList.contains('phone-in-panel') || el.classList.contains('phone-body-panel'))
        );

        // 如果点击的是手机本体内部，不关闭
        if (clickedInsidePhone) {
            return;
        }

        // 点击外部，关闭手机
        const drawerIcon = document.getElementById('phoneDrawerIcon');
        const drawerPanel = document.getElementById('phone-panel');
        if (drawerIcon && drawerPanel) {
            drawerPanel.removeEventListener('click', handlePanelClick);
            toggleDrawer(drawerIcon, drawerPanel);
        }
    }

    // 🔥 在面板中创建手机（按需加载 UI 模块）
    async function createPhoneInPanel() {
        const container = document.getElementById('phone-panel-content');
        if (!container) return;

        // 🔥 显示加载提示
        container.innerHTML = '<div style="color:#999;text-align:center;padding:50px;">加载中...</div>';

        // 🔥 按需加载 UI 模块 + TimeManager + PromptManager（并行加载）
        await Promise.all([
            loadUIModules(),
            loadTimeManager(),
            loadPromptManager()
        ]);

        container.innerHTML = '';

        phoneShell = new PhoneShell();
        phoneShell.createInPanel(container);

        // 🔥 关键修改：在这里立即赋值
        homeScreen = new HomeScreen(phoneShell, currentApps);
        if (!window.VirtualPhone) window.VirtualPhone = {};
        window.VirtualPhone.home = homeScreen; // 确保全局对象能立即访问到 homeScreen

        // 🔥 确保 imageManager 在渲染前已创建
        if (!window.VirtualPhone.imageManager) {
            window.VirtualPhone.imageManager = new ImageUploadManager(storage);
        }

        homeScreen.render();
    }

    // 更新通知红点
    function updateNotificationBadge(count) {
        totalNotifications = count;
        const badge = document.getElementById('phone-badge');
        if (!badge) return;

        if (count > 0 && isPhoneFeatureEnabled()) {
            badge.style.display = 'block';
            badge.textContent = count > 99 ? '99+' : count;
        } else {
            badge.style.display = 'none';
        }
    }

    // 🎵 解析 <Music> 卡片内容 (增强防呆版)
    function parseMusicCard(content) {
        const safe = String(content || '').replace(/｜/g, '|');

        const get = (tag) => {
            // 🔥 使用全局匹配 /gi，兼容字段名两侧空格
            const regex = new RegExp(`\\[\\s*${tag}\\s*\\|([^\\]]+)\\]`, 'gi');
            const matches = [...safe.matchAll(regex)];
            if (matches.length === 0) return [];

            const results = [];
            matches.forEach(m => {
                const parts = String(m[1] || '').split('|').map(s => s.trim());
                results.push(...parts);
            });
            return results;
        };

        const getReplies = () => {
            const regex = /\[\s*Replies\s*\|([^\]]+)\]/gi;
            const matches = [...safe.matchAll(regex)];
            if (matches.length === 0) return [];

            const normalized = [];
            for (const m of matches) {
                const raw = String(m[1] || '').trim();
                if (!raw) continue;

                // 支持这两种写法：
                // 1) name|@handle|text|name|@handle|text
                // 2) name|@handle|text；name|@handle|text
                const chunks = raw
                    .split(/[；;](?=[^|;\n\r]+\|@?[^|;\n\r]+\|)/g)
                    .map(s => s.trim())
                    .filter(Boolean);

                chunks.forEach(chunk => {
                    const parts = chunk.split('|').map(s => s.trim());
                    // 直接将分割后的扁平数组推入，交给 music-view.js 的 triplets 标准解析
                    if (parts.length > 0) {
                        normalized.push(...parts);
                    }
                });
            }
            return normalized;
        };

        return {
            char: get('Char'),
            meta: get('Meta'),
            stats: get('Stats'),
            thought: get('Thought'),
            modules: get('Modules'),
            replies: getReplies(),
            media: get('Media'),
            likes: get('Likes')
        };
    }

    function parsePhoneCommands(text) {
        if (!text || !isPhoneFeatureEnabled()) return [];
        const commands = [];
        let match;
        LEGACY_PHONE_TAG.lastIndex = 0;

        while ((match = LEGACY_PHONE_TAG.exec(text)) !== null) {
            try {
                const jsonStr = match[1].trim();
                // 🔥 跳过空内容
                if (!jsonStr) {
                    continue;
                }
                const command = JSON.parse(jsonStr);
                commands.push(command);
            } catch (e) {
                console.warn('⚠️ 旧版Phone标签解析失败（已忽略）:', e.message);
            }
        }
        return commands;
    }

    // 在全局 API 空闲时再执行任务，避免与其他请求抢占
    function runTaskWhenApiIdle(task, options = {}) {
        const retryDelay = Math.max(300, parseInt(options.retryDelay, 10) || 1200);

        const tryRun = async () => {
            const apiManager = window.VirtualPhone?.apiManager;
            const isBusy = !!(apiManager?.isBusy?.() || (apiManager?.getActiveRequestCount?.() > 0));

            if (isBusy) {
                setTimeout(tryRun, retryDelay);
                return;
            }

            try {
                await task();
            } catch (e) {
                console.warn('[VirtualPhone] 空闲调度任务执行失败:', e);
            }
        };

        tryRun();
    }

    function ensureAutoWeiboQueueState() {
        if (!window.VirtualPhone) window.VirtualPhone = {};

        if (!Array.isArray(window.VirtualPhone._autoWeiboQueue)) {
            window.VirtualPhone._autoWeiboQueue = [];
        }
        if (!(window.VirtualPhone._autoWeiboQueuedKeys instanceof Set)) {
            window.VirtualPhone._autoWeiboQueuedKeys = new Set();
        }
        if (!(window.VirtualPhone._autoWeiboRunningKeys instanceof Set)) {
            window.VirtualPhone._autoWeiboRunningKeys = new Set();
        }
        if (typeof window.VirtualPhone._autoWeiboQueueGeneration !== 'number') {
            window.VirtualPhone._autoWeiboQueueGeneration = 0;
        }
        if (typeof window.VirtualPhone._autoWeiboWorkerRunning !== 'boolean') {
            window.VirtualPhone._autoWeiboWorkerRunning = false;
        }
        if (typeof window.VirtualPhone._autoWeiboPending !== 'boolean') {
            window.VirtualPhone._autoWeiboPending = false;
        }
        if (typeof window.VirtualPhone._autoWeiboSuppressUntil !== 'number') {
            window.VirtualPhone._autoWeiboSuppressUntil = 0;
        }

        return window.VirtualPhone;
    }

    function getCurrentChatIdForQueue() {
        const ctx = getContext();
        return ctx?.chatId || 'default';
    }

    function isAutoWeiboTransientError(error) {
        const msg = String(error?.message || error || '').toLowerCase();
        if (!msg) return false;

        const transientKeys = [
            'timeout', 'timed out', 'network', 'fetch', 'tls', 'ssl',
            'socket', 'econn', 'enotfound', 'eai_again',
            '429', '502', '503', '504', 'rate limit',
            'abort', 'temporarily', '超时', '网络', '连接'
        ];

        return transientKeys.some(k => msg.includes(k));
    }

    function resetAutoWeiboQueue(reason = 'reset') {
        const state = ensureAutoWeiboQueueState();
        state._autoWeiboQueueGeneration += 1;
        state._autoWeiboQueue = [];
        state._autoWeiboQueuedKeys.clear();
        state._autoWeiboRunningKeys.clear();
        state._autoWeiboPending = false;
        console.log(`[Weibo][AutoQueue] 已重置: ${reason}`);
    }

    function suppressAutoWeiboTrigger(ms = 15000, reason = 'manual') {
        const state = ensureAutoWeiboQueueState();
        const ttl = Math.max(0, parseInt(ms, 10) || 0);
        state._autoWeiboSuppressUntil = Date.now() + ttl;
        resetAutoWeiboQueue(`suppress:${reason}`);
    }

    async function waitWithGeneration(ms, generation) {
        const state = ensureAutoWeiboQueueState();
        let left = Math.max(0, parseInt(ms, 10) || 0);

        while (left > 0) {
            if (state._autoWeiboQueueGeneration !== generation) return false;
            const step = Math.min(800, left);
            await new Promise(resolve => setTimeout(resolve, step));
            left -= step;
        }

        return state._autoWeiboQueueGeneration === generation;
    }

    async function waitForApiIdleWithGeneration(generation, retryDelay = 1500) {
        const state = ensureAutoWeiboQueueState();
        const delay = Math.max(300, parseInt(retryDelay, 10) || 1500);

        while (true) {
            if (state._autoWeiboQueueGeneration !== generation) return false;

            const apiManager = window.VirtualPhone?.apiManager;
            const pluginBusy = !!(apiManager?.isBusy?.() || (apiManager?.getActiveRequestCount?.() > 0));
            const tavernBusy = isTavernPrimaryGenerationBusy();
            const isBusy = pluginBusy || tavernBusy;
            if (!isBusy) return true;

            const keepWaiting = await waitWithGeneration(delay, generation);
            if (!keepWaiting) return false;
        }
    }

    function isTavernPrimaryGenerationBusy() {
        try {
            const ctx = getContext();

            // 常见运行时标记（不同版本酒馆字段名可能不同，做多重兜底）
            if (typeof window.is_send_press === 'boolean' && window.is_send_press) return true;
            if (typeof ctx?.is_send_press === 'boolean' && ctx.is_send_press) return true;
            if (typeof ctx?.isGenerating === 'boolean' && ctx.isGenerating) return true;
            if (typeof ctx?.is_generate_in_progress === 'boolean' && ctx.is_generate_in_progress) return true;
            if (typeof ctx?.generationInProgress === 'boolean' && ctx.generationInProgress) return true;
            if (typeof ctx?.streamingInProgress === 'boolean' && ctx.streamingInProgress) return true;

            // DOM 兜底：发送按钮显示停止态时视为主请求仍在进行
            const sendBtn = document.getElementById('send_but');
            if (sendBtn) {
                const className = String(sendBtn.className || '');
                if (/fa-stop|stop|stopped|generating|stream/i.test(className)) return true;
                if (sendBtn.querySelector('.fa-stop, .fa-circle-stop, .fa-spinner, .fa-pause')) return true;
            }

            const stopBtn = document.querySelector('#mes_stop, #mes_stop_btn, #stop_button');
            if (stopBtn) {
                const style = window.getComputedStyle(stopBtn);
                const visible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                if (visible) return true;
            }
        } catch (e) {
            // 检测失败时保守返回 false，避免把队列永久卡死
        }

        return false;
    }

    async function runAutoWeiboQueueWorker() {
        const state = ensureAutoWeiboQueueState();
        if (state._autoWeiboWorkerRunning) return;

        state._autoWeiboWorkerRunning = true;

        try {
            while (state._autoWeiboQueue.length > 0) {
                const task = state._autoWeiboQueue.shift();
                if (!task || !task.key || typeof task.run !== 'function') continue;

                state._autoWeiboQueuedKeys.delete(task.key);
                state._autoWeiboRunningKeys.add(task.key);

                try {
                    if (task.generation !== state._autoWeiboQueueGeneration) continue;
                    if (task.chatId && task.chatId !== getCurrentChatIdForQueue()) {
                        console.log(`[Weibo][AutoQueue] 跳过过期任务: ${task.key}`);
                        continue;
                    }
                    if ((state._autoWeiboSuppressUntil || 0) > Date.now()) {
                        continue;
                    }

                    const waitMs = (parseInt(task.runAt, 10) || Date.now()) - Date.now();
                    if (waitMs > 0) {
                        const keepWaiting = await waitWithGeneration(waitMs, task.generation);
                        if (!keepWaiting) break;
                    }

                    const maxRetries = Math.max(0, parseInt(task.maxRetries, 10) || 2);
                    const retryDelay = Math.max(300, parseInt(task.retryDelay, 10) || 1500);
                    const baseBackoffMs = Math.max(500, parseInt(task.baseBackoffMs, 10) || 3000);

                    let attempt = 0;
                    while (true) {
                        if (task.generation !== state._autoWeiboQueueGeneration) break;
                        if (task.chatId && task.chatId !== getCurrentChatIdForQueue()) break;

                        const idleReady = await waitForApiIdleWithGeneration(task.generation, retryDelay);
                        if (!idleReady) break;

                        try {
                            const result = await task.run();
                            if (result?.skipped) {
                                console.log(`[Weibo][AutoQueue] 跳过任务(${task.key}): ${result.reason || 'skipped'}`);
                            }
                            break;
                        } catch (err) {
                            const canRetry = isAutoWeiboTransientError(err) && attempt < maxRetries;
                            if (!canRetry) {
                                console.warn(`[Weibo][AutoQueue] 任务失败(${task.key}):`, err);
                                break;
                            }

                            attempt += 1;
                            const backoff = baseBackoffMs * attempt;
                            console.warn(`[Weibo][AutoQueue] 任务重试(${task.key}) ${attempt}/${maxRetries}，${backoff}ms 后重试`);
                            const keepWaiting = await waitWithGeneration(backoff, task.generation);
                            if (!keepWaiting) break;
                        }
                    }
                } finally {
                    state._autoWeiboRunningKeys.delete(task.key);
                    state._autoWeiboPending = state._autoWeiboQueue.length > 0;
                }
            }
        } finally {
            state._autoWeiboWorkerRunning = false;
            state._autoWeiboPending = state._autoWeiboQueue.length > 0;

            if (state._autoWeiboPending) {
                setTimeout(() => {
                    runAutoWeiboQueueWorker();
                }, 100);
            }
        }
    }

    function enqueueAutoWeiboTask(task = {}) {
        const state = ensureAutoWeiboQueueState();
        if (!task.key || typeof task.run !== 'function') return false;
        if ((state._autoWeiboSuppressUntil || 0) > Date.now()) return false;

        if (state._autoWeiboQueuedKeys.has(task.key) || state._autoWeiboRunningKeys.has(task.key)) {
            return false;
        }

        state._autoWeiboQueue.push({
            ...task,
            generation: state._autoWeiboQueueGeneration,
            runAt: parseInt(task.runAt, 10) || Date.now()
        });
        state._autoWeiboQueuedKeys.add(task.key);
        state._autoWeiboPending = true;

        runAutoWeiboQueueWorker();
        return true;
    }

    function scheduleAutoWeiboIfDue(options = {}) {
        try {
            if (!isPhoneFeatureEnabled()) return;
            const state = ensureAutoWeiboQueueState();
            if ((state._autoWeiboSuppressUntil || 0) > Date.now()) return;
            if (isTavernPrimaryGenerationBusy()) return;

            const ctx = getContext();
            const chatLength = Array.isArray(ctx?.chat) ? ctx.chat.length : 0;
            if (chatLength <= 0) return;

            import('./apps/weibo/weibo-data.js').then(module => {
                const weiboData = window.VirtualPhone?.weiboApp?.weiboData || new module.WeiboData(storage);
                const floorSettings = weiboData.getFloorSettings();
                if (!floorSettings?.autoEnabled) return;

                const latestFloor = Math.max(0, chatLength - 1);
                const autoFloor = Math.max(1, parseInt(floorSettings.autoInterval, 10) || 20);

                const rawLastIdx = parseInt(weiboData.getAutoLastFloor(), 10);
                let safeLastIdx = Number.isFinite(rawLastIdx) ? rawLastIdx : 0;
                safeLastIdx = Math.max(0, Math.min(safeLastIdx, latestFloor));

                if (safeLastIdx !== rawLastIdx) {
                    weiboData.setAutoLastFloor(safeLastIdx);
                }

                if ((latestFloor - safeLastIdx) < autoFloor) return;

                const delay = Math.max(0, parseInt(options.delay, 10) || (8000 + Math.random() * 4000));
                const chatId = ctx?.chatId || 'default';
                const queueKey = `weibo:auto:${chatId}:${safeLastIdx}->${latestFloor}`;

                enqueueAutoWeiboTask({
                    key: queueKey,
                    chatId,
                    runAt: Date.now() + delay,
                    retryDelay: 1500,
                    maxRetries: 2,
                    baseBackoffMs: 3000,
                    run: async () => weiboData.autoGenerateWeibo()
                });
            }).catch(e => console.warn('[Weibo] 自动微博模块加载失败:', e));
        } catch (err) {
            console.warn('[Weibo] 自动微博检测异常:', err);
        }
    }

    // 🔥 新增：解析微信消息标签
    function parseWechatMessages(text) {
        if (!text || !isPhoneFeatureEnabled()) return [];
        const messages = [];
        let match;
        LEGACY_WECHAT_TAG.lastIndex = 0;

        while ((match = LEGACY_WECHAT_TAG.exec(text)) !== null) {
            try {
                messages.push({
                    chatId: match[1],
                    from: match[2],
                    content: stripWechatCommentWrapper(match[3])
                });
            } catch (e) {
                console.error('❌ 微信消息解析失败:', e);
            }
        }
        return messages;
    }

    // 🔥 新版：解析轻量级XML格式微信标签（支持 ---联系人--- 分隔多人）
    function parseLightweightWechatTag(text) {
        if (!text || !isPhoneFeatureEnabled()) return [];

        let normalizedText = String(text || '');
        // 🔥 防御性修复：将 SillyTavern 渲染后的 markdown 链接还原为原始格式
        // 例如 <a href="金额：100元">转账</a> → [转账](金额：100元)
        // 这解决了 [转账](金额：xx元) 等格式被 markdown 引擎吞掉的问题
        normalizedText = normalizedText.replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, '[$2]($1)');
        // 兼容被转义后的标签（例如 &lt;wechat&gt;）
        normalizedText = normalizedText
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&amp;/gi, '&')
            .replace(/&#60;/gi, '<')
            .replace(/&#62;/gi, '>');

        const results = [];

        // 1. 检查空标签 <wechat></wechat> - 面对面对话或离线
        WECHAT_EMPTY_REGEX.lastIndex = 0;
        const emptyMatch = normalizedText.match(WECHAT_EMPTY_REGEX);
        if (emptyMatch && emptyMatch.length > 0) {
            // 检查是否只有空标签，没有其他内容
            const hasContentTags = /<\s*wechat\b[^>]*>[\s\S]+?<\s*\/\s*wechat\s*>/i.test(normalizedText);
            if (!hasContentTags) {
                return [{ type: 'empty', status: 'online' }];
            }
        }

        // 2. 解析完整消息标签 <wechat>内容</wechat>
        WECHAT_TAG_REGEX_NEW.lastIndex = 0;
        let match;

        while ((match = WECHAT_TAG_REGEX_NEW.exec(normalizedText)) !== null) {
            let content = extractWechatTagPayload(match[0]) || stripWechatCommentWrapper(match[1]);

            if (!content) {
                continue;
            }

            // 🔥 核心修复：清洗酒馆 Markdown 渲染残留的恶心实体符，避免正则瘫痪
            content = content
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/p\s*>/gi, '\n')
                .replace(/<\/div\s*>/gi, '\n')
                .replace(/<p[^>]*>/gi, '')
                .replace(/<div[^>]*>/gi, '')
                .replace(/\r\n/g, '\n')
                .replace(/&nbsp;/gi, ' ')     // 清除空格实体
                .replace(/\u200B/g, '')       // 移除零宽字符
                .replace(/^\s*[\r\n]/gm, ''); // 移除多余的空行

            // 🔥 兼容：AI 直接照抄模板变量时，避免 date 字段残留占位符干扰解析
            content = content.replace(/\{\{STORY_DATE\}\}/gi, '');

            // 🔥🔥🔥 改用更可靠的解析方式：逐行解析
            const lines = content.split('\n');

            let currentContact = null;
            let currentChatType = 'single';
            let currentChatTypeSource = 'inferred';
            let currentDate = null;
            let currentMessages = [];
            let groupMembers = [];

            // 🔥 辅助函数：保存当前联系人的消息
            const saveCurrentContact = () => {
                if (currentContact && currentMessages.length > 0) {
                    results.push({
                        type: 'wechat_message',
                        contact: currentContact,
                        chatType: currentChatType,
                        chatTypeSource: currentChatTypeSource,
                        date: currentDate,
                        messages: [...currentMessages],
                        members: currentChatType === 'group' ? [...groupMembers] : [],
                        status: 'online',
                        notification: `${currentContact}: ${currentMessages[0].content.substring(0, 20)}...`
                    });
                }
            };

            for (const line of lines) {
                // 行内容错：去除残余 HTML 包裹，避免 ---联系人--- 无法命中
                const trimmedLine = String(line || '').replace(/<[^>]*>/g, ' ').trim();
                if (!trimmedLine) continue;

                // 🔥🔥🔥 检测联系人/群名分隔行
                // 兼容：---张三--- / ——张三—— / －－张三－－ / ──张三── / ___张三___
                const contactHeaderMatch = /^(?:-{3,}|—{2,}|－{2,}|─{2,}|━{2,}|_{3,})\s*(.+?)\s*(?:-{3,}|—{2,}|－{2,}|─{2,}|━{2,}|_{3,})$/.exec(trimmedLine);
                if (contactHeaderMatch) {
                    // 先保存之前的联系人
                    saveCurrentContact();

                    // 开始新联系人/群
                    currentContact = contactHeaderMatch[1].trim();
                    currentChatType = 'single'; // 默认单聊，等解析到 type:group 再改
                    currentChatTypeSource = 'inferred';
                    currentDate = null;
                    currentMessages = [];
                    groupMembers = [];
                    continue;
                }

                // 解析 type: 属性
                if (trimmedLine.startsWith('type:') || trimmedLine.startsWith('type：')) {
                    currentChatType = trimmedLine.substring(5).trim();
                    currentChatTypeSource = 'explicit';
                    continue;
                }

                // 解析 date: 属性
                if (trimmedLine.startsWith('date:') || trimmedLine.startsWith('date：')) {
                    currentDate = trimmedLine.substring(5).trim();
                    continue;
                }

                // 🔥 兼容旧版 from: 属性（单联系人格式）
                if (trimmedLine.startsWith('from:') || trimmedLine.startsWith('from：')) {
                    saveCurrentContact();
                    currentContact = trimmedLine.substring(5).trim();
                    currentChatType = 'single';
                    currentChatTypeSource = 'explicit';
                    currentMessages = [];
                    groupMembers = [];
                    continue;
                }

                // 🔥 兼容旧版 to: 属性
                if (trimmedLine.startsWith('to:') || trimmedLine.startsWith('to：')) {
                    saveCurrentContact();
                    currentContact = trimmedLine.substring(3).trim();
                    currentChatType = 'single';
                    currentChatTypeSource = 'explicit';
                    currentMessages = [];
                    groupMembers = [];
                    continue;
                }

                // 🔥🔥🔥 群聊格式：[21:30] 发送者: 消息内容
                // 🔥 严格限制发送者名称，防止把正文里带冒号的句子（如时间10:30）误判为发送者
                const senderMessageRegex = /^\[([0-9A-Za-z:：]+)\]\s*([^\s:：，。,\.!?！？\[\]【】()（）]{1,20})[：:]\s*(.+)$/;
                const senderMatch = senderMessageRegex.exec(trimmedLine);

                if (senderMatch) {
                    const msgTime = senderMatch[1];
                    const msgSender = senderMatch[2].trim();
                    let msgContent = senderMatch[3].trim();
                    let quote = null;

                    // 🔥 提取引用格式：「引用 xxx: yyy」
                    const quoteMatch = msgContent.match(/^「引用\s+([^:：]+)[:：]\s*([^」]+)」\s*(.*)$/);
                    if (quoteMatch) {
                        quote = { sender: quoteMatch[1].trim(), content: quoteMatch[2].trim() };
                        msgContent = quoteMatch[3].trim();
                    }

                    // 🔥 记录群成员
                    if (!groupMembers.includes(msgSender)) {
                        groupMembers.push(msgSender);
                    }

                    // 🔥 自动检测仅在未显式声明 type 时启用，避免单聊被误升级
                    if (currentChatTypeSource !== 'explicit' && groupMembers.length > 1 && currentChatType !== 'group') {
                        currentChatType = 'group';
                    }

                    const msgObj = {
                        time: msgTime,
                        sender: msgSender,
                        content: msgContent,
                        type: 'text',
                        quote: quote  // 🔥 携带引用信息
                    };
                    parseMessageType(msgObj);
                    currentMessages.push(msgObj);
                    continue;
                }

                // 🔥 简单格式：[21:30] 消息内容（单聊）
                const timeMatch = /^\[([0-9A-Za-z:：]+)\]\s*(.+)$/.exec(trimmedLine);
                if (timeMatch) {
                    let msgContent = timeMatch[2].trim();
                    let quote = null;

                    // 🔥 提取引用格式：「引用 xxx: yyy」
                    const quoteMatch = msgContent.match(/^「引用\s+([^:：]+)[:：]\s*([^」]+)」\s*(.*)$/);
                    if (quoteMatch) {
                        quote = { sender: quoteMatch[1].trim(), content: quoteMatch[2].trim() };
                        msgContent = quoteMatch[3].trim();
                    }

                    const msgObj = {
                        time: timeMatch[1],
                        sender: currentContact,
                        content: msgContent,
                        type: 'text',
                        quote: quote  // 🔥 携带引用信息
                    };
                    parseMessageType(msgObj);
                    currentMessages.push(msgObj);
                    continue;
                }

                // 🔥 无时间前缀的纯文本消息（线上模式）
                if (currentContact && trimmedLine) {
                    let msgContent = trimmedLine;
                    let quote = null;

                    // 🔥 提取引用格式：「引用 xxx: yyy」
                    const quoteMatch = msgContent.match(/^「引用\s+([^:：]+)[:：]\s*([^」]+)」\s*(.*)$/);
                    if (quoteMatch) {
                        quote = { sender: quoteMatch[1].trim(), content: quoteMatch[2].trim() };
                        msgContent = quoteMatch[3].trim();
                    }

                    const msgObj = {
                        sender: currentContact,
                        content: msgContent,
                        type: 'text',
                        quote: quote  // 🔥 携带引用信息
                    };
                    parseMessageType(msgObj);
                    currentMessages.push(msgObj);
                }
            }

            // 保存最后一个联系人的消息
            saveCurrentContact();
        }

        return results;
    }

    // 🔧 辅助函数：解析消息类型
    function parseMessageType(msgObj) {
        const content = msgObj.content;

        // [拨打微信语音] / [拨打微信群语音] / [发起群视频通话]（兼容全角方括号【】）
        const wechatCallMatch = String(content || '').match(/[［\[]\s*(?:拨打|发起)\s*(?:微信)?(群)?(语音|视频)(?:通话)?\s*[］\]]|【\s*(?:拨打|发起)\s*(?:微信)?(群)?(语音|视频)(?:通话)?\s*】/);
        if (wechatCallMatch) {
            const callLabel = wechatCallMatch[2] || wechatCallMatch[4];
            const isGroupCall = Boolean((wechatCallMatch[1] || wechatCallMatch[3] || '').trim());
            msgObj.type = 'incoming_call';
            msgObj.callType = callLabel === '视频' ? 'video' : 'voice';
            msgObj.isGroupCall = isGroupCall;
            return;
        }

        // [图片/视频](描述) / [图片/视频]（描述）
        const imageMatch = /^\[(图片|视频)\]\s*[（(]\s*([^)）]+?)\s*[)）]\s*$/.exec(content);
        if (imageMatch) {
            const promptText = String(imageMatch[2] || '').trim();
            msgObj.type = 'image_prompt';
            msgObj.mediaType = imageMatch[1]; // 记录是图片还是视频
            msgObj.imagePrompt = promptText;
            msgObj.content = promptText;
            return;
        }

        // [语音]内容 / [语音](内容) / [语音]（内容）/ 【语音】内容
        const newVoiceMatch = /^(?:\[\s*语音\s*\]|【\s*语音\s*】)\s*[:：]?\s*(.+)$/i.exec(String(content || '').trim());
        if (newVoiceMatch) {
            let parsedVoiceText = String(newVoiceMatch[1] || '').trim();
            const wrappedVoiceMatch = parsedVoiceText.match(/^[（(]\s*([\s\S]*?)\s*[)）]$/);
            if (wrappedVoiceMatch) {
                parsedVoiceText = String(wrappedVoiceMatch[1] || '').trim();
            }
            msgObj.type = 'voice';
            msgObj.voiceText = parsedVoiceText;
            // 自动计算秒数：每3个字1秒，最少2秒，最多60秒
            let seconds = Math.ceil((msgObj.voiceText || '语音').length / 3);
            seconds = Math.max(2, Math.min(seconds, 60));
            msgObj.duration = seconds + '"'; // 微信真实的秒数符号是双引号
            return;
        }


        // [表情包](描述) / [表情包]（描述）- 兼容旧格式，统一映射为 emoji 表情
        const stickerMatch = /^\[表情包\]\s*[（(]\s*([^)）]+?)\s*[)）]\s*$/.exec(content);
        if (stickerMatch) {
            msgObj.type = 'sticker';
            msgObj.keyword = stickerMatch[1].trim();
            return;
        }

        // [红包] (支持多种格式)
        if (content.startsWith('[红包]')) {
            msgObj.type = 'redpacket';
            const amtMatch = content.match(/¥?\s*([\d.]+)\s*[元块]?/);
            msgObj.amount = amtMatch ? amtMatch[1] : '88.88';
            const textMatch = content.match(/\(([^)]+)\)/);
            let wish = textMatch ? textMatch[1] : '';
            wish = wish.replace(/金额[：:]\s*[\d.]+[元块]?/, '').replace(/^[,，\s]+/, '').trim();
            msgObj.wish = wish || '恭喜发财，大吉大利';
            return;
        }

        // [转账] (支持多种格式)
        if (content.startsWith('[转账]')) {
            msgObj.type = 'transfer';
            const amtMatch = content.match(/¥?\s*([\d.]+)\s*[元块]?/);
            msgObj.amount = amtMatch ? amtMatch[1] : '500.00';
            const textMatch = content.match(/\(([^)]+)\)/);
            let desc = textMatch ? textMatch[1] : '';
            desc = desc.replace(/金额[：:]\s*[\d.]+[元块]?/, '').replace(/^[,，\s]+/, '').trim();
            // 🔥 注意：统一使用 desc 字段，适配 chat-view 的渲染
            msgObj.desc = desc || '转账给你';
            msgObj.remark = msgObj.desc; // 兼容旧版
            return;
        }
    }

    // 🔥 新增：处理手机标签数据
    function handlePhoneTag(tagData) {
        if (!tagData || !tagData.type) return;

        switch (tagData.type) {
            case 'wechat_message':
                handleWechatTagData(tagData);
                break;

            case 'wechat_contacts':
                handleContactsUpdate(tagData);
                break;

            case 'notification':
                if (tagData.title && tagData.content) {
                    showUnifiedPhoneNotification(tagData.title, tagData.content, tagData.icon || '📱');
                }
                break;

            default:
                console.warn('⚠️ 未知的手机标签类型:', tagData.type);
        }
    }

    // 🔥 处理微信消息标签数据（使用AI输出的时间更新全局时间）
    function handleWechatTagData(data) {
        if (!data.contact || !data.messages) {
            console.warn('⚠️ 微信消息数据不完整:', data);
            return;
        }

        // 🔥 优先使用 AI 输出的日期，其次用剧情时间
        let baseDate = data.date || '2044年10月28日';

        // 🔥 从消息中获取最新的时间（优先使用消息自带的时间）
        let baseTime = '21:30';
        if (data.messages.length > 0) {
            // 找到消息中最晚的时间
            const lastMsg = data.messages[data.messages.length - 1];
            if (lastMsg.time && lastMsg.time.match(/^\d{1,2}:\d{2}$/)) {
                baseTime = lastMsg.time;
            }
        }

        // 🔥 更新全局剧情时间（关键！）- 按需加载 TimeManager
        loadTimeManager().then(tm => {
            try {
                if (tm && tm.setTime) {
                    // 🔥 修复：尝试保留当前的星期几，防止被真实日历强行覆盖
                    const current = tm.getCurrentStoryTime();
                    let passWeekday = null;

                    // 如果日期没变，强行继承原有的自定义星期几
                    if (current && current.date && baseDate && current.date.trim() === baseDate.trim()) {
                        passWeekday = current.weekday;
                    }

                    tm.setTime(baseTime, baseDate, passWeekday);

                    // 🔥 时间更新后立即刷新状态栏
                    if (phoneShell && phoneShell.updateStatusBarTime) {
                        phoneShell.updateStatusBarTime();
                    }
                }
            } catch (e) {
                console.warn('⚠️ 更新全局时间失败:', e);
            }
        }).catch(e => {
            console.warn('⚠️ 加载 TimeManager 失败:', e);
        });

        // 🔥🔥🔥 关键修复：无论微信APP是否打开，都先存储消息 🔥🔥🔥

        // 1️⃣ 直接操作数据层（不依赖微信APP）
        const context = getContext();
        const charId = context?.characterId || 'default';
        const chatId = context?.chatId || 'default';

        // 导入 WechatData（使用单例模式，确保消息被存储）
        import('./apps/wechat/wechat-data.js').then(module => {
            let wechatData;

            // 🔥🔥🔥 关键修复：确保 VirtualPhone 对象存在！🔥🔥🔥
            if (!window.VirtualPhone) window.VirtualPhone = {};

            // 🔥 防串味安全校验：chatId 变了就强制重建 WechatData 实例
            if (_lastWechatChatId && _lastWechatChatId !== chatId) {
                console.warn('⚠️ chatId 变更，清空微信缓存防止串味:', _lastWechatChatId, '->', chatId);
                if (window.VirtualPhone) {
                    window.VirtualPhone.wechatApp = null;
                    window.VirtualPhone.cachedWechatData = null;
                }
                window.currentWechatApp = null;
                window.ggp_currentWechatApp = null;
            }
            _lastWechatChatId = chatId;

            // 🔥🔥🔥 核心修复：确保全局只有一个 WechatData 实例，防止数据分叉！🔥🔥🔥
            // 优先级：cachedWechatData > wechatApp.wechatData > 新建
            if (!window.VirtualPhone.cachedWechatData) {
                // 如果 cachedWechatData 不存在，检查 wechatApp 是否有实例
                if (window.VirtualPhone.wechatApp && window.VirtualPhone.wechatApp.wechatData) {
                    window.VirtualPhone.cachedWechatData = window.VirtualPhone.wechatApp.wechatData;
                } else {
                    window.VirtualPhone.cachedWechatData = new module.WechatData(storage);
                }
            }
            // 确保 wechatApp 也使用同一个实例
            if (window.VirtualPhone.wechatApp && window.VirtualPhone.wechatApp.wechatData !== window.VirtualPhone.cachedWechatData) {
                window.VirtualPhone.wechatApp.wechatData = window.VirtualPhone.cachedWechatData;
            }
            wechatData = window.VirtualPhone.cachedWechatData;

            const normalizeWechatName = (name) => String(name || '').trim().replace(/\s+/g, '').toLowerCase();
            const contactLookupKey = normalizeWechatName(data.contact);
            const explicitGroupType = data.chatType === 'group' && data.chatTypeSource === 'explicit';
            const hasExistingGroupByName = wechatData.getChatList().some(c =>
                c?.type === 'group' && normalizeWechatName(c?.name) === contactLookupKey
            );
            const effectiveIsGroupChat = explicitGroupType || hasExistingGroupByName;

            // 🔥🔥🔥 群聊处理：群聊不需要添加到联系人，直接找/创建群聊天 🔥🔥🔥
            let existingContact = null;
            if (!effectiveIsGroupChat) {
                // 单聊：确保联系人存在（自动添加到通讯录）
                existingContact = wechatData.getContacts().find(c => c.name === data.contact);
                if (!existingContact) {
                    const newContactId = `contact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    wechatData.addContact({
                        id: newContactId,
                        name: data.contact,
                        avatar: data.avatar || '👤',
                        remark: '',
                        relation: '',
                        letter: wechatData.getFirstLetter(data.contact)
                    });
                    existingContact = wechatData.getContacts().find(c => c.name === data.contact);
                }
            }

            // 🔥🔥🔥 关键修复：按联系人名字和类型查找现有聊天，避免重复创建 🔥🔥🔥
            // 1. 先按名字和类型查找（最精确）
            let chat = wechatData.getChatList().find(c =>
                normalizeWechatName(c.name) === contactLookupKey &&
                (effectiveIsGroupChat ? c.type === 'group' : c.type !== 'group')
            );

            // 2. 如果按名字+类型找不到，再按名字查找（兼容旧数据）
            if (!chat) {
                const sameNameChats = wechatData.getChatList().filter(c => normalizeWechatName(c.name) === contactLookupKey);
                if (sameNameChats.length === 1) {
                    chat = sameNameChats[0];
                }
            }

            // 3. 如果按名字找不到，再按 contactId 查找（单聊）
            if (!chat && existingContact) {
                chat = wechatData.getChatByContactId(existingContact.id);
            }

            // 4. 都找不到，才创建新聊天（🔥 必须有实际消息才允许创建，防止幽灵空会话）
            if (!chat && data.messages && data.messages.length > 0) {
                const newChatId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                chat = wechatData.createChat({
                    id: newChatId,
                    contactId: existingContact?.id,
                    name: data.contact,
                    type: effectiveIsGroupChat ? 'group' : 'single',
                    avatar: data.avatar || existingContact?.avatar || (effectiveIsGroupChat ? '👥' : '👤'),
                    members: effectiveIsGroupChat ? (data.members || []) : []
                });
                
                // 🛡️ 核心护盾：强行在创建会话时，给内存注入一个空数组，并锁定懒加载开关！
                // 这样后续的 addMessage 绝不会去硬盘里读空数据来覆盖它！
                wechatData.data.messages[newChatId] = [];
                wechatData._messagesLoaded[newChatId] = true;
                
            } else if (chat) {
                // 🔥 仅在显式 type:group 时允许从 single 升级，防止解析误判污染会话类型
                if (explicitGroupType && chat.type !== 'group') {
                    chat.type = 'group';
                    chat.members = data.members || [];
                }
            }

            // 🔥 防幽灵：如果没有找到也没有创建聊天（无消息数据），直接返回
            if (!chat) return;

            // 🔥 存储所有消息（带防重复计数）
            let newMessagesAdded = 0;
            // 🔥 累计时间偏移（分钟），用于批量消息的时间递增
            let accumulatedMinutes = 0;
            let hasIncomingCall = false;
            let incomingCallType = 'voice';
            let queuedAiLines = [];

            // 🔥 先获取全局最新时间作为基准（跨所有会话）
            const timeManager = window.VirtualPhone?.timeManager;
            let referenceTime = baseTime;

            if (timeManager) {
                const globalTime = timeManager.getCurrentStoryTime();
                if (globalTime && globalTime.time && /^\d{1,2}:\d{2}$/.test(globalTime.time)) {
                    referenceTime = globalTime.time;
                }
            }

            // 🔥 再检查当前会话的最后一条消息时间，取较晚的
            const existingMessages = wechatData.getMessages(chat.id);
            if (existingMessages && existingMessages.length > 0) {
                const lastExisting = existingMessages[existingMessages.length - 1];
                if (lastExisting.time && /^\d{1,2}:\d{2}$/.test(lastExisting.time)) {
                    const [lastHour, lastMin] = lastExisting.time.split(':').map(Number);
                    const [refHour, refMin] = referenceTime.split(':').map(Number);
                    if (lastHour * 60 + lastMin > refHour * 60 + refMin) {
                        referenceTime = lastExisting.time;
                    }
                }
            }

            data.messages.forEach((msg, index) => {
                if (hasIncomingCall) {
                    const queuedLine = String(msg.content || '').trim();
                    if (queuedLine) {
                        queuedAiLines.push(queuedLine);
                    }
                    return;
                }

                if (msg.type === 'incoming_call') {
                    hasIncomingCall = true;
                    incomingCallType = msg.callType === 'video' ? 'video' : 'voice';
                    return;
                }

                // 🔥🔥🔥 关键修复：优先使用消息自带的时间，而不是自动计算 🔥🔥🔥
                let finalTime = msg.time;

                // 只有当消息没有时间时，才计算递增时间
                if (!finalTime || !finalTime.match(/^\d{1,2}:\d{2}$/)) {
                    // 🔥 慢速步进：避免 AI 一次多条消息把时间推得过快
                    let minutesToAdd = 1;
                    if (timeManager && typeof timeManager.getWechatMessageMinutesToAdd === 'function') {
                        minutesToAdd = timeManager.getWechatMessageMinutesToAdd(msg.content, { inBatch: true });
                    } else {
                        const contentLength = String(msg.content || '').trim().length;
                        minutesToAdd = contentLength <= 12 ? 0 : 1;
                    }
                    minutesToAdd = Math.max(0, Number(minutesToAdd) || 0);

                    // 累加到总偏移
                    accumulatedMinutes += minutesToAdd;

                    // 基于 referenceTime 加上累计偏移计算新时间
                    const [hour, minute] = referenceTime.split(':').map(Number);
                    const totalMinutes = hour * 60 + minute + accumulatedMinutes;
                    const newHour = Math.floor(totalMinutes / 60) % 24;
                    const newMinute = totalMinutes % 60;
                    finalTime = `${String(newHour).padStart(2, '0')}:${String(newMinute).padStart(2, '0')}`;
                }

                // 🔥 同步更新全局时间，确保跨会话也能递增
                if (timeManager && timeManager.setTime) {
                    try {
                        timeManager.setTime(finalTime, data.date || baseDate);
                    } catch (e) {
                        // 忽略错误
                    }
                }

                // 🔥 修复：去除消息内容开头的 "发送者: " 或 "发送者：" 前缀
                let cleanContent = msg.content;

                // 🔥🔥🔥 群聊消息：使用消息中的 sender 字段
                let messageSender = data.contact;  // 默认使用联系人/群名
                let senderAvatar = data.avatar || '👤';

                if (effectiveIsGroupChat && msg.sender) {
                    // 群聊消息，使用每条消息的发送者
                    messageSender = msg.sender;

                    // 尝试获取发送者的头像
                    const senderContact = wechatData.getContactByName(msg.sender);
                    if (senderContact && senderContact.avatar) {
                        senderAvatar = senderContact.avatar;
                    } else {
                        // 🔥 核心修复4：强制置空，阻止继承 data.avatar（避免把群头像套到个人头上）
                        senderAvatar = '';
                    }
                }

                // 清理发送者前缀
                if (cleanContent.startsWith(messageSender + ':')) {
                    cleanContent = cleanContent.substring(messageSender.length + 1).trim();
                } else if (cleanContent.startsWith(messageSender + '：')) {
                    cleanContent = cleanContent.substring(messageSender.length + 1).trim();
                } else if (cleanContent.startsWith(data.contact + ':')) {
                    cleanContent = cleanContent.substring(data.contact.length + 1).trim();
                } else if (cleanContent.startsWith(data.contact + '：')) {
                    cleanContent = cleanContent.substring(data.contact.length + 1).trim();
                }

                // 🔥 存储消息到数据层（带上 batchId 和历史标记）
                const added = wechatData.addMessage(chat.id, {
                    from: messageSender,
                    content: cleanContent,
                    time: finalTime,
                    date: data.date || baseDate,
                    type: msg.type || 'text',
                    avatar: senderAvatar,
                    duration: msg.duration,
                    voiceText: msg.voiceText,
                    tavernMessageIndex: data.tavernMessageIndex,
                    batchId: data.batchId,                 // 🔥 传入批次ID
                    isHistoryReplay: data.isHistoryReplay, // 🔥 传入历史回放标记
                    fromMainChatTag: true,                 // 🔥 标记来自正文解析，用于流式碎片清洗
                    amount: msg.amount,
                    desc: msg.desc,
                    wish: msg.wish,
                    callType: msg.callType,
                    quote: msg.quote
                });
                if (added) newMessagesAdded++;

            });

            if (hasIncomingCall) {
                triggerWechatIncomingCall(chat.id, data.contact, incomingCallType, queuedAiLines);
                return;
            }

            // 🔥🔥🔥 关键修复：只有真正添加了新消息时，且绝对不能是历史重绘，才更新未读数和红点 🔥🔥🔥
            if (newMessagesAdded > 0 && !data.isHistoryReplay) {
                // 🔥 修复：如果用户正在查看这个聊天，不增加红点
                const isPhoneOpen = document.getElementById('phone-panel')?.classList.contains('phone-panel-open');
                const isViewingThisChat = isPhoneOpen && currentApp === 'wechat' && window.VirtualPhone?.wechatApp?.currentChat?.id === chat.id;
                if (!isViewingThisChat) {
                    chat.unread = (chat.unread || 0) + newMessagesAdded;
                    updateAppBadge('wechat', newMessagesAdded);
                    totalNotifications += newMessagesAdded;
                    updateNotificationBadge(totalNotifications);
                }
                wechatData.saveData();

                // 🔥 立即刷新手机状态栏时间显示
                if (phoneShell && phoneShell.updateStatusBarTime) {
                    phoneShell.updateStatusBarTime();
                }
            }


           // 2️⃣ 如果微信APP正好打开，立即刷新界面（移除延迟，防止竞争条件）
            const wechatApp = window.currentWechatApp || window.ggp_currentWechatApp;
            if (wechatApp) {
                const messagesDiv = document.getElementById('chat-messages');
                // 🔥 如果正停留在目标聊天窗口，执行局部刷新
                if (messagesDiv && wechatApp.currentChat && wechatApp.currentChat.id === chat.id) {
                    const chatView = wechatApp.chatView;
                    if (chatView) {
                        const messages = wechatApp.wechatData.getMessages(wechatApp.currentChat.id);
                        const userInfo = wechatApp.wechatData.getUserInfo();
                        // 优先使用智能防闪烁引擎
                        if (typeof chatView.smartUpdateMessages === 'function') {
                            chatView.smartUpdateMessages(messages, userInfo);
                        }
                    }
                } 
                // 🔥 否则（在聊天列表或其他页面），执行全局刷新
                else {
                    wechatApp.render();
                }
            }

            // 3️⃣ 显示通知（仅在真正写入了新消息时，避免“有提醒但会话没更新”）
            if (data.notification && newMessagesAdded > 0 && !data.isHistoryReplay) {
                const latestMsgObj = [...(data.messages || [])]
                    .reverse()
                    .find(m => m && m.type !== 'incoming_call' && String(m.content || '').trim());
                let previewText = String(latestMsgObj?.content || data.notification || '').replace(/\s+/g, ' ').trim();
                previewText = previewText.replace(new RegExp(`^${String(data.contact || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[：:]\\s*`), '');
                if (!previewText) previewText = `${data.contact || '好友'}发来新消息`;
                if (previewText.length > 34) previewText = `${previewText.slice(0, 34)}...`;

                const finalNotifyAvatar = _resolveWechatNotificationAvatar(wechatData, chat, existingContact, data);

                showUnifiedPhoneNotification('微信消息', previewText, '', {
                    avatar: finalNotifyAvatar,
                    name: data.contact || '微信',
                    content: previewText,
                    timeText: '刚刚',
                    senderKey: `wechat:${chat?.id || data.contact || 'unknown'}:${Date.now()}`
                });
            }
        }).catch(err => {
            console.error('❌ [消息存储] 导入WechatData失败:', err);
        });
    }

    // 🔥 处理联系人更新
    function handleContactsUpdate(data) {
        if (!data.contacts || !Array.isArray(data.contacts)) {
            console.warn('⚠️ 联系人数据格式错误:', data);
            return;
        }

        if (window.ggp_currentWechatApp && window.ggp_currentWechatApp.addContacts) {
            window.ggp_currentWechatApp.addContacts(data.contacts);
        } else {
            // 暂存到存储，等微信APP加载后再添加
            const pending = storage.get('ggp_pending_contacts') || [];
            pending.push(...data.contacts);
            storage.set('ggp_pending_contacts', pending);
        }
    }

    // 🔥 新增：隐藏微信标签
    function hideWechatTags() {
        $('.mes_text').each(function () {
            const $this = $(this);
            let html = $this.html();
            if (!html) return;

            // 替换为"已发送到手机"提示（可选）
            html = html.replace(WECHAT_TAG_REGEX_NEW, '<span style="color:#07c160;font-size:12px;">📱 已发送到微信</span>');

            // 或者完全隐藏（取消下面这行的注释）
            // html = html.replace(WECHAT_TAG_REGEX_NEW, '<span style="display:none!important;">$&</span>');

            $this.html(html);
        });
    }

    // 执行手机指令
    function executePhoneCommand(command) {
        if (!isPhoneFeatureEnabled()) {
            return;
        }

        const { app, action, data } = command;

        switch (app) {
            case 'wechat':
                handleWechatCommand(action, data);
                break;
            case 'browser':
                handleBrowserCommand(action, data);
                break;
            case 'notification':
                handleNotification(action, data);
                break;
            case 'system':
                handleSystemCommand(action, data);
                break;
        }

        saveData();
    }

    function handleWechatCommand(action, data) {
        if (action === 'receiveMessage') {
            // 支持单条消息
            if (data.message) {
                const oneText = String(data.message || '').replace(/\s+/g, ' ').trim() || '发来新消息';
                showUnifiedPhoneNotification(
                    data.from || '新消息',
                    oneText,
                    '💬',
                    {
                        avatar: _normalizeWechatAvatarPath(data.avatar) || data.avatar || _DEFAULT_WECHAT_FRIEND_AVATAR,
                        name: data.from || '微信',
                        content: oneText,
                        timeText: '刚刚',
                        senderKey: `wechat:${data.chatId || data.from || 'legacy'}:${Date.now()}`
                    }
                );
                updateAppBadge('wechat', 1);
                totalNotifications++;
                updateNotificationBadge(totalNotifications);
            }

            // 支持多条消息
            if (data.messages && Array.isArray(data.messages)) {
                data.messages.forEach((msg, index) => {
                    setTimeout(() => {
                        const senderName = msg.from || data.from || '微信';
                        const msgText = String(msg.text || msg.message || '').replace(/\s+/g, ' ').trim() || '发来新消息';
                        showUnifiedPhoneNotification(
                            senderName,
                            msgText,
                            '💬',
                            {
                                avatar: _normalizeWechatAvatarPath(msg.avatar) || _normalizeWechatAvatarPath(data.avatar) || msg.avatar || data.avatar || _DEFAULT_WECHAT_FRIEND_AVATAR,
                                name: senderName,
                                content: msgText,
                                timeText: '刚刚',
                                senderKey: `wechat:${data.chatId || senderName}:${Date.now()}:${index}`
                            }
                        );
                    }, index * 1500);
                });

                updateAppBadge('wechat', data.messages.length);
                totalNotifications += data.messages.length;
                updateNotificationBadge(totalNotifications);
            }


            // ✅ 自动传递给微信APP
            handleWechatMessage(data);
        }

        // 兼容旧的 newMessage action
        if (action === 'newMessage') {
            const legacyText = String(data.message || '').replace(/\s+/g, ' ').trim() || '发来新消息';
            showUnifiedPhoneNotification(data.from || '新消息', legacyText, '💬', {
                avatar: _normalizeWechatAvatarPath(data.avatar) || data.avatar || _DEFAULT_WECHAT_FRIEND_AVATAR,
                name: data.from || '微信',
                content: legacyText,
                timeText: '刚刚',
                senderKey: `wechat:${data.chatId || data.from || 'legacy'}:${Date.now()}`
            });
            updateAppBadge('wechat', 1);
            totalNotifications++;
            updateNotificationBadge(totalNotifications);

            // ✅ 自动传递给微信APP
            handleWechatMessage(data);
        }
    }

    // ✅ 处理微信消息（支持新的微信APP）
    function handleWechatMessage(data) {
        // 如果微信APP正在运行，直接发送到APP
        if (window.ggp_currentWechatApp) {
            window.ggp_currentWechatApp.receiveMessage(data);
        }
    }

    function handleBrowserCommand(action, data) {
        if (action === 'open') {
            phoneShell?.showNotification('浏览器', `访问: ${data.url}`, '🌐');
        }
    }

    function handleNotification(action, data) {
        if (action === 'show') {
            phoneShell?.showNotification(data.title || '通知', data.message || '', data.icon || '📱');
        }
    }

    function handleSystemCommand(action, data) {
        if (action === 'vibrate' && settings.vibrationEnabled) {
            if (phoneShell?.container) {
                phoneShell.container.style.animation = 'shake 0.5s';
                setTimeout(() => { phoneShell.container.style.animation = ''; }, 500);
            }
        }
    }

    function updateAppBadge(appId, increment = 1) {
        const app = currentApps.find(a => a.id === appId);
        if (app) {
            app.badge = (app.badge || 0) + increment;
            if (homeScreen && currentApp === null) {
                homeScreen.apps = currentApps;
                homeScreen.render();
            }
            // 🔥 核心修复：更新全局徽章时必须持久化到 storage，防止刷新后死灰复燃
            saveData();
        }
    }

    function saveData() {
        storage.saveApps(currentApps);
    }

    function loadData() {
        currentApps = storage.loadApps(JSON.parse(JSON.stringify(APPS)));
        totalNotifications = currentApps.reduce((sum, app) => sum + (app.badge || 0), 0);
        updateNotificationBadge(totalNotifications);
    }

    function hidePhoneTags() {
        // 1. 注入 CSS (保证底线隐藏，防止闪烁)
        if (!document.getElementById('st-phone-hide-style')) {
            $('<style id="st-phone-hide-style">phone, wechat, music, weibo { display: none !important; }</style>').appendTo('head');
        }

        // 2. 遍历页面上的消息气泡
        $('.mes_text').each(function () {
            const root = this;
            let html = root.innerHTML;

            // 快速跳过，提升性能
            if (!html || !/phone|wechat|music|weibo|手机来电通话|PHONE_CHAT_MODE/i.test(html)) {
                return;
            }

            // 隐藏那些被解析为真实 DOM 元素的孤立标签
            $(root).find('phone, wechat, music, weibo').hide();

            let changed = false;

            // 策略 A: 尝试完整匹配并替换 (适用于格式完美，没有被浏览器截断的情况)
            const tags = ['music', 'phone', 'wechat', 'weibo'];
            tags.forEach(tag => {
                const rx = new RegExp(`(?:<p>|<br>\\s*)*(?:<pre><code[^>]*>)?(?:<|&lt;)${tag}(?:>|&gt;)[\\s\\S]*?(?:<|&lt;)\\/${tag}(?:>|&gt;)(?:<\\/code><\\/pre>)?(?:<\\/p>)?`, 'gi');
                const replaced = html.replace(rx, '');
                if (replaced !== html) {
                    html = replaced;
                    changed = true;
                }
            });

            // 单独处理来电标签
            const phoneCallRx = /\[手机来电通话\][^\n<]*/gi;
            if (phoneCallRx.test(html)) {
                html = html.replace(phoneCallRx, '');
                changed = true;
            }

            // 🔥 策略 B: 兜底斩断法 ！！！核心大招！！！
            // 专门对付浏览器 DOM 解析时吃掉闭合标签导致正则失效的千古难题。
            // 只要发现开头标签，直接把后面的一切内容全部截断删除！(因为标签都在消息最末尾，安全无痛)
            const fallbackRegex = /(?:<p>|<br>\s*)*(?:<pre><code[^>]*>)?(?:<|&lt;)(?:music|phone|wechat|weibo)(?:>|&gt;)[\s\S]*$/i;
            const fallbackReplaced = html.replace(fallbackRegex, '');
            if (fallbackReplaced !== html) {
                html = fallbackReplaced;
                changed = true;
            }

            if (changed) {
                root.innerHTML = html;
            }
        });
    }

    //  新增：处理用户主动在正文发送的 <回复xxx> 标签 (兼顾转义、换行与终极防 F5 刷新复读)
    function processUserReplyTags(text, tavernIndex, batchId) {
        if (!text) return;

        // 兼容酒馆原生 < > 和被转义的 &lt; &gt;
        const replyRegex = /(?:<|&lt;)回复([^>&]+?)(?:>|&gt;)([\s\S]*?)(?:<|&lt;)\/回复\1(?:>|&gt;)/gi;
        let match;

        while ((match = replyRegex.exec(text)) !== null) {
            const contactName = match[1].trim();
            let rawContent = match[2];

            if (!contactName || !rawContent) continue;

            //  核心清洗：处理酒馆的 <br> 换行和 HTML 实体标签
            rawContent = rawContent.replace(/<br\s*\/?>/gi, '\n');
            rawContent = rawContent.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
            rawContent = rawContent.replace(/<[^>]+>/g, ''); // 移除剩余的段落等P标签
            const content = rawContent.trim();

            // 导入 WeChat 数据模块处理
            import('./apps/wechat/wechat-data.js').then(async module => {
                let wechatData;
                const context = getContext();
                const chatId = context?.chatId || 'default';

                // 🔥🔥🔥 关键修复：确保 VirtualPhone 对象存在！🔥🔥🔥
                if (!window.VirtualPhone) window.VirtualPhone = {};

                // 防串味处理
                if (_lastWechatChatId && _lastWechatChatId !== chatId) {
                    if (window.VirtualPhone) {
                        window.VirtualPhone.wechatApp = null;
                        window.VirtualPhone.cachedWechatData = null;
                    }
                    window.currentWechatApp = null;
                    window.ggp_currentWechatApp = null;
                }
                _lastWechatChatId = chatId;

                // 🔥🔥🔥 核心修复：确保全局只有一个 WechatData 实例，防止数据分叉！🔥🔥🔥
                if (!window.VirtualPhone.cachedWechatData) {
                    if (window.VirtualPhone.wechatApp && window.VirtualPhone.wechatApp.wechatData) {
                        window.VirtualPhone.cachedWechatData = window.VirtualPhone.wechatApp.wechatData;
                    } else {
                        window.VirtualPhone.cachedWechatData = new module.WechatData(storage);
                    }
                }
                if (window.VirtualPhone.wechatApp && window.VirtualPhone.wechatApp.wechatData !== window.VirtualPhone.cachedWechatData) {
                    window.VirtualPhone.wechatApp.wechatData = window.VirtualPhone.cachedWechatData;
                }
                wechatData = window.VirtualPhone.cachedWechatData;

                // 🔥 修复：用户 <回复> 写入前强制刷新剧情时间缓存，避免时间黏在上一条
                // 场景：AI只推进正文时间但未回复手机标签时，下一次用户<回复>也应使用正文最新时间
                try {
                    const tm = await loadTimeManager();
                    if (tm?.clearCache) {
                        tm.clearCache();
                    }
                    // 预热一次，确保后续 addMessage() 读取到本轮最新时间
                    tm?.getCurrentStoryTime?.();
                } catch (e) {
                    console.warn('⚠️ [手机] 刷新剧情时间失败，将回退到原有时间基准:', e);
                }

                const normalizeReplyTargetName = (name) => String(name || '').trim().replace(/\s+/g, '');
                const normalizedContactName = normalizeReplyTargetName(contactName);

                // 1) 先扫描群聊名称：命中群聊时，严禁自动新增通讯录联系人
                const existingGroupChat = wechatData.getChatList().find(c => {
                    if (!c || c.type !== 'group') return false;
                    const groupName = String(c.name || '').trim();
                    return groupName === contactName || normalizeReplyTargetName(groupName) === normalizedContactName;
                });

                let chat = null;
                if (existingGroupChat) {
                    chat = existingGroupChat;
                } else {
                    // 2) 未命中群聊才按单聊联系人处理（保持原逻辑）
                    let existingContact = wechatData.getContacts().find(c => c.name === contactName);
                    if (!existingContact) {
                        const newContactId = `contact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                        wechatData.addContact({
                            id: newContactId,
                            name: contactName,
                            avatar: '',
                            remark: '',
                            relation: '',
                            letter: wechatData.getFirstLetter(contactName)
                        });
                        existingContact = wechatData.getContacts().find(c => c.name === contactName);
                    }

                    chat = wechatData.getChatList().find(c => c.name === contactName && c.type !== 'group');
                    if (!chat && existingContact) {
                        chat = wechatData.getChatByContactId(existingContact.id);
                    }
                    if (!chat) {
                        chat = wechatData.createChat({
                            id: `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                            contactId: existingContact.id,
                            name: contactName,
                            type: 'single',
                            avatar: existingContact.avatar || ''
                        });
                    }
                }

                // 3. 逐行解析内容并判断是否为新消息
                const lines = content.split('\n');
                let addedCount = 0;
                const tmForReply = window.VirtualPhone?.timeManager || (await loadTimeManager());
                const parseStoryTs = (timeData) => {
                    if (!timeData?.time || !timeData?.date) return Number.NEGATIVE_INFINITY;
                    try {
                        if (typeof tmForReply?.parseTimeToTimestamp === 'function') {
                            const parsed = Number(tmForReply.parseTimeToTimestamp(timeData));
                            if (Number.isFinite(parsed)) return parsed;
                        }
                        const dateParts = String(timeData.date).match(/(\d{1,6})[-\/年]\s*(\d{1,2})[-\/月]\s*(\d{1,2})\s*日?/);
                        const timeParts = String(timeData.time).match(/(\d{1,2})[:：](\d{2})/);
                        if (dateParts && timeParts) {
                            return new Date(
                                parseInt(dateParts[1], 10),
                                parseInt(dateParts[2], 10) - 1,
                                parseInt(dateParts[3], 10),
                                parseInt(timeParts[1], 10),
                                parseInt(timeParts[2], 10)
                            ).getTime();
                        }
                    } catch (e) {
                        // ignore
                    }
                    return Number.NEGATIVE_INFINITY;
                };

                let timelineCursor = tmForReply?.getCurrentStoryTime?.() || null;
                const existingMessages = wechatData.getMessages(chat.id);
                const lastExistingMessage = Array.isArray(existingMessages) && existingMessages.length > 0
                    ? existingMessages[existingMessages.length - 1]
                    : null;
                const lastExistingTime = lastExistingMessage?.time && lastExistingMessage?.date
                    ? {
                        time: lastExistingMessage.time,
                        date: lastExistingMessage.date,
                        weekday: lastExistingMessage.weekday || ''
                    }
                    : null;
                if (lastExistingTime && (!timelineCursor || parseStoryTs(lastExistingTime) > parseStoryTs(timelineCursor))) {
                    timelineCursor = lastExistingTime;
                }

                const normalizeStickerKeyword = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '');
                const customEmojis = Array.isArray(wechatData.getCustomEmojis?.())
                    ? wechatData.getCustomEmojis()
                    : [];

                lines.forEach(line => {
                    const trimmedLine = line.trim();
                    if (!trimmedLine) return;

                    let messageTime = timelineCursor || null;
                    if (tmForReply?.addMinutesToStoryTime && timelineCursor?.time && timelineCursor?.date) {
                        let minutesToAdd = 1;
                        if (typeof tmForReply.getWechatMessageMinutesToAdd === 'function') {
                            minutesToAdd = tmForReply.getWechatMessageMinutesToAdd(trimmedLine, { inBatch: true });
                        } else {
                            minutesToAdd = String(trimmedLine).replace(/\s+/g, '').length <= 12 ? 0 : 1;
                        }
                        minutesToAdd = Math.max(1, Number(minutesToAdd) || 0);
                        const nextStoryTime = tmForReply.addMinutesToStoryTime(timelineCursor, minutesToAdd);
                        if (nextStoryTime?.time && nextStoryTime?.date) {
                            messageTime = nextStoryTime;
                            timelineCursor = nextStoryTime;
                            if (typeof tmForReply.setTime === 'function') {
                                tmForReply.setTime(nextStoryTime.time, nextStoryTime.date, nextStoryTime.weekday || null);
                            }
                        }
                    }

                    const stickerMatch = /^\[表情包\]\s*[（(]\s*([^)）]+?)\s*[)）]\s*$/.exec(trimmedLine);
                    const stickerKeyword = stickerMatch ? String(stickerMatch[1] || '').trim() : '';
                    const normalizedStickerKeyword = normalizeStickerKeyword(stickerKeyword);
                    const matchedCustomEmoji = normalizedStickerKeyword
                        ? customEmojis.find(emoji => {
                            const nameNorm = normalizeStickerKeyword(emoji?.name);
                            const descNorm = normalizeStickerKeyword(emoji?.description);
                            return (nameNorm && nameNorm === normalizedStickerKeyword)
                                || (descNorm && descNorm === normalizedStickerKeyword);
                        })
                        : null;

                    const messagePayload = {
                        from: 'me',
                        content: trimmedLine,
                        type: 'text',
                        time: messageTime?.time,
                        date: messageTime?.date,
                        weekday: messageTime?.weekday,
                        avatar: wechatData.getUserInfo().avatar || '',
                        tavernMessageIndex: tavernIndex, // 🔥 传入楼层索引
                        batchId: batchId,                // 🔥 传入批次ID
                        fromMainChatTag: true            // 🔥 标记来自正文解析
                    };

                    // 与微信线上逻辑对齐：
                    // [表情包](描述) 先命中“我的表情”同名资源，命中则直接按自定义表情图片发送。
                    // 未命中则保持旧逻辑（sticker -> API / 无配置时关键词占位卡片）。
                    if (matchedCustomEmoji?.image) {
                        messagePayload.type = 'image';
                        messagePayload.content = String(matchedCustomEmoji.image || '').trim();
                        messagePayload.customEmojiId = String(matchedCustomEmoji.id || '').trim();
                        messagePayload.customEmojiName = String(matchedCustomEmoji.name || '').trim();
                        messagePayload.customEmojiDescription = String(
                            matchedCustomEmoji.description || matchedCustomEmoji.name || stickerKeyword
                        ).trim();
                    }

                    //  wechatData.addMessage 底层自带有防重复检测
                    const isAdded = wechatData.addMessage(chat.id, messagePayload);

                    if (isAdded) {
                        addedCount++;
                    }
                });

                // 4.  终极防闪烁：只有真正写入了新消息时，才执行保存和UI刷新！
                if (addedCount > 0) {
                    wechatData.saveData();

                    // 如果微信正好是打开状态，静默刷新界面
                    const wechatApp = window.currentWechatApp || window.ggp_currentWechatApp;
                    if (wechatApp) {
                        const messagesDiv = document.getElementById('chat-messages');
                        // 如果用户正停留在该联系人的聊天窗口
                        if (messagesDiv && wechatApp.currentChat && wechatApp.currentChat.id === chat.id) {
                            const messages = wechatData.getMessages(chat.id);
                            const userInfo = wechatData.getUserInfo();
                            messagesDiv.innerHTML = wechatApp.chatView.renderMessagesWithDateDividers(messages, userInfo);
                            messagesDiv.scrollTop = messagesDiv.scrollHeight; // 自动滚到底部

                            // 重新绑定长按菜单等事件
                            if (wechatApp.chatView.bindMessageLongPressEvents) {
                                wechatApp.chatView.bindMessageLongPressEvents();
                            }
                        } else {
                            // 刷新外层视图（比如更新聊天列表最新的消息预览）
                            wechatApp.render();
                        }
                    }
                }
            }).catch(err => {
                console.error('❌ 解析用户<回复>标签失败:', err);
            });
        }
    }

    function onMessageReceived(messageId) {
        try {
            const context = getContext();
            if (!context || !context.chat) return;

            const index = typeof messageId === 'number' ? messageId : context.chat.length - 1;
            const message = context.chat[index];

            if (!message) return;

            // 🔥 核心护盾：默认忽略“非最新楼层”的渲染事件，防止旧楼层在重绘时被误当新消息重解析。
            // 仅当该楼层被 Swipe/Regenerate 显式标记后，才允许重新解析。
            const latestIndex = Math.max(0, context.chat.length - 1);
            const forcedReplay = consumeForcedReplayFloor(index, context.chatId);
            if (!forcedReplay && index < latestIndex) {
                return;
            }

            const swipeIndex = Number.isInteger(message.swipe_id) ? message.swipe_id : 0;

            // 🔥 核心修复：精准区分"历史回放"和"重新生成/滑动"
            // _phone_processed 仅标记"是否曾经处理过"，但重新生成/滑动时内容已经改变，
            // 必须用 swipe_id 作为辅助判断：如果 swipe 分支变了，即使 _phone_processed=true，也不是回放！
            let isHistoryReplay = false;
            if (message._phone_processed) {
                // 检查 swipe 分支是否变化
                const lastSwipeId = message._phone_lastSwipeId;
                if (lastSwipeId !== undefined && lastSwipeId !== swipeIndex) {
                    // swipe 变了：这是滑动操作，不是历史回放
                    isHistoryReplay = false;
                } else if (lastSwipeId === swipeIndex) {
                    // swipe 没变且已处理过：这是真正的历史回放（如F5刷新）
                    isHistoryReplay = true;
                } else {
                    // lastSwipeId 不存在但 _phone_processed=true：
                    // 可能是重新生成（酒馆替换了消息内容但保留了 _phone_processed）
                    // 此时需要检查内容是否变化
                    const currentText = (Array.isArray(message.swipes) && message.swipes.length > 0)
                        ? String(message.swipes[swipeIndex] || '') : (message.mes || '');
                    const lastHash = message._phone_lastContentHash;
                    const currentHash = currentText.length + '_' + currentText.substring(0, 50);
                    if (lastHash && lastHash !== currentHash) {
                        // 内容变了：重新生成
                        isHistoryReplay = false;
                    } else {
                        isHistoryReplay = true;
                    }
                }
            }
            message._phone_processed = true;
            message._phone_lastSwipeId = swipeIndex;
            // 🔥 核心修复：优先从 swipes 获取原始文本，避免 message.mes 中的 markdown 链接被渲染成 HTML
            // SillyTavern 会把 [转账](金额：100元) 当作 markdown 链接渲染成 <a href="金额：100元">转账</a>
            // 导致解析时 (金额：100元) 部分被"吞掉"
            let text = '';
            if (Array.isArray(message.swipes) && message.swipes.length > 0) {
                text = String(message.swipes[swipeIndex] || message.swipes[0] || '');
            }
            if (!text) {
                text = message.mes || '';
            }

            // 🔥 保存内容哈希，用于下次判断内容是否变化（重新生成检测）
            message._phone_lastContentHash = text.length + '_' + text.substring(0, 50);

            // 🔥 新增：生成当前解析批次ID，用于清洗流式输出导致的重复片段
            const currentBatchId = 'batch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

            // 🔥 新增：单独拦截用户消息，处理 <回复xx> 标签
            if (message.is_user) {
                if (isPhoneFeatureEnabled() && !isHistoryReplay) {
                    processUserReplyTags(text, index, currentBatchId); // 🔥 传入 index 和 batchId
                }
                // 用户楼层同样参与微博自动触发判断
                scheduleAutoWeiboIfDue({ reason: 'user_message' });
                return; // 用户消息处理完毕后退出，不走下面的 AI 标签解析链路
            }

            // ==========================================
            // 🚫 以下功能，只有在手机启用时才解析
            // ==========================================
            if (isPhoneFeatureEnabled()) {
                // 🔥🔥🔥 核心修复：在解析新标签之前，先回滚该楼层的旧数据！🔥🔥🔥
                // 这样无论是 Regenerate 还是 Swipe，都能正确清除旧消息再写入新消息。
                // 只对 AI 消息且非历史回放时执行。
                if (!isHistoryReplay && !message.is_user) {
                    try {
                        const wechatDataInstance = window.VirtualPhone?.wechatApp?.wechatData || window.VirtualPhone?.cachedWechatData;
                        if (wechatDataInstance && typeof wechatDataInstance.rollbackToFloor === 'function') {
                            // 回滚当前楼层（含）及之后的数据，为新内容腾出空间
                            wechatDataInstance.rollbackToFloor(index);
                        }
                    } catch (e) {
                        console.warn('⚠️ [手机插件] 消息渲染前回滚失败:', e);
                    }
                }

                // 🔥 新增：让 AI 也能使用 <回复xx> 标签替用户发消息
                if (!isHistoryReplay) {
                    processUserReplyTags(text, index, currentBatchId); // 🔥 传入 index 和 batchId
                    processMofoTags(text, { source: 'assistant', messageIndex: index }).then(updates => {
                        // 只要有魔坊条目匹配到更新，优先弹 changed 的；否则弹第一个匹配项
                        if (!Array.isArray(updates) || updates.length === 0) return;
                        const preferred = updates.find(u => u && u.changed && u.id) || updates.find(u => u && u.id);
                        if (preferred && window.VirtualPhone?.showMofoUpdateBubble) {
                            window.VirtualPhone.showMofoUpdateBubble(preferred.id);
                        }
                    }).catch(e => console.warn('Mofo tag process error:', e));
                }
                // 解析微信标签
                const wechatTagDataList = parseLightweightWechatTag(text);
                if (wechatTagDataList.length > 0) {
                    wechatTagDataList.forEach(wechatTagData => {
                        if (wechatTagData.type !== 'empty') {
                            wechatTagData.isHistoryReplay = isHistoryReplay;
                            wechatTagData.tavernMessageIndex = index;
                            wechatTagData.batchId = currentBatchId; // 🔥 传入批次ID
                            handlePhoneTag(wechatTagData);
                        }
                    });
                }

                // 兼容旧版 <Phone> 标签
                const commands = parsePhoneCommands(text);
                commands.forEach(cmd => executePhoneCommand(cmd));

                // 📞 解析来电标签
                const phoneTagMatch = text.match(/<Phone>([\s\S]*?)<\/Phone>/i);
                if (phoneTagMatch) {
                    const phoneContent = phoneTagMatch[1];
                    const callMatch = phoneContent.match(PHONE_CALL_REGEX);
                    // 旧楼层重放/刷新时只保留通话记录数据，不应再次触发来电弹窗。
                    if (callMatch && !isHistoryReplay) handleIncomingPhoneCall(callMatch[1].trim());
                }

                // 兼容旧版微信标签
                const wechatMessages = parseWechatMessages(text);
                if (wechatMessages.length > 0) {
                    wechatMessages.forEach(msg => {
                        if (window.currentWechatApp) {
                            window.currentWechatApp.receiveMessage({
                                chatId: msg.chatId, from: msg.from, message: msg.content,
                                timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                            });
                        }
                    });
                }

                // 📱 解析 <Weibo> 标签
                const weiboTagMatch = text.match(/<Weibo>([\s\S]*?)<\/Weibo>/i);
                if (weiboTagMatch && !isHistoryReplay) {
                    try {
                        import('./apps/weibo/weibo-data.js').then(module => {
                            const weiboData = window.VirtualPhone.weiboApp?.weiboData || new module.WeiboData(storage);
                            const parsed = weiboData.parseWeiboContent(text);
                                if (parsed.posts.length > 0) {
                                    parsed.posts.forEach((post, idx) => {
                                        post.id = Date.now().toString(36) + idx.toString(36) + Math.random().toString(36).substr(2, 4);
                                        if (!post.likeList) post.likeList = [];
                                        if (!post.commentList) post.commentList = [];
                                    });
                                weiboData.saveRecommendPosts(parsed.posts);
                                if (parsed.hotSearches.length > 0) weiboData.saveHotSearches(parsed.hotSearches);
                                window.VirtualPhone?.weiboApp?.handleExternalRecommendUpdate?.();
                                const weiboApp = currentApps.find(a => a.id === 'weibo');
                                if (weiboApp) { weiboApp.badge = parsed.posts.length; saveData(); }
                                showUnifiedPhoneNotification('微博', `收到 ${parsed.posts.length} 条新微博`, '📱', {
                                    ...WEIBO_NOTIFY_AVATAR,
                                    name: '微博',
                                    content: `收到 ${parsed.posts.length} 条新微博`,
                                    timeText: '刚刚',
                                    senderKey: `weibo:feed:${Date.now()}`
                                });
                            }
                        }).catch(e => console.warn('📱 微博模块加载失败:', e));
                    } catch (e) { console.warn('⚠️ [微博] 解析Weibo标签失败:', e); }
                }
            }

            // ==========================================
            // 🎵 音乐功能（无视开关，永远执行解析）
            // ==========================================
            MUSIC_TAG_REGEX.lastIndex = 0;
            let musicMatch;
            let hasMusicTag = false;
            const musicBlocks = [];
            while ((musicMatch = MUSIC_TAG_REGEX.exec(text)) !== null) {
                const block = String(musicMatch[1] || '').trim();
                if (block) musicBlocks.push(block);
            }
            if (musicBlocks.length === 0) {
                const looksLikeLooseMusicCard = /\[\s*Char\s*[|｜]/i.test(text) && /\[\s*Media\s*[|｜]/i.test(text);
                if (looksLikeLooseMusicCard) {
                    musicBlocks.push(String(text || ''));
                }
            }
            for (const musicContent of musicBlocks) {
                hasMusicTag = true;

                // 🔥 核心修复：防止 F5 刷新网页时，历史记录里的旧音乐卡片覆盖当前最新的状态
                if (isHistoryReplay) continue;

                try {
                    // 解析卡片字段
                    const parsed = parseMusicCard(musicContent);

                    // 🔥 强制唤醒：不管音乐APP是否打开过，收到标签立刻初始化并塞入歌曲
                    import('./apps/music/music-app.js').then(module => {
                        if (!window.VirtualPhone.musicApp) {
                            window.VirtualPhone.musicApp = new module.MusicApp(phoneShell, storage);
                            window.VirtualPhone.musicApp.initFloatingWidget();
                        }
                        const musicApp = window.VirtualPhone.musicApp;

                        musicApp.updateCardData(parsed);

                        // 提取歌曲并加入队列
                        if (parsed.media && parsed.media.length >= 2) {
                            for (let i = 0; i < parsed.media.length - 1; i += 2) {
                                const songName = parsed.media[i].trim();
                                const artistName = parsed.media[i + 1].trim();
                                if (songName && artistName) {
                                    musicApp.addSongToQueue(songName, artistName);
                                    phoneShell?.showNotification('收到新推荐歌曲', `${songName} - ${artistName}`, '🎵');
                                }
                            }
                        }
                    }).catch(e => console.warn('🎵 音乐模块加载失败:', e));

                } catch (e) {
                    console.warn('⚠️ [音乐] 解析Music标签失败:', e);
                }
            }

            // 🔥 核心联动修复：如果 AI 重新生成/滑动到了新的一层，且这一层出错了【没有输出音乐标签】
            // 强制触发一次倒序扫描，让它回退并显示真实的【倒数第二次】音乐卡片，防止面板被旧废案卡死。
            if (!hasMusicTag && !isHistoryReplay) {
                if (window.VirtualPhone && window.VirtualPhone.musicApp) {
                    // 传入一个 true 标记，告诉底层这是“补救扫描”，不要打断当前音乐播放
                    window.VirtualPhone.musicApp._scanLastMessageForCard(true);
                }
            }

            // 📱 解析 <Weibo> 标签
            const weiboTagMatch = text.match(/<Weibo>([\s\S]*?)<\/Weibo>/i);

            // 🔥 核心修复：防止 F5 刷新网页时，历史记录里的旧微博把你"重新生成"的新微博覆盖掉！
            if (weiboTagMatch && !isHistoryReplay) {
                try {
                    import('./apps/weibo/weibo-data.js').then(module => {
                        const weiboData = window.VirtualPhone.weiboApp?.weiboData
                            || new module.WeiboData(storage);

                        const parsed = weiboData.parseWeiboContent(text);

                        if (parsed.posts.length > 0) {
                            // 为每条微博添加ID
                            parsed.posts.forEach((post, idx) => {
                                post.id = Date.now().toString(36) + idx.toString(36) + Math.random().toString(36).substr(2, 4);
                                if (!post.likeList) post.likeList = [];
                                if (!post.commentList) post.commentList = [];
                            });

                            // 缓存推荐内容
                            weiboData.saveRecommendPosts(parsed.posts);

                            if (parsed.hotSearches.length > 0) {
                                weiboData.saveHotSearches(parsed.hotSearches);
                            }

                            window.VirtualPhone?.weiboApp?.handleExternalRecommendUpdate?.();

                            // 更新badge
                            const weiboApp = currentApps.find(a => a.id === 'weibo');
                            if (weiboApp) {
                                weiboApp.badge = parsed.posts.length;
                                saveData();
                            }

                            showUnifiedPhoneNotification('微博', `收到 ${parsed.posts.length} 条新微博`, '📱', {
                                ...WEIBO_NOTIFY_AVATAR,
                                name: '微博',
                                content: `收到 ${parsed.posts.length} 条新微博`,
                                timeText: '刚刚',
                                senderKey: `weibo:feed:${Date.now()}`
                            });
                        }
                    }).catch(e => console.warn('📱 微博模块加载失败:', e));
                } catch (e) {
                    console.warn('⚠️ [微博] 解析Weibo标签失败:', e);
                }
            }


            // 使用 TreeWalker 智能清理页面上的标签
            setTimeout(hidePhoneTags, 150);

            // 🔥 自动写日记检测
            try {
                const promptMgr = window.VirtualPhone?.promptManager;
                if (promptMgr) {
                    promptMgr.ensureLoaded();
                    const diaryConfig = promptMgr.prompts?.diary;
                    if (diaryConfig?.autoEnabled) {
                        const autoFloor = diaryConfig.autoFloor || 50;
                        // 懒加载 DiaryData 检查楼层差
                        import('./apps/diary/diary-data.js').then(module => {
                            const diaryData = window.VirtualPhone.diaryApp?.diaryData
                                || new module.DiaryData(storage);

                            // 🔥 核心修改：使用专属的自动记录独立标记，不再被手动日记干扰
                            const lastIdx = diaryData.getAutoLastFloor();

                            const ctx = getContext();
                            if (ctx && ctx.chat && (ctx.chat.length - 1 - lastIdx) >= autoFloor) {
                                // 🔥 延迟 5-8 秒执行，防止与其他扩展 API 并发冲突
                                const delay = 5000 + Math.random() * 3000;
                                setTimeout(() => diaryData.autoGenerateDiary(), delay);
                            }
                        }).catch(e => console.warn('[Diary] 自动日记模块加载失败:', e));
                    }
                }
            } catch (diaryErr) {
                console.warn('[Diary] 自动日记检测异常:', diaryErr);
            }

            // 📱 自动微博生成检测（统一调度）
            scheduleAutoWeiboIfDue({ reason: 'ai_message' });

        } catch (e) {
            console.error('❌ 消息处理失败:', e);
        }
    }

    // 📞 处理微信来电全局唤醒
    async function triggerWechatIncomingCall(chatId, callerName, callType = 'voice', queuedLines = []) {
        console.log('📞 [微信来电] 触发全局唤醒:', callerName, callType, chatId);

        // 强制展开手机抽屉
        const phonePanel = document.getElementById('phone-panel');
        const drawerIcon = document.getElementById('phoneDrawerIcon');
        openPhonePanelWithOutsideClose(phonePanel, drawerIcon);
        phonePanel?.classList?.remove('hidden');
        phonePanel?.classList?.add('open');

        const content = document.getElementById('phone-panel-content');
        if (content && (!content.querySelector('.phone-in-panel') || !phoneShell)) {
            try {
                await createPhoneInPanel();
            } catch (e) {
                console.warn('⚠️ 微信来电时创建手机壳失败:', e);
            }
        }

        try {
            const module = await import('./apps/wechat/wechat-app.js');
            if (!window.VirtualPhone) window.VirtualPhone = {};

            // 单例复用
            if (!window.VirtualPhone.wechatApp) {
                window.VirtualPhone.wechatApp = new module.WechatApp(phoneShell, storage);
            }
            // 🔥🔥🔥 核心修复：每次都要同步最新的数据实例，防止后台写入的消息丢失！🔥🔥🔥
            if (window.VirtualPhone.cachedWechatData) {
                window.VirtualPhone.wechatApp.wechatData = window.VirtualPhone.cachedWechatData;
            }

            const wechatApp = window.VirtualPhone.wechatApp;
            window.currentWechatApp = wechatApp;
            window.ggp_currentWechatApp = wechatApp;
            currentApp = 'wechat';

            // 强行切进目标联系人聊天页
            if (chatId) {
                // 1. 强制扒掉所有可能残留的第三方 App 全局皮肤（解决蜜语UI污染问题）
                document.querySelectorAll('.phone-body-panel-honey').forEach(el => el.classList.remove('phone-body-panel-honey'));

                // 2. 重建完整的物理视图栈，确保滑动返回路径平滑无白屏 (桌面 -> 微信列表 -> 聊天窗口)
                if (phoneShell) {
                    phoneShell.viewHistory = [];
                    // 先渲染桌面入栈作为最底层垫片
                    if (window.VirtualPhone && window.VirtualPhone.home) {
                        window.VirtualPhone.home.render();
                    }
                }

                // 3. 渲染微信主列表入栈作为第二层垫片
                wechatApp.currentView = 'chats';
                wechatApp.currentChat = null;
                wechatApp.render();

                // 4. 最后打开具体聊天窗口入栈（处于最顶层）
                wechatApp.openChat(chatId);
            } else {
                wechatApp.render();
            }

            const safeQueuedLines = Array.isArray(queuedLines) ? queuedLines : [];
            const targetChat = wechatApp.currentChat || wechatApp.wechatData?.getChat?.(chatId) || {
                id: chatId,
                name: callerName || '对方',
                avatar: '👤'
            };

            if (callType === 'video') {
                if (typeof wechatApp.chatView?.showIncomingVideoCall === 'function') {
                    wechatApp.chatView.showIncomingVideoCall(targetChat, safeQueuedLines);
                } else {
                    wechatApp.chatView?.showIncomingVoiceCall?.(targetChat, safeQueuedLines);
                }
            } else {
                wechatApp.chatView?.showIncomingVoiceCall?.(targetChat, safeQueuedLines);
            }
        } catch (err) {
            console.error('❌ 加载微信来电模块失败:', err);
        }
    }

    // 📞 处理来电
    function handleIncomingPhoneCall(callerName) {
        console.log('📞 [来电] 检测到来电:', callerName);

        // 自动打开手机面板（如果关闭）
        const phonePanel = document.getElementById('phone-panel');
        const drawerIcon = document.getElementById('phoneDrawerIcon');
        if (phonePanel && !phonePanel.classList.contains('phone-panel-open')) {
            openPhonePanelWithOutsideClose(phonePanel, drawerIcon);

            // 确保手机界面已创建
            const content = document.getElementById('phone-panel-content');
            if (content && !content.querySelector('.phone-in-panel')) {
                createPhoneInPanel();
            }
        }

        // 动态加载 phone-app.js 并创建单例
        import('./apps/phone/phone-app.js').then(module => {
            if (!window.VirtualPhone.phoneApp) {
                window.VirtualPhone.phoneApp = new module.PhoneApp(phoneShell, storage);
            }
            currentApp = 'phone';

            // 派发来电事件
            window.dispatchEvent(new CustomEvent('phone:incomingCall', {
                detail: { callerName }
            }));
        }).catch(err => {
            console.error('❌ 加载通话模块失败:', err);
        });
    }

    function onChatChanged() {
        // 🔄 切换会话时清空自动微博队列，避免旧会话任务串入新会话
        resetAutoWeiboQueue('chat_changed');

        // 🔥 切换会话时彻底清空微信单例缓存，防止数据串味
        if (window.VirtualPhone) {
            window.VirtualPhone.wechatApp = null;
            window.VirtualPhone.cachedWechatData = null;
            window.VirtualPhone.cachedMofoData = null;
            // 🔥 清空日记缓存，防止切换聊天后数据串味
            if (window.VirtualPhone.diaryApp) {
                window.VirtualPhone.diaryApp.clearCache();
            }
            // 🔥 清空通话缓存
            if (window.VirtualPhone.phoneApp) {
                window.VirtualPhone.phoneApp.clearCache();
            }
            // 📱 清空微博缓存
            if (window.VirtualPhone.weiboApp) {
                window.VirtualPhone.weiboApp.clearCache();
            }
            // 🪄 清空魔坊缓存
            if (window.VirtualPhone.mofoApp) {
                window.VirtualPhone.mofoApp.clearCache();
            }
            // 🎵 音乐：清空缓存 + 刷新悬浮窗 + 扫描当前会话卡片
            if (window.VirtualPhone.musicApp) {
                window.VirtualPhone.musicApp.onChatChanged(storage);
            }
        }
        window.currentWechatApp = null;
        window.ggp_currentWechatApp = null;
        _lastWechatChatId = null;
        _forcedReplayFloors.clear();

        // 🔥 清除 timeManager 缓存，强制切换后重新从所有来源取最晚时间
        const tm = window.VirtualPhone?.timeManager;
        if (tm) {
            tm.clearCache();
        }

        // 🔥 界面保护：如果手机正停留在应用界面，强制退回主屏幕
        if (currentApp !== null) {
            currentApp = null;
            if (phoneShell) {
                phoneShell.setContent('');
            }
            window.dispatchEvent(new Event('phone:goHome'));
        }

        loadData();

        // 🔥 切换会话时，按需加载 TimeManager 和 PromptManager
        // 这样聊天时提示词能正常注入，不需要先打开手机面板
        loadTimeManager();
        loadPromptManager();

        // 🎵 如果 musicApp 不存在但新会话开启了悬浮窗，需要创建
        if (!window.VirtualPhone?.musicApp && storage?.get('music_show_floating', false)) {
            import('./apps/music/music-app.js').then(module => {
                if (!window.VirtualPhone.musicApp) {
                    window.VirtualPhone.musicApp = new module.MusicApp(null, storage);
                    window.VirtualPhone.musicApp.initFloatingWidget();
                    window.VirtualPhone.musicApp._scanLastMessageForCard();
                }
            }).catch(e => console.warn('🎵 悬浮窗模块加载失败:', e));
        }

        if (homeScreen) {
            homeScreen.apps = currentApps;
            homeScreen.render();
        }

        // 切换会话后重新处理标签隐藏
        setTimeout(hidePhoneTags, 500);
    }

    // 🔥 hidePhoneTags 已移除，改用酒馆正则隐藏
    // 正则：((?:<wechat>|^)[\s\S]*?<\/wechat>)

    function getContext() {
        return (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
            ? SillyTavern.getContext()
            : null;
    }

    // 🔧 辅助函数：计算下一分钟
    function calculateNextMinute(time) {
        try {
            const [hour, minute] = time.split(':').map(Number);
            const totalMinutes = hour * 60 + minute + 1;
            const newHour = Math.floor(totalMinutes / 60) % 24;
            const newMinute = totalMinutes % 60;
            return `${String(newHour).padStart(2, '0')}:${String(newMinute).padStart(2, '0')}`;
        } catch (e) {
            return time;
        }
    }

    // 🎨 初始化颜色设置（新版：统一全局文字颜色）
    function initColors() {
        // 只读取全局文字颜色（默认黑色）
        const globalTextColor = storage.get('phone-global-text') || '#000000';

        // 设置CSS变量
        document.documentElement.style.setProperty('--phone-global-text', globalTextColor);

    }

    async function ensureGlobalPhoneCSS() {
        const styleId = 'st-phone-global-css';
        const existing = document.getElementById(styleId);
        if (existing) return;

        if (_globalCssLoadingPromise) {
            await _globalCssLoadingPromise;
            return;
        }

        _globalCssLoadingPromise = (async () => {
            try {
                const resp = await fetch(ST_PHONE_GLOBAL_CSS_URL, { cache: 'no-cache' });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const cssText = await resp.text();
                let finalCssText = cssText;
                if (finalCssText.charCodeAt(0) === 0xFEFF) {
                    finalCssText = finalCssText.slice(1);
                }

                const style = document.createElement('style');
                style.id = styleId;
                style.setAttribute('data-source', ST_PHONE_GLOBAL_CSS_URL);
                style.textContent = finalCssText;
                document.head.appendChild(style);
            } catch (err) {
                console.error('❌ phone.css 动态注入失败:', err);
            }
        })();

        await _globalCssLoadingPromise;
    }

    // 初始化
    async function init() {
        if (typeof $ === 'undefined') {
            setTimeout(init, 500);
            return;
        }

        if (typeof SillyTavern === 'undefined') {
            setTimeout(init, 500);
            return;
        }

        try {
            
            // 🔥 第零阶段：只加载最核心的 2 个模块
            await loadCoreModules();
            let phonePromptHandler = async () => {};

            // 🔥 第一阶段：核心数据初始化
            loadData();

            // 🔥 VirtualPhone 全局对象（保留已挂载的方法，避免被覆盖）
            const previousVirtualPhone = (window.VirtualPhone && typeof window.VirtualPhone === 'object')
                ? window.VirtualPhone
                : {};
            window.VirtualPhone = {
                ...previousVirtualPhone,
                storage: storage,
                settings: settings,
                extensionBaseUrl: ST_PHONE_BASE_URL,
                version: ST_PHONE_VERSION,
                updateInfo: ST_PHONE_CURRENT_UPDATE,
                apiManager: new ApiManager(storage),
                promptManager: null,
                ttsManager: ttsManager,
                home: null,
                wechatApp: null,
                mofoApp: null,
                cachedMofoData: null,
                notify: showUnifiedPhoneNotification,
                triggerWechatIncomingCall: triggerWechatIncomingCall,
                loadTimeManager: loadTimeManager,
                loadPromptManager: loadPromptManager,
                _parseMusicCard: parseMusicCard,
                _scheduleAutoWeiboIfDue: scheduleAutoWeiboIfDue,
                _suppressAutoWeiboTrigger: suppressAutoWeiboTrigger,
                _autoWeiboQueue: [],
                _autoWeiboQueuedKeys: new Set(),
                _autoWeiboRunningKeys: new Set(),
                _autoWeiboQueueGeneration: 0,
                _autoWeiboWorkerRunning: false,
                _autoWeiboPending: false,
                _autoWeiboSuppressUntil: 0
            };

            // 🔥 关键修复：启动时就预热 TimeManager / PromptManager，
            // 避免“未切会话、未打开手机面板”时线下注入因懒加载对象仍为 null 而失效。
            try {
                await Promise.all([
                    loadTimeManager(),
                    loadPromptManager()
                ]);
            } catch (bootstrapManagerErr) {
                console.warn('⚠️ [手机插件] 预热管理器失败，后续将按需重试:', bootstrapManagerErr);
            }

            // 🔥 第二阶段：轮询等待酒馆加载界面消失后再注入 DOM，解决 WebKit 渲染残留 Bug
            function injectWhenReady() {
                const stLoader = document.getElementById('loader') || document.getElementById('loading_screen');
                // 如果加载遮罩还在显示中，延迟 500ms 继续检查
                if (stLoader && window.getComputedStyle(stLoader).display !== 'none') {
                    setTimeout(injectWhenReady, 500);
                } else {
                    // 加载界面完全消失后，再安全地执行 DOM 注入
                    ensureGlobalPhoneCSS();
                    initColors();
                    bindPhonePanelViewportGuards();
                    createTopPanel();
                    createInlineReplyButton();
                    schedulePhoneUpdateNotices();

                    // 🎵 悬浮窗初始化：若开启了全局悬浮窗，懒加载音乐模块并创建
                    try {
                        const showFloating = storage?.get('music_show_floating', false);
                        if (showFloating) {
                            import('./apps/music/music-app.js').then(module => {
                                // 即使 phoneShell 为 null，也创建 musicApp 实例来管理悬浮窗
                                if (!window.VirtualPhone.musicApp) {
                                    window.VirtualPhone.musicApp = new module.MusicApp(null, storage);
                                }
                                window.VirtualPhone.musicApp.initFloatingWidget();
                            }).catch(e => console.warn('🎵 悬浮窗模块加载失败:', e));
                        }
                    } catch (e) {
                        console.warn('🎵 悬浮窗初始化失败:', e);
                    }
                }
            }
            injectWhenReady();

            // 🔥 wechat 标签隐藏已移至酒馆正则设置
            // 请在酒馆设置中添加正则：((?:<wechat>|^)[\s\S]*?<\/wechat>)

            // 🔥 全局极轻量级监听：三击空白处呼出/隐藏手机
            document.body.addEventListener('click', (e) => {
                // 如果功能被禁用，直接退出
                if (!isPhoneFeatureEnabled()) return;

                // 【核心防误触】如果在酒馆加载界面，直接屏蔽手势
                const stLoader = document.getElementById('loader') || document.getElementById('loading_screen');
                if (stLoader && window.getComputedStyle(stLoader).display !== 'none') {
                    phoneTapCount = 0;
                    return;
                }

                const target = e.target;

                // 【核心防误触】使用 composedPath 防止 DOM 刷新导致的误判
                const path = e.composedPath();
                const isInsidePhone = path.some(el => {
                    if (!el) return false;
                    if (el.id === 'phoneDrawerIcon' || el.id === 'phoneDrawerToolEntry' || el.id === 'phoneDrawerToolRow') return true;
                    return !!(el.classList && el.classList.contains('phone-in-panel'));
                });

                // 如果点击的是特定元素或手机内部区域，则直接忽略
                if (
                    target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.closest('button') ||
                    target.closest('.mes_text') ||
                    isInsidePhone
                ) {
                    phoneTapCount = 0; // 打断连击
                    return;
                }

                const currentTime = new Date().getTime();
                const tapLength = currentTime - phoneLastTapTime;

                // 判断两次点击间隔是否小于 400 毫秒
                if (tapLength < 400 && tapLength > 0) {
                    phoneTapCount++;
                } else {
                    phoneTapCount = 1;
                }
                phoneLastTapTime = currentTime;

                // 触发三击
                if (phoneTapCount === 3) {
                    phoneTapCount = 0; // 重置连击
                    const drawerIcon = document.getElementById('phoneDrawerIcon');
                    const drawerPanel = document.getElementById('phone-panel');

                    // 🔥 核心修复：直接调用 toggleDrawer 函数，不再使用无效的 .click() 模拟
                    if (drawerIcon && drawerPanel) {
                        if (!drawerPanel.classList.contains('phone-panel-open') && !checkBetaLock()) return;
                        toggleDrawer(drawerIcon, drawerPanel);
                    }
                }
            });

            // 监听返回主页
            window.addEventListener('phone:goHome', () => {
                currentApp = null;
                window.currentWechatApp = null;
                if (homeScreen) homeScreen.render({ forceDomRefresh: true });
            });

            // 🔥 监听全局红点更新事件
            window.addEventListener('phone:updateGlobalBadge', () => {
                if (currentApps) {
                    totalNotifications = currentApps.reduce((sum, app) => sum + (app.badge || 0), 0);
                    updateNotificationBadge(totalNotifications);
                }
            });

            // 监听打开APP
            window.addEventListener('phone:openApp', (e) => {
                const { appId } = e.detail;
                currentApp = appId;

                const app = currentApps.find(a => a.id === appId);
                if (app) {
                    if (appId !== 'wechat') {
                        app.badge = 0;
                    }
                    totalNotifications = currentApps.reduce((sum, a) => sum + (a.badge || 0), 0);
                    updateNotificationBadge(totalNotifications);
                    saveData();
                }

                // 打开对应的APP
                if (appId === 'settings') {
                    // 🔥 按需加载设置模块
                    loadSettingsModule().then(SettingsAppClass => {
                        // 🔥 单例模式：只在第一次打开时创建实例
                        if (!window.VirtualPhone.settingsApp) {
                            window.VirtualPhone.settingsApp = new SettingsAppClass(phoneShell, storage, settings);
                        }
                        window.VirtualPhone.settingsApp.render();
                    });
                } else if (appId === 'wechat') {
                    import('./apps/wechat/wechat-app.js')
                        .then(module => {
                            try {
                                // 🔥 单例模式：只在第一次打开时创建微信实例，拒绝重复绑定事件
                                if (!window.VirtualPhone.wechatApp) {
                                    window.VirtualPhone.wechatApp = new module.WechatApp(phoneShell, storage);
                                }
                                // 🔥🔥🔥 核心修复：每次打开微信都要同步最新的数据实例，防止后台写入的消息丢失！🔥🔥🔥
                                // 不管 wechatApp 是否已存在，只要 cachedWechatData 存在，就必须同步过去
                                if (window.VirtualPhone.cachedWechatData) {
                                    window.VirtualPhone.wechatApp.wechatData = window.VirtualPhone.cachedWechatData;
                                }

                                const wechatApp = window.VirtualPhone.wechatApp;
                                window.currentWechatApp = wechatApp;

                                // 🔥 新增：加载待处理的联系人
                                const pendingContacts = storage.get('pending-contacts') || [];
                                if (pendingContacts.length > 0 && wechatApp.addContacts) {
                                    wechatApp.addContacts(pendingContacts);
                                    storage.set('pending-contacts', []); // 清空
                                }

                                wechatApp.render();

                            } catch (initError) {
                                console.error('❌ [调试] 创建/调用 WechatApp 失败:', initError);
                                phoneShell?.showNotification('错误', '微信初始化失败: ' + initError.message, '❌');
                            }
                        })
                        .catch(importError => {
                            console.error('❌ [调试] 导入 wechat-app.js 失败:', importError);
                            phoneShell?.showNotification('错误', '微信模块加载失败', '❌');
                        });
                } else if (appId === 'diary') {
                    import('./apps/diary/diary-app.js')
                        .then(module => {
                            try {
                                if (!window.VirtualPhone.diaryApp) {
                                    window.VirtualPhone.diaryApp = new module.DiaryApp(phoneShell, storage);
                                }
                                window.VirtualPhone.diaryApp.render();
                            } catch (initError) {
                                console.error('❌ [调试] 创建/调用 DiaryApp 失败:', initError);
                                phoneShell?.showNotification('错误', '日记初始化失败: ' + initError.message, '❌');
                            }
                        })
                        .catch(importError => {
                            console.error('❌ [调试] 导入 diary-app.js 失败:', importError);
                            phoneShell?.showNotification('错误', '日记模块加载失败', '❌');
                        });
                } else if (appId === 'phone') {
                    import('./apps/phone/phone-app.js')
                        .then(module => {
                            try {
                                if (!window.VirtualPhone.phoneApp) {
                                    window.VirtualPhone.phoneApp = new module.PhoneApp(phoneShell, storage);
                                }
                                window.VirtualPhone.phoneApp.render();
                            } catch (initError) {
                                console.error('❌ [调试] 创建/调用 PhoneApp 失败:', initError);
                                phoneShell?.showNotification('错误', '通话初始化失败: ' + initError.message, '❌');
                            }
                        })
                        .catch(importError => {
                            console.error('❌ [调试] 导入 phone-app.js 失败:', importError);
                            phoneShell?.showNotification('错误', '通话模块加载失败', '❌');
                        });
                } else if (appId === 'music') {
                    import('./apps/music/music-app.js')
                        .then(module => {
                            try {
                                // 检查是否已存在为悬浮窗创建的实例
                                if (window.VirtualPhone.musicApp) {
                                    // 把真实的 phoneShell 关联上
                                    window.VirtualPhone.musicApp.phoneShell = phoneShell;
                                } else {
                                    // 创建新实例
                                    window.VirtualPhone.musicApp = new module.MusicApp(phoneShell, storage);
                                }
                                window.VirtualPhone.musicApp.render();
                            } catch (initError) {
                                console.error('❌ [调试] 创建/调用 MusicApp 失败:', initError);
                                phoneShell?.showNotification('错误', '音乐初始化失败: ' + initError.message, '❌');
                            }
                        })
                        .catch(importError => {
                            console.error('❌ [调试] 导入 music-app.js 失败:', importError);
                            phoneShell?.showNotification('错误', '音乐模块加载失败', '❌');
                        });
                } else if (appId === 'weibo') {
                    import('./apps/weibo/weibo-app.js')
                        .then(module => {
                            try {
                                if (!window.VirtualPhone.weiboApp) {
                                    window.VirtualPhone.weiboApp = new module.WeiboApp(phoneShell, storage);
                                }
                                window.VirtualPhone.weiboApp.render();
                            } catch (initError) {
                                console.error('❌ 微博APP初始化失败:', initError);
                                phoneShell?.showNotification('错误', '微博加载失败', '❌');
                            }
                        })
                        .catch(importError => {
                            console.error('❌ 导入 weibo-app.js 失败:', importError);
                            phoneShell?.showNotification('错误', '微博模块加载失败', '❌');
                        });
                } else if (appId === 'honey') {
                    import('./apps/honey/honey-app.js')
                        .then(module => {
                            try {
                                if (!window.VirtualPhone.honeyApp) {
                                    window.VirtualPhone.honeyApp = new module.HoneyApp(phoneShell, storage);
                                }
                                window.VirtualPhone.honeyApp.render();
                            } catch (initError) {
                                console.error('❌ 蜜语APP初始化失败:', initError);
                                phoneShell?.showNotification('错误', '蜜语加载失败', '❌');
                            }
                        })
                        .catch(importError => {
                            console.error('❌ 导入 honey-app.js 失败:', importError);
                            phoneShell?.showNotification('错误', '蜜语模块加载失败', '❌');
                        });
                } else if (appId === 'mofo') {
                    import('./apps/mofo/mofo-app.js')
                        .then(module => {
                            try {
                                if (!window.VirtualPhone.mofoApp) {
                                    window.VirtualPhone.mofoApp = new module.MofoApp(phoneShell, storage);
                                }
                                if (window.VirtualPhone.cachedMofoData) {
                                    window.VirtualPhone.mofoApp.mofoData = window.VirtualPhone.cachedMofoData;
                                } else if (window.VirtualPhone.mofoApp?.mofoData) {
                                    window.VirtualPhone.cachedMofoData = window.VirtualPhone.mofoApp.mofoData;
                                }
                                window.VirtualPhone.mofoApp.render();
                            } catch (initError) {
                                console.error('❌ 魔坊APP初始化失败:', initError);
                                phoneShell?.showNotification('错误', '魔坊加载失败', '❌');
                            }
                        })
                        .catch(importError => {
                            console.error('❌ 导入 mofo-app.js 失败:', importError);
                            phoneShell?.showNotification('错误', '魔坊模块加载失败', '❌');
                        });
                } else {
                    phoneShell?.showNotification('APP', `${appId} 功能开发中...`, '🚧');
                }
            });

            // 监听从微信发送到聊天的消息
            window.addEventListener('phone:sendToChat', (e) => {
                const { message, chatId, chatName } = e.detail;

                const textarea = document.querySelector('#send_textarea');
                if (textarea) {
                    textarea.value = message;
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));

                    const sendButton = document.querySelector('#send_but');
                    if (sendButton && settings.autoSend) {
                        setTimeout(() => sendButton.click(), 100);
                    }
                } else {
                    console.warn('找不到聊天输入框');
                }
            });

            // 🔥 辅助函数：全局擦除聊天文件里的标签
            async function scrubTagsFromChatHistory(tagRegexList) {
                const context = getContext();
                if (!context || !context.chat) return;

                let modified = false;
                context.chat.forEach(msg => {
                    if (msg.is_user) return;
                    tagRegexList.forEach(regex => {
                        regex.lastIndex = 0;
                        if (msg.mes && regex.test(msg.mes)) {
                            regex.lastIndex = 0;
                            msg.mes = msg.mes.replace(regex, '').trim();
                            modified = true;
                        }
                        if (msg.swipes) {
                            msg.swipes.forEach((swipe, idx) => {
                                regex.lastIndex = 0;
                                if (swipe && regex.test(swipe)) {
                                    regex.lastIndex = 0;
                                    msg.swipes[idx] = swipe.replace(regex, '').trim();
                                    modified = true;
                                }
                            });
                        }
                    });
                });

                if (modified && typeof context.saveChat === 'function') {
                    await context.saveChat();
                    console.log('[ST-Phone] 全局清理：已成功从源文件中擦除冗余标签');
                }
            }

            // 监听清空数据
            window.addEventListener('phone:clearCurrentData', async () => { // 🔥 加上 async
                storage.clearCurrentData();
                currentApps = JSON.parse(JSON.stringify(APPS));
                totalNotifications = 0;
                updateNotificationBadge(0);
                // 清空内存缓存
                if (window.VirtualPhone) {
                    window.VirtualPhone.wechatApp = null;
                    window.VirtualPhone.cachedWechatData = null;
                    window.VirtualPhone.cachedMofoData = null;
                    if (window.VirtualPhone.diaryApp) window.VirtualPhone.diaryApp.clearCache();
                    if (window.VirtualPhone.phoneApp) window.VirtualPhone.phoneApp.clearCache();
                    if (window.VirtualPhone.weiboApp) window.VirtualPhone.weiboApp.clearCache();
                    if (window.VirtualPhone.mofoApp) {
                        window.VirtualPhone.mofoApp.clearCache();
                        window.VirtualPhone.mofoApp = null;
                    }
                    if (window.VirtualPhone.musicApp) {
                        window.VirtualPhone.musicApp.clearCache();
                        window.VirtualPhone.musicApp.view.destroyFloatingWidget();
                    }
                    if (window.VirtualPhone.honeyApp) {
                        try {
                            window.VirtualPhone.honeyApp.honeyData?.clearGeneratedSessionData?.();
                            window.VirtualPhone.honeyApp.honeyData?.saveRecommendTopics?.([]);
                            window.VirtualPhone.honeyApp.honeyData?.clearCache?.();
                        } catch (e) {
                            console.warn('[ST-Phone] 清理 Honey 缓存失败:', e);
                        }
                        window.VirtualPhone.honeyApp = null;
                    }
                }
                window.currentWechatApp = null;
                window.ggp_currentWechatApp = null;
                if (homeScreen) {
                    homeScreen.apps = currentApps;
                    homeScreen.render();
                }

                // 🔥 联动擦除聊天记录源文件中的标签
                await scrubTagsFromChatHistory([
                    /<Weibo>[\s\S]*?<\/Weibo>/gi,
                    /<Honey>[\s\S]*?<\/Honey>/gi
                ]);
            });

            window.addEventListener('phone:clearAllData', async () => { // 🔥 加上 async
                storage.clearAllData();
                currentApps = JSON.parse(JSON.stringify(APPS));
                totalNotifications = 0;
                updateNotificationBadge(0);
                // 清空所有内存缓存
                if (window.VirtualPhone) {
                    window.VirtualPhone.wechatApp = null;
                    window.VirtualPhone.cachedWechatData = null;
                    window.VirtualPhone.cachedMofoData = null;
                    window.VirtualPhone.imageManager = null;
                    if (window.VirtualPhone.diaryApp) window.VirtualPhone.diaryApp.clearCache();
                    if (window.VirtualPhone.phoneApp) window.VirtualPhone.phoneApp.clearCache();
                    if (window.VirtualPhone.weiboApp) {
                        window.VirtualPhone.weiboApp.clearCache();
                        window.VirtualPhone.weiboApp = null;
                    }
                    if (window.VirtualPhone.mofoApp) {
                        window.VirtualPhone.mofoApp.clearCache();
                        window.VirtualPhone.mofoApp = null;
                    }
                    if (window.VirtualPhone.musicApp) {
                        window.VirtualPhone.musicApp.clearCache();
                        window.VirtualPhone.musicApp.view.destroyFloatingWidget();
                        window.VirtualPhone.musicApp = null;
                    }
                    if (window.VirtualPhone.honeyApp) {
                        try {
                            window.VirtualPhone.honeyApp.honeyData?.clearGeneratedSessionData?.();
                            window.VirtualPhone.honeyApp.honeyData?.saveRecommendTopics?.([]);
                            window.VirtualPhone.honeyApp.honeyData?.clearCache?.();
                        } catch (e) {
                            console.warn('[ST-Phone] 清理 Honey 缓存失败:', e);
                        }
                        window.VirtualPhone.honeyApp = null;
                    }
                }
                window.currentWechatApp = null;
                window.ggp_currentWechatApp = null;
                if (homeScreen) {
                    homeScreen.apps = currentApps;
                    homeScreen.render();
                }

                // 🔥 联动擦除聊天记录源文件中的标签
                await scrubTagsFromChatHistory([
                    /<Weibo>[\s\S]*?<\/Weibo>/gi,
                    /<Honey>[\s\S]*?<\/Honey>/gi
                ]);
            });

            // 连接到酒馆
            const context = getContext();
            if (context && context.eventSource) {
                context.eventSource.on(
                    context.event_types.CHARACTER_MESSAGE_RENDERED,
                    onMessageReceived
                );

                if (context.event_types.USER_MESSAGE_RENDERED) {
                    context.eventSource.on(
                        context.event_types.USER_MESSAGE_RENDERED,
                        onMessageReceived
                    );
                }

                context.eventSource.on(
                    context.event_types.CHAT_CHANGED,
                    onChatChanged
                );

                // ⏪⏪⏪ 核心修复 1：监听滑动事件，斩杀废案，并完美防抢跑 ⏪⏪⏪
                if (context.event_types.MESSAGE_SWIPED) {
                    context.eventSource.on(context.event_types.MESSAGE_SWIPED, function (id) {
                        markForcedReplayFloor(id, 180000);
                        
                        // 第一步：雷霆手段！只要发生滑动，立刻、无条件斩杀当前楼层的旧微信数据！
                        try {
                            const wechatDataInstance = window.VirtualPhone?.wechatApp?.wechatData || window.VirtualPhone?.cachedWechatData;
                            let hasRolledBack = false;
                            if (wechatDataInstance && typeof wechatDataInstance.rollbackToFloor === 'function') {
                                hasRolledBack = wechatDataInstance.rollbackToFloor(id);
                            }
                            // 🔥 终极防闪退保护
                            if (hasRolledBack && window.currentWechatApp) {
                                const isCallOverlayVisible = !!document.querySelector('.call-fullscreen');
                                if (!isCallOverlayVisible) {
                                    setTimeout(() => window.currentWechatApp.render(), 10);
                                }
                            }
                        } catch(e) {}

                        // 第二步：智能防抢跑解析！
                        setTimeout(() => {
                            try {
                                // 🔥 终极修复：如果酒馆正在生成新消息，绝对不要在这里提前解析！
                                // 否则会提前读取到旧文本，导致立刻弹出旧气泡，且生成结束后被误判为历史重绘而不弹新气泡。
                                if (isTavernPrimaryGenerationBusy()) {
                                    console.log('🔄 [手机插件] 滑动触发了新生成，跳过提前解析，交由渲染完成事件处理');
                                    return; // 直接退出，等 AI 生成完毕后，酒馆的 CHARACTER_MESSAGE_RENDERED 事件会自动处理
                                }

                                // 只有在“非生成状态”（比如用户滑动查看以前已经生成好的分支）时，才重新解析当前分支
                                onMessageReceived(id);
                                
                                // 再次刷新界面，显示气泡
                                if (window.currentWechatApp) {
                                    setTimeout(() => window.currentWechatApp.render(), 50);
                                }
                            } catch(e) {
                                console.warn('[手机插件] 滑动解析失败:', e);
                            }
                        }, 150); 
                    });
                }

                // 🔥 监听编辑按钮点击，退出编辑后重新隐藏标签
                $(document).on('click', '.mes_edit_done, .mes_edit_cancel, .mes_edit_ok, .mes_edit_button', () => {
                    setTimeout(hidePhoneTags, 300);
                });

                // ⏪⏪⏪ 核心修复 3：直接监听"重新生成"按钮点击，瞬间回滚小手机数据 ⏪⏪⏪
                $(document).on('click', '[data-i18n="Regenerate"]', function () {
                    // 获取当前点击的重新生成按钮所在的楼层
                    const mesEl = $(this).closest('.mes');
                    if (mesEl.length > 0) {
                        const mesId = parseInt(mesEl.attr('mesid'), 10);
                        if (!isNaN(mesId)) {
                            markForcedReplayFloor(mesId, 180000);
                            setTimeout(() => {
                                try {
                                    const wechatDataInstance = window.VirtualPhone?.wechatApp?.wechatData || window.VirtualPhone?.cachedWechatData;
                                    if (wechatDataInstance && typeof wechatDataInstance.rollbackToFloor === 'function') {
                                        // 瞬间斩除废案数据
                                        const hasRolledBack = wechatDataInstance.rollbackToFloor(mesId);
                                        // 🔥 终极防闪退保护
                                        if (hasRolledBack && window.currentWechatApp) {
                                            const isCallOverlayVisible = !!document.querySelector('.call-fullscreen');
                                            if (!isCallOverlayVisible) {
                                                setTimeout(() => window.currentWechatApp.render(), 20);
                                            }
                                        }
                                    }
                                } catch(e) {}
                            }, 10); // 极小延迟确保 DOM 不阻塞
                        }
                    }
                });

                // 🟢🟢🟢 手机消息注入监听器 (升级现代 Hook，解决移动端时序丢失) 🟢🟢🟢
                // ========================================
                // 🔥 核心修复：加上 async 关键字，让它有能力等待异步加载
                phonePromptHandler = async (eventData) => {
                        // 🔥 强制等待核心管理器就绪 (防止由于休眠或点太快导致的 null)
                        if (!promptManager) await loadPromptManager();
                        if (!timeManager) await loadTimeManager();

                        // 🔥 终极护盾：专门为懒加载失败、页面休眠、提前退出准备的清洗器
                        const forceFallbackCleanup = (chatArray) => {
                            if (!Array.isArray(chatArray)) return;
                            const macros = ['{{PHONE_PROMPT}}', '{{PHONE_HISTORY}}', '{{WEIBO_HISTORY}}', '{{MUSIC_PROMPT}}', '{{MOFO_PROMPT}}', '{{DIARY_HISTORY}}'];
                            chatArray.forEach(msg => {
                                // 🌟 兼容移动端特殊请求体格式读取
                                let c = msg.content || msg.mes || (msg.parts && msg.parts[0] ? msg.parts[0].text : '') || '';
                                if (typeof c === 'string') {
                                    let modified = false;
                                    macros.forEach(macro => {
                                        if (c.includes(macro)) {
                                            c = c.split(macro).join('').trim();
                                            modified = true;
                                        }
                                    });
                                    // 兼容 {{ XXX }}（含空格）
                                    if (/\{\{\s*(MOFO_PROMPT|DIARY_HISTORY)\s*\}\}/i.test(c)) {
                                        c = c.replace(/\{\{\s*(MOFO_PROMPT|DIARY_HISTORY)\s*\}\}/gi, '').trim();
                                        modified = true;
                                    }
                                    if (modified) {
                                        // 🌟 兼容移动端特殊请求体格式写入
                                        if (msg.content !== undefined) msg.content = c;
                                        if (msg.mes !== undefined) msg.mes = c;
                                        if (msg.parts && msg.parts[0] !== undefined) msg.parts[0].text = c;
                                    }
                                }
                            });
                        };

                        // 🔥 第二层防线：全量捕获异常
                        try {
                            // 检查全局对象
                            if (!window.VirtualPhone || !window.VirtualPhone.storage) {
                                console.warn('⚠️ [手机插件] 全局对象未初始化，跳过注入');
                                forceFallbackCleanup(eventData.chat);
                                return;
                            }

                            // 🔥 核心修复 1：精准区分请求来源（防止异步后台任务误杀正文变量）
                            
                            // 1. 如果是手机内部独立API发起的请求（认准特定消息上的标记，绝不使用全局变量）
                            const lastMsg = eventData.chat[eventData.chat.length - 1];
                            if (lastMsg && lastMsg.isVirtualPhoneApiCall) {
                                forceFallbackCleanup(eventData.chat);
                                return; 
                            }

                            // 2. 如果是酒馆正文发起的请求（比如点击正文发送、重新生成、继续生成）
                            if (eventData.chat && Array.isArray(eventData.chat)) {
                                // 🧹 清理重绘缓存：
                                // 如果是重新生成，数组里可能残留着上一次插件注入的 system 提示块。
                                // 我们必须先砍掉旧的，后面才会重新注入带有最新数据的块。
                                for (let i = eventData.chat.length - 1; i >= 0; i--) {
                                    const msg = eventData.chat[i];
                                    // 🔥 修复：去掉 role === 'system' 的限制，兼容 Gemini 的 user 伪装注入
                                    if (msg.isPhoneMessage && msg.identifier) {
                                        eventData.chat.splice(i, 1);
                                    }
                                }
                            }
                            // 注意：此处不写 return！让代码继续往下跑后面的“收集数据”和“替换变量”逻辑。
                            if (eventData.prompt && Array.isArray(eventData.prompt)) {
                                for (let i = eventData.prompt.length - 1; i >= 0; i--) {
                                    const msg = eventData.prompt[i];
                                    if (msg.isPhoneMessage && msg.role === 'system' && msg.identifier) {
                                        eventData.prompt.splice(i, 1);
                                    }
                                }
                            }

                            // 📱 收集手机活动记录
                            const wechatOfflineChats = [];
                            const storage = window.VirtualPhone.storage;
                            const isPhoneEnabled = isPhoneFeatureEnabled();
                            const wechatOnlineRaw = storage ? storage.get('wechat_online_mode') : false;
                            const isWechatOnlineEnabled = (
                                wechatOnlineRaw === true ||
                                wechatOnlineRaw === 'true' ||
                                wechatOnlineRaw === 1
                            );

                            // 🔥 手机休眠或功能关闭时：不注入任何手机上下文，但必须强制清洗掉占位符！
                            if (!isPhoneEnabled) {
                                forceFallbackCleanup(eventData.chat);
                                return;
                            }

                            // ⏪⏪⏪ 核心修复 2：发送给AI之前，彻底斩断幽灵数据（完美兼容重新生成与滑动）！ ⏪⏪⏪
                            // 🔥 终极数学判定法：
                            // 无论是正常发送、重新生成(Regenerate)还是滑动(Swipe)。
                            // 当准备发送给AI时，ctx.chat 就是要发给大模型的上下文。
                            // ctx.chat.length 就是即将生成的新消息的楼层索引！
                            // 我们只需无脑斩断 >= ctx.chat.length 的所有微信数据，即可完美防止废案污染上下文！
                            try {
                                const ctx = getContext();
                                if (ctx && ctx.chat) {
                                    const targetFloor = ctx.chat.length;

                                    const wechatDataInstance = window.VirtualPhone?.wechatApp?.wechatData || window.VirtualPhone?.cachedWechatData;
                                    if (wechatDataInstance && typeof wechatDataInstance.rollbackToFloor === 'function') {
                                        // 物理抹除：以真实的酒馆将要生成的楼层为准，彻底斩除未来废案！
                                        const hasRolledBack = wechatDataInstance.rollbackToFloor(targetFloor);

                                        // 🔥 终极防闪退保护：只有真正删除了废案，并且【当前屏幕上没有通话弹窗】时，才允许刷新界面！
                                        if (hasRolledBack && window.currentWechatApp) {
                                            const isCallOverlayVisible = !!document.querySelector('.call-fullscreen');
                                            if (!isCallOverlayVisible) {
                                                setTimeout(() => window.currentWechatApp.render(), 50);
                                            } else {
                                                console.log('📞 [手机防闪退] 拦截了一次会导致通话界面消失的全局渲染');
                                            }
                                        }
                                    }
                                }
                            } catch(e) {
                                console.warn('[手机插件] 幽灵数据斩断保护异常:', e);
                            }

                            // 🔥 核心修改：仅在微信在线模式开启时，才收集并注入微信线下上下文
                            if (storage && isPhoneEnabled && isWechatOnlineEnabled) {
                                try {
                                    // 🔥 性能优化：优先从内存中读取已有的 wechatApp 实例，避免全量 JSON.parse
                                    let wechatDataParsed = null;
                                    const wechatDataInstance =
                                        window.VirtualPhone?.wechatApp?.wechatData ||
                                        window.VirtualPhone?.cachedWechatData ||
                                        window.ggp_currentWechatApp?.wechatData ||
                                        null;

                                    // 方式1：从已打开的微信APP读取（最快）
                                    if (wechatDataInstance?.data) {
                                        wechatDataParsed = wechatDataInstance.data;
                                    }
                                    // 方式2：最后才从 storage 读取（最慢，需要 JSON.parse）
                                    else {
                                        const savedData = storage.get('wechat_data', false);
                                        if (savedData) {
                                            wechatDataParsed = typeof savedData === 'string' ? JSON.parse(savedData) : savedData;
                                        }
                                    }

                                    if (wechatDataParsed) {
                                        const allChats = Array.isArray(wechatDataParsed.chats)
                                            ? [...wechatDataParsed.chats].sort((a, b) => (a?.timestamp || 0) - (b?.timestamp || 0))
                                            : [];

                                        // 🔥 性能优化：在循环外获取context和limit配置，避免重复调用
                                        const ctx = getContext();
                                        const userName = ctx?.name1 || '用户';
                                        const singleLimit = parseInt(storage.get('offline-single-chat-limit')) || 5;
                                        const groupLimit = parseInt(storage.get('offline-group-chat-limit')) || 10;
                                        const includeHoneyOfflineRaw = storage.get('offline-honey-chat-enabled');
                                        const includeHoneyOffline = !(
                                            includeHoneyOfflineRaw === false ||
                                            includeHoneyOfflineRaw === 'false' ||
                                            includeHoneyOfflineRaw === 0 ||
                                            includeHoneyOfflineRaw === '0'
                                        );
                                        const contacts = Array.isArray(wechatDataParsed.contacts) ? wechatDataParsed.contacts : [];
                                        const customEmojis = Array.isArray(wechatDataParsed.customEmojis) ? wechatDataParsed.customEmojis : [];
                                        const contactMap = new Map(
                                            contacts
                                                .filter(contact => contact?.id)
                                                .map(contact => [String(contact.id), contact])
                                        );
                                        const normalizeCustomEmojiImageKey = (value) => {
                                            const raw = String(value || '').trim();
                                            if (!raw) return '';
                                            try {
                                                const parsed = new URL(raw, window.location?.origin || 'http://localhost');
                                                return `${parsed.origin}${parsed.pathname}`.toLowerCase();
                                            } catch (e) {
                                                return raw.replace(/\\/g, '/').toLowerCase();
                                            }
                                        };
                                        const customEmojiByImage = new Map(
                                            customEmojis
                                                .filter(item => item?.image)
                                                .map(item => [
                                                    normalizeCustomEmojiImageKey(item.image),
                                                    String(item.description || item.name || '').trim()
                                                ])
                                                .filter(([key, description]) => key && description)
                                        );
                                        const parseDateTimeToTs = (dateText, timeText) => {
                                            const dateRaw = String(dateText || '').trim();
                                            const timeRaw = String(timeText || '').trim().replace('：', ':');
                                            if (!dateRaw || !timeRaw) return NaN;
                                            const dateMatch = dateRaw.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
                                            const timeMatch = timeRaw.match(/(\d{1,2}):(\d{2})/);
                                            if (!dateMatch || !timeMatch) return NaN;
                                            const year = Number(dateMatch[1]);
                                            const month = Number(dateMatch[2]);
                                            const day = Number(dateMatch[3]);
                                            const hour = Number(timeMatch[1]);
                                            const minute = Number(timeMatch[2]);
                                            if (![year, month, day, hour, minute].every(Number.isFinite)) return NaN;
                                            return new Date(year, month - 1, day, hour, minute).getTime();
                                        };
                                        const getMessageSortTs = (msg, fallbackIndex) => {
                                            const directTs = Number(msg?.timestamp || 0);
                                            if (Number.isFinite(directTs) && directTs > 0) return directTs;
                                            const fallbackTs = parseDateTimeToTs(msg?.date, msg?.time);
                                            if (Number.isFinite(fallbackTs) && fallbackTs > 0) return fallbackTs;
                                            return Number(fallbackIndex) || 0;
                                        };

                                        // 🔥 线下模式：使用线下专属的条数限制
                                        allChats.forEach(chat => {
                                            const linkedContact = chat?.contactId
                                                ? contactMap.get(String(chat.contactId))
                                                : null;
                                            const isHoneyChat = chat?.sourceApp === 'honey' ||
                                                chat?.sourceLabel === '蜜语' ||
                                                linkedContact?.sourceApp === 'honey' ||
                                                linkedContact?.sourceLabel === '蜜语';
                                            if (!includeHoneyOffline && isHoneyChat) {
                                                return;
                                            }

                                            let chatMessages = [];

                                            // 方式1：优先走 WechatData.getMessages（兼容懒加载与独立存储）
                                            if (wechatDataInstance && typeof wechatDataInstance.getMessages === 'function') {
                                                try {
                                                    chatMessages = wechatDataInstance.getMessages(chat.id) || [];
                                                } catch (e) {
                                                    chatMessages = [];
                                                }
                                            }

                                            // 方式2：兼容旧格式，消息仍在 wechat_data.messages 中
                                            if ((!chatMessages || chatMessages.length === 0) && wechatDataParsed?.messages?.[chat.id]) {
                                                chatMessages = wechatDataParsed.messages[chat.id] || [];
                                            }

                                            // 方式3：兼容新格式，消息存储在独立键 wechat_msg_${chatId}
                                            if (!chatMessages || chatMessages.length === 0) {
                                                const msgRaw = storage.get(`wechat_msg_${chat.id}`, false);
                                                if (Array.isArray(msgRaw)) {
                                                    chatMessages = msgRaw;
                                                } else if (typeof msgRaw === 'string' && msgRaw.trim() !== '') {
                                                    try {
                                                        chatMessages = JSON.parse(msgRaw);
                                                    } catch (e) {
                                                        chatMessages = [];
                                                    }
                                                }
                                            }

                                            if (chatMessages && chatMessages.length > 0) {
                                                const isGroup = chat.type === 'group';
                                                const limit = isGroup ? groupLimit : singleLimit;
                                                const recentMessages = [...chatMessages]
                                                    .map((msg, index) => ({
                                                        msg,
                                                        index,
                                                        sortTs: getMessageSortTs(msg, index)
                                                    }))
                                                    .sort((a, b) => {
                                                        if (a.sortTs !== b.sortTs) return a.sortTs - b.sortTs;
                                                        return a.index - b.index;
                                                    })
                                                    .slice(-limit)
                                                    .map(entry => entry.msg);
                                                const formattedMessages = [];

                                                recentMessages.forEach(msg => {
                                                    // 🔥 修复：群聊发送者名称判断
                                                    let speaker = chat.name;
                                                    if (msg.from === 'me') {
                                                        speaker = userName;
                                                    } else if (chat.type === 'group' && msg.from && msg.from !== 'system') {
                                                        // 群聊且非自己发送时，使用实际的发送者名字，而不是群名
                                                        speaker = msg.from;
                                                    }

                                                    let content = msg.content || '[未知消息]';

                                                    // 🔥 修复：去除消息内容开头的 "发送者: " 或 "发送者：" 前缀
                                                    // 使用准确的 speaker 进行匹配，而不是 chat.name
                                                    if (msg.from !== 'me') {
                                                        if (content.startsWith(speaker + ':')) {
                                                            content = content.substring(speaker.length + 1).trim();
                                                        } else if (content.startsWith(speaker + '：')) {
                                                            content = content.substring(speaker.length + 1).trim();
                                                        }
                                                        // 兼容：也检查 chat.name 前缀（防止旧数据）
                                                        if (content.startsWith(chat.name + ':')) {
                                                            content = content.substring(chat.name.length + 1).trim();
                                                        } else if (content.startsWith(chat.name + '：')) {
                                                            content = content.substring(chat.name.length + 1).trim();
                                                        }
                                                    }

                                                    if (msg.type === 'image') {
                                                        // 线下主聊天注入走 system 文本，Markdown 图片常被当普通文本忽略
                                                        // 这里改为显式文本标记，确保“发过图”信息稳定进入上下文
                                                        const imgUrl = String(msg.content || '').trim();
                                                        const customEmojiDescription = String(
                                                            msg.customEmojiDescription ||
                                                            msg.customEmojiName ||
                                                            customEmojiByImage.get(normalizeCustomEmojiImageKey(imgUrl)) ||
                                                            ''
                                                        ).trim();
                                                        content = customEmojiDescription
                                                            ? `[表情包]（${customEmojiDescription}）`
                                                            : (imgUrl ? `[发送了图片] 图片地址: ${imgUrl}` : '[发送了图片]');
                                                    } else if (msg.type === 'weibo_card') {
                                                        // 微博转发卡片：直接使用完整content（含正文+评论）
                                                        content = msg.content || '[微博分享]';
                                                    } else if (msg.type === 'call_record') {
                                                        const callTypeName = msg.callType === 'video' ? '视频' : '语音';
                                                        const callStatusText = msg.status === 'answered'
                                                            ? `通话时长 ${msg.duration || '未知'}`
                                                            : (msg.status === 'rejected' || msg.status === 'declined')
                                                                ? '对方已拒绝'
                                                                : msg.status === 'cancelled'
                                                                    ? '已取消'
                                                                    : '未接听';
                                                        const callSummary = `[${callTypeName}通话 ${callStatusText}]`;
                                                        formattedMessages.push({
                                                            speaker,
                                                            content: callSummary,
                                                            time: msg.time,
                                                            date: msg.date || ''
                                                        });

                                                        if (msg.status === 'answered' && Array.isArray(msg.transcript) && msg.transcript.length > 0) {
                                                            const parseDurationToSeconds = (durationValue) => {
                                                                const raw = String(durationValue || '').trim();
                                                                if (!raw) return 0;
                                                                if (/^\d+$/.test(raw)) return Number(raw);

                                                                const colonMatch = raw.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
                                                                if (colonMatch) {
                                                                    if (typeof colonMatch[3] !== 'undefined') {
                                                                        return (Number(colonMatch[1]) * 3600) + (Number(colonMatch[2]) * 60) + Number(colonMatch[3]);
                                                                    }
                                                                    return (Number(colonMatch[1]) * 60) + Number(colonMatch[2]);
                                                                }

                                                                const hourMatch = raw.match(/(\d+)\s*小时/);
                                                                const minuteMatch = raw.match(/(\d+)\s*分/);
                                                                const secondMatch = raw.match(/(\d+)\s*秒/);
                                                                if (hourMatch || minuteMatch || secondMatch) {
                                                                    const hours = Number(hourMatch?.[1] || 0);
                                                                    const minutes = Number(minuteMatch?.[1] || 0);
                                                                    const seconds = Number(secondMatch?.[1] || 0);
                                                                    return (hours * 3600) + (minutes * 60) + seconds;
                                                                }

                                                                return 0;
                                                            };
                                                            const formatDateText = (dateObj) => `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
                                                            const formatTimeText = (dateObj) => `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;

                                                            const transcriptItems = msg.transcript.filter(item => String(item?.text || '').trim());
                                                            const transcriptCount = transcriptItems.length;
                                                            const callEndTs = parseDateTimeToTs(msg?.date, msg?.time);
                                                            const durationSeconds = parseDurationToSeconds(msg?.duration);
                                                            const durationMs = Math.max(0, durationSeconds * 1000);
                                                            const minStepMs = 60 * 1000;
                                                            const hasValidTimeline = Number.isFinite(callEndTs) && callEndTs > 0 && transcriptCount > 0;
                                                            const callStartTs = hasValidTimeline ? Math.max(0, callEndTs - durationMs) : NaN;

                                                            transcriptItems.forEach((item, idx) => {
                                                                const lineText = String(item?.text || '').trim();
                                                                const lineSpeakerRaw = String(item?.from || '').trim();
                                                                const lineSpeaker = lineSpeakerRaw === 'me'
                                                                    ? userName
                                                                    : (lineSpeakerRaw || (isGroup ? '群成员' : chat.name));
                                                                let lineDate = msg.date || '';
                                                                let lineTime = msg.time;

                                                                if (hasValidTimeline) {
                                                                    let lineTs = callEndTs;
                                                                    if (transcriptCount === 1) {
                                                                        lineTs = durationMs > 0 ? callStartTs : callEndTs;
                                                                    } else {
                                                                        const minWindowMs = (transcriptCount - 1) * minStepMs;
                                                                        if (durationMs >= minWindowMs && durationMs > 0) {
                                                                            const stepMs = durationMs / (transcriptCount - 1);
                                                                            lineTs = callStartTs + Math.round(stepMs * idx);
                                                                        } else {
                                                                            // 时长过短会导致显示同一分钟，这里按分钟阶梯向前展开，避免线下注入全部同一时间
                                                                            lineTs = callEndTs - ((transcriptCount - 1 - idx) * minStepMs);
                                                                        }
                                                                    }
                                                                    const lineDateObj = new Date(lineTs);
                                                                    if (!Number.isNaN(lineDateObj.getTime())) {
                                                                        lineDate = formatDateText(lineDateObj);
                                                                        lineTime = formatTimeText(lineDateObj);
                                                                    }
                                                                }
                                                                formattedMessages.push({
                                                                    speaker: lineSpeaker,
                                                                    content: `[通话] ${lineText}`,
                                                                    time: lineTime,
                                                                    date: lineDate
                                                                });
                                                            });
                                                        }
                                                        return;
                                                    } else if (msg.type !== 'text') {
                                                        const typeMap = {
                                                            'image_prompt': `[图片]（${String(msg.imagePrompt || msg.content || '待生成图片').trim()}）`,
                                                            'voice': `[语音 ${msg.duration || '3秒'}]`,
                                                            'video': '[视频通话]',
                                                            'transfer': `[转账 ¥${msg.amount}]`,
                                                            'redpacket': `[红包 ¥${msg.amount}]`
                                                        };
                                                        content = typeMap[msg.type] || `[${msg.type}]`;
                                                    }

                                                    formattedMessages.push({
                                                        speaker,
                                                        content,
                                                        time: msg.time,
                                                        date: msg.date || ''
                                                    });
                                                });

                                                if (formattedMessages.length > 0) {
                                                    wechatOfflineChats.push({
                                                        chatId: chat.id,
                                                        chatName: chat.name,
                                                        messages: formattedMessages
                                                    });
                                                }
                                            }
                                        });
                                    }
                                } catch (e) {
                                    console.error('❌ 读取微信数据失败:', e);
                                }
                            }

                            // 📱 注入手机消息块（🔥 修改：只要手机功能启用就注入）
                            if (wechatOfflineChats.length > 0 || isPhoneEnabled) {
                                const messages = eventData.chat;

                                if (messages && Array.isArray(messages)) {
                                    // 🔥 获取当前剧情时间
                                    let latestPhoneTime = '未知';
                                    let latestPhoneDate = '未知';
                                    let timeIsUncertain = false; // 标记：时间是否不确定（首次消息、无历史记录）

                                    const timeManager = window.VirtualPhone?.timeManager;
                                    if (timeManager) {
                                        try {
                                            const currentTime = timeManager.getCurrentStoryTime();
                                            // 如果返回的是默认时间或现实时间（无法确定剧情时间），标记为不确定
                                            if (currentTime.isDefault || currentTime.isReal) {
                                                timeIsUncertain = true;
                                                latestPhoneTime = '（请根据角色设定和故事背景自行确定当前时间）';
                                                latestPhoneDate = '（请根据角色设定和故事背景自行确定当前日期）';
                                            } else {
                                                latestPhoneTime = currentTime.time || '21:30';
                                                latestPhoneDate = currentTime.date || '2044年09月05日';
                                            }
                                        } catch (e) {
                                            latestPhoneTime = '21:30';
                                            latestPhoneDate = '2044年09月05日';
                                        }
                                    }

                                    // 🔥🔥🔥 核心修改：把所有手机内容合并成一条消息，避免与记忆插件冲突 🔥🔥🔥
                                    // SillyTavern 会合并相邻的 system 消息，所以我们主动合并，确保格式清晰

                                    // 将规则与聊天记录分离为多个变量
                                    let phoneRulesContent = '';
                                    let phoneHistoryContent = '';
                                    let weiboHistoryContent = '';
                                    let mofoPromptContent = '';
                                    let diaryHistoryContent = '';
                                    let weiboInjectEnabled = false;

                                    // 🔥 确保 promptManager 已加载（修复懒加载导致的 null 问题）
                                    if (promptManager && !promptManager._loaded) {
                                        promptManager.ensureLoaded();
                                    }

                                    // 1️⃣ 添加手机核心提示词（如果启用）
                                    if (promptManager?.prompts?.core?.enabled) {
                                        try {
                                            const corePrompt = promptManager.getPromptForFeature('core');
                                            if (corePrompt) {
                                                phoneRulesContent += `【手机系统】\n${corePrompt}\n\n`;
                                            }
                                        } catch (e) {
                                            console.warn('⚠️ [手机] 获取核心提示词失败');
                                        }
                                    }

                                    // 2️⃣ 添加微信线下模式提示词（如果启用且在线模式开启）
                                    if (isWechatOnlineEnabled && promptManager?.getPromptForFeature) {
                                        try {
                                            let wechatPrompt = promptManager.getPromptForFeature('wechat', 'offline');
                                            if (wechatPrompt) {
                                                // 替换时间占位符
                                                const nextMinute = timeIsUncertain
                                                    ? latestPhoneTime
                                                    : calculateNextMinute(latestPhoneTime);

                                                // 🔥 获取微信好友和群聊名称列表
                                                let wechatContactsList = '';
                                                try {
                                                    let wechatDataParsed = null;
                                                    if (window.VirtualPhone?.wechatApp?.wechatData?.data) {
                                                        wechatDataParsed = window.VirtualPhone.wechatApp.wechatData.data;
                                                    } else if (window.VirtualPhone?.cachedWechatData?.data) {
                                                        wechatDataParsed = window.VirtualPhone.cachedWechatData.data;
                                                    } else {
                                                        const savedData = storage.get('wechat_data', false);
                                                        if (savedData) {
                                                            wechatDataParsed = typeof savedData === 'string' ? JSON.parse(savedData) : savedData;
                                                        }
                                                    }

                                                    if (wechatDataParsed) {
                                                        const contactNames = [];
                                                        const groupNames = [];
                                                        const contacts = wechatDataParsed.contacts || [];
                                                        contacts.forEach(c => { if (c.name) contactNames.push(c.name); });
                                                        const chats = wechatDataParsed.chats || [];
                                                        chats.forEach(chat => {
                                                            if (chat.type === 'group' && chat.name) groupNames.push(chat.name);
                                                        });
                                                        const parts = [];
                                                        if (contactNames.length > 0) parts.push(`好友：${contactNames.join('、')}`);
                                                        if (groupNames.length > 0) parts.push(`群聊：${groupNames.join('、')}`);
                                                        wechatContactsList = parts.join('；') || '暂无联系人';
                                                    } else {
                                                        wechatContactsList = '暂无联系人';
                                                    }
                                                } catch (e) {
                                                    console.warn('⚠️ 获取微信联系人列表失败:', e);
                                                    wechatContactsList = '暂无联系人';
                                                }

                                                wechatPrompt = wechatPrompt
                                                    .replace(/当前剧情时间/g, '当前手机时间')
                                                    .replace(/\{\{STORY_TIME\}\}/g, latestPhoneTime)
                                                    .replace(/\{\{STORY_DATE\}\}/g, latestPhoneDate)
                                                    .replace(/\{\{STORY_TIME\+1\}\}/g, nextMinute)
                                                    .replace(/\{\{wechatContacts\}\}/g, wechatContactsList);
                                                phoneRulesContent += `【微信线下模式】\n${wechatPrompt}\n\n`;
                                            }
                                        } catch (e) {
                                            console.warn('⚠️ [手机] 获取微信线下提示词失败');
                                        }
                                    }

                                    // 2.5️⃣ 魔坊线下提示词注入（按条目勾选过滤）
                                    try {
                                        mofoPromptContent = await buildMofoOfflinePromptContent();
                                    } catch (e) {
                                        mofoPromptContent = '';
                                        console.warn('⚠️ [手机] 获取魔坊线下提示词失败');
                                    }

                                    // 2.6️⃣ 日记线下变量注入（隐藏日记不注入）
                                    try {
                                        const diaryInjectEnabledRaw = storage?.get('offline-diary-history-enabled');
                                        const diaryInjectEnabled = !(
                                            diaryInjectEnabledRaw === false ||
                                            diaryInjectEnabledRaw === 'false' ||
                                            diaryInjectEnabledRaw === 0 ||
                                            diaryInjectEnabledRaw === '0'
                                        );
                                        if (diaryInjectEnabled) {
                                            let diaryData = window.VirtualPhone?.diaryApp?.diaryData || null;
                                            if (!diaryData) {
                                                const diaryModule = await import('./apps/diary/diary-data.js');
                                                diaryData = new diaryModule.DiaryData(storage);
                                            }
                                            diaryHistoryContent = diaryData?.buildOfflineInjectionContent?.() || '';
                                        } else {
                                            diaryHistoryContent = '';
                                        }
                                    } catch (e) {
                                        diaryHistoryContent = '';
                                        console.warn('⚠️ [手机] 注入日记记录失败:', e);
                                    }

                                    // 3️⃣ 添加微信聊天记录（按会话窗口分组显示，含日期）
                                    if (isWechatOnlineEnabled && wechatOfflineChats.length > 0) {
                                        phoneHistoryContent += `【手机微信已有消息】\n`;
                                        phoneHistoryContent += `以下是用户手机已经存在的微信消息记录。使用微信时，请严格遵守【微信线下模式】的全部规则，不得重复生成以下已经存在的历史微信消息记录。\n\n`;

                                        wechatOfflineChats.forEach(chatHistory => {
                                            phoneHistoryContent += `━━━ ${chatHistory.chatName} 的聊天记录 ━━━\n`;
                                            let lastDate = '';
                                            chatHistory.messages.forEach(msg => {
                                                if (msg.date && msg.date !== lastDate) {
                                                    phoneHistoryContent += `--- ${msg.date} ---\n`;
                                                    lastDate = msg.date;
                                                }
                                                phoneHistoryContent += `[${msg.time}] ${msg.speaker}: ${msg.content}\n`;
                                            });
                                            phoneHistoryContent += `\n`;
                                        });

                                        phoneHistoryContent += `⚠️ 规则：\n- 新微信消息的时间必须在【正文时间】和【手机最新消息时间】两者中取较晚的，再往后递增\n- 禁止重复发送上文已有的消息内容\n- 禁止替{{user}}回复任何内容\n\n`;
                                    }

                                    // 3.5️⃣ 添加通话记录
                                    try {
                                        let callHistory = null;
                                        if (window.VirtualPhone?.phoneApp?.phoneCallData) {
                                            callHistory = window.VirtualPhone.phoneApp.phoneCallData.getCallHistory();
                                        } else {
                                            const savedCallHistory = storage?.get('phone_call_history', null);
                                            if (savedCallHistory) {
                                                callHistory = typeof savedCallHistory === 'string' ? JSON.parse(savedCallHistory) : savedCallHistory;
                                            }
                                        }

                                        if (callHistory && callHistory.length > 0) {
                                            const callLimit = storage ? (parseInt(storage.get('phone-call-limit')) || 10) : 10;
                                            const userName = context?.name1 || '用户';
                                            const parseCallDateTimeToTs = (dateText, timeText) => {
                                                const dateRaw = String(dateText || '').trim();
                                                const timeRaw = String(timeText || '').trim().replace('：', ':');
                                                if (!dateRaw || !timeRaw) return NaN;
                                                const dateMatch = dateRaw.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
                                                const timeMatch = timeRaw.match(/(\d{1,2}):(\d{2})/);
                                                if (!dateMatch || !timeMatch) return NaN;
                                                const year = Number(dateMatch[1]);
                                                const month = Number(dateMatch[2]);
                                                const day = Number(dateMatch[3]);
                                                const hour = Number(timeMatch[1]);
                                                const minute = Number(timeMatch[2]);
                                                if (![year, month, day, hour, minute].every(Number.isFinite)) return NaN;
                                                return new Date(year, month - 1, day, hour, minute).getTime();
                                            };
                                            const parseCallSortTs = (record, fallbackIndex) => {
                                                const idTs = Number(record?.id || 0);
                                                if (Number.isFinite(idTs) && idTs > 0) return idTs;
                                                const fallbackTs = parseCallDateTimeToTs(record?.date, record?.time);
                                                if (Number.isFinite(fallbackTs) && fallbackTs > 0) return fallbackTs;
                                                return Number(fallbackIndex) || 0;
                                            };
                                            const answeredCalls = callHistory
                                                .map((record, index) => ({ record, index, sortTs: parseCallSortTs(record, index) }))
                                                .filter(item => item.record?.status === 'answered' && item.record?.transcript && item.record.transcript.length > 0)
                                                .sort((a, b) => {
                                                    if (a.sortTs !== b.sortTs) return a.sortTs - b.sortTs;
                                                    return a.index - b.index;
                                                })
                                                .map(item => item.record);

                                            if (answeredCalls.length > 0) {
                                                phoneHistoryContent += `【 手机通话记录】\n`;
                                                answeredCalls.forEach(record => {
                                                    const recentTranscript = record.transcript.slice(-callLimit);
                                                    phoneHistoryContent += `━━━ 与 ${record.caller} 的通话 ━━━\n`;
                                                    if (record.date || record.time) phoneHistoryContent += `${record.date || ''} ${record.time || ''}\n`;
                                                    recentTranscript.forEach(msg => {
                                                        const speaker = msg.from === 'me' ? userName : record.caller;
                                                        phoneHistoryContent += `${speaker}: ${msg.text}\n`;
                                                    });
                                                    phoneHistoryContent += `\n`;
                                                });
                                            }
                                        }
                                    } catch (e) {
                                        console.warn('⚠️ [手机] 注入通话记录失败:', e);
                                    }

                                    // 3.6️⃣ 添加微博记录（可选：支持变量 {{WEIBO_HISTORY}} 控制注入位置）
                                    try {
                                        const weiboInjectEnabledRaw = storage?.get('offline-weibo-history-enabled');
                                        weiboInjectEnabled = weiboInjectEnabledRaw === true || weiboInjectEnabledRaw === 'true' || weiboInjectEnabledRaw === 1;

                                        if (weiboInjectEnabled) {
                                            const weiboLimitRaw = parseInt(storage?.get('offline-weibo-history-limit'));
                                            const weiboLimit = Math.max(1, Math.min(50, Number.isFinite(weiboLimitRaw) ? weiboLimitRaw : 5));

                                            let userPostsList = [];
                                            let hotSearches = [];

                                            const weiboData = window.VirtualPhone?.weiboApp?.weiboData;
                                            const parseMaybeArray = (raw) => {
                                                if (!raw) return [];
                                                if (Array.isArray(raw)) return raw;
                                                if (typeof raw === 'string') {
                                                    try {
                                                        const parsed = JSON.parse(raw);
                                                        return Array.isArray(parsed) ? parsed : [];
                                                    } catch (e) {
                                                        return [];
                                                    }
                                                }
                                                return [];
                                            };

                                            if (weiboData) {
                                                // 精准读取专属的 UserPosts 池子
                                                userPostsList = parseMaybeArray(weiboData.getUserPosts?.());
                                                hotSearches = parseMaybeArray(weiboData.getHotSearches?.());
                                            } else {
                                                userPostsList = parseMaybeArray(storage?.get('weibo_user_posts'));
                                                hotSearches = parseMaybeArray(storage?.get('weibo_hot_searches'));
                                            }

                                            const cleanText = (text, maxLen = 220) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
                                            const formatWeiboMediaForOfflineContext = (rawMedia) => {
                                                const mediaText = String(rawMedia || '').replace(/\s+/g, ' ').trim();
                                                if (!mediaText) return '';

                                                const buildTaggedDesc = (type, desc) => {
                                                    const cleanDesc = cleanText(desc, 120);
                                                    return cleanDesc ? `[${type}](${cleanDesc})` : `[${type}](未提供描述)`;
                                                };

                                                // 支持格式：[图片]（描述）/[图片](描述)/[视频]（描述）/[视频](描述)
                                                const taggedWithDesc = mediaText.match(/^\[(图片|视频)\]\s*[（(]\s*([^)）]+?)\s*[)）]\s*$/);
                                                if (taggedWithDesc) {
                                                    const mediaType = taggedWithDesc[1];
                                                    const mediaDesc = cleanText(taggedWithDesc[2], 120);
                                                    if (/^(data:image\/|https?:\/\/|\/)/i.test(mediaDesc)) {
                                                        return `[${mediaType}](用户上传文件)`;
                                                    }
                                                    return buildTaggedDesc(mediaType, mediaDesc);
                                                }

                                                // 兼容异常格式：[图片]https://... / [视频]/path/to/file
                                                const taggedLoose = mediaText.match(/^\[(图片|视频)\]\s*(.+)\s*$/);
                                                if (taggedLoose) {
                                                    const mediaType = taggedLoose[1];
                                                    let looseDesc = String(taggedLoose[2] || '').trim();
                                                    // 清理重复前缀，避免出现 [图片][图片]https://... 这类脏数据
                                                    looseDesc = looseDesc.replace(/^(?:\[(?:图片|视频)\]\s*)+/, '').trim();
                                                    // 清理一层包裹括号
                                                    const wrapped = looseDesc.match(/^[（(]\s*([^)）]+?)\s*[)）]$/);
                                                    if (wrapped) looseDesc = String(wrapped[1] || '').trim();

                                                    if (/^(data:image\/|https?:\/\/|\/)/i.test(looseDesc)) {
                                                        return `[${mediaType}](用户上传文件)`;
                                                    }
                                                    return buildTaggedDesc(mediaType, looseDesc || '未提供描述');
                                                }

                                                // 兼容只有标签无描述（如 [图片]）
                                                const taggedOnly = mediaText.match(/^\[(图片|视频)\]\s*$/);
                                                if (taggedOnly) {
                                                    return `[${taggedOnly[1]}](未提供描述)`;
                                                }

                                                // URL/base64 等真实文件路径，给线下上下文做轻量提示，避免塞入长 URL 污染上下文
                                                if (/^(data:image\/|https?:\/\/|\/)/i.test(mediaText)) {
                                                    const looksLikeVideo = /\.(mp4|mov|webm|m4v)(?:[?#]|$)/i.test(mediaText);
                                                    return looksLikeVideo ? '[视频](用户上传文件)' : '[图片](用户上传文件)';
                                                }

                                                // 兜底：把纯文本当成图片描述
                                                const fallbackDesc = cleanText(mediaText.replace(/^\[|\]$/g, ''), 120);
                                                return fallbackDesc ? `[图片](${fallbackDesc})` : '';
                                            };
                                            const buildWeiboMediaSummary = (post) => {
                                                const medias = Array.isArray(post?.images) ? post.images : [];
                                                if (medias.length === 0) return '';

                                                const normalized = medias
                                                    .map(formatWeiboMediaForOfflineContext)
                                                    .filter(Boolean)
                                                    .slice(0, 9);
                                                return normalized.join(' ');
                                            };
                                            const userName = context?.name1 || '用户';
                                            
                                            // 🔥 核心逻辑：设置的限制数字仅用来截取最新的 N 条用户微博
                                            const userPosts = userPostsList.slice(0, weiboLimit);
                                            // 热搜不受限制，全量注入
                                            const hotTop = hotSearches;

                                            if (userPosts.length > 0 || hotTop.length > 0) {
                                                if (userPosts.length > 0) {
                                                    weiboHistoryContent += `【 微博用户已发动态】\n`;
                                                    userPosts.forEach((post, idx) => {
                                                        const blogger = cleanText(post.blogger || userName, 40);
                                                        const content = cleanText(post.content || '');
                                                        const mediaSummary = buildWeiboMediaSummary(post);
                                                        
                                                        // 🔥 解除限制：获取该条微博的所有评论，全量注入！
                                                        const comments = Array.isArray(post.commentList) ? post.commentList : [];

                                                        weiboHistoryContent += `--- 微博${idx + 1} ---\n`;
                                                        if (post.time) weiboHistoryContent += `时间: ${cleanText(post.time, 20)}\n`;
                                                        weiboHistoryContent += `博主: ${blogger}\n`;
                                                        weiboHistoryContent += `正文: ${content || '[空内容]'}\n`;
                                                        if (mediaSummary) {
                                                            weiboHistoryContent += `配图: ${mediaSummary}\n`;
                                                        }

                                                        if (comments.length > 0) {
                                                            weiboHistoryContent += `评论:\n`;
                                                            comments.forEach(c => {
                                                                const cName = cleanText(c?.name || '网友', 40);
                                                                const cText = cleanText(c?.text || '', 140);
                                                                if (!cText) return;
                                                                weiboHistoryContent += `- ${cName}: ${cText}\n`;
                                                            });
                                                        }
                                                        weiboHistoryContent += `\n`;
                                                    });
                                                }

                                                if (hotTop.length > 0) {
                                                    weiboHistoryContent += `【 微博最新热搜】\n`;
                                                    hotTop.forEach((item, idx) => {
                                                        const title = typeof item === 'string'
                                                            ? cleanText(item, 60)
                                                            : cleanText(item?.title || item?.name || item?.keyword || '', 60);
                                                        if (!title) return;
                                                        weiboHistoryContent += `${idx + 1}. ${title}\n`;
                                                    });
                                                    weiboHistoryContent += `\n`;
                                                }
                                            }
                                        }
                                    } catch (e) {
                                        console.warn('⚠️ [手机] 注入微博记录失败:', e);
                                    }

                                    // 🌟 辅助函数：深拷贝并保留多模态属性的切割器
                                    const cloneSplitMessage = (originalMsg, newText) => {
                                        // 深拷贝原消息，保留图片、扩展数据等所有原生属性
                                        const cloned = JSON.parse(JSON.stringify(originalMsg));
                                        
                                        // 覆盖文本字段
                                        if (cloned.content !== undefined) cloned.content = newText;
                                        if (cloned.mes !== undefined) cloned.mes = newText;
                                        if (cloned.text !== undefined) cloned.text = newText;
                                        
                                        // 针对 Gemini 的 parts 结构特殊处理，防止图片丢失
                                        if (Array.isArray(cloned.parts) && cloned.parts.length > 0) {
                                            // 假设文本总是在第一个 part
                                            if (cloned.parts[0].text !== undefined) {
                                                cloned.parts[0].text = newText;
                                            }
                                        }
                                        return cloned;
                                    };

                                    // 🔥 辅助函数：原地拆分注入 (Gaigai 终极防弹版)
                                    const injectIntoMessages = (targetVar, contentToInject, identifier) => {
                                        const normalizedVarName = String(targetVar || '').replace(/[{}]/g, '').trim();
                                        const spacedVarRegex = normalizedVarName
                                            ? new RegExp(`\\{\\{\\s*${normalizedVarName}\\s*\\}\\}`, 'i')
                                            : null;
                                        // 1. 如果没有内容要注入，执行安全清洗，把占位符彻底删掉
                                        if (!contentToInject) {
                                            for (let i = 0; i < messages.length; i++) {
                                                let msg = messages[i];
                                                let msgContent = msg.content || msg.mes || msg.text || (msg.parts && msg.parts[0] ? msg.parts[0].text : '') || '';
                                                const hasExact = typeof msgContent === 'string' && msgContent.includes(targetVar);
                                                const hasSpaced = typeof msgContent === 'string' && !!spacedVarRegex && spacedVarRegex.test(msgContent);
                                                if (hasExact || hasSpaced) {
                                                    let cleanedText = String(msgContent || '');
                                                    if (hasExact) cleanedText = cleanedText.split(targetVar).join('');
                                                    if (hasSpaced && spacedVarRegex) {
                                                        const spacedVarGlobalRegex = new RegExp(`\\{\\{\\s*${normalizedVarName}\\s*\\}\\}`, 'gi');
                                                        cleanedText = cleanedText.replace(spacedVarGlobalRegex, '');
                                                    }
                                                    cleanedText = cleanedText.trim();
                                                    if (msg.content !== undefined) msg.content = cleanedText;
                                                    if (msg.mes !== undefined) msg.mes = cleanedText;
                                                    if (msg.text !== undefined) msg.text = cleanedText;
                                                    if (msg.parts && msg.parts[0] !== undefined) msg.parts[0].text = cleanedText;
                                                }
                                            }
                                            return;
                                        }

                                        // 2. 准备要插入的系统块
                                        const isGemini = messages.length > 0 && messages[0].parts !== undefined;
                                        const resolveInjectedSystemName = (id, text) => {
                                            if (id === 'weibo_system_history') return 'SYSTEM (微博)';
                                            if (id === 'phone_system_history') return 'SYSTEM (微信历史)';
                                            if (id === 'mofo_system_prompt') return 'SYSTEM (魔坊)';
                                            if (id === 'diary_system_history') return 'SYSTEM (日记)';
                                            if (id === 'phone_system_rules') {
                                                const source = String(text || '');
                                                const tags = [];
                                                if (source.includes('【🎵 音乐状态栏】') || source.includes('音乐状态栏')) tags.push('音乐');
                                                if (source.includes('【微博') || source.includes('微博')) tags.push('微博');
                                                if (source.includes('【微信线下模式】')) tags.push('微信线下');
                                                return tags.length > 0 ? `SYSTEM (${Array.from(new Set(tags)).join('+')})` : 'SYSTEM (手机规则)';
                                            }
                                            return 'SYSTEM (系统)';
                                        };
                                        const msgObj = {
                                            role: isGemini ? 'user' : 'system', // Gemini不允许塞system
                                            content: contentToInject,
                                            isPhoneMessage: true,
                                            identifier: identifier,
                                            name: resolveInjectedSystemName(identifier, contentToInject)
                                        };
                                        if (isGemini) msgObj.parts = [{ text: contentToInject }];

                                        // 3. 开始遍历并原地切割注入
                                        let replaced = false;
                                        for (let i = 0; i < messages.length; i++) {
                                            let msg = messages[i];
                                            let msgContent = msg.content || msg.mes || msg.text || (msg.parts && msg.parts[0] ? msg.parts[0].text : '') || '';

                                            if (typeof msgContent === 'string') {
                                                let varIndex = msgContent.indexOf(targetVar);
                                                let varLen = targetVar.length;
                                                if (varIndex < 0 && spacedVarRegex) {
                                                    const match = msgContent.match(spacedVarRegex);
                                                    if (match && typeof match.index === 'number') {
                                                        varIndex = match.index;
                                                        varLen = match[0].length;
                                                    }
                                                }
                                                if (varIndex < 0) continue;

                                                const preText = msgContent.substring(0, varIndex).trim();
                                                const postText = msgContent.substring(varIndex + varLen).trim();

                                                const newMessages = [];
                                                
                                                // 压入前半段（保留所有原生属性）
                                                if (preText) newMessages.push(cloneSplitMessage(msg, preText));
                                                // 压入手机系统块
                                                newMessages.push(msgObj);
                                                // 压入后半段
                                                if (postText) newMessages.push(cloneSplitMessage(msg, postText));

                                                // 🌟 神之一手：原地替换，数组长度自动扩容
                                                messages.splice(i, 1, ...newMessages);
                                                replaced = true;
                                                break; // 替换完成，立刻跳出循环
                                            }
                                        }

                                        // 4. 兜底策略：如果没找到变量，默认插入到最后一条 user 消息之前
                                        if (!replaced) {
                                            let insertPos = messages.length;
                                            for (let i = messages.length - 1; i >= 0; i--) {
                                                if (messages[i].role === 'user') {
                                                    insertPos = i;
                                                    break;
                                                }
                                            }
                                            messages.splice(insertPos, 0, msgObj);
                                        }
                                    };

                                    // 🔥 分别注入规则和历史记录
                                    injectIntoMessages('{{PHONE_PROMPT}}', phoneRulesContent, 'phone_system_rules');
                                    injectIntoMessages('{{PHONE_HISTORY}}', phoneHistoryContent, 'phone_system_history');
                                    if (weiboInjectEnabled) {
                                        injectIntoMessages('{{WEIBO_HISTORY}}', weiboHistoryContent, 'weibo_system_history');
                                    }
                                    injectIntoMessages('{{MOFO_PROMPT}}', mofoPromptContent, 'mofo_system_prompt');
                                    injectIntoMessages('{{DIARY_HISTORY}}', diaryHistoryContent, 'diary_system_history');

                                    // ============================
                                    // 🎵 {{MUSIC_PROMPT}} 独立注入
                                    // ============================
                                    let musicContent = '';
                                    // 🔥 新增判断：读取当前是否开启了悬浮窗
                                    let isMusicFloatingEnabled = false;
                                    if (storage) {
                                        const val = storage.get('music_show_floating');
                                        isMusicFloatingEnabled = (val === true || val === 'true' || val === 1);
                                    }

                                    // 🔥 修改判断：必须同时满足“提示词开关打开” AND “悬浮窗已开启”
                                    if (isMusicFloatingEnabled && promptManager?.isEnabled('music', 'recommend')) {
                                        const musicPrompt = promptManager.getPromptForFeature('music', 'recommend');
                                        if (musicPrompt) {
                                            musicContent = `【🎵 音乐状态栏】\n${musicPrompt}\n`;
                                        }
                                    }

                                    if (musicContent) {
                                        const isGemini = messages.length > 0 && messages[0].parts !== undefined;
                                        const musicMessage = {
                                            role: isGemini ? 'user' : 'system',
                                            content: musicContent,
                                            parts: isGemini ? [{ text: musicContent }] : undefined,
                                            isMusicMessage: true,
                                            identifier: 'music_system',
                                            name: 'SYSTEM (音乐)'
                                        };

                                        let musicReplaced = false;
                                        const MUSIC_VAR = '{{MUSIC_PROMPT}}';
                                        const MUSIC_VAR_SPACED_REGEX = /\{\{\s*MUSIC_PROMPT\s*\}\}/i;

                                        // 1️⃣ 扫描上下文，寻找 {{MUSIC_PROMPT}} 变量，执行"原地拆分注入"
                                        for (let i = 0; i < messages.length; i++) {
                                                let msgContent = messages[i].content || messages[i].mes || messages[i].text || (messages[i].parts && messages[i].parts[0] ? messages[i].parts[0].text : '') || '';

                                            if (typeof msgContent === 'string') {
                                                let varIndex = msgContent.indexOf(MUSIC_VAR);
                                                let varLen = MUSIC_VAR.length;
                                                if (varIndex < 0) {
                                                    const match = msgContent.match(MUSIC_VAR_SPACED_REGEX);
                                                    if (match && typeof match.index === 'number') {
                                                        varIndex = match.index;
                                                        varLen = match[0].length;
                                                    }
                                                }
                                                if (varIndex < 0) continue;

                                                const preText = msgContent.substring(0, varIndex).trim();
                                                const postText = msgContent.substring(varIndex + varLen).trim();

                                                const newMessages = [];
                                                const originalMsg = messages[i];

                                                if (preText) {
                                                    newMessages.push({
                                                        role: originalMsg.role,
                                                        content: preText,
                                                        parts: isGemini ? [{ text: preText }] : undefined,
                                                        name: originalMsg.name
                                                    });
                                                }

                                                newMessages.push(musicMessage);

                                                if (postText) {
                                                    newMessages.push({
                                                        role: originalMsg.role,
                                                        content: postText,
                                                        parts: isGemini ? [{ text: postText }] : undefined,
                                                        name: originalMsg.name
                                                    });
                                                }

                                                messages.splice(i, 1, ...newMessages);
                                                musicReplaced = true;
                                                break;
                                            }
                                        }

                                        // 2️⃣ 兜底：如果上下文中没有 {{MUSIC_PROMPT}}，默认插入到最后一条 user 消息之前
                                        if (!musicReplaced) {
                                            let insertPos = messages.length;
                                            for (let i = messages.length - 1; i >= 0; i--) {
                                                if (messages[i].role === 'user') {
                                                    insertPos = i;
                                                    break;
                                                }
                                            }
                                            messages.splice(insertPos, 0, musicMessage);
                                        }
                                    }

                                    // ========================================
                                    // 🔥 终极防线：无条件清洗发送给大模型的数据上下文
                                    // ========================================
                                    messages.forEach(msg => {
                                        let c = msg.content || msg.mes || msg.text || (msg.parts && msg.parts[0] ? msg.parts[0].text : '') || '';
                                        if (typeof c === 'string') {
                                            let modified = false;

                                            // 1. 清洗占位符变量残骸
                                            const TARGET_VAR = '{{PHONE_PROMPT}}';
                                            const HISTORY_VAR = '{{PHONE_HISTORY}}';
                                            const WEIBO_VAR = '{{WEIBO_HISTORY}}';
                                            const MUSIC_VAR = '{{MUSIC_PROMPT}}';
                                            const MOFO_VAR = '{{MOFO_PROMPT}}';
                                            const DIARY_VAR = '{{DIARY_HISTORY}}';
                                            const PHONE_PROMPT_SPACED_REGEX = /\{\{\s*PHONE_PROMPT\s*\}\}/gi;
                                            const PHONE_HISTORY_SPACED_REGEX = /\{\{\s*PHONE_HISTORY\s*\}\}/gi;
                                            const WEIBO_HISTORY_SPACED_REGEX = /\{\{\s*WEIBO_HISTORY\s*\}\}/gi;
                                            const MUSIC_PROMPT_SPACED_REGEX = /\{\{\s*MUSIC_PROMPT\s*\}\}/gi;
                                            const MOFO_PROMPT_SPACED_REGEX = /\{\{\s*MOFO_PROMPT\s*\}\}/gi;
                                            const DIARY_HISTORY_SPACED_REGEX = /\{\{\s*DIARY_HISTORY\s*\}\}/gi;
                                            if (c.includes(TARGET_VAR)) {
                                                c = c.split(TARGET_VAR).join('');
                                                modified = true;
                                            }
                                            if (PHONE_PROMPT_SPACED_REGEX.test(c)) {
                                                c = c.replace(PHONE_PROMPT_SPACED_REGEX, '');
                                                modified = true;
                                            }
                                            if (c.includes(HISTORY_VAR)) {
                                                c = c.split(HISTORY_VAR).join('');
                                                modified = true;
                                            }
                                            if (PHONE_HISTORY_SPACED_REGEX.test(c)) {
                                                c = c.replace(PHONE_HISTORY_SPACED_REGEX, '');
                                                modified = true;
                                            }
                                            if (c.includes(WEIBO_VAR)) {
                                                c = c.split(WEIBO_VAR).join('');
                                                modified = true;
                                            }
                                            if (WEIBO_HISTORY_SPACED_REGEX.test(c)) {
                                                c = c.replace(WEIBO_HISTORY_SPACED_REGEX, '');
                                                modified = true;
                                            }
                                            if (c.includes(MUSIC_VAR)) {
                                                c = c.split(MUSIC_VAR).join('');
                                                modified = true;
                                            }
                                            if (MUSIC_PROMPT_SPACED_REGEX.test(c)) {
                                                c = c.replace(MUSIC_PROMPT_SPACED_REGEX, '');
                                                modified = true;
                                            }
                                            if (c.includes(MOFO_VAR)) {
                                                c = c.split(MOFO_VAR).join('');
                                                modified = true;
                                            }
                                            if (MOFO_PROMPT_SPACED_REGEX.test(c)) {
                                                c = c.replace(MOFO_PROMPT_SPACED_REGEX, '');
                                                modified = true;
                                            }
                                            if (c.includes(DIARY_VAR)) {
                                                c = c.split(DIARY_VAR).join('');
                                                modified = true;
                                            }
                                            if (DIARY_HISTORY_SPACED_REGEX.test(c)) {
                                                c = c.replace(DIARY_HISTORY_SPACED_REGEX, '');
                                                modified = true;
                                            }

                                            // 2. 抹除隐秘标签 (仅限 assistant 角色)
                                            if (msg.role === 'assistant') {
                                                // 统一清洗 Phone, Music 标签。
                                                // Wechat 标签不再由插件清洗，交给酒馆正则控制。
                                                const tagsToClean = ['phone', 'music'];
                                                tagsToClean.forEach(tag => {
                                                    const rx = new RegExp(`(?:\\\`\\\`\\\`[\\w]*\\n)?<${tag}>[\\s\\S]*?<\\/${tag}>(?:\\n\\\`\\\`\\\`)?`, 'gi');
                                                    const cleaned = c.replace(rx, '').trim();
                                                    if (cleaned !== c) {
                                                        c = cleaned;
                                                        modified = true;
                                                    }
                                                });

                                                // 清洗电话来电标记
                                                const phoneCallRx = /\[手机来电通话\][^\n]*/gi;
                                                if (phoneCallRx.test(c)) {
                                                    c = c.replace(phoneCallRx, '').trim();
                                                    modified = true;
                                                }
                                            }

                                            if (modified) {
                                                if (msg.content !== undefined) msg.content = c;
                                                if (msg.mes !== undefined) msg.mes = c;
                                                if (msg.text !== undefined) msg.text = c;
                                                if (msg.parts && msg.parts[0] !== undefined) msg.parts[0].text = c;
                                            }
                                        }
                                    });

                                }  // 结束 if (messages && Array.isArray(messages))
                            }      // 结束 if (wechatOfflineChats.length > 0 || settings.enabled)

                        } catch (e) {
                            // 🔥 第三层防线：错误处理 - 只打印日志，不中断酒馆进程
                            console.error('❌ [手机插件] 注入逻辑异常 (已拦截):', e.message);
                            console.error('📍 [手机插件] 错误堆栈:', e.stack);
                            forceFallbackCleanup(eventData.chat); // 哪怕代码崩溃了，也必须把占位符擦掉！
                            // 不抛出异常，避免影响酒馆主流程
                        }
                }; // 结束 phonePromptHandler 定义

                // 🔥 移动端终极修复：回归同步过滤器，防止酒馆在手机端丢弃异步上下文
                if (window.hooks && typeof window.hooks.addFilter === 'function') {
                    // 🔥 核心修复：加上 async 和 await，强迫酒馆发包前必须等我们的变量替换彻底完成！
                    window.hooks.addFilter('chat_completion_prompt_ready', async (chat) => {
                        // 包装成旧版 eventData 格式兼容原有代码
                        let eventData = { chat: chat, prompt: [] };
                        await phonePromptHandler(eventData); 
                        return eventData.chat; // 必须返回修改后的数组给酒馆
                    });
                } else {
                    // 旧版本酒馆兼容
                    context.eventSource.on(context.event_types.CHAT_COMPLETION_PROMPT_READY, phonePromptHandler);
                }

            } else {
                console.warn('⚠️ 无法访问 context 或 eventSource');
            }

            // ========================================================================
            // 🚀 终极杀手锏：全局 Fetch 拦截器 (完美解决点“发送”过快导致漏变量的 Bug)
            // ========================================================================
            if (!window._stPhoneFetchPatched) {
                window._stPhoneFetchPatched = true;
                const ogFetch = window.fetch;
                window.fetch = async function (url, options) {
                    const isTextGeneration = (
                        typeof url === 'string' &&
                        (url.includes('/api/backends/chat-completions/generate') ||
                         url.includes('/v1/chat/completions') ||
                         (url.includes('/generate') && !url.includes('/api/sd/') && !url.includes('/api/tts/') && !url.includes('/api/images/')))
                    );

                    // 拦截正文生成请求
                    if (isTextGeneration && options && options.body && typeof options.body === 'string') {
                        try {
                            let bodyObj = JSON.parse(options.body);
                            let targetArray = null;

                            // 兼容各大模型的数据结构
                            if (Array.isArray(bodyObj.messages)) targetArray = bodyObj.messages;
                            else if (Array.isArray(bodyObj.prompt)) targetArray = bodyObj.prompt;
                            else if (Array.isArray(bodyObj.contents)) targetArray = bodyObj.contents;

                            if (targetArray) {
                                // 🌟 1. 核心防御：连同外层 bodyObj 一起检查，防止变量被移动端或 Claude 抽离到 system 字段
                                const hasMacros = JSON.stringify(bodyObj).match(/\{\{\s*PHONE_PROMPT\s*\}\}|\{\{\s*PHONE_HISTORY\s*\}\}|\{\{\s*WEIBO_HISTORY\s*\}\}|\{\{\s*MUSIC_PROMPT\s*\}\}|\{\{\s*MOFO_PROMPT\s*\}\}|\{\{\s*DIARY_HISTORY\s*\}\}/i);

                                if (hasMacros) {
                                    console.log('🚨 [手机插件] 警告：酒馆发送过快导致 Hook 被无视，请求体残留变量！正在执行网卡级底层强行注入...');
                                    
                                    let safeEvent = { chat: targetArray, prompt: [] };
                                    
                                    // 🔥 移动端/Claude 绝杀：如果变量被抽到了 system 字段，强行把它塞回头部当做临时消息
                                    let hasSystemField = typeof bodyObj.system === 'string';
                                    if (hasSystemField) {
                                        safeEvent.chat.unshift({ role: 'system', content: bodyObj.system, isTempSystem: true });
                                    }

                                    // 强行在发包前，调用注入函数再跑一遍！
                                    await phonePromptHandler(safeEvent);
                                    
                                    // 🔥 处理完毕后，完美缝合：把刚刚塞进去的、以及插件新注入的系统块，全部抽出来重新拼接回 system 字段
                                    if (hasSystemField) {
                                        let newSysParts = [];
                                        while (safeEvent.chat.length > 0 && (safeEvent.chat[0].isTempSystem || safeEvent.chat[0].isPhoneMessage || safeEvent.chat[0].isMusicMessage || safeEvent.chat[0].role === 'system')) {
                                            let popped = safeEvent.chat.shift();
                                            if (popped.content) newSysParts.push(popped.content);
                                        }
                                        bodyObj.system = newSysParts.join('\n\n');
                                    }
                                    
                                    console.log('✅ [手机插件] 底层强行注入完毕，完美缝合防抢跑！');
                                }

                                // 🌟 2. 处理图片占位符 (保留原有的发图功能)
                                let modifiedImage = false;
                                targetArray.forEach(msg => {
                                    if (msg.role === 'user' && typeof msg.content === 'string' && msg.content.includes('__ST_PHONE_IMAGE_')) {
                                        const parts = msg.content.split(/(__ST_PHONE_IMAGE_\d+_[a-z0-9]+__)/g);
                                        const newContent = [];
                                        parts.forEach(part => {
                                            if (part.startsWith('__ST_PHONE_IMAGE_') && window.VirtualPhone?._pendingImages?.[part]) {
                                                newContent.push({ type: 'image_url', image_url: { url: window.VirtualPhone._pendingImages[part] } });
                                                delete window.VirtualPhone._pendingImages[part];
                                            } else if (part && part.trim() !== '') {
                                                newContent.push({ type: 'text', text: part });
                                            }
                                        });
                                        msg.content = newContent;
                                        modifiedImage = true;
                                    }
                                });
                                if (modifiedImage) console.log('🔥 [手机插件] 图片代币已成功调包为原生多模态数组');

                                // 🌟 3. 将修复好的完美数据重新打包
                                options.body = JSON.stringify(bodyObj);
                            }
                        } catch (e) {
                            console.error('🔥 手机底层拦截器异常:', e);
                        }
                    }
                    // 放行，发送修改后的数据包给大模型
                    return ogFetch.apply(this, arguments);
                };
            }
            // ========================================================================

        } catch (e) {
            console.error('❌ 虚拟手机初始化失败:', e);
        }
    }  // 结束 init() 函数

    // 🔥 终极修复：绝对禁止人为延迟！必须立刻执行，否则会错过酒馆的第一次发送事件！
    init().then(() => {
        if (window.VirtualPhone && modulesLoaded) {
            window.VirtualPhone.version = ST_PHONE_VERSION;
        }
    });

}
