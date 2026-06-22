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
// 手机外壳
import { PHONE_CONFIG } from '../config/apps.js';

export class PhoneShell {
    constructor() {
        this.container = null;
        this.screen = null;
        this.isVisible = false;
        this.currentApp = null;
        // 🎨 左滑关闭手势相关
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.touchCurrentX = 0;
        this.isSwiping = false;
        this.swipeThreshold = 80; // 滑动触发阈值
        // 🔋 电池状态
        this.batteryLevel = 85;
        this.isCharging = false;
        // 🔥 视觉历史栈（滑动返回用）
        this.viewHistory = [];
        // 🔔 通知队列管理
        this.notificationQueue = [];
        this.isShowingNotification = false;
        this.currentNotificationData = null;
        this._lastStatusBarStoryTime = null;
    }

    createInPanel(panelContainer) {
        if (!panelContainer) {
            console.error('❌ 面板容器不存在');
            return;
        }

        this.container = document.createElement('div');
        this.container.className = 'phone-in-panel';

        this.container.innerHTML = `
    <div class="phone-body-panel">
        <!-- 🔥 华为风格：左上角药丸摄像头 -->
        <div class="phone-punch-hole"></div>

        <!-- 🔥 新状态栏：时间在左，信号电量在右 -->
        <div class="phone-statusbar">
            <div class="statusbar-left">
                <span class="time">${this.getCurrentTime()}</span>
            </div>
            <div class="statusbar-right">
                <!-- 🔥 信号强度条（4格） -->
                <div class="signal-bars">
                    <span class="bar bar-1"></span>
                    <span class="bar bar-2"></span>
                    <span class="bar bar-3"></span>
                    <span class="bar bar-4"></span>
                </div>
                <!-- 🔥 竖版电池图标，数字在里面 -->
                <div class="battery-vertical" id="battery-icon">
                    <div class="battery-head-v"></div>
                    <div class="battery-body-v">
                        <div class="battery-level-v" id="battery-level" style="height: ${this.batteryLevel}%"></div>
                        <span class="battery-text-v" id="battery-text">${this.batteryLevel}</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="phone-screen" id="phone-screen"></div>
    </div>
`;

        panelContainer.appendChild(this.container);
        this.screen = this.container.querySelector('.phone-screen');
        this.syncHomeLayoutChromeClass();

        this.bindPanelEvents();
        this.bindSwipeGesture();
        this.startClock();
        this.initBattery();  // 🔋 初始化电池

        return this.container;
    }

    // 🔋 初始化电池API
    async initBattery() {
        try {
            // 尝试使用真实电池API
            if ('getBattery' in navigator) {
                const battery = await navigator.getBattery();
                console.log('🔋 电池API已连接:', battery.level * 100 + '%', battery.charging ? '充电中' : '未充电');
                this.updateBatteryDisplay(battery.level * 100, battery.charging);

                // 监听电池变化
                battery.addEventListener('levelchange', () => {
                    this.updateBatteryDisplay(battery.level * 100, battery.charging);
                });
                battery.addEventListener('chargingchange', () => {
                    this.updateBatteryDisplay(battery.level * 100, battery.charging);
                });
            } else {
                // 不支持Battery API，显示模拟电量
                console.log('🔋 浏览器不支持Battery API，使用模拟值');
                this.updateBatteryDisplay(78, false);  // 显示78%
            }
        } catch (e) {
            // 出错时显示模拟电量
            console.warn('🔋 电池API错误:', e);
            this.updateBatteryDisplay(78, false);  // 显示78%
        }
    }

    // 🔋 更新电池显示
    updateBatteryDisplay(level, charging) {
        this.batteryLevel = Math.round(level);
        this.isCharging = charging;

        // 竖版电池
        const levelElV = this.container?.querySelector('.battery-level-v');
        const textElV = this.container?.querySelector('.battery-text-v');
        const iconElV = this.container?.querySelector('.battery-vertical');

        if (levelElV) {
            levelElV.style.height = `${this.batteryLevel}%`;
            // 根据电量改变颜色
            if (this.batteryLevel <= 20) {
                levelElV.style.background = '#ff3b30';
            } else if (this.batteryLevel <= 50) {
                levelElV.style.background = '#ffcc00';
            } else {
                levelElV.style.background = charging ? '#34c759' : '#4cd964';
            }
        }
        if (textElV) {
            textElV.textContent = this.batteryLevel;
        }
        if (iconElV && charging) {
            iconElV.classList.add('charging');
        } else if (iconElV) {
            iconElV.classList.remove('charging');
        }

        // 旧版横版电池（兼容）
        const levelEl = this.container?.querySelector('#battery-level:not(.battery-level-v)');
        const textEl = this.container?.querySelector('#battery-text:not(.battery-text-v)');
        const iconEl = this.container?.querySelector('#battery-icon:not(.battery-vertical)');

        if (levelEl && !levelEl.classList.contains('battery-level-v')) {
            levelEl.style.width = `${this.batteryLevel}%`;
            if (this.batteryLevel <= 20) {
                levelEl.style.background = '#ff3b30';
            } else if (this.batteryLevel <= 50) {
                levelEl.style.background = '#ffcc00';
            } else {
                levelEl.style.background = charging ? '#34c759' : '#333';
            }
        }
        if (textEl && !textEl.classList.contains('battery-text-v')) {
            textEl.textContent = `${this.batteryLevel}%`;
        }
        if (iconEl && charging && !iconEl.classList.contains('battery-vertical')) {
            iconEl.classList.add('charging');
        } else if (iconEl && !iconEl.classList.contains('battery-vertical')) {
            iconEl.classList.remove('charging');
        }
    }

