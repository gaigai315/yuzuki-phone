/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

import { WangxiangView } from './wangxiang-view.js';

export class WangxiangApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.wangxiangView = new WangxiangView(this);

        window.addEventListener('phone:swipeBack', () => this.handleSwipeBack());
    }

    render() {
        this.wangxiangView.render();
    }

    handleSwipeBack() {
        const currentView = document.querySelector('.phone-view-current');
        if (!currentView?.querySelector('.wangxiang-app')) return;

        window.dispatchEvent(new CustomEvent('phone:goHome'));
    }
}
