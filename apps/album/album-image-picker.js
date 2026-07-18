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
        this._activeResizeObserver = null;
    }

    loadCSS() {
        if (document.getElementById('album-image-picker-css')) return;
        const link = document.createElement('link');
        link.id = 'album-image-picker-css';
        link.rel = 'stylesheet';
        link.href = new URL('./album-image-picker.css?v=1.0.2', import.meta.url).href;
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

        return this._open((overlay) => {
            overlay.className = 'album-image-picker-overlay';
            overlay.innerHTML = `
                <div class="album-image-picker-panel" role="dialog" aria-modal="true" aria-label="从相册选择头像">
                    <div class="album-image-picker-header">
                        <button type="button" class="album-image-picker-close" data-avatar-picker-close aria-label="关闭">
                            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                        </button>
                        <div class="album-image-picker-title">从相册选择头像</div>
                        <div class="album-image-picker-count">${images.length} 张</div>
                    </div>
                    <div class="album-image-picker-grid">
                        ${images.map((image, index) => `
                            <button type="button" class="album-image-picker-tile" data-album-image-index="${index}" aria-label="选择图片 ${this._escapeAttr(image.filename)}">
                                <img src="${this._escapeAttr(image.src)}" alt="">
                                <span>${this._escapeHtml(this._getSourceLabel(image))}</span>
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;

            overlay.addEventListener('click', (event) => {
                const tile = event.target.closest('[data-album-image-index]');
                if (tile) {
                    const index = Number.parseInt(tile.dataset.albumImageIndex || '', 10);
                    const image = Number.isFinite(index) ? images[index] : null;
                    if (image?.path) this._close(image);
                    return;
                }
                if (event.target === overlay || event.target.closest('[data-avatar-picker-close]')) {
                    this._close(null);
                }
            });

            overlay.querySelectorAll('.album-image-picker-tile img').forEach((img) => {
                img.addEventListener('error', () => {
                    const tile = img.closest('.album-image-picker-tile');
                    if (tile) {
                        tile.disabled = true;
                        tile.classList.add('is-broken');
                    }
                }, { once: true });
            });

            this._watchPickerGridSize(overlay);
        });
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
        this._activeResizeObserver?.disconnect?.();
        this._activeResizeObserver = null;
        this._activeOverlay?.remove();
        this._activeOverlay = null;
        if (resolve) resolve(value);
    }

    _watchPickerGridSize(overlay) {
        requestAnimationFrame(() => {
            if (this._activeOverlay !== overlay) return;
            const grid = overlay.querySelector('.album-image-picker-grid');
            if (!grid) return;

            const syncSize = () => {
                const style = getComputedStyle(grid);
                const paddingX = (Number.parseFloat(style.paddingLeft) || 0)
                    + (Number.parseFloat(style.paddingRight) || 0);
                const columnGap = Number.parseFloat(style.columnGap) || 0;
                const availableWidth = Math.max(0, grid.clientWidth - paddingX - (columnGap * 2));
                const tileSize = Math.max(56, Math.floor(availableWidth / 3));
                grid.style.setProperty('--album-image-picker-tile-size', `${tileSize}px`);
                grid.querySelectorAll('.album-image-picker-tile').forEach((tile) => {
                    tile.style.setProperty('height', `${tileSize}px`, 'important');
                    const image = tile.querySelector('img');
                    image?.style?.setProperty?.('width', '100%', 'important');
                    image?.style?.setProperty?.('height', '100%', 'important');
                    image?.style?.setProperty?.('object-fit', 'cover', 'important');
                });
            };

            syncSize();
            if (typeof ResizeObserver === 'function') {
                this._activeResizeObserver = new ResizeObserver(syncSize);
                this._activeResizeObserver.observe(grid);
            }
        });
    }

    _getSourceLabel(image) {
        const sources = Array.isArray(image?.sources) ? image.sources : [];
        return String(sources[0] || '小手机');
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
