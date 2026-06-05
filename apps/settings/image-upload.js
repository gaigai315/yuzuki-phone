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
        this.albumDeletedKey = 'phone_album_deleted_paths';

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

    _getBlobExtension(blob) {
        const mime = String(blob?.type || '').toLowerCase();
        if (mime.includes('png')) return 'png';
        if (mime.includes('webp')) return 'webp';
        if (mime.includes('gif')) return 'gif';
        if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
        if (mime.includes('mp4')) return 'mp4';
        if (mime.includes('webm')) return 'webm';
        return 'jpg';
    }

    _sanitizeFilenamePrefix(prefix) {
        return String(prefix || 'image')
            .trim()
            .replace(/[^\w-]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 64) || 'image';
    }

    async _hashBlob(blob) {
        if (!blob) return String(Date.now());
        const buffer = await blob.arrayBuffer();
        try {
            if (window.crypto?.subtle) {
                const digest = await window.crypto.subtle.digest('SHA-256', buffer);
                return Array.from(new Uint8Array(digest))
                    .map(byte => byte.toString(16).padStart(2, '0'))
                    .join('')
                    .slice(0, 16);
            }
        } catch (e) { }

        let hash = 2166136261;
        const bytes = new Uint8Array(buffer);
        for (const byte of bytes) {
            hash ^= byte;
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    async _buildManagedFilename(blob, prefix) {
        const safePrefix = this._sanitizeFilenamePrefix(prefix);
        const hash = await this._hashBlob(blob);
        const ext = this._getBlobExtension(blob);
        return `phone_${safePrefix}_${hash}.${ext}`;
    }

    async _backgroundExists(pathLike) {
        const url = String(pathLike || '').trim();
        if (!url) return false;
        try {
            const headResp = await fetch(url, {
                method: 'HEAD',
                credentials: 'include',
                cache: 'no-store'
            });
            if (headResp.ok) return true;
            if (headResp.status !== 405 && headResp.status !== 501) return false;
        } catch (e) { }

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

    async uploadBlob(blob, prefix, options = {}) {
        if (!blob || !/^(image|video)\//i.test(String(blob.type || ''))) {
            throw new Error('请选择图片或视频文件');
        }

        const filename = options.filename || await this._buildManagedFilename(blob, prefix);
        const finalUrl = `/backgrounds/${filename}`;
        if (await this._backgroundExists(finalUrl)) {
            await this._unmarkAlbumDeletedPath(finalUrl);
            await this._recordUploadedBackground(finalUrl, prefix);
            return finalUrl;
        }

        const formData = new FormData();
        formData.append('avatar', blob, filename);
        const headers = await this._buildRequestHeaders();
        const response = await fetch('/api/backgrounds/upload', {
            method: 'POST',
            body: formData,
            headers,
            credentials: options.credentials || 'include'
        });
        if (response.ok) {
            await this._recordUploadedBackground(finalUrl, prefix);
            return finalUrl;
        }

        let reason = '';
        try {
            reason = (await response.text() || '').trim();
        } catch (e) { }
        throw new Error(reason ? `上传失败（HTTP ${response.status}）：${reason}` : `上传失败（HTTP ${response.status}）`);
    }

    async uploadDataUrl(dataUrl, prefix, options = {}) {
        if (!dataUrl || !String(dataUrl).startsWith('data:image')) return dataUrl;
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        return this.uploadBlob(blob, prefix, options);
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

    async _recordUploadedBackground(pathLike, prefix = '') {
        const path = this._normalizeBackgroundPath(pathLike);
        if (!path || !/^\/backgrounds\/phone_[^?#]+/i.test(path)) return;

        try {
            await this._unmarkAlbumDeletedPath(path);
            const raw = this.storage.get('phone_album_upload_index', '[]');
            const list = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
            const normalizedList = Array.isArray(list) ? list : [];
            const nextItem = {
                path,
                prefix: String(prefix || ''),
                createdAt: Date.now()
            };
            const next = [
                nextItem,
                ...normalizedList.filter(item => this._normalizeBackgroundPath(item?.path || item) !== path)
            ].slice(0, 1000);
            await this.storage.set('phone_album_upload_index', JSON.stringify(next));
        } catch (e) {
            console.warn('[ImageUpload] 记录相册上传索引失败:', e);
        }
    }

    _readAlbumDeletedSet() {
        try {
            const raw = this.storage.get(this.albumDeletedKey, '[]');
            const list = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
            return new Set((Array.isArray(list) ? list : [])
                .map(item => this._normalizeBackgroundPath(item))
                .filter(Boolean));
        } catch (e) {
            return new Set();
        }
    }

    async _markAlbumDeletedPath(pathLike) {
        const path = this._normalizeBackgroundPath(pathLike);
        if (!path || !/^\/backgrounds\/phone_[^?#]+/i.test(path)) return;
        const deleted = this._readAlbumDeletedSet();
        deleted.add(path);
        await this.storage.set(this.albumDeletedKey, JSON.stringify(Array.from(deleted).slice(-500)));
    }

    async _unmarkAlbumDeletedPath(pathLike) {
        const path = this._normalizeBackgroundPath(pathLike);
        if (!path) return;
        const deleted = this._readAlbumDeletedSet();
        if (!deleted.delete(path)) return;
        await this.storage.set(this.albumDeletedKey, JSON.stringify(Array.from(deleted).slice(-500)));
    }

    async _removeAlbumUploadIndexPath(pathLike) {
        const target = this._normalizeBackgroundPath(pathLike);
        if (!target) return;
        try {
            const raw = this.storage.get('phone_album_upload_index', '[]');
            const list = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
            if (!Array.isArray(list)) return;
            const next = list.filter(item => this._normalizeBackgroundPath(item?.path || item) !== target);
            if (next.length === list.length) return;
            await this.storage.set('phone_album_upload_index', JSON.stringify(next));
        } catch (e) {
            console.warn('[ImageUpload] 清理相册上传索引失败:', e);
        }
    }

    async markManagedBackgroundDeleted(pathLike) {
        await this._markAlbumDeletedPath(pathLike);
        await this._removeAlbumUploadIndexPath(pathLike);
        window.dispatchEvent(new CustomEvent('phone:albumImageDeleted', {
            detail: { path: this._normalizeBackgroundPath(pathLike) }
        }));
    }

    // ========================================
    // 🔥 上传图片到服务端 backgrounds 文件夹
    // ========================================
    async _uploadToServer(base64, prefix, options = {}) {
        const allowBase64Fallback = options.allowBase64Fallback === true;
        if (!base64 || !base64.startsWith('data:image')) return base64;
        try {
            return await this.uploadDataUrl(base64, prefix);
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
            await this.deleteManagedBackgroundByPath(this.cache?.avatars?.[characterId], { quiet: true, skipIfReferenced: true });
            const serverUrl = await this._uploadToServer(base64, `avatar_${characterId}`, { allowBase64Fallback: false });
            this.cache.avatars[characterId] = serverUrl;
            await this._saveCache();
            return serverUrl;
        });
    }

    async processImage(file, callback) {
        return new Promise((resolve, reject) => {
            const fileName = String(file?.name || '').trim();
            const fileType = String(file?.type || '').trim().toLowerCase();
            const isLikelyImage = !!file && (fileType.startsWith('image/') || (!fileType && /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic|heif)$/i.test(fileName)));
            if (!isLikelyImage) {
                return reject(new Error('请选择图片文件'));
            }
            if (/(?:heic|heif)$/i.test(fileName) || /heic|heif/i.test(fileType)) {
                return reject(new Error('当前浏览器通常无法直接读取 HEIC/HEIF 图片，请先在相册中导出或转换为 JPG/PNG 后再上传'));
            }
            const maxFileSize = 20 * 1024 * 1024;
            if (file.size > maxFileSize) {
                return reject(new Error('图片大小不能超过20MB'));
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

        if (options.skipIfReferenced === true && this._countManagedBackgroundReferences(pathLike) > 0) {
            return { attempted: false, success: false, filename, skipped: 'referenced' };
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
        if (success) {
            await this._markAlbumDeletedPath(pathLike);
            await this._removeAlbumUploadIndexPath(pathLike);
            window.dispatchEvent(new CustomEvent('phone:albumImageDeleted', {
                detail: { path: this._normalizeBackgroundPath(pathLike), filename }
            }));
        }

        return { attempted: true, success, filename };
    }

    _normalizeBackgroundPath(pathLike) {
        const raw = String(pathLike || '').trim();
        if (!raw) return '';
        try {
            if (/^https?:\/\//i.test(raw)) return new URL(raw).pathname;
        } catch (e) { }
        return raw.split('?')[0].split('#')[0];
    }

    _countManagedBackgroundReferences(pathLike) {
        const target = this._normalizeBackgroundPath(pathLike);
        if (!target) return 0;

        let count = 0;
        const visit = (value, seen = new Set()) => {
            if (value === null || value === undefined) return;
            if (typeof value === 'string') {
                if (this._normalizeBackgroundPath(value) === target) count += 1;
                return;
            }
            if (typeof value !== 'object' || seen.has(value)) return;
            seen.add(value);
            if (Array.isArray(value)) {
                value.forEach(item => visit(item, seen));
                return;
            }
            Object.values(value).forEach(item => visit(item, seen));
        };

        try { visit(window.VirtualPhone?.wechatApp?.wechatData?.data); } catch (e) { }
        try { visit(window.VirtualPhone?.weiboApp?.weiboData?.getProfile?.()); } catch (e) { }
        try { visit(window.VirtualPhone?.honeyApp?.honeyData?.getHoneyUserProfile?.()); } catch (e) { }
        try { visit(this.cache); } catch (e) { }

        return count;
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

        const unreachable = [];
        for (const path of toCheck.keys()) {
            if (await this._probeBackgroundPathReachable(path) === false) {
                unreachable.push(path);
            }
        }

        if (unreachable.length > 0) {
            console.warn('[ImageUpload] 检测到部分 /backgrounds/ 图片暂时不可访问，已保留引用避免移动端/反代误清空:', unreachable);
        }
    }

    // ========================================
    // 📖 读取
    // ========================================
    getWallpaper() { return this.cache.wallpaper; }
    getAppIcon(appId) { return this.cache.appIcons[appId]; }
    getAvatar(characterId) { return this.cache.avatars[characterId]; }
}
