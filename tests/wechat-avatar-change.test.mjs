import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatView } from '../apps/wechat/chat-view.js';
import { WechatData } from '../apps/wechat/wechat-data.js';
import { getEmojiGroup, parseAvatarCommand, resolveAvatarSource } from '../apps/wechat/avatar-change.js';

function fixture() {
    const data = Object.create(WechatData.prototype);
    data.data = {
        contacts: [{ id: 'friend', name: '周倩', avatar: '/backgrounds/old.png' }],
        chats: [{ id: 'chat', name: '周倩', contactId: 'friend', avatar: '/backgrounds/old.png' }],
        messages: { chat: [] },
        customEmojis: [
            { id: 'ordinary', name: '笑脸', image: '/backgrounds/sticker.png' },
            { id: 'cat', name: '小猫', image: '/backgrounds/cat.png', group: 'avatar' }
        ]
    };
    data._messagesDirty = {};
    data.saveData = () => {};
    data.getChat = id => data.data.chats.find(item => item.id === id);
    data.getMessages = id => data.data.messages[id] || [];
    data.getContact = id => data.data.contacts.find(item => item.id === id);
    data.getContactByName = name => data.data.contacts.find(item => item.name === name);
    data.findContactByAlias = data.getContactByName;
    data._getContactAliasValues = contact => [contact.name];
    data._isSameLookupName = (a, b) => a === b;
    data.getContactDisplayName = contact => contact.name;
    data.getUserInfo = () => ({ name: '用户', avatar: '/backgrounds/user.png' });
    data.addMessage = (id, message) => { data.data.messages[id].push(message); return true; };
    const social = [];
    data.globalSocialStore = { upsertContact: contact => social.push(contact) };
    const view = Object.create(ChatView.prototype);
    view.app = { wechatData: data, currentChat: data.data.chats[0], phoneShell: {} };
    view._isCurrentWechatUserName = name => name === '用户';
    return { view, data, social };
}

test('legacy stickers stay in default and group changes survive normalization', () => {
    const { data, view } = fixture();
    assert.equal(getEmojiGroup(data.data.customEmojis[0]), 'default');
    assert.equal(data._normalizeCustomEmojiList(data.data.customEmojis)[1].group, 'avatar');
    assert.deepEqual(view._getVisibleCustomEmojis().map(item => item.id), ['ordinary']);
    view.customEmojiGroup = 'avatar';
    assert.deepEqual(view._getVisibleCustomEmojis().map(item => item.id), ['cat']);
    view.selectedCustomEmojiIds = new Set();
    view._toggleSelectAllCustomEmojis();
    assert.deepEqual([...view.selectedCustomEmojiIds], ['cat']);
});

test('avatar commands split from ordinary replies and library choices require an ID', () => {
    const { view } = fixture();
    const split = view.splitMixedSpecialMessage({ sender: '周倩', content: '换这个吧[更换头像：cat]你觉得呢' });
    assert.deepEqual(split.map(item => item.specialMessage?.type || item.content), ['换这个吧', 'avatar_change', '你觉得呢']);
    const request = { candidates: [{ id: 'a', name: '重名' }, { id: 'b', name: '重名' }] };
    assert.equal(resolveAvatarSource(parseAvatarCommand('[更换头像:重名]'), request), null);
    assert.equal(resolveAvatarSource(parseAvatarCommand('[更换头像:b]'), request).id, 'b');
    assert.equal(resolveAvatarSource(parseAvatarCommand('[更换头像:小猫]'), { candidates: [{ id: 'cat', name: '小猫' }] }), null);
    assert.equal(parseAvatarCommand('不想换头像'), null);
});

test('every agreement requires an exact ID, including a single image', () => {
    const bare = parseAvatarCommand('[好友同意更换头像]');
    const request = { images: [{ id: 'one' }, { id: 'two' }] };
    assert.equal(resolveAvatarSource(bare, request), null);
    assert.equal(resolveAvatarSource(parseAvatarCommand('[好友同意更换头像:two]'), request).id, 'two');
    assert.equal(resolveAvatarSource(parseAvatarCommand('[好友同意更换头像:old]'), request), null);
    assert.equal(resolveAvatarSource(bare, { images: [{ id: 'one' }] }), null);
    assert.equal(resolveAvatarSource(parseAvatarCommand('[好友同意更换头像:one]'), { images: [{ id: 'one' }] }).id, 'one');
    assert.equal(resolveAvatarSource(bare, {}), null);
});

