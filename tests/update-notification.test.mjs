import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const updateLog = JSON.parse(fs.readFileSync(new URL('../update-log.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('current version publishes the 1.6.8 update notices', () => {
    const current = updateLog.versions[manifest.version];
    assert.equal(manifest.version, '1.6.8');
    assert.ok(indexSource.includes("const ST_PHONE_VERSION = '1.6.8';"));
    assert.deepEqual(Object.keys(updateLog.versions), ['1.6.8']);
    assert.equal(current.date, '2026-11-08');
    assert.deepEqual(current.items, [
        '【优化】日记会等待 CSS 与封面背景加载完成后再渲染，减少首次打开时的样式闪烁、布局错位和封面背景缺失，并优化目录与写日记按钮布局。',
        '【优化】Fish Audio 支持公益站及兼容 TT 酒馆。'
    ]);
    assert.equal(current.updates, undefined);
});

test('local update announcements are acknowledged by version and date', () => {
    assert.match(indexSource, /function normalizeUpdateLogEntry\(version, entry\)/);
    assert.match(indexSource, /phone-update-announcement-seen-release/);
    assert.match(indexSource, /const announcementId = `\$\{ST_PHONE_VERSION\}@\$\{String\(notes\?\.date/);
    assert.match(indexSource, /rememberValue: announcementId/);
    assert.match(indexSource, /options\.rememberValue \|\| version/);
});

test('fallback announcement matches the current update log', () => {
    const start = indexSource.indexOf('const ST_PHONE_CURRENT_UPDATE =');
    const end = indexSource.indexOf('\n};', start);
    assert.ok(start >= 0 && end > start, 'fallback update block should exist');

    const block = indexSource.slice(start, end);
    assert.match(block, /date: '2026-11-08'/);
    for (const item of updateLog.versions[manifest.version].items) {
        assert.ok(block.includes(item), 'fallback should include each current announcement item');
    }
});
