import assert from 'node:assert/strict';
import test from 'node:test';
import { HomeScreen } from '../phone/home-screen.js';

for (const eventName of ['phone:updateAppIcon', 'phone:updateWallpaper', 'phone:updateHomeCss']) {
    test(`${eventName} keeps the active app open and refreshes the cached desktop on return`, () => {
        const previousWindow = globalThis.window;
        const listeners = new Map();
        globalThis.window = { addEventListener: (name, handler) => listeners.set(name, handler) };
        try {
            const home = Object.create(HomeScreen.prototype);
            let activeView = 'settings';
            let renders = 0;
            let restores = 0;
            const history = ['home', 'settings'];
            const cachedHome = { closest: () => ({ classList: {
                contains: name => name === 'phone-view-current' && activeView === 'home'
            } }) };
            home.phoneShell = {
                screen: { querySelector: () => cachedHome, querySelectorAll: () => [] },
                restoreView: () => { restores++; return true; }
            };
            home._pickHomeClockKaomoji = home.updateHomeCssData = home._bindAppBadgeLayout = () => {};
            home.applyHomeCustomCss = () => {};
            home.render = options => {
                assert.equal(options.forceDomRefresh, true);
                renders++;
                activeView = 'home';
                home._homeNeedsRefresh = false;
            };
            home.bindEvents();
            assert.equal(home.isHomeScreenVisible(), false, 'cached desktop is not the active page');
            listeners.get(eventName)({});
            listeners.get(eventName)({});
            assert.equal(activeView, 'settings');
            assert.deepEqual(history, ['home', 'settings']);
            assert.equal(renders, 0);
            assert.equal(home._homeNeedsRefresh, true);

            // 只有用户主动返回时才重绘桌面，多次后台变更合并为一次。
            home.restore();
            assert.equal(activeView, 'home');
            assert.equal(renders, 1);
            assert.equal(restores, 0, 'must not restore stale cached icon markup');
            assert.equal(home._homeNeedsRefresh, false);

            listeners.get(eventName)({});
            assert.equal(renders, 2, 'visible desktop still updates immediately');
        } finally {
            globalThis.window = previousWindow;
        }
    });
}

test('appearance changes while no desktop is cached wait for an explicit desktop render', () => {
    const home = Object.create(HomeScreen.prototype);
    home.phoneShell = { screen: { querySelector: () => null } };
    home.render = () => { throw new Error('must not navigate away from the active app'); };
    home.refreshAppearance();
    assert.equal(home._homeNeedsRefresh, true);
});
