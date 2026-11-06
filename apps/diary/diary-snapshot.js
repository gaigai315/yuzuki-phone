// 日记长图：把当前排版与图片内联到 SVG，再由浏览器绘制为 PNG。
// 只在内存中处理导出文件，不写入日记或插件存储。

export function getDiarySnapshotSize(width, height, preferredScale = 3) {
    if (![width, height, preferredScale].every(value => Number.isFinite(value) && value > 0)) {
        throw new Error('无法读取日记尺寸');
    }
    const scale = Math.min(preferredScale, 16384 / width, 16384 / height, Math.sqrt(12000000 / (width * height)));
    const pixelWidth = Math.max(1, Math.floor(width * scale));
    const pixelHeight = Math.max(1, Math.floor(height * scale));
    if (pixelWidth < Math.min(width, 160)) throw new Error('这篇日记过长，暂时无法生成清晰的单张长图');
    return { width: pixelWidth, height: pixelHeight };
}

const OMIT = '.diary-bujo-page-actions, .diary-page-status-safe, .diary-photo-actions, .diary-photo-back, [data-diary-export-ignore]';

function copyStyle(source, target, pseudo = null) {
    const computed = window.getComputedStyle(source, pseudo);
    for (const name of computed) target.style.setProperty(name, computed.getPropertyValue(name));
    target.style.setProperty('animation', 'none', 'important');
    target.style.setProperty('transition', 'none', 'important');
    target.style.setProperty('caret-color', 'transparent', 'important');
    return computed;
}

function appendPseudo(source, target, pseudo) {
    const computed = window.getComputedStyle(source, pseudo);
    const content = computed.content;
    if (!content || content === 'none' || content === 'normal' || computed.display === 'none') return;
    const span = document.createElement('span');
    copyStyle(source, span, pseudo);
    // 日记装饰使用空内容或引号包裹的文本（星星、分隔线、正文圆点）。
    span.textContent = content.replace(/^(["'])([\s\S]*)\1$/, '$2').replace(/\\([\da-f]{1,6})\s?/gi, (_, code) => String.fromCodePoint(parseInt(code, 16))).replace(/\\(["'\\])/g, '$1');
    span.style.removeProperty('content');
    if (pseudo === '::before') target.prepend(span);
    else target.appendChild(span);
}

function cloneStyledElement(source, fonts) {
    if (source.matches(OMIT) || /^(SCRIPT|STYLE|LINK|IFRAME|OBJECT)$/.test(source.tagName)) return null;
    const target = source.cloneNode(false);
    const computed = copyStyle(source, target);
    fonts.add(computed.fontFamily);
    for (const attr of Array.from(target.attributes)) {
        if (/^on/i.test(attr.name)) target.removeAttribute(attr.name);
    }
    for (const child of source.childNodes) {
        const clone = child.nodeType === Node.ELEMENT_NODE ? cloneStyledElement(child, fonts) : child.cloneNode(true);
        if (clone) target.appendChild(clone);
    }
    if (source instanceof HTMLElement && !['IMG', 'BR', 'INPUT'].includes(source.tagName)) {
        appendPseudo(source, target, '::before');
        appendPseudo(source, target, '::after');
    }
    if (source instanceof HTMLImageElement) {
        target.removeAttribute('srcset');
        target.removeAttribute('sizes');
        target.removeAttribute('loading');
        target.src = source.currentSrc || source.src;
    }
    if (source.matches('.diary-photo-front')) target.style.setProperty('opacity', '1', 'important');
    return target;
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('无法读取日记图片'));
        reader.readAsDataURL(blob);
    });
}

function createResourceLoader() {
    const cache = new Map();
    return url => {
        if (url.startsWith('data:') || url.startsWith('#')) return Promise.resolve(url);
        const absolute = new URL(url, document.baseURI).href;
        if (!cache.has(absolute)) cache.set(absolute, (async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            try {
                const response = await fetch(absolute, {
                    signal: controller.signal,
                    credentials: new URL(absolute).origin === location.origin ? 'include' : 'omit'
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return await blobToDataUrl(await response.blob());
            } catch {
                throw new Error('有图片或字体无法读取，请确认已加载完成；外链资源需允许跨域读取');
            } finally {
                clearTimeout(timeout);
            }
        })());
        return cache.get(absolute);
    };
}

async function embedCssUrls(css, loadResource, baseUrl = document.baseURI) {
    const matches = [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)];
    const replacements = await Promise.all(matches.map(async match => {
        const url = (match[1] ?? match[2] ?? match[3] ?? '').trim();
        if (!url || url.startsWith('#')) return match[0];
        return `url("${await loadResource(new URL(url, baseUrl).href)}")`;
    }));
    let index = 0;
    return css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, () => replacements[index++]);
}

