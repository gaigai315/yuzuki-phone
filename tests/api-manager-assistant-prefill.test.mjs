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

function createJsonResponse(body) {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
}

function createHarness() {
    const requests = [];
    globalThis.localStorage = {
        getItem: () => null,
        setItem: () => {}
    };
    globalThis.document = {
        getElementById: () => null
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
        manager: new ApiManager({ get: () => null }),
        requests
    };
}

const geminiCompatibilityConfig = {
    provider: 'compatible',
    apiUrl: 'https://example.com/v1'
};

test('Gemini 3.5 through 3.8 Flash variants reject assistant prefill', () => {
    const { manager } = createHarness();
    const unsupportedModels = [
        'gemini-3.5-flash',
        'gemini-3.5-flash-low',
        'gemini-3.6-flash',
        'gemini-3.6-flash-medium',
        'gemini-3.7-flash',
        'gemini-3.7-flash-tiered',
        'gemini-3.8-flash',
        'gemini-3.8-flash-high'
    ];

    unsupportedModels.forEach((model) => {
        assert.equal(
            manager._supportsAssistantPrefill({ ...geminiCompatibilityConfig, model }),
            false,
            model
        );
    });
    assert.equal(manager._supportsAssistantPrefill({ ...geminiCompatibilityConfig, model: 'gemini-3.4-flash' }), true);
    assert.equal(manager._supportsAssistantPrefill({ ...geminiCompatibilityConfig, model: 'gemini-3.8-pro-agent' }), true);
});

test('assistant prefill removal preserves history and moves phone metadata to the new tail', () => {
    const { manager } = createHarness();
    const messages = [
        { role: 'system', content: 'system' },
        { role: 'assistant', content: 'historical assistant reply' },
        { role: 'user', content: 'generate now' },
        {
            role: 'assistant',
            content: 'prefill',
            gaigaiPhoneSignal: { appId: 'honey' },
            isPhoneMessage: true,
            isVirtualPhoneApiCall: true
        }
    ];

    const cleaned = manager._removeUnsupportedAssistantPrefill(messages, {
        ...geminiCompatibilityConfig,
        model: 'gemini-3.8-flash-tiered'
    });

    assert.deepEqual(cleaned.map((message) => message.role), ['system', 'assistant', 'user']);
    assert.equal(cleaned[1].content, 'historical assistant reply');
    assert.deepEqual(cleaned[2].gaigaiPhoneSignal, { appId: 'honey' });
    assert.equal(cleaned[2].isPhoneMessage, true);
    assert.equal(cleaned[2].isVirtualPhoneApiCall, true);
});

test('independent API payload removes Gemini 3.8 Flash assistant prefill', async () => {
    const { manager, requests } = createHarness();
    const result = await manager._callIndependentAPI([
        { role: 'system', content: 'system' },
        { role: 'user', content: 'generate now' },
        { role: 'assistant', content: 'prefill' }
    ], {}, {
        ...geminiCompatibilityConfig,
        apiKey: 'test-key',
        model: 'gemini-3.8-flash-tiered',
        maxTokens: 128,
        useStream: false
    });

    assert.equal(result.success, true);
    const payload = JSON.parse(requests[0].init.body);
    assert.deepEqual(payload.messages.map((message) => message.role), ['system', 'user']);
});

test('tavern API payload applies the same Gemini assistant-prefill cleanup', async () => {
    const { manager, requests } = createHarness();
    manager._getCachedTavernSettings = async () => ({
        max_response_length: 128,
        oai_settings: {
            chat_completion_source: 'custom',
            custom_model: 'gemini-3.8-flash-tiered',
            custom_url: 'https://example.com/v1',
            custom_key: 'test-key',
            temp_openai: 1
        }
    });

    const result = await manager._callTavernAPI([
        { role: 'system', content: 'system' },
        { role: 'user', content: 'generate now' },
        { role: 'assistant', content: 'prefill' }
    ], {}, null, { useStream: false });

    assert.equal(result.success, true);
    const payload = JSON.parse(requests[0].init.body);
    assert.deepEqual(payload.messages.map((message) => message.role), ['system', 'user']);
});
