import assert from 'node:assert/strict';
import test from 'node:test';

import { DiaryData } from '../apps/diary/diary-data.js';
import { HoneyData } from '../apps/honey/honey-data.js';
import { ChatView } from '../apps/wechat/chat-view.js';
import { MomentsView } from '../apps/wechat/moments-view.js';
import { WechatData } from '../apps/wechat/wechat-data.js';
import { WeiboData } from '../apps/weibo/weibo-data.js';
import { WeiboView } from '../apps/weibo/weibo-view.js';
import { XData } from '../apps/x/x-data.js';
import { XView } from '../apps/x/x-view.js';
import {
    extractImagePromptItems,
    parseImagePromptDescriptionPair,
    removeImagePromptItems
} from '../config/image-prompt-format.js';

const DESCRIPTION = '角色在舞台中央';
const PROMPT = '1girl, hitori gotoh (bocchi the rock!), pink tracksuit, guitar, stage lights';
const IMAGE_TAG = `[图片]（${DESCRIPTION}）（${PROMPT}）`;
const SECOND_PROMPT = '1girl, patchouli knowledge (touhou project), purple hair, library, book';
const SECOND_TAG = `[图片]（图书馆里的角色）（${SECOND_PROMPT}）`;

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

    remove(key) {
        this.values.delete(key);
    }
}

test('shared image prompt parser preserves nested identity parentheses and adjacent tags', () => {
    const source = `正文\n${IMAGE_TAG}\n${SECOND_TAG}\n结尾`;
    const items = extractImagePromptItems(source);

    assert.equal(items.length, 2);
    assert.equal(items[0].description, DESCRIPTION);
    assert.equal(items[0].prompt, PROMPT);
    assert.equal(items[0].raw, IMAGE_TAG);
    assert.equal(items[1].prompt, SECOND_PROMPT);
    assert.equal(removeImagePromptItems(source, items), '正文\n\n\n结尾');
    assert.deepEqual(
        parseImagePromptDescriptionPair(IMAGE_TAG).groups,
        [DESCRIPTION, PROMPT]
    );
});

test('X parsing and user publishing retain the full parenthesized identity tag', () => {
    const view = Object.create(XView.prototype);
    const data = new XData(new MemoryStorage());
    const post = data.publishUserPost(`正文\n${IMAGE_TAG}\n${SECOND_TAG}`);

    assert.equal(view._countComposeTextImages(`${IMAGE_TAG}\n${SECOND_TAG}`), 2);
    assert.equal(view._parseXImageItem(IMAGE_TAG).description, DESCRIPTION);
    assert.equal(view._parseXImageItem(IMAGE_TAG).prompt, PROMPT);
    assert.equal(post.content, '正文');
    assert.deepEqual(post.images, [IMAGE_TAG, SECOND_TAG]);
    assert.deepEqual(data._parseTwitterImages(`${IMAGE_TAG} ${SECOND_TAG}`), [IMAGE_TAG, SECOND_TAG]);
});

test('Weibo parsing and user publishing retain tags after identity parentheses', () => {
    const view = Object.create(WeiboView.prototype);
    const data = new WeiboData(new MemoryStorage());
    const parsed = view._parsePromptDescriptionPair(IMAGE_TAG);
    const post = data.publishUserPost(`正文\n${IMAGE_TAG}`);

    assert.equal(view._countWeiboDraftTextImages(`${IMAGE_TAG}\n${SECOND_TAG}`), 2);
    assert.deepEqual(parsed, { description: DESCRIPTION, prompt: PROMPT });
    assert.equal(post.content, '正文');
    assert.deepEqual(post.images, [IMAGE_TAG]);
    assert.equal(data._extractWeiboImageDisplayTag(IMAGE_TAG), `[图片]（${DESCRIPTION}）`);
});

test('WeChat chat and Moments parsers preserve nested English parentheses', () => {
    const chatView = Object.create(ChatView.prototype);
    const wechatData = Object.create(WechatData.prototype);
    const momentsView = Object.create(MomentsView.prototype);

    assert.deepEqual(chatView._parseImagePromptText(IMAGE_TAG), {
        description: DESCRIPTION,
        prompt: PROMPT
    });
    assert.deepEqual(wechatData._parseImagePromptText(IMAGE_TAG), {
        description: DESCRIPTION,
        prompt: PROMPT
    });
    assert.deepEqual(momentsView._parsePromptDescriptionPair(IMAGE_TAG), {
        description: DESCRIPTION,
        prompt: PROMPT
    });
    assert.deepEqual(
        chatView._collectInlineImagePromptMatches(`前文 ${IMAGE_TAG} 中间 ${SECOND_TAG} 后文`).map(item => item.raw),
        [IMAGE_TAG, SECOND_TAG]
    );
    assert.deepEqual(
        momentsView._extractMomentImageTagsFromText(`朋友圈正文\n${IMAGE_TAG}\n${SECOND_TAG}`),
        { text: '朋友圈正文', images: [IMAGE_TAG, SECOND_TAG] }
    );
});

test('Diary photo extraction and cleanup preserve the complete identity prompt', () => {
    const data = Object.create(DiaryData.prototype);
    const content = `今天练习了很久。\n${IMAGE_TAG}\n明天继续。`;
    const photos = data.extractPhotoPrompts(content, { author: '测试作者' }).photos;

    assert.equal(photos.length, 1);
    assert.equal(photos[0].reason, DESCRIPTION);
    assert.equal(photos[0].prompt, PROMPT);
    assert.equal(data.stripPhotoPromptTags(content), '今天练习了很久。\n\n明天继续。');
});

test('Honey NAI prompt extraction does not truncate parenthesized identity tags', () => {
    const data = Object.create(HoneyData.prototype);
    const source = `[图片]：${PROMPT}\n[视频]：镜头缓慢推进`;

    assert.equal(data._extractNaiPrompt(source), PROMPT);
});
