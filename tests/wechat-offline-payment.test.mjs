import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
    getOfflineWechatPaymentLedgerCopy,
    parseOfflineWechatPayments,
    renderOfflineWechatPaymentReceipt,
    replaceOfflineWechatPaymentTagsWithReceipts
} from '../apps/wechat/offline-payment.js';
import { WechatData } from '../apps/wechat/wechat-data.js';

const promptSource = fs.readFileSync(new URL('../config/prompt-manager.js', import.meta.url), 'utf8');
const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const phoneCssSource = fs.readFileSync(new URL('../phone.css', import.meta.url), 'utf8');
const receiptCssSource = phoneCssSource.slice(
    phoneCssSource.indexOf('/* 酒馆正文中的微信零钱线上支付小票。 */'),
    phoneCssSource.indexOf('/* 全局悬浮入口：')
);

test('offline payment parser accepts standard and repeated opening end tags', () => {
    const standard = parseOfflineWechatPayments(`<线上支付>
支付时间：2026年10月8日 14:30
午餐：20元
</线上支付>`);
    const repeated = parseOfflineWechatPayments(`<线上支付>
支付时间：2026年10月8日 14:31
商品名称：¥18.50
<线上支付>`);

    assert.equal(standard.length, 1);
    assert.equal(standard[0].amount, 20);
    assert.equal(standard[0].date, '2026年10月8日');
    assert.equal(standard[0].time, '14:30');
    assert.deepEqual(standard[0].items, [{ name: '午餐', amount: 20 }]);

    assert.equal(repeated.length, 1);
    assert.equal(repeated[0].amount, 18.5);
    assert.equal(repeated[0].items[0].name, '商品名称');
});

test('offline payment parser totals item lines and prefers an explicit total', () => {
    const [payment] = parseOfflineWechatPayments(`<线上支付>
支付时间：2026年10月8日 15:00
奶茶：12.50元
蛋糕：18元
合计：30元
</线上支付>`);

    assert.equal(payment.amount, 30);
    assert.deepEqual(payment.items, [
        { name: '奶茶', amount: 12.5 },
        { name: '蛋糕', amount: 18 }
    ]);
});

test('offline payment parser supports the prompt item-name and payment-amount fields', () => {
    const [payment] = parseOfflineWechatPayments(`<线上支付>
支付时间：2026年10月8日 16:20
商品名称：晚餐
支付金额：¥35.80
</线上支付>`);

    assert.equal(payment.amount, 35.8);
    assert.deepEqual(payment.items, [{ name: '晚餐', amount: 35.8 }]);
});

test('offline payment parser pairs multiple product blocks and totals their subtotals', () => {
    const [payment] = parseOfflineWechatPayments(`<线上支付>
支付时间：2035年07月19日11:16
---
商品名称：夏日生活用品（1份）
支付金额：¥168.80
---
商品名称：零食（2包）
支付金额：¥8.80
</线上支付>`);

    assert.equal(payment.amount, 177.6);
    assert.equal(payment.date, '2035年07月19日');
    assert.equal(payment.time, '11:16');
    assert.deepEqual(payment.items, [
        { name: '夏日生活用品', quantity: '1份', amount: 168.8 },
        { name: '零食', quantity: '2包', amount: 8.8 }
    ]);
});

