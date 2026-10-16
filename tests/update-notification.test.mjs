import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const updateLog = JSON.parse(fs.readFileSync(new URL('../update-log.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('current version publishes only the Vertex Tavern compatibility notice', () => {
    const current = updateLog.versions[manifest.version];

    assert.equal(manifest.version, '1.6.3');
    assert.match(indexSource, /const ST_PHONE_VERSION = '1\.6\.3';/);
    assert.deepEqual(Object.keys(updateLog.versions), ['1.6.3']);
    assert.equal(current.date, '2026-10-16');
    assert.deepEqual(current.items, [
        '【优化】完善 Google Vertex AI 跟随酒馆的兼容性，修复关闭独立 API 后使用服务账号模式请求失败的问题。'
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

test('fallback announcement matches the 1.6.3 compatibility notice', () => {
    const start = indexSource.indexOf('const ST_PHONE_CURRENT_UPDATE =');
    const end = indexSource.indexOf('\n};', start);
    assert.ok(start >= 0 && end > start, 'fallback update block should exist');

    const block = indexSource.slice(start, end);
    assert.match(block, /date: '2026-10-16'/);
    for (const item of updateLog.versions[manifest.version].items) {
        assert.ok(block.includes(item), 'fallback should include each current announcement item');
    }
});