    // 🎨 绑定左滑关闭手势
    bindSwipeGesture() {
        const phoneBody = this.container.querySelector('.phone-body-panel');
        if (!phoneBody) return;

        // 🔥 滑动目标变量（根据场景动态切换）
        let slideTarget = null;
        const resolveEditableHost = (node) => {
            if (!node || typeof node.closest !== 'function') return null;
            return node.closest('textarea, input, [contenteditable], [contenteditable="plaintext-only"]');
        };
        const isTextEditableElement = (el) => {
            if (!el) return false;
            const tag = String(el.tagName || '').toUpperCase();
            if (tag === 'TEXTAREA') {
                return !el.disabled && !el.readOnly;
            }
            if (tag === 'INPUT') {
                const type = String(el.type || '').toLowerCase() || 'text';
                const textInputTypes = new Set(['text', 'search', 'password', 'email', 'number', 'url', 'tel']);
                return textInputTypes.has(type) && !el.disabled && !el.readOnly;
            }
            return !!el.isContentEditable;
        };
        const resolveGestureControlHost = (node) => {
            if (!node || typeof node.closest !== 'function') return null;
            return node.closest('input[type="range"], [role="slider"], .phone-gesture-control, .games-2048-board, .honey-live-visibility-modal, .mofo-app, #wechat-werewolf-preview-modal');
        };
        const resolveInteractiveHost = (node) => {
            if (!node || typeof node.closest !== 'function') return null;
            return node.closest('button, a, select, option, label, [role="button"], [data-no-swipe-back]');
        };
        const hasActiveSelection = () => {
            const selection = window.getSelection?.();
            return !!selection && !selection.isCollapsed && String(selection).length > 0;
        };

        // 🔥 核心修复 1：移除屏幕宽度限制，全面接管虚拟手机的触摸滑动！
        phoneBody.addEventListener('touchmove', (e) => {
            const target = e.target;
            const touchEditableHost = resolveEditableHost(target);
            const activeEditableHost = resolveEditableHost(document.activeElement);
            const hasFocusedTextInput = !!(activeEditableHost && isTextEditableElement(activeEditableHost) && phoneBody.contains(activeEditableHost));
            if (isTextEditableElement(touchEditableHost) || hasFocusedTextInput) return;
            if (resolveGestureControlHost(target)) return;

            // 动态判断当前手势是否是明显的水平滑动
            let isHorizontalSwipe = false;
            if (e.touches && e.touches.length > 0 && this.touchStartX !== undefined) {
                const deltaX = Math.abs(e.touches[0].clientX - this.touchStartX);
                const deltaY = Math.abs(e.touches[0].clientY - this.touchStartY);
                if (deltaX > deltaY && deltaX > 5) {
                    isHorizontalSwipe = true;
                }
            }

            // 🔥 绝杀：如果是水平右滑，立刻阻止浏览器原生行为，彻底修复平板端返回崩溃问题！
            if (isHorizontalSwipe) {
                if (e.cancelable) e.preventDefault();
                return;
            }

            // 垂直滑动时的可滚动区域白名单
            const scrollableAreas =[
                '.home-dashboard', '.home-app-cluster-scroll',
                '.chat-messages', '#voice-chat-messages', '#video-chat-messages',
                '.wechat-content', '.app-body', '.settings-app', '.app-name-custom-list', '.moments-list',
                '#tab-memory', '.settings-app #tab-memory',
                '#tab-lobby', '.settings-app #tab-lobby', '.phone-lobby-groups-list', '.phone-lobby-characters-list',
                '.contact-list', '.chat-list', '.diary-toc-list', '.diary-page-body', '.diary-photo-back',
                '.diary-settings-body', '.diary-edit-body',
                '.music-settings-body',
                '.honey-gift-picker','.honey-live-gifts-list',
                '.honey-scene-desc', '#honey-ui-scene',
                '.honey-recommend-wrap', '.honey-content', '#honey-custom-video-list',
                '.honey-follow-video-modal-panel', '.honey-follow-video-modal-list',
                '.honey-recharge-modal', '.honey-recharge-panel','#honey-ui-scene-modal','.honey-scene-modal-card',
                '.honey-live-visibility-modal', '.honey-live-visibility-panel',
                '.honey-settings-content', '.honey-prompt-editor', '#honey-prompt-editor',
                '#wallet-eval-modal', '.wallet-eval-modal-panel', '.wallet-eval-modal-body', '.wallet-eval-reasoning',
                '.weibo-app', '.weibo-tab-content', '.weibo-detail-posts', '.weibo-settings-content', '.weibo-detail-page-body',
                '.weibo-profile-wrapper', '.weibo-recommend-container', '.weibo-pull-refresh-indicator',
                '.weibo-forward-overlay', '.weibo-forward-dialog', '.weibo-forward-dialog-compose', '.weibo-forward-list',
                '#wechat-weibo-preview-modal', '#wechat-weibo-preview-modal > div',
                '#wechat-poker-preview-modal', '#wechat-poker-preview-modal > div', '.wechat-poker-preview-body',
                '#wechat-werewolf-preview-modal', '#wechat-werewolf-preview-modal > div', '.wechat-werewolf-preview-body',
                '.wechat-call-transcript-overlay', '.wechat-call-transcript-panel', '.wechat-call-transcript-body',
                '.phone-image-viewer-overlay', '.phone-image-viewer-stage',
                '#st-phone-update-modal', '.st-phone-update-dialog', '.st-phone-update-content', '.st-phone-update-list',
                '#phone-image-preset-export-chooser', '.phone-image-preset-export-dialog', '.phone-image-preset-export-list',
                '.phone-call-history-list', '.phone-call-main', '.phone-call-contacts', '.phone-call-contact-list',
                '.phone-call-transcript', '#phone-call-transcript-messages',
                '.phone-call-settings', '.phone-call-settings-body', '.phone-call-settings-section',
                '.phone-call-prompt-textarea', '#phone-call-call-prompt',
                '.phone-call-active', '.phone-call-messages', '#phone-call-messages', '.phone-call-bottom', '#phone-call-input',
                '.honey-live-gifts', '.honey-live-gifts-list', '.honey-live-bottom',
                '.mofo-app', '.mofo-list-col', '.mofo-detail-col',
                '.mofo-editor-overlay', '.mofo-editor-panel', '.mofo-editor-body',
                '.games-app', '.games-lobby-content', '.games-log', '.games-contact-list', '.games-settings-panel', '.games-worldbook-list', '.games-ai-error-message',
                '.games-werewolf-chat', '.games-werewolf-chat-scroll', '.games-werewolf-contact-list', '.games-werewolf-invite-panel',
                '.games-werewolf-settings-panel', '.games-werewolf-worldbook-list', '.games-werewolf-settings-textarea',
                '.games-werewolf-user-speech', '.games-werewolf-night-targets', '.games-werewolf-wolf-chat', '.games-werewolf-record-panel',
                '.games-werewolf-record-overlay', '.games-werewolf-record-list', '.games-werewolf-record-item',
                '.games-catbox-inventory-overlay', '.games-catbox-inventory-panel', '.games-catbox-inventory-list',
                '.games-catbox-coadopt-overlay', '.games-catbox-coadopt-panel', '.games-catbox-coadopt-list',
                '.games-catbox-letters-overlay', '.games-catbox-letter-paper', '.games-catbox-letter-list',
                '.album-body', '.album-grid', '.album-preview-panel',
                '.yzp-calendar-main', '.yzp-calendar-settings-body', '.yzp-calendar-prompt-editor',
                '.yzp-calendar-memo-list', '.yzp-calendar-add-sheet', '.yzp-calendar-month-sheet', '.yzp-calendar-detail-sheet', '.yzp-calendar-detail-body', '.yzp-calendar-memo-input', '.yzp-calendar-type-menu',
                '#phone-inline-reply-menu-pop', '.inline-reply-tabbar', '.inline-reply-page',
                '#mofo-list-wrap', '#mofo-preview-wrap'
            ];

            const isInScrollableArea = scrollableAreas.some(selector => target.closest(selector));

            // 如果垂直滑动且不在滚动区内，阻止整个网页被拉扯
            if (!isInScrollableArea && e.cancelable) {
                e.preventDefault();
            }
        }, { passive: false });

        // 触摸开始
        phoneBody.addEventListener('touchstart', (e) => {
            if (!e.target?.closest?.('.phone-screen')) {
                this.touchStartX = undefined;
                this.touchStartY = undefined;
                this.touchCurrentX = undefined;
                this.isSwiping = false;
                slideTarget = null;
                return;
            }

            // 🔥 核心修复：输入中（含光标拖拽手柄）时放弃全局滑动判断，避免抢占文本光标拖动
            const touchEditableHost = resolveEditableHost(e.target);
            const activeEditableHost = resolveEditableHost(document.activeElement);
            const hasFocusedTextInput = !!(activeEditableHost && isTextEditableElement(activeEditableHost) && phoneBody.contains(activeEditableHost));
            if (isTextEditableElement(touchEditableHost) || hasFocusedTextInput || resolveGestureControlHost(e.target)) {
                this.touchStartX = undefined;
                return;
            }

            const touch = e.touches[0];
            this.touchStartX = touch.clientX;
            this.touchStartY = touch.clientY;
            this.touchCurrentX = touch.clientX;
            this.isSwiping = false;
            slideTarget = null;
        }, { passive: false });

        // 触摸移动
        phoneBody.addEventListener('touchmove', (e) => {
            if (!Number.isFinite(this.touchStartX) || !e.target?.closest?.('.phone-screen')) return;
            const touch = e.touches[0];
            this.touchCurrentX = touch.clientX;
            const deltaX = this.touchCurrentX - this.touchStartX;
            const deltaY = Math.abs(touch.clientY - this.touchStartY);

            // 🔥 计算相对于手机的位置
            const phoneRect = phoneBody.getBoundingClientRect();
            const relativeStartX = this.touchStartX - phoneRect.left;
            const relativeStartY = this.touchStartY - phoneRect.top;
            const phoneWidth = phoneRect.width;
            const phoneHeight = phoneRect.height;

            // 🔥 确保触摸起始点在手机屏幕内
            const isInsidePhone = relativeStartX >= 0 && relativeStartX <= phoneWidth &&
                                  relativeStartY >= 0 && relativeStartY <= phoneHeight;

            if (!isInsidePhone) return;

            // 🔥 修复卡死Bug：通过历史栈精准判断，防止底层垫片干扰
            const isHome = this.isAtHomeScreen();

            // 🔥 滑动条件：
            // - 主屏幕：从左边缘1/3区域开始右滑 → 关闭手机
            // - APP内：从左边缘1/2区域开始右滑 → 返回上一级
            const triggerZone = isHome ? phoneWidth / 3 : phoneWidth / 2;

            if (relativeStartX < triggerZone && deltaX > 20 && deltaX > deltaY) {
                // 标记滑动类型：主屏幕关闭手机，APP内返回
                this.isSwiping = true;
                this.swipeAction = isHome ? 'close' : 'back';
                e.stopPropagation();

                // 🔥 动态获取滑动目标：back时只滑动屏幕内容，close时滑动整个手机
                slideTarget = this.swipeAction === 'back'
                    ? (this.container.querySelector('.phone-view-current') || this.container.querySelector('.phone-screen > div'))
                    : phoneBody;

                // 🔥 阻止原生手势冲突
                if (e.cancelable) e.preventDefault();

                // 🔥 添加滑动视觉反馈
                if (slideTarget) {
                    const progress = Math.min(deltaX / this.swipeThreshold, 1);
                    slideTarget.style.transform = `translate3d(${deltaX * 0.85}px, 0, 0)`;
                    // 只有关闭手机时才改变透明度
                    if (this.swipeAction === 'close') {
                        slideTarget.style.opacity = 1 - (progress * 0.5);
                    }
                }
            }
        }, { passive: false });

        // 触摸结束
        phoneBody.addEventListener('touchend', (e) => {
            if (!Number.isFinite(this.touchStartX)) return;
            const deltaX = this.touchCurrentX - this.touchStartX;

            // 🔥 保存引用，防止 setTimeout 回调时变量已被重置
            const target = slideTarget;
            const action = this.swipeAction;

            if (this.isSwiping && target && deltaX > this.swipeThreshold) {
                if (action === 'close') {
                    // 🔥 主屏幕：滑动关闭手机
                    target.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out';
                    target.style.transform = 'translate3d(100px, 0, 0)';
                    target.style.opacity = '0';

                    setTimeout(() => {
                        // 关闭抽屉
                        const drawerIcon = document.getElementById('phoneDrawerIcon');
                        const drawerPanel = document.getElementById('phone-panel');
                        if (drawerIcon && drawerPanel) {
                            drawerPanel.classList.remove('openDrawer', 'phone-panel-open', 'drawer-content', 'fillRight');
                            drawerPanel.classList.add('phone-panel-hidden');
                            drawerPanel.style.cssText = 'display:none !important; visibility:hidden !important; opacity:0 !important; pointer-events:none !important; position:absolute !important; width:0 !important; height:0 !important; overflow:hidden !important;';
                        }
                        // 重置样式
                        if (target) {
                            target.style.transition = '';
                            target.style.transform = '';
                            target.style.opacity = '';
                        }
                    }, 300);
                } else if (action === 'back') {
                    // 🔥 APP内：页面滑出屏幕右侧，像真实手机一样
                    target.style.transition = 'transform 0.25s ease-out';
                    target.style.transform = 'translate3d(100%, 0, 0)';

                    this._dispatchSwipeBackWithFallback(target);
                }
            } else if (this.isSwiping && target) {
                // 滑动距离不够，回弹恢复原位
                this._resetSwipeLayer(target, { animate: true, resetOpacity: action === 'close' });
            }

            this.isSwiping = false;
            this.swipeAction = null;
            slideTarget = null;
        }, { passive: true });

        phoneBody.addEventListener('touchcancel', () => {
            if (slideTarget) {
                this._resetSwipeLayer(slideTarget, { animate: true, resetOpacity: this.swipeAction === 'close' });
            }
            this.isSwiping = false;
            this.swipeAction = null;
            slideTarget = null;
        }, { passive: true });

        // Pointer 支持（PC端模拟）
        let pointerStartX = 0;
        let pointerStartY = 0;
        let pointerCurrentX = 0;
        let activeSwipePointerId = null;
        let isPointerDown = false;
        let pointerSlideTarget = null;

        phoneBody.addEventListener('pointerdown', (e) => {
            if (e.pointerType && e.pointerType !== 'mouse') return;
            if (e.button !== undefined && e.button !== 0) return;
            if (!e.target?.closest?.('.phone-screen')) {
                isPointerDown = false;
                pointerSlideTarget = null;
                return;
            }

            const pointerEditableHost = resolveEditableHost(e.target);
            if (isTextEditableElement(pointerEditableHost) || resolveGestureControlHost(e.target) || resolveInteractiveHost(e.target)) {
                isPointerDown = false;
                return;
            }

            activeSwipePointerId = e.pointerId;
            pointerStartX = e.clientX;
            pointerStartY = e.clientY;
            pointerCurrentX = e.clientX;
            isPointerDown = true;
            pointerSlideTarget = null;
            this.isSwiping = false;
            this.swipeAction = null;
        });

        document.addEventListener('pointermove', (e) => {
            if (!isPointerDown || activeSwipePointerId !== e.pointerId) return;
            if (document.getElementById('phone-panel')?.classList?.contains('phone-panel-desktop-dragging')) {
                isPointerDown = false;
                this.isSwiping = false;
                this.swipeAction = null;
                pointerSlideTarget = null;
                activeSwipePointerId = null;
                return;
            }
            const deltaX = e.clientX - pointerStartX;
            const deltaY = Math.abs(e.clientY - pointerStartY);
            pointerCurrentX = e.clientX;

            const phoneRect = phoneBody.getBoundingClientRect();
            const relativeStartX = pointerStartX - phoneRect.left;
            const relativeStartY = pointerStartY - phoneRect.top;
            const phoneWidth = phoneRect.width;
            const phoneHeight = phoneRect.height;
            const isInsidePhone = relativeStartX >= 0 && relativeStartX <= phoneWidth &&
                                  relativeStartY >= 0 && relativeStartY <= phoneHeight;

            if (!isInsidePhone) return;

            const isHome = this.isAtHomeScreen();
            if (e.pointerType === 'mouse' && isHome) return;

            const triggerZone = e.pointerType === 'mouse'
                ? (isHome ? phoneWidth / 3 : phoneWidth / 2)
                : (isHome ? phoneWidth / 3 : phoneWidth / 2);

            if (hasActiveSelection()) {
                isPointerDown = false;
                this.isSwiping = false;
                this.swipeAction = null;
                pointerSlideTarget = null;
                activeSwipePointerId = null;
                return;
            }

            if (relativeStartX < triggerZone && deltaX > 18 && deltaX > deltaY) {
                this.isSwiping = true;
                this.swipeAction = isHome ? 'close' : 'back';
                e.preventDefault();
                e.stopPropagation();

                pointerSlideTarget = this.swipeAction === 'back'
                    ? (this.container.querySelector('.phone-view-current') || this.container.querySelector('.phone-screen > div'))
                    : phoneBody;

                if (pointerSlideTarget) {
                    const progress = Math.min(deltaX / this.swipeThreshold, 1);
                    pointerSlideTarget.style.transform = `translate3d(${deltaX * 0.85}px, 0, 0)`;
                    if (this.swipeAction === 'close') {
                        pointerSlideTarget.style.opacity = 1 - (progress * 0.5);
                    }
                }
            }
        });

        document.addEventListener('pointerup', (e) => {
            if (!isPointerDown || activeSwipePointerId !== e.pointerId) return;
            isPointerDown = false;
            const deltaX = pointerCurrentX - pointerStartX;

            const target = pointerSlideTarget;
            const action = this.swipeAction;

            if (this.isSwiping && target && deltaX > this.swipeThreshold) {
                e.preventDefault();
                e.stopPropagation();
                if (action === 'close') {
                    // 🔥 主屏幕：滑动关闭手机
                    target.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out';
                    target.style.transform = 'translate3d(100px, 0, 0)';
                    target.style.opacity = '0';

                    setTimeout(() => {
                        const drawerIcon = document.getElementById('phoneDrawerIcon');
                        const drawerPanel = document.getElementById('phone-panel');
                        if (drawerIcon && drawerPanel) {
                            drawerPanel.classList.remove('openDrawer', 'phone-panel-open', 'drawer-content', 'fillRight');
                            drawerPanel.classList.add('phone-panel-hidden');
                            drawerPanel.style.cssText = 'display:none !important; visibility:hidden !important; opacity:0 !important; pointer-events:none !important; position:absolute !important; width:0 !important; height:0 !important; overflow:hidden !important;';
                        }
                        if (target) {
                            target.style.transition = '';
                            target.style.transform = '';
                            target.style.opacity = '';
                        }
                    }, 300);
                } else if (action === 'back') {
                    // 🔥 APP内：页面滑出屏幕右侧
                    target.style.transition = 'transform 0.25s ease-out';
                    target.style.transform = 'translate3d(100%, 0, 0)';

                    this._dispatchSwipeBackWithFallback(target);
                }
            } else if (this.isSwiping && target) {
                // 滑动距离不够，回弹恢复原位
                this._resetSwipeLayer(target, { animate: true, resetOpacity: action === 'close' });
            }

            this.isSwiping = false;
            this.swipeAction = null;
            pointerSlideTarget = null;
            activeSwipePointerId = null;
        });

        document.addEventListener('pointercancel', (e) => {
            if (!isPointerDown || activeSwipePointerId !== e.pointerId) return;
            if (pointerSlideTarget) {
                this._resetSwipeLayer(pointerSlideTarget, { animate: true, resetOpacity: this.swipeAction === 'close' });
            }
            isPointerDown = false;
            this.isSwiping = false;
            this.swipeAction = null;
            pointerSlideTarget = null;
            activeSwipePointerId = null;
        });
    }