test('offline payment receipt preserves multiple products when Markdown turns separators into headings', () => {
    const rendered = replaceOfflineWechatPaymentTagsWithReceipts(`<p>&lt;\u7ebf\u4e0a\u652f\u4ed8&gt;<br>
\u652f\u4ed8\u65f6\u95f4\uff1a2035\u5e7407\u670819\u65e511:16</p>
<h2>\u5546\u54c1\u540d\u79f0\uff1a\u51b0\u7f8e\u5f0f\u5496\u5561\uff081\u676f\uff09<br>
\u652f\u4ed8\u91d1\u989d\uff1a\u00a518.00</h2>
<p>\u5546\u54c1\u540d\u79f0\uff1a\u8349\u8393\u5976\u6cb9\u86cb\u7cd5\uff082\u5757\uff09<br>
\u652f\u4ed8\u91d1\u989d\uff1a\u00a556.00<br>
&lt;/\u7ebf\u4e0a\u652f\u4ed8&gt;</p>`);

    assert.equal((rendered.match(/class="st-phone-payment-receipt-item"/g) || []).length, 2);
    assert.match(rendered, /\u51b0\u7f8e\u5f0f\u5496\u5561/);
    assert.match(rendered, />1\u676f</);
    assert.match(rendered, /\u8349\u8393\u5976\u6cb9\u86cb\u7cd5/);
    assert.match(rendered, />2\u5757</);
    assert.match(rendered, /st-phone-payment-receipt-total-amount">\u00a5 74\.00/);
});

test('an unpaired item payment does not override the sum of parsed products', () => {
    const [payment] = parseOfflineWechatPayments(`<\u7ebf\u4e0a\u652f\u4ed8>
\u652f\u4ed8\u65f6\u95f4\uff1a2035\u5e7407\u670819\u65e511:16
\u5546\u54c1\u540d\u79f0\uff1a\u51b0\u7f8e\u5f0f\u5496\u5561\uff081\u676f\uff09
\u652f\u4ed8\u91d1\u989d\uff1a\u00a518.00
\u652f\u4ed8\u91d1\u989d\uff1a\u00a556.00
</\u7ebf\u4e0a\u652f\u4ed8>`);

    assert.equal(payment.amount, 18);
    assert.deepEqual(payment.items, [
        { name: '\u51b0\u7f8e\u5f0f\u5496\u5561', quantity: '1\u676f', amount: 18 }
    ]);
});

test('offline payment parser recovers date and time from tavern inline markup', () => {
    const source = `<线上支付>
<span>支付时间：</span><span class="theme-value">2035年07月19日</span><time>11:16</time>
商品名称：测试商品（1件）
支付金额：¥0.01
</线上支付>`;
    const [payment] = parseOfflineWechatPayments(source);
    const receipt = replaceOfflineWechatPaymentTagsWithReceipts(source);

    assert.equal(payment.date, '2035年07月19日');
    assert.equal(payment.time, '11:16');
    assert.match(receipt, /<strong>2035\.07\.19<\/strong>/);
    assert.match(receipt, /[A-Z]20350719001116/);
});

test('offline payment receipt recovers time split by theme blocks and invisible characters', () => {
    const source = `&lt;线上支付&gt;<br>
<span>支\u200b付时间：</span><div class="theme-date">2035年07月19日</div><time>11:16</time><br>
商品名称：测试商品（1件）<br>
支付金额：¥0.01<br>
&lt;/线上支付&gt;`;
    const receipt = replaceOfflineWechatPaymentTagsWithReceipts(source);

    assert.match(receipt, /<strong>2035\.07\.19<\/strong>/);
    assert.match(receipt, /[A-Z]20350719001116/);
    assert.doesNotMatch(receipt, /未提供|[A-Z]0{14}/);
});

test('offline payment tags render as an inline receipt for standard and legacy boundaries', () => {
    const standard = replaceOfflineWechatPaymentTagsWithReceipts(`<p>正文内容</p><p>&lt;线上支付&gt;<br>
支付时间：2026年10月8日 16:20<br>
商品名称：晚餐<br>
支付金额：¥35.80<br>
&lt;/线上支付&gt;</p>`);
    const legacy = replaceOfflineWechatPaymentTagsWithReceipts(`<线上支付>
支付时间：2026年10月8日 16:21
奶茶：12元
<线上支付>`);
    const browserSerialized = replaceOfflineWechatPaymentTagsWithReceipts(`&lt;线上支付&gt;
支付时间：2026年10月8日 16:22<br>
商品名称：咖啡<br>
支付金额：¥16.00<!--线上支付-->`);
    const tavernFormatted = replaceOfflineWechatPaymentTagsWithReceipts(`<p>&lt;线上支付&gt;
支付时间：2035年07月19日11:16
商品名称：夏日生活用品
支付金额：¥168.80
</p>`);

    assert.match(standard, /class="st-phone-payment-receipt"/);
    assert.match(standard, /sjxf4_xp\.png/);
    assert.match(standard, /2026\.10\.08/);
    assert.match(standard, /晚餐/);
    assert.match(standard, /¥ 35\.80/);
    assert.match(standard, />线上支付</);
    assert.match(standard, /[A-Z]20261008001620/);
    assert.doesNotMatch(standard, /&lt;\/?线上支付&gt;|<\/?线上支付>/);

    assert.match(legacy, /class="st-phone-payment-receipt"/);
    assert.match(legacy, /奶茶/);
    assert.doesNotMatch(legacy, /<\/?线上支付>/);
    assert.match(browserSerialized, /class="st-phone-payment-receipt"/);
    assert.match(browserSerialized, /咖啡/);
    assert.doesNotMatch(browserSerialized, /&lt;线上支付&gt;|<!--线上支付-->/);
    assert.match(tavernFormatted, /class="st-phone-payment-receipt"/);
    assert.match(tavernFormatted, /2035\.07\.19/);
    assert.match(tavernFormatted, /夏日生活用品/);
    assert.match(tavernFormatted, /¥ 168\.80/);
    assert.doesNotMatch(tavernFormatted, /&lt;线上支付&gt;/);
});

test('offline payment receipt escapes AI-provided fields and is idempotent', () => {
    const rendered = replaceOfflineWechatPaymentTagsWithReceipts(`<线上支付>
支付时间：2026年10月8日 17:00
商品名称：<img src=x onerror=evil()>
支付金额：¥9.90
</线上支付>`);
    const rerendered = replaceOfflineWechatPaymentTagsWithReceipts(rendered);

    assert.match(rendered, /&lt;img src=x onerror=evil\(\)&gt;/);
    assert.doesNotMatch(rendered, /<img src=x onerror=evil\(\)>/);
    assert.equal((rendered.match(/class="st-phone-payment-receipt"/g) || []).length, 1);
    assert.equal(rerendered, rendered);
});

test('offline payment receipt uses the fixed layout copy and scoped CSS', () => {
    const receipt = renderOfflineWechatPaymentReceipt({
        date: '2026年10月8日',
        items: [{ name: '咖啡', amount: 16 }],
        amount: 16
    });

    assert.match(receipt, /sjxf4_xp\.png/);
    assert.match(receipt, /data-phone-floating-style="silver"/);
    assert.match(receipt, /STORE\./);
    assert.match(receipt, />线上支付</);
    assert.match(receipt, /TOTAL\./);
    assert.match(receipt, /合计金额/);
    assert.match(receipt, /2026\.10\.08/);
    assert.match(receipt, /[A-Z]20261008000000/);
    assert.match(receipt, /class="st-phone-payment-receipt-barcode-area"/);
    assert.match(receipt, /♥ THANK YOU AGAIN ♥/);
    assert.equal((receipt.match(/class="st-phone-payment-receipt-decoration-star"/g) || []).length, 4);
    assert.match(receipt, /class="st-phone-payment-receipt-subtitle-copy">THANK YOU FOR YOUR PURCHASE/);
    assert.match(receipt, /class="st-phone-payment-receipt-thanks-copy">HAVE A NICE DAY!/);
    assert.doesNotMatch(receipt, /分类标签|CATEGORY/);
    assert.match(phoneCssSource, /\.mes_text \.st-phone-payment-receipt\s*\{/);
    assert.match(phoneCssSource, /\.mes_text \.st-phone-payment-receipt-brand-image\s*\{/);
    assert.match(phoneCssSource, /\.mes_text \.st-phone-payment-receipt-barcode\s*\{/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-barcode-area\s*\{[\s\S]*?align-items: flex-end;[\s\S]*?padding-left: 9px;/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-barcode-area::before\s*\{[\s\S]*?top: 0;[\s\S]*?bottom: 4px;[\s\S]*?background-repeat: repeat-y;/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-barcode-copy\s*\{/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-decoration-star\s*\{[\s\S]*?color: var\(--st-phone-payment-receipt-dot-color\);/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-thanks::before,[\s\S]*?\.st-phone-payment-receipt-thanks::after\s*\{[\s\S]*?background: var\(--st-phone-payment-receipt-shadow\);/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-brand::before/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-brand::after/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-footer::before/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-footer::after/);
    assert.match(phoneCssSource, /--st-phone-payment-receipt-notch-top-y/);
    assert.match(phoneCssSource, /--st-phone-payment-receipt-notch-bottom-y/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt::before\s*\{[\s\S]*?clip-path: polygon\(/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-brand::before,[\s\S]*?background: transparent;/);
    assert.match(phoneCssSource, /@import url\("https:\/\/fontsapi\.zeoseven\.com\/110\/main\/result\.css"\);/);
    assert.match(phoneCssSource, /font-family: "Yuzuki Receipt Pixel SC"/);
    assert.match(phoneCssSource, /fusion-pixel-10px-proportional-sc\.woff2/);
    assert.match(phoneCssSource, /\.mes_text \.st-phone-payment-receipt \* \{[\s\S]*?font-family: "点点像素体-方形", "Yuzuki Receipt Pixel SC"[\s\S]*?!important;[\s\S]*?font-synthesis: none !important;[\s\S]*?font-weight: 400 !important;/);
    assert.match(phoneCssSource, /\.mes_text \.st-phone-payment-receipt strong\s*\{[\s\S]*?margin: 0 !important;[\s\S]*?padding: 0 !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;[\s\S]*?color: inherit !important;[\s\S]*?font-weight: 400 !important;/);
    assert.doesNotMatch(phoneCssSource, /body[^\{]*\{[^\}]*font-family:\s*"Yuzuki Receipt Pixel SC"/);
    assert.match(phoneCssSource, /\.mes_text \.st-phone-payment-receipt\s*\{[\s\S]*?color: inherit;/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-subtitle,[\s\S]*?\.st-phone-payment-receipt-thanks\s*\{[\s\S]*?color: inherit;/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-table-head\s*\{[\s\S]*?color: inherit;/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-item\s*\{[\s\S]*?color: inherit;/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-total-amount\s*\{[\s\S]*?color: inherit;/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-order > strong\s*\{[\s\S]*?color: inherit;/);
    assert.match(phoneCssSource, /--st-phone-payment-receipt-shadow: var\(--SmartThemeShadowColor,/);
    assert.match(phoneCssSource, /--st-phone-payment-receipt-dot-pattern: radial-gradient\(circle, var\(--st-phone-payment-receipt-dot-color\) 0 1px, transparent 1\.15px\);/);
    assert.doesNotMatch(receiptCssSource, /border(?:-(?:top|right|bottom|left))?:\s*[^;]*(?:dashed|dotted)/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-table-head\s*\{[\s\S]*?background: var\(--st-phone-payment-receipt-shadow\);/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-total\s*\{[\s\S]*?background: var\(--st-phone-payment-receipt-shadow\);/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-barcode\s*\{[\s\S]*?border-right: 2px solid var\(--st-phone-payment-receipt-shadow\);[\s\S]*?border-left: 1px solid var\(--st-phone-payment-receipt-shadow\);[\s\S]*?repeating-linear-gradient\([\s\S]*?var\(--st-phone-payment-receipt-shadow\) 0 1px,/);
    assert.equal(fs.existsSync(new URL('../assets/fonts/fusion-pixel-10px-proportional-sc/fusion-pixel-10px-proportional-sc.woff2', import.meta.url)), true);
    assert.equal(fs.existsSync(new URL('../assets/fonts/fusion-pixel-10px-proportional-sc/OFL.txt', import.meta.url)), true);
    assert.match(phoneCssSource, /--st-phone-payment-receipt-inline-padding: 9px/);
    assert.match(phoneCssSource, /--st-phone-payment-receipt-inline-padding: 8px/);
    assert.match(phoneCssSource, /width: min\(100%, 205px\)/);
    assert.match(phoneCssSource, /width: min\(100%, 198px\)/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-footer\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?gap: 0;/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-meta\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?gap: 0;/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-barcode\s*\{[\s\S]*?width: 94%;[\s\S]*?height: 20px;/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-barcode-copy\s*\{[\s\S]*?width: 94%;/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-meta-cell \+ \.st-phone-payment-receipt-meta-cell\s*\{[\s\S]*?padding-left: 9px;/);
    assert.match(phoneCssSource, /-webkit-mask-image:[\s\S]*?radial-gradient\(circle at 9px 0, transparent 0 5px, #000 5\.5px\)[\s\S]*?radial-gradient\(circle at 9px 100%, transparent 0 5px, #000 5\.5px\)/);
    assert.match(phoneCssSource, /mask-composite: intersect;/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-edge\s*\{\s*display: none;/);
    assert.match(phoneCssSource, /clip-path: inset\(0 0 0 50%\)/);
    assert.match(phoneCssSource, /clip-path: inset\(0 50% 0 0\)/);
    assert.match(indexSource, /replaceOfflineWechatPaymentTagsWithReceipts\(html, receiptRenderOptions\)/);
    assert.match(indexSource, /addEventListener\('phone:floatingEntrySettingsChanged', hidePhoneTags\)/);
    assert.match(indexSource, /querySelectorAll\('\.st-phone-payment-receipt-brand-image'\)/);
    assert.match(indexSource, /function updatePaymentReceiptNotches\(receipt\)/);
    assert.match(indexSource, /new ResizeObserver\(entries =>/);
    assert.match(indexSource, /querySelectorAll\('\.st-phone-payment-receipt'\)\.forEach\(bindPaymentReceiptNotches\)/);
});

test('offline payment receipt renders parsed quantity units and multiple item rows', () => {
    const receipt = renderOfflineWechatPaymentReceipt({
        date: '2035年07月19日',
        items: [
            { name: '夏日生活用品', quantity: '1份', amount: 168.8 },
            { name: '零食', quantity: '2包', amount: 8.8 }
        ],
        amount: 177.6
    });

    assert.equal((receipt.match(/class="st-phone-payment-receipt-item"/g) || []).length, 2);
    assert.equal((receipt.match(/class="st-phone-payment-receipt-item-main"/g) || []).length, 2);
    assert.equal((receipt.match(/class="st-phone-payment-receipt-item-mark" aria-hidden="true">◆/g) || []).length, 2);
    assert.match(receipt, /夏日生活用品/);
    assert.match(receipt, />1份</);
    assert.match(receipt, /零食/);
    assert.match(receipt, />2包</);
    assert.match(receipt, /¥ 177\.60/);
    assert.match(receipt, /[A-Z]20350719000000/);
    assert.match(phoneCssSource, /--st-phone-payment-receipt-qty-column: 27px/);
    assert.match(phoneCssSource, /--st-phone-payment-receipt-price-column: 48px/);
    assert.match(phoneCssSource, /grid-template-columns: minmax\(0, 1fr\) var\(--st-phone-payment-receipt-qty-column\) var\(--st-phone-payment-receipt-price-column\)/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-item-main\s*\{[\s\S]*?display: flex;[\s\S]*?min-width: 0;/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-item-mark\s*\{[\s\S]*?color: var\(--st-phone-payment-receipt-shadow\);/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-item-dots\s*\{[\s\S]*?flex: 1 1 12px;[\s\S]*?background-image: var\(--st-phone-payment-receipt-dot-pattern\);[\s\S]*?background-repeat: repeat-x;/);
    assert.match(phoneCssSource, /\.st-phone-payment-receipt-item-qty\s*\{\s*text-align: center;/);
});

test('offline payment receipt accepts the floating style image selected by the user', () => {
    const options = {
        headerImageUrl: 'http://127.0.0.1:8000/extensions/yuzuki-phone/phone/sjxf8_xp.png',
        styleId: 'style-8'
    };
    const receipt = renderOfflineWechatPaymentReceipt({
        date: '2026年10月8日',
        items: [{ name: '咖啡', amount: 16 }],
        amount: 16
    }, options);
    const replaced = replaceOfflineWechatPaymentTagsWithReceipts(`<线上支付>
支付时间：2026年10月8日 18:00
商品名称：咖啡
支付金额：¥16.00
</线上支付>`, options);

    assert.match(receipt, /sjxf8_xp\.png/);
    assert.match(receipt, /data-phone-floating-style="style-8"/);
    assert.match(replaced, /sjxf8_xp\.png/);
    assert.match(replaced, /data-phone-floating-style="style-8"/);
});

test('offline payment ledger keeps the category title and shows product names only', () => {
    assert.deepEqual(getOfflineWechatPaymentLedgerCopy({
        items: [
            { name: '晚餐', amount: 35.8 },
            { name: '奶茶', amount: 12 }
        ],
        amount: 47.8
    }), {
        title: '线下消费',
        detail: '晚餐、奶茶'
    });

    assert.deepEqual(getOfflineWechatPaymentLedgerCopy({
        items: [{ name: '正文线上支付', amount: 108 }],
        amount: 108
    }), {
        title: '线下消费',
        detail: '未填写商品名称'
    });
});

test('offline payment wallet transaction is idempotent and rolls back with its floor', () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        VirtualPhone: {},
        dispatchEvent() {},
        CustomEvent: class {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        }
    };
    const data = Object.create(WechatData.prototype);
    data.walletDefaultKey = '__default__';
    data.data = {
        chats: [],
        messages: {},
        moments: [],
        walletByChat: { __default__: 100 },
        walletTransactions: []
    };
    data._messagesDirty = {};
    data._getStoryTimeFallback = () => ({ date: '2026年10月8日', time: '15:00', timestamp: 1 });
    data.saveData = () => {};
    data._cleanupManagedImagesForDeletedMessages = () => {};
    data._notifyUnreadChanged = () => {};

    try {
        const transaction = {
            type: 'shopping',
            referenceId: 'wechat_offline_payment:8:20:0',
            fromMainChatTag: true,
            tavernMessageIndex: 8
        };
        const first = data.spendWalletBalance(20, null, transaction);
        data.updateWalletBalance(-20, null, transaction);

        assert.equal(first.success, true);
        assert.equal(data.getWalletBalance(), 80);
        assert.equal(data.getWalletTransactions().length, 1);
        assert.equal(data.removeMainChatTagMessagesAtFloor(8), true);
        assert.equal(data.getWalletBalance(), 100);
        assert.equal(data.getWalletTransactions().length, 0);
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    }
});

test('both offline prompt presets expose nickname and wallet variables', () => {
    assert.equal((promptSource.match(/\{\{wechatUserName\}\}/g) || []).length, 2);
    assert.equal((promptSource.match(/\{\{wechatWalletBalance\}\}/g) || []).length, 2);
    assert.match(indexSource, /replace\(\/\\\{\\\{wechatUserName\\\}\\\}\/g, wechatUserName\)/);
    assert.match(indexSource, /replace\(\/\\\{\\\{wechatWalletBalance\\\}\\\}\/g, wechatWalletBalance\)/);
    assert.match(indexSource, /processWechatOfflinePaymentTags\(text, \{/);
    assert.match(indexSource, /type: 'shopping'/);
    assert.match(indexSource, /fromMainChatTag: true/);
    assert.match(indexSource, /duplicate\.detail !== ledgerCopy\.detail/);
    assert.match(indexSource, /duplicate\.detail = ledgerCopy\.detail/);
    assert.equal((promptSource.match(/支付时间：x年x月x日HH:mm/g) || []).length, 2);
    assert.equal((promptSource.match(/商品名称末尾必须用中文括号标明实际数量及单位/g) || []).length, 2);
    assert.equal((promptSource.match(/系统会自动合计扣款/g) || []).length, 2);
    assert.equal((promptSource.match(/商品名称：商品A（1份）\n支付金额：¥xx\.xx/g) || []).length, 2);
    assert.equal((promptSource.match(/商品名称：商品B（1个）\n支付金额：¥xx\.xx/g) || []).length, 2);
    assert.equal((promptSource.match(/不需要 Markdown 格式，也不要使用代码块包裹/g) || []).length, 2);
    assert.equal((promptSource.match(/付款人明确是\{\{user\}\}本人/g) || []).length, 2);
    assert.equal((promptSource.match(/其他角色、NPC 或任何非\{\{user\}\}对象支付时，一律不得输出<线上支付>标签/g) || []).length, 2);
    assert.equal((promptSource.match(/不得扣除\{\{user\}\}的微信零钱/g) || []).length, 2);
    assert.equal((promptSource.match(/<\/线上支付>/g) || []).length, 2);
});
