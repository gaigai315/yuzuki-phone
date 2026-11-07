import assert from 'node:assert/strict';
import test from 'node:test';

import { ImageUploadManager } from '../apps/settings/image-upload.js';
import { DiaryData } from '../apps/diary/diary-data.js';

const samples = [
    ['png', 'image/png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=', 'base64')],
    ['jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])],
    ['webp', 'image/webp', Buffer.from('52494646040000005745425056503820', 'hex')],
    ['gif', 'image/gif', Buffer.from('47494638396101000100800000000000ffffff3b', 'hex')],
];

async function withUploader(run) {
    const previousFetch = globalThis.fetch;
    const previousWindow = globalThis.window;
    const uploader = Object.create(ImageUploadManager.prototype);
    const requests = [];
    uploader.cache = { wallpaper: '/backgrounds/previous.png' };
    uploader._backgroundExists = async () => false;
    uploader._buildRequestHeaders = async () => ({});
    uploader._hashBlob = async () => 'original';
    uploader._recordUploadedBackground = async () => {};
    uploader._saveCache = async () => {};
    uploader.processImage = () => assert.fail('background uploads must bypass canvas processing');
    globalThis.window = { VirtualPhone: { imageManager: uploader } };
    globalThis.fetch = async (url, options) => {
        assert.equal(url, '/api/backgrounds/upload');
        const uploaded = options.body.get('avatar');
        requests.push({ name: uploaded.name, type: uploaded.type, bytes: Buffer.from(await uploaded.arrayBuffer()) });
        return { ok: true };
    };
    try {
        await run(uploader, requests);
    } finally {
        globalThis.fetch = previousFetch;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
}

for (const [extension, type, bytes] of samples) {
    test(`original ${extension} upload preserves every file byte and its format`, async () => {
        await withUploader(async (uploader, requests) => {
            const file = new File([bytes], `background.${extension}`, { type });
            const path = await uploader.uploadOriginalImage(file, 'wallpaper');
            assert.equal(path, `/backgrounds/phone_wallpaper_original.${extension}`);
            assert.equal(requests.length, 1);
            assert.equal(requests[0].type, type);
            assert.deepEqual(requests[0].bytes, bytes);
        });
    });
}

test('a mobile image file with an empty MIME type keeps its original bytes', async () => {
    await withUploader(async (uploader, requests) => {
        const bytes = samples[0][2];
        const file = new File([bytes], 'background.PNG');
        await uploader.uploadOriginalImage(file, 'diary_cover');
        assert.equal(requests[0].type, 'image/png');
        assert.deepEqual(requests[0].bytes, bytes);
    });
});

test('both diary backgrounds send the original file and store only server paths', async () => {
    await withUploader(async (_uploader, requests) => {
        const saved = new Map();
        const data = new DiaryData({
            get: key => saved.get(key),
            set: async (key, value) => saved.set(key, value),
        });
        const bytes = samples[0][2];
        const file = new File([bytes], 'full-resolution.png', { type: 'image/png' });
        await data.setCoverBg(file);
        await data.setTocBg(file);
        assert.equal(data.getCoverBg(), '/backgrounds/phone_diary_cover_original.png');
        assert.equal(data.getTocBg(), '/backgrounds/phone_diary_toc_original.png');
        assert.equal(requests.length, 2);
        for (const request of requests) assert.deepEqual(request.bytes, bytes);
        for (const value of saved.values()) assert.ok(value.startsWith('/backgrounds/'));
    });
});

test('wallpaper uploader retains original bytes and changes its cache only after upload succeeds', async () => {
    await withUploader(async (uploader, requests) => {
        const bytes = samples[1][2];
        const file = new File([bytes], 'wallpaper.jpg', { type: 'image/jpeg' });
        assert.equal(await uploader.uploadWallpaper(file), '/backgrounds/phone_wallpaper_original.jpg');
        assert.deepEqual(requests[0].bytes, bytes);
        assert.equal(uploader.cache.wallpaper, '/backgrounds/phone_wallpaper_original.jpg');
        globalThis.fetch = async () => { throw new Error('network unavailable'); };
        await assert.rejects(uploader.uploadWallpaper(file), /network unavailable/);
        assert.equal(uploader.cache.wallpaper, '/backgrounds/phone_wallpaper_original.jpg');
    });
});

test('original upload retains existing image type and 20 MB validation', async () => {
    await withUploader(async (uploader, requests) => {
        await assert.rejects(uploader.uploadOriginalImage(new File(['text'], 'text.txt', { type: 'text/plain' }), 'wallpaper'), /请选择图片文件/);
        await assert.rejects(uploader.uploadOriginalImage(new File(['heic'], 'photo.heic', { type: 'image/heic' }), 'wallpaper'), /HEIC\/HEIF/);
        await assert.rejects(uploader.uploadOriginalImage({ name: 'large.png', type: 'image/png', size: 20 * 1024 * 1024 + 1 }, 'wallpaper'), /20MB/);
        assert.equal(requests.length, 0);
    });
});
