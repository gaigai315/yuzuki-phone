import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { resolveOfflineWechatCallDecisions, parseOfflineWechatCallDecision } from '../apps/wechat/offline-call-decision.js';
import { ChatView } from '../apps/wechat/chat-view.js';
import { WechatData } from '../apps/wechat/wechat-data.js';
import { PromptManager } from '../config/prompt-manager.js';

const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

function scenario(status = '接听', media = 'voice', contact = '好友A', sourceIndex = 0) {
    return [
        { type: 'wechat_message', chatType: 'single', contact, sourceIndex, messages: [
            { sender: contact, type: 'text', content: '我来找你', sourceOrder: 0 },
            { sender: contact, type: 'incoming_call', callType: media, content: '[拨打微信语音]', sourceOrder: 1 },
            { sender: contact, type: 'text', content: '接电话。[内心]（怎么还不开门）', sourceOrder: 2 }
        ] },
        { type: 'wechat_message', chatType: 'single', contact, sourceIndex, messages: [
            { sender: 'me', type: 'text', content: `${media === 'voice' ? '语音' : '视频'}通话-${status}`, sourceOrder: 3 },
            { sender: 'me', type: 'text', content: status.includes('拒绝') ? '不要打扰我！' : '干什么啊？！', sourceOrder: 4 }
        ] }
    ];
}
const resolve = blocks => resolveOfflineWechatCallDecisions(blocks, { enabled: true });

for (const media of ['voice', 'video']) {
    test(`${media} accepted status creates a call record and moves user speech into the call`, () => {
        const blocks = resolve(scenario('接听', media));
        const record = blocks[0].messages[1];
        assert.equal(record.type, 'call_record');
        assert.equal(record.status, 'answered');
        assert.equal(record.sender, 'me');
        assert.equal(record.callType, media);
        assert.deepEqual(record.offlineCallUserLines, ['干什么啊？！']);
        assert.deepEqual(record.offlineCallAiLines, ['接电话。[内心]（怎么还不开门）']);
        assert.equal(record.transcript.at(-1).from, 'me');
        assert.equal(blocks[0].messages.length, 2);
        assert.equal(blocks[1].messages.length, 0);
    });
    test(`${media} rejected status creates a rejection record and keeps user speech in WeChat`, () => {
        const blocks = resolve(scenario('已拒绝', media));
        assert.equal(blocks[0].messages[1].status, 'rejected');
        assert.equal(blocks[0].messages[1].type, 'call_record');
        assert.equal(blocks[0].messages.length, 3);
        assert.deepEqual(blocks[1].messages.map(message => [message.sender, message.content]), [['me', '不要打扰我！']]);
    });
}

test('no automatic decision is inferred from prose, another contact, another tag or the wrong call type', () => {
    for (const mutate of [
        blocks => { blocks[1].messages[0].content = '我想接听语音通话'; },
        blocks => { blocks[1].contact = '好友B'; },
        blocks => { blocks[1].sourceIndex = 100; },
        blocks => { blocks[1].messages[0].content = '视频通话-接听'; },
        blocks => { blocks[1].messages.forEach(message => { message.sender = '好友A'; }); }
    ]) {
        const blocks = scenario();
        mutate(blocks);
        assert.equal(resolve(blocks)[0].messages[1].type, 'incoming_call');
    }
    const blocks = scenario();
    assert.equal(resolveOfflineWechatCallDecisions(blocks, { enabled: false }), blocks);
    assert.equal(parseOfflineWechatCallDecision('语音通话-已拒绝，但我后来又接了'), null);
    assert.equal(parseOfflineWechatCallDecision('【语音通话：已接听】').status, 'answered');
});

test('normal incoming calls and unrelated messages keep their original meaning', () => {
    const blocks = scenario();
    blocks[1].messages.shift();
    assert.equal(resolve(blocks)[0].messages[1].type, 'incoming_call');
    assert.deepEqual(resolve(blocks)[1].messages, blocks[1].messages);
});

