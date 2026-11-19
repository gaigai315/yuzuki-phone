import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCallDuration, startCallTimer } from '../config/call-timer.js';

test('call duration switches to hours at one hour', () => {
    for (const [seconds, expected] of [[0, '00:00'], [1, '00:01'], [673, '11:13'], [3599, '59:59'], [3600, '1:00:00'], [6066, '1:41:06']]) {
        assert.equal(formatCallDuration(seconds), expected);
    }
});

test('delayed ticks catch up and detached calls stop without writing to a replacement', () => {
    const originalSet = globalThis.setInterval;
    const originalClear = globalThis.clearInterval;
    let tick;
    let cleared = false;
    globalThis.setInterval = callback => { tick = callback; return 42; };
    globalThis.clearInterval = id => { assert.equal(id, 42); cleared = true; };
    try {
        let now = 1000;
        let duration = 0;
        const oldElement = { isConnected: true, textContent: '00:00' };
        startCallTimer(oldElement, seconds => { duration = seconds; }, () => now);
        now += 673000;
        tick();
        assert.equal(duration, 673);
        assert.equal(oldElement.textContent, '11:13');
        oldElement.isConnected = false;
        const newElement = { isConnected: true, textContent: '00:00' };
        now += 1000;
        tick();
        assert.equal(cleared, true);
        assert.equal(duration, 673);
        assert.equal(newElement.textContent, '00:00');
    } finally {
        globalThis.setInterval = originalSet;
        globalThis.clearInterval = originalClear;
    }
});


test('story call timer starts at the existing duration before the first tick and continues from it', () => {
    const originalSet = globalThis.setInterval;
    const originalClear = globalThis.clearInterval;
    let tick;
    globalThis.setInterval = callback => { tick = callback; return 42; };
    globalThis.clearInterval = () => {};
    try {
        let now = 1000;
        let duration = -1;
        const element = { isConnected: true, textContent: '00:00' };
        startCallTimer(element, seconds => { duration = seconds; }, () => now, 180);
        assert.equal(element.textContent, '03:00');
        assert.equal(duration, 180, 'instant hangup already has the story duration');
        now += 15000;
        tick();
        assert.equal(element.textContent, '03:15');
        assert.equal(duration, 195);
    } finally { globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; }
});
