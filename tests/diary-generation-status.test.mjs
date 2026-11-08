import assert from 'node:assert/strict';
import test from 'node:test';
import { DiaryView } from '../apps/diary/diary-view.js';

test('completed manual diary generation resets the button without leaving a persistent status', () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const button = { textContent: '', disabled: true };
    const status = { textContent: 'old status' };

    globalThis.window = {
        VirtualPhone: {
            diaryGenerationState: { running: false, done: true, status: '生成完成！' }
        }
    };
    globalThis.document = {
        getElementById(id) {
            if (id === 'diary-manual-run') return button;
            if (id === 'diary-manual-status') return status;
            return null;
        }
    };

    try {
        const view = new DiaryView({});
        view._syncDiaryGenerationStatusUI();
        assert.equal(button.textContent, '🚀 开始生成日记');
        assert.equal(button.disabled, false);
        assert.equal(status.textContent, '');
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
    }
});
