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
// 微信APP主程序
import { ChatView } from './chat-view.js';
import { ContactsView } from './contacts-view.js';
import { MomentsView } from './moments-view.js';
import { WechatData } from './wechat-data.js';
import { ImageCropper } from '../settings/image-cropper.js';

export class WechatApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.wechatData = new WechatData(storage);
        this.currentView = 'chats';
        this.currentChat = null;
        this._avatarPool = { male: [], female: [], all: [] };
        this._avatarPoolLoaded = false;
        this._avatarPoolLoading = false;
        this._isAvatarManagerOpen = false;
        this._wechatPanelMode = 'main'; // main | settings | avatar-manager
        this._isWalletEvaluating = false;

        // 初始化视图
        this.chatView = new ChatView(this);
        this.contactsView = new ContactsView(this);
        this.momentsView = new MomentsView(this);
        this._ensureWechatAvatarPoolLoaded();

        // 加载样式
        this.loadStyles();
        // 应用用户自定义会话样式（气泡/头像框）
        this._applyCustomChatStyle(this._getUserCustomChatCss());

        // 🔥 监听滑动返回事件 (防止切换聊天导致重复绑定)
        if (!window._wechatSwipeBackBound) {
            window._wechatSwipeBackBound = true;
            window.addEventListener('phone:swipeBack', () => {
                if (window.VirtualPhone && window.VirtualPhone.wechatApp) {
                    window.VirtualPhone.wechatApp.handleSwipeBack();
                }
            });
        }
    }

    // 🔥 处理滑动返回（智能模拟点击原生返回按钮）
    handleSwipeBack() {
        // 1. 400ms 防抖
        const now = Date.now();
        if (this._lastSwipeTime && now - this._lastSwipeTime < 400) return;
        this._lastSwipeTime = now;

        // 2. 领地保护
        const currentView = document.querySelector('.phone-view-current');
        if (!currentView || !currentView.querySelector('.wechat-app')) return;

        // 3. 模拟点击返回按钮
        const backBtn = currentView.querySelector('.wechat-back-btn');
        if (backBtn) {
            backBtn.click();
        } else {
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        }

        // 4. Ghost Click Buster：400ms 内禁止点击
        const screen = document.querySelector('.phone-screen');
        if (screen) {
            screen.style.pointerEvents = 'none';
            setTimeout(() => { screen.style.pointerEvents = ''; }, 400);
        }
    }

    _getUserCustomChatCss() {
        try {
            // 🔥 改为从全局配置中读取，所有会话共享
            return String(this.storage?.get('phone_global_chat_css') || '');
        } catch (e) {
            return '';
        }
    }

    _applyCustomChatStyle(cssText) {
        let styleTag = document.getElementById('wechat-custom-chat-style');
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = 'wechat-custom-chat-style';
            document.head.appendChild(styleTag);
        }
        styleTag.textContent = String(cssText || '');
    }

    loadStyles() {
        if (!document.getElementById('wechat-styles')) {
            const style = document.createElement('style');
            style.id = 'wechat-styles';
            style.textContent = `
/* ========================================
   微信APP完整样式 - 高仿版
   ======================================== */

.wechat-app {
    width: 100%;
    height: 100%;
    background: #ededed;
    display: flex;
    flex-direction: column;
    font-family: inherit;

    /* 🔥 新增：基础字体大小，使用变量方便调整 */
    font-size: 14px; /* 默认大小 */

    /* 🔥 继承屏幕圆角，防止四角露出 */
    border-radius: inherit;
    overflow: hidden;
}

/* 🔥 新增：响应式字体 */
@media (max-width: 1024px) {
    .wechat-app {
        font-size: 13px; /* 平板 */
    }
}
@media (max-width: 500px) {
    .wechat-app {
        font-size: 12px; /* 手机 */
    }
}

/* ========================================
   顶部栏样式
   ======================================== */

.wechat-header {
    /* 🔥 同样降到15%透明度，清水玻璃 */
    background: rgba(255, 255, 255, 0.15); 
    backdrop-filter: blur(35px) saturate(200%);
    -webkit-backdrop-filter: blur(35px) saturate(200%);
    height: 68px;
    padding-top: 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-left: 12px;
    padding-right: 12px;
    /* 🔥 边框同样微加深 */
    border-bottom: 0.5px solid rgba(0, 0, 0, 0.15);
    flex-shrink: 0;
    position: relative;
    z-index: 10;
    box-sizing: border-box;
}

/* 聊天列表页专用：让外层顶部观感接近聊天内页的玻璃质感 */
.wechat-header-chatlist-glass {
    background:
        linear-gradient(160deg, rgba(255, 255, 255, 0.68) 0%, rgba(255, 255, 255, 0.46) 58%, rgba(255, 255, 255, 0.38) 100%),
        linear-gradient(120deg, rgba(225, 233, 244, 0.34) 0%, rgba(243, 238, 230, 0.26) 52%, rgba(224, 235, 245, 0.3) 100%);
    backdrop-filter: blur(28px) saturate(170%);
    -webkit-backdrop-filter: blur(28px) saturate(170%);
    border-bottom: 0.5px solid rgba(255, 255, 255, 0.62);
    box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.06);
}
    
.wechat-header-left {
    width: 50px;  /* 🔥 宽度减小 */
}

.wechat-back-btn {
    background: none;
    border: none;
    color: #576b95;
    font-size: 14px;  /* 🔥 字号减小 */
    padding: 6px;
    cursor: pointer;
}

.wechat-header-title {
    font-size: 14px;  /* 🔥 字号减小 */
    font-weight: 400;
    color: #000;
    flex: 1;
    text-align: center;
    display: block;
    position: relative;
}

.wechat-header-title-text {
    display: inline-block;
    position: relative;
    line-height: 1.1;
}

.status-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    display: block;
    position: absolute;
    left: 100%;
    margin-left: 4px;
    top: 50%;
    transform: translateY(-50%);
    transition: background-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.dot-green {
    background: #34c759;
    box-shadow: 0 0 4px rgba(52, 199, 89, 0.6);
}

.dot-yellow {
    background: #ffcc00;
    box-shadow: 0 0 4px rgba(255, 204, 0, 0.6);
}

.dot-red {
    background: #ff3b30;
    box-shadow: 0 0 4px rgba(255, 59, 48, 0.62);
}

/* 正在输入动画 */
.typing-status {
    display: block;
    font-size: 12px;
    color: #999;
    font-weight: normal;
    margin-top: 2px;
}

.typing-dots {
    display: inline-block;
    animation: typing 1.4s infinite;
}

@keyframes typing {
    0%, 60%, 100% { opacity: 1; }
    30% { opacity: 0.3; }
}

.header-badge {
    color: #576b95;
    font-size: 14px;
}

.wechat-header-right {
    min-width: 50px;  /* 🔥 宽度减小 */
    display: flex;
    gap: 4px;
    justify-content: flex-end;
}

.wechat-header-btn {
    background: none;
    border: none;
    color: #000;
    font-size: 14px;  /* 🔥 字号减小 */
    cursor: pointer;
}

/* ========================================
   内容区样式
   ======================================== */

.wechat-content {
    flex: 1;
    overflow-y: auto;
    background: #fff;
    position: relative;
}

/* ========================================
   底部导航栏
   ======================================== */

.wechat-tabbar {
    height: 42px;
    padding-bottom: 5px;  /* 底部空白再缩小 */
    padding-top: 2px;
    background: #f7f7f7;
    border-top: 0.5px solid #d8d8d8;
    display: flex;
    flex-shrink: 0;
    box-sizing: content-box;
    align-items: flex-start;  /* 🔥 内容靠上对齐，图标往下移 */
}

/* 🔥 手机端同样调整 */
@media (max-width: 500px) {
    .wechat-tabbar {
        padding-bottom: 5px;
    }
}

.wechat-tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;  /* 🔥 内容从顶部开始 */
    padding-top: 4px;
    cursor: pointer;
    position: relative;
    color: #999;
    font-size: 9px;
    height: 100%;
}

.wechat-tab.active {
    color: #07c160;
}

.wechat-tab i {
    font-size: 16px;
    margin-bottom: 1px;
}

.tab-badge {
    position: absolute;
    top: 2px;
    right: calc(50% - 17px);
    background: #ff3b30;
    color: #fff;
    font-size: 10px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 10px;
    min-width: 16px;
    text-align: center;
}

/* ========================================
   聊天列表样式
   ======================================== */

.wechat-chat-list {
    background: #fff;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE and Edge */
}

.wechat-chat-list::-webkit-scrollbar {
    display: none; /* Chrome, Safari */
}

.chat-item {
    display: flex;
    align-items: center;
    padding: 8px 12px 8px 10px;
    border-bottom: 0.5px solid #e5e5e5;
    cursor: pointer;
    background: #fff;
    transition: background 0.2s;
}

.chat-item:active {
    background: #ececec;
}

/* 聊天列表启用背景图时，列表卡片切换为半透明玻璃效果 */
.wechat-app.wechat-chatlist-bg-enabled .wechat-chat-list {
    background: transparent;
}

.wechat-app.wechat-chatlist-bg-enabled .chat-item {
    background: rgba(255, 255, 255, 0.58);
    backdrop-filter: blur(8px) saturate(125%);
    -webkit-backdrop-filter: blur(8px) saturate(125%);
    border-bottom: 0.5px solid rgba(255, 255, 255, 0.48);
}

.wechat-app.wechat-chatlist-bg-enabled .chat-item:active {
    background: rgba(255, 255, 255, 0.74);
}

.wechat-app.wechat-chatlist-bg-enabled .wechat-tabbar {
    background: rgba(255, 255, 255, 0.48);
    backdrop-filter: blur(20px) saturate(145%);
    -webkit-backdrop-filter: blur(20px) saturate(145%);
    border-top: 0.5px solid rgba(255, 255, 255, 0.52);
}

/* 微信四个主页面统一底栏玻璃风格（微信/通讯录/朋友圈/我） */
.wechat-app.wechat-main-shell .wechat-tabbar {
    background: rgba(255, 255, 255, 0.5);
    backdrop-filter: blur(20px) saturate(145%);
    -webkit-backdrop-filter: blur(20px) saturate(145%);
    border-top: 0.5px solid rgba(255, 255, 255, 0.5);
}

/* 四页统一背景时：通讯录容器改为透明/半透明，避免遮掉主背景 */
.wechat-app.wechat-chatlist-bg-enabled .wechat-contacts,
.wechat-app.wechat-chatlist-bg-enabled .contacts-scrollable {
    background: transparent;
}

.wechat-app.wechat-chatlist-bg-enabled .contacts-functions,
.wechat-app.wechat-chatlist-bg-enabled .contacts-list {
    background: rgba(255, 255, 255, 0.5);
    backdrop-filter: blur(10px) saturate(130%);
    -webkit-backdrop-filter: blur(10px) saturate(130%);
}

.wechat-app.wechat-chatlist-bg-enabled .group-letter {
    background: rgba(255, 255, 255, 0.56);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
}

.wechat-app.wechat-chatlist-bg-enabled .function-item:active,
.wechat-app.wechat-chatlist-bg-enabled .contact-item:active {
    background: rgba(255, 255, 255, 0.72);
}

/* 四页统一背景时：我页面容器改为透明/半透明 */
.wechat-app.wechat-chatlist-bg-enabled .wechat-profile {
    background: transparent;
}

.wechat-app.wechat-chatlist-bg-enabled .profile-card,
.wechat-app.wechat-chatlist-bg-enabled .profile-functions,
.wechat-app.wechat-chatlist-bg-enabled .profile-stats {
    background: rgba(255, 255, 255, 0.56);
    backdrop-filter: blur(10px) saturate(130%);
    -webkit-backdrop-filter: blur(10px) saturate(130%);
}

.wechat-app.wechat-chatlist-bg-enabled .profile-function-item:active {
    background: rgba(255, 255, 255, 0.72);
}

.chat-avatar-wrapper {
    margin-right: 10px;
    flex-shrink: 0;
}

.chat-avatar {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    background: #fff;
    border: 1px solid #d8d8d8;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    margin-right: 10px;
    flex-shrink: 0;
    overflow: hidden;
}

.chat-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: inherit;
}

.chat-info {
    flex: 1;
    min-width: 0;
}

.chat-name {
    font-size: 14px;
    color: #000;
    margin-bottom: 3px;
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.group-count {
    font-size: 12px;
    color: #999;
}

.chat-last-msg {
    font-size: 12px;
    color: #999;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.chat-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: center;
    flex-shrink: 0;
}

.chat-time {
    font-size: 12px;
    color: #b2b2b2;
    margin-bottom: 5px;
}

.chat-badge {
    background: #fa5151;
    color: #fff;
    font-size: 10px;
    font-weight: 500;
    min-width: 16px;
    height: 16px;
    line-height: 16px;
    padding: 0 5px;
    border-radius: 8px;
    text-align: center;
    box-sizing: border-box;
}

/* ========================================
   聊天室样式 - 高仿微信
   ======================================== */

.chat-room {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    background: transparent !important; /* 🔥 致命修复：彻底杀掉白底，让背景图透上来！ */
}

.chat-messages {
    flex: 1;
    min-height: 0; /* 防止无限撑开 */
    padding: 10px 6px 5px 6px; /* 顶部和左右留白，底部交由垫片处理 */
    box-sizing: border-box; 
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none; /* 隐藏 Firefox 滚动条 */
    -ms-overflow-style: none; /* 隐藏 IE/Edge 滚动条 */
}

/* 🔥 隐藏 Chrome/Safari/Edge 手机浏览器的滚动条 */
.chat-messages::-webkit-scrollbar {
    display: none;
}

/* 🔥 物理垫片：彻底治愈部分手机浏览器吞掉底部 padding 导致遮挡的绝症 */
.chat-messages::after {
    content: '';
    display: block;
    height: 20px; /* 强制在最底下塞入一个20px的透明方块 */
    width: 100%;
    flex-shrink: 0;
}

/* 时间戳分组 */
.message-time-divider {
    text-align: center;
    margin: 15px 0;
}

.time-divider-text {
    display: inline-block;
    padding: 3px 10px;
    color: #b0b0b0;
    font-size: 10px;
}

/* 聊天消息 */
.chat-message {
    display: flex;
    margin-bottom: 15px;
    align-items: flex-start;
}

.message-left {
    justify-content: flex-start;
}

.message-right {
    justify-content: flex-end;
}

.message-avatar {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 17px;
    flex-shrink: 0;
    cursor: pointer;
    transition: transform 0.2s;
    overflow: hidden;
}

.message-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: inherit;
}

.message-avatar:hover {
    transform: scale(1.05);
}

.message-left .message-avatar {
    margin-right: 8px;
}

.message-right .message-avatar {
    margin-left: 8px;
}

.message-content {
    max-width: 75%;
    position: relative;
}

.message-text {
    padding: 7px 10px; /* 稍微加宽一点左右内边距，更像微信 */
    border-radius: 4px;
    font-size: 14px;
    line-height: 1.4;
    word-wrap: break-word;
    word-break: break-word; /* 🔥 优化：防止英文单词被从中间劈开 */
    text-align: left;       /* 🔥 核心修复：强制左对齐，彻底消灭异常字间距 */
    position: relative;
    width: fit-content;
    max-width: 100%;
}

.message-left .message-text {
    background: #fff;
    color: #1c1c1e;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.message-left .message-text::before {
    content: '';
    position: absolute;
    left: -6px;
    top: 10px;
    border: 6px solid transparent;
    border-right-color: #fff;
    border-left: 0;
}

.message-right .message-text {
    background: #95ec69;
    color: #000;
}

.message-right .message-text::before {
    content: '';
    position: absolute;
    right: -6px;
    top: 10px;
    border: 6px solid transparent;
    border-left-color: #95ec69;
    border-right: 0;
}

.message-time {
    font-size: 10px;
    color: #b0b0b0;
    margin-top: 4px;
    text-align: right;
}

.message-left .message-time {
    text-align: left;
}

/* 特殊消息类型 */
.message-image {
    max-width: 100%;
    border-radius: 12px;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

/* 定位卡片：横向紧凑极简版 */
.message-location.style-compact {
    display: flex;
    align-items: center;
    width: 220px;
    max-width: 100%;
    background: #ffffff;
    padding: 10px 12px;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    gap: 12px;
    box-sizing: border-box;
}

.message-location.style-compact .icon-area {
    width: 36px;
    height: 36px;
    min-width: 36px;
    background: #f0f7ff;
    color: #1677ff;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
}

.message-location.style-compact .text-area {
    flex: 1;
    min-width: 0;
}

.message-location.style-compact .title {
    font-size: 14px;
    color: #1f2937;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.message-location.style-compact .detail {
    font-size: 10px;
    color: #6b7280;
    margin-top: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

@media (max-width: 500px) {
    .message-location.style-compact {
        width: 188px;
        padding: 8px 10px;
        border-radius: 10px;
        gap: 10px;
    }

    .message-location.style-compact .icon-area {
        width: 30px;
        height: 30px;
        min-width: 30px;
        font-size: 14px;
    }

    .message-location.style-compact .title {
        font-size: 13px;
    }

    .message-location.style-compact .detail {
        font-size: 9px;
        margin-top: 2px;
    }
}

.message-voice {
    padding: 10px 14px;
    border-radius: 18px;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 80px;
    cursor: pointer;
    font-size: 14px;
}

.message-left .message-voice {
    background: #fff;
    border-top-left-radius: 4px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.message-right .message-voice {
    background: #95ec69;
    border-top-right-radius: 4px;
}

/* ========================================
   🧧 红包与转账消息样式 (Fake-world 像素级复刻)
   ======================================== */
.message-redpacket, .message-transfer {
    width: 160px !important;
    border-radius: 4px !important;
    display: flex !important;
    flex-direction: column !important;
    cursor: pointer;
    position: relative;
    overflow: hidden !important;
    background-color: #F79C3E !important; /* 统一使用高级橙黄色 */
    border: none !important;
    padding: 0 !important;
    box-shadow: none !important;
}

.message-transfer:active, .message-redpacket:active { background-color: #E08D38 !important; }
.message-transfer.opened, .message-redpacket.opened { background-color: #F9C594 !important; }

/* 气泡小尾巴 (与背景色统一) */
.message-left .message-transfer::before, .message-left .message-redpacket::before {
    content: ''; position: absolute; top: 10px; left: -4px;
    border: 4px solid transparent; border-right-color: #F79C3E; border-left: 0;
}
.message-right .message-transfer::before, .message-right .message-redpacket::before {
    content: ''; position: absolute; top: 10px; right: -4px;
    border: 4px solid transparent; border-left-color: #F79C3E; border-right: 0;
}
.message-left .message-redpacket.opened::before, .message-left .message-transfer.opened::before { border-right-color: #F9C594; }
.message-right .message-redpacket.opened::before, .message-right .message-transfer.opened::before { border-left-color: #F9C594; }

/* 主体内容区 */
.rp-main {
    display: flex !important;
    padding: 8px 10px !important;
    align-items: center !important;
    background: transparent !important;
}
.rp-icon {
    width: 24px !important;
    height: 24px !important;
    margin-right: 8px !important;
    flex-shrink: 0 !important;
}
.rp-icon svg { width: 100%; height: 100%; }
.rp-content {
    flex: 1; display: flex; flex-direction: column; justify-content: center; min-width: 0; text-align: left;
}
.rp-title {
    color: #fff !important; font-size: 13px !important; font-weight: 500 !important; line-height: 1.2 !important; margin-bottom: 1px !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rp-subtitle {
    color: rgba(255,255,255,0.75) !important; font-size: 10px !important; font-weight: 400 !important;
}

/* 底部透明分割线与文字 */
.rp-footer {
    display: block !important;
    background-color: transparent !important;
    color: rgba(255,255,255,0.65) !important;
    font-size: 9px !important;
    padding: 2px 0 4px 0 !important;
    line-height: 1.2 !important;
    text-align: left !important;
    margin: 0 10px !important;
    width: auto !important;
    border-top: 0.5px solid rgba(255,255,255,0.2) !important;
}

/* ========================================
   输入区样式
   ======================================== */

.chat-input-area {
    flex-shrink: 0; 
    /* 🔥 透明度降到极限15%，近乎纯透明，拒绝白上加白 */
    background: rgba(255, 255, 255, 0.15) !important; 
    backdrop-filter: blur(35px) saturate(200%);       /* 🔥 加大模糊和饱和度，吸取底部颜色 */
    -webkit-backdrop-filter: blur(35px) saturate(200%);
    /* 🔥 边框稍微加深一点，强行勾勒出玻璃边缘 */
    border-top: 0.5px solid rgba(0, 0, 0, 0.15);
    padding-bottom: env(safe-area-inset-bottom, 8px);
    position: relative;
    z-index: 10;
}

.chat-input {
    width: 100%;
    background: rgba(255, 255, 255, 0.6) !important; /* 🔥 纯白改为60%半透明白 */
    color: #000000 !important;
    border: 0.5px solid rgba(0, 0, 0, 0.1);
    border-radius: 6px;
    padding: 6px 10px;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.2s;
}

/* 🔥 聊天输入栏 - 重构后的样式 */
.chat-input-bar {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    gap: 6px;
}

/* 🔥 输入框包装器 - 自动填充剩余空间 */
.chat-input-wrapper {
    flex: 1;
    min-width: 0;
    position: relative;
}

/* 🔥 输入框样式 */
.chat-input {
    width: 100%;
    background: rgba(255, 255, 255, 0.42) !important;
    color: #111111 !important;
    border: 0.5px solid rgba(255, 255, 255, 0.58);
    border-radius: 8px;
    padding: 6px 10px;
    backdrop-filter: blur(8px) saturate(130%);
    -webkit-backdrop-filter: blur(8px) saturate(130%);
    /* 🔥 移除硬编码字体大小，继承父元素设置 */
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.2s;
}

.chat-input:focus {
    border-color: rgba(7, 193, 96, 0.78);
    background: rgba(255, 255, 255, 0.58) !important;
}

/* 🔥 输入栏按钮 - 统一尺寸 */
.input-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    font-size: 18px;
    color: #666;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.2s;
}

/* 🔥 重新生成按钮稍小 */
.chat-input-bar #regenerate-btn {
    font-size: 14px;
    color: #888;
}

.input-btn:hover {
    color: #07c160;
}

.input-btn:active {
    transform: scale(0.9);
}

/* 🔥 移动端微调 - 不再限制输入框宽度 */
@media (max-width: 500px) {
    .chat-input-bar {
        padding: 6px 8px;
        gap: 4px;
    }
    /* 🔥 移动端按钮稍大 */
    .input-btn {
        width: 32px;
        height: 32px;
    }
    .input-btn svg {
        width: 22px;
        height: 22px;
    }
}

.send-btn {
    background: #07c160;
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    /* 🔥 移除硬编码字体大小，继承父元素设置 */
    cursor: pointer;
    font-weight: 500;
    transition: background 0.2s;
}

.send-btn:hover {
    background: #06a752;
}

.send-btn:active {
    transform: scale(0.95);
}

/* ========================================
   表情面板样式
   ======================================== */

.emoji-panel {
    padding: 8px 10px 6px;
    background: transparent; /* 🔥 去掉死白底色 */
    border-top: 0.5px solid rgba(0,0,0,0.1);
    max-height: 220px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    touch-action: pan-y;
    scrollbar-width: none;
    -ms-overflow-style: none;
}

/* 🔥 新增：隐藏滚动条 for Chrome, Safari */
.emoji-panel::-webkit-scrollbar {
    display: none;
}

.emoji-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-y;
    overscroll-behavior: contain;
    padding-top: 8px;
    scrollbar-width: none;
    -ms-overflow-style: none;
}

.emoji-scroll::-webkit-scrollbar {
    display: none;
}

.emoji-grid {
    display: grid;
    /* ✅ 响应式布局，自动填充，不再有横向滚动条 */
    grid-template-columns: repeat(auto-fill, minmax(30px, 1fr)); 
    gap: 8px;
}

.emoji-item {
    font-size: 20px;
    text-align: center;
    cursor: pointer;
    padding: 1px;
    border-radius: 4px;
    transition: background 0.2s;
}

/* ======================================== 
   表情面板标签样式（新增）
   ======================================== */

.emoji-tabs {
    display: flex;
    flex-shrink: 0;
    position: sticky;
    top: 0;
    z-index: 2;
    background: transparent; /* 🔥 去掉死白底色 */
    border-bottom: 1px solid rgba(0,0,0,0.1);
}

.emoji-tab {
    flex: 1;
    padding: 8px;
    text-align: center;
    font-size: 13px;
    color: #666;
    cursor: pointer;
    transition: all 0.2s;
    border-bottom: 2px solid transparent;
}

.emoji-tab.active {
    color: #07c160;
    border-bottom-color: #07c160;
    font-weight: 600;
}

.emoji-tab:hover {
    background: #f8f8f8;
}

/* 自定义表情样式 */
.custom-emoji-item {
    width: 34px;
    height: 34px;
    padding: 0;
    overflow: hidden;
    border-radius: 4px;
}

.custom-emoji-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.emoji-add {
    border: 2px dashed #ccc;
    color: #999;
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
}

.emoji-add:hover {
    border-color: #07c160;
    color: #07c160;
    background: #f0f9f4;
}

.emoji-item {
    font-size: 20px;
    text-align: center;
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
    transition: background 0.2s;
}

.emoji-item:hover {
    background: #f0f0f0;
}

.emoji-item:active {
    background: #e0e0e0;
}

/* ========================================
   更多功能面板样式 (已修复布局和美化)
   ======================================== */

.more-panel {
    padding: 10px 0 6px 0;
    background: transparent; /* 🔥 去掉灰白底色 */
    border-top: 0.5px solid rgba(0,0,0,0.1);
    max-height: 160px;
    overflow-y: auto;
}

.more-grid {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-start;
    padding: 0 10px; /* 🔥 缩小左右内边距 */
}

.more-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 25%;
    margin-bottom: 10px; /* 🔥 缩小行间距 */
    cursor: pointer;
    text-align: center;
    padding: 0;
}

.more-icon {
    width: 36px; /* 🔥 缩小图标框 */
    height: 36px;
    background: #fff;
    border: 1px solid #f0f0f0;
    border-radius: 8px; /* 🔥 缩小圆角 */
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    color: #333;
    margin-bottom: 4px; /* 🔥 缩小间距 */
    transition: all 0.2s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    line-height: 1;
    padding: 0;
}

/* ========================================
   图标居中和尺寸控制（合并版）
   ======================================== */
.more-icon i,
.more-icon svg {
    display: block !important;
    margin: auto !important;
    fill: currentColor;
    /* 注意：不要在这里设置 font-size、width、height */
    /* 让 HTML 中的内联样式生效 */
}

.more-item:hover .more-icon {
    background: #f8f8f8;
    transform: scale(1.05);
}

.more-item:active .more-icon {
    background: #f0f0f0;
    transform: scale(0.95);
}

.more-name {
    font-size: 10px; /* 🔥 缩小字体 */
    color: #888;
    text-align: center;
    line-height: 1.2;
}

/* 移动端响应式保持不变，但新的样式已足够灵活，这里可以留空或删除 */
@media (max-width: 500px) {
    /* 新的Flex布局已足够好，这里可以不需要特殊规则 */
    /* 如果需要微调，可以在这里添加 */
}

/* ========================================
   头像设置弹窗
   ======================================== */

.avatar-settings-modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.avatar-settings-content {
    background: #fff;
    border-radius: 12px;
    padding: 20px;
    width: 90%;
    max-width: 300px;
}

.avatar-settings-title {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 15px;
    text-align: center;
}

.avatar-preview {
    width: 80px;
    height: 80px;
    border-radius: 8px;
    background: #f0f0f0;
    margin: 0 auto 15px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 40px;
    cursor: pointer;
    position: relative;
    overflow: hidden;
}

.avatar-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.avatar-upload-btn {
    display: block;
    width: 100%;
    padding: 10px;
    background: #f0f0f0;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
    margin-bottom: 10px;
}

.remark-input {
    width: 100%;
    padding: 10px;
    border: 0.5px solid #ddd;
    border-radius: 6px;
    font-size: 14px;
    margin-bottom: 15px;
    outline: none;
}

.remark-input:focus {
    border-color: #07c160;
}

.avatar-settings-buttons {
    display: flex;
    gap: 10px;
}

.avatar-settings-buttons button {
    flex: 1;
    padding: 10px;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
}

.save-avatar-btn {
    background: #07c160;
    color: #fff;
}

.cancel-avatar-btn {
    background: #f0f0f0;
    color: #666;
}

/* ========================================
   空状态优化
   ======================================== */

.wechat-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 100px 20px;
    color: #b2b2b2;
}

.wechat-empty i {
    font-size: 64px;
    color: #ddd;
    margin-bottom: 15px;
}

/* ========================================
   滚动条美化
   ======================================== */

/* 🔥 默认隐藏 wechat-content 滚动条 */
.wechat-content {
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE and Edge */
}

.wechat-content::-webkit-scrollbar {
    display: none; /* Chrome, Safari */
}

/* 🔥 隐藏聊天消息区的滚动条 */
.chat-messages::-webkit-scrollbar {
    display: none;
}

/* 🔥 当内容区包含朋友圈时隐藏滚动条 */
.wechat-content:has(.moments-page)::-webkit-scrollbar {
    display: none;
}

.wechat-content:has(.moments-page) {
    scrollbar-width: none;
    -ms-overflow-style: none;
}

.chat-messages {
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE and Edge */
}

/* 🔥 新增：隐藏通讯录的滚动条 */
.contacts-scrollable::-webkit-scrollbar {
    display: none;
}

/* ========================================
   个人页样式优化 - 紧凑设计
   ======================================== */

.wechat-profile {
    background: linear-gradient(to bottom, #ededed 0%, #f5f5f5 100%);
    min-height: 100%;
    padding-bottom: 10px;
}

/* 个人信息卡片 */
.profile-card {
    background: #fff;
    padding: 15px 12px;
    display: flex;
    align-items: center;
    gap: 12px;
    position: relative;
}

.profile-avatar-large {
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: #fff;
    border: 1px solid #d8d8d8;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 26px;
    flex-shrink: 0;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    transition: transform 0.3s ease, box-shadow 0.3s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.profile-avatar-large:hover {
    transform: scale(1.05);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
}

.profile-avatar-large:active {
    transform: scale(0.95);
}

/* 头像编辑提示 */
.avatar-edit-hint {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-size: 10px;
    padding: 2px;
    text-align: center;
    opacity: 0;
    transition: opacity 0.3s;
}

.profile-avatar-large:hover .avatar-edit-hint {
    opacity: 1;
}

.profile-avatar-large img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
}

.profile-user-info {
    flex: 1;
}

.profile-username {
    font-size: 15px;
    font-weight: 600;
    color: #000;
    margin-bottom: 3px;
}

.profile-signature {
    font-size: 11px;
    color: #888;
    margin-bottom: 2px;
    line-height: 1.3;
}

/* 分隔线 */
.profile-divider {
    height: 6px;
    background: transparent;
}

/* 功能列表 */
.profile-functions {
    background: #fff;
}

.profile-function-item {
    display: flex;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 0.5px solid #f0f0f0;
    cursor: pointer;
    transition: background 0.2s;
}

.profile-function-item:last-child {
    border-bottom: none;
}

.profile-function-item:active {
    background: #f8f8f8;
}

.function-icon-wrapper {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 14px;
    flex-shrink: 0;
    margin-right: 10px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
}

.function-content {
    flex: 1;
}

.function-title {
    font-size: 13px;
    font-weight: 500;
    color: #000;
    margin-bottom: 1px;
}

.function-desc {
    font-size: 10px;
    color: #999;
}

.function-arrow {
    color: #c8c8c8;
    font-size: 12px;
    margin-left: 8px;
}

/* 数据统计 */
.profile-stats {
    background: #fff;
    display: flex;
    padding: 8px 0;
}

.stat-item {
    flex: 1;
    text-align: center;
}

.stat-number {
    font-size: 14px;
    font-weight: 600;
    color: #07c160;
    margin-bottom: 1px;
}

.stat-label {
    font-size: 10px;
    color: #888;
}

/* 编辑资料弹窗优化 */
.profile-edit-modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    animation: fadeIn 0.3s;
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.profile-edit-content {
    background: #fff;
    border-radius: 16px;
    padding: 25px;
    width: 90%;
    max-width: 320px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    animation: slideUp 0.3s;
}

@keyframes slideUp {
    from { transform: translateY(50px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
}

.profile-edit-title {
    font-size: 20px;
    font-weight: 600;
    text-align: center;
    margin-bottom: 20px;
    color: #000;
}

.profile-edit-avatar {
    width: 90px;
    height: 90px;
    border-radius: 12px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    margin: 0 auto 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 45px;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
    transition: transform 0.2s;
}

.profile-edit-avatar:hover {
    transform: scale(1.05);
}

.profile-edit-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.profile-edit-input {
    width: 100%;
    padding: 12px 15px;
    border: 1.5px solid #e5e5e5;
    border-radius: 8px;
    font-size: 15px;
    margin-bottom: 12px;
    box-sizing: border-box;
    transition: border-color 0.3s;
}

.profile-edit-input:focus {
    outline: none;
    border-color: #07c160;
}

.profile-edit-upload-btn {
    display: block;
    width: 100%;
    padding: 12px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    margin-bottom: 15px;
    transition: transform 0.2s, box-shadow 0.3s;
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.profile-edit-upload-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
}

.profile-edit-upload-btn:active {
    transform: translateY(0);
}

.profile-edit-buttons {
    display: flex;
    gap: 12px;
    margin-top: 20px;
}

.profile-save-btn {
    flex: 1;
    padding: 12px;
    border: none;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    background: #07c160;
    color: #fff;
    transition: background 0.2s;
}

.profile-save-btn:hover {
    background: #06a752;
}

.profile-cancel-btn {
    flex: 1;
    padding: 12px;
    border: 1.5px solid #e5e5e5;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    background: #fff;
    color: #666;
    transition: background 0.2s;
}

.profile-cancel-btn:hover {
    background: #f8f8f8;
}

/* ========================================
   📇 通讯录美化
   ======================================== */

.wechat-contacts {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #f5f5f5;
    overflow: hidden;
}

.contacts-search {
    padding: 10px 15px;
    background: #ededed;
    flex-shrink: 0;
}

.contacts-scrollable {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
}

.search-input {
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-radius: 6px;
    background: #fff;
    font-size: 14px;
    outline: none;
}

.contacts-functions {
    background: #fff;
    padding: 0;
    margin-bottom: 8px;
}

.function-item {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    cursor: pointer;
    transition: background 0.2s;
    border-bottom: 0.5px solid #e5e5e5;  /* 🔥 添加分隔线 */
}

.function-item:last-child {
    border-bottom: none;  /* 🔥 最后一个不要分隔线 */
}

.function-item:active {
    background: #f0f0f0;
}

.function-icon {
    width: 32px;
    height: 32px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 15px;
    margin-right: 10px;
}

.function-name {
    font-size: 13px;
    color: #000;
}

.contacts-list {
    background: #fff;
    /* 🔥 删除这行（如果有）：overflow-y: auto; */
}
.contacts-group {
    position: relative;
}

.group-letter {
    position: sticky;
    top: 0;
    background: #f5f5f5;
    padding: 5px 15px;
    font-size: 13px;
    font-weight: 600;
    color: #666;
    z-index: 10;
}

.contact-item {
    display: flex;
    align-items: center;
    padding: 6px 15px;
    border-bottom: 0.5px solid #e5e5e5;
    cursor: pointer;
    transition: background 0.2s;
}

.contact-item:active {
    background: #f0f0f0;
}

.contact-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #fff;
    border: 1px solid #d8d8d8;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    margin-right: 10px;
    flex-shrink: 0;
    overflow: hidden;
}

.contact-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: inherit;
}

.contact-name {
    font-size: 15px;
    color: #000;
    font-weight: 500;
}

.letter-index {
    position: absolute;
    right: 2px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    gap: 1px;
    z-index: 100;
    padding: 4px 0;
}

.letter-item {
    font-size: 10px;
    color: #667eea;
    font-weight: 600;
    cursor: pointer;
    padding: 2px 4px;
    transition: all 0.2s;
}

.letter-item:active {
    background: #667eea;
    color: #fff;
    border-radius: 50%;
}

/* 聊天背景支持 */
.chat-room {
    background-size: cover !important;
    background-position: center !important;
}

/* ========================================
   ⚙️ 设置页面开关样式
   ======================================== */

.toggle-switch {
    position: relative;
    display: inline-block;
    width: 50px;
    height: 28px;
}

.toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
}

.toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #ccc;
    transition: 0.3s;
    border-radius: 28px;
}

.toggle-slider:before {
    position: absolute;
    content: "";
    height: 20px;
    width: 20px;
    left: 4px;
    bottom: 4px;
    background-color: white;
    transition: 0.3s;
    border-radius: 50%;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.toggle-switch input:checked + .toggle-slider {
    background-color: #07c160;
}

.toggle-switch input:checked + .toggle-slider:before {
    transform: translateX(22px);
}

/* ========================================
   📸 朋友圈样式 - 高仿微信
   ======================================== */

/* 朋友圈页面容器 */
.moments-page {
    min-height: 100%;
}

/* 朋友圈顶部栏特殊样式 */
.moments-header-style {
    /* 保留按钮布局调整，不再覆盖顶部玻璃背景 */
}

/* 🔥 朋友圈头部按钮特殊样式 */
.moments-header-style .wechat-header-right {
    gap: 0;
    min-width: auto;
    align-items: center;
    padding-top: 2px;
}

.moments-header-style .wechat-header-btn {
    font-size: 13px;
    padding: 6px;
}

.moments-header-style .wechat-header-title {
    white-space: nowrap;
    text-align: center;
}

.moments-header-style .wechat-header-left {
    min-width: 30px;
}

/* 🔥 删除白色强制样式，跟随全局文字颜色 */

/* 朋友圈列表 */
.moments-feed {
    padding: 0;
    /* 🔥 移除硬编码背景，由内联样式控制 */
}

.moments-empty-tip {
    text-align: center;
    padding: 60px 20px;
    color: #999;
}

.moments-empty-tip p {
    margin: 8px 0;
}

.moments-empty-tip .tip-sub {
    font-size: 12px;
    color: #bbb;
}

/* 单条朋友圈 */
.moment-item {
    display: flex;
    padding: 12px 15px;
    border-bottom: 0.5px solid #e5e5e5;
}

/* 头像列 */
.moment-avatar-col {
    width: 44px;
    height: 44px;
    margin-right: 10px;
    flex-shrink: 0;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    overflow: hidden;
}

.moment-avatar-col img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: inherit;
}

.moment-avatar-img {
    width: 44px;
    height: 44px;
    border-radius: 6px;
    object-fit: cover;
}

.moment-avatar-emoji {
    width: 44px;
    height: 44px;
    border-radius: 6px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
}

/* 内容列 */
.moment-content-col {
    flex: 1;
    min-width: 0;
}

.moment-author {
    font-size: 15px;
    font-weight: 500;
    color: #576b95;
    margin-bottom: 4px;
}

.moment-text {
    font-size: 15px;
    color: #000;
    line-height: 1.5;
    margin-bottom: 8px;
    word-wrap: break-word;
}

/* 图片网格 */
.moment-images {
    display: grid;
    gap: 4px;
    margin-bottom: 8px;
}

.moment-images.single {
    grid-template-columns: 1fr;
    max-width: 180px;
}

.moment-images.double {
    grid-template-columns: repeat(2, 1fr);
    max-width: 180px;
}

.moment-images.quad {
    grid-template-columns: repeat(2, 1fr);
    max-width: 180px;
}

.moment-images.grid {
    grid-template-columns: repeat(3, 1fr);
    max-width: 220px;
}

.moment-img-wrapper {
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: 4px;
    background: #f5f5f5;
}

.moment-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.moment-img-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #e8e8e8;
    color: #999;
    font-size: 11px;
    text-align: center;
    padding: 4px;
    box-sizing: border-box;
}

/* 底部：时间+操作 */
.moment-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
}

.moment-time {
    font-size: 12px;
    color: #b2b2b2;
}

.moment-action-btn {
    width: 28px;
    height: 20px;
    background: #f7f7f7;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    position: relative;
}

.moment-action-btn i {
    font-size: 12px;
    color: #576b95;
}

/* 操作弹窗 - 白色玻璃风格 */
.action-popup {
    position: absolute;
    right: 30px;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-radius: 6px;
    display: flex;
    z-index: 100;
    animation: popupFade 0.15s ease;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
}

@keyframes popupFade {
    from { opacity: 0; transform: translateY(-50%) scale(0.9); }
    to { opacity: 1; transform: translateY(-50%) scale(1); }
}

.action-popup-btn {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 5px 10px;
    color: #576b95;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
}

.action-popup-btn:first-child {
    border-right: 1px solid #e5e5e5;
}

.action-popup-btn i {
    font-size: 10px;
}

.action-popup-btn:active {
    background: rgba(0, 0, 0, 0.05);
}

/* 互动区（点赞+评论） */
.moment-interactions {
    background: #f7f7f7;
    border-radius: 4px;
    overflow: hidden;
}

.interaction-likes {
    padding: 6px 10px;
    display: flex;
    align-items: flex-start;
    gap: 6px;
    border-bottom: 0.5px solid #e5e5e5;
}

.interaction-likes i {
    color: #576b95;
    font-size: 12px;
    margin-top: 2px;
}

.like-names {
    font-size: 13px;
    color: #576b95;
    line-height: 1.4;
}

.interaction-comments {
    padding: 6px 10px;
}

.comment-row {
    font-size: 13px;
    line-height: 1.5;
    margin-bottom: 2px;
    cursor: pointer;
    padding: 2px 4px;
    margin-left: -4px;
    margin-right: -4px;
    border-radius: 4px;
    transition: background 0.2s;
}

.comment-row:hover {
    background: rgba(0, 0, 0, 0.05);
}

.comment-row:active {
    background: rgba(0, 0, 0, 0.1);
}

.comment-row:last-child {
    margin-bottom: 0;
}

.comment-author {
    color: #576b95;
    font-weight: 500;
}

.comment-reply {
    color: #000;
    margin: 0 4px;
}

.comment-colon {
    color: #000;
}

.comment-content {
    color: #000;
}

/* ========================================
   📝 朋友圈内嵌评论输入框
   ======================================== */

.inline-comment-box {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    background: #fff;
    border-top: 0.5px solid #e5e5e5;
    margin-top: 4px;
}

.inline-comment-input {
    flex: 1;
    padding: 6px 10px;
    border: 0.5px solid #ddd;
    border-radius: 4px;
    font-size: 13px;
    background: #f7f7f7;
    outline: none;
    min-width: 0;
}

.inline-comment-input:focus {
    border-color: #576b95;
    background: #fff;
}

.inline-comment-send {
    background: none;
    color: #576b95;
    border: none;
    font-size: 18px;
    cursor: pointer;
    flex-shrink: 0;
    padding: 4px 8px;
}

.inline-comment-send:active {
    color: #4a5a7a;
}

/* 🔥 禁止朋友圈下拉刷新 */
.moments-page {
    overscroll-behavior: none !important;
    -webkit-overflow-scrolling: touch;
    /* 🔥 隐藏滚动条 */
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE and Edge */
    /* 🔥 相对定位，让评论输入框能正确定位 */
    position: relative;
    height: 100%;
    overflow-y: auto;
}

.moments-page::-webkit-scrollbar {
    display: none;
}

/* 🔥 朋友圈内容区也隐藏滚动条 */
.moments-feed {
    scrollbar-width: none;
    -ms-overflow-style: none;
}

.moments-feed::-webkit-scrollbar {
    display: none;
}

/* ========================================
   其他组件样式保持原样
   ======================================== */

/* 这里保留原有的发现页、个人页、通讯录、朋友圈等样式... */

/* 🔥 只要手机屏幕内存在聊天输入区，就自动隐藏底部的 Home 指示器三个点 */
.phone-screen:has(.chat-input-area) .phone-home-indicator {
    display: none !important;
}
        `;
            document.head.appendChild(style);
        }
    }

    _getMainShellBackgroundConfig() {
        const rawBg = String(this.wechatData?.getUserInfo?.()?.chatListBackground || '').trim();
        if (!rawBg) {
            return {
                appClass: 'wechat-app',
                appStyle: '',
                contentBgStyle: ''
            };
        }

        let appStyle = '';
        if (rawBg.startsWith('data:') || rawBg.startsWith('/') || rawBg.startsWith('http')) {
            appStyle = `background-image: url('${rawBg}'); background-size: cover; background-position: center;`;
        } else {
            appStyle = `background: ${rawBg};`;
        }

        return {
            appClass: 'wechat-app wechat-main-shell wechat-chatlist-bg-enabled',
            appStyle,
            contentBgStyle: 'background: transparent;'
        };
    }

    // 显示提示词编辑器
    showPromptEditor(app, feature) {
        const promptManager = window.VirtualPhone?.promptManager;

        // 🔥 确保提示词已加载（修复懒加载导致的 null 问题）
        if (promptManager && !promptManager._loaded) {
            promptManager.ensureLoaded();
        }

        let prompt = promptManager?.prompts?.[app]?.[feature];


        // 🔥 如果提示词不存在，尝试从默认配置获取
        if (!prompt) {
            console.warn('⚠️ 提示词不存在，尝试从默认配置获取');
            const defaults = promptManager?.getDefaultPrompts();
            prompt = defaults?.[app]?.[feature];

            // 如果默认配置有，则添加到当前配置
            if (prompt && promptManager?.prompts?.[app]) {
                promptManager.prompts[app][feature] = { ...prompt };
                promptManager.savePrompts();
            }
        }

        if (!prompt) {
            console.error('❌ 无法找到提示词:', app, feature);
            this.phoneShell.showNotification('错误', '无法找到该提示词配置', '❌');
            return;
        }
        const shellBg = this._getMainShellBackgroundConfig();
        const editorContentStyle = `${shellBg.contentBgStyle || 'background: #ededed;'} padding: 15px;`;

        const html = `
        <div class="${shellBg.appClass}" style="${shellBg.appStyle}">
            <div class="wechat-header">
                <div class="wechat-header-left">
                    <button class="wechat-back-btn" id="back-from-editor">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                </div>
                <div class="wechat-header-title">编辑提示词</div>
                <div class="wechat-header-right">
                    <button class="wechat-header-btn" id="copy-prompt" style="color: #07c160; font-size: 14px;">
                        复制
                    </button>
                </div>
            </div>
            
            <div class="wechat-content" style="${editorContentStyle}">
                <div style="background: #fff; border-radius: 12px; padding: 15px;">
                    <div style="font-size: 16px; font-weight: 500; margin-bottom: 8px;">
                        ${prompt.name}
                    </div>
                    <div style="font-size: 12px; color: #666; margin-bottom: 15px;">
                        ${prompt.description}
                    </div>
                    
                    <textarea id="prompt-editor" style="
                        width: 100%;
                        min-height: 300px;
                        padding: 12px;
                        border: 1px solid #e5e5e5;
                        border-radius: 8px;
                        font-size: 14px;
                        font-family: monospace;
                        resize: vertical;
                        box-sizing: border-box;
                    ">${prompt.content}</textarea>
                    
                    <div style="margin-top: 15px; display: flex; gap: 10px;">
                        <button id="reset-prompt" style="
                            flex: 1;
                            padding: 10px;
                            background: #f0f0f0;
                            color: #666;
                            border: none;
                            border-radius: 6px;
                            font-size: 14px;
                            cursor: pointer;
                        ">恢复默认</button>

                        <button id="save-prompt" style="
                            flex: 1;
                            padding: 10px;
                            background: #07c160;
                            color: #fff;
                            border: none;
                            border-radius: 6px;
                            font-size: 14px;
                            cursor: pointer;
                        ">保存</button>
                    </div>
                </div>
            </div>
        </div>
    `;

        this.phoneShell.setContent(html);

        // 返回按钮
        document.getElementById('back-from-editor')?.addEventListener('click', () => {
            this.showSettings();
        });

        // 保存按钮
        document.getElementById('save-prompt')?.addEventListener('click', () => {
            const content = document.getElementById('prompt-editor').value;
            promptManager?.updatePrompt(app, feature, content);
            this.phoneShell.showNotification('保存成功', '提示词已更新', '✅');
        });

        // 恢复默认按钮
        document.getElementById('reset-prompt')?.addEventListener('click', () => {
            const defaultPrompts = promptManager?.getDefaultPrompts();
            const defaultContent = defaultPrompts?.[app]?.[feature]?.content || '';
            document.getElementById('prompt-editor').value = defaultContent;
            this.phoneShell.showNotification('已恢复', '已恢复为默认提示词', '🔄');
        });

        // 复制按钮
        document.getElementById('copy-prompt')?.addEventListener('click', () => {
            const textarea = document.getElementById('prompt-editor');
            textarea.select();
            document.execCommand('copy');
            this.phoneShell.showNotification('已复制', '提示词已复制到剪贴板', '📋');
        });
    }

    // 🔥 新增：批量添加联系人（支持AI生成的联系人）
    addContacts(contactsArray) {
        if (!Array.isArray(contactsArray)) {
            console.error('❌ addContacts 参数必须是数组');
            return;
        }

        let addedCount = 0;

        contactsArray.forEach(contact => {
            // 检查是否已存在
            const exists = this.wechatData.getContacts().find(c => c.name === contact.name);

            if (!exists) {
                this.wechatData.addContact({
                    id: `contact_${Date.now()}_${Math.random()}`,
                    name: contact.name,
                    avatar: contact.avatar || '👤',
                    remark: contact.remark || '',
                    relation: contact.relation || '',
                    letter: this.wechatData.getFirstLetter(contact.name)
                });
                addedCount++;
            }
        });

        if (addedCount > 0) {

            // 如果当前在通讯录页面，刷新界面
            if (this.currentView === 'contacts') {
                this.render();
            }
        }

        return addedCount;
    }

    render() {
        // 🔥 终极修复：强制从存储重新加载数据，彻底解决前后台实例脱步（Desync）问题
        // 🔥🔥🔥 核心修复：loadData() 返回 messages:{} 空对象（懒加载机制），
        // 所以必须同时重置 _messagesLoaded 标记，否则 getMessages() 会误以为已加载而跳过从存储读取！
        this.wechatData._messagesLoaded = {};
        this.wechatData._messagesDirty = {};
        this.wechatData.data = this.wechatData.loadData();

        // 🔥🔥🔥 核心修复：loadData() 后 currentChat 仍指向旧对象，必须重新绑定到新数据中的同ID聊天！
        // 否则 currentChat.unread = 0 只修改了旧对象，新数据中的未读数不变，红点无法消除。
        if (this.currentChat) {
            const refreshedChat = this.wechatData.getChat(this.currentChat.id);
            if (refreshedChat) {
                this.currentChat = refreshedChat;
            }
        }

        this._wechatPanelMode = 'main';
        this._isAvatarManagerOpen = false;
        this._applyCustomChatStyle(this._getUserCustomChatCss());
        const chatList = this.wechatData.getChatList();

        // 🔥 强制消红点：只要用户看到了这个聊天，立即清空未读
        if (this.currentChat && this.currentChat.unread > 0) {
            this.currentChat.unread = 0;
            this.wechatData.saveData();
        }

        // 重新计算真实的未读总数
        const unreadCount = chatList.reduce((sum, chat) => sum + chat.unread, 0);

        // 🔥 始终同步最新的未读总数到全局 App 图标
        if (window.VirtualPhone?.home) {
            const apps = window.VirtualPhone.home.apps;
            if (apps) {
                const wechatAppIcon = apps.find(a => a.id === 'wechat');
                if (wechatAppIcon && wechatAppIcon.badge !== unreadCount) {
                    wechatAppIcon.badge = unreadCount;
                    window.dispatchEvent(new CustomEvent('phone:updateGlobalBadge'));

                    // 🔥 核心修复：必须持久化存储修改后的全局角标，否则页面刷新又会把旧的错误角标读出来
                    if (window.VirtualPhone.storage) {
                        window.VirtualPhone.storage.saveApps(apps);
                    }
                }
            }
        }

        // 根据当前视图决定顶部栏内容
        const getHeaderTitle = () => {
            if (this.currentChat) {
                // 🔥 群聊：标题可点击，显示群人数（+1 代表用户自己）
                if (this.currentChat.type === 'group') {
                    const memberCount = (this.currentChat.members?.length || 0) + 1;
                    const shortName = this.getShortGroupName(this.currentChat.name, 6);
                    return `<span id="group-header-title" style="cursor: pointer;">${shortName}<span style="color:#666;">(${memberCount})</span></span>`;
                }
                const currentContact = this.currentChat.contactId
                    ? this.wechatData.getContact(this.currentChat.contactId)
                    : this.wechatData.getContactByName(this.currentChat.name);
                const isHoneyContact = currentContact?.sourceApp === 'honey' || currentContact?.sourceLabel === '蜜语';
                if (!isHoneyContact) return this.currentChat.name;
                return `
                    <span style="position:relative; display:inline-flex; align-items:center; justify-content:center; line-height:1.1; overflow:visible;">
                        <span style="position:absolute; left:50%; top:-11px; transform:translateX(-50%); display:inline-flex; align-items:center; gap:3px; padding:1px 5px; border-radius:999px; background:rgba(255,105,180,0.14); color:#ff5fa2; font-size:8px; line-height:1; border:1px solid rgba(255,105,180,0.24); white-space:nowrap;">
                            <i class="fa-solid fa-heart" style="font-size:7px;"></i>蜜语
                        </span>
                        <span>${this.currentChat.name}</span>
                    </span>
                `;
            }
            if (this.currentView === 'discover') return '朋友圈';
            return '微信';
        };

        const getHeaderRight = () => {
            if (this.currentChat) {
                return `<button class="wechat-header-btn" id="chat-info">
                    <i class="fa-solid fa-ellipsis"></i>
                </button>`;
            }
            if (this.currentView === 'discover') {
                return `
                    <button class="wechat-header-btn" id="moments-post-btn" title="发朋友圈">
                        <i class="fa-solid fa-camera"></i>
                    </button>
                    <button class="wechat-header-btn" id="moments-bg-btn" title="更换背景">
                        <i class="fa-solid fa-image"></i>
                    </button>
                    <button class="wechat-header-btn" id="moments-refresh" title="刷新朋友圈">
                        <i class="fa-solid fa-rotate"></i>
                    </button>`;
            }
            return `
                <button class="wechat-header-btn" id="wechat-search">
                    <i class="fa-solid fa-search"></i>
                </button>
                <button class="wechat-header-btn" id="wechat-add">
                    <i class="fa-solid fa-plus"></i>
                </button>
            `;
        };

        const userInfo = this.wechatData.getUserInfo();
        const isMainRootView = !this.currentChat;
        const chatListBg = String(userInfo?.chatListBackground || '').trim();
        const hasMainShellBackground = isMainRootView && !!chatListBg;

        // 🔥 新增：把背景贴在整个APP最底层
        let appBgStyle = '';
        if (this.currentChat) {
            const globalBg = userInfo.globalChatBackground;
            const targetBg = this.currentChat.background || globalBg || '#ededed';
            if (targetBg.startsWith('data:') || targetBg.startsWith('/') || targetBg.startsWith('http')) {
                appBgStyle = `background-image: url('${targetBg}'); background-size: cover; background-position: center;`;
            } else {
                appBgStyle = `background: ${targetBg};`;
            }
        } else if (hasMainShellBackground) {
            if (chatListBg.startsWith('data:') || chatListBg.startsWith('/') || chatListBg.startsWith('http')) {
                appBgStyle = `background-image: url('${chatListBg}'); background-size: cover; background-position: center;`;
            } else {
                appBgStyle = `background: ${chatListBg};`;
            }
        }

        const headerClass = [
            'wechat-header',
            this.currentView === 'discover' ? 'moments-header-style' : '',
            isMainRootView ? 'wechat-header-chatlist-glass' : ''
        ].filter(Boolean).join(' ');
        const appClass = [
            'wechat-app',
            isMainRootView ? 'wechat-main-shell' : '',
            hasMainShellBackground ? 'wechat-chatlist-bg-enabled' : ''
        ].filter(Boolean).join(' ');
        const contentBgStyle = (this.currentChat || hasMainShellBackground) ? 'background: transparent;' : '';

        const html = `
            <div class="${appClass}" style="${appBgStyle}">
                <!-- 顶部栏 -->
                <div class="${headerClass}">
                    <div class="wechat-header-left">
                        ${this.currentChat ? `
                            <button class="wechat-back-btn" id="wechat-back">
                                <i class="fa-solid fa-chevron-left"></i>
                            </button>
                        ` : ''}
                    </div>
                    <div class="wechat-header-title">
                        <span class="wechat-header-title-text">
                            ${getHeaderTitle()}
                            ${this.currentChat ? `<span class="status-dot ${this.chatView?.getHeaderStatusDotClass?.(this.currentChat.id) || 'dot-green'}"></span>` : ''}
                        </span>
                        ${unreadCount > 0 && !this.currentChat && this.currentView !== 'discover' ? `<span class="header-badge">(${unreadCount})</span>` : ''}
                    </div>
                    <div class="wechat-header-right">
                        ${getHeaderRight()}
                    </div>
                </div>

                <!-- 内容区 (如果在聊天中，让内容区变透明以透出底部背景) -->
                <div class="wechat-content" id="wechat-content" style="${contentBgStyle}">
                    ${this.renderContent()}
                </div>

                <!-- 底部导航（主页才显示）-->
                ${!this.currentChat ? `
                    <div class="wechat-tabbar">
                        <div class="wechat-tab ${this.currentView === 'chats' ? 'active' : ''}" data-view="chats">
                            <i class="fa-solid fa-comment"></i>
                            <span>微信</span>
                            ${unreadCount > 0 ? `<span class="tab-badge">${unreadCount}</span>` : ''}
                        </div>
                        <div class="wechat-tab ${this.currentView === 'contacts' ? 'active' : ''}" data-view="contacts">
                            <i class="fa-solid fa-address-book"></i>
                            <span>通讯录</span>
                        </div>
                        <div class="wechat-tab ${this.currentView === 'discover' ? 'active' : ''}" data-view="discover">
                            <i class="fa-solid fa-circle-nodes"></i>
                            <span>朋友圈</span>
                        </div>
                        <div class="wechat-tab ${this.currentView === 'me' ? 'active' : ''}" data-view="me">
                            <i class="fa-solid fa-user"></i>
                            <span>我</span>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;

        // 🔥 让4个主页面共享同一个底层 ID，防止互相切换时不断增加历史记录栈
        const viewId = this.currentChat ? `wechat-chat-${this.currentChat.id}` : `wechat-main`;
        this.phoneShell.setContent(html, viewId);
        this.bindEvents();

        if (this.currentView === 'contacts' && !this.currentChat) {
            setTimeout(() => {
                this.contactsView.bindEvents();
            }, 50);
        }
    }

    // ========================================
    // 🔥 头像渲染辅助函数
    // ========================================
    _getWechatBaseUrl() {
        const normalizeBase = (value) => {
            const raw = String(value || '').trim();
            if (!raw) return '';
            return raw.endsWith('/') ? raw : `${raw}/`;
        };

        const configured = normalizeBase(window.VirtualPhone?.extensionBaseUrl);
        if (configured) return configured;

        const metaBase = normalizeBase(new URL('../../', import.meta.url).href);
        const runtimePath = String(window.location?.pathname || '');
        const runtimeMatch = runtimePath.match(/(\/scripts\/extensions\/third-party\/)([^/]+)(\/)/i);
        const metaMatch = metaBase.match(/(\/scripts\/extensions\/third-party\/)([^/]+)(\/)/i);
        if (!runtimeMatch || !metaMatch || runtimeMatch[2] === metaMatch[2]) {
            return metaBase;
        }

        return metaBase.replace(metaMatch[0], `${metaMatch[1]}${runtimeMatch[2]}${metaMatch[3]}`);
    }

    _getWechatAssetUrl(relPath) {
        const safeRel = String(relPath || '').replace(/^\/+/, '');
        const base = this._getWechatBaseUrl();
        return new URL(`apps/wechat/${safeRel}`, base).href;
    }

    _resolveWechatAvatarAssetUrl(inputPath) {
        const raw = String(inputPath || '').trim().replace(/\\/g, '/');
        if (!raw || raw.includes('..')) return '';
        if (/^(?:https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('/')) {
            return raw;
        }
        return this._getWechatAssetUrl(`avatars/${raw.replace(/^\.?\//, '')}`);
    }

    _normalizeWechatAvatarList(list) {
        const src = Array.isArray(list) ? list : [];
        const out = [];
        const seen = new Set();
        src.forEach((item) => {
            const resolved = this._resolveWechatAvatarAssetUrl(item);
            if (!resolved || seen.has(resolved)) return;
            seen.add(resolved);
            out.push(resolved);
        });
        return out;
    }

    _normalizeWechatAvatarPool(rawPayload) {
        const payload = (rawPayload && typeof rawPayload === 'object') ? rawPayload : {};
        const male = this._normalizeWechatAvatarList([
            ...(Array.isArray(payload.male) ? payload.male : []),
            ...(Array.isArray(payload.maleAvatars) ? payload.maleAvatars : [])
        ]);
        const female = this._normalizeWechatAvatarList([
            ...(Array.isArray(payload.female) ? payload.female : []),
            ...(Array.isArray(payload.femaleAvatars) ? payload.femaleAvatars : [])
        ]);
        const all = this._normalizeWechatAvatarList([
            ...(Array.isArray(payload.all) ? payload.all : []),
            ...male,
            ...female
        ]);
        return { male, female, all };
    }

    async _probeAvatarUrlExists(url) {
        const target = String(url || '').trim();
        if (!target) return false;
        try {
            let resp = await fetch(target, { method: 'HEAD', cache: 'no-cache' });
            if (resp.ok) return true;
            if (resp.status === 405 || resp.status === 403) {
                resp = await fetch(target, { method: 'GET', cache: 'no-cache' });
                return !!resp.ok;
            }
        } catch (e) {
            return false;
        }
        return false;
    }

    async _discoverWechatAvatarSeries(prefix, maxCount = 200) {
        const safePrefix = String(prefix || '').trim().toLowerCase();
        if (!safePrefix) return [];
        const exts = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
        const out = [];
        let missBeforeStart = 0;
        let missStreakAfterStart = 0;
        let hasFoundAny = false;

        for (let idx = 1; idx <= maxCount; idx++) {
            const num = String(idx).padStart(3, '0');
            let foundUrl = '';
            for (const ext of exts) {
                const url = this._getWechatAssetUrl(`avatars/${safePrefix}${num}.${ext}`);
                // eslint-disable-next-line no-await-in-loop
                const exists = await this._probeAvatarUrlExists(url);
                if (exists) {
                    foundUrl = url;
                    break;
                }
            }

            if (foundUrl) {
                out.push(foundUrl);
                hasFoundAny = true;
                missStreakAfterStart = 0;
                continue;
            }

            if (!hasFoundAny) {
                missBeforeStart += 1;
                if (missBeforeStart >= 6) break;
            } else {
                missStreakAfterStart += 1;
                if (missStreakAfterStart >= 8) break;
            }
        }

        return out;
    }

    _hashText(text) {
        const input = String(text || '');
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            hash = ((hash << 5) - hash) + input.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    }

    _getAvatarPoolByGender(gender = 'unknown') {
        const safeGender = String(gender || '').trim().toLowerCase();
        const male = Array.isArray(this._avatarPool?.male) ? this._avatarPool.male : [];
        const female = Array.isArray(this._avatarPool?.female) ? this._avatarPool.female : [];
        const all = Array.isArray(this._avatarPool?.all) ? this._avatarPool.all : [];

        if (safeGender === 'male' && male.length > 0) return male;
        if (safeGender === 'female' && female.length > 0) return female;
        if (all.length > 0) return all;
        if (male.length > 0 || female.length > 0) return [...male, ...female];
        return [];
    }

    _isCustomAvatarValue(avatarStr = '') {
        const raw = String(avatarStr || '').trim();
        if (!raw) return false;
        return raw.startsWith('data:image')
            || raw.startsWith('http://')
            || raw.startsWith('https://')
            || raw.startsWith('/');
    }

    _resolveContactGenderByName(name = '') {
        const safeName = String(name || '').trim();
        if (!safeName) return 'unknown';
        const contact = this.wechatData?.getContactByName?.(safeName);
        if (!contact) return 'unknown';
        return this.wechatData?.getContactGender?.(contact.id || safeName) || 'unknown';
    }

    _pickRandomAvatarFromPool(pool = []) {
        if (!Array.isArray(pool) || pool.length === 0) return '';
        const idx = Math.floor(Math.random() * pool.length);
        return String(pool[idx] || '').trim();
    }

    _collectUsedAutoAvatarsInPool(pool = [], ignoreContactId = '') {
        const out = new Set();
        if (!Array.isArray(pool) || pool.length === 0) return out;
        const contacts = Array.isArray(this.wechatData?.getContacts?.()) ? this.wechatData.getContacts() : [];
        const poolSet = new Set(pool);
        contacts.forEach((contact) => {
            const contactId = String(contact?.id || '').trim();
            if (!contactId || contactId === ignoreContactId) return;
            if (this._isCustomAvatarValue(contact?.avatar || '')) return;
            const assigned = String(this.wechatData?.getContactAutoAvatar?.(contactId) || '').trim();
            if (assigned && poolSet.has(assigned)) {
                out.add(assigned);
            }
        });
        return out;
    }

    _resolveAutoAvatarForName(name = '', gender = 'unknown') {
        const safeName = String(name || '').trim();
        if (!safeName || !this._avatarPoolLoaded) return '';
        const pool = this._getAvatarPoolByGender(gender);
        if (!Array.isArray(pool) || pool.length === 0) return '';

        const contact = this.wechatData?.getContactByName?.(safeName);
        const contactId = String(contact?.id || '').trim();

        // 非通讯录临时对象：使用稳定映射，避免每次重绘随机跳变
        if (!contactId) {
            const idx = this._hashText(`${safeName}|${gender}`) % pool.length;
            return String(pool[idx] || '').trim();
        }

        const existing = String(this.wechatData?.getContactAutoAvatar?.(contactId) || '').trim();
        const poolSet = new Set(pool);
        const usedByOthers = this._collectUsedAutoAvatarsInPool(pool, contactId);

        // 已分配头像仍有效且未与他人冲突，直接复用
        if (existing && poolSet.has(existing) && !usedByOthers.has(existing)) {
            return existing;
        }

        // 优先选未被其他角色占用的头像；池耗尽后允许复用
        const available = pool.filter(url => !usedByOthers.has(url));
        const candidatePool = available.length > 0 ? available : pool;
        const picked = this._pickRandomAvatarFromPool(candidatePool);
        if (picked) {
            this.wechatData?.setContactAutoAvatar?.(contactId, picked);
        }
        return picked;
    }

    _shouldApplyContactPoolAvatar(defaultEmoji = '👤', fallbackName = '') {
        if (String(defaultEmoji || '') === '👥') return false;
        const safeName = String(fallbackName || '').trim();
        if (!safeName) return false;
        const selfName = String(this.wechatData?.getUserInfo?.()?.name || '').trim();
        return !selfName || safeName !== selfName;
    }

    _ensureWechatAvatarPoolLoaded() {
        if (this._avatarPoolLoaded || this._avatarPoolLoading) return;
        this._avatarPoolLoading = true;
        const manifestUrl = this._getWechatAssetUrl('avatars/manifest.json?v=20260409-01');

        const finalize = (pool) => {
            this._avatarPool = this._normalizeWechatAvatarPool(pool);
            this._avatarPoolLoaded = true;
            this._avatarPoolLoading = false;
            const isWechatActive = !!document.querySelector('.phone-view-current .wechat-app');
            const isCallOverlayVisible = !!document.querySelector('.phone-view-current .call-fullscreen');

            if (this._wechatPanelMode === 'avatar-manager' || this._isAvatarManagerOpen) {
                this.showAvatarManager();
                return;
            }

            // 仅在微信主界面可见且不在通话全屏时刷新，避免打断设置页/通话页
            if (this._wechatPanelMode === 'main' && isWechatActive && !isCallOverlayVisible) {
                this.render();
            }
        };

        fetch(manifestUrl, { cache: 'no-cache' })
            .then(resp => (resp.ok ? resp.text() : ''))
            .then(async (rawText) => {
                let payload = null;
                try {
                    const normalizedText = String(rawText || '').replace(/^\uFEFF/, '').trim();
                    payload = normalizedText ? JSON.parse(normalizedText) : null;
                } catch (e) {
                    payload = null;
                }

                let pool = this._normalizeWechatAvatarPool(payload);
                if (pool.male.length === 0 && pool.female.length === 0 && pool.all.length === 0) {
                    const [male, female] = await Promise.all([
                        this._discoverWechatAvatarSeries('male', 200),
                        this._discoverWechatAvatarSeries('female', 200)
                    ]);
                    pool = this._normalizeWechatAvatarPool({ male, female });
                }
                finalize(pool);
            })
            .catch(() => finalize(null));
    }

    renderAvatar(avatar, defaultEmoji = '👤', fallbackName = '') {
        const avatarStr = String(avatar || '').trim();
        this._ensureWechatAvatarPoolLoaded();

        // 用户自定义头像优先
        if (this._isCustomAvatarValue(avatarStr)) {
            return `<img src="${avatarStr}" style="display:block;width:100%;height:100%;object-fit:cover;border:none;outline:none;box-shadow:none;">`;
        }

        // 联系人头像池：无自定义头像时，按性别随机分配（稳定映射）
        if (this._shouldApplyContactPoolAvatar(defaultEmoji, fallbackName)) {
            const resolvedGender = this._resolveContactGenderByName(fallbackName);
            const autoAvatar = this._resolveAutoAvatarForName(fallbackName, resolvedGender);
            if (autoAvatar) {
                return `<img src="${autoAvatar}" style="display:block;width:100%;height:100%;object-fit:cover;border:none;outline:none;box-shadow:none;border-radius:inherit;">`;
            }
        }

        const pickFirstChar = (text) => {
            const arr = Array.from(String(text || '').trim());
            return arr.length > 0 ? arr[0] : '';
        };
        const isEmojiLike = (text) => /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u.test(String(text || ''));
        const escapeHtml = (text) => String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        // 优先使用显示名首字；其次使用非emoji头像文本首字
        let initial = pickFirstChar(fallbackName);
        if (!initial && avatarStr && !isEmojiLike(avatarStr)) {
            initial = pickFirstChar(avatarStr);
        }

        if (!initial) {
            if (defaultEmoji === '👥') {
                initial = '群';
            } else {
                initial = '我';
            }
        }

        return `<div style="position:relative;width:100%;height:100%;background:#fff;color:#000;border:none;outline:none;box-shadow:none;"><span style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);line-height:1;white-space:nowrap;">${escapeHtml(initial)}</span></div>`;
    }

    // 群名显示：超过6个字时缩写，人数不参与缩写
    getShortGroupName(name, maxLen = 6) {
        const chars = Array.from(String(name || '').trim());
        if (chars.length <= maxLen) return chars.join('');
        return `${chars.slice(0, maxLen).join('')}...`;
    }

    renderContent() {
        if (this.currentChat) {
            return this.chatView.renderChatRoom(this.currentChat);
        }

        switch (this.currentView) {
            case 'chats':
                return this.renderChatList();
            case 'contacts':
                return this.contactsView.render();
            case 'discover':
                return this.renderDiscover();
            case 'me':
                return this.renderProfile();
            default:
                return this.renderChatList();
        }
    }

    renderChatList() {
        const chats = this.wechatData.getChatList();

        if (chats.length === 0) {
            return `
                <div class="wechat-empty">
                    <i class="fa-solid fa-comments" style="font-size: 48px; color: #ccc;"></i>
                    <p>暂无聊天</p>
                </div>
            `;
        }

        return `
            <div class="wechat-chat-list">
                ${chats.map(chat => `
                    <div class="chat-item" data-chat-id="${chat.id}">
                        <div class="chat-avatar">
                            ${this.renderAvatar(chat.avatar, chat.type === 'group' ? '👥' : '👤', chat.name)}
                        </div>
                        <div class="chat-info">
                            <div class="chat-name">
                                ${chat.type === 'group' ? this.getShortGroupName(chat.name, 6) : chat.name}
                                ${chat.type === 'group' ? `<span class="group-count">(${(chat.members?.length || 0) + 1})</span>` : ''}
                            </div>
                            <div class="chat-last-msg">${chat.lastMessage || '暂无消息'}</div>
                        </div>
                        <div class="chat-meta">
                            <div class="chat-time">${chat.time || '刚刚'}</div>
                            ${chat.unread > 0 ? `<span class="chat-badge">${chat.unread > 99 ? '99+' : chat.unread}</span>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderDiscover() {
        // 直接渲染朋友圈
        return this.momentsView.renderMomentsPage();
    }

    renderProfile() {
        const userInfo = this.wechatData.getUserInfo();
        return `
        <div class="wechat-profile">
            <!-- 🎨 个人信息卡片 -->
            <div class="profile-card">
                <div class="profile-avatar-large" id="edit-avatar-btn">
                    ${this.renderAvatar(userInfo.avatar, '😊', userInfo.name)}
                    <div class="avatar-edit-hint">
                        <i class="fa-solid fa-camera"></i>
                    </div>
                </div>
                <div class="profile-user-info">
                    <div class="profile-username">${userInfo.name || '用户'}</div>
                    <div class="profile-signature">${userInfo.signature || '设置个性签名'}</div>
                </div>
            </div>

            <div class="profile-divider"></div>

            <!-- 🔧 功能区 -->
            <div class="profile-functions">
                <div class="profile-function-item" id="wechat-wallet-btn">
                    <div class="function-icon-wrapper" style="background: rgba(255,255,255,0.6); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.3);">
                        <i class="fa-solid fa-wallet" style="color: #666;"></i>
                    </div>
                    <div class="function-content">
                        <div class="function-title">服务</div>
                        <div class="function-desc">钱包、资产评估</div>
                    </div>
                    <div class="function-arrow">
                        <i class="fa-solid fa-chevron-right"></i>
                    </div>
                </div>

                <div class="profile-function-item" id="smart-load-contacts">
                    <div class="function-icon-wrapper" style="background: rgba(255,255,255,0.6); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.3);">
                        <i class="fa-solid fa-user-group" style="color: #666;"></i>
                    </div>
                    <div class="function-content">
                        <div class="function-title">智能加载联系人</div>
                        <div class="function-desc">从角色卡和聊天记录生成</div>
                    </div>
                    <div class="function-arrow">
                        <i class="fa-solid fa-chevron-right"></i>
                    </div>
                </div>

                <div class="profile-function-item" id="edit-profile-btn">
                    <div class="function-icon-wrapper" style="background: rgba(255,255,255,0.6); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.3);">
                        <i class="fa-solid fa-user-pen" style="color: #666;"></i>
                    </div>
                    <div class="function-content">
                        <div class="function-title">编辑个人资料</div>
                        <div class="function-desc">修改昵称、头像、签名</div>
                    </div>
                    <div class="function-arrow">
                        <i class="fa-solid fa-chevron-right"></i>
                    </div>
                </div>

                <div class="profile-function-item" id="wechat-settings-btn">
                    <div class="function-icon-wrapper" style="background: rgba(255,255,255,0.6); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.3);">
                        <i class="fa-solid fa-gear" style="color: #666;"></i>
                    </div>
                    <div class="function-content">
                        <div class="function-title">设置</div>
                        <div class="function-desc">通用、隐私、数据管理</div>
                    </div>
                    <div class="function-arrow">
                        <i class="fa-solid fa-chevron-right"></i>
                    </div>
                </div>
            </div>
            
            <!-- 📊 数据统计（可选显示） -->
            <div class="profile-divider"></div>
            <div class="profile-stats">
                <div class="stat-item">
                    <div class="stat-number">${this.wechatData.getContacts().length}</div>
                    <div class="stat-label">联系人</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number">${this.wechatData.getChatList().length}</div>
                    <div class="stat-label">聊天</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number">${this.wechatData.getMoments().length}</div>
                    <div class="stat-label">朋友圈</div>
                </div>
            </div>
        </div>
    `;
    }

    bindEvents() {
        // 🔥🔥 统一管理事件监听，避免重复绑定 🔥🔥
        const addClickListener = (selector, handler) => {
            // 🔥 核心修复1：强制在当前可视图层中查找元素，防止被历史栈中残留的隐藏旧页面拦截事件！
            const currentView = document.querySelector('.phone-view-current') || document;
            const element = currentView.querySelector(selector);
            if (element) element.onclick = handler; // 🔥 使用 onclick 覆盖
        };

        // 首页的“+”号和搜索按钮
        addClickListener('#wechat-search', () => this.showSearch());
        addClickListener('#wechat-add', () => this.showAddFriendMenu());

        // 通用返回按钮
        addClickListener('#wechat-back', () => {
            if (this.currentChat) {
                this.currentChat = null;
                this.render();
            } else {
                window.dispatchEvent(new CustomEvent('phone:goHome'));
            }
        });

        // 底部导航切换
        document.querySelectorAll('.wechat-tab').forEach(tab => {
            tab.onclick = (e) => {
                const view = e.currentTarget.dataset.view;
                if (view) {
                    this.currentView = view;
                    this.render();
                }
            };
        });

        // 聊天列表点击
        document.querySelectorAll('.wechat-chat-list .chat-item').forEach(item => {
            item.onclick = (e) => {
                const chatId = e.currentTarget.dataset.chatId;
                if (chatId) {
                    this.openChat(chatId);
                }
            };
        });
        this.bindChatListLongPressDelete();

        // "发现"页面现在直接是朋友圈，绑定朋友圈事件
        if (this.currentView === 'discover') {
            this.momentsView.bindMomentsEvents();

            // 🔥 发朋友圈按钮
            addClickListener('#moments-post-btn', () => this.momentsView.showPostMomentPage());
        }

        // “我”页面的功能入口
        addClickListener('#edit-avatar-btn', () => this.showEditProfile());
        addClickListener('#wechat-wallet-btn', () => this.showWalletPage());
        addClickListener('#smart-load-contacts', () => this.showLoadContactsConfirm());
        addClickListener('#edit-profile-btn', () => this.showEditProfile());
        addClickListener('#wechat-settings-btn', () => this.showSettings());

        // 聊天窗口右上角的"..."按钮
        addClickListener('#chat-info', () => this.chatView.showChatMenu());

        // 🔥 群聊头部标题点击 - 进入群设置页面
        addClickListener('#group-header-title', () => this.chatView.showGroupSettings());

        // 🔥 确保子视图的事件也被绑定
        if (this.currentChat) {
            this.chatView.bindEvents();
        }

        if (this.currentView === 'contacts' && !this.currentChat) {
            // 使用 setTimeout 确保 DOM 渲染完成
            setTimeout(() => {
                if (this.contactsView) {
                    this.contactsView.bindEvents();
                }
            }, 50);
        }
    }

    // 显示钱包页面
    showWalletPage() {
        const balance = this.wechatData.getWalletBalance();
        const isInitialized = balance !== null;
        const displayBalance = isInitialized ? parseFloat(balance).toFixed(2) : '***';
        const isEvaluating = !!this._isWalletEvaluating;
        const walletBtnLabel = isEvaluating
            ? '<i class="fa-solid fa-spinner fa-spin"></i> 评估中...'
            : (isInitialized ? '<i class="fa-solid fa-rotate"></i> 重新评估资产' : '<i class="fa-solid fa-wand-magic-sparkles"></i> 初始资产评估');

        const html = `
        <div class="wechat-app">
            <div class="wechat-header" style="background: #07c160; border: none;">
                <div class="wechat-header-left">
                    <button class="wechat-back-btn" id="back-from-wallet" style="color: #fff;">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                </div>
                <div class="wechat-header-title" style="color: #fff;">服务</div>
                <div class="wechat-header-right"></div>
            </div>
            
            <div class="wechat-content" style="background: #ededed;">
                <div style="background: #07c160; padding: 30px 20px 40px; text-align: center; border-radius: 0; box-shadow: 0 4px 10px rgba(7, 193, 96, 0.2);">
                    <div style="color: rgba(255,255,255,0.8); font-size: 14px; margin-bottom: 10px;">
                        <i class="fa-solid fa-shield-halved"></i> 微信零钱
                    </div>
                    <div style="color: #fff; font-size: 40px; font-weight: bold; margin-bottom: 20px;">
                        <span style="font-size: 24px;">¥</span> ${displayBalance}
                    </div>
                    
                    <button id="ai-eval-wallet-btn" style="
                        background: rgba(255,255,255,0.2); color: #fff; border: 1px solid rgba(255,255,255,0.4);
                        padding: 8px 20px; border-radius: 20px; font-size: 13px; cursor: ${isEvaluating ? 'not-allowed' : 'pointer'}; backdrop-filter: blur(5px);
                        opacity: ${isEvaluating ? '0.78' : '1'};
                    ">
                        ${walletBtnLabel}
                    </button>
                </div>
                
                <div style="padding: 20px; text-align: center; color: #999; font-size: 12px; line-height: 1.6;">
                    ${isInitialized ? '这里是默认零钱；每个会话会独立记账，首次会继承默认值。' : '你还没初始化默认零钱，点击上方按钮让AI根据你的背景设定评估一下吧！'}
                </div>
            </div>
        </div>
        `;
        this.phoneShell.setContent(html);

        const currentView = document.querySelector('.phone-view-current') || document;
        currentView.querySelector('#back-from-wallet')?.addEventListener('click', () => this.render());
        const evalBtn = currentView.querySelector('#ai-eval-wallet-btn');
        if (evalBtn) {
            evalBtn.disabled = isEvaluating;
            evalBtn.addEventListener('click', () => this.evaluateWalletByAI());
        }
    }

    _updateWalletEvalButtonState(buttonEl, isLoading) {
        if (!buttonEl) return;
        const isInitialized = this.wechatData.getWalletBalance() !== null;
        buttonEl.disabled = isLoading;
        buttonEl.style.opacity = isLoading ? '0.78' : '';
        buttonEl.style.cursor = isLoading ? 'not-allowed' : '';
        buttonEl.innerHTML = isLoading
            ? '<i class="fa-solid fa-spinner fa-spin"></i> 评估中...'
            : (isInitialized ? '<i class="fa-solid fa-rotate"></i> 重新评估资产' : '<i class="fa-solid fa-wand-magic-sparkles"></i> 初始资产评估');
    }

    // AI 评估钱包金额
    async evaluateWalletByAI() {
        if (this._isWalletEvaluating) {
            this.phoneShell.showNotification('资产评估中', '请稍候，正在生成评估结果...', '⏳');
            return;
        }

        const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        if (!context) return;

        this._isWalletEvaluating = true;
        const currentView = document.querySelector('.phone-view-current') || document;
        const evalBtn = currentView.querySelector('#ai-eval-wallet-btn');
        this._updateWalletEvalButtonState(evalBtn, true);

        this.phoneShell.showNotification('资产评估中', '正在让AI查你的底细...', '⏳');
        
        // 1. 收集信息
        const userName = context.name1 || '用户';
        let charInfo = '', userInfo = '', worldInfo = '';

        const char = (context.characters && context.characterId !== undefined)
            ? context.characters[context.characterId]
            : null;

        // 主角/角色信息：补充更多角色卡字段，避免只塞名字和一句描述
        if (char) {
            const charLines = [];
            charLines.push(`名字: ${char.name || context.name2 || '角色'}`);
            if (char.description) charLines.push(`描述: ${String(char.description).substring(0, 800)}`);
            if (char.personality) charLines.push(`性格: ${String(char.personality).substring(0, 500)}`);
            if (char.scenario) charLines.push(`场景/背景: ${String(char.scenario).substring(0, 500)}`);
            if (char.data?.system_prompt) charLines.push(`系统提示词: ${String(char.data.system_prompt).substring(0, 600)}`);
            charInfo = charLines.join('\n');

            if (char?.data?.character_book?.entries) {
                worldInfo = char.data.character_book.entries
                    .filter(e => e && e.enabled !== false && e.content)
                    .map(e => {
                        const title = e.comment ? `【${e.comment}】` : '';
                        return `${title}\n${String(e.content).substring(0, 400)}`;
                    })
                    .join('\n---\n')
                    .substring(0, 2000);
            }
        } else {
            charInfo = `名字: ${context.name2 || '角色'}`;
        }

        // 用户信息：同时带入微信昵称/签名 + Persona
        const wxUser = this.wechatData?.getUserInfo?.() || {};
        const personaTextarea = document.getElementById('persona_description');
        const personaText = (personaTextarea?.value || '').trim();
        const userLines = [];
        userLines.push(`名字: ${userName}`);
        if (wxUser?.name) userLines.push(`微信昵称: ${wxUser.name}`);
        if (wxUser?.signature) userLines.push(`微信签名: ${wxUser.signature}`);
        if (personaText) userLines.push(`设定: ${personaText.substring(0, 800)}`);
        userInfo = userLines.join('\n');

        // 2. 获取提示词
        const promptManager = window.VirtualPhone?.promptManager;
        const promptTemplate = promptManager?.getPromptForFeature('wechat', 'walletEval') || '';
        if (!promptTemplate) {
            this.phoneShell.showNotification('错误', '找不到钱包评估提示词', '❌');
            this._isWalletEvaluating = false;
            this._updateWalletEvalButtonState(evalBtn, false);
            return;
        }

        const finalPrompt = promptTemplate
            .replace(/\{\{charInfo\}\}/g, charInfo || '无')
            .replace(/\{\{userInfo\}\}/g, userInfo || '无')
            .replace(/\{\{worldInfo\}\}/g, worldInfo || '无');

        try {
            const apiManager = window.VirtualPhone?.apiManager;
            const result = await apiManager.callAI([
                { role: 'system', content: '你是一个数据处理引擎。请严格返回要求的JSON格式。' },
                { role: 'user', content: finalPrompt }
            ], { max_tokens: 500, appId: 'wechat' });

            if (!result.success) throw new Error(result.error);

            // 3. 解析JSON
            const jsonMatch = result.summary.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('AI返回格式有误');
            const data = JSON.parse(jsonMatch[0]);
            
            if (data.amount === undefined || data.reasoning === undefined) throw new Error('解析不到金额或原因');
            const normalizedAmount = parseFloat(data.amount);
            if (!Number.isFinite(normalizedAmount) || normalizedAmount < 0) throw new Error('AI返回的金额无效');

            // 4. 保存余额
            this.wechatData.setWalletBalance(normalizedAmount);
            
            // 5. 渲染结果弹窗
            this.showWalletResultModal(normalizedAmount, data.reasoning);
            
        } catch (e) {
            console.error('钱包评估失败:', e);
            this.phoneShell.showNotification('评估失败', e.message, '❌');
        } finally {
            this._isWalletEvaluating = false;
            const activeView = document.querySelector('.phone-view-current') || document;
            const activeBtn = activeView.querySelector('#ai-eval-wallet-btn');
            this._updateWalletEvalButtonState(activeBtn, false);
        }
    }

    showWalletResultModal(amount, reasoning) {
        // 清理遗留弹窗，避免旧图层中的同名ID干扰事件绑定
        document.querySelectorAll('#wallet-eval-modal').forEach(el => el.remove());

        const modalHtml = `
        <div id="wallet-eval-modal" class="wallet-eval-modal" style="position: absolute; inset: 0; background: rgba(0,0,0,0.6); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 14px; box-sizing: border-box; animation: fadeIn 0.3s;">
            <div class="wallet-eval-modal-panel" style="background: #fff; width: 100%; max-width: 320px; max-height: 100%; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.3); animation: slideUp 0.3s; display: flex; flex-direction: column;">
                <div style="background: linear-gradient(135deg, #07c160 0%, #06a752 100%); padding: 25px 20px 15px; text-align: center; color: #fff; flex-shrink: 0;">
                    <i class="fa-solid fa-sack-dollar" style="font-size: 40px; margin-bottom: 10px; text-shadow: 0 2px 4px rgba(0,0,0,0.2);"></i>
                    <div style="font-size: 14px; opacity: 0.9;">资产评估完成</div>
                    <div style="font-size: 32px; font-weight: bold; margin-top: 5px;">¥ ${parseFloat(amount).toFixed(2)}</div>
                </div>
                <div class="wallet-eval-modal-body" style="padding: 20px; display: flex; flex-direction: column; gap: 10px; min-height: 0;">
                    <div style="font-size: 12px; color: #999; margin-bottom: 8px;">AI 评估报告：</div>
                    <div class="wallet-eval-reasoning" style="font-size: 13px; color: #333; line-height: 1.6; background: #f5f5f5; padding: 12px; border-radius: 8px; max-height: 180px; overflow-y: auto;">
                        ${reasoning}
                    </div>
                    <button id="close-wallet-modal" style="width: 100%; padding: 12px; background: #07c160; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 500; margin-top: 8px; cursor: pointer; flex-shrink: 0;">
                        开心收下
                    </button>
                </div>
            </div>
        </div>
        `;
        
        const currentView = document.querySelector('.phone-view-current') || document;
        currentView.insertAdjacentHTML('beforeend', modalHtml);

        const modalEl = currentView.querySelector('#wallet-eval-modal');
        const closeBtn = modalEl?.querySelector('#close-wallet-modal');
        if (!modalEl || !closeBtn) return;

        closeBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            modalEl.remove();
            this.showWalletPage(); // 刷新钱包页面显示最新余额
        };
    }

    // 会话列表：长按松开后弹出“删除聊天”按钮
    bindChatListLongPressDelete() {
        if (this.currentChat || this.currentView !== 'chats') return;
        const list = document.querySelector('.wechat-chat-list');
        if (!list) return;

        const closeDeleteMenu = () => {
            const old = document.querySelector('.wechat-chat-delete-pop');
            if (old) old.remove();
        };

        const showDeleteMenu = (chatId, itemEl) => {
            closeDeleteMenu();

            const rect = itemEl.getBoundingClientRect();
            const host = document.querySelector('.phone-screen') || document.body;
            const hostRect = host.getBoundingClientRect ? host.getBoundingClientRect() : { top: 0, left: 0 };
            const isBodyHost = host === document.body;
            const topPx = Math.max(8, rect.top + (rect.height / 2) - 16);
            const leftPx = Math.max(8, rect.right - 90);
            const menu = document.createElement('div');
            menu.className = 'wechat-chat-delete-pop';
            menu.style.cssText = `
                position: ${isBodyHost ? 'fixed' : 'absolute'};
                top: ${isBodyHost ? topPx : (topPx - hostRect.top)}px;
                left: ${isBodyHost ? leftPx : (leftPx - hostRect.left)}px;
                z-index: 2147483646;
                background: #fff;
                border: 1px solid #e5e5e5;
                border-radius: 6px;
                padding: 0;
                box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                overflow: hidden;
            `;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = '删除聊天';
            btn.style.cssText = `
                border: none;
                background: transparent;
                color: #111;
                font-size: 12px;
                padding: 5px 9px;
                line-height: 1.2;
                cursor: pointer;
            `;

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const chat = this.wechatData.getChat(chatId);
                if (!chat) {
                    closeDeleteMenu();
                    return;
                }

                const ok = confirm(`确定删除与「${chat.name}」的聊天吗？\n\n删除后将清空该会话内所有聊天记录，且不可恢复。`);
                if (!ok) return;

                this.wechatData.deleteChat(chatId);
                this.phoneShell.showNotification('已删除', `已删除与${chat.name}的聊天`, '✅');
                closeDeleteMenu();
                this.render();
            });

            menu.appendChild(btn);
            host.appendChild(menu);

            setTimeout(() => {
                document.addEventListener('click', function closeOnOutside(ev) {
                    if (!menu.contains(ev.target)) {
                        closeDeleteMenu();
                    }
                }, { once: true });
            }, 0);
        };

        // 桌面端兜底：容器级捕获，保证右键一定能弹出删除菜单
        list.addEventListener('contextmenu', (e) => {
            const item = e.target.closest('.chat-item');
            if (!item || !list.contains(item)) return;
            const chatId = item.dataset.chatId;
            if (!chatId) return;
            e.preventDefault();
            e.stopPropagation();
            showDeleteMenu(chatId, item);
        }, true);

        list.addEventListener('mousedown', (e) => {
            if (e.button !== 2) return;
            const item = e.target.closest('.chat-item');
            if (!item || !list.contains(item)) return;
            const chatId = item.dataset.chatId;
            if (!chatId) return;
            e.preventDefault();
            e.stopPropagation();
            showDeleteMenu(chatId, item);
        }, true);

        document.querySelectorAll('.wechat-chat-list .chat-item').forEach(item => {
            const chatId = item.dataset.chatId;
            if (!chatId) return;

            let pressTimer = null;
            let longPressReady = false;
            let startX = 0;
            let startY = 0;
            let suppressOpen = false;

            const clearPress = () => {
                if (pressTimer) {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                }
            };

            const startPress = (x, y) => {
                startX = x;
                startY = y;
                longPressReady = false;
                clearPress();
                pressTimer = setTimeout(() => {
                    longPressReady = true;
                }, 450);
            };

            const movePress = (x, y) => {
                if (!pressTimer) return;
                if (Math.abs(x - startX) > 10 || Math.abs(y - startY) > 10) {
                    clearPress();
                }
            };

            const endPress = () => {
                clearPress();
                if (!longPressReady) return;
                longPressReady = false;
                suppressOpen = true;
                showDeleteMenu(chatId, item);
                setTimeout(() => { suppressOpen = false; }, 350);
            };

            item.addEventListener('touchstart', (e) => {
                if (!e.touches || e.touches.length === 0) return;
                const t = e.touches[0];
                startPress(t.clientX, t.clientY);
            }, { passive: true });

            item.addEventListener('touchmove', (e) => {
                if (!e.touches || e.touches.length === 0) return;
                const t = e.touches[0];
                movePress(t.clientX, t.clientY);
            }, { passive: true });

            item.addEventListener('touchend', () => {
                endPress();
            });

            item.addEventListener('touchcancel', () => {
                clearPress();
                longPressReady = false;
            });

            item.addEventListener('mousedown', (e) => {
                // 桌面端右键：立即弹出删除菜单（不依赖 contextmenu 事件）
                if (e.button === 2) {
                    e.preventDefault();
                    e.stopPropagation();
                    suppressOpen = true;
                    showDeleteMenu(chatId, item);
                    setTimeout(() => { suppressOpen = false; }, 350);
                    return;
                }
                if (e.button !== 0) return;
                startPress(e.clientX, e.clientY);
            });

            item.addEventListener('mousemove', (e) => {
                movePress(e.clientX, e.clientY);
            });

            item.addEventListener('mouseup', () => {
                endPress();
            });

            item.addEventListener('mouseleave', () => {
                clearPress();
                longPressReady = false;
            });

            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                suppressOpen = true;
                showDeleteMenu(chatId, item);
                setTimeout(() => { suppressOpen = false; }, 350);
            });

            item.onclick = (e) => {
                if (suppressOpen || document.querySelector('.wechat-chat-delete-pop')) return;
                const targetChatId = e.currentTarget.dataset.chatId;
                if (targetChatId) this.openChat(targetChatId);
            };
        });
    }

    openChat(chatId) {
        const chat = this.wechatData.getChat(chatId);
        if (chat) {
            // 🔥 核心修复：在进入聊天窗口之前，强行触发一次 getMessages 拉取独立存储，防止界面白板
            this.wechatData.getMessages(chatId);
            this.currentChat = chat;
            this.render();
        }
    }

    openMoments() {
        this.momentsView.render();
    }

    // 接收新消息（从AI正文）
    receiveMessage(data) {
        const fromName = data.from || 'AI助手';
        const isGroup = data.type === 'group' || data.isGroup;
        const groupName = data.groupName || data.chatId; // 群名
        const senderInGroup = data.sender || fromName; // 群内发送者
        let chatId = data.chatId || null;
        let chat = null;

        // 🔥 优先通过 chatId 查找聊天
        if (chatId) {
            chat = this.wechatData.getChat(chatId);
        }

        // 🔥 如果没找到聊天，根据类型查找
        if (!chat) {
            const allChats = this.wechatData.getChatList();

            if (isGroup) {
                // 🔥 群聊：通过群名查找是否有同名的群
                const searchName = groupName || fromName;
                chat = allChats.find(c => c.type === 'group' && c.name === searchName);

                if (chat) {
                    chatId = chat.id;
                } else {
                    // 🔥 群不存在，创建新群聊
                    chatId = `group_${Date.now()}`;
                    chat = this.wechatData.createChat({
                        id: chatId,
                        name: searchName,
                        type: 'group',
                        avatar: data.avatar || '👥',
                        members: data.members || [senderInGroup]
                    });
                }
            } else {
                // 🔥 单聊：通过发送者名字在通讯录中查找联系人
                const contacts = this.wechatData.getContacts();
                const existingContact = contacts.find(c => c.name === fromName);

                if (existingContact) {
                    // 🔥 联系人存在，查找或创建对应的聊天窗口
                    chat = this.wechatData.getChatByContactId(existingContact.id);

                    if (!chat) {
                        // 也尝试通过名字查找聊天（兼容旧数据）
                        chat = allChats.find(c => c.type !== 'group' && c.name === fromName);
                    }

                    if (!chat) {
                        // 联系人存在但没有聊天窗口，创建聊天（不重复添加联系人）
                        chat = this.wechatData.createChat({
                            id: `chat_${existingContact.id}`,
                            contactId: existingContact.id,
                            name: existingContact.name,
                            type: 'single',
                            avatar: existingContact.avatar || '👤'
                        });
                    }
                    chatId = chat.id;
                } else {
                    // 🔥 也尝试通过名字直接查找聊天（可能之前没关联联系人）
                    chat = allChats.find(c => c.type !== 'group' && c.name === fromName);

                    if (chat) {
                        chatId = chat.id;
                    } else {
                        // 🔥 联系人不存在，先添加联系人再创建聊天
                        const newContactId = `contact_${Date.now()}`;
                        this.wechatData.addContact({
                            id: newContactId,
                            name: fromName,
                            avatar: data.avatar || '👤',
                            letter: this.wechatData.getFirstLetter(fromName)
                        });

                        chatId = `chat_${newContactId}`;
                        chat = this.wechatData.createChat({
                            id: chatId,
                            contactId: newContactId,
                            name: fromName,
                            type: 'single',
                            avatar: data.avatar || '👤'
                        });
                    }
                }
            }
        }

        // 添加消息
        const msgSender = isGroup ? senderInGroup : fromName;

        if (data.messages && Array.isArray(data.messages)) {
            data.messages.forEach(msg => {
                this.wechatData.addMessage(chatId, {
                    from: msg.sender || msgSender,
                    content: msg.text || msg.message,
                    time: msg.timestamp || data.timestamp || '刚刚',
                    type: 'text'
                });
            });

            // 如果不在当前聊天，增加未读
            if (!this.currentChat || this.currentChat.id !== chatId) {
                chat.unread = (chat.unread || 0) + data.messages.length;
            }
        } else if (data.message) {
            this.wechatData.addMessage(chatId, {
                from: msgSender,
                content: data.message,
                time: data.timestamp || '刚刚',
                type: 'text'
            });

            if (!this.currentChat || this.currentChat.id !== chatId) {
                chat.unread = (chat.unread || 0) + 1;
            }
        }

        // 刷新界面
        if (this.currentChat && this.currentChat.id === chatId) {
            this.render();
        }

        this.wechatData.saveData();
    }

    /// ✅ 编辑个人资料（手机内部界面，不用弹窗）
    showEditProfile() {
        const userInfo = this.wechatData.getUserInfo();
        const globalCss = this.storage?.get('phone_global_chat_css') || '';
        const shellBg = this._getMainShellBackgroundConfig();
        const profileContentStyle = `${shellBg.contentBgStyle || 'background: #f2f2f7;'} padding: 16px 12px;`;
        const safeCustomCss = String(globalCss)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
            
        const avatarHtml = this.renderAvatar(userInfo.avatar, '😊', userInfo.name);

        const html = `
        <div class="${shellBg.appClass}" style="${shellBg.appStyle}">
            <div class="wechat-header">
                <div class="wechat-header-left">
                    <button class="wechat-back-btn" id="back-from-profile-edit">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                </div>
                <div class="wechat-header-title">编辑个人资料</div>
                <div class="wechat-header-right"></div>
            </div>

            <div class="wechat-content" style="${profileContentStyle}">
                
                <!-- 📸 头像卡片 -->
                <div style="background: #fff; border-radius: 12px; padding: 24px 16px; text-align: center; margin-bottom: 16px;">
                    <div id="user-avatar-preview" style="
                        width: 72px;
                        height: 72px;
                        border-radius: 50%;
                        background: #f0f0f0;
                        margin: 0 auto 12px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 36px;
                        overflow: hidden;
                        border: 0.5px solid #e5e5ea;
                    ">${avatarHtml}</div>
                    <div id="upload-user-avatar-btn" style="
                        color: #576b95;
                        font-size: 14px;
                        font-weight: 500;
                        cursor: pointer;
                        display: inline-block;
                        padding: 4px 12px;
                    ">更换头像</div>
                    <input type="file" id="user-avatar-upload" accept="image/png, image/jpeg, image/gif, image/webp, image/*" style="display: none;">
                </div>

                <!-- 📝 基础资料卡片 (iOS 列表风格) -->
                <div style="background: #fff; border-radius: 12px; padding: 0 16px; margin-bottom: 16px;">
                    <div style="display: flex; align-items: center; padding: 16px 0; border-bottom: 0.5px solid #f0f0f0;">
                        <div style="width: 70px; font-size: 15px; color: #000;">昵称</div>
                        <input type="text" id="user-name-input" placeholder="未设置" value="${userInfo.name || ''}" maxlength="20" style="
                            flex: 1; border: none; outline: none; background: transparent; 
                            font-size: 15px; color: #333; text-align: right; min-width: 0;
                        ">
                    </div>
                    <div style="display: flex; align-items: center; padding: 16px 0;">
                        <div style="width: 70px; font-size: 15px; color: #000;">签名</div>
                        <input type="text" id="user-signature-input" placeholder="未设置" value="${userInfo.signature || ''}" maxlength="50" style="
                            flex: 1; border: none; outline: none; background: transparent; 
                            font-size: 15px; color: #333; text-align: right; min-width: 0;
                        ">
                    </div>
                </div>

                <!-- 💅 主题管理卡片 -->
                <div style="background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
                    <div style="font-size: 13px; color: #8e8e93; margin-bottom: 12px;">会话样式 CSS（主题预设）</div>
                    
                    <!-- 下拉框独占一行 -->
                    <div style="position: relative; margin-bottom: 12px;">
                        <select id="chat-css-profile-select" style="
                            width: 100%; padding: 10px 30px 10px 12px; border: none; border-radius: 8px; 
                            background: #f2f2f7; font-size: 14px; color: #000; 
                            -webkit-appearance: none; outline: none; cursor: pointer;
                        ">
                            <option value="">-- 选择或输入CSS --</option>
                        </select>
                        <i class="fa-solid fa-chevron-down" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: #8e8e93; font-size: 12px; pointer-events: none;"></i>
                    </div>

                    <!-- 操作按钮独占一行 -->
                    <div style="display: flex; gap: 10px; margin-bottom: 12px;">
                        <button id="save-css-profile-btn" style="
                            flex: 1; padding: 10px; background: #f2f2f7; color: #000; 
                            border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer;
                        ">存为预设</button>
                        <button id="delete-css-profile-btn" style="
                            flex: 1; padding: 10px; background: #f2f2f7; color: #ff3b30; 
                            border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer;
                        ">删除配置</button>
                    </div>

                    <!-- 说明文字去除了丑陋的 code 底色 -->
                    <div style="font-size: 12px; color: #8e8e93; margin-bottom: 8px; line-height: 1.5;">
                        可覆盖类名: .message-avatar, .message-text 等
                    </div>

                    <textarea id="wechat-chat-custom-css" placeholder=".message-right .message-text { border-radius: 14px; background: #c9f7b9; }\n.message-avatar { border: 1px solid #dfe3ea; }" style="
                        width: 100%; min-height: 140px; padding: 12px; border: none; border-radius: 8px; 
                        background: #f9f9f9; font-size: 13px; color: #333; line-height: 1.5;
                        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                        resize: vertical; outline: none; box-sizing: border-box;
                    ">${safeCustomCss}</textarea>
                </div>

                <!-- iOS蓝按钮 -->
                <button id="save-user-profile" style="
                    width: 100%; padding: 14px; background: #ffffff; color: #050505; 
                    border: none; border-radius: 12px; font-size: 16px; font-weight: 500; 
                    cursor: pointer; margin-bottom: 20px; transition: transform 0.1s;
                ">应用并保存所有更改</button>

            </div>
        </div>
        `;

        this.phoneShell.setContent(html);

        // 返回按钮
        document.getElementById('back-from-profile-edit')?.addEventListener('click', () => {
            this.render();
        });

        // ==================================================
        // 🎨 CSS 多套主题管理逻辑
        // ==================================================
        const profileSelect = document.getElementById('chat-css-profile-select');
        const saveProfileBtn = document.getElementById('save-css-profile-btn');
        const deleteProfileBtn = document.getElementById('delete-css-profile-btn');
        const cssTextarea = document.getElementById('wechat-chat-custom-css');

        const loadCssProfiles = () => {
            try { return JSON.parse(this.storage?.get('phone_chat_css_profiles') || '[]'); } 
            catch (e) { return []; }
        };

        const saveCssProfiles = (profiles) => {
            this.storage?.set('phone_chat_css_profiles', JSON.stringify(profiles));
        };

        const renderCssSelect = () => {
            const profiles = loadCssProfiles();
            profileSelect.innerHTML = '<option value="">-- 选择或输入CSS --</option>';
            profiles.forEach((p, idx) => {
                profileSelect.innerHTML += `<option value="${idx}">${p.name}</option>`;
            });
        };

        renderCssSelect(); 

        profileSelect?.addEventListener('change', (e) => {
            const idx = e.target.value;
            if (idx === '') return;
            const profiles = loadCssProfiles();
            if (profiles[idx]) {
                cssTextarea.value = profiles[idx].css;
            }
        });

        saveProfileBtn?.addEventListener('click', () => {
            const css = cssTextarea.value.trim();
            if (!css) {
                this.phoneShell.showNotification('提示', 'CSS内容为空', '⚠️');
                return;
            }
            const name = prompt('请输入新主题的名称（例如：极简白）：');
            if (!name) return;
            
            const profiles = loadCssProfiles();
            const existingIdx = profiles.findIndex(p => p.name === name);
            if (existingIdx > -1) {
                if(confirm(`主题 "${name}" 已存在，是否覆盖更新？`)) {
                    profiles[existingIdx].css = css;
                } else return;
            } else {
                profiles.push({ name, css });
            }
            saveCssProfiles(profiles);
            renderCssSelect();
            profileSelect.value = profiles.findIndex(p => p.name === name);
            this.phoneShell.showNotification('成功', '主题已保存', '✅');
        });

        deleteProfileBtn?.addEventListener('click', () => {
            const idx = profileSelect.value;
            if (idx === '') {
                this.phoneShell.showNotification('提示', '请先在下拉框选择一个要删除的主题', '⚠️');
                return;
            }
            const profiles = loadCssProfiles();
            if (confirm(`确定要删除主题 "${profiles[idx].name}" 吗？`)) {
                profiles.splice(idx, 1);
                saveCssProfiles(profiles);
                renderCssSelect();
                cssTextarea.value = '';
                this.phoneShell.showNotification('成功', '主题已删除', '🗑️');
            }
        });

        // ==================================================
        // 📸 头像上传
        // ==================================================
        document.getElementById('upload-user-avatar-btn')?.addEventListener('click', () => {
            document.getElementById('user-avatar-upload').click();
        });

        document.getElementById('user-avatar-upload')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            e.target.value = '';

            if (file.size > 2 * 1024 * 1024) {
                this.phoneShell.showNotification('提示', '图片太大，请选择小于2MB的图片', '⚠️');
                return;
            }

            try {
                const cropper = new ImageCropper({
                    title: '裁剪头像',
                    aspectRatio: 1,
                    outputWidth: 512,
                    outputHeight: 512,
                    quality: 0.92,
                    maxFileSize: 5 * 1024 * 1024
                });
                const croppedImage = await cropper.open(file);

                const preview = document.getElementById('user-avatar-preview');
                if (preview) {
                    preview.innerHTML = `<img src="${croppedImage}" style="width:100%;height:100%;object-fit:cover;">`;
                }

                this.phoneShell.showNotification('处理中', '正在上传头像...', '⏳');

                const imgResp = await fetch(croppedImage);
                const blob = await imgResp.blob();
                const ext = blob.type === 'image/png' ? 'png' : 'jpg';
                const filename = `phone_wechat_avatar_${Date.now()}.${ext}`;
                const formData = new FormData();
                formData.append('avatar', blob, filename);

                const headers = typeof window.getRequestHeaders === 'function' ? window.getRequestHeaders() : {};
                delete headers['Content-Type'];
                if (!headers['X-CSRF-Token']) {
                    const csrfResp = await fetch('/csrf-token');
                    if (csrfResp.ok) headers['X-CSRF-Token'] = (await csrfResp.json()).token;
                }
                const uploadResp = await fetch('/api/backgrounds/upload', { method: 'POST', body: formData, headers });

                if (uploadResp.ok) {
                    const finalUrl = `/backgrounds/${filename}`;
                    const oldAvatar = String(this.wechatData.getUserInfo()?.avatar || '').trim();
                    this.wechatData.updateUserInfo({ avatar: finalUrl });
                    if (oldAvatar && oldAvatar !== finalUrl) {
                        const cleanupTask = window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(oldAvatar, { quiet: true });
                        cleanupTask?.catch?.(() => { });
                    }
                    this.phoneShell.showNotification('成功', '头像已上传并保存', '✅');
                } else {
                    throw new Error('上传接口返回错误');
                }
            } catch (err) {
                if (String(err?.message || '') === '用户取消') return;
                console.warn('微信头像上传服务器失败:', err);
                this.phoneShell.showNotification('提示', '上传服务器失败，请检查酒馆后台', '⚠️');
            }
        });

        // ==================================================
        // 💾 保存所有设置
        // ==================================================
        const saveBtn = document.getElementById('save-user-profile');
        saveBtn?.addEventListener('click', async () => {
            saveBtn.style.transform = 'scale(0.96)';
            setTimeout(() => saveBtn.style.transform = 'scale(1)', 100);

            const newName = document.getElementById('user-name-input').value.trim();
            const newSignature = document.getElementById('user-signature-input').value.trim();
            const customCss = document.getElementById('wechat-chat-custom-css')?.value || '';

            if (!newName) {
                this.phoneShell.showNotification('提示', '请输入昵称', '⚠️');
                return;
            }

            this.wechatData.updateUserInfo({
                name: newName,
                signature: newSignature
            });
            
            await this.storage?.set('phone_global_chat_css', customCss);
            this._applyCustomChatStyle(customCss);

            this.phoneShell.showNotification('保存成功', '个人资料与当前应用样式已更新', '✅');
            setTimeout(() => this.render(), 800);
        });
    }

    showSettings() {
        this._isAvatarManagerOpen = false;
        this._wechatPanelMode = 'settings';
        const promptManager = window.VirtualPhone?.promptManager;
        const prompts = promptManager?.prompts?.wechat || {};
        const shellBg = this._getMainShellBackgroundConfig();
        const settingsContentStyle = shellBg.contentBgStyle || 'background: #ededed;';

        const html = `
        <div class="${shellBg.appClass}" style="${shellBg.appStyle}">
            <div class="wechat-header">
                <div class="wechat-header-left">
                    <button class="wechat-back-btn" id="back-from-settings">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                </div>
                <div class="wechat-header-title">微信设置</div>
                <div class="wechat-header-right"></div>
            </div>
            
            <div class="wechat-content" style="${settingsContentStyle}">
                <!-- 模式提示 -->
<div style="background: #e3f2fd; border-radius: 12px; padding: 15px; margin: 15px;">
    <div style="font-size: 14px; color: #1976d2;">
        <i class="fa-solid fa-info-circle"></i> 
        在线模式状态：${window.VirtualPhone?.storage?.get('wechat_online_mode') ? '✅ 已开启' : '❌ 未开启'}
        <div style="font-size: 12px; margin-top: 5px; color: #666;">
            如需修改，请前往手机"设置"APP（每个会话独立设置）
        </div>
    </div>
</div>
                
                <!-- 功能提示词设置 -->
                <div style="background: #fff; border-radius: 12px; margin: 15px; padding: 15px;">
                    <div style="font-size: 14px; font-weight: 600; color: #333; margin-bottom: 15px;">
                        📝 功能提示词（按需启用）
                    </div>

                    <!-- 线下模式 -->
                    <div class="prompt-item" style="border-bottom: 1px solid #f0f0f0; padding-bottom: 12px; margin-bottom: 12px;">
                        <div class="prompt-header" style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;"
                             data-feature="offline">
                            <div style="display: flex; align-items: center; flex: 1;">
                                <i class="fa-solid fa-chevron-right prompt-arrow"
                                   style="color: #999; font-size: 12px; margin-right: 8px; transition: transform 0.2s;"></i>
                                <span style="font-size: 15px;">${prompts.offline?.name || '📴 线下模式'}</span>
                            </div>
                            <label class="toggle-switch" onclick="event.stopPropagation();">
                                <input type="checkbox" class="feature-toggle" data-feature="offline"
                                       ${prompts.offline?.enabled !== false ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="prompt-content" style="display: none; margin-top: 10px; padding-left: 20px;">
                            <div style="font-size: 12px; color: #666; margin-bottom: 8px;">
                                ${prompts.offline?.description || '酒馆正文中的微信消息规则'}
                            </div>
                            <button class="edit-prompt-btn" data-feature="offline" style="
                                padding: 6px 12px;
                                background: #f0f0f0;
                                border: none;
                                border-radius: 4px;
                                font-size: 12px;
                                color: #333;
                                cursor: pointer;
                            ">编辑提示词</button>
                        </div>
                    </div>

                    <!-- 线上模式（展开式父级） -->
                    <div class="prompt-item" style="border-bottom: 1px solid #f0f0f0; padding-bottom: 12px; margin-bottom: 12px;">
                        <div class="prompt-header" style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;"
                             data-feature="online-group">
                            <div style="display: flex; align-items: center; flex: 1;">
                                <i class="fa-solid fa-chevron-right prompt-arrow"
                                   style="color: #999; font-size: 12px; margin-right: 8px; transition: transform 0.2s;"></i>
                                <span style="font-size: 15px;">📱 线上模式</span>
                            </div>
                        </div>
                        <!-- 🔥 展开后显示三个子项 -->
                        <div class="prompt-content" style="display: none; margin-top: 10px; padding-left: 20px;">
                            <div style="font-size: 12px; color: #666; margin-bottom: 12px;">
                                手机内在线聊天和通话规则
                            </div>

                            <!-- 子项1：微信聊天 -->
                            <div style="background: #f9f9f9; border-radius: 8px; padding: 12px; margin-bottom: 10px;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                    <span style="font-size: 14px;">💬 微信聊天</span>
                                    <label class="toggle-switch" onclick="event.stopPropagation();">
                                        <input type="checkbox" class="feature-toggle" data-feature="online"
                                               ${prompts.online?.enabled !== false ? 'checked' : ''}>
                                        <span class="toggle-slider"></span>
                                    </label>
                                </div>
                                <div style="font-size: 11px; color: #999; margin-bottom: 8px;">
                                    ${prompts.online?.description || '手机内微信聊天规则'}
                                </div>
                                <button class="edit-prompt-btn" data-feature="online" style="
                                    padding: 5px 10px;
                                    background: #fff;
                                    border: 1px solid #e0e0e0;
                                    border-radius: 4px;
                                    font-size: 11px;
                                    color: #333;
                                    cursor: pointer;
                                ">编辑提示词</button>
                            </div>

                            <!-- 子项2：语音通话 -->
                            <div style="background: #f9f9f9; border-radius: 8px; padding: 12px; margin-bottom: 10px;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                    <span style="font-size: 14px;">📞 语音通话</span>
                                    <label class="toggle-switch" onclick="event.stopPropagation();">
                                        <input type="checkbox" class="feature-toggle" data-feature="voiceCall"
                                               ${prompts.voiceCall?.enabled !== false ? 'checked' : ''}>
                                        <span class="toggle-slider"></span>
                                    </label>
                                </div>
                                <div style="font-size: 11px; color: #999; margin-bottom: 8px;">
                                    ${prompts.voiceCall?.description || '微信语音通话规则'}
                                </div>
                                <button class="edit-prompt-btn" data-feature="voiceCall" style="
                                    padding: 5px 10px;
                                    background: #fff;
                                    border: 1px solid #e0e0e0;
                                    border-radius: 4px;
                                    font-size: 11px;
                                    color: #333;
                                    cursor: pointer;
                                ">编辑提示词</button>
                            </div>

                            <!-- 子项3：视频通话 -->
                            <div style="background: #f9f9f9; border-radius: 8px; padding: 12px;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                    <span style="font-size: 14px;">📹 视频通话</span>
                                    <label class="toggle-switch" onclick="event.stopPropagation();">
                                        <input type="checkbox" class="feature-toggle" data-feature="videoCall"
                                               ${prompts.videoCall?.enabled !== false ? 'checked' : ''}>
                                        <span class="toggle-slider"></span>
                                    </label>
                                </div>
                                <div style="font-size: 11px; color: #999; margin-bottom: 8px;">
                                    ${prompts.videoCall?.description || '微信视频通话规则'}
                                </div>
                                <button class="edit-prompt-btn" data-feature="videoCall" style="
                                    padding: 5px 10px;
                                    background: #fff;
                                    border: 1px solid #e0e0e0;
                                    border-radius: 4px;
                                    font-size: 11px;
                                    color: #333;
                                    cursor: pointer;
                                ">编辑提示词</button>
                            </div>

                            <!-- 子项4：群语音通话 -->
                            <div style="background: #f9f9f9; border-radius: 8px; padding: 12px; margin-top: 10px;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                    <span style="font-size: 14px;">👥📞 群语音通话</span>
                                    <label class="toggle-switch" onclick="event.stopPropagation();">
                                        <input type="checkbox" class="feature-toggle" data-feature="groupVoiceCall"
                                               ${prompts.groupVoiceCall?.enabled !== false ? 'checked' : ''}>
                                        <span class="toggle-slider"></span>
                                    </label>
                                </div>
                                <div style="font-size: 11px; color: #999; margin-bottom: 8px;">
                                    ${prompts.groupVoiceCall?.description || '微信群语音通话规则'}
                                </div>
                                <button class="edit-prompt-btn" data-feature="groupVoiceCall" style="
                                    padding: 5px 10px;
                                    background: #fff;
                                    border: 1px solid #e0e0e0;
                                    border-radius: 4px;
                                    font-size: 11px;
                                    color: #333;
                                    cursor: pointer;
                                ">编辑提示词</button>
                            </div>

                            <!-- 子项5：群视频通话 -->
                            <div style="background: #f9f9f9; border-radius: 8px; padding: 12px; margin-top: 10px;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                    <span style="font-size: 14px;">👥📹 群视频通话</span>
                                    <label class="toggle-switch" onclick="event.stopPropagation();">
                                        <input type="checkbox" class="feature-toggle" data-feature="groupVideoCall"
                                               ${prompts.groupVideoCall?.enabled !== false ? 'checked' : ''}>
                                        <span class="toggle-slider"></span>
                                    </label>
                                </div>
                                <div style="font-size: 11px; color: #999; margin-bottom: 8px;">
                                    ${prompts.groupVideoCall?.description || '微信群视频通话规则'}
                                </div>
                                <button class="edit-prompt-btn" data-feature="groupVideoCall" style="
                                    padding: 5px 10px;
                                    background: #fff;
                                    border: 1px solid #e0e0e0;
                                    border-radius: 4px;
                                    font-size: 11px;
                                    color: #333;
                                    cursor: pointer;
                                ">编辑提示词</button>
                            </div>

                            <!-- 子项6：群聊 -->
                            <div style="background: #f9f9f9; border-radius: 8px; padding: 12px;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                    <span style="font-size: 14px;">👥 群聊</span>
                                    <label class="toggle-switch" onclick="event.stopPropagation();">
                                        <input type="checkbox" class="feature-toggle" data-feature="groupChat"
                                               ${prompts.groupChat?.enabled !== false ? 'checked' : ''}>
                                        <span class="toggle-slider"></span>
                                    </label>
                                </div>
                                <div style="font-size: 11px; color: #999; margin-bottom: 8px;">
                                    ${prompts.groupChat?.description || '微信群聊规则'}
                                </div>
                                <button class="edit-prompt-btn" data-feature="groupChat" style="
                                    padding: 5px 10px;
                                    background: #fff;
                                    border: 1px solid #e0e0e0;
                                    border-radius: 4px;
                                    font-size: 11px;
                                    color: #333;
                                    cursor: pointer;
                                ">编辑提示词</button>
                            </div>
                        </div>
                    </div>

                    <!-- 朋友圈 -->
                    <div class="prompt-item" style="border-bottom: 1px solid #f0f0f0; padding-bottom: 12px; margin-bottom: 12px;">
                        <div class="prompt-header" style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;" 
                             data-feature="moments">
                            <div style="display: flex; align-items: center; flex: 1;">
                                <i class="fa-solid fa-chevron-right prompt-arrow" 
                                   style="color: #999; font-size: 12px; margin-right: 8px; transition: transform 0.2s;"></i>
                                <span style="font-size: 15px;">${prompts.moments?.name || '📸 朋友圈'}</span>
                            </div>
                            <label class="toggle-switch" onclick="event.stopPropagation();">
                                <input type="checkbox" class="feature-toggle" data-feature="moments" 
                                       ${prompts.moments?.enabled ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="prompt-content" style="display: none; margin-top: 10px; padding-left: 20px;">
                            <div style="font-size: 12px; color: #666; margin-bottom: 8px;">
                                ${prompts.moments?.description || '朋友圈动态生成规则'}
                            </div>
                            <button class="edit-prompt-btn" data-feature="moments" style="
                                padding: 6px 12px;
                                background: #f0f0f0;
                                border: none;
                                border-radius: 4px;
                                font-size: 12px;
                                color: #333;
                                cursor: pointer;
                            ">编辑提示词</button>
                        </div>
                    </div>

                    <!-- 智能加载联系人 -->
                    <div class="prompt-item">
                        <div class="prompt-header" style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;" 
                             data-feature="loadContacts">
                            <div style="display: flex; align-items: center; flex: 1;">
                                <i class="fa-solid fa-chevron-right prompt-arrow" 
                                   style="color: #999; font-size: 12px; margin-right: 8px; transition: transform 0.2s;"></i>
                                <span style="font-size: 15px;">${prompts.loadContacts?.name || '🤖 智能加载联系人'}</span>
                            </div>
                            <label class="toggle-switch" onclick="event.stopPropagation();">
                                <input type="checkbox" class="feature-toggle" data-feature="loadContacts" 
                                       ${prompts.loadContacts?.enabled !== false ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="prompt-content" style="display: none; margin-top: 10px; padding-left: 20px;">
                            <div style="font-size: 12px; color: #666; margin-bottom: 8px;">
                                ${prompts.loadContacts?.description || '从角色卡生成联系人'}
                            </div>
                            <button class="edit-prompt-btn" data-feature="loadContacts" style="
                                padding: 6px 12px;
                                background: #f0f0f0;
                                border: none;
                                border-radius: 4px;
                                font-size: 12px;
                                color: #333;
                                cursor: pointer;
                            ">编辑提示词</button>
                        </div>
                    </div>
                </div>

                <!-- 表情包 API 设置 -->
                <div style="background: #fff; border-radius: 12px; margin: 15px; padding: 12px;">
                    <div style="font-size: 13px; font-weight: 600; color: #333; margin-bottom: 8px;">
                        🖼️ 表情包 API 密钥
                    </div>
                    <div style="display: flex; gap: 6px;">
                        <input type="text" id="alapi-token-input" placeholder="输入 ALAPI Token"
                               value="${window.VirtualPhone?.storage?.get('global_alapi_token') || ''}" style="
                            flex: 1;
                            min-width: 0;
                            padding: 8px;
                            border: 1px solid #e5e5e5;
                            border-radius: 6px;
                            font-size: 12px;
                            outline: none;
                            box-sizing: border-box;
                        ">
                        <button id="save-alapi-token-btn" style="
                            padding: 8px 12px;
                            background: #07c160;
                            color: #fff;
                            border: none;
                            border-radius: 6px;
                            font-size: 12px;
                            cursor: pointer;
                            flex-shrink: 0;
                        ">保存</button>
                    </div>
                </div>

                <!-- 头像管理 -->
                <div style="background: #fff; border-radius: 12px; margin: 15px; padding: 15px;">
                    <div style="font-size: 14px; font-weight: 600; color: #333; margin-bottom: 10px;">
                        👤 头像管理器
                    </div>
                    <div style="font-size: 12px; color: #888; line-height: 1.45; margin-bottom: 10px;">
                        为通讯录联系人标记男女。无自定义头像时，将从 <code>apps/wechat/avatars/</code> 里按性别随机分配默认头像。
                    </div>
                    <button id="wechat-avatar-manager-btn" style="
                        width: 100%;
                        padding: 10px 12px;
                        border: 1px solid #e7e7e7;
                        border-radius: 8px;
                        background: #fafafa;
                        color: #333;
                        font-size: 13px;
                        cursor: pointer;
                    ">打开头像管理器</button>
                </div>

                <!-- 数据管理 -->
                <div style="background: #fff3cd; border-radius: 12px; padding: 15px; margin: 15px; border: 1px solid #ffc107;">
                    <div style="font-size: 14px; font-weight: 600; color: #856404; margin-bottom: 12px;">
                        <i class="fa-solid fa-triangle-exclamation"></i> 数据管理
                    </div>
                    <button id="clear-wechat-data" style="
                        width: 100%;
                        padding: 12px;
                        background: #fff;
                        border: 1px solid #ffc107;
                        border-radius: 8px;
                        color: #856404;
                        font-size: 14px;
                        font-weight: 500;
                        cursor: pointer;
                        margin-bottom: 8px;
                    ">管理微信数据</button>
                </div>
            </div>
        </div>
    `;

        this.phoneShell.setContent(html);

        // 返回按钮
        const backBtn = document.getElementById('back-from-settings');
        if (backBtn) backBtn.onclick = () => {
            this._wechatPanelMode = 'main';
            this.render();
        };

        // 折叠展开功能
        document.querySelectorAll('.prompt-header').forEach(header => {
            header.onclick = (e) => {
                const content = header.nextElementSibling;
                const arrow = header.querySelector('.prompt-arrow');

                if (content.style.display === 'none') {
                    content.style.display = 'block';
                    arrow.style.transform = 'rotate(90deg)';
                } else {
                    content.style.display = 'none';
                    arrow.style.transform = 'rotate(0deg)';
                }
            };
        });

        // 功能开关切换
        document.querySelectorAll('.feature-toggle').forEach(toggle => {
            toggle.onchange = (e) => {
                const feature = e.target.dataset.feature;
                promptManager?.toggleFeature('wechat', feature);

                this.phoneShell.showNotification(
                    e.target.checked ? '已启用' : '已禁用',
                    `${feature} 功能${e.target.checked ? '已启用' : '已禁用'}`,
                    e.target.checked ? '✅' : '❌'
                );
            };
        });

        // 编辑提示词按钮
        document.querySelectorAll('.edit-prompt-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                const feature = btn.dataset.feature;
                this.showPromptEditor('wechat', feature);
            };
        });

        // 清空数据按钮
        const clearDataBtn = document.getElementById('clear-wechat-data');
        if (clearDataBtn) clearDataBtn.onclick = () => {
            this.showDataManagePopup();
        };
        const avatarManagerBtn = document.getElementById('wechat-avatar-manager-btn');
        if (avatarManagerBtn) avatarManagerBtn.onclick = () => {
            this.showAvatarManager();
        };

        // 保存 ALAPI Token
        const saveAlapiBtn = document.getElementById('save-alapi-token-btn');
        if (saveAlapiBtn) saveAlapiBtn.onclick = async () => {
            const token = document.getElementById('alapi-token-input').value.trim();
            await window.VirtualPhone?.storage?.set('global_alapi_token', token);
            this.phoneShell.showNotification('保存成功', '表情包密钥已更新', '✅');
        };
    }

    showAvatarManager() {
        this._isAvatarManagerOpen = true;
        this._wechatPanelMode = 'avatar-manager';
        this._ensureWechatAvatarPoolLoaded();
        const shellBg = this._getMainShellBackgroundConfig();
        const avatarManagerContentStyle = `${shellBg.contentBgStyle || 'background:#ededed;'} padding:12px; box-sizing:border-box;`;
        const contacts = [...(this.wechatData?.getContacts?.() || [])]
            .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'zh-Hans-CN'));

        const maleCount = Array.isArray(this._avatarPool?.male) ? this._avatarPool.male.length : 0;
        const femaleCount = Array.isArray(this._avatarPool?.female) ? this._avatarPool.female.length : 0;
        const emptyPoolHint = (maleCount + femaleCount) === 0
            ? '<div style="font-size:11px;color:#d46b08;margin-top:6px;">未检测到头像素材，请将 male001/female001 系列图片放入目录后点击刷新。</div>'
            : '';
        const escapeHtml = (text) => String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        const rowsHtml = contacts.length > 0
            ? contacts.map((contact) => {
                const contactId = String(contact?.id || '').trim();
                const contactName = String(contact?.name || '').trim() || '未命名';
                const safeContactName = escapeHtml(contactName);
                const gender = this.wechatData?.getContactGender?.(contactId) || 'unknown';
                return `
                    <div class="wechat-avatar-row" style="display:grid; grid-template-columns:minmax(0,1fr) 64px; align-items:center; column-gap:10px; padding:10px 0; border-bottom:0.5px solid #f1f1f1;">
                        <div style="min-width:0; font-size:14px; color:#111; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.2;">${safeContactName}</div>
                        <select class="wechat-contact-gender-select" data-contact-id="${contactId}" style="width:64px; min-width:64px; max-width:64px; height:26px; border:1px solid #e1e1e1; border-radius:7px; background:#fafafa; font-size:11px; color:#333; padding:0 4px; justify-self:end;">
                            <option value="unknown" ${gender === 'unknown' ? 'selected' : ''}>未标记</option>
                            <option value="male" ${gender === 'male' ? 'selected' : ''}>男</option>
                            <option value="female" ${gender === 'female' ? 'selected' : ''}>女</option>
                        </select>
                    </div>
                `;
            }).join('')
            : '<div style="font-size:13px; color:#888; text-align:center; padding:24px 12px;">通讯录为空，先添加联系人。</div>';

        const html = `
            <div class="${shellBg.appClass}" style="${shellBg.appStyle}">
                <div class="wechat-header">
                    <div class="wechat-header-left">
                        <button class="wechat-back-btn" id="back-from-avatar-manager">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>
                    <div class="wechat-header-title">头像管理器</div>
                    <div class="wechat-header-right"></div>
                </div>
                <div class="wechat-content" style="${avatarManagerContentStyle}">
                    <div style="background:#fff; border-radius:12px; padding:12px; margin-bottom:10px;">
                        <div style="font-size:13px; color:#333; font-weight:600;">默认头像池与性别标记</div>
                        <div style="font-size:11px; color:#888; margin-top:4px; line-height:1.45;">
                            素材目录：\`apps/wechat/avatars/\`<br>
                            命名示例：\`male001.png\`、\`female001.jpg\`（连续编号即可）<br>
                            当前已识别：男 ${maleCount} 张，女 ${femaleCount} 张<br>
                            通讯录联系人：${contacts.length} 人（仅显示姓名与性别选择）
                        </div>
                        ${emptyPoolHint}
                        <button id="wechat-avatar-pool-refresh" style="margin-top:8px; padding:6px 10px; border:1px solid #e1e1e1; border-radius:8px; background:#fafafa; font-size:12px; cursor:pointer;">刷新头像池</button>
                    </div>
                    <div style="background:#fff; border-radius:12px; padding:0 12px;">
                        ${rowsHtml}
                    </div>
                </div>
            </div>
        `;

        this.phoneShell.setContent(html);

        document.getElementById('back-from-avatar-manager')?.addEventListener('click', () => {
            this._isAvatarManagerOpen = false;
            this._wechatPanelMode = 'settings';
            this.showSettings();
        });

        document.getElementById('wechat-avatar-pool-refresh')?.addEventListener('click', () => {
            this._avatarPoolLoaded = false;
            this._avatarPoolLoading = false;
            this._ensureWechatAvatarPoolLoaded();
            this.phoneShell.showNotification('头像池', '正在刷新头像素材...', '🔄');
        });

        document.querySelectorAll('.wechat-contact-gender-select').forEach((selectEl) => {
            selectEl.addEventListener('change', (e) => {
                const contactId = String(e.target?.dataset?.contactId || '').trim();
                const gender = String(e.target?.value || 'unknown').trim();
                if (!contactId) return;
                this.wechatData?.setContactGender?.(contactId, gender);
            });
        });
    }

    _resetWechatSingletonCaches() {
        if (window.VirtualPhone) {
            window.VirtualPhone.wechatApp = null;
            window.VirtualPhone.cachedWechatData = null;

            // 🔥 核心修复：同步清除桌面图标上的微信角标，防止幽灵红点残留
            if (window.VirtualPhone.home && window.VirtualPhone.home.apps) {
                const wechatIcon = window.VirtualPhone.home.apps.find(a => a.id === 'wechat');
                if (wechatIcon) {
                    wechatIcon.badge = 0;
                }
                if (window.VirtualPhone.storage) {
                    window.VirtualPhone.storage.saveApps(window.VirtualPhone.home.apps);
                }
            }
            window.dispatchEvent(new CustomEvent('phone:updateGlobalBadge'));
        }
        window.currentWechatApp = null;
        window.ggp_currentWechatApp = null;
    }

    // 🧭 数据管理小弹窗：聊天 / 朋友圈 / 全清
    showDataManagePopup() {
        const host = document.querySelector('.phone-view-current') || document.body;
        document.getElementById('wechat-data-manage-modal')?.remove();

        const html = `
        <div id="wechat-data-manage-modal" style="position:absolute; inset:0; background:rgba(0,0,0,0.34); z-index:2200; display:flex; align-items:center; justify-content:center; padding:16px; box-sizing:border-box;">
            <div style="width:100%; max-width:300px; background:#fff; border-radius:14px; box-shadow:0 10px 28px rgba(0,0,0,0.22); overflow:hidden;">
                <div style="padding:14px 14px 10px; border-bottom:0.5px solid #efefef;">
                    <div style="font-size:15px; color:#111; text-align:center; font-weight:500;">微信数据管理</div>
                    <div style="font-size:11px; color:#888; text-align:center; margin-top:4px;">选择要清理的范围</div>
                </div>
                <button class="wechat-data-action-btn" data-action="chat" style="width:100%; border:none; background:#fff; padding:12px 14px; text-align:left; border-bottom:0.5px solid #f0f0f0; cursor:pointer;">
                    <div style="font-size:14px; color:#222;">清理聊天数据</div>
                    <div style="font-size:11px; color:#999; margin-top:2px;">清空会话与消息，保留联系人和朋友圈</div>
                </button>
                <button class="wechat-data-action-btn" data-action="moments" style="width:100%; border:none; background:#fff; padding:12px 14px; text-align:left; border-bottom:0.5px solid #f0f0f0; cursor:pointer;">
                    <div style="font-size:14px; color:#222;">清理朋友圈</div>
                    <div style="font-size:11px; color:#999; margin-top:2px;">仅清空朋友圈动态与互动</div>
                </button>
                <button class="wechat-data-action-btn" data-action="all" style="width:100%; border:none; background:#fff; padding:12px 14px; text-align:left; border-bottom:0.5px solid #f0f0f0; cursor:pointer;">
                    <div style="font-size:14px; color:#d93025;">全清（含联系人）</div>
                    <div style="font-size:11px; color:#999; margin-top:2px;">清空聊天、朋友圈、联系人与设置数据</div>
                </button>
                <button id="wechat-data-manage-cancel" style="width:100%; border:none; background:#fff; color:#666; padding:11px 0; font-size:14px; cursor:pointer;">取消</button>
            </div>
        </div>
        `;

        host.insertAdjacentHTML('beforeend', html);
        const modal = document.getElementById('wechat-data-manage-modal');
        if (!modal) return;

        const closeModal = () => modal.remove();
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        document.getElementById('wechat-data-manage-cancel')?.addEventListener('click', closeModal);

        modal.querySelectorAll('.wechat-data-action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                if (action === 'chat') {
                    const ok = confirm('确定清理微信聊天数据吗？\n\n将清空全部会话和消息记录，但保留联系人与朋友圈。');
                    if (!ok) return;
                    const chatCount = this.wechatData.getChatList().length;
                    this.wechatData.clearAllChatData();
                    this._resetWechatSingletonCaches();
                    closeModal();
                    this.phoneShell.showNotification('已清理', `聊天数据已清空（${chatCount} 个会话）`, '✅');
                    this.currentView = 'chats';
                    this.currentChat = null;
                    setTimeout(() => {
                        // 🔥 核心修复：清空聊天后遣返桌面，销毁僵尸UI并同步角标
                        window.dispatchEvent(new CustomEvent('phone:goHome'));
                    }, 300);
                    return;
                }

                if (action === 'moments') {
                    const ok = confirm('确定清理微信朋友圈吗？\n\n将清空所有朋友圈动态与互动记录。');
                    if (!ok) return;
                    const momentsCount = this.wechatData.getMoments().length;
                    this.wechatData.clearMomentsData();
                    closeModal();
                    this.phoneShell.showNotification('已清理', `朋友圈已清空（${momentsCount} 条）`, '✅');
                    return;
                }

                if (action === 'all') {
                    const ok = confirm('确定全清微信数据吗？\n\n将删除聊天、朋友圈、联系人等所有微信数据，且不可恢复。');
                    if (!ok) return;
                    this.wechatData.resetAllData();
                    this._resetWechatSingletonCaches();
                    closeModal();
                    this.phoneShell.showNotification('已清空', '微信数据已重置', '✅');
                    setTimeout(() => {
                        // 🔥 核心修复：全清数据后直接遣返桌面，彻底销毁僵尸UI，强制下次打开时重建同步实例
                        window.dispatchEvent(new CustomEvent('phone:goHome'));
                    }, 300);
                }
            });
        });
    }

    // 📋 显示智能加载联系人确认界面
    showLoadContactsConfirm() {
        const shellBg = this._getMainShellBackgroundConfig();
        const loadContactsContentStyle = `${shellBg.contentBgStyle || 'background: #ededed;'} padding: 20px;`;
        const html = `
        <div class="${shellBg.appClass}" style="${shellBg.appStyle}">
            <div class="wechat-header">
                <div class="wechat-header-left">
                    <button class="wechat-back-btn" id="back-from-load">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                </div>
                <div class="wechat-header-title">智能加载联系人</div>
                <div class="wechat-header-right"></div>
            </div>
            
            <div class="wechat-content" style="${loadContactsContentStyle}">
                <div style="background: #fff; border-radius: 12px; padding: 30px; text-align: center;">
                    <div style="width: 60px; height: 60px; border-radius: 50%; background: rgba(255,255,255,0.6); backdrop-filter: blur(10px); border: 1px solid rgba(0,0,0,0.1); margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                        <i class="fa-solid fa-robot" style="font-size: 28px; color: #666;"></i>
                    </div>
                    <div style="font-size: 16px; font-weight: 500; color: #000; margin-bottom: 8px;">使用AI生成联系人</div>
                    <div style="font-size: 12px; color: #999; margin-bottom: 24px; line-height: 1.5;">
                        将使用AI分析当前角色卡和聊天记录，智能生成联系人。
                    </div>

                    <button id="confirm-load" style="
                        padding: 10px 20px;
                        background: rgba(255,255,255,0.6);
                        backdrop-filter: blur(10px);
                        border: 1px solid rgba(0,0,0,0.1);
                        color: #333;
                        border-radius: 8px;
                        font-size: 12px;
                        cursor: pointer;
                    ">开始生成</button>
                </div>
            </div>
        </div>
    `;

        this.phoneShell.setContent(html);

        document.getElementById('back-from-load')?.addEventListener('click', () => {
            this.render();
        });

        document.getElementById('confirm-load')?.addEventListener('click', async () => {
            this.phoneShell.showNotification('AI分析中', '正在生成联系人...', '⏳');

            try {

                const result = await this.wechatData.loadContactsFromCharacter();

                if (result.success) {
                    let message = result.message;

                    // 🔥 如果生成了时间，显示在通知中
                    if (result.time) {
                        message += `\n⏰ 剧情时间: ${result.time.date} ${result.time.time}`;

                        // 🔥 刷新主屏幕时间显示
                        if (window.VirtualPhone?.home) {
                            setTimeout(() => window.VirtualPhone.home.render(), 500);
                        }
                    }

                    this.phoneShell.showNotification('✅ 生成成功', message, '✅');
                    setTimeout(() => {
                        this.currentView = 'contacts';
                        this.render();
                    }, 2000);
                } else {
                    this.phoneShell.showNotification('❌ 生成失败', result.message, '❌');
                    setTimeout(() => this.render(), 2000);
                }

            } catch (error) {
                console.error('❌ 加载联系人失败:', error);
                this.phoneShell.showNotification('❌ 错误', error.message, '❌');
                setTimeout(() => this.render(), 3000);
            }
        });
    }
    // 🗑️ 显示清空数据确认界面
    showClearDataConfirm() {
        const html = `
        <div class="wechat-app">
            <div class="wechat-header">
                <div class="wechat-header-left">
                    <button class="wechat-back-btn" id="back-from-clear">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                </div>
                <div class="wechat-header-title">清空数据</div>
                <div class="wechat-header-right"></div>
            </div>
            
            <div class="wechat-content" style="background: #ededed; padding: 20px;">
                <div style="background: #fff; border-radius: 12px; padding: 30px; text-align: center;">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 64px; color: #ff3b30; margin-bottom: 20px;"></i>
                    <div style="font-size: 20px; font-weight: 600; color: #000; margin-bottom: 15px;">确定要清空所有微信数据吗？</div>
                    <div style="font-size: 14px; color: #999; margin-bottom: 10px; line-height: 1.6;">
                        此操作将删除：<br>
                        • 所有聊天记录<br>
                        • 所有联系人<br>
                        • 朋友圈内容<br>
                    </div>
                    <div style="font-size: 16px; color: #ff3b30; font-weight: 600; margin-bottom: 30px;">
                        ⚠️ 此操作不可恢复！
                    </div>
                    
                    <button id="confirm-clear-data" style="
                        width: 100%;
                        padding: 14px;
                        background: #ff3b30;
                        color: #fff;
                        border: none;
                        border-radius: 8px;
                        font-size: 16px;
                        font-weight: 600;
                        cursor: pointer;
                        margin-bottom: 10px;
                    ">确定清空</button>
                    
                    <button id="cancel-clear-data" style="
                        width: 100%;
                        padding: 14px;
                        background: #f0f0f0;
                        color: #666;
                        border: none;
                        border-radius: 8px;
                        font-size: 16px;
                        cursor: pointer;
                    ">取消</button>
                </div>
            </div>
        </div>
    `;

        this.phoneShell.setContent(html);

        document.getElementById('back-from-clear')?.addEventListener('click', () => {
            this.showSettings();
        });

        document.getElementById('cancel-clear-data')?.addEventListener('click', () => {
            this.showSettings();
        });

        document.getElementById('confirm-clear-data')?.addEventListener('click', () => {
            // 🔥 使用 resetAllData 彻底清空（包括独立存储的消息键）
            this.wechatData.resetAllData();

            // 🔥 清空内存单例缓存，防止残留
            this._resetWechatSingletonCaches();

            this.phoneShell.showNotification('已清空', '微信数据已重置', '✅');
            setTimeout(() => {
                this.currentView = 'chats';
                this.currentChat = null;
                this.render();
            }, 1000);
        });
    }
    showSearch() {
        const html = `
        <div class="wechat-app">
            <div class="wechat-header" style="background: #f7f7f7; gap: 10px;">
               <div style="flex-grow: 1; display:flex; align-items:center; background:#fff; border-radius:6px; padding: 8px 10px;">
    <i class="fa-solid fa-search" style="color:#aaa; margin-right: 5px;"></i>
    <input type="text" id="search-input" placeholder="搜索" style="border:none; width: 100%; padding:0; background:transparent; outline:none;" autofocus>
</div>
                <button id="cancel-search" class="wechat-back-btn" style="border:none; background:none; color:#576b95; padding:0; cursor:pointer; flex-shrink: 0;">取消</button>
            </div>
            <div class="wechat-content" id="search-results" style="background:#fff; padding-top: 10px;">
                <div style="text-align:center;color:#999;padding-top:50px;">输入关键词搜索聊天记录或联系人</div>
            </div>
        </div>
    `;
        this.phoneShell.setContent(html);

        const searchInput = document.getElementById('search-input');
        const searchResults = document.getElementById('search-results');
        const cancelBtn = document.getElementById('cancel-search');

        if (searchInput && searchResults) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.trim().toLowerCase();
                if (!query) {
                    searchResults.innerHTML = '<div style="text-align:center;color:#999;padding-top:50px;">输入关键词搜索...</div>';
                    return;
                }

                const contacts = this.wechatData.getContacts().filter(c => c.name.toLowerCase().includes(query));
                const chats = this.wechatData.getChatList().filter(c => c.name.toLowerCase().includes(query));

                let resultsHtml = '';

                if (contacts.length > 0) {
                    resultsHtml += '<div style="font-size:12px;color:#888;padding:5px 15px;">联系人</div>';
                    resultsHtml += contacts.map(contact => `
                    <div class="contact-item" data-contact-id="${contact.id}" style="padding: 8px 15px; cursor:pointer;">
                        <div class="contact-avatar" style="width:36px;height:36px;">${this.renderAvatar(contact.avatar, '👤', contact.name)}</div>
                        <div class="contact-name">${contact.name}</div>
                    </div>
                `).join('');
                }

                if (chats.length > 0) {
                    resultsHtml += '<div style="font-size:12px;color:#888;padding:15px 15px 5px;">聊天</div>';
                    resultsHtml += chats.map(chat => `
                    <div class="chat-item" data-chat-id="${chat.id}" style="padding: 8px 15px; cursor:pointer;">
                        <div class="chat-avatar" style="width:36px;height:36px;">${this.renderAvatar(chat.avatar, '👤', chat.name)}</div>
                        <div class="chat-info">
                            <div class="chat-name">${chat.name}</div>
                            <div class="chat-last-msg">${chat.lastMessage}</div>
                        </div>
                    </div>
                `).join('');
                }

                if (resultsHtml === '') {
                    searchResults.innerHTML = `<div style="text-align:center;color:#999;padding-top:50px;">未找到相关内容</div>`;
                } else {
                    searchResults.innerHTML = resultsHtml;
                }

                this.bindSearchResultsEvents();
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.render();
            });
        } else {
            console.error('未找到取消按钮');
        }
    }

    // 🔥 新增：绑定搜索结果点击事件
    bindSearchResultsEvents() {
        document.querySelectorAll('#search-results .contact-item').forEach(item => {
            item.addEventListener('click', () => {
                const contactId = item.dataset.contactId;
                this.contactsView.openContactChat(contactId);
            });
        });
        document.querySelectorAll('#search-results .chat-item').forEach(item => {
            item.addEventListener('click', () => {
                const chatId = item.dataset.chatId;
                this.openChat(chatId);
            });
        });
    }

    // 🔥 新增：显示添加菜单（替代 showAddMenu）
    showAddFriendMenu() {
        this.currentView = 'contacts';
        this.render(); // 先渲染通讯录视图
        setTimeout(() => {
            this.contactsView.showAddFriendPage(); // 再打开添加好友页面
        }, 50);
    }
}
