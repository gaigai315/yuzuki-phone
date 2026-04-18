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
        this.selectedItemId = null;
    }

    _escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _formatTime(ts) {
        if (!ts) return '-';
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) return '-';
        return d.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    _formatStateJson(obj) {
        try {
            return JSON.stringify(obj || {}, null, 2);
        } catch (e) {
            return '{}';
        }
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
            const active = String(item.id) === String(this.selectedItemId);
            const isFirst = index === 0;
            const isLast = index === items.length - 1;
            return `
                <button
                    class="mofo-item-btn ${active ? 'is-active' : ''}"
                    data-mofo-id="${this._escapeHtml(item.id)}"
                    style="
                        width: 100%;
                        text-align: left;
                        border: 1px solid ${active ? '#8ea9df' : '#dfe6f4'};
                        background: ${active ? '#e9f0ff' : '#fff'};
                        color: #1f2f46;
                        border-radius: 10px;
                        padding: 10px;
                        margin-bottom: 8px;
                        cursor: pointer;
                    "
                >
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                        <div style="font-size: 13px; font-weight: 700;">${this._escapeHtml(item.name)}</div>
                        <div style="display:inline-flex; align-items:center; gap:6px;">
                            <span class="mofo-sort-btn" data-mofo-id="${this._escapeHtml(item.id)}" data-dir="up" title="上移" style="width:18px; height:18px; border-radius:5px; border:1px solid #c9d8f1; display:inline-flex; align-items:center; justify-content:center; font-size:10px; color:#45648f; background:#f4f8ff; ${isFirst ? 'opacity:0.35; pointer-events:none;' : 'cursor:pointer;'}">↑</span>
                            <span class="mofo-sort-btn" data-mofo-id="${this._escapeHtml(item.id)}" data-dir="down" title="下移" style="width:18px; height:18px; border-radius:5px; border:1px solid #c9d8f1; display:inline-flex; align-items:center; justify-content:center; font-size:10px; color:#45648f; background:#f4f8ff; ${isLast ? 'opacity:0.35; pointer-events:none;' : 'cursor:pointer;'}">↓</span>
                        </div>
                    </div>
                    <div style="font-size: 11px; opacity: 0.9; margin-top: 3px; color: #4b6186;">标签: &lt;${this._escapeHtml(item.tagName)}&gt;</div>
                    <div style="font-size: 10px; margin-top: 4px; color: ${item.offlinePromptEnabled === false ? '#9a6a76' : '#2f6a54'};">
                        线下注入: ${item.offlinePromptEnabled === false ? '关闭' : '开启'}
                    </div>
                </button>
            `;
        }).join('');
    }

    _buildDetailHtml(item) {
        if (!item) {
            return `
                <div style="height: 100%; display: flex; align-items: center; justify-content: center; color: #5c7092; opacity: 0.95; font-size: 12px;">
                    请选择左侧魔坊条目
                </div>
            `;
        }

        const safeCss = String(item.cssText || '').replace(/<\/style/gi, '<\\/style');
        const stateEntries = Object.entries(item.state || {});
        const rows = stateEntries.length > 0
            ? stateEntries.map(([k, v]) => `
                <div style="display:flex; justify-content:space-between; gap:8px; padding:6px 8px; border-radius:8px; background:#f5f8ff; border:1px solid #e2e9f7; margin-bottom:6px;">
                    <span style="font-size:11px; opacity:0.92; color:#3c5277;">${this._escapeHtml(k)}</span>
                    <span style="font-size:11px; font-weight:700; color:#1f2f46;">${this._escapeHtml(typeof v === 'object' ? JSON.stringify(v) : String(v))}</span>
                </div>
            `).join('')
            : '<div style="font-size:11px; color:#6a7f9f;">暂无抓取值</div>';

        return `
            <style>${safeCss}</style>
            <div style="display:flex; flex-direction:column; gap:10px; height:100%;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                    <div>
                        <div style="font-size:15px; font-weight:700; color:#1f2f46;">${this._escapeHtml(item.name)}</div>
                        <div style="font-size:11px; opacity:0.9; color:#5a7093;">标签: &lt;${this._escapeHtml(item.tagName)}&gt; · 更新: ${this._escapeHtml(this._formatTime(item.updatedAt))}</div>
                        <div style="font-size:11px; opacity:0.92; color:${item.offlinePromptEnabled === false ? '#9a6a76' : '#2f6a54'};">
                            线下提示词注入：${item.offlinePromptEnabled === false ? '未启用' : '已启用'}
                        </div>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button id="mofo-clear-session-btn" style="border:none; border-radius:8px; padding:6px 10px; font-size:11px; cursor:pointer; background:#4f7fd5; color:#fff;">清理本会话</button>
                        <button id="mofo-delete-global-btn" style="border:none; border-radius:8px; padding:6px 10px; font-size:11px; cursor:pointer; background:rgba(255,80,120,0.9); color:#fff;">全局删除</button>
                    </div>
                </div>

                <div class="mofo-preview-card" style="border-radius:12px; padding:10px; background:#fff; border:1px solid #dce4f2;">
                    ${rows}
                </div>

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; min-height:0;">
                    <div style="min-width:0; border-radius:10px; background:#fff; border:1px solid #dce4f2; padding:8px;">
                        <div style="font-size:11px; font-weight:700; margin-bottom:6px; opacity:0.95; color:#2a436e;">提示词模板</div>
                        <div style="font-size:11px; line-height:1.5; color:#344d72; white-space:pre-wrap; max-height:120px; overflow:auto;">${this._escapeHtml(item.promptTemplate || '未设置')}</div>
                    </div>
                    <div style="min-width:0; border-radius:10px; background:#fff; border:1px solid #dce4f2; padding:8px;">
                        <div style="font-size:11px; font-weight:700; margin-bottom:6px; opacity:0.95; color:#2a436e;">当前状态(JSON)</div>
                        <pre style="font-size:10px; line-height:1.45; color:#334f78; margin:0; white-space:pre-wrap; max-height:120px; overflow:auto;">${this._escapeHtml(this._formatStateJson(item.state))}</pre>
                    </div>
                </div>
            </div>
        `;
    }

    render() {
        if (this.currentPage !== 'main') {
            this.currentPage = 'main';
        }

        const items = this.app.mofoData.getItems();
        if (items.length > 0 && !items.some(item => String(item.id) === String(this.selectedItemId))) {
            this.selectedItemId = items[0].id;
        }
        if (items.length === 0) this.selectedItemId = null;
        const selectedItem = this.selectedItemId ? this.app.mofoData.getItemById(this.selectedItemId) : null;

        const html = `
            <div class="mofo-app" style="position:relative; height: 100%; box-sizing: border-box; padding-top: max(34px, env(safe-area-inset-top)); display: flex; flex-direction: column; background: linear-gradient(180deg, #f9fbff 0%, #f3f7ff 100%); color: #1f2f46;">
                <div style="position:relative; height: 56px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border-bottom: 1px solid #dde5f3; background:#fff; flex-shrink:0;">
                    <button class="mofo-back-btn app-back-btn" style="width:30px; height:30px; padding:0; box-sizing:border-box; border:1px solid #dce5f5; border-radius:8px; background:#f4f7fe; color:#4b6288; cursor:pointer; display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-chevron-left" style="font-size:12px; line-height:1;"></i></button>
                    <div style="position:absolute; left:50%; transform:translateX(-50%); font-size: 16px; font-weight: 700; letter-spacing: 0.5px; color:#1f2f46;">魔坊</div>
                    <div style="width:30px; height:30px;"></div>
                </div>
                <div style="flex:1; min-height:0; display:grid; grid-template-columns: 1fr 1.35fr; gap:10px; padding:10px;">
                    <div class="mofo-list-col" style="min-height:0; overflow:auto; padding-right:2px;">
                        ${this._buildListHtml(items)}
                    </div>
                    <div class="mofo-detail-col" style="min-height:0; border-radius:14px; padding:10px; background:#eff4fe; box-shadow: inset 0 0 0 1px #d7e1f2; overflow:auto;">
                        ${this._buildDetailHtml(selectedItem)}
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

        currentView.querySelectorAll('.mofo-item-btn[data-mofo-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-mofo-id');
                this.selectedItemId = id;
                this.render();
            });
        });
        currentView.querySelectorAll('.mofo-sort-btn[data-mofo-id][data-dir]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = String(btn.getAttribute('data-mofo-id') || '').trim();
                const dir = String(btn.getAttribute('data-dir') || '').trim();
                if (!id || !dir) return;
                const moved = this.app.mofoData.moveItem(id, dir);
                if (!moved) return;
                this.selectedItemId = id;
                this.render();
            });
        });

        const clearSessionBtn = currentView.querySelector('#mofo-clear-session-btn');
        clearSessionBtn?.addEventListener('click', () => {
            const current = this.selectedItemId ? this.app.mofoData.getItemById(this.selectedItemId) : null;
            if (!current) return;
            const ok = confirm(`清理魔坊「${current.name}」在当前会话的数据？\n条目会保留。`);
            if (!ok) return;
            this.app.mofoData.clearItemSessionData(current.id);
            this.render();
        });

        const deleteGlobalBtn = currentView.querySelector('#mofo-delete-global-btn');
        deleteGlobalBtn?.addEventListener('click', () => {
            const current = this.selectedItemId ? this.app.mofoData.getItemById(this.selectedItemId) : null;
            if (!current) return;
            const ok = confirm(`全局删除魔坊「${current.name}」？\n会删除条目定义，并清理各会话里的对应运行态数据。`);
            if (!ok) return;
            this.app.mofoData.removeItem(current.id);
            const list = this.app.mofoData.getItems();
            this.selectedItemId = list[0]?.id || null;
            this.render();
        });
    }
}
