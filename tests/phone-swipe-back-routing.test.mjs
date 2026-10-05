import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const readSource = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const phoneShellSource = readSource('../phone/phone-shell.js');
const phoneCssSource = readSource('../phone.css');
const mofoViewSource = readSource('../apps/mofo/mofo-view.js');
const weiboAppSource = readSource('../apps/weibo/weibo-app.js');
const controllers = new Map([
    ['wechat', ['微信', readSource('../apps/wechat/wechat-app.js')]],
    ['weibo', ['微博', readSource('../apps/weibo/weibo-app.js')]],
    ['x', ['X', readSource('../apps/x/x-app.js')]],
    ['honey', ['蜜语', readSource('../apps/honey/honey-app.js')]],
    ['mofo', ['魔坊', readSource('../apps/mofo/mofo-app.js')]],
    ['wangxiang', ['万象', readSource('../apps/wangxiang/wangxiang-app.js')]],
    ['phone', ['通话', readSource('../apps/phone/phone-app.js')]],
    ['diary', ['日记', readSource('../apps/diary/diary-app.js')]],
    ['music', ['音乐', readSource('../apps/music/music-app.js')]],
    ['album', ['相册', readSource('../apps/album/album-app.js')]],
    ['calendar', ['日历', readSource('../apps/calendar/calendar-app.js')]],
    ['games', ['游戏', `${readSource('../apps/games/poker/poker-app.js')}\n${readSource('../apps/games/games-app.js')}`]],
    ['settings', ['设置', readSource('../apps/settings/settings-app.js')]]
]);

test('every registered app is covered by the shared swipe-back contract', () => {
    const appsConfigSource = readSource('../config/apps.js');
    const registeredAppIds = [...appsConfigSource.matchAll(/\bid:\s*'([^']+)'/g)]
        .map(match => match[1])
        .sort();

    assert.deepEqual([...controllers.keys()].sort(), registeredAppIds);
});

test('every app acknowledges the shared swipe-back event', () => {
    controllers.forEach(([name, source]) => {
        assert.match(source, /phone:swipeBack/, `${name} should subscribe to the shared swipe event`);
        assert.match(source, /handleSwipeBack\(event\)/, `${name} should receive the swipe event`);
        assert.match(source, /event\.detail\.handled = true/, `${name} should mark the swipe as handled`);
        assert.match(source, /return false;/, `${name} should ignore swipes outside its active view`);
        assert.match(source, /return true;/, `${name} should report a handled swipe`);
    });
});

