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
// ========================================
// 📔 日记数据引擎 - 存储与AI调用
// ========================================
import { applyPhoneTagFilter } from '../../config/tag-filter.js';

export class DiaryData {
    constructor(storage) {
        this.storage = storage;
        this._entries = null;
        this._settings = null;
        this.stopBatch = false; // 分批停止标志
    }

    // ==================== 数据读写 ====================

    getEntries() {
        if (!this._entries) {
            const saved = this.storage.get('diary_entries', null);
            if (saved) {
                try {
                    this._entries = typeof saved === 'string' ? JSON.parse(saved) : saved;
                } catch (e) {
                    console.error('[DiaryData] 解析日记条目失败:', e);
                    this._entries = [];
                }
            } else {
                this._entries = [];
            }
            if (this._normalizeDiaryAuthorMetadata(this._entries)) {
                this.saveEntries();
            }
        }
        return this._entries;
    }

    saveEntries() {
        this.storage.set('diary_entries', JSON.stringify(this._entries || []));
    }

    _normalizeDiaryAuthorMetadata(entries = []) {
        if (!Array.isArray(entries)) return false;
        let changed = false;
        entries.forEach(entry => {
            if (!entry || typeof entry !== 'object') return;
            const author = String(entry.author || this._extractAuthorFromContent(entry.content)).trim();
            if (author && entry.author !== author) {
                entry.author = author;
                changed = true;
            }
            if (!author || !Array.isArray(entry.photos)) return;
            entry.photos.forEach(photo => {
                if (!photo || typeof photo !== 'object') return;
                if (photo.author) return;
                photo.author = author;
                changed = true;
            });
        });
        return changed;
    }

    getSettings() {
        if (!this._settings) {
            const saved = this.storage.get('diary_settings', null);
            if (saved) {
                try {
                    this._settings = typeof saved === 'string' ? JSON.parse(saved) : saved;
                } catch (e) {
                    this._settings = {};
                }
            } else {
                this._settings = {};
            }
        }
        return this._settings;
    }

    saveSettings() {
        this.storage.set('diary_settings', JSON.stringify(this._settings || {}));
    }

   // ==================== 背景图管理 ====================

    // 🔥 核心魔法：将 base64 图片转换为实体文件并上传到酒馆的 backgrounds 文件夹
    async _uploadImageToServer(base64, type) {
        if (!base64 || !base64.startsWith('data:image')) return base64; // 如果已经是链接则跳过
        try {
            const uploadedUrl = await window.VirtualPhone?.imageManager?.uploadDataUrl?.(base64, `diary_${type}`);
            if (!uploadedUrl) throw new Error('图片上传管理器未初始化');
            return uploadedUrl;
        } catch (e) {
            console.error('[Diary] 上传图片到服务器文件夹失败:', e);
            throw e instanceof Error ? e : new Error('上传失败');
        }
    }

    getPageBg(entryId) {
        const settings = this.getSettings();
        return settings[`bg_${entryId}`] || null;
    }

    async setPageBg(entryId, base64) {
        const settings = this.getSettings();
        const oldUrl = String(settings[`bg_${entryId}`] || '').trim();
        let nextUrl = '';
        if (base64) {
            nextUrl = await this._uploadImageToServer(base64, `page_${entryId}`);
            settings[`bg_${entryId}`] = nextUrl;
        } else {
            delete settings[`bg_${entryId}`];
        }
        this.saveSettings();
        this._cleanupReplacedDiaryImage(oldUrl, nextUrl);
    }

    getGlobalBg() {
        // 优先读取服务器存储的路径，如果没有则兼容读取旧版的本地缓存防止丢失
        return this.storage.get('global_diary_bg_global') || localStorage.getItem('diary_shared_bg_global') || null;
    }

    async setGlobalBg(base64) {
        const oldUrl = String(this.storage.get('global_diary_bg_global') || '').trim();
        let nextUrl = '';
        if (base64) {
            nextUrl = await this._uploadImageToServer(base64, 'global');
            // 使用 storage.set 会存入酒馆服务器的 settings.json 中，突破浏览器限制
            this.storage.set('global_diary_bg_global', nextUrl);
        } else {
            this.storage.remove('global_diary_bg_global');
        }
        this._cleanupReplacedDiaryImage(oldUrl, nextUrl);
    }

    getCoverBg() {
        return this.storage.get('global_diary_bg_cover') || localStorage.getItem('diary_shared_bg_cover') || null;
    }

    async setCoverBg(base64) {
        const oldUrl = String(this.storage.get('global_diary_bg_cover') || '').trim();
        let nextUrl = '';
        if (base64) {
            nextUrl = await this._uploadImageToServer(base64, 'cover');
            this.storage.set('global_diary_bg_cover', nextUrl);
        } else {
            this.storage.remove('global_diary_bg_cover');
        }
        this._cleanupReplacedDiaryImage(oldUrl, nextUrl);
    }

    getTocBg() {
        return this.storage.get('global_diary_bg_toc') || localStorage.getItem('diary_shared_bg_toc') || null;
    }

    async setTocBg(base64) {
        const oldUrl = String(this.storage.get('global_diary_bg_toc') || '').trim();
        let nextUrl = '';
        if (base64) {
            nextUrl = await this._uploadImageToServer(base64, 'toc');
            this.storage.set('global_diary_bg_toc', nextUrl);
        } else {
            this.storage.remove('global_diary_bg_toc');
        }
        this._cleanupReplacedDiaryImage(oldUrl, nextUrl);
    }

    async resetDefaultBackgrounds() {
        const bgKeys = [
            ['global_diary_bg_cover', 'diary_shared_bg_cover'],
            ['global_diary_bg_toc', 'diary_shared_bg_toc'],
            ['global_diary_bg_global', 'diary_shared_bg_global']
        ];
        const managedImages = [];

        bgKeys.forEach(([storageKey, legacyKey]) => {
            managedImages.push(this.storage.get(storageKey));
            try {
                managedImages.push(localStorage.getItem(legacyKey));
            } catch (e) { }
        });

        await Promise.all(bgKeys.map(async ([storageKey, legacyKey]) => {
            await this.storage.remove(storageKey);
            try {
                localStorage.removeItem(legacyKey);
            } catch (e) { }
        }));

        const cleanupPaths = [...new Set(managedImages
            .map(path => this._normalizeManagedDiaryImagePath(path))
            .filter(Boolean))];

        return {
            cleanupCount: cleanupPaths.length,
            cleanup: () => this._cleanupManagedDiaryImages(cleanupPaths)
        };
    }

    // ==================== 行间距 ====================

    getPageLineHeight(entryId) {
        const settings = this.getSettings();
        return settings[`lh_${entryId}`] || this.getGlobalLineHeight();
    }

    setPageLineHeight(entryId, value) {
        const settings = this.getSettings();
        settings[`lh_${entryId}`] = value;
        this.saveSettings();
    }

    getGlobalLineHeight() {
        const settings = this.getSettings();
        return settings.globalLineHeight || 2;
    }

    setGlobalLineHeight(value) {
        const settings = this.getSettings();
        settings.globalLineHeight = value;
        this.saveSettings();
    }

    // ==================== 字体大小 ====================

    getGlobalFontSize() {
        const settings = this.getSettings();
        return settings.globalFontSize || 15;
    }

    setGlobalFontSize(value) {
        const settings = this.getSettings();
        settings.globalFontSize = value;
        this.saveSettings();
    }

    // ==================== 自动写日记设置（当前聊天独立） ====================

    getAutoSettings() {
        const saved = this.storage.get('diary_auto_settings', null);
        let settings = {};
        if (saved) {
            try {
                settings = typeof saved === 'string' ? JSON.parse(saved) : saved;
            } catch (e) {
                settings = {};
            }
        }

        if (!settings || typeof settings !== 'object') settings = {};

        return {
            autoEnabled: settings.autoEnabled === true,
            autoFloor: Math.max(10, Math.min(9999, parseInt(settings.autoFloor, 10) || 50)),
            batchMode: settings.batchMode !== false
        };
    }

    setAutoSettings(patch = {}) {
        const current = this.getAutoSettings();
        const next = {
            ...current,
            ...patch
        };

        next.autoEnabled = next.autoEnabled === true;
        next.autoFloor = Math.max(10, Math.min(9999, parseInt(next.autoFloor, 10) || 50));
        next.batchMode = next.batchMode !== false;

        this.storage.set('diary_auto_settings', JSON.stringify(next));
        this._flushChatScopedSettings();
        return next;
    }

