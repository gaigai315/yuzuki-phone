import assert from 'node:assert/strict';
import test from 'node:test';

import { WechatData } from '../apps/wechat/wechat-data.js';
import { WechatApp } from '../apps/wechat/wechat-app.js';
import { getTavernUserAvatarCandidates, normalizeWechatUserAvatar } from '../apps/wechat/user-avatar.js';

class MemoryStorage {
    values = new Map();
    get(key, fallback = null) { return this.values.get(key) ?? fallback; }
    set(key, value) { this.values.set(key, value); }
}

function createData(userInfo = {}) {
    const data = new WechatData(new MemoryStorage());
    Object.assign(data.data.userInfo, { name: '温晓', ...userInfo });
    data._getSillyTavernPersonaAvatarCandidates = () => ['/User%20Avatars/current.png'];
    return data;
}

test('runtime Persona works with an unmounted list and follows live Persona changes', () => {
    const personas = { user_avatar: '当前 用户.png', getUserAvatar: id => `User Avatars/${encodeURIComponent(id)}` };
    const options = {
        personas, context: null,
        document: { querySelector() { throw new Error('Persona DOM must not be needed'); } },
    };
    assert.deepEqual(getTavernUserAvatarCandidates(options), ['/User%20Avatars/%E5%BD%93%E5%89%8D%20%E7%94%A8%E6%88%B7.png']);
    personas.user_avatar = 'next.png';
    assert.deepEqual(getTavernUserAvatarCandidates(options), ['/User%20Avatars/next.png']);
});

test('runtime Persona provides its thumbnail as an image-load fallback', () => {
    assert.deepEqual(getTavernUserAvatarCandidates({
        personas: { user_avatar: 'current.png' },
        context: { getThumbnailUrl: (type, file) => `/thumbnail?type=${type}&file=${file}` },
    }), ['/User%20Avatars/current.png', '/thumbnail?type=persona&file=current.png']);
});

test('DOM fallback skips blank placeholders and already broken images', () => {
    for (const selected of [
        { src: 'https://tavern.test/img/user-default.png' },
        { src: 'https://tavern.test/User%20Avatars/missing.png', complete: true, naturalWidth: 0 },
        { src: 'https://tavern.test/', getAttribute: () => '' },
        { src: 'https://tavern.test/', currentSrc: 'https://tavern.test/', getAttribute: () => '' },
    ]) {
        assert.deepEqual(getTavernUserAvatarCandidates({
            personas: null, context: null,
            document: { querySelector: selector => selector.includes('selected') ? selected
                : { src: 'https://tavern.test/User%20Avatars/current.png' } },
        }), ['https://tavern.test/User%20Avatars/current.png']);
    }
});

test('legacy empty, emoji and malformed values do not block the Tavern avatar', () => {
    for (const avatar of ['', ' ', '😊', 'none', 'null', 'undefined', {}, 123, '/img/user-default.png']) {
        const data = createData({ avatar });
        assert.equal(data.getUserInfo().avatar, '/User%20Avatars/current.png');
        assert.deepEqual(data.data.userInfo.avatar, avatar, 'display resolution must not rewrite storage');
    }
});

test('historical Persona paths follow the current Persona, while old custom uploads remain', () => {
    for (const avatar of ['User Avatars/old.png', '/User%20Avatars/old.png', 'https://old.test/thumbnail?type=persona&file=old.png']) {
        assert.equal(createData({ avatar }).getUserInfo().avatar, '/User%20Avatars/current.png');
    }
    for (const avatar of ['/backgrounds/phone_wechat_avatar_old.png', 'https://example.test/avatar.png']) {
        assert.equal(createData({ avatar }).getUserInfo().avatar, avatar);
    }
});

