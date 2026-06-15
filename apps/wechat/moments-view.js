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
import { ImageCropper } from '../settings/image-cropper.js';
import { applyPhoneTagFilter } from '../../config/tag-filter.js';
import { readPhoneContextLimit } from '../../config/context-settings.js';

// 朋友圈视图 - 高仿微信版
export class MomentsView {
    constructor(wechatApp) {
        this.app = wechatApp;
        this.isLoading = false;
        this.newPostText = '';
        this.currentCommentMomentId = null;
        this.currentReplyTo = null;
        this.pendingMomentImages = [];
        this._postMomentDraftActive = false;
        this._postMomentDraftCommitted = false;
        this._postMomentDraftObserver = null;
    }

    // 在wechat-app的renderDiscover中调用
    renderMomentsPage() {
        const moments = this.app.wechatData.getMoments();
        const userInfo = this.app.wechatData.getUserInfo();
        const bgImage = userInfo.momentsBackground;
        const mainShellBg = String(userInfo.chatListBackground || '').trim();
        const hasMainShellBg = !!mainShellBg;
        const hasBackdrop = !!bgImage || hasMainShellBg;

        return `
            <div class="moments-page" style="overscroll-behavior: none; ${bgImage ? `background-image: url('${bgImage}'); background-size: cover; background-position: center;` : (hasMainShellBg ? 'background: transparent;' : 'background: #fff;')}">
                <!-- 朋友圈列表 - 有背景图时透明，无背景图时白色 -->
                <div class="moments-feed" style="background: ${hasBackdrop ? 'transparent' : '#fff'};">
                    <div class="moments-pull-refresh-indicator" id="moments-pull-refresh-indicator">
                        <div class="moments-pull-refresh-inner" id="moments-pull-refresh-inner"></div>
                    </div>
                    ${moments.length === 0 ? `
                        <div class="moments-empty-tip" style="${hasBackdrop ? 'background: rgba(255,255,255,0.34); backdrop-filter: blur(12px) saturate(135%); -webkit-backdrop-filter: blur(12px) saturate(135%); border: 1px solid rgba(255,255,255,0.34); border-radius: 12px; margin: 20px;' : ''}">
                            <p>朋友圈空空如也</p>
                            <p class="tip-sub">下拉刷新加载朋友圈</p>
                        </div>
                    ` : moments.map(moment => this.renderMomentItem(moment, hasBackdrop)).join('')}
                </div>
            </div>
        `;
    }

    // 渲染单条朋友圈
    renderMomentItem(moment, hasBgImage = false) {
        const timeStr = this.formatTime(moment.timestamp || moment.time);
        // 🔥 优先实时从联系人/聊天获取头像，确保头像同步更新
        const contactAvatar = this.getContactAvatar(moment.name) || moment.avatar || '👤';
        const userName = String(this.app.wechatData.getUserInfo()?.name || '').trim();
        const isOwnMoment = String(moment?.name || '').trim() === userName;

        // 🔥 有背景图时，给每条朋友圈添加毛玻璃效果，让背景透出来
        // 使用 rgba 白色背景作为降级方案，确保移动端兼容
        const itemStyle = hasBgImage ? 'background: rgba(255,255,255,0.28); backdrop-filter: blur(10px) saturate(135%); -webkit-backdrop-filter: blur(10px) saturate(135%); border: 1px solid rgba(255,255,255,0.32); margin: 8px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);' : '';

        return `
            <div class="moment-item" data-moment-id="${moment.id}" data-own-moment="${isOwnMoment ? '1' : '0'}" style="${itemStyle}">
                ${isOwnMoment ? `
                    <button class="moment-delete-btn" data-moment-id="${moment.id}" title="删除朋友圈">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                ` : ''}
                <!-- 头像 -->
                <div class="moment-avatar-col">
                    ${this.app.renderAvatar(contactAvatar, '👤', moment.name)}
                </div>

                <!-- 内容区 -->
                <div class="moment-content-col">
                    <!-- 发布者名字 -->
                    <div class="moment-author">${moment.name}</div>

                    <!-- 文字内容 -->
                    ${moment.text ? `<div class="moment-text">${moment.text}</div>` : ''}

                    <!-- 图片 -->
                    ${this.renderImages(moment.images, moment)}

                    <!-- 底部：时间 + 操作 -->
                    <div class="moment-footer">
                        <span class="moment-time">${timeStr}</span>
                        <div class="moment-action-btn" data-moment-id="${moment.id}">
                            <i class="fa-solid fa-ellipsis"></i>
                        </div>
                    </div>

                    <!-- 点赞和评论区 -->
                    ${this.renderInteractions(moment)}
                </div>
            </div>
        `;
    }

