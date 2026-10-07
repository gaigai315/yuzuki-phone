import assert from 'node:assert/strict';
import test from 'node:test';

import { detectImageMime, normalizeImageDataUrlMime, resolveImageMime } from '../config/image-mime.js';
import { ImageUploadManager } from '../apps/settings/image-upload.js';

const WEBP_BYTES = Uint8Array.from([
    0x52, 0x49, 0x46, 0x46,
    0x04, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x20
]);

test('image magic bytes override an incorrect reported JPEG MIME type', () => {
    assert.equal(detectImageMime(WEBP_BYTES), 'image/webp');
    assert.equal(resolveImageMime(WEBP_BYTES, 'image/jpeg'), 'image/webp');
});

test('unknown image bytes fall back to the reported image MIME type', () => {
    assert.equal(resolveImageMime(Uint8Array.from([1, 2, 3, 4]), 'image/jpeg'), 'image/jpeg');
    assert.equal(resolveImageMime(Uint8Array.from([1, 2, 3, 4]), 'text/plain'), '');
});

test('data URL MIME is repaired when JPEG metadata contains WebP bytes', () => {
    const payload = Buffer.from(WEBP_BYTES).toString('base64');
    const repaired = normalizeImageDataUrlMime(`data:image/jpeg;base64,${payload}`);

    assert.equal(repaired, `data:image/webp;base64,${payload}`);
});

test('image uploader normalizes MIME before choosing the managed extension', async () => {
    const uploader = Object.create(ImageUploadManager.prototype);
    const mislabeledBlob = new Blob([WEBP_BYTES], { type: 'image/jpeg' });
    const normalizedBlob = await uploader._normalizeImageBlobMime(mislabeledBlob);

    assert.equal(normalizedBlob.type, 'image/webp');
    assert.equal(uploader._getBlobExtension(normalizedBlob), 'webp');
});

test('image uploader can skip the existence probe for a newly generated unique file', async () => {
    const uploader = Object.create(ImageUploadManager.prototype);
    const originalFetch = globalThis.fetch;
    let existenceProbeCount = 0;
    const requests = [];
    uploader._backgroundExists = async () => {
        existenceProbeCount += 1;
        return false;
    };
    uploader._buildRequestHeaders = async () => ({});
    uploader._recordUploadedBackground = async () => {};
    globalThis.fetch = async (url, options) => {
        requests.push({ url, options });
        return { ok: true, status: 200, text: async () => '' };
    };

    try {
        const result = await uploader.uploadBlob(
            new Blob([WEBP_BYTES], { type: 'image/webp' }),
            'story_image_7_unique',
            { filename: 'phone_story_image_7_unique.webp', skipExistenceCheck: true }
        );

        assert.equal(result, '/backgrounds/phone_story_image_7_unique.webp');
        assert.equal(existenceProbeCount, 0);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, '/api/backgrounds/upload');
        assert.equal(requests[0].options.method, 'POST');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('legacy upload helper forwards upload options to the data URL uploader', async () => {
    const uploader = Object.create(ImageUploadManager.prototype);
    const signal = new AbortController().signal;
    let receivedOptions = null;
    uploader.uploadDataUrl = async (_dataUrl, _prefix, options) => {
        receivedOptions = options;
        return '/backgrounds/phone_story_image_forwarded.png';
    };

    const options = { allowBase64Fallback: false, skipExistenceCheck: true, signal };
    const result = await uploader._uploadToServer('data:image/png;base64,AAAA', 'story_image', options);

    assert.equal(result, '/backgrounds/phone_story_image_forwarded.png');
    assert.equal(receivedOptions, options);
});

test('managed image cleanup treats album history and the time card as active references', () => {
    const target = '/backgrounds/phone_card_time_test.png';
    const uploader = Object.create(ImageUploadManager.prototype);
    uploader.cache = { wallpaper: null, appIcons: {}, avatars: {} };
    uploader.storage = {
        get(key, fallback) {
            if (key === 'phone-card-time-image') return target;
            if (key === 'phone_album_upload_index') return JSON.stringify([{ path: target }]);
            return fallback;
        }
    };
    const originalWindow = globalThis.window;
    globalThis.window = { VirtualPhone: {} };

    try {
        assert.equal(uploader._countManagedBackgroundReferences(target), 2);
    } finally {
        globalThis.window = originalWindow;
    }
});

test('managed image cleanup scans lazily loaded WeChat X cards before deleting a post image', () => {
    const target = '/backgrounds/phone_x_img_forwarded.png';
    const uploader = Object.create(ImageUploadManager.prototype);
    uploader.cache = { wallpaper: null, appIcons: {}, avatars: {} };
    uploader.storage = { get: (_key, fallback) => fallback };
    const originalWindow = globalThis.window;
    let getMessagesCalls = 0;
    const wechatData = {
        data: { messages: {} },
        getChatList: () => [{ id: 'chat_x' }],
        getMessages(chatId) {
            assert.equal(chatId, 'chat_x');
            getMessagesCalls += 1;
            return [{ type: 'x_card', xData: { images: [target] } }];
        }
    };
    globalThis.window = { VirtualPhone: { cachedWechatData: wechatData } };

    try {
        assert.equal(uploader._countManagedBackgroundReferences(target), 1);
        assert.equal(getMessagesCalls, 1);
    } finally {
        globalThis.window = originalWindow;
    }
});

test('managed image cleanup treats archived X following posts as active references', () => {
    const target = '/backgrounds/phone_x_img_following.png';
    const uploader = Object.create(ImageUploadManager.prototype);
    uploader.cache = { wallpaper: null, appIcons: {}, avatars: {} };
    uploader.storage = { get: (_key, fallback) => fallback };
    const originalWindow = globalThis.window;
    globalThis.window = {
        VirtualPhone: {
            xApp: {
                xData: {
                    getPosts: () => [],
                    getFollowingPosts: () => [{ images: [target] }],
                    getUserPosts: () => [],
                    getProfile: () => ({})
                }
            }
        }
    };

    try {
        assert.equal(uploader._countManagedBackgroundReferences(target), 1);
    } finally {
        globalThis.window = originalWindow;
    }
});
