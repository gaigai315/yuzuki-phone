import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs
    .readFileSync(new URL('../workers/nai-queue-worker.js', import.meta.url), 'utf8')
    .replace(
        "import { DurableObject } from 'cloudflare:workers';",
        'class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }'
    );
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { NaiQueueDO } = await import(moduleUrl);

function createQueue() {
    const values = new Map();
    const ctx = {
        storage: {
            async get(key) {
                return values.get(key);
            },
            async put(key, value) {
                values.set(key, structuredClone(value));
            },
        },
    };
    return new NaiQueueDO(ctx, {});
}

async function request(queue, path, { method = 'GET', body } = {}) {
    const response = await queue.fetch(new Request(`https://queue.test${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    }));
    return {
        status: response.status,
        body: await response.json(),
    };
}

test('ST-Chatu8 and Yuzuki Phone share one queue for the same key hash', async () => {
    const queue = createQueue();
    const keyHash = 'same-nai-key-hash';

    const chatu8Join = await request(queue, '/join-queue', {
        method: 'POST',
        body: {
            key_hash: keyHash,
            user_id: 'chatu8-user',
            task_id: 'chatu8-task',
            greeting: '智绘姬生成中',
        },
    });

    assert.equal(chatu8Join.status, 200);
    assert.equal(chatu8Join.body.position, 0);
    assert.equal(chatu8Join.body.is_my_turn, true);
    assert.equal(chatu8Join.body.can_run, true);
    assert.ok(chatu8Join.body.lock_token);
    assert.equal(chatu8Join.body.lock_token, chatu8Join.body.token);

    const phoneJoin = await request(queue, '/queue', {
        method: 'POST',
        body: {
            key_hash: keyHash,
            user_id: 'phone-user',
            task_id: 'phone-task',
        },
    });

    assert.equal(phoneJoin.status, 200);
    assert.equal(phoneJoin.body.position, 1);
    assert.equal(phoneJoin.body.can_run, false);
    assert.equal(phoneJoin.body.is_my_turn, false);
    assert.equal(phoneJoin.body.current_greeting, '智绘姬生成中');

    const chatu8Complete = await request(queue, '/complete', {
        method: 'POST',
        body: {
            key_hash: keyHash,
            user_id: 'chatu8-user',
            task_id: 'chatu8-task',
            lock_token: chatu8Join.body.lock_token,
        },
    });

    assert.equal(chatu8Complete.status, 200);
    assert.equal(chatu8Complete.body.success, true);

    const phoneTurn = await request(
        queue,
        `/my-turn?key_hash=${keyHash}&user_id=phone-user&task_id=phone-task`
    );

    assert.equal(phoneTurn.status, 200);
    assert.equal(phoneTurn.body.position, 0);
    assert.equal(phoneTurn.body.can_run, true);
    assert.equal(phoneTurn.body.is_my_turn, true);
    assert.ok(phoneTurn.body.token);
    assert.equal(phoneTurn.body.lock_token, phoneTurn.body.token);
});

test('legacy phone token and ST-Chatu8 lock token are both accepted', async () => {
    const queue = createQueue();
    const joined = await request(queue, '/join-queue', {
        method: 'POST',
        body: {
            key_hash: 'token-alias-key',
            user_id: 'chatu8-user',
            task_id: 'chatu8-task',
        },
    });

    const completed = await request(queue, '/complete', {
        method: 'POST',
        body: {
            key_hash: 'token-alias-key',
            user_id: 'chatu8-user',
            task_id: 'chatu8-task',
            lock_token: joined.body.lock_token,
        },
    });

    assert.equal(completed.status, 200);
    assert.equal(completed.body.success, true);
});

test('a new task from the same user does not release the active NovelAI lease', async () => {
    const queue = createQueue();
    const first = await request(queue, '/queue', {
        method: 'POST',
        body: {
            key_hash: 'same-user-key',
            user_id: 'phone-user',
            task_id: 'first-task',
        },
    });
    assert.equal(first.body.can_run, true);

    const second = await request(queue, '/queue', {
        method: 'POST',
        body: {
            key_hash: 'same-user-key',
            user_id: 'phone-user',
            task_id: 'second-task',
        },
    });
    assert.equal(second.body.can_run, false);
    assert.equal(second.body.position, 1);

    const firstStillActive = await request(
        queue,
        '/my-turn?key_hash=same-user-key&user_id=phone-user&task_id=first-task'
    );
    assert.equal(firstStillActive.body.can_run, true);
    assert.equal(firstStillActive.body.token, first.body.token);

    await request(queue, '/complete', {
        method: 'POST',
        body: {
            key_hash: 'same-user-key',
            user_id: 'phone-user',
            task_id: 'first-task',
            token: first.body.token,
        },
    });

    const secondTurn = await request(
        queue,
        '/my-turn?key_hash=same-user-key&user_id=phone-user&task_id=second-task'
    );
    assert.equal(secondTurn.body.can_run, true);
    assert.ok(secondTurn.body.token);
});
