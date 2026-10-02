import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const settingsSource = fs.readFileSync(new URL('../apps/settings/settings-app.js', import.meta.url), 'utf8');
const appsSource = fs.readFileSync(new URL('../config/apps.js', import.meta.url), 'utf8');

test('X participates in app icon, name, and dock customization', () => {
    const start = settingsSource.indexOf('_getDefaultAppsForCustomization()');
    const end = settingsSource.indexOf('_getCustomAppNames()', start);
    assert.ok(start >= 0 && end > start, 'customizable app definitions should exist');

    const block = settingsSource.slice(start, end);
    assert.match(block, /id: 'x', name: 'X', icon: 'X', color: '#000000', defaultIcon: DEFAULT_APP_ICONS\.x/);
    assert.match(settingsSource, /renderAppIconUpload\(\)[\s\S]*this\._getDefaultAppsForCustomization\(\)/);
    assert.match(settingsSource, /renderAppNameCustomization\(\)[\s\S]*this\._getDefaultAppsForCustomization\(\)/);
    assert.match(settingsSource, /renderDockConfig\(\)[\s\S]*this\._getDefaultAppsForCustomization\(\)/);
});

test('X uses the bundled phone icon as its default', () => {
    assert.match(appsSource, /x:\s*new URL\('\.\.\/phone\/X\.png', import\.meta\.url\)\.href/);
    assert.doesNotMatch(appsSource, /apps\/x\/assets\/x-icon\.png/);
});

test('X participates in memory linkage permissions with social defaults', () => {
    const defaultsStart = settingsSource.indexOf('_getMemoryPermissionDefaults(appId)');
    const renderStart = settingsSource.indexOf('renderMemoryPermissionSection()', defaultsStart);
    const bindStart = settingsSource.indexOf('bindMemoryPermissionEvents()', renderStart);
    assert.ok(defaultsStart >= 0 && renderStart > defaultsStart && bindStart > renderStart);

    const defaultsBlock = settingsSource.slice(defaultsStart, renderStart);
    const renderBlock = settingsSource.slice(renderStart, bindStart);
    assert.match(defaultsBlock, /x:\s*\{\s*allowSummary:\s*true,\s*allowVector:\s*true\s*\}/);
    assert.match(renderBlock, /\{ id: 'x', name: 'X', desc: '公开动态与评论场景' \}/);
});
