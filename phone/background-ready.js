// Keep a small decoded-image cache for WeChat page backgrounds.
const backgrounds = new Map();

export function prepareWechatBackground(view) {
    const root = view?.querySelector?.('.wechat-app');
    const match = root?.style?.backgroundImage?.match(/^url\(["']?([\s\S]*?)["']?\)$/);
    const src = match?.[1];
    if (!src || typeof globalThis.Image !== 'function') return null;
    const existing = backgrounds.get(src);
    if (existing) return existing.loaded ? null : existing.ready;

    const image = new Image();
    const entry = { image, loaded: false, ready: null };
    entry.ready = new Promise(resolve => {
        let settled = false;
        const finish = success => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            image.onload = image.onerror = null;
            entry.loaded = success;
            if (!success && backgrounds.get(src) === entry) backgrounds.delete(src);
            resolve();
        };
        const timer = setTimeout(() => finish(false), 5000);
        image.onload = async () => {
            if (typeof image.decode === 'function') {
                try { await image.decode(); } catch { /* Loaded image can still be painted. */ }
            }
            finish(true);
        };
        image.onerror = () => finish(false);
    });
    backgrounds.set(src, entry);
    if (backgrounds.size > 8) backgrounds.delete(backgrounds.keys().next().value);
    image.src = src;
    return entry.ready;
}
