/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

const WANGXIANG_BACKGROUND_URL = new URL('./wangxiang.png', import.meta.url).href;
const WANGXIANG_TITLE_URL = new URL('./wxbt.png', import.meta.url).href;
const WANGXIANG_NAV_BACKGROUND_URL = new URL('./wxanbj.png', import.meta.url).href;
const WANGXIANG_TASK_PANEL_BACKGROUND_URL = new URL('./wxrwxq.png', import.meta.url).href;

const WANGXIANG_NAV_ITEMS = [
    { id: 'task-hall', label: '任务大厅', icon: 'fa-list-check' },
    { id: 'my-tasks', label: '我的任务', icon: 'fa-clipboard-check' },
    { id: 'marketplace', label: '商品商场', icon: 'fa-store' },
    { id: 'my-orders', label: '我的订单', icon: 'fa-receipt' }
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
        this._marketRefreshStatus = 'idle';
        this._marketRefreshTimer = null;
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
        link.href = new URL('./wangxiang.css?v=20260712-order-arrival', import.meta.url).href;
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

    async showTaskProgressPopup(completions) {
        const items = Array.isArray(completions) ? completions.filter(Boolean) : [];
        if (!items.length) return;
        await this.loadCSS();
        document.getElementById('wangxiang-progress-popup-root')?.remove();

        const root = document.createElement('div');
        root.id = 'wangxiang-progress-popup-root';
        root.innerHTML = `
            <div class="wangxiang-progress-popup" role="dialog" aria-modal="true" aria-labelledby="wangxiang-progress-popup-title" style="background-image:url('${WANGXIANG_TASK_PANEL_BACKGROUND_URL}')">
                <div class="wangxiang-progress-popup-head">
                    <span><i class="fa-solid fa-circle-check" aria-hidden="true"></i></span>
                    <div>
                        <strong id="wangxiang-progress-popup-title">任务目标已完成</strong>
                        <small>万象任务进度提醒</small>
                    </div>
                </div>
                <div class="wangxiang-progress-popup-list">
                    ${items.map(item => `
                        <div class="wangxiang-progress-popup-item">
                            <span>${this._escapeHtml(item.taskTitle || '未命名任务')}</span>
                            <strong>${this._escapeHtml(item.objectiveTitle || '任务目标')}</strong>
                            <div><b>${Number(item.current || 0)}/${Math.max(1, Number(item.total || 1))}</b><em>100%</em></div>
                        </div>
                    `).join('')}
                </div>
                <button type="button" class="wangxiang-progress-popup-confirm">
                    <i class="fa-solid fa-check" aria-hidden="true"></i><span>确定</span>
                </button>
            </div>`;
        document.body.appendChild(root);
        const close = () => root.remove();
        root.querySelector('.wangxiang-progress-popup-confirm')?.addEventListener('click', close, { once: true });
        root.querySelector('.wangxiang-progress-popup-confirm')?.focus?.();
    }

    async showMarketplaceDeliveryPopup(orders) {
        const items = Array.isArray(orders) ? orders.filter(Boolean) : [];
        if (!items.length) return;
        await this.loadCSS();
        const activePopup = document.getElementById('wangxiang-progress-popup-root');
        if (activePopup) {
            await new Promise(resolve => {
                const observer = new MutationObserver(() => {
                    if (document.body.contains(activePopup)) return;
                    observer.disconnect();
                    resolve();
                });
                observer.observe(document.body, { childList: true, subtree: true });
            });
        }

        const root = document.createElement('div');
        root.id = 'wangxiang-progress-popup-root';
        root.innerHTML = `
            <div class="wangxiang-progress-popup wangxiang-delivery-popup" role="dialog" aria-modal="true" aria-labelledby="wangxiang-progress-popup-title" style="background-image:url('${WANGXIANG_TASK_PANEL_BACKGROUND_URL}')">
                <div class="wangxiang-progress-popup-head">
                    <span><i class="fa-solid fa-box-open" aria-hidden="true"></i></span>
                    <div>
                        <strong id="wangxiang-progress-popup-title">商品已送达</strong>
                        <small>万象订单配送提醒</small>
                    </div>
                </div>
                <div class="wangxiang-progress-popup-list">
                    ${items.map(item => `
                        <div class="wangxiang-progress-popup-item">
                            <span>${this._escapeHtml(item.name || '未命名商品')}</span>
                            <strong>${this._escapeHtml(`数量 ${Math.max(1, Number(item.quantity || 1))} · 已送达`)}</strong>
                            <div><b>${this._escapeHtml(item.addressSnapshot?.label || item.addressSnapshot?.recipient || '收货地址')}</b><em>已签收</em></div>
                        </div>
                    `).join('')}
                </div>
                <button type="button" class="wangxiang-progress-popup-confirm">
                    <i class="fa-solid fa-check" aria-hidden="true"></i><span>确定</span>
                </button>
            </div>`;
        document.body.appendChild(root);
        const close = () => root.remove();
        root.querySelector('.wangxiang-progress-popup-confirm')?.addEventListener('click', close, { once: true });
        root.querySelector('.wangxiang-progress-popup-confirm')?.focus?.();
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
                ${this._renderMarketplaceSettingsPanel()}
                ${this._renderOrdersPanel()}
                ${this._renderTaskDetailPanel()}
                ${this._renderMarketplacePurchaseDialog()}
                ${this._renderInfoDetailDialog()}
                ${this._renderAddressDialog()}
                ${this._renderPaymentDialog()}
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
                    <button class="wangxiang-settings-back" type="button" data-wangxiang-settings-back="tasks" aria-label="返回任务大厅" title="返回任务大厅">
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
                                <input class="wangxiang-settings-toggle-input st-phone-toggle-input" id="wangxiang-use-worldbook" type="checkbox" data-wangxiang-worldbook-toggle="wangxiang" data-wangxiang-worldbook-label="任务生成" ${useWorldbook ? 'checked' : ''}>
                                <span aria-hidden="true"></span>
                            </label>
                        </div>
                        <div class="phone-prompt-fold wangxiang-worldbook-fold" data-default-open="false" data-wangxiang-worldbook-key="wangxiang">
                            <div class="phone-prompt-fold-header" role="button" tabindex="0" aria-expanded="false" aria-controls="wangxiang-worldbook-fold-content">
                                <div class="phone-prompt-fold-main">
                                    <div class="phone-prompt-fold-title">世界书选择</div>
                                    <div class="phone-prompt-fold-desc">展开后勾选要注入的酒馆世界书</div>
                                </div>
                                <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow" aria-hidden="true"></i>
                            </div>
                            <div id="wangxiang-worldbook-fold-content" class="phone-prompt-fold-content" aria-hidden="true">
                                <div id="wangxiang-worldbook-list" class="wangxiang-worldbook-list">
                                    <p class="wangxiang-settings-message">正在读取当前可用世界书...</p>
                                </div>
                            </div>
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
                        <textarea class="wangxiang-prompt-textarea" id="wangxiang-task-prompt" spellcheck="false" aria-label="任务生成提示词">${this._escapeHtml(prompt)}</textarea>
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
            available: { label: '待联系', icon: 'fa-comments' },
            active: { label: '进行中', icon: 'fa-satellite-dish' },
            submit: { label: '待提交', icon: 'fa-file-circle-check' },
            completed: { label: '已完成', icon: 'fa-circle-check' }
        };
        const status = statusMap[task.status] || statusMap.available;
        const objectives = Array.isArray(task.objectives) && task.objectives.length
            ? task.objectives
            : [{ id: 'objective-1', title: '完成任务要求', current: 0, total: 1, completed: false }];
        const comments = Array.isArray(task.comments) ? task.comments : [];
        const actionHtml = this._renderTaskDetailActions(task);

        return `
            <div class="wangxiang-task-detail-content is-${accent}" data-task-detail-id="${this._escapeHtml(task.id)}">
                <section class="wangxiang-task-detail-hero">
                    <div class="wangxiang-task-detail-title-row">
                        <h1>${this._escapeHtml(task.title)}</h1>
                        <div class="wangxiang-task-detail-status"><i class="fa-solid ${status.icon}" aria-hidden="true"></i>${status.label}</div>
                    </div>
                </section>

                <section class="wangxiang-task-detail-publisher">
                    <div class="wangxiang-task-detail-publisher-icon"><i class="fa-solid ${this._escapeHtml(task.icon || 'fa-building-shield')}" aria-hidden="true"></i></div>
                    <div>
                        <span>任务发布人</span>
                        <h2>${this._escapeHtml(task.publisher || '万象任务中心')}</h2>
                        <p>${this._escapeHtml(task.publisherOrg || '独立委托方')}</p>
                        <strong>发布者信誉：${this._escapeHtml(task.publisherReputation || '未知')}</strong>
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
                        <div class="wangxiang-detail-clickable" role="button" tabindex="0" data-wangxiang-extra-reward><i class="fa-solid fa-box-open"></i><span>额外奖励<strong>${this._escapeHtml(task.extraReward || '无')}</strong></span></div>
                    </div>
                </section>

                <section class="wangxiang-task-detail-section">
                    <h2><i class="fa-regular fa-rectangle-list" aria-hidden="true"></i>任务信息</h2>
                    <div class="wangxiang-task-detail-info">
                        <span><i class="fa-solid fa-location-dot"></i>任务地点<strong>${this._escapeHtml(task.location || '未注明')}</strong></span>
                        <span><i class="fa-regular fa-calendar"></i>发布时间<strong>${this._escapeHtml(task.publishedAt || task.remaining || '--')}</strong></span>
                        <span><i class="fa-regular fa-calendar-check"></i>开始时间<strong>${this._escapeHtml(task.startsAt || task.startTime || '未注明')}</strong></span>
                        <span><i class="fa-regular fa-clock"></i>预估耗时<strong>${this._escapeHtml(task.estimatedDuration || task.duration || '未注明')}</strong></span>
                    </div>
                </section>

                <section class="wangxiang-task-detail-section wangxiang-task-detail-discussion">
                    <h2><i class="fa-regular fa-message" aria-hidden="true"></i>任务讨论<span>${comments.length} 条讨论</span></h2>
                    ${comments.length ? comments.map(comment => `
                        <article>
                            <div><i class="fa-solid fa-user-astronaut" aria-hidden="true"></i></div>
                            <p><strong>${this._escapeHtml(comment.name)}</strong><span>${this._escapeHtml(comment.time)}</span>${this._escapeHtml(comment.content)}</p>
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
            <div class="wangxiang-task-detail-objective wangxiang-detail-clickable${completed ? ' is-completed' : ''}" role="button" tabindex="0" data-wangxiang-objective-index="${index}">
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
        return '<button type="button" class="is-primary" data-task-detail-action="accept"><i class="fa-solid fa-comments"></i>联系领取</button>';
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
        const categories = ['全部', ...this.app.getMarketplaceCategories()];

        return `
            <section class="wangxiang-content-panel wangxiang-market-panel${state.className}" data-wangxiang-panel="marketplace" aria-hidden="${state.ariaHidden}" aria-label="商品商场">
                <div class="wangxiang-market-toolbar">
                    <label class="wangxiang-market-search">
                        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                        <input type="search" placeholder="搜索商品名称或关键词" aria-label="搜索商品">
                    </label>
                    <button class="wangxiang-market-settings-open" type="button" aria-label="商品商场设置" title="商品商场设置">
                        <i class="fa-solid fa-gear" aria-hidden="true"></i>
                        <span>设置</span>
                    </button>
                </div>
                <div class="wangxiang-market-categories" role="tablist" aria-label="商品分类">
                    ${categories.map((category, index) => `
                        <button type="button" role="tab" class="${index === 0 ? 'is-active' : ''}" aria-selected="${index === 0}" data-market-category-index="${index}">${this._escapeHtml(category)}</button>
                    `).join('')}
                </div>
                <div class="wangxiang-market-scroll wangxiang-content-scroll">
                    <div class="wangxiang-market-pull-indicator" aria-live="polite">
                        <div class="wangxiang-market-pull-inner"></div>
                    </div>
                    <div class="wangxiang-market-product-list" aria-live="polite">
                        ${this._renderMarketplaceProductListContent()}
                    </div>
                </div>
            </section>
        `;
    }

    _renderMarketplaceProductListContent() {
        const products = this.app.getMarketplaceProducts?.() || [];
        return products.map(product => this._renderMarketplaceProductCard(product)).join('');
    }

    _resolveMarketplaceCategoryIcon(categoryName) {
        const name = String(categoryName || '').replace(/\s+/g, '').toLocaleLowerCase();
        const rules = [
            { pattern: /外卖|餐饮|食品|食物|料理|零食|饮品|饮料|酒水|甜品|生鲜|果蔬|粮油|补给/, icon: 'fa-utensils' },
            { pattern: /医疗|医药|药品|药剂|治疗|急救|护理|保健|丹药|疗愈|恢复/, icon: 'fa-kit-medical' },
            { pattern: /服装|衣物|衣饰|时装|穿戴|鞋靴|鞋包|帽|外套|内衣|布料|纺织/, icon: 'fa-shirt' },
            { pattern: /武器|装备|战斗|军械|防具|护甲|盔甲|枪械|刀剑|弓弩|盾牌|弹药/, icon: 'fa-shield-halved' },
            { pattern: /科技|芯片|电子|数码|机械|机甲|终端|通讯|强化|改造|智能|能源/, icon: 'fa-microchip' },
            { pattern: /魔法|法术|炼金|符文|卷轴|法器|灵器|仙术|修真|秘术|神秘/, icon: 'fa-wand-magic-sparkles' },
            { pattern: /首饰|珠宝|宝石|奢侈|收藏|古董|饰品|珍品|稀有/, icon: 'fa-gem' },
            { pattern: /图书|书籍|典籍|知识|情报|资料|档案|教材|技能书|秘籍/, icon: 'fa-book-open' },
            { pattern: /家居|家具|家电|居家|住宅|房产|地产|建筑/, icon: 'fa-house' },
            { pattern: /工具|器材|设备|仪器|工坊|制造|维修|工程/, icon: 'fa-screwdriver-wrench' },
            { pattern: /材料|素材|矿物|矿石|金属|木材|零件|资源|原料/, icon: 'fa-cubes-stacked' },
            { pattern: /载具|车辆|汽车|飞船|舰船|交通|坐骑|航空/, icon: 'fa-car-side' },
            { pattern: /宠物|灵兽|召唤兽|伙伴|生物/, icon: 'fa-paw' },
            { pattern: /娱乐|游戏|玩具|影音|音乐|演出|票务/, icon: 'fa-gamepad' },
            { pattern: /农牧|农业|种子|植物|花卉|园艺/, icon: 'fa-seedling' },
            { pattern: /金融|货币|金币|信用|兑换|证券/, icon: 'fa-coins' },
            { pattern: /服务|委托|代办|租赁|配送|维修/, icon: 'fa-bell-concierge' }
        ];
        return rules.find(rule => rule.pattern.test(name))?.icon || 'fa-box-open';
    }

    _renderMarketplaceProductCard(product) {
        const categoryIndex = Math.max(1, Math.min(5, Number(product?.categoryIndex || 1)));
        const categories = this.app.getMarketplaceCategories();
        const categoryName = categories[categoryIndex - 1] || '商品';
        const categoryIcon = this._resolveMarketplaceCategoryIcon(categoryName);
        const tags = (Array.isArray(product?.tags) ? product.tags : []).slice(0, 2);
        const searchText = [categoryName, product?.name, product?.description, ...tags].filter(Boolean).join(' ').toLocaleLowerCase();
        const stockMatch = String(product?.stock ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
        const isSoldOut = !!stockMatch && Number(stockMatch[0]) <= 0;
        return `
            <article class="wangxiang-market-product-card" data-market-category-index="${categoryIndex}" data-market-search-text="${this._escapeHtml(searchText)}">
                <div class="wangxiang-market-product-icon" aria-hidden="true">
                    <i class="fa-solid ${categoryIcon}"></i>
                </div>
                <div class="wangxiang-market-product-main">
                    <div class="wangxiang-market-product-heading">
                        <span>${this._escapeHtml(categoryName)}</span>
                        <div class="wangxiang-market-product-tags">
                            ${tags.map(tag => `<small>${this._escapeHtml(tag)}</small>`).join('')}
                        </div>
                    </div>
                    <h2>${this._escapeHtml(product?.name || '未命名商品')}</h2>
                    <button class="wangxiang-market-product-description" type="button" data-market-product-detail="${this._escapeHtml(product?.id || '')}">${this._escapeHtml(product?.description || '')}</button>
                    <div class="wangxiang-market-product-meta">
                        <strong><small>售价</small>${this._escapeHtml(product?.price || '0')}</strong>
                        <span>库存：${this._escapeHtml(product?.stock || '0')}</span>
                    </div>
                </div>
                <button class="wangxiang-market-product-buy" type="button" data-market-buy-product="${this._escapeHtml(product?.id || '')}" ${isSoldOut ? 'disabled' : ''}>
                    <i class="fa-solid ${isSoldOut ? 'fa-ban' : 'fa-cart-shopping'}" aria-hidden="true"></i>
                    <span>${isSoldOut ? '已售罄' : '购买'}</span>
                </button>
            </article>
        `;
    }

    _renderMarketplaceSettingsPanel() {
        const promptManager = window.VirtualPhone?.promptManager;
        const worldbookManager = window.VirtualPhone?.worldbookManager;
        const prompt = promptManager?.getPromptForFeature?.('wangxiang', 'marketplace')
            || promptManager?.getDefaultPrompts?.()?.wangxiang?.marketplace?.content
            || '';
        const useWorldbook = worldbookManager?.getEnabled?.('wangxiang-marketplace') || false;
        const presetControls = promptManager?.renderPromptPresetControls?.('wangxiang', 'marketplace') || '';
        const categories = this.app.getMarketplaceCategories();

        return `
            <section class="wangxiang-content-panel wangxiang-market-settings-panel is-hidden" data-wangxiang-settings="marketplace" aria-hidden="true" aria-labelledby="wangxiang-market-settings-title">
                <header class="wangxiang-settings-header">
                    <button class="wangxiang-settings-back" type="button" data-wangxiang-settings-back="marketplace" aria-label="返回商品商场" title="返回商品商场">
                        <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                    </button>
                    <div>
                        <h1 id="wangxiang-market-settings-title">商品商场设置</h1>
                        <p>生成上下文、提示词与商品分类</p>
                    </div>
                </header>
                <div class="wangxiang-settings-scroll wangxiang-content-scroll">
                    <section class="wangxiang-settings-section">
                        <div class="wangxiang-settings-section-heading">
                            <div>
                                <h2>世界书引用</h2>
                                <p>生成商品时注入勾选的酒馆世界书</p>
                            </div>
                            <label class="wangxiang-settings-toggle">
                                <input class="wangxiang-settings-toggle-input st-phone-toggle-input" type="checkbox" data-wangxiang-worldbook-toggle="wangxiang-marketplace" data-wangxiang-worldbook-label="商品生成" ${useWorldbook ? 'checked' : ''}>
                                <span aria-hidden="true"></span>
                            </label>
                        </div>
                        <div class="phone-prompt-fold wangxiang-worldbook-fold" data-default-open="false" data-wangxiang-worldbook-key="wangxiang-marketplace">
                            <div class="phone-prompt-fold-header" role="button" tabindex="0" aria-expanded="false">
                                <div class="phone-prompt-fold-main">
                                    <div class="phone-prompt-fold-title">世界书选择</div>
                                    <div class="phone-prompt-fold-desc">展开后勾选要注入的酒馆世界书</div>
                                </div>
                                <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow" aria-hidden="true"></i>
                            </div>
                            <div class="phone-prompt-fold-content" aria-hidden="true">
                                <div class="wangxiang-worldbook-list">
                                    <p class="wangxiang-settings-message">正在读取当前可用世界书...</p>
                                </div>
                            </div>
                        </div>
                    </section>
                    <section class="wangxiang-settings-section wangxiang-market-category-settings">
                        <div class="wangxiang-settings-section-heading">
                            <div>
                                <h2>商品分类</h2>
                                <p>“全部”固定保留，其余分类可自行修改</p>
                            </div>
                        </div>
                        <div class="wangxiang-market-category-editor">
                            <label class="is-locked"><span>固定分类</span><input type="text" value="全部" disabled></label>
                            ${categories.map((category, index) => `
                                <label><span>分类 ${index + 1}</span><input type="text" maxlength="8" value="${this._escapeHtml(category)}" data-market-category-input="${index}"></label>
                            `).join('')}
                        </div>
                        <button class="wangxiang-market-categories-save" type="button">
                            <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
                            <span>保存分类</span>
                        </button>
                    </section>
                    <section class="wangxiang-settings-section wangxiang-prompt-section">
                        <div class="wangxiang-settings-section-heading">
                            <div>
                                <h2>商品生成提示词</h2>
                                <p>默认预设会随代码更新；需要修改时请新增自定义预设</p>
                            </div>
                        </div>
                        ${presetControls}
                        <textarea class="wangxiang-prompt-textarea" id="wangxiang-market-prompt" spellcheck="false" aria-label="商品生成提示词">${this._escapeHtml(prompt)}</textarea>
                    </section>
                </div>
            </section>
        `;
    }

    _renderOrdersPanel() {
        const state = this._panelState('my-orders');
        return `
            <section class="wangxiang-content-panel wangxiang-orders-panel${state.className}" data-wangxiang-panel="my-orders" aria-hidden="${state.ariaHidden}" aria-label="我的订单">
                <div class="wangxiang-orders-scroll wangxiang-content-scroll">
                    <section class="wangxiang-order-account">${this._renderOrderAccountContent()}</section>
                    <section class="wangxiang-order-addresses">${this._renderOrderAddressesContent()}</section>
                    <div class="wangxiang-order-list">${this._renderMarketplaceOrdersContent()}</div>
                </div>
            </section>
        `;
    }

    _renderOrderAccountContent() {
        const credit = this.app.getCreditBalance?.() || 0;
        const wechat = this.app.getWechatWalletBalance?.();
        return `
            <div class="wangxiang-order-account-user">
                <span><i class="fa-solid fa-user" aria-hidden="true"></i>当前用户</span>
                <strong>${this._escapeHtml(this.app.getCurrentUserName?.() || '用户')}</strong>
            </div>
            <div class="wangxiang-order-balance-grid">
                <div><span>信用点</span><strong>${this._escapeHtml(Number(credit).toLocaleString('zh-CN'))}</strong></div>
                <div><span>微信零钱</span><strong>${wechat === null || wechat === undefined ? '未初始化' : `¥${Number(wechat).toFixed(2)}`}</strong></div>
            </div>
        `;
    }

    _renderOrderAddressesContent() {
        const addresses = this.app.getDeliveryAddresses?.() || [];
        return `
            <header><div><h2>收货地址</h2><p>支付时选择配送地址</p></div><button type="button" data-wangxiang-address-add aria-label="添加地址" title="添加地址"><i class="fa-solid fa-plus" aria-hidden="true"></i></button></header>
            <div class="wangxiang-order-address-list">
                ${addresses.map(address => `
                    <article class="${address.isDefault ? 'is-default' : ''}">
                        <button type="button" class="wangxiang-address-main" data-wangxiang-address-default="${this._escapeHtml(address.id)}">
                            <span>${this._escapeHtml(address.label || '常用地址')}${address.isDefault ? '<small>默认</small>' : ''}</span>
                            <strong>${this._escapeHtml(address.recipient)} · ${this._escapeHtml(address.phone)}</strong>
                            <p>${this._escapeHtml(address.address)}</p>
                        </button>
                        <button type="button" data-wangxiang-address-remove="${this._escapeHtml(address.id)}" aria-label="删除地址" title="删除地址"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
                    </article>
                `).join('')}
            </div>
        `;
    }

    _renderMarketplaceOrdersContent() {
        return (this.app.getMarketplaceOrders?.() || []).map(order => this._renderMarketplaceOrderCard(order)).join('');
    }

    _renderMarketplaceOrderCard(order) {
        const isShipping = order?.status === 'shipping';
        const isDelivered = order?.status === 'delivered';
        const isPaid = isShipping || isDelivered;
        const statusText = isDelivered ? '已送达' : isShipping ? '配送中' : '待支付';
        return `
            <article class="wangxiang-order-card${isShipping ? ' is-shipping' : ''}${isDelivered ? ' is-delivered' : ''}" data-market-order-id="${this._escapeHtml(order?.id || '')}">
                <header>
                    <span>订单号：${this._escapeHtml(order?.id || '')}</span>
                    <strong>${statusText}</strong>
                </header>
                <div class="wangxiang-order-body">
                    <div class="wangxiang-order-icon" aria-hidden="true"><i class="fa-solid fa-box"></i></div>
                    <div class="wangxiang-order-main">
                        <h2>${this._escapeHtml(order?.name || '未命名商品')}</h2>
                        <p>单价：${this._escapeHtml(order?.unitPrice || '0')} · 数量：${this._escapeHtml(order?.quantity || 1)}</p>
                        <small>${this._escapeHtml(isPaid ? (order?.paidAt || order?.shippingAt || '') : (order?.createdAt || ''))}</small>
                        ${isPaid ? `<small>预计送达：${this._escapeHtml(order?.estimatedArrivalAt || '待确认')}</small>` : ''}
                    </div>
                </div>
                <footer>
                    <div><span>合计</span><strong>${this._escapeHtml(order?.totalPrice || '0')}</strong></div>
                    <button type="button" data-market-order-pay="${this._escapeHtml(order?.id || '')}" ${isPaid ? 'disabled' : ''}>
                        <i class="fa-solid ${isDelivered ? 'fa-box-open' : isShipping ? 'fa-truck-fast' : 'fa-credit-card'}" aria-hidden="true"></i>
                        <span>${isDelivered ? '已送达' : isShipping ? '配送中' : '支付'}</span>
                    </button>
                </footer>
            </article>
        `;
    }

    _renderMarketplacePurchaseDialog() {
        return `
            <div class="wangxiang-purchase-overlay is-hidden" data-wangxiang-purchase-dialog aria-hidden="true">
                <section class="wangxiang-purchase-dialog" role="dialog" aria-modal="true" aria-labelledby="wangxiang-purchase-title">
                    <header>
                        <div>
                            <h2 id="wangxiang-purchase-title">选择购买数量</h2>
                            <p class="wangxiang-purchase-product-name"></p>
                        </div>
                        <button type="button" data-wangxiang-purchase-close aria-label="关闭" title="关闭"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                    </header>
                    <div class="wangxiang-purchase-price"></div>
                    <div class="wangxiang-purchase-stepper">
                        <button type="button" data-wangxiang-quantity-step="-1" aria-label="减少数量" title="减少数量"><i class="fa-solid fa-minus" aria-hidden="true"></i></button>
                        <input type="number" min="1" max="999" step="1" value="1" aria-label="购买数量">
                        <button type="button" data-wangxiang-quantity-step="1" aria-label="增加数量" title="增加数量"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
                    </div>
                    <footer>
                        <button type="button" data-wangxiang-purchase-close>取消</button>
                        <button type="button" class="is-primary" data-wangxiang-purchase-confirm>
                            <i class="fa-solid fa-receipt" aria-hidden="true"></i>
                            <span>提交订单</span>
                        </button>
                    </footer>
                </section>
            </div>
        `;
    }

    _renderInfoDetailDialog() {
        return `
            <div class="wangxiang-info-overlay is-hidden" data-wangxiang-info-dialog aria-hidden="true">
                <section class="wangxiang-info-dialog" role="dialog" aria-modal="true" aria-labelledby="wangxiang-info-title">
                    <header>
                        <div>
                            <span class="wangxiang-info-eyebrow"></span>
                            <h2 id="wangxiang-info-title"></h2>
                        </div>
                        <button type="button" data-wangxiang-info-close aria-label="关闭" title="关闭"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                    </header>
                    <div class="wangxiang-info-dialog-body">
                        <p class="wangxiang-info-text"></p>
                        <div class="wangxiang-info-progress is-hidden">
                            <div class="wangxiang-info-progress-meta"><span>任务进度</span><strong></strong></div>
                            <div class="wangxiang-info-progress-track"><i></i></div>
                        </div>
                        <div class="wangxiang-info-meta"></div>
                    </div>
                </section>
            </div>
        `;
    }

    _renderAddressDialog() {
        return `
            <div class="wangxiang-form-overlay is-hidden" data-wangxiang-address-dialog aria-hidden="true">
                <section class="wangxiang-form-dialog" role="dialog" aria-modal="true" aria-labelledby="wangxiang-address-title">
                    <header><h2 id="wangxiang-address-title">添加收货地址</h2><button type="button" data-wangxiang-address-close aria-label="关闭" title="关闭"><i class="fa-solid fa-xmark"></i></button></header>
                    <div class="wangxiang-form-dialog-body">
                        <label><span>地址名称</span><input type="text" maxlength="12" data-address-field="label" placeholder="例如：家"></label>
                        <label><span>收货人</span><input type="text" maxlength="30" data-address-field="recipient"></label>
                        <label><span>联系电话</span><input type="text" maxlength="30" data-address-field="phone"></label>
                        <label><span>详细地址</span><textarea maxlength="160" data-address-field="address"></textarea></label>
                    </div>
                    <footer><button type="button" data-wangxiang-address-close>取消</button><button type="button" class="is-primary" data-wangxiang-address-save>保存地址</button></footer>
                </section>
            </div>
        `;
    }

    _renderPaymentDialog() {
        return `
            <div class="wangxiang-form-overlay is-hidden" data-wangxiang-payment-dialog aria-hidden="true">
                <section class="wangxiang-form-dialog wangxiang-payment-dialog" role="dialog" aria-modal="true" aria-labelledby="wangxiang-payment-title">
                    <header><div><h2 id="wangxiang-payment-title">确认支付</h2><p class="wangxiang-payment-order-name"></p></div><button type="button" data-wangxiang-payment-close aria-label="关闭" title="关闭"><i class="fa-solid fa-xmark"></i></button></header>
                    <div class="wangxiang-form-dialog-body">
                        <div class="wangxiang-payment-amount"></div>
                        <fieldset class="wangxiang-payment-methods"><legend>支付方式</legend></fieldset>
                        <fieldset class="wangxiang-payment-addresses"><legend>收货地址</legend><div></div></fieldset>
                    </div>
                    <footer><button type="button" data-wangxiang-payment-close>取消</button><button type="button" class="is-primary" data-wangxiang-payment-confirm>确认支付</button></footer>
                </section>
            </div>
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
        root.querySelector('.wangxiang-market-settings-open')?.addEventListener('click', () => {
            this._showMarketplaceSettings(root);
        });
        root.querySelectorAll('[data-wangxiang-settings-back]').forEach(button => {
            button.addEventListener('click', () => {
                this._hideSettings(root, button.dataset.wangxiangSettingsBack);
            });
        });
        root.querySelector('.wangxiang-task-detail-back')?.addEventListener('click', () => {
            this._hideTaskDetail(root);
        });
        this._bindWorldbookFold(root);
        root.querySelectorAll('[data-wangxiang-worldbook-toggle]').forEach(input => {
            input.addEventListener('change', async event => {
                const appKey = String(event.target.dataset.wangxiangWorldbookToggle || 'wangxiang');
                const label = String(event.target.dataset.wangxiangWorldbookLabel || '内容生成');
                const enabled = !!event.target.checked;
                await window.VirtualPhone?.worldbookManager?.setEnabled?.(appKey, enabled);
                const panel = event.target.closest('[data-wangxiang-settings]');
                const fold = panel?.querySelector(`.wangxiang-worldbook-fold[data-wangxiang-worldbook-key="${appKey}"]`);
                if (enabled && fold?.classList.contains('is-open')) this.renderWangxiangWorldbookList(fold);
                this.app.phoneShell?.showNotification?.(
                    enabled ? '已开启' : '已关闭',
                    `${label}${enabled ? '会' : '不会'}引用勾选的世界书`,
                    enabled ? '✅' : 'ℹ️'
                );
            });
        });

        window.VirtualPhone?.promptManager?.bindPromptPresetControls?.(root, 'wangxiang', 'tasks', '#wangxiang-task-prompt', {
            notify: (title, message, icon) => this.app.phoneShell?.showNotification?.(title, message, icon)
        });
        window.VirtualPhone?.promptManager?.bindPromptPresetControls?.(root, 'wangxiang', 'marketplace', '#wangxiang-market-prompt', {
            notify: (title, message, icon) => this.app.phoneShell?.showNotification?.(title, message, icon)
        });

        root.querySelector('.wangxiang-market-categories-save')?.addEventListener('click', async buttonEvent => {
            const button = buttonEvent.currentTarget;
            const inputs = Array.from(root.querySelectorAll('[data-market-category-input]'));
            try {
                const categories = await this.app.setMarketplaceCategories(inputs.map(input => input.value));
                root.querySelectorAll('.wangxiang-market-categories [data-market-category-index]').forEach(tab => {
                    const index = Number(tab.dataset.marketCategoryIndex);
                    tab.textContent = index === 0 ? '全部' : categories[index - 1];
                });
                this._renderMarketplaceProductList(root);
                this.app.phoneShell?.showNotification?.('保存成功', '商品分类已更新', '✅');
            } catch (error) {
                this.app.phoneShell?.showNotification?.('保存失败', error?.message || '请检查商品分类', '⚠️');
                inputs.find(input => !String(input.value || '').trim())?.focus();
            } finally {
                button.blur();
            }
        });

        this._bindMarketplaceFilters(root);
        this._bindTaskPullRefresh(root);
        this._syncTaskRefreshIndicator(root);
        this._bindMarketplacePullRefresh(root);
        this._syncMarketplaceRefreshIndicator(root);
        this._bindMarketplaceOrderActions(root);
        this._bindInfoDetailActions(root);
        this._bindTaskActions(root);
    }

    _switchSection(root, section) {
        if (!WANGXIANG_NAV_ITEMS.some(item => item.id === section)) return;
        this._hideAllSettings(root);
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
        if (section === 'my-orders') this._renderMarketplaceOrders(root);
    }

    _showTaskSettings(root) {
        const taskPanel = root.querySelector('[data-wangxiang-panel="task-hall"]');
        const settingsPanel = root.querySelector('[data-wangxiang-settings="tasks"]');
        if (!taskPanel || !settingsPanel) return;
        taskPanel.classList.add('is-hidden');
        taskPanel.setAttribute('aria-hidden', 'true');
        settingsPanel.classList.remove('is-hidden');
        settingsPanel.setAttribute('aria-hidden', 'false');
    }

    _showMarketplaceSettings(root) {
        const marketPanel = root.querySelector('[data-wangxiang-panel="marketplace"]');
        const settingsPanel = root.querySelector('[data-wangxiang-settings="marketplace"]');
        if (!marketPanel || !settingsPanel) return;
        marketPanel.classList.add('is-hidden');
        marketPanel.setAttribute('aria-hidden', 'true');
        settingsPanel.classList.remove('is-hidden');
        settingsPanel.setAttribute('aria-hidden', 'false');
    }

    _hideTaskSettings(root) {
        return this._hideSettings(root, 'tasks');
    }

    _hideSettings(root, settingsKey) {
        const settingsPanel = root?.querySelector(`[data-wangxiang-settings="${settingsKey}"]`);
        if (!settingsPanel || settingsPanel.classList.contains('is-hidden')) return false;
        settingsPanel.classList.add('is-hidden');
        settingsPanel.setAttribute('aria-hidden', 'true');
        const section = settingsKey === 'marketplace' ? 'marketplace' : 'task-hall';
        if (this.currentSection === section) {
            const contentPanel = root.querySelector(`[data-wangxiang-panel="${section}"]`);
            contentPanel?.classList.remove('is-hidden');
            contentPanel?.setAttribute('aria-hidden', 'false');
        }
        return true;
    }

    _hideAllSettings(root) {
        return ['tasks', 'marketplace'].some(settingsKey => this._hideSettings(root, settingsKey));
    }

    handleBack() {
        const root = document.querySelector('.phone-view-current .wangxiang-app');
        const paymentDialog = root?.querySelector('[data-wangxiang-payment-dialog]');
        if (paymentDialog && !paymentDialog.classList.contains('is-hidden')) {
            this._closeMarketplacePaymentDialog(root);
            return true;
        }
        const addressDialog = root?.querySelector('[data-wangxiang-address-dialog]');
        if (addressDialog && !addressDialog.classList.contains('is-hidden')) {
            this._closeAddressDialog(root);
            return true;
        }
        const infoDialog = root?.querySelector('[data-wangxiang-info-dialog]');
        if (infoDialog && !infoDialog.classList.contains('is-hidden')) {
            this._closeInfoDetailDialog(root);
            return true;
        }
        const purchaseDialog = root?.querySelector('[data-wangxiang-purchase-dialog]');
        if (purchaseDialog && !purchaseDialog.classList.contains('is-hidden')) {
            this._closeMarketplacePurchaseDialog(root);
            return true;
        }
        if (this._hideTaskDetail(root)) return true;
        return this._hideAllSettings(root);
    }

    _bindWorldbookFold(root) {
        root?.querySelectorAll('.wangxiang-worldbook-fold').forEach(fold => {
            const header = fold.querySelector('.phone-prompt-fold-header');
            const content = fold.querySelector('.phone-prompt-fold-content');
            if (!header || !content) return;

            const setOpen = open => {
                fold.classList.toggle('is-open', open);
                header.setAttribute('aria-expanded', String(open));
                content.setAttribute('aria-hidden', String(!open));
                if (open && fold.dataset.listLoaded !== '1') {
                    fold.dataset.listLoaded = '1';
                    this.renderWangxiangWorldbookList(fold);
                }
            };
            setOpen(String(fold.dataset.defaultOpen || '').toLowerCase() === 'true');
            header.addEventListener('click', () => setOpen(!fold.classList.contains('is-open')));
            header.addEventListener('keydown', event => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                setOpen(!fold.classList.contains('is-open'));
            });
        });
    }

    async renderWangxiangWorldbookList(scope = document) {
        const fold = scope.matches?.('.wangxiang-worldbook-fold') ? scope : scope.querySelector?.('.wangxiang-worldbook-fold');
        const container = fold?.querySelector?.('.wangxiang-worldbook-list');
        const manager = window.VirtualPhone?.worldbookManager;
        if (!container || !manager) return;
        const appKey = String(fold.dataset.wangxiangWorldbookKey || 'wangxiang');

        try {
            const sources = await manager.listAvailableWorldbooks({ includeEntries: true, force: true });
            const selection = manager.getSelectionState(appKey);
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
                    await manager.setSelection(appKey, ids);
                    this.renderWangxiangWorldbookList(fold);
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

    _renderMarketplaceProductList(root) {
        const list = root?.querySelector('.wangxiang-market-product-list');
        if (!list) return;
        list.innerHTML = this._renderMarketplaceProductListContent();
        this._bindMarketplaceFilters(root);
    }

    _bindMarketplaceFilters(root) {
        const buttons = Array.from(root.querySelectorAll('.wangxiang-market-categories button'));
        const searchInput = root.querySelector('.wangxiang-market-search input');
        if (!buttons.length) return;

        const apply = () => {
            const activeButton = buttons.find(button => button.classList.contains('is-active')) || buttons[0];
            const activeCategory = Number(activeButton?.dataset.marketCategoryIndex || 0);
            const query = String(searchInput?.value || '').trim().toLocaleLowerCase();
            root.querySelectorAll('.wangxiang-market-product-card').forEach(card => {
                const categoryMatches = activeCategory === 0 || Number(card.dataset.marketCategoryIndex) === activeCategory;
                const searchMatches = !query || String(card.dataset.marketSearchText || '').includes(query);
                card.classList.toggle('is-hidden-by-filter', !categoryMatches || !searchMatches);
            });
        };

        buttons.forEach(button => {
            button.onclick = () => {
                buttons.forEach(item => {
                    const isActive = item === button;
                    item.classList.toggle('is-active', isActive);
                    item.setAttribute('aria-selected', String(isActive));
                });
                apply();
            };
        });
        if (searchInput) searchInput.oninput = apply;
        apply();
    }

    _renderMarketplaceOrders(root) {
        const account = root?.querySelector('.wangxiang-order-account');
        const addresses = root?.querySelector('.wangxiang-order-addresses');
        const list = root?.querySelector('.wangxiang-order-list');
        if (account) account.innerHTML = this._renderOrderAccountContent();
        if (addresses) addresses.innerHTML = this._renderOrderAddressesContent();
        if (list) list.innerHTML = this._renderMarketplaceOrdersContent();
    }

    _bindInfoDetailActions(root) {
        if (root.dataset.infoDetailActionsBound === '1') return;
        root.dataset.infoDetailActionsBound = '1';
        const overlay = root.querySelector('[data-wangxiang-info-dialog]');

        root.addEventListener('click', event => {
            const productTrigger = event.target?.closest?.('[data-market-product-detail]');
            if (productTrigger) {
                const product = (this.app.getMarketplaceProducts?.() || []).find(item => String(item?.id || '') === String(productTrigger.dataset.marketProductDetail || ''));
                if (!product) return;
                const category = this.app.getMarketplaceCategories?.()?.[Math.max(0, Number(product.categoryIndex || 1) - 1)] || '商品';
                this._openInfoDetailDialog(root, {
                    eyebrow: category,
                    title: product.name || '商品详情',
                    text: product.description || '暂无商品简介',
                    meta: `售价：${product.price || '0'} · 库存：${product.stock || '0'}`
                });
                return;
            }

            const objectiveTrigger = event.target?.closest?.('[data-wangxiang-objective-index]');
            if (objectiveTrigger) {
                const detail = objectiveTrigger.closest('[data-task-detail-id]');
                const task = this.app.getTaskById?.(detail?.dataset?.taskDetailId || '');
                const index = Math.max(0, Number(objectiveTrigger.dataset.wangxiangObjectiveIndex || 0));
                const objectives = Array.isArray(task?.objectives) && task.objectives.length
                    ? task.objectives
                    : [{ title: '完成任务要求', current: 0, total: 1, completed: false }];
                const objective = objectives[index];
                if (!task || !objective) return;
                const total = Math.max(1, Number(objective.total || 1));
                const current = Math.max(0, Math.min(total, Number(objective.current || 0)));
                const completed = objective.completed === true || current >= total;
                this._openInfoDetailDialog(root, {
                    eyebrow: task.title || '任务详情',
                    title: '任务目标',
                    text: objective.title || `任务目标 ${index + 1}`,
                    progress: { current, total, percent: completed ? 100 : Math.round((current / total) * 100), completed }
                });
                return;
            }

            const rewardTrigger = event.target?.closest?.('[data-wangxiang-extra-reward]');
            if (rewardTrigger) {
                const detail = rewardTrigger.closest('[data-task-detail-id]');
                const task = this.app.getTaskById?.(detail?.dataset?.taskDetailId || '');
                if (!task) return;
                this._openInfoDetailDialog(root, {
                    eyebrow: task.title || '任务详情',
                    title: '额外奖励',
                    text: task.extraReward || '无'
                });
                return;
            }

            if (event.target?.closest?.('[data-wangxiang-info-close]')) this._closeInfoDetailDialog(root);
        });

        root.addEventListener('keydown', event => {
            const trigger = event.target?.closest?.('[data-wangxiang-objective-index], [data-wangxiang-extra-reward]');
            if (!trigger || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            trigger.click();
        });

        overlay?.addEventListener('click', event => {
            if (event.target === overlay) this._closeInfoDetailDialog(root);
        });
    }

    _openInfoDetailDialog(root, detail = {}) {
        const overlay = root?.querySelector('[data-wangxiang-info-dialog]');
        if (!overlay) return;
        const eyebrow = overlay.querySelector('.wangxiang-info-eyebrow');
        const title = overlay.querySelector('#wangxiang-info-title');
        const text = overlay.querySelector('.wangxiang-info-text');
        const meta = overlay.querySelector('.wangxiang-info-meta');
        const progress = overlay.querySelector('.wangxiang-info-progress');
        const progressLabel = progress?.querySelector('.wangxiang-info-progress-meta strong');
        const progressBar = progress?.querySelector('.wangxiang-info-progress-track i');
        if (eyebrow) eyebrow.textContent = String(detail.eyebrow || '详细信息');
        if (title) title.textContent = String(detail.title || '详细信息');
        if (text) text.textContent = String(detail.text || '暂无内容');
        if (meta) {
            meta.textContent = String(detail.meta || '');
            meta.classList.toggle('is-hidden', !detail.meta);
        }
        if (progress) {
            const hasProgress = !!detail.progress;
            progress.classList.toggle('is-hidden', !hasProgress);
            if (hasProgress) {
                const state = detail.progress;
                if (progressLabel) progressLabel.textContent = state.completed ? `已完成 · ${state.current}/${state.total}` : `${state.current}/${state.total}`;
                if (progressBar) progressBar.style.width = `${Math.max(0, Math.min(100, Number(state.percent || 0)))}%`;
            }
        }
        overlay.classList.remove('is-hidden');
        overlay.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => overlay.querySelector('[data-wangxiang-info-close]')?.focus());
    }

    _closeInfoDetailDialog(root) {
        const overlay = root?.querySelector('[data-wangxiang-info-dialog]');
        if (!overlay) return;
        overlay.classList.add('is-hidden');
        overlay.setAttribute('aria-hidden', 'true');
    }

    _bindMarketplaceOrderActions(root) {
        if (root.dataset.marketplaceOrderActionsBound === '1') return;
        root.dataset.marketplaceOrderActionsBound = '1';
        const overlay = root.querySelector('[data-wangxiang-purchase-dialog]');
        const quantityInput = overlay?.querySelector('.wangxiang-purchase-stepper input');

        const clampQuantity = () => {
            if (!quantityInput) return 1;
            const min = Math.max(1, Number(quantityInput.min || 1));
            const max = Math.max(min, Number(quantityInput.max || 999));
            const value = Math.max(min, Math.min(max, Math.floor(Number(quantityInput.value) || min)));
            quantityInput.value = String(value);
            return value;
        };

        root.addEventListener('click', async event => {
            const buyButton = event.target?.closest?.('[data-market-buy-product]');
            if (buyButton && !buyButton.disabled) {
                this._openMarketplacePurchaseDialog(root, buyButton.dataset.marketBuyProduct);
                return;
            }

            if (event.target?.closest?.('[data-wangxiang-purchase-close]')) {
                this._closeMarketplacePurchaseDialog(root);
                return;
            }

            const stepButton = event.target?.closest?.('[data-wangxiang-quantity-step]');
            if (stepButton && quantityInput) {
                quantityInput.value = String(clampQuantity() + Number(stepButton.dataset.wangxiangQuantityStep || 0));
                clampQuantity();
                return;
            }

            const confirmButton = event.target?.closest?.('[data-wangxiang-purchase-confirm]');
            if (confirmButton && overlay) {
                const productId = String(overlay.dataset.productId || '');
                confirmButton.disabled = true;
                try {
                    await this.app.createMarketplaceOrder(productId, clampQuantity());
                    this._closeMarketplacePurchaseDialog(root);
                    this._renderMarketplaceOrders(root);
                    this._switchSection(root, 'my-orders');
                    this.app.phoneShell?.showNotification?.('订单已创建', '请在“我的订单”中完成支付', '✅');
                } catch (error) {
                    this.app.phoneShell?.showNotification?.('下单失败', error?.message || '无法创建订单', '❌');
                } finally {
                    confirmButton.disabled = false;
                }
                return;
            }

            const payButton = event.target?.closest?.('[data-market-order-pay]');
            if (payButton && !payButton.disabled) {
                this._openMarketplacePaymentDialog(root, payButton.dataset.marketOrderPay);
                return;
            }

            if (event.target?.closest?.('[data-wangxiang-address-add]')) {
                this._openAddressDialog(root);
                return;
            }
            if (event.target?.closest?.('[data-wangxiang-address-close]')) {
                this._closeAddressDialog(root);
                return;
            }
            const removeAddress = event.target?.closest?.('[data-wangxiang-address-remove]');
            if (removeAddress) {
                if (!window.confirm('删除这条收货地址？')) return;
                await this.app.removeDeliveryAddress(removeAddress.dataset.wangxiangAddressRemove);
                this._renderMarketplaceOrders(root);
                return;
            }
            const defaultAddress = event.target?.closest?.('[data-wangxiang-address-default]');
            if (defaultAddress) {
                await this.app.setDefaultDeliveryAddress(defaultAddress.dataset.wangxiangAddressDefault);
                this._renderMarketplaceOrders(root);
                return;
            }
            const saveAddress = event.target?.closest?.('[data-wangxiang-address-save]');
            if (saveAddress) {
                const dialog = root.querySelector('[data-wangxiang-address-dialog]');
                const read = field => dialog?.querySelector(`[data-address-field="${field}"]`)?.value || '';
                saveAddress.disabled = true;
                try {
                    await this.app.addDeliveryAddress({
                        label: read('label'),
                        recipient: read('recipient'),
                        phone: read('phone'),
                        address: read('address')
                    });
                    this._closeAddressDialog(root);
                    this._renderMarketplaceOrders(root);
                    this.app.phoneShell?.showNotification?.('保存成功', '收货地址已添加', '✅');
                } catch (error) {
                    this.app.phoneShell?.showNotification?.('保存失败', error?.message || '无法添加地址', '❌');
                } finally {
                    saveAddress.disabled = false;
                }
                return;
            }

            if (event.target?.closest?.('[data-wangxiang-payment-close]')) {
                this._closeMarketplacePaymentDialog(root);
                return;
            }
            const confirmPayment = event.target?.closest?.('[data-wangxiang-payment-confirm]');
            if (confirmPayment) {
                const dialog = root.querySelector('[data-wangxiang-payment-dialog]');
                const method = dialog?.querySelector('input[name="wangxiang-payment-method"]:checked')?.value || '';
                const addressId = dialog?.querySelector('input[name="wangxiang-payment-address"]:checked')?.value || '';
                confirmPayment.disabled = true;
                try {
                    await this.app.payMarketplaceOrder(dialog?.dataset?.orderId || '', method, addressId);
                    this._closeMarketplacePaymentDialog(root);
                    this._renderMarketplaceOrders(root);
                    this._renderMarketplaceProductList(root);
                    this.app.phoneShell?.showNotification?.('支付成功', '商品已进入配送流程', '✅');
                } catch (error) {
                    this.app.phoneShell?.showNotification?.('支付失败', error?.message || '订单支付失败', '❌');
                } finally {
                    confirmPayment.disabled = false;
                }
            }
        });

        overlay?.addEventListener('click', event => {
            if (event.target === overlay) this._closeMarketplacePurchaseDialog(root);
        });
        root.querySelector('[data-wangxiang-address-dialog]')?.addEventListener('click', event => {
            if (event.target === event.currentTarget) this._closeAddressDialog(root);
        });
        root.querySelector('[data-wangxiang-payment-dialog]')?.addEventListener('click', event => {
            if (event.target === event.currentTarget) this._closeMarketplacePaymentDialog(root);
        });
        quantityInput?.addEventListener('change', clampQuantity);
    }

    _openAddressDialog(root) {
        const overlay = root?.querySelector('[data-wangxiang-address-dialog]');
        if (!overlay) return;
        overlay.querySelectorAll('input, textarea').forEach(input => { input.value = ''; });
        overlay.classList.remove('is-hidden');
        overlay.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => overlay.querySelector('[data-address-field="label"]')?.focus());
    }

    _closeAddressDialog(root) {
        const overlay = root?.querySelector('[data-wangxiang-address-dialog]');
        if (!overlay) return;
        overlay.classList.add('is-hidden');
        overlay.setAttribute('aria-hidden', 'true');
    }

    _openMarketplacePaymentDialog(root, orderId) {
        const order = (this.app.getMarketplaceOrders?.() || []).find(item => String(item.id) === String(orderId || ''));
        const overlay = root?.querySelector('[data-wangxiang-payment-dialog]');
        if (!order || !overlay) return;
        const amount = this.app._readMarketplaceAmount?.(order.totalPrice);
        const credit = this.app.getCreditBalance?.() || 0;
        const wechat = this.app.getWechatWalletBalance?.();
        const addresses = this.app.getDeliveryAddresses?.() || [];
        overlay.dataset.orderId = String(order.id);
        const name = overlay.querySelector('.wangxiang-payment-order-name');
        const amountEl = overlay.querySelector('.wangxiang-payment-amount');
        const methods = overlay.querySelector('.wangxiang-payment-methods');
        const addressList = overlay.querySelector('.wangxiang-payment-addresses > div');
        if (name) name.textContent = `${order.name} × ${order.quantity}`;
        if (amountEl) amountEl.textContent = `应付：${order.totalPrice}`;
        if (methods) methods.innerHTML = `<legend>支付方式</legend>
            <label class="${Number(credit) < Number(amount) ? 'is-disabled' : ''}"><input type="radio" name="wangxiang-payment-method" value="credit" ${Number(credit) >= Number(amount) ? 'checked' : 'disabled'}><span><strong>信用点</strong><small>余额 ${Number(credit).toLocaleString('zh-CN')}</small></span></label>
            <label class="${wechat === null || Number(wechat) < Number(amount) ? 'is-disabled' : ''}"><input type="radio" name="wangxiang-payment-method" value="wechat" ${wechat === null || Number(wechat) < Number(amount) ? 'disabled' : Number(credit) < Number(amount) ? 'checked' : ''}><span><strong>微信支付</strong><small>${wechat === null ? '未初始化' : `余额 ¥${Number(wechat).toFixed(2)}`}</small></span></label>
        `;
        if (addressList) addressList.innerHTML = addresses.length ? addresses.map((address, index) => `
            <label><input type="radio" name="wangxiang-payment-address" value="${this._escapeHtml(address.id)}" ${address.isDefault || (!addresses.some(item => item.isDefault) && index === 0) ? 'checked' : ''}><span><strong>${this._escapeHtml(address.recipient)} · ${this._escapeHtml(address.phone)}</strong><small>${this._escapeHtml(address.address)}</small></span></label>
        `).join('') : '<p class="wangxiang-payment-no-address">请先在订单页添加收货地址</p>';
        overlay.classList.remove('is-hidden');
        overlay.setAttribute('aria-hidden', 'false');
    }

    _closeMarketplacePaymentDialog(root) {
        const overlay = root?.querySelector('[data-wangxiang-payment-dialog]');
        if (!overlay) return;
        overlay.classList.add('is-hidden');
        overlay.setAttribute('aria-hidden', 'true');
        delete overlay.dataset.orderId;
    }

    _openMarketplacePurchaseDialog(root, productId) {
        const product = (this.app.getMarketplaceProducts?.() || []).find(item => String(item?.id || '') === String(productId || ''));
        const overlay = root?.querySelector('[data-wangxiang-purchase-dialog]');
        if (!product || !overlay) return;
        const quantityInput = overlay.querySelector('.wangxiang-purchase-stepper input');
        const stockMatch = String(product.stock ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
        const maxQuantity = stockMatch ? Math.max(1, Math.min(999, Math.floor(Number(stockMatch[0])))) : 999;
        overlay.dataset.productId = String(product.id || '');
        const name = overlay.querySelector('.wangxiang-purchase-product-name');
        const price = overlay.querySelector('.wangxiang-purchase-price');
        if (name) name.textContent = String(product.name || '未命名商品');
        if (price) price.textContent = `单价：${String(product.price || '0')} · 库存：${String(product.stock || '0')}`;
        if (quantityInput) {
            quantityInput.max = String(maxQuantity);
            quantityInput.value = '1';
        }
        overlay.classList.remove('is-hidden');
        overlay.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => quantityInput?.focus());
    }

    _closeMarketplacePurchaseDialog(root) {
        const overlay = root?.querySelector('[data-wangxiang-purchase-dialog]');
        if (!overlay) return;
        overlay.classList.add('is-hidden');
        overlay.setAttribute('aria-hidden', 'true');
        delete overlay.dataset.productId;
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
                this.app.phoneShell?.showNotification?.('请先联系发布者', '打开任务详情，通过“联系发布人”发送任务卡片并领取任务', 'ℹ️');
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
            button.disabled = true;
            try {
                const result = await this.app.contactTaskPublisher?.(taskId);
                this.app.phoneShell?.showNotification?.('已发送任务卡片', `已联系 ${result?.task?.publisher || '任务发布人'}`, '✅');
            } catch (error) {
                button.disabled = false;
                this.app.phoneShell?.showNotification?.('联系失败', error?.message || '请稍后重试', '❌');
            }
            return;
        }
        if (action === 'accept') {
            this.app.phoneShell?.showNotification?.('请先联系发布者', '请通过“联系发布人”发送任务卡片并领取任务', 'ℹ️');
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
            if (action === 'submit') task = await this.app.completeTask(taskId);
            else if (action === 'abandon') task = await this.app.abandonTask(taskId);
            if (!task) return;
            this._renderTaskList(root);
            this._renderManagedTaskList(root);
            this._refreshTaskDetail(root);
            const messageMap = { submit: '任务已完成', abandon: '任务已放弃' };
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
        const statusText = task.status === 'completed' ? '已完成' : (isManaged ? '进行中' : '联系领取');

        return `
            <article class="wangxiang-task-card is-${accent}${isManaged ? ' is-active' : ''}" data-task-id="${this._escapeHtml(task.id)}">
                <div class="wangxiang-task-card-icon" aria-hidden="true">
                    <i class="fa-solid ${this._escapeHtml(task.icon)}"></i>
                </div>
                <div class="wangxiang-task-card-main">
                    <h2 class="wangxiang-task-card-title">
                        <span>${this._escapeHtml(task.title)}</span>
                    </h2>
                    <p class="wangxiang-task-card-description">${this._escapeHtml(task.description)}</p>
                    <div class="wangxiang-task-card-meta">
                        <span><i class="fa-solid fa-user" aria-hidden="true"></i>${this._escapeHtml(task.publisher)}</span>
                        <span><i class="fa-regular fa-clock" aria-hidden="true"></i>${this._escapeHtml(task.publishedAt || task.remaining || '--')}</span>
                    </div>
                </div>
                <div class="wangxiang-task-card-side">
                    <span class="wangxiang-task-reward-label">奖励</span>
                    <strong class="wangxiang-task-reward"><span>¥</span>${this._escapeHtml(task.reward)}</strong>
                    <button class="wangxiang-task-action${isManaged ? ' is-active' : ''}" type="button" data-task-action="${isManaged ? 'view' : 'contact-required'}">
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
            indicator.style.height = '28px';
            inner.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>正在生成任务...</span>';
            return;
        }
        if (this._taskRefreshStatus === 'success') {
            indicator.classList.add('is-success');
            indicator.style.height = '28px';
            inner.innerHTML = '<i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>任务刷新成功</span>';
            return;
        }
        if (this._taskRefreshStatus === 'error') {
            indicator.classList.add('is-error');
            indicator.style.height = '28px';
            inner.innerHTML = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>任务刷新失败</span>';
            return;
        }
        indicator.style.height = '0px';
        inner.innerHTML = '';
    }

    async _handleMarketplaceRefresh(root) {
        if (this.app.isRefreshingMarketplace) return;
        this._marketRefreshStatus = 'loading';
        this._syncMarketplaceRefreshIndicator(root);
        try {
            const refreshPromise = this.app.refreshMarketplace();
            this._renderMarketplaceProductList(root);
            const products = await refreshPromise;
            if (!products?.length) return;
            this._renderMarketplaceProductList(root);
            this._marketRefreshStatus = 'success';
            this._syncMarketplaceRefreshIndicator(root);
        } catch (error) {
            console.error('[Wangxiang] 商品刷新失败:', error);
            this._marketRefreshStatus = 'error';
            this._syncMarketplaceRefreshIndicator(root);
            this.app.phoneShell?.showNotification?.('万象', error?.message || '商品刷新失败', '❌');
        } finally {
            if (this._marketRefreshTimer) clearTimeout(this._marketRefreshTimer);
            const finalStatus = this._marketRefreshStatus;
            this._marketRefreshTimer = setTimeout(() => {
                if (this._marketRefreshStatus === finalStatus && finalStatus !== 'loading') {
                    this._marketRefreshStatus = 'idle';
                    this._syncMarketplaceRefreshIndicator(root);
                }
            }, 1300);
        }
    }

    _bindMarketplacePullRefresh(root) {
        const panel = root.querySelector('[data-wangxiang-panel="marketplace"]');
        const scroll = root.querySelector('.wangxiang-market-scroll');
        const triggerAreas = [
            root.querySelector('.wangxiang-market-toolbar'),
            root.querySelector('.wangxiang-market-categories'),
            scroll
        ].filter(Boolean);
        if (!panel || !scroll || !triggerAreas.length) return;

        let startX = 0;
        let startY = 0;
        let pullDistance = 0;
        let pressing = false;
        let pressType = '';
        let previousUserSelect = '';
        const maxPull = 86;
        const triggerThreshold = 56;
        const canPull = () => !this.app.isRefreshingMarketplace && scroll.scrollTop <= 2 && this.currentSection === 'marketplace';

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
                this._syncMarketplaceRefreshIndicator(root);
                return;
            }
            if (deltaY < 6) return;
            pullDistance = Math.min(maxPull, Math.round(deltaY * 0.55));
            const ready = pullDistance >= triggerThreshold;
            this._setMarketplacePullHint(root, pullDistance, ready ? '松手生成商品' : '下拉生成商品', ready);
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
            if (shouldRefresh) this._handleMarketplaceRefresh(root);
            else this._syncMarketplaceRefreshIndicator(root);
        };

        const onTouchStart = event => {
            // Buttons remain valid pull handles on compact mobile layouts. A real pull
            // cancels their click in touchmove; editable controls keep native gestures.
            if (event.target?.closest?.('input, select, textarea, [contenteditable="true"]')) return;
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
            if (area.dataset.marketPullRefreshBound === '1') return;
            area.dataset.marketPullRefreshBound = '1';
            area.addEventListener('touchstart', onTouchStart, { passive: true });
            area.addEventListener('touchmove', onTouchMove, { passive: false });
            area.addEventListener('touchend', onTouchEnd);
            area.addEventListener('touchcancel', onTouchEnd);
            area.addEventListener('mousedown', onMouseDown);
        });
    }

    _setMarketplacePullHint(root, height, text, ready = false) {
        const indicator = root.querySelector('.wangxiang-market-pull-indicator');
        const inner = root.querySelector('.wangxiang-market-pull-inner');
        if (!indicator || !inner) return;
        indicator.classList.remove('is-loading', 'is-success', 'is-error');
        indicator.classList.toggle('is-ready', ready);
        indicator.style.height = `${Math.max(0, height)}px`;
        inner.innerHTML = `<i class="fa-solid fa-arrow-down" aria-hidden="true"></i><span>${text}</span>`;
    }

    _syncMarketplaceRefreshIndicator(root) {
        const indicator = root?.querySelector('.wangxiang-market-pull-indicator');
        const inner = root?.querySelector('.wangxiang-market-pull-inner');
        if (!indicator || !inner) return;
        indicator.classList.remove('is-ready', 'is-loading', 'is-success', 'is-error');
        if (this.app.isRefreshingMarketplace || this._marketRefreshStatus === 'loading') {
            indicator.classList.add('is-loading');
            indicator.style.height = '28px';
            inner.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>正在生成商品...</span>';
            return;
        }
        if (this._marketRefreshStatus === 'success') {
            indicator.classList.add('is-success');
            indicator.style.height = '28px';
            inner.innerHTML = '<i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>商品刷新成功</span>';
            return;
        }
        if (this._marketRefreshStatus === 'error') {
            indicator.classList.add('is-error');
            indicator.style.height = '28px';
            inner.innerHTML = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>商品刷新失败</span>';
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
