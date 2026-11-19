const normalize = value => String(value || '').trim().replace(/\s+/g, '').toLowerCase();
const field = (block, name) => String(block).match(new RegExp(`^[ \\t]*${name}[ \\t]*[：:][ \\t]*(.*)$`, 'm'))?.[1]?.trim() || '';

// Group member lists contain other people; the phone owner is counted separately.
export function excludeWechatGroupSelfMembers(members, user = {}) {
    const selfNames = new Set(['me', '我', '用户', '玩家', 'user', '{{user}}', user.name, user.realName]
        .map(normalize).filter(Boolean));
    return (Array.isArray(members) ? members : []).filter(member => !selfNames.has(normalize(member)));
}

export const ONLINE_GROUP_INVITATION_PATTERN = /\[群聊邀请\]\s*[（(][^\r\n）)]+[）)]/g;

export function parseWechatOnlineGroupInvitation(text = '') {
    const match = String(text).trim().match(/^\[群聊邀请\]\s*[（(]([^\r\n]+)[）)]$/);
    if (!match) return null;
    const parts = match[1].split(/[｜|]/);
    if (parts.length !== 2) return null;
    const name = parts[0].trim();
    const members = [...new Set(parts[1].split(/[、，,；;]+/).map(member => member.trim()).filter(Boolean))];
    if (!name || !members.length) return null;
    return {
        type: 'group_invitation', groupInvitationName: name, groupInvitationMembers: members,
        groupInvitationStatus: 'pending', content: `[群聊邀请]（${name}｜${members.join('、')}）`
    };
}

export function parseWechatGroupInvitations(text = '') {
    const invitations = [];
    for (const match of String(text).matchAll(/<群聊邀请>\s*([\s\S]*?)<\/群聊邀请>/g)) {
        const groupName = field(match[1], '群聊名称');
        const inviter = field(match[1], '邀请人');
        const members = [...new Set(field(match[1], '群成员').split(/[、，,；;]+/).map(name => name.trim()).filter(Boolean))];
        const reason = field(match[1], '邀请理由');
        if (groupName && inviter && members.length) invitations.push({ groupName, inviter, members, reason });
    }
    return invitations;
}

export function findWechatInvitationFriend(data, name) {
    const key = normalize(name);
    if (!key) return null;
    const contacts = data.getContacts?.() || data.data?.contacts || [];
    const matches = contacts.filter(contact => [contact.id, contact.name, contact.nickname, contact.remark,
        ...String(contact.realName || '').split(/[、，,/|｜；;]+/)]
        .some(alias => normalize(alias) === key));
    return matches.length === 1 ? matches[0] : null;
}

export function findWechatInvitedGroup(data, name) {
    const key = normalize(name);
    return (data.getChatList?.() || data.data?.chats || []).find(chat => chat.type === 'group' && normalize(chat.name) === key) || null;
}

export function isWechatGroupInvitationCurrent(item, context, conversationId) {
    const source = item?.source || {};
    if (String(source.conversationId || '') !== String(conversationId || '')) return false;
    const floor = Number(source.tavernMessageIndex);
    if (!Number.isInteger(floor) || floor < 0) return false;
    const message = context?.chat?.[floor];
    if (!message || message.is_user || Number(message.swipe_id || 0) !== Number(source.swipeId || 0)) return false;
    if (source.batchId && message._phone_stable_batch_id && source.batchId !== message._phone_stable_batch_id) return false;
    return parseWechatGroupInvitations(message.mes || message.content || '').some(invitation =>
        JSON.stringify(invitation) === JSON.stringify(item.request)
    );
}

export function acceptWechatGroupInvitation(data, invitation, source = {}) {
    if (!data) throw new Error('微信数据未初始化');
    const groupName = String(invitation?.groupName || '').trim();
    const rawInviter = String(invitation?.inviter || '').trim();
    const memberNames = Array.isArray(invitation?.members) ? invitation.members : [];
    if (!groupName || !rawInviter || !memberNames.some(name => normalize(name))) throw new Error('群聊邀请资料不完整');
    const existing = findWechatInvitedGroup(data, groupName);
    if (existing) return { status: 'exists', chat: existing };
    const inviter = findWechatInvitationFriend(data, rawInviter);
    if (!inviter) throw new Error('邀请人不是现有微信好友，无法接受入群邀请');
    const user = data.getUserInfo?.() || {};
    const userName = String(user.name || '用户').trim();
    const selfNames = new Set(['me', '我', '用户', 'user', '{{user}}', userName, user.realName].map(normalize).filter(Boolean));
    if ([inviter.name, inviter.realName, rawInviter].some(name => selfNames.has(normalize(name)))) throw new Error('不能接受自己发起的入群邀请');
    const members = [];
    const seen = new Set();
    for (const raw of excludeWechatGroupSelfMembers([...memberNames, inviter.name], user)) {
        if (!normalize(raw)) continue;
        const contact = findWechatInvitationFriend(data, raw);
        const member = contact?.name || String(raw).trim();
        if (selfNames.has(normalize(member))) continue;
        const key = normalize(member);
        if (seen.has(key)) continue;
        seen.add(key);
        members.push(member);
    }
    // Only create a group conversation. Names without contacts remain group-only members.
    const chat = data.createChat({
        id: `group_invitation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: groupName, type: 'group', avatar: '👥', members
    });
    if (!chat) throw new Error('创建群聊失败');
    const floor = Number(source.tavernMessageIndex);
    const timeline = source.tavernMessageIndex != null && Number.isInteger(floor) && floor >= 0
        ? { fromMainChatTag: true, timelineLinked: true, tavernMessageIndex: floor, batchId: String(source.batchId || '') }
        : {};
    chat.groupInvitation = { ...timeline, inviterContactId: inviter.id, inviterName: inviter.name, reason: String(invitation.reason || '').trim() };
    if (source.mode === 'online') {
        Object.assign(chat.groupInvitation, {
            mode: 'online', invitationChatId: source.invitationChatId, invitationMessageId: source.invitationMessageId,
            welcomeConversationId: source.conversationId, onlineWelcomeState: 'pending'
        });
    }
    const added = data.addMessage(chat.id, {
        ...timeline, from: 'system', type: 'system', groupInvitationAccepted: true,
        content: source.mode === 'online' ? `${userName} 已加入群聊` : `${inviter.name} 邀请你加入了群聊“${groupName}”`
    });
    if (added === false) {
        data.deleteChat(chat.id);
        throw new Error('邀请已过期，未加入群聊');
    }
    data.saveData();
    return { status: 'joined', chat };
}
