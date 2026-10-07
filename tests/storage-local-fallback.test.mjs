import assert from 'node:assert/strict';
import test from 'node:test';

import { PhoneStorage } from '../config/storage.js';

test('album bookkeeping stays in extension settings without filling localStorage', async () => {
    const originalLocalStorage = globalThis.localStorage;
    const writes = [];
    const extensionSettings = {};
    globalThis.localStorage = {
        removeItem() {},
        setItem(key, value) {
            writes.push([key, value]);
        }
    };

    try {
        const storage = new PhoneStorage();
        storage._getExtensionSettingsStore = () => extensionSettings;
        storage._queuedSaveExtensionSettings = () => {};

        await storage.set('phone_album_upload_index', '[{"path":"/backgrounds/test.png"}]');
        await storage.set('phone_album_deleted_paths', '["/backgrounds/deleted.png"]');
        await storage.set('phone-image-provider', 'novelai');

        assert.equal(extensionSettings.phone_album_upload_index, '[{"path":"/backgrounds/test.png"}]');
        assert.equal(extensionSettings.phone_album_deleted_paths, '["/backgrounds/deleted.png"]');
        assert.equal(extensionSettings['phone-image-provider'], 'novelai');
        assert.deepEqual(writes, [['virtual_phone_global_phone-image-provider', 'novelai']]);
    } finally {
        globalThis.localStorage = originalLocalStorage;
    }
});
