import assert from 'node:assert/strict';
import test from 'node:test';

import { parseNovelAIVibeGroupPayload } from '../config/novelai-vibe-import.js';

const makeEncoding = byte => Buffer.alloc(4096, byte).toString('base64');

test('NovelAI Vibe group import maps encodings and group settings', () => {
    let id = 0;
    const firstEncoding = makeEncoding(0x70);
    const secondEncoding = makeEncoding(0x14);
    const payload = {
        groups: {
            大眼萌妹: {
                vibes: [
                    { vibeDataId: 'first', strength: 0.36 },
                    { vibeDataId: 'second', strength: 0 }
                ]
            }
        },
        vibeData: {
            first: {
                identifier: 'novelai-vibe-transfer',
                type: 'encoding',
                name: 'raw-first',
                encodings: { 'v4-5full': { unknown: { encoding: firstEncoding } } },
                importInfo: { model: 'nai-diffusion-4-5-full', information_extracted: 0.7, strength: 0.3 }
            },
            second: {
                identifier: 'novelai-vibe-transfer',
                type: 'encoding',
                name: 'raw-second',
                encodings: { 'v4-5full': { unknown: { encoding: secondEncoding } } },
                importInfo: { model: 'nai-diffusion-4-5-full', information_extracted: 0.8, strength: 0.6 }
            }
        },
        vibePresets: {
            卖萌1: { vibeDataId: 'first', infoExtract: 1 },
            卖萌2: { vibeDataId: 'second', infoExtract: 1 }
        }
    };

    const parsed = parseNovelAIVibeGroupPayload(payload, { createId: () => `id-${++id}` });

    assert.equal(parsed.skipped, 0);
    assert.equal(parsed.groups.length, 1);
    assert.equal(parsed.groups[0].name, '大眼萌妹');
    assert.deepEqual(parsed.groups[0].items.map(item => item.name), ['卖萌1', '卖萌2']);
    assert.deepEqual(parsed.groups[0].items.map(item => item.strength), [0.36, 0]);
    assert.deepEqual(parsed.groups[0].items.map(item => item.informationExtracted), [0.7, 0.8]);
    assert.deepEqual(parsed.groups[0].items.map(item => item.encodingModel), [
        'nai-diffusion-4-5-full',
        'nai-diffusion-4-5-full'
    ]);
    assert.equal(parsed.groups[0].items[0].encoding, firstEncoding);
    assert.equal(parsed.groups[0].items[1].encoding, secondEncoding);
});

test('NovelAI Vibe group import rejects unsupported or missing encodings', () => {
    assert.throws(
        () => parseNovelAIVibeGroupPayload({ groups: {}, vibeData: {} }),
        /没有可用的 Vibe 编码/
    );
    assert.throws(
        () => parseNovelAIVibeGroupPayload({
            groups: { broken: { vibes: [{ vibeDataId: 'bad', strength: 1 }] } },
            vibeData: {
                bad: {
                    identifier: 'novelai-vibe-transfer',
                    type: 'encoding',
                    encodings: { unknown: { unknown: { encoding: makeEncoding(1) } } }
                }
            }
        }),
        /没有可用的 Vibe 编码/
    );
});

test('official NovelAI Vibe bundles import as one named group', () => {
    const encoding = makeEncoding(0x8c);
    const parsed = parseNovelAIVibeGroupPayload({
        identifier: 'novelai-vibe-transfer-bundle',
        version: 1,
        vibes: [{
            identifier: 'novelai-vibe-transfer',
            version: 1,
            type: 'encoding',
            id: 'bundle-vibe-1',
            name: '34e6d5-23217d',
            encodings: { 'v4-5full': { unknown: { encoding } } },
            importInfo: {
                model: 'nai-diffusion-4-5-full',
                information_extracted: 0.7,
                strength: 0.53
            }
        }]
    }, {
        createId: () => 'generated-id',
        defaultGroupName: '萌妹'
    });

    assert.equal(parsed.groups.length, 1);
    assert.equal(parsed.groups[0].name, '萌妹');
    assert.equal(parsed.groups[0].items[0].name, '34e6d5-23217d');
    assert.equal(parsed.groups[0].items[0].strength, 0.53);
    assert.equal(parsed.groups[0].items[0].informationExtracted, 0.7);
    assert.equal(parsed.groups[0].items[0].encoding, encoding);
});

test('NovelAI Vibe imports enforce per-group and aggregate limits', () => {
    const encoding = makeEncoding(0x42);
    const vibeData = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [
        `vibe-${index}`,
        {
            identifier: 'novelai-vibe-transfer',
            type: 'encoding',
            encodings: { 'v4-5full': { unknown: { encoding } } },
            importInfo: { model: 'nai-diffusion-4-5-full' }
        }
    ]));
    assert.throws(
        () => parseNovelAIVibeGroupPayload({
            groups: {
                oversized: {
                    vibes: Array.from({ length: 17 }, (_, index) => ({ vibeDataId: `vibe-${index}` }))
                }
            },
            vibeData
        }),
        /单个分组最多包含 16 个 Vibe/
    );

    assert.throws(
        () => parseNovelAIVibeGroupPayload({
            identifier: 'novelai-vibe-transfer-bundle',
            vibes: Array.from({ length: 65 }, (_, index) => ({ id: `vibe-${index}` }))
        }),
        /单次最多导入 64 个 Vibe/
    );
});
