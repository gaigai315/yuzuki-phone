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

    // ========================================
    // 🏠 首页
    // ========================================

    renderHome() {
        const profile = this.app.weiboData.getProfile();
        const bannerStyle = profile.banner
            ? `background-image: url('${profile.banner}'); background-size: 100% auto; background-position: center top; background-repeat: no-repeat; background-color: #f5f5f5;`
            : 'background: linear-gradient(135deg, #ff8200 0%, #ff6a00 50%, #e85d04 100%); background-color: #f5f5f5;';

        const avatarHtml = profile.avatar
            ? `<img src="${profile.avatar}" class="weibo-avatar-img">`
            : `<div class="weibo-avatar-default">📷</div>`;

        const context = this.app.weiboData._getContext();
        const userName = context?.name1 || '微博用户';
        const nickname = profile.nickname || userName;
        const following = profile.following ?? 25;
        const followers = profile.followers ?? 0;
        const postsCount = this.app.weiboData.getRecommendPosts().filter(p => p.isUserPost).length;
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
                        <button class="weibo-nav-btn" id="weibo-settings-btn">
                            <i class="fa-solid fa-gear"></i>
                        </button>
                    </div>
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
        const posts = this.app.weiboData.getRecommendPosts();

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
        const posts = this.app.weiboData.getRecommendPosts().filter(p => p.isUserPost);

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
        const context = this.app.weiboData._getContext();
        const userName = context?.name1 || '我';
        const isLiked = post.likeList?.includes(userName);
        const isListMode = (mode === 'recommend' || mode === 'myPosts' || mode === 'hotSearch');
        const isDetail = (mode === 'detail');
        const showDeleteBtn = (mode === 'myPosts' && !!post.isUserPost);
        const avatarInitial = this._getAvatarInitial(post.blogger);

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
                        <div class="weibo-post-avatar-circle">${avatarInitial}</div>
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
                            const isDirectImage = /^data:image|^https?:\/\/|^\/backgrounds\//i.test(imageStr);

                            // 统一提取“图片背后的字”
                            let promptText = imageStr.replace(/\[图片\][（(]?|[）)]?|[\[\]【】]/g, '').trim();
                            if (/^data:image|^https?:\/\/|^\/backgrounds\//i.test(promptText)) {
                                promptText = '';
                            }
                            if (!promptText || promptText.length < 2) {
                                promptText = "分享图片";
                            }
                            const safePromptText = this._escapeHtml(promptText);

                            // 对描述图使用稳定随机配图；对真实图片URL使用原图
                            const seed = encodeURIComponent(post.id + '_' + index);
                            const displayUrl = isDirectImage ? imageStr : `https://picsum.photos/seed/${seed}/400/400`;
                            
                            return `
                            <div class="weibo-post-img-container" style="position: relative; width: 100%; height: 100%; aspect-ratio: 1;">
                                <img src="${displayUrl}" class="weibo-post-img-real" 
                                     style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px; background: #f9f9f9; cursor: pointer;"
                                     title="点击查看图片描述"
                                     onclick="this.style.display='none'; const textLayer = this.closest('.weibo-post-img-container')?.querySelector('.weibo-post-img-text'); if (textLayer) textLayer.style.display='block';"
                                     onerror="this.style.display='none'; const textLayer = this.closest('.weibo-post-img-container')?.querySelector('.weibo-post-img-text'); if (textLayer) textLayer.style.display='block';">
                                
                                <div class="weibo-post-img-text" style="
                                    display: none; 
                                    width: 100%; 
                                    height: 100%; 
                                    background: #f7f7f7; 
                                    border: 1px dashed #e0e0e0; 
                                    border-radius: 4px; 
                                    box-sizing: border-box; 
                                    position: relative;
                                ">
                                    <!-- 文字内容容器（开启 Flex 布局以实现居中） -->
                                    <div style="
                                        width: 100%;
                                        height: 100%;
                                        padding: 8px;
                                        padding-bottom: 24px; /* 给底部按钮留出空间 */
                                        overflow-y: auto; 
                                        box-sizing: border-box;
                                        display: flex;
                                    ">
                                        <!-- 真正的文字文本（margin: auto 是垂直/水平居中的魔法，text-align: center 让多行文字也居中） -->
                                        <div style="
                                            margin: auto; 
                                            font-size: 11px; 
                                            color: #666; 
                                            line-height: 1.5; 
                                        word-break: break-word;
                                        white-space: pre-wrap;
                                        text-align: center;
                                        width: 100%;
                                        ">${safePromptText}</div>
                                    </div>
                                    
                                    <div title="恢复显示图片" onclick="const wrap = this.closest('.weibo-post-img-container'); const textLayer = wrap?.querySelector('.weibo-post-img-text'); const img = wrap?.querySelector('.weibo-post-img-real'); if (textLayer) textLayer.style.display='none'; if (img) img.style.display='block';" style="
                                        position: absolute;
                                        bottom: 4px;
                                        right: 4px;
                                        background: rgba(0,0,0,0.5);
                                        color: #fff;
                                        border-radius: 4px;
                                        padding: 3px 6px;
                                        font-size: 10px;
                                        cursor: pointer;
                                        z-index: 10;
                                        display: flex;
                                        align-items: center;
                                        gap: 3px;
                                        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                                    ">
                                        <i class="fa-regular fa-image"></i> 恢复
                                    </div>
                                </div>
                            </div>`;
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
                        <span>楼层 ${floorData.currentFloor}</span>
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
                            <div class="weibo-hot-load-more-wrap">
                                <button class="weibo-refresh-btn weibo-hot-load-more-btn" id="weibo-hot-load-more">
                                    <i class="fa-solid fa-plus"></i> 加载更多
                                </button>
                            </div>
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
            if (hint) hint.textContent = '生成失败，请下拉重新生成';
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
        if (mode === 'recommend' || mode === 'myPosts') {
            const posts = this.app.weiboData.getRecommendPosts();
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

                <div class="weibo-detail-page-body" id="weibo-detail-scroll-area" style="flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: 60px;">
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
                    gap: 10px;
                    z-index: 100;
                    box-sizing: border-box;
                ">
                    <div style="flex: 1; position: relative;">
                        <input type="text" id="fixed-comment-input" placeholder="写评论..." style="
                            width: 100%;
                            padding: 8px 36px 8px 16px;
                            border: 1px solid #e0e0e0;
                            border-radius: 20px;
                            font-size: 13px;
                            outline: none;
                            box-sizing: border-box;
                            background: #fff;
                        ">
                        <button id="fixed-comment-send" style="
                            position: absolute;
                            right: 4px;
                            top: 50%;
                            transform: translateY(-50%);
                            background: #ff8200;
                            color: #fff;
                            border: none;
                            border-radius: 50%;
                            width: 28px;
                            height: 28px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            cursor: pointer;
                        ">
                            <i class="fa-solid fa-paper-plane" style="font-size: 12px;"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'weibo-post-detail');
        
        this.currentReplyTo = null; // 初始化回复状态
        this.bindPostDetailEvents(postId, mode);
    }

    bindPostDetailEvents(postId, mode) {
        // 返回
        document.getElementById('weibo-detail-page-back')?.addEventListener('click', () => {
            // 从微信跳入微博正文时，直接回微信聊天窗口
            if (this.entrySource?.appId === 'wechat' && typeof this.app.returnToWechatFromCard === 'function') {
                this.app.returnToWechatFromCard();
                return;
            }

            this.currentPostId = null;
            this.currentPostMode = null;
            if (mode === 'hotSearch') {
                this.currentView = 'hotSearchDetail';
            } else {
                this.currentView = 'home';
            }
            this.render();
        });

        // 帖子交互（详情页内的点赞、评论、转发）
        this._bindPostEvents(mode === 'myPosts' ? 'recommend' : mode);

        // 加载更多评论
        document.getElementById('load-more-comments-btn')?.addEventListener('click', async (e) => {
            const btn = e.target.closest('button');
            if (!btn || btn.disabled) return;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在加载...';

            try {
                const source = (mode === 'myPosts') ? 'recommend' : mode;
                const hotTitle = mode === 'hotSearch' ? this.currentHotSearchTitle : null;
                await this.app.weiboData.generateMoreComments(postId, source, hotTitle);
                this.renderPostDetail(postId, mode);
                this.app.phoneShell.showNotification('微博', '新评论已加载', '💬');
            } catch (error) {
                console.error('加载评论失败:', error);
                this.app.phoneShell.showNotification('微博', '加载评论失败', '❌');
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-regular fa-comment-dots"></i> 加载更多评论...';
            }
        });

        // 🔥 新增：固定底栏事件绑定
        const input = document.getElementById('fixed-comment-input');
        const sendBtn = document.getElementById('fixed-comment-send');
        
        if (input && sendBtn) {
            // 点击空白区域时，取消“回复某人”状态，变回普通的“写评论...”
            document.getElementById('weibo-detail-scroll-area')?.addEventListener('click', () => {
                this.currentReplyTo = null;
                input.placeholder = "写评论...";
            });

            const submitComment = () => {
                const text = input.value?.trim();
                if (!text) return;

                const replyTo = this.currentReplyTo;

                if (mode === 'recommend' || mode === 'myPosts') {
                    this.app.weiboData.addComment(postId, text, replyTo, 'recommend');
                } else {
                    this.app.weiboData.addCommentHotSearch(postId, text, replyTo, this.currentHotSearchTitle);
                }

                // 清空输入框和状态
                input.value = '';
                this.currentReplyTo = null;
                input.placeholder = "写评论...";

                // 🔥 核心修复：直接重新渲染整个详情页，确保评论100%精准显示在正文下方，且包含正确的回复对象
                this.renderPostDetail(postId, mode);
                
                // 滚动到底部查看最新评论
                const scrollArea = document.getElementById('weibo-detail-scroll-area');
                if (scrollArea) {
                    setTimeout(() => {
                        scrollArea.scrollTop = scrollArea.scrollHeight;
                    }, 50);
                }
                
                // 🔥 触发AI自动回复用户的评论 (已静默)
                this.triggerCommentAIReaction(postId, text, replyTo, mode);
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
                        <textarea id="weibo-hot-prompt" class="weibo-prompt-textarea"
                                  placeholder="热搜内容生成提示词...">${hotSearchPrompt}</textarea>
                        <button class="weibo-settings-btn" id="weibo-save-hot-prompt">
                            <i class="fa-solid fa-check"></i> 保存提示词
                        </button>
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

                    <!-- 推荐提示词 -->
                    <div class="weibo-settings-section">
                        <div class="weibo-settings-title">推荐生成提示词</div>
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

                    <!-- 热搜提示词 -->
                    <div class="weibo-settings-section">
                        <div class="weibo-settings-title">热搜详情提示词</div>
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

        const avatarHtml = profile.avatar
            ? `<img src="${profile.avatar}" style="width: 100%; height: 100%; object-fit: cover;">`
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
                    let finalUrl = croppedImage; // 兜底：如果服务器上传失败，回退到 base64
                    
                    try {
                        const imgResp = await fetch(croppedImage);
                        const blob = await imgResp.blob();
                        const ext = blob.type === 'image/png' ? 'png' : 'jpg';
                        const filename = `phone_weibo_img_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.${ext}`;
                        
                        const formData = new FormData();
                        formData.append('avatar', blob, filename);

                        const headers = typeof window.getRequestHeaders === 'function' ? window.getRequestHeaders() : {};
                        delete headers['Content-Type']; 
                        if (!headers['X-CSRF-Token']) {
                            const csrfResp = await fetch('/csrf-token');
                            if (csrfResp.ok) headers['X-CSRF-Token'] = (await csrfResp.json()).token;
                        }

                        const uploadResp = await fetch('/api/backgrounds/upload', { method: 'POST', body: formData, headers });
                        if (uploadResp.ok) {
                            finalUrl = `/backgrounds/${filename}?t=${Date.now()}`;
                        }
                    } catch (uploadErr) {
                        console.warn('[Weibo] 图片上传服务器失败，降级使用Base64:', uploadErr);
                    }

                    // 写入预览数组并立刻渲染
                    if (!this.pendingPostImages) this.pendingPostImages = [];
                    this.pendingPostImages.push(finalUrl);
                    this.updatePostImagePreview();
                } catch (error) {
                    if (error.message !== '用户取消') {
                        this.app.phoneShell.showNotification('提示', error.message, '⚠️');
                    }
                }
            }
            this.app.phoneShell.showNotification('成功', '图片处理完成', '✅');
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
                    this.app.weiboData.addComment(post.id, c.text, aiReplyTo || null, 'recommend', c.name, c.location || '');
                }

                for (const likeName of (result.likes || [])) {
                    const posts = this.app.weiboData.getRecommendPosts();
                    const updatedPost = posts.find(p => p.id === post.id);
                    if (updatedPost) {
                        if (!updatedPost.likeList) updatedPost.likeList = [];
                        if (!updatedPost.likeList.includes(likeName)) {
                            updatedPost.likeList.push(likeName);
                            updatedPost.likes = updatedPost.likeList.length;
                        }
                        this.app.weiboData.saveRecommendPosts(posts);
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
            ...contacts,
            ...groupChats.map(g => ({ name: g.name, avatar: g.avatar || '👥', isGroup: true }))
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

        phoneScreen?.appendChild(overlay);
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
                            <div class="weibo-forward-contact-avatar">${this._renderForwardTargetAvatar(c.avatar, c.name)}</div>
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
                        <div class="weibo-forward-contact-avatar">${this._renderForwardTargetAvatar(target.avatar, target.name)}</div>
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

    showCommentInput(postId, replyTo = null, mode = 'recommend') {
        // 移除之前的输入框
        document.querySelectorAll('.weibo-inline-comment-box').forEach(el => el.remove());

        const postEl = document.querySelector(`.weibo-post[data-post-id="${postId}"]`);
        if (!postEl) return;

        const inputBox = document.createElement('div');
        inputBox.className = 'weibo-inline-comment-box';
        inputBox.innerHTML = `
            <input type="text" class="weibo-comment-input" placeholder="${replyTo ? `回复 ${replyTo}` : '写评论...'}" autofocus>
            <button class="weibo-comment-send"><i class="fa-solid fa-paper-plane"></i></button>
        `;
        postEl.appendChild(inputBox);

        const input = inputBox.querySelector('.weibo-comment-input');
        const sendBtn = inputBox.querySelector('.weibo-comment-send');

        input.focus();

        const submitComment = () => {
            const text = input.value?.trim();
            if (!text) return;

            if (mode === 'recommend') {
                this.app.weiboData.addComment(postId, text, replyTo);
            } else {
                this.app.weiboData.addCommentHotSearch(postId, text, replyTo, this.currentHotSearchTitle);
            }

            inputBox.remove();

            // 局部更新评论区
            const updatedPosts = mode === 'recommend'
                ? this.app.weiboData.getRecommendPosts()
                : this.app.weiboData.getHotSearchDetail(this.currentHotSearchTitle)?.posts;

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
            this.triggerCommentAIReaction(postId, text, replyTo, mode);
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
        
        post.commentList.forEach((c, idx) => {
            const cleanName = (c.name || '网友').replace(/^@/, '');
            const cleanReplyTo = c.replyTo ? c.replyTo.replace(/^@/, '') : null;
            
            const commentObj = { 
                ...c, 
                originalIndex: idx, 
                cleanName: cleanName, 
                cleanReplyTo: cleanReplyTo, 
                subComments: [] 
            };

            // 如果没有回复对象，或者是回复博主本人的，视为主评论
            if (!cleanReplyTo || cleanReplyTo === post.blogger) {
                groupedComments.push(commentObj);
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
                    <div class="weibo-new-comment">
                        <div class="wnc-avatar">
                            <div class="wnc-avatar-circle">${avatarChar}</div>
                        </div>
                        <div class="wnc-main">
                            <!-- 🔥 主评论，添加 weibo-replyable 类用于点击回复 -->
                            <div class="wnc-name weibo-replyable" data-author="${mainComment.cleanName}">${mainComment.cleanName}</div>
                            <div class="wnc-content weibo-replyable" data-author="${mainComment.cleanName}">
                                ${mainComment.text}
                            </div>
                            
                            <!-- 🔥 楼中楼渲染区域 -->
                            ${mainComment.subComments.length > 0 ? `
                                <div class="wnc-sub-comments">
                                    ${mainComment.subComments.map(sub => `
                                        <div class="wnc-sub-item weibo-replyable" data-author="${sub.cleanName}">
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

    // 🔥 AI互动：当用户在微博详情页评论时，触发AI生成回复（完全静默版）
    async triggerCommentAIReaction(postId, userText, replyTo, mode) {
        try {
            let post;
            if (mode === 'recommend') {
                post = this.app.weiboData.getRecommendPosts().find(p => p.id === postId);
            } else {
                post = this.app.weiboData.getHotSearchDetail(this.currentHotSearchTitle)?.posts?.find(p => p.id === postId);
            }

            if (!post) return;
            
            // 必须开启在线模式才触发
            const storage = window.VirtualPhone?.storage;
            if (!storage || !storage.get('wechat_online_mode')) {
                return; 
            }

            // 取消了“正在输入...”弹窗，直接请求API
            const result = await this.app.weiboData.generateReplyForUserComment(post, userText, replyTo);

            if (result && result.comments && result.comments.length > 0) {
                const context = this.app.weiboData._getContext();
                const userName = context?.name1 || '我';
                const profile = this.app.weiboData.getProfile();
                const userWeiboNick = (profile?.nickname || userName || '我').trim();
                const replyTarget = '@' + userWeiboNick;

                for (const c of result.comments) {
                    // 模拟打字延迟，制造真实感
                    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));
                    const aiReplyTo = c.replyTo ? String(c.replyTo).trim() : null;
                    const finalReplyTo = aiReplyTo || replyTarget;

                    if (mode === 'recommend') {
                        this.app.weiboData.addComment(postId, c.text, finalReplyTo, 'recommend', c.name || '热心网友', c.location || '');
                    } else {
                        this.app.weiboData.addCommentHotSearch(postId, c.text, finalReplyTo, this.currentHotSearchTitle, c.name || '热心网友', c.location || '');
                    }
                }

                // 取消了“收到新回复”弹窗

                // 如果当前仍在这个帖子的详情页，静默刷新页面显示新回复
                if (this.currentView === 'postDetail' && this.currentPostId === postId) {
                    this.renderPostDetail(postId, mode);
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
        if (homeBackBtn) homeBackBtn.onclick = () => {
            if (this.entrySource?.appId === 'wechat' && typeof this.app.returnToWechatFromCard === 'function') {
                this.app.returnToWechatFromCard();
                return;
            }
            window.dispatchEvent(new CustomEvent('phone:goHome'));
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

        // 绑定帖子交互事件 (点赞、评论等)
        this._bindPostEvents(this.currentTab === 'myPosts' ? 'recommend' : this.currentTab === 'recommend' ? 'recommend' : 'recommend');
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

        // 加载更多（替代底部追加生成按钮）
        document.getElementById('weibo-hot-load-more')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            if (btn.disabled) return;
            await this.handleHotSearchAppend(title, btn);
        });

        // 绑定帖子交互事件
        this._bindPostEvents('hotSearch');
    }

    async handleHotSearchRegenerate(title) {
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
            this.app.weiboData.clearHotSearchDetail(title);
            this.app.phoneShell.showNotification('微博', '正在重新生成...', '⏳');
            await this.app.weiboData.generateHotSearchDetail(title);
            this._hotDetailRefreshStatus = 'success';

            const isWeiboActive = document.querySelector('.phone-view-current .weibo-app');
            if (isWeiboActive && this.currentView === 'hotSearchDetail' && this.currentHotSearchTitle === title) {
                this.renderHotSearchDetail(title);
            } else {
                this._syncHotDetailRefreshIndicatorByState();
            }
            this.app.phoneShell.showNotification('微博', '生成完成', '✅');
        } catch (error) {
            this._hotDetailRefreshStatus = 'error';
            this._syncHotDetailRefreshIndicatorByState();
            this.app.phoneShell.showNotification('微博', error.message || '重新生成失败', '❌');
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

    async handleHotSearchAppend(title, btn = null) {
        if (!title) return;

        if (!this._generatingHotSearches) this._generatingHotSearches = new Set();
        if (this._generatingHotSearches.has(title)) {
            this.app.phoneShell.showNotification('提示', '该热搜正在生成中，请稍候...', '⏳');
            return;
        }

        this._generatingHotSearches.add(title);
        if (btn) btn.disabled = true;
        try {
            this.app.phoneShell.showNotification('微博', '正在追加生成...', '⏳');
            await this.app.weiboData.appendHotSearchContent(title);

            const isWeiboActive = document.querySelector('.phone-view-current .weibo-app');
            if (isWeiboActive && this.currentView === 'hotSearchDetail' && this.currentHotSearchTitle === title) {
                this.renderHotSearchDetail(title);
            }
            this.app.phoneShell.showNotification('微博', '追加完成', '✅');
        } catch (error) {
            this.app.phoneShell.showNotification('微博', error.message || '追加生成失败', '❌');
        } finally {
            this._generatingHotSearches.delete(title);
            if (btn) btn.disabled = false;
        }
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
                ready ? '松手重新生成' : '下拉重新生成',
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
                this.handleHotSearchRegenerate(title);
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
            inner.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在重新生成...';
            return;
        }

        if (this._hotDetailRefreshStatus === 'success') {
            wrap.classList.add('success');
            wrap.style.height = '40px';
            inner.innerHTML = '<i class="fa-solid fa-circle-check"></i> 生成成功';
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

    bindSettingsEvents() {
        document.getElementById('weibo-settings-back')?.addEventListener('click', () => {
            this.currentView = 'home';
            this.render();
        });

        // 保存个人资料
        document.getElementById('weibo-save-profile')?.addEventListener('click', () => {
            const profile = this.app.weiboData.getProfile();
            profile.nickname = document.getElementById('weibo-set-nickname')?.value?.trim() || '';
            profile.ipLocation = document.getElementById('weibo-set-ip')?.value?.trim() || '';
            profile.following = Math.max(0, parseInt(document.getElementById('weibo-set-following')?.value) || 0);
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
                    maxFileSize: 2 * 1024 * 1024
                });
                const croppedImage = await cropper.open(file);
                let avatarUrl = croppedImage;
                try {
                    const res = await fetch(croppedImage);
                    const blob = await res.blob();
                    const ext = blob.type === 'image/png' ? 'png' : 'jpg';
                    const filename = `phone_weibo_avatar_${Date.now()}.${ext}`;
                    const formData = new FormData();
                    formData.append('avatar', blob, filename);
                    const uploadResp = await fetch('/api/backgrounds/upload', { method: 'POST', body: formData });
                    if (uploadResp.ok) avatarUrl = `/backgrounds/${filename}`;
                } catch (err) { console.warn('[Weibo] 头像上传服务端失败:', err); }
                const profile = this.app.weiboData.getProfile();
                profile.avatar = avatarUrl;
                this.app.weiboData.saveProfile(profile);
                this.app.phoneShell.showNotification('成功', '头像已更新', '✅');
            } catch (error) {
                if (error.message !== '用户取消') {
                    this.app.phoneShell.showNotification('提示', error.message, '⚠️');
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
                let bannerUrl = croppedImage;
                try {
                    const res = await fetch(croppedImage);
                    const blob = await res.blob();
                    const ext = blob.type === 'image/png' ? 'png' : 'jpg';
                    const filename = `phone_weibo_banner_${Date.now()}.${ext}`;
                    const formData = new FormData();
                    formData.append('avatar', blob, filename);
                    const uploadResp = await fetch('/api/backgrounds/upload', { method: 'POST', body: formData });
                    if (uploadResp.ok) bannerUrl = `/backgrounds/${filename}`;
                } catch (err) { console.warn('[Weibo] 背景上传服务端失败:', err); }
                const profile = this.app.weiboData.getProfile();
                profile.banner = bannerUrl;
                this.app.weiboData.saveProfile(profile);
                this.app.phoneShell.showNotification('成功', '背景图已更新', '✅');
            } catch (error) {
                if (error.message !== '用户取消') {
                    this.app.phoneShell.showNotification('提示', error.message, '⚠️');
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
                promptManager?.updatePrompt('weibo', 'recommend', text);
                this.app.phoneShell.showNotification('保存成功', '推荐提示词已更新', '✅');
            }
        });

        document.getElementById('weibo-reset-recommend-prompt')?.addEventListener('click', () => {
            const promptManager = window.VirtualPhone?.promptManager;
            if (promptManager) {
                const defaults = promptManager.getDefaultPrompts();
                const defaultText = defaults.weibo?.recommend?.content || '';
                promptManager.updatePrompt('weibo', 'recommend', defaultText);
                const textarea = document.getElementById('weibo-recommend-prompt');
                if (textarea) textarea.value = defaultText;
                this.app.phoneShell.showNotification('已恢复', '推荐提示词已恢复默认', '✅');
            }
        });

        document.getElementById('weibo-save-hotsearch-prompt')?.addEventListener('click', () => {
            const text = document.getElementById('weibo-hotsearch-prompt')?.value;
            if (text !== undefined) {
                const promptManager = window.VirtualPhone?.promptManager;
                promptManager?.updatePrompt('weibo', 'hotSearch', text);
                this.app.phoneShell.showNotification('保存成功', '热搜提示词已更新', '✅');
            }
        });

        document.getElementById('weibo-reset-hotsearch-prompt')?.addEventListener('click', () => {
            const promptManager = window.VirtualPhone?.promptManager;
            if (promptManager) {
                const defaults = promptManager.getDefaultPrompts();
                const defaultText = defaults.weibo?.hotSearch?.content || '';
                promptManager.updatePrompt('weibo', 'hotSearch', defaultText);
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
                    
                    // 1. 清空插件数据库、动态缓存与全局微博美化 CSS
                    this.app.weiboData.clearAllData();
                    this._applyCustomAvatarFrame('');

                    const cssTextarea = document.getElementById('weibo-avatar-frame-css');
                    if (cssTextarea) {
                        cssTextarea.value = '';
                    }
                    
                    // 2. 深入酒馆源文件擦除遗留标签
                    await this.app.weiboData.clearWeiboChatHistory();
                    
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
                promptManager?.updatePrompt('weibo', 'hotSearch', text);
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
                this.currentPostMode = mode === 'hotSearch' ? 'hotSearch' : 'recommend';
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
                if (mode === 'recommend') {
                    updatedPost = this.app.weiboData.toggleLike(postId);
                } else {
                    updatedPost = this.app.weiboData.toggleLikeHotSearch(postId, this.currentHotSearchTitle);
                }

                if (updatedPost) {
                    const context = this.app.weiboData._getContext();
                    const userName = context?.name1 || '我';
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
                    this.currentPostMode = mode === 'hotSearch' ? 'hotSearch' : 'recommend';
                    this.currentView = 'postDetail';
                    this.render();
                    return;
                }
                
                // 已经在详情页，聚焦到底部固定输入框
                const fixedInput = document.getElementById('fixed-comment-input');
                if (fixedInput) {
                    this.currentReplyTo = null;
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

                const source = mode === 'hotSearch' ? 'hotSearch' : 'recommend';
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
                
                // 聚焦到底部固定输入框，并改变提示词和内部状态
                const fixedInput = document.getElementById('fixed-comment-input');
                if (fixedInput && replyTo) {
                    this.currentReplyTo = replyTo;
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
                    : this.app.weiboData.getHotSearchDetail(this.currentHotSearchTitle)?.posts;

                const post = posts?.find(p => p.id === postId);
                if (post) {
                    await this.showForwardDialog(post); // 🔥 加上 await
                }
            };
        });
    }

   // ========================================
    // 🔄 推荐刷新
    // ========================================

    async handleRecommendRefresh() {
        if (this.isLoading) return;
        this.isLoading = true;
        this._recommendRefreshStatus = 'loading';
        this._syncRecommendRefreshIndicatorByState();

        try {
            // 刷新前先清内存缓存，避免微博与热搜对象长期堆积占用
            this.app.weiboData.clearCache();

            await this.app.weiboData.generateRecommend((msg) => {
                // 静默处理进度
            });
            this._recommendRefreshStatus = 'success';

            // 🔥 核心修复：只有当用户还在看微博推荐页时，才执行刷新。防止暴力切屏。
            const isWeiboActive = document.querySelector('.phone-view-current .weibo-app');
            if (isWeiboActive && this.currentView === 'home' && this.currentTab === 'recommend') {
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

    _getAvatarInitial(name) {
        const raw = String(name || '').trim();
        if (!raw) return '微';

        if (raw.startsWith('#') || raw.startsWith('＃')) {
            const rest = raw.slice(1).trim();
            if (rest) return Array.from(rest)[0];
        }

        return Array.from(raw)[0];
    }

    _renderForwardTargetAvatar(avatar, fallbackName = '') {
        const avatarStr = String(avatar || '').trim();
        if (avatarStr && (avatarStr.startsWith('data:image') || avatarStr.startsWith('http://') || avatarStr.startsWith('https://') || avatarStr.startsWith('/'))) {
            return `<img src="${avatarStr}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`;
        }
        if (avatarStr) return this._escapeHtml(avatarStr);
        return this._escapeHtml(this._getAvatarInitial(fallbackName || '微'));
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
    async _deleteServerImages(images) {
        if (!Array.isArray(images) || images.length === 0) return;

        for (const imgUrl of images) {
            const rawUrl = String(imgUrl || '').trim();
            // 只处理我们上传到酒馆服务器的图片
            if (!rawUrl.startsWith('/backgrounds/')) continue;
            
            // 🔥 去掉 ?t=xxx 防缓存尾巴，提取纯文件名
            const filename = decodeURIComponent(rawUrl.replace('/backgrounds/', '').split('?')[0]);
            // 严谨校验：只删手机微博发的图片
            if (!filename.startsWith('phone_weibo_img_')) continue;

            // 暴力兼容所有版本酒馆的删除接口格式
            const attempts = [
                () => fetch('/api/backgrounds/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bg: filename }) }),
                () => fetch('/api/backgrounds/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename }) }),
                () => fetch('/api/backgrounds/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: filename }) }),
                () => fetch(`/api/backgrounds/delete?bg=${encodeURIComponent(filename)}`, { method: 'DELETE' })
            ];

            for (const request of attempts) {
                try {
                    const resp = await request();
                    if (resp?.ok) {
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
