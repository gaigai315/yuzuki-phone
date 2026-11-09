import { normalizePhoneHexColor, phoneHexToRgb } from '../../config/phone-colors.js';

function luminance(color) {
    const channels = phoneHexToRgb(color).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function compositeChannel(foreground, background, alpha) {
    return Math.round(foreground * alpha + background * (1 - alpha));
}

function contrastRatio(text, background) {
    const values = [luminance(text), luminance(background)].sort((a, b) => a - b);
    return (values[1] + 0.05) / (values[0] + 0.05);
}

function compositeGlass(base, backdrop, alpha) {
    const baseRgb = phoneHexToRgb(base);
    const backdropRgb = phoneHexToRgb(backdrop);
    const rgb = baseRgb.map((channel, index) => compositeChannel(channel, backdropRgb[index], alpha));
    return `#${rgb.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

function findGlassAlpha(text, base, worstBackdrop) {
    let low = 0;
    let high = 1;
    for (let index = 0; index < 18; index++) {
        const middle = (low + high) / 2;
        const composite = compositeGlass(base, worstBackdrop, middle);
        if (contrastRatio(text, composite) >= 4.5) high = middle;
        else low = middle;
    }
    return Math.min(1, Math.max(0.52, high + 0.06));
}

export function getWechatReadablePalette(value) {
    const text = normalizePhoneHexColor(value, '#000000');
    const lightness = luminance(text);
    const contrast = background => {
        const other = luminance(background);
        return (Math.max(lightness, other) + 0.05) / (Math.min(lightness, other) + 0.05);
    };
    // The glass is tested against the worst possible backdrop. Colors near the
    // contrast boundary receive a denser tint; black and white stay translucent.
    const dark = contrast('#000000') >= contrast('#FFFFFF');
    const base = dark ? '#000000' : '#FFFFFF';
    const worstBackdrop = dark ? '#FFFFFF' : '#000000';
    const alpha = findGlassAlpha(text, base, worstBackdrop);
    const surface = dark
        ? `rgba(10, 12, 16, ${alpha.toFixed(3)})`
        : `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
    return {
        text,
        surface,
        surfaceBase: base,
        surfaceAlpha: alpha,
        border: dark ? 'rgba(255, 255, 255, 0.28)' : 'rgba(0, 0, 0, 0.18)'
    };
}