test('accepted call bootstrap waits for the caller greeting, displays user speech, and sends once', async () => {
    const view = Object.create(ChatView.prototype);
    let html = '';
    const contact = { id: 'chat' };
    const record = { id: 'record' };
    const history = [];
    const messages = { isConnected: true, insertAdjacentHTML: (_, value) => { html += value; } };
    view._offlineCallRecord = { chatId: contact.id, recordId: record.id };
    view.app = { currentChat: contact, wechatData: { getMessages: () => [record] } };
    view._escapeHtml = text => text.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    let release;
    const greetingReady = new Promise(resolve => { release = resolve; });
    const requests = [];
    const waiting = view._resumeOfflineAcceptedCall({
        options: { offlineRecordId: record.id, initialUserLines: ['干什么啊？！<script>'] },
        contact, greetingReady, history, getMessages: () => messages, isEnded: () => false,
        send: async lines => { requests.push(lines); }
    });
    await Promise.resolve();
    assert.equal(requests.length, 0);
    history.push({ from: '好友A', text: '接电话。' });
    release();
    await waiting;
    assert.equal(requests.length, 1);
    assert.deepEqual(history, [{ from: '好友A', text: '接电话。' }, { from: 'me', text: '干什么啊？！<script>' }]);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
});

test('bootstrap cannot send after hangup, floor removal or switching chats', async () => {
    for (const state of ['hangup', 'removed', 'switch']) {
        const view = Object.create(ChatView.prototype);
        view._offlineCallRecord = { chatId: 'chat', recordId: 'record' };
        view.app = { currentChat: { id: state === 'switch' ? 'other' : 'chat' }, wechatData: { getMessages: () => state === 'removed' ? [] : [{ id: 'record' }] } };
        await view._resumeOfflineAcceptedCall({
            options: { offlineRecordId: 'record', initialUserLines: ['喂'] }, contact: { id: 'chat' },
            greetingReady: Promise.resolve(), history: [], isEnded: () => state === 'hangup',
            getMessages: () => assert.fail('must not write to a stale call'), send: () => assert.fail('must not request a reply')
        });
    }
});

test('hangup updates the original floor-linked call record and does not recreate a rolled back record', () => {
    const view = Object.create(ChatView.prototype);
    const messages = [{ id: 'call', fromMainChatTag: true, tavernMessageIndex: 3, batchId: 'batch' }];
    let adds = 0;
    view.app = { currentChat: { id: 'chat' }, wechatData: {
        getMessages: () => messages,
        updateMessageById: (_chat, id, patch) => Object.assign(messages.find(message => message.id === id), patch),
        addMessage: () => { adds++; }
    } };
    view._resolveCallEndStoryTime = () => ({ time: '12:01', date: '2026年11月19日' });
    view.addCallRecord('voice', 'answered', '0分10秒', { offlineRecordId: 'call', transcript: [{ from: 'me', text: '喂' }] });
    assert.equal(adds, 0);
    assert.equal(messages[0].duration, '0分10秒');
    assert.equal(messages[0].tavernMessageIndex, 3);
    assert.equal(messages[0].batchId, 'batch');
    messages.length = 0;
    assert.equal(view.addCallRecord('voice', 'answered', '0分10秒', { offlineRecordId: 'call' }), false);
    assert.equal(adds, 0);
});


function parseStory(text) {
    const start = indexSource.indexOf('function parseLightweightWechatTag(text) {');
    const end = indexSource.indexOf('// 🔥 新增：处理手机标签数据', start);
    const identity = value => value;
    const env = {
        isPhoneFeatureEnabled: () => true, maskPhoneParserReasoningBlocks: identity,
        decodePhoneTagBoundaryEntities: identity, window: { VirtualPhone: {} }, timeManager: null,
        extractWechatStoryTimeFallback: () => ({ date: '2026年11月19日' }),
        WECHAT_EMPTY_REGEX: /<wechat>\s*<\/wechat>/g,
        WECHAT_TAG_REGEX_SINGLE: /<wechat>([\s\S]*?)<\/wechat>/,
        WECHAT_TAG_REGEX_NEW: /<wechat>([\s\S]*?)<\/wechat>/g,
        extractWechatTagPayload: value => value.replace(/^<wechat>/, '').replace(/<\/wechat>$/, '').replace(/<!--|-->/g, ''),
        stripWechatCommentWrapper: identity, tokenizeWechatFiles: text => ({ text, tokenMap: new Map() }),
        tokenizeWangxiangTaskTags: text => ({ text, tokenMap: new Map() }),
        normalizeWechatGroupSpeakerName: identity, isWechatRecipientAllowed: name => name === '测试玩家',
        isWechatSenderCurrentUser: name => ['测试玩家', 'me'].includes(name),
        normalizeWechatDateText: identity, getWechatKnownGroupByName: () => null,
        normalizeWechatRecipientOrFallback: identity, parseWechatDateTimeLine: () => ({}),
        parseWechatFile: () => null, HONEY_INVITE_TAG_REGEX: /$^/
    };
    return Function(...Object.keys(env), `${indexSource.slice(start, end)};return parseLightweightWechatTag;`)(...Object.values(env))(text);
}

