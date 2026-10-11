/*
 * 微信资产评估标签解析与持久化数据规范。
 * 只接受 <初始资产评估> 标签，不兼容旧版 JSON 输出。
 */

const roundMoney = (value) => Math.round(Number(value) * 100) / 100;

const padWalletDatePart = (value, length = 2) => String(value).padStart(length, '0');

function getWalletDaysInMonth(year, month) {
    if (month === 2) {
        const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        return isLeapYear ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function walletDateToOrdinal(dateParts) {
    let year = Number(dateParts?.year);
    const month = Number(dateParts?.month);
    const day = Number(dateParts?.day);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;

    year -= month <= 2 ? 1 : 0;
    const era = Math.floor(year / 400);
    const yearOfEra = year - era * 400;
    const adjustedMonth = month + (month > 2 ? -3 : 9);
    const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1;
    const dayOfEra = yearOfEra * 365
        + Math.floor(yearOfEra / 4)
        - Math.floor(yearOfEra / 100)
        + dayOfYear;
    return era * 146097 + dayOfEra;
}

export function parseWalletStoryDate(storyTime = {}) {
    const candidates = [storyTime?.calendarDate, storyTime?.date, storyTime];
    for (const candidate of candidates) {
        const match = String(candidate || '').match(/(\d{1,6})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})/);
        if (!match) continue;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (!Number.isInteger(year) || year < 1 || !Number.isInteger(month) || month < 1 || month > 12) continue;
        if (!Number.isInteger(day) || day < 1 || day > getWalletDaysInMonth(year, month)) continue;
        return {
            year,
            month,
            day,
            dateKey: `${padWalletDatePart(year, 4)}-${padWalletDatePart(month)}-${padWalletDatePart(day)}`,
            monthKey: `${padWalletDatePart(year, 4)}-${padWalletDatePart(month)}`
        };
    }
    return null;
}

