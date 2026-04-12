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
import { ImageCropper } from '../settings/image-cropper.js';
import { applyPhoneTagFilter } from '../../config/tag-filter.js';

// 朋友圈视图 - 高仿微信版
export class MomentsView {
    constructor(wechatApp) {
        this.app = wechatApp;
        this.isLoading = false;
        this.newPostText = '';
        this.currentCommentMomentId = null;
        this.currentReplyTo = null;
    }

    // 在wechat-app的renderDiscover中调用
    renderMomentsPage() {
        const moments = this.app.wechatData.getMoments();
        const userInfo = this.app.wechatData.getUserInfo();
        const bgImage = userInfo.momentsBackground;

        return `
            <div class="moments-page" style="overscroll-behavior: none; ${bgImage ? `background-image: url('${bgImage}'); background-size: cover; background-position: center;` : 'background: #fff;'}">
                <!-- 🔥 背景图上传（隐藏的input） -->
                <input type="file" id="moments-bg-upload" accept="image/png, image/jpeg, image/gif, image/webp, image/*" style="display: none;">

                <!-- 朋友圈列表 - 有背景图时透明，无背景图时白色 -->
                <div class="moments-feed" style="background: ${bgImage ? 'transparent' : '#fff'};">
                    ${moments.length === 0 ? `
                        <div class="moments-empty-tip" style="${bgImage ? 'background: rgba(255,255,255,0.8); border-radius: 12px; margin: 20px;' : ''}">
                            <p>朋友圈空空如也</p>
                            <p class="tip-sub">点击右上角刷新加载朋友圈</p>
                        </div>
                    ` : moments.map(moment => this.renderMomentItem(moment, !!bgImage)).join('')}
                </div>
            </div>
        `;
    }

    // 渲染单条朋友圈
    renderMomentItem(moment, hasBgImage = false) {
        const timeStr = this.formatTime(moment.timestamp || moment.time);
        // 🔥 优先实时从联系人/聊天获取头像，确保头像同步更新
        const contactAvatar = this.getContactAvatar(moment.name) || moment.avatar || '👤';

        // 🔥 有背景图时，给每条朋友圈添加毛玻璃效果，让背景透出来
        // 使用 rgba 白色背景作为降级方案，确保移动端兼容
        const itemStyle = hasBgImage ? 'background: rgba(255,255,255,0.75); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); margin: 8px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);' : '';

        return `
            <div class="moment-item" data-moment-id="${moment.id}" style="${itemStyle}">
                <!-- 头像 -->
                <div class="moment-avatar-col">
                    ${this.app.renderAvatar(contactAvatar, '👤', moment.name)}
                </div>

                <!-- 内容区 -->
                <div class="moment-content-col">
                    <!-- 发布者名字 -->
                    <div class="moment-author">${moment.name}</div>

                    <!-- 文字内容 -->
                    ${moment.text ? `<div class="moment-text">${moment.text}</div>` : ''}

                    <!-- 图片 -->
                    ${this.renderImages(moment.images)}

                    <!-- 底部：时间 + 操作 -->
                    <div class="moment-footer">
                        <span class="moment-time">${timeStr}</span>
                        <div class="moment-action-btn" data-moment-id="${moment.id}">
                            <i class="fa-solid fa-ellipsis"></i>
                        </div>
                    </div>

                    <!-- 点赞和评论区 -->
                    ${this.renderInteractions(moment)}
                </div>
            </div>
        `;
    }

    // 渲染图片
    renderImages(images) {
        if (!images || images.length === 0) return '';

        const gridClass = images.length === 1 ? 'single' :
                         images.length === 2 ? 'double' :
                         images.length === 4 ? 'quad' : 'grid';

        return `
            <div class="moment-images ${gridClass}">
                ${images.map(img => `
                    <div class="moment-img-wrapper">
                        ${img.startsWith?.('data:') || img.startsWith?.('http') || img.startsWith?.('/')
                            ? `<img src="${img}" class="moment-img">`
                            : `<div class="moment-img-placeholder">${img}</div>`
                        }
                    </div>
                `).join('')}
            </div>
        `;
    }

