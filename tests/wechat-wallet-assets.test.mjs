import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { WechatData } from '../apps/wechat/wechat-data.js';
import {
    createWalletCreditBillingState,
    getWalletAssetTotals,
    getWalletCreditBillingStatus,
    parseWalletAssetEvaluation
} from '../apps/wechat/wallet-assets.js';

class MemoryStorage {
    constructor(seed = {}) {
        this.values = new Map(Object.entries(seed));
    }

    get(key, fallback = null) {
        return this.values.has(key) ? this.values.get(key) : fallback;
    }

    set(key, value) {
        if (value === null || value === undefined) this.values.delete(key);
        else this.values.set(key, value);
    }
}

const createStorage = () => new MemoryStorage({
    wechat_data: JSON.stringify({
        userInfo: { name: '测试用户' },
        chats: [],
        contacts: [],
        moments: []
    })
});

const standardEvaluation = `<初始资产评估>
评估理由：工资刚到账就被房租和分期切走大半，余额精确得像在提醒他别再点外卖。
微信零钱：¥ 83.65

【储蓄账户】(根据人设列出 1~3 张)
- 东海商业银行 (储蓄卡 尾号6821)：¥ 10,123.68
- 盛京发展银行 (储蓄卡 尾号2046)：¥ 2,310.00

【信用与负债】
- 信用卡：招商银行 (信用卡 尾号5688) (额度: ¥20,000.00|每月固定日:每月10日|当前应还: ¥3,200.00|分期状态: 未分期)；建设银行 (信用卡 尾号8666) (额度: ¥10,000.00|每月固定日:每月28日|当前应还: ¥2,000.00|分期状态: 分期剩余3期)
- 其它负债/借贷：蚂蚁借呗：¥8,000.00（第6/12期；还款日 2025年07月20日）；京东金条：¥4,800.00（第3/12期；还款日 2025年07月30日）
</初始资产评估>`;

test('tagged wallet evaluation parses savings, credit cards, debts, and totals', () => {
    const profile = parseWalletAssetEvaluation(standardEvaluation);

    assert.equal(profile.walletBalance, 83.65);
    assert.equal(profile.savingsAccounts.length, 2);
    assert.deepEqual(profile.savingsAccounts[0], {
        bankName: '东海商业银行',
        cardType: '储蓄卡',
        tailNumber: '6821',
        balance: 10123.68
    });
    assert.equal(profile.creditCards.length, 2);
    assert.equal(profile.creditCards[0].bankName, '招商银行');
    assert.equal(profile.creditCards[0].tailNumber, '5688');
    assert.equal(profile.creditCards[1].installmentStatus, '分期剩余3期');
    assert.equal(profile.debts.length, 2);
    assert.equal(profile.debts[0].installmentStatus, '第6/12期');
    assert.equal(profile.debts[1].repaymentDay, '2025年07月30日');
    assert.deepEqual(getWalletAssetTotals(profile), {
        savingsBalance: 12433.68,
        creditDue: 5200,
        loanDue: 12800
    });
});

test('wallet evaluation accepts no credit card or debt', () => {
    const profile = parseWalletAssetEvaluation(`<初始资产评估>
评估理由：学生账户里只有奖学金尾款。
微信零钱：¥143.68
【储蓄账户】
- 绿洲联合银行 (储蓄卡 尾号1008)：¥2,431.27
【信用与负债】
- 信用卡：无
- 其它负债/借贷：无
</初始资产评估>`);

    assert.equal(profile.creditCards.length, 0);
    assert.equal(profile.debts.length, 0);
    assert.deepEqual(getWalletAssetTotals(profile), {
        savingsBalance: 2431.27,
        creditDue: 0,
        loanDue: 0
    });
});

test('wallet evaluation supports a dynamic-limit black card', () => {
    const profile = parseWalletAssetEvaluation(`<初始资产评估>
评估理由：资本家看完都得先确认这不是金融系统测试账号。
微信零钱：¥88,143.68
【储蓄账户】
- 环球联合银行 (储蓄卡 尾号0001)：¥9,876,543.21
【信用与负债】
- 信用卡：环球黑金卡 (信用卡 尾号0008) (额度: 无预设上限 (动态额度)|每月固定日:每月10日|当前应还: ¥143,820.50|分期状态: 未分期)
- 其它负债/借贷：无
</初始资产评估>`);

    assert.equal(profile.creditCards[0].limit, null);
    assert.equal(profile.creditCards[0].limitLabel, '无预设上限 (动态额度)');
    assert.equal(profile.creditCards[0].currentDue, 143820.5);
});

test('wallet evaluation rejects the old JSON format and negative WeChat balances', () => {
    assert.throws(
        () => parseWalletAssetEvaluation('{"reasoning":"旧格式","amount":52.5}'),
        /缺少 <初始资产评估> 标签/
    );
    assert.throws(
        () => parseWalletAssetEvaluation(`<初始资产评估>
评估理由：余额异常。
微信零钱：¥-1.00
【储蓄账户】
- 东海商业银行 (储蓄卡 尾号6821)：¥10.00
【信用与负债】
- 信用卡：无
- 其它负债/借贷：无
</初始资产评估>`),
        /微信零钱不能为负数/
    );
});

