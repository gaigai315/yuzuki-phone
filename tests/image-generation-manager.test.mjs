import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs
    .readFileSync(new URL('../config/image-generation-manager.js', import.meta.url), 'utf8')
    .replace(
        "import { decompress as decompressZstd } from '../assets/vendor/fzstd.js';",
        'const decompressZstd = () => new Uint8Array();'
    );
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { ImageGenerationManager } = await import(moduleUrl);
const manager = new ImageGenerationManager(null);

test('NovelAI character parser supports foreground and background depth positions', () => {
    const parsed = manager._parseNovelAICharacterPromptSyntax(
        '{人物 1girl, black hair, {位置前} 人物}, {人物 1boy, blond hair, {位置后} 人物}'
    );

    assert.equal(parsed.useCoords, true);
    assert.deepEqual(parsed.characters, [
        {
            charCaption: '1girl, black hair, foreground',
            negativeCaption: '',
            center: { x: 0.5, y: 0.7 }
        },
        {
            charCaption: '1boy, blond hair, background',
            negativeCaption: '',
            center: { x: 0.5, y: 0.3 }
        }
    ]);
});

test('NovelAI character parser keeps existing upper and lower positions unchanged', () => {
    const parsed = manager._parseNovelAICharacterPromptSyntax(
        '{人物 1girl, {位置上} 人物}, {人物 1boy, {位置下} 人物}'
    );

    assert.equal(parsed.useCoords, true);
    assert.deepEqual(parsed.characters.map(item => item.center), [
        { x: 0.5, y: 0.3 },
        { x: 0.5, y: 0.7 }
    ]);
});

test('NovelAI character parser disables all coordinates when one position is unknown', () => {
    const parsed = manager._parseNovelAICharacterPromptSyntax(
        '{人物 1girl, {位置中} 人物}, {人物 1boy, {位置未知} 人物}'
    );
    const charCaptions = manager._buildNovelAICharCaptions(parsed.characters, 'charCaption');

    assert.equal(parsed.useCoords, false);
    assert.deepEqual(parsed.characters.map(item => item.center), [null, null]);
    assert.equal(charCaptions.some(item => Object.hasOwn(item, 'centers')), false);
});

test('ComfyUI LoRA options include standard and custom loader lists', () => {
    const options = manager._getComfyUILoraOptions({
        LoraLoader: {
            input: { required: { lora_name: [['style-a.safetensors', 'style-b.safetensors']] } }
        },
        'Power Lora Loader (rgthree)': {
            input: { optional: { lora_1: [['style-b.safetensors', 'style-c.safetensors']] } }
        },
        CheckpointLoaderSimple: {
            input: { required: { ckpt_name: [['model.safetensors']] } }
        }
    });

    assert.deepEqual(options, ['style-a.safetensors', 'style-b.safetensors', 'style-c.safetensors']);
});

test('ComfyUI builds a chained multi-LoRA workflow with one weight per LoRA', () => {
    const built = manager._buildComfyUIWorkflow({
        app: 'wechat',
        prompt: 'portrait',
        width: 512,
        height: 512
    }, {
        width: 512,
        height: 512,
        steps: 24,
        scale: 6,
        cfgRescale: 0,
        seed: 123,
        fixedPrompt: '',
        fixedPromptEnd: '',
        negativePrompt: '',
        comfyuiSampler: 'euler',
        comfyuiScheduler: 'normal',
        comfyuiModel: 'base.safetensors',
        comfyuiVae: '',
        comfyuiClip: '',
        comfyuiWorkflow: '',
        comfyuiLoras: [
            { name: 'style-a.safetensors', strength: 0.8 },
            { name: 'detail-b.safetensors', strength: 1.15 }
        ]
    });

    const loraEntries = Object.entries(built.workflow)
        .filter(([, node]) => node.class_type === 'LoraLoader');
    assert.equal(built.loraInjectedCount, 2);
    assert.equal(loraEntries.length, 2);

    const [[firstId, first], [secondId, second]] = loraEntries;
    assert.deepEqual(first.inputs.model, ['4', 0]);
    assert.deepEqual(first.inputs.clip, ['4', 1]);
    assert.equal(first.inputs.lora_name, 'style-a.safetensors');
    assert.equal(first.inputs.strength_model, 0.8);
    assert.equal(first.inputs.strength_clip, 0.8);
    assert.deepEqual(second.inputs.model, [firstId, 0]);
    assert.deepEqual(second.inputs.clip, [firstId, 1]);
    assert.equal(second.inputs.lora_name, 'detail-b.safetensors');
    assert.equal(second.inputs.strength_model, 1.15);
    assert.equal(second.inputs.strength_clip, 1.15);
    assert.deepEqual(built.workflow['3'].inputs.model, [secondId, 0]);
    assert.deepEqual(built.workflow['6'].inputs.clip, [secondId, 1]);
    assert.deepEqual(built.workflow['7'].inputs.clip, [secondId, 1]);
});

