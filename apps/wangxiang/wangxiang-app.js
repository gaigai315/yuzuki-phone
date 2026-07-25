/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

import { WangxiangView } from './wangxiang-view.js';
import { applyPhoneTagFilter } from '../../config/tag-filter.js';
import { WechatData } from '../wechat/wechat-data.js';
import { parseWangxiangTaskTags } from './wangxiang-task-parser.js';

const WANGXIANG_TASK_VISUALS = [
    { accent: 'green', icon: 'fa-list-check' },
    { accent: 'cyan', icon: 'fa-shield-halved' },
    { accent: 'purple', icon: 'fa-crosshairs' },
    { accent: 'orange', icon: 'fa-crown' }
];

const WANGXIANG_DEFAULT_MARKET_CATEGORIES = ['补给物资', '战斗装备', '强化芯片', '医疗补给', '特殊道具'];

export function buildWangxiangTaskInjectionContent(tasks) {
    const activeTasks = (Array.isArray(tasks) ? tasks : [])
        .filter(task => task?.status === 'active' || task?.status === 'submit');
    if (!activeTasks.length) return '';

    const clean = (value, fallback = '未注明') => {
        const text = String(value ?? '').replace(/\s+/g, ' ').trim();
        return text || fallback;
    };
    const statusLabel = status => status === 'submit' ? '待提交' : '进行中';
    const formatProgress = task => {
        const explicit = Number(task?.progress);
        if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, Math.round(explicit)));
        const objectives = Array.isArray(task?.objectives) ? task.objectives : [];
        const totals = objectives.reduce((sum, item) => sum + Math.max(1, Number(item?.total || 1)), 0);
        const current = objectives.reduce((sum, item) => {
            const total = Math.max(1, Number(item?.total || 1));
            return sum + Math.max(0, Math.min(total, Number(item?.current || 0)));
        }, 0);
        return totals > 0 ? Math.round((current / totals) * 100) : 0;
    };

    const blocks = activeTasks.map((task, index) => {
        const objectives = (Array.isArray(task?.objectives) ? task.objectives : []).map((item, objectiveIndex) => {
            const total = Math.max(1, Number(item?.total || 1));
            const current = Math.max(0, Math.min(total, Number(item?.current || 0)));
            const completed = item?.completed === true || current >= total;
            return `- ${clean(item?.title, `任务目标 ${objectiveIndex + 1}`)}｜${current}/${total}｜${completed ? '已完成' : '进行中'}`;
        });
        return [
            `--- 已接任务 ${index + 1} ---`,
            `任务名称：${clean(task?.title, '未命名任务')}`,
            `当前状态：${statusLabel(task?.status)}`,
            `发布者：${clean(task?.publisher)}`,
            `发布者组织：${clean(task?.publisherOrg)}`,
            `发布者信誉：${clean(task?.publisherReputation)}`,
            `任务描述：${clean(task?.description, '暂无任务描述')}`,
            `任务地点：${clean(task?.location)}`,
            `发布时间：${clean(task?.publishedAt || task?.remaining)}`,
            `任务开始时间：${clean(task?.startsAt || task?.startTime)}`,
            `预估耗时：${clean(task?.estimatedDuration || task?.duration)}`,
            `任务奖励：${clean(task?.reward, '0')} 信用点；${clean(task?.prestige, '0')} 声望值；额外奖励：${clean(task?.extraReward, '无')}`,
            `总进度：${formatProgress(task)}%`,
            '任务目标：',
            ...(objectives.length ? objectives : ['- 暂无具体目标｜0/1｜进行中'])
        ].join('\n');
    });

    return `【万象当前已接任务】\n以下内容是用户已经接取且尚未完成的任务事实。续写剧情时应保持任务信息与进度一致，不要把未接取任务视为已接取。\n\n${blocks.join('\n\n')}`;
}

export function buildWangxiangOrderInjectionContent(orders, userName = '用户') {
    const deliveryOrders = (Array.isArray(orders) ? orders : [])
        .filter(order => order?.status === 'shipping');
    if (!deliveryOrders.length) return '';
    const clean = (value, fallback = '未注明') => String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
    const blocks = deliveryOrders.map((order, index) => [
        `--- 配送订单 ${index + 1} ---`,
        `订单号：${clean(order.id)}`,
        `购买用户：${clean(userName, '用户')}`,
        `购买时间：${clean(order.createdAt)}`,
        `下单支付时间：${clean(order.paidAt || order.shippingAt)}`,
        `预计配送时长：${clean(order.estimatedDelivery, '1小时')}`,
        `预计送达时间：${clean(order.estimatedArrivalAt)}`,
        `商品名称：${clean(order.name, '未命名商品')}`,
        `商品信息：${clean(order.description, '暂无商品说明')}`,
        `购买数量：${Math.max(1, Number(order.quantity || 1))}`,
        `支付金额：${clean(order.totalPrice, '0')}`,
        `支付方式：${order.paymentMethod === 'wechat' ? '微信支付' : '信用点'}`,
        '配送状态：正在配送中',
        `收货信息：${clean(order.addressSnapshot?.recipient)}，${clean(order.addressSnapshot?.phone)}，${clean(order.addressSnapshot?.address)}`
    ].join('\n'));
    return `【万象商品配送信息】\n以下商品已由${clean(userName, '用户')}购买并支付，配送状态、支付时间与预计送达时间均为确定事实。续写剧情时不要重复下单或假设尚未支付。\n\n${blocks.join('\n\n')}`;
}

export function parseWangxiangTaskProgressTags(text) {
    const updates = [];
    const tagRegex = /<任务进度>([\s\S]*?)<\/任务进度>/gi;
    let tagMatch;
    while ((tagMatch = tagRegex.exec(String(text || ''))) !== null) {
        String(tagMatch[1] || '').split('\n').forEach(rawLine => {
            const line = rawLine.replace(/^\s*[-•]\s*/, '').trim();
            if (!line) return;
            const match = line.match(/^(.+?)[｜|](.+?)\s*[:：]\s*(\d+)\s*\/\s*(\d+)\s*$/);
            if (!match) return;
            updates.push({
                taskTitle: match[1].trim(),
                objectiveTitle: match[2].trim(),
                current: Number(match[3]),
                total: Number(match[4])
            });
        });
    }
    return updates;
}

