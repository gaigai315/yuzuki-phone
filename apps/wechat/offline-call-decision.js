import { TimeManager } from '../../config/time-manager.js';

const normalize = value => String(value || '').trim().replace(/\s+/g, '').toLowerCase();

export function parseOfflineWechatCallDecision(content) {
    const match = String(content || '').trim().match(/^[\[【]?\s*(群)?(语音|视频)通话\s*[-－—:：]\s*(接听|已接听|接受|已接受|已拒绝|拒绝|结束|已结束|挂断|已挂断)\s*[\]】]?$/);
    return match ? { callType: match[2] === '视频' ? 'video' : 'voice', isGroupCall: !!match[1],
        status: /拒绝/.test(match[3]) ? 'rejected' : /结束|挂断/.test(match[3]) ? 'ended' : 'answered' } : null;
}

const storyClock = Object.create(TimeManager.prototype);

function storyCallTime(entry) {
    const time = String(entry.message.time || '').trim().replace('：', ':');
    const match = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
    const date = String(entry.message.date || entry.block.date || '').trim();
    const parsed = storyClock._parseStoryDate(date, { allowUnknownEra: true });
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    return { time, date, minutes, era: parsed?.era || '', timestamp: parsed
        ? storyClock._createStoryTimestamp(parsed.year, parsed.month, parsed.day, Number(match[1]), Number(match[2])) : null };
}

function completedCallTiming(accepted, ended) {
    const start = storyCallTime(accepted);
    const finish = storyCallTime(ended);
    let seconds = null;
    if (start && finish && start.era === finish.era) {
        if (start.timestamp !== null && finish.timestamp !== null) {
            seconds = (finish.timestamp - start.timestamp) / 1000;
            if (seconds < 0 && start.date === finish.date) seconds += 86400;
        } else if ((!start.date || !finish.date || start.date === finish.date)) {
            seconds = ((finish.minutes - start.minutes + 1440) % 1440) * 60;
        }
        if (!Number.isFinite(seconds) || seconds < 0) seconds = null;
    }
    return {
        time: finish?.time || ended.message.time,
        callEndDate: finish?.date || ended.block.date || '',
        callStartTime: start?.time || '', callStartDate: start?.date || '',
        elapsedSeconds: seconds,
        duration: seconds === null ? '未记录' : seconds === 0 ? '不足1分钟'
            : `${Math.floor(seconds / 60)}分${Math.floor(seconds % 60)}秒`
    };
}

// Pair a dial command with the other party's explicit decision in the same tag/window.
export function resolveOfflineWechatCallDecisions(results, { enabled = false, isUserSender = name => name === 'me' } = {}) {
    if (!enabled) return results;
    const copies = results.map(block => ({ ...block, messages: (block.messages || []).map(message => ({ ...message })) }));
    const windows = new Map();
    const removed = new Set();
    for (const block of copies) {
        if (block.type !== 'wechat_message') continue;
        const key = `${block.sourceIndex ?? ''}:${block.chatType || 'single'}:${normalize(block.contact)}`;
        if (!windows.has(key)) windows.set(key, []);
        block.messages.forEach(message => windows.get(key).push({ block, message }));
    }
    for (const entries of windows.values()) {
        let pending = null;
        for (let index = 0; index < entries.length; index++) {
            const { block, message } = entries[index];
            if (message.type === 'incoming_call') {
                pending = { index, message, callerIsUser: isUserSender(message.sender),
                    isGroupCall: message.isGroupCall === true || block.chatType === 'group' };
                continue;
            }
            const decision = parseOfflineWechatCallDecision(message.content);
            if (!decision || decision.status === 'ended' || !pending || pending.message.callType !== decision.callType
                || (decision.isGroupCall && !pending.isGroupCall)
                || isUserSender(message.sender) === pending.callerIsUser) continue;
            let end = index + 1;
            while (end < entries.length && entries[end].message.type !== 'incoming_call'
                && !parseOfflineWechatCallDecision(entries[end].message.content)) end++;
            let ending = null;
            if (decision.status === 'answered' && end < entries.length) {
                const marker = parseOfflineWechatCallDecision(entries[end].message.content);
                if (marker?.status === 'ended' && marker.callType === decision.callType
                    && (!marker.isGroupCall || pending.isGroupCall)) ending = entries[end];
            }
            const spoken = entries.slice(pending.index + 1, end).filter(entry => entry.message !== message);
            const transcript = spoken.map(entry => ({
                from: isUserSender(entry.message.sender) ? 'me' : pending.isGroupCall ? entry.message.sender : entry.block.contact,
                text: String(entry.message.content || '').trim()
            })).filter(entry => entry.text);
            Object.assign(pending.message, {
                type: 'call_record', sender: 'me', callType: decision.callType, status: decision.status,
                duration: '0分0秒', content: `${decision.callType === 'video' ? '视频' : '语音'}通话-${decision.status === 'answered' ? '已接听' : '已拒绝'}`,
                offlineCallDecision: true, isGroupCall: pending.isGroupCall, callDirection: pending.callerIsUser ? 'outgoing' : 'incoming',
                offlineCallUserLines: decision.status === 'answered' ? transcript.filter(entry => entry.from === 'me').map(entry => entry.text) : [],
                offlineCallAiLines: decision.status === 'answered' ? transcript.filter(entry => entry.from !== 'me').map(entry => entry.text) : [],
                transcript: decision.status === 'answered' ? transcript : undefined
            });
            if (decision.status === 'answered' && !ending) {
                // Carry only time supported by the accepted marker and already spoken lines.
                let handoff = entries[index];
                for (let next = index + 1; next < end; next++) {
                    if (storyCallTime(entries[next])) handoff = entries[next];
                }
                const timing = completedCallTiming(entries[index], handoff);
                Object.assign(pending.message, {
                    callStartTime: timing.callStartTime, callStartDate: timing.callStartDate,
                    callHandoffTime: timing.time, callHandoffDate: timing.callEndDate,
                    initialElapsedSeconds: timing.elapsedSeconds ?? 0,
                    duration: timing.elapsedSeconds > 0 ? timing.duration : '0分0秒'
                });
            }
            if (ending) {
                const endedBy = isUserSender(ending.message.sender) ? 'user' : 'character';
                const timing = completedCallTiming(entries[index], ending);
                Object.assign(pending.message, timing, {
                    sourceOrder: ending.message.sourceOrder,
                    offlineCallCompleted: true, offlineCallFinalized: true,
                    endedBy, endedByName: endedBy === 'user' ? 'me' : ending.message.sender
                });
                transcript.push({ from: endedBy === 'user' ? 'me' : ending.message.sender,
                    text: '已挂断', type: 'call_hangup', endedBy });
                removed.add(ending.message);
            }
            removed.add(message);
            if (decision.status === 'answered') {
                spoken.forEach(entry => removed.add(entry.message));
                index = ending ? end : end - 1;
            } else {
                // Only explicit refusal's immediate user reply bypasses ordinary user-speech cleanup.
                for (let next = index + 1; next < entries.length; next++) {
                    const entry = entries[next];
                    if (entry.block !== block || !isUserSender(entry.message.sender)
                        || entry.message.type === 'incoming_call' || parseOfflineWechatCallDecision(entry.message.content)) break;
                    entry.message.offlineCallUserReply = true;
                }
            }
            pending = null;
        }
    }
    copies.forEach(block => { block.messages = block.messages.filter(message => !removed.has(message)); });
    return copies;
}
