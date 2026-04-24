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
// 📔 日记视图 - UI渲染与交互
// ========================================

export class DiaryView {
    constructor(app) {
        this.app = app;
        this.currentView = 'cover'; // 'cover' | 'toc' | 'page' | 'settings'
        this.currentEntryId = null;
        this.settingsPanelOpen = false;
        this.tocOrder = 'desc';
        this._cssLoaded = false;
        this._previousView = 'cover';
        this.isBackNav = false; 
    }

    loadCSS() {
        if (this._cssLoaded) return;
        if (document.getElementById('diary-css')) {
            this._cssLoaded = true;
            return;
        }
        const link = document.createElement('link');
        link.id = 'diary-css';
        link.rel = 'stylesheet';
        link.href = new URL('./diary.css?v=1.0.0', import.meta.url).href;
        document.head.appendChild(link);
        this._cssLoaded = true;
    }

    render() {
        this.loadCSS();
        // 每次渲染时清除缓存，确保获取最新数据
        this.app.diaryData._entries = null;
        let result;
        switch (this.currentView) {
            case 'cover': result = this.renderCover(); break;
            case 'toc': result = this.renderTOC(); break;
            case 'page': result = this.renderPage(); break;
            case 'settings': result = this.renderSettings(); break;
            case 'edit': result = this.renderEdit(); break;
            default: result = this.renderCover(); break;
        }
        this.isBackNav = false; // 重置标志位
        return result;
    }

    // ==================== 封面视图 ====================

