/* ========================================================
 *  Yuzuki Phone
 *  X app data - posts, comments, and local replies
 * ======================================================== */

import { readPhoneContextLimit } from '../../config/context-settings.js';
import { applyPhoneTagFilter } from '../../config/tag-filter.js';

const STORAGE_KEY = 'x_posts';
const PROFILE_KEY = 'x_profile';
const USER_POSTS_KEY = 'x_user_posts';
const DIRECT_MESSAGES_KEY = 'x_direct_messages';
const FOLLOWING_ACCOUNTS_KEY = 'x_following_accounts';
const FOLLOWED_ACCOUNT_PROFILES_KEY = 'x_followed_account_profiles';
const FOLLOWING_POSTS_KEY = 'x_following_posts';
const FEED_RESPONSE_HISTORY_KEY = 'x_feed_response_history';
const CONTEXT_SETTING_KEYS = Object.freeze({
    includeCharacterUser: 'x_include_character_user_context',
    includeTavernText: 'x_include_tavern_text_context'
});

const DEFAULT_PROFILE = {
    avatar: '',
    nickname: '',
    gender: 'unknown',
    following: 0,
    followers: 0
};

const DEFAULT_POSTS = [];
const LEGACY_DEFAULT_POST_IDS = new Set([
    'x-post-sol-61',
    'x-post-business-launch',
    'x-post-yuzuki-preview'
]);

const clone = (value) => JSON.parse(JSON.stringify(value));

export class XData {
    constructor(storage) {
        this.storage = storage || null;
        this._posts = null;
        this._profile = null;
        this._userPosts = null;
        this._directMessageThreads = null;
        this._followedAccountKeys = null;
        this._followedAccounts = null;
        this._followingPosts = null;
        this._refreshPromise = null;
        this._feedGenerationEpoch = 0;
        this._lastAIResponse = null;
    }

    attachStorage(storage) {
        if (storage) this.storage = storage;
        return this;
    }

    getPosts() {
        if (Array.isArray(this._posts)) return this._posts;

        const saved = this.storage?.get?.(STORAGE_KEY, null);
        const parsed = this._parsePosts(saved);
        if (Array.isArray(parsed)) {
            const storedSnapshot = JSON.stringify(parsed);
            const migrated = parsed.filter((post) => !LEGACY_DEFAULT_POST_IDS.has(String(post?.id || '').trim()));
            const normalized = this._sanitizePostsForStorage(migrated);
            const hasUserAuthoredPosts = normalized.some((post) => this._isCurrentUserPost(post));
            if (migrated.length !== parsed.length || JSON.stringify(normalized) !== storedSnapshot || hasUserAuthoredPosts) {
                this.savePosts(normalized);
            } else {
                this._posts = normalized;
            }
        } else {
            this._posts = clone(DEFAULT_POSTS);
            this.savePosts(this._posts);
        }
        return this._posts;
    }

    getProfile() {
        if (this._profile && typeof this._profile === 'object') return this._profile;

        const saved = this.storage?.get?.(PROFILE_KEY, null);
        const parsed = this._parseObject(saved) || {};
        this._profile = this._normalizeProfile({ ...DEFAULT_PROFILE, ...parsed });
        return this._profile;
    }

    saveProfile(profile = this._profile) {
        const normalized = this._normalizeProfile({
            ...DEFAULT_PROFILE,
            ...(profile && typeof profile === 'object' ? profile : {})
        });
        this._profile = normalized;
        this.storage?.set?.(PROFILE_KEY, JSON.stringify(normalized));
        if (Array.isArray(this._posts)) this.savePosts(this._posts);
        return normalized;
    }

    _getCurrentFollowersCount() {
        return Math.max(0, Number.parseInt(this.getProfile()?.followers, 10) || 0);
    }

    _parseFollowerNumber(rawValue) {
        if (rawValue === null || rawValue === undefined) return null;
        const text = String(rawValue)
            .trim()
            .replace(/[,，\s]/g, '')
            .replace(/(?:人|位|名|个)$/u, '');
        if (!text) return null;

        const match = text.match(/^(\d+(?:\.\d+)?)(亿|万|千|[kKwW])?$/u);
        if (!match) return null;

        let value = Number(match[1]);
        if (!Number.isFinite(value)) return null;
        const unit = String(match[2] || '').toLowerCase();
        if (unit === '亿') value *= 100000000;
        if (unit === '万' || unit === 'w') value *= 10000;
        if (unit === '千' || unit === 'k') value *= 1000;
        if (!Number.isSafeInteger(Math.round(value))) return null;
        return Math.max(0, Math.round(value));
    }

