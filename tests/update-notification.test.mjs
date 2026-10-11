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
    assert.equal(current.date, '2026-10-11');
    assert.deepEqual(current.items, [
        '【修复】线上支付小票仅在存在完整闭合标签时渲染，支付时间支持 1 至 6 位年份；缺失结束标签或内容无效时不再猜测边界。',
        '【修复】线上支付清理只处理支付协议本身，不再误改后续 MUV、任务进度、Status_block 或其他酒馆前端 DOM。',
        '【修复】修复酒馆助手偶发漏过角色卡开场 HTML 前端首屏渲染的问题；无需点击小铅笔即可正常加载。'
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
    assert.match(block, /date: '2026-10-11'/);
    assert.match(block, /支付时间支持 1 至 6 位年份/);
    assert.match(block, /MUV、任务进度、Status_block/);
    assert.match(block, /无需点击小铅笔即可正常加载/);
});
