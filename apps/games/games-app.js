/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  游戏大厅入口
 * ======================================================== */

import { PokerApp } from './poker/poker-app.js';
import { Game2048Data } from './game2048/game2048-data.js';
import { Game2048View } from './game2048/game2048-view.js';
import { SudokuData } from './sudoku/sudoku-data.js';
import { SudokuView } from './sudoku/sudoku-view.js';
import { CatboxData } from './catbox/catbox-data.js';
import { CatboxView } from './catbox/catbox-view.js';
import { WerewolfData } from './werewolf/werewolf-data.js';
import { WerewolfView } from './werewolf/werewolf-view.js';

const CATBOX_CSS_URL = new URL('./catbox/catbox.css?v=1.0.0', import.meta.url).href;
const WEREWOLF_CSS_URL = new URL('./werewolf/werewolf.css?v=1.0.27', import.meta.url).href;
const CATBOX_PRELOAD_ASSETS = [
    new URL('./catbox/assets/wxxw1.png', import.meta.url).href,
    new URL('./catbox/assets/wxxw2.png', import.meta.url).href,
    new URL('./catbox/assets/wxxw3.jpeg', import.meta.url).href,
    new URL('./catbox/assets/wxxw4.png', import.meta.url).href,
    new URL('./catbox/assets/A1.png', import.meta.url).href,
    new URL('./catbox/assets/A2.png', import.meta.url).href,
    new URL('./catbox/assets/A3.png', import.meta.url).href,
    new URL('./catbox/assets/A4.png', import.meta.url).href,
    new URL('./catbox/assets/A5.png', import.meta.url).href,
    new URL('./catbox/assets/A6.png', import.meta.url).href,
    new URL('./catbox/assets/A7.png', import.meta.url).href,
    new URL('./catbox/assets/A8.png', import.meta.url).href,
    new URL('./catbox/assets/A9.png', import.meta.url).href,
    new URL('./catbox/assets/A10.png', import.meta.url).href,
    new URL('./catbox/assets/A11.png', import.meta.url).href,
    new URL('./catbox/assets/A12.png', import.meta.url).href,
    new URL('./catbox/assets/tzxf.png', import.meta.url).href
];

export class GamesApp extends PokerApp {
    constructor(phoneShell, storage) {
        super(phoneShell, storage);
        this.game2048Data = new Game2048Data(storage);
        this.game2048View = new Game2048View(this);
        this.sudokuData = new SudokuData(storage);
        this.sudokuView = new SudokuView(this);
        this.catboxData = new CatboxData(storage);
        this.catboxView = new CatboxView(this);
        this.werewolfData = new WerewolfData(storage);
        this.werewolfView = new WerewolfView(this);
        this._preloadCatboxAssets();
        this._preloadWerewolfAssets();
        window.addEventListener('phone:panelVisibility', event => {
            const open = !!event.detail?.open;
            if (this.currentView !== 'sudoku') return;
            if (open) {
                this.sudokuData.resumeTimer();
                this.sudokuView.render();
            } else {
                this.sudokuView.destroy();
            }
        });
    }

    open2048() {
        this.applyPhoneChromeTheme();
        this.currentView = 'game2048';
        this.game2048View.render();
    }

    move2048(direction) {
        const result = this.game2048Data.move(direction);
        if (result.moved) this.game2048View.render();
    }

    reset2048() {
        this.game2048Data.reset();
        this.game2048View.render();
    }

    openSudoku() {
        this.applyPhoneChromeTheme();
        this.currentView = 'sudoku';
        this.sudokuView.render();
    }

    newSudoku(difficulty) {
        this.sudokuData.newGame(difficulty);
        this.sudokuView.render();
    }

    selectSudokuCell(row, col) {
        this.sudokuData.select(row, col);
        this.sudokuView.render();
    }

    setSudokuNumber(value) {
        this.sudokuData.setNumber(value);
        this.sudokuView.render();
    }

