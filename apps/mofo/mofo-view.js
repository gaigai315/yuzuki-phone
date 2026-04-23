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
// 魔坊APP视图层
// ========================================

export class MofoView {
    constructor(app) {
        this.app = app;
        this.currentPage = 'main';
    }

    _escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _buildListHtml(items) {
        if (!Array.isArray(items) || items.length === 0) {
            return `
                <div style="padding: 12px; border-radius: 10px; background: #fff; border: 1px solid #dfe6f4; color: #2f4463; font-size: 12px; line-height: 1.6;">
                    还没有魔坊条目。<br>请在外部快捷回复面板里新建魔坊条目。
                </div>
            `;
        }
        return items.map((item, index) => {
            const isFirst = index === 0;
            const isLast = index === items.length - 1;
            return `
                <div
                    class="mofo-item-row"
                    data-mofo-id="${this._escapeHtml(item.id)}"
                    style="
                        width: 100%;
                        box-sizing: border-box;
                        border: 1px solid #dfe6f4;
                        background: #fff;
                        color: #1f2f46;
                        border-radius: 10px;
                        padding: 10px;
                        margin-bottom: 8px;
                    "
                >
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                        <div style="display:flex; align-items:center; gap:6px; min-width:0;">
                            <span style="font-size:11px; color:#5f769a; flex-shrink:0;">${index + 1}.</span>
                            <span style="font-size:13px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${this._escapeHtml(item.name)}</span>
                        </div>
                        <div style="display:inline-flex; align-items:center; gap:6px;">
                            <span class="mofo-sort-btn" data-mofo-id="${this._escapeHtml(item.id)}" data-dir="up" title="上移" style="width:18px; height:18px; border-radius:5px; border:1px solid #c9d8f1; display:inline-flex; align-items:center; justify-content:center; font-size:10px; color:#45648f; background:#f4f8ff; ${isFirst ? 'opacity:0.35; pointer-events:none;' : 'cursor:pointer;'}">↑</span>
                            <span class="mofo-sort-btn" data-mofo-id="${this._escapeHtml(item.id)}" data-dir="down" title="下移" style="width:18px; height:18px; border-radius:5px; border:1px solid #c9d8f1; display:inline-flex; align-items:center; justify-content:center; font-size:10px; color:#45648f; background:#f4f8ff; ${isLast ? 'opacity:0.35; pointer-events:none;' : 'cursor:pointer;'}">↓</span>
                        </div>
                    </div>
                    <div style="font-size:11px; opacity:0.9; margin-top:3px; color:#4b6186; padding-left:18px;">
                        标签: &lt;${this._escapeHtml(item.tagName)}&gt;
                    </div>
                </div>
            `;
        }).join('');
    }

    render() {
        if (this.currentPage !== 'main') {
            this.currentPage = 'main';
        }

        const items = this.app.mofoData.getItems();

        const html = `
            <div class="mofo-app" style="position:relative; height: 100%; box-sizing: border-box; padding-top: max(34px, env(safe-area-inset-top)); display: flex; flex-direction: column; background: linear-gradient(180deg, #f9fbff 0%, #f3f7ff 100%); color: #1f2f46;">
                <div style="position:relative; height: 56px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border-bottom: 1px solid #dde5f3; background:#fff; flex-shrink:0;">
                    <button class="mofo-back-btn app-back-btn" style="width:30px; height:30px; padding:0; box-sizing:border-box; border:1px solid #dce5f5; border-radius:8px; background:#f4f7fe; color:#4b6288; cursor:pointer; display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-chevron-left" style="font-size:12px; line-height:1;"></i></button>
                    <div style="position:absolute; left:50%; transform:translateX(-50%); font-size: 16px; font-weight: 700; letter-spacing: 0.5px; color:#1f2f46;">魔坊</div>
                    <div style="width:30px; height:30px;"></div>
                </div>
                <div style="flex:1; min-height:0; overflow:auto; padding:10px;">
                    <div style="margin-bottom:8px; font-size:11px; color:#5b7196; line-height:1.5; border-radius:10px; border:1px solid #d9e3f4; background:#f7faff; padding:8px 10px;">
                        这里只用于查看条目与排序。新建、编辑、删除、清理请在外部魔坊面板操作。
                    </div>
                    ${this._buildListHtml(items)}
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

        currentView.querySelectorAll('.mofo-sort-btn[data-mofo-id][data-dir]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = String(btn.getAttribute('data-mofo-id') || '').trim();
                const dir = String(btn.getAttribute('data-dir') || '').trim();
                if (!id || !dir) return;
                const moved = this.app.mofoData.moveItem(id, dir);
                if (!moved) return;
                this.render();
            });
        });
    }
}
