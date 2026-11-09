import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DiaryData } from '../apps/diary/diary-data.js';
import { PromptManager } from '../config/prompt-manager.js';

test('diary prompt receives selected floors as messages without showing the legacy chatHistory placeholder', () => {
    const promptManager = new PromptManager({ get: () => null });
    const defaultPrompt = promptManager.getDefaultPrompts().diary.generate.content;
    assert.doesNotMatch(defaultPrompt, /\{\{chatHistory\}\}/);
    assert.equal(
        promptManager._normalizePromptContent('diary', 'generate', '保留这段提示词\n\n聊天记录：\n{{chatHistory}}'),
        '保留这段提示词'
    );

    const previousWindow = globalThis.window;
    globalThis.window = {};
    try {
        const diaryData = new DiaryData({ get: () => null });
        assert.doesNotMatch(diaryData._getDiaryPrompt({ name2: '角色' }), /\{\{chatHistory\}\}/);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }

    const source = fs.readFileSync(new URL('../apps/diary/diary-data.js', import.meta.url), 'utf8');
    assert.match(source, /\.replace\(\/\\\{\\\{chatHistory\\\}\\\}\/g, ''\)/);
    assert.match(source, /messages\.push\(\.\.\.chatMessages\)/);
});
