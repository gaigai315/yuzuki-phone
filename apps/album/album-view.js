/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

import { PHONE_CONFIG } from '../../config/apps.js';

export const ALBUM_CSS_URL = new URL('./album.css?v=1.2.3&r=20261006-story-image-outside-close', import.meta.url).href;

export class AlbumView {
    constructor(app) {
        this.app = app;
        this._cssLoaded = false;
        this.images = [];
        this.previewOpen = false;
        this.selectionMode = false;
        this.selectedPaths = new Set();
        this._missingImagePaths = new Set();
        this.isDeleting = false;
        this.isBulkDeleting = false;
        this.activeSource = 'all';
        this.sourceMenuOpen = false;
        this.currentView = 'main';
    }

    loadCSS() {
        if (this._cssLoaded) return;
        if (document.getElementById('album-css')) {
            this._cssLoaded = true;
            return;
        }
        const link = document.createElement('link');
        link.id = 'album-css';
        link.rel = 'stylesheet';
        link.href = ALBUM_CSS_URL;
        document.head.appendChild(link);
        this._cssLoaded = true;
    }

    render() {
        this.loadCSS();
        if (this.currentView === 'settings') {
            this.renderStoryImageSettings();
            return;
        }
        this.images = this.app.albumData.getMedia();
        const sourceGroups = this.app.albumData.groupImagesBySource(this.images);
        if (this.activeSource !== 'all' && !sourceGroups.some(group => group.key === this.activeSource)) {
            this.activeSource = 'all';
        }
        const currentPaths = new Set(this.images.map(image => image.path));
        this.selectedPaths = new Set([...this.selectedPaths].filter(path => currentPaths.has(path)));
        if (this.images.length === 0) {
            this.selectionMode = false;
            this.selectedPaths.clear();
        }
        this.sourceMenuOpen = false;
        const visibleImages = this.getVisibleImages();
        const selectedCount = this.selectedPaths.size;
        const allSelected = visibleImages.length > 0 && visibleImages.every(image => this.selectedPaths.has(image.path));
        const activeSourceLabel = this.getActiveSourceLabel();
        const wallpaperStyle = this.getWallpaperStyle();
        const html = `
            <div class="album-app album-wallpaper-shell${this.selectionMode ? ' album-selecting' : ''}" style="${wallpaperStyle}">
                <header class="album-header">
                    <button type="button" class="album-icon-btn" id="album-back" aria-label="返回">
                        <i class="fa-solid ${this.selectionMode ? 'fa-xmark' : 'fa-chevron-left'}"></i>
                    </button>
                    <div class="album-title-wrap">
                        <div class="album-title">${this.selectionMode ? `已选 ${selectedCount} 项` : '相册'}</div>
                    </div>
                    <div class="album-header-actions">
                        ${this.selectionMode ? `
                            <button type="button" class="album-select-btn" id="album-select-all">${allSelected ? '取消全选' : '全选'}</button>
                            <button type="button" class="album-icon-btn album-danger-btn" id="album-delete-selected" aria-label="删除所选" ${selectedCount ? '' : 'disabled'}>
                                <i class="fa-regular fa-trash-can"></i>
                            </button>
                        ` : `
                            <button type="button" class="album-icon-btn" id="album-open-settings" aria-label="正文生图设置" title="正文生图设置">
                                <i class="fa-solid fa-gear" aria-hidden="true"></i>
                            </button>
                        `}
                    </div>
                </header>
                ${this.selectionMode ? '' : this.renderSourceMenu(sourceGroups)}
                <main class="album-body">
                    ${this.images.length ? `
                        <div class="album-body-toolbar">
                            <span>${this.escapeHtml(activeSourceLabel)} · ${visibleImages.length} 项</span>
                            <div class="album-body-toolbar-actions">
                                <button type="button" class="album-source-filter" id="album-source-filter" aria-haspopup="menu" aria-expanded="false">
                                    <span>分类</span>
                                    <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                                </button>
                                <button type="button" id="album-select-toggle">选择</button>
                            </div>
                        </div>
                        ${this.renderSourceSections(visibleImages)}
                        <div class="album-total-count">共 ${this.images.length} 个项目</div>
                    ` : this.renderEmpty()}
                </main>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'album-main');
        requestAnimationFrame(() => this.bindEvents());
    }


    renderStoryImageSettings() {
        const settings = this.app.albumData.getStoryImageSettings();
        const promptManager = window.VirtualPhone?.promptManager;
        promptManager?.ensureLoaded?.();
        const promptConfig = promptManager?.prompts?.story?.override
            || promptManager?.getDefaultPrompts?.()?.story?.override
            || {};
        const promptContent = promptManager?.getPromptForFeature?.('story', 'override')
            || promptConfig.content
            || '';
        const useStoryWorldbook = window.VirtualPhone?.worldbookManager?.getEnabled?.('story') ?? true;
        const wallpaperStyle = this.getWallpaperStyle();
        const html = `
            <div class="album-app album-story-settings-page album-wallpaper-shell" style="${wallpaperStyle}">
                <header class="album-header">
                    <button type="button" class="album-icon-btn" id="album-settings-back" aria-label="返回相册">
                        <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                    </button>
                    <div class="album-title-wrap">
                        <div class="album-title">正文生图</div>
                    </div>
                    <div class="album-header-actions"></div>
                </header>
                <main class="album-story-settings-body">
                    <section class="album-story-settings-summary" aria-label="正文生图状态">
                        <span class="album-story-settings-summary-icon" aria-hidden="true">
                            <i class="fa-solid fa-image"></i>
                        </span>
                        <div class="album-story-settings-summary-copy">
                            <strong>正文楼层生图</strong>
                            <span>${settings.autoEnabled ? '自动生图已开启' : '当前为手动生成'}</span>
                        </div>
                    </section>

                    <div class="album-story-settings-section-title">基础设置</div>
                    <section class="album-story-settings-list">
                        ${this.renderStoryImageSettingRow({
                            id: 'album-story-image-auto-enabled',
                            title: '开启自动正文生图',
                            description: '新正文楼层的后台任务完成后，自动生成 Tags 和图片',
                            icon: 'fa-wand-magic-sparkles',
                            checked: settings.autoEnabled
                        })}
                        ${this.renderStoryImageSettingRow({
                            id: 'album-story-image-auto-preview',
                            title: '生成完成自动预览',
                            description: '图片生成完成后直接打开对应楼层预览',
                            icon: 'fa-eye',
                            checked: settings.autoPreviewEnabled
                        })}
                    </section>

                    <div class="album-story-settings-section-title">生成上下文</div>
                    <section class="album-story-settings-panel">
                        <div class="album-story-settings-context-row">
                            <span class="album-story-settings-row-icon" aria-hidden="true">
                                <i class="fa-solid fa-address-card"></i>
                            </span>
                            <span class="album-story-settings-row-copy">
                                <strong>角色卡与用户信息</strong>
                                <small>生成 Tags 时自动带入当前角色卡和用户 Persona</small>
                            </span>
                            <span class="album-story-settings-state">已启用</span>
                        </div>
                        <label class="album-story-settings-context-row" for="album-story-use-worldbook" data-no-swipe-back>
                            <span class="album-story-settings-row-icon" aria-hidden="true">
                                <i class="fa-solid fa-book-open"></i>
                            </span>
                            <span class="album-story-settings-row-copy">
                                <strong>使用酒馆世界书</strong>
                                <small>只注入正文生图下方勾选的世界书条目</small>
                            </span>
                            <span class="st-phone-toggle-switch">
                                <input type="checkbox" id="album-story-use-worldbook" ${useStoryWorldbook ? 'checked' : ''}>
                                <span class="st-phone-toggle-slider"></span>
                            </span>
                        </label>
                        <div class="phone-prompt-fold album-story-settings-fold album-story-worldbook-fold" data-default-open="false">
                            <button type="button" class="phone-prompt-fold-header" data-no-swipe-back aria-expanded="false" aria-controls="album-story-worldbook-fold-content">
                                <span class="phone-prompt-fold-main">
                                    <span class="phone-prompt-fold-title">世界书选择</span>
                                    <span class="phone-prompt-fold-desc">展开后勾选正文生图可使用的世界书与条目</span>
                                </span>
                                <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow" aria-hidden="true"></i>
                            </button>
                            <div class="phone-prompt-fold-content" id="album-story-worldbook-fold-content" aria-hidden="true">
                                <div id="album-story-worldbook-list" class="album-story-worldbook-list">
                                    <div class="phone-worldbook-status">正在读取当前可用世界书...</div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <div class="album-story-settings-section-title">功能提示词</div>
                    <section class="album-story-settings-panel album-story-prompt-section">
                        <div class="phone-prompt-fold album-story-settings-fold album-story-prompt-fold" data-default-open="false">
                            <button type="button" class="phone-prompt-fold-header" data-no-swipe-back aria-expanded="false" aria-controls="album-story-prompt-fold-content">
                                <span class="phone-prompt-fold-main">
                                    <span class="phone-prompt-fold-title">${this.escapeHtml(promptConfig.name || '🧩 正文生图破限词')}</span>
                                    <span class="phone-prompt-fold-desc">${this.escapeHtml(promptConfig.description || '正文楼层生成 Tags 时优先注入')}</span>
                                </span>
                                <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow" aria-hidden="true"></i>
                            </button>
                            <div class="phone-prompt-fold-content" id="album-story-prompt-fold-content" aria-hidden="true">
                                ${promptManager?.renderPromptPresetControls?.('story', 'override') || ''}
                                <textarea class="album-story-prompt-editor" id="album-story-override-prompt" spellcheck="false">${this.escapeHtml(promptContent)}</textarea>
                                <div class="album-story-prompt-actions">
                                    <button type="button" class="album-story-prompt-reset" id="album-story-reset-prompt">
                                        <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
                                        <span>恢复默认</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>
                </main>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'album-story-settings');
        requestAnimationFrame(() => this.bindEvents());
    }

    renderStoryImageSettingRow({ id, title, description, icon, checked = false, disabled = false }) {
        return `
            <label class="album-story-settings-row${disabled ? ' is-disabled' : ''}" for="${this.escapeAttr(id)}" data-no-swipe-back>
                <span class="album-story-settings-row-icon" aria-hidden="true">
                    <i class="fa-solid ${this.escapeAttr(icon)}"></i>
                </span>
                <span class="album-story-settings-row-copy">
                    <strong>${this.escapeHtml(title)}</strong>
                    <small>${this.escapeHtml(description)}</small>
                </span>
                <span class="st-phone-toggle-switch">
                    <input type="checkbox" id="${this.escapeAttr(id)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
                    <span class="st-phone-toggle-slider"></span>
                </span>
            </label>
        `;
    }

    getVisibleImages() {
        if (this.activeSource === 'all') return this.images;
        return this.images.filter(image => image.sourceKey === this.activeSource);
    }

    getActiveSourceLabel() {
        if (this.activeSource === 'all') return '全部来源';
        return this.app.albumData.getSourceDefinition(this.activeSource)?.label || '全部来源';
    }

    getWallpaperStyle() {
        let wallpaper = '';
        try {
            wallpaper = String(window.VirtualPhone?.imageManager?.getWallpaper?.() || '').trim();
        } catch (e) {
            wallpaper = '';
        }
        if (!wallpaper) {
            try {
                wallpaper = String(this.app?.storage?.get?.('phone-wallpaper') || '').trim();
            } catch (e) {
                wallpaper = '';
            }
        }
        if (!wallpaper) {
            wallpaper = String(PHONE_CONFIG.defaultWallpaper || '').trim();
        }
        return wallpaper
            ? `background-image: url('${this.escapeAttr(wallpaper)}'); background-size: cover; background-position: center;`
            : '';
    }

    renderSourceMenu(sourceGroups = []) {
        const options = [
            { key: 'all', label: '全部来源', icon: 'fa-images', images: this.images },
            ...sourceGroups
        ];
        return `
            <div class="album-source-popover" id="album-source-popover" aria-hidden="true">
                <button type="button" class="album-source-backdrop" data-album-source-close aria-label="关闭来源筛选"></button>
                <div class="album-source-menu" role="menu" aria-label="照片来源">
                    ${options.map(option => `
                        <button type="button" class="album-source-option${option.key === this.activeSource ? ' is-active' : ''}" data-album-source="${this.escapeAttr(option.key)}" role="menuitem">
                            <span class="album-source-badge is-${this.escapeAttr(option.key)}"><i class="fa-solid ${this.escapeAttr(option.icon)}" aria-hidden="true"></i></span>
                            <span class="album-source-option-label">${this.escapeHtml(option.label)}</span>
                            <span class="album-source-option-count">${option.images.length}</span>
                            <i class="fa-solid fa-check album-source-option-check" aria-hidden="true"></i>
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    }

    renderSourceSections(images = []) {
        const groups = this.app.albumData.groupImagesBySource(images);
        const previewMode = this.activeSource === 'all' && !this.selectionMode;
        return `
            <div class="album-source-sections">
                ${groups.map(group => {
                    const shownImages = previewMode ? group.images.slice(0, 4) : group.images;
                    const canFocus = this.activeSource === 'all' && !this.selectionMode;
                    return `
                        <section class="album-source-section" data-source-key="${this.escapeAttr(group.key)}">
                            <button type="button" class="album-source-heading" ${canFocus ? `data-album-source-focus="${this.escapeAttr(group.key)}"` : 'disabled'}>
                                <span class="album-source-badge is-${this.escapeAttr(group.key)}"><i class="fa-solid ${this.escapeAttr(group.icon)}" aria-hidden="true"></i></span>
                                <span class="album-source-heading-copy">
                                    <strong>${this.escapeHtml(group.label)}</strong>
                                    <small>${group.images.length} 项</small>
                                </span>
                                ${canFocus ? '<i class="fa-solid fa-chevron-right album-source-heading-arrow" aria-hidden="true"></i>' : ''}
                            </button>
                            <div class="album-grid">
                                ${shownImages.map(image => this.renderTile(image)).join('')}
                            </div>
                        </section>
                    `;
                }).join('')}
            </div>
        `;
    }

    renderTile(image) {
        const index = this.images.indexOf(image);
        const isVideo = image?.mediaType === 'video';
        const mediaHtml = isVideo
            ? `<video src="${this.escapeAttr(image.src)}" muted playsinline webkit-playsinline preload="metadata" aria-hidden="true"></video><span class="album-video-indicator" aria-hidden="true"><i class="fa-solid fa-play"></i></span>`
            : `<img src="${this.escapeAttr(image.src)}" alt="">`;
        return `
            <div class="album-tile${isVideo ? ' is-video' : ''}${this.selectedPaths.has(image.path) ? ' selected' : ''}" data-index="${index}" title="${this.escapeHtml(image.filename)}">
                <button type="button" class="album-tile-main" data-index="${index}" aria-label="${this.selectionMode ? '选择' : '查看'}${isVideo ? '视频' : '图片'}">
                    ${mediaHtml}
                    <span class="album-checkmark"><i class="fa-solid fa-check"></i></span>
                </button>
            </div>
        `;
    }

    renderEmpty() {
        return `
            <div class="album-empty">
                <div class="album-empty-icon"><i class="fa-regular fa-images"></i></div>
                <div class="album-empty-title">还没有图片或视频</div>
                <div class="album-empty-copy">各个 App 保存过的图片和视频会按来源显示在这里。</div>
            </div>
        `;
    }

    bindEvents() {
        const root = (document.querySelector('.phone-view-current') || document).querySelector('.album-app');
        if (!root) return;
        if (this.currentView === 'settings') {
            this.bindStoryImageSettingsEvents(root);
            return;
        }
        root.querySelector('#album-back')?.addEventListener('click', () => {
            if (this.selectionMode) {
                this.selectionMode = false;
                this.selectedPaths.clear();
                this.render();
                return;
            }
            if (this.activeSource !== 'all') {
                this.activeSource = 'all';
                this.render();
                return;
            }
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        });
        root.querySelector('#album-open-settings')?.addEventListener('click', () => {
            this.sourceMenuOpen = false;
            this.currentView = 'settings';
            this.render();
        });
        root.querySelector('#album-source-filter')?.addEventListener('click', () => {
            this.sourceMenuOpen = !this.sourceMenuOpen;
            root.querySelector('#album-source-popover')?.classList.toggle('is-open', this.sourceMenuOpen);
            root.querySelector('#album-source-popover')?.setAttribute('aria-hidden', String(!this.sourceMenuOpen));
            root.querySelector('#album-source-filter')?.setAttribute('aria-expanded', String(this.sourceMenuOpen));
        });
        root.querySelector('[data-album-source-close]')?.addEventListener('click', () => this.closeSourceMenu(root));
        root.querySelectorAll('[data-album-source]').forEach(option => {
            option.addEventListener('click', () => {
                this.activeSource = option.dataset.albumSource || 'all';
                this.selectedPaths.clear();
                this.render();
            });
        });
        root.querySelectorAll('[data-album-source-focus]').forEach(heading => {
            heading.addEventListener('click', () => {
                this.activeSource = heading.dataset.albumSourceFocus || 'all';
                this.render();
            });
        });
        root.querySelector('#album-select-toggle')?.addEventListener('click', () => {
            this.selectionMode = true;
            this.selectedPaths.clear();
            this.render();
        });
        root.querySelector('#album-select-all')?.addEventListener('click', () => this.toggleSelectAll());
        root.querySelector('#album-delete-selected')?.addEventListener('click', () => this.deleteSelectedImages());
        root.querySelectorAll('.album-tile-main').forEach(tile => {
            tile.addEventListener('click', () => {
                const index = Number.parseInt(tile.dataset.index, 10);
                if (this.selectionMode) {
                    this.toggleSelected(index);
                    return;
                }
                this.openPreview(index);
            });
        });
        root.querySelectorAll('.album-tile img').forEach(img => {
            img.addEventListener('error', async () => {
                img.closest('.album-tile')?.classList.add('is-broken');
                const index = Number.parseInt(img.closest('.album-tile')?.dataset?.index || '', 10);
                const image = Number.isFinite(index) ? this.images[index] : null;
                await this.handleMissingImage(image);
            }, { once: true });
        });
        root.querySelectorAll('.album-tile video').forEach(video => {
            video.pause?.();
            video.addEventListener('error', () => {
                video.closest('.album-tile')?.classList.add('is-broken');
            }, { once: true });
        });
    }

    bindStoryImageSettingsEvents(root) {
        root.addEventListener('touchstart', (event) => {
            if (event.target?.closest?.('button, label, input, select, textarea, [role="button"]')) {
                event.stopPropagation();
            }
        }, { passive: true });

        root.querySelector('#album-settings-back')?.addEventListener('click', () => {
            this.currentView = 'main';
            this.render();
        });

        const bindToggle = (selector, settingName, { rerender = false } = {}) => {
            root.querySelector(selector)?.addEventListener('change', async (event) => {
                const input = event.currentTarget;
                input.disabled = true;
                try {
                    await this.app.albumData.setStoryImageSetting(settingName, !!input.checked);
                } catch (error) {
                    console.error('保存正文生图设置失败:', error);
                    input.checked = !input.checked;
                    this.app.phoneShell?.showNotification?.('正文生图', '设置保存失败', '⚠️');
                } finally {
                    input.disabled = false;
                }
                if (rerender) this.renderStoryImageSettings();
            });
        };

        bindToggle('#album-story-image-auto-enabled', 'autoEnabled', { rerender: true });
        bindToggle('#album-story-image-auto-preview', 'autoPreviewEnabled');

        root.querySelectorAll('.album-story-settings-fold .phone-prompt-fold-header').forEach((header) => {
            const toggleFold = () => {
                const fold = header.closest('.album-story-settings-fold');
                if (!fold) return;
                const open = !fold.classList.contains('is-open');
                fold.classList.toggle('is-open', open);
                header.setAttribute('aria-expanded', String(open));
                fold.querySelector('.phone-prompt-fold-content')?.setAttribute('aria-hidden', String(!open));
            };
            header.addEventListener('click', toggleFold);
        });

        const worldbookManager = window.VirtualPhone?.worldbookManager;
        const worldbookList = root.querySelector('#album-story-worldbook-list');
        if (worldbookManager && worldbookList) {
            worldbookManager.renderWorldbookSelector(worldbookList, 'story');
        }
        root.querySelector('#album-story-use-worldbook')?.addEventListener('change', async (event) => {
            const input = event.currentTarget;
            const enabled = !!input.checked;
            input.disabled = true;
            try {
                await worldbookManager?.setEnabled?.('story', enabled);
                if (worldbookManager && worldbookList) {
                    await worldbookManager.renderWorldbookSelector(worldbookList, 'story');
                }
                this.app.phoneShell?.showNotification?.(
                    '正文生图',
                    enabled ? '已开启世界书注入' : '已关闭世界书注入',
                    enabled ? '✅' : 'ℹ️'
                );
            } catch (error) {
                console.error('保存正文生图世界书设置失败:', error);
                input.checked = !enabled;
                this.app.phoneShell?.showNotification?.('正文生图', '世界书设置保存失败', '⚠️');
            } finally {
                input.disabled = false;
            }
        });

        const promptManager = window.VirtualPhone?.promptManager;
        promptManager?.bindPromptPresetControls?.(root, 'story', 'override', '#album-story-override-prompt', {
            notify: (title, message, icon) => this.app.phoneShell?.showNotification?.(title, message, icon)
        });
        root.querySelector('#album-story-reset-prompt')?.addEventListener('click', () => {
            const defaultContent = promptManager?.resetPromptToDefault?.('story', 'override')
                ?? promptManager?.getDefaultPrompts?.()?.story?.override?.content
                ?? '';
            const textarea = root.querySelector('#album-story-override-prompt');
            if (textarea) textarea.value = defaultContent;
            const select = root.querySelector('[data-prompt-app="story"][data-prompt-feature="override"] .phone-prompt-preset-select');
            if (select) select.value = promptManager?.getActivePromptPresetId?.('story', 'override') || '';
            this.app.phoneShell?.showNotification?.('正文生图', '已恢复默认破限提示词', '🔄');
        });
    }


    closeSourceMenu(root = null) {
        this.sourceMenuOpen = false;
        const albumRoot = root || (document.querySelector('.phone-view-current') || document).querySelector('.album-app');
        albumRoot?.querySelector('#album-source-popover')?.classList.remove('is-open');
        albumRoot?.querySelector('#album-source-popover')?.setAttribute('aria-hidden', 'true');
        albumRoot?.querySelector('#album-source-filter')?.setAttribute('aria-expanded', 'false');
    }

    refreshSelectionUI() {
        const selectedCount = this.selectedPaths.size;
        const visibleImages = this.getVisibleImages();
        const allSelected = visibleImages.length > 0 && visibleImages.every(image => this.selectedPaths.has(image.path));
        const root = (document.querySelector('.phone-view-current') || document).querySelector('.album-app');
        const title = root?.querySelector('.album-title');
        if (title) title.textContent = this.selectionMode ? `已选 ${selectedCount} 项` : '相册';

        const selectAllBtn = root?.querySelector('#album-select-all');
        if (selectAllBtn) selectAllBtn.textContent = allSelected ? '取消全选' : '全选';

        const deleteBtn = root?.querySelector('#album-delete-selected');
        if (deleteBtn) deleteBtn.disabled = selectedCount === 0;

        root?.querySelectorAll('.album-tile').forEach(tile => {
            const index = Number.parseInt(tile.dataset.index || '', 10);
            const image = Number.isFinite(index) ? this.images[index] : null;
            tile.classList.toggle('selected', !!image && this.selectedPaths.has(image.path));
        });
    }

    async handleMissingImage(image) {
        if (!image?.path || this._missingImagePaths.has(image.path)) return;
        this._missingImagePaths.add(image.path);
        try {
            const changed = await this.app.albumData.markMissingImage?.(image.path);
            if (changed) {
                this.selectedPaths.delete(image.path);
                requestAnimationFrame(() => this.render());
            }
        } catch (e) {
            console.warn('清理失效相册图片失败:', image.path, e);
        }
    }

    toggleSelected(index) {
        const image = this.images[index];
        if (!image) return;
        if (this.selectedPaths.has(image.path)) {
            this.selectedPaths.delete(image.path);
        } else {
            this.selectedPaths.add(image.path);
        }
        this.refreshSelectionUI();
    }

    toggleSelectAll() {
        if (!this.selectionMode) return;
        const visibleImages = this.getVisibleImages();
        const allSelected = visibleImages.length > 0 && visibleImages.every(image => this.selectedPaths.has(image.path));
        if (allSelected) {
            visibleImages.forEach(image => this.selectedPaths.delete(image.path));
        } else {
            visibleImages.forEach(image => this.selectedPaths.add(image.path));
        }
        this.refreshSelectionUI();
    }

    openPreview(index) {
        const image = this.images[index];
        if (!image) return;
        const isVideo = image.mediaType === 'video';
        this.previewOpen = true;
        const root = (document.querySelector('.phone-view-current') || document).querySelector('.album-app');
        root?.querySelector('.album-preview')?.remove();

        const overlay = document.createElement('div');
        overlay.className = 'album-preview';
        overlay.innerHTML = `
            <div class="album-preview-panel">
                <div class="album-preview-top">
                    <button type="button" class="album-preview-close" aria-label="关闭">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                    <button type="button" class="album-preview-delete" aria-label="删除">
                        <i class="fa-regular fa-trash-can"></i>
                    </button>
                </div>
                <div class="album-preview-image-wrap${isVideo ? ' is-video' : ''}">
                    ${isVideo
                        ? `<video class="album-preview-video" src="${this.escapeAttr(image.src)}" playsinline webkit-playsinline preload="auto"></video><button type="button" class="album-preview-video-replay" aria-label="重新播放视频" title="重新播放视频" hidden><i class="fa-solid fa-play"></i></button>`
                        : `<img class="album-preview-image" src="${this.escapeAttr(image.src)}" alt="">`}
                </div>
                <div class="album-preview-meta">
                    <div class="album-preview-name">${this.escapeHtml(image.filename)}</div>
                    <div class="album-preview-path">${this.escapeHtml(image.path)}</div>
                    <div class="album-preview-tags">
                        ${image.sources.slice(0, 4).map(source => `<span>${this.escapeHtml(source)}</span>`).join('')}
                    </div>
                </div>
            </div>
        `;

        root?.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closePreview();
        });
        overlay.querySelector('.album-preview-close')?.addEventListener('click', () => this.closePreview());
        overlay.querySelector('.album-preview-delete')?.addEventListener('click', () => this.deleteImage(image));

        if (isVideo) {
            const video = overlay.querySelector('.album-preview-video');
            const replayBtn = overlay.querySelector('.album-preview-video-replay');
            const setReplayVisible = visible => {
                if (!replayBtn) return;
                replayBtn.hidden = !visible;
            };
            const playOnce = () => {
                if (!video) return;
                video.loop = false;
                try {
                    video.currentTime = 0;
                } catch (e) { }
                setReplayVisible(false);
                const playPromise = video.play?.();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch(() => setReplayVisible(true));
                }
            };
            video?.addEventListener('playing', () => setReplayVisible(false));
            video?.addEventListener('ended', () => setReplayVisible(true));
            video?.addEventListener('error', () => setReplayVisible(true));
            replayBtn?.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                playOnce();
            });
            playOnce();
        }
    }

    closePreview() {
        this.previewOpen = false;
        this.pausePreview();
        document.querySelectorAll('.album-preview').forEach(preview => preview.remove());
    }

    pausePreview() {
        document.querySelectorAll('.album-preview-video').forEach(video => video.pause?.());
        document.querySelectorAll('.album-preview-video-replay').forEach(button => {
            button.hidden = false;
        });
    }

    async deleteImage(image) {
        if (!image || this.isDeleting || this.isBulkDeleting) return;
        this.isDeleting = true;
        const isVideo = image.mediaType === 'video';
        const ok = window.confirm(`删除这个${isVideo ? '视频' : '图片'}吗？引用它的页面或记录也会清空。`);
        if (!ok) {
            this.isDeleting = false;
            return;
        }

        const deleteBtn = (document.querySelector('.phone-view-current') || document).querySelector('.album-preview-delete');
        if (deleteBtn) deleteBtn.disabled = true;
        try {
            const result = await this.app.albumData.deleteImage(image.path);
            this.app.phoneShell?.showNotification?.('相册', result.message || `${isVideo ? '视频' : '图片'}已删除`, isVideo ? '🎬' : '🖼️');
        } catch (e) {
            console.error('删除相册媒体失败:', e);
            this.app.phoneShell?.showNotification?.('相册', '删除失败', '⚠️');
        } finally {
            this.isDeleting = false;
        }
        this.previewOpen = false;
        this.render();
    }

    async deleteSelectedImages() {
        if (this.isBulkDeleting || this.isDeleting) return;
        const selected = this.images.filter(image => this.selectedPaths.has(image.path));
        if (selected.length === 0) return;
        const ok = window.confirm(`删除选中的 ${selected.length} 个项目吗？引用它们的页面或记录也会清空。`);
        if (!ok) return;

        const deleteBtn = (document.querySelector('.phone-view-current') || document).querySelector('#album-delete-selected');
        if (deleteBtn) deleteBtn.disabled = true;
        this.isBulkDeleting = true;
        try {
            const result = await this.app.albumData.deleteImages(selected.map(image => image.path));
            this.app.phoneShell?.showNotification?.('相册', `已删除 ${result.successCount} 个项目`, '🗑️');
        } catch (e) {
            console.error('批量删除相册媒体失败:', e);
            this.app.phoneShell?.showNotification?.('相册', '批量删除失败', '⚠️');
        } finally {
            this.isBulkDeleting = false;
            this.selectionMode = false;
            this.selectedPaths.clear();
            this.render();
        }
    }

    getPrimarySource(image) {
        return this.app.albumData.getImageSourceLabel(image);
    }

    escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    escapeAttr(text) {
        return this.escapeHtml(text).replace(/`/g, '&#96;');
    }
}
