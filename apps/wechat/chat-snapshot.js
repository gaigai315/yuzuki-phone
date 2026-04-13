/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  截图引擎核心 (防超时 + 免疫插件干扰版)
 * ======================================================== */

async function getHtml2Canvas() {
    if (typeof window.html2canvas === 'function') return window.html2canvas;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        script.onload = () => resolve(window.html2canvas);
        script.onerror = () => reject(new Error('无法加载截图引擎'));
        document.head.appendChild(script);
    });
}

export async function captureWechatChatSnapshot(sourceRoot, { longCapture = false } = {}) {
    if (!(sourceRoot instanceof Element)) throw new Error('无效的截图根节点');

    const html2canvas = await getHtml2Canvas();
    const sourceMessages = sourceRoot.querySelector('#chat-messages');
    if (!sourceMessages) throw new Error('找不到聊天消息容器');

    const ghostWrapper = document.createElement('div');
    ghostWrapper.style.cssText = `position: fixed; top: 0; left: 0; opacity: 0; pointer-events: none; z-index: -9999;`;
    document.body.appendChild(ghostWrapper);

    const cloneRoot = sourceRoot.cloneNode(true);
    const bgColor = window.getComputedStyle(sourceRoot).backgroundColor || '#ededed';
    
    cloneRoot.style.position = 'relative';
    cloneRoot.style.top = '0';
    cloneRoot.style.left = '0';
    cloneRoot.style.margin = '0';
    cloneRoot.style.width = sourceRoot.offsetWidth + 'px';
    cloneRoot.style.backgroundColor = bgColor;
    cloneRoot.style.borderRadius = '0';
    cloneRoot.style.boxShadow = 'none';

    const inputArea = cloneRoot.querySelector('.chat-input-area');
    if (inputArea) inputArea.remove();

    const btns = cloneRoot.querySelectorAll('.wechat-back-btn, .wechat-header-left > *, .wechat-header-right > *');
    btns.forEach(el => { el.style.opacity = '0'; });

    const cloneMessages = cloneRoot.querySelector('#chat-messages');
    if (cloneMessages) {
        if (longCapture) {
            cloneMessages.style.height = sourceMessages.scrollHeight + 'px';
            cloneMessages.style.maxHeight = 'none';
            cloneMessages.style.overflow = 'visible';
            cloneRoot.style.height = 'auto';
        } else {
            cloneMessages.style.height = sourceMessages.clientHeight + 'px';
            cloneMessages.style.overflow = 'hidden';
            cloneRoot.style.height = sourceRoot.clientHeight + 'px';
            
            const innerScrollWrapper = document.createElement('div');
            while (cloneMessages.firstChild) innerScrollWrapper.appendChild(cloneMessages.firstChild);
            innerScrollWrapper.style.transform = `translateY(-${sourceMessages.scrollTop}px)`;
            cloneMessages.appendChild(innerScrollWrapper);
        }
    }

    ghostWrapper.appendChild(cloneRoot);

    try {
        await new Promise(resolve => setTimeout(resolve, 300));

        const canvas = await html2canvas(cloneRoot, {
            scale: 2,               
            useCORS: true,          
            allowTaint: true,       
            backgroundColor: bgColor,
            width: cloneRoot.offsetWidth,
            height: cloneRoot.offsetHeight,
            x: 0, y: 0, scrollX: 0, scrollY: 0,
            logging: false,
            // 🔥 核心防御1：资源加载超过 3 秒直接跳过，绝不死等！
            imageTimeout: 3000, 
            // 🔥 核心防御2：屏蔽其他酒馆插件的注入代码，防止报错崩溃！
            ignoreElements: (node) => {
                return node.tagName === 'SCRIPT' || node.tagName === 'IFRAME';
            }
        });

        return canvas.toDataURL('image/png');
    } finally {
        if (ghostWrapper && ghostWrapper.parentNode) ghostWrapper.parentNode.removeChild(ghostWrapper);
    }
}