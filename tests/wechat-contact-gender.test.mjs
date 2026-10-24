import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { WechatApp } from '../apps/wechat/wechat-app.js';
import { WechatData } from '../apps/wechat/wechat-data.js';

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    get(key, fallback = null) {
        return this.values.has(key) ? this.values.get(key) : fallback;
    }

    set(key, value) {
        if (value === null || value === undefined) {
            this.values.delete(key);
        } else {
            this.values.set(key, value);
        }
    }
}

const buildResponse = (contactLines) => `<初始化设定>
---【微信群】---
1.测试群（甲、乙）
---【微信好友】---
${contactLines.join('\n')}
---【初始时间】---
年月日：2026年09月24日12:30
星期：星期四
</初始化设定>`;

test('user profile keeps a normalized real name and renders it below the nickname field', () => {
    const data = new WechatData(new MemoryStorage());
    assert.equal(data.data.userInfo.realName, '');

    data.updateUserInfo({ realName: '  程昕晚  ' });
    assert.equal(data.data.userInfo.realName, '程昕晚');

    const source = fs.readFileSync(new URL('../apps/wechat/wechat-app.js', import.meta.url), 'utf8');
    const nicknamePosition = source.indexOf('id="user-name-input"');
    const realNamePosition = source.indexOf('id="user-real-name-input"');
    const signaturePosition = source.indexOf('id="user-signature-input"');
    assert.ok(nicknamePosition >= 0 && realNamePosition > nicknamePosition);
    assert.ok(signaturePosition > realNamePosition);
    assert.match(source, /const realName = document\.getElementById\('user-real-name-input'\)/);
    assert.match(source, /this\.wechatData\.updateUserInfo\(\{[\s\S]*?name: newName,[\s\S]*?realName,/);
});

test('contact parser keeps gender aligned across common AI formatting variants', () => {
    const data = new WechatData(new MemoryStorage());
    const parsed = data.parseAIResponse(buildResponse([
        '1.张三（同事）-男',
        '2.李四（朋友，女）',
        '3.王五（家人）（性别：男性）',
        '4.Alice｜female'
    ]));

    assert.deepEqual(parsed.contacts.map(contact => ({
        name: contact.name,
        relation: contact.relation,
        gender: contact.gender
    })), [
        { name: '张三', relation: '同事', gender: 'male' },
        { name: '李四', relation: '朋友', gender: 'female' },
        { name: '王五', relation: '家人', gender: 'male' },
        { name: 'Alice', relation: '', gender: 'female' }
    ]);
});

test('contact parser accepts distinct nickname, remark, real-name alias, relation, and gender fields', () => {
    const data = new WechatData(new MemoryStorage());
    const parsed = data.parseAIResponse(buildResponse([
        '1.昵称：小雨；备注：晓雨姐；真实姓名/其他别名：林晓雨；性别：女；关系：朋友',
        '2.昵称：Alex；备注：无；真实姓名/其他别名：亚历山大、Alexander；真实性别：男；关系：同事'
    ]));

    assert.deepEqual(parsed.contacts, [
        {
            name: '小雨',
            nickname: '小雨',
            avatar: '',
            relation: '朋友',
            remark: '晓雨姐',
            realName: '林晓雨',
            gender: 'female'
        },
        {
            name: 'Alex',
            nickname: 'Alex',
            avatar: '',
            relation: '同事',
            remark: '',
            realName: '亚历山大、Alexander',
            gender: 'male'
        }
    ]);
});

test('contact parser accepts nickname-remark-real-name-gender and keeps the previous compact format compatible', () => {
    const data = new WechatData(new MemoryStorage());
    const parsed = data.parseAIResponse(`<初始化设定>
---【微信群】---
1.项目群(夜雨,Alex,阿九)
---【微信好友】---
1.夜雨-晓雨姐-林晓雨-女
2.Alex-无-亚历山大/Alexander-male
3.阿九-段九霄-男
---【初始时间】---
年月日：2026年09月24日12:30
星期：星期四
</初始化设定>`);

    assert.deepEqual(parsed.contacts, [
        {
            name: '夜雨',
            nickname: '夜雨',
            avatar: '',
            relation: '',
            remark: '晓雨姐',
            realName: '林晓雨',
            gender: 'female'
        },
        {
            name: 'Alex',
            nickname: 'Alex',
            avatar: '',
            relation: '',
            remark: '',
            realName: '亚历山大/Alexander',
            gender: 'male'
        },
        {
            name: '阿九',
            nickname: '阿九',
            avatar: '',
            relation: '',
            remark: '',
            realName: '段九霄',
            gender: 'male'
        }
    ]);
    assert.deepEqual(parsed.groups, [{
        name: '项目群',
        avatar: '',
        members: ['夜雨', 'Alex', '阿九']
    }]);
});

test('contact identity matching includes nickname, user remark, and every real-name alias', () => {
    const data = new WechatData(new MemoryStorage());
    const contact = data.addContact({
        id: 'contact-identities',
        name: 'RainyDay',
        nickname: 'RainyDay',
        remark: '小雨',
        realName: '林晓雨、Xiaoyu Lin'
    });

    assert.equal(data.getContactDisplayName(contact), '小雨');
    assert.equal(data.findContactByAlias('RainyDay')?.id, contact.id);
    assert.equal(data.findContactByAlias('小雨')?.id, contact.id);
    assert.equal(data.findContactByAlias('林晓雨')?.id, contact.id);
    assert.equal(data.findContactByAlias('Xiaoyu Lin')?.id, contact.id);

    const chat = data.createChat({ id: 'chat-identities', contactId: contact.id, name: 'RainyDay', type: 'single' });
    assert.equal(chat.name, '小雨');
    assert.equal(data.updateContact(contact.id, { remark: '' }), true);
    assert.equal(chat.name, 'RainyDay');
});

test('single-chat header uses the shared remark-first contact display name', () => {
    const source = fs.readFileSync(new URL('../apps/wechat/wechat-app.js', import.meta.url), 'utf8');
    const headerStart = source.indexOf('const getHeaderTitle = () => {');
    const headerEnd = source.indexOf('const getMusicListenIndicator = () => {', headerStart);
    const headerSource = source.slice(headerStart, headerEnd);

    assert.ok(headerStart >= 0 && headerEnd > headerStart);
    assert.match(headerSource, /this\.wechatData\.getContactDisplayName\?\.\(currentContact\)/);
    assert.doesNotMatch(headerSource, /String\(currentContact\?\.name \|\| this\.currentChat\.name/);
});

test('smart contact loading sends its override first as system and keeps rules last as user', async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    globalThis.document = { getElementById: () => null };
    globalThis.window = {
        VirtualPhone: {
            promptManager: {
                _loaded: true,
                renderPromptForFeature(app, feature, variables) {
                    assert.equal(app, 'wechat');
                    if (feature === 'loadContactsOverride') return 'CONTACT SYSTEM OVERRIDE';
                    if (feature === 'loadContacts') return `CONTACT RULES FOR ${variables.user}`;
                    return '';
                },
                getPromptForFeature() {
                    return '';
                }
            },
            worldbookManager: {
                async appendWorldbookMessages(messages) {
                    messages.push({ role: 'system', content: 'WORLDBOOK' });
                }
            }
        }
    };

    try {
        const data = new WechatData(new MemoryStorage());
        const messages = await data.buildContactPrompt({
            name1: '测试用户',
            name2: '测试角色',
            chat: []
        });

        assert.deepEqual(messages[0], { role: 'system', content: 'CONTACT SYSTEM OVERRIDE' });
        assert.deepEqual(messages[1], { role: 'system', content: 'WORLDBOOK' });
        assert.match(messages[2].content, /^【角色信息】\n【当前主角角色卡】/);
        assert.equal(
            messages.some(message => String(message.content || '').includes('以上是故事的参考背景。现在你是一个数据分析助手')),
            false
        );
        assert.deepEqual(messages.at(-1), { role: 'user', content: 'CONTACT RULES FOR 测试用户' });
        assert.equal(messages.filter(message => message.content === 'CONTACT SYSTEM OVERRIDE').length, 1);
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
    }
});

test('setting contact gender updates the contact and invalidates a stale auto avatar', () => {
    const data = new WechatData(new MemoryStorage());
    data.data.contacts.push({ id: 'contact-1', name: '测试联系人', gender: 'female' });
    data.data.contactAutoAvatarMap['contact-1'] = '/apps/wechat/avatars/female001.jpg';

    data.setContactGender('contact-1', 'male');

    assert.equal(data.getContact('contact-1').gender, 'male');
    assert.equal(data.getContactGender('contact-1'), 'male');
    assert.equal(data.getContactAutoAvatar('contact-1'), '');
});

test('avatar pools never fall back across genders', () => {
    const app = Object.create(WechatApp.prototype);
    app._avatarPool = {
        male: ['male-1'],
        female: ['female-1'],
        male_elder: ['male-elder-1'],
        female_elder: ['female-elder-1'],
        all: ['male-1', 'female-1']
    };

    assert.deepEqual(app._getAvatarPoolByGender('male'), ['male-1']);
    assert.deepEqual(app._getAvatarPoolByGender('female'), ['female-1']);
    assert.deepEqual(app._getAvatarPoolByGender('unknown'), []);

    app._avatarPool.male = [];
    assert.deepEqual(app._getAvatarPoolByGender('male'), ['male-elder-1']);
});
