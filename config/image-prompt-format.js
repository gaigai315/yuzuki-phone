const MEDIA_TAG_PATTERN = /\[(用户照片|个人图片|图片(?:-[^\]\r\n]+)?|视频)\]/g;
const OPEN_TO_CLOSE = Object.freeze({
    '(': ')',
    '（': '）'
});
const CLOSERS = new Set(Object.values(OPEN_TO_CLOSE));

const skipWhitespace = (value, startIndex) => {
    let index = startIndex;
    while (index < value.length && /\s/.test(value[index])) index += 1;
    return index;
};

export function readBalancedImagePromptGroup(value = '', startIndex = 0) {
    const text = String(value || '');
    const opener = text[startIndex];
    if (!OPEN_TO_CLOSE[opener]) return null;

    const stack = [{ opener, closer: OPEN_TO_CLOSE[opener] }];
    for (let index = startIndex + 1; index < text.length; index += 1) {
        const char = text[index];
        if (OPEN_TO_CLOSE[char]) {
            stack.push({ opener: char, closer: OPEN_TO_CLOSE[char] });
            continue;
        }
        if (!CLOSERS.has(char)) continue;

        const current = stack[stack.length - 1];
        if (char === current.closer) {
            stack.pop();
        } else if (stack.length === 1 && text.indexOf(current.closer, index + 1) === -1) {
            // Preserve support for legacy mixed pairs such as `（description)`.
            stack.pop();
        } else {
            continue;
        }

        if (stack.length === 0) {
            return {
                text: text.slice(startIndex + 1, index),
                raw: text.slice(startIndex, index + 1),
                startIndex,
                endIndex: index + 1,
                opener,
                closer: char
            };
        }
    }
    return null;
}

export function parseImagePromptDescriptionPair(rawValue = '') {
    const raw = String(rawValue || '').trim()
        .replace(/^\[(?:用户照片|个人图片|图片(?:-[^\]\r\n]+)?|视频)\]\s*/i, '')
        .trim();
    const groups = [];
    let scanIndex = skipWhitespace(raw, 0);

    if (!OPEN_TO_CLOSE[raw[scanIndex]]) {
        return { description: raw, prompt: raw, groups, raw };
    }

    while (scanIndex < raw.length && OPEN_TO_CLOSE[raw[scanIndex]]) {
        const group = readBalancedImagePromptGroup(raw, scanIndex);
        if (!group) return { description: raw, prompt: raw, groups: [], raw };
        const text = String(group.text || '').trim();
        if (text) groups.push(text);
        scanIndex = skipWhitespace(raw, group.endIndex);
    }

    if (raw.slice(scanIndex).trim()) {
        return { description: raw, prompt: raw, groups: [], raw };
    }

    if (groups.length >= 2) {
        return {
            description: groups[0],
            prompt: groups.slice(1).join(', '),
            groups,
            raw
        };
    }

    const single = groups[0] || raw;
    return { description: single, prompt: single, groups, raw };
}

export function extractImagePromptItems(source = '', options = {}) {
    const text = String(source || '');
    const maxItems = Number.isFinite(options.maxItems)
        ? Math.max(0, Math.floor(options.maxItems))
        : Number.POSITIVE_INFINITY;
    const acceptMediaType = typeof options.acceptMediaType === 'function'
        ? options.acceptMediaType
        : () => true;
    const items = [];
    const mediaTagPattern = new RegExp(MEDIA_TAG_PATTERN.source, MEDIA_TAG_PATTERN.flags);
    let tagMatch;

    while (items.length < maxItems && (tagMatch = mediaTagPattern.exec(text)) !== null) {
        const mediaType = String(tagMatch[1] || '').trim();
        if (!acceptMediaType(mediaType)) continue;

        let cursor = skipWhitespace(text, mediaTagPattern.lastIndex);
        const firstGroup = readBalancedImagePromptGroup(text, cursor);
        if (!firstGroup) continue;

        const groups = [String(firstGroup.text || '').trim()];
        cursor = skipWhitespace(text, firstGroup.endIndex);
        const secondGroup = readBalancedImagePromptGroup(text, cursor);
        if (secondGroup) {
            groups.push(String(secondGroup.text || '').trim());
            cursor = secondGroup.endIndex;
        } else {
            cursor = firstGroup.endIndex;
        }

        const item = {
            index: tagMatch.index,
            endIndex: cursor,
            raw: text.slice(tagMatch.index, cursor),
            mediaType,
            description: groups[0] || '',
            prompt: groups[1] || groups[0] || '',
            groups
        };
        items.push(item);
        mediaTagPattern.lastIndex = cursor;
    }

    return items;
}

export function removeImagePromptItems(source = '', items = null) {
    const text = String(source || '');
    const matches = Array.isArray(items) ? items : extractImagePromptItems(text);
    if (matches.length === 0) return text;

    let result = '';
    let cursor = 0;
    for (const item of [...matches].sort((left, right) => left.index - right.index)) {
        if (!Number.isInteger(item?.index) || !Number.isInteger(item?.endIndex) || item.index < cursor) continue;
        result += text.slice(cursor, item.index);
        cursor = item.endIndex;
    }
    return result + text.slice(cursor);
}

export function isImagePromptItem(value = '') {
    const text = String(value || '');
    const items = extractImagePromptItems(text, { maxItems: 1 });
    if (items.length !== 1) return false;
    return text.slice(0, items[0].index).trim() === ''
        && text.slice(items[0].endIndex).trim() === '';
}
