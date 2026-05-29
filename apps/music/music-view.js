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
// 🎵 音乐APP - 视图层 (高级 SVG 图标库)
// ========================================

const SVG_NOTE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" opacity="0.4"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>`;
const SVG_PLAY = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const SVG_PAUSE = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
const SVG_PREV = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>`;
const SVG_NEXT = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>`;
const MUSIC_NOTE_SVG = `<svg viewBox="0 0 24 24" width="22" height="22"><defs><linearGradient id="mfg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#a8d8ea"/><stop offset="100%" stop-color="#6db3d8"/></linearGradient></defs><path fill="url(#mfg)" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>`;
const MUSIC_FLOATING_POSITION_KEY = 'global_music_floating_position';
export class MusicView {
    constructor(musicApp) {
        this.app = musicApp;
        this._floatingBtn = null;
        this._floatingPanel = null;
        this._progressTimer = null;
        this._isDragging = false;
        this._cssInjected = false;
        this._isPlaylistCollapsed = false;
        this._currentTab = 'playlist'; // 记录当前在哪个列表
        this._panelFace = 'front'; // front: 播放器正面, back: 社交背面
        this._lyricsRenderKey = '';
        this._lyricsActiveIndex = -1;
        this._lyricsUserScrolling = false;
        this._lyricsScrollTimer = null;
    }

    // 🔥 核心补救：缺失的统一刷新入口
    updateDisplay() {
        if (this._floatingBtn) {
            const iconEl = this._floatingBtn.querySelector('.music-fb-icon');
            if (iconEl) {
                if (this.app.musicData.isPlaying) {
                    iconEl.classList.add('spinning');
                } else {
                    iconEl.classList.remove('spinning');
                }
            }
        }
        if (this._floatingPanel) {
            this._updateFloatingPanelDOM();
        }
    }

    // ========== CSS 注入 ==========

    _injectCSS() {
        const cssHref = new URL('./music.css?v=1.0.4', import.meta.url).href;
        let link = document.getElementById('music-app-style');

        if (link) {
            if (link.href !== cssHref) {
                link.href = cssHref;
            }
            this._cssInjected = true;
            return;
        }

        link = document.createElement('link');
        link.id = 'music-app-style';
        link.rel = 'stylesheet';
        link.href = cssHref;
        document.head.appendChild(link);
        this._cssInjected = true;
    }

