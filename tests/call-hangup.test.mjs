import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { parseCallHangupReply } from '../config/call-hangup.js';
import { ChatView } from '../apps/wechat/chat-view.js';

test('AI reply normalization preserves hangup for single and group calls', async () => {
    const previousWindow = globalThis.window;
    globalThis.window = { SillyTavern: { getContext: () => ({ name1: '用户' }) } };
    try {
        for (const group of [false, true]) {
            const view = Object.create(ChatView.prototype);
            view.app = { currentChat: { name: '角色', type: group ? 'group' : 'friend' } };
            view._getGroupChatParticipants = () => group ? ['角色'] : [];
            view._readNonNegativeLimit = () => 30;
            view._collectSingleChatAliasesForFilter = () => ['角色'];
            view.sendToAIHidden = async () => '<wechat>晚安。\n已挂断</wechat>';
            const reply = await view.sendCallMessageToAI('晚安', '角色', [], 'voice');
            assert.equal(parseCallHangupReply(reply).ended, true);
            assert.match(parseCallHangupReply(reply).text, /晚安/);
        }
    } finally {
        globalThis.window = previousWindow;
    }
});

test('terminal hangup marker keeps the final spoken reply', () => {
    assert.deepEqual(parseCallHangupReply('晚安。\n已挂断'), { ended: true, text: '晚安。' });
    assert.deepEqual(parseCallHangupReply('晚安。【已挂断】'), { ended: true, text: '晚安。' });
    assert.deepEqual(parseCallHangupReply('已挂断'), { ended: true, text: '' });
    assert.equal(parseCallHangupReply('不要显示已挂断，我们继续聊。').ended, false);
});

const source = fs.readFileSync(new URL('../apps/wechat/chat-view.js', import.meta.url), 'utf8');
for (const kind of ['Video', 'Voice']) {
    for (const actor of ['character', 'user']) {
        test(`${kind} ${actor} hangup saves once, identifies actor, stops controls and keeps page`, () => {
            const low = kind.toLowerCase();
            const section = source.slice(source.indexOf(`    show${kind}CallInterface(`));
            const start = section.indexOf('        const finishCall =');
            const end = section.indexOf(`        const render${kind}AiLinesSequentially`, start);
            const records = [];
            const input = {};
            const button = { setAttribute() {}, remove() {} };
            let html = '';
            let stopped = false;
            const element = { isConnected: true, insertAdjacentHTML: (_, text) => { html += text; } };
            const context = {
                callEnded: false, callMessagesElement: element,
                contact: { name: '角色' }, callChatId: 'original-chat', callStartTime: {}, callStartEpoch: Date.now() - 5000,
                chatMessages: [{ from: '角色', text: '晚安。' }],
                document: { getElementById: () => button }, Date, Math,
                clearInterval: () => { stopped = true; },
                stopWechatCallTTS() {}, addCallRecord: (...args) => records.push(args),
                [`clear${kind}BatchTimer`]: () => {}, [`get${kind}Input`]: () => input,
                [`set${kind}CallStatus`]: () => {},
                [low + 'PendingUserLines']: ['待发送'], [`is${kind}Sending`]: true,
                [kind === 'Video' ? 'videoTimer' : 'callTimer']: 1,
                [kind === 'Video' ? 'videoDuration' : 'callDuration']: 5
            };
            vm.runInNewContext(section.slice(start, end) + `finishCall('${actor}'); finishCall('${actor}');`, context);
            assert.equal(records.length, 1);
            const options = records[0][3];
            assert.equal(options.chatId, 'original-chat');
            assert.equal(options.endedBy, actor);
            assert.equal(options.transcript[0].text, '晚安。');
            assert.equal(options.transcript.at(-1).from, actor === 'user' ? 'me' : '角色');
            assert.match(options.transcript.at(-1).text, /已挂断/);
            assert.equal(stopped, true);
            assert.equal(input.disabled, true);
            assert.equal(button.disabled, true);
            assert.match(html, /text-align:center.*color:#888.*已挂断/);
        });
    }
}
