import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const dataSource = fs.readFileSync(new URL('../apps/album/album-data.js', import.meta.url), 'utf8');
const dataModuleUrl = `data:text/javascript;base64,${Buffer.from(dataSource).toString('base64')}`;
const { AlbumData } = await import(dataModuleUrl);
const promptManagerSource = fs.readFileSync(new URL('../config/prompt-manager.js', import.meta.url), 'utf8');
const promptManagerModuleUrl = `data:text/javascript;base64,${Buffer.from(promptManagerSource).toString('base64')}`;
const { PromptManager } = await import(promptManagerModuleUrl);

function createFixture() {
    let saveCount = 0;
    const context = {
        name1: 'User',
        name2: 'Character',
        chat: [
            { is_user: true, mes: 'Open the window.' },
            { is_user: false, mes: 'She opens the window and looks into the rain.', extra: {} },
            { is_user: true, mes: 'Turn around.' },
            {
                is_user: false,
                mes: 'She turns around under warm light.',
                extra: {
                    media: [
                        { type: 'image', url: '/images/first.png' },
                        { type: 'image', url: '/images/second.png' }
                    ],
                    media_index: 0
                }
            },
            { is_user: false, is_system: true, mes: 'System message.' },
            {
                is_user: false,
                mes: 'Legacy image floor.',
                extra: {
                    image: '/images/legacy.png',
                    image_swipes: ['/images/swipe-a.png', '/images/swipe-b.png']
                }
            }
        ],
        async saveChat() {
            saveCount += 1;
        }
    };
    const data = new AlbumData({ getContext: () => context });
    return { context, data, getSaveCount: () => saveCount };
}

test('story floor browser keeps assistant floors without images and honors selected media', () => {
    const { data } = createFixture();
    const floors = data.getStoryFloors();

    assert.deepEqual(floors.map(item => item.floor), [1, 3, 5]);
    assert.equal(floors[0].imageUrl, '');
    assert.equal(floors[1].imageUrl, '/images/first.png');
    assert.deepEqual(floors[1].images, ['/images/first.png', '/images/second.png']);
    assert.equal(floors[2].imageUrl, '/images/legacy.png');
});

test('story tag source includes the preceding user floor and selected assistant text', () => {
    const { data } = createFixture();
    const source = data.getStoryTagSource(3);

    assert.equal(source.previousUserText, 'Turn around.');
    assert.equal(source.messageText, 'She turns around under warm light.');
    assert.equal(source.userName, 'User');
    assert.equal(source.characterName, 'Character');
});

test('story tags and generated image are saved into the target Tavern message', async () => {
    const { context, data, getSaveCount } = createFixture();
    const expectedMessage = context.chat[1];

    await data.setStoryFloorTags(1, '1girl, rain, looking outside', expectedMessage);
    await data.attachStoryFloorImage(1, '/backgrounds/phone_story_image_1_test.png', {
        tags: '1girl, rain, looking outside',
        provider: 'novelai',
        model: 'nai-diffusion-4'
    }, expectedMessage);

    const extra = context.chat[1].extra;
    assert.equal(extra.phone_story_image.tags, '1girl, rain, looking outside');
    assert.equal(extra.phone_story_image.provider, 'novelai');
    assert.equal(extra.phone_story_image.imageUrl, '/backgrounds/phone_story_image_1_test.png');
    assert.equal(extra.media, undefined);
    assert.equal(extra.media_index, undefined);
    assert.equal(extra.inline_image, undefined);
    assert.equal(getSaveCount(), 2);
});

test('story image settings use the dedicated automatic key without migrating the old switch', () => {
    const reads = [];
    const data = new AlbumData({
        get(key, fallback) {
            reads.push(key);
            if (key === 'phone-story-image-enabled') return true;
            return fallback;
        }
    });

    assert.deepEqual(data.getStoryImageSettings(), {
        autoEnabled: false,
        completionNoticeEnabled: true
    });
    assert.ok(reads.includes('phone-story-image-auto-enabled'));
    assert.ok(!reads.includes('phone-story-image-enabled'));
});

