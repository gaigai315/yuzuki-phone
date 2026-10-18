export function sortChatsLikeWechat(chats = []) {
    return [...(Array.isArray(chats) ? chats : [])].sort((a, b) => {
        const pinA = Math.max(0, Number(a?.pinnedAt || 0) || 0);
        const pinB = Math.max(0, Number(b?.pinnedAt || 0) || 0);
        if (pinA > 0 || pinB > 0) {
            if (pinA > 0 && pinB > 0) return pinA - pinB;
            return pinA > 0 ? -1 : 1;
        }
        return (Number(b?.timestamp || 0) || 0) - (Number(a?.timestamp || 0) || 0);
    });
}

export function buildInlineReplyWechatList(contacts = [], chats = [], resolveAvatar = () => null) {
    const safeContacts = Array.isArray(contacts) ? contacts.filter(Boolean) : [];
    const contactById = new Map();
    const contactByName = new Map();
    safeContacts.forEach(contact => {
        const id = String(contact?.id || '').trim();
        const name = String(contact?.name || '').trim();
        if (id && !contactById.has(id)) contactById.set(id, contact);
        if (name && !contactByName.has(name)) contactByName.set(name, contact);
    });

    const result = [];
    const includedContactIds = new Set();
    const includedContactNames = new Set();
    const includedGroups = new Set();
    const appendContact = contact => {
        const name = String(contact?.name || '').trim();
        if (!name) return;
        const id = String(contact?.id || '').trim();
        if ((id && includedContactIds.has(id)) || includedContactNames.has(name)) return;
        if (id) includedContactIds.add(id);
        includedContactNames.add(name);
        result.push({
            name,
            avatar: resolveAvatar(id, contact?.avatar),
            fallbackIcon: '👤',
            chatType: 'single'
        });
    };

    sortChatsLikeWechat(chats).forEach(chat => {
        const name = String(chat?.name || '').trim();
        if (!name) return;
        if (String(chat?.type || '').trim() === 'group') {
            const groupKey = String(chat?.id || name).trim();
            if (includedGroups.has(groupKey)) return;
            includedGroups.add(groupKey);
            result.push({
                name,
                avatar: resolveAvatar(chat?.id, chat?.avatar),
                fallbackIcon: '👥',
                chatType: 'group'
            });
            return;
        }

        const contactId = String(chat?.contactId || '').trim();
        const chatId = String(chat?.id || '').trim();
        appendContact(contactById.get(contactId) || contactById.get(chatId) || contactByName.get(name));
    });

    safeContacts.forEach(appendContact);
    return result;
}
