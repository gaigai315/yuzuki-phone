import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs
    .readFileSync(new URL('../config/api-manager.js', import.meta.url), 'utf8')
    .replace(
        "import { getMemoryTagFilterInfo } from './tag-filter.js';",
        'const getMemoryTagFilterInfo = () => ({ hasYuzukiMemory: false, hasGaigai: false });'
    );
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { ApiManager } = await import(moduleUrl);

function createJsonResponse(body, options = {}) {
    return new Response(JSON.stringify(body), {
        status: options.status || 200,
        headers: { 'Content-Type': 'application/json' }
    });
}

function createHarness() {
    let context = {
        characterId: 7,
        characters: [{}, {}, {}, {}, {}, {}, {}, { name: '测试角色', avatar: 'test.png' }],
        chatId: 'chat-a',
        chatMetadata: { file_name: 'chat-a' }
    };
    const localValues = new Map([
        ['yzp_phone_opencode_session_salt', '0123456789abcdef0123456789abcdef0123456789abcdef']
    ]);
    const storage = {
        getContext: () => context,
        get: () => null
    };
    const requests = [];

    globalThis.localStorage = {
        getItem: (key) => localValues.get(key) ?? null,
        setItem: (key, value) => localValues.set(key, String(value))
    };
    globalThis.window = {
        crypto: globalThis.crypto,
        VirtualPhone: {},
        YuzukiMemory: {},
        getRequestHeaders: () => ({ 'X-CSRF-Token': 'csrf-test' })
    };
    globalThis.fetch = async (url, init) => {
        requests.push({ url, init });
        return createJsonResponse({ choices: [{ message: { content: 'OK' } }] });
    };

    return {
        manager: new ApiManager(storage),
        requests,
        setChatId(chatId) {
            context = {
                ...context,
                chatId,
                chatMetadata: { file_name: chatId }
            };
        }
    };
}

const openCodeConfig = {
    provider: 'opencode_go',
    apiUrl: 'https://opencode.ai/zen/go/v1',
    apiKey: 'go-test-key',
    model: 'deepseek-v4-flash',
    maxTokens: 128,
    useStream: false
};

test('OpenCode Go uses the custom proxy route with a stable opaque session header', async () => {
    const { manager, requests, setChatId } = createHarness();

    assert.equal((await manager._callIndependentAPI([{ role: 'user', content: 'one' }], {}, openCodeConfig)).success, true);
    assert.equal((await manager._callIndependentAPI([{ role: 'user', content: 'two' }], {}, openCodeConfig)).success, true);
    setChatId('chat-b');
    assert.equal((await manager._callIndependentAPI([{ role: 'user', content: 'three' }], {}, openCodeConfig)).success, true);

    const payloads = requests.map((request) => JSON.parse(request.init.body));
    const headers = payloads.map((payload) => JSON.parse(payload.custom_include_headers));
    const sessions = headers.map((value) => value['x-opencode-session']);

    assert.equal(payloads[0].chat_completion_source, 'custom');
    assert.equal(payloads[0].custom_url, 'https://opencode.ai/zen/go/v1');
    assert.equal(headers[0].Authorization, 'Bearer go-test-key');
    assert.match(sessions[0], /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    assert.equal(sessions[0], sessions[1]);
    assert.notEqual(sessions[0], sessions[2]);
    assert.equal(sessions.some((value) => value.includes('chat-')), false);
});

test('OpenCode session headers are enabled by provider selection, not by URL matching', async () => {
    const { manager, requests } = createHarness();
    const result = await manager._callIndependentAPI([{ role: 'user', content: 'test' }], {}, {
        ...openCodeConfig,
        provider: 'compatible'
    });

    assert.equal(result.success, true);
    const payload = JSON.parse(requests[0].init.body);
    assert.equal(payload.chat_completion_source, 'openai');
    assert.equal(payload.custom_include_headers, undefined);
    assert.equal(manager._buildIndependentUpstreamHeaders('compatible', 'Bearer test')['x-opencode-session'], undefined);
});

test('OpenCode Go normalizes the official root and rejects unrelated or unsupported endpoints', async () => {
    const { manager, requests } = createHarness();

    assert.equal(
        manager._processApiUrl('https://opencode.ai/zen/go', 'opencode_go'),
        'https://opencode.ai/zen/go/v1'
    );
    assert.equal(manager._isOfficialOpenCodeGoUrl('https://opencode.ai.evil.example/zen/go/v1'), false);

    const unrelated = await manager._callIndependentAPI([{ role: 'user', content: 'test' }], {}, {
        ...openCodeConfig,
        apiUrl: 'https://example.com/v1'
    });
    const unsupported = await manager._callIndependentAPI([{ role: 'user', content: 'test' }], {}, {
        ...openCodeConfig,
        apiUrl: 'https://opencode.ai/zen/go/v1/responses'
    });

    assert.equal(unrelated.success, false);
    assert.match(unrelated.error, /官方地址/);
    assert.equal(unsupported.success, false);
    assert.match(unsupported.error, /chat\/completions/);
    assert.equal(requests.length, 0);
});

test('settings expose OpenCode Go without a manual custom-header field', () => {
    const settingsSource = fs.readFileSync(new URL('../apps/settings/settings-app.js', import.meta.url), 'utf8');
    assert.match(settingsSource, /<option value="opencode_go">OpenCode Go<\/option>/);
    assert.doesNotMatch(settingsSource, /phone-api-custom-headers/);
    assert.doesNotMatch(settingsSource, /自定义请求头（JSON）/);
});
