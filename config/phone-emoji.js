const PHONE_INLINE_EMOJI_LIST = Object.freeze([
    Object.freeze({
        token: '[狗头]',
        name: '狗头',
        image: new URL('../assets/emoji/goutou.webp', import.meta.url).href
    })
]);

const PHONE_INLINE_EMOJI_BY_TOKEN = new Map(
    PHONE_INLINE_EMOJI_LIST.map((emoji) => [emoji.token, emoji])
);

export function getPhoneInlineEmojis() {
    return PHONE_INLINE_EMOJI_LIST;
}

export function getPhoneInlineEmoji(token) {
    return PHONE_INLINE_EMOJI_BY_TOKEN.get(String(token || '')) || null;
}

export function renderPhoneInlineEmoji(token, { size = 16, inline = true, className = '' } = {}) {
    const emoji = getPhoneInlineEmoji(token);
    if (!emoji) return '';

    const safeSize = Math.max(12, Math.min(64, Number(size) || 16));
    const display = inline ? 'inline-block' : 'block';
    const verticalAlign = inline ? 'vertical-align:text-bottom;' : '';
    const extraClass = String(className || '').trim().replace(/[^a-zA-Z0-9_-]+/g, ' ');
    const classes = ['phone-inline-emoji', extraClass].filter(Boolean).join(' ');

    return `<img src="${emoji.image}" alt="${emoji.name}" title="${emoji.name}" draggable="false" class="${classes}" style="width:${safeSize}px;height:${safeSize}px;${verticalAlign}display:${display};object-fit:contain;" onerror="this.replaceWith(document.createTextNode(this.alt))">`;
}

export function replacePhoneInlineEmojiTokens(html, options = {}) {
    let result = String(html ?? '');
    for (const emoji of PHONE_INLINE_EMOJI_LIST) {
        if (!result.includes(emoji.token)) continue;
        result = result.split(emoji.token).join(renderPhoneInlineEmoji(emoji.token, options));
    }
    return result;
}
