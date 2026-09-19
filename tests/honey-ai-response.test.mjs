import assert from 'node:assert/strict';
import test from 'node:test';

import { HoneyData } from '../apps/honey/honey-data.js';
import { ApiManager } from '../config/api-manager.js';

function createHoneyData(callAI) {
    globalThis.window = { VirtualPhone: { apiManager: { callAI } } };
    const data = Object.create(HoneyData.prototype);
    data.storage = { get: () => null };
    data._getContext = () => null;
    return data;
}

test('invalid Honey reply retains exact model text and transport body for the dialog', async () => {
    const rawResponse = 'data: {"choices":[{"delta":{"content":"ordinary text"}}]}\n\n';
    const data = createHoneyData(async (_messages, options) => {
        options.onResponseChunk(rawResponse);
        options.onStreamEnd('响应体关闭（未收到 [DONE]）');
        return { success: true, summary: 'ordinary text', streamEndReason: '响应体关闭（未收到 [DONE]）' };
    });

    await assert.rejects(
        data._requestHoneySceneText([], { validPattern: /<Honey>/i }),
        error => {
            assert.match(error.message, /流在 \[DONE\] 前关闭/);
            assert.equal(error.honeyResponseDetails.rawText, 'ordinary text');
            assert.equal(error.honeyResponseDetails.rawResponse, rawResponse);
            assert.equal(error.honeyResponseDetails.streamEndReason, '响应体关闭（未收到 [DONE]）');
            assert.equal(error.honeyResponseDetails.timedOut, false);
            return true;
        }
    );
});

test('Honey timeout aborts its actual API request and preserves received stream fragments', async () => {
    let signal;
    const data = createHoneyData((_messages, options) => {
        signal = options.signal;
        options.onResponseChunk('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
        return new Promise(resolve => {
            signal.addEventListener('abort', () => resolve({ success: false, error: 'aborted' }), { once: true });
        });
    });

    await assert.rejects(
        data._requestHoneySceneText([], { validPattern: /<Honey>/i, timeoutMs: 15 }),
        error => {
            assert.match(error.message, /超时/);
            assert.equal(error.honeyResponseDetails.timedOut, true);
            assert.match(error.honeyResponseDetails.rawResponse, /partial/);
            return true;
        }
    );
    assert.equal(signal.aborted, true);
});

test('stream reader reports early body close separately from the DONE marker', async () => {
    const manager = new ApiManager({ get: () => null });
    const encoder = new TextEncoder();
    const received = [];
    let endReason = '';
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"ordinary text"}}]}\n\n'));
            controller.close();
        }
    });
    const result = await manager._readUniversalStream(body, '', chunk => received.push(chunk), reason => { endReason = reason; });
    assert.equal(result.summary, 'ordinary text');
    assert.match(endReason, /未收到 \[DONE\]/);
    assert.equal(result.streamEndReason, endReason);
    assert.match(received.join(''), /ordinary text/);
});

test('JSON responses carried through the stream reader are not misreported as unfinished SSE', async () => {
    const manager = new ApiManager({ get: () => null });
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('{"choices":[{"message":{"content":"plain JSON"}}]}'));
            controller.close();
        }
    });
    const result = await manager._readUniversalStream(body);
    assert.equal(result.summary, 'plain JSON');
    assert.equal(result.streamEndReason, '响应体关闭（非 SSE 响应）');
});

test('non-stream responses can carry the final reply in emit_complete_response tool arguments', () => {
    const manager = new ApiManager({ get: () => null });
    const result = manager._parseApiResponse({
        choices: [{
            message: {
                role: 'assistant',
                content: '',
                tool_calls: [{
                    index: 0,
                    type: 'function',
                    function: {
                        name: 'emit_complete_response_test',
                        arguments: JSON.stringify({ content: '工具中的非流式回复' })
                    }
                }]
            },
            finish_reason: 'stop'
        }]
    });

    assert.equal(result.success, true);
    assert.equal(result.summary, '工具中的非流式回复');
});

test('stream reader assembles emit_complete_response arguments even when finish reason is stop', async () => {
    const manager = new ApiManager({ get: () => null });
    const argumentsJson = JSON.stringify({ content: '工具中的流式回复\n第二行' });
    const splitAt = Math.ceil(argumentsJson.length / 2);
    const chunks = [
        {
            choices: [{
                delta: {
                    role: 'assistant',
                    tool_calls: [{
                        index: 0,
                        id: 'call_test',
                        type: 'function',
                        function: {
                            name: 'emit_complete_response_test',
                            arguments: argumentsJson.slice(0, splitAt)
                        }
                    }]
                }
            }]
        },
        {
            choices: [{
                delta: {
                    tool_calls: [{
                        index: 0,
                        function: { arguments: argumentsJson.slice(splitAt) }
                    }]
                }
            }]
        },
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
    ];
    const sse = chunks.map(chunk => 'data: ' + JSON.stringify(chunk) + '\n\n').join('') + 'data: [DONE]\n\n';
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(sse));
            controller.close();
        }
    });

    const result = await manager._readUniversalStream(body);
    assert.equal(result.success, true);
    assert.equal(result.summary, '工具中的流式回复\n第二行');
    assert.equal(result.streamEndReason, '收到 [DONE]');
});

test('native Gemini functionCall parts can carry the final reply', () => {
    const manager = new ApiManager({ get: () => null });
    const result = manager._parseApiResponse({
        candidates: [{
            content: {
                role: 'model',
                parts: [{
                    functionCall: {
                        name: 'emit_complete_response_native',
                        args: { content: 'Gemini 原生工具回复' }
                    }
                }, { text: '' }]
            },
            finishReason: 'STOP'
        }]
    });

    assert.equal(result.success, true);
    assert.equal(result.summary, 'Gemini 原生工具回复');
});
