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
import { bindPhoneColorPickers } from '../../phone/color-picker.js';
import { readDiaryAppearance, DIARY_TEXT_COLOR_DEFAULT, DIARY_PAPER_COLOR_DEFAULT, DIARY_TEXT_COLOR_KEY, DIARY_PAPER_COLOR_KEY } from './diary-theme.js';
import { extractImagePromptItems } from '../../config/image-prompt-format.js';

export class DiaryView {
    constructor(app) {
        this.app = app;
        this.currentView = 'cover'; // 'cover' | 'toc' | 'page' | 'settings' | 'edit' | 'new' | 'import'
        this.currentEntryId = null;
        this.settingsPanelOpen = false;
        this.tocOrder = 'desc';
        this._cssLoaded = false;
        this._previousView = 'cover';
        this.isBackNav = false; 
        this.tocManageMode = false;
        this.tocSelectedIds = new Set();
        this._tocScrollTop = 0;
        this._tocResizeObserver = null;
        this._diaryPhotoActiveIndexByEntry = new Map();
        this._diaryManualRunToken = 0;
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
        link.href = new URL('./diary.css?v=1.0.0&r=20261108-toc-orbit-card-gap', import.meta.url).href;
        document.head.appendChild(link);
        this._cssLoaded = true;
    }

    render() {
        this.loadCSS();
        if (this.currentView !== 'toc' && this.tocManageMode) {
            this.tocManageMode = false;
            this.tocSelectedIds.clear();
        }
        // 每次渲染时清除缓存，确保获取最新数据
        this.app.diaryData._entries = null;
        let result;
        switch (this.currentView) {
            case 'cover': result = this.renderCover(); break;
            case 'toc': result = this.renderTOC(); break;
            case 'page': result = this.renderPage(); break;
            case 'settings': result = this.renderSettings(); break;
            case 'edit': result = this.renderEdit(); break;
            case 'new': result = this.renderNewEntry(); break;
            case 'import': result = this.renderImport(); break;
            default: result = this.renderCover(); break;
        }
        this.isBackNav = false; // 重置标志位
        return result;
    }

    _appearanceStyle() {
        const { textColor, paperColor } = this.app.diaryData.getAppearance?.() || readDiaryAppearance(this.app.diaryData.storage);
        return `--diary-text-primary:${textColor};--diary-paper-color:${paperColor};`;
    }

    _renderColorControl(label, kind, key, defaultColor) {
        return `<div class="diary-s-row diary-color-row">
            <span class="diary-s-label">${label}</span>
            <button type="button" class="yzp-frame-color-control" data-color-storage-key="${key}"
                data-color-default="${defaultColor}" data-color-preview-kind="${kind}"
                data-color-picker-title="选择${label}" data-color-picker-label="${label}" aria-label="选择${label}">
                <span class="yzp-frame-color-control-swatch" aria-hidden="true"></span>
                <span class="yzp-frame-color-control-value"></span>
            </button>
        </div>`;
    }

    // ==================== 封面视图 ====================

