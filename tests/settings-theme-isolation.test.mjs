import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const settingsSource = fs.readFileSync(new URL('../apps/settings/settings-app.js', import.meta.url), 'utf8');
const phoneCssSource = fs.readFileSync(new URL('../phone.css', import.meta.url), 'utf8');

test('ComfyUI storage textareas remain hidden from broad host theme rules', () => {
    assert.match(
        settingsSource,
        /id="phone-image-comfyui-workflow" class="phone-image-comfyui-hidden-storage"[^>]*hidden/
    );
    assert.match(
        settingsSource,
        /id="phone-image-comfyui-node-mapping" class="phone-image-comfyui-hidden-storage"[^>]*hidden/
    );
    assert.match(
        phoneCssSource,
        /#phone-panel-content \.phone-screen \.settings-app #phone-image-comfyui-workflow,[\s\S]*#phone-image-comfyui-node-mapping,[\s\S]*textarea\.phone-image-comfyui-hidden-storage\s*\{\s*display:\s*none\s*!important;/
    );
});

test('API model controls resist host themes that force every select to display', () => {
    assert.match(
        settingsSource,
        /id="phone-api-model-select" hidden/
    );
    assert.match(
        settingsSource,
        /#yzp-settings-app\.yzp-settings-safe-render #phone-api-model\[hidden\],[\s\S]*#phone-api-model-select\[hidden\]\s*\{\s*display:\s*none\s*!important;/
    );
    assert.match(
        settingsSource,
        /const setModelControlMode = \(showSelect\) => \{[\s\S]*modelInput\.hidden = showSelect;[\s\S]*modelSelect\.hidden = !showSelect;/
    );
});
