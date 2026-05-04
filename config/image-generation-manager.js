/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * ⚠️ 版权声明 (Copyright Notice):
 * 1. 禁止商业化：本项目仅供交流学习，严禁任何形式的倒卖、盈利等商业行为。
 * 2. 禁止二改发布：严禁未经授权修改代码后作为独立项目二次发布或分发。
 * 3. 禁止抄袭：严禁盗用本项目的核心逻辑、UI设计与相关原代码。
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

export class ImageGenerationManager {
    constructor(storage) {
        this.storage = storage;
    }

    _get(key, fallback = '') {
        const value = this.storage?.get?.(key);
        if (value === null || value === undefined || value === '') return fallback;
        return value;
    }

    _getBool(key, fallback = false) {
        const value = this.storage?.get?.(key);
        if (value === null || value === undefined || value === '') return fallback;
        return value === true || value === 'true';
    }

    _getNumber(key, fallback, min = null, max = null) {
        const value = Number(this.storage?.get?.(key));
        let result = Number.isFinite(value) ? value : fallback;
        if (min !== null) result = Math.max(min, result);
        if (max !== null) result = Math.min(max, result);
        return result;
    }

    getConfig(overrides = {}) {
        const provider = String(overrides.provider || this._get('phone-image-provider', 'novelai')).trim() || 'novelai';
        const legacySiliconflowKey = String(this._get('siliconflow_api_key', '') || '').trim();
        const legacySiliconflowModel = String(this._get('image_generation_model', '') || '').trim();

        return {
            enabled: overrides.enabled ?? this._getBool('phone-image-enabled', false),
            provider,
            apiKey: String(overrides.apiKey || this._get(`phone-image-${provider}-key`, '') || (provider === 'siliconflow' ? legacySiliconflowKey : '')).trim(),
            site: String(overrides.site || this._get('phone-image-novelai-site', 'official')).trim() || 'official',
            customUrl: String(overrides.customUrl || this._get('phone-image-novelai-url', '')).trim(),
            model: String(overrides.model || this._get(`phone-image-${provider}-model`, '') || (provider === 'novelai' ? 'nai-diffusion-4-5-full' : legacySiliconflowModel || 'Kwai-Kolors/Kolors')).trim(),
            sampler: String(overrides.sampler || this._get('phone-image-novelai-sampler', 'k_euler')).trim() || 'k_euler',
            schedule: String(overrides.schedule || this._get('phone-image-novelai-schedule', 'karras')).trim() || 'karras',
            width: this._getNumber('phone-image-width', 832, 64, 2048),
            height: this._getNumber('phone-image-height', 1216, 64, 2048),
            steps: this._getNumber('phone-image-steps', 28, 1, 50),
            scale: this._getNumber('phone-image-scale', 5, 0, 50),
            cfgRescale: this._getNumber('phone-image-cfg-rescale', 0, 0, 1),
            seed: this._getNumber('phone-image-seed', -1, -1, 4294967295),
            fixedPrompt: String(overrides.fixedPrompt ?? this._get('phone-image-fixed-prompt', '')).trim(),
            fixedPromptEnd: String(overrides.fixedPromptEnd ?? this._get('phone-image-fixed-prompt-end', '')).trim(),
            negativePrompt: String(overrides.negativePrompt ?? this._get('phone-image-negative-prompt', '')).trim(),
            saveToBackgrounds: this._getBool('phone-image-save-backgrounds', false)
        };
    }

    async generate(options = {}) {
        const config = this.getConfig(options);
        if (!config.enabled && options.ignoreEnabled !== true) throw new Error('生图功能未启用');
        if (!config.apiKey) throw new Error('缺少生图 API Key');

        if (config.provider === 'siliconflow') {
            return this._generateSiliconflow(options, config);
        }
        if (config.provider === 'novelai') {
            return this._generateNovelAI(options, config);
        }
        throw new Error(`暂不支持的生图服务商：${config.provider}`);
    }

    _joinPrompt(parts = [], separator = ', ') {
        return parts
            .map(item => String(item || '').trim())
            .filter(Boolean)
            .join(separator);
    }