    _resetSwipeLayer(target, { animate = false, resetOpacity = true } = {}) {
        if (!target || !target.isConnected) return;
        if (animate) {
            target.style.transition = 'transform 0.2s ease-out';
            target.style.transform = 'translate3d(0, 0, 0)';
            if (resetOpacity) target.style.opacity = '1';
            setTimeout(() => {
                if (!target.isConnected) return;
                target.style.transition = '';
                target.style.transform = '';
                if (resetOpacity) target.style.opacity = '';
            }, 220);
            return;
        }
        target.style.transition = '';
        target.style.transform = '';
        if (resetOpacity) target.style.opacity = '';
    }

    _dispatchSwipeBackWithFallback(target) {
        const startViewId = target?.getAttribute?.('data-view-id') || '';
        let poppedView = null;
        setTimeout(() => {
            if (this.viewHistory.length > 1) {
                poppedView = this.viewHistory.pop();
            }
            window.dispatchEvent(new CustomEvent('phone:swipeBack'));

            setTimeout(() => {
                if (!target || !target.isConnected) return;
                const currentView = this.container?.querySelector('.phone-view-current');
                const currentViewId = currentView?.getAttribute?.('data-view-id') || '';
                const transform = String(target.style.transform || '').trim();
                const isStillShifted = !!transform && !/^translate3d\(\s*0(?:px)?\s*,\s*0(?:px)?\s*,\s*0(?:px)?\s*\)$/i.test(transform);
                if (currentView === target && currentViewId === startViewId && isStillShifted) {
                    this._resetSwipeLayer(target, { animate: true, resetOpacity: false });
                    if (poppedView?.id && !this.viewHistory.some(item => item.id === poppedView.id)) {
                        this.viewHistory.push(poppedView);
                    }
                }
            }, 550);
        }, 250);
    }

