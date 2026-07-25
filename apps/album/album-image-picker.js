/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

export class AlbumImagePicker {
    constructor(albumData) {
        this.albumData = albumData;
        this._activeOverlay = null;
        this._activeResolve = null;
        this._activeSource = 'all';
    }

    loadCSS() {
        if (document.getElementById('album-image-picker-css')) return;
        const link = document.createElement('link');
        link.id = 'album-image-picker-css';
        link.rel = 'stylesheet';
        link.href = new URL('./album-image-picker.css?v=1.1.0', import.meta.url).href;
        document.head.appendChild(link);
    }

    chooseSource() {
        this.loadCSS();
        return this._open((overlay) => {
            overlay.className = 'album-image-picker-overlay album-image-source-overlay';
            overlay.innerHTML = `
                <div class="album-image-source-sheet" role="dialog" aria-modal="true" aria-label="选择头像来源">
                    <div class="album-image-source-title">选择头像来源</div>
                    <button type="button" class="album-image-source-option" data-avatar-source="album">
                        <i class="fa-regular fa-images" aria-hidden="true"></i>
                        <span>从相册 App 选择</span>
                    </button>
                    <button type="button" class="album-image-source-option" data-avatar-source="device">
                        <i class="fa-solid fa-arrow-up-from-bracket" aria-hidden="true"></i>
                        <span>从设备相册上传</span>
                    </button>
                    <button type="button" class="album-image-source-cancel" data-avatar-picker-close>取消</button>
                </div>
            `;

            overlay.addEventListener('click', (event) => {
                const sourceButton = event.target.closest('[data-avatar-source]');
                if (sourceButton) {
                    this._close(sourceButton.dataset.avatarSource || null);
                    return;
                }
                if (event.target === overlay || event.target.closest('[data-avatar-picker-close]')) {
                    this._close(null);
                }
            });
        });
    }

    chooseImage() {
        this.loadCSS();
        const images = this.albumData?.getImages?.() || [];
        if (images.length === 0) return Promise.resolve(null);
        this._activeSource = 'all';

        return this._open((overlay) => {
            this._renderImagePicker(overlay, images);
        });
    }

