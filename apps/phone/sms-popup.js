/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

const popupQueue = [];
let activePopup = null;

function normalizePopupMessages(messages = []) {
    return (Array.isArray(messages) ? messages : [])
        .map((message, index) => ({
            id: String(message?.id || `phone_sms_popup_${Date.now()}_${index}`),
            sender: String(message?.sender || message?.from || '未知发件人').trim() || '未知发件人',
            text: String(message?.text || message?.content || '').trim(),
            time: String(message?.time || '').trim(),
            date: String(message?.date || '').trim()
        }))
        .filter(message => message.text);
}

function getSenderInitial(sender = '') {
    return Array.from(String(sender || '短').trim())[0] || '短';
}

function processPopupQueue() {
    if (activePopup || popupQueue.length === 0 || typeof document === 'undefined' || !document.body) return;

    const entry = popupQueue.shift();
    let pageIndex = 0;
    const root = document.createElement('div');
    root.id = 'phone-sms-popup-root';
    root.dataset.tavernFloor = entry.floor === null ? '' : String(entry.floor);
    root.innerHTML = `
        <section class="phone-sms-popup-dialog" role="dialog" aria-modal="true" aria-labelledby="phone-sms-popup-title">
            <header class="phone-sms-popup-header">
                <span class="phone-sms-popup-header-icon" aria-hidden="true"><i class="fa-regular fa-message"></i></span>
                <h2 id="phone-sms-popup-title">新短信</h2>
                <button class="phone-sms-popup-close" type="button" aria-label="关闭短信弹窗" title="关闭">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
            </header>
            <div class="phone-sms-popup-card" aria-live="polite">
                <div class="phone-sms-popup-sender-row">
                    <span class="phone-sms-popup-avatar" aria-hidden="true"></span>
                    <strong class="phone-sms-popup-sender"></strong>
                    <time class="phone-sms-popup-time"></time>
                </div>
                <div class="phone-sms-popup-body"></div>
            </div>
            <nav class="phone-sms-popup-pagination" aria-label="短信分页" hidden>
                <button class="phone-sms-popup-page-button phone-sms-popup-prev" type="button" aria-label="上一条短信" title="上一条">
                    <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                </button>
                <span class="phone-sms-popup-page-count" aria-live="polite"></span>
                <button class="phone-sms-popup-page-button phone-sms-popup-next" type="button" aria-label="下一条短信" title="下一条">
                    <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                </button>
            </nav>
        </section>`;

    const dialog = root.querySelector('.phone-sms-popup-dialog');
    const avatar = root.querySelector('.phone-sms-popup-avatar');
    const sender = root.querySelector('.phone-sms-popup-sender');
    const time = root.querySelector('.phone-sms-popup-time');
    const body = root.querySelector('.phone-sms-popup-body');
    const pagination = root.querySelector('.phone-sms-popup-pagination');
    const pageCount = root.querySelector('.phone-sms-popup-page-count');
    const previousButton = root.querySelector('.phone-sms-popup-prev');
    const nextButton = root.querySelector('.phone-sms-popup-next');
    const closeButton = root.querySelector('.phone-sms-popup-close');

    const renderPage = () => {
        const message = entry.messages[pageIndex];
        if (!message) return;
        avatar.textContent = getSenderInitial(message.sender);
        sender.textContent = message.sender;
        time.textContent = message.time || message.date || '';
        time.dateTime = [message.date, message.time].filter(Boolean).join(' ');
        body.textContent = message.text;

        const hasMultiplePages = entry.messages.length > 1;
        pagination.hidden = !hasMultiplePages;
        pageCount.textContent = `${pageIndex + 1} / ${entry.messages.length}`;
        previousButton.disabled = pageIndex === 0;
        nextButton.disabled = pageIndex === entry.messages.length - 1;
    };

    const close = () => {
        if (activePopup?.root !== root) return;
        document.removeEventListener('keydown', handleKeydown, true);
        root.remove();
        activePopup = null;
        entry.resolve(true);
        queueMicrotask(processPopupQueue);
    };

    const handleKeydown = event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        close();
    };

    previousButton?.addEventListener('click', () => {
        if (pageIndex <= 0) return;
        pageIndex -= 1;
        renderPage();
    });
    nextButton?.addEventListener('click', () => {
        if (pageIndex >= entry.messages.length - 1) return;
        pageIndex += 1;
        renderPage();
    });
    closeButton?.addEventListener('click', close, { once: true });
    root.addEventListener('wheel', event => event.stopPropagation(), { passive: true });
    root.addEventListener('touchmove', event => event.stopPropagation(), { passive: true });
    document.addEventListener('keydown', handleKeydown, true);

    document.getElementById('phone-sms-popup-root')?.remove();
    activePopup = { root, entry };
    document.body.appendChild(root);
    renderPage();
    closeButton?.focus?.();
    dialog?.scrollTo?.({ top: 0 });
}

export function showIncomingSmsPopup(messages = [], options = {}) {
    const normalizedMessages = normalizePopupMessages(messages);
    if (normalizedMessages.length === 0 || typeof document === 'undefined') return Promise.resolve(false);

    const floorValue = Number(options?.tavernMessageIndex);
    const floor = Number.isFinite(floorValue) ? floorValue : null;
    return new Promise(resolve => {
        popupQueue.push({ messages: normalizedMessages, floor, resolve });
        processPopupQueue();
    });
}