    // ==================== 条目管理 ====================

    addEntry(entry) {
        const entries = this.getEntries();
        entry.id = entry.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        entry.createdAt = entry.createdAt || Date.now();
        const author = String(entry.author || this._extractAuthorFromContent(entry.content)).trim();
        if (author) entry.author = author;
        entry.photos = this.mergeEntryPhotos(entry.photos, this.extractPhotoPrompts(entry.content, { author }).photos);
        entries.push(entry);
        this.saveEntries();
        return entry;
    }

    createManualEntry(content, meta = {}) {
        const normalized = String(content || '').replace(/\r\n/g, '\n').trim();
        if (!normalized) throw new Error('日记内容不能为空');
        const author = String(meta.author || this._extractAuthorFromContent(normalized)).trim();

        return this.addEntry({
            content: normalized,
            title: meta.title || this._extractTitleFromContent(normalized),
            date: meta.date || this._extractDateFromContent(normalized),
            author,
            photos: Array.isArray(meta.photos) ? meta.photos : this.extractPhotoPrompts(normalized, { author }).photos,
            startIndex: Number.isFinite(meta.startIndex) ? meta.startIndex : null,
            endIndex: Number.isFinite(meta.endIndex) ? meta.endIndex : null,
            imported: !!meta.imported,
            manual: meta.manual !== false,
            createdAt: meta.createdAt || Date.now()
        });
    }

    importEntriesFromText(rawText) {
        const diaries = this.parseImportedDiaries(rawText);
        if (diaries.length === 0) return [];

        const now = Date.now();
        return diaries.map((diary, index) => this.createManualEntry(diary.content, {
            title: diary.title,
            date: diary.date,
            author: diary.author,
            imported: true,
            createdAt: (this._dateToTimestamp(diary.date || diary.content) || now) + index
        }));
    }

    deleteEntry(entryId) {
        const entries = this.getEntries();
        const idx = entries.findIndex(e => e.id === entryId);
        if (idx !== -1) {
            const entry = entries[idx];
            const managedImages = [
                ...this._collectManagedDiaryImagesFromEntry(entry),
                this.getPageBg(entryId)
            ];
            entries.splice(idx, 1);
            this.saveEntries();
            const settings = this.getSettings();
            delete settings[`bg_${entryId}`];
            delete settings[`lh_${entryId}`];
            this.saveSettings();
            this._cleanupManagedDiaryImages(managedImages);
            return true;
        }
        return false;
    }

    deleteEntries(entryIds = []) {
        const ids = new Set(
            (Array.isArray(entryIds) ? entryIds : [])
                .map(id => String(id || '').trim())
                .filter(Boolean)
        );
        if (ids.size === 0) return 0;

        const entries = this.getEntries();
        const deletedEntries = entries.filter(entry => ids.has(String(entry?.id || '')));
        const managedImages = deletedEntries.flatMap(entry => [
            ...this._collectManagedDiaryImagesFromEntry(entry),
            this.getPageBg(entry?.id)
        ]);
        const before = entries.length;
        this._entries = entries.filter(entry => !ids.has(String(entry?.id || '')));
        const deletedCount = before - this._entries.length;
        if (deletedCount <= 0) return 0;

        this.saveEntries();
        const settings = this.getSettings();
        ids.forEach(entryId => {
            delete settings[`bg_${entryId}`];
            delete settings[`lh_${entryId}`];
        });
        this.saveSettings();
        this._cleanupManagedDiaryImages(managedImages);
        return deletedCount;
    }

    clearAllEntries() {
        const entries = this.getEntries();
        const settings = this.getSettings();
        const managedImages = [
            ...entries.flatMap(entry => this._collectManagedDiaryImagesFromEntry(entry)),
            ...Object.entries(settings)
                .filter(([key]) => String(key || '').startsWith('bg_'))
                .map(([, value]) => value)
        ];
        this._entries = [];
        this.saveEntries();
        // 清除所有日记相关的设置（背景、行高等）
        const keysToDelete = Object.keys(settings).filter(k => k.startsWith('bg_') || k.startsWith('lh_'));
        keysToDelete.forEach(k => delete settings[k]);
        this.saveSettings();
        this._cleanupManagedDiaryImages(managedImages);
    }

    getEntry(entryId) {
        return this.getEntries().find(e => e.id === entryId) || null;
    }

    updateEntryContent(entryId, newContent) {
        const entries = this.getEntries();
        const entry = entries.find(e => e.id === entryId);
        if (entry) {
            entry.content = newContent;
            const newAuthor = this._extractAuthorFromContent(newContent);
            if (newAuthor) {
                entry.author = newAuthor;
            }
            entry.photos = this.mergeEntryPhotos(entry.photos, this.extractPhotoPrompts(newContent, { author: entry.author }).photos);
            // 更新日期（如果内容中有新日期）
            const newDate = this._extractDateFromContent(newContent);
            if (newDate) {
                entry.date = newDate;
            }
            this.saveEntries();
            return true;
        }
        return false;
    }

    extractPhotoPrompts(content = '', options = {}) {
        const source = String(content || '');
        const author = String(options.author || this._extractAuthorFromContent(source)).trim();
        const photos = [];
        const regex = this._getPhotoPromptTagRegex();
        let match;
        while ((match = regex.exec(source)) !== null) {
            const type = String(match[1] || '').trim();
            const first = String(match[2] || '').replace(/\s+/g, ' ').trim();
            const second = String(match[3] || '').replace(/\s+/g, ' ').trim();
            const reason = second ? first : '';
            const prompt = second || first;
            if (!prompt) continue;
            photos.push({
                id: `diary_photo_${Date.now().toString(36)}_${photos.length}_${Math.random().toString(36).slice(2, 7)}`,
                type,
                prompt,
                reason,
                author,
                status: 'idle',
                imageUrl: '',
                error: ''
            });
            if (photos.length >= 3) break;
        }
        return { photos };
    }

    _getPhotoPromptTagRegex() {
        return /\[(用户照片|个人图片|图片)\][^\S\r\n]*[（(]([^\r\n]*?)[）)](?:[^\S\r\n]*[（(]([^\r\n]*?)[）)])?/g;
    }

    parseDiaryContent(content = {}) {
        const text = String(content || '').replace(/\r\n/g, '\n').trim();
        if (!text) {
            return {
                format: 'empty',
                title: '',
                date: '',
                weather: '',
                author: '',
                body: '',
                photos: []
            };
        }

        const title = this._extractTitleFromContent(text) || '';
        const newDateMatch = text.match(/^日期[:：]\s*(.+)$/m);
        const newWeatherMatch = text.match(/^天气[:：]\s*(.+)$/m);
        const newBodyMatch = text.match(/^日记正文[:：][^\S\r\n]*\n?([\s\S]*?)(?=\n[^\S\r\n]*落款[:：]|(?![\s\S]))/m);
        const newAuthorMatch = text.match(/^落款[:：]\s*(?:\n\s*)?(.+)$/m);
        const isNewFormat = !!(title && newDateMatch && newBodyMatch);

        if (isNewFormat) {
            const explicitAuthor = this._normalizeDiaryAuthorName(newAuthorMatch?.[1] || '');
            const rawBodyWithMaybeAuthor = String(newBodyMatch?.[1] || '').trim();
            const inferredAuthor = explicitAuthor ? '' : this._extractBareAuthorLine(rawBodyWithMaybeAuthor);
            const rawBody = inferredAuthor
                ? this._removeBareAuthorLine(rawBodyWithMaybeAuthor, inferredAuthor)
                : rawBodyWithMaybeAuthor;
            const author = explicitAuthor || inferredAuthor;
            const body = this.stripPhotoPromptTags(rawBody)
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            return {
                format: 'new',
                title,
                date: String(newDateMatch?.[1] || '').trim(),
                weather: String(newWeatherMatch?.[1] || '').trim(),
                author,
                body,
                rawBody,
                photos: this.extractPhotoPrompts(rawBody, {
                    author
                }).photos
            };
        }

        return this._parseLegacyDiaryContent(text);
    }

