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

export class SettingsApp {
    constructor(phoneShell, storage, settings) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.settings = settings;
        this.imageManager = new ImageUploadManager(storage);
        this.currentTab = 'general'; // 可选值: 'general', 'memory', 'llm', 'tts'

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

                        <!-- 互动模式 -->
                        <div class="setting-section">
                            <div class="setting-section-title">📡 互动模式</div>

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

                            <div class="setting-info">
                                <strong>使用说明：</strong><br>
                                1. 开启"在线模式"<br>
                                2. 在对应APP设置中配置各功能提示词<br>
                                3. 在手机APP中发送消息，AI会自动回复
                            </div>
                        </div>

                        <!-- 消息记录设置 -->
                        <div class="setting-section">
                            <div class="setting-section-title">📨 消息记录</div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 14px; color: #000;">正文上下文楼层</span>
                                <input type="number" id="phone-context-limit" min="1" max="9999"
                                       value="${this.storage.get('phone-context-limit') || 20}"
                                       style="width: 55px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>
                        </div>

                        <!-- 线上模式 -->
                        <div class="setting-section">
                            <div class="setting-section-title">📱 线上模式（手机内聊天）</div>

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
                        </div>

                        <!-- 电话通话 -->
                        <div class="setting-section">
                            <div class="setting-section-title">📞 电话通话</div>
                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 14px; color: #000;">通话发送条数</span>
                                <input type="number" id="phone-call-limit" min="1" max="9999"
                                       value="${this.storage.get('phone-call-limit') || 10}"
                                       style="width: 55px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; text-align: center; font-size: 14px; background: #fafafa;">
                            </div>
                        </div>

                        <!-- 微博注入 -->
                        <div class="setting-section">
                            <div class="setting-section-title">🧾 微博注入（线下模式）</div>

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
                        </div>

                        <!-- 线下模式 -->
                        <div class="setting-section">
                            <div class="setting-section-title">📴 线下模式（酒馆正文注入）</div>

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
                                <div class="setting-value">v1.0.0</div>
                            </div>
                            <div class="setting-info">
                                每个角色的手机数据独立存储<br>
                                切换角色时自动加载对应的数据
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

                        <div class="setting-section">
                            <div class="setting-section-title">🖼️ 微信生图</div>
                            <div class="setting-info" style="margin-bottom: 10px;">
                                用于微信聊天里 AI 返回的 [图片]（描述）占位卡。点击后会直接调用 SiliconFlow 生图，默认走更快的小图参数。
                            </div>

                            <div class="setting-item">
                                <div class="setting-label">SiliconFlow API Key</div>
                                <input type="password" id="siliconflow-api-key"
                                       value="${this.storage.get('siliconflow_api_key') || ''}"
                                       placeholder="输入用于微信生图的 API Key"
                                       style="width: 100%; padding: 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 13px; background: #fafafa; box-sizing: border-box;">
                            </div>

                            <div class="setting-item">
                                <div class="setting-label">生图模型</div>
                                <input type="text" id="image-generation-model"
                                       value="${this.storage.get('image_generation_model') || 'Kwai-Kolors/Kolors'}"
                                       placeholder="Kwai-Kolors/Kolors"
                                       style="width: 100%; padding: 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 13px; background: #fafafa; box-sizing: border-box;">
                                <div class="setting-desc" style="margin-top: 6px;">默认模型：Kwai-Kolors/Kolors。当前代码会自动补“二次元、非真人、性别明确”的通用提示词，并使用 Kolor 官方推荐尺寸里的较小档 768x1024。</div>
                            </div>
                        </div>
                    </div>

                    <div class="tab-content" id="tab-tts" style="${this.currentTab === 'tts' ? '' : 'display: none;'}">
                        <!-- 🔊 语音功能 (TTS) -->
                        <div class="setting-section">
                            <div class="setting-section-title">🔊 语音功能 (TTS)</div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 14px; color: #000;">接口提供商</span>
                                <select id="phone-tts-provider" style="width: 140px; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa;">
                                    <option value="minimax_cn" ${(this.storage.get('phone-tts-provider') || 'minimax_cn') === 'minimax_cn' ? 'selected' : ''}>MiniMax国内版</option>
                                    <option value="minimax_intl" ${this.storage.get('phone-tts-provider') === 'minimax_intl' ? 'selected' : ''}>MiniMax国际版</option>
                                    <option value="openai" ${this.storage.get('phone-tts-provider') === 'openai' ? 'selected' : ''}>OpenAI兼容格式</option>
                                </select>
                            </div>

