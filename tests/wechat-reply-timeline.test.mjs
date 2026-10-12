import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatView } from '../apps/wechat/chat-view.js';
import { TimeManager } from '../config/time-manager.js';

function setup(initial = '2025年01月01日 14:00') {
    const values = new Map();
    const tm = new TimeManager({ get: key => values.get(key), set: (key, value) => values.set(key, value) });
    tm.getContext = () => ({ characterId: 0, chat: [] });
    tm.getPhoneLastMessageTime = () => null;
    tm.inferTimeFromLore = () => null;
    const base = tm.parseStatusbar(initial);
    values.set('story-current-time', JSON.stringify(base));
    const view = Object.create(ChatView.prototype);
    view._shouldUseRealTimeForOnlineChat = () => false;
    view._getWechatReplySecondsToAdd = () => 10;
    globalThis.window = { VirtualPhone: { timeManager: tm }, dispatchEvent() {} };
    globalThis.CustomEvent = class {};
    return { view, tm, values, base };
}

test('six story replies add one minute and preserve seconds across requests and reloads', () => {
    const { view, tm, values, base } = setup();
    for (let i = 0; i < 6; i++) {
        const message = { content: '这是角色这一条说的话', date: '错误的日期', time: '23:59' };
        view._applyAiReplyTimeline(message);
        assert.equal(message.timestamp, base.timestamp + (i + 1) * 10000);
        assert.equal(message.date, base.date);
        // A new request and a cleared cache must retain the remaining seconds.
        view._resetAiReplyTimeCursor();
        tm.clearCache();
        assert.equal(tm.getCurrentStoryTime().timestamp, message.timestamp);
        assert.equal(JSON.parse(values.get('story-current-time')).timestamp, message.timestamp);
    }
    assert.equal(tm.getCurrentStoryTime().time, '14:01');
});

test('second increments cross midnight and retain ancient date format', () => {
    for (const initial of ['2025年01月01日 23:59', '大明永乐十二年九月初八日 23:59']) {
        const { view, base } = setup(initial);
        view._getWechatReplySecondsToAdd = () => 20;
        let message;
        for (let i = 0; i < 3; i++) {
            message = { content: '晚安' };
            view._applyAiReplyTimeline(message);
        }
        assert.equal(message.time, '00:00');
        assert.equal(message.timestamp, base.timestamp + 60000);
        assert.equal(message.date, base.isAncient ? '大明永乐十二年九月初九日' : '2025年01月02日');
    }
});

test('reality replies use current clock even for long replies, old cursors and proactive gaps', () => {
    const { view, tm } = setup();
    view._shouldUseRealTimeForOnlineChat = () => true;
    const now = Date.now();
    const originalNow = Date.now;
    Date.now = () => now;
    tm.setTime = () => { throw new Error('reality replies must not advance story storage'); };
    try {
        view._aiReplyTimestampCursor = now + 3600000;
        view._aiReplyRequestStartedAt = now - 180000;
        for (let i = 0; i < 6; i++) {
            const message = { content: '长回复'.repeat(100), date: '错误日期' };
            view._applyAiReplyTimeline(message, '', { isFirstInReplyBatch: i === 0, extraGapMinutes: 30, baseTimestamp: now - 600000 });
            assert.equal(message.timestamp, now);
            assert.equal(message.realTimestamp, now);
            assert.equal(message.date, view._buildWechatRealTimeFields(now).date);
        }
    } finally { Date.now = originalNow; }
});

test('story first reply accounts for a long API wait once, then uses seconds', () => {
    const { view, base } = setup();
    view._aiReplyRequestStartedAt = Date.now() - 120000;
    const first = { content: '好' };
    view._applyAiReplyTimeline(first, '', { isFirstInReplyBatch: true });
    assert.equal(first.forceTimeDivider, true);
    assert.ok(first.timestamp >= base.timestamp + 120000);
    const second = { content: '等你' };
    view._applyAiReplyTimeline(second);
    assert.equal(second.timestamp - first.timestamp, 10000);
});

test('reply simulation is bounded to seconds regardless of text length', () => {
    const view = Object.create(ChatView.prototype);
    for (const length of [0, 1, 6, 14, 30, 60, 1000]) {
        for (let i = 0; i < 20; i++) {
            const seconds = view._getWechatReplySecondsToAdd('字'.repeat(length));
            assert.ok(seconds >= 4 && seconds <= 20);
        }
    }
});

test('actual phone messages retain seconds and cannot pull midnight back to yesterday', () => {
    const { view, tm, base } = setup('2025年01月01日 23:59');
    const messages = [{ ...base, timestamp: base.timestamp + 50000 }];
    window.VirtualPhone.wechatApp = { wechatData: {
        getChatList: () => [{ id: 'chat' }], getMessages: () => messages
    } };
    tm.getPhoneLastMessageTime = TimeManager.prototype.getPhoneLastMessageTime;
    tm.clearCache();
    assert.equal(tm.getCurrentStoryTime().timestamp, base.timestamp + 50000);
    const reply = { content: '晚安' };
    view._applyAiReplyTimeline(reply);
    assert.equal(reply.time, '00:00');
    assert.equal(reply.date, '2025年01月02日');
    tm.clearCache();
    assert.equal(tm.getCurrentStoryTime().timestamp, base.timestamp + 60000);
});
