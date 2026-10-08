/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

export function escapeMofoHtml(value = '') {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function valueToString(value) {
    if (value === null || typeof value === 'undefined') return '';
    if (typeof value !== 'object') return String(value);
    try {
        return JSON.stringify(value);
    } catch (e) {
        return '';
    }
}

function resolveObjectPath(source, path = '') {
    const normalized = String(path || '')
        .trim()
        .replace(/\[(\d+)\]/g, '.$1')
        .replace(/\[['"]([^'"[\]]+)['"]\]/g, '.$1')
        .replace(/^\.+|\.+$/g, '');
    if (!normalized) return { exists: true, value: source };

    const segments = normalized.split('.').map(part => part.trim()).filter(Boolean);
    let current = source;
    for (const segment of segments) {
        if (current === null || typeof current === 'undefined') return { exists: false, value: '' };
        if (Array.isArray(current)) {
            if (!/^\d+$/.test(segment)) return { exists: false, value: '' };
            const index = Number(segment);
            if (index < 0 || index >= current.length) return { exists: false, value: '' };
            current = current[index];
            continue;
        }
        if (typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, segment)) {
            current = current[segment];
            continue;
        }
        return { exists: false, value: '' };
    }
    return { exists: true, value: current };
}

function resolveTemplateValue(context, expression = '') {
    let expr = String(expression || '').trim();
    if (!expr) return { exists: false, value: '' };
    if (expr === 'this' || expr === '.') return { exists: true, value: context.value };
    if (expr === '@index') return { exists: true, value: context.meta?.index ?? '' };
    if (expr === '@number') return { exists: true, value: Number(context.meta?.index ?? -1) + 1 };
    if (expr === '@key') return { exists: true, value: context.meta?.key ?? '' };
    if (expr === '@first') return { exists: true, value: !!context.meta?.first };
    if (expr === '@last') return { exists: true, value: !!context.meta?.last };

    let targetContext = context;
    if (expr.startsWith('@root')) {
        expr = expr.replace(/^@root\.?/, '');
        return resolveObjectPath(context.root, expr);
    }
    while (expr.startsWith('../')) {
        targetContext = targetContext.parent || targetContext;
        expr = expr.slice(3);
    }
    expr = expr.replace(/^this\.?/, '').replace(/^\.\//, '');
    const localResult = resolveObjectPath(targetContext.value, expr);
    if (localResult.exists) return localResult;
    if (targetContext.value !== context.root) return resolveObjectPath(context.root, expr);
    return localResult;
}

function tokenizeTemplate(template = '') {
    const source = String(template || '');
    const tokens = [];
    const regex = /\{\{\{\s*([^{}]+?)\s*\}\}\}|\{\{\s*([^{}]+?)\s*\}\}/g;
    let cursor = 0;
    let match = null;
    while ((match = regex.exec(source)) !== null) {
        if (match.index > cursor) tokens.push({ type: 'text', value: source.slice(cursor, match.index) });
        tokens.push({
            type: 'tag',
            value: String(match[1] ?? match[2] ?? '').trim(),
            raw: typeof match[1] !== 'undefined',
            source: match[0]
        });
        cursor = match.index + match[0].length;
    }
    if (cursor < source.length) tokens.push({ type: 'text', value: source.slice(cursor) });
    return tokens;
}

function parseTemplate(template = '') {
    const root = { type: 'root', children: [] };
    const stack = [{ node: root, children: root.children }];

    tokenizeTemplate(template).forEach((token) => {
        const current = stack[stack.length - 1];
        if (token.type === 'text') {
            current.children.push(token);
            return;
        }

        const openMatch = token.value.match(/^#(each|if)\s+(.+)$/i);
        if (openMatch) {
            const node = {
                type: 'block',
                kind: openMatch[1].toLowerCase(),
                expression: String(openMatch[2] || '').trim(),
                children: [],
                inverse: []
            };
            current.children.push(node);
            stack.push({ node, children: node.children });
            return;
        }

        if (/^else$/i.test(token.value)) {
            const top = stack[stack.length - 1];
            if (top?.node?.type === 'block' && top.node.kind === 'if') {
                top.children = top.node.inverse;
                return;
            }
        }

        const closeMatch = token.value.match(/^\/(each|if)$/i);
        if (closeMatch) {
            const top = stack[stack.length - 1];
            if (stack.length > 1 && top?.node?.kind === closeMatch[1].toLowerCase()) {
                stack.pop();
                return;
            }
        }

        current.children.push({
            type: 'variable',
            expression: token.value,
            raw: token.raw,
            source: token.source
        });
    });

    return root;
}

function isTruthy(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return !!value;
}

function renderNodes(nodes, context) {
    return nodes.map((node) => {
        if (node.type === 'text') return node.value;
        if (node.type === 'variable') {
            const result = resolveTemplateValue(context, node.expression);
            if (!result.exists) return '';
            const output = valueToString(result.value);
            return node.raw ? output : escapeMofoHtml(output);
        }
        if (node.type !== 'block') return '';

        const result = resolveTemplateValue(context, node.expression);
        if (node.kind === 'if') {
            return renderNodes(isTruthy(result.value) ? node.children : node.inverse, context);
        }
        if (node.kind !== 'each' || !result.exists) return '';

        const entries = Array.isArray(result.value)
            ? result.value.map((value, index) => [index, value])
            : ((result.value && typeof result.value === 'object') ? Object.entries(result.value) : []);
        return entries.map(([key, value], index) => renderNodes(node.children, {
            value,
            root: context.root,
            parent: context,
            meta: {
                key,
                index,
                first: index === 0,
                last: index === entries.length - 1
            }
        })).join('');
    }).join('');
}

export function renderMofoTemplate(template, state = {}) {
    const source = String(template || '');
    if (!source) return '';
    const rootValue = (state && typeof state === 'object') ? state : {};
    const tree = parseTemplate(source);
    return renderNodes(tree.children, {
        value: rootValue,
        root: rootValue,
        parent: null,
        meta: {}
    });
}

export function combineMofoBeautifyTemplate(htmlTemplate = '', cssText = '') {
    const html = String(htmlTemplate || '').trim();
    const css = String(cssText || '').trim();
    return [css ? `<style>\n${css}\n</style>` : '', html]
        .filter(Boolean)
        .join('\n\n');
}

export function splitMofoBeautifyTemplate(source = '') {
    const cssParts = [];
    const htmlTemplate = String(source || '')
        .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_full, cssText) => {
            const css = String(cssText || '').trim();
            if (css) cssParts.push(css);
            return '\n';
        })
        .trim();
    return {
        cssText: cssParts.join('\n\n'),
        htmlTemplate
    };
}

