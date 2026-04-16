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
// 魔坊APP视图层（空壳占位）
// ========================================

export class MofoView {
    constructor(app) {
        this.app = app;
        this.currentPage = 'main';
    }

    render() {
        if (this.currentPage !== 'main') {
            this.currentPage = 'main';
        }

        this.app.mofoData.getBootstrapState();

        const html = `
            <div class="mofo-app" style="height: 100%; display: flex; flex-direction: column; background: linear-gradient(165deg, #0b1f3a 0%, #173d73 55%, #2a63b7 100%); color: #fff;">
                <div style="height: 54px; display: flex; align-items: center; padding: 0 12px; gap: 8px; border-bottom: 1px solid rgba(255,255,255,0.15);">
                    <button class="mofo-back-btn app-back-btn" style="border: none; background: transparent; color: #fff; font-size: 22px; line-height: 1; cursor: pointer;">‹</button>
                    <div style="font-size: 16px; font-weight: 700; letter-spacing: 0.5px;">魔坊</div>
                    <div style="margin-left: auto; font-size: 11px; color: rgba(255,255,255,0.75);">Universal Simulator</div>
                </div>
                <div style="flex: 1; display: flex; align-items: center; justify-content: center; padding: 18px;">
                    <div style="width: 100%; border-radius: 16px; padding: 16px; background: rgba(255,255,255,0.1); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14);">
                        <div style="font-size: 15px; font-weight: 700; margin-bottom: 8px;">魔坊已就位</div>
                        <div style="font-size: 12px; line-height: 1.6; color: rgba(255,255,255,0.88);">
                            当前为开发空壳版本，已完成入口与路由占位。<br>
                            后续可在此逐步接入“万能模拟器”的功能模块。
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'mofo-main');
        this.bindEvents();
    }

    bindEvents() {
        const currentView = document.querySelector('.phone-view-current') || document;
        const backBtn = currentView.querySelector('.mofo-back-btn');
        if (backBtn) {
            backBtn.onclick = (e) => {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('phone:goHome'));
            };
        }
    }
}
