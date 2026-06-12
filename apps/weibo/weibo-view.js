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
// 微博视图渲染 - 所有UI界面
// ========================================
import { ImageCropper } from '../settings/image-cropper.js';

export class WeiboView {
    constructor(weiboApp) {
        this.app = weiboApp;
        this.currentView = 'home';
        this.currentTab = 'hotSearch'; // 'hotSearch' | 'recommend'
        this.currentHotSearchTitle = null;
        this.entrySource = null; // 跨App跳转来源（如微信卡片）
        this.isBackNav = false;
        this.isLoading = false;
        this._recommendRefreshStatus = 'idle'; // idle | loading | success | error
        this._recommendRefreshTimer = null;
        this._hotDetailRefreshStatus = 'idle'; // idle | loading | success | error
        this._hotDetailRefreshTimer = null;
        this._cssLoaded = false;
        this._revealedDeletePostId = null;
        this._hasPendingExternalRecommendRefresh = false;
        this._profileMediaCheckRunning = false;
        this._profileBrokenPathSet = new Set();
        this._isSearchOpen = false;
        this._lastSearchQuery = '';
    }

    // ========================================
    // 🎨 CSS 加载
    // ========================================

    loadCSS() {
        if (this._cssLoaded) return;
        if (document.getElementById('weibo-css')) {
            this._cssLoaded = true;
            return;
        }
        const link = document.createElement('link');
        link.id = 'weibo-css';
        link.rel = 'stylesheet';
        link.href = new URL('./weibo.css?v=1.0.0', import.meta.url).href;
        document.head.appendChild(link);
        this._cssLoaded = true;
    }

    // ========================================
    // 🔀 主渲染分发
    // ========================================

    render() {
        this.loadCSS();

        // 🔥 每次渲染时读取并应用用户的自定义头像框CSS
        const profile = this.app.weiboData.getProfile();
        this._applyCustomAvatarFrame(profile.avatarFrameCss || '');

        // 清理残留的转发弹窗，防止返回后叠加卡死
        document.querySelectorAll('.weibo-forward-overlay').forEach(el => el.remove());
        document.querySelectorAll('.weibo-app.weibo-forward-lock').forEach(el => el.classList.remove('weibo-forward-lock'));
        document.querySelectorAll('.phone-screen.weibo-forward-open').forEach(el => el.classList.remove('weibo-forward-open'));

        switch (this.currentView) {
            case 'home':
                this.renderHome();
                break;
            case 'hotSearchDetail':
                this.renderHotSearchDetail(this.currentHotSearchTitle);
                break;
            case 'postDetail':
                this.renderPostDetail(this.currentPostId, this.currentPostMode);
                break;
            case 'settings':
                this.renderSettings();
                break;
            case 'hotSearchSettings':
                this.renderHotSearchSettings();
                break;
            default:
                this.renderHome();
        }

        this.isBackNav = false;
    }

