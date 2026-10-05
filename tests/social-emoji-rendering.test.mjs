import assert from 'node:assert/strict';
import test from 'node:test';

import { WeiboView } from '../apps/weibo/weibo-view.js';
import { MomentsView } from '../apps/wechat/moments-view.js';
import { XView } from '../apps/x/x-view.js';

test('Weibo maps bracket emoji tokens in posts, comments, and nested replies', () => {
    const view = new WeiboView({
        weiboData: {
            _getCurrentWeiboNickname: () => '我',
            getProfile: () => ({
                nickname: '我',
                avatar: '/backgrounds/phone_weibo_avatar_test.png'
            })
        }
    });
    const post = {
        id: 'weibo-emoji-post',
        blogger: '路人甲',
        content: '正文[吃瓜][比心][狗头]<script>',
        images: [],
        comments: 2,
        likes: 0,
        commentList: [
            { name: '甲', text: '主评论[崩溃][委屈]', location: '北京' },
            { name: '乙', text: '楼中楼[吃瓜][比心]', replyTo: '甲', location: '上海' }
        ]
    };

    const postHtml = view.renderWeiboPost(post, 'recommend');
    const commentsHtml = view._renderCommentsHtml(post);

    assert.match(postHtml, /正文🍉🫰<img /);
    assert.match(postHtml, /weibo-inline-emoji/);
    assert.match(postHtml, /&lt;script&gt;/);
    assert.doesNotMatch(postHtml, /<script>/);
    assert.match(commentsHtml, /主评论😭🥺/);
    assert.match(commentsHtml, /楼中楼🍉🫰/);
});

test('X maps bracket emoji tokens in posts, comments, and private-message text', () => {
    const view = new XView({ phoneShell: { setContent() {} } });
    const post = {
        id: 'x-emoji-post',
        author: {
            name: '路人乙',
            avatarText: '乙',
            avatarTone: 'sky',
            accountType: 'personal'
        },
        content: '正文[吃瓜][比心][狗头]<script>',
        images: [],
        imageGenerationStates: [],
        comments: 1,
        likes: 0
    };
    const comment = {
        id: 'x-emoji-comment',
        name: '评论者',
        text: '评论[崩溃][委屈]',
        likes: 0
    };

    const postHtml = view.renderFeedPost(post);
    const commentHtml = view.renderCommentContent(comment, post);
    const messageHtml = view._renderText('私信[吃瓜]\n[未知]');

    assert.match(postHtml, /正文🍉🫰<img /);
    assert.match(postHtml, /xapp-inline-emoji/);
    assert.match(postHtml, /&lt;script&gt;/);
    assert.doesNotMatch(postHtml, /<script>/);
    assert.match(commentHtml, /评论😭🥺/);
    assert.equal(messageHtml, '私信🍉<br>[未知]');
});

test('Moments maps the shared bracket emoji tokens in posts and comments', () => {
    const view = new MomentsView({
        wechatData: {
            getUserInfo: () => ({ name: '我' }),
            getChatList: () => [],
            getContacts: () => [],
            getContactByName: () => null
        },
        renderAvatar: () => '<span class="test-avatar">头像</span>'
    });
    const html = view.renderMomentItem({
        id: 'moment-emoji-post',
        name: '朋友圈好友',
        avatar: '🙂',
        time: '刚刚',
        text: '朋友圈正文[比心][狗头]<script>',
        images: [],
        likeList: [],
        commentList: [{ name: '评论者', text: '评论[委屈][转圈]' }]
    });

    assert.match(html, /朋友圈正文🫰<img /);
    assert.match(html, /评论🥺<img /);
    assert.match(html, /wechat-inline-system-emoji/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, /\[(?:比心|委屈|狗头|转圈)\]/);
});

test('X maps bracket emoji tokens in the private-message list preview', () => {
    const view = new XView({ phoneShell: { setContent() {} } });
    const html = view.renderDirectMessageListItem({
        id: 'x-emoji-thread',
        participant: {
            name: '路人丙',
            avatarText: '丙',
            avatarTone: 'mint',
            accountType: 'personal'
        },
        messages: [{ text: '刚看到这个[吃瓜]' }]
    });

    assert.match(html, /xapp-chat-thread-preview">刚看到这个🍉</);
});