    renderCover() {
        const data = this.app.diaryData;
        const entries = data.getEntries();
        const coverBg = data.getCoverBg();
        const bgStyle = coverBg ? `background-image: url('${coverBg}'); background-size: 100% 100%; background-position: center; background-repeat: no-repeat;` : '';
        const showText = !coverBg;
        const html = `
            <div class="diary-app" style="${this._appearanceStyle()}">
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

    _syncTOCSelectionUI() {
        const liveIds = new Set();
        document.querySelectorAll('.phone-view-current .diary-toc-item').forEach(item => {
            const id = String(item.dataset.id || '');
            if (!id) return;
            liveIds.add(id);
            const isSelected = this.tocSelectedIds.has(id);
            item.classList.toggle('is-selected', isSelected);
            const input = item.querySelector('.diary-toc-select');
            if (input) input.checked = isSelected;
        });

        for (const id of Array.from(this.tocSelectedIds)) {
            if (!liveIds.has(id)) this.tocSelectedIds.delete(id);
        }

        const selectedCount = this.tocSelectedIds.size;
        const deleteBtn = document.getElementById('diary-delete-selected');
        if (!deleteBtn) return;
        deleteBtn.title = selectedCount > 0 ? `删除已选 ${selectedCount} 篇` : '删除已选';
        let countEl = deleteBtn.querySelector('.diary-delete-selected-count');
        if (selectedCount > 0) {
            if (!countEl) {
                countEl = document.createElement('span');
                countEl.className = 'diary-delete-selected-count';
                deleteBtn.appendChild(countEl);
            }
            countEl.textContent = String(selectedCount);
        } else {
            countEl?.remove();
        }
    }

    _setTOCManageMode(enabled) {
        this.tocManageMode = enabled === true;
        if (!this.tocManageMode) this.tocSelectedIds.clear();
        const toc = document.querySelector('.phone-view-current .diary-toc');
        toc?.classList?.toggle('diary-toc-managing', this.tocManageMode);
        if (!this.tocManageMode) {
            toc?.querySelectorAll?.('.diary-toc-item-actions').forEach(actions => {
                actions.style.display = 'none';
            });
        }
        this._syncTOCSelectionUI();
    }

    _layoutTOCOrbitItems(tocList) {
        if (!tocList) return;
        const items = Array.from(tocList.querySelectorAll('.diary-toc-item'));
        const spacer = tocList.querySelector('.diary-toc-scroll-space');
        // 圆环和卡片共用 360 × 420 的设计坐标，所有尺寸只缩放一次。
        const scale = Math.min(1, (tocList.clientWidth || 360) / 360,
            (tocList.clientHeight || 420) / 420);
        // 整组在标题下方的可用区域居中，圆弧与卡片共用同一偏移。
        const groupOffsetY = Math.max(0, (tocList.clientHeight - 420 * scale) / 2);
        const step = 80 * scale;
        const topOffset = groupOffsetY + 18 * scale;
        const radius = 215;
        const centerX = -112;
        const centerY = 210;
        const cardHeight = 64;
        const connector = 44;
        const orbit = tocList.parentElement?.querySelector('.diary-toc-orbit');
        if (orbit) {
            orbit.style.left = `${(centerX - radius) * scale}px`;
            orbit.style.right = 'auto';
            orbit.style.top = `${tocList.offsetTop + groupOffsetY + (centerY - radius) * scale}px`;
            orbit.style.transformOrigin = 'top left';
            orbit.style.transform = `scale(${scale})`;
        }
        const visibleSlots = 5;

        if (spacer) {
            const extraSteps = Math.max(0, items.length - visibleSlots) * step;
            spacer.style.height = `${Math.max(1, tocList.clientHeight + extraSteps)}px`;
        }

        const scrollPosition = tocList.scrollTop / step;
        items.forEach((item, index) => {
            item.style.setProperty('--diary-toc-card-scale', String(scale));
            const slot = index - scrollPosition;
            const y = 18 + slot * 80 + cardHeight / 2;
            // 卡片中心所在的水平线与圆弧相交，交点就是连接线节点。
            const dy = Math.max(-radius, Math.min(radius, y - centerY));
            const nodeX = centerX + Math.sqrt(radius * radius - dy * dy);
            const edgeOpacity = Math.min(
                1,
                Math.max(0, (slot + 0.8) / 0.8),
                Math.max(0, (4.8 - slot) / 0.8)
            );
            const isVisible = slot > -1 && slot < 5;
            item.style.top = `${topOffset + index * step}px`;
            item.style.left = `${(nodeX + connector) * scale}px`;
            item.style.right = 'auto';
            item.style.width = `${188 * scale}px`;
            item.style.setProperty('--diary-toc-connector', `${connector * scale}px`);
            item.style.opacity = String(edgeOpacity);
            item.style.visibility = isVisible ? 'visible' : 'hidden';
            item.style.pointerEvents = isVisible ? '' : 'none';
        });
    }

    renderTOC() {
        const data = this.app.diaryData;
        const entries = data.getEntries();
        const sorted = this._sortEntries(entries);
        const tocBg = data.getTocBg();
        const bgStyle = tocBg ? `background-image: url('${tocBg}'); background-size: 100% 100%; background-position: center; background-repeat: no-repeat;` : '';
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
                const parsedDiary = data.parseDiaryContent(entry.content || '');
                const parsed = this._parseDate(entry.date || parsedDiary.date);
                const preview = String(parsedDiary.body || '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 34);
                const monthLabel = parsed.month ? `${String(parsed.month).padStart(2, '0')}月` : (parsed.monthLabel || '月份');
                const weekdayLabel = String(parsed.weekday || '').replace(/^星期/, '周').replace('周天', '周日');
                const diaryTitle = parsedDiary.title || entry.title || '';
                const isHidden = entry.offlineHidden === true;
                const isSelected = this.tocSelectedIds.has(String(entry.id));
                return `
                    <div class="diary-toc-item ${isHidden ? 'diary-offline-hidden' : ''} ${isSelected ? 'is-selected' : ''}" data-id="${entry.id}" style="${isHidden ? 'opacity:0.58;' : ''}">
                        <input type="checkbox" class="diary-toc-select" data-id="${entry.id}" ${isSelected ? 'checked' : ''} style="margin-right:8px; flex-shrink:0; accent-color:#5b6cff;">
                        <div class="diary-toc-item-date">
                            <div class="diary-toc-item-month">${monthLabel}</div>
                            <div class="diary-toc-item-day">${parsed.day}</div>
                            <div class="diary-toc-item-date-foot">${parsed.year || '----'} · ${weekdayLabel || '日期'}</div>
                        </div>
                        <div class="diary-toc-item-info">
                            <div class="diary-toc-item-title">${diaryTitle || '无标题'}${isHidden ? '（已隐藏）' : ''}</div>
                            <div class="diary-toc-item-preview">${preview || '...'}</div>
                        </div>
                        <i class="fa-solid fa-chevron-right diary-toc-item-chevron" aria-hidden="true"></i>
                        <div class="diary-toc-item-actions" style="display:none;">
                            <button class="diary-toc-item-edit" data-id="${entry.id}">✏️</button>
                            <button class="diary-toc-item-delete" data-id="${entry.id}">🗑️</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        const selectedCount = sorted.filter(entry => this.tocSelectedIds.has(String(entry.id))).length;
        const deleteSelectedBtn = sorted.length > 0 ? `<button class="diary-toc-btn diary-delete-all-btn diary-toc-manage-control" id="diary-delete-selected" title="${selectedCount > 0 ? `删除已选 ${selectedCount} 篇` : '删除已选'}">🗑️${selectedCount > 0 ? `<span class="diary-delete-selected-count">${selectedCount}</span>` : ''}</button>` : '';
        const manageBtns = sorted.length > 0 ? `
            <button class="diary-toc-btn diary-toc-manage-control" id="diary-toc-select-all" title="全选">全选</button>
            <button class="diary-toc-btn diary-toc-manage-control" id="diary-toc-hide-selected" title="隐藏所选">隐藏</button>
            <button class="diary-toc-btn diary-toc-manage-control" id="diary-toc-show-selected" title="取消隐藏所选">显示</button>
            <button class="diary-toc-btn diary-toc-manage-control" id="diary-toc-manage-done" title="完成">完成</button>
        ` : '';
        const entryTools = `
            <button class="diary-toc-btn diary-add-btn diary-pencil-btn diary-toc-entry-control" id="diary-add-entry" title="新增日记">
                <i class="fa-solid fa-pen" aria-hidden="true"></i>
            </button>
        `;

        const html = `
            <div class="diary-app" style="${this._appearanceStyle()}">
                <div class="diary-toc ${this.tocManageMode ? 'diary-toc-managing' : ''} ${enterClass}" style="${bgStyle}">
                    <div class="diary-toc-header">
                        <div class="diary-toc-actions">
                            ${deleteSelectedBtn}
                            ${manageBtns}
                            ${entryTools}
                            <button class="diary-toc-btn diary-pencil-btn" id="diary-manual-write" title="设置">
                                <i class="fa-solid fa-gear" aria-hidden="true"></i>
                            </button>
                        </div>
                        <div class="diary-toc-heading">
                            <div class="diary-toc-heading-cn">目录</div>
                            <div class="diary-toc-heading-en">Table of Contents</div>
                            <div class="diary-toc-heading-rule"><span></span></div>
                        </div>
                    </div>
                    <div class="diary-toc-orbit" aria-hidden="true">
                        <span class="diary-toc-orbit-ring diary-toc-orbit-ring-outer"></span>
                        <span class="diary-toc-orbit-ring diary-toc-orbit-ring-middle"></span>
                        <span class="diary-toc-orbit-ring diary-toc-orbit-ring-inner"></span>
                        <span class="diary-toc-orbit-ticks diary-toc-orbit-ticks-minor"></span>
                        <span class="diary-toc-orbit-ticks diary-toc-orbit-ticks-major"></span>
                        <span class="diary-toc-moon diary-toc-moon-1"></span>
                        <span class="diary-toc-moon diary-toc-moon-2"></span>
                        <span class="diary-toc-moon diary-toc-moon-3"></span>
                        <span class="diary-toc-moon diary-toc-moon-4"></span>
                        <span class="diary-toc-moon diary-toc-moon-5"></span>
                    </div>
                    <div class="diary-toc-list">
                        ${listHtml}
                        <div class="diary-toc-scroll-space" aria-hidden="true"></div>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'diary-' + this.currentView);
        this._bindTOCEvents();
    }

    _bindTOCEvents() {
        const syncTocSelectionUI = () => this._syncTOCSelectionUI();

        const addBtn = document.getElementById('diary-add-entry');
        if (addBtn) addBtn.onclick = () => {
            this._previousView = this.currentView;
            this.currentView = 'new';
            this.render();
        };

        const writeBtn = document.getElementById('diary-manual-write');
        if (writeBtn) writeBtn.onclick = () => {
            this._previousView = this.currentView;
            this.currentView = 'settings';
            this.render();
        };

        let longPressTimer = null;
        let pressStart = null;
        let suppressPressClick = false;
        let lastTouchTime = 0;
        const clearPressTimer = () => {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        };
        const cancelPressForScroll = () => {
            clearPressTimer();
            pressStart = null;
            suppressPressClick = true;
        };
        const tocList = document.querySelector('.phone-view-current .diary-toc-list');
        if (tocList) {
            const syncOrbitLayout = () => {
                this._tocScrollTop = tocList.scrollTop;
                cancelPressForScroll();
                this._layoutTOCOrbitItems(tocList);
            };
            tocList.onscroll = syncOrbitLayout;
            this._layoutTOCOrbitItems(tocList);
            tocList.scrollTop = this._tocScrollTop;
            this._layoutTOCOrbitItems(tocList);
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => this._layoutTOCOrbitItems(tocList));
            }
            this._tocResizeObserver?.disconnect?.();
            if (typeof ResizeObserver === 'function') {
                this._tocResizeObserver = new ResizeObserver(() => this._layoutTOCOrbitItems(tocList));
                this._tocResizeObserver.observe(tocList);
            }
        }
        const tocRoot = document.querySelector('.phone-view-current .diary-toc');
        if (tocRoot) tocRoot.onclick = event => {
            if (!this.tocManageMode) return;
            if (event.target.closest('.diary-toc-header, .diary-toc-item')) return;
            this._setTOCManageMode(false);
        };
        const deleteSelectedBtn = document.getElementById('diary-delete-selected');
        if (deleteSelectedBtn) deleteSelectedBtn.onclick = () => {
            const entries = this._sortEntries(this.app.diaryData.getEntries());
            const liveIds = new Set(entries.map(entry => String(entry.id)));
            const ids = Array.from(this.tocSelectedIds).map(id => String(id || '')).filter(id => liveIds.has(id));
            if (ids.length === 0) {
                alert('请先勾选要删除的日记');
                return;
            }

            const isDeletingAll = entries.length > 0 && ids.length === entries.length;
            const confirmText = isDeletingAll
                ? `确定删除全部 ${entries.length} 篇日记吗？此操作不可恢复！`
                : `确定删除已勾选的 ${ids.length} 篇日记吗？此操作不可恢复！`;

            if (confirm(confirmText)) {
                if (isDeletingAll) {
                    this.app.diaryData.clearAllEntries();
                } else {
                    this.app.diaryData.deleteEntries(ids);
                }
                if (ids.includes(String(this.currentEntryId || ''))) {
                    this.currentEntryId = null;
                }
                this.tocSelectedIds.clear();
                this.tocManageMode = false;
                this.render();
            }
        };

        const deleteAllBtn = deleteSelectedBtn;

        const enterManageMode = () => {
            this._setTOCManageMode(true);
        };
        const enterManageModeForItem = (entryId) => {
            const safeId = String(entryId || '');
            if (!safeId) return;
            this.tocSelectedIds.add(safeId);
            enterManageMode();
            const liveItem = Array.from(document.querySelectorAll('.phone-view-current .diary-toc-item'))
                .find(element => String(element.dataset.id || '') === safeId);
            const liveActions = liveItem?.querySelector('.diary-toc-item-actions');
            if (liveActions) liveActions.style.display = 'flex';
        };
        const selectedIds = () => Array.from(this.tocSelectedIds);
        const ensureSelection = () => {
            if (this.tocSelectedIds.size > 0) return true;
            alert('请先勾选日记');
            return false;
        };
        document.getElementById('diary-toc-select-all')?.addEventListener('click', () => {
            const entries = this.app.diaryData.getEntries();
            const sortedEntries = this._sortEntries(entries);
            const allSelected = sortedEntries.length > 0 && sortedEntries.every(entry => this.tocSelectedIds.has(String(entry.id)));
            if (allSelected) {
                this.tocSelectedIds.clear();
            } else {
                sortedEntries.forEach(entry => this.tocSelectedIds.add(String(entry.id)));
            }
            syncTocSelectionUI();
        });
        document.getElementById('diary-toc-hide-selected')?.addEventListener('click', () => {
            if (!ensureSelection()) return;
            this.app.diaryData.setEntriesOfflineHidden(selectedIds(), true);
            this.tocSelectedIds.clear();
            this.render();
        });
        document.getElementById('diary-toc-show-selected')?.addEventListener('click', () => {
            if (!ensureSelection()) return;
            this.app.diaryData.setEntriesOfflineHidden(selectedIds(), false);
            this.tocSelectedIds.clear();
            this.render();
        });
        document.getElementById('diary-toc-manage-done')?.addEventListener('click', () => {
            this._setTOCManageMode(false);
        });
        document.querySelectorAll('.diary-toc-item').forEach(item => {
            // 🔥 防止重复绑定定时器事件
            if (item.dataset.bound) return;
            item.dataset.bound = 'true';

            const actionsDiv = item.querySelector('.diary-toc-item-actions');
            const editBtn = item.querySelector('.diary-toc-item-edit');
            const deleteBtn = item.querySelector('.diary-toc-item-delete');
            const selectInput = item.querySelector('.diary-toc-select');

            if (selectInput) {
                selectInput.onclick = (e) => {
                    e.stopPropagation();
                };
                selectInput.onchange = (e) => {
                    e.stopPropagation();
                    const id = String(selectInput.dataset.id || '');
                    if (!id) return;
                    if (selectInput.checked) this.tocSelectedIds.add(id);
                    else this.tocSelectedIds.delete(id);
                    syncTocSelectionUI();
                };
            }

            item.addEventListener('pointerdown', (e) => {
                clearPressTimer();
                if (e.pointerType === 'touch') lastTouchTime = Date.now();
                if (!e.isPrimary || e.button !== 0) {
                    cancelPressForScroll();
                    return;
                }
                suppressPressClick = false;
                if (e.target.closest('.diary-toc-item-actions') || e.target.closest('.diary-toc-select')) return;
                pressStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
                longPressTimer = setTimeout(() => {
                    clearPressTimer();
                    if (!pressStart || !item.isConnected) return;
                    suppressPressClick = true;
                    pressStart = null;
                    enterManageModeForItem(item.dataset.id);
                }, e.pointerType === 'touch' ? 650 : 1000);
            });

            item.addEventListener('pointermove', (e) => {
                if (!pressStart || e.pointerId !== pressStart.id) return;
                if (Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 8) {
                    cancelPressForScroll();
                }
            }, { passive: true });
            const endPress = () => {
                clearPressTimer();
                pressStart = null;
            };
            item.addEventListener('pointerup', endPress);
            item.addEventListener('pointerleave', endPress);
            item.addEventListener('pointercancel', cancelPressForScroll);

            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                // 触屏只使用上面的计时器，避免系统长按菜单绕过滑动取消。
                if (e.pointerType === 'touch' || Date.now() - lastTouchTime < 1500) return;
                clearPressTimer();
                enterManageModeForItem(item.dataset.id);
            });

            // 🔥 核心：点击事件改为 onclick
            item.onclick = (e) => {
                if (suppressPressClick) {
                    suppressPressClick = false;
                    e.preventDefault();
                    return;
                }
                if (e.target.closest('.diary-toc-item-actions') || e.target.closest('.diary-toc-select')) return;
                if (this.tocManageMode) {
                    const id = String(item.dataset.id || '');
                    if (!id) return;
                    if (this.tocSelectedIds.has(id)) this.tocSelectedIds.delete(id);
                    else this.tocSelectedIds.add(id);
                    syncTocSelectionUI();
                    return;
                }
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
        const enterClass = this.isBackNav ? '' : 'diary-view-enter';

        const parsedDiary = data.parseDiaryContent(entry.content);
        const diaryTitle = parsedDiary.title || '无标题';
        const diaryPhotos = data.normalizeEntryPhotos(entry);
        if (diaryPhotos.length) data.saveEntries();

        const html = `
            <div class="diary-app diary-app-reading" style="${this._appearanceStyle()}">
                <div class="diary-page ${enterClass}">
                    <div class="diary-page-status-safe" aria-hidden="true"></div>
                    <div class="diary-page-body" id="diary-page-body">
                        ${this._renderBujoDiaryPage(entry, parsedDiary, { fontSize, lineHeight })}
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

        const contentEditBtn = document.getElementById('diary-page-content-edit');
        if (contentEditBtn) contentEditBtn.onclick = () => this._openEditDialog(this.currentEntryId);

        const settingsBtn = document.getElementById('diary-page-settings');
        if (settingsBtn) settingsBtn.onclick = () => {
            this._previousView = this.currentView;
            this.currentView = 'settings';
            this.render();
        };

        const exportBtn = document.getElementById('diary-page-export');
        if (exportBtn) exportBtn.onclick = () => this._exportDiaryLongImage(exportBtn);

        this._bindDiaryPhotoEvents();
    }

