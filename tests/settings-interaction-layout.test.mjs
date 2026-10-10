import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const settingsSource = fs.readFileSync(new URL('../apps/settings/settings-app.js', import.meta.url), 'utf8');

test('interaction help is always visible above the interaction fold', () => {
    const helpIndex = settingsSource.indexOf('<div data-settings-interaction-help class="yzp-settings-interaction-help">');
    const interactionFoldIndex = settingsSource.indexOf('<details data-settings-section="interaction"');
    assert.ok(helpIndex >= 0, 'standalone interaction help should exist');
    assert.ok(interactionFoldIndex > helpIndex, 'standalone help should render before the interaction fold');
    assert.match(
        settingsSource,
        /#tab-general > \.yzp-settings-interaction-help\s*\{/
    );
    assert.match(
        settingsSource,
        /data-settings-interaction-help[\s\S]*?<strong>使用说明：<\/strong>[\s\S]*?1\. 开启“互通模式”或“线上模式”，二选一[\s\S]*?2\. 互通模式为正文与小手机线上内容互通[\s\S]*?3\. 线上模式为小手机内容不与正文互通；线上模式分为同步现实时间\/同步剧情时间。[\s\S]*?4\. 线上注入设置不分“互通模式”或“线上模式”模式，仅为使用小手机上聊天时设置。/
    );
    assert.doesNotMatch(settingsSource, /📡 互动方式/);
    assert.match(
        settingsSource,
        /data-settings-interaction-mode-controls[\s\S]*?id="setting-wechat-interop-mode"/
    );
    assert.match(
        settingsSource,
        /interactionContent\.prepend\(interactionModeControls\)/
    );
    assert.doesNotMatch(settingsSource, /operationSection\?\.querySelector\('\[data-settings-interaction-help\]'\)/);
});

test('online mode and its dependent controls live in an independent fold', () => {
    assert.match(
        settingsSource,
        /data-settings-online-mode-controls[\s\S]*?<div class="setting-label">启用线上模式<\/div>[\s\S]*?id="setting-wechat-online-only-mode"[\s\S]*?\$\{wechatOnlineControlsHtml\}/
    );
    assert.match(
        settingsSource,
        /data-settings-section="online-mode"[\s\S]*?<span>📱 线上模式设置<\/span>[\s\S]*?data-settings-online-mode-content/
    );
    assert.match(
        settingsSource,
        /onlineModeContent\.prepend\(onlineModeControls\)/
    );
});

test('operation settings occupy the former offline section position', () => {
    assert.match(
        settingsSource,
        /data-settings-section="operation"[\s\S]*?<span>⚙️ 操作设置<\/span>/
    );
    assert.match(
        settingsSource,
        /generalTab\.insertBefore\(interactionSection, operationSection\);[\s\S]*generalTab\.insertBefore\(onlineModeSection, onlineInjectionSection\);[\s\S]*generalTab\.insertBefore\(operationSection, onlineInjectionSection\.nextSibling\);/
    );
});
