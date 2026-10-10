import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const updateLog = JSON.parse(fs.readFileSync(new URL('../update-log.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('current version keeps all notices under the latest date', () => {
    const current = updateLog.versions[manifest.version];

    assert.equal(manifest.version, '1.6.0.1');
    assert.equal(current.date, '2026-10-11');
    assert.equal(current.items.length, 3);
    assert.deepEqual(current.items.map(item => item.match(/^【([^】]+)】/)?.[1]), ['修复', '修复', '修复']);
    assert.match(current.items[0], /X 发布页/);
    assert.match(current.items[0], /重复绑定点击事件/);
    assert.match(current.items[0], /多条重复帖子/);
    assert.match(current.items[0], /每条都会触发 AI 围观/);
    assert.match(current.items[0], /防重复提交保护/);
    assert.match(current.items[1], /键盘弹起时小手机未及时缩小/);
    assert.match(current.items[1], /收起后尺寸不恢复/);
    assert.match(current.items[1], /视口状态复查/);
    assert.match(current.items[1], /长楼层下的布局卡顿/);
    assert.match(current.items[2], /交互前端/);
    assert.match(current.items[2], /收到新消息后失效/);
    assert.match(current.items[2], /保留前端 DOM/);
    assert.match(current.items[2], /事件监听/);
    assert.match(current.items[2], /整层消息重绘/);
    assert.equal(current.updates, undefined);
});

test('local update announcements are acknowledged by version and date', () => {
    assert.match(indexSource, /function normalizeUpdateLogEntry\(version, entry\)/);
    assert.match(indexSource, /phone-update-announcement-seen-release/);
    assert.match(indexSource, /const announcementId = `\$\{ST_PHONE_VERSION\}@\$\{String\(notes\?\.date/);
    assert.match(indexSource, /rememberValue: announcementId/);
    assert.match(indexSource, /options\.rememberValue \|\| version/);
});

test('fallback announcement preserves the 1.6.0.1 notice', () => {
    const start = indexSource.indexOf('const ST_PHONE_CURRENT_UPDATE =');
    const end = indexSource.indexOf('\n};', start);
    assert.ok(start >= 0 && end > start, 'fallback update block should exist');

    const block = indexSource.slice(start, end);
    assert.match(block, /date: '2026-10-11'/);
    assert.match(block, /X 发布页/);
    assert.match(block, /重复绑定点击事件/);
    assert.match(block, /多条重复帖子/);
    assert.match(block, /每条都会触发 AI 围观/);
    assert.match(block, /防重复提交保护/);
    assert.match(block, /键盘弹起时小手机未及时缩小/);
    assert.match(block, /收起后尺寸不恢复/);
    assert.match(block, /视口状态复查/);
    assert.match(block, /长楼层下的布局卡顿/);
    assert.match(block, /交互前端/);
    assert.match(block, /收到新消息后失效/);
    assert.match(block, /保留前端 DOM/);
    assert.match(block, /事件监听/);
    assert.match(block, /整层消息重绘/);
});
