import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { PromptManager } from '../config/prompt-manager.js';
import {
    CONTEXT_SETTING_KEYS,
    DIRECT_MESSAGES_KEY,
    FOLLOWED_ACCOUNT_PROFILES_KEY,
    FOLLOWING_ACCOUNTS_KEY,
    FOLLOWING_POSTS_KEY,
    XData
} from '../apps/x/x-data.js';
import { XApp } from '../apps/x/x-app.js';
import { XView } from '../apps/x/x-view.js';

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    get(key, fallback = null) {
        return this.values.has(key) ? this.values.get(key) : fallback;
    }

    set(key, value) {
        this.values.set(key, value);
    }
}

const createTestPost = (overrides = {}) => ({
    id: 'x-post-test',
    author: {
        name: 'Tibo',
        handle: '@tibo',
        avatarText: 'T',
        avatarTone: 'sky',
        accountType: 'official'
    },
    time: '刚刚',
    content: '测试帖子正文',
    comments: 2,
    likes: 8,
    commentList: [
        {
            id: 'x-comment-root',
            name: 'Luna',
            handle: '@luna_ui',
            avatarText: 'L',
            avatarTone: 'rose',
            text: '主评论',
            time: '刚刚',
            likes: 1,
            parentId: null,
            replyTo: null
        },
        {
            id: 'x-comment-nested',
            name: 'Kai',
            handle: '@kaicode',
            avatarText: 'K',
            avatarTone: 'mint',
            text: '楼中楼',
            time: '刚刚',
            likes: 0,
            parentId: 'x-comment-root',
            replyTo: '@luna_ui'
        }
    ],
    images: [],
    imageGenerationStates: [],
    ...overrides
});

const createDataWithPost = (storage = new MemoryStorage(), overrides = {}) => {
    const data = new XData(storage);
    const post = createTestPost(overrides);
    data.savePosts([post]);
    return { data, post: data.getPosts()[0], storage };
};

test('a fresh X feed starts empty and shows the refresh hint', () => {
    const data = new XData(new MemoryStorage());
    const view = new XView({ xData: data, phoneShell: { setContent() {} } });

    assert.deepEqual(data.getPosts(), []);
    assert.match(view.renderForYouFeed(), /还没有帖子/);
    assert.match(view.renderForYouFeed(), /下拉/);
});

test('direct post replies are persisted with the X post', () => {
    const { data, post, storage } = createDataWithPost();
    const initialCount = post.comments;

    const result = data.addComment(post.id, '这是一条直接回复');

    assert.ok(result?.comment.id);
    assert.equal(result.comment.parentId, null);
    assert.equal(result.comment.replyTo, null);
    assert.equal(result.post.comments, initialCount + 1);

    const reloaded = new XData(storage);
    const savedPost = reloaded.getPost(post.id);
    assert.equal(savedPost.commentList.at(-1).text, '这是一条直接回复');
    assert.equal(savedPost.comments, initialCount + 1);
});

test('replies to comments stay inside the same root thread', () => {
    const { data, post } = createDataWithPost();
    const root = post.commentList.find((comment) => !comment.parentId);

    const firstReply = data.addComment(post.id, '回复主评论', root.id);
    const secondReply = data.addComment(post.id, '回复楼中楼', firstReply.comment.id);
    const thread = data.getCommentThreads(post).find((item) => item.id === root.id);

    assert.equal(firstReply.comment.parentId, root.id);
    assert.equal(firstReply.comment.replyTo, root.handle);
    assert.equal(secondReply.comment.parentId, root.id);
    assert.equal(secondReply.comment.replyTo, firstReply.comment.handle);
    assert.ok(thread.replies.some((comment) => comment.id === firstReply.comment.id));
    assert.ok(thread.replies.some((comment) => comment.id === secondReply.comment.id));
});

test('invalid stored X data falls back to an empty feed', () => {
    const storage = new MemoryStorage();
    storage.set('x_posts', '{broken json');

    const data = new XData(storage);

    assert.deepEqual(data.getPosts(), []);
    assert.equal(storage.get('x_posts'), '[]');
});

test('legacy built-in X posts are removed from existing chat storage', () => {
    const storage = new MemoryStorage();
    storage.set('x_posts', JSON.stringify([
        createTestPost({ id: 'x-post-sol-61', content: '旧示例' }),
        createTestPost({ id: 'x-post-real', content: '保留的帖子' })
    ]));

    const posts = new XData(storage).getPosts();

    assert.equal(posts.length, 1);
    assert.equal(posts[0].id, 'x-post-real');
    assert.doesNotMatch(storage.get('x_posts'), /x-post-sol-61/);
});

test('visible X post and comment markup does not expose account handles', () => {
    const { data, post } = createDataWithPost();
    const view = new XView({ xData: data, phoneShell: { setContent() {} } });
    view.currentPostId = post.id;

    const feedHtml = view.renderFeedPost(post);
    const detailHtml = view.renderPostDetail();

    assert.doesNotMatch(feedHtml, /@tibo/);
    assert.doesNotMatch(detailHtml, /@(tibo|luna_ui|kaicode)/);
    assert.match(detailHtml, /回复 <span>Luna<\/span>/);
});

test('X bottom navigation uses filled active and outlined inactive icons without a blue dot', () => {
    const view = new XView({ xData: new XData(new MemoryStorage()), phoneShell: { setContent() {} } });
    const homeNav = view.renderBottomNav();
    view.currentPage = 'chat';
    const chatNav = view.renderBottomNav();

    assert.match(homeNav, /xapp-bottom-item is-active[^>]+data-page="home"/);
    assert.match(homeNav, /fa-regular fa-comment/);
    assert.match(chatNav, /data-page="home"/);
    assert.match(chatNav, /xapp-bottom-item is-active[^>]+data-page="chat"/);
    assert.match(chatNav, /fa-solid fa-comment/);
    assert.doesNotMatch(homeNav + chatNav, /xapp-home-outline-icon/);
});

test('X chat header omits the unused All filter', () => {
    const source = fs.readFileSync(new URL('../apps/x/x-view.js', import.meta.url), 'utf8');
    const start = source.indexOf('renderChat()');
    const end = source.indexOf('renderBottomNav()', start);
    assert.ok(start >= 0 && end > start, 'X chat renderer should exist');

    const block = source.slice(start, end);
    assert.doesNotMatch(block, /xapp-chat-filter/);
    assert.doesNotMatch(block, />All\s*</);
});

test('X post more buttons identify the post and expose follow and private-message actions', () => {
    const { data, post } = createDataWithPost();
    const view = new XView({ xData: data, phoneShell: { setContent() {} } });
    const feedHtml = view.renderFeedPost(post, { source: 'feed' });
    const source = fs.readFileSync(new URL('../apps/x/x-view.js', import.meta.url), 'utf8');

    assert.match(feedHtml, /xapp-more-button[^>]+data-post-id="x-post-test"/);
    assert.match(feedHtml, /data-post-source="feed"/);
    assert.match(source, /data-xapp-post-follow/);
    assert.match(source, /data-xapp-post-dm/);
    assert.match(source, /取消关注.*关注/);
    assert.match(source, /<span>私信 /);
    assert.doesNotMatch(source, /xapp-post-menu-cancel/);
});