    // 渲染互动区（点赞+评论）
    renderInteractions(moment) {
        const hasLikes = moment.likeList && moment.likeList.length > 0;
        const hasComments = moment.commentList && moment.commentList.length > 0;

        if (!hasLikes && !hasComments) return '';

        return `
            <div class="moment-interactions">
                ${hasLikes ? `
                    <div class="interaction-likes">
                        <i class="fa-solid fa-heart"></i>
                        <span class="like-names">${moment.likeList.join('，')}</span>
                    </div>
                ` : ''}

                ${hasComments ? `
                    <div class="interaction-comments">
                        ${moment.commentList.map((comment, idx) => `
                            <div class="comment-row" data-moment-id="${moment.id}" data-comment-idx="${idx}" data-author="${comment.name}">
                                <span class="comment-author">${comment.name}</span>
                                ${comment.replyTo ? `<span class="comment-reply">回复</span><span class="comment-author">${comment.replyTo}</span>` : ''}
                                <span class="comment-colon">：</span>
                                <span class="comment-content">${comment.text}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    // 绑定朋友圈事件
    bindMomentsEvents() {
        // 🔥 禁止下拉刷新/拖拽
        const momentsPage = document.querySelector('.moments-page');
        if (momentsPage) {
            momentsPage.style.overscrollBehavior = 'none';
        }

        // 刷新按钮（在顶部栏）
        document.getElementById('moments-refresh')?.addEventListener('click', () => {
            this.loadMomentsFromAI();
        });

        // 🔥 背景图上传事件 - 支持裁剪
        document.getElementById('moments-bg-upload')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // 重置input，允许重复选择同一文件
            e.target.value = '';

            try {
                const cropper = new ImageCropper({
                    title: '裁剪背景图',
                    outputWidth: 1080,
                    outputHeight: 1920,
                    quality: 0.9,
                    maxFileSize: 5 * 1024 * 1024
                });

                const croppedImage = await cropper.open(file);

                // 🔥 上传到服务端，避免 Base64 撑大存档
                let finalUrl = croppedImage;
                try {
                    const res = await fetch(croppedImage);
                    const blob = await res.blob();
                    const ext = blob.type === 'image/png' ? 'png' : 'jpg';
                    const filename = `phone_moments_bg_${Date.now()}.${ext}`;
                    const formData = new FormData();
                    formData.append('avatar', blob, filename);
                    const headers = typeof window.getRequestHeaders === 'function' ? window.getRequestHeaders() : {};
                    delete headers['Content-Type'];
                    if (!headers['X-CSRF-Token']) {
                        const csrfResp = await fetch('/csrf-token');
                        if (csrfResp.ok) headers['X-CSRF-Token'] = (await csrfResp.json()).token;
                    }
                    const uploadResp = await fetch('/api/backgrounds/upload', { method: 'POST', body: formData, headers });
                    if (uploadResp.ok) {
                        finalUrl = `/backgrounds/${filename}`;
                    }
                } catch (uploadErr) {
                    console.warn('[Moments] 背景上传服务端失败，使用本地兜底:', uploadErr);
                }

                const userInfo = this.app.wechatData.getUserInfo();
                userInfo.momentsBackground = finalUrl;
                this.app.wechatData.saveData();
                this.app.phoneShell.showNotification('成功', '朋友圈背景已更新', '✅');
                this.app.render();
            } catch (error) {
                if (error.message !== '用户取消') {
                    this.app.phoneShell.showNotification('提示', error.message, '⚠️');
                }
            }
        });

        // 🔥 顶部栏背景按钮点击
        document.getElementById('moments-bg-btn')?.addEventListener('click', () => {
            document.getElementById('moments-bg-upload')?.click();
        });

        // 操作按钮（点赞/评论弹窗）
        document.querySelectorAll('.moment-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const momentId = btn.dataset.momentId;
                this.showActionPopup(btn, momentId);
            });
        });

        // 点击评论可以回复（包括自己的评论，方便和其他NPC互动）
        document.querySelectorAll('.comment-row').forEach(row => {
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const momentId = row.dataset.momentId;
                const author = row.dataset.author;
                this.showCommentInput(momentId, author);
            });
        });

        // 🔥 点击其他区域移除内嵌输入框
        document.querySelector('.moments-page')?.addEventListener('click', (e) => {
            if (!e.target.closest('.inline-comment-box') &&
                !e.target.closest('.action-popup') &&
                !e.target.closest('.comment-row')) {
                document.querySelectorAll('.inline-comment-box').forEach(el => el.remove());
                this.currentCommentMomentId = null;
                this.currentReplyTo = null;
            }
        });
    }

    // 显示操作弹窗
    showActionPopup(btn, momentId) {
        // 🔥 检查当前按钮是否已有弹窗
        const existingPopup = btn.querySelector('.action-popup');

        // 移除所有弹窗
        document.querySelectorAll('.action-popup').forEach(p => p.remove());

        // 🔥 如果当前按钮已有弹窗，移除后直接返回（切换关闭）
        if (existingPopup) {
            return;
        }

        const moment = this.app.wechatData.getMoment(momentId);
        const userInfo = this.app.wechatData.getUserInfo();
        const isLiked = moment?.likeList?.includes(userInfo.name);

        const popup = document.createElement('div');
        popup.className = 'action-popup';
        popup.innerHTML = `
            <div class="action-popup-btn like-btn" data-moment-id="${momentId}">
                <i class="fa-solid fa-heart"></i>
                <span>${isLiked ? '取消' : '赞'}</span>
            </div>
            <div class="action-popup-btn comment-btn" data-moment-id="${momentId}">
                <i class="fa-solid fa-comment"></i>
                <span>评论</span>
            </div>
        `;

        // 🔥 直接添加到按钮内部（按钮已经是 position: relative）
        btn.appendChild(popup);

        // 点赞
        popup.querySelector('.like-btn')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.toggleLike(momentId);
            popup.remove();
        });

        // 评论
        popup.querySelector('.comment-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            popup.remove();
            this.showCommentInput(momentId);
        });

        // 点击外部关闭
        setTimeout(() => {
            document.addEventListener('click', function closePopup(e) {
                if (!popup.contains(e.target) && !btn.contains(e.target)) {
                    popup.remove();
                    document.removeEventListener('click', closePopup);
                }
            });
        }, 10);
    }

    // 点赞/取消点赞
    toggleLike(momentId) {
        const moment = this.app.wechatData.getMoment(momentId);
        if (!moment) return;

        const userInfo = this.app.wechatData.getUserInfo();
        if (!moment.likeList) moment.likeList = [];

        const index = moment.likeList.indexOf(userInfo.name);

        if (index === -1) {
            moment.likeList.push(userInfo.name);
        } else {
            moment.likeList.splice(index, 1);
        }

        moment.likes = moment.likeList.length;
        this.app.wechatData.saveData();

        // 🔥 局部更新点赞区域，不刷新整个页面
        this.updateMomentInteractions(momentId);
    }

    // 🔥 局部更新朋友圈互动区
    updateMomentInteractions(momentId) {
        const moment = this.app.wechatData.getMoment(momentId);
        if (!moment) return;

        const momentEl = document.querySelector(`.moment-item[data-moment-id="${momentId}"]`);
        if (!momentEl) return;

        // 🔥 保存滚动位置，防止页面跳动
        const momentsPage = document.querySelector('.moments-page');
        const scrollTop = momentsPage?.scrollTop || 0;

        // 找到或创建互动区
        let interactionsEl = momentEl.querySelector('.moment-interactions');
        const contentCol = momentEl.querySelector('.moment-content-col');

        const hasLikes = moment.likeList && moment.likeList.length > 0;
        const hasComments = moment.commentList && moment.commentList.length > 0;

        if (!hasLikes && !hasComments) {
            // 没有互动，移除互动区
            if (interactionsEl) interactionsEl.remove();
            // 🔥 恢复滚动位置
            if (momentsPage) momentsPage.scrollTop = scrollTop;
            return;
        }

        // 生成新的互动区HTML
        const newHtml = this.renderInteractions(moment);

        if (interactionsEl) {
            // 更新现有互动区
            interactionsEl.outerHTML = newHtml;
        } else {
            // 插入新互动区
            contentCol.insertAdjacentHTML('beforeend', newHtml);
        }

        // 🔥 恢复滚动位置
        if (momentsPage) momentsPage.scrollTop = scrollTop;

        // 重新绑定评论点击事件
        const newInteractionsEl = momentEl.querySelector('.moment-interactions');
        if (newInteractionsEl) {
            newInteractionsEl.querySelectorAll('.comment-row').forEach(row => {
                row.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const rowMomentId = row.dataset.momentId;
                    const author = row.dataset.author;
                    this.showCommentInput(rowMomentId, author);
                });
            });
        }
    }

    // 显示评论输入框（内嵌版）
    showCommentInput(momentId, replyTo = null) {
        const moment = this.app.wechatData.getMoment(momentId);
        if (!moment) {
            return;
        }

        // 先移除之前的输入框
        document.querySelectorAll('.inline-comment-box').forEach(el => el.remove());

        // 保存当前评论目标
        this.currentCommentMomentId = momentId;
        this.currentReplyTo = replyTo;

        // 找到对应的朋友圈元素
        const momentEl = document.querySelector(`.moment-item[data-moment-id="${momentId}"]`);
        if (!momentEl) return;

        // 找到互动区或创建一个
        let interactionsEl = momentEl.querySelector('.moment-interactions');
        if (!interactionsEl) {
            interactionsEl = document.createElement('div');
            interactionsEl.className = 'moment-interactions';
            momentEl.querySelector('.moment-content-col').appendChild(interactionsEl);
        }

        // 创建内嵌输入框
        const inputBox = document.createElement('div');
        inputBox.className = 'inline-comment-box';
        inputBox.innerHTML = `
            <input type="text" class="inline-comment-input" placeholder="${replyTo ? `回复 ${replyTo}` : '评论'}" autofocus>
            <button class="inline-comment-send"><i class="fa-solid fa-paper-plane"></i></button>
        `;
        interactionsEl.appendChild(inputBox);

        // 绑定事件
        const input = inputBox.querySelector('.inline-comment-input');
        const sendBtn = inputBox.querySelector('.inline-comment-send');

        input.focus();

        sendBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.submitInlineComment(input.value, inputBox);
        });

        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.stopPropagation();
                this.submitInlineComment(input.value, inputBox);
            }
        });

        input.addEventListener('click', (e) => e.stopPropagation());
        inputBox.addEventListener('click', (e) => e.stopPropagation());

        // 滚动到输入框可见
        inputBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // 提交内嵌评论
    submitInlineComment(text, inputBox) {
        const comment = text?.trim();
        if (!comment || !this.currentCommentMomentId) return;

        const moment = this.app.wechatData.getMoment(this.currentCommentMomentId);
        if (!moment) return;

        if (!moment.commentList) moment.commentList = [];

        const userInfo = this.app.wechatData.getUserInfo();
        moment.commentList.push({
            name: userInfo.name,
            text: comment,
            replyTo: this.currentReplyTo || null
        });

        moment.comments = moment.commentList.length;
        this.app.wechatData.saveData();

        // 保存用于AI回复
        const momentId = this.currentCommentMomentId;
        const replyTo = this.currentReplyTo;

        // 清空状态
        this.currentCommentMomentId = null;
        this.currentReplyTo = null;

        // 刷新界面
        this.app.render();

        // 触发AI回复
        this.triggerAIReaction(momentId, 'comment', comment, replyTo);
    }

    // 🔥 提交评论
    async submitComment() {
        const input = document.getElementById('moments-comment-input');
        const commentBar = document.getElementById('moments-comment-bar');
        const comment = input?.value?.trim();

        if (!comment || !this.currentCommentMomentId) return;

        const moment = this.app.wechatData.getMoment(this.currentCommentMomentId);
        if (!moment) return;

        if (!moment.commentList) moment.commentList = [];

        const userInfo = this.app.wechatData.getUserInfo();
        moment.commentList.push({
            name: userInfo.name,
            text: comment,
            replyTo: this.currentReplyTo || null
        });

        moment.comments = moment.commentList.length;
        this.app.wechatData.saveData();

        // 隐藏输入框
        if (commentBar) commentBar.style.display = 'none';

        // 保存momentId用于AI回复
        const momentId = this.currentCommentMomentId;
        const replyTo = this.currentReplyTo;

        // 清空状态
        this.currentCommentMomentId = null;
        this.currentReplyTo = null;

        // 刷新界面
        this.app.render();

        // 触发AI回复
        await this.triggerAIReaction(momentId, 'comment', comment, replyTo);
    }

    // 触发AI反应（回复评论、回赞等）
    async triggerAIReaction(momentId, actionType, userComment = '', replyTo = null) {
        const moment = this.app.wechatData.getMoment(momentId);
        if (!moment) return;

        const userInfo = this.app.wechatData.getUserInfo();

        // 构建提示词
        const prompt = `【朋友圈互动回复任务】

用户"${userInfo.name}"在朋友圈进行了互动，请生成合适的回复。

朋友圈信息：
- 发布者：${moment.name}
- 内容：${moment.text || '[图片]'}
- 现有点赞：${moment.likeList?.join('、') || '无'}
- 现有评论：${moment.commentList?.map(c => `${c.name}${c.replyTo ? '回复' + c.replyTo : ''}：${c.text}`).join('\n') || '无'}

用户行为：
- 类型：${actionType === 'like' ? '点赞' : '评论'}
${actionType === 'comment' ? `- 评论内容：${userComment}` : ''}
${replyTo ? `- 回复对象：${replyTo}` : ''}

请判断是否需要回复，以及由谁来回复：
1. 如果用户评论了，朋友圈发布者（${moment.name}）很可能会回复
2. 如果用户回复了某人，那个人可能会再回复
3. 其他人也可能参与互动
4. 也可以选择不回复（概率较小）

输出格式（只返回JSON）：
\`\`\`json
{
  "shouldReply": true,
  "reactions": [
    {
      "type": "comment",
      "name": "回复者名字",
      "text": "回复内容",
      "replyTo": "${userInfo.name}"
    }
  ]
}
\`\`\`

或者不回复：
\`\`\`json
{
  "shouldReply": false,
  "reactions": []
}
\`\`\`

请生成回复：`;

        try {
            this.app.phoneShell.showNotification('朋友圈', '对方正在输入...', '💬');

            const result = await this.callAI(prompt);

            if (result && result.shouldReply && result.reactions?.length > 0) {
                // 延迟添加回复，模拟真实感
                for (let i = 0; i < result.reactions.length; i++) {
                    const reaction = result.reactions[i];

                    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

                    if (reaction.type === 'comment' && reaction.text) {
                        if (!moment.commentList) moment.commentList = [];
                        moment.commentList.push({
                            name: reaction.name || moment.name,
                            text: reaction.text,
                            replyTo: reaction.replyTo || null
                        });
                        moment.comments = moment.commentList.length;
                    } else if (reaction.type === 'like' && reaction.name) {
                        if (!moment.likeList) moment.likeList = [];
                        if (!moment.likeList.includes(reaction.name)) {
                            moment.likeList.push(reaction.name);
                            moment.likes = moment.likeList.length;
                        }
                    }
                }

                this.app.wechatData.saveData();
                this.app.render();
                this.app.phoneShell.showNotification('朋友圈', '收到新回复', '💬');
            }
        } catch (error) {
            console.error('❌ AI回复失败:', error);
            // 静默失败，不打扰用户
        }
    }

    // 从AI加载朋友圈
    async loadMomentsFromAI() {
        if (this.isLoading) return;

        this.isLoading = true;
        this.app.phoneShell.showNotification('朋友圈', '正在加载...', '⏳');

        // 显示加载动画
        const refreshBtn = document.getElementById('moments-refresh');
        if (refreshBtn) {
            refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        }

        try {
            // 获取联系人列表
            const contacts = this.app.wechatData.getContacts();
            if (contacts.length === 0) {
                this.app.phoneShell.showNotification('提示', '请先添加联系人', '⚠️');
                this.isLoading = false;
                if (refreshBtn) refreshBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
                return;
            }

            // 获取朋友圈提示词
            const promptManager = window.VirtualPhone?.promptManager;
            let momentsPrompt = promptManager?.getPromptForFeature('wechat', 'moments') || '';

            // 获取时间
            const timeManager = window.VirtualPhone?.timeManager;
            const currentTime = timeManager?.getCurrentStoryTime?.() || { date: '2024年1月1日', time: '12:00' };

            // 🔥 获取SillyTavern上下文
            const context = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
                ? SillyTavern.getContext()
                : null;

            // 🔥 获取上下文楼层限制（与聊天一致）
            const storage = window.VirtualPhone?.storage;
            const contextLimit = storage ? (parseInt(storage.get('phone-context-limit')) || 10) : 10;

            // 🔥 收集角色卡信息（包括角色卡的系统提示词）
            let characterInfo = '';
            if (context && context.characterId !== undefined && context.characters?.[context.characterId]) {
                const char = context.characters[context.characterId];
                characterInfo = `【角色卡信息】
角色名：${char.name || '未知'}
${char.description ? `描述：${char.description.substring(0, 800)}` : ''}
${char.personality ? `性格：${char.personality}` : ''}
${char.scenario ? `场景/背景：${char.scenario}` : ''}
${char.data?.system_prompt ? `\n角色系统提示词：${char.data.system_prompt.substring(0, 500)}` : ''}
`;

                // 🔥 收集角色卡内置世界书（character_book）
                if (char.data?.character_book?.entries) {
                    const entries = char.data.character_book.entries;
                    if (entries.length > 0) {
                        characterInfo += '\n【角色书/世界书条目】\n';
                        entries.forEach((entry, idx) => {
                            if (entry.content && entry.enabled !== false && idx < 10) { // 最多10条
                                characterInfo += `${entry.content.substring(0, 300)}\n---\n`;
                            }
                        });
                    }
                }
            }

            // 🔥 收集用户卡信息（从DOM读取，与聊天一致）
            let userInfo = '';
            const userName = context?.name1 || '用户';
            const personaTextarea = document.getElementById('persona_description');
            if (personaTextarea && personaTextarea.value && personaTextarea.value.trim()) {
                userInfo = `【用户信息】
用户名：${userName}
用户设定：${personaTextarea.value.trim().substring(0, 500)}
`;
            } else {
                userInfo = `【用户信息】
用户名：${userName}
`;
            }

            // 🔥 收集记忆表格信息（如果Gaigai插件存在）
            let memoryInfo = '';
            if (window.Gaigai?.m?.s && Array.isArray(window.Gaigai.m.s)) {
                const memoryLines = [];
                window.Gaigai.m.s.forEach(section => {
                    if (section.r && section.r.length > 0) {
                        section.r.slice(0, 5).forEach(row => { // 每个section最多5条
                            const rowText = Object.values(row).join(' ').substring(0, 200);
                            if (rowText.trim()) {
                                memoryLines.push(rowText);
                            }
                        });
                    }
                });
                if (memoryLines.length > 0) {
                    memoryInfo = `【记忆信息】
${memoryLines.slice(0, 10).join('\n')}
`;
                }
            }

            // 🔥 收集最近聊天记录（使用上下文楼层限制）
            let chatHistory = '';
            if (context?.chat && Array.isArray(context.chat) && context.chat.length > 0) {
                const recentChat = context.chat.slice(-contextLimit);
                const chatLines = [];

                recentChat.forEach(msg => {
                    if (msg.mes && msg.mes.trim()) {
                        let content = msg.mes || msg.content || '';
                        content = applyPhoneTagFilter(content, { storage: this.app?.storage || window.VirtualPhone?.storage });
                        content = content.replace(/<[^>]*>/g, '').replace(/\*.*?\*/g, '').trim().substring(0, 200);

                        if (content.trim()) {
                            const speaker = msg.is_user ? userName : (context.name2 || '角色');
                            chatLines.push(`${speaker}: ${content}`);
                        }
                    }
                });

                if (chatLines.length > 0) {
                    chatHistory = `【最近剧情对话】（最近${chatLines.length}条）
${chatLines.join('\n')}
`;
                }
            }

            // 构建联系人信息
            const contactsInfo = contacts.map(c => `${c.name}(${c.relation || '好友'})`).join('、');

            // 构建完整提示词
            const prompt = `【朋友圈生成任务】

当前剧情时间：${currentTime.date} ${currentTime.time}

${characterInfo}
${userInfo}
${memoryInfo}
${chatHistory}

可用联系人列表：
${contactsInfo}

请根据以上角色设定、用户信息、记忆和剧情对话，为联系人生成符合当前故事情境的朋友圈动态。

要求：
1. 每个联系人生成0-1条朋友圈（根据角色性格决定是否发）
2. 内容要符合角色性格、当前剧情和世界观设定
3. 可以包含其他联系人的点赞和评论互动
4. 时间要在当前剧情时间之前（几分钟到几小时前）
5. 朋友圈内容要反映角色的日常生活、情感状态或与剧情相关的事件
6. 要参考最近的剧情对话，体现角色当前的状态

输出格式（只返回JSON）：
\`\`\`json
{
  "moments": [
    {
      "name": "联系人名字",
      "avatar": "表情符号",
      "text": "朋友圈文字内容",
      "images": ["[图片描述]"],
      "time": "几分钟前/几小时前",
      "likeList": ["点赞的人名"],
      "commentList": [
        {"name": "评论者", "text": "评论内容"},
        {"name": "回复者", "text": "回复内容", "replyTo": "被回复者"}
      ]
    }
  ]
}
\`\`\`

${momentsPrompt}

请生成朋友圈：`;


            // 调用AI
            const result = await this.callAI(prompt);

            if (result && result.moments) {
                // 清空旧的朋友圈
                this.app.wechatData.data.moments = [];

                // 添加新的朋友圈
                result.moments.forEach(m => {
                    // 🔥 优先使用联系人的真实头像，如果没有才用AI返回的
                    const contactAvatar = this.getContactAvatar(m.name);
                    const finalAvatar = (contactAvatar && contactAvatar !== '👤') ? contactAvatar : (m.avatar || '👤');

                    this.app.wechatData.addMoment({
                        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                        name: m.name,
                        avatar: finalAvatar,
                        text: m.text,
                        images: m.images || [],
                        time: m.time || '刚刚',
                        timestamp: Date.now(),
                        likes: m.likeList?.length || 0,
                        likeList: m.likeList || [],
                        comments: m.commentList?.length || 0,
                        commentList: m.commentList || []
                    });
                });

                this.app.wechatData.saveData();
                this.app.phoneShell.showNotification('朋友圈', `已加载 ${result.moments.length} 条动态`, '✅');
                this.app.render();
            } else {
                this.app.phoneShell.showNotification('朋友圈', '加载失败，请重试', '❌');
            }

        } catch (error) {
            console.error('❌ 加载朋友圈失败:', error);
            this.app.phoneShell.showNotification('错误', error.message, '❌');
        } finally {
            this.isLoading = false;
            if (refreshBtn) refreshBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
        }
    }

    // 调用AI（静默调用，不显示在酒馆聊天界面）
    async callAI(prompt) {
        const context = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
            ? SillyTavern.getContext()
            : null;

        if (!context) {
            throw new Error('无法访问SillyTavern');
        }

        try {
            const apiManager = window.VirtualPhone?.apiManager;
            if (!apiManager) throw new Error('API Manager 未初始化');

            const resolvedMaxTokens = Number.parseInt(context?.max_response_length, 10)
                || Number.parseInt(context?.max_length, 10)
                || Number.parseInt(context?.amount_gen, 10);
            const callAiOptions = {
                appId: 'wechat'
            };
            if (Number.isFinite(resolvedMaxTokens) && resolvedMaxTokens > 0) {
                callAiOptions.max_tokens = resolvedMaxTokens;
            }

            const result = await apiManager.callAI([
                { role: 'system', content: '你是一个朋友圈内容生成助手。严格返回JSON格式，不要附加解释。', isPhoneMessage: true },
                { role: 'user', content: prompt, isPhoneMessage: true }
            ], callAiOptions);
            if (!result.success) throw new Error(result.error || 'AI调用失败');
            const response = result.summary || '';


            // 🔥 解析JSON - 多种格式兼容
            let jsonStr = null;

            // 方式1: ```json ... ```
            const codeBlockMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
            if (codeBlockMatch) {
                jsonStr = codeBlockMatch[1].trim();
            }

            // 方式2: 直接找 { "moments": ... }
            if (!jsonStr) {
                const directMatch = response.match(/\{\s*"moments"\s*:\s*\[[\s\S]*\]\s*\}/);
                if (directMatch) {
                    jsonStr = directMatch[0];
                }
            }

            // 方式3: 找任何 JSON 对象
            if (!jsonStr) {
                const anyJsonMatch = response.match(/\{[\s\S]*\}/);
                if (anyJsonMatch) {
                    jsonStr = anyJsonMatch[0];
                }
            }

            if (jsonStr) {
                const result = JSON.parse(jsonStr);
                return result;
            }

            console.error('❌ [朋友圈] 无法解析JSON，响应内容:', response.substring(0, 500));
            throw new Error('AI返回格式错误');
        } catch (e) {
            console.error('❌ [朋友圈] AI调用失败:', e);
            throw e;
        }
    }

    // 获取联系人头像（优先获取图片头像）
    getContactAvatar(name) {
        // 辅助函数：检查是否为图片URL或base64
        const isImageAvatar = (avatar) => {
            if (!avatar) return false;
            return avatar.startsWith('data:image') ||
                   avatar.startsWith('http://') ||
                   avatar.startsWith('https://') ||
                   avatar.startsWith('blob:') ||
                   avatar.startsWith('/');
        };

        // 🔥 从聊天列表找（聊天列表头像通常是用户上传的，优先级最高）
        const chats = this.app.wechatData.getChatList();
        const chat = chats.find(c => c.name === name);
        if (chat?.avatar && isImageAvatar(chat.avatar)) {
            return chat.avatar;
        }

        // 从联系人列表找图片头像
        const contact = this.app.wechatData.getContacts().find(c => c.name === name);
        if (contact?.avatar && isImageAvatar(contact.avatar)) {
            return contact.avatar;
        }

        // 使用 getContactByName 方法找图片头像
        const contactByName = this.app.wechatData.getContactByName(name);
        if (contactByName?.avatar && isImageAvatar(contactByName.avatar)) {
            return contactByName.avatar;
        }

        // 🔥 如果没有图片头像，返回任何可用的头像（包括emoji）
        if (chat?.avatar) return chat.avatar;
        if (contact?.avatar) return contact.avatar;
        if (contactByName?.avatar) return contactByName.avatar;

        return null;
    }

    // 格式化时间
    formatTime(timestamp) {
        if (typeof timestamp === 'string') return timestamp;

        const now = Date.now();
        const diff = now - timestamp;

        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;

        const date = new Date(timestamp);
        return `${date.getMonth() + 1}月${date.getDate()}日`;
    }

    // 旧版render方法（保持兼容）
    render() {
        this.app.currentView = 'discover';
        this.app.render();
    }

    // ========================================
    // 📝 发朋友圈功能
    // ========================================

    // 显示发朋友圈页面
    showPostMomentPage() {
        const userInfo = this.app.wechatData.getUserInfo();

        const html = `
            <div class="wechat-app">
                <div class="wechat-header">
                    <div class="wechat-header-left">
                        <button class="wechat-back-btn" id="back-from-post">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                    </div>
                    <div class="wechat-header-title">发朋友圈</div>
                    <div class="wechat-header-right">
                        <button class="wechat-header-btn" id="publish-moment-btn" style="color: #07c160; font-size: 14px; font-weight: 500;">
                            发表
                        </button>
                    </div>
                </div>

                <div class="wechat-content" style="background: #fff; padding: 15px;">
                    <!-- 用户头像和输入框 -->
                    <div style="display: flex; gap: 12px;">
                        <div style="width: 44px; height: 44px; border-radius: 6px; overflow: hidden; flex-shrink: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center; font-size: 22px;">
                            ${this.app.renderAvatar(userInfo.avatar, '😊', userInfo.name)}
                        </div>
                        <div style="flex: 1;">
                            <textarea id="moment-text-input" placeholder="这一刻的想法..." style="
                                width: 100%;
                                min-height: 120px;
                                padding: 10px;
                                border: none;
                                font-size: 15px;
                                line-height: 1.6;
                                resize: none;
                                outline: none;
                                box-sizing: border-box;
                            "></textarea>
                        </div>
                    </div>

                    <!-- 图片预览区 -->
                    <div id="moment-images-preview" style="display: flex; flex-wrap: wrap; gap: 8px; margin: 15px 0;">
                    </div>

                    <!-- 添加图片按钮 -->
                    <div style="margin-top: 15px; padding-top: 15px; border-top: 0.5px solid #e5e5e5;">
                        <input type="file" id="moment-image-upload" accept="image/png, image/jpeg, image/gif, image/webp, image/*" multiple style="display: none;">
                        <label for="moment-image-upload" id="add-moment-image-btn" style="
                            display: flex;
                            align-items: center;
                            gap: 10px;
                            padding: 12px 15px;
                            background: #f7f7f7;
                            border: none;
                            border-radius: 8px;
                            font-size: 14px;
                            color: #333;
                            cursor: pointer;
                            width: 100%;
                            box-sizing: border-box;
                        ">
                            <i class="fa-solid fa-image" style="font-size: 18px; color: #07c160;"></i>
                            <span>添加图片</span>
                            <span style="margin-left: auto; color: #999; font-size: 12px;">最多9张</span>
                        </label>
                    </div>

                    <!-- 可见范围（简化版） -->
                    <div style="margin-top: 15px; padding: 12px 15px; background: #f7f7f7; border-radius: 8px;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <span style="font-size: 14px; color: #333;">谁可以看</span>
                            <span style="font-size: 14px; color: #999;">
                                公开 <i class="fa-solid fa-chevron-right" style="font-size: 12px; margin-left: 5px;"></i>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html);

        // 存储上传的图片
        this.pendingMomentImages = [];

        // 绑定事件
        this.bindPostMomentEvents();
    }

    // 绑定发朋友圈页面事件
    bindPostMomentEvents() {
        // 返回按钮
        document.getElementById('back-from-post')?.addEventListener('click', () => {
            this.app.currentView = 'discover';
            this.app.render();
        });

        // 图片上传
        document.getElementById('moment-image-upload')?.addEventListener('change', (e) => {
            const rawFiles = e.target.files;
            if (!rawFiles || rawFiles.length === 0) return;
            
            // 🔥 提取为静态数组并重置 input，修复无法连续选择同一张图的bug
            const fileArray = Array.from(rawFiles);
            e.target.value = ''; 
            
            this.handleImageUpload(fileArray);
        });

        // 发表按钮
        document.getElementById('publish-moment-btn')?.addEventListener('click', () => {
            this.publishMoment();
        });
    }

    // 处理图片上传 - 支持裁剪
    async handleImageUpload(files) {
        if (!files || files.length === 0) return;

        const maxImages = 9;
        const currentCount = this.pendingMomentImages?.length || 0;
        const remainingSlots = maxImages - currentCount;

        if (remainingSlots <= 0) {
            this.app.phoneShell.showNotification('提示', '最多只能上传9张图片', '⚠️');
            return;
        }

        const filesToProcess = Array.from(files).slice(0, remainingSlots);

        for (const file of filesToProcess) {
            try {
                const cropper = new ImageCropper({
                    title: '裁剪图片',
                    aspectRatio: 1, // 朋友圈图片用正方形
                    outputWidth: 600,
                    outputHeight: 600,
                    quality: 0.85,
                    maxFileSize: 5 * 1024 * 1024
                });

                const croppedImage = await cropper.open(file);

                // 🔥 核心修复：朋友圈图片真实上传
                let finalUrl = croppedImage;
                try {
                    const res = await fetch(croppedImage);
                    const blob = await res.blob();
                    const ext = blob.type === 'image/png' ? 'png' : 'jpg';
                    const filename = `phone_moment_${Date.now()}.${ext}`;
                    const formData = new FormData();
                    formData.append('avatar', blob, filename);
                    const headers = typeof window.getRequestHeaders === 'function' ? window.getRequestHeaders() : {};
                    delete headers['Content-Type'];
                    if (!headers['X-CSRF-Token']) {
                        const csrfResp = await fetch('/csrf-token');
                        if (csrfResp.ok) headers['X-CSRF-Token'] = (await csrfResp.json()).token;
                    }
                    const uploadResp = await fetch('/api/backgrounds/upload', { method: 'POST', body: formData, headers });
                    if (uploadResp.ok) finalUrl = `/backgrounds/${filename}`;
                } catch (uploadErr) {
                    console.warn('朋友圈图片上传服务器失败:', uploadErr);
                }

                if (!this.pendingMomentImages) {
                    this.pendingMomentImages = [];
                }
                this.pendingMomentImages.push(finalUrl); // 存入 URL
                this.updateImagePreview();
            } catch (error) {
                if (error.message !== '用户取消') {
                    this.app.phoneShell.showNotification('提示', error.message, '⚠️');
                }
            }
        }
    }

    // 更新图片预览
    updateImagePreview() {
        const previewContainer = document.getElementById('moment-images-preview');
        if (!previewContainer) return;

        previewContainer.innerHTML = this.pendingMomentImages.map((img, index) => `
            <div style="position: relative; width: 80px; height: 80px;">
                <img src="${img}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 6px;">
                <button class="remove-moment-image" data-index="${index}" style="
                    position: absolute;
                    top: -6px;
                    right: -6px;
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    background: rgba(0, 0, 0, 0.6);
                    color: #fff;
                    border: none;
                    font-size: 12px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">×</button>
            </div>
        `).join('');

        // 绑定删除图片事件
        previewContainer.querySelectorAll('.remove-moment-image').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                this.pendingMomentImages.splice(index, 1);
                this.updateImagePreview();
            });
        });
    }

    // 发表朋友圈
    publishMoment() {
        const textInput = document.getElementById('moment-text-input');
        const text = textInput?.value?.trim() || '';
        const images = this.pendingMomentImages || [];

        // 验证内容
        if (!text && images.length === 0) {
            this.app.phoneShell.showNotification('提示', '请输入内容或添加图片', '⚠️');
            return;
        }

        // 获取用户信息
        const userInfo = this.app.wechatData.getUserInfo();

        // 创建朋友圈
        const moment = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            name: userInfo.name || '我',
            avatar: userInfo.avatar || '😊',
            text: text,
            images: images,
            time: '刚刚',
            timestamp: Date.now(),
            likes: 0,
            likeList: [],
            comments: 0,
            commentList: []
        };

        // 添加到数据
        this.app.wechatData.addMoment(moment);

        // 清空待发送数据
        this.pendingMomentImages = [];

        // 显示成功提示
        this.app.phoneShell.showNotification('发布成功', '你的朋友圈已发布', '✅');

        // 返回朋友圈列表
        setTimeout(() => {
            this.app.currentView = 'discover';
            this.app.render();
        }, 500);
    }
}