                            <div class="setting-item">
                                <div style="display: flex; align-items: center; justify-content: space-between;">
                                    <span style="font-size: 14px; color: #000;">API 接口地址</span>
                                    <select id="phone-tts-url-preset" style="width: 140px; height: 30px; padding: 0 4px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 11px; background: #fafafa;">
                                        <option value="">-- 快速选择 --</option>
                                        <option value="https://api.minimaxi.com/v1/t2a_v2">MiniMax 国内版</option>
                                        <option value="https://api.minimax.chat/v1/t2a_v2">MiniMax 国际版</option>
                                        <option value="https://api.openai.com/v1/audio/speech">OpenAI 官方</option>
                                    </select>
                                </div>
                                <input type="text" id="phone-tts-url"
                                       value="${this.storage.get('phone-tts-url') || ''}"
                                       placeholder="选择预设或手动输入地址"
                                       style="width: 100%; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; margin-top: 6px; box-sizing: border-box;">
                            </div>

                            <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-size: 14px; color: #000;">API Key</span>
                                <input type="password" id="phone-tts-key"
                                       value="${this.storage.get('phone-tts-key') || ''}"
                                       placeholder="输入API Key"
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
                                       value="${this.storage.get('phone-tts-model') || ''}"
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
                                <div style="display: flex; gap: 6px; margin-top: 6px;">
                                    <input type="text" id="phone-tts-voice"
                                           value="${this.storage.get('phone-tts-voice') || ''}"
                                           placeholder="输入音色ID，回车或失焦保存"
                                           style="flex: 1; height: 30px; padding: 0 8px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; background: #fafafa; box-sizing: border-box;">
                                </div>
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
                                    <span style="font-size: 10px; color: #999;">填写后自动记入历史列表</span>
                                    <button id="phone-tts-voice-delete" style="padding: 2px 8px; border: none; background: none; color: #ff3b30; font-size: 10px; cursor: pointer;">删除当前音色</button>
                                </div>
                            </div>