test('X post actions open as an anchored popover instead of a bottom sheet', () => {
    const cssSource = fs.readFileSync(new URL('../apps/x/x.css', import.meta.url), 'utf8');
    const overlayStart = cssSource.indexOf('.xapp-post-menu-overlay');
    const overlayEnd = cssSource.indexOf('@supports not', overlayStart);
    const block = cssSource.slice(overlayStart, overlayEnd);

    assert.match(block, /\.xapp-post-menu-overlay[\s\S]*?background:\s*transparent/);
    assert.match(block, /\.xapp-post-menu-sheet[\s\S]*?position:\s*absolute/);
    assert.match(block, /\.xapp-post-menu-action[\s\S]*?border:\s*0\s*!important/);
    assert.doesNotMatch(block, /align-items:\s*flex-end|xapp-post-menu-handle|xapp-post-menu-cancel/);
});

test('X follow state persists per chat and populates the following feed', () => {
    const firstStorage = new MemoryStorage();
    const secondStorage = new MemoryStorage();
    const firstData = new XData(firstStorage);
    const secondData = new XData(secondStorage);
    const post = createTestPost();
    const olderPost = createTestPost({
        id: 'x-post-test-older',
        content: '同一关注账号的过往帖子'
    });
    firstData.savePosts([post, olderPost]);
    secondData.savePosts([post]);

    const followed = firstData.toggleFollowPostAuthor(post);
    assert.equal(followed.following, true);
    assert.equal(firstData.isFollowingPostAuthor(post), true);
    assert.equal(firstData.getProfile().following, 1);
    assert.equal(secondData.isFollowingPostAuthor(post), false);
    assert.ok(firstStorage.get(FOLLOWING_ACCOUNTS_KEY));
    assert.ok(firstStorage.get(FOLLOWED_ACCOUNT_PROFILES_KEY));
    assert.ok(firstStorage.get(FOLLOWING_POSTS_KEY));
    assert.deepEqual(firstData.getFollowedAccounts().map((account) => account.name), ['Tibo']);
    assert.equal(firstData.getFollowingPosts().length, 2);

    firstData.savePosts([createTestPost({
        id: 'x-post-unrelated',
        author: { name: '其他账号', handle: '@other' },
        content: '刷新后的推荐帖子'
    })]);
    assert.equal(firstData.getFollowingPosts().length, 2);

    const view = new XView({ xData: firstData, phoneShell: { setContent() {} } });
    assert.match(view.renderFollowingFeed(), /测试帖子正文/);
    assert.match(view.renderFollowingFeed(), /同一关注账号的过往帖子/);
    assert.match(view.renderFollowingFeed(), /xapp-following-account-name[^>]*>Tibo/);
    assert.match(view.renderFollowingFeed(), /data-post-source="following"/);

    const unfollowed = firstData.toggleFollowPostAuthor(post);
    assert.equal(unfollowed.following, false);
    assert.equal(firstData.getProfile().following, 0);
    assert.deepEqual(firstData.getFollowingPosts(), []);
    assert.match(view.renderFollowingFeed(), /关注内容会显示在这里/);
});

test('X direct-message threads persist per chat and reuse the same post author', () => {
    const firstStorage = new MemoryStorage();
    const secondStorage = new MemoryStorage();
    const firstData = new XData(firstStorage);
    const secondData = new XData(secondStorage);
    const firstPost = createTestPost();
    const secondPost = createTestPost({
        id: 'x-post-test-2',
        content: '同一个作者的另一条帖子'
    });

    const firstThread = firstData.getOrCreateDirectMessageThread(firstPost);
    firstData.addDirectMessage(firstThread.id, 'me', '你好');
    const reusedThread = firstData.getOrCreateDirectMessageThread(secondPost);

    assert.equal(reusedThread.id, firstThread.id);
    assert.equal(firstData.getDirectMessageThreads().length, 1);
    assert.equal(firstData.getDirectMessageThread(firstThread.id).messages[0].text, '你好');
    assert.equal(firstData.getDirectMessageThread(firstThread.id).sourcePost.id, 'x-post-test-2');
    assert.ok(firstStorage.get(DIRECT_MESSAGES_KEY));
    assert.deepEqual(secondData.getDirectMessageThreads(), []);

    const reloaded = new XData(firstStorage);
    assert.equal(reloaded.getDirectMessageThread(firstThread.id).participant.name, 'Tibo');
});

test('X direct-message conversations can be deleted without affecting other chats', () => {
    const firstStorage = new MemoryStorage();
    const secondStorage = new MemoryStorage();
    const firstData = new XData(firstStorage);
    const secondData = new XData(secondStorage);
    const firstThread = firstData.getOrCreateDirectMessageThread(createTestPost());
    secondData.getOrCreateDirectMessageThread(createTestPost());

    const result = firstData.deleteDirectMessageThread(firstThread.id);
    assert.equal(result.success, true);
    assert.equal(result.thread.participant.name, 'Tibo');
    assert.deepEqual(new XData(firstStorage).getDirectMessageThreads(), []);
    assert.equal(new XData(secondStorage).getDirectMessageThreads().length, 1);
    assert.equal(firstData.deleteDirectMessageThread(firstThread.id).success, false);
});

