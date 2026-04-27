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
        this.selectionMode = false;
        this.selectedIds = new Set();
    }

    _escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _sanitizeFileNameSegment(value = '') {
        return String(value || '')
            .trim()
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 40);
    }

    _buildExportFileName(count = 0, singleName = '') {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        if (count === 1) {
            const safeName = this._sanitizeFileNameSegment(singleName) || 'mofo_template';
            return `${safeName}_${stamp}.json`;
        }
        return `mofo_templates_${count || 0}_${stamp}.json`;
    }

    _downloadJsonFile(filename, payload) {
        const jsonText = JSON.stringify(payload, null, 2);
        const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    _readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('读取文件失败'));
            reader.readAsText(file, 'utf-8');
        });
    }

    _syncSelectionWithItems(items = []) {
        const validIds = new Set(
            (Array.isArray(items) ? items : [])
                .map(item => String(item?.id || '').trim())
                .filter(Boolean)
        );
        this.selectedIds.forEach((id) => {
            if (!validIds.has(id)) {
                this.selectedIds.delete(id);
            }
        });
        if (!this.selectionMode) {
            this.selectedIds.clear();
        }
    }

    _buildListHtml(items) {
        if (!Array.isArray(items) || items.length === 0) {
            return `
                <div style="padding: 12px; border-radius: 10px; background: #fff; border: 1px solid #dfe6f4; color: #2f4463; font-size: 12px; line-height: 1.6;">
                    还没有魔坊条目。<br>你可以从其他人分享的模板文件导入，或在外部快捷回复面板里新建条目。
                </div>
            `;
        }
        return items.map((item, index) => {
            const isFirst = index === 0;
            const isLast = index === items.length - 1;
            const safeId = String(item.id || '').trim();
            const isSelected = this.selectedIds.has(safeId);
            return `
                <div
                    class="mofo-item-row"
                    data-mofo-id="${this._escapeHtml(safeId)}"
                    style="
                        width: 100%;
                        box-sizing: border-box;
                        border: 1px solid #dfe6f4;
                        background: #fff;
                        color: #1f2f46;
                        border-radius: 10px;
                        padding: 10px;
                        margin-bottom: 8px;
                        ${this.selectionMode && isSelected ? 'box-shadow: inset 0 0 0 2px rgba(42, 120, 255, 0.26); background:#f8fbff;' : ''}
                    "
                >
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                        <div style="display:flex; align-items:center; gap:6px; min-width:0;">
                            ${this.selectionMode ? `
                                <span class="mofo-select-btn" data-mofo-id="${this._escapeHtml(safeId)}" title="勾选导出" style="width:18px; height:18px; border-radius:5px; border:1px solid ${isSelected ? '#2a78ff' : '#c9d8f1'}; display:inline-flex; align-items:center; justify-content:center; font-size:10px; color:${isSelected ? '#fff' : '#6f86ab'}; background:${isSelected ? '#2a78ff' : '#f4f8ff'}; cursor:pointer; flex-shrink:0;">
                                    ${isSelected ? '✓' : ''}
                                </span>
                            ` : ''}
                            <span style="font-size:11px; color:#5f769a; flex-shrink:0;">${index + 1}.</span>
                            <span style="font-size:13px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${this._escapeHtml(item.name)}</span>
                        </div>
                        <div style="display:inline-flex; align-items:center; gap:6px;">
                            <span class="mofo-export-btn" data-mofo-id="${this._escapeHtml(safeId)}" title="导出该模板" style="height:20px; border-radius:6px; border:1px solid #b7caea; display:inline-flex; align-items:center; justify-content:center; font-size:10px; color:#315986; background:#f2f7ff; cursor:pointer; padding:0 6px;">导出</span>
                            <span class="mofo-sort-btn" data-mofo-id="${this._escapeHtml(safeId)}" data-dir="up" title="上移" style="width:18px; height:18px; border-radius:5px; border:1px solid #c9d8f1; display:inline-flex; align-items:center; justify-content:center; font-size:10px; color:#45648f; background:#f4f8ff; ${isFirst ? 'opacity:0.35; pointer-events:none;' : 'cursor:pointer;'}">↑</span>
                            <span class="mofo-sort-btn" data-mofo-id="${this._escapeHtml(safeId)}" data-dir="down" title="下移" style="width:18px; height:18px; border-radius:5px; border:1px solid #c9d8f1; display:inline-flex; align-items:center; justify-content:center; font-size:10px; color:#45648f; background:#f4f8ff; ${isLast ? 'opacity:0.35; pointer-events:none;' : 'cursor:pointer;'}">↓</span>
                        </div>
                    </div>
                    <div style="font-size:11px; opacity:0.9; margin-top:3px; color:#4b6186; padding-left:${this.selectionMode ? '24px' : '18px'};">
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
        this._syncSelectionWithItems(items);
        const selectedCount = this.selectedIds.size;
        const allSelected = items.length > 0 && selectedCount === items.length;

        const html = `
            <div class="mofo-app" style="position:relative; height: 100%; box-sizing: border-box; padding-top: max(34px, env(safe-area-inset-top)); display: flex; flex-direction: column; background: linear-gradient(180deg, #f9fbff 0%, #f3f7ff 100%); color: #1f2f46;">
                <div style="position:relative; height: 56px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border-bottom: 1px solid #dde5f3; background:#fff; flex-shrink:0;">
                    <button class="mofo-back-btn app-back-btn" style="width:30px; height:30px; padding:0; box-sizing:border-box; border:1px solid #dce5f5; border-radius:8px; background:#f4f7fe; color:#4b6288; cursor:pointer; display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-chevron-left" style="font-size:12px; line-height:1;"></i></button>
                    <div style="position:absolute; left:50%; transform:translateX(-50%); font-size: 16px; font-weight: 700; letter-spacing: 0.5px; color:#1f2f46;">魔坊</div>
                    <div style="width:30px; height:30px;"></div>
                </div>
                <div style="flex:1; min-height:0; overflow:auto; padding:10px;">
                    <div style="margin-bottom:8px; font-size:11px; color:#5b7196; line-height:1.5; border-radius:10px; border:1px solid #d9e3f4; background:#f7faff; padding:8px 10px;">
                        这里支持模板导入/导出与排序。新建、编辑、删除、清理请在外部魔坊面板操作。
                    </div>
                    <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:8px; margin-bottom:8px;">
                        <button id="mofo-import-btn" style="height:32px; border:1px solid #6ea0e8; border-radius:8px; background:#eaf3ff; color:#1f4f8c; font-size:12px; font-weight:700; cursor:pointer;">导入模板</button>
                        <button id="mofo-export-all-btn" style="height:32px; border:1px solid #7fb89f; border-radius:8px; background:#ecfbf3; color:#1c6c44; font-size:12px; font-weight:700; cursor:pointer;">导出全部</button>
                        <button id="mofo-toggle-select-btn" style="height:32px; border:1px solid #b5a4df; border-radius:8px; background:#f4f0ff; color:#59439a; font-size:12px; font-weight:700; cursor:pointer;">
                            ${this.selectionMode ? '完成多选' : '多选导出'}
                        </button>
                        <button id="mofo-export-selected-btn" ${selectedCount > 0 ? '' : 'disabled'} style="height:32px; border:1px solid ${selectedCount > 0 ? '#e0a67f' : '#d6dbe6'}; border-radius:8px; background:${selectedCount > 0 ? '#fff5ed' : '#f5f7fb'}; color:${selectedCount > 0 ? '#8a4d27' : '#95a0b5'}; font-size:12px; font-weight:700; cursor:${selectedCount > 0 ? 'pointer' : 'not-allowed'};">
                            导出选中(${selectedCount})
                        </button>
                    </div>
                    ${this.selectionMode ? `
                    <div style="margin-bottom:8px; display:flex; align-items:center; justify-content:space-between; font-size:11px; color:#4f6489; border:1px solid #d9e3f4; border-radius:8px; padding:6px 8px; background:#f9fbff;">
                        <span>多选模式已开启</span>
                        <button id="mofo-select-all-btn" style="border:1px solid #bfd0ec; border-radius:6px; background:#fff; color:#365b8f; font-size:11px; padding:3px 8px; cursor:pointer;">
                            ${allSelected ? '取消全选' : '全选'}
                        </button>
                    </div>
                    ` : ''}
                    <input type="file" id="mofo-import-input" accept=".json,application/json,text/plain" multiple style="display:none;">
                    ${this._buildListHtml(items)}
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'mofo-main');
        this.bindEvents();
    }

    bindEvents() {
        const currentView = document.querySelector('.phone-view-current') || document;
        const notify = (title, text, icon) => {
            this.app.phoneShell?.showNotification?.(title, text, icon);
        };
        const backBtn = currentView.querySelector('.mofo-back-btn');

        if (backBtn) {
            backBtn.onclick = (e) => {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('phone:goHome'));
            };
        }

        const exportByIds = (itemIds = [], singleName = '') => {
            const payload = this.app.mofoData.buildExportPayload(itemIds);
            const count = Number(payload?.count || payload?.items?.length || 0);
            if (count <= 0) {
                notify('提示', '没有可导出的模板', '⚠️');
                return;
            }
            const filename = this._buildExportFileName(count, singleName);
            this._downloadJsonFile(filename, payload);
            notify('导出成功', `已导出 ${count} 条模板`, '✅');
        };

        currentView.querySelector('#mofo-import-btn')?.addEventListener('click', () => {
            currentView.querySelector('#mofo-import-input')?.click();
        });

        currentView.querySelector('#mofo-export-all-btn')?.addEventListener('click', () => {
            exportByIds([]);
        });

        currentView.querySelector('#mofo-toggle-select-btn')?.addEventListener('click', () => {
            this.selectionMode = !this.selectionMode;
            if (!this.selectionMode) {
                this.selectedIds.clear();
            }
            this.render();
        });

        currentView.querySelector('#mofo-export-selected-btn')?.addEventListener('click', () => {
            const ids = Array.from(this.selectedIds);
            exportByIds(ids);
        });

        currentView.querySelector('#mofo-select-all-btn')?.addEventListener('click', () => {
            const items = this.app.mofoData.getItems();
            const ids = items.map(item => String(item?.id || '').trim()).filter(Boolean);
            const allSelected = ids.length > 0 && ids.every(id => this.selectedIds.has(id));
            if (allSelected) {
                this.selectedIds.clear();
            } else {
                this.selectedIds = new Set(ids);
            }
            this.render();
        });

        currentView.querySelector('#mofo-import-input')?.addEventListener('change', async (e) => {
            const files = Array.from(e?.target?.files || []);
            e.target.value = '';
            if (files.length === 0) return;

            let importedTotal = 0;
            let skippedTotal = 0;
            let renamedTotal = 0;
            let invalidFileCount = 0;

            for (const file of files) {
                try {
                    const text = await this._readFileAsText(file);
                    const payload = this.app.mofoData.parseImportPayloadText(text);
                    const result = this.app.mofoData.importItemsFromPayload(payload, { skipDuplicates: true });
                    if ((result?.totalCount || 0) <= 0) {
                        invalidFileCount += 1;
                        continue;
                    }
                    importedTotal += Number(result?.importedCount || 0);
                    skippedTotal += Number(result?.skippedCount || 0);
                    renamedTotal += Number(result?.renamedCount || 0);
                } catch (err) {
                    invalidFileCount += 1;
                }
            }

            if (importedTotal > 0) {
                this.selectionMode = false;
                this.selectedIds.clear();
                this.render();
            }

            const summaryParts = [`导入 ${importedTotal} 条`];
            if (skippedTotal > 0) summaryParts.push(`跳过 ${skippedTotal} 条重复/无效项`);
            if (renamedTotal > 0) summaryParts.push(`重命名ID ${renamedTotal} 条`);
            if (invalidFileCount > 0) summaryParts.push(`无效文件 ${invalidFileCount} 个`);

            if (importedTotal > 0) {
                notify('导入完成', summaryParts.join('，'), invalidFileCount > 0 ? '⚠️' : '✅');
            } else {
                notify('导入失败', invalidFileCount > 0 ? '未导入任何模板，请检查文件内容是否为有效 JSON 模板' : '没有可导入的模板', '❌');
            }
        });

        currentView.querySelectorAll('.mofo-select-btn[data-mofo-id]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = String(btn.getAttribute('data-mofo-id') || '').trim();
                if (!id) return;
                if (this.selectedIds.has(id)) {
                    this.selectedIds.delete(id);
                } else {
                    this.selectedIds.add(id);
                }
                this.render();
            });
        });

        currentView.querySelectorAll('.mofo-export-btn[data-mofo-id]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = String(btn.getAttribute('data-mofo-id') || '').trim();
                if (!id) return;
                const item = this.app.mofoData.getItemById(id);
                exportByIds([id], item?.name || 'mofo_template');
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
                this.render();
            });
        });
    }
}
