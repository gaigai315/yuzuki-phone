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
    }

    render() {
        const contacts = this.app.wechatData.getContacts();
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
                            <div class="function-name">群聊</div>
                        </div>
                    </div>
                    
                    <!-- 联系人列表 -->
                    <div class="contacts-list">
                        ${Object.keys(grouped).sort().map(letter => `
                            <div class="contacts-group">
                                <div class="group-letter">${letter}</div>
                                ${grouped[letter].map(contact => `
                                    <div class="contact-item" data-contact-id="${contact.id}">
                                        <div class="contact-avatar">
                                            ${this.app.renderAvatar(contact.avatar, '👤', contact.name)}
                                        </div>
                                        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex:1; min-width:0;">
                                            <div class="contact-name" style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${contact.name}</div>
                                            ${contact.sourceApp === 'honey' || contact.sourceLabel === '蜜语'
                                                ? '<span style="flex-shrink:0; display:inline-flex; align-items:center; gap:4px; padding:2px 6px; margin-right:16px; border-radius:999px; background:rgba(255,105,180,0.14); color:#ff5fa2; font-size:10px; line-height:1; border:1px solid rgba(255,105,180,0.24);"><i class="fa-solid fa-heart" style="font-size:9px;"></i>蜜语</span>'
                                                : ''}
                                        </div>
                                    </div>
                                `).join('')}
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

        // 联系人点击和长按
        document.querySelectorAll('.contact-item').forEach(item => {
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
            e.stopPropagation();
            document.querySelectorAll('.contact-action-menu').forEach(menu => menu.remove());
            this.showEditContactPage(contactId);
        });

        element.querySelector('.contact-menu-item[data-action="delete"]')?.addEventListener('click', (e) => {
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

    showEditContactPage(contactId) {
        const contact = this.app.wechatData.getContact(contactId);
        if (!contact) return;

        const avatarHtml = this.app.renderAvatar(contact.avatar, '👤', contact.name);

        const html = `
            <div class="wechat-app">
                <div class="wechat-header">
                    <div class="wechat-header-left">
                        <button class="wechat-back-btn" id="back-from-edit-contact">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>
                    <div class="wechat-header-title">编辑联系人</div>
                    <div class="wechat-header-right"></div>
                </div>

                <div class="wechat-content" style="background: #ededed; padding: 12px;">
                    <div style="background: #fff; border-radius: 10px; padding: 15px; margin-bottom: 10px;">
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
                                background: #f0f0f0;
                                border: none;
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
                                border: 1px solid #e5e5e5;
                                border-radius: 6px;
                                font-size: 13px;
                                box-sizing: border-box;
                                margin-bottom: 6px;
                            ">
                            <div style="font-size: 11px; color: #999;">备注请直接写在昵称里（例如：张三（同事））</div>
                        </div>

                        <!-- 🔥 新增：专属音色绑定 -->
                        <div style="margin-top: 15px; border-top: 1px solid #f0f0f0; padding-top: 15px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <div style="font-size: 12px; color: #000; font-weight: 500;">🎙️ 专属语音音色</div>
                               <!-- 获取历史音色记录（终极兼容版） -->
                                <select id="edit-contact-tts-select" style="border:none; background:#f5f5f5; border-radius:4px; font-size:11px; padding:2px 4px; color:#666; outline:none; max-width: 100px;">
                                    <option value="">-- 历史音色 --</option>
                                    ${(() => {
                                        try {
                                            const store = this.app.storage;
                                            // 兼容不同的命名习惯（横杠或下划线）
                                            let raw = store.get('phone-tts-voice-history') || store.get('phone_tts_voice_history');
                                            if (!raw) return '';
                                            
                                            let historyList = [];
                                            // 兼容数据格式：可能是 JSON 数组，也可能是逗号分隔的字符串
                                            if (typeof raw === 'string') {
                                                if (raw.startsWith('[')) {
                                                    historyList = JSON.parse(raw);
                                                } else {
                                                    historyList = raw.split(',').map(s => s.trim()).filter(Boolean);
                                                }
                                            } else if (Array.isArray(raw)) {
                                                historyList = raw;
                                            }
                                            // 去重并生成选项
                                            return [...new Set(historyList)].map(v => `<option value="${v}">${v}</option>`).join('');
                                        } catch(e) { 
                                            console.warn('读取音色历史失败:', e);
                                            return ''; 
                                        }
                                    })()}
                                </select>
                            </div>
                            <input type="text" id="edit-contact-tts-input" placeholder="请填入 TTS Voice ID"
                                   value="${contact.ttsVoice || ''}" style="
                                width: 100%;
                                padding: 8px 10px;
                                border: 1px solid #e5e5e5;
                                border-radius: 6px;
                                font-size: 13px;
                                box-sizing: border-box;
                            ">
                            <div style="font-size: 10px; color: #ff3b30; margin-top: 4px;">未绑定音色时，该角色将无法发送/接听语音及视频通话。</div>
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

        this.app.phoneShell.setContent(html);

        let selectedAvatar = contact.avatar;

        document.getElementById('back-from-edit-contact')?.addEventListener('click', () => {
            this.app.currentView = 'contacts';
            this.app.render();
        });

        // 🔥 下拉框选择后，自动把选中的音色填入输入框
        document.getElementById('edit-contact-tts-select')?.addEventListener('change', (e) => {
            const selectedVoice = e.target.value;
            if (selectedVoice) {
                document.getElementById('edit-contact-tts-input').value = selectedVoice;
            }
        });

        document.getElementById('upload-edit-contact-avatar')?.addEventListener('click', () => {
            document.getElementById('edit-contact-avatar-upload').click();
        });

        document.getElementById('edit-contact-avatar-upload')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            e.target.value = '';

            if (file.size > 2 * 1024 * 1024) {
                this.app.phoneShell.showNotification('提示', '图片太大，请选择小于2MB的图片', '⚠️');
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

                selectedAvatar = croppedImage;
                const preview = document.getElementById('edit-contact-avatar-preview');
                if (preview) {
                    preview.innerHTML = `<img src="${selectedAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
                }

                this.app.phoneShell.showNotification('处理中', '正在上传头像...', '⏳');
                const formData = new FormData();
                const imgResp = await fetch(croppedImage);
                const blob = await imgResp.blob();
                const ext = blob.type === 'image/png' ? 'png' : 'jpg';
                const filename = `phone_contact_${Date.now()}.${ext}`;
                formData.append('avatar', blob, filename);

                const headers = typeof window.getRequestHeaders === 'function' ? window.getRequestHeaders() : {};
                delete headers['Content-Type']; // 🔥 加在这里！
                if (!headers['X-CSRF-Token']) {
                    const csrfResp = await fetch('/csrf-token');
                    if (csrfResp.ok) headers['X-CSRF-Token'] = (await csrfResp.json()).token;
                }
                const uploadResp = await fetch('/api/backgrounds/upload', { method: 'POST', body: formData, headers });
                if (uploadResp.ok) {
                    selectedAvatar = `/backgrounds/${filename}`; // 覆盖为服务器真实路径
                    this.app.phoneShell.showNotification('成功', '头像已上传', '✅');
                }
            } catch (err) {
                if (String(err?.message || '') === '用户取消') return;
                console.warn('头像上传服务器失败，使用本地降级:', err);
            }
        });

        document.getElementById('save-edit-contact-btn')?.addEventListener('click', () => {
            const name = document.getElementById('edit-contact-name-input').value.trim();

            if (!name) {
                this.app.phoneShell.showNotification('提示', '请输入昵称', '⚠️');
                return;
            }

            const exists = this.app.wechatData.getContacts().find(c => c.name === name && c.id !== contactId);
            if (exists) {
                this.app.phoneShell.showNotification('提示', '该名称已被其他联系人使用', '⚠️');
                return;
            }

            // 🔥 新增：读取音色 ID
            const ttsVoice = document.getElementById('edit-contact-tts-input').value.trim();

            this.app.wechatData.updateContact(contactId, {
                name: name,
                avatar: selectedAvatar,
                letter: this.app.wechatData.getFirstLetter(name),
                ttsVoice: ttsVoice // 🔥 保存音色
            });

            this.app.wechatData.syncContactAvatar(contactId, selectedAvatar);
            this.app.phoneShell.showNotification('保存成功', '联系人信息已更新', '✅');

            setTimeout(() => {
                this.app.currentView = 'contacts';
                this.app.render();
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

            this.app.wechatData.deleteContactAndChat(contactId);
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

    handleFunction(func) {
        switch (func) {
            case 'new-friends':
                this.showAddFriendPage();
                break;
            case 'groups':
                this.showCreateGroupPage();
                break;
        }
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

        let selectedAvatar = '👤';
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

            if (file.size > 2 * 1024 * 1024) {
                this.app.phoneShell.showNotification('提示', '图片太大，请选择小于2MB的图片', '⚠️');
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

                selectedAvatar = croppedImage;
                const preview = currentView.querySelector('#friend-avatar-preview');
                if (preview) {
                    preview.innerHTML = `<img src="${selectedAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">`;
                }

                this.app.phoneShell.showNotification('处理中', '正在上传头像...', '⏳');
                const formData = new FormData();
                const imgResp = await fetch(croppedImage);
                const blob = await imgResp.blob();
                const ext = blob.type === 'image/png' ? 'png' : 'jpg';
                const filename = `phone_friend_${Date.now()}.${ext}`;
                formData.append('avatar', blob, filename);

                const headers = typeof window.getRequestHeaders === 'function' ? window.getRequestHeaders() : {};
                delete headers['Content-Type']; // 🔥 加在这里！
                if (!headers['X-CSRF-Token']) {
                    const csrfResp = await fetch('/csrf-token');
                    if (csrfResp.ok) headers['X-CSRF-Token'] = (await csrfResp.json()).token;
                }
                const uploadResp = await fetch('/api/backgrounds/upload', { method: 'POST', body: formData, headers });
                if (uploadResp.ok) {
                    selectedAvatar = `/backgrounds/${filename}`;
                    this.app.phoneShell.showNotification('成功', '头像已上传', '✅');
                }
            } catch (err) {
                if (String(err?.message || '') === '用户取消') return;
                console.warn('好友头像上传失败:', err);
            }
        };

        let isSaving = false;
        const saveBtn = currentView.querySelector('#save-friend-btn');
        if (saveBtn) saveBtn.onclick = () => {
            if (isSaving) return;

            const name = currentView.querySelector('#friend-name-input').value.trim();

            if (!name) {
                this.app.phoneShell.showNotification('提示', '请输入好友昵称', '⚠️');
                return;
            }

            const exists = this.app.wechatData.getContacts().find(c => c.name === name);
            if (exists) {
                this.app.phoneShell.showNotification('提示', '该好友已存在', '⚠️');
                return;
            }

            isSaving = true;

            const newContactId = `contact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            this.app.wechatData.addContact({
                id: newContactId,
                name: name,
                avatar: selectedAvatar,
                letter: this.app.wechatData.getFirstLetter(name)
            });

            this.app.wechatData.syncContactAvatar(name, selectedAvatar);
            this.app.phoneShell.showNotification('添加成功', `已添加好友：${name}`, '✅');

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
                                <input type="checkbox" class="contact-checkbox" data-contact-name="${contact.name}" data-contact-avatar="${this.escapeAttr(contact.avatar)}" style="
                                    width: 20px;
                                    height: 20px;
                                    margin-right: 12px;
                                    cursor: pointer;
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
