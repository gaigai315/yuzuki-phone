import assert from 'node:assert/strict';
import test from 'node:test';

import { WeiboData } from '../apps/weibo/weibo-data.js';

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    get(key, fallback = null) {
        return this.values.has(key) ? this.values.get(key) : fallback;
    }

    set(key, value) {
        if (value === null || value === undefined) {
            this.values.delete(key);
        } else {
            this.values.set(key, value);
        }
    }

    remove(key) {
        this.values.delete(key);
    }
}

const createData = (nickname = '诺诺软糖') => {
    const data = new WeiboData(new MemoryStorage());
    data.saveProfile({ nickname, posts: 0 });
    return data;
};

const parseSinglePost = (data, blogger, content = '新工作第三天') => {
    const parsed = data.parseWeiboContent(`<Weibo>
博主：${blogger}（普通网友）
时间：刚刚
来自：iPhone 14
正文：${content}
数据：转发 0 | 评论 5 | 点赞 3
评论区（IP属地）：
</Weibo>`);
    assert.equal(parsed.posts.length, 1);
    return parsed.posts[0];
};

test('AI post matching the Weibo nickname is mirrored into My Posts', () => {
    const data = createData();
    const post = parseSinglePost(data, '@诺诺 软糖');
    post.id = 'ai-post-1';

    data.saveRecommendPosts([post]);

    assert.equal(post.isUserPost, true);
    assert.equal(post.aiAuthoredUserPost, true);
    assert.deepEqual(data.getUserPosts(), [post]);
    assert.equal(data.getProfile().posts, 1);

    const reloaded = new WeiboData(data.storage);
    assert.equal(reloaded.getRecommendPosts()[0].isUserPost, true);
    assert.equal(reloaded.getUserPosts()[0].id, 'ai-post-1');
});

test('different blogger names stay out of My Posts', () => {
    const data = createData();
    const post = parseSinglePost(data, '诺诺软糖屋');
    post.id = 'foreign-post-1';

    data.saveRecommendPosts([post]);

    assert.equal(post.isUserPost, undefined);
    assert.deepEqual(data.getUserPosts(), []);
    assert.equal(data.getProfile().posts, 0);
});

test('regenerated AI copies are deduplicated while retaining the newest post data', () => {
    const data = createData();
    const first = parseSinglePost(data, '诺诺软糖');
    first.id = 'ai-post-old';
    data.saveRecommendPosts([first]);

    const regenerated = parseSinglePost(data, '诺诺软糖');
    regenerated.id = 'ai-post-new';
    regenerated.comments = 8;
    data.saveRecommendPosts([regenerated]);

    const userPosts = data.getUserPosts();
    assert.equal(userPosts.length, 1);
    assert.equal(userPosts[0].id, 'ai-post-new');
    assert.equal(userPosts[0].comments, 8);
    assert.equal(data.getProfile().posts, 1);
});

test('matching posts generated inside hot-search details are mirrored too', () => {
    const data = createData();
    const post = parseSinglePost(data, '诺诺软糖', '热搜里的本人动态');
    post.id = 'hot-user-post';

    data.saveHotSearchDetail('测试热搜', { posts: [post], generatedAt: Date.now() });

    assert.equal(data.getUserPosts().length, 1);
    assert.equal(data.getUserPosts()[0].id, 'hot-user-post');
});
