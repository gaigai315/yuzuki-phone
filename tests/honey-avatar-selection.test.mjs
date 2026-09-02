import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../apps/honey/honey-view.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { HoneyView } = await import(moduleUrl);

const createView = () => {
    const view = Object.create(HoneyView.prototype);
    view._avatarManifest = {
        hostMale: ['host-m1.png', 'host-m2.png'],
        hostFemale: ['host-f1.png', 'host-f2.png'],
        male: ['m1.png', 'm2.png', 'm3.png', 'm4.png'],
        female: ['f1.png', 'f2.png', 'f3.png', 'f4.png'],
        audience: ['legacy-f1.png', 'legacy-f2.png', 'legacy-f3.png'],
        all: ['all-1.png']
    };
    return view;
};

test('male account sees female hosts and male audience avatars', () => {
    const view = createView();
    const preferences = view._resolveLiveAvatarGenderPreferences(false, { gender: 'male' });
    const avatars = view._buildLiveAvatarSet({ _topicKey: 'male-user-room', host: 'host', viewers: '12k' }, preferences);

    assert.deepEqual(preferences, {
        preferredHostGender: 'female',
        preferredAudienceGender: 'male'
    });
    assert.match(avatars.hostAvatarUrl, /^host-f/);
    assert.equal(avatars.audienceAvatarUrls.every(url => /^m\d/.test(url)), true);
});

test('female account sees male hosts and female audience avatars', () => {
    const view = createView();
    const preferences = view._resolveLiveAvatarGenderPreferences(false, { gender: 'female' });
    const avatars = view._buildLiveAvatarSet({ _topicKey: 'female-user-room', host: 'host', viewers: '8k' }, preferences);

    assert.deepEqual(preferences, {
        preferredHostGender: 'male',
        preferredAudienceGender: 'female'
    });
    assert.match(avatars.hostAvatarUrl, /^host-m/);
    assert.equal(avatars.audienceAvatarUrls.every(url => /^f\d/.test(url)), true);
});

test('user live uses opposite-gender audience avatars', () => {
    const view = createView();
    const preferences = view._resolveLiveAvatarGenderPreferences(true, { gender: 'male' });
    const avatars = view._buildLiveAvatarSet({ _topicKey: 'topic_user_live', host: 'me', viewers: '25' }, preferences);

    assert.deepEqual(preferences, {
        preferredHostGender: 'male',
        preferredAudienceGender: 'female'
    });
    assert.match(avatars.hostAvatarUrl, /^host-m/);
    assert.equal(avatars.audienceAvatarUrls.every(url => /^f\d/.test(url)), true);
});

test('avatar manifest supports dedicated female host pools', () => {
    const view = Object.create(HoneyView.prototype);
    view._getHoneyAssetUrl = path => `/apps/honey/${path}`;
    const manifest = view._normalizeAvatarManifest({
        hostFemale: ['host-f.png'],
        host_female: ['host-fallback.png']
    });

    assert.deepEqual(manifest.hostFemale, [
        '/apps/honey/avatars/host-f.png',
        '/apps/honey/avatars/host-fallback.png'
    ]);
});