test('story images and tags stop matching after the selected swipe changes', async () => {
    const { context, data } = createFixture();
    const message = context.chat[1];
    message.swipes = [message.mes, 'She closes the window and sits beside the fire.'];
    message.swipe_id = 0;

    await data.setStoryFloorTags(1, 'rain, window', message);
    await data.attachStoryFloorImage(1, '/backgrounds/phone_story_image_branch_a.png', {
        tags: 'rain, window'
    }, message);

    message.swipe_id = 1;
    message.mes = message.swipes[1];
    assert.equal(data.getStoryFloor(1).imageUrl, '');
    assert.equal(data.getStoryFloor(1).tags, '');

    await data.setStoryFloorTags(1, 'fireplace, sitting', message);
    assert.equal(data.getStoryFloor(1).tags, 'fireplace, sitting');
    assert.equal(data.getStoryFloor(1).imageUrl, '');
    assert.equal(message.extra.phone_story_image.imageUrl, undefined);
});

test('re-generating a story image replaces the phone-only floor image', async () => {
    const { context, data } = createFixture();

    await data.attachStoryFloorImage(1, '/backgrounds/phone_story_image_old.png');
    await data.attachStoryFloorImage(1, '/backgrounds/phone_story_image_new.png');

    assert.equal(context.chat[1].extra.phone_story_image.imageUrl, '/backgrounds/phone_story_image_new.png');
    assert.equal(context.chat[1].extra.media, undefined);
});

test('legacy inline story images are removed while unrelated Tavern media remains', async () => {
    const { context, data, getSaveCount } = createFixture();
    context.chat[3].extra.phone_story_image = {
        imageUrl: '/backgrounds/phone_story_image_3_new.png',
        tags: 'warm light'
    };
    context.chat[3].extra.media = [
        { type: 'image', url: '/images/keep.png', source: 'Tavern' },
        { type: 'image', url: '/backgrounds/phone_story_image_3_old.png', source: '正文生图' },
        { type: 'image', url: '/backgrounds/phone_story_image_3_new.png', title: '正文第 3 楼' }
    ];
    context.chat[3].extra.media_index = 0;
    context.chat[3].extra.inline_image = true;

    const changed = await data.migrateLegacyStoryInlineMedia();

    assert.equal(changed, true);
    assert.deepEqual(context.chat[3].extra.media, [
        { type: 'image', url: '/images/keep.png', source: 'Tavern' }
    ]);
    assert.equal(context.chat[3].extra.media_index, 0);
    assert.equal(context.chat[3].extra.inline_image, true);
    assert.equal(getSaveCount(), 1);
});

test('legacy story-only media fields are deleted during migration', async () => {
    const { context, data } = createFixture();
    context.chat[1].extra = {
        phone_story_image: { imageUrl: '/backgrounds/phone_story_image_1.png' },
        media: [
            { type: 'image', url: '/backgrounds/phone_story_image_1.png', source: '正文生图' },
            { type: 'image', url: '/backgrounds/phone_story_image_1_old.png', source: '正文生图' }
        ],
        media_index: 1,
        inline_image: true
    };

    await data.migrateLegacyStoryInlineMedia();

    assert.equal(context.chat[1].extra.media, undefined);
    assert.equal(context.chat[1].extra.media_index, undefined);
    assert.equal(context.chat[1].extra.inline_image, undefined);
    assert.equal(data.getStoryFloor(1).imageUrl, '/backgrounds/phone_story_image_1.png');
});

test('story writes reject a floor that changed while generation was running', async () => {
    const { context, data } = createFixture();
    const staleMessage = context.chat[1];
    context.chat[1] = { is_user: false, mes: 'Regenerated branch.', extra: {} };

    await assert.rejects(
        data.setStoryFloorTags(1, 'rainy scene', staleMessage),
        /楼层已变化/
    );
});

test('deleting an album image clears the matching Tavern floor media reference', async () => {
    const { context, data, getSaveCount } = createFixture();
    context.chat[3].extra.phone_story_image = { imageUrl: '/images/first.png', tags: 'warm light' };

    await data._cleanupStoryMessageReferences('/images/first.png');

    assert.deepEqual(context.chat[3].extra.media, [
        { type: 'image', url: '/images/second.png' }
    ]);
    assert.equal(context.chat[3].extra.media_index, 0);
    assert.equal(context.chat[3].extra.phone_story_image.imageUrl, undefined);
    assert.equal(context.chat[3].extra.phone_story_image.tags, 'warm light');
    assert.equal(getSaveCount(), 1);
});

