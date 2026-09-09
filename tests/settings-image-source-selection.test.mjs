import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const pickerSource = fs.readFileSync(new URL('../apps/album/album-image-picker.js', import.meta.url), 'utf8');
const pickerModuleUrl = `data:text/javascript;base64,${Buffer.from(pickerSource).toString('base64')}`;
const { AlbumImagePicker } = await import(pickerModuleUrl);
const settingsSource = fs.readFileSync(new URL('../apps/settings/settings-app.js', import.meta.url), 'utf8');

function renderWithPicker(method, options) {
    const albumData = {
        getImages: () => [{
            path: '/backgrounds/phone_test.png',
            src: '/backgrounds/phone_test.png',
            filename: 'phone_test.png',
            sourceKey: 'local-upload'
        }],
        groupImagesBySource: images => [{
            key: 'local-upload',
            label: '本地上传',
            icon: 'fa-cloud-arrow-up',
            images
        }],
        getSourceDefinition: () => ({ label: '本地上传' })
    };
    const picker = new AlbumImagePicker(albumData);
    const overlay = {
        className: '',
        innerHTML: '',
        addEventListener: () => {},
        querySelector: () => null,
        onclick: null
    };
    picker.loadCSS = () => {};
    picker._open = (render) => {
        render(overlay);
        return Promise.resolve(null);
    };
    return Promise.resolve(picker[method](options)).then(() => overlay.innerHTML);
}

test('album picker supports generic source and image titles while keeping avatar defaults', async () => {
    const sourceHtml = await renderWithPicker('chooseSource', {
        title: '选择壁纸来源',
        albumLabel: '从相册 App 复用',
        deviceLabel: '从手机上传'
    });
    assert.match(sourceHtml, /选择壁纸来源/);
    assert.match(sourceHtml, /从相册 App 复用/);
    assert.match(sourceHtml, /从手机上传/);
    assert.match(sourceHtml, /data-image-source="album"/);
    assert.match(sourceHtml, /data-image-source="device"/);

    const imageHtml = await renderWithPicker('chooseImage', { title: '选择时间卡片图片' });
    assert.match(imageHtml, /album-image-picker-title">选择时间卡片图片/);

    const defaultHtml = await renderWithPicker('chooseSource');
    assert.match(defaultHtml, /选择头像来源/);
    assert.match(defaultHtml, /从相册 App 选择/);
    assert.match(defaultHtml, /从设备相册上传/);
});

test('settings wallpaper and time-card image selectors reuse album paths without deleting old files', () => {
    const start = settingsSource.indexOf("const getActiveSettingsRoot =");
    const end = settingsSource.indexOf("document.getElementById('phone-home-layout')", start);
    assert.ok(start >= 0 && end > start, 'image source selection block should exist');
    const block = settingsSource.slice(start, end);

    assert.match(block, /chooseSource\(\{ title: '选择壁纸来源' \}\)/);
    assert.match(block, /picker\.albumData\?\.getImages\?\.\(\)/);
    assert.match(block, /chooseImage\(\{ title: '选择壁纸' \}\)/);
    assert.match(block, /applyWallpaperPath\(image\.path/);
    assert.match(block, /chooseSource\(\{ title: '选择时间卡片图片来源' \}\)/);
    assert.match(block, /chooseImage\(\{ title: '选择时间卡片图片' \}\)/);
    assert.match(block, /applyCardTimeImagePath\(image\.path/);
    assert.doesNotMatch(block, /deleteManagedBackgroundByPath|deleteWallpaper\(/);
    assert.match(block, /原图仍保留在相册 App/);
});
