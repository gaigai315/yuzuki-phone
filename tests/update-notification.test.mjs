import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const updateLog = JSON.parse(fs.readFileSync(new URL('../update-log.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('current version preserves the 1.7.0 notices and includes the settings upload fix', () => {
    const current = updateLog.versions[manifest.version];
    assert.equal(manifest.version, '1.7.0');
    assert.ok(indexSource.includes("const ST_PHONE_VERSION = '1.7.0';"));
    assert.deepEqual(Object.keys(updateLog.versions), ['1.7.0']);
    assert.equal(current.date, '2026-11-18');
    assert.deepEqual(current.items, [
        '【优化】音乐卡片支持独立设置字体颜色，默认黑色，字体继续跟随酒馆。',
        '【优化】表情管理面板扩大，表情下方显示名字，点击名字即可修改。',
        '【新增】char 可根据用户提供的图片，自行决定是否更换头像。',
        '【新增】支持线上或线下好友邀请用户加入群聊。',
        '【修复】上传 App 图标后保留设置页的滚动位置和展开状态，不再意外返回手机桌面。'
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
    assert.ok(block.includes(`date: '${updateLog.versions[manifest.version].date}'`));
    for (const item of updateLog.versions[manifest.version].items) {
        assert.ok(block.includes(item), 'fallback should include each current announcement item');
    }
});