export function parseWalletRepaymentDay(value = '') {
    const text = String(value || '').trim();
    const match = text.match(/每月\s*(\d{1,2})\s*日/)
        || text.match(/^(?:还款日\s*[:：]?\s*)?(\d{1,2})\s*日?$/);
    if (!match) return null;
    const day = Number(match[1]);
    return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

function parseWalletMonthKey(monthKey = '') {
    const match = String(monthKey || '').match(/^(\d{1,6})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isInteger(year) || year < 1 || !Number.isInteger(month) || month < 1 || month > 12) return null;
    return { year, month };
}

export function addWalletMonths(monthKey, delta = 0) {
    const parsed = parseWalletMonthKey(monthKey);
    const safeDelta = Number.parseInt(delta, 10);
    if (!parsed || !Number.isFinite(safeDelta)) return '';
    const absoluteMonth = (parsed.year - 1) * 12 + (parsed.month - 1) + safeDelta;
    if (absoluteMonth < 0) return '';
    const year = Math.floor(absoluteMonth / 12) + 1;
    const month = absoluteMonth % 12 + 1;
    return `${padWalletDatePart(year, 4)}-${padWalletDatePart(month)}`;
}

function getWalletCycleDueDate(monthKey, repaymentDay) {
    const parsed = parseWalletMonthKey(monthKey);
    if (!parsed || !Number.isInteger(repaymentDay)) return null;
    const day = Math.min(repaymentDay, getWalletDaysInMonth(parsed.year, parsed.month));
    return {
        year: parsed.year,
        month: parsed.month,
        day,
        dateKey: `${padWalletDatePart(parsed.year, 4)}-${padWalletDatePart(parsed.month)}-${padWalletDatePart(day)}`,
        monthKey
    };
}

function normalizeWalletBillingState(state = {}) {
    if (!state || typeof state !== 'object') return null;
    const settledThrough = parseWalletMonthKey(state.settledThrough) ? String(state.settledThrough) : '';
    if (!settledThrough) return null;
    return {
        initializedDate: String(state.initializedDate || '').trim(),
        lastCheckedDate: String(state.lastCheckedDate || '').trim(),
        settledThrough,
        lastPaidCycle: String(state.lastPaidCycle || '').trim(),
        lastPaidAt: String(state.lastPaidAt || '').trim(),
        lastPaymentSource: String(state.lastPaymentSource || '').trim(),
        lastAutoAttemptDate: String(state.lastAutoAttemptDate || '').trim()
    };
}

export function createWalletCreditBillingState(card = {}, storyTime = {}) {
    const dateParts = parseWalletStoryDate(storyTime);
    const repaymentDay = parseWalletRepaymentDay(card?.repaymentDay);
    if (!dateParts) return null;

    const dueDate = repaymentDay ? getWalletCycleDueDate(dateParts.monthKey, repaymentDay) : null;
    const settledThrough = dueDate && dateParts.day < dueDate.day
        ? dateParts.monthKey
        : addWalletMonths(dateParts.monthKey, -1);
    if (!settledThrough) return null;
    return {
        initializedDate: dateParts.dateKey,
        lastCheckedDate: dateParts.dateKey,
        settledThrough,
        lastPaidCycle: '',
        lastPaidAt: '',
        lastPaymentSource: '',
        lastAutoAttemptDate: ''
    };
}

export function getWalletCreditBillingStatus(card = {}, storyTime = {}) {
    const amount = Math.max(0, roundMoney(Number(card?.currentDue) || 0));
    if (amount <= 0) {
        return {
            state: 'clear',
            label: '无欠款',
            amountDue: 0,
            overdueDays: 0,
            billingCycle: '',
            dueDate: ''
        };
    }

    const dateParts = parseWalletStoryDate(storyTime);
    const repaymentDay = parseWalletRepaymentDay(card?.repaymentDay);
    if (!dateParts || !repaymentDay) {
        return {
            state: 'pending',
            label: '待还款',
            amountDue: amount,
            overdueDays: 0,
            billingCycle: dateParts?.monthKey || '',
            dueDate: ''
        };
    }

    const billingState = normalizeWalletBillingState(card?.billingState)
        || createWalletCreditBillingState(card, storyTime);
    const billingCycle = addWalletMonths(billingState?.settledThrough || addWalletMonths(dateParts.monthKey, -1), 1);
    const dueDate = getWalletCycleDueDate(billingCycle, repaymentDay);
    const currentOrdinal = walletDateToOrdinal(dateParts);
    const dueOrdinal = walletDateToOrdinal(dueDate);
    if (!dueDate || currentOrdinal === null || dueOrdinal === null || currentOrdinal < dueOrdinal) {
        return {
            state: 'paid',
            label: '已还款',
            amountDue: 0,
            overdueDays: 0,
            billingCycle,
            dueDate: dueDate?.dateKey || ''
        };
    }
    if (currentOrdinal === dueOrdinal) {
        return {
            state: 'pending',
            label: '待还款',
            amountDue: amount,
            overdueDays: 0,
            billingCycle,
            dueDate: dueDate.dateKey
        };
    }

    const overdueDays = currentOrdinal - dueOrdinal;
    return {
        state: 'overdue',
        label: `逾期${overdueDays}天`,
        amountDue: amount,
        overdueDays,
        billingCycle,
        dueDate: dueDate.dateKey
    };
}

export function parseWalletMoney(value, { allowMissing = false } = {}) {
    const text = String(value ?? '')
        .replace(/[，,\s]/g, '')
        .replace(/[￥¥]/g, '')
        .trim();
    const match = text.match(/[+-]?\d+(?:\.\d+)?/);
    if (!match) {
        if (allowMissing) return null;
        throw new Error(`无法解析金额：${String(value ?? '').trim() || '空值'}`);
    }
    const amount = Number(match[0]);
    if (!Number.isFinite(amount)) {
        if (allowMissing) return null;
        throw new Error(`金额无效：${String(value ?? '').trim()}`);
    }
    return roundMoney(amount);
}

function cleanText(value = '') {
    return String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/^\s*[-*]\s*/, '')
        .replace(/^\[|\]$/g, '')
        .trim();
}

function splitTopLevel(value = '', separators = new Set([';', '；'])) {
    const parts = [];
    let buffer = '';
    let depth = 0;
    for (const character of String(value || '')) {
        if (character === '(' || character === '（') depth++;
        if (character === ')' || character === '）') depth = Math.max(0, depth - 1);
        if (depth === 0 && separators.has(character)) {
            if (buffer.trim()) parts.push(buffer.trim());
            buffer = '';
            continue;
        }
        buffer += character;
    }
    if (buffer.trim()) parts.push(buffer.trim());
    return parts;
}

function parseSavingsAccounts(section = '') {
    const accounts = [];
    const pattern = /^\s*-\s*(.+?)\s*[（(]\s*储蓄卡\s*尾号\s*([0-9A-Za-z]{4})\s*[)）]\s*[:：]\s*([￥¥]?\s*[+-]?[\d,]+(?:\.\d+)?)/gm;
    for (const match of section.matchAll(pattern)) {
        accounts.push({
            bankName: cleanText(match[1]),
            cardType: '储蓄卡',
            tailNumber: String(match[2] || '').toUpperCase(),
            balance: parseWalletMoney(match[3])
        });
    }
    return accounts;
}

