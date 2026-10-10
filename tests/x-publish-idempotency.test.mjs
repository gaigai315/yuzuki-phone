import assert from 'node:assert/strict';
import test from 'node:test';

import { XData } from '../apps/x/x-data.js';
import { XView } from '../apps/x/x-view.js';

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    get(key, fallback = null) {
        return this.values.has(key) ? this.values.get(key) : fallback;
    }

    set(key, value) {
        this.values.set(key, value);
    }
}

test('X preserved DOM roots do not accumulate duplicate event listeners', () => {
    const view = new XView({
        xData: new XData(new MemoryStorage()),
        phoneShell: { setContent() {} }
    });
    view.currentPage = 'unknown';

    let composeListenerCount = 0;
    const composeButton = {
        addEventListener(type) {
            if (type === 'click') composeListenerCount += 1;
        }
    };
    const root = {
        querySelector(selector) {
            return selector === '.xapp-compose-button' ? composeButton : null;
        },
        querySelectorAll() {
            return [];
        }
    };

    view.bindEvents(root);
    view.bindEvents(root);

    assert.equal(composeListenerCount, 1);
});

test('X compose publishing accepts only one submission per compose session', () => {
    const data = new XData(new MemoryStorage());
    const notifications = [];
    const view = new XView({
        xData: data,
        phoneShell: {
            showNotification(...args) {
                notifications.push(args);
            }
        }
    });
    const textarea = { value: 'Only one post per compose session' };
    const publishButton = { disabled: false };
    const root = {
        querySelector(selector) {
            if (selector === '#xapp-compose-text') return textarea;
            if (selector === '.xapp-compose-publish') return publishButton;
            return null;
        }
    };
    let reactionCount = 0;
    view.render = () => {};
    view.triggerXAIReaction = async () => {
        reactionCount += 1;
    };

    const first = view.publishComposePost(root);
    const duplicate = view.publishComposePost(root);

    assert.ok(first);
    assert.equal(duplicate, null);
    assert.equal(data.getUserPosts().length, 1);
    assert.equal(reactionCount, 1);
    assert.equal(publishButton.disabled, true);
    assert.equal(notifications.length, 1);
});
