/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 * 
 * ⚠️ 版权声明 (Copyright Notice):
 * 1. 禁止商业化：本项目仅供交流学习，严禁任何形式的倒卖、盈利等商业行为。
 * 2. 禁止二改发布：严禁未经授权修改代码后作为独立项目二次发布或分发。
 * 3. 禁止抄袭：严禁盗用本项目的核心逻辑、UI设计与相关原代码。
 * 
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */
// ==========================================
// 图片上传管理 - 全部存酒馆服务端，彻底告别 localStorage 和 Base64
export class ImageUploadManager {
    constructor(storage) {
        this.storage = storage; // PhoneStorage 实例，存到酒馆 extensionSettings
        this.storageKey = 'phone_image_paths'; // 存储键名（只保存路径字符串，极小）
        this.oldLocalKey = 'st_virtual_phone_local_images'; // 旧版 localStorage 键名

        // 内存缓存（路径字符串，不再是 base64）
        this.cache = this._loadCache();

        // 自动迁移并清理旧数据
        this._migrateOldData();

        // 启动后异步自检：清理已失效的 /backgrounds/ 路径，避免控制台反复 404
        this._scheduleCleanupMissingManagedFiles();
    }

    async _buildRequestHeaders({ json = false } = {}) {
        const headers = typeof window.getRequestHeaders === 'function' ? window.getRequestHeaders() : {};
        delete headers['content-type'];
        delete headers['Content-Type'];
        if (json) {
            headers['Content-Type'] = 'application/json';
        }
        if (!headers['X-CSRF-Token'] && !headers['x-csrf-token']) {
            const csrfResp = await fetch('/csrf-token');
            if (csrfResp.ok) {
                const csrfJson = await csrfResp.json();
                if (csrfJson?.token) headers['X-CSRF-Token'] = csrfJson.token;
            }
        }
        return headers;
    }

    // ========================================
    // 🔧 加载缓存（从酒馆 extensionSettings 读取）
    // ========================================
    _loadCache() {
        try {
            // 优先从酒馆读取
            const saved = this.storage.get(this.storageKey);
            if (saved) {
                const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
                return {
                    wallpaper: parsed.wallpaper || null,
                    appIcons: parsed.appIcons || {},
                    avatars: parsed.avatars || {}
                };
            }
        } catch (e) {
            console.warn('[ImageUpload] 从酒馆加载图片路径失败:', e);
        }
        return { wallpaper: null, appIcons: {}, avatars: {} };
    }

    // ========================================
    // 🔄 迁移旧数据（localStorage → 服务端 + 酒馆）
    // ========================================
    async _migrateOldData() {
        // 1. 迁移旧版 extensionSettings 里的 phone_images（base64巨型数据）
        try {
            const oldExtData = this.storage.get('phone_images');
            if (oldExtData) {
                const parsed = typeof oldExtData === 'string' ? JSON.parse(oldExtData) : oldExtData;
                await this._migrateImageSet(parsed);
                this.storage.remove('phone_images');
                console.log('[ImageUpload] 旧版 extensionSettings 图片数据已迁移并清理');
            }
        } catch (e) { }

        // 2. 迁移旧版 localStorage 里的巨型 base64 数据
        try {
            const oldLocalData = localStorage.getItem(this.oldLocalKey);
            if (oldLocalData) {
                const parsed = JSON.parse(oldLocalData);
                await this._migrateImageSet(parsed);
                // 🔥 彻底删除 localStorage 里的巨型数据！
                localStorage.removeItem(this.oldLocalKey);
                console.log('[ImageUpload] 旧版 localStorage 图片数据已迁移并清理');
            }
        } catch (e) { }
    }

