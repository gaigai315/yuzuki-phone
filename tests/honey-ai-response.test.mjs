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
