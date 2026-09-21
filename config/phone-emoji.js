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

const PHONE_NAMED_UNICODE_EMOJI_MAP = Object.freeze({
    '[微笑]': '😊',
    '[撇嘴]': '😥',
    '[色]': '😍',
    '[发呆]': '😳',
    '[得意]': '😏',
    '[流泪]': '😭',
    '[害羞]': '😊',
    '[闭嘴]': '🤐',
    '[睡]': '😴',
    '[大哭]': '😭',
    '[尴尬]': '😅',
    '[发怒]': '😠',
    '[调皮]': '😜',
    '[呲牙]': '😁',
    '[惊讶]': '😮',
    '[难过]': '😔',
    '[酷]': '😎',
    '[冷汗]': '😰',
    '[抓狂]': '😤',
    '[吐]': '🤮',
    '[偷笑]': '🤭',
    '[可爱]': '🥰',
    '[白眼]': '🙄',
    '[傲慢]': '😤',
    '[饥饿]': '🤤',
    '[困]': '😪',
    '[惊恐]': '😨',
    '[流汗]': '😓',
    '[憨笑]': '😄',
    '[奋斗]': '✊',
    '[咒骂]': '🤬',
    '[疑问]': '🤔',
    '[嘘]': '🤫',
    '[晕]': '😵',
    '[衰]': '😞',
    '[骷髅]': '💀',
    '[再见]': '👋',
    '[擦汗]': '😅',
    '[鼓掌]': '👏',
    '[糗大了]': '😖',
    '[坏笑]': '😏',
    '[左哼哼]': '😤',
    '[右哼哼]': '😤',
    '[哈欠]': '🥱',
    '[鄙视]': '🙄',
    '[委屈]': '🥺',
    '[快哭了]': '😢',
    '[阴险]': '😏',
    '[亲亲]': '😘',
    '[吓]': '😱',
    '[可怜]': '🥺',
    '[加油]': '💪',
    '[抱抱]': '🤗',
    '[爱心]': '❤️',
    '[心碎]': '💔',
    '[赞]': '👍',
    '[踩]': '👎',
    '[OK]': '👌',
    '[胜利]': '✌️',
    '[握手]': '🤝',
    '[祈祷]': '🙏',
    '[庆祝]': '🎉',
    '[礼物]': '🎁',
    '[火]': '🔥',
    '[星星]': '⭐',
    '[闪耀]': '✨'
});

export function getPhoneInlineEmojis() {
    return PHONE_INLINE_EMOJI_LIST;
}

export function getPhoneInlineEmoji(token) {
    return PHONE_INLINE_EMOJI_BY_TOKEN.get(String(token || '')) || null;
}

export function getPhoneNamedUnicodeEmoji(token) {
    return PHONE_NAMED_UNICODE_EMOJI_MAP[String(token || '')] || '';
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

export function replacePhoneNamedEmojiTokens(text) {
    let result = String(text ?? '');
    for (const [token, emoji] of Object.entries(PHONE_NAMED_UNICODE_EMOJI_MAP)) {
        if (!result.includes(token)) continue;
        result = result.split(token).join(emoji);
    }
    return result;
}