test('explicit avatar edits record their source and survive save/reload', async () => {
    const data = createData();
    data.updateUserInfo({ avatar: '/backgrounds/phone_wechat_avatar_custom.png' });
    assert.equal(data.data.userInfo.avatarSource, 'custom');
    data.updateUserInfo({ name: '新昵称' });
    assert.equal(data.data.userInfo.avatarSource, 'custom');
    await data.saveData();
    const reloaded = new WechatData(data.storage);
    reloaded._getSillyTavernPersonaAvatarCandidates = data._getSillyTavernPersonaAvatarCandidates;
    assert.equal(reloaded.getUserInfo().avatar, '/backgrounds/phone_wechat_avatar_custom.png');
    reloaded.updateUserInfo({ avatar: '' });
    assert.equal(reloaded.data.userInfo.avatarSource, 'persona');
    assert.equal(reloaded.getUserInfo().avatar, '/User%20Avatars/current.png');
});

test('explicit custom Persona URLs are preserved instead of treated as historical automatic values', () => {
    const data = createData();
    data.updateUserInfo({ avatar: '/User%20Avatars/custom.png' });
    assert.equal(data.getUserInfo().avatar, '/User%20Avatars/custom.png');
});

test('user image errors fall back locally, preserve custom data and stop at the text initial', () => {
    const customAvatar = '/backgrounds/phone_wechat_avatar_custom.png';
    const data = createData({ avatar: customAvatar });
    const stored = JSON.stringify(data.data.userInfo);
    const app = Object.create(WechatApp.prototype);
    app.wechatData = data;
    app.render = () => assert.fail('avatar errors must not rebuild the page or disturb input');
    let removed = false;
    const attrs = { 'data-avatar-src': customAvatar };
    const image = {
        getAttribute: key => attrs[key],
        setAttribute: (key, value) => { attrs[key] = value; },
        remove: () => { removed = true; },
    };
    app.handleWechatUserAvatarImageError(image);
    assert.equal(image.src, '/User%20Avatars/current.png');
    assert.equal(removed, false);
    assert.equal(data.getUserInfo().avatar, image.src);
    app.handleWechatUserAvatarImageError(image);
    assert.equal(removed, true);
    assert.equal(data.getUserInfo().avatar, '');
    assert.equal(JSON.stringify(data.data.userInfo), stored);
    assert.equal(data.storage.values.size, 0, 'network failure must not write a fallback into storage');
});

test('explicitly selecting the same custom avatar retries a transient image failure', () => {
    const avatar = '/backgrounds/phone_wechat_avatar_custom.png';
    const data = createData({ avatar });
    data.markUserAvatarFailed(avatar);
    assert.equal(data.getUserInfo().avatar, '/User%20Avatars/current.png');
    data.updateUserInfo({ avatar });
    assert.equal(data.getUserInfo().avatar, avatar);
});

test('self avatar rendering supports native mobile schemes and leaves a visible initial underneath', () => {
    const app = Object.create(WechatApp.prototype);
    app._ensureWechatAvatarPoolLoaded = () => {};
    app._shouldApplyContactPoolAvatar = () => assert.fail('self must not use a contact avatar');
    for (const avatar of ['asset://localhost/avatar.png', 'tauri://localhost/avatar.png', '/User%20Avatars/current.png']) {
        const html = app.renderAvatar(avatar, '😊', '温晓');
        assert.ok(html.includes(`src="${avatar}"`));
        assert.ok(html.includes('handleWechatUserAvatarImageError'));
        assert.ok(html.includes('>温</span>'));
    }
    const empty = app.renderAvatar('', '😊', '温晓');
    assert.ok(empty.includes('>温</span>'));
    assert.ok(!empty.includes('<img'));
});

test('avatar normalization encodes spaces once and rejects unsupported values', () => {
    assert.equal(normalizeWechatUserAvatar('User Avatars/my avatar.png'), '/User%20Avatars/my%20avatar.png');
    assert.equal(normalizeWechatUserAvatar('/User%20Avatars/my%20avatar.png'), '/User%20Avatars/my%20avatar.png');
    assert.equal(normalizeWechatUserAvatar('javascript:alert(1)'), '');
});
