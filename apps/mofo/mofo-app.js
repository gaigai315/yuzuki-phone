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
// 魔坊APP控制器（空壳占位）
// ========================================

import { MofoData } from './mofo-data.js';
import { MofoView } from './mofo-view.js';

export class MofoApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.mofoData = new MofoData(storage);
        this.mofoView = new MofoView(this);

        // 防止实例重建后重复绑定
        if (!window._mofoSwipeBackBound) {
            window._mofoSwipeBackBound = true;
            window.addEventListener('phone:swipeBack', (event) => {
                const mofoApp = window.VirtualPhone?.mofoApp;
                if (mofoApp && typeof mofoApp.handleSwipeBack === 'function') {
                    mofoApp.handleSwipeBack(event);
                }
            });
        }
    }

    render() {
        this.mofoView.render();
    }

    handleSwipeBack(event) {
        const currentView = document.querySelector('.phone-view-current');
        if (!currentView || !currentView.querySelector('.mofo-app')) return false;

        if (event?.detail && typeof event.detail === 'object') {
            event.detail.handled = true;
        }

        const backBtn = currentView.querySelector('.mofo-back-btn, .app-back-btn');
        if (backBtn) {
            backBtn.click();
        } else {
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        }
        return true;
    }

    clearCache() {
        this.mofoData.clearCache();
        this.mofoView.currentPage = 'main';
        this.mofoView.selectionMode = false;
        this.mofoView.selectedIds?.clear?.();
    }
}