function story(status) {
    return `<wechat><!--
---好友A---
接收人：测试玩家
date:2026年11月19日
[12:00] 我来找你
[12:00] [拨打微信语音]
[12:00] 接电话。[内心]（怎么还不开门）
---测试玩家---
接收人：好友A
date:2026年11月19日
[12:00] 语音通话-${status}
[12:00] ${status === '接听' ? '干什么啊？！' : '不要打扰我！'}
--></wechat>`;
}

async function dispatchStory(data, blocks, cleanUserReplies = false) {
    const incoming = [];
    const start = indexSource.indexOf('function handleWechatTagData(data) {');
    const end = indexSource.indexOf('// 🔥 处理联系人更新', start);
    const body = indexSource.slice(start, end).replace(/import\('\.\/apps\/wechat\/wechat-data\.js[^']*'\)/g, 'Promise.resolve({ WechatData })');
    const env = {
        WechatData, shouldDiscardHallucinatedTwoPersonGroup: () => false,
        loadTimeManager: () => Promise.resolve(null), phoneShell: null,
        checkCalendarScheduleReminders: () => {}, getContext: () => ({ characterId: 'character', chatId: 'story' }),
        getCurrentTavernConversationIdentity: () => 'story', _lastWechatConversationId: 'story',
        window: globalThis.window, storage: data.storage, document: { getElementById: () => null },
        isWechatOfflineUserReplyCleanEnabled: () => cleanUserReplies, isWechatSenderCurrentUser: name => name === 'me',
        normalizeWechatGroupSpeakerName: value => value,
        triggerWechatIncomingCall: (...args) => incoming.push(args), syncWechatHomeBadge: () => {}, currentApp: '',
        showUnifiedPhoneNotification: () => {}, playWechatMessageSound: () => {},
        _resolveWechatNotificationAvatar: () => ''
    };
    const handle = Function(...Object.keys(env), `${body};return handleWechatTagData;`)(...Object.values(env));
    blocks.forEach(block => handle({ ...block, tavernMessageIndex: 4, batchId: 'batch' }));
    await new Promise(resolve => setImmediate(resolve));
    return incoming;
}

for (const status of ['接听', '已拒绝']) {
    test(`complete story parser and storage handle ${status}, repeated delivery, replay and floor rollback`, async () => {
        const previousWindow = globalThis.window;
        const previousEvent = globalThis.CustomEvent;
        const values = new Map();
        const data = new WechatData({ get: (key, fallback = null) => values.has(key) ? values.get(key) : fallback, set: (key, value) => values.set(key, value) });
        data.data.userInfo.name = '测试玩家';
        data.data.contacts.push({ id: 'friend', name: '好友A' });
        data.createChat({ id: 'chat', type: 'single', contactId: 'friend', name: '好友A' });
        globalThis.window = { VirtualPhone: { cachedWechatData: data }, dispatchEvent() {} };
        globalThis.CustomEvent = class {};
        try {
            const parsed = parseStory(story(status));
            const blocks = resolve(parsed);
            const calls = await dispatchStory(data, blocks);
            const messages = data.getMessages('chat');
            assert.equal(messages.filter(message => message.type === 'call_record').length, 1);
            const record = messages.find(message => message.type === 'call_record');
            assert.equal(record.from, 'me');
            assert.equal(record.fromMainChatTag, true);
            if (status === '接听') {
                assert.equal(calls.length, 1);
                assert.equal(calls[0][4].recordId, record.id);
                assert.deepEqual(calls[0][4].userLines, ['干什么啊？！']);
                assert.equal(messages.filter(message => message.type === 'text' && message.from === 'me').length, 0);
            } else {
                assert.equal(calls.length, 0);
                assert.equal(record.status, 'rejected');
                assert.ok(messages.some(message => message.from === 'me' && message.content === '不要打扰我！'));
            }
            assert.equal((await dispatchStory(data, blocks)).length, 0, 'duplicate source delivery cannot wake another call');
            data.data.messages.chat = [];
            const replay = blocks.map(block => ({ ...block, isHistoryReplay: true }));
            assert.equal((await dispatchStory(data, replay)).length, 0, 'history replay cannot wake a call');
            assert.equal(data.getMessages('chat').filter(message => message.type === 'call_record').length, 1);
            assert.equal(data.rollbackToFloor(4), true);
            assert.equal(data.getMessages('chat').length, 0);
            assert.equal(data.getChat('chat').unread, 0);
        } finally { globalThis.window = previousWindow; globalThis.CustomEvent = previousEvent; }
    });
}


test('offline refusal is attributed to the user in call history prompts', () => {
    const view = Object.create(ChatView.prototype);
    const record = resolve(scenario('已拒绝'))[0].messages[1];
    assert.match(view._formatCallRecordForPrompt(record), /用户已拒绝/);
    assert.doesNotMatch(view._formatCallRecordForPrompt(record), /对方已拒绝/);
    assert.match(view._formatCallRecordForPrompt({ ...record, offlineCallDecision: false }), /对方已拒绝/);
});


function planProductionStory(text, cleanUserReplies = true) {
    const start = indexSource.indexOf('function processWechatLikeTagsInSourceOrder(');
    const end = indexSource.indexOf('async function ensureWangxiangApp()', start);
    const planned = [];
    const env = {
        maskPhoneParserReasoningBlocks: value => value, decodePhoneTagBoundaryEntities: value => value,
        parseLightweightWechatTag: parseStory, resolveOfflineWechatCallDecisions,
        isWechatOfflineUserReplyCleanEnabled: () => cleanUserReplies,
        isWechatSenderCurrentUser: name => name === 'me', normalizeWechatChatIdentityKey: value => value,
        handlePhoneTag: data => planned.push(data), processUserReplyTags: () => assert.fail('no reply tags expected')
    };
    Function(...Object.keys(env), 'source', `${indexSource.slice(start, end)};processWechatLikeTagsInSourceOrder(source, 4, 'batch');`)(...Object.values(env), text);
    return planned;
}


for (const status of ['接听', '已拒绝']) {
    test(`explicit ${status} works with default user-speech cleanup enabled, including no spoken line`, async () => {
        const previousWindow = globalThis.window;
        const values = new Map();
        const data = new WechatData({ get: (key, fallback = null) => values.has(key) ? values.get(key) : fallback, set: (key, value) => values.set(key, value) });
        data.data.userInfo.name = '测试玩家';
        data.data.contacts.push({ id: 'friend', name: '好友A' });
        data.createChat({ id: 'chat', name: '好友A', type: 'single', contactId: 'friend' });
        globalThis.window = { VirtualPhone: { cachedWechatData: data }, dispatchEvent() {} };
        try {
            const text = status === '接听' ? story(status).replace('[12:00] 干什么啊？！', '') : story(status);
            const planned = planProductionStory(text);
            const events = await dispatchStory(data, planned, true);
            const records = data.getMessages('chat').filter(message => message.type === 'call_record');
            assert.equal(records.length, 1);
            if (status === '接听') {
                assert.equal(events.length, 1);
                assert.equal(events[0][4].recordId, records[0].id);
                assert.deepEqual(events[0][4].userLines, []);
            } else {
                assert.equal(events.length, 0);
                assert.ok(data.getMessages('chat').some(message => message.from === 'me' && message.content === '不要打扰我！'));
            }
            const unrelated = [{ type: 'wechat_message', contact: '好友A', messages: [{ sender: 'me', content: '无通话指令的普通代写', time: '12:01' }] }];
            await dispatchStory(data, unrelated, true);
            assert.ok(!data.getMessages('chat').some(message => message.content === '无通话指令的普通代写'));
        } finally { globalThis.window = previousWindow; }
    });
}

test('grab prompt mirrors a complete alternating call and production planning preserves its order', () => {
    const values = new Map([['phone-prompt-active-presets', JSON.stringify({ wechat: { offline: 'builtin:wechat:offline:grab' } })]]);
    const manager = new PromptManager({ get: (key, fallback = null) => values.has(key) ? values.get(key) : fallback, set: (key, value) => values.set(key, value) });
    const prompt = manager.getPromptForFeature('wechat', 'offline');
    assert.match(prompt, /双方全部已发生的通话对白/);
    assert.match(prompt, /正文没有发生的对白不得/);
    const example = prompt.slice(prompt.indexOf('【接听并完整同步双方已有通话对白示例】'));
    const tag = example.match(/<wechat>[\s\S]*?<\/wechat>/)[0].replaceAll('{{user}}', '测试玩家').replaceAll('[HH:MM]', '[19:01]');
    const planned = planProductionStory(tag);
    const record = planned.flatMap(block => block.messages).find(message => message.offlineCallDecision);
    assert.deepEqual(record.transcript.map(message => message.from), ['me', '好友A', 'me', '好友A']);
    assert.equal(record.transcript.length, 4);
    assert.equal(planned.flatMap(block => block.messages).length, 1, 'spoken lines must not leak into regular WeChat text messages');
    assert.doesNotMatch(manager._getDefaultWechatOfflineNoGrabPrompt(), /抢话版：微信来电结果与通话对白同步/);
});

test('restored call displays both speakers in story order before one automatic reply', async () => {
    const view = Object.create(ChatView.prototype);
    const record = { id: 'call' };
    const contact = { id: 'chat', name: '好友A' };
    const history = [];
    const rendered = [];
    const transcript = [{ from: 'me', text: '喂' }, { from: '好友A', text: '听到了' }, { from: 'me', text: '那就好' }];
    view.app = { currentChat: contact, wechatData: { getMessages: () => [record] } };
    view._offlineCallRecord = { chatId: 'chat', recordId: record.id };
    view._escapeHtml = text => text;
    view._renderWechatCallAiBubbleMarkup = ({ text, sender }) => `<div>${sender}:${text}</div>`;
    view.bindCallBubbleClickEvents = () => {};
    const messages = { isConnected: true, insertAdjacentHTML: (_, html) => rendered.push(html) };
    let sends = 0;
    await view._resumeOfflineAcceptedCall({
        options: { offlineRecordId: record.id, initialTranscript: transcript, initialUserLines: ['喂', '那就好'] },
        contact, greetingReady: Promise.resolve(), history, getMessages: () => messages, isEnded: () => false,
        send: async () => { sends++; assert.deepEqual(history, transcript); }
    });
    assert.equal(sends, 1);
    assert.match(rendered[0], /flex-end/);
    assert.match(rendered[1], /flex-start/);
    assert.match(rendered[2], /flex-end/);
});


test('global wake opens an already connected voice/video interface and keeps ordinary calls ringing', async () => {
    const start = indexSource.indexOf('async function triggerWechatIncomingCall(');
    const end = indexSource.indexOf('// 📞 处理来电', start + 10);
    const body = indexSource.slice(start, end).replace(/import\(`\.\/apps\/wechat\/wechat-app\.js[^`]*`\)/g, 'Promise.resolve({})');
    const calls = [];
    const chat = { id: 'chat', name: '好友A' };
    const data = { getChat: () => chat, getMessages: () => [{ id: 'call' }] };
    const app = { wechatData: data, render() {}, openChat() { this.currentChat = chat; }, chatView: {
        showVoiceCallInterface: (...args) => calls.push(['voice', ...args]),
        showVideoCallInterface: (...args) => calls.push(['video', ...args]),
        showIncomingVoiceCall: () => calls.push(['ring'])
    } };
    const panel = { classList: { remove() {}, add() {} } };
    const content = { querySelector: () => ({}) };
    const env = {
        getCurrentTavernConversationIdentity: () => 'story', console: { log() {}, warn() {}, error: error => assert.fail(String(error)) },
        window: { VirtualPhone: { wechatApp: app, cachedWechatData: data } },
        document: { getElementById: id => id === 'phone-panel-content' ? content : panel, querySelectorAll: () => [] },
        phoneShell: { viewHistory: [] }, storage: {}, currentApp: '', ST_PHONE_VERSION: 'test', ST_PHONE_WECHAT_MODULE_REVISION: 'test',
        openPhonePanelWithOutsideClose() {}, createPhoneInPanel: async () => {}
    };
    const wake = Function(...Object.keys(env), `${body};return triggerWechatIncomingCall;`)(...Object.values(env));
    for (const kind of ['voice', 'video']) {
        await wake('chat', '好友A', kind, [], { recordId: 'call', conversationId: 'story', transcript: [], userLines: [] });
        const call = calls.at(-1);
        assert.equal(call[0], kind);
        assert.equal(call[2], '');
        assert.deepEqual(call[3].initialTranscript, []);
    }
    assert.equal(calls.length, 2);
    await wake('chat', '好友A', 'voice', []);
    assert.deepEqual(calls.at(-1), ['ring']);
});


test('hangup writes elapsed duration to the same source call after its message ID changes', async () => {
    const previousWindow = globalThis.window;
    const values = new Map();
    const storage = { get: (key, fallback = null) => values.has(key) ? values.get(key) : fallback, set: (key, value) => values.set(key, value) };
    const data = new WechatData(storage);
    data.createChat({ id: 'chat', name: '好友A', type: 'single' });
    const source = { tavernMessageIndex: 4, batchId: 'batch', mainChatOrder: 1, callType: 'voice' };
    const placeholder = { id: 'recreated-call', type: 'call_record', from: 'me', content: '语音通话-已接听',
        duration: '0分0秒', status: 'answered', offlineCallDecision: true, fromMainChatTag: true, ...source };
    data.data.messages.chat = [placeholder];
    data._messagesLoaded.chat = true;
    const view = Object.create(ChatView.prototype);
    view.app = { currentChat: data.getChat('chat'), wechatData: data };
    view._resolveCallEndStoryTime = () => ({ time: '19:05', date: '2026年11月19日' });
    globalThis.window = { VirtualPhone: {} };
    try {
        assert.ok(view.addCallRecord('voice', 'answered', '3分49秒', {
            offlineRecordId: 'original-call', offlineRecordSource: source, elapsedSeconds: 229,
            endedBy: 'user', transcript: [{ from: 'me', text: '喂？' }]
        }));
        assert.equal(data.getMessages('chat').length, 1);
        assert.equal(data.getMessages('chat')[0].duration, '3分49秒');
        await data.saveData();
        const restored = new WechatData(storage);
        assert.equal(restored.getMessages('chat')[0].duration, '3分49秒');
        assert.equal(restored.getMessages('chat')[0].transcript[0].text, '喂？');
        const otherBranch = { ...source, batchId: 'regenerated-batch' };
        assert.equal(view.addCallRecord('voice', 'answered', '9分0秒', { offlineRecordId: 'missing', offlineRecordSource: otherBranch }), false);
        assert.equal(data.getMessages('chat')[0].duration, '3分49秒');
    } finally { globalThis.window = previousWindow; }
});


test('offline user-authored group text preserves colon prefixes through parsing and storage', async () => {
    const previousWindow = globalThis.window;
    const values = new Map();
    const data = new WechatData({ get: (key, fallback = null) => values.has(key) ? values.get(key) : fallback, set: (key, value) => values.set(key, value) });
    data.data.userInfo.name = '测试玩家';
    data.createChat({ id: 'group', name: '成人读书会', type: 'group', members: ['好友A', '好友B'] });
    globalThis.window = { VirtualPhone: { cachedWechatData: data }, dispatchEvent() {} };
    const sentences = ['测试玩家最讨厌之人：陈纪迟、许清让、沈涟、秦限！', 'me:这也是正文', '成人读书会：这整句都是内容'];
    try {
        const parsed = parseStory(`<wechat><!--
---测试玩家---
接收人：成人读书会
type:group
date:2018年10月02日14:38
${sentences.join('\n')}
--></wechat>`);
        await dispatchStory(data, parsed);
        assert.deepEqual(data.getMessages('group').map(message => message.content), sentences);
        assert.ok(data.getMessages('group').every(message => message.from === 'me'));
        assert.ok(!data.getChat('group').members.includes('测试玩家最讨厌之人'));
    } finally { globalThis.window = previousWindow; }
});
