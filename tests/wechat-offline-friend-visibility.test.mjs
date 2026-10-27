import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { WechatData } from '../apps/wechat/wechat-data.js';

const appSource = fs.readFileSync(new URL('../apps/wechat/wechat-app.js', import.meta.url), 'utf8');
const contactsSource = fs.readFileSync(new URL('../apps/wechat/contacts-view.js', import.meta.url), 'utf8');
const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const cssSource = fs.readFileSync(new URL('../phone.css', import.meta.url), 'utf8');
const shellSource = fs.readFileSync(new URL('../phone/phone-shell.js', import.meta.url), 'utf8');

test('offline prompt hidden friend IDs are normalized and persisted in WeChat user info', () => {
    let saveCount = 0;
    const data = Object.create(WechatData.prototype);
    data.data = { userInfo: {} };
    data.saveData = () => { saveCount += 1; };

    assert.deepEqual(
        data.setOfflinePromptHiddenContactIds(['contact-a', ' contact-a ', '', 'contact-b']),
        ['contact-a', 'contact-b']
    );
    assert.deepEqual(data.data.userInfo.offlinePromptHiddenContactIds, ['contact-a', 'contact-b']);
    assert.equal(saveCount, 1);
});

test('the former add button opens a scoped offline-friend visibility picker', () => {
    assert.match(contactsSource, /data-func="new-friends"[\s\S]*?新的朋友/);
    assert.doesNotMatch(appSource, /id="wechat-add"/);
    assert.doesNotMatch(appSource, /showAddFriendMenu\(/);
    assert.match(appSource, /id="wechat-offline-friend-settings"[\s\S]*?fa-gear/);
    assert.match(appSource, /showOfflineFriendVisibilitySettings\(\)/);
    assert.match(appSource, /勾选的好友不会出现在正文线下模式的微信好友列表中/);
    assert.match(cssSource, /#phone-panel-content \.phone-screen \.wechat-offline-friends-overlay/);
    assert.match(cssSource, /\.wechat-offline-friends-list\s*\{[^}]*touch-action:\s*pan-y[^}]*overscroll-behavior:\s*contain/s);
    assert.match(shellSource, /'\.wechat-offline-friends-list'/);
});

test('offline prompt construction excludes hidden friends and their fixed image tags', () => {
    const hiddenSet = indexSource.indexOf('const hiddenOfflineContactIds = new Set(');
    const hiddenGuard = indexSource.indexOf("if (hiddenOfflineContactIds.has(String(c?.id || '').trim())) return;", hiddenSet);
    const friendPush = indexSource.indexOf('contactNames.push(', hiddenGuard);
    const tagRead = indexSource.indexOf('const tags = String(c?.naiPromptTags', hiddenGuard);

    assert.ok(hiddenSet >= 0);
    assert.ok(hiddenGuard > hiddenSet);
    assert.ok(friendPush > hiddenGuard);
    assert.ok(tagRead > hiddenGuard);
    assert.match(indexSource, /offlinePromptHiddenContactIds/);
});
