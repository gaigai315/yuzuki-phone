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
// 通话APP控制器（单例模式）
// ========================================
import { PhoneCallData } from './phone-data.js';
import { PhoneCallView } from './phone-view.js';

export class PhoneApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.phoneCallData = new PhoneCallData(storage);
        this.phoneCallView = new PhoneCallView(this);

        // 监听来电事件
        window.addEventListener('phone:incomingCall', (e) => {
            const { callerName } = e.detail || {};
            if (callerName) {
                this.phoneCallView.renderIncomingCall(callerName);
            }
        });

        // 监听滑动返回
        window.addEventListener('phone:swipeBack', (e) => this.handleSwipeBack(e));
    }

    render() {
        this.phoneCallView.render();
    }

    handleSwipeBack(e) {
        // 1. 400ms 防抖
        const now = Date.now();
        if (this._lastSwipeTime && now - this._lastSwipeTime < 400) return;
        this._lastSwipeTime = now;

        // 2. 领地保护：确认当前视图属于通话APP
        const domCurrentView = document.querySelector('.phone-view-current');
        if (!domCurrentView || (!domCurrentView.querySelector('.phone-call-main') &&
            !domCurrentView.querySelector('.phone-call-transcript') &&
            !domCurrentView.querySelector('.phone-call-settings') &&
            !domCurrentView.querySelector('.phone-call-incoming') &&
            !domCurrentView.querySelector('.phone-call-active'))) return;

        // 3. 根据当前视图处理返回
        const view = this.phoneCallView.currentView;
        if (view === 'transcript') {
            const btn = domCurrentView.querySelector('#phone-call-transcript-back');
            if (btn) btn.click();
        } else if (view === 'settings') {
            const btn = domCurrentView.querySelector('#phone-call-settings-back');
            if (btn) btn.click();
        } else if (view === 'main') {
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        } else if (view === 'incoming') {
            // 来电时右滑等同于拒绝
            const btn = domCurrentView.querySelector('#phone-call-reject');
            if (btn) btn.click();
        } else if (view === 'active') {
            // 通话中右滑等同于挂断
            const btn = domCurrentView.querySelector('#phone-call-hangup');
            if (btn) btn.click();
        }

        // 4. Ghost Click Buster：400ms 内禁止点击
        const screen = document.querySelector('.phone-screen');
        if (screen) {
            screen.style.pointerEvents = 'none';
            setTimeout(() => { screen.style.pointerEvents = ''; }, 400);
        }
    }

    clearCache() {
        this.phoneCallData.clearCache();
        this.phoneCallView.currentView = 'main';
        this.phoneCallView.currentCaller = '';
        // 清理通话状态
        if (this.phoneCallView.callTimer) {
            clearInterval(this.phoneCallView.callTimer);
            this.phoneCallView.callTimer = null;
        }
        this.phoneCallView.chatMessages = [];
    }
}

