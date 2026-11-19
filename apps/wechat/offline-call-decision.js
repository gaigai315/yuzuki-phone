const normalize = value => String(value || '').trim().replace(/\s+/g, '').toLowerCase();

export function parseOfflineWechatCallDecision(content) {
    const match = String(content || '').trim().match(/^[\[【]?\s*(语音|视频)通话\s*[-－—:：]\s*(接听|已接听|接受|已接受|已拒绝|拒绝)\s*[\]】]?$/);
    return match ? { callType: match[1] === '视频' ? 'video' : 'voice', status: /拒绝/.test(match[2]) ? 'rejected' : 'answered' } : null;
}

// Pair a dial command with the other party's explicit decision in the same tag/window.
export function resolveOfflineWechatCallDecisions(results, { enabled = false, isUserSender = name => name === 'me' } = {}) {
    if (!enabled) return results;
    const copies = results.map(block => ({ ...block, messages: (block.messages || []).map(message => ({ ...message })) }));
    const windows = new Map();
    const removed = new Set();
    for (const block of copies) {
        if (block.type !== 'wechat_message' || block.chatType === 'group') continue;
        const key = `${block.sourceIndex ?? ''}:${normalize(block.contact)}`;
        if (!windows.has(key)) windows.set(key, []);
        block.messages.forEach(message => windows.get(key).push({ block, message }));
    }
    for (const entries of windows.values()) {
        let pending = null;
        for (let index = 0; index < entries.length; index++) {
            const { block, message } = entries[index];
            if (message.type === 'incoming_call') {
                pending = { index, message, callerIsUser: isUserSender(message.sender) };
                continue;
            }
            const decision = parseOfflineWechatCallDecision(message.content);
            if (!decision || !pending || pending.message.callType !== decision.callType
                || isUserSender(message.sender) === pending.callerIsUser) continue;
            let end = index + 1;
            while (end < entries.length && entries[end].message.type !== 'incoming_call'
                && !parseOfflineWechatCallDecision(entries[end].message.content)) end++;
            const spoken = entries.slice(pending.index + 1, end).filter(entry => entry.message !== message);
            const transcript = spoken.map(entry => ({
                from: isUserSender(entry.message.sender) ? 'me' : entry.block.contact,
                text: String(entry.message.content || '').trim()
            })).filter(entry => entry.text);
            Object.assign(pending.message, {
                type: 'call_record', sender: 'me', callType: decision.callType, status: decision.status,
                duration: '0分0秒', content: `${decision.callType === 'video' ? '视频' : '语音'}通话-${decision.status === 'answered' ? '已接听' : '已拒绝'}`,
                offlineCallDecision: true, callDirection: pending.callerIsUser ? 'outgoing' : 'incoming',
                offlineCallUserLines: decision.status === 'answered' ? transcript.filter(entry => entry.from === 'me').map(entry => entry.text) : [],
                offlineCallAiLines: decision.status === 'answered' ? transcript.filter(entry => entry.from !== 'me').map(entry => entry.text) : [],
                transcript: decision.status === 'answered' ? transcript : undefined
            });
            removed.add(message);
            if (decision.status === 'answered') {
                spoken.forEach(entry => removed.add(entry.message));
                index = end - 1;
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
