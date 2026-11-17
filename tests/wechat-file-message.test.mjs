import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parseWechatFile, formatWechatFile, tokenizeWechatFiles } from '../apps/wechat/file-message.js';
import { ChatView } from '../apps/wechat/chat-view.js';
import { WechatData } from '../apps/wechat/wechat-data.js';

const rawFile = formatWechatFile('项目说明.txt', '一、周三开会\n二、保留多行内容');
const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const viewSource = fs.readFileSync(new URL('../apps/wechat/chat-view.js', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../apps/wechat/wechat-app.js', import.meta.url), 'utf8');

test('file protocol accepts paired identical tags and conventional closing tags', () => {
    for (const raw of [rawFile, rawFile.replace(/<文件>$/, '</文件>')]) {
        assert.deepEqual(parseWechatFile(raw), { type: 'file_card', fileTitle: '项目说明.txt', fileText: '一、周三开会\n二、保留多行内容', content: rawFile });
    }
    assert.equal(parseWechatFile('<文件>\n标题：未完成\n内容：流式片段'), null);
    assert.equal(parseWechatFile('<文件>\n标题：空内容\n内容：\n<文件>'), null);
});

test('single and group file blocks tokenize into one line preserving sender and time', () => {
    for (const prefix of ['[13:15]', '[13:15] 群友C:\n', '群友C:\n', '[13:15] 群友C: ']) {
        const result = tokenizeWechatFiles(prefix + rawFile + '\n[13:16] 群友D: 收到');
        assert.equal(result.tokenMap.size, 1);
        assert.equal(result.text.split('\n').length, 2);
        assert.match(result.text, /__ST_PHONE_FILE_0__/);
        assert.match(result.text, /群友D: 收到/);
        const file = result.tokenMap.values().next().value;
        assert.equal(file.fileText, '一、周三开会\n二、保留多行内容');
        if (prefix.includes('13:15')) assert.equal(file.time, '13:15');
    }
});

test('multiple complete files remain distinct and incomplete streams are not emitted as cards', () => {
    const result = tokenizeWechatFiles(`[13:15]${rawFile}\n[13:16]${rawFile}\n<文件>\n标题：未完成`);
    assert.equal(result.tokenMap.size, 2);
    assert.match(result.text, /__ST_PHONE_FILE_0__/);
    assert.match(result.text, /__ST_PHONE_FILE_1__/);
    assert.match(result.text, /标题：未完成/);
});

test('file contents cannot split windows or turn body lines into messages', () => {
    const file = formatWechatFile('名单', '---其他好友---\ntype:group\n接收人：陌生人\n[15:00] 群友D: 这只是文件内容');
    const result = tokenizeWechatFiles(`---工作群---\n[13:15] 群友C:\n${file}`);
    assert.equal(result.text.split(/(?=---.+---)/).length, 1);
    assert.ok(!result.text.includes('其他好友'));
    assert.equal(result.tokenMap.values().next().value.fileText.includes('群友D'), true);
});

test('online split stage resolves a file into one special message instead of text fragments', () => {
    const fileTokens = tokenizeWechatFiles(`[13:15] 群友C:\n${rawFile}`);
    const start = viewSource.indexOf('const expandMixedSpecialList = (list) => {');
    const end = viewSource.indexOf('parsedMessages = expandMixedSpecialList', start);
    const expand = Function('fileTokens', `${viewSource.slice(start, end)}return expandMixedSpecialList;`)(fileTokens);
    const [msg] = expand([{ sender: '群友C', content: '__ST_PHONE_FILE_0__' }]);
    assert.equal(msg.sender, '群友C');
    assert.equal(msg.time, '13:15');
    assert.equal(msg.specialMessage.type, 'file_card');
    assert.equal(msg.specialMessage.fileText, '一、周三开会\n二、保留多行内容');
});

test('main story parser resolves token payloads without losing message identity or time', () => {
    const fileTokens = tokenizeWechatFiles(`[13:15]${rawFile}`);
    const start = indexSource.indexOf('const pushCurrentMessage = (message) => {');
    const end = indexSource.indexOf('// 🔥 辅助函数：保存当前联系人的消息', start);
    const parse = Function('fileTokens', `
        const wangxiangTaskTokens = { tokenMap: new Map() };
        const currentMessages = [];
        ${indexSource.slice(start, end)}
        pushCurrentMessage({ sender: '群友C', time: '13:15', content: '__ST_PHONE_FILE_0__' });
        return currentMessages;
    `);
    const [msg] = parse(fileTokens);
    assert.equal(msg.sender, '群友C');
    assert.equal(msg.time, '13:15');
    assert.equal(msg.type, 'file_card');
    assert.equal(msg.fileTitle, '项目说明.txt');
    assert.match(indexSource, /fileTitle: msg.fileTitle,[\s\S]*?fileText: msg.fileText,/);
});

test('user files preserve full text and use the selected destination with a new batch', () => {
    const view = Object.create(ChatView.prototype);
    let saved;
    view._isBlockedSingleChat = () => false;
    view._shouldUseRealTimeForOnlineChat = () => false;
    view.app = { wechatData: { getChat: () => ({ id: 'group' }), getUserInfo: () => ({}), addMessage: (id, msg) => { saved = { id, msg }; return true; } } };
    view._sendWechatFile('group', '用户文件.txt', '用户长文'.repeat(100));
    assert.equal(saved.id, 'group');
    assert.equal(saved.msg.type, 'file_card');
    assert.equal(saved.msg.fileText.length, 400);
    assert.match(saved.msg.batchId, /^file_/);
    assert.equal(view._formatMessageContentForPrompt(saved.msg), saved.msg.content);
    assert.equal(WechatData.prototype.getMessagePreview(saved.msg), '[文件] 用户文件.txt');
});

test('default online, group and both offline prompts describe the file protocol', () => {
    const source = fs.readFileSync(new URL('../config/prompt-manager.js', import.meta.url), 'utf8');
    assert.equal((source.match(/⑦ 文件发送/g) || []).length, 2);
    assert.equal((source.match(/文件发送：/g) || []).length, 4);
    assert.ok((source.match(/最多200字/g) || []).length >= 4);
});

test('file cards render compact titles and open the full escaped text', () => {
    const view = Object.create(ChatView.prototype);
    const msg = { id: 'file', ...parseWechatFile(formatWechatFile('说明<1>.txt', '<script>这只是文字</script>\n第二段')) };
    view.selectedMessageIds = new Set();
    view._escapeHtml = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    view._resolveMessageAvatarIdentity = () => ({ isMe: true, senderName: '用户' });
    view._isMessageSelectionActiveForCurrentChat = () => false;
    view.app = { currentChat: { id: 'chat' }, renderAvatar: () => '', wechatData: { getMessages: () => [msg] } };
    const card = view.renderMessage(msg, {});
    assert.match(card, /wechat-file-card/);
    assert.match(card, /说明&lt;1&gt;.txt/);
    assert.ok(!card.includes('第二段'));
    let appended;
    let close;
    let removed = false;
    view.getCurrentWechatView = () => ({ querySelector: () => null, appendChild: el => { appended = el; } });
    const previous = globalThis.document;
    globalThis.document = { createElement: () => ({ addEventListener: (_name, fn) => { close = fn; }, remove: () => { removed = true; } }) };
    try {
        view.openWechatFile('file');
        assert.match(appended.innerHTML, /&lt;script&gt;这只是文字&lt;\/script&gt;/);
        assert.match(appended.innerHTML, /第二段/);
        close({ target: appended, stopPropagation() {} });
        assert.equal(removed, true);
    } finally {
        if (previous === undefined) delete globalThis.document;
        else globalThis.document = previous;
    }
});

test('file card text stays black when the global WeChat text color is light', () => {
    assert.match(appSource, /\.wechat-file-card,[\s\S]*?\.wechat-file-card-title,[\s\S]*?\.wechat-file-card \.wechat-forward-record-footer span \{[\s\S]*?color: #000 !important;[\s\S]*?-webkit-text-fill-color: #000 !important;/);
    assert.match(appSource, /\.wechat-file-card,[\s\S]*?\.wechat-file-card \*/);
    assert.match(appSource, /\.wechat-file-card \.wechat-file-card-icon \{[\s\S]*?color: #fff !important;[\s\S]*?-webkit-text-fill-color: #fff !important;/);
});

test('complete offline WeChat parser keeps group file sender, time and multiline content', () => {
    const start = indexSource.indexOf('function parseLightweightWechatTag(text) {');
    const end = indexSource.indexOf('// 🔧 辅助函数：解析消息类型', start);
    const identity = value => value;
    const env = {
        isPhoneFeatureEnabled: () => true,
        maskPhoneParserReasoningBlocks: identity, decodePhoneTagBoundaryEntities: identity,
        window: { VirtualPhone: {} }, timeManager: null,
        extractWechatStoryTimeFallback: () => ({ date: '2026年11月03日' }),
        WECHAT_EMPTY_REGEX: /<wechat>\s*<\/wechat>/g,
        WECHAT_TAG_REGEX_SINGLE: /<wechat>([\s\S]*?)<\/wechat>/,
        WECHAT_TAG_REGEX_NEW: /<wechat>([\s\S]*?)<\/wechat>/g,
        extractWechatTagPayload: value => value.replace(/^<wechat>/, '').replace(/<\/wechat>$/, '').replace(/<!--|-->/g, ''),
        stripWechatCommentWrapper: identity,
        tokenizeWechatFiles,
        tokenizeWangxiangTaskTags: text => ({ text, tokenMap: new Map() }),
        normalizeWechatGroupSpeakerName: identity,
        isWechatRecipientAllowed: name => name === '用户',
        normalizeWechatDateText: identity,
        getWechatKnownGroupByName: () => ({ members: ['群友C', '群友D'] }),
        normalizeWechatRecipientOrFallback: identity,
        parseWechatDateTimeLine: () => ({}),
        parseMessageType: () => {}
    };
    const parse = Function(...Object.keys(env), `${indexSource.slice(start, end)}; return parseLightweightWechatTag;`)(...Object.values(env));
    const [group] = parse(`<wechat><!--\n---工作群---\n接收人：用户\ntype:group\n[13:15] 群友C:\n${rawFile}\n[13:16] 群友D: 收到\n--></wechat>`);
    assert.equal(group.messages.length, 2);
    assert.equal(group.messages[0].type, 'file_card');
    assert.equal(group.messages[0].sender, '群友C');
    assert.equal(group.messages[0].time, '13:15');
    assert.equal(group.messages[0].fileText, '一、周三开会\n二、保留多行内容');
    assert.equal(group.messages[1].content, '收到');
});
