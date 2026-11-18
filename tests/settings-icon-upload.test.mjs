import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../apps/settings/settings-app.js', import.meta.url), 'utf8');
const start = source.indexOf("        document.querySelectorAll('.app-icon-upload').forEach(input => {");
const end = source.indexOf("        document.getElementById('app-icon-set-selector')", start);
assert.ok(start >= 0 && end > start);
const bindUpload = new Function('document', 'window', 'ImageCropper', 'CustomEvent',
    'alert', 'SETTINGS_IMAGE_MAX_FILE_SIZE', 'formatImageUploadError', source.slice(start, end));

function setup() {
    const preview = { isConnected: true, textContent: '💬', style: {} };
    const page = { scrollTop: 960, foldOpen: true, draft: '未保存的设置' };
    const listeners = {};
    const input = {
        id: 'upload-icon-wechat', value: 'chosen.png', files: [{ type: 'image/png' }],
        addEventListener: (type, fn) => { listeners[type] = fn; },
        closest: () => ({ querySelector: () => preview })
    };
    const saved = [];
    const events = [];
    const alerts = [];
    let finishUpload;
    const upload = new Promise(resolve => { finishUpload = resolve; });
    const app = {
        imageManager: {
            cache: { appIcons: {} },
            getAppIcon: () => '/backgrounds/old.png',
            deleteManagedBackgroundByPath: async () => {},
            _uploadToServer: () => upload,
            saveImages: async data => { saved.push(structuredClone(data)); }
        },
        render: () => { throw new Error('上传不得重建设置页'); }
    };
    bindUpload.call(app,
        { querySelectorAll: () => [input] },
        { dispatchEvent: event => events.push(event) },
        class { async open() { return 'cropped-image'; } },
        class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        message => alerts.push(message), 20 * 1024 * 1024, String);
    return { preview, page, input, app, saved, events, alerts, finishUpload,
        change: () => listeners.change({ target: input }) };
}

test('upload saves the icon and updates only its preview, preserving current settings state', async () => {
    const h = setup();
    const pending = h.change();
    // 用户在上传期间继续滚动，完成后也应保留新的位置。
    h.page.scrollTop = 1120;
    h.finishUpload('/backgrounds/new.png');
    await pending;
    assert.deepEqual(h.page, { scrollTop: 1120, foldOpen: true, draft: '未保存的设置' });
    assert.equal(h.input.value, '');
    assert.equal(h.preview.textContent, '');
    assert.equal(h.preview.style.backgroundImage, 'url("/backgrounds/new.png")');
    assert.equal(h.saved[0].appIcons.wechat, '/backgrounds/new.png');
    assert.deepEqual(h.events[0].detail, { appId: 'wechat', icon: '/backgrounds/new.png' });
    assert.deepEqual(h.alerts, ['✅ 图标上传成功！']);

    // 原上传按钮仍可继续使用，无需重建或重绑事件。
    await h.change();
    assert.equal(h.saved.length, 2);
});

test('finishing an upload after leaving settings does not reopen the page or touch detached previews', async () => {
    const h = setup();
    const pending = h.change();
    h.preview.isConnected = false;
    h.finishUpload('/backgrounds/new.png');
    await pending;
    assert.equal(h.saved.length, 1);
    assert.equal(h.preview.textContent, '💬');
    assert.deepEqual(h.preview.style, {});
    assert.equal(h.events[0].type, 'phone:updateAppIcon');
    assert.deepEqual(h.alerts, ['✅ 图标上传成功！']);
});
