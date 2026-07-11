/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

const WANGXIANG_BACKGROUND_URL = new URL('./wangxiang.png', import.meta.url).href;
const WANGXIANG_TITLE_URL = new URL('./wxbt.png', import.meta.url).href;
const WANGXIANG_NAV_BACKGROUND_URL = new URL('./wxanbj.png', import.meta.url).href;

const WANGXIANG_NAV_ITEMS = [
    { id: 'task-hall', label: '任务大厅', icon: 'fa-list-check' },
    { id: 'my-tasks', label: '我的任务', icon: 'fa-clipboard-check' },
    { id: 'marketplace', label: '商品商场', icon: 'fa-store' },
    { id: 'my-orders', label: '我的订单', icon: 'fa-receipt' }
];

const WANGXIANG_PRODUCTS = [
    { id: 'medical-case', name: '高级医疗补给箱', description: '内含高效治疗剂及应急医疗物资', price: '2,180', stock: 36, icon: 'fa-briefcase-medical', rarity: 'rare', category: '医疗补给', featured: true },
    { id: 'medical-pack', name: '便携医疗包', description: '快速恢复生命值30%', price: '680', stock: 127, icon: 'fa-kit-medical', rarity: 'epic', category: '医疗补给' },
    { id: 'ammo-case', name: '突击步枪弹药箱', description: '5.56mm通用弹药（200发）', price: '420', stock: 89, icon: 'fa-box-open', rarity: 'rare', category: '补给物资' },
    { id: 'combat-chip', name: '战术增强芯片', description: '提升暴击率+8%，持续30分钟', price: '1,280', stock: 56, icon: 'fa-microchip', rarity: 'excellent', category: '强化芯片' },
    { id: 'armor-plate', name: '复合装甲板', description: '减少受到的伤害15%', price: '2,680', stock: 34, icon: 'fa-shield-halved', rarity: 'epic', category: '战斗装备' },
    { id: 'scout-drone', name: '侦察无人机', description: '侦查周围区域，持续60秒', price: '1,980', stock: 21, icon: 'fa-plane', rarity: 'rare', category: '特殊道具' },
    { id: 'mystery-case', name: '神秘补给箱', description: '随机获得稀有或传说级物品', price: '4,880', stock: 12, icon: 'fa-cube', rarity: 'legendary', category: '特殊道具' }
];

const WANGXIANG_ORDERS = [
    { id: 'WX202507110001', name: '万象能量核心·标准版', quantity: 1, time: '2025-07-11 18:02:44', total: '1,280.00', status: '待付款', statusType: 'pending', icon: 'fa-cube', actions: ['取消订单', '去支付'] },
    { id: 'WX202507110002', name: '城市安全巡查设备套装', quantity: 2, time: '2025-07-10 16:45:21', total: '2,560.00', status: '待发货', statusType: 'shipping', icon: 'fa-box', actions: ['联系客服', '再次购买'] },
    { id: 'WX202507100003', name: '物资运输无人车·X1', quantity: 1, time: '2025-07-09 10:22:18', total: '5,680.00', status: '运输中', statusType: 'transit', icon: 'fa-truck-fast', actions: ['查看物流', '确认收货'] },
    { id: 'WX202507080004', name: '悬赏任务通行证（高级）', quantity: 1, time: '2025-07-08 09:15:33', total: '9,960.00', status: '已完成', statusType: 'completed', icon: 'fa-crosshairs', actions: ['再次购买', '联系客服'] }
];

export class WangxiangView {
    constructor(app) {
        this.app = app;
        this._cssLoaded = false;
        this._cssLoadingPromise = null;
        this.currentSection = 'task-hall';
        this.currentTaskId = '';
        this._taskRefreshStatus = 'idle';
        this._taskRefreshTimer = null;
    }