async function embedFonts(fonts, loadResource) {
    const used = [...fonts].join(',').toLowerCase();
    const faces = [];
    const visit = (rules, baseUrl) => {
        for (const rule of rules) {
            if (rule.type === CSSRule.FONT_FACE_RULE) {
                const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim().toLowerCase();
                if (family && used.includes(family)) faces.push({ css: rule.cssText, baseUrl });
            } else if (rule.cssRules) visit(rule.cssRules, baseUrl);
        }
    };
    for (const sheet of document.styleSheets) {
        try { visit(sheet.cssRules, sheet.href || document.baseURI); } catch { /* 跨域样式表不可读时保留字体回退。 */ }
    }
    return (await Promise.all(faces.map(face => embedCssUrls(face.css, loadResource, face.baseUrl)))).join('\n');
}

async function loadSvgImage(svg) {
    const image = new Image();
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { image.src = ''; reject(new Error('日记长图绘制超时，请重试')); }, 20000);
        image.onload = () => { clearTimeout(timeout); resolve(); };
        image.onerror = () => { clearTimeout(timeout); reject(new Error('无法绘制日记长图')); };
        // foreignObject 使用内联 data URL，所有外部图片/字体已提前内联。
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    return image;
}

export async function captureDiarySnapshot(sourcePage) {
    if (!(sourcePage instanceof Element)) throw new Error('找不到当前日记页面');
    const sourceBody = sourcePage.querySelector('.diary-page-body');
    if (!sourceBody) throw new Error('找不到日记正文');
    await document.fonts?.ready;

    const width = Math.ceil(sourceBody.getBoundingClientRect().width);
    const height = Math.ceil(Math.max(sourceBody.scrollHeight, sourceBody.clientHeight));
    // 统一以三倍 CSS 分辨率导出，手机也保留足够的文字像素；超长日记仍受画布上限保护。
    const size = getDiarySnapshotSize(width, height);
    const fonts = new Set();
    const clone = cloneStyledElement(sourcePage, fonts);
    const body = clone.querySelector('.diary-page-body');
    for (const node of [clone, body]) {
        Object.assign(node.style, {
            position: 'relative', top: '0', left: '0', margin: '0',
            width: `${width}px`, height: `${height}px`, maxHeight: 'none', minHeight: '0',
            boxSizing: 'border-box', flex: 'none', overflow: 'hidden', transform: 'none'
        });
    }
    const background = clone.querySelector('.diary-page-bg');
    if (background) Object.assign(background.style, { width: '100%', height: '100%' });
    // 原页面可能停在中间；导出副本从正文第一行开始，原滚动位置保持不动。
    const loadResource = createResourceLoader();
    await Promise.all([clone, ...clone.querySelectorAll('*')].map(async element => {
        element.style.cssText = await embedCssUrls(element.style.cssText, loadResource);
        if (element instanceof HTMLImageElement) element.src = await loadResource(element.src);
    }));
    const fontCss = await embedFonts(fonts, loadResource);
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    const markup = new XMLSerializer().serializeToString(clone);
    const fontMarkup = new XMLSerializer().serializeToString(Object.assign(document.createElement('style'), { textContent: fontCss }));
    // SVG 本身使用最终像素尺寸，viewBox 保持原排版坐标，避免先按 CSS 像素栅格化再放大。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><foreignObject width="${width}" height="${height}">${fontMarkup}${markup}</foreignObject></svg>`;
    const image = await loadSvgImage(svg);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    try {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('当前浏览器无法生成日记长图');
        context.fillStyle = '#f5f2ee';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        const blob = await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('长图编码失败，请重试')), 'image/png'));
        return { blob, ...size };
    } finally {
        image.src = '';
        canvas.width = canvas.height = 0;
    }
}
