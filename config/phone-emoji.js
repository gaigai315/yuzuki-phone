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
    '[喜欢]': '😍',
    '[发呆]': '😳',
    '[得意]': '😏',
    '[流泪]': '😭',
    '[泪]': '😢',
    '[泪奔]': '😭',
    '[崩溃]': '😭',
    '[害羞]': '😊',
    '[脸红]': '😊',
    '[闭嘴]': '🤐',
    '[睡]': '😴',
    '[大哭]': '😭',
    '[笑哭]': '😂',
    '[笑cry]': '😂',
    '[允悲]': '😂',
    '[哈哈]': '😆',
    '[尴尬]': '😅',
    '[发怒]': '😠',
    '[怒]': '😡',
    '[生气]': '😡',
    '[调皮]': '😜',
    '[吐舌]': '😛',
    '[眨眼]': '😉',
    '[呲牙]': '😁',
    '[惊讶]': '😮',
    '[震惊]': '😲',
    '[难过]': '😔',
    '[苦涩]': '😣',
    '[酷]': '😎',
    '[冷汗]': '😰',
    '[汗]': '😓',
    '[抓狂]': '😤',
    '[吐]': '🤮',
    '[偷笑]': '🤭',
    '[可爱]': '🥰',
    '[白眼]': '🙄',
    '[无语]': '😑',
    '[捂脸]': '🤦',
    '[傲慢]': '😤',
    '[饥饿]': '🤤',
    '[困]': '😪',
    '[惊恐]': '😨',
    '[害怕]': '😨',
    '[流汗]': '😓',
    '[憨笑]': '😄',
    '[奋斗]': '✊',
    '[咒骂]': '🤬',
    '[恶魔]': '😈',
    '[疑问]': '🤔',
    '[思考]': '🤔',
    '[嘘]': '🤫',
    '[晕]': '😵',
    '[裂开]': '🤯',
    '[衰]': '😞',
    '[骷髅]': '💀',
    '[再见]': '👋',
    '[拜拜]': '👋',
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
    '[旺柴]': '🐶',
    '[吃瓜]': '🍉',
    '[加油]': '💪',
    '[抱抱]': '🤗',
    '[比心]': '🫰',
    '[心]': '❤️',
    '[爱心]': '❤️',
    '[心碎]': '💔',
    '[赞]': '👍',
    '[强]': '👍',
    '[踩]': '👎',
    '[弱]': '👎',
    '[OK]': '👌',
    '[胜利]': '✌️',
    '[耶]': '✌️',
    '[握手]': '🤝',
    '[抱拳]': '🤝',
    '[祈祷]': '🙏',
    '[求饶]': '🙏',
    '[拳头]': '👊',
    '[庆祝]': '🎉',
    '[礼物]': '🎁',
    '[红包]': '🧧',
    '[火]': '🔥',
    '[星星]': '⭐',
    '[闪耀]': '✨',
    '[玫瑰]': '🌹',
    '[蛋糕]': '🎂',
    '[咖啡]': '☕',
    '[饭]': '🍚',
    '[西瓜]': '🍉',
    '[烟花]': '🎆',
    '[月亮]': '🌙',
    '[太阳]': '☀️'
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

export function replacePhoneEmojiTokens(text, options = {}) {
    return replacePhoneInlineEmojiTokens(replacePhoneNamedEmojiTokens(text), options);
}
