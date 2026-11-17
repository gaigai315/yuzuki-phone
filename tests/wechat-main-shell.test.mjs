import assert from 'node:assert/strict';
import test from 'node:test';
import { patchWechatMainShell } from '../phone/wechat-main-shell.js';

class Element {
    constructor(className, attrs = {}, children = []) {
        this.nodeType = 1;
        this.nodeName = 'DIV';
        this.values = new Map(Object.entries({ class: className, ...attrs }));
        this.childNodes = [];
        for (const child of children) this.appendChild(child);
    }
    get attributes() { return Array.from(this.values, ([name, value]) => ({ name, value })); }
    get children() { return this.childNodes; }
    get classList() { return { contains: name => this.getAttribute('class').split(' ').includes(name) }; }
    hasAttribute(name) { return this.values.has(name); }
    getAttribute(name) { return this.values.get(name) ?? null; }
    setAttribute(name, value) { this.values.set(name, value); }
    removeAttribute(name) { this.values.delete(name); }
    appendChild(node) { node.parent = this; this.childNodes.push(node); }
    remove() { this.parent.childNodes.splice(this.parent.childNodes.indexOf(this), 1); }
    replaceWith(node) {
        const parent = this.parent;
        parent.childNodes.splice(parent.childNodes.indexOf(this), 1, node);
        node.parent = parent;
        this.parent = null;
    }
    cloneNode() {
        return new Element(this.getAttribute('class'), Object.fromEntries(this.values), this.children.map(child => child.cloneNode(true)));
    }
}

function shell(page) {
    return new Element('wechat-app wechat-main-shell', {
        'data-wechat-main-view': page, style: 'background-image:url(/backgrounds/test.png)'
    }, [
        new Element('wechat-header', { 'data-title': page }, [new Element('back-button')]),
        new Element('wechat-content', { 'data-page': page }),
        new Element('wechat-tabbar', {}, ['chats', 'contacts', 'discover', 'me'].map(name => (
            new Element(`wechat-tab${page === name ? ' active' : ''}`, { 'data-view': name }, [new Element('icon')])
        )))
    ]);
}

test('repeated tab changes preserve wallpaper, header, navigation icons and event handlers', () => {
    const root = shell('chats');
    const header = root.children[0];
    const tabbar = root.children[2];
    const icons = tabbar.children.map(tab => tab.children[0]);
    const handler = () => {};
    header.children[0].onclick = handler;
    for (const page of ['contacts', 'discover', 'me', 'chats', 'discover']) {
        const next = shell(page);
        const nextContent = next.children[1];
        assert.equal(patchWechatMainShell(root, next), true);
        assert.equal(root.children[0], header);
        assert.equal(root.children[1], nextContent);
        assert.equal(root.children[2], tabbar);
        assert.equal(header.children[0].onclick, handler);
        assert.equal(header.getAttribute('data-title'), page);
        assert.equal(root.getAttribute('style'), 'background-image:url(/backgrounds/test.png)');
        tabbar.children.forEach((tab, index) => {
            assert.equal(tab.children[0], icons[index]);
            assert.equal(tab.classList.contains('active'), tab.getAttribute('data-view') === page);
        });
    }
});

test('same page refreshes and non-main screens fall back without partial mutation', () => {
    const root = shell('chats');
    const content = root.children[1];
    assert.equal(patchWechatMainShell(root, shell('chats')), false);
    assert.equal(patchWechatMainShell(root, shell('wallet')), false);
    const malformed = shell('contacts');
    malformed.children.pop();
    assert.equal(patchWechatMainShell(root, malformed), false);
    assert.equal(root.children[1], content);
    assert.equal(root.getAttribute('data-wechat-main-view'), 'chats');
});
