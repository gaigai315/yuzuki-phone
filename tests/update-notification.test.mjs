import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const updateLog = JSON.parse(fs.readFileSync(new URL('../update-log.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('current version publishes only the 1.6.7 fix notices', () => {
    const current = updateLog.versions[manifest.version];

    assert.equal(manifest.version, '1.6.7');
    assert.match(indexSource, /const ST_PHONE_VERSION = '1\.6\.7';/);
    assert.deepEqual(Object.keys(updateLog.versions), ['1.6.7']);
    assert.equal(current.date, '2026-11-01');
    assert.deepEqual(current.items, [
        '【修复】适配 TT 新版文件下载接口，修复正文生图、相册预览及批量下载提示“TT 原生下载模块不可用”的问题；取消保存不再误报成功，批量下载会停止后续操作。',
        '【修复】补全 NovelAI 单个 .naiv4vibe.json 文件导入支持，保留文件中的模型、信息提取量和强度参数，并按文件名建立 Vibe 组。',
        '【修复】统一魔坊气泡模式下的面板与气泡预览，修复笺札等模板排版不一致、正文超出的问题，并保留手机适配和历史翻页。'
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
    assert.match(block, /date: '2026-11-01'/);
    for (const item of updateLog.versions[manifest.version].items) {
        assert.ok(block.includes(item), 'fallback should include each current announcement item');
    }
});
