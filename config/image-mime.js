/* ========================================================
 * Yuzuki's Little Phone
 * Shared image MIME detection helpers.
 * ======================================================== */

function normalizeMimeType(value) {
    return String(value || '').split(';')[0].trim().toLowerCase();
}

export function detectImageMime(bytes, fallback = '') {
    const normalizedFallback = normalizeMimeType(fallback);
    if (!bytes || bytes.length < 4) return normalizedFallback;

    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return 'image/png';
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg';
    }
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
        return 'image/gif';
    }
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
        return 'image/bmp';
    }
    if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
        return 'image/webp';
    }
    if (
        bytes.length >= 12 &&
        bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 &&
        bytes[8] === 0x61 && bytes[9] === 0x76 && bytes[10] === 0x69 &&
        (bytes[11] === 0x66 || bytes[11] === 0x73)
    ) {
        return 'image/avif';
    }

    return normalizedFallback;
}

export function resolveImageMime(bytes, reportedMime = '') {
    const normalizedReported = normalizeMimeType(reportedMime);
    const fallback = normalizedReported.startsWith('image/') ? normalizedReported : '';
    return detectImageMime(bytes, fallback);
}

export function normalizeImageDataUrlMime(dataUrl) {
    const raw = String(dataUrl || '').trim();
    const match = /^data:([^;,]+)((?:;[^,]*)*),([\s\S]*)$/i.exec(raw);
    if (!match || !/^image\//i.test(match[1]) || !/(?:^|;)base64(?:;|$)/i.test(match[2])) {
        return raw;
    }

    try {
        const payloadHeader = match[3].slice(0, 64).replace(/\s+/g, '');
        const headerLength = Math.floor(Math.min(payloadHeader.length, 32) / 4) * 4;
        if (headerLength < 4 || typeof atob !== 'function') return raw;

        const binaryHeader = atob(payloadHeader.slice(0, headerLength));
        const bytes = Uint8Array.from(binaryHeader, char => char.charCodeAt(0));
        const detectedMime = detectImageMime(bytes);
        const declaredMime = normalizeMimeType(match[1]);
        if (!detectedMime || detectedMime === declaredMime) return raw;

        return raw.replace(/^data:[^;,]+/i, `data:${detectedMime}`);
    } catch (e) {
        return raw;
    }
}
