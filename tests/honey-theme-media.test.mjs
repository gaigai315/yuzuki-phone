import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../apps/honey/honey-view.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { HoneyView } = await import(moduleUrl);

const createView = (initialUrl = '/backgrounds/honey-theme-missing.mp4') => {
    let savedUrl = initialUrl;
    const notifications = [];
    const view = Object.create(HoneyView.prototype);
    view._failedThemeMediaUrls = new Set();
    view.app = {
        honeyData: {
            getRecommendBgMedia: () => savedUrl,
            saveRecommendBgMedia: value => {
                savedUrl = value || null;
            }
        },
        phoneShell: {
            showNotification: (...args) => notifications.push(args)
        }
    };
    return {
        view,
        notifications,
        getSavedUrl: () => savedUrl
    };
};

test('failed Honey theme media is suppressed during later renders', () => {
    const { view } = createView();

    view._rememberFailedThemeMediaUrl('/backgrounds/honey-theme-missing.mp4');

    assert.deepEqual(view._getHoneyThemeBackgroundMedia(), {
        url: '',
        isVideo: false
    });
    assert.equal(view._buildHoneyThemeBackgroundHtml(), '');
});

test('theme media failure clears the stale saved path and removes the broken element', () => {
    const { view, notifications, getSavedUrl } = createView();
    let paused = false;
    let removed = false;
    let removedSrc = false;
    let soundButtonRemoved = false;
    const root = {
        querySelector: selector => selector === '#honey-bg-sound-btn'
            ? { remove: () => { soundButtonRemoved = true; } }
            : null
    };
    const media = {
        currentSrc: '/backgrounds/honey-theme-missing.mp4',
        getAttribute: () => '/backgrounds/honey-theme-missing.mp4',
        closest: () => root,
        pause: () => { paused = true; },
        removeAttribute: name => { if (name === 'src') removedSrc = true; },
        remove: () => { removed = true; }
    };

    assert.equal(view._handleHoneyThemeMediaFailure(media), true);
    assert.equal(getSavedUrl(), null);
    assert.equal(paused, true);
    assert.equal(removedSrc, true);
    assert.equal(removed, true);
    assert.equal(soundButtonRemoved, true);
    assert.equal(notifications.length, 1);
});

test('NotSupportedError clears theme video instead of reporting an autoplay block', async () => {
    const { view, getSavedUrl } = createView();
    const media = {
        dataset: {},
        isConnected: true,
        error: null,
        currentSrc: '/backgrounds/honey-theme-missing.mp4',
        getAttribute: () => '/backgrounds/honey-theme-missing.mp4',
        closest: () => null,
        pause: () => {},
        removeAttribute: () => {},
        remove: () => {},
        play: () => Promise.reject(Object.assign(new Error('no supported source'), { name: 'NotSupportedError' }))
    };

    view._ensureRecommendVideoAutoplay(media);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(getSavedUrl(), null);
    assert.equal(view._isFailedThemeMediaUrl('/backgrounds/honey-theme-missing.mp4'), true);
});
