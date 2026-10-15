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

function createHarness(responseText = '<Twitter>\n正文：测试\n</Twitter>') {
    const requests = [];
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.window = {
        crypto: globalThis.crypto,
        VirtualPhone: {},
        YuzukiMemory: {},
        getRequestHeaders: () => ({ 'X-CSRF-Token': 'csrf-test' })
    };
    globalThis.fetch = async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: responseText }] }, finishReason: 'STOP' }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    return { manager: new ApiManager({ get: () => null }), requests };
}

test('official Gemini v1beta uses generateContent and x-goog-api-key for new key formats', async () => {
    const { manager, requests } = createHarness();
    const result = await manager._callIndependentAPI([
        { role: 'system', content: '只输出 Twitter 标签' },
        { role: 'user', content: '生成帖子', gaigaiPhoneSignal: { appId: 'x' } }
    ], { stream: false }, {
        provider: 'gemini',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'AQ.test-new-format',
        model: 'gemini-2.5-flash',
        maxTokens: 2048,
        useStream: false
    }, { appId: 'x' });

    assert.equal(result.success, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    assert.equal(requests[0].init.headers['x-goog-api-key'], 'AQ.test-new-format');
    assert.equal(requests[0].init.headers.Authorization, undefined);

    const body = JSON.parse(requests[0].init.body);
    assert.equal(body.system_instruction.parts[0].text, '只输出 Twitter 标签');
    assert.deepEqual(body.contents.map((message) => message.role), ['user']);
    assert.equal(body.gaigaiPhoneSignal, undefined);
    assert.equal(body.contents[0].gaigaiPhoneSignal, undefined);
});

test('official Gemini streaming uses streamGenerateContent SSE URL', async () => {
    const { manager } = createHarness();
    assert.equal(
        manager._buildOfficialGeminiGenerateUrl(
            'https://generativelanguage.googleapis.com/v1beta/models',
            'models/gemini-2.5-flash',
            true
        ),
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse'
    );
});

test('Gemini official detection does not trust lookalike hosts', () => {
    const { manager } = createHarness();
    assert.equal(manager._isOfficialGeminiApiUrl('https://generativelanguage.googleapis.com/v1beta'), true);
    assert.equal(manager._isOfficialGeminiApiUrl('https://generativelanguage.googleapis.com.evil.example/v1beta'), false);
});
