/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

const VARIANT_MODEL_MAP = Object.freeze({
    'v4-5full': 'nai-diffusion-4-5-full',
    v4full: 'nai-diffusion-4-full',
    v4curated: 'nai-diffusion-4-curated-preview'
});
const MAX_VIBES_PER_GROUP = 16;
const MAX_GROUPS_PER_IMPORT = 32;
const MAX_VIBES_PER_IMPORT = 64;
const MAX_ENCODING_CHARS_PER_IMPORT = 8 * 1024 * 1024;

const cleanBase64 = value => String(value || '').replace(/\s+/g, '');

const isVibeEncoding = value => {
    const text = cleanBase64(value);
    return text.length > 2000
        && text.length % 4 === 0
        && /^[A-Za-z0-9+/]+={0,2}$/.test(text)
        && !/^iVBORw0KGgo|^\/9j\/|^UklGR/i.test(text);
};

const clampVibeValue = (value, fallback) => {
    const number = Number.parseFloat(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.round(Math.max(0, Math.min(1, number)) * 100) / 100;
};

const createFallbackId = () => `vibe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const findVibeEncoding = (vibeData = {}) => {
    const variants = vibeData?.encodings;
    if (!variants || typeof variants !== 'object') return null;

    for (const [variant, entry] of Object.entries(variants)) {
        if (!VARIANT_MODEL_MAP[variant]) continue;
        const candidates = [entry?.unknown?.encoding, entry?.encoding];
        const encoding = candidates.map(cleanBase64).find(isVibeEncoding);
        if (!encoding) continue;
        const claimedModel = String(vibeData?.importInfo?.model || '').trim();
        if (claimedModel && claimedModel !== VARIANT_MODEL_MAP[variant]) continue;
        return {
            encoding,
            variant,
            model: claimedModel || VARIANT_MODEL_MAP[variant]
        };
    }
    return null;
};

export function parseNovelAIVibeGroupPayload(payload, options = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Vibe 文件内容不是有效对象');
    }
    const isBundle = payload.identifier === 'novelai-vibe-transfer-bundle' && Array.isArray(payload.vibes);
    if (isBundle && payload.vibes.length > MAX_VIBES_PER_IMPORT) {
        throw new Error(`单次最多导入 ${MAX_VIBES_PER_IMPORT} 个 Vibe`);
    }
    const bundleGroupName = String(options.defaultGroupName || '导入的 Vibe 组').trim() || '导入的 Vibe 组';
    const sourceVibeData = isBundle
        ? Object.fromEntries(payload.vibes.map((vibe, index) => [String(vibe?.id || `bundle-vibe-${index + 1}`), vibe]))
        : payload.vibeData;
    const sourceGroups = isBundle
        ? {
            [bundleGroupName]: {
                vibes: payload.vibes.map((vibe, index) => ({
                    vibeDataId: String(vibe?.id || `bundle-vibe-${index + 1}`),
                    strength: vibe?.importInfo?.strength
                }))
            }
        }
        : payload.groups;
    if (!sourceGroups || typeof sourceGroups !== 'object' || !sourceVibeData || typeof sourceVibeData !== 'object') {
        throw new Error('不是支持的 NovelAI Vibe 分组文件');
    }

    const createId = typeof options.createId === 'function' ? options.createId : createFallbackId;
    const presetDetails = new Map();
    for (const [presetName, preset] of Object.entries(payload.vibePresets || {})) {
        const vibeDataId = String(preset?.vibeDataId || '').trim();
        if (vibeDataId && !presetDetails.has(vibeDataId)) {
            presetDetails.set(vibeDataId, {
                name: presetName,
                informationExtracted: preset?.infoExtract ?? preset?.informationExtracted
            });
        }
    }

    const groups = [];
    let skipped = 0;
    let totalVibes = 0;
    let totalEncodingChars = 0;
    const sourceGroupEntries = Object.entries(sourceGroups);
    if (sourceGroupEntries.length > MAX_GROUPS_PER_IMPORT) {
        throw new Error(`单个文件最多包含 ${MAX_GROUPS_PER_IMPORT} 个 Vibe 分组`);
    }
    for (const [groupName, sourceGroup] of sourceGroupEntries) {
        const references = Array.isArray(sourceGroup?.vibes) ? sourceGroup.vibes : [];
        if (references.length > MAX_VIBES_PER_GROUP) {
            throw new Error(`单个分组最多包含 ${MAX_VIBES_PER_GROUP} 个 Vibe`);
        }
        totalVibes += references.length;
        if (totalVibes > MAX_VIBES_PER_IMPORT) throw new Error(`单次最多导入 ${MAX_VIBES_PER_IMPORT} 个 Vibe`);
        const items = references.map((reference, index) => {
            const vibeDataId = String(reference?.vibeDataId || '').trim();
            const vibeData = sourceVibeData[vibeDataId];
            if (vibeData?.identifier && vibeData.identifier !== 'novelai-vibe-transfer') {
                skipped += 1;
                return null;
            }
            if (vibeData?.type && vibeData.type !== 'encoding') {
                skipped += 1;
                return null;
            }
            const resolved = findVibeEncoding(vibeData);
            if (!resolved) {
                skipped += 1;
                return null;
            }
            totalEncodingChars += resolved.encoding.length;
            if (totalEncodingChars > MAX_ENCODING_CHARS_PER_IMPORT) throw new Error('Vibe 编码总大小超过 8MB');
            return {
                id: createId(),
                name: String(presetDetails.get(vibeDataId)?.name || vibeData?.name || `Vibe ${index + 1}`).trim(),
                image: '',
                encoding: resolved.encoding,
                encodingModel: resolved.model,
                encodingVariant: resolved.variant,
                strength: clampVibeValue(reference?.strength ?? vibeData?.importInfo?.strength, 0.6),
                informationExtracted: clampVibeValue(
                    vibeData?.importInfo?.information_extracted
                    ?? presetDetails.get(vibeDataId)?.informationExtracted,
                    1
                ),
                cacheSecretKey: vibeDataId
            };
        }).filter(Boolean);

        if (!items.length) continue;
        groups.push({
            id: createId(),
            name: String(groupName || '导入的 Vibe 组').trim() || '导入的 Vibe 组',
            items,
            updatedAt: Date.now()
        });
    }

    if (!groups.length) throw new Error('文件中没有可用的 Vibe 编码');
    return { groups, skipped };
}

export { isVibeEncoding };
