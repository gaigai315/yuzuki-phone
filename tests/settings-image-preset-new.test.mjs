import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const settingsSource = fs.readFileSync(new URL('../apps/settings/settings-app.js', import.meta.url), 'utf8');

function getHandlerBlock(startMarker, endMarker) {
    const start = settingsSource.indexOf(startMarker);
    const end = settingsSource.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `${startMarker} handler should exist`);
    return settingsSource.slice(start, end);
}

test('new NAI preset starts with an empty prompt draft', () => {
    const block = getHandlerBlock(
        "imagePromptPresetNewBtn?.addEventListener('click'",
        "imagePromptPresetDeleteBtn?.addEventListener('click'"
    );

    assert.match(block, /active-prompt-preset`, ''\)/);
    assert.match(block, /await setImagePromptForm\(\{\}\);/);
});

test('new GPT preset starts with an empty prompt draft', () => {
    const block = getHandlerBlock(
        "imageOpenaiPresetNewBtn?.addEventListener('click'",
        "imageOpenaiPresetDeleteBtn?.addEventListener('click'"
    );

    assert.match(block, /const emptyForm = \{ fixedPrompt: '', fixedPromptEnd: '', negativePrompt: '' \};/);
    assert.match(block, /imageFixedPromptInput\.value = ''/);
    assert.match(block, /imageFixedPromptEndInput\.value = ''/);
    assert.match(block, /imageNegativePromptInput\.value = ''/);
    assert.match(block, /await saveOpenAIImagePromptDraft\(appKey, emptyForm\);/);
});

test('expanded prompt editor closes only when the pointer starts and ends on its backdrop', () => {
    const block = getHandlerBlock(
        'const showImagePromptPresetTextModal =',
        'const refreshImagePromptAppPanel ='
    );

    assert.match(block, /let overlayPointerStartedOnBackdrop = false/);
    assert.match(block, /overlay\.addEventListener\('pointerdown'/);
    assert.match(block, /overlayPointerStartedOnBackdrop = e\.target === overlay/);
    assert.match(block, /overlayPointerStartedOnBackdrop && e\.target === overlay/);
    assert.match(block, /overlayPointerStartedOnBackdrop = false/);
});
