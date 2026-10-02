/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

const MANAGED_MEDIA_RE = /(https?:\/\/[^\s"'<>)]*\/backgrounds\/phone_[^\s"'<>)]*|\/backgrounds\/phone_[^\s"'<>)]*)/ig;
const VIDEO_EXT_RE = /\.(?:mp4|webm|mov|m4v)$/i;

const STORY_IMAGE_SETTING_KEYS = Object.freeze({
    autoEnabled: 'phone-story-image-auto-enabled',
    completionNoticeEnabled: 'phone-story-image-completion-notice-enabled'
});

const STORY_IMAGE_SETTING_DEFAULTS = Object.freeze({
    autoEnabled: false,
    completionNoticeEnabled: true
});

const STORY_IMAGE_META_KEY = 'phone_story_image';

const ALBUM_SOURCE_CATALOG = Object.freeze([
    { key: 'story-image', label: '正文生图', icon: 'fa-image' },
    { key: 'honey', label: '蜜语', icon: 'fa-comment-dots' },
    { key: 'wechat-chat', label: '微信聊天', icon: 'fa-comments' },
    { key: 'wechat-custom', label: '微信自定义表情', icon: 'fa-face-smile' },
    { key: 'diary', label: '日记', icon: 'fa-book-open' },
    { key: 'weibo', label: '微博', icon: 'fa-eye' },
    { key: 'wangxiang', label: '万象', icon: 'fa-bag-shopping' },
    { key: 'mofo', label: '魔坊', icon: 'fa-wand-magic-sparkles' },
    { key: 'wallpaper', label: '壁纸', icon: 'fa-mobile-screen' },
    { key: 'avatar', label: '头像', icon: 'fa-user' },
    { key: 'app-icon', label: 'App 图标', icon: 'fa-grip' },
    { key: 'local-upload', label: '本地上传', icon: 'fa-cloud-arrow-up' },
    { key: 'other', label: '其他媒体', icon: 'fa-images' }
]);

export class AlbumData {
    constructor(storage) {
        this.storage = storage;
        this.deletedKey = 'phone_album_deleted_paths';
    }

    getStoryImageSettings() {
        return Object.fromEntries(
            Object.entries(STORY_IMAGE_SETTING_KEYS).map(([name, storageKey]) => [
                name,
                this._readBoolean(storageKey, STORY_IMAGE_SETTING_DEFAULTS[name])
            ])
        );
    }

    async setStoryImageSetting(name, value) {
        const storageKey = STORY_IMAGE_SETTING_KEYS[name];
        if (!storageKey) throw new Error(`未知的正文生图设置：${name}`);

        await this.storage?.set?.(storageKey, !!value);
        const settings = this.getStoryImageSettings();
        window.dispatchEvent(new CustomEvent('phone:storyImageSettingsChanged', {
            detail: { name, value: settings[name], settings }
        }));
        return settings;
    }

    _readBoolean(key, defaultValue = false) {
        const value = this.storage?.get?.(key, defaultValue);
        if (typeof value === 'string') {
            if (value === 'true') return true;
            if (value === 'false') return false;
        }
        return value === null || value === undefined ? !!defaultValue : !!value;
    }

