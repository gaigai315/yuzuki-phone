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
// 微博APP - 主控制器
// ========================================
import { WeiboData } from './weibo-data.js?v=20261002-social-emoji';
import { WeiboView } from './weibo-view.js?v=20261002-social-emoji';

export class WeiboApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;

        // 预加载CSS，避免首次打开闪烁
        this._preloadCSS();

        // 初始化数据和视图
        this.weiboData = new WeiboData(storage);
        this.weiboView = new WeiboView(this);
        this._isActive = false;
        this._renderRequestId = 0;
        this._cssFallbackTimer = null;

        // 监听滑动返回事件
        this._swipeHandler = (event) => this.handleSwipeBack(event);
        window.addEventListener('phone:swipeBack', this._swipeHandler);
    }

    _preloadCSS() {
        if (document.getElementById('weibo-css')) return;
        const link = document.createElement('link');
        link.id = 'weibo-css';
        link.rel = 'stylesheet';
        link.href = new URL('./weibo.css?v=20260917-ai-parse-debug', import.meta.url).href;
        document.head.appendChild(link);
    }

    // ========================================
    // 🎯 主渲染入口
    // ========================================

    render() {
        this._isActive = true;
        const renderRequestId = ++this._renderRequestId;
        const isRenderRequestActive = () => this._isActive
            && renderRequestId === this._renderRequestId;
        const renderIfActive = () => {
            if (!isRenderRequestActive()) return false;
            this.weiboView.render();
            return true;
        };

        if (this._cssFallbackTimer) {
            clearTimeout(this._cssFallbackTimer);
            this._cssFallbackTimer = null;
        }

        // 确保CSS已加载后再渲染，防止闪烁与点击卡死
        const cssLink = document.getElementById('weibo-css');
        if (cssLink && !cssLink.sheet) {
            cssLink.addEventListener('load', renderIfActive, { once: true });
            cssLink.addEventListener('error', () => {
                if (!isRenderRequestActive()) return;
                console.error('Weibo CSS failed to load');
                renderIfActive();
            }, { once: true });

            this._cssFallbackTimer = setTimeout(() => {
                this._cssFallbackTimer = null;
                if (this.weiboView.currentView === 'home' && !document.querySelector('.weibo-app')) {
                    renderIfActive();
                }
            }, 1500);
            return;
        }
        renderIfActive();
    }

    handleExternalRecommendUpdate() {
        this.weiboView?.markExternalRecommendUpdated?.();
    }

    // ========================================
    // ↩️ 滑动返回处理
    // ========================================

    returnToWechatFromCard() {
        const source = this.weiboView.entrySource || {};
        const targetChatId = source.chatId || null;
        const targetChatName = source.chatName || '';

        // 清理微博详情状态，避免后续残留
        this.weiboView.entrySource = null;
        this.weiboView.currentPostId = null;
        this.weiboView.currentPostMode = null;
        this.weiboView.currentHotSearchTitle = null;
        this.weiboView.currentView = 'home';

        const getWechatCandidates = () => {
            const list = [
                window.currentWechatApp,
                window.ggp_currentWechatApp,
                window.VirtualPhone?.wechatApp
            ].filter(Boolean);
            return [...new Set(list)];
        };

        const restoreWechat = () => {
            const candidates = getWechatCandidates();
            if (candidates.length === 0) return false;

            for (const wechatApp of candidates) {
                const wechatData = wechatApp?.wechatData;
                if (!wechatData) continue;

                let targetChat = null;

                if (targetChatId && typeof wechatData.getChat === 'function') {
                    targetChat = wechatData.getChat(targetChatId);
                }

                if (!targetChat && targetChatName) {
                    const chats = typeof wechatData.getChatList === 'function' ? (wechatData.getChatList() || []) : [];
                    targetChat = chats.find(c => c && c.name === targetChatName) || null;
                }

                window.currentWechatApp = wechatApp;
                window.ggp_currentWechatApp = wechatApp;
                if (window.VirtualPhone) {
                    window.VirtualPhone.wechatApp = wechatApp;
                }

                if (targetChat) {
                    wechatApp.currentView = 'chats';
                    wechatApp.currentChat = targetChat;
                    wechatApp.render?.();
                    return true;
                }
            }
            return false;
        };

        // 优先复用现有实例，不存在时再全局打开微信
        if (restoreWechat()) return;

        window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'wechat' } }));
        let attempts = 0;
        const timer = setInterval(() => {
            attempts++;
            if (restoreWechat() || attempts >= 40) {
                clearInterval(timer);
            }
        }, 80);
    }

    handleSwipeBack(event) {
        // 检查微博APP是否可见
        const currentView = document.querySelector('.phone-view-current');
        if (!currentView?.querySelector('.weibo-app')) return false;

        if (event?.detail && typeof event.detail === 'object') {
            event.detail.handled = true;
        }

        this.weiboView.isBackNav = true;

        // 根据当前视图决定返回行为
        switch (this.weiboView.currentView) {
            case 'postDetail':
                this.weiboView.returnFromPostDetail?.(this.weiboView.currentPostMode);
                break;

            case 'hotSearchDetail':
                this.weiboView.currentView = 'home';
                this.weiboView.currentHotSearchTitle = null;
                this.weiboView.render();
                break;

            case 'settings':
                this.weiboView.currentView = 'home';
                this.weiboView.render();
                break;

            case 'hotSearchSettings':
                if (this.weiboView.currentHotSearchTitle) {
                    this.weiboView.currentView = 'hotSearchDetail';
                } else {
                    this.weiboView.currentView = 'home';
                }
                this.weiboView.render();
                break;

            case 'home':
            default:
                if (this.weiboView.entrySource?.appId === 'wechat') {
                    this.returnToWechatFromCard();
                    break;
                }
                // 在首页，返回手机主屏幕
                window.dispatchEvent(new CustomEvent('phone:goHome'));
                break;
        }
        return true;
    }

    // ========================================
    // 🔄 缓存管理
    // ========================================

    clearCache() {
        this.weiboData.clearCache();
        this.weiboView.currentView = 'home';
        this.weiboView.currentTab = 'hotSearch';
        this.weiboView.currentHotSearchTitle = null;
    }

    deactivate() {
        this._isActive = false;
        this._renderRequestId += 1;
        if (this._cssFallbackTimer) {
            clearTimeout(this._cssFallbackTimer);
            this._cssFallbackTimer = null;
        }
    }

    // ========================================
    // 🗑️ 销毁
    // ========================================

    destroy() {
        this.deactivate();
        window.removeEventListener('phone:swipeBack', this._swipeHandler);
    }
}
