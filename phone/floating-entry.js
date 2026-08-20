const FLOATING_ROOT_ID = 'phone-floating-entry-root';
const FLOATING_BUTTON_ID = 'phone-floating-entry-button';

export const PHONE_FLOATING_ENTRY_ENABLED_KEY = 'phone-floating-entry-enabled';
export const PHONE_FLOATING_ENTRY_STYLE_KEY = 'phone-floating-entry-style';
export const PHONE_FLOATING_ENTRY_POSITION_KEY = 'phone-floating-entry-position';
export const PHONE_FLOATING_ENTRY_DEFAULT_STYLE = 'silver';

export const PHONE_FLOATING_ENTRY_STYLES = Object.freeze([
    { id: 'gold', label: '金色', file: 'phone/xfjs.png' },
    { id: 'blue', label: '蓝色', file: 'phone/xfls.png' },
    { id: 'green', label: '绿色', file: 'phone/xflvs.png' },
    { id: 'silver', label: '银色', file: 'phone/xfys.png' },
    { id: 'purple', label: '紫色', file: 'phone/xfzs.png' },
    { id: 'black', label: '黑色', file: 'phone/xfhs.png' }
]);

const FLOATING_STYLE_MAP = new Map(PHONE_FLOATING_ENTRY_STYLES.map(item => [item.id, item]));

function isEnabledValue(value) {
    return value === true || value === 'true' || value === 1;
}

function normalizeStyle(value) {
    const style = String(value || '').trim();
    return FLOATING_STYLE_MAP.has(style) ? style : PHONE_FLOATING_ENTRY_DEFAULT_STYLE;
}

export class PhoneFloatingEntry {
    constructor(options = {}) {
        this.storage = options.storage || null;
        this.baseUrl = options.baseUrl || './';
        this.onActivate = typeof options.onActivate === 'function' ? options.onActivate : () => {};
        this.isPanelOpen = typeof options.isPanelOpen === 'function' ? options.isPanelOpen : () => false;
        this.resizeController = null;
        this.visibilityTimer = null;
        this._onPanelVisibility = event => {
            const open = event?.detail?.open;
            this.updateVisibility(typeof open === 'boolean' ? open : null);
        };
        this._onSettingsChanged = () => this.sync();
    }

    isEnabled() {
        return isEnabledValue(this.storage?.get?.(PHONE_FLOATING_ENTRY_ENABLED_KEY, false));
    }

    getStyle() {
        return normalizeStyle(this.storage?.get?.(PHONE_FLOATING_ENTRY_STYLE_KEY, PHONE_FLOATING_ENTRY_DEFAULT_STYLE));
    }

    isMobileViewport() {
        if (typeof window === 'undefined') return false;
        if (typeof window.matchMedia === 'function'
            && window.matchMedia('(max-width: 600px), (pointer: coarse)').matches) {
            return true;
        }
        return Number(window.innerWidth) <= 600;
    }

    getRoot() {
        let root = document.getElementById(FLOATING_ROOT_ID);
        if (root) return root;

        root = document.createElement('div');
        root.id = FLOATING_ROOT_ID;
        (document.body || document.documentElement).appendChild(root);
        return root;
    }