    async loadCSS() {
        if (this._cssLoaded) return true;
        if (this._cssLoadingPromise) return this._cssLoadingPromise;

        const existingLink = document.getElementById('wangxiang-css');
        if (existingLink?.dataset?.loaded === '1' || existingLink?.sheet) {
            this._cssLoaded = true;
            return true;
        }

        const link = existingLink || document.createElement('link');
        link.id = 'wangxiang-css';
        link.rel = 'stylesheet';
        link.href = new URL('./wangxiang.css', import.meta.url).href;
        this._cssLoadingPromise = new Promise(resolve => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                link.dataset.loaded = '1';
                this._cssLoaded = true;
                resolve(true);
            };
            link.addEventListener('load', finish, { once: true });
            link.addEventListener('error', finish, { once: true });
            setTimeout(finish, 1500);
        });
        if (!existingLink) document.head.appendChild(link);
        return this._cssLoadingPromise;
    }

    async render() {
        if (!this._cssLoaded && !document.getElementById('wangxiang-css')?.sheet) {
            this._renderLoadingView();
        }
        await this.loadCSS();
        this._renderContent();
    }

    _renderLoadingView() {
        this.app.phoneShell.setContent(`
            <div class="wangxiang-app wangxiang-loading" style="position:relative;width:100%;height:100%;overflow:hidden;background:#03121f url('${WANGXIANG_BACKGROUND_URL}') center/cover no-repeat;">
                <div style="position:absolute;inset:0;display:grid;place-items:center;color:#9fe7ff;">
                    <i class="fa-solid fa-spinner fa-spin" style="font-size:20px;filter:drop-shadow(0 0 6px rgba(92,211,255,.65));"></i>
                </div>
            </div>
        `, 'wangxiang-loading');
    }

    _renderContent() {
        this.app.phoneShell.setContent(`
            <div class="wangxiang-app">
                <div
                    class="wangxiang-background"
                    role="img"
                    aria-label="万象"
                    style="background-image: url('${WANGXIANG_BACKGROUND_URL}')"
                ></div>
                <img
                    class="wangxiang-title-image"
                    src="${WANGXIANG_TITLE_URL}"
                    alt="万象"
                    draggable="false"
                >
                <nav
                    class="wangxiang-primary-nav"
                    aria-label="万象主要功能"
                    style="background-image: url('${WANGXIANG_NAV_BACKGROUND_URL}')"
                >
                    ${WANGXIANG_NAV_ITEMS.map(item => this._renderNavItem(item)).join('')}
                </nav>
                ${this._renderTaskHallPanel()}
                ${this._renderTaskSettingsPanel()}
                ${this._renderMyTasksPanel()}
                ${this._renderMarketplacePanel()}
                ${this._renderOrdersPanel()}
                ${this._renderTaskDetailPanel()}
            </div>
        `, 'wangxiang-home');
        requestAnimationFrame(() => this._bindEvents());
    }

    _renderNavItem(item) {
        const isActive = this.currentSection === item.id;
        return `
            <button class="wangxiang-primary-nav-item${isActive ? ' is-active' : ''}" type="button" data-wangxiang-view="${item.id}" ${isActive ? 'aria-current="page"' : ''}>
                <span class="wangxiang-primary-nav-icon" aria-hidden="true">
                    <i class="fa-solid ${item.icon}"></i>
                </span>
                <span class="wangxiang-primary-nav-label">${item.label}</span>
            </button>
        `;
    }

    _panelState(section) {
        const isHidden = this.currentSection !== section;
        return {
            className: isHidden ? ' is-hidden' : '',
            ariaHidden: isHidden ? 'true' : 'false'
        };
    }

    _renderTaskHallPanel() {
        const state = this._panelState('task-hall');
        return `
            <section class="wangxiang-content-panel wangxiang-task-panel${state.className}" data-wangxiang-panel="task-hall" aria-hidden="${state.ariaHidden}" aria-labelledby="wangxiang-task-panel-title">
                <header class="wangxiang-task-header">
                    <div class="wangxiang-task-heading-row">
                        <div class="wangxiang-task-title-group">
                            <h1 class="wangxiang-task-title" id="wangxiang-task-panel-title">任务大厅</h1>
                            <button class="wangxiang-task-settings-open" type="button" aria-label="任务大厅设置" title="任务大厅设置">
                                <i class="fa-solid fa-gear" aria-hidden="true"></i>
                            </button>
                        </div>
                        <div class="wangxiang-task-tools">
                            <button class="wangxiang-task-sort" type="button">
                                <span>默认排序</span>
                                <i class="fa-solid fa-caret-down" aria-hidden="true"></i>
                            </button>
                            <button class="wangxiang-task-filter" type="button" aria-label="筛选任务" title="筛选任务">
                                <i class="fa-solid fa-filter" aria-hidden="true"></i>
                            </button>
                        </div>
                    </div>
                    <p class="wangxiang-task-subtitle">海量任务，真实可靠，自由接取，完成即可获得奖励。</p>
                </header>
                <div class="wangxiang-task-scroll wangxiang-content-scroll">
                    <div class="wangxiang-task-pull-indicator" aria-live="polite">
                        <div class="wangxiang-task-pull-inner"></div>
                    </div>
                    <div class="wangxiang-task-list">
                        ${this._renderTaskListContent()}
                    </div>
                </div>
            </section>
        `;
    }

    _renderTaskSettingsPanel() {
        const promptManager = window.VirtualPhone?.promptManager;
        const worldbookManager = window.VirtualPhone?.worldbookManager;
        const prompt = promptManager?.getPromptForFeature?.('wangxiang', 'tasks')
            || promptManager?.getDefaultPrompts?.()?.wangxiang?.tasks?.content
            || '';
        const useWorldbook = worldbookManager?.getEnabled?.('wangxiang') || false;
        const presetControls = promptManager?.renderPromptPresetControls?.('wangxiang', 'tasks') || '';

        return `
            <section class="wangxiang-content-panel wangxiang-task-settings-panel is-hidden" data-wangxiang-settings="tasks" aria-hidden="true" aria-labelledby="wangxiang-task-settings-title">
                <header class="wangxiang-settings-header">
                    <button class="wangxiang-settings-back" type="button" aria-label="返回任务大厅" title="返回任务大厅">
                        <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                    </button>
                    <div>
                        <h1 id="wangxiang-task-settings-title">任务大厅设置</h1>
                        <p>生成上下文与任务提示词</p>
                    </div>
                </header>
                <div class="wangxiang-settings-scroll wangxiang-content-scroll">
                    <section class="wangxiang-settings-section">
                        <div class="wangxiang-settings-section-heading">
                            <div>
                                <h2>世界书引用</h2>
                                <p>生成任务时注入勾选的酒馆世界书</p>
                            </div>
                            <label class="wangxiang-settings-toggle">
                                <input class="wangxiang-settings-toggle-input st-phone-toggle-input" id="wangxiang-use-worldbook" type="checkbox" ${useWorldbook ? 'checked' : ''}>
                                <span aria-hidden="true"></span>
                            </label>
                        </div>
                        <div id="wangxiang-worldbook-list" class="wangxiang-worldbook-list">
                            <p class="wangxiang-settings-message">正在读取当前可用世界书...</p>
                        </div>
                    </section>
                    <section class="wangxiang-settings-section wangxiang-prompt-section">
                        <div class="wangxiang-settings-section-heading">
                            <div>
                                <h2>任务生成提示词</h2>
                                <p>默认预设会随代码更新；需要修改时请新增自定义预设</p>
                            </div>
                        </div>
                        ${presetControls}
                        <textarea id="wangxiang-task-prompt" spellcheck="false" aria-label="任务生成提示词">${this._escapeHtml(prompt)}</textarea>
                    </section>
                </div>
            </section>
        `;
    }

    _renderTaskDetailPanel() {
        return `
            <section class="wangxiang-task-detail-panel is-hidden" data-wangxiang-task-detail aria-hidden="true" style="background-image:url('${WANGXIANG_BACKGROUND_URL}')">
                <header class="wangxiang-task-detail-header">
                    <button class="wangxiang-task-detail-back" type="button" aria-label="返回任务列表" title="返回任务列表">
                        <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                    </button>
                    <img src="${WANGXIANG_TITLE_URL}" alt="万象" draggable="false">
                </header>
                <div class="wangxiang-task-detail-scroll wangxiang-content-scroll"></div>
            </section>
        `;
    }

    _renderTaskDetailContent(task) {
        const accent = ['cyan', 'green', 'purple', 'orange'].includes(task.accent) ? task.accent : 'cyan';
        const statusMap = {
            available: { label: '可接取', icon: 'fa-satellite-dish' },
            active: { label: '进行中', icon: 'fa-satellite-dish' },
            submit: { label: '待提交', icon: 'fa-file-circle-check' },
            completed: { label: '已完成', icon: 'fa-circle-check' }
        };
        const status = statusMap[task.status] || statusMap.available;
        const difficulty = Math.max(1, Math.min(4, Number(task.difficulty || 1)));
        const objectives = Array.isArray(task.objectives) && task.objectives.length
            ? task.objectives
            : [{ id: 'objective-1', title: '完成任务要求', current: 0, total: 1, completed: false }];
        const comments = Array.isArray(task.comments) ? task.comments : [];
        const actionHtml = this._renderTaskDetailActions(task);

        return `
            <div class="wangxiang-task-detail-content is-${accent}" data-task-detail-id="${this._escapeHtml(task.id)}">
                <section class="wangxiang-task-detail-hero">
                    <div class="wangxiang-task-detail-title-row">
                        <h1><span>[${this._escapeHtml(task.level || '普通')}]</span>${this._escapeHtml(task.title)}</h1>
                        <div class="wangxiang-task-detail-status"><i class="fa-solid ${status.icon}" aria-hidden="true"></i>${status.label}</div>
                    </div>
                    <div class="wangxiang-task-detail-stats">
                        <div><i class="fa-solid fa-coins" aria-hidden="true"></i><span>信用点奖励<strong>${this._escapeHtml(task.reward || '0')}</strong></span></div>
                        <div><span>任务难度<strong class="wangxiang-task-detail-difficulty"><em>${this._escapeHtml(task.level || '普通')}</em>${Array.from({ length: difficulty }, () => '<i class="fa-solid fa-diamond"></i>').join('')}</strong></span></div>
                        <div><i class="fa-regular fa-clock" aria-hidden="true"></i><span>剩余时间<strong>${this._escapeHtml(task.remainingTime || '未注明')}</strong></span></div>
                    </div>
                </section>

                <section class="wangxiang-task-detail-publisher">
                    <div class="wangxiang-task-detail-publisher-icon"><i class="fa-solid ${this._escapeHtml(task.icon || 'fa-building-shield')}" aria-hidden="true"></i></div>
                    <div>
                        <span>任务发布人</span>
                        <h2>${this._escapeHtml(task.publisher || '万象任务中心')}</h2>
                        <p>${this._escapeHtml(task.publisherOrg || '独立委托方')}</p>
                        <strong>信誉等级：${this._escapeHtml(task.publisherReputation || '未知')}</strong>
                    </div>
                    <button type="button" data-task-detail-action="contact">联系发布人</button>
                </section>

                <section class="wangxiang-task-detail-section">
                    <h2><i class="fa-regular fa-clipboard" aria-hidden="true"></i>任务描述</h2>
                    <p class="wangxiang-task-detail-description">${this._escapeHtml(task.description || '暂无任务描述。')}</p>
                </section>

                <section class="wangxiang-task-detail-section">
                    <h2><i class="fa-solid fa-crosshairs" aria-hidden="true"></i>任务目标</h2>
                    <div class="wangxiang-task-detail-objectives">
                        ${objectives.map((objective, index) => this._renderTaskObjective(objective, index)).join('')}
                    </div>
                </section>

                <section class="wangxiang-task-detail-section">
                    <h2><i class="fa-solid fa-gift" aria-hidden="true"></i>任务奖励</h2>
                    <div class="wangxiang-task-detail-rewards">
                        <div><i class="fa-solid fa-coins"></i><span>信用点<strong>${this._escapeHtml(task.reward || '0')}</strong></span></div>
                        <div><i class="fa-solid fa-star"></i><span>声望值<strong>+${this._escapeHtml(task.prestige || '0')}</strong></span></div>
                        <div><i class="fa-solid fa-box-open"></i><span>额外奖励<strong>${this._escapeHtml(task.extraReward || '无')}</strong></span></div>
                    </div>
                </section>

                <section class="wangxiang-task-detail-section">
                    <h2><i class="fa-regular fa-rectangle-list" aria-hidden="true"></i>任务信息</h2>
                    <div class="wangxiang-task-detail-info">
                        <span><i class="fa-solid fa-location-dot"></i>任务地点<strong>${this._escapeHtml(task.location || '未注明')}</strong></span>
                        <span><i class="fa-regular fa-user"></i>推荐等级<strong>${this._escapeHtml(task.recommendedLevel || '无')}</strong></span>
                        <span><i class="fa-regular fa-clock"></i>预计时长<strong>${this._escapeHtml(task.duration || '未注明')}</strong></span>
                        <span><i class="fa-regular fa-calendar"></i>发布时间<strong>${this._escapeHtml(task.remaining || '--:--:--')}</strong></span>
                    </div>
                </section>

                <section class="wangxiang-task-detail-section wangxiang-task-detail-discussion">
                    <h2><i class="fa-regular fa-message" aria-hidden="true"></i>任务讨论<span>${comments.length} 条讨论</span></h2>
                    ${comments.length ? comments.map(comment => `
                        <article>
                            <div><i class="fa-solid fa-user-astronaut" aria-hidden="true"></i></div>
                            <p><strong>${this._escapeHtml(comment.name)} <small>${this._escapeHtml(comment.level)}</small></strong><span>${this._escapeHtml(comment.time)}</span>${this._escapeHtml(comment.content)}</p>
                        </article>
                    `).join('') : '<p class="wangxiang-task-detail-no-comments">暂无讨论</p>'}
                </section>

                <div class="wangxiang-task-detail-actions">${actionHtml}</div>
            </div>
        `;
    }

    _renderTaskObjective(objective, index) {
        const total = Math.max(1, Number(objective.total || 1));
        const current = Math.max(0, Math.min(total, Number(objective.current || 0)));
        const completed = objective.completed === true || current >= total;
        const percent = completed ? 100 : Math.round((current / total) * 100);
        const icons = ['fa-skull', 'fa-flask', 'fa-shield-halved', 'fa-location-crosshairs'];
        return `
            <div class="wangxiang-task-detail-objective${completed ? ' is-completed' : ''}">
                <i class="fa-solid ${icons[index % icons.length]}" aria-hidden="true"></i>
                <span>${this._escapeHtml(objective.title || `任务目标 ${index + 1}`)}</span>
                <div><i style="width:${percent}%"></i></div>
                <strong>${completed ? '已完成' : `${current}/${total}`}</strong>
            </div>
        `;
    }

    _renderTaskDetailActions(task) {
        if (task.status === 'completed') {
            return '<button type="button" class="is-completed" disabled><i class="fa-solid fa-circle-check"></i>任务已完成</button>';
        }
        if (task.status === 'submit') {
            return `
                <button type="button" class="is-danger" data-task-detail-action="abandon"><i class="fa-solid fa-xmark"></i>放弃任务</button>
                <button type="button" class="is-primary" data-task-detail-action="submit"><i class="fa-solid fa-file-circle-check"></i>提交任务</button>
            `;
        }
        if (task.status === 'active') {
            return `
                <button type="button" class="is-danger" data-task-detail-action="abandon"><i class="fa-solid fa-xmark"></i>放弃任务</button>
                <button type="button" class="is-primary" data-task-detail-action="track"><i class="fa-solid fa-location-crosshairs"></i>追踪任务</button>
            `;
        }
        return '<button type="button" class="is-primary" data-task-detail-action="accept"><i class="fa-solid fa-clipboard-check"></i>接取任务</button>';
    }

    _renderMyTasksPanel() {
        const state = this._panelState('my-tasks');
        return `
            <section class="wangxiang-content-panel wangxiang-my-tasks-panel${state.className}" data-wangxiang-panel="my-tasks" aria-hidden="${state.ariaHidden}" aria-label="我的任务">
                <div class="wangxiang-my-tasks-scroll wangxiang-content-scroll">
                    ${this._renderManagedTaskContent()}
                </div>
            </section>
        `;
    }

    _renderManagedTaskContent() {
        const groups = this._getManagedTaskGroups();
        if (groups.length) return groups.map(group => this._renderManagedTaskGroup(group)).join('');
        return `
            <div class="wangxiang-my-tasks-empty">
                <i class="fa-solid fa-clipboard-check" aria-hidden="true"></i>
                <strong>暂无已接取任务</strong>
            </div>
        `;
    }

    _getManagedTaskGroups() {
        const tasks = this.app.getManagedTasks?.() || [];
        const definitions = [
            { id: 'active', title: '进行中', hint: '任务进行中，请保持追踪', action: '继续追踪' },
            { id: 'submit', title: '待提交', hint: '任务已完成，可提交获取奖励', action: '提交任务' },
            { id: 'completed', title: '已完成', hint: '任务已完成，奖励已发放', action: '已完成' }
        ];
        return definitions.map(group => ({
            ...group,
            tasks: tasks
                .filter(task => task.status === group.id)
                .map(task => ({
                    ...task,
                    action: group.action,
                    completed: group.id === 'completed',
                    progress: group.id === 'active' ? Number(task.progress || 0) : 100
                }))
        })).filter(group => group.tasks.length > 0);
    }

    _renderManagedTaskGroup(group) {
        return `
            <section class="wangxiang-managed-group is-${group.id}">
                <header class="wangxiang-managed-group-header">
                    <h2>${this._escapeHtml(group.title)} <span>(${group.tasks.length})</span></h2>
                    <p>${this._escapeHtml(group.hint)}</p>
                </header>
                <div class="wangxiang-managed-group-list">
                    ${group.tasks.map(task => this._renderManagedTaskCard(task)).join('')}
                </div>
            </section>
        `;
    }

    _renderManagedTaskCard(task) {
        const accent = ['cyan', 'green', 'purple', 'orange'].includes(task.accent) ? task.accent : 'cyan';
        return `
            <article class="wangxiang-managed-task-card is-${accent}${task.completed ? ' is-completed' : ''}" data-task-id="${this._escapeHtml(task.id)}">
                <div class="wangxiang-managed-task-icon" aria-hidden="true">
                    <i class="fa-solid ${this._escapeHtml(task.icon)}"></i>
                </div>
                <div class="wangxiang-managed-task-main">
                    <h3>${this._escapeHtml(task.title)}</h3>
                    <p>${this._escapeHtml(task.description)}</p>
                    ${task.completed ? '' : `
                        <div class="wangxiang-managed-progress">
                            <span>${task.progress === 100 ? '完成进度' : '任务进度'}</span>
                            <div><i style="width:${Math.max(0, Math.min(100, task.progress))}%"></i></div>
                            <strong>${task.progress}%</strong>
                        </div>
                    `}
                    <div class="wangxiang-managed-task-meta">
                        <span><i class="fa-regular fa-clock" aria-hidden="true"></i>${this._escapeHtml(task.completedAt || task.remaining)}</span>
                        <span><i class="fa-solid fa-user" aria-hidden="true"></i>${this._escapeHtml(task.publisher)}</span>
                    </div>
                </div>
                <div class="wangxiang-managed-task-side">
                    <span>奖励</span>
                    <strong><small>¥</small>${this._escapeHtml(task.reward)}</strong>
                    <button type="button" data-managed-task-action="${this._escapeHtml(task.status)}" data-managed-task-id="${this._escapeHtml(task.id)}" ${task.completed ? 'disabled' : ''}>${this._escapeHtml(task.action)}</button>
                </div>
            </article>
        `;
    }

    _renderMarketplacePanel() {
        const state = this._panelState('marketplace');
        const featured = WANGXIANG_PRODUCTS.find(product => product.featured);
        const products = WANGXIANG_PRODUCTS.filter(product => !product.featured);
        const categories = ['全部', '补给物资', '战斗装备', '强化芯片', '医疗补给', '特殊道具'];

        return `
            <section class="wangxiang-content-panel wangxiang-market-panel${state.className}" data-wangxiang-panel="marketplace" aria-hidden="${state.ariaHidden}" aria-label="商品商场">
                <div class="wangxiang-market-toolbar">
                    <label class="wangxiang-market-search">
                        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                        <input type="search" placeholder="搜索商品名称或关键词" aria-label="搜索商品">
                    </label>
                    <button class="wangxiang-market-filter" type="button">
                        <i class="fa-solid fa-filter" aria-hidden="true"></i>
                        <span>筛选</span>
                    </button>
                </div>
                <div class="wangxiang-market-categories" role="tablist" aria-label="商品分类">
                    ${categories.map((category, index) => `
                        <button type="button" role="tab" class="${index === 0 ? 'is-active' : ''}" aria-selected="${index === 0}" data-market-category="${this._escapeHtml(category)}">${this._escapeHtml(category)}</button>
                    `).join('')}
                </div>
                <div class="wangxiang-market-scroll wangxiang-content-scroll">
                    ${this._renderFeaturedProduct(featured)}
                    <div class="wangxiang-product-grid">
                        ${products.map(product => this._renderProductCard(product)).join('')}
                    </div>
                </div>
            </section>
        `;
    }

    _renderFeaturedProduct(product) {
        if (!product) return '';
        return `
            <article class="wangxiang-featured-product">
                <div class="wangxiang-featured-copy">
                    <span class="wangxiang-product-promo">今日特惠</span>
                    <h2>${this._escapeHtml(product.name)}</h2>
                    <p>${this._escapeHtml(product.description)}</p>
                    <small>限时价</small>
                    <strong><span>¥</span>${this._escapeHtml(product.price)}</strong>
                </div>
                <div class="wangxiang-featured-visual" aria-hidden="true">
                    <i class="fa-solid ${this._escapeHtml(product.icon)}"></i>
                </div>
            </article>
        `;
    }

    _renderProductCard(product) {
        const rarityLabels = { epic: '史诗', rare: '稀有', excellent: '优秀', legendary: '传说' };
        const rarity = Object.prototype.hasOwnProperty.call(rarityLabels, product.rarity) ? product.rarity : 'rare';
        return `
            <article class="wangxiang-product-card is-${rarity}" data-product-id="${this._escapeHtml(product.id)}">
                <span class="wangxiang-product-rarity">${rarityLabels[rarity]}</span>
                <div class="wangxiang-product-visual" aria-hidden="true">
                    <i class="fa-solid ${this._escapeHtml(product.icon)}"></i>
                </div>
                <h3>${this._escapeHtml(product.name)}</h3>
                <p>${this._escapeHtml(product.description)}</p>
                <div class="wangxiang-product-price-row">
                    <strong><span>¥</span>${this._escapeHtml(product.price)}</strong>
                    <small>库存：${this._escapeHtml(product.stock)}</small>
                </div>
                <button class="wangxiang-product-buy" type="button">购买</button>
            </article>
        `;
    }

    _renderOrdersPanel() {
        const state = this._panelState('my-orders');
        const tabs = ['全部', '待付款', '待发货', '运输中', '已完成'];
        return `
            <section class="wangxiang-content-panel wangxiang-orders-panel${state.className}" data-wangxiang-panel="my-orders" aria-hidden="${state.ariaHidden}" aria-label="我的订单">
                <div class="wangxiang-order-tabs" role="tablist" aria-label="订单状态">
                    ${tabs.map((tab, index) => `
                        <button type="button" role="tab" class="${index === 0 ? 'is-active' : ''}" aria-selected="${index === 0}" data-order-tab="${this._escapeHtml(tab)}">${this._escapeHtml(tab)}</button>
                    `).join('')}
                </div>
                <div class="wangxiang-orders-scroll wangxiang-content-scroll">
                    ${WANGXIANG_ORDERS.map(order => this._renderOrderCard(order)).join('')}
                </div>
            </section>
        `;
    }

    _renderOrderCard(order) {
        return `
            <article class="wangxiang-order-card is-${this._escapeHtml(order.statusType)}" data-order-id="${this._escapeHtml(order.id)}">
                <header class="wangxiang-order-card-header">
                    <span>订单号：${this._escapeHtml(order.id)}</span>
                    <strong>${this._escapeHtml(order.status)}</strong>
                </header>
                <div class="wangxiang-order-card-body">
                    <div class="wangxiang-order-product-icon" aria-hidden="true">
                        <i class="fa-solid ${this._escapeHtml(order.icon)}"></i>
                    </div>
                    <div class="wangxiang-order-product-info">
                        <h2>${this._escapeHtml(order.name)}</h2>
                        <p>数量：×${this._escapeHtml(order.quantity)}</p>
                        <small>下单时间：${this._escapeHtml(order.time)}</small>
                    </div>
                    <div class="wangxiang-order-total">
                        <span>共${this._escapeHtml(order.quantity)}件</span>
                        <strong><small>¥</small>${this._escapeHtml(order.total)}</strong>
                    </div>
                </div>
                <footer class="wangxiang-order-actions">
                    ${order.actions.map((action, index) => `<button type="button" class="${index === order.actions.length - 1 ? 'is-primary' : ''}">${this._escapeHtml(action)}</button>`).join('')}
                </footer>
            </article>
        `;
    }

    _bindEvents() {
        const currentView = document.querySelector('.phone-view-current');
        const root = currentView?.querySelector('.wangxiang-app') || document.querySelector('.wangxiang-app');
        if (!root) return;

        root.querySelectorAll('.wangxiang-primary-nav-item').forEach(button => {
            button.onclick = () => this._switchSection(root, button.dataset.wangxiangView);
        });

        root.querySelector('.wangxiang-task-settings-open')?.addEventListener('click', () => {
            this._showTaskSettings(root);
        });
        root.querySelector('.wangxiang-settings-back')?.addEventListener('click', () => {
            this._hideTaskSettings(root);
        });
        root.querySelector('.wangxiang-task-detail-back')?.addEventListener('click', () => {
            this._hideTaskDetail(root);
        });
        root.querySelector('#wangxiang-use-worldbook')?.addEventListener('change', async event => {
            const enabled = !!event.target.checked;
            await window.VirtualPhone?.worldbookManager?.setEnabled?.('wangxiang', enabled);
            if (enabled) this.renderWangxiangWorldbookList(root);
            this.app.phoneShell?.showNotification?.(
                enabled ? '已开启' : '已关闭',
                `任务生成${enabled ? '会' : '不会'}引用勾选的世界书`,
                enabled ? '✅' : 'ℹ️'
            );
        });

        window.VirtualPhone?.promptManager?.bindPromptPresetControls?.(root, 'wangxiang', 'tasks', '#wangxiang-task-prompt', {
            notify: (title, message, icon) => this.app.phoneShell?.showNotification?.(title, message, icon)
        });

        this._bindSegmentedControl(root, '.wangxiang-market-categories button');
        this._bindSegmentedControl(root, '.wangxiang-order-tabs button');
        this._bindTaskPullRefresh(root);
        this._syncTaskRefreshIndicator(root);
        this._bindTaskActions(root);
    }

    _switchSection(root, section) {
        if (!WANGXIANG_NAV_ITEMS.some(item => item.id === section)) return;
        this._hideTaskSettings(root);
        this.currentSection = section;

        root.querySelectorAll('.wangxiang-primary-nav-item').forEach(button => {
            const isActive = button.dataset.wangxiangView === section;
            button.classList.toggle('is-active', isActive);
            if (isActive) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });

        root.querySelectorAll('[data-wangxiang-panel]').forEach(panel => {
            const isActive = panel.dataset.wangxiangPanel === section;
            panel.classList.toggle('is-hidden', !isActive);
            panel.setAttribute('aria-hidden', String(!isActive));
        });
    }

    _showTaskSettings(root) {
        const taskPanel = root.querySelector('[data-wangxiang-panel="task-hall"]');
        const settingsPanel = root.querySelector('[data-wangxiang-settings="tasks"]');
        if (!taskPanel || !settingsPanel) return;
        taskPanel.classList.add('is-hidden');
        taskPanel.setAttribute('aria-hidden', 'true');
        settingsPanel.classList.remove('is-hidden');
        settingsPanel.setAttribute('aria-hidden', 'false');
        this.renderWangxiangWorldbookList(root);
    }

    _hideTaskSettings(root) {
        const settingsPanel = root?.querySelector('[data-wangxiang-settings="tasks"]');
        if (!settingsPanel || settingsPanel.classList.contains('is-hidden')) return false;
        settingsPanel.classList.add('is-hidden');
        settingsPanel.setAttribute('aria-hidden', 'true');
        if (this.currentSection === 'task-hall') {
            const taskPanel = root.querySelector('[data-wangxiang-panel="task-hall"]');
            taskPanel?.classList.remove('is-hidden');
            taskPanel?.setAttribute('aria-hidden', 'false');
        }
        return true;
    }

    handleBack() {
        const root = document.querySelector('.phone-view-current .wangxiang-app');
        if (this._hideTaskDetail(root)) return true;
        return this._hideTaskSettings(root);
    }

    async renderWangxiangWorldbookList(root = document) {
        const container = root.querySelector?.('#wangxiang-worldbook-list');
        const manager = window.VirtualPhone?.worldbookManager;
        if (!container || !manager) return;

        try {
            const sources = await manager.listAvailableWorldbooks({ includeEntries: true, force: true });
            const selection = manager.getSelectionState('wangxiang');
            if (!sources.length) {
                container.innerHTML = '<p class="wangxiang-settings-message">未读取到酒馆世界书列表。</p>';
                return;
            }

            const isSelected = source => selection.initialized && manager.matchesSelection?.(source, selection.ids);
            const displaySources = [...sources].sort((a, b) => Number(isSelected(b)) - Number(isSelected(a)));
            container.innerHTML = displaySources.map(source => {
                const activeCount = Number(source.entries?.length || 0);
                const totalCount = Number(source.totalEntries ?? activeCount);
                const emptyText = activeCount ? '' : (totalCount > 0 ? '（无开启条目）' : '（读取失败或为空）');
                const countText = totalCount > activeCount ? `${activeCount}/${totalCount} 条可注入` : `${activeCount} 条`;
                return `
                    <label class="wangxiang-worldbook-item">
                        <input class="wangxiang-worldbook-choice" type="checkbox" value="${this._escapeHtml(source.id)}" ${isSelected(source) ? 'checked' : ''}>
                        <span>
                            <strong>${this._escapeHtml(source.name)}${this._escapeHtml(emptyText)}</strong>
                            <small>${this._escapeHtml(source.sourceLabel || '世界书')} · ${this._escapeHtml(countText)}</small>
                        </span>
                    </label>
                `;
            }).join('');

            container.querySelectorAll('.wangxiang-worldbook-choice').forEach(input => {
                input.addEventListener('change', async () => {
                    const ids = Array.from(container.querySelectorAll('.wangxiang-worldbook-choice:checked')).map(item => item.value);
                    await manager.setSelection('wangxiang', ids);
                    this.renderWangxiangWorldbookList(root);
                });
            });
        } catch (error) {
            console.warn('[Wangxiang] 世界书列表渲染失败:', error);
            container.innerHTML = '<p class="wangxiang-settings-message is-error">世界书读取失败，请稍后重试。</p>';
        }
    }

    _bindSegmentedControl(root, selector) {
        root.querySelectorAll(selector).forEach(button => {
            button.onclick = () => {
                const group = button.parentElement;
                group?.querySelectorAll('button').forEach(item => {
                    const isActive = item === button;
                    item.classList.toggle('is-active', isActive);
                    item.setAttribute('aria-selected', String(isActive));
                });
            };
        });
    }

    _bindTaskActions(root) {
        if (root.dataset.taskActionsBound === '1') return;
        root.dataset.taskActionsBound = '1';
        root.addEventListener('click', async event => {
            const detailAction = event.target?.closest?.('[data-task-detail-action]');
            if (detailAction) {
                await this._handleTaskDetailAction(root, detailAction.dataset.taskDetailAction, detailAction);
                return;
            }

            const hallButton = event.target?.closest?.('.wangxiang-task-action[data-task-action]');
            if (hallButton) {
                const taskCard = hallButton.closest('.wangxiang-task-card');
                const taskId = taskCard?.dataset?.taskId || '';
                if (hallButton.dataset.taskAction === 'view') {
                    this._showTaskDetail(root, taskId);
                    return;
                }
                hallButton.disabled = true;
                try {
                    const task = await this.app.acceptTask(taskId);
                    this._renderTaskList(root);
                    this._renderManagedTaskList(root);
                    this.app.phoneShell?.showNotification?.('任务已接取', task.title, '✅');
                } catch (error) {
                    hallButton.disabled = false;
                    this.app.phoneShell?.showNotification?.('接取失败', error?.message || '请稍后重试', '❌');
                }
                return;
            }

            const managedButton = event.target?.closest?.('[data-managed-task-action][data-managed-task-id]');
            if (managedButton) {
                if (managedButton.disabled) return;
                const taskId = managedButton.dataset.managedTaskId;
                const action = managedButton.dataset.managedTaskAction;
                if (action === 'submit') {
                    managedButton.disabled = true;
                    try {
                        const task = await this.app.completeTask(taskId);
                        this._renderManagedTaskList(root);
                        this._renderTaskList(root);
                        this.app.phoneShell?.showNotification?.('任务已完成', task.title, '✅');
                    } catch (error) {
                        managedButton.disabled = false;
                        this.app.phoneShell?.showNotification?.('提交失败', error?.message || '请稍后重试', '❌');
                    }
                } else if (action === 'active') {
                    this._showTaskDetail(root, taskId);
                }
                return;
            }

            const taskCard = event.target?.closest?.('.wangxiang-task-card[data-task-id], .wangxiang-managed-task-card[data-task-id]');
            if (taskCard && !event.target?.closest?.('button, input, select, textarea, a')) {
                this._showTaskDetail(root, taskCard.dataset.taskId);
            }
        });
    }

    _showTaskDetail(root, taskId) {
        const task = this.app.getTaskById?.(taskId);
        const panel = root?.querySelector?.('[data-wangxiang-task-detail]');
        const scroll = panel?.querySelector?.('.wangxiang-task-detail-scroll');
        if (!task || !panel || !scroll) return;
        this.currentTaskId = String(task.id || taskId);
        scroll.innerHTML = this._renderTaskDetailContent(task);
        scroll.scrollTop = 0;
        panel.classList.remove('is-hidden');
        panel.setAttribute('aria-hidden', 'false');
    }

    _hideTaskDetail(root) {
        const panel = root?.querySelector?.('[data-wangxiang-task-detail]');
        if (!panel || panel.classList.contains('is-hidden')) return false;
        panel.classList.add('is-hidden');
        panel.setAttribute('aria-hidden', 'true');
        this.currentTaskId = '';
        return true;
    }

    _refreshTaskDetail(root) {
        if (!this.currentTaskId) return;
        const task = this.app.getTaskById?.(this.currentTaskId);
        const scroll = root?.querySelector?.('.wangxiang-task-detail-scroll');
        if (!task || !scroll) {
            this._hideTaskDetail(root);
            return;
        }
        const scrollTop = scroll.scrollTop;
        scroll.innerHTML = this._renderTaskDetailContent(task);
        scroll.scrollTop = scrollTop;
    }

    async _handleTaskDetailAction(root, action, button) {
        const taskId = this.currentTaskId;
        if (!taskId) return;
        if (action === 'contact') {
            const task = this.app.getTaskById?.(taskId);
            this.app.phoneShell?.showNotification?.('任务发布人', task?.publisher || '暂无联系方式', 'ℹ️');
            return;
        }
        if (action === 'track') {
            const task = this.app.getTaskById?.(taskId);
            this.app.phoneShell?.showNotification?.('已追踪任务', task?.title || '任务', '📍');
            return;
        }
        if (action === 'abandon' && !window.confirm('确定放弃这个任务？')) return;

        button.disabled = true;
        try {
            let task = null;
            if (action === 'accept') task = await this.app.acceptTask(taskId);
            else if (action === 'submit') task = await this.app.completeTask(taskId);
            else if (action === 'abandon') task = await this.app.abandonTask(taskId);
            if (!task) return;
            this._renderTaskList(root);
            this._renderManagedTaskList(root);
            this._refreshTaskDetail(root);
            const messageMap = { accept: '任务已接取', submit: '任务已完成', abandon: '任务已放弃' };
            this.app.phoneShell?.showNotification?.(messageMap[action] || '任务已更新', task.title, action === 'abandon' ? 'ℹ️' : '✅');
        } catch (error) {
            button.disabled = false;
            this.app.phoneShell?.showNotification?.('操作失败', error?.message || '请稍后重试', '❌');
        }
    }

    _renderManagedTaskList(root) {
        const list = root?.querySelector('.wangxiang-my-tasks-scroll');
        if (!list) return;
        const scrollTop = list.scrollTop;
        list.innerHTML = this._renderManagedTaskContent();
        list.scrollTop = scrollTop;
    }

    _renderTaskCard(task) {
        const accent = ['cyan', 'green', 'purple', 'orange'].includes(task.accent) ? task.accent : 'cyan';
        const isManaged = ['active', 'submit', 'completed'].includes(task.status);
        const statusText = task.status === 'completed' ? '已完成' : (isManaged ? '进行中' : '可接取');

        return `
            <article class="wangxiang-task-card is-${accent}${isManaged ? ' is-active' : ''}" data-task-id="${this._escapeHtml(task.id)}">
                <div class="wangxiang-task-card-icon" aria-hidden="true">
                    <i class="fa-solid ${this._escapeHtml(task.icon)}"></i>
                </div>
                <div class="wangxiang-task-card-main">
                    <h2 class="wangxiang-task-card-title">
                        ${task.level ? `<span class="wangxiang-task-level">${this._escapeHtml(task.level)}</span>` : ''}
                        <span>${this._escapeHtml(task.title)}</span>
                    </h2>
                    <p class="wangxiang-task-card-description">${this._escapeHtml(task.description)}</p>
                    <div class="wangxiang-task-card-meta">
                        <span><i class="fa-solid fa-user" aria-hidden="true"></i>${this._escapeHtml(task.publisher)}</span>
                        <span><i class="fa-regular fa-clock" aria-hidden="true"></i>${this._escapeHtml(task.remaining)}</span>
                    </div>
                </div>
                <div class="wangxiang-task-card-side">
                    <span class="wangxiang-task-reward-label">奖励</span>
                    <strong class="wangxiang-task-reward"><span>¥</span>${this._escapeHtml(task.reward)}</strong>
                    <button class="wangxiang-task-action${isManaged ? ' is-active' : ''}" type="button" data-task-action="${isManaged ? 'view' : 'accept'}">
                        ${statusText}
                    </button>
                </div>
            </article>
        `;
    }

    _getTaskItems() {
        return (this.app.getGeneratedTasks?.() || []).filter(task => task.status !== 'completed');
    }

    _renderTaskListContent() {
        const tasks = this._getTaskItems();
        if (tasks.length) return tasks.map(task => this._renderTaskCard(task)).join('');
        return `
            <div class="wangxiang-task-empty">
                <i class="fa-solid fa-satellite-dish" aria-hidden="true"></i>
                <strong>暂无任务</strong>
            </div>
        `;
    }

    _renderTaskList(root) {
        const list = root?.querySelector('.wangxiang-task-list');
        if (!list) return;
        list.innerHTML = this._renderTaskListContent();
    }

    async _handleTaskRefresh(root) {
        if (this.app.isRefreshingTasks) return;
        this._taskRefreshStatus = 'loading';
        this._syncTaskRefreshIndicator(root);
        try {
            const tasks = await this.app.refreshTaskHall();
            if (!tasks?.length) return;
            this._renderTaskList(root);
            this._taskRefreshStatus = 'success';
            this._syncTaskRefreshIndicator(root);
        } catch (error) {
            console.error('[Wangxiang] 任务刷新失败:', error);
            this._taskRefreshStatus = 'error';
            this._syncTaskRefreshIndicator(root);
            this.app.phoneShell?.showNotification?.('万象', error?.message || '任务刷新失败', '❌');
        } finally {
            if (this._taskRefreshTimer) clearTimeout(this._taskRefreshTimer);
            const finalStatus = this._taskRefreshStatus;
            this._taskRefreshTimer = setTimeout(() => {
                if (this._taskRefreshStatus === finalStatus && finalStatus !== 'loading') {
                    this._taskRefreshStatus = 'idle';
                    this._syncTaskRefreshIndicator(root);
                }
            }, 1300);
        }
    }

    _bindTaskPullRefresh(root) {
        const scroll = root.querySelector('.wangxiang-task-scroll');
        const triggerAreas = [root.querySelector('.wangxiang-task-header'), scroll].filter(Boolean);
        if (!scroll || !triggerAreas.length) return;

        let startX = 0;
        let startY = 0;
        let pullDistance = 0;
        let pressing = false;
        let pressType = '';
        let previousUserSelect = '';
        const maxPull = 86;
        const triggerThreshold = 56;
        const canPull = () => !this.app.isRefreshingTasks && scroll.scrollTop <= 2 && this.currentSection === 'task-hall';

        const startPress = (clientX, clientY, type) => {
            if (!canPull()) return false;
            startX = clientX;
            startY = clientY;
            pullDistance = 0;
            pressing = true;
            pressType = type;
            if (type === 'mouse') {
                previousUserSelect = document.body.style.userSelect;
                document.body.style.userSelect = 'none';
            }
            return true;
        };

        const movePress = (clientX, clientY, event) => {
            if (!pressing) return;
            const deltaX = clientX - startX;
            const deltaY = clientY - startY;
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 8) {
                pressing = false;
                pullDistance = 0;
                if (pressType === 'mouse') {
                    document.body.style.userSelect = previousUserSelect || '';
                    previousUserSelect = '';
                }
                pressType = '';
                this._syncTaskRefreshIndicator(root);
                return;
            }
            if (deltaY < 6) return;
            pullDistance = Math.min(maxPull, Math.round(deltaY * 0.55));
            const ready = pullDistance >= triggerThreshold;
            this._setTaskPullHint(root, pullDistance, ready ? '松手刷新任务' : '下拉刷新任务', ready);
            if (event?.cancelable) event.preventDefault();
        };

        const endPress = () => {
            if (!pressing) return;
            const shouldRefresh = pullDistance >= triggerThreshold;
            pressing = false;
            pullDistance = 0;
            if (pressType === 'mouse') document.body.style.userSelect = previousUserSelect || '';
            pressType = '';
            previousUserSelect = '';
            if (shouldRefresh) this._handleTaskRefresh(root);
            else this._syncTaskRefreshIndicator(root);
        };

        const onTouchStart = event => {
            if (event.target?.closest?.('button, input, select, textarea, a')) return;
            const touch = event.touches?.[0];
            if (touch) startPress(touch.clientX, touch.clientY, 'touch');
        };
        const onTouchMove = event => {
            const touch = event.touches?.[0];
            if (touch) movePress(touch.clientX, touch.clientY, event);
        };
        const onTouchEnd = () => {
            if (pressType === 'touch') endPress();
        };
        const onMouseDown = event => {
            if (event.target?.closest?.('button, input, select, textarea, a')) return;
            if (event.button !== 0 || !startPress(event.clientX, event.clientY, 'mouse')) return;
            event.preventDefault();
            const onMove = moveEvent => movePress(moveEvent.clientX, moveEvent.clientY, moveEvent);
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                window.removeEventListener('blur', onUp);
                endPress();
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            window.addEventListener('blur', onUp);
        };

        triggerAreas.forEach(area => {
            if (area.dataset.pullRefreshBound === '1') return;
            area.dataset.pullRefreshBound = '1';
            area.addEventListener('touchstart', onTouchStart, { passive: true });
            area.addEventListener('touchmove', onTouchMove, { passive: false });
            area.addEventListener('touchend', onTouchEnd);
            area.addEventListener('touchcancel', onTouchEnd);
            area.addEventListener('mousedown', onMouseDown);
        });
    }

    _setTaskPullHint(root, height, text, ready = false) {
        const indicator = root.querySelector('.wangxiang-task-pull-indicator');
        const inner = root.querySelector('.wangxiang-task-pull-inner');
        if (!indicator || !inner) return;
        indicator.classList.remove('is-loading', 'is-success', 'is-error');
        indicator.classList.toggle('is-ready', ready);
        indicator.style.height = `${Math.max(0, height)}px`;
        inner.innerHTML = `<i class="fa-solid fa-arrow-down" aria-hidden="true"></i><span>${text}</span>`;
    }

    _syncTaskRefreshIndicator(root) {
        const indicator = root?.querySelector('.wangxiang-task-pull-indicator');
        const inner = root?.querySelector('.wangxiang-task-pull-inner');
        if (!indicator || !inner) return;
        indicator.classList.remove('is-ready', 'is-loading', 'is-success', 'is-error');
        if (this.app.isRefreshingTasks || this._taskRefreshStatus === 'loading') {
            indicator.classList.add('is-loading');
            indicator.style.height = '36px';
            inner.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>正在生成任务...</span>';
            return;
        }
        if (this._taskRefreshStatus === 'success') {
            indicator.classList.add('is-success');
            indicator.style.height = '36px';
            inner.innerHTML = '<i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>任务刷新成功</span>';
            return;
        }
        if (this._taskRefreshStatus === 'error') {
            indicator.classList.add('is-error');
            indicator.style.height = '36px';
            inner.innerHTML = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>任务刷新失败</span>';
            return;
        }
        indicator.style.height = '0px';
        inner.innerHTML = '';
    }

    _escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}