test('current avatars are sent every turn and gallery pictures are loaded only on lookup', async () => {
    const previousWindow = globalThis.window;
    globalThis.window = { VirtualPhone: {} };
    const { view, data } = fixture();
    const reads = [];
    let galleryReads = 0;
    const getCustomEmojis = data.getCustomEmojis.bind(data);
    data.getCustomEmojis = () => { galleryReads++; return getCustomEmojis(); };
    view._resolveWechatImageForAi = async path => { reads.push(path); return 'data:image/png;base64,AA=='; };
    try {
        const options = {};
        const context = await view._buildAvatarImageContext(view.app.currentChat, [], options);
        assert.deepEqual(reads, ['/backgrounds/user.png', '/backgrounds/old.png']);
        assert.match(context, /用户 用户 的当前微信头像/);
        assert.match(context, /好友 周倩 的当前微信头像/);
        assert.doesNotMatch(context, /头像分组|可用头像|小猫|cat/);
        assert.equal(galleryReads, 0, 'normal chat must not query the gallery');
        assert.equal(resolveAvatarSource(parseAvatarCommand('[更换头像:小猫]'), options.avatarRequest), null);
        assert.equal(Object.keys(window.VirtualPhone._pendingImages).length, 2);
        reads.length = 0;
        options.includeAvatarLibraryImages = true;
        const lookupContext = await view._buildAvatarImageContext(view.app.currentChat, [], options);
        assert.match(lookupContext, /可用头像：名字=小猫；ID=cat/);
        assert.doesNotMatch(lookupContext, /可用头像：名字=笑脸/);
        assert.equal(galleryReads, 1);
        assert.ok(reads.includes('/backgrounds/cat.png'));
        assert.ok(!reads.includes('/backgrounds/sticker.png'));
    } finally { globalThis.window = previousWindow; }
});

test('group requests attach each current member avatar with its name and deduplicate IDs and remarks', async () => {
    const previousWindow = globalThis.window;
    globalThis.window = { VirtualPhone: {} };
    const { view, data } = fixture();
    data.data.contacts.push(
        { id: 'second', name: '好友B', remark: 'B的备注', avatar: '/backgrounds/b.png' },
        { id: 'departed', name: '退群好友', avatar: '/backgrounds/departed.png' },
        { id: 'unrelated', name: '其他群好友', avatar: '/backgrounds/unrelated.png' },
        { id: 'self', name: '用户', avatar: '/backgrounds/user.png' }
    );
    data.findContactByNameLoose = name => data.data.contacts.find(contact => [contact.id, contact.name, contact.remark].includes(name));
    const group = { id: 'group', name: '当前群', type: 'group', avatar: '/backgrounds/group.png', members: ['用户', 'self', 'friend', '周倩', 'second', 'B的备注'] };
    data.data.messages.group = [{ from: '退群好友', type: 'text', content: '历史消息' }];
    view.app.currentChat = group;
    const reads = [];
    view._resolveWechatImageForAi = async (path, _cache, options) => {
        reads.push({ path, limit: options.maxChars });
        return `data:image/png;base64,${path}`;
    };
    try {
        const text = await view._buildAvatarImageContext(group, [], {}, new Map(), 24000);
        assert.deepEqual(reads.map(item => item.path), ['/backgrounds/user.png', '/backgrounds/old.png', '/backgrounds/b.png']);
        assert.ok(reads.every(item => item.limit === 24000));
        const pictures = Object.values(window.VirtualPhone._pendingImages);
        assert.equal(pictures.length, 3);
        assert.equal(pictures.find(item => item.label === '群友 周倩 的当前微信头像').url, 'data:image/png;base64,/backgrounds/old.png');
        assert.equal(pictures.find(item => item.label === '群友 好友B 的当前微信头像').url, 'data:image/png;base64,/backgrounds/b.png');
        assert.doesNotMatch(text, /退群好友|其他群好友|可用头像|头像分组/);
    } finally { globalThis.window = previousWindow; }
});

