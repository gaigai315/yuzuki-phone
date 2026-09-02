import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs
    .readFileSync(new URL('../config/image-generation-manager.js', import.meta.url), 'utf8')
    .replace(
        "import { decompress as decompressZstd } from '../assets/vendor/fzstd.js';",
        'const decompressZstd = () => new Uint8Array();'
    );
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { ImageGenerationManager } = await import(moduleUrl);
const manager = new ImageGenerationManager(null);

test('NovelAI character parser supports foreground and background depth positions', () => {
    const parsed = manager._parseNovelAICharacterPromptSyntax(
        '{人物 1girl, black hair, {位置前} 人物}, {人物 1boy, blond hair, {位置后} 人物}'
    );

    assert.equal(parsed.useCoords, true);
    assert.deepEqual(parsed.characters, [
        {
            charCaption: '1girl, black hair, foreground',
            negativeCaption: '',
            center: { x: 0.5, y: 0.7 }
        },
        {
            charCaption: '1boy, blond hair, background',
            negativeCaption: '',
            center: { x: 0.5, y: 0.3 }
        }
    ]);
});

test('NovelAI character parser keeps existing upper and lower positions unchanged', () => {
    const parsed = manager._parseNovelAICharacterPromptSyntax(
        '{人物 1girl, {位置上} 人物}, {人物 1boy, {位置下} 人物}'
    );

    assert.equal(parsed.useCoords, true);
    assert.deepEqual(parsed.characters.map(item => item.center), [
        { x: 0.5, y: 0.3 },
        { x: 0.5, y: 0.7 }
    ]);
});

test('NovelAI character parser disables all coordinates when one position is unknown', () => {
    const parsed = manager._parseNovelAICharacterPromptSyntax(
        '{人物 1girl, {位置中} 人物}, {人物 1boy, {位置未知} 人物}'
    );
    const charCaptions = manager._buildNovelAICharCaptions(parsed.characters, 'charCaption');

    assert.equal(parsed.useCoords, false);
    assert.deepEqual(parsed.characters.map(item => item.center), [null, null]);
    assert.equal(charCaptions.some(item => Object.hasOwn(item, 'centers')), false);
});