    renderCover() {
        const data = this.app.diaryData;
        const entries = data.getEntries();
        const coverBg = data.getCoverBg();
        const bgStyle = coverBg ? `background-image: url('${coverBg}'); background-size: cover; background-position: center;` : '';
        const showText = !coverBg;

        const html = `
            <div class="diary-app">
                <div class="diary-cover" id="diary-cover" style="${bgStyle}">
                    ${showText ? `
                        <div class="diary-cover-decoration"></div>
                        <div class="diary-cover-title">我 的 日 记</div>
                        <div class="diary-cover-subtitle">${entries.length > 0 ? `共 ${entries.length} 篇` : '尚无记录'}</div>
                        <div class="diary-cover-decoration"></div>
                    ` : ''}
                    <div class="diary-clasp" id="diary-clasp">
                        <div class="diary-clasp-strap"></div>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'diary-' + this.currentView);
        requestAnimationFrame(() => this._bindCoverEvents());
    }

    _bindCoverEvents() {
        const clasp = document.getElementById('diary-clasp');
        if (clasp) {
            // 🔥 核心修复：重置锁，防止 DOM 复用导致的死锁
            clasp.dataset.clicked = ''; 
            // 🔥 核心修复：使用 onclick 覆盖事件，防止叠罗汉
            clasp.onclick = () => {
                if (clasp.dataset.clicked === 'true') return;
                clasp.dataset.clicked = 'true';
                this.currentView = 'toc';
                this.render();
            };
        }
    }

    // ==================== 目录视图 ====================

    renderTOC() {
        const data = this.app.diaryData;
        const entries = data.getEntries();
        const sorted = this.tocOrder === 'desc' ? [...entries].reverse() : [...entries];
        const tocBg = data.getTocBg();
        const bgStyle = tocBg ? `background-image: url('${tocBg}'); background-size: cover; background-position: center;` : '';
        const enterClass = this.isBackNav ? '' : 'diary-view-enter';

        let listHtml;
        if (sorted.length === 0) {
            listHtml = `
                <div class="diary-toc-empty">
                    <div class="diary-toc-empty-text">还没有日记，写一篇吧</div>
                </div>
            `;
        } else {
            listHtml = sorted.map(entry => {
                const parsed = this._parseDate(entry.date);
                const preview = (entry.content || '').replace(/【[^】]*】/g, '').trim().slice(0, 40);
                const titleMatch = (entry.content || '').match(/【([^】]+)】/);
                const diaryTitle = (titleMatch && !titleMatch[1].match(/\d{4}年/)) ? titleMatch[1] : '';
                return `
                    <div class="diary-toc-item" data-id="${entry.id}">
                        <div class="diary-toc-item-date">
                            <div class="diary-toc-item-year">${parsed.full.match(/\d{4}/)?.[0] || ''}年</div>
                            <div class="diary-toc-item-day">${parsed.day}</div>
                            <div class="diary-toc-item-month">${parsed.monthLabel}</div>
                            <div class="diary-toc-item-weekday">${parsed.weekday}</div>
                        </div>
                        <div class="diary-toc-item-info">
                            <div class="diary-toc-item-title">${diaryTitle || '无标题'}</div>
                            <div class="diary-toc-item-preview">${preview || '...'}</div>
                        </div>
                        <div class="diary-toc-item-actions" style="display:none;">
                            <button class="diary-toc-item-edit" data-id="${entry.id}">✏️</button>
                            <button class="diary-toc-item-delete" data-id="${entry.id}">🗑️</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        const deleteAllBtn = sorted.length > 0 ? `<button class="diary-toc-btn diary-delete-all-btn" id="diary-delete-all" title="全部删除" style="display:none;">🗑️</button>` : '';

        const html = `
            <div class="diary-app">
                <div class="diary-toc ${enterClass}" style="${bgStyle}">
                    <div class="diary-toc-header">
                        <div class="diary-toc-actions">
                            ${deleteAllBtn}
                            <button class="diary-toc-btn diary-pencil-btn" id="diary-manual-write" title="设置">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="diary-toc-list">
                        ${listHtml}
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'diary-' + this.currentView);
        this._bindTOCEvents();
    }

    _bindTOCEvents() {
        const writeBtn = document.getElementById('diary-manual-write');
        if (writeBtn) writeBtn.onclick = () => {
            this._previousView = this.currentView;
            this.currentView = 'settings';
            this.render();
        };

        let longPressTimer = null;
        const deleteAllBtn = document.getElementById('diary-delete-all');
        if (deleteAllBtn) deleteAllBtn.onclick = () => {
            if (confirm('确定删除全部日记吗？此操作不可恢复！')) {
                this.app.diaryData.clearAllEntries();
                this.render();
            }
        };

        document.querySelectorAll('.diary-toc-item').forEach(item => {
            // 🔥 防止重复绑定定时器事件
            if (item.dataset.bound) return;
            item.dataset.bound = 'true';

            const actionsDiv = item.querySelector('.diary-toc-item-actions');
            const editBtn = item.querySelector('.diary-toc-item-edit');
            const deleteBtn = item.querySelector('.diary-toc-item-delete');

            item.addEventListener('mousedown', (e) => {
                if (e.target.closest('.diary-toc-item-actions')) return;
                longPressTimer = setTimeout(() => {
                    actionsDiv.style.display = 'flex';
                    if (deleteAllBtn) deleteAllBtn.style.display = 'flex';
                }, 1000); 
            });

            item.addEventListener('touchstart', (e) => {
                if (e.target.closest('.diary-toc-item-actions')) return;
                longPressTimer = setTimeout(() => {
                    actionsDiv.style.display = 'flex';
                    if (deleteAllBtn) deleteAllBtn.style.display = 'flex';
                }, 500); 
            });

            const clearTimer = () => clearTimeout(longPressTimer);
            item.addEventListener('mouseup', clearTimer);
            item.addEventListener('mouseleave', clearTimer);
            item.addEventListener('touchend', clearTimer);
            item.addEventListener('touchcancel', clearTimer);

            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                actionsDiv.style.display = 'flex';
                if (deleteAllBtn) deleteAllBtn.style.display = 'flex';
            });

            // 🔥 核心：点击事件改为 onclick
            item.onclick = (e) => {
                if (e.target.closest('.diary-toc-item-actions')) return;
                if (actionsDiv.style.display === 'flex') {
                    actionsDiv.style.display = 'none';
                    if (deleteAllBtn) deleteAllBtn.style.display = 'none';
                    return;
                }
                this.currentEntryId = item.dataset.id;
                this.currentView = 'page';
                this.settingsPanelOpen = false;
                this.render();
            };

            if (editBtn) editBtn.onclick = (e) => {
                e.stopPropagation();
                this._openEditDialog(editBtn.dataset.id);
            };

            if (deleteBtn) deleteBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm('确定删除这篇日记吗？')) {
                    this.app.diaryData.deleteEntry(deleteBtn.dataset.id);
                    this.render();
                }
            };
        });
    }

    // ==================== 内容页视图 ====================

    renderPage() {
        const data = this.app.diaryData;
        const entry = data.getEntry(this.currentEntryId);
        if (!entry) {
            this.currentView = 'toc';
            this.render();
            return;
        }

        const lineHeight = data.getGlobalLineHeight();
        const fontSize = data.getGlobalFontSize();
        const pageBg = data.getPageBg(entry.id) || data.getGlobalBg();
        const enterClass = this.isBackNav ? '' : 'diary-view-enter';

        const bgHtml = pageBg ? `<div class="diary-page-bg" style="background-image: url('${pageBg}');"></div>` : '';
        const bodyClass = pageBg ? 'diary-page-body has-bg' : 'diary-page-body';
        const diaryTitle = this._extractTitle(entry.content);

        const html = `
            <div class="diary-app">
                <div class="diary-page ${enterClass}">
                    <div class="diary-page-header">
                        <button class="diary-page-back diary-pencil-btn" id="diary-page-back">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M15 18l-6-6 6-6"/>
                        </svg>
                        </button>
                        <div class="diary-page-date">${diaryTitle}</div>
                        <button class="diary-page-settings-btn diary-pencil-btn" id="diary-page-settings">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                            </svg>
                        </button>
                    </div>
                    ${bgHtml}
                    <div class="${bodyClass}" id="diary-page-body">
                        <div class="diary-page-content" id="diary-page-content" style="font-size: ${fontSize}px; line-height: ${lineHeight};">
                            ${this._formatContent(entry.content)}
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'diary-' + this.currentView);
        this._bindPageEvents();
    }

    _bindPageEvents() {
        const backBtn = document.getElementById('diary-page-back');
        if (backBtn) backBtn.onclick = () => {
            this.currentView = 'toc';
            this.currentEntryId = null;
            this.isBackNav = true;
            this.render();
        };

        const settingsBtn = document.getElementById('diary-page-settings');
        if (settingsBtn) settingsBtn.onclick = () => {
            this._previousView = this.currentView;
            this.currentView = 'settings';
            this.render();
        };
    }

    // ==================== 设置视图 ====================

    renderSettings() {
        const pm = this._getPromptManager();
        const diaryConfig = pm?.prompts?.diary || {};
        const autoEnabled = diaryConfig.autoEnabled || false;
        const autoFloor = diaryConfig.autoFloor || 50;
        const batchMode = diaryConfig.batchMode !== false;
        
        const context = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
        const totalFloor = context?.chat?.length || 0;
        const lastIndex = this.app.diaryData.getLastDiaryFloorIndex();
        const displayLastIndex = lastIndex >= 0 ? lastIndex : 0;
        const defaultStart = lastIndex >= 0 ? lastIndex + 1 : 0;
        const enterClass = this.isBackNav ? '' : 'diary-view-enter';

        const globalLineHeight = this.app.diaryData.getGlobalLineHeight();
        const globalFontSize = this.app.diaryData.getGlobalFontSize();
        const autoLastFloor = this.app.diaryData.getAutoLastFloor() || 0;

        const html = `
            <div class="diary-app">
                <div class="diary-settings-view ${enterClass}">
                    <div class="diary-toc-header">
                        <div class="diary-toc-title">日记设置</div>
                        <div class="diary-toc-actions">
                            <button class="diary-toc-btn" id="diary-settings-back" title="返回">✕</button>
                        </div>
                    </div>
                    <div class="diary-settings-body">
                        <!-- 正文样式 -->
                        <div class="diary-s-section">
                            <div class="diary-s-section-title">正文样式</div>
                            <div class="diary-s-row">
                                <span class="diary-s-label">字体大小: <span id="diary-fs-value">${globalFontSize}</span>px</span>
                                <input type="range" id="diary-fs-slider" min="12" max="24" step="1" value="${globalFontSize}" class="diary-s-slider">
                            </div>
                            <div class="diary-s-row">
                                <span class="diary-s-label">行间距: <span id="diary-lh-value">${globalLineHeight}</span></span>
                                <input type="range" id="diary-lh-slider" min="1.2" max="3" step="0.1" value="${globalLineHeight}" class="diary-s-slider">
                            </div>
                        </div>

                        <!-- 目录排序 -->
                        <div class="diary-s-section">
                            <div class="diary-s-section-title">目录排序</div>
                            <div class="diary-s-row">
                                <span class="diary-s-label">倒序显示（新的在前）</span>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="diary-s-order" ${this.tocOrder === 'desc' ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                        </div>

                        <!-- 背景图设置 -->
                        <div class="diary-s-section">
                            <div class="diary-s-section-title">背景图设置</div>
                            <div class="diary-s-desc">自定义日记各页面的背景图片</div>
                            <div class="diary-s-btn-row" style="margin-top: 8px; justify-content: flex-start;">
                                <label class="diary-s-btn diary-s-btn-primary" for="diary-bg-cover">📔 封面</label>
                                <input type="file" id="diary-bg-cover" accept="image/png, image/jpeg, image/gif, image/webp, image/*" style="display:none;">
                                <label class="diary-s-btn diary-s-btn-primary" for="diary-bg-toc">📋 目录</label>
                                <input type="file" id="diary-bg-toc" accept="image/png, image/jpeg, image/gif, image/webp, image/*" style="display:none;">
                                <label class="diary-s-btn diary-s-btn-primary" for="diary-bg-global">📄 日记</label>
                                <input type="file" id="diary-bg-global" accept="image/png, image/jpeg, image/gif, image/webp, image/*" style="display:none;">
                            </div>
                        </div>

                        <!-- 手动生成日记 -->
                        <div class="diary-s-section">
                            <div class="diary-s-section-title">手动生成日记</div>
                            <div class="diary-s-desc">指定楼层范围，手动触发AI生成日记</div>
                            <div class="diary-s-row" style="margin-top: 8px;">
                                <span class="diary-s-label">起始楼层</span>
                                <input type="number" id="diary-manual-start" min="0" max="${totalFloor}" value="${defaultStart}" class="diary-s-input" style="width: 70px;">
                            </div>
                            <div class="diary-s-row">
                                <span class="diary-s-label">结束楼层</span>
                                <input type="number" id="diary-manual-end" min="0" max="${totalFloor}" value="${totalFloor}" class="diary-s-input" style="width: 70px;">
                            </div>
                            <div class="diary-s-row">
                                <span class="diary-s-label">启用分批模式</span>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="diary-s-batch" ${batchMode ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                            <div class="diary-s-row">
                                <span class="diary-s-label">每批楼层数</span>
                                <input type="number" id="diary-batch-size" min="10" max="200" value="${autoFloor}" class="diary-s-input" style="width: 70px;">
                            </div>
                            <div class="diary-s-desc" style="opacity: 0.6; display: flex; align-items: center; gap: 8px; margin-top: 4px;">当前总楼层: ${totalFloor}，上次记录到: <input type="number" id="diary-manual-last-input" min="0" max="${totalFloor}" value="${displayLastIndex}" class="diary-s-input" style="width: 55px; height: 22px; padding: 0 4px; font-size: 11px;"><button class="diary-s-btn diary-s-btn-primary" id="diary-manual-last-save" style="padding: 2px 8px; font-size: 11px; min-width: auto;">修正</button></div>
                            <button class="diary-s-btn diary-s-btn-primary" id="diary-manual-run" style="width: 100%; margin-top: 8px; padding: 10px;">
                                🚀 开始生成日记
                            </button>
                            <div id="diary-manual-status" class="diary-s-desc" style="text-align: center; margin-top: 6px; min-height: 18px;"></div>
                        </div>

                        <!-- 自动写日记 -->
                        <div class="diary-s-section">
                            <div class="diary-s-section-title">自动写日记</div>
                            <div class="diary-s-row">
                                <span class="diary-s-label">开启自动写日记</span>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="diary-s-auto" ${autoEnabled ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                            <div class="diary-s-desc">达到指定楼层数后自动触发AI写日记</div>
                            <div class="diary-s-row">
                                <span class="diary-s-label">触发楼层数</span>
                                <input type="number" id="diary-s-floor" min="10" max="9999" value="${autoFloor}" class="diary-s-input">
                            </div>
                            <!-- 🔥 新增：修正自动记录楼层的 UI -->
                            <div class="diary-s-row" style="margin-top: 10px;">
                                <span class="diary-s-label">上次记录到</span>
                                <div style="display: flex; gap: 8px;">
                                    <input type="number" id="diary-auto-last-input" min="0" max="${totalFloor}" value="${autoLastFloor}" class="diary-s-input" style="width: 70px;">
                                    <button class="diary-s-btn diary-s-btn-primary" id="diary-auto-last-save">修正</button>
                                </div>
                            </div>
                            <div class="diary-s-desc" style="opacity: 0.6; margin-top: 4px;">修正此数值可以重置AI的计算起点。如果AI漏记了或重写了，可手动调整该数值。</div>
                        </div>

                        <!-- 提示词编辑 -->
                        <div class="diary-s-section">
                            <div class="diary-s-section-title">日记提示词</div>
                            <div class="phone-prompt-fold" data-default-open="false">
                                <div class="phone-prompt-fold-header">
                                    <div class="phone-prompt-fold-main">
                                        <div class="phone-prompt-fold-title">📔 日记生成提示词</div>
                                        <div class="phone-prompt-fold-desc">默认折叠，展开后可编辑完整提示词。</div>
                                    </div>
                                    <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow"></i>
                                </div>
                                <div class="phone-prompt-fold-content">
                                    <div class="diary-s-desc">自定义AI写日记时使用的提示词</div>
                                    <textarea id="diary-s-prompt" class="diary-s-textarea">${this._getPromptContent().replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
                                    <div class="diary-s-btn-row">
                                        <button class="diary-s-btn diary-s-btn-warn" id="diary-s-prompt-reset">恢复默认</button>
                                        <button class="diary-s-btn diary-s-btn-primary" id="diary-s-prompt-save">保存提示词</button>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'diary-' + this.currentView);
        this._bindSettingsEvents();
    }

    _bindSettingsEvents() {
        this._bindPromptFoldToggles(document.querySelector('.phone-view-current .diary-settings-view') || document);
        // 🔥 UI 状态恢复：如果后台正在跑分批任务，立即恢复进度显示
        const runBtn = document.getElementById('diary-manual-run');
        const statusEl = document.getElementById('diary-manual-status');
        if (window.VirtualPhone?.isDiaryBatchRunning) {
            if (runBtn) {
                runBtn.textContent = '🛑 停止 (后台执行中)';
                runBtn.disabled = false;
            }
            const progress = window.VirtualPhone?.diaryBatchProgress;
            if (progress && statusEl) {
                statusEl.textContent = `🔄 正在执行第 ${progress.current}/${progress.total} 批...`;
            }
        }

        const backBtn = document.getElementById('diary-settings-back');
        if (backBtn) backBtn.onclick = () => {
            this.currentView = this._previousView;
            this._previousView = 'cover';
            this.isBackNav = true;
            this.render();
        };

        const fsSlider = document.getElementById('diary-fs-slider');
        if (fsSlider) {
            fsSlider.oninput = (e) => { document.getElementById('diary-fs-value').textContent = e.target.value; };
            fsSlider.onchange = (e) => { this.app.diaryData.setGlobalFontSize(parseInt(e.target.value)); };
        }

        const lhSlider = document.getElementById('diary-lh-slider');
        if (lhSlider) {
            lhSlider.oninput = (e) => { document.getElementById('diary-lh-value').textContent = parseFloat(e.target.value).toFixed(1); };
            lhSlider.onchange = (e) => { this.app.diaryData.setGlobalLineHeight(parseFloat(e.target.value)); };
        }

        const orderToggle = document.getElementById('diary-s-order');
        if (orderToggle) orderToggle.onchange = (e) => {
            this.tocOrder = e.target.checked ? 'desc' : 'asc';
        };

        const bgCover = document.getElementById('diary-bg-cover');
        if (bgCover) bgCover.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            e.target.value = '';
            const base64 = await this._processImage(file);
            if (base64) {
                try {
                    await this.app.diaryData.setCoverBg(base64);
                    this.render();
                    alert('✅ 封面背景已成功上传到酒馆服务器');
                } catch (err) {
                    alert('❌ 封面背景上传失败：' + (err?.message || err));
                }
            }
        };

        const bgToc = document.getElementById('diary-bg-toc');
        if (bgToc) bgToc.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            e.target.value = '';
            const base64 = await this._processImage(file);
            if (base64) {
                try {
                    await this.app.diaryData.setTocBg(base64);
                    this.render();
                    alert('✅ 目录背景已成功上传到酒馆服务器');
                } catch (err) {
                    alert('❌ 目录背景上传失败：' + (err?.message || err));
                }
            }
        };

        const bgGlobal = document.getElementById('diary-bg-global');
        if (bgGlobal) bgGlobal.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            e.target.value = '';
            const base64 = await this._processImage(file);
            if (base64) {
                try {
                    await this.app.diaryData.setGlobalBg(base64);
                    this.render();
                    alert('✅ 日记默认背景已成功上传到酒馆服务器');
                } catch (err) {
                    alert('❌ 日记默认背景上传失败：' + (err?.message || err));
                }
            }
        };

        const manualRun = document.getElementById('diary-manual-run');
        if (manualRun) manualRun.onclick = async () => {
            const btn = document.getElementById('diary-manual-run');
            const statusEl = document.getElementById('diary-manual-status');
            if (!btn) return;

            // 🔥 使用全局状态判断是否正在运行
            if (window.VirtualPhone?.isDiaryBatchRunning) {
                this.app.diaryData.stopBatch = true;
                btn.textContent = '🛑 正在停止...';
                btn.disabled = true;
                return;
            }

            const startInput = document.getElementById('diary-manual-start');
            const endInput = document.getElementById('diary-manual-end');
            const start = parseInt(startInput?.value) || 0;
            const end = parseInt(endInput?.value) || 0;

            if (start >= end) { alert('起始楼层必须小于结束楼层'); return; }
            if (end - start < 2) { alert('楼层范围太小，至少需要2层'); return; }

            this.app.diaryData.stopBatch = false;
            btn.textContent = '⏳ 正在执行...';
            btn.disabled = true;
            if (statusEl) statusEl.textContent = '初始化中...';

            try {
                const batchModeEnabled = document.getElementById('diary-s-batch')?.checked !== false;
                const batchSizeInput = document.getElementById('diary-batch-size');
                const batchSize = parseInt(batchSizeInput?.value) || 50;
                const data = this.app.diaryData;

                if (batchModeEnabled && (end - start) > batchSize) {
                    btn.textContent = '🛑 停止';
                    btn.disabled = false;
                    await data.batchGenerateDiary(start, end, batchSize, (current, total, status) => {
                        const liveBtn = document.getElementById('diary-manual-run');
                        const liveStatus = document.getElementById('diary-manual-status');
                        if (liveStatus) liveStatus.textContent = `🔄 ${status}`;
                        if (liveBtn) liveBtn.textContent = `🛑 停止 (${current}/${total})`;
                    });
                } else {
                    if (statusEl) statusEl.textContent = '🔄 正在写日记...';
                    const diaries = await data.callAIToWriteDiary(start, end);
                    for (const diary of diaries) {
                        data.addEntry({
                            content: diary.content,
                            title: diary.title,
                            startIndex: start,
                            endIndex: end,
                            date: diary.date,
                        });
                    }
                }
                if (statusEl) statusEl.textContent = '✅ 生成完成！';
                setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
            } catch (err) {
                console.error('[DiaryView] 生成日记失败:', err);
                if (statusEl) statusEl.textContent = `❌ 失败: ${err.message}`;
            } finally {
                this.app.diaryData.stopBatch = false;
                const liveBtn = document.getElementById('diary-manual-run');
                if (liveBtn) {
                    liveBtn.textContent = '🚀 开始生成日记';
                    liveBtn.disabled = false;
                }
            }
        };

        const sAuto = document.getElementById('diary-s-auto');
        if (sAuto) sAuto.onchange = (e) => {
            const pm = this._getPromptManager();
            if (pm?.prompts?.diary) {
                pm.prompts.diary.autoEnabled = e.target.checked;
                pm.savePrompts();
            }
        };

        const sFloor = document.getElementById('diary-s-floor');
        if (sFloor) sFloor.onchange = (e) => {
            const val = Math.max(10, Math.min(9999, parseInt(e.target.value) || 50));
            e.target.value = val;
            const pm = this._getPromptManager();
            if (pm?.prompts?.diary) {
                pm.prompts.diary.autoFloor = val;
                pm.savePrompts();
            }
        };

        // 🔥 新增：手动日记修正楼层按钮点击事件
        const manualLastSaveBtn = document.getElementById('diary-manual-last-save');
        if (manualLastSaveBtn) {
            manualLastSaveBtn.onclick = () => {
                const inputVal = document.getElementById('diary-manual-last-input').value;
                const val = parseInt(inputVal) || 0;

                const entries = this.app.diaryData.getEntries();
                const shell = window.VirtualPhone?.phoneShell || this.app.phoneShell;

                if (entries.length > 0) {
                    entries[entries.length - 1].endIndex = val;
                    this.app.diaryData.saveEntries();

                    // 同步更新上方"起始楼层"输入框的值
                    const startInput = document.getElementById('diary-manual-start');
                    if (startInput) startInput.value = val + 1;

                    shell?.showNotification('保存成功', `手动记录起点已修正为: ${val} 层`, '✅');
                } else {
                    shell?.showNotification('提示', '当前没有日记，无法修正楼层', '⚠️');
                }
            };
        }

        // 🔥 新增：自动日记修正楼层按钮点击事件
        const autoLastSaveBtn = document.getElementById('diary-auto-last-save');
        if (autoLastSaveBtn) {
            autoLastSaveBtn.onclick = () => {
                const inputVal = document.getElementById('diary-auto-last-input').value;
                const val = parseInt(inputVal) || 0;
                // 写入新的修正楼层
                this.app.diaryData.setAutoLastFloor(val);
                
                // 弹出成功提示
                const shell = window.VirtualPhone?.phoneShell || this.app.phoneShell;
                shell?.showNotification('保存成功', `自动写日记起点已修正为: ${val} 层`, '✅');
            };
        }

        const promptSave = document.getElementById('diary-s-prompt-save');
        if (promptSave) promptSave.onclick = () => {
            const textarea = document.getElementById('diary-s-prompt');
            if (!textarea) return;
            const pm = this._getPromptManager();
            if (pm?.prompts?.diary?.generate) {
                pm.prompts.diary.generate.content = textarea.value;
                pm.savePrompts();
                alert('✅ 提示词已保存');
            }
        };

        const promptReset = document.getElementById('diary-s-prompt-reset');
        if (promptReset) promptReset.onclick = () => {
            if (!confirm('确定恢复为默认提示词？')) return;
            const pm = this._getPromptManager();
            if (pm) {
                const defaults = pm.getDefaultPrompts();
                const textarea = document.getElementById('diary-s-prompt');
                if (textarea && defaults.diary?.generate?.content) {
                    textarea.value = defaults.diary.generate.content;
                }
            }
        };

        // 提示词折叠交互
    }

    _bindPromptFoldToggles(root) {
        if (!root) return;
        root.querySelectorAll('.phone-prompt-fold').forEach(fold => {
            if (fold.dataset.foldInited !== '1') {
                fold.dataset.foldInited = '1';
                fold.classList.toggle('is-open', String(fold.dataset.defaultOpen || '').toLowerCase() === 'true');
            }
        });
        root.querySelectorAll('.phone-prompt-fold-header').forEach(header => {
            if (header.dataset.foldBound === '1') return;
            header.dataset.foldBound = '1';
            header.addEventListener('click', () => {
                const fold = header.closest('.phone-prompt-fold');
                if (!fold) return;
                fold.classList.toggle('is-open');
            });
        });
    }

    // ==================== 编辑视图 ====================

    renderEdit() {
        const entry = this.app.diaryData.getEntry(this._editingEntryId);
        if (!entry) {
            this.currentView = 'toc';
            this.render();
            return;
        }

        const diaryTitle = this._extractTitle(entry.content);

        const html = `
            <div class="diary-app">
                <div class="diary-edit-view">
                    <div class="diary-page-header">
                        <button class="diary-page-back" id="diary-edit-cancel">✕ 取消</button>
                        <div class="diary-page-date">${diaryTitle}</div>
                        <button class="diary-edit-save-btn" id="diary-edit-save">保存</button>
                    </div>
                    <div class="diary-edit-body">
                        <textarea class="diary-edit-textarea" id="diary-edit-text">${entry.content || ''}</textarea>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'diary-' + this.currentView);
        this._bindEditEvents();
    }

    _bindEditEvents() {
        const cancelBtn = document.getElementById('diary-edit-cancel');
        if (cancelBtn) cancelBtn.onclick = () => {
            this.currentView = 'toc';
            this._editingEntryId = null;
            this.isBackNav = true;
            this.render();
        };

        const saveBtn = document.getElementById('diary-edit-save');
        if (saveBtn) saveBtn.onclick = () => {
            const textarea = document.getElementById('diary-edit-text');
            if (textarea && this._editingEntryId) {
                this.app.diaryData.updateEntryContent(this._editingEntryId, textarea.value);
            }
            this.currentView = 'toc';
            this._editingEntryId = null;
            this.isBackNav = true;
            this.render();
        };
    }

    // ==================== 图片处理与杂项 ====================

    async _processImage(file) {
        try {
            try {
                const { ImageCropper } = await import('../settings/image-cropper.js');
                const exportFormat = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
                const cropper = new ImageCropper({
                    title: '裁剪图片',
                    outputWidth: 600,
                    outputHeight: 1050,
                    outputFormat: exportFormat,
                    quality: exportFormat === 'image/png' ? undefined : 0.6,
                    maxFileSize: 3 * 1024 * 1024
                });
                return await cropper.open(file);
            } catch (cropErr) {
                return await this._compressImage(file);
            }
        } catch (err) {
            if (err.message !== '用户取消') {
                console.error('[DiaryView] 图片处理失败:', err);
            }
            return null;
        }
    }

    _compressImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const maxW = 600;
                    const scale = Math.min(1, maxW / img.width);
                    canvas.width = img.width * scale;
                    canvas.height = img.height * scale;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    const exportFormat = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
                    const quality = exportFormat === 'image/png' ? undefined : 0.6;
                    resolve(canvas.toDataURL(exportFormat, quality));
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    _getPromptManager() {
        const pm = window.VirtualPhone?.promptManager;
        if (pm) pm.ensureLoaded();
        return pm;
    }

    _getPromptContent() {
        const pm = this._getPromptManager();
        return pm?.prompts?.diary?.generate?.content || '';
    }

    _parseDate(dateStr) {
        if (!dateStr) return { day: '?', monthLabel: '', full: '未知日期', weekday: '' };
        const m = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
        const wm = dateStr.match(/(星期[一二三四五六日天])/);
        if (m) {
            return {
                day: m[3],
                monthLabel: `${m[2]}月`,
                full: `${m[1]}年${m[2]}月${m[3]}日`,
                weekday: wm ? wm[1] : ''
            };
        }
        return { day: '?', monthLabel: '', full: dateStr, weekday: wm ? wm[1] : '' };
    }

    _extractTitle(content) {
        if (!content) return '无标题';
        const titleMatch = content.match(/【([^】]+)】/);
        if (titleMatch && !titleMatch[1].match(/\d{4}年/)) {
            return titleMatch[1];
        }
        return '无标题';
    }

    _openEditDialog(id) {
        const entry = this.app.diaryData.getEntry(id);
        if (!entry) return;
        this._editingEntryId = id;
        this._previousView = this.currentView;
        this.currentView = 'edit';
        this.render();
    }

    _formatContent(content) {
        if (!content) return '<span style="color:#baa;">（空白页）</span>';

        let formatted = content;
        formatted = formatted.replace(/^(?:[^\S\r\n]|&nbsp;|&emsp;|&ensp;|&#160;|&#8195;|\u200B|\u3000)+/gm, '');
        formatted = formatted.replace(/^【[^】]+】\s*/, '');
        formatted = formatted.replace(/^(?:[^\S\r\n]|&nbsp;|&emsp;|&ensp;|&#160;|&#8195;|\u200B|\u3000)+/gm, '');
        formatted = formatted.replace(/^[\r\n]+/, '');

        formatted = formatted
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        return `<div class="diary-text-body" style="text-indent: 0 !important; margin: 0 !important; padding: 0 !important; clear: both; display: block; text-align: left;">${formatted}</div>`;
    }
}
