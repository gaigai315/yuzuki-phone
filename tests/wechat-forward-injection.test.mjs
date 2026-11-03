import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { formatWechatFile } from '../apps/wechat/file-message.js';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const start = source.indexOf('recentMessages.forEach(msg => {');
const end = source.indexOf('if (formattedMessages.length > 0)', start);
assert.ok(start >= 0 && end > start);
const formatHistory = Function('formatWechatFile', 'recentMessages', 'chat', 'userName', `
    const formattedMessages = [];
    ${source.slice(start, end)}
    return formattedMessages;
`).bind(null, formatWechatFile);

test('main story injection expands forwarded records in both single and group chats', () => {
    const original = '【转发聊天记录：课题组】\n陈昊（2103年06月02日 13:15）：模型展示交给你\n\n林晓晓（2103年06月02日 13:16）：收到';
    for (const type of ['single', 'group']) {
        const [message] = formatHistory([
            { from: 'me', type: 'forward_card', content: original, date: '2103年06月03日', time: '10:00' }
        ], { type, name: '接收窗口' }, '程听晚');
        assert.equal(message.content, original);
        assert.equal(message.speaker, '程听晚');
        assert.equal(message.time, '10:00');
        assert.equal(message.date, '2103年06月03日');
        assert.ok(!message.content.includes('[forward_card]'));
    }
});

test('main story injection falls back to saved entries when full forward text is absent', () => {
    const [message] = formatHistory([{
        from: 'me', type: 'forward_card', content: '',
        forwardEntries: [{ sender: '陈昊', date: '2103年06月02日', time: '13:15', content: '原始正文' }]
    }], { type: 'single', name: '哥哥' }, '程听晚');
    assert.match(message.content, /陈昊（2103年06月02日 13:15）：原始正文/);
});

test('legacy text forwards still inject the complete text unchanged', () => {
    const original = '【转发聊天记录：旧群】\n甲：旧转发原文';
    const [message] = formatHistory([{ from: 'me', type: 'text', content: original }], { type: 'single', name: '好友' }, '用户');
    assert.equal(message.content, original);
});

test('file cards inject complete title and text into story history', () => {
    const [message] = formatHistory([{ from: 'me', type: 'file_card', fileTitle: '会议纪要.txt', fileText: '确认周三开会\n不要遗漏第二段' }], { type: 'group', name: '工作群' }, '用户');
    assert.equal(message.content, formatWechatFile('会议纪要.txt', '确认周三开会\n不要遗漏第二段'));
});