function parseMetric(value = '') {
    const text = String(value || '').trim();
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
    return text;
}

function firstCharacter(value = '') {
    return Array.from(String(value || '').trim())[0] || '';
}

function parseForumTopic(section = '') {
    const knownKeys = new Set(['标题', '发布人', '日期', '内容', '点赞', '转发']);
    const values = {};
    let activeKey = '';

    String(section || '').replace(/\r\n?/g, '\n').split('\n').forEach((rawLine) => {
        const line = String(rawLine || '');
        const fieldMatch = line.match(/^\s*([^:：]+?)\s*[:：]\s*(.*)$/);
        const candidateKey = String(fieldMatch?.[1] || '').trim();
        if (fieldMatch && knownKeys.has(candidateKey)) {
            activeKey = candidateKey;
            values[activeKey] = String(fieldMatch[2] || '').trim();
            return;
        }
        if (!activeKey) return;
        const previous = String(values[activeKey] || '');
        values[activeKey] = `${previous}${previous ? '\n' : ''}${line}`.trim();
    });

    const author = String(values['发布人'] || '').trim();
    return {
        title: String(values['标题'] || '').trim(),
        author,
        authorInitial: firstCharacter(author),
        date: String(values['日期'] || '').trim(),
        content: String(values['内容'] || '').trim(),
        likes: parseMetric(values['点赞']),
        reposts: parseMetric(values['转发'])
    };
}

