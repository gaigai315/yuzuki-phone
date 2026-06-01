/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  猫盒像素宠物数据
 * ======================================================== */

import { WechatData } from '../../wechat/wechat-data.js';

const STORAGE_KEY = 'games_catbox_state';

const CAT_IDS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12'];
const BACKGROUND_IDS = ['wxxw1', 'wxxw2', 'wxxw3', 'wxxw4'];
const BACKGROUND_UNLOCK_LEVELS = {
    wxxw1: 1,
    wxxw2: 3,
    wxxw3: 5,
    wxxw4: 8
};
const DECAY_INTERVAL_MS = 60 * 1000;
const SLEEP_DURATION_MS = 5 * 60 * 1000;
const EXP_PER_LEVEL = 50;
const MAX_LEVEL = 10;
const DEFAULT_ITEMS = {
    driedFish: 1,
    cannedFood: 0,
    teaser: 0,
    blanket: 0
};
const GENDER_LABELS = {
    female: '妹妹',
    male: '弟弟'
};

const ITEM_DEFS = {
    driedFish: {
        name: '小鱼干',
        icon: '🐟',
        desc: '饱腹 +15',
        price: 5,
        mood: 0,
        hunger: 15,
        energy: 0,
        exp: 4,
        message: '叼走了小鱼干'
    },
    cannedFood: {
        name: '猫罐头',
        icon: '🥫',
        desc: '饱腹 +30 心情 +3',
        price: 18,
        mood: 3,
        hunger: 30,
        energy: 0,
        exp: 8,
        message: '把罐头吃得很干净'
    },
    teaser: {
        name: '逗猫棒',
        icon: '✨',
        desc: '心情 +8 精力 -3',
        price: 28,
        mood: 8,
        hunger: 0,
        energy: -3,
        exp: 8,
        message: '扑向逗猫棒玩了一圈'
    },
    blanket: {
        name: '小毯子',
        icon: '▣',
        desc: '本次睡觉恢复提升',
        price: 38,
        mood: 0,
        hunger: 0,
        energy: 0,
        exp: 5,
        message: '钻进小毯子准备睡觉'
    }
};

const ITEM_NAME_ALIASES = {
    '小鱼干': 'driedFish',
    '鱼干': 'driedFish',
    '猫罐头': 'cannedFood',
    '罐头': 'cannedFood',
    '逗猫棒': 'teaser',
    '小毯子': 'blanket',
    '毯子': 'blanket'
};

const ACTIONS = {
    inventory: {
        mood: 0,
        hunger: 0,
        energy: 0,
        exp: 0,
        message: '仓库正在整理中'
    },
    feed: {
        mood: 0,
        hunger: 18,
        energy: 0,
        exp: 8,
        message: '吃饱后在盒子里打了个滚'
    },
    pet: {
        mood: 2,
        hunger: 0,
        energy: 0,
        exp: 6,
        message: '眯起眼睛蹭了蹭你的手'
    },
    sleep: {
        mood: 5,
        hunger: -5,
        energy: 22,
        exp: 5,
        message: '缩成一团睡了一小会儿'
    }
};

export class CatboxData {
    constructor(storage) {
        this.storage = storage;
        this.state = this._loadState();
    }

    getState() {
        this._applyRealtime();
        return this.state;
    }

    getCats() {
        return CAT_IDS.slice();
    }

    getBackgrounds() {
        return BACKGROUND_IDS.slice();
    }

    getUnlockedBackgrounds() {
        const level = Number(this.state?.level || 1);
        return BACKGROUND_IDS.filter(id => level >= Number(BACKGROUND_UNLOCK_LEVELS[id] || 1));
    }

    randomCat() {
        const nextCatId = this._pick(CAT_IDS, this.state.draftCatId);
        const nextBackgroundId = this.state.backgroundId || this._pick(BACKGROUND_IDS);
        this.state = {
            ...this.state,
            draftCatId: nextCatId,
            backgroundId: nextBackgroundId
        };
        this._persist();
        return nextCatId;
    }

    adoptCat(name, gender) {
        const catId = CAT_IDS.includes(this.state.draftCatId) ? this.state.draftCatId : this._pick(CAT_IDS);
        const catName = this._normalizeName(name);
        const catGender = this._normalizeGender(gender);
        this.state = {
            ...this._createInitialState(),
            adopted: true,
            catId,
            catName,
            catGender,
            draftCatId: catId,
            backgroundId: this.state.backgroundId || this._pick(BACKGROUND_IDS),
            adoptedAt: Date.now(),
            lastActionText: `${catName}搬进了猫盒`,
            lastActionAt: Date.now()
        };
        this._persist();
        return this.state;
    }

