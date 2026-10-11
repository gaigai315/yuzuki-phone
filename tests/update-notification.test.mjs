import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const updateLog = JSON.parse(fs.readFileSync(new URL('../update-log.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('current version keeps only the wallet reconstruction notice', () => {
    const current = updateLog.versions[manifest.version];

    assert.equal(manifest.version, '1.6.1');
    assert.deepEqual(Object.keys(updateLog.versions), ['1.6.1']);
    assert.equal(current.date, '2026-10-11');
    assert.deepEqual(current.items, [
        '【新增】微信零钱重构功能为钱包功能，涵盖微信零钱/银行卡/借贷功能。'
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

test('fallback announcement preserves the 1.6.1 wallet notice', () => {
    const start = indexSource.indexOf('const ST_PHONE_CURRENT_UPDATE =');
    const end = indexSource.indexOf('\n};', start);
    assert.ok(start >= 0 && end > start, 'fallback update block should exist');

    const block = indexSource.slice(start, end);
    assert.match(block, /date: '2026-10-11'/);
    assert.match(block, /微信零钱重构功能为钱包功能/);
    assert.match(block, /微信零钱\/银行卡\/借贷功能/);
});
