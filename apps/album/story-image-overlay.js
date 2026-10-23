/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

const STORY_OVERLAY_ROOT_ID = 'phone-story-image-overlay-root';
const STORY_PROVIDER_LABELS = Object.freeze({
    novelai: 'NovelAI',
    openai: 'OpenAI',
    siliconflow: '硅基流动',
    sd: 'Stable Diffusion',
    comfyui: 'ComfyUI'
});

export class StoryImageOverlay {
    constructor(app) {
        this.app = app;
        this.activeFloor = null;
        this.tagDrafts = new Map();
        this.tagBackFloors = new Set();
        this.editingTagFloors = new Set();
        this.isOpen = false;
        this._fitFrameIds = [];
        this._imageDimensions = new Map();
        this._imagePreloads = new Map();
        this._navigationRequestId = 0;
        this._onKeyDown = event => {
            if (event.key === 'Escape') {
                const menu = document.querySelector(`#${STORY_OVERLAY_ROOT_ID} .phone-story-image-menu[open]`);
                if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); }
                else this.close();
            }
        };
        this._onRootClick = event => {
            event.stopPropagation();
            if (!event.target.closest?.('.phone-story-image-menu')) {
                event.currentTarget.querySelector?.('.phone-story-image-menu[open]')?.removeAttribute('open');
            }
            if (event.target === event.currentTarget) this.close();
        };
        this._onResize = () => this.scheduleStageFit();
    }

    getRoot() {
        let root = document.getElementById(STORY_OVERLAY_ROOT_ID);
        if (root) return root;

        root = document.createElement('div');
        root.id = STORY_OVERLAY_ROOT_ID;
        root.setAttribute('aria-hidden', 'true');
        const stopHostTouchGesture = event => event.stopPropagation();
        root.addEventListener('click', this._onRootClick);
        root.addEventListener('touchstart', stopHostTouchGesture, { passive: true });
        root.addEventListener('touchmove', stopHostTouchGesture, { passive: true });
        document.documentElement.appendChild(root);
        return root;
    }

    open(options = {}) {
        this._navigationRequestId += 1;
        this.isOpen = true;
        const requestedFloor = Number.parseInt(String(options.floor ?? ''), 10);
        if (!Number.isInteger(requestedFloor)) this.activeFloor = null;
        this.setActiveFloor(requestedFloor);
        document.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('resize', this._onResize);
        window.visualViewport?.addEventListener?.('resize', this._onResize);
        this.render();
    }

    close() {
        this._navigationRequestId += 1;
        this.isOpen = false;
        document.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('resize', this._onResize);
        window.visualViewport?.removeEventListener?.('resize', this._onResize);
        this.cancelScheduledStageFit();
        document.getElementById(STORY_OVERLAY_ROOT_ID)?.remove();
    }

    refresh() {
        if (!this.isOpen) return;
        this._navigationRequestId += 1;
        this.render();
    }

    setActiveFloor(requestedFloor = null) {
        const floors = this.app.albumData.getStoryFloors();
        if (floors.length === 0) {
            this.activeFloor = null;
            return null;
        }

        const parsedFloor = Number.parseInt(String(requestedFloor ?? ''), 10);
        const requested = Number.isInteger(parsedFloor)
            ? floors.find(item => item.floor === parsedFloor)
            : null;
        const current = floors.find(item => item.floor === this.activeFloor);
        const target = requested || current || floors.at(-1);
        this.activeFloor = target.floor;
        return target;
    }

    setTagDraft(floor, value) {
        const targetFloor = Number(floor);
        if (!Number.isInteger(targetFloor)) return;
        this.tagDrafts.set(targetFloor, String(value || ''));
    }

    clearTagDraft(floor) {
        this.tagDrafts.delete(Number(floor));
    }

    showTagBack(floor) {
        const targetFloor = Number(floor);
        if (Number.isInteger(targetFloor)) this.tagBackFloors.add(targetFloor);
    }

    showImageFront(floor) {
        this.tagBackFloors.delete(Number(floor));
    }

    getTagDraft(floor, fallback = '') {
        const targetFloor = Number(floor);
        return this.tagDrafts.has(targetFloor)
            ? this.tagDrafts.get(targetFloor)
            : String(fallback || '');
    }

    _getImageDimensions(imageUrl = '') {
        return this._imageDimensions.get(String(imageUrl || '').trim()) || null;
    }

    _preloadStoryImage(imageUrl = '') {
        const safeUrl = String(imageUrl || '').trim();
        if (!safeUrl || typeof Image !== 'function') return Promise.resolve(null);

        const cached = this._getImageDimensions(safeUrl);
        if (cached) return Promise.resolve(cached);
        const pending = this._imagePreloads.get(safeUrl);
        if (pending) return pending;

        let preloadPromise;
        preloadPromise = new Promise(resolve => {
            const image = new Image();
            const finish = dimensions => resolve(dimensions);
            image.decoding = 'async';
            image.onload = () => {
                const dimensions = {
                    width: Number(image.naturalWidth || 0),
                    height: Number(image.naturalHeight || 0)
                };
                if (dimensions.width > 0 && dimensions.height > 0) {
                    this._imageDimensions.set(safeUrl, dimensions);
                }
                const decode = typeof image.decode === 'function'
                    ? Promise.resolve(image.decode()).catch(() => {})
                    : Promise.resolve();
                decode.then(() => finish(this._getImageDimensions(safeUrl)));
            };
            image.onerror = () => finish(null);
            image.src = safeUrl;
        }).finally(() => {
            if (this._imagePreloads.get(safeUrl) === preloadPromise) {
                this._imagePreloads.delete(safeUrl);
            }
        });
        this._imagePreloads.set(safeUrl, preloadPromise);
        return preloadPromise;
    }

    _preloadAdjacentStoryImages(floors = [], floorIndex = -1) {
        [floorIndex - 1, floorIndex, floorIndex + 1].forEach(index => {
            const imageUrl = floors[index]?.imageUrl;
            if (imageUrl) void this._preloadStoryImage(imageUrl);
        });
    }

    async _navigateToStoryFloor(target, root = null) {
        if (!target) return false;
        const requestId = ++this._navigationRequestId;
        root?.querySelectorAll?.('.phone-story-image-nav')?.forEach(button => {
            button.disabled = true;
        });
        await this._preloadStoryImage(target.imageUrl);
        if (!this.isOpen || requestId !== this._navigationRequestId) return false;
        this.activeFloor = target.floor;
        this.render();
        return true;
    }

    render() {
        if (!this.isOpen) return;

        const floors = this.app.albumData.getStoryFloors();
        const floor = this.setActiveFloor(this.activeFloor);
        const floorIndex = floor ? floors.findIndex(item => item.floor === floor.floor) : -1;
        const tags = floor ? this.getTagDraft(floor.floor, floor.tags) : '';
        const hasTags = !!String(tags || '').trim();
        const tagBusy = floor ? this.app.isStoryTagBusy(floor.floor) : false;
        const imageBusy = floor ? this.app.isStoryImageBusy(floor.floor) : false;
        const anyBusy = tagBusy || imageBusy;
        const tagGenerationDisabled = anyBusy || floor?.promptExcluded === true;
        const showTagBack = floor && hasTags && this.tagBackFloors.has(floor.floor);
        const editingTags = !!floor && !anyBusy && this.editingTagFloors.has(floor.floor);
        const currentProvider = floor
            ? (this.app.getCurrentStoryImageProvider?.() || floor.provider || '')
            : '';
        const providerLabel = STORY_PROVIDER_LABELS[currentProvider] || currentProvider;
        const root = this.getRoot();

        root.setAttribute('aria-hidden', 'false');
        root.innerHTML = `
            <section class="phone-story-image-card" role="dialog" aria-modal="false" aria-label="正文生图">
                <header class="phone-story-image-card-header">
                    <span class="phone-story-image-header-spacer" aria-hidden="true"></span>
                    <strong class="phone-story-image-floor-label">${floor ? `第${floor.floor}楼` : '正文生图'}</strong>
                    <span class="phone-story-image-header-spacer" aria-hidden="true"></span>
                </header>
                <div class="phone-story-image-card-body">
                    ${floor ? `
                        <div class="phone-story-image-stage-wrap">
                            <button type="button" class="phone-story-image-nav is-prev" aria-label="上一正文楼层" ${floorIndex <= 0 || anyBusy ? 'disabled' : ''}>
                                <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                            </button>
                            <div class="phone-story-image-stage${showTagBack ? ' is-showing-back' : ''}">
                                <div class="phone-story-image-face phone-story-image-front${floor.imageUrl ? ' has-image' : ' is-empty'}">
                                    ${floor.imageUrl ? `
                                        <img src="${this.escapeAttr(floor.imageUrl)}" alt="#${floor.floor} 正文生图">
                                    ` : `
                                        <span class="phone-story-image-empty-icon" aria-hidden="true"><i class="fa-regular fa-image"></i></span>
                                        <strong>这一楼还没有图片</strong>
                                    `}
                                </div>
                                <div class="phone-story-image-face phone-story-image-back">
                                    <div class="phone-story-image-back-heading">
                                        <strong>Tags</strong>
                                        <div class="phone-story-image-back-tools">
                                            <button type="button" class="phone-story-image-tag-edit${editingTags ? ' is-editing' : ''}" aria-label="${editingTags ? '保存 Tags' : '编辑 Tags'}" title="${editingTags ? '保存 Tags' : '编辑 Tags'}" ${anyBusy ? 'disabled' : ''}>
                                                <i class="fa-solid ${editingTags ? 'fa-check' : 'fa-pencil'}" aria-hidden="true"></i>
                                            </button>
                                            ${providerLabel ? `<small class="phone-story-image-provider" title="当前正文生图供应商：${this.escapeAttr(providerLabel)}">${this.escapeHtml(providerLabel)}</small>` : ''}
                                        </div>
                                    </div>
                                    <textarea class="phone-story-image-tags" rows="8" placeholder="生成的 Tags 会显示在这里" ${editingTags ? '' : 'readonly'} ${anyBusy ? 'disabled' : ''}>${this.escapeHtml(tags)}</textarea>
                                </div>
                                ${showTagBack ? `
                                    <button type="button" class="phone-story-image-return" aria-label="返回图片正面" title="返回图片">
                                        <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
                                    </button>
                                ` : (hasTags || floor.imageUrl ? `
                                    <details class="phone-story-image-menu">
                                        <summary class="phone-story-image-more" aria-label="图片操作" title="图片操作"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></summary>
                                        <div class="phone-story-image-menu-items">
                                            ${hasTags ? `<button type="button" class="phone-story-image-flip"><i class="fa-solid fa-rotate" aria-hidden="true"></i><span>查看 Tags</span></button>` : ''}
                                            ${floor.imageUrl ? `
                                                <button type="button" class="phone-story-image-delete" ${anyBusy ? 'disabled' : ''}><i class="fa-solid fa-trash-can" aria-hidden="true"></i>删除图片</button>
                                                <button type="button" class="phone-story-image-download"><i class="fa-solid fa-download" aria-hidden="true"></i>下载图片</button>
                                            ` : ''}
                                        </div>
                                    </details>
                                ` : '')}
                            </div>
                            <button type="button" class="phone-story-image-nav is-next" aria-label="下一正文楼层" ${floorIndex >= floors.length - 1 || anyBusy ? 'disabled' : ''}>
                                <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                            </button>
                        </div>
                        <div class="phone-story-image-actions">
                            <button type="button" class="phone-story-image-action is-tag" ${tagGenerationDisabled ? 'disabled' : ''} ${floor.promptExcluded ? 'title="该楼层已从提示词中排除"' : ''}>
                                <span class="phone-story-image-action-icon">
                                    <i class="fa-solid ${tagBusy ? 'fa-spinner fa-spin' : 'fa-pencil'}" aria-hidden="true"></i>
                                </span>
                                <span>${tagBusy ? '正在生成 Tags' : '生成 Tags'}</span>
                            </button>
                            <button type="button" class="phone-story-image-action is-image" ${anyBusy || !hasTags ? 'disabled' : ''}>
                                <span class="phone-story-image-action-icon">
                                    <i class="${imageBusy ? 'fa-solid fa-spinner fa-spin' : 'fa-regular fa-image'}" aria-hidden="true"></i>
                                </span>
                                <span>${imageBusy ? '正在生成图片' : '生成图片'}</span>
                            </button>
                        </div>
                    ` : `
                        <div class="phone-story-image-no-floor">
                            <span aria-hidden="true"><i class="fa-regular fa-file-lines"></i></span>
                            <strong>当前聊天还没有正文楼层</strong>
                        </div>
                    `}
                </div>
            </section>
        `;

        const cachedDimensions = floor ? this._getImageDimensions(floor.imageUrl) : null;
        if (cachedDimensions) {
            this.fitImageStageDimensions(
                root.querySelector('.phone-story-image-stage'),
                cachedDimensions.width,
                cachedDimensions.height
            );
        }
        this.bindEvents(root, floors, floor, floorIndex);
        this.bindImageStage(root);
        this.scheduleStageFit();
        this._preloadAdjacentStoryImages(floors, floorIndex);
    }

    cancelScheduledStageFit() {
        this._fitFrameIds.forEach(frameId => cancelAnimationFrame(frameId));
        this._fitFrameIds = [];
    }

    scheduleStageFit() {
        this.cancelScheduledStageFit();
        if (!this.isOpen) return;

        const fitCurrentStage = () => {
            if (!this.isOpen) return;
            const root = document.getElementById(STORY_OVERLAY_ROOT_ID);
            const stage = root?.querySelector('.phone-story-image-stage');
            const image = stage?.querySelector('.phone-story-image-front img');
            if (image?.complete && image.naturalWidth > 0) this.fitImageStage(image);
            else if (image && this._getImageDimensions(image.getAttribute('src'))) {
                const dimensions = this._getImageDimensions(image.getAttribute('src'));
                this.fitImageStageDimensions(stage, dimensions.width, dimensions.height);
            } else if (stage) this.fitEmptyStage(stage);
        };

        const firstFrame = requestAnimationFrame(() => {
            fitCurrentStage();
            const secondFrame = requestAnimationFrame(() => {
                fitCurrentStage();
                this._fitFrameIds = [];
            });
            this._fitFrameIds = [secondFrame];
        });
        this._fitFrameIds = [firstFrame];
    }

    bindImageStage(root) {
        const stage = root.querySelector('.phone-story-image-stage');
        if (!stage) return;
        const image = root.querySelector('.phone-story-image-front img');
        if (!image) {
            this.scheduleStageFit();
            return;
        }

        const fit = () => {
            if (image.naturalWidth > 0 && image.naturalHeight > 0) this.fitImageStage(image);
            else this.fitEmptyStage(stage);
        };
        image.addEventListener('load', fit, { once: true });
        image.addEventListener('error', () => {
            this._imageDimensions.delete(String(image.getAttribute('src') || '').trim());
            this.fitEmptyStage(stage);
        }, { once: true });
        if (image.complete) this.scheduleStageFit();
    }

    getStageFitBounds(stage) {
        const wrap = stage?.closest?.('.phone-story-image-stage-wrap');
        const root = stage?.closest?.(`#${STORY_OVERLAY_ROOT_ID}`);
        const card = stage?.closest?.('.phone-story-image-card');
        const body = stage?.closest?.('.phone-story-image-card-body');
        if (!stage || !wrap || !root || !card || !body) return null;

        const viewportHeight = Math.max(1, Number(
            window.visualViewport?.height
            || window.innerHeight
            || document.documentElement?.clientHeight
            || 800
        ));
        const maxWidth = Math.max(1, Number(wrap.clientWidth || stage.clientWidth || 560));
        const readPixels = value => Number.parseFloat(String(value || '')) || 0;
        const outerHeight = element => {
            if (!element) return 0;
            const style = window.getComputedStyle(element);
            return element.getBoundingClientRect().height
                + readPixels(style.marginTop)
                + readPixels(style.marginBottom);
        };
        const rootStyle = window.getComputedStyle(root);
        const bodyStyle = window.getComputedStyle(body);
        const reservedHeight = readPixels(rootStyle.paddingTop)
            + readPixels(rootStyle.paddingBottom)
            + outerHeight(card.querySelector('.phone-story-image-card-header'))
            + readPixels(bodyStyle.paddingTop)
            + readPixels(bodyStyle.paddingBottom)
            + outerHeight(card.querySelector('.phone-story-image-actions'))
            + 12;
        const availableHeight = Math.max(160, viewportHeight - reservedHeight);
        const maxHeight = Math.min(availableHeight, 900);
        return { maxWidth, maxHeight };
    }

    fitEmptyStage(stage) {
        const bounds = this.getStageFitBounds(stage);
        if (!bounds) return;
        let configuredWidth = 832;
        let configuredHeight = 1216;
        try {
            const config = window.VirtualPhone?.imageGenerationManager?.getConfig?.({ app: 'story' });
            const width = Number(config?.width);
            const height = Number(config?.height);
            if (width > 0 && height > 0) {
                configuredWidth = width;
                configuredHeight = height;
            }
        } catch (_error) {
            // Keep the story image defaults when provider configuration is unavailable.
        }
        const ratio = configuredWidth / configuredHeight;
        const width = Math.min(bounds.maxWidth, bounds.maxHeight * ratio);
        const height = width / ratio;
        stage.style.setProperty('--phone-story-image-empty-width', `${Math.round(width)}px`);
        stage.style.setProperty('--phone-story-image-empty-height', `${Math.round(height)}px`);
        stage.classList.add('has-fitted-empty');
    }

    fitImageStage(image) {
        const stage = image?.closest?.('.phone-story-image-stage');
        const naturalWidth = Number(image?.naturalWidth || 0);
        const naturalHeight = Number(image?.naturalHeight || 0);
        const imageUrl = String(image?.getAttribute?.('src') || '').trim();
        if (imageUrl && naturalWidth > 0 && naturalHeight > 0) {
            this._imageDimensions.set(imageUrl, { width: naturalWidth, height: naturalHeight });
        }
        this.fitImageStageDimensions(stage, naturalWidth, naturalHeight);
    }

    fitImageStageDimensions(stage, naturalWidth, naturalHeight) {
        const bounds = this.getStageFitBounds(stage);
        if (!stage || !bounds || naturalWidth <= 0 || naturalHeight <= 0) return;

        const ratio = naturalWidth / naturalHeight;
        const width = Math.min(bounds.maxWidth, bounds.maxHeight * ratio);
        const height = width / ratio;

        stage.classList.remove('has-fitted-empty');
        stage.style.setProperty('--phone-story-image-fitted-width', `${Math.round(width)}px`);
        stage.style.setProperty('--phone-story-image-fitted-height', `${Math.round(height)}px`);
        stage.classList.add('has-loaded-image');
    }

    bindEvents(root, floors, floor, floorIndex) {
        if (!floor) return;

        const navigate = offset => {
            const target = floors[floorIndex + offset];
            if (!target) return;
            void this._navigateToStoryFloor(target, root);
        };
        root.querySelector('.phone-story-image-nav.is-prev')?.addEventListener('click', () => navigate(-1));
        root.querySelector('.phone-story-image-nav.is-next')?.addEventListener('click', () => navigate(1));

        root.querySelector('.phone-story-image-flip')?.addEventListener('click', () => {
            this.showTagBack(floor.floor);
            this.render();
        });
        root.querySelector('.phone-story-image-return')?.addEventListener('click', () => {
            this.showImageFront(floor.floor);
            this.render();
        });

        const tagsInput = root.querySelector('.phone-story-image-tags');
        const editButton = root.querySelector('.phone-story-image-tag-edit');
        const setEditingState = editing => {
            if (!tagsInput || !editButton) return;
            tagsInput.readOnly = !editing;
            editButton.classList.toggle('is-editing', editing);
            editButton.setAttribute('aria-label', editing ? '保存 Tags' : '编辑 Tags');
            editButton.setAttribute('title', editing ? '保存 Tags' : '编辑 Tags');
            const icon = editButton.querySelector('i');
            icon?.classList.toggle('fa-pencil', !editing);
            icon?.classList.toggle('fa-check', editing);
        };

        tagsInput?.addEventListener('input', () => {
            this.setTagDraft(floor.floor, tagsInput.value);
            const imageButton = root.querySelector('.phone-story-image-action.is-image');
            if (imageButton) imageButton.disabled = !String(tagsInput.value || '').trim();
        });
        editButton?.addEventListener('click', async () => {
            if (!this.editingTagFloors.has(floor.floor)) {
                this.editingTagFloors.add(floor.floor);
                setEditingState(true);
                tagsInput?.focus();
                tagsInput?.setSelectionRange?.(tagsInput.value.length, tagsInput.value.length);
                return;
            }

            editButton.disabled = true;
            const result = await this.app.saveStoryTags(floor.floor, tagsInput?.value || '', {
                expectedMessage: floor.message
            });
            editButton.disabled = false;
            if (!result?.success) return;
            if (tagsInput) tagsInput.value = result.tags;
            this.clearTagDraft(floor.floor);
            this.editingTagFloors.delete(floor.floor);
            setEditingState(false);
        });
        root.querySelector('.phone-story-image-action.is-tag')?.addEventListener('click', async () => {
            this.editingTagFloors.delete(floor.floor);
            const tagsResult = await this.app.generateStoryTags(floor.floor, {
                expectedMessage: floor.message
            });
            if (!tagsResult?.success) return;

            const settings = this.app.albumData.getStoryImageSettings();
            if (!settings.manualTagsAutoImageEnabled) return;
            await this.app.generateStoryImage(floor.floor, tagsResult.tags, {
                expectedMessage: floor.message
            });
        });
        root.querySelector('.phone-story-image-action.is-image')?.addEventListener('click', () => {
            this.editingTagFloors.delete(floor.floor);
            this.app.generateStoryImage(floor.floor, tagsInput?.value || floor.tags);
        });
        root.querySelector('.phone-story-image-delete')?.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            const button = event.currentTarget;
            button.disabled = true;
            root.querySelector('.phone-story-image-menu')?.removeAttribute('open');
            try {
                await this.deleteStoryImage(floor);
            } catch (error) {
                this.app._showStoryNotification?.('正文生图', `删除失败：${error?.message || error}`, '⚠️');
            } finally {
                if (button.isConnected) button.disabled = false;
            }
        });
        root.querySelector('.phone-story-image-download')?.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            const button = event.currentTarget;
            button.disabled = true;
            try {
                root.querySelector('.phone-story-image-menu')?.removeAttribute('open');
                await this.downloadStoryImage(floor);
            } catch (error) {
                console.error('[StoryImageOverlay] 正文图片下载失败:', error);
                this.app._showStoryNotification?.(
                    '正文生图',
                    `图片下载失败：${String(error?.message || error || '未知错误')}`,
                    '⚠️'
                );
            } finally {
                if (button.isConnected) button.disabled = false;
            }
        });
    }

    async deleteStoryImage(floor = {}) {
        if (this._deletingStoryImage || this.app.isStoryImageBusy(floor.floor) || this.app.isStoryTagBusy(floor.floor)) return false;
        const current = this.app.albumData.getStoryFloor(floor.floor);
        if (!current || current.message !== floor.message || current.imageUrl !== floor.imageUrl || !current.imageUrl) return false;
        if (!window.confirm('删除当前图片吗？相册中的这张图片及其引用也会移除，Tags 会保留，可手动重新生成。')) return false;
        this._deletingStoryImage = true;
        try {
            const result = await this.app.albumData.deleteImage(current.imageUrl);
            if (!result?.success) throw new Error(result?.message || '图片删除失败');
            this._imageDimensions.delete(current.imageUrl);
            this._imagePreloads.delete(current.imageUrl);
            this.refresh();
            window.dispatchEvent(new CustomEvent('phone:albumImageDeleted'));
            this.app._showStoryNotification?.('正文生图', '图片已删除，Tags 已保留', '✅');
            return true;
        } finally {
            this._deletingStoryImage = false;
        }
    }

    async downloadStoryImage(floor = {}) {
        const imageUrl = String(floor.imageUrl || '').trim();
        if (!imageUrl) throw new Error('当前楼层没有可下载的图片');
        const fileName = this.getStoryImageDownloadName(floor);
        return this.downloadMediaFile(imageUrl, fileName);
    }

    async downloadMediaFile(imageUrl, fileName, { notify = true } = {}) {
        if (this.isTauriRuntime()) {
            const response = await fetch(imageUrl, { credentials: 'include', cache: 'no-store' });
            if (!response.ok) throw new Error(`读取图片失败（HTTP ${response.status}）`);
            const blob = await response.blob();
            const fileExport = await import('/scripts/file-export.js');
            if (typeof fileExport.downloadBlobWithRuntime !== 'function') {
                throw new Error('TT 原生下载模块不可用');
            }
            const result = await fileExport.downloadBlobWithRuntime(blob, fileName, {
                fallbackName: 'story-image.png'
            });
            const destination = String(result?.savedPath || result?.displayName || fileName).trim();
            if (notify) this.app._showStoryNotification?.('相册', `文件已保存：${destination}`, '✅');
            return result;
        }

        const phoneShell = this.app.phoneShell;
        const downloader = typeof phoneShell?.downloadImage === 'function'
            ? phoneShell.downloadImage
            : phoneShell?._downloadImageFromViewer;
        if (typeof downloader === 'function') {
            return downloader.call(phoneShell, imageUrl, fileName);
        }

        const response = await fetch(imageUrl, { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error(`读取图片失败（HTTP ${response.status}）`);
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        return { mode: 'browser', savedPath: '' };
    }

    isTauriRuntime() {
        return typeof window !== 'undefined'
            && typeof window.__TAURI__?.core?.invoke === 'function';
    }

    getStoryImageDownloadName(floor = {}) {
        const imageUrl = String(floor.imageUrl || '').trim();
        const extension = (
            imageUrl.match(/^data:image\/(png|jpe?g|webp|gif|avif)(?:;|,)/i)?.[1]
            || imageUrl.match(/\.((?:png|jpe?g|webp|gif|avif))(?:[?#]|$)/i)?.[1]
            || 'png'
        ).toLowerCase();
        const normalizedExtension = extension === 'jpeg' ? 'jpg' : extension;
        const floorNumber = Number.parseInt(String(floor.floor ?? ''), 10);
        const suffix = Number.isInteger(floorNumber) ? `-${floorNumber}` : '';
        return `story-image${suffix}.${normalizedExtension}`;
    }

    escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    escapeAttr(text) {
        return this.escapeHtml(text).replace(/`/g, '&#96;');
    }
}
