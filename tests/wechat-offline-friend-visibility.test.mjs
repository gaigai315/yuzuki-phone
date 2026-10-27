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
    assert.match(appSource, /this\.currentView === 'contacts' \? `[\s\S]*?id="wechat-offline-friend-settings"/);
    assert.match(appSource, /showOfflineFriendVisibilitySettings\(\)/);
    assert.match(appSource, /包括好友资料、固定形象 Tags 和单聊记录/);
    assert.match(appSource, /群聊记录仍会正常发送/);
    assert.match(cssSource, /#phone-panel-content \.phone-screen \.wechat-offline-friends-overlay/);
    assert.match(cssSource, /\.wechat-offline-friends-list\s*\{[^}]*touch-action:\s*pan-y[^}]*overscroll-behavior:\s*contain/s);
    assert.match(shellSource, /'\.wechat-offline-friends-list'/);
});

test('contacts hidden from offline prompts are visibly dimmed without disabling interaction', () => {
    assert.match(contactsSource, /getOfflinePromptHiddenContactIds/);
    assert.match(contactsSource, /is-offline-prompt-hidden/);
    assert.match(contactsSource, /wechat-contact-offline-hidden-mark[\s\S]*?fa-eye-slash/);
    assert.match(appSource, /\.contact-item\.is-offline-prompt-hidden\s*\{[^}]*opacity:\s*0\.58/s);
    assert.doesNotMatch(appSource, /\.contact-item\.is-offline-prompt-hidden\s*\{[^}]*pointer-events:\s*none/s);
    assert.match(appSource, /this\.currentView === 'contacts' && !this\.currentChat\) this\.render\(\)/);
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

test('offline history construction skips hidden direct chats while retaining groups', () => {
    const hiddenChatHelper = indexSource.indexOf('const isOfflinePromptHiddenSingleChat = (chat) => {');
    const groupGuard = indexSource.indexOf("if (!chat || chat.type === 'group') return false;", hiddenChatHelper);
    const contactIdGuard = indexSource.indexOf('hiddenOfflineContactIds.has(contactId)', groupGuard);
    const chatLoop = indexSource.indexOf('for (const chat of allChats)', contactIdGuard);
    const hiddenChatGuard = indexSource.indexOf('if (isOfflinePromptHiddenSingleChat(chat)) {', chatLoop);
    const messageRead = indexSource.indexOf('wechatDataInstance.getMessages(chat.id)', hiddenChatGuard);

    assert.ok(hiddenChatHelper >= 0);
    assert.ok(groupGuard > hiddenChatHelper);
    assert.ok(contactIdGuard > groupGuard);
    assert.ok(chatLoop > contactIdGuard);
    assert.ok(hiddenChatGuard > chatLoop);
    assert.ok(messageRead > hiddenChatGuard);
});