function parseForumCommentBody(body = '') {
    const parts = String(body || '').split('|').map(part => part.trim());
    const authorAndContent = parts.shift() || '';
    const separatorIndex = authorAndContent.search(/[:：]/);
    const author = separatorIndex >= 0 ? authorAndContent.slice(0, separatorIndex).trim() : '';
    const content = separatorIndex >= 0 ? authorAndContent.slice(separatorIndex + 1).trim() : authorAndContent.trim();
    const time = parts.shift() || '';
    const likesRaw = parts.join('|').trim();
    const likes = likesRaw.replace(/^赞\s*/i, '').trim() || '0';
    return {
        author,
        authorInitial: firstCharacter(author),
        content,
        time,
        likes: parseMetric(likes),
        likesText: /^赞/i.test(likesRaw) ? likesRaw : `赞 ${likes}`
    };
}

function findReplyTarget(comments, floor, author) {
    if (Number.isInteger(floor)) {
        const byFloor = comments.find(comment => Number(comment.floor) === floor);
        if (byFloor) return byFloor;
    }
    const targetName = String(author || '').trim();
    if (targetName) {
        for (let index = comments.length - 1; index >= 0; index -= 1) {
            if (String(comments[index]?.author || '').trim() === targetName) return comments[index];
        }
    }
    return comments[comments.length - 1] || null;
}

function parseForumComments(section = '') {
    const comments = [];
    let lastRecord = null;

    String(section || '').replace(/\r\n?/g, '\n').split('\n').forEach((rawLine) => {
        const line = String(rawLine || '').trim();
        if (!line) return;

        const mainMatch = line.match(/^(\d+)\s*L\s*[:：]\s*\[([\s\S]*)\]\s*$/i);
        if (mainMatch) {
            const floor = Number(mainMatch[1]);
            const comment = {
                floor,
                floorLabel: `${floor}L`,
                ...parseForumCommentBody(mainMatch[2]),
                replies: []
            };
            comments.push(comment);
            lastRecord = comment;
            return;
        }

        const replyMatch = line.match(/^回复\s*(?:(\d+)\s*L)?\s*\[([^\]]*)\]\s*[:：]\s*\[([\s\S]*)\]\s*$/i);
        if (replyMatch) {
            const explicitFloor = replyMatch[1] ? Number(replyMatch[1]) : null;
            const replyTo = String(replyMatch[2] || '').trim();
            const target = findReplyTarget(comments, explicitFloor, replyTo);
            if (!target) return;
            const reply = {
                ...parseForumCommentBody(replyMatch[3]),
                replyTo: replyTo || target.author,
                targetFloor: target.floor,
                targetFloorLabel: target.floorLabel
            };
            target.replies.push(reply);
            lastRecord = reply;
            return;
        }

        if (lastRecord) lastRecord.content = `${String(lastRecord.content || '').trim()}\n${line}`.trim();
    });

    return comments;
}

export function parseForumPayload(payload = '') {
    const source = String(payload || '').trim();
    const topicMatch = source.match(/<\s*主题\s*>([\s\S]*?)<\s*\/\s*主题\s*>/i);
    const commentsMatch = source.match(/<\s*评论区\s*>([\s\S]*?)<\s*\/\s*评论区\s*>/i);
    const topic = parseForumTopic(topicMatch?.[1] || source);
    const comments = parseForumComments(commentsMatch?.[1] || '');
    return {
        topic,
        comments,
        commentCount: comments.length,
        hasComments: comments.length > 0
    };
}

function convertStructuredValue(value = '') {
    const text = String(value || '').trim();
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
    if (/^(true|false)$/i.test(text)) return /^true$/i.test(text);
    if (/^null$/i.test(text)) return null;
    return text;
}

