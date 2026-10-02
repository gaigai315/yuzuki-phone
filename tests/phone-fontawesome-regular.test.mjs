import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const phoneCssSource = fs.readFileSync(new URL('../phone.css', import.meta.url), 'utf8');
const xCssSource = fs.readFileSync(new URL('../apps/x/x.css', import.meta.url), 'utf8');
const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const regularFontUrl = new URL('../assets/vendor/fontawesome/fa-regular-400.woff2', import.meta.url);
const licenseUrl = new URL('../assets/vendor/fontawesome/LICENSE.txt', import.meta.url);

test('phone bundles a non-empty Font Awesome Regular font and its license', () => {
    assert.equal(fs.existsSync(regularFontUrl), true);
    assert.ok(fs.statSync(regularFontUrl).size > 1000);
    assert.equal(fs.existsSync(licenseUrl), true);
});

test('all phone regular icon classes use the bundled font without affecting the host UI', () => {
    assert.match(
        phoneCssSource,
        /@font-face\s*\{[\s\S]*font-family:\s*"Yuzuki Phone Font Awesome 6 Free";[\s\S]*font-weight:\s*400;[\s\S]*fa-regular-400\.woff2/
    );
    assert.match(
        phoneCssSource,
        /:is\([\s\S]*#phone-panel-content,[\s\S]*#music-floating-root,[\s\S]*#phone-story-image-overlay-root,[\s\S]*#phone-sms-popup-root[\s\S]*\) :is\(\.fa-regular, \.far\)::before\s*\{[\s\S]*font-family:\s*"Yuzuki Phone Font Awesome 6 Free"\s*!important;[\s\S]*font-weight:\s*400\s*!important;/
    );
    assert.doesNotMatch(phoneCssSource, /(?:^|\n)\s*\.fa-regular\s*\{/);
    assert.doesNotMatch(xCssSource, /\.xapp-root \.fa-regular\s*\{/);
});

test('runtime-injected phone CSS resolves the bundled font against the extension URL', () => {
    assert.match(
        indexSource,
        /const ST_PHONE_REGULAR_FONT_URL = new URL\('\.\/assets\/vendor\/fontawesome\/fa-regular-400\.woff2', import\.meta\.url\)\.href;/
    );
    assert.match(
        indexSource,
        /finalCssText = finalCssText\.replaceAll\([\s\S]*'\.\/assets\/vendor\/fontawesome\/fa-regular-400\.woff2',[\s\S]*ST_PHONE_REGULAR_FONT_URL[\s\S]*\);/
    );
});
