// Shared color conversion for phone and app color pickers.
export function parsePhoneHexColor(value) {
    let clean = String(value || '').trim();
    if (!clean) return null;
    if (!clean.startsWith('#')) clean = `#${clean}`;
    if (/^#[0-9a-f]{3}$/i.test(clean)) {
        clean = `#${clean.slice(1).split('').map(char => char.repeat(2)).join('')}`;
    }
    return /^#[0-9a-f]{6}$/i.test(clean) ? clean.toUpperCase() : null;
}

export function normalizePhoneHexColor(value, fallback = '#1a1a1a') {
    return parsePhoneHexColor(value) || parsePhoneHexColor(fallback) || '#1A1A1A';
}

export function clampPhoneColorNumber(value, min, max) {
    const number = Number(value);
    return Math.min(max, Math.max(min, Number.isFinite(number) ? number : min));
}

export function phoneHexToRgb(value) {
    const hex = normalizePhoneHexColor(value).slice(1);
    return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16)
    ];
}

export function phoneRgbToHex(rgb) {
    return `#${rgb.map(channel => Math.round(clampPhoneColorNumber(channel, 0, 255)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export function phoneRgbToHsv(rgb) {
    const [r, g, b] = rgb.map(channel => clampPhoneColorNumber(channel, 0, 255) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let hue = 0;

    if (delta) {
        if (max === r) hue = 60 * (((g - b) / delta) % 6);
        else if (max === g) hue = 60 * (((b - r) / delta) + 2);
        else hue = 60 * (((r - g) / delta) + 4);
    }
    if (hue < 0) hue += 360;

    return {
        h: hue,
        s: max ? delta / max : 0,
        v: max
    };
}

export function phoneHsvToRgb({ h, s, v }) {
    const hue = ((clampPhoneColorNumber(h, 0, 360) % 360) + 360) % 360;
    const saturation = clampPhoneColorNumber(s, 0, 1);
    const value = clampPhoneColorNumber(v, 0, 1);
    const chroma = value * saturation;
    const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const match = value - chroma;
    let channels;

    if (hue < 60) channels = [chroma, x, 0];
    else if (hue < 120) channels = [x, chroma, 0];
    else if (hue < 180) channels = [0, chroma, x];
    else if (hue < 240) channels = [0, x, chroma];
    else if (hue < 300) channels = [x, 0, chroma];
    else channels = [chroma, 0, x];

    return channels.map(channel => (channel + match) * 255);
}