                            <div class="setting-item" style="margin-top: 14px; padding-top: 10px; border-top: 1px dashed #ececec;">
                                <div style="font-size: 12px; font-weight: 700; color: #333; margin-bottom: 8px;">💕 蜜语直播</div>

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
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.phoneShell.setContent(html);
        this.bindEvents();
    }
    // 渲染APP图标上传
    renderAppIconUpload() {
        // 从APPS配置中获取
        const APPS = [
            { id: 'wechat', name: '微信', icon: '💬', color: '#07c160' },
            { id: 'weibo', name: '微博', icon: '👁️‍🗨️', color: '#ff8200' },
            { id: 'honey', name: '蜜语', icon: '💕', color: '#ff6b9d' },
            { id: 'games', name: '游戏', icon: '🎮', color: '#722ed1' },
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

                // 🔥 上传到服务端，避免 Base64 撑大存档
                const serverUrl = await this.imageManager._uploadToServer(croppedImage, 'wallpaper');

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
                    detail: { wallpaper: croppedImage }
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

                    // 🔥 上传到服务端，避免 Base64 撑大存档
                    const serverUrl = await this.imageManager._uploadToServer(croppedImage, `icon_${appId}`);

                    this.imageManager.cache.appIcons[appId] = serverUrl;
                    await this.imageManager.saveImages(this.imageManager.cache);

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

        // 🖼️ 微信生图配置
        document.getElementById('siliconflow-api-key')?.addEventListener('change', async (e) => {
            await this.storage.set('siliconflow_api_key', String(e.target.value || '').trim());
        });

        document.getElementById('image-generation-model')?.addEventListener('change', async (e) => {
            const nextModel = String(e.target.value || '').trim() || 'Kwai-Kolors/Kolors';
            e.target.value = nextModel;
            await this.storage.set('image_generation_model', nextModel);
        });

        // 🔊 TTS 设置事件绑定
        const ttsProvider = document.getElementById('phone-tts-provider');
        const ttsUrl = document.getElementById('phone-tts-url');
        const ttsUrlPreset = document.getElementById('phone-tts-url-preset');
        const ttsKey = document.getElementById('phone-tts-key');
        const ttsModel = document.getElementById('phone-tts-model');
        const ttsModelPreset = document.getElementById('phone-tts-model-preset');
        const ttsVoice = document.getElementById('phone-tts-voice');
        const honeyTtsEnabledToggle = document.getElementById('phone-honey-tts-enabled');
        const honeyTtsModeSelect = document.getElementById('phone-honey-tts-mode');
        const honeyTtsCacheEnabledToggle = document.getElementById('phone-honey-tts-cache-enabled');

        if (ttsProvider) ttsProvider.addEventListener('change', async (e) => {
            const val = e.target.value;
            await this.storage.set('phone-tts-provider', val);
            // 联动填充默认 URL 和模型
            const defaults = {
                minimax_cn:   { url: 'https://api.minimaxi.com/v1/t2a_v2',    model: 'speech-02-hd' },
                minimax_intl: { url: 'https://api.minimax.chat/v1/t2a_v2',     model: 'speech-02-hd' },
                openai:       { url: 'https://api.openai.com/v1/audio/speech',  model: 'tts-1' }
            };
            const d = defaults[val];
            if (d) {
                if (ttsUrl) { ttsUrl.value = d.url; await this.storage.set('phone-tts-url', d.url); }
                if (ttsModel) { ttsModel.value = d.model; await this.storage.set('phone-tts-model', d.model); }
            }
        });

        // 接口地址预设下拉 → 填入输入框
        if (ttsUrlPreset) ttsUrlPreset.addEventListener('change', async (e) => {
            const val = e.target.value;
            if (!val) return;
            if (ttsUrl) { ttsUrl.value = val; await this.storage.set('phone-tts-url', val); }
            e.target.value = ''; // 重置下拉为占位项
        });

        // 模型预设下拉 → 填入输入框
        if (ttsModelPreset) ttsModelPreset.addEventListener('change', async (e) => {
            const val = e.target.value;
            if (!val) return;
            if (ttsModel) { ttsModel.value = val; await this.storage.set('phone-tts-model', val); }
            e.target.value = ''; // 重置下拉为占位项
        });

        if (ttsUrl) ttsUrl.addEventListener('change', async (e) => { await this.storage.set('phone-tts-url', e.target.value.trim()); });
        if (ttsKey) ttsKey.addEventListener('change', async (e) => { await this.storage.set('phone-tts-key', e.target.value.trim()); });
        if (ttsModel) ttsModel.addEventListener('change', async (e) => { await this.storage.set('phone-tts-model', e.target.value.trim()); });
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
            await this.storage.set('phone-tts-voice', val);
            // 自动加入历史列表（去重）
            if (val) {
                let history = [];
                try { history = JSON.parse(this.storage.get('phone-tts-voice-history') || '[]'); } catch(e) {}
                if (!history.includes(val)) {
                    history.push(val);
                    await this.storage.set('phone-tts-voice-history', JSON.stringify(history));
                    // 动态追加到下拉框
                    const preset = document.getElementById('phone-tts-voice-preset');
                    if (preset) {
                        const opt = document.createElement('option');
                        opt.value = val;
                        opt.textContent = val;
                        preset.appendChild(opt);
                    }
                }
            }
        });

        // 音色历史下拉 → 选择填入输入框
        const ttsVoicePreset = document.getElementById('phone-tts-voice-preset');
        if (ttsVoicePreset) {
            ttsVoicePreset.addEventListener('change', async (e) => {
                const val = e.target.value;
                if (!val) return;
                if (ttsVoice) { ttsVoice.value = val; await this.storage.set('phone-tts-voice', val); }
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
                        await this.storage.set('phone-tts-voice', '');
                    }
                }, 800);
            });
            ttsVoicePreset.addEventListener('mouseup', () => clearTimeout(voiceLongPressTimer));
            ttsVoicePreset.addEventListener('mouseleave', () => clearTimeout(voiceLongPressTimer));
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
                await this.storage.set('phone-tts-voice', '');

                this.phoneShell.showNotification('已删除', `音色「${currentVoice}」已移除`, '🗑️');
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
                    useIndependentAPI: p.useIndependentAPI === true,
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

                const merged = { ...config, ...profile, activeProfileName: profile.name };
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
