import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

function loadPhonePlaceholderTools() {
    const start = indexSource.indexOf('const PHONE_PROMPT_MACRO_NAMES');
    const end = indexSource.indexOf('const WECHAT_INITIAL_ENABLED_OFFLINE_KEYS', start);
    assert.ok(start >= 0 && end > start, 'phone placeholder helpers should be present');
    return Function(`${indexSource.slice(start, end)}\nreturn { PHONE_REQUEST_MACRO_PATTERN, getPhonePromptMarker, stripPhonePromptPlaceholders, substitutePhoneInjectedMacros };`)();
}

function loadPromptRunner(handler) {
    const start = indexSource.indexOf('let phonePromptHandler = async () => {};');
    const end = indexSource.indexOf('// 🔥 第一阶段：核心数据初始化', start);
    assert.ok(start >= 0 && end > start, 'prompt runner source should be present');

    const source = indexSource
        .slice(start, end)
        .replace('let phonePromptHandler = async () => {};', 'let phonePromptHandler = handler;');

    return Function('handler', `${source}\nreturn runPhonePromptHandler;`)(handler);
}

test('manifest registers the official early generation interceptor', () => {
    assert.equal(manifest.generate_interceptor, 'yuzukiPhoneGenerateInterceptor');
    assert.match(indexSource, /globalThis\.yuzukiPhoneGenerateInterceptor\s*=\s*async function/);
});

test('registered macro markers remain detectable and cleanable after TT macro expansion', () => {
    const tools = loadPhonePlaceholderTools();
    const marker = tools.getPhonePromptMarker('PHONE_HISTORY');

    assert.equal(marker, '__ST_PHONE_PROMPT_VAR_PHONE_HISTORY__');
    assert.equal(tools.PHONE_REQUEST_MACRO_PATTERN.test('{{ PHONE_HISTORY }}'), true);
    assert.equal(tools.PHONE_REQUEST_MACRO_PATTERN.test(marker), true);
    assert.deepEqual(
        tools.stripPhonePromptPlaceholders(`before ${marker} after`),
        { text: 'before  after', changed: true },
    );
});

test('injected phone content uses the SillyTavern macro substitution interface', () => {
    const tools = loadPhonePlaceholderTools();
    const calls = [];
    const context = {
        substituteParams(content) {
            calls.push(content);
            return content
                .replaceAll('{{user}}', '测试用户')
                .replaceAll('{{char}}', '测试角色')
                .replaceAll('{{customMacro}}', '扩展值');
        },
    };

    const content = tools.substitutePhoneInjectedMacros(
        '{{PHONE_HISTORY}} {{user}}正在联系{{char}}，状态={{customMacro}}',
        context,
    );

    assert.equal(content, '{{PHONE_HISTORY}} 测试用户正在联系测试角色，状态=扩展值');
    assert.equal(calls.length, 1);
    assert.doesNotMatch(calls[0], /\{\{PHONE_HISTORY\}\}/);
});

test('phone macro substitution failures preserve injected content', () => {
    const tools = loadPhonePlaceholderTools();
    const previousWarn = console.warn;
    console.warn = () => {};
    try {
        const original = '保留{{user}}原文';
        const content = tools.substitutePhoneInjectedMacros(original, {
            substituteParams() {
                throw new Error('macro failure');
            },
        });
        assert.equal(content, original);
    } finally {
        console.warn = previousWarn;
    }
});

test('phone prompt macros register through the SillyTavern context bridge', () => {
    const start = indexSource.indexOf('const registerPhonePromptMacros = () => {');
    const end = indexSource.indexOf('context.eventSource.on(', start);
    assert.ok(start >= 0 && end > start, 'macro registration source should be present');
    const registrationSource = indexSource.slice(start, end);

    assert.match(registrationSource, /context\.registerMacro\(name, \(\) => marker/);
    assert.match(registrationSource, /context\.macros\.register\(name/);
    assert.match(registrationSource, /getPhonePromptMarker\(name\)/);
});

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
    assert.match(gateSource, /if \(requestHasInjectedPhoneMessages\) return;/);
    assert.match(gateSource, /if \(!allowForegroundVariablelessInjection\) \{[\s\S]*forceFallbackCleanup\(eventData\.chat\)/);
    assert.ok(
        gateSource.indexOf('requestHasInjectedPhoneMessages') < gateSource.indexOf('// 2. 如果是酒馆正文发起的请求'),
        'existing phone messages must be detected before stale-message cleanup',
    );
});

test('foreground fallback is limited to WeChat rules and history when TT consumes the variables', () => {
    const start = indexSource.indexOf('const allowVariablelessFallback = !requirePhoneInjectionVariable;');
    const end = indexSource.indexOf('// 🎵 {{MUSIC_PROMPT}} 独立注入', start);
    assert.ok(start >= 0 && end > start, 'phone injection calls should be present');
    const injectionSource = indexSource.slice(start, end);

    assert.match(injectionSource, /allowForegroundWechatFallback/);
    assert.match(injectionSource, /PHONE_PROMPT[^\n]+allowForegroundWechatFallback/);
    assert.match(injectionSource, /PHONE_HISTORY[^\n]+allowForegroundWechatFallback/);
    assert.doesNotMatch(injectionSource, /MOMENTS_HISTORY[^\n]+allowForegroundWechatFallback/);
    assert.doesNotMatch(injectionSource, /HONEY_HISTORY[^\n]+allowForegroundWechatFallback/);
});

test('all injected phone blocks resolve native Tavern macros before message construction', () => {
    const start = indexSource.indexOf('// 🔥 辅助函数：原地拆分注入');
    const end = indexSource.indexOf('// 🔥 分别注入规则和历史记录', start);
    assert.ok(start >= 0 && end > start, 'phone injection helper should be present');
    const injectionSource = indexSource.slice(start, end);

    assert.match(injectionSource, /substitutePhoneInjectedMacros\(contentToInject, getContext\(\)\)/);
    assert.match(injectionSource, /content:\s*resolvedContentToInject/);
    assert.match(injectionSource, /parts\s*=\s*\[\{ text: resolvedContentToInject \}\]/);
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