    _resolveNovelAIEndpoint(config) {
        if (config.site === 'custom' && config.customUrl) {
            return config.customUrl.replace(/\/+$/, '');
        }
        return 'https://image.novelai.net';
    }

    _extractBase64Image(payload) {
        const candidates = [
            payload?.image,
            payload?.imageData,
            payload?.data,
            payload?.output,
            payload?.images?.[0],
            payload?.result?.image,
            payload?.result?.images?.[0]
        ];
        for (const item of candidates) {
            if (!item) continue;
            if (typeof item === 'string') {
                if (item.startsWith('data:image/')) return item;
                if (/^[A-Za-z0-9+/=\s]+$/.test(item.slice(0, 120))) return `data:image/png;base64,${item.replace(/\s+/g, '')}`;
            }
            if (typeof item === 'object') {
                const nested = this._extractBase64Image(item);
                if (nested) return nested;
            }
        }
        return '';
    }

    async _readZipImage(response) {
        const blob = await response.blob();
        if (!blob || blob.size <= 0) throw new Error('NovelAI 返回空图片数据');
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
        if (!isZip) {
            const mime = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/png';
            return await this._blobToDataUrl(new Blob([blob], { type: mime }));
        }

        if (window.JSZip) {
            const zip = await window.JSZip.loadAsync(arrayBuffer);
            const imageFile = Object.values(zip.files).find(file => !file.dir && /\.(png|jpg|jpeg|webp)$/i.test(file.name));
            if (!imageFile) throw new Error('NovelAI ZIP 中未找到图片文件');
            const imageBlob = await imageFile.async('blob');
            return await this._blobToDataUrl(imageBlob);
        }

        const imageBlob = await this._readZipImageNative(bytes, arrayBuffer);
        return await this._blobToDataUrl(imageBlob);
    }

