import { DurableObject } from 'cloudflare:workers';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

const QUEUE_STALE_MS = 15 * 60 * 1000;
const ACTIVE_STALE_MS = 8 * 60 * 1000;
const ACTIVE_MAX_MS = 12 * 60 * 1000;

function json(data, init = {}) {
    return new Response(JSON.stringify(data), {
        ...init,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...CORS_HEADERS,
            ...(init.headers || {})
        }
    });
}

async function readJson(request) {
    try {
        return await request.json();
    } catch {
        return {};
    }
}

function normalizeTask(input = {}) {
    const keyHash = String(input.key_hash || input.keyHash || '').trim();
    const userId = String(input.user_id || input.userId || '').trim();
    const taskId = String(input.task_id || input.taskId || '').trim();
    const token = String(input.token || input.queue_token || input.queueToken || input.lock_token || input.lockToken || '').trim();
    const greeting = String(input.greeting || '').trim().slice(0, 15);
    return { keyHash, userId, taskId, token, greeting };
}

export class NaiQueueDO extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.state = ctx;
        this.env = env;
    }

    async fetch(request) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        const url = new URL(request.url);
        const path = url.pathname.replace(/\/+$/, '') || '/';

        try {
            if ((path === '/queue' || path === '/join-queue') && request.method === 'POST') {
                return this.handleQueue(await readJson(request), {
                    heartbeatRequired: path === '/queue'
                });
            }
            if (path === '/my-turn' && request.method === 'GET') {
                return this.handleMyTurn(Object.fromEntries(url.searchParams.entries()));
            }
            if (path === '/heartbeat' && request.method === 'POST') {
                return this.handleHeartbeat(await readJson(request));
            }
            if (path === '/complete' && request.method === 'POST') {
                return this.handleComplete(await readJson(request));
            }
            if (path === '/leave-queue' && request.method === 'POST') {
                return this.handleLeave(await readJson(request));
            }
            if (path === '/' || path === '/health') {
                return json({
                    ok: true,
                    service: 'yuzuki-nai-queue',
                    protocols: ['yuzuki-phone', 'st-chatu8']
                });
            }
            return json({ success: false, error: 'Not found' }, { status: 404 });
        } catch (error) {
            return json({ success: false, error: error?.message || 'Queue worker error' }, { status: 500 });
        }
    }

    async loadState() {
        const saved = await this.state.storage.get('queue_state');
        const state = saved && typeof saved === 'object' ? saved : {};
        return {
            queue: Array.isArray(state.queue) ? state.queue : [],
            active: state.active && typeof state.active === 'object' ? state.active : null
        };
    }

    async saveState(state) {
        await this.state.storage.put('queue_state', state);
    }

    cleanup(state) {
        const now = Date.now();
        state.queue = state.queue.filter(item => {
            const updatedAt = Number(item.updatedAt || item.createdAt || 0);
            return updatedAt && now - updatedAt <= QUEUE_STALE_MS;
        });

        if (state.active) {
            const activeAt = Number(state.active.activeAt || state.active.updatedAt || 0);
            const startedAt = Number(state.active.startedAt || activeAt || 0);
            const activeStillQueued = state.queue.some(item => item.taskId === state.active.taskId);
            const heartbeatRequired = state.active.heartbeatRequired !== false;
            const leaseExpired = heartbeatRequired && (!activeAt || now - activeAt > ACTIVE_STALE_MS);
            const exceededMaximum = !startedAt || now - startedAt > ACTIVE_MAX_MS;
            if (leaseExpired || exceededMaximum || !activeStillQueued) {
                const abandonedTaskId = state.active.taskId;
                state.queue = state.queue.filter(item => item.taskId !== abandonedTaskId);
                state.active = null;
            }
        }
    }

    promote(state) {
        if (state.active || state.queue.length === 0) return;
        const first = state.queue[0];
        const token = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
        state.active = {
            taskId: first.taskId,
            userId: first.userId,
            token,
            greeting: first.greeting || '',
            heartbeatRequired: first.heartbeatRequired !== false,
            activeAt: Date.now(),
            startedAt: Date.now()
        };
        first.token = token;
        first.updatedAt = Date.now();
    }

    buildStatus(state, taskId, token = '') {
        const index = state.queue.findIndex(item => item.taskId === taskId);
        const active = state.active && state.active.taskId === taskId;
        const resolvedToken = active ? (state.active.token || token || '') : (token || '');
        const activeEntry = state.active
            ? state.queue.find(item => item.taskId === state.active.taskId)
            : null;
        return {
            success: true,
            can_run: !!active,
            is_my_turn: !!active,
            queued: index >= 0,
            token: resolvedToken,
            queue_token: resolvedToken,
            lock_token: resolvedToken,
            position: index >= 0 ? index : null,
            queue_size: state.queue.length,
            current_greeting: activeEntry?.greeting || null
        };
    }

    async handleQueue(input, { heartbeatRequired = true } = {}) {
        const task = normalizeTask(input);
        if (!task.keyHash || !task.userId || !task.taskId) {
            return json({ success: false, error: 'Missing key_hash, user_id or task_id' }, { status: 400 });
        }

        const state = await this.loadState();
        this.cleanup(state);

        const now = Date.now();
        const supersededTaskIds = new Set(
            state.queue
                .filter(item => item.userId === task.userId && item.taskId !== task.taskId)
                .map(item => item.taskId)
        );
        if (supersededTaskIds.size > 0) {
            state.queue = state.queue.filter(item => !supersededTaskIds.has(item.taskId));
            if (state.active && supersededTaskIds.has(state.active.taskId)) {
                state.active = null;
            }
        }

        let existing = state.queue.find(item => item.taskId === task.taskId);
        if (!existing) {
            existing = {
                keyHash: task.keyHash,
                userId: task.userId,
                taskId: task.taskId,
                greeting: task.greeting,
                heartbeatRequired,
                createdAt: now,
                updatedAt: now
            };
            state.queue.push(existing);
        } else {
            existing.updatedAt = now;
            existing.greeting = task.greeting;
            existing.heartbeatRequired = heartbeatRequired;
        }

        if (state.active?.taskId === task.taskId) {
            state.active.greeting = task.greeting;
            state.active.heartbeatRequired = heartbeatRequired;
        }

        this.promote(state);
        await this.saveState(state);
        return json(this.buildStatus(state, task.taskId, existing.token || task.token));
    }

    async handleMyTurn(input) {
        const task = normalizeTask(input);
        if (!task.taskId) {
            return json({ success: false, error: 'Missing task_id' }, { status: 400 });
        }

        const state = await this.loadState();
        this.cleanup(state);

        const existing = state.queue.find(item => item.taskId === task.taskId);
        if (existing) {
            existing.updatedAt = Date.now();
        }

        this.promote(state);
        await this.saveState(state);
        return json(this.buildStatus(state, task.taskId, existing?.token || task.token));
    }

    async handleHeartbeat(input) {
        const task = normalizeTask(input);
        if (!task.taskId || !task.token) {
            return json({ success: false, error: 'Missing task_id or token' }, { status: 400 });
        }

        const state = await this.loadState();
        this.cleanup(state);

        const isActive = state.active
            && state.active.taskId === task.taskId
            && state.active.token === task.token;
        if (!isActive) {
            this.promote(state);
            await this.saveState(state);
            return json({ success: false, error: 'Queue lease is no longer active' }, { status: 409 });
        }

        const now = Date.now();
        state.active.activeAt = now;
        const existing = state.queue.find(item => item.taskId === task.taskId);
        if (existing) existing.updatedAt = now;
        await this.saveState(state);
        return json(this.buildStatus(state, task.taskId, task.token));
    }

    async handleComplete(input) {
        const task = normalizeTask(input);
        const state = await this.loadState();
        this.cleanup(state);

        const isActive = state.active
            && state.active.taskId === task.taskId
            && (!state.active.token || !task.token || state.active.token === task.token);

        state.queue = state.queue.filter(item => item.taskId !== task.taskId);
        if (isActive) state.active = null;
        this.promote(state);
        await this.saveState(state);
        return json({ success: true });
    }

    async handleLeave(input) {
        const task = normalizeTask(input);
        const state = await this.loadState();
        this.cleanup(state);

        state.queue = state.queue.filter(item => item.taskId !== task.taskId);
        if (state.active?.taskId === task.taskId) {
            state.active = null;
        }
        this.promote(state);
        await this.saveState(state);
        return json({ success: true });
    }
}

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        if (!env.NAI_QUEUE_DO) {
            return json({
                success: false,
                error: 'Missing Durable Object binding NAI_QUEUE_DO'
            }, { status: 500 });
        }

        const url = new URL(request.url);
        const keyHash = request.method === 'GET'
            ? String(url.searchParams.get('key_hash') || url.searchParams.get('keyHash') || 'default').trim()
            : 'default';

        let body = null;
        if (request.method === 'POST') {
            body = await request.clone().json().catch(() => ({}));
        }

        const normalized = normalizeTask(body || Object.fromEntries(url.searchParams.entries()));
        const objectName = normalized.keyHash || keyHash || 'default';
        const id = env.NAI_QUEUE_DO.idFromName(objectName);
        const stub = env.NAI_QUEUE_DO.get(id);
        return stub.fetch(request);
    }
};