    async _exportDiaryLongImage(button) {
        if (this._isExportingDiary) return;
        const page = button?.closest('.diary-page');
        if (!page) return;
        const shell = this.app.phoneShell;
        const entry = this.app.diaryData.getEntry(this.currentEntryId);
        const title = this.app.diaryData.parseDiaryContent(entry?.content || '').title || '日记';
        this._isExportingDiary = true;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        let imageUrl = '';
        try {
            shell.showNotification?.('日记长图', '正在生成整篇日记，请稍候…', '♡');
            const { captureDiarySnapshot } = await import('./diary-snapshot.js?r=20261107-diary-colors-2');
            const { blob } = await captureDiarySnapshot(page);
            imageUrl = URL.createObjectURL(blob);
            const filename = `日记-${title}-${Date.now()}.png`;
            shell.showImageViewer(imageUrl, { alt: `${title} · 日记长图`, downloadName: filename });
            const overlay = shell.container?.querySelector('.phone-image-viewer-overlay');
            if (!overlay) throw new Error('无法打开长图预览');
            // 预览关闭后释放临时图片；不把生成的图片存入聊天或设置。
            const previewUrl = imageUrl;
            const observer = new MutationObserver(() => {
                if (overlay.isConnected) return;
                observer.disconnect();
                URL.revokeObjectURL(previewUrl);
            });
            observer.observe(overlay.parentNode, { childList: true });
            imageUrl = '';
            shell.showNotification?.('日记长图', '长图已生成，点击预览右上角下载保存', '♡');
        } catch (error) {
            if (imageUrl) URL.revokeObjectURL(imageUrl);
            shell.showNotification?.('日记长图', String(error?.message || '生成失败，请重试'), '❌');
        } finally {
            this._isExportingDiary = false;
            button.disabled = false;
            button.removeAttribute('aria-busy');
        }
    }

