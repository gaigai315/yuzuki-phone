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
import { HoneyView } from './honey-view.js?v=20260506-nai-debug';
import { HoneyData } from './honey-data.js?v=20260506-nai-debug';

export class HoneyApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.honeyData = new HoneyData(storage);
        this.honeyView = new HoneyView(this);
        this._lastSwipeTime = 0;

        // 监听滑动返回事件 (防止实例重建导致重复绑定)
        if (!window._honeySwipeBackBound) {
            window._honeySwipeBackBound = true;
            window.addEventListener('phone:swipeBack', () => {
                const honeyApp = window.VirtualPhone?.honeyApp;
                if (honeyApp && typeof honeyApp.handleSwipeBack === 'function') {
                    honeyApp.handleSwipeBack();
                }
            });
        }
    }

    attachRuntime(phoneShell, storage) {
        if (phoneShell) this.phoneShell = phoneShell;
        if (storage) {
            this.storage = storage;
            if (this.honeyData) this.honeyData.storage = storage;
        }
    }

    async render() {
        if (!this.phoneShell?.setContent) {
            throw new Error('蜜语运行时未绑定手机壳');
        }
        // 移动端首次打开时 CSS fetch 可能被宿主页面或网络状态拖住，不能阻塞进入页面。
        this.honeyView.cssPromise?.catch?.(() => {});
        this.honeyView.render();
    }

    openFollowedHostLive(hostName, options = {}) {
        return this.honeyView?.openFollowedHostLive?.(hostName, options);
    }

    handleSwipeBack() {
        const now = Date.now();
        if (this._lastSwipeTime && now - this._lastSwipeTime < 400) return;
        this._lastSwipeTime = now;

        const currentView = document.querySelector('.phone-view-current');
        if (!currentView || !currentView.querySelector('.honey-app')) return;

        // 自动寻址：如果有统一格式的后退按钮，直接触发它即可
        const backBtn = currentView.querySelector('.honey-back-btn');
        if (backBtn) {
            backBtn.click();
        } else {
            this.honeyView?.removePhoneChromeTheme?.();
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        }

        // Ghost Click Buster：短时间禁用点击，避免双触发
        const screen = document.querySelector('.phone-screen');
        if (screen) {
            screen.style.pointerEvents = 'none';
            setTimeout(() => { screen.style.pointerEvents = ''; }, 400);
        }
    }

    destroy() {
        this.honeyView?.removePhoneChromeTheme?.();
    }

    deactivate() {
        this.honeyView?.releaseInactiveResources?.();
        this.honeyView?.removePhoneChromeTheme?.();
    }
}
