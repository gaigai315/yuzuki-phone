import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../config/api-manager.js', import.meta.url), 'utf8')
    .replace("import { getMemoryTagFilterInfo } from './tag-filter.js';",
        'const getMemoryTagFilterInfo = () => ({ hasYuzukiMemory: false, hasGaigai: false });');
const { ApiManager } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const reply = '<Twitter>正文：测试</Twitter>';

function createHarness({ settings = {}, liveSettings, dom = {}, stream = false, respond } = {}) {
    const requests = [];
    globalThis.localStorage = { getItem: () => null };
    globalThis.document = { getElementById: id => dom[id] ?? null };
    globalThis.SillyTavern = { getContext: () => ({ chatCompletionSettings: liveSettings }) };
    globalThis.window = {
        VirtualPhone: {},
        getRequestHeaders: () => ({ 'X-CSRF-Token': 'test-csrf' })
    };
    const oai = {
        chat_completion_source: 'vertexai',
        vertexai_model: 'gemini-3.8-flash',
        vertexai_auth_mode: 'full',
        vertexai_region: 'global',
        openai_model: 'wrong-openai-model',
        openai_key: 'wrong-openai-secret',
        openai_max_tokens: 4096,
        ...settings
    };
    const manager = new ApiManager({
        get: key => key === 'phone_api_config' ? {
            useIndependentAPI: false,
            useStream: stream,
            model: 'wrong-independent-model',
            maxTokens: 99,
            activeProfileName: 'old-profile',
            profiles: [{ name: 'old-profile', useIndependentAPI: true, useStream: stream }]
        } : null
    });
    globalThis.fetch = async (url, init) => {
        if (url === '/api/settings/get') {
            return Response.json({ settings: JSON.stringify({ oai_settings: oai }) });
        }
        assert.equal(url, '/api/backends/chat-completions/generate');
        const payload = JSON.parse(init.body);
        requests.push({ payload, init });
        return respond ? respond(payload) : Response.json({ choices: [{ message: { content: reply } }] });
    };
    return { manager, requests };
}

function messages() {
    return [
        { role: 'system', content: '只输出 Twitter 标签' },
        { role: 'user', content: '生成帖子' },
        { role: 'assistant', content: '<Twitter>' }
    ];
}

test('disabled independent API uses Vertex service account mode and its own model', async () => {
    const { manager, requests } = createHarness({
        respond: payload => payload.vertexai_auth_mode === 'full'
            ? Response.json({ choices: [{ message: { content: reply } }] })
            : Response.json({ error: true, message: 'API key is required for Vertex AI Express mode' }, { status: 400 })
    });
    const result = await manager.callAI(messages(), { appId: 'x', maxTokens: 32 });
    assert.equal(result.success, true);
    assert.equal(result.summary, reply);
    assert.equal(requests.length, 1);
    const { payload, init } = requests[0];
    assert.equal(payload.chat_completion_source, 'vertexai');
    assert.equal(payload.model, 'gemini-3.8-flash');
    assert.equal(payload.vertexai_region, 'global');
    assert.equal(payload.max_tokens, 4096);
    assert.equal(payload.stream, false);
    assert.equal(payload.proxy_password, undefined);
    assert.equal(payload.reverse_proxy, undefined);
    assert.equal(payload.vertexai_service_account_json, undefined);
    assert.deepEqual(payload.messages.map(message => message.role), ['system', 'user']);
    assert.equal(init.credentials, 'include');
    assert.equal(init.headers['X-CSRF-Token'], 'test-csrf');
});

test('Vertex Express forwards region and optional project ID without an OpenAI credential', async () => {
    const { manager, requests } = createHarness({ settings: {
        vertexai_auth_mode: 'express', vertexai_region: 'europe-west4', vertexai_express_project_id: 'test-project'
    } });
    assert.equal((await manager.callAI(messages())).success, true);
    assert.equal(requests[0].payload.vertexai_auth_mode, 'express');
    assert.equal(requests[0].payload.vertexai_region, 'europe-west4');
    assert.equal(requests[0].payload.vertexai_express_project_id, 'test-project');
    assert.equal(requests[0].payload.proxy_password, undefined);
});

test('Vertex reverse proxy receives the proxy password rather than the OpenAI key', async () => {
    const { manager, requests } = createHarness({ settings: {
        reverse_proxy: 'https://vertex.example.test', proxy_password: 'test-proxy-password'
    } });
    assert.equal((await manager.callAI(messages())).success, true);
    assert.equal(requests[0].payload.reverse_proxy, 'https://vertex.example.test');
    assert.equal(requests[0].payload.proxy_password, 'test-proxy-password');
});

