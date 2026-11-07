import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const updateLog = JSON.parse(fs.readFileSync(new URL('../update-log.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('current version publishes the 1.6.7 update notices', () => {
    const current = updateLog.versions[manifest.version];

    assert.equal(manifest.version, '1.6.7');
    assert.match(indexSource, /const ST_PHONE_VERSION = '1\.6\.7';/);
    assert.deepEqual(Object.keys(updateLog.versions), ['1.6.7']);
    assert.equal(current.date, '2026-11-08');
    assert.deepEqual(current.items, [
        '【修复】兼容 TT“开始新的聊天”确认流程，修复从旧聊天开始新聊天时微信等手机数据未继承的问题，并保留取消操作与跨角色隔离保护。',
        '【修复】微信用户头像优先读取酒馆当前 Persona，兼容旧存档无效头像与移动端资源路径；保留手动上传头像，图片加载失败时自动回退且不删除原存档。',
        '【新增】正文生图生成 Tags 时支持点击“停止生成 Tags”中断请求；中断后的结果不会保存，也不会继续自动生成图片。',
        '【优化】日记新增独立纸张色与墨水色设置，提示词面板、照片背面及照片显影状态会同步主题配色，并优化阅读与长图导出的样式表现。',
        '【新增】微信转发聊天记录功能。',
        '【新增】微信文件发送功能，支持填写标题与文字内容、点击文件卡片查看全文，并同步支持线上及正文中的角色文件消息。',
        '【修复】适配 TT 新版文件下载接口，修复正文生图、相册预览及批量下载提示“TT 原生下载模块不可用”的问题；取消保存不再误报成功，批量下载会停止后续操作。',
        '【修复】补全 NovelAI 单个 .naiv4vibe.json 文件导入支持，保留文件中的模型、信息提取量和强度参数，并按文件名建立 Vibe 组。',
        '【修复】统一魔坊气泡模式下的面板与气泡预览，修复笺札等模板排版不一致、正文超出的问题，并保留手机适配和历史翻页。',
        '【修复】补全两份微信默认线下提示词中好友申请的结束标签，确保标准好友申请格式可正确解析，支持连续多条申请及申请理由留空。',
        '【优化】微信联系人真实姓名与当前角色卡完整名字严格一致时，默认头像自动继承角色卡头像；用户自定义上传头像始终优先，部分名字或包含关系不匹配时继续使用默认头像池。',
        '【修复】修正日记新增、导入页按钮错位，避免移动端滑动列表时误触长按删除。',
        '【新增】正文生图图片操作菜单新增“果冻捏捏”，安装兼容版 Duang 果冻后可将酒馆同源图片直接交给果冻弹窗互动；未安装时入口自动隐藏。',
        '【优化】NAI 共享队列请求增加 12 秒超时、最多 3 次网络尝试与分阶段错误提示；重试时复用同一任务 ID，并在入队响应丢失时尝试清理队列任务。',
        '【优化】万象已完成任务、背包物品与信用点支持长按清理；进行中任务仍通过放弃流程处理，清理前增加二次确认，并避免已删除背包奖励被自动补回。',
        '【修复】修复微信单聊正文以“今日14:00”等时间表达开头时，被误识别为发送者前缀并截断时间前文字的问题。'
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
    assert.match(block, /date: '2026-11-08'/);
    for (const item of updateLog.versions[manifest.version].items) {
        assert.ok(block.includes(item), 'fallback should include each current announcement item');
    }
});