    _extractFollowersCount(rawText) {
        const source = String(rawText || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
        const twitterBlocks = [...source.matchAll(/<\s*Twitter\b[^>]*>([\s\S]*?)<\s*\/\s*Twitter\s*>/gi)]
            .map((match) => String(match[1] || ''));
        if (twitterBlocks.length === 0) return null;

        const candidates = [];
        const pattern = /(?:^|\r?\n)\s*(?:当前)?用户粉丝(?:数量|数)?\s*[：:]\s*([0-9][0-9,，]*(?:\.\d+)?(?:亿|万|千|[kKwW])?(?:人|位|名|个)?)\s*(?=\r?\n|$)/giu;
        twitterBlocks.forEach((block) => {
            let match;
            while ((match = pattern.exec(block)) !== null) {
                const parsed = this._parseFollowerNumber(match[1]);
                if (parsed !== null) candidates.push(parsed);
            }
            pattern.lastIndex = 0;
        });
        return candidates.length > 0 ? candidates[candidates.length - 1] : null;
    }

    _updateFollowersFromText(rawText) {
        const current = this._getCurrentFollowersCount();
        const parsed = this._extractFollowersCount(rawText);
        if (parsed === null || parsed <= 0 || parsed === current) return current;

        this.saveProfile({
            ...this.getProfile(),
            followers: parsed
        });
        return parsed;
    }

    getUserPosts() {
        if (Array.isArray(this._userPosts)) return this._userPosts;

        const saved = this.storage?.get?.(USER_POSTS_KEY, null);
        const parsed = this._parsePosts(saved);
        const storedSnapshot = Array.isArray(parsed) ? JSON.stringify(parsed) : '';
        this._userPosts = Array.isArray(parsed)
            ? this._sanitizePostsForStorage(parsed).map((post) => ({ ...post, isUserPost: true }))
            : [];
        if (Array.isArray(parsed) && JSON.stringify(this._userPosts) !== storedSnapshot) {
            this.saveUserPosts(this._userPosts);
        }
        return this._userPosts;
    }

    saveUserPosts(posts = this._userPosts) {
        const normalized = Array.isArray(posts)
            ? posts.map((post) => ({ ...post, isUserPost: true }))
            : [];
        this._userPosts = this._sanitizePostsForStorage(normalized);
        this.storage?.set?.(USER_POSTS_KEY, JSON.stringify(this._userPosts));
        return this._userPosts;
    }

    _normalizeUserPostIdentity(value) {
        return String(value || '')
            .normalize('NFKC')
            .trim()
            .replace(/^@+/, '')
            .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
            .replace(/\s+/g, '')
            .toLowerCase();
    }

    _getCurrentUserPostIdentities() {
        const identities = new Set();
        [
            this.getProfile()?.nickname,
            this.getCurrentUserName(),
            '{{user}}',
            '<user>'
        ].forEach((value) => {
            const normalized = this._normalizeUserPostIdentity(value);
            if (normalized) identities.add(normalized);
        });
        return identities;
    }

    _isCurrentUserPost(post = {}) {
        if (post?.isUserPost === true) return true;
        const authorName = this._normalizeUserPostIdentity(post?.author?.name);
        return !!authorName && this._getCurrentUserPostIdentities().has(authorName);
    }

    _mergeUserPostCollections(incoming = [], existing = []) {
        const merged = [];
        const seen = new Set();
        [...incoming, ...existing].forEach((post) => {
            if (!post || typeof post !== 'object' || Array.isArray(post)) return;
            const id = String(post.id || '').trim();
            const fallbackKey = [
                String(post.content || '').trim(),
                String(post.time || '').trim(),
                (Array.isArray(post.images) ? post.images : []).join('|')
            ].join('\n');
            const key = id ? `id:${id}` : `content:${fallbackKey}`;
            if (seen.has(key)) return;
            seen.add(key);
            merged.push({ ...post, isUserPost: true });
        });
        return merged;
    }

    publishUserPost(content = '', images = []) {
        const textImages = [];
        const mediaRegex = /\[(用户照片|个人图片|图片(?:-[^\]\r\n]+)?|视频)\]\s*[（(]\s*([^)）]+?)\s*[)）](?:\s*[（(]\s*([^)）]+?)\s*[)）])?/g;
        const cleanContent = String(content || '')
            .replace(mediaRegex, (match) => {
                textImages.push(String(match || '').trim());
                return '';
            })
            .replace(/\n{3,}/g, '\n\n')
            .trim()
            .slice(0, 280);
        const cleanImages = [
            ...(Array.isArray(images) ? images : []),
            ...textImages
        ]
            .map((image) => String(image || '').trim())
            .filter((image) => (
                /^\/backgrounds\//i.test(image)
                || /^\[(?:用户照片|个人图片|图片(?:-[^\]\r\n]+)?|视频)\]\s*[（(]\s*[^)）]+?\s*[)）](?:\s*[（(]\s*[^)）]+?\s*[)）])?$/i.test(image)
            ))
            .slice(0, 4);
        if (!cleanContent && cleanImages.length === 0) return null;

        const runtime = typeof window !== 'undefined' ? window.VirtualPhone : null;
        const phoneTime = this._getCurrentPhoneTimeContext(runtime);

        const post = {
            id: `x-post-user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            isUserPost: true,
            author: {
                avatar: 'profile',
                accountType: 'personal'
            },
            time: phoneTime.time || '刚刚',
            storyDate: phoneTime.date,
            storyWeekday: phoneTime.weekday,
            storyTimestamp: phoneTime.timestamp,
            content: cleanContent,
            comments: 0,
            likes: 0,
            commentList: [],
            images: cleanImages,
            imageGenerationStates: []
        };

        const posts = this.getUserPosts();
        posts.unshift(post);
        const savedPosts = this.saveUserPosts(posts);
        return savedPosts.find((item) => item.id === post.id) || post;
    }

    _normalizeReactionIdentity(value, fallback = '') {
        const normalized = String(value || '')
            .trim()
            .replace(/^@+/, '')
            .replace(/\s+/g, ' ')
            .slice(0, 80);
        return normalized || fallback;
    }

    _parseRelativeTimeToMinutes(value) {
        const text = String(value || '').trim().replace(/\s+/g, '');
        if (!text || /^(?:刚刚|现在)$/.test(text)) return 0;

        const minuteMatch = text.match(/(\d+)(?:个)?(?:分钟|分)(?:前)?/);
        if (minuteMatch) return Math.max(0, Number.parseInt(minuteMatch[1], 10) || 0);

        const hourMatch = text.match(/(\d+)(?:个)?小时(?:前)?/);
        if (hourMatch) return Math.max(0, (Number.parseInt(hourMatch[1], 10) || 0) * 60);

        if (/昨天/.test(text)) return 24 * 60;
        const dayMatch = text.match(/(\d+)(?:个)?天(?:前)?/);
        if (dayMatch) return Math.max(0, (Number.parseInt(dayMatch[1], 10) || 0) * 24 * 60);

        const weekMatch = text.match(/(\d+)(?:个)?(?:周|星期)(?:前)?/);
        if (weekMatch) return Math.max(0, (Number.parseInt(weekMatch[1], 10) || 0) * 7 * 24 * 60);
        return 0;
    }

    _formatRelativeTimeFromMinutes(value) {
        const minutes = Math.max(0, Math.floor(Number(value) || 0));
        if (minutes < 1) return '刚刚';
        if (minutes < 60) return `${minutes}分钟前`;
        if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}小时前`;
        if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / (24 * 60))}天前`;
        return `${Math.floor(minutes / (7 * 24 * 60))}周前`;
    }

    _assignCommentTimes(post = {}, comments = []) {
        const list = Array.isArray(comments) ? comments : [];
        if (list.length === 0) return list;

        const postAgeMinutes = this._parseRelativeTimeToMinutes(post?.time);
        const commentsById = new Map();
        const commentsByHandle = new Map();
        const usedAges = new Set();
        list.forEach((comment) => {
            if (comment?.id) commentsById.set(String(comment.id), comment);
            if (comment?.handle) commentsByHandle.set(String(comment.handle), comment);
            const savedAge = Number(comment?.timeOffsetMinutes);
            if (Number.isFinite(savedAge)) usedAges.add(Math.max(0, Math.floor(savedAge)));
        });

        const readAge = (comment) => {
            const savedAge = Number(comment?.timeOffsetMinutes);
            if (Number.isFinite(savedAge)) return Math.max(0, Math.floor(savedAge));
            return this._parseRelativeTimeToMinutes(comment?.time);
        };

        list.forEach((comment, index) => {
            if (!comment || typeof comment !== 'object') return;
            const savedAge = Number(comment.timeOffsetMinutes);
            if (Number.isFinite(savedAge)) {
                comment.timeOffsetMinutes = Math.max(0, Math.floor(savedAge));
                comment.time = this._formatRelativeTimeFromMinutes(comment.timeOffsetMinutes);
                return;
            }

            const currentTime = String(comment.time || '').trim();
            const isUserComment = comment.avatar === 'profile'
                || String(comment.id || '').startsWith('x-comment-user-');
            if (isUserComment || (currentTime && currentTime !== '刚刚')) {
                comment.timeOffsetMinutes = this._parseRelativeTimeToMinutes(currentTime);
                comment.time = currentTime || '刚刚';
                usedAges.add(comment.timeOffsetMinutes);
                return;
            }

            const target = commentsByHandle.get(String(comment.replyTo || ''))
                || commentsById.get(String(comment.parentId || ''))
                || null;
            const targetAge = target ? readAge(target) : null;
            const maxAge = target
                ? Math.max(0, Math.min(postAgeMinutes, targetAge > 0 ? targetAge - 1 : 0))
                : Math.max(0, postAgeMinutes - 1);
            const seedText = `${post?.id || post?.content || post?.time || 'x'}|${comment.id || ''}|${comment.name || ''}|${comment.text || ''}|${index}`;
            const seed = Number.parseInt(this._slugForText(seedText), 36) || index;
            let age = maxAge > 0 ? seed % (maxAge + 1) : 0;

            if (maxAge > 0 && usedAges.has(age)) {
                for (let step = 1; step <= maxAge; step += 1) {
                    const candidate = (age + step) % (maxAge + 1);
                    if (!usedAges.has(candidate)) {
                        age = candidate;
                        break;
                    }
                }
            }

            comment.timeOffsetMinutes = age;
            comment.time = this._formatRelativeTimeFromMinutes(age);
            usedAges.add(age);
        });
        return list;
    }

    _readReactionMetric(...values) {
        for (const value of values) {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed) && parsed >= 0) return parsed;
        }
        return null;
    }

    _normalizeGeneratedComments(rawComments = [], limit = 10) {
        const profileName = this._normalizeReactionIdentity(
            this.getProfile()?.nickname || this.getCurrentUserName()
        ).toLowerCase();
        return (Array.isArray(rawComments) ? rawComments : [])
            .map((comment) => {
                const name = this._normalizeReactionIdentity(comment?.name, 'X 用户');
                return {
                    name,
                    text: String(comment?.text || '').trim().slice(0, 500),
                    accountType: this._normalizeAccountType(comment?.accountType || comment?.type),
                    replyTo: this._normalizeReactionIdentity(comment?.replyTo),
                    likes: Math.max(0, Number.parseInt(comment?.likes, 10) || 0)
                };
            })
            .filter((comment) => (
                comment.text
                && this._normalizeReactionIdentity(comment.name).toLowerCase() !== profileName
            ))
            .slice(0, Math.max(1, limit));
    }

    _normalizeUserPostReactionResult(rawResult = {}, post = {}, currentFollowers = this._getCurrentFollowersCount()) {
        const result = rawResult && typeof rawResult === 'object' ? rawResult : {};
        const profileName = this._normalizeReactionIdentity(
            this.getProfile()?.nickname || this.getCurrentUserName()
        ).toLowerCase();
        const comments = this._normalizeGeneratedComments(result.comments, 10);
        const likes = Array.from(new Set((Array.isArray(result.likes) ? result.likes : [])
            .map((name) => this._normalizeReactionIdentity(name))
            .filter((name) => name && name.toLowerCase() !== profileName)))
            .slice(0, 8);

        const seedText = `${post?.id || ''}|${post?.content || ''}|${post?.time || ''}`;
        const seed = Number.parseInt(this._slugForText(seedText), 36) || 1;
        const followerCount = Math.max(0, Number.parseInt(currentFollowers, 10) || 0);
        const engagementRange = Math.max(4, Math.min(80, Math.round(Math.sqrt(followerCount + 1) * 1.8) + 5));
        const hasVisibleActivity = comments.length > 0 || likes.length > 0;
        const fallbackLikeCount = hasVisibleActivity
            ? Math.max(likes.length, likes.length + 1 + (seed % engagementRange))
            : 0;
        const explicitLikeCount = this._readReactionMetric(result.likeCount, result.likesCount, result.totalLikes);
        const explicitCommentCount = this._readReactionMetric(
            result.commentCount,
            result.commentsCount,
            result.replyCount,
            result.replies
        );
        const parsedFollowers = this._parseFollowerNumber(result.followers);

        return {
            comments,
            likes,
            likeCount: Math.max(likes.length, explicitLikeCount ?? fallbackLikeCount),
            commentCount: Math.max(comments.length, explicitCommentCount ?? comments.length),
            followers: parsedFollowers !== null && parsedFollowers > 0 ? parsedFollowers : null
        };
    }

    async _urlToBase64(url) {
        try {
            const source = String(url || '').trim();
            if (!source) return null;
            if (/^data:image\//i.test(source)) return source;
            if (typeof fetch !== 'function' || typeof FileReader === 'undefined') return null;

            const response = await fetch(source, { cache: 'no-cache' });
            if (!response.ok) return null;
            const blob = await response.blob();
            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (error) {
            console.warn('[X] 图片转 Base64 供围观互动识别失败:', error);
            return null;
        }
    }

    async _buildPostInteractionDisplay(post = {}) {
        const sections = [];
        const content = String(post?.content || '').trim();
        if (content) sections.push(content);

        const images = (Array.isArray(post?.images) ? post.images : [])
            .map((image) => String(image || '').trim())
            .filter(Boolean)
            .slice(0, 4);
        if (images.length > 0) {
            const descriptions = images.map((image, index) => {
                const state = post?.imageGenerationStates?.[index];
                const rawImage = String(image || '').trim();
                const parts = [];
                const bracketPattern = /[（(]\s*([\s\S]*?)\s*[)）]/g;
                let match;
                while ((match = bracketPattern.exec(rawImage)) !== null) {
                    const part = String(match[1] || '').trim();
                    if (part) parts.push(part);
                }
                return String(state?.description || state?.prompt || parts[0] || '').trim() || `配图${index + 1}`;
            });
            sections.push(`配图：${descriptions.join('；')}`);

            if (typeof window !== 'undefined') {
                if (!window.VirtualPhone) window.VirtualPhone = {};
                if (!window.VirtualPhone._pendingImages) window.VirtualPhone._pendingImages = {};
                const imageTokens = [];
                for (const image of images) {
                    if (!/^(?:data:image|https?:\/\/|\/backgrounds\/)/i.test(image)) continue;
                    const base64 = await this._urlToBase64(image);
                    if (!base64) continue;
                    const tokenId = `__ST_PHONE_IMAGE_${Date.now()}_${Math.random().toString(36).slice(2, 7)}__`;
                    window.VirtualPhone._pendingImages[tokenId] = base64;
                    imageTokens.push(tokenId);
                }
                if (imageTokens.length > 0) {
                    sections.push(`[帖子附带了以下真实图片，请结合画面细节进行公开互动]\n${imageTokens.join('\n')}`);
                }
            }
        }

        return sections.join('\n') || '[空白帖子]';
    }

    _renderXPrompt(promptManager, feature, variables = {}) {
        const rawPrompt = promptManager?.getPromptForFeature?.('x', feature) || '';
        if (typeof promptManager?.renderPromptForFeature === 'function') {
            return promptManager.renderPromptForFeature('x', feature, variables);
        }
        return Object.entries(variables).reduce(
            (contentText, [key, value]) => contentText.split(`{{${key}}}`).join(String(value ?? '')),
            rawPrompt
        );
    }

    async _requestXJson(prompt, options = {}) {
        const runtime = typeof window !== 'undefined' ? window.VirtualPhone : null;
        const apiManager = runtime?.apiManager;
        if (!apiManager) throw new Error('API Manager 未初始化');

        const contextMessages = await this._collectContextMessages(this.getGenerationContextSettings());
        const messages = [
            {
                role: 'system',
                name: options.systemName || 'SYSTEM (X 公开互动)',
                content: options.systemContent
                    || '你是 X 公开互动数据生成引擎。只根据公开帖子与允许注入的上下文生成互动，并严格返回请求指定的 JSON。',
                isPhoneMessage: true
            },
            ...contextMessages,
            { role: 'user', content: prompt, isPhoneMessage: true }
        ];
        const context = this._getContext();
        const configuredMaxTokens = Number.parseInt(context?.max_response_length, 10)
            || Number.parseInt(context?.max_length, 10)
            || 1600;
        const response = await this._withTimeout(
            apiManager.callAI(messages, {
                appId: 'x',
                max_tokens: Math.max(Number(options.minTokens) || 1000, configuredMaxTokens)
            }),
            Number(options.timeoutMs) || 180000,
            options.timeoutMessage || 'X 互动生成超时，请稍后重试'
        );
        if (!response?.success) throw new Error(response?.error || options.failureMessage || 'X 互动生成失败');

        const rawText = String(response.summary || response.content || response.text || '').trim();
        const filteredText = String(applyPhoneTagFilter(rawText, { storage: this.storage }) || '').trim();
        const cleanedText = (filteredText || rawText).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        this._lastAIResponse = { kind: options.kind || 'interaction', rawText, cleanedText };

        const codeBlockMatch = cleanedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        const jsonSource = String(codeBlockMatch?.[1] || cleanedText).trim();
        const firstBrace = jsonSource.indexOf('{');
        const lastBrace = jsonSource.lastIndexOf('}');
        if (firstBrace < 0 || lastBrace <= firstBrace) {
            const error = new Error(options.parseMessage || 'X 互动解析失败，模型未返回 JSON');
            error.xReactionParseFailure = { rawText, cleanedText, kind: options.kind || 'interaction' };
            throw error;
        }

        try {
            const jsonText = jsonSource.slice(firstBrace, lastBrace + 1).replace(/,\s*([}\]])/g, '$1');
            return JSON.parse(jsonText);
        } catch (cause) {
            const error = new Error(options.parseMessage || 'X 互动解析失败，请检查模型返回格式');
            error.xReactionParseFailure = {
                rawText,
                cleanedText,
                kind: options.kind || 'interaction',
                cause
            };
            throw error;
        }
    }

    async generateReactionForPost(post = {}) {
        const runtime = typeof window !== 'undefined' ? window.VirtualPhone : null;
        const promptManager = runtime?.promptManager;

        promptManager?.ensureLoaded?.();
        const profile = this.getProfile();
        const userName = String(profile.nickname || this.getCurrentUserName() || 'X 用户').trim() || 'X 用户';
        const currentFollowers = this._getCurrentFollowersCount();
        const postContentDisplay = await this._buildPostInteractionDisplay(post);
        const promptVariables = {
            userName,
            currentFollowers: String(currentFollowers),
            postContentDisplay
        };
        const prompt = this._renderXPrompt(promptManager, 'interaction', promptVariables);
        if (!prompt.trim()) throw new Error('X 围观互动提示词为空，请先在设置中填写');

        const rawResult = await this._requestXJson(prompt, {
            kind: 'reaction',
            systemName: 'SYSTEM (X 围观互动)',
            minTokens: 1200,
            timeoutMessage: 'X 围观互动生成超时，请稍后重试',
            failureMessage: 'X 围观互动生成失败',
            parseMessage: 'X 围观互动解析失败，请检查模型返回格式'
        });
        const normalized = this._normalizeUserPostReactionResult(rawResult, post, currentFollowers);
        if (normalized.comments.length === 0
            && normalized.likes.length === 0
            && normalized.likeCount === 0
            && normalized.commentCount === 0) {
            throw new Error('X 围观互动结果为空');
        }
        return normalized;
    }

    applyReactionToUserPost(postId, rawResult = {}) {
        const safeId = String(postId || '').trim();
        const posts = this.getUserPosts();
        const post = posts.find((item) => String(item?.id || '') === safeId);
        if (!post) return null;

        const normalized = this._normalizeUserPostReactionResult(rawResult, post);
        const existingComments = Array.isArray(post.commentList) ? post.commentList : [];
        const startingDeclaredCount = Math.max(0, Number.parseInt(post.comments, 10) || 0);
        const addedComments = [];
        const identityOf = (value) => this._normalizeReactionIdentity(value).toLowerCase();

        normalized.comments.forEach((comment, index) => {
            const replyIdentity = identityOf(comment.replyTo);
            const target = replyIdentity
                ? [...existingComments].reverse().find((item) => (
                    identityOf(item?.name) === replyIdentity || identityOf(item?.handle) === replyIdentity
                ))
                : null;
            const duplicate = existingComments.some((item) => (
                identityOf(item?.name) === identityOf(comment.name)
                && String(item?.text || '').trim() === comment.text
                && String(item?.replyTo || '') === String(target?.handle || '')
            ));
            if (duplicate) return;

            const generated = {
                id: `x-comment-ai-${Date.now().toString(36)}-${index.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                name: comment.name,
                handle: `@x_${this._slugForText(comment.name)}_${existingComments.length}`,
                avatarText: Array.from(comment.name)[0]?.toUpperCase() || 'X',
                avatarTone: this._toneForText(comment.name),
                accountType: comment.accountType,
                text: comment.text,
                time: '刚刚',
                likes: comment.likes,
                parentId: target ? (target.parentId || target.id) : null,
                replyTo: target?.handle || null
            };
            existingComments.push(generated);
            addedComments.push(generated);
        });

        this._assignCommentTimes(post, existingComments);
        post.commentList = existingComments;
        post.comments = Math.max(
            existingComments.length,
            startingDeclaredCount + addedComments.length,
            normalized.commentCount
        );
        post.likeList = Array.from(new Set([
            ...(Array.isArray(post.likeList) ? post.likeList : []),
            ...normalized.likes
        ]));
        const countedUserLike = post.likedByUser === true && post.userLikeCounted === true ? 1 : 0;
        const existingPublicLikes = Math.max(0, this._parseCount(post.likes) - countedUserLike);
        post.likes = countedUserLike + Math.max(
            existingPublicLikes,
            post.likeList.length,
            normalized.likeCount
        );
        this.saveUserPosts(posts);

        if (normalized.followers !== null) {
            this.saveProfile({
                ...this.getProfile(),
                followers: normalized.followers
            });
        }

        return { post, addedComments, reaction: normalized };
    }

    _resolvePostAuthorName(post = {}) {
        if (post?.isUserPost) {
            return String(this.getProfile()?.nickname || this.getCurrentUserName() || 'X 用户').trim() || 'X 用户';
        }
        return String(post?.author?.name || 'X 用户').trim() || 'X 用户';
    }

    _buildExistingCommentContext(post = {}, limit = 12) {
        const comments = Array.isArray(post?.commentList) ? post.commentList : [];
        if (comments.length === 0) return '暂无';

        const namesByTarget = new Map();
        comments.forEach((comment) => {
            const name = this._normalizeReactionIdentity(comment?.name, 'X 用户');
            if (comment?.id) namesByTarget.set(String(comment.id), name);
            if (comment?.handle) namesByTarget.set(String(comment.handle), name);
        });

        return comments.slice(-Math.max(1, limit)).map((comment) => {
            const name = this._normalizeReactionIdentity(comment?.name, 'X 用户');
            const replyTo = namesByTarget.get(String(comment?.replyTo || ''))
                || this._normalizeReactionIdentity(comment?.replyTo);
            const text = String(comment?.text || '').trim();
            return `- ${name}${replyTo ? ` 回复 ${replyTo}` : ''}：${text}`;
        }).filter((line) => !line.endsWith('：')).join('\n') || '暂无';
    }

    _persistPostForSource(post, source = 'feed') {
        const safeSource = source === 'user' ? 'user' : (source === 'following' ? 'following' : 'feed');
        const posts = safeSource === 'user'
            ? this.getUserPosts()
            : (safeSource === 'following' ? this.getFollowingPosts() : this.getPosts());
        const index = posts.findIndex((item) => String(item?.id || '') === String(post?.id || ''));
        if (index >= 0) posts[index] = post;
        if (safeSource === 'user') this.saveUserPosts(posts);
        else if (safeSource === 'following') this.saveFollowingPosts(posts);
        else this.savePosts(posts);
        return post;
    }

    togglePostLike(postId, source = 'feed') {
        const post = this.getPost(postId, source);
        if (!post) return null;

        const likes = this._parseCount(post.likes);
        if (post.likedByUser === true) {
            post.likedByUser = false;
            post.likes = post.userLikeCounted === true ? Math.max(0, likes - 1) : likes;
            post.userLikeCounted = false;
        } else {
            const shouldIncrement = likes < 10000;
            post.likedByUser = true;
            post.userLikeCounted = shouldIncrement;
            post.likes = shouldIncrement ? likes + 1 : likes;
        }

        return this._persistPostForSource(post, source);
    }

    applyGeneratedComments(postId, rawComments = [], source = 'feed', options = {}) {
        const post = this.getPost(postId, source);
        if (!post) return null;

        const comments = this._normalizeGeneratedComments(rawComments, Number(options.limit) || 10);
        const existingComments = Array.isArray(post.commentList) ? post.commentList : [];
        const startingDeclaredCount = Math.max(0, Number.parseInt(post.comments, 10) || 0);
        const fixedTargetId = String(options.replyToCommentId || '').trim();
        const fixedTarget = fixedTargetId
            ? existingComments.find((comment) => String(comment?.id || '') === fixedTargetId) || null
            : null;
        const identityOf = (value) => this._normalizeReactionIdentity(value).toLowerCase();
        const addedComments = [];

        comments.forEach((comment, index) => {
            const replyIdentity = identityOf(comment.replyTo);
            const target = fixedTarget || (replyIdentity
                ? [...existingComments].reverse().find((item) => (
                    identityOf(item?.name) === replyIdentity || identityOf(item?.handle) === replyIdentity
                ))
                : null);
            const duplicate = existingComments.some((item) => (
                identityOf(item?.name) === identityOf(comment.name)
                && String(item?.text || '').trim() === comment.text
                && String(item?.replyTo || '') === String(target?.handle || '')
            ));
            if (duplicate) return;

            const generated = {
                id: `x-comment-ai-${Date.now().toString(36)}-${index.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                name: comment.name,
                handle: `@x_${this._slugForText(comment.name)}_${existingComments.length}`,
                avatarText: Array.from(comment.name)[0]?.toUpperCase() || 'X',
                avatarTone: this._toneForText(comment.name),
                accountType: comment.accountType,
                text: comment.text,
                time: '刚刚',
                likes: comment.likes,
                parentId: target ? (target.parentId || target.id) : null,
                replyTo: target?.handle || null
            };
            existingComments.push(generated);
            addedComments.push(generated);
        });

        this._assignCommentTimes(post, existingComments);
        post.commentList = existingComments;
        post.comments = Math.max(
            existingComments.length,
            startingDeclaredCount + addedComments.length
        );
        this._persistPostForSource(post, source);
        return { post, addedComments };
    }

    async generateMoreComments(postId, source = 'feed') {
        const post = this.getPost(postId, source);
        if (!post) throw new Error('没有找到这条 X 帖子');

        const runtime = typeof window !== 'undefined' ? window.VirtualPhone : null;
        const promptManager = runtime?.promptManager;
        promptManager?.ensureLoaded?.();
        const userName = String(this.getProfile()?.nickname || this.getCurrentUserName() || 'X 用户').trim() || 'X 用户';
        const prompt = this._renderXPrompt(promptManager, 'moreComments', {
            userName,
            currentFollowers: String(this._getCurrentFollowersCount()),
            postAuthor: this._resolvePostAuthorName(post),
            postContentDisplay: await this._buildPostInteractionDisplay(post),
            existingCommentContext: this._buildExistingCommentContext(post)
        });
        if (!prompt.trim()) throw new Error('X 加载更多回复提示词为空，请先在设置中填写');

        const result = await this._requestXJson(prompt, {
            kind: 'moreComments',
            systemName: 'SYSTEM (X 加载更多回复)',
            minTokens: 900,
            timeoutMessage: 'X 加载更多回复超时，请稍后重试',
            failureMessage: 'X 加载更多回复失败',
            parseMessage: 'X 加载更多回复解析失败，请检查模型返回格式'
        });
        const comments = this._normalizeGeneratedComments(result?.comments, 5);
        if (comments.length === 0) throw new Error('X 没有返回可用的新回复');
        return this.applyGeneratedComments(postId, comments, source, { limit: 5 });
    }

    async generateReplyForUserComment(postId, userCommentId, source = 'feed') {
        const post = this.getPost(postId, source);
        const userComment = post?.commentList?.find((comment) => String(comment?.id || '') === String(userCommentId || ''));
        if (!post || !userComment) throw new Error('没有找到用户刚发布的回复');

        const runtime = typeof window !== 'undefined' ? window.VirtualPhone : null;
        const promptManager = runtime?.promptManager;
        promptManager?.ensureLoaded?.();
        const userName = String(this.getProfile()?.nickname || this.getCurrentUserName() || 'X 用户').trim() || 'X 用户';
        const replyTarget = post.commentList.find((comment) => (
            String(comment?.id || '') === String(userComment.replyTo || '')
            || String(comment?.handle || '') === String(userComment.replyTo || '')
        ));
        const userCommentContext = `${userName}${replyTarget ? ` 回复 ${replyTarget.name || '该用户'}` : ''}：${userComment.text}`;
        const prompt = this._renderXPrompt(promptManager, 'commentInteraction', {
            userName,
            currentFollowers: String(this._getCurrentFollowersCount()),
            postAuthor: this._resolvePostAuthorName(post),
            postContentDisplay: await this._buildPostInteractionDisplay(post),
            existingCommentContext: this._buildExistingCommentContext(post),
            userCommentContext
        });
        if (!prompt.trim()) throw new Error('X 评论回评提示词为空，请先在设置中填写');

        const result = await this._requestXJson(prompt, {
            kind: 'commentInteraction',
            systemName: 'SYSTEM (X 评论回评)',
            minTokens: 700,
            timeoutMessage: 'X 评论回评生成超时，请稍后重试',
            failureMessage: 'X 评论回评生成失败',
            parseMessage: 'X 评论回评解析失败，请检查模型返回格式'
        });
        const comments = this._normalizeGeneratedComments(result?.comments, 2);
        if (comments.length === 0) throw new Error('X 没有返回可用的评论回评');
        return this.applyGeneratedComments(postId, comments, source, {
            limit: 2,
            replyToCommentId: userComment.id
        });
    }

    deleteUserPost(postId) {
        const safeId = String(postId || '').trim();
        if (!safeId) return { success: false, images: [] };

        const posts = this.getUserPosts();
        const index = posts.findIndex((post) => post?.isUserPost && String(post.id || '') === safeId);
        if (index < 0) return { success: false, images: [] };

        const [deletedPost] = posts.splice(index, 1);
        const images = new Set();
        const collect = (value) => {
            const text = String(value || '').trim();
            const match = text.match(/(?:^|\s|\])((?:\/backgrounds\/)[^\s)）?#]+)/i);
            if (match?.[1]) images.add(match[1]);
        };
        (Array.isArray(deletedPost?.images) ? deletedPost.images : []).forEach(collect);
        (Array.isArray(deletedPost?.imageGenerationStates) ? deletedPost.imageGenerationStates : [])
            .forEach((state) => collect(state?.generatedImageUrl));

        this.saveUserPosts(posts);
        return { success: true, images: [...images], post: deletedPost };
    }

    getPost(postId, source = 'feed') {
        const safeId = String(postId || '').trim();
        if (!safeId) return null;

        if (source === 'user') {
            return this.getUserPosts().find((post) => post.id === safeId) || null;
        }
        if (source === 'following') {
            return this.getFollowingPosts().find((post) => post.id === safeId) || null;
        }

        return this.getPosts().find((post) => post.id === safeId)
            || this.getUserPosts().find((post) => post.id === safeId)
            || null;
    }

    savePosts(posts = this._posts) {
        const sanitized = this._sanitizePostsForStorage(Array.isArray(posts) ? posts : []);
        const routedUserPosts = [];
        const normalized = [];
        sanitized.forEach((post) => {
            if (this._isCurrentUserPost(post)) routedUserPosts.push(post);
            else normalized.push(post);
        });
        if (routedUserPosts.length > 0) {
            this.saveUserPosts(this._mergeUserPostCollections(routedUserPosts, this.getUserPosts()));
        }
        this._mergeFollowingPosts(normalized);
        this._posts = normalized;
        this.storage?.set?.(STORAGE_KEY, JSON.stringify(normalized));
        return normalized;
    }

    getFollowingPosts() {
        if (Array.isArray(this._followingPosts)) return this._followingPosts;

        const saved = this.storage?.get?.(FOLLOWING_POSTS_KEY, null);
        const parsed = this._parsePosts(saved);
        const storedSnapshot = Array.isArray(parsed) ? JSON.stringify(parsed) : '';
        const fallbackPosts = Array.isArray(this._posts)
            ? this._posts
            : (this._parsePosts(this.storage?.get?.(STORAGE_KEY, null)) || []);
        const sourcePosts = Array.isArray(parsed)
            ? parsed
            : fallbackPosts.filter((post) => this.isFollowingPostAuthor(post));
        this._followingPosts = this._dedupeFollowingPosts(
            this._sanitizePostsForStorage(sourcePosts)
                .filter((post) => this.isFollowingPostAuthor(post))
        );
        if (!Array.isArray(parsed) || storedSnapshot !== JSON.stringify(this._followingPosts)) {
            this.storage?.set?.(FOLLOWING_POSTS_KEY, JSON.stringify(this._followingPosts));
        }
        return this._followingPosts;
    }

    saveFollowingPosts(posts = this._followingPosts) {
        const normalized = this._dedupeFollowingPosts(
            this._sanitizePostsForStorage(Array.isArray(posts) ? posts : [])
                .filter((post) => this.isFollowingPostAuthor(post))
        ).slice(0, 300);
        this._followingPosts = normalized;
        this.storage?.set?.(FOLLOWING_POSTS_KEY, JSON.stringify(normalized));
        return normalized;
    }

    _mergeFollowingPosts(posts = []) {
        const followedPosts = (Array.isArray(posts) ? posts : [])
            .filter((post) => this.isFollowingPostAuthor(post));
        if (followedPosts.length === 0) return this.getFollowingPosts();
        return this.saveFollowingPosts([
            ...followedPosts,
            ...this.getFollowingPosts()
        ]);
    }

    addComment(postId, text, replyToCommentId = null, source = 'feed') {
        const cleanText = String(text || '').trim();
        const post = this.getPost(postId, source);
        if (!post || !cleanText) return null;

        if (!Array.isArray(post.commentList)) post.commentList = [];

        const target = replyToCommentId
            ? post.commentList.find((comment) => comment.id === replyToCommentId) || null
            : null;
        const rootId = target ? (target.parentId || target.id) : null;
        const profile = this.getProfile();
        const comment = {
            id: `x-comment-user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            name: profile.nickname || this.getCurrentUserName(),
            handle: '@x_user',
            avatar: 'profile',
            text: cleanText,
            time: '刚刚',
            timeOffsetMinutes: 0,
            likes: 0,
            parentId: rootId,
            replyTo: target?.handle || null
        };

        post.commentList.push(comment);
        post.comments = Math.max(Number.parseInt(post.comments, 10) || 0, post.commentList.length - 1) + 1;
        if (source === 'user') {
            this.saveUserPosts(this._userPosts);
        } else if (source === 'following') {
            this.saveFollowingPosts(this._followingPosts);
        } else {
            this.savePosts(this._posts);
        }

        return { post, comment, rootId };
    }

    getCommentThreads(postOrId, source = 'feed') {
        const post = typeof postOrId === 'string' ? this.getPost(postOrId, source) : postOrId;
        const comments = Array.isArray(post?.commentList) ? post.commentList : [];
        const roots = [];
        const rootMap = new Map();

        comments.forEach((comment) => {
            if (!comment?.parentId) {
                const thread = { ...comment, replies: [] };
                roots.push(thread);
                rootMap.set(comment.id, thread);
            }
        });

        comments.forEach((comment) => {
            if (!comment?.parentId) return;
            const root = rootMap.get(comment.parentId);
            if (root) {
                root.replies.push({ ...comment });
                return;
            }

            const fallback = { ...comment, parentId: null, replies: [] };
            roots.push(fallback);
            rootMap.set(comment.id, fallback);
        });

        return roots;
    }

    getDirectMessageThreads() {
        if (Array.isArray(this._directMessageThreads)) return this._directMessageThreads;

        const saved = this.storage?.get?.(DIRECT_MESSAGES_KEY, null);
        const parsed = this._parseArray(saved);
        this._directMessageThreads = this._sanitizeDirectMessageThreads(parsed || []);
        if (parsed && JSON.stringify(parsed) !== JSON.stringify(this._directMessageThreads)) {
            this.saveDirectMessageThreads(this._directMessageThreads);
        }
        return this._directMessageThreads;
    }

    getFollowedAccountKeys() {
        if (Array.isArray(this._followedAccountKeys)) return this._followedAccountKeys;

        const saved = this.storage?.get?.(FOLLOWING_ACCOUNTS_KEY, null);
        const parsed = this._parseArray(saved) || [];
        this._followedAccountKeys = [...new Set(parsed
            .map((value) => String(value || '').trim())
            .filter(Boolean))];
        if (JSON.stringify(parsed) !== JSON.stringify(this._followedAccountKeys)) {
            this.storage?.set?.(FOLLOWING_ACCOUNTS_KEY, JSON.stringify(this._followedAccountKeys));
        }
        return this._followedAccountKeys;
    }

    getFollowedAccounts() {
        if (Array.isArray(this._followedAccounts)) return this._followedAccounts;

        const activeKeys = this.getFollowedAccountKeys();
        const parsed = this._parseArray(this.storage?.get?.(FOLLOWED_ACCOUNT_PROFILES_KEY, null)) || [];
        const accountsByKey = new Map(
            this._sanitizeFollowedAccounts(parsed)
                .filter((account) => activeKeys.includes(account.key))
                .map((account) => [account.key, account])
        );
        const currentPosts = Array.isArray(this._posts)
            ? this._posts
            : (this._parsePosts(this.storage?.get?.(STORAGE_KEY, null)) || []);
        const participants = [
            ...this.getFollowingPosts().map((post) => this._resolveDirectMessageParticipant(post)),
            ...currentPosts.map((post) => this._resolveDirectMessageParticipant(post)),
            ...this.getDirectMessageThreads().map((thread) => thread.participant || {})
        ];
        participants.forEach((participant) => {
            const normalized = this._sanitizeFollowedAccounts([participant])[0];
            if (normalized && activeKeys.includes(normalized.key) && !accountsByKey.has(normalized.key)) {
                accountsByKey.set(normalized.key, normalized);
            }
        });

        this._followedAccounts = activeKeys
            .map((key) => accountsByKey.get(key))
            .filter(Boolean);
        if (JSON.stringify(parsed) !== JSON.stringify(this._followedAccounts)) {
            this.storage?.set?.(FOLLOWED_ACCOUNT_PROFILES_KEY, JSON.stringify(this._followedAccounts));
        }
        return this._followedAccounts;
    }

    saveFollowedAccounts(accounts = this._followedAccounts) {
        const activeKeys = this.getFollowedAccountKeys();
        const normalized = this._sanitizeFollowedAccounts(accounts)
            .filter((account) => activeKeys.includes(account.key));
        this._followedAccounts = normalized;
        this.storage?.set?.(FOLLOWED_ACCOUNT_PROFILES_KEY, JSON.stringify(normalized));
        return normalized;
    }

    isFollowingPostAuthor(post = {}) {
        const participant = this._resolveDirectMessageParticipant(post);
        return this.getFollowedAccountKeys().includes(participant.key);
    }

    toggleFollowPostAuthor(post = {}) {
        const participant = this._resolveDirectMessageParticipant(post);
        const keys = this.getFollowedAccountKeys();
        const index = keys.indexOf(participant.key);
        const following = index < 0;
        if (following) keys.push(participant.key);
        else keys.splice(index, 1);
        this._followedAccountKeys = [...new Set(keys)];
        this.storage?.set?.(FOLLOWING_ACCOUNTS_KEY, JSON.stringify(this._followedAccountKeys));
        if (following) {
            const accounts = this.getFollowedAccounts().filter((account) => account.key !== participant.key);
            this.saveFollowedAccounts([...accounts, participant]);
            const knownPosts = this.getPosts().filter((item) => (
                this._resolveDirectMessageParticipant(item).key === participant.key
            ));
            this._mergeFollowingPosts(knownPosts.length > 0 ? knownPosts : [post]);
        } else {
            this.saveFollowedAccounts(
                this.getFollowedAccounts().filter((account) => account.key !== participant.key)
            );
            this.saveFollowingPosts(
                this.getFollowingPosts().filter((item) => (
                    this._resolveDirectMessageParticipant(item).key !== participant.key
                ))
            );
        }
        const profile = this.getProfile();
        this.saveProfile({
            ...profile,
            following: Math.max(0, (Number.parseInt(profile.following, 10) || 0) + (following ? 1 : -1))
        });
        return { following, participant };
    }

    saveDirectMessageThreads(threads = this._directMessageThreads) {
        const normalized = this._sanitizeDirectMessageThreads(Array.isArray(threads) ? threads : []);
        normalized.sort((left, right) => (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0));
        this._directMessageThreads = normalized;
        this.storage?.set?.(DIRECT_MESSAGES_KEY, JSON.stringify(normalized));
        return normalized;
    }

    getDirectMessageThread(threadId) {
        const safeId = String(threadId || '').trim();
        if (!safeId) return null;
        return this.getDirectMessageThreads().find((thread) => thread.id === safeId) || null;
    }

    deleteDirectMessageThread(threadId) {
        const safeId = String(threadId || '').trim();
        if (!safeId) return { success: false, thread: null };
        const threads = this.getDirectMessageThreads();
        const index = threads.findIndex((thread) => thread.id === safeId);
        if (index < 0) return { success: false, thread: null };

        const [thread] = threads.splice(index, 1);
        this.saveDirectMessageThreads(threads);
        return { success: true, thread };
    }

    getOrCreateDirectMessageThread(post = {}) {
        const participant = this._resolveDirectMessageParticipant(post);
        const threads = this.getDirectMessageThreads();
        const existing = threads.find((thread) => thread.participant?.key === participant.key);
        const sourcePost = {
            id: String(post?.id || '').trim(),
            content: String(post?.content || '').trim().slice(0, 280)
        };

        if (existing) {
            existing.participant = participant;
            if (sourcePost.id || sourcePost.content) existing.sourcePost = sourcePost;
            this.saveDirectMessageThreads(threads);
            return this.getDirectMessageThread(existing.id) || existing;
        }

        const timestamp = Date.now();
        const thread = {
            id: `x-dm-${timestamp.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            participant,
            sourcePost,
            messages: [],
            updatedAt: timestamp
        };
        threads.unshift(thread);
        this.saveDirectMessageThreads(threads);
        return this.getDirectMessageThread(thread.id) || thread;
    }

    addDirectMessage(threadId, from, text) {
        const thread = this.getDirectMessageThread(threadId);
        const cleanText = String(text || '').trim().slice(0, 1000);
        const safeFrom = from === 'them' ? 'them' : 'me';
        if (!thread || !cleanText) return null;

        const timestamp = Date.now();
        const message = {
            id: `x-dm-message-${timestamp.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            from: safeFrom,
            text: cleanText,
            time: '刚刚',
            timestamp
        };
        thread.messages.push(message);
        thread.updatedAt = timestamp;
        this.saveDirectMessageThreads(this._directMessageThreads);
        return message;
    }

    async generateDirectMessageReply(threadId) {
        const thread = this.getDirectMessageThread(threadId);
        if (!thread) throw new Error('没有找到这段私信');

        const apiManager = typeof window !== 'undefined' ? window.VirtualPhone?.apiManager : null;
        if (!apiManager) throw new Error('API Manager 未初始化');

        const participant = thread.participant || {};
        const accountLabel = participant.accountType === 'official'
            ? '官方认证账号'
            : participant.accountType === 'advertiser'
                ? '广告账号'
                : '个人账号';
        const sourcePost = String(thread.sourcePost?.content || '').trim();
        const profile = this.getProfile();
        const userName = String(profile.nickname || this.getCurrentUserName() || 'X 用户').trim() || 'X 用户';
        const recentMessages = thread.messages.slice(-20).map((message) => ({
            role: message.from === 'them' ? 'assistant' : 'user',
            content: String(message.text || '').trim(),
            isPhoneMessage: true
        })).filter((message) => message.content);
        const messages = [
            {
                role: 'system',
                content: [
                    `你正在扮演 X 用户“${participant.name || 'X 用户'}”，账号类型是${accountLabel}。`,
                    sourcePost ? `用户是从你的这条公开帖子进入私信的：${sourcePost}` : '',
                    `正在与你私信的人叫“${userName}”。`,
                    '请根据已有私信自然回复最后一条用户消息。',
                    '只返回一条简洁自然的纯文字私信，不要输出标签、角色名、引号、旁白、动作描写、图片、语音、视频或通话内容。'
                ].filter(Boolean).join('\n'),
                isPhoneMessage: true
            },
            ...recentMessages
        ];

        const result = await this._withTimeout(
            apiManager.callAI(messages, {
                appId: 'x',
                max_tokens: 500
            }),
            120000,
            'X 私信回复超时，请稍后重试'
        );
        if (!result?.success) throw new Error(result?.error || 'X 私信回复失败');

        const rawText = String(result.summary || result.content || result.text || '').trim();
        const filteredText = String(applyPhoneTagFilter(rawText, { storage: this.storage }) || '').trim();
        const replyText = (filteredText || rawText)
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/^\s*[“"']|[”"']\s*$/g, '')
            .trim()
            .slice(0, 1000);
        if (!replyText) throw new Error('X 私信没有返回有效文字');
        return this.addDirectMessage(thread.id, 'them', replyText);
    }

    async clearAllPostRecords() {
        this._feedGenerationEpoch += 1;
        const allPosts = [
            ...this.getPosts(),
            ...this.getUserPosts(),
            ...this.getFollowingPosts()
        ];
        const images = this._collectPostImageValues(allPosts);
        const followedAccountCount = this.getFollowedAccountKeys().length;
        const seenPosts = new Set();
        allPosts.forEach((post) => {
            const id = String(post?.id || '').trim();
            const fallback = [
                String(post?.author?.name || '').trim(),
                String(post?.content || '').trim(),
                String(post?.time || '').trim()
            ].join('\n');
            seenPosts.add(id ? `id:${id}` : `content:${fallback}`);
        });

        const profile = this._normalizeProfile({
            ...this.getProfile(),
            following: 0
        });
        this._posts = [];
        this._userPosts = [];
        this._followingPosts = [];
        this._followedAccountKeys = [];
        this._followedAccounts = [];
        this._profile = profile;
        this._lastAIResponse = null;

        await Promise.all([
            this.storage?.set?.(STORAGE_KEY, JSON.stringify([])),
            this.storage?.set?.(USER_POSTS_KEY, JSON.stringify([])),
            this.storage?.set?.(FOLLOWING_POSTS_KEY, JSON.stringify([])),
            this.storage?.set?.(FOLLOWING_ACCOUNTS_KEY, JSON.stringify([])),
            this.storage?.set?.(FOLLOWED_ACCOUNT_PROFILES_KEY, JSON.stringify([])),
            this.storage?.set?.(FEED_RESPONSE_HISTORY_KEY, JSON.stringify([])),
            this.storage?.set?.(PROFILE_KEY, JSON.stringify(profile))
        ].map((operation) => Promise.resolve(operation)));

        return {
            success: true,
            postCount: seenPosts.size,
            followedAccountCount,
            images
        };
    }

    _collectPostImageValues(posts = []) {
        const images = new Set();
        const collect = (value) => {
            const text = String(value || '').trim();
            if (text) images.add(text);
        };
        (Array.isArray(posts) ? posts : []).forEach((post) => {
            (Array.isArray(post?.images) ? post.images : []).forEach(collect);
            (Array.isArray(post?.imageGenerationStates) ? post.imageGenerationStates : [])
                .forEach((state) => collect(state?.generatedImageUrl));
        });
        return [...images];
    }

    clearCache() {
        this._posts = null;
        this._profile = null;
        this._userPosts = null;
        this._directMessageThreads = null;
        this._followedAccountKeys = null;
        this._followedAccounts = null;
        this._followingPosts = null;
    }

    getCurrentUserName() {
        const context = this._getContext();
        return String(context?.name1 || 'X 用户').trim() || 'X 用户';
    }

    async getWechatDataAsync() {
        let wechatData = window.VirtualPhone?.wechatApp?.wechatData || window.VirtualPhone?.cachedWechatData;
        if (wechatData) return wechatData;

        try {
            const module = await import('../wechat/wechat-data.js?v=20261002-x-forward-card');
            wechatData = new module.WechatData(this.storage);
            if (window.VirtualPhone) window.VirtualPhone.cachedWechatData = wechatData;
            return wechatData;
        } catch (error) {
            console.error('[X] 加载微信数据库失败:', error);
            return null;
        }
    }

    async getWechatContactsAsync() {
        const wechatData = await this.getWechatDataAsync();
        return wechatData?.getContacts?.() || [];
    }

    async forwardToWechat(post, targetName, options = {}) {
        const safeTargetName = String(targetName || '').trim();
        if (!post || !safeTargetName) throw new Error('请选择微信联系人');

        const wechatData = await this.getWechatDataAsync();
        if (!wechatData) throw new Error('微信数据库加载失败');

        const forwardText = String(options?.forwardText || '').trim();
        const userInfo = wechatData.getUserInfo?.() || {};
        let chatId = null;
        const chatList = wechatData.getChatList?.() || [];
        const existingChat = chatList.find(chat => String(chat?.name || '').trim() === safeTargetName);
        if (existingChat) chatId = existingChat.id;

        if (!chatId) {
            const contacts = wechatData.getContacts?.() || [];
            const contact = contacts.find(item => String(item?.name || '').trim() === safeTargetName);
            if (contact) {
                const newChat = wechatData.createChat({
                    id: `chat_${contact.id || Date.now().toString(36)}`,
                    contactId: contact.id,
                    name: contact.name,
                    type: 'single',
                    avatar: contact.avatar
                });
                chatId = newChat.id;
            }
        }

        if (!chatId) {
            const newChat = wechatData.createChat({
                name: safeTargetName,
                type: 'single',
                avatar: '👤'
            });
            chatId = newChat.id;
        }

        if (forwardText) {
            wechatData.addMessage(chatId, {
                from: 'me',
                content: forwardText,
                type: 'text',
                avatar: userInfo.avatar || ''
            });
        }

        const author = this._resolveForwardPostAuthor(post);
        const originalXTime = String(post.time || '').trim();
        const cardData = {
            author,
            content: String(post.content || '').trim(),
            images: Array.isArray(post.images) ? [...post.images] : [],
            imageGenerationStates: Array.isArray(post.imageGenerationStates)
                ? post.imageGenerationStates.map(state => ({ ...(state || {}) }))
                : [],
            comments: Math.max(
                Number.parseInt(post.comments, 10) || 0,
                Array.isArray(post.commentList) ? post.commentList.length : 0
            ),
            likes: Math.max(0, Number.parseInt(post.likes, 10) || 0),
            commentList: Array.isArray(post.commentList)
                ? post.commentList.map(comment => ({ ...(comment || {}) }))
                : [],
            time: originalXTime,
            originalTime: originalXTime
        };

        const addResult = wechatData.addMessage(chatId, {
            from: 'me',
            type: 'x_card',
            content: this._buildXFullText(post),
            xData: cardData
        });

        const chat = wechatData.getChat?.(chatId);
        if (chat) {
            chat.unread = (chat.unread || 0) + 1;
            const apps = window.VirtualPhone?.home?.apps;
            if (Array.isArray(apps)) {
                const wechatAppIcon = apps.find(app => app.id === 'wechat');
                if (wechatAppIcon) {
                    wechatAppIcon.badge = (wechatData.getChatList?.() || [])
                        .reduce((sum, item) => sum + (Number(item?.unread) || 0), 0);
                    if (typeof CustomEvent !== 'undefined') {
                        window.dispatchEvent?.(new CustomEvent('phone:updateGlobalBadge'));
                    }
                    this.storage?.saveApps?.(apps);
                }
            }
        }

        wechatData.saveData?.();
        return {
            success: true,
            chatId,
            chatName: safeTargetName,
            hasForwardText: !!forwardText
        };
    }

    _resolveForwardPostAuthor(post = {}) {
        if (post?.isUserPost) {
            const profile = this.getProfile();
            return {
                name: String(profile?.nickname || this.getCurrentUserName() || 'X 用户').trim() || 'X 用户',
                accountType: 'personal'
            };
        }
        const author = post?.author && typeof post.author === 'object' ? post.author : {};
        return {
            name: String(author.name || 'X 用户').trim() || 'X 用户',
            accountType: this._normalizeAccountType(author.accountType || author.verified)
        };
    }

    _buildXFullText(post = {}) {
        const author = this._resolveForwardPostAuthor(post);
        const accountLabel = author.accountType === 'official'
            ? '（官方认证）'
            : author.accountType === 'advertiser'
                ? '（广告账号）'
                : '';
        const lines = [`[X分享] ${author.name}${accountLabel}`];
        const content = String(post.content || '').trim();
        if (content) lines.push(`正文：${content}`);

        const images = (Array.isArray(post.images) ? post.images : [])
            .map(item => String(item || '').trim())
            .filter(Boolean);
        if (images.length > 0) lines.push(`配图：${images.join(' ')}`);

        const comments = Array.isArray(post.commentList) ? post.commentList : [];
        if (comments.length > 0) {
            const namesByTarget = new Map();
            comments.forEach(comment => {
                if (comment?.id) namesByTarget.set(String(comment.id), String(comment.name || ''));
                if (comment?.handle) namesByTarget.set(String(comment.handle), String(comment.name || ''));
            });
            lines.push('评论区：');
            comments.forEach(comment => {
                const name = String(comment?.name || 'X 用户').trim() || 'X 用户';
                const replyTo = namesByTarget.get(String(comment?.replyTo || '')) || String(comment?.replyTo || '').replace(/^@/, '');
                const text = String(comment?.text || '').trim();
                if (text) lines.push(`${name}${replyTo ? ` 回复 ${replyTo}` : ''}：${text}`);
            });
        }
        return lines.join('\n');
    }

    getGenerationContextSettings() {
        return {
            includeCharacterUser: this._readBooleanSetting(
                CONTEXT_SETTING_KEYS.includeCharacterUser,
                false
            ),
            includeTavernText: this._readBooleanSetting(
                CONTEXT_SETTING_KEYS.includeTavernText,
                false
            )
        };
    }

    async setGenerationContextSetting(name, enabled) {
        const key = CONTEXT_SETTING_KEYS[name];
        if (!key) throw new Error(`未知的 X 上下文设置: ${name}`);
        const value = !!enabled;
        await this.storage?.set?.(key, value);
        return value;
    }

    getFeedResponseHistory() {
        const parsed = this._parseArray(this.storage?.get?.(FEED_RESPONSE_HISTORY_KEY, null));
        return (Array.isArray(parsed) ? parsed : [])
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .slice(-2);
    }

    saveFeedResponseHistory(history = []) {
        const normalized = (Array.isArray(history) ? history : [])
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .slice(-2);
        this.storage?.set?.(FEED_RESPONSE_HISTORY_KEY, JSON.stringify(normalized));
        return normalized;
    }

    _buildFeedHistoryMessage(history = this.getFeedResponseHistory()) {
        const normalized = (Array.isArray(history) ? history : [])
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .slice(-2);
        if (normalized.length === 0) return null;

        const entries = normalized.map((content, index) => {
            const recency = index === normalized.length - 1 ? '最近一轮' : '前一轮';
            return `【${recency}】\n${content}`;
        });
        return {
            role: 'system',
            name: 'SYSTEM (X 最近推荐历史)',
            content: `【最近两轮 X 推荐历史，仅用于查重】\n以下内容按从旧到新排列。根据历史推荐帖子，请勿重复相同的帖子内容或题材；不得仅通过改写措辞复刻相同事件、观点或创意。\n\n${entries.join('\n\n')}`,
            isPhoneMessage: true
        };
    }

    _buildFollowingAccountsMessage(accounts = this.getFollowedAccounts(), posts = this.getFollowingPosts()) {
        const normalizedAccounts = (Array.isArray(accounts) ? accounts : [])
            .filter((account) => account && typeof account === 'object')
            .slice(0, 100);
        const accountNames = normalizedAccounts
            .map((account) => String(account.name || '').trim())
            .filter(Boolean);
        if (accountNames.length === 0) {
            return {
                role: 'system',
                name: 'SYSTEM (X 正在关注账号)',
                content: '【当前正在关注账号】\n暂无',
                isPhoneMessage: true
            };
        }

        const accountKeys = new Set(
            normalizedAccounts.map((account) => String(account.key || '').trim()).filter(Boolean)
        );
        const recentPosts = (Array.isArray(posts) ? posts : [])
            .filter((post) => accountKeys.has(this._resolveDirectMessageParticipant(post).key))
            .filter((post) => String(post?.content || '').trim())
            .slice(0, 5);
        const historyText = recentPosts.length > 0
            ? recentPosts.map((post, index) => {
                const participant = this._resolveDirectMessageParticipant(post);
                const time = String(post?.time || '未知').trim() || '未知';
                const content = String(post?.content || '').trim();
                return `${index + 1}. 昵称：${participant.name}\n时间：${time}\n正文：${content}`;
            }).join('\n\n')
            : '暂无历史帖子';

        return {
            role: 'system',
            name: 'SYSTEM (X 正在关注账号)',
            content: `【当前正在关注账号】\n${accountNames.map((name) => `- ${name}`).join('\n')}\n\n【关注账号最近 5 条历史帖子，仅用于账号延续与查重】\n${historyText}\n\n刷新推荐流时，请合理包含其中部分账号的新公开帖子，同时保持推荐流内容多样性。生成这些账号的新帖子时，可以延续其身份和表达风格，但不得重复上述帖子的相同内容、题材、事件、观点或创意，也不得仅改写措辞后再次发布。`,
            isPhoneMessage: true
        };
    }

    async generateFeed() {
        if (this._refreshPromise) return this._refreshPromise;

        this._refreshPromise = this._generateFeed().finally(() => {
            this._refreshPromise = null;
        });
        return this._refreshPromise;
    }

    async _generateFeed() {
        const generationEpoch = this._feedGenerationEpoch;
        const runtime = typeof window !== 'undefined' ? window.VirtualPhone : null;
        const apiManager = runtime?.apiManager;
        const promptManager = runtime?.promptManager;
        const context = this._getContext();
        if (!apiManager) throw new Error('API Manager 未初始化');
        if (!context) throw new Error('无法访问酒馆聊天上下文');

        promptManager?.ensureLoaded?.();
        const phoneTime = this._getCurrentPhoneTimeContext(runtime);
        const profile = this.getProfile();
        const currentNickname = String(profile.nickname || context.name1 || 'X 用户').trim() || 'X 用户';
        const currentGender = this._getProfileGenderLabel(profile.gender);
        const currentFollowers = this._getCurrentFollowersCount();
        const followedAccounts = this.getFollowedAccounts().slice(0, 100);
        const followedAccountNames = followedAccounts
            .map((account) => String(account?.name || '').trim())
            .filter(Boolean);
        const followedAccountNamesText = followedAccountNames.join('、') || '暂无';
        const promptVariables = {
            CURRENT_PHONE_TIME: phoneTime.text,
            STORY_DATE: phoneTime.date,
            STORY_TIME: phoneTime.time,
            STORY_WEEKDAY: phoneTime.weekday,
            CURRENT_X_NICKNAME: currentNickname,
            CURRENT_X_GENDER: currentGender,
            CURRENT_FOLLOWERS: String(currentFollowers),
            currentFollowers: String(currentFollowers),
            CURRENT_FOLLOWING_NAMES: followedAccountNamesText,
            followingAccountNames: followedAccountNamesText
        };
        const rawPrompt = promptManager?.getPromptForFeature?.('x', 'feed') || '';
        const prompt = typeof promptManager?.renderPromptForFeature === 'function'
            ? promptManager.renderPromptForFeature('x', 'feed', promptVariables)
            : Object.entries(promptVariables).reduce(
                (content, [key, value]) => content.split(`{{${key}}}`).join(String(value || '')),
                rawPrompt
            );
        if (!prompt.trim()) throw new Error('X 默认提示词为空，请先在设置中填写');
        const rawOverridePrompt = promptManager?.getPromptForFeature?.('x', 'override') || '';
        const overridePrompt = typeof promptManager?.renderPromptForFeature === 'function'
            ? promptManager.renderPromptForFeature('x', 'override', promptVariables)
            : Object.entries(promptVariables).reduce(
                (content, [key, value]) => content.split(`{{${key}}}`).join(String(value || '')),
                rawOverridePrompt
            );

        const contextSettings = this.getGenerationContextSettings();
        const contextMessages = await this._collectContextMessages(contextSettings);
        const feedResponseHistory = this.getFeedResponseHistory();
        const feedHistoryMessage = this._buildFeedHistoryMessage(feedResponseHistory);
        const followingAccountsMessage = this._buildFollowingAccountsMessage(followedAccounts);
        const messages = [
            ...(overridePrompt.trim() ? [{
                role: 'system',
                name: 'SYSTEM (X 破限词)',
                content: overridePrompt,
                isPhoneMessage: true
            }] : []),
            {
                role: 'system',
                name: 'SYSTEM (X 用户信息)',
                content: `【当前 X 用户信息】\n昵称：${currentNickname}\n性别：${currentGender}\n粉丝：${currentFollowers}\n请以此粉丝数为唯一基准，并在 <Twitter> 内输出“用户粉丝数：变化后的最终总数”；无变化时原样返回。`,
                isPhoneMessage: true
            },
            followingAccountsMessage,
            ...contextMessages,
            ...(feedHistoryMessage ? [feedHistoryMessage] : []),
            { role: 'user', content: prompt, isPhoneMessage: true }
        ];
        const configuredMaxTokens = Number.parseInt(context.max_response_length, 10)
            || Number.parseInt(context.max_length, 10)
            || 2048;
        const result = await this._withTimeout(
            apiManager.callAI(messages, {
                appId: 'x',
                max_tokens: Math.max(1600, configuredMaxTokens)
            }),
            240000,
            'X 帖子生成超时，请检查网络或稍后重试'
        );

        if (!result?.success) throw new Error(result?.error || 'X 帖子生成失败');
        if (generationEpoch !== this._feedGenerationEpoch) return [];

        const rawText = String(result.summary || result.content || result.text || '').trim();
        const filteredText = String(applyPhoneTagFilter(rawText, { storage: this.storage }) || '').trim();
        const rawHasTwitterTag = /<\s*Twitter\b[^>]*>[\s\S]*?<\s*\/\s*Twitter\s*>/i.test(rawText);
        const filteredHasTwitterTag = /<\s*Twitter\b[^>]*>[\s\S]*?<\s*\/\s*Twitter\s*>/i.test(filteredText);
        const cleanedText = filteredHasTwitterTag || !rawHasTwitterTag
            ? (filteredText || rawText)
            : rawText;
        this._lastAIResponse = { rawText, cleanedText };
        const parsedPosts = this.parseTwitterContent(cleanedText);
        if (parsedPosts.length === 0) {
            const error = new Error('X 帖子解析失败，模型未按 <Twitter> 格式返回');
            error.xParseFailure = {
                expectedFormat: '<Twitter>...</Twitter>',
                rawText,
                cleanedText
            };
            throw error;
        }

        this._updateFollowersFromText(cleanedText);

        const generatedAt = Date.now();
        const normalizedPosts = parsedPosts.map((post, index) => ({
            ...post,
            id: `x-post-ai-${generatedAt.toString(36)}-${index.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
        }));
        this.savePosts(normalizedPosts);
        this.saveFeedResponseHistory([...feedResponseHistory, cleanedText]);
        return normalizedPosts;
    }

    async _collectContextMessages(settings = this.getGenerationContextSettings()) {
        const context = this._getContext();
        if (!context) return [];

        const messages = [];
        const pushSystem = (content, name = '') => {
            const text = String(content || '').trim();
            if (!text) return;
            const message = { role: 'system', content: text, isPhoneMessage: true };
            if (name) message.name = name;
            messages.push(message);
        };

        if (settings.includeCharacterUser) {
            const character = context.characters?.[context.characterId];
            if (character) {
                const parts = [
                    `角色名：${character.name || context.name2 || '未知'}`,
                    character.description ? `描述：${character.description}` : '',
                    character.personality ? `性格：${character.personality}` : '',
                    character.scenario ? `背景：${character.scenario}` : ''
                ].filter(Boolean);
                pushSystem(`【角色卡信息】\n${parts.join('\n')}`, 'SYSTEM (角色卡信息)');
            }
        }

        try {
            await (typeof window !== 'undefined'
                ? window.VirtualPhone?.worldbookManager?.appendWorldbookMessages?.(messages, 'x')
                : null);
        } catch (error) {
            console.warn('[X] 读取世界书失败:', error);
        }

        const userName = String(context.name1 || '用户').trim() || '用户';
        if (settings.includeCharacterUser) {
            const persona = typeof document !== 'undefined'
                ? String(document.getElementById('persona_description')?.value || '').trim()
                : '';
            pushSystem(
                `【用户信息】\n用户名：${userName}${persona ? `\n用户设定：${persona}` : ''}`,
                'SYSTEM (用户信息)'
            );
        }

        if (settings.includeTavernText) {
            const chat = Array.isArray(context.chat) ? context.chat : [];
            const contextLimit = readPhoneContextLimit((typeof window !== 'undefined' && window.VirtualPhone?.storage) || this.storage);
            const recent = [];
            for (let index = chat.length - 1; index >= 0 && recent.length < contextLimit; index -= 1) {
                const item = chat[index];
                if (!item || item.isGaigaiPrompt || item.isGaigaiData || item.isPhoneMessage) continue;
                let content = applyPhoneTagFilter(item.mes || item.content || '', { storage: this.storage });
                content = String(content || '')
                    .replace(/<\s*Twitter\b[^>]*>[\s\S]*?<\s*\/\s*Twitter\s*>/gi, '')
                    .replace(/<img[^>]*src=["']data:[^"']*["'][^>]*>/gi, '[图片]')
                    .replace(/!\[[^\]]*\]\(data:[^)]+\)/gi, '[图片]')
                    .trim();
                if (!content) continue;
                const isUser = item.is_user === true || item.role === 'user';
                const speaker = isUser ? userName : (context.name2 || '角色');
                recent.unshift({
                    role: isUser ? 'user' : 'assistant',
                    content: `${speaker}: ${content}`,
                    isPhoneMessage: true
                });
            }
            messages.push(...recent);
        }

        if (settings.includeCharacterUser) {
            const profile = this.getProfile();
            pushSystem(
                `【当前 X 账号】\n昵称：${profile.nickname || userName}\n性别：${this._getProfileGenderLabel(profile.gender)}\n关注：${profile.following}\n粉丝：${profile.followers}`,
                'SYSTEM (X 账号状态)'
            );
        }
        return messages;
    }

    parseTwitterContent(rawText) {
        const source = String(rawText || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
        const blocks = [];
        const tagPattern = /<\s*Twitter\b[^>]*>([\s\S]*?)<\s*\/\s*Twitter\s*>/gi;
        let tagMatch;
        while ((tagMatch = tagPattern.exec(source)) !== null) {
            blocks.push(String(tagMatch[1] || '').trim());
        }
        if (blocks.length === 0) return [];

        const posts = [];
        blocks.forEach((block) => {
            let sections = block.split(/\n\s*(?:-{3,}|—{2,}|={3,})\s*\n/g).filter(Boolean);
            if (sections.length <= 1) {
                sections = block.split(/(?=^\s*博主[：:])/gm).filter((section) => section.trim());
            }
            sections.forEach((section) => {
                const post = this._parseTwitterPost(section);
                if (post) posts.push(post);
            });
        });
        return posts;
    }

    _parseTwitterPost(section) {
        const lines = String(section || '').split(/\r?\n/);
        let authorName = '';
        let accountType = 'personal';
        let time = '刚刚';
        let content = '';
        let declaredComments = 0;
        let likes = 0;
        let images = [];
        let collectingContent = false;
        let collectingComments = false;
        const contentLines = [];
        const rawComments = [];

        const flushContent = () => {
            if (contentLines.length > 0) content = contentLines.join('\n').trim();
            contentLines.length = 0;
            collectingContent = false;
        };

        lines.forEach((rawLine) => {
            const line = String(rawLine || '').trim();
            if (!line) {
                if (collectingContent && contentLines.at(-1) !== '') contentLines.push('');
                return;
            }

            const authorMatch = line.match(/^博主[：:]\s*(.+?)(?:\s*[（(](个人|官方|广告|蓝V|黄V)[）)])?\s*$/i);
            if (authorMatch) {
                flushContent();
                authorName = String(authorMatch[1] || '').trim();
                accountType = this._normalizeAccountType(authorMatch[2]);
                collectingComments = false;
                return;
            }
            const typeMatch = line.match(/^账号类型[：:]\s*(.+)$/i);
            if (typeMatch) {
                flushContent();
                accountType = this._normalizeAccountType(typeMatch[1]);
                return;
            }
            const timeMatch = line.match(/^时间[：:]\s*(.+)$/i);
            if (timeMatch) {
                flushContent();
                time = String(timeMatch[1] || '').trim() || '刚刚';
                return;
            }
            const contentMatch = line.match(/^正文[：:]\s*(.*)$/i);
            if (contentMatch) {
                flushContent();
                collectingContent = true;
                collectingComments = false;
                if (contentMatch[1]) contentLines.push(contentMatch[1].trim());
                return;
            }
            const imagesMatch = line.match(/^配图[：:]\s*(.*)$/i);
            if (imagesMatch) {
                flushContent();
                images = this._parseTwitterImages(imagesMatch[1]);
                collectingComments = false;
                return;
            }
            const replyCountMatch = line.match(/^(?:回复数|评论数|回复)[：:]\s*(.+)$/i);
            if (replyCountMatch) {
                flushContent();
                declaredComments = this._parseCount(replyCountMatch[1]);
                collectingComments = false;
                return;
            }
            const likeMatch = line.match(/^(?:点赞数|点赞)[：:]\s*(.+)$/i);
            if (likeMatch) {
                flushContent();
                likes = this._parseCount(likeMatch[1]);
                collectingComments = false;
                return;
            }
            if (/^(?:评论区|评论)[：:]?$/i.test(line)) {
                flushContent();
                collectingComments = true;
                return;
            }

            if (collectingComments) {
                rawComments.push(line);
            } else if (collectingContent) {
                contentLines.push(line);
            }
        });
        flushContent();

        if (!authorName || !content) return null;
        const commentList = this._parseTwitterComments(rawComments);
        const tone = this._toneForText(authorName);
        const post = {
            author: {
                name: authorName,
                handle: `@x_${this._slugForText(authorName)}`,
                avatarText: Array.from(authorName)[0]?.toUpperCase() || 'X',
                avatarTone: tone,
                accountType
            },
            time,
            content,
            promoted: accountType === 'advertiser',
            comments: Math.max(declaredComments, commentList.length),
            likes,
            commentList,
            images,
            imageGenerationStates: []
        };
        if (this._isCurrentUserPost(post)) post.isUserPost = true;
        this._assignCommentTimes(post, commentList);
        return post;
    }

    _parseTwitterImages(value) {
        const text = String(value || '').trim();
        if (!text) return [];

        const images = [];
        const add = (item) => {
            const normalized = String(item || '').trim();
            if (!normalized || images.includes(normalized)) return;
            images.push(normalized);
        };
        const mediaPattern = /\[(?:用户照片|个人图片|图片(?:-[^\]\r\n]+)?|视频)\]\s*(?:[（(][^）)\r\n]+[）)](?:\s*[（(][^）)\r\n]+[）)])?|(?:https?:\/\/|\/backgrounds\/)[^\s，,；;]+)?/gi;
        for (const match of text.matchAll(mediaPattern)) add(match[0]);

        const directUrlPattern = /(?:https?:\/\/|\/backgrounds\/)[^\s，,；;)）]+/gi;
        for (const match of text.matchAll(directUrlPattern)) {
            const url = String(match[0] || '').trim();
            if (images.some((image) => image.includes(url))) continue;
            add(url);
        }
        return images.slice(0, 4);
    }

    _parseTwitterComments(lines = []) {
        const comments = [];
        lines.forEach((rawLine, index) => {
            const line = String(rawLine || '').replace(/^[-•]\s*/, '').trim();
            if (!line) return;
            const match = line.match(/^(.+?)(?:\s+回复\s+(.+?))?[：:]\s*(.+)$/);
            if (!match) return;

            const name = String(match[1] || '').trim();
            const replyTargetName = String(match[2] || '').trim();
            const text = String(match[3] || '').trim();
            if (!name || !text) return;
            const target = replyTargetName
                ? [...comments].reverse().find((comment) => comment.name === replyTargetName)
                : null;
            const id = `x-comment-ai-${Date.now().toString(36)}-${index.toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
            comments.push({
                id,
                name,
                handle: `@x_${this._slugForText(name)}_${index}`,
                avatarText: Array.from(name)[0]?.toUpperCase() || 'X',
                avatarTone: this._toneForText(name),
                text,
                time: '刚刚',
                likes: 0,
                parentId: target ? (target.parentId || target.id) : null,
                replyTo: target?.handle || null
            });
        });
        return comments;
    }

    _normalizeAccountType(value) {
        const text = String(value || '').trim().toLowerCase();
        if (['官方', '蓝v', 'blue', 'official'].includes(text)) return 'official';
        if (['广告', '黄v', 'gold', 'advertiser', 'ad'].includes(text)) return 'advertiser';
        return 'personal';
    }

    _parseCount(value) {
        const text = String(value || '').replace(/,/g, '').trim();
        const number = Number.parseFloat(text) || 0;
        if (/万/i.test(text)) return Math.max(0, Math.round(number * 10000));
        if (/k/i.test(text)) return Math.max(0, Math.round(number * 1000));
        return Math.max(0, Math.round(number));
    }

    _slugForText(value) {
        let hash = 2166136261;
        for (const char of String(value || 'x')) {
            hash ^= char.codePointAt(0);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    _toneForText(value) {
        const tones = ['rose', 'sky', 'mint', 'violet', 'amber'];
        const slug = this._slugForText(value);
        const seed = Number.parseInt(slug.slice(-3), 36) || 0;
        return tones[seed % tones.length];
    }

    async _withTimeout(promise, timeoutMs, message) {
        let timer = null;
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(message)), timeoutMs);
            })
        ]).finally(() => {
            if (timer) clearTimeout(timer);
        });
    }

    _getContext() {
        return (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function')
            ? SillyTavern.getContext()
            : null;
    }

    _getCurrentPhoneTimeContext(runtime = null) {
        let current = null;
        try {
            const timeManager = runtime?.timeManager;
            current = timeManager?.getCurrentStoryTime?.()
                || timeManager?.getCurrentTime?.()
                || null;
        } catch (error) {
            console.warn('[X] 获取当前手机时间失败，使用现实时间兜底:', error);
        }

        if (current?.date || current?.time) {
            const date = String(current.date || current.calendarDate || '').trim();
            const time = String(current.time || '').trim();
            const weekday = String(current.weekday || '').trim();
            let timestamp = Number(current.timestamp ?? current._ts);
            if (!Number.isFinite(timestamp) || timestamp <= 0) {
                timestamp = Number(runtime?.timeManager?.parseTimeToTimestamp?.(current));
            }
            return {
                date,
                time,
                weekday,
                timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now(),
                text: [date, weekday, time].filter(Boolean).join(' ') || '手机时间未知'
            };
        }

        const now = new Date();
        const date = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日`;
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const weekday = `星期${'日一二三四五六'[now.getDay()]}`;
        return { date, time, weekday, timestamp: now.getTime(), text: `${date} ${weekday} ${time}` };
    }

    _normalizeProfile(profile) {
        return {
            ...profile,
            avatar: String(profile?.avatar || '').trim(),
            nickname: String(profile?.nickname || '').trim(),
            gender: this._normalizeProfileGender(profile?.gender),
            following: Math.max(0, Number.parseInt(profile?.following, 10) || 0),
            followers: Math.max(0, Number.parseInt(profile?.followers, 10) || 0)
        };
    }

    _normalizeProfileGender(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (['male', 'man', '男', '男性'].includes(normalized)) return 'male';
        if (['female', 'woman', '女', '女性'].includes(normalized)) return 'female';
        return 'unknown';
    }

    _getProfileGenderLabel(value) {
        const normalized = this._normalizeProfileGender(value);
        if (normalized === 'male') return '男';
        if (normalized === 'female') return '女';
        return '未知';
    }

    _resolveDirectMessageParticipant(post = {}) {
        const author = post?.isUserPost
            ? {
                ...(post.author || {}),
                name: this.getProfile().nickname || this.getCurrentUserName(),
                avatar: 'profile',
                accountType: 'personal'
            }
            : (post?.author && typeof post.author === 'object' ? post.author : {});
        const name = String(author.name || 'X 用户').trim() || 'X 用户';
        const handle = String(author.handle || '').trim();
        const key = handle
            ? `handle:${handle.toLowerCase()}`
            : `name:${this._slugForText(name.toLowerCase())}`;
        const avatar = String(author.avatar || '').trim();
        return {
            key,
            name,
            handle,
            avatar: /^data:/i.test(avatar) ? '' : avatar,
            avatarText: String(author.avatarText || Array.from(name)[0] || 'X').trim().slice(0, 2),
            avatarTone: ['rose', 'sky', 'mint', 'violet', 'amber'].includes(author.avatarTone)
                ? author.avatarTone
                : this._toneForText(name),
            accountType: this._normalizeAccountType(author.accountType || author.verified)
        };
    }

    _parsePosts(value) {
        if (Array.isArray(value)) return value;
        if (typeof value !== 'string' || !value.trim()) return null;

        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : null;
        } catch (error) {
            console.warn('[X] 帖子数据解析失败，已恢复空信息流:', error);
            return null;
        }
    }

    _sanitizePostsForStorage(posts = []) {
        return (Array.isArray(posts) ? posts : [])
            .filter((post) => post && typeof post === 'object' && !Array.isArray(post))
            .map((post) => {
                const normalized = { ...post };
                if (Array.isArray(post.images)) {
                    normalized.images = post.images
                        .map((image) => String(image || '').trim())
                        .filter((image) => image && !/^(?:\[[^\]]+\]\s*)?data:image\//i.test(image))
                        .slice(0, 4);
                }
                if (Array.isArray(post.imageGenerationStates)) {
                    normalized.imageGenerationStates = post.imageGenerationStates.slice(0, 4).map((state) => {
                        if (!state || typeof state !== 'object') return state;
                        const nextState = { ...state };
                        if (/^data:image\//i.test(String(nextState.generatedImageUrl || '').trim())) {
                            nextState.generatedImageUrl = '';
                        }
                        return nextState;
                    });
                }
                if (Array.isArray(post.commentList)) {
                    this._assignCommentTimes(normalized, post.commentList);
                }
                return normalized;
            });
    }

    _dedupeFollowingPosts(posts = []) {
        const result = [];
        const seenIds = new Set();
        const seenContent = new Set();
        (Array.isArray(posts) ? posts : []).forEach((post) => {
            const id = String(post?.id || '').trim();
            const participant = this._resolveDirectMessageParticipant(post);
            const content = String(post?.content || '').trim();
            const images = (Array.isArray(post?.images) ? post.images : [])
                .map((image) => String(image || '').trim())
                .filter(Boolean)
                .join('|');
            const contentKey = `${participant.key}|${content}|${images}`;
            if ((id && seenIds.has(id)) || (content && seenContent.has(contentKey))) return;
            if (id) seenIds.add(id);
            if (content) seenContent.add(contentKey);
            result.push(post);
        });
        return result;
    }

    _sanitizeFollowedAccounts(accounts = []) {
        const seen = new Set();
        return (Array.isArray(accounts) ? accounts : [])
            .filter((account) => account && typeof account === 'object' && !Array.isArray(account))
            .map((account) => {
                const name = String(account.name || 'X 用户').trim() || 'X 用户';
                const handle = String(account.handle || '').trim();
                const key = String(account.key || '').trim()
                    || (handle ? `handle:${handle.toLowerCase()}` : `name:${this._slugForText(name.toLowerCase())}`);
                const avatar = String(account.avatar || '').trim();
                return {
                    key,
                    name,
                    handle,
                    avatar: /^data:/i.test(avatar) ? '' : avatar,
                    avatarText: String(account.avatarText || Array.from(name)[0] || 'X').trim().slice(0, 2),
                    avatarTone: ['rose', 'sky', 'mint', 'violet', 'amber'].includes(account.avatarTone)
                        ? account.avatarTone
                        : this._toneForText(name),
                    accountType: this._normalizeAccountType(account.accountType || account.verified)
                };
            })
            .filter((account) => {
                if (!account.key || seen.has(account.key)) return false;
                seen.add(account.key);
                return true;
            });
    }

    _parseObject(value) {
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
        if (typeof value !== 'string' || !value.trim()) return null;

        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch (error) {
            console.warn('[X] 个人资料解析失败，已恢复默认资料:', error);
            return null;
        }
    }

    _parseArray(value) {
        if (Array.isArray(value)) return value;
        if (typeof value !== 'string' || !value.trim()) return null;

        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : null;
        } catch (error) {
            console.warn('[X] 私信数据解析失败，已恢复空列表:', error);
            return null;
        }
    }

    _sanitizeDirectMessageThreads(threads = []) {
        return (Array.isArray(threads) ? threads : [])
            .filter((thread) => thread && typeof thread === 'object' && !Array.isArray(thread))
            .map((thread) => {
                const participant = thread.participant && typeof thread.participant === 'object'
                    ? thread.participant
                    : {};
                const name = String(participant.name || 'X 用户').trim() || 'X 用户';
                const handle = String(participant.handle || '').trim();
                const key = String(participant.key || '').trim()
                    || (handle ? `handle:${handle.toLowerCase()}` : `name:${this._slugForText(name.toLowerCase())}`);
                const avatar = String(participant.avatar || '').trim();
                const messages = (Array.isArray(thread.messages) ? thread.messages : [])
                    .filter((message) => message && typeof message === 'object')
                    .map((message, index) => {
                        const timestamp = Math.max(0, Number(message.timestamp) || 0);
                        return {
                            id: String(message.id || `x-dm-message-${timestamp || index}`).trim(),
                            from: message.from === 'them' ? 'them' : 'me',
                            text: String(message.text || '').trim().slice(0, 1000),
                            time: String(message.time || '刚刚').trim() || '刚刚',
                            timestamp
                        };
                    })
                    .filter((message) => message.text)
                    .slice(-300);
                const lastTimestamp = messages.at(-1)?.timestamp || 0;
                return {
                    id: String(thread.id || `x-dm-${this._slugForText(key)}`).trim(),
                    participant: {
                        key,
                        name,
                        handle,
                        avatar: /^data:/i.test(avatar) ? '' : avatar,
                        avatarText: String(participant.avatarText || Array.from(name)[0] || 'X').trim().slice(0, 2),
                        avatarTone: ['rose', 'sky', 'mint', 'violet', 'amber'].includes(participant.avatarTone)
                            ? participant.avatarTone
                            : this._toneForText(name),
                        accountType: this._normalizeAccountType(participant.accountType || participant.verified)
                    },
                    sourcePost: {
                        id: String(thread.sourcePost?.id || '').trim(),
                        content: String(thread.sourcePost?.content || '').trim().slice(0, 280)
                    },
                    messages,
                    updatedAt: Math.max(Number(thread.updatedAt) || 0, lastTimestamp)
                };
            })
            .filter((thread) => thread.id && thread.participant.key);
    }

    _readBooleanSetting(key, fallback = false) {
        const value = this.storage?.get?.(key, fallback);
        if (value === true || value === 'true' || value === 1 || value === '1') return true;
        if (value === false || value === 'false' || value === 0 || value === '0') return false;
        return fallback;
    }
}

export {
    CONTEXT_SETTING_KEYS,
    DEFAULT_POSTS,
    DEFAULT_PROFILE,
    DIRECT_MESSAGES_KEY,
    FEED_RESPONSE_HISTORY_KEY,
    FOLLOWED_ACCOUNT_PROFILES_KEY,
    FOLLOWING_ACCOUNTS_KEY,
    FOLLOWING_POSTS_KEY,
    LEGACY_DEFAULT_POST_IDS,
    PROFILE_KEY,
    STORAGE_KEY,
    USER_POSTS_KEY
};
