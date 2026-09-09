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
