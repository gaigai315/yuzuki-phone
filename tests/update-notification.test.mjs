import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const updateLog = JSON.parse(fs.readFileSync(new URL('../update-log.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('version 1.7.2 includes only the current payment announcement', () => {
    assert.equal(manifest.version, '1.7.2');
    assert.ok(indexSource.includes("const ST_PHONE_VERSION = '1.7.2';"));
    assert.deepEqual(updateLog.versions, {
        '1.7.2': { date: '2026-11-26', items: ['【优化】正文同步到微信时，金额相同的红包和转账会逐笔保留，同一条消息重复解析时只记录一次。'] }
    });
    assert.match(indexSource, /if \(!notes\?\.items\?\.length\) return false;/);
});

test('local update announcements are acknowledged by version and date', () => {
    assert.match(indexSource, /function normalizeUpdateLogEntry\(version, entry\)/);
    assert.match(indexSource, /phone-update-announcement-seen-release/);
    assert.match(indexSource, /const announcementId = `\$\{ST_PHONE_VERSION\}@\$\{String\(notes\?\.date/);
    assert.match(indexSource, /rememberValue: announcementId/);
    assert.match(indexSource, /options\.rememberValue \|\| version/);
});

test('fallback announcement matches the current update log', () => {
    const block = indexSource.match(/const ST_PHONE_CURRENT_UPDATE = \{\s*version: ST_PHONE_VERSION,\s*date: '([^']*)',\s*items: (\[[\s\S]*?\])\s*\};/);
    assert.ok(block);
    assert.deepEqual({ date: block[1], items: JSON.parse(block[2]) }, updateLog.versions[manifest.version]);
});
