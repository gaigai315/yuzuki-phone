const PAYMENT_TAG_BOUNDARY_REGEX = /<\s*(\/?)\s*线上支付\s*>/gi;
const PAYMENT_HTML_TAG_BOUNDARY_REGEX = /(?:<\s*(\/?)\s*线上支付(?:\s[^>]*)?>|&lt;\s*(\/?)\s*线上支付\s*&gt;|＜\s*(\/?)\s*线上支付\s*＞|<!--\s*(\/?)\s*线上支付\s*-->)/gi;
const PAYMENT_TIME_LINE_REGEX = /^\s*支\s*付\s*时\s*间\s*[:：]\s*(.+?)\s*$/i;
const PAYMENT_ITEM_NAME_LINE_REGEX = /^\s*(?:商品名称|商品|项目)\s*[:：]\s*(.+?)\s*$/i;
const PAYMENT_ITEM_AMOUNT_LABEL_REGEX = /^支付金额$/;
const PAYMENT_TOTAL_LABEL_REGEX = /^(?:总金额|实付金额|合计|总计)$/;
const PAYMENT_LINE_REGEX = /^\s*(.+?)\s*[:：]\s*(?:人民币|RMB|CNY)?\s*[¥￥]?\s*(-?\d[\d,]*(?:\.\d{1,2})?)\s*(?:元)?\s*$/i;
const PAYMENT_AMOUNT_VALUE_REGEX = /^\s*(?:人民币|RMB|CNY)?\s*[¥￥]?\s*(-?\d[\d,]*(?:\.\d{1,2})?)\s*(?:元)?\s*$/i;
const DEFAULT_PAYMENT_RECEIPT_HEADER_IMAGE_URL = new URL('../../phone/sjxf4_xp.png', import.meta.url).href;
const DEFAULT_PAYMENT_RECEIPT_STYLE_ID = 'silver';

function maskReasoningBlocks(text) {
    let output = String(text || '');
    ['think', 'thinking', 'reasoning', 'analysis', 'reflection'].forEach((tag) => {
        const regex = new RegExp(`<\\s*${tag}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${tag}\\s*>`, 'gi');
        output = output.replace(regex, block => block.replace(/[^\r\n]/g, ' '));
    });
    return output;
}

function decodePaymentTagBoundaries(text) {
    return String(text || '')
        .replace(/&lt;\s*(\/?)\s*线上支付\s*&gt;/gi, '<$1线上支付>')
        .replace(/＜\s*(\/?)\s*线上支付\s*＞/gi, '<$1线上支付>');
}

function normalizePaymentBody(body) {
    return String(body || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<hr\b[^>]*>/gi, '\n')
        .replace(/<\/(?:p|div|li|section|article|blockquote|pre|h[1-6])\s*>/gi, '\n')
        .replace(/<(?:p|div|li|section|article|blockquote|pre|h[1-6])\b[^>]*>/gi, '\n')
        .replace(/<!--|-->/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\r\n/g, '\n')
        .trim();
}