    _getContext() {
        try {
            return this.storage?.getContext?.()
                || ((typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function')
                    ? SillyTavern.getContext()
                    : null);
        } catch (error) {
            console.warn('[AlbumData] 获取正文楼层上下文失败:', error);
            return null;
        }
    }

    _readStoryMediaUrl(media) {
        if (typeof media === 'string') return String(media).trim();
        if (!media || typeof media !== 'object') return '';
        if (String(media.type || '').trim().toLowerCase() === 'video') return '';
        return String(media.url || media.src || media.image || '').trim();
    }

    _getStoryMessageText(message = {}) {
        const swipeIndex = Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;
        if (Array.isArray(message?.swipes) && message.swipes.length > 0) {
            return String(message.swipes[swipeIndex] || message.swipes[0] || '').trim();
        }
        return String(message?.mes || message?.message || '').trim();
    }

    _getStorySourceFingerprint(message = {}) {
        const swipeIndex = Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;
        const text = this._getStoryMessageText(message);
        let hash = 2166136261;
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return `${swipeIndex}:${text.length}:${(hash >>> 0).toString(36)}`;
    }

    _getCurrentStoryMeta(message = {}) {
        const storyMeta = message?.extra?.[STORY_IMAGE_META_KEY];
        if (!storyMeta || typeof storyMeta !== 'object') return storyMeta;
        const savedFingerprint = String(storyMeta.sourceFingerprint || '').trim();
        if (savedFingerprint && savedFingerprint !== this._getStorySourceFingerprint(message)) return null;
        return storyMeta;
    }

    _getStoryMessageImages(message = {}) {
        const extra = message?.extra && typeof message.extra === 'object' ? message.extra : {};
        const storyImage = this._readStoryMediaUrl(this._getCurrentStoryMeta(message)?.imageUrl);
        const media = Array.isArray(extra.media)
            ? extra.media.map(item => this._readStoryMediaUrl(item)).filter(Boolean)
            : [];
        const legacySwipes = Array.isArray(extra.image_swipes)
            ? extra.image_swipes.map(item => this._readStoryMediaUrl(item)).filter(Boolean)
            : [];
        const legacyImage = this._readStoryMediaUrl(extra.image);
        return [...new Set([...media, ...legacySwipes, legacyImage, storyImage].filter(Boolean))];
    }

    _getSelectedStoryImage(message = {}, images = this._getStoryMessageImages(message)) {
        const extra = message?.extra && typeof message.extra === 'object' ? message.extra : {};
        const storyImage = this._readStoryMediaUrl(this._getCurrentStoryMeta(message)?.imageUrl);
        if (storyImage) return storyImage;
        const selectedIndex = Number.parseInt(String(extra.media_index ?? ''), 10);
        if (Array.isArray(extra.media) && Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < extra.media.length) {
            const selectedUrl = this._readStoryMediaUrl(extra.media[selectedIndex]);
            if (selectedUrl) return selectedUrl;
        }
        return images.at(-1) || '';
    }

    getStoryFloors() {
        const context = this._getContext();
        const chat = Array.isArray(context?.chat) ? context.chat : [];
        return chat.flatMap((message, floor) => {
            if (!message || typeof message !== 'object' || message.is_user === true || message.is_system === true) {
                return [];
            }
            const messageText = this._getStoryMessageText(message);
            const images = this._getStoryMessageImages(message);
            const storyMeta = this._getCurrentStoryMeta(message);
            const meta = storyMeta && typeof storyMeta === 'object' ? storyMeta : {};
            const tags = typeof storyMeta === 'string'
                ? storyMeta.trim()
                : String(meta.tags || '').trim();
            return [{
                floor,
                message,
                messageText,
                images,
                imageUrl: this._getSelectedStoryImage(message, images),
                tags,
                provider: String(meta.provider || '').trim(),
                model: String(meta.model || '').trim(),
                generatedAt: Number(meta.generatedAt || 0) || 0
            }];
        });
    }

    getStoryFloor(floor) {
        const targetFloor = Number.parseInt(String(floor), 10);
        if (!Number.isInteger(targetFloor)) return null;
        return this.getStoryFloors().find(item => item.floor === targetFloor) || null;
    }

    getStoryTagSource(floor) {
        const target = this.getStoryFloor(floor);
        if (!target) return null;

        const context = this._getContext();
        const chat = Array.isArray(context?.chat) ? context.chat : [];
        let previousUserText = '';
        for (let index = target.floor - 1; index >= 0; index -= 1) {
            const message = chat[index];
            if (!message || message.is_system === true) continue;
            if (message.is_user === true) {
                previousUserText = String(message.mes || message.message || '').trim();
                break;
            }
        }

        return {
            ...target,
            userName: String(context?.name1 || 'User').trim() || 'User',
            characterName: String(context?.name2 || 'Character').trim() || 'Character',
            previousUserText: previousUserText.slice(-6000),
            messageText: target.messageText.slice(-12000)
        };
    }

    async setStoryFloorTags(floor, tags, expectedMessage = null) {
        const target = this.getStoryFloor(floor);
        if (!target) throw new Error('正文楼层不存在或已被删除');
        if (expectedMessage && target.message !== expectedMessage) {
            throw new Error('正文楼层已变化，请重新生成 TAG');
        }

        const normalizedTags = String(tags || '').trim();
        if (!normalizedTags) throw new Error('生图 TAG 不能为空');
        const extra = target.message.extra && typeof target.message.extra === 'object'
            ? target.message.extra
            : (target.message.extra = {});
        const previousMeta = extra[STORY_IMAGE_META_KEY];
        const sourceFingerprint = this._getStorySourceFingerprint(target.message);
        const previousFingerprint = String(previousMeta?.sourceFingerprint || '').trim();
        const canReusePrevious = previousMeta && typeof previousMeta === 'object'
            && (!previousFingerprint || previousFingerprint === sourceFingerprint);
        extra[STORY_IMAGE_META_KEY] = {
            ...(canReusePrevious ? previousMeta : {}),
            tags: normalizedTags,
            sourceFingerprint,
            tagsUpdatedAt: Date.now()
        };
        await this._saveStoryChat();
        return this.getStoryFloor(target.floor);
    }

    async attachStoryFloorImage(floor, imageUrl, details = {}, expectedMessage = null) {
        const target = this.getStoryFloor(floor);
        if (!target) throw new Error('正文楼层不存在或已被删除');
        if (expectedMessage && target.message !== expectedMessage) {
            throw new Error('正文楼层已变化，图片未写入聊天记录');
        }

        const safeImageUrl = String(imageUrl || '').trim();
        if (!safeImageUrl) throw new Error('生成结果没有可用图片');
        const extra = target.message.extra && typeof target.message.extra === 'object'
            ? target.message.extra
            : (target.message.extra = {});
        const previousMeta = extra[STORY_IMAGE_META_KEY];
        const sourceFingerprint = this._getStorySourceFingerprint(target.message);
        const previousFingerprint = String(previousMeta?.sourceFingerprint || '').trim();
        const canReusePrevious = previousMeta && typeof previousMeta === 'object'
            && (!previousFingerprint || previousFingerprint === sourceFingerprint);
        this._removeLegacyStoryInlineMedia(extra);
        extra[STORY_IMAGE_META_KEY] = {
            ...(canReusePrevious ? previousMeta : {}),
            tags: String(details.tags || (canReusePrevious ? previousMeta?.tags : '') || '').trim(),
            provider: String(details.provider || '').trim(),
            model: String(details.model || '').trim(),
            sourceFingerprint,
            generatedAt: Date.now(),
            imageUrl: safeImageUrl
        };

        await this._saveStoryChat();
        return this.getStoryFloor(target.floor);
    }

    _removeLegacyStoryInlineMedia(extra) {
        if (!extra || typeof extra !== 'object' || !Array.isArray(extra.media)) return false;

        const storyImageUrl = this.normalizePath(extra[STORY_IMAGE_META_KEY]?.imageUrl);
        const selectedIndex = Number.parseInt(String(extra.media_index ?? ''), 10);
        const selectedUrl = this._readStoryMediaUrl(extra.media[selectedIndex]);
        const nextMedia = extra.media.filter(item => {
            const source = String(item?.source || '').trim();
            const title = String(item?.title || '').trim();
            const itemUrl = this.normalizePath(this._readStoryMediaUrl(item));
            if (source === '正文生图') return false;
            return !(storyImageUrl && itemUrl === storyImageUrl && /^正文第\s*\d+\s*楼$/.test(title));
        });
        if (nextMedia.length === extra.media.length) return false;

        if (nextMedia.length === 0) {
            delete extra.media;
            delete extra.media_index;
            delete extra.inline_image;
            return true;
        }

        extra.media = nextMedia;
        const nextSelectedIndex = nextMedia.findIndex(item => this._readStoryMediaUrl(item) === selectedUrl);
        extra.media_index = nextSelectedIndex >= 0
            ? nextSelectedIndex
            : Math.min(Math.max(selectedIndex, 0), nextMedia.length - 1);
        return true;
    }

    async migrateLegacyStoryInlineMedia() {
        const context = this._getContext();
        const chat = Array.isArray(context?.chat) ? context.chat : [];
        let changed = false;

        chat.forEach(message => {
            const extra = message?.extra;
            if (this._removeLegacyStoryInlineMedia(extra)) changed = true;
            const storyMeta = extra?.[STORY_IMAGE_META_KEY];
            if (storyMeta && typeof storyMeta === 'object' && !String(storyMeta.sourceFingerprint || '').trim()) {
                storyMeta.sourceFingerprint = this._getStorySourceFingerprint(message);
                changed = true;
            }
        });

        if (changed) await this._saveStoryChat();
        return changed;
    }

    async _saveStoryChat() {
        const context = this._getContext();
        if (!context) throw new Error('无法保存正文生图：酒馆聊天上下文不可用');
        if (typeof window !== 'undefined' && typeof window.saveChatDebounced === 'function') {
            window.saveChatDebounced();
            return;
        }
        if (typeof context.saveChatDebounced === 'function') {
            context.saveChatDebounced();
            return;
        }
        if (typeof context.saveChat === 'function') {
            await context.saveChat();
            return;
        }
        this.storage?._debouncedSaveChat?.();
    }

    getMedia() {
        const items = new Map();
        const deleted = this._getDeletedSet();
        let order = 0;

        const addImage = (pathLike, sourceLabel = '小手机', meta = {}) => {
            const normalized = this.normalizePath(pathLike);
            if (!normalized || deleted.has(normalized)) return;
            if (!this.isManagedMediaPath(normalized)) return;

            const createdAt = Number(meta?.createdAt || 0);

            const existing = items.get(normalized);
            if (existing) {
                if (sourceLabel && !existing.sources.includes(sourceLabel)) {
                    existing.sources.push(sourceLabel);
                }
                existing.refCount += 1;
                if (Number.isFinite(createdAt) && createdAt > existing.createdAt) {
                    existing.createdAt = createdAt;
                }
                return;
            }

            items.set(normalized, {
                id: normalized,
                src: this.toDisplayPath(pathLike),
                path: normalized,
                filename: this.getFilename(normalized),
                mediaType: this.isVideoPath(normalized) ? 'video' : 'image',
                sources: sourceLabel ? [sourceLabel] : [],
                refCount: 1,
                createdAt: Number.isFinite(createdAt) ? createdAt : 0,
                order: order++
            });
        };

        this._scanKnownStores(addImage);
        this._scanRuntimeData(addImage);
        this._scanLocalStorage(addImage);

        return Array.from(items.values())
            .sort((a, b) => {
                const createdDiff = Number(b.createdAt || 0) - Number(a.createdAt || 0);
                return createdDiff || (a.order - b.order);
            })
            .map(image => ({
                ...image,
                sourceKey: this.getImageSourceKey(image)
            }));
    }

    getImages() {
        return this.getMedia().filter(item => item.mediaType !== 'video');
    }

    getSourceCatalog() {
        return ALBUM_SOURCE_CATALOG.map(source => ({ ...source }));
    }

    getSourceDefinition(sourceKey = 'other') {
        return this.getSourceCatalog().find(source => source.key === sourceKey)
            || this.getSourceCatalog().find(source => source.key === 'other');
    }

    getImageSourceKey(image = {}) {
        const path = String(image?.path || image?.src || '').toLowerCase();
        if (/\/phone_(?:story|main_chat)_image(?:_|\.)/i.test(path)) return 'story-image';
        if (/\/phone_(?:[^/]*_)?emoji(?:_|\.)/i.test(path)) return 'wechat-custom';
        if (/\/phone_wechat_(?:img|sticker)(?:_|\.)/i.test(path)) return 'wechat-chat';

        const sourceKeys = new Set();
        const sources = Array.isArray(image?.sources) ? image.sources : [];
        for (const source of sources) {
            const value = String(source || '').trim().toLowerCase();
            if (!value) continue;
            if (/正文生图|story.?image|main.?chat.?image/.test(value)) sourceKeys.add('story-image');
            else if (/微信自定义表情|自定义表情|表情包|custom.?emoji/.test(value)) sourceKeys.add('wechat-custom');
            else if (/微信聊天|微信消息|^微信$|wechat/.test(value)) sourceKeys.add('wechat-chat');
            else if (/蜜语|honey/.test(value)) sourceKeys.add('honey');
            else if (/日记|diary/.test(value)) sourceKeys.add('diary');
            else if (/微博|weibo/.test(value)) sourceKeys.add('weibo');
            else if (/万象|wangxiang/.test(value)) sourceKeys.add('wangxiang');
            else if (/魔坊|mofo/.test(value)) sourceKeys.add('mofo');
            else if (/壁纸|wallpaper/.test(value)) sourceKeys.add('wallpaper');
            else if (/头像|avatar/.test(value)) sourceKeys.add('avatar');
            else if (/app\s*图标|app.?icon/.test(value)) sourceKeys.add('app-icon');
            else if (/本地上传|本地备份|全局设置|聊天数据|小手机/.test(value)) sourceKeys.add('local-upload');
        }
        const priority = [
            'story-image', 'wechat-custom', 'honey', 'wechat-chat', 'diary', 'weibo', 'wangxiang',
            'mofo', 'wallpaper', 'avatar', 'app-icon', 'local-upload'
        ];
        return priority.find(key => sourceKeys.has(key)) || 'other';
    }

    getImageSourceLabel(image = {}) {
        return this.getSourceDefinition(image?.sourceKey || this.getImageSourceKey(image))?.label || '其他媒体';
    }

    groupImagesBySource(images = []) {
        const groups = new Map(this.getSourceCatalog().map(source => [source.key, { ...source, images: [] }]));
        (Array.isArray(images) ? images : []).forEach(image => {
            const sourceKey = image?.sourceKey || this.getImageSourceKey(image);
            const group = groups.get(sourceKey) || groups.get('other');
            group.images.push(image);
        });
        return Array.from(groups.values()).filter(group => group.images.length > 0);
    }

    async deleteImage(pathLike) {
        const normalized = this.normalizePath(pathLike);
        if (!normalized) return { success: false, message: '媒体路径无效' };

        const imageManager = window.VirtualPhone?.imageManager;
        let deleteResult = { attempted: false, success: false };
        if (imageManager?.deleteManagedBackgroundByPath) {
            deleteResult = await imageManager.deleteManagedBackgroundByPath(normalized, { quiet: true });
        }

        await this.cleanupReferences(normalized);
        await this._markDeleted(normalized);
        await this._removeUploadIndexPath(normalized);

        return {
            success: true,
            fileDeleted: !!deleteResult.success,
            attempted: !!deleteResult.attempted,
            message: deleteResult.success ? '文件已删除' : '媒体记录已删除'
        };
    }

    async deleteImages(pathLikes = []) {
        const normalizedPaths = Array.from(new Set(
            (Array.isArray(pathLikes) ? pathLikes : [])
                .map(path => this.normalizePath(path))
                .filter(Boolean)
        ));
        if (normalizedPaths.length === 0) {
            return { successCount: 0, failCount: 0, results: [] };
        }

        const imageManager = window.VirtualPhone?.imageManager;
        const results = [];
        let successCount = 0;
        let failCount = 0;

        for (const path of normalizedPaths) {
            let deleteResult = { attempted: false, success: false };
            try {
                if (imageManager?.deleteManagedBackgroundByPath) {
                    deleteResult = await imageManager.deleteManagedBackgroundByPath(path, { quiet: true });
                }
                await this.cleanupReferences(path);
                await this._markDeleted(path);
                await this._removeUploadIndexPath(path);
                successCount += 1;
                results.push({ path, success: true, fileDeleted: !!deleteResult.success, attempted: !!deleteResult.attempted });
            } catch (e) {
                failCount += 1;
                results.push({ path, success: false, error: e });
            }
        }

        return { successCount, failCount, results };
    }

    async markMissingImage(pathLike) {
        const normalized = this.normalizePath(pathLike);
        if (!normalized || !this.isManagedMediaPath(normalized)) return false;
        await this._markDeleted(normalized);
        await this._removeUploadIndexPath(normalized);
        return true;
    }

    async cleanupReferences(pathLike) {
        const target = this.normalizePath(pathLike);
        if (!target) return;

        const imageManager = window.VirtualPhone?.imageManager;
        if (imageManager?.cache) {
            let changed = false;
            if (this.normalizePath(imageManager.cache.wallpaper) === target) {
                imageManager.cache.wallpaper = null;
                changed = true;
                window.dispatchEvent(new CustomEvent('phone:updateWallpaper', { detail: { wallpaper: null } }));
            }

            ['appIcons', 'avatars'].forEach(groupKey => {
                const group = imageManager.cache[groupKey];
                if (!group || typeof group !== 'object') return;
                Object.keys(group).forEach(key => {
                    if (this.normalizePath(group[key]) === target) {
                        delete group[key];
                        changed = true;
                    }
                });
            });

            if (changed && imageManager.saveImages) {
                await imageManager.saveImages(imageManager.cache);
                window.dispatchEvent(new CustomEvent('phone:updateAppIcon'));
            }
        }

        if (this.normalizePath(this.storage?.get?.('phone-card-time-image')) === target) {
            await this.storage.remove('phone-card-time-image');
            window.dispatchEvent(new CustomEvent('phone:updateWallpaper', { detail: { cardTimeImage: null } }));
        }

        this._cleanupStorageStore(this.storage?._getChatMetadataStore?.(), target, 'chat');
        this._cleanupStorageStore(this.storage?._getExtensionSettingsStore?.(), target, 'settings');
        await this._cleanupStoryMessageReferences(target);
        this._cleanupHoneyRuntimeReferences(target);
    }

    async _cleanupStoryMessageReferences(target) {
        const context = this._getContext();
        const chat = Array.isArray(context?.chat) ? context.chat : [];
        let changed = false;

        chat.forEach(message => {
            const extra = message?.extra;
            if (!extra || typeof extra !== 'object') return;

            if (Array.isArray(extra.media)) {
                const selectedUrl = this._readStoryMediaUrl(extra.media[Number.parseInt(String(extra.media_index ?? ''), 10)]);
                const nextMedia = extra.media.filter(item => this.normalizePath(this._readStoryMediaUrl(item)) !== target);
                if (nextMedia.length !== extra.media.length) {
                    extra.media = nextMedia;
                    const selectedIndex = nextMedia.findIndex(item => this._readStoryMediaUrl(item) === selectedUrl);
                    extra.media_index = selectedIndex >= 0 ? selectedIndex : Math.max(0, nextMedia.length - 1);
                    if (nextMedia.length === 0) {
                        delete extra.media_index;
                        delete extra.inline_image;
                    }
                    changed = true;
                }
            }

            if (Array.isArray(extra.image_swipes)) {
                const nextSwipes = extra.image_swipes.filter(item => this.normalizePath(this._readStoryMediaUrl(item)) !== target);
                if (nextSwipes.length !== extra.image_swipes.length) {
                    extra.image_swipes = nextSwipes;
                    changed = true;
                }
            }
            if (this.normalizePath(this._readStoryMediaUrl(extra.image)) === target) {
                delete extra.image;
                changed = true;
            }
            if (this.normalizePath(extra[STORY_IMAGE_META_KEY]?.imageUrl) === target) {
                delete extra[STORY_IMAGE_META_KEY].imageUrl;
                changed = true;
            }
        });

        if (changed) {
            await this._saveStoryChat();
        }
    }

    _cleanupHoneyRuntimeReferences(target) {
        const honeyApp = window.VirtualPhone?.honeyApp;
        const honeyData = honeyApp?.honeyData;
        const honeyView = honeyApp?.honeyView;
        if (!honeyData && !honeyView) return;

        const clean = value => this._removePathFromValue(value, target, new Set());

        const recommendTopics = honeyData?.getRecommendTopics?.();
        const recommendResult = clean(recommendTopics);
        if (recommendResult.changed) honeyData?.saveRecommendTopics?.(recommendResult.value);

        const topicScenes = honeyData?.getTopicScenes?.();
        const topicScenesResult = clean(topicScenes);
        if (topicScenesResult.changed) honeyData?.saveTopicScenes?.(topicScenesResult.value);

        const lastScene = honeyData?.getLastSceneData?.();
        const lastSceneResult = clean(lastScene);
        if (lastSceneResult.changed) honeyData?.saveLastSceneData?.(lastSceneResult.value);

        const viewTopicsResult = clean(honeyView?.recommendTopics);
        if (viewTopicsResult.changed) {
            honeyView.recommendTopics = viewTopicsResult.value;
            honeyData?.saveRecommendTopics?.(viewTopicsResult.value);
        }

        const selectedTopicResult = clean(honeyView?.selectedTopic);
        if (selectedTopicResult.changed) honeyView.selectedTopic = selectedTopicResult.value;

        const currentSceneResult = clean(honeyView?.currentSceneData);
        if (currentSceneResult.changed) {
            honeyView.currentSceneData = currentSceneResult.value;
            honeyView._persistCurrentScene?.();
        }
    }

    normalizePath(pathLike) {
        const raw = String(pathLike || '').trim();
        if (!raw) return '';
        let value = raw.split('?')[0].split('#')[0];
        try {
            if (/^https?:\/\//i.test(value)) {
                value = new URL(value).pathname;
            }
        } catch (e) { }
        return value;
    }

    toDisplayPath(pathLike) {
        const raw = String(pathLike || '').trim();
        if (!raw) return '';
        if (/^https?:\/\//i.test(raw)) return raw;
        return this.normalizePath(raw);
    }

    isManagedImagePath(pathLike) {
        const value = this.normalizePath(pathLike);
        return this.isManagedMediaPath(value) && !this.isVideoPath(value);
    }

    isManagedMediaPath(pathLike) {
        const value = this.normalizePath(pathLike);
        return /\/backgrounds\/phone_[^/]+/i.test(value);
    }

    isVideoPath(pathLike) {
        return VIDEO_EXT_RE.test(this.normalizePath(pathLike));
    }

    getFilename(pathLike) {
        const normalized = this.normalizePath(pathLike);
        return normalized.split('/').filter(Boolean).pop() || 'image';
    }

    _scanKnownStores(addImage) {
        const imageManager = window.VirtualPhone?.imageManager;
        this._scanAlbumUploadIndex(addImage);
        this._scanValue(imageManager?.cache, '本地上传', addImage);
        this._scanValue(this.storage?.get?.('phone-card-time-image'), '时间卡片背景', addImage);
        this._scanValue(this.storage?._getChatMetadataStore?.(), '聊天数据', addImage);
        this._scanValue(this.storage?._getExtensionSettingsStore?.(), '全局设置', addImage);
    }

    _scanAlbumUploadIndex(addImage) {
        try {
            const raw = this.storage?.get?.('phone_album_upload_index', '[]');
            const list = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
            if (!Array.isArray(list)) return;
            list.forEach(item => {
                const path = typeof item === 'string' ? item : item?.path;
                addImage(path, this._labelFromUploadPrefix(item?.prefix), {
                    createdAt: Number(item?.createdAt || 0)
                });
            });
        } catch (e) { }
    }

    _scanRuntimeData(addImage) {
        const phone = window.VirtualPhone || {};
        const wechatData = phone.wechatApp?.wechatData?.data;
        this._scanValue(wechatData?.customEmojis, '微信自定义表情', addImage);
        this._scanValue(wechatData?.userInfo, '头像', addImage);
        this._scanValue(wechatData?.contacts, '头像', addImage);
        this._scanValue(wechatData?.chats, '微信聊天', addImage);
        this._scanValue(wechatData?.moments, '微信聊天', addImage);
        try {
            const chats = wechatData?.chats || [];
            chats.forEach(chat => {
                const messages = phone.wechatApp.wechatData.getMessages?.(chat.id);
                this._scanValue(messages, `微信聊天:${chat.name || chat.id}`, addImage);
            });
        } catch (e) { }
        this._scanValue(phone.weiboApp?.weiboData, '微博', addImage);
        this._scanValue(phone.honeyApp?.honeyData, '蜜语', addImage);
        this._scanValue(phone.diaryApp?.diaryData, '日记', addImage);
        this._scanValue(phone.mofoApp?.mofoData, '魔坊', addImage);
        const wangxiangApp = phone.wangxiangApp;
        this._scanValue({
            marketplaceProducts: wangxiangApp?.marketplaceProducts,
            marketplaceOrders: wangxiangApp?.marketplaceOrders,
            inventoryItems: wangxiangApp?.inventoryItems,
            generatedTasks: wangxiangApp?.generatedTasks,
            managedTasks: wangxiangApp?.managedTasks
        }, '万象', addImage);
    }

    _scanLocalStorage(addImage) {
        try {
            for (let i = 0; i < window.localStorage.length; i += 1) {
                const key = window.localStorage.key(i);
                if (!key || (!key.includes('virtual_phone') && !key.includes('st_virtual_phone'))) continue;
                this._scanValue(window.localStorage.getItem(key), `本地备份:${key}`, addImage);
            }
        } catch (e) { }
    }

    _scanValue(value, sourceLabel, addImage, seen = new Set(), depth = 0) {
        if (value === null || value === undefined) return;
        if (typeof value === 'string') {
            let match;
            MANAGED_MEDIA_RE.lastIndex = 0;
            while ((match = MANAGED_MEDIA_RE.exec(value)) !== null) {
                addImage(match[1], sourceLabel);
            }
            return;
        }
        if (typeof value !== 'object' || seen.has(value) || depth > 8) return;
        seen.add(value);
        if (Array.isArray(value)) {
            value.forEach(item => this._scanValue(item, sourceLabel, addImage, seen, depth + 1));
            return;
        }
        Object.entries(value).forEach(([key, item]) => {
            const label = this._labelFromKey(key, sourceLabel);
            this._scanValue(item, label, addImage, seen, depth + 1);
        });
    }

    _labelFromKey(key, fallback) {
        const value = String(key || '').toLowerCase();
        if (['手机壁纸', '时间卡片背景', 'App图标', '头像', '微信自定义表情'].includes(fallback)) {
            return fallback;
        }
        if (value.includes('customemoji') || value.includes('custom_emoji')) return '微信自定义表情';
        if (value.includes('storyimage') || value.includes('story_image') || value.includes('mainchatimage') || value.includes('main_chat_image')) return '正文生图';
        if (value.includes('appicons') || value.includes('app_icons')) return 'App图标';
        if (value.includes('avatar')) return '头像';
        if (value.includes('wechat')) return '微信聊天';
        if (value.includes('weibo')) return '微博';
        if (value.includes('honey')) return '蜜语';
        if (value.includes('diary')) return '日记';
        if (value.includes('wangxiang')) return '万象';
        if (value.includes('mofo')) return '魔坊';
        if (value.includes('wallpaper')) return '手机壁纸';
        if (value.includes('card-time')) return '时间卡片背景';
        if (value.includes('phone_image_paths')) return '本地上传';
        if (value.includes('phone_album_upload_index')) return '本地上传';
        return fallback || '小手机';
    }

    _labelFromUploadPrefix(prefix) {
        const value = String(prefix || '').toLowerCase();
        if (value.includes('story_image') || value.includes('main_chat_image')) return '正文生图';
        if (value.includes('wallpaper')) return '手机壁纸';
        if (value.includes('card_time')) return '时间卡片背景';
        if (value.includes('icon_')) return 'App图标';
        if (value.includes('avatar')) return '头像';
        if (value.includes('wechat_sticker') || value.includes('wechat_img')) return '微信聊天';
        if (value.includes('emoji')) return '微信自定义表情';
        if (value.includes('wechat')) return '微信聊天';
        if (value.includes('weibo')) return '微博';
        if (value.includes('honey')) return '蜜语';
        if (value.includes('diary')) return '日记';
        if (value.includes('wangxiang')) return '万象';
        if (value.includes('mofo')) return '魔坊';
        return '本地上传';
    }

    _cleanupStorageStore(store, target, scope) {
        if (!store || typeof store !== 'object') return;
        let changed = false;
        Object.keys(store).forEach(key => {
            if (key === this.deletedKey) return;
            const result = this._removePathFromValue(store[key], target);
            if (result.changed) {
                store[key] = result.value;
                changed = true;
            }
        });

        if (!changed) return;
        if (scope === 'chat') {
            this.storage?._debouncedSaveChat?.();
        } else {
            this.storage?._queuedSaveExtensionSettings?.();
        }
    }

    _removePathFromValue(value, target, seen = new Set()) {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (this.normalizePath(trimmed) === target) {
                return { value: '', changed: true };
            }
            if (!trimmed.includes('/backgrounds/')) {
                return { value, changed: false };
            }
            try {
                const parsed = JSON.parse(trimmed);
                const result = this._removePathFromValue(parsed, target, seen);
                if (result.changed) {
                    return { value: JSON.stringify(result.value), changed: true };
                }
            } catch (e) { }
            if (trimmed.includes(target)) {
                return { value: value.replaceAll(target, ''), changed: true };
            }
            return { value, changed: false };
        }

        if (value === null || value === undefined || typeof value !== 'object' || seen.has(value)) {
            return { value, changed: false };
        }
        seen.add(value);

        if (Array.isArray(value)) {
            let changed = false;
            const next = [];
            value.forEach(item => {
                if (typeof item === 'string' && this.normalizePath(item) === target) {
                    changed = true;
                    return;
                }
                const result = this._removePathFromValue(item, target, seen);
                if (result.changed) changed = true;
                next.push(result.value);
            });
            return { value: next, changed };
        }

        let changed = false;
        Object.keys(value).forEach(key => {
            const item = value[key];
            if (typeof item === 'string' && this.normalizePath(item) === target) {
                delete value[key];
                changed = true;
                return;
            }
            const result = this._removePathFromValue(item, target, seen);
            if (result.changed) {
                value[key] = result.value;
                changed = true;
            }
        });
        return { value, changed };
    }

    _getDeletedSet() {
        try {
            const raw = this.storage?.get?.(this.deletedKey, '[]');
            const list = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
            return new Set(list.map(item => this.normalizePath(item)).filter(Boolean));
        } catch (e) {
            return new Set();
        }
    }

    async _markDeleted(pathLike) {
        const deleted = this._getDeletedSet();
        const normalized = this.normalizePath(pathLike);
        if (!normalized) return;
        deleted.add(normalized);
        await this.storage?.set?.(this.deletedKey, JSON.stringify(Array.from(deleted).slice(-500)));
    }

    async _removeUploadIndexPath(pathLike) {
        const target = this.normalizePath(pathLike);
        if (!target) return;
        try {
            const raw = this.storage?.get?.('phone_album_upload_index', '[]');
            const list = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
            if (!Array.isArray(list)) return;
            const next = list.filter(item => this.normalizePath(item?.path || item) !== target);
            if (next.length === list.length) return;
            await this.storage?.set?.('phone_album_upload_index', JSON.stringify(next));
        } catch (e) { }
    }
}
