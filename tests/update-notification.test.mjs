import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const updateLog = JSON.parse(fs.readFileSync(new URL('../update-log.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('current version publishes the payment and Tavern frontend hotfix notice', () => {
    const current = updateLog.versions[manifest.version];

    assert.equal(manifest.version, '1.6.1.1');
    assert.deepEqual(Object.keys(updateLog.versions), ['1.6.1.1', '1.6.1']);
    assert.equal(current.date, '2026-10-12');
    assert.deepEqual(current.items, [
        '【修复】修复支付小票渲染及其影响正文渲染、角色卡开场前端偶发加载异常的问题。',
        '【优化】优化线上微信的时间推进。',
        '【优化】优化部分渲染问题。',
        '【优化】优化 API 路由，新增 X 和正文生图 TAG 请求的独立 API 配置。'
    ]);
    assert.equal(current.updates, undefined);
    assert.match(updateLog.versions['1.6.1'].items[0], /微信零钱重构功能为钱包功能/);
});

test('local update announcements are acknowledged by version and date', () => {
    assert.match(indexSource, /function normalizeUpdateLogEntry\(version, entry\)/);
    assert.match(indexSource, /phone-update-announcement-seen-release/);
    assert.match(indexSource, /const announcementId = `\$\{ST_PHONE_VERSION\}@\$\{String\(notes\?\.date/);
    assert.match(indexSource, /rememberValue: announcementId/);
    assert.match(indexSource, /options\.rememberValue \|\| version/);
});

test('fallback announcement matches the 1.6.1.1 hotfix notice', () => {
    const start = indexSource.indexOf('const ST_PHONE_CURRENT_UPDATE =');
    const end = indexSource.indexOf('\n};', start);
    assert.ok(start >= 0 && end > start, 'fallback update block should exist');

    const block = indexSource.slice(start, end);
    assert.match(block, /date: '2026-10-12'/);
    for (const item of updateLog.versions[manifest.version].items) {
        assert.ok(block.includes(item), 'fallback should include each current announcement item');
    }
});
