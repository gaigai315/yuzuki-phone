import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../phone/floating-entry.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { PHONE_FLOATING_ENTRY_STYLES, PhoneFloatingEntry } = await import(moduleUrl);

test('floating entry exposes nine numbered styles with the renamed assets', () => {
    assert.deepEqual(
        PHONE_FLOATING_ENTRY_STYLES.map(({ label, file }) => ({ label, file })),
        Array.from({ length: 9 }, (_, index) => ({
            label: `样式${index + 1}`,
            file: `phone/sjxf${index + 1}.png`
        }))
    );
});

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

test('floating entry runs press preparation before preventing pointer defaults', () => {
    const listeners = new Map();
    const steps = [];
    const entry = new PhoneFloatingEntry({
        onPressStart: () => steps.push('press-start')
    });
    const button = {
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        getBoundingClientRect() {
            return { left: 10, top: 20 };
        },
        classList: {
            add() {},
            remove() {}
        },
        setPointerCapture() {}
    };

    entry.bindDrag(button);
    listeners.get('pointerdown')({
        button: 0,
        pointerId: 7,
        clientX: 30,
        clientY: 40,
        preventDefault() {
            steps.push('prevent-default');
        },
        stopPropagation() {
            steps.push('stop-propagation');
        }
    });

    assert.deepEqual(steps, ['press-start', 'prevent-default', 'stop-propagation']);
});
