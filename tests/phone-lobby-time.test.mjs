import assert from 'node:assert/strict';
import test from 'node:test';
import { PhoneShell } from '../phone/phone-shell.js';

test('status bar drops its previous story fallback when the manager returns real time', () => {
    const previous = globalThis.window;
    try {
        let time = {time: '13:15', date: '2103年6月2日'};
        globalThis.window = {VirtualPhone: {timeManager: {getCurrentStoryTime: () => time}}};
        const shell = Object.create(PhoneShell.prototype);
        shell._shouldUseRealTimeForPhoneDisplay = () => false;
        assert.equal(shell.getCurrentTime(), '13:15');
        time = {time: '14:00', date: '2026年10月31日', isReal: true};
        assert.equal(shell.getCurrentTime(), '14:00');
        assert.equal(shell._lastStatusBarStoryTime, null);
    } finally {globalThis.window = previous;}
});

test('refreshing the phone clock also updates its own desktop date and calendar', () => {
    const previous = globalThis.window;
    try {
        const shell = Object.create(PhoneShell.prototype);
        const label = {textContent: ''};
        shell.container = {querySelector: () => label};
        shell.getCurrentTime = () => '14:00';
        let refreshed = 0;
        globalThis.window = {VirtualPhone: {home: {phoneShell: shell, updateTimeDisplay() {refreshed++;}}}};
        shell.updateStatusBarTime();
        assert.equal(label.textContent, '14:00');
        assert.equal(refreshed, 1);
        window.VirtualPhone.home.phoneShell = {};
        shell.updateStatusBarTime();
        assert.equal(refreshed, 1);
    } finally {globalThis.window = previous;}
});