test('live settings override cached auth, model, proxy and response length', async () => {
    const liveSettings = {
        vertexai_auth_mode: 'express', vertexai_model: 'gemini-2.5-pro',
        vertexai_region: 'us-central1', reverse_proxy: 'https://old.example.test',
        proxy_password: 'old-password', openai_max_tokens: 1024
    };
    const { manager, requests } = createHarness({ liveSettings });
    await manager.callAI(messages());
    Object.assign(liveSettings, {
        vertexai_auth_mode: 'full', vertexai_model: 'gemini-3.8-flash',
        vertexai_region: 'global', reverse_proxy: '', proxy_password: '', openai_max_tokens: 8192
    });
    await manager.callAI(messages());
    const payload = requests[1].payload;
    assert.equal(payload.vertexai_auth_mode, 'full');
    assert.equal(payload.model, 'gemini-3.8-flash');
    assert.equal(payload.vertexai_region, 'global');
    assert.equal(payload.max_tokens, 8192);
    assert.equal(payload.reverse_proxy, undefined);
    assert.equal(payload.proxy_password, undefined);
});

test('DOM fallback follows current Vertex settings including cleared fields and unchecked options', async () => {
    const { manager, requests } = createHarness({
        settings: {
            vertexai_auth_mode: 'express', reverse_proxy: 'https://old.example.test',
            proxy_password: 'old-password', vertexai_express_project_id: 'old-project',
            use_sysprompt: true, show_thoughts: true
        },
        dom: {
            vertexai_auth_mode: { value: 'full' }, model_vertexai_select: { value: 'gemini-2.5-pro' },
            vertexai_region: { value: 'global' }, vertexai_express_project_id: { value: '' },
            openai_reverse_proxy: { value: '' }, use_sysprompt: { checked: false },
            openai_show_thoughts: { checked: false }
        }
    });
    await manager.callAI(messages());
    const payload = requests[0].payload;
    assert.equal(payload.vertexai_auth_mode, 'full');
    assert.equal(payload.model, 'gemini-2.5-pro');
    assert.equal(payload.vertexai_express_project_id, '');
    assert.equal(payload.reverse_proxy, undefined);
    assert.equal(payload.use_sysprompt, false);
    assert.equal(payload.include_reasoning, false);
    assert.equal(payload.messages.at(-1).role, 'user');
});

test('Vertex generation settings and phone isolation metadata survive request building', async () => {
    const { manager, requests } = createHarness({ settings: {
        top_k_openai: 40, use_sysprompt: true, custom_prompt_post_processing: 'merge',
        reasoning_effort: 'low', show_thoughts: true, seed: 0
    } });
    const signal = { appName: 'x', allowSummary: false, allowTable: false, allowVector: false };
    const prompt = messages();
    Object.assign(prompt.at(-1), { gaigaiPhoneSignal: signal, isPhoneMessage: true, isVirtualPhoneApiCall: true });
    const result = await manager._callTavernAPI(prompt, { stream: false }, signal);
    assert.equal(result.success, true);
    const payload = requests[0].payload;
    assert.equal(payload.top_k, 40);
    assert.equal(payload.use_sysprompt, true);
    assert.equal(payload.custom_prompt_post_processing, 'merge');
    assert.equal(payload.reasoning_effort, 'low');
    assert.equal(payload.include_reasoning, true);
    assert.equal(payload.seed, 0);
    assert.equal(payload.isVirtualPhoneApiCall, true);
    assert.deepEqual(payload.gaigaiPhoneSignal, signal);
    assert.deepEqual(payload.messages.at(-1).gaigaiPhoneSignal, signal);
});

test('Vertex SSE joins text parts and excludes thoughts without requiring DONE', async () => {
    const { manager, requests } = createHarness({ stream: true, respond: () => new Response([
        { candidates: [{ content: { parts: [{ text: 'internal thought', thought: true }] } }] },
        { candidates: [{ content: { parts: [{ text: '<Twitter>' }, { text: '正文：测试' }] } }] },
        { candidates: [{ content: { parts: [{ text: '</Twitter>' }] }, finishReason: 'STOP' }] }
    ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join(''), {
        headers: { 'Content-Type': 'text/event-stream' }
    }) });
    const result = await manager.callAI(messages());
    assert.equal(result.success, true);
    assert.equal(result.summary, reply);
    assert.equal(result.finishReason, 'STOP');
    assert.equal(result.streamEndReason, '收到结束事件 (STOP)');
    assert.equal(requests[0].payload.stream, true);
});

test('missing service account is reported as an API failure without another generation', async () => {
    const errorMessage = 'Service Account JSON is required for Vertex AI Full mode';
    const { manager, requests } = createHarness({ respond: () =>
        Response.json({ error: true, message: errorMessage }, { status: 400 })
    });
    const result = await manager.callAI(messages());
    assert.equal(result.success, false);
    assert.ok(result.error.includes(errorMessage));
    assert.equal(requests.length, 1);
});