export class WangxiangApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.wangxiangView = new WangxiangView(this);
        this.wechatData = window.VirtualPhone?.wechatApp?.wechatData || window.VirtualPhone?.cachedWechatData || new WechatData(storage);
        this.isRefreshingTasks = false;
        this.isRefreshingMarketplace = false;
        this._taskDataScopeKey = this._getCurrentTaskScopeKey();
        this.generatedTasks = this._loadGeneratedTasks();
        this.managedTasks = this._loadManagedTasks();
        this.taskProgressHistory = this._loadTaskProgressHistory();
        this.marketplaceCategories = this._loadMarketplaceCategories();
        this.marketplaceProducts = this._loadMarketplaceProducts();
        this.marketplaceOrders = this._loadMarketplaceOrders();
        this.inventoryItems = this._loadInventoryItems();
        this.creditBalance = this._loadCreditBalance();
        this.deliveryAddresses = this._loadDeliveryAddresses();
        this._reconcileGeneratedTaskStatuses();
        this._reconcilePersistedTaskAndInventoryState();

        window.addEventListener('phone:swipeBack', () => this.handleSwipeBack());
        window.addEventListener('phone:timeUpdated', () => {
            this._handlePhoneTimeUpdated().catch(error => console.warn('[Wangxiang] 配送状态检查失败:', error));
        });
    }

    attachRuntime(phoneShell, storage) {
        if (phoneShell?.setContent) this.phoneShell = phoneShell;
        if (storage) {
            this.storage = storage;
            if (this.wechatData) this.wechatData.storage = storage;
        }
        if (this.wangxiangView) this.wangxiangView.app = this;
        return this;
    }

    async render() {
        if (!this.phoneShell?.setContent) {
            throw new Error('万象运行时未绑定手机壳');
        }
        this._syncTaskDataScope();
        const deliveredOrders = await this.checkMarketplaceDeliveries({ showPopup: false });
        await this.wangxiangView.render();
        if (deliveredOrders.length) {
            await this.wangxiangView.showMarketplaceDeliveryPopup(deliveredOrders);
        }
    }

    clearCache() {
        this._taskDataScopeKey = '';
        this.generatedTasks = [];
        this.managedTasks = [];
        this.taskProgressHistory = [];
        this.marketplaceCategories = [];
        this.marketplaceProducts = [];
        this.marketplaceOrders = [];
        this.inventoryItems = [];
        this.creditBalance = 0;
        this.deliveryAddresses = [];
        this.wangxiangView.currentTaskId = '';
        this._syncTaskDataScope();
    }

    getMarketplaceCategories() {
        return Array.isArray(this.marketplaceCategories) && this.marketplaceCategories.length === WANGXIANG_DEFAULT_MARKET_CATEGORIES.length
            ? [...this.marketplaceCategories]
            : [...WANGXIANG_DEFAULT_MARKET_CATEGORIES];
    }

    getMarketplaceProducts() {
        return Array.isArray(this.marketplaceProducts) ? this.marketplaceProducts : [];
    }

    getMarketplaceOrders() {
        return Array.isArray(this.marketplaceOrders) ? this.marketplaceOrders : [];
    }

    getInventoryItems() {
        const stacks = new Map();
        (Array.isArray(this.inventoryItems) ? this.inventoryItems : []).forEach(item => {
            const stackKey = String(item?.name || '').replace(/\s+/g, '').toLocaleLowerCase();
            if (!stackKey) return;
            if (!stacks.has(stackKey)) {
                stacks.set(stackKey, {
                    ...item,
                    quantity: 0,
                    sourceCount: 0,
                    sourceTypes: new Set()
                });
            }
            const stack = stacks.get(stackKey);
            stack.quantity += Math.max(1, Number(item?.quantity || 1));
            stack.sourceCount += 1;
            stack.sourceTypes.add(item?.sourceType === 'task' ? 'task' : 'order');
            if (!stack.description && item?.description) stack.description = item.description;
        });
        return Array.from(stacks.values()).map(stack => {
            const mixedSources = stack.sourceTypes.size > 1;
            const sourceCount = stack.sourceCount;
            const sourceLabel = sourceCount > 1
                ? `${mixedSources ? '多种来源' : (stack.sourceType === 'task' ? '任务奖励' : '订单送达')} · 累计 ${sourceCount} 次`
                : stack.sourceLabel;
            delete stack.sourceTypes;
            return { ...stack, sourceType: mixedSources ? 'mixed' : stack.sourceType, sourceLabel };
        });
    }

    _addInventoryItem(item = {}) {
        if (!Array.isArray(this.inventoryItems)) this.inventoryItems = [];
        const sourceKey = String(item.sourceKey || '').trim();
        const name = String(item.name || '').replace(/\s+/g, ' ').trim();
        if (!sourceKey || !name || this.inventoryItems.some(existing => String(existing?.sourceKey || '') === sourceKey)) {
            return null;
        }
        const inventoryItem = {
            id: `inventory-${sourceKey.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120)}`,
            sourceKey,
            sourceType: item.sourceType === 'task' ? 'task' : 'order',
            sourceId: String(item.sourceId || ''),
            sourceLabel: String(item.sourceLabel || (item.sourceType === 'task' ? '任务奖励' : '订单送达')).slice(0, 80),
            name: name.slice(0, 80),
            description: String(item.description || '').replace(/\s+/g, ' ').trim().slice(0, 240),
            quantity: Math.max(1, Math.min(9999, Math.floor(Number(item.quantity) || 1))),
            categoryIndex: Math.max(0, Math.min(5, Number(item.categoryIndex || 0))),
            categoryName: String(item.categoryName || '').slice(0, 40),
            acquiredAt: String(item.acquiredAt || new Date().toLocaleString('zh-CN', { hour12: false })).slice(0, 80)
        };
        this.inventoryItems.unshift(inventoryItem);
        if (this.inventoryItems.length > 500) this.inventoryItems.length = 500;
        return inventoryItem;
    }

    _removeInventoryItemsBySourceKeys(sourceKeys) {
        if (!Array.isArray(this.inventoryItems)) this.inventoryItems = [];
        const keys = new Set((Array.isArray(sourceKeys) ? sourceKeys : []).map(value => String(value || '')).filter(Boolean));
        if (!keys.size) return false;
        const previousLength = this.inventoryItems.length;
        this.inventoryItems = this.inventoryItems.filter(item => !keys.has(String(item?.sourceKey || '')));
        return this.inventoryItems.length !== previousLength;
    }

    _parseTaskInventoryRewards(value) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text || /^(?:无|暂无|没有|none|null|0)$/i.test(text)) return [];
        const rewards = [];
        text.split(/[、，,；;\n]+/).map(part => part.trim()).filter(Boolean).forEach(part => {
            const standaloneQuantity = part.match(/^(\d+)\s*(?:个|件|份|瓶|盒|枚|颗|支|包|组|套)?$/);
            if (standaloneQuantity && rewards.length) {
                rewards[rewards.length - 1].quantity = Math.max(1, Math.min(9999, Number(standaloneQuantity[1]) || 1));
                return;
            }
            let name = part;
            let quantity = 1;
            const prefix = part.match(/^(\d+)\s*(?:个|件|份|瓶|盒|枚|颗|支|包|组|套)\s*(.+)$/);
            const suffix = part.match(/^(.*?)\s*(?:[xX×*]\s*(\d+)|(\d+)\s*(?:个|件|份|瓶|盒|枚|颗|支|包|组|套))\s*$/);
            const plainNumber = part.match(/^(.*?)\s+(\d+)\s*$/);
            if (prefix && String(prefix[2] || '').trim()) {
                name = prefix[2].trim();
                quantity = Number(prefix[1] || 1);
            } else if (suffix && String(suffix[1] || '').trim()) {
                name = suffix[1].trim();
                quantity = Number(suffix[2] || suffix[3] || 1);
            } else if (plainNumber && String(plainNumber[1] || '').trim()) {
                name = plainNumber[1].trim();
                quantity = Number(plainNumber[2] || 1);
            }
            name = name.replace(/^[\[【(（]\s*|\s*[\]】)）]$/g, '').trim();
            if (!name || /^(?:无|暂无|没有)$/i.test(name)) return;
            rewards.push({
                name,
                quantity: Math.max(1, Math.min(9999, Math.floor(quantity || 1)))
            });
        });
        return rewards.slice(0, 10);
    }

    _grantTaskRewardsToInventory(task) {
        const addedItems = [];
        this._parseTaskInventoryRewards(task?.extraReward).forEach((reward, index) => {
            const item = this._addInventoryItem({
                sourceKey: `task:${String(task?.id || '')}:${index}`,
                sourceType: 'task',
                sourceId: String(task?.id || ''),
                sourceLabel: `任务奖励 · ${String(task?.title || '未命名任务')}`,
                name: reward.name,
                description: `完成任务“${String(task?.title || '未命名任务')}”获得的额外奖励`,
                quantity: reward.quantity,
                acquiredAt: String(task?.completedAt || '')
            });
            if (item) addedItems.push(item);
        });
        return addedItems;
    }

    _grantDeliveredOrderToInventory(order) {
        const categoryIndex = Math.max(1, Math.min(5, Number(order?.categoryIndex || 1)));
        return this._addInventoryItem({
            sourceKey: `order:${String(order?.id || '')}`,
            sourceType: 'order',
            sourceId: String(order?.id || ''),
            sourceLabel: `订单送达 · ${String(order?.id || '')}`,
            name: String(order?.name || '未命名商品'),
            description: String(order?.description || ''),
            quantity: Math.max(1, Number(order?.quantity || 1)),
            categoryIndex,
            categoryName: this.getMarketplaceCategories()[categoryIndex - 1] || '商品',
            acquiredAt: String(order?.deliveredAt || '')
        });
    }

    _reconcileInventoryItems({ persist = false } = {}) {
        let changed = false;
        [...this.marketplaceOrders].reverse().forEach(order => {
            if (order?.status === 'delivered' && this._grantDeliveredOrderToInventory(order)) changed = true;
        });
        [...this.managedTasks].reverse().forEach(task => {
            if (task?.status === 'completed' && this._grantTaskRewardsToInventory(task).length) changed = true;
        });
        if (changed && persist) {
            this._saveInventoryItems().catch(error => console.error('[Wangxiang] 保存背包补录数据失败:', error));
        }
        return changed;
    }

    _reconcilePersistedTaskAndInventoryState() {
        const taskResult = this._reconcileCompletedManagedTasks();
        const inventoryChanged = this._reconcileInventoryItems();
        if (!taskResult.changed && !inventoryChanged) return false;
        const writes = [];
        if (taskResult.changed) {
            writes.push(this._saveGeneratedTasks(), this._saveManagedTasks(), this._saveTaskProgressHistory());
        }
        if (taskResult.creditChanged) writes.push(this._saveCreditBalance());
        if (taskResult.changed || inventoryChanged) writes.push(this._saveInventoryItems());
        Promise.all(writes).catch(error => console.error('[Wangxiang] 保存任务与背包补录数据失败:', error));
        return true;
    }

    getCurrentUserName() {
        const context = this._getContext();
        return String(context?.name1 || this._getWechatData()?.getUserInfo?.()?.name || '用户').trim() || '用户';
    }

    getCreditBalance() {
        return Math.max(0, Number(this.creditBalance || 0));
    }

    getWechatWalletBalance() {
        const balance = this._getWechatData()?.getWalletBalance?.();
        return balance === null || balance === undefined || !Number.isFinite(Number(balance)) ? null : Math.max(0, Number(balance));
    }

    getDeliveryAddresses() {
        return Array.isArray(this.deliveryAddresses) ? this.deliveryAddresses.map(item => ({ ...item })) : [];
    }

    async addDeliveryAddress(address = {}) {
        this._syncTaskDataScope();
        const recipient = String(address.recipient || '').trim();
        const phone = String(address.phone || '').trim();
        const detail = String(address.address || '').replace(/\s+/g, ' ').trim();
        if (!recipient || !phone || !detail) throw new Error('请完整填写收货人、联系电话和地址');
        const item = {
            id: `address-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            label: String(address.label || '常用地址').trim().slice(0, 12) || '常用地址',
            recipient: recipient.slice(0, 30),
            phone: phone.slice(0, 30),
            address: detail.slice(0, 160),
            isDefault: this.deliveryAddresses.length === 0 || address.isDefault === true
        };
        if (item.isDefault) this.deliveryAddresses.forEach(existing => { existing.isDefault = false; });
        this.deliveryAddresses.push(item);
        await this._saveDeliveryAddresses();
        return { ...item };
    }

    async removeDeliveryAddress(addressId) {
        this._syncTaskDataScope();
        const removed = this.deliveryAddresses.find(item => String(item.id) === String(addressId || ''));
        this.deliveryAddresses = this.deliveryAddresses.filter(item => String(item.id) !== String(addressId || ''));
        if (removed?.isDefault && this.deliveryAddresses[0]) this.deliveryAddresses[0].isDefault = true;
        await this._saveDeliveryAddresses();
        return !!removed;
    }

    async setDefaultDeliveryAddress(addressId) {
        this._syncTaskDataScope();
        const target = this.deliveryAddresses.find(item => String(item.id) === String(addressId || ''));
        if (!target) throw new Error('收货地址不存在');
        this.deliveryAddresses.forEach(item => { item.isDefault = item === target; });
        await this._saveDeliveryAddresses();
        return { ...target, isDefault: true };
    }

    _getWechatData() {
        return window.VirtualPhone?.wechatApp?.wechatData || window.VirtualPhone?.cachedWechatData || this.wechatData;
    }

    async createMarketplaceOrder(productId, quantity = 1) {
        this._syncTaskDataScope();
        const product = this.marketplaceProducts.find(item => String(item?.id || '') === String(productId || ''));
        if (!product) throw new Error('商品不存在或已刷新');
        const safeQuantity = Math.max(1, Math.min(999, Math.floor(Number(quantity) || 1)));
        const stock = this._readMarketplaceStock(product.stock);
        if (Number.isFinite(stock) && safeQuantity > stock) throw new Error(`当前库存仅剩 ${stock}`);

        const order = {
            id: `WX${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
            productId: String(product.id || ''),
            categoryIndex: Number(product.categoryIndex || 1),
            name: String(product.name || '未命名商品'),
            description: String(product.description || ''),
            estimatedDelivery: String(product.estimatedDelivery || '1小时'),
            unitPrice: String(product.price || '0'),
            totalPrice: this._formatMarketplaceTotal(product.price, safeQuantity),
            quantity: safeQuantity,
            status: 'pending',
            createdAt: new Date().toLocaleString('zh-CN', { hour12: false })
        };
        this.marketplaceOrders.unshift(order);
        await this._saveMarketplaceOrders();
        return { ...order };
    }

    async removeMarketplaceOrder(orderId) {
        this._syncTaskDataScope();
        const id = String(orderId || '').trim();
        const order = this.marketplaceOrders.find(item => String(item?.id || '') === id) || null;
        if (!order) return null;
        this.marketplaceOrders = this.marketplaceOrders.filter(item => String(item?.id || '') !== id);
        await this._saveMarketplaceOrders();
        return { ...order };
    }

    async payMarketplaceOrder(orderId, paymentMethod, addressId) {
        this._syncTaskDataScope();
        const order = this.marketplaceOrders.find(item => String(item?.id || '') === String(orderId || ''));
        if (!order) throw new Error('订单不存在');
        if (order.status !== 'pending') return { ...order };
        const method = paymentMethod === 'wechat' ? 'wechat' : paymentMethod === 'credit' ? 'credit' : '';
        if (!method) throw new Error('请选择支付方式');
        const address = this.deliveryAddresses.find(item => String(item.id) === String(addressId || ''));
        if (!address) throw new Error('请选择收货地址');
        const amount = this._readMarketplaceAmount(order.totalPrice);
        if (!Number.isFinite(amount)) throw new Error('订单金额无法识别');
        const product = this.marketplaceProducts.find(item => String(item?.id || '') === String(order.productId || ''));
        const productStock = product ? this._readMarketplaceStock(product.stock) : Number.NaN;
        if (Number.isFinite(productStock) && Number(order.quantity) > productStock) throw new Error(`当前库存仅剩 ${productStock}`);

        if (method === 'credit') {
            if (this.getCreditBalance() < amount) throw new Error(`信用点不足，当前仅有 ${this.getCreditBalance().toLocaleString('zh-CN')}`);
            this.creditBalance = Math.max(0, this.getCreditBalance() - amount);
        } else {
            const wechatBalance = this.getWechatWalletBalance();
            if (wechatBalance === null) throw new Error('微信零钱尚未初始化');
            if (wechatBalance < amount) throw new Error(`微信零钱不足，当前仅有 ¥${wechatBalance.toFixed(2)}`);
            this._getWechatData()?.updateWalletBalance?.(-amount, null, {
                type: 'shopping',
                title: `万象购物-${order.name}`,
                detail: `订单号：${order.id} · ${order.quantity}件`,
                source: 'wangxiang',
                referenceId: `wangxiang:order:${order.id}`
            });
        }

        if (product && Number.isFinite(productStock)) {
            product.stock = this._replaceMarketplaceStock(product.stock, Math.max(0, productStock - Number(order.quantity)));
        }
        order.status = 'shipping';
        order.paymentMethod = method;
        order.addressId = String(address.id);
        order.addressSnapshot = { ...address };
        const paidTime = this._getCurrentPhoneTimeData();
        const deliveryMinutes = this._parseMarketplaceDeliveryMinutes(order.estimatedDelivery);
        const arrivalTime = this._addMinutesToPhoneTime(paidTime, deliveryMinutes);
        order.paidAt = this._formatPhoneTimeData(paidTime);
        order.paidAtTimestamp = paidTime.timestamp;
        order.shippingAt = order.paidAt;
        order.estimatedDelivery = String(order.estimatedDelivery || '1小时');
        order.estimatedDeliveryMinutes = deliveryMinutes;
        order.estimatedArrivalAt = this._formatPhoneTimeData(arrivalTime);
        order.estimatedArrivalTimestamp = arrivalTime.timestamp;
        await Promise.all([
            this._saveMarketplaceOrders(),
            method === 'credit' ? this._saveCreditBalance() : Promise.resolve(),
            product ? this._saveMarketplaceProducts() : Promise.resolve()
        ]);
        return { ...order };
    }

    _getCurrentPhoneTimeData(options = {}) {
        try {
            const timeManager = window.VirtualPhone?.timeManager;
            if (options.refresh === true) timeManager?.clearCache?.();
            const current = timeManager?.getCurrentStoryTime?.() || timeManager?.getCurrentTime?.();
            if (current?.date && current?.time) {
                const parsedTimestamp = timeManager?.parseTimeToTimestamp?.(current);
                const timestamp = Number.isFinite(Number(parsedTimestamp))
                    ? Number(parsedTimestamp)
                    : Number.isFinite(Number(current.timestamp)) ? Number(current.timestamp) : Date.now();
                return {
                    date: String(current.date),
                    weekday: String(current.weekday || ''),
                    time: String(current.time),
                    timestamp
                };
            }
        } catch (error) {
            console.warn('[Wangxiang] 获取配送时间基准失败:', error);
        }
        const now = new Date();
        return {
            date: `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日`,
            weekday: '',
            time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
            timestamp: now.getTime()
        };
    }

    _formatPhoneTimeData(timeData = {}) {
        return [timeData.date, timeData.weekday, timeData.time]
            .map(value => String(value || '').trim())
            .filter(Boolean)
            .join(' ');
    }

    _parseMarketplaceDeliveryMinutes(value) {
        const text = String(value || '').replace(/\s+/g, '').toLocaleLowerCase();
        let minutes = 0;
        const addMatches = (regex, multiplier) => {
            let match;
            while ((match = regex.exec(text)) !== null) minutes += Number(match[1]) * multiplier;
        };
        addMatches(/(\d+(?:\.\d+)?)(?:天|日|days?)/g, 24 * 60);
        addMatches(/(\d+(?:\.\d+)?)(?:小时|时|hours?|hrs?)/g, 60);
        addMatches(/(\d+(?:\.\d+)?)(?:分钟|分|minutes?|mins?)/g, 1);
        if (/半小时/.test(text)) minutes += 30;
        if (!Number.isFinite(minutes) || minutes <= 0) minutes = 60;
        return Math.max(1, Math.min(30 * 24 * 60, Math.round(minutes)));
    }

    _addMinutesToPhoneTime(baseTime, minutes) {
        try {
            const calculated = window.VirtualPhone?.timeManager?.addMinutesToStoryTime?.(baseTime, minutes);
            if (calculated?.date && calculated?.time && Number.isFinite(Number(calculated.timestamp))) {
                return calculated;
            }
        } catch (error) {
            console.warn('[Wangxiang] 计算预计送达时间失败:', error);
        }
        const timestamp = Number(baseTime?.timestamp) + (Math.max(1, Number(minutes) || 60) * 60 * 1000);
        const date = new Date(timestamp);
        return {
            date: `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日`,
            weekday: '',
            time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
            timestamp
        };
    }

    async checkMarketplaceDeliveries(options = {}) {
        this._syncTaskDataScope();
        const current = this._getCurrentPhoneTimeData({ refresh: options.refreshTime === true });
        const currentTimestamp = Number(current.timestamp);
        if (!Number.isFinite(currentTimestamp)) return [];

        const deliveredOrders = [];
        this.marketplaceOrders.forEach(order => {
            if (order?.status !== 'shipping') return;
            const arrivalTimestamp = Number(order.estimatedArrivalTimestamp);
            if (!Number.isFinite(arrivalTimestamp) || currentTimestamp < arrivalTimestamp) return;
            order.status = 'delivered';
            order.deliveredAt = this._formatPhoneTimeData(current);
            order.deliveredAtTimestamp = currentTimestamp;
            this._grantDeliveredOrderToInventory(order);
            deliveredOrders.push({ ...order });
        });
        if (!deliveredOrders.length) return [];

        await Promise.all([this._saveMarketplaceOrders(), this._saveInventoryItems()]);
        if (options.showPopup !== false) {
            await this.wangxiangView.showMarketplaceDeliveryPopup(deliveredOrders);
        }
        return deliveredOrders;
    }

    async _handlePhoneTimeUpdated() {
        const deliveredOrders = await this.checkMarketplaceDeliveries({ showPopup: false, refreshTime: true });
        if (!deliveredOrders.length) return [];
        const root = document.querySelector('.phone-view-current .wangxiang-app');
        if (root) {
            this.wangxiangView._renderMarketplaceOrders(root);
            this.wangxiangView._renderInventoryItems(root);
        }
        await this.wangxiangView.showMarketplaceDeliveryPopup(deliveredOrders);
        return deliveredOrders;
    }

    _readMarketplaceStock(value) {
        const match = String(value ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
        return match ? Math.max(0, Math.floor(Number(match[0]))) : Number.NaN;
    }

    _readMarketplaceAmount(value) {
        const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
        const amount = match ? Number(match[0]) : Number.NaN;
        return Number.isFinite(amount) && amount >= 0 ? amount : Number.NaN;
    }

    _replaceMarketplaceStock(value, nextStock) {
        const text = String(value ?? '');
        return /\d[\d,.]*/.test(text) ? text.replace(/\d[\d,.]*/, String(nextStock)) : String(nextStock);
    }

    _formatMarketplaceTotal(price, quantity) {
        const text = String(price || '0').trim();
        const match = text.match(/-?\d[\d,]*(?:\.\d+)?/);
        if (!match) return quantity === 1 ? text : `${text} × ${quantity}`;
        const amount = Number(match[0].replace(/,/g, ''));
        if (!Number.isFinite(amount)) return quantity === 1 ? text : `${text} × ${quantity}`;
        const total = amount * quantity;
        const formatted = Number.isInteger(total) ? total.toLocaleString('zh-CN') : total.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
        return text.replace(match[0], formatted);
    }

    async setMarketplaceCategories(categories) {
        this._syncTaskDataScope();
        const normalized = (Array.isArray(categories) ? categories : [])
            .map(value => String(value || '').replace(/\s+/g, ' ').trim());
        if (normalized.length !== WANGXIANG_DEFAULT_MARKET_CATEGORIES.length || normalized.some(value => !value)) {
            throw new Error('请填写全部商品分类');
        }
        if (normalized.some(value => value.length > 8)) {
            throw new Error('商品分类名称最多 8 个字');
        }
        if (new Set(normalized.map(value => value.toLocaleLowerCase())).size !== normalized.length) {
            throw new Error('商品分类名称不能重复');
        }
        this.marketplaceCategories = normalized;
        await this.storage?.set?.('wangxiang_market_categories', JSON.stringify(normalized));
        return this.getMarketplaceCategories();
    }

    getGeneratedTasks() {
        return Array.isArray(this.generatedTasks) ? this.generatedTasks : [];
    }

    getManagedTasks() {
        return Array.isArray(this.managedTasks) ? this.managedTasks : [];
    }

    getTaskById(taskId) {
        const id = String(taskId || '').trim();
        return this.managedTasks.find(item => String(item?.id || '') === id)
            || this.generatedTasks.find(item => String(item?.id || '') === id)
            || null;
    }

    _normalizeTaskTitle(value) {
        return String(value || '').trim().replace(/\s+/g, '');
    }

    _syncGeneratedTaskProgress(task) {
        const generatedTask = this.generatedTasks.find(item => String(item?.id || '') === String(task?.id || ''));
        if (!generatedTask) return;
        generatedTask.progress = Number(task?.progress || 0);
        generatedTask.objectives = Array.isArray(task?.objectives)
            ? task.objectives.map(item => ({ ...item }))
            : [];
    }

    _recalculateTaskProgress(task) {
        const objectives = Array.isArray(task?.objectives) ? task.objectives : [];
        const total = objectives.reduce((sum, item) => sum + Math.max(1, Number(item?.total || 1)), 0);
        const current = objectives.reduce((sum, item) => {
            const objectiveTotal = Math.max(1, Number(item?.total || 1));
            return sum + Math.max(0, Math.min(objectiveTotal, Number(item?.current || 0)));
        }, 0);
        task.progress = total > 0 ? Math.round((current / total) * 100) : 0;
        return task.progress;
    }

    _areTaskObjectivesComplete(task) {
        const objectives = Array.isArray(task?.objectives) ? task.objectives : [];
        return objectives.length > 0 && objectives.every(item => {
            const total = Math.max(1, Number(item?.total || 1));
            return Math.max(0, Number(item?.current || 0)) >= total;
        });
    }

    _cloneTaskForProgressHistory(task) {
        if (!task) return null;
        return {
            ...task,
            objectives: Array.isArray(task.objectives) ? task.objectives.map(item => ({ ...item })) : [],
            comments: Array.isArray(task.comments) ? task.comments.map(item => ({ ...item })) : []
        };
    }

    _captureTaskCompletionState(task, snapshot) {
        if (!snapshot || Object.prototype.hasOwnProperty.call(snapshot, 'previousStatus')) return;
        const generatedTaskIndex = this.generatedTasks.findIndex(item => String(item?.id || '') === String(task?.id || ''));
        snapshot.previousStatus = String(task?.status || 'active');
        snapshot.hadCompletedAt = Object.prototype.hasOwnProperty.call(task, 'completedAt');
        snapshot.previousCompletedAt = task?.completedAt;
        snapshot.hadCreditRewardGranted = Object.prototype.hasOwnProperty.call(task, 'creditRewardGranted');
        snapshot.previousCreditRewardGranted = task?.creditRewardGranted;
        snapshot.hadCreditRewardAmount = Object.prototype.hasOwnProperty.call(task, 'creditRewardAmount');
        snapshot.previousCreditRewardAmount = task?.creditRewardAmount;
        snapshot.generatedTaskIndex = generatedTaskIndex;
        snapshot.generatedTaskSnapshot = generatedTaskIndex >= 0
            ? this._cloneTaskForProgressHistory(this.generatedTasks[generatedTaskIndex])
            : null;
        snapshot.grantedCreditAmount = 0;
        snapshot.grantedInventorySourceKeys = [];
        snapshot.completionApplied = false;
    }

    _completeManagedTaskFromProgress(task, snapshot = null) {
        if (!task || task.status === 'completed' || !this._areTaskObjectivesComplete(task)) return 0;
        if (snapshot) this._captureTaskCompletionState(task, snapshot);

        const creditAlreadyGranted = task.creditRewardGranted === true;
        task.status = 'completed';
        task.progress = 100;
        task.completedAt = task.completedAt || new Date().toLocaleString('zh-CN', { hour12: false });
        if (snapshot) snapshot.completionApplied = true;
        const grantedInventoryItems = this._grantTaskRewardsToInventory(task);
        if (snapshot && grantedInventoryItems.length) {
            snapshot.grantedInventorySourceKeys.push(...grantedInventoryItems.map(item => item.sourceKey));
        }

        let grantedCreditAmount = 0;
        if (!creditAlreadyGranted) {
            const rewardAmount = this._readMarketplaceAmount(task.reward);
            grantedCreditAmount = Number.isFinite(rewardAmount) ? rewardAmount : 0;
            this.creditBalance = this.getCreditBalance() + grantedCreditAmount;
            task.creditRewardGranted = true;
            task.creditRewardAmount = grantedCreditAmount;
        }
        if (snapshot) snapshot.grantedCreditAmount = Number(snapshot.grantedCreditAmount || 0) + grantedCreditAmount;

        this.generatedTasks = this.generatedTasks.filter(item => String(item?.id || '') !== String(task.id || ''));
        return grantedCreditAmount;
    }

    _reconcileCompletedManagedTasks({ persist = false } = {}) {
        let changed = false;
        let creditChanged = false;
        this.managedTasks.forEach(task => {
            if (task?.status === 'completed' || !this._areTaskObjectivesComplete(task)) return;
            const historySnapshot = [...this.taskProgressHistory].reverse()
                .flatMap(entry => Array.isArray(entry?.taskSnapshots) ? entry.taskSnapshots : [])
                .find(snapshot => String(snapshot?.taskId || '') === String(task?.id || '')) || null;
            if (historySnapshot) this._captureTaskCompletionState(task, historySnapshot);
            const grantedCredit = this._completeManagedTaskFromProgress(task, historySnapshot);
            changed = true;
            if (grantedCredit > 0) creditChanged = true;
        });
        if (changed && persist) {
            Promise.all([
                this._saveGeneratedTasks(),
                this._saveManagedTasks(),
                this._saveTaskProgressHistory(),
                creditChanged ? this._saveCreditBalance() : Promise.resolve(),
                this._saveInventoryItems()
            ]).catch(error => console.error('[Wangxiang] 保存自动完成任务失败:', error));
        }
        return { changed, creditChanged };
    }

    async applyTaskProgressText(text, source = {}) {
        this._syncTaskDataScope();
        const parsedUpdates = parseWangxiangTaskProgressTags(text);
        if (!parsedUpdates.length) return { changed: false, completions: [], updates: [] };

        const floor = Number(source.tavernMessageIndex);
        const hasFloor = Number.isFinite(floor) && floor >= 0;
        const batchId = String(source.batchId || '');
        const duplicate = this.taskProgressHistory.some(entry =>
            hasFloor && Number(entry?.tavernMessageIndex) === floor && String(entry?.batchId || '') === batchId
        );
        if (duplicate) return { changed: false, completions: [], updates: [] };
        if (hasFloor) this._rollbackTaskProgressHistory(entry => Number(entry?.tavernMessageIndex) === floor);

        const taskSnapshots = new Map();
        const appliedUpdates = [];
        const completions = [];
        const activeTasks = this.managedTasks.filter(item => item?.status === 'active' || item?.status === 'submit');
        const genericTaskLabels = new Set(['任务名称', '任务标题', '当前任务', '已接任务'].map(value => this._normalizeTaskTitle(value)));
        const resolveProgressTarget = (update) => {
            const taskKey = this._normalizeTaskTitle(update.taskTitle);
            const objectiveKey = this._normalizeTaskTitle(update.objectiveTitle);
            const expectedTotal = Math.max(1, Number(update.total || 1));
            const findMatchingObjectives = (task, requireTitle = true) => (Array.isArray(task?.objectives) ? task.objectives : [])
                .filter(objective => {
                    const storedTotal = Math.max(1, Number(objective?.total || 1));
                    if (storedTotal !== expectedTotal) return false;
                    return !requireTitle || this._normalizeTaskTitle(objective?.title) === objectiveKey;
                });

            if (!genericTaskLabels.has(taskKey)) {
                const task = activeTasks.find(item => this._normalizeTaskTitle(item?.title) === taskKey);
                if (!task) return null;
                const objective = findMatchingObjectives(task, true)[0] || null;
                return objective ? { task, objective, matchMode: 'exact' } : null;
            }

            const objectiveMatches = activeTasks.flatMap(task =>
                findMatchingObjectives(task, true).map(objective => ({ task, objective, matchMode: 'generic_task_label_objective' }))
            );
            if (objectiveMatches.length === 1) return objectiveMatches[0];
            if (objectiveMatches.length > 1) return null;

            const titleMatches = activeTasks.filter(task => this._normalizeTaskTitle(task?.title) === objectiveKey);
            if (titleMatches.length !== 1) return null;
            const inferredObjectives = findMatchingObjectives(titleMatches[0], false);
            return inferredObjectives.length === 1
                ? { task: titleMatches[0], objective: inferredObjectives[0], matchMode: 'generic_task_label_title' }
                : null;
        };

        parsedUpdates.forEach(update => {
            const resolved = resolveProgressTarget(update);
            if (!resolved) {
                console.warn('[Wangxiang] 任务进度未匹配到唯一任务目标，已跳过:', update);
                return;
            }
            const { task, objective } = resolved;

            const storedTotal = Math.max(1, Number(objective.total || 1));
            if (Number(update.total) !== storedTotal) return;
            const previousCurrent = Math.max(0, Math.min(storedTotal, Number(objective.current || 0)));
            const nextCurrent = Math.max(0, Math.min(storedTotal, Number(update.current || 0)));
            if (nextCurrent <= previousCurrent) return;

            if (!taskSnapshots.has(task.id)) {
                const generatedTaskIndex = this.generatedTasks.findIndex(item => String(item?.id || '') === String(task?.id || ''));
                taskSnapshots.set(task.id, {
                    taskId: String(task.id || ''),
                    previousProgress: Number(task.progress || 0),
                    previousStatus: String(task.status || 'active'),
                    hadCompletedAt: Object.prototype.hasOwnProperty.call(task, 'completedAt'),
                    previousCompletedAt: task.completedAt,
                    hadCreditRewardGranted: Object.prototype.hasOwnProperty.call(task, 'creditRewardGranted'),
                    previousCreditRewardGranted: task.creditRewardGranted,
                    hadCreditRewardAmount: Object.prototype.hasOwnProperty.call(task, 'creditRewardAmount'),
                    previousCreditRewardAmount: task.creditRewardAmount,
                    generatedTaskIndex,
                    generatedTaskSnapshot: generatedTaskIndex >= 0
                        ? this._cloneTaskForProgressHistory(this.generatedTasks[generatedTaskIndex])
                        : null,
                    grantedCreditAmount: 0,
                    grantedInventorySourceKeys: [],
                    completionApplied: false,
                    objectives: []
                });
            }
            taskSnapshots.get(task.id).objectives.push({
                objectiveId: String(objective.id || ''),
                objectiveTitle: String(objective.title || ''),
                previousCurrent,
                previousCompleted: objective.completed === true
            });

            objective.current = nextCurrent;
            objective.total = storedTotal;
            objective.completed = nextCurrent >= storedTotal;
            appliedUpdates.push({
                taskId: String(task.id || ''),
                taskTitle: String(task.title || ''),
                objectiveId: String(objective.id || ''),
                objectiveTitle: String(objective.title || ''),
                current: nextCurrent,
                total: storedTotal
            });
            if (previousCurrent < storedTotal && nextCurrent >= storedTotal) {
                completions.push({
                    taskTitle: String(task.title || ''),
                    objectiveTitle: String(objective.title || ''),
                    current: nextCurrent,
                    total: storedTotal
                });
            }
        });

        if (!appliedUpdates.length) {
            await Promise.all([
                this._saveManagedTasks(),
                this._saveGeneratedTasks(),
                this._saveTaskProgressHistory(),
                this._saveCreditBalance(),
                this._saveInventoryItems()
            ]);
            return { changed: false, completions: [], updates: [] };
        }

        taskSnapshots.forEach(snapshot => {
            const task = this.managedTasks.find(item => String(item?.id || '') === snapshot.taskId);
            if (!task) return;
            this._recalculateTaskProgress(task);
            if (this._areTaskObjectivesComplete(task)) {
                this._completeManagedTaskFromProgress(task, snapshot);
            } else {
                this._syncGeneratedTaskProgress(task);
            }
        });
        this.taskProgressHistory.push({
            tavernMessageIndex: hasFloor ? floor : null,
            batchId,
            taskSnapshots: Array.from(taskSnapshots.values())
        });
        await Promise.all([
            this._saveManagedTasks(),
            this._saveGeneratedTasks(),
            this._saveTaskProgressHistory(),
            this._saveCreditBalance(),
            this._saveInventoryItems()
        ]);
        return { changed: true, completions, updates: appliedUpdates };
    }

    _rollbackTaskProgressHistory(predicate) {
        const matched = this.taskProgressHistory.filter(predicate);
        if (!matched.length) return false;
        [...matched].reverse().forEach(entry => {
            [...(Array.isArray(entry?.taskSnapshots) ? entry.taskSnapshots : [])].reverse().forEach(snapshot => {
                const task = this.managedTasks.find(item => String(item?.id || '') === String(snapshot?.taskId || ''));
                if (!task) return;
                const preserveManualCompletion = snapshot.completionApplied !== true
                    && task.status === 'completed'
                    && task.completionSource === 'manual';
                if (!preserveManualCompletion) {
                    [...(Array.isArray(snapshot?.objectives) ? snapshot.objectives : [])].reverse().forEach(change => {
                        const objective = (Array.isArray(task.objectives) ? task.objectives : []).find(item =>
                            (change?.objectiveId && String(item?.id || '') === String(change.objectiveId))
                            || this._normalizeTaskTitle(item?.title) === this._normalizeTaskTitle(change?.objectiveTitle)
                        );
                        if (!objective) return;
                        objective.current = Number(change.previousCurrent || 0);
                        objective.completed = change.previousCompleted === true;
                    });
                    task.progress = Number(snapshot.previousProgress || 0);
                    if (snapshot.completionApplied === true && Object.prototype.hasOwnProperty.call(snapshot, 'previousStatus')) {
                        task.status = snapshot.previousStatus;
                        if (snapshot.hadCompletedAt) task.completedAt = snapshot.previousCompletedAt;
                        else delete task.completedAt;
                        if (snapshot.hadCreditRewardGranted) task.creditRewardGranted = snapshot.previousCreditRewardGranted;
                        else delete task.creditRewardGranted;
                        if (snapshot.hadCreditRewardAmount) task.creditRewardAmount = snapshot.previousCreditRewardAmount;
                        else delete task.creditRewardAmount;
                    }
                    if (snapshot.completionApplied === true && snapshot.generatedTaskSnapshot) {
                        const restoredGeneratedTask = this._cloneTaskForProgressHistory(snapshot.generatedTaskSnapshot);
                        const existingIndex = this.generatedTasks.findIndex(item => String(item?.id || '') === String(snapshot.taskId || ''));
                        if (existingIndex >= 0) this.generatedTasks[existingIndex] = restoredGeneratedTask;
                        else {
                            const restoreIndex = Math.max(0, Math.min(this.generatedTasks.length, Number(snapshot.generatedTaskIndex) || 0));
                            this.generatedTasks.splice(restoreIndex, 0, restoredGeneratedTask);
                        }
                    }
                    const grantedCreditAmount = Math.max(0, Number(snapshot.grantedCreditAmount || 0));
                    if (grantedCreditAmount > 0) {
                        this.creditBalance = Math.max(0, this.getCreditBalance() - grantedCreditAmount);
                    }
                    if (snapshot.completionApplied === true) {
                        this._removeInventoryItemsBySourceKeys(snapshot.grantedInventorySourceKeys);
                    }
                    this._syncGeneratedTaskProgress(task);
                }
            });
        });
        const matchedSet = new Set(matched);
        this.taskProgressHistory = this.taskProgressHistory.filter(entry => !matchedSet.has(entry));
        return true;
    }

    rollbackTaskProgressAtFloor(targetTavernIndex) {
        const floor = Number(targetTavernIndex);
        if (!Number.isFinite(floor)) return false;
        const changed = this._rollbackTaskProgressHistory(entry => Number(entry?.tavernMessageIndex) === floor);
        if (changed) {
            Promise.all([this._saveManagedTasks(), this._saveGeneratedTasks(), this._saveTaskProgressHistory(), this._saveCreditBalance(), this._saveInventoryItems()])
                .catch(error => console.error('[Wangxiang] 保存任务进度精确回滚失败:', error));
        }
        return changed;
    }

    rollbackTaskProgressToFloor(targetTavernIndex) {
        const floor = Number(targetTavernIndex);
        if (!Number.isFinite(floor)) return false;
        const changed = this._rollbackTaskProgressHistory(entry => Number(entry?.tavernMessageIndex) >= floor);
        if (changed) {
            Promise.all([this._saveManagedTasks(), this._saveGeneratedTasks(), this._saveTaskProgressHistory(), this._saveCreditBalance(), this._saveInventoryItems()])
                .catch(error => console.error('[Wangxiang] 保存任务进度回滚失败:', error));
        }
        return changed;
    }

    _buildWechatTaskData(task) {
        return {
            id: String(task?.id || ''),
            title: String(task?.title || '未命名任务'),
            publisher: String(task?.publisher || '万象任务中心'),
            description: String(task?.description || ''),
            location: String(task?.location || '未注明'),
            reward: String(task?.reward || '0'),
            prestige: String(task?.prestige || '0'),
            extraReward: String(task?.extraReward || '无'),
            publishedAt: String(task?.publishedAt || task?.remaining || '--'),
            startsAt: String(task?.startsAt || task?.startTime || '未注明'),
            estimatedDuration: String(task?.estimatedDuration || task?.duration || '未注明'),
            objectives: Array.isArray(task?.objectives) ? task.objectives.map(item => ({ ...item })) : [],
            status: String(task?.status || 'available')
        };
    }

    async contactTaskPublisher(taskId) {
        this._syncTaskDataScope();
        const task = this.getTaskById(taskId);
        if (!task) throw new Error('任务不存在或已刷新');

        const publisherName = String(task.publisher || '').trim();
        if (!publisherName) throw new Error('任务没有发布人信息');

        let wechatApp = window.VirtualPhone?.wechatApp || null;
        if (!wechatApp) {
            const module = await import('../wechat/wechat-app.js');
            wechatApp = new module.WechatApp(this.phoneShell, this.storage);
            if (!window.VirtualPhone) window.VirtualPhone = {};
            window.VirtualPhone.wechatApp = wechatApp;
        }
        if (window.VirtualPhone?.cachedWechatData) {
            wechatApp.wechatData = window.VirtualPhone.cachedWechatData;
        }

        const wechatData = wechatApp.wechatData;
        const publisherNameKey = wechatData._normalizeLookupName?.(publisherName)
            || publisherName.replace(/\s+/g, '').toLowerCase();
        let contact = (wechatData.getContacts?.() || []).find(item => {
            const contactNameKey = wechatData._normalizeLookupName?.(item?.name)
                || String(item?.name || '').trim().replace(/\s+/g, '').toLowerCase();
            return !!contactNameKey && contactNameKey === publisherNameKey;
        }) || null;
        if (!contact) {
            const contactId = `contact_wangxiang_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            contact = wechatData.addContact({
                id: contactId,
                name: publisherName,
                avatar: '👤',
                letter: wechatData.getFirstLetter?.(publisherName) || '#',
                relation: '万象任务发布人',
                sourceApp: 'wangxiang',
                sourceLabel: '万象任务'
            });
            wechatData.globalSocialStore?.upsertContact?.({
                app: 'wechat',
                appContactId: contact?.id || contactId,
                name: publisherName,
                avatar: contact?.avatar || '👤',
                relation: '万象任务发布人',
                extra: { sourceApp: 'wangxiang' }
            });
        }

        const contactId = String(contact?.id || '').trim();
        let chat = contactId ? wechatData.getChatByContactId?.(contactId) : null;
        if (!chat) {
            chat = wechatData.createChat({
                id: `chat_${contactId || `wangxiang_${Date.now()}`}`,
                contactId,
                name: publisherName,
                type: 'single',
                avatar: contact?.avatar || '👤'
            });
        }

        const taskData = this._buildWechatTaskData(task);
        const objectiveText = taskData.objectives
            .map(item => `${String(item?.title || '任务目标')}（${Number(item?.current || 0)}/${Math.max(1, Number(item?.total || 1))}）`)
            .join('；');
        const confirmationTitle = taskData.title.replace(/[\]\r\n]/g, '').trim();
        const content = [
            '[万象任务申请]',
            `任务名称：${taskData.title}`,
            `发布者：${taskData.publisher}`,
            `任务描述：${taskData.description}`,
            `任务目标：${objectiveText || '完成任务要求'}`,
            `奖励：${taskData.reward} 信用点`,
            `发布时间：${taskData.publishedAt}`,
            `任务开始时间：${taskData.startsAt}`,
            `预估耗时：${taskData.estimatedDuration}`,
            '发布者可根据当前剧情进度、角色自身视角与性格人设，自主决定同意或拒绝派发。',
            `若同意派发，请只回复：[确认派发任务：${confirmationTitle}]`,
            '若拒绝派发，无需回复确认派发任务的格式，也不要输出确认标签；请以符合角色性格与立场的口吻自然说明拒绝。'
        ].join('\n');

        const added = wechatData.addMessage(chat.id, {
            from: 'me',
            type: 'wangxiang_task_card',
            content,
            wangxiangTaskData: taskData,
            avatar: wechatData.getUserInfo?.()?.avatar || ''
        });
        if (!added) throw new Error('任务卡片发送失败');
        wechatApp.enqueueExternalMessageForAI?.(chat.id);

        wechatApp.currentChat = chat;
        window.currentWechatApp = wechatApp;
        window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'wechat' } }));
        setTimeout(() => wechatApp.openChat?.(chat.id), 0);
        return { task, contact, chat };
    }

    async acceptWechatTaskInvitation(taskData = {}, source = {}) {
        this._syncTaskDataScope();
        const sourceMessageId = String(source.messageId || '').trim();
        const taskId = String(taskData?.id || '').trim()
            || `wechat-invitation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const existing = this.managedTasks.find(item =>
            String(item?.id || '') === taskId
            || (sourceMessageId && String(item?.assignmentSource?.messageId || '') === sourceMessageId)
        );
        if (existing) return existing;

        const managedTask = this._normalizeLoadedTask({
            ...taskData,
            objectives: Array.isArray(taskData?.objectives) ? taskData.objectives.map(item => ({ ...item })) : [],
            comments: Array.isArray(taskData?.comments) ? taskData.comments.map(item => ({ ...item })) : [],
            id: taskId,
            status: 'active',
            acceptedAt: Date.now(),
            assignmentSource: {
                kind: 'wechat_invitation',
                chatId: String(source.chatId || ''),
                messageId: sourceMessageId,
                fromMainChatTag: source.fromMainChatTag === true,
                tavernMessageIndex: Number.isFinite(Number(source.tavernMessageIndex)) ? Number(source.tavernMessageIndex) : null,
                batchId: String(source.batchId || '')
            }
        }, this.managedTasks.length);
        this._recalculateTaskProgress(managedTask);
        this.managedTasks = [managedTask, ...this.managedTasks];

        const generatedTask = this.generatedTasks.find(item => String(item?.id || '') === taskId);
        if (generatedTask) generatedTask.status = 'active';
        await Promise.all([this._saveGeneratedTasks(), this._saveManagedTasks()]);
        return managedTask;
    }

    confirmTaskAssignmentByTitle(taskTitle, source = {}) {
        this._syncTaskDataScope();
        const titleKey = this._normalizeTaskTitle(taskTitle);
        if (!titleKey) return null;

        const publisherKey = this._normalizeTaskTitle(source.publisherName);
        const candidates = this.generatedTasks.filter(task =>
            this._normalizeTaskTitle(task?.title) === titleKey && task?.status !== 'completed'
        );
        const task = candidates.find(item => publisherKey && this._normalizeTaskTitle(item?.publisher) === publisherKey)
            || candidates[0]
            || this.managedTasks.find(item => this._normalizeTaskTitle(item?.title) === titleKey)
            || null;
        if (!task) return null;

        const existing = this.managedTasks.find(item => String(item?.id || '') === String(task.id || ''));
        if (existing) return existing;

        const assignmentSource = {
            kind: 'wechat_confirmation',
            chatId: String(source.chatId || ''),
            messageId: String(source.messageId || ''),
            fromMainChatTag: source.fromMainChatTag === true,
            tavernMessageIndex: Number.isFinite(Number(source.tavernMessageIndex)) ? Number(source.tavernMessageIndex) : null,
            batchId: String(source.batchId || '')
        };
        const managedTask = {
            ...task,
            status: 'active',
            progress: 0,
            acceptedAt: Date.now(),
            assignmentSource
        };
        task.status = 'active';
        this.managedTasks = [managedTask, ...this.managedTasks];
        Promise.all([this._saveGeneratedTasks(), this._saveManagedTasks()]).catch(error => {
            console.error('[Wangxiang] 保存微信确认派发状态失败:', error);
        });
        return managedTask;
    }

    rollbackWechatAssignmentsToFloor(targetTavernIndex, exact = false) {
        const targetFloor = Number(targetTavernIndex);
        if (!Number.isFinite(targetFloor)) return false;
        const progressRolledBack = exact
            ? this.rollbackTaskProgressAtFloor(targetFloor)
            : this.rollbackTaskProgressToFloor(targetFloor);
        const removedIds = new Set();
        this.managedTasks = this.managedTasks.filter(task => {
            const source = task?.assignmentSource;
            const isWechatAssignment = source?.kind === 'wechat_confirmation' || source?.kind === 'wechat_invitation';
            const sourceFloor = Number(source?.tavernMessageIndex);
            const floorMatched = exact ? sourceFloor === targetFloor : sourceFloor >= targetFloor;
            const shouldRemove = isWechatAssignment
                && source.fromMainChatTag === true
                && floorMatched;
            if (shouldRemove) removedIds.add(String(task.id || ''));
            return !shouldRemove;
        });
        if (!removedIds.size) return progressRolledBack;
        this.generatedTasks.forEach(task => {
            if (removedIds.has(String(task?.id || ''))) task.status = 'available';
        });
        Promise.all([this._saveGeneratedTasks(), this._saveManagedTasks()]).catch(error => {
            console.error('[Wangxiang] 回滚微信确认派发状态失败:', error);
        });
        return true;
    }

    rollbackWechatAssignmentsAtFloor(targetTavernIndex) {
        return this.rollbackWechatAssignmentsToFloor(targetTavernIndex, true);
    }

    async acceptTask(taskId) {
        throw new Error('请联系任务发布者，并由对方确认派发后领取任务');
    }

    async setManagedTaskStatus(taskId, status, patch = {}) {
        this._syncTaskDataScope();
        const allowedStatuses = new Set(['active', 'submit', 'completed']);
        if (!allowedStatuses.has(status)) throw new Error('无效的任务状态');
        const task = this.managedTasks.find(item => String(item?.id || '') === String(taskId || ''));
        if (!task) throw new Error('未找到已接取任务');
        const creditAlreadyGranted = task.creditRewardGranted === true || task.status === 'completed';

        Object.assign(task, patch, { status });
        if (status === 'submit') task.progress = 100;
        if (status === 'completed') {
            task.progress = 100;
            task.completionSource = String(patch?.completionSource || task.completionSource || 'manual');
            (Array.isArray(task.objectives) ? task.objectives : []).forEach(objective => {
                objective.total = Math.max(1, Number(objective?.total || 1));
                objective.current = objective.total;
                objective.completed = true;
            });
            task.completedAt = task.completedAt || new Date().toLocaleString('zh-CN', { hour12: false });
            if (!creditAlreadyGranted) {
                const rewardAmount = this._readMarketplaceAmount(task.reward);
                const safeReward = Number.isFinite(rewardAmount) ? rewardAmount : 0;
                this.creditBalance = this.getCreditBalance() + safeReward;
                task.creditRewardGranted = true;
                task.creditRewardAmount = safeReward;
            }
            this._grantTaskRewardsToInventory(task);
        }
        const generatedTask = this.generatedTasks.find(item => String(item?.id || '') === String(task.id || ''));
        if (generatedTask) generatedTask.status = status;
        if (status === 'completed') {
            this.generatedTasks = this.generatedTasks.filter(item => String(item?.id || '') !== String(task.id || ''));
        }
        await Promise.all([
            this._saveGeneratedTasks(),
            this._saveManagedTasks(),
            status === 'completed' && !creditAlreadyGranted ? this._saveCreditBalance() : Promise.resolve(),
            status === 'completed' ? this._saveInventoryItems() : Promise.resolve()
        ]);
        return task;
    }

    completeTask(taskId) {
        return this.setManagedTaskStatus(taskId, 'completed', { completionSource: 'manual' });
    }

    async abandonTask(taskId) {
        this._syncTaskDataScope();
        const id = String(taskId || '').trim();
        const task = this.managedTasks.find(item => String(item?.id || '') === id);
        if (!task) throw new Error('未找到已接取任务');
        this.managedTasks = this.managedTasks.filter(item => String(item?.id || '') !== id);
        const generatedTask = this.generatedTasks.find(item => String(item?.id || '') === id);
        if (generatedTask) generatedTask.status = 'available';
        await Promise.all([
            this._saveGeneratedTasks(),
            this._saveManagedTasks()
        ]);
        return task;
    }

    async refreshTaskHall() {
        if (this.isRefreshingTasks) return null;
        this._syncTaskDataScope();
        const requestScopeKey = this._taskDataScopeKey;
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager?.callAI) throw new Error('API Manager 未初始化');

        this.isRefreshingTasks = true;
        try {
            const messages = await this._buildTaskMessages();
            const result = await apiManager.callAI(messages, {
                appId: 'wangxiang',
                temperature: 0.75
            });
            if (!result?.success) throw new Error(result?.error || '任务生成失败');

            const rawText = String(result.summary || result.content || result.text || '').trim();
            const cleanedText = applyPhoneTagFilter(rawText, { storage: this.storage }) || rawText;
            if (this._getCurrentTaskScopeKey() !== requestScopeKey) {
                throw new Error('生成期间会话已切换，本次任务未写入任何聊天');
            }
            const tasks = this._parseTaskResponse(cleanedText);
            if (!tasks.length) throw new Error('没有解析到有效任务，请重新下拉生成');

            const preservedTasks = this.managedTasks
                .filter(task => task.status === 'active' || task.status === 'submit')
                .map(task => ({ ...task }));
            const preservedIds = new Set(preservedTasks.map(task => String(task?.id || '')));
            const freshTasks = tasks.filter(task => !preservedIds.has(String(task?.id || '')));
            this.generatedTasks = [...freshTasks, ...preservedTasks];
            await this._saveGeneratedTasks();
            return this.generatedTasks;
        } finally {
            this.isRefreshingTasks = false;
        }
    }

    async refreshMarketplace() {
        if (this.isRefreshingMarketplace) return null;
        this._syncTaskDataScope();
        const requestScopeKey = this._taskDataScopeKey;
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager?.callAI) throw new Error('API Manager 未初始化');

        this.isRefreshingMarketplace = true;
        try {
            this.marketplaceProducts = [];
            await this._saveMarketplaceProducts();
            const messages = await this._buildMarketplaceMessages();
            const result = await apiManager.callAI(messages, {
                appId: 'wangxiang',
                temperature: 0.75
            });
            if (!result?.success) throw new Error(result?.error || '商品生成失败');

            const rawText = String(result.summary || result.content || result.text || '').trim();
            const cleanedText = applyPhoneTagFilter(rawText, { storage: this.storage }) || rawText;
            if (this._getCurrentTaskScopeKey() !== requestScopeKey) {
                throw new Error('生成期间会话已切换，本次商品未写入任何聊天');
            }
            const products = this._parseMarketplaceResponse(cleanedText);
            if (!products.length) throw new Error('没有解析到有效商品，请重新下拉生成');

            this.marketplaceProducts = products;
            await this._saveMarketplaceProducts();
            return this.getMarketplaceProducts();
        } finally {
            this.isRefreshingMarketplace = false;
        }
    }

    async _buildMarketplaceMessages() {
        const context = this._getContext();
        if (!context) throw new Error('无法访问 SillyTavern 角色信息');

        const userName = context.name1 || '用户';
        const charName = context.name2 || '角色';
        const messages = [
            this._buildCharacterMessage(context, charName),
            this._buildPersonaMessage(context, userName)
        ].filter(Boolean);

        await window.VirtualPhone?.worldbookManager?.appendWorldbookMessages?.(messages, 'wangxiang-marketplace');

        const promptManager = window.VirtualPhone?.promptManager;
        promptManager?.ensureLoaded?.();
        let marketplacePrompt = promptManager?.getPromptForFeature?.('wangxiang', 'marketplace')
            || promptManager?.getDefaultPrompts?.()?.wangxiang?.marketplace?.content
            || '';
        const categoryText = this.getMarketplaceCategories().map(category => `- ${category}`).join('\n');
        marketplacePrompt = String(marketplacePrompt)
            .replace(/\{\{\s*user\s*\}\}/g, userName)
            .replace(/\{\{\s*char\s*\}\}/g, charName)
            .replace(/\{\{\s*storyTime\s*\}\}/gi, this._getCurrentPhoneTimeLabel())
            .replace(/\{\{\s*marketCategories\s*\}\}/gi, categoryText)
            .trim();
        if (!marketplacePrompt) throw new Error('商品商场提示词为空');
        messages.push({ role: 'user', content: marketplacePrompt, isPhoneMessage: true });
        return messages;
    }

    _parseMarketplaceResponse(rawText) {
        const wrapper = String(rawText || '').match(/<商场>([\s\S]*?)<\/商场>/i);
        if (!wrapper) return [];

        const categories = this.getMarketplaceCategories();
        const normalize = value => String(value || '').replace(/[\s　]+/g, '').toLocaleLowerCase();
        const categoryIndexByName = new Map(categories.map((category, index) => [normalize(category), index + 1]));
        const content = String(wrapper[1] || '');
        const headings = Array.from(content.matchAll(/^\s*\[([^\]\r\n]+)\]\s*$/gm));
        const products = [];

        headings.forEach((heading, headingIndex) => {
            const categoryIndex = categoryIndexByName.get(normalize(heading[1]));
            if (!categoryIndex) return;
            const sectionStart = Number(heading.index || 0) + heading[0].length;
            const sectionEnd = headingIndex + 1 < headings.length ? Number(headings[headingIndex + 1].index || content.length) : content.length;
            const section = content.slice(sectionStart, sectionEnd).replace(/^\s*---+\s*$/gm, '').trim();
            const itemBlocks = section.split(/(?=^\s*物品\s*[:：])/m).filter(block => /^\s*物品\s*[:：]/.test(block));

            itemBlocks.forEach(block => {
                const readField = field => String(block.match(new RegExp(`^\\s*${field}\\s*[:：]\\s*(.+?)\\s*$`, 'm'))?.[1] || '').trim();
                const name = readField('物品');
                if (!name) return;
                const rawTags = readField('标签');
                const tags = rawTags
                    .split(/[|｜,，、/I]+/)
                    .map(tag => tag.trim().slice(0, 2))
                    .filter(Boolean)
                    .slice(0, 2);
                products.push({
                    id: `market-${Date.now().toString(36)}-${products.length}-${Math.random().toString(36).slice(2, 6)}`,
                    categoryIndex,
                    name: name.slice(0, 40),
                    price: readField('售价').slice(0, 24) || '0',
                    description: readField('简介').slice(0, 240),
                    stock: readField('库存').slice(0, 24) || '0',
                    estimatedDelivery: readField('预计配送时间').slice(0, 32) || '1小时',
                    tags
                });
            });
        });

        return products.slice(0, 60);
    }

    async _buildTaskMessages() {
        const context = this._getContext();
        if (!context) throw new Error('无法访问 SillyTavern 角色信息');

        const userName = context.name1 || '用户';
        const charName = context.name2 || '角色';
        const messages = [
            this._buildCharacterMessage(context, charName),
            this._buildPersonaMessage(context, userName)
        ].filter(Boolean);

        await window.VirtualPhone?.worldbookManager?.appendWorldbookMessages?.(messages, 'wangxiang');

        const promptManager = window.VirtualPhone?.promptManager;
        promptManager?.ensureLoaded?.();
        let taskPrompt = promptManager?.getPromptForFeature?.('wangxiang', 'tasks')
            || promptManager?.getDefaultPrompts?.()?.wangxiang?.tasks?.content
            || '';
        const storyTime = this._getCurrentPhoneTimeLabel();
        taskPrompt = String(taskPrompt)
            .replace(/\{\{\s*user\s*\}\}/g, userName)
            .replace(/\{\{\s*char\s*\}\}/g, charName)
            .replace(/\{\{\s*storyTime\s*\}\}/gi, storyTime)
            .replace(/\{\{\s*STORY_TIME\s*\}\}/g, storyTime)
            .trim();
        if (!taskPrompt) throw new Error('任务大厅提示词为空');
        messages.push({ role: 'user', content: taskPrompt, isPhoneMessage: true });
        return messages;
    }

    _getCurrentPhoneTimeLabel() {
        try {
            const timeManager = window.VirtualPhone?.timeManager;
            const current = timeManager?.getCurrentStoryTime?.() || timeManager?.getCurrentTime?.();
            const parts = [current?.date, current?.weekday, current?.time]
                .map(value => String(value || '').trim())
                .filter(Boolean);
            if (parts.length) return parts.join(' ');
        } catch (error) {
            console.warn('[Wangxiang] 获取手机当前时间失败:', error);
        }
        return '当前手机时间未知，请根据故事背景合理推断';
    }

    _buildCharacterMessage(context, fallbackName = '角色') {
        const character = context?.characterId !== undefined && context?.characters
            ? context.characters[context.characterId]
            : null;
        const parts = [`角色名：${character?.name || fallbackName}`];
        if (character?.description) parts.push(`描述：${String(character.description).trim().slice(0, 2400)}`);
        if (character?.personality) parts.push(`性格：${String(character.personality).trim().slice(0, 1200)}`);
        if (character?.scenario || context?.scenario) parts.push(`场景/背景：${String(character?.scenario || context.scenario).trim().slice(0, 1600)}`);
        if (character?.first_mes) parts.push(`开场白：${String(character.first_mes).trim().slice(0, 800)}`);
        if (character?.mes_example) parts.push(`示例对话：${String(character.mes_example).trim().slice(0, 1200)}`);
        if (character?.data?.system_prompt) parts.push(`角色系统提示词：${String(character.data.system_prompt).trim().slice(0, 1200)}`);
        return {
            role: 'system',
            content: `【角色卡信息】\n${parts.join('\n')}`,
            name: 'SYSTEM (角色卡信息)',
            isPhoneMessage: true
        };
    }

    _buildPersonaMessage(context, userName = '用户') {
        const personaText = String(document.getElementById('persona_description')?.value || '').trim();
        const parts = [`姓名：${userName}`];
        if (personaText) parts.push(`用户设定：${personaText.slice(0, 2400)}`);
        return {
            role: 'system',
            content: `【用户信息】\n${parts.join('\n')}`,
            name: 'SYSTEM (用户信息)',
            isPhoneMessage: true
        };
    }

    _parseTaskResponse(rawText) {
        return parseWangxiangTaskTags(rawText, {
            idPrefix: 'generated',
            source: 'wangxiang_task_hall',
            maxTasks: 10
        });
    }

    _normalizeLoadedTask(task, index = 0) {
        const visual = WANGXIANG_TASK_VISUALS[index % WANGXIANG_TASK_VISUALS.length];
        return {
            ...task,
            publishedAt: String(task?.publishedAt || task?.remaining || '--'),
            startsAt: String(task?.startsAt || task?.startTime || '未注明'),
            estimatedDuration: String(task?.estimatedDuration || task?.duration || '未注明'),
            icon: String(task?.icon || visual.icon),
            accent: String(task?.accent || visual.accent)
        };
    }

    _loadGeneratedTasks() {
        try {
            const saved = this.storage?.get?.('wangxiang_generated_tasks', null);
            const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
            return Array.isArray(parsed) ? parsed.map((task, index) => this._normalizeLoadedTask(task, index)) : [];
        } catch (error) {
            console.warn('[Wangxiang] 读取任务缓存失败:', error);
            return [];
        }
    }

    _loadManagedTasks() {
        try {
            const saved = this.storage?.get?.('wangxiang_managed_tasks', null);
            const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
            return Array.isArray(parsed) ? parsed.map((task, index) => this._normalizeLoadedTask(task, index)) : [];
        } catch (error) {
            console.warn('[Wangxiang] 读取我的任务失败:', error);
            return [];
        }
    }

    _loadTaskProgressHistory() {
        try {
            const saved = this.storage?.get?.('wangxiang_task_progress_history', null);
            const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.warn('[Wangxiang] 读取任务进度历史失败:', error);
            return [];
        }
    }

    _loadMarketplaceCategories() {
        try {
            const saved = this.storage?.get?.('wangxiang_market_categories', null);
            const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
            if (!Array.isArray(parsed) || parsed.length !== WANGXIANG_DEFAULT_MARKET_CATEGORIES.length) {
                return [...WANGXIANG_DEFAULT_MARKET_CATEGORIES];
            }
            const normalized = parsed.map(value => String(value || '').replace(/\s+/g, ' ').trim());
            if (normalized.some(value => !value || value.length > 8)) return [...WANGXIANG_DEFAULT_MARKET_CATEGORIES];
            if (new Set(normalized.map(value => value.toLocaleLowerCase())).size !== normalized.length) {
                return [...WANGXIANG_DEFAULT_MARKET_CATEGORIES];
            }
            return normalized;
        } catch (error) {
            console.warn('[Wangxiang] 读取商品分类失败:', error);
            return [...WANGXIANG_DEFAULT_MARKET_CATEGORIES];
        }
    }

    _loadMarketplaceProducts() {
        try {
            const saved = this.storage?.get?.('wangxiang_marketplace_products', null);
            const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
            if (!Array.isArray(parsed)) return [];
            return parsed.filter(product => product && product.name && Number(product.categoryIndex) >= 1 && Number(product.categoryIndex) <= 5)
                .map(product => ({
                    id: String(product.id || `market-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`),
                    categoryIndex: Number(product.categoryIndex),
                    name: String(product.name || '').slice(0, 40),
                    price: String(product.price || '0').slice(0, 24),
                    description: String(product.description || '').slice(0, 240),
                    stock: String(product.stock || '0').slice(0, 24),
                    estimatedDelivery: String(product.estimatedDelivery || '1小时').slice(0, 32),
                    tags: (Array.isArray(product.tags) ? product.tags : []).map(tag => String(tag || '').slice(0, 2)).filter(Boolean).slice(0, 2)
                }))
                .slice(0, 60);
        } catch (error) {
            console.warn('[Wangxiang] 读取商城商品失败:', error);
            return [];
        }
    }

    _loadMarketplaceOrders() {
        try {
            const saved = this.storage?.get?.('wangxiang_marketplace_orders', null);
            const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
            if (!Array.isArray(parsed)) return [];
            return parsed.filter(order => order && order.id && order.name)
                .map(order => ({
                    id: String(order.id),
                    productId: String(order.productId || ''),
                    categoryIndex: Math.max(1, Math.min(5, Number(order.categoryIndex || 1))),
                    name: String(order.name || '未命名商品').slice(0, 40),
                    description: String(order.description || '').slice(0, 240),
                    unitPrice: String(order.unitPrice || '0').slice(0, 24),
                    totalPrice: String(order.totalPrice || order.unitPrice || '0').slice(0, 32),
                    quantity: Math.max(1, Math.min(999, Math.floor(Number(order.quantity) || 1))),
                    status: order.status === 'delivered' ? 'delivered' : order.status === 'shipping' || order.status === 'paid' ? 'shipping' : 'pending',
                    createdAt: String(order.createdAt || ''),
                    paidAt: String(order.paidAt || ''),
                    paidAtTimestamp: Number(order.paidAtTimestamp) || 0,
                    shippingAt: String(order.shippingAt || order.paidAt || ''),
                    estimatedDelivery: String(order.estimatedDelivery || '1小时').slice(0, 32),
                    estimatedDeliveryMinutes: Math.max(1, Number(order.estimatedDeliveryMinutes) || this._parseMarketplaceDeliveryMinutes(order.estimatedDelivery)),
                    estimatedArrivalAt: String(order.estimatedArrivalAt || ''),
                    estimatedArrivalTimestamp: Number(order.estimatedArrivalTimestamp) || 0,
                    deliveredAt: String(order.deliveredAt || ''),
                    deliveredAtTimestamp: Number(order.deliveredAtTimestamp) || 0,
                    paymentMethod: order.paymentMethod === 'wechat' ? 'wechat' : order.paymentMethod === 'credit' ? 'credit' : '',
                    addressId: String(order.addressId || ''),
                    addressSnapshot: order.addressSnapshot && typeof order.addressSnapshot === 'object'
                        ? {
                            id: String(order.addressSnapshot.id || order.addressId || ''),
                            label: String(order.addressSnapshot.label || ''),
                            recipient: String(order.addressSnapshot.recipient || ''),
                            phone: String(order.addressSnapshot.phone || ''),
                            address: String(order.addressSnapshot.address || '')
                        }
                        : null
                }))
                .slice(0, 200);
        } catch (error) {
            console.warn('[Wangxiang] 读取商城订单失败:', error);
            return [];
        }
    }

    _loadInventoryItems() {
        try {
            const saved = this.storage?.get?.('wangxiang_inventory_items', null);
            const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
            if (!Array.isArray(parsed)) return [];
            const sourceKeys = new Set();
            return parsed.filter(item => item && item.sourceKey && item.name)
                .map(item => ({
                    id: String(item.id || `inventory-${Date.now().toString(36)}`),
                    sourceKey: String(item.sourceKey),
                    sourceType: item.sourceType === 'task' ? 'task' : 'order',
                    sourceId: String(item.sourceId || ''),
                    sourceLabel: String(item.sourceLabel || '').slice(0, 80),
                    name: String(item.name || '未命名物品').slice(0, 80),
                    description: String(item.description || '').slice(0, 240),
                    quantity: Math.max(1, Math.min(9999, Math.floor(Number(item.quantity) || 1))),
                    categoryIndex: Math.max(0, Math.min(5, Number(item.categoryIndex || 0))),
                    categoryName: String(item.categoryName || '').slice(0, 40),
                    acquiredAt: String(item.acquiredAt || '').slice(0, 80)
                }))
                .filter(item => {
                    if (sourceKeys.has(item.sourceKey)) return false;
                    sourceKeys.add(item.sourceKey);
                    return true;
                })
                .slice(0, 500);
        } catch (error) {
            console.warn('[Wangxiang] 读取背包失败:', error);
            return [];
        }
    }

    _loadCreditBalance() {
        const saved = this.storage?.get?.('wangxiang_credit_balance', 0);
        const value = Number(saved);
        return Number.isFinite(value) && value >= 0 ? value : 0;
    }

    _loadDeliveryAddresses() {
        try {
            const saved = this.storage?.get?.('wangxiang_delivery_addresses', null);
            const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
            if (!Array.isArray(parsed)) return [];
            const addresses = parsed.filter(item => item && item.id && item.recipient && item.address).map(item => ({
                id: String(item.id),
                label: String(item.label || '常用地址').slice(0, 12),
                recipient: String(item.recipient || '').slice(0, 30),
                phone: String(item.phone || '').slice(0, 30),
                address: String(item.address || '').slice(0, 160),
                isDefault: item.isDefault === true
            })).slice(0, 20);
            if (addresses.length && !addresses.some(item => item.isDefault)) addresses[0].isDefault = true;
            return addresses;
        } catch (error) {
            console.warn('[Wangxiang] 读取收货地址失败:', error);
            return [];
        }
    }

    _getCurrentTaskScopeKey() {
        try {
            const scopedKey = this.storage?.getStorageKey?.('wangxiang-scope');
            if (scopedKey) return String(scopedKey);
            const context = this.storage?.getContext?.() || this._getContext();
            const characterId = context?.characterId ?? context?.name2 ?? 'default';
            const chatId = context?.chatMetadata?.file_name ?? context?.chatId ?? 'default_chat';
            return `${characterId}::${chatId}`;
        } catch (error) {
            console.warn('[Wangxiang] 获取当前聊天作用域失败:', error);
            return 'default::default_chat';
        }
    }

    _syncTaskDataScope() {
        const nextScopeKey = this._getCurrentTaskScopeKey();
        if (nextScopeKey === this._taskDataScopeKey) return false;
        this._taskDataScopeKey = nextScopeKey;
        this.generatedTasks = this._loadGeneratedTasks();
        this.managedTasks = this._loadManagedTasks();
        this.taskProgressHistory = this._loadTaskProgressHistory();
        this.marketplaceCategories = this._loadMarketplaceCategories();
        this.marketplaceProducts = this._loadMarketplaceProducts();
        this.marketplaceOrders = this._loadMarketplaceOrders();
        this.inventoryItems = this._loadInventoryItems();
        this.creditBalance = this._loadCreditBalance();
        this.deliveryAddresses = this._loadDeliveryAddresses();
        this._reconcileGeneratedTaskStatuses();
        this._reconcilePersistedTaskAndInventoryState();
        return true;
    }

    _reconcileGeneratedTaskStatuses() {
        const statusById = new Map(this.managedTasks.map(task => [String(task?.id || ''), task.status]));
        this.generatedTasks = this.generatedTasks.filter(task => {
            const managedStatus = statusById.get(String(task?.id || ''));
            if (managedStatus === 'completed') return false;
            if (managedStatus) task.status = managedStatus;
            return task.status !== 'completed';
        });
    }

    _saveGeneratedTasks() {
        return this.storage?.set?.('wangxiang_generated_tasks', JSON.stringify(this.generatedTasks));
    }

    _saveManagedTasks() {
        return this.storage?.set?.('wangxiang_managed_tasks', JSON.stringify(this.managedTasks));
    }

    _saveTaskProgressHistory() {
        return this.storage?.set?.('wangxiang_task_progress_history', JSON.stringify(this.taskProgressHistory));
    }

    _saveMarketplaceProducts() {
        return this.storage?.set?.('wangxiang_marketplace_products', JSON.stringify(this.marketplaceProducts));
    }

    _saveMarketplaceOrders() {
        return this.storage?.set?.('wangxiang_marketplace_orders', JSON.stringify(this.marketplaceOrders));
    }

    _saveInventoryItems() {
        return Promise.resolve(this.storage?.set?.('wangxiang_inventory_items', JSON.stringify(this.inventoryItems)));
    }

    _saveCreditBalance() {
        return this.storage?.set?.('wangxiang_credit_balance', this.getCreditBalance());
    }

    _saveDeliveryAddresses() {
        return this.storage?.set?.('wangxiang_delivery_addresses', JSON.stringify(this.deliveryAddresses));
    }

    _getContext() {
        return (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
            ? SillyTavern.getContext()
            : null;
    }

    handleSwipeBack() {
        const currentView = document.querySelector('.phone-view-current');
        if (!currentView?.querySelector('.wangxiang-app')) return;

        if (this.wangxiangView.handleBack()) return;

        window.dispatchEvent(new CustomEvent('phone:goHome'));
    }
}