test('ComfyUI phone LoRAs do not overwrite LoRA nodes already stored in the workflow', () => {
    const workflow = {
        1: {
            inputs: {
                ckpt_name: 'base.safetensors'
            },
            class_type: 'CheckpointLoaderSimple'
        },
        2: {
            inputs: {
                model: ['1', 0],
                clip: ['1', 1],
                lora_name: 'fixed-turbo.safetensors',
                strength_model: 0.35,
                strength_clip: 0.2
            },
            class_type: 'LoraLoader'
        },
        3: {
            inputs: {
                text: '%prompt%',
                clip: ['2', 1]
            },
            class_type: 'CLIPTextEncode'
        },
        4: {
            inputs: {
                text: '%negative_prompt%',
                clip: ['2', 1]
            },
            class_type: 'CLIPTextEncode'
        },
        5: {
            inputs: {
                model: ['2', 0],
                positive: ['3', 0],
                negative: ['4', 0],
                latent_image: ['6', 0],
                seed: 123,
                steps: 20,
                cfg: 6,
                sampler_name: 'euler',
                scheduler: 'normal',
                denoise: 1
            },
            class_type: 'KSampler'
        },
        6: {
            inputs: { width: 512, height: 512, batch_size: 1 },
            class_type: 'EmptyLatentImage'
        },
        7: {
            inputs: { samples: ['5', 0], vae: ['1', 2] },
            class_type: 'VAEDecode'
        },
        8: {
            inputs: { filename_prefix: 'test', images: ['7', 0] },
            class_type: 'SaveImage'
        }
    };
    const built = manager._buildComfyUIWorkflow({
        app: 'wechat',
        prompt: 'portrait',
        width: 512,
        height: 512
    }, {
        width: 512,
        height: 512,
        steps: 20,
        scale: 6,
        cfgRescale: 0,
        seed: 123,
        fixedPrompt: '',
        fixedPromptEnd: '',
        negativePrompt: '',
        comfyuiSampler: 'euler',
        comfyuiScheduler: 'normal',
        comfyuiModel: '',
        comfyuiVae: '',
        comfyuiClip: '',
        comfyuiWorkflow: JSON.stringify(workflow),
        comfyuiLoras: [{ name: 'phone-style.safetensors', strength: 0.75 }]
    });

    assert.equal(built.workflow['2'].inputs.lora_name, 'fixed-turbo.safetensors');
    assert.equal(built.workflow['2'].inputs.strength_model, 0.35);
    assert.equal(built.workflow['2'].inputs.strength_clip, 0.2);
    const phoneNode = Object.values(built.workflow).find(node => node?._meta?.title === 'Yuzuki Phone LoRA 1');
    assert.equal(phoneNode.inputs.lora_name, 'phone-style.safetensors');
    assert.equal(phoneNode.inputs.strength_model, 0.75);
    assert.equal(phoneNode.inputs.strength_clip, 0.75);
});