    performCare(action) {
        this._applyRealtime();
        let config = ACTIONS[action];
        if (!config || !this.state.adopted) return this.state;
        if (this._isSleeping() && ['feed', 'pet', 'inventory'].includes(action)) {
            this.state = {
                ...this.state,
                lastActionText: '正在睡觉中',
                lastActionAt: Date.now()
            };
            this._persist();
            return this.state;
        }
        if (action === 'sleep') {
            this.state = {
                ...this.state,
                sleepingUntil: Date.now() + SLEEP_DURATION_MS,
                sleepRecovery: Number(this.state.pendingSleepBoost || 0) > 0 ? 40 : 25,
                pendingSleepBoost: 0,
                exp: Math.max(0, Number(this.state.exp || 0) + Number(config.exp || 0)),
                lastActionText: '睡觉中',
                lastActionAt: Date.now()
            };
            this._applyLevelUpRewards();
            this._persist();
            return this.state;
        }
        if (action === 'pet' && Number(this.state.energy || 0) < 20) {
            config = { ...config, mood: 1, message: '有点困，只轻轻蹭了一下' };
        }
        this.state = {
            ...this.state,
            mood: this._clamp(Number(this.state.mood || 0) + config.mood),
            hunger: this._clamp(Number(this.state.hunger || 0) + config.hunger),
            energy: this._clamp(Number(this.state.energy || 0) + config.energy),
            exp: Math.max(0, Number(this.state.exp || 0) + Number(config.exp || 0)),
            lastActionText: config.message,
            lastActionAt: Date.now()
        };
        this._applyLevelUpRewards();
        this._persist();
        return this.state;
    }

    getInventoryItems() {
        const inventory = this.state.inventory || {};
        return Object.entries(ITEM_DEFS).map(([id, item]) => ({
            id,
            ...item,
            count: Math.max(0, Number(inventory[id] || 0))
        }));
    }

    useItem(itemId) {
        this._applyRealtime();
        const id = String(itemId || '').trim();
        const item = ITEM_DEFS[id];
        const count = Number(this.state.inventory?.[id] || 0);
        if (!item || !this.state.adopted) return this.state;
        if (this._isSleeping()) {
            this.state = { ...this.state, lastActionText: '正在睡觉中', lastActionAt: Date.now() };
            this._persist();
            return this.state;
        }
        if (count <= 0) {
            this.state = { ...this.state, lastActionText: `${item.name}已经用完了`, lastActionAt: Date.now() };
            this._persist();
            return this.state;
        }
        const inventory = { ...(this.state.inventory || {}) };
        inventory[id] = Math.max(0, count - 1);
        this.state = {
            ...this.state,
            inventory,
            mood: this._clamp(Number(this.state.mood || 0) + item.mood),
            hunger: this._clamp(Number(this.state.hunger || 0) + item.hunger),
            energy: this._clamp(Number(this.state.energy || 0) + item.energy),
            exp: Math.max(0, Number(this.state.exp || 0) + Number(item.exp || 0)),
            pendingSleepBoost: id === 'blanket' ? 1 : Number(this.state.pendingSleepBoost || 0),
            lastActionText: item.message,
            lastActionAt: Date.now()
        };
        this._applyLevelUpRewards();
        this._persist();
        return this.state;
    }

    buyItem(itemId) {
        this._applyRealtime();
        const id = String(itemId || '').trim();
        const item = ITEM_DEFS[id];
        if (!item || !this.state.adopted) return this.state;
        const price = Math.max(0, Number(item.price || 0));
        const wallet = this._getWechatWallet();
        if (!wallet.available) {
            this.state = { ...this.state, lastActionText: '微信钱包暂时不可用', lastActionAt: Date.now() };
            this._persist();
            return this.state;
        }
        if (!wallet.initialized) {
            this.state = { ...this.state, lastActionText: '请先初始化微信零钱', lastActionAt: Date.now() };
            this._persist();
            return this.state;
        }
        if (wallet.balance + 1e-9 < price) {
            this.state = { ...this.state, lastActionText: `零钱不够，买不了${item.name}`, lastActionAt: Date.now() };
            this._persist();
            return this.state;
        }
        wallet.wechatData.updateWalletBalance(-price);
        const inventory = { ...(this.state.inventory || {}) };
        inventory[id] = Math.max(0, Number(inventory[id] || 0) + 1);
        this.state = {
            ...this.state,
            inventory,
            lastActionText: `花 ¥${price.toFixed(2)} 买了${item.name}`,
            lastActionAt: Date.now()
        };
        this._persist();
        return this.state;
    }

