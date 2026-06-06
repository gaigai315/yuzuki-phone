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
// 🎵 音乐APP - 控制器
// ========================================

import { MusicData } from './music-data.js';
import { MusicView } from './music-view.js';

export class MusicApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.musicData = new MusicData(storage);
        this.view = new MusicView(this);

        // 数据变化时更新UI
        this.musicData.onStateChange = () => this.view.updateDisplay();
        this.musicData.onPlaybackStopped = (reason) => this.endWechatListening(reason);

        // 监听滑动返回。使用全局可替换 handler，避免热更新/重复实例留下旧的暂停监听。
        if (window._musicSwipeBackHandler) {
            window.removeEventListener('phone:swipeBack', window._musicSwipeBackHandler);
        }
        window._musicSwipeBackHandler = (e) => window.VirtualPhone?.musicApp?.handleSwipeBack?.(e);
        window.addEventListener('phone:swipeBack', window._musicSwipeBackHandler);

        if (window._musicGoHomeHandler) {
            window.removeEventListener('phone:goHome', window._musicGoHomeHandler);
        }
        window._musicGoHomeHandler = () => window.VirtualPhone?.musicApp?.handlePhoneNavigation?.();
        if (window._musicGoHomeCaptureGuard) {
            window.removeEventListener('phone:goHome', window._musicGoHomeCaptureGuard, true);
        }
        window._musicGoHomeCaptureGuard = () => {
            window._musicSuppressNavigationPauseUntil = Date.now() + 800;
        };
        window.addEventListener('phone:goHome', window._musicGoHomeCaptureGuard, true);
        window.addEventListener('phone:goHome', window._musicGoHomeHandler);
    }

    render() {
        this.view.renderSettings();
    }

    handlePhoneNavigation() {
        // App 切换、微信右滑返回或回到桌面都不应中断音乐，也不应结束一起听状态。
        this.view?.updateDisplay?.();
    }

    deactivate() {
        this.view?._stopProgressTimer?.();
        this.view?.updateDisplay?.();
    }

    endWechatListening(reason = '') {
        const wechatData = window.VirtualPhone?.wechatApp?.wechatData || window.VirtualPhone?.cachedWechatData;
        const sessions = wechatData?.data?.musicListening || {};
        Object.keys(sessions).forEach(chatId => {
            if (sessions[chatId]?.active === false) return;
            const ended = window.VirtualPhone?.wechatApp?.endMusicListening?.(chatId, { reason })
                || wechatData?.endMusicListening?.(chatId, { reason });
            if (ended && window.VirtualPhone?.wechatApp?.currentChat?.id === chatId) {
                window.VirtualPhone.wechatApp.syncMusicListenHeaderIndicator?.(chatId);
            }
        });
    }

    addSongToQueue(name, artist) {
        return this.musicData.addSong(name, artist);
    }

    updateCardData(parsed) {
        this.musicData.setCardData(parsed);
        this.view.updateDisplay();
    }

    handleSwipeBack(e) {
        // 防抖
        const now = Date.now();
        if (this._lastSwipeTime && now - this._lastSwipeTime < 400) return;
        this._lastSwipeTime = now;

        // 领地保护：检查当前是否在音乐APP界面
        const currentView = document.querySelector('.phone-view-current');
        if (!currentView || !currentView.querySelector('.music-app')) return;

        // 模拟点击返回按钮（与微信一致）
        const backBtn = currentView.querySelector('.music-back-btn');
        if (backBtn) {
            backBtn.click();
        } else {
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        }

        // Ghost Click Buster
        const screen = document.querySelector('.phone-screen');
        if (screen) {
            screen.style.pointerEvents = 'none';
            setTimeout(() => { screen.style.pointerEvents = ''; }, 400);
        }
    }

    // 初始化悬浮窗（在手机面板外部调用）
    initFloatingWidget() {
        const showFloating = this.storage.get('music_show_floating', false);
        if (showFloating) {
            this.view.renderFloatingWidget();
        }
    }

    // 清空缓存（切换聊天时调用）
    clearCache() {
        this.musicData.clearCache();
    }

    // 切换聊天时更新存储引用并刷新悬浮窗
    onChatChanged(newStorage) {
        // 1. 🔥 核心修复：彻底清空内存缓存并【停止音乐播放】！
        this.musicData.clearCache();

        // 2. 更新存储引用
        this.storage = newStorage;
        this.musicData.storage = newStorage;

        // 3. 销毁旧悬浮窗
        this.view.destroyFloatingWidget();

        // 4. 根据新会话的设置决定是否显示悬浮窗
        const showFloating = newStorage.get('music_show_floating', false);
        if (showFloating) {
            this.view.renderFloatingWidget();
        }

        // 5. 扫描新会话历史只恢复卡片，不把历史楼层里的歌曲重新加入歌单
        this._scanLastMessageForCard(true);

        // 6. 触发UI更新（防呆判断）
        if (typeof this.view.updateDisplay === 'function') {
            this.view.updateDisplay();
        }
    }

    // 扫描当前会话最后一条消息的 <Music> 标签（备用方案）
    // isSafeScan: 如果为 true，说明这是历史恢复/补救扫描，此时绝对不要重新入队歌曲或乱动播放状态
    _scanLastMessageForCard(isSafeScan = false) {
        try {
            const context = window.SillyTavern?.getContext?.() ||
                (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null);
            if (!context?.chat) return;

            for (let i = context.chat.length - 1; i >= 0; i--) {
                const msg = context.chat[i];
                if (msg.is_user) continue;

                const text = (msg.swipes && msg.swipes[msg.swipe_id || 0]) || msg.mes || '';
                const matches = [...text.matchAll(/<Music>([\s\S]*?)<\/Music>/gi)];
                
                if (matches && matches.length > 0) {
                    const lastMatch = matches[matches.length - 1];
                    
                    if (typeof window.VirtualPhone._parseMusicCard === 'function') {
                        const parsed = window.VirtualPhone._parseMusicCard(lastMatch[1]);
                        
                        // 只恢复面板展示数据
                        this.musicData.setCardData(parsed);
                        
                        // 🔥 如果是安全补救扫描（新楼层没发标签），绝不要重新把老歌塞进歌单，防断播
                        if (!isSafeScan && parsed.media && parsed.media.length >= 2) {
                            for (let j = 0; j < parsed.media.length - 1; j += 2) {
                                const songName = parsed.media[j].trim();
                                const artistName = parsed.media[j + 1].trim();
                                if (songName && artistName) {
                                    this.addSongToQueue(songName, artistName);
                                }
                            }
                        }

                        if (typeof this.view.updateDisplay === 'function') {
                            this.view.updateDisplay();
                        }
                    }
                    return; 
                }
            }
            
            // 如果连根拔起都找不到标签，且不是单纯的新消息补救，才清空卡片
            if (!isSafeScan) {
                this.musicData.setCardData(null);
                if (typeof this.view.updateDisplay === 'function') {
                    this.view.updateDisplay();
                }
            }
        } catch (e) {
            console.warn('🎵 [音乐] 扫描历史消息失败:', e);
        }
    }
 }
