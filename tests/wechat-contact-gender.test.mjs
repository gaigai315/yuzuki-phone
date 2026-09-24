import assert from 'node:assert/strict';
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
