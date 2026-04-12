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
import { HoneyView } from './honey-view.js';
import { HoneyData } from './honey-data.js';

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

    async render() {
        // 等待 CSS 加载完成，防止首次打开闪屏
        if (this.honeyView.cssPromise) {
            await this.honeyView.cssPromise;
        }
        this.honeyView.render();
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
}