    _renderImagePicker(overlay, images) {
        const allGroups = this.albumData?.groupImagesBySource?.(images) || [];
        if (this._activeSource !== 'all' && !allGroups.some(group => group.key === this._activeSource)) {
            this._activeSource = 'all';
        }
        const visibleImages = this._activeSource === 'all'
            ? images
            : images.filter(image => image.sourceKey === this._activeSource);
        const visibleGroups = this.albumData?.groupImagesBySource?.(visibleImages) || [];
        const activeLabel = this._activeSource === 'all'
            ? '全部来源'
            : (this.albumData?.getSourceDefinition?.(this._activeSource)?.label || '全部来源');
        const menuOptions = [
            { key: 'all', label: '全部来源', icon: 'fa-images', images },
            ...allGroups
        ];

        overlay.className = 'album-image-picker-overlay';
        overlay.innerHTML = `
            <div class="album-image-picker-panel" role="dialog" aria-modal="true" aria-label="从相册选择头像">
                <header class="album-image-picker-header">
                    <button type="button" class="album-image-picker-close" data-avatar-picker-close aria-label="关闭">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                    <div class="album-image-picker-title">选择头像</div>
                    <button type="button" class="album-image-picker-filter" aria-haspopup="menu" aria-expanded="false">
                        <span>${this._escapeHtml(activeLabel)}</span>
                        <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                    </button>
                </header>
                <div class="album-image-picker-popover" aria-hidden="true">
                    <button type="button" class="album-image-picker-popover-backdrop" data-picker-source-close aria-label="关闭来源筛选"></button>
                    <div class="album-image-picker-menu" role="menu" aria-label="照片来源">
                        ${menuOptions.map(option => `
                            <button type="button" class="album-image-picker-option${option.key === this._activeSource ? ' is-active' : ''}" data-picker-source="${this._escapeAttr(option.key)}" role="menuitem">
                                ${this._renderSourceBadge(option)}
                                <span class="album-image-picker-option-label">${this._escapeHtml(option.label)}</span>
                                <span class="album-image-picker-option-count">${option.images.length}</span>
                                <i class="fa-solid fa-check album-image-picker-option-check" aria-hidden="true"></i>
                            </button>
                        `).join('')}
                    </div>
                </div>
                <div class="album-image-picker-content">
                    <div class="album-image-picker-summary">${this._escapeHtml(activeLabel)} · ${visibleImages.length} 张</div>
                    <div class="album-image-picker-sections">
                        ${visibleGroups.map(group => {
                            const canFocus = this._activeSource === 'all';
                            const shownImages = canFocus ? group.images.slice(0, 4) : group.images;
                            return `
                                <section class="album-image-picker-section">
                                    <button type="button" class="album-image-picker-source-heading" ${canFocus ? `data-picker-source-focus="${this._escapeAttr(group.key)}"` : 'disabled'}>
                                        ${this._renderSourceBadge(group)}
                                        <span class="album-image-picker-source-copy">
                                            <strong>${this._escapeHtml(group.label)}</strong>
                                            <small>${group.images.length} 张</small>
                                        </span>
                                        ${canFocus ? '<i class="fa-solid fa-chevron-right album-image-picker-source-arrow" aria-hidden="true"></i>' : ''}
                                    </button>
                                    <div class="album-image-picker-grid">
                                        ${shownImages.map(image => {
                                            const index = images.indexOf(image);
                                            return `
                                                <button type="button" class="album-image-picker-tile" data-album-image-index="${index}" aria-label="选择图片 ${this._escapeAttr(image.filename)}">
                                                    <img src="${this._escapeAttr(image.src)}" alt="">
                                                </button>
                                            `;
                                        }).join('')}
                                    </div>
                                </section>
                            `;
                        }).join('')}
                    </div>
                    <div class="album-image-picker-total">共 ${images.length} 张照片</div>
                </div>
            </div>
        `;

        const panel = overlay.querySelector('.album-image-picker-panel');
        const filter = panel?.querySelector('.album-image-picker-filter');
        const popover = panel?.querySelector('.album-image-picker-popover');
        const closePopover = () => {
            popover?.classList.remove('is-open');
            popover?.setAttribute('aria-hidden', 'true');
            filter?.setAttribute('aria-expanded', 'false');
        };

        filter?.addEventListener('click', () => {
            const willOpen = !popover?.classList.contains('is-open');
            popover?.classList.toggle('is-open', willOpen);
            popover?.setAttribute('aria-hidden', String(!willOpen));
            filter.setAttribute('aria-expanded', String(willOpen));
        });
        panel?.querySelector('[data-picker-source-close]')?.addEventListener('click', closePopover);
        panel?.querySelectorAll('[data-picker-source]').forEach(option => {
            option.addEventListener('click', () => {
                this._activeSource = option.dataset.pickerSource || 'all';
                this._renderImagePicker(overlay, images);
            });
        });
        panel?.querySelectorAll('[data-picker-source-focus]').forEach(heading => {
            heading.addEventListener('click', () => {
                this._activeSource = heading.dataset.pickerSourceFocus || 'all';
                this._renderImagePicker(overlay, images);
            });
        });
        panel?.querySelector('[data-avatar-picker-close]')?.addEventListener('click', () => this._close(null));
        panel?.querySelectorAll('[data-album-image-index]').forEach(tile => {
            tile.addEventListener('click', () => {
                const index = Number.parseInt(tile.dataset.albumImageIndex || '', 10);
                const image = Number.isFinite(index) ? images[index] : null;
                if (image?.path) this._close(image);
            });
        });
        panel?.querySelectorAll('.album-image-picker-tile img').forEach(img => {
            img.addEventListener('error', () => {
                const tile = img.closest('.album-image-picker-tile');
                if (tile) {
                    tile.disabled = true;
                    tile.classList.add('is-broken');
                }
            }, { once: true });
        });
        overlay.onclick = event => {
            if (event.target === overlay) this._close(null);
        };
    }

    _renderSourceBadge(source = {}) {
        return `
            <span class="album-image-picker-source-badge is-${this._escapeAttr(source.key || 'other')}">
                <i class="fa-solid ${this._escapeAttr(source.icon || 'fa-images')}" aria-hidden="true"></i>
            </span>
        `;
    }

    close() {
        this._close(null);
    }

    _open(renderOverlay) {
        this._close(null);
        return new Promise((resolve) => {
            const mount = document.querySelector('.phone-view-current')
                || document.querySelector('#phone-panel-content .phone-screen')
                || document.body;
            const overlay = document.createElement('div');
            this._activeOverlay = overlay;
            this._activeResolve = resolve;
            renderOverlay(overlay);
            mount.appendChild(overlay);
        });
    }

    _close(value) {
        const resolve = this._activeResolve;
        this._activeResolve = null;
        this._activeOverlay?.remove();
        this._activeOverlay = null;
        if (resolve) resolve(value);
    }

    _getSourceLabel(image) {
        return this.albumData?.getImageSourceLabel?.(image) || '其他图片';
    }

    _escapeHtml(value = '') {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    _escapeAttr(value = '') {
        return this._escapeHtml(value).replace(/"/g, '&quot;');
    }
}
