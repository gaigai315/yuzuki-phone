// 微信内的文字文件：正文保持纯文本，只有完整文件边界才会生成卡片。
export function getWechatFileAppearance(title = '') {
    const extension = String(title).trim().match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
    if (['doc', 'docx'].includes(extension)) return { kind: 'word', glyph: 'W', label: 'Word 文档' };
    if (['xls', 'xlsx', 'csv'].includes(extension)) return { kind: 'excel', glyph: 'X', label: '表格文件' };
    if (['ppt', 'pptx'].includes(extension)) return { kind: 'powerpoint', glyph: 'P', label: '演示文稿' };
    if (extension === 'pdf') return { kind: 'pdf', glyph: 'PDF', label: 'PDF 文档' };
    if (extension === 'txt') return { kind: 'text', glyph: 'TXT', label: '文本文档' };
    return { kind: 'generic', glyph: 'FILE', label: '微信文件' };
}

export function parseWechatFile(content = '') {
    const match = String(content).trim().match(/^<文件>\s*标题\s*[:：]\s*([^\r\n]+)\r?\n\s*内容\s*[:：]([\s\S]*?)\s*<\/?文件>$/);
    if (!match) return null;
    const title = match[1].trim();
    const text = match[2].trim();
    if (!title || !text) return null;
    return { type: 'file_card', fileTitle: title, fileText: text, content: formatWechatFile(title, text) };
}

export function formatWechatFile(title = '', text = '') {
    return `<文件>\n标题：${String(title).trim()}\n内容：${String(text).trim()}\n<文件>`;
}

export function tokenizeWechatFiles(raw = '') {
    const source = String(raw);
    const pattern = /<文件>[\s\S]*?<\/?文件>/g;
    const tokenMap = new Map();
    let text = '';
    let cursor = 0;
    for (const match of source.matchAll(pattern)) {
        const file = parseWechatFile(match[0]);
        if (!file) continue;
        let start = match.index;
        let prefix = '';
        const lineStart = source.lastIndexOf('\n', start - 1) + 1;
        const inlinePrefix = source.slice(lineStart, start);
        if (!inlinePrefix.trim() && lineStart > cursor) {
            const previousStart = source.lastIndexOf('\n', lineStart - 2) + 1;
            const previous = source.slice(previousStart, lineStart).trim();
            if (/^(?:\[\d{1,2}[:：]\d{2}\]\s*)?(?:[^<>\r\n:：]{1,40}[:：]\s*)$/.test(previous)
                || /^\[\d{1,2}[:：]\d{2}\]$/.test(previous)) {
                start = previousStart;
                prefix = `${previous} `;
            }
        }
        const time = (prefix || inlinePrefix).match(/\[(\d{1,2}[:：]\d{2})\]/)?.[1];
        const token = `__ST_PHONE_FILE_${tokenMap.size}__`;
        tokenMap.set(token, { ...file, ...(time ? { time: time.replace('：', ':') } : {}) });
        text += source.slice(cursor, start) + prefix + token;
        cursor = match.index + match[0].length;
    }
    return { text: text + source.slice(cursor), tokenMap };
}
