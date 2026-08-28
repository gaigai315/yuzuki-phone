import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../config/tag-filter.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const {
    applyPhoneTagFilter,
    filterContentByTagsLocal,
} = await import(moduleUrl);

test('local phone blacklist removes paired and closing-only thinking blocks', () => {
    assert.equal(
        filterContentByTagsLocal('<thinking>内部推理</thinking>\n剧情正文', 'thinking'),
        '剧情正文'
    );
    assert.equal(
        filterContentByTagsLocal('未闭合的内部推理\n</thinking>\n剧情正文', 'thinking'),
        '剧情正文'
    );
});

test('local phone blacklist removes opening-only suffixes without changing plain text', () => {
    assert.equal(filterContentByTagsLocal('剧情正文\n<think>未闭合的内部推理', 'think'), '剧情正文');
    assert.equal(filterContentByTagsLocal('没有标签的剧情正文', 'think'), '没有标签的剧情正文');
});

test('local phone filter supports closing-only bracket and whitelist boundaries', () => {
    assert.equal(
        filterContentByTagsLocal('内部分析\n[/analysis]\n剧情正文', '[analysis]'),
        '剧情正文'
    );
    assert.equal(filterContentByTagsLocal('<content>剧情正文', '', 'content'), '剧情正文');
    assert.equal(filterContentByTagsLocal('剧情正文</content>\n后台文本', '', 'content'), '剧情正文');
});

test('local phone blacklist preserves an earlier whitelisted block', () => {
    assert.equal(
        filterContentByTagsLocal(
            '<content>剧情正文</content>\n残余推理</thinking>\n后台文本',
            'thinking',
            'content'
        ),
        '剧情正文'
    );
});

test('phone entry point cleans closing-only tags without a memory plugin', () => {
    assert.equal(
        applyPhoneTagFilter('未闭合的内部推理\n</thinking>\n剧情正文', {
            config: {
                enabled: true,
                blacklist: 'thinking',
                whitelist: ''
            }
        }),
        '剧情正文'
    );
});
