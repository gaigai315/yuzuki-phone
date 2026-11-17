import assert from 'node:assert/strict';
import test from 'node:test';
import { WechatApp } from '../apps/wechat/wechat-app.js';

test('voice fold toggles only visibility, keeps unsaved inputs and binds once', () => {
    const app = Object.create(WechatApp.prototype);
    app.render = app.showEditProfile = () => assert.fail('opening a fold must preserve the existing form');
    const classes = new Set();
    const listeners = [];
    const toggle = {
        attributes: {},
        setAttribute(key, value) { this.attributes[key] = value; },
        addEventListener(type, handler) { listeners.push({ type, handler }); }
    };
    const input = { value: 'unsaved voice ID' };
    const content = {
        hidden: false,
        input,
        attributes: {},
        setAttribute(key, value) { this.attributes[key] = value; }
    };
    const root = {
        classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } },
        querySelector: selector => selector.endsWith('header') ? toggle : content
    };
    app._bindUserTtsFold(root);
    app._bindUserTtsFold(root);
    assert.equal(listeners.length, 1, 'a native button must not also bind Enter/Space to a second toggle');
    assert.equal(listeners[0].type, 'click');
    assert.equal(content.hidden, true);
    assert.equal(toggle.attributes['aria-expanded'], 'false');
    const click = () => listeners[0].handler({ preventDefault() {}, stopPropagation() {} });
    click();
    assert.equal(content.hidden, false);
    assert.equal(content.attributes['aria-hidden'], 'false');
    assert.equal(toggle.attributes['aria-expanded'], 'true');
    assert.equal(classes.has('is-open'), true);
    content.input.value = 'edited before closing';
    click();
    assert.equal(content.hidden, true);
    assert.equal(content.attributes['aria-hidden'], 'true');
    assert.equal(classes.has('is-open'), false);
    click();
    assert.equal(content.input, input);
    assert.equal(content.input.value, 'edited before closing');
});