    // 迁移一组图片数据（把 base64 上传服务端，只保留路径）
    async _migrateImageSet(data) {
        if (!data) return;
        let changed = false;

        // 迁移壁纸
        if (data.wallpaper && data.wallpaper.startsWith('data:image')) {
            try {
                const url = await this._uploadToServer(data.wallpaper, 'wallpaper');
                if (url !== data.wallpaper) {
                    this.cache.wallpaper = url;
                    changed = true;
                }
            } catch (e) {
                console.warn('[ImageUpload] 迁移壁纸失败，已跳过该项:', e);
            }
        } else if (data.wallpaper && !this.cache.wallpaper) {
            this.cache.wallpaper = data.wallpaper;
            changed = true;
        }

        // 迁移APP图标
        if (data.appIcons) {
            for (const [appId, icon] of Object.entries(data.appIcons)) {
                if (icon && icon.startsWith('data:image')) {
                    try {
                        const url = await this._uploadToServer(icon, `icon_${appId}`);
                        if (url !== icon) {
                            this.cache.appIcons[appId] = url;
                            changed = true;
                        }
                    } catch (e) {
                        console.warn(`[ImageUpload] 迁移APP图标失败(${appId})，已跳过该项:`, e);
                    }
                } else if (icon && !this.cache.appIcons[appId]) {
                    this.cache.appIcons[appId] = icon;
                    changed = true;
                }
            }
        }

        // 迁移头像
        if (data.avatars) {
            for (const [charId, avatar] of Object.entries(data.avatars)) {
                if (avatar && avatar.startsWith('data:image')) {
                    try {
                        const url = await this._uploadToServer(avatar, `avatar_${charId}`);
                        if (url !== avatar) {
                            this.cache.avatars[charId] = url;
                            changed = true;
                        }
                    } catch (e) {
                        console.warn(`[ImageUpload] 迁移头像失败(${charId})，已跳过该项:`, e);
                    }
                } else if (avatar && !this.cache.avatars[charId]) {
                    this.cache.avatars[charId] = avatar;
                    changed = true;
                }
            }
        }

        if (changed) {
            await this._saveCache();
        }
    }

    // ========================================
    // 💾 保存缓存（存到酒馆 extensionSettings，只有路径，极小）
    // ========================================
    async _saveCache() {
        try {
            await this.storage.set(this.storageKey, JSON.stringify(this.cache));
            // 同步到全局 imageManager，避免设置页实例与主屏实例缓存分叉
            if (window.VirtualPhone?.imageManager && window.VirtualPhone.imageManager !== this) {
                window.VirtualPhone.imageManager.cache = JSON.parse(JSON.stringify(this.cache));
            }
        } catch (e) {
            console.error('[ImageUpload] 保存图片路径失败:', e);
        }
    }

    // 兼容旧接口
    async saveImages(images) {
        this.cache = images;
        await this._saveCache();
    }

    // ========================================
    // 🔥 上传图片到服务端 backgrounds 文件夹
    // ========================================
    async _uploadToServer(base64, prefix, options = {}) {
        const allowBase64Fallback = options.allowBase64Fallback === true;
        if (!base64 || !base64.startsWith('data:image')) return base64;
        try {
            const res = await fetch(base64);
            const blob = await res.blob();
            const ext = blob.type === 'image/png' ? 'png' : 'jpg';
            const filename = `phone_${prefix}_${Date.now()}.${ext}`;
            const formData = new FormData();
            formData.append('avatar', blob, filename);
            const headers = await this._buildRequestHeaders();

            const response = await fetch('/api/backgrounds/upload', { method: 'POST', body: formData, headers });
            if (response.ok) return `/backgrounds/${filename}`;

            let reason = '';
            try {
                reason = (await response.text() || '').trim();
            } catch (e) { }
            const message = reason
                ? `上传失败（HTTP ${response.status}）：${reason}`
                : `上传失败（HTTP ${response.status}）`;
            if (allowBase64Fallback) {
                console.warn('[ImageUpload] 上传失败，已回退为 base64:', message);
                return base64;
            }
            throw new Error(message);
        } catch (e) {
            console.error('[ImageUpload] 上传图片到服务端失败:', e);
            if (!allowBase64Fallback) {
                throw e instanceof Error ? e : new Error('上传失败');
            }
        }
        return base64;
    }

    // ========================================
    // 📤 上传接口
    // ========================================
    async uploadWallpaper(file) {
        return this.processImage(file, async (base64) => {
            await this.deleteManagedBackgroundByPath(this.cache.wallpaper, { quiet: true });
            const serverUrl = await this._uploadToServer(base64, 'wallpaper', { allowBase64Fallback: false });
            this.cache.wallpaper = serverUrl;
            await this._saveCache();
            return serverUrl;
        });
    }

    async uploadAppIcon(appId, file) {
        return this.processImage(file, async (base64) => {
            await this.deleteManagedBackgroundByPath(this.cache?.appIcons?.[appId], { quiet: true });
            const serverUrl = await this._uploadToServer(base64, `icon_${appId}`, { allowBase64Fallback: false });
            this.cache.appIcons[appId] = serverUrl;
            await this._saveCache();
            return serverUrl;
        });
    }

