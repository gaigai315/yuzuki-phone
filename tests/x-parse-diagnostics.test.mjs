import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { XView } from '../apps/x/x-view.js';

const dataSource = fs.readFileSync(new URL('../apps/x/x-data.js', import.meta.url), 'utf8');
const viewSource = fs.readFileSync(new URL('../apps/x/x-view.js', import.meta.url), 'utf8');
const cssSource = fs.readFileSync(new URL('../apps/x/x.css', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../apps/x/x-app.js', import.meta.url), 'utf8');
const phoneShellSource = fs.readFileSync(new URL('../phone/phone-shell.js', import.meta.url), 'utf8');

test('X parse failures preserve raw and filtered AI responses', () => {
    assert.match(dataSource, /error\.xParseFailure\s*=\s*\{[\s\S]*?expectedFormat:[\s\S]*?rawText,[\s\S]*?cleanedText/);
});

test('X parse failure modal mounts the returned content and can be closed', () => {
    const previousDocument = globalThis.document;
    let mountedOverlay = null;
    const phoneScreen = {
        appendChild(node) {
            mountedOverlay = node;
        }
    };
    const overlay = {
        className: '',
        innerHTML: '',
        removed: false,
        addEventListener() {},
        remove() {
            this.removed = true;
        },
        querySelector(selector) {
            if (selector === '.xapp-ai-parse-error-dialog') return { focus() {} };
            return { addEventListener() {} };
        }
    };
    globalThis.document = {
        createElement() {
            return overlay;
        },
        querySelector(selector) {
            if (selector === '.phone-view-current .xapp-root') return {};
            if (selector === '#phone-panel-content .phone-screen') return phoneScreen;
            return null;
        }
    };

    try {
        const view = new XView({});
        const shown = view._showAIParseFailure({
            xParseFailure: {
                expectedFormat: '<Twitter>...</Twitter>',
                rawText: '<Twitter>原始回复</Twitter>',
                cleanedText: '过滤后的回复'
            }
        });

        assert.equal(shown, true);
        assert.equal(mountedOverlay, overlay);
        assert.match(overlay.innerHTML, /模型原始回复/);
        assert.match(overlay.innerHTML, /&lt;Twitter&gt;原始回复&lt;\/Twitter&gt;/);
        assert.match(overlay.innerHTML, /标签过滤后内容/);
        assert.match(overlay.innerHTML, /过滤后的回复/);
        assert.equal(view.closeAIParseFailure(), true);
        assert.equal(overlay.removed, true);
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});

test('X refresh failures expose the AI response in a scoped scrollable modal', () => {
    assert.match(viewSource, /_showAIParseFailure\(error\)/);
    assert.match(viewSource, /this\._showAIParseFailure\(error\)/);
    assert.match(viewSource, /模型原始回复/);
    assert.match(viewSource, /标签过滤后内容/);
    assert.match(viewSource, /class="xapp-ai-parse-error-response"/);
    assert.match(appSource, /this\.view\.closeAIParseFailure\?\.\(\)/);

    assert.match(
        cssSource,
        /#phone-panel-content \.phone-screen \.xapp-ai-parse-error-body\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?touch-action:\s*pan-y;[\s\S]*?overscroll-behavior:\s*contain;/
    );
    assert.match(
        cssSource,
        /#phone-panel-content \.phone-screen \.xapp-ai-parse-error-response\s*\{[\s\S]*?overflow:\s*auto;[\s\S]*?touch-action:\s*pan-y;[\s\S]*?overscroll-behavior:\s*contain;/
    );
    assert.match(phoneShellSource, /'\.xapp-ai-parse-error-body'/);
    assert.match(phoneShellSource, /'\.xapp-ai-parse-error-response'/);
});
