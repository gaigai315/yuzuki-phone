import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { HoneyView } from '../apps/honey/honey-view.js';

const honeyCssSource = fs.readFileSync(new URL('../apps/honey/honey.css', import.meta.url), 'utf8');
const view = Object.create(HoneyView.prototype);
view._getActiveTopicKey = () => 'topic-a';
view._getActiveTopicTitle = () => '主题 A';

test('editing a Honey scene Tag only replaces the latest record for the active topic', () => {
    const firstTimestamp = Date.now() - 2000;
    const secondTimestamp = Date.now() - 1000;
    const scene = {
        _topicKey: 'topic-a',
        _topicTitle: '主题 A',
        naiPrompt: 'old latest prompt',
        imageGenerationPrompt: 'old latest prompt',
        naiTagHistory: [
            {
                id: 'tag-1',
                ts: firstTimestamp,
                prompt: 'keep this older prompt',
                source: 'ai_new',
                topicKey: 'topic-a',
                topicTitle: '主题 A'
            },
            {
                id: 'tag-2',
                ts: secondTimestamp,
                prompt: 'old latest prompt',
                source: 'ai_new',
                topicKey: 'topic-a',
                topicTitle: '主题 A'
            }
        ]
    };

    const editedPrompt = '1girl, blue dress, standing, soft daylight';
    const nextScene = view._buildSceneNaiTagEditPatch(scene, editedPrompt);

    assert.equal(nextScene.naiPrompt, editedPrompt);
    assert.equal(nextScene.imageGenerationPrompt, editedPrompt);
    assert.equal(nextScene.naiTagHistory.length, 2);
    assert.equal(nextScene.naiTagHistory[0].prompt, 'keep this older prompt');
    assert.equal(nextScene.naiTagHistory[1].id, 'tag-2');
    assert.equal(nextScene.naiTagHistory[1].prompt, editedPrompt);
    assert.equal(nextScene.naiTagHistory[1].source, 'user_edit');
});

test('the normal Honey generation prompt resolver uses edited Chinese and English Tags verbatim', () => {
    [
        'masterpiece, solo, red coat, rainy street, night',
        '雨夜街头，红色外套，单人，全身构图'
    ].forEach((editedPrompt) => {
        const nextScene = view._buildSceneNaiTagEditPatch({
            _topicKey: 'topic-a',
            _topicTitle: '主题 A',
            naiTagHistory: []
        }, editedPrompt);

        assert.equal(view._resolveSceneNaiPrompt(nextScene), editedPrompt);
    });
});

test('the editor reads the newest visible history Tag before stale scene fields', () => {
    const prompt = view._resolveLatestSceneNaiTagPrompt({
        _topicKey: 'topic-a',
        _topicTitle: '主题 A',
        naiPrompt: 'stale scene prompt',
        naiTagHistory: [
            {
                id: 'tag-1',
                ts: Date.now() - 1000,
                prompt: 'older history prompt',
                topicKey: 'topic-a',
                topicTitle: '主题 A'
            },
            {
                id: 'tag-2',
                ts: Date.now(),
                prompt: 'newest visible prompt',
                topicKey: 'topic-a',
                topicTitle: '主题 A'
            }
        ]
    });

    assert.equal(prompt, 'newest visible prompt');
});

test('the Honey Tag history panel exposes a pencil editor with scoped styles', () => {
    view._isSceneTagHistoryOpen = true;
    view._isRetaggingSceneNai = false;
    view._escapeHtml = value => String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const html = view._buildSceneTagHistoryPanelHtml({
        _topicKey: 'topic-a',
        _topicTitle: '主题 A',
        naiPrompt: '1girl, white dress',
        naiTagHistory: [{
            id: 'tag-1',
            ts: Date.now(),
            prompt: '1girl, white dress',
            topicKey: 'topic-a',
            topicTitle: '主题 A'
        }]
    });

    assert.match(html, /id="honey-scene-tag-history-edit"/);
    assert.match(html, /fa-solid fa-pen/);
    assert.match(honeyCssSource, /\.honey-scene-tag-editor-overlay/);
    assert.match(honeyCssSource, /\.honey-scene-tag-editor-textarea/);
});