    _blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
            reader.readAsDataURL(blob);
        });
    }

    async _readZipImageNative(bytes, arrayBuffer) {
        const entry = this._findZipImageEntry(bytes, arrayBuffer);
        if (!entry) throw new Error('NovelAI ZIP 中未找到图片文件');

        const compressed = bytes.slice(entry.dataStart, entry.dataStart + entry.compressedSize);
        let fileBytes = compressed;
        if (entry.method === 8) {
            fileBytes = await this._inflateRawDeflate(compressed);
        } else if (entry.method !== 0) {
            throw new Error(`当前环境不支持 ZIP 压缩方式：${entry.method}`);
        }

        const lowerName = String(entry.name || '').toLowerCase();
        const mime = lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')
            ? 'image/jpeg'
            : (lowerName.endsWith('.webp') ? 'image/webp' : 'image/png');
        return new Blob([fileBytes], { type: mime });
    }

    _findZipImageEntry(bytes, arrayBuffer) {
        const view = new DataView(arrayBuffer);
        const decoder = new TextDecoder('utf-8');
        const imageExtPattern = /\.(png|jpg|jpeg|webp)$/i;

        for (let offset = 0; offset <= bytes.length - 46; offset++) {
            if (view.getUint32(offset, true) !== 0x02014b50) continue;
            const method = view.getUint16(offset + 10, true);
            const compressedSize = view.getUint32(offset + 20, true);
            const fileNameLength = view.getUint16(offset + 28, true);
            const extraLength = view.getUint16(offset + 30, true);
            const commentLength = view.getUint16(offset + 32, true);
            const localHeaderOffset = view.getUint32(offset + 42, true);
            const nameStart = offset + 46;
            const nameEnd = nameStart + fileNameLength;
            if (nameEnd > bytes.length) break;

            const name = decoder.decode(bytes.slice(nameStart, nameEnd));
            const nextOffset = nameEnd + extraLength + commentLength;
            if (!imageExtPattern.test(name) || compressedSize <= 0) {
                offset = Math.max(offset, nextOffset - 1);
                continue;
            }

            if (localHeaderOffset < 0 || localHeaderOffset + 30 > bytes.length) continue;
            if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) continue;
            const localNameLength = view.getUint16(localHeaderOffset + 26, true);
            const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
            const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
            if (dataStart + compressedSize > bytes.length) continue;

            return { name, method, compressedSize, dataStart };
        }

        return null;
    }

    async _inflateRawDeflate(bytes) {
        if (typeof DecompressionStream !== 'function') {
            throw new Error('NovelAI 返回 ZIP，但当前浏览器缺少原生解压能力');
        }

        const tryInflate = async (format) => {
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
            const buffer = await new Response(stream).arrayBuffer();
            return new Uint8Array(buffer);
        };

        try {
            return await tryInflate('deflate-raw');
        } catch (err) {
            try {
                return await tryInflate('deflate');
            } catch (fallbackErr) {
                throw err;
            }
        }
    }

    _buildNovelAIPayload(options, config) {
        const prompt = this._joinPrompt([
            config.fixedPrompt,
            options.prompt,
            config.fixedPromptEnd
        ]);
        const negativePrompt = this._joinPrompt([
            config.negativePrompt,
            options.negativePrompt
        ]);
        const seed = Number(options.seed ?? config.seed);

        return {
            input: prompt,
            model: config.model,
            action: 'generate',
            parameters: {
                width: Number(options.width || config.width),
                height: Number(options.height || config.height),
                scale: Number(options.scale ?? config.scale),
                sampler: config.sampler,
                steps: Number(options.steps || config.steps),
                n_samples: 1,
                ucPreset: 0,
                qualityToggle: true,
                sm: false,
                sm_dyn: false,
                cfg_rescale: Number(options.cfgRescale ?? config.cfgRescale),
                noise_schedule: config.schedule,
                seed: Number.isFinite(seed) && seed >= 0 ? Math.floor(seed) : Math.floor(Math.random() * 4294967295),
                negative_prompt: negativePrompt
            }
        };
    }

    async _generateNovelAI(options, config) {
        const prompt = String(options.prompt || '').trim();
        if (!prompt) throw new Error('缺少生图提示词');

        const endpoint = `${this._resolveNovelAIEndpoint(config)}/ai/generate-image`;
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
                Accept: 'application/x-zip-compressed, image/png, application/json'
            },
            body: JSON.stringify(this._buildNovelAIPayload(options, config))
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`NovelAI 请求失败 (${response.status})${text ? `: ${text.slice(0, 180)}` : ''}`);
        }

        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        let imageData = '';
        if (contentType.includes('application/json')) {
            const payload = await response.json();
            imageData = this._extractBase64Image(payload);
        } else {
            imageData = await this._readZipImage(response);
        }
        if (!imageData) throw new Error('NovelAI 未返回可用图片');
        return {
            provider: 'novelai',
            model: config.model,
            prompt,
            imageData,
            imageUrl: imageData
        };
    }

    async _generateSiliconflow(options, config) {
        const prompt = String(options.prompt || '').trim();
        if (!prompt) throw new Error('缺少生图提示词');

        const response = await fetch('https://api.siliconflow.cn/v1/images/generations', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: config.model,
                prompt: this._joinPrompt([config.fixedPrompt, prompt, config.fixedPromptEnd], '，'),
                negative_prompt: this._joinPrompt([config.negativePrompt, options.negativePrompt]),
                image_size: `${Number(options.width || config.width)}x${Number(options.height || config.height)}`,
                batch_size: 1,
                num_inference_steps: Number(options.steps || config.steps),
                guidance_scale: Number(options.scale ?? config.scale)
            })
        });
        const text = await response.text();
        let payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = null; }
        if (!response.ok) {
            const msg = payload?.message || payload?.error?.message || payload?.error || text || '';
            throw new Error(`SiliconFlow 请求失败 (${response.status})${msg ? `: ${String(msg).slice(0, 180)}` : ''}`);
        }
        const imageUrl = String(payload?.images?.[0]?.url || '').trim();
        if (!imageUrl) throw new Error('SiliconFlow 未返回图片 URL');
        return {
            provider: 'siliconflow',
            model: config.model,
            prompt,
            imageData: imageUrl,
            imageUrl
        };
    }
}
