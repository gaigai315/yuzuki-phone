import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../apps/wechat/wechat-app.js', import.meta.url), 'utf8');

test('wallet ledger resets to the latest month only when the page is entered again', () => {
    assert.match(source, /showWalletPage\(\{ resetMonth = false \} = \{\}\)/);
    assert.match(source, /#wechat-wallet-btn', \(\) => this\.showWalletPage\(\{ resetMonth: true \}\)/);
    assert.match(source, /const latestMonth = monthKeys\[0\] \|\| fallbackMonth/);
    assert.match(source, /if \(resetMonth \|\| !monthKeys\.includes\(this\._walletLedgerMonth\)\)/);
    assert.match(source, /this\._walletLedgerMonth = String\(event\.currentTarget\.value \|\| ''\);\s*this\.showWalletPage\(\);/);
});

test('wallet month chevron stays beside the selected month instead of the grid edge', () => {
    assert.match(source, /\.wechat-wallet-ledger-filter:first-child \{[\s\S]*?display: inline-flex !important;[\s\S]*?width: max-content !important;/);
    assert.match(source, /\.wechat-wallet-ledger-filter:first-child select \{[\s\S]*?width: auto !important;[\s\S]*?padding-right: 3px !important;/);
    assert.match(source, /\.wechat-wallet-ledger-filter:first-child i \{[\s\S]*?position: static;[\s\S]*?margin-left: 8px;[\s\S]*?transform: none;/);
});
