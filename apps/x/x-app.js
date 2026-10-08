/* ========================================================
 *  Yuzuki Phone
 *  X app controller - visual prototype
 * ======================================================== */

import { XData } from './x-data.js?v=20261009-unified-sse-parser';
import { XView } from './x-view.js?v=20261009-unified-sse-parser';

export class XApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage || null;
        this._cssRenderPending = false;
        this._cssFallbackTimer = null;
        this._swipeHandler = (event) => this.handleSwipeBack(event);

        this._preloadCSS();
        this.xData = new XData(this.storage);
        this.view = new XView(this);
        window.addEventListener('phone:swipeBack', this._swipeHandler);
    }

    attachRuntime(phoneShell = this.phoneShell, storage = this.storage) {
        if (phoneShell) this.phoneShell = phoneShell;
        if (storage) {
            this.storage = storage;
            this.xData.attachStorage(storage);
        }
        return this;
    }

    _preloadCSS() {
        if (document.getElementById('xapp-css')) return;

        const link = document.createElement('link');
        link.id = 'xapp-css';
        link.rel = 'stylesheet';
        link.href = new URL('./x.css?v=20261009-unified-sse-parser', import.meta.url).href;
        document.head.appendChild(link);
    }

    render() {
        const cssLink = document.getElementById('xapp-css');
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
                this.view.render();
            };

            cssLink.addEventListener('load', renderAfterCSS, { once: true });
            cssLink.addEventListener('error', renderAfterCSS, { once: true });
            this._cssFallbackTimer = setTimeout(renderAfterCSS, 1200);
            return;
        }

        this.view.render();
    }

    handleSwipeBack(event) {
        const currentLayer = document.querySelector('.phone-view-current');
        if (!currentLayer?.querySelector('.xapp-root')) return false;

        if (event?.detail && typeof event.detail === 'object') {
            event.detail.handled = true;
        }

        if (this.view.closeAIParseFailure?.()) return true;
        if (this.view.closePostMenu()) return true;
        if (this.view.closeForwardDialog()) return true;

        if (this.view.returnToDirectMessageList()) return true;

        if (this.view.currentPage === 'detail') {
            this.view.returnFromDetail();
            return true;
        }

        if (this.view.currentPage === 'compose') {
            this.view.returnFromCompose();
            return true;
        }

        if (this.view.currentPage === 'profile') {
            this.view.returnFromProfile();
            return true;
        }

        if (this.view.currentPage === 'settings') {
            this.view.returnFromSettings();
            return true;
        }

        window.dispatchEvent(new CustomEvent('phone:goHome'));
        return true;
    }

    clearCache() {
        this.view.closeAIParseFailure?.();
        this.view.closePostMenu();
        this.view.closeForwardDialog();
        this.xData.clearCache();
        this.view.currentPage = 'home';
        this.view.currentPostId = null;
        this.view.currentPostSource = 'feed';
        this.view.detailReturnPage = 'home';
        this.view.composeReturnPage = 'home';
        this.view.pendingComposeImages = [];
        this.view.composeUploadInProgress = false;
        this.view.composeSessionId += 1;
        this.view.currentReplyCommentId = null;
        this.view.activeDirectMessageId = null;
        this.view._sendingDirectMessageThreadIds?.clear?.();
        this.view._pendingReactionPostIds?.clear?.();
        this.view._loadingMorePostIds?.clear?.();
        this.view._pendingCommentReactionIds?.clear?.();
        this.view._visibleUserPostIds?.clear?.();
    }

    destroy() {
        this.view.closeAIParseFailure?.();
        this.view.closePostMenu();
        this.view.closeForwardDialog();
        this.view._sendingDirectMessageThreadIds?.clear?.();
        this.view._pendingReactionPostIds?.clear?.();
        this.view._loadingMorePostIds?.clear?.();
        this.view._pendingCommentReactionIds?.clear?.();
        window.removeEventListener('phone:swipeBack', this._swipeHandler);
    }
}