test('group avatar failures leave other named portraits available and never substitute the group icon', async () => {
    const previousWindow = globalThis.window;
    globalThis.window = { VirtualPhone: {} };
    const { view, data } = fixture();
    const group = { id: 'group', name: '当前群', type: 'group', avatar: '/backgrounds/group-icon.png', members: ['周倩', '无联系人群友'] };
    view.app.currentChat = group;
    const resolveAvatar = view._getCurrentFriendAvatarForAi.bind(view);
    view._getCurrentFriendAvatarForAi = (owner, contact) => {
        if (!contact) {
            assert.equal(owner.name, '无联系人群友');
            assert.equal(owner.avatar, '');
            return '/backgrounds/fallback.png';
        }
        return resolveAvatar(owner, contact);
    };
    view._resolveWechatImageForAi = async path => {
        if (path === '/backgrounds/old.png') throw new Error('image unavailable');
        return `data:image/png;base64,${path}`;
    };
    try {
        const text = await view._buildAvatarImageContext(group, [], {});
        assert.match(text, /群友 周倩 的当前微信头像：图片读取失败/);
        assert.match(text, /群友 无联系人群友 的当前微信头像 __ST_PHONE_IMAGE_/);
        const pictures = Object.values(window.VirtualPhone._pendingImages);
        assert.equal(pictures.length, 2);
        assert.ok(!pictures.some(item => item.url.includes('group-icon')));
    } finally { globalThis.window = previousWindow; }
});

test('legacy groups without a member list can resolve portraits from their own participants', () => {
    const { view } = fixture();
    const group = { id: 'legacy-group', name: '旧群', type: 'group' };
    view._collectGroupParticipantsForFilter = actual => {
        assert.equal(actual, group);
        return ['用户', 'friend', '周倩'];
    };
    const sources = view._getCurrentChatAvatarSources(group);
    assert.deepEqual(sources.map(item => item.label), ['用户 用户 的当前微信头像', '群友 周倩 的当前微信头像']);
});

test('an empty avatar gallery is mentioned only after lookup', async () => {
    const { view, data } = fixture();
    data.data.customEmojis = [];
    view._resolveWechatImageForAi = async () => { throw new Error('offline'); };
    const options = {};
    const normalContext = await view._buildAvatarImageContext(view.app.currentChat, [], options);
    assert.doesNotMatch(normalContext, /头像分组|可用头像|尚未加载/);
    options.includeAvatarLibraryImages = true;
    const lookupContext = await view._buildAvatarImageContext(view.app.currentChat, [], options);
    assert.match(lookupContext, /头像分组查看结果：空/);
    assert.doesNotMatch(lookupContext, /已加载可用图片/);
});

test('unreadable avatars are reported honestly and do not cancel normal chat', async () => {
    const { view } = fixture();
    view._resolveWechatImageForAi = async () => { throw new Error('offline'); };
    const context = await view._buildAvatarImageContext(view.app.currentChat, [], {});
    assert.match(context, /图片读取失败/);
});

test('lookup runs at most once and its internal tag never reaches chat', async () => {
    const { view } = fixture();
    let calls = 0;
    view.sendToAIHidden = async (...args) => {
        calls++;
        if (calls === 1) return '周倩: [查看头像分组]';
        assert.equal(args[5].includeAvatarLibraryImages, true);
        return '周倩: [查看头像分组]\n周倩: [更换头像:cat]';
    };
    const responses = [];
    for await (const response of view._sendWechatReplyWithAvatarLookup('', {}, null, 'chat', {})) responses.push(response);
    assert.equal(calls, 2);
    assert.equal(responses.length, 1);
    assert.doesNotMatch(responses[0], /查看头像分组/);
    assert.match(responses[0], /更换头像:cat/);
});

