/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 * 
 * ⚠️ 版权声明 (Copyright Notice):
 * 1. 禁止商业化：本项目仅供交流学习，严禁任何形式的倒卖、盈利等商业行为。
 * 2. 禁止二改发布：严禁未经授权修改代码后作为独立项目二次发布或分发。
 * 3. 禁止抄袭：严禁盗用本项目的核心逻辑、UI设计与相关原代码。
 * 
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */
// ========================================
// 微信通讯录视图
// ========================================
import { ImageCropper } from '../settings/image-cropper.js';

export class ContactsView {
    constructor(wechatApp) {
        this.app = wechatApp;
        this.searchText = '';
        this.groupsCollapsed = true;
    }

    _escapeAttr(value = '') {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    _escapeHtml(value = '') {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    _normalizeWechatReferenceImage(value = '') {
        const raw = String(value || '').trim();
        if (!raw || /^data:image\/[a-z0-9.+-]+;base64,/i.test(raw)) return '';
        if (/^(?:blob:|data:application\/octet-stream;base64,)/i.test(raw)) return raw;

        const normalized = raw.replace(/\\/g, '/');
        const lower = normalized.toLowerCase();
        const bgToken = '/backgrounds/';
        const bgIndex = lower.indexOf(bgToken);
        if (bgIndex >= 0) {
            const suffix = normalized.slice(bgIndex + bgToken.length).replace(/^\/+/, '').trim();
            return suffix ? `/backgrounds/${suffix}` : '';
        }

        if (/^(?:https?:)?\/\//i.test(normalized)) return normalized;
        if (normalized.startsWith('backgrounds/')) return `/${normalized}`;

        const looksLikeFilePath = /^[a-z]:\//i.test(normalized) || normalized.startsWith('//');
        if (looksLikeFilePath) {
            const fileName = normalized.split('/').filter(Boolean).pop() || '';
            return fileName ? `/backgrounds/${fileName}` : '';
        }

        if (/^phone_|^wechat_ref_|^honey_ref_/i.test(normalized)) {
            return `/backgrounds/${normalized.replace(/^\/+/, '')}`;
        }

        return normalized.startsWith('/') ? normalized : '';
    }

    _getWechatReferenceTargetSize(sourceWidth, sourceHeight) {
        const width = Number(sourceWidth || 0);
        const height = Number(sourceHeight || 0);
        if (!width || !height) return { width: 1024, height: 1536 };
        const ratio = width / height;
        const targetSizes = [
            { width: 1024, height: 1536 },
            { width: 1472, height: 1472 },
            { width: 1536, height: 1024 }
        ];
        return targetSizes.reduce((best, item) => {
            const bestDiff = Math.abs((best.width / best.height) - ratio);
            const itemDiff = Math.abs((item.width / item.height) - ratio);
            return itemDiff < bestDiff ? item : best;
        }, targetSizes[0]);
    }

    _readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
            reader.readAsDataURL(file);
        });
    }

