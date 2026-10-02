import assert from 'node:assert/strict';
import test from 'node:test';

import { StoryImageAutoScheduler } from '../apps/album/story-image-auto-scheduler.js';

function createTask(overrides = {}) {
    return {
        key: 'story-image:auto:chat-a:3:signature',
        chatId: 'chat-a',
        floor: 3,
        message: { mes: 'A completed assistant floor.' },
        ...overrides
    };
}

function createClock() {
    let current = 0;
    return {
        now: () => current,
        sleep: async (ms) => {
            current += Number(ms) || 0;
        }
    };
}

test('automatic story image tasks do not enqueue while auto mode is disabled', async () => {
    let runCount = 0;
    const scheduler = new StoryImageAutoScheduler({
        getAutoEnabled: () => false,
        runTask: async () => {
            runCount += 1;
        }
    });

    assert.equal(scheduler.enqueue(createTask()), false);
    await scheduler.whenIdle();
    assert.equal(runCount, 0);
});

test('automatic story image waits for background work and a stable idle window', async () => {
    const clock = createClock();
    let pendingChecks = 0;
    let runCount = 0;
    const scheduler = new StoryImageAutoScheduler({
        getAutoEnabled: () => true,
        validateTask: () => true,
        isBackgroundWorkPending: () => {
            pendingChecks += 1;
            return pendingChecks <= 2;
        },
        runTask: async () => {
            runCount += 1;
            return { success: true };
        },
        pollIntervalMs: 10,
        stableIdleMs: 20,
        now: clock.now,
        sleep: clock.sleep
    });

    assert.equal(scheduler.enqueue(createTask()), true);
    await scheduler.whenIdle();

    assert.equal(runCount, 1);
    assert.ok(pendingChecks >= 5);
});

test('duplicate story image events for the same floor run once', async () => {
    const clock = createClock();
    let runCount = 0;
    const scheduler = new StoryImageAutoScheduler({
        getAutoEnabled: () => true,
        validateTask: () => true,
        isBackgroundWorkPending: () => false,
        runTask: async () => {
            runCount += 1;
            return { success: true };
        },
        pollIntervalMs: 10,
        stableIdleMs: 10,
        now: clock.now,
        sleep: clock.sleep
    });
    const task = createTask();

    assert.equal(scheduler.enqueue(task), true);
    assert.equal(scheduler.enqueue(task), false);
    await scheduler.whenIdle();

    assert.equal(runCount, 1);
});

test('foreground generation interrupts the active task and retries it after idle', async () => {
    const clock = createClock();
    let attemptCount = 0;
    let firstAttemptStarted;
    const started = new Promise(resolve => {
        firstAttemptStarted = resolve;
    });
    const scheduler = new StoryImageAutoScheduler({
        getAutoEnabled: () => true,
        validateTask: () => true,
        isBackgroundWorkPending: () => false,
        runTask: async (_task, runtime) => {
            attemptCount += 1;
            if (attemptCount === 1) {
                firstAttemptStarted();
                await new Promise(resolve => {
                    runtime.signal.addEventListener('abort', resolve, { once: true });
                });
                return { success: false, aborted: true };
            }
            return { success: true };
        },
        pollIntervalMs: 10,
        stableIdleMs: 10,
        now: clock.now,
        sleep: clock.sleep
    });

    scheduler.enqueue(createTask());
    await started;
    assert.equal(scheduler.interruptCurrent('foreground-generation', { retry: true }), true);
    await scheduler.whenIdle();

    assert.equal(attemptCount, 2);
});

test('branch invalidation aborts the active floor and removes later queued floors', async () => {
    const clock = createClock();
    let runCount = 0;
    let activeStarted;
    const started = new Promise(resolve => {
        activeStarted = resolve;
    });
    const scheduler = new StoryImageAutoScheduler({
        getAutoEnabled: () => true,
        validateTask: () => true,
        isBackgroundWorkPending: () => false,
        runTask: async (_task, runtime) => {
            runCount += 1;
            activeStarted();
            await new Promise(resolve => {
                runtime.signal.addEventListener('abort', resolve, { once: true });
            });
            return { success: false, aborted: true };
        },
        pollIntervalMs: 10,
        stableIdleMs: 10,
        now: clock.now,
        sleep: clock.sleep
    });

    scheduler.enqueue(createTask());
    scheduler.enqueue(createTask({
        key: 'story-image:auto:chat-a:5:signature',
        floor: 5,
        message: { mes: 'A later floor.' }
    }));
    await started;
    assert.equal(scheduler.invalidateFromFloor('chat-a', 3, 'message-swiped'), true);
    await scheduler.whenIdle();

    assert.equal(runCount, 1);
    assert.equal(scheduler.isPending(), false);
});