test('floating double-click opens the standalone story image card without opening the phone drawer', () => {
    const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const appSource = fs.readFileSync(new URL('../apps/album/album-app.js', import.meta.url), 'utf8');
    const viewSource = fs.readFileSync(new URL('../apps/album/album-view.js', import.meta.url), 'utf8');
    const overlaySource = fs.readFileSync(new URL('../apps/album/story-image-overlay.js', import.meta.url), 'utf8');
    const handlerStart = indexSource.indexOf('async function activateStoryImageBrowserFromFloatingEntry()');
    const handlerEnd = indexSource.indexOf('function syncPhoneFloatingEntry()', handlerStart);
    const handlerSource = indexSource.slice(handlerStart, handlerEnd);

    assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
    assert.match(handlerSource, /openStoryImageBrowser\(\)/);
    assert.doesNotMatch(handlerSource, /toggleDrawer\(/);
    assert.doesNotMatch(handlerSource, /phone:openApp/);
    assert.match(appSource, /appId: 'story'/);
    assert.match(appSource, /app: 'story'/);
    assert.match(appSource, /await this\._waitForCSS\(\)/);
    assert.match(appSource, /this\.storyImageOverlay\.open\(options\)/);
    assert.match(overlaySource, /document\.documentElement\.appendChild\(root\)/);
    assert.match(overlaySource, /phone-story-image-nav is-prev/);
    assert.match(overlaySource, /phone-story-image-nav is-next/);
    assert.match(overlaySource, /phone-story-image-back/);
    assert.match(overlaySource, /phone-story-image-tag-edit/);
    assert.match(overlaySource, /saveStoryTags\(floor\.floor/);
    assert.match(overlaySource, /getCurrentStoryImageProvider/);
    assert.match(overlaySource, /currentProvider[\s\S]*floor\.provider/);
    assert.match(overlaySource, /生成 Tags/);
    assert.match(overlaySource, /fa-pencil/);
    assert.match(overlaySource, /phone-story-image-flip/);
    assert.match(overlaySource, /fa-rotate/);
    assert.doesNotMatch(overlaySource, /<span>Tags<\/span>/);
    assert.match(overlaySource, /naturalWidth/);
    assert.match(overlaySource, /availableHeight/);
    assert.match(overlaySource, /fitEmptyStage\(stage\)/);
    assert.match(overlaySource, /scheduleStageFit\(\)/);
    assert.match(overlaySource, /window\.visualViewport\?\.height/);
    assert.match(overlaySource, /stopHostTouchGesture/);
    assert.match(overlaySource, /--phone-story-image-empty-height/);
    assert.match(overlaySource, /outerHeight\(card\.querySelector\('\.phone-story-image-actions'\)\)/);
    assert.doesNotMatch(overlaySource, /viewportHeight \* 0\.64/);
    assert.doesNotMatch(overlaySource, /\$\{floorIndex \+ 1\}\s*\/\s*\$\{floors\.length\}/);
    assert.match(viewSource, /id="album-open-settings"/);
});

test('story image settings own a dedicated worldbook selector and override prompt editor', () => {
    const viewSource = fs.readFileSync(new URL('../apps/album/album-view.js', import.meta.url), 'utf8');
    const shellSource = fs.readFileSync(new URL('../phone/phone-shell.js', import.meta.url), 'utf8');

    assert.match(viewSource, /id="album-story-use-worldbook"/);
    assert.match(viewSource, /id="album-story-worldbook-list"/);
    assert.match(viewSource, /renderWorldbookSelector\(worldbookList, 'story'\)/);
    assert.match(viewSource, /setEnabled\?\.\('story', enabled\)/);
    assert.match(viewSource, /id="album-story-override-prompt"/);
    assert.match(viewSource, /<button type="button" class="phone-prompt-fold-header" data-no-swipe-back/);
    assert.match(viewSource, /event\.target\?\.closest\?\.\('button, label, input, select, textarea, \[role="button"\]'\)/);
    assert.match(viewSource, /renderPromptPresetControls\?\.\('story', 'override'\)/);
    assert.match(viewSource, /bindPromptPresetControls\?\.\(root, 'story', 'override'/);
    assert.match(shellSource, /\.album-story-worldbook-list/);
    assert.match(shellSource, /\.album-story-prompt-editor/);
});

test('story image override prompt is registered in the default prompt manager', () => {
    const manager = new PromptManager({ get: () => null, set: async () => {} });
    const prompt = manager.getDefaultPrompts().story?.override;
    const appSource = fs.readFileSync(new URL('../apps/album/album-app.js', import.meta.url), 'utf8');

    assert.equal(prompt?.enabled, true);
    assert.equal(prompt?.name, '🧩 正文生图破限词');
    assert.match(prompt?.content || '', /You create image-generation tags from one selected story floor\./);
    assert.doesNotMatch(appSource, /You create image-generation tags from one selected story floor\./);
});

test('story image card uses the natural image ratio without black side backgrounds', () => {
    const cssSource = fs.readFileSync(new URL('../apps/album/album.css', import.meta.url), 'utf8');

    assert.match(cssSource, /\.phone-story-image-stage\.has-loaded-image/);
    assert.match(cssSource, /\.phone-story-image-stage\.has-fitted-empty\s*\{[^}]*height:\s*var\(--phone-story-image-empty-height\)/s);
    assert.match(cssSource, /--phone-story-image-fitted-width/);
    assert.match(cssSource, /\.phone-story-image-front\.has-image\s*\{[^}]*background:\s*transparent/s);
    assert.doesNotMatch(cssSource, /\.phone-story-image-front img\s*\{[^}]*background:\s*#171a1e/s);
    assert.match(cssSource, /\.phone-story-image-card-header\s*\{[^}]*flex-basis:\s*34px[^}]*min-height:\s*34px/s);
    assert.match(cssSource, /\.phone-story-image-card-body\s*\{[^}]*padding:\s*0 12px 12px/s);
});

test('story image card is top-aligned below the tavern toolbar on mobile', () => {
    const cssSource = fs.readFileSync(new URL('../apps/album/album.css', import.meta.url), 'utf8');
    const mobileRules = cssSource.match(/@media \(max-width: 600px\), \(pointer: coarse\) \{([\s\S]*?)\n\}/)?.[1] || '';

    assert.match(mobileRules, /#phone-story-image-overlay-root\s*\{[^}]*--phone-story-image-mobile-top-offset:\s*calc\(36px \+ env\(safe-area-inset-top\)\)[^}]*place-items:\s*start center/s);
    assert.match(mobileRules, /\.phone-story-image-card\s*\{[^}]*max-height:\s*calc\(100dvh - var\(--phone-story-image-mobile-top-offset\) - var\(--phone-story-image-mobile-bottom-offset\)\)/s);
    assert.match(mobileRules, /\.phone-story-image-nav\s*\{[^}]*top:\s*auto[^}]*bottom:\s*-59px[^}]*width:\s*32px[^}]*transform:\s*none/s);
    assert.match(mobileRules, /\.phone-story-image-nav\.is-prev\s*\{[^}]*left:\s*0/s);
    assert.match(mobileRules, /\.phone-story-image-nav\.is-next\s*\{[^}]*right:\s*0/s);
});

test('automatic story image integration waits for phone and Memory work and invalidates branch changes', () => {
    const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const tagsCall = indexSource.indexOf('albumApp.generateStoryTags(task.floor');
    const imageCall = indexSource.indexOf('albumApp.generateStoryImage(task.floor');

    assert.ok(tagsCall >= 0 && imageCall > tagsCall);
    assert.match(indexSource, /TaskRunner\?\.isBackgroundWorkPending/);
    assert.match(indexSource, /StoryDirectorRuntime\?\.isRunning/);
    assert.match(indexSource, /scheduleStoryImageAutoForMessage\(context, index, message\)/);
    assert.match(indexSource, /invalidateStoryImageAutoFromFloor\(deletedFloor, 'message-deleted'\)/);
    assert.match(indexSource, /invalidateStoryImageAutoFromFloor\(id, 'message-swiped'\)/);
    assert.match(indexSource, /interruptStoryImageAutoForForegroundGeneration/);
});

test('story tag generation uses the phone LLM API and stores returned tags', async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const message = { is_user: false, mes: 'A rainy scene.', extra: {} };
    let savedTags = '';
    let callOptions = null;
    let requestMessages = null;
    let worldbookAppKey = '';
    let memoryFilterCallCount = 0;
    globalThis.window = {
        addEventListener() {},
        power_user: {},
        YuzukiMemory: {
            TaskRunner: {
                filterContentByTags(content) {
                    memoryFilterCallCount += 1;
                    return String(content || '').replace(/<memory-hidden>[\s\S]*?<\/memory-hidden>/gi, '');
                }
            }
        },
        VirtualPhone: {
            apiManager: {
                async callAI(messages, options) {
                    requestMessages = messages;
                    callOptions = options;
                    return { success: true, summary: '女性，雨夜街道，looking back' };
                }
            },
            promptManager: {
                ensureLoaded() {},
                renderPromptForFeature(app, feature) {
                    assert.equal(app, 'story');
                    assert.equal(feature, 'override');
                    return 'STORY OVERRIDE PROMPT';
                }
            },
            worldbookManager: {
                async appendWorldbookMessages(messages, appKey) {
                    worldbookAppKey = appKey;
                    messages.push({
                        role: 'system',
                        content: 'SELECTED STORY WORLDBOOK',
                        name: 'SYSTEM (世界书)',
                        isPhoneMessage: true
                    });
                }
            }
        }
    };
    globalThis.document = {
        hidden: false,
        head: { appendChild() {} },
        addEventListener() {},
        getElementById(id) {
            return id === 'persona_description' ? { value: 'User persona details.' } : null;
        },
        createElement() { return {}; }
    };

    try {
        const { AlbumApp } = await import(`../apps/album/album-app.js?test=${Date.now()}`);
        const storage = {
            get(key, fallback) {
                if (key === 'phone_tag_filter_enabled') return true;
                if (key === 'phone_tag_filter_blacklist') return 'thinking';
                if (key === 'phone_tag_filter_whitelist') return '';
                return fallback;
            }
        };
        const app = new AlbumApp({ showNotification() {} }, storage);
        app.albumData = {
            getStoryImageSettings: () => ({ autoEnabled: false, completionNoticeEnabled: true }),
            getStoryFloor: () => ({ floor: 7, message }),
            _getContext: () => ({
                name1: 'User',
                name2: 'Character',
                characterId: 0,
                characters: [{
                    name: 'Character',
                    description: 'Character description.',
                    personality: 'Quiet and observant.',
                    scenario: 'Rainy city.'
                }]
            }),
            getStoryTagSource: () => ({
                floor: 7,
                message,
                messageText: '<thinking>PHONE HIDDEN</thinking><memory-hidden>MEMORY HIDDEN</memory-hidden>A rainy scene.',
                previousUserText: '<thinking>USER HIDDEN</thinking>Look back.',
                userName: 'User',
                characterName: 'Character'
            }),
            async setStoryFloorTags(_floor, tags, expectedMessage) {
                assert.equal(expectedMessage, message);
                savedTags = tags;
            }
        };
        await app.generateStoryTags(7);

        assert.equal(callOptions.appId, 'story');
        assert.equal(callOptions.stream, false);
        assert.equal(worldbookAppKey, 'story');
        assert.deepEqual(requestMessages.map(item => item.name || item.role), [
            'SYSTEM (正文生图破限词)',
            'SYSTEM (角色卡)',
            'SYSTEM (用户Persona)',
            'SYSTEM (世界书)',
            'user'
        ]);
        assert.equal(requestMessages[0].content, 'STORY OVERRIDE PROMPT');
        assert.match(requestMessages[1].content, /Character description\./);
        assert.match(requestMessages[2].content, /User persona details\./);
        assert.equal(requestMessages[3].content, 'SELECTED STORY WORLDBOOK');
        assert.match(requestMessages[4].content, /Selected story floor 7/);
        assert.match(requestMessages[4].content, /Look back\./);
        assert.match(requestMessages[4].content, /A rainy scene\./);
        assert.doesNotMatch(requestMessages[4].content, /PHONE HIDDEN|USER HIDDEN|MEMORY HIDDEN/);
        assert.equal(memoryFilterCallCount, 2);
        assert.equal(savedTags, '女性, 雨夜街道, looking back');
        assert.equal(app.storyImageOverlay.tagBackFloors.has(7), true);
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
    }
});

