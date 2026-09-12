import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../config/time-manager.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { TimeManager } = await import(moduleUrl);

function createTimeManager(values = {}) {
    const storage = {
        get(key) {
            return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
        },
        set(key, value) {
            values[key] = value;
        },
        remove(key) {
            delete values[key];
        }
    };
    return new TimeManager(storage);
}

test('modern global time parsing keeps date, weekday, and clock behavior', () => {
    const manager = createTimeManager();
    const parsed = manager.parseStatusbar(
        '<globalTime>T_story：2025年01月01日·🌸·星期二·14:30·晴天·18°C</globalTime>'
    );

    assert.equal(parsed.date, '2025年01月01日');
    assert.equal(parsed.time, '14:30');
    assert.equal(parsed.weekday, '星期二');
    assert.equal(parsed.isAncient, false);
});

test('all supported modern formats parse with or without supported wrappers', () => {
    const manager = createTimeManager();
    const formats = [
        '2021年01月01日14:30星期二',
        '2021年 01月 01日 14:30 星期二',
        '2021年|01月|01日|14:30|星期二',
        '2021年-01月-01日-14:30-星期二',
        '2021年/01月/01日/14:30/星期二',
        '2021-01-01 14:30 星期二',
        '2021/01/01/14:30/星期二'
    ];
    const wrappers = [
        value => value,
        value => `<globalTime>${value}</globalTime>`,
        value => `<Time>${value}</Time>`,
        value => `<time>${value}</time>`,
        value => `<statusbar>${value}</statusbar>`
    ];

    for (const format of formats) {
        for (const wrap of wrappers) {
            const input = wrap(format);
            const parsed = manager.parseStatusbar(input);
            assert.ok(parsed, `expected format to parse: ${input}`);
            assert.equal(parsed.date, '2021年01月01日');
            assert.equal(parsed.time, '14:30');
            assert.equal(parsed.weekday, '星期二');
            assert.equal(parsed.isAncient, false);
        }
    }
});

test('fixed phone global status bars parse in modern and ancient forms', () => {
    const manager = createTimeManager();
    const modernHoliday = manager.parseStatusbar(
        '2021年01月01日·🌸·星期二·14:30·晴天·8°C·{元旦}'
    );
    const modernWeather = manager.parseStatusbar(
        '<globalTime>2021年01月02日·🌸·星期二·14:30·小雨·2°C</globalTime>'
    );
    const ancient = manager.parseStatusbar(
        '<globalTime>大明永乐十二年九月初八日·🍂·辰时(07:30)·晴天·22°C</globalTime>'
    );

    assert.deepEqual(
        { date: modernHoliday.date, time: modernHoliday.time, weekday: modernHoliday.weekday },
        { date: '2021年01月01日', time: '14:30', weekday: '星期二' }
    );
    assert.deepEqual(
        { date: modernWeather.date, time: modernWeather.time, weekday: modernWeather.weekday },
        { date: '2021年01月02日', time: '14:30', weekday: '星期二' }
    );
    assert.deepEqual(
        {
            date: ancient.date,
            time: ancient.time,
            weekday: ancient.weekday,
            traditionalTime: ancient.traditionalTime,
            isAncient: ancient.isAncient
        },
        {
            date: '大明永乐十二年九月初八日',
            time: '07:30',
            weekday: '',
            traditionalTime: '辰时',
            isAncient: true
        }
    );
});

test('ancient global time parsing preserves reign date and hides weekday', () => {
    const manager = createTimeManager();
    const parsed = manager.parseStatusbar(
        '<globalTime>\nT_story：大明永乐十二年九月初八日·🍂·辰时(07:30)·晴天·18°C\n</globalTime>'
    );

    assert.equal(parsed.date, '大明永乐十二年九月初八日');
    assert.equal(parsed.calendarDate, '12年09月08日');
    assert.equal(parsed.time, '07:30');
    assert.equal(parsed.traditionalTime, '辰时');
    assert.equal(parsed.weekday, '');
    assert.equal(parsed.isAncient, true);
    assert.equal(parsed.era, '大明永乐');
});

test('ancient hour branch without a numeric clock uses its midpoint', () => {
    const manager = createTimeManager();
    const parsed = manager.parseStatusbar(
        '<globalTime>T_story：大清乾隆三年正月初一日·🧣·子时·小雪·-2°C</globalTime>'
    );

    assert.equal(parsed.date, '大清乾隆三年正月初一日');
    assert.equal(parsed.time, '00:00');
    assert.equal(parsed.weekday, '');
    assert.equal(parsed.isAncient, true);
});

test('a Chinese reign year without a dynasty prefix is parsed as one complete number', () => {
    const manager = createTimeManager();
    const parsed = manager.parseStatusbar('十二年九月初八日·辰时(07:30)·晴天');

    assert.equal(parsed.year, '12');
    assert.equal(parsed.date, '十二年九月初八日');
    assert.equal(parsed.era, '');
    assert.equal(parsed.weekday, '');
});

test('ancient time progression retains reign style and ancient day naming', () => {
    const manager = createTimeManager();
    const advanced = manager.addMinutesToStoryTime({
        date: '大明永乐十二年九月二十日',
        time: '23:30',
        weekday: '',
        isAncient: true
    }, 60);

    assert.equal(advanced.date, '大明永乐十二年九月廿一日');
    assert.equal(advanced.time, '00:30');
    assert.equal(advanced.weekday, '');
    assert.equal(advanced.isAncient, true);
});

test('ancient minute progression keeps special month names on the same date', () => {
    const manager = createTimeManager();
    const advanced = manager.addMinutesToStoryTime({
        date: '大清乾隆三年正月初一日',
        time: '08:00',
        weekday: '',
        isAncient: true
    }, 1);

    assert.equal(advanced.date, '大清乾隆三年正月初一日');
    assert.equal(advanced.time, '08:01');
    assert.equal(advanced.weekday, '');
});

test('fictional dynasty dates remain ancient when saved without parser metadata', () => {
    const values = {};
    const manager = createTimeManager(values);
    manager.getPhoneLastMessageTime = () => null;

    assert.equal(manager.setTime('07:30', '玄曜天启12年09月08日'), true);
    const saved = JSON.parse(values['story-current-time']);

    assert.equal(saved.date, '玄曜天启12年09月08日');
    assert.equal(saved.weekday, '');
    assert.equal(saved.isAncient, true);
    assert.equal(saved.era, '玄曜天启');
});

test('ancient chat time is not replaced by saved or phone time from the modern era', () => {
    const values = {
        'story-current-time': JSON.stringify({
            date: '2026年09月09日',
            time: '11:17',
            weekday: '星期三',
            source: 'story-current'
        })
    };
    const manager = createTimeManager(values);
    manager.getContext = () => ({
        characterId: 1,
        chat: [{
            is_user: false,
            mes: '<globalTime>T_story：大明永乐十二年九月初八日·🍂·辰时(07:30)·晴天·18°C</globalTime>'
        }]
    });
    manager.isOfflineTimeSourceEnabled = () => true;
    manager.getPhoneLastMessageTime = () => ({
        date: '2026年09月09日',
        time: '11:18',
        weekday: '星期三',
        timestamp: Date.now(),
        source: 'phone'
    });

    const current = manager.getCurrentStoryTime();
    assert.equal(current.date, '大明永乐十二年九月初八日');
    assert.equal(current.weekday, '');
    assert.equal(current.isAncient, true);
});