function parseStructuredLeaf(content = '') {
    const fields = {};
    const items = [];
    const textLines = [];
    let activeKey = '';

    String(content || '').replace(/\r\n?/g, '\n').split('\n').forEach((rawLine) => {
        const line = String(rawLine || '').trim();
        if (!line) return;

        const itemMatch = line.match(/^(\d+)([A-Za-z\u4e00-\u9fff]*)\s*[:：]\s*\[([\s\S]*)\]\s*$/);
        if (itemMatch) {
            const body = String(itemMatch[3] || '').trim();
            items.push({
                index: Number(itemMatch[1]),
                label: `${itemMatch[1]}${itemMatch[2] || ''}`,
                content: body,
                parts: body.split('|').map(part => part.trim())
            });
            activeKey = '';
            return;
        }

        const fieldMatch = line.match(/^([^:：=]+?)\s*[:：=]\s*(.*)$/);
        if (fieldMatch) {
            activeKey = String(fieldMatch[1] || '').trim();
            fields[activeKey] = convertStructuredValue(fieldMatch[2]);
            return;
        }

        if (activeKey) {
            const previous = String(fields[activeKey] ?? '');
            fields[activeKey] = `${previous}${previous ? '\n' : ''}${line}`;
        } else {
            textLines.push(line);
        }
    });

    const result = { ...fields };
    if (items.length > 0) result.items = items;
    if (textLines.length > 0) result.content = textLines.join('\n');
    if (Object.keys(result).length > 0) return result;
    return String(content || '').trim();
}

function addStructuredChild(target, key, value) {
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
        target[key] = value;
        return;
    }
    if (!Array.isArray(target[key])) target[key] = [target[key]];
    target[key].push(value);
}

function parseStructuredNode(content = '') {
    const source = String(content || '').trim();
    const children = {};
    const childPattern = /<\s*([^\s<>/]+)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi;
    let residual = source;
    let match = null;
    while ((match = childPattern.exec(source)) !== null) {
        addStructuredChild(children, String(match[1] || '').trim(), parseStructuredNode(match[2]));
        residual = residual.replace(match[0], '\n');
    }

    const leaf = parseStructuredLeaf(residual);
    if (Object.keys(children).length === 0) return leaf;
    if (leaf && typeof leaf === 'object' && !Array.isArray(leaf)) return { ...children, ...leaf };
    if (String(leaf || '').trim()) return { ...children, content: leaf };
    return children;
}

export function parseStructuredPayload(payload = '') {
    const parsed = parseStructuredNode(payload);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return { content: String(parsed || '') };
}

export function sanitizeMofoCss(cssText = '') {
    return String(cssText || '')
        .replace(/<\/style/gi, '<\\/style')
        .replace(/@import\s+[^;]+;?/gi, '')
        .replace(/expression\s*\([^)]*\)/gi, '')
        .replace(/url\s*\(\s*(['"]?)\s*javascript:[\s\S]*?\1\s*\)/gi, 'url("")');
}

export function scopeMofoCss(cssText = '', scopeSelector = '.yzp-mofo-render-scope') {
    const source = sanitizeMofoCss(cssText);
    if (!source.trim()) return '';
    return source.replace(/(^|[{}])(\s*[^@{}][^{}]*?)\{/g, (match, boundary, selectorGroup) => {
        const scoped = String(selectorGroup || '')
            .split(',')
            .map((part) => {
                const selector = String(part || '').trim();
                if (!selector) return '';
                if (/^(from|to|\d+%)$/i.test(selector)) return selector;
                if (/^(html|body|:root)$/i.test(selector)) return scopeSelector;
                if (selector.startsWith(scopeSelector)) return selector;
                return `${scopeSelector} ${selector}`;
            })
            .filter(Boolean)
            .join(', ');
        return scoped ? `${boundary}${scoped}{` : match;
    });
}