test('asset evaluation persists the full profile and re-evaluation clears ledger history', async () => {
    const storage = createStorage();
    const data = new WechatData(storage);
    const firstProfile = parseWalletAssetEvaluation(standardEvaluation);

    await data.applyWalletAssetEvaluation(firstProfile);
    data.updateWalletBalance(-3.65);
    data.data.walletTransactions.push({
        id: 'wallet-test-transaction',
        delta: -3.65,
        type: 'shopping',
        title: '测试支出',
        timestamp: Date.now()
    });
    assert.equal(data.getWalletBalance(), 80);
    assert.equal(data.getWalletAssetProfile().walletBalance, 80);
    assert.equal(data.getWalletTransactions().length, 1);

    const replacement = parseWalletAssetEvaluation(`<初始资产评估>
评估理由：重新核账后只剩工资卡。
微信零钱：¥90.25
【储蓄账户】
- 北境发展银行 (储蓄卡 尾号5566)：¥6,789.01
【信用与负债】
- 信用卡：无
- 其它负债/借贷：无
</初始资产评估>`);
    await data.applyWalletAssetEvaluation(replacement, { resetTransactions: true });

    assert.equal(data.getWalletBalance(), 90.25);
    assert.equal(data.getWalletTransactions().length, 0);
    assert.equal(data.getWalletAssetProfile().savingsAccounts[0].bankName, '北境发展银行');
    assert.equal(data.getWalletAssetProfile().creditCards.length, 0);

    const reloaded = new WechatData(storage);
    assert.equal(reloaded.getWalletBalance(), 90.25);
    assert.equal(reloaded.getWalletAssetProfile().savingsAccounts[0].tailNumber, '5566');
});

test('configured prompt uses the new tagged asset format only', () => {
    const promptSource = fs.readFileSync(new URL('../config/prompt-manager.js', import.meta.url), 'utf8');
    assert.match(promptSource, /极其严谨且嘴毒的资产评估 AI/);
    assert.match(promptSource, /<初始资产评估>/);
    assert.match(promptSource, /【储蓄账户】/);
    assert.match(promptSource, /【信用与负债】/);
    assert.match(promptSource, /无预设上限 \(动态额度\)/);
    assert.doesNotMatch(promptSource, /请严格以JSON格式输出/);
    assert.doesNotMatch(promptSource, /"amount": 52\.5/);
});

test('credit-card billing status follows the phone story date', () => {
    const card = {
        bankName: '盛京环球商业银行',
        currentDue: 1842913.36,
        repaymentDay: '每月10日'
    };
    const beforeState = createWalletCreditBillingState(card, { date: '2026年10月09日' });
    assert.equal(getWalletCreditBillingStatus({ ...card, billingState: beforeState }, { date: '2026年10月09日' }).label, '已还款');

    const dueState = createWalletCreditBillingState(card, { date: '2026年10月10日' });
    assert.deepEqual(
        getWalletCreditBillingStatus({ ...card, billingState: dueState }, { date: '2026年10月10日' }),
        {
            state: 'pending',
            label: '待还款',
            amountDue: 1842913.36,
            overdueDays: 0,
            billingCycle: '2026-10',
            dueDate: '2026-10-10'
        }
    );
    assert.equal(
        getWalletCreditBillingStatus({ ...card, billingState: dueState }, { date: '2026年10月13日' }).label,
        '逾期3天'
    );
});

async function createRepaymentData({
    storyDate = '2026年10月10日',
    walletBalance = 150,
    savingsBalances = [500],
    currentDue = 200
} = {}) {
    const data = new WechatData(createStorage());
    data._getStoryTimeFallback = () => ({
        date: storyDate,
        calendarDate: storyDate,
        time: '12:00',
        timestamp: 1
    });
    await data.applyWalletAssetEvaluation({
        reasoning: '测试账单',
        walletBalance,
        savingsAccounts: savingsBalances.map((balance, index) => ({
            bankName: `测试银行${index + 1}`,
            cardType: '储蓄卡',
            tailNumber: String(1000 + index),
            balance
        })),
        creditCards: [{
            bankName: '测试信用银行',
            tailNumber: '8899',
            limit: 10000,
            currentDue,
            repaymentDay: '每月10日',
            installmentStatus: '未分期'
        }],
        debts: []
    });
    return data;
}

