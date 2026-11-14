import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicImageAPI } from '../config/public-image-api.js';
import { ImageGenerationManager } from '../config/image-generation-manager.js';

function setup(config = {}, generate = async () => ({ imageData: 'data:image/png;base64,aGVsbG8=' })) {
    const calls = [];
    const manager = {
        getConfig(options) {
            assert.deepEqual(options, { app: 'story' });
            return { enabled: true, provider: 'novelai', model: 'test-model', apiKey: 'secret-key', ...config };
        },
        async generate(options) { calls.push(options); return generate(options); }
    };
    return { api: createPublicImageAPI(() => manager), manager, calls };
}

test('public status exposes only stable metadata and checks configuration', async () => {
    const { api } = setup();
    assert.deepEqual(api.getStatus(), { version: 1, ready: true, code: '', provider: 'novelai', model: 'test-model' });
    assert.equal(Object.isFrozen(api), true);
    for (const [config, code] of [
        [{ enabled: false }, 'DISABLED'], [{ apiKey: '' }, 'NOT_CONFIGURED'],
        [{ provider: 'unknown' }, 'UNSUPPORTED_PROVIDER'],
        [{ provider: 'comfyui', apiKey: '', comfyuiUrl: '' }, 'NOT_CONFIGURED']
    ]) {
        const { api, calls } = setup(config);
        assert.equal(api.getStatus().code, code);
        await assert.rejects(api.generate({ prompt: 'test' }), { code });
        assert.equal(calls.length, 0);
    }
    assert.equal(createPublicImageAPI(() => null).getStatus().code, 'NOT_READY');
});

test('generation uses story configuration and returns a Blob without internal fields', async () => {
    const { api, calls } = setup();
    const result = await api.generate({ prompt: ' landscape ', negativePrompt: 'blur' });
    assert.deepEqual(calls, [{ app: 'story', prompt: 'landscape', additionalNegativePrompt: 'blur', signal: undefined }]);
    assert.equal(result.blob instanceof Blob, true);
    assert.equal(result.mimeType, 'image/png');
    assert.equal(await result.blob.text(), 'hello');
    assert.deepEqual(Object.keys(result).sort(), ['version', 'blob', 'mimeType', 'provider', 'model', 'width', 'height', 'seed'].sort());
});

test('invalid inputs and configuration overrides never reach the manager', async () => {
    const { api, calls } = setup();
    for (const options of [null, [], {}, { prompt: ' ' }, { prompt: 123 },
        { prompt: 'test', apiKey: 'injected' }, { prompt: 'test', app: 'wechat' },
        { prompt: 'test', ignoreEnabled: true }, { prompt: 'test', negativePrompt: [] },
        { prompt: 'test', signal: {} }]) {
        await assert.rejects(api.generate(options), { code: 'INVALID_ARGS' });
    }
    assert.equal(calls.length, 0);
});

test('cancelled tasks do not start, and cancellation during generation discards results', async () => {
    const controller = new AbortController();
    controller.abort();
    const { api, calls } = setup();
    await assert.rejects(api.generate({ prompt: 'test', signal: controller.signal }), { code: 'ABORTED', name: 'AbortError' });
    assert.equal(calls.length, 0);
    const active = new AbortController();
    const running = setup({}, async options => {
        assert.equal(options.signal, active.signal);
        active.abort();
        return { imageData: 'data:image/png;base64,aGVsbG8=' };
    });
    await assert.rejects(running.api.generate({ prompt: 'test', signal: active.signal }), { code: 'ABORTED' });
});

test('errors are normalized without leaking upstream configuration', async () => {
    const { api } = setup({}, async () => { throw new Error('secret-key https://private-endpoint'); });
    await assert.rejects(api.generate({ prompt: 'test' }), error => {
        assert.equal(error.code, 'GENERATION_FAILED');
        assert.doesNotMatch(error.message, /secret|private/);
        assert.equal(error.cause, undefined);
        return true;
    });
});

test('empty, video and non-image results are rejected', async () => {
    for (const result of [{}, { mediaType: 'video' }, { imageData: 'data:text/html,hello' }]) {
        const { api } = setup({}, async () => result);
        await assert.rejects(api.generate({ prompt: 'test' }), { code: 'INVALID_RESULT' });
    }
});

test('image URL retrieval forwards cancellation and preserves image metadata', async () => {
    const controller = new AbortController();
    const { manager } = setup({}, async () => ({ imageUrl: '/generated.png', width: 512, height: 768, seed: 42, apiKey: 'private' }));
    const api = createPublicImageAPI(() => manager, async (url, options) => {
        assert.equal(url, '/generated.png');
        assert.equal(options.signal, controller.signal);
        return new Response(new Blob(['png'], { type: 'image/png' }));
    });
    const result = await api.generate({ prompt: 'test', signal: controller.signal });
    assert.equal(result.width, 512);
    assert.equal(result.height, 768);
    assert.equal(result.seed, 42);
    assert.equal(result.apiKey, undefined);
});

test('status and generation resolve the current manager after replacement', async () => {
    let manager = null;
    const api = createPublicImageAPI(() => manager);
    assert.equal(api.getStatus().ready, false);
    manager = setup().manager;
    assert.equal(api.getStatus().ready, true);
    assert.equal((await api.generate({ prompt: 'test' })).blob.type, 'image/png');
});

test('public API preserves real story configuration and appends external negative words', async () => {
    const settings = new Map(Object.entries({
        'phone-image-enabled': true,
        'phone-image-provider': 'sd',
        'phone-image-story-fixed-prompt': 'user positive',
        'phone-image-story-fixed-prompt-end': 'user suffix',
        'phone-image-story-negative-prompt': 'user negative',
        'phone-image-story-width': 768,
        'phone-image-story-height': 1024,
        'phone-image-steps': 30,
        'phone-image-scale': 7,
        'phone-image-seed': 123,
        'phone-image-sd-sampler': 'Euler a'
    }));
    const manager = new ImageGenerationManager({ get: (key, fallback) => settings.has(key) ? settings.get(key) : fallback });
    manager._generateStableDiffusion = async (options, config) => {
        assert.equal(options.app, 'story');
        assert.equal(options.prompt, 'external scene');
        assert.equal(config.fixedPrompt, 'user positive');
        assert.equal(config.fixedPromptEnd, 'user suffix');
        assert.equal(manager._joinPrompt([config.negativePrompt, options.negativePrompt]), 'user negative, external negative');
        assert.equal(config.width, 768);
        assert.equal(config.height, 1024);
        assert.equal(config.steps, 30);
        assert.equal(config.scale, 7);
        assert.equal(config.seed, 123);
        assert.equal(config.sampler, 'Euler a');
        return { blob: new Blob(['image'], { type: 'image/png' }) };
    };
    const api = createPublicImageAPI(() => manager);
    await api.generate({ prompt: 'external scene', negativePrompt: 'external negative' });
    assert.equal(settings.get('phone-image-story-negative-prompt'), 'user negative');
});
