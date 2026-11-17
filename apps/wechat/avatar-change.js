// Avatar commands deliberately carry no roleplay policy; optional worldbook entries define it.
export const avatarCommandPattern = /\[(?:更换头像[：:]\s*[^\]\r\n]+|好友同意更换头像(?:[：:]\s*[^\]\r\n]+)?)\]/g;

export function parseAvatarCommand(value) {
    const text = String(value || '').trim();
    const library = /^\[更换头像[：:]\s*([^\]\r\n]+)\]$/.exec(text);
    if (library) return { type: 'avatar_change', avatarSource: 'library', avatarKey: library[1].trim() };
    const sent = /^\[好友同意更换头像(?:[：:]\s*([^\]\r\n]+))?\]$/.exec(text);
    if (sent) return { type: 'avatar_change', avatarSource: 'message', avatarKey: String(sent[1] || '').trim() };
    return null;
}

export function getEmojiGroup(emoji) {
    return emoji?.group === 'avatar' ? 'avatar' : 'default';
}

export function resolveAvatarSource(command, request = {}) {
    const key = String(command?.avatarKey || '').trim();
    if (!key) return null;
    if (command?.avatarSource === 'library') {
        const matches = (request.candidates || []).filter(item => item.id === key);
        return matches.length === 1 ? matches[0] : null;
    }
    if (command?.avatarSource === 'message') {
        const matches = (request.images || []).filter(item => item.id === key);
        return matches.length === 1 ? matches[0] : null;
    }
    return null;
}