    eraseSudoku() {
        this.sudokuData.erase();
        this.sudokuView.render();
    }

    undoSudoku() {
        this.sudokuData.undo();
        this.sudokuView.render();
    }

    toggleSudokuNoteMode() {
        this.sudokuData.toggleNoteMode();
        this.sudokuView.render();
    }

    autoNoteSudoku() {
        this.sudokuData.autoNotes();
        this.sudokuView.render();
    }

    hintSudoku() {
        this.sudokuData.hint();
        this.sudokuView.render();
    }

    openCatbox() {
        this.applyPhoneChromeTheme();
        this.currentView = 'catbox';
        this.catboxView.resetHudCollapsed?.();
        this.catboxView.render();
    }

    openWerewolf() {
        this.applyPhoneChromeTheme();
        this.currentView = 'werewolf';
        this.werewolfView.openEntryPrompt();
        this.werewolfView.render();
    }

    startNewWerewolfGame() {
        this.werewolfData.reset();
        this.werewolfView.closeEntryPrompt();
        this.werewolfView.render();
    }

    async startWerewolfMatch() {
        const emptySeats = this.werewolfData.getEmptySeats();
        if (!emptySeats.length) {
            this.phoneShell?.showNotification?.('狼人杀', '已经没有空位需要匹配', '🐺');
            return;
        }
        this.werewolfData.setMatching(true);
        this.werewolfView.render();
        try {
            const result = await this._callWerewolfMatchAi(emptySeats);
            const matched = this._parseWerewolfMatch(result?.summary || result?.content || result?.text || '');
            const required = new Set(emptySeats);
            const filtered = matched.filter(player => required.has(player.seat));
            if (filtered.length !== emptySeats.length) {
                throw new Error(`AI 返回人数不完整：需要 ${emptySeats.length} 个，收到 ${filtered.length} 个`);
            }
            this.werewolfData.applyMatchedPlayers(filtered);
            this.werewolfView.render();
        } catch (error) {
            console.warn('[Werewolf] 匹配失败:', error);
            const message = this._formatError?.(error, '匹配失败') || error?.message || '匹配失败';
            this.werewolfData.applyMatchError(message);
            this.werewolfView.render();
            this.phoneShell?.showNotification?.('狼人杀匹配失败', message, '❌');
        }
    }

