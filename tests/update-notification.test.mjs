import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const updateLog = JSON.parse(fs.readFileSync(new URL('../update-log.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('current version keeps all notices under the latest date', () => {
    const current = updateLog.versions[manifest.version];

    assert.equal(manifest.version, '1.5.9');
    assert.equal(current.date, '2026-10-03');
    assert.equal(current.items.length, 6);
    assert.match(current.items[0], /蜜语保存的主题视频失效/);
    assert.match(current.items[1], /微信语音条/);
    assert.match(current.items[2], /当前好友的朋友圈历史记录/);
    assert.match(current.items[3], /新增 X APP/);
    assert.match(current.items[4], /设置入口划分为相册 APP/);
    assert.match(current.items[5], /优化电脑端手机关闭逻辑/);
    assert.equal(current.updates, undefined);
});

test('local update announcements are acknowledged by version and date', () => {
    assert.match(indexSource, /function normalizeUpdateLogEntry\(version, entry\)/);
    assert.match(indexSource, /phone-update-announcement-seen-release/);
    assert.match(indexSource, /const announcementId = `\$\{ST_PHONE_VERSION\}@\$\{String\(notes\?\.date/);
    assert.match(indexSource, /rememberValue: announcementId/);
    assert.match(indexSource, /options\.rememberValue \|\| version/);
});

test('fallback announcement preserves all 1.5.9 notices', () => {
    const start = indexSource.indexOf('const ST_PHONE_CURRENT_UPDATE =');
    const end = indexSource.indexOf('\n};', start);
    assert.ok(start >= 0 && end > start, 'fallback update block should exist');

    const block = indexSource.slice(start, end);
    assert.match(block, /date: '2026-10-03'/);
    assert.match(block, /蜜语保存的主题视频失效/);
    assert.match(block, /优化电脑端手机关闭逻辑/);
    assert.match(block, /单击机身外部即可关闭/);
    assert.match(block, /三击打开方式保持不变/);
    assert.doesNotMatch(block, /正文生图设置入口位于相册 APP 内/);
    assert.match(block, /微信语音条发送后/);
    assert.match(block, /当前好友的朋友圈历史记录/);
    assert.match(block, /新增 X APP/);
    assert.match(block, /设置入口划分为相册 APP/);
});
