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
// 主屏幕
import { APPS, PHONE_CONFIG } from '../config/apps.js'; // 🔥🔥🔥 这一行必须改！

export class HomeScreen {
    constructor(phoneShell, apps) {
        this.phoneShell = phoneShell;
        this.apps = apps || APPS; // 🔥 修复：确保 apps 有默认值
        this._homeRenderVersion = 0;
        
        // 🔥 修复：确保 window.VirtualPhone 存在
        const storage = window.VirtualPhone?.storage;
        if (storage) {
            this.wallpaper = storage.get('phone-wallpaper') || PHONE_CONFIG.defaultWallpaper;
        } else {
            this.wallpaper = PHONE_CONFIG.defaultWallpaper;
        }
    }

    // 🔥 新增：判断当前是否为主屏幕
    isHomeScreenVisible() {
        const homeScreenElement = this.phoneShell.screen?.querySelector('.home-screen');
        return !!homeScreenElement;
    }
    
    render(options = {}) {
        const forceDomRefresh = !!options.forceDomRefresh;
        if (forceDomRefresh) {
            this._homeRenderVersion += 1;
        }
        const renderKeyAttr = forceDomRefresh ? ` data-render-key="${this._homeRenderVersion}"` : '';

        // 获取自定义壁纸
        let customWallpaper = null;
        try {
            if (window.VirtualPhone?.imageManager) {
                customWallpaper = window.VirtualPhone.imageManager.getWallpaper();
            }
        } catch (e) {
            console.warn('获取壁纸失败:', e);
        }

        // 只有自定义壁纸时才设置内联样式，否则使用CSS中的玻璃效果
        const wallpaperStyle = customWallpaper
            ? `background-image: url('${customWallpaper}'); background-size: cover; background-position: center;`
            : '';

        const html = `
            <div class="home-screen"${renderKeyAttr}>
                <div class="wallpaper" style="${wallpaperStyle}"></div>

                <div class="home-time">
                    <div class="time-large">${this.getCurrentTime()}</div>
                    <div class="date">${this.getCurrentDate()}</div>
                </div>

                <div class="app-grid">
                    ${this.apps.map(app => this.renderAppIcon(app)).join('')}
                </div>

                <div class="dock">
                    ${this.renderDock()}
                </div>
            </div>
        `;

        this.phoneShell.setContent(html);
        this.bindEvents();
    }

    // 🔥 获取快捷栏配置
    getDockApps() {
        const storage = window.VirtualPhone?.storage;
        let dockAppIds = ['wechat', 'weibo', 'phone', 'settings']; // 默认4个

        if (storage) {
            const saved = storage.get('dock-apps');
            if (saved) {
                try {
                    dockAppIds = JSON.parse(saved);
                } catch (e) {
                    console.warn('解析dock配置失败:', e);
                }
            }
        }

        // 根据ID获取完整的app信息
        return dockAppIds.map(id => this.apps.find(app => app.id === id)).filter(Boolean);
    }

    // 🔥 渲染底部快捷栏
    renderDock() {
        const dockApps = this.getDockApps();

        return dockApps.map(app => {
            // 获取自定义图标
            let customIcon = null;
            try {
                if (window.VirtualPhone?.imageManager) {
                    customIcon = window.VirtualPhone.imageManager.getAppIcon(app.id);
                }
            } catch (e) {
                console.warn('获取dock图标失败:', e);
            }

            const iconStyle = customIcon
                ? `background-image: url('${customIcon}'); background-size: contain; background-position: center; background-repeat: no-repeat;`
                : '';

            const customClass = customIcon ? 'custom-icon' : '';
            const iconContent = customIcon ? '' : app.icon;

            return `
                <div class="dock-app ${customClass}" data-app="${app.id}" style="${iconStyle}">
                    ${iconContent}
                </div>
            `;
        }).join('');
    }
    
    renderAppIcon(app) {
        const badge = app.badge > 0 ? `<span class="app-badge">${app.badge}</span>` : '';
        
        // 获取自定义图标
        let customIcon = null;
        try {
            if (window.VirtualPhone?.imageManager) {
                customIcon = window.VirtualPhone.imageManager.getAppIcon(app.id);
            }
        } catch (e) {
            console.warn('获取APP图标失败:', e);
        }
        
        // 如果有自定义图标，用背景图；否则用emoji
        const iconStyle = customIcon
            ? `background-image: url('${customIcon}'); background-size: contain; background-position: center; background-repeat: no-repeat;`
            : '';

        const iconContent = customIcon ? '' : `<span class="app-icon-emoji">${app.icon}</span>`;

        // 自定义图标添加特殊class，用于移除默认背景效果
        const customClass = customIcon ? 'custom-icon' : '';

        return `
            <div class="app-icon" data-app="${app.id}" style="--app-color: ${app.color}">
                <div class="app-icon-bg ${customClass}" style="${iconStyle}">
                    ${iconContent}
                </div>
                ${badge}
                <div class="app-name">${app.name}</div>
            </div>
        `;
    }
    
    bindEvents() {
        const icons = this.phoneShell.screen.querySelectorAll('.app-icon, .dock-app');
        icons.forEach(icon => {
            icon.onclick = (e) => {
                e.stopPropagation();
                const appId = icon.dataset.app;
                this.openApp(appId);
            };
        });

        // 监听壁纸更新
        if (!this._wallpaperEventBound) {
            this._wallpaperEventBound = true;
            window.addEventListener('phone:updateWallpaper', (e) => {
                this.render();
            });
        }
    }
    
    openApp(appId) {
        window.dispatchEvent(new CustomEvent('phone:openApp', { 
            detail: { appId } 
        }));
    }
    
    getCurrentTime() {
        const timeManager = window.VirtualPhone?.timeManager;
        
        if (timeManager) {
            const storyTime = timeManager.getCurrentStoryTime();
            return storyTime?.time;
        }
        
        // 降级方案
        const now = new Date();
        return now.toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false
        });
    }
    
    getCurrentDate() {
    const timeManager = window.VirtualPhone?.timeManager;
    
    if (timeManager) {
        const storyTime = timeManager.getCurrentStoryTime();
        const dateParts = storyTime?.date?.match(/(\d+)年(\d+)月(\d+)日/);
        if (dateParts) {
            const year = parseInt(dateParts[1]);
            const month = parseInt(dateParts[2]);
            const day = parseInt(dateParts[3]);
            return `${year}年${month}月${day}日 ${storyTime.weekday}`;
        }
    }
    
    // 降级方案
    const now = new Date();
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const weekday = weekdays[now.getDay()];
    return `${year}年${month}月${day}日 ${weekday}`;
}

}

