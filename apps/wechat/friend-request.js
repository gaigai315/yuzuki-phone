const FRIEND_REQUEST_BLOCK_REGEX = /<好友申请>\s*([\s\S]*?)(?:<\/好友申请>|<好友申请>)/gi;

function normalizeField(value = '') {
    return String(value || '').replace(/\r/g, '').trim();
}

function normalizeIdentity(value = '') {
    return normalizeField(value).replace(/\s+/g, '').toLowerCase();
}

function readField(block = '', label = '') {
    const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(block || '').match(new RegExp(`^\\s*${escaped}\\s*[：:]\\s*(.*)$`, 'mi'));
    return normalizeField(match?.[1] || '');
}

export function parseWechatFriendRequests(text = '') {
    const requests = [];
    FRIEND_REQUEST_BLOCK_REGEX.lastIndex = 0;
    let match;
    while ((match = FRIEND_REQUEST_BLOCK_REGEX.exec(String(text || ''))) !== null) {
        const nickname = readField(match[1], '好友昵称');
        const realName = readField(match[1], '真实姓名');
        const gender = readField(match[1], '性别');
        const reason = readField(match[1], '申请理由');
        if (!nickname || !realName || !['男', '女'].includes(gender)) continue;
        requests.push({ nickname, realName, gender, reason });
    }
    return requests;
}

export function findWechatContactByExactRealName(wechatData, realName = '') {
    const target = normalizeIdentity(realName);
    if (!target) return null;
    const contacts = wechatData?.getContacts?.() || wechatData?.data?.contacts || [];
    return contacts.find(contact => String(contact?.realName || '')
        .split(/[、,，/|｜；;]+/)
        .map(normalizeIdentity)
        .filter(Boolean)
        .includes(target)) || null;
}

export function acceptWechatFriendRequest(wechatData, request = {}) {
    if (!wechatData) throw new Error('微信数据未初始化');
    const nickname = normalizeField(request.nickname);
    const realName = normalizeField(request.realName);
    const genderText = normalizeField(request.gender);
    const reason = normalizeField(request.reason);
    if (!nickname || !realName || !['男', '女'].includes(genderText)) {
        throw new Error('好友申请资料不完整');
    }

    const existing = findWechatContactByExactRealName(wechatData, realName);
    if (existing) {
        const hiddenIds = new Set(wechatData.getOfflinePromptHiddenContactIds?.()
            || wechatData.getUserInfo?.()?.offlinePromptHiddenContactIds
            || []);
        const contactId = String(existing.id || '').trim();
        if (contactId && hiddenIds.has(contactId)) {
            hiddenIds.delete(contactId);
            wechatData.setOfflinePromptHiddenContactIds?.([...hiddenIds]);
            return { status: 'restored', contact: existing, chat: null };
        }
        return { status: 'exists', contact: existing, chat: null };
    }

    const contactId = `contact_friend_request_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const gender = genderText === '男' ? 'male' : 'female';
    const contact = wechatData.addContact({
        id: contactId,
        name: nickname,
        nickname,
        remark: '',
        realName,
        gender,
        relation: '',
        friendRequestReason: reason,
        avatar: '👤',
        letter: wechatData.getFirstLetter?.(nickname) || '#',
        sourceApp: 'wechat',
        sourceLabel: '正文好友申请'
    });
    if (!contact) throw new Error('添加微信好友失败');
    wechatData.setContactGender?.(contact.id || contactId, gender);
    wechatData.globalSocialStore?.upsertContact?.({
        app: 'wechat',
        appContactId: String(contact.id || contactId),
        name: nickname,
        avatar: String(contact.avatar || ''),
        relation: '',
        extra: { realName, gender, friendRequestReason: reason, sourceLabel: '正文好友申请' }
    });

    const chat = wechatData.createChat({
        id: `chat_${contact.id || contactId}`,
        contactId: contact.id || contactId,
        name: nickname,
        type: 'single',
        avatar: contact.avatar || '👤'
    });
    const systemText = `您已通过${nickname}的好友申请，你们已经是好友了，可以聊天了。`;
    wechatData.addMessage(chat.id, {
        id: `msg_friend_request_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        from: 'system',
        type: 'system',
        content: systemText,
        friendRequestAccepted: true
    });
    return { status: 'created', contact, chat, systemText };
}

