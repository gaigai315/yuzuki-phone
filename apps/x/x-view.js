/* ========================================================
 *  Yuzuki Phone
 *  X app view - feed, post detail, comments, and replies
 * ======================================================== */

import { ImageCropper } from '../settings/image-cropper.js';
import { replacePhoneEmojiTokens } from '../../config/phone-emoji.js';

const PROFILE_AVATAR = new URL('./assets/profile.jpg', import.meta.url).href;
const SOL_AVATAR = new URL('./assets/sol-avatar.png', import.meta.url).href;
const STUDIO_AVATAR = new URL('./assets/studio-avatar.png', import.meta.url).href;

const AVATAR_SOURCES = {
    profile: PROFILE_AVATAR,
    sol: SOL_AVATAR,
    studio: STUDIO_AVATAR
};

export class XView {
    constructor(app) {
        this.app = app;
        this.currentPage = 'home';
        this.currentFeed = 'for-you';
        this.currentPostId = null;
        this.currentPostSource = 'feed';
        this.detailReturnPage = 'home';
        this.composeReturnPage = 'home';
        this.pendingComposeImages = [];
        this.composeUploadInProgress = false;
        this.composeSessionId = 0;
        this.currentReplyCommentId = null;
        this.isRefreshing = false;
        this._refreshStatus = 'idle';
        this._refreshTimer = null;
        this._suppressFeedClickUntil = 0;
        this._activeForwardOverlayClose = null;
        this._activePostMenuClose = null;
        this.activeDirectMessageId = null;
        this._sendingDirectMessageThreadIds = new Set();
        this._pendingReactionPostIds = new Set();
        this._loadingMorePostIds = new Set();
        this._pendingCommentReactionIds = new Set();
        this._visibleUserPostIds = new Set();
        this._suppressDirectMessageThreadClickUntil = 0;
    }

    render() {
        if (this.currentPage === 'detail' && !this.app.xData.getPost(this.currentPostId, this.currentPostSource)) {
            this.currentPage = 'home';
            this.currentPostId = null;
            this.currentPostSource = 'feed';
            this.detailReturnPage = 'home';
            this.currentReplyCommentId = null;
        }

        const body = {
            detail: () => this.renderPostDetail(),
            chat: () => this.renderChat(),
            compose: () => this.renderCompose(),
            profile: () => this.renderProfile(),
            settings: () => this.renderSettings(),
            home: () => this.renderHome()
        }[this.currentPage]?.() || this.renderHome();
        const showBottomNav = this.currentPage === 'home'
            || (this.currentPage === 'chat' && !this.activeDirectMessageId);
        const html = `
            <main class="xapp-root" data-page="${this.currentPage}" data-swipe-back-through-controls="true">
                ${body}
                ${showBottomNav ? this.renderBottomNav() : ''}
            </main>
        `;

        const viewId = this.currentPage === 'chat' && this.activeDirectMessageId
            ? 'xapp-dm'
            : `xapp-${this.currentPage}`;
        this.app.phoneShell.setContent(html, viewId);
        const root = document.querySelector(`.phone-view-current .xapp-root[data-page="${this.currentPage}"]`)
            || document.querySelector(`[data-view-id="${viewId}"] .xapp-root`);
        this.bindEvents(root);
    }

    renderHome() {
        const displayAvatar = this._getXDisplayAvatar();
        return `
            <section class="xapp-page xapp-home-page" aria-label="X 首页">
                <div class="xapp-top-glass">
                    <header class="xapp-topbar">
                        <button class="xapp-avatar-button" type="button" aria-label="个人资料">
                            <img class="xapp-avatar xapp-avatar-user" src="${this._escapeAttr(displayAvatar)}" alt="">
                        </button>
                        <div class="xapp-logo" aria-label="X">𝕏</div>
                        <div class="xapp-topbar-spacer" aria-hidden="true"></div>
                    </header>

                    <nav class="xapp-feed-tabs" aria-label="信息流分类">
                        <button class="xapp-feed-tab ${this.currentFeed === 'for-you' ? 'is-active' : ''}" type="button" data-feed="for-you">为你推荐</button>
                        <button class="xapp-feed-tab ${this.currentFeed === 'following' ? 'is-active' : ''}" type="button" data-feed="following">正在关注</button>
                    </nav>
                </div>

                <div class="xapp-feed-scroll">
                    <div id="xapp-pull-refresh-indicator" class="xapp-pull-refresh-indicator" aria-live="polite">
                        <div id="xapp-pull-refresh-inner" class="xapp-pull-refresh-inner"></div>
                    </div>
                    <div class="xapp-feed-list">
                        ${this.currentFeed === 'following' ? this.renderFollowingFeed() : this.renderForYouFeed()}
                    </div>
                </div>

                <button class="xapp-compose-button" type="button" aria-label="发布帖子">
                    <i class="fa-regular fa-pen-to-square" aria-hidden="true"></i>
                </button>
            </section>
        `;
    }

    renderForYouFeed() {
        const userPosts = this.app.xData.getUserPosts().filter((post) => (
            this._visibleUserPostIds.has(String(post?.id || ''))
        ));
        const feedPosts = this.app.xData.getPosts();
        if (!userPosts.length && !feedPosts.length) {
            return `
                <div class="xapp-feed-empty xapp-feed-empty-for-you">
                    <div class="xapp-feed-empty-icon"><i class="fa-regular fa-image"></i></div>
                    <strong>还没有帖子</strong>
                    <span>在页面顶部下拉，即可请求新的 X 帖子。</span>
                </div>
            `;
        }
        return [
            ...userPosts.map((post) => this.renderFeedPost(post, { source: 'user' })),
            ...feedPosts.map((post) => this.renderFeedPost(post, { source: 'feed' }))
        ].join('');
    }

    renderFeedPost(post, { source = 'feed' } = {}) {
        const safeId = this._escapeAttr(post.id);
        const author = this._resolvePostAuthor(post);
        return `
            <article class="xapp-post" data-post-id="${safeId}" data-post-source="${this._escapeAttr(source)}" tabindex="0" aria-label="查看 ${this._escapeAttr(author.name || '用户')} 的帖子">
                ${this.renderPostAvatar(author)}
                <div class="xapp-post-main">
                    <header class="xapp-post-header">
                        ${this.renderFeedIdentity(post, author)}
                        <div class="xapp-post-side">
                            ${post.promoted ? '<span class="xapp-promoted-label">广告</span>' : ''}
                            ${post.isUserPost
                                ? `<button class="xapp-delete-post-button" type="button" data-post-id="${safeId}" data-post-source="${this._escapeAttr(source)}" aria-label="删除帖子"><i class="fa-regular fa-trash-can"></i></button>`
                                : `<button class="xapp-more-button" type="button" data-post-id="${safeId}" data-post-source="${this._escapeAttr(source)}" aria-label="更多"><i class="fa-solid fa-ellipsis"></i></button>`}
                        </div>
                    </header>
                    <div class="xapp-post-copy">${this._renderText(post.content)}</div>
                    ${this.renderMedia(post, { source })}
                    ${this.renderPostActions(post, false, source)}
                </div>
            </article>
        `;
    }

    renderCompose() {
        const profile = this.app.xData.getProfile();
        const displayAvatar = this._getXDisplayAvatar(profile);
        const nickname = this._getXDisplayName(profile);
        return `
            <section class="xapp-page xapp-compose-page" aria-label="发布帖子">
                <header class="xapp-compose-header">
                    <button class="xapp-compose-back" type="button" aria-label="返回">
                        <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                    </button>
                    <h1>发布帖子</h1>
                    <button class="xapp-compose-publish" type="button" disabled>发布</button>
                </header>

                <div class="xapp-compose-scroll">
                    <div class="xapp-compose-author">
                        <img class="xapp-compose-avatar" src="${this._escapeAttr(displayAvatar)}" alt="">
                        <div>
                            <strong>${this._escapeHtml(nickname)}</strong>
                            <span>公开</span>
                        </div>
                    </div>

                    <textarea id="xapp-compose-text" class="xapp-compose-text" maxlength="280" placeholder="有什么新鲜事？" autocomplete="off"></textarea>
                    <div class="xapp-compose-meta"><span id="xapp-compose-count">0</span>/280</div>
                    <div id="xapp-compose-preview" class="xapp-compose-preview">${this.renderComposeImagePreview()}</div>

                    <input id="xapp-compose-image-input" class="xapp-compose-image-input" type="file" accept="image/png, image/jpeg, image/gif, image/webp, image/*" multiple>
                    <button class="xapp-compose-add-image" type="button">
                        <i class="fa-regular fa-image" aria-hidden="true"></i>
                        <span>添加图片</span>
                        <small>最多 4 张</small>
                    </button>
                    <button class="xapp-compose-add-text-image" type="button">
                        <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
                        <span>文字图片</span>
                        <small>最多 4 张</small>
                    </button>
                </div>
            </section>
        `;
    }

    renderComposeImagePreview() {
        const images = Array.isArray(this.pendingComposeImages) ? this.pendingComposeImages : [];
        return images.map((image, index) => `
            <div class="xapp-compose-preview-item">
                <img src="${this._escapeAttr(image)}" alt="待发布图片 ${index + 1}">
                <button class="xapp-compose-remove-image" type="button" data-image-index="${index}" aria-label="移除第 ${index + 1} 张图片">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
            </div>
        `).join('');
    }

