import assert from 'node:assert/strict';
import test from 'node:test';

import { SettingsApp } from '../apps/settings/settings-app.js';

test('Vibe group normalization persists only an encoding file path', () => {
    const app = Object.create(SettingsApp.prototype);
    const hugeEncoding = Buffer.alloc(4096, 7).toString('base64');
    const groups = app._normalizeNovelAIVibeGroups([{
        id: 'group-1',
        name: 'Imported',
        items: [{
            id: 'vibe-1',
            name: 'Vibe 1',
            encoding: hugeEncoding,
            encodingPath: '/files/yuzuki-phone-nai-vibe-hash.bin',
            encodingHash: 'hash',
            encodingModel: 'nai-diffusion-4-5-full',
            encodingVariant: 'v4-5full',
            strength: 0.36,
            informationExtracted: 0.7
        }]
    }]);

    const serialized = JSON.stringify(groups);
    assert.equal(groups[0].items[0].encodingPath, '/files/yuzuki-phone-nai-vibe-hash.bin');
    assert.equal(Object.hasOwn(groups[0].items[0], 'encoding'), false);
    assert.equal(serialized.includes(hugeEncoding), false);
});

test('Vibe encoding upload stores binary data through the server files API', async () => {
    const app = Object.create(SettingsApp.prototype);
    app.imageManager = {
        _buildRequestHeaders: async () => ({ 'X-CSRF-Token': 'test-token', 'Content-Type': 'application/json' })
    };
    const encoding = Buffer.from([1, 2, 3, 4, 5, 6]).toString('base64');
    const oldWindow = globalThis.window;
    let request = null;
    globalThis.window = {
        VirtualPhoneRawFetch: async (url, options) => {
            request = { url, options };
            return {
                ok: true,
                text: async () => JSON.stringify({ path: '/files/yuzuki-phone-nai-vibe-test.bin' })
            };
        }
    };
    try {
        const result = await app._uploadNovelAIVibeEncoding(encoding);
        assert.equal(request.url, '/api/files/upload');
        assert.equal(request.options.headers['X-ST-Phone-Internal-API'], '1');
        assert.equal(JSON.parse(request.options.body).data, encoding);
        assert.equal(result.encodingPath, '/files/yuzuki-phone-nai-vibe-test.bin');
        assert.ok(result.encodingHash);
    } finally {
        globalThis.window = oldWindow;
    }
});