test('manual story tag edits persist and show the provider currently bound to story images', async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const message = { is_user: false, mes: 'A rainy scene.', extra: {} };
    let savedTags = '';
    globalThis.window = {
        addEventListener() {},
        VirtualPhone: {
            imageGenerationManager: {
                storage: null,
                resolveProvider(options) {
                    assert.deepEqual(options, { app: 'story' });
                    return 'comfyui';
                }
            }
        }
    };
    globalThis.document = {
        hidden: false,
        head: { appendChild() {} },
        addEventListener() {},
        getElementById() { return null; },
        createElement() { return {}; }
    };

    try {
        const { AlbumApp } = await import(`../apps/album/album-app.js?test=tag-edit-${Date.now()}`);
        const storage = {};
        const app = new AlbumApp({ showNotification() {} }, storage);
        app.albumData = {
            getStoryFloor: () => ({ floor: 7, message, tags: 'old tags' }),
            async setStoryFloorTags(_floor, tags, expectedMessage) {
                assert.equal(expectedMessage, message);
                savedTags = tags;
            }
        };

        const result = await app.saveStoryTags(7, ' 1girl；雨夜\nlooking back ');

        assert.equal(result.success, true);
        assert.equal(result.tags, '1girl, 雨夜, looking back');
        assert.equal(savedTags, result.tags);
        assert.equal(app.getCurrentStoryImageProvider(), 'comfyui');
        assert.equal(window.VirtualPhone.imageGenerationManager.storage, storage);
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
    }
});