    async uploadAvatar(characterId, file) {
        return this.processImage(file, async (base64) => {
            await this.deleteManagedBackgroundByPath(this.cache?.avatars?.[characterId], { quiet: true });
            const serverUrl = await this._uploadToServer(base64, `avatar_${characterId}`, { allowBase64Fallback: false });
            this.cache.avatars[characterId] = serverUrl;
            await this._saveCache();
            return serverUrl;
        });
    }

    async processImage(file, callback) {
        return new Promise((resolve, reject) => {
            if (!file || !file.type.startsWith('image/')) {
                return reject(new Error('请选择图片文件'));
            }
            if (file.size > 5 * 1024 * 1024) {
                return reject(new Error('图片大小不能超过5MB'));
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = async () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    const maxSize = 800;
                    if (width > maxSize || height > maxSize) {
                        if (width > height) {
                            height = (height / width) * maxSize;
                            width = maxSize;
                        } else {
                            width = (width / height) * maxSize;
                            height = maxSize;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    const base64 = canvas.toDataURL('image/jpeg', 0.8);
                    resolve(await callback(base64));
                };
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('图片读取失败'));
            reader.readAsDataURL(file);
        });
    }

    // ========================================
    // 🗑️ 删除
    // ========================================
    async deleteWallpaper() {
        await this.deleteManagedBackgroundByPath(this.cache.wallpaper, { quiet: true });
        this.cache.wallpaper = null;
        await this._saveCache();
    }

    async deleteAppIcon(appId) {
        await this.deleteManagedBackgroundByPath(this.cache?.appIcons?.[appId], { quiet: true });
        delete this.cache.appIcons[appId];
        await this._saveCache();
    }

    async deleteAvatar(characterId) {
        await this.deleteManagedBackgroundByPath(this.cache?.avatars?.[characterId], { quiet: true });
        delete this.cache.avatars[characterId];
        await this._saveCache();
    }

    // ========================================
    // ♻️ 一键恢复默认APP图标 + 清理上传文件
    // ========================================
    _extractBackgroundFilename(pathLike) {
        const raw = String(pathLike || '').trim();
        if (!raw) return null;

        let pathname = raw;
        try {
            if (/^https?:\/\//i.test(raw)) {
                pathname = new URL(raw).pathname;
            }
        } catch (e) { }

        const match = pathname.match(/\/backgrounds\/([^/?#]+)/i);
        if (!match || !match[1]) return null;

        const filename = decodeURIComponent(match[1]);
        // 仅处理手机插件生成的文件，避免误删其他背景图
        if (!/^phone_[\w-]+\.(png|jpg|jpeg|webp|gif)$/i.test(filename)) return null;
        return filename;
    }

    async _deleteBackgroundFile(filename) {
        if (!filename) return false;

        let headers = { 'Content-Type': 'application/json' };
        try {
            headers = await this._buildRequestHeaders({ json: true });
        } catch (e) {
            // 忽略 header 构建失败，继续尝试最基础删除请求
        }
        const attempts = [
            () => fetch('/api/backgrounds/delete', {
                method: 'POST',
                headers,
                body: JSON.stringify({ bg: filename })
            }),
            () => fetch('/api/backgrounds/delete', {
                method: 'POST',
                headers,
                body: JSON.stringify({ filename })
            }),
            () => fetch('/api/backgrounds/delete', {
                method: 'POST',
                headers,
                body: JSON.stringify({ file: filename })
            }),
            () => fetch(`/api/backgrounds/delete?bg=${encodeURIComponent(filename)}`, {
                method: 'DELETE',
                headers
            })
        ];

        for (const request of attempts) {
            try {
                const resp = await request();
                if (resp?.ok) return true;
            } catch (e) { }
        }
        return false;
    }

    async deleteManagedBackgroundByPath(pathLike, options = {}) {
        const filename = this._extractBackgroundFilename(pathLike);
        if (!filename) {
            return { attempted: false, success: false, filename: null };
        }

        let success = false;
        try {
            success = await this._deleteBackgroundFile(filename);
        } catch (e) {
            success = false;
        }
        if (!success && options.quiet !== true) {
            console.warn('[ImageUpload] 删除旧文件失败:', filename);
        }

        return { attempted: true, success, filename };
    }

    async resetAppIconsAndCleanupUploads() {
        const iconMap = this.cache?.appIcons || {};
        const resetCount = Object.keys(iconMap).length;

        const filesToDelete = [...new Set(
            Object.values(iconMap)
                .map(path => this._extractBackgroundFilename(path))
                .filter(Boolean)
        )];

        let fileDeleteSuccess = 0;
        let fileDeleteFailed = 0;

        for (const filename of filesToDelete) {
            const ok = await this._deleteBackgroundFile(filename);
            if (ok) fileDeleteSuccess += 1;
            else fileDeleteFailed += 1;
        }

        this.cache.appIcons = {};
        await this._saveCache();

        return {
            resetCount,
            fileDeleteAttempted: filesToDelete.length,
            fileDeleteSuccess,
            fileDeleteFailed
        };
    }

    _isManagedBackgroundPath(pathLike) {
        const raw = String(pathLike || '').trim();
        if (!raw) return false;
        if (/^\/backgrounds\/[^?#]+/i.test(raw)) return true;
        if (/^https?:\/\/[^/]+\/backgrounds\/[^?#]+/i.test(raw)) return true;
        return false;
    }

    async _probeBackgroundPathReachable(pathLike) {
        const url = String(pathLike || '').trim();
        if (!this._isManagedBackgroundPath(url)) return true;

        // 先尝试 HEAD，部分环境不支持再降级 GET
        try {
            const headResp = await fetch(url, {
                method: 'HEAD',
                credentials: 'include',
                cache: 'no-store'
            });
            if (headResp.ok) return true;
            if (headResp.status !== 405 && headResp.status !== 501) return false;
        } catch (e) {
            // ignore and fallback to GET
        }

        try {
            const getResp = await fetch(url, {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store'
            });
            return !!getResp.ok;
        } catch (e) {
            return false;
        }
    }

    _scheduleCleanupMissingManagedFiles() {
        if (this._cleanupMissingScheduled) return;
        this._cleanupMissingScheduled = true;

        Promise.resolve()
            .then(() => this._cleanupMissingManagedFiles())
            .catch((e) => {
                console.warn('[ImageUpload] 清理失效背景路径失败:', e);
            })
            .finally(() => {
                this._cleanupMissingScheduled = false;
            });
    }

    async _cleanupMissingManagedFiles() {
        const iconMap = this.cache?.appIcons && typeof this.cache.appIcons === 'object'
            ? this.cache.appIcons
            : {};
        const avatarMap = this.cache?.avatars && typeof this.cache.avatars === 'object'
            ? this.cache.avatars
            : {};

        const toCheck = new Map();
        const wallpaper = String(this.cache?.wallpaper || '').trim();
        if (this._isManagedBackgroundPath(wallpaper)) toCheck.set(wallpaper, true);
        Object.values(iconMap).forEach((v) => {
            const raw = String(v || '').trim();
            if (this._isManagedBackgroundPath(raw)) toCheck.set(raw, true);
        });
        Object.values(avatarMap).forEach((v) => {
            const raw = String(v || '').trim();
            if (this._isManagedBackgroundPath(raw)) toCheck.set(raw, true);
        });

        if (toCheck.size === 0) return;

        const reachableMap = new Map();
        for (const path of toCheck.keys()) {
            reachableMap.set(path, await this._probeBackgroundPathReachable(path));
        }

        let changed = false;
        let wallpaperChanged = false;
        let iconChanged = false;

        if (wallpaper && reachableMap.get(wallpaper) === false) {
            this.cache.wallpaper = null;
            changed = true;
            wallpaperChanged = true;
            console.warn('[ImageUpload] 已清理失效壁纸路径:', wallpaper);
        }

        Object.keys(iconMap).forEach((appId) => {
            const path = String(iconMap[appId] || '').trim();
            if (path && reachableMap.get(path) === false) {
                delete this.cache.appIcons[appId];
                changed = true;
                iconChanged = true;
                console.warn(`[ImageUpload] 已清理失效APP图标路径(${appId}):`, path);
            }
        });

        Object.keys(avatarMap).forEach((charId) => {
            const path = String(avatarMap[charId] || '').trim();
            if (path && reachableMap.get(path) === false) {
                delete this.cache.avatars[charId];
                changed = true;
                console.warn(`[ImageUpload] 已清理失效头像路径(${charId}):`, path);
            }
        });

        if (!changed) return;

        await this._saveCache();

        if (wallpaperChanged) {
            window.dispatchEvent(new CustomEvent('phone:updateWallpaper', { detail: { wallpaper: null } }));
        }
        if (iconChanged) {
            window.dispatchEvent(new CustomEvent('phone:updateAppIcon'));
        }
    }

    // ========================================
    // 📖 读取
    // ========================================
    getWallpaper() { return this.cache.wallpaper; }
    getAppIcon(appId) { return this.cache.appIcons[appId]; }
    getAvatar(characterId) { return this.cache.avatars[characterId]; }
}