    _bindDiaryPhotoEvents() {
        document.querySelectorAll('.diary-photo-card').forEach(card => {
            const photoId = String(card.getAttribute('data-photo-id') || '').trim();
            if (!photoId) return;
            const runAction = () => {
                const cardIndex = Number.parseInt(card.getAttribute('data-photo-index') || '0', 10) || 0;
                const groupKey = String(card.closest('.diary-photo-memory')?.getAttribute('data-photo-group') || 'main');
                const activeIndex = Number.parseInt(card.closest('.diary-photo-memory')?.getAttribute('data-active-index') || '0', 10) || 0;
                if (cardIndex !== activeIndex) {
                    this._setDiaryPhotoActiveIndex(cardIndex, groupKey);
                    this._activateDiaryPhotoCard(card.closest('.diary-photo-memory'), cardIndex);
                    return;
                }
                if (card.classList.contains('is-flipped')) {
                    card.classList.remove('is-flipped');
                    return;
                }
                const livePhoto = this.app.diaryData.getEntry(this.currentEntryId)?.photos?.find(item => String(item?.id || '') === photoId);
                const status = String(livePhoto?.status || '').trim();
                const imageUrl = String(livePhoto?.imageUrl || '').trim();
                if (status === 'loading') return;
                if (status === 'done' && imageUrl) {
                    const alt = String(livePhoto?.reason || livePhoto?.prompt || '日记照片').trim();
                    this.app?.phoneShell?.showImageViewer?.(imageUrl, { alt });
                }
            };
            card.onclick = runAction;
            card.onkeydown = (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                runAction();
            };
        });

        document.querySelectorAll('.diary-photo-regenerate').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const photoId = String(btn.getAttribute('data-photo-id') || '').trim();
                if (photoId) this._generateDiaryPhoto(photoId, {
                    force: true,
                    groupRoot: btn.closest('.diary-photo-memory')
                });
            };
        });

        document.querySelectorAll('.diary-photo-flip').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const card = btn.closest('.diary-photo-card');
                if (card) card.classList.toggle('is-flipped');
            };
        });
    }

    _setDiaryPhotoActiveIndex(index = 0, groupKey = 'main') {
        const entryId = String(this.currentEntryId || '').trim();
        if (!entryId) return;
        this._diaryPhotoActiveIndexByEntry.set(`${entryId}:${String(groupKey || 'main')}`, Math.max(0, Number.parseInt(index, 10) || 0));
    }

    _getDiaryPhotoActiveIndex(photoCount = 0, groupKey = 'main') {
        const entryId = String(this.currentEntryId || '').trim();
        const stored = entryId ? this._diaryPhotoActiveIndexByEntry.get(`${entryId}:${String(groupKey || 'main')}`) : 0;
        const index = Math.max(0, Number.parseInt(stored, 10) || 0);
        return Math.min(index, Math.max(0, photoCount - 1));
    }

    _activateDiaryPhotoCard(root, activeIndex = 0) {
        if (!root) return;
        const cards = Array.from(root.querySelectorAll('.diary-photo-card'));
        const count = cards.length;
        if (count <= 1) return;
        const normalizedActiveIndex = Math.min(Math.max(0, Number.parseInt(activeIndex, 10) || 0), count - 1);
        root.setAttribute('data-active-index', String(normalizedActiveIndex));
        cards.forEach((card, index) => {
            const stackOffset = (index - normalizedActiveIndex + count) % count;
            const rotate = stackOffset === 0 ? '-1.5deg' : (stackOffset === 1 ? '4deg' : '-5deg');
            card.classList.remove('diary-photo-stack-0', 'diary-photo-stack-1', 'diary-photo-stack-2');
            card.classList.add(`diary-photo-stack-${stackOffset}`);
            card.style.setProperty('--diary-photo-rotate', rotate);
            card.style.setProperty('--diary-photo-stack-offset', String(stackOffset));
        });
    }

    _renderDiaryPhotoMemory(entry) {
        const photos = Array.isArray(entry?.photos) ? entry.photos.slice(0, 3) : [];
        if (photos.length === 0) return '';
        return this._renderDiaryPhotoStack(entry, photos, null, 'main');
    }

    _renderDiaryPhotoStack(entry, photos = [], activeIndexOverride = null, groupKey = 'main') {
        const safePhotos = Array.isArray(photos) ? photos.slice(0, 3) : [];
        if (safePhotos.length === 0) return '';
        const activeIndex = this._getDiaryPhotoActiveIndex(safePhotos.length, groupKey);
        const normalizedActiveIndex = activeIndexOverride === null
            ? activeIndex
            : Math.min(Math.max(0, Number.parseInt(activeIndexOverride, 10) || 0), safePhotos.length - 1);
        const cards = safePhotos.map((photo, index) => {
            const status = String(photo?.status || 'idle');
            const imageUrl = String(photo?.imageUrl || '').trim();
            const prompt = this._escapeHtml(String(photo?.prompt || ''));
            const reason = this._escapeHtml(String(photo?.reason || ''));
            const rawType = String(photo?.type || '图片');
            const stackOffset = (index - normalizedActiveIndex + safePhotos.length) % safePhotos.length;
            const rotate = stackOffset === 0 ? '-1.5deg' : (stackOffset === 1 ? '4deg' : '-5deg');
            const displayUrl = imageUrl && status === 'done'
                ? imageUrl
                : this._getDiaryFallbackPhotoUrl(entry, photo, index);
            const imageHtml = status === 'loading' || status === 'failed'
                ? '<div class="diary-photo-placeholder diary-photo-developing" aria-hidden="true"></div>'
                : `<img class="diary-photo-img" src="${this._escapeAttr(displayUrl)}" alt="${prompt || reason || '日记照片'}" loading="eager" decoding="async" draggable="false">`;
            const statusHtml = status === 'failed'
                ? `<div class="diary-photo-status diary-photo-status-error">生成失败，点↻重试</div>`
                : (status === 'loading'
                    ? `<div class="diary-photo-status">显影中...</div>`
                    : '');
            const actionHtml = `
                <button class="diary-photo-tool diary-photo-regenerate" type="button" data-photo-id="${this._escapeAttr(photo.id)}" title="重新生成">↻</button>
                <button class="diary-photo-tool diary-photo-flip" type="button" title="查看照片说明">↪</button>
            `;
            const tagText = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(String(photo?.prompt || '')) ? '缺少英文Tag' : (prompt || '未提供英文Tag');
            const backText = `
                <div style="font-weight:700; margin-bottom:6px;">中文说明</div>
                <div>${reason || '这张照片还没有留下说明。'}</div>
                <div style="font-weight:700; margin:10px 0 6px;">英文Tag</div>
                <div>${tagText}</div>
            `;
            const frontCaption = rawType === '个人图片' ? '「 私人影像 」' : '「 沉溺于那片海 」';
            return `
                <div class="diary-photo-card diary-photo-card-${index + 1} diary-photo-stack-${stackOffset}" role="button" tabindex="0" data-photo-id="${this._escapeAttr(photo.id)}" data-photo-index="${index}" style="--diary-photo-rotate:${rotate}; --diary-photo-stack-offset:${stackOffset};">
                    <div class="diary-photo-tape" aria-hidden="true"></div>
                    <div class="diary-photo-face diary-photo-front">
                        ${imageHtml}
                        ${statusHtml}
                        <div class="diary-photo-actions">${actionHtml}</div>
                    </div>
                    <div class="diary-photo-face diary-photo-back">
                        <div class="diary-photo-back-text">${backText}</div>
                    </div>
                    <div class="diary-photo-caption">${frontCaption}</div>
                </div>
            `;
        }).join('');
        return `<div class="diary-photo-memory" data-photo-count="${safePhotos.length}" data-active-index="${normalizedActiveIndex}" data-photo-group="${this._escapeAttr(groupKey)}">${cards}</div>`;
    }

    async _generateDiaryPhoto(photoId, options = {}) {
        const entryId = String(this.currentEntryId || '').trim();
        const safePhotoId = String(photoId || '').trim();
        if (!entryId || !safePhotoId) return;
        let groupRoot = options.groupRoot || null;
        const photo = this.app.diaryData.updateEntryPhoto(entryId, safePhotoId, {
            status: 'loading',
            error: ''
        });
        groupRoot = this._refreshDiaryPhotoGroup(groupRoot) || groupRoot;
        try {
            await this.app.diaryData.generateEntryPhoto(entryId, safePhotoId, options);
        } catch (err) {
            this.app.phoneShell?.showNotification?.('日记照片', String(err?.message || err || '生成失败'), '❌');
        } finally {
            this._refreshDiaryPhotoGroup(groupRoot);
        }
        return photo;
    }

    _getDiaryFallbackPhotoUrl(entry, photo, index = 0) {
        const seedSource = [
            entry?.id,
            photo?.id,
            photo?.reason,
            photo?.prompt,
            index
        ].map(value => String(value || '').trim()).join('|');
        let hash = 0;
        for (let i = 0; i < seedSource.length; i++) {
            hash = ((hash << 5) - hash) + seedSource.charCodeAt(i);
            hash |= 0;
        }
        const seed = Math.abs(hash).toString(36) || 'diary';
        return `https://picsum.photos/seed/diary-${seed}/480/480`;
    }

    _renderBujoDiaryPage(entry, parsedDiary = {}, options = {}) {
        const parsedDate = this._parseDate(parsedDiary.date);
        const month = parsedDate.month ? String(parsedDate.month).padStart(2, '0') : '--';
        const day = parsedDate.day && parsedDate.day !== '?' ? String(parsedDate.day).padStart(2, '0') : '--';
        const weatherLine = [parsedDate.weekday || '', parsedDiary.weather || ''].filter(Boolean).join(' | ');
        const bodyParts = this._formatContentParts(parsedDiary.rawBody || parsedDiary.body || entry?.content || '');
        const photos = Array.isArray(entry?.photos) ? entry.photos.slice(0, 3) : [];
        let inlinePhotoIndex = 0;
        const hasInlinePhoto = bodyParts.some(part => part === '__DIARY_PHOTO__');
        const insertAt = Math.min(2, bodyParts.length);
        const contentHtml = hasInlinePhoto
            ? bodyParts.reduce((htmlParts, part, index) => {
                if (part !== '__DIARY_PHOTO__') {
                    htmlParts.push(part);
                    return htmlParts;
                }
                if (bodyParts[index - 1] === '__DIARY_PHOTO__') return htmlParts;
                const inlinePhotos = [];
                while (bodyParts[index + inlinePhotos.length] === '__DIARY_PHOTO__') {
                    const photo = photos[inlinePhotoIndex++];
                    if (photo) inlinePhotos.push(photo);
                }
                if (inlinePhotos.length > 0) htmlParts.push(this._renderDiaryPhotoStack(entry, inlinePhotos, null, `inline-${index}`));
                return htmlParts;
            }, []).filter(Boolean).join('')
            : [
                ...bodyParts.slice(0, insertAt),
                this._renderDiaryPhotoStack(entry, photos, null, 'main'),
                ...bodyParts.slice(insertAt)
            ].filter(Boolean).join('');
        const signature = String(parsedDiary.author || entry?.author || '').trim();

        return `
            <div class="diary-bujo-wrapper">
                <div class="diary-bujo-page-actions">
                    <button class="diary-page-back diary-bujo-nav-btn diary-bujo-back-btn" id="diary-page-back">Back</button>
                    <div class="diary-bujo-page-tools">
                        <button class="diary-bujo-nav-btn diary-bujo-content-edit-btn" id="diary-page-content-edit" title="编辑日记正文" aria-label="编辑日记正文">
                            <i class="fa-solid fa-pen" aria-hidden="true"></i>
                        </button>
                        <button class="diary-page-settings-btn diary-bujo-nav-btn diary-bujo-edit-btn" id="diary-page-settings">Edit</button>
                    </div>
                </div>
                <div class="diary-bujo-header">
                    <div class="diary-bujo-calendar">
                        <div class="diary-bujo-rings">-0-0-</div>
                        <div class="diary-bujo-datebox">${month}/${day}</div>
                        <div class="diary-bujo-weather">${this._escapeHtml(weatherLine || '今日')}</div>
                    </div>
                    <div class="diary-bujo-title-area">
                        <div class="diary-bujo-title-small">Notes:</div>
                        <div class="diary-bujo-title-main">${this._escapeHtml(parsedDiary.title || '无标题')}</div>
                    </div>
                    <div class="diary-bujo-sticker" aria-hidden="true">
                        <svg viewBox="0 0 64 64" role="img" focusable="false">
                            <path d="M17 28 14 13l13 9 5-1 5 1 13-9-3 15" />
                            <path d="M13 35c0-13 9-21 19-21s19 8 19 21c0 11-8 18-19 18s-19-7-19-18Z" />
                            <path d="M24 34h.1M40 34h.1" />
                            <path d="M31 39h2l-1 2-1-2Z" />
                            <path d="M25 43c3 3 11 3 14 0" />
                            <path d="M18 39H7M18 43H8M46 39h11M46 43h10" />
                        </svg>
                    </div>
                </div>

                <div class="diary-bujo-divider">diary content</div>

                <div class="diary-page-content diary-bujo-content" id="diary-page-content" style="font-size: ${options.fontSize}px; line-height: ${options.lineHeight};">
                    ${contentHtml || '<span class="diary-empty-page">（空白页）</span>'}
                </div>

                <div class="diary-bujo-footer">
                    <button class="diary-bujo-nav-btn diary-bujo-export-btn" id="diary-page-export" type="button" title="保存日记长图" aria-label="保存日记长图" data-diary-export-ignore>
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11Z"/></svg>
                    </button>
                    ${signature ? `<div class="diary-bujo-signature"><span>${this._escapeHtml(signature)}</span></div>` : ''}
                </div>
            </div>
        `;
    }

    _refreshDiaryPhotoMemory() {
        if (!this.currentEntryId) return;
        this.render();
    }

    _refreshDiaryPhotoGroup(root) {
        if (!root || !root.isConnected) return null;
        const entry = this.app.diaryData.getEntry(this.currentEntryId);
        if (!entry) return null;
        const groupKey = String(root.getAttribute('data-photo-group') || 'main');
        const activeIndex = Number.parseInt(root.getAttribute('data-active-index') || '0', 10) || 0;
        const ids = Array.from(root.querySelectorAll('.diary-photo-card'))
            .map(card => String(card.getAttribute('data-photo-id') || '').trim())
            .filter(Boolean);
        const photos = (Array.isArray(entry.photos) ? entry.photos : [])
            .filter(photo => ids.includes(String(photo?.id || '')))
            .sort((a, b) => ids.indexOf(String(a?.id || '')) - ids.indexOf(String(b?.id || '')));
        if (photos.length === 0) return null;

        const wrapper = document.createElement('div');
        wrapper.innerHTML = this._renderDiaryPhotoStack(entry, photos, activeIndex, groupKey);
        const next = wrapper.firstElementChild;
        if (!next) return null;
        root.replaceWith(next);
        this._bindDiaryPhotoEvents();
        return next;
    }

    // ==================== 设置视图 ====================

    renderSettings() {
        const pm = this._getPromptManager();
        const autoSettings = this.app.diaryData.getAutoSettings();
        const autoEnabled = autoSettings.autoEnabled || false;
        const autoFloor = autoSettings.autoFloor || 50;
        const manualBatchSize = autoSettings.manualBatchSize || 50;
        const batchMode = autoSettings.batchMode !== false;
        
        const context = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
        const totalFloor = context?.chat?.length || 0;
        const lastIndex = this.app.diaryData.getLastDiaryFloorIndex();
        const displayLastIndex = lastIndex >= 0 ? lastIndex : 0;
        const defaultStart = lastIndex >= 0 ? lastIndex + 1 : 0;
        const enterClass = this.isBackNav ? '' : 'diary-view-enter';

        const globalLineHeight = this.app.diaryData.getGlobalLineHeight();
        const globalFontSize = this.app.diaryData.getGlobalFontSize();
        const autoLastFloor = this.app.diaryData.getAutoLastFloor() || 0;
        const useDiaryWorldbook = window.VirtualPhone?.worldbookManager?.getEnabled?.('diary') ?? true;

        const html = `
            <div class="diary-app" style="${this._appearanceStyle()}">
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
                                <input type="range" id="diary-fs-slider" min="12" max="24" step="1" value="${globalFontSize}" class="diary-s-slider phone-theme-range">
                            </div>
                            <div class="diary-s-row">
                                <span class="diary-s-label">行间距: <span id="diary-lh-value">${globalLineHeight}</span></span>
                                <input type="range" id="diary-lh-slider" min="1.2" max="3" step="0.1" value="${globalLineHeight}" class="diary-s-slider phone-theme-range">
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

                        <div class="diary-s-section">
                            <div class="diary-s-section-title">日记配色</div>
                            <div class="diary-s-desc">独立设置日记文字与纸张颜色，封面、目录及装饰线条同步文字颜色。</div>
                            ${this._renderColorControl('日记文字颜色', 'text', DIARY_TEXT_COLOR_KEY, DIARY_TEXT_COLOR_DEFAULT)}
                            ${this._renderColorControl('正文背景颜色', 'paper', DIARY_PAPER_COLOR_KEY, DIARY_PAPER_COLOR_DEFAULT)}
                            <button type="button" class="diary-s-btn" id="diary-colors-reset">恢复默认配色</button>
                        </div>

                        <div class="diary-s-section">
                            <div class="diary-s-section-title">封面与目录背景</div>
                            <div class="diary-s-desc">封面与目录背景原图上传，不压缩画质；随页面宽高铺满，比例不同时会有拉伸。日记正文背景由上方颜色控制。</div>
                            <div class="diary-s-btn-row diary-background-upload-row">
                                <label class="diary-s-btn diary-s-btn-primary" for="diary-bg-cover">📔 封面</label>
                                <input type="file" id="diary-bg-cover" accept="image/png, image/jpeg, image/gif, image/webp, image/*" hidden>
                                <label class="diary-s-btn diary-s-btn-primary" for="diary-bg-toc">📋 目录</label>
                                <input type="file" id="diary-bg-toc" accept="image/png, image/jpeg, image/gif, image/webp, image/*" hidden>
                            </div>
                            <button type="button" class="diary-s-btn diary-s-btn-warn diary-background-reset" id="diary-bg-reset-default">
                                恢复默认封面与目录背景
                            </button>
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
                                <input type="number" id="diary-batch-size" min="10" max="200" value="${manualBatchSize}" class="diary-s-input" style="width: 70px;">
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

                        <!-- 生成上下文 -->
                        <div class="diary-s-section">
                            <div class="diary-s-section-title">生成上下文</div>
                            <div class="diary-s-row">
                                <div style="min-width: 0;">
                                    <span class="diary-s-label">使用酒馆世界书</span>
                                    <div class="diary-s-desc" style="margin-top: 4px; margin-bottom: 0;">开启后，手动和自动写日记会注入下方勾选的酒馆世界书；开关与勾选状态跟随当前角色卡。</div>
                                </div>
                                <label class="toggle-switch" style="flex: 0 0 auto;">
                                    <input type="checkbox" id="diary-use-worldbook" ${useDiaryWorldbook ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                            <div class="phone-prompt-fold diary-worldbook-fold" data-default-open="false" style="margin-top: 10px;">
                                <div class="phone-prompt-fold-header">
                                    <div class="phone-prompt-fold-main">
                                        <div class="phone-prompt-fold-title">世界书选择</div>
                                        <div class="phone-prompt-fold-desc">展开后勾选要注入日记生成的酒馆世界书</div>
                                    </div>
                                    <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow"></i>
                                </div>
                                <div class="phone-prompt-fold-content">
                                    <div id="diary-worldbook-list" class="diary-worldbook-list">
                                        <div class="diary-s-desc" style="padding-top: 8px;">正在读取当前可用世界书...</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- 提示词编辑 -->
                        <div class="diary-s-section">
                            <div class="diary-s-section-title">日记提示词</div>
                            <div class="phone-prompt-fold" data-default-open="false">
                                <div class="phone-prompt-fold-header">
                                    <div class="phone-prompt-fold-main">
                                        <div class="phone-prompt-fold-title">📔 日记提示词</div>
                                        <div class="phone-prompt-fold-desc">默认折叠，展开后可编辑完整提示词。</div>
                                    </div>
                                    <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow"></i>
                                </div>
                                <div class="phone-prompt-fold-content">
                                    <div class="diary-s-desc">自定义AI写日记时使用的提示词</div>
                                    ${this._getPromptManager()?.renderPromptPresetControls?.('diary', 'generate') || ''}
                                    <textarea id="diary-s-prompt" class="diary-s-textarea">${this._getPromptContent().replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
                                    <div class="diary-s-btn-row">
                                        <button class="diary-s-btn diary-s-btn-warn" id="diary-s-prompt-reset">恢复默认</button>
                                        <button class="diary-s-btn diary-s-btn-primary" id="diary-s-prompt-save">保存提示词</button>
                                    </div>
                                </div>
                            </div>
                            <button type="button" class="diary-s-btn diary-s-btn-primary diary-import-entry-btn" id="diary-open-import">
                                <i class="fa-solid fa-file-import" aria-hidden="true"></i>
                                批量导入日记
                            </button>
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
        this._syncDiaryGenerationStatusUI();
        this.renderDiaryWorldbookList();

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

        const settingsRoot = document.getElementById('diary-settings-back')?.closest('.diary-app');
        const data = this.app.diaryData;
        const previewColor = (color, kind) => {
            settingsRoot?.style.setProperty(kind === 'text' ? '--diary-text-primary' : '--diary-paper-color', color);
        };
        bindPhoneColorPickers(settingsRoot, {
            storage: data.storage,
            previewColor,
            onError: label => this.app.phoneShell.showNotification?.('保存失败', `${label}未保存`, '⚠️')
        });
        document.getElementById('diary-colors-reset')?.addEventListener('click', async () => {
            await data.storage.set(DIARY_TEXT_COLOR_KEY, DIARY_TEXT_COLOR_DEFAULT);
            await data.storage.set(DIARY_PAPER_COLOR_KEY, DIARY_PAPER_COLOR_DEFAULT);
            for (const trigger of settingsRoot.querySelectorAll('[data-color-storage-key]')) {
                const color = trigger.dataset.colorDefault;
                trigger.dataset.color = color;
                trigger.querySelector('.yzp-frame-color-control-swatch')?.style.setProperty('--yzp-frame-control-color', color);
                trigger.querySelector('.yzp-frame-color-control-value').textContent = color;
                previewColor(color, trigger.dataset.colorPreviewKind);
            }
        });

        const bindBackgroundUpload = (inputId, setter, successMessage) => {
            const input = document.getElementById(inputId);
            if (!input) return;
            input.onchange = async event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                try {
                    await setter(file);
                    this.app.phoneShell.showNotification?.('上传成功', successMessage, '✅');
                } catch (error) {
                    this.app.phoneShell.showNotification?.('上传失败', error?.message || '请重试', '⚠️');
                }
            };
        };
        bindBackgroundUpload('diary-bg-cover', value => data.setCoverBg(value), '封面背景已更新');
        bindBackgroundUpload('diary-bg-toc', value => data.setTocBg(value), '目录背景已更新');

        document.getElementById('diary-bg-reset-default')?.addEventListener('click', async event => {
            const button = event.currentTarget;
            if (!confirm('确定恢复默认封面与目录背景，并清理对应的上传文件吗？')) return;
            button.disabled = true;
            try {
                const result = await data.resetDefaultBackgrounds();
                result?.cleanup?.();
                this.app.phoneShell.showNotification?.('已恢复', '封面与目录已恢复默认背景', '✅');
            } catch (error) {
                this.app.phoneShell.showNotification?.('恢复失败', error?.message || '请重试', '⚠️');
            } finally {
                button.disabled = false;
            }
        });

        const manualRun = document.getElementById('diary-manual-run');
        if (manualRun) manualRun.onclick = async () => {
            const btn = document.getElementById('diary-manual-run');
            const statusEl = document.getElementById('diary-manual-status');
            if (!btn) return;

            // 🔥 使用全局状态判断是否正在运行
            if (this._getDiaryGenerationState()?.running || window.VirtualPhone?.isDiaryBatchRunning) {
                this._diaryManualRunToken += 1;
                this.app.diaryData.stopBatch = true;
                this._requestDiaryGenerationStop();
                this._setDiaryGenerationState({
                    ...this._getDiaryGenerationState(),
                    running: false,
                    stopping: false,
                    done: false,
                    error: false,
                    stopped: true,
                    status: '已停止',
                    finishedAt: Date.now()
                });
                if (window.VirtualPhone) {
                    window.VirtualPhone.isDiaryBatchRunning = false;
                    delete window.VirtualPhone.diaryBatchProgress;
                }
                btn.textContent = '🚀 开始生成日记';
                btn.disabled = false;
                if (statusEl) statusEl.textContent = '已停止';
                return;
            }

            const startInput = document.getElementById('diary-manual-start');
            const endInput = document.getElementById('diary-manual-end');
            const start = parseInt(startInput?.value) || 0;
            const end = parseInt(endInput?.value) || 0;

            if (start >= end) { alert('起始楼层必须小于结束楼层'); return; }
            if (end - start < 2) { alert('楼层范围太小，至少需要2层'); return; }

            this.app.diaryData.stopBatch = false;
            const runToken = ++this._diaryManualRunToken;
            const isStaleRun = () => runToken !== this._diaryManualRunToken;
            this._setDiaryGenerationState({
                running: true,
                stopping: false,
                done: false,
                stopped: false,
                error: false,
                status: '初始化中...',
                current: 0,
                total: 1,
                startedAt: Date.now()
            });
            this._syncDiaryGenerationStatusUI();

            try {
                let generatedCount = 0;
                const batchModeEnabled = document.getElementById('diary-s-batch')?.checked !== false;
                const batchSizeInput = document.getElementById('diary-batch-size');
                const batchSize = parseInt(batchSizeInput?.value) || 50;
                const data = this.app.diaryData;

                if (batchModeEnabled && (end - start) > batchSize) {
                    const generatedEntries = await data.batchGenerateDiary(start, end, batchSize, (current, total, status) => {
                        if (isStaleRun()) return;
                        this._setDiaryGenerationState({
                            running: true,
                            stopping: false,
                            status,
                            current,
                            total
                        });
                        this._syncDiaryGenerationStatusUI();
                    });
                    generatedCount = Array.isArray(generatedEntries) ? generatedEntries.length : 0;
                } else {
                    this._setDiaryGenerationState({
                        running: true,
                        stopping: false,
                        status: '正在写日记...',
                        current: 0,
                        total: 1
                    });
                    this._syncDiaryGenerationStatusUI();
                    const diaries = await data.callAIToWriteDiary(start, end);
                    if (isStaleRun() || this.app.diaryData.stopBatch) return;
                    generatedCount = Array.isArray(diaries) ? diaries.length : 0;
                    for (const diary of diaries) {
                        data.addEntry({
                            content: diary.content,
                            title: diary.title,
                            startIndex: start,
                            endIndex: end,
                            date: diary.date,
                            author: diary.author,
                        });
                    }
                }
                if (isStaleRun()) return;
                if (this.app.diaryData.stopBatch) {
                    this._setDiaryGenerationState({
                        running: false,
                        stopping: false,
                        done: false,
                        error: false,
                        stopped: true,
                        status: '已停止',
                        finishedAt: Date.now()
                    });
                } else {
                    this._setDiaryGenerationState({
                        running: false,
                        stopping: false,
                        done: true,
                        stopped: false,
                        error: false,
                        status: '生成完成！',
                        finishedAt: Date.now()
                    });
                    const shell = window.VirtualPhone?.phoneShell || this.app.phoneShell;
                    shell?.showNotification?.('日记', `手动写日记完成，新增 ${generatedCount} 篇`, '📱');
                }
                this._syncDiaryGenerationStatusUI();
            } catch (err) {
                console.error('[DiaryView] 生成日记失败:', err);
                if (isStaleRun()) return;
                if (this.app.diaryData.stopBatch || /(?:已停止|已中断|AbortError|aborted|cancel)/i.test(String(err?.message || err || ''))) {
                    this._setDiaryGenerationState({
                        running: false,
                        stopping: false,
                        done: false,
                        error: false,
                        stopped: true,
                        status: '已停止',
                        finishedAt: Date.now()
                    });
                    this._syncDiaryGenerationStatusUI();
                    return;
                }
                this._setDiaryGenerationState({
                    running: false,
                    stopping: false,
                    done: false,
                    stopped: false,
                    error: true,
                    status: `失败: ${err.message}`,
                    finishedAt: Date.now()
                });
                this._syncDiaryGenerationStatusUI();
            } finally {
                if (!isStaleRun()) {
                    this.app.diaryData.stopBatch = false;
                    this._syncDiaryGenerationStatusUI();
                }
            }
        };

        const sAuto = document.getElementById('diary-s-auto');
        if (sAuto) sAuto.onchange = (e) => {
            this.app.diaryData.setAutoSettings({ autoEnabled: e.target.checked });
        };

        const sFloor = document.getElementById('diary-s-floor');
        if (sFloor) sFloor.onchange = (e) => {
            const val = Math.max(10, Math.min(9999, parseInt(e.target.value) || 50));
            e.target.value = val;
            this.app.diaryData.setAutoSettings({ autoFloor: val });
        };

        const batchModeToggle = document.getElementById('diary-s-batch');
        if (batchModeToggle) batchModeToggle.onchange = (e) => {
            this.app.diaryData.setAutoSettings({ batchMode: e.target.checked });
        };

        const batchSizeInput = document.getElementById('diary-batch-size');
        if (batchSizeInput) batchSizeInput.onchange = (e) => {
            const val = Math.max(10, Math.min(200, parseInt(e.target.value) || 50));
            e.target.value = val;
            this.app.diaryData.setAutoSettings({ manualBatchSize: val });
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

        document.getElementById('diary-use-worldbook')?.addEventListener('change', async (e) => {
            const enabled = !!e.target.checked;
            await window.VirtualPhone?.worldbookManager?.setEnabled?.('diary', enabled);
            if (enabled) this.renderDiaryWorldbookList();
        });

        const promptSave = document.getElementById('diary-s-prompt-save');
        if (promptSave) promptSave.onclick = () => {
            const textarea = document.getElementById('diary-s-prompt');
            if (!textarea) return;
            const pm = this._getPromptManager();
            if (pm?.prompts?.diary?.generate) {
                try {
                    pm.updateActivePromptUserPreset?.('diary', 'generate', textarea.value) ?? pm.updatePrompt?.('diary', 'generate', textarea.value);
                    alert('✅ 提示词已保存');
                } catch (e) {
                    alert(`⚠️ ${e?.message || '请先新增预设再保存'}`);
                }
            }
        };

        const openImportBtn = document.getElementById('diary-open-import');
        if (openImportBtn) openImportBtn.onclick = () => {
            this.currentView = 'import';
            this.render();
        };

        const promptReset = document.getElementById('diary-s-prompt-reset');
        if (promptReset) promptReset.onclick = () => {
            if (!confirm('确定恢复为默认提示词？')) return;
            const pm = this._getPromptManager();
            if (pm) {
                const defaultContent = pm.resetPromptToDefault?.('diary', 'generate')
                    ?? pm.getDefaultPrompts().diary?.generate?.content
                    ?? '';
                const textarea = document.getElementById('diary-s-prompt');
                if (textarea) {
                    textarea.value = defaultContent;
                }
            }
        };

        this._getPromptManager()?.bindPromptPresetControls?.(document.querySelector('.phone-view-current .diary-settings-view') || document, 'diary', 'generate', '#diary-s-prompt', {
            notify: (title, message, icon) => this.app.phoneShell?.showNotification?.(title, message, icon)
        });

        // 提示词折叠交互
    }

    async renderDiaryWorldbookList() {
        const container = document.getElementById('diary-worldbook-list');
        const manager = window.VirtualPhone?.worldbookManager;
        if (!container || !manager) return;
        await manager.renderWorldbookSelector(container, 'diary');
    }

    _getDiaryGenerationState() {
        return window.VirtualPhone?.diaryGenerationState || null;
    }

    _setDiaryGenerationState(patch = {}) {
        if (!window.VirtualPhone) window.VirtualPhone = {};
        const current = window.VirtualPhone.diaryGenerationState || {};
        window.VirtualPhone.diaryGenerationState = {
            ...current,
            ...patch,
            updatedAt: Date.now()
        };
        return window.VirtualPhone.diaryGenerationState;
    }

    _requestDiaryGenerationStop() {
        try {
            const context = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
            [
                context?.stopGeneration,
                context?.stopGenerationDebounced,
                window.stopGeneration,
                window.stopGenerationDebounced,
                window.abortGeneration,
                window.cancelGeneration
            ].forEach(fn => {
                if (typeof fn === 'function') {
                    try { fn.call(context || window); } catch (e) { }
                }
            });
            const stopButton = document.querySelector('#mes_stop, #send_but[title*="停止"], #send_but[title*="Stop"], .mes_stop, [data-action="stop"]');
            stopButton?.click?.();
        } catch (e) {
            console.warn('[DiaryView] 请求停止日记生成失败:', e);
        }
    }

    _syncDiaryGenerationStatusUI() {
        const btn = document.getElementById('diary-manual-run');
        const statusEl = document.getElementById('diary-manual-status');
        if (!btn && !statusEl) return;

        const state = this._getDiaryGenerationState();
        const progress = window.VirtualPhone?.diaryBatchProgress;
        const isRunning = !!(state?.running || window.VirtualPhone?.isDiaryBatchRunning);
        const isStopping = !!state?.stopping;

        if (isRunning) {
            const current = Number(state?.current ?? progress?.current ?? 0);
            const total = Number(state?.total ?? progress?.total ?? 1);
            if (btn) {
                btn.textContent = isStopping
                    ? '🛑 正在停止...'
                    : (total > 1 ? `🛑 停止 (${current}/${total})` : '🛑 停止');
                btn.disabled = isStopping;
            }
            if (statusEl) {
                statusEl.textContent = `🔄 ${state?.status || '正在写日记...'}`;
            }
            return;
        }

        if (btn) {
            btn.textContent = '🚀 开始生成日记';
            btn.disabled = false;
        }

        if (!statusEl) return;

        if (state?.done) {
            statusEl.textContent = '';
            return;
        }

        if (state?.stopped) {
            statusEl.textContent = '已停止';
            return;
        }

        if (state?.error) {
            statusEl.textContent = `❌ ${state.status || '生成失败'}`;
            return;
        }

        statusEl.textContent = '';
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
            <div class="diary-app" style="${this._appearanceStyle()}">
                <div class="diary-edit-view">
                    <div class="diary-edit-header">
                        <div class="diary-edit-title">${this._escapeHtml(diaryTitle)}</div>
                        <div class="diary-edit-actions">
                            <button class="diary-edit-cancel-btn" id="diary-edit-cancel">取消</button>
                            <button class="diary-edit-save-btn" id="diary-edit-save">保存</button>
                        </div>
                    </div>
                    <div class="diary-edit-body">
                        <textarea class="diary-edit-textarea" id="diary-edit-text">${this._escapeTextarea(entry.content || '')}</textarea>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'diary-' + this.currentView);
        this._bindEditEvents();
    }

    _bindEditEvents() {
        const closeEditor = () => {
            const returnToPage = this._previousView === 'page' && !!this.currentEntryId;
            this.currentView = returnToPage ? 'page' : 'toc';
            this._previousView = 'cover';
            this._editingEntryId = null;
            this.isBackNav = true;
            this.render();
        };
        const cancelBtn = document.getElementById('diary-edit-cancel');
        if (cancelBtn) cancelBtn.onclick = closeEditor;

        const saveBtn = document.getElementById('diary-edit-save');
        if (saveBtn) saveBtn.onclick = () => {
            const textarea = document.getElementById('diary-edit-text');
            if (textarea && this._editingEntryId) {
                this.app.diaryData.updateEntryContent(this._editingEntryId, textarea.value);
            }
            closeEditor();
        };
    }

    // ==================== 新增与导入视图 ====================

    renderNewEntry() {
        const html = `
            <div class="diary-app" style="${this._appearanceStyle()}">
                <div class="diary-edit-view diary-new-view">
                    <div class="diary-compose-header">
                        <button type="button" class="diary-compose-cancel" id="diary-new-cancel" title="取消" aria-label="取消">✕</button>
                        <div class="diary-compose-title">新增日记</div>
                        <button class="diary-edit-save-btn" id="diary-new-save">保存</button>
                    </div>
                    <div class="diary-edit-body">
                        <textarea class="diary-edit-textarea" id="diary-new-text" placeholder="粘贴或输入一篇日记。建议格式：&#10;【标题】&#10;正文...&#10;————2026年5月4日 星期一 晴"></textarea>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'diary-' + this.currentView);
        this._bindNewEntryEvents();
    }

    _bindNewEntryEvents() {
        const cancelBtn = document.getElementById('diary-new-cancel');
        if (cancelBtn) cancelBtn.onclick = () => {
            this.currentView = 'toc';
            this.isBackNav = true;
            this.render();
        };

        const saveBtn = document.getElementById('diary-new-save');
        if (saveBtn) saveBtn.onclick = () => {
            const textarea = document.getElementById('diary-new-text');
            const content = String(textarea?.value || '').trim();
            if (!content) {
                alert('请先输入日记内容');
                return;
            }

            try {
                const entry = this.app.diaryData.createManualEntry(content);
                this.currentEntryId = entry.id;
                this.currentView = 'page';
                this.isBackNav = true;
                this.render();
            } catch (err) {
                alert('保存失败：' + (err?.message || err));
            }
        };
    }

    renderImport() {
        const html = `
            <div class="diary-app" style="${this._appearanceStyle()}">
                <div class="diary-edit-view diary-import-view">
                    <div class="diary-compose-header">
                        <button type="button" class="diary-compose-cancel" id="diary-import-cancel" title="取消" aria-label="取消">✕</button>
                        <div class="diary-compose-title">批量导入</div>
                        <button class="diary-edit-save-btn" id="diary-import-save">导入</button>
                    </div>
                    <div class="diary-import-body">
                        <div class="diary-import-desc">
                            大量旧日记建议读取 .txt/.json 文件，识别后会直接导入，不塞进输入框。少量内容也可手动粘贴；推荐每篇之间用单独一行 === 分隔。
                        </div>
                        <div class="diary-import-tools">
                            <label class="diary-s-btn diary-s-btn-primary" for="diary-import-file">读取文件</label>
                            <input type="file" id="diary-import-file" accept=".txt,.json,text/plain,application/json" style="display:none;">
                        </div>
                        <textarea class="diary-edit-textarea diary-import-textarea" id="diary-import-text" placeholder="【第一次见面】&#10;正文...&#10;————2026年5月1日 星期五 晴&#10;&#10;===&#10;&#10;【雨夜】&#10;正文...&#10;————2026年5月2日 星期六 雨"></textarea>
                        <div class="diary-import-preview" id="diary-import-preview">待识别：0 篇</div>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'diary-' + this.currentView);
        this._bindImportEvents();
    }

    _bindImportEvents() {
        const textarea = document.getElementById('diary-import-text');
        const preview = document.getElementById('diary-import-preview');
        const refreshPreview = () => {
            if (!preview || !textarea) return;
            const count = this.app.diaryData.parseImportedDiaries(textarea.value).length;
            preview.textContent = `待识别：${count} 篇`;
        };

        if (textarea) textarea.oninput = refreshPreview;

        const fileInput = document.getElementById('diary-import-file');
        if (fileInput) fileInput.onchange = () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                fileInput.value = '';
                const content = String(reader.result || '').trim();
                if (!content) {
                    alert('文件内容为空');
                    return;
                }

                const diaries = this.app.diaryData.parseImportedDiaries(content);
                if (diaries.length === 0) {
                    alert('没有识别到可导入的日记');
                    return;
                }
                if (!confirm(`已识别 ${diaries.length} 篇日记，确认直接导入吗？`)) return;

                try {
                    const imported = this.app.diaryData.importEntriesFromText(content);
                    this.tocOrder = 'desc';
                    this.currentView = 'toc';
                    this.isBackNav = true;
                    this.render();
                    const shell = window.VirtualPhone?.phoneShell || this.app.phoneShell;
                    shell?.showNotification('导入完成', `已导入 ${imported.length} 篇日记`, '✅');
                } catch (err) {
                    alert('导入失败：' + (err?.message || err));
                }
            };
            reader.onerror = () => {
                alert('读取文件失败');
                fileInput.value = '';
            };
            reader.readAsText(file, 'UTF-8');
        };

        const cancelBtn = document.getElementById('diary-import-cancel');
        if (cancelBtn) cancelBtn.onclick = () => {
            this.currentView = 'settings';
            this.isBackNav = true;
            this.render();
        };

        const saveBtn = document.getElementById('diary-import-save');
        if (saveBtn) saveBtn.onclick = () => {
            const content = String(textarea?.value || '').trim();
            if (!content) {
                alert('请先粘贴要导入的日记');
                return;
            }

            const diaries = this.app.diaryData.parseImportedDiaries(content);
            if (diaries.length === 0) {
                alert('没有识别到可导入的日记');
                return;
            }
            if (!confirm(`确认导入 ${diaries.length} 篇日记吗？`)) return;

            try {
                const imported = this.app.diaryData.importEntriesFromText(content);
                this.tocOrder = 'desc';
                this.currentView = 'toc';
                this.isBackNav = true;
                this.render();
                const shell = window.VirtualPhone?.phoneShell || this.app.phoneShell;
                shell?.showNotification('导入完成', `已导入 ${imported.length} 篇日记`, '✅');
            } catch (err) {
                alert('导入失败：' + (err?.message || err));
            }
        };

        refreshPreview();
    }

    // ==================== 图片处理与杂项 ====================

    _getPromptManager() {
        const pm = window.VirtualPhone?.promptManager;
        if (pm) pm.ensureLoaded();
        return pm;
    }

    _getPromptContent() {
        const pm = this._getPromptManager();
        return pm?.prompts?.diary?.generate?.content || '';
    }

    _escapeTextarea(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    _parseDate(dateStr) {
        if (!dateStr) return { day: '?', monthLabel: '', year: '', full: '未知日期', weekday: '' };
        const m = dateStr.match(/(\d{1,6})年(\d{1,2})月(\d{1,2})日/);
        const wm = dateStr.match(/(星期[一二三四五六日天])/);
        if (m) {
            return {
                day: m[3],
                month: m[2],
                monthLabel: `${m[2]}月`,
                year: m[1],
                full: `${m[1]}年${m[2]}月${m[3]}日`,
                weekday: wm ? wm[1] : ''
            };
        }
        return { day: '?', monthLabel: '', year: '', full: dateStr, weekday: wm ? wm[1] : '' };
    }

    _extractTitle(content) {
        if (!content) return '无标题';
        const titleMatch = content.match(/【([^】]+)】/);
        if (titleMatch && !titleMatch[1].match(/\d{1,6}年/)) {
            return titleMatch[1];
        }
        return '无标题';
    }

    _sortEntries(entries) {
        const sorted = [...(entries || [])].sort((a, b) => {
            const timeA = this.app.diaryData.getEntrySortTimestamp(a);
            const timeB = this.app.diaryData.getEntrySortTimestamp(b);
            if (timeA !== timeB) return timeA - timeB;
            return Number(a?.createdAt || 0) - Number(b?.createdAt || 0);
        });
        return this.tocOrder === 'desc' ? sorted.reverse() : sorted;
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
        const blocks = this._formatContentParts(content).filter(part => part !== '__DIARY_PHOTO__');
        return `<div class="diary-text-body">${blocks.join('') || '<span class="diary-empty-page">（空白页）</span>'}</div>`;
    }

    _formatContentParts(content) {
        if (!content) return [];

        let formatted = content;
        formatted = formatted.replace(/^(?:[^\S\r\n]|&nbsp;|&emsp;|&ensp;|&#160;|&#8195;|\u200B|\u3000)+/gm, '');
        formatted = formatted.replace(/^【[^】]+】\s*/, '');
        formatted = formatted.replace(/^日期[:：].*$/gm, '');
        formatted = formatted.replace(/^天气[:：].*$/gm, '');
        formatted = formatted.replace(/^日记正文[:：]\s*$/gm, '');
        formatted = formatted.replace(/^照片[:：]\s*$/gm, '');
        formatted = formatted.replace(/^落款[:：].*$/gm, '');
        formatted = formatted.replace(/^(?:[^\S\r\n]|&nbsp;|&emsp;|&ensp;|&#160;|&#8195;|\u200B|\u3000)+/gm, '');
        formatted = formatted.replace(/^[\r\n]+/, '');

        formatted = formatted
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        formatted = formatted.replace(/~~([\s\S]*?)~~/g, (match, inner) => {
            const text = String(inner || '').trim();
            if (!text) return match;
            return `<del class="diary-strike">${text}</del>`;
        });

        const photoItems = extractImagePromptItems(formatted, {
            acceptMediaType: mediaType => mediaType === '用户照片'
                || mediaType === '个人图片'
                || mediaType === '图片'
        });
        const parts = [];
        let lastIndex = 0;
        for (const item of photoItems) {
            const before = formatted.slice(lastIndex, item.index).trim();
            if (before) parts.push(...this._formatTextBlocks(before));
            parts.push('__DIARY_PHOTO__');
            lastIndex = item.endIndex;
        }
        const tail = formatted.slice(lastIndex).trim();
        if (tail) parts.push(...this._formatTextBlocks(tail));
        return parts;
    }

    _formatTextBlocks(text = '') {
        return String(text || '')
            .split(/\n{2,}/)
            .map(part => part.trim())
            .filter(Boolean)
            .map(part => `<div class="diary-bujo-text-item">${part.replace(/\n/g, '<br>')}</div>`);
    }

    _escapeHtml(value = '') {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _escapeAttr(value = '') {
        return this._escapeHtml(value);
    }
}