    _loadImageFromDataUrl(dataUrl) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('图片解析失败'));
            image.src = dataUrl;
        });
    }

    async _prepareWechatReferenceImageFile(file) {
        if (!file || !String(file.type || '').startsWith('image/')) {
            throw new Error('请选择图片文件');
        }
        if (Number(file.size || 0) > 8 * 1024 * 1024) {
            throw new Error('个人形象参考图最大支持 8MB');
        }

        const dataUrl = await this._readFileAsDataUrl(file);
        const image = await this._loadImageFromDataUrl(dataUrl);
        const sourceWidth = Number(image.naturalWidth || image.width || 0);
        const sourceHeight = Number(image.naturalHeight || image.height || 0);
        if (!sourceWidth || !sourceHeight) return dataUrl;

        const target = this._getWechatReferenceTargetSize(sourceWidth, sourceHeight);
        const canvas = document.createElement('canvas');
        canvas.width = target.width;
        canvas.height = target.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return dataUrl;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const scale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
        const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
        const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
        const drawX = Math.round((canvas.width - drawWidth) / 2);
        const drawY = Math.round((canvas.height - drawHeight) / 2);
        ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
        return canvas.toDataURL('image/png');
    }

    _getTtsProviderOptions() {
        return [
            { id: 'minimax_cn', label: 'MiniMax 国内', placeholder: '例如 female-shaonv' },
            { id: 'minimax_intl', label: 'MiniMax 国际', placeholder: '例如 female-shaonv' },
            { id: 'openai', label: 'OpenAI', placeholder: '例如 alloy' },
            { id: 'indextts', label: 'IndexTTS 本地', placeholder: '例如 default.wav / 角色.wav' },
            { id: 'nimo', label: 'MiMo-V2.5-TTS', placeholder: '例如 mimo_default / nimo_clone_* / 声音描述' },
            { id: 'volcengine', label: '豆包 / 火山引擎', placeholder: '例如 BV700_streaming' }
        ];
    }

    _getCurrentTtsProvider() {
        return String(this.app?.storage?.get?.('phone-tts-provider') || 'minimax_cn').trim() || 'minimax_cn';
    }

    _getContactTtsVoices(contact = {}) {
        return (contact?.ttsVoices && typeof contact.ttsVoices === 'object') ? contact.ttsVoices : {};
    }

    _getTtsVoiceHistoryOptions() {
        try {
            const store = this.app.storage;
            let raw = store.get('phone-tts-voice-history') || store.get('phone_tts_voice_history');
            if (!raw) return '';

            let historyList = [];
            if (typeof raw === 'string') {
                if (raw.startsWith('[')) {
                    historyList = JSON.parse(raw);
                } else {
                    historyList = raw.split(',').map(s => s.trim()).filter(Boolean);
                }
            } else if (Array.isArray(raw)) {
                historyList = raw;
            }

            return [...new Set(historyList)]
                .map(v => `<option value="${this._escapeAttr(v)}">${this._escapeAttr(v)}</option>`)
                .join('');
        } catch (e) {
            console.warn('读取音色历史失败:', e);
            return '';
        }
    }

    renderGroupChatRows(groupChats = null) {
        const chats = Array.isArray(groupChats)
            ? groupChats
            : this.app.wechatData.getChatList()
                .filter(chat => chat?.type === 'group')
                .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));

        if (chats.length === 0) {
            return '<div class="contacts-empty-row">暂无群聊</div>';
        }

        return chats.map(chat => `
            <div class="contact-group-item" data-chat-id="${chat.id}">
                <div class="contact-avatar">
                    ${this.app.renderAvatar(chat.avatar, '👥', chat.name)}
                </div>
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex:1; min-width:0;">
                    <div class="contact-name" style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${chat.name}</div>
                </div>
            </div>
        `).join('');
    }

    render() {
        const contacts = this.app.wechatData.getContacts();
        const groupChats = this.app.wechatData.getChatList()
            .filter(chat => chat?.type === 'group')
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
        const grouped = this.groupContacts(contacts);

        return `
            <div class="wechat-contacts">
                
                <!-- 🔥 可滚动内容区 -->
                <div class="contacts-scrollable">
                    <!-- 功能入口 -->
                    <div class="contacts-functions">
                        <div class="function-item" data-func="new-friends">
                            <div class="function-icon" style="background: rgba(255,255,255,0.6); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.3);">
                                <i class="fa-solid fa-user-plus" style="color: #666;"></i>
                            </div>
                            <div class="function-name">新的朋友</div>
                        </div>
                        <div class="function-item" data-func="groups">
                            <div class="function-icon" style="background: rgba(255,255,255,0.6); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.3);">
                                <i class="fa-solid fa-users" style="color: #666;"></i>
                            </div>
                            <div class="function-name contacts-function-main">
                                <span class="contacts-group-title">
                                    群聊
                                </span>
                                <button type="button" class="contacts-group-create-btn" id="create-group-from-function" aria-label="新建群聊">+</button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- 联系人列表 -->
                    <div class="contacts-list">
                        <div class="contacts-group" data-section="groups">
                            ${this.groupsCollapsed ? '' : this.renderGroupChatRows(groupChats)}
                        </div>
                        <div class="contacts-group" data-section="contacts">
                            <div class="group-letter">联系人</div>
                        </div>
                        ${Object.keys(grouped).sort().map(letter => `
                            <div class="contacts-group">
                                <div class="group-letter">${letter}</div>
                                ${grouped[letter].map(contact => {
                                    const isHoneyContact = contact.sourceApp === 'honey' || contact.sourceLabel === '蜜语' || contact.sourceLabel === '主播';
                                    const honeyLabel = contact.sourceLabel === '主播' || String(contact.relation || '').includes('主播') ? '主播' : '蜜语';
                                    return `
                                    <div class="contact-item" data-contact-id="${contact.id}">
                                        <div class="contact-avatar">
                                            ${this.app.renderAvatar(contact.avatar, '👤', contact.name)}
                                        </div>
                                        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex:1; min-width:0;">
                                            <div class="contact-name" style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${contact.name}</div>
                                            ${isHoneyContact
                                                ? `<span style="flex-shrink:0; display:inline-flex; align-items:center; gap:4px; padding:2px 6px; margin-right:16px; border-radius:999px; background:rgba(255,105,180,0.14); color:#ff5fa2; font-size:10px; line-height:1; border:1px solid rgba(255,105,180,0.24);"><i class="fa-solid fa-heart" style="font-size:9px;"></i>${honeyLabel}</span>`
                                                : ''}
                                        </div>
                                    </div>
                                `;}).join('')}
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <!-- ✅ 字母索引移到外面，成为固定元素 -->
                <div class="letter-index">
                    ${'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').map(letter => `
                        <span class="letter-item" data-letter="${letter}">${letter}</span>
                    `).join('')}
                </div>
            </div>
        `;
    }

    groupContacts(contacts) {
        const grouped = {};

        contacts.forEach(contact => {
            const firstLetter = this.getFirstLetter(contact.name);
            if (!grouped[firstLetter]) {
                grouped[firstLetter] = [];
            }
            grouped[firstLetter].push(contact);
        });

        return grouped;
    }

    getFirstLetter(name) {
        return this.app.wechatData.getFirstLetter(name);
    }

    escapeAttr(str) {
        if (!str) return '';
        if (typeof str === 'string' && !str.includes('<') && !str.includes('"')) {
            return str;
        }
        if (typeof str === 'string' && (str.startsWith('data:') || str.includes('<'))) {
            return `__BASE64__${btoa(encodeURIComponent(str))}`;
        }
        return str;
    }

    decodeAttr(str) {
        if (!str) return '👤';
        if (str.startsWith('__BASE64__')) {
            try {
                return decodeURIComponent(atob(str.substring(10)));
            } catch (e) {
                return '👤';
            }
        }
        return str;
    }

    bindEvents() {
        // 字母索引点击
        document.querySelectorAll('.letter-item').forEach(item => {
            item.addEventListener('click', () => {
                const letter = item.dataset.letter;
                this.scrollToLetter(letter);
            });
        });
        document.getElementById('create-group-from-function')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showCreateGroupPage();
        });
        const groupsFunctionItem = document.querySelector('.function-item[data-func="groups"]');
        if (groupsFunctionItem) {
            groupsFunctionItem.onclick = (e) => {
                if (e.target.closest('#create-group-from-function')) return;
                this.toggleGroupSection();
            };
        }
        this.bindGroupChatItems();

        // 联系人点击和长按
        document.querySelectorAll('.contact-item[data-contact-id]').forEach(item => {
            let pressTimer;
            let isLongPress = false;

            item.addEventListener('click', () => {
                if (isLongPress) {
                    isLongPress = false;
                    return;
                }
                const contactId = item.dataset.contactId;
                this.openContactChat(contactId);
            });

            item.addEventListener('touchstart', (e) => {
                isLongPress = false;
                pressTimer = setTimeout(() => {
                    isLongPress = true;
                    const contactId = item.dataset.contactId;
                    this.showContactMenu(contactId, item);
                }, 500);
            });

            item.addEventListener('touchend', () => clearTimeout(pressTimer));
            item.addEventListener('touchmove', () => clearTimeout(pressTimer));

            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const contactId = item.dataset.contactId;
                this.showContactMenu(contactId, item);
            });
        });

        // 功能入口点击
        document.querySelectorAll('.function-item').forEach(item => {
            if (item.dataset.func === 'groups') return;
            item.addEventListener('click', () => {
                const func = item.dataset.func;
                this.handleFunction(func);
            });
        });
    }

    showContactMenu(contactId, element) {
        const contact = this.app.wechatData.getContact(contactId);
        if (!contact) return;

        document.querySelectorAll('.contact-action-menu').forEach(menu => menu.remove());

        const menuHtml = `
            <div class="contact-action-menu" style="
                position: absolute;
                top: 50%;
                right: 30px;
                transform: translateY(-50%);
                background: rgba(255,255,255,0.9);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                border-radius: 4px;
                z-index: 1000;
                box-shadow: 0 1px 4px rgba(0,0,0,0.12);
                white-space: nowrap;
                display: flex;
            ">
                <div class="contact-menu-item" data-action="edit" style="
                    padding: 4px 10px;
                    color: #576b95;
                    font-size: 11px;
                    cursor: pointer;
                    text-align: center;
                    border-right: 0.5px solid #e5e5e5;
                ">编辑</div>
                <div class="contact-menu-item" data-action="delete" style="
                    padding: 4px 10px;
                    color: #ff3b30;
                    font-size: 11px;
                    cursor: pointer;
                    text-align: center;
                ">删除</div>
            </div>
        `;

        element.style.position = 'relative';
        element.insertAdjacentHTML('beforeend', menuHtml);

        element.querySelector('.contact-menu-item[data-action="edit"]')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            document.querySelectorAll('.contact-action-menu').forEach(menu => menu.remove());
            this.showEditContactPage(contactId);
        });

        element.querySelector('.contact-menu-item[data-action="delete"]')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.confirmDeleteContact(contactId, contact.name);
        });

        setTimeout(() => {
            document.addEventListener('click', function closeMenu(e) {
                document.querySelectorAll('.contact-action-menu').forEach(menu => menu.remove());
                document.removeEventListener('click', closeMenu);
            }, { once: true });
        }, 100);
    }

    showEditContactPage(contactId, options = {}) {
        const contact = this.app.wechatData.getContact(contactId)
            || this.app.wechatData.findContactByNameLoose?.(contactId, { includeChats: false });
        if (!contact) return;
        const safeContactId = String(contact.id || contactId || '').trim();
        const returnToChatList = options?.returnToChatList === true;
        const returnFromEditContact = () => {
            if (returnToChatList) {
                this.app.currentView = 'chats';
                this.app.currentChat = null;
            } else {
                this.app.currentView = 'contacts';
                this.app.currentChat = null;
            }
            this.app.render();
        };

        const avatarHtml = this.app.renderAvatar(contact.avatar, '👤', contact.name);
        const currentTtsProvider = this._getCurrentTtsProvider();
        const contactTtsVoices = this._getContactTtsVoices(contact);
        const contactTtsProvider = String(contact.ttsProvider || '').trim();
        const legacyTtsVoice = String(contact.ttsVoice || '').trim();
        const contactGender = String(this.app.wechatData?.getContactGender?.(safeContactId) || 'unknown').trim();
        const contactAvatarGroup = String(this.app.wechatData?.getContactAvatarGroup?.(safeContactId) || '').trim();
        const ttsHistoryOptions = this._getTtsVoiceHistoryOptions();
        const referenceImage = this._normalizeWechatReferenceImage(contact.naiReferenceImage || contact.referenceImage || '');
        const referenceEnabled = !!referenceImage && contact.naiReferenceEnabled !== false && contact.naiReferenceEnabled !== 'false';
        const rawReferenceStrength = Number(contact.naiReferenceStrength ?? 0.7);
        const referenceStrength = Math.max(0, Math.min(1, Number.isFinite(rawReferenceStrength) ? rawReferenceStrength : 0.7));
        const naiPromptTags = String(contact.naiPromptTags || contact.imageTags || '').trim();
        const referencePreviewStyle = referenceImage
            ? `background-image:url('${this._escapeAttr(`${referenceImage}${referenceImage.includes('?') ? '&' : '?'}t=${Date.now()}`)}'); background-size:cover; background-position:center;`
            : '';
        const shellBg = this.app._getMainShellBackgroundConfig?.() || {};
        const hasShellBg = !!shellBg.contentBgStyle;
        const glassPanelStyle = hasShellBg
            ? 'background: rgba(255,255,255,0.34); border: 1px solid rgba(255,255,255,0.36); backdrop-filter: blur(12px) saturate(135%); -webkit-backdrop-filter: blur(12px) saturate(135%);'
            : 'background: #fff;';
        const fieldStyle = hasShellBg
            ? 'background: rgba(255,255,255,0.84); border: 1px solid rgba(255,255,255,0.56); color: #111;'
            : 'background: #fff; border: 1px solid #e5e5e5; color: #111;';
        const softFieldStyle = hasShellBg
            ? 'background: rgba(255,255,255,0.72); border: 1px solid rgba(255,255,255,0.48); color: #111;'
            : 'background: #fafafa; border: 1px solid #e5e5e5; color: #111;';
        const buttonStyle = hasShellBg
            ? 'background: rgba(255,255,255,0.76); border: 1px solid rgba(255,255,255,0.52); color: #111;'
            : 'background: #f0f0f0; border: none; color: #333;';

        const html = `
            <div class="${shellBg.appClass || 'wechat-app'}" style="${shellBg.appStyle || ''}">
                <div class="wechat-header">
                    <div class="wechat-header-left">
                        <button class="wechat-back-btn" id="back-from-edit-contact">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>
                    <div class="wechat-header-title">编辑联系人</div>
                    <div class="wechat-header-right"></div>
                </div>

                <div class="wechat-content" style="${shellBg.contentBgStyle || 'background: #ededed;'} padding: 12px;">
                    <div style="${glassPanelStyle} border-radius: 10px; padding: 15px; margin-bottom: 10px;">
                        <div style="text-align: center; margin-bottom: 12px;">
                            <div id="edit-contact-avatar-preview" style="
                                width: 56px;
                                height: 56px;
                                border-radius: 50%;
                                background: #fff;
                                border: 1px solid #d8d8d8;
                                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
                                margin: 0 auto 8px;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                font-size: 28px;
                                cursor: pointer;
                                overflow: hidden;
                            ">${avatarHtml}</div>
                            <input type="file" id="edit-contact-avatar-upload" accept="image/png, image/jpeg, image/gif, image/webp, image/*" style="display: none;">
                            <button id="upload-edit-contact-avatar" style="
                                padding: 5px 10px;
                                ${buttonStyle}
                                border-radius: 4px;
                                font-size: 11px;
                                cursor: pointer;
                            ">
                                <i class="fa-solid fa-camera"></i> 更换头像
                            </button>
                        </div>

                        <div style="margin-bottom: 10px;">
                            <div style="font-size: 11px; color: #999; margin-bottom: 4px;">昵称 *</div>
                            <input type="text" id="edit-contact-name-input" placeholder="输入昵称" maxlength="20"
                                   value="${contact.name || ''}" style="
                                width: 100%;
                                padding: 8px 10px;
                                ${fieldStyle}
                                border-radius: 6px;
                                font-size: 13px;
                                box-sizing: border-box;
                                margin-bottom: 6px;
                            ">
                            <div style="font-size: 11px; color: #999;">备注请直接写在昵称里（例如：张三（同事））</div>
                        </div>

                        <div style="margin-bottom: 10px;">
                            <div style="font-size: 11px; color: #999; margin-bottom: 4px;">性别（用于未绑定音色时选择全局兜底）</div>
                            <select id="edit-contact-gender-select" style="
                                width: 100%;
                                height: 30px;
                                padding: 0 8px;
                                ${softFieldStyle}
                                border-radius: 6px;
                                font-size: 12px;
                                box-sizing: border-box;
                            ">
                                <option value="female" ${contactGender !== 'male' ? 'selected' : ''}>女</option>
                                <option value="male" ${contactGender === 'male' ? 'selected' : ''}>男</option>
                            </select>
                        </div>

                        <div style="margin-bottom: 10px;">
                            <div style="font-size: 11px; color: #999; margin-bottom: 4px;">默认头像类型</div>
                            <select id="edit-contact-avatar-group-select" style="
                                width: 100%;
                                height: 30px;
                                padding: 0 8px;
                                ${softFieldStyle}
                                border-radius: 6px;
                                font-size: 12px;
                                box-sizing: border-box;
                            ">
                                <option value="" ${!contactAvatarGroup ? 'selected' : ''}>跟随性别</option>
                                <option value="female" ${contactAvatarGroup === 'female' ? 'selected' : ''}>普通女</option>
                                <option value="male" ${contactAvatarGroup === 'male' ? 'selected' : ''}>普通男</option>
                                <option value="female_elder" ${contactAvatarGroup === 'female_elder' ? 'selected' : ''}>年长女</option>
                                <option value="male_elder" ${contactAvatarGroup === 'male_elder' ? 'selected' : ''}>年长男</option>
                            </select>
                        </div>

                        <div style="margin-top: 15px; border-top: 1px solid #f0f0f0; padding-top: 15px;">
                            <div style="font-size: 12px; color: #000; font-weight: 500; margin-bottom: 8px;">🖼️ 个人形象参考图</div>
                            <div style="display: flex; gap: 10px; align-items: flex-start;">
                                <button id="edit-contact-reference-preview" type="button" style="
                                    width: 64px;
                                    height: 64px;
                                    border-radius: 8px;
                                    ${softFieldStyle}
                                    color: #999;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    overflow: hidden;
                                    cursor: pointer;
                                    flex: 0 0 auto;
                                    ${referencePreviewStyle}
                                ">${referenceImage ? '' : '<i class="fa-regular fa-image"></i>'}</button>
                                <div style="flex: 1; min-width: 0;">
                                    <div style="font-size: 11px; color: #666; line-height: 1.45;">仅当 AI 回复 <b>[个人图片]（描述）</b> 时，NovelAI 生图才会使用这张参考图；普通 <b>[图片]（描述）</b> 不会使用参考图。</div>
                                    <input type="file" id="edit-contact-reference-upload" accept="image/png, image/jpeg, image/gif, image/webp, image/*" style="display: none;">
                                    <div style="display: flex; gap: 6px; margin-top: 8px;">
                                        <button id="upload-edit-contact-reference" type="button" style="padding: 5px 9px; ${buttonStyle} border-radius: 5px; font-size: 11px; cursor: pointer;">${referenceImage ? '替换形象' : '上传形象'}</button>
                                        <button id="delete-edit-contact-reference" type="button" ${referenceImage ? '' : 'disabled'} style="padding: 5px 9px; border: none; border-radius: 5px; background: #fff1f0; color: #d93025; font-size: 11px; cursor: pointer; opacity:${referenceImage ? '1' : '0.45'};">删除</button>
                                    </div>
                                </div>
                            </div>
                            <label style="display: flex; align-items: center; gap: 6px; margin-top: 9px; font-size: 11px; color: #666;">
                                <input type="checkbox" id="edit-contact-reference-enabled" ${referenceEnabled ? 'checked' : ''} ${referenceImage ? '' : 'disabled'}>
                                启用个人形象参考图
                            </label>
                            <label style="display: block; margin-top: 8px;">
                                <div style="font-size: 11px; color: #666; margin-bottom: 3px;">参考强度：<span id="edit-contact-reference-strength-text">${referenceStrength.toFixed(2)}</span></div>
                                <input type="range" id="edit-contact-reference-strength" min="0" max="1" step="0.05" value="${referenceStrength}" ${referenceImage ? '' : 'disabled'} style="width: 100%;">
                            </label>
                            <label style="display: block; margin-top: 10px;">
                                <div style="font-size: 11px; color: #666; margin-bottom: 3px;">专属生图Tag</div>
                                <textarea id="edit-contact-nai-prompt-tags" placeholder="例如：1girl, long black hair, blue eyes, school uniform" style="
                                    width: 100%;
                                    min-height: 54px;
                                    padding: 8px 10px;
                                    ${fieldStyle}
                                    border-radius: 6px;
                                    font-size: 12px;
                                    line-height: 1.35;
                                    resize: vertical;
                                    box-sizing: border-box;
                                    font-family: inherit;
                                ">${this._escapeHtml(naiPromptTags)}</textarea>
                                <div style="font-size: 10px; color: #999; line-height: 1.35; margin-top: 4px;">生成 [个人图片] 时会拼在 AI 图片描述前面，用于固定角色外观；没有参考图也会生效。</div>
                            </label>
                        </div>

                        <!-- 🔥 新增：专属音色绑定 -->
                        <div style="margin-top: 15px; border-top: 1px solid #f0f0f0; padding-top: 15px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <div style="font-size: 12px; color: #000; font-weight: 500;">🎙️ 专属语音音色</div>
                                <select id="edit-contact-tts-select" style="${softFieldStyle} border-radius:4px; font-size:11px; padding:2px 4px; outline:none; max-width: 100px;">
                                    <option value="">-- 历史音色 --</option>
                                    ${ttsHistoryOptions}
                                </select>
                            </div>
                            <label style="display: block; margin-bottom: 7px;">
                                <div style="font-size: 11px; color: #666; margin-bottom: 3px;">该角色默认语音服务商</div>
                                <select id="edit-contact-tts-provider-select" style="
                                    width: 100%;
                                    height: 30px;
                                    padding: 0 8px;
                                    ${softFieldStyle}
                                    border-radius: 6px;
                                    font-size: 12px;
                                    box-sizing: border-box;
                                ">
                                    <option value="" ${!contactTtsProvider ? 'selected' : ''}>跟随全局设置</option>
                                    ${this._getTtsProviderOptions().map(option => `
                                        <option value="${option.id}" ${contactTtsProvider === option.id ? 'selected' : ''}>${option.label}</option>
                                    `).join('')}
                                </select>
                            </label>
                            <div style="display: flex; flex-direction: column; gap: 7px;">
                                ${this._getTtsProviderOptions().map(option => {
                                    const providerVoice = String(contactTtsVoices?.[option.id] || '').trim();
                                    const value = providerVoice || (option.id === currentTtsProvider ? legacyTtsVoice : '');
                                    const activeText = option.id === currentTtsProvider ? '当前' : '';
                                    return `
                                        <label style="display: block;">
                                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                                                <span style="font-size: 11px; color: #666;">${option.label}</span>
                                                ${activeText ? '<span style="font-size: 10px; color: #07c160;">当前</span>' : ''}
                                            </div>
                                            <input type="text" class="edit-contact-tts-provider-input" data-provider="${option.id}" placeholder="${option.placeholder}"
                                                   value="${this._escapeAttr(value)}" style="
                                                width: 100%;
                                                padding: 8px 10px;
                                                ${fieldStyle}
                                                border-radius: 6px;
                                                font-size: 12px;
                                                box-sizing: border-box;
                                            ">
                                        </label>
                                    `;
                                }).join('')}
                            </div>
                            <div style="font-size: 10px; color: #ff3b30; margin-top: 5px;">群聊自动播放会按发送者的默认服务商和对应音色逐条合成；未指定服务商则跟随全局设置。</div>
                        </div>

                    </div>

                    <button id="save-edit-contact-btn" style="
                        width: 100%;
                        padding: 10px;
                        background: #07c160;
                        color: #fff;
                        border: none;
                        border-radius: 6px;
                        font-size: 14px;
                        font-weight: 500;
                        cursor: pointer;
                    ">保存</button>
                </div>
            </div>
        `;

        this.app.currentView = 'contacts';
        this.app.currentChat = null;
        this.app.phoneShell.setContent(html, `wechat-edit-contact-${safeContactId || 'unknown'}`);

        let selectedAvatar = contact.avatar;
        const originalReferenceImage = referenceImage;
        let selectedReferenceImage = referenceImage;
        let referenceImageDeleted = false;
        const pendingReferenceCleanup = new Set();
        const cleanupReferenceImages = (items) => {
            Array.from(items || [])
                .map(item => String(item || '').trim())
                .filter(Boolean)
                .forEach((item) => {
                    window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(item, { quiet: true, skipIfReferenced: true })?.catch?.(() => {});
                });
        };
        const currentView = document.querySelector('.phone-view-current') || document;
        const query = (selector) => currentView.querySelector(selector) || document.querySelector(selector);
        const queryAll = (selector) => Array.from(currentView.querySelectorAll(selector));

        const updateReferenceControls = () => {
            const hasImage = !!selectedReferenceImage;
            const preview = query('#edit-contact-reference-preview');
            const uploadBtn = query('#upload-edit-contact-reference');
            const deleteBtn = query('#delete-edit-contact-reference');
            const enabledInput = query('#edit-contact-reference-enabled');
            const strengthInput = query('#edit-contact-reference-strength');
            if (preview) {
                preview.style.backgroundImage = hasImage ? `url("${selectedReferenceImage}${selectedReferenceImage.includes('?') ? '&' : '?'}t=${Date.now()}")` : '';
                preview.style.backgroundSize = hasImage ? 'cover' : '';
                preview.style.backgroundPosition = hasImage ? 'center' : '';
                preview.innerHTML = hasImage ? '' : '<i class="fa-regular fa-image"></i>';
            }
            if (uploadBtn) uploadBtn.textContent = hasImage ? '替换形象' : '上传形象';
            if (deleteBtn) {
                deleteBtn.disabled = !hasImage;
                deleteBtn.style.opacity = hasImage ? '1' : '0.45';
            }
            if (enabledInput) {
                enabledInput.disabled = !hasImage;
                if (hasImage) enabledInput.checked = true;
            }
            if (strengthInput) strengthInput.disabled = !hasImage;
        };

        let referenceAutosaveTimer = null;
        const readReferencePatch = () => {
            const strengthValue = Math.max(0, Math.min(1, Number(query('#edit-contact-reference-strength')?.value) || 0.7));
            const tagsValue = String(query('#edit-contact-nai-prompt-tags')?.value || '').trim();
            return {
                naiReferenceImage: selectedReferenceImage,
                naiReferenceEnabled: !!selectedReferenceImage && !!query('#edit-contact-reference-enabled')?.checked,
                naiReferenceStrength: strengthValue,
                naiReferenceInformationExtracted: 1,
                naiPromptTags: tagsValue
            };
        };
        const saveReferenceSettings = async (options = {}) => {
            const patch = readReferencePatch();
            this.app.wechatData.updateContact(safeContactId, patch);
            if (window.VirtualPhone) {
                window.VirtualPhone.cachedWechatData = this.app.wechatData;
            }
            if (options.flush === true && typeof this.app.wechatData.saveData === 'function') {
                await this.app.wechatData.saveData();
            }
            return patch;
        };
        const queueReferenceAutosave = () => {
            if (referenceAutosaveTimer) clearTimeout(referenceAutosaveTimer);
            referenceAutosaveTimer = setTimeout(() => {
                referenceAutosaveTimer = null;
                saveReferenceSettings().catch(e => console.warn('个人形象设置自动保存失败:', e));
            }, 300);
        };
        const flushReferenceAutosave = async () => {
            if (referenceAutosaveTimer) {
                clearTimeout(referenceAutosaveTimer);
                referenceAutosaveTimer = null;
            }
            await saveReferenceSettings({ flush: true });
        };

        query('#back-from-edit-contact')?.addEventListener('click', async () => {
            await flushReferenceAutosave().catch(e => console.warn('个人形象设置返回前保存失败:', e));
            cleanupReferenceImages(pendingReferenceCleanup);
            returnFromEditContact();
        });

        // 🔥 下拉框选择后，自动把选中的音色填入输入框
        query('#edit-contact-tts-select')?.addEventListener('change', (e) => {
            const selectedVoice = e.target.value;
            if (selectedVoice) {
                const targetProvider = String(query('#edit-contact-tts-provider-select')?.value || currentTtsProvider).trim() || currentTtsProvider;
                const currentInput = query(`.edit-contact-tts-provider-input[data-provider="${CSS.escape(targetProvider)}"]`)
                    || query('.edit-contact-tts-provider-input');
                if (currentInput) currentInput.value = selectedVoice;
            }
        });

        query('#upload-edit-contact-avatar')?.addEventListener('click', () => {
            query('#edit-contact-avatar-upload')?.click();
        });

        query('#edit-contact-avatar-upload')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            e.target.value = '';

            if (file.size > 5 * 1024 * 1024) {
                this.app.phoneShell.showNotification('提示', '图片太大，请选择小于5MB的图片', '⚠️');
                return;
            }

            try {
                const cropper = new ImageCropper({
                    title: '裁剪好友头像',
                    aspectRatio: 1,
                    outputWidth: 512,
                    outputHeight: 512,
                    quality: 0.92,
                    maxFileSize: 5 * 1024 * 1024
                });
                const croppedImage = await cropper.open(file);

                const preview = query('#edit-contact-avatar-preview');
                if (preview) {
                    preview.innerHTML = `<img src="${croppedImage}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
                }

                this.app.phoneShell.showNotification('处理中', '正在上传头像...', '⏳');
                const oldAvatar = String(selectedAvatar || contact.avatar || '').trim();
                const uploadedAvatar = await window.VirtualPhone?.imageManager?.uploadDataUrl?.(croppedImage, 'contact_avatar');
                if (!uploadedAvatar) throw new Error('图片上传管理器未初始化');

                selectedAvatar = uploadedAvatar;
                const synced = this.app.wechatData.syncContactAvatar(safeContactId, selectedAvatar);
                const savedContact = this.app.wechatData.getContact(safeContactId)
                    || this.app.wechatData.findContactByNameLoose?.(contact.name, { includeChats: false });
                const savedChat = this.app.wechatData.getChatByContactId?.(safeContactId);
                const contactAvatarSaved = String(savedContact?.avatar || '').trim() === selectedAvatar;
                const chatAvatarSaved = !savedChat || String(savedChat.avatar || '').trim() === selectedAvatar;
                if (!synced || !contactAvatarSaved || !chatAvatarSaved) {
                    selectedAvatar = oldAvatar || contact.avatar || '👤';
                    if (preview) {
                        preview.innerHTML = this.app.renderAvatar(selectedAvatar, '👤', contact.name);
                    }
                    throw new Error('头像已上传，但写入联系人数据失败，请重新打开联系人后再试');
                }
                if (window.VirtualPhone) {
                    window.VirtualPhone.cachedWechatData = this.app.wechatData;
                }
                if (oldAvatar && oldAvatar !== selectedAvatar) {
                    window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(oldAvatar, { quiet: true, skipIfReferenced: true })?.catch?.(() => { });
                }
                this.app.phoneShell.showNotification('成功', '头像已上传并保存', '✅');
            } catch (err) {
                if (String(err?.message || '') === '用户取消') return;
                console.warn('头像上传服务器失败:', err);
                this.app.phoneShell.showNotification('上传失败', err?.message || '头像上传失败', '❌');
            }
        });

        query('#edit-contact-reference-preview')?.addEventListener('click', () => {
            query('#edit-contact-reference-upload')?.click();
        });

        query('#upload-edit-contact-reference')?.addEventListener('click', () => {
            query('#edit-contact-reference-upload')?.click();
        });

        query('#edit-contact-reference-upload')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            e.target.value = '';
            const oldReferenceImage = selectedReferenceImage || '';
            try {
                this.app.phoneShell.showNotification('处理中', '正在上传个人形象...', '⏳');
                const dataUrl = await this._prepareWechatReferenceImageFile(file);
                const blobResp = await fetch(dataUrl);
                const blob = await blobResp.blob();
                const safeName = String(contact.name || safeContactId || 'contact')
                    .replace(/[^\w\u4e00-\u9fff-]+/g, '_')
                    .slice(0, 24) || 'contact';
                const uploadedUrl = await window.VirtualPhone?.imageManager?.uploadBlob?.(blob, `wechat_ref_${safeName}`);
                if (!uploadedUrl) throw new Error('图片上传管理器未初始化');
                if (oldReferenceImage && oldReferenceImage !== originalReferenceImage) {
                    pendingReferenceCleanup.add(oldReferenceImage);
                }
                selectedReferenceImage = uploadedUrl;
                referenceImageDeleted = false;
                updateReferenceControls();
                await saveReferenceSettings({ flush: true });
                if (oldReferenceImage && oldReferenceImage !== selectedReferenceImage) {
                    pendingReferenceCleanup.add(oldReferenceImage);
                    cleanupReferenceImages(pendingReferenceCleanup);
                    pendingReferenceCleanup.clear();
                }
                this.app.phoneShell.showNotification('成功', '个人形象参考图已上传', '✅');
            } catch (err) {
                console.warn('个人形象参考图上传失败:', err);
                this.app.phoneShell.showNotification('上传失败', err?.message || '个人形象上传失败', '❌');
            }
        });

        query('#delete-edit-contact-reference')?.addEventListener('click', async () => {
            if (!selectedReferenceImage) return;
            const removedReferenceImage = selectedReferenceImage;
            if (selectedReferenceImage !== originalReferenceImage) {
                pendingReferenceCleanup.add(selectedReferenceImage);
            }
            selectedReferenceImage = '';
            referenceImageDeleted = true;
            updateReferenceControls();
            await saveReferenceSettings({ flush: true }).catch(e => console.warn('个人形象参考图删除保存失败:', e));
            if (removedReferenceImage) {
                pendingReferenceCleanup.add(removedReferenceImage);
                cleanupReferenceImages(pendingReferenceCleanup);
                pendingReferenceCleanup.clear();
            }
        });

        query('#edit-contact-reference-strength')?.addEventListener('input', (e) => {
            const value = Math.max(0, Math.min(1, Number(e.target.value) || 0));
            const text = query('#edit-contact-reference-strength-text');
            if (text) text.textContent = value.toFixed(2);
            queueReferenceAutosave();
        });

        query('#edit-contact-reference-enabled')?.addEventListener('change', () => {
            queueReferenceAutosave();
        });

        query('#edit-contact-nai-prompt-tags')?.addEventListener('input', () => {
            queueReferenceAutosave();
        });

        query('#edit-contact-nai-prompt-tags')?.addEventListener('change', () => {
            flushReferenceAutosave().catch(e => console.warn('专属生图Tag保存失败:', e));
        });

        query('#save-edit-contact-btn')?.addEventListener('click', async () => {
            const name = query('#edit-contact-name-input').value.trim();

            if (!name) {
                this.app.phoneShell.showNotification('提示', '请输入昵称', '⚠️');
                return;
            }

            const nextNameKey = this.app.wechatData._normalizeExactContactName?.(name) || String(name || '').trim().replace(/\s+/g, '').toLowerCase();
            const exists = this.app.wechatData.getContacts().find(c =>
                c.id !== safeContactId
                && (this.app.wechatData._normalizeExactContactName?.(c.name) || String(c?.name || '').trim().replace(/\s+/g, '').toLowerCase()) === nextNameKey
            );
            if (exists) {
                this.app.phoneShell.showNotification('提示', '该名称已被其他联系人使用', '⚠️');
                return;
            }

            await flushReferenceAutosave().catch(e => console.warn('个人形象设置保存失败:', e));

            // 🔥 新增：读取各服务商音色 ID
            const ttsVoices = {};
            let currentProviderTtsVoice = '';
            const ttsProvider = String(query('#edit-contact-tts-provider-select')?.value || '').trim();
            queryAll('.edit-contact-tts-provider-input').forEach((input) => {
                const provider = String(input.dataset.provider || '').trim();
                const value = String(input.value || '').trim();
                if (provider && value) ttsVoices[provider] = value;
                if (provider === currentTtsProvider) currentProviderTtsVoice = value;
            });
            const ttsVoice = String(currentProviderTtsVoice || '').trim();
            const oldAvatar = String(contact.avatar || '').trim();
            const oldReferenceImage = String(contact.naiReferenceImage || contact.referenceImage || '').trim();
            const referenceStrengthValue = Math.max(0, Math.min(1, Number(query('#edit-contact-reference-strength')?.value) || 0.7));
            const naiPromptTagsValue = String(query('#edit-contact-nai-prompt-tags')?.value || '').trim();

            this.app.wechatData.updateContact(safeContactId, {
                name: name,
                avatar: selectedAvatar,
                letter: this.app.wechatData.getFirstLetter(name),
                ttsVoice: ttsVoice, // 🔥 旧字段兜底
                ttsVoices: ttsVoices, // 🔥 按服务商保存音色
                ttsProvider: ttsProvider, // 🔥 该角色默认服务商；空值表示跟随全局
                naiReferenceImage: selectedReferenceImage,
                naiReferenceEnabled: !!selectedReferenceImage && !!query('#edit-contact-reference-enabled')?.checked,
                naiReferenceStrength: referenceStrengthValue,
                naiReferenceInformationExtracted: 1,
                naiPromptTags: naiPromptTagsValue
            });
            this.app.wechatData.setContactGender?.(
                safeContactId,
                String(query('#edit-contact-gender-select')?.value || 'female').trim() === 'male' ? 'male' : 'female'
            );
            this.app.wechatData.setContactAvatarGroup?.(
                safeContactId,
                String(query('#edit-contact-avatar-group-select')?.value || '').trim()
            );

            this.app.wechatData.syncContactAvatar(safeContactId, selectedAvatar);
            if (oldAvatar && oldAvatar !== selectedAvatar) {
                const cleanupTask = window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(oldAvatar, { quiet: true, skipIfReferenced: true });
                cleanupTask?.catch?.(() => { });
            }
            if (referenceImageDeleted && oldReferenceImage) {
                pendingReferenceCleanup.add(oldReferenceImage);
            } else if (oldReferenceImage && oldReferenceImage !== selectedReferenceImage) {
                pendingReferenceCleanup.add(oldReferenceImage);
            }
            cleanupReferenceImages(pendingReferenceCleanup);
            this.app.phoneShell.showNotification('保存成功', '联系人信息已更新', '✅');

            setTimeout(() => {
                returnFromEditContact();
            }, 1000);
        });
    }

    confirmDeleteContact(contactId, contactName) {
        document.querySelectorAll('.contact-action-menu').forEach(menu => menu.remove());

        const html = `
            <div class="wechat-app">
                <div class="wechat-header">
                    <div class="wechat-header-left">
                        <button class="wechat-back-btn" id="back-from-delete-contact">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>
                    <div class="wechat-header-title">删除联系人</div>
                    <div class="wechat-header-right"></div>
                </div>

                <div class="wechat-content" style="background: #ededed; padding: 20px;">
                    <div style="background: #fff; border-radius: 12px; padding: 30px; text-align: center;">
                        <i class="fa-solid fa-user-minus" style="font-size: 48px; color: #ff3b30; margin-bottom: 20px;"></i>
                        <div style="font-size: 18px; font-weight: 600; color: #000; margin-bottom: 10px;">
                            确定要删除 ${contactName} 吗？
                        </div>
                        <div style="font-size: 14px; color: #999; margin-bottom: 30px;">
                            删除后将同时清空与该联系人的聊天记录
                        </div>

                        <button id="confirm-delete-contact" style="
                            width: 100%;
                            padding: 14px;
                            background: #ff3b30;
                            color: #fff;
                            border: none;
                            border-radius: 8px;
                            font-size: 16px;
                            font-weight: 600;
                            cursor: pointer;
                            margin-bottom: 10px;
                        ">确定删除</button>

                        <button id="cancel-delete-contact" style="
                            width: 100%;
                            padding: 14px;
                            background: #f0f0f0;
                            color: #666;
                            border: none;
                            border-radius: 8px;
                            font-size: 16px;
                            cursor: pointer;
                        ">取消</button>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html);

        const currentView = document.querySelector('.phone-view-current') || document;

        const backBtn = currentView.querySelector('#back-from-delete-contact');
        if (backBtn) backBtn.onclick = () => {
            this.app.currentView = 'contacts';
            this.app.render();
        };

        const cancelBtn = currentView.querySelector('#cancel-delete-contact');
        if (cancelBtn) cancelBtn.onclick = () => {
            this.app.currentView = 'contacts';
            this.app.render();
        };

        let isDeleting = false;
        const confirmBtn = currentView.querySelector('#confirm-delete-contact');
        if (confirmBtn) confirmBtn.onclick = () => {
            if (isDeleting) return;
            isDeleting = true;

            const contact = this.app.wechatData.getContact(contactId);
            const oldReferenceImage = String(contact?.naiReferenceImage || contact?.referenceImage || '').trim();
            this.app.wechatData.deleteContactAndChat(contactId);
            if (oldReferenceImage) {
                window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(oldReferenceImage, { quiet: true, skipIfReferenced: true })?.catch?.(() => {});
            }
            this.app.phoneShell.showNotification('已删除', `${contactName} 及相关聊天已删除`, '✅');

            setTimeout(() => {
                this.app.currentView = 'contacts';
                this.app.render();
                isDeleting = false;
            }, 500);
        };
    }

    scrollToLetter(letter) {
        const contactsList = document.querySelector('.contacts-list');
        const groups = document.querySelectorAll('.group-letter');

        for (const group of groups) {
            if (group.textContent.trim() === letter) {
                const targetTop = group.offsetTop - contactsList.offsetTop;
                contactsList.scrollTo({
                    top: targetTop,
                    behavior: 'smooth'
                });
                break;
            }
        }
    }

    openContactChat(contactId) {
        const contact = this.app.wechatData.getContact(contactId);
        if (contact) {
            let chat = this.app.wechatData.getChatByContactId(contactId);

            if (!chat) {
                chat = this.app.wechatData.createChat({
                    id: `chat_${contactId}`,
                    contactId: contactId,
                    name: contact.name,
                    type: 'single',
                    avatar: contact.avatar
                });
            }

            this.app.currentChat = chat;
            this.app.render();
        }
    }

    bindGroupChatItems() {
        document.querySelectorAll('.contact-group-item').forEach(item => {
            item.onclick = () => {
                const chatId = item.dataset.chatId;
                this.openGroupChat(chatId);
            };
        });
    }

    toggleGroupSection() {
        this.groupsCollapsed = !this.groupsCollapsed;
        const groupSection = document.querySelector('.contacts-group[data-section="groups"]');
        if (!groupSection) return;
        groupSection.innerHTML = this.groupsCollapsed ? '' : this.renderGroupChatRows();
        this.bindGroupChatItems();
    }

    openGroupChat(chatId) {
        const chat = this.app.wechatData.getChat(chatId);
        if (chat && chat.type === 'group') {
            this.app.currentView = 'chats';
            this.app.currentChat = chat;
            this.app.wechatData.getMessages(chat.id);
            this.app.render();
        }
    }

    handleFunction(func) {
        switch (func) {
            case 'new-friends':
                this.showAddFriendPage();
                break;
            case 'groups':
                this.toggleGroupSection();
                break;
        }
    }

    scrollToGroupSection() {
        const contactsList = document.querySelector('.contacts-scrollable');
        const groupSection = document.querySelector('.contacts-group[data-section="groups"]');
        if (!contactsList || !groupSection) return;
        contactsList.scrollTo({
            top: Math.max(0, groupSection.offsetTop - contactsList.offsetTop),
            behavior: 'smooth'
        });
    }

    showAddFriendPage() {
        const html = `
            <div class="wechat-app">
                <div class="wechat-header">
                    <div class="wechat-header-left">
                        <button class="wechat-back-btn" id="back-from-add-friend">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>
                    <div class="wechat-header-title">添加好友</div>
                    <div class="wechat-header-right"></div>
                </div>
                
                <div class="wechat-content" style="background: #ededed; padding: 12px;">
                    <div style="background: #fff; border-radius: 10px; padding: 14px; margin-bottom: 10px;">
                        <div style="font-size: 12px; color: #999; margin-bottom: 10px;">
                            <i class="fa-solid fa-user-plus"></i> 填写好友信息
                        </div>

                        <div style="text-align: center; margin-bottom: 12px;">
                            <div id="friend-avatar-preview" style="
                                width: 52px;
                                height: 52px;
                                border-radius: 8px;
                                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                margin: 0 auto 8px;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                font-size: 26px;
                                cursor: pointer;
                            ">👤</div>
                            <input type="file" id="friend-avatar-upload" accept="image/png, image/jpeg, image/gif, image/webp, image/*" style="display: none;">
                            <button id="upload-friend-avatar" style="
                                padding: 4px 10px;
                                background: #f0f0f0;
                                border: none;
                                border-radius: 4px;
                                font-size: 11px;
                                cursor: pointer;
                            ">
                                <i class="fa-solid fa-camera"></i> 选择头像
                            </button>
                        </div>

                        <div style="margin-bottom: 10px;">
                            <div style="font-size: 11px; color: #999; margin-bottom: 4px;">好友昵称 *</div>
                            <input type="text" id="friend-name-input" placeholder="输入好友昵称" maxlength="20" style="
                                width: 100%;
                                padding: 8px;
                                border: 1px solid #e5e5e5;
                                border-radius: 6px;
                                font-size: 13px;
                                box-sizing: border-box;
                            ">
                        </div>

                        <div style="margin-bottom: 10px;">
                            <div style="font-size: 11px; color: #999; margin-bottom: 4px;">性别（用于默认头像池）</div>
                            <select id="friend-gender-select" style="
                                width: 100%;
                                padding: 8px;
                                border: 1px solid #e5e5e5;
                                border-radius: 6px;
                                font-size: 13px;
                                background: #fff;
                                box-sizing: border-box;
                            ">
                                <option value="unknown">未知</option>
                                <option value="female">女</option>
                                <option value="male">男</option>
                            </select>
                        </div>

                        <div style="margin-bottom: 10px;">
                            <div style="font-size: 11px; color: #999; margin-bottom: 4px;">默认头像类型</div>
                            <select id="friend-avatar-group-select" style="
                                width: 100%;
                                padding: 8px;
                                border: 1px solid #e5e5e5;
                                border-radius: 6px;
                                font-size: 13px;
                                background: #fff;
                                box-sizing: border-box;
                            ">
                                <option value="">跟随性别</option>
                                <option value="female">普通女</option>
                                <option value="male">普通男</option>
                                <option value="female_elder">年长女</option>
                                <option value="male_elder">年长男</option>
                            </select>
                        </div>

                        <div style="font-size: 11px; color: #999;">
                            备注请直接写在昵称里（例如：张三（同事））
                        </div>
                    </div>

                    <button id="save-friend-btn" style="
                        width: 100%;
                        padding: 10px;
                        background: #07c160;
                        color: #fff;
                        border: none;
                        border-radius: 8px;
                        font-size: 16px;
                        font-weight: 500;
                        cursor: pointer;
                    ">添加好友</button>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html);

        let selectedAvatar = '';
        const currentView = document.querySelector('.phone-view-current') || document;

        const backBtn = currentView.querySelector('#back-from-add-friend');
        if (backBtn) backBtn.onclick = () => {
            this.app.currentView = 'contacts';
            this.app.render();
        };

        const uploadBtn = currentView.querySelector('#upload-friend-avatar');
        if (uploadBtn) uploadBtn.onclick = () => {
            currentView.querySelector('#friend-avatar-upload').click();
        };

        const fileInput = currentView.querySelector('#friend-avatar-upload');
        if (fileInput) fileInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            e.target.value = '';

            if (file.size > 5 * 1024 * 1024) {
                this.app.phoneShell.showNotification('提示', '图片太大，请选择小于5MB的图片', '⚠️');
                return;
            }

            try {
                const cropper = new ImageCropper({
                    title: '裁剪好友头像',
                    aspectRatio: 1,
                    outputWidth: 512,
                    outputHeight: 512,
                    quality: 0.92,
                    maxFileSize: 5 * 1024 * 1024
                });
                const croppedImage = await cropper.open(file);

                const preview = currentView.querySelector('#friend-avatar-preview');
                if (preview) {
                    preview.innerHTML = `<img src="${croppedImage}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">`;
                }

                this.app.phoneShell.showNotification('处理中', '正在上传头像...', '⏳');
                selectedAvatar = await window.VirtualPhone?.imageManager?.uploadDataUrl?.(croppedImage, 'friend_avatar');
                if (!selectedAvatar) throw new Error('图片上传管理器未初始化');
                this.app.phoneShell.showNotification('成功', '头像已上传', '✅');
            } catch (err) {
                if (String(err?.message || '') === '用户取消') return;
                console.warn('好友头像上传失败:', err);
                this.app.phoneShell.showNotification('上传失败', err?.message || '头像上传失败', '❌');
            }
        };

        let isSaving = false;
        const saveBtn = currentView.querySelector('#save-friend-btn');
        if (saveBtn) saveBtn.onclick = async () => {
            if (isSaving) return;

            const name = currentView.querySelector('#friend-name-input').value.trim();

            if (!name) {
                this.app.phoneShell.showNotification('提示', '请输入好友昵称', '⚠️');
                return;
            }

            const nextNameKey = this.app.wechatData._normalizeExactContactName?.(name) || String(name || '').trim().replace(/\s+/g, '').toLowerCase();
            const exists = this.app.wechatData.getContacts().find(c =>
                (this.app.wechatData._normalizeExactContactName?.(c.name) || String(c?.name || '').trim().replace(/\s+/g, '').toLowerCase()) === nextNameKey
            );
            if (exists) {
                this.app.phoneShell.showNotification('提示', '该好友已存在', '⚠️');
                return;
            }

            isSaving = true;
            const gender = String(currentView.querySelector('#friend-gender-select')?.value || 'unknown').trim();
            const avatarGroup = String(currentView.querySelector('#friend-avatar-group-select')?.value || '').trim();

            const newContactId = `contact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const createdContact = this.app.wechatData.addContact({
                id: newContactId,
                name: name,
                avatar: selectedAvatar,
                gender,
                letter: this.app.wechatData.getFirstLetter(name)
            }) || { id: newContactId, name, avatar: selectedAvatar };

            this.app.wechatData.setContactGender?.(createdContact.id || name, gender);
            this.app.wechatData.setContactAvatarGroup?.(createdContact.id || name, avatarGroup);
            if (selectedAvatar) {
                this.app.wechatData.syncContactAvatar(createdContact.id || name, selectedAvatar);
            } else {
                await this.app._ensureWechatAvatarPoolLoaded?.();
                const autoAvatar = this.app._resolveAutoAvatarForName?.(createdContact.name || name, gender, avatarGroup);
                if (autoAvatar) {
                    this.app.wechatData.setContactAutoAvatar?.(createdContact.id || name, autoAvatar);
                }
            }
            this.app.phoneShell.showNotification('添加成功', `已添加好友：${createdContact.name || name}`, '✅');

            setTimeout(() => {
                this.app.currentView = 'contacts';
                this.app.render();
                isSaving = false;
            }, 1000);
        };
    }

    showCreateGroupPage() {
        const contacts = this.app.wechatData.getContacts();

        const html = `
            <div class="wechat-app">
                <div class="wechat-header">
                    <div class="wechat-header-left">
                        <button class="wechat-back-btn" id="back-from-create-group">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>
                    <div class="wechat-header-title">
                        选择联系人 (<span id="selected-count">0</span>)
                    </div>
                    <div class="wechat-header-right">
                        <button class="wechat-header-btn" id="create-group-btn" style="color: #07c160; font-size: 14px; font-weight: 500;">
                            下一步
                        </button>
                    </div>
                </div>
                
                <div class="wechat-content" style="background: #ededed;">
                    <!-- 已选择的成员 -->
                    <div id="selected-members" style="
                        background: #fff;
                        padding: 12px 15px;
                        border-bottom: 0.5px solid #e5e5e5;
                        display: none;
                        flex-wrap: wrap;
                        gap: 10px;
                    "></div>
                    
                    <!-- 联系人列表 -->
                    <div style="background: #fff; padding: 10px 0;">
                        ${contacts.map(contact => `
                            <div class="group-contact-item" data-contact-id="${contact.id}" style="
                                display: flex;
                                align-items: center;
                                padding: 10px 15px;
                                cursor: pointer;
                                transition: background 0.2s;
                            ">
                                <input type="checkbox" class="contact-checkbox wechat-force-checkbox" data-contact-name="${contact.name}" data-contact-avatar="${this.escapeAttr(contact.avatar)}" style="
                                    -webkit-appearance: checkbox !important;
                                    appearance: auto !important;
                                    opacity: 1 !important;
                                    visibility: visible !important;
                                    display: inline-block !important;
                                    position: relative !important;
                                    pointer-events: auto !important;
                                    accent-color: #30c46b !important;
                                    width: 20px !important;
                                    height: 20px !important;
                                    min-width: 20px !important;
                                    min-height: 20px !important;
                                    margin-right: 12px !important;
                                    cursor: pointer !important;
                                    box-sizing: border-box !important;
                                    filter: none !important;
                                ">
                                <div style="
                                    width: 44px;
                                    height: 44px;
                                    border-radius: 50%;
                                    background: #fff;
                                    border: 1px solid #d8d8d8;
                                    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    font-size: 22px;
                                    margin-right: 12px;
                                    overflow: hidden;
                                ">${this.app.renderAvatar(contact.avatar, '👤', contact.name)}</div>
                                <div style="flex: 1;">
                                    <div style="font-size: 16px; color: #000;">${contact.name}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html);

        const currentView = document.querySelector('.phone-view-current') || document;
        const selectedMembers = new Map();
        const self = this;

        const backBtn = currentView.querySelector('#back-from-create-group');
        if (backBtn) backBtn.onclick = () => {
            this.app.currentView = 'contacts';
            this.app.render();
        };

        currentView.querySelectorAll('.contact-checkbox').forEach(checkbox => {
            checkbox.style.setProperty('-webkit-appearance', 'checkbox', 'important');
            checkbox.style.setProperty('appearance', 'auto', 'important');
            checkbox.style.setProperty('opacity', '1', 'important');
            checkbox.style.setProperty('visibility', 'visible', 'important');
            checkbox.style.setProperty('display', 'inline-block', 'important');
            checkbox.style.setProperty('position', 'relative', 'important');
            checkbox.style.setProperty('pointer-events', 'auto', 'important');
            checkbox.style.setProperty('accent-color', '#30c46b', 'important');
            checkbox.style.setProperty('width', '20px', 'important');
            checkbox.style.setProperty('height', '20px', 'important');
            checkbox.style.setProperty('min-width', '20px', 'important');
            checkbox.style.setProperty('min-height', '20px', 'important');
            checkbox.onchange = (e) => {
                const name = e.target.dataset.contactName;
                const avatarEncoded = e.target.dataset.contactAvatar;
                const avatar = self.decodeAttr(avatarEncoded);

                if (e.target.checked) {
                    selectedMembers.set(name, avatar);
                } else {
                    selectedMembers.delete(name);
                }

                updateSelectedUI();
            };
        });

        function updateSelectedUI() {
            const countSpan = currentView.querySelector('#selected-count');
            const selectedDiv = currentView.querySelector('#selected-members');

            if (!countSpan || !selectedDiv) return;

            countSpan.textContent = selectedMembers.size;

            if (selectedMembers.size > 0) {
                selectedDiv.style.display = 'flex';
                selectedDiv.innerHTML = Array.from(selectedMembers.entries()).map(([name, avatar]) => `
                    <div style="
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        width: 60px;
                    ">
                        <div style="
                            width: 48px;
                            height: 48px;
                            border-radius: 50%;
                            background: #fff;
                            border: 1px solid #d8d8d8;
                            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 24px;
                            margin-bottom: 4px;
                            overflow: hidden;
                        ">${self.app.renderAvatar(avatar, '👤', name)}</div>
                        <div style="font-size: 11px; color: #666; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60px;">
                            ${name}
                        </div>
                    </div>
                `).join('');
            } else {
                selectedDiv.style.display = 'none';
            }
        }

        const createGroupBtn = currentView.querySelector('#create-group-btn');
        if (createGroupBtn) createGroupBtn.onclick = () => {
            if (selectedMembers.size === 0) {
                this.app.phoneShell.showNotification('提示', '请至少选择1个联系人', '⚠️');
                return;
            }

            this.showGroupNameInput(Array.from(selectedMembers.entries()));
        };
    }

    showGroupNameInput(members) {
        const defaultName = members.slice(0, 3).map(([name]) => name).join('、') + (members.length > 3 ? '...' : '');

        const html = `
            <div class="wechat-app">
                <div class="wechat-header">
                    <div class="wechat-header-left">
                        <button class="wechat-back-btn" id="back-from-group-name">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>
                    <div class="wechat-header-title">设置群聊名称</div>
                    <div class="wechat-header-right"></div>
                </div>
                
                <div class="wechat-content" style="background: #ededed; padding: 20px;">
                    <div style="background: #fff; border-radius: 12px; padding: 25px;">
                        <div style="font-size: 14px; color: #999; margin-bottom: 12px;">群聊名称</div>
                        <input type="text" id="group-name-input" placeholder="输入群聊名称" 
                               value="${defaultName}" maxlength="30" style="
                            width: 100%;
                            padding: 12px;
                            border: 1.5px solid #e5e5e5;
                            border-radius: 8px;
                            font-size: 15px;
                            box-sizing: border-box;
                            margin-bottom: 15px;
                        ">
                        
                        <div style="font-size: 12px; color: #999; margin-bottom: 20px;">
                            成员：${members.map(([name]) => name).join('、')} (共${members.length}人)
                        </div>
                        
                        <button id="confirm-create-group" style="
                            width: 100%;
                            padding: 14px;
                            background: #07c160;
                            color: #fff;
                            border: none;
                            border-radius: 8px;
                            font-size: 16px;
                            font-weight: 500;
                            cursor: pointer;
                        ">创建群聊</button>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html);

        const currentView = document.querySelector('.phone-view-current') || document;
        let isCreating = false;

        const backBtn = currentView.querySelector('#back-from-group-name');
        if (backBtn) backBtn.onclick = () => {
            this.showCreateGroupPage();
        };

        const confirmBtn = currentView.querySelector('#confirm-create-group');
        if (confirmBtn) confirmBtn.onclick = () => {
            if (isCreating) return;

            const groupNameInput = currentView.querySelector('#group-name-input');
            if (!groupNameInput) return;
            const groupName = groupNameInput.value.trim();

            if (!groupName) {
                this.app.phoneShell.showNotification('提示', '请输入群聊名称', '⚠️');
                return;
            }

            isCreating = true;

            const group = this.app.wechatData.createGroupChat({
                name: groupName,
                avatar: '👥',
                members: members.map(([name]) => name)
            });

            this.app.phoneShell.showNotification('创建成功', `已创建群聊：${groupName}`, '✅');

            setTimeout(() => {
                this.app.currentChat = group;
                this.app.currentView = 'chats';
                this.app.render();
                isCreating = false;
            }, 1000);
        };
    }
}
