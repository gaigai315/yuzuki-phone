import assert from 'node:assert/strict';
import test from 'node:test';

const previousWindow = globalThis.window;
const fakeWindow = new EventTarget();
fakeWindow.VirtualPhone = {};
globalThis.window = fakeWindow;

const { WangxiangApp } = await import(`../apps/wangxiang/wangxiang-app.js?test=cleanup-${Date.now()}`);

test.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
});

const createApp = () => {
    const app = Object.create(WangxiangApp.prototype);
    app._syncTaskDataScope = () => false;
    app._saveManagedTasks = async () => {};
    app._saveTaskProgressHistory = async () => {};
    app._saveInventoryItems = async () => {};
    app._saveRemovedInventorySourceKeys = async () => {};
    app._saveCreditBalance = async () => {};
    return app;
};

test('completed task cleanup removes only its record and progress snapshots', async () => {
    const app = createApp();
    app.managedTasks = [
        { id: 'done-1', title: '已完成任务', status: 'completed', creditRewardGranted: true },
        { id: 'active-1', title: '进行中任务', status: 'active' }
    ];
    app.taskProgressHistory = [{
        tavernMessageIndex: 12,
        taskSnapshots: [{ taskId: 'done-1' }, { taskId: 'active-1' }]
    }];

    const removed = await app.removeCompletedTaskRecord('done-1');

    assert.equal(removed.title, '已完成任务');
    assert.deepEqual(app.managedTasks.map(item => item.id), ['active-1']);
    assert.deepEqual(app.taskProgressHistory[0].taskSnapshots, [{ taskId: 'active-1' }]);
});

test('active task cleanup must still use the abandon flow', async () => {
    const app = createApp();
    app.managedTasks = [{ id: 'active-1', status: 'active' }];
    app.taskProgressHistory = [];

    await assert.rejects(() => app.removeCompletedTaskRecord('active-1'), /放弃任务/);
    assert.equal(app.managedTasks.length, 1);
});

test('inventory cleanup removes the full name stack and prevents source reconciliation', async () => {
    const app = createApp();
    app.inventoryItems = [
        { id: 'item-1', sourceKey: 'task:1:0', name: '医疗包', quantity: 2 },
        { id: 'item-2', sourceKey: 'order:2', name: '医 疗 包', quantity: 3 },
        { id: 'item-3', sourceKey: 'order:3', name: '电池', quantity: 1 }
    ];
    app.removedInventorySourceKeys = [];

    const removed = await app.removeInventoryStack('item-1');

    assert.deepEqual(removed, { name: '医疗包', quantity: 5 });
    assert.deepEqual(app.inventoryItems.map(item => item.id), ['item-3']);
    assert.deepEqual(app.removedInventorySourceKeys.sort(), ['order:2', 'task:1:0']);
    assert.equal(app._addInventoryItem({ sourceKey: 'task:1:0', name: '医疗包' }), null);
});

test('credit cleanup resets the scoped balance', async () => {
    const app = createApp();
    app.creditBalance = 3500;

    const previousBalance = await app.clearCreditBalance();

    assert.equal(previousBalance, 3500);
    assert.equal(app.getCreditBalance(), 0);
});
