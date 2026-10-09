import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const updateLog = JSON.parse(fs.readFileSync(new URL('../update-log.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('current version keeps all notices under the latest date', () => {
    const current = updateLog.versions[manifest.version];

    assert.equal(manifest.version, '1.6.0');
    assert.equal(current.date, '2026-10-09');
    assert.equal(current.items.length, 8);
    assert.match(current.items[0], /酒馆二改 APP/);
    assert.match(current.items[0], /小手机线上消息无法注入正文/);
    assert.match(current.items[1], /悬浮图标打开手机/);
    assert.match(current.items[1], /隐藏状态尺寸测量、重复定位与缩放动画/);
    assert.match(current.items[1], /快速闪缩抖动/);
    assert.match(current.items[2], /微信线下模式/);
    assert.match(current.items[2], /微信昵称与微信零钱余额变量注入/);
    assert.match(current.items[2], /线上支付标签/);
    assert.match(current.items[2], /扣减微信零钱并记录购物流水/);
    assert.match(current.items[2], /重复解析防重及酒馆楼层回档/);
    assert.match(current.items[3], /优化 API 请求流式解析/);
    assert.match(current.items[4], /优化魔坊APP渲染逻辑/);
    assert.match(current.items[5], /直接删除酒馆楼层时会同步回滚/);
    assert.match(current.items[5], /AI 联系人发布的朋友圈也支持单独删除/);
    assert.match(current.items[6], /X、微博、微信、蜜语与日记/);
    assert.match(current.items[6], /身份 TAG 含括号时不再被提前截断/);
    assert.match(current.items[6], /完整保留后续提示词/);
    assert.match(current.items[7], /首次点击小手机快捷回复按钮/);
    assert.match(current.items[7], /仅收起键盘而未打开面板/);
    assert.equal(current.updates, undefined);
});

test('local update announcements are acknowledged by version and date', () => {
    assert.match(indexSource, /function normalizeUpdateLogEntry\(version, entry\)/);
    assert.match(indexSource, /phone-update-announcement-seen-release/);
    assert.match(indexSource, /const announcementId = `\$\{ST_PHONE_VERSION\}@\$\{String\(notes\?\.date/);
    assert.match(indexSource, /rememberValue: announcementId/);
    assert.match(indexSource, /options\.rememberValue \|\| version/);
});

test('fallback announcement preserves the 1.6.0 notices', () => {
    const start = indexSource.indexOf('const ST_PHONE_CURRENT_UPDATE =');
    const end = indexSource.indexOf('\n};', start);
    assert.ok(start >= 0 && end > start, 'fallback update block should exist');

    const block = indexSource.slice(start, end);
    assert.match(block, /date: '2026-10-09'/);
    assert.match(block, /酒馆二改 APP/);
    assert.match(block, /小手机线上消息无法注入正文/);
    assert.match(block, /悬浮图标打开手机/);
    assert.match(block, /隐藏状态尺寸测量、重复定位与缩放动画/);
    assert.match(block, /快速闪缩抖动/);
    assert.match(block, /微信线下模式/);
    assert.match(block, /微信昵称与微信零钱余额变量注入/);
    assert.match(block, /线上支付标签/);
    assert.match(block, /扣减微信零钱并记录购物流水/);
    assert.match(block, /重复解析防重及酒馆楼层回档/);
    assert.match(block, /优化 API 请求流式解析/);
    assert.match(block, /优化魔坊APP渲染逻辑/);
    assert.match(block, /直接删除酒馆楼层时会同步回滚/);
    assert.match(block, /AI 联系人发布的朋友圈也支持单独删除/);
    assert.match(block, /X、微博、微信、蜜语与日记/);
    assert.match(block, /身份 TAG 含括号时不再被提前截断/);
    assert.match(block, /完整保留后续提示词/);
});