test('ComfyUI phone LoRAs populate a connected LoraManager node', () => {
    const workflow = {
        1: {
            inputs: { ckpt_name: 'base.safetensors' },
            class_type: 'CheckpointLoaderSimple'
        },
        2: {
            inputs: {
                text: '<lora:fixed-style:0.35>',
                loras: {
                    __value__: [{
                        name: 'fixed-style',
                        strength: '0.35',
                        clipStrength: '0.2',
                        active: true
                    }]
                },
                model: ['1', 0],
                clip: ['1', 1]
            },
            class_type: 'Lora Loader (LoraManager)'
        },
        3: {
            inputs: { text: 'portrait', clip: ['2', 1] },
            class_type: 'CLIPTextEncode'
        },
        4: {
            inputs: { model: ['2', 0], positive: ['3', 0] },
            class_type: 'KSampler'
        }
    };

    const result = manager._injectComfyUILoras(workflow, [
        { name: 'folder/phone-style.safetensors', strength: 0.75 },
        { name: 'detail-b.safetensors', strength: 1.15 }
    ]);

    assert.equal(result.injectedCount, 2);
    assert.equal(result.mode, 'lora-manager');
    assert.deepEqual(result.nodeIds, ['2']);
    assert.equal(Object.values(workflow).some(node => node?._meta?.title === 'Yuzuki Phone LoRA 1'), false);
    assert.deepEqual(workflow['4'].inputs.model, ['2', 0]);
    assert.deepEqual(workflow['3'].inputs.clip, ['2', 1]);
    assert.deepEqual(workflow['2'].inputs.loras.__value__.map(item => ({
        name: item.name,
        strength: item.strength,
        clipStrength: item.clipStrength,
        active: item.active
    })), [
        { name: 'fixed-style', strength: '0.35', clipStrength: '0.2', active: true },
        { name: 'folder/phone-style', strength: '0.75', clipStrength: '0.75', active: true },
        { name: 'detail-b', strength: '1.15', clipStrength: '1.15', active: true }
    ]);
    assert.equal(
        workflow['2'].inputs.text,
        '<lora:fixed-style:0.35> <lora:folder/phone-style:0.75> <lora:detail-b:1.15>'
    );
});

test('ComfyUI phone LoRA selection activates and updates a matching LoraManager entry', () => {
    const workflow = {
        1: {
            inputs: {
                text: '<lora:phone-style:0.2>',
                loras: {
                    __value__: [{
                        name: 'phone-style',
                        strength: '0.2',
                        clipStrength: '0.1',
                        active: false
                    }]
                },
                model: ['2', 0],
                clip: ['2', 1]
            },
            class_type: 'Lora Loader (LoraManager)'
        },
        2: {
            inputs: { ckpt_name: 'base.safetensors' },
            class_type: 'CheckpointLoaderSimple'
        },
        3: {
            inputs: { model: ['1', 0], clip: ['1', 1] },
            class_type: 'KSampler'
        }
    };

    manager._injectComfyUILoras(workflow, [
        { name: 'phone-style.safetensors', strength: 0.8 }
    ]);

    assert.deepEqual(workflow['1'].inputs.loras.__value__.map(item => ({
        name: item.name,
        strength: item.strength,
        clipStrength: item.clipStrength,
        active: item.active
    })), [{
        name: 'phone-style',
        strength: '0.8',
        clipStrength: '0.8',
        active: true
    }]);
    assert.equal(workflow['1'].inputs.text, '<lora:phone-style:0.8>');
});

test('ComfyUI history recovery finds an image after non-media custom outputs', () => {
    const recovered = manager._extractComfyUIMediaByClientId({
        'prompt-1': {
            prompt: [7, 'prompt-1', {}, { client_id: 'yuzuki-phone-test' }],
            outputs: {
                106: { value: [6] },
                67: { text: ['combined prompt'] },
                81: {
                    images: [{
                        filename: 'Anima_2026-09-09-142641.png',
                        subfolder: 'anima',
                        type: 'output'
                    }]
                }
            }
        }
    }, 'yuzuki-phone-test');

    assert.equal(recovered.promptId, 'prompt-1');
    assert.deepEqual(recovered.media, {
        filename: 'Anima_2026-09-09-142641.png',
        subfolder: 'anima',
        type: 'output',
        mediaType: 'image',
        outputNodeId: '81',
        priority: 110
    });
});