    returnFromPostDetail(mode = this.currentPostMode) {
        if (this.entrySource?.appId === 'wechat' && typeof this.app.returnToWechatFromCard === 'function') {
            this.app.returnToWechatFromCard();
            return;
        }

        const returningPostId = String(this.currentPostId || '').trim();
        this.currentPostId = null;
        this.currentPostMode = null;
        if (mode === 'hotSearch') {
            this.currentView = 'hotSearchDetail';
        } else {
            this.currentView = 'home';
        }
        this.render();

        if (returningPostId) {
            requestAnimationFrame(() => {
                const escapedPostId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
                    ? CSS.escape(returningPostId)
                    : returningPostId.replace(/["\\]/g, '\\$&');
                document.querySelectorAll(`.weibo-post[data-post-id="${escapedPostId}"]`).forEach((el) => {
                    el.dataset.suppressClickUntil = String(Date.now() + 650);
                });
            });
        }
    }

    // ========================================
    // 🏠 首页
    // ========================================

    renderHome() {
        const profile = this.app.weiboData.getProfile();
        const bannerStyle = profile.banner
            ? `background-image: url('${profile.banner}'); background-size: 100% auto; background-position: center top; background-repeat: no-repeat; background-color: #f5f5f5;`
            : 'background: linear-gradient(135deg, #ff8200 0%, #ff6a00 50%, #e85d04 100%); background-color: #f5f5f5;';

        const displayAvatar = this._getWeiboDisplayAvatar(profile);
        const avatarHtml = displayAvatar
            ? `<img src="${this._escapeAttr(displayAvatar)}" class="weibo-avatar-img">`
            : `<div class="weibo-avatar-default">📷</div>`;

        const context = this.app.weiboData._getContext();
        const userName = context?.name1 || '微博用户';
        const nickname = profile.nickname || userName;
        const following = profile.following ?? 25;
        const followers = profile.followers ?? 0;
        const postsCount = this.app.weiboData.getUserPosts().length;
        const ipLocation = profile.ipLocation || 'IP属地：未知';
        const verifyText = profile.verifyText || '微博个人认证';

        const tabCount = 3;
        const tabIdx = this.currentTab === 'hotSearch' ? 0 : this.currentTab === 'recommend' ? 1 : 2;
        const indicatorWidth = 100 / tabCount;

        const html = `
            <!-- 🔥 核心修复：把背景直接画在最外层的不滚动容器上 -->
            <div class="weibo-app weibo-home-mode" style="${bannerStyle}">
                
                <!-- 顶部导航栏 -->
                <div class="weibo-nav-bar">
                    <div class="weibo-nav-left">
                        <button class="weibo-back-btn" id="weibo-home-back">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>
                    <div class="weibo-nav-title">微博</div>
                    <div class="weibo-nav-right">
                        <button class="weibo-nav-btn" id="weibo-search-toggle-btn" title="搜索微博">
                            <i class="fa-solid fa-magnifying-glass"></i>
                        </button>
                        <button class="weibo-nav-btn" id="weibo-settings-btn">
                            <i class="fa-solid fa-gear"></i>
                        </button>
                    </div>
                </div>

                <div class="weibo-search-bar ${this._isSearchOpen ? 'is-open' : ''}">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input id="weibo-search-input" type="text" value="${this._escapeAttr(this._lastSearchQuery)}" placeholder="搜索相关微博">
                    <button id="weibo-search-submit" title="搜索">搜索</button>
                </div>

                <!-- 背景图展示区占位 -->
                <div class="weibo-banner-spacer" style="height: 85px; flex-shrink: 0;"></div>

                <!-- 头像和信息 -->
                <div class="weibo-profile-wrapper">
                    <div class="weibo-avatar-wrapper">
                        ${avatarHtml}
                    </div>
                    <div class="weibo-profile-section">
                        <div class="weibo-profile-info">
                            <div class="weibo-profile-name-row" style="margin-bottom: 4px;">
                                <span class="weibo-nickname">${nickname}</span>
                            </div>
                            <div class="weibo-profile-stats-row">
                                <div class="weibo-profile-stat">
                                    <span class="weibo-profile-stat-num">${following}</span>
                                    <span class="weibo-profile-stat-label">关注</span>
                                </div>
                                <div class="weibo-profile-stat">
                                    <span class="weibo-profile-stat-num">${followers}</span>
                                    <span class="weibo-profile-stat-label">粉丝</span>
                                </div>
                                <div class="weibo-profile-stat">
                                    <span class="weibo-profile-stat-num">${postsCount}</span>
                                    <span class="weibo-profile-stat-label">动态</span>
                                </div>
                            </div>
                            <div class="weibo-ip-location">${ipLocation}</div>
                        </div>
                    </div>
                </div>

                <!-- Tab栏 -->
                <div class="weibo-tabs">
                    <div class="weibo-tab ${this.currentTab === 'hotSearch' ? 'active' : ''}" data-tab="hotSearch">热搜</div>
                    <div class="weibo-tab ${this.currentTab === 'recommend' ? 'active' : ''}" data-tab="recommend">推荐</div>
                    <div class="weibo-tab ${this.currentTab === 'myPosts' ? 'active' : ''}" data-tab="myPosts">我的</div>
                    <div class="weibo-tab-indicator" style="width: ${indicatorWidth}%; transform: translateX(${tabIdx * 100}%);"></div>
                </div>

                <!-- Tab内容 -->
                <div class="weibo-tab-content">
                    ${this.currentTab === 'hotSearch' ? this.renderHotSearchList() :
                this.currentTab === 'recommend' ? this.renderRecommendList() :
                    this.renderMyPostsList()}
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'weibo-home');
        this.bindHomeEvents();
        this._bindWeiboSearchEvents();
        if (this._isSearchOpen) {
            requestAnimationFrame(() => document.getElementById('weibo-search-input')?.focus());
        }
        this._scheduleProfileMediaHealthCheck();
        this._hasPendingExternalRecommendRefresh = false;
    }

    markExternalRecommendUpdated() {
        this._hasPendingExternalRecommendRefresh = true;
        if (this.currentView !== 'home' || this.currentTab !== 'recommend') return;

        const contentArea = document.querySelector('.phone-view-current .weibo-tab-content')
            || document.querySelector('.weibo-tab-content');
        if (!contentArea) return;

        this.refreshCurrentTabContent();
        this._hasPendingExternalRecommendRefresh = false;
    }

    // ========================================
    // 🔥 热搜列表
    // ========================================

    renderHotSearchList() {
        const searches = this.app.weiboData.getHotSearches();

        if (searches.length === 0) {
            return `
                <div class="weibo-empty">
                    <div class="weibo-empty-icon">🔥</div>
                    <p>暂无热搜内容</p>
                    <p class="weibo-empty-sub">点击推荐tab刷新后自动生成热搜</p>
                </div>
            `;
        }

        return `
            <div class="weibo-hot-list">
                ${searches.map((item, idx) => {
            const tagClass = item.tag === '爆' ? 'tag-explosive' :
                item.tag === '热' ? 'tag-hot' :
                    item.tag === '新' ? 'tag-new' :
                        item.tag === '荐' ? 'tag-ad' : '';
            const tagHtml = item.tag ? `<span class="weibo-hot-tag ${tagClass}">${item.tag}</span>` : '';

            return `
                        <div class="weibo-hot-item" data-title="${this._escapeAttr(item.title)}">
                            <div class="weibo-hot-rank ${idx < 3 ? 'top3' : ''}">${idx + 1}</div>
                            <div class="weibo-hot-info">
                                <div class="weibo-hot-title">${item.title}</div>
                            </div>
                            ${tagHtml}
                            <i class="fa-solid fa-chevron-right weibo-hot-arrow"></i>
                        </div>
                    `;
        }).join('')}
            </div>
        `;
    }

    // ========================================
    // 📱 推荐列表
    // ========================================

    renderRecommendList() {
        const posts = this.app.weiboData.getFeedPosts();

        return `
            <div class="weibo-recommend-container">
                <div class="weibo-pull-refresh-indicator" id="weibo-pull-refresh-indicator">
                    <div class="weibo-pull-refresh-inner" id="weibo-pull-refresh-inner"></div>
                </div>

                ${posts.length === 0 ? `
                    <div class="weibo-empty">
                        <p>暂无推荐内容</p>
                        <p class="weibo-empty-sub">长按上方用户信息区后下拉可刷新</p>
                    </div>
                ` : posts.map(post => this.renderWeiboPost(post)).join('')}
            </div>
        `;
    }

    // ========================================
    // 👤 我的微博列表
    // ========================================

    renderMyPostsList() {
        const posts = this.app.weiboData.getUserPosts();

        return `
            <div class="weibo-mypost-container">
                <!-- 发微博入口 -->
                <div class="weibo-mypost-compose" id="weibo-mypost-compose-btn">
                    <div class="weibo-mypost-add-btn">
                        <i class="fa-solid fa-plus"></i>
                    </div>
                    <div class="weibo-mypost-compose-input">分享新鲜事...</div>
                </div>

                ${posts.length === 0 ? `
                    <div class="weibo-empty">
                        <p>还没有发布微博</p>
                        <p class="weibo-empty-sub">点击上方发布你的第一条微博</p>
                    </div>
                ` : posts.map(post => this.renderWeiboPost(post, 'myPosts')).join('')}
            </div>
        `;
    }

    // ========================================
    // 📄 单条微博帖子
    // ========================================

    renderWeiboPost(post, mode = 'recommend') {
        const userName = this.app.weiboData._getCurrentWeiboNickname?.() || '我';
        const isLiked = post.likeList?.includes(userName);
        const isListMode = (mode === 'recommend' || mode === 'myPosts' || mode === 'hotSearch');
        const isDetail = (mode === 'detail');
        const showDeleteBtn = (mode === 'myPosts' && !!post.isUserPost);
        
        // 🔥 新增：获取用户设置的头像
        const profile = this.app.weiboData.getProfile();
        // 判断这条帖子是不是用户自己发的（根据 isUserPost 标记，或者博主名字匹配）
        const isCurrentUserPost = post.isUserPost || post.blogger === (profile.nickname || userName);
        
        let avatarHtml = '';
        const displayAvatar = this._getWeiboDisplayAvatar(profile);
        if (isCurrentUserPost && displayAvatar) {
            // 用户自己的微博优先显示手动上传头像；未上传时继承当前酒馆 Persona 头像。
            avatarHtml = `<img src="${this._escapeAttr(displayAvatar)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%; border: 1px solid #e0e0e0; box-sizing: border-box;">`;
        } else {
            // 否则（AI模拟的其他网友）继续显示默认的文字首字母圈圈
            const avatarInitial = this._getAvatarInitial(post.blogger);
            avatarHtml = `<div class="weibo-post-avatar-circle">${avatarInitial}</div>`;
        }

        // 正文处理：列表模式截断，详情模式完整
        let displayContent = post.content || '';
        let isTruncated = false;
        let highlightedContent = '';

        if (isListMode && displayContent.length > 50) {
            displayContent = displayContent.substring(0, 50);
            isTruncated = true;
            highlightedContent = this._highlightWeiboText(displayContent);
        } else {
            highlightedContent = this._highlightWeiboText(displayContent);
        }

        // 图片：最多显示9张
        const images = (post.images || []).slice(0, 9);

        return `
            <div class="weibo-post ${isDetail ? 'weibo-post-detail' : ''}" data-post-id="${post.id}" data-mode="${mode}">
                <!-- 博主信息 -->
                <div class="weibo-post-header">
                    <div class="weibo-post-avatar">
                        ${avatarHtml}
                    </div>
                    <div class="weibo-post-meta">
                        <div class="weibo-post-blogger">
                            ${post.blogger || '未知'}
                            ${post.bloggerType ? `<span class="weibo-post-type">${post.bloggerType}</span>` : ''}
                        </div>
                        <div class="weibo-post-time-device">
                            ${post.time || ''} ${post.device ? `来自 ${post.device}` : ''}
                        </div>
                    </div>
                    ${showDeleteBtn ? `
                        <button class="weibo-delete-post-btn" data-post-id="${post.id}" data-visible="0" title="删除微博" style="
                            margin-left: 8px;
                            min-width: 42px;
                            height: 24px;
                            padding: 0 10px;
                            position: relative;
                            top: -4px;
                            right: -3px;
                            border: none;
                            border-radius: 999px;
                            background: rgba(255,130,0,0.12);
                            color: #ff8200;
                            font-size: 12px;
                            font-weight: 500;
                            line-height: 1;
                            cursor: pointer;
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            flex-shrink: 0;
                            opacity: 0;
                            pointer-events: none;
                            transform: scale(0.92);
                            transition: opacity 0.18s ease, transform 0.18s ease;
                        ">删除</button>
                    ` : ''}
                </div>

                <!-- 正文 -->
                <div class="weibo-post-content">${highlightedContent}${isTruncated ? '<span class="weibo-expand-text"> ...全文</span>' : ''}</div>

                <!-- 配图 -->
                ${images.length > 0 ? `
                    <div class="weibo-post-images weibo-img-grid-${Math.min(images.length, 9)}">
                        ${images.map((img, index) => {
                            const imageStr = String(img || '').trim();
                            const parsedMedia = this._parseWeiboMediaItem(imageStr);
                            const mediaType = parsedMedia.mediaType;
                            const realUrl = parsedMedia.realUrl;
                            const isVideoProcessed = parsedMedia.isVideoProcessed;
                            const isDirectImage = parsedMedia.isDirectImage;
                            const imageState = this._getWeiboPostImageState(post, index);

                            // 获取文字描述
                            let promptText = parsedMedia.promptText || String(imageState?.prompt || '').trim();
                            if (!promptText || promptText.length < 2) {
                                promptText = "分享" + mediaType;
                            }
                            const descriptionText = parsedMedia.descriptionText || String(imageState?.description || '').trim() || promptText;
                            const safePromptText = this._escapeHtml(descriptionText);
                            const safeTagText = this._escapeHtml(this._hasCjkText(promptText) ? '缺少英文Tag' : promptText);
                            const generationStatus = isDirectImage
                                ? 'done'
                                : (String(imageState?.status || '').trim() || 'idle');
                            const generationError = this._escapeHtml(String(imageState?.error || '').trim());
                            const canRegenerateMedia = isDirectImage && !!String(imageState?.prompt || '').trim();

                            if (isDirectImage) {
                                // 已经生成成功/或直接上传的真实图片 URL
                                return `
                                <div class="weibo-post-img-container weibo-image-prompt-box" style="position: relative; width: 100%; height: 100%; aspect-ratio: 1;">
                                    <div class="weibo-image-prompt-front-panel" style="width: 100%; height: 100%; aspect-ratio: 1; border-radius: 4px; overflow: hidden; position: relative;">
                                        <img src="${realUrl}" class="weibo-post-img-real" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px; background: #f9f9f9;">
                                        ${isVideoProcessed ? `<div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none;"><div style="width:32px; height:32px; border-radius:50%; background:rgba(0,0,0,0.5); border:1.5px solid #fff; display:flex; align-items:center; justify-content:center; color:#fff; font-size:14px; padding-left:3px;"><i class="fa-solid fa-play"></i></div></div>` : ''}
                                        ${canRegenerateMedia ? `
                                            <div class="weibo-image-prompt-regenerate" data-post-id="${post.id}" data-index="${index}" data-prompt="${this._escapeAttr(promptText)}" data-description="${this._escapeAttr(descriptionText)}" data-type="${mediaType}" title="重新生成${mediaType}" style="
                                                position:absolute; left:4px; bottom:4px; background:transparent; color:#fff;
                                                width:22px; height:22px; border:none; border-radius:4px; padding:0; font-size:10px; font-weight:400; line-height:1; cursor:pointer;
                                                display:flex; align-items:center; justify-content:center;
                                                box-shadow:none; text-shadow:0 1px 3px rgba(0,0,0,0.55);
                                            "><i class="fa-solid fa-rotate"></i></div>
                                        ` : ''}
                                        <div class="weibo-image-prompt-show-back" title="查看${mediaType}描述" style="
                                            position:absolute; right:4px; bottom:4px; background:rgba(0,0,0,0.55); color:#fff;
                                            border-radius:999px; padding:3px 7px; font-size:11px; line-height:1; cursor:pointer;
                                            box-shadow:0 2px 8px rgba(0,0,0,0.18);
                                        ">描述</div>
                                    </div>
                                    <div class="weibo-image-prompt-back-panel" style="
                                        display:none; width: 100%; height: 100%; aspect-ratio: 1; background: #f7f7f7;
                                        border: 1px dashed #e0e0e0; border-radius: 4px; box-sizing: border-box;
                                        position: relative; overflow: hidden;
                                    ">
                                        <div style="width: 100%; height: 100%; padding: 6px; padding-bottom: 20px; overflow-y: auto; box-sizing: border-box; display: flex;">
                                            <div style="margin: auto; font-size: 10px; color: #666; line-height: 1.4; word-break: break-word; white-space: pre-wrap; text-align: center; width: 100%;">
                                                <div style="font-weight:700; margin-bottom:4px;">中文描述</div>
                                                <div>${safePromptText}</div>
                                                <div style="font-weight:700; margin:8px 0 4px;">英文Tag</div>
                                                <div>${safeTagText}</div>
                                            </div>
                                        </div>
                                        <div class="weibo-image-prompt-restore" title="恢复卡片正面" style="
                                            position:absolute; bottom:2px; right:2px; background:rgba(0,0,0,0.5); color:#fff;
                                            border-radius:3px; padding:2px 4px; font-size:9px; cursor:pointer; z-index:10; display:flex; align-items:center; gap:2px;
                                        ">${isVideoProcessed ? '<i class="fa-solid fa-video"></i>' : '<i class="fa-regular fa-image"></i>'} 恢复</div>
                                    </div>
                                </div>`;
                            } else {
                                // 🔥 待生成的生图卡片
                                const isVideo = mediaType === '视频';
                                const actionText = isVideo ? '生成视频封面' : '生成图片';
                                const defaultIcon = isVideo ? '<i class="fa-solid fa-video"></i>' : '<i class="fa-regular fa-image"></i>';
                                const previewSeed = encodeURIComponent(`${post.id || 'weibo'}_${index}_${promptText}`);
                                const previewUrl = `https://picsum.photos/seed/${previewSeed}/480/480`;
                                const statusText = generationStatus === 'loading'
                                    ? '正在生成...'
                                    : generationStatus === 'failed'
                                        ? '生成失败，点击重试'
                                        : actionText;
                                const displayIcon = generationStatus === 'loading'
                                    ? '<i class="fa-solid fa-spinner fa-spin"></i>'
                                    : defaultIcon;
                                
                                return `
                                <div class="weibo-post-img-container weibo-image-prompt-box" style="position: relative; width: 100%; height: 100%; aspect-ratio: 1;">
                                    <div class="weibo-image-prompt-front-panel" style="
                                        width: 100%; height: 100%; aspect-ratio: 1; border-radius: 4px; overflow: hidden; position: relative;
                                        background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(18,18,24,0.24)), linear-gradient(135deg, rgba(255, 160, 197, 0.24), rgba(130, 108, 188, 0.2));
                                        border: 1px solid rgba(255, 205, 228, 0.34); box-sizing: border-box; cursor: ${generationStatus === 'loading' ? 'progress' : 'pointer'};
                                    ">
                                        <img src="${previewUrl}" alt="${safePromptText}" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; filter:${generationStatus === 'failed' ? 'grayscale(0.12) saturate(0.88)' : 'none'};">
                                        <div style="position:absolute; inset:0; background:linear-gradient(180deg, rgba(0,0,0,0.06), rgba(0,0,0,0.48));"></div>
                                        <div class="weibo-image-prompt-generate" data-post-id="${post.id}" data-index="${index}" data-prompt="${this._escapeAttr(promptText)}" data-description="${this._escapeAttr(descriptionText)}" data-type="${mediaType}" title="${generationStatus === 'failed' ? '点击重试' : `点击${actionText}`}" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:8px; padding:12px; box-sizing:border-box;">
                                            <div class="generate-icon-container" style="
                                                width:36px; height:36px; border-radius:10px;
                                                display:flex; align-items:center; justify-content:center;
                                                background:rgba(255,255,255,0.18); border:1px solid rgba(255,255,255,0.26);
                                                color:#fff; font-size:16px; box-shadow:0 4px 10px rgba(0,0,0,0.12);
                                            ">${displayIcon}</div>
                                            <div class="generate-text-container" style="font-size:10px; line-height:1.2; color:#fff; text-align:center; font-weight:600;">${statusText}</div>
                                            ${generationStatus === 'failed' && generationError ? `
                                                <div style="font-size:9px; line-height:1.25; color:rgba(255,255,255,0.88); text-align:center; max-width:100%; word-break:break-word;">
                                                    ${generationError}
                                                </div>
                                            ` : ''}
                                        </div>
                                        <div class="weibo-image-prompt-show-back" title="查看${mediaType}描述" style="
                                            position:absolute; right:4px; bottom:4px; background:rgba(0,0,0,0.55); color:#fff;
                                            border-radius:999px; padding:3px 7px; font-size:11px; line-height:1; cursor:pointer;
                                        ">描述</div>
                                    </div>
                                    <div class="weibo-image-prompt-back-panel" style="
                                        display:none; width: 100%; height: 100%; aspect-ratio: 1; background: #f7f7f7;
                                        border: 1px dashed #e0e0e0; border-radius: 4px; box-sizing: border-box;
                                        position: relative; overflow: hidden;
                                    ">
                                        <div style="width: 100%; height: 100%; padding: 6px; padding-bottom: 20px; overflow-y: auto; box-sizing: border-box; display: flex;">
                                            <div style="margin: auto; font-size: 10px; color: #666; line-height: 1.4; word-break: break-word; white-space: pre-wrap; text-align: center; width: 100%;">
                                                <div style="font-weight:700; margin-bottom:4px;">中文描述</div>
                                                <div>${safePromptText}</div>
                                                <div style="font-weight:700; margin:8px 0 4px;">英文Tag</div>
                                                <div>${safeTagText}</div>
                                            </div>
                                        </div>
                                        <div class="weibo-image-prompt-restore" title="恢复卡片正面" style="
                                            position:absolute; bottom:2px; right:2px; background:rgba(0,0,0,0.5); color:#fff;
                                            border-radius:3px; padding:2px 4px; font-size:9px; cursor:pointer; z-index:10; display:flex; align-items:center; gap:2px;
                                        ">${defaultIcon} 恢复</div>
                                    </div>
                                </div>`;
                            }
                        }).join('')}
                    </div>
                ` : ''}

                <!-- 数据统计栏 -->
                <div class="weibo-post-stats">
                    <div class="weibo-stat-item weibo-forward-btn" data-post-id="${post.id}">
                        <!-- 高仿微博转发图标 -->
                        <svg class="woo-icon" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19.5 12.5L14 7v3.5H7.5A2.5 2.5 0 0 0 5 13v5h1.5v-5A1 1 0 0 1 7.5 12H14v3.5l5.5-5.5z"></path></svg>
                        <span>${this._formatNum(post.forward || 0)}</span>
                    </div>
                    <div class="weibo-stat-item weibo-comment-btn" data-post-id="${post.id}">
                        <!-- 高仿微博评论图标 -->
                        <svg class="woo-icon" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7 19.5V22l4-3h7.5a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 18.5 5h-13A1.5 1.5 0 0 0 4 6.5v11A1.5 1.5 0 0 0 5.5 19H7zM5.5 6.5h13v11h-7l-3 2.25v-2.25h-3v-11z"></path></svg>
                        <span>${this._formatNum(post.commentList?.length || post.comments || 0)}</span>
                    </div>
                    <div class="weibo-stat-item weibo-like-btn ${isLiked ? 'liked' : ''}" data-post-id="${post.id}">
                        <!-- 高仿微博空心爱心 -->
                        <svg class="woo-icon woo-like-outline" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35zM7.5 4.5c-1.28 0-2.49.54-3.37 1.48C3.17 7 3.5 9 3.5 10c0 3.1 3.1 5.92 7.7 10.15l.8.72.8-.72C17.4 15.92 20.5 13.1 20.5 10c0-1-.33-3-1.63-4.02C17.99 5.04 16.78 4.5 15.5 4.5c-1.54 0-3.04.99-3.56 2.36h-1.88C9.54 5.49 8.04 4.5 7.5 4.5z"></path></svg>
                        <!-- 高仿微博实心爱心（已点赞时显示） -->
                        <svg class="woo-icon woo-like-filled" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>
                        <span>${this._formatNum(post.likes || 0)}</span>
                    </div>
                </div>

                <!-- 评论区：列表模式隐藏，详情模式显示 -->
                ${isDetail ? this._renderCommentsHtml(post) : ''}
            </div>
        `;
    }

    // ========================================
    // 🔍 热搜详情页
    // ========================================

    renderHotSearchDetail(title) {
        if (!title) {
            this.currentView = 'home';
            this.render();
            return;
        }

        const detail = this.app.weiboData.getHotSearchDetail(title);
        const floorData = this.app.weiboData.getHotFloorData(title);

        const html = `
            <div class="weibo-app weibo-subpage">
                <!-- 顶部导航栏 -->
                <div class="weibo-nav-bar">
                    <div class="weibo-nav-left">
                        <button class="weibo-back-btn" id="weibo-detail-back">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>
                    <div class="weibo-nav-title" style="font-size: 14px;">${title.length > 12 ? title.substring(0, 12) + '...' : title}</div>
                    <div class="weibo-nav-right">
                        <button class="weibo-nav-btn" id="weibo-hot-settings-btn">
                            <i class="fa-solid fa-gear"></i>
                        </button>
                    </div>
                </div>

                <!-- 话题头部 -->
                <div class="weibo-topic-header">
                    <div class="weibo-topic-tag">#${title}#</div>
                    <div class="weibo-topic-stats">
                        <span id="weibo-hot-floor-count">楼层 ${floorData.currentFloor}</span>
                    </div>
                </div>

                <div class="weibo-pull-refresh-indicator" id="weibo-hot-pull-refresh-indicator">
                    <div class="weibo-pull-refresh-inner" id="weibo-hot-pull-refresh-inner"></div>
                </div>

                <!-- 帖子列表 -->
                <div class="weibo-detail-posts" id="weibo-detail-posts">
                    ${detail?.posts?.length > 0
                ? `
                            ${detail.posts.map(post => this.renderWeiboPost(post, 'hotSearch')).join('')}
                        `
                : `
                            <div class="weibo-empty">
                                <div class="weibo-empty-icon">🔍</div>
                                <p>暂无内容</p>
                                <p class="weibo-empty-sub" id="weibo-auto-gen-hint">正在自动生成...</p>
                            </div>
                        `
            }
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'weibo-detail');
        this.bindDetailEvents(title);
        this._bindHotDetailPullRefresh(title);
        this._syncHotDetailRefreshIndicatorByState();

        // 如果没有内容，自动生成
        if (!detail?.posts?.length) {
            this.autoGenerateHotSearch(title);
        }
    }

    // 自动生成热搜内容
    async autoGenerateHotSearch(title) {
        // 🔥 核心修复：防并发锁。如果这个词条已经在生成中了，直接忽略，防止切屏重复请求！
        if (!this._generatingHotSearches) this._generatingHotSearches = new Set();
        if (this._generatingHotSearches.has(title)) return;

        this._generatingHotSearches.add(title); // 上锁

        try {
            this.app.phoneShell.showNotification('微博', '正在生成热搜内容...', '⏳');
            await this.app.weiboData.generateHotSearchDetail(title, (msg) => {
                const hint = document.getElementById('weibo-auto-gen-hint');
                if (hint) hint.textContent = msg;
            });
            
            // 防止热搜后台生成完毕后，暴力抢夺用户当前屏幕
            const isWeiboActive = document.querySelector('.phone-view-current .weibo-app');
            if (isWeiboActive && this.currentView === 'hotSearchDetail' && this.currentHotSearchTitle === title) {
                this.renderHotSearchDetail(title);
            }
            this.app.phoneShell.showNotification('微博', '热搜内容已生成', '✅');
        } catch (error) {
            console.error('热搜生成失败:', error);
            this.app.phoneShell.showNotification('微博', error.message || '热搜生成失败', '❌');
            const hint = document.getElementById('weibo-auto-gen-hint');
            if (hint) hint.textContent = '生成失败，请下拉加载更新';
        } finally {
            // 🔥 无论成功失败，最终必须解锁
            this._generatingHotSearches.delete(title);
        }
    }

    // ========================================
    // 📖 微博正文详情页
    // ========================================

    renderPostDetail(postId, mode = 'recommend') {
        // 查找帖子
        let post;
        if (mode === 'recommend') {
            const posts = this.app.weiboData.getRecommendPosts();
            post = posts?.find(p => p.id === postId);
        } else if (mode === 'myPosts') {
            const posts = this.app.weiboData.getUserPosts();
            post = posts?.find(p => p.id === postId);
        } else if (mode === 'hotSearch') {
            const detail = this.app.weiboData.getHotSearchDetail(this.currentHotSearchTitle);
            post = detail?.posts?.find(p => p.id === postId);
        }

        if (!post) {
            this.currentView = 'home';
            this.render();
            return;
        }

        const html = `
            <div class="weibo-app weibo-subpage" style="display: flex; flex-direction: column; height: 100%;">
                <!-- 导航栏（固定） -->
                <div class="weibo-nav-bar" style="position: relative; flex-shrink: 0;">
                    <div class="weibo-nav-left">
                        <button class="weibo-back-btn" id="weibo-detail-page-back">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>
                    <div class="weibo-nav-title">微博正文</div>
                    <div class="weibo-nav-right" style="min-width: 36px;"></div>
                </div>

                <div class="weibo-detail-page-body" id="weibo-detail-scroll-area" style="flex: 1; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; touch-action: pan-y; scrollbar-width: none; -ms-overflow-style: none; padding-bottom: 60px;">
                    ${this.renderWeiboPost(post, 'detail')}

                    <!-- 加载更多评论 -->
                    <div style="padding: 12px; text-align: center;">
                        <button id="load-more-comments-btn" style="
                            padding: 8px 20px; border: 1px solid #e0e0e0; border-radius: 16px;
                            background: #fff; color: #666; font-size: 11px; cursor: pointer;
                        ">
                            <i class="fa-regular fa-comment-dots"></i> 加载更多评论...
                        </button>
                    </div>
                </div>

                <!-- 🔥 新增：底部固定评论栏 -->
                <div class="weibo-fixed-bottom-bar" style="
                    position: absolute;
                    bottom: 0; left: 0; right: 0;
                    background: #f9f9f9;
                    border-top: 0.5px solid #e5e5e5;
                    padding: 8px 12px;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    z-index: 100;
                    box-sizing: border-box;
                ">
                    <div style="flex: 1; min-width: 0;">
                        <input type="text" id="fixed-comment-input" placeholder="写评论..." style="
                            width: 100%;
                            padding: 8px 14px;
                            border: 1px solid #e0e0e0;
                            border-radius: 20px;
                            font-size: 13px;
                            outline: none;
                            box-sizing: border-box;
                            background: #fff;
                        ">
                    </div>
                    <button id="fixed-comment-send" style="
                        background: transparent;
                        color: #ff8200 !important;
                        border: none;
                        border-radius: 0;
                        width: 32px;
                        height: 32px;
                        min-width: 32px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        cursor: pointer;
                        box-shadow: none;
                    ">
                        <i class="fa-solid fa-paper-plane weibo-send-plane-icon" style="font-size: 18px; color: #ff8200 !important;"></i>
                    </button>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'weibo-post-detail');
        
        this.currentReplyTo = null; // 初始化回复状态
        this.currentReplyRootIndex = null;
        this.currentReplyCommentIndex = null;
        this.bindPostDetailEvents(postId, mode);
    }

    _scrollDetailToComment(rootIndex = null, commentIndex = null) {
        const scrollArea = document.getElementById('weibo-detail-scroll-area');
        if (!scrollArea) return;

        if (!Number.isInteger(rootIndex)) {
            setTimeout(() => {
                if (scrollArea.isConnected) scrollArea.scrollTop = scrollArea.scrollHeight;
            }, 50);
            return;
        }

        setTimeout(() => {
            if (!scrollArea.isConnected) return;
            const target =
                (Number.isInteger(commentIndex)
                    ? scrollArea.querySelector(`[data-comment-index="${commentIndex}"]`)
                    : null) ||
                scrollArea.querySelector(`[data-comment-root-index="${rootIndex}"]`);

            if (!target) return;
            const targetTop = target.getBoundingClientRect().top;
            const areaTop = scrollArea.getBoundingClientRect().top;
            scrollArea.scrollTop += targetTop - areaTop - 12;
        }, 50);
    }

    bindPostDetailEvents(postId, mode) {
        // 返回
        document.getElementById('weibo-detail-page-back')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.returnFromPostDetail(mode);
        });

        // 帖子交互（详情页内的点赞、评论、转发）
        this._bindPostEvents(mode);
        this._bindWeiboMediaCardEvents();

        // 加载更多评论
        document.getElementById('load-more-comments-btn')?.addEventListener('click', async (e) => {
            const btn = e.target.closest('button');
            if (!btn || btn.disabled) return;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在加载...';

            try {
                const source = (mode === 'myPosts') ? 'user' : mode;
                const hotTitle = mode === 'hotSearch' ? this.currentHotSearchTitle : null;
                await this.app.weiboData.generateMoreComments(postId, source, hotTitle);
                this.renderPostDetail(postId, mode);
                this.app.phoneShell.showNotification('微博', '新评论已加载', '💬');
            } catch (error) {
                console.error('加载评论失败:', error);
                this.app.phoneShell.showNotification('微博', error.message || '加载评论失败', '❌');
            } finally {
                if (btn.isConnected) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-regular fa-comment-dots"></i> 加载更多评论...';
                }
            }
        });

        // 🔥 新增：固定底栏事件绑定
        const input = document.getElementById('fixed-comment-input');
        const sendBtn = document.getElementById('fixed-comment-send');
        
        if (input && sendBtn) {
            // 点击空白区域时，取消“回复某人”状态，变回普通的“写评论...”
            document.getElementById('weibo-detail-scroll-area')?.addEventListener('click', () => {
                this.currentReplyTo = null;
                this.currentReplyRootIndex = null;
                this.currentReplyCommentIndex = null;
                input.placeholder = "写评论...";
            });

            const submitComment = () => {
                const text = input.value?.trim();
                if (!text) return;

                const replyTo = this.currentReplyTo;
                const replyRootIndex = Number.isInteger(this.currentReplyRootIndex) ? this.currentReplyRootIndex : null;
                const replyCommentIndex = Number.isInteger(this.currentReplyCommentIndex) ? this.currentReplyCommentIndex : null;
                const hotSearchTitle = mode === 'hotSearch' ? String(this.currentHotSearchTitle || '').trim() : '';

                if (mode === 'recommend' || mode === 'myPosts') {
                    this.app.weiboData.addComment(postId, text, replyTo, mode === 'myPosts' ? 'user' : 'recommend', null, '本地', { replyRootIndex });
                } else {
                    this.app.weiboData.addCommentHotSearch(postId, text, replyTo, hotSearchTitle, null, '本地', { replyRootIndex });
                }

                // 清空输入框和状态
                input.value = '';
                this.currentReplyTo = null;
                this.currentReplyRootIndex = null;
                this.currentReplyCommentIndex = null;
                input.placeholder = "写评论...";

                // 🔥 核心修复：直接重新渲染整个详情页，确保评论100%精准显示在正文下方，且包含正确的回复对象
                this.renderPostDetail(postId, mode);
                
                // 普通评论滚到底部；楼中楼回复回到被回复的主楼，避免误以为回复被追加到了微博底部。
                this._scrollDetailToComment(replyRootIndex, replyCommentIndex);
                
                // 🔥 触发AI自动回复用户的评论 (已静默)
                this.triggerCommentAIReaction(postId, text, replyTo, mode, { replyRootIndex, replyCommentIndex, hotSearchTitle });
            };

            sendBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                submitComment();
            });

            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.stopPropagation();
                    submitComment();
                }
            });
        }
    }

    // ========================================
    // ⚙️ 热搜设置页
    // ========================================

    renderHotSearchSettings() {
        const floorSettings = this.app.weiboData.getFloorSettings();
        const promptManager = window.VirtualPhone?.promptManager;
        promptManager?.ensureLoaded();
        const hotSearchPrompt = promptManager?.getPromptForFeature('weibo', 'hotSearch') || '';

        const html = `
            <div class="weibo-app weibo-subpage">
                <div class="weibo-nav-bar">
                    <div class="weibo-nav-left">
                        <button class="weibo-back-btn" id="weibo-hot-settings-back">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>
                    <div class="weibo-nav-title">热搜设置</div>
                    <div class="weibo-nav-right"></div>
                </div>

                <div class="weibo-settings-content">
                    <!-- 楼层设置 -->
                    <div class="weibo-settings-section">
                        <div class="weibo-settings-title">楼层管理</div>

                        <div class="weibo-settings-item">
                            <span class="weibo-settings-label">当前总楼层</span>
                            <span class="weibo-settings-value">${floorSettings.totalFloors}</span>
                        </div>

                        <div class="weibo-settings-item">
                            <span class="weibo-settings-label">当前楼层</span>
                            <span class="weibo-settings-value">${floorSettings.currentFloor}</span>
                        </div>

                        <div class="weibo-settings-item">
                            <span class="weibo-settings-label">每隔N楼自动生成</span>
                            <input type="number" id="weibo-auto-interval" min="1" max="100"
                                   value="${floorSettings.autoInterval}"
                                   class="weibo-settings-input">
                        </div>

                        <div class="weibo-settings-item">
                            <span class="weibo-settings-label">自动生成</span>
                            <label class="toggle-switch">
                                <input type="checkbox" id="weibo-auto-enabled" ${floorSettings.autoEnabled ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>

                        <div class="weibo-settings-item">
                            <button class="weibo-settings-btn" id="weibo-correct-floor">
                                <i class="fa-solid fa-pen"></i> 修正当前楼层
                            </button>
                        </div>
                    </div>

                    <!-- 提示词设置 -->
                    <div class="weibo-settings-section">
                        <div class="weibo-settings-title">热搜提示词</div>
                        <div class="phone-prompt-fold" data-default-open="false">
                            <div class="phone-prompt-fold-header">
                                <div class="phone-prompt-fold-main">
                                    <div class="phone-prompt-fold-title">🔥 热搜内容生成规则</div>
                                    <div class="phone-prompt-fold-desc">默认折叠，展开后编辑热搜生成提示词。</div>
                                </div>
                                <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow"></i>
                            </div>
                            <div class="phone-prompt-fold-content">
                                ${promptManager?.renderPromptPresetControls?.('weibo', 'hotSearch') || ''}
                                <textarea id="weibo-hot-prompt" class="weibo-prompt-textarea"
                                          placeholder="热搜内容生成提示词...">${hotSearchPrompt}</textarea>
                                <button class="weibo-settings-btn" id="weibo-save-hot-prompt" style="margin-top: 8px;">
                                    <i class="fa-solid fa-check"></i> 保存提示词
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'weibo-hot-settings');
        this.bindHotSearchSettingsEvents();
    }

    // ========================================
    // ⚙️ 微博设置页
    // ========================================

    renderSettings() {
        const promptManager = window.VirtualPhone?.promptManager;
        promptManager?.ensureLoaded();
        const recommendPrompt = promptManager?.getPromptForFeature('weibo', 'recommend') || '';
        const hotSearchPrompt = promptManager?.getPromptForFeature('weibo', 'hotSearch') || '';
        const floorSettings = this.app.weiboData.getFloorSettings();
        const autoLastFloor = this.app.weiboData.getAutoLastFloor();
        const context = this.app.weiboData._getContext();
        const currentChatFloor = context?.chat?.length || 0;
        const profile = this.app.weiboData.getProfile();
        const userName = context?.name1 || '微博用户';
        const useWeiboWorldbook = window.VirtualPhone?.worldbookManager?.getEnabled?.('weibo') ?? true;

        const html = `
            <div class="weibo-app weibo-subpage">
                <div class="weibo-nav-bar">
                    <div class="weibo-nav-left">
                        <button class="weibo-back-btn" id="weibo-settings-back">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>
                    <div class="weibo-nav-title">微博设置</div>
                    <div class="weibo-nav-right"></div>
                </div>

                <div class="weibo-settings-content">
                    <!-- 个人资料 -->
                    <div class="weibo-settings-section">
                        <div class="weibo-settings-title">个人资料</div>

                        <div class="weibo-settings-item">
                            <span class="weibo-settings-label">昵称</span>
                            <input type="text" id="weibo-set-nickname" class="weibo-settings-text-input"
                                   value="${profile.nickname || userName}" placeholder="微博昵称">
                        </div>

                        <div class="weibo-settings-item">
                            <span class="weibo-settings-label">IP属地</span>
                            <input type="text" id="weibo-set-ip" class="weibo-settings-text-input"
                                   value="${profile.ipLocation || 'IP属地：未知'}" placeholder="IP属地：XX">
                        </div>

                        <div class="weibo-settings-item">
                            <span class="weibo-settings-label">关注数</span>
                            <input type="number" id="weibo-set-following" class="weibo-settings-input"
                                   value="${profile.following ?? 25}" min="0">
                        </div>

                        <div class="weibo-settings-item">
                            <span class="weibo-settings-label">粉丝数</span>
                            <input type="number" id="weibo-set-followers" class="weibo-settings-input"
                                   value="${profile.followers ?? 0}" min="0">
                        </div>
                        <div class="weibo-settings-desc" style="margin-top: -4px;">
                            用户可手动设置；AI 返回粉丝数时会在当前基础上同步波动。
                        </div>

                        <button class="weibo-settings-btn" id="weibo-save-profile">
                            <i class="fa-solid fa-check"></i> 保存资料
                        </button>
                    </div>

                    <!-- 自动生成设置 -->
                    <div class="weibo-settings-section">
                        <div class="weibo-settings-title">自动生成微博</div>
                        <div class="weibo-settings-desc">当正文楼层达到阈值时自动在后台生成微博内容</div>

                        <div class="weibo-settings-item">
                            <span class="weibo-settings-label">自动生成</span>
                            <label class="toggle-switch">
                                <input type="checkbox" id="weibo-auto-gen-switch" ${floorSettings.autoEnabled ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>

                        <div class="weibo-settings-item">
                            <span class="weibo-settings-label">每隔N楼触发</span>
                            <input type="number" id="weibo-auto-floor-interval" min="1" max="999"
                                   value="${floorSettings.autoInterval || 50}"
                                   class="weibo-settings-input">
                        </div>

                        <div class="weibo-settings-item">
                            <span class="weibo-settings-label">当前正文楼层</span>
                            <span class="weibo-settings-value">${currentChatFloor}</span>
                        </div>

                        <div class="weibo-settings-item">
                            <span class="weibo-settings-label">上次记录到</span>
                            <span class="weibo-settings-value">${autoLastFloor} 层</span>
                        </div>

                        <div class="weibo-settings-item">
                            <button class="weibo-settings-btn" id="weibo-correct-auto-floor" style="background: #f5f5f5; color: #333;">
                                <i class="fa-solid fa-pen"></i> 修正记录楼层
                            </button>
                        </div>
                    </div>

                    <!-- 头像和背景图 -->
                    <div class="weibo-settings-section">
                        <div class="weibo-settings-title">头像和背景</div>

                        <input type="file" id="weibo-settings-avatar-upload" accept="image/png, image/jpeg, image/gif, image/webp, image/*" style="display: none;">
                        <input type="file" id="weibo-settings-banner-upload" accept="image/png, image/jpeg, image/gif, image/webp, image/*" style="display: none;">

                        <div class="weibo-settings-item">
                            <span class="weibo-settings-label">头像</span>
                            <label for="weibo-settings-avatar-upload" class="weibo-settings-btn" style="width: auto; margin: 0; padding: 5px 12px; font-size: 11px; display: inline-block; cursor: pointer; text-align: center; box-sizing: border-box;">
                                <i class="fa-solid fa-camera"></i> 上传头像
                            </label>
                        </div>

                        <div class="weibo-settings-item">
                            <span class="weibo-settings-label">背景图</span>
                            <label for="weibo-settings-banner-upload" class="weibo-settings-btn" style="width: auto; margin: 0; padding: 5px 12px; font-size: 11px; display: inline-block; cursor: pointer; text-align: center; box-sizing: border-box;">
                                <i class="fa-solid fa-image"></i> 上传背景
                            </label>
                        </div>

                        <!-- 🔥 全局：自定义界面 CSS 输入区 -->
                        <div style="margin-top: 15px; border-top: 1px solid #f0f0f0; padding-top: 15px;">
                            <div class="weibo-settings-title" style="margin-bottom: 8px;">👑 自定义微博界面 CSS</div>
                            <div class="weibo-settings-desc" style="margin-bottom: 8px;">输入 CSS 代码可修改头像框、个人面板、Tab栏、按钮等。</div>
                            <textarea id="weibo-avatar-frame-css" class="weibo-prompt-textarea"
                                      placeholder="/* 头像框 */&#10;.weibo-avatar-wrapper::after { ... }&#10;/* 面板 */&#10;.weibo-profile-section { ... }&#10;/* Tab文字 */&#10;.weibo-tab { ... }&#10;/* 加号按钮 */&#10;.weibo-mypost-add-btn { ... }">${profile.avatarFrameCss || ''}</textarea>
                            <button class="weibo-settings-btn" id="weibo-save-frame-css">
                                <i class="fa-solid fa-check"></i> 保存自定义 CSS
                            </button>
                        </div>
                    </div>

                    <!-- 生成上下文 -->
                    <div class="weibo-settings-section">
                        <div class="weibo-settings-title">生成上下文</div>
                        <div class="weibo-settings-item">
                            <div style="min-width: 0;">
                                <span class="weibo-settings-label">使用酒馆世界书</span>
                                <div class="weibo-settings-desc" style="margin-top: 4px;">开启后，微博生成会注入下方勾选的酒馆世界书；开关与勾选状态跟随当前角色卡。</div>
                            </div>
                            <label class="toggle-switch" style="flex: 0 0 auto;">
                                <input type="checkbox" id="weibo-use-worldbook" ${useWeiboWorldbook ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="phone-prompt-fold weibo-worldbook-fold" data-default-open="false" style="margin-top: 10px;">
                            <div class="phone-prompt-fold-header">
                                <div class="phone-prompt-fold-main">
                                    <div class="phone-prompt-fold-title">世界书选择</div>
                                    <div class="phone-prompt-fold-desc">展开后勾选要注入微博生成的酒馆世界书</div>
                                </div>
                                <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow"></i>
                            </div>
                            <div class="phone-prompt-fold-content">
                                <div id="weibo-worldbook-list">
                                    <div class="weibo-settings-desc" style="padding-top: 8px;">正在读取当前可用世界书...</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 推荐提示词 -->
                    <div class="weibo-settings-section">
                        <div class="weibo-settings-title">推荐生成提示词</div>
                        <div class="phone-prompt-fold" data-default-open="false">
                            <div class="phone-prompt-fold-header">
                                <div class="phone-prompt-fold-main">
                                    <div class="phone-prompt-fold-title">🏠 推荐流提示词</div>
                                    <div class="phone-prompt-fold-desc">默认折叠，展开后编辑推荐微博生成规则。</div>
                                </div>
                                <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow"></i>
                            </div>
                            <div class="phone-prompt-fold-content">
                                ${promptManager?.renderPromptPresetControls?.('weibo', 'recommend') || ''}
                                <textarea id="weibo-recommend-prompt" class="weibo-prompt-textarea"
                                          placeholder="推荐内容生成提示词...">${recommendPrompt}</textarea>
                                <div style="display: flex; gap: 6px; margin-top: 6px;">
                                    <button class="weibo-settings-btn" id="weibo-save-recommend-prompt" style="flex: 1;">
                                        <i class="fa-solid fa-check"></i> 保存
                                    </button>
                                    <button class="weibo-settings-btn" id="weibo-reset-recommend-prompt" style="flex: 1; background: #f5f5f5; color: #666;">
                                        <i class="fa-solid fa-rotate-left"></i> 恢复默认
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 热搜提示词 -->
                    <div class="weibo-settings-section">
                        <div class="weibo-settings-title">热搜详情提示词</div>
                        <div class="phone-prompt-fold" data-default-open="false">
                            <div class="phone-prompt-fold-header">
                                <div class="phone-prompt-fold-main">
                                    <div class="phone-prompt-fold-title">📈 热搜详情提示词</div>
                                    <div class="phone-prompt-fold-desc">默认折叠，展开后编辑热搜详情生成规则。</div>
                                </div>
                                <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow"></i>
                            </div>
                            <div class="phone-prompt-fold-content">
                                ${promptManager?.renderPromptPresetControls?.('weibo', 'hotSearch') || ''}
                                <textarea id="weibo-hotsearch-prompt" class="weibo-prompt-textarea"
                                          placeholder="热搜详情生成提示词...">${hotSearchPrompt}</textarea>
                                <div style="display: flex; gap: 6px; margin-top: 6px;">
                                    <button class="weibo-settings-btn" id="weibo-save-hotsearch-prompt" style="flex: 1;">
                                        <i class="fa-solid fa-check"></i> 保存
                                    </button>
                                    <button class="weibo-settings-btn" id="weibo-reset-hotsearch-prompt" style="flex: 1; background: #f5f5f5; color: #666;">
                                        <i class="fa-solid fa-rotate-left"></i> 恢复默认
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 🔥 新增：数据管理 (清理空间) -->
                    <div class="weibo-settings-section">
                        <div class="weibo-settings-title">数据瘦身</div>
                        <div class="weibo-settings-desc">清空手机内微博数据，并擦除酒馆聊天记录里臃肿的隐藏标签</div>
                        <button class="weibo-settings-btn" id="weibo-clear-all-data-btn" style="background: #ff4d4f; color: #fff;">
                            <i class="fa-solid fa-trash"></i> 彻底清空所有微博数据
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'weibo-settings');
        this.bindSettingsEvents();
    }

    // ========================================
    // 📝 发微博页面
    // ========================================

    showPostWeiboPage() {
        const context = this.app.weiboData._getContext();
        const userName = context?.name1 || '微博用户';
        const profile = this.app.weiboData.getProfile();
        const nickname = profile.nickname || userName;

        const displayAvatar = this._getWeiboDisplayAvatar(profile);
        const avatarHtml = displayAvatar
            ? `<img src="${this._escapeAttr(displayAvatar)}" style="width: 100%; height: 100%; object-fit: cover;">`
            : '📷';

        const html = `
            <div class="weibo-app">
                <div class="weibo-nav-bar">
                    <div class="weibo-nav-left">
                        <button class="weibo-back-btn" id="weibo-post-back">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>
                    <div class="weibo-nav-title">发微博</div>
                    <div class="weibo-nav-right">
                        <button class="weibo-nav-btn" id="weibo-publish-btn" style="color: #ff8200; font-size: 13px; font-weight: 600;">
                            发布
                        </button>
                    </div>
                </div>

                <div style="background: #fff; padding: 14px; flex: 1;">
                    <!-- 用户信息行 -->
                    <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                        <div style="width: 36px; height: 36px; border-radius: 50%; overflow: hidden; background: linear-gradient(135deg, #ff8200, #e85d04); display: flex; align-items: center; justify-content: center; font-size: 16px; color: #fff; flex-shrink: 0;">
                            ${avatarHtml}
                        </div>
                        <div style="flex: 1;">
                            <div style="font-size: 13px; font-weight: 600; color: #1a1a1a;">${nickname}</div>
                            <div style="font-size: 10px; color: #999; margin-top: 1px;">公开</div>
                        </div>
                    </div>

                    <!-- 输入区 -->
                    <textarea id="weibo-post-text" placeholder="分享新鲜事..." style="
                        width: 100%;
                        min-height: 100px;
                        padding: 8px;
                        border: none;
                        font-size: 14px;
                        line-height: 1.5;
                        resize: none;
                        outline: none;
                        box-sizing: border-box;
                        background: transparent;
                    "></textarea>

                    <!-- 图片预览 -->
                    <div id="weibo-post-images-preview" style="display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0;"></div>

                    <!-- 添加图片 -->
                    <div style="margin-top: 12px; padding-top: 12px; border-top: 0.5px solid #f0f0f0;">
                        <input type="file" id="weibo-post-image-upload" accept="image/png, image/jpeg, image/gif, image/webp, image/*" multiple style="display: none;">
                        <button id="weibo-add-image-btn" style="
                            display: flex; align-items: center; gap: 8px; padding: 10px 12px;
                            background: #f7f7f7; border: none; border-radius: 6px;
                            font-size: 12px; color: #333; cursor: pointer; width: 100%;
                        ">
                            <i class="fa-solid fa-image" style="font-size: 16px; color: #ff8200;"></i>
                            <span>添加图片</span>
                            <span style="margin-left: auto; color: #999; font-size: 10px;">最多9张</span>
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'weibo-post');
        this.pendingPostImages = [];
        this.bindPostWeiboEvents();
    }

    bindPostWeiboEvents() {
        // 🔥 核心修复：用 data-view-id 精准定位视图层，不受 z-index/class 切换影响
        const composeLayer = document.querySelector('[data-view-id="weibo-post"]');
        const currentView = composeLayer || document.querySelector('.phone-view-current') || document;

        // 🔥 缓存关键DOM引用，防止异步操作后querySelector失效
        this._postComposeView = currentView;

        // 返回
        currentView.querySelector('#weibo-post-back')?.addEventListener('click', () => {
            this.currentView = 'home';
            this._postComposeView = null;
            this.render();
        });

        // 添加图片按钮点击
        currentView.querySelector('#weibo-add-image-btn')?.addEventListener('click', () => {
            currentView.querySelector('#weibo-post-image-upload')?.click();
        });

        // 🖼️ 图片上传核心逻辑
        currentView.querySelector('#weibo-post-image-upload')?.addEventListener('change', async (e) => {
            const rawFiles = e.target.files;
            if (!rawFiles || rawFiles.length === 0) return;
            
            // 🔥【核心修复】：必须在清空 input 之前，将动态的 FileList 转换为真正的静态数组！
            const filesArray = Array.from(rawFiles);
            
            // 现在可以安全地立即重置 input 了，允许用户重复选同一张图
            e.target.value = '';

            const maxImages = 9;
            const remaining = maxImages - (this.pendingPostImages?.length || 0);
            if (remaining <= 0) {
                this.app.phoneShell.showNotification('提示', '最多只能上传9张图片', '⚠️');
                return;
            }

            // 使用转换好的静态数组进行截取
            const filesToProcess = filesArray.slice(0, remaining);
            this.app.phoneShell.showNotification('处理中', `正在上传 ${filesToProcess.length} 张图片...`, '⏳');

            let successCount = 0;
            let failCount = 0;
            for (const file of filesToProcess) {
                try {
                    const cropper = new ImageCropper({
                        title: '裁剪图片',
                        aspectRatio: 1, // 微博配图正方形
                        outputWidth: 600,
                        outputHeight: 600,
                        quality: 0.85,
                        maxFileSize: 5 * 1024 * 1024
                    });
                    
                    const croppedImage = await cropper.open(file);
                    const finalUrl = await window.VirtualPhone?.imageManager?.uploadDataUrl?.(croppedImage, 'weibo_img');
                    if (!finalUrl) throw new Error('图片上传管理器未初始化');

                    // 写入预览数组并立刻渲染
                    if (!this.pendingPostImages) this.pendingPostImages = [];
                    this.pendingPostImages.push(finalUrl);
                    this.updatePostImagePreview();
                    successCount += 1;
                } catch (error) {
                    if (error.message !== '用户取消') {
                        failCount += 1;
                        this.app.phoneShell.showNotification('上传失败', error.message, '❌');
                    }
                }
            }
            if (successCount > 0) {
                const suffix = failCount > 0 ? `，失败 ${failCount} 张` : '';
                this.app.phoneShell.showNotification('成功', `图片处理完成（成功 ${successCount} 张${suffix}）`, '✅');
            } else {
                this.app.phoneShell.showNotification('上传失败', '没有图片上传成功', '❌');
            }
        });
        
        // 发布
        currentView.querySelector('#weibo-publish-btn')?.addEventListener('click', () => {
            this.publishWeibo();
        });
    }

    updatePostImagePreview() {
        // 🔥 核心修复：优先用 data-view-id 精准定位，最稳定不受视图层切换影响
        const container =
            document.querySelector('[data-view-id="weibo-post"] #weibo-post-images-preview') ||
            this._postComposeView?.querySelector('#weibo-post-images-preview') ||
            document.querySelector('.phone-view-current #weibo-post-images-preview') ||
            document.getElementById('weibo-post-images-preview');

        if (!container) {
            console.warn('[Weibo] 找不到图片预览容器 #weibo-post-images-preview');
            return;
        }

        const images = this.pendingPostImages || [];
        console.log('[Weibo] 更新图片预览, 图片数:', images.length, '容器:', container.parentElement?.id || container.closest('[data-view-id]')?.getAttribute('data-view-id'));

        container.innerHTML = images.map((img, idx) => `
            <div style="position: relative; width: 70px; height: 70px; flex-shrink: 0;">
                <img src="${img}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px; display: block;">
                <button class="weibo-remove-post-img" data-index="${idx}" style="
                    position: absolute; top: -4px; right: -4px;
                    width: 16px; height: 16px; border-radius: 50%;
                    background: rgba(0,0,0,0.6); color: #fff; border: none;
                    font-size: 10px; cursor: pointer;
                    display: flex; align-items: center; justify-content: center;
                ">x</button>
            </div>
        `).join('');

        container.querySelectorAll('.weibo-remove-post-img').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                this.pendingPostImages.splice(idx, 1);
                this.updatePostImagePreview();
            });
        });
    }

    async publishWeibo() {
        // 🔥 核心修复：优先用 data-view-id 精准定位
        const textInput =
            document.querySelector('[data-view-id="weibo-post"] #weibo-post-text') ||
            this._postComposeView?.querySelector('#weibo-post-text') ||
            document.querySelector('.phone-view-current #weibo-post-text') ||
            document.getElementById('weibo-post-text');
        const text = textInput?.value?.trim() || '';
        const images = this.pendingPostImages || [];

        if (!text && images.length === 0) {
            this.app.phoneShell.showNotification('提示', '请输入内容或添加图片', '⚠️');
            return;
        }

        // 调用 weiboData 发布
        const newPost = this.app.weiboData.publishUserPost(text, images);

        this.pendingPostImages = [];
        this._postComposeView = null;
        this.app.phoneShell.showNotification('发布成功', '你的微博已发布', '✅');

        // 切回我的微博tab显示
        this.currentTab = 'myPosts';
        this.currentView = 'home';

        setTimeout(() => {
            this.render();
        }, 300);

        // 触发AI互动（陌生网友评论点赞）
        this.triggerWeiboAIReaction(newPost);
    }

    // AI互动：陌生网友/营销号/官方号 对用户发的微博进行评论和点赞
    async triggerWeiboAIReaction(post) {
        try {
            this.app.phoneShell.showNotification('微博', '网友正在围观...', '👀');

            const result = await this.app.weiboData.generateReactionForPost(post);

            if (result && (result.comments?.length > 0 || result.likes?.length > 0)) {
                // 延迟逐条添加
                for (let i = 0; i < (result.comments || []).length; i++) {
                    const c = result.comments[i];
                    await new Promise(r => setTimeout(r, 800 + Math.random() * 1500));

                    const aiReplyTo = c.replyTo ? String(c.replyTo).trim() : null;
                    this.app.weiboData.addComment(post.id, c.text, aiReplyTo || null, 'user', c.name, c.location || '');
                }

                for (const likeName of (result.likes || [])) {
                    const posts = this.app.weiboData.getUserPosts();
                    const updatedPost = posts.find(p => p.id === post.id);
                    if (updatedPost) {
                        if (!updatedPost.likeList) updatedPost.likeList = [];
                        if (!updatedPost.likeList.includes(likeName)) {
                            updatedPost.likeList.push(likeName);
                            updatedPost.likes = updatedPost.likeList.length;
                        }
                        this.app.weiboData.saveUserPosts(posts);
                        this.app.weiboData._syncUserPostMirror(updatedPost);
                    }
                }

                this.app.phoneShell.showNotification('微博', '收到新互动', '💬');
                // 用户还在微博首页时，推荐/我的页都局部刷新，不重绘整个首页
                if (this.currentView === 'home' && (this.currentTab === 'recommend' || this.currentTab === 'myPosts')) {
                    this.refreshCurrentTabContent();
                }
            }
        } catch (error) {
            console.error('微博AI互动失败:', error);
        }
    }

    // ========================================
    // 📤 转发弹窗
    // ========================================

    async showForwardDialog(post) {
        // 🔥 等待后台拉取微信数据库
        const contacts = await this.app.weiboData.getWechatContactsAsync();
        // 获取所有已有聊天，筛选出群聊
        let wechatData = window.VirtualPhone?.wechatApp?.wechatData || window.VirtualPhone?.cachedWechatData;
        const groupChats = wechatData ? wechatData.getChatList().filter(c => c.type === 'group') : [];
        // 将群聊伪装成联系人格式，合并到展示列表中
        const forwardTargets = [
            ...contacts.map(contact => ({
                ...contact,
                avatar: this._resolveWechatForwardAvatar(contact, wechatData) || contact.avatar || ''
            })),
            ...groupChats.map(g => ({
                ...g,
                avatar: this._resolveWechatForwardAvatar(g, wechatData, { isGroup: true }) || g.avatar || '👥',
                isGroup: true
            }))
        ];

        if (forwardTargets.length === 0) {
            this.app.phoneShell.showNotification('提示', '请先在微信中添加联系人', '⚠️');
            return;
        }

        const targetMap = new Map(forwardTargets.map(target => [target.name, target]));
        const previewDesc = this._escapeHtml((post.content || '').substring(0, 50));
        const previewTitle = this._escapeHtml(post.blogger || '微博');

        // 🔥 清理旧弹窗，防止重复叠加
        document.querySelectorAll('.weibo-forward-overlay').forEach(el => el.remove());

        const overlay = document.createElement('div');
        overlay.className = 'weibo-forward-overlay';

        const phoneScreen = document.querySelector('.phone-screen');
        const lockTarget = document.querySelector('.phone-view-current .weibo-app') || document.querySelector('.weibo-app');

        if (lockTarget) lockTarget.classList.add('weibo-forward-lock');
        if (phoneScreen) phoneScreen.classList.add('weibo-forward-open');

        const closeOverlay = () => {
            if (lockTarget) lockTarget.classList.remove('weibo-forward-lock');
            if (phoneScreen) phoneScreen.classList.remove('weibo-forward-open');
            overlay.remove();
        };

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeOverlay();
        });

        // 🔥 阻止滚动穿透到底层微博页面
        overlay.addEventListener('wheel', (e) => {
            const list = e.target.closest('.weibo-forward-list');
            if (list) {
                list.scrollTop += e.deltaY;
            }
            e.preventDefault();
        }, { passive: false });

        overlay.addEventListener('touchmove', (e) => {
            const inScrollableList = !!e.target.closest('.weibo-forward-list');
            if (!inScrollableList) {
                e.preventDefault();
            }
        }, { passive: false });

        const renderTargetList = () => `
            <div class="weibo-forward-dialog">
                <div class="weibo-forward-header">
                    <span>转发到微信</span>
                    <button class="weibo-forward-close" id="weibo-forward-close">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div class="weibo-forward-preview">
                    <div class="weibo-card-preview">
                        <div class="weibo-card-icon">微博</div>
                        <div class="weibo-card-info">
                            <div class="weibo-card-title">${previewTitle}</div>
                            <div class="weibo-card-desc">${previewDesc}${(post.content || '').length > 50 ? '...' : ''}</div>
                        </div>
                    </div>
                </div>

                <div class="weibo-forward-list">
                    ${forwardTargets.map(c => `
                        <div class="weibo-forward-contact" data-name="${this._escapeAttr(c.name)}">
                            <div class="weibo-forward-contact-avatar">${this._renderForwardTargetAvatar(c.avatar, c.name, c.isGroup)}</div>
                            <div class="weibo-forward-contact-name">${this._escapeHtml(c.name)}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        const bindTargetListEvents = () => {
            overlay.querySelector('#weibo-forward-close')?.addEventListener('click', () => {
                closeOverlay();
            });

            overlay.querySelectorAll('.weibo-forward-contact').forEach(item => {
                item.addEventListener('click', () => {
                    const friendName = item.dataset.name;
                    const target = targetMap.get(friendName) || { name: friendName, avatar: '👤' };
                    renderComposeDialog(target);
                });
            });
        };

        const renderComposeDialog = (target) => {
            overlay.innerHTML = `
                <div class="weibo-forward-dialog weibo-forward-dialog-compose">
                    <div class="weibo-forward-header">
                        <button class="weibo-forward-close" id="weibo-forward-back">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                        <span>发送给</span>
                        <button class="weibo-forward-close" id="weibo-forward-close-2">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>

                    <div class="weibo-forward-recipient-row">
                        <div class="weibo-forward-contact-avatar">${this._renderForwardTargetAvatar(target.avatar, target.name, target.isGroup)}</div>
                        <div class="weibo-forward-contact-name">${this._escapeHtml(target.name)}</div>
                        <i class="fa-solid fa-chevron-right"></i>
                    </div>

                    <div class="weibo-forward-preview weibo-forward-preview-compact">
                        <div class="weibo-card-preview">
                            <div class="weibo-card-icon">微博</div>
                            <div class="weibo-card-info">
                                <div class="weibo-card-title">${previewTitle}</div>
                                <div class="weibo-card-desc">${previewDesc}${(post.content || '').length > 50 ? '...' : ''}</div>
                            </div>
                        </div>
                    </div>

                    <div class="weibo-forward-input-wrap">
                        <input type="text" id="weibo-forward-note-input" class="weibo-forward-note-input" placeholder="发消息（可选）" maxlength="200">
                        <i class="fa-regular fa-face-smile"></i>
                    </div>

                    <div class="weibo-forward-actions">
                        <button id="weibo-forward-cancel" class="weibo-forward-action-btn weibo-forward-cancel">取消</button>
                        <button id="weibo-forward-send" class="weibo-forward-action-btn weibo-forward-send">发送</button>
                    </div>
                </div>
            `;

            const backToList = () => {
                overlay.innerHTML = renderTargetList();
                bindTargetListEvents();
            };

            overlay.querySelector('#weibo-forward-back')?.addEventListener('click', backToList);
            overlay.querySelector('#weibo-forward-cancel')?.addEventListener('click', backToList);
            overlay.querySelector('#weibo-forward-close-2')?.addEventListener('click', () => closeOverlay());

            const sendBtn = overlay.querySelector('#weibo-forward-send');
            const inputEl = overlay.querySelector('#weibo-forward-note-input');
            const sendNow = async () => {
                if (!sendBtn || sendBtn.disabled) return;
                sendBtn.disabled = true;
                const forwardText = (inputEl?.value || '').trim();
                try {
                    const result = await this.app.weiboData.forwardToWechat(post, target.name, { forwardText });
                    if (forwardText) {
                        this._triggerWechatAutoReplyAfterForward(result?.chatId, target.name, forwardText);
                    }
                    this.app.phoneShell.showNotification('转发成功', `已转发给 ${target.name}`, '✅');
                    closeOverlay();
                } catch (error) {
                    this.app.phoneShell.showNotification('转发失败', error.message, '❌');
                } finally {
                    sendBtn.disabled = false;
                }
            };

            sendBtn?.addEventListener('click', sendNow);
            inputEl?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    sendNow();
                }
            });
            inputEl?.focus();
        };

        overlay.innerHTML = renderTargetList();
        phoneScreen?.appendChild(overlay);
        bindTargetListEvents();
    }

    async _triggerWechatAutoReplyAfterForward(chatId, friendName, forwardText = '') {
        if (!chatId) return;

        try {
            let wechatApp = window.currentWechatApp || window.ggp_currentWechatApp || window.VirtualPhone?.wechatApp || null;
            if (!wechatApp) {
                const module = await import('../wechat/wechat-app.js');
                const phoneShell = window.VirtualPhone?.phoneShell || this.app.phoneShell;
                const storage = window.VirtualPhone?.storage || this.app.storage;
                if (!phoneShell || !storage) return;

                wechatApp = new module.WechatApp(phoneShell, storage);
                if (window.VirtualPhone) {
                    if (window.VirtualPhone.cachedWechatData) {
                        wechatApp.wechatData = window.VirtualPhone.cachedWechatData;
                    } else {
                        window.VirtualPhone.cachedWechatData = wechatApp.wechatData;
                    }
                    window.VirtualPhone.wechatApp = wechatApp;
                }
                window.currentWechatApp = wechatApp;
                window.ggp_currentWechatApp = wechatApp;
            }

            const targetChat = wechatApp.wechatData.getChat(chatId) || wechatApp.wechatData.getChatList().find(c => c.id === chatId);
            if (!targetChat || !wechatApp.chatView) return;

            wechatApp.currentView = 'chats';
            wechatApp.currentChat = targetChat;

            if (typeof wechatApp.chatView.isOnlineMode === 'function' && !wechatApp.chatView.isOnlineMode()) {
                this.app.phoneShell.showNotification('微信离线模式', '未触发自动回复，请先开启在线模式', '⚠️');
                return;
            }

            wechatApp.chatView.sendToAI(forwardText, chatId).catch((error) => {
                console.error('微博转发后自动触发微信回复失败:', error);
            });

            this.app.phoneShell.showNotification('微信', `${friendName} 正在回复中...`, '⏳');
        } catch (error) {
            console.error('微博转发后自动联动失败:', error);
        }
    }

    // ========================================
    // 💬 评论输入
    // ========================================

    showCommentInput(postId, replyTo = null, mode = 'recommend', meta = {}) {
        // 移除之前的输入框
        document.querySelectorAll('.weibo-inline-comment-box').forEach(el => el.remove());

        const postEl = document.querySelector(`.weibo-post[data-post-id="${postId}"]`);
        if (!postEl) return;

        const inputBox = document.createElement('div');
        inputBox.className = 'weibo-inline-comment-box';
        inputBox.innerHTML = `
            <input type="text" class="weibo-comment-input" placeholder="${replyTo ? `回复 ${replyTo}` : '写评论...'}" autofocus>
            <button class="weibo-comment-send"><i class="fa-solid fa-paper-plane weibo-send-plane-icon"></i></button>
        `;
        postEl.appendChild(inputBox);

        const input = inputBox.querySelector('.weibo-comment-input');
        const sendBtn = inputBox.querySelector('.weibo-comment-send');

        input.focus();

        const submitComment = () => {
            const text = input.value?.trim();
            if (!text) return;
            const hotSearchTitle = mode === 'hotSearch' ? String(this.currentHotSearchTitle || '').trim() : '';

            if (mode === 'recommend' || mode === 'myPosts') {
                this.app.weiboData.addComment(postId, text, replyTo, mode === 'myPosts' ? 'user' : 'recommend', null, '本地', {
                    replyRootIndex: Number.isInteger(meta?.replyRootIndex) ? meta.replyRootIndex : null
                });
            } else {
                this.app.weiboData.addCommentHotSearch(postId, text, replyTo, hotSearchTitle, null, '本地', {
                    replyRootIndex: Number.isInteger(meta?.replyRootIndex) ? meta.replyRootIndex : null
                });
            }

            inputBox.remove();

            // 局部更新评论区
            const updatedPosts = mode === 'recommend'
                ? this.app.weiboData.getRecommendPosts()
                : mode === 'myPosts'
                    ? this.app.weiboData.getUserPosts()
                    : this.app.weiboData.getHotSearchDetail(hotSearchTitle)?.posts;

            const updatedPost = updatedPosts?.find(p => p.id === postId);
            if (updatedPost) {
                const commentsEl = postEl.querySelector('.weibo-post-comments');
                const newCommentsHtml = this._renderCommentsHtml(updatedPost);
                if (commentsEl) {
                    commentsEl.outerHTML = newCommentsHtml;
                } else {
                    postEl.insertAdjacentHTML('beforeend', newCommentsHtml);
                }

                // 更新评论数
                const commentCountEl = postEl.querySelector('.weibo-comment-btn span');
                if (commentCountEl) {
                    commentCountEl.textContent = this._formatNum(updatedPost.comments || updatedPost.commentList?.length || 0);
                }
            }
            
            // 🔥 触发AI自动回复用户的评论
            this.triggerCommentAIReaction(postId, text, replyTo, mode, {
                replyRootIndex: Number.isInteger(meta?.replyRootIndex) ? meta.replyRootIndex : null,
                replyCommentIndex: Number.isInteger(meta?.replyCommentIndex) ? meta.replyCommentIndex : null,
                hotSearchTitle
            });
        };

        sendBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            submitComment();
        });

        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.stopPropagation();
                submitComment();
            }
        });

        input.addEventListener('click', (e) => e.stopPropagation());
        inputBox.addEventListener('click', (e) => e.stopPropagation());
        inputBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    _renderCommentsHtml(post) {
        if (!post.commentList?.length) return '';

        // 🔥 核心逻辑：将扁平的评论数组转换为“主评论 + 楼中楼”的嵌套结构
        const groupedComments = [];
        const rootByOriginalIndex = new Map();
        
        post.commentList.forEach((c, idx) => {
            const cleanName = (c.name || '网友').replace(/^@/, '');
            const cleanReplyTo = c.replyTo ? c.replyTo.replace(/^@/, '') : null;
            const replyRootIndex = Number.parseInt(c.replyRootIndex, 10);
            
            const commentObj = { 
                ...c, 
                originalIndex: idx, 
                cleanName: cleanName, 
                cleanReplyTo: cleanReplyTo, 
                replyRootIndex: Number.isInteger(replyRootIndex) ? replyRootIndex : null,
                subComments: [] 
            };

            if (commentObj.replyRootIndex !== null && rootByOriginalIndex.has(commentObj.replyRootIndex)) {
                rootByOriginalIndex.get(commentObj.replyRootIndex).subComments.push(commentObj);
                return;
            }

            // 如果没有回复对象，或者是直接回复微博正文作者，视为主评论。
            // 显式 replyRootIndex 已在上方优先处理，避免回复评论区里的博主评论时被错误追加到底部。
            if (!cleanReplyTo || cleanReplyTo === post.blogger) {
                groupedComments.push(commentObj);
                rootByOriginalIndex.set(idx, commentObj);
            } else {
                // 如果有回复对象，倒序向上寻找属于哪个主评论的圈子
                let foundParent = false;
                for (let i = groupedComments.length - 1; i >= 0; i--) {
                    const parent = groupedComments[i];
                    // 判断条件：回复的是这个主评论的人，或者是这个主评论下其他子评论的人
                    if (parent.cleanName === cleanReplyTo || parent.subComments.some(s => s.cleanName === cleanReplyTo)) {
                        parent.subComments.push(commentObj);
                        foundParent = true;
                        break;
                    }
                }
                // 异常兜底：如果找不到对应的楼主（比如数据缺失），就强行让它自立门户当主评论
                if (!foundParent) {
                    groupedComments.push(commentObj);
                    rootByOriginalIndex.set(idx, commentObj);
                }
            }
        });

        // 渲染重组后的 HTML
        return `
            <div class="weibo-post-comments weibo-detail-comments">
                <div class="weibo-comments-title">评论 ${post.commentList.length}</div>
                ${groupedComments.map((mainComment, idx) => {
                    const avatarChar = mainComment.cleanName.charAt(0);
                    const currentLiker = String(this.app.weiboData._getCurrentWeiboNickname?.() || '').replace(/^@/, '').trim();
                    const mainLikeUsers = Array.isArray(mainComment.likeUsers)
                        ? mainComment.likeUsers.map(n => String(n || '').replace(/^@/, '').trim()).filter(Boolean)
                        : [];
                    const mainLiked = !!(currentLiker && mainLikeUsers.includes(currentLiker));
                    const rawLoc = String(mainComment.location || '').replace(/[()（）]/g, '').trim();
                    let locCore = rawLoc
                        .replace(/^IP属地\s*[：:·\-\s]*/i, '')
                        .replace(/^属地\s*[：:·\-\s]*/i, '')
                        .replace(/^来自\s*/i, '')
                        .replace(/^ip\s*[：:·\-\s]*/i, '')
                        .trim();
                    // 压缩属地，避免“北京 朝阳区 / 广东 广州”这类超长串挤压换行
                    if (locCore) {
                        locCore = locCore.split(/[，,。·\s]/)[0] || locCore;
                    }
                    const locText = locCore ? `ip · ${locCore}` : '';
                    const mainLikeCount = Number.isFinite(Number.parseInt(mainComment.likeCount, 10))
                        ? Number.parseInt(mainComment.likeCount, 10)
                        : (Math.floor(Math.abs(Math.sin((mainComment.cleanName.charCodeAt(0) || 0) + idx)) * 150) + 2);

                    return `
                    <div class="weibo-new-comment" data-comment-root-index="${mainComment.originalIndex}" data-comment-index="${mainComment.originalIndex}">
                        <div class="wnc-avatar">
                            <div class="wnc-avatar-circle">${avatarChar}</div>
                        </div>
                        <div class="wnc-main">
                            <!-- 🔥 主评论，添加 weibo-replyable 类用于点击回复 -->
                            <div class="wnc-name weibo-replyable" data-author="${this._escapeAttr(mainComment.cleanName)}" data-root-index="${mainComment.originalIndex}" data-comment-index="${mainComment.originalIndex}">${this._escapeHtml(mainComment.cleanName)}</div>
                            <div class="wnc-content weibo-replyable" data-author="${this._escapeAttr(mainComment.cleanName)}" data-root-index="${mainComment.originalIndex}" data-comment-index="${mainComment.originalIndex}">
                                ${mainComment.text}
                            </div>
                            
                            <!-- 🔥 楼中楼渲染区域 -->
                            ${mainComment.subComments.length > 0 ? `
                                <div class="wnc-sub-comments">
                                    ${mainComment.subComments.map(sub => `
                                        <div class="wnc-sub-item weibo-replyable" data-author="${this._escapeAttr(sub.cleanName)}" data-root-index="${mainComment.originalIndex}" data-comment-index="${sub.originalIndex}">
                                            <span class="wnc-sub-content-wrap">
                                                <span class="wnc-sub-name">${sub.cleanName}</span>
                                                ${sub.cleanReplyTo && sub.cleanReplyTo !== mainComment.cleanName ? `
                                                    <span style="color:#333;margin:0 2px;">回复</span>
                                                    <span class="wnc-sub-name">@${sub.cleanReplyTo}</span>
                                                ` : ''}
                                                <span style="color:#333;">: ${sub.text}</span>
                                            </span>
                                            <button class="wnc-sub-like-btn weibo-comment-like-btn ${(() => {
                                                const subUsers = Array.isArray(sub.likeUsers)
                                                    ? sub.likeUsers.map(n => String(n || '').replace(/^@/, '').trim()).filter(Boolean)
                                                    : [];
                                                return (currentLiker && subUsers.includes(currentLiker)) ? 'liked' : '';
                                            })()}" data-post-id="${post.id}" data-comment-index="${sub.originalIndex}" type="button">
                                                <i class="${(() => {
                                                    const subUsers = Array.isArray(sub.likeUsers)
                                                        ? sub.likeUsers.map(n => String(n || '').replace(/^@/, '').trim()).filter(Boolean)
                                                        : [];
                                                    return (currentLiker && subUsers.includes(currentLiker)) ? 'fa-solid' : 'fa-regular';
                                                })()} fa-thumbs-up"></i>
                                                <span>${Number.isFinite(Number.parseInt(sub.likeCount, 10))
                                                    ? Number.parseInt(sub.likeCount, 10)
                                                    : (Math.floor(Math.abs(Math.sin((sub.cleanName.charCodeAt(0) || 0) + sub.originalIndex)) * 90) + 1)
                                                }</span>
                                            </button>
                                        </div>
                                    `).join('')}
                                </div>
                            ` : ''}

                            <div class="wnc-footer">
                                <span class="wnc-time-loc">${locText}</span>
                                <button class="wnc-like-btn weibo-comment-like-btn ${mainLiked ? 'liked' : ''}" data-post-id="${post.id}" data-comment-index="${mainComment.originalIndex}" type="button">
                                    <i class="${mainLiked ? 'fa-solid' : 'fa-regular'} fa-thumbs-up"></i>
                                    <span>${mainLikeCount}</span>
                                </button>
                            </div>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        `;
    }

    // 🔥 AI互动：当用户在微博详情页评论时，触发AI生成回复
    async triggerCommentAIReaction(postId, userText, replyTo, mode, meta = {}) {
        try {
            const reactionMode = mode === 'myPosts' ? 'myPosts' : (mode === 'hotSearch' ? 'hotSearch' : 'recommend');
            const reactionHotSearchTitle = reactionMode === 'hotSearch'
                ? String(meta?.hotSearchTitle || this.currentHotSearchTitle || '').trim()
                : '';
            let post;
            if (reactionMode === 'recommend') {
                post = this.app.weiboData.getRecommendPosts().find(p => p.id === postId);
            } else if (reactionMode === 'myPosts') {
                post = this.app.weiboData.getUserPosts().find(p => p.id === postId);
            } else {
                post = this.app.weiboData.getHotSearchDetail(reactionHotSearchTitle)?.posts?.find(p => p.id === postId);
            }

            if (!post) return;
            
            // 必须开启在线模式才触发
            const storage = window.VirtualPhone?.storage;
            const onlineEnabled = !!storage && (
                storage.get('phone_lobby_wechat_online_mode') === true ||
                storage.get('phone_lobby_wechat_online_mode') === 'true' ||
                storage.get('phone_lobby_wechat_online_mode') === 1 ||
                storage.get('wechat_online_mode') === true ||
                storage.get('wechat_online_mode') === 'true' ||
                storage.get('wechat_online_mode') === 1 ||
                storage.get('phone_lobby_wechat_online_only_mode') === true ||
                storage.get('phone_lobby_wechat_online_only_mode') === 'true' ||
                storage.get('phone_lobby_wechat_online_only_mode') === 1 ||
                storage.get('wechat_online_only_mode') === true ||
                storage.get('wechat_online_only_mode') === 'true' ||
                storage.get('wechat_online_only_mode') === 1
            );
            if (!storage || !onlineEnabled) {
                return; 
            }

            this.app.phoneShell.showNotification('微博', '网友正在围观...', '👀');

            const result = await this.app.weiboData.generateReplyForUserComment(post, userText, replyTo, {
                replyRootIndex: Number.isInteger(meta?.replyRootIndex) ? meta.replyRootIndex : null,
                replyCommentIndex: Number.isInteger(meta?.replyCommentIndex) ? meta.replyCommentIndex : null
            });

            if (result && result.comments && result.comments.length > 0) {
                const userWeiboNick = this.app.weiboData._getCurrentWeiboNickname?.() || '我';
                const replyTarget = userWeiboNick.startsWith('@') ? userWeiboNick : '@' + userWeiboNick;

                for (const c of result.comments) {
                    // 模拟打字延迟，制造真实感
                    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));
                    const finalReplyTo = replyTarget;
                    const replyRootIndex = Number.isInteger(meta?.replyRootIndex) ? meta.replyRootIndex : null;

                    if (reactionMode === 'recommend' || reactionMode === 'myPosts') {
                        this.app.weiboData.addComment(
                            postId,
                            c.text,
                            finalReplyTo,
                            reactionMode === 'myPosts' ? 'user' : 'recommend',
                            c.name || '热心网友',
                            c.location || '',
                            { replyRootIndex }
                        );
                    } else {
                        this.app.weiboData.addCommentHotSearch(postId, c.text, finalReplyTo, reactionHotSearchTitle, c.name || '热心网友', c.location || '', { replyRootIndex });
                    }
                }

                // 取消了“收到新回复”弹窗

                // 只在用户仍停留在同一个详情上下文时刷新，避免异步回复把已切走的评论区顶回来
                const stillSameDetail =
                    this.currentView === 'postDetail' &&
                    String(this.currentPostId || '') === String(postId || '') &&
                    (this.currentPostMode || 'recommend') === reactionMode &&
                    (reactionMode !== 'hotSearch' || String(this.currentHotSearchTitle || '').trim() === reactionHotSearchTitle);

                if (stillSameDetail) {
                    this.renderPostDetail(postId, reactionMode);
                    this._scrollDetailToComment(
                        Number.isInteger(meta?.replyRootIndex) ? meta.replyRootIndex : null,
                        null
                    );
                }
            }
        } catch (e) {
            console.error('AI回复评论失败:', e);
        }
    }

    // ========================================
    // 🎯 事件绑定 - 首页
    // ========================================

    bindHomeEvents() {
        // 返回按钮 (静态元素)
        const homeBackBtn = document.getElementById('weibo-home-back');
        if (homeBackBtn) homeBackBtn.onclick = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }

            if (this.entrySource?.appId === 'wechat' && typeof this.app.returnToWechatFromCard === 'function') {
                this.app.returnToWechatFromCard();
                return;
            }

            // 主动离开微博，避免后台刷新逻辑误触发重渲染
            this.entrySource = null;
            this.currentView = 'home';
            this.currentHotSearchTitle = null;
            this.currentPostId = null;
            this.currentPostMode = null;

            window.dispatchEvent(new CustomEvent('phone:goHome'));

            const phoneScreen = document.querySelector('.phone-screen');
            if (phoneScreen) {
                phoneScreen.style.pointerEvents = 'none';
                setTimeout(() => {
                    phoneScreen.style.pointerEvents = '';
                }, 400);
            }
        };

        // 设置按钮 (静态元素)
        const settingsBtn = document.getElementById('weibo-settings-btn');
        if (settingsBtn) settingsBtn.onclick = () => {
            this.currentView = 'settings';
            this.render();
        };

        // 🔥 核心修改：Tab切换改为“局部平滑刷新”
        document.querySelectorAll('.weibo-tab').forEach(tab => {
            tab.onclick = () => {
                const targetTab = tab.dataset.tab;
                this.switchTab(targetTab, { force: this.currentTab === targetTab });
            };
        });

        // 推荐页：顶部用户信息区长按下拉刷新 (静态绑定)
        this._bindRecommendPullRefresh();
        this._syncRecommendRefreshIndicatorByState();

        // 绑定动态内容区的事件（如帖子点击、删除等）
        this.bindDynamicContentEvents();
    }

    _isManagedBackgroundPath(pathLike = '') {
        const raw = String(pathLike || '').trim();
        if (!raw) return false;
        return /^\/backgrounds\/[^?#]+/i.test(raw) || /^https?:\/\/[^/]+\/backgrounds\/[^?#]+/i.test(raw);
    }

    _probeImageReachable(url = '') {
        const target = String(url || '').trim();
        if (!target) return Promise.resolve(false);
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = target;
        });
    }

    _scheduleProfileMediaHealthCheck() {
        if (this._profileMediaCheckRunning) return;
        this._profileMediaCheckRunning = true;
        Promise.resolve()
            .then(() => this._runProfileMediaHealthCheck())
            .catch(() => { })
            .finally(() => {
                this._profileMediaCheckRunning = false;
            });
    }

    async _runProfileMediaHealthCheck() {
        if (this.currentView !== 'home') return;
        const profile = this.app.weiboData.getProfile();
        if (!profile) return;

        const avatar = String(profile.avatar || '').trim();
        const banner = String(profile.banner || '').trim();

        const checks = [];
        if (this._isManagedBackgroundPath(avatar) && !this._profileBrokenPathSet.has(`avatar:${avatar}`)) {
            checks.push({ key: 'avatar', url: avatar });
        }
        if (this._isManagedBackgroundPath(banner) && !this._profileBrokenPathSet.has(`banner:${banner}`)) {
            checks.push({ key: 'banner', url: banner });
        }
        if (checks.length === 0) return;

        let changed = false;
        for (const item of checks) {
            const ok = await this._probeImageReachable(item.url);
            if (ok) continue;
            this._profileBrokenPathSet.add(`${item.key}:${item.url}`);
            if (item.key === 'avatar' && String(profile.avatar || '').trim() === item.url) {
                profile.avatar = null;
                changed = true;
            }
            if (item.key === 'banner' && String(profile.banner || '').trim() === item.url) {
                profile.banner = null;
                changed = true;
            }
        }

        if (!changed) return;
        this.app.weiboData.saveProfile(profile);
        if (this.currentView === 'home') this.render();
    }

    _setDeleteButtonVisible(btn, visible) {
        if (!btn) return;
        btn.dataset.visible = visible ? '1' : '0';
        btn.style.opacity = visible ? '1' : '0';
        btn.style.pointerEvents = visible ? 'auto' : 'none';
        btn.style.transform = visible ? 'scale(1)' : 'scale(0.92)';
    }

    _hideAllMyPostDeleteButtons(exceptPostId = null) {
        const currentView = document.querySelector('.phone-view-current') || document;
        currentView.querySelectorAll('.weibo-delete-post-btn').forEach((btn) => {
            this._setDeleteButtonVisible(btn, btn.dataset.postId === exceptPostId);
        });
        this._revealedDeletePostId = exceptPostId || null;
    }

    _bindMyPostDeleteReveal() {
        const currentView = document.querySelector('.phone-view-current') || document;
        const myPosts = currentView.querySelectorAll('.weibo-post[data-mode="myPosts"]');
        if (!myPosts.length) return;

        const PRESS_MS = 420;
        const MOVE_TOLERANCE = 12;

        myPosts.forEach((postEl) => {
            if (postEl.dataset.deleteRevealBound === '1') return;
            postEl.dataset.deleteRevealBound = '1';

            let pressTimer = null;
            let startX = 0;
            let startY = 0;
            let isPressing = false;
            let longPressTriggered = false;
            let removeMouseGlobalListeners = null;

            const isIgnoredTarget = (target) => (
                target.closest('.weibo-delete-post-btn') ||
                target.closest('.weibo-stat-item') ||
                target.closest('.weibo-comment') ||
                target.closest('.weibo-inline-comment-box') ||
                target.closest('.weibo-post-images') ||
                target.closest('.weibo-forward-btn') ||
                target.closest('button') ||
                target.closest('input') ||
                target.closest('textarea')
            );

            const resetPress = () => {
                if (pressTimer) {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                }
                isPressing = false;
            };

            const cancelPress = () => {
                resetPress();
                longPressTriggered = false;
            };

            const finishPress = (event = null) => {
                const shouldReveal = longPressTriggered;
                resetPress();
                longPressTriggered = false;
                if (!shouldReveal) return;

                event?.preventDefault?.();
                event?.stopPropagation?.();

                const btn = postEl.querySelector('.weibo-delete-post-btn');
                if (!btn) return;
                this._hideAllMyPostDeleteButtons(btn.dataset.postId);
                postEl.dataset.suppressClickUntil = String(Date.now() + 650);
            };

            const startPress = (clientX, clientY, target) => {
                if (isIgnoredTarget(target)) return false;
                startX = clientX;
                startY = clientY;
                resetPress();
                isPressing = true;
                longPressTriggered = false;
                pressTimer = setTimeout(() => {
                    if (!isPressing) return;
                    longPressTriggered = true;
                }, PRESS_MS);
                return true;
            };

            const handleMove = (clientX, clientY) => {
                if (!isPressing) return;
                if (Math.abs(clientX - startX) > MOVE_TOLERANCE || Math.abs(clientY - startY) > MOVE_TOLERANCE) {
                    cancelPress();
                }
            };

            postEl.addEventListener('touchstart', (e) => {
                const touch = e.touches?.[0];
                if (!touch) return;
                startPress(touch.clientX, touch.clientY, e.target);
            }, { passive: true });

            postEl.addEventListener('touchmove', (e) => {
                const touch = e.touches?.[0];
                if (!touch) return;
                handleMove(touch.clientX, touch.clientY);
            }, { passive: true });

            postEl.addEventListener('touchend', (e) => finishPress(e));
            postEl.addEventListener('touchcancel', cancelPress);

            postEl.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                if (!startPress(e.clientX, e.clientY, e.target)) return;

                const onMouseMove = (moveEvent) => handleMove(moveEvent.clientX, moveEvent.clientY);
                const onMouseUp = (upEvent) => {
                    finishPress(upEvent);
                    removeMouseGlobalListeners?.();
                };
                const onWindowBlur = () => {
                    cancelPress();
                    removeMouseGlobalListeners?.();
                };

                removeMouseGlobalListeners = () => {
                    window.removeEventListener('mousemove', onMouseMove);
                    window.removeEventListener('mouseup', onMouseUp);
                    window.removeEventListener('blur', onWindowBlur);
                    removeMouseGlobalListeners = null;
                };

                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
                window.addEventListener('blur', onWindowBlur);
            });
        });
    }

    // 🔥 新增：单独绑定列表内部的动态事件
    bindDynamicContentEvents() {
        // 我的微博tab里的发微博入口
        const myPostComposeBtn = document.getElementById('weibo-mypost-compose-btn');
        if (myPostComposeBtn) myPostComposeBtn.onclick = () => {
            this.showPostWeiboPage();
        };

        this._bindMyPostDeleteReveal();

        // 热搜项点击
        document.querySelectorAll('.weibo-hot-item').forEach(item => {
            item.onclick = () => {
                const title = item.dataset.title;
                this.currentHotSearchTitle = title;
                this.currentView = 'hotSearchDetail';
                this.render();
            };
        });

        // 我的微博删除
        document.querySelectorAll('.weibo-delete-post-btn').forEach(btn => {
            btn.onclick = async (e) => { // 🔥 改为 async 函数
                e.stopPropagation();
                const postId = btn.dataset.postId;
                if (!postId) return;

                if (btn.dataset.deleting === '1') return;
                btn.dataset.deleting = '1';

                this.app.phoneShell.showNotification('处理中', '正在删除微博...', '⏳');

                // 获取删除结果，包含图片列表
                const result = this.app.weiboData.deleteUserPost(postId);
                
                if (result && result.success) {
                    // 🔥 如果该微博包含图片，静默清理酒馆服务器上的物理文件
                    if (result.images && result.images.length > 0) {
                        await this._deleteServerImages(result.images);
                    }

                    this._revealedDeletePostId = null;
                    this.app.phoneShell.showNotification('微博', '微博已彻底删除', '🗑️');
                    // 删除后局部刷新，防止闪烁
                    this.switchTab('myPosts', { force: true }); 
                } else {
                    btn.dataset.deleting = '0';
                    this.app.phoneShell.showNotification('微博', '删除失败：未找到该微博', '⚠️');
                }
            };
        });

        this._bindWeiboMediaCardEvents();

        // 绑定帖子交互事件 (点赞、评论等)
        this._bindPostEvents(this.currentTab === 'myPosts' ? 'myPosts' : 'recommend');
    }

    _bindWeiboSearchEvents() {
        const toggleBtn = document.getElementById('weibo-search-toggle-btn');
        const searchBar = document.querySelector('.weibo-search-bar');
        const input = document.getElementById('weibo-search-input');
        const submitBtn = document.getElementById('weibo-search-submit');

        toggleBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._isSearchOpen = !this._isSearchOpen;
            searchBar?.classList.toggle('is-open', this._isSearchOpen);
            if (this._isSearchOpen) {
                requestAnimationFrame(() => input?.focus());
            }
        });

        const submitSearch = async () => {
            const query = String(input?.value || '').trim();
            if (!query) {
                input?.focus();
                return;
            }
            this._lastSearchQuery = query;
            this._isSearchOpen = true;
            this.switchTab('recommend', { force: true });
            await this.handleRecommendRefresh({ searchQuery: query });
        };

        submitBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            submitSearch();
        });

        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitSearch();
            }
            if (e.key === 'Escape') {
                this._isSearchOpen = false;
                searchBar?.classList.remove('is-open');
                input.blur();
            }
        });
    }

    _bindWeiboMediaCardEvents() {
        // 🔥 微博卡片翻转事件
        document.querySelectorAll('.weibo-image-prompt-show-back').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                const box = e.currentTarget.closest('.weibo-image-prompt-box');
                if (box) {
                    box.querySelector('.weibo-image-prompt-front-panel').style.display = 'none';
                    box.querySelector('.weibo-image-prompt-back-panel').style.display = 'block';
                }
            };
        });

        document.querySelectorAll('.weibo-image-prompt-restore').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                const box = e.currentTarget.closest('.weibo-image-prompt-box');
                if (box) {
                    box.querySelector('.weibo-image-prompt-back-panel').style.display = 'none';
                    box.querySelector('.weibo-image-prompt-front-panel').style.display = 'block';
                }
            };
        });

        // 🔥 微博生图请求调用 API
        document.querySelectorAll('.weibo-image-prompt-generate').forEach(btn => {
            btn.onclick = async (e) => {
                e.preventDefault(); e.stopPropagation();
                const postId = btn.dataset.postId;
                const index = parseInt(btn.dataset.index, 10);
                const promptText = btn.dataset.prompt;
                const descriptionText = btn.dataset.description;
                const mediaType = btn.dataset.type; // 记录是图片还是视频
                
                await this._generateWeiboPostImage({ postId, index, promptText, descriptionText, mediaType });
            };
        });

        document.querySelectorAll('.weibo-image-prompt-regenerate').forEach(btn => {
            btn.onclick = async (e) => {
                e.preventDefault(); e.stopPropagation();
                const postId = btn.dataset.postId;
                const index = parseInt(btn.dataset.index, 10);
                const promptText = btn.dataset.prompt;
                const descriptionText = btn.dataset.description;
                const mediaType = btn.dataset.type;

                await this._generateWeiboPostImage({ postId, index, promptText, descriptionText, mediaType, clearPreviousImage: true });
            };
        });

        document.querySelectorAll('.weibo-post-img-real').forEach(img => {
            img.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const imageUrl = e.currentTarget?.getAttribute('src') || '';
                if (imageUrl) {
                    this.app?.phoneShell?.showImageViewer?.(imageUrl, {
                        alt: e.currentTarget?.getAttribute('alt') || '微博图片'
                    });
                }
            };
        });
    }

    async _generateWeiboPostImage({ postId, index, promptText, descriptionText = '', mediaType = '图片', clearPreviousImage = false } = {}) {
        if (!postId || !Number.isInteger(index) || index < 0) return;

        const { posts, post, source } = this._getPostMediaTarget(postId);
        if (!post) return;

        const currentState = this._getWeiboPostImageState(post, index);
        if (currentState?.status === 'loading') return;

        const imageManager = window.VirtualPhone?.imageGenerationManager;
        const imageStorage = this.app?.storage || window.VirtualPhone?.storage || null;
        const parsedMedia = this._parseWeiboMediaItem(Array.isArray(post.images) ? post.images[index] : '');
        const effectiveMediaType = String(parsedMedia.mediaType || mediaType || '').trim();
        const safeMediaType = effectiveMediaType === '视频' ? '视频' : (effectiveMediaType === '用户照片' ? '用户照片' : '图片');
        const slotPromptText = String(parsedMedia.promptText || promptText || '').trim();
        if (!slotPromptText) return;
        const displayDescription = String(descriptionText || parsedMedia.descriptionText || slotPromptText || '').trim();
        if (this._hasCjkText(slotPromptText)) {
            this._setWeiboPostImageState(post, index, {
                status: 'failed',
                error: '缺少英文生图Tag：第二个括号必须只写英文逗号分隔 tags',
                prompt: slotPromptText,
                description: displayDescription,
                mediaType: safeMediaType,
                imageModel: '',
                imageProvider: ''
            });
            this._persistPostMediaTarget(posts, source, post);
            this._refreshPostMediaUI(postId);
            this.app.phoneShell.showNotification('生图格式错误', '缺少英文生图Tag，请使用 [图片]（中文描述）（English tags）', '⚠️');
            return;
        }

        if (!imageManager || typeof imageManager.generate !== 'function') {
            this._setWeiboPostImageState(post, index, {
                status: 'failed',
                error: '生图管理器未初始化',
                prompt: slotPromptText,
                description: displayDescription,
                mediaType: safeMediaType,
                imageModel: '',
                imageProvider: ''
            });
            this._persistPostMediaTarget(posts, source, post);
            this._refreshPostMediaUI(postId);
            this.app.phoneShell.showNotification('生图失败', '生图管理器未初始化', '❌');
            return;
        }

        if (imageStorage && imageManager.storage !== imageStorage) {
            imageManager.storage = imageStorage;
        }
        const resolvedImageProvider = String(imageManager.resolveProvider?.({ app: 'weibo' }) || imageStorage?.get?.('phone-image-provider') || '').trim();

        const pendingTag = safeMediaType === '视频' ? '[视频]' : (safeMediaType === '用户照片' ? '[用户照片]' : '[图片]');
        const previousImageUrl = this._getManagedWeiboGeneratedImageUrl(post, index);
        const generationId = `weibo_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        if (clearPreviousImage && Array.isArray(post.images)) {
            post.images[index] = displayDescription && displayDescription !== slotPromptText
                ? `${pendingTag}（${displayDescription}）（${slotPromptText}）`
                : `${pendingTag}（${slotPromptText}）`;
        }

        this._setWeiboPostImageState(post, index, {
            status: 'loading',
            error: '',
            prompt: slotPromptText,
            description: displayDescription,
            generationId,
            mediaType: safeMediaType,
            generatedImageUrl: '',
            imageModel: '',
            imageProvider: resolvedImageProvider,
            imageGenerationWidth: '',
            imageGenerationHeight: ''
        });
        this._persistPostMediaTarget(posts, source, post);
        this._refreshPostMediaUI(postId);

        try {
            const result = await imageManager.generate({
                app: 'weibo',
                prompt: this._buildWeiboImagePromptWithUserTags(parsedMedia, slotPromptText)
            });
            const rawImageUrl = String(result?.imageUrl || result?.imageData || '').trim();
            const imageUrl = await this._persistWeiboGeneratedImage(rawImageUrl, {
                postId,
                index,
                promptText: slotPromptText,
                generationId
            });
            if (!imageUrl) throw new Error('生图成功但未返回图片URL');

            // 替换原有的图片数组中的 prompt 为真实 URL，保留图片/视频前缀。
            const finalTag = safeMediaType === '视频' ? '[视频]' : (safeMediaType === '用户照片' ? '[用户照片]' : '[图片]');
            post.images[index] = `${finalTag}${imageUrl}`;
            this._setWeiboPostImageState(post, index, {
                status: 'done',
                error: '',
                prompt: slotPromptText,
                description: displayDescription,
                mediaType: safeMediaType,
                generatedImageUrl: imageUrl,
                imageModel: String(result?.model || '').trim(),
                imageProvider: String(result?.provider || '').trim(),
                imageGenerationWidth: Number(result?.width || result?.requestedWidth || 0) || '',
                imageGenerationHeight: Number(result?.height || result?.requestedHeight || 0) || ''
            });

            this._persistPostMediaTarget(posts, source, post);
            this._cleanupReplacedWeiboGeneratedImage(previousImageUrl, imageUrl);
            this._refreshPostMediaUI(postId);
            this.app.phoneShell.showNotification('成功', '配图生成完成', '✅');
        } catch (error) {
            const friendlyMessage = this._normalizeSiliconflowErrorMessage(error);
            this._setWeiboPostImageState(post, index, {
                status: 'failed',
                error: friendlyMessage,
                prompt: slotPromptText,
                description: displayDescription,
                mediaType: safeMediaType,
                generatedImageUrl: '',
                imageModel: '',
                imageProvider: resolvedImageProvider
            });
            this._persistPostMediaTarget(posts, source, post);
            this._refreshPostMediaUI(postId);
            this.app.phoneShell.showNotification('生图失败', friendlyMessage, '❌');
        }
    }

    _getManagedWeiboGeneratedImageUrl(post, index) {
        const candidates = [
            Array.isArray(post?.images) ? post.images[index] : '',
            this._getWeiboPostImageState(post, index)?.generatedImageUrl
        ];
        for (const item of candidates) {
            const media = this._parseWeiboMediaItem(item);
            const raw = String(media.realUrl || item || '').trim();
            const match = raw.match(/(?:^\[[^\]]+\]\s*)?(\/backgrounds\/phone_weibo_img_[^?#\s)）]+)/i);
            if (match?.[1]) return match[1];
        }
        return '';
    }

    _cleanupReplacedWeiboGeneratedImage(oldUrl, nextUrl) {
        const oldPath = String(oldUrl || '').trim();
        const nextPath = String(nextUrl || '').trim();
        if (!oldPath || oldPath === nextPath || !/^\/backgrounds\/phone_weibo_img_/i.test(oldPath)) return;
        const cleanupTask = window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(oldPath, { quiet: true });
        cleanupTask?.catch?.(() => { });
    }

    async _persistWeiboGeneratedImage(imageUrl, { postId = '', index = 0, promptText = '', generationId = '' } = {}) {
        const safeUrl = String(imageUrl || '').trim();
        if (!safeUrl) return '';
        if (/^\/backgrounds\/phone_[^?#]+/i.test(safeUrl)) return safeUrl;

        const imageUploader = window.VirtualPhone?.imageManager;
        if (!imageUploader?.uploadBlob) {
            throw new Error('图片上传管理器未初始化，无法保存微博生图');
        }

        const blob = await this._loadGeneratedImageBlob(safeUrl);
        const uniquePart = String(generationId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_');
        const seed = `${postId || 'post'}_${index}_${this._simpleHash(promptText || safeUrl).toString(36)}_${uniquePart}`;
        const uploadedUrl = await imageUploader.uploadBlob(blob, `weibo_img_${seed}`);
        const normalized = String(uploadedUrl || '').trim();
        if (!/^\/backgrounds\/phone_[^?#]+/i.test(normalized)) {
            throw new Error('微博生图保存失败：未得到有效本地图片路径');
        }
        return normalized;
    }

    async _loadGeneratedImageBlob(imageUrl) {
        const safeUrl = String(imageUrl || '').trim();
        if (!safeUrl) throw new Error('生图结果为空');
        const response = await fetch(safeUrl, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`读取微博生图失败（HTTP ${response.status}）`);
        }
        const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const arrayBuffer = await response.arrayBuffer();
        if (!arrayBuffer || arrayBuffer.byteLength <= 0) {
            throw new Error('微博生图结果不是有效图片');
        }
        const bytes = new Uint8Array(arrayBuffer);
        const mime = /^image\//i.test(contentType)
            ? contentType
            : this._detectGeneratedWeiboImageMime(bytes);
        if (!mime) throw new Error('微博生图结果不是有效图片');
        const blob = new Blob([arrayBuffer], { type: mime });
        return blob;
    }

    _detectGeneratedWeiboImageMime(bytes) {
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

    _simpleHash(text) {
        const str = String(text || '');
        let hash = 2166136261;
        for (let i = 0; i < str.length; i += 1) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    refreshCurrentTabContent() {
        if (!(this.currentView === 'home')) return;

        const contentArea = document.querySelector('.weibo-tab-content');
        if (!contentArea) return;

        const previousScrollTop = contentArea.scrollTop;

        let newHtml = '';
        if (this.currentTab === 'hotSearch') {
            newHtml = this.renderHotSearchList();
        } else if (this.currentTab === 'recommend') {
            newHtml = this.renderRecommendList();
        } else if (this.currentTab === 'myPosts') {
            newHtml = this.renderMyPostsList();
        }

        contentArea.innerHTML = newHtml;
        contentArea.scrollTop = previousScrollTop;
        this.bindDynamicContentEvents();

        if (this.currentTab === 'recommend') {
            this._bindRecommendPullRefresh();
            this._syncRecommendRefreshIndicatorByState();
        }
    }

    // ========================================
    // 🔄 局部平滑切换 Tab 核心逻辑
    // ========================================
    switchTab(targetTab, options = {}) {
        const forceRefresh = options.force === true;
        if (this.currentTab === targetTab && !forceRefresh) return;

        this.currentTab = targetTab;

        // 1. 切换 Tab 按钮的高亮颜色
        document.querySelectorAll('.weibo-tab').forEach(tab => {
            if (tab.dataset.tab === targetTab) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        // 2. 移动下方指示器（小横线）平滑滑动
        const indicator = document.querySelector('.weibo-tab-indicator');
        if (indicator) {
            const tabIdx = targetTab === 'hotSearch' ? 0 : targetTab === 'recommend' ? 1 : 2;
            indicator.style.transform = `translateX(${tabIdx * 100}%)`;
        }

        // 3. 仅替换下方列表的 HTML（核心！不重绘整个页面）
        this.refreshCurrentTabContent();
    }

    // ========================================
    // 🎯 事件绑定 - 详情页
    // ========================================

    bindDetailEvents(title) {
        // 返回按钮
        document.getElementById('weibo-detail-back')?.addEventListener('click', () => {
            this.currentView = 'home';
            this.currentHotSearchTitle = null;
            this.render();
        });

        // 设置按钮
        document.getElementById('weibo-hot-settings-btn')?.addEventListener('click', () => {
            this.currentView = 'hotSearchSettings';
            this.render();
        });

        // 绑定帖子交互事件
        this._bindPostEvents('hotSearch');
        this._bindWeiboMediaCardEvents();
    }

    async handleHotSearchPullAppend(title) {
        if (!title) return;

        if (!this._generatingHotSearches) this._generatingHotSearches = new Set();
        if (this._generatingHotSearches.has(title)) {
            this.app.phoneShell.showNotification('提示', '该热搜正在生成中，请稍候...', '⏳');
            return;
        }

        this._generatingHotSearches.add(title);
        this._hotDetailRefreshStatus = 'loading';
        this._syncHotDetailRefreshIndicatorByState();

        try {
            const existingCount = this.app.weiboData.getHotSearchDetail(title)?.posts?.length || 0;
            this.app.phoneShell.showNotification('微博', '正在加载更新...', '⏳');
            const updatedDetail = await this.app.weiboData.appendHotSearchContent(title);
            this._hotDetailRefreshStatus = 'success';

            const isWeiboActive = document.querySelector('.phone-view-current .weibo-app');
            if (isWeiboActive && this.currentView === 'hotSearchDetail' && this.currentHotSearchTitle === title) {
                this._appendHotSearchPostsToCurrentView(title, existingCount, updatedDetail);
            } else {
                this._syncHotDetailRefreshIndicatorByState();
            }
            this.app.phoneShell.showNotification('微博', '更新已加载', '✅');
        } catch (error) {
            this._hotDetailRefreshStatus = 'error';
            this._syncHotDetailRefreshIndicatorByState();
            this.app.phoneShell.showNotification('微博', error.message || '加载更新失败', '❌');
        } finally {
            this._generatingHotSearches.delete(title);
            if (this._hotDetailRefreshTimer) {
                clearTimeout(this._hotDetailRefreshTimer);
                this._hotDetailRefreshTimer = null;
            }
            const finalStatus = this._hotDetailRefreshStatus;
            this._hotDetailRefreshTimer = setTimeout(() => {
                if (this._hotDetailRefreshStatus === finalStatus && finalStatus !== 'loading') {
                    this._hotDetailRefreshStatus = 'idle';
                    this._syncHotDetailRefreshIndicatorByState();
                }
            }, 1300);
        }
    }

    _appendHotSearchPostsToCurrentView(title, previousCount = 0, detail = null) {
        if (!(this.currentView === 'hotSearchDetail' && this.currentHotSearchTitle === title)) {
            this._syncHotDetailRefreshIndicatorByState();
            return;
        }

        const listEl = document.getElementById('weibo-detail-posts');
        if (!listEl) {
            this._syncHotDetailRefreshIndicatorByState();
            return;
        }

        const latestDetail = detail || this.app.weiboData.getHotSearchDetail(title);
        const posts = Array.isArray(latestDetail?.posts) ? latestDetail.posts : [];
        const newPosts = posts.slice(Math.max(0, previousCount));

        if (newPosts.length > 0) {
            listEl.insertAdjacentHTML('beforeend', newPosts.map(post => this.renderWeiboPost(post, 'hotSearch')).join(''));
            this._bindPostEvents('hotSearch');
            this._bindWeiboMediaCardEvents();
        }

        const floorEl = document.getElementById('weibo-hot-floor-count');
        const floorData = this.app.weiboData.getHotFloorData(title);
        if (floorEl) {
            floorEl.textContent = `楼层 ${floorData.currentFloor}`;
        }

        this._syncHotDetailRefreshIndicatorByState();
    }

    _bindHotDetailPullRefresh(title) {
        if (!(this.currentView === 'hotSearchDetail' && this.currentHotSearchTitle === title)) return;

        const triggerArea = document.querySelector('.weibo-topic-header');
        const detailScrollEl = document.getElementById('weibo-detail-posts');
        if (!triggerArea || !detailScrollEl) return;
        if (triggerArea.dataset.pullRefreshBound === '1') return;
        triggerArea.dataset.pullRefreshBound = '1';

        let startY = 0;
        let startX = 0;
        let pullDistance = 0;
        let pressing = false;
        let pressType = '';
        let previousUserSelect = '';
        const maxPull = 92;
        const triggerThreshold = 62;

        const canPull = () =>
            this.currentView === 'hotSearchDetail' &&
            this.currentHotSearchTitle === title &&
            detailScrollEl.scrollTop <= 2 &&
            !this._generatingHotSearches?.has(title);

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

            // 横向手势（如右滑返回）优先交给 phone-shell
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 8) {
                pressing = false;
                pullDistance = 0;
                pressType = '';
                this._syncHotDetailRefreshIndicatorByState();
                return;
            }

            if (deltaY <= 0) return;
            if (deltaY < 6) return;

            pullDistance = Math.min(maxPull, Math.round(deltaY * 0.55));
            const ready = pullDistance >= triggerThreshold;
            this._setHotDetailPullHint(
                pullDistance,
                ready ? '松手加载更新' : '下拉加载更新',
                ready
            );

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
                this.handleHotSearchPullAppend(title);
            } else {
                this._syncHotDetailRefreshIndicatorByState();
            }
        };

        const onTouchStart = (e) => {
            if (!e.touches || e.touches.length === 0) return;
            startPress(e.touches[0].clientX, e.touches[0].clientY, 'touch');
        };

        const onTouchMove = (e) => {
            if (!e.touches || e.touches.length === 0) return;
            movePress(e.touches[0].clientX, e.touches[0].clientY, e);
        };

        const onTouchEnd = () => {
            if (pressType !== 'touch') return;
            endPress();
        };

        let removeMouseGlobalListeners = null;
        const addMouseGlobalListeners = () => {
            const onMouseMove = (e) => {
                if (pressType !== 'mouse') return;
                movePress(e.clientX, e.clientY, e);
            };
            const onMouseUp = () => {
                if (pressType !== 'mouse') return;
                if (removeMouseGlobalListeners) removeMouseGlobalListeners();
                endPress();
            };
            const onWindowBlur = () => {
                if (pressType !== 'mouse') return;
                if (removeMouseGlobalListeners) removeMouseGlobalListeners();
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

        const onMouseDown = (e) => {
            if (e.button !== 0) return;
            if (!startPress(e.clientX, e.clientY, 'mouse')) return;
            e.preventDefault();
            addMouseGlobalListeners();
        };

        triggerArea.addEventListener('touchstart', onTouchStart, { passive: true });
        triggerArea.addEventListener('touchmove', onTouchMove, { passive: false });
        triggerArea.addEventListener('touchend', onTouchEnd);
        triggerArea.addEventListener('touchcancel', onTouchEnd);
        triggerArea.addEventListener('mousedown', onMouseDown);
    }

    _setHotDetailPullHint(height, text, ready = false) {
        const wrap = document.getElementById('weibo-hot-pull-refresh-indicator');
        const inner = document.getElementById('weibo-hot-pull-refresh-inner');
        if (!wrap || !inner) return;

        wrap.classList.remove('loading', 'success', 'error');
        wrap.classList.toggle('ready', !!ready);
        wrap.style.height = `${Math.max(0, height)}px`;
        inner.innerHTML = `<i class="fa-solid fa-arrow-down"></i> ${text}`;
    }

    _syncHotDetailRefreshIndicatorByState() {
        const wrap = document.getElementById('weibo-hot-pull-refresh-indicator');
        const inner = document.getElementById('weibo-hot-pull-refresh-inner');
        if (!wrap || !inner) return;

        wrap.classList.remove('ready', 'loading', 'success', 'error');

        if (this._hotDetailRefreshStatus === 'loading') {
            wrap.classList.add('loading');
            wrap.style.height = '40px';
            inner.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在加载更新...';
            return;
        }

        if (this._hotDetailRefreshStatus === 'success') {
            wrap.classList.add('success');
            wrap.style.height = '40px';
            inner.innerHTML = '<i class="fa-solid fa-circle-check"></i> 更新已加载';
            return;
        }

        if (this._hotDetailRefreshStatus === 'error') {
            wrap.classList.add('error');
            wrap.style.height = '40px';
            inner.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> 生成失败';
            return;
        }

        wrap.style.height = '0px';
        inner.innerHTML = '';
    }

    // ========================================
    // 🎯 事件绑定 - 设置页
    // ========================================

    _bindPromptFoldToggles(root = document) {
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

    bindSettingsEvents() {
        this._bindPromptFoldToggles(document.querySelector('.phone-view-current .weibo-app') || document);
        const promptManagerForPresets = window.VirtualPhone?.promptManager;
        promptManagerForPresets?.bindPromptPresetControls?.(document.querySelector('.phone-view-current .weibo-app') || document, 'weibo', 'recommend', '#weibo-recommend-prompt', {
            notify: (title, message, icon) => this.app.phoneShell.showNotification(title, message, icon)
        });
        promptManagerForPresets?.bindPromptPresetControls?.(document.querySelector('.phone-view-current .weibo-app') || document, 'weibo', 'hotSearch', '#weibo-hotsearch-prompt', {
            notify: (title, message, icon) => this.app.phoneShell.showNotification(title, message, icon)
        });
        document.getElementById('weibo-settings-back')?.addEventListener('click', () => {
            this.currentView = 'home';
            this.render();
        });

        this.renderWeiboWorldbookList();
        document.getElementById('weibo-use-worldbook')?.addEventListener('change', async (e) => {
            const enabled = !!e.target.checked;
            await window.VirtualPhone?.worldbookManager?.setEnabled?.('weibo', enabled);
            if (enabled) this.renderWeiboWorldbookList();
        });

        // 保存个人资料
        document.getElementById('weibo-save-profile')?.addEventListener('click', () => {
            const profile = this.app.weiboData.getProfile();
            profile.nickname = document.getElementById('weibo-set-nickname')?.value?.trim() || '';
            profile.ipLocation = document.getElementById('weibo-set-ip')?.value?.trim() || '';
            profile.following = Math.max(0, parseInt(document.getElementById('weibo-set-following')?.value) || 0);
            profile.followers = Math.max(0, parseInt(document.getElementById('weibo-set-followers')?.value) || 0);
            this.app.weiboData.saveProfile(profile);
            this.app.phoneShell.showNotification('保存成功', '个人资料已更新', '✅');
        });

        // 自动生成开关
        document.getElementById('weibo-auto-gen-switch')?.addEventListener('change', (e) => {
            const settings = this.app.weiboData.getFloorSettings();
            settings.autoEnabled = e.target.checked;
            this.app.weiboData.saveFloorSettings(settings);
            window.VirtualPhone?._scheduleAutoWeiboIfDue?.({ reason: 'weibo_auto_switch_changed', delay: 600 });
        });

        // 自动生成楼层间隔
        document.getElementById('weibo-auto-floor-interval')?.addEventListener('change', (e) => {
            const settings = this.app.weiboData.getFloorSettings();
            settings.autoInterval = Math.max(1, parseInt(e.target.value) || 50);
            e.target.value = settings.autoInterval;
            this.app.weiboData.saveFloorSettings(settings);
            window.VirtualPhone?._scheduleAutoWeiboIfDue?.({ reason: 'weibo_auto_interval_changed', delay: 600 });
        });

        // 修正记录楼层 (修复弹窗重复bug)
        const correctAutoFloorBtn = document.getElementById('weibo-correct-auto-floor');
        if (correctAutoFloorBtn) {
            correctAutoFloorBtn.onclick = () => {
                const current = this.app.weiboData.getAutoLastFloor();
                const newFloor = prompt(`上次记录到: ${current} 层\n请输入修正后的楼层数:`, current);
                if (newFloor !== null) {
                    const val = Math.max(0, parseInt(newFloor) || 0);
                    // 手动修正后，短时间抑制自动微博触发并清空已排队任务
                    window.VirtualPhone?._suppressAutoWeiboTrigger?.(15000, 'manual_correct_auto_floor');
                    this.app.weiboData.setAutoLastFloor(val);
                    this.app.phoneShell.showNotification('已修正', `记录楼层已修正为 ${val}`, '✅');
                    this.render();
                }
            };
        }

        document.getElementById('weibo-settings-avatar-upload')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            e.target.value = '';
            try {
                const cropper = new ImageCropper({
                    title: '裁剪头像',
                    aspectRatio: 1,
                    outputWidth: 200,
                    outputHeight: 200,
                    quality: 0.9,
                    maxFileSize: 5 * 1024 * 1024
                });
                const croppedImage = await cropper.open(file);
                const avatarUrl = await window.VirtualPhone?.imageManager?.uploadDataUrl?.(croppedImage, 'weibo_avatar');
                if (!avatarUrl) throw new Error('图片上传管理器未初始化');
                const profile = this.app.weiboData.getProfile();
                const oldAvatar = String(profile.avatar || '').trim();
                profile.avatar = avatarUrl;
                this.app.weiboData.saveProfile(profile);
                if (oldAvatar && oldAvatar !== avatarUrl) {
                    const cleanupTask = window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(oldAvatar, { quiet: true, skipIfReferenced: true });
                    cleanupTask?.catch?.(() => { });
                }
                this.app.phoneShell.showNotification('成功', '头像已更新', '✅');
            } catch (error) {
                if (error.message !== '用户取消') {
                    this.app.phoneShell.showNotification('上传失败', error.message, '❌');
                }
            }
        });

        document.getElementById('weibo-settings-banner-upload')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            e.target.value = '';
            try {
                const cropper = new ImageCropper({
                    title: '裁剪背景图',
                    aspectRatio: 1,
                    outputWidth: 1080,
                    outputHeight: 1080,
                    quality: 0.9,
                    maxFileSize: 5 * 1024 * 1024
                });
                const croppedImage = await cropper.open(file);
                const bannerUrl = await window.VirtualPhone?.imageManager?.uploadDataUrl?.(croppedImage, 'weibo_banner');
                if (!bannerUrl) throw new Error('图片上传管理器未初始化');
                const profile = this.app.weiboData.getProfile();
                const oldBanner = String(profile.banner || '').trim();
                profile.banner = bannerUrl;
                this.app.weiboData.saveProfile(profile);
                if (oldBanner && oldBanner !== bannerUrl) {
                    const cleanupTask = window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(oldBanner, { quiet: true, skipIfReferenced: true });
                    cleanupTask?.catch?.(() => { });
                }
                this.app.phoneShell.showNotification('成功', '背景图已更新', '✅');
            } catch (error) {
                if (error.message !== '用户取消') {
                    this.app.phoneShell.showNotification('上传失败', error.message, '❌');
                }
            }
        });

        // 🔥 自定义界面 CSS 逻辑 (复用头像框的数据字段，保证老存档兼容)
        document.getElementById('weibo-save-frame-css')?.addEventListener('click', () => {
            const cssText = document.getElementById('weibo-avatar-frame-css').value;
            const profile = this.app.weiboData.getProfile();
            profile.avatarFrameCss = cssText; // 依然存在这个键里，不破坏旧存档
            this.app.weiboData.saveProfile(profile);
            
            // 立即生效 CSS
            this._applyCustomAvatarFrame(cssText);
            
            this.app.phoneShell.showNotification('保存成功', '界面CSS已更新', '✅');
        });

        document.getElementById('weibo-save-recommend-prompt')?.addEventListener('click', () => {
            const text = document.getElementById('weibo-recommend-prompt')?.value;
            if (text !== undefined) {
                const promptManager = window.VirtualPhone?.promptManager;
                promptManager?.updateActivePromptUserPreset?.('weibo', 'recommend', text) ?? promptManager?.updatePrompt('weibo', 'recommend', text);
                this.app.phoneShell.showNotification('保存成功', '推荐提示词已更新', '✅');
            }
        });

        document.getElementById('weibo-reset-recommend-prompt')?.addEventListener('click', () => {
            const promptManager = window.VirtualPhone?.promptManager;
            if (promptManager) {
                const defaultText = promptManager.resetPromptToDefault?.('weibo', 'recommend')
                    ?? promptManager.getDefaultPrompts().weibo?.recommend?.content
                    ?? '';
                const textarea = document.getElementById('weibo-recommend-prompt');
                if (textarea) textarea.value = defaultText;
                this.app.phoneShell.showNotification('已恢复', '推荐提示词已恢复默认', '✅');
            }
        });

        document.getElementById('weibo-save-hotsearch-prompt')?.addEventListener('click', () => {
            const text = document.getElementById('weibo-hotsearch-prompt')?.value;
            if (text !== undefined) {
                const promptManager = window.VirtualPhone?.promptManager;
                promptManager?.updateActivePromptUserPreset?.('weibo', 'hotSearch', text) ?? promptManager?.updatePrompt('weibo', 'hotSearch', text);
                this.app.phoneShell.showNotification('保存成功', '热搜提示词已更新', '✅');
            }
        });

        document.getElementById('weibo-reset-hotsearch-prompt')?.addEventListener('click', () => {
            const promptManager = window.VirtualPhone?.promptManager;
            if (promptManager) {
                const defaultText = promptManager.resetPromptToDefault?.('weibo', 'hotSearch')
                    ?? promptManager.getDefaultPrompts().weibo?.hotSearch?.content
                    ?? '';
                const textarea = document.getElementById('weibo-hotsearch-prompt');
                if (textarea) textarea.value = defaultText;
                this.app.phoneShell.showNotification('已恢复', '热搜提示词已恢复默认', '✅');
            }
        });

        // 🔥 清空所有微博数据 (修复弹窗重复bug)
        const clearAllDataBtn = document.getElementById('weibo-clear-all-data-btn');
        if (clearAllDataBtn) {
            clearAllDataBtn.onclick = async () => {
                if (confirm('⚠️ 警告：此操作将清空当前所有微博数据，并从酒馆聊天记录中永久擦除所有 <Weibo> 标签！\\n\\n此操作不可逆，是否继续？')) {
                    this.app.phoneShell.showNotification('清理中', '正在擦除数据...', '⏳');
                    const imagesToDelete = [
                        ...this._collectManagedWeiboImages(this.app.weiboData.getRecommendPosts()),
                        ...this._collectManagedWeiboImages(this.app.weiboData.getUserPosts())
                    ];
                    
                    // 1. 清空插件数据库、动态缓存与全局微博美化 CSS
                    this.app.weiboData.clearAllData();
                    this._applyCustomAvatarFrame('');

                    const cssTextarea = document.getElementById('weibo-avatar-frame-css');
                    if (cssTextarea) {
                        cssTextarea.value = '';
                    }
                     
                    // 2. 深入酒馆源文件擦除遗留标签
                    await this.app.weiboData.clearWeiboChatHistory();
                    await this._deleteServerImages(imagesToDelete);
                     
                    this.app.phoneShell.showNotification('清理完成', '微博数据、自定义 CSS 与历史标签已彻底清空', '✅');
                    
                    // 刷新回首页
                    this.currentView = 'home';
                    this.render();
                }
            };
        }
    }

    // ========================================
    // 🎯 事件绑定 - 热搜设置页
    // ========================================

    bindHotSearchSettingsEvents() {
        this._bindPromptFoldToggles(document.querySelector('.phone-view-current .weibo-app') || document);
        window.VirtualPhone?.promptManager?.bindPromptPresetControls?.(document.querySelector('.phone-view-current .weibo-app') || document, 'weibo', 'hotSearch', '#weibo-hot-prompt', {
            notify: (title, message, icon) => this.app.phoneShell.showNotification(title, message, icon)
        });
        document.getElementById('weibo-hot-settings-back')?.addEventListener('click', () => {
            if (this.currentHotSearchTitle) {
                this.currentView = 'hotSearchDetail';
            } else {
                this.currentView = 'home';
            }
            this.render();
        });

        // 自动生成间隔
        document.getElementById('weibo-auto-interval')?.addEventListener('change', (e) => {
            const settings = this.app.weiboData.getFloorSettings();
            settings.autoInterval = Math.max(1, parseInt(e.target.value) || 5);
            this.app.weiboData.saveFloorSettings(settings);
            window.VirtualPhone?._scheduleAutoWeiboIfDue?.({ reason: 'weibo_hot_interval_changed', delay: 600 });
        });

        // 自动生成开关
        document.getElementById('weibo-auto-enabled')?.addEventListener('change', (e) => {
            const settings = this.app.weiboData.getFloorSettings();
            settings.autoEnabled = e.target.checked;
            this.app.weiboData.saveFloorSettings(settings);
            window.VirtualPhone?._scheduleAutoWeiboIfDue?.({ reason: 'weibo_hot_switch_changed', delay: 600 });
        });

        // 修正楼层 (修复弹窗重复bug)
        const correctFloorBtn = document.getElementById('weibo-correct-floor');
        if (correctFloorBtn) {
            correctFloorBtn.onclick = () => {
                const settings = this.app.weiboData.getFloorSettings();
                const newFloor = prompt(`当前楼层: ${settings.currentFloor}\n请输入修正后的楼层数:`, settings.currentFloor);
                if (newFloor !== null) {
                    settings.currentFloor = Math.max(0, parseInt(newFloor) || 0);
                    this.app.weiboData.saveFloorSettings(settings);
                    this.render();
                }
            };
        }

        // 保存热搜提示词
        document.getElementById('weibo-save-hot-prompt')?.addEventListener('click', () => {
            const text = document.getElementById('weibo-hot-prompt')?.value;
            if (text !== undefined) {
                const promptManager = window.VirtualPhone?.promptManager;
                promptManager?.updateActivePromptUserPreset?.('weibo', 'hotSearch', text) ?? promptManager?.updatePrompt('weibo', 'hotSearch', text);
                this.app.phoneShell.showNotification('保存成功', '热搜提示词已更新', '✅');
            }
        });
    }

    // ========================================
    // 🎯 帖子交互事件（点赞/评论/转发）
    // ========================================

    // ========================================
    // 🎯 帖子交互事件（点赞/评论/转发）
    // ========================================

    _bindPostEvents(mode) {
        // 点击帖子进入详情页（排除按钮区域的点击）
        document.querySelectorAll('.weibo-post').forEach(postEl => {
            postEl.onclick = (e) => {
                const suppressUntil = parseInt(postEl.dataset.suppressClickUntil || '0', 10) || 0;
                if (Date.now() < suppressUntil) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }

                if (this._revealedDeletePostId && !e.target.closest('.weibo-delete-post-btn')) {
                    this._hideAllMyPostDeleteButtons();
                    return;
                }

                if (e.target.closest('.weibo-stat-item') ||
                    e.target.closest('.weibo-comment') ||
                    e.target.closest('.weibo-inline-comment-box') ||
                    e.target.closest('.weibo-post-images') ||
                    e.target.closest('.weibo-forward-btn') ||
                    e.target.closest('button') ||
                    e.target.closest('input')) {
                    return;
                }
                if (postEl.dataset.mode === 'detail') return;

                const postId = postEl.dataset.postId;
                // 普通微博入口清理跨App来源；从微信跳入时保留来源，保证可返回原聊天
                if (this.entrySource?.appId !== 'wechat') {
                    this.entrySource = null;
                }
                this.currentPostId = postId;
                this.currentPostMode = mode === 'hotSearch' ? 'hotSearch' : (mode === 'myPosts' ? 'myPosts' : 'recommend');
                this.currentView = 'postDetail';
                this.render();
            };
        });

        // 点赞
        document.querySelectorAll('.weibo-like-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const postId = btn.dataset.postId;

                let updatedPost;
                if (mode === 'recommend' || mode === 'myPosts') {
                    updatedPost = this.app.weiboData.toggleLike(postId, mode === 'myPosts' ? 'user' : 'recommend');
                } else {
                    updatedPost = this.app.weiboData.toggleLikeHotSearch(postId, this.currentHotSearchTitle);
                }

                if (updatedPost) {
                    const userName = this.app.weiboData._getCurrentWeiboNickname?.() || '我';
                    const isLiked = updatedPost.likeList?.includes(userName);

                    const count = btn.querySelector('span');
                    if (count) count.textContent = this._formatNum(updatedPost.likes || 0);
                    btn.classList.toggle('liked', isLiked);
                }
            };
        });

        // 评论按钮（列表页点击进入详情，详情页点击则聚焦底栏）
        document.querySelectorAll('.weibo-comment-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const postEl = btn.closest('.weibo-post');
                const postId = btn.dataset.postId;
                
                // 如果在列表页（非详情模式），点击评论按钮直接进入正文详情
                if (postEl.dataset.mode !== 'detail') {
                    // 普通微博入口清理跨App来源；从微信跳入时保留来源，保证可返回原聊天
                    if (this.entrySource?.appId !== 'wechat') {
                        this.entrySource = null;
                    }
                    this.currentPostId = postId;
                    this.currentPostMode = mode === 'hotSearch' ? 'hotSearch' : (mode === 'myPosts' ? 'myPosts' : 'recommend');
                    this.currentView = 'postDetail';
                    this.render();
                    return;
                }
                
                // 已经在详情页，聚焦到底部固定输入框
                const fixedInput = document.getElementById('fixed-comment-input');
                if (fixedInput) {
                    this.currentReplyTo = null;
                    this.currentReplyRootIndex = null;
                    this.currentReplyCommentIndex = null;
                    fixedInput.placeholder = "写评论...";
                    fixedInput.focus();
                }
            };
        });

        // 评论点赞（主评论 + 楼中楼）
        document.querySelectorAll('.weibo-comment-like-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const postId = btn.dataset.postId || this.currentPostId;
                const commentIndex = btn.dataset.commentIndex;
                if (!postId || commentIndex === undefined) return;

                const source = mode === 'hotSearch' ? 'hotSearch' : (mode === 'myPosts' ? 'user' : 'recommend');
                const result = this.app.weiboData.toggleCommentLike(
                    postId,
                    commentIndex,
                    source,
                    this.currentHotSearchTitle
                );
                if (!result) return;

                const icon = btn.querySelector('i');
                const countEl = btn.querySelector('span');
                btn.classList.toggle('liked', !!result.liked);
                if (icon) {
                    icon.classList.remove('fa-regular', 'fa-solid');
                    icon.classList.add(result.liked ? 'fa-solid' : 'fa-regular', 'fa-thumbs-up');
                }
                if (countEl) {
                    countEl.textContent = this._formatNum(result.likeCount || 0);
                }
            };
        });

        // 评论回复（点击某人的评论或楼中楼回复）
        document.querySelectorAll('.weibo-replyable').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                
                // 直接从我们在 HTML 里埋好的 data-author 中取被回复人的名字
                const replyTo = el.dataset.author || null;
                const rootIndex = Number.parseInt(el.dataset.rootIndex, 10);
                const commentIndex = Number.parseInt(el.dataset.commentIndex, 10);
                
                // 聚焦到底部固定输入框，并改变提示词和内部状态
                const fixedInput = document.getElementById('fixed-comment-input');
                if (fixedInput && replyTo) {
                    this.currentReplyTo = replyTo;
                    this.currentReplyRootIndex = Number.isInteger(rootIndex) ? rootIndex : null;
                    this.currentReplyCommentIndex = Number.isInteger(commentIndex) ? commentIndex : null;
                    fixedInput.placeholder = `回复 ${replyTo}:`;
                    fixedInput.focus();
                }
            };
        });

        // 转发按钮
        document.querySelectorAll('.weibo-forward-btn').forEach(btn => {
            btn.onclick = async (e) => { // 🔥 加上 async
                e.stopPropagation();
                const postId = btn.dataset.postId;

                const posts = mode === 'recommend'
                    ? this.app.weiboData.getRecommendPosts()
                    : mode === 'myPosts'
                        ? this.app.weiboData.getUserPosts()
                        : this.app.weiboData.getHotSearchDetail(this.currentHotSearchTitle)?.posts;

                const post = posts?.find(p => p.id === postId);
                if (post) {
                    await this.showForwardDialog(post); // 🔥 加上 await
                }
            };
        });
    }

    async renderWeiboWorldbookList() {
        const container = document.getElementById('weibo-worldbook-list');
        const manager = window.VirtualPhone?.worldbookManager;
        if (!container || !manager) return;

        try {
            const sources = await manager.listAvailableWorldbooks({ includeEntries: true, force: true });
            const selection = manager.getSelectionState('weibo');
            if (sources.length === 0) {
                container.innerHTML = '<div class="weibo-settings-desc" style="padding: 8px 0;">未读取到酒馆世界书列表。</div>';
                return;
            }

            const isSelectedSource = (source) => selection.initialized && manager.matchesSelection?.(source, selection.ids);
            const displaySources = [...sources].sort((a, b) => {
                const aSelected = isSelectedSource(a) ? 1 : 0;
                const bSelected = isSelectedSource(b) ? 1 : 0;
                return bSelected - aSelected;
            });

            container.innerHTML = displaySources.map(source => {
                const checked = (selection.initialized && manager.matchesSelection?.(source, selection.ids)) ? 'checked' : '';
                const activeCount = Number(source.entries?.length || 0);
                const totalCount = Number(source.totalEntries ?? activeCount);
                const disabledText = activeCount ? '' : (totalCount > 0 ? '（无开启条目）' : '（读取失败或为空）');
                const countText = totalCount > activeCount ? `${activeCount}/${totalCount} 条可注入` : `${activeCount} 条`;
                return `
                    <label style="display: flex; align-items: flex-start; gap: 8px; padding: 8px 0; border-top: 1px solid #f2f2f2;">
                        <input type="checkbox" class="weibo-worldbook-choice" value="${this._escapeAttr(source.id)}" ${checked} style="-webkit-appearance: checkbox !important; appearance: auto !important; opacity: 1 !important; width: 16px; height: 16px; min-width: 16px; min-height: 16px; margin-top: 2px; accent-color: #30c46b;">
                        <span style="min-width: 0;">
                            <span style="display: block; font-size: 13px; color: var(--phone-global-text, #333);">${this._escapeHtml(source.name)}${this._escapeHtml(disabledText)}</span>
                            <span style="display: block; font-size: 11px; color: #999; margin-top: 2px;">${this._escapeHtml(source.sourceLabel || '世界书')} · ${this._escapeHtml(countText)}</span>
                        </span>
                    </label>
                `;
            }).join('');

            container.querySelectorAll('.weibo-worldbook-choice').forEach(input => {
                input.addEventListener('change', async () => {
                    const ids = Array.from(container.querySelectorAll('.weibo-worldbook-choice:checked')).map(item => item.value);
                    await manager.setSelection('weibo', ids);
                    this.renderWeiboWorldbookList();
                });
            });
        } catch (error) {
            console.warn('[Weibo] 世界书列表渲染失败:', error);
            container.innerHTML = '<div class="weibo-settings-desc" style="color:#d93025; padding: 8px 0;">世界书读取失败，请稍后重试。</div>';
        }
    }

   // ========================================
    // 🔄 推荐刷新
    // ========================================

    async handleRecommendRefresh(options = {}) {
        if (this.isLoading) return;
        this.isLoading = true;
        this._recommendRefreshStatus = 'loading';
        this._syncRecommendRefreshIndicatorByState();

        try {
            const searchQuery = String(options.searchQuery || '').trim();
            const oldRecommendImages = this._collectManagedWeiboImages(this.app.weiboData.getRecommendPosts());

            // 刷新前先清内存缓存，避免微博与热搜对象长期堆积占用
            this.app.weiboData.clearCache();

            await this.app.weiboData.generateRecommend((msg) => {
                // 静默处理进度
            }, { searchQuery });
            if (oldRecommendImages.length > 0) {
                const currentImageSet = new Set(this._collectManagedWeiboImages(this.app.weiboData.getRecommendPosts()));
                const staleImages = oldRecommendImages.filter(url => !currentImageSet.has(url));
                await this._deleteServerImages(staleImages);
            }
            this._recommendRefreshStatus = 'success';

            // 🔥 核心修复：只有当用户还在看微博推荐页时，才执行刷新。防止暴力切屏。
            const isWeiboActive = document.querySelector('.phone-view-current .weibo-app');
            if (isWeiboActive && this.currentView === 'home') {
                // 使用局部刷新代替全局渲染，解决下拉刷新完闪屏的问题
                this.switchTab('recommend', { force: true }); 
            } else {
                this._syncRecommendRefreshIndicatorByState();
            }
        } catch (error) {
            console.error('推荐生成失败:', error);
            this.app.phoneShell.showNotification('微博', error.message || '推荐刷新失败', '❌');
            this._recommendRefreshStatus = 'error';
            this._syncRecommendRefreshIndicatorByState();
        } finally {
            this.isLoading = false;

            // 成功/失败提示短暂展示后自动消失，恢复页面正常显示
            if (this._recommendRefreshTimer) {
                clearTimeout(this._recommendRefreshTimer);
                this._recommendRefreshTimer = null;
            }
            const finalStatus = this._recommendRefreshStatus;
            this._recommendRefreshTimer = setTimeout(() => {
                if (this._recommendRefreshStatus === finalStatus && finalStatus !== 'loading') {
                    this._recommendRefreshStatus = 'idle';
                    this._syncRecommendRefreshIndicatorByState();
                }
            }, 1300);
        }
    }

    _bindRecommendPullRefresh() {
        if (!(this.currentView === 'home' && this.currentTab === 'recommend')) return;

        const homeScrollEl = document.querySelector('.weibo-app.weibo-home-mode');
        const triggerAreas = Array.from(document.querySelectorAll('.weibo-tabs, .weibo-profile-wrapper')).filter(Boolean);
        if (!triggerAreas.length || !homeScrollEl) return;

        let startY = 0;
        let startX = 0;
        let pullDistance = 0;
        let pressing = false;
        let pressType = '';
        let previousUserSelect = '';
        const maxPull = 92;
        const triggerThreshold = 62;

        const canPull = () =>
            this.currentView === 'home' &&
            this.currentTab === 'recommend' &&
            !this.isLoading &&
            homeScrollEl.scrollTop <= 2;

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

            // 🔥 横向手势（如右滑返回）优先放行给 phone-shell
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 8) {
                pressing = false;
                pullDistance = 0;
                pressType = '';
                this._syncRecommendRefreshIndicatorByState();
                return;
            }

            if (deltaY <= 0) return;
            if (deltaY < 6) return;

            pullDistance = Math.min(maxPull, Math.round(deltaY * 0.55));
            const ready = pullDistance >= triggerThreshold;
            this._setRecommendPullHint(
                pullDistance,
                ready ? '松手刷新推荐' : '下拉刷新推荐',
                ready
            );

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
                this.handleRecommendRefresh();
            } else {
                this._syncRecommendRefreshIndicatorByState();
            }
        };

        const onTouchStart = (e) => {
            if (!e.touches || e.touches.length === 0) return;
            startPress(e.touches[0].clientX, e.touches[0].clientY, 'touch');
        };

        const onTouchMove = (e) => {
            if (!e.touches || e.touches.length === 0) return;
            movePress(e.touches[0].clientX, e.touches[0].clientY, e);
        };

        const onTouchEnd = () => {
            if (pressType !== 'touch') return;
            endPress();
        };

        let removeMouseGlobalListeners = null;
        const addMouseGlobalListeners = () => {
            const onMouseMove = (e) => {
                if (pressType !== 'mouse') return;
                movePress(e.clientX, e.clientY, e);
            };
            const onMouseUp = () => {
                if (pressType !== 'mouse') return;
                if (removeMouseGlobalListeners) removeMouseGlobalListeners();
                endPress();
            };
            const onWindowBlur = () => {
                if (pressType !== 'mouse') return;
                if (removeMouseGlobalListeners) removeMouseGlobalListeners();
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

        const onMouseDown = (e) => {
            if (e.button !== 0) return;
            if (!startPress(e.clientX, e.clientY, 'mouse')) return;
            e.preventDefault();
            addMouseGlobalListeners();
        };

        triggerAreas.forEach((triggerArea) => {
            if (triggerArea.dataset.pullRefreshBound === '1') return;
            triggerArea.dataset.pullRefreshBound = '1';
            triggerArea.addEventListener('touchstart', onTouchStart, { passive: true });
            triggerArea.addEventListener('touchmove', onTouchMove, { passive: false });
            triggerArea.addEventListener('touchend', onTouchEnd);
            triggerArea.addEventListener('touchcancel', onTouchEnd);
            triggerArea.addEventListener('mousedown', onMouseDown);
        });
    }

    _setRecommendPullHint(height, text, ready = false) {
        const wrap = document.getElementById('weibo-pull-refresh-indicator');
        const inner = document.getElementById('weibo-pull-refresh-inner');
        if (!wrap || !inner) return;

        wrap.classList.remove('loading', 'success', 'error');
        wrap.classList.toggle('ready', !!ready);
        wrap.style.height = `${Math.max(0, height)}px`;
        inner.innerHTML = `<i class="fa-solid fa-arrow-down"></i> ${text}`;
    }

    _syncRecommendRefreshIndicatorByState() {
        const wrap = document.getElementById('weibo-pull-refresh-indicator');
        const inner = document.getElementById('weibo-pull-refresh-inner');
        if (!wrap || !inner) return;

        wrap.classList.remove('ready', 'loading', 'success', 'error');

        if (this.isLoading || this._recommendRefreshStatus === 'loading') {
            wrap.classList.add('loading');
            wrap.style.height = '40px';
            inner.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在生成中...';
            return;
        }

        if (this._recommendRefreshStatus === 'success') {
            wrap.classList.add('success');
            wrap.style.height = '40px';
            inner.innerHTML = '<i class="fa-solid fa-circle-check"></i> 生成成功';
            return;
        }

        if (this._recommendRefreshStatus === 'error') {
            wrap.classList.add('error');
            wrap.style.height = '40px';
            inner.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> 生成失败';
            return;
        }

        wrap.style.height = '0px';
        inner.innerHTML = '';
    }

    // ========================================
    // 🔧 工具方法
    // ========================================

    _highlightWeiboText(text) {
        if (!text) return '';
        // #话题# 高亮
        text = text.replace(/#([^#]+)#/g, '<span class="weibo-topic-link">#$1#</span>');
        // @提及 高亮
        text = text.replace(/@([\u4e00-\u9fa5\w]+)/g, '<span class="weibo-mention">@$1</span>');
        return text;
    }

    _formatNum(num) {
        if (num >= 10000) return (num / 10000).toFixed(1) + '万';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
        return num.toString();
    }

    _getSillyTavernPersonaAvatar() {
        try {
            const selectedAvatarEl = document.querySelector('#user_avatar_block .avatar-container.selected img');
            if (selectedAvatarEl?.src) return selectedAvatarEl.src;

            const topBarAvatar = document.querySelector('#rm_button_panel_persona img');
            if (topBarAvatar?.src) return topBarAvatar.src;
        } catch (e) {
            console.warn('[Weibo] 获取默认 Persona 头像失败:', e);
        }
        return '';
    }

    _getWeiboDisplayAvatar(profile = null) {
        const safeProfile = profile || this.app.weiboData.getProfile();
        const customAvatar = String(safeProfile?.avatar || '').trim();
        if (customAvatar) return customAvatar;
        return this._getSillyTavernPersonaAvatar();
    }

    _isDirectWeiboMediaUrl(value) {
        const text = String(value || '').trim();
        return /^(data:image\/|data:application\/octet-stream;base64,|https?:\/\/|\/backgrounds\/)/i.test(text);
    }

    _parseWeiboMediaItem(rawValue) {
        const imageStr = String(rawValue || '').trim();
        let mediaType = '图片';
        let body = imageStr;

        const taggedMatch = imageStr.match(/^\[(用户照片|个人图片|图片|视频)\]\s*([\s\S]*)$/);
        if (taggedMatch) {
            mediaType = taggedMatch[1];
            body = String(taggedMatch[2] || '').trim();
        }

        const unwrappedBody = body.replace(/^[（(]\s*|\s*[)）]$/g, '').trim();
        const directUrl = this._isDirectWeiboMediaUrl(body)
            ? body
            : (this._isDirectWeiboMediaUrl(unwrappedBody) ? unwrappedBody : '');

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
            mediaType,
            realUrl: directUrl,
            isDirectImage: !!directUrl,
            isVideoProcessed: mediaType === '视频' && !!directUrl,
            useUserReference: mediaType === '用户照片',
            promptText: promptText.trim(),
            descriptionText: descriptionText.trim()
        };
    }

    _buildWeiboImagePromptWithUserTags(parsedMedia = {}, promptText = '') {
        const parsedPrompt = this._parsePromptDescriptionPair(promptText);
        const basePrompt = String(parsedPrompt.prompt || promptText || '').trim();
        if (String(parsedMedia?.mediaType || '').trim() !== '用户照片' && parsedMedia?.useUserReference !== true) {
            return basePrompt;
        }
        const userInfo = window.VirtualPhone?.wechatApp?.wechatData?.getUserInfo?.()
            || window.VirtualPhone?.cachedWechatData?.getUserInfo?.()
            || {};
        const userTags = String(userInfo?.naiPromptTags || userInfo?.imageTags || '')
            .split(/[,，\n]+/)
            .map(tag => tag.trim())
            .filter(Boolean)
            .join(', ');
        if (!userTags) return basePrompt;
        if (!basePrompt) return userTags;
        return `${userTags}, ${basePrompt}`;
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

    _getWeiboPostImageState(post, index) {
        if (!post || !Array.isArray(post.imageGenerationStates)) return null;
        const state = post.imageGenerationStates[index];
        return (state && typeof state === 'object') ? state : null;
    }

    _setWeiboPostImageState(post, index, nextState) {
        if (!post || !Number.isInteger(index) || index < 0) return null;
        if (!Array.isArray(post.imageGenerationStates)) {
            post.imageGenerationStates = [];
        }

        if (nextState === null) {
            delete post.imageGenerationStates[index];
            return null;
        }

        const prevState = this._getWeiboPostImageState(post, index) || {};
        post.imageGenerationStates[index] = {
            ...prevState,
            ...nextState
        };
        return post.imageGenerationStates[index];
    }

    _getPostMediaTarget(postId) {
        const safePostId = String(postId || '').trim();
        if (!safePostId) return { posts: null, post: null, source: 'recommend' };

        let posts = null;
        let source = 'recommend';
        const mode = this.currentView === 'postDetail'
            ? (this.currentPostMode || 'recommend')
            : (this.currentView === 'hotSearchDetail' ? 'hotSearch' : (this.currentTab === 'myPosts' ? 'myPosts' : 'recommend'));

        if (mode === 'hotSearch') {
            const detail = this.app.weiboData.getHotSearchDetail(this.currentHotSearchTitle);
            posts = detail?.posts || null;
            source = 'hotSearch';
        } else if (mode === 'myPosts') {
            posts = this.app.weiboData.getUserPosts();
            source = 'myPosts';
        } else {
            posts = this.app.weiboData.getRecommendPosts();
        }

        const post = Array.isArray(posts)
            ? posts.find(item => String(item?.id || '').trim() === safePostId)
            : null;

        return { posts, post, source };
    }

    _persistPostMediaTarget(posts, source = 'recommend', post = null) {
        if (!Array.isArray(posts)) return;
        if (source === 'hotSearch') {
            const detail = this.app.weiboData.getHotSearchDetail(this.currentHotSearchTitle);
            if (!detail) return;
            detail.posts = posts;
            this.app.weiboData.saveHotSearchDetail(this.currentHotSearchTitle, detail);
            return;
        }
        if (source === 'myPosts') {
            this.app.weiboData.saveUserPosts(posts);
            const targetPost = post || posts.find(item => String(item?.id || '').trim() === String(this.currentPostId || '').trim());
            if (targetPost?.isUserPost) {
                this.app.weiboData._syncUserPostMirror(targetPost);
            }
            return;
        }
        this.app.weiboData.saveRecommendPosts(posts);
        if (post?.isUserPost) {
            this.app.weiboData._syncUserPostMirror(post);
        }
    }

    _refreshPostMediaUI(postId) {
        if (this.currentView === 'postDetail' && this.currentPostId === postId) {
            this.renderPostDetail(postId, this.currentPostMode || 'recommend');
            return;
        }

        if (this.currentView === 'hotSearchDetail' && this.currentHotSearchTitle) {
            this.renderHotSearchDetail(this.currentHotSearchTitle);
            return;
        }

        if (this.currentView === 'home') {
            this.refreshCurrentTabContent();
        }
    }

    _getSiliconflowImageConfig() {
        const storage = window.VirtualPhone?.storage || this.app?.storage;
        const apiKey = String(storage?.get('siliconflow_api_key') || '').trim();
        const model = String(storage?.get('image_generation_model') || '').trim() || 'Kwai-Kolors/Kolors';

        return {
            apiKey,
            model,
            endpoint: 'https://api.siliconflow.cn/v1/images/generations',
            imageSize: '768x1024',
            batchSize: 1,
            numInferenceSteps: 16,
            guidanceScale: 6.5,
            positivePromptSuffix: '二次元插画风, 非真人, 非照片, 非写实, 动漫感, 赛璐璐上色, 游戏CG质感, 杰作, 高质量, 细节清晰, 构图完整, 光线自然, 色彩干净, 单主体突出, 适合手机展示',
            characterPositivePromptSuffix: '人物性别特征明确, 不要中性化, 主体明确, 面部与肢体自然',
            scenePositivePromptSuffix: '纯场景构图, 纯物体特写或空镜画面, 画面中不要出现人物, 不要出现角色, 不要出现路人, 不要出现人形轮廓, 不要出现手脚或身体局部',
            negativePrompt: '真人, 写实, 摄影感, 照片感, 低质量, 最差质量, 模糊, 锯齿, JPEG压缩痕迹, 多余肢体, 畸形手指, 五官错位, 性别模糊, 中性外观, 文本, 水印, 签名, 用户名',
            noPeopleNegativePrompt: '人物, 人类, 角色, 路人, 肖像, 半身像, 全身像, 人脸, 头部特写, 手, 手臂, 腿, 脚, 身体局部, 拟人化角色'
        };
    }

    _buildSiliconflowPrompt(rawPrompt, positivePromptSuffix = '') {
        const prompt = String(rawPrompt || '').trim();
        const suffix = String(positivePromptSuffix || '').trim();
        if (!prompt) return suffix;
        if (!suffix) return prompt;
        return `${prompt}，${suffix}`;
    }

    _promptLikelyNeedsCharacter(rawPrompt) {
        const prompt = String(rawPrompt || '').trim();
        if (!prompt) return false;

        const humanIndicators = [
            '人物', '角色', '人像', '肖像', '少年', '少女', '男生', '女生', '男人', '女人', '男孩', '女孩',
            '帅哥', '美女', '男主', '女主', '主角', '偶像', '主播', '老师', '同学', '妈妈', '爸爸', '情侣',
            'coser', '模特', '骑士', '公主', '王子', '精灵', '猫娘', '狐娘', '兽耳', '女仆', '拟人',
            'character', 'person', 'people', 'girl', 'boy', 'man', 'woman', 'portrait', 'human'
        ];

        return humanIndicators.some(token => prompt.toLowerCase().includes(token.toLowerCase()));
    }

    _buildSiliconflowNegativePrompt(rawPrompt, baseNegativePrompt = '', noPeopleNegativePrompt = '') {
        const negatives = [
            String(baseNegativePrompt || '').trim()
        ];

        if (!this._promptLikelyNeedsCharacter(rawPrompt)) {
            negatives.push(String(noPeopleNegativePrompt || '').trim());
        }

        return negatives.filter(Boolean).join(', ');
    }

    _buildSiliconflowPositivePrompt(rawPrompt, config = {}) {
        const prompt = String(rawPrompt || '').trim();
        const parts = [
            prompt,
            String(config.positivePromptSuffix || '').trim()
        ];

        if (this._promptLikelyNeedsCharacter(prompt)) {
            parts.push(String(config.characterPositivePromptSuffix || '').trim());
        } else {
            parts.push(String(config.scenePositivePromptSuffix || '').trim());
        }

        return parts.filter(Boolean).join('，');
    }

    _normalizeSiliconflowErrorMessage(error) {
        const rawMessage = String(error?.message || '').trim();
        if (/failed to fetch|networkerror|load failed/i.test(rawMessage)) {
            return '请求失败，可能是网络异常或浏览器跨域拦截';
        }
        return rawMessage || '未知错误';
    }

    _getAvatarInitial(name) {
        const raw = String(name || '').trim();
        if (!raw) return '微';

        if (raw.startsWith('#') || raw.startsWith('＃')) {
            const rest = raw.slice(1).trim();
            if (rest) return Array.from(rest)[0];
        }

        return Array.from(raw)[0];
    }

    _resolveWechatForwardAvatar(target, wechatData, { isGroup = false } = {}) {
        if (!target) return '';
        const directAvatar = this._normalizeWechatForwardAvatarPath(target.avatar);
        if (directAvatar) return directAvatar;
        if (!wechatData || isGroup) return '';

        const keySet = new Set([
            target.id,
            target.contactId,
            target.name
        ].filter(Boolean).map(value => String(value).trim()));

        for (const key of keySet) {
            const autoAvatar = this._normalizeWechatForwardAvatarPath(wechatData.getContactAutoAvatar?.(key));
            if (autoAvatar) return autoAvatar;
        }

        const autoMap = typeof wechatData.getContactAutoAvatarMap === 'function'
            ? wechatData.getContactAutoAvatarMap()
            : null;
        if (autoMap && typeof autoMap === 'object') {
            for (const key of keySet) {
                const mappedAvatar = this._normalizeWechatForwardAvatarPath(autoMap[key]);
                if (mappedAvatar) return mappedAvatar;
            }
        }

        return '';
    }

    _normalizeWechatForwardAvatarPath(value) {
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

    _renderForwardTargetAvatar(avatar, fallbackName = '', isGroup = false) {
        const avatarStr = String(avatar || '').trim();
        const imageAvatar = this._normalizeWechatForwardAvatarPath(avatarStr);
        if (imageAvatar) {
            return `<img src="${this._escapeAttr(imageAvatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`;
        }
        if (avatarStr) return this._escapeHtml(avatarStr);
        return this._escapeHtml(isGroup ? '👥' : this._getAvatarInitial(fallbackName || '微'));
    }

    _escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _escapeAttr(str) {
        return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // 🔥 新增：将用户的 CSS 注入到页面中
    _applyCustomAvatarFrame(cssText) {
        let styleTag = document.getElementById('weibo-custom-avatar-frame-style');
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = 'weibo-custom-avatar-frame-style';
            document.head.appendChild(styleTag);
        }
        styleTag.textContent = cssText || '';
    }
    
    // ========================================
    // 🗑️ 服务器文件清理工具
    // ========================================
    _collectManagedWeiboImages(posts) {
        const result = [];
        const seen = new Set();
        const collectFromValue = (value) => {
            const raw = String(value || '').trim();
            if (!raw) return;
            const media = this._parseWeiboMediaItem(raw);
            const candidates = [
                raw,
                media.realUrl,
                media.realUrl ? `[${media.mediaType}]${media.realUrl}` : ''
            ];
            candidates.forEach((candidate) => {
                const text = String(candidate || '').trim();
                const match = text.match(/(?:^\[[^\]]+\]\s*)?(\/backgrounds\/phone_weibo_img_[^?#\s)）]+)/i);
                if (!match) return;
                const url = match[1];
                if (seen.has(url)) return;
                seen.add(url);
                result.push(url);
            });
        };

        (Array.isArray(posts) ? posts : []).forEach((post) => {
            if (Array.isArray(post?.images)) {
                post.images.forEach(collectFromValue);
            }
            if (Array.isArray(post?.imageGenerationStates)) {
                post.imageGenerationStates.forEach((state) => collectFromValue(state?.generatedImageUrl));
            }
        });
        return result;
    }

    async _deleteServerImages(images) {
        if (!Array.isArray(images) || images.length === 0) return;
        const imageManager = window.VirtualPhone?.imageManager;
        const buildDeleteHeaders = async () => {
            const headers = typeof window.getRequestHeaders === 'function' ? window.getRequestHeaders() : {};
            delete headers['Content-Type'];
            delete headers['content-type'];
            headers['Content-Type'] = 'application/json';
            if (!headers['X-CSRF-Token'] && !headers['x-csrf-token']) {
                const csrfResp = await fetch('/csrf-token');
                if (csrfResp.ok) {
                    const csrfJson = await csrfResp.json();
                    if (csrfJson?.token) headers['X-CSRF-Token'] = csrfJson.token;
                }
            }
            return headers;
        };

        for (const imgUrl of images) {
            const rawUrl = String(imgUrl || '').trim();
            // 只处理我们上传到酒馆服务器的图片
            if (!rawUrl.startsWith('/backgrounds/')) continue;
            
            // 🔥 去掉 ?t=xxx 防缓存尾巴，提取纯文件名
            const filename = decodeURIComponent(rawUrl.replace('/backgrounds/', '').split('?')[0]);
            // 严谨校验：只删手机微博发的图片
            if (!filename.startsWith('phone_weibo_img_')) continue;
            if (imageManager?.deleteManagedBackgroundByPath) {
                try {
                    const result = await imageManager.deleteManagedBackgroundByPath(`/backgrounds/${filename}`, { quiet: true });
                    if (result?.success) {
                        console.log(`[Weibo] 物理清理成功: ${filename}`);
                        continue;
                    }
                } catch (e) {
                    // 回退到旧删除接口
                }
            }
            const headers = await buildDeleteHeaders();

            // 暴力兼容所有版本酒馆的删除接口格式
            const attempts = [
                () => fetch('/api/backgrounds/delete', { method: 'POST', headers, body: JSON.stringify({ bg: filename }) }),
                () => fetch('/api/backgrounds/delete', { method: 'POST', headers, body: JSON.stringify({ filename }) }),
                () => fetch('/api/backgrounds/delete', { method: 'POST', headers, body: JSON.stringify({ file: filename }) }),
                () => fetch(`/api/backgrounds/delete?bg=${encodeURIComponent(filename)}`, { method: 'DELETE', headers })
            ];

            for (const request of attempts) {
                try {
                    const resp = await request();
                    if (resp?.ok) {
                        await imageManager?.markManagedBackgroundDeleted?.(`/backgrounds/${filename}`);
                        console.log(`[Weibo] 物理清理成功: ${filename}`);
                        break;
                    }
                } catch (e) {
                    // 静默失败，继续尝试下一种 payload
                }
            }
        }
    }
}
