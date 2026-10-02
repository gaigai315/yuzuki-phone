import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../phone/floating-entry.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { PhoneFloatingEntry } = await import(moduleUrl);

test('floating entry separates single activation from double activation', () => {
    const scheduled = new Map();
    let nextTimerId = 1;
    let singleActivations = 0;
    let doubleActivations = 0;
    const originalWindow = globalThis.window;

    globalThis.window = {
        setTimeout(callback) {
            const timerId = nextTimerId++;
            scheduled.set(timerId, callback);
            return timerId;
        },
        clearTimeout(timerId) {
            scheduled.delete(timerId);
        }
    };

    try {
        const entry = new PhoneFloatingEntry({
            onActivate: () => { singleActivations += 1; },
            onDoubleActivate: () => { doubleActivations += 1; }
        });

        entry.queueActivation();
        assert.equal(singleActivations, 0);
        assert.equal(doubleActivations, 0);
        assert.equal(scheduled.size, 1);

        const singleCallback = scheduled.values().next().value;
        scheduled.clear();
        singleCallback();
        assert.equal(singleActivations, 1);
        assert.equal(doubleActivations, 0);

        entry.queueActivation();
        entry.queueActivation();
        assert.equal(scheduled.size, 0);
        assert.equal(singleActivations, 1);
        assert.equal(doubleActivations, 1);
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    }
});