function parseCreditCardPayload(payload = '') {
    const value = cleanText(payload);
    if (!value || /^无(?:信用卡)?$/i.test(value)) return null;
    const outerMatch = value.match(/^(.*?)\s*[（(]\s*((?:额度|总额度)\s*[:：][\s\S]+)[)）]\s*$/);
    if (!outerMatch) return null;

    let bankName = cleanText(outerMatch[1]);
    const tailMatch = bankName.match(/[（(]?\s*(?:信用卡\s*)?(?:尾号|\*{2,})\s*([0-9A-Za-z]{4})\s*[)）]?\s*$/i);
    const tailNumber = tailMatch?.[1] ? String(tailMatch[1]).toUpperCase() : '';
    if (tailMatch) bankName = cleanText(bankName.slice(0, tailMatch.index));

    const fields = {};
    splitTopLevel(outerMatch[2], new Set(['|', '｜'])).forEach((field) => {
        const separatorIndex = field.search(/[:：]/);
        if (separatorIndex < 0) return;
        const key = cleanText(field.slice(0, separatorIndex));
        const fieldValue = cleanText(field.slice(separatorIndex + 1));
        if (key) fields[key] = fieldValue;
    });

    const limitLabel = cleanText(fields['额度'] || fields['总额度'] || '');
    const dynamicLimit = /无预设|动态额度|∞|无限/i.test(limitLabel);
    const limit = dynamicLimit ? null : parseWalletMoney(limitLabel, { allowMissing: true });
    const currentDue = parseWalletMoney(fields['当前应还'] || fields['本期应还'] || 0, { allowMissing: true }) ?? 0;
    const repaymentDay = cleanText(fields['每月固定日'] || fields['还款日'] || '');
    const installmentStatus = cleanText(fields['分期状态'] || '未分期') || '未分期';

    if (!bankName) return null;
    return {
        bankName,
        tailNumber,
        limit,
        limitLabel: dynamicLimit ? (limitLabel || '无预设上限 (动态额度)') : '',
        currentDue,
        repaymentDay,
        installmentStatus
    };
}

function parseCreditCards(section = '') {
    const cards = [];
    const lines = String(section || '').split('\n');
    lines.forEach((line) => {
        const match = line.match(/^\s*-\s*信用卡\s*[:：]\s*(.+?)\s*$/);
        if (!match) return;
        splitTopLevel(match[1]).forEach((item) => {
            const card = parseCreditCardPayload(item);
            if (card) cards.push(card);
        });
    });
    return cards;
}

function parseDebtPayload(payload = '') {
    const value = cleanText(payload);
    if (!value || /^无(?:其它负债|借贷)?$/i.test(value)) return null;
    const amountMatch = value.match(/^(.*?)(?:[:：]\s*)?[￥¥]\s*([+-]?[\d,]+(?:\.\d+)?)([\s\S]*)$/);
    if (!amountMatch) return null;

    const name = cleanText(amountMatch[1]).replace(/[：:]$/, '').trim();
    const detail = cleanText(amountMatch[3]).replace(/^[（(]|[)）]$/g, '').trim();
    const installmentMatch = detail.match(/(?:分期剩余\s*)?(\d+)\s*\/\s*(\d+)\s*期|分期剩余\s*(\d+)\s*期/);
    const repaymentDayMatch = detail.match(/(?:还款日\s*[:：]?\s*)?(每月\s*\d{1,2}\s*日|\d{4}年\d{1,2}月\d{1,2}日)/);
    if (!name) return null;
    return {
        name,
        amount: parseWalletMoney(amountMatch[2]),
        detail,
        installmentStatus: installmentMatch
            ? (installmentMatch[1] && installmentMatch[2]
                ? `第${installmentMatch[1]}/${installmentMatch[2]}期`
                : `分期剩余${installmentMatch[3]}期`)
            : '',
        repaymentDay: cleanText(repaymentDayMatch?.[1] || '')
    };
}

function parseDebts(section = '') {
    const debts = [];
    String(section || '').split('\n').forEach((line) => {
        const match = line.match(/^\s*-\s*其它负债\/借贷\s*[:：]\s*(.+?)\s*$/);
        if (!match) return;
        splitTopLevel(match[1]).forEach((item) => {
            const debt = parseDebtPayload(item);
            if (debt) debts.push(debt);
        });
    });
    return debts;
}