    async _callWerewolfMatchAi(emptySeats = []) {
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager?.callAI) throw new Error('API Manager 未初始化');
        const seatsText = emptySeats.map(seat => `${seat}号`).join('、');
        const userSeat = this.werewolfData.getState().players?.find(player => player.isUser)?.seat || 8;
        const messages = [
            {
                role: 'system',
                name: 'SYSTEM (狼人杀匹配)',
                isPhoneMessage: true,
                content: [
                    '你是狼人杀游戏的匹配系统，只负责生成临时游戏好友资料。',
                    `当前是 8 人局狼人杀，${userSeat}号是用户本人，其余空位需要生成游戏好友。`,
                    '只生成姓名、性别、性格及语言风格，不要分配狼人杀身份，不要写游戏过程。',
                    '姓名应像真实中文昵称或姓名，避免重复，性格和语言风格要适合狼人杀发言。',
                    '必须只返回 <狼人杀匹配环节> 标签包裹的内容，不要 Markdown，不要解释。'
                ].join('\n')
            },
            {
                role: 'user',
                isPhoneMessage: true,
                content: [
                    `目前空置位置：${seatsText}。`,
                    '请为这些位置生成游戏好友。',
                    '严格使用以下格式：',
                    '<狼人杀匹配环节>',
                    '【3号】',
                    '姓名：',
                    '性别：',
                    '性格及语言风格：',
                    '---',
                    '【4号】',
                    '姓名：',
                    '性别：',
                    '性格及语言风格：',
                    '</狼人杀匹配环节>'
                ].join('\n')
            }
        ];
        return apiManager.callAI(messages, {
            appId: 'games',
            temperature: 0.9,
            max_tokens: 900
        });
    }

    _parseWerewolfMatch(text = '') {
        const source = String(text || '').trim();
        const block = source.match(/<狼人杀匹配环节>([\s\S]*?)<\/狼人杀匹配环节>/)?.[1] || source;
        const sections = [];
        const pattern = /【\s*(\d+)\s*号\s*】([\s\S]*?)(?=---\s*【\s*\d+\s*号\s*】|【\s*\d+\s*号\s*】|$)/g;
        let match = null;
        while ((match = pattern.exec(block))) {
            const seat = Number(match[1]);
            const body = String(match[2] || '');
            sections.push({
                seat,
                name: this._extractWerewolfField(body, '姓名'),
                gender: this._extractWerewolfField(body, '性别'),
                personality: this._extractWerewolfField(body, '性格及语言风格')
            });
        }
        return sections.filter(item => item.seat >= 1 && item.seat <= 7 && item.name && item.personality);
    }

    _extractWerewolfField(body, label) {
        const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = String(body || '').match(new RegExp(`${escaped}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:姓名|性别|性格及语言风格)\\s*[:：]|$)`));
        return String(match?.[1] || '').trim();
    }

    _preloadCatboxAssets() {
        if (document.getElementById('games-catbox-css')) return;
        const stylesheet = document.createElement('link');
        stylesheet.id = 'games-catbox-css';
        stylesheet.rel = 'stylesheet';
        stylesheet.href = CATBOX_CSS_URL;
        document.head.appendChild(stylesheet);

        CATBOX_PRELOAD_ASSETS.forEach((href, index) => {
            const link = document.createElement('link');
            link.rel = 'preload';
            link.href = href;
            link.as = 'image';
            link.dataset.catboxPreload = String(index + 1);
            document.head.appendChild(link);
        });
    }

    _preloadWerewolfAssets() {
        const existingCss = document.getElementById('games-werewolf-css');
        if (existingCss) {
            if (existingCss.href !== WEREWOLF_CSS_URL) existingCss.href = WEREWOLF_CSS_URL;
        } else {
            const stylesheet = document.createElement('link');
            stylesheet.id = 'games-werewolf-css';
            stylesheet.rel = 'stylesheet';
            stylesheet.href = WEREWOLF_CSS_URL;
            document.head.appendChild(stylesheet);
        }

        if (!document.getElementById('games-werewolf-bg-preload')) {
            const link = document.createElement('link');
            link.id = 'games-werewolf-bg-preload';
            link.rel = 'preload';
            link.href = new URL('./werewolf/assets/werewolf-background.png', import.meta.url).href;
            link.as = 'image';
            document.head.appendChild(link);
        }

        if (!document.getElementById('games-werewolf-day-bg-preload')) {
            const link = document.createElement('link');
            link.id = 'games-werewolf-day-bg-preload';
            link.rel = 'preload';
            link.href = new URL('./werewolf/assets/day.png', import.meta.url).href;
            link.as = 'image';
            document.head.appendChild(link);
        }
    }

    randomCatboxCat() {
        this.catboxData.randomCat();
        this.catboxView.render();
    }

    adoptCatboxCat(name, gender) {
        if (!this.catboxData.getState().draftCatId) {
            this.phoneShell?.showNotification?.('猫盒', '请先随机一只小猫', '🐾');
            return;
        }
        this.catboxData.adoptCat(name, gender);
        this.catboxView.render();
    }

    performCatboxAction(action) {
        this.catboxData.performCare(action);
        this.catboxView.render();
    }

    useCatboxItem(itemId) {
        this.catboxData.useItem(itemId);
        this.catboxView.render();
    }

    buyCatboxItem(itemId) {
        this.catboxData.buyItem(itemId);
        this.catboxView.render();
    }

    getCatboxCoAdoptTargets() {
        const wechatData = this.getWechatData?.();
        const chats = wechatData?.getChatList?.() || [];
        const contacts = wechatData?.getContacts?.() || [];
        const byName = new Map();
        chats
            .filter(chat => chat && chat.type !== 'group' && String(chat.name || '').trim())
            .forEach(chat => {
                byName.set(String(chat.name || '').trim(), {
                    chatId: String(chat.id || '').trim(),
                    name: String(chat.name || '').trim(),
                    avatar: chat.avatar || ''
                });
            });
        contacts
            .filter(contact => contact && String(contact.name || '').trim())
            .forEach(contact => {
                const name = String(contact.name || '').trim();
                if (byName.has(name)) return;
                const chat = wechatData.getChatByContactId?.(contact.id)
                    || chats.find(item => item?.type !== 'group' && String(item.name || '').trim() === name);
                byName.set(name, {
                    chatId: String(chat?.id || `contact:${contact.id || name}`).trim(),
                    contactId: contact.id || '',
                    name,
                    avatar: this.resolveContactAvatar?.(contact, wechatData) || contact.avatar || ''
                });
            });
        return Array.from(byName.values()).filter(item => item.chatId && item.name);
    }

    inviteCatboxCoAdopt(chatId) {
        const wechatData = this.getWechatData?.();
        if (!wechatData) return;
        const rawId = String(chatId || '').trim();
        let chat = wechatData.getChat?.(rawId);
        if (!chat && rawId.startsWith('contact:')) {
            const contactId = rawId.slice('contact:'.length);
            const contact = wechatData.getContact?.(contactId);
            if (contact) {
                chat = wechatData.createChat?.({
                    id: `chat_${contact.id || Date.now()}`,
                    contactId: contact.id,
                    name: contact.name,
                    type: 'single',
                    avatar: contact.avatar || ''
                });
            }
        }
        if (!chat || chat.type === 'group') return;
        const invite = this.catboxData.createCoAdoptInvite({
            chatId: chat.id,
            name: chat.name
        });
        if (!invite) return;
        const userInfo = wechatData.getUserInfo?.() || {};
        const state = this.catboxData.getState();
        const messageId = `catbox_invite_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        this.catboxData.updateCoAdoptInviteMessage?.(chat.id, messageId);
        wechatData.addMessage(chat.id, {
            id: messageId,
            from: 'me',
            type: 'catbox_coadopt_invite',
            content: '[猫盒共养邀请]',
            catboxPetName: state.catName,
            catboxInviteStatus: 'pending',
            catboxInviteChatId: chat.id,
            avatar: userInfo.avatar || ''
        });
        chat.lastMessage = '[猫盒共养邀请]';
        chat.timestamp = Date.now();
        wechatData.saveData?.();
        this._syncWechatHomeBadge?.(wechatData);
        this.phoneShell?.showNotification?.('猫盒', `已邀请${chat.name}共同收养`, '🐱');
        this.catboxView.render();
    }

    releaseCatboxCoAdopt() {
        const state = this.catboxData.releaseCoAdopt?.();
        if (!state) return;
        this.phoneShell?.showNotification?.('猫盒', '已解除共同收养', '💔');
        this.catboxView.render();
    }

    nextCatboxBackground() {
        this.catboxData.nextBackground();
        this.catboxView.render();
    }

    resetCatbox() {
        this.catboxData.resetAdoption();
        this.catboxView.render();
    }

    backToLobby() {
        this.game2048View?.destroy?.();
        this.sudokuView?.destroy?.();
        this.catboxView?.destroy?.();
        this.werewolfView?.destroy?.();
        super.backToLobby();
    }

    handleSwipeBack() {
        if (this.currentView === 'game2048' || this.currentView === 'sudoku' || this.currentView === 'catbox' || this.currentView === 'werewolf') {
            this.backToLobby();
            return;
        }
        super.handleSwipeBack();
    }
}