test('manual credit-card repayment uses exactly one selected account and records the ledger', async () => {
    const data = await createRepaymentData();
    const storyTime = { date: '2026年10月10日', calendarDate: '2026年10月10日', time: '12:00' };

    const failed = await data.repayCreditCard({ cardIndex: 0, sourceId: 'wallet', storyTime });
    assert.equal(failed.success, false);
    assert.equal(failed.reason, 'insufficient_balance');
    assert.equal(data.getWalletBalance(), 150);
    assert.equal(data.getWalletAssetProfile().savingsAccounts[0].balance, 500);
    assert.equal(data.getWalletTransactions().length, 0);

    const paid = await data.repayCreditCard({ cardIndex: 0, sourceId: 'bank:0:1000', storyTime });
    assert.equal(paid.success, true);
    assert.equal(data.getWalletBalance(), 150);
    assert.equal(data.getWalletAssetProfile().savingsAccounts[0].balance, 300);
    assert.equal(data.getWalletCreditCardStatuses(storyTime)[0].label, '已还款');
    assert.equal(data.getWalletTransactions()[0].type, 'repayment');
    assert.equal(data.getWalletTransactions()[0].delta, -200);
    assert.equal(data.getWalletTransactions()[0].paymentSourceId, 'bank:0:1000');
});

test('chat payments can use wallet or savings accounts and always appear in the WeChat ledger', async () => {
    const data = await createRepaymentData({ walletBalance: 150, savingsBalances: [500] });

    const walletPayment = data.spendFromPaymentSource(25, 'wallet', null, {
        type: 'transfer',
        title: '转账-测试好友',
        detail: '晚餐',
        referenceId: 'test-wallet-payment'
    });
    const bankPayment = data.spendFromPaymentSource(80, 'bank:0:1000', null, {
        type: 'redpacket',
        title: '红包支出-测试好友',
        detail: '恭喜发财',
        referenceId: 'test-bank-payment'
    });

    assert.equal(walletPayment.success, true);
    assert.equal(bankPayment.success, true);
    assert.equal(data.getWalletBalance(), 125);
    assert.equal(data.getWalletAssetProfile().savingsAccounts[0].balance, 420);
    const transactions = data.getWalletTransactions();
    assert.equal(transactions.length, 2);
    const bankTransaction = transactions.find(record => record.referenceId === 'test-bank-payment');
    const walletTransaction = transactions.find(record => record.referenceId === 'test-wallet-payment');
    assert.equal(bankTransaction.balanceScope, 'savings');
    assert.equal(bankTransaction.paymentSourceId, 'bank:0:1000');
    assert.match(bankTransaction.detail, /测试银行1尾号1000/);
    assert.equal(walletTransaction.paymentSourceId, 'wallet');
    assert.match(walletTransaction.detail, /微信支付/);

    assert.equal(data._rollbackWalletTransactions(record => record.referenceId === 'test-bank-payment'), true);
    assert.equal(data.getWalletAssetProfile().savingsAccounts[0].balance, 500);
    assert.equal(data.getWalletTransactions().length, 1);
});

test('automatic repayment chooses one sufficient account after the due date is skipped', async () => {
    const data = await createRepaymentData({
        storyDate: '2026年10月10日',
        walletBalance: 80,
        savingsBalances: [150, 300],
        currentDue: 200
    });
    const results = await data.checkCreditCardAutoRepayments({
        date: '2026年10月11日',
        calendarDate: '2026年10月11日',
        time: '09:00'
    }, { randomFn: () => 0.5 });

    assert.equal(results.length, 1);
    assert.equal(results[0].success, true);
    assert.equal(results[0].source.id, 'bank:1:1001');
    assert.equal(data.getWalletBalance(), 80);
    assert.deepEqual(data.getWalletAssetProfile().savingsAccounts.map(account => account.balance), [150, 100]);
    assert.equal(data.getWalletTransactions()[0].automaticRepayment, true);
});

test('automatic repayment never combines insufficient accounts and leaves an overdue status', async () => {
    const data = await createRepaymentData({
        storyDate: '2026年10月10日',
        walletBalance: 80,
        savingsBalances: [120, 150],
        currentDue: 200
    });
    const storyTime = { date: '2026年10月12日', calendarDate: '2026年10月12日', time: '09:00' };
    const results = await data.checkCreditCardAutoRepayments(storyTime, { randomFn: () => 0 });

    assert.equal(results.length, 1);
    assert.equal(results[0].success, false);
    assert.equal(results[0].reason, 'no_sufficient_source');
    assert.equal(data.getWalletBalance(), 80);
    assert.deepEqual(data.getWalletAssetProfile().savingsAccounts.map(account => account.balance), [120, 150]);
    assert.equal(data.getWalletTransactions().length, 0);
    assert.equal(data.getWalletCreditCardStatuses(storyTime)[0].label, '逾期2天');
});

test('repayment rollback restores the source balance and credit-card billing state', async () => {
    const data = await createRepaymentData();
    const storyTime = { date: '2026年10月10日', calendarDate: '2026年10月10日', time: '12:00' };
    await data.repayCreditCard({ cardIndex: 0, sourceId: 'bank:0:1000', storyTime });

    assert.equal(data._rollbackWalletTransactions(record => record.timelineLinked === true), true);
    assert.equal(data.getWalletAssetProfile().savingsAccounts[0].balance, 500);
    assert.equal(data.getWalletCreditCardStatuses(storyTime)[0].label, '待还款');
    assert.equal(data.getWalletTransactions().length, 0);
});
