import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatView } from '../apps/wechat/chat-view.js';

for (const answer of [null, '新描述']) {
    test(`closing emoji edit with ${answer === null ? 'cancel' : 'confirm'} ignores duplicate events`, async () => {
        const previousWindow = globalThis.window;
        const originalNow = Date.now;
        let now = 10000;
        let prompts = 0;
        let updates = 0;
        let renders = 0;
        const view = Object.create(ChatView.prototype);
        view.app = {
            wechatData: {
                getCustomEmoji: () => ({ name: '表情', description: '旧描述' }),
                updateCustomEmoji: () => { updates++; }
            },
            phoneShell: { showNotification() {} },
            render: () => { renders++; }
        };
        Date.now = () => now;
        globalThis.window = { prompt: () => {
            prompts++;
            // A reentrant event while the native prompt is open is ignored.
            void view.manageCustomEmoji('emoji');
            return answer;
        } };
        try {
            await view.manageCustomEmoji('emoji');
            await view.manageCustomEmoji('emoji');
            assert.equal(prompts, 1);
            assert.equal(updates, answer === null ? 0 : 1);
            assert.equal(renders, answer === null ? 0 : 1);
            assert.equal(view._customEmojiManageBusy, false);
            now += 601;
            await view.manageCustomEmoji('emoji');
            assert.equal(prompts, 2, 'a later intentional edit remains available');
        } finally {
            Date.now = originalNow;
            globalThis.window = previousWindow;
        }
    });
}

test('renaming from the label saves the name and updates only that sticker', async () => {
    const previousWindow = globalThis.window;
    const image = { alt: '旧名字' };
    const item = { title: '旧名字', querySelector: () => image };
    const attributes = {};
    const button = {
        textContent: '旧名字',
        setAttribute: (key, value) => { attributes[key] = value; },
        closest: () => item
    };
    let savedPatch;
    const view = Object.create(ChatView.prototype);
    view.app = {
        wechatData: {
            getCustomEmoji: () => ({ name: '旧名字', description: '旧描述' }),
            updateCustomEmoji: (id, patch) => { assert.equal(id, 'emoji'); savedPatch = patch; }
        },
        phoneShell: { showNotification() {} },
        render: () => assert.fail('renaming must preserve the chat input and panel scroll position')
    };
    globalThis.window = { prompt: () => '  新名字  ' };
    try {
        await view.manageCustomEmoji('emoji', { nameButton: button });
        assert.deepEqual(savedPatch, { name: '新名字', description: '新名字' });
        assert.equal(button.textContent, '新名字');
        assert.equal(attributes['aria-label'], '修改表情名字：新名字');
        assert.equal(item.title, '新名字');
        assert.equal(image.alt, '新名字');
    } finally {
        globalThis.window = previousWindow;
    }
});


test('switching emoji tabs replaces only the panel and binds the new tabs', () => {
    const previousDocument = globalThis.document;
    const view = Object.create(ChatView.prototype);
    let replacements = 0;
    let selectionResets = 0;
    const makePanel = () => {
        const tabs = ['default', 'custom'].map(tab => ({
            dataset: { tab },
            listeners: {},
            addEventListener(type, handler) { this.listeners[type] = handler; }
        }));
        const groups = ['default', 'avatar'].map(group => ({
            dataset: { group },
            listeners: {},
            addEventListener(type, handler) { this.listeners[type] = handler; }
        }));
        return {
            tabs,
            groups,
            querySelectorAll: selector => selector === '.emoji-tab' ? tabs : selector === '.wechat-emoji-group' ? groups : [],
            replaceWith(next) { replacements++; panel = next; }
        };
    };
    let panel = makePanel();
    const input = { value: 'unfinished draft' };
    const messages = { scrollTop: 127 };
    const currentView = {
        querySelector: selector => ({ '.emoji-panel': panel, '#chat-input': input, '#chat-messages': messages }[selector] || null)
    };
    view.getCurrentWechatView = () => currentView;
    view.app = { render: () => assert.fail('tab switching must not render the chat') };
    view.showEmoji = true;
    view.emojiTab = 'default';
    view.renderEmojiPanel = () => '<div class="emoji-panel"></div>';
    view._setCustomEmojiSelectionMode = value => { assert.equal(value, false); selectionResets++; };
    globalThis.document = {
        createElement: tag => {
            assert.equal(tag, 'template');
            return { content: { firstElementChild: makePanel() } };
        }
    };
    try {
        view._bindEmojiPanelEvents();
        const clickedTab = panel.tabs[1];
        clickedTab.listeners.click();
        // The old tab has been detached, but the bubbling click retains its original path.
        clickedTab.closest = () => null;
        view._handleTransientInputPanelOutsideClick({
            target: clickedTab,
            composedPath: () => [clickedTab, { matches: () => true }, currentView]
        });
        assert.equal(view.showEmoji, true, 'the tab click must leave the panel open');
        assert.equal(view.emojiTab, 'custom');
        assert.equal(replacements, 1);
        panel.tabs[1].listeners.click();
        assert.equal(replacements, 1, 'active tab is a no-op');
        panel.tabs[0].listeners.keydown({ key: 'Enter', preventDefault() {} });
        assert.equal(view.emojiTab, 'default');
        assert.equal(replacements, 2);
        assert.equal(selectionResets, 1);
        panel.tabs[1].listeners.click();
        for (const [index, expectedGroup] of [[1, 'avatar'], [0, 'default']]) {
            const clickedGroup = panel.groups[index];
            clickedGroup.listeners.click();
            clickedGroup.closest = () => null;
            view._handleTransientInputPanelOutsideClick({
                target: clickedGroup,
                composedPath: () => [clickedGroup, { matches: () => true }, currentView]
            });
            assert.equal(view.customEmojiGroup, expectedGroup);
            assert.equal(view.showEmoji, true, 'switching groups must leave the panel open');
        }
        assert.equal(currentView.querySelector('#chat-input'), input);
        assert.equal(input.value, 'unfinished draft');
        assert.equal(currentView.querySelector('#chat-messages'), messages);
        assert.equal(messages.scrollTop, 127);
    } finally {
        globalThis.document = previousDocument;
    }
});

test('outside clicks still close input panels, while attached controls remain exempt without composedPath', () => {
    const view = Object.create(ChatView.prototype);
    view.showEmoji = true;
    let collapses = 0;
    view._collapseTransientInputPanels = options => {
        assert.equal(options.render, true);
        collapses++;
        view.showEmoji = false;
    };
    view._handleTransientInputPanelOutsideClick({ target: { closest: () => ({}) } });
    assert.equal(collapses, 0);
    view._handleTransientInputPanelOutsideClick({
        target: { closest: () => null },
        composedPath: () => [{ matches: () => false }]
    });
    assert.equal(collapses, 1);
    assert.equal(view.showEmoji, false);
    view._handleTransientInputPanelOutsideClick({ target: {} });
    assert.equal(collapses, 1, 'closed panels need no further work');
});
