import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const start = source.indexOf('const restorePhoneStyleOrder = () => {');
const end = source.indexOf('const scheduleRestore =', start);
const restoreSource = source.slice(start, end).replace('const restorePhoneStyleOrder =', 'return');

test('phone CSS priority restoration is idle until stylesheet order actually changes', () => {
    const head = {
        children: [], moves: 0,
        appendChild(node) {
            const index = this.children.indexOf(node);
            if (index >= 0) this.children.splice(index, 1);
            this.children.push(node);
            node.parentNode = this;
            this.moves++;
        }
    };
    const node = (id, isStyle = true) => ({ id, matches: () => isStyle, parentNode: head });
    const global = node('st-phone-global-css');
    const wechat = node('wechat-styles');
    const guard = node('st-phone-css-isolation-guard');
    const external = node('host-theme');
    const script = node('host-script', false);
    head.children = [external, global, wechat, guard, script];
    const document = { getElementById: id => head.children.find(item => item.id === id) };
    const restore = new Function('document', 'head', `let _phoneCssIsolationFrame; ${restoreSource}`)(document, head);

    restore();
    restore();
    assert.equal(head.moves, 0, 'reopening must leave correctly ordered styles attached');
    head.appendChild(node('new-host-theme'));
    head.moves = 0;
    restore();
    assert.equal(head.moves, 3, 'a later host stylesheet must restore phone priority');
    assert.deepEqual(head.children.slice(-3), [global, wechat, guard]);
    head.moves = 0;
    restore();
    assert.equal(head.moves, 0, 'observer follow-ups must settle without more moves');
});