function normalizePaymentLineForParsing(value) {
    return String(value || '')
        .replace(/<\/?(?:span|font|mark|strong|em|b|i|u|small|code|s|del|ins|a|time)\b[^>]*>/gi, '')
        .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
        .replace(/&colon;|&#58;|&#x0*3a;/gi, ':')
        .replace(/&#65306;|&#x0*ff1a;/gi, '：')
        .replace(/\u00a0/g, ' ')
        .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
        .trim();
}

function extractPaymentDateTimeFromBody(body) {
    const plainText = String(body || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|div|li|section|article|blockquote|pre|h[1-6])\s*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&lt;\s*\/?[^&<>]+?&gt;/gi, ' ')
        .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
        .replace(/&colon;|&#58;|&#x0*3a;/gi, ':')
        .replace(/&#65306;|&#x0*ff1a;/gi, '：')
        .replace(/\u00a0/g, ' ')
        .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
        .replace(/\r\n/g, '\n');
    const match = plainText.match(
        /支\s*付\s*时\s*间\s*[:：]\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*\d{1,2}\s*[:：]\s*\d{2})/i
    );
    return String(match?.[1] || '').trim();
}

function parsePaymentDateTime(value) {
    const raw = String(value || '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;\s*\/?[^&<>]+?&gt;/gi, '')
        .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
        .replace(/&colon;|&#58;|&#x0*3a;/gi, ':')
        .replace(/&#65306;|&#x0*ff1a;/gi, '：')
        .replace(/\u00a0/g, ' ')
        .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
        .trim();
    const match = raw.match(/((\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日)\s*(\d{1,2})\s*[:：]\s*(\d{2})(?:\s|$)/);
    return {
        raw,
        date: String(match?.[1] || '').replace(/\s+/g, ''),
        time: match ? `${match[5]}:${match[6]}` : ''
    };
}

function normalizePaymentAmount(value) {
    const amount = Number.parseFloat(String(value || '').replace(/,/g, ''));
    return Number.isFinite(amount) && amount > 0
        ? Math.round(amount * 100) / 100
        : null;
}

function parsePaymentItemName(value) {
    const rawName = String(value || '').trim();
    if (!rawName) return { name: '' };

    const quantityMatch = rawName.match(/^(.*?)\s*[（(]\s*(\d+(?:\.\d+)?\s*[^\s（）()]+)\s*[）)]\s*$/u);
    const name = String(quantityMatch?.[1] || rawName).trim();
    const quantity = String(quantityMatch?.[2] || '').replace(/\s+/g, '');
    return quantity ? { name, quantity } : { name };
}

function createPaymentItem(name, amount) {
    const parsedName = parsePaymentItemName(name);
    if (!parsedName.name || !Number.isFinite(amount) || amount <= 0) return null;
    return {
        ...parsedName,
        amount: Math.round(amount * 100) / 100
    };
}

function parsePaymentBlock(body, sourceIndex) {
    const normalizedBody = normalizePaymentBody(body);
    if (!normalizedBody) return null;

    let paymentTime = '';
    let pendingItemName = '';
    let explicitTotal = null;
    let fallbackAmount = null;
    const items = [];

    normalizedBody.split('\n').forEach((rawLine) => {
        const line = normalizePaymentLineForParsing(rawLine).replace(/^[-*•]\s*/, '');
        if (!line) return;

        const timeMatch = line.match(PAYMENT_TIME_LINE_REGEX);
        if (timeMatch) {
            paymentTime = String(timeMatch[1] || '').trim();
            return;
        }

        const itemNameMatch = line.match(PAYMENT_ITEM_NAME_LINE_REGEX);
        if (itemNameMatch) {
            const itemName = String(itemNameMatch[1] || '').trim();
            const amountOnlyMatch = itemName.match(PAYMENT_AMOUNT_VALUE_REGEX);
            if (amountOnlyMatch) {
                const amount = normalizePaymentAmount(amountOnlyMatch[1]);
                const item = createPaymentItem('商品名称', amount);
                if (item) items.push(item);
                pendingItemName = '';
                return;
            }
            pendingItemName = itemName;
            return;
        }

        const itemMatch = line.match(PAYMENT_LINE_REGEX);
        if (!itemMatch) return;
        const name = String(itemMatch[1] || '').trim();
        const amount = normalizePaymentAmount(itemMatch[2]);
        if (!name || amount === null) return;

        if (PAYMENT_ITEM_AMOUNT_LABEL_REGEX.test(name) && pendingItemName) {
            const item = createPaymentItem(pendingItemName, amount);
            if (item) items.push(item);
            pendingItemName = '';
            return;
        }

        if (PAYMENT_TOTAL_LABEL_REGEX.test(name)) {
            explicitTotal = amount;
            return;
        }

        if (PAYMENT_ITEM_AMOUNT_LABEL_REGEX.test(name)) {
            fallbackAmount = amount;
            return;
        }

        const item = createPaymentItem(name, amount);
        if (item) items.push(item);
    });

    if (!parsePaymentDateTime(paymentTime).date) {
        paymentTime = extractPaymentDateTimeFromBody(body) || paymentTime;
    }

    if (items.length === 0 && pendingItemName && fallbackAmount !== null) {
        const item = createPaymentItem(pendingItemName, fallbackAmount);
        if (item) items.push(item);
    }

    const itemTotal = items.reduce((sum, item) => sum + item.amount, 0);
    const amount = explicitTotal
        ?? (items.length > 0 ? Math.round(itemTotal * 100) / 100 : fallbackAmount);
    if (!Number.isFinite(amount) || amount <= 0) return null;

    const parsedDateTime = parsePaymentDateTime(paymentTime);
    return {
        sourceIndex,
        body: normalizedBody,
        paymentTime,
        ...parsedDateTime,
        items,
        amount
    };
}

function escapeReceiptHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatReceiptAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

function formatReceiptDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '未提供';
    const match = raw.match(/(\d{4})\s*(?:年|[.\/-])\s*(\d{1,2})\s*(?:月|[.\/-])\s*(\d{1,2})\s*(?:日)?/);
    if (!match) return raw;
    return `${match[1]}.${String(match[2]).padStart(2, '0')}.${String(match[3]).padStart(2, '0')}`;
}

function getReceiptItemName(value) {
    const name = String(value || '').trim();
    return name && !/^(?:商品名称|商品|项目|正文线上支付)$/.test(name)
        ? name
        : '未填写商品名称';
}

function getReceiptItemQuantity(value) {
    return String(value || '').trim() || '1';
}

function getReceiptOrderNumber(payment = {}) {
    const parsedDateTime = parsePaymentDateTime(
        payment.paymentTime || `${payment.date || ''}${payment.time || ''}`
    );
    const rawDateTime = parsedDateTime.raw || `${payment.date || ''}${payment.time || ''}`;
    const dateMatch = rawDateTime.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
        || String(payment.date || '').match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    const timeMatch = rawDateTime.match(/(\d{1,2})\s*[:：]\s*(\d{2})/)
        || String(payment.time || '').match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
    const year = String(dateMatch?.[1] || '0000').padStart(4, '0');
    const month = String(dateMatch?.[2] || '0').padStart(2, '0');
    const day = String(dateMatch?.[3] || '0').padStart(2, '0');
    const hour = String(timeMatch?.[1] || '0').padStart(2, '0');
    const minute = String(timeMatch?.[2] || '0').padStart(2, '0');
    const timestampPart = `${year}${month}${day}00${hour}${minute}`;
    const itemSeed = (Array.isArray(payment.items) ? payment.items : [])
        .map(item => `${item?.name || ''}|${item?.quantity || ''}|${item?.amount || ''}`)
        .join('|');
    const seed = `${timestampPart}|${itemSeed}|${payment.amount || ''}|${payment.sourceIndex || 0}`;
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    const prefix = String.fromCharCode(65 + ((hash >>> 0) % 26));
    return `${prefix}${timestampPart}`;
}

function normalizeReceiptRenderOptions(options = {}) {
    return {
        headerImageUrl: String(options?.headerImageUrl || '').trim() || DEFAULT_PAYMENT_RECEIPT_HEADER_IMAGE_URL,
        styleId: String(options?.styleId || '').trim() || DEFAULT_PAYMENT_RECEIPT_STYLE_ID
    };
}

export function renderOfflineWechatPaymentReceipt(payment = {}, options = {}) {
    const items = (Array.isArray(payment.items) && payment.items.length > 0)
        ? payment.items
        : [{ name: '未填写商品名称', amount: payment.amount }];
    const itemRows = items.map((item) => `
        <span class="st-phone-payment-receipt-item">
            <span class="st-phone-payment-receipt-item-main">
                <span class="st-phone-payment-receipt-item-mark" aria-hidden="true">◆</span>
                <span class="st-phone-payment-receipt-item-name">${escapeReceiptHtml(getReceiptItemName(item?.name))}</span>
                <span class="st-phone-payment-receipt-item-dots" aria-hidden="true"></span>
            </span>
            <span class="st-phone-payment-receipt-item-qty">${escapeReceiptHtml(getReceiptItemQuantity(item?.quantity))}</span>
            <span class="st-phone-payment-receipt-item-price">¥ ${formatReceiptAmount(item?.amount)}</span>
        </span>`).join('');
    const date = escapeReceiptHtml(formatReceiptDate(payment.date));
    const orderNumber = escapeReceiptHtml(getReceiptOrderNumber(payment));
    const renderOptions = normalizeReceiptRenderOptions(options);

    return `<span class="st-phone-payment-receipt" data-phone-floating-style="${escapeReceiptHtml(renderOptions.styleId)}" role="group" aria-label="线上支付小票">
        <span class="st-phone-payment-receipt-edge st-phone-payment-receipt-edge-top" aria-hidden="true"></span>
        <span class="st-phone-payment-receipt-brand">
            <img class="st-phone-payment-receipt-brand-image" src="${escapeReceiptHtml(renderOptions.headerImageUrl)}" alt="">
            <span class="st-phone-payment-receipt-subtitle">
                <span class="st-phone-payment-receipt-decoration-star" aria-hidden="true">✦</span>
                <span class="st-phone-payment-receipt-subtitle-copy">THANK YOU FOR YOUR PURCHASE</span>
                <span class="st-phone-payment-receipt-decoration-star" aria-hidden="true">✦</span>
            </span>
        </span>
        <span class="st-phone-payment-receipt-meta">
            <span class="st-phone-payment-receipt-meta-cell">
                <span class="st-phone-payment-receipt-label">DATE.</span>
                <strong>${date}</strong>
            </span>
            <span class="st-phone-payment-receipt-meta-cell st-phone-payment-receipt-store">
                <span>
                    <span class="st-phone-payment-receipt-label">STORE.</span>
                    <strong>线上支付</strong>
                </span>
                <span class="st-phone-payment-receipt-cloud" aria-hidden="true">☁</span>
            </span>
        </span>
        <span class="st-phone-payment-receipt-table-head">
            <span>ITEM</span><span>QTY</span><span>PRICE</span>
        </span>
        <span class="st-phone-payment-receipt-items">${itemRows}
        </span>
        <span class="st-phone-payment-receipt-total">
            <span><span class="st-phone-payment-receipt-label">TOTAL.</span><strong>合计金额</strong></span>
            <strong class="st-phone-payment-receipt-total-amount">¥ ${formatReceiptAmount(payment.amount)}</strong>
        </span>
        <span class="st-phone-payment-receipt-footer">
            <span class="st-phone-payment-receipt-order">
                <span class="st-phone-payment-receipt-label">ORDER NO.</span>
                <strong>${orderNumber}</strong>
            </span>
            <span class="st-phone-payment-receipt-barcode-area" aria-hidden="true">
                <span class="st-phone-payment-receipt-barcode"></span>
                <span class="st-phone-payment-receipt-barcode-copy">♥ THANK YOU AGAIN ♥</span>
            </span>
        </span>
        <span class="st-phone-payment-receipt-thanks">
            <span class="st-phone-payment-receipt-decoration-star" aria-hidden="true">✦</span>
            <span class="st-phone-payment-receipt-thanks-copy">HAVE A NICE DAY!</span>
            <span class="st-phone-payment-receipt-decoration-star" aria-hidden="true">✦</span>
        </span>
        <span class="st-phone-payment-receipt-edge st-phone-payment-receipt-edge-bottom" aria-hidden="true"></span>
    </span>`;
}

export function replaceOfflineWechatPaymentTagsWithReceipts(html = '', options = {}) {
    const source = String(html || '');
    if (!source || !/(?:线上支付|&lt;\s*线上支付|＜\s*线上支付)/i.test(source)) return source;

    const boundaries = [];
    PAYMENT_HTML_TAG_BOUNDARY_REGEX.lastIndex = 0;
    let match;
    while ((match = PAYMENT_HTML_TAG_BOUNDARY_REGEX.exec(source)) !== null) {
        boundaries.push({
            index: match.index,
            end: PAYMENT_HTML_TAG_BOUNDARY_REGEX.lastIndex,
            closing: match[0].startsWith('<!--') || Boolean(match[1] || match[2] || match[3] || match[4])
        });
    }

    const replacements = [];
    let opener = null;
    boundaries.forEach((boundary) => {
        if (!opener) {
            if (!boundary.closing) opener = boundary;
            return;
        }

        const payment = parsePaymentBlock(source.slice(opener.end, boundary.index), opener.index);
        if (payment) {
            replacements.push({
                start: opener.index,
                end: boundary.end,
                html: renderOfflineWechatPaymentReceipt(payment, options)
            });
        }
        opener = null;
    });

    // SillyTavern's Markdown renderer can discard an unknown closing tag and leave only
    // the escaped opening boundary. Payment blocks are protocol suffixes, so a complete
    // parsable body may safely use the end of the message as its implicit closing edge.
    if (opener) {
        const payment = parsePaymentBlock(source.slice(opener.end), opener.index);
        if (payment) {
            replacements.push({
                start: opener.index,
                end: source.length,
                html: renderOfflineWechatPaymentReceipt(payment, options)
            });
        }
    }

    if (replacements.length === 0) return source;
    return replacements.reduceRight((output, replacement) => (
        output.slice(0, replacement.start) + replacement.html + output.slice(replacement.end)
    ), source);
}

export function parseOfflineWechatPayments(rawText = '') {
    const source = decodePaymentTagBoundaries(maskReasoningBlocks(rawText));
    if (!source) return [];

    const boundaries = [];
    PAYMENT_TAG_BOUNDARY_REGEX.lastIndex = 0;
    let match;
    while ((match = PAYMENT_TAG_BOUNDARY_REGEX.exec(source)) !== null) {
        boundaries.push({
            index: match.index,
            end: PAYMENT_TAG_BOUNDARY_REGEX.lastIndex,
            closing: match[1] === '/'
        });
    }

    const payments = [];
    let opener = null;
    boundaries.forEach((boundary) => {
        if (!opener) {
            if (!boundary.closing) opener = boundary;
            return;
        }

        const payment = parsePaymentBlock(source.slice(opener.end, boundary.index), opener.index);
        if (payment) payments.push(payment);
        opener = null;
    });
    return payments;
}

export function getOfflineWechatPaymentLedgerCopy(payment = {}) {
    const itemNames = (Array.isArray(payment?.items) ? payment.items : [])
        .map(item => String(item?.name || '').trim())
        .filter(name => name && !/^(?:商品名称|商品|项目|正文线上支付)$/.test(name));

    return {
        title: '线下消费',
        detail: itemNames.join('、') || '未填写商品名称'
    };
}