    /**
     * 获取悬浮元素的安全容器
     * SillyTavern 可能在 body 上设置 transform/will-change，破坏 position:fixed
     * 创建一个独立容器挂在 documentElement 上，绕过所有 body 级别的 CSS 影响
     */
    _getFloatingContainer() {
        let container = document.getElementById('music-floating-root');
        if (!container) {
            container = document.createElement('div');
            container.id = 'music-floating-root';
            // 🔥 终极无敌 Flexbox 安全舱：占满屏幕，免疫所有变形，专门负责居中
            Object.assign(container.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100vw',
                height: '100vh',
                zIndex: '2147483640',
                pointerEvents: 'none', // 安全舱全透明，不挡鼠标
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end', // 把内容顶到底部
                alignItems: 'center',       // 水平完美居中
                paddingBottom: '80px',      // 距离底部的安全距离
                boxSizing: 'border-box',
                transform: 'none',
                contain: 'none',
            });
            // 🔥 核心修复：挂载到 documentElement (html节点)，彻底逃离 body 容器的魔爪！
            document.documentElement.appendChild(container);
        }
        return container;
    }

    // ========== 核心黑科技：直接从酒馆聊天界面抓取真实头像 ==========
    _getRealAvatarFromDOM() {
        try {
            // 抓取聊天框中，最后一条非用户（即AI角色）消息的头像
            const avatarImgs = document.querySelectorAll('.mes:not([is_user="true"]) .mesAvatarWrapper .avatar img');
            if (avatarImgs.length > 0) {
                return avatarImgs[avatarImgs.length - 1].src;
            }
        } catch (e) {
            console.warn('🎵 [音乐] 抓取酒馆真实头像失败', e);
        }
        return null;
    }

    // ========== A. 设置页 ==========

    renderSettings() {
        this._injectCSS();
        const data = this.app.musicData;
        const storage = this.app.storage;

        const showFloating = storage.get('music_show_floating', false);

        // 获取提示词
        let promptContent = '';
        const pm = window.VirtualPhone?.promptManager;
        if (pm) {
            pm.ensureLoaded();
            promptContent = pm.getPromptForFeature('music', 'recommend') || '';
        }

        const html = `
            <div class="music-app" data-view="music-settings">
                <div class="music-settings">
                    <div class="music-settings-header">
                        <div class="music-settings-header-left">
                            <button class="music-back-btn" id="music-settings-back">
                                <i class="fa-solid fa-chevron-left"></i>
                            </button>
                        </div>
                        <div class="music-settings-header-title">音乐</div>
                        <div class="music-settings-header-right"></div>
                    </div>

                    <div class="music-settings-body">
                        <div class="music-settings-group">
                            <div class="music-settings-group-title">显示设置</div>
                            <div class="music-settings-item">
                                <div>
                                    <div class="music-settings-item-label">显示全局悬浮窗</div>
                                    <div class="music-settings-item-desc">在酒馆页面显示音乐悬浮按钮</div>
                                </div>
                                <div class="music-toggle ${showFloating ? 'active' : ''}" id="music-toggle-floating"></div>
                            </div>
                        </div>

                        <div class="music-settings-group">
                            <div class="music-settings-group-title">歌单管理</div>
                            <button class="music-settings-btn danger" id="music-clear-playlist">清空歌单 (${data.getPlaylist().length} 首)</button>
                        </div>

                        <div class="music-settings-group">
                            <div class="music-settings-group-title">提示词设置</div>
                            <div class="phone-prompt-fold" data-default-open="false">
                                <div class="phone-prompt-fold-header">
                                    <div class="phone-prompt-fold-main">
                                        <div class="phone-prompt-fold-title">🎵 音乐推荐提示词</div>
                                        <div class="phone-prompt-fold-desc">点击展开后可编辑，默认折叠以保持紧凑。</div>
                                    </div>
                                    <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow"></i>
                                </div>
                                <div class="phone-prompt-fold-content">
                                    <div class="music-prompt-area">
                                        ${window.VirtualPhone?.promptManager?.renderPromptPresetControls?.('music', 'recommend') || ''}
                                        <textarea id="music-prompt-textarea">${this._escapeHtml(promptContent)}</textarea>
                                        <div class="music-prompt-actions">
                                            <button class="music-settings-btn primary" id="music-prompt-save" style="flex:1">保存</button>
                                            <button class="music-settings-btn danger" id="music-prompt-reset" style="flex:1">恢复默认</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'music-settings');
        this._bindSettingsEvents();
    }

    _bindSettingsEvents() {
        const screen = this.app.phoneShell.screen;
        if (!screen) return;
        this._bindPromptFoldToggles(screen);
        window.VirtualPhone?.promptManager?.bindPromptPresetControls?.(screen, 'music', 'recommend', '#music-prompt-textarea', {
            notify: (title, message, icon) => this.app.phoneShell.showNotification(title, message, icon)
        });

        // 返回 — 用 onclick 防止重复绑定
        const backBtn = screen.querySelector('#music-settings-back');
        if (backBtn) {
            backBtn.onclick = () => {
                window.dispatchEvent(new CustomEvent('phone:goHome'));
            };
        }

        // 悬浮窗开关
        const floatingToggle = screen.querySelector('#music-toggle-floating');
        if (floatingToggle) {
            floatingToggle.onclick = () => {
                const current = this.app.storage.get('music_show_floating', false);
                const newVal = !current;
                this.app.storage.set('music_show_floating', newVal);
                floatingToggle.classList.toggle('active', newVal);
                if (newVal) {
                    this.renderFloatingWidget();
                } else {
                    this.destroyFloatingWidget();
                    // 🔥 新增：关掉悬浮窗时，立刻掐断后台音乐播放
                    this.app.musicData.pause();
                }
            };
        }
        
        // 清空歌单
        const clearBtn = screen.querySelector('#music-clear-playlist');
        if (clearBtn) {
            clearBtn.onclick = () => {
                this.app.musicData.clearPlaylist();
                clearBtn.textContent = '清空歌单 (0 首)';
                this.app.phoneShell.showNotification('音乐', '歌单已清空', '🎵');
            };
        }

        // 保存提示词
        const saveBtn = screen.querySelector('#music-prompt-save');
        if (saveBtn) {
            saveBtn.onclick = () => {
                const textarea = screen.querySelector('#music-prompt-textarea');
                if (textarea) {
                    const pm = window.VirtualPhone?.promptManager;
                    if (pm) {
                        pm.updateActivePromptUserPreset?.('music', 'recommend', textarea.value) ?? pm.updatePrompt('music', 'recommend', textarea.value);
                        this.app.phoneShell.showNotification('音乐', '提示词已保存', '✅');
                    }
                }
            };
        }

        // 恢复默认提示词
        const resetBtn = screen.querySelector('#music-prompt-reset');
        if (resetBtn) {
            resetBtn.onclick = () => {
                const pm = window.VirtualPhone?.promptManager;
                if (pm) {
                    pm.ensureLoaded();
                    const defaultContent = pm.resetPromptToDefault?.('music', 'recommend')
                        ?? pm.getDefaultPrompts().music?.recommend?.content
                        ?? '';
                    const textarea = screen.querySelector('#music-prompt-textarea');
                    if (textarea) {
                        textarea.value = defaultContent;
                    }
                    this.app.phoneShell.showNotification('音乐', '已恢复默认提示词', '✅');
                }
            };
        }
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

    // ========== C. 悬浮窗 ==========

    renderFloatingWidget() {
        this._injectCSS();

        // 防止重复创建
        if (this._floatingBtn) return;

        // 创建悬浮按钮 —— 关键样式全部内联，不依赖CSS文件
        const btn = document.createElement('div');
        btn.className = 'music-floating-btn';

        // 内联设置所有关键样式，确保即使CSS未加载也能正常显示
        Object.assign(btn.style, {
            position: 'fixed',
            right: '12px',
            bottom: '20vh',
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.35)',
            backdropFilter: 'blur(16px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
            border: '1px solid rgba(255, 255, 255, 0.45)',
            boxShadow: '0 2px 12px rgba(0, 0, 0, 0.12)',
            color: '#7ab8e0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px',
            cursor: 'pointer',
            zIndex: '2147483640',
            userSelect: 'none',
            touchAction: 'none',
            pointerEvents: 'auto',
            visibility: 'visible',
            opacity: '1',
            boxSizing: 'border-box',
            contain: 'none',
        });

        const isPlaying = this.app.musicData.isPlaying;
        btn.innerHTML = `<span class="music-fb-icon ${isPlaying ? 'spinning' : ''}">${MUSIC_NOTE_SVG}</span>`;
        document.body.appendChild(btn);
        this._floatingBtn = btn;

        // 动态定位
        this._positionFloatingBtn(btn);
        this._resizeHandler = () => this._positionFloatingBtn(btn);
        window.addEventListener('resize', this._resizeHandler);

        // 自愈检查：每3秒确认按钮仍在视口内且可见
        this._visibilityGuard = setInterval(() => {
            this._ensureButtonVisible(btn);
        }, 3000);

        // 拖拽 + 点击（统一在pointer事件中处理，兼容移动端）
        this._initDrag(btn, () => {
            // 点击回调：展开/收起面板
            if (this._floatingPanel) {
                this._closePanel();
            } else {
                this._openPanel();
            }
        });
    }

    _positionFloatingBtn(btn) {
        const btnSize = 40;
        const margin = 12;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const savedPosition = this._getSavedFloatingPosition();

        if (savedPosition) {
            this._applyFloatingBtnPosition(btn, savedPosition.left, savedPosition.top, { persist: false });
            this._userDragged = true;
            return;
        }

        // 如果用户已经手动拖拽过，尊重用户选择的位置
        if (this._userDragged) return;

        // 计算目标位置（像素绝对值，不用 right/bottom 避免viewport差异）
        let targetLeft = vw - btnSize - margin;
        let targetTop = vh * 0.8 - btnSize / 2; // 相当于 bottom: 20vh

        // 尝试贴在聊天区域右侧
        const chatArea = document.querySelector('#sheld') || document.querySelector('#chat');
        if (chatArea) {
            const rect = chatArea.getBoundingClientRect();
            if (rect.width > 0 && rect.right > btnSize && rect.right <= vw + 1) {
                targetLeft = rect.right - btnSize - margin;
            }
        }

        this._applyFloatingBtnPosition(btn, targetLeft, targetTop, { persist: false });
    }

    _getSavedFloatingPosition() {
        const raw = this.app?.storage?.get?.(MUSIC_FLOATING_POSITION_KEY, '');
        if (!raw) return null;

        try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const left = Number(parsed?.left);
            const top = Number(parsed?.top);
            if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
            return { left, top };
        } catch (error) {
            console.warn('[MusicView] 读取悬浮按钮位置失败:', error);
            return null;
        }
    }

    _applyFloatingBtnPosition(btn, left, top, { persist = false } = {}) {
        if (!btn) return;
        const btnSize = btn.getBoundingClientRect?.().width || 40;
        const vw = window.innerWidth || btnSize;
        const vh = window.innerHeight || btnSize;
        const maxLeft = Math.max(4, vw - btnSize - 4);
        const maxTop = Math.max(4, vh - btnSize - 4);
        const safeLeft = Math.max(4, Math.min(maxLeft, Number(left) || 4));
        const safeTop = Math.max(4, Math.min(maxTop, Number(top) || 4));

        btn.style.left = `${safeLeft}px`;
        btn.style.top = `${safeTop}px`;
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';

        if (persist) {
            this.app?.storage?.set?.(MUSIC_FLOATING_POSITION_KEY, JSON.stringify({
                left: Math.round(safeLeft),
                top: Math.round(safeTop)
            }));
        }
    }

    _ensureButtonVisible(btn) {
        if (!btn || !btn.parentNode) return;
        // 检查按钮是否在DOM中且可见
        const rect = btn.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // 如果按钮完全在视口外，重新定位
        if (rect.right < 0 || rect.left > vw || rect.bottom < 0 || rect.top > vh) {
            const savedPosition = this._getSavedFloatingPosition();
            if (savedPosition) {
                this._applyFloatingBtnPosition(btn, savedPosition.left, savedPosition.top, { persist: true });
            } else {
                this._userDragged = false; // 重置拖拽标记，允许重新定位
                this._positionFloatingBtn(btn);
            }
        }

        // 确保关键样式没有被覆盖
        const computed = window.getComputedStyle(btn);
        if (computed.display === 'none') btn.style.setProperty('display', 'flex', 'important');
        if (computed.visibility === 'hidden') btn.style.setProperty('visibility', 'visible', 'important');
        if (parseFloat(computed.opacity) < 0.1) btn.style.setProperty('opacity', '1', 'important');
    }

    _initDrag(el, onTap) {
        let startX, startY, startLeft, startTop;
        let moved = false;
        let isDragging = false;
        let lastTapTime = 0; // 防连击

        const getCoords = (e) => {
            if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            if (e.changedTouches && e.changedTouches.length > 0) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
            return { x: e.clientX, y: e.clientY };
        };

        const onDown = (e) => {
            if (e.type === 'mousedown' && e.button !== 0) return;
            const coords = getCoords(e);
            startX = coords.x;
            startY = coords.y;
            const rect = el.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            moved = false;
            isDragging = false;

            el.classList.add('dragging');
            document.addEventListener('mousemove', onMove, { passive: false });
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onUp);
            document.addEventListener('touchcancel', onUp);
        };

        const onMove = (e) => {
            if (startX === undefined) return;
            const coords = getCoords(e);
            const dx = coords.x - startX;
            const dy = coords.y - startY;

            if (!moved && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
                moved = true;
                isDragging = true;
            }

            if (moved) {
                e.preventDefault();
                this._applyFloatingBtnPosition(el, startLeft + dx, startTop + dy, { persist: false });
            }
        };

        const triggerTap = () => {
            const now = Date.now();
            if (now - lastTapTime < 600) return; // 🔥 延长防抖时间到600ms，彻底拦截移动端和小窗的"幽灵双击"
            lastTapTime = now;
            if (typeof onTap === 'function') onTap();
        };

        const onUp = (e) => {
            startX = undefined;
            el.classList.remove('dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onUp);
            document.removeEventListener('touchcancel', onUp);

            if (moved) {
                this._userDragged = true;
                const rect = el.getBoundingClientRect();
                this._applyFloatingBtnPosition(el, rect.left, rect.top, { persist: true });
            } else {
                // 🔥 核心修复：如果没有移动，立刻触发点击回调（完美解决移动端触摸失灵）
                triggerTap();
            }

            setTimeout(() => { isDragging = false; moved = false; }, 50);
        };

        el.addEventListener('mousedown', onDown);
        el.addEventListener('touchstart', onDown, { passive: true });

        // 保留 click 拦截，但主要触发已交给 onUp
        el.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!moved && !isDragging) {
                triggerTap();
            }
        });
    }

    _openPanel() {
        if (this._floatingPanel) return;
        this._panelFace = 'front';

        const data = this.app.musicData;
        const card = data.getCardData();
        const playlist = data.getPlaylist();
        // 当前播放的歌曲，如果没有正在播放则取歌单第一首显示
        const song = data.getCurrentSong() || (playlist.length > 0 ? playlist[0] : null);

        const panel = document.createElement('div');
        panel.className = 'music-floating-panel';

        // 继续使用安全舱容器，保持所有交互都在独立图层中
        Object.assign(panel.style, {
            position: 'relative',
            width: 'min(340px, calc(100vw - 24px))',
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box',
            pointerEvents: 'auto',
            visibility: 'visible',
            opacity: '1',
        });

        const headerHTML = `
            <div class="panel-header">
                <button type="button" class="close-btn header-back-btn" id="music-fp-header-back" title="返回正面">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
                <span class="panel-title"> Private Drift · 私人漫游</span>
                <div class="close-btn" id="music-fp-close">✕</div>
            </div>
        `;

        let bodyHTML = '';
        bodyHTML += `
            <div class="panel-face panel-front">
                <div class="player-core-section">
                    <div class="album-cover-wrapper">
                        <div class="album-cover-media">${song && song.pic ? `<img src="${song.pic}" alt="">` : SVG_NOTE}</div>
                    </div>
                <div class="turntable-tonearm" aria-hidden="true"></div>
                <div class="song-info">
                    <div class="song-name">${song ? this._escapeHtml(song.name) : '暂无播放'}</div>
                    <div class="song-artist">${song ? this._escapeHtml(song.artist) : '等待推荐中...'}</div>
                    <div class="music-lyrics-box" id="music-fp-lyrics"></div>
                </div>
                    <div class="progress-container">
                        <div class="progress-bar" id="music-fp-progress">
                            <div class="progress-fill" id="music-fp-progress-bar"></div>
                        </div>
                        <div class="time-info">
                            <span id="music-fp-time-current">0:00</span>
                            <span id="music-fp-time-total">0:00</span>
                        </div>
                        <button type="button" class="music-listen-share-btn" id="music-fp-share-listen" title="邀请微信好友一起听">
                            <svg class="music-listen-share-icon" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M8.6 10.8 15.4 7M8.6 13.2l6.8 3.8"/>
                                <circle cx="6" cy="12" r="2.4"/>
                                <circle cx="17.4" cy="5.9" r="2.4"/>
                                <circle cx="17.4" cy="18.1" r="2.4"/>
                            </svg>
                        </button>
                    </div>
                    <div class="controls-wrap">
                        <div class="controls controls-symmetric">
                            <div class="ctrl-btn search-trigger-inline" id="music-fp-search" title="搜索歌曲">
                                <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                            </div>
                            <div class="ctrl-btn" id="music-fp-prev">${SVG_PREV}</div>
                            <div class="ctrl-btn play-btn" id="music-fp-play">${data.isPlaying ? SVG_PAUSE : SVG_PLAY}</div>
                            <div class="ctrl-btn" id="music-fp-next">${SVG_NEXT}</div>
                            <div class="ctrl-btn flip-side-btn" id="music-fp-flip" title="查看卡片背面">
                                <span></span><span></span><span></span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="playlist-section">
                    <div class="playlist-header"></div>
                    <div class="playlist-list"></div>
                </div>
            </div>
            <div class="panel-face panel-back">
                <div class="social-card-section"></div>
            </div>
        `;

        panel.innerHTML = headerHTML + `<div class="panel-scroll-body">${bodyHTML}</div>`;
        
        // 🔥 核心修复：把卡片放进免疫变形的安全舱中，而不是有坑的 document.body
        this._getFloatingContainer().appendChild(panel);
        
        this._floatingPanel = panel;
        this._setPanelFace(this._panelFace);
        panel.addEventListener('click', (e) => e.stopPropagation());

        // 【新增搜索模态框的HTML】
        const searchModalHTML = `
            <div class="music-search-modal" id="music-search-modal" style="display: none;">
                <div class="music-search-header">
                    <span class="music-search-title">寻觅佳音</span>
                    <div class="music-search-close" id="music-search-close">✕</div>
                </div>
                <div class="music-search-box">
                    <input type="text" id="music-search-input" placeholder="输入歌名或歌手...">
                    <button id="music-search-submit">搜索</button>
                </div>
                <div class="music-search-results" id="music-search-results">
                    <div class="music-search-placeholder">输入关键词开始搜索...</div>
                </div>
            </div>
        `;
        panel.insertAdjacentHTML('beforeend', searchModalHTML);

        const listenShareModalHTML = `
            <div class="music-listen-share-modal" id="music-listen-share-modal" style="display: none;">
                <div class="music-listen-share-header">
                    <span>邀请好友一起听</span>
                    <button type="button" id="music-listen-share-close">✕</button>
                </div>
                <div class="music-listen-share-list" id="music-listen-share-list"></div>
            </div>
        `;
        panel.insertAdjacentHTML('beforeend', listenShareModalHTML);

        this._bindPanelEvents(panel);
        this._startProgressTimer();
        this._updateFloatingPanelDOM(); // 🔥 强制执行一次统一的新版渲染

        // 点击面板外关闭
        setTimeout(() => {
            this._outsideClickHandler = (e) => {
                if (this._floatingPanel && !this._floatingPanel.contains(e.target) &&
                    this._floatingBtn && !this._floatingBtn.contains(e.target)) {
                    this._closePanel();
                }
            };
            document.addEventListener('click', this._outsideClickHandler);
        }, 100);
    }

    _bindPanelEvents(panel) {
        const data = this.app.musicData;

        // 关闭
        const closeBtn = panel.querySelector('#music-fp-close');
        if (closeBtn) {
            closeBtn.onclick = () => this._closePanel();
        }

        // 播放/暂停
        const playBtn = panel.querySelector('#music-fp-play');
        if (playBtn) {
            playBtn.onclick = (e) => {
                e.stopPropagation();
                if (data.isPlaying) {
                    data.pause();
                } else if (data.getCurrentSong()) {
                    data.resume();
                } else if (data.getPlaylist().length > 0) {
                    data.play(0);
                }
            };
        }

        // 上一首/下一首
        const prevBtn = panel.querySelector('#music-fp-prev');
        if (prevBtn) prevBtn.onclick = (e) => { e.stopPropagation(); data.prev(); };

        const nextBtn = panel.querySelector('#music-fp-next');
        if (nextBtn) nextBtn.onclick = (e) => { e.stopPropagation(); data.next(); };

        // 正反面切换（只切 UI，不影响音频播放状态）
        const flipBtn = panel.querySelector('#music-fp-flip');
        if (flipBtn) {
            flipBtn.onclick = (e) => {
                e.stopPropagation();
                this._setPanelFace(this._panelFace === 'front' ? 'back' : 'front');
            };
        }
        const headerBackBtn = panel.querySelector('#music-fp-header-back');
        if (headerBackBtn) {
            headerBackBtn.onclick = (e) => {
                e.stopPropagation();
                this._setPanelFace('front');
            };
        }

        // 进度条点击
        const progress = panel.querySelector('#music-fp-progress');
        if (progress) {
            progress.onclick = (e) => {
                e.stopPropagation();
                const rect = progress.getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / rect.width;
                if (data.audioPlayer.duration) {
                    data.audioPlayer.currentTime = ratio * data.audioPlayer.duration;
                }
            };
        }

        const lyricsBox = panel.querySelector('#music-fp-lyrics');
        if (lyricsBox) {
            lyricsBox.addEventListener('scroll', () => {
                this._lyricsUserScrolling = true;
                clearTimeout(this._lyricsScrollTimer);
                this._lyricsScrollTimer = setTimeout(() => {
                    this._lyricsUserScrolling = false;
                }, 1800);
            }, { passive: true });
            lyricsBox.addEventListener('click', (e) => {
                e.stopPropagation();
                const line = e.target.closest('.music-lyric-line');
                if (!line || !line.dataset.time) return;
                const time = parseFloat(line.dataset.time);
                if (!Number.isFinite(time)) return;
                data.audioPlayer.currentTime = time;
                if (!data.isPlaying) data.resume();
                this._syncLyrics(time, true);
            });
        }

        // 【新增：绑定搜索功能事件】
        const searchModal = panel.querySelector('#music-search-modal');
        const searchBtn = panel.querySelector('#music-fp-search');
        const searchCloseBtn = panel.querySelector('#music-search-close');
        const searchInput = panel.querySelector('#music-search-input');
        const searchSubmitBtn = panel.querySelector('#music-search-submit');
        const shareListenBtn = panel.querySelector('#music-fp-share-listen');
        const listenShareModal = panel.querySelector('#music-listen-share-modal');
        const listenShareClose = panel.querySelector('#music-listen-share-close');
        const listenShareList = panel.querySelector('#music-listen-share-list');
        const searchState = {
            query: '',
            page: 1,
            pageSize: 10,
            results: []
        };

        const openSearch = (e) => {
            if (e) e.stopPropagation();
            if (searchModal) searchModal.style.setProperty('display', 'flex');
        };
        const closeSearch = (e) => {
            if (e) e.stopPropagation();
            if (searchModal) searchModal.style.setProperty('display', 'none');
        };

        const performSearch = async (page = 1, options = {}) => {
            const query = searchInput.value.trim();
            if (!query) return;

            const resultsContainer = panel.querySelector('#music-search-results');
            resultsContainer.innerHTML = '<div class="music-search-placeholder">正在寻觅...</div>';

            const nextPage = Math.max(1, Number.parseInt(page, 10) || 1);
            const shouldRefresh = !!options.refresh
                || query !== searchState.query
                || !Array.isArray(searchState.results)
                || searchState.results.length === 0;
            if (shouldRefresh) {
                searchState.query = query;
                searchState.results = await this.app.musicData.searchSongs(query, { limit: 80, pageSize: 20 });
            }
            searchState.page = nextPage;
            this._renderSearchResults(searchState.results, {
                page: searchState.page,
                pageSize: searchState.pageSize,
                query,
                onPage: nextPage => performSearch(nextPage, { refresh: false })
            });
        };

        if (searchBtn) searchBtn.onclick = openSearch;
        if (searchCloseBtn) searchCloseBtn.onclick = closeSearch;
        if (searchSubmitBtn) searchSubmitBtn.onclick = (e) => { e.stopPropagation(); performSearch(1, { refresh: true }); };
        if (searchInput) searchInput.onkeydown = (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                performSearch(1, { refresh: true });
            }
        };

        const openListenShare = async (e) => {
            if (e) e.stopPropagation();
            if (listenShareModal) listenShareModal.style.setProperty('display', 'flex');
            if (listenShareList) {
                listenShareList.innerHTML = '<div class="music-listen-share-empty">正在读取微信好友...</div>';
            }
            await this._renderListenShareFriends(listenShareList);
        };
        const closeListenShare = (e) => {
            if (e) e.stopPropagation();
            if (listenShareModal) listenShareModal.style.setProperty('display', 'none');
        };
        if (shareListenBtn) shareListenBtn.onclick = openListenShare;
        if (listenShareClose) listenShareClose.onclick = closeListenShare;
    }

    async _renderListenShareFriends(listEl) {
        if (!listEl) return;

        const wechatData = await this._getWechatDataForListenShare();
        const userAvatar = wechatData?.getUserInfo?.()?.avatar || '';
        const contacts = (wechatData?.getContacts?.() || [])
            .filter(contact => contact && !contact.blocked && String(contact.name || '').trim());

        if (contacts.length === 0) {
            listEl.innerHTML = '<div class="music-listen-share-empty">暂无微信好友</div>';
            return;
        }

        listEl.innerHTML = contacts.map((contact, index) => {
            const resolvedAvatar = this._resolveWechatListenAvatar(contact, wechatData, { excludeAvatar: userAvatar });
            const rawAvatar = this._normalizeWechatListenAvatarPath(contact.avatar);
            const safeRawAvatar = rawAvatar && rawAvatar !== this._normalizeWechatListenAvatarPath(userAvatar) ? contact.avatar : '';
            return `
                <button type="button" class="music-listen-friend" data-contact-index="${index}">
                    <span class="music-listen-friend-avatar">
                        ${this._renderWechatListenAvatar(resolvedAvatar || safeRawAvatar, contact.name)}
                    </span>
                    <span class="music-listen-friend-name">${this._escapeHtml(contact.name)}</span>
                </button>
            `;
        }).join('');

        listEl.querySelectorAll('.music-listen-friend').forEach(item => {
            item.onclick = (e) => {
                e.stopPropagation();
                const contact = contacts[Number(item.dataset.contactIndex)];
                if (contact) this._inviteWechatFriendToListen(contact);
            };
        });
    }

    async _inviteWechatFriendToListen(contact) {
        const snapshot = this.app.musicData.getListeningSnapshot();
        if (!snapshot) {
            if (window.VirtualPhone?.notify) {
                window.VirtualPhone.notify('音乐', '当前没有正在播放的歌曲', '🎵');
            } else {
                alert('当前没有正在播放的歌曲');
            }
            return;
        }

        const ok = confirm(`邀请 ${contact.name} 一起听《${snapshot.songName}》吗？`);
        if (!ok) return;

        const wechatApp = window.VirtualPhone?.wechatApp;
        const wechatData = await this._getWechatDataForListenShare();
        if (!wechatData) {
            alert('微信数据未初始化');
            return;
        }

        const currentUserAvatar = wechatData.getUserInfo?.()?.avatar || '';
        const resolvedAvatar = this._resolveWechatListenAvatar(contact, wechatData, { excludeAvatar: currentUserAvatar });
        const rawContactAvatar = this._normalizeWechatListenAvatarPath(contact.avatar);
        const safeRawContactAvatar = rawContactAvatar && rawContactAvatar !== this._normalizeWechatListenAvatarPath(currentUserAvatar)
            ? contact.avatar
            : '';
        const resolvedContact = {
            ...contact,
            avatar: resolvedAvatar || safeRawContactAvatar
        };
        const contactId = String(resolvedContact.id || '').trim();
        let chat = contactId
            ? wechatData.getChatByContactId?.(contactId)
            : null;
        if (!chat) {
            chat = wechatData.getChatList?.().find(item =>
                item?.type !== 'group'
                && typeof wechatData._isSameLookupName === 'function'
                && wechatData._isSameLookupName(item.name, resolvedContact.name)
            );
        }
        if (!chat) {
            chat = wechatData.createChat?.({
                id: contactId ? `chat_${contactId}` : `chat_${Date.now()}`,
                contactId: contactId || undefined,
                name: resolvedContact.name,
                type: 'single',
                avatar: resolvedContact.avatar
            });
        }
        if (!chat?.id) return;

        const listenMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        wechatData.startMusicListening?.(chat.id, resolvedContact, {
            ...snapshot,
            sourceMessageId: listenMessageId
        });
        wechatData.addMessage(chat.id, {
            id: listenMessageId,
            from: 'me',
            type: 'music_listen',
            content: `用户邀请了“${resolvedContact.name || '好友'}”一起听歌。当前正在一起听《${snapshot.songName || '未知歌曲'}》${snapshot.artist ? ` - ${snapshot.artist}` : ''}。`,
            musicListen: {
                ...snapshot,
                contactId: contactId || resolvedContact.id || '',
                contactName: resolvedContact.name || '',
                contactAvatar: resolvedContact.avatar || ''
            },
            avatar: wechatData.getUserInfo?.()?.avatar || ''
        });
        await Promise.resolve(wechatData.saveData?.());

        this._floatingPanel?.querySelector('#music-listen-share-modal')?.style.setProperty('display', 'none');
        if (wechatApp?.currentChat?.id === chat.id && typeof wechatApp?.chatView?.smartUpdateMessages === 'function') {
            wechatApp.chatView.smartUpdateMessages(wechatData.getMessages(chat.id), wechatData.getUserInfo());
            wechatApp.syncMusicListenHeaderIndicator?.(chat.id);
        } else if (wechatApp && !wechatApp.currentChat && wechatApp.currentView === 'chats' && typeof wechatApp.render === 'function') {
            wechatApp.render();
        }
        window.VirtualPhone?.notify?.('一起听歌', `已邀请 ${resolvedContact.name}`, '🎵');
    }

    async _getWechatDataForListenShare() {
        let wechatData = window.VirtualPhone?.wechatApp?.wechatData || window.VirtualPhone?.cachedWechatData;
        if (wechatData) return wechatData;

        try {
            const module = await import('../wechat/wechat-data.js');
            wechatData = new module.WechatData(window.VirtualPhone?.storage || this.app.storage);
            if (window.VirtualPhone) window.VirtualPhone.cachedWechatData = wechatData;
            return wechatData;
        } catch (error) {
            console.error('加载微信数据库失败:', error);
            return null;
        }
    }

    _resolveWechatListenAvatar(target, wechatData, options = {}) {
        if (!target) return '';
        const excludedAvatar = this._normalizeWechatListenAvatarPath(options.excludeAvatar || '');
        const isExcludedAvatar = (avatar) => {
            const normalized = this._normalizeWechatListenAvatarPath(avatar);
            return normalized && excludedAvatar && normalized === excludedAvatar;
        };
        const directAvatar = this._normalizeWechatListenAvatarPath(target.avatar);
        if (directAvatar && !isExcludedAvatar(directAvatar)) return directAvatar;
        if (!wechatData) return '';

        const keySet = new Set([
            target.id,
            target.contactId,
            target.name
        ].filter(Boolean).map(value => String(value).trim()));

        for (const key of keySet) {
            const autoAvatar = this._normalizeWechatListenAvatarPath(wechatData.getContactAutoAvatar?.(key));
            if (autoAvatar && !isExcludedAvatar(autoAvatar)) return autoAvatar;
        }

        const autoMap = typeof wechatData.getContactAutoAvatarMap === 'function'
            ? wechatData.getContactAutoAvatarMap()
            : null;
        if (autoMap && typeof autoMap === 'object') {
            for (const key of keySet) {
                const mappedAvatar = this._normalizeWechatListenAvatarPath(autoMap[key]);
                if (mappedAvatar && !isExcludedAvatar(mappedAvatar)) return mappedAvatar;
            }
        }

        return '';
    }

    _normalizeWechatListenAvatarPath(value) {
        const raw = String(value || '').trim();
        if (!raw || raw === '👤' || raw === '👥') return '';
        if (/^(?:data:image|https?:\/\/|\/|blob:)/i.test(raw)) return raw;
        const cleaned = raw
            .replace(/^['"]|['"]$/g, '')
            .replace(/^\.?\/*/, '')
            .replace(/^apps\/wechat\/avatars\//i, '')
            .replace(/^wechat\/avatars\//i, '')
            .replace(/^avatars\//i, '');
        if (!cleaned || /\s/.test(cleaned)) return '';
        if (/^(?:male|female)\d+$/i.test(cleaned)) {
            return new URL(`../wechat/avatars/${cleaned}.png`, import.meta.url).href;
        }
        if (/^[a-z0-9._-]+\.(?:png|jpg|jpeg|webp|gif)$/i.test(cleaned)) {
            return new URL(`../wechat/avatars/${cleaned}`, import.meta.url).href;
        }
        return '';
    }

    _renderWechatListenAvatar(avatar, fallbackName = '') {
        const imageAvatar = this._normalizeWechatListenAvatarPath(avatar);
        if (imageAvatar) {
            return `<img src="${this._escapeAttr(imageAvatar)}" alt="">`;
        }
        const avatarText = String(avatar || '').trim();
        if (avatarText) return this._escapeHtml(avatarText);
        return this._escapeHtml(this._getAvatarInitial(fallbackName || '微'));
    }

    _getAvatarInitial(name) {
        const raw = String(name || '').trim();
        if (!raw) return '微';
        return Array.from(raw)[0];
    }

    _setPanelFace(face) {
        this._panelFace = face === 'back' ? 'back' : 'front';
        if (!this._floatingPanel) return;
        this._floatingPanel.classList.toggle('show-back-face', this._panelFace === 'back');
    }

    _closePanel() {
        // 移除外部点击监听
        if (this._outsideClickHandler) {
            document.removeEventListener('click', this._outsideClickHandler);
            this._outsideClickHandler = null;
        }

        if (this._floatingPanel) {
            this._floatingPanel.classList.add('closing');
            const panelRef = this._floatingPanel;
            this._floatingPanel = null;
            setTimeout(() => {
                panelRef.remove();
            }, 200);
        }
        this._stopProgressTimer();
    }

    _renderSearchResults(results, options = {}) {
        const resultsContainer = document.getElementById('music-search-results');
        if (!resultsContainer) return;

        const allResults = Array.isArray(results) ? results : [];
        const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
        const pageSize = Math.max(1, Number.parseInt(options.pageSize, 10) || 10);
        const totalPages = Math.max(1, Math.ceil(allResults.length / pageSize));
        const safePage = Math.min(page, totalPages);
        const pageResults = allResults.slice((safePage - 1) * pageSize, safePage * pageSize);
        const canPrev = safePage > 1;
        const canNext = safePage < totalPages;

        if (allResults.length === 0) {
            resultsContainer.innerHTML = `
                <div class="music-search-placeholder">未寻得相关曲目。</div>
                ${canPrev ? `
                    <div class="music-search-pager">
                        <button type="button" class="music-search-page-btn" data-page="${safePage - 1}">上一页</button>
                        <span class="music-search-page-info">第 ${safePage} / ${totalPages} 页</span>
                        <button type="button" class="music-search-page-btn" disabled>下一页</button>
                    </div>
                ` : ''}
            `;
            resultsContainer.querySelectorAll('.music-search-page-btn[data-page]').forEach(button => {
                button.onclick = (e) => {
                    e.stopPropagation();
                    const nextPage = Number.parseInt(button.dataset.page, 10);
                    if (Number.isFinite(nextPage) && typeof options.onPage === 'function') options.onPage(nextPage);
                };
            });
            return;
        }

        resultsContainer.innerHTML = `
            ${pageResults.map(song => `
            <div class="music-search-item">
                <img class="music-search-item-cover" src="${song.pic || ''}" onerror="this.style.display='none'">
                <div class="music-search-item-info">
                    <div class="music-search-item-name">${this._escapeHtml(song.name)}</div>
                    <div class="music-search-item-artist">${this._escapeHtml(song.artist)}</div>
                </div>
                <button class="music-search-item-add" data-song-name="${this._escapeHtml(song.name)}" data-song-artist="${this._escapeHtml(song.artist)}">+</button>
            </div>
            `).join('')}
            <div class="music-search-pager">
                <button type="button" class="music-search-page-btn" data-page="${safePage - 1}" ${canPrev ? '' : 'disabled'}>上一页</button>
                <span class="music-search-page-info">第 ${safePage} / ${totalPages} 页</span>
                <button type="button" class="music-search-page-btn" data-page="${safePage + 1}" ${canNext ? '' : 'disabled'}>下一页</button>
            </div>
        `;

        // 为所有新的"添加"按钮绑定事件
        resultsContainer.querySelectorAll('.music-search-item-add').forEach(button => {
            button.onclick = (e) => {
                e.stopPropagation();
                const name = button.dataset.songName;
                const artist = button.dataset.songArtist;
                const songMeta = allResults.find(item => item.name === name && item.artist === artist) || {};
                this.app.musicData.addSong(name, artist, {
                    id: songMeta.id || null,
                    pic: songMeta.pic || null
                });

                // 给出反馈并关闭搜索框
                button.innerText = '✓';
                button.disabled = true;
                setTimeout(() => {
                    document.getElementById('music-search-modal')?.style.setProperty('display', 'none');
                }, 500);
            };
        });

        resultsContainer.querySelectorAll('.music-search-page-btn[data-page]').forEach(button => {
            button.onclick = (e) => {
                e.stopPropagation();
                if (button.disabled) return;
                const nextPage = Number.parseInt(button.dataset.page, 10);
                if (Number.isFinite(nextPage) && typeof options.onPage === 'function') {
                    options.onPage(nextPage);
                }
            };
        });
    }

    destroyFloatingWidget() {
        this._closePanel();
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }
        if (this._visibilityGuard) {
            clearInterval(this._visibilityGuard);
            this._visibilityGuard = null;
        }
        if (this._floatingBtn) {
            this._floatingBtn.remove();
            this._floatingBtn = null;
        }
        this._userDragged = false;
        this._stopProgressTimer();
    }

    // ========== 进度条更新 ==========

    _startProgressTimer() {
        this._stopProgressTimer();
        this._progressTimer = setInterval(() => {
            this._updateProgress();
        }, 250);
    }

    _stopProgressTimer() {
        if (this._progressTimer) {
            clearInterval(this._progressTimer);
            this._progressTimer = null;
        }
    }

    _updateProgress() {
        const audio = this.app.musicData.audioPlayer;
        const hasDuration = Number.isFinite(audio.duration) && audio.duration > 0;
        const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        const ratio = hasDuration ? (currentTime / audio.duration) * 100 : 0;

        // 悬浮面板进度条
        const fpBar = document.querySelector('#music-fp-progress-bar');
        if (fpBar) fpBar.style.width = `${ratio}%`;

        const fpCurrent = document.querySelector('#music-fp-time-current');
        if (fpCurrent) fpCurrent.textContent = this._formatTime(currentTime);

        const fpTotal = document.querySelector('#music-fp-time-total');
        if (fpTotal) fpTotal.textContent = hasDuration ? this._formatTime(audio.duration) : '0:00';

        this._syncLyrics(currentTime);
    }

    // ========== 状态更新回调 ==========

    // 🔥 局部热更新逻辑
    _updateFloatingPanelDOM() {
        if (!this._floatingPanel) return;
        this._setPanelFace(this._panelFace);
        this._floatingPanel.classList.toggle('is-playing', !!this.app.musicData.isPlaying);

        const data = this.app.musicData;
        const playlist = data.getPlaylist();
        const song = data.getCurrentSong() || (playlist.length > 0 ? playlist[0] : null);
        const card = data.getCardData();

        // 1. 更新播放/暂停按钮 (SVG版)
        const playBtn = this._floatingPanel.querySelector('#music-fp-play');
        if (playBtn) playBtn.innerHTML = data.isPlaying ? SVG_PAUSE : SVG_PLAY;

        // 2. 更新当前播放的封面、歌名和歌手
        const coverEl = this._floatingPanel.querySelector('.album-cover-media');
        if (coverEl) coverEl.innerHTML = (song && song.pic) ? `<img src="${song.pic}" alt="">` : SVG_NOTE;

        const nameEl = this._floatingPanel.querySelector('.song-name');
        if (nameEl) {
            nameEl.textContent = song ? song.name : '暂无播放';
            nameEl.style.opacity = song ? '1' : '0.5';
        }

        const artistEl = this._floatingPanel.querySelector('.song-artist');
        if (artistEl) artistEl.textContent = song ? song.artist : '等待推荐中...';

        this._renderLyrics(song);

        // 2.5 更新社交卡片
        const socialSection = this._floatingPanel.querySelector('.social-card-section');
        if (socialSection) {
            if (!card) {
                socialSection.innerHTML = `<div class="no-social-data">等待记录生成...</div>`;
            } else {
                const realAvatar = this._getRealAvatarFromDOM() || (card.char && card.char[2]) || '';
                const charName = this._escapeHtml((card.char && card.char[0]) || '音乐动态');
                const charHandle = this._escapeHtml((card.char && card.char[1]) || '');
                const metaText = card.meta && card.meta.length > 0 ? this._escapeHtml(card.meta.join(' ')) : '';
                const statsText = card.stats && card.stats.length > 0
                    ? this._escapeHtml(card.stats.join(' '))
                    : '';
                const thoughtText = card.thought && card.thought.length > 0
                    ? this._escapeHtml(card.thought.join(' '))
                    : '';

                const likesHTML = card.likes && card.likes.length > 0
                    ? `<div class="likes-tags">${card.likes.map(l => `<span class="like-tag"><span class="heart">❤</span> ${this._escapeHtml(l)}</span>`).join('')}</div>`
                    : '';

                let repliesHTML = '';
                const normalizedReplies = this._normalizeReplies(card.replies);
                if (normalizedReplies.length > 0) {
                    const items = [];
                    for (const reply of normalizedReplies) {
                        const replyName = (reply.name || '').trim();
                        const replyHandle = (reply.handle || '').trim();
                        const replyText = (reply.text || '').trim();
                        if (!replyName && !replyText) continue;
                        const avatarText = this._escapeHtml((replyName || '?').charAt(0));
                        items.push(`
                            <div class="reply-item">
                                <div class="reply-avatar">${avatarText}</div>
                                <div class="reply-body">
                                    <div class="reply-name">
                                        ${this._escapeHtml(replyName || '匿名')}
                                        ${replyHandle ? `<span class="reply-handle">${this._escapeHtml(replyHandle)}</span>` : ''}
                                    </div>
                                    <div class="reply-text">${this._escapeHtml(replyText || '...')}</div>
                                </div>
                            </div>
                        `);
                    }
                    if (items.length > 0) {
                        repliesHTML = `<div class="replies-container">${items.join('')}</div>`;
                    }
                }

                let group1HTML = '';
                if (statsText || likesHTML) {
                    group1HTML = `
                        <div class="literary-box">
                            ${statsText ? `
                                <div class="literary-prologue">P r o l o g u e · 独 白</div>
                                <div class="literary-main">“${statsText}”</div>
                            ` : ''}
                            ${likesHTML}
                        </div>
                    `;
                }

                let group2HTML = '';
                if (thoughtText || repliesHTML) {
                    const hideBorder = !repliesHTML ? 'style="border-bottom: none; margin-bottom: 0; padding-bottom: 0;"' : '';
                    group2HTML = `
                        <div class="comments-group">
                            ${thoughtText ? `
                                <div class="inner-monologue" ${hideBorder}>
                                    <div class="monologue-label">I N N E R  T H O U G H T S</div>
                                    <div class="monologue-text">“${thoughtText}”</div>
                                </div>
                            ` : ''}
                            ${repliesHTML}
                        </div>
                    `;
                }

                socialSection.innerHTML = `
                    <div class="user-header">
                        ${realAvatar
                            ? `<img class="social-avatar" src="${realAvatar}" alt="">`
                            : `<div class="social-avatar social-avatar-fallback">${SVG_NOTE}</div>`}
                        <div class="name-box">
                            <div class="char-name">
                                ${charName}
                                ${metaText ? `<span class="meta-time">${metaText}</span>` : ''}
                            </div>
                            <div class="char-handle">${charHandle}</div>
                        </div>
                    </div>
                    ${group1HTML}
                    ${group2HTML}
                `;
            }
        }

        // 3. 🔥 强制全量刷新歌单区域
        const playlistSection = this._floatingPanel.querySelector('.playlist-section');
        if (playlistSection) {
            const currentList = this._currentTab === 'favorites' ? data.getFavorites() : data.getPlaylist();
            const clearLabel = this._currentTab === 'favorites' ? '清空收藏' : '清空歌单';
            const headerEl = playlistSection.querySelector('.playlist-header');
            const listEl = playlistSection.querySelector('.playlist-list');
            if (!headerEl || !listEl) return;

            headerEl.innerHTML = `
                <div class="tabs">
                    <span class="tab-item ${this._currentTab === 'playlist' ? 'active' : ''}" data-tab="playlist">歌单 (${data.getPlaylist().length})</span>
                    <span class="tab-item ${this._currentTab === 'favorites' ? 'active' : ''}" data-tab="favorites">收藏 (${data.getFavorites().length})</span>
                </div>
                <div class="actions">
                    <span class="action-btn icon-only music-fp-autoplay-btn ${data.getAutoPlay() ? 'active' : ''}" title="连播开关">
                        <i class="fa-solid fa-rotate-right"></i>
                    </span>
                    <span class="action-btn icon-only danger music-fp-clear-btn" title="${clearLabel}">
                        <i class="fa-solid fa-trash"></i>
                    </span>
                    <span class="action-btn playlist-collapse" title="展开/收起">
                        <i class="fa-solid fa-chevron-${this._isPlaylistCollapsed ? 'down' : 'up'}"></i>
                    </span>
                </div>
            `;

            if (this._isPlaylistCollapsed) {
                listEl.style.display = 'none';
                listEl.innerHTML = '';
            } else if (currentList.length === 0) {
                listEl.style.display = 'flex';
                listEl.innerHTML = `<div class="playlist-empty">当前列表为空</div>`;
            } else {
                listEl.style.display = 'flex';
                listEl.innerHTML = currentList.map((s, i) => {
                    const isPlayingItem = (i === data.currentIndex && data.activeListType === this._currentTab);
                    const isFav = data.isFavorite(s);
                    return `
                        <div class="song-item ${isPlayingItem ? 'active' : ''}" data-index="${i}">
                            <span class="song-index">${isPlayingItem && data.isPlaying ? '♫' : i + 1}</span>
                            <div class="song-detail">
                                <div class="s-name">${this._escapeHtml(s.name)}</div>
                                <div class="s-artist">${this._escapeHtml(s.artist)}</div>
                            </div>
                            <span class="icon-btn fav ${isFav ? 'active' : ''}" data-fav="${i}">
                                <i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
                            </span>
                            <span class="icon-btn remove" data-remove="${i}">✕</span>
                        </div>
                    `;
                }).join('');
            }

            // 绑定切换 Tab
            headerEl.querySelectorAll('.tab-item').forEach(tab => {
                tab.onclick = (e) => {
                    e.stopPropagation();
                    this._currentTab = tab.dataset.tab;
                    this.updateDisplay();
                };
            });

            // 绑定播放
            listEl.querySelectorAll('.song-item').forEach(item => {
                item.onclick = (e) => {
                    e.stopPropagation();
                    if (e.target.closest('.remove') || e.target.closest('.fav')) return;
                    data.play(parseInt(item.dataset.index), this._currentTab);
                };
            });

            // 绑定删除 (待播列表点X是删除，收藏列表点X是从收藏中移除)
            listEl.querySelectorAll('.remove').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.remove);
                    if(this._currentTab === 'playlist') {
                        data.removeSong(idx);
                    } else {
                        const song = data.getFavorites()[idx];
                        data.toggleFavorite(song);
                    }
                    this.updateDisplay();
                };
            });

            // 绑定收藏
            listEl.querySelectorAll('.fav').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.fav);
                    const song = currentList[idx];
                    data.toggleFavorite(song);
                    this.updateDisplay();
                };
            });

            // 绑定清空（歌单/收藏分别处理）
            const clearBtn = headerEl.querySelector('.music-fp-clear-btn');
            if (clearBtn) {
                clearBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (this._currentTab === 'favorites') {
                        data.clearFavorites();
                    } else {
                        data.clearPlaylist();
                    }
                    this.updateDisplay();
                };
            }
            
            // 绑定连播
            const autoplayBtn = headerEl.querySelector('.music-fp-autoplay-btn');
            if (autoplayBtn) autoplayBtn.onclick = (e) => { e.stopPropagation(); data.setAutoPlay(!data.getAutoPlay()); this.updateDisplay(); };

            // 绑定折叠按钮事件 (点击头部空白和箭头都可收起/展开)
            const collapseToggle = headerEl.querySelector('.playlist-collapse');
            if (collapseToggle) {
                collapseToggle.onclick = (e) => {
                    e.stopPropagation();
                    this._isPlaylistCollapsed = !this._isPlaylistCollapsed;
                    this.updateDisplay();
                };
            }
            headerEl.onclick = (e) => {
                e.stopPropagation();
                if (e.target.closest('.tab-item') || e.target.closest('.music-fp-autoplay-btn') ||
                    e.target.closest('.music-fp-clear-btn') || e.target.closest('.playlist-collapse')) {
                    return;
                }
                this._isPlaylistCollapsed = !this._isPlaylistCollapsed;
                this.updateDisplay();
            };
        }
    }

    // ========== 工具方法 ==========

    _normalizeReplies(rawReplies) {
        if (!Array.isArray(rawReplies) || rawReplies.length === 0) return [];

        const cleaned = rawReplies
            .map(v => String(v || '').trim())
            .filter(Boolean);

        const triplets = [];
        if (cleaned.length >= 3) {
            for (let i = 0; i < cleaned.length - 2; i += 3) {
                triplets.push({
                    name: cleaned[i] || '',
                    handle: cleaned[i + 1] || '',
                    text: cleaned[i + 2] || ''
                });
            }
        }

        const hasEmbeddedNextReply = triplets.some(t => /[；;].+\|@?/u.test(t.text || ''));
        const tripletLooksValid =
            cleaned.length % 3 === 0 &&
            triplets.length > 0 &&
            triplets.some(t => (t.handle || '').startsWith('@')) &&
            !hasEmbeddedNextReply;
        if (tripletLooksValid) return triplets;

        // 脏格式兜底：按“；name|@handle|text”切块修复
        const joined = cleaned.join('|');
        const chunks = joined
            .split(/[；;](?=[^|;\n\r]+\|@?[^|;\n\r]+\|)/g)
            .map(s => s.trim())
            .filter(Boolean);

        const normalized = [];
        chunks.forEach(chunk => {
            const parts = chunk.split('|').map(s => s.trim());
            if (parts.length >= 3) {
                normalized.push({
                    name: parts[0] || '',
                    handle: parts[1] || '',
                    text: parts.slice(2).join('|') || ''
                });
            }
        });

        return normalized.length > 0 ? normalized : triplets;
    }

    _formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    _renderLyrics(song) {
        if (!this._floatingPanel) return;

        const lyricsBox = this._floatingPanel.querySelector('#music-fp-lyrics');
        if (!lyricsBox) return;

        const lyrics = Array.isArray(song?.lrc) ? song.lrc : null;
        const status = !song ? 'empty' : song._lrcLoading ? 'loading' : Array.isArray(song.lrc) ? `lrc:${song.lrc.length}` : 'pending';
        const key = `${song?.id || ''}|${song?.name || ''}|${song?.artist || ''}|${status}`;
        if (key === this._lyricsRenderKey) return;

        this._lyricsRenderKey = key;
        this._lyricsActiveIndex = -1;

        if (!song) {
            lyricsBox.innerHTML = '<div class="music-lyrics-placeholder">等待推荐中...</div>';
            return;
        }

        if (song._lrcLoading || (!Array.isArray(song.lrc) && song.id)) {
            lyricsBox.innerHTML = '<div class="music-lyrics-placeholder">歌词载入中...</div>';
            return;
        }

        if (!lyrics || lyrics.length === 0) {
            lyricsBox.innerHTML = '<div class="music-lyrics-placeholder">暂无歌词</div>';
            return;
        }

        lyricsBox.innerHTML = `
            <div class="music-lyrics-list">
                ${lyrics.map((line, index) => `
                    <div class="music-lyric-line" data-index="${index}" data-time="${line.t}">
                        <span class="music-lyric-text">${this._escapeHtml(line.txt)}</span>
                        ${line.tr ? `<span class="music-lyric-trans">${this._escapeHtml(line.tr)}</span>` : ''}
                    </div>
                `).join('')}
            </div>
        `;

        this._syncLyrics(this.app.musicData.audioPlayer.currentTime || 0, true);
    }

    _syncLyrics(currentTime, forceScroll = false) {
        if (!this._floatingPanel) return;

        const song = this.app.musicData.getCurrentSong();
        const lyrics = Array.isArray(song?.lrc) ? song.lrc : [];
        if (lyrics.length === 0) return;

        const nextIndex = lyrics.findIndex(line => line.t > currentTime);
        let activeIndex = nextIndex === -1 ? lyrics.length - 1 : nextIndex - 1;
        if (activeIndex < 0) activeIndex = 0;
        if (activeIndex === this._lyricsActiveIndex && !forceScroll) return;

        this._lyricsActiveIndex = activeIndex;
        const lyricsBox = this._floatingPanel.querySelector('#music-fp-lyrics');
        if (!lyricsBox) return;

        const lines = lyricsBox.querySelectorAll('.music-lyric-line');
        lines.forEach((line, index) => {
            line.classList.toggle('is-active', index === activeIndex);
        });

        const activeLine = lines[activeIndex];
        if (activeLine && (!this._lyricsUserScrolling || forceScroll)) {
            const boxRect = lyricsBox.getBoundingClientRect();
            const lineRect = activeLine.getBoundingClientRect();
            const currentLineCenter = lineRect.top - boxRect.top + lyricsBox.scrollTop + (lineRect.height / 2);
            const targetTop = currentLineCenter - (lyricsBox.clientHeight / 2);

            lyricsBox.scrollTo({
                top: Math.max(0, targetTop),
                behavior: forceScroll ? 'auto' : 'smooth'
            });
        }
    }

    _escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    _escapeAttr(str) {
        return this._escapeHtml(str).replace(/'/g, '&#39;');
    }
}