    readPosition() {
        const raw = this.storage?.get?.(PHONE_FLOATING_ENTRY_POSITION_KEY, null);
        if (!raw) return null;
        try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const left = Number(parsed?.left);
            const top = Number(parsed?.top);
            if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
            return {
                left,
                top,
                mode: parsed?.mode === 'mobile' || parsed?.mode === 'desktop' ? parsed.mode : null,
                source: parsed?.source === 'user' || parsed?.source === 'default' ? parsed.source : null
            };
        } catch {
            return null;
        }
    }

    shouldUseSavedPosition(saved) {
        if (!saved) return false;
        if (!this.isMobileViewport()) {
            // 移动端的默认坐标不是桌面端的有效位置；用户拖动过的坐标仍可跨端保留。
            return saved.mode !== 'mobile' || saved.source === 'user';
        }
        // 老版本没有 mode/source，或是桌面端留下的默认坐标，移动端统一迁移到视口边缘。
        return saved.mode === 'mobile' && saved.source === 'user';
    }

    savePosition(left, top, options = {}) {
        const payload = JSON.stringify({
            left: Math.round(left),
            top: Math.round(top),
            mode: this.isMobileViewport() ? 'mobile' : 'desktop',
            source: options.source === 'default' ? 'default' : 'user'
        });
        Promise.resolve(this.storage?.set?.(PHONE_FLOATING_ENTRY_POSITION_KEY, payload)).catch(error => {
            console.warn('[VirtualPhone] 保存悬浮图标位置失败:', error);
        });
    }

    getViewport(button = null) {
        const rect = button?.getBoundingClientRect?.();
        const defaultSize = this.isMobileViewport() ? 46 : 52;
        const fallbackSize = Math.max(44, Math.round(Math.max(rect?.width || 0, rect?.height || 0, defaultSize)));
        const viewport = window.visualViewport;
        return {
            left: Math.max(0, Number(viewport?.offsetLeft) || 0),
            top: Math.max(0, Number(viewport?.offsetTop) || 0),
            width: Math.max(fallbackSize, Number(viewport?.width) || window.innerWidth || document.documentElement.clientWidth || fallbackSize),
            height: Math.max(fallbackSize, Number(viewport?.height) || window.innerHeight || document.documentElement.clientHeight || fallbackSize),
            size: fallbackSize
        };
    }

    clampPosition(left, top, button = null) {
        const viewport = this.getViewport(button);
        const margin = this.isMobileViewport() ? 0 : 8;
        const minLeft = viewport.left + margin;
        const minTop = viewport.top + margin;
        const maxLeft = Math.max(minLeft, viewport.left + viewport.width - viewport.size - margin);
        const maxTop = Math.max(minTop, viewport.top + viewport.height - viewport.size - margin);
        return {
            left: Math.max(minLeft, Math.min(maxLeft, Number(left) || minLeft)),
            top: Math.max(minTop, Math.min(maxTop, Number(top) || minTop))
        };
    }

    applyPosition(button, left, top, options = {}) {
        if (!button) return;
        const next = this.clampPosition(left, top, button);
        button.style.left = `${next.left}px`;
        button.style.top = `${next.top}px`;
        button.style.right = 'auto';
        button.style.bottom = 'auto';
        if (options.persist) this.savePosition(next.left, next.top, options);
    }

    position(button) {
        const saved = this.readPosition();
        if (this.shouldUseSavedPosition(saved)) {
            this.applyPosition(button, saved.left, saved.top);
            return;
        }

        const viewport = this.getViewport(button);
        const mobile = this.isMobileViewport();
        const margin = mobile ? 0 : 14;
        const shouldPersistMobileDefault = mobile
            && (!saved || saved.mode !== 'mobile' || saved.source !== 'default');
        let left = viewport.left + viewport.width - viewport.size - margin;
        const top = viewport.top + Math.round(viewport.height * 0.72);
        if (!mobile) {
            const chatArea = document.querySelector('#sheld') || document.querySelector('#chat');
            const chatRect = chatArea?.getBoundingClientRect?.();
            if (chatRect?.width > 0 && chatRect.right > viewport.size && chatRect.right <= viewport.left + viewport.width + 1) {
                left = chatRect.right - viewport.size - margin;
            }
        }
        this.applyPosition(button, left, top, {
            persist: shouldPersistMobileDefault,
            source: 'default'
        });
    }

    ensureVisible(button = document.getElementById(FLOATING_BUTTON_ID)) {
        if (!button?.isConnected || button.hidden) return;
        const saved = this.readPosition();
        if (this.isMobileViewport() && !this.shouldUseSavedPosition(saved)) {
            this.position(button);
            return;
        }
        const rect = button.getBoundingClientRect();
        const viewport = this.getViewport(button);
        const outside = rect.right < viewport.left
            || rect.left > viewport.left + viewport.width
            || rect.bottom < viewport.top
            || rect.top > viewport.top + viewport.height;
        if (outside) {
            if (this.shouldUseSavedPosition(saved)) this.applyPosition(button, saved.left, saved.top, { persist: true, source: 'user' });
            else this.position(button);
            return;
        }
        this.applyPosition(button, rect.left, rect.top);
    }

    updateImage(button = document.getElementById(FLOATING_BUTTON_ID)) {
        const image = button?.querySelector?.('.phone-floating-entry-image');
        if (!image) return;
        const style = FLOATING_STYLE_MAP.get(this.getStyle()) || FLOATING_STYLE_MAP.get(PHONE_FLOATING_ENTRY_DEFAULT_STYLE);
        image.src = new URL(style.file, this.baseUrl).href;
        button.dataset.phoneFloatingStyle = style.id;
        button.title = `打开柚月の手机（${style.label}悬浮图标）`;
    }

    bindDrag(button) {
        let pointerId = null;
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;
        let moved = false;

        const finish = event => {
            if (pointerId === null || event.pointerId !== pointerId) return;
            button.releasePointerCapture?.(pointerId);
            pointerId = null;
            button.classList.remove('phone-floating-entry-dragging');

            if (moved) {
                const rect = button.getBoundingClientRect();
                this.applyPosition(button, rect.left, rect.top, { persist: true });
            } else {
                event.preventDefault();
                event.stopPropagation();
                Promise.resolve(this.onActivate()).catch(error => {
                    console.warn('[VirtualPhone] 悬浮入口打开手机失败:', error);
                });
            }

            window.setTimeout(() => {
                moved = false;
            }, 40);
        };

        button.addEventListener('pointerdown', event => {
            if (event.button !== undefined && event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            pointerId = event.pointerId;
            startX = event.clientX;
            startY = event.clientY;
            const rect = button.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            moved = false;
            button.classList.add('phone-floating-entry-dragging');
            button.setPointerCapture?.(pointerId);
        });

        button.addEventListener('pointermove', event => {
            if (pointerId === null || event.pointerId !== pointerId) return;
            const deltaX = event.clientX - startX;
            const deltaY = event.clientY - startY;
            if (!moved && Math.hypot(deltaX, deltaY) > 8) moved = true;
            if (!moved) return;
            event.preventDefault();
            this.applyPosition(button, startLeft + deltaX, startTop + deltaY);
        });

        button.addEventListener('pointerup', finish);
        button.addEventListener('pointercancel', event => {
            if (pointerId === null || event.pointerId !== pointerId) return;
            button.releasePointerCapture?.(pointerId);
            pointerId = null;
            moved = false;
            button.classList.remove('phone-floating-entry-dragging');
        });
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopImmediatePropagation();
        });
        button.addEventListener('dragstart', event => event.preventDefault());
    }

    createButton() {
        const button = document.createElement('button');
        button.id = FLOATING_BUTTON_ID;
        button.type = 'button';
        button.className = 'phone-floating-entry-button';
        button.setAttribute('aria-label', '打开柚月の手机');

        const image = document.createElement('img');
        image.className = 'phone-floating-entry-image';
        image.alt = '';
        image.draggable = false;
        image.setAttribute('aria-hidden', 'true');
        button.appendChild(image);

        this.updateImage(button);
        this.bindDrag(button);
        return button;
    }

    updateVisibility(panelOpen = null) {
        const button = document.getElementById(FLOATING_BUTTON_ID);
        if (!button) return;
        const hidden = typeof panelOpen === 'boolean' ? panelOpen : !!this.isPanelOpen();
        button.hidden = hidden;
        button.setAttribute('aria-hidden', String(hidden));
        if (!hidden) {
            const saved = this.readPosition();
            if (this.shouldUseSavedPosition(saved)) this.applyPosition(button, saved.left, saved.top);
            else if (this.isMobileViewport()) this.position(button);
            else this.ensureVisible(button);
        }
    }

    mount() {
        const root = this.getRoot();
        let button = document.getElementById(FLOATING_BUTTON_ID);
        if (!button) {
            button = this.createButton();
            root.appendChild(button);
            this.position(button);
        } else if (button.parentElement !== root) {
            root.appendChild(button);
        }
        this.updateImage(button);

        if (!this.resizeController) {
            this.resizeController = new AbortController();
            const signal = this.resizeController.signal;
            const reposition = () => this.ensureVisible(button);
            window.addEventListener('resize', reposition, { passive: true, signal });
            window.visualViewport?.addEventListener?.('resize', reposition, { passive: true, signal });
            window.visualViewport?.addEventListener?.('scroll', reposition, { passive: true, signal });
            window.addEventListener('phone:panelVisibility', this._onPanelVisibility, { signal });
            window.addEventListener('phone:floatingEntrySettingsChanged', this._onSettingsChanged, { signal });
        }

        window.clearInterval(this.visibilityTimer);
        this.visibilityTimer = window.setInterval(() => this.ensureVisible(button), 3000);
        this.updateVisibility();
    }

    unmount() {
        this.resizeController?.abort?.();
        this.resizeController = null;
        window.clearInterval(this.visibilityTimer);
        this.visibilityTimer = null;
        document.getElementById(FLOATING_BUTTON_ID)?.remove();
        const root = document.getElementById(FLOATING_ROOT_ID);
        if (root && !root.childElementCount) root.remove();
    }

    sync() {
        if (this.isEnabled()) this.mount();
        else this.unmount();
    }
}
