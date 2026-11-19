import assert from 'node:assert/strict';
import test from 'node:test';
import { HomeScreen } from '../phone/home-screen.js';

test('desktop week follows the calendar story date across month, year and leap-day boundaries', () => {
    const previous = globalThis.window;
    try {
        let date = '2024年2月29日';
        globalThis.window = {VirtualPhone: {timeManager: {getCurrentStoryTime: () => ({date})}}};
        const home = Object.create(HomeScreen.prototype);
        let days = home.getHomeCalendarDays();
        assert.deepEqual(days.map(day => day.day), [25, 26, 27, 28, 29, 1, 2]);
        assert.equal(days.find(day => day.current).weekday, '四');
        date = '2027年1月1日';
        days = home.getHomeCalendarDays();
        assert.deepEqual(days[0], {year: 2026, month: 12, day: 27, weekday: '日', current: false});
        assert.equal(days[5].current, true);
        date = '99年1月1日';
        assert.equal(home.getHomeCalendarDays().find(day => day.current).year, 99);
        for (date of ['2026年2月30日', '建安十三年春', '']) assert.deepEqual(home.getHomeCalendarDays(), []);
    } finally { globalThis.window = previous; }
});

test('desktop avatars follow the selected persona and character and clear the character in groups', () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    try {
        const context = {name1: '用户', name2: '甲', characterId: 0,
            characters: [{name: '甲', avatar: '甲 #1.png'}, {name: '乙', avatar: '乙.png'}]};
        let user = '/User Avatars/one.png';
        globalThis.window = {VirtualPhone: {storage: {getContext: () => context}}};
        globalThis.document = {querySelector: () => user ? {src: user} : null};
        const home = Object.create(HomeScreen.prototype);
        assert.equal(home.getHomeCardAvatars().char, '/characters/' + encodeURIComponent('甲 #1.png'));
        user = '/User Avatars/two.png'; context.characterId = 1;
        assert.equal(home.getHomeCardAvatars().user, user.replaceAll(' ', '%20'));
        assert.equal(home.getHomeCardAvatars().charName, '乙');
        context.groupId = 'group';
        assert.equal(home.getHomeCardAvatars().char, '');
        delete context.groupId; delete context.characterId; user = '';
        assert.equal(home.getHomeCardAvatars().char, '');
        assert.equal(home.getHomeCardAvatars().user, '');
    } finally { globalThis.window = previousWindow; globalThis.document = previousDocument; }
});

test('clock decoration follows character and persona avatars while its random greeting stays stable during time updates', () => {
    const home = Object.create(HomeScreen.prototype);
    const clock = {innerHTML: ''};
    const root = {querySelector: selector => selector === '[data-home-data="clock"]' ? clock : null};
    home.phoneShell = {screen: {querySelector: () => root}};
    let avatars = {char: '/characters/one.png', user: '/User Avatars/persona.png'};
    home.getHomeCardAvatars = () => avatars;
    home.updateHomeCssData();
    const firstFace = home._homeClockKaomoji;
    assert.ok(clock.innerHTML.includes('/characters/one.png'));
    const initial = clock.innerHTML;
    home.updateHomeCssData();
    assert.equal(clock.innerHTML, initial);
    assert.equal(home._homeClockKaomoji, firstFace);
    home._pickHomeClockKaomoji();
    assert.notEqual(home._homeClockKaomoji, firstFace);
    avatars = {...avatars, char: '/characters/two".png'};
    home.updateHomeCssData();
    assert.ok(clock.innerHTML.includes('/characters/two&quot;.png'));
    avatars = {...avatars, char: ''};
    home.updateHomeCssData();
    assert.ok(clock.innerHTML.includes('/User Avatars/persona.png'));
    avatars = {char: '', user: ''};
    home.updateHomeCssData();
    assert.ok(clock.innerHTML.includes('yzp-home-clock-placeholder'));
    assert.ok(!clock.innerHTML.includes('<img'));
});


test('desktop user avatar is available after restart before persona DOM mounts', () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const context = { name1: '用户', name2: '角色' };
    globalThis.window = { VirtualPhone: { storage: { getContext: () => context } } };
    globalThis.document = { querySelector: () => null };
    const home = Object.create(HomeScreen.prototype);
    const personas = { user_avatar: '重启后 用户.png' };
    try {
        assert.equal(home.getHomeCardAvatars({ personas }).user, '/User%20Avatars/' + encodeURIComponent(personas.user_avatar));
        personas.user_avatar = '新用户.png';
        assert.equal(home.getHomeCardAvatars({ personas }).user, '/User%20Avatars/' + encodeURIComponent('新用户.png'));
    } finally { globalThis.window = previousWindow; globalThis.document = previousDocument; }
});

test('desktop avatar ignores a blank or failed persona thumbnail and can use context fallback', () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    globalThis.window = { VirtualPhone: { storage: { getContext: () => ({ user_avatar: '当前用户.png' }) } } };
    globalThis.document = { querySelector: () => ({ src: '/img/user-default.png', complete: true, naturalWidth: 0 }) };
    const home = Object.create(HomeScreen.prototype);
    try {
        assert.equal(home.getHomeCardAvatars().user, '/User%20Avatars/' + encodeURIComponent('当前用户.png'));
        globalThis.document = { querySelector: () => ({ src: '/img/user-default.png' }) };
        assert.equal(home.getHomeCardAvatars().user, '/User%20Avatars/' + encodeURIComponent('当前用户.png'));
    } finally { globalThis.window = previousWindow; globalThis.document = previousDocument; }
});
