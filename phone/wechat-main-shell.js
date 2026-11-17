// 微信底部四页切换时复用壁纸、顶部和底部节点，避免移动端重建毛玻璃合成层。
function syncAttributes(current, next) {
    for (const attribute of Array.from(current.attributes)) {
        if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    }
    for (const attribute of Array.from(next.attributes)) {
        if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
    }
}

function syncChrome(current, next) {
    if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
        current.replaceWith(next.cloneNode(true));
        return;
    }
    if (current.nodeType !== 1) {
        if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
        return;
    }
    syncAttributes(current, next);
    const oldChildren = Array.from(current.childNodes);
    const newChildren = Array.from(next.childNodes);
    for (let index = 0; index < Math.max(oldChildren.length, newChildren.length); index++) {
        if (!newChildren[index]) oldChildren[index].remove();
        else if (!oldChildren[index]) current.appendChild(newChildren[index].cloneNode(true));
        else syncChrome(oldChildren[index], newChildren[index]);
    }
}

export function patchWechatMainShell(current, next) {
    const oldPage = current?.getAttribute('data-wechat-main-view');
    const newPage = next?.getAttribute('data-wechat-main-view');
    const pages = ['chats', 'contacts', 'discover', 'me'];
    if (!pages.includes(oldPage) || !pages.includes(newPage) || oldPage === newPage) return false;
    const parts = ['wechat-header', 'wechat-content', 'wechat-tabbar'];
    const oldParts = parts.map(name => Array.from(current.children).find(node => node.classList.contains(name)));
    const newParts = parts.map(name => Array.from(next.children).find(node => node.classList.contains(name)));
    if (current.children.length !== 3 || next.children.length !== 3 || [...oldParts, ...newParts].some(node => !node)) return false;
    syncAttributes(current, next);
    syncChrome(oldParts[0], newParts[0]);
    syncChrome(oldParts[2], newParts[2]);
    oldParts[1].replaceWith(newParts[1]);
    return true;
}