     bindPanelEvents() {
        // 🔥 初始绑定 Home 指示器
        this.bindHomeIndicator();
        this.bindPhoneInputIsolation();
    }

    bindPhoneInputIsolation() {
        if (!this.container || this.container._phoneInputIsolationBound) return;
        this.container._phoneInputIsolationBound = true;

        const isPhoneEditableTarget = (target) => {
            if (!target || typeof target.closest !== 'function') return false;
            const editable = target.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable]');
            return !!editable && !!editable.closest('.phone-screen');
        };
        const isolate = (event) => {
            if (!isPhoneEditableTarget(event.target)) return;
            event.stopPropagation();
        };
        const updateKeyboardState = (event, active) => {
            if (!isPhoneEditableTarget(event.target)) return;
            this.container?.classList?.toggle?.('phone-keyboard-open', !!active);
            document.body?.classList?.toggle?.('phone-input-active', !!active);
        };
        [
            'beforeinput',
            'input',
            'change',
            'keydown',
            'keyup',
            'keypress',
            'compositionstart',
            'compositionupdate',
            'compositionend',
            'paste',
            'cut',
            'copy'
        ].forEach((eventName) => {
            this.container.addEventListener(eventName, isolate);
        });
        this.container.addEventListener('focusin', (event) => updateKeyboardState(event, true));
        this.container.addEventListener('focusout', (event) => {
            setTimeout(() => {
                const active = document.activeElement;
                if (active && isPhoneEditableTarget(active)) return;
                updateKeyboardState(event, false);
            }, 80);
        });
    }
    
    getCurrentTime() {
    const timeManager = window.VirtualPhone?.timeManager;
    
    if (timeManager) {
        const storyTime = timeManager.getCurrentStoryTime();
        if (storyTime?.time && !storyTime.isReal) {
            this._lastStatusBarStoryTime = storyTime;
            return storyTime.time;
        }
        if (this._lastStatusBarStoryTime?.time) {
            return this._lastStatusBarStoryTime.time;
        }
        return storyTime?.time;
    }
    
    // 降级方案
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}
    
    startClock() {
    // 初始化显示
    this.updateStatusBarTime();

    // 改为30秒更新一次（剧情时间不会秒秒变化）
    let lastTime = this.getCurrentTime();
    setInterval(() => {
        const newTime = this.getCurrentTime();
        if (newTime !== lastTime) {  // 只在时间变化时更新DOM
            lastTime = newTime;
            this.updateStatusBarTime();
        }
    }, 30000);  // 30秒检查一次
}

    // 🔥 强制刷新状态栏时间（供外部调用）
    updateStatusBarTime() {
        const timeEl = this.container?.querySelector('.statusbar-left .time');
        if (timeEl) {
            timeEl.textContent = this.getCurrentTime();
        }
    }

    // 🔥 辅助方法：通过历史栈精准判断是否在主屏幕
    isAtHomeScreen() {
        return this.viewHistory.length <= 1 && (this.viewHistory.length === 0 || this.viewHistory[0].id === 'home');
    }

    goHome() {
        this.currentApp = null;
        this.viewHistory = [];  // 🔥 清空视觉历史栈
        if (window.VirtualPhone) {
            // 返回桌面后短时间屏蔽一次图标点击导致的误 reopen
            window.VirtualPhone._homeReturnGuardUntil = Date.now() + 500;
        }
        window.dispatchEvent(new CustomEvent('phone:goHome'));
    }
    
    toggleScreen() {
        if (this.container) {
            this.container.classList.toggle('screen-off');
        }
    }

    showImageViewer(imageUrl, options = {}) {
        const safeUrl = String(imageUrl || '').trim();
        if (!safeUrl || !this.container) return;
        const allowDownload = options.download !== false;
        const downloadName = this._buildImageViewerDownloadName(options.filename || options.downloadName || 'phone-image');

        const phoneBody = this.container.querySelector('.phone-body-panel') || this.container;
        phoneBody.querySelector('#phone-image-viewer-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'phone-image-viewer-overlay';
        overlay.className = 'phone-image-viewer-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = `
            <button class="phone-image-viewer-close" type="button" aria-label="关闭图片预览">
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            ${allowDownload ? `
                <button class="phone-image-viewer-download" type="button" aria-label="下载图片">
                    <i class="fa-solid fa-download"></i>
                </button>
            ` : ''}
            <div class="phone-image-viewer-stage">
                <img class="phone-image-viewer-img" alt="">
            </div>
        `;

        const img = overlay.querySelector('.phone-image-viewer-img');
        img.src = safeUrl;
        img.alt = String(options.alt || '图片预览');

        const close = () => overlay.remove();
        const closeFromControl = (e) => {
            e?.preventDefault?.();
            e?.stopPropagation?.();
            close();
        };
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target?.classList?.contains('phone-image-viewer-stage')) {
                close();
            }
        });
        const closeBtn = overlay.querySelector('.phone-image-viewer-close');
        closeBtn?.addEventListener('pointerdown', closeFromControl);
        closeBtn?.addEventListener('touchstart', closeFromControl, { passive: false });
        closeBtn?.addEventListener('click', closeFromControl);
        const downloadBtn = overlay.querySelector('.phone-image-viewer-download');
        let lastDownloadTriggerTs = 0;
        let downloadInFlight = false;
        const downloadFromControl = async (e) => {
            e?.preventDefault?.();
            e?.stopPropagation?.();
            const now = Date.now();
            if (downloadInFlight || now - lastDownloadTriggerTs < 800) return;
            lastDownloadTriggerTs = now;
            downloadInFlight = true;
            if (downloadBtn) downloadBtn.disabled = true;
            try {
                await this._downloadImageFromViewer(safeUrl, downloadName);
            } finally {
                downloadInFlight = false;
                if (downloadBtn?.isConnected) {
                    downloadBtn.disabled = false;
                }
            }
        };
        downloadBtn?.addEventListener('click', downloadFromControl);
        overlay.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
        overlay.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });

        phoneBody.appendChild(overlay);
    }

    _buildImageViewerDownloadName(rawName = 'phone-image') {
        const base = String(rawName || 'phone-image')
            .trim()
            .replace(/[\\/:*?"<>|]+/g, '_')
            .replace(/\s+/g, '_')
            .slice(0, 80) || 'phone-image';
        return /\.(?:png|jpe?g|webp|gif)$/i.test(base) ? base : `${base}.png`;
    }

    async _downloadImageFromViewer(imageUrl, filename) {
        const safeUrl = String(imageUrl || '').trim();
        if (!safeUrl) return;
        let objectUrl = '';
        try {
            let href = safeUrl;
            if (!safeUrl.startsWith('data:image/')) {
                const response = await fetch(safeUrl, { credentials: 'include', cache: 'no-store' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const blob = await response.blob();
                objectUrl = URL.createObjectURL(blob);
                href = objectUrl;
            }

            const link = document.createElement('a');
            link.href = href;
            link.download = filename;
            link.rel = 'noopener';
            document.body.appendChild(link);
            link.click();
            link.remove();
            this.showNotification?.('图片', '已触发下载', '⬇️');
        } catch (err) {
            console.warn('[PhoneShell] 图片下载失败，已尝试打开原图:', err);
            window.open(safeUrl, '_blank', 'noopener');
            this.showNotification?.('图片', '浏览器不支持直接下载，已打开原图', 'ℹ️');
        } finally {
            if (objectUrl) {
                setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
            }
        }
    }
    
    _syncChromeThemeForView(viewId = '', html = '') {
        const panel = this.container?.querySelector?.('.phone-body-panel') || document.querySelector('.phone-body-panel');
        if (!panel) return;

        panel.classList.remove('phone-body-panel-honey', 'phone-body-panel-games');

        const safeViewId = String(viewId || '');
        const safeHtml = String(html || '');
        if (safeViewId.startsWith('honey-') || /\bhoney-app\b/.test(safeHtml)) {
            panel.classList.add('phone-body-panel-honey');
            return;
        }
        if (safeViewId.startsWith('games-') || /\bgames-app\b/.test(safeHtml)) {
            panel.classList.add('phone-body-panel-games');
        }
    }

    _scopePhoneFormControls(root) {
        if (!root) return;
        root.querySelectorAll?.('.toggle-switch, .honey-toggle-switch, .phone-call-toggle, .st-phone-toggle-switch').forEach((el) => {
            el.classList.add('st-phone-toggle-switch');
            el.querySelectorAll?.('input[type="checkbox"]').forEach((input) => {
                input.classList.add('st-phone-toggle-input');
            });
        });
        root.querySelectorAll?.('.toggle-slider, .honey-toggle-slider, .phone-call-toggle-slider, .st-phone-toggle-slider').forEach((el) => {
            el.classList.add('st-phone-toggle-slider');
        });
    }

    setContent(html, viewId = null) {
        if (!this.screen) return;
        this.syncHomeLayoutChromeClass();

        // 1. 自动推断 viewId
        if (!viewId) {
            if (/class=["'][^"']*\bhome-screen\b/i.test(html)) viewId = 'home';
            else if (html.includes('class="settings-app"')) viewId = 'settings';
            else {
                const titleMatch = html.match(/class="wechat-header-title"[^>]*>([\s\S]*?)<\/div>/i);
                viewId = titleMatch ? 'view-' + titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'view-' + Math.random().toString(36).substr(2, 5);
            }
        }
        this._syncChromeThemeForView(viewId, html);

        // 2. 维护历史栈
        if (viewId === 'home') this.viewHistory =[];
        const existingIndex = this.viewHistory.findIndex(v => v.id === viewId);
        if (existingIndex !== -1) {
            this.viewHistory.splice(existingIndex + 1); // 后退：弹出顶部多余页面
        } else {
            this.viewHistory.push({ id: viewId }); // 前进：压入新页面
        }

        // 3. 初始化多图层容器
        if (!this.screen.querySelector('.view-stack-container')) {
            this.screen.innerHTML = '<div class="view-stack-container" style="position:relative;width:100%;height:100%;"></div><div class="phone-home-indicator"></div>';
            this.bindHomeIndicator();
        }
        const stack = this.screen.querySelector('.view-stack-container');

        // 4. 获取或创建目标图层
        let targetView = stack.querySelector(`[data-view-id="${viewId}"]`);
        if (!targetView) {
            targetView = document.createElement('div');
            targetView.setAttribute('data-view-id', viewId);
            targetView.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:transparent;overflow:hidden;border-radius:inherit;';
            stack.appendChild(targetView);
        }

        // 5. 终极 DOM Diffing：比对原始字符串，避免浏览器序列化导致的误判！
        const normalize = (str) => str.replace(/diary-view-enter/g, '').replace(/diary-view-exit/g, '').trim();
        const prevRawHtml = targetView.getAttribute('data-raw-html') || '';

        // 只有内容真正改变时才替换 HTML，彻底消灭 Base64 图片的重绘闪烁！
        if (normalize(prevRawHtml) !== normalize(html)) {
            targetView.innerHTML = html;
            // 存下原始生成的 HTML 字符串，作为指纹
            targetView.setAttribute('data-raw-html', html);
        }
        this._scopePhoneFormControls(targetView);

        // 6. 图层 Z-Index 管理（完美的 iOS/微信 原生堆叠效果）
        const allViews = stack.querySelectorAll('[data-view-id]');
        allViews.forEach(v => {
            const id = v.getAttribute('data-view-id');
            const historyIndex = this.viewHistory.findIndex(item => item.id === id);

            if (id === viewId) {
                // 当前置顶页面
                v.className = 'phone-view-layer phone-view-current';
                v.style.display = 'block';
                v.style.zIndex = '10';
                v.style.boxShadow = '-5px 0 20px rgba(0,0,0,0.15)';
                v.style.transform = 'translate3d(0,0,0)';
                v.style.transition = 'none';
                v.style.opacity = '1';
            } else if (historyIndex === this.viewHistory.length - 2) {
                // 上一页（垫在下面，滑动返回时可见）
                v.className = 'phone-view-layer phone-view-prev';
                v.style.display = 'block';
                v.style.zIndex = '5';
                v.style.boxShadow = 'none';
                v.style.transform = 'translate3d(0,0,0)';
                v.style.transition = 'none';
                v.style.opacity = '1';
            } else {
                // 历史深处页面，隐藏节省性能
                v.className = 'phone-view-layer';
                v.style.display = 'none';
            }
        });

        // 7. 垃圾回收：清理被滑走并弹出的孤儿页面
        allViews.forEach(v => {
            const id = v.getAttribute('data-view-id');
            if (!this.viewHistory.find(item => item.id === id)) {
                v.remove(); // 连同背景图缓存一起彻底销毁
            }
        });
        window.VirtualPhone?.refreshGlobalTextColorStyle?.();
    }

    syncHomeLayoutChromeClass() {
        if (!this.container) return;
        const layout = String(window.VirtualPhone?.storage?.get?.('phone-home-layout') || 'icons');
        this.container.classList.toggle('phone-card-home-layout', layout === 'cards');
    }

    // 🔥 绑定 Home 指示器点击事件
    bindHomeIndicator() {
        const homeIndicator = this.screen?.querySelector('.phone-home-indicator');
        if (homeIndicator) {
            homeIndicator.style.cursor = 'pointer';
            homeIndicator.addEventListener('click', () => {
                if (this.isAtHomeScreen()) {
                    // 关闭抽屉
                    const drawerIcon = document.getElementById('phoneDrawerIcon');
                    const drawerPanel = document.getElementById('phone-panel');
                    if (drawerIcon && drawerPanel) {
                        drawerPanel.classList.remove('openDrawer', 'phone-panel-open', 'drawer-content', 'fillRight');
                        drawerPanel.classList.add('phone-panel-hidden');
                        drawerPanel.style.cssText = 'display:none !important; visibility:hidden !important; opacity:0 !important; pointer-events:none !important; position:absolute !important; width:0 !important; height:0 !important; overflow:hidden !important;';
                    }
                } else {
                    this.goHome();
                }
            });
        }
    }
    
    showNotification(title, message, icon = '📱', meta = {}) {
        if (!this.container) return;

        // 提取发件人标识用于防刷屏
        const safeMeta = (meta && typeof meta === 'object') ? meta : {};
        const senderMatch = String(message || '').match(/^(.+?)\s*给你发了/);
        const senderKey = String(safeMeta.senderKey || (senderMatch ? senderMatch[1] : title));

        // 防刷屏1：如果队列中已经在等候这个人的通知，只更新文字内容
        const existingInQueue = this.notificationQueue.find(n => n.senderKey === senderKey);
        if (existingInQueue) {
            existingInQueue.message = message;
            existingInQueue.title = title;
            existingInQueue.meta = safeMeta;
            return;
        }

        // 防刷屏2：如果当前屏幕上正好在显示这个人的通知，直接热更新文字
        if (this.isShowingNotification && this.currentNotificationData?.senderKey === senderKey) {
            const targetContainer = this.container.querySelector('.phone-body-panel') || this.container;
            const currentTitleEl = targetContainer.querySelector('.phone-notification .notification-title');
            const currentMsgEl = targetContainer.querySelector('.phone-notification .notification-message');
            const currentTimeEl = targetContainer.querySelector('.phone-notification .notification-time');
            if (currentTitleEl) {
                currentTitleEl.textContent = String(safeMeta.name || title || '');
            }
            if (currentMsgEl) {
                currentMsgEl.textContent = String(safeMeta.content || message || '');
            }
            if (currentTimeEl) {
                currentTimeEl.textContent = String(safeMeta.timeText || '刚刚');
            }
            return;
        }

        // 推入队列并尝试处理
        this.notificationQueue.push({ title, message, icon, senderKey, meta: safeMeta });
        this.processNotificationQueue();
    }

    processNotificationQueue() {
        if (this.isShowingNotification || this.notificationQueue.length === 0) return;

        this.isShowingNotification = true;
        const data = this.notificationQueue.shift();
        this.currentNotificationData = data;

        // 将 emoji 图标映射为 FontAwesome 图标
        const iconMap = {
            '📱': 'fa-solid fa-mobile-screen',
            '💬': 'fa-solid fa-comment',
            '✅': 'fa-solid fa-check',
            '❌': 'fa-solid fa-xmark',
            '⚠️': 'fa-solid fa-triangle-exclamation',
            '🎵': 'fa-solid fa-music',
            '🌐': 'fa-solid fa-globe',
            '🚧': 'fa-solid fa-wrench',
            '📞': 'fa-solid fa-phone',
            '📵': 'fa-solid fa-phone-slash',
            '📹': 'fa-solid fa-video',
            '⏳': 'fa-solid fa-hourglass-half',
            '🔄': 'fa-solid fa-rotate',
            '📋': 'fa-solid fa-clipboard',
            '🏷️': 'fa-solid fa-tag',
            '📰': 'fa-solid fa-newspaper',
            '📍': 'fa-solid fa-location-dot',
            '🧧': 'fa-solid fa-envelope',
            '🗑️': 'fa-solid fa-trash',
        };
        const faClass = iconMap[data.icon] || 'fa-solid fa-bell';
        const iconHTML = `<i class="${faClass}"></i>`;
        const meta = data.meta || {};
        const useRichLayout = !!(meta.avatar || meta.avatarText || meta.name || meta.content || meta.timeText);

        const notification = document.createElement('div');
        notification.className = `phone-notification${useRichLayout ? ' phone-notification-rich' : ''}`;

        if (useRichLayout) {
            const isLikelyImagePath = (value) => /^(https?:\/\/|data:image\/|\/)/i.test(String(value || '').trim());

            const avatarEl = document.createElement('div');
            avatarEl.className = 'notification-avatar';
            if (meta.avatarBg) avatarEl.style.background = String(meta.avatarBg);
            if (meta.avatarColor) avatarEl.style.color = String(meta.avatarColor);

            const avatarRaw = String(meta.avatar || '').trim();
            if (avatarRaw && isLikelyImagePath(avatarRaw)) {
                const img = document.createElement('img');
                img.onerror = () => {
                    img.remove();
                    if (avatarEl.querySelector('.notification-avatar-text')) return;
                    const avatarText = document.createElement('span');
                    avatarText.className = 'notification-avatar-text';
                    avatarText.textContent = String(meta.avatarText || (meta.isGroup ? Array.from(String(meta.name || '').trim())[0] || '群' : (data.icon === '📱' ? '微' : '👤')));
                    avatarEl.appendChild(avatarText);
                    window.VirtualPhone?.wechatApp?.handleWechatAvatarImageError?.(img, avatarRaw);
                };
                img.src = avatarRaw;
                img.alt = String(meta.name || 'avatar');
                avatarEl.appendChild(img);
            } else {
                const avatarText = document.createElement('span');
                avatarText.className = 'notification-avatar-text';
                avatarText.textContent = avatarRaw || String(meta.avatarText || (meta.isGroup ? Array.from(String(meta.name || '').trim())[0] || '群' : (data.icon === '📱' ? '微' : '👤')));
                avatarEl.appendChild(avatarText);
            }

            const contentEl = document.createElement('div');
            contentEl.className = 'notification-content';

            const headerEl = document.createElement('div');
            headerEl.className = 'notification-header';

            const titleEl = document.createElement('div');
            titleEl.className = 'notification-title';
            titleEl.textContent = String(meta.name || data.title || '');

            const timeEl = document.createElement('div');
            timeEl.className = 'notification-time';
            timeEl.textContent = String(meta.timeText || '刚刚');

            const messageEl = document.createElement('div');
            messageEl.className = 'notification-message';
            messageEl.textContent = String(meta.content || data.message || '');

            headerEl.appendChild(titleEl);
            headerEl.appendChild(timeEl);
            contentEl.appendChild(headerEl);
            contentEl.appendChild(messageEl);
            notification.appendChild(avatarEl);
            notification.appendChild(contentEl);
        } else {
            notification.innerHTML = `
                <div class="notification-icon">${iconHTML}</div>
                <div class="notification-content">
                    <div class="notification-title">${data.title}</div>
                    <div class="notification-message">${data.message}</div>
                </div>
            `;
        }

        const phoneBody = this.container.querySelector('.phone-body-panel');
        const targetContainer = phoneBody || this.container;
        targetContainer.appendChild(notification);

        // 停留 4 秒后执行退出动画
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => {
                notification.remove();
                this.isShowingNotification = false;
                this.currentNotificationData = null;
                // 继续处理队列中的下一个通知
                this.processNotificationQueue();
            }, 300);
        }, 4000);
    }
}
