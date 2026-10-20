import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../apps/wechat/wechat-app.js', import.meta.url), 'utf8');
const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const phoneShellSource = fs.readFileSync(new URL('../phone/phone-shell.js', import.meta.url), 'utf8');

test('wallet ledger resets to the latest month only when the page is entered again', () => {
    assert.match(source, /showWalletPage\(\{ resetMonth = false, section = null \} = \{\}\)/);
    assert.match(source, /#wechat-wallet-btn', \(\) => this\.showWalletPage\(\{ resetMonth: true, section: 'ledger' \}\)/);
    assert.match(source, /const latestMonth = monthKeys\[0\] \|\| fallbackMonth/);
    assert.match(source, /if \(resetMonth \|\| !monthKeys\.includes\(this\._walletLedgerMonth\)\)/);
    assert.match(source, /this\._walletLedgerMonth = String\(event\.currentTarget\.value \|\| ''\);\s*this\.showWalletPage\(\);/);
});

test('wallet page uses the overview, shortcuts, and ledger panel layout', () => {
    assert.match(source, /<div class="wechat-wallet-ledger-title">钱包<\/div>/);
    assert.match(source, /class="wechat-wallet-ledger-stat-label">零钱余额\(元\)</);
    assert.match(source, /class="wechat-wallet-ledger-stat-label">信用卡待还\(元\)</);
    assert.match(source, /class="wechat-wallet-ledger-stat-label">借贷待还\(元\)</);
    assert.match(source, /class="wechat-wallet-shortcuts"/);
    assert.match(source, /\.wechat-wallet-shortcuts \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
    assert.match(source, /class="wechat-wallet-shortcut-title">零钱<\/div>/);
    assert.match(source, /class="wechat-wallet-shortcut-title">银行卡<\/div>/);
    assert.match(source, /class="wechat-wallet-shortcut-title">信用卡<\/div>/);
    assert.match(source, /const shortcutBalanceClass = displayBalance\.length > 13 \? 'is-tight' : \(displayBalance\.length > 10 \? 'is-compact' : ''\)/);
    assert.match(source, /class="wechat-wallet-shortcut-value \$\{shortcutBalanceClass\}">¥\$\{displayBalance\}<\/div>/);
    assert.match(source, /\.wechat-wallet-shortcut-value \{[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?transform: translateY\(-7px\);[\s\S]*?text-align: center;[\s\S]*?white-space: nowrap;/);
    assert.doesNotMatch(source, /wechat-wallet-shortcut-copy/);
    assert.match(source, /wechat-wallet-shortcut-icon is-credit/);
    assert.doesNotMatch(source, /wechat-wallet-shortcut-subtitle/);
    assert.equal((source.match(/data-wallet-section="(?:ledger|bank|credit)"/g) || []).length, 3);
    assert.match(source, /<button class="wechat-wallet-shortcut-card[^>]*data-wallet-section="bank"/);
    assert.match(source, /<button class="wechat-wallet-shortcut-card[^>]*data-wallet-section="credit"/);
    assert.match(source, /querySelectorAll\('\[data-wallet-section\]'\)/);
    assert.equal((source.match(/id="ai-eval-wallet-btn"/g) || []).length, 1);
    assert.match(source, /<button class="wechat-wallet-eval-action" id="ai-eval-wallet-btn"[\s\S]*?<i class="fa-solid fa-gear"><\/i>[\s\S]*?<\/button>/);
    assert.match(source, /buttonEl\.innerHTML = '<i class="fa-solid fa-gear"><\/i>';/);
    assert.match(source, /class="wechat-wallet-ledger-heading"><i[^>]*><\/i><span>收支明细<\/span>/);
    assert.match(source, /const assetProfile = this\.wechatData\.getWalletAssetProfile\?\.\(\)/);
    assert.match(source, /const assetTotals = \{[\s\S]*?\.\.\.getWalletAssetTotals\(assetProfile\),[\s\S]*?creditDue:/);
    assert.match(source, /const bankCardCount = assetProfile\.savingsAccounts\.length/);
    assert.match(source, /const creditCardCount = assetProfile\.creditCards\.length/);
    assert.match(source, /_renderWalletSavingsPanel\(profile = \{\}, totals = \{\}\)/);
    assert.match(source, /储蓄账户 \(\$\{accounts\.length\}\)/);
    assert.match(source, /_renderWalletCreditPanel\(profile = \{\}, totals = \{\}, billingStatuses = \[\]\)/);
    assert.match(source, /信用卡账单 \(\$\{creditCards\.length\}\)/);
    assert.match(source, /借贷记录 \(\$\{debts\.length\}\)/);
    assert.match(source, /每一份收支，都是生活的可爱印记/);
});

test('wallet filters retain full native select hit areas inside the ledger header', () => {
    assert.match(source, /\.wechat-wallet-ledger-panel-header \{[\s\S]*?grid-template-columns: minmax\(80px, 1fr\) auto;/);
    assert.match(source, /\.wechat-wallet-ledger-filters \{[\s\S]*?position: relative !important;[\s\S]*?grid-template-columns: 96px 88px !important;[\s\S]*?width: 192px !important;/);
    assert.match(source, /\.wechat-wallet-ledger-filters::after \{[\s\S]*?left: 100px;[\s\S]*?top: 50%;[\s\S]*?height: 12px;[\s\S]*?transform: translateY\(-50%\);[\s\S]*?background: #e3e6e1;[\s\S]*?pointer-events: none;/);
    assert.match(source, /\.wechat-wallet-ledger-filter select \{[\s\S]*?position: absolute !important;[\s\S]*?inset: 0 !important;[\s\S]*?z-index: 2 !important;[\s\S]*?opacity: 0 !important;/);
    assert.match(source, /\.wechat-wallet-ledger-filter-label \{[\s\S]*?padding: 0 24px 0 2px;[\s\S]*?pointer-events: none;/);
    assert.match(source, /\['shopping', '线下支付'\]/);
    assert.match(source, /shopping: '线下支付'/);
    assert.match(indexSource, /ST_PHONE_WECHAT_MODULE_REVISION = '20261021-user-real-name'/);
});

test('credit-card bills are clickable and use the in-phone repayment flow', () => {
    assert.match(source, /data-wallet-credit-card-index="\$\{cardIndex\}"/);
    assert.match(source, /showWalletCreditRepaymentModal\(cardIndex\)/);
    assert.match(source, /\.wechat-wallet-repayment-header strong \{[\s\S]*?grid-column: 2;[\s\S]*?justify-self: center;[\s\S]*?white-space: nowrap;/);
    assert.match(source, /name="wechat-wallet-repayment-source"/);
    assert.match(source, /repayCreditCard\(\{/);
    assert.match(source, /status\.state === 'overdue'/);
    assert.match(source, /\['repayment', '信用卡还款'\]/);
    assert.match(indexSource, /checkWalletCreditRepayments\(latestTime\)/);
    assert.match(indexSource, /phone:timeUpdated/);
    assert.match(phoneShellSource, /'\.wechat-wallet-repayment-body'/);
});

test('wallet AI evaluation uses the tagged parser and persists the full asset profile', () => {
    assert.match(source, /const rawResponse = String\(result\.summary \?\? ''\)/);
    assert.match(source, /evaluation = parseWalletAssetEvaluation\(rawResponse\)/);
    assert.match(source, /applyWalletAssetEvaluation\(evaluation, \{[\s\S]*?resetTransactions: isWalletReset/);
    assert.match(source, /renderPromptForFeature\('wechat', 'walletEval', \{ user: userName \}\)/);
    assert.match(source, /微信零钱、储蓄账户、信用卡与其它负债/);
    assert.doesNotMatch(source, /const jsonMatch = result\.summary\.match/);
    assert.doesNotMatch(source, /JSON\.parse\(jsonMatch\[0\]\)/);
    assert.match(source, /showWalletResultModal\(evaluation\)/);
});

test('wallet parse failures show the complete AI response in a scrollable modal', () => {
    assert.match(source, /catch \(parseError\) \{[\s\S]*?showWalletParseFailureModal\(rawResponse, parseError\);[\s\S]*?return;/);
    assert.match(source, /showWalletParseFailureModal\(rawResponse, error\)/);
    assert.match(source, /模型原始回复（完整）/);
    assert.match(source, /<pre class="wechat-wallet-parse-error-response">\$\{safeResponse\}<\/pre>/);
    assert.match(source, /\.wechat-wallet-parse-error-body \{[\s\S]*?overflow-y: auto;[\s\S]*?touch-action: pan-y;[\s\S]*?overscroll-behavior: contain;/);
    assert.match(source, /\.wechat-wallet-parse-error-response \{[\s\S]*?overflow: auto;[\s\S]*?white-space: pre-wrap;[\s\S]*?touch-action: pan-y;[\s\S]*?overscroll-behavior: contain;/);
    assert.match(phoneShellSource, /'\.wechat-wallet-parse-error-body'/);
    assert.match(phoneShellSource, /'\.wechat-wallet-parse-error-response'/);
});
