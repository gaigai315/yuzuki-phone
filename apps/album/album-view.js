/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

import { PHONE_CONFIG } from '../../config/apps.js';

export const ALBUM_CSS_URL = new URL('./album.css?v=1.2.0&r=20260726-album-media', import.meta.url).href;

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
                            <button type="button" class="album-source-filter" id="album-source-filter" aria-haspopup="menu" aria-expanded="false">
                                <span>分类</span>
                                <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                            </button>
                        `}
                    </div>
                </header>
                ${this.selectionMode ? '' : this.renderSourceMenu(sourceGroups)}
                <main class="album-body">
                    ${this.images.length ? `
                        <div class="album-body-toolbar">
                            <span>${this.escapeHtml(activeSourceLabel)} · ${visibleImages.length} 项</span>
                            <button type="button" id="album-select-toggle">选择</button>
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