test('accepted library choice copies the file, syncs the contact and emits one centered notice', async () => {
    const previousWindow = globalThis.window;
    const previousFetch = globalThis.fetch;
    const { view, data, social } = fixture();
    let uploads = 0;
    globalThis.window = { VirtualPhone: { imageManager: { uploadBlob: async () => {
        uploads++;
        return '/backgrounds/avatar-copy.png';
    } } } };
    globalThis.fetch = async () => ({ ok: true, blob: async () => new Blob(['image'], { type: 'image/png' }) });
    const request = {
        chatId: 'chat', candidates: [data.data.customEmojis[1]], images: [], appliedContacts: new Set()
    };
    const command = parseAvatarCommand('[更换头像:cat]');
    try {
        assert.equal(await view._applyAvatarCommand('chat', '周倩', command, request, { replyBatchId: 'reply' }), true);
        assert.equal(data.data.contacts[0].avatar, '/backgrounds/avatar-copy.png');
        assert.equal(data.data.chats[0].avatar, '/backgrounds/avatar-copy.png');
        assert.equal(social[0].avatar, '/backgrounds/avatar-copy.png');
        const notice = data.data.messages.chat[0];
        assert.equal(notice.from, 'system');
        assert.equal(notice.content, '周倩 已更换头像');
        assert.equal(notice.replyBatchId, 'reply');
        assert.equal(await view._applyAvatarCommand('chat', '周倩', command, request), false);
        assert.equal(uploads, 1);
        data.data.messages.chat = [];
        data._restoreDeletedAvatarChanges([notice]);
        assert.equal(data.data.contacts[0].avatar, '/backgrounds/old.png');
        assert.equal(data.data.chats[0].avatar, '/backgrounds/old.png');
    } finally {
        globalThis.window = previousWindow;
        globalThis.fetch = previousFetch;
    }
});

test('no command, another sender, stale source and another chat never change the avatar', async () => {
    const { view, data } = fixture();
    const request = { chatId: 'other-chat', candidates: [], images: [{ id: 'photo', image: '/backgrounds/photo.png' }], appliedContacts: new Set() };
    const command = parseAvatarCommand('[好友同意更换头像:photo]');
    assert.equal(await view._applyAvatarCommand('chat', '周倩', command, request), false);
    assert.equal(await view._applyAvatarCommand('chat', '用户', command, request), false);
    request.chatId = 'chat';
    assert.equal(await view._applyAvatarCommand('chat', '周倩', command, request), false);
    assert.equal(await view._applyAvatarCommand('chat', '陌生人', command, request), false);
    assert.equal(data.data.contacts[0].avatar, '/backgrounds/old.png');
    assert.equal(data.data.messages.chat.length, 0);
});

test('deleting an older avatar notice rebases a newer notice for later rollback', () => {
    const { data } = fixture();
    const first = { avatarChange: { contactId: 'friend', previousAvatar: '/backgrounds/old.png', nextAvatar: '/backgrounds/b.png' } };
    const second = { avatarChange: { contactId: 'friend', previousAvatar: '/backgrounds/b.png', nextAvatar: '/backgrounds/c.png' } };
    data.data.contacts[0].avatar = '/backgrounds/c.png';
    data.data.messages.chat = [second];
    data._restoreDeletedAvatarChanges([first]);
    assert.equal(data.data.contacts[0].avatar, '/backgrounds/c.png');
    data.data.messages.chat = [];
    data._restoreDeletedAvatarChanges([second]);
    assert.equal(data.data.contacts[0].avatar, '/backgrounds/old.png');
});