    createCoAdoptInvite(target = {}) {
        this._applyRealtime();
        if (!this.state.adopted) return null;
        const chatId = String(target.chatId || target.id || '').trim();
        const name = String(target.name || target.chatName || '').trim();
        if (!chatId || !name) return null;
        this.state = {
            ...this.state,
            coAdoptInvite: {
                chatId,
                name,
                status: 'pending',
                at: Date.now()
            },
            lastActionText: `已邀请${name}一起照顾${this.state.catName}`,
            lastActionAt: Date.now()
        };
        this._persist();
        return this.state.coAdoptInvite;
    }

    updateCoAdoptInviteMessage(chatId, messageId) {
        const safeChatId = String(chatId || '').trim();
        const safeMessageId = String(messageId || '').trim();
        if (!safeChatId || !safeMessageId || !this.state.coAdoptInvite) return null;
        if (this.state.coAdoptInvite.chatId !== safeChatId) return null;
        this.state = {
            ...this.state,
            coAdoptInvite: {
                ...this.state.coAdoptInvite,
                messageId: safeMessageId
            }
        };
        this._persist();
        return this.state.coAdoptInvite;
    }

    acceptCoAdopt(chatId, name = '') {
        this._applyRealtime();
        if (!this.state.adopted) return null;
        const safeChatId = String(chatId || '').trim();
        const safeName = String(name || this.state.coAdoptInvite?.name || '好友').trim();
        if (!safeChatId) return null;
        this.state = {
            ...this.state,
            coAdopter: {
                chatId: safeChatId,
                name: safeName,
                acceptedAt: Date.now()
            },
            coAdoptInvite: {
                chatId: safeChatId,
                name: safeName,
                status: 'accepted',
                at: this.state.coAdoptInvite?.at || Date.now(),
                resolvedAt: Date.now()
            },
            lastActionText: `${safeName}同意共养${this.state.catName}`,
            lastActionAt: Date.now()
        };
        this._persist();
        return this.state.coAdopter;
    }

    rejectCoAdopt(chatId, name = '') {
        this._applyRealtime();
        if (!this.state.adopted) return null;
        const safeChatId = String(chatId || '').trim();
        const safeName = String(name || this.state.coAdoptInvite?.name || '好友').trim();
        this.state = {
            ...this.state,
            coAdoptInvite: {
                chatId: safeChatId,
                name: safeName,
                status: 'rejected',
                at: this.state.coAdoptInvite?.at || Date.now(),
                resolvedAt: Date.now()
            },
            lastActionText: `${safeName}暂时没有一起收养`,
            lastActionAt: Date.now()
        };
        this._persist();
        return this.state.coAdoptInvite;
    }

    releaseCoAdopt() {
        this._applyRealtime();
        if (!this.state.adopted || !this.state.coAdopter) return null;
        const name = String(this.state.coAdopter.name || '好友').trim();
        this.state = {
            ...this.state,
            coAdopter: null,
            coAdoptInvite: null,
            lastActionText: `已解除与${name}的共养`,
            lastActionAt: Date.now()
        };
        this._persist();
        return this.state;
    }

    getCoAdoptContextForChat(chatId, chatName = '') {
        this._applyRealtime();
        const safeChatId = String(chatId || '').trim();
        if (!safeChatId || !this.state.adopted) return '';
        const invite = this.state.coAdoptInvite;
        const coAdopter = this.state.coAdopter;
        if (coAdopter?.chatId === safeChatId) {
            return [
                '【猫盒共同收养】',
                '你和{{user}}共同养了一只电子宠物。',
                '若要使用零食，必须严格输出：[使用：小鱼干x1]（想留给对方看的短留言）。',
                `可用零食与金额：${this.getItemPriceSummaryText()}。`,
                '可用零食名必须严格使用上面的中文名称，数量必须是正整数。'
            ].join('\n');
        }
        if (invite?.chatId === safeChatId && invite.status === 'pending') {
            const name = String(chatName || invite.name || '你').trim();
            return [
                '【猫盒共同收养邀请】',
                `{{user}}邀请${name}一起照顾电子宠物：${this.getPetSummaryText()}`,
                '如果你愿意共同收养，必须单独回复：[同意收养]',
                '如果你不愿意共同收养，必须单独回复：[拒绝收养]',
                '不要改写括号内容，不要在同一条消息里附加解释。'
            ].join('\n');
        }
        return '';
    }

