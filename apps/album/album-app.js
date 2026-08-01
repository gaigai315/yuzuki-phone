/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

import { AlbumData } from './album-data.js?v=1.4.2&r=20260726-album-media';
import { ALBUM_CSS_URL, AlbumView } from './album-view.js?v=1.4.2&r=20260802-album-toolbar';

export class AlbumApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this._cssRenderPending = false;
        this._cssFallbackTimer = null;

        this._preloadCSS();

        this.albumData = new AlbumData(storage);
        this.albumView = new AlbumView(this);

        window.addEventListener('phone:swipeBack', (e) => this.handleSwipeBack(e));
        window.addEventListener('phone:albumImageDeleted', () => this.refreshIfVisible());
        window.addEventListener('phone:updateWallpaper', () => this.refreshIfVisible());
        window.addEventListener('phone:panelVisibility', event => {
            if (event?.detail?.open === false) this.albumView?.pausePreview?.();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.albumView?.pausePreview?.();
        });
    }

    _preloadCSS() {
        if (document.getElementById('album-css')) return;
        const link = document.createElement('link');
        link.id = 'album-css';
        link.rel = 'stylesheet';
        link.href = ALBUM_CSS_URL;
        document.head.appendChild(link);
    }

    render() {
        const cssLink = document.getElementById('album-css');
        if (cssLink && !cssLink.sheet) {
            if (this._cssRenderPending) return;
            this._cssRenderPending = true;

            const renderAfterCSS = () => {
                if (!this._cssRenderPending) return;
                this._cssRenderPending = false;
                if (this._cssFallbackTimer) {
                    clearTimeout(this._cssFallbackTimer);
                    this._cssFallbackTimer = null;
                }
                this.albumView.render();
            };

            cssLink.addEventListener('load', renderAfterCSS, { once: true });
            cssLink.addEventListener('error', () => {
                console.error('Album CSS failed to load');
                renderAfterCSS();
            }, { once: true });
            this._cssFallbackTimer = setTimeout(renderAfterCSS, 1500);
            return;
        }
        this.albumView.render();
    }

    handleSwipeBack() {
        const domCurrentView = document.querySelector('.phone-view-current');
        if (!domCurrentView?.querySelector?.('.album-app')) return;

        if (this.albumView.previewOpen) {
            this.albumView.closePreview();
            return;
        }

        if (this.albumView.sourceMenuOpen) {
            this.albumView.closeSourceMenu();
            return;
        }

        if (this.albumView.selectionMode) {
            this.albumView.selectionMode = false;
            this.albumView.selectedPaths.clear();
            this.albumView.render();
            return;
        }

        if (this.albumView.activeSource !== 'all') {
            this.albumView.activeSource = 'all';
            this.albumView.render();
            return;
        }

        window.dispatchEvent(new CustomEvent('phone:goHome'));
    }

    refreshIfVisible() {
        if (this.albumView?.isBulkDeleting) return;
        const domCurrentView = document.querySelector('.phone-view-current');
        if (!domCurrentView?.querySelector?.('.album-app')) return;
        this.albumView.render();
    }

    deactivate() {
        this.albumView?.closePreview?.();
    }
}