test('a later upload during gallery lookup cannot replace the original agreement target', async () => {
    const { view, data } = fixture();
    view._resolveWechatImageForAi = async () => { throw new Error('offline'); };
    const firstPhoto = { id: 'first', from: 'me', type: 'image', content: '/backgrounds/first.png' };
    data.data.messages.chat = [firstPhoto];
    const options = {};
    await view._buildAvatarImageContext(view.app.currentChat, [firstPhoto], options);
    const laterPhoto = { id: 'later', from: 'me', type: 'image', content: '/backgrounds/later.png' };
    data.data.messages.chat.push(laterPhoto);
    options.includeAvatarLibraryImages = true;
    await view._buildAvatarImageContext(view.app.currentChat, [laterPhoto], options);
    assert.equal(resolveAvatarSource(parseAvatarCommand('[好友同意更换头像:first]'), options.avatarRequest).id, 'first');
    assert.equal(resolveAvatarSource(parseAvatarCommand('[好友同意更换头像:later]'), options.avatarRequest), null);
});

test('agreeing to a specific user photo changes only that photo and upload failure leaves state intact', async () => {
    const previousWindow = globalThis.window;
    const previousFetch = globalThis.fetch;
    const { view, data } = fixture();
    const photos = [
        { id: 'first', image: '/backgrounds/first.png' },
        { id: 'second', image: '/backgrounds/second.png' }
    ];
    data.data.messages.chat = photos.map(item => ({ id: item.id, content: item.image, from: 'me', type: 'image' }));
    const request = { chatId: 'chat', candidates: [], images: photos, appliedContacts: new Set() };
    const paths = [];
    let failUpload = true;
    globalThis.fetch = async path => {
        paths.push(path);
        return { ok: true, blob: async () => new Blob(['photo'], { type: 'image/png' }) };
    };
    globalThis.window = { VirtualPhone: { imageManager: { uploadBlob: async () => {
        if (failUpload) throw new Error('upload failed');
        return '/backgrounds/chosen.png';
    } } } };
    const previousWarn = console.warn;
    console.warn = () => {};
    try {
        const command = parseAvatarCommand('[好友同意更换头像:second]');
        assert.equal(await view._applyAvatarCommand('chat', '周倩', command, request), false);
        assert.equal(data.data.contacts[0].avatar, '/backgrounds/old.png');
        assert.equal(data.data.messages.chat.length, 2);
        failUpload = false;
        assert.equal(await view._applyAvatarCommand('chat', '周倩', command, request), true);
        assert.deepEqual(paths, ['/backgrounds/second.png', '/backgrounds/second.png']);
        assert.equal(data.data.contacts[0].avatar, '/backgrounds/chosen.png');
        assert.equal(data.data.messages.chat[2].content, '周倩 已更换头像');
    } finally {
        globalThis.window = previousWindow;
        globalThis.fetch = previousFetch;
        console.warn = previousWarn;
    }
});

test('avatar group switches and moves preserve the surrounding chat', () => {
    const { view, data } = fixture();
    const buttons = ['default', 'avatar'].map(group => ({
        dataset: { group },
        addEventListener(_type, handler) { this.activate = handler; }
    }));
    const move = { addEventListener(_type, handler) { this.activate = handler; } };
    const panel = { querySelectorAll: selector => selector === '.wechat-emoji-group' ? buttons : [] };
    view.getCurrentWechatView = () => ({
        querySelector: selector => ({ '.emoji-panel': panel, '#move-selected-custom-emoji': move }[selector] || null)
    });
    let refreshes = 0;
    view._refreshEmojiPanel = () => { refreshes++; };
    view.app.render = () => assert.fail('group controls must preserve the chat');
    view.selectedCustomEmojiIds = new Set(['ordinary']);
    view._bindEmojiPanelEvents();
    buttons[1].activate();
    assert.equal(view.customEmojiGroup, 'avatar');
    assert.equal(view.selectedCustomEmojiIds.size, 0);
    view.selectedCustomEmojiIds.add('cat');
    data._saveGlobalCustomEmojis = () => {};
    move.activate();
    assert.equal(data.getCustomEmoji('cat').group, 'default');
    assert.equal(view.selectedCustomEmojiIds.size, 0);
    assert.equal(refreshes, 2);
});

