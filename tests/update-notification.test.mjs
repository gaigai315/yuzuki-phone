import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const updateLog = JSON.parse(fs.readFileSync(new URL('../update-log.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('current version publishes the 1.6.5 update notices', () => {
    const current = updateLog.versions[manifest.version];

    assert.equal(manifest.version, '1.6.5');
    assert.match(indexSource, /const ST_PHONE_VERSION = '1\.6\.5';/);
    assert.deepEqual(Object.keys(updateLog.versions), ['1.6.5']);
    assert.equal(current.date, '2026-10-27');
    assert.deepEqual(current.items, [
        '【新增】NovelAI V5 Full 支持 Anime/Furry 模式与 Medium/High Effort；Medium 会自动使用官方节约模型并锁定兼容参数。',
        '【新增】正文生图支持手动填写 Tags，并可在预览正反面快速切换画风预设。',
        '【新增】微信支持设置线下提示词好友可见范围，可提前隐藏指定好友并在重开后保留设置。',
        '【优化】优化背景图片上传逻辑，完整保留竖图上下内容，修复微博等背景上传时被强制裁剪的问题。',
        '【优化】优化正文生图功能。',
        '【修复】修复微信个人图片可能因联系人昵称与真实姓名不一致，未使用最新固定形象 Tags 的问题。',
        '【修复】修复各 App 世界书设置可能跨角色串选的问题；现在按角色卡与 App 分别保存，并在同角色卡的不同聊天和用户 Persona 间保持一致。'
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
    assert.match(block, /date: '2026-10-27'/);
    for (const item of updateLog.versions[manifest.version].items) {
        assert.ok(block.includes(item), 'fallback should include each current announcement item');
    }
});
