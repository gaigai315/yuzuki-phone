import assert from 'node:assert/strict';
import test from 'node:test';
import { getDiarySnapshotSize } from '../apps/diary/diary-snapshot.js';
import { DiaryView } from '../apps/diary/diary-view.js';

test('diary export retains the complete page aspect ratio within mobile canvas limits', () => {
    assert.deepEqual(getDiarySnapshotSize(400, 3000, 1.5), { width: 600, height: 4500 });
    for (const [width, height] of [[400, 12000], [2000, 10000], [400, 20000]]) {
        const size = getDiarySnapshotSize(width, height);
        assert.ok(size.width * size.height <= 12000000);
        assert.ok(size.width <= 16384 && size.height <= 16384);
        assert.ok(Math.abs(size.height / size.width - height / width) <= height / width / size.width);
    }
});

test('diary export rejects invalid sizes and unreadably long pages', () => {
    for (const [width, height] of [[0, 100], [400, 0], [NaN, 100], [400, Infinity], [-400, 100]]) {
        assert.throws(() => getDiarySnapshotSize(width, height), /无法读取日记尺寸/);
    }
    assert.throws(() => getDiarySnapshotSize(400, 100000), /过长/);
});

test('diary export prevents repeated generation and restores the button after an error', async () => {
    const previousElement = globalThis.Element;
    const notifications = [];
    let entryReads = 0;
    class Page { querySelector() { return null; } }
    globalThis.Element = Page;
    const button = {
        disabled: false,
        attributes: new Map(),
        closest: () => new Page(),
        setAttribute(name, value) { this.attributes.set(name, value); },
        removeAttribute(name) { this.attributes.delete(name); }
    };
    const view = new DiaryView({
        phoneShell: { showNotification: (_title, message) => notifications.push(message) },
        diaryData: {
            getEntry() { entryReads++; return { content: '日记正文' }; },
            parseDiaryContent: () => ({ title: '测试日记' })
        }
    });
    try {
        const first = view._exportDiaryLongImage(button);
        assert.equal(button.disabled, true);
        assert.equal(button.attributes.get('aria-busy'), 'true');
        await view._exportDiaryLongImage(button);
        await first;
        assert.equal(entryReads, 1);
        assert.equal(view._isExportingDiary, false);
        assert.equal(button.disabled, false);
        assert.equal(button.attributes.has('aria-busy'), false);
        assert.equal(notifications.at(-1), '找不到日记正文');
    } finally {
        if (previousElement === undefined) delete globalThis.Element;
        else globalThis.Element = previousElement;
    }
});
