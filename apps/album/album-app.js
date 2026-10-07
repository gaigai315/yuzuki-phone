/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

import { AlbumData } from './album-data.js?v=1.4.4&r=20261006-story-image-outside-close';
import { ALBUM_CSS_URL, AlbumView } from './album-view.js?v=1.4.4&r=20261006-story-image-outside-close';
import { StoryImageOverlay } from './story-image-overlay.js?v=20261006-story-image-outside-close';
import { applyPhoneTagFilter } from '../../config/tag-filter.js';

export class AlbumApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this._cssRenderPending = false;
        this._cssReadyPromise = null;
        this.storyTagBusyFloors = new Set();
        this.storyImageBusyFloors = new Set();

        this._preloadCSS();

        this.albumData = new AlbumData(storage);
        this.albumView = new AlbumView(this);
        this.storyImageOverlay = new StoryImageOverlay(this);

        window.addEventListener('phone:swipeBack', (event) => this.handleSwipeBack(event));
        window.addEventListener('phone:albumImageDeleted', () => this.refreshIfVisible());
        window.addEventListener('phone:updateWallpaper', () => this.refreshIfVisible());
        window.addEventListener('phone:panelVisibility', event => {
            if (event?.detail?.open === false) this.albumView?.pausePreview?.();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.albumView?.pausePreview?.();
        });
        window.addEventListener('phone:storyImageSettingsChanged', () => this.storyImageOverlay?.refresh());
    }

    attachRuntime(phoneShell = this.phoneShell, storage = this.storage) {
        if (phoneShell) this.phoneShell = phoneShell;
        if (storage) {
            this.storage = storage;
            this.albumData.storage = storage;
        }
        return this;
    }

    _preloadCSS() {
        const existing = document.getElementById('album-css');
        if (existing) return existing;
        const link = document.createElement('link');
        link.id = 'album-css';
        link.rel = 'stylesheet';
        link.href = ALBUM_CSS_URL;
        document.head.appendChild(link);
        return link;
    }

    _waitForCSS() {
        const cssLink = this._preloadCSS();
        if (!cssLink || cssLink.sheet || cssLink.dataset?.albumCssReady === 'true') {
            return Promise.resolve();
        }
        if (this._cssReadyPromise) return this._cssReadyPromise;

        this._cssReadyPromise = new Promise(resolve => {
            let settled = false;
            let fallbackTimer = null;
            const finish = () => {
                if (settled) return;
                settled = true;
                if (fallbackTimer) clearTimeout(fallbackTimer);
                cssLink.removeEventListener('load', finish);
                cssLink.removeEventListener('error', finish);
                if (cssLink.dataset) cssLink.dataset.albumCssReady = 'true';
                resolve();
            };

            cssLink.addEventListener('load', finish, { once: true });
            cssLink.addEventListener('error', finish, { once: true });
            fallbackTimer = setTimeout(finish, 1500);
            requestAnimationFrame(() => {
                if (cssLink.sheet) finish();
            });
        });
        return this._cssReadyPromise;
    }

    render() {
        const cssLink = document.getElementById('album-css');
        if (cssLink && !cssLink.sheet && cssLink.dataset?.albumCssReady !== 'true') {
            if (this._cssRenderPending) return;
            this._cssRenderPending = true;
            this._waitForCSS().finally(() => {
                this._cssRenderPending = false;
                this.albumView.render();
            });
            return;
        }
        this.albumView.render();
    }

    openStoryImageSettings() {
        this.albumView.currentView = 'settings';
        this.render();
    }

    async openStoryImageBrowser(options = {}) {
        await this._waitForCSS();
        try {
            await this.albumData.migrateLegacyStoryInlineMedia();
        } catch (error) {
            console.warn('[AlbumApp] 清理旧正文内联生图失败:', error);
        }
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        this.storyImageOverlay.open(options);
    }

    _showStoryNotification(title, message, icon) {
        if (typeof this.phoneShell?.showNotification === 'function') {
            this.phoneShell.showNotification(title, message, icon);
            return;
        }
        window.VirtualPhone?.notify?.(title, message, icon);
    }

    _refreshStoryImageSurface() {
        this.storyImageOverlay?.refresh();
    }

    async _openGeneratedStoryImage(floor, expectedMessage) {
        const current = this.albumData.getStoryFloor(floor);
        if (!current || current.message !== expectedMessage) return false;

        try {
            await this.openStoryImageBrowser({ floor });
            return true;
        } catch (error) {
            console.warn('[AlbumApp] 自动打开正文生图预览失败:', error);
            return false;
        }
    }

    isStoryTagBusy(floor) {
        return this.storyTagBusyFloors.has(Number(floor));
    }

    isStoryImageBusy(floor) {
        return this.storyImageBusyFloors.has(Number(floor));
    }

    getCurrentStoryImageProvider() {
        const manager = window.VirtualPhone?.imageGenerationManager;
        if (!manager) return '';
        if (this.storage && manager.storage !== this.storage) manager.storage = this.storage;

        try {
            if (typeof manager.resolveProvider === 'function') {
                return String(manager.resolveProvider({ app: 'story' }) || '').trim().toLowerCase();
            }
            if (typeof manager.getBoundProviderForApp === 'function') {
                return String(manager.getBoundProviderForApp('story') || '').trim().toLowerCase();
            }
        } catch (error) {
            console.warn('读取正文生图供应商失败:', error);
        }
        return '';
    }

    _cleanStoryTags(value = '') {
        const cleaned = String(value || '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/```[a-z]*|```/gi, '')
            .replace(/^\s*(?:prompt|positive prompt|tags?|nai tags?|english tags?|提示词|正面提示词)\s*[:：]/i, '')
            .replace(/\r\n?/g, '\n')
            .replace(/[;；]+/g, ', ')
            .replace(/[，、]/g, ', ')
            .replace(/[。！？]/g, '');

        return cleaned
            .split('\n')
            .map(line => line
                .replace(/[ \t]*,[ \t]*/g, ', ')
                .replace(/(?:,[ \t]*){2,}/g, ', ')
                .replace(/^['"“”‘’\s,]+|['"“”‘’\s,]+$/g, '')
                .trim())
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    _assertStoryOperationCurrent(floor, expectedMessage, options = {}) {
        if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const current = this.albumData.getStoryFloor(floor);
        const externallyValid = typeof options.isStillValid !== 'function' || options.isStillValid() !== false;
        if (!current || (expectedMessage && current.message !== expectedMessage) || !externallyValid) {
            const error = new Error('正文楼层已变化');
            error.code = 'STORY_FLOOR_STALE';
            throw error;
        }
        return current;
    }

    _getStoryTavernContext() {
        const dataContext = this.albumData?._getContext?.();
        if (dataContext) return dataContext;
        try {
            return window.SillyTavern?.getContext?.() || null;
        } catch (_error) {
            return null;
        }
    }

    _buildStoryCharacterMessage(context, fallbackName = '角色') {
        const character = context?.characterId !== undefined && context?.characters
            ? context.characters[context.characterId]
            : null;
        const data = character?.data && typeof character.data === 'object' ? character.data : {};
        const clean = (value, limit) => String(value || '').trim().slice(0, limit);
        const parts = [`角色名：${clean(character?.name || fallbackName, 160) || '角色'}`];
        const description = clean(character?.description || data.description, 6000);
        const personality = clean(character?.personality || data.personality, 2400);
        const scenario = clean(character?.scenario || data.scenario || context?.scenario, 3000);
        const firstMessage = clean(character?.first_mes || data.first_mes, 2000);
        const exampleDialogue = clean(character?.mes_example || data.mes_example, 3000);
        const systemPrompt = clean(data.system_prompt || character?.system_prompt, 3000);

        if (description) parts.push(`描述：${description}`);
        if (personality) parts.push(`性格：${personality}`);
        if (scenario) parts.push(`场景/背景：${scenario}`);
        if (firstMessage) parts.push(`开场白：${firstMessage}`);
        if (exampleDialogue) parts.push(`示例对话：${exampleDialogue}`);
        if (systemPrompt) parts.push(`角色系统提示词：${systemPrompt}`);

        return {
            role: 'system',
            content: `【角色卡信息】\n${parts.join('\n')}`,
            name: 'SYSTEM (角色卡)',
            isPhoneMessage: true
        };
    }

    _buildStoryPersonaMessage(context, userName = '用户') {
        const personaText = [
            typeof document !== 'undefined' ? document.getElementById('persona_description')?.value : '',
            context?.persona_description,
            context?.persona,
            context?.power_user?.persona_description,
            typeof window !== 'undefined' ? window.power_user?.persona_description : ''
        ].map(value => String(value || '').trim()).find(Boolean) || '';
        const parts = [`姓名：${String(userName || '用户').trim() || '用户'}`];
        if (personaText) parts.push(personaText.slice(0, 6000));
        return {
            role: 'system',
            content: `【用户信息】\n${parts.join('\n')}`,
            name: 'SYSTEM (用户Persona)',
            isPhoneMessage: true
        };
    }

    _filterStoryTagContextText(value = '') {
        const filterStorage = typeof this.storage?.get === 'function'
            ? this.storage
            : window.VirtualPhone?.storage;
        let content = applyPhoneTagFilter(value, {
            storage: filterStorage
        });
        content = String(content || '')
            .replace(/<img[^>]*src=["']data:image[^"']*["'][^>]*>/gi, '[图片]')
            .replace(/!\[[^\]]*\]\(data:image[^)]*\)/gi, '[图片]')
            .trim();
        return content;
    }

    async _buildStoryTagMessages(source, targetFloor) {
        const promptManager = window.VirtualPhone?.promptManager;
        promptManager?.ensureLoaded?.();
        const context = this._getStoryTavernContext();
        const variables = {
            user: source.userName || context?.name1 || '用户',
            char: source.characterName || context?.name2 || '角色',
            floor: targetFloor
        };
        const overridePrompt = String(
            promptManager?.renderPromptForFeature?.('story', 'override', variables)
            || promptManager?.getPromptForFeature?.('story', 'override')
            || promptManager?.getDefaultPrompts?.()?.story?.override?.content
            || ''
        ).trim();
        if (!overridePrompt) {
            throw new Error('正文生图破限提示词为空，请先在相册设置中恢复默认提示词');
        }

        const messages = [{
            role: 'system',
            content: overridePrompt,
            name: 'SYSTEM (正文生图破限词)',
            isPhoneMessage: true
        }];
        messages.push(this._buildStoryCharacterMessage(context, variables.char));
        messages.push(this._buildStoryPersonaMessage(context, variables.user));
        await window.VirtualPhone?.worldbookManager?.appendWorldbookMessages?.(messages, 'story');

        const previousUserText = this._filterStoryTagContextText(source.previousUserText);
        const storyMessageText = this._filterStoryTagContextText(source.messageText);
        if (!storyMessageText) {
            throw new Error('当前楼层经过黑白名单过滤后没有可用于生成 Tags 的正文');
        }
        const contextLines = [
            previousUserText ? `${variables.user}: ${previousUserText}` : '',
            `${variables.char}: ${storyMessageText}`
        ].filter(Boolean).join('\n\n');
        messages.push({
            role: 'user',
            content: `Selected story floor ${targetFloor}:\n<story>\n${contextLines}\n</story>\n\nReturn only comma-separated image-generation Tags:`,
            isPhoneMessage: true
        });
        return messages;
    }

    async generateStoryTags(floor, options = {}) {
        const targetFloor = Number(floor);
        if (!Number.isInteger(targetFloor)) return { success: false, reason: 'invalid-floor' };
        if (this.isStoryTagBusy(targetFloor) || this.isStoryImageBusy(targetFloor)) {
            return { success: false, reason: 'busy', busy: true };
        }

        const source = this.albumData.getStoryTagSource(targetFloor);
        if (!source) {
            if (options.notifyError !== false) this._showStoryNotification('正文生图', '当前正文楼层不存在', '⚠️');
            return { success: false, reason: 'missing-floor' };
        }
        if (options.expectedMessage && source.message !== options.expectedMessage) {
            return { success: false, reason: 'stale-floor', stale: true };
        }
        if (!source.messageText) {
            if (options.notifyError !== false) this._showStoryNotification('正文生图', '当前楼层没有可用于生成 TAG 的正文', '⚠️');
            return { success: false, reason: 'empty-floor' };
        }

        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager || typeof apiManager.callAI !== 'function') {
            if (options.notifyError !== false) this._showStoryNotification('正文生图', '小手机 API 未初始化', '⚠️');
            return { success: false, reason: 'api-unavailable' };
        }

        this.storyTagBusyFloors.add(targetFloor);
        this._refreshStoryImageSurface();
        try {
            this._assertStoryOperationCurrent(targetFloor, source.message, options);
            const messages = await this._buildStoryTagMessages(source, targetFloor);
            const result = await apiManager.callAI(messages, {
                appId: 'story',
                max_tokens: 520,
                stream: false,
                signal: options.signal
            });
            if (result?.aborted || options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            if (result?.success === false) throw new Error(result?.error || '小手机 API 未能生成 TAG');
            const tags = this._cleanStoryTags(result?.summary || result?.content || result?.text || '');
            if (!tags) throw new Error('小手机 API 返回的 TAG 为空');
            this._assertStoryOperationCurrent(targetFloor, source.message, options);
            await this.albumData.setStoryFloorTags(targetFloor, tags, source.message);
            this.storyImageOverlay.clearTagDraft(targetFloor);
            this.storyImageOverlay.showTagBack(targetFloor);
            if (options.notifySuccess !== false) {
                this._showStoryNotification('正文生图', `第 ${targetFloor} 楼 TAG 已生成`, '✅');
            }
            return { success: true, floor: targetFloor, tags, message: source.message };
        } catch (error) {
            const aborted = options.signal?.aborted === true || error?.name === 'AbortError';
            const stale = error?.code === 'STORY_FLOOR_STALE';
            if (aborted) return { success: false, reason: 'aborted', aborted: true, error };
            if (stale) return { success: false, reason: 'stale-floor', stale: true, error };
            console.error('正文生图 TAG 生成失败:', error);
            if (options.notifyError !== false) {
                this._showStoryNotification('TAG 生成失败', String(error?.message || error || '未知错误'), '❌');
            }
            return { success: false, reason: 'request-failed', error };
        } finally {
            this.storyTagBusyFloors.delete(targetFloor);
            this._refreshStoryImageSurface();
        }
    }

    async saveStoryTags(floor, rawTags = '', options = {}) {
        const targetFloor = Number(floor);
        if (!Number.isInteger(targetFloor)) return { success: false, reason: 'invalid-floor' };
        const target = this.albumData.getStoryFloor(targetFloor);
        if (!target) return { success: false, reason: 'missing-floor' };
        if (options.expectedMessage && target.message !== options.expectedMessage) {
            return { success: false, reason: 'stale-floor', stale: true };
        }

        const tags = this._cleanStoryTags(rawTags);
        if (!tags) {
            if (options.notifyError !== false) this._showStoryNotification('正文生图', '生图 TAG 不能为空', '⚠️');
            return { success: false, reason: 'empty-tags' };
        }

        try {
            await this.albumData.setStoryFloorTags(targetFloor, tags, target.message);
            if (options.notifySuccess !== false) {
                this._showStoryNotification('正文生图', `第 ${targetFloor} 楼 TAG 已保存`, '✅');
            }
            return { success: true, floor: targetFloor, tags, message: target.message };
        } catch (error) {
            console.error('正文生图 TAG 保存失败:', error);
            if (options.notifyError !== false) {
                this._showStoryNotification('TAG 保存失败', String(error?.message || error || '未知错误'), '❌');
            }
            return { success: false, reason: 'save-failed', error };
        }
    }

    async generateStoryImage(floor, rawTags = '', options = {}) {
        const targetFloor = Number(floor);
        if (!Number.isInteger(targetFloor)) return { success: false, reason: 'invalid-floor' };
        if (this.isStoryImageBusy(targetFloor) || this.isStoryTagBusy(targetFloor)) {
            return { success: false, reason: 'busy', busy: true };
        }
        const settings = this.albumData.getStoryImageSettings();

        const target = this.albumData.getStoryFloor(targetFloor);
        const tags = this._cleanStoryTags(rawTags || target?.tags || '');
        if (!target) {
            if (options.notifyError !== false) this._showStoryNotification('正文生图', '当前正文楼层不存在', '⚠️');
            return { success: false, reason: 'missing-floor' };
        }
        if (options.expectedMessage && target.message !== options.expectedMessage) {
            return { success: false, reason: 'stale-floor', stale: true };
        }
        if (!tags) {
            if (options.notifyError !== false) this._showStoryNotification('正文生图', '请先生成或填写生图 TAG', '⚠️');
            return { success: false, reason: 'empty-tags' };
        }

        const imageGenerationManager = window.VirtualPhone?.imageGenerationManager;
        if (!imageGenerationManager || typeof imageGenerationManager.generate !== 'function') {
            if (options.notifyError !== false) this._showStoryNotification('正文生图', '生图管理器未初始化', '⚠️');
            return { success: false, reason: 'image-api-unavailable' };
        }
        if (this.storage && imageGenerationManager.storage !== this.storage) {
            imageGenerationManager.storage = this.storage;
        }

        this.storyImageBusyFloors.add(targetFloor);
        this.storyImageOverlay.setTagDraft(targetFloor, tags);
        this._refreshStoryImageSurface();
        let storedImageUrl = '';
        let imageAttached = false;
        try {
            this._assertStoryOperationCurrent(targetFloor, target.message, options);
            await this.albumData.setStoryFloorTags(targetFloor, tags, target.message);
            const result = await imageGenerationManager.generate({
                app: 'story',
                prompt: tags,
                signal: options.signal
            });
            this._assertStoryOperationCurrent(targetFloor, target.message, options);
            if (String(result?.mediaType || '').trim().toLowerCase() === 'video') {
                throw new Error('正文生图当前只支持图片结果');
            }
            const rawImageUrl = String(result?.imageUrl || result?.imageData || '').trim();
            storedImageUrl = await this._persistStoryGeneratedImage(rawImageUrl, targetFloor, options);
            this._assertStoryOperationCurrent(targetFloor, target.message, options);
            await this.albumData.attachStoryFloorImage(targetFloor, storedImageUrl, {
                tags,
                provider: result?.provider,
                model: result?.model
            }, target.message);
            imageAttached = true;
            this.storyImageOverlay.clearTagDraft(targetFloor);
            this.storyImageOverlay.showImageFront(targetFloor);
            if (settings.autoPreviewEnabled) {
                await this._openGeneratedStoryImage(targetFloor, target.message);
            }
            return {
                success: true,
                floor: targetFloor,
                tags,
                imageUrl: storedImageUrl,
                message: target.message,
                provider: result?.provider,
                model: result?.model
            };
        } catch (error) {
            if (storedImageUrl && !imageAttached) {
                Promise.resolve(
                    window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(storedImageUrl, { quiet: true })
                ).catch(() => {});
            }
            const aborted = options.signal?.aborted === true || error?.name === 'AbortError';
            const stale = error?.code === 'STORY_FLOOR_STALE';
            if (aborted) return { success: false, reason: 'aborted', aborted: true, error };
            if (stale) return { success: false, reason: 'stale-floor', stale: true, error };
            console.error('正文楼层图片生成失败:', error);
            if (options.notifyError !== false) {
                this._showStoryNotification('生图失败', String(error?.message || error || '未知错误'), '❌');
            }
            return { success: false, reason: 'request-failed', error };
        } finally {
            this.storyImageBusyFloors.delete(targetFloor);
            this._refreshStoryImageSurface();
        }
    }

    async _persistStoryGeneratedImage(imageUrl, floor, options = {}) {
        const safeUrl = String(imageUrl || '').trim();
        if (!safeUrl) throw new Error('接口返回成功，但没有拿到图片地址');
        if (/^\/backgrounds\/phone_[^?#]+/i.test(safeUrl)) return safeUrl;

        const uploader = window.VirtualPhone?.imageManager;
        if (!uploader) throw new Error('图片上传管理器未初始化，无法保存正文生图');
        const prefix = `story_image_${Number(floor)}_${Date.now()}`;
        let storedUrl = '';
        if (safeUrl.startsWith('data:image/')) {
            if (typeof uploader._uploadToServer !== 'function') {
                throw new Error('图片上传管理器不支持保存生图结果');
            }
            storedUrl = await uploader._uploadToServer(safeUrl, prefix, {
                allowBase64Fallback: false,
                skipExistenceCheck: true,
                signal: options.signal
            });
        } else {
            if (typeof uploader.uploadBlob !== 'function') {
                throw new Error('图片上传管理器不支持保存远程生图结果');
            }
            const response = await fetch(safeUrl, { cache: 'no-store', signal: options.signal });
            if (!response.ok) throw new Error(`读取生图结果失败（HTTP ${response.status}）`);
            const blob = await response.blob();
            if (!String(blob.type || '').toLowerCase().startsWith('image/')) {
                throw new Error('生图接口返回的内容不是有效图片');
            }
            storedUrl = await uploader.uploadBlob(blob, prefix, {
                skipExistenceCheck: true,
                signal: options.signal
            });
        }

        const normalized = String(storedUrl || '').trim();
        if (!/^\/backgrounds\/phone_[^?#]+/i.test(normalized)) {
            throw new Error('正文生图保存失败：未得到有效本地图片路径');
        }
        return normalized;
    }

    handleSwipeBack(event) {
        const domCurrentView = document.querySelector('.phone-view-current');
        if (!domCurrentView?.querySelector?.('.album-app')) return false;

        if (event?.detail && typeof event.detail === 'object') {
            event.detail.handled = true;
        }

        if (this.albumView.currentView === 'settings') {
            this.albumView.currentView = 'main';
            this.albumView.render();
            return true;
        }

        if (this.albumView.previewOpen) {
            this.albumView.closePreview();
            return true;
        }

        if (this.albumView.sourceMenuOpen) {
            this.albumView.closeSourceMenu();
            return true;
        }

        if (this.albumView.selectionMode) {
            this.albumView.selectionMode = false;
            this.albumView.selectedPaths.clear();
            this.albumView.render();
            return true;
        }

        if (this.albumView.activeSource !== 'all') {
            this.albumView.activeSource = 'all';
            this.albumView.render();
            return true;
        }

        window.dispatchEvent(new CustomEvent('phone:goHome'));
        return true;
    }

    refreshIfVisible() {
        this.storyImageOverlay?.refresh();
        if (this.albumView?.isBulkDeleting) return;
        const domCurrentView = document.querySelector('.phone-view-current');
        if (!domCurrentView?.querySelector?.('.album-app')) return;
        this.albumView.render();
    }

    deactivate() {
        this.albumView?.closePreview?.();
        if (this.albumView) this.albumView.currentView = 'main';
    }
}