    _countComposeTextImages(rawText = '') {
        const mediaRegex = /\[(?:用户照片|个人图片|图片(?:-[^\]\r\n]+)?|视频)\]\s*[（(]\s*([^)）]+?)\s*[)）](?:\s*[（(]\s*([^)）]+?)\s*[)）])?/g;
        return (String(rawText || '').match(mediaRegex) || []).length;
    }

    _insertComposeTextImageTemplate(textarea) {
        if (!textarea) return false;
        const uploadedCount = Array.isArray(this.pendingComposeImages) ? this.pendingComposeImages.length : 0;
        const textImageCount = this._countComposeTextImages(textarea.value);
        if (uploadedCount + textImageCount >= 4) {
            this.app.phoneShell.showNotification?.('X', '上传图片和文字图片合计最多 4 张', '×');
            return false;
        }

        const template = '[图片]（输入描述）';
        const selectionStart = Number.isInteger(textarea.selectionStart) ? textarea.selectionStart : textarea.value.length;
        const selectionEnd = Number.isInteger(textarea.selectionEnd) ? textarea.selectionEnd : selectionStart;
        const before = textarea.value.slice(0, selectionStart);
        const after = textarea.value.slice(selectionEnd);
        const prefix = before && !before.endsWith('\n') ? '\n' : '';
        const suffix = after && !after.startsWith('\n') ? '\n' : '';
        const insertion = `${prefix}${template}${suffix}`;

        if (typeof textarea.setRangeText === 'function') {
            textarea.setRangeText(insertion, selectionStart, selectionEnd, 'end');
        } else {
            textarea.value = `${before}${insertion}${after}`;
        }

        const placeholderStart = selectionStart + prefix.length + '[图片]（'.length;
        textarea.focus?.();
        textarea.setSelectionRange?.(placeholderStart, placeholderStart + '输入描述'.length);
        textarea.dispatchEvent?.(new Event('input', { bubbles: true }));
        return true;
    }

    renderFeedIdentity(post, resolvedAuthor = null) {
        const author = resolvedAuthor || this._resolvePostAuthor(post);
        return `
            <div class="xapp-post-identity">
                <strong>${this._escapeHtml(author.name || 'X 用户')}</strong>
                ${this.renderVerified(author.accountType || author.verified)}
                ${post.time ? `<span class="xapp-post-time">· ${this._escapeHtml(post.time)}</span>` : ''}
            </div>
        `;
    }

    renderPostAvatar(author = {}, extraClass = '') {
        if (author.avatar === 'brand') {
            return `<div class="xapp-post-avatar xapp-brand-avatar ${extraClass}" aria-hidden="true">𝕏</div>`;
        }

        const avatar = String(author.avatar || '').trim();
        if (avatar === 'profile') {
            return `<img class="xapp-post-avatar ${extraClass}" src="${this._escapeAttr(this._getXDisplayAvatar())}" alt="">`;
        }

        const avatarSource = AVATAR_SOURCES[avatar] || this._normalizeWechatAvatarPath(avatar);
        if (avatarSource) {
            return `<img class="xapp-post-avatar ${extraClass}" src="${this._escapeAttr(avatarSource)}" alt="">`;
        }

        if (author.avatarText) {
            const tone = ['rose', 'sky', 'mint', 'violet', 'amber'].includes(author.avatarTone)
                ? author.avatarTone
                : 'sky';
            return `<div class="xapp-post-avatar xapp-generated-avatar xapp-generated-avatar-${tone} ${extraClass}" aria-hidden="true">${this._escapeHtml(author.avatarText)}</div>`;
        }

        return `<img class="xapp-post-avatar ${extraClass}" src="${this._escapeAttr(PROFILE_AVATAR)}" alt="">`;
    }

    renderVerified(type) {
        const normalizedType = {
            blue: 'official',
            official: 'official',
            '官方': 'official',
            gold: 'advertiser',
            ad: 'advertiser',
            advertiser: 'advertiser',
            '广告': 'advertiser',
            personal: 'personal',
            individual: 'personal',
            '个人': 'personal'
        }[String(type || '').toLowerCase()];

        if (normalizedType !== 'official' && normalizedType !== 'advertiser') return '';
        const label = normalizedType === 'official' ? '官方认证' : '广告认证';
        return `<span class="xapp-verified xapp-verified-${normalizedType}" aria-label="${label}"><i class="fa-solid fa-circle-check" aria-hidden="true"></i></span>`;
    }

    renderMedia(post, { source = 'feed' } = {}) {
        const images = Array.isArray(post.images) ? post.images.slice(0, 4) : [];
        if (images.length > 0) {
            const safePostId = this._escapeAttr(post.id);
            const safeSource = this._escapeAttr(source);
            return `
                <div class="xapp-post-images xapp-image-grid-${images.length}" data-xapp-media-post-id="${safePostId}" data-xapp-media-source="${safeSource}">
                    ${images.map((image, index) => {
                        const state = this._getXPostImageState(post, index);
                        const parsed = this._parseXImageItem(image, state);
                        const description = parsed.description || '帖子配图';
                        const prompt = parsed.prompt || description;
                        const status = parsed.realUrl ? 'done' : (String(state?.status || '').trim() || 'idle');
                        const statusText = status === 'loading'
                            ? '正在生成...'
                            : status === 'failed'
                                ? '生成失败，点击重试'
                                : '生成图片';
                        const statusIcon = status === 'loading'
                            ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>'
                            : '<i class="fa-regular fa-image" aria-hidden="true"></i>';
                        const backPanel = `
                            <div class="xapp-image-back is-hidden">
                                <div class="xapp-image-description">
                                    <strong>画面描述</strong>
                                    <span>${this._escapeHtml(description)}</span>
                                    <strong>英文 Tag</strong>
                                    <span>${this._escapeHtml(prompt)}</span>
                                </div>
                                <button class="xapp-image-restore" type="button" aria-label="返回图片"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
                            </div>
                        `;

                        if (parsed.realUrl) {
                            const isRegenerating = state?.status === 'loading';
                            const regenerateButton = prompt ? `
                                <button class="xapp-image-regenerate" type="button"
                                    data-post-id="${safePostId}"
                                    data-post-source="${safeSource}"
                                    data-image-index="${index}"
                                    data-image-prompt="${this._escapeAttr(prompt)}"
                                    data-image-description="${this._escapeAttr(description)}"
                                    aria-label="重新生成图片"
                                    ${isRegenerating ? 'disabled' : ''}>
                                    <i class="fa-solid ${isRegenerating ? 'fa-spinner fa-spin' : 'fa-rotate'}" aria-hidden="true"></i>
                                </button>
                            ` : '';
                            return `
                                <div class="xapp-image-card">
                                    <div class="xapp-image-front">
                                        <button class="xapp-image-open" type="button" aria-label="查看帖子图片">
                                            <img class="xapp-post-image-real" src="${this._escapeAttr(parsed.realUrl)}" alt="${this._escapeAttr(description)}">
                                        </button>
                                        ${regenerateButton}
                                        <button class="xapp-image-info" type="button" aria-label="查看图片描述">描述</button>
                                    </div>
                                    ${backPanel}
                                </div>
                            `;
                        }

                        return `
                            <div class="xapp-image-card ${status === 'failed' ? 'is-failed' : ''}">
                                <div class="xapp-image-front xapp-image-placeholder">
                                    <button class="xapp-image-generate" type="button"
                                        data-post-id="${safePostId}"
                                        data-post-source="${safeSource}"
                                        data-image-index="${index}"
                                        data-image-prompt="${this._escapeAttr(prompt)}"
                                        data-image-description="${this._escapeAttr(description)}"
                                        ${status === 'loading' ? 'disabled' : ''}>
                                        <span class="xapp-image-generate-icon">${statusIcon}</span>
                                        <span>${statusText}</span>
                                        ${status === 'failed' && state?.error ? `<small>${this._escapeHtml(state.error)}</small>` : ''}
                                    </button>
                                    <button class="xapp-image-info" type="button" aria-label="查看图片描述">描述</button>
                                </div>
                                ${backPanel}
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        if (post.media?.type !== 'promo') return '';

        return `
            <div class="xapp-media-card xapp-media-card-dark" aria-label="广告视频预览">
                <div class="xapp-media-kicker">${this._escapeHtml(post.media.kicker || '')}</div>
                <div class="xapp-media-title">${this._escapeHtml(post.media.title || '')}</div>
                <div class="xapp-media-footer">
                    <span>${this._escapeHtml(post.media.duration || '')}</span>
                    <span><i class="fa-solid fa-volume-xmark"></i></span>
                </div>
            </div>
        `;
    }

    renderFollowingFeed() {
        const followedAccounts = this.app.xData.getFollowedAccounts();
        const followedPosts = this.app.xData.getFollowingPosts();
        const accountList = followedAccounts.length > 0 ? `
            <section class="xapp-following-accounts" aria-label="正在关注的账号">
                <div class="xapp-following-accounts-heading">
                    <strong>正在关注</strong>
                    <span>${followedAccounts.length}</span>
                </div>
                <div class="xapp-following-account-list">
                    ${followedAccounts.map((account) => `
                        <div class="xapp-following-account">
                            ${this.renderDirectMessageAvatar(account, 'xapp-following-account-avatar')}
                            <span class="xapp-following-account-name">${this._escapeHtml(account.name || 'X 用户')}</span>
                            ${this.renderVerified(account.accountType)}
                        </div>
                    `).join('')}
                </div>
            </section>
        ` : '';
        if (followedPosts.length > 0) {
            return `${accountList}${followedPosts
                .map((post) => this.renderFeedPost(post, { source: 'following' }))
                .join('')}`;
        }
        return `
            ${accountList}
            <div class="xapp-feed-empty">
                <div class="xapp-feed-empty-icon"><i class="fa-regular fa-user"></i></div>
                <strong>${followedAccounts.length > 0 ? '还没有关注账号的帖子' : '关注内容会显示在这里'}</strong>
                <span>${followedAccounts.length > 0 ? '刷新推荐页后，新帖子也会保留在这里。' : '关注用户后，他们的帖子会出现在这里。'}</span>
            </div>
        `;
    }

    renderProfile() {
        const profile = this.app.xData.getProfile();
        const nickname = this._getXDisplayName(profile);
        const displayAvatar = this._getXDisplayAvatar(profile);
        const userPosts = this.app.xData.getUserPosts();

        return `
            <section class="xapp-page xapp-profile-page" aria-label="X 个人资料">
                <header class="xapp-profile-header">
                    <button class="xapp-profile-back" type="button" aria-label="返回">
                        <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                    </button>
                    <h1>个人资料</h1>
                    <button class="xapp-profile-settings-button" type="button" aria-label="X 设置">
                        <i class="fa-solid fa-gear" aria-hidden="true"></i>
                    </button>
                </header>

                <div class="xapp-profile-scroll">
                    <div class="xapp-profile-cover" aria-hidden="true"></div>
                    <section class="xapp-profile-summary">
                        <div class="xapp-profile-avatar-row">
                            <label class="xapp-profile-avatar-button" for="xapp-profile-avatar-upload" aria-label="更换头像">
                                <img class="xapp-profile-avatar" src="${this._escapeAttr(displayAvatar)}" alt="">
                                <span class="xapp-profile-avatar-edit" aria-hidden="true"><i class="fa-solid fa-camera"></i></span>
                            </label>
                            <input id="xapp-profile-avatar-upload" class="xapp-profile-avatar-input" type="file" accept="image/png, image/jpeg, image/gif, image/webp, image/*">
                        </div>
                        <div class="xapp-profile-name-row">
                            <h2 class="xapp-profile-name-text">${this._escapeHtml(nickname)}</h2>
                            <button class="xapp-profile-edit-button" type="button" aria-label="编辑个人资料">
                                <i class="fa-regular fa-pen-to-square" aria-hidden="true"></i>
                            </button>
                        </div>
                        <div class="xapp-profile-stats" aria-label="账号数据">
                            <span><strong data-xapp-profile-stat="following">${this._formatCount(profile.following)}</strong> 关注</span>
                            <span><strong data-xapp-profile-stat="followers">${this._formatCount(profile.followers)}</strong> 粉丝</span>
                        </div>
                    </section>

                    <div class="xapp-profile-tabs" role="tablist" aria-label="个人资料内容">
                        <div class="xapp-profile-tab is-active" role="tab" aria-selected="true">帖子</div>
                    </div>

                    <div class="xapp-profile-posts">
                        ${userPosts.length
                            ? userPosts.map((post) => this.renderFeedPost(post, { source: 'user' })).join('')
                            : `
                                <div class="xapp-profile-empty">
                                    <strong>还没有发布帖子</strong>
                                    <span>你发布的内容会显示在这里。</span>
                                </div>
                            `}
                    </div>
                </div>

                <div class="xapp-profile-edit-overlay is-hidden" role="dialog" aria-modal="true" aria-labelledby="xapp-profile-edit-title">
                    <form class="xapp-profile-edit-dialog" id="xapp-profile-edit-form">
                        <header class="xapp-profile-edit-header">
                            <h2 id="xapp-profile-edit-title">编辑资料</h2>
                            <button class="xapp-profile-edit-close" type="button" aria-label="关闭">
                                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                            </button>
                        </header>
                        <label class="xapp-profile-edit-field">
                            <span>昵称</span>
                            <input id="xapp-profile-edit-nickname" type="text" maxlength="30" value="${this._escapeAttr(nickname)}" autocomplete="off">
                        </label>
                        <div class="xapp-profile-edit-counts">
                            <label class="xapp-profile-edit-field">
                                <span>关注</span>
                                <input id="xapp-profile-edit-following" type="number" min="0" step="1" inputmode="numeric" value="${this._escapeAttr(profile.following)}">
                            </label>
                            <label class="xapp-profile-edit-field">
                                <span>粉丝</span>
                                <input id="xapp-profile-edit-followers" type="number" min="0" step="1" inputmode="numeric" value="${this._escapeAttr(profile.followers)}">
                            </label>
                        </div>
                        <footer class="xapp-profile-edit-actions">
                            <button class="xapp-profile-edit-cancel" type="button">取消</button>
                            <button class="xapp-profile-edit-save" type="submit">保存</button>
                        </footer>
                    </form>
                </div>
            </section>
        `;
    }

    renderSettings() {
        const runtime = typeof window !== 'undefined' ? window.VirtualPhone : null;
        const promptManager = runtime?.promptManager;
        const worldbookManager = runtime?.worldbookManager;
        promptManager?.ensureLoaded?.();
        const defaultPrompts = promptManager?.getDefaultPrompts?.() || {};
        const overrideConfig = promptManager?.prompts?.x?.override
            || defaultPrompts?.x?.override
            || {};
        const overridePrompt = promptManager?.getPromptForFeature?.('x', 'override')
            || overrideConfig.content
            || '';
        const prompt = promptManager?.getPromptForFeature?.('x', 'feed') || '';
        const useWorldbook = worldbookManager?.getEnabled?.('x') ?? true;
        const contextSettings = this.app.xData.getGenerationContextSettings();

        return `
            <section class="xapp-page xapp-settings-page" aria-label="X 设置">
                <header class="xapp-settings-header">
                    <button class="xapp-settings-back" type="button" aria-label="返回个人资料">
                        <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                    </button>
                    <h1>X 设置</h1>
                    <div class="xapp-settings-header-spacer" aria-hidden="true"></div>
                </header>

                <div class="xapp-settings-scroll">
                    <section class="xapp-settings-section">
                        <h2>生成上下文</h2>
                        <div class="xapp-settings-toggle-row">
                            <div class="xapp-settings-row-copy">
                                <strong>注入角色卡与用户信息</strong>
                                <span>开启后提供当前角色卡、用户 Persona 和 X 账号资料；默认关闭。</span>
                            </div>
                            <label class="xapp-settings-toggle" aria-label="注入角色卡与用户信息">
                                <input id="xapp-include-character-user" class="xapp-settings-toggle-input" type="checkbox" role="switch" ${contextSettings.includeCharacterUser ? 'checked' : ''}>
                                <span class="xapp-settings-toggle-track" aria-hidden="true"></span>
                            </label>
                        </div>

                        <div class="xapp-settings-toggle-row">
                            <div class="xapp-settings-row-copy">
                                <strong>注入酒馆正文内容</strong>
                                <span>开启后提供最近的酒馆正文作为公开信息流参考；默认关闭。</span>
                            </div>
                            <label class="xapp-settings-toggle" aria-label="注入酒馆正文内容">
                                <input id="xapp-include-tavern-text" class="xapp-settings-toggle-input" type="checkbox" role="switch" ${contextSettings.includeTavernText ? 'checked' : ''}>
                                <span class="xapp-settings-toggle-track" aria-hidden="true"></span>
                            </label>
                        </div>

                        <div class="xapp-settings-toggle-row">
                            <div class="xapp-settings-row-copy">
                                <strong>使用酒馆世界书</strong>
                                <span>生成 X 内容时注入下方勾选的世界书，选择状态跟随当前角色卡。</span>
                            </div>
                            <label class="xapp-settings-toggle" aria-label="使用酒馆世界书">
                                <input id="xapp-use-worldbook" class="xapp-settings-toggle-input" type="checkbox" role="switch" ${useWorldbook ? 'checked' : ''}>
                                <span class="xapp-settings-toggle-track" aria-hidden="true"></span>
                            </label>
                        </div>

                        <details class="xapp-settings-fold xapp-settings-worldbook-fold">
                            <summary class="xapp-settings-fold-trigger">
                                <span class="xapp-settings-fold-copy">
                                    <strong>世界书选择</strong>
                                    <span>展开后勾选要注入 X 内容生成的酒馆世界书</span>
                                </span>
                                <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                            </summary>
                            <div class="xapp-settings-fold-content">
                                <div id="xapp-worldbook-list" class="xapp-settings-worldbook-list">
                                    <div class="xapp-settings-status">正在读取当前可用世界书...</div>
                                </div>
                            </div>
                        </details>
                    </section>

                    <section class="xapp-settings-section xapp-settings-prompt-section">
                        <h2>生成提示词</h2>
                        <details class="xapp-settings-fold">
                            <summary class="xapp-settings-fold-trigger">
                                <span class="xapp-settings-fold-copy">
                                    <strong>${this._escapeHtml(overrideConfig.name || '🧩 X 破限词')}</strong>
                                    <span>${this._escapeHtml(overrideConfig.description || 'X 推荐流请求开头优先注入')}</span>
                                </span>
                                <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                            </summary>
                            <div class="xapp-settings-fold-content">
                                ${promptManager?.renderPromptPresetControls?.('x', 'override') || ''}
                                <textarea id="xapp-override-prompt" class="xapp-settings-prompt" placeholder="X 破限提示词...">${this._escapeHtml(overridePrompt)}</textarea>
                                <button id="xapp-reset-override-prompt" class="xapp-settings-reset-prompt" type="button">
                                    <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
                                    <span>恢复默认</span>
                                </button>
                            </div>
                        </details>

                        <details class="xapp-settings-fold">
                            <summary class="xapp-settings-fold-trigger">
                                <span class="xapp-settings-fold-copy">
                                    <strong>默认提示词</strong>
                                    <span>展开后编辑 X 信息流的内容生成规则</span>
                                </span>
                                <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                            </summary>
                            <div class="xapp-settings-fold-content">
                                ${promptManager?.renderPromptPresetControls?.('x', 'feed') || ''}
                                <textarea id="xapp-feed-prompt" class="xapp-settings-prompt" placeholder="X 内容生成提示词...">${this._escapeHtml(prompt)}</textarea>
                                <button id="xapp-reset-feed-prompt" class="xapp-settings-reset-prompt" type="button">
                                    <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
                                    <span>恢复默认</span>
                                </button>
                            </div>
                        </details>
                    </section>
                </div>
            </section>
        `;
    }

    renderPostActions(post, detail = false, source = 'feed') {
        const safeId = this._escapeAttr(post.id);
        const safeSource = this._escapeAttr(source);
        const detailClass = detail ? ' xapp-post-actions-detail' : '';
        const liked = post.likedByUser === true;
        const likedClass = liked ? ' is-liked' : '';
        const heartClass = liked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
        return `
            <footer class="xapp-post-actions${detailClass}">
                <button class="xapp-post-action xapp-comment-action" type="button" data-post-id="${safeId}" aria-label="查看回复">
                    <i class="fa-regular fa-comment"></i><span data-xapp-comment-count>${this._formatCount(post.comments)}</span>
                </button>
                <button class="xapp-post-action xapp-like-action${likedClass}" type="button" data-post-id="${safeId}" data-post-source="${safeSource}" aria-label="${liked ? '取消喜欢' : '喜欢'}" aria-pressed="${liked}">
                    <i class="${heartClass}" aria-hidden="true"></i><span data-xapp-like-count>${this._formatCount(post.likes)}</span>
                </button>
                <button class="xapp-post-action xapp-post-action-share" type="button" data-post-id="${safeId}" aria-label="转发到微信">
                    <i class="fa-regular fa-paper-plane"></i>
                </button>
            </footer>
        `;
    }

    renderPostDetail() {
        const post = this.app.xData.getPost(this.currentPostId, this.currentPostSource);
        if (!post) return '';

        const author = this._resolvePostAuthor(post);
        const displayAvatar = this._getXDisplayAvatar();
        return `
            <section class="xapp-page xapp-detail-page" aria-label="帖子详情">
                <header class="xapp-detail-header">
                    <button class="xapp-detail-back" type="button" aria-label="返回">
                        <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                    </button>
                    <h1>帖子</h1>
                    <div class="xapp-detail-header-spacer" aria-hidden="true"></div>
                </header>

                <div class="xapp-detail-scroll">
                    <article class="xapp-detail-post">
                        <header class="xapp-detail-author-row">
                            ${this.renderPostAvatar(author, 'xapp-detail-avatar')}
                            <div class="xapp-detail-author">
                                <div class="xapp-detail-author-name">
                                    <strong>${this._escapeHtml(author.name || 'X 用户')}</strong>
                                    ${this.renderVerified(author.accountType || author.verified)}
                                </div>
                            </div>
                            ${post.isUserPost
                                ? `<button class="xapp-delete-post-button" type="button" data-post-id="${this._escapeAttr(post.id)}" data-post-source="${this._escapeAttr(this.currentPostSource)}" aria-label="删除帖子"><i class="fa-regular fa-trash-can"></i></button>`
                                : `<button class="xapp-more-button" type="button" data-post-id="${this._escapeAttr(post.id)}" data-post-source="${this._escapeAttr(this.currentPostSource)}" aria-label="更多"><i class="fa-solid fa-ellipsis"></i></button>`}
                        </header>

                        <div class="xapp-detail-copy">${this._renderText(post.content)}</div>
                        ${this.renderMedia(post, { source: this.currentPostSource })}
                        <div class="xapp-detail-time">${this._escapeHtml(post.time || '刚刚')}</div>
                        <div class="xapp-detail-stats">
                            <span><strong data-xapp-comment-count>${this._formatCount(post.comments)}</strong> 回复</span>
                            <span><strong data-xapp-like-count>${this._formatCount(post.likes)}</strong> 喜欢</span>
                        </div>
                        ${this.renderPostActions(post, true, this.currentPostSource)}
                    </article>

                    <section class="xapp-thread-section" aria-label="帖子回复">
                        <h2>回复</h2>
                        <div class="xapp-comments" id="xapp-comments">
                            ${this.renderComments(post)}
                        </div>
                        <div class="xapp-load-more-comments-wrap">
                            <button class="xapp-load-more-comments" type="button" data-post-id="${this._escapeAttr(post.id)}" data-post-source="${this._escapeAttr(this.currentPostSource)}">
                                <i class="fa-regular fa-comment-dots" aria-hidden="true"></i>
                                <span>加载更多回复...</span>
                            </button>
                        </div>
                    </section>
                </div>

                <div class="xapp-reply-composer">
                    <div class="xapp-reply-context is-hidden" id="xapp-reply-context">
                        <span id="xapp-reply-context-text"></span>
                        <button class="xapp-reply-cancel" type="button" aria-label="取消回复某人"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div class="xapp-reply-row">
                        <img class="xapp-reply-avatar" src="${this._escapeAttr(displayAvatar)}" alt="">
                        <input id="xapp-reply-input" class="xapp-reply-input" type="text" maxlength="280" placeholder="发布你的回复" autocomplete="off">
                        <button id="xapp-reply-send" class="xapp-reply-send" type="button" disabled>回复</button>
                    </div>
                </div>
            </section>
        `;
    }

    renderComments(post) {
        const threads = this.app.xData.getCommentThreads(post);
        if (!threads.length) {
            return `
                <div class="xapp-comments-empty">
                    <strong>还没有回复</strong>
                    <span>成为第一个回复这条帖子的人。</span>
                </div>
            `;
        }

        return threads.map((comment) => `
            <article class="xapp-comment" data-comment-id="${this._escapeAttr(comment.id)}">
                ${this.renderCommentAvatar(comment)}
                <div class="xapp-comment-main">
                    ${this.renderCommentContent(comment, post)}
                    ${comment.replies.length ? `
                        <div class="xapp-comment-replies">
                            ${comment.replies.map((reply) => `
                                <article class="xapp-comment xapp-comment-nested" data-comment-id="${this._escapeAttr(reply.id)}">
                                    ${this.renderCommentAvatar(reply)}
                                    <div class="xapp-comment-main">${this.renderCommentContent(reply, post)}</div>
                                </article>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            </article>
        `).join('');
    }

    renderCommentContent(comment, post) {
        const replyTargetName = this._getReplyTargetName(post, comment.replyTo);
        return `
            <header class="xapp-comment-header">
                <strong>${this._escapeHtml(comment.name || 'X 用户')}</strong>
                <span>· ${this._escapeHtml(comment.time || '刚刚')}</span>
            </header>
            ${replyTargetName ? `<div class="xapp-comment-replying">回复 <span>${this._escapeHtml(replyTargetName)}</span></div>` : ''}
            <div class="xapp-comment-text">${this._renderText(comment.text)}</div>
            <div class="xapp-comment-actions">
                <button class="xapp-comment-reply" type="button" data-comment-id="${this._escapeAttr(comment.id)}" aria-label="回复 ${this._escapeAttr(comment.name || '该用户')}">
                    <i class="fa-regular fa-comment"></i><span>回复</span>
                </button>
                <button class="xapp-comment-like" type="button" aria-label="喜欢">
                    <i class="fa-regular fa-heart"></i>${Number(comment.likes) > 0 ? `<span>${this._formatCount(comment.likes)}</span>` : ''}
                </button>
            </div>
        `;
    }

    renderCommentAvatar(comment) {
        if (comment.avatar === 'profile') {
            return `<img class="xapp-comment-avatar" src="${this._escapeAttr(this._getXDisplayAvatar())}" alt="">`;
        }

        const text = String(comment.avatarText || comment.name || 'X').trim().charAt(0).toUpperCase();
        const tone = ['rose', 'sky', 'mint', 'violet', 'amber'].includes(comment.avatarTone)
            ? comment.avatarTone
            : 'sky';
        return `<div class="xapp-comment-avatar xapp-comment-avatar-${tone}" aria-hidden="true">${this._escapeHtml(text)}</div>`;
    }

    renderChat() {
        if (this.activeDirectMessageId) {
            const activeThread = this.app.xData.getDirectMessageThread(this.activeDirectMessageId);
            if (activeThread) return this.renderDirectMessage(activeThread);
            this.activeDirectMessageId = null;
        }

        const displayAvatar = this._getXDisplayAvatar();
        const threads = this.app.xData.getDirectMessageThreads();
        return `
            <section class="xapp-page xapp-chat-page" aria-label="X 聊天">
                <header class="xapp-chat-header">
                    <img class="xapp-avatar xapp-avatar-user" src="${this._escapeAttr(displayAvatar)}" alt="">
                    <h1>Chat</h1>
                    <div class="xapp-chat-header-spacer" aria-hidden="true"></div>
                </header>

                ${threads.length > 0 ? `
                    <div class="xapp-chat-list" aria-label="私信列表">
                        ${threads.map((thread) => this.renderDirectMessageListItem(thread)).join('')}
                    </div>
                ` : `
                    <div class="xapp-chat-empty">
                        <div class="xapp-chat-empty-icon"><i class="fa-regular fa-comment"></i></div>
                        <h2>还没有私信</h2>
                        <p>从帖子右上角的更多菜单发起私信</p>
                    </div>
                `}
            </section>
        `;
    }

    renderDirectMessageListItem(thread = {}) {
        const participant = thread.participant || {};
        const lastMessage = Array.isArray(thread.messages) ? thread.messages.at(-1) : null;
        return `
            <button class="xapp-chat-thread" type="button" data-thread-id="${this._escapeAttr(thread.id)}">
                ${this.renderDirectMessageAvatar(participant, 'xapp-chat-thread-avatar')}
                <span class="xapp-chat-thread-main">
                    <span class="xapp-chat-thread-heading">
                        <strong>${this._escapeHtml(participant.name || 'X 用户')}</strong>
                        ${this.renderVerified(participant.accountType)}
                        <time>${this._escapeHtml(this._formatDirectMessageTime(thread.updatedAt))}</time>
                    </span>
                    <span class="xapp-chat-thread-preview">${this._renderText(lastMessage?.text || '开始一段私信')}</span>
                </span>
                <i class="fa-solid fa-chevron-right xapp-chat-thread-chevron" aria-hidden="true"></i>
            </button>
        `;
    }

    renderDirectMessage(thread = {}) {
        const participant = thread.participant || {};
        return `
            <section class="xapp-page xapp-dm-page" aria-label="与 ${this._escapeAttr(participant.name || 'X 用户')} 的私信">
                <header class="xapp-dm-header">
                    <button class="xapp-dm-back" type="button" aria-label="返回私信列表">
                        <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                    </button>
                    ${this.renderDirectMessageAvatar(participant, 'xapp-dm-header-avatar')}
                    <div class="xapp-dm-header-copy">
                        <span>
                            <strong>${this._escapeHtml(participant.name || 'X 用户')}</strong>
                            ${this.renderVerified(participant.accountType)}
                        </span>
                        <small>私信</small>
                    </div>
                </header>

                <div class="xapp-dm-messages" id="xapp-dm-messages" aria-live="polite">
                    ${this.renderDirectMessageMessages(thread)}
                </div>

                <div class="xapp-dm-composer">
                    <input id="xapp-dm-input" class="xapp-dm-input" type="text" maxlength="500" placeholder="输入消息" autocomplete="off">
                    <button id="xapp-dm-send" class="xapp-dm-send" type="button" disabled>发送</button>
                </div>
            </section>
        `;
    }

    renderDirectMessageMessages(thread = {}) {
        const messages = Array.isArray(thread.messages) ? thread.messages : [];
        const empty = messages.length === 0 ? `
            <div class="xapp-dm-empty">
                ${this.renderDirectMessageAvatar(thread.participant || {}, 'xapp-dm-empty-avatar')}
                <strong>${this._escapeHtml(thread.participant?.name || 'X 用户')}</strong>
                <span>发送第一条私信</span>
            </div>
        ` : '';
        const messageHtml = messages.map((message) => `
            <div class="xapp-dm-message-row ${message.from === 'them' ? 'is-them' : 'is-me'}" data-message-id="${this._escapeAttr(message.id)}">
                <div class="xapp-dm-bubble">${this._renderText(message.text)}</div>
                <time>${this._escapeHtml(this._formatDirectMessageTime(message.timestamp, message.time))}</time>
            </div>
        `).join('');
        const typing = this._sendingDirectMessageThreadIds.has(thread.id) ? `
            <div class="xapp-dm-message-row is-them xapp-dm-typing" aria-label="对方正在回复">
                <div class="xapp-dm-bubble"><span></span><span></span><span></span></div>
            </div>
        ` : '';
        return `${empty}${messageHtml}${typing}`;
    }

    renderDirectMessageAvatar(participant = {}, extraClass = '') {
        const avatar = String(participant.avatar || '').trim();
        if (avatar && !['profile', 'brand'].includes(avatar)) {
            const source = AVATAR_SOURCES[avatar] || avatar;
            return `<img class="xapp-dm-avatar ${extraClass}" src="${this._escapeAttr(source)}" alt="">`;
        }
        if (avatar === 'brand') {
            return `<div class="xapp-dm-avatar xapp-dm-brand-avatar ${extraClass}" aria-hidden="true">𝕏</div>`;
        }
        const tone = ['rose', 'sky', 'mint', 'violet', 'amber'].includes(participant.avatarTone)
            ? participant.avatarTone
            : 'sky';
        const text = String(participant.avatarText || participant.name || 'X').trim().slice(0, 1).toUpperCase() || 'X';
        return `<div class="xapp-dm-avatar xapp-generated-avatar xapp-generated-avatar-${tone} ${extraClass}" aria-hidden="true">${this._escapeHtml(text)}</div>`;
    }

    renderBottomNav() {
        return `
            <nav class="xapp-bottom-nav" aria-label="X 主导航">
                <button class="xapp-bottom-item ${this.currentPage === 'home' ? 'is-active' : ''}" type="button" data-page="home" aria-label="首页">
                    <i class="fa-solid fa-house xapp-home-icon"></i>
                </button>
                <button class="xapp-bottom-item ${this.currentPage === 'chat' ? 'is-active' : ''}" type="button" data-page="chat" aria-label="聊天">
                    <i class="${this.currentPage === 'chat' ? 'fa-solid' : 'fa-regular'} fa-comment"></i>
                </button>
            </nav>
        `;
    }

    bindEvents(root = document.querySelector('.phone-view-current .xapp-root')) {
        if (!root) return;

        root.querySelectorAll('.xapp-bottom-item[data-page]').forEach((button) => {
            button.addEventListener('click', () => {
                const nextPage = button.dataset.page;
                if (!nextPage || nextPage === this.currentPage) return;
                this.activeDirectMessageId = null;
                this.currentPage = nextPage;
                this.currentPostId = null;
                this.currentPostSource = 'feed';
                this.detailReturnPage = 'home';
                this.currentReplyCommentId = null;
                this.render();
            });
        });

        root.querySelector('.xapp-avatar-button')?.addEventListener('click', () => this.openProfile());
        root.querySelector('.xapp-compose-button')?.addEventListener('click', () => this.openCompose());

        if (this.currentPage === 'compose') {
            this.bindComposeEvents(root);
        }

        if (this.currentPage === 'profile') {
            this.bindProfileEvents(root);
        }

        if (this.currentPage === 'settings') {
            this.bindSettingsEvents(root);
        }

        if (this.currentPage === 'chat') {
            this.bindDirectMessageEvents(root);
        }

        root.querySelectorAll('.xapp-feed-tab[data-feed]').forEach((button) => {
            button.addEventListener('click', () => {
                const nextFeed = button.dataset.feed;
                if (!nextFeed || nextFeed === this.currentFeed) return;
                this.currentFeed = nextFeed;
                this.render();
            });
        });

        this.bindPostEvents(root);

        if (this.currentPage === 'home') this.bindPullRefresh(root);
        if (this.currentPage === 'detail') this.bindDetailEvents(root);
    }

    bindPostEvents(root) {
        root.querySelectorAll('.xapp-post[data-post-id]').forEach((postElement) => {
            const openPost = (event) => {
                if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
                if (event.target.closest('button')) return;
                event.preventDefault();
                this.openPost(postElement.dataset.postId, false, postElement.dataset.postSource || 'feed');
            };
            postElement.addEventListener('click', openPost);
            postElement.addEventListener('keydown', openPost);
        });

        root.querySelectorAll('.xapp-comment-action[data-post-id]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                if (this.currentPage === 'detail') {
                    this.clearReplyTarget();
                    document.getElementById('xapp-reply-input')?.focus();
                    return;
                }
                const postElement = button.closest('.xapp-post');
                this.openPost(button.dataset.postId, true, postElement?.dataset.postSource || 'feed');
            });
        });

        root.querySelectorAll('.xapp-delete-post-button[data-post-id]').forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await this.deleteUserPost(button.dataset.postId, button.dataset.postSource || 'user');
            });
        });

        root.querySelectorAll('.xapp-more-button[data-post-id]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const post = this.app.xData.getPost(
                    button.dataset.postId,
                    button.dataset.postSource || 'feed'
                );
                if (post) this.showPostMenu(post, button);
            });
        });

        root.querySelectorAll('.xapp-like-action[data-post-id]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const postElement = button.closest('.xapp-post');
                const source = button.dataset.postSource
                    || postElement?.dataset.postSource
                    || (this.currentPage === 'detail' ? this.currentPostSource : 'feed');
                const post = this.app.xData.togglePostLike(button.dataset.postId, source);
                if (post) this.refreshPostLikeState(post, source);
            });
        });

        root.querySelectorAll('.xapp-post-action-share[data-post-id]').forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                const postElement = button.closest('.xapp-post');
                const source = postElement?.dataset.postSource
                    || (this.currentPage === 'detail' ? this.currentPostSource : 'feed');
                const post = this.app.xData.getPost(button.dataset.postId, source);
                if (post) await this.showForwardDialog(post);
            });
        });

        this.bindMediaEvents(root);
    }

    refreshPostLikeState(post, source = 'feed') {
        if (typeof document === 'undefined' || !post) return;
        const root = document.querySelector('.phone-view-current .xapp-root');
        if (!root) return;

        const postId = String(post.id || '');
        const liked = post.likedByUser === true;
        root.querySelectorAll('.xapp-like-action[data-post-id]').forEach((button) => {
            if (button.dataset.postId !== postId) return;
            if ((button.dataset.postSource || 'feed') !== source) return;
            button.classList.toggle('is-liked', liked);
            button.setAttribute('aria-pressed', String(liked));
            button.setAttribute('aria-label', liked ? '取消喜欢' : '喜欢');
            const icon = button.querySelector('i');
            if (icon) icon.className = liked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
            const count = button.querySelector('[data-xapp-like-count]');
            if (count) count.textContent = this._formatCount(post.likes);
        });

        if (this.currentPage === 'detail'
            && String(this.currentPostId || '') === postId
            && this.currentPostSource === source) {
            root.querySelectorAll('[data-xapp-like-count]').forEach((element) => {
                element.textContent = this._formatCount(post.likes);
            });
            return;
        }

        root.querySelectorAll('.xapp-post[data-post-id]').forEach((article) => {
            if (article.dataset.postId !== postId) return;
            if ((article.dataset.postSource || 'feed') !== source) return;
            article.querySelectorAll('[data-xapp-like-count]').forEach((element) => {
                element.textContent = this._formatCount(post.likes);
            });
        });
    }

    showPostMenu(post, anchorButton = null) {
        if (typeof document === 'undefined' || !post) return;
        this.closeForwardDialog();
        this.closePostMenu();

        const isFollowing = this.app.xData.isFollowingPostAuthor(post);
        const overlay = document.createElement('div');
        overlay.className = 'xapp-post-menu-overlay';
        overlay.innerHTML = `
            <div class="xapp-post-menu-sheet" role="dialog" aria-label="帖子操作">
                <button class="xapp-post-menu-action" type="button" data-xapp-post-follow>
                    <i class="fa-regular fa-user" aria-hidden="true"></i>
                    <span>${isFollowing ? '取消关注' : '关注'}</span>
                </button>
                <button class="xapp-post-menu-action" type="button" data-xapp-post-dm>
                    <i class="fa-regular fa-envelope" aria-hidden="true"></i>
                    <span>私信</span>
                </button>
            </div>
        `;

        const closeMenu = () => {
            overlay.remove();
            if (this._activePostMenuClose === closeMenu) this._activePostMenuClose = null;
        };
        this._activePostMenuClose = closeMenu;
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closeMenu();
        });
        overlay.querySelector('[data-xapp-post-follow]')?.addEventListener('click', () => {
            const result = this.app.xData.toggleFollowPostAuthor(post);
            closeMenu();
            this.app.phoneShell.showNotification?.(
                'X',
                result.following ? `已关注 ${result.participant.name}` : `已取消关注 ${result.participant.name}`,
                result.following ? '✓' : '－'
            );
            if (this.currentPage === 'home' && this.currentFeed === 'following') this.render();
        });
        overlay.querySelector('[data-xapp-post-dm]')?.addEventListener('click', () => {
            closeMenu();
            this.openDirectMessageFromPost(post);
        });
        const phoneScreen = document.querySelector('.phone-screen') || document.body;
        phoneScreen.appendChild(overlay);

        const positionMenu = () => {
            const sheet = overlay.querySelector('.xapp-post-menu-sheet');
            if (!sheet || !anchorButton?.getBoundingClientRect || !phoneScreen.getBoundingClientRect) return;
            const phoneRect = phoneScreen.getBoundingClientRect();
            const anchorRect = anchorButton.getBoundingClientRect();
            const menuWidth = sheet.offsetWidth || (isFollowing ? 86 : 64);
            const menuHeight = sheet.offsetHeight || 74;
            const maxLeft = Math.max(8, phoneRect.width - menuWidth - 8);
            const left = Math.min(maxLeft, Math.max(8, anchorRect.right - phoneRect.left - menuWidth));
            const belowTop = anchorRect.bottom - phoneRect.top + 4;
            const top = belowTop + menuHeight <= phoneRect.height - 8
                ? belowTop
                : Math.max(8, anchorRect.top - phoneRect.top - menuHeight - 4);
            sheet.style.left = `${Math.round(left)}px`;
            sheet.style.top = `${Math.round(top)}px`;
        };
        positionMenu();
        requestAnimationFrame(positionMenu);
    }

    closePostMenu() {
        if (typeof this._activePostMenuClose !== 'function') return false;
        const close = this._activePostMenuClose;
        this._activePostMenuClose = null;
        close();
        return true;
    }

    openDirectMessageFromPost(post) {
        const thread = this.app.xData.getOrCreateDirectMessageThread(post);
        if (!thread) return null;
        this.currentPage = 'chat';
        this.activeDirectMessageId = null;
        this.currentPostId = null;
        this.currentPostSource = 'feed';
        this.currentReplyCommentId = null;
        this.render();
        this.activeDirectMessageId = thread.id;
        this.render();
        requestAnimationFrame(() => document.getElementById('xapp-dm-input')?.focus());
        return thread;
    }

    bindDirectMessageEvents(root) {
        root.querySelectorAll('.xapp-chat-thread[data-thread-id]').forEach((button) => {
            let holdTimer = null;
            let startX = 0;
            let startY = 0;
            const clearHold = () => {
                if (holdTimer) clearTimeout(holdTimer);
                holdTimer = null;
                button.classList.remove('is-long-pressing');
            };
            button.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (Date.now() < this._suppressDirectMessageThreadClickUntil) return;
                this.deleteDirectMessageThread(button.dataset.threadId);
            });
            button.addEventListener('touchstart', (event) => {
                if (event.touches?.length !== 1) return;
                startX = event.touches[0].clientX;
                startY = event.touches[0].clientY;
                clearHold();
                button.classList.add('is-long-pressing');
                holdTimer = setTimeout(() => {
                    holdTimer = null;
                    button.classList.remove('is-long-pressing');
                    this._suppressDirectMessageThreadClickUntil = Date.now() + 900;
                    this.deleteDirectMessageThread(button.dataset.threadId);
                }, 600);
            }, { passive: true });
            button.addEventListener('touchmove', (event) => {
                const touch = event.touches?.[0];
                if (!touch) return;
                if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
                    clearHold();
                }
            }, { passive: true });
            button.addEventListener('touchend', (event) => {
                const suppressed = Date.now() < this._suppressDirectMessageThreadClickUntil;
                clearHold();
                if (!suppressed) return;
                event.preventDefault();
                event.stopPropagation();
            }, { passive: false });
            button.addEventListener('touchcancel', clearHold, { passive: true });
            button.addEventListener('click', (event) => {
                if (Date.now() < this._suppressDirectMessageThreadClickUntil) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                this.activeDirectMessageId = button.dataset.threadId;
                this.render();
            });
        });

        root.querySelector('.xapp-dm-back')?.addEventListener('click', () => this.returnToDirectMessageList());
        const input = root.querySelector('#xapp-dm-input');
        const sendButton = root.querySelector('#xapp-dm-send');
        input?.addEventListener('input', () => this.syncDirectMessageSendState(root));
        input?.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || event.isComposing) return;
            event.preventDefault();
            this.submitDirectMessage(root);
        });
        sendButton?.addEventListener('click', () => this.submitDirectMessage(root));
        this.syncDirectMessageSendState(root);
        this.scrollDirectMessagesToBottom(root, false);
    }

    returnToDirectMessageList() {
        if (this.currentPage !== 'chat' || !this.activeDirectMessageId) return false;
        this.activeDirectMessageId = null;
        this.render();
        return true;
    }

    deleteDirectMessageThread(threadId) {
        const thread = this.app.xData.getDirectMessageThread(threadId);
        if (!thread) return false;
        const participantName = String(thread.participant?.name || '该用户').trim() || '该用户';
        if (typeof confirm === 'function' && !confirm(`确定删除与 ${participantName} 的全部私信记录吗？`)) {
            return false;
        }

        const result = this.app.xData.deleteDirectMessageThread(threadId);
        if (!result.success) return false;
        this._sendingDirectMessageThreadIds.delete(String(threadId || ''));
        if (this.activeDirectMessageId === threadId) this.activeDirectMessageId = null;
        this.app.phoneShell.showNotification?.('X 私信', `已删除与 ${participantName} 的会话`, '✓');
        this.render();
        return true;
    }

    async submitDirectMessage(root = document.querySelector('.phone-view-current .xapp-root')) {
        const threadId = this.activeDirectMessageId;
        const input = root?.querySelector('#xapp-dm-input');
        const text = String(input?.value || '').trim();
        if (!threadId || !input || !text || this._sendingDirectMessageThreadIds.has(threadId)) return null;

        const userMessage = this.app.xData.addDirectMessage(threadId, 'me', text);
        if (!userMessage) return null;
        input.value = '';
        this._sendingDirectMessageThreadIds.add(threadId);
        this.refreshDirectMessageMessages(root);
        this.syncDirectMessageSendState(root);
        input.focus();

        try {
            const reply = await this.app.xData.generateDirectMessageReply(threadId);
            return reply;
        } catch (error) {
            console.error('[X] 私信回复失败:', error);
            this.app.phoneShell.showNotification?.('X 私信', error?.message || '回复失败，请稍后重试', '×');
            return null;
        } finally {
            this._sendingDirectMessageThreadIds.delete(threadId);
            const activeRoot = typeof document !== 'undefined'
                ? document.querySelector('.phone-view-current .xapp-root[data-page="chat"]')
                : null;
            if (this.currentPage === 'chat' && this.activeDirectMessageId === threadId) {
                this.refreshDirectMessageMessages(activeRoot || root);
                this.syncDirectMessageSendState(activeRoot || root);
                (activeRoot || root)?.querySelector('#xapp-dm-input')?.focus();
            } else if (this.currentPage === 'chat' && !this.activeDirectMessageId) {
                this.render();
            }
        }
    }

    refreshDirectMessageMessages(root = document.querySelector('.phone-view-current .xapp-root')) {
        const container = root?.querySelector('#xapp-dm-messages');
        const thread = this.app.xData.getDirectMessageThread(this.activeDirectMessageId);
        if (!container || !thread) return;
        container.innerHTML = this.renderDirectMessageMessages(thread);
        this.scrollDirectMessagesToBottom(root);
    }

    syncDirectMessageSendState(root = document.querySelector('.phone-view-current .xapp-root')) {
        const input = root?.querySelector('#xapp-dm-input');
        const sendButton = root?.querySelector('#xapp-dm-send');
        if (sendButton) {
            sendButton.disabled = this._sendingDirectMessageThreadIds.has(this.activeDirectMessageId)
                || !String(input?.value || '').trim();
        }
    }

    scrollDirectMessagesToBottom(root = document.querySelector('.phone-view-current .xapp-root'), smooth = true) {
        const container = root?.querySelector('#xapp-dm-messages');
        if (!container) return;
        requestAnimationFrame(() => {
            if (typeof container.scrollTo === 'function') {
                container.scrollTo({ top: container.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
            } else {
                container.scrollTop = container.scrollHeight;
            }
        });
    }

    async showForwardDialog(post) {
        const contacts = await this.app.xData.getWechatContactsAsync();
        const wechatData = window.VirtualPhone?.wechatApp?.wechatData || window.VirtualPhone?.cachedWechatData;
        const groupChats = wechatData?.getChatList?.().filter(chat => chat.type === 'group') || [];
        const forwardTargets = [
            ...contacts.map(contact => ({
                ...contact,
                avatar: this._resolveWechatForwardAvatar(contact, wechatData) || contact.avatar || ''
            })),
            ...groupChats.map(group => ({
                ...group,
                avatar: this._resolveWechatForwardAvatar(group, wechatData, { isGroup: true }) || group.avatar || '👥',
                isGroup: true
            }))
        ];

        if (forwardTargets.length === 0) {
            this.app.phoneShell.showNotification?.('提示', '请先在微信中添加联系人', '⚠️');
            return;
        }

        this.closeForwardDialog();
        const targetMap = new Map(forwardTargets.map(target => [String(target.name || ''), target]));
        const author = this._resolvePostAuthor(post);
        const previewTitle = this._escapeHtml(author.name || 'X 用户');
        const previewText = String(post.content || '').trim();
        const previewDesc = this._renderText(previewText.slice(0, 64));
        const overlay = document.createElement('div');
        overlay.className = 'xapp-forward-overlay';

        const phoneScreen = document.querySelector('.phone-screen');
        const lockTarget = document.querySelector('.phone-view-current .xapp-root') || document.querySelector('.xapp-root');
        lockTarget?.classList.add('xapp-forward-lock');
        phoneScreen?.classList.add('xapp-forward-open');

        const closeOverlay = () => {
            lockTarget?.classList.remove('xapp-forward-lock');
            phoneScreen?.classList.remove('xapp-forward-open');
            overlay.remove();
            if (this._activeForwardOverlayClose === closeOverlay) this._activeForwardOverlayClose = null;
        };
        this._activeForwardOverlayClose = closeOverlay;

        overlay.addEventListener('click', event => {
            if (event.target === overlay) closeOverlay();
        });
        overlay.addEventListener('wheel', event => {
            const list = event.target.closest('.xapp-forward-list');
            if (list) list.scrollTop += event.deltaY;
            event.preventDefault();
        }, { passive: false });
        overlay.addEventListener('touchmove', event => {
            if (!event.target.closest('.xapp-forward-list')) event.preventDefault();
        }, { passive: false });

        const renderPreview = () => `
            <div class="xapp-forward-preview-card">
                <div class="xapp-forward-x-icon">X</div>
                <div class="xapp-forward-preview-copy">
                    <strong>${previewTitle}</strong>
                    <span>${previewDesc || '分享了一条 X 帖子'}${previewText.length > 64 ? '...' : ''}</span>
                </div>
            </div>
        `;
        const renderTargetList = () => `
            <div class="xapp-forward-dialog">
                <header class="xapp-forward-header">
                    <span>转发到微信</span>
                    <button class="xapp-forward-icon-button" type="button" data-xapp-forward-close aria-label="关闭">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </header>
                <div class="xapp-forward-preview">${renderPreview()}</div>
                <div class="xapp-forward-list">
                    ${forwardTargets.map(target => `
                        <button class="xapp-forward-contact" type="button" data-name="${this._escapeAttr(target.name)}">
                            <span class="xapp-forward-contact-avatar">${this._renderForwardTargetAvatar(target.avatar, target.name, target.isGroup)}</span>
                            <span class="xapp-forward-contact-name">${this._escapeHtml(target.name)}</span>
                            <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                        </button>
                    `).join('')}
                </div>
            </div>
        `;

        const bindTargetListEvents = () => {
            overlay.querySelector('[data-xapp-forward-close]')?.addEventListener('click', closeOverlay);
            overlay.querySelectorAll('.xapp-forward-contact[data-name]').forEach(item => {
                item.addEventListener('click', () => {
                    const target = targetMap.get(item.dataset.name) || {
                        name: item.dataset.name,
                        avatar: '👤'
                    };
                    renderComposeDialog(target);
                });
            });
        };

        const renderComposeDialog = (target) => {
            overlay.innerHTML = `
                <div class="xapp-forward-dialog xapp-forward-dialog-compose">
                    <header class="xapp-forward-header">
                        <button class="xapp-forward-icon-button" type="button" data-xapp-forward-back aria-label="返回联系人列表">
                            <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                        </button>
                        <span>发送给</span>
                        <button class="xapp-forward-icon-button" type="button" data-xapp-forward-close aria-label="关闭">
                            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                        </button>
                    </header>
                    <div class="xapp-forward-recipient">
                        <span class="xapp-forward-contact-avatar">${this._renderForwardTargetAvatar(target.avatar, target.name, target.isGroup)}</span>
                        <strong>${this._escapeHtml(target.name)}</strong>
                    </div>
                    <div class="xapp-forward-preview is-compact">${renderPreview()}</div>
                    <label class="xapp-forward-note-wrap">
                        <input class="xapp-forward-note" type="text" maxlength="200" placeholder="发消息（可选）" autocomplete="off">
                        <i class="fa-regular fa-face-smile" aria-hidden="true"></i>
                    </label>
                    <footer class="xapp-forward-actions">
                        <button class="xapp-forward-action xapp-forward-cancel" type="button" data-xapp-forward-back>取消</button>
                        <button class="xapp-forward-action xapp-forward-send" type="button">发送</button>
                    </footer>
                </div>
            `;

            const backToList = () => {
                overlay.innerHTML = renderTargetList();
                bindTargetListEvents();
            };
            overlay.querySelectorAll('[data-xapp-forward-back]').forEach(button => {
                button.addEventListener('click', backToList);
            });
            overlay.querySelector('[data-xapp-forward-close]')?.addEventListener('click', closeOverlay);

            const sendButton = overlay.querySelector('.xapp-forward-send');
            const noteInput = overlay.querySelector('.xapp-forward-note');
            const sendNow = async () => {
                if (!sendButton || sendButton.disabled) return;
                sendButton.disabled = true;
                const forwardText = String(noteInput?.value || '').trim();
                try {
                    const result = await this.app.xData.forwardToWechat(post, target.name, { forwardText });
                    if (forwardText) {
                        this._triggerWechatAutoReplyAfterForward(result?.chatId, target.name, forwardText);
                    }
                    this.app.phoneShell.showNotification?.('转发成功', `已转发给 ${target.name}`, '✓');
                    closeOverlay();
                } catch (error) {
                    this.app.phoneShell.showNotification?.('转发失败', error?.message || '请稍后重试', '×');
                    sendButton.disabled = false;
                }
            };
            sendButton?.addEventListener('click', sendNow);
            noteInput?.addEventListener('keydown', event => {
                if (event.key !== 'Enter' || event.isComposing) return;
                event.preventDefault();
                sendNow();
            });
            noteInput?.focus();
        };

        overlay.innerHTML = renderTargetList();
        (phoneScreen || document.body).appendChild(overlay);
        bindTargetListEvents();
    }

    closeForwardDialog() {
        if (typeof this._activeForwardOverlayClose !== 'function') return false;
        const close = this._activeForwardOverlayClose;
        this._activeForwardOverlayClose = null;
        close();
        return true;
    }

    async _triggerWechatAutoReplyAfterForward(chatId, friendName, forwardText = '') {
        if (!chatId || !String(forwardText || '').trim()) return;

        try {
            let wechatApp = window.currentWechatApp || window.ggp_currentWechatApp || window.VirtualPhone?.wechatApp || null;
            if (!wechatApp) {
                const module = await import('../wechat/wechat-app.js?v=20261002-x-forward-card');
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

            const targetChat = wechatApp.wechatData.getChat(chatId)
                || wechatApp.wechatData.getChatList().find(chat => chat.id === chatId);
            if (!targetChat || !wechatApp.chatView) return;
            wechatApp.currentView = 'chats';
            wechatApp.currentChat = targetChat;

            if (typeof wechatApp.chatView.isOnlineMode === 'function' && !wechatApp.chatView.isOnlineMode()) {
                this.app.phoneShell.showNotification?.('微信离线模式', '未触发自动回复，请先开启在线模式', '⚠️');
                return;
            }

            wechatApp.chatView.sendToAI(forwardText, chatId).catch(error => {
                console.error('[X] 转发后自动触发微信回复失败:', error);
            });
            this.app.phoneShell.showNotification?.('微信', `${friendName} 正在回复中...`, '…');
        } catch (error) {
            console.error('[X] 转发后自动联动失败:', error);
        }
    }

    bindMediaEvents(root) {
        root.querySelectorAll('.xapp-image-info').forEach((button) => {
            button.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                const card = event.currentTarget.closest('.xapp-image-card');
                card?.querySelector('.xapp-image-front')?.classList.add('is-hidden');
                card?.querySelector('.xapp-image-back')?.classList.remove('is-hidden');
            };
        });

        root.querySelectorAll('.xapp-image-restore').forEach((button) => {
            button.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                const card = event.currentTarget.closest('.xapp-image-card');
                card?.querySelector('.xapp-image-back')?.classList.add('is-hidden');
                card?.querySelector('.xapp-image-front')?.classList.remove('is-hidden');
            };
        });

        root.querySelectorAll('.xapp-image-open').forEach((button) => {
            button.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                const image = event.currentTarget.querySelector('.xapp-post-image-real');
                const imageUrl = String(image?.getAttribute('src') || '').trim();
                if (!imageUrl) return;
                this.app.phoneShell.showImageViewer?.(imageUrl, {
                    alt: image?.getAttribute('alt') || 'X 帖子图片'
                });
            };
        });

        root.querySelectorAll('.xapp-image-generate').forEach((button) => {
            button.onclick = async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await this.generatePostImage({
                    postId: button.dataset.postId,
                    source: button.dataset.postSource || 'feed',
                    index: Number.parseInt(button.dataset.imageIndex, 10),
                    promptText: button.dataset.imagePrompt,
                    descriptionText: button.dataset.imageDescription
                });
            };
        });

        root.querySelectorAll('.xapp-image-regenerate').forEach((button) => {
            button.onclick = async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await this.generatePostImage({
                    postId: button.dataset.postId,
                    source: button.dataset.postSource || 'feed',
                    index: Number.parseInt(button.dataset.imageIndex, 10),
                    promptText: button.dataset.imagePrompt,
                    descriptionText: button.dataset.imageDescription,
                    clearPreviousImage: true
                });
            };
        });
    }

    bindDetailEvents(root) {
        root.querySelector('.xapp-detail-back')?.addEventListener('click', () => this.returnFromDetail());

        root.querySelector('.xapp-comments')?.addEventListener('click', (event) => {
            const replyButton = event.target.closest('.xapp-comment-reply[data-comment-id]');
            if (!replyButton) return;
            event.stopPropagation();
            this.setReplyTarget(replyButton.dataset.commentId);
        });

        root.querySelector('.xapp-reply-cancel')?.addEventListener('click', () => {
            this.clearReplyTarget(true);
        });

        root.querySelector('.xapp-load-more-comments')?.addEventListener('click', async (event) => {
            const button = event.currentTarget;
            await this.loadMoreComments(button.dataset.postId, button.dataset.postSource || 'feed', button);
        });

        const input = root.querySelector('#xapp-reply-input');
        const sendButton = root.querySelector('#xapp-reply-send');
        if (!input || !sendButton) return;

        input.addEventListener('input', () => this.syncReplySendState());
        input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || event.isComposing) return;
            event.preventDefault();
            this.submitReply();
        });
        sendButton.addEventListener('click', () => this.submitReply());
    }

    bindProfileEvents(root) {
        root.querySelector('.xapp-profile-back')?.addEventListener('click', () => this.returnFromProfile());
        root.querySelector('.xapp-profile-settings-button')?.addEventListener('click', () => this.openSettings());
        root.querySelector('.xapp-profile-edit-button')?.addEventListener('click', () => this.openProfileEditor(root));
        root.querySelector('#xapp-profile-avatar-upload')?.addEventListener('change', async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            await this.updateProfileAvatar(file);
        });

        const overlay = root.querySelector('.xapp-profile-edit-overlay');
        const form = root.querySelector('#xapp-profile-edit-form');
        const closeEditor = () => this.closeProfileEditor(root);
        root.querySelector('.xapp-profile-edit-close')?.addEventListener('click', closeEditor);
        root.querySelector('.xapp-profile-edit-cancel')?.addEventListener('click', closeEditor);
        overlay?.addEventListener('click', (event) => {
            if (event.target === overlay) closeEditor();
        });
        overlay?.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeEditor();
        });
        form?.addEventListener('submit', (event) => {
            event.preventDefault();
            const savedProfile = this.saveProfileEdits({
                nickname: root.querySelector('#xapp-profile-edit-nickname')?.value,
                following: root.querySelector('#xapp-profile-edit-following')?.value,
                followers: root.querySelector('#xapp-profile-edit-followers')?.value
            });
            this.syncProfilePage(root, savedProfile);
            this.closeProfileEditor(root);
            this.app.phoneShell.showNotification?.('X', '个人资料已保存', '✓');
        });
    }

    bindComposeEvents(root) {
        const textarea = root.querySelector('#xapp-compose-text');
        const fileInput = root.querySelector('#xapp-compose-image-input');
        const preview = root.querySelector('#xapp-compose-preview');

        root.querySelector('.xapp-compose-back')?.addEventListener('click', () => this.returnFromCompose());
        root.querySelector('.xapp-compose-publish')?.addEventListener('click', () => this.publishComposePost(root));
        root.querySelector('.xapp-compose-add-image')?.addEventListener('click', () => {
            if (!this.composeUploadInProgress) fileInput?.click();
        });
        root.querySelector('.xapp-compose-add-text-image')?.addEventListener('click', () => {
            if (!this.composeUploadInProgress) this._insertComposeTextImageTemplate(textarea);
        });
        textarea?.addEventListener('input', () => this.syncComposeControls(root));
        fileInput?.addEventListener('change', async (event) => {
            const files = Array.from(event.currentTarget.files || []);
            event.currentTarget.value = '';
            await this.handleComposeFiles(files, root);
        });
        preview?.addEventListener('click', async (event) => {
            const button = event.target.closest('.xapp-compose-remove-image[data-image-index]');
            if (!button) return;
            event.preventDefault();
            const index = Number.parseInt(button.dataset.imageIndex, 10);
            if (!Number.isInteger(index)) return;
            const [removed] = this.pendingComposeImages.splice(index, 1);
            this.updateComposeImagePreview(root);
            await this._deleteManagedXImages([removed]);
        });

        this.syncComposeControls(root);
        requestAnimationFrame(() => textarea?.focus());
    }

    async handleComposeFiles(files = [], root = document.querySelector('.phone-view-current .xapp-root')) {
        if (this.composeUploadInProgress || !Array.isArray(files) || files.length === 0) return;
        const sessionId = this.composeSessionId;
        const textImageCount = this._countComposeTextImages(root?.querySelector('#xapp-compose-text')?.value || '');
        const remaining = Math.max(0, 4 - this.pendingComposeImages.length - textImageCount);
        if (remaining <= 0) {
            this.app.phoneShell.showNotification?.('X', '上传图片和文字图片合计最多 4 张', '×');
            return;
        }

        const filesToUpload = files.slice(0, remaining);
        this.composeUploadInProgress = true;
        this.syncComposeControls(root);
        let successCount = 0;
        let failureCount = 0;

        try {
            for (const file of filesToUpload) {
                try {
                    const cropper = new ImageCropper({
                        title: '裁剪图片',
                        aspectRatio: 1,
                        outputWidth: 1024,
                        outputHeight: 1024,
                        quality: 0.88,
                        maxFileSize: 5 * 1024 * 1024
                    });
                    const dataUrl = await cropper.open(file);
                    if (sessionId !== this.composeSessionId) break;
                    const uploaded = await window.VirtualPhone?.imageManager?.uploadDataUrl?.(dataUrl, 'x_img');
                    const path = String(uploaded || '').trim();
                    if (!/^\/backgrounds\/phone_x_img_/i.test(path)) {
                        throw new Error('图片没有保存到 X 图片目录');
                    }
                    if (sessionId !== this.composeSessionId) {
                        await this._deleteManagedXImages([path]);
                        break;
                    }
                    this.pendingComposeImages.push(path);
                    successCount += 1;
                    this.updateComposeImagePreview(root);
                } catch (error) {
                    if (error?.message === '用户取消') continue;
                    failureCount += 1;
                    console.error('[X] 上传帖子图片失败:', error);
                    this.app.phoneShell.showNotification?.('X', error?.message || '图片上传失败', '×');
                }
            }
        } finally {
            if (sessionId === this.composeSessionId) {
                this.composeUploadInProgress = false;
                this.syncComposeControls(root);
            }
        }

        if (sessionId === this.composeSessionId && successCount > 0) {
            const suffix = failureCount > 0 ? `，${failureCount} 张失败` : '';
            this.app.phoneShell.showNotification?.('X', `已添加 ${successCount} 张图片${suffix}`, '✓');
        }
    }

    updateComposeImagePreview(root = document.querySelector('.phone-view-current .xapp-root')) {
        const preview = root?.querySelector('#xapp-compose-preview');
        if (preview) preview.innerHTML = this.renderComposeImagePreview();
        this.syncComposeControls(root);
    }

    syncComposeControls(root = document.querySelector('.phone-view-current .xapp-root')) {
        const textarea = root?.querySelector('#xapp-compose-text');
        const count = String(textarea?.value || '').length;
        const countElement = root?.querySelector('#xapp-compose-count');
        const publishButton = root?.querySelector('.xapp-compose-publish');
        const addImageButton = root?.querySelector('.xapp-compose-add-image');
        const addTextImageButton = root?.querySelector('.xapp-compose-add-text-image');
        const mediaCount = this.pendingComposeImages.length + this._countComposeTextImages(textarea?.value || '');
        if (countElement) countElement.textContent = String(count);
        if (publishButton) {
            publishButton.disabled = this.composeUploadInProgress
                || (!String(textarea?.value || '').trim() && this.pendingComposeImages.length === 0);
        }
        if (addImageButton) {
            addImageButton.disabled = this.composeUploadInProgress || mediaCount >= 4;
        }
        if (addTextImageButton) {
            addTextImageButton.disabled = this.composeUploadInProgress || mediaCount >= 4;
        }
    }

    publishComposePost(root = document.querySelector('.phone-view-current .xapp-root')) {
        if (this.composeUploadInProgress) return null;
        const content = String(root?.querySelector('#xapp-compose-text')?.value || '').trim();
        const textImageCount = this._countComposeTextImages(content);
        if (this.pendingComposeImages.length + textImageCount > 4) {
            this.app.phoneShell.showNotification?.('X', '上传图片和文字图片合计最多 4 张', '×');
            return null;
        }
        const post = this.app.xData.publishUserPost(content, this.pendingComposeImages);
        if (!post) {
            this.app.phoneShell.showNotification?.('X', '请输入内容或添加图片', '×');
            return null;
        }

        this.pendingComposeImages = [];
        this.composeSessionId += 1;
        this._visibleUserPostIds.add(String(post.id));
        this.composeReturnPage = 'home';
        this.currentPage = 'home';
        this.currentFeed = 'for-you';
        this.app.phoneShell.showNotification?.('X', '帖子已发布', '✓');
        this.render();
        void this.triggerXAIReaction(post);
        return post;
    }

    async triggerXAIReaction(post) {
        const postId = String(post?.id || '').trim();
        if (!postId || this._pendingReactionPostIds.has(postId)) return null;
        this._pendingReactionPostIds.add(postId);
        this.app.phoneShell.showNotification?.('X', '网友正在围观...', '👀');

        try {
            const result = await this.app.xData.generateReactionForPost(post);
            const applied = this.app.xData.applyReactionToUserPost(postId, result);
            if (!applied) return null;

            this.refreshPostEngagement(applied.post, 'user');
            this.app.phoneShell.showNotification?.('X', '收到新互动', '💬');
            return applied;
        } catch (error) {
            console.error('[X] 用户帖子围观互动失败:', error);
            this.app.phoneShell.showNotification?.('X', error?.message || '围观互动生成失败', '×');
            return null;
        } finally {
            this._pendingReactionPostIds.delete(postId);
        }
    }

    async loadMoreComments(postId, source = 'feed', button = null) {
        const safePostId = String(postId || '').trim();
        const key = `${source}:${safePostId}`;
        if (!safePostId || this._loadingMorePostIds.has(key)) return null;
        this._loadingMorePostIds.add(key);

        if (button) {
            button.disabled = true;
            button.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>正在加载...</span>';
        }

        try {
            const result = await this.app.xData.generateMoreComments(safePostId, source);
            const stillSameDetail = this.currentPage === 'detail'
                && String(this.currentPostId || '') === safePostId
                && this.currentPostSource === source;
            if (stillSameDetail && result?.post) {
                this.refreshDetailComments(result.post, result.addedComments?.[0]?.id || null);
            }
            this.app.phoneShell.showNotification?.('X', '新回复已加载', '💬');
            return result;
        } catch (error) {
            console.error('[X] 加载更多回复失败:', error);
            this.app.phoneShell.showNotification?.('X', error?.message || '加载更多回复失败', '×');
            return null;
        } finally {
            this._loadingMorePostIds.delete(key);
            if (button?.isConnected) {
                button.disabled = false;
                button.innerHTML = '<i class="fa-regular fa-comment-dots" aria-hidden="true"></i><span>加载更多回复...</span>';
            }
        }
    }

    async triggerCommentAIReaction(postId, userCommentId, source = 'feed') {
        const safeCommentId = String(userCommentId || '').trim();
        if (!safeCommentId || this._pendingCommentReactionIds.has(safeCommentId)) return null;
        this._pendingCommentReactionIds.add(safeCommentId);
        this.app.phoneShell.showNotification?.('X', '网友正在回复...', '👀');

        try {
            const result = await this.app.xData.generateReplyForUserComment(postId, safeCommentId, source);
            const stillSameDetail = this.currentPage === 'detail'
                && String(this.currentPostId || '') === String(postId || '')
                && this.currentPostSource === source;
            if (stillSameDetail && result?.post) {
                this.refreshDetailComments(result.post, result.addedComments?.[0]?.id || safeCommentId);
            }
            this.app.phoneShell.showNotification?.('X', '收到新回复', '💬');
            return result;
        } catch (error) {
            console.error('[X] 评论回评生成失败:', error);
            this.app.phoneShell.showNotification?.('X', error?.message || '评论回评生成失败', '×');
            return null;
        } finally {
            this._pendingCommentReactionIds.delete(safeCommentId);
        }
    }

    refreshPostEngagement(post, source = 'feed') {
        if (typeof document === 'undefined' || !post) return;
        const root = document.querySelector('.phone-view-current .xapp-root');
        if (!root) return;

        if (this.currentPage === 'detail'
            && String(this.currentPostId || '') === String(post.id || '')
            && this.currentPostSource === source) {
            this.refreshDetailComments(post);
            return;
        }

        root.querySelectorAll('.xapp-post[data-post-id]').forEach((article) => {
            if (article.dataset.postId !== String(post.id || '')) return;
            if ((article.dataset.postSource || 'feed') !== source) return;
            article.querySelectorAll('[data-xapp-comment-count]').forEach((element) => {
                element.textContent = this._formatCount(post.comments);
            });
            article.querySelectorAll('[data-xapp-like-count]').forEach((element) => {
                element.textContent = this._formatCount(post.likes);
            });
        });
    }

    async _deleteManagedXImages(images = []) {
        const imageManager = typeof window !== 'undefined' ? window.VirtualPhone?.imageManager : null;
        if (!imageManager?.deleteManagedBackgroundByPath) return [];
        const paths = [...new Set((Array.isArray(images) ? images : [])
            .map((value) => this._extractManagedXImagePath(value))
            .filter(Boolean))];
        const results = [];
        for (const path of paths) {
            try {
                results.push(await imageManager.deleteManagedBackgroundByPath(path, {
                    quiet: true,
                    skipIfReferenced: true,
                    ignoreAlbumIndex: true
                }));
            } catch (error) {
                console.warn('[X] 清理托管图片失败:', path, error);
            }
        }
        return results;
    }

    async deleteUserPost(postId, source = 'user') {
        const post = this.app.xData.getPost(postId, source);
        if (!post?.isUserPost) return false;
        if (typeof confirm === 'function' && !confirm('确定删除这条帖子吗？')) return false;

        const result = this.app.xData.deleteUserPost(postId);
        if (!result?.success) {
            this.app.phoneShell.showNotification?.('X', '没有找到要删除的帖子', '×');
            return false;
        }
        this._visibleUserPostIds.delete(String(postId || ''));
        await this._deleteManagedXImages(result.images);
        this.app.phoneShell.showNotification?.('X', '帖子和托管图片已删除', '✓');

        if (this.currentPage === 'detail' && this.currentPostId === postId) {
            this.returnFromDetail();
        } else {
            this.render();
        }
        return true;
    }

    bindSettingsEvents(root) {
        root.querySelector('.xapp-settings-back')?.addEventListener('click', () => this.returnFromSettings());

        const runtime = typeof window !== 'undefined' ? window.VirtualPhone : null;
        const promptManager = runtime?.promptManager;
        promptManager?.bindPromptPresetControls?.(root, 'x', 'override', '#xapp-override-prompt', {
            notify: (title, message, icon) => this.app.phoneShell.showNotification?.(title, message, icon)
        });
        promptManager?.bindPromptPresetControls?.(root, 'x', 'feed', '#xapp-feed-prompt', {
            notify: (title, message, icon) => this.app.phoneShell.showNotification?.(title, message, icon)
        });

        this.renderXWorldbookList(root);
        root.querySelector('#xapp-use-worldbook')?.addEventListener('change', async (event) => {
            const input = event.currentTarget;
            const enabled = !!input.checked;
            input.disabled = true;

            try {
                const manager = runtime?.worldbookManager;
                if (typeof manager?.setEnabled !== 'function') {
                    throw new Error('世界书管理器未初始化');
                }
                await manager.setEnabled('x', enabled);
                input.checked = manager.getEnabled?.('x') ?? enabled;
                await this.renderXWorldbookList(root);
            } catch (error) {
                console.error('[X] 保存世界书开关失败:', error);
                input.checked = !enabled;
                this.app.phoneShell.showNotification?.('X', '世界书开关保存失败', '×');
                await this.renderXWorldbookList(root);
            } finally {
                input.disabled = false;
            }
        });

        const bindContextToggle = (selector, settingName, failureMessage) => {
            root.querySelector(selector)?.addEventListener('change', async (event) => {
                const input = event.currentTarget;
                const enabled = !!input.checked;
                input.disabled = true;

                try {
                    input.checked = await this.app.xData.setGenerationContextSetting(settingName, enabled);
                } catch (error) {
                    console.error(`[X] ${failureMessage}:`, error);
                    input.checked = !enabled;
                    this.app.phoneShell.showNotification?.('X', failureMessage, '×');
                } finally {
                    input.disabled = false;
                }
            });
        };
        bindContextToggle(
            '#xapp-include-character-user',
            'includeCharacterUser',
            '角色卡与用户信息设置保存失败'
        );
        bindContextToggle(
            '#xapp-include-tavern-text',
            'includeTavernText',
            '正文内容设置保存失败'
        );

        root.querySelector('#xapp-reset-override-prompt')?.addEventListener('click', () => {
            if (!promptManager) return;
            const defaultText = promptManager.resetPromptToDefault?.('x', 'override')
                ?? promptManager.getDefaultPrompts?.().x?.override?.content
                ?? '';
            const textarea = root.querySelector('#xapp-override-prompt');
            if (textarea) textarea.value = defaultText;
            const select = root.querySelector('[data-prompt-app="x"][data-prompt-feature="override"] .phone-prompt-preset-select');
            if (select) select.value = promptManager.getActivePromptPresetId?.('x', 'override') || '';
            this.app.phoneShell.showNotification?.('X', '破限词已恢复默认', '✓');
        });

        root.querySelector('#xapp-reset-feed-prompt')?.addEventListener('click', () => {
            if (!promptManager) return;
            const defaultText = promptManager.resetPromptToDefault?.('x', 'feed')
                ?? promptManager.getDefaultPrompts?.().x?.feed?.content
                ?? '';
            const textarea = root.querySelector('#xapp-feed-prompt');
            if (textarea) textarea.value = defaultText;
            const select = root.querySelector('[data-prompt-app="x"][data-prompt-feature="feed"] .phone-prompt-preset-select');
            if (select) select.value = promptManager.getActivePromptPresetId?.('x', 'feed') || '';
            this.app.phoneShell.showNotification?.('X', '默认提示词已恢复', '✓');
        });
    }

    bindPullRefresh(root) {
        if (this.currentFeed !== 'for-you') return;
        const scroll = root.querySelector('.xapp-feed-scroll');
        if (!scroll || scroll.dataset.pullRefreshBound === '1') return;
        scroll.dataset.pullRefreshBound = '1';

        let startX = 0;
        let startY = 0;
        let pullDistance = 0;
        let pressing = false;
        let pressType = '';
        let didPull = false;
        let removeMouseListeners = null;
        const maxPull = 88;
        const triggerThreshold = 58;

        const canPull = () => this.currentPage === 'home'
            && this.currentFeed === 'for-you'
            && !this.isRefreshing
            && scroll.scrollTop <= 2;
        const start = (clientX, clientY, type) => {
            if (!canPull()) return false;
            startX = clientX;
            startY = clientY;
            pullDistance = 0;
            pressing = true;
            pressType = type;
            didPull = false;
            return true;
        };
        const move = (clientX, clientY, event) => {
            if (!pressing) return;
            const deltaX = clientX - startX;
            const deltaY = clientY - startY;
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 8) {
                pressing = false;
                pullDistance = 0;
                pressType = '';
                this.syncRefreshIndicator(root);
                return;
            }
            if (deltaY < 6) return;
            didPull = true;
            this._suppressFeedClickUntil = Date.now() + 650;
            pullDistance = Math.min(maxPull, Math.round(deltaY * 0.55));
            const ready = pullDistance >= triggerThreshold;
            this.setPullRefreshHint(root, pullDistance, ready ? '松手刷新 X' : '下拉刷新 X', ready);
            if (event?.cancelable) event.preventDefault();
        };
        const end = (event = null) => {
            if (!pressing) return;
            const shouldRefresh = pullDistance >= triggerThreshold;
            if (didPull) {
                this._suppressFeedClickUntil = Date.now() + 650;
                if (event?.cancelable) event.preventDefault();
            }
            pressing = false;
            pullDistance = 0;
            pressType = '';
            didPull = false;
            removeMouseListeners?.();
            if (shouldRefresh) this.handleFeedRefresh(root);
            else this.syncRefreshIndicator(root);
        };

        scroll.addEventListener('click', (event) => {
            if (Date.now() >= this._suppressFeedClickUntil) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
        }, true);

        scroll.addEventListener('touchstart', (event) => {
            if (!event.touches?.length) return;
            start(event.touches[0].clientX, event.touches[0].clientY, 'touch');
        }, { passive: true });
        scroll.addEventListener('touchmove', (event) => {
            if (!event.touches?.length || pressType !== 'touch') return;
            move(event.touches[0].clientX, event.touches[0].clientY, event);
        }, { passive: false });
        scroll.addEventListener('touchend', (event) => {
            if (pressType === 'touch') end(event);
        });
        scroll.addEventListener('touchcancel', (event) => {
            if (pressType === 'touch') end(event);
        });
        scroll.addEventListener('mousedown', (event) => {
            if (event.button !== 0 || !start(event.clientX, event.clientY, 'mouse')) return;
            const onMove = (moveEvent) => move(moveEvent.clientX, moveEvent.clientY, moveEvent);
            const onEnd = (endEvent) => end(endEvent);
            removeMouseListeners = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onEnd);
                window.removeEventListener('blur', onEnd);
                removeMouseListeners = null;
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onEnd);
            window.addEventListener('blur', onEnd);
            event.preventDefault();
        });
    }

    async handleFeedRefresh(root = document.querySelector('.phone-view-current .xapp-root')) {
        if (this.isRefreshing) return;
        this.isRefreshing = true;
        this._refreshStatus = 'loading';
        this.syncRefreshIndicator(root);

        try {
            await this.app.xData.generateFeed();
            this._visibleUserPostIds.clear();
            this._refreshStatus = 'success';
            const activeRoot = document.querySelector('.phone-view-current .xapp-root[data-page="home"]');
            if (activeRoot && this.currentPage === 'home' && this.currentFeed === 'for-you') {
                const list = activeRoot.querySelector('.xapp-feed-list');
                if (list) {
                    list.innerHTML = this.renderForYouFeed();
                    this.bindPostEvents(list);
                }
                this.syncRefreshIndicator(activeRoot);
            }
        } catch (error) {
            console.error('[X] 刷新帖子失败:', error);
            this._refreshStatus = 'error';
            this.syncRefreshIndicator(root);
            this.app.phoneShell.showNotification?.('X', error?.message || '帖子刷新失败', '×');
        } finally {
            this.isRefreshing = false;
            const activeRoot = document.querySelector('.phone-view-current .xapp-root[data-page="home"]') || root;
            this.syncRefreshIndicator(activeRoot);
            if (this._refreshTimer) clearTimeout(this._refreshTimer);
            const finalStatus = this._refreshStatus;
            this._refreshTimer = setTimeout(() => {
                if (this._refreshStatus !== finalStatus) return;
                this._refreshStatus = 'idle';
                this.syncRefreshIndicator(document.querySelector('.phone-view-current .xapp-root[data-page="home"]'));
            }, 1300);
        }
    }

    async generatePostImage({ postId, source = 'feed', index, promptText = '', descriptionText = '', clearPreviousImage = false } = {}) {
        if (!postId || !Number.isInteger(index) || index < 0) return null;
        const post = this.app.xData.getPost(postId, source);
        if (!post || !Array.isArray(post.images) || !post.images[index]) return null;

        const currentState = this._getXPostImageState(post, index);
        if (currentState?.status === 'loading') return null;

        const runtime = typeof window !== 'undefined' ? window.VirtualPhone : null;
        const generationManager = runtime?.imageGenerationManager;
        const uploadManager = runtime?.imageManager;
        const parsed = this._parseXImageItem(post.images[index], currentState);
        const sourcePrompt = String(parsed.prompt || promptText || '').trim();
        const description = String(descriptionText || parsed.description || sourcePrompt || '帖子配图').trim();
        const previousImagePath = clearPreviousImage
            ? this._getManagedXGeneratedImagePath(post, index)
            : '';
        if (!sourcePrompt) return null;

        if (!generationManager?.generate) {
            const errorMessage = '生图管理器未初始化';
            this._setXPostImageState(post, index, {
                status: 'failed',
                error: errorMessage,
                prompt: sourcePrompt,
                description,
                generatedImageUrl: ''
            });
            this._persistXPost(post, source);
            this._refreshXPostMedia(postId, source);
            this.app.phoneShell.showNotification?.('X', errorMessage, '×');
            return null;
        }

        if (this.app?.storage && generationManager.storage !== this.app.storage) {
            generationManager.storage = this.app.storage;
        }
        this._setXPostImageState(post, index, {
            status: 'loading',
            error: '',
            prompt: sourcePrompt,
            description,
            generatedImageUrl: ''
        });
        this._persistXPost(post, source);
        this._refreshXPostMedia(postId, source);

        let generationPrompt = sourcePrompt;
        try {
            const shouldTranslateUserPrompt = post.isUserPost === true
                && this._hasCjkText(sourcePrompt)
                && typeof generationManager.translatePromptToEnglish === 'function';
            if (shouldTranslateUserPrompt) {
                generationPrompt = String(
                    await generationManager.translatePromptToEnglish(sourcePrompt, 'x') || sourcePrompt
                ).trim();
                this._setXPostImageState(post, index, {
                    prompt: generationPrompt,
                    description
                });
                this._persistXPost(post, source);
                this._refreshXPostMedia(postId, source);
            }

            const result = await generationManager.generate({
                app: 'x',
                prompt: generationPrompt
            });
            const rawImage = String(result?.imageUrl || result?.imageData || '').trim();
            const imagePath = await this._persistXGeneratedImage(rawImage, uploadManager);
            if (!imagePath) throw new Error('生图成功但没有返回可保存的图片');

            post.images[index] = imagePath;
            this._setXPostImageState(post, index, {
                status: 'done',
                error: '',
                prompt: generationPrompt,
                description,
                generatedImageUrl: imagePath,
                imageProvider: String(result?.provider || '').trim(),
                imageModel: String(result?.model || '').trim()
            });
            this._persistXPost(post, source);
            if (previousImagePath && previousImagePath !== imagePath) {
                await this._deleteManagedXImages([previousImagePath]);
            }
            this._refreshXPostMedia(postId, source);
            this.app.phoneShell.showNotification?.('X', '配图生成完成', '✓');
            return imagePath;
        } catch (error) {
            const message = String(error?.message || '图片生成失败').trim();
            this._setXPostImageState(post, index, {
                status: 'failed',
                error: message,
                prompt: generationPrompt,
                description,
                generatedImageUrl: previousImagePath
            });
            this._persistXPost(post, source);
            this._refreshXPostMedia(postId, source);
            this.app.phoneShell.showNotification?.('X', message, '×');
            return null;
        }
    }

    async _persistXGeneratedImage(rawImage, uploadManager) {
        const image = String(rawImage || '').trim();
        if (!image) return '';
        if (/^\/backgrounds\//i.test(image)) return image;
        if (!uploadManager) throw new Error('图片上传管理器未初始化');

        let uploaded = '';
        if (/^data:image\//i.test(image)) {
            if (typeof uploadManager.uploadDataUrl !== 'function') {
                throw new Error('图片上传管理器不支持保存生图结果');
            }
            uploaded = await uploadManager.uploadDataUrl(image, 'x_img');
        } else {
            if (typeof uploadManager.uploadBlob !== 'function') {
                throw new Error('图片上传管理器不支持保存网络图片');
            }
            const response = await fetch(image, { cache: 'no-store' });
            if (!response.ok) throw new Error(`读取生图结果失败（HTTP ${response.status}）`);
            uploaded = await uploadManager.uploadBlob(await response.blob(), 'x_img');
        }

        const normalized = String(uploaded || '').trim();
        if (!/^\/backgrounds\//i.test(normalized)) {
            throw new Error('X 配图保存失败：未得到本地图片路径');
        }
        return normalized;
    }

    _persistXPost(post, source = 'feed') {
        if (source === 'user' || post?.isUserPost) {
            const posts = this.app.xData.getUserPosts();
            const index = posts.findIndex((item) => String(item?.id || '') === String(post?.id || ''));
            if (index >= 0) posts[index] = post;
            this.app.xData.saveUserPosts(posts);
            return;
        }
        if (source === 'following') {
            const posts = this.app.xData.getFollowingPosts();
            const index = posts.findIndex((item) => String(item?.id || '') === String(post?.id || ''));
            if (index >= 0) posts[index] = post;
            this.app.xData.saveFollowingPosts(posts);
            return;
        }
        const posts = this.app.xData.getPosts();
        const index = posts.findIndex((item) => String(item?.id || '') === String(post?.id || ''));
        if (index >= 0) posts[index] = post;
        this.app.xData.savePosts(posts);
    }

    _refreshXPostMedia(postId, source = 'feed') {
        if (typeof document === 'undefined') return;
        const root = document.querySelector('.phone-view-current .xapp-root');
        const post = this.app.xData.getPost(postId, source);
        if (!root || !post) return;

        root.querySelectorAll('.xapp-post-images[data-xapp-media-post-id]').forEach((container) => {
            if (container.dataset.xappMediaPostId !== String(postId)) return;
            if ((container.dataset.xappMediaSource || 'feed') !== source) return;
            container.outerHTML = this.renderMedia(post, { source });
        });
        this.bindMediaEvents(root);
    }

    setPullRefreshHint(root, height, text, ready = false) {
        const indicator = root?.querySelector('#xapp-pull-refresh-indicator');
        const inner = root?.querySelector('#xapp-pull-refresh-inner');
        if (!indicator || !inner) return;
        indicator.classList.remove('is-loading', 'is-success', 'is-error');
        indicator.classList.toggle('is-ready', !!ready);
        indicator.style.height = `${Math.max(0, height)}px`;
        inner.innerHTML = `<i class="fa-solid fa-arrow-down" aria-hidden="true"></i><span>${this._escapeHtml(text)}</span>`;
    }

    syncRefreshIndicator(root) {
        const indicator = root?.querySelector('#xapp-pull-refresh-indicator');
        const inner = root?.querySelector('#xapp-pull-refresh-inner');
        if (!indicator || !inner) return;
        indicator.classList.remove('is-ready', 'is-loading', 'is-success', 'is-error');

        if (this.isRefreshing || this._refreshStatus === 'loading') {
            indicator.classList.add('is-loading');
            indicator.style.height = '38px';
            inner.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>正在刷新 X...</span>';
            return;
        }
        if (this._refreshStatus === 'success') {
            indicator.classList.add('is-success');
            indicator.style.height = '38px';
            inner.innerHTML = '<i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>刷新成功</span>';
            return;
        }
        if (this._refreshStatus === 'error') {
            indicator.classList.add('is-error');
            indicator.style.height = '38px';
            inner.innerHTML = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>刷新失败</span>';
            return;
        }
        indicator.style.height = '0px';
        inner.innerHTML = '';
    }

    async renderXWorldbookList(root = document.querySelector('.phone-view-current .xapp-root')) {
        const container = root?.querySelector('#xapp-worldbook-list');
        const runtime = typeof window !== 'undefined' ? window.VirtualPhone : null;
        const manager = runtime?.worldbookManager;
        if (!container || !manager) return;
        await manager.renderWorldbookSelector?.(container, 'x');
    }

    openProfileEditor(root = document.querySelector('.phone-view-current .xapp-root')) {
        const overlay = root?.querySelector('.xapp-profile-edit-overlay');
        if (!overlay) return;
        overlay.classList.remove('is-hidden');
        requestAnimationFrame(() => root.querySelector('#xapp-profile-edit-nickname')?.focus());
    }

    closeProfileEditor(root = document.querySelector('.phone-view-current .xapp-root')) {
        const overlay = root?.querySelector('.xapp-profile-edit-overlay');
        if (!overlay) return;
        overlay.classList.add('is-hidden');
        root.querySelector('.xapp-profile-edit-button')?.focus();
    }

    saveProfileEdits(values = {}) {
        const profile = this.app.xData.getProfile();
        return this.app.xData.saveProfile({
            ...profile,
            nickname: String(values.nickname || '').trim(),
            following: Math.max(0, Number.parseInt(values.following, 10) || 0),
            followers: Math.max(0, Number.parseInt(values.followers, 10) || 0)
        });
    }

    syncProfilePage(root, profile) {
        if (!root || !profile) return;
        const displayName = this._getXDisplayName(profile);
        const nameElement = root.querySelector('.xapp-profile-name-text');
        if (nameElement) nameElement.textContent = displayName;

        const followingElement = root.querySelector('[data-xapp-profile-stat="following"]');
        const followersElement = root.querySelector('[data-xapp-profile-stat="followers"]');
        if (followingElement) followingElement.textContent = this._formatCount(profile.following);
        if (followersElement) followersElement.textContent = this._formatCount(profile.followers);

        root.querySelectorAll('.xapp-profile-posts .xapp-post-identity strong').forEach((element) => {
            element.textContent = displayName;
        });
    }

    openPost(postId, focusComposer = false, source = 'feed') {
        if (!this.app.xData.getPost(postId, source)) return;
        this.detailReturnPage = this.currentPage === 'profile' ? 'profile' : 'home';
        this.currentPage = 'detail';
        this.currentPostId = postId;
        this.currentPostSource = source;
        this.currentReplyCommentId = null;
        this.render();

        if (focusComposer) {
            requestAnimationFrame(() => document.getElementById('xapp-reply-input')?.focus());
        }
    }

    returnFromDetail() {
        this.currentPage = this.detailReturnPage === 'profile' ? 'profile' : 'home';
        this.currentPostId = null;
        this.currentPostSource = 'feed';
        this.detailReturnPage = 'home';
        this.currentReplyCommentId = null;
        this.render();
    }

    openProfile() {
        this.currentPage = 'profile';
        this.currentPostId = null;
        this.currentPostSource = 'feed';
        this.detailReturnPage = 'home';
        this.currentReplyCommentId = null;
        this.render();
    }

    openCompose() {
        this.composeReturnPage = ['home', 'profile'].includes(this.currentPage) ? this.currentPage : 'home';
        this.pendingComposeImages = [];
        this.composeUploadInProgress = false;
        this.composeSessionId += 1;
        this.currentPage = 'compose';
        this.currentPostId = null;
        this.currentPostSource = 'feed';
        this.currentReplyCommentId = null;
        this.render();
    }

    async returnFromCompose() {
        const abandonedImages = [...this.pendingComposeImages];
        this.pendingComposeImages = [];
        this.composeUploadInProgress = false;
        this.composeSessionId += 1;
        this.currentPage = this.composeReturnPage === 'profile' ? 'profile' : 'home';
        this.composeReturnPage = 'home';
        this.render();
        await this._deleteManagedXImages(abandonedImages);
    }

    openSettings() {
        this.currentPage = 'settings';
        this.currentPostId = null;
        this.currentPostSource = 'feed';
        this.currentReplyCommentId = null;
        this.render();
    }

    returnFromSettings() {
        this.currentPage = 'profile';
        this.render();
    }

    returnFromProfile() {
        this.currentPage = 'home';
        this.render();
    }

    setReplyTarget(commentId) {
        const post = this.app.xData.getPost(this.currentPostId, this.currentPostSource);
        const comment = post?.commentList?.find((item) => item.id === commentId);
        if (!comment) return;

        this.currentReplyCommentId = comment.id;
        const context = document.getElementById('xapp-reply-context');
        const contextText = document.getElementById('xapp-reply-context-text');
        const input = document.getElementById('xapp-reply-input');
        const displayName = comment.name || '该用户';

        if (context) context.classList.remove('is-hidden');
        if (contextText) contextText.textContent = `回复 ${displayName}`;
        if (input) {
            input.placeholder = `回复 ${displayName}`;
            input.focus();
        }
    }

    clearReplyTarget(focusInput = false) {
        this.currentReplyCommentId = null;
        const context = document.getElementById('xapp-reply-context');
        const input = document.getElementById('xapp-reply-input');

        context?.classList.add('is-hidden');
        if (input) {
            input.placeholder = '发布你的回复';
            if (focusInput) input.focus();
        }
    }

    submitReply() {
        const input = document.getElementById('xapp-reply-input');
        const text = input?.value?.trim();
        if (!input || !text) return;

        const postId = this.currentPostId;
        const source = this.currentPostSource;
        const replyToCommentId = this.currentReplyCommentId;

        const result = this.app.xData.addComment(
            postId,
            text,
            replyToCommentId,
            source
        );
        if (!result) return;

        input.value = '';
        this.clearReplyTarget();
        this.syncReplySendState();
        this.refreshDetailComments(result.post, result.rootId || result.comment.id);
        input.focus();
        void this.triggerCommentAIReaction(postId, result.comment.id, source);
    }

    refreshDetailComments(post, focusCommentId = null) {
        const comments = document.getElementById('xapp-comments');
        if (comments) comments.innerHTML = this.renderComments(post);

        document.querySelectorAll('.phone-view-current .xapp-root [data-xapp-comment-count]').forEach((element) => {
            element.textContent = this._formatCount(post.comments);
        });
        document.querySelectorAll('.phone-view-current .xapp-root [data-xapp-like-count]').forEach((element) => {
            element.textContent = this._formatCount(post.likes);
        });

        if (!focusCommentId) return;
        requestAnimationFrame(() => {
            const target = document.querySelector(`.phone-view-current .xapp-comment[data-comment-id="${this._escapeSelector(focusCommentId)}"]`);
            target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        });
    }

    syncReplySendState() {
        const input = document.getElementById('xapp-reply-input');
        const sendButton = document.getElementById('xapp-reply-send');
        if (sendButton) sendButton.disabled = !input?.value?.trim();
    }

    async updateProfileAvatar(file) {
        try {
            const cropper = new ImageCropper({
                title: '裁剪头像',
                aspectRatio: 1,
                outputWidth: 320,
                outputHeight: 320,
                quality: 0.9,
                maxFileSize: 5 * 1024 * 1024
            });
            const croppedImage = await cropper.open(file);
            const avatarUrl = await window.VirtualPhone?.imageManager?.uploadDataUrl?.(croppedImage, 'x_avatar');
            if (!avatarUrl || /^data:/i.test(String(avatarUrl))) {
                throw new Error('头像没有保存到图片目录');
            }

            const profile = this.app.xData.getProfile();
            const oldAvatar = String(profile.avatar || '').trim();
            this.app.xData.saveProfile({ ...profile, avatar: String(avatarUrl).trim() });

            if (oldAvatar && oldAvatar !== avatarUrl) {
                const cleanupTask = window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(
                    oldAvatar,
                    { quiet: true, skipIfReferenced: true }
                );
                cleanupTask?.catch?.(() => {});
            }

            this.app.phoneShell.showNotification?.('X', '头像已更新', '✓');
            this.render();
        } catch (error) {
            if (error?.message === '用户取消') return;
            console.error('[X] 更新头像失败:', error);
            this.app.phoneShell.showNotification?.('X', error?.message || '头像更新失败', '×');
        }
    }

    _getSillyTavernPersonaAvatar() {
        if (typeof document === 'undefined') return '';

        try {
            const selectedAvatar = document.querySelector('#user_avatar_block .avatar-container.selected img');
            if (selectedAvatar?.src) return selectedAvatar.src;

            const topBarAvatar = document.querySelector('#rm_button_panel_persona img');
            if (topBarAvatar?.src) return topBarAvatar.src;
        } catch (error) {
            console.warn('[X] 获取默认 Persona 头像失败:', error);
        }
        return '';
    }

    _getXDisplayAvatar(profile = null) {
        const safeProfile = profile || this.app.xData.getProfile();
        const customAvatar = String(safeProfile?.avatar || '').trim();
        return customAvatar || this._getSillyTavernPersonaAvatar() || PROFILE_AVATAR;
    }

    _getXDisplayName(profile = null) {
        const safeProfile = profile || this.app.xData.getProfile();
        return String(safeProfile?.nickname || this.app.xData.getCurrentUserName?.() || 'X 用户').trim() || 'X 用户';
    }

    _resolvePostAuthor(post = {}) {
        if (post.isUserPost) {
            return {
                ...(post.author || {}),
                name: this._getXDisplayName(),
                avatar: 'profile',
                accountType: 'personal'
            };
        }
        const author = post.author && typeof post.author === 'object' ? post.author : {};
        const wechatAvatar = this._resolveWechatContactAvatar(author.name);
        return wechatAvatar ? { ...author, avatar: wechatAvatar } : author;
    }

    _normalizeWechatContactName(value = '') {
        return String(value || '')
            .normalize('NFKC')
            .trim()
            .replace(/^@+/, '')
            .replace(/\s+/g, '')
            .replace(/[（(][^（）()]*[）)]/g, '')
            .toLowerCase();
    }

    _normalizeWechatAvatarPath(value = '') {
        const raw = String(value || '').trim();
        if (!raw || raw === '👤' || raw === '👥') return '';
        if (/^(?:data:image|https?:\/\/|\/|blob:)/i.test(raw)) return raw;
        const cleaned = raw
            .replace(/^["']|["']$/g, '')
            .replace(/^\.?\/*/, '')
            .replace(/^apps\/wechat\/avatars\//i, '')
            .replace(/^wechat\/avatars\//i, '')
            .replace(/^avatars\//i, '');
        if (!cleaned || /\s/.test(cleaned)) return '';
        if (/^(?:male|female)(?:_elder)?\d+$/i.test(cleaned)) {
            return new URL(`../wechat/avatars/${cleaned}.png`, import.meta.url).href;
        }
        if (/^[a-z0-9._-]+\.(?:png|jpg|jpeg|webp|gif)$/i.test(cleaned)) {
            return new URL(`../wechat/avatars/${cleaned}`, import.meta.url).href;
        }
        return '';
    }

    _resolveWechatContactAvatar(authorName = '') {
        const targetName = this._normalizeWechatContactName(authorName);
        if (!targetName || typeof window === 'undefined') return '';

        const runtime = window.VirtualPhone || {};
        const wechatApp = runtime.wechatApp || null;
        const wechatData = wechatApp?.wechatData || runtime.cachedWechatData || null;
        const contacts = Array.isArray(wechatData?.getContacts?.()) ? wechatData.getContacts() : [];
        const contact = contacts.find((item) => (
            [item?.name, item?.remark, item?.nickname]
                .some((alias) => this._normalizeWechatContactName(alias) === targetName)
        ));
        if (!contact) return '';

        const lookupKeys = [contact.id, contact.name, contact.remark].filter(Boolean);
        const candidates = [contact.avatar];
        lookupKeys.forEach((key) => candidates.push(wechatData?.getContactAutoAvatar?.(key)));

        if (!candidates.some((value) => this._normalizeWechatAvatarPath(value))) {
            const gender = wechatData?.getContactGender?.(contact.id || contact.name) || 'unknown';
            const avatarGroup = wechatData?.getContactAvatarGroup?.(contact.id || contact.name) || '';
            candidates.push(wechatApp?._resolveAutoAvatarForName?.(contact.name, gender, avatarGroup));
        }

        for (const candidate of candidates) {
            const normalized = this._normalizeWechatAvatarPath(candidate);
            if (normalized) return normalized;
        }
        return '';
    }

    _parseXImageItem(value, state = null) {
        const text = String(value || '').trim();
        const stateUrl = String(state?.generatedImageUrl || '').trim();
        const directMatch = text.match(/^(?:\[[^\]]+\]\s*)?((?:https?:\/\/|\/backgrounds\/)[^\s)）]+)/i);
        const realUrl = /^\/(?:backgrounds)\//i.test(stateUrl) || /^https?:\/\//i.test(stateUrl)
            ? stateUrl
            : String(directMatch?.[1] || '').trim();
        const parts = [];
        const bracketPattern = /[（(]\s*([\s\S]*?)\s*[)）]/g;
        let match;
        while ((match = bracketPattern.exec(text)) !== null) {
            const part = String(match[1] || '').trim();
            if (part) parts.push(part);
        }

        const stateDescription = String(state?.description || '').trim();
        const statePrompt = String(state?.prompt || '').trim();
        const description = stateDescription || parts[0] || '';
        const prompt = statePrompt || (parts.length >= 2 ? parts.slice(1).join(', ') : (parts[0] || ''));
        return { realUrl, description, prompt };
    }

    _hasCjkText(value = '') {
        return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(String(value || ''));
    }

    _extractManagedXImagePath(value) {
        const text = String(value || '').trim();
        const match = text.match(/(?:^|\s|\])((?:\/backgrounds\/phone_x_img_)[^\s)）?#]+)/i);
        return String(match?.[1] || '').trim();
    }

    _getManagedXGeneratedImagePath(post, index) {
        const candidates = [
            Array.isArray(post?.images) ? post.images[index] : '',
            this._getXPostImageState(post, index)?.generatedImageUrl
        ];
        for (const candidate of candidates) {
            const path = this._extractManagedXImagePath(candidate);
            if (path) return path;
        }
        return '';
    }

    _getXPostImageState(post, index) {
        if (!post || !Array.isArray(post.imageGenerationStates)) return null;
        const state = post.imageGenerationStates[index];
        return state && typeof state === 'object' ? state : null;
    }

    _setXPostImageState(post, index, nextState) {
        if (!post || !Number.isInteger(index) || index < 0) return null;
        if (!Array.isArray(post.imageGenerationStates)) post.imageGenerationStates = [];
        const previous = this._getXPostImageState(post, index) || {};
        post.imageGenerationStates[index] = { ...previous, ...nextState };
        return post.imageGenerationStates[index];
    }

    _getReplyTargetName(post, replyTo) {
        if (!replyTo) return '';
        const comments = Array.isArray(post?.commentList) ? post.commentList : [];
        return comments.find((comment) => comment.handle === replyTo || comment.id === replyTo)?.name || '';
    }

    _resolveWechatForwardAvatar(target, wechatData, { isGroup = false } = {}) {
        if (!target) return '';
        const directAvatar = this._normalizeWechatForwardAvatarPath(target.avatar);
        if (directAvatar) return directAvatar;
        if (!wechatData || isGroup) return '';

        const keys = [target.id, target.contactId, target.name]
            .filter(Boolean)
            .map(value => String(value).trim());
        for (const key of keys) {
            const autoAvatar = this._normalizeWechatForwardAvatarPath(wechatData.getContactAutoAvatar?.(key));
            if (autoAvatar) return autoAvatar;
        }

        const autoMap = wechatData.getContactAutoAvatarMap?.();
        if (autoMap && typeof autoMap === 'object') {
            for (const key of keys) {
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
        const avatarText = String(avatar || '').trim();
        const imageAvatar = this._normalizeWechatForwardAvatarPath(avatarText);
        if (imageAvatar) {
            return `<img src="${this._escapeAttr(imageAvatar)}" alt="">`;
        }
        if (avatarText) return this._escapeHtml(avatarText);
        return this._escapeHtml(isGroup ? '👥' : this._getAvatarInitial(fallbackName || 'X'));
    }

    _getAvatarInitial(name = '') {
        return Array.from(String(name || '').trim().replace(/^@/, ''))[0] || 'X';
    }

    _formatDirectMessageTime(timestamp, fallback = '') {
        const value = Number(timestamp) || 0;
        if (!value) return String(fallback || '刚刚');
        const elapsed = Math.max(0, Date.now() - value);
        if (elapsed < 60000) return '刚刚';
        if (elapsed < 3600000) return `${Math.max(1, Math.floor(elapsed / 60000))} 分钟前`;
        const date = new Date(value);
        const now = new Date();
        if (date.toDateString() === now.toDateString()) {
            return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        }
        return `${date.getMonth() + 1}/${date.getDate()}`;
    }

    _formatCount(value) {
        const count = Math.max(0, Number.parseInt(value, 10) || 0);
        if (count >= 10000) {
            const wan = count / 10000;
            return `${Number.isInteger(wan) ? wan.toFixed(0) : wan.toFixed(1)}万`;
        }
        return count.toLocaleString('zh-CN');
    }

    _renderText(value) {
        return replacePhoneEmojiTokens(this._escapeHtml(value), {
            size: 16,
            className: 'xapp-inline-emoji'
        }).replace(/\n/g, '<br>');
    }

    _escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    _escapeAttr(value) {
        return this._escapeHtml(value);
    }

    _escapeSelector(value) {
        const text = String(value || '');
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(text);
        return text.replace(/["\\]/g, '\\$&');
    }
}
