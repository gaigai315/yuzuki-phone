import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../phone/floating-entry.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const {
    getPhoneFloatingEntryReceiptFile,
    PHONE_FLOATING_ENTRY_STYLES,
    PhoneFloatingEntry
} = await import(moduleUrl);

test('floating entry exposes nine numbered styles with the renamed assets', () => {
    assert.deepEqual(
        PHONE_FLOATING_ENTRY_STYLES.map(({ label, file, receiptFile }) => ({ label, file, receiptFile })),
        Array.from({ length: 9 }, (_, index) => ({
            label: `样式${index + 1}`,
            file: `phone/sjxf${index + 1}.png`,
            receiptFile: `phone/sjxf${index + 1}_xp.png`
        }))
    );
});

test('floating entry receipt asset follows the selected style with a silver fallback', () => {
    assert.equal(getPhoneFloatingEntryReceiptFile('gold'), 'phone/sjxf1_xp.png');
    assert.equal(getPhoneFloatingEntryReceiptFile('style-9'), 'phone/sjxf9_xp.png');
    assert.equal(getPhoneFloatingEntryReceiptFile('unknown'), 'phone/sjxf4_xp.png');
});

test('floating entry visibility correction is event-driven instead of polling', () => {
    assert.doesNotMatch(source, /setInterval\(\(\) => this\.ensureVisible/);
    assert.match(source, /addEventListener\('resize', reposition/);
    assert.match(source, /visualViewport\?\.addEventListener\?\.\('scroll', reposition/);
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

test('floating entry prepares focus only after the gesture resolves to an activation', () => {
    const scheduled = new Map();
    let nextTimerId = 1;
    const steps = [];
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
            onBeforeActivate: () => steps.push('before-activate'),
            onActivate: () => steps.push('single-activate'),
            onDoubleActivate: () => steps.push('double-activate')
        });

        entry.queueActivation();
        assert.deepEqual(steps, []);
        const singleCallback = scheduled.values().next().value;
        scheduled.clear();
        singleCallback();
        assert.deepEqual(steps, ['before-activate', 'single-activate']);

        steps.length = 0;
        entry.queueActivation();
        entry.queueActivation();
        assert.deepEqual(steps, ['before-activate', 'double-activate']);
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    }
});

test('floating entry does not prepare focus or enter drag styling on pointer down', () => {
    const listeners = new Map();
    const steps = [];
    const entry = new PhoneFloatingEntry({
        onBeforeActivate: () => steps.push('before-activate')
    });
    entry.applyPosition = () => steps.push('apply-position');
    const button = {
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        getBoundingClientRect() {
            return { left: 10, top: 20 };
        },
        classList: {
            add(className) {
                steps.push(`add:${className}`);
            },
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

    assert.deepEqual(steps, ['prevent-default', 'stop-propagation']);

    listeners.get('pointermove')({
        pointerId: 7,
        clientX: 39,
        clientY: 40,
        preventDefault() {
            steps.push('move-prevent-default');
        }
    });

    assert.deepEqual(steps, [
        'prevent-default',
        'stop-propagation',
        'add:phone-floating-entry-dragging',
        'move-prevent-default',
        'apply-position'
    ]);
});

test('dragging cancels a single activation that is still waiting for a second tap', () => {
    const listeners = new Map();
    const scheduled = new Map();
    let nextTimerId = 1;
    let singleActivations = 0;
    const originalWindow = globalThis.window;

    globalThis.window = {
        innerWidth: 400,
        innerHeight: 800,
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
            onActivate: () => { singleActivations += 1; }
        });
        entry.applyPosition = () => {};
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
        entry.queueActivation();
        assert.equal(scheduled.size, 1);

        listeners.get('pointerdown')({
            button: 0,
            pointerId: 9,
            clientX: 30,
            clientY: 40,
            preventDefault() {},
            stopPropagation() {}
        });
        listeners.get('pointermove')({
            pointerId: 9,
            clientX: 40,
            clientY: 40,
            preventDefault() {}
        });

        assert.equal(scheduled.size, 0);
        assert.equal(singleActivations, 0);
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    }
});
