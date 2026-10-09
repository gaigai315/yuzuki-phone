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

test('official prompt-ready event remains registered when legacy hooks exist', () => {
    const start = indexSource.indexOf('// 官方事件是主注入链');
    const end = indexSource.indexOf("console.warn('⚠️ 无法访问 context 或 eventSource')", start);
    const bridgeSource = indexSource.slice(start, end);

    assert.match(bridgeSource, /eventTypes\.CHAT_COMPLETION_PROMPT_READY/);
    assert.match(bridgeSource, /context\.eventSource\.on\(/);
    assert.match(bridgeSource, /window\.hooks\.addFilter\('chat_completion_prompt_ready'/);
    assert.doesNotMatch(bridgeSource, /else\s*\{\s*\/\/ 旧版本酒馆兼容/);
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
