import assert from 'node:assert/strict';
import test from 'node:test';

import { PhoneCallData } from '../apps/phone/phone-data.js';

class MemoryStorage {
    constructor(values = {}) {
        this.values = new Map(Object.entries(values));
        this.writes = [];
    }

    get(key, fallback = null) {
        return this.values.has(key) ? this.values.get(key) : fallback;
    }

    set(key, value) {
        this.values.set(key, value);
        this.writes.push({ key, value });
    }
}

test('call history isolates null and malformed stored values', () => {
    for (const storedValue of ['null', '{bad json', { unexpected: true }]) {
        const storage = new MemoryStorage({ phone_call_history: storedValue });
        const data = new PhoneCallData(storage);

        assert.deepEqual(data.getCallHistory(), []);
        assert.deepEqual(storage.values.get('phone_call_history'), []);
    }
});

test('call history removes empty records and normalizes legacy transcripts', () => {
    const storage = new MemoryStorage({
        phone_call_history: [
            null,
            {
                id: '1',
                caller: 'Test contact',
                status: 'answered',
                transcript: ['First line', null, { from: 'me', text: 'Second line' }]
            }
        ]
    });
    const data = new PhoneCallData(storage);

    assert.deepEqual(data.getCallHistory(), [{
        id: '1',
        caller: 'Test contact',
        status: 'answered',
        transcript: [
            { from: 'ai', text: 'First line' },
            { from: 'me', text: 'Second line' }
        ]
    }]);
});

test('legacy string contacts are converted without blocking the phone app', () => {
    const storage = new MemoryStorage({ phone_call_contacts: ['Contact A', '', null] });
    const data = new PhoneCallData(storage);

    assert.deepEqual(data.getContacts(), [{
        id: 'phone_contact_legacy_0',
        name: 'Contact A'
    }]);
});
