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
// 📔 日记APP - 核心控制器
// ========================================

import { DiaryData } from './diary-data.js';
import { DiaryView } from './diary-view.js';

export class DiaryApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.diaryData = new DiaryData(storage);
        this.diaryView = new DiaryView(this);

        // 监听滑动返回
        window.addEventListener('phone:swipeBack', (e) => this.handleSwipeBack(e));
    }

    render() {
        this.diaryView.render();
    }

    handleSwipeBack(e) {
        // 1. 400ms 防抖
        const now = Date.now();
        if (this._lastSwipeTime && now - this._lastSwipeTime < 400) return;
        this._lastSwipeTime = now;

        // 2. 领地保护 (变量重命名为 domCurrentView 防止冲突)
        const domCurrentView = document.querySelector('.phone-view-current');
        if (!domCurrentView || !domCurrentView.querySelector('.diary-app')) return;

        // 3. 标记为返回导航，避免进场动画
        this.diaryView.isBackNav = true;

        // 4. 模拟点击对应的返回按钮
        let handled = false;
        const diaryState = this.diaryView.currentView;

        if (diaryState === 'page') {
            const btn = domCurrentView.querySelector('#diary-page-back');
            if (btn) { btn.click(); handled = true; }
        } else if (diaryState === 'settings') {
            const btn = domCurrentView.querySelector('#diary-settings-back');
            if (btn) { btn.click(); handled = true; }
        } else if (diaryState === 'edit') {
            const btn = domCurrentView.querySelector('#diary-edit-cancel');
            if (btn) { btn.click(); handled = true; }
        } else if (diaryState === 'toc') {
            this.diaryView.currentView = 'cover';
            this.diaryView.render();
            handled = true;
        }

        if (!handled && diaryState === 'cover') {
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        }

        // 5. Ghost Click Buster：400ms 内禁止点击
        const screen = document.querySelector('.phone-screen');
        if (screen) {
            screen.style.pointerEvents = 'none';
            setTimeout(() => { screen.style.pointerEvents = ''; }, 400);
        }
    }
    
    // 清空缓存（切换聊天时调用）
    clearCache() {
        this.diaryData.clearCache();
        this.diaryView.currentView = 'cover';
        this.diaryView.currentEntryId = null;
    }
}