    _parseLegacyDiaryContent(text = '') {
        const source = String(text || '').replace(/\r\n/g, '\n').trim();
        const footer = this._extractDiaryFooterLine(source);
        const date = this._extractLegacyDateFromContent(source);
        const author = this._extractLegacyAuthorFromContent(source);
        const weather = this._extractLegacyWeatherFromFooter(footer);
        let body = source
            .replace(/^【[^】]+】\s*/, '')
            .replace(/^日期[:：].*$/gm, '')
            .replace(/^天气[:：].*$/gm, '')
            .replace(/^日记正文[:：]\s*$/gm, '')
            .replace(/^照片[:：]\s*$/gm, '')
            .replace(/^落款[:：].*$/gm, '')
            .replace(this._getPhotoPromptTagRegex(), '')
            .trim();
        if (footer) {
            body = body.replace(footer, '').trim();
        }
        body = body.replace(/\n{3,}/g, '\n\n').trim();
        return {
            format: 'legacy',
            title: this._extractTitleFromContent(source) || '',
            date,
            weather,
            author,
            body,
            rawBody: source,
            photos: this.extractPhotoPrompts(source, { author }).photos
        };
    }

    stripPhotoPromptTags(content = '') {
        return String(content || '')
            .replace(this._getPhotoPromptTagRegex(), '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    mergeEntryPhotos(existingPhotos = [], parsedPhotos = []) {
        const existing = Array.isArray(existingPhotos) ? existingPhotos : [];
        const parsed = Array.isArray(parsedPhotos) ? parsedPhotos : [];
        if (parsed.length === 0) return existing;

        const used = new Set();
        return parsed.map((photo, index) => {
            const same = existing.find((item, existingIndex) => {
                if (used.has(existingIndex)) return false;
                return String(item?.type || '') === String(photo?.type || '')
                    && String(item?.prompt || '').trim() === String(photo?.prompt || '').trim();
            });
            if (same) {
                used.add(existing.indexOf(same));
                return {
                    ...same,
                    reason: photo.reason || same.reason || '',
                    author: photo.author || same.author || ''
                };
            }
            return {
                ...photo,
                id: photo.id || `diary_photo_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 7)}`
            };
        });
    }

    normalizeEntryPhotos(entry) {
        if (!entry) return [];
        const author = String(entry.author || this._extractAuthorFromContent(entry.content)).trim();
        if (author) entry.author = author;
        const parsed = this.extractPhotoPrompts(entry.content, { author }).photos;
        const merged = this.mergeEntryPhotos(entry.photos, parsed);
        entry.photos = merged;
        return merged;
    }

    updateEntryPhoto(entryId, photoId, patch = {}) {
        const entry = this.getEntry(entryId);
        if (!entry || !photoId) return null;
        const photos = this.normalizeEntryPhotos(entry);
        const index = photos.findIndex(photo => String(photo?.id || '') === String(photoId));
        if (index < 0) return null;
        photos[index] = {
            ...photos[index],
            ...patch,
            updatedAt: Date.now()
        };
        entry.photos = photos;
        this.saveEntries();
        return photos[index];
    }

    async generateEntryPhotos(entryId, options = {}) {
        const entry = this.getEntry(entryId);
        if (!entry) return [];
        const photos = this.normalizeEntryPhotos(entry).slice(0, 3);
        if (photos.length === 0) return [];
        this.saveEntries();

        const results = [];
        for (const photo of photos) {
            if (!options.force && (photo.status === 'done' || photo.status === 'loading')) {
                results.push(photo);
                continue;
            }
            // 串行生成，避免和微信/微博生图并发抢队列。
            results.push(await this.generateEntryPhoto(entryId, photo.id));
        }
        return results;
    }

    async generateEntryPhoto(entryId, photoId) {
        const entry = this.getEntry(entryId);
        if (!entry) throw new Error('日记不存在');
        const photo = this.normalizeEntryPhotos(entry).find(item => String(item?.id || '') === String(photoId));
        if (!photo) throw new Error('照片不存在');

        const imageManager = window.VirtualPhone?.imageGenerationManager;
        if (!imageManager || typeof imageManager.generate !== 'function') {
            throw new Error('生图管理器未初始化');
        }
        if (this._hasCjkText(photo.prompt)) {
            this.updateEntryPhoto(entryId, photoId, {
                status: 'failed',
                error: '缺少英文生图Tag：第二个括号必须只写英文逗号分隔 tags'
            });
            throw new Error('缺少英文生图Tag，请使用 [图片]（中文照片说明）（English tags）');
        }
        if (this.storage && imageManager.storage !== this.storage) {
            imageManager.storage = this.storage;
        }

        const generationId = `diary_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const previousImageUrl = String(photo.imageUrl || '').trim();
        this.updateEntryPhoto(entryId, photoId, {
            status: 'loading',
            generationId,
            error: '',
            imageUrl: ''
        });

        try {
            const references = await this._buildDiaryPersonalImageReferences(photo, entry);
            const prompt = await this._buildDiaryImagePrompt(photo, entry);
            const result = await imageManager.generate({
                app: 'diary',
                prompt,
                novelAIReferences: references
            });
            const imageUrl = String(result?.imageUrl || result?.imageData || '').trim();
            if (!imageUrl) throw new Error('接口返回成功，但没有拿到图片地址');
            const storedImageUrl = await this._persistDiaryGeneratedImage(imageUrl, `diary_photo_${entryId}_${photoId}_${generationId}`);

            const latest = this.getEntry(entryId)?.photos?.find(item => String(item?.id || '') === String(photoId));
            if (String(latest?.generationId || '') !== generationId) return latest;

            const updated = this.updateEntryPhoto(entryId, photoId, {
                status: 'done',
                imageUrl: storedImageUrl,
                error: '',
                finalPrompt: prompt,
                imageModel: String(result?.model || '').trim(),
                imageProvider: String(result?.provider || '').trim(),
                imageGenerationWidth: Number(result?.width || result?.requestedWidth || 0) || '',
                imageGenerationHeight: Number(result?.height || result?.requestedHeight || 0) || ''
            });
            this._cleanupReplacedDiaryImage(previousImageUrl, storedImageUrl);
            return updated;
        } catch (err) {
            const message = String(err?.message || err || '未知错误').trim();
            this.updateEntryPhoto(entryId, photoId, {
                status: 'failed',
                error: message
            });
            throw err;
        }
    }

    async _persistDiaryGeneratedImage(imageUrl, prefix = 'diary_photo') {
        const safeUrl = String(imageUrl || '').trim();
        if (!safeUrl) return '';
        if (/^\/backgrounds\/phone_[^?#]+/i.test(safeUrl)) return safeUrl;

        const uploader = window.VirtualPhone?.imageManager;
        if (!uploader?.uploadBlob) {
            throw new Error('图片上传管理器未初始化，无法保存日记照片');
        }
        const response = await fetch(safeUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`读取日记照片失败（HTTP ${response.status}）`);
        const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const arrayBuffer = await response.arrayBuffer();
        if (!arrayBuffer || arrayBuffer.byteLength <= 0) {
            throw new Error('日记照片结果不是有效图片');
        }
        const bytes = new Uint8Array(arrayBuffer);
        const mime = /^image\//i.test(contentType)
            ? contentType
            : this._detectGeneratedDiaryImageMime(bytes);
        if (!mime) throw new Error('日记照片结果不是有效图片');
        const blob = new Blob([arrayBuffer], { type: mime });
        return uploader.uploadBlob(blob, prefix);
    }

    _detectGeneratedDiaryImageMime(bytes) {
        if (!bytes || bytes.length < 4) return '';
        if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
        if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
        if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
        if (
            bytes.length >= 12 &&
            bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
            bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
        ) {
            return 'image/webp';
        }
        return '';
    }

    _normalizeManagedDiaryImagePath(pathLike) {
        const raw = String(pathLike || '').trim();
        if (!raw) return '';
        let value = raw.split('?')[0].split('#')[0];
        try {
            if (/^https?:\/\//i.test(value)) value = new URL(value).pathname;
        } catch (e) { }
        return /^\/backgrounds\/phone_diary_/i.test(value) ? value : '';
    }

    _collectManagedDiaryImagesFromEntry(entry) {
        const photos = Array.isArray(entry?.photos) ? entry.photos : [];
        return [...new Set(photos
            .map(photo => this._normalizeManagedDiaryImagePath(photo?.imageUrl))
            .filter(Boolean))];
    }

    _cleanupManagedDiaryImages(paths = []) {
        const imageManager = window.VirtualPhone?.imageManager;
        if (!imageManager?.deleteManagedBackgroundByPath) return;
        [...new Set((Array.isArray(paths) ? paths : [paths])
            .map(path => this._normalizeManagedDiaryImagePath(path))
            .filter(Boolean))]
            .forEach((path) => {
                imageManager.deleteManagedBackgroundByPath(path, {
                    quiet: true,
                    skipIfReferenced: true
                }).catch(() => {});
            });
    }

    _cleanupReplacedDiaryImage(oldUrl, nextUrl) {
        const oldPath = this._normalizeManagedDiaryImagePath(oldUrl);
        const nextPath = this._normalizeManagedDiaryImagePath(nextUrl);
        if (!oldPath || oldPath === nextPath) return;
        this._cleanupManagedDiaryImages([oldPath]);
    }

    async _getWechatDataForDiaryPhotos() {
        if (window.VirtualPhone?.wechatApp?.wechatData) return window.VirtualPhone.wechatApp.wechatData;
        if (window.VirtualPhone?.cachedWechatData) return window.VirtualPhone.cachedWechatData;
        try {
            const module = await import('../wechat/wechat-data.js');
            const data = new module.WechatData(this.storage);
            if (!window.VirtualPhone) window.VirtualPhone = {};
            window.VirtualPhone.cachedWechatData = data;
            return data;
        } catch (err) {
            console.warn('[Diary] 加载微信联系人失败:', err);
            return null;
        }
    }

    _normalizeDiaryAuthorName(name = '') {
        return String(name || '')
            .replace(/\s*[（(]\s*已拉黑\s*[）)]\s*$/g, '')
            .replace(/^(?:署名|作者|日记人|姓名)[:：]\s*/g, '')
            .trim();
    }

    _extractBareAuthorLine(content = '') {
        const lines = String(content || '')
            .replace(/\r\n/g, '\n')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);
        if (lines.length < 2) return '';

        const candidate = this._normalizeDiaryAuthorName(lines[lines.length - 1]);
        if (!candidate) return '';
        if (candidate.length < 2 || candidate.length > 12) return '';
        if (!/^[\u3400-\u9fff·・]{2,12}$/.test(candidate)) return '';
        if (/[，。！？、；：,.!?;:]/.test(candidate)) return '';
        return candidate;
    }

    _removeBareAuthorLine(content = '', author = '') {
        const safeAuthor = String(author || '').trim();
        if (!safeAuthor) return String(content || '').trim();
        const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
            if (!String(lines[i] || '').trim()) continue;
            if (this._normalizeDiaryAuthorName(lines[i]) === safeAuthor) {
                lines.splice(i, 1);
            }
            break;
        }
        return lines.join('\n').trim();
    }

    async _resolveDiaryPhotoContact(photo = {}, entry = null) {
        const context = this._getContext();
        const parsedEntry = this.parseDiaryContent(entry?.content || '');
        const authorName = this._normalizeDiaryAuthorName(
            photo.author
            || entry?.author
            || parsedEntry.author
            || this._extractAuthorFromContent(entry?.content)
        );
        const charName = authorName || String(context?.name2 || '').trim();
        if (!charName) return null;
        const wechatData = await this._getWechatDataForDiaryPhotos();
        const contacts = wechatData?.getContacts?.() || [];
        return wechatData?.findContactByNameLoose?.(charName, { includeChats: false })
            || contacts.find(contact => wechatData?._isSameLookupName?.(contact.name, charName))
            || contacts.find(contact => String(contact?.name || '').trim() === charName)
            || null;
    }

    async _buildDiaryPersonalImageTagInfo(context = null) {
        const wechatData = await this._getWechatDataForDiaryPhotos();
        const contacts = wechatData?.getContacts?.() || [];
        const rows = (Array.isArray(contacts) ? contacts : [])
            .map((contact) => {
                const name = String(contact?.name || '').trim();
                const tags = String(contact?.naiPromptTags || contact?.imageTags || '')
                    .split(/[,，\n]+/)
                    .map(tag => tag.trim())
                    .filter(Boolean)
                    .join(', ');
                return name && tags ? `${name}：${tags}` : '';
            })
            .filter(Boolean);
        const userInfo = wechatData?.getUserInfo?.() || {};
        const userTags = String(userInfo?.naiPromptTags || userInfo?.imageTags || '')
            .split(/[,，\n]+/)
            .map(tag => tag.trim())
            .filter(Boolean)
            .join(', ');
        if (userTags) rows.unshift(`{{user}}：${userTags}`);
        return rows.length > 0 ? rows.join('\n') : '暂无';
    }

    async _buildDiaryImagePrompt(photo = {}, entry = null) {
        const basePrompt = String(photo.prompt || '').trim();
        if (String(photo.type || '') === '用户照片') {
            const wechatData = await this._getWechatDataForDiaryPhotos();
            const userInfo = wechatData?.getUserInfo?.() || {};
            const userTags = String(userInfo?.naiPromptTags || userInfo?.imageTags || '')
                .split(/[,，\n]+/)
                .map(tag => tag.trim())
                .filter(Boolean)
                .join(', ');
            if (!userTags) return basePrompt;
            if (!basePrompt) return userTags;
            return `${userTags}, ${basePrompt}`;
        }
        if (String(photo.type || '') !== '个人图片') return basePrompt;

        const contact = await this._resolveDiaryPhotoContact(photo, entry);
        const contactTags = String(contact?.naiPromptTags || contact?.imageTags || '')
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean)
            .join(', ');
        if (!contactTags) return basePrompt;
        if (!basePrompt) return contactTags;
        return `${contactTags}, ${basePrompt}`;
    }

    _hasCjkText(value = '') {
        return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(String(value || ''));
    }

    async _imageUrlToDiaryReferenceDataUrl(url) {
        const safeUrl = String(url || '').trim();
        if (!safeUrl) return '';
        if (safeUrl.startsWith('data:image/')) return safeUrl;
        const response = await fetch(safeUrl, {
            credentials: 'include',
            cache: 'no-store'
        });
        if (!response.ok) throw new Error(`个人形象参考图读取失败 (${response.status})`);
        const blob = await response.blob();
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('个人形象参考图读取失败'));
            reader.readAsDataURL(blob);
        });
        return dataUrl.startsWith('data:image/') ? dataUrl : '';
    }

    async _buildDiaryPersonalImageReferences(photo = {}, entry = null) {
        if (String(photo.type || '') !== '个人图片') return [];
        const contact = await this._resolveDiaryPhotoContact(photo, entry);
        if (!contact) return [];
        const referenceImage = String(contact.naiReferenceImage || contact.referenceImage || '').trim();
        if (!referenceImage || contact.naiReferenceEnabled === false || contact.naiReferenceEnabled === 'false') return [];
        try {
            const image = await this._imageUrlToDiaryReferenceDataUrl(referenceImage);
            if (!image) return [];
            const rawStrength = Number(contact.naiReferenceStrength ?? 0.7);
            const strength = Math.max(0, Math.min(1, Number.isFinite(rawStrength) ? rawStrength : 0.7));
            const rawInfo = Number(contact.naiReferenceInformationExtracted ?? 1);
            const informationExtracted = Math.max(0, Math.min(1, Number.isFinite(rawInfo) ? rawInfo : 1));
            return [{ image, strength, informationExtracted }];
        } catch (err) {
            console.warn('[Diary NAI] 个人形象参考图读取失败，已跳过:', err);
            return [];
        }
    }

    setEntryOfflineHidden(entryId, hidden) {
        const entry = this.getEntry(entryId);
        if (!entry) return false;
        entry.offlineHidden = !!hidden;
        this.saveEntries();
        return true;
    }

    setEntriesOfflineHidden(entryIds = [], hidden) {
        const ids = new Set((Array.isArray(entryIds) ? entryIds : []).map(id => String(id || '').trim()).filter(Boolean));
        if (ids.size === 0) return 0;
        let changed = 0;
        this.getEntries().forEach(entry => {
            if (!ids.has(String(entry?.id || ''))) return;
            if (!!entry.offlineHidden === !!hidden) return;
            entry.offlineHidden = !!hidden;
            changed++;
        });
        if (changed > 0) this.saveEntries();
        return changed;
    }

    buildOfflineInjectionContent(options = {}) {
        const rawLimit = Number.parseInt(
            options.limit ?? this.storage?.get?.('offline-diary-history-limit') ?? 10,
            10
        );
        const limit = Math.max(1, Math.min(9999, Number.isFinite(rawLimit) ? rawLimit : 10));
        const entries = this.getEntries()
            .filter(entry => entry && String(entry.content || '').trim())
            .sort((a, b) => this.getEntrySortTimestamp(b) - this.getEntrySortTimestamp(a))
            .slice(0, limit)
            .filter(entry => entry.offlineHidden !== true)
            .sort((a, b) => this.getEntrySortTimestamp(a) - this.getEntrySortTimestamp(b));
        if (entries.length === 0) return '';

        const cleanText = (value, maxLen = 5000) => String(value || '')
            .replace(/\r\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
            .slice(0, maxLen);

        let content = '【日记记录】\n';
        content += '以下是角色的私密日记。剧情中可参考这些内容保持角色记忆、情绪和关系连续性；严禁逐字复述。\n\n';

        entries.forEach((entry, index) => {
            const title = cleanText(entry.title || this._extractTitleFromContent(entry.content) || '无标题', 80);
            const date = cleanText(entry.date || this._extractDateFromContent(entry.content), 80);
            const body = cleanText(entry.content);
            content += `--- 日记${index + 1} ---\n`;
            if (date) content += `日期: ${date}\n`;
            if (title) content += `标题: ${title}\n`;
            content += `${body}\n\n`;
        });

        return content.trim() + '\n';
    }

    getLastDiaryFloorIndex() {
        const entries = this.getEntries();
        if (entries.length === 0) return -1;
        for (let i = entries.length - 1; i >= 0; i--) {
            const endIndex = Number(entries[i]?.endIndex);
            if (Number.isFinite(endIndex) && endIndex >= 0) return endIndex;
        }
        return -1;
    }

    // ==================== AI 日记生成（参考 memory 插件的 generateRaw 调用） ====================

    /**
     * 调用AI生成日记
     * @param {number} startIndex - 聊天记录起始楼层
     * @param {number} endIndex - 聊天记录结束楼层
     * @returns {Promise<Array>} 生成的日记数组 [{content, date, title}, ...]
     */
    async callAIToWriteDiary(startIndex, endIndex) {
        const context = this._getContext();
        if (!context) throw new Error('无法获取酒馆上下文');
        if (typeof context.generateRaw !== 'function') throw new Error('当前酒馆版本不支持 generateRaw API');

        const chatMessages = this._collectChatHistory(context, startIndex, endIndex);
        if (!chatMessages) throw new Error('没有可用的聊天记录');

        const promptContent = this._getDiaryPrompt(context);
        const userName = context.name1 || '用户';
        const personalImageTagInfo = await this._buildDiaryPersonalImageTagInfo(context);
        const filledPrompt = promptContent
            .replace(/\{\{user\}\}/g, userName)
            .replace(/\{\{char\}\}/g, context.name2 || '角色')
            .replace(/\{\{personalImageTagInfo\}\}/g, personalImageTagInfo)
            .replace(/\{\{chatHistory\}\}/g, ''); // 清除占位符，聊天记录已通过消息数组传入

        const worldInfoMessage = await window.VirtualPhone?.worldbookManager?.buildWorldbookMessage?.('diary');
        const wechatHistoryMessage = await this._buildDiaryWechatOnlineHistoryMessage(context);

        const messages = [
            ...(worldInfoMessage ? [worldInfoMessage] : []),
            ...(wechatHistoryMessage ? [wechatHistoryMessage] : []),
            ...chatMessages
        ];
        this._appendDiaryPromptAtMessageEnd(messages, filledPrompt);

        // 🔥 构建消息数组：背景上下文 + 聊天记录 + 末尾日记提示词
        if (messages.length === 0) throw new Error('消息数组为空');

        // 🚀 核心：移交 ApiManager 处理
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager) throw new Error('API Manager 未初始化');

        const configuredMaxTokens = Number.parseInt(context.max_response_length, 10)
            || Number.parseInt(context.max_length, 10)
            || Number.parseInt(context.amount_gen, 10)
            || 0;
        const diaryMaxTokens = Math.max(1800, configuredMaxTokens || 0);
        const result = await apiManager.callAI(messages, { max_tokens: diaryMaxTokens, appId: 'diary' });
        
        if (!result.success) {
            throw new Error(result.error || '日记生成失败');
        }

        const rawSummary = String(result.summary || result.content || result.text || '');
        const filteredSummary = applyPhoneTagFilter(rawSummary, { storage: this.storage });
        const rawContent = filteredSummary || rawSummary;

        // 使用新的多日记解析方法
        return this.parseMultipleDiaries(rawContent);
    }

    _appendDiaryPromptAtMessageEnd(messages = [], promptContent = '') {
        const prompt = String(promptContent || '').trim();
        if (!prompt) return messages;

        const lastMessage = messages[messages.length - 1];
        if (lastMessage?.role === 'user') {
            lastMessage.content = `${String(lastMessage.content || '').trim()}\n\n${prompt}`.trim();
            lastMessage.isPhoneMessage = true;
            return messages;
        }

        messages.push({
            role: 'user',
            content: prompt,
            isPhoneMessage: true
        });
        return messages;
    }

    async _buildDiaryWechatOnlineHistoryMessage(context = null) {
        try {
            const wechatSource = this._resolveWechatHistorySourceForDiary(context);
            if (!wechatSource) return null;

            const singleLimit = this._readNonNegativeStorageNumber('wechat-single-chat-limit', 200);
            const groupLimit = this._readNonNegativeStorageNumber('wechat-group-chat-limit', 200);
            if (singleLimit <= 0 && groupLimit <= 0) return null;

            const userName = context?.name1 || '用户';
            const sections = [];
            const chats = wechatSource.getChatList() || [];

            for (const chat of chats) {
                if (!chat?.id) continue;
                const isGroup = chat.type === 'group';
                const limit = isGroup ? groupLimit : singleLimit;
                if (limit <= 0) continue;

                const messages = this._sliceWechatMessagesForDiary(wechatSource.getMessages(chat.id) || [], limit);
                if (messages.length === 0) continue;

                const section = this._formatWechatChatForDiary(chat, messages, userName);
                if (section) sections.push(section);
            }

            if (sections.length === 0) return null;

            return {
                role: 'system',
                name: 'SYSTEM (微信线上记录)',
                isPhoneMessage: true,
                content: [
                    '【手机微信线上聊天记录】',
                    '以下是用户手机里已有的微信单聊和微信群聊记录，严格按照时间区分，写日记时可作为经历、关系变化和情绪线索参考。',
                    '',
                    sections.join('\n\n')
                ].join('\n')
            };
        } catch (error) {
            console.warn('[DiaryData] 构建日记微信线上记录失败:', error);
            return null;
        }
    }

    _resolveWechatHistorySourceForDiary(context = null) {
        const wechatData = window.VirtualPhone?.wechatApp?.wechatData || window.VirtualPhone?.cachedWechatData;
        if (wechatData && typeof wechatData.getChatList === 'function' && typeof wechatData.getMessages === 'function') {
            return {
                getChatList: () => wechatData.getChatList() || [],
                getMessages: (chatId) => wechatData.getMessages(chatId) || []
            };
        }

        const data = this._loadStoredWechatDataForDiary(context);
        if (!data) return null;
        const chats = Array.isArray(data.chats) ? data.chats : [];
        const embeddedMessages = data.messages && typeof data.messages === 'object' ? data.messages : {};

        return {
            getChatList: () => [...chats].sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0)),
            getMessages: (chatId) => {
                const safeChatId = String(chatId || '').trim();
                if (!safeChatId) return [];
                if (Array.isArray(embeddedMessages[safeChatId])) return embeddedMessages[safeChatId];

                const keys = this._getWechatMessageStorageKeysForDiary(safeChatId, context);
                for (const key of keys) {
                    const raw = this.storage?.get?.(key, false);
                    const parsed = this._parseMaybeJsonArray(raw);
                    if (parsed.length > 0) return parsed;
                }
                return [];
            }
        };
    }

    _loadStoredWechatDataForDiary(context = null) {
        const keys = this._isLobbyContextForDiary(context)
            ? ['phone_wechat_data_lobby_global', 'wechat_data']
            : ['wechat_data'];

        for (const key of keys) {
            const raw = this.storage?.get?.(key, false);
            if (!raw) continue;
            try {
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (parsed && typeof parsed === 'object') return parsed;
            } catch (e) {
                console.warn(`[DiaryData] 读取微信数据失败: ${key}`, e);
            }
        }
        return null;
    }

    _getWechatMessageStorageKeysForDiary(chatId, context = null) {
        const safeChatId = String(chatId || '').trim();
        if (!safeChatId) return [];
        const keys = [];
        if (this._isLobbyContextForDiary(context)) keys.push(`phone_wechat_msg_lobby_${safeChatId}`);
        keys.push(`wechat_msg_${safeChatId}`);
        return [...new Set(keys)];
    }

    _isLobbyContextForDiary(context = null) {
        const ctx = context || this._getContext();
        const charName = String(ctx?.name2 || '').trim();
        if (/^SillyTavern System$/i.test(charName)) return true;
        const chatId = String(ctx?.chatMetadata?.file_name || ctx?.chatId || '').trim();
        if (chatId) return false;
        if (charName) return false;
        return true;
    }

    _parseMaybeJsonArray(raw) {
        if (Array.isArray(raw)) return raw;
        if (typeof raw !== 'string' || raw.trim() === '') return [];
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    _readNonNegativeStorageNumber(key, fallback = 0) {
        const parsed = parseInt(this.storage?.get?.(key), 10);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.max(0, parsed);
    }

    _sliceWechatMessagesForDiary(messages = [], limit = 0) {
        if (!Array.isArray(messages) || limit <= 0) return [];

        let totalLines = 0;
        let startIdx = messages.length;
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg?.hiddenFromPrompt === true || msg?.isTimeMarker === true || msg?.type === 'time_marker') continue;
            totalLines += msg?.type === 'call_record' && Array.isArray(msg.transcript)
                ? msg.transcript.length + 1
                : 1;
            startIdx = i;
            if (totalLines >= limit) break;
        }

        return messages.slice(startIdx).filter(msg =>
            msg?.hiddenFromPrompt !== true &&
            msg?.isTimeMarker !== true &&
            msg?.type !== 'time_marker'
        );
    }

    _formatWechatChatForDiary(chat = {}, messages = [], userName = '用户') {
        const chatName = String(chat.name || '未命名聊天').trim();
        const isGroup = chat.type === 'group';
        let text = `━━━ ${chatName} 的聊天记录 ━━━\n`;
        let lastDate = '';

        messages.forEach((msg) => {
            if (msg?.date && msg.date !== lastDate) {
                text += `--- ${msg.date} ---\n`;
                lastDate = msg.date;
            }

            const isUser = msg?.from === 'me';
            let speaker = isUser ? userName : chatName;
            if (!isUser && isGroup && msg?.from && msg.from !== 'system') {
                speaker = String(msg.from || '').trim() || chatName;
            }

            const timeStr = msg?.time ? `[${msg.time}] ` : '';
            const quoteStr = msg?.quote ? `「引用 ${msg.quote.sender}: ${msg.quote.content}」` : '';
            text += `${timeStr}${this._formatWechatMessageLineForDiary(msg, speaker, quoteStr, userName)}\n`;
        });

        return text.trim();
    }

    _formatWechatMessageLineForDiary(msg = {}, speaker = '未知', quoteStr = '', userName = '用户') {
        const safeSpeaker = String(speaker || '未知').trim();
        const type = String(msg?.type || '').trim();

        if (msg?.from === 'system' || type === 'system') {
            return `[系统] ${String(msg.content || '').trim()}`;
        }

        if (type === 'call_record') {
            const callTypeName = msg.callType === 'video' ? '视频通话' : '语音通话';
            const statusText = msg.status === 'answered'
                ? `通话时长 ${msg.duration || '未知'}`
                : (msg.status === 'rejected' || msg.status === 'declined')
                    ? '对方已拒绝'
                    : msg.status === 'cancelled'
                        ? '已取消'
                        : '未接听';
            const transcript = Array.isArray(msg.transcript) && msg.transcript.length > 0
                ? msg.transcript.map(t => {
                    const tSpeaker = t?.from === 'me' ? userName : String(t?.from || safeSpeaker || '对方');
                    return `  [通话记录] ${tSpeaker}: ${String(t?.text || '').trim()}`;
                }).join('\n')
                : '';
            return `[${callTypeName} - ${statusText}]${transcript ? `\n${transcript}` : ''}`;
        }

        if (type === 'image') {
            return `${safeSpeaker}: ${quoteStr}${this._formatWechatMediaTextForDiary(msg, '[图片]')}`;
        }

        if (type === 'image_prompt') {
            const mediaType = msg.usePersonalReference ? '个人图片' : (msg.mediaType || '图片');
            const promptText = String(msg.imagePrompt || msg.content || '').trim();
            return `${safeSpeaker}: ${quoteStr}[${mediaType}]（${promptText || '未提供描述'}）`;
        }

        if (type === 'transfer') {
            const status = String(msg.status || '').trim() === 'received' ? '已收款' : '未收款';
            return `${safeSpeaker}: ${quoteStr}[转账 ¥${msg.amount || ''}]（状态：${status}）`;
        }

        if (type === 'redpacket') {
            const status = String(msg.status || '').trim() === 'opened' ? '已领取' : '未领取';
            return `${safeSpeaker}: ${quoteStr}[红包 ¥${msg.amount || ''}]（状态：${status}）`;
        }

        if (type === 'location') {
            const locationText = String(msg.locationText || msg.locationAddress || msg.content || '').trim();
            return `${safeSpeaker}: ${quoteStr}[定位]（${locationText || '未知位置'}）`;
        }

        if (type === 'voice') {
            return `${safeSpeaker}: ${quoteStr}[语音条]（${String(msg.text || msg.content || '').trim() || '未转写'}）`;
        }

        if (type === 'music_invite' || type === 'music_listen') {
            const song = String(msg.songName || msg.song || msg.content || '').trim();
            return `${safeSpeaker}: ${quoteStr}[音乐]（${song || '一起听歌'}）`;
        }

        return `${safeSpeaker}: ${quoteStr}${this._cleanWechatContentForDiary(msg?.content) || '[空消息]'}`;
    }

    _formatWechatMediaTextForDiary(msg = {}, fallback = '[图片]') {
        const candidates = [
            msg.description,
            msg.imageDescription,
            msg.alt,
            msg.caption,
            msg.text,
            msg.content
        ];
        for (const value of candidates) {
            const text = this._cleanWechatContentForDiary(value);
            if (!text) continue;
            if (/^(data:image\/|https?:\/\/|\/)/i.test(text)) continue;
            return text.startsWith('[') ? text : `${fallback}（${text}）`;
        }
        return fallback;
    }

    _cleanWechatContentForDiary(value = '') {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 500);
    }

    /**
     * 分批生成日记（带冷却逻辑，参考 memory 插件）
     * @param {number} startIndex - 起始楼层
     * @param {number} endIndex - 结束楼层
     * @param {number} batchSize - 每批楼层数
     * @param {Function} onProgress - 进度回调 (current, total, status)
     * @returns {Promise<Array>} 生成的日记条目数组
     */
    async batchGenerateDiary(startIndex, endIndex, batchSize = 50, onProgress = null, isAuto = false, options = {}) {
        const totalFloors = endIndex - startIndex;
        const batchCount = Math.ceil(totalFloors / batchSize);
        const results = [];
        this.stopBatch = false;
        const expectedChatId = String(options.chatId || '').trim();
        const setGenerationState = (patch = {}) => {
            if (!window.VirtualPhone) window.VirtualPhone = {};
            window.VirtualPhone.diaryGenerationState = {
                ...(window.VirtualPhone.diaryGenerationState || {}),
                ...patch,
                updatedAt: Date.now()
            };
        };

        // 🔥 设置全局状态，防止切出界面后任务丢失
        if (window.VirtualPhone) {
            window.VirtualPhone.isDiaryBatchRunning = true;
            window.VirtualPhone.diaryBatchProgress = { current: 0, total: batchCount };
        }
        setGenerationState({
            running: true,
            stopping: false,
            done: false,
            error: false,
            status: '生成中...',
            current: 0,
            total: batchCount,
            startedAt: Date.now()
        });

        try {
            if (totalFloors <= batchSize) {
                setGenerationState({ running: true, status: '生成中...', current: 0, total: 1 });
                if (onProgress) onProgress(0, 1, '生成中...');
                const diaries = await this.callAIToWriteDiary(startIndex, endIndex);
                if (expectedChatId && this.getCurrentChatIdentity() !== expectedChatId) return results;
                for (const diary of diaries) {
                    const entry = this.addEntry({
                        content: diary.content,
                        title: diary.title,
                        startIndex,
                        endIndex,
                        date: diary.date,
                        author: diary.author,
                    });
                    results.push(entry);
                }
                if (isAuto) this.setAutoLastFloor(endIndex);
                if (window.VirtualPhone?.diaryBatchProgress) window.VirtualPhone.diaryBatchProgress.current = 1;
                setGenerationState({ running: true, status: '完成', current: 1, total: 1 });
                if (onProgress) onProgress(1, 1, '完成');
            } else {
                for (let i = 0; i < batchCount; i++) {
                    if (this.stopBatch) {
                        setGenerationState({ running: true, stopping: true, status: '已停止', current: i, total: batchCount });
                        if (onProgress) onProgress(i, batchCount, '已停止');
                        break;
                    }
                    if (expectedChatId && this.getCurrentChatIdentity() !== expectedChatId) {
                        setGenerationState({ running: true, status: '聊天已切换，已停止', current: i, total: batchCount });
                        if (onProgress) onProgress(i, batchCount, '聊天已切换，已停止');
                        break;
                    }

                    // 🔥 批次间冷却 5 秒（参考 memory 插件，避免 API 限流 429）
                    if (i > 0) {
                        for (let d = 5; d > 0; d--) {
                            if (this.stopBatch) break;
                            setGenerationState({ running: true, status: `冷却 ${d}s...`, current: i, total: batchCount });
                            if (onProgress) onProgress(i, batchCount, `冷却 ${d}s...`);
                            await new Promise(r => setTimeout(r, 1000));
                        }
                        if (this.stopBatch) break;
                    }

                    const bStart = startIndex + i * batchSize;
                    const bEnd = Math.min(bStart + batchSize, endIndex);

                    setGenerationState({ running: true, status: `生成 ${i + 1}/${batchCount}...`, current: i, total: batchCount });
                    if (onProgress) onProgress(i, batchCount, `生成 ${i + 1}/${batchCount}...`);

                    try {
                        const diaries = await this.callAIToWriteDiary(bStart, bEnd);
                        if (expectedChatId && this.getCurrentChatIdentity() !== expectedChatId) {
                            if (onProgress) onProgress(i, batchCount, '聊天已切换，已停止');
                            break;
                        }
                        for (const diary of diaries) {
                            const entry = this.addEntry({
                                content: diary.content,
                                title: diary.title,
                                startIndex: bStart,
                                endIndex: bEnd,
                                date: diary.date,
                                author: diary.author,
                            });
                            results.push(entry);
                        }
                        if (isAuto) this.setAutoLastFloor(bEnd);
                    } catch (err) {
                        console.error(`[DiaryData] 批次 ${i + 1} 失败:`, err);
                        setGenerationState({ running: true, error: true, status: `批次 ${i + 1} 失败: ${err.message}`, current: i, total: batchCount });
                        if (onProgress) onProgress(i, batchCount, `批次 ${i + 1} 失败: ${err.message}`);
                    }

                    // 🔥 更新全局进度
                    if (window.VirtualPhone?.diaryBatchProgress) {
                        window.VirtualPhone.diaryBatchProgress.current = i + 1;
                    }
                    setGenerationState({ running: true, status: `已完成 ${i + 1}/${batchCount}`, current: i + 1, total: batchCount });
                }
                if (!this.stopBatch && onProgress) onProgress(batchCount, batchCount, '全部完成');
            }
        } finally {
            // 🔥 无论成功、失败、停止，都重置全局状态
            if (window.VirtualPhone) {
                window.VirtualPhone.isDiaryBatchRunning = false;
                delete window.VirtualPhone.diaryBatchProgress;
            }
            setGenerationState({
                running: false,
                stopping: false,
                done: !this.stopBatch,
                error: false,
                status: this.stopBatch ? '已停止' : '生成完成！',
                finishedAt: Date.now()
            });
        }

        return results;
    }

    /**
     * 自动生成日记（由 onMessageReceived 触发）
     */
    async autoGenerateDiary(options = {}) {
        try {
            const context = this._getContext();
            if (!context || !context.chat) return;
            const expectedChatId = String(options.chatId || '').trim();
            if (expectedChatId && this.getCurrentChatIdentity(context) !== expectedChatId) return;

            // 🔥 核心修改：读取专属自动日记追踪器
            const lastIndex = this.getAutoLastFloor();
            const startIndex = lastIndex + 1;
            const endIndex = context.chat.length;

            if (endIndex - startIndex < 5) return;

            const autoSettings = this.getAutoSettings();
            const batchMode = autoSettings.batchMode !== false;
            const batchSize = autoSettings.autoFloor || 50;

            if (batchMode && (endIndex - startIndex) > batchSize) {
                // 🔥 核心修改：传入 isAuto = true
                const generatedEntries = await this.batchGenerateDiary(startIndex, endIndex, batchSize, null, true, { chatId: expectedChatId });
                this._notifyAutoDiaryGenerated(generatedEntries.length, startIndex, endIndex);
            } else {
                if (expectedChatId && this.getCurrentChatIdentity() !== expectedChatId) return;
                const diaries = await this.callAIToWriteDiary(startIndex, endIndex);
                if (expectedChatId && this.getCurrentChatIdentity() !== expectedChatId) return;
                // 处理返回的多篇日记
                for (const diary of diaries) {
                    this.addEntry({
                        content: diary.content,
                        title: diary.title,
                        startIndex,
                        endIndex,
                        date: diary.date,
                        author: diary.author,
                    });
                }
                // 🔥 核心修改：生成成功后，推高专属标记
                this.setAutoLastFloor(endIndex);
                this._notifyAutoDiaryGenerated(diaries.length, startIndex, endIndex);
            }
        } catch (e) {
            console.error('[DiaryData] 自动生成日记失败:', e);
        }
    }

    _notifyAutoDiaryGenerated(count, startIndex, endIndex) {
        const safeCount = Number(count) || 0;
        if (safeCount <= 0) return;

        const notify = window.VirtualPhone?.notify;
        if (typeof notify !== 'function') return;

        notify('日记', `自动写日记完成，新增 ${safeCount} 篇`, '📱', {
            avatarText: '记',
            avatarBg: '#5b6cff',
            avatarColor: '#ffffff',
            name: '日记',
            content: `自动写日记完成，新增 ${safeCount} 篇（${startIndex}-${endIndex} 层）`,
            timeText: '刚刚',
            senderKey: 'diary:auto'
        });
    }

    // ==================== 内部工具方法 ====================

    _getContext() {
        return (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
            ? SillyTavern.getContext()
            : null;
    }

    getCurrentChatIdentity(context = null) {
        const ctx = context || this._getContext();
        return String(ctx?.chatMetadata?.file_name || ctx?.chatId || 'default_chat');
    }

    _collectChatHistory(context, startIndex, endIndex) {
        if (!context.chat || context.chat.length === 0) return null;

        const start = Math.max(0, startIndex);
        const end = Math.min(context.chat.length, endIndex);
        const messages =[];

        for (let i = start; i < end; i++) {
            const msg = context.chat[i];
            if (!msg) continue;

            // 精准跳过系统消息和插件自身消息，不要使用 msg.is_system，以免误杀
            if (msg.role === 'system' || msg.isPhoneMessage || msg.isGaigaiData || msg.isGaigaiPrompt) continue;

            let originalText = msg.mes || msg.content || '';
            let text = originalText;

            // 标签清洗：优先记忆插件，缺失时按手机本地开关回退
            text = applyPhoneTagFilter(text, { storage: this.storage });

            // 2. 基础兜底处理（仅去除HTML标签，保留星号动作描写，日记需要动作上下文）
            text = text.replace(/<[^>]*>/g, '').trim();

            // 3. 安全防空盾：如果清洗后变为空，但原本有内容，大概率是被误杀了，回退基础清洗
            if (!text && originalText) {
                text = originalText.replace(/<[^>]*>/g, '').trim();
            }

            if (!text) continue;

            messages.push({
                role: msg.is_user ? 'user' : 'assistant',
                content: text,
                isPhoneMessage: true
            });
        }

        return messages.length > 0 ? messages : null;
    }

    _getDiaryPrompt(context) {
        const promptManager = window.VirtualPhone?.promptManager;
        if (promptManager) {
            promptManager.ensureLoaded();
            const diaryPrompt = promptManager.prompts?.diary?.generate?.content;
            if (diaryPrompt) return diaryPrompt;
        }

        return `请根据以下聊天记录，以${context.name2 || '角色'}的口吻写一篇日记，体现情感变化。\n\n聊天记录：\n{{chatHistory}}`;
    }

    /**
     * 从日记内容中提取日期（支持新格式：————YYYY年MM月DD日 星期* 天气 姓名）
     */
    _extractDateFromContent(content) {
        const newMatch = String(content || '').match(/^日期[:：]\s*(.+)$/m);
        if (newMatch) return String(newMatch[1] || '').trim();
        return this._extractLegacyDateFromContent(content);
    }

    _extractLegacyDateFromContent(content) {
        const text = String(content || '');
        const footerMatch = text.match(/————(\d{1,6}年\d{1,2}月\d{1,2}日)\s*(星期[一二三四五六日天])?/);
        if (footerMatch) {
            return footerMatch[2] ? `${footerMatch[1]} ${footerMatch[2]}` : footerMatch[1];
        }

        const oldMatch = text.match(/【(\d{1,6}年\d{1,2}月\d{1,2}日\s*星期[一二三四五六日天]?)】/);
        if (oldMatch) return oldMatch[1];

        const generalMatch = text.match(/(\d{1,6}年\d{1,2}月\d{1,2}日)/);
        if (generalMatch) return generalMatch[1];

        return '未知日期';
    }

    _extractDiaryFooterLine(content = '') {
        const lines = String(content || '')
            .replace(/\r\n/g, '\n')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            if (/^(?:————|----+|—{2,}|-{2,})\s*\d{1,6}年\d{1,2}月\d{1,2}日/.test(line)) return line;
        }
        return '';
    }

    _extractAuthorFromContent(content) {
        const newMatch = String(content || '').match(/^落款[:：]\s*(.+)$/m);
        if (newMatch) return this._normalizeDiaryAuthorName(newMatch[1]);
        const newBodyMatch = String(content || '').replace(/\r\n/g, '\n').match(/^日记正文[:：][^\S\r\n]*\n?([\s\S]*?)(?=\n[^\S\r\n]*落款[:：]|(?![\s\S]))/m);
        if (newBodyMatch) {
            const bareAuthor = this._extractBareAuthorLine(newBodyMatch[1]);
            if (bareAuthor) return bareAuthor;
        }
        return this._extractLegacyAuthorFromContent(content);
    }

    _extractLegacyAuthorFromContent(content) {
        const footer = this._extractDiaryFooterLine(content);
        if (!footer) return '';

        let tail = footer
            .replace(/^(?:————|----+|—{2,}|-{2,})\s*/, '')
            .replace(/^\d{1,6}年\d{1,2}月\d{1,2}日\s*/, '')
            .replace(/^星期[一二三四五六日天]\s*/, '')
            .trim();
        if (!tail) return '';

        const weatherWords = new Set([
            '晴', '阴', '雨', '雪', '雾', '霾', '风',
            '多云', '小雨', '中雨', '大雨', '暴雨', '阵雨', '雷阵雨',
            '小雪', '中雪', '大雪', '暴雪', '雨夹雪',
            '微风', '大风', '台风', '晴转多云', '多云转晴', '阴转多云'
        ]);
        const parts = tail.split(/\s+/).filter(Boolean);
        while (parts.length > 1) {
            const value = parts[0].replace(/^天气[:：]?/, '').trim();
            if (!weatherWords.has(value)) break;
            parts.shift();
        }
        if (parts.length === 1) {
            const onlyValue = parts[0].replace(/^天气[:：]?/, '').trim();
            if (weatherWords.has(onlyValue)) return '';
        }
        tail = parts.join(' ').trim();

        const author = tail
            .replace(/^署名[:：]\s*/, '')
            .replace(/^作者[:：]\s*/, '')
            .replace(/^姓名[:：]\s*/, '')
            .trim();
        if (!author || author.length > 40 || /[，。！？、；]/.test(author)) return '';
        return author;
    }

    _extractLegacyWeatherFromFooter(footer = '') {
        const text = String(footer || '').trim();
        if (!text) return '';
        let tail = text
            .replace(/^(?:————|----+|—{2,}|-{2,})\s*/, '')
            .replace(/^\d{1,6}年\d{1,2}月\d{1,2}日\s*/, '')
            .replace(/^星期[一二三四五六日天]\s*/, '')
            .trim();
        if (!tail) return '';

        const author = this._extractLegacyAuthorFromContent(text);
        if (author && tail.endsWith(author)) {
            tail = tail.slice(0, -author.length).trim();
        }
        return tail.replace(/^天气[:：]\s*/, '').trim();
    }

    /**
     * 从日记内容中提取标题（【日记标题】格式）
     */
    _extractTitleFromContent(content) {
        const match = String(content || '').match(/【([^】]+)】/);
        if (match && !match[1].match(/\d{1,6}年/)) {
            // 确保不是日期格式的【】
            return match[1];
        }
        return null;
    }

    getEntrySortTimestamp(entry) {
        if (!entry) return 0;
        return this._dateToTimestamp(entry.date || entry.content) || Number(entry.createdAt || 0) || 0;
    }

    _dateToTimestamp(value) {
        const text = String(value || '');
        const match = text.match(/(\d{1,6})年(\d{1,2})月(\d{1,2})日/);
        if (!match) return 0;

        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return 0;
        if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return 0;

        const date = new Date(year, month - 1, day, 12, 0, 0, 0);
        const timestamp = date.getTime();
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    /**
     * 解析AI返回的日记内容，支持多篇日记分割
     * @param {string} rawContent - AI返回的原始内容
     * @returns {Array} 解析后的日记数组 [{content, date, title}, ...]
     */
    parseMultipleDiaries(rawContent) {
        if (!rawContent || typeof rawContent !== 'string') {
            return [];
        }

        const separatorRegex = /\n\s*---分割线---\s*\n/;
        const parts = rawContent.split(separatorRegex).filter(p => p.trim());

        const diaries = [];
        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;

            const parsed = this.parseDiaryContent(trimmed);

            diaries.push({
                content: trimmed,
                date: parsed.date,
                title: parsed.title,
                author: parsed.author
            });
        }

        if (diaries.length === 0 && rawContent.trim()) {
            const parsed = this.parseDiaryContent(rawContent);
            diaries.push({
                content: rawContent.trim(),
                date: parsed.date,
                title: parsed.title,
                author: parsed.author
            });
        }

        return diaries;
    }

    parseImportedDiaries(rawText) {
        if (!rawText || typeof rawText !== 'string') return [];
        const normalized = rawText.replace(/\r\n/g, '\n').trim();
        if (!normalized) return [];

        const jsonDiaries = this._tryParseImportedJson(normalized);
        if (jsonDiaries.length > 0) return jsonDiaries;

        return this.parseMultipleDiaries(normalized);
    }

    _tryParseImportedJson(text) {
        try {
            const parsed = JSON.parse(text);
            const source = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.entries) ? parsed.entries : []);
            return source
                .map(item => {
                    if (typeof item === 'string') {
                        const content = item.trim();
                        const parsedDiary = this.parseDiaryContent(content);
                        return content ? {
                            content,
                            title: parsedDiary.title,
                            date: parsedDiary.date,
                            author: parsedDiary.author
                        } : null;
                    }
                    const content = String(item?.content || item?.text || item?.body || '').trim();
                    if (!content) return null;
                    const parsedDiary = this.parseDiaryContent(content);
                    return {
                        content,
                        title: item?.title || parsedDiary.title,
                        date: item?.date || parsedDiary.date,
                        author: item?.author || item?.name || parsedDiary.author
                    };
                })
                .filter(Boolean);
        } catch (e) {
            return [];
        }
    }

    clearCache() {
        this._entries = null;
        this._settings = null;
        this.stopBatch = false;
    }

    // ==================== 专属自动日记楼层追踪器 ====================
    getAutoLastFloor() {
        const saved = this.storage.get('diary_auto_last_floor', 0);
        return parseInt(saved);
    }

    setAutoLastFloor(floorIndex) {
        this.storage.set('diary_auto_last_floor', floorIndex);
        this._flushChatScopedSettings();
    }

    _flushChatScopedSettings() {
        try {
            const context = this._getContext();
            if (context && typeof context.saveChat === 'function') {
                Promise.resolve(context.saveChat()).catch(e => console.warn('[DiaryData] 立即保存聊天失败:', e));
                return;
            }
            if (typeof window.saveChatDebounced === 'function') {
                window.saveChatDebounced();
            }
        } catch (e) {
            console.warn('[DiaryData] 触发聊天保存失败:', e);
        }
    }
}
