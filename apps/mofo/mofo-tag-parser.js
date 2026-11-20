// Only parse custom tags outside reasoning; keep original offsets for message formatting.
export function findMofoTagBlocks(rawText, tagName) {
    const source = String(rawText || '');
    if (!source || !tagName) return [];

    const reasoning = /(?:<|&lt;)\s*(\/?)\s*(draft_notes|think|thinking|tink|thking)(?=\s|>|&gt;)[^<>]*?(?:>|&gt;)/gi;
    const segments = [];
    const stack = [];
    let start = 0;
    let boundary;
    while ((boundary = reasoning.exec(source)) !== null) {
        const name = boundary[2].toLowerCase();
        if (!boundary[1]) {
            if (stack.length === 0) segments.push([start, boundary.index]);
            stack.push(name);
        } else {
            const index = stack.lastIndexOf(name);
            if (index !== -1) {
                stack.splice(index);
                if (stack.length === 0) start = reasoning.lastIndex;
            } else if (stack.length === 0) {
                // A stripped opening tag can leave a reasoning prefix with only its closing tag.
                segments.length = 0;
                start = reasoning.lastIndex;
            }
        }
    }
    if (stack.length === 0) segments.push([start, source.length]);

    const escapedTag = String(tagName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tags = new RegExp(`(?:<|&lt;)\\s*(\\/?)\\s*${escapedTag}\\s*(?:>|&gt;)`, 'gi');
    const blocks = [];
    for (const [segmentStart, segmentEnd] of segments) {
        const text = source.slice(segmentStart, segmentEnd);
        let opening = null;
        let match;
        tags.lastIndex = 0;
        while ((match = tags.exec(text)) !== null) {
            if (!match[1]) {
                // Restart at a newer opening instead of swallowing intervening prose.
                opening = { index: match.index, end: tags.lastIndex };
            } else if (opening) {
                blocks.push({
                    index: segmentStart + opening.index,
                    length: tags.lastIndex - opening.index,
                    fullMatch: text.slice(opening.index, tags.lastIndex),
                    payload: text.slice(opening.end, match.index)
                });
                opening = null;
            }
        }
    }
    return blocks;
}
