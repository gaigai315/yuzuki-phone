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
        this._onKeyDown = event => {
            if (event.key === 'Escape') this.close();
        };
        this._onResize = () => {
            const root = document.getElementById(STORY_OVERLAY_ROOT_ID);
            const stage = root?.querySelector('.phone-story-image-stage');
            const image = stage?.querySelector('.phone-story-image-front img');
            if (image?.complete && image.naturalWidth > 0) this.fitImageStage(image);
            else if (stage) this.fitEmptyStage(stage);
        };
    }

    getRoot() {
        let root = document.getElementById(STORY_OVERLAY_ROOT_ID);
        if (root) return root;

        root = document.createElement('div');
        root.id = STORY_OVERLAY_ROOT_ID;
        root.setAttribute('aria-hidden', 'true');
        document.documentElement.appendChild(root);
        return root;
    }

    open(options = {}) {
        this.isOpen = true;
        this.setActiveFloor(options.floor);
        document.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('resize', this._onResize);
        this.render();
    }

    close() {
        this.isOpen = false;
        document.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('resize', this._onResize);
        document.getElementById(STORY_OVERLAY_ROOT_ID)?.remove();
    }

    refresh() {
        if (this.isOpen) this.render();
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
                    <button type="button" class="phone-story-image-close" aria-label="关闭正文生图" title="关闭">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
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
                                ${hasTags ? `
                                    <button type="button" class="phone-story-image-flip" aria-label="${showTagBack ? '返回图片正面' : `查看 #${floor.floor} 的 Tags`}" title="${showTagBack ? '返回图片' : '查看 Tags'}">
                                        <i class="fa-solid fa-rotate" aria-hidden="true"></i>
                                    </button>
                                ` : ''}
                            </div>
                            <button type="button" class="phone-story-image-nav is-next" aria-label="下一正文楼层" ${floorIndex >= floors.length - 1 || anyBusy ? 'disabled' : ''}>
                                <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                            </button>
                        </div>
                        <div class="phone-story-image-actions">
                            <button type="button" class="phone-story-image-action is-tag" ${anyBusy ? 'disabled' : ''}>
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

        this.bindEvents(root, floors, floor, floorIndex);
        this.bindImageStage(root);
    }

    bindImageStage(root) {
        const stage = root.querySelector('.phone-story-image-stage');
        if (!stage) return;
        const image = root.querySelector('.phone-story-image-front img');
        if (!image) {
            this.fitEmptyStage(stage);
            return;
        }

        const fit = () => {
            if (image.naturalWidth > 0 && image.naturalHeight > 0) this.fitImageStage(image);
            else this.fitEmptyStage(stage);
        };
        image.addEventListener('load', fit, { once: true });
        image.addEventListener('error', () => this.fitEmptyStage(stage), { once: true });
        if (image.complete) fit();
    }

    getStageFitBounds(stage) {
        const wrap = stage?.closest?.('.phone-story-image-stage-wrap');
        const root = stage?.closest?.(`#${STORY_OVERLAY_ROOT_ID}`);
        const card = stage?.closest?.('.phone-story-image-card');
        const body = stage?.closest?.('.phone-story-image-card-body');
        if (!stage || !wrap || !root || !card || !body) return null;

        const viewportHeight = Math.max(1, Number(window.innerHeight || document.documentElement?.clientHeight || 800));
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
        const availableHeight = Math.max(240, viewportHeight - reservedHeight);
        const maxHeight = Math.min(availableHeight, 900);
        return { maxWidth, maxHeight };
    }

    fitEmptyStage(stage) {
        const bounds = this.getStageFitBounds(stage);
        if (!bounds) return;
        stage.style.setProperty('--phone-story-image-empty-height', `${Math.round(bounds.maxHeight)}px`);
        stage.classList.add('has-fitted-empty');
    }

    fitImageStage(image) {
        const stage = image?.closest?.('.phone-story-image-stage');
        const naturalWidth = Number(image?.naturalWidth || 0);
        const naturalHeight = Number(image?.naturalHeight || 0);
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
        root.querySelector('.phone-story-image-close')?.addEventListener('click', () => this.close());
        if (!floor) return;

        const navigate = offset => {
            const target = floors[floorIndex + offset];
            if (!target) return;
            this.activeFloor = target.floor;
            this.render();
        };
        root.querySelector('.phone-story-image-nav.is-prev')?.addEventListener('click', () => navigate(-1));
        root.querySelector('.phone-story-image-nav.is-next')?.addEventListener('click', () => navigate(1));

        const stage = root.querySelector('.phone-story-image-stage');
        root.querySelector('.phone-story-image-flip')?.addEventListener('click', event => {
            const showBack = !stage?.classList.contains('is-showing-back');
            if (showBack) this.showTagBack(floor.floor);
            else this.showImageFront(floor.floor);
            stage?.classList.toggle('is-showing-back', showBack);
            event.currentTarget.setAttribute('aria-label', showBack ? '返回图片正面' : `查看 #${floor.floor} 的 Tags`);
            event.currentTarget.setAttribute('title', showBack ? '返回图片' : '查看 Tags');
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
        root.querySelector('.phone-story-image-action.is-tag')?.addEventListener('click', () => {
            this.editingTagFloors.delete(floor.floor);
            this.app.generateStoryTags(floor.floor);
        });
        root.querySelector('.phone-story-image-action.is-image')?.addEventListener('click', () => {
            this.editingTagFloors.delete(floor.floor);
            this.app.generateStoryImage(floor.floor, tagsInput?.value || floor.tags);
        });
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