    getPetSummaryText() {
        this._applyRealtime();
        const exp = this.getExpProgress();
        return `${this.state.catName}，Lv.${Number(this.state.level || 1)}，经验 ${Number(exp.current || 0)}/${Number(exp.required || 50)}，心情 ${Number(this.state.mood || 0)}，饱腹 ${Number(this.state.hunger || 0)}，精力 ${Number(this.state.energy || 0)}`;
    }

    getInventorySummaryText() {
        return this.getInventoryItems()
            .map(item => `${item.name}x${Number(item.count || 0)}`)
            .join('、');
    }

    getItemPriceSummaryText() {
        return Object.values(ITEM_DEFS)
            .map(item => `${item.name} ¥${Number(item.price || 0).toFixed(0)}`)
            .join('、');
    }

    getUnreadLettersCount() {
        const letters = Array.isArray(this.state.letters) ? this.state.letters : [];
        return letters.filter(letter => !letter.read).length;
    }

    markLettersRead() {
        const letters = Array.isArray(this.state.letters) ? this.state.letters : [];
        if (!letters.some(letter => !letter.read)) return this.state;
        this.state = {
            ...this.state,
            letters: letters.map(letter => ({ ...letter, read: true }))
        };
        this._persist();
        return this.state;
    }

    setCatPosition(position = {}) {
        if (!this.state.adopted) return this.state;
        const x = this._clampPercent(position.x, 50);
        const y = this._clampPercent(position.y, 45);
        this.state = {
            ...this.state,
            catPosition: { x, y }
        };
        this._persist();
        return this.state;
    }

