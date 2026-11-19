import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

function createParser({ userName = '宋清秋' } = {}) {
    const start = indexSource.indexOf('function parseLightweightWechatTag(text) {');
    const end = indexSource.indexOf('// 🔧 辅助函数：解析消息类型', start);
    const identity = value => value;
    const env = {
        isPhoneFeatureEnabled: () => true,
        maskPhoneParserReasoningBlocks: identity,
        decodePhoneTagBoundaryEntities: identity,
        window: { VirtualPhone: {} },
        timeManager: null,
        extractWechatStoryTimeFallback: () => ({ date: '117年12月07日' }),
        WECHAT_EMPTY_REGEX: /<wechat>\s*<\/wechat>/g,
        WECHAT_TAG_REGEX_SINGLE: /<wechat>([\s\S]*?)<\/wechat>/,
        WECHAT_TAG_REGEX_NEW: /<wechat>([\s\S]*?)<\/wechat>/g,
        extractWechatTagPayload: value => value.replace(/^<wechat>/, '').replace(/<\/wechat>$/, '').replace(/<!--|-->/g, ''),
        stripWechatCommentWrapper: identity,
        tokenizeWechatFiles: text => ({ text, tokenMap: new Map() }),
        tokenizeWangxiangTaskTags: text => ({ text, tokenMap: new Map() }),
        normalizeWechatGroupSpeakerName: identity,
        isWechatRecipientAllowed: name => name === userName,
        isWechatSenderCurrentUser: name => name === userName || name === 'me',
        normalizeWechatDateText: identity,
        getWechatKnownGroupByName: name => name === '工作群' ? { members: ['群友C'] } : null,
        normalizeWechatRecipientOrFallback: identity,
        parseWechatDateTimeLine: () => ({}),
        parseMessageType: () => {}
    };
    return Function(...Object.keys(env), `${indexSource.slice(start, end)}; return parseLightweightWechatTag;`)(...Object.values(env));
}

test('single chat keeps clock-like text at the start of message content', () => {
    const parse = createParser();
    const [chat] = parse(`<wechat><!--
---裴照---
接收人：宋清秋
date:117年12月07日
[15:43] 原定于今日14:00的内卫理论线上课程，因你午间处于深层睡眠恢复期，总指挥长已批准顺延至明日14:00进行，本次不记入违纪缺勤。
[15:44] 今日傍晚17:30的晚餐已调整为蜜汁烤排骨、虾仁跑蛋与红糖发糕。
--></wechat>`);

    assert.deepEqual(chat.messages.map(message => message.content), [
        '原定于今日14:00的内卫理论线上课程，因你午间处于深层睡眠恢复期，总指挥长已批准顺延至明日14:00进行，本次不记入违纪缺勤。',
        '今日傍晚17:30的晚餐已调整为蜜汁烤排骨、虾仁跑蛋与红糖发糕。'
    ]);
    assert.deepEqual(chat.messages.map(message => message.sender), ['裴照', '裴照']);
});

test('group chat still extracts the explicit sender prefix', () => {
    const parse = createParser();
    const [chat] = parse(`<wechat><!--
---工作群---
接收人：宋清秋
type:group
date:117年12月07日
[15:45] 群友C: 今日14:00的课程改期。
--></wechat>`);

    assert.equal(chat.messages[0].sender, '群友C');
    assert.equal(chat.messages[0].content, '今日14:00的课程改期。');
});


for (const timePrefix of ['', '[14:38] ']) {
    test(`user group message keeps the full colon-containing sentence (${timePrefix || 'no timestamp'})`, () => {
        const parse = createParser({ userName: '月见里' });
        const sentence = '月见里最讨厌之人：陈纪迟、许清让、沈涟、秦限！';
        const [block] = parse(`<wechat><!--
---月见里---
接收人：成人读书会
type:group
date:2018年10月02日14:38
${timePrefix}${sentence}
--></wechat>`);
        assert.equal(block.contact, '成人读书会');
        assert.equal(block.chatType, 'group');
        assert.equal(block.messages[0].sender, 'me');
        assert.equal(block.messages[0].content, sentence);
    });
}