    // 渲染图片
    renderImages(images, moment = null) {
        if (!images || images.length === 0) return '';

        const gridClass = images.length === 1 ? 'single' :
                         images.length === 2 ? 'double' :
                         images.length === 4 ? 'quad' : 'grid';

        return `
            <div class="moment-images ${gridClass}">
                ${images.map((img, index) => `
                    <div class="moment-img-wrapper">
                        ${this.renderMomentImage(img, index, moment)}
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderMomentImage(rawImage, index, moment = null) {
        const parsed = this._parseMomentImageItem(rawImage);
        const state = this._getMomentImageState(moment, index);
        const statePrompt = this._parsePromptDescriptionPair(state?.prompt || '');
        const promptText = statePrompt.prompt || parsed.promptText || String(rawImage || '').trim();
        const descriptionText = state?.description || statePrompt.description || parsed.descriptionText || promptText;
        const safePrompt = this._escapeHtml(descriptionText || '图片描述');
        const safeTags = this._escapeHtml(this._hasCjkText(promptText) ? '缺少英文Tag' : promptText);
        if (parsed.isDirectImage) {
            return `
                <div class="moment-image-generated-box">
                    <img src="${this._escapeAttr(parsed.realUrl)}" class="moment-img" data-moment-image-url="${this._escapeAttr(parsed.realUrl)}">
                    <button class="moment-image-regenerate" data-index="${index}" data-prompt="${this._escapeAttr(promptText)}" data-description="${this._escapeAttr(descriptionText)}" title="重新生成">
                        <i class="fa-solid fa-rotate"></i>
                    </button>
                    <button class="moment-image-show-desc" title="查看图片描述">描述</button>
                    <div class="moment-image-desc-panel">
                        <div class="moment-image-desc-text">
                            <div style="font-weight:700; margin-bottom:4px;">中文描述</div>
                            <div>${safePrompt || '暂无图片描述'}</div>
                            <div style="font-weight:700; margin:8px 0 4px;">英文Tag</div>
                            <div>${safeTags}</div>
                        </div>
                        <button class="moment-image-restore" title="恢复图片">恢复</button>
                    </div>
                </div>
            `;
        }

        const status = state?.status || '';
        const error = state?.error || '';
        const statusText = status === 'loading'
            ? '正在生成...'
            : (status === 'failed' ? '生成失败，点击重试' : '生成图片');
        const icon = status === 'loading'
            ? '<i class="fa-solid fa-spinner fa-spin"></i>'
            : '<i class="fa-regular fa-image"></i>';
        const previewSeed = encodeURIComponent(`moments_${index}_${promptText}`);
        const previewUrl = `https://picsum.photos/seed/${previewSeed}/480/480`;

        return `
            <div class="moment-image-prompt-box" data-index="${index}" data-prompt="${this._escapeAttr(promptText)}" data-description="${this._escapeAttr(descriptionText)}" title="${this._escapeAttr(descriptionText)}">
                <div class="moment-image-prompt-front">
                    <img src="${previewUrl}" alt="${this._escapeAttr(promptText)}" class="moment-img" style="filter:${status === 'failed' ? 'grayscale(0.2)' : 'none'};">
                    <div class="moment-image-prompt-mask"></div>
                    <div class="moment-image-prompt-generate" data-index="${index}" data-prompt="${this._escapeAttr(promptText)}" data-description="${this._escapeAttr(descriptionText)}">
                        <div class="moment-image-prompt-icon">${icon}</div>
                        <div class="moment-image-prompt-text">${statusText}</div>
                        ${error ? `<div class="moment-image-prompt-error">${this._escapeHtml(error)}</div>` : ''}
                    </div>
                    <button class="moment-image-show-desc" title="查看图片描述">描述</button>
                </div>
                <div class="moment-image-desc-panel">
                    <div class="moment-image-desc-text">
                        <div style="font-weight:700; margin-bottom:4px;">中文描述</div>
                        <div>${safePrompt || '暂无图片描述'}</div>
                        <div style="font-weight:700; margin:8px 0 4px;">英文Tag</div>
                        <div>${safeTags}</div>
                    </div>
                    <button class="moment-image-restore" title="恢复卡片正面">恢复</button>
                </div>
            </div>
        `;
    }

    // 渲染互动区（点赞+评论）
    renderInteractions(moment) {
        const hasLikes = moment.likeList && moment.likeList.length > 0;
        const hasComments = moment.commentList && moment.commentList.length > 0;

        if (!hasLikes && !hasComments) return '';

        return `
            <div class="moment-interactions">
                ${hasLikes ? `
                    <div class="interaction-likes">
                        <i class="fa-solid fa-heart"></i>
                        <span class="like-names">${moment.likeList.join('，')}</span>
                    </div>
                ` : ''}

                ${hasComments ? `
                    <div class="interaction-comments">
                        ${moment.commentList.map((comment, idx) => `
                            <div class="comment-row" data-moment-id="${moment.id}" data-comment-idx="${idx}" data-author="${comment.name}">
                                <span class="comment-author">${comment.name}</span>
                                ${comment.replyTo ? `<span class="comment-reply">回复</span><span class="comment-author">${comment.replyTo}</span>` : ''}
                                <span class="comment-colon">：</span>
                                <span class="comment-content">${comment.text}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    // 绑定朋友圈事件
    bindMomentsEvents() {
        // 🔥 禁止下拉刷新/拖拽
        const momentsPage = document.querySelector('.moments-page');
        if (momentsPage) {
            momentsPage.style.overscrollBehavior = 'none';
        }

        this.bindMomentsPullRefresh();

        // 操作按钮（点赞/评论弹窗）
        document.querySelectorAll('.moment-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const momentId = btn.dataset.momentId;
                this.showActionPopup(btn, momentId);
            });
        });

        this.bindMomentDeleteEvents();

        document.querySelectorAll('.moment-image-prompt-generate').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();
                const momentEl = btn.closest('.moment-item');
                const momentId = momentEl?.dataset?.momentId || '';
                const index = Number.parseInt(btn.dataset.index, 10);
                const parsedPrompt = this._parsePromptDescriptionPair(btn.dataset.prompt || '');
                const promptText = String(parsedPrompt.prompt || btn.dataset.prompt || '').trim();
                const descriptionText = String(btn.dataset.description || '').trim();
                await this.generateMomentImage({ momentId, index, promptText, descriptionText });
            });
        });

        document.querySelectorAll('.moment-image-regenerate').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();
                const momentEl = btn.closest('.moment-item');
                const momentId = momentEl?.dataset?.momentId || '';
                const index = Number.parseInt(btn.dataset.index, 10);
                const parsedPrompt = this._parsePromptDescriptionPair(btn.dataset.prompt || '');
                const promptText = String(parsedPrompt.prompt || btn.dataset.prompt || '').trim();
                const descriptionText = String(btn.dataset.description || '').trim();
                await this.generateMomentImage({ momentId, index, promptText, descriptionText, clearPreviousImage: true });
            });
        });

        document.querySelectorAll('.moment-image-show-desc').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const box = btn.closest('.moment-image-prompt-box, .moment-image-generated-box');
                if (!box) return;
                box.classList.add('is-desc-open');
            });
        });

        document.querySelectorAll('.moment-image-restore').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const box = btn.closest('.moment-image-prompt-box, .moment-image-generated-box');
                if (!box) return;
                box.classList.remove('is-desc-open');
            });
        });

        document.querySelectorAll('.moment-img[data-moment-image-url]').forEach(img => {
            img.addEventListener('click', (e) => {
                e.stopPropagation();
                const imageUrl = e.currentTarget?.dataset?.momentImageUrl || e.currentTarget?.src || '';
                if (imageUrl) {
                    this.app?.phoneShell?.showImageViewer?.(imageUrl, { alt: '朋友圈图片' });
                }
            });
        });

        // 点击评论可以回复（包括自己的评论，方便和其他NPC互动）
        document.querySelectorAll('.comment-row').forEach(row => {
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const momentId = row.dataset.momentId;
                const author = row.dataset.author;
                this.showCommentInput(momentId, author);
            });
        });

        // 🔥 点击其他区域移除内嵌输入框
        document.querySelector('.moments-page')?.addEventListener('click', (e) => {
            if (!e.target.closest('.inline-comment-box') &&
                !e.target.closest('.action-popup') &&
                !e.target.closest('.comment-row')) {
                document.querySelectorAll('.inline-comment-box').forEach(el => el.remove());
                this.currentCommentMomentId = null;
                this.currentReplyTo = null;
            }
            if (!e.target.closest('.moment-delete-btn')) {
                document.querySelectorAll('.moment-item.show-delete').forEach(item => item.classList.remove('show-delete'));
            }
        });
    }

    bindMomentDeleteEvents() {
        const longPressMs = 480;
        const clearOtherDeleteStates = () => {
            document.querySelectorAll('.moment-item.show-delete').forEach(item => item.classList.remove('show-delete'));
        };

        document.querySelectorAll('.moment-item[data-own-moment="1"]').forEach(item => {
            let pressTimer = null;
            let moved = false;
            let startX = 0;
            let startY = 0;

            const clearTimer = () => {
                if (pressTimer) {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                }
            };

            const showDelete = () => {
                clearOtherDeleteStates();
                item.classList.add('show-delete');
            };

            item.addEventListener('touchstart', (e) => {
                if (e.target?.closest?.('.moment-action-btn, .moment-delete-btn, .inline-comment-box, .action-popup, .comment-row, button, input, textarea')) return;
                const touch = e.touches?.[0];
                if (!touch) return;
                moved = false;
                startX = touch.clientX;
                startY = touch.clientY;
                clearTimer();
                pressTimer = setTimeout(() => {
                    if (!moved) showDelete();
                }, longPressMs);
            }, { passive: true });

            item.addEventListener('touchmove', (e) => {
                const touch = e.touches?.[0];
                if (!touch) return;
                if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
                    moved = true;
                    clearTimer();
                }
            }, { passive: true });

            item.addEventListener('touchend', clearTimer, { passive: true });
            item.addEventListener('touchcancel', clearTimer, { passive: true });
            item.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                if (e.target?.closest?.('.moment-action-btn, .moment-delete-btn, .inline-comment-box, .action-popup, .comment-row, button, input, textarea')) return;
                clearTimer();
                pressTimer = setTimeout(showDelete, longPressMs);
            });
            item.addEventListener('mouseup', clearTimer);
            item.addEventListener('mouseleave', clearTimer);
            item.addEventListener('mousemove', clearTimer);
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showDelete();
            });
        });

        document.querySelectorAll('.moment-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const momentId = String(btn.dataset.momentId || '').trim();
                if (!momentId) return;
                const ok = confirm('确定删除这条朋友圈吗？删除后不可恢复。');
                if (!ok) return;
                const targetMoment = this.app.wechatData.getMoment(momentId);
                const managedImageUrls = this._collectMomentManagedImageUrls(targetMoment);
                const deleted = this.app.wechatData.deleteMoment(momentId);
                if (deleted) {
                    this._cleanupManagedMomentImages(managedImageUrls);
                    this.app.phoneShell.showNotification('已删除', '朋友圈已删除', '✅');
                    this.app.render();
                }
            });
        });
    }

    bindMomentsPullRefresh() {
        const momentsPage = document.querySelector('.moments-page');
        if (!momentsPage || momentsPage.dataset.pullRefreshBound === '1') return;
        momentsPage.dataset.pullRefreshBound = '1';

        let startY = 0;
        let startX = 0;
        let pullDistance = 0;
        let pressing = false;
        let pressType = '';
        let previousUserSelect = '';
        const maxPull = 92;
        const triggerThreshold = 62;

        const canPull = () => !this.isLoading && momentsPage.scrollTop <= 2;

        const startPress = (clientX, clientY, type) => {
            if (!canPull()) return false;
            pressing = true;
            pressType = type;
            pullDistance = 0;
            startX = clientX;
            startY = clientY;
            if (type === 'mouse') {
                previousUserSelect = document.body.style.userSelect;
                document.body.style.userSelect = 'none';
            }
            return true;
        };

        const movePress = (clientX, clientY, e) => {
            if (!pressing) return;
            const deltaX = clientX - startX;
            const deltaY = clientY - startY;
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 8) {
                pressing = false;
                pullDistance = 0;
                pressType = '';
                this.syncMomentsPullIndicator();
                return;
            }
            if (deltaY <= 0 || deltaY < 6) return;

            pullDistance = Math.min(maxPull, Math.round(deltaY * 0.55));
            const ready = pullDistance >= triggerThreshold;
            this.setMomentsPullHint(pullDistance, ready ? '松手刷新朋友圈' : '下拉刷新朋友圈', ready);
            if (e?.cancelable) e.preventDefault();
        };

        const endPress = () => {
            if (!pressing) return;
            const shouldTrigger = pullDistance >= triggerThreshold;
            pressing = false;
            pullDistance = 0;
            if (pressType === 'mouse') {
                document.body.style.userSelect = previousUserSelect || '';
                previousUserSelect = '';
            }
            pressType = '';

            if (shouldTrigger) {
                this.loadMomentsFromAI();
            } else {
                this.syncMomentsPullIndicator();
            }
        };

        momentsPage.addEventListener('touchstart', (e) => {
            if (!e.touches || e.touches.length === 0) return;
            startPress(e.touches[0].clientX, e.touches[0].clientY, 'touch');
        }, { passive: true });
        momentsPage.addEventListener('touchmove', (e) => {
            if (!e.touches || e.touches.length === 0) return;
            movePress(e.touches[0].clientX, e.touches[0].clientY, e);
        }, { passive: false });
        momentsPage.addEventListener('touchend', () => {
            if (pressType === 'touch') endPress();
        });
        momentsPage.addEventListener('touchcancel', () => {
            if (pressType === 'touch') endPress();
        });

        let removeMouseGlobalListeners = null;
        const addMouseGlobalListeners = () => {
            const onMouseMove = (e) => {
                if (pressType !== 'mouse') return;
                movePress(e.clientX, e.clientY, e);
            };
            const onMouseUp = () => {
                if (pressType !== 'mouse') return;
                removeMouseGlobalListeners?.();
                endPress();
            };
            const onWindowBlur = () => {
                if (pressType !== 'mouse') return;
                removeMouseGlobalListeners?.();
                endPress();
            };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
            window.addEventListener('blur', onWindowBlur);
            removeMouseGlobalListeners = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                window.removeEventListener('blur', onWindowBlur);
                removeMouseGlobalListeners = null;
            };
        };

        momentsPage.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (e.target?.closest?.('.moment-action-btn, .moment-image-prompt-generate, .inline-comment-box, .action-popup, input, textarea, button')) return;
            if (!startPress(e.clientX, e.clientY, 'mouse')) return;
            e.preventDefault();
            addMouseGlobalListeners();
        });
    }

    setMomentsPullHint(height, text, ready = false) {
        const wrap = document.getElementById('moments-pull-refresh-indicator');
        const inner = document.getElementById('moments-pull-refresh-inner');
        if (!wrap || !inner) return;
        wrap.classList.remove('loading', 'success', 'error');
        wrap.classList.toggle('ready', !!ready);
        wrap.style.height = `${Math.max(0, height)}px`;
        inner.innerHTML = `<i class="fa-solid fa-arrow-down"></i> ${text}`;
    }

    syncMomentsPullIndicator(status = '') {
        const wrap = document.getElementById('moments-pull-refresh-indicator');
        const inner = document.getElementById('moments-pull-refresh-inner');
        if (!wrap || !inner) return;
        wrap.classList.remove('ready', 'loading', 'success', 'error');

        if (this.isLoading || status === 'loading') {
            wrap.classList.add('loading');
            wrap.style.height = '40px';
            inner.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在生成中...';
            return;
        }
        if (status === 'success') {
            wrap.classList.add('success');
            wrap.style.height = '36px';
            inner.innerHTML = '<i class="fa-solid fa-check"></i> 已刷新';
            return;
        }
        if (status === 'error') {
            wrap.classList.add('error');
            wrap.style.height = '36px';
            inner.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> 刷新失败';
            return;
        }
        wrap.style.height = '0px';
        inner.innerHTML = '';
    }

    _escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _escapeAttr(value) {
        return this._escapeHtml(value).replace(/`/g, '&#96;');
    }

    _normalizeImageGenerationError(error) {
        const message = String(error?.message || error || '').trim();
        if (!message) return '生成失败，请重试';
        if (/缺少.*API Key|api key/i.test(message)) return '缺少生图 API Key';
        if (/未启用/.test(message)) return '生图功能未启用';
        if (/rate|429|too many/i.test(message)) return '请求过快，请稍后重试';
        return message.slice(0, 80);
    }

    _blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            try {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(new Error('read_blob_failed'));
                reader.readAsDataURL(blob);
            } catch (err) {
                reject(err);
            }
        });
    }

    async _resolveMomentImageForAi(imageValue, cacheMap = null) {
        const raw = String(imageValue || '').trim();
        if (!raw) return '';
        if (raw.startsWith('data:image')) return raw;
        if (cacheMap && cacheMap.has(raw)) return cacheMap.get(raw);

        const normalizedUrl = (() => {
            try {
                if (/^\/backgrounds\//i.test(raw)) return raw;
                if (/^https?:\/\//i.test(raw)) return raw;
                return new URL(raw, window.location.origin).href;
            } catch (e) {
                return raw;
            }
        })();

        let dataUrl = '';
        try {
            const resp = await fetch(normalizedUrl, { credentials: 'include' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            if (!String(blob?.type || '').startsWith('image/')) {
                throw new Error(`not_image_blob:${blob?.type || 'unknown'}`);
            }
            dataUrl = await this._blobToDataUrl(blob);
        } catch (err) {
            console.warn('[Moments] 图片发送给AI失败，已降级为文字图片标记:', raw, err?.message || err);
            dataUrl = '';
        }

        if (cacheMap) {
            cacheMap.set(raw, dataUrl);
            cacheMap.set(normalizedUrl, dataUrl);
        }
        return dataUrl;
    }

    _isDirectMomentImageUrl(value) {
        const text = String(value || '').trim();
        return /^(data:image\/|data:application\/octet-stream;base64,|https?:\/\/|\/backgrounds\/)/i.test(text);
    }

    _parseMomentImageItem(rawValue) {
        const imageStr = String(rawValue || '').trim();
        let body = imageStr;
        const taggedMatch = imageStr.match(/^\[(用户照片|个人图片|图片|视频)\]\s*([\s\S]*)$/);
        const mediaType = taggedMatch ? String(taggedMatch[1] || '').trim() : '图片';
        if (taggedMatch) body = String(taggedMatch[2] || '').trim();
        const unwrappedBody = body.replace(/^[（(]\s*|\s*[)）]$/g, '').trim();
        const directUrl = this._isDirectMomentImageUrl(body)
            ? body
            : (this._isDirectMomentImageUrl(unwrappedBody) ? unwrappedBody : '');

        let promptText = '';
        let descriptionText = '';
        if (!directUrl) {
            const parsedPrompt = this._parsePromptDescriptionPair(body);
            promptText = parsedPrompt.prompt || unwrappedBody || body;
            descriptionText = parsedPrompt.description || promptText;
            if (!taggedMatch && /^\[[^\]]+\]$/.test(imageStr)) {
                promptText = imageStr.slice(1, -1).trim();
                descriptionText = promptText;
            }
        }

        return {
            realUrl: directUrl,
            isDirectImage: !!directUrl,
            promptText: promptText.trim(),
            descriptionText: descriptionText.trim(),
            mediaType,
            usePersonalReference: mediaType === '个人图片',
            useUserReference: mediaType === '用户照片'
        };
    }

    _parsePromptDescriptionPair(rawValue = '') {
        const raw = String(rawValue || '').trim()
            .replace(/^\[(?:用户照片|个人图片|图片|视频)\]\s*/i, '');
        const parts = [];
        const bracketRegex = /[（(]\s*([\s\S]*?)\s*[)）]/g;
        let match;
        while ((match = bracketRegex.exec(raw)) !== null) {
            const text = String(match[1] || '').trim();
            if (text) parts.push(text);
        }
        if (parts.length >= 2) {
            return {
                description: parts[0],
                prompt: parts.slice(1).join(', ')
            };
        }
        const single = parts[0] || raw.replace(/^[（(]\s*|\s*[)）]$/g, '').trim();
        return {
            description: single,
            prompt: single
        };
    }

    _hasCjkText(value = '') {
        return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(String(value || ''));
    }

    _collectMomentManagedImageUrls(moment) {
        if (!moment || !Array.isArray(moment.images)) return [];
        const urls = moment.images
            .map((item) => this._parseMomentImageItem(item))
            .filter((parsed) => parsed?.isDirectImage && parsed?.realUrl)
            .map((parsed) => String(parsed.realUrl || '').trim())
            .filter((url) => url.startsWith('/backgrounds/'));
        return [...new Set(urls)];
    }

    _cleanupManagedMomentImages(urls = [], options = {}) {
        const uniqueUrls = [...new Set((Array.isArray(urls) ? urls : [])
            .map((url) => String(url || '').trim())
            .filter((url) => url.startsWith('/backgrounds/')))];
        if (uniqueUrls.length === 0) return;
        const imageManager = window.VirtualPhone?.imageManager;
        if (!imageManager?.deleteManagedBackgroundByPath) return;
        uniqueUrls.forEach((url) => {
            imageManager.deleteManagedBackgroundByPath(url, {
                quiet: true,
                skipIfReferenced: true,
                ...(options || {})
            }).catch(() => {});
        });
    }

    _mountPostDraftObserver() {
        this._unmountPostDraftObserver();
        if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
        this._postMomentDraftObserver = new MutationObserver(() => {
            if (!this._postMomentDraftActive) return;
            // 发圈输入框已离开DOM，说明用户切离了发圈页
            if (!document.getElementById('moment-text-input')) {
                this._leavePostMomentDraft({ published: this._postMomentDraftCommitted });
            }
        });
        this._postMomentDraftObserver.observe(document.body, { childList: true, subtree: true });
    }

    _unmountPostDraftObserver() {
        if (this._postMomentDraftObserver) {
            this._postMomentDraftObserver.disconnect();
            this._postMomentDraftObserver = null;
        }
    }

    _leavePostMomentDraft({ published = false } = {}) {
        if (!this._postMomentDraftActive && (!this.pendingMomentImages || this.pendingMomentImages.length === 0)) {
            this._postMomentDraftCommitted = false;
            this._unmountPostDraftObserver();
            return;
        }
        if (!published && Array.isArray(this.pendingMomentImages) && this.pendingMomentImages.length > 0) {
            this._cleanupManagedMomentImages(this.pendingMomentImages);
        }
        this.pendingMomentImages = [];
        this._postMomentDraftActive = false;
        this._postMomentDraftCommitted = false;
        this._unmountPostDraftObserver();
    }

    _startPostMomentDraft() {
        // 若有上一轮未发布草稿残留，先清掉，避免孤儿图片
        this._leavePostMomentDraft({ published: false });
        this._postMomentDraftActive = true;
        this._postMomentDraftCommitted = false;
        this.pendingMomentImages = [];
        this._mountPostDraftObserver();
    }

    _getMomentById(momentId) {
        const safeId = String(momentId || '').trim();
        const moments = this.app.wechatData.getMoments();
        return Array.isArray(moments) ? moments.find(item => String(item?.id || '').trim() === safeId) : null;
    }

    _getMomentImageState(moment, index) {
        if (!moment || !Array.isArray(moment.imageGenerationStates)) return null;
        const state = moment.imageGenerationStates[index];
        return state && typeof state === 'object' ? state : null;
    }

    _setMomentImageState(moment, index, nextState) {
        if (!moment || !Number.isInteger(index) || index < 0) return;
        if (!Array.isArray(moment.imageGenerationStates)) moment.imageGenerationStates = [];
        if (nextState === null) {
            delete moment.imageGenerationStates[index];
            return;
        }
        const prev = this._getMomentImageState(moment, index) || {};
        moment.imageGenerationStates[index] = { ...prev, ...nextState };
    }

    _refreshMomentImageUI(momentId) {
        const momentsPage = document.querySelector('.moments-page');
        const scrollTop = momentsPage?.scrollTop || 0;
        this.app.render();
        setTimeout(() => {
            const nextPage = document.querySelector('.moments-page');
            if (nextPage) nextPage.scrollTop = scrollTop;
        }, 0);
    }

    async generateMomentImage({ momentId, index, promptText, descriptionText = '', clearPreviousImage = false } = {}) {
        const parsedIncomingPrompt = this._parsePromptDescriptionPair(promptText);
        promptText = String(parsedIncomingPrompt.prompt || promptText || '').trim();
        descriptionText = String(descriptionText || parsedIncomingPrompt.description || '').trim();
        if (!momentId || !Number.isInteger(index) || index < 0 || !promptText) return;
        const moment = this._getMomentById(momentId);
        if (!moment) return;
        if (this._hasCjkText(promptText)) {
            this._setMomentImageState(moment, index, {
                status: 'failed',
                error: '缺少英文生图Tag：第二个括号必须只写英文逗号分隔 tags',
                prompt: promptText,
                description: descriptionText || promptText
            });
            await this.app.wechatData.saveData();
            this._refreshMomentImageUI(momentId);
            this.app.phoneShell.showNotification('生图格式错误', '缺少英文生图Tag，请使用 [图片]（中文描述）（English tags）', '⚠️');
            return;
        }
        const currentState = this._getMomentImageState(moment, index);
        if (currentState?.status === 'loading') return;

        const imageManager = window.VirtualPhone?.imageGenerationManager;
        const imageStorage = this.app?.storage || window.VirtualPhone?.storage || null;
        if (!imageManager || typeof imageManager.generate !== 'function') {
            this._setMomentImageState(moment, index, {
                status: 'failed',
                error: '生图管理器未初始化',
                prompt: promptText,
                description: descriptionText || promptText
            });
            await this.app.wechatData.saveData();
            this._refreshMomentImageUI(momentId);
            this.app.phoneShell.showNotification('生图失败', '生图管理器未初始化', '❌');
            return;
        }

        if (imageStorage && imageManager.storage !== imageStorage) {
            imageManager.storage = imageStorage;
        }
        const resolvedImageProvider = String(imageManager.resolveProvider?.({ app: 'wechat' }) || imageStorage?.get?.('phone-image-provider') || '').trim();

        const previousImageUrl = this._getManagedMomentGeneratedImageUrl(moment, index);
        const parsedImage = this._parseMomentImageItem(Array.isArray(moment.images) ? moment.images[index] : '');
        const mediaType = parsedImage.mediaType || '图片';
        const displayDescription = String(descriptionText || parsedImage.descriptionText || promptText || '').trim();
        const usePersonalReference = parsedImage.usePersonalReference === true;
        const useUserReference = parsedImage.useUserReference === true;
        if (clearPreviousImage && Array.isArray(moment.images)) {
            moment.images[index] = displayDescription && displayDescription !== promptText
                ? `[${mediaType}]（${displayDescription}）（${promptText}）`
                : `[${mediaType}]（${promptText}）`;
        }
        const novelAIReferences = await this._buildMomentPersonalImageReferences(moment, index);
        const generationPrompt = this._buildMomentImagePromptWithContactTags(moment, index, promptText);
        const generationId = `moment_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        this._setMomentImageState(moment, index, {
            status: 'loading',
            error: '',
            prompt: promptText,
            description: displayDescription,
            generationId,
            mediaType,
            usePersonalReference,
            useUserReference,
            generatedImageUrl: '',
            imageProvider: resolvedImageProvider
        });
        await this.app.wechatData.saveData();
        this._refreshMomentImageUI(momentId);

        try {
            const result = await imageManager.generate({
                app: 'wechat',
                prompt: generationPrompt,
                novelAIReferences
            });
            const rawImageUrl = String(result?.imageUrl || result?.imageData || '').trim();
            const imageUrl = await this._persistMomentGeneratedImage(rawImageUrl, {
                momentId,
                index,
                promptText,
                generationId
            });
            if (!imageUrl) throw new Error('生图成功但未返回图片URL');

            const latestMoment = this._getMomentById(momentId) || moment;
            if (!Array.isArray(latestMoment.images)) latestMoment.images = [];
            latestMoment.images[index] = `[${mediaType}]${imageUrl}`;
            this._setMomentImageState(latestMoment, index, {
                status: 'done',
                error: '',
                prompt: promptText,
                description: displayDescription,
                mediaType,
                usePersonalReference,
                useUserReference,
                generatedImageUrl: imageUrl,
                imageModel: String(result?.model || '').trim(),
                imageProvider: String(result?.provider || '').trim(),
                imageGenerationWidth: Number(result?.width || result?.requestedWidth || 0) || '',
                imageGenerationHeight: Number(result?.height || result?.requestedHeight || 0) || ''
            });
            await this.app.wechatData.saveData();
            this._cleanupReplacedMomentGeneratedImage(previousImageUrl, imageUrl);
            this._refreshMomentImageUI(momentId);
            this.app.phoneShell.showNotification('成功', '朋友圈配图生成完成', '✅');
        } catch (error) {
            const friendlyMessage = this._normalizeImageGenerationError(error);
            const latestMoment = this._getMomentById(momentId) || moment;
            this._setMomentImageState(latestMoment, index, {
                status: 'failed',
                error: friendlyMessage,
                prompt: promptText,
                description: displayDescription,
                mediaType,
                usePersonalReference,
                useUserReference,
                generatedImageUrl: '',
                imageProvider: resolvedImageProvider
            });
            await this.app.wechatData.saveData();
            this._refreshMomentImageUI(momentId);
            this.app.phoneShell.showNotification('生图失败', friendlyMessage, '❌');
        }
    }

    async _persistMomentGeneratedImage(imageUrl, { momentId = '', index = 0, promptText = '', generationId = '' } = {}) {
        const safeUrl = String(imageUrl || '').trim();
        if (!safeUrl) return '';
        if (/^\/backgrounds\/phone_[^?#]+/i.test(safeUrl)) return safeUrl;

        const imageUploader = window.VirtualPhone?.imageManager;
        if (!imageUploader?.uploadBlob) {
            throw new Error('图片上传管理器未初始化，无法保存朋友圈生图');
        }

        const blob = await this._loadGeneratedMomentImageBlob(safeUrl);
        const uniquePart = String(generationId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_');
        const seed = `${momentId || 'moment'}_${index}_${this._simpleImageHash(promptText || safeUrl).toString(36)}_${uniquePart}`;
        const uploadedUrl = await imageUploader.uploadBlob(blob, `moment_img_${seed}`);
        const normalized = String(uploadedUrl || '').trim();
        if (!/^\/backgrounds\/phone_[^?#]+/i.test(normalized)) {
            throw new Error('朋友圈生图保存失败：未得到有效本地图片路径');
        }
        return normalized;
    }

    async _loadGeneratedMomentImageBlob(imageUrl) {
        const safeUrl = String(imageUrl || '').trim();
        if (!safeUrl) throw new Error('生图结果为空');
        const response = await fetch(safeUrl, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`读取朋友圈生图失败（HTTP ${response.status}）`);
        }
        const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const arrayBuffer = await response.arrayBuffer();
        if (!arrayBuffer || arrayBuffer.byteLength <= 0) {
            throw new Error('朋友圈生图结果不是有效图片');
        }
        const bytes = new Uint8Array(arrayBuffer);
        const mime = /^image\//i.test(contentType)
            ? contentType
            : this._detectGeneratedMomentImageMime(bytes);
        if (!mime) throw new Error('朋友圈生图结果不是有效图片');
        const blob = new Blob([arrayBuffer], { type: mime });
        return blob;
    }

    _detectGeneratedMomentImageMime(bytes) {
        if (!bytes || bytes.length < 4) return '';
        if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
        if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
        if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
        if (
            bytes.length >= 12 &&
            bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
            bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
        ) {
            return 'image/webp';
        }
        return '';
    }

    _simpleImageHash(text) {
        const str = String(text || '');
        let hash = 2166136261;
        for (let i = 0; i < str.length; i += 1) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    _getManagedMomentGeneratedImageUrl(moment, index) {
        const candidates = [
            Array.isArray(moment?.images) ? moment.images[index] : '',
            this._getMomentImageState(moment, index)?.generatedImageUrl
        ];
        for (const item of candidates) {
            const parsed = this._parseMomentImageItem(item);
            const raw = String(parsed?.realUrl || item || '').trim();
            const match = raw.match(/\/backgrounds\/phone_moment_img_[^?#\s)）]+/i);
            if (match?.[0]) return match[0];
        }
        return '';
    }

    _cleanupReplacedMomentGeneratedImage(oldUrl, nextUrl = '') {
        const oldPath = String(oldUrl || '').trim();
        const nextPath = String(nextUrl || '').trim();
        if (!oldPath || oldPath === nextPath || !/^\/backgrounds\/phone_moment_img_/i.test(oldPath)) return;
        this._cleanupManagedMomentImages([oldPath]);
    }

    async _imageUrlToMomentReferenceDataUrl(url) {
        const safeUrl = String(url || '').trim();
        if (!safeUrl) return '';
        if (safeUrl.startsWith('data:image/')) return safeUrl;
        const response = await fetch(safeUrl, {
            credentials: 'include',
            cache: 'no-store'
        });
        if (!response.ok) {
            throw new Error(`个人形象参考图读取失败 (${response.status})`);
        }
        const blob = await response.blob();
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('个人形象参考图读取失败'));
            reader.readAsDataURL(blob);
        });
        if (!dataUrl.startsWith('data:image/')) return '';
        return dataUrl;
    }

    _resolveMomentPersonalReferenceContact(moment = null, index = 0) {
        const parsed = this._parseMomentImageItem(Array.isArray(moment?.images) ? moment.images[index] : '');
        const state = this._getMomentImageState(moment, index);
        const usePersonalReference = parsed.usePersonalReference === true
            || state?.usePersonalReference === true
            || String(state?.mediaType || '').trim() === '个人图片';
        if (!usePersonalReference || parsed.mediaType === '视频') return null;

        const senderName = String(moment?.name || '').trim();
        if (!senderName) return null;
        const userName = String(this.app?.wechatData?.getUserInfo?.()?.name || '').trim();
        if (userName && senderName === userName) return null;

        const contacts = this.app?.wechatData?.getContacts?.() || [];
        return contacts.find(contact => this.app.wechatData._isSameLookupName?.(contact.name, senderName))
            || contacts.find(contact => String(contact?.name || '').trim() === senderName)
            || null;
    }

    _buildMomentImagePromptWithContactTags(moment = null, index = 0, promptText = '') {
        const parsedPrompt = this._parsePromptDescriptionPair(promptText);
        const basePrompt = String(parsedPrompt.prompt || promptText || '').trim();
        const parsed = this._parseMomentImageItem(Array.isArray(moment?.images) ? moment.images[index] : '');
        const state = this._getMomentImageState(moment, index);
        const useUserReference = parsed.useUserReference === true
            || state?.useUserReference === true
            || String(state?.mediaType || '').trim() === '用户照片';
        if (useUserReference) {
            const userInfo = this.app?.wechatData?.getUserInfo?.() || {};
            const userTags = String(userInfo?.naiPromptTags || userInfo?.imageTags || '')
                .split(/[,，\n]+/)
                .map(tag => tag.trim())
                .filter(Boolean)
                .join(', ');
            if (!userTags) return basePrompt;
            if (!basePrompt) return userTags;
            return `${userTags}, ${basePrompt}`;
        }
        const contact = this._resolveMomentPersonalReferenceContact(moment, index);
        const contactTags = String(contact?.naiPromptTags || contact?.imageTags || '')
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean)
            .join(', ');
        if (!contactTags) return basePrompt;
        if (!basePrompt) return contactTags;
        return `${contactTags}, ${basePrompt}`;
    }

    async _buildMomentPersonalImageReferences(moment = null, index = 0) {
        const contact = this._resolveMomentPersonalReferenceContact(moment, index);
        if (!contact) return [];
        const referenceImage = String(contact.naiReferenceImage || contact.referenceImage || '').trim();
        if (!referenceImage || contact.naiReferenceEnabled === false || contact.naiReferenceEnabled === 'false') return [];
        try {
            const image = await this._imageUrlToMomentReferenceDataUrl(referenceImage);
            if (!image) return [];
            const rawStrength = Number(contact.naiReferenceStrength ?? 0.7);
            const strength = Math.max(0, Math.min(1, Number.isFinite(rawStrength) ? rawStrength : 0.7));
            const rawInfo = Number(contact.naiReferenceInformationExtracted ?? 1);
            const informationExtracted = Math.max(0, Math.min(1, Number.isFinite(rawInfo) ? rawInfo : 1));
            return [{ image, strength, informationExtracted }];
        } catch (err) {
            console.warn('[Moments NAI] 个人形象参考图读取失败，已跳过:', err);
            this.app?.phoneShell?.showNotification?.('朋友圈', '个人形象参考图读取失败，本次将不使用参考图', '⚠️');
            return [];
        }
    }

    // 显示操作弹窗
    showActionPopup(btn, momentId) {
        // 🔥 检查当前按钮是否已有弹窗
        const existingPopup = btn.querySelector('.action-popup');

        // 移除所有弹窗
        document.querySelectorAll('.action-popup').forEach(p => p.remove());

        // 🔥 如果当前按钮已有弹窗，移除后直接返回（切换关闭）
        if (existingPopup) {
            return;
        }

        const moment = this.app.wechatData.getMoment(momentId);
        const userInfo = this.app.wechatData.getUserInfo();
        const isLiked = moment?.likeList?.includes(userInfo.name);

        const popup = document.createElement('div');
        popup.className = 'action-popup';
        popup.innerHTML = `
            <div class="action-popup-btn like-btn" data-moment-id="${momentId}">
                <i class="fa-solid fa-heart"></i>
                <span>${isLiked ? '取消' : '赞'}</span>
            </div>
            <div class="action-popup-btn comment-btn" data-moment-id="${momentId}">
                <i class="fa-solid fa-comment"></i>
                <span>评论</span>
            </div>
        `;

        // 🔥 直接添加到按钮内部（按钮已经是 position: relative）
        btn.appendChild(popup);

        // 点赞
        popup.querySelector('.like-btn')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.toggleLike(momentId);
            popup.remove();
        });

        // 评论
        popup.querySelector('.comment-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            popup.remove();
            this.showCommentInput(momentId);
        });

        // 点击外部关闭
        setTimeout(() => {
            document.addEventListener('click', function closePopup(e) {
                if (!popup.contains(e.target) && !btn.contains(e.target)) {
                    popup.remove();
                    document.removeEventListener('click', closePopup);
                }
            });
        }, 10);
    }

    // 点赞/取消点赞
    toggleLike(momentId) {
        const moment = this.app.wechatData.getMoment(momentId);
        if (!moment) return;

        const userInfo = this.app.wechatData.getUserInfo();
        if (!moment.likeList) moment.likeList = [];

        const index = moment.likeList.indexOf(userInfo.name);

        if (index === -1) {
            moment.likeList.push(userInfo.name);
        } else {
            moment.likeList.splice(index, 1);
        }

        moment.likes = moment.likeList.length;
        this.app.wechatData.saveData();

        // 🔥 局部更新点赞区域，不刷新整个页面
        this.updateMomentInteractions(momentId);
    }

    // 🔥 局部更新朋友圈互动区
    updateMomentInteractions(momentId) {
        const moment = this.app.wechatData.getMoment(momentId);
        if (!moment) return;

        const momentEl = document.querySelector(`.moment-item[data-moment-id="${momentId}"]`);
        if (!momentEl) return;

        // 🔥 保存滚动位置，防止页面跳动
        const momentsPage = document.querySelector('.moments-page');
        const scrollTop = momentsPage?.scrollTop || 0;

        // 找到或创建互动区
        let interactionsEl = momentEl.querySelector('.moment-interactions');
        const contentCol = momentEl.querySelector('.moment-content-col');

        const hasLikes = moment.likeList && moment.likeList.length > 0;
        const hasComments = moment.commentList && moment.commentList.length > 0;

        if (!hasLikes && !hasComments) {
            // 没有互动，移除互动区
            if (interactionsEl) interactionsEl.remove();
            // 🔥 恢复滚动位置
            if (momentsPage) momentsPage.scrollTop = scrollTop;
            return;
        }

        // 生成新的互动区HTML
        const newHtml = this.renderInteractions(moment);

        if (interactionsEl) {
            // 更新现有互动区
            interactionsEl.outerHTML = newHtml;
        } else {
            // 插入新互动区
            contentCol.insertAdjacentHTML('beforeend', newHtml);
        }

        // 🔥 恢复滚动位置
        if (momentsPage) momentsPage.scrollTop = scrollTop;

        // 重新绑定评论点击事件
        const newInteractionsEl = momentEl.querySelector('.moment-interactions');
        if (newInteractionsEl) {
            newInteractionsEl.querySelectorAll('.comment-row').forEach(row => {
                row.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const rowMomentId = row.dataset.momentId;
                    const author = row.dataset.author;
                    this.showCommentInput(rowMomentId, author);
                });
            });
        }
    }

    // 显示评论输入框（内嵌版）
    showCommentInput(momentId, replyTo = null) {
        const moment = this.app.wechatData.getMoment(momentId);
        if (!moment) {
            return;
        }

        // 先移除之前的输入框
        document.querySelectorAll('.inline-comment-box').forEach(el => el.remove());

        // 保存当前评论目标
        this.currentCommentMomentId = momentId;
        this.currentReplyTo = replyTo;

        // 找到对应的朋友圈元素
        const momentEl = document.querySelector(`.moment-item[data-moment-id="${momentId}"]`);
        if (!momentEl) return;

        // 找到互动区或创建一个
        let interactionsEl = momentEl.querySelector('.moment-interactions');
        if (!interactionsEl) {
            interactionsEl = document.createElement('div');
            interactionsEl.className = 'moment-interactions';
            momentEl.querySelector('.moment-content-col').appendChild(interactionsEl);
        }

        // 创建内嵌输入框
        const inputBox = document.createElement('div');
        inputBox.className = 'inline-comment-box';
        inputBox.innerHTML = `
            <input type="text" class="inline-comment-input" placeholder="${replyTo ? `回复 ${replyTo}` : '评论'}" autofocus>
            <button class="inline-comment-send"><i class="fa-solid fa-paper-plane"></i></button>
        `;
        interactionsEl.appendChild(inputBox);

        // 绑定事件
        const input = inputBox.querySelector('.inline-comment-input');
        const sendBtn = inputBox.querySelector('.inline-comment-send');

        input.focus();

        sendBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.submitInlineComment(input.value, inputBox);
        });

        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.stopPropagation();
                this.submitInlineComment(input.value, inputBox);
            }
        });

        input.addEventListener('click', (e) => e.stopPropagation());
        inputBox.addEventListener('click', (e) => e.stopPropagation());

        // 滚动到输入框可见
        inputBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // 提交内嵌评论
    submitInlineComment(text, inputBox) {
        const comment = text?.trim();
        if (!comment || !this.currentCommentMomentId) return;

        const moment = this.app.wechatData.getMoment(this.currentCommentMomentId);
        if (!moment) return;

        if (!moment.commentList) moment.commentList = [];

        const userInfo = this.app.wechatData.getUserInfo();
        moment.commentList.push({
            name: userInfo.name,
            text: comment,
            replyTo: this.currentReplyTo || null
        });

        moment.comments = moment.commentList.length;
        this.app.wechatData.saveData();

        // 保存用于AI回复
        const momentId = this.currentCommentMomentId;
        const replyTo = this.currentReplyTo;

        // 清空状态
        this.currentCommentMomentId = null;
        this.currentReplyTo = null;

        // 刷新界面
        this.app.render();

        // 触发AI回复
        this.triggerAIReaction(momentId, 'comment', comment, replyTo);
    }

    // 🔥 提交评论
    async submitComment() {
        const input = document.getElementById('moments-comment-input');
        const commentBar = document.getElementById('moments-comment-bar');
        const comment = input?.value?.trim();

        if (!comment || !this.currentCommentMomentId) return;

        const moment = this.app.wechatData.getMoment(this.currentCommentMomentId);
        if (!moment) return;

        if (!moment.commentList) moment.commentList = [];

        const userInfo = this.app.wechatData.getUserInfo();
        moment.commentList.push({
            name: userInfo.name,
            text: comment,
            replyTo: this.currentReplyTo || null
        });

        moment.comments = moment.commentList.length;
        this.app.wechatData.saveData();

        // 隐藏输入框
        if (commentBar) commentBar.style.display = 'none';

        // 保存momentId用于AI回复
        const momentId = this.currentCommentMomentId;
        const replyTo = this.currentReplyTo;

        // 清空状态
        this.currentCommentMomentId = null;
        this.currentReplyTo = null;

        // 刷新界面
        this.app.render();

        // 触发AI回复
        await this.triggerAIReaction(momentId, 'comment', comment, replyTo);
    }

    // 触发AI反应（回复评论、回赞等）
    async triggerAIReaction(momentId, actionType, userComment = '', replyTo = null) {
        const moment = this.app.wechatData.getMoment(momentId);
        if (!moment) return;

        const userInfo = this.app.wechatData.getUserInfo();
        const aiImageDataCache = new Map();
        const aiImageNotes = [];
        const momentImages = Array.isArray(moment.images) ? moment.images : [];
        for (let i = 0; i < momentImages.length; i++) {
            const parsed = this._parseMomentImageItem(momentImages[i]);
            const imageLabel = parsed.descriptionText || parsed.promptText || `图片${i + 1}`;
            if (parsed.isDirectImage && parsed.realUrl) {
                const resolvedImageData = await this._resolveMomentImageForAi(parsed.realUrl, aiImageDataCache);
                if (resolvedImageData && resolvedImageData.startsWith('data:image')) {
                    const imgId = `__ST_PHONE_IMAGE_${Date.now()}_${Math.random().toString(36).substr(2, 5)}__`;
                    if (!window.VirtualPhone._pendingImages) {
                        window.VirtualPhone._pendingImages = {};
                    }
                    window.VirtualPhone._pendingImages[imgId] = resolvedImageData;
                    aiImageNotes.push(`- 图片${i + 1}：${imageLabel} ${imgId}`);
                } else {
                    aiImageNotes.push(`- 图片${i + 1}：${imageLabel || '[图片]'}`);
                }
                continue;
            }
            if (imageLabel) {
                aiImageNotes.push(`- 图片${i + 1}：${imageLabel}`);
            }
        }
        const contactNames = (this.app.wechatData.getContacts() || [])
            .map(c => (c?.name || '').trim())
            .filter(Boolean);
        const allowedContactSet = new Set(contactNames);

        const promptManager = window.VirtualPhone?.promptManager;
        const interactionTemplate = promptManager?.getPromptForFeature?.('wechat', 'momentsInteraction') || '';
        const actionTypeText = actionType === 'like' ? '点赞' : actionType === 'comment' ? '评论' : '发布朋友圈';
        const promptVars = {
            '{{userName}}': userInfo.name || '用户',
            '{{momentAuthor}}': moment.name || '未知',
            '{{momentContent}}': moment.text || '[图片]',
            '{{currentLikes}}': moment.likeList?.join('、') || '无',
            '{{currentComments}}': moment.commentList?.map(c => `${c.name}${c.replyTo ? '回复' + c.replyTo : ''}：${c.text}`).join('\n') || '无',
            '{{contactNames}}': contactNames.join('、') || '无',
            '{{imageNotes}}': aiImageNotes.length > 0 ? `\n- 图片内容参考（含多模态图片数据）：\n${aiImageNotes.join('\n')}` : '',
            '{{actionType}}': actionTypeText,
            '{{userCommentLine}}': actionType === 'comment' ? `- 评论内容：${userComment}` : '',
            '{{postContentLine}}': actionType === 'post' ? `- 发布内容：${userComment || moment.text || '[图片]'}${moment.images?.length ? `（含${moment.images.length}张图片）` : ''}` : '',
            '{{replyToLine}}': replyTo ? `- 回复对象：${replyTo}` : ''
        };

        const buildPromptFromTemplate = (template) => {
            let next = String(template || '');
            Object.entries(promptVars).forEach(([key, value]) => {
                next = next.split(key).join(String(value || ''));
            });
            return next;
        };

        const fallbackPrompt = `【朋友圈互动回复任务】
用户"${userInfo.name}"在朋友圈进行了互动，请生成合适的回复。
朋友圈信息：
- 发布者：${moment.name}
- 内容：${moment.text || '[图片]'}
- 现有点赞：${moment.likeList?.join('、') || '无'}
- 现有评论：${moment.commentList?.map(c => `${c.name}${c.replyTo ? '回复' + c.replyTo : ''}：${c.text}`).join('\n') || '无'}
- 可用通讯录好友（仅可从这里选择回复者/点赞者）：${contactNames.join('、') || '无'}
${aiImageNotes.length > 0 ? `\n- 图片内容参考（含多模态图片数据）：\n${aiImageNotes.join('\n')}` : ''}
用户行为：
- 类型：${actionTypeText}
${actionType === 'comment' ? `- 评论内容：${userComment}` : ''}
${actionType === 'post' ? `- 发布内容：${userComment || moment.text || '[图片]'}${moment.images?.length ? `（含${moment.images.length}张图片）` : ''}` : ''}
${replyTo ? `- 回复对象：${replyTo}` : ''}
请只返回JSON，包含 shouldReply 与 reactions（type 仅 comment/like，name 必须来自通讯录好友）。`;
        const prompt = interactionTemplate ? buildPromptFromTemplate(interactionTemplate) : fallbackPrompt;

        try {
            this.app.phoneShell.showNotification('朋友圈', '好友围观中...', '👀');

            const result = await this.callAI(prompt);
            const reactions = this._normalizeMomentReactions(result, allowedContactSet, userInfo.name, {
                momentAuthor: moment.name || '',
                userName: userInfo.name || ''
            });

            if (reactions.length > 0) {
                let appliedCount = 0;
                let commentAppliedCount = 0;
                let likeAppliedCount = 0;
                // 延迟添加回复，模拟真实感
                for (let i = 0; i < reactions.length; i++) {
                    const reaction = reactions[i];
                    const reactionName = reaction.name;

                    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

                    // 每轮都重新获取最新 moment，避免 await 期间对象已被 loadData/render 替换
                    const liveMoment = this.app.wechatData.getMoment(momentId);
                    if (!liveMoment) {
                        console.warn('⚠️ [朋友圈] 目标动态已不存在，停止写入互动:', momentId);
                        break;
                    }

                    if (reaction.type === 'comment' && reaction.text) {
                        if (!liveMoment.commentList) liveMoment.commentList = [];
                        liveMoment.commentList.push({
                            name: reactionName,
                            text: reaction.text,
                            replyTo: reaction.replyTo || null
                        });
                        liveMoment.comments = liveMoment.commentList.length;
                        appliedCount++;
                        commentAppliedCount++;
                    } else if (reaction.type === 'like') {
                        if (!liveMoment.likeList) liveMoment.likeList = [];
                        if (!liveMoment.likeList.includes(reactionName)) {
                            liveMoment.likeList.push(reactionName);
                            liveMoment.likes = liveMoment.likeList.length;
                            appliedCount++;
                            likeAppliedCount++;
                        }
                    }
                }

                if (appliedCount > 0) {
                    this.app.wechatData.saveData();
                    this.app.render();
                    const notifyText = commentAppliedCount > 0
                        ? (likeAppliedCount > 0 ? '收到新评论和点赞' : '收到新评论')
                        : '收到新点赞';
                    this.app.phoneShell.showNotification('朋友圈', notifyText, '💬');
                } else {
                    console.warn('⚠️ [朋友圈] AI返回了互动，但全部被过滤或去重，未落库');
                }
            }
        } catch (error) {
            console.error('❌ AI回复失败:', error);
            // 静默失败，不打扰用户
        }
    }

    _normalizeMomentReactions(result, allowedContactSet, defaultReplyTo, options = {}) {
        const normalizeName = (value) => String(value || '')
            .trim()
            .replace(/^@+/, '')
            .replace(/[，,。；;：:\s]+$/g, '')
            .trim();
        const momentAuthor = String(options?.momentAuthor || '').trim();
        const userName = String(options?.userName || '').trim();
        const authorAliases = new Set(['发布者', '作者', '博主', '楼主']);
        const canonicalName = (value) => {
            const raw = normalizeName(value);
            if (!raw) return '';
            if (authorAliases.has(raw)) {
                // 发布者就是用户本人时，禁止自动代替用户发言
                if (momentAuthor && userName && momentAuthor === userName) return '';
                if (momentAuthor) return momentAuthor;
            }
            if (raw === '我' || raw === '自己' || raw === '{{user}}') {
                return '';
            }
            if (allowedContactSet.has(raw)) return raw;
            const key = raw.replace(/\s+/g, '').toLowerCase();
            const matched = [...allowedContactSet].find((name) => String(name || '').replace(/\s+/g, '').toLowerCase() === key);
            return matched || '';
        };
        const ensureReplyTo = (replyTo) => {
            const cleaned = normalizeName(replyTo || '');
            if (!cleaned) return String(defaultReplyTo || '').trim() || null;
            if (authorAliases.has(cleaned)) return momentAuthor || String(defaultReplyTo || '').trim() || null;
            return cleaned;
        };

        const parseXmlLike = (rawText) => {
            const text = String(rawText || '').trim();
            if (!text) return [];
            const blockMatch = text.match(/<朋友圈互动>([\s\S]*?)<\/朋友圈互动>/i);
            const payload = (blockMatch ? blockMatch[1] : text).trim();
            if (!payload) return [];

            const rows = payload.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
            const parsed = [];
            rows.forEach((line) => {
                const likeMatch = /^\[点赞\]\s*(.+)$/i.exec(line);
                if (likeMatch) {
                    likeMatch[1]
                        .split(/[，,]/)
                        .map(item => canonicalName(item))
                        .filter(Boolean)
                        .forEach((name) => parsed.push({ type: 'like', name }));
                    return;
                }

                const replyMatch = /^(.+?)\s*回复\s*(.+?)\s*[：:]\s*(.+)$/.exec(line);
                if (replyMatch) {
                    const name = canonicalName(replyMatch[1]);
                    const replyTo = ensureReplyTo(replyMatch[2]);
                    const textValue = String(replyMatch[3] || '').trim();
                    if (!name || !textValue) return;
                    parsed.push({ type: 'comment', name, text: textValue, replyTo });
                    return;
                }

                const commentMatch = /^(.+?)[：:]\s*(.+)$/.exec(line);
                if (commentMatch) {
                    const name = canonicalName(commentMatch[1]);
                    const textValue = String(commentMatch[2] || '').trim();
                    if (!name || !textValue) return;
                    parsed.push({ type: 'comment', name, text: textValue, replyTo: ensureReplyTo('') });
                }
            });

            return parsed;
        };

        const rows = Array.isArray(result?.reactions)
            ? result.reactions
            : (Array.isArray(result?.data?.reactions) ? result.data.reactions : []);
        const output = [];
        const pushReaction = (item) => {
            const typeRaw = String(item?.type || '').trim().toLowerCase();
            const type = typeRaw === '点赞' ? 'like' : (typeRaw === '评论' ? 'comment' : typeRaw);
            if (type !== 'comment' && type !== 'like') return;

            const name = canonicalName(item?.name || '');
            if (!name) return;

            if (type === 'comment') {
                const text = String(item?.text || item?.content || '').trim();
                if (!text) return;
                output.push({
                    type: 'comment',
                    name,
                    text,
                    replyTo: ensureReplyTo(item?.replyTo)
                });
                return;
            }

            output.push({
                type: 'like',
                name
            });
        };

        if (rows.length > 0) {
            rows.forEach(pushReaction);
        } else {
            const xmlSource = String(result?.raw || result?.text || result?.content || result?.summary || '').trim();
            parseXmlLike(xmlSource).forEach(pushReaction);
        }

        if (output.length === 0) {
            const fallbackText = String(result?.content || '').trim();
            parseXmlLike(fallbackText).forEach(pushReaction);
        }

        return output;
    }

    _normalizeAiMomentsPayload(result) {
        if (!result || typeof result !== 'object') return [];

        let rows = [];
        if (Array.isArray(result?.moments)) {
            rows = result.moments;
        } else if (Array.isArray(result?.data?.moments)) {
            rows = result.data.moments;
        } else if (Array.isArray(result?.posts)) {
            rows = result.posts;
        } else if (Array.isArray(result?.data?.posts)) {
            rows = result.data.posts;
        }

        if (!Array.isArray(rows) || rows.length === 0) return [];

        const normalized = rows.map((item) => {
            const name = String(item?.name || item?.author || '').trim();
            if (!name) return null;

            const text = String(item?.text || item?.content || '').trim();
            const images = Array.isArray(item?.images) ? item.images : [];
            const time = String(item?.time || '').trim() || '刚刚';

            const likeList = Array.isArray(item?.likeList)
                ? item.likeList
                : (Array.isArray(item?.likes) ? item.likes : []);

            const commentListRaw = Array.isArray(item?.commentList)
                ? item.commentList
                : (Array.isArray(item?.comments) ? item.comments : []);
            const commentList = commentListRaw
                .map((c) => ({
                    name: String(c?.name || c?.user || '').trim(),
                    text: String(c?.text || c?.content || '').trim(),
                    replyTo: String(c?.replyTo || c?.reply_to || '').trim() || null
                }))
                .filter((c) => c.name && c.text);

            return {
                name,
                avatar: String(item?.avatar || '').trim() || '👤',
                text,
                images,
                time,
                likeList: likeList.map(v => String(v || '').trim()).filter(Boolean),
                commentList
            };
        }).filter(Boolean);

        return normalized;
    }

    _formatMomentPersonalImageTagInfo(contacts = []) {
        const rows = (Array.isArray(contacts) ? contacts : [])
            .map((contact) => {
                const name = String(contact?.name || '').trim();
                const tags = String(contact?.naiPromptTags || contact?.imageTags || '')
                    .split(/[,，\n]+/)
                    .map(tag => tag.trim())
                    .filter(Boolean)
                    .join(', ');
                return name && tags ? `${name}：${tags}` : '';
            })
            .filter(Boolean);
        const userInfo = this.app?.wechatData?.getUserInfo?.() || {};
        const userTags = String(userInfo?.naiPromptTags || userInfo?.imageTags || '')
            .split(/[,，\n]+/)
            .map(tag => tag.trim())
            .filter(Boolean)
            .join(', ');
        if (userTags) rows.unshift(`{{user}}：${userTags}`);
        return rows.length > 0 ? rows.join('\n') : '暂无';
    }

    _isHoneyMomentContact(contact = {}) {
        const sourceApp = String(contact?.sourceApp || contact?.extra?.sourceApp || '').trim().toLowerCase();
        const sourceLabel = String(contact?.sourceLabel || contact?.extra?.sourceLabel || '').trim();
        const relation = String(contact?.relation || contact?.extra?.relation || '').trim();
        return sourceApp === 'honey'
            || sourceLabel.includes('蜜语')
            || sourceLabel.includes('主播')
            || relation.includes('蜜语')
            || relation.includes('主播');
    }

    _trimMomentPromptText(value, maxLength = 260) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
    }

    async _getHoneyMomentHistorySummary(contact = {}) {
        const hostName = String(contact?.honeyHostName || contact?.honeySource || contact?.name || '').trim();
        if (!hostName) return '';
        try {
            const mod = await import('../honey/honey-data.js');
            const HoneyData = mod?.HoneyData;
            if (!HoneyData) return '';
            const honeyData = window.VirtualPhone?.honeyApp?.honeyData || new HoneyData(this.app.storage || window.VirtualPhone?.storage);
            const summary = honeyData.getHostHistorySummary?.(hostName);
            const summaryText = typeof honeyData.formatHostHistorySummaryForContext === 'function'
                ? honeyData.formatHostHistorySummaryForContext(summary)
                : String(summary?.text || '').trim();
            return this._trimMomentPromptText(summaryText, 360);
        } catch (error) {
            console.warn('[朋友圈] 读取蜜语好友资料失败:', error);
            return '';
        }
    }

    async _buildMomentContactInfo(contact = {}) {
        const name = String(contact?.name || '').trim();
        if (!name) return '';

        const relation = String(contact?.relation || '好友').trim() || '好友';
        const naiTags = String(contact?.naiPromptTags || contact?.imageTags || '').trim();
        const hasReferenceImage = !!String(contact?.naiReferenceImage || contact?.referenceImage || '').trim()
            && contact?.naiReferenceEnabled !== false
            && contact?.naiReferenceEnabled !== 'false';

        const notes = [];
        if (naiTags) notes.push(`专属生图Tag: ${this._trimMomentPromptText(naiTags, 180)}`);
        if (hasReferenceImage) notes.push('已设置个人形象参考图');

        if (this._isHoneyMomentContact(contact)) {
            const sourceLabel = String(contact?.sourceLabel || '').trim();
            const honeySource = String(contact?.honeySource || sourceLabel || '蜜语').trim();
            const visibleIntro = this._trimMomentPromptText(contact?.honeyVisibleIntro || '', 260);
            const hiddenBackground = this._trimMomentPromptText(contact?.honeyHiddenBackground || '', 320);
            const historySummary = await this._getHoneyMomentHistorySummary(contact);

            notes.push(`蜜语资料: ${honeySource}`);
            if (visibleIntro) notes.push(`对外申请话术: ${visibleIntro}`);
            if (hiddenBackground) notes.push(`隐藏设定: ${hiddenBackground}`);
            if (historySummary) notes.push(`蜜语互动摘要: ${historySummary}`);
        }

        return `${name}(${relation}${notes.length ? `；${notes.join('；')}` : ''})`;
    }

    // 从AI加载朋友圈
    async loadMomentsFromAI() {
        if (this.isLoading) return;

        this.isLoading = true;
        this.syncMomentsPullIndicator('loading');

        try {
            // 获取联系人列表
            const contacts = this.app.wechatData.getContacts();
            if (contacts.length === 0) {
                this.app.phoneShell.showNotification('提示', '请先添加联系人', '⚠️');
                this.isLoading = false;
                this.syncMomentsPullIndicator('error');
                return;
            }

            // 获取朋友圈提示词
            const promptManager = window.VirtualPhone?.promptManager;
            let momentsPrompt = promptManager?.getPromptForFeature('wechat', 'moments') || '';

            // 获取时间
            const timeManager = window.VirtualPhone?.timeManager;
            const currentTime = timeManager?.getCurrentStoryTime?.() || { date: '2024年1月1日', time: '12:00' };

            // 🔥 收集记忆表格信息（如果Gaigai插件存在）
            let memoryInfo = '';
            if (window.Gaigai?.m?.s && Array.isArray(window.Gaigai.m.s)) {
                const memoryLines = [];
                window.Gaigai.m.s.forEach(section => {
                    if (section.r && section.r.length > 0) {
                        section.r.slice(0, 5).forEach(row => { // 每个section最多5条
                            const rowText = Object.values(row).join(' ').substring(0, 200);
                            if (rowText.trim()) {
                                memoryLines.push(rowText);
                            }
                        });
                    }
                });
                if (memoryLines.length > 0) {
                    memoryInfo = `【记忆信息】
${memoryLines.slice(0, 10).join('\n')}
`;
                }
            }

            // 构建联系人信息
            const contactsInfo = (await Promise.all(contacts.map(c => this._buildMomentContactInfo(c))))
                .filter(Boolean)
                .join('、');
            const personalImageTagInfo = this._formatMomentPersonalImageTagInfo(contacts);
            momentsPrompt = String(momentsPrompt || '').replace(/\{\{personalImageTagInfo\}\}/g, personalImageTagInfo);

            // 构建完整提示词
            const prompt = `【朋友圈生成任务】

当前剧情时间：${currentTime.date} ${currentTime.time}

${memoryInfo}

可用联系人列表：
${contactsInfo}

请根据已注入的角色卡、用户信息、世界书和最近剧情对话，为联系人生成符合当前故事情境的朋友圈动态。
带有“蜜语资料”的联系人也是微信通讯录好友；生成朋友圈时应参考其蜜语来源、对外话术、隐藏设定和互动摘要，不要忽略这类联系人。朋友圈是公开/半公开动态，请把私密设定转化为适合朋友圈可见范围的生活化表达，不要直接泄露隐私细节。

要求：
1. 每个联系人生成0-1条朋友圈（根据角色性格决定是否发）
2. 内容要符合角色性格、当前剧情和世界观设定
3. 可以包含其他联系人的点赞和评论互动
4. 时间要在当前剧情时间之前（几分钟到几小时前）
5. 朋友圈内容要反映角色的日常生活、情感状态或与剧情相关的事件
6. 要参考最近的剧情对话，体现角色当前的状态
7. 如果朋友圈需要配图，images 数组只能写 [图片]（中文图片描述）（English NovelAI tags）、[个人图片]（中文图片描述）（English NovelAI tags）或 [用户照片]（中文图片描述）（English NovelAI tags）。
8. [个人图片] 只用于画面包含发布者本人脸、自拍、全身照、试衣照、生活照等自身形象；[用户照片] 只用于画面包含{{user}}本人，标签名不要写用户姓名；风景、食物、宠物、截图、物品、别人或无人物画面必须用 [图片]。
9. 第一个括号必须写中文图片描述，供朋友圈卡片背面展示；第二个括号只能写英文逗号分隔的 NAI 生图 tag，不要写中文、解释或完整句子，专门供生图使用。

输出格式（只返回JSON）：
\`\`\`json
{
  "moments": [
    {
      "name": "联系人名字",
      "avatar": "表情符号",
      "text": "朋友圈文字内容",
      "images": ["[图片]（午后的咖啡杯放在靠窗桌边，阳光照着桌面）（coffee cup, window table, afternoon sunlight, phone photo, anime illustration）"],
      "time": "几分钟前/几小时前",
      "likeList": ["点赞的人名"],
      "commentList": [
        {"name": "评论者", "text": "评论内容"},
        {"name": "回复者", "text": "回复内容", "replyTo": "被回复者"}
      ]
    }
  ]
}
\`\`\`

${momentsPrompt}

请生成朋友圈：`;


            // 调用AI
            const result = await this.callAI(prompt);

            const normalizedMoments = this._normalizeAiMomentsPayload(result);
            if (normalizedMoments.length > 0) {
                const currentUserName = String(this.app.wechatData.getUserInfo()?.name || '').trim();
                const existingMoments = Array.isArray(this.app.wechatData.data.moments)
                    ? this.app.wechatData.data.moments
                    : [];
                const preservedMoments = existingMoments.filter(moment => {
                    const authorName = String(moment?.name || '').trim();
                    const likeList = Array.isArray(moment?.likeList) ? moment.likeList : [];
                    const isOwnMoment = !!currentUserName && authorName === currentUserName;
                    const isLikedByUser = !!currentUserName && likeList.includes(currentUserName);
                    return isOwnMoment || isLikedByUser;
                });

                const newMoments = normalizedMoments.map(m => {
                    // 🔥 优先使用联系人的真实头像，如果没有才用AI返回的
                    const contactAvatar = this.getContactAvatar(m.name);
                    const finalAvatar = (contactAvatar && contactAvatar !== '👤') ? contactAvatar : (m.avatar || '👤');

                    return {
                        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                        name: m.name,
                        avatar: finalAvatar,
                        text: m.text,
                        images: m.images || [],
                        time: m.time || '刚刚',
                        timestamp: Date.now(),
                        likes: m.likeList?.length || 0,
                        likeList: m.likeList || [],
                        comments: m.commentList?.length || 0,
                        commentList: m.commentList || []
                    };
                });

                // 刷新只替换未被用户点赞、且不是用户自己发布的旧朋友圈；新朋友圈显示在保留内容之前。
                this.app.wechatData.data.moments = [...newMoments, ...preservedMoments];
                this.app.wechatData.saveData();
                this.syncMomentsPullIndicator('success');
                this.app.render();
            } else {
                this.syncMomentsPullIndicator('error');
            }

        } catch (error) {
            console.error('❌ 加载朋友圈失败:', error);
            this.syncMomentsPullIndicator('error');
            this.app.phoneShell.showNotification('错误', error.message, '❌');
        } finally {
            this.isLoading = false;
            setTimeout(() => this.syncMomentsPullIndicator(), 1300);
        }
    }

    async _buildWechatMomentsContextMessages(context) {
        const messages = [];
        if (!context) return messages;

        const userName = context?.name1 || '用户';
        const charName = context?.name2 || '角色';

        if (context.characterId !== undefined && context.characters?.[context.characterId]) {
            const char = context.characters[context.characterId];
            let charInfo = `【角色信息】\n角色名: ${char.name || charName}\n`;
            if (char.description) charInfo += `描述: ${char.description}\n`;
            if (char.personality) charInfo += `性格: ${char.personality}\n`;
            if (char.scenario) charInfo += `场景/背景: ${char.scenario}\n`;
            if (char.data?.system_prompt) charInfo += `\n${char.data.system_prompt}\n`;
            messages.push({
                role: 'system',
                content: charInfo.trim(),
                name: 'SYSTEM (角色卡)',
                isPhoneMessage: true
            });
        }

        const worldInfoMessage = await window.VirtualPhone?.worldbookManager?.buildWorldbookMessage?.('wechat');
        if (worldInfoMessage) messages.push(worldInfoMessage);

        const personaTextarea = document.getElementById('persona_description');
        if (personaTextarea && personaTextarea.value && personaTextarea.value.trim()) {
            messages.push({
                role: 'system',
                content: `【用户信息】\n${personaTextarea.value.trim()}`,
                name: 'SYSTEM (用户Persona)',
                isPhoneMessage: true
            });
        }

        const storage = window.VirtualPhone?.storage;
        const contextLimit = readPhoneContextLimit(storage || this.app?.storage);
        if (Array.isArray(context.chat) && context.chat.length > 0) {
            const collectedContextMessages = [];
            for (let idx = context.chat.length - 1; idx >= 0 && collectedContextMessages.length < contextLimit; idx--) {
                const msg = context.chat[idx];
                if (!msg || msg.isGaigaiPrompt || msg.isGaigaiData || msg.isPhoneMessage) continue;
                let content = msg.mes || msg.content || '';
                content = applyPhoneTagFilter(content, { storage: this.app?.storage || window.VirtualPhone?.storage });
                content = String(content).replace(/<[^>]*>/g, '').replace(/\*.*?\*/g, '').trim();
                if (!content) continue;
                const isUser = msg.is_user || msg.role === 'user';
                const speaker = isUser ? userName : charName;
                collectedContextMessages.unshift({
                    role: isUser ? 'user' : 'assistant',
                    content: `${speaker}: ${content}`,
                    isPhoneMessage: true
                });
            }
            messages.push(...collectedContextMessages);
        }

        return messages;
    }

    // 调用AI（静默调用，不显示在酒馆聊天界面）
    async callAI(prompt) {
        const context = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
            ? SillyTavern.getContext()
            : null;

        if (!context) {
            throw new Error('无法访问SillyTavern');
        }

        try {
            const apiManager = window.VirtualPhone?.apiManager;
            if (!apiManager) throw new Error('API Manager 未初始化');

            const resolvedMaxTokens = Number.parseInt(context?.max_response_length, 10)
                || Number.parseInt(context?.max_length, 10)
                || Number.parseInt(context?.amount_gen, 10);
            const callAiOptions = {
                appId: 'wechat'
            };
            if (Number.isFinite(resolvedMaxTokens) && resolvedMaxTokens > 0) {
                callAiOptions.max_tokens = resolvedMaxTokens;
            }

            const contextMessages = await this._buildWechatMomentsContextMessages(context);

            const result = await apiManager.callAI([
                { role: 'system', content: '你是一个朋友圈内容生成助手。严格遵守本次任务指定的输出格式，不要附加解释。', isPhoneMessage: true },
                ...contextMessages,
                { role: 'user', content: prompt, isPhoneMessage: true }
            ], callAiOptions);
            if (!result.success) throw new Error(result.error || 'AI调用失败');
            const response = result.summary || '';


            // 🔥 解析JSON - 多种格式兼容
            let jsonStr = null;

            // 方式1: ```json ... ```
            const codeBlockMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
            if (codeBlockMatch) {
                jsonStr = codeBlockMatch[1].trim();
            }

            // 方式2: 直接找 { "moments": ... }
            if (!jsonStr) {
                const directMatch = response.match(/\{\s*"moments"\s*:\s*\[[\s\S]*\]\s*\}/);
                if (directMatch) {
                    jsonStr = directMatch[0];
                }
            }

            // 方式3: 找任何 JSON 对象
            if (!jsonStr) {
                const anyJsonMatch = response.match(/\{[\s\S]*\}/);
                if (anyJsonMatch) {
                    jsonStr = anyJsonMatch[0];
                }
            }

            if (jsonStr) {
                const result = JSON.parse(jsonStr);
                if (result && typeof result === 'object') {
                    result.raw = response;
                }
                return result;
            }

            // 兼容 XML/纯文本格式（例如 <朋友圈互动> ... </朋友圈互动>）
            if (response && response.trim()) {
                return {
                    raw: response,
                    text: response,
                    content: response
                };
            }

            console.error('❌ [朋友圈] 无法解析结果，响应内容:', response.substring(0, 500));
            throw new Error('AI返回格式错误');
        } catch (e) {
            console.error('❌ [朋友圈] AI调用失败:', e);
            throw e;
        }
    }

    // 获取联系人头像（优先获取图片头像）
    getContactAvatar(name) {
        // 辅助函数：检查是否为图片URL或base64
        const isImageAvatar = (avatar) => {
            if (!avatar) return false;
            return avatar.startsWith('data:image') ||
                   avatar.startsWith('http://') ||
                   avatar.startsWith('https://') ||
                   avatar.startsWith('blob:') ||
                   avatar.startsWith('/');
        };

        // 🔥 从聊天列表找（聊天列表头像通常是用户上传的，优先级最高）
        const chats = this.app.wechatData.getChatList();
        const chat = chats.find(c => c.name === name);
        if (chat?.avatar && isImageAvatar(chat.avatar)) {
            return chat.avatar;
        }

        // 从联系人列表找图片头像
        const contact = this.app.wechatData.getContacts().find(c => c.name === name);
        if (contact?.avatar && isImageAvatar(contact.avatar)) {
            return contact.avatar;
        }

        // 使用 getContactByName 方法找图片头像
        const contactByName = this.app.wechatData.getContactByName(name);
        if (contactByName?.avatar && isImageAvatar(contactByName.avatar)) {
            return contactByName.avatar;
        }

        // 🔥 如果没有图片头像，返回任何可用的头像（包括emoji）
        if (chat?.avatar) return chat.avatar;
        if (contact?.avatar) return contact.avatar;
        if (contactByName?.avatar) return contactByName.avatar;

        return null;
    }

    // 格式化时间
    formatTime(timestamp) {
        if (typeof timestamp === 'string') return timestamp;

        const now = Date.now();
        const diff = now - timestamp;

        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;

        const date = new Date(timestamp);
        return `${date.getMonth() + 1}月${date.getDate()}日`;
    }

    // 旧版render方法（保持兼容）
    render() {
        this.app.currentView = 'discover';
        this.app.render();
    }

    // ========================================
    // 📝 发朋友圈功能
    // ========================================

    // 显示发朋友圈页面
    showPostMomentPage() {
        this._startPostMomentDraft();
        const userInfo = this.app.wechatData.getUserInfo();

        const html = `
            <div class="wechat-app">
                <div class="wechat-header">
                    <div class="wechat-header-left">
                        <button class="wechat-back-btn" id="back-from-post">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>
                    <div class="wechat-header-title">发朋友圈</div>
                    <div class="wechat-header-right">
                        <button class="wechat-header-btn" id="publish-moment-btn" style="color: #07c160; font-size: 14px; font-weight: 500;">
                            发表
                        </button>
                    </div>
                </div>

                <div class="wechat-content" style="background: #fff; padding: 15px;">
                    <!-- 用户头像和输入框 -->
                    <div style="display: flex; gap: 12px;">
                        <div style="width: 44px; height: 44px; border-radius: 6px; overflow: hidden; flex-shrink: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center; font-size: 22px;">
                            ${this.app.renderAvatar(userInfo.avatar, '😊', userInfo.name)}
                        </div>
                        <div style="flex: 1;">
                            <textarea id="moment-text-input" placeholder="这一刻的想法..." style="
                                width: 100%;
                                min-height: 120px;
                                padding: 10px;
                                border: none;
                                font-size: 15px;
                                line-height: 1.6;
                                resize: none;
                                outline: none;
                                box-sizing: border-box;
                            "></textarea>
                        </div>
                    </div>

                    <!-- 图片预览区 -->
                    <div id="moment-images-preview" style="display: flex; flex-wrap: wrap; gap: 8px; margin: 15px 0;">
                    </div>

                    <!-- 添加图片按钮 -->
                    <div style="margin-top: 15px; padding-top: 15px; border-top: 0.5px solid #e5e5e5;">
                        <input type="file" id="moment-image-upload" accept="image/png, image/jpeg, image/gif, image/webp, image/*" multiple style="display: none;">
                        <label for="moment-image-upload" id="add-moment-image-btn" style="
                            display: flex;
                            align-items: center;
                            gap: 10px;
                            padding: 12px 15px;
                            background: #f7f7f7;
                            border: none;
                            border-radius: 8px;
                            font-size: 14px;
                            color: #333;
                            cursor: pointer;
                            width: 100%;
                            box-sizing: border-box;
                        ">
                            <i class="fa-solid fa-image" style="font-size: 18px; color: #07c160;"></i>
                            <span>添加图片</span>
                            <span style="margin-left: auto; color: #999; font-size: 12px;">最多9张</span>
                        </label>
                    </div>

                    <!-- 可见范围（简化版） -->
                    <div style="margin-top: 15px; padding: 12px 15px; background: #f7f7f7; border-radius: 8px;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <span style="font-size: 14px; color: #333;">谁可以看</span>
                            <span style="font-size: 14px; color: #999;">
                                公开 <i class="fa-solid fa-chevron-right" style="font-size: 12px; margin-left: 5px;"></i>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html);

        // 绑定事件
        this.bindPostMomentEvents();
    }

    // 绑定发朋友圈页面事件
    bindPostMomentEvents() {
        // 返回按钮
        document.getElementById('back-from-post')?.addEventListener('click', () => {
            this._leavePostMomentDraft({ published: false });
            this.app.currentView = 'discover';
            this.app.render();
        });

        // 图片上传
        document.getElementById('moment-image-upload')?.addEventListener('change', (e) => {
            const rawFiles = e.target.files;
            if (!rawFiles || rawFiles.length === 0) return;
            
            // 🔥 提取为静态数组并重置 input，修复无法连续选择同一张图的bug
            const fileArray = Array.from(rawFiles);
            e.target.value = ''; 
            
            this.handleImageUpload(fileArray);
        });

        // 发表按钮
        document.getElementById('publish-moment-btn')?.addEventListener('click', () => {
            this.publishMoment();
        });
    }

    // 处理图片上传 - 支持裁剪
    async handleImageUpload(files) {
        if (!files || files.length === 0) return;

        const maxImages = 9;
        const currentCount = this.pendingMomentImages?.length || 0;
        const remainingSlots = maxImages - currentCount;

        if (remainingSlots <= 0) {
            this.app.phoneShell.showNotification('提示', '最多只能上传9张图片', '⚠️');
            return;
        }

        const filesToProcess = Array.from(files).slice(0, remainingSlots);

        for (const file of filesToProcess) {
            try {
                const cropper = new ImageCropper({
                    title: '裁剪图片',
                    aspectRatio: 1, // 朋友圈图片用正方形
                    outputWidth: 600,
                    outputHeight: 600,
                    quality: 0.85,
                    maxFileSize: 5 * 1024 * 1024
                });

                const croppedImage = await cropper.open(file);

                const finalUrl = await window.VirtualPhone?.imageManager?.uploadDataUrl?.(croppedImage, 'moment_image');
                if (!finalUrl) throw new Error('图片上传管理器未初始化');

                if (!this.pendingMomentImages) {
                    this.pendingMomentImages = [];
                }
                this.pendingMomentImages.push(finalUrl); // 存入 URL
                this.updateImagePreview();
            } catch (error) {
                if (error.message !== '用户取消') {
                    this.app.phoneShell.showNotification('上传失败', error.message, '❌');
                }
            }
        }
    }

    // 更新图片预览
    updateImagePreview() {
        const previewContainer = document.getElementById('moment-images-preview');
        if (!previewContainer) return;

        previewContainer.innerHTML = this.pendingMomentImages.map((img, index) => `
            <div style="position: relative; width: 80px; height: 80px;">
                <img src="${img}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 6px;">
                <button class="remove-moment-image" data-index="${index}" style="
                    position: absolute;
                    top: -6px;
                    right: -6px;
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    background: rgba(0, 0, 0, 0.6);
                    color: #fff;
                    border: none;
                    font-size: 12px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">×</button>
            </div>
        `).join('');

        // 绑定删除图片事件
        previewContainer.querySelectorAll('.remove-moment-image').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                const removed = this.pendingMomentImages[index];
                this.pendingMomentImages.splice(index, 1);
                // 草稿里删图时立即清理托管图片；若草稿内还有同图则不清理
                if (removed && !this.pendingMomentImages.includes(removed)) {
                    this._cleanupManagedMomentImages([removed]);
                }
                this.updateImagePreview();
            });
        });
    }

    // 发表朋友圈
    publishMoment() {
        const textInput = document.getElementById('moment-text-input');
        const text = textInput?.value?.trim() || '';
        const images = Array.isArray(this.pendingMomentImages)
            ? this.pendingMomentImages.filter(item => typeof item === 'string' && item.trim())
            : [];

        // 验证内容
        if (!text && images.length === 0) {
            this.app.phoneShell.showNotification('提示', '请输入内容或添加图片', '⚠️');
            return;
        }

        // 获取用户信息
        const userInfo = this.app.wechatData.getUserInfo();

        // 创建朋友圈
        const moment = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            name: userInfo.name || '我',
            avatar: userInfo.avatar || '😊',
            text: text,
            images: images,
            time: '刚刚',
            timestamp: Date.now(),
            likes: 0,
            likeList: [],
            comments: 0,
            commentList: []
        };

        // 添加到数据
        this.app.wechatData.addMoment(moment);

        // 标记草稿已发布，避免离开页面时被误清理
        this._postMomentDraftCommitted = true;

        // 清空待发送数据
        this.pendingMomentImages = [];

        // 显示成功提示
        this.app.phoneShell.showNotification('发布成功', '你的朋友圈已发布', '✅');

        // 发布后触发一次AI互动（通讯录好友点赞/评论）
        this.triggerAIReaction(moment.id, 'post', text).catch(error => {
            console.error('❌ [朋友圈] 发布后触发AI互动失败:', error);
        });

        // 返回朋友圈列表
        setTimeout(() => {
            this._leavePostMomentDraft({ published: true });
            this.app.currentView = 'discover';
            this.app.render();
        }, 500);
    }
}