export function normalizeWalletAssetProfile(profile = {}) {
    if (!profile || typeof profile !== 'object') return null;
    const walletBalance = parseWalletMoney(profile.walletBalance, { allowMissing: true });
    const savingsAccounts = (Array.isArray(profile.savingsAccounts) ? profile.savingsAccounts : [])
        .map((account) => {
            const bankName = cleanText(account?.bankName);
            const tailNumber = String(account?.tailNumber || '').trim().toUpperCase().slice(-4);
            const balance = parseWalletMoney(account?.balance, { allowMissing: true });
            if (!bankName || tailNumber.length !== 4 || balance === null) return null;
            return { bankName, cardType: '储蓄卡', tailNumber, balance };
        })
        .filter(Boolean)
        .slice(0, 3);
    const creditCards = (Array.isArray(profile.creditCards) ? profile.creditCards : [])
        .map((card) => {
            const bankName = cleanText(card?.bankName);
            if (!bankName) return null;
            const limitLabel = cleanText(card?.limitLabel);
            const limit = parseWalletMoney(card?.limit, { allowMissing: true });
            return {
                bankName,
                tailNumber: String(card?.tailNumber || '').trim().toUpperCase().slice(-4),
                limit,
                limitLabel,
                currentDue: parseWalletMoney(card?.currentDue, { allowMissing: true }) ?? 0,
                repaymentDay: cleanText(card?.repaymentDay),
                installmentStatus: cleanText(card?.installmentStatus) || '未分期',
                billingState: normalizeWalletBillingState(card?.billingState)
            };
        })
        .filter(Boolean);
    const debts = (Array.isArray(profile.debts) ? profile.debts : [])
        .map((debt) => {
            const name = cleanText(debt?.name);
            const amount = parseWalletMoney(debt?.amount, { allowMissing: true });
            if (!name || amount === null) return null;
            return {
                name,
                amount,
                detail: cleanText(debt?.detail),
                installmentStatus: cleanText(debt?.installmentStatus),
                repaymentDay: cleanText(debt?.repaymentDay)
            };
        })
        .filter(Boolean);

    return {
        reasoning: cleanText(profile.reasoning),
        walletBalance,
        savingsAccounts,
        creditCards,
        debts,
        evaluatedAt: Number(profile.evaluatedAt) || Date.now()
    };
}

export function getWalletAssetTotals(profile = {}) {
    const normalized = normalizeWalletAssetProfile(profile) || {
        savingsAccounts: [],
        creditCards: [],
        debts: []
    };
    return {
        savingsBalance: roundMoney(normalized.savingsAccounts.reduce((sum, account) => sum + account.balance, 0)),
        creditDue: roundMoney(normalized.creditCards.reduce((sum, card) => sum + card.currentDue, 0)),
        loanDue: roundMoney(normalized.debts.reduce((sum, debt) => sum + debt.amount, 0))
    };
}

export function parseWalletAssetEvaluation(rawText = '') {
    const source = String(rawText || '').replace(/\r\n?/g, '\n');
    const tagMatch = source.match(/<初始资产评估>([\s\S]*?)<\/初始资产评估>/);
    if (!tagMatch) throw new Error('AI 返回中缺少 <初始资产评估> 标签');
    const body = tagMatch[1].trim();

    const reasoningMatch = body.match(/评估理由\s*[:：]\s*([\s\S]*?)(?=\n\s*微信零钱\s*[:：])/);
    const balanceMatch = body.match(/微信零钱\s*[:：]\s*([￥¥]?\s*[+-]?[\d,]+(?:\.\d+)?)/);
    if (!reasoningMatch || !balanceMatch) throw new Error('资产评估标签缺少评估理由或微信零钱');

    const savingsMatch = body.match(/【储蓄账户】[^\n]*\n([\s\S]*?)(?=\n\s*【信用与负债】)/);
    const liabilityMatch = body.match(/【信用与负债】[^\n]*\n([\s\S]*)$/);
    if (!savingsMatch || !liabilityMatch) throw new Error('资产评估标签缺少储蓄账户或信用与负债区块');

    const savingsAccounts = parseSavingsAccounts(savingsMatch[1]);
    if (savingsAccounts.length === 0) throw new Error('资产评估中未解析到储蓄账户');

    const normalized = normalizeWalletAssetProfile({
        reasoning: reasoningMatch[1],
        walletBalance: parseWalletMoney(balanceMatch[1]),
        savingsAccounts,
        creditCards: parseCreditCards(liabilityMatch[1]),
        debts: parseDebts(liabilityMatch[1]),
        evaluatedAt: Date.now()
    });
    if (!normalized) throw new Error('资产评估数据无效');
    if (normalized.walletBalance < 0) throw new Error('微信零钱不能为负数');
    return normalized;
}
