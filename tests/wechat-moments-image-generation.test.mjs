import assert from 'node:assert/strict';
import test from 'node:test';

import { MomentsView } from '../apps/wechat/moments-view.js';

function createFixture(state = {}) {
    let saveCount = 0;
    let refreshCount = 0;
    let notificationCount = 0;
    const moment = {
        id: 'moment-a',
        name: '好友A',
        images: ['[图片]（晚霞）（sunset sky）'],
        imageGenerationStates: [{
            status: 'loading',
            generationId: 'old-generation',
            prompt: 'sunset sky',
            description: '晚霞',
            ...state
        }]
    };
    const app = {
        storage: {},
        wechatData: {
            getMoments: () => [moment],
            async saveData() {
                saveCount += 1;
            }
        },
        phoneShell: {
            showNotification() {
                notificationCount += 1;
            }
        }
    };
    const view = new MomentsView(app);
    view._refreshMomentImageUI = () => {
        refreshCount += 1;
    };
    return {
        view,
        moment,
        getSaveCount: () => saveCount,
        getRefreshCount: () => refreshCount,
        getNotificationCount: () => notificationCount
    };
}

test('stale persisted Moments image generation becomes retryable after reload', async () => {
    const { view, moment, getSaveCount } = createFixture();

    const html = view.renderMomentImage(moment.images[0], 0, moment);
    await Promise.resolve();

    assert.equal(moment.imageGenerationStates[0].status, 'failed');
    assert.equal(moment.imageGenerationStates[0].error, '生成已中断，点击重试');
    assert.match(html, /生成失败，点击重试/);
    assert.match(html, /生成已中断，点击重试/);
    assert.doesNotMatch(html, /正在生成，点击取消/);
    assert.equal(getSaveCount(), 1);
});

test('active Moments image generation can be cancelled without a stale success write', async () => {
    const originalWindow = globalThis.window;
    const { view, moment, getRefreshCount, getNotificationCount } = createFixture({
        status: 'failed',
        generationId: ''
    });
    let receivedSignal = null;
    let resolvedApp = '';
    let generatedApp = '';
    let markStarted;
    const started = new Promise(resolve => {
        markStarted = resolve;
    });
    globalThis.window = {
        VirtualPhone: {
            imageGenerationManager: {
                storage: null,
                resolveProvider(options) {
                    resolvedApp = options?.app || '';
                    return 'novelai';
                },
                generate(options) {
                    receivedSignal = options.signal;
                    generatedApp = options.app || '';
                    markStarted();
                    return new Promise((resolve, reject) => {
                        options.signal.addEventListener('abort', () => {
                            const error = new Error('aborted');
                            error.name = 'AbortError';
                            reject(error);
                        }, { once: true });
                    });
                }
            }
        }
    };
    view._buildMomentImageGenerationContext = async () => ({
        prompt: 'sunset sky',
        references: [],
        referenceNames: [],
        useUserReference: false
    });

    try {
        const generation = view.generateMomentImage({
            momentId: moment.id,
            index: 0,
            promptText: 'sunset sky',
            descriptionText: '晚霞'
        });
        await started;

        assert.equal(moment.imageGenerationStates[0].status, 'loading');
        assert.equal(resolvedApp, 'wechat');
        assert.equal(generatedApp, 'wechat');
        assert.equal(await view.cancelMomentImageGeneration(moment.id, 0), true);
        await generation;

        assert.equal(receivedSignal?.aborted, true);
        assert.equal(moment.imageGenerationStates[0].status, 'failed');
        assert.equal(moment.imageGenerationStates[0].error, '生成已取消，点击重试');
        assert.equal(getNotificationCount(), 0);
        assert.ok(getRefreshCount() >= 2);
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    }
});

test('Moments reference-image loading propagates cancellation', async () => {
    const { view, moment } = createFixture({
        status: 'failed',
        generationId: '',
        useUserReference: true
    });
    const controller = new AbortController();
    view.app.wechatData.getUserInfo = () => ({
        name: 'user',
        naiReferenceImage: '/backgrounds/user-reference.png',
        naiReferenceEnabled: true
    });
    view._imageUrlToMomentReferenceDataUrl = async (url, signal) => {
        assert.equal(url, '/backgrounds/user-reference.png');
        assert.equal(signal, controller.signal);
        controller.abort();
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
    };

    await assert.rejects(
        view._buildMomentImageGenerationContext(moment, 0, 'sunset sky', controller.signal),
        error => error?.name === 'AbortError'
    );
});
