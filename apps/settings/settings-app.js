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
// 设置APP
import { ImageUploadManager } from './image-upload.js';
import { ImageCropper } from './image-cropper.js';
import {
    hasGaigaiTagFilter,
    readPhoneTagFilterConfig,
    savePhoneTagFilterConfig,
    PHONE_TAG_FILTER_AI_DIAGNOSTIC_PROMPT,
    parsePhoneTagFilterDiagnosticJson
} from '../../config/tag-filter.js';

const DEFAULT_DOUBAO_CLONE_WORKER_URL = '';

export class SettingsApp {
    constructor(phoneShell, storage, settings) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.settings = settings;
        this.imageManager = new ImageUploadManager(storage);
        this.currentTab = 'general'; // 可选值: 'general', 'memory', 'llm', 'tts', 'image'

        // 🔥 监听滑动返回事件 (防止实例重建导致重复绑定)
        if (!window._settingsSwipeBackBound) {
            window._settingsSwipeBackBound = true;
            window.addEventListener('phone:swipeBack', () => {
                if (window.VirtualPhone && window.VirtualPhone.settingsApp) {
                    window.VirtualPhone.settingsApp.handleSwipeBack();
                }
            });
        }
    }

    _getTtsProviderDefaults(provider) {
        const defaults = {
            minimax_cn: { url: 'https://api.minimaxi.com/v1/t2a_v2', model: 'speech-02-hd', voice: 'female-shaonv' },
            minimax_intl: { url: 'https://api.minimax.chat/v1/t2a_v2', model: 'speech-02-hd', voice: 'female-shaonv' },
            openai: { url: 'https://api.openai.com/v1/audio/speech', model: 'tts-1', voice: 'alloy' },
            volcengine: { url: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional', model: 'seed-tts-2.0', voice: 'BV700_streaming', resourceId: 'seed-tts-2.0' }
        };
        return defaults[provider] || defaults.minimax_cn;
    }

    _getTtsProviderConfigKey(provider, field) {
        return `phone-tts-${provider}-${field}`;
    }

    _getTtsProviderValue(provider, field, legacyKey = '') {
        const scoped = String(this.storage.get(this._getTtsProviderConfigKey(provider, field)) || '').trim();
        if (scoped) return scoped;
        if (legacyKey && provider === this._getCurrentTtsProvider()) {
            return String(this.storage.get(legacyKey) || '').trim();
        }
        return '';
    }

    _getCurrentTtsProvider() {
        return String(this.storage.get('phone-tts-provider') || 'minimax_cn').trim() || 'minimax_cn';
    }

    // 🔥 处理滑动返回
    handleSwipeBack() {
        // 仅当前前台图层是设置页时才响应，避免历史隐藏层误触发
        const currentView = document.querySelector('.phone-view-current');
        if (!currentView?.querySelector('.settings-app')) return;

        // 设置页面没有子页面，直接返回主屏幕
        window.dispatchEvent(new CustomEvent('phone:goHome'));
    }

    render() {
        const context = this.storage.getContext();
        const charName = context?.name2 || context?.characterId || '未知';
        const currentTtsProvider = this._getCurrentTtsProvider();
        const currentTtsDefaults = this._getTtsProviderDefaults(currentTtsProvider);
        const currentTtsUrl = this._getTtsProviderValue(currentTtsProvider, 'url', 'phone-tts-url') || currentTtsDefaults.url || '';
        const currentTtsKey = this._getTtsProviderValue(currentTtsProvider, 'key', 'phone-tts-key');
        const currentTtsModel = this._getTtsProviderValue(currentTtsProvider, 'model', 'phone-tts-model') || currentTtsDefaults.model || '';
        const currentTtsVoice = this._getTtsProviderValue(currentTtsProvider, 'voice', 'phone-tts-voice');
        const volcTtsKey = this._getTtsProviderValue('volcengine', 'key', 'phone-tts-key');
        const volcTtsVoice = this._getTtsProviderValue('volcengine', 'voice', 'phone-tts-voice');
        const currentTtsVolcAppId = this._getTtsProviderValue('volcengine', 'app-id', 'phone-tts-volc-app-id');
        const currentTtsVolcResourceId = this._getTtsProviderValue('volcengine', 'resource-id', 'phone-tts-volc-resource-id') || 'seed-tts-2.0';
        const currentTtsVolcCloneWorkerUrl = this._getTtsProviderValue('volcengine', 'clone-worker-url', 'phone-tts-volc-clone-worker-url') || DEFAULT_DOUBAO_CLONE_WORKER_URL;
        const currentTtsVolcCloneAccessToken = this._getTtsProviderValue('volcengine', 'clone-access-token', 'phone-tts-volc-clone-access-token');
        const currentTtsVolcCloneAppId = this._getTtsProviderValue('volcengine', 'clone-app-id', 'phone-tts-volc-clone-app-id');
        const isTtsMiniMaxSectionOpen = this.storage.get('phone-tts-minimax-section-open') === true;
        const isTtsVolcSectionOpen = this.storage.get('phone-tts-volc-section-open') === true;
        const isTtsWechatSectionOpen = this.storage.get('phone-tts-wechat-section-open') === true;
        const isTtsHoneySectionOpen = this.storage.get('phone-tts-honey-section-open') === true;
        const isGeneralInteractionOpen = this.storage.get('phone-settings-general-interaction-open') === true;
        const isGeneralLimitsOpen = this.storage.get('phone-settings-general-limits-open') === true;
        // 加载壁纸和颜色设置
        const wallpaper = this.imageManager.getWallpaper();
        const globalTextColor = this.storage.get('phone-global-text') || '#000000';
        const html = `
            <div class="settings-app">
                <div class="settings-app-header" style="background: #f7f7f7; color: #000; border-bottom: 0.5px solid #d8d8d8; display: flex; align-items: center; justify-content: center; position: sticky; top: 0; z-index: 100; height: 78px; min-height: 78px; padding: 34px 14px 0; box-sizing: border-box; flex-shrink: 0;">
                    <h2 style="color: #000; font-size: 17px; font-weight: 500; margin: 0;">设置</h2>
                </div>

                <div class="settings-tabs" style="position: sticky; top: 78px; z-index: 99; background: rgba(247,247,247,0.96); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-bottom: 0.5px solid #d8d8d8; height: 39px; min-height: 39px; box-sizing: border-box; flex-shrink: 0;">
                    <div style="display: flex; position: relative; height: 39px;">
                        <button class="settings-tab-btn ${this.currentTab === 'general' ? 'active' : ''}" data-tab="general" style="flex: 1; border: none; background: ${this.currentTab === 'general' ? 'rgba(0,0,0,0.06)' : 'transparent'}; height: 38px; min-height: 38px; padding: 0; line-height: 38px; font-size: 13px; font-weight: ${this.currentTab === 'general' ? '600' : '500'}; color: ${this.currentTab === 'general' ? '#111' : '#666'}; border-radius: 8px 8px 0 0; transition: all .2s ease;">常规设置</button>
                        <button class="settings-tab-btn ${this.currentTab === 'memory' ? 'active' : ''}" data-tab="memory" style="flex: 1; border: none; background: ${this.currentTab === 'memory' ? 'rgba(0,0,0,0.06)' : 'transparent'}; height: 38px; min-height: 38px; padding: 0; line-height: 38px; font-size: 13px; font-weight: ${this.currentTab === 'memory' ? '600' : '500'}; color: ${this.currentTab === 'memory' ? '#111' : '#666'}; border-radius: 8px 8px 0 0; transition: all .2s ease;">联动记录</button>
                        <button class="settings-tab-btn ${this.currentTab === 'llm' ? 'active' : ''}" data-tab="llm" style="flex: 1; border: none; background: ${this.currentTab === 'llm' ? 'rgba(0,0,0,0.06)' : 'transparent'}; height: 38px; min-height: 38px; padding: 0; line-height: 38px; font-size: 13px; font-weight: ${this.currentTab === 'llm' ? '600' : '500'}; color: ${this.currentTab === 'llm' ? '#111' : '#666'}; border-radius: 8px 8px 0 0; transition: all .2s ease;">聊天 API</button>
                        <button class="settings-tab-btn ${this.currentTab === 'tts' ? 'active' : ''}" data-tab="tts" style="flex: 1; border: none; background: ${this.currentTab === 'tts' ? 'rgba(0,0,0,0.06)' : 'transparent'}; height: 38px; min-height: 38px; padding: 0; line-height: 38px; font-size: 13px; font-weight: ${this.currentTab === 'tts' ? '600' : '500'}; color: ${this.currentTab === 'tts' ? '#111' : '#666'}; border-radius: 8px 8px 0 0; transition: all .2s ease;">语音 TTS</button>
                        <button class="settings-tab-btn ${this.currentTab === 'image' ? 'active' : ''}" data-tab="image" style="flex: 1; border: none; background: ${this.currentTab === 'image' ? 'rgba(0,0,0,0.06)' : 'transparent'}; height: 38px; min-height: 38px; padding: 0; line-height: 38px; font-size: 13px; font-weight: ${this.currentTab === 'image' ? '600' : '500'}; color: ${this.currentTab === 'image' ? '#111' : '#666'}; border-radius: 8px 8px 0 0; transition: all .2s ease;">生图</button>
                    </div>
                </div>

                <div class="app-body">
                    <div class="tab-content" id="tab-general" style="${this.currentTab === 'general' ? '' : 'display: none;'}">
                        <!-- 当前角色信息 -->
                        <div class="setting-section">
                            <div class="setting-section-title">📱 当前角色</div>
                            <div class="setting-item">
                                <div class="setting-label">角色名称</div>
                                <div class="setting-value">${charName}</div>
                            </div>
                        </div>

                        <details data-settings-fold-key="phone-settings-general-interaction-open" ${isGeneralInteractionOpen ? 'open' : ''} style="margin: 12px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                            <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                                <span>📡 互动模式</span>
                                <span style="font-size: 11px; color: #888; font-weight: 500;">点击展开/折叠</span>
                            </summary>
                            <div style="padding: 10px 10px 4px;">

                            <div class="setting-item setting-toggle">
                                <div>
                                    <div class="setting-label">在线模式</div>
                                    <div class="setting-desc">启用后可通过手机与AI互动（按会话独立设置）</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="setting-online-mode" ${this.storage.get('wechat_online_mode') ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                             <div class="setting-item setting-toggle" style="margin-top: 10px;">
                                <div>
                                    <div class="setting-label">内嵌快捷回复按钮</div>
                                    <div class="setting-desc">在底部快捷栏注入 &lt;回复xx&gt; 标签快捷按钮</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="setting-inline-reply-btn" ${this.storage.get('phone_inline_reply_btn') !== false ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <div class="setting-item setting-button" style="margin-top: 10px;">
                                <button id="setting-reset-all-prompts" class="setting-btn" style="width: 100%; padding: 8px 12px; font-size: 12px; background: rgba(255,255,255,0.9); backdrop-filter: blur(10px); border: 1px solid rgba(7,193,96,0.25); color: #0b8f52; border-radius: 8px;">
                                    <i class="fa-solid fa-rotate"></i> 一键更新所有提示词（恢复默认）
                                </button>
                            </div>

                            <div class="setting-info">
                                <strong>使用说明：</strong><br>
                                1. 开启"在线模式"<br>
                                2. 在对应APP设置中配置各功能提示词<br>
                                3. 在手机APP中发送消息，AI会自动回复
                            </div>
                            </div>
                        </details>

                        <details data-settings-fold-key="phone-settings-general-limits-open" ${isGeneralLimitsOpen ? 'open' : ''} style="margin: 8px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                            <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                                <span>📨 注入/记录条数</span>
                                <span style="font-size: 11px; color: #888; font-weight: 500;">点击展开/折叠</span>
                            </summary>
                            <div style="padding: 10px 10px 4px;">

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 14px; color: #000;">正文上下文楼层</span>
                                <input type="number" id="phone-context-limit" min="1" max="9999"
                                       value="${this.storage.get('phone-context-limit') || 20}"
                                       style="width: 55px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>

                            <div style="height: 1px; background: #ececec; margin: 10px 0;"></div>
                            <div style="font-size: 12px; font-weight: 700; color: #333; margin: 0 0 6px;">📱 线上模式（手机内聊天）</div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 14px; color: #000;">单聊发送条数</span>
                                <input type="number" id="wechat-single-chat-limit" min="1" max="9999"
                                       value="${this.storage.get('wechat-single-chat-limit') || 200}"
                                       style="width: 55px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 14px; color: #000;">群聊发送条数</span>
                                <input type="number" id="wechat-group-chat-limit" min="1" max="9999"
                                       value="${this.storage.get('wechat-group-chat-limit') || 200}"
                                       style="width: 55px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>

                            <div style="height: 1px; background: #ececec; margin: 10px 0;"></div>
                            <div style="font-size: 12px; font-weight: 700; color: #333; margin: 0 0 6px;">📞 电话通话</div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 14px; color: #000;">通话发送条数</span>
                                <input type="number" id="phone-call-limit" min="1" max="9999"
                                       value="${this.storage.get('phone-call-limit') || 10}"
                                       style="width: 55px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>

                            <div style="height: 1px; background: #ececec; margin: 10px 0;"></div>
                            <div style="font-size: 12px; font-weight: 700; color: #333; margin: 0 0 6px;">🧾 微博注入（线下模式）</div>

                            <div class="setting-item setting-toggle">
                                <div>
                                    <div class="setting-label">注入用户微博与评论</div>
                                    <div class="setting-desc">将用户最近发布的微博及对应评论注入到线下提示词</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="offline-weibo-history-enabled" ${this.storage.get('offline-weibo-history-enabled') ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 14px; color: #000;">最近微博条数</span>
                                <input type="number" id="offline-weibo-history-limit" min="1" max="50"
                                       value="${this.storage.get('offline-weibo-history-limit') || 5}"
                                       style="width: 55px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>

                            <div class="setting-info">
                                同时附带注入微博最新热搜条目（不注入热搜正文详情）
                            </div>

                            <div style="height: 1px; background: #ececec; margin: 10px 0;"></div>
                            <div style="font-size: 12px; font-weight: 700; color: #333; margin: 0 0 6px;">📴 线下模式（酒馆正文注入）</div>

                            <div class="setting-item setting-toggle">
                                <div>
                                    <div class="setting-label">日记记录注入线下</div>
                                    <div class="setting-desc">关闭后，{{DIARY_HISTORY}} 不会替换为日记内容，隐藏日记也始终不注入</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="offline-diary-history-enabled" ${(this.storage.get('offline-diary-history-enabled') === false || this.storage.get('offline-diary-history-enabled') === 'false') ? '' : 'checked'}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <div class="setting-item setting-toggle">
                                <div>
                                    <div class="setting-label">蜜语会话注入线下</div>
                                    <div class="setting-desc">关闭后，所有标记为蜜语的微信会话都不再注入酒馆正文</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="offline-honey-chat-enabled" ${(this.storage.get('offline-honey-chat-enabled') === false || this.storage.get('offline-honey-chat-enabled') === 'false') ? '' : 'checked'}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 14px; color: #000;">单聊发送条数</span>
                                <input type="number" id="offline-single-chat-limit" min="1" max="9999"
                                       value="${this.storage.get('offline-single-chat-limit') || 5}"
                                       style="width: 55px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 14px; color: #000;">群聊发送条数</span>
                                <input type="number" id="offline-group-chat-limit" min="1" max="9999"
                                       value="${this.storage.get('offline-group-chat-limit') || 10}"
                                       style="width: 55px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>
                            </div>
                        </details>

                        <!-- 个性化设置 -->
                        <div class="setting-section">
                            <div class="setting-section-title">🎨 个性化</div>

                            <!-- 壁纸设置 -->
                            <div class="setting-item">
                                <div class="setting-label">手机壁纸</div>
                                <div class="setting-desc">支持jpg/png，最大2MB</div>
                                <div style="margin-top: 10px; display: flex; gap: 8px;">
                                    <label for="upload-wallpaper" class="setting-btn" style="padding: 6px 12px; font-size: 12px; background: rgba(255,255,255,0.6); backdrop-filter: blur(10px); border: 1px solid rgba(0,0,0,0.1); cursor: pointer; color: #333; border-radius: 6px;">
                                        <i class="fa-solid fa-upload"></i> 选择壁纸
                                    </label>
                                    <input type="file" id="upload-wallpaper" accept="image/png, image/jpeg, image/gif, image/webp, image/*" style="display: none;">
                                    <button id="delete-wallpaper" class="setting-btn" style="padding: 6px 12px; font-size: 12px; background: rgba(255,255,255,0.6); backdrop-filter: blur(10px); border: 1px solid rgba(0,0,0,0.1); color: #999; border-radius: 6px;">
                                        <i class="fa-solid fa-trash"></i> 删除
                                    </button>
                                </div>
                                <div id="wallpaper-preview" style="margin-top: 10px; max-height: 100px; overflow: hidden; border-radius: 8px; ${wallpaper ? '' : 'display: none;'}">
                                    <img src="${wallpaper || ''}" style="width: 100%; height: auto; display: ${wallpaper ? 'block' : 'none'};">
                                </div>
                            </div>

                            <!-- APP图标设置 -->
                            <div class="setting-item">
                                <div class="setting-label">自定义APP图标</div>
                                <div class="setting-desc">点击APP选择图片替换图标</div>
                                <div class="app-icon-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 10px;">
                                    ${this.renderAppIconUpload()}
                                </div>
                                <div style="margin-top: 10px;">
                                    <button id="reset-app-icons-and-cleanup" class="setting-btn" style="padding: 6px 12px; font-size: 12px; background: rgba(255,255,255,0.88); backdrop-filter: blur(10px); border: 1px solid rgba(255,59,48,0.22); color: #d9342b; border-radius: 6px;">
                                        <i class="fa-solid fa-rotate-left"></i> 恢复默认图标并清理上传
                                    </button>
                                    <div class="setting-desc" style="margin-top: 6px;">仅重置 APP 图标，尝试删除对应 /backgrounds 上传文件</div>
                                </div>
                            </div>

                            <!-- 🔥 快捷栏设置 -->
                            <div class="setting-item">
                                <div class="setting-label">底部快捷栏</div>
                                <div class="setting-desc">选择4个应用显示在底部快捷栏</div>
                                <div class="dock-config-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 10px;">
                                    ${this.renderDockConfig()}
                                </div>
                            </div>
                        </div>

                        <!-- 🎨 文字颜色设置 -->
                        <div class="setting-section">
                            <div class="setting-section-title">🎨 文字颜色</div>

                            <div class="setting-item">
                                <div class="setting-toggle">
                                    <div>
                                        <div class="setting-label">全局文字颜色</div>
                                        <div class="setting-desc">统一控制手机内所有文字的颜色</div>
                                    </div>
                                    <input type="color"
                                           id="global-text-color-picker"
                                           value="${globalTextColor}"
                                           class="color-picker-input">
                                </div>
                            </div>
                        </div>

                        <!-- 时间管理 -->
                        <div class="setting-section">
                            <div class="setting-section-title">⏰ 时间管理</div>

                            <div class="setting-item">
                                <div>
                                    <div class="setting-label">当前手机时间</div>
                                    <div class="setting-desc" id="current-phone-time">加载中...</div>
                                </div>
                            </div>

                            <div class="setting-item setting-button">
                                <button class="setting-btn" id="sync-time-btn" style="padding: 4px 10px; font-size: 11px; background: rgba(255,255,255,0.9); backdrop-filter: blur(8px); border: none; border-radius: 4px; color: #333; box-shadow: 0 1px 4px rgba(0,0,0,0.12);">
                                    从正文同步时间
                                </button>
                            </div>

                            <div class="setting-info">
                                💡 从酒馆正文最后一条消息抓取时间，同步到手机
                            </div>
                        </div>

                        <!-- 数据管理 -->
                        <div class="setting-section">
                            <div class="setting-section-title">💾 数据管理</div>

                            <div class="setting-item setting-button">
                                <button class="setting-btn" id="clear-current-data" style="padding: 4px 10px; font-size: 11px; background: rgba(255,255,255,0.9); backdrop-filter: blur(8px); border: none; border-radius: 4px; color: #ff9500; box-shadow: 0 1px 4px rgba(0,0,0,0.12);">
                                    清空当前角色数据
                                </button>
                            </div>

                            <div class="setting-item setting-button">
                                <button class="setting-btn" id="clear-all-data" style="padding: 4px 10px; font-size: 11px; background: rgba(255,255,255,0.9); backdrop-filter: blur(8px); border: none; border-radius: 4px; color: #ff3b30; box-shadow: 0 1px 4px rgba(0,0,0,0.12);">
                                    清空所有角色数据
                                </button>
                            </div>
                        </div>

                        <!-- 关于 -->
                        <div class="setting-section">
                            <div class="setting-section-title">ℹ️ 关于</div>
                            <div class="setting-item">
                                <div class="setting-label">版本</div>
                                <div class="setting-value">v1.0.3</div>
                            </div>
                            <div class="setting-info">
                                每个聊天会话窗口独立存储<br>
                                蜜语数据全局共享
                            </div>
                        </div>
                    </div>

                    <div class="tab-content" id="tab-memory" style="${this.currentTab === 'memory' ? '' : 'display: none;'}">
                        ${this.renderMemoryPermissionSection()}
                        ${this.renderTagFilterSection()}
                    </div>

                    <div class="tab-content" id="tab-llm" style="${this.currentTab === 'llm' ? '' : 'display: none;'}">
                        <!-- 🤖 大模型 API 配置 (独立聊天) -->
                        <div class="setting-section">
                            <div class="setting-section-title">🤖 大模型 API 配置</div>

                            <div class="setting-item setting-toggle">
                                <div>
                                    <div class="setting-label">启用手机独立 API</div>
                                    <div class="setting-desc">开启后手机回复不走酒馆，极大提升速度并防止串味</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="phone-api-enabled">
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <div id="phone-api-details" style="display: none; padding: 10px; background: #f9f9f9; border-top: 1px solid #f0f0f0;">
                                <div style="margin-bottom: 12px;">
                                    <div style="font-size: 12px; color: #666; margin-bottom: 4px;">API 预设</div>
                                    <select id="phone-api-profile-select" style="width: 100%; padding: 8px; border: 1px solid #e0e0e0; border-radius: 6px; font-size: 13px; background: #fff; box-sizing: border-box;">
                                        <option value="">-- 选择预设 --</option>
                                    </select>
                                    <div style="display: flex; gap: 8px; margin-top: 8px;">
                                        <button id="phone-api-profile-save" style="flex: 1; padding: 8px; background: #17a2b8; color: #fff; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">💾 存为预设</button>
                                        <button id="phone-api-profile-delete" style="flex: 1; padding: 8px; background: #ff3b30; color: #fff; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">🗑️ 删除预设</button>
                                    </div>
                                </div>

                                <div style="margin-bottom: 12px;">
                                    <div style="font-size: 12px; color: #666; margin-bottom: 4px;">API 提供商</div>
                                    <select id="phone-api-provider" style="width: 100%; padding: 8px; border: 1px solid #e0e0e0; border-radius: 6px; font-size: 13px; background: #fff;">
                                        <option value="openai">OpenAI 官方</option>
                                        <option value="proxy_only">OpenAI 兼容/中转站</option>
                                        <option value="compatible">兼容端点</option>
                                        <option value="deepseek">DeepSeek 官方</option>
                                        <option value="claude">Claude 官方</option>
                                        <option value="gemini">Google Gemini 官方</option>
                                        <option value="siliconflow">硅基流动</option>
                                        <option value="local">本地/内网</option>
                                    </select>
                                </div>

                                <div style="margin-bottom: 12px;">
                                    <div style="font-size: 12px; color: #666; margin-bottom: 4px;">API 地址 (Base URL)</div>
                                    <input type="text" id="phone-api-url" placeholder="例如: https://api.openai.com/v1" style="width: 100%; padding: 8px; border: 1px solid #e0e0e0; border-radius: 6px; font-size: 13px; background: #fff; box-sizing: border-box;">
                                </div>

                                <div style="margin-bottom: 12px;">
                                    <div style="font-size: 12px; color: #666; margin-bottom: 4px;">API 密钥 (Key)</div>
                                    <input type="password" id="phone-api-key" placeholder="sk-..." style="width: 100%; padding: 8px; border: 1px solid #e0e0e0; border-radius: 6px; font-size: 13px; background: #fff; box-sizing: border-box;">
                                </div>

                                <div style="margin-bottom: 12px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                        <div style="font-size: 12px; color: #666;">模型名称 (Model)</div>
                                        <button id="phone-api-fetch-models" style="background: none; border: 1px solid #07c160; color: #07c160; border-radius: 4px; padding: 2px 8px; font-size: 11px; cursor: pointer;">🔄 拉取列表</button>
                                    </div>
                                    <input type="text" id="phone-api-model" placeholder="例如: gpt-4o" style="width: 100%; padding: 8px; border: 1px solid #e0e0e0; border-radius: 6px; font-size: 13px; background: #fff; box-sizing: border-box;">
                                    <select id="phone-api-model-select" style="display:none; width: 100%; padding: 8px; border: 1px solid #e0e0e0; border-radius: 6px; font-size: 13px; background: #fff; box-sizing: border-box; margin-top: 5px;"></select>
                                </div>

                                <div style="display: flex; gap: 10px; margin-bottom: 12px;">
                                    <div style="flex: 1;">
                                        <div style="font-size: 12px; color: #666; margin-bottom: 4px;">最大输出 (Tokens)</div>
                                        <input type="number" id="phone-api-tokens" value="4096" style="width: 100%; padding: 8px; border: 1px solid #e0e0e0; border-radius: 6px; font-size: 13px; background: #fff; box-sizing: border-box;">
                                    </div>
                                    <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; padding-top: 14px;">
                                        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #333;">
                                            <input type="checkbox" id="phone-api-stream" checked style="width: 16px; height: 16px;"> 开启流式传输
                                        </label>
                                    </div>
                                </div>

                                <div style="display: flex; gap: 10px; margin-top: 15px;">
                                    <button id="phone-api-test" style="flex: 1; padding: 10px; background: #e3f2fd; color: #1976d2; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;">🧪 测试连接</button>
                                    <button id="phone-api-save" style="flex: 1; padding: 10px; background: #07c160; color: #fff; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;">💾 保存配置</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="tab-content" id="tab-tts" style="${this.currentTab === 'tts' ? '' : 'display: none;'}">
                        <!-- 🔊 语音功能 (TTS) -->
                        <div class="tts-section-list">
                            <details data-tts-fold-key="phone-tts-minimax-section-open" ${isTtsMiniMaxSectionOpen ? 'open' : ''} style="margin: 12px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                                <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                                    <span>MiniMax / OpenAI</span>
                                    <span style="font-size: 11px; color: #888; font-weight: 500;">点击展开/折叠</span>
                                </summary>
                                <div style="padding: 10px 10px 4px;">
                                    <div class="setting-item">
                                        <div style="display: flex; align-items: center; justify-content: space-between;">
                                            <span style="font-size: 14px; color: #000;">API 接口地址</span>
                                            <select id="phone-tts-url-preset" style="width: 140px; height: 30px; padding: 0 4px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 11px; background: #fafafa;">
                                                <option value="">-- 快速选择 --</option>
                                                <option value="https://api.minimaxi.com/v1/t2a_v2">MiniMax 国内版</option>
                                                <option value="https://api.minimax.chat/v1/t2a_v2">MiniMax 国际版</option>
                                                <option value="https://api.openai.com/v1/audio/speech">OpenAI 官方</option>
                                                <option value="https://openspeech.bytedance.com/api/v3/tts/unidirectional">火山引擎/豆包</option>
                                            </select>
                                        </div>
                                        <input type="text" id="phone-tts-url"
                                               value="${currentTtsUrl}"
                                               placeholder="选择预设或手动输入地址"
                                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; margin-top: 6px; box-sizing: border-box;">
                                    </div>

                                    <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                        <span style="font-size: 14px; color: #000;">API Key</span>
                                        <input type="password" id="phone-tts-key"
                                               value="${currentTtsKey}"
                                               placeholder="MiniMax/OpenAI API Key"
                                               style="width: 140px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                                    </div>

                                    <div class="setting-item">
                                        <div style="display: flex; align-items: center; justify-content: space-between;">
                                            <span style="font-size: 14px; color: #000;">语音模型</span>
                                            <select id="phone-tts-model-preset" style="width: 140px; height: 30px; padding: 0 4px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 11px; background: #fafafa;">
                                                <option value="">-- 快速选择 --</option>
                                                <option value="speech-2.8-hd">speech-2.8-hd</option>
                                                <option value="speech-2.6-hd">speech-2.6-hd</option>
                                                <option value="speech-2.8-turbo">speech-2.8-turbo</option>
                                                <option value="speech-2.6-turbo">speech-2.6-turbo</option>
                                                <option value="speech-02-hd">speech-02-hd</option>
                                                <option value="speech-02-turbo">speech-02-turbo</option>
                                                <option value="tts-1">tts-1 (OpenAI)</option>
                                                <option value="tts-1-hd">tts-1-hd (OpenAI)</option>
                                            </select>
                                        </div>
                                        <input type="text" id="phone-tts-model"
                                               value="${currentTtsModel}"
                                               placeholder="选择预设或手动输入模型名"
                                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; margin-top: 6px; box-sizing: border-box;">
                                    </div>

                                    <div class="setting-item">
                                        <div style="display: flex; align-items: center; justify-content: space-between;">
                                            <span style="font-size: 14px; color: #000;">音色 ID (Voice)</span>
                                            <select id="phone-tts-voice-preset" style="width: 140px; height: 30px; padding: 0 4px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 11px; background: #fafafa;">
                                                <option value="">-- 历史音色 --</option>
                                                ${(() => {
                                                    try {
                                                        const list = JSON.parse(this.storage.get('phone-tts-voice-history') || '[]');
                                                        return list.map(v => `<option value="${v}">${v}</option>`).join('');
                                                    } catch(e) { return ''; }
                                                })()}
                                            </select>
                                        </div>
                                        <input type="text" id="phone-tts-voice"
                                               value="${currentTtsVoice}"
                                               placeholder="MiniMax/OpenAI 音色 ID"
                                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; margin-top: 6px; box-sizing: border-box;">
                                        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
                                            <button id="phone-tts-preview" style="padding: 2px 8px; border: none; background: none; color: #1677ff; font-size: 10px; cursor: pointer;">试听当前音色</button>
                                            <button id="phone-tts-voice-delete" style="padding: 2px 8px; border: none; background: none; color: #ff3b30; font-size: 10px; cursor: pointer;">删除当前音色</button>
                                        </div>
                                    </div>
                                </div>
                            </details>

                            <details data-tts-fold-key="phone-tts-volc-section-open" ${isTtsVolcSectionOpen ? 'open' : ''} style="margin: 8px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                                <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                                    <span>火山引擎（豆包）</span>
                                    <span style="font-size: 11px; color: #888; font-weight: 500;">点击展开/折叠</span>
                                </summary>
                                <div style="padding: 10px 10px 4px;">
                                    <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                        <span style="font-size: 14px; color: #000;">Access Token</span>
                                        <input type="password" id="phone-tts-volc-key"
                                               value="${volcTtsKey}"
                                               placeholder="豆包 Access Token"
                                               style="width: 140px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                                    </div>

                                    <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                        <span style="font-size: 14px; color: #000;">火山 APP ID</span>
                                        <input type="text" id="phone-tts-volc-app-id"
                                               value="${currentTtsVolcAppId}"
                                               placeholder="仅豆包需要"
                                               style="width: 140px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                                    </div>

                                    <div class="setting-item">
                                        <div style="display: flex; align-items: center; justify-content: space-between;">
                                            <span style="font-size: 14px; color: #000;">Resource ID</span>
                                            <input type="text" id="phone-tts-volc-resource-id"
                                                   value="${currentTtsVolcResourceId}"
                                                   placeholder="豆包模型资源ID"
                                                   style="width: 140px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                                        </div>
                                        <div class="setting-desc" style="margin-top: 6px;">豆包的 Access Token 填上方密钥栏；官方预置音色通常用 seed-tts-2.0，复刻音色（一般为 S_ 开头）需用 seed-icl-2.0。检测到 S_ 复刻音色且仍填 seed-tts-* 时，播放会自动改用 seed-icl-2.0。</div>
                                    </div>

                                    <div class="setting-item">
                                        <div style="display: flex; align-items: center; justify-content: space-between;">
                                            <span style="font-size: 14px; color: #000;">音色 ID (Voice)</span>
                                            <select id="phone-tts-volc-voice-preset" style="width: 140px; height: 30px; padding: 0 4px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 11px; background: #fafafa;">
                                                <option value="">-- 历史音色 --</option>
                                                ${(() => {
                                                    try {
                                                        const list = JSON.parse(this.storage.get('phone-tts-voice-history') || '[]');
                                                        return list.map(v => `<option value="${v}">${v}</option>`).join('');
                                                    } catch(e) { return ''; }
                                                })()}
                                            </select>
                                        </div>
                                        <div style="display: flex; gap: 6px; margin-top: 6px;">
                                            <input type="text" id="phone-tts-volc-voice"
                                                   value="${volcTtsVoice}"
                                                   placeholder="输入默认音色或 S_ 复刻音色"
                                                   style="flex: 1; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box;">
                                        </div>
                                        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
                                            <span style="font-size: 10px; color: #999;">填写后自动记入历史列表</span>
                                            <button id="phone-tts-volc-voice-delete" style="padding: 2px 8px; border: none; background: none; color: #ff3b30; font-size: 10px; cursor: pointer;">删除当前音色</button>
                                        </div>
                                        <button id="phone-tts-volc-preview" style="width: 100%; height: 30px; margin-top: 8px; border: 1px solid #d8d8d8; border-radius: 8px; background: #fafafa; color: #222; font-size: 12px; cursor: pointer;">试听当前豆包音色</button>
                                    </div>

                                    <div style="height: 1px; background: #ececec; margin: 10px 0;"></div>

                                    <div class="setting-item">
                                        <div style="font-size: 13px; font-weight: 700; color: #333; margin-bottom: 8px;">豆包音色复刻</div>
                                        <div class="setting-desc" style="margin-bottom: 8px;">复刻会把音频上传到火山/豆包云端，并消耗复刻音色额度；训练成功后可直接设为当前音色调用。</div>

                                        <input type="text" id="phone-tts-volc-clone-worker-url"
                                               value="${currentTtsVolcCloneWorkerUrl}"
                                               placeholder="Worker 地址，例：https://xxx.workers.dev"
                                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-bottom: 8px;">
                                        <div class="setting-desc" style="margin-bottom: 8px;">建议填写自己搭建的 Worker 地址。</div>

                                        <input type="password" id="phone-tts-volc-clone-access-token"
                                               value="${currentTtsVolcCloneAccessToken}"
                                               placeholder="复刻 Access Token，空着则使用上方豆包 Token"
                                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-bottom: 8px;">

                                        <input type="text" id="phone-tts-volc-clone-app-id"
                                               value="${currentTtsVolcCloneAppId}"
                                               placeholder="复刻 APP ID，空着则使用上方火山 APP ID"
                                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-bottom: 8px;">

                                        <input type="text" id="phone-tts-volc-clone-speaker-id"
                                               value="${volcTtsVoice && /^S_[A-Za-z0-9_-]+$/.test(volcTtsVoice) ? volcTtsVoice : ''}"
                                               placeholder="S_ 开头的 Speaker ID 槽位"
                                               style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-bottom: 8px;">

                                        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                                            <select id="phone-tts-volc-clone-model-type" style="flex: 1; min-width: 0; height: 30px; padding: 0 6px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                                                <option value="4">ICL 2.0</option>
                                                <option value="1">ICL 1.0</option>
                                                <option value="2">DiT 标准</option>
                                                <option value="3">DiT 还原</option>
                                            </select>
                                            <select id="phone-tts-volc-clone-language" style="flex: 1; min-width: 0; height: 30px; padding: 0 6px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                                                <option value="0">中文</option>
                                                <option value="1">英文</option>
                                                <option value="2">日语</option>
                                            </select>
                                        </div>

                                        <div style="font-size: 12px; color: #333; margin-bottom: 6px;">音频文件</div>
                                        <input type="file" id="phone-tts-volc-clone-audio" accept=".wav,.mp3,.m4a,.ogg,.aac" style="display: none;">
                                        <div style="display: grid; grid-template-columns: 120px 1fr; gap: 8px; align-items: center; margin-bottom: 8px;">
                                            <button id="phone-tts-volc-clone-audio-pick" style="height: 30px; border: 1px solid #d8d8d8; border-radius: 8px; background: #fafafa; color: #222; font-size: 12px; cursor: pointer;">选择音频文件</button>
                                            <div id="phone-tts-volc-clone-audio-name" style="min-width: 0; color: #999; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">未选择文件</div>
                                        </div>
                                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                                            <button id="phone-tts-volc-clone-upload" style="height: 30px; border: 1px solid #d8d8d8; border-radius: 8px; background: #fafafa; color: #222; font-size: 12px; cursor: pointer;">上传复刻</button>
                                            <button id="phone-tts-volc-clone-status" style="height: 30px; border: 1px solid #d8d8d8; border-radius: 8px; background: #fafafa; color: #222; font-size: 12px; cursor: pointer;">查询状态</button>
                                        </div>
                                        <button id="phone-tts-volc-clone-use" style="width: 100%; height: 30px; margin-top: 8px; border: 1px solid #d8d8d8; border-radius: 8px; background: #fafafa; color: #222; font-size: 12px; cursor: pointer;">设为当前音色</button>
                                        <div id="phone-tts-volc-clone-result" class="setting-desc" style="margin-top: 8px; min-height: 16px;"></div>
                                    </div>
                                </div>
                            </details>

                            <details data-tts-fold-key="phone-tts-wechat-section-open" ${isTtsWechatSectionOpen ? 'open' : ''} style="margin: 8px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                                <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                                    <span>微信语音/视频通话</span>
                                    <span style="font-size: 11px; color: #888; font-weight: 500;">点击展开/折叠</span>
                                </summary>
                                <div style="padding: 10px 10px 4px;">
                                    <div class="setting-item setting-toggle" style="margin-top: 0;">
                                        <div>
                                            <div class="setting-label">自动播报</div>
                                            <div class="setting-desc">开启后，微信通话中 AI 回复会自动播放绑定音色</div>
                                        </div>
                                        <label class="toggle-switch">
                                            <input type="checkbox" id="wechat-call-auto-tts" ${this.storage.get('wechat-call-auto-tts') ? 'checked' : ''}>
                                            <span class="toggle-slider"></span>
                                        </label>
                                    </div>
                                </div>
                            </details>

                            <details data-tts-fold-key="phone-tts-honey-section-open" ${isTtsHoneySectionOpen ? 'open' : ''} style="margin: 8px 0 8px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden;">
                                <summary style="height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-size: 13px; font-weight: 700; color: #333; background: #fafafa;">
                                    <span>蜜语 TTS 配置</span>
                                    <span style="font-size: 11px; color: #888; font-weight: 500;">点击展开/折叠</span>
                                </summary>
                                <div class="setting-item" style="margin-top: 0; padding: 10px 10px 4px;">

                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                    <span style="font-size: 13px; color: #222;">启用剧情语音</span>
                                    <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #666;">
                                        <input type="checkbox" id="phone-honey-tts-enabled" ${this.storage.get('phone-honey-tts-enabled') ? 'checked' : ''} style="width: 16px; height: 16px;">
                                        开启
                                    </label>
                                </div>

                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                    <span style="font-size: 13px; color: #222;">播报模式</span>
                                    <select id="phone-honey-tts-mode" style="width: 140px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                                        <option value="full" ${(this.storage.get('phone-honey-tts-mode') || 'full') === 'full' ? 'selected' : ''}>全文本</option>
                                        <option value="quotes" ${(this.storage.get('phone-honey-tts-mode') || 'full') === 'quotes' ? 'selected' : ''}>仅双引号内容</option>
                                    </select>
                                </div>

                                <div style="display: flex; align-items: center; justify-content: space-between;">
                                    <span style="font-size: 13px; color: #222;">音频缓存</span>
                                    <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #666;">
                                        <input type="checkbox" id="phone-honey-tts-cache-enabled" ${this.storage.get('phone-honey-tts-cache-enabled') === false ? '' : 'checked'} style="width: 16px; height: 16px;">
                                        开启
                                    </label>
                                </div>
                            </div>
                            </details>
                        </div>
                    </div>

                    <div class="tab-content" id="tab-image" style="${this.currentTab === 'image' ? '' : 'display: none;'}">
                        ${this.renderImageGenerationSection()}
                    </div>
                </div>
            </div>
        `;

        this.phoneShell.setContent(html);
        this.bindEvents();
    }

    renderImageGenerationSection() {
        const provider = String(this.storage.get('phone-image-provider') || 'novelai').trim() || 'novelai';
        const enabled = this.storage.get('phone-image-enabled') === true || this.storage.get('phone-image-enabled') === 'true';
        const novelaiKey = String(this.storage.get('phone-image-novelai-key') || '').trim();
        const siliconflowKey = String(this.storage.get('phone-image-siliconflow-key') || this.storage.get('siliconflow_api_key') || '').trim();
        const novelaiModel = String(this.storage.get('phone-image-novelai-model') || 'nai-diffusion-4-5-full').trim();
        const siliconflowModel = String(this.storage.get('phone-image-siliconflow-model') || this.storage.get('image_generation_model') || 'Kwai-Kolors/Kolors').trim();
        const novelaiSite = String(this.storage.get('phone-image-novelai-site') || 'official').trim() || 'official';
        const novelaiUrl = String(this.storage.get('phone-image-novelai-url') || '').trim();
        const sampler = String(this.storage.get('phone-image-novelai-sampler') || 'k_euler').trim() || 'k_euler';
        const schedule = String(this.storage.get('phone-image-novelai-schedule') || 'karras').trim() || 'karras';
        const width = Number(this.storage.get('phone-image-width') || 832);
        const height = Number(this.storage.get('phone-image-height') || 1216);
        const steps = Number(this.storage.get('phone-image-steps') || 28);
        const scale = Number(this.storage.get('phone-image-scale') || 5);
        const cfgRescale = Number(this.storage.get('phone-image-cfg-rescale') || 0);
        const seed = Number(this.storage.get('phone-image-seed') ?? -1);
        const fixedPrompt = this._escapeHtml(this.storage.get('phone-image-fixed-prompt') || '');
        const fixedPromptEnd = this._escapeHtml(this.storage.get('phone-image-fixed-prompt-end') || '');
        const negativePrompt = this._escapeHtml(this.storage.get('phone-image-negative-prompt') || '');
        const novelaiDisplay = provider === 'novelai' ? '' : 'display: none;';
        const siliconflowDisplay = provider === 'siliconflow' ? '' : 'display: none;';

        return `
            <div class="setting-section">
                <div class="setting-section-title">🖼️ 生图功能</div>

                <div class="setting-item setting-toggle">
                    <div>
                        <div class="setting-label">启用全局生图</div>
                        <div class="setting-desc">蜜语、微博、微信等 App 共用这里的生图服务配置</div>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="phone-image-enabled" ${enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>

                <div class="setting-item">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 14px; color: #000;">生图供应商</span>
                        <select id="phone-image-provider" style="width: 150px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                            <option value="novelai" ${provider === 'novelai' ? 'selected' : ''}>NovelAI / NAI</option>
                            <option value="siliconflow" ${provider === 'siliconflow' ? 'selected' : ''}>硅基流动</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="setting-section" id="phone-image-novelai-section" style="${novelaiDisplay}">
                <div class="setting-section-title">🎨 NovelAI / NAI</div>

                <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                    <span style="font-size: 14px; color: #000;">API Key</span>
                    <input type="password" id="phone-image-novelai-key"
                           value="${this._escapeHtml(novelaiKey)}"
                           placeholder="NovelAI API Key"
                           style="width: 150px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                </div>

                <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                    <span style="font-size: 14px; color: #000;">接口站点</span>
                    <select id="phone-image-novelai-site" style="width: 150px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                        <option value="official" ${novelaiSite === 'official' ? 'selected' : ''}>官方站点</option>
                        <option value="custom" ${novelaiSite === 'custom' ? 'selected' : ''}>自定义地址</option>
                    </select>
                </div>

                <div class="setting-item" id="phone-image-novelai-url-row" style="${novelaiSite === 'custom' ? '' : 'display: none;'}">
                    <div class="setting-label">自定义 Base URL</div>
                    <input type="text" id="phone-image-novelai-url"
                           value="${this._escapeHtml(novelaiUrl)}"
                           placeholder="例如：https://image.novelai.net"
                           style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                </div>

                <div class="setting-item">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 14px; color: #000;">模型</span>
                        <select id="phone-image-novelai-model-preset" style="width: 150px; height: 30px; padding: 0 6px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 11px; background: #fafafa;">
                            <option value="">-- 快速选择 --</option>
                            <option value="nai-diffusion-4-5-full">NAI Diffusion 4.5 Full</option>
                            <option value="nai-diffusion-4-5-curated">NAI Diffusion 4.5 Curated</option>
                            <option value="nai-diffusion-4-full">NAI Diffusion 4 Full</option>
                            <option value="nai-diffusion-3">NAI Diffusion 3</option>
                        </select>
                    </div>
                    <input type="text" id="phone-image-novelai-model"
                           value="${this._escapeHtml(novelaiModel)}"
                           placeholder="NovelAI 模型名"
                           style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div class="setting-item">
                        <div class="setting-label">采样器</div>
                        <input type="text" id="phone-image-novelai-sampler" value="${this._escapeHtml(sampler)}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">Schedule</div>
                        <input type="text" id="phone-image-novelai-schedule" value="${this._escapeHtml(schedule)}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    </div>
                </div>
            </div>

            <div class="setting-section" id="phone-image-siliconflow-section" style="${siliconflowDisplay}">
                <div class="setting-section-title">🌊 硅基流动</div>

                <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                    <span style="font-size: 14px; color: #000;">API Key</span>
                    <input type="password" id="siliconflow-api-key"
                           value="${this._escapeHtml(siliconflowKey)}"
                           placeholder="SiliconFlow API Key"
                           style="width: 150px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                </div>

                <div class="setting-item">
                    <div class="setting-label">模型名称</div>
                    <input type="text" id="image-generation-model"
                           value="${this._escapeHtml(siliconflowModel)}"
                           placeholder="Kwai-Kolors/Kolors"
                           style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                </div>
            </div>

            <div class="setting-section">
                <div class="setting-section-title">⚙️ 通用参数</div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div class="setting-item">
                        <div class="setting-label">宽度</div>
                        <input type="number" id="phone-image-width" min="64" max="2048" step="64" value="${width}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">高度</div>
                        <input type="number" id="phone-image-height" min="64" max="2048" step="64" value="${height}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">Steps</div>
                        <input type="number" id="phone-image-steps" min="1" max="50" value="${steps}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">Scale</div>
                        <input type="number" id="phone-image-scale" min="0" max="50" step="0.1" value="${scale}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">CFG Rescale</div>
                        <input type="number" id="phone-image-cfg-rescale" min="0" max="1" step="0.01" value="${cfgRescale}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">Seed</div>
                        <input type="number" id="phone-image-seed" min="-1" value="${seed}" style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; margin-top: 6px;">
                    </div>
                </div>

                <div class="setting-item">
                    <div class="setting-label">固定前置提示词</div>
                    <textarea id="phone-image-fixed-prompt" style="width: 100%; min-height: 58px; padding: 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; resize: vertical; margin-top: 6px;">${fixedPrompt}</textarea>
                </div>

                <div class="setting-item">
                    <div class="setting-label">固定后置提示词</div>
                    <textarea id="phone-image-fixed-prompt-end" style="width: 100%; min-height: 58px; padding: 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; resize: vertical; margin-top: 6px;">${fixedPromptEnd}</textarea>
                </div>

                <div class="setting-item">
                    <div class="setting-label">负面提示词</div>
                    <textarea id="phone-image-negative-prompt" style="width: 100%; min-height: 70px; padding: 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box; resize: vertical; margin-top: 6px;">${negativePrompt}</textarea>
                </div>
            </div>
        `;
    }
    // 渲染APP图标上传
    renderAppIconUpload() {
        // 从APPS配置中获取
        const APPS = [
            { id: 'wechat', name: '微信', icon: '💬', color: '#07c160' },
            { id: 'weibo', name: '微博', icon: '👁️‍🗨️', color: '#ff8200' },
            { id: 'honey', name: '蜜语', icon: '💕', color: '#ff6b9d' },
            { id: 'games', name: '游戏', icon: '🎮', color: '#722ed1' },
            { id: 'mofo', name: '魔坊', icon: '🪄', color: '#1677ff' },
            { id: 'phone', name: '通话', icon: '📞', color: '#52c41a' },
            { id: 'diary', name: '日记', icon: '📔', color: '#faad14' },
            { id: 'music', name: '音乐', icon: '🎵', color: '#eb2f96' },
            { id: 'settings', name: '设置', icon: '⚙️', color: '#8c8c8c' }
        ];
        
        return APPS.map(app => {
            const customIcon = this.imageManager.getAppIcon(app.id);
            return `
                <div class="upload-app-icon-item" data-app="${app.id}" style="text-align: center;">
                    <label for="upload-icon-${app.id}" style="cursor: pointer; display: block;">
                        <div style="width: 40px; height: 40px; border-radius: 10px;
                                    ${customIcon ? `background-image: url('${customIcon}'); background-size: contain; background-position: center; background-repeat: no-repeat; background-color: transparent;` : `background: ${app.color};`}
                                    display: flex; align-items: center; justify-content: center; margin: 0 auto;
                                    font-size: 20px;">
                            ${customIcon ? '' : app.icon}
                        </div>
                        <div style="font-size: 9px; margin-top: 3px; color: #666;">${app.name}</div>
                    </label>
                    <input type="file" id="upload-icon-${app.id}" accept="image/png, image/jpeg, image/gif, image/webp, image/*" style="display: none;" class="app-icon-upload" data-app-id="${app.id}">
                </div>
            `;
        }).join('');
    }

    // 🔥 渲染快捷栏配置
    renderDockConfig() {
        const APPS = [
            { id: 'wechat', name: '微信', icon: '💬', color: '#07c160' },
            { id: 'weibo', name: '微博', icon: '👁️‍🗨️', color: '#ff8200' },
            { id: 'honey', name: '蜜语', icon: '💕', color: '#ff6b9d' },
            { id: 'games', name: '游戏', icon: '🎮', color: '#722ed1' },
            { id: 'mofo', name: '魔坊', icon: '🪄', color: '#1677ff' },
            { id: 'phone', name: '通话', icon: '📞', color: '#52c41a' },
            { id: 'diary', name: '日记', icon: '📔', color: '#faad14' },
            { id: 'music', name: '音乐', icon: '🎵', color: '#eb2f96' },
            { id: 'settings', name: '设置', icon: '⚙️', color: '#8c8c8c' }
        ];

        // 获取当前配置
        let dockAppIds = ['wechat', 'weibo', 'phone', 'settings'];
        const saved = this.storage.get('dock-apps');
        if (saved) {
            try {
                dockAppIds = JSON.parse(saved);
            } catch (e) {}
        }

        return APPS.map((app, index) => {
            const isSelected = dockAppIds.includes(app.id);
            const customIcon = this.imageManager.getAppIcon(app.id);

            return `
                <div class="dock-config-item" data-app="${app.id}" style="text-align: center; cursor: pointer;">
                    <div style="width: 40px; height: 40px; border-radius: 10px;
                                ${customIcon ? `background-image: url('${customIcon}'); background-size: contain; background-position: center; background-repeat: no-repeat; background-color: transparent;` : `background: ${app.color};`}
                                display: flex; align-items: center; justify-content: center; margin: 0 auto;
                                font-size: 20px; position: relative;
                                border: 2px solid ${isSelected ? '#07c160' : 'transparent'};
                                box-shadow: ${isSelected ? '0 0 6px rgba(7, 193, 96, 0.5)' : 'none'};">
                        ${customIcon ? '' : app.icon}
                        ${isSelected ? '<span style="position: absolute; bottom: -2px; right: -2px; background: #07c160; color: #fff; width: 14px; height: 14px; border-radius: 50%; font-size: 9px; display: flex; align-items: center; justify-content: center;">✓</span>' : ''}
                    </div>
                    <div style="font-size: 9px; margin-top: 3px; color: #666;">${app.name}</div>
                </div>
            `;
        }).join('');
    }

    _getMemoryPermissionDefaults(appId) {
        const basePerms = {
            allowSummary: false,
            allowTable: false,
            allowVector: false,
            allowPrompt: false
        };
        const defaultsByApp = {
            wechat: { allowSummary: true, allowVector: true },
            weibo: { allowSummary: true, allowVector: true },
            diary: { allowSummary: true, allowVector: true },
            honey: { allowSummary: false, allowTable: false, allowVector: false, allowPrompt: false },
            phone_online: { allowSummary: false, allowTable: false, allowVector: false, allowPrompt: false }
        };
        return { ...basePerms, ...(defaultsByApp[appId] || {}) };
    }

    _getMemoryPermissionMap() {
        const rawPerms = this.storage.get('phone_memory_permissions');
        if (!rawPerms) return {};
        try {
            return typeof rawPerms === 'string' ? JSON.parse(rawPerms) : rawPerms;
        } catch (e) {
            console.warn('⚠️ 权限配置解析失败，已回退默认配置', e);
            return {};
        }
    }

    renderMemoryPermissionSection() {
        const appDefs = [
            { id: 'wechat', name: '微信', desc: '聊天与社交场景' },
            { id: 'weibo', name: '微博', desc: '动态与评论场景' },
            { id: 'diary', name: '日记', desc: '日记生成场景' },
            { id: 'honey', name: '蜜语', desc: '直播互动场景' },
            { id: 'phone_online', name: '通话', desc: '语音/视频通话场景' }
        ];
        const allPerms = this._getMemoryPermissionMap();

        return `
            <div class="setting-section">
                <div class="setting-section-title">🛂 记忆插件联动权限管理</div>
                <div class="setting-info">
                    控制手机各 App 对记忆插件的 API 权限通行证 (Signal) 下发。线下被动注入由记忆插件自身策略决定，不在此处配置。
                </div>

                ${appDefs.map(def => {
                    const merged = {
                        ...this._getMemoryPermissionDefaults(def.id),
                        ...(allPerms[def.id] || {})
                    };

                    return `
                        <div class="setting-item">
                            <div class="setting-label" style="font-size: 14px; color: #111;">${def.name}</div>
                            <div class="setting-desc">${def.desc}</div>
                            <div style="display: grid; grid-template-columns: repeat(2, minmax(120px, 1fr)); gap: 8px 10px; margin-top: 8px;">
                                <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:#333;">
                                    <input type="checkbox" class="phone-memory-perm" data-app-id="${def.id}" data-perm-key="allowSummary" ${merged.allowSummary ? 'checked' : ''}>
                                    总结
                                </label>
                                <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:#333;">
                                    <input type="checkbox" class="phone-memory-perm" data-app-id="${def.id}" data-perm-key="allowTable" ${merged.allowTable ? 'checked' : ''}>
                                    表格数据
                                </label>
                                <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:#333;">
                                    <input type="checkbox" class="phone-memory-perm" data-app-id="${def.id}" data-perm-key="allowPrompt" ${merged.allowPrompt ? 'checked' : ''}>
                                    实时提示词
                                </label>
                                <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:#333;">
                                    <input type="checkbox" class="phone-memory-perm" data-app-id="${def.id}" data-perm-key="allowVector" ${merged.allowVector ? 'checked' : ''}>
                                    向量检索
                                </label>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    bindMemoryPermissionEvents() {
        document.querySelectorAll('.phone-memory-perm').forEach(input => {
            input.addEventListener('change', async (e) => {
                const appId = String(e.target.dataset.appId || '').trim();
                const permKey = String(e.target.dataset.permKey || '').trim();
                if (!appId || !permKey) return;

                const allPerms = this._getMemoryPermissionMap();
                const merged = {
                    ...this._getMemoryPermissionDefaults(appId),
                    ...(allPerms[appId] || {})
                };
                merged[permKey] = !!e.target.checked;
                allPerms[appId] = merged;

                await this.storage.set('phone_memory_permissions', JSON.stringify(allPerms));
            });
        });
    }

    _escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _extractLastAssistantRawText(context) {
        if (!context?.chat || !Array.isArray(context.chat)) return '';

        for (let i = context.chat.length - 1; i >= 0; i--) {
            const msg = context.chat[i];
            if (!msg || msg.is_user || msg.role === 'system') continue;

            const swipeId = Number.isInteger(msg.swipe_id) ? msg.swipe_id : 0;
            if (Array.isArray(msg.swipes) && msg.swipes.length > swipeId && msg.swipes[swipeId]) {
                return String(msg.swipes[swipeId] || '');
            }
            if (msg.mes || msg.content) {
                return String(msg.mes || msg.content || '');
            }
        }

        return '';
    }

    renderTagFilterSection() {
        const cfg = readPhoneTagFilterConfig(this.storage);
        const hasMemoryFilter = hasGaigaiTagFilter();

        const blacklist = this._escapeHtml(cfg.blacklist);
        const whitelist = this._escapeHtml(cfg.whitelist);
        const memoryStatusText = hasMemoryFilter
            ? '✅ 已检测到记忆插件过滤器（优先使用记忆插件规则）'
            : '⚠️ 未检测到记忆插件过滤器（可启用下方本地过滤）';

        return `
            <div class="setting-section">
                <div class="setting-section-title">🏷️ 标签过滤（黑白名单）</div>

                <div class="setting-item setting-toggle">
                    <div>
                        <div class="setting-label">启用本地标签过滤回退</div>
                        <div class="setting-desc">无记忆插件时，按下方黑白名单规则清洗正文/微博/日记/蜜语内容</div>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="phone-tag-filter-enabled" ${cfg.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>

                <div class="setting-item" style="padding-top: 6px;">
                    <div class="setting-desc" style="font-size: 12px; color: ${hasMemoryFilter ? '#07a35a' : '#b26a00'};">
                        ${memoryStatusText}
                    </div>
                </div>

                <div class="setting-item" style="display:block;">
                    <div class="setting-label" style="margin-bottom: 6px;">🚫 黑名单标签（去除）</div>
                    <textarea id="phone-tag-filter-blacklist" placeholder="例如：think, system, Memory, [歌曲], !--" style="width: 100%; min-height: 64px; padding: 8px 10px; border: 1px solid #e5e5e5; border-radius: 6px; font-size: 12px; line-height: 1.45; box-sizing: border-box; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;">${blacklist}</textarea>
                </div>

                <div class="setting-item" style="display:block;">
                    <div class="setting-label" style="margin-bottom: 6px;">✅ 白名单标签（仅留）</div>
                    <textarea id="phone-tag-filter-whitelist" placeholder="例如：content, globalTime, [时间]" style="width: 100%; min-height: 64px; padding: 8px 10px; border: 1px solid #e5e5e5; border-radius: 6px; font-size: 12px; line-height: 1.45; box-sizing: border-box; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;">${whitelist}</textarea>
                </div>

                <div class="setting-item setting-button" style="margin-top: 4px;">
                    <button class="setting-btn" id="phone-tag-filter-ai-diagnose" style="padding: 6px 10px; font-size: 12px; background: #17a2b8; color: #fff; border: none; border-radius: 6px;">
                        🤖 AI 智能诊断标签
                    </button>
                </div>

                <div class="setting-info">
                    过滤逻辑：先黑名单删除，再白名单提取。<br>
                    标签格式：尖括号标签填标签名（如 think），方括号标签请完整填（如 [歌曲]），HTML 注释填 !--。
                </div>
            </div>
        `;
    }

    bindTagFilterEvents() {
        const enabledInput = document.getElementById('phone-tag-filter-enabled');
        const blacklistInput = document.getElementById('phone-tag-filter-blacklist');
        const whitelistInput = document.getElementById('phone-tag-filter-whitelist');
        const diagnoseBtn = document.getElementById('phone-tag-filter-ai-diagnose');

        if (enabledInput) {
            enabledInput.addEventListener('change', async (e) => {
                await savePhoneTagFilterConfig(this.storage, { enabled: !!e.target.checked });
            });
        }

        let saveTimer = null;
        const queueSaveTextConfig = () => {
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(async () => {
                const blacklist = blacklistInput ? blacklistInput.value : '';
                const whitelist = whitelistInput ? whitelistInput.value : '';
                await savePhoneTagFilterConfig(this.storage, { blacklist, whitelist });
            }, 250);
        };

        if (blacklistInput) {
            blacklistInput.addEventListener('input', queueSaveTextConfig);
            blacklistInput.addEventListener('change', queueSaveTextConfig);
        }
        if (whitelistInput) {
            whitelistInput.addEventListener('input', queueSaveTextConfig);
            whitelistInput.addEventListener('change', queueSaveTextConfig);
        }

        if (diagnoseBtn) {
            diagnoseBtn.addEventListener('click', async () => {
                await this.runTagFilterAiDiagnosis();
            });
        }
    }

    async runTagFilterAiDiagnosis() {
        const btn = document.getElementById('phone-tag-filter-ai-diagnose');
        const oldText = btn?.innerHTML || '🤖 AI 智能诊断标签';

        try {
            const context = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
                ? SillyTavern.getContext()
                : null;

            if (!context?.chat?.length) {
                alert('❌ 聊天记录为空，无法诊断');
                return;
            }

            const raw = this._extractLastAssistantRawText(context);
            if (!raw.trim()) {
                alert('❌ 未找到可诊断的 AI 回复');
                return;
            }

            if (!raw.includes('<') && !raw.includes('[')) {
                alert('ℹ️ 最后一条 AI 回复未检测到明显标签格式，无需诊断');
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 诊断中...';
            }

            const apiManager = window.VirtualPhone?.apiManager;
            if (!apiManager?.callAI) {
                throw new Error('API 管理器未初始化');
            }

            const sanitizedRaw = String(raw)
                .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+/g, '[BASE64_IMAGE]')
                .slice(0, 30000);
            const prompt = PHONE_TAG_FILTER_AI_DIAGNOSTIC_PROMPT.replace('{{RAW_TEXT}}', sanitizedRaw);

            const result = await apiManager.callAI(
                [{ role: 'user', content: prompt }],
                { appId: 'phone_online', max_tokens: 1200 }
            );

            if (!result?.success) {
                throw new Error(result?.error || 'AI 返回为空');
            }

            const parsed = parsePhoneTagFilterDiagnosticJson(result.summary || result.content || result.text || '');
            const hasBlacklist = Array.isArray(parsed.blacklist) && parsed.blacklist.length > 0;
            const hasWhitelist = Array.isArray(parsed.whitelist) && parsed.whitelist.length > 0;

            if (!hasBlacklist && !hasWhitelist) {
                alert('✅ AI 诊断完毕：当前文本无需新增过滤标签');
                return;
            }

            let confirmText = '🤖 AI 诊断结果：\n\n';
            if (parsed.reasoning) confirmText += `分析思路：${parsed.reasoning}\n\n`;
            if (hasBlacklist) confirmText += `黑名单建议：${parsed.blacklist.join(', ')}\n`;
            if (hasWhitelist) confirmText += `白名单建议：${parsed.whitelist.join(', ')}\n`;
            confirmText += '\n是否应用到输入框并保存？';

            if (!confirm(confirmText)) return;

            const blacklistValue = hasBlacklist ? parsed.blacklist.join(', ') : '';
            const whitelistValue = hasWhitelist ? parsed.whitelist.join(', ') : '';

            const blacklistInput = document.getElementById('phone-tag-filter-blacklist');
            const whitelistInput = document.getElementById('phone-tag-filter-whitelist');
            if (blacklistInput) blacklistInput.value = blacklistValue;
            if (whitelistInput) whitelistInput.value = whitelistValue;

            await savePhoneTagFilterConfig(this.storage, {
                blacklist: blacklistValue,
                whitelist: whitelistValue
            });

            if (blacklistInput) blacklistInput.style.background = 'rgba(76, 175, 80, 0.16)';
            if (whitelistInput) whitelistInput.style.background = 'rgba(76, 175, 80, 0.16)';
            setTimeout(() => {
                if (blacklistInput) blacklistInput.style.background = '';
                if (whitelistInput) whitelistInput.style.background = '';
            }, 900);

            alert('✅ 标签规则已更新并保存');
        } catch (error) {
            console.error('标签 AI 诊断失败:', error);
            alert('❌ AI 诊断失败：' + (error?.message || error));
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = oldText;
            }
        }
    }

    bindEvents() {
        // Tab 切换
        document.querySelectorAll('.settings-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const nextTab = btn.dataset.tab;
                if (!nextTab || nextTab === this.currentTab) return;
                this.currentTab = nextTab;
                this.render();
            });
        });

        document.querySelectorAll('[data-settings-fold-key]').forEach((foldEl) => {
            foldEl.addEventListener('toggle', async () => {
                const key = foldEl.dataset.settingsFoldKey;
                if (!key) return;
                await this.storage.set(key, !!foldEl.open);
            });
        });

        // 上传壁纸 - 支持裁剪
        document.getElementById('upload-wallpaper')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // 重置input
            e.target.value = '';

            try {
                // 使用裁剪器
                const cropper = new ImageCropper({
                    title: '裁剪壁纸',
                    outputWidth: 400,
                    outputHeight: 800,
                    quality: 0.85,
                    maxFileSize: 5 * 1024 * 1024
                });

                const croppedImage = await cropper.open(file);
                const oldWallpaper = this.imageManager.getWallpaper();
                await this.imageManager.deleteManagedBackgroundByPath(oldWallpaper, { quiet: true });

                // 🔥 上传到服务端，避免 Base64 撑大存档
                const serverUrl = await this.imageManager._uploadToServer(croppedImage, 'wallpaper', { allowBase64Fallback: false });

                // 保存壁纸
                this.imageManager.cache.wallpaper = serverUrl;
                await this.imageManager.saveImages(this.imageManager.cache);

                // 更新预览
                const preview = document.getElementById('wallpaper-preview');
                const img = preview.querySelector('img');
                preview.style.display = 'block';
                img.style.display = 'block';
                img.src = serverUrl;

                // 通知主屏幕更新
                window.dispatchEvent(new CustomEvent('phone:updateWallpaper', {
                    detail: { wallpaper: serverUrl }
                }));

                alert('✅ 壁纸上传成功！');
            } catch (err) {
                if (err.message !== '用户取消') {
                    alert('❌ 上传失败：' + err.message);
                }
            }
        });
        
        // 删除壁纸
        document.getElementById('delete-wallpaper')?.addEventListener('click', async () => {
            if (!confirm('确定删除壁纸吗？')) return;
        
            await this.imageManager.deleteWallpaper();
            
            const preview = document.getElementById('wallpaper-preview');
            preview.style.display = 'none';
            preview.querySelector('img').style.display = 'none';
            
            // 通知主屏幕更新
            window.dispatchEvent(new CustomEvent('phone:updateWallpaper', { 
                detail: { wallpaper: null } 
            }));
            
            alert('✅ 壁纸已删除！');
        });
        
        // APP图标上传 - 支持裁剪和PNG透明
        document.querySelectorAll('.app-icon-upload').forEach(input => {
            input.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const appId = e.target.id.replace('upload-icon-', '');

                // 重置input
                e.target.value = '';

                try {
                    // 使用裁剪器，支持PNG透明
                    const cropper = new ImageCropper({
                        title: '裁剪应用图标',
                        aspectRatio: 1, // 正方形图标
                        outputWidth: 200,
                        outputHeight: 200,
                        preserveTransparency: true, // 支持PNG透明
                        outputFormat: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
                        quality: 0.9,
                        maxFileSize: 2 * 1024 * 1024
                    });

                    const croppedImage = await cropper.open(file);
                    const oldIcon = this.imageManager.getAppIcon(appId);
                    await this.imageManager.deleteManagedBackgroundByPath(oldIcon, { quiet: true });

                    // 🔥 上传到服务端，避免 Base64 撑大存档
                    const serverUrl = await this.imageManager._uploadToServer(croppedImage, `icon_${appId}`, { allowBase64Fallback: false });

                    this.imageManager.cache.appIcons[appId] = serverUrl;
                    await this.imageManager.saveImages(this.imageManager.cache);

                    // 通知主屏幕更新图标
                    window.dispatchEvent(new CustomEvent('phone:updateAppIcon', {
                        detail: { appId, icon: serverUrl }
                    }));

                    alert('✅ 图标上传成功！');

                    // 重新渲染设置页面（保持在设置页面）
                    this.render();
                } catch (err) {
                    if (err.message !== '用户取消') {
                        alert('❌ 上传失败：' + err.message);
                    }
                }
            });
        });

        // 一键恢复默认APP图标 + 清理上传文件
        document.getElementById('reset-app-icons-and-cleanup')?.addEventListener('click', async () => {
            const ok = confirm('确定恢复默认 APP 图标并清理已上传图标文件吗？\n\n该操作会清空当前自定义图标配置，且尝试删除对应 /backgrounds 文件。');
            if (!ok) return;

            const btn = document.getElementById('reset-app-icons-and-cleanup');
            const oldText = btn?.innerHTML;
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在恢复...';
            }

            try {
                const result = await this.imageManager.resetAppIconsAndCleanupUploads();

                const summary = [
                    `✅ 已恢复默认图标（${result.resetCount} 项）`,
                    `🧹 已清理上传文件：${result.fileDeleteSuccess}/${result.fileDeleteAttempted}`
                ];
                if (result.fileDeleteFailed > 0) {
                    summary.push(`⚠️ ${result.fileDeleteFailed} 个文件未能自动删除（可能是当前酒馆版本不支持删除接口），但图标引用已清空。`);
                }

                alert(summary.join('\n'));

                // 通知主屏幕刷新图标（重置后需要立即生效）
                window.dispatchEvent(new CustomEvent('phone:updateAppIcon', {
                    detail: { reset: true }
                }));

                this.render();
            } catch (e) {
                alert('❌ 恢复失败：' + (e?.message || e));
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = oldText || '恢复默认图标并清理上传';
                }
            }
        });
        
        // 在线模式切换（per-chat）
        document.getElementById('setting-online-mode')?.addEventListener('change', (e) => {
            this.storage.set('wechat_online_mode', e.target.checked);
        });

        // 快捷回复按钮开关
        document.getElementById('setting-inline-reply-btn')?.addEventListener('change', (e) => {
            this.storage.set('phone_inline_reply_btn', e.target.checked);
        });

        // 一键更新所有提示词（恢复默认）
        document.getElementById('setting-reset-all-prompts')?.addEventListener('click', () => {
            const ok = confirm('确定将所有 APP 提示词一键恢复为默认最新版本吗？\n\n此操作会覆盖你在各 App 中手动编辑过的提示词内容。');
            if (!ok) return;

            try {
                const promptManager = window.VirtualPhone?.promptManager;
                if (!promptManager) {
                    alert('❌ 提示词管理器未初始化');
                    return;
                }

                if (typeof promptManager.resetAllPromptsToDefault === 'function') {
                    promptManager.resetAllPromptsToDefault();
                } else {
                    const defaults = promptManager.getDefaultPrompts?.();
                    if (!defaults) throw new Error('无法读取默认提示词');
                    promptManager.prompts = JSON.parse(JSON.stringify(defaults));
                    promptManager._loaded = true;
                    if (typeof promptManager.savePrompts === 'function') {
                        promptManager.savePrompts();
                    } else {
                        this.storage.set('phone-prompts', JSON.stringify(defaults), true);
                    }
                }

                alert('✅ 已一键更新所有提示词为默认最新版本');
            } catch (e) {
                console.error('❌ 一键更新所有提示词失败:', e);
                alert('❌ 更新失败：' + (e?.message || e));
            }
        });

        // 🔥 上下文楼层限制设置
        document.getElementById('phone-context-limit')?.addEventListener('change', async (e) => {
            const limit = parseInt(e.target.value) || 10;
            // 🔥 放开上限限制，支持纯手机聊天玩法
            const validLimit = Math.max(1, Math.min(9999, limit));
            e.target.value = validLimit;
            await this.storage.set('phone-context-limit', validLimit);
        });

        // 🔥 单聊记录发送条数设置
        document.getElementById('wechat-single-chat-limit')?.addEventListener('change', async (e) => {
            const limit = parseInt(e.target.value) || 200;
            const validLimit = Math.max(1, Math.min(9999, limit));
            e.target.value = validLimit;
            await this.storage.set('wechat-single-chat-limit', validLimit);
        });

        // 🔥 群聊记录发送条数设置
        document.getElementById('wechat-group-chat-limit')?.addEventListener('change', async (e) => {
            const limit = parseInt(e.target.value) || 200;
            const validLimit = Math.max(1, Math.min(9999, limit));
            e.target.value = validLimit;
            await this.storage.set('wechat-group-chat-limit', validLimit);
        });

        // 🔥 线下单聊发送条数设置
        document.getElementById('offline-single-chat-limit')?.addEventListener('change', async (e) => {
            const limit = parseInt(e.target.value) || 5;
            const validLimit = Math.max(1, Math.min(9999, limit));
            e.target.value = validLimit;
            await this.storage.set('offline-single-chat-limit', validLimit);
        });

        // 🔥 线下群聊发送条数设置
        document.getElementById('offline-group-chat-limit')?.addEventListener('change', async (e) => {
            const limit = parseInt(e.target.value) || 10;
            const validLimit = Math.max(1, Math.min(9999, limit));
            e.target.value = validLimit;
            await this.storage.set('offline-group-chat-limit', validLimit);
        });

        document.getElementById('offline-honey-chat-enabled')?.addEventListener('change', async (e) => {
            await this.storage.set('offline-honey-chat-enabled', !!e.target.checked);
        });

        document.getElementById('offline-diary-history-enabled')?.addEventListener('change', async (e) => {
            await this.storage.set('offline-diary-history-enabled', !!e.target.checked);
        });

        // 📞 通话发送条数设置
        document.getElementById('phone-call-limit')?.addEventListener('change', async (e) => {
            const limit = parseInt(e.target.value) || 10;
            const validLimit = Math.max(1, Math.min(9999, limit));
            e.target.value = validLimit;
            await this.storage.set('phone-call-limit', validLimit);
        });

        // 🧾 线下微博注入开关
        document.getElementById('offline-weibo-history-enabled')?.addEventListener('change', async (e) => {
            await this.storage.set('offline-weibo-history-enabled', !!e.target.checked);
        });

        // 🧾 线下微博注入条数
        document.getElementById('offline-weibo-history-limit')?.addEventListener('change', async (e) => {
            const limit = parseInt(e.target.value) || 5;
            const validLimit = Math.max(1, Math.min(50, limit));
            e.target.value = validLimit;
            await this.storage.set('offline-weibo-history-limit', validLimit);
        });

        // 🖼️ 全局生图配置
        const imageEnabled = document.getElementById('phone-image-enabled');
        const imageProvider = document.getElementById('phone-image-provider');
        const imageNovelaiSection = document.getElementById('phone-image-novelai-section');
        const imageSiliconflowSection = document.getElementById('phone-image-siliconflow-section');
        const imageNovelaiSite = document.getElementById('phone-image-novelai-site');
        const imageNovelaiUrlRow = document.getElementById('phone-image-novelai-url-row');
        const imageNovelaiModel = document.getElementById('phone-image-novelai-model');
        const imageNovelaiModelPreset = document.getElementById('phone-image-novelai-model-preset');
        const setImageProviderVisibility = () => {
            const provider = String(imageProvider?.value || 'novelai').trim() || 'novelai';
            if (imageNovelaiSection) imageNovelaiSection.style.display = provider === 'novelai' ? '' : 'none';
            if (imageSiliconflowSection) imageSiliconflowSection.style.display = provider === 'siliconflow' ? '' : 'none';
        };
        const clampNumberInput = (input, fallback, min, max, integer = false) => {
            if (!input) return fallback;
            let value = Number(input.value);
            if (!Number.isFinite(value)) value = fallback;
            if (Number.isFinite(min)) value = Math.max(min, value);
            if (Number.isFinite(max)) value = Math.min(max, value);
            if (integer) value = Math.round(value);
            input.value = String(value);
            return value;
        };

        imageEnabled?.addEventListener('change', async (e) => {
            await this.storage.set('phone-image-enabled', !!e.target.checked);
        });

        imageProvider?.addEventListener('change', async (e) => {
            const provider = String(e.target.value || 'novelai').trim() || 'novelai';
            await this.storage.set('phone-image-provider', provider);
            setImageProviderVisibility();
        });

        document.getElementById('phone-image-novelai-key')?.addEventListener('change', async (e) => {
            await this.storage.set('phone-image-novelai-key', String(e.target.value || '').trim());
        });

        imageNovelaiSite?.addEventListener('change', async (e) => {
            const site = String(e.target.value || 'official').trim() || 'official';
            await this.storage.set('phone-image-novelai-site', site);
            if (imageNovelaiUrlRow) imageNovelaiUrlRow.style.display = site === 'custom' ? '' : 'none';
        });

        document.getElementById('phone-image-novelai-url')?.addEventListener('change', async (e) => {
            await this.storage.set('phone-image-novelai-url', String(e.target.value || '').trim());
        });

        imageNovelaiModelPreset?.addEventListener('change', async (e) => {
            const model = String(e.target.value || '').trim();
            if (!model || !imageNovelaiModel) return;
            imageNovelaiModel.value = model;
            await this.storage.set('phone-image-novelai-model', model);
        });

        imageNovelaiModel?.addEventListener('change', async (e) => {
            const model = String(e.target.value || '').trim() || 'nai-diffusion-4-5-full';
            e.target.value = model;
            await this.storage.set('phone-image-novelai-model', model);
        });

        document.getElementById('phone-image-novelai-sampler')?.addEventListener('change', async (e) => {
            const value = String(e.target.value || '').trim() || 'k_euler';
            e.target.value = value;
            await this.storage.set('phone-image-novelai-sampler', value);
        });

        document.getElementById('phone-image-novelai-schedule')?.addEventListener('change', async (e) => {
            const value = String(e.target.value || '').trim() || 'karras';
            e.target.value = value;
            await this.storage.set('phone-image-novelai-schedule', value);
        });

        document.getElementById('siliconflow-api-key')?.addEventListener('change', async (e) => {
            const value = String(e.target.value || '').trim();
            await this.storage.set('phone-image-siliconflow-key', value);
            await this.storage.set('siliconflow_api_key', value);
        });

        document.getElementById('image-generation-model')?.addEventListener('change', async (e) => {
            const nextModel = String(e.target.value || '').trim() || 'Kwai-Kolors/Kolors';
            e.target.value = nextModel;
            await this.storage.set('phone-image-siliconflow-model', nextModel);
            await this.storage.set('image_generation_model', nextModel);
        });

        [
            ['phone-image-width', 832, 64, 2048, true],
            ['phone-image-height', 1216, 64, 2048, true],
            ['phone-image-steps', 28, 1, 50, true],
            ['phone-image-scale', 5, 0, 50, false],
            ['phone-image-cfg-rescale', 0, 0, 1, false],
            ['phone-image-seed', -1, -1, 4294967295, true]
        ].forEach(([id, fallback, min, max, integer]) => {
            document.getElementById(id)?.addEventListener('change', async (e) => {
                await this.storage.set(id, clampNumberInput(e.target, fallback, min, max, integer));
            });
        });

        [
            'phone-image-fixed-prompt',
            'phone-image-fixed-prompt-end',
            'phone-image-negative-prompt'
        ].forEach(id => {
            document.getElementById(id)?.addEventListener('change', async (e) => {
                await this.storage.set(id, String(e.target.value || '').trim());
            });
        });

        // 🔊 TTS 设置事件绑定
        const ttsProvider = document.getElementById('phone-tts-provider');
        const ttsUrl = document.getElementById('phone-tts-url');
        const ttsUrlPreset = document.getElementById('phone-tts-url-preset');
        const ttsKey = document.getElementById('phone-tts-key');
        const ttsVolcKey = document.getElementById('phone-tts-volc-key');
        const ttsVolcAppId = document.getElementById('phone-tts-volc-app-id');
        const ttsVolcResourceId = document.getElementById('phone-tts-volc-resource-id');
        const ttsModel = document.getElementById('phone-tts-model');
        const ttsModelPreset = document.getElementById('phone-tts-model-preset');
        const ttsVoice = document.getElementById('phone-tts-voice');
        const ttsVolcVoice = document.getElementById('phone-tts-volc-voice');
        const ttsPreviewBtn = document.getElementById('phone-tts-preview');
        const ttsVolcPreviewBtn = document.getElementById('phone-tts-volc-preview');
        const ttsVolcCloneWorkerUrl = document.getElementById('phone-tts-volc-clone-worker-url');
        const ttsVolcCloneAccessToken = document.getElementById('phone-tts-volc-clone-access-token');
        const ttsVolcCloneAppId = document.getElementById('phone-tts-volc-clone-app-id');
        const ttsVolcCloneSpeakerId = document.getElementById('phone-tts-volc-clone-speaker-id');
        const ttsVolcCloneModelType = document.getElementById('phone-tts-volc-clone-model-type');
        const ttsVolcCloneLanguage = document.getElementById('phone-tts-volc-clone-language');
        const ttsVolcCloneAudio = document.getElementById('phone-tts-volc-clone-audio');
        const ttsVolcCloneAudioPickBtn = document.getElementById('phone-tts-volc-clone-audio-pick');
        const ttsVolcCloneAudioName = document.getElementById('phone-tts-volc-clone-audio-name');
        const ttsVolcCloneUploadBtn = document.getElementById('phone-tts-volc-clone-upload');
        const ttsVolcCloneStatusBtn = document.getElementById('phone-tts-volc-clone-status');
        const ttsVolcCloneUseBtn = document.getElementById('phone-tts-volc-clone-use');
        const ttsVolcCloneResult = document.getElementById('phone-tts-volc-clone-result');
        const wechatCallAutoTtsToggle = document.getElementById('wechat-call-auto-tts');
        const honeyTtsEnabledToggle = document.getElementById('phone-honey-tts-enabled');
        const honeyTtsModeSelect = document.getElementById('phone-honey-tts-mode');
        const honeyTtsCacheEnabledToggle = document.getElementById('phone-honey-tts-cache-enabled');
        const getSelectedTtsProvider = () => String(ttsProvider?.value || this._getCurrentTtsProvider()).trim() || 'minimax_cn';
        const setTtsProviderField = async (field, value, legacyKey = '') => {
            const provider = getSelectedTtsProvider();
            const safeValue = String(value || '').trim();
            await this.storage.set(this._getTtsProviderConfigKey(provider, field), safeValue);
            if (legacyKey && provider === this._getCurrentTtsProvider()) {
                await this.storage.set(legacyKey, safeValue);
            }
        };
        const setVolcTtsField = async (field, value, legacyKey = '') => {
            const safeValue = String(value || '').trim();
            await this.storage.set(this._getTtsProviderConfigKey('volcengine', field), safeValue);
            if (legacyKey && this._getCurrentTtsProvider() === 'volcengine') {
                await this.storage.set(legacyKey, safeValue);
            }
        };
        const addTtsVoiceHistory = async (voiceValue) => {
            const val = String(voiceValue || '').trim();
            if (!val) return;

            let history = [];
            try { history = JSON.parse(this.storage.get('phone-tts-voice-history') || '[]'); } catch(e) {}
            if (!history.includes(val)) {
                history.push(val);
                await this.storage.set('phone-tts-voice-history', JSON.stringify(history));
                document.querySelectorAll('#phone-tts-voice-preset, #phone-tts-volc-voice-preset').forEach((preset) => {
                    const opt = document.createElement('option');
                    opt.value = val;
                    opt.textContent = val;
                    preset.appendChild(opt);
                });
            }
        };
        const saveTtsVoice = async (voiceValue) => {
            const val = String(voiceValue || '').trim();
            if (ttsVoice) ttsVoice.value = val;
            await setTtsProviderField('voice', val, 'phone-tts-voice');
            await addTtsVoiceHistory(val);
        };
        const saveVolcTtsVoice = async (voiceValue) => {
            const val = String(voiceValue || '').trim();
            if (ttsVolcVoice) ttsVolcVoice.value = val;
            await setVolcTtsField('voice', val, 'phone-tts-voice');
            await addTtsVoiceHistory(val);
        };
        const setCloneResult = (message, isError = false) => {
            if (!ttsVolcCloneResult) return;
            ttsVolcCloneResult.textContent = message || '';
            ttsVolcCloneResult.style.color = isError ? '#ff3b30' : '#666';
        };
        const getCloneForm = () => ({
            apiKey: String(ttsVolcCloneAccessToken?.value || ttsVolcKey?.value || ttsKey?.value || '').trim(),
            appId: String(ttsVolcCloneAppId?.value || ttsVolcAppId?.value || '').trim(),
            speakerId: String(ttsVolcCloneSpeakerId?.value || '').trim(),
            workerUrl: String(ttsVolcCloneWorkerUrl?.value || '').trim(),
            resourceId: String(ttsVolcResourceId?.value || 'seed-icl-2.0').trim() || 'seed-icl-2.0',
            modelType: String(ttsVolcCloneModelType?.value || '4'),
            language: String(ttsVolcCloneLanguage?.value || '0'),
            audioFile: ttsVolcCloneAudio?.files?.[0] || null
        });
        const withBusyButton = async (button, busyText, task) => {
            if (!button) return;
            const originalText = button.textContent;
            button.disabled = true;
            button.textContent = busyText;
            try {
                await task();
            } finally {
                button.disabled = false;
                button.textContent = originalText;
            }
        };
        let ttsPreviewAudio = null;
        const playTtsPreview = async (provider, voice, button) => {
            const ttsManager = window.VirtualPhone?.ttsManager;
            if (!ttsManager?.requestTTS) {
                this.phoneShell.showNotification('试听失败', 'TTS 管理器未初始化', '⚠️');
                return;
            }
            await withBusyButton(button, '试听中...', async () => {
                try {
                    const previewText = '这是一段小手机语音试听。';
                    const blobUrl = await ttsManager.requestTTS(previewText, { provider, voice });
                    if (ttsPreviewAudio) {
                        ttsPreviewAudio.pause();
                        ttsPreviewAudio.src = '';
                    }
                    ttsPreviewAudio = new Audio(blobUrl);
                    ttsPreviewAudio.onended = () => URL.revokeObjectURL(blobUrl);
                    ttsPreviewAudio.onerror = () => URL.revokeObjectURL(blobUrl);
                    await ttsPreviewAudio.play();
                } catch (error) {
                    this.phoneShell.showNotification('试听失败', error?.message || '无法播放试听音频', '⚠️');
                }
            });
        };

        if (ttsProvider) ttsProvider.addEventListener('change', async (e) => {
            const val = e.target.value;
            await this.storage.set('phone-tts-provider', val);
            // 联动填充默认 URL 和模型
            const d = this._getTtsProviderDefaults(val);
            const nextUrl = this._getTtsProviderValue(val, 'url') || d.url || '';
            const nextKey = this._getTtsProviderValue(val, 'key') || '';
            const nextModel = this._getTtsProviderValue(val, 'model') || d.model || '';
            const nextVoice = this._getTtsProviderValue(val, 'voice') || '';
            const nextAppId = this._getTtsProviderValue(val, 'app-id') || '';
            const nextResourceId = this._getTtsProviderValue(val, 'resource-id') || d.resourceId || 'seed-tts-2.0';
            if (ttsUrl) { ttsUrl.value = nextUrl; await this.storage.set('phone-tts-url', nextUrl); }
            if (ttsKey) { ttsKey.value = nextKey; await this.storage.set('phone-tts-key', nextKey); }
            if (ttsModel) { ttsModel.value = nextModel; await this.storage.set('phone-tts-model', nextModel); }
            if (ttsVoice) { ttsVoice.value = nextVoice; await this.storage.set('phone-tts-voice', nextVoice); }
            if (val === 'volcengine') {
                if (ttsVolcKey) ttsVolcKey.value = nextKey;
                if (ttsVolcVoice) ttsVolcVoice.value = nextVoice;
                if (ttsVolcAppId) { ttsVolcAppId.value = nextAppId; await this.storage.set('phone-tts-volc-app-id', nextAppId); }
                if (ttsVolcResourceId) { ttsVolcResourceId.value = nextResourceId; await this.storage.set('phone-tts-volc-resource-id', nextResourceId); }
            }
        });

        document.querySelectorAll('[data-tts-fold-key]').forEach((foldEl) => {
            foldEl.addEventListener('toggle', async () => {
                const key = foldEl.dataset.ttsFoldKey;
                if (!key) return;
                await this.storage.set(key, !!foldEl.open);
            });
        });

        // 接口地址预设下拉 → 填入输入框
        if (ttsUrlPreset) ttsUrlPreset.addEventListener('change', async (e) => {
            const val = e.target.value;
            if (!val) return;
            if (ttsUrl) { ttsUrl.value = val; await setTtsProviderField('url', val, 'phone-tts-url'); }
            e.target.value = ''; // 重置下拉为占位项
        });

        // 模型预设下拉 → 填入输入框
        if (ttsModelPreset) ttsModelPreset.addEventListener('change', async (e) => {
            const val = e.target.value;
            if (!val) return;
            if (ttsModel) { ttsModel.value = val; await setTtsProviderField('model', val, 'phone-tts-model'); }
            e.target.value = ''; // 重置下拉为占位项
        });

        if (ttsUrl) ttsUrl.addEventListener('change', async (e) => { await setTtsProviderField('url', e.target.value, 'phone-tts-url'); });
        if (ttsKey) ttsKey.addEventListener('change', async (e) => { await setTtsProviderField('key', e.target.value, 'phone-tts-key'); });
        if (ttsVolcKey) ttsVolcKey.addEventListener('change', async (e) => { await setVolcTtsField('key', e.target.value, 'phone-tts-key'); });
        if (ttsVolcAppId) ttsVolcAppId.addEventListener('change', async (e) => { await setVolcTtsField('app-id', e.target.value, 'phone-tts-volc-app-id'); });
        if (ttsVolcResourceId) ttsVolcResourceId.addEventListener('change', async (e) => { await setVolcTtsField('resource-id', e.target.value, 'phone-tts-volc-resource-id'); });
        if (ttsVolcCloneWorkerUrl) ttsVolcCloneWorkerUrl.addEventListener('change', async (e) => { await setVolcTtsField('clone-worker-url', e.target.value, 'phone-tts-volc-clone-worker-url'); });
        if (ttsVolcCloneAccessToken) ttsVolcCloneAccessToken.addEventListener('change', async (e) => { await setVolcTtsField('clone-access-token', e.target.value, 'phone-tts-volc-clone-access-token'); });
        if (ttsVolcCloneAppId) ttsVolcCloneAppId.addEventListener('change', async (e) => { await setVolcTtsField('clone-app-id', e.target.value, 'phone-tts-volc-clone-app-id'); });
        if (ttsModel) ttsModel.addEventListener('change', async (e) => { await setTtsProviderField('model', e.target.value, 'phone-tts-model'); });
        if (ttsVolcCloneAudioPickBtn && ttsVolcCloneAudio) {
            ttsVolcCloneAudioPickBtn.addEventListener('click', () => {
                ttsVolcCloneAudio.click();
            });
            ttsVolcCloneAudio.addEventListener('change', () => {
                const file = ttsVolcCloneAudio.files?.[0];
                if (ttsVolcCloneAudioName) {
                    ttsVolcCloneAudioName.textContent = file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)` : '未选择文件';
                    ttsVolcCloneAudioName.style.color = file ? '#333' : '#999';
                }
            });
        }
        if (ttsPreviewBtn) {
            ttsPreviewBtn.addEventListener('click', async () => {
                const provider = getSelectedTtsProvider();
                const voice = String(ttsVoice?.value || '').trim();
                await saveTtsVoice(voice);
                await playTtsPreview(provider, voice || undefined, ttsPreviewBtn);
            });
        }
        if (ttsVolcPreviewBtn) {
            ttsVolcPreviewBtn.addEventListener('click', async () => {
                const voice = String(ttsVolcVoice?.value || '').trim();
                const volcDefaults = this._getTtsProviderDefaults('volcengine');
                await this.storage.set('phone-tts-provider', 'volcengine');
                await setVolcTtsField('url', volcDefaults.url, 'phone-tts-url');
                await setVolcTtsField('model', volcDefaults.model, 'phone-tts-model');
                if (ttsVolcResourceId && /^S_[A-Za-z0-9_-]+$/.test(voice)) {
                    ttsVolcResourceId.value = 'seed-icl-2.0';
                    await setVolcTtsField('resource-id', 'seed-icl-2.0', 'phone-tts-volc-resource-id');
                }
                await saveVolcTtsVoice(voice);
                await playTtsPreview('volcengine', voice || undefined, ttsVolcPreviewBtn);
            });
        }
        if (ttsVolcCloneUploadBtn) {
            ttsVolcCloneUploadBtn.addEventListener('click', async () => {
                if (!ttsVolcCloneAudio?.files?.[0]) {
                    ttsVolcCloneAudio?.click();
                    setCloneResult('请先选择用于复刻的音频文件。');
                    return;
                }
                const ttsManager = window.VirtualPhone?.ttsManager;
                if (!ttsManager?.cloneVolcVoice) {
                    setCloneResult('TTS 管理器未初始化，无法上传复刻。', true);
                    return;
                }
                await withBusyButton(ttsVolcCloneUploadBtn, '上传中...', async () => {
                    try {
                        setCloneResult('正在上传音频并开始复刻...');
                        const form = getCloneForm();
                        const result = await ttsManager.cloneVolcVoice(form);
                        const speakerId = String(result.speakerId || form.speakerId).trim();
                        if (ttsVolcCloneSpeakerId) ttsVolcCloneSpeakerId.value = speakerId;
                        if (ttsVolcResourceId) {
                            ttsVolcResourceId.value = result.resourceId || 'seed-icl-2.0';
                            await setVolcTtsField('resource-id', ttsVolcResourceId.value, 'phone-tts-volc-resource-id');
                        }
                        await saveVolcTtsVoice(speakerId);
                        setCloneResult(`上传成功，音色 ${speakerId} 已加入历史。稍后可查询训练状态。`);
                        this.phoneShell.showNotification('上传成功', '豆包音色复刻已开始', '🎙️');
                    } catch (error) {
                        setCloneResult(error?.message || '豆包音色复刻失败', true);
                    }
                });
            });
        }
        if (ttsVolcCloneStatusBtn) {
            ttsVolcCloneStatusBtn.addEventListener('click', async () => {
                const ttsManager = window.VirtualPhone?.ttsManager;
                if (!ttsManager?.getVolcVoiceCloneStatus) {
                    setCloneResult('TTS 管理器未初始化，无法查询状态。', true);
                    return;
                }
                await withBusyButton(ttsVolcCloneStatusBtn, '查询中...', async () => {
                    try {
                        const form = getCloneForm();
                        const result = await ttsManager.getVolcVoiceCloneStatus(form);
                        const versionText = result.version ? `，版本 ${result.version}` : '';
                        setCloneResult(`状态：${result.statusText}${versionText}`);
                    } catch (error) {
                        setCloneResult(error?.message || '豆包音色状态查询失败', true);
                    }
                });
            });
        }
        if (ttsVolcCloneUseBtn) {
            ttsVolcCloneUseBtn.addEventListener('click', async () => {
                const speakerId = String(ttsVolcCloneSpeakerId?.value || '').trim();
                if (!speakerId) {
                    setCloneResult('请先填写 S_ 开头的 Speaker ID。', true);
                    return;
                }
                await this.storage.set('phone-tts-provider', 'volcengine');
                if (ttsProvider) ttsProvider.value = 'volcengine';
                if (ttsVolcResourceId) {
                    ttsVolcResourceId.value = 'seed-icl-2.0';
                    await setVolcTtsField('resource-id', 'seed-icl-2.0', 'phone-tts-volc-resource-id');
                }
                await saveVolcTtsVoice(speakerId);
                setCloneResult(`已设为当前豆包音色：${speakerId}`);
                this.phoneShell.showNotification('已设置', '复刻音色已设为当前音色', '✅');
            });
        }
        if (wechatCallAutoTtsToggle) {
            wechatCallAutoTtsToggle.addEventListener('change', async (e) => {
                await this.storage.set('wechat-call-auto-tts', !!e.target.checked);
            });
        }
        if (honeyTtsEnabledToggle) {
            honeyTtsEnabledToggle.addEventListener('change', async (e) => {
                await this.storage.set('phone-honey-tts-enabled', !!e.target.checked);
            });
        }
        if (honeyTtsModeSelect) {
            honeyTtsModeSelect.addEventListener('change', async (e) => {
                const val = String(e.target.value || '').trim() === 'quotes' ? 'quotes' : 'full';
                await this.storage.set('phone-honey-tts-mode', val);
            });
        }
        if (honeyTtsCacheEnabledToggle) {
            honeyTtsCacheEnabledToggle.addEventListener('change', async (e) => {
                await this.storage.set('phone-honey-tts-cache-enabled', !!e.target.checked);
            });
        }
        if (ttsVoice) ttsVoice.addEventListener('change', async (e) => {
            const val = e.target.value.trim();
            await saveTtsVoice(val);
        });
        if (ttsVolcVoice) ttsVolcVoice.addEventListener('change', async (e) => {
            const val = e.target.value.trim();
            await saveVolcTtsVoice(val);
            if (ttsVolcCloneSpeakerId && /^S_[A-Za-z0-9_-]+$/.test(val)) {
                ttsVolcCloneSpeakerId.value = val;
            }
        });

        // 音色历史下拉 → 选择填入输入框
        const ttsVoicePreset = document.getElementById('phone-tts-voice-preset');
        if (ttsVoicePreset) {
            ttsVoicePreset.addEventListener('change', async (e) => {
                const val = e.target.value;
                if (!val) return;
                await saveTtsVoice(val);
                e.target.value = ''; // 重置为占位项
            });

            // 长按删除音色历史（mousedown 计时）
            let voiceLongPressTimer = null;
            ttsVoicePreset.addEventListener('mousedown', () => {
                voiceLongPressTimer = setTimeout(async () => {
                    const selectedVal = ttsVoicePreset.value;
                    if (!selectedVal) return;
                    if (!confirm(`删除历史音色「${selectedVal}」？`)) return;
                    let history = [];
                    try { history = JSON.parse(this.storage.get('phone-tts-voice-history') || '[]'); } catch(e) {}
                    history = history.filter(v => v !== selectedVal);
                    await this.storage.set('phone-tts-voice-history', JSON.stringify(history));
                    // 移除 DOM option
                    const opt = ttsVoicePreset.querySelector(`option[value="${CSS.escape(selectedVal)}"]`);
                    if (opt) opt.remove();
                    ttsVoicePreset.value = '';
                    // 如果当前使用的就是被删的，清空输入框
                    if (ttsVoice && ttsVoice.value === selectedVal) {
                        ttsVoice.value = '';
                        await setTtsProviderField('voice', '', 'phone-tts-voice');
                    }
                }, 800);
            });
            ttsVoicePreset.addEventListener('mouseup', () => clearTimeout(voiceLongPressTimer));
            ttsVoicePreset.addEventListener('mouseleave', () => clearTimeout(voiceLongPressTimer));
        }

        const ttsVolcVoicePreset = document.getElementById('phone-tts-volc-voice-preset');
        if (ttsVolcVoicePreset) {
            ttsVolcVoicePreset.addEventListener('change', async (e) => {
                const val = e.target.value;
                if (!val) return;
                await saveVolcTtsVoice(val);
                if (ttsVolcCloneSpeakerId && /^S_[A-Za-z0-9_-]+$/.test(val)) {
                    ttsVolcCloneSpeakerId.value = val;
                }
                e.target.value = '';
            });
        }

        // 删除音色按钮
        const ttsVoiceDeleteBtn = document.getElementById('phone-tts-voice-delete');
        if (ttsVoiceDeleteBtn) {
            ttsVoiceDeleteBtn.addEventListener('click', async () => {
                const currentVoice = ttsVoice?.value?.trim();
                if (!currentVoice) {
                    this.phoneShell.showNotification('提示', '请先选择或输入要删除的音色', '⚠️');
                    return;
                }
                if (!confirm(`确定删除音色「${currentVoice}」？`)) return;

                // 从历史列表移除
                let history = [];
                try { history = JSON.parse(this.storage.get('phone-tts-voice-history') || '[]'); } catch(e) {}
                history = history.filter(v => v !== currentVoice);
                await this.storage.set('phone-tts-voice-history', JSON.stringify(history));

                // 移除下拉选项
                const preset = document.getElementById('phone-tts-voice-preset');
                if (preset) {
                    const opt = preset.querySelector(`option[value="${CSS.escape(currentVoice)}"]`);
                    if (opt) opt.remove();
                    preset.value = '';
                }

                // 清空输入框和存储
                if (ttsVoice) ttsVoice.value = '';
                await setTtsProviderField('voice', '', 'phone-tts-voice');

                this.phoneShell.showNotification('已删除', `音色「${currentVoice}」已移除`, '🗑️');
            });
        }

        const ttsVolcVoiceDeleteBtn = document.getElementById('phone-tts-volc-voice-delete');
        if (ttsVolcVoiceDeleteBtn) {
            ttsVolcVoiceDeleteBtn.addEventListener('click', async () => {
                const currentVoice = ttsVolcVoice?.value?.trim();
                if (!currentVoice) {
                    this.phoneShell.showNotification('提示', '请先选择或输入要删除的豆包音色', '⚠️');
                    return;
                }
                if (!confirm(`确定删除豆包音色「${currentVoice}」？`)) return;

                let history = [];
                try { history = JSON.parse(this.storage.get('phone-tts-voice-history') || '[]'); } catch(e) {}
                history = history.filter(v => v !== currentVoice);
                await this.storage.set('phone-tts-voice-history', JSON.stringify(history));

                document.querySelectorAll('#phone-tts-voice-preset, #phone-tts-volc-voice-preset').forEach((preset) => {
                    const opt = preset.querySelector(`option[value="${CSS.escape(currentVoice)}"]`);
                    if (opt) opt.remove();
                    preset.value = '';
                });

                if (ttsVolcVoice) ttsVolcVoice.value = '';
                if (ttsVolcCloneSpeakerId?.value === currentVoice) ttsVolcCloneSpeakerId.value = '';
                await setVolcTtsField('voice', '', 'phone-tts-voice');

                this.phoneShell.showNotification('已删除', `豆包音色「${currentVoice}」已移除`, '🗑️');
            });
        }

        // 清空当前角色数据
        document.getElementById('clear-current-data')?.addEventListener('click', () => {
            if (confirm('确定清空当前角色的所有手机数据（含蜜语生成内容）？\n\n此操作不可恢复！')) {
                window.dispatchEvent(new CustomEvent('phone:clearCurrentData'));
                alert('✅ 数据已清空！');
            }
        });
        
        // 清空所有数据
        document.getElementById('clear-all-data')?.addEventListener('click', () => {
            if (confirm('⚠️ 警告！\n\n确定清空所有角色的手机数据（含蜜语生成内容）？\n此操作将删除所有聊天记录、消息、联系人等！\n\n此操作不可恢复！')) {
                if (confirm('再次确认：真的要删除所有数据吗？')) {
                    window.dispatchEvent(new CustomEvent('phone:clearAllData'));
                    alert('✅ 所有数据已清空！');
                }
            }
        });

        // 🎨 颜色设置事件（新版：统一全局文字颜色）

        // 全局文字颜色选择器（实时预览）
        document.getElementById('global-text-color-picker')?.addEventListener('input', (e) => {
            const color = e.target.value;
            document.documentElement.style.setProperty('--phone-global-text', color);
        });

        // 全局文字颜色选择器（保存设置）
        document.getElementById('global-text-color-picker')?.addEventListener('change', async (e) => {
            const color = e.target.value;
            await this.storage.set('phone-global-text', color);
        });

        // ⏰ 时间管理功能
        // 显示当前手机时间
        this.updatePhoneTimeDisplay();

        // 从正文同步时间按钮
        document.getElementById('sync-time-btn')?.addEventListener('click', () => {
            this.syncTimeFromChat();
        });

        // 🔥 快捷栏配置点击事件
        document.querySelectorAll('.dock-config-item').forEach(item => {
            item.addEventListener('click', async () => {
                const appId = item.dataset.app;

                // 获取当前配置
                let dockAppIds = ['wechat', 'weibo', 'phone', 'settings'];
                const saved = this.storage.get('dock-apps');
                if (saved) {
                    try {
                        dockAppIds = JSON.parse(saved);
                    } catch (e) {}
                }

                const index = dockAppIds.indexOf(appId);
                if (index > -1) {
                    // 已选中，取消选择（但至少保留1个）
                    if (dockAppIds.length > 1) {
                        dockAppIds.splice(index, 1);
                    } else {
                        alert('⚠️ 至少需要保留1个快捷应用');
                        return;
                    }
                } else {
                    // 未选中，添加（最多4个）
                    if (dockAppIds.length >= 4) {
                        alert('⚠️ 最多只能选择4个快捷应用');
                        return;
                    }
                    dockAppIds.push(appId);
                }

                // 保存配置
                await this.storage.set('dock-apps', JSON.stringify(dockAppIds));

                // 🔥 只更新当前项的勾选状态，不重新渲染整个页面
                const isNowSelected = dockAppIds.includes(appId);
                const iconBox = item.querySelector('div > div');
                if (iconBox) {
                    iconBox.style.border = `2px solid ${isNowSelected ? '#07c160' : 'transparent'}`;
                    iconBox.style.boxShadow = isNowSelected ? '0 0 6px rgba(7, 193, 96, 0.5)' : 'none';

                    // 更新勾选标记
                    const checkMark = iconBox.querySelector('span');
                    if (isNowSelected && !checkMark) {
                        iconBox.insertAdjacentHTML('beforeend', '<span style="position: absolute; bottom: -2px; right: -2px; background: #07c160; color: #fff; width: 14px; height: 14px; border-radius: 50%; font-size: 9px; display: flex; align-items: center; justify-content: center;">✓</span>');
                    } else if (!isNowSelected && checkMark) {
                        checkMark.remove();
                    }
                }
            });
        });

        this.bindMemoryPermissionEvents();
        this.bindTagFilterEvents();

        // 👇 新增：在这里调用独立的 API 事件绑定方法
        this.bindApiConfigEvents();
    }

    // ==========================================
    // 🤖 大模型 API 配置面板逻辑 (独立方法)
    // ==========================================
    bindApiConfigEvents() {
        const defaultApiConfig = () => ({
            useIndependentAPI: false,
            provider: 'openai',
            apiUrl: '',
            apiKey: '',
            model: '',
            maxTokens: 4096,
            useStream: true,
            profiles: [],
            activeProfileName: ''
        });

        const normalizeApiConfig = (config) => {
            const merged = { ...defaultApiConfig(), ...(config || {}) };
            if (!Array.isArray(merged.profiles)) merged.profiles = [];
            merged.profiles = merged.profiles
                .filter(p => p && typeof p === 'object' && String(p.name || '').trim())
                .map(p => ({
                    name: String(p.name || '').trim(),
                    useIndependentAPI: p.useIndependentAPI !== false,
                    provider: p.provider || 'openai',
                    apiUrl: p.apiUrl || p.url || '',
                    apiKey: p.apiKey || p.key || '',
                    model: p.model || '',
                    maxTokens: parseInt(p.maxTokens, 10) || 4096,
                    useStream: p.useStream !== false
                }));
            merged.maxTokens = parseInt(merged.maxTokens, 10) || 4096;
            merged.useStream = merged.useStream !== false;
            return merged;
        };

        const readApiConfig = () => {
            try {
                const raw = this.storage.get('phone_api_config');
                const parsed = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
                return normalizeApiConfig(parsed);
            } catch (e) {
                return defaultApiConfig();
            }
        };

        const rebuildApiManager = () => {
            try {
                if (window.VirtualPhone && window.VirtualPhone.apiManager) {
                    window.VirtualPhone.apiManager = new window.VirtualPhone.apiManager.constructor(this.storage);
                }
            } catch (e) {
                console.warn('重建 ApiManager 失败:', e);
            }
        };

        const saveApiConfig = async (config) => {
            const normalized = normalizeApiConfig(config);
            await this.storage.set('phone_api_config', JSON.stringify(normalized));
            rebuildApiManager();
            return normalized;
        };

        const collectConfigFromForm = () => ({
            useIndependentAPI: document.getElementById('phone-api-enabled')?.checked || false,
            provider: document.getElementById('phone-api-provider')?.value || 'openai',
            apiUrl: document.getElementById('phone-api-url')?.value.trim() || '',
            apiKey: document.getElementById('phone-api-key')?.value.trim() || '',
            model: document.getElementById('phone-api-model')?.value.trim() || '',
            maxTokens: parseInt(document.getElementById('phone-api-tokens')?.value, 10) || 4096,
            useStream: document.getElementById('phone-api-stream')?.checked !== false
        });

        const applyConfigToForm = (config) => {
            const enabledCb = document.getElementById('phone-api-enabled');
            if (enabledCb) enabledCb.checked = config.useIndependentAPI || false;

            const details = document.getElementById('phone-api-details');
            if (details) details.style.display = config.useIndependentAPI ? 'block' : 'none';

            const providerSel = document.getElementById('phone-api-provider');
            if (providerSel) providerSel.value = config.provider || 'openai';

            const urlInput = document.getElementById('phone-api-url');
            if (urlInput) urlInput.value = config.apiUrl || '';

            const keyInput = document.getElementById('phone-api-key');
            if (keyInput) keyInput.value = config.apiKey || '';

            const modelInput = document.getElementById('phone-api-model');
            if (modelInput) modelInput.value = config.model || '';

            const tokensInput = document.getElementById('phone-api-tokens');
            if (tokensInput) tokensInput.value = config.maxTokens || 4096;

            const streamCb = document.getElementById('phone-api-stream');
            if (streamCb) streamCb.checked = config.useStream !== false;
        };

        const renderProfileSelect = (config) => {
            const select = document.getElementById('phone-api-profile-select');
            if (!select) return;
            const options = ['<option value="">-- 选择预设 --</option>'];
            config.profiles.forEach((p, idx) => {
                options.push(`<option value="${idx}">${p.name}</option>`);
            });
            select.innerHTML = options.join('');

            let activeIndex = -1;
            if (config.activeProfileName) {
                activeIndex = config.profiles.findIndex(p => p.name === config.activeProfileName);
            }
            if (activeIndex >= 0) {
                select.value = String(activeIndex);
            }
        };

        const parseOpenAIModelsResponse = (data) => {
            const apiManager = window.VirtualPhone?.apiManager;
            if (apiManager && typeof apiManager._parseOpenAIModelsResponse === 'function') {
                return apiManager._parseOpenAIModelsResponse(data);
            }
            if (typeof data === 'string') {
                try { data = JSON.parse(data); } catch { return []; }
            }
            const list = data?.data || data?.models || (Array.isArray(data) ? data : []);
            if (!Array.isArray(list)) return [];
            return list
                .map((m) => {
                    if (typeof m === 'string') return { id: m, name: m };
                    const id = m?.id || m?.model || m?.name;
                    if (!id) return null;
                    return { id, name: m?.name || id };
                })
                .filter(Boolean);
        };

        const updateProviderPlaceholders = (provider) => {
            const urlInput = document.getElementById('phone-api-url');
            const modelInput = document.getElementById('phone-api-model');
            if (!urlInput || !modelInput) return;

            urlInput.setAttribute('placeholder', '请输入 API 地址 (Base URL)...');
            modelInput.setAttribute('placeholder', '请输入模型名称...');

            if (provider === 'local') {
                urlInput.setAttribute('placeholder', '例如: http://127.0.0.1:7860/v1');
                modelInput.setAttribute('placeholder', '例如: gpt-3.5-turbo');
            } else if (provider === 'proxy_only') {
                urlInput.setAttribute('placeholder', '例如: http://127.0.0.1:8889/v1');
                modelInput.setAttribute('placeholder', '例如: gemini-2.5-pro');
            } else if (provider === 'compatible') {
                urlInput.setAttribute('placeholder', '例如: https://api.xxx.com/v1');
                modelInput.setAttribute('placeholder', '例如: gpt-4o, deepseek-chat');
            } else if (provider === 'openai') {
                urlInput.setAttribute('placeholder', '例如: https://api.openai.com/v1');
                modelInput.setAttribute('placeholder', '例如: gpt-4o');
            } else if (provider === 'deepseek') {
                urlInput.setAttribute('placeholder', '例如: https://api.deepseek.com/v1');
                modelInput.setAttribute('placeholder', '例如: deepseek-chat');
            } else if (provider === 'siliconflow') {
                urlInput.setAttribute('placeholder', '例如: https://api.siliconflow.cn/v1');
                modelInput.setAttribute('placeholder', '例如: deepseek-ai/DeepSeek-V3');
            } else if (provider === 'gemini') {
                urlInput.setAttribute('placeholder', '例如: https://generativelanguage.googleapis.com/v1beta');
                modelInput.setAttribute('placeholder', '例如: gemini-2.5-flash');
            } else if (provider === 'claude') {
                urlInput.setAttribute('placeholder', '例如: https://api.anthropic.com/v1/messages');
                modelInput.setAttribute('placeholder', '例如: claude-3-5-sonnet-20241022');
            }
        };

        // 1. 初始化读取配置并渲染到界面
        const initialConfig = readApiConfig();
        applyConfigToForm(initialConfig);
        renderProfileSelect(initialConfig);
        updateProviderPlaceholders(initialConfig.provider || 'openai');

        // 2. 开关展开面板 (并自动保存状态)
        const apiEnabledCb = document.getElementById('phone-api-enabled');
        if (apiEnabledCb) {
            apiEnabledCb.onchange = async (e) => {
                const isChecked = e.target.checked;
                const details = document.getElementById('phone-api-details');
                if (details) details.style.display = isChecked ? 'block' : 'none';

                const config = readApiConfig();
                config.useIndependentAPI = isChecked;
                await saveApiConfig(config);
            };
        }

        const apiProviderSelect = document.getElementById('phone-api-provider');
        if (apiProviderSelect) {
            apiProviderSelect.onchange = () => {
                updateProviderPlaceholders(apiProviderSelect.value || 'openai');
            };
        }

        // 2.5 API预设切换
        const apiProfileSelect = document.getElementById('phone-api-profile-select');
        if (apiProfileSelect) {
            apiProfileSelect.onchange = async (e) => {
                const idx = parseInt(e.target.value, 10);
                if (!Number.isInteger(idx) || idx < 0) return;

                const config = readApiConfig();
                const profile = config.profiles[idx];
                if (!profile) return;

                const merged = {
                    ...config,
                    useIndependentAPI: profile.useIndependentAPI !== false,
                    provider: profile.provider || 'openai',
                    apiUrl: profile.apiUrl || '',
                    apiKey: profile.apiKey || '',
                    model: profile.model || '',
                    maxTokens: parseInt(profile.maxTokens, 10) || 4096,
                    useStream: profile.useStream !== false,
                    activeProfileName: profile.name
                };
                applyConfigToForm(merged);
                updateProviderPlaceholders(merged.provider || 'openai');
                await saveApiConfig(merged); // 切换预设即生效
                renderProfileSelect(merged);
            };
        }

        // 2.6 存为预设
        const apiProfileSaveBtn = document.getElementById('phone-api-profile-save');
        if (apiProfileSaveBtn) {
            apiProfileSaveBtn.onclick = async () => {
                const currentName = (() => {
                    const sel = document.getElementById('phone-api-profile-select');
                    const idx = sel ? parseInt(sel.value, 10) : -1;
                    const cfg = readApiConfig();
                    if (Number.isInteger(idx) && idx >= 0 && cfg.profiles[idx]) return cfg.profiles[idx].name;
                    return '';
                })();
                const name = String(prompt('请输入 API 预设名称', currentName || '') || '').trim();
                if (!name) return;

                const config = readApiConfig();
                const profile = { name, ...collectConfigFromForm() };
                const existingIdx = config.profiles.findIndex(p => p.name === name);
                if (existingIdx >= 0) {
                    if (!confirm(`预设“${name}”已存在，是否覆盖？`)) return;
                    config.profiles[existingIdx] = profile;
                } else {
                    config.profiles.push(profile);
                }

                Object.assign(config, profile);
                config.activeProfileName = name;
                const saved = await saveApiConfig(config);
                renderProfileSelect(saved);
                const select = document.getElementById('phone-api-profile-select');
                if (select) {
                    const idx = saved.profiles.findIndex(p => p.name === name);
                    if (idx >= 0) select.value = String(idx);
                }
                alert('✅ API 预设已保存');
            };
        }

        // 2.7 删除预设
        const apiProfileDeleteBtn = document.getElementById('phone-api-profile-delete');
        if (apiProfileDeleteBtn) {
            apiProfileDeleteBtn.onclick = async () => {
                const select = document.getElementById('phone-api-profile-select');
                const idx = select ? parseInt(select.value, 10) : -1;
                if (!Number.isInteger(idx) || idx < 0) {
                    alert('请先选择一个预设');
                    return;
                }

                const config = readApiConfig();
                const target = config.profiles[idx];
                if (!target) return;
                if (!confirm(`确定删除预设“${target.name}”吗？`)) return;

                config.profiles.splice(idx, 1);
                if (config.activeProfileName === target.name) config.activeProfileName = '';
                const saved = await saveApiConfig(config);
                renderProfileSelect(saved);
                alert('✅ 预设已删除');
            };
        }

        // 3. 💾 保存配置（保留预设并同步当前选中预设）
        const apiSaveBtn = document.getElementById('phone-api-save');
        if (apiSaveBtn) {
            apiSaveBtn.onclick = async () => {
                const config = readApiConfig();
                const formConfig = collectConfigFromForm();
                Object.assign(config, formConfig);

                const select = document.getElementById('phone-api-profile-select');
                const idx = select ? parseInt(select.value, 10) : -1;
                if (Number.isInteger(idx) && idx >= 0 && config.profiles[idx]) {
                    config.profiles[idx] = { ...config.profiles[idx], ...formConfig };
                    config.activeProfileName = config.profiles[idx].name;
                }

                const saved = await saveApiConfig(config);
                renderProfileSelect(saved);
                alert('✅ 手机专属 API 配置已保存！');
            };
        }

        // 4. 🧪 测试连接
        let isTesting = false; // 防连击锁
        const apiTestBtn = document.getElementById('phone-api-test');
        if (apiTestBtn) {
            apiTestBtn.onclick = async () => {
                if (isTesting) return;
                isTesting = true;
                
                const originalText = apiTestBtn.innerText;
                apiTestBtn.innerText = '测试中...';
                
                const tempConfig = {
                    provider: document.getElementById('phone-api-provider')?.value || 'openai',
                    apiUrl: document.getElementById('phone-api-url')?.value.trim() || '',
                    apiKey: document.getElementById('phone-api-key')?.value.trim() || '',
                    model: document.getElementById('phone-api-model')?.value.trim() || '',
                    useIndependentAPI: true,
                    useStream: document.getElementById('phone-api-stream')?.checked !== false,
                    maxTokens: parseInt(document.getElementById('phone-api-tokens')?.value, 10) || 8192
                };

                try {
                    const apiManager = window.VirtualPhone?.apiManager;
                    const testMessages = [{ role: 'user', content: 'API连接测试是否成功？请只回复“连接成功”四个字。' }];
                    const result = await apiManager.callAI(testMessages, {
                        appId: 'phone_online',
                        max_tokens: 50,
                        overrideApiConfig: tempConfig
                    });

                    if (result.success) {
                        alert('✅ API 连接成功！\nAI 回复: ' + result.summary);
                    } else {
                        alert('❌ 测试失败：\n' + result.error);
                    }
                } catch (error) {
                    alert('❌ 连接异常：\n' + error.message);
                } finally {
                    apiTestBtn.innerText = originalText;
                    isTesting = false;
                }
            };
        }

        // 5. 🔄 拉取模型列表
        let isFetching = false; // 防连击锁
        const apiFetchBtn = document.getElementById('phone-api-fetch-models');
        if (apiFetchBtn) {
            apiFetchBtn.onclick = async () => {
                if (isFetching) return;
                isFetching = true;

                const originalText = apiFetchBtn.innerText;
                apiFetchBtn.innerText = '拉取中...';

                const apiManager = window.VirtualPhone?.apiManager;
                let apiUrl = (document.getElementById('phone-api-url')?.value.trim() || '').replace(/\/+$/, '');
                const apiKey = document.getElementById('phone-api-key')?.value.trim() || '';
                const provider = document.getElementById('phone-api-provider')?.value || 'openai';
                const authHeader = apiKey ? (apiKey.startsWith('Bearer ') ? apiKey : ('Bearer ' + apiKey)) : undefined;

                if (apiManager && typeof apiManager._processApiUrl === 'function') {
                    apiUrl = apiManager._processApiUrl(apiUrl, provider, true);
                } else if (provider !== 'gemini' && !apiUrl.includes('/v1') && !apiUrl.includes('/chat')) {
                    apiUrl += '/v1';
                }

                try {
                    const displayModelSelect = (models) => {
                        const select = document.getElementById('phone-api-model-select');
                        const input = document.getElementById('phone-api-model');
                        if (!select || !input) return;

                        select.innerHTML = '<option value="__manual__">-- 手动输入 --</option>' +
                            models.map((m) => `<option value="${m.id}">${m.name || m.id}</option>`).join('');
                        const currentVal = input.value.trim();
                        const modelIds = models.map((m) => m.id);
                        select.value = modelIds.includes(currentVal) ? currentVal : '__manual__';
                        input.style.display = 'none';
                        select.style.display = 'block';
                        select.onchange = (e) => {
                            if (e.target.value === '__manual__') {
                                select.style.display = 'none';
                                input.style.display = 'block';
                                input.focus();
                            } else {
                                input.value = e.target.value;
                            }
                        };
                    };

                    const normalizeModels = (list) => (list || [])
                        .map((m) => {
                            if (typeof m === 'string') return { id: m, name: m };
                            const id = m?.id || m?.model || m?.name;
                            if (!id) return null;
                            return { id, name: m?.name || id };
                        })
                        .filter(Boolean);

                    let models = [];
                    let proxyErrorMsg = null;

                    const runProxyRequest = async () => {
                        if (!apiManager || typeof apiManager._getCsrfToken !== 'function') {
                            throw new Error('ApiManager 未初始化，无法使用后端代理拉取');
                        }

                        const csrfToken = await apiManager._getCsrfToken();
                        let targetSource = 'custom';
                        if (provider === 'openai' || provider === 'deepseek' || provider === 'siliconflow') {
                            targetSource = 'openai';
                        }

                        const customHeaders = { 'Content-Type': 'application/json' };
                        if (targetSource === 'custom' && authHeader) {
                            customHeaders.Authorization = authHeader;
                        }

                        const proxyPayload = {
                            chat_completion_source: targetSource,
                            custom_url: apiUrl,
                            reverse_proxy: apiUrl,
                            proxy_password: apiKey,
                            custom_include_headers: customHeaders
                        };

                        try {
                            const response = await fetch('/api/backends/chat-completions/status', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                                body: JSON.stringify(proxyPayload),
                                credentials: 'include'
                            });
                            const text = await response.text();
                            if (!response.ok) throw new Error(`后端代理请求失败: ${response.status} ${text.substring(0, 300)}`);

                            let rawData;
                            try {
                                rawData = JSON.parse(text);
                            } catch (e) {
                                throw new Error(`后端返回非JSON格式: ${text.substring(0, 120)}`);
                            }

                            let parsed = parseOpenAIModelsResponse(rawData);
                            if (!parsed.length) {
                                parsed = normalizeModels(rawData?.data || rawData?.models || (Array.isArray(rawData) ? rawData : []));
                            }
                            if (parsed.length > 0) return parsed;
                            throw new Error('后端代理返回空模型列表');
                        } catch (firstError) {
                            if ((provider === 'proxy_only' || provider === 'compatible') && targetSource === 'custom') {
                                let v1Url = apiUrl;
                                if (!v1Url.includes('/v1') && !v1Url.includes('/models')) {
                                    v1Url = v1Url.replace(/\/+$/, '') + '/v1';
                                }
                                const retryPayload = {
                                    chat_completion_source: 'openai',
                                    reverse_proxy: v1Url,
                                    proxy_password: apiKey
                                };
                                const retryResp = await fetch('/api/backends/chat-completions/status', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                                    body: JSON.stringify(retryPayload),
                                    credentials: 'include'
                                });
                                const retryText = await retryResp.text();
                                if (!retryResp.ok) throw new Error(`降级重试失败: ${retryResp.status} ${retryText.substring(0, 300)}`);

                                let retryData;
                                try {
                                    retryData = JSON.parse(retryText);
                                } catch {
                                    throw new Error(`降级重试返回非JSON: ${retryText.substring(0, 120)}`);
                                }

                                let parsed = parseOpenAIModelsResponse(retryData);
                                if (!parsed.length) {
                                    parsed = normalizeModels(retryData?.data || retryData?.models || (Array.isArray(retryData) ? retryData : []));
                                }
                                if (parsed.length > 0) return parsed;
                                throw new Error('降级重试返回空模型列表');
                            }
                            throw firstError;
                        }
                    };

                    const forceProxy = (provider === 'local' || provider === 'openai' || provider === 'claude' || provider === 'proxy_only' || provider === 'deepseek' || provider === 'siliconflow');
                    if (forceProxy || provider === 'compatible') {
                        try {
                            models = await runProxyRequest();
                        } catch (e) {
                            proxyErrorMsg = e.message;
                        }
                    }

                    if (models.length === 0) {
                        try {
                            let directUrl = `${apiUrl}/models`;
                            const headers = { 'Content-Type': 'application/json' };

                            if (provider === 'gemini') {
                                if (apiUrl.includes('googleapis.com') && !apiUrl.toLowerCase().includes('/v1')) {
                                    directUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
                                } else if (authHeader) {
                                    headers.Authorization = authHeader;
                                }
                            } else if (authHeader) {
                                headers.Authorization = authHeader;
                            }

                            const resp = await fetch(directUrl, { method: 'GET', headers });
                            const text = await resp.text();
                            if (!resp.ok) throw new Error(`浏览器直连失败: HTTP ${resp.status} ${text.substring(0, 300)}`);

                            let data;
                            try {
                                data = JSON.parse(text);
                            } catch {
                                throw new Error(`直连返回非JSON格式: ${text.substring(0, 120)}`);
                            }

                            if (provider === 'gemini' && Array.isArray(data?.models)) {
                                models = data.models.map((m) => ({
                                    id: String(m.name || '').replace(/^models\//, ''),
                                    name: m.displayName || m.name
                                })).filter((m) => m.id);
                            } else {
                                models = parseOpenAIModelsResponse(data);
                                if (!models.length) {
                                    models = normalizeModels(data?.data || data?.models || (Array.isArray(data) ? data : []));
                                }
                            }
                        } catch (directErr) {
                            if (proxyErrorMsg) {
                                throw new Error(`后端代理失败: ${proxyErrorMsg}\n直连失败: ${directErr.message}`);
                            }
                            throw directErr;
                        }
                    }

                    if (!models.length) {
                        throw new Error('未找到模型列表');
                    }

                    displayModelSelect(models);
                    alert(`✅ 成功拉取 ${models.length} 个模型！请在下拉框中选择。`);
                } catch (error) {
                    const baseMsg = `❌ 拉取失败: ${error.message}`;
                    alert(baseMsg + '\n\n您可以直接在下方输入框手动填写模型名。');
                } finally {
                    apiFetchBtn.innerText = originalText;
                    isFetching = false;
                }
            };
        }
    }

    // ⏰ 更新手机时间显示
    updatePhoneTimeDisplay() {
        const timeDisplay = document.getElementById('current-phone-time');
        if (!timeDisplay) return;

        try {
            const timeManager = window.VirtualPhone?.timeManager;
            if (timeManager) {
                const currentTime = timeManager.getCurrentStoryTime();
                timeDisplay.textContent = `${currentTime.date || '未知'} ${currentTime.time || '未知'} ${currentTime.weekday || ''}`;
            } else {
                timeDisplay.textContent = '时间管理器未初始化';
            }
        } catch (e) {
            console.error('❌ 获取手机时间失败:', e);
            timeDisplay.textContent = '获取失败';
        }
    }

    // ⏰ 从正文同步时间
    syncTimeFromChat() {
        try {
            const context = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
                ? SillyTavern.getContext()
                : null;

            if (!context || !context.chat || context.chat.length === 0) {
                alert('❌ 无法获取聊天记录');
                return;
            }

            // 从最后一条AI消息中提取时间
            let extractedTime = null;
            for (let i = context.chat.length - 1; i >= 0; i--) {
                const msg = context.chat[i];
                if (!msg.is_user && msg.mes) {
                    extractedTime = this.parseTimeFromMessage(msg.mes);
                    if (extractedTime) break;
                }
            }

            if (extractedTime) {
                // 更新到 TimeManager
                const timeManager = window.VirtualPhone?.timeManager;
                if (timeManager && timeManager.setTime) {
                    // 🔥 传递星期
                    timeManager.setTime(extractedTime.time, extractedTime.date, extractedTime.weekday);
                    this.updatePhoneTimeDisplay();

                    // 🔥 同步更新状态栏时间
                    const phoneShell = window.VirtualPhone?.phoneShell;
                    if (phoneShell?.updateStatusBarTime) {
                        phoneShell.updateStatusBarTime();
                    }

                    // 🔥 同步更新主屏幕时间
                    const home = window.VirtualPhone?.home;
                    if (home?.updateTimeDisplay) {
                        home.updateTimeDisplay();
                    }

                    // 🔥 通知中显示星期
                    alert(`✅ 时间已同步：${extractedTime.date} ${extractedTime.weekday} ${extractedTime.time}`);
                } else {
                    alert('❌ 时间管理器未初始化');
                }
            } else {
                alert(
                    '❌ 未能从正文中识别到可解析的时间格式\n\n' +
                    '可用示例：\n' +
                    '1) 417年11月7日|星期三|21:28\n' +
                    '2) 417年11月7日 星期三 21:28\n' +
                    '3) 417/11/7 21:28\n' +
                    '4) 417年11月7日 星期三 2128\n' +
                    '5) <statusbar>417年11月7日·星期三·21:28</statusbar>'
                );
            }
        } catch (e) {
            console.error('❌ 时间同步失败:', e);
            alert('❌ 时间同步失败：' + e.message);
        }
    }

    // ⏰ 从消息中解析时间（支持多种格式）
    parseTimeFromMessage(text) {
        const rawText = String(text || '');

        // 优先复用 TimeManager 的统一解析（支持无标签正文、竖线/斜杠、紧凑时间等）
        try {
            const parsedByTimeManager = window.VirtualPhone?.timeManager?.parseStatusbar?.(rawText);
            if (parsedByTimeManager?.date && parsedByTimeManager?.time) {
                return {
                    time: parsedByTimeManager.time,
                    date: parsedByTimeManager.date,
                    weekday: parsedByTimeManager.weekday
                };
            }
        } catch (e) {
            // 忽略，继续走本地兜底解析
        }

        // 兜底本地解析
        const tagMatch = rawText.match(/<(statusbar|globalTime|time)>([\s\S]*?)<\/\1>/i);
        const baseContent = tagMatch ? tagMatch[2] : rawText;
        const content = String(baseContent)
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/｜/g, '|')
            .replace(/／/g, '/');

        const dateMatch = content.match(/(\d{1,6})[-\/年]\s*(\d{1,2})[-\/月]\s*(\d{1,2})\s*日?/);
        const dateToken = dateMatch?.[0] || '';
        const afterDateContent = dateToken ? content.slice(content.indexOf(dateToken) + dateToken.length) : content;
        const standardTimeMatch = afterDateContent.match(/(\d{1,2})\s*[:：时]\s*(\d{1,2})(?:\s*分)?/);
        const compactTimeMatch = standardTimeMatch
            ? null
            : afterDateContent.match(/(?:^|[^\d])([01]?\d|2[0-3])([0-5]\d)(?:$|[^\d])/);
        const weekdayMatch = content.match(/(星期[一二三四五六日天]|周[一二三四五六日天])/);

        if (dateMatch && (standardTimeMatch || compactTimeMatch)) {
            const year = parseInt(dateMatch[1]);
            const month = parseInt(dateMatch[2]);
            const day = parseInt(dateMatch[3]);
            const hour = String(parseInt(standardTimeMatch ? standardTimeMatch[1] : compactTimeMatch[1])).padStart(2, '0');
            const minute = String(parseInt(standardTimeMatch ? standardTimeMatch[2] : compactTimeMatch[2])).padStart(2, '0');

            // 🔥 优先使用正文中的星期，否则用蔡勒公式计算
            let weekday;
            if (weekdayMatch) {
                weekday = weekdayMatch[1].replace('周', '星期'); // 统一转为星期X
                if (weekday === '星期天') weekday = '星期日';
            } else {
                weekday = this.calculateWeekday(year, month, day);
            }

            return {
                time: `${hour}:${minute}`,
                // 🔥 关键：返回给系统底层时，强制统一成标准格式，防止其他地方报错
                date: `${year}年${String(month).padStart(2, '0')}月${String(day).padStart(2, '0')}日`,
                weekday: weekday
            };
        }

        return null;
    }

    // 🔥 使用蔡勒公式计算星期几（支持任意年份）
    calculateWeekday(year, month, day) {
        let y = year;
        let m = month;

        if (m < 3) {
            m += 12;
            y -= 1;
        }

        const q = day;
        const k = y % 100;
        const j = Math.floor(y / 100);

        let h = (q + Math.floor((13 * (m + 1)) / 5) + k + Math.floor(k / 4) + Math.floor(j / 4) - 2 * j) % 7;
        h = ((h % 7) + 7) % 7;

        const weekdays = ['星期六', '星期日', '星期一', '星期二', '星期三', '星期四', '星期五'];
        return weekdays[h];
    }

    // ⚠️ 已废弃：以下方法保留以防兼容性问题，但不再使用
    // 🎨 应用颜色到页面的方法（旧版）
    applyColors() {
        // 已被统一的全局文字颜色系统替代
        console.warn('⚠️ applyColors() 已废弃，请使用全局文字颜色系统');
    }

    // 🎨 判断颜色是否为浅色（旧版）
    isLightColor(color) {
        const hex = color.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 155;
    }
    
    updatePhoneIcon() {
        const icon = document.getElementById('phoneDrawerIcon');
        if (icon) {
            if (this.settings.enabled) {
                icon.style.opacity = '1';
                icon.style.filter = 'none';
                icon.title = '虚拟手机 (已启用)';
            } else {
                icon.style.opacity = '0.4';
                icon.style.filter = 'grayscale(1)';
                icon.title = '虚拟手机 (已禁用)';
            }
        }
    }
}
