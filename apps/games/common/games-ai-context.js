/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  游戏 AI 通用酒馆上下文注入
 * ======================================================== */
import { readPhoneContextLimit } from '../../../config/context-settings.js';

function getSillyTavernContext() {
    try {
        if (typeof window.SillyTavern?.getContext === 'function') return window.SillyTavern.getContext();
        if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') return SillyTavern.getContext();
    } catch (error) {
        console.warn('[GamesAiContext] 获取 SillyTavern 上下文失败:', error);
    }
    return null;
}

function cleanStContextText(text) {
    return String(text || '')
        .replace(/<[^>]*>/g, '')
        .replace(/\*[^*]*\*/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1200);
}

function buildCharacterMessage(context) {
    const charName = context?.name2 || '角色';
    const char = context?.characterId !== undefined && context?.characters
        ? context.characters[context.characterId]
        : null;
    if (!char) return null;

    const parts = [
        '【角色信息】',
        `角色名: ${char.name || charName}`
    ];
    if (char.description) parts.push(`描述: ${char.description}`);
    if (char.personality) parts.push(`性格: ${char.personality}`);
    if (char.scenario) parts.push(`场景/背景: ${char.scenario}`);
    if (char.first_mes) parts.push(`开场白: ${char.first_mes}`);
    if (char.mes_example) parts.push(`示例对话: ${char.mes_example}`);
    if (char.data?.system_prompt) parts.push(String(char.data.system_prompt));

    return {
        role: 'system',
        content: parts.join('\n').trim(),
        name: 'SYSTEM (角色卡)',
        isPhoneMessage: true
    };
}

function buildPersonaMessage() {
    const personaText = String(document.getElementById('persona_description')?.value || '').trim();
    if (!personaText) return null;
    return {
        role: 'system',
        content: `【用户信息】\n${personaText}`,
        name: 'SYSTEM (用户Persona)',
        isPhoneMessage: true
    };
}

function buildRecentChatMessages(context, storage, limitKey = 'phone-context-limit') {
    const messages = [];
    const contextLimit = limitKey === 'phone-context-limit'
        ? readPhoneContextLimit(storage)
        : Math.max(0, Math.min(9999, Number.parseInt(storage?.get?.(limitKey), 10) || 0));
    if (contextLimit <= 0 || !Array.isArray(context?.chat) || context.chat.length <= 0) return messages;

    const userName = context?.name1 || '用户';
    const charName = context?.name2 || '角色';
    for (let idx = context.chat.length - 1; idx >= 0 && messages.length < contextLimit; idx--) {
        const msg = context.chat[idx];
        if (!msg || msg.isGaigaiPrompt || msg.isGaigaiData || msg.isPhoneMessage) continue;
        const content = cleanStContextText(msg.mes || msg.content || '');
        if (!content) continue;
        const isUser = msg.is_user || msg.role === 'user';
        const speaker = isUser ? userName : charName;
        messages.unshift({
            role: isUser ? 'user' : 'assistant',
            content: `${speaker}: ${content}`,
            isPhoneMessage: true
        });
    }
    return messages;
}

export async function buildGameSillyTavernContextMessages(appKey, storage, options = {}) {
    const messages = [];
    const context = getSillyTavernContext();
    if (!context) return messages;

    const characterMessage = buildCharacterMessage(context);
    if (characterMessage) messages.push(characterMessage);

    if (options.includeWorldbook !== false) {
        const worldbookMessage = await window.VirtualPhone?.worldbookManager?.buildWorldbookMessage?.(appKey, options.worldbookOptions || {});
        if (worldbookMessage) messages.push(worldbookMessage);
    }

    const personaMessage = buildPersonaMessage();
    if (personaMessage) messages.push(personaMessage);

    if (options.includeRecentChat !== false) {
        messages.push(...buildRecentChatMessages(context, storage, options.limitKey || 'phone-context-limit'));
    }
    return messages;
}