test('app swipe-back handlers never disable the whole phone screen', () => {
    controllers.forEach(([name, source]) => {
        assert.doesNotMatch(
            source,
            /screen\.style\.pointerEvents\s*=\s*['"]none['"]|phoneScreen\.style\.pointerEvents\s*=\s*['"]none['"]/,
            `${name} should leave the phone screen available for the shared click guard`
        );
    });
});

test('controller imports share one cache revision after swipe routing changes', () => {
    const indexSource = readSource('../index.js');
    assert.match(indexSource, /ST_PHONE_CSS_REVISION = '20261005-home-icon-first-tap'/);
    assert.match(indexSource, /ST_PHONE_APP_SWIPE_REVISION = '20261002-wechat-chat-return'/);
    assert.doesNotMatch(indexSource, /20261002-swipe-back-routing|20261002-x-compose-safe-area/);
});

test('swipe click guard allows programmatic app back clicks and blocks chat reopen', async () => {
    assert.match(
        phoneShellSource,
        /phoneBody\.addEventListener\('click',[\s\S]*?if \(!event\.isTrusted\) return;[\s\S]*?_swipeClickGuardUntil/
    );

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    globalThis.window = new EventTarget();
    globalThis.window.VirtualPhone = {};
    globalThis.document = {};

    try {
        const { WechatApp } = await import(`../apps/wechat/wechat-app.js?test=chat-swipe-guard-${Date.now()}`);
        const app = Object.create(WechatApp.prototype);
        let getChatCalls = 0;
        let getMessagesCalls = 0;
        let renderCalls = 0;
        app.phoneShell = { isHomeReturnGuardActive: () => true };
        app.wechatData = {
            getChat() {
                getChatCalls += 1;
                return { id: 'chat-1' };
            },
            getMessages() {
                getMessagesCalls += 1;
            }
        };
        app.chatView = { resetTransientInputPanels() {} };
        app.currentChat = null;
        app.render = () => { renderCalls += 1; };

        assert.equal(app.openChat('chat-1'), false);
        assert.equal(getChatCalls, 0);
        assert.equal(getMessagesCalls, 0);
        assert.equal(renderCalls, 0);
        assert.equal(app.currentChat, null);

        app.phoneShell.isHomeReturnGuardActive = () => false;
        assert.equal(app.openChat('chat-1'), true);
        assert.equal(getChatCalls, 1);
        assert.equal(getMessagesCalls, 1);
        assert.equal(renderCalls, 1);
        assert.equal(app.currentChat.id, 'chat-1');
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});

test('Mofo leaves horizontal back gestures to the shared phone shell', () => {
    const gestureHostResolver = phoneShellSource.slice(
        phoneShellSource.indexOf('const resolveGestureControlHost'),
        phoneShellSource.indexOf('const resolveInteractiveHost')
    );

    assert.doesNotMatch(gestureHostResolver, /\.mofo-app/);
    assert.doesNotMatch(mofoViewSource, /mofoRoot\.addEventListener\('pointermove'/);
    assert.match(phoneShellSource, /document\.addEventListener\('pointermove',[\s\S]*?\}, true\);/);
});

test('Honey loading stays on its root layer and cannot reopen after returning home', () => {
    const indexSource = readSource('../index.js');
    const loadingStart = indexSource.indexOf('function showHoneyLoadingView()');
    const loadingEnd = indexSource.indexOf('function ensureGamesCSSPreloaded()', loadingStart);
    const loadingSource = indexSource.slice(loadingStart, loadingEnd);
    const honeyOpenStart = indexSource.indexOf("} else if (appId === 'honey') {");
    const honeyOpenEnd = indexSource.indexOf("} else if (appId === 'mofo') {", honeyOpenStart);
    const honeyOpenSource = indexSource.slice(honeyOpenStart, honeyOpenEnd);

    assert.ok(loadingStart >= 0 && loadingEnd > loadingStart);
    assert.match(loadingSource, /`, 'honey-main'\);/);
    assert.doesNotMatch(loadingSource, /`, 'honey-loading'\);/);
    assert.match(honeyOpenSource, /const isHoneyStillActive = \(\) => currentApp === 'honey';/);
    assert.match(honeyOpenSource, /\.then\(\(\[, , module\]\) => \{\s*if \(!isHoneyStillActive\(\)\) return;/);
});

test('Weibo cancels its first-load CSS redraw after returning home', () => {
    const indexSource = readSource('../index.js');
    const weiboOpenStart = indexSource.indexOf("} else if (appId === 'weibo') {");
    const weiboOpenEnd = indexSource.indexOf("} else if (appId === 'x') {", weiboOpenStart);
    const weiboOpenSource = indexSource.slice(weiboOpenStart, weiboOpenEnd);

    assert.match(indexSource, /ST_PHONE_WEIBO_MODULE_REVISION = '20261002-first-return-guard'/);
    assert.match(weiboOpenSource, /if \(currentApp !== 'weibo'\) return;/);
    assert.match(weiboAppSource, /const renderIfActive = \(\) => \{/);
    assert.match(weiboAppSource, /this\._cssFallbackTimer = setTimeout\(/);
    assert.match(weiboAppSource, /deactivate\(\) \{[\s\S]*?this\._isActive = false;[\s\S]*?clearTimeout\(this\._cssFallbackTimer\);/);
});

test('every go-home event arms the shared home-return guard before rendering the desktop', () => {
    const indexSource = readSource('../index.js');
    const listenerStart = indexSource.indexOf("window.addEventListener('phone:goHome', () => {");
    const listenerEnd = indexSource.indexOf("window.addEventListener('phone:updateGlobalBadge'", listenerStart);
    const listenerSource = indexSource.slice(listenerStart, listenerEnd);

    assert.ok(listenerStart >= 0);
    assert.ok(listenerEnd > listenerStart);
    assert.ok(listenerSource.indexOf('phoneShell?.prepareHomeReturn?.();') >= 0);
    assert.ok(listenerSource.indexOf('phoneShell?.prepareHomeReturn?.();') < listenerSource.indexOf('homeScreen.restore'));
    assert.doesNotMatch(listenerSource, /homeScreen\.render\(\{ forceDomRefresh: true \}\)/);
});

test('returning home reuses the cached home layer and only refreshes dynamic desktop fields', () => {
    const homeScreenSource = readSource('../phone/home-screen.js');
    const restoreStart = homeScreenSource.indexOf('    restore() {');
    const restoreEnd = homeScreenSource.indexOf('\n    getHomeLayout()', restoreStart);
    const restoreSource = homeScreenSource.slice(restoreStart, restoreEnd);

    assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
    assert.match(restoreSource, /restoreView\?\.\('home'\)/);
    assert.match(restoreSource, /this\.updateWallpaperDisplay\(\);/);
    assert.match(restoreSource, /this\.updateTimeDisplay\(\);/);
    assert.match(restoreSource, /this\.updateAppBadges\(\);/);
    assert.doesNotMatch(restoreSource, /forceDomRefresh/);
    assert.match(phoneShellSource, /restoreView\(viewId\) \{[\s\S]*this\.viewHistory = \[\{ id: safeViewId \}\];[\s\S]*if \(view !== targetView\) view\.remove\(\);/);
});

test('home-return guard blocks the trailing click from reopening an app', async () => {
    const previousWindow = globalThis.window;
    let openEvents = 0;
    globalThis.window = {
        VirtualPhone: {},
        dispatchEvent() {
            openEvents += 1;
        }
    };

    try {
        const [{ PhoneShell }, { HomeScreen }] = await Promise.all([
            import(`../phone/phone-shell.js?test=home-return-${Date.now()}`),
            import(`../phone/home-screen.js?test=home-return-${Date.now()}`)
        ]);
        const shell = new PhoneShell();
        shell.currentApp = 'wechat';
        shell.viewHistory = [{ id: 'home' }, { id: 'wechat-main' }];
        shell.prepareHomeReturn({ guardMs: 900 });

        assert.equal(shell.currentApp, null);
        assert.deepEqual(shell.viewHistory, []);
        assert.equal(shell.isHomeReturnGuardActive(), true);

        const home = new HomeScreen(shell, []);
        assert.equal(home.openApp('wechat'), false);
        assert.equal(openEvents, 0);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('a fresh home icon press releases the return guard before the click', async () => {
    const previousWindow = globalThis.window;
    let openEvents = 0;
    globalThis.window = {
        VirtualPhone: {},
        addEventListener() {},
        dispatchEvent() {
            openEvents += 1;
        }
    };

    try {
        const [{ PhoneShell }, { HomeScreen }] = await Promise.all([
            import(`../phone/phone-shell.js?test=home-icon-press-${Date.now()}`),
            import(`../phone/home-screen.js?test=home-icon-press-${Date.now()}`)
        ]);
        const shell = new PhoneShell();
        const icon = { dataset: { app: 'wechat' } };
        shell.screen = {
            querySelectorAll() {
                return [icon];
            }
        };
        shell.prepareHomeReturn({ guardMs: 900 });
        shell._swipeClickGuardUntil = Date.now() + 1000;

        const home = new HomeScreen(shell, []);
        home.bindEvents();

        assert.equal(typeof icon.onpointerdown, 'function');
        assert.equal(typeof icon.ontouchstart, 'function');
        icon.ontouchstart();
        assert.equal(shell.isHomeReturnGuardActive(), false);

        icon.onclick({ stopPropagation() {} });
        assert.equal(openEvents, 1);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('home icon hover lift is limited to fine pointer devices', () => {
    assert.match(
        phoneCssSource,
        /@media \(hover: hover\) and \(pointer: fine\) \{\s*#phone-panel-content \.phone-screen \.app-icon:hover/
    );
    assert.match(
        phoneCssSource,
        /@media \(hover: hover\) and \(pointer: fine\) \{\s*#phone-panel-content \.phone-screen \.dock-app:hover/
    );
    assert.match(phoneCssSource, /\.app-icon \{[\s\S]*?touch-action: manipulation;/);
    assert.match(phoneCssSource, /\.dock-app \{[\s\S]*?touch-action: manipulation;/);
});

test('every app root layer returns straight to home without the gray fallback rebound', async () => {
    const previousWindow = globalThis.window;
    const fakeWindow = new EventTarget();
    fakeWindow.VirtualPhone = {};
    globalThis.window = fakeWindow;
    let goHomeEvents = 0;
    let swipeBackEvents = 0;
    fakeWindow.addEventListener('phone:goHome', () => {
        goHomeEvents += 1;
    });
    fakeWindow.addEventListener('phone:swipeBack', () => {
        swipeBackEvents += 1;
    });

    try {
        const { PhoneShell } = await import(`../phone/phone-shell.js?test=root-social-return-${Date.now()}`);
        const appViewIds = [...controllers.keys()].map(appId => `root-${appId}`);
        const shells = appViewIds.map((viewId) => {
            const shell = new PhoneShell();
            shell.viewHistory = [{ id: 'home' }, { id: viewId }];
            shell._dispatchSwipeBackWithFallback({
                getAttribute(name) {
                    return name === 'data-view-id' ? viewId : '';
                }
            });
            return shell;
        });

        await new Promise(resolve => setTimeout(resolve, 320));

        assert.equal(goHomeEvents, appViewIds.length);
        assert.equal(swipeBackEvents, 0);
        shells.forEach(shell => {
            assert.deepEqual(shell.viewHistory, []);
            assert.equal(shell.isHomeReturnGuardActive(), true);
        });
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});
