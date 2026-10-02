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
const CONTEXT_SETTING_KEYS = Object.freeze({
    includeCharacterUser: 'x_include_character_user_context',
    includeTavernText: 'x_include_tavern_text_context'
});

const DEFAULT_PROFILE = {
    avatar: '',
    nickname: '',
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
            const migrated = parsed.filter((post) => !LEGACY_DEFAULT_POST_IDS.has(String(post?.id || '').trim()));
            this._posts = this._sanitizePostsForStorage(migrated);
            if (migrated.length !== parsed.length || JSON.stringify(this._posts) !== JSON.stringify(parsed)) {
                this.savePosts(this._posts);
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
        this._userPosts = Array.isArray(parsed)
            ? this._sanitizePostsForStorage(parsed).map((post) => ({ ...post, isUserPost: true }))
            : [];
        if (Array.isArray(parsed) && JSON.stringify(this._userPosts) !== JSON.stringify(parsed)) {
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

    publishUserPost(content = '', images = []) {
        const cleanContent = String(content || '').trim().slice(0, 280);
        const cleanImages = (Array.isArray(images) ? images : [])
            .map((image) => String(image || '').trim())
            .filter((image) => /^\/backgrounds\//i.test(image))
            .slice(0, 4);
        if (!cleanContent && cleanImages.length === 0) return null;

        const post = {
            id: `x-post-user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            isUserPost: true,
            author: {
                avatar: 'profile',
                accountType: 'personal'
            },
            time: '刚刚',
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
        const normalized = this._sanitizePostsForStorage(Array.isArray(posts) ? posts : []);
        this._mergeFollowingPosts(normalized);
        this._posts = normalized;
        this.storage?.set?.(STORAGE_KEY, JSON.stringify(normalized));
        return normalized;
    }

    getFollowingPosts() {
        if (Array.isArray(this._followingPosts)) return this._followingPosts;

        const saved = this.storage?.get?.(FOLLOWING_POSTS_KEY, null);
        const parsed = this._parsePosts(saved);
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
        if (!Array.isArray(parsed) || JSON.stringify(parsed) !== JSON.stringify(this._followingPosts)) {
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

    async generateFeed() {
        if (this._refreshPromise) return this._refreshPromise;

        this._refreshPromise = this._generateFeed().finally(() => {
            this._refreshPromise = null;
        });
        return this._refreshPromise;
    }

    async _generateFeed() {
        const runtime = typeof window !== 'undefined' ? window.VirtualPhone : null;
        const apiManager = runtime?.apiManager;
        const promptManager = runtime?.promptManager;
        const context = this._getContext();
        if (!apiManager) throw new Error('API Manager 未初始化');
        if (!context) throw new Error('无法访问酒馆聊天上下文');

        promptManager?.ensureLoaded?.();
        const phoneTime = this._getCurrentPhoneTimeContext(runtime);
        const currentFollowers = this._getCurrentFollowersCount();
        const followedAccountNames = this.getFollowedAccounts()
            .map((account) => String(account?.name || '').trim())
            .filter(Boolean)
            .slice(0, 100);
        const followedAccountNamesText = followedAccountNames.join('、') || '暂无';
        const promptVariables = {
            CURRENT_PHONE_TIME: phoneTime.text,
            STORY_DATE: phoneTime.date,
            STORY_TIME: phoneTime.time,
            STORY_WEEKDAY: phoneTime.weekday,
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
        const messages = [
            ...(overridePrompt.trim() ? [{
                role: 'system',
                name: 'SYSTEM (X 破限词)',
                content: overridePrompt,
                isPhoneMessage: true
            }] : []),
            {
                role: 'system',
                name: 'SYSTEM (X 用户粉丝数)',
                content: `【当前 X 用户粉丝数】\n当前粉丝数：${currentFollowers}\n请以此为唯一基准，并在 <Twitter> 内输出“用户粉丝数：变化后的最终总数”；无变化时原样返回。`,
                isPhoneMessage: true
            },
            {
                role: 'system',
                name: 'SYSTEM (X 正在关注账号)',
                content: followedAccountNames.length > 0
                    ? `【当前正在关注账号】\n${followedAccountNames.map((name) => `- ${name}`).join('\n')}\n刷新推荐流时，请合理包含其中部分账号的新公开帖子，同时保持推荐流内容多样性。`
                    : '【当前正在关注账号】\n暂无',
                isPhoneMessage: true
            },
            ...contextMessages,
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
                `【当前 X 账号】\n昵称：${profile.nickname || userName}\n关注：${profile.following}\n粉丝：${profile.followers}`,
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
        return {
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
            return {
                date,
                time,
                weekday,
                text: [date, weekday, time].filter(Boolean).join(' ') || '手机时间未知'
            };
        }

        const now = new Date();
        const date = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日`;
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const weekday = `星期${'日一二三四五六'[now.getDay()]}`;
        return { date, time, weekday, text: `${date} ${weekday} ${time}` };
    }

    _normalizeProfile(profile) {
        return {
            ...profile,
            avatar: String(profile?.avatar || '').trim(),
            nickname: String(profile?.nickname || '').trim(),
            following: Math.max(0, Number.parseInt(profile?.following, 10) || 0),
            followers: Math.max(0, Number.parseInt(profile?.followers, 10) || 0)
        };
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
    FOLLOWED_ACCOUNT_PROFILES_KEY,
    FOLLOWING_ACCOUNTS_KEY,
    FOLLOWING_POSTS_KEY,
    LEGACY_DEFAULT_POST_IDS,
    PROFILE_KEY,
    STORAGE_KEY,
    USER_POSTS_KEY
};
