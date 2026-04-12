/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  标签过滤工具（兼容记忆插件黑白名单逻辑）
 * ======================================================== */

const MEMORY_TAG_REGEX = /<(Memory|GaigaiMemory|memory|tableEdit|gaigaimemory|tableedit)>([\s\S]*?)<\/\1>/gi;

export const PHONE_TAG_FILTER_KEYS = {
    enabled: 'phone_tag_filter_enabled',
    blacklist: 'phone_tag_filter_blacklist',
    whitelist: 'phone_tag_filter_whitelist'
};

export const PHONE_TAG_FILTER_DEFAULTS = {
    enabled: false,
    blacklist: '',
    whitelist: ''
};

export const PHONE_TAG_FILTER_AI_DIAGNOSTIC_PROMPT = `你是一个剧情记录系统的标签过滤专家。你的任务是分析 AI 的回复文本，制定最优的标签过滤方案（黑名单或白名单）。

【系统过滤机制说明】
- 黑名单 (blacklist)：列出的标签及其内部内容会被删除，保留剩下的所有内容（包括裸文本和其他未列出的标签）。
- 白名单 (whitelist)：仅提取并保留列出的标签内部内容，其他所有内容（包括裸文本和其他标签）都会被删除。

【核心决策逻辑（必须遵守）】
1. 如果正文是裸文本（正文没有被特定标签包裹）：
   - 绝对不能使用白名单，否则裸文本会被全部删掉。
   - 只能使用黑名单，删除后台标签（如 think/system/Memory 等）。
2. 如果正文与时间都被标签包裹（如 <content>...</content>、[时间]...[/时间]）：
   - 可以优先使用白名单，保持配置简洁。
   - 白名单必须同时包含正文标签和时间标签（如 time/globalTime/[时间]）。

【标签格式提取要求】
- 方括号标签：必须保留方括号，如 "[歌曲]"。
- 尖括号标签：只提取标签名，不带括号，如 "think"。
- HTML 注释：统一写成 "!--"。

【分析任务】
请分析以下 AI 回复原文，并给出最简洁且安全的过滤方案：
---
{{RAW_TEXT}}
---

【输出要求】
只输出 JSON，格式如下：
{
  "reasoning": "简述为什么选择黑名单或白名单",
  "blacklist": ["标签1", "标签2"],
  "whitelist": ["标签A"]
}`;

function _toBoolean(value, fallback = false) {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return fallback;
}

function _pickStorage(storage) {
    if (storage) return storage;
    return (typeof window !== 'undefined') ? window.VirtualPhone?.storage : null;
}

export function hasGaigaiTagFilter() {
    if (typeof window === 'undefined') return false;
    return !!(
        typeof window.Gaigai?.cleanMemoryTags === 'function' &&
        typeof window.Gaigai?.tools?.filterContentByTags === 'function'
    );
}

export function readPhoneTagFilterConfig(storage = null) {
    const store = _pickStorage(storage);
    if (!store) {
        return { ...PHONE_TAG_FILTER_DEFAULTS };
    }

    const enabledRaw = store.get(PHONE_TAG_FILTER_KEYS.enabled);
    const blacklistRaw = store.get(PHONE_TAG_FILTER_KEYS.blacklist, '');
    const whitelistRaw = store.get(PHONE_TAG_FILTER_KEYS.whitelist, '');

    return {
        enabled: _toBoolean(enabledRaw, PHONE_TAG_FILTER_DEFAULTS.enabled),
        blacklist: String(blacklistRaw || ''),
        whitelist: String(whitelistRaw || '')
    };
}

export async function savePhoneTagFilterConfig(storage = null, patch = {}) {
    const store = _pickStorage(storage);
    if (!store?.set) return null;

    const current = readPhoneTagFilterConfig(store);
    const merged = {
        enabled: Object.prototype.hasOwnProperty.call(patch, 'enabled') ? !!patch.enabled : current.enabled,
        blacklist: Object.prototype.hasOwnProperty.call(patch, 'blacklist') ? String(patch.blacklist || '') : current.blacklist,
        whitelist: Object.prototype.hasOwnProperty.call(patch, 'whitelist') ? String(patch.whitelist || '') : current.whitelist
    };

    await store.set(PHONE_TAG_FILTER_KEYS.enabled, merged.enabled);
    await store.set(PHONE_TAG_FILTER_KEYS.blacklist, merged.blacklist);
    await store.set(PHONE_TAG_FILTER_KEYS.whitelist, merged.whitelist);

    return merged;
}