    applyFriendItemUse({ chatId = '', senderName = '', itemName = '', quantity = 1, note = '' } = {}) {
        this._applyRealtime();
        if (!this.state.adopted) {
            return { success: false, reason: 'no_pet', content: '猫盒里还没有小猫' };
        }
        const safeChatId = String(chatId || '').trim();
        const coAdopter = this.state.coAdopter;
        if (!coAdopter || coAdopter.chatId !== safeChatId) {
            return { success: false, reason: 'not_coadopter', content: '还没有共同收养这只小猫' };
        }
        const itemId = this._resolveItemIdByName(itemName);
        const item = ITEM_DEFS[itemId];
        if (!item) {
            return { success: false, reason: 'unknown_item', content: `猫盒不认识${itemName || '这个零食'}` };
        }
        const count = Math.max(1, Math.min(99, Number.parseInt(quantity, 10) || 1));
        const safeSenderName = String(senderName || coAdopter.name || '好友').trim();
        const safeNote = String(note || '').trim().slice(0, 80);
        this.state = {
            ...this.state,
            mood: this._clamp(Number(this.state.mood || 0) + Number(item.mood || 0) * count),
            hunger: this._clamp(Number(this.state.hunger || 0) + Number(item.hunger || 0) * count),
            energy: this._clamp(Number(this.state.energy || 0) + Number(item.energy || 0) * count),
            exp: Math.max(0, Number(this.state.exp || 0) + Number(item.exp || 0) * count),
            pendingSleepBoost: itemId === 'blanket'
                ? Math.max(1, Number(this.state.pendingSleepBoost || 0))
                : Number(this.state.pendingSleepBoost || 0),
            lastActionText: `${safeSenderName}给${this.state.catName}用了${item.name}x${count}`,
            lastActionAt: Date.now()
        };
        if (safeNote) {
            const letters = Array.isArray(this.state.letters) ? this.state.letters.slice() : [];
            letters.unshift({
                id: `catbox_letter_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                from: safeSenderName,
                itemId,
                itemName: item.name,
                quantity: count,
                note: safeNote,
                at: Date.now(),
                read: false
            });
            this.state.letters = letters.slice(0, 30);
        }
        this._applyLevelUpRewards();
        this._persist();
        return {
            success: true,
            petName: this.state.catName,
            senderName: safeSenderName,
            itemId,
            itemName: item.name,
            quantity: count,
            note: safeNote,
            summary: this.getPetSummaryText(),
            content: `${safeSenderName}帮你喂养了${this.state.catName}：${item.name}x${count}`
        };
    }

    nextBackground() {
        const available = this.getUnlockedBackgrounds();
        const current = available.includes(this.state.backgroundId) ? this.state.backgroundId : BACKGROUND_IDS[0];
        const index = available.indexOf(current);
        const next = available[(index + 1 + available.length) % available.length] || BACKGROUND_IDS[0];
        const lockedCount = BACKGROUND_IDS.length - available.length;
        this.state = {
            ...this.state,
            backgroundId: next,
            lastActionText: lockedCount > 0 && available.length === 1
                ? '更多背景会随等级解锁'
                : `背景切换到 ${available.indexOf(next) + 1} 号`,
            lastActionAt: Date.now()
        };
        this._persist();
        return next;
    }

    resetAdoption() {
        this.state = this._createInitialState();
        this._persist();
        return this.state;
    }

    _loadState() {
        const saved = this.storage?.get?.(STORAGE_KEY);
        const state = saved && typeof saved === 'object' ? saved : {};
        return this._normalizeState(state);
    }

    _normalizeState(state) {
        const catId = CAT_IDS.includes(state.catId) ? state.catId : '';
        const draftCatId = CAT_IDS.includes(state.draftCatId) ? state.draftCatId : catId;
        const maxStat = Math.max(100, Number(state.maxStat || 100));
        const rawExp = Math.max(0, Number(state.exp || 0));
        const savedLevel = Math.max(1, Math.min(MAX_LEVEL, Number(state.level || 0) || 0));
        const level = savedLevel || this._levelFromExp(rawExp);
        const exp = savedLevel
            ? this._normalizeExpForSavedLevel(rawExp, level)
            : rawExp;
        const savedBackgroundId = BACKGROUND_IDS.includes(state.backgroundId) ? state.backgroundId : BACKGROUND_IDS[0];
        const backgroundId = level >= Number(BACKGROUND_UNLOCK_LEVELS[savedBackgroundId] || 1)
            ? savedBackgroundId
            : BACKGROUND_IDS[0];
        return {
            adopted: !!state.adopted && !!catId,
            catId,
            catName: this._normalizeName(state.catName),
            catGender: this._normalizeGender(state.catGender),
            draftCatId,
            backgroundId,
            mood: this._clamp(Number(state.mood ?? 50), maxStat),
            hunger: this._clamp(Number(state.hunger ?? 50), maxStat),
            energy: this._clamp(Number(state.energy ?? 50), maxStat),
            level,
            exp,
            inventory: this._normalizeInventory(state.inventory),
            maxStat,
            pendingSleepBoost: Number(state.pendingSleepBoost || 0),
            sleepRecovery: Number(state.sleepRecovery || 25),
            sleepingUntil: Math.max(0, Number(state.sleepingUntil || 0)),
            lastDecayAt: Number(state.lastDecayAt || state.adoptedAt || Date.now()),
            adoptedAt: Number(state.adoptedAt || 0),
            lastActionText: String(state.lastActionText || ''),
            lastActionAt: Number(state.lastActionAt || 0),
            catPosition: this._normalizeCatPosition(state.catPosition),
            coAdopter: this._normalizeCoAdopter(state.coAdopter),
            coAdoptInvite: this._normalizeCoAdoptInvite(state.coAdoptInvite),
            letters: this._normalizeLetters(state.letters)
        };
    }

    _createInitialState() {
        return {
            adopted: false,
            catId: '',
            catName: '小猫',
            catGender: 'female',
            draftCatId: '',
            backgroundId: BACKGROUND_IDS[0],
            mood: 50,
            hunger: 50,
            energy: 50,
            level: 1,
            exp: 0,
            inventory: { ...DEFAULT_ITEMS },
            maxStat: 100,
            pendingSleepBoost: 0,
            sleepRecovery: 25,
            sleepingUntil: 0,
            lastDecayAt: Date.now(),
            adoptedAt: 0,
            lastActionText: '',
            lastActionAt: 0,
            catPosition: null,
            coAdopter: null,
            coAdoptInvite: null,
            letters: []
        };
    }

    _normalizeName(name) {
        const value = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 8);
        return value || '小猫';
    }

    _normalizeGender(gender) {
        const value = String(gender || '').trim();
        return GENDER_LABELS[value] ? value : 'female';
    }

    _pick(list, avoidId = '') {
        const pool = list.filter(item => item !== avoidId);
        const source = pool.length ? pool : list;
        return source[Math.floor(Math.random() * source.length)];
    }

    _clamp(value, maxValue = null) {
        if (!Number.isFinite(value)) return 0;
        const max = Math.max(100, Number(maxValue || this.state?.maxStat || 100));
        return Math.max(0, Math.min(max, Math.round(value)));
    }

    _clampPercent(value, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.max(8, Math.min(92, Math.round(number * 10) / 10));
    }

    _levelFromExp(exp) {
        const value = Math.max(0, Number(exp || 0));
        return Math.min(MAX_LEVEL, Math.max(1, Math.floor(value / EXP_PER_LEVEL) + 1));
    }

    _normalizeExpForSavedLevel(exp, level) {
        const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Number(level || 1) || 1));
        const rawExp = Math.max(0, Number(exp || 0));
        if (safeLevel >= MAX_LEVEL) return Math.max((MAX_LEVEL - 1) * EXP_PER_LEVEL, rawExp);
        const minExp = (safeLevel - 1) * EXP_PER_LEVEL;
        const maxExp = safeLevel * EXP_PER_LEVEL - 1;
        if (rawExp >= minExp && rawExp <= maxExp) return rawExp;
        return minExp + (rawExp % EXP_PER_LEVEL);
    }

    getExpProgress() {
        const exp = Math.max(0, Number(this.state?.exp || 0));
        const level = this._levelFromExp(exp);
        if (level >= MAX_LEVEL) {
            return {
                current: EXP_PER_LEVEL,
                required: EXP_PER_LEVEL,
                percent: 100
            };
        }
        const current = exp % EXP_PER_LEVEL;
        return {
            current,
            required: EXP_PER_LEVEL,
            percent: Math.round((current / EXP_PER_LEVEL) * 100)
        };
    }

    _applyRealtime(now = Date.now()) {
        if (!this.state?.adopted) return;
        const sleepUntil = Number(this.state.sleepingUntil || 0);
        const sleepCompleted = sleepUntil > 0 && sleepUntil <= now;
        const lastDecayAt = Number(this.state.lastDecayAt || now);
        const elapsedMinutes = Math.floor(Math.max(0, now - lastDecayAt) / DECAY_INTERVAL_MS);
        if (elapsedMinutes > 0) {
            const hungerPenalty = Number(this.state.hunger || 0) <= 20 ? elapsedMinutes : 0;
            const emptyHungerPenalty = Number(this.state.hunger || 0) <= 0 ? elapsedMinutes : 0;
            this.state = {
                ...this.state,
                mood: this._clamp(Number(this.state.mood || 0) - elapsedMinutes - hungerPenalty - emptyHungerPenalty),
                hunger: this._clamp(Number(this.state.hunger || 0) - elapsedMinutes),
                energy: this._clamp(Number(this.state.energy || 0) - elapsedMinutes),
                lastDecayAt: lastDecayAt + elapsedMinutes * DECAY_INTERVAL_MS
            };
            if (elapsedMinutes >= 5) {
                this.state.lastActionText = this._offlineMessage(elapsedMinutes);
                this.state.lastActionAt = now;
            }
        }
        if (sleepCompleted) {
            this.state = {
                ...this.state,
                energy: this._clamp(Number(this.state.energy || 0) + Number(this.state.sleepRecovery || 25)),
                sleepingUntil: 0,
                sleepRecovery: 25,
                lastActionText: '睡醒后伸了个懒腰',
                lastActionAt: now
            };
        }
        if (elapsedMinutes > 0 || sleepCompleted) this._persist();
    }

    _isSleeping(now = Date.now()) {
        return Number(this.state?.sleepingUntil || 0) > now;
    }

    _normalizeInventory(inventory) {
        const source = inventory && typeof inventory === 'object' ? inventory : DEFAULT_ITEMS;
        return Object.keys(ITEM_DEFS).reduce((result, key) => {
            result[key] = Math.max(0, Number(source[key] ?? DEFAULT_ITEMS[key] ?? 0));
            return result;
        }, {});
    }

    _normalizeCatPosition(value) {
        if (!value || typeof value !== 'object') return null;
        return {
            x: this._clampPercent(value.x, 50),
            y: this._clampPercent(value.y, 45)
        };
    }

    _resolveItemIdByName(itemName) {
        const raw = String(itemName || '').trim();
        if (!raw) return '';
        if (ITEM_DEFS[raw]) return raw;
        if (ITEM_NAME_ALIASES[raw]) return ITEM_NAME_ALIASES[raw];
        const normalized = raw.replace(/\s+/g, '');
        if (ITEM_NAME_ALIASES[normalized]) return ITEM_NAME_ALIASES[normalized];
        return Object.entries(ITEM_DEFS).find(([, item]) => String(item.name || '').trim() === raw)?.[0] || '';
    }

    _normalizeCoAdopter(value) {
        if (!value || typeof value !== 'object') return null;
        const chatId = String(value.chatId || '').trim();
        const name = String(value.name || '').trim();
        if (!chatId || !name) return null;
        return {
            chatId,
            name,
            acceptedAt: Number(value.acceptedAt || Date.now())
        };
    }

    _normalizeCoAdoptInvite(value) {
        if (!value || typeof value !== 'object') return null;
        const chatId = String(value.chatId || '').trim();
        const name = String(value.name || '').trim();
        const status = ['pending', 'accepted', 'rejected'].includes(value.status) ? value.status : 'pending';
        if (!chatId || !name) return null;
        return {
            chatId,
            name,
            status,
            at: Number(value.at || Date.now()),
            resolvedAt: Number(value.resolvedAt || 0),
            messageId: String(value.messageId || '').trim()
        };
    }

    _normalizeLetters(value) {
        const list = Array.isArray(value) ? value : [];
        return list
            .map((letter, index) => ({
                id: String(letter?.id || `catbox_letter_${index}`).trim(),
                from: String(letter?.from || '好友').trim(),
                itemId: String(letter?.itemId || '').trim(),
                itemName: String(letter?.itemName || '').trim(),
                quantity: Math.max(1, Number.parseInt(letter?.quantity, 10) || 1),
                note: String(letter?.note || '').trim().slice(0, 80),
                at: Number(letter?.at || Date.now()),
                read: !!letter?.read
            }))
            .filter(letter => letter.note)
            .slice(0, 30);
    }

    _applyLevelUpRewards() {
        const previousLevel = Math.max(1, Number(this.state.level || 1));
        const nextLevel = this._levelFromExp(this.state.exp);
        this.state.level = nextLevel;
        if (nextLevel <= previousLevel) return;
        const gained = nextLevel - previousLevel;
        const inventory = { ...(this.state.inventory || {}) };
        inventory.driedFish = Math.max(0, Number(inventory.driedFish || 0) + gained);
        this.state.inventory = inventory;
        this.state.maxStat = Math.max(100, Number(this.state.maxStat || 100) + gained * 5);
        this.state.lastActionText = `升级到 Lv.${nextLevel}，获得小鱼干`;
    }

    _offlineMessage(minutes) {
        if (Number(this.state.hunger || 0) <= 20) return `你离开了${minutes}分钟，有点饿了`;
        if (Number(this.state.energy || 0) <= 20) return `你离开了${minutes}分钟，想睡觉了`;
        if (Number(this.state.mood || 0) <= 20) return `你离开了${minutes}分钟，有点闷闷的`;
        return `你离开了${minutes}分钟，正在等你`;
    }

    _getWechatWallet() {
        let wechatData = window.VirtualPhone?.wechatApp?.wechatData || window.VirtualPhone?.cachedWechatData;
        if (!wechatData) {
            try {
                wechatData = new WechatData(this.storage);
                if (window.VirtualPhone) window.VirtualPhone.cachedWechatData = wechatData;
            } catch (error) {
                console.warn('[Catbox] 微信钱包读取失败:', error);
                return { available: false, initialized: false, balance: 0, wechatData: null };
            }
        }
        if (typeof wechatData.getWalletBalance !== 'function' || typeof wechatData.updateWalletBalance !== 'function') {
            return { available: false, initialized: false, balance: 0, wechatData: null };
        }
        const raw = wechatData.getWalletBalance();
        if (raw === null || raw === undefined) {
            return { available: true, initialized: false, balance: 0, wechatData };
        }
        const balance = Number.parseFloat(raw);
        if (!Number.isFinite(balance) || balance < 0) {
            return { available: true, initialized: false, balance: 0, wechatData };
        }
        return { available: true, initialized: true, balance, wechatData };
    }

    _persist() {
        this.storage?.set?.(STORAGE_KEY, this.state);
    }
}