test('story image generation uses the story provider route, uploads the result, and attaches it to the floor', async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const message = { is_user: false, mes: 'A rainy scene.', extra: {} };
    let generationOptions = null;
    let attached = null;
    globalThis.window = {
        addEventListener() {},
        VirtualPhone: {
            imageGenerationManager: {
                storage: null,
                async generate(options) {
                    generationOptions = options;
                    return {
                        provider: 'novelai',
                        model: 'nai-diffusion-4',
                        imageUrl: 'data:image/png;base64,AAAA'
                    };
                }
            },
            imageManager: {
                async _uploadToServer(_imageData, prefix) {
                    return `/backgrounds/phone_${prefix}.png`;
                }
            }
        }
    };
    globalThis.document = {
        hidden: false,
        head: { appendChild() {} },
        addEventListener() {},
        getElementById() { return null; },
        createElement() { return {}; }
    };

    try {
        const { AlbumApp } = await import(`../apps/album/album-app.js?test=image-${Date.now()}`);
        const storage = {};
        const app = new AlbumApp({ showNotification() {} }, storage);
        app.albumData = {
            getStoryImageSettings: () => ({ autoEnabled: false, completionNoticeEnabled: false }),
            getStoryFloor: () => ({ floor: 7, message, tags: '' }),
            async setStoryFloorTags(_floor, _tags, expectedMessage) {
                assert.equal(expectedMessage, message);
            },
            async attachStoryFloorImage(floor, imageUrl, details, expectedMessage) {
                attached = { floor, imageUrl, details, expectedMessage };
            }
        };
        app.storyImageOverlay.showTagBack(7);

        await app.generateStoryImage(7, '1girl, rainy street');

        assert.equal(generationOptions.app, 'story');
        assert.equal(generationOptions.prompt, '1girl, rainy street');
        assert.equal(generationOptions.signal, undefined);
        assert.equal(window.VirtualPhone.imageGenerationManager.storage, storage);
        assert.equal(attached.floor, 7);
        assert.match(attached.imageUrl, /^\/backgrounds\/phone_story_image_7_/);
        assert.equal(attached.details.provider, 'novelai');
        assert.equal(attached.expectedMessage, message);
        assert.equal(app.storyImageOverlay.tagBackFloors.has(7), false);
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
    }
});
