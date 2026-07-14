/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

const TASK_VISUALS = [
    { accent: 'green', icon: 'fa-list-check' },
    { accent: 'cyan', icon: 'fa-shield-halved' },
    { accent: 'purple', icon: 'fa-crosshairs' },
    { accent: 'orange', icon: 'fa-crown' }
];

function hashTaskText(value) {
    const source = String(value || '').replace(/\s+/g, ' ').trim();
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function parseTaskObjectives(text) {
    const section = String(text || '').match(/任务目标\s*[:：]\s*([\s\S]*?)(?=\n\s*(?:奖励|声望值|额外奖励|任务讨论)\s*[:：]|$)/)?.[1] || '';
    const rows = section.split('\n').map(line => line.replace(/^\s*[-•]\s*/, '').trim()).filter(Boolean);
    const objectives = rows.map((row, index) => {
        const parts = row.split(/[｜|]/).map(part => part.trim()).filter(Boolean);
        const progress = String(parts[1] || '').match(/(\d+)\s*\/\s*(\d+)/);
        const total = Math.max(1, Number(progress?.[2] || 1));
        const current = Math.max(0, Math.min(total, Number(progress?.[1] || 0)));
        return {
            id: `objective-${index + 1}`,
            title: parts[0] || `任务目标 ${index + 1}`,
            current,
            total,
            completed: current >= total
        };
    });
    return objectives.length ? objectives.slice(0, 6) : [{
        id: 'objective-1',
        title: '完成任务要求',
        current: 0,
        total: 1,
        completed: false
    }];
}

function parseTaskComments(text) {
    const section = String(text || '').match(/任务讨论\s*[:：]\s*([\s\S]*?)$/)?.[1] || '';
    return section.split('\n')
        .map(line => line.replace(/^\s*[-•]\s*/, '').trim())
        .filter(Boolean)
        .map((row, index) => {
            const parts = row.split(/[｜|]/).map(part => part.trim());
            const isLegacyLevelFormat = parts.length >= 4;
            return {
                id: `comment-${index + 1}`,
                name: parts[0] || '匿名执行者',
                time: (isLegacyLevelFormat ? parts[2] : parts[1]) || '刚刚',
                content: (isLegacyLevelFormat ? parts.slice(3) : parts.slice(2)).join('｜') || row
            };
        })
        .slice(0, 5);
}

export function parseWangxiangTaskBlock(block, index = 0, options = {}) {
    const text = String(block || '').trim();
    const titleMatch = text.match(/^\s*(?:\[(普通|中级|高级|特级|特技)\]\s*)?任务标题\s*[:：]\s*(.+)$/m);
    if (!titleMatch) return null;

    const visual = TASK_VISUALS[index % TASK_VISUALS.length];
    const readField = field => text.match(new RegExp(`^\\s*${field}\\s*[:：]\\s*(.*)$`, 'm'))?.[1]?.trim() || '';
    const contentMatch = text.match(/任务内容\s*[:：]\s*([\s\S]*?)(?=\n\s*(?:任务目标|奖励)\s*[:：]|$)/);
    const description = String(contentMatch?.[1] || '').replace(/\s+/g, ' ').trim();
    const reward = readField('奖励').replace(/[^\d.,+-]/g, '') || '0';
    const publisherOrg = readField('发布者组织');
    const idPrefix = String(options.idPrefix || 'wangxiang-task').replace(/[^a-zA-Z0-9_-]/g, '-') || 'wangxiang-task';

    return {
        id: `${idPrefix}-${hashTaskText(text)}`,
        title: titleMatch[2].trim(),
        description: description || '任务详情将在接取后进一步说明。',
        publisher: readField('发布者') || publisherOrg || '万象任务中心',
        publishedAt: readField('发布时间') || '--',
        startsAt: readField('任务开始时间') || readField('开始时间') || '未注明',
        estimatedDuration: readField('预估耗时') || readField('预计时长') || '未注明',
        reward,
        prestige: readField('声望值').replace(/[^\d.,+-]/g, '') || '0',
        extraReward: readField('额外奖励') || '无',
        icon: visual.icon,
        accent: visual.accent,
        publisherOrg: publisherOrg || '独立委托方',
        publisherReputation: readField('发布者信誉') || '未知',
        location: readField('任务地点') || '未注明',
        objectives: parseTaskObjectives(text),
        comments: parseTaskComments(text),
        status: 'available',
        source: String(options.source || '')
    };
}

function parseTaskWrapperContent(content, options = {}, startIndex = 0) {
    return String(content || '')
        .split(/\n\s*---+\s*\n/g)
        .map((block, index) => parseWangxiangTaskBlock(block, startIndex + index, options))
        .filter(Boolean);
}

export function parseWangxiangTaskTags(rawText, options = {}) {
    const source = String(rawText || '');
    const tasks = [];
    const tagRegex = /<\s*任务\s*>([\s\S]*?)<\s*\/\s*任务\s*>/gi;
    let match;
    while ((match = tagRegex.exec(source)) !== null) {
        tasks.push(...parseTaskWrapperContent(match[1], options, tasks.length));
        if (tasks.length >= Math.max(1, Number(options.maxTasks || 10))) break;
    }
    return tasks.slice(0, Math.max(1, Number(options.maxTasks || 10)));
}

export function tokenizeWangxiangTaskTags(rawText, options = {}) {
    const source = String(rawText || '');
    const tokenMap = new Map();
    let tokenIndex = 0;
    const tokenPrefix = String(options.tokenPrefix || 'ST_PHONE_WANGXIANG_TASK').replace(/[^a-zA-Z0-9_]/g, '_');
    const tagRegex = /(^|\n)[ \t]*(?:([^\n<>:：]{1,40})[：:][ \t]*)?<\s*任务\s*>([\s\S]*?)<\s*\/\s*任务\s*>/gi;
    const text = source.replace(tagRegex, (_full, boundary, inlineSender, content) => {
        const tasks = parseTaskWrapperContent(content, {
            ...options,
            idPrefix: options.idPrefix || 'wechat-invitation',
            source: options.source || 'wechat_invitation'
        }, tokenIndex);
        if (!tasks.length) return _full;
        const tokens = tasks.map(task => {
            const token = `__${tokenPrefix}_${tokenIndex++}__`;
            tokenMap.set(token, {
                type: 'wangxiang_task_invitation',
                content: `[万象任务邀请] ${task.title}`,
                wangxiangTaskData: task,
                taskInvitationStatus: 'pending',
                sender: String(inlineSender || '').trim()
            });
            return token;
        });
        return `${boundary || ''}${tokens.join('\n')}`;
    });
    return { text, tokenMap };
}