test('a prior user photo and each gallery image are paired with their own real IDs', async () => {
    const previousWindow = globalThis.window;
    globalThis.window = { VirtualPhone: {} };
    const { view, data } = fixture();
    data.data.messages.chat = [{ id: 'photo-123', from: 'me', type: 'image', content: '/backgrounds/photo.png' }];
    data.data.customEmojis.push({ id: 'another-cat', name: '小猫', image: '/backgrounds/another-cat.png', group: 'avatar' });
    view._resolveWechatImageForAi = async path => `data:image/png;base64,${path}`;
    try {
        const options = { includeAvatarLibraryImages: true };
        const text = await view._buildAvatarImageContext(view.app.currentChat, [], options);
        const pending = Object.values(window.VirtualPhone._pendingImages);
        assert.equal(pending.find(item => item.label === '用户发送的图片；图片消息ID=photo-123').url, 'data:image/png;base64,/backgrounds/photo.png');
        assert.equal(pending.find(item => item.label === '头像分组：名字=小猫；ID=cat').url, 'data:image/png;base64,/backgrounds/cat.png');
        assert.equal(pending.find(item => item.label === '头像分组：名字=小猫；ID=another-cat').url, 'data:image/png;base64,/backgrounds/another-cat.png');
        assert.match(text, /图片消息ID=photo-123/);
        assert.equal(resolveAvatarSource(parseAvatarCommand('[好友同意更换头像:photo-123]'), options.avatarRequest).image, '/backgrounds/photo.png');
        assert.equal(resolveAvatarSource(parseAvatarCommand('[更换头像:another-cat]'), options.avatarRequest).image, '/backgrounds/another-cat.png');
        assert.equal(resolveAvatarSource(parseAvatarCommand('[更换头像:photo-123]'), options.avatarRequest), null);
        assert.equal(resolveAvatarSource(parseAvatarCommand('[好友同意更换头像:cat]'), options.avatarRequest), null);
    } finally { globalThis.window = previousWindow; }
});


test('mixed lookup replies are delivered before the second call and the chosen ID can then change the avatar', async () => {
    const { view, data } = fixture();
    const order = [];
    const options = {};
    view.sendToAIHidden = async (_message, _context, _mode, _signal, chatId, requestOptions) => {
        if (!requestOptions.includeAvatarLibraryImages) {
            requestOptions.avatarRequest = { chatId, images: [], appliedContacts: new Set() };
            return '<wechat>\n---周倩---\n周倩: 我先看看。\n周倩: [查看头像分组]\n周倩: 等我选一张。\n</wechat>';
        }
        order.push('lookup');
        assert.deepEqual(data.data.messages.chat.map(item => item.content), ['我先看看。', '等我选一张。']);
        assert.equal(requestOptions.avatarLookupContinuation, true);
        requestOptions.avatarRequest.candidates = [data.data.customEmojis[1]];
        return '周倩: [更换头像:cat]';
    };
    for await (const response of view._sendWechatReplyWithAvatarLookup('', {}, null, 'chat', options)) {
        assert.doesNotMatch(response, /查看头像分组/);
        if (response.includes('我先看看')) {
            order.push('first reply');
            data.addMessage('chat', { from: '周倩', type: 'text', content: '我先看看。' });
            data.addMessage('chat', { from: '周倩', type: 'text', content: '等我选一张。' });
        } else {
            order.push('second reply');
            const command = parseAvatarCommand(response.split(': ').slice(1).join(': '));
            const chosen = resolveAvatarSource(command, options.avatarRequest);
            assert.equal(chosen.id, 'cat');
            assert.equal(data.applyAiAvatarChange('chat', '周倩', chosen.image, { replyBatchId: 'same-turn' }), true);
        }
    }
    assert.deepEqual(order, ['first reply', 'lookup', 'second reply']);
    assert.equal(data.data.contacts[0].avatar, '/backgrounds/cat.png');
    assert.equal(data.data.messages.chat[2].content, '周倩 已更换头像');
});