function escapeRegExp(string) {
    return String(string || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseTagInput(input) {
    return String(input || '')
        .split(/[\n,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean);
}

export function cleanMemoryTagsLocal(text) {
    if (!text) return text;

    let out = String(text);

    // 1) 标准成对 think 标签
    out = out.replace(/<think>[\s\S]*?<\/think>/gi, '');

    // 2) 锚点清洗：保留关键闭合标签，剔除后续残留思考段
    out = out.replace(/(<\/(?:Content|Memory|GaigaiMemory|Timeformat|summary)>)([\s\S]*?)<\/think>/gi, '$1');

    // 3) 开头残缺 think 兜底
    const brokenMatch = out.match(/^[\s\S]*?<\/think>/i);
    if (brokenMatch) {
        const contentToDelete = brokenMatch[0];
        if (!/<(?:Content|Memory|GaigaiMemory|Timeformat)/i.test(contentToDelete)) {
            out = out.replace(contentToDelete, '');
        } else {
            out = out.replace(/<\/think>/gi, '');
        }
    }

    // 4) 移除 Memory 标签
    return out.replace(MEMORY_TAG_REGEX, '').trim();
}

export function filterContentByTagsLocal(content, blacklistInput = '', whitelistInput = '') {
    if (!content) return content;

    let result = String(content);
    const blacklist = parseTagInput(blacklistInput);
    const whitelist = parseTagInput(whitelistInput);

    // 1) 黑名单：先删
    blacklist.forEach((tag) => {
        let re;
        if (tag.startsWith('!--')) {
            re = new RegExp('<' + tag + '[\\s\\S]*?-->', 'gi');
        } else if (tag.startsWith('[') && tag.endsWith(']')) {
            const inner = escapeRegExp(tag.slice(1, -1));
            re = new RegExp('\\[' + inner + '(?:\\s+[^\\]]*)?\\][\\s\\S]*?\\[\\/' + inner + '\\s*\\]', 'gi');
        } else {
            const safe = escapeRegExp(tag);
            re = new RegExp('<' + safe + '(?:\\s+[^>]*)?>[\\s\\S]*?<\\/' + safe + '\\s*>', 'gi');
        }

        let prev;
        let loop = 0;
        do {
            prev = result;
            result = result.replace(re, '');
            loop++;
        } while (prev !== result && loop < 50);
    });

    // 2) 白名单：再提取（仅当至少命中 1 个时生效，防止误删）
    if (whitelist.length > 0) {
        const extracted = [];
        let foundAny = false;

        whitelist.forEach((tag) => {
            let re;
            if (tag.startsWith('!--')) {
                re = new RegExp('<' + tag + '[\\s\\S]*?-->', 'gi');
            } else if (tag.startsWith('[') && tag.endsWith(']')) {
                const inner = escapeRegExp(tag.slice(1, -1));
                re = new RegExp('\\[' + inner + '(?:\\s+[^\\]]*)?\\]([\\s\\S]*?)(?:\\[\\/' + inner + '\\]|$)', 'gi');
            } else {
                const safe = escapeRegExp(tag);
                re = new RegExp('<' + safe + '(?:\\s+[^>]*)?>([\\s\\S]*?)(?:<\\/' + safe + '>|$)', 'gi');
            }

            let match;
            while ((match = re.exec(result)) !== null) {
                if (match[1] && match[1].trim()) {
                    extracted.push(match[1].trim());
                    foundAny = true;
                } else if (match[0]) {
                    extracted.push(match[0].trim());
                    foundAny = true;
                }
            }
        });

        if (foundAny) {
            result = extracted.join('\n\n');
        }
    }

    return result.trim();
}

function applyGaigaiTagFilter(text) {
    let out = String(text || '');
    if (!out) return out;

    const gaigai = (typeof window !== 'undefined') ? window.Gaigai : null;

    if (typeof gaigai?.cleanMemoryTags === 'function') {
        out = gaigai.cleanMemoryTags(out);
    }
    if (typeof gaigai?.tools?.filterContentByTags === 'function') {
        out = gaigai.tools.filterContentByTags(out);
    }

    return String(out || '').trim();
}

export function applyPhoneTagFilter(text, options = {}) {
    if (text === null || text === undefined) return text;
    let out = String(text);
    if (!out) return out;

    // 记忆插件可用时，沿用记忆插件原生过滤逻辑（保持兼容）
    if (hasGaigaiTagFilter()) {
        return applyGaigaiTagFilter(out);
    }

    const config = options.config || readPhoneTagFilterConfig(options.storage);
    if (!config.enabled) return out;

    out = cleanMemoryTagsLocal(out);
    out = filterContentByTagsLocal(out, config.blacklist, config.whitelist);
    return String(out || '').trim();
}

export function parsePhoneTagFilterDiagnosticJson(raw) {
    const fallback = { reasoning: '', blacklist: [], whitelist: [] };
    if (!raw) return fallback;

    let candidate = String(raw || '').trim();
    if (!candidate) return fallback;

    const codeBlockMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch?.[1]) candidate = codeBlockMatch[1].trim();

    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        candidate = candidate.slice(firstBrace, lastBrace + 1);
    }

    let parsed;
    try {
        parsed = JSON.parse(candidate);
    } catch (e) {
        return fallback;
    }

    const normalizeTags = (value) => {
        if (!Array.isArray(value)) return [];
        const seen = new Set();
        const out = [];
        value.forEach((item) => {
            const tag = String(item || '').trim();
            if (!tag || seen.has(tag)) return;
            seen.add(tag);
            out.push(tag);
        });
        return out;
    };

    return {
        reasoning: String(parsed?.reasoning || '').trim(),
        blacklist: normalizeTags(parsed?.blacklist),
        whitelist: normalizeTags(parsed?.whitelist)
    };
}
