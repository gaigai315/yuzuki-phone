// 读取 live binding，切换 Persona 后不缓存上一个用户的头像。
let tavernPersonas = null;
if (typeof window !== 'undefined' && typeof SillyTavern !== 'undefined') {
    try {
        tavernPersonas = await import('/scripts/personas.js');
    } catch {
        try {
            tavernPersonas = await import('/script.js');
        } catch {
            // 旧前端没有导出该模块时继续通过 DOM 读取。
        }
    }
}

export function normalizeWechatUserAvatar(value) {
    if (typeof value !== 'string') return '';
    let avatar = value.trim();
    if (!avatar || /^(?:none|null|undefined|default)$/i.test(avatar)) return '';
    if (/^(?:\.?\/)?(?:User(?: |%20)Avatars|backgrounds)\//i.test(avatar)) {
        avatar = `/${avatar.replace(/^\.?\//, '')}`;
    }
    if (!/^(?:https?:\/\/|\/|blob:|data:image\/|asset:\/\/|tauri:\/\/)/i.test(avatar)) return '';
    if (/(?:^|\/)img\/(?:user-default|blank|transparent|placeholder)\.(?:png|gif|webp|svg)(?:[?#]|$)/i.test(avatar)) return '';
    return avatar.replace(/ /g, '%20');
}

export function isTavernPersonaAvatar(value) {
    return /(?:^|\/)User(?: |%20)Avatars\//i.test(String(value || ''))
        || /[?&]type=persona(?:&|$)/i.test(String(value || ''));
}

export function getTavernUserAvatarCandidates({ personas = tavernPersonas, document = globalThis.document,
    context = globalThis.SillyTavern?.getContext?.() } = {}) {
    const candidates = [];
    const append = value => {
        const avatar = normalizeWechatUserAvatar(value);
        if (avatar && !candidates.includes(avatar)) candidates.push(avatar);
    };
    const avatarId = typeof personas?.user_avatar === 'string' ? personas.user_avatar.trim() : '';
    if (avatarId && !/^(?:none|null|undefined)$/i.test(avatarId)) {
        const original = typeof personas.getUserAvatar === 'function'
            ? personas.getUserAvatar(avatarId)
            : `/User%20Avatars/${encodeURIComponent(avatarId)}`;
        append(original);
        if (typeof context?.getThumbnailUrl === 'function') {
            append(context.getThumbnailUrl('persona', avatarId));
        }
        // 已有真实 Persona 文件时，不回退到可能仍显示上一个 Persona 的页面节点。
        return candidates;
    }

    for (const selector of [
        '#user_avatar_block .avatar-container.selected img',
        '#rm_button_panel_persona img',
    ]) {
        const image = document?.querySelector?.(selector);
        if (!image || (image.complete === true && image.naturalWidth === 0)) continue;
        // 空 src 的 DOM 属性可能被浏览器展开成当前页面地址，不能当成头像。
        const source = typeof image.getAttribute === 'function' ? image.getAttribute('src') : image.src;
        if (source) append(image.currentSrc || source);
    }
    return candidates;
}
