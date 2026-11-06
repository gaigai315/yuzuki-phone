import { parsePhoneHexColor, normalizePhoneHexColor, clampPhoneColorNumber, phoneHexToRgb, phoneRgbToHex, phoneRgbToHsv, phoneHsvToRgb } from '../config/phone-colors.js';

export function bindPhoneColorPickers(settingsRoot, { storage, previewColor, onError }) {
    if (!settingsRoot) return;

    const globalDocument = globalThis.document;
    const triggers = Array.from(settingsRoot.querySelectorAll('.yzp-frame-color-control[data-color-storage-key]'));
    triggers.forEach((trigger) => {
        const storageKey = String(trigger.dataset.colorStorageKey || '').trim();
        const defaultColor = normalizePhoneHexColor(trigger.dataset.colorDefault, '#1a1a1a');
        const pickerTitle = String(trigger.dataset.colorPickerTitle || '选择颜色').trim() || '选择颜色';
        const pickerLabel = String(trigger.dataset.colorPickerLabel || '颜色').trim() || '颜色';
        const previewKind = String(trigger.dataset.colorPreviewKind || 'frame').trim();
        if (!storageKey) return;

        const swatch = trigger.querySelector('.yzp-frame-color-control-swatch');
        const valueLabel = trigger.querySelector('.yzp-frame-color-control-value');
        const setControlColor = (value) => {
            const color = normalizePhoneHexColor(value, defaultColor);
            trigger.dataset.color = color;
            swatch?.style.setProperty('--yzp-frame-control-color', color);
            if (valueLabel) valueLabel.textContent = color;
            return color;
        };
        const applyPreview = (value) => {
            const color = setControlColor(value);
            previewColor(color, previewKind);
            return color;
        };

        applyPreview(storage.get(storageKey) || defaultColor);

        trigger.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            settingsRoot.querySelector('#yzp-frame-color-picker-overlay')?.remove();

            const originalColor = normalizePhoneHexColor(storage.get(storageKey) || trigger.dataset.color, defaultColor);
            let draft = phoneRgbToHsv(phoneHexToRgb(originalColor));

            const overlay = globalDocument.createElement('div');
            overlay.id = 'yzp-frame-color-picker-overlay';
            overlay.className = 'yzp-frame-color-picker-overlay';
            overlay.dataset.noSwipeBack = 'true';
            overlay.innerHTML = `
                <section class="yzp-frame-color-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="yzp-frame-color-picker-title">
                    <header class="yzp-frame-color-picker-header">
                        <h3 id="yzp-frame-color-picker-title">${pickerTitle.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]))}</h3>
                        <button type="button" class="yzp-frame-color-picker-close" aria-label="关闭颜色选择器" title="关闭">
                            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                        </button>
                    </header>
                    <div class="yzp-frame-color-picker-body">
                        <div class="yzp-frame-color-field" role="slider" tabindex="0" aria-label="颜色饱和度与明度">
                            <span class="yzp-frame-color-field-pointer" aria-hidden="true"></span>
                        </div>
                        <div class="yzp-frame-color-hue-row">
                            <span class="yzp-frame-color-preview" aria-hidden="true"></span>
                            <input class="yzp-frame-color-hue phone-gesture-control phone-theme-range" type="range" min="0" max="360" step="1" value="0" aria-label="色相">
                            <input class="yzp-frame-color-hex" type="text" value="${originalColor}" maxlength="7" spellcheck="false" aria-label="十六进制颜色值">
                        </div>
                        <div class="yzp-frame-color-rgb-grid">
                            <label><span>R</span><input data-channel="r" type="number" min="0" max="255" inputmode="numeric" aria-label="红色通道"></label>
                            <label><span>G</span><input data-channel="g" type="number" min="0" max="255" inputmode="numeric" aria-label="绿色通道"></label>
                            <label><span>B</span><input data-channel="b" type="number" min="0" max="255" inputmode="numeric" aria-label="蓝色通道"></label>
                        </div>
                    </div>
                    <footer class="yzp-frame-color-picker-footer">
                        <button type="button" class="yzp-frame-color-picker-cancel">取消</button>
                        <button type="button" class="yzp-frame-color-picker-confirm">确认</button>
                    </footer>
                </section>
            `;
            settingsRoot.appendChild(overlay);

            const field = overlay.querySelector('.yzp-frame-color-field');
            const pointer = overlay.querySelector('.yzp-frame-color-field-pointer');
            const hueInput = overlay.querySelector('.yzp-frame-color-hue');
            const preview = overlay.querySelector('.yzp-frame-color-preview');
            const hexInput = overlay.querySelector('.yzp-frame-color-hex');
            const rgbInputs = Array.from(overlay.querySelectorAll('.yzp-frame-color-rgb-grid input'));
            const cancelButton = overlay.querySelector('.yzp-frame-color-picker-cancel');
            const confirmButton = overlay.querySelector('.yzp-frame-color-picker-confirm');
            let activePointerId = null;

            const currentHex = () => phoneRgbToHex(phoneHsvToRgb(draft));
            const renderPicker = ({ preserveHexInput = false, preserveRgbInput = false } = {}) => {
                draft = {
                    h: clampPhoneColorNumber(draft.h, 0, 360),
                    s: clampPhoneColorNumber(draft.s, 0, 1),
                    v: clampPhoneColorNumber(draft.v, 0, 1)
                };
                const rgb = phoneHsvToRgb(draft).map(channel => Math.round(channel));
                const hex = phoneRgbToHex(rgb);

                field?.style.setProperty('--yzp-frame-picker-hue', String(draft.h));
                field?.setAttribute('aria-valuetext', hex);
                if (pointer) {
                    pointer.style.left = `${draft.s * 100}%`;
                    pointer.style.top = `${(1 - draft.v) * 100}%`;
                }
                if (hueInput) {
                    hueInput.value = String(Math.round(draft.h));
                    hueInput.style.setProperty('--yzp-frame-picker-hue', String(draft.h));
                }
                if (preview) preview.style.backgroundColor = hex;
                if (hexInput && !preserveHexInput) hexInput.value = hex;
                rgbInputs.forEach((input, index) => {
                    if (!preserveRgbInput || globalDocument.activeElement !== input) {
                        input.value = String(rgb[index]);
                    }
                });
                applyPreview(hex);
            };

            const closePicker = ({ restore = false } = {}) => {
                if (restore) applyPreview(originalColor);
                overlay.remove();
                globalThis.requestAnimationFrame?.(() => trigger.focus());
            };

            const updateFieldFromPointer = (pointerEvent) => {
                if (!field) return;
                const rect = field.getBoundingClientRect();
                if (!rect.width || !rect.height) return;
                draft.s = clampPhoneColorNumber((pointerEvent.clientX - rect.left) / rect.width, 0, 1);
                draft.v = 1 - clampPhoneColorNumber((pointerEvent.clientY - rect.top) / rect.height, 0, 1);
                renderPicker();
            };

            field?.addEventListener('pointerdown', (pointerEvent) => {
                pointerEvent.preventDefault();
                pointerEvent.stopPropagation();
                activePointerId = pointerEvent.pointerId;
                field.focus();
                try { field.setPointerCapture(pointerEvent.pointerId); } catch (e) {}
                updateFieldFromPointer(pointerEvent);
            });
            field?.addEventListener('pointermove', (pointerEvent) => {
                if (activePointerId !== pointerEvent.pointerId) return;
                pointerEvent.preventDefault();
                updateFieldFromPointer(pointerEvent);
            });
            const finishPointer = (pointerEvent) => {
                if (activePointerId !== pointerEvent.pointerId) return;
                activePointerId = null;
                try { field.releasePointerCapture(pointerEvent.pointerId); } catch (e) {}
            };
            field?.addEventListener('pointerup', finishPointer);
            field?.addEventListener('pointercancel', finishPointer);
            field?.addEventListener('keydown', (keyEvent) => {
                const step = keyEvent.shiftKey ? 0.05 : 0.01;
                if (keyEvent.key === 'ArrowLeft') draft.s -= step;
                else if (keyEvent.key === 'ArrowRight') draft.s += step;
                else if (keyEvent.key === 'ArrowUp') draft.v += step;
                else if (keyEvent.key === 'ArrowDown') draft.v -= step;
                else return;
                keyEvent.preventDefault();
                renderPicker();
            });

            hueInput?.addEventListener('input', (inputEvent) => {
                draft.h = clampPhoneColorNumber(inputEvent.target.value, 0, 360);
                renderPicker();
            });
            ['pointerdown', 'touchstart', 'touchmove'].forEach((eventName) => {
                hueInput?.addEventListener(eventName, (inputEvent) => inputEvent.stopPropagation(), { passive: true });
            });

            rgbInputs.forEach(input => {
                input.addEventListener('input', () => {
                    const values = rgbInputs.map(channelInput => String(channelInput.value || '').trim());
                    if (values.some(value => value === '')) return;
                    draft = phoneRgbToHsv(values.map(value => clampPhoneColorNumber(value, 0, 255)));
                    renderPicker({ preserveRgbInput: true });
                });
                input.addEventListener('blur', () => renderPicker());
            });

            hexInput?.addEventListener('input', () => {
                const parsed = parsePhoneHexColor(hexInput.value);
                if (!parsed) return;
                draft = phoneRgbToHsv(phoneHexToRgb(parsed));
                renderPicker({ preserveHexInput: true });
            });
            hexInput?.addEventListener('blur', () => renderPicker());
            hexInput?.addEventListener('keydown', (keyEvent) => {
                if (keyEvent.key !== 'Enter') return;
                keyEvent.preventDefault();
                const parsed = parsePhoneHexColor(hexInput.value);
                if (parsed) draft = phoneRgbToHsv(phoneHexToRgb(parsed));
                renderPicker();
                hexInput.blur();
            });

            overlay.querySelector('.yzp-frame-color-picker-close')?.addEventListener('click', () => closePicker({ restore: true }));
            cancelButton?.addEventListener('click', () => closePicker({ restore: true }));
            confirmButton?.addEventListener('click', async () => {
                const color = currentHex();
                confirmButton.disabled = true;
                try {
                    await storage.set(storageKey, color);
                    applyPreview(color);
                    closePicker();
                } catch (error) {
                    console.error(`保存${pickerLabel}失败:`, error);
                    confirmButton.disabled = false;
                    onError?.(pickerLabel, error);
                }
            });
            overlay.addEventListener('click', (overlayEvent) => {
                if (overlayEvent.target === overlay) closePicker({ restore: true });
            });
            overlay.addEventListener('keydown', (keyEvent) => {
                if (keyEvent.key !== 'Escape') return;
                keyEvent.preventDefault();
                keyEvent.stopPropagation();
                closePicker({ restore: true });
            });

            renderPicker();
            globalThis.requestAnimationFrame?.(() => field?.focus());
        });
    });
}
