/* ========================================================
 *  柚月小手机 - 正文自动生图调度器
 *  Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

export class StoryImageAutoScheduler {
    constructor(options = {}) {
        this.getAutoEnabled = options.getAutoEnabled || (() => false);
        this.isBackgroundWorkPending = options.isBackgroundWorkPending || (() => false);
        this.validateTask = options.validateTask || (() => true);
        this.runTask = options.runTask || (async () => ({ skipped: true }));
        this.logger = options.logger || console;
        this.pollIntervalMs = Math.max(10, Number(options.pollIntervalMs) || 500);
        this.stableIdleMs = Math.max(0, Number(options.stableIdleMs) || 2600);
        this.now = options.now || (() => Date.now());
        this.sleep = options.sleep || ((ms, signal) => this._defaultSleep(ms, signal));

        this.queue = [];
        this.queuedKeys = new Set();
        this.generation = 0;
        this.workerPromise = null;
        this.activeTask = null;
        this.activeController = null;
        this.activeRetryRequested = false;
    }

    enqueue(task = {}) {
        const normalized = this._normalizeTask(task);
        if (!normalized || !this._isEnabled() || !this._isTaskValid(normalized)) return false;
        if (this.queuedKeys.has(normalized.key) || this.activeTask?.key === normalized.key) return false;

        this.queue = this.queue.filter(existing => {
            const replace = existing.chatId === normalized.chatId && existing.floor === normalized.floor;
            if (replace) this.queuedKeys.delete(existing.key);
            return !replace;
        });
        normalized.generation = this.generation;
        this.queue.push(normalized);
        this.queuedKeys.add(normalized.key);
        this._ensureWorker();
        return true;
    }

    interruptCurrent(reason = 'interrupted', options = {}) {
        if (!this.activeController || this.activeController.signal.aborted) return false;
        this.activeRetryRequested = options.retry === true;
        this.activeController.abort(reason);
        return true;
    }

    invalidateFromFloor(chatId, floor, reason = 'branch-changed') {
        const safeChatId = String(chatId || '').trim();
        const safeFloor = Number.parseInt(String(floor), 10);
        if (!safeChatId || !Number.isInteger(safeFloor)) return false;

        let changed = false;
        this.queue = this.queue.filter(task => {
            const remove = task.chatId === safeChatId && task.floor >= safeFloor;
            if (remove) {
                this.queuedKeys.delete(task.key);
                changed = true;
            }
            return !remove;
        });
        if (this.activeTask?.chatId === safeChatId && this.activeTask.floor >= safeFloor) {
            changed = this.interruptCurrent(reason, { retry: false }) || changed;
        }
        return changed;
    }

    reset(reason = 'reset') {
        this.generation += 1;
        this.queue = [];
        this.queuedKeys.clear();
        this.interruptCurrent(reason, { retry: false });
    }

    isPending() {
        return this.queue.length > 0 || Boolean(this.activeTask);
    }

    async whenIdle() {
        await this.workerPromise;
    }

    _normalizeTask(task) {
        const key = String(task?.key || '').trim();
        const chatId = String(task?.chatId || '').trim();
        const floor = Number.parseInt(String(task?.floor), 10);
        if (!key || !chatId || !Number.isInteger(floor) || floor < 0 || !task?.message) return null;
        return { ...task, key, chatId, floor };
    }

    _isEnabled() {
        try {
            return this.getAutoEnabled() === true;
        } catch (error) {
            this.logger?.warn?.('[StoryImageAuto] 读取自动生图设置失败:', error);
            return false;
        }
    }

    _isTaskValid(task) {
        try {
            return this.validateTask(task) !== false;
        } catch (error) {
            this.logger?.warn?.('[StoryImageAuto] 校验正文楼层失败:', error);
            return false;
        }
    }

    _ensureWorker() {
        if (this.workerPromise) return this.workerPromise;
        this.workerPromise = this._drainQueue().finally(() => {
            this.workerPromise = null;
            if (this.queue.length > 0) this._ensureWorker();
        });
        return this.workerPromise;
    }

    async _drainQueue() {
        while (this.queue.length > 0) {
            const task = this.queue.shift();
            this.queuedKeys.delete(task.key);
            if (task.generation !== this.generation || !this._isEnabled() || !this._isTaskValid(task)) continue;

            const controller = new AbortController();
            this.activeTask = task;
            this.activeController = controller;
            this.activeRetryRequested = false;
            let result = null;
            try {
                const ready = await this._waitForStableIdle(task, controller.signal);
                if (!ready) continue;
                result = await this.runTask(task, {
                    signal: controller.signal,
                    isStillValid: () => this._isEnabled() && this._isTaskValid(task)
                });
            } catch (error) {
                if (!controller.signal.aborted) {
                    this.logger?.warn?.('[StoryImageAuto] 自动正文生图任务失败:', error);
                }
            } finally {
                const retry = (this.activeRetryRequested || result?.retry === true)
                    && task.generation === this.generation
                    && this._isEnabled()
                    && this._isTaskValid(task);
                this.activeTask = null;
                this.activeController = null;
                this.activeRetryRequested = false;
                if (retry) this.enqueue(task);
            }
        }
    }

    async _waitForStableIdle(task, signal) {
        let idleSince = null;
        while (!signal.aborted) {
            if (task.generation !== this.generation || !this._isEnabled() || !this._isTaskValid(task)) return false;

            let busy = true;
            try {
                busy = await this.isBackgroundWorkPending(task);
            } catch (error) {
                this.logger?.warn?.('[StoryImageAuto] 读取后台任务状态失败:', error);
            }

            if (busy) {
                idleSince = null;
            } else if (idleSince === null) {
                idleSince = this.now();
            } else if ((this.now() - idleSince) >= this.stableIdleMs) {
                return true;
            }
            await this.sleep(this.pollIntervalMs, signal);
        }
        return false;
    }

    _defaultSleep(ms, signal) {
        if (signal?.aborted) return Promise.resolve();
        return new Promise(resolve => {
            const timer = setTimeout(done, Math.max(0, Number(ms) || 0));
            const onAbort = () => done();
            function done() {
                clearTimeout(timer);
                signal?.removeEventListener?.('abort', onAbort);
                resolve();
            }
            signal?.addEventListener?.('abort', onAbort, { once: true });
        });
    }
}
