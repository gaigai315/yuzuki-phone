import assert from 'node:assert/strict';
import test from 'node:test';

import { XView } from '../apps/x/x-view.js';
import { ImageUploadManager } from '../apps/settings/image-upload.js';

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

for (const contentType of ['application/octet-stream', '', 'text/plain', 'image/jpeg']) {
    test(`X saves generated PNG with reported type ${contentType || '(missing)'}`, async () => {
        const originalFetch = globalThis.fetch;
        const uploads = [];
        const uploader = Object.create(ImageUploadManager.prototype);
        uploader._backgroundExists = async () => false;
        uploader._buildManagedFilename = async (blob, prefix) => `phone_${prefix}_test.${uploader._getBlobExtension(blob)}`;
        uploader._buildRequestHeaders = async () => ({});
        uploader._recordUploadedBackground = async () => {};
        globalThis.fetch = async (url, options) => {
            if (url === 'https://images.example/generated') {
                return new Response(PNG_BYTES, { headers: { 'Content-Type': contentType } });
            }
            assert.equal(url, '/api/backgrounds/upload');
            uploads.push(options.body.get('avatar'));
            return new Response('', { status: 200 });
        };
        try {
            const view = new XView({});
            const path = await view._persistXGeneratedImage('https://images.example/generated', uploader);
            assert.equal(path, '/backgrounds/phone_x_img_test.png');
            assert.equal(uploads.length, 1);
            assert.equal(uploads[0].type, 'image/png');
            assert.deepEqual(new Uint8Array(await uploads[0].arrayBuffer()), PNG_BYTES);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
}

test('X rejects non-image and empty results before uploading', async () => {
    const originalFetch = globalThis.fetch;
    let uploads = 0;
    const uploader = { uploadBlob: async () => { uploads += 1; } };
    try {
        for (const response of [
            new Response('<html>upstream error</html>', { headers: { 'Content-Type': 'text/html' } }),
            new Response('', { headers: { 'Content-Type': 'image/png' } })
        ]) {
            globalThis.fetch = async () => response;
            await assert.rejects(
                new XView({})._persistXGeneratedImage('https://images.example/generated', uploader),
                /X 生图结果不是有效图片/
            );
        }
        assert.equal(uploads, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
