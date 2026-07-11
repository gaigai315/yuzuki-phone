/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

const WANGXIANG_BACKGROUND_URL = new URL('./wangxiang.png', import.meta.url).href;
const WANGXIANG_TITLE_URL = new URL('./wxbt.png', import.meta.url).href;
const WANGXIANG_NAV_BACKGROUND_URL = new URL('./wxanbj.png', import.meta.url).href;

const WANGXIANG_TASK_PREVIEW = [
    {
        id: 'city-patrol',
        title: '城市安保巡查',
        description: '在指定区域完成巡逻检查，确保城市安全秩序。',
        publisher: '城市安保局',
        remaining: '23:58:12',
        reward: '2,880',
        icon: 'fa-shield-halved',
        accent: 'cyan',
        status: 'available'
    },
    {
        id: 'supply-escort',
        title: '物资运输护送',
        description: '护送重要物资前往目的地，确保运输过程安全无虞。',
        publisher: '联合物流',
        remaining: '15:42:33',
        reward: '5,680',
        icon: 'fa-box',
        accent: 'green',
        status: 'available'
    },
    {
        id: 'target-tracking',
        title: '悬赏：追踪目标',
        description: '追踪并定位目标人物，提供准确有效的行动情报。',
        publisher: '赏金协会',
        remaining: '08:19:46',
        reward: '9,960',
        icon: 'fa-crosshairs',
        accent: 'purple',
        status: 'available'
    },
    {
        id: 'equipment-repair',
        title: '设备维修支援',
        description: '前往指定地点维修损坏设备，恢复设施正常运行。',
        publisher: '科技维护部',
        remaining: '12:35:10',
        reward: '3,260',
        icon: 'fa-screwdriver-wrench',
        accent: 'orange',
        status: 'active'
    },
    {
        id: 'data-recovery',
        title: '数据回收行动',
        description: '潜入目标区域回收重要数据，并从现场安全撤离。',
        publisher: '情报署',
        remaining: '05:27:18',
        reward: '7,800',
        icon: 'fa-file-shield',
        accent: 'cyan',
        status: 'active'
    }
];

const WANGXIANG_NAV_ITEMS = [
    { id: 'task-hall', label: '任务大厅', icon: 'fa-list-check' },
    { id: 'my-tasks', label: '我的任务', icon: 'fa-clipboard-check' },
    { id: 'marketplace', label: '商品商场', icon: 'fa-store' },
    { id: 'my-orders', label: '我的订单', icon: 'fa-receipt' }
];

const WANGXIANG_MY_TASK_GROUPS = [
    {
        id: 'active',
        title: '进行中',
        hint: '任务进行中，请保持追踪',
        tasks: [
            { ...WANGXIANG_TASK_PREVIEW[0], progress: 65, action: '继续追踪' },
            { ...WANGXIANG_TASK_PREVIEW[1], progress: 40, action: '继续追踪' }
        ]
    },
    {
        id: 'submit',
        title: '待提交',
        hint: '任务已完成，可提交获取奖励',
        tasks: [
            { ...WANGXIANG_TASK_PREVIEW[2], progress: 100, action: '提交任务' }
        ]
    },
    {
        id: 'completed',
        title: '已完成',
        hint: '任务已完成，奖励已发放',
        tasks: [
            { ...WANGXIANG_TASK_PREVIEW[3], progress: 100, action: '已完成', completed: true, completedAt: '2026/07/10 12:35' },
            { ...WANGXIANG_TASK_PREVIEW[4], progress: 100, action: '已完成', completed: true, completedAt: '2026/07/09 05:27' }
        ]
    }
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
        this.currentSection = 'task-hall';
    }

    loadCSS() {
        if (this._cssLoaded || document.getElementById('wangxiang-css')) {
            this._cssLoaded = true;
            return;
        }

        const link = document.createElement('link');
        link.id = 'wangxiang-css';
        link.rel = 'stylesheet';
        link.href = new URL('./wangxiang.css', import.meta.url).href;
        document.head.appendChild(link);
        this._cssLoaded = true;
    }

    render() {
        this.loadCSS();
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
                ${this._renderMyTasksPanel()}
                ${this._renderMarketplacePanel()}
                ${this._renderOrdersPanel()}
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
                        <h1 class="wangxiang-task-title" id="wangxiang-task-panel-title">任务大厅</h1>
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
                    ${WANGXIANG_TASK_PREVIEW.map(task => this._renderTaskCard(task)).join('')}
                </div>
            </section>
        `;
    }

    _renderMyTasksPanel() {
        const state = this._panelState('my-tasks');
        return `
            <section class="wangxiang-content-panel wangxiang-my-tasks-panel${state.className}" data-wangxiang-panel="my-tasks" aria-hidden="${state.ariaHidden}" aria-label="我的任务">
                <div class="wangxiang-my-tasks-scroll wangxiang-content-scroll">
                    ${WANGXIANG_MY_TASK_GROUPS.map(group => this._renderManagedTaskGroup(group)).join('')}
                </div>
            </section>
        `;
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
            <article class="wangxiang-managed-task-card is-${accent}${task.completed ? ' is-completed' : ''}">
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
                    <button type="button" ${task.completed ? 'disabled' : ''}>${this._escapeHtml(task.action)}</button>
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

        this._bindSegmentedControl(root, '.wangxiang-market-categories button');
        this._bindSegmentedControl(root, '.wangxiang-order-tabs button');
    }

    _switchSection(root, section) {
        if (!WANGXIANG_NAV_ITEMS.some(item => item.id === section)) return;
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

    _renderTaskCard(task) {
        const accent = ['cyan', 'green', 'purple', 'orange'].includes(task.accent) ? task.accent : 'cyan';
        const isActive = task.status === 'active';
        const statusText = isActive ? '进行中' : '可接取';

        return `
            <article class="wangxiang-task-card is-${accent}${isActive ? ' is-active' : ''}" data-task-id="${this._escapeHtml(task.id)}">
                <div class="wangxiang-task-card-icon" aria-hidden="true">
                    <i class="fa-solid ${this._escapeHtml(task.icon)}"></i>
                </div>
                <div class="wangxiang-task-card-main">
                    <h2 class="wangxiang-task-card-title">${this._escapeHtml(task.title)}</h2>
                    <p class="wangxiang-task-card-description">${this._escapeHtml(task.description)}</p>
                    <div class="wangxiang-task-card-meta">
                        <span><i class="fa-solid fa-user" aria-hidden="true"></i>${this._escapeHtml(task.publisher)}</span>
                        <span><i class="fa-regular fa-clock" aria-hidden="true"></i>${this._escapeHtml(task.remaining)}</span>
                    </div>
                </div>
                <div class="wangxiang-task-card-side">
                    <span class="wangxiang-task-reward-label">奖励</span>
                    <strong class="wangxiang-task-reward"><span>¥</span>${this._escapeHtml(task.reward)}</strong>
                    <button class="wangxiang-task-action${isActive ? ' is-active' : ''}" type="button" data-task-action="${isActive ? 'view' : 'accept'}">
                        ${statusText}
                    </button>
                </div>
            </article>
        `;
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
