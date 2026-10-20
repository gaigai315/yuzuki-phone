import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const updateLog = JSON.parse(fs.readFileSync(new URL('../update-log.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('current version publishes the 1.6.4 update notices', () => {
    const current = updateLog.versions[manifest.version];

    assert.equal(manifest.version, '1.6.4');
    assert.match(indexSource, /const ST_PHONE_VERSION = '1\.6\.4';/);
    assert.deepEqual(Object.keys(updateLog.versions), ['1.6.4']);
    assert.equal(current.date, '2026-10-21');
    assert.deepEqual(current.items, [
        '【正文生图·新增】支持注入微信联系人及用户的专属 Tags：用户可设置真实姓名，提示词中的对应姓名变量会在生图前自动替换为固定形象 Tags，适用于 NovelAI、ComfyUI、GPT 等生图模型。',
        '【正文生图·优化】优化 NAI V4.5/V5 多角色提示词与坐标解析，V4.5 自动吸附最近网格点、V5 原样发送；新增多套提示词预设、手动生成 Tags 后自动生图开关及预览下载。当前内置 NovelAI V4.5/V5 预设，其他模型可按需新增自定义预设。',
        '【正文生图·修复】修复设置页折叠面板偶发无法展开；世界书列表改为展开后按需读取并复用缓存，减少重复请求与控制台日志。',
        '【微信·优化】智能加载联系人新增独立 system 破限词与填写规则，联系人支持昵称、备注、真实姓名/别名和性别；备注优先显示，并兼容新旧 AI 输出格式。',
        '【微信·优化】聊天记录超过 50 条时默认折叠更早消息，可按每批 50 条展开；快捷回复联系人优先按会话列表排序，其余好友按通讯录顺序排列。',
        '【世界书·新增】APP 内世界书支持按条目名称或正文内容搜索，并可全选当前筛选结果。',
        '【NAI Vibe·新增】支持导入 Vibe 分组 JSON 与官方 .naiv4vibebundle.json，导入后的编码可直接用于对应模型生图。',
        '【相册·优化】优化大量媒体的加载性能：优先使用媒体索引，图片按需懒加载并分批显示，避免进入相册时一次读取全部媒体和微信聊天记录。',
        '【相册·新增】选择模式支持批量下载图片和视频，可全选或部分选择后保存到本地。'
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
    assert.match(block, /date: '2026-10-21'/);
    for (const item of updateLog.versions[manifest.version].items) {
        assert.ok(block.includes(item), 'fallback should include each current announcement item');
    }
});
