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

const CARD_LAYOUT_CUSTOM_CSS_KEY = 'phone-card-layout-custom-css';
const CARD_LAYOUT_CUSTOM_STYLE_ID = 'phone-card-layout-custom-css-style';
const CARD_LAYOUT_GUARD_STYLE_ID = 'phone-card-layout-guard-css-style';

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

        const homeLayout = this.getHomeLayout();
        const hasCardCustomCss = homeLayout === 'cards' && !!this.getCardLayoutCustomCssText();
        const cardCustomClass = hasCardCustomCss ? ' home-card-custom-css-active yzp-home-card-custom-css-active' : '';
        this.preloadCardLayoutCustomCss();

        const html = `
            <div class="home-screen yzp-home-screen home-layout-${homeLayout} yzp-home-layout-${homeLayout}${cardCustomClass}"${renderKeyAttr}>
                <div class="wallpaper" style="${wallpaperStyle}"></div>

                ${homeLayout === 'cards' ? this.renderCardLayout() : this.renderIconLayout()}

                <div class="dock yzp-home-dock">
                    ${this.renderDock()}
                </div>
            </div>
        `;

        this.phoneShell.setContent(html);
        this.bindEvents();
    }

    getHomeLayout() {
        const layout = String(window.VirtualPhone?.storage?.get('phone-home-layout') || 'icons');
        return layout === 'cards' ? 'cards' : 'icons';
    }

    getCardLayoutCustomCssText() {
        return String(window.VirtualPhone?.storage?.get?.(CARD_LAYOUT_CUSTOM_CSS_KEY) || '').trim();
    }

    applyCardLayoutCustomCss() {
        const existing = document.getElementById(CARD_LAYOUT_CUSTOM_STYLE_ID);
        existing?.remove();
        const existingGuard = document.getElementById(CARD_LAYOUT_GUARD_STYLE_ID);
        existingGuard?.remove();

        if (this.getHomeLayout() !== 'cards') return;
        const cssText = this.getCardLayoutCustomCssText();
        if (cssText) {
            const style = document.createElement('style');
            style.id = CARD_LAYOUT_CUSTOM_STYLE_ID;
            style.setAttribute('data-scope', 'phone-card-layout');
            style.textContent = cssText;
            (this.phoneShell?.screen || document.head).appendChild(style);
        }

        this.applyCardLayoutGuardCss();
    }

    preloadCardLayoutCustomCss() {
        document.getElementById(CARD_LAYOUT_CUSTOM_STYLE_ID)?.remove();
        document.getElementById(CARD_LAYOUT_GUARD_STYLE_ID)?.remove();
        if (this.getHomeLayout() !== 'cards') return;

        const cssText = this.getCardLayoutCustomCssText();
        if (cssText) {
            const style = document.createElement('style');
            style.id = CARD_LAYOUT_CUSTOM_STYLE_ID;
            style.setAttribute('data-scope', 'phone-card-layout');
            style.setAttribute('data-owner', 'document-head');
            style.textContent = cssText;
            document.head.appendChild(style);
        }
        this.applyCardLayoutGuardCss(document.head);
    }

    applyCardLayoutGuardCss(host = null) {
        const style = document.createElement('style');
        style.id = CARD_LAYOUT_GUARD_STYLE_ID;
        style.setAttribute('data-scope', 'phone-card-layout-guard');
        style.textContent = `
            #phone-panel-content .phone-screen .home-layout-cards .dock {
                position: absolute !important;
                left: 50% !important;
                right: auto !important;
                top: auto !important;
                width: auto !important;
                max-width: calc(100% - 12%) !important;
                height: auto !important;
                transform: translateX(-50%) !important;
                box-sizing: border-box !important;
            }

            @media (min-width: 501px) {
                #phone-panel-content .phone-screen .home-layout-cards .dock {
                    width: calc(100% - 12%) !important;
                    bottom: 11.5% !important;
                }
            }

        `;
        (host || this.phoneShell?.screen || document.head).appendChild(style);
    }

    renderIconLayout() {
        return `
            <div class="home-time yzp-home-time">
                <div class="time-large yzp-home-time-large">${this.getCurrentTime()}</div>
                <div class="date yzp-home-date">${this.getCurrentDate()}</div>
            </div>
            <div class="app-grid yzp-home-app-grid">
                ${this.apps.map(app => this.renderAppIcon(app)).join('')}
            </div>
        `;
    }

    renderCardLayout() {
        const timeCardImage = this.getCardTimeImage();
        const timeCardImageStyle = timeCardImage
            ? ` style="background-image:url('${timeCardImage}');"`
            : '';
        const cardDate = this.getCurrentDateParts();
        return `
            <div class="home-dashboard yzp-home-dashboard">
                <section class="home-time-card yzp-home-time-card yzp-home-floating-time${timeCardImage ? ' has-image' : ''}"${timeCardImageStyle}>
                    <div class="home-time-info yzp-home-time-info">
                        <div class="time-large yzp-home-time-large">${this.getCurrentTime()}</div>
                        <div class="home-time-date yzp-home-time-date">
                            <div class="date yzp-home-date">${this._escapeHtml(cardDate.date)}</div>
                            <div class="home-time-weekday yzp-home-time-weekday">${this._escapeHtml(cardDate.weekday)}</div>
                        </div>
                    </div>
                </section>

                <section class="home-app-cluster yzp-home-app-cluster">
                    <div class="home-app-cluster-scroll yzp-home-app-cluster-scroll">
                        ${this.renderClusterApps()}
                    </div>
                </section>
                ${this.renderSocialCard()}
                ${this.renderSettingsCard()}
                ${this.renderMusicCard()}
            </div>
        `;
    }

    getCardTimeImage() {
        return window.VirtualPhone?.storage?.get?.('phone-card-time-image') || null;
    }

    getAppById(appId) {
        return this.apps.find(app => app.id === appId) || null;
    }

    _escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _getCustomIcon(appId) {
        try {
            if (window.VirtualPhone?.imageManager) {
                return window.VirtualPhone.imageManager.getAppIcon(appId);
            }
        } catch (e) {
            console.warn('获取APP图标失败:', e);
        }
        return null;
    }

    _buildCustomIconStyle(iconUrl, { fit = 'contain' } = {}) {
        const safeUrl = String(iconUrl || '').trim();
        if (!safeUrl) return '';
        const escapedUrl = safeUrl
            .replace(/\\/g, '/')
            .replace(/'/g, "\\'")
            .replace(/\)/g, '\\)');
        return [
            `background-image: url('${escapedUrl}')`,
            `background-size: ${fit}`,
            'background-position: center',
            'background-repeat: no-repeat',
            'background-color: transparent'
        ].join('; ') + ';';
    }

    _renderCustomIconImage(iconUrl, className = 'home-custom-icon-img') {
        const safeUrl = String(iconUrl || '').trim();
        if (!safeUrl) return '';
        return `<img class="${className}" src="${this._escapeHtml(safeUrl)}" alt="" loading="eager" decoding="sync" draggable="false">`;
    }

    _getCustomAppNames() {
        try {
            const raw = window.VirtualPhone?.storage?.get?.('phone-app-custom-names');
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) {
            console.warn('读取自定义APP名称失败:', e);
            return {};
        }
    }

    _getAppDisplayName(app) {
        const customNames = this._getCustomAppNames();
        const customName = String(customNames?.[app?.id] || '').trim();
        return customName || String(app?.name || '');
    }

    renderAppGlyph(app, className = 'home-widget-icon') {
        if (!app) return '';
        const customIcon = this._getCustomIcon(app.id);
        if (customIcon) {
            return `<span class="${className} custom-icon" style="${this._buildCustomIconStyle(customIcon)}"></span>`;
        }
        return `<span class="${className}" style="--app-color:${app.color};">${this._escapeHtml(app.icon)}</span>`;
    }

    renderAppBadge(app) {
        return app?.badge > 0 ? `<span class="app-badge yzp-home-app-badge">${app.badge}</span>` : '';
    }

    renderMusicCard() {
        const app = this.getAppById('music');
        if (!app) return '';
        return `
            <section class="yzp-home-app-action home-widget-card yzp-home-widget-card home-music-card yzp-home-music-card" data-app="${app.id}">
                <div class="home-vinyl-player yzp-home-vinyl-player" aria-hidden="true">
                    <div class="home-vinyl-record yzp-home-vinyl-record">
                        <div class="home-vinyl-grooves yzp-home-vinyl-grooves"></div>
                        ${this.renderAppGlyph(app, 'home-vinyl-cover yzp-home-vinyl-cover')}
                    </div>
                    <div class="home-tonearm yzp-home-tonearm">
                        <div class="home-tonearm-pivot yzp-home-tonearm-pivot"></div>
                        <div class="home-tonearm-curve yzp-home-tonearm-curve">
                            <div class="home-tonearm-head yzp-home-tonearm-head"></div>
                        </div>
                    </div>
                </div>
                <div class="home-music-panel yzp-home-music-panel">
                    <div class="home-card-title yzp-home-card-title">${this._escapeHtml(this._getAppDisplayName(app))}</div>
                    <div class="home-music-controls yzp-home-music-controls" aria-hidden="true">
                        <span class="home-music-control home-music-control-prev"></span>
                        <span class="home-music-control home-music-control-pause"></span>
                        <span class="home-music-control home-music-control-next"></span>
                    </div>
                </div>
                ${this.renderAppBadge(app)}
            </section>
        `;
    }

    renderSocialCard() {
        const socialIds = ['wechat', 'weibo', 'album'];
        const socialApps = socialIds.map(id => this.getAppById(id)).filter(Boolean);
        if (socialApps.length === 0) return '';
        return `
            <section class="home-social-card yzp-home-social-card">
                ${socialApps.map(app => this.renderSocialApp(app)).join('')}
            </section>
        `;
    }

    renderSocialApp(app) {
        if (!app) return '';
        const customIcon = this._getCustomIcon(app.id);
        const iconStyle = customIcon
            ? this._buildCustomIconStyle(customIcon)
            : `background:${app.color};`;
        const iconContent = customIcon ? '' : this._escapeHtml(app.icon);
        const customClass = customIcon ? 'custom-icon' : '';
        return `
            <div class="app-icon yzp-home-app-action home-social-app yzp-home-social-app" data-app="${app.id}" style="--app-color:${app.color};">
                <div class="home-social-icon yzp-home-social-icon ${customClass}" style="${iconStyle}">
                    ${iconContent}
                </div>
                ${this.renderAppBadge(app)}
                <div class="home-social-name yzp-home-social-name">${this._escapeHtml(this._getAppDisplayName(app))}</div>
            </div>
        `;
    }

    renderClusterApps() {
        const clusterIds = ['honey', 'games', 'phone', 'diary', 'calendar', 'mofo'];
        return clusterIds
            .map(id => this.getAppById(id))
            .filter(Boolean)
            .map(app => this.renderFreeAppIcon(app))
            .join('');
    }

    renderFreeAppIcon(app) {
        if (!app) return '';
        const customIcon = this._getCustomIcon(app.id);
        const iconStyle = customIcon
            ? this._buildCustomIconStyle(customIcon)
            : `background:${app.color};`;
        const iconContent = customIcon ? '' : this._escapeHtml(app.icon);
        const customClass = customIcon ? 'custom-icon' : '';
        return `
            <div class="app-icon yzp-home-app-action home-free-icon yzp-home-free-icon" data-app="${app.id}" style="--app-color:${app.color};">
                <div class="home-app-squircle yzp-home-app-squircle ${customClass}" style="${iconStyle}">
                    ${iconContent}
                </div>
                ${this.renderAppBadge(app)}
                <div class="home-mini-name yzp-home-mini-name">${this._escapeHtml(this._getAppDisplayName(app))}</div>
            </div>
        `;
    }

    renderDiaryCard() {
        const app = this.getAppById('diary');
        if (!app) return '';
        const diaryPreview = this.getLatestDiaryPreview();
        return `
            <section class="app-icon yzp-home-app-action home-diary-card yzp-home-diary-card" data-app="${app.id}" style="--app-color:${app.color};">
                <div class="home-diary-header yzp-home-diary-header">
                    ${this.renderAppGlyph(app, 'home-diary-icon yzp-home-diary-icon')}
                    <div class="home-card-title yzp-home-card-title">${this._escapeHtml(diaryPreview.title || this._getAppDisplayName(app))}</div>
                </div>
                <div class="home-diary-copy yzp-home-diary-copy">
                    <div class="home-card-desc yzp-home-card-desc">${this._escapeHtml(diaryPreview.preview)}</div>
                </div>
                ${this.renderAppBadge(app)}
            </section>
        `;
    }

    getLatestDiaryPreview() {
        const fallback = {
            title: '日记',
            preview: '记录今天的片段、心情和那些没说出口的话。'
        };

        try {
            const saved = window.VirtualPhone?.storage?.get?.('diary_entries', null);
            const entries = typeof saved === 'string' ? JSON.parse(saved) : saved;
            if (!Array.isArray(entries) || entries.length === 0) return fallback;

            const visibleEntries = entries.filter(entry => entry && entry.offlineHidden !== true && String(entry.content || '').trim());
            if (visibleEntries.length === 0) return fallback;

            const latest = [...visibleEntries].sort((a, b) => {
                const aTime = Number(a.createdAt) || this._dateToTimestamp(a.date || a.content) || 0;
                const bTime = Number(b.createdAt) || this._dateToTimestamp(b.date || b.content) || 0;
                return bTime - aTime;
            })[0];

            const rawContent = String(latest.content || '').replace(/\r\n/g, '\n').trim();
            const title = String(latest.title || this._extractDiaryTitle(rawContent) || '日记').trim();
            const preview = this._buildDiaryPreview(rawContent, title) || fallback.preview;

            return { title, preview };
        } catch (e) {
            console.warn('读取首页日记预览失败:', e);
            return fallback;
        }
    }

    _extractDiaryTitle(content) {
        const titleMatch = String(content || '').match(/【([^】]+)】/);
        if (titleMatch && !/\d{1,6}年/.test(titleMatch[1])) return titleMatch[1];
        const firstLine = String(content || '').split('\n').map(line => line.trim()).find(Boolean);
        return firstLine && firstLine.length <= 24 ? firstLine.replace(/^#+\s*/, '') : '';
    }

    _buildDiaryPreview(content, title) {
        const normalizedTitle = String(title || '').trim();
        return String(content || '')
            .replace(/【[^】]*】/g, '')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && line !== normalizedTitle && !/^[-—]{2,}/.test(line))
            .join(' ')
            .replace(/\s+/g, ' ')
            .slice(0, 72);
    }

    _dateToTimestamp(value) {
        const text = String(value || '');
        const match = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
        if (!match) return 0;
        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime() || 0;
    }

    renderFeatureCard(appId) {
        const app = this.getAppById(appId);
        if (!app) return '';
        return this.renderFreeAppIcon(app);
    }

    renderSettingsCard() {
        const app = this.getAppById('settings');
        if (!app) return '';
        return `
            <section class="yzp-home-app-action home-settings-card yzp-home-settings-card" data-app="${app.id}">
                <div class="home-settings-left yzp-home-settings-left">
                    ${this.renderAppGlyph(app, 'home-settings-icon yzp-home-settings-icon')}
                    <div class="home-settings-title yzp-home-settings-title">${this._escapeHtml(this._getAppDisplayName(app))}</div>
                </div>
                <div class="home-settings-chevron yzp-home-settings-chevron">›</div>
                ${this.renderAppBadge(app)}
            </section>
        `;
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
            const customIcon = this._getCustomIcon(app.id);

            const iconStyle = customIcon
                ? this._buildCustomIconStyle(customIcon)
                : '';

            const customClass = customIcon ? 'custom-icon' : '';
            const iconContent = customIcon ? '' : app.icon;

            return `
                <div class="dock-app yzp-home-dock-app ${customClass}" data-app="${app.id}" style="${iconStyle}">
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
            ? ''
            : '';

        const iconContent = customIcon
            ? this._renderCustomIconImage(customIcon, 'home-custom-icon-img yzp-home-custom-icon-img')
            : `<span class="app-icon-emoji yzp-home-app-icon-emoji">${app.icon}</span>`;

        // 自定义图标添加特殊class，用于移除默认背景效果
        const customClass = customIcon ? 'custom-icon' : '';

        return `
            <div class="app-icon yzp-home-app-icon yzp-home-app-action" data-app="${app.id}" style="--app-color: ${app.color}">
                <div class="app-icon-bg yzp-home-app-icon-bg ${customClass}" style="${iconStyle}">
                    ${iconContent}
                </div>
                ${badge}
                <div class="app-name yzp-home-app-name">${this._escapeHtml(this._getAppDisplayName(app))}</div>
            </div>
        `;
    }
    
    bindEvents() {
        const icons = this.phoneShell.screen.querySelectorAll('.yzp-home-app-action, .yzp-home-dock-app, .app-icon, .dock-app');
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
                this.render({ forceDomRefresh: true });
            });
        }

        // 监听APP图标更新
        if (!this._appIconEventBound) {
            this._appIconEventBound = true;
            window.addEventListener('phone:updateAppIcon', () => {
                this.render({ forceDomRefresh: true });
            });
        }

        if (!this._cardLayoutCssEventBound) {
            this._cardLayoutCssEventBound = true;
            window.addEventListener('phone:updateCardLayoutCss', () => {
                this.applyCardLayoutCustomCss();
            });
        }

        if (!this._timeUpdateEventBound) {
            this._timeUpdateEventBound = true;
            window.addEventListener('phone:timeUpdated', () => {
                this.updateTimeDisplay();
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

    getCurrentDateParts() {
        const dateText = this.getCurrentDate() || '';
        const match = dateText.match(/^(.+?日)\s*(.+)$/);
        if (match) {
            return {
                date: match[1],
                weekday: match[2],
            };
        }
        return {
            date: dateText,
            weekday: '',
        };
    }

    updateTimeDisplay() {
        const root = this.phoneShell?.screen?.querySelector('.home-screen');
        if (!root) return false;

        const currentTime = this.getCurrentTime() || '';
        const currentDate = this.getCurrentDate() || '';
        const cardDate = this.getCurrentDateParts();

        root.querySelectorAll('.time-large, .yzp-home-time-large').forEach(el => {
            el.textContent = currentTime;
        });
        root.querySelectorAll('.home-time > .date, .yzp-home-time > .yzp-home-date').forEach(el => {
            el.textContent = currentDate;
        });
        root.querySelectorAll('.home-time-date .date, .yzp-home-time-date .yzp-home-date').forEach(el => {
            el.textContent = cardDate.date;
        });
        root.querySelectorAll('.home-time-weekday, .yzp-home-time-weekday').forEach(el => {
            el.textContent = cardDate.weekday;
        });

        return true;
    }

}