test('X direct-message generated avatars keep the same tone as the source post', () => {
    const data = new XData(new MemoryStorage());
    const post = createTestPost({
        author: {
            name: '大熊Bear',
            handle: '@bear',
            avatarText: '大',
            avatarTone: 'rose',
            accountType: 'personal'
        }
    });
    const thread = data.getOrCreateDirectMessageThread(post);
    const view = new XView({ xData: data, phoneShell: { setContent() {} } });
    const postAvatar = view.renderPostAvatar(post.author);
    const directMessageAvatar = view.renderDirectMessageAvatar(thread.participant, 'xapp-chat-thread-avatar');
    const cssSource = fs.readFileSync(new URL('../apps/x/x.css', import.meta.url), 'utf8');

    assert.match(postAvatar, /xapp-generated-avatar-rose/);
    assert.match(directMessageAvatar, /xapp-generated-avatar-rose/);
    assert.match(cssSource, /\.xapp-dm-avatar\.xapp-generated-avatar-rose\s*\{\s*background:\s*#c95c73/);
});

test('X direct messages persist user text and one plain-text AI reply', async () => {
    const storage = new MemoryStorage();
    const data = new XData(storage);
    const thread = data.getOrCreateDirectMessageThread(createTestPost());
    const previousWindow = globalThis.window;
    let requestMessages = null;
    let requestOptions = null;
    globalThis.window = {
        VirtualPhone: {
            apiManager: {
                async callAI(messages, options) {
                    requestMessages = messages;
                    requestOptions = options;
                    return { success: true, content: '当然，可以聊聊。' };
                }
            }
        }
    };

    try {
        data.addDirectMessage(thread.id, 'me', '可以私下聊聊吗？');
        const reply = await data.generateDirectMessageReply(thread.id);
        const saved = new XData(storage).getDirectMessageThread(thread.id);

        assert.equal(reply.from, 'them');
        assert.deepEqual(saved.messages.map((message) => message.from), ['me', 'them']);
        assert.deepEqual(saved.messages.map((message) => message.text), ['可以私下聊聊吗？', '当然，可以聊聊。']);
        assert.equal(requestOptions.appId, 'x');
        assert.ok(requestMessages.some((message) => /只返回一条简洁自然的纯文字私信/.test(message.content)));
        assert.ok(requestMessages.some((message) => message.content === '可以私下聊聊吗？'));
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('X Chat renders a thread list and a text-only conversation screen', () => {
    const data = new XData(new MemoryStorage());
    const thread = data.getOrCreateDirectMessageThread(createTestPost());
    data.addDirectMessage(thread.id, 'me', '列表里的最后一条消息');
    const view = new XView({ xData: data, phoneShell: { setContent() {} } });
    const source = fs.readFileSync(new URL('../apps/x/x-view.js', import.meta.url), 'utf8');

    const listHtml = view.renderChat();
    assert.match(listHtml, /class="xapp-chat-thread"/);
    assert.match(listHtml, /Tibo/);
    assert.match(listHtml, /列表里的最后一条消息/);
    assert.match(source, /addEventListener\('contextmenu'/);
    assert.match(source, /addEventListener\('touchstart'/);
    assert.match(source, /deleteDirectMessageThread\(button\.dataset\.threadId\)/);

    view.activeDirectMessageId = thread.id;
    const conversationHtml = view.renderChat();
    assert.match(conversationHtml, /id="xapp-dm-messages"/);
    assert.match(conversationHtml, /id="xapp-dm-input"[^>]+type="text"/);
    assert.match(conversationHtml, /id="xapp-dm-send"/);
    assert.doesNotMatch(conversationHtml, /fa-(?:phone|video)|语音|视频|通话|上传图片/);
});

test('X direct-message conversations use a child view above the Chat list', () => {
    const data = new XData(new MemoryStorage());
    const post = createTestPost();
    const thread = data.getOrCreateDirectMessageThread(post);
    const viewIds = [];
    const view = new XView({
        xData: data,
        phoneShell: {
            setContent(_html, viewId) {
                viewIds.push(viewId);
            }
        }
    });
    const previousDocument = globalThis.document;
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
    globalThis.document = { querySelector: () => null, getElementById: () => null };
    globalThis.requestAnimationFrame = (callback) => callback();

    try {
        view.currentPage = 'chat';
        view.activeDirectMessageId = null;
        view.render();
        view.activeDirectMessageId = thread.id;
        view.render();
        assert.deepEqual(viewIds, ['xapp-chat', 'xapp-dm']);

        viewIds.length = 0;
        view.openDirectMessageFromPost(post);
        assert.deepEqual(viewIds, ['xapp-chat', 'xapp-dm']);
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
        else globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    }
});

test('X home header groups its controls inside one glass surface', () => {
    const view = new XView({ xData: new XData(new MemoryStorage()), phoneShell: { setContent() {} } });
    const homeHtml = view.renderHome();

    assert.match(homeHtml, /class="xapp-top-glass"/);
    assert.ok(homeHtml.indexOf('xapp-top-glass') < homeHtml.indexOf('xapp-feed-scroll'));
});

test('X compose entry uses the compact outlined edit icon', () => {
    const view = new XView({ xData: new XData(new MemoryStorage()), phoneShell: { setContent() {} } });
    const homeHtml = view.renderHome();

    assert.match(homeHtml, /xapp-compose-button/);
    assert.match(homeHtml, /fa-regular fa-pen-to-square/);
    assert.doesNotMatch(homeHtml, /fa-feather-pointed/);
});

test('X compose page supports text and up to four server-backed image uploads', () => {
    const view = new XView({ xData: new XData(new MemoryStorage()), phoneShell: { setContent() {} } });
    const composeHtml = view.renderCompose();
    const source = fs.readFileSync(new URL('../apps/x/x-view.js', import.meta.url), 'utf8');

    assert.match(composeHtml, /id="xapp-compose-text"/);
    assert.match(composeHtml, /id="xapp-compose-image-input"[^>]+multiple/);
    assert.match(composeHtml, /最多 4 张/);
    assert.match(source, /uploadDataUrl\?\.\(dataUrl, 'x_img'\)/);
    assert.match(source, /\/\^\\\/backgrounds\\\/phone_x_img_/);
});

test('X compose header reserves the phone status-bar safe area', () => {
    const cssSource = fs.readFileSync(new URL('../apps/x/x.css', import.meta.url), 'utf8');
    const headerStart = cssSource.indexOf('.xapp-compose-header');
    const headerEnd = cssSource.indexOf('.xapp-compose-header h1', headerStart);
    const headerBlock = cssSource.slice(headerStart, headerEnd);

    assert.match(headerBlock, /height:\s*69px/);
    assert.match(headerBlock, /flex:\s*0 0 69px/);
    assert.match(headerBlock, /padding:\s*27px 10px 5px/);
});

test('X feed header omits the add-feed control', () => {
    const view = new XView({ xData: new XData(new MemoryStorage()), phoneShell: { setContent() {} } });
    const homeHtml = view.renderHome();

    assert.doesNotMatch(homeHtml, /xapp-feed-add/);
    assert.doesNotMatch(homeHtml, /fa-plus/);
});

test('X bottom navigation is rendered as the shared glass surface', () => {
    const view = new XView({ xData: new XData(new MemoryStorage()), phoneShell: { setContent() {} } });

    assert.match(view.renderBottomNav(), /class="xapp-bottom-nav"/);
});

test('X post detail uses a chevron-only back icon', () => {
    const { data, post } = createDataWithPost();
    const view = new XView({ xData: data, phoneShell: { setContent() {} } });
    view.currentPostId = post.id;
    const detailHtml = view.renderPostDetail();

    assert.match(detailHtml, /fa-chevron-left/);
    assert.doesNotMatch(detailHtml, /fa-arrow-left/);
});

test('X account badges distinguish personal, official, and advertiser accounts', () => {
    const view = new XView({ xData: new XData(new MemoryStorage()), phoneShell: { setContent() {} } });
    const official = view.renderVerified('official');
    const advertiser = view.renderVerified('advertiser');

    assert.match(official, /xapp-verified-official/);
    assert.match(official, /fa-circle-check/);
    assert.match(advertiser, /xapp-verified-advertiser/);
    assert.match(advertiser, /fa-circle-check/);
    assert.equal(view.renderVerified('personal'), '');
    assert.match(view.renderVerified('blue'), /xapp-verified-official/);
    assert.match(view.renderVerified('gold'), /xapp-verified-advertiser/);
});

test('X profile and user posts persist independently for each chat storage', () => {
    const firstChatStorage = new MemoryStorage();
    const secondChatStorage = new MemoryStorage();
    const firstChat = new XData(firstChatStorage);
    const secondChat = new XData(secondChatStorage);

    firstChat.saveProfile({
        avatar: '/backgrounds/phone_x_avatar_first.png',
        nickname: '第一窗口',
        following: 12,
        followers: 34
    });
    firstChat.saveUserPosts([{
        id: 'x-user-post-first',
        content: '只属于第一个聊天窗口',
        comments: 0,
        likes: 0,
        commentList: []
    }]);

    assert.equal(new XData(firstChatStorage).getProfile().nickname, '第一窗口');
    assert.equal(new XData(firstChatStorage).getUserPosts()[0].content, '只属于第一个聊天窗口');
    assert.equal(secondChat.getProfile().nickname, '');
    assert.equal(secondChat.getUserPosts().length, 0);
});

test('X avatar follows the selected Persona until a custom avatar is saved', () => {
    const storage = new MemoryStorage();
    const data = new XData(storage);
    const view = new XView({ xData: data, phoneShell: { setContent() {} } });
    const previousDocument = globalThis.document;

    globalThis.document = {
        querySelector(selector) {
            if (selector === '#user_avatar_block .avatar-container.selected img') {
                return { src: 'https://example.test/persona.png' };
            }
            return null;
        }
    };

    try {
        assert.equal(view._getXDisplayAvatar(), 'https://example.test/persona.png');
        data.saveProfile({ ...data.getProfile(), avatar: '/backgrounds/phone_x_avatar_custom.png' });
        assert.equal(view._getXDisplayAvatar(), '/backgrounds/phone_x_avatar_custom.png');
        assert.match(view.renderHome(), /phone_x_avatar_custom\.png/);
    } finally {
        if (previousDocument === undefined) {
            delete globalThis.document;
        } else {
            globalThis.document = previousDocument;
        }
    }
});

test('X profile page shows account stats and only the current chat user posts', () => {
    const data = new XData(new MemoryStorage());
    data.saveProfile({ nickname: '柚月', following: 14, followers: 2, avatar: '' });
    data.saveUserPosts([{
        id: 'x-user-post-profile',
        content: '个人主页里的历史帖子',
        comments: 0,
        likes: 6,
        commentList: []
    }]);
    const view = new XView({ xData: data, phoneShell: { setContent() {} } });
    const profileHtml = view.renderProfile();

    assert.match(profileHtml, /柚月/);
    assert.match(profileHtml, /14<\/strong> 关注/);
    assert.match(profileHtml, /2<\/strong> 粉丝/);
    assert.match(profileHtml, /个人主页里的历史帖子/);
    assert.match(profileHtml, /data-post-source="user"/);
    assert.match(profileHtml, /xapp-profile-avatar-upload/);
    assert.doesNotMatch(profileHtml, /6\.1 Sol 已经上线/);
    assert.doesNotMatch(profileHtml, /@yuzuki/);
});

test('comments on X profile posts are saved back to x_user_posts', () => {
    const storage = new MemoryStorage();
    const data = new XData(storage);
    data.saveProfile({ nickname: '当前用户' });
    data.saveUserPosts([{
        id: 'x-user-post-comment',
        content: '可以回复的个人帖子',
        comments: 0,
        likes: 0,
        commentList: []
    }]);

    data.addComment('x-user-post-comment', '个人页回复', null, 'user');

    const reloaded = new XData(storage);
    const savedPost = reloaded.getPost('x-user-post-comment', 'user');
    assert.equal(savedPost.commentList.at(-1).text, '个人页回复');
    assert.equal(savedPost.commentList.at(-1).name, '当前用户');
    assert.equal(savedPost.comments, 1);
});

test('X profile page includes a compact editor for nickname and account counts', () => {
    const data = new XData(new MemoryStorage());
    data.saveProfile({ nickname: '旧昵称', following: 3, followers: 4 });
    const view = new XView({ xData: data, phoneShell: { setContent() {} } });
    const profileHtml = view.renderProfile();

    assert.match(profileHtml, /xapp-profile-edit-button/);
    assert.match(profileHtml, /id="xapp-profile-edit-nickname"/);
    assert.match(profileHtml, /id="xapp-profile-edit-following"/);
    assert.match(profileHtml, /id="xapp-profile-edit-followers"/);
    assert.match(profileHtml, /class="xapp-profile-edit-overlay is-hidden"/);
});

test('X profile editor saves normalized values to the current chat profile', () => {
    const storage = new MemoryStorage();
    const data = new XData(storage);
    const view = new XView({ xData: data, phoneShell: { setContent() {} } });

    const saved = view.saveProfileEdits({
        nickname: '  新昵称  ',
        following: '-9',
        followers: '128.8'
    });

    assert.equal(saved.nickname, '新昵称');
    assert.equal(saved.following, 0);
    assert.equal(saved.followers, 128);
    assert.deepEqual(new XData(storage).getProfile(), saved);
});

test('X profile exposes a settings entry for generation configuration', () => {
    const view = new XView({ xData: new XData(new MemoryStorage()), phoneShell: { setContent() {} } });
    const profileHtml = view.renderProfile();

    assert.match(profileHtml, /xapp-profile-settings-button/);
    assert.match(profileHtml, /aria-label="X 设置"/);
    assert.match(profileHtml, /fa-gear/);
});

test('X settings page includes worldbook selection, jailbreak, and default prompt editors', () => {
    const view = new XView({ xData: new XData(new MemoryStorage()), phoneShell: { setContent() {} } });
    const settingsHtml = view.renderSettings();

    assert.match(settingsHtml, /id="xapp-use-worldbook"/);
    assert.match(settingsHtml, /id="xapp-include-character-user"/);
    assert.match(settingsHtml, /注入角色卡与用户信息/);
    assert.match(settingsHtml, /id="xapp-include-tavern-text"/);
    assert.match(settingsHtml, /注入酒馆正文内容/);
    assert.doesNotMatch(settingsHtml, /id="xapp-include-character-user"[^>]*checked/);
    assert.doesNotMatch(settingsHtml, /id="xapp-include-tavern-text"[^>]*checked/);
    assert.match(settingsHtml, /id="xapp-worldbook-list"/);
    assert.match(settingsHtml, /世界书选择/);
    assert.match(settingsHtml, /id="xapp-override-prompt"/);
    assert.match(settingsHtml, /X 破限词/);
    assert.match(settingsHtml, /id="xapp-reset-override-prompt"/);
    assert.match(settingsHtml, /id="xapp-feed-prompt"/);
    assert.match(settingsHtml, /默认提示词/);
    assert.match(settingsHtml, /id="xapp-reset-feed-prompt"/);
    assert.match(settingsHtml, /<details class="xapp-settings-fold xapp-settings-worldbook-fold">/);
    assert.match(settingsHtml, /<summary class="xapp-settings-fold-trigger">/);
    assert.match(settingsHtml, /id="xapp-use-worldbook" class="xapp-settings-toggle-input" type="checkbox" role="switch" checked/);
    assert.match(settingsHtml, /class="xapp-settings-toggle-track"/);

    const characterIndex = settingsHtml.indexOf('id="xapp-include-character-user"');
    const tavernTextIndex = settingsHtml.indexOf('id="xapp-include-tavern-text"');
    const worldbookToggleIndex = settingsHtml.indexOf('id="xapp-use-worldbook"');
    const worldbookSelectorIndex = settingsHtml.indexOf('xapp-settings-worldbook-fold');
    const overridePromptIndex = settingsHtml.indexOf('id="xapp-override-prompt"');
    const feedPromptIndex = settingsHtml.indexOf('id="xapp-feed-prompt"');
    assert.ok(characterIndex < tavernTextIndex);
    assert.ok(tavernTextIndex < worldbookToggleIndex);
    assert.ok(worldbookToggleIndex < worldbookSelectorIndex);
    assert.ok(worldbookSelectorIndex < overridePromptIndex);
    assert.ok(overridePromptIndex < feedPromptIndex);
});

test('X public context switches default off and persist per chat storage', async () => {
    const storage = new MemoryStorage();
    const data = new XData(storage);

    assert.deepEqual(data.getGenerationContextSettings(), {
        includeCharacterUser: false,
        includeTavernText: false
    });

    await data.setGenerationContextSetting('includeCharacterUser', true);
    await data.setGenerationContextSetting('includeTavernText', true);

    assert.equal(storage.get(CONTEXT_SETTING_KEYS.includeCharacterUser), true);
    assert.equal(storage.get(CONTEXT_SETTING_KEYS.includeTavernText), true);
    assert.deepEqual(new XData(storage).getGenerationContextSettings(), {
        includeCharacterUser: true,
        includeTavernText: true
    });
});

test('X public context switch controls save their selected states', async () => {
    const storage = new MemoryStorage();
    const data = new XData(storage);
    const characterToggle = new EventTarget();
    const tavernTextToggle = new EventTarget();
    [characterToggle, tavernTextToggle].forEach((toggle) => {
        toggle.checked = false;
        toggle.disabled = false;
    });
    const root = {
        querySelector(selector) {
            if (selector === '#xapp-include-character-user') return characterToggle;
            if (selector === '#xapp-include-tavern-text') return tavernTextToggle;
            return null;
        }
    };
    const previousWindow = globalThis.window;
    globalThis.window = { VirtualPhone: {} };

    try {
        const view = new XView({
            xData: data,
            phoneShell: { showNotification() {} }
        });
        view.bindSettingsEvents(root);

        characterToggle.checked = true;
        characterToggle.dispatchEvent(new Event('change'));
        tavernTextToggle.checked = true;
        tavernTextToggle.dispatchEvent(new Event('change'));
        await new Promise(resolve => setImmediate(resolve));

        assert.equal(storage.get(CONTEXT_SETTING_KEYS.includeCharacterUser), true);
        assert.equal(storage.get(CONTEXT_SETTING_KEYS.includeTavernText), true);
        assert.equal(characterToggle.checked, true);
        assert.equal(tavernTextToggle.checked, true);
        assert.equal(characterToggle.disabled, false);
        assert.equal(tavernTextToggle.disabled, false);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('X only injects character, user, account, and Tavern text when their switches are enabled', async () => {
    const storage = new MemoryStorage();
    const data = new XData(storage);
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousSillyTavern = globalThis.SillyTavern;

    globalThis.document = {
        getElementById(id) {
            return id === 'persona_description' ? { value: '用户 Persona 私人设定' } : null;
        }
    };
    globalThis.SillyTavern = {
        getContext() {
            return {
                characterId: 0,
                characters: [{
                    name: '角色甲',
                    description: '角色卡私人描述',
                    personality: '谨慎',
                    scenario: '未公开背景'
                }],
                name1: '用户甲',
                name2: '角色甲',
                chat: [
                    { is_user: true, mes: '酒馆正文里的用户秘密' },
                    { is_user: false, mes: '酒馆正文里的角色秘密' }
                ]
            };
        }
    };
    globalThis.window = {
        VirtualPhone: {
            storage,
            worldbookManager: {
                async appendWorldbookMessages(messages, appKey) {
                    assert.equal(appKey, 'x');
                    messages.push({ role: 'system', content: '独立世界书公开背景' });
                }
            }
        }
    };

    try {
        const publicMessages = await data._collectContextMessages();
        const publicText = publicMessages.map(message => message.content).join('\n');
        assert.match(publicText, /独立世界书公开背景/);
        assert.doesNotMatch(publicText, /角色卡私人描述|用户 Persona 私人设定|酒馆正文里的|当前 X 账号/);

        await data.setGenerationContextSetting('includeCharacterUser', true);
        const identityMessages = await data._collectContextMessages();
        const identityText = identityMessages.map(message => message.content).join('\n');
        assert.match(identityText, /角色卡私人描述/);
        assert.match(identityText, /用户 Persona 私人设定/);
        assert.match(identityText, /当前 X 账号/);
        assert.doesNotMatch(identityText, /酒馆正文里的/);

        await data.setGenerationContextSetting('includeTavernText', true);
        const allMessages = await data._collectContextMessages();
        const allText = allMessages.map(message => message.content).join('\n');
        assert.match(allText, /酒馆正文里的用户秘密/);
        assert.match(allText, /酒馆正文里的角色秘密/);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
        else globalThis.SillyTavern = previousSillyTavern;
    }
});

test('X worldbook switch persists checkbox changes and refreshes the selector', async () => {
    const toggle = new EventTarget();
    toggle.checked = false;
    toggle.disabled = false;
    const container = { innerHTML: '' };
    const savedValues = [];
    const renderedValues = [];
    const manager = {
        enabled: false,
        getEnabled() {
            return this.enabled;
        },
        async setEnabled(appKey, enabled) {
            assert.equal(appKey, 'x');
            this.enabled = enabled;
            savedValues.push(enabled);
        },
        async renderWorldbookSelector(target, appKey) {
            assert.equal(target, container);
            assert.equal(appKey, 'x');
            renderedValues.push(this.enabled);
        }
    };
    const root = {
        querySelector(selector) {
            if (selector === '#xapp-use-worldbook') return toggle;
            if (selector === '#xapp-worldbook-list') return container;
            return null;
        }
    };
    const previousWindow = globalThis.window;
    globalThis.window = { VirtualPhone: { worldbookManager: manager } };

    try {
        const view = new XView({
            xData: new XData(new MemoryStorage()),
            phoneShell: { showNotification() {} }
        });
        view.bindSettingsEvents(root);
        await new Promise(resolve => setImmediate(resolve));

        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));
        await new Promise(resolve => setImmediate(resolve));

        assert.deepEqual(savedValues, [true]);
        assert.equal(toggle.checked, true);
        assert.equal(toggle.disabled, false);
        assert.deepEqual(renderedValues, [false, true]);
    } finally {
        if (previousWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = previousWindow;
        }
    }
});

test('X settings page renders without the bottom navigation', () => {
    let renderedHtml = '';
    const view = new XView({
        xData: new XData(new MemoryStorage()),
        phoneShell: {
            setContent(html) {
                renderedHtml = html;
            }
        }
    });
    const previousDocument = globalThis.document;
    globalThis.document = { querySelector: () => null };

    try {
        view.currentPage = 'settings';
        view.render();
        assert.match(renderedHtml, /data-page="settings"/);
        assert.match(renderedHtml, /data-swipe-back-through-controls="true"/);
        assert.doesNotMatch(renderedHtml, /xapp-bottom-nav/);
    } finally {
        if (previousDocument === undefined) {
            delete globalThis.document;
        } else {
            globalThis.document = previousDocument;
        }
    }
});

test('X swipe back handles every internal page before leaving the app', () => {
    const previousDocument = globalThis.document;
    const calls = [];
    globalThis.document = {
        querySelector(selector) {
            if (selector !== '.phone-view-current') return null;
            return { querySelector: (childSelector) => childSelector === '.xapp-root' ? {} : null };
        }
    };

    try {
        const app = Object.create(XApp.prototype);
        let directMessageOpen = false;
        app.view = {
            currentPage: 'detail',
            closePostMenu: () => false,
            closeForwardDialog: () => false,
            returnToDirectMessageList: () => {
                if (!directMessageOpen) return false;
                directMessageOpen = false;
                calls.push('dm-list');
                return true;
            },
            returnFromDetail: () => calls.push('detail'),
            returnFromCompose: () => calls.push('compose'),
            returnFromProfile: () => calls.push('profile'),
            returnFromSettings: () => calls.push('settings')
        };

        for (const page of ['detail', 'compose', 'profile', 'settings']) {
            const event = { detail: { handled: false } };
            app.view.currentPage = page;
            assert.equal(app.handleSwipeBack(event), true);
            assert.equal(event.detail.handled, true);
        }

        directMessageOpen = true;
        app.view.currentPage = 'chat';
        const directMessageEvent = { detail: { handled: false } };
        assert.equal(app.handleSwipeBack(directMessageEvent), true);
        assert.equal(directMessageEvent.detail.handled, true);

        assert.deepEqual(calls, ['detail', 'compose', 'profile', 'settings', 'dm-list']);
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});

test('phone swipe handling lets X controls start back gestures and suppresses the trailing click', () => {
    const phoneShellSource = fs.readFileSync(new URL('../phone/phone-shell.js', import.meta.url), 'utf8');

    assert.match(phoneShellSource, /data-swipe-back-through-controls/);
    assert.match(phoneShellSource, /shouldBlockSwipeBackStart\(e\.target\)/);
    assert.match(phoneShellSource, /_swipeClickGuardUntil = Date\.now\(\) \+ 1000/);
    assert.match(phoneShellSource, /new CustomEvent\('phone:swipeBack', \{ detail: swipeDetail \}\)/);
});

test('X feed has a non-empty default prompt registered in PromptManager', () => {
    const manager = new PromptManager({ get: () => null, set: async () => {} });
    const overridePrompt = manager.getDefaultPrompts().x?.override;
    const prompt = manager.getDefaultPrompts().x?.feed;

    assert.equal(overridePrompt?.enabled, true);
    assert.equal(overridePrompt?.name, '🧩 X 破限词');
    assert.ok((overridePrompt?.content || '').trim().length > 0);
    assert.match(overridePrompt.content, /X APP 公开信息流创作元系统前置词/);
    assert.match(overridePrompt.content, /【当前手机时间】/);
    assert.match(overridePrompt.content, /\{\{CURRENT_PHONE_TIME\}\}/);
    assert.match(overridePrompt.content, /所有帖子、热搜和评论中的相对时间必须以当前手机时间为准/);
    assert.match(overridePrompt.content, /<Twitter>/);
    assert.equal(prompt?.enabled, true);
    assert.equal(prompt?.name, '𝕏 信息流生成');
    assert.ok((prompt?.content || '').trim().length > 0);
    assert.match(prompt.content, /用户粉丝数动态计算规则/);
    assert.match(prompt.content, /用户粉丝数：/);
    assert.match(prompt.content, /<Twitter>/);
    assert.match(prompt.content, /<\/Twitter>/);
    assert.match(prompt.content, /配图：\[图片\]（中文画面描述）（English tags）/);
});

test('X parser reads posts, account types, counts, and nested replies from Twitter tags', () => {
    const data = new XData(new MemoryStorage());
    const posts = data.parseTwitterContent(`说明文字
<Twitter>
博主：星河社（官方）
时间：刚刚
正文：今晚有公开活动。
配图：[图片]（夜晚的露天活动现场）（night event, outdoor stage, city lights）[图片]https://example.test/event.jpg
回复数：12
点赞数：1.2万
评论：
- 小林：期待
- 阿月 回复 小林：我也会去
---
博主：推广中心（广告）
时间：1小时前
正文：新品公开发布。
回复数：3
点赞数：80
评论：
- 路人：看起来不错
</Twitter>`);

    assert.equal(posts.length, 2);
    assert.equal(posts[0].author.accountType, 'official');
    assert.equal(posts[0].likes, 12000);
    assert.equal(posts[0].comments, 12);
    assert.equal(posts[0].images.length, 2);
    assert.match(posts[0].images[0], /^\[图片\]（夜晚的露天活动现场）/);
    assert.equal(posts[0].images[1], '[图片]https://example.test/event.jpg');
    assert.equal(posts[0].commentList[1].parentId, posts[0].commentList[0].id);
    assert.equal(posts[0].commentList[1].replyTo, posts[0].commentList[0].handle);
    assert.equal(posts[1].author.accountType, 'advertiser');
    assert.equal(posts[1].promoted, true);
});

test('X follower parser accepts formatted totals and keeps the value scoped to Twitter output', () => {
    const storage = new MemoryStorage();
    const data = new XData(storage);
    data.saveProfile({ followers: 80 });

    assert.equal(data._extractFollowersCount(`<Twitter>\n用户粉丝数：1.5万\n---\n博主：测试\n正文：内容\n</Twitter>`), 15000);
    assert.equal(data._extractFollowersCount(`<Twitter>\n用户粉丝数：2千\n---\n博主：测试\n正文：内容\n</Twitter>`), 2000);
    assert.equal(data._extractFollowersCount('用户粉丝数：999999'), null);
    assert.equal(data._updateFollowersFromText(`<Twitter>\n用户粉丝数：3K\n---\n博主：测试\n正文：内容\n</Twitter>`), 3000);
    assert.equal(new XData(storage).getProfile().followers, 3000);
});

test('X image markup renders direct images and pending generation cards', () => {
    const post = createTestPost({
        images: [
            '/backgrounds/phone_x_img_saved.png',
            '[图片]（窗边的一杯咖啡）（coffee cup, window light, cozy room）'
        ]
    });
    const view = new XView({ xData: new XData(new MemoryStorage()), phoneShell: { setContent() {} } });
    const html = view.renderMedia(post, { source: 'feed' });

    assert.match(html, /class="xapp-post-images xapp-image-grid-2"/);
    assert.match(html, /src="\/backgrounds\/phone_x_img_saved\.png"/);
    assert.match(html, /class="xapp-image-generate"/);
    assert.match(html, /data-image-prompt="coffee cup, window light, cozy room"/);
    assert.match(html, /data-image-description="窗边的一杯咖啡"/);
});

test('X image generation uses the X app scope and persists only a backgrounds path', async () => {
    const storage = new MemoryStorage();
    const { data, post } = createDataWithPost(storage, {
        images: ['[图片]（雨后的街道）（wet street, reflections, city night）']
    });
    const notifications = [];
    const view = new XView({
        xData: data,
        storage,
        phoneShell: {
            setContent() {},
            showNotification(...args) {
                notifications.push(args);
            }
        }
    });
    const previousWindow = globalThis.window;
    let generationOptions = null;
    let uploadedPrefix = '';

    globalThis.window = {
        VirtualPhone: {
            imageGenerationManager: {
                storage,
                async generate(options) {
                    generationOptions = options;
                    return { imageData: 'data:image/png;base64,ZmFrZQ==', provider: 'test' };
                }
            },
            imageManager: {
                async uploadDataUrl(dataUrl, prefix) {
                    assert.match(dataUrl, /^data:image\/png;base64,/);
                    uploadedPrefix = prefix;
                    return '/backgrounds/phone_x_img_saved.png';
                }
            }
        }
    };

    try {
        const savedPath = await view.generatePostImage({
            postId: post.id,
            source: 'feed',
            index: 0,
            promptText: 'wet street, reflections, city night',
            descriptionText: '雨后的街道'
        });

        assert.equal(generationOptions.app, 'x');
        assert.equal(uploadedPrefix, 'x_img');
        assert.equal(savedPath, '/backgrounds/phone_x_img_saved.png');
        assert.equal(data.getPosts()[0].images[0], '/backgrounds/phone_x_img_saved.png');
        assert.doesNotMatch(storage.get('x_posts'), /data:image/);
        assert.ok(notifications.some((item) => item[1] === '配图生成完成'));
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('X user publishing keeps only backgrounds paths and stores posts per chat', () => {
    const storage = new MemoryStorage();
    const data = new XData(storage);
    const post = data.publishUserPost('  新帖子  ', [
        '/backgrounds/phone_x_img_a.png',
        'data:image/png;base64,ZmFrZQ==',
        'https://example.com/remote.png',
        '/backgrounds/phone_x_img_b.png',
        '/backgrounds/phone_x_img_c.png',
        '/backgrounds/phone_x_img_d.png',
        '/backgrounds/phone_x_img_e.png'
    ]);

    assert.equal(post.content, '新帖子');
    assert.deepEqual(post.images, [
        '/backgrounds/phone_x_img_a.png',
        '/backgrounds/phone_x_img_b.png',
        '/backgrounds/phone_x_img_c.png',
        '/backgrounds/phone_x_img_d.png'
    ]);
    assert.equal(new XData(storage).getUserPosts()[0].id, post.id);
    assert.doesNotMatch(storage.get('x_user_posts'), /data:image|example\.com/);
});

test('X regenerated images replace and clean the previous managed image', async () => {
    const storage = new MemoryStorage();
    const oldPath = '/backgrounds/phone_x_img_old.png';
    const { data, post } = createDataWithPost(storage, {
        images: [oldPath],
        imageGenerationStates: [{
            status: 'done',
            prompt: 'city night, reflections',
            description: '夜晚街道',
            generatedImageUrl: oldPath
        }]
    });
    const deleted = [];
    const previousWindow = globalThis.window;
    globalThis.window = {
        VirtualPhone: {
            imageGenerationManager: {
                storage,
                async generate(options) {
                    assert.equal(options.app, 'x');
                    return { imageData: 'data:image/png;base64,ZmFrZQ==' };
                }
            },
            imageManager: {
                async uploadDataUrl() {
                    return '/backgrounds/phone_x_img_new.png';
                },
                async deleteManagedBackgroundByPath(path, options) {
                    deleted.push({ path, options });
                    return { success: true };
                }
            }
        }
    };
    const view = new XView({ xData: data, storage, phoneShell: { setContent() {}, showNotification() {} } });

    try {
        await view.generatePostImage({
            postId: post.id,
            source: 'feed',
            index: 0,
            clearPreviousImage: true
        });
        assert.equal(data.getPosts()[0].images[0], '/backgrounds/phone_x_img_new.png');
        assert.deepEqual(deleted, [{
            path: oldPath,
            options: { quiet: true, skipIfReferenced: true, ignoreAlbumIndex: true }
        }]);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('deleting an X user post removes data before cleaning all managed post images', async () => {
    const storage = new MemoryStorage();
    const data = new XData(storage);
    const post = data.publishUserPost('带图帖子', [
        '/backgrounds/phone_x_img_manual.png',
        '/backgrounds/phone_x_img_shared.png'
    ]);
    post.imageGenerationStates = [{
        generatedImageUrl: '/backgrounds/phone_x_img_generated.png'
    }];
    data.saveUserPosts(data.getUserPosts());

    const deleted = [];
    const previousWindow = globalThis.window;
    const previousConfirm = globalThis.confirm;
    globalThis.confirm = () => true;
    globalThis.window = {
        VirtualPhone: {
            imageManager: {
                async deleteManagedBackgroundByPath(path, options) {
                    assert.equal(data.getUserPosts().some((item) => item.id === post.id), false);
                    deleted.push({ path, options });
                    return { success: true };
                }
            }
        }
    };
    const view = new XView({ xData: data, storage, phoneShell: { setContent() {}, showNotification() {} } });
    view.render = () => {};

    try {
        assert.equal(await view.deleteUserPost(post.id, 'user'), true);
        assert.deepEqual(deleted.map((item) => item.path).sort(), [
            '/backgrounds/phone_x_img_generated.png',
            '/backgrounds/phone_x_img_manual.png',
            '/backgrounds/phone_x_img_shared.png'
        ]);
        assert.ok(deleted.every((item) => item.options.skipIfReferenced === true));
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
        if (previousConfirm === undefined) delete globalThis.confirm;
        else globalThis.confirm = previousConfirm;
    }
});

test('X parser ignores untagged model output', () => {
    const data = new XData(new MemoryStorage());

    assert.deepEqual(data.parseTwitterContent('博主：没有标签\n正文：不应被解析'), []);
});

test('X feed refresh calls the X API with worldbook context and saves parsed posts', async () => {
    const storage = new MemoryStorage();
    const data = new XData(storage);
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousSillyTavern = globalThis.SillyTavern;
    let requestMessages = null;
    let requestOptions = null;
    let worldbookKey = '';

    globalThis.document = { getElementById: () => null };
    globalThis.SillyTavern = {
        getContext() {
            return {
                name1: '用户',
                name2: '角色',
                max_response_length: 1200,
                chat: [
                    { is_user: true, mes: '今天有什么公开消息？' },
                    { is_user: false, mes: '角色提到稍后会公开活动。' }
                ]
            };
        }
    };
    globalThis.window = {
        VirtualPhone: {
            storage,
            timeManager: {
                getCurrentStoryTime() {
                    return {
                        date: '2044年09月05日',
                        time: '21:30',
                        weekday: '星期一'
                    };
                }
            },
            promptManager: {
                ensureLoaded() {},
                getPromptForFeature(app, feature) {
                    assert.equal(app, 'x');
                    if (feature === 'override') return 'X 独立破限词：当前手机时间：{{CURRENT_PHONE_TIME}}，只输出 <Twitter> 标签';
                    assert.equal(feature, 'feed');
                    return '请输出 <Twitter> 帖子';
                },
                renderPromptForFeature(app, feature, variables) {
                    assert.equal(app, 'x');
                    assert.equal(variables.CURRENT_FOLLOWERS, '321');
                    assert.equal(variables.currentFollowers, '321');
                    assert.equal(variables.CURRENT_FOLLOWING_NAMES, 'Tibo');
                    assert.equal(variables.followingAccountNames, 'Tibo');
                    if (feature === 'override') return `X 独立破限词：当前手机时间：${variables.CURRENT_PHONE_TIME}，只输出 <Twitter> 标签`;
                    assert.equal(feature, 'feed');
                    return '请输出 <Twitter> 帖子';
                }
            },
            worldbookManager: {
                async appendWorldbookMessages(messages, appKey) {
                    worldbookKey = appKey;
                    messages.push({ role: 'system', content: '世界书公开背景', isPhoneMessage: true });
                }
            },
            apiManager: {
                async callAI(messages, options) {
                    requestMessages = messages;
                    requestOptions = options;
                    return {
                        success: true,
                        summary: `<Twitter>
用户粉丝数：456
---
博主：活动中心（官方）
时间：刚刚
正文：公开活动将在今晚开始。
回复数：1
点赞数：9
评论：
- 观众：收到
</Twitter>`
                    };
                }
            }
        }
    };

    try {
        data.saveProfile({ nickname: '测试用户', followers: 321 });
        const followedPost = createTestPost();
        data.savePosts([followedPost]);
        data.toggleFollowPostAuthor(followedPost);
        const posts = await data.generateFeed();
        assert.equal(worldbookKey, 'x');
        assert.equal(requestOptions.appId, 'x');
        assert.ok(requestOptions.max_tokens >= 1600);
        assert.equal(requestMessages[0].name, 'SYSTEM (X 破限词)');
        assert.match(requestMessages[0].content, /X 独立破限词/);
        assert.match(requestMessages[0].content, /2044年09月05日 星期一 21:30/);
        assert.ok(requestMessages.some((message) => message.name === 'SYSTEM (X 用户粉丝数)' && /当前粉丝数：321/.test(message.content)));
        assert.ok(requestMessages.some((message) => message.name === 'SYSTEM (X 正在关注账号)' && /- Tibo/.test(message.content)));
        assert.ok(!requestMessages.some((message) => message.name === 'SYSTEM (X 公开上下文边界)'));
        assert.ok(requestMessages.some((message) => message.content === '世界书公开背景'));
        assert.ok(requestMessages.some((message) => /当前手机时间：2044年09月05日 星期一 21:30/.test(message.content)));
        assert.ok(!requestMessages.some((message) => /不要根据角色卡、用户 Persona 或 X 账号资料/.test(message.content)));
        assert.ok(!requestMessages.some((message) => /不要根据酒馆正文、最近剧情或私聊内容/.test(message.content)));
        assert.ok(!requestMessages.some((message) => /今天有什么公开消息|角色提到稍后会公开活动|【用户信息】|【当前 X 账号】/.test(message.content)));
        assert.equal(posts[0].author.name, '活动中心');
        assert.equal(data.getProfile().followers, 456);
        assert.equal(new XData(storage).getProfile().followers, 456);
        assert.equal(new XData(storage).getPosts()[0].content, '公开活动将在今晚开始。');
        assert.equal(new XData(storage).getFollowingPosts()[0].content, '测试帖子正文');
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
        else globalThis.SillyTavern = previousSillyTavern;
    }
});

test('X home includes a pull-to-refresh status area and replaceable feed list', () => {
    const view = new XView({ xData: new XData(new MemoryStorage()), phoneShell: { setContent() {} } });
    const homeHtml = view.renderHome();

    assert.match(homeHtml, /id="xapp-pull-refresh-indicator"/);
    assert.match(homeHtml, /class="xapp-feed-list"/);
});

test('X pull gestures suppress the synthetic click that would open the first post', () => {
    const listeners = new Map();
    const scroll = {
        dataset: {},
        scrollTop: 0,
        addEventListener(type, handler, options) {
            listeners.set(type, { handler, options });
        }
    };
    const root = {
        querySelector(selector) {
            return selector === '.xapp-feed-scroll' ? scroll : null;
        }
    };
    const view = new XView({ xData: new XData(new MemoryStorage()), phoneShell: { setContent() {} } });
    view.bindPullRefresh(root);

    listeners.get('touchstart').handler({ touches: [{ clientX: 10, clientY: 10 }] });
    listeners.get('touchmove').handler({
        touches: [{ clientX: 10, clientY: 32 }],
        cancelable: true,
        preventDefault() {}
    });
    listeners.get('touchend').handler({ cancelable: true, preventDefault() {} });

    const syntheticClick = {
        prevented: false,
        stopped: false,
        immediateStopped: false,
        preventDefault() { this.prevented = true; },
        stopPropagation() { this.stopped = true; },
        stopImmediatePropagation() { this.immediateStopped = true; }
    };
    assert.equal(listeners.get('click').options, true);
    listeners.get('click').handler(syntheticClick);
    assert.equal(syntheticClick.prevented, true);
    assert.equal(syntheticClick.stopped, true);
    assert.equal(syntheticClick.immediateStopped, true);

    view._suppressFeedClickUntil = 0;
    const normalClick = {
        prevented: false,
        preventDefault() { this.prevented = true; },
        stopPropagation() {},
        stopImmediatePropagation() {}
    };
    listeners.get('click').handler(normalClick);
    assert.equal(normalClick.prevented, false);
});

test('X worldbook switch hides the native checkbox without exposing theme borders', () => {
    const cssSource = fs.readFileSync(new URL('../apps/x/x.css', import.meta.url), 'utf8');

    assert.match(cssSource, /\.xapp-settings-toggle-input\s*\{[\s\S]*?appearance:\s*none\s*!important;[\s\S]*?border:\s*0\s*!important;[\s\S]*?opacity:\s*0\s*!important;/);
    assert.match(cssSource, /\.xapp-settings-toggle-input::before,[\s\S]*?\.xapp-settings-toggle-input::after\s*\{[\s\S]*?content:\s*none\s*!important;/);
    assert.match(cssSource, /\.xapp-settings-toggle-input:checked\s*\+\s*\.xapp-settings-toggle-track/);
    assert.match(cssSource, /\.xapp-settings-toggle-input:focus-visible\s*\+\s*\.xapp-settings-toggle-track\s*\{[\s\S]*?outline:\s*0\s*!important;[\s\S]*?box-shadow:\s*none\s*!important;/);
});

test('X post actions expose a dedicated WeChat forward control', () => {
    const { data, post } = createDataWithPost();
    const view = new XView({ xData: data, phoneShell: { setContent() {} } });
    const html = view.renderFeedPost(post);

    assert.match(html, /xapp-post-action-share/);
    assert.match(html, /data-post-id="x-post-test"/);
    assert.match(html, /aria-label="转发到微信"/);
    assert.match(html, /fa-regular fa-paper-plane/);
    assert.doesNotMatch(html, /fa-arrow-up-from-bracket/);
});

test('X forwarding writes the optional note and one structured card to WeChat', async () => {
    const storage = new MemoryStorage();
    const data = new XData(storage);
    const post = createTestPost({
        images: ['/backgrounds/phone_x_img_forward.png'],
        imageGenerationStates: [{
            generatedImageUrl: '/backgrounds/phone_x_img_forward.png',
            description: '夜晚的城市灯光'
        }]
    });
    const messages = [];
    const chat = { id: 'chat_friend', name: '好友', type: 'single', unread: 0 };
    const wechatData = {
        getUserInfo: () => ({ avatar: '/backgrounds/user.png' }),
        getChatList: () => [chat],
        getContacts: () => [],
        getChat: id => id === chat.id ? chat : null,
        getMessages: () => messages,
        addMessage(chatId, message) {
            assert.equal(chatId, chat.id);
            messages.push({ ...message, id: `msg_${messages.length + 1}`, time: '12:30' });
            return true;
        },
        saveData() {}
    };
    const previousWindow = globalThis.window;
    globalThis.window = { VirtualPhone: { cachedWechatData: wechatData } };

    try {
        const result = await data.forwardToWechat(post, '好友', { forwardText: '你看看这个' });
        assert.equal(result.chatId, chat.id);
        assert.deepEqual(messages.map(message => message.type), ['text', 'x_card']);
        assert.equal(messages[0].content, '你看看这个');
        assert.equal(messages[1].xData.author.name, 'Tibo');
        assert.equal(messages[1].xData.author.accountType, 'official');
        assert.equal(messages[1].xData.images[0], '/backgrounds/phone_x_img_forward.png');
        assert.equal(messages[1].xData.commentList.length, 2);
        assert.equal(messages[1].xData.originalTime, '刚刚');
        assert.match(messages[1].content, /^\[X分享\] Tibo（官方认证）/);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('offline WeChat history formats an X card as one message entry', () => {
    const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

    assert.match(source, /const formatXCardForOfflinePrompt = \(msg = \{\}\) =>/);
    assert.match(source, /else if \(msg\.type === 'x_card'\) \{\s*content = formatXCardForOfflinePrompt\(msg\);\s*\}/);
});