test('failed second call keeps the already delivered reply and reports lookup failure', async () => {
    const { view } = fixture();
    const notices = [];
    view.app.phoneShell.showNotification = (...args) => notices.push(args);
    let calls = 0;
    view.sendToAIHidden = async () => {
        if (++calls === 1) return '周倩: 我看看[查看头像分组]';
        throw new Error('network failed');
    };
    const responses = [];
    const previousWarn = console.warn;
    console.warn = () => {};
    try {
        for await (const response of view._sendWechatReplyWithAvatarLookup('', {}, null, 'chat', {})) responses.push(response);
    } finally { console.warn = previousWarn; }
    assert.deepEqual(responses, ['周倩: 我看看']);
    assert.equal(calls, 2);
    assert.equal(notices[0][0], '头像查看失败');
});

test('cancelling after the first reply prevents the second call', async () => {
    const { view } = fixture();
    const controller = new AbortController();
    let calls = 0;
    view.sendToAIHidden = async () => { calls++; return '周倩: 我看看\n周倩: [查看头像分组]'; };
    await assert.rejects(async () => {
        for await (const response of view._sendWechatReplyWithAvatarLookup('', {}, controller.signal, 'chat', {})) {
            assert.equal(response, '周倩: 我看看');
            controller.abort();
        }
    }, /已中断发送/);
    assert.equal(calls, 1);
});

test('a wrapped lookup-only reply does not produce an empty sender bubble', async () => {
    const { view } = fixture();
    let calls = 0;
    view.sendToAIHidden = async () => ++calls === 1
        ? '<!-- <wechat>\n---周倩---\n[12:30] 周倩: [查看头像分组]\n</wechat> -->'
        : '周倩: 还是用现在这张吧。';
    const responses = [];
    for await (const response of view._sendWechatReplyWithAvatarLookup('', {}, null, 'chat', {})) responses.push(response);
    assert.deepEqual(responses, ['周倩: 还是用现在这张吧。']);
    assert.equal(calls, 2);
});

test('all first-round text including text after lookup waits for paint before the second request', async () => {
    const { view } = fixture();
    const events = [];
    let releasePaint;
    view._waitForAvatarReplyPaint = () => new Promise(resolve => {
        events.push('waiting for paint');
        releasePaint = () => { events.push('painted'); resolve(); };
    });
    view.sendToAIHidden = async (_message, _context, _mode, _signal, _chatId, options) => {
        if (!options.includeAvatarLibraryImages) return '周倩: 好\n周倩: [查看头像分组]\n周倩: 你等等我哦';
        events.push('second request');
        return '周倩: [更换头像:cat]\n周倩: 换好了';
    };
    const replies = view._sendWechatReplyWithAvatarLookup('', {}, null, 'chat', {});
    const first = await replies.next();
    assert.equal(first.value, '周倩: 好\n\n周倩: 你等等我哦');
    events.push('displayed 好', 'displayed 你等等我哦');
    const next = replies.next();
    assert.deepEqual(events, ['displayed 好', 'displayed 你等等我哦', 'waiting for paint']);
    releasePaint();
    assert.match((await next).value, /更换头像:cat/);
    assert.deepEqual(events, ['displayed 好', 'displayed 你等等我哦', 'waiting for paint', 'painted', 'second request']);
    assert.equal((await replies.next()).done, true);
});

test('visible avatar replies wait across two animation frames, and hidden chats skip the wait', async () => {
    const originalDocument = globalThis.document;
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    const callbacks = [];
    globalThis.document = { visibilityState: 'visible' };
    globalThis.requestAnimationFrame = callback => { callbacks.push(callback); return callbacks.length; };
    globalThis.cancelAnimationFrame = () => {};
    const { view } = fixture();
    try {
        let painted = false;
        const waiting = view._waitForAvatarReplyPaint('chat').then(() => { painted = true; });
        assert.equal(callbacks.length, 1);
        callbacks[0]();
        await Promise.resolve();
        assert.equal(painted, false);
        assert.equal(callbacks.length, 2);
        callbacks[1]();
        await waiting;
        assert.equal(painted, true);
        document.visibilityState = 'hidden';
        await view._waitForAvatarReplyPaint('chat');
        assert.equal(callbacks.length, 2);
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(view._waitForAvatarReplyPaint('chat', controller.signal), /已中断发送/);
    } finally {
        globalThis.document = originalDocument;
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.cancelAnimationFrame = originalCancel;
    }
});
