import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

function loadPromptRunner(handler) {
    const start = indexSource.indexOf('let phonePromptHandler = async () => {};');
    const end = indexSource.indexOf('// 🔥 第一阶段：核心数据初始化', start);
    assert.ok(start >= 0 && end > start, 'prompt runner source should be present');

    const source = indexSource
        .slice(start, end)
        .replace('let phonePromptHandler = async () => {};', 'let phonePromptHandler = handler;');

    return Function('handler', `${source}\nreturn runPhonePromptHandler;`)(handler);
}

test('official prompt-ready event is registered first when legacy hooks exist', () => {
    const start = indexSource.indexOf('// 官方事件是主注入链');
    const end = indexSource.indexOf("console.warn('⚠️ 无法访问 context 或 eventSource')", start);
    const bridgeSource = indexSource.slice(start, end);

    assert.match(bridgeSource, /eventTypes\.CHAT_COMPLETION_PROMPT_READY/);
    assert.match(bridgeSource, /context\.eventSource\.makeFirst\(/);
    assert.match(bridgeSource, /context\.eventSource\.on\(/);
    assert.match(bridgeSource, /window\.hooks\.addFilter\('chat_completion_prompt_ready'/);
    assert.doesNotMatch(bridgeSource, /else\s*\{\s*\/\/ 旧版本酒馆兼容/);
});

test('official listener uses makeFirst before extensions that clone prompt arrays', () => {
    const start = indexSource.indexOf('const eventTypes = context.eventTypes');
    const end = indexSource.indexOf('if (!phonePromptBridgeRegistered)', start);
    assert.ok(start >= 0 && end > start, 'prompt bridge registration source should be present');

    const registrations = [];
    const context = {
        eventTypes: { CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready' },
        eventSource: {
            makeFirst(eventName, listener) {
                registrations.push({ method: 'makeFirst', eventName, listener });
            },
            on(eventName, listener) {
                registrations.push({ method: 'on', eventName, listener });
            },
        },
    };

    Function('context', 'window', 'runPhonePromptHandler', indexSource.slice(start, end))(
        context,
        {},
        async () => {},
    );

    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].method, 'makeFirst');
    assert.equal(registrations[0].eventName, 'chat_completion_prompt_ready');
});

test('phone injection reaches both the original TT prompt and a later Memory snapshot', async () => {
    const start = indexSource.indexOf('const eventTypes = context.eventTypes');
    const end = indexSource.indexOf('if (!phonePromptBridgeRegistered)', start);
    const listeners = [];
    const eventSource = {
        makeFirst(_eventName, listener) {
            listeners.unshift(listener);
        },
        on(_eventName, listener) {
            listeners.push(listener);
        },
        async emit(eventData) {
            for (const listener of listeners) await listener(eventData);
        },
    };
    const context = {
        eventTypes: { CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready' },
        eventSource,
    };
    let memorySnapshot = null;

    Function('context', 'window', 'runPhonePromptHandler', indexSource.slice(start, end))(
        context,
        {},
        async (eventData) => {
            eventData.chat.splice(0, 1, {
                role: 'system',
                content: '【手机微信已有消息】',
                isPhoneMessage: true,
                identifier: 'phone_system_history',
            });
        },
    );
    eventSource.on('chat_completion_prompt_ready', (eventData) => {
        memorySnapshot = structuredClone(eventData.chat);
        eventData.chat = memorySnapshot;
    });

    const originalTtPrompt = [{ role: 'system', content: '{{PHONE_HISTORY}}' }];
    await eventSource.emit({ chat: originalTtPrompt });

    assert.equal(originalTtPrompt[0].identifier, 'phone_system_history');
    assert.equal(memorySnapshot[0].identifier, 'phone_system_history');
});

test('already injected phone messages survive a later prompt-ready compatibility pass', () => {
    const start = indexSource.indexOf('const requirePhoneInjectionVariable = isPhoneInjectionVariableRequired();');
    const end = indexSource.indexOf('// 📱 收集手机活动记录', start);
    assert.ok(start >= 0 && end > start, 'variable gate source should be present');

    const gateSource = indexSource.slice(start, end);
    assert.match(gateSource, /requestHasInjectedPhoneMessages/);
    assert.match(gateSource, /if \(!requestHasInjectedPhoneMessages\) \{[\s\S]*forceFallbackCleanup\(eventData\.chat\)/);
    assert.ok(
        gateSource.indexOf('requestHasInjectedPhoneMessages') < gateSource.indexOf('// 2. 如果是酒馆正文发起的请求'),
        'existing phone messages must be detected before stale-message cleanup',
    );
});

test('same prompt array is injected once across official and legacy paths', async () => {
    let callCount = 0;
    const runner = loadPromptRunner(async (eventData) => {
        callCount += 1;
        eventData.chat.push({ role: 'system', content: `phone-${callCount}` });
    });
    const chat = [{ role: 'user', content: '{{PHONE_PROMPT}}' }];

    const officialRun = runner({ chat, prompt: [] }, 'prompt_ready_event');
    const legacyRun = runner({ chat, prompt: [] }, 'prompt_ready_filter');

    assert.strictEqual(officialRun, legacyRun);
    await Promise.all([officialRun, legacyRun]);
    assert.equal(callCount, 1);
    assert.equal(chat.filter((message) => message.role === 'system').length, 1);
});

test('different prompt arrays still run independently for fetch fallback', async () => {
    let callCount = 0;
    const runner = loadPromptRunner(async () => {
        callCount += 1;
    });

    await runner({ chat: [], prompt: [] }, 'prompt_ready_event');
    await runner({ chat: [], prompt: [] }, 'fetch_final');

    assert.equal(callCount, 2);
});
